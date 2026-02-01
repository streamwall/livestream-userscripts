# Livestream Userscripts

This repository contains userscripts for Tampermonkey, Greasemonkey, and supporting browsers to help discover livestreaming video feeds across social media outlets.

## Scripts Index

| Script | Purpose | Target site(s) |
| --- | --- | --- |
| `scripts/yt-search-filter.user.js` | Auto-apply YouTube search filters and hide results from selected channels. | `https://www.youtube.com/results*` |

## Installation

### General workflow (any userscript manager)
1. Install a userscript manager for your browser/device.
2. Open the desired `.user.js` file from this repo (raw view) or paste its contents into a new script in the manager.
3. Accept the install prompt.
4. Visit the target site and confirm the script is enabled.

### Tampermonkey (Chrome/Edge/Firefox)
1. Install Tampermonkey from your browser’s extension/add-on store.
2. Open the script file (raw `.user.js`) or use the Tampermonkey dashboard → “Create a new script…”, then paste the file contents.
3. Save, then visit the target site.

### Greasemonkey (Firefox)
1. Install Greasemonkey from Firefox Add-ons.
2. Open the script file (raw `.user.js`) to trigger the install prompt.
3. Confirm the install and refresh the target site.

### iOS: Userscripts app (Safari)
1. Install the “Userscripts” app from the App Store.
2. Enable the extension: Settings → Safari → Extensions → Userscripts (allow it for your sites).
3. Open the script file in Safari, then use the Share sheet → Userscripts to install.
4. Visit the target site and enable the script in the Userscripts extension menu if needed.

### Android
Option A: Firefox for Android + Violentmonkey (recommended)
1. Install Firefox for Android.
2. Install a userscript manager add-on (Violentmonkey or Tampermonkey).
3. Open the script file (raw `.user.js`) and accept the install prompt.

Option B: Kiwi Browser + Tampermonkey
1. Install Kiwi Browser (supports Chrome extensions).
2. Install Tampermonkey from the Chrome Web Store.
3. Open the script file (raw `.user.js`) and install.
