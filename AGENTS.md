# AGENTS.md

Windows-only Electron + Vue 3 desktop app ("提醒事项" / Reminders). No tests, lint, typecheck, or CI configured — verification is by running the app.

## Commands

```bash
npm install        # also runs postinstall: copies vue.global.prod.js into src/renderer/lib/ + regenerates build/icon.ico
npm run dev        # electron . --dev (opens DevTools)
npm start          # electron .  (production run)
npm run build      # electron-builder --win  -> NSIS installer in release/
npm run build:portable  # single-file portable .exe
npm run gen-icon   # regenerate build/icon.ico only (run after editing build/gen-icon.js)
```

### Gotchas

- `src/renderer/lib/vue.global.prod.js` is gitignored and **must** be populated by `npm install`'s postinstall. If it's missing, the renderer won't load Vue. Do not commit it.
- After changing `build/gen-icon.js`, run `npm run gen-icon` before `npm run build` — electron-builder embeds `build/icon.ico`.
- Dev-only screenshot capture: `electron . --dev --shot` (writes `main-shot.png` / `float-shot.png` then quits). These outputs are gitignored.
- Closing the main window hides to tray and auto-shows the float window (driven by settings). Quit only happens via tray menu / `app.quit()`.

## Architecture

Two Electron windows, each with its own preload:

- **Main window** — `src/renderer/index.html` + `js/main-app.js`, preload `src/main/preload.js`
- **Float window** — `src/renderer/float.html` + `js/float-app.js`, preload `src/main/preload-float.js`

Both renderers run with `contextIsolation: true`, `nodeIntegration: false`. All main-process access is via IPC channels exposed through the preload scripts. The IPC API surface is `store:*` (handle) and `float:*` / `main:*` (on) — see `src/main/index.js` around line 294.

Main process entry: `src/main/index.js` (declared as `"main"` in package.json). Owns windows, tray, global shortcuts, theme, and notification wiring.

### Data layer

`src/main/store.js` — single JSON store. Runtime data lives at `<userData>/data/reminders.json` (NOT in the repo). Writes are atomic via `.tmp` rename, with `.bak` and `.corrupt` siblings for safety. `store.update()` enforces a field whitelist (`ALLOWED_FIELDS`); adding new persisted reminder fields requires updating both the whitelist and `defaultData()` (bump `version`). `nextId` is the monotonic ID counter — don't use `Date.now()` for IDs.

`src/main/notify.js` — notification scheduler; holds a reference to the main window for click-to-focus. `src/main/tray-icon.js` generates the tray PNG with a badge count at runtime (Windows doesn't support SVG data URLs for tray icons).

### Renderer conventions

- Vue 3 via the global build (no build step, no SFCs). Logic lives in plain `js/*.js` files using `Vue.createApp`.
- Two separate Vue app instances; they share no state directly — all data flows through IPC to the store.

## Packaging

electron-builder config is inline in `package.json` (`build` key). Windows NSIS target only. `files` explicitly includes `src/**/*` and the vendored `vue.global.prod.js` — adding new runtime assets outside `src/` requires updating this list or they won't be packaged.
