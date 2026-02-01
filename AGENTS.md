# Repository Guidelines

## Project Structure & Module Organization
- `README.md` at root explains purpose.
- Userscripts live in `scripts/` (create if missing). Keep one script per file.
- Optional helpers or shared utilities go in `lib/` or `shared/` with clear module names.
- Supporting docs or screenshots go in `docs/`.

## Build, Test, and Development Commands
- No build step is required today; scripts are loaded directly into Tampermonkey/Greasemonkey.
- Manual run: install a `.user.js` in your manager and refresh the target site.
- If automation is added later (lint/test/build), document commands here and in `README.md`.

## Coding Style & Naming Conventions
- File names: `site-feature.user.js` (example: `tiktok-live-discovery.user.js`).
- Include a standard userscript header (`@name`, `@match`, `@version`, `@grant`).
- Match the style of existing scripts; default to 2 spaces and semicolons if no precedent.
- Keep browser-specific code isolated and commented when necessary.

## Project-Specific Notes
- YouTube search filters are applied via the `sp` query param (currently `CAMSAkAB`) instead of clicking the filters UI.
- The YSF menu is rendered in an overlay layer (`#ysf-layer`) to avoid z-index/stacking issues; add new UI there when possible.
- Live result detection should consider `ytd-thumbnail[is-live-video]` and `.yt-badge-shape--live` in addition to overlay text.

## Testing Guidelines
- No automated test framework yet.
- Validate changes on each supported site and browser; note the tested versions in PRs.
- If tests are introduced, place them under `tests/` and add a runnable command.

## Commit & Pull Request Guidelines
- Commit messages are short and descriptive; use imperative mood (e.g., "Add Twitch filter").
- PRs should include: summary, testing notes, target sites, and screenshots if UI is affected.
- Link related issues when applicable.

## Security & Configuration Tips
- Do not commit API keys or tokens.
- Keep `@grant` permissions minimal and document any new permissions.
