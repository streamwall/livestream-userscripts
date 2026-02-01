// ==UserScript==
// @name         YouTube Search Filter Helper
// @namespace    livestream-userscripts
// @version      0.1.3
// @description  Auto-apply Live/Popularity filters and hide search results from selected channels.
// @match        https://www.youtube.com/results*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEYS = {
    enabled: 'ytSearchFilter.enabled',
    autoFilters: 'ytSearchFilter.autoFilters',
    channelList: 'ytSearchFilter.channelList',
    debug: 'ytSearchFilter.debug'
  };

  let debugEnabled = localStorage.getItem(STORAGE_KEYS.debug) !== 'false';
  const LOG_PREFIX = '[YSF]';

  const SELECTORS = {
    resultsRoot: 'ytd-search ytd-section-list-renderer > #contents',
    resultItems: [
      'ytd-video-renderer',
      'ytd-channel-renderer',
      'ytd-playlist-renderer',
      'ytd-radio-renderer',
      'ytd-compact-video-renderer',
      'ytd-compact-channel-renderer',
      'ytd-compact-playlist-renderer',
      'ytd-grid-video-renderer',
      'ytd-grid-channel-renderer',
      'ytd-grid-playlist-renderer',
      'ytd-reel-item-renderer'
    ].join(',')
  };

  const state = {
    hideHandles: new Set(),
    hideHandlePatterns: [],
    hideNames: new Set(),
    hideNamePatterns: [],
    listVersion: 0,
    observer: null,
    observerPending: false,
    scanScheduled: false,
    retryTimer: null,
    rescanTimer: null,
    menuOpen: false,
    autoApply: {
      query: '',
      attempts: 0,
      lastResetAt: 0
    }
  };

  function isSearchPage() {
    return location.pathname === '/results';
  }

  function isScriptEnabled() {
    return localStorage.getItem(STORAGE_KEYS.enabled) !== 'false';
  }

  function setScriptEnabled(enabled) {
    localStorage.setItem(STORAGE_KEYS.enabled, enabled ? 'true' : 'false');
  }

  function readAutoFiltersEnabled() {
    return localStorage.getItem(STORAGE_KEYS.autoFilters) === 'true';
  }

  function setAutoFiltersEnabled(enabled) {
    localStorage.setItem(STORAGE_KEYS.autoFilters, enabled ? 'true' : 'false');
  }

  function readDebugEnabled() {
    return debugEnabled;
  }

  function setDebugEnabled(enabled) {
    debugEnabled = enabled;
    localStorage.setItem(STORAGE_KEYS.debug, enabled ? 'true' : 'false');
    if (debugEnabled) {
      console.info(LOG_PREFIX, 'Debug logging enabled');
    }
  }

  function readChannelList() {
    return localStorage.getItem(STORAGE_KEYS.channelList) || '';
  }

  function setChannelList(value) {
    localStorage.setItem(STORAGE_KEYS.channelList, value);
  }

  function parseChannelList(value) {
    const handles = new Set();
    const handlePatterns = [];
    const names = new Set();
    const namePatterns = [];
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        if (line.startsWith('@')) {
          if (line.includes('*')) {
            const pattern = normalizeHandle(line);
            if (pattern) {
              handlePatterns.push({
                pattern,
                regex: wildcardToRegex(pattern)
              });
            }
          } else {
            const handle = normalizeHandle(line);
            if (handle) {
              handles.add(handle);
            }
          }
          return;
        }
        if (line.includes('*')) {
          const pattern = normalizeDisplayName(line);
          if (pattern) {
            namePatterns.push({
              pattern,
              regex: wildcardToRegex(pattern)
            });
          }
          return;
        }
        const name = normalizeDisplayName(line);
        if (name) {
          names.add(name);
        }
      });
    return { handles, handlePatterns, names, namePatterns };
  }

  function logInfo(...args) {
    if (!debugEnabled) {
      return;
    }
    console.info(LOG_PREFIX, ...args);
  }

  function logWarn(...args) {
    if (!debugEnabled) {
      return;
    }
    console.warn(LOG_PREFIX, ...args);
  }

  function updateHideSet(value) {
    const parsed = parseChannelList(value);
    state.hideHandles = parsed.handles;
    state.hideHandlePatterns = parsed.handlePatterns;
    state.hideNames = parsed.names;
    state.hideNamePatterns = parsed.namePatterns;
    state.listVersion += 1;
    logInfo('Updated hide list', {
      handles: state.hideHandles.size,
      handlePatterns: state.hideHandlePatterns.length,
      names: state.hideNames.size,
      namePatterns: state.hideNamePatterns.length
    });
    scheduleScan();
  }

  function scheduleScan() {
    if (state.scanScheduled) {
      return;
    }
    state.scanScheduled = true;
    requestAnimationFrame(() => {
      state.scanScheduled = false;
      scanAndHide();
    });
  }

  function startRescanLoop() {
    if (state.rescanTimer) {
      return;
    }
    state.rescanTimer = window.setInterval(() => {
      if (isSearchPage()) {
        scheduleScan();
      }
    }, 2000);
  }

  function stopRescanLoop() {
    if (!state.rescanTimer) {
      return;
    }
    clearInterval(state.rescanTimer);
    state.rescanTimer = null;
  }

  function scanAndHide() {
    if (!isSearchPage()) {
      return;
    }
    const root = document.querySelector('ytd-search');
    if (!root) {
      return;
    }
    const items = root.querySelectorAll(SELECTORS.resultItems);
    if (!isScriptEnabled()) {
      clearResults(items);
      return;
    }
    items.forEach((item) => {
      const shouldHide = hasHiddenChannel(item);
      if (item.dataset.ysfVersion !== String(state.listVersion)) {
        item.dataset.ysfVersion = String(state.listVersion);
        setHidden(item, shouldHide);
      }
      ensureQuickHideButton(item, shouldHide);
    });
  }

  function clearResults(items) {
    items.forEach((item) => {
      item.classList.remove('ysf-hidden');
      item.removeAttribute('data-ysf-version');
      const row = item.querySelector('.ysf-quick-actions');
      if (row) {
        row.remove();
      }
    });
  }

  function hasHiddenChannel(item) {
    if (
      state.hideHandles.size === 0 &&
      state.hideHandlePatterns.length === 0 &&
      state.hideNames.size === 0 &&
      state.hideNamePatterns.length === 0
    ) {
      return false;
    }
    const handle = getChannelHandle(item);
    if (handle) {
      if (state.hideHandles.size > 0 && state.hideHandles.has(handle)) {
        return true;
      }
      if (state.hideHandlePatterns.length > 0) {
        for (const pattern of state.hideHandlePatterns) {
          if (pattern.regex.test(handle)) {
            return true;
          }
        }
      }
    }
    const displayName = getChannelDisplayName(item);
    if (displayName) {
      if (state.hideNames.size > 0 && state.hideNames.has(displayName)) {
        return true;
      }
      if (state.hideNamePatterns.length > 0) {
        for (const pattern of state.hideNamePatterns) {
          if (pattern.regex.test(displayName)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function ensureQuickHideButton(item, isHidden) {
    if (
      !item ||
      !item.matches('ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer')
    ) {
      return;
    }
    if (!isScriptEnabled()) {
      const existing = item.querySelector('.ysf-quick-actions');
      if (existing) {
        existing.remove();
      }
      return;
    }
    const isLive = isLiveResult(item);
    let row = item.querySelector('.ysf-quick-actions');
    if (!isLive) {
      if (row) {
        row.remove();
      }
      return;
    }

    const titleContainer = getTitleContainer(item);
    if (!titleContainer) {
      return;
    }

    const handle = getChannelHandle(item);
    const name = getChannelDisplayName(item);
    if (!handle && !name) {
      if (row) {
        row.style.display = 'none';
      }
      return;
    }

    if (!row) {
      row = document.createElement('div');
      row.className = 'ysf-quick-actions';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ysf-quick-hide';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const handle = button.dataset.ysfHandle || '';
        const name = button.dataset.ysfName || '';
        const added = addChannelToList(handle, name);
        if (added) {
          scheduleScan();
        }
      });
      row.appendChild(button);
      titleContainer.insertAdjacentElement('afterend', row);
    }

    const signature = `${isHidden ? 1 : 0}|${handle || ''}|${name || ''}`;
    if (row.dataset.ysfSignature === signature) {
      return;
    }

    row.dataset.ysfSignature = signature;
    row.style.display = '';
    const button = row.querySelector('button.ysf-quick-hide');
    if (!button) {
      return;
    }
    button.dataset.ysfHandle = handle || '';
    button.dataset.ysfName = name || '';
    if (isHidden) {
      button.textContent = 'Hidden';
      button.disabled = true;
    } else {
      button.textContent = 'Hide channel';
      button.disabled = false;
    }
  }

  function addChannelToList(handle, name) {
    const normalizedHandle = normalizeHandle(handle);
    const normalizedName = normalizeDisplayName(name);
    let entry = null;
    let normalizedEntry = null;
    if (normalizedHandle) {
      entry = normalizedHandle;
      normalizedEntry = normalizedHandle;
    } else if (normalizedName) {
      entry = name.trim();
      normalizedEntry = normalizedName;
    }
    if (!entry || !normalizedEntry) {
      return false;
    }

    const existing = readChannelList()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const normalizedExisting = new Set(
      existing.map((line) =>
        line.startsWith('@') ? normalizeHandle(line) : normalizeDisplayName(line)
      )
    );
    if (normalizedHandle && normalizedName && normalizedExisting.has(normalizedName)) {
      return false;
    }
    if (normalizedExisting.has(normalizedEntry)) {
      return false;
    }

    existing.push(entry);
    const updated = existing.join('\n');
    setChannelList(updated);
    const textarea = document.getElementById('ysf-channel-list');
    if (textarea) {
      textarea.value = updated;
    }
    updateHideSet(updated);
    return true;
  }

  function getTitleContainer(item) {
    const titleWrapper = item.querySelector('#title-wrapper');
    if (titleWrapper) {
      return titleWrapper;
    }
    const title = item.querySelector('#video-title');
    if (title) {
      const header = title.closest('h3');
      if (header) {
        return header;
      }
      if (title.parentElement) {
        return title.parentElement;
      }
    }
    const header = item.querySelector('h3');
    if (header) {
      return header;
    }
    return null;
  }

  function isLiveResult(item) {
    if (item.matches('[is-live-video], [is-live]')) {
      return true;
    }
    const liveThumb = item.querySelector('ytd-thumbnail[is-live-video], ytd-thumbnail[is-live]');
    if (liveThumb) {
      return true;
    }
    if (item.querySelector('.yt-badge-shape--live')) {
      return true;
    }
    const overlay = item.querySelector(
      'ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE"], ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE_NOW"]'
    );
    if (overlay) {
      return true;
    }
    const overlayText = item.querySelector('ytd-thumbnail-overlay-time-status-renderer');
    if (overlayText && overlayText.textContent) {
      const text = overlayText.textContent.trim().toLowerCase();
      if (text.includes('live')) {
        return true;
      }
    }
    const badges = item.querySelectorAll('ytd-badge-supported-renderer, badge-shape');
    for (const badge of badges) {
      const rawText = badge.getAttribute('aria-label') || badge.textContent || '';
      const text = rawText.trim().toLowerCase();
      if (text.includes('live')) {
        return true;
      }
    }
    return false;
  }

  function extractHandle(href) {
    if (!href) {
      return null;
    }
    const match = href.match(/\/@([A-Za-z0-9._-]+)/);
    if (!match) {
      return null;
    }
    return normalizeHandle(`@${match[1]}`);
  }

  function normalizeHandle(value) {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return trimmed.toLowerCase();
  }

  function normalizeDisplayName(value) {
    if (!value) {
      return null;
    }
    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      return null;
    }
    return trimmed.toLowerCase();
  }

  function wildcardToRegex(pattern) {
    let source = '^';
    for (const char of pattern) {
      if (char === '*') {
        source += '.*';
      } else {
        source += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
      }
    }
    source += '$';
    return new RegExp(source);
  }

  function getChannelHandle(item) {
    if (!item) {
      return null;
    }
    const links = item.querySelectorAll('a[href*="/@"]');
    for (const link of links) {
      const handle = extractHandle(link.getAttribute('href'));
      if (handle) {
        return handle;
      }
    }
    return null;
  }

  function getChannelDisplayName(item) {
    const selectors = [
      '#channel-name #text a',
      '#channel-name #text',
      'ytd-channel-name #text',
      'ytd-channel-name a',
      'ytd-channel-renderer #channel-title',
      'ytd-channel-renderer #text',
      'ytd-channel-renderer a',
      'ytd-video-owner-renderer #channel-name a',
      'ytd-video-owner-renderer #channel-name'
    ];
    for (const selector of selectors) {
      const candidate = item.querySelector(selector);
      if (candidate && candidate.textContent) {
        const normalized = normalizeDisplayName(candidate.textContent);
        if (normalized) {
          return normalized;
        }
      }
    }
    return null;
  }

  function setHidden(item, hidden) {
    if (hidden) {
      item.classList.add('ysf-hidden');
    } else {
      item.classList.remove('ysf-hidden');
    }
  }

  function ensureStyles() {
    if (document.getElementById('ysf-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'ysf-styles';
    style.textContent = `
      .ysf-hidden {
        display: none !important;
      }

      #ysf-menu {
        display: flex;
        align-items: flex-start;
        position: fixed;
        top: calc(var(--ytd-masthead-height, 56px) + 6px);
        left: 12px;
        gap: 8px;
        margin-top: 0;
        margin-left: 0;
        padding: 6px 8px;
        border-radius: 10px;
        border: 1px solid var(--yt-spec-outline, rgba(0, 0, 0, 0.2));
        background: var(--yt-spec-general-background-a, #ffffff);
        color: var(--yt-spec-text-primary, #0f0f0f);
        font-size: 11px;
        line-height: 1.2;
        pointer-events: auto;
      }

      #ysf-layer {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: none;
      }

      #ysf-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        margin-left: 8px;
        border-radius: 999px;
        border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.18));
        background: var(--yt-spec-general-background-a, #ffffff);
        color: var(--yt-spec-text-primary, #0f0f0f);
        cursor: pointer;
        z-index: 2147483647;
      }

      #ysf-toggle:hover {
        background: var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.08));
      }

      #ysf-toggle.ysf-toggle--active {
        background: var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.12));
        border-color: var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.3));
      }

      #ysf-menu .ysf-row {
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
      }

      #ysf-menu .ysf-column {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      #ysf-menu .ysf-controls {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      #ysf-menu textarea {
        width: 170px;
        height: 36px;
        padding: 4px 6px;
        border-radius: 6px;
        border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.18));
        background: var(--yt-spec-general-background-a, #ffffff);
        color: var(--yt-spec-text-primary, #0f0f0f);
        font-size: 10.5px;
        line-height: 1.2;
        resize: vertical;
      }

      #ysf-menu textarea::placeholder {
        color: var(--yt-spec-text-secondary, #606060);
      }

      #ysf-menu .ysf-label {
        font-weight: 500;
      }

      .ysf-quick-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
      }

      .ysf-quick-hide {
        border: 1px solid var(--yt-spec-outline, rgba(0, 0, 0, 0.2));
        border-radius: 999px;
        padding: 2px 8px;
        background: var(--yt-spec-general-background-a, #ffffff);
        color: var(--yt-spec-text-primary, #0f0f0f);
        font-size: 11px;
        line-height: 1.2;
        cursor: pointer;
      }

      .ysf-quick-hide:disabled {
        opacity: 0.6;
        cursor: default;
      }

      @media (max-width: 950px) {
        #ysf-menu textarea {
          width: 120px;
        }
      }

      @media (max-width: 820px) {
        #ysf-menu textarea {
          display: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buildMenu() {
    const wrapper = document.createElement('div');
    wrapper.id = 'ysf-menu';
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-label', 'Search filter controls');

    const controls = document.createElement('div');
    controls.className = 'ysf-controls';

    const enabledRow = document.createElement('label');
    enabledRow.className = 'ysf-row';
    enabledRow.title = 'Enable or disable all YSF features.';

    const enabledCheckbox = document.createElement('input');
    enabledCheckbox.type = 'checkbox';
    enabledCheckbox.id = 'ysf-enabled';
    enabledCheckbox.checked = isScriptEnabled();

    const enabledText = document.createElement('span');
    enabledText.textContent = 'Enabled';

    enabledRow.appendChild(enabledCheckbox);
    enabledRow.appendChild(enabledText);

    const autoRow = document.createElement('label');
    autoRow.className = 'ysf-row';
    autoRow.title = 'Automatically apply Live + Popularity filters when results load.';

    const autoCheckbox = document.createElement('input');
    autoCheckbox.type = 'checkbox';
    autoCheckbox.id = 'ysf-auto-filters';
    autoCheckbox.checked = readAutoFiltersEnabled();

    const autoText = document.createElement('span');
    autoText.textContent = 'Auto filters';

    autoRow.appendChild(autoCheckbox);
    autoRow.appendChild(autoText);

    const debugRow = document.createElement('label');
    debugRow.className = 'ysf-row';
    debugRow.title = 'Enable console debug logs for this script.';

    const debugCheckbox = document.createElement('input');
    debugCheckbox.type = 'checkbox';
    debugCheckbox.id = 'ysf-debug';
    debugCheckbox.checked = readDebugEnabled();

    const debugText = document.createElement('span');
    debugText.textContent = 'Debug';

    debugRow.appendChild(debugCheckbox);
    debugRow.appendChild(debugText);

    const column = document.createElement('div');
    column.className = 'ysf-column';

    const label = document.createElement('span');
    label.className = 'ysf-label';
    label.textContent = 'Hide channels';

    const textarea = document.createElement('textarea');
    textarea.id = 'ysf-channel-list';
    textarea.placeholder = '@handle or name (use *)';
    textarea.value = readChannelList();

    column.appendChild(label);
    column.appendChild(textarea);

    controls.appendChild(autoRow);
    controls.appendChild(debugRow);
    controls.insertBefore(enabledRow, autoRow);

    wrapper.appendChild(controls);
    wrapper.appendChild(column);

    autoCheckbox.addEventListener('change', () => {
      setAutoFiltersEnabled(autoCheckbox.checked);
      if (autoCheckbox.checked) {
        applyFiltersIfEnabled();
      }
    });

    enabledCheckbox.addEventListener('change', () => {
      setScriptEnabled(enabledCheckbox.checked);
      updateMenuControlsEnabled(enabledCheckbox.checked);
      if (enabledCheckbox.checked) {
        enableScriptRuntime();
      } else {
        disableScriptRuntime();
      }
    });

    debugCheckbox.addEventListener('change', () => {
      setDebugEnabled(debugCheckbox.checked);
      logInfo('Debug toggled', { enabled: debugCheckbox.checked });
    });

    textarea.addEventListener('input', () => {
      setChannelList(textarea.value);
      updateHideSet(textarea.value);
    });

    updateMenuControlsEnabled(enabledCheckbox.checked);

    return wrapper;
  }

  function updateMenuControlsEnabled(enabled) {
    const autoCheckbox = document.getElementById('ysf-auto-filters');
    if (autoCheckbox) {
      autoCheckbox.disabled = !enabled;
    }
    const textarea = document.getElementById('ysf-channel-list');
    if (textarea) {
      textarea.disabled = !enabled;
    }
  }

  function enableScriptRuntime() {
    if (!isSearchPage()) {
      return;
    }
    setupObserver();
    scheduleScan();
    startRescanLoop();
    applyFiltersIfEnabled();
  }

  function disableScriptRuntime() {
    stopRescanLoop();
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
      logInfo('Observer detached (script disabled)');
    }
    const root = document.querySelector('ytd-search');
    if (root) {
      clearResults(root.querySelectorAll(SELECTORS.resultItems));
    }
  }

  function ensureMenu() {
    ensureStyles();
    let menu = document.getElementById('ysf-menu');
    if (!menu) {
      menu = buildMenu();
      logInfo('Menu created');
    }

    const layer = ensureLayer();
    if (menu.parentElement !== layer) {
      layer.appendChild(menu);
    }

    setMenuVisible(state.menuOpen);
    updateMenuControlsEnabled(isScriptEnabled());

    const start = document.querySelector('ytd-masthead #start');
    if (!start) {
      return;
    }

    const toggle = ensureToggleButton();

    const logo =
      start.querySelector('ytd-topbar-logo-renderer#logo') ||
      start.querySelector('ytd-topbar-logo-renderer') ||
      start.querySelector('#masthead-logo');

    if (toggle.parentElement !== start) {
      if (logo && logo.parentElement === start) {
        start.insertBefore(toggle, logo.nextSibling);
      } else {
        start.appendChild(toggle);
      }
    }
  }

  function ensureLayer() {
    let layer = document.getElementById('ysf-layer');
    if (layer) {
      return layer;
    }
    layer = document.createElement('div');
    layer.id = 'ysf-layer';
    document.documentElement.appendChild(layer);
    return layer;
  }

  function hideMenu() {
    state.menuOpen = false;
    setMenuVisible(false);
  }

  function setMenuVisible(visible) {
    const menu = document.getElementById('ysf-menu');
    if (menu) {
      menu.style.display = visible ? '' : 'none';
    }
    const toggle = document.getElementById('ysf-toggle');
    if (toggle) {
      toggle.classList.toggle('ysf-toggle--active', visible);
      toggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
    }
  }

  function ensureToggleButton() {
    let toggle = document.getElementById('ysf-toggle');
    if (toggle) {
      return toggle;
    }
    toggle = document.createElement('button');
    toggle.id = 'ysf-toggle';
    toggle.type = 'button';
    toggle.title = 'Toggle search filter controls';
    toggle.setAttribute('aria-label', 'Toggle search filter controls');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 5h18l-6.5 7.5v5l-5 2v-7L3 5z"></path>
      </svg>
    `;
    toggle.addEventListener('click', () => {
      state.menuOpen = !state.menuOpen;
      setMenuVisible(state.menuOpen);
    });
    return toggle;
  }

  function setupObserver() {
    const root = document.querySelector(SELECTORS.resultsRoot);
    if (!root) {
      if (state.observerPending) {
        return;
      }
      state.observerPending = true;
      logInfo('Waiting for results root to attach observer');
      waitForElement(SELECTORS.resultsRoot, document, 8000).then((resolved) => {
        state.observerPending = false;
        if (resolved) {
          attachObserver(resolved);
          scheduleScan();
          logInfo('Observer attached after waiting');
        } else {
          logWarn('Failed to find results root for observer');
        }
      });
      return;
    }
    attachObserver(root);
  }

  function attachObserver(root) {
    if (state.observer) {
      state.observer.disconnect();
    }
    state.observer = new MutationObserver(() => {
      scheduleScan();
    });
    state.observer.observe(root, { childList: true, subtree: true });
  }

  function resetAutoApplyState(query) {
    state.autoApply.query = query;
    state.autoApply.attempts = 0;
    state.autoApply.lastResetAt = Date.now();
  }

  function canAttemptAutoApply(query) {
    const now = Date.now();
    if (state.autoApply.query !== query || now - state.autoApply.lastResetAt > 60000) {
      resetAutoApplyState(query);
    }
    if (state.autoApply.attempts >= 6) {
      return false;
    }
    return true;
  }

  async function applyFiltersIfEnabled() {
    if (!isSearchPage() || !isScriptEnabled() || !readAutoFiltersEnabled()) {
      logInfo('Auto filters skipped', {
        isSearchPage: isSearchPage(),
        enabled: isScriptEnabled(),
        autoFilters: readAutoFiltersEnabled()
      });
      return;
    }
    const query = new URLSearchParams(location.search).get('search_query') || '';
    if (!query || !canAttemptAutoApply(query)) {
      logInfo('Auto filters waiting', {
        query,
        attempts: state.autoApply.attempts
      });
      return;
    }

    logInfo('Auto filters attempt', { query, attempt: state.autoApply.attempts + 1 });
    const result = await applyFilters();
    if (result === 'clicked') {
      state.autoApply.attempts += 1;
      logInfo('Auto filters clicked an option', {
        attempts: state.autoApply.attempts
      });
      scheduleAutoApplyRetry();
    } else if (result === 'done') {
      resetAutoApplyState(query);
      logInfo('Auto filters already applied');
    } else if (result === 'navigating') {
      state.autoApply.attempts += 1;
      logInfo('Auto filters redirected', {
        attempts: state.autoApply.attempts
      });
    } else if (result === 'retry') {
      state.autoApply.attempts += 1;
      logInfo('Auto filters retrying', {
        attempts: state.autoApply.attempts
      });
      scheduleAutoApplyRetry();
    } else {
      state.autoApply.attempts += 1;
      logWarn('Auto filters failed to apply');
    }
  }

  // Auto filters are applied via the search `sp` param instead of UI clicks.
  async function applyFilters() {
    const desiredSp = 'CAMSAkAB';
    const params = new URLSearchParams(location.search);
    const currentSp = params.get('sp') || '';
    if (currentSp === desiredSp) {
      return 'done';
    }
    params.set('sp', desiredSp);
    const nextUrl = `${location.pathname}?${params.toString()}`;
    logInfo('Navigating to filtered search', { sp: desiredSp });
    location.replace(nextUrl);
    return 'navigating';
  }

  function scheduleAutoApplyRetry() {
    if (state.retryTimer) {
      return;
    }
    state.retryTimer = window.setTimeout(() => {
      state.retryTimer = null;
      applyFiltersIfEnabled();
    }, 1500);
  }

  function waitForElement(selector, root, timeoutMs) {
    const base = root || document;
    const timeout = typeof timeoutMs === 'number' ? timeoutMs : 8000;
    const existing = base.querySelector(selector);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve) => {
      let observer = null;
      const timer = setTimeout(() => {
        if (observer) {
          observer.disconnect();
        }
        resolve(null);
      }, timeout);
      observer = new MutationObserver(() => {
        const found = base.querySelector(selector);
        if (found) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(base === document ? document.documentElement : base, {
        childList: true,
        subtree: true
      });
    });
  }

  function handleNavigation() {
    if (!isSearchPage()) {
      hideMenu();
      stopRescanLoop();
      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
        logInfo('Observer detached (left search page)');
      }
      return;
    }
    ensureMenu();
    if (isScriptEnabled()) {
      enableScriptRuntime();
    } else {
      disableScriptRuntime();
    }
  }

  function init() {
    updateHideSet(readChannelList());
    ensureMenu();
    if (isScriptEnabled()) {
      enableScriptRuntime();
    } else {
      disableScriptRuntime();
    }
    logInfo('Initialized', {
      enabled: isScriptEnabled(),
      autoFilters: readAutoFiltersEnabled(),
      hideHandles: state.hideHandles.size,
      hideHandlePatterns: state.hideHandlePatterns.length,
      hideNames: state.hideNames.size,
      hideNamePatterns: state.hideNamePatterns.length
    });
    window.addEventListener('yt-navigate-finish', handleNavigation);
    window.addEventListener('yt-page-data-updated', handleNavigation);
  }

  init();
})();
