# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Windows-only Electron + Vue 3 desktop app ("提醒事项" / Reminders). No tests, lint, typecheck, or CI are configured — verification is by running the app (`npm run dev`).

## Commands

```bash
npm install        # postinstall copies vue.global.prod.js into src/renderer/lib/ + regenerates build/icon.ico
npm run dev        # electron . --dev (opens DevTools)
npm start          # electron .  (production run)
npm run build      # electron-builder --win  -> NSIS installer in release/
npm run build:portable  # single-file portable .exe
npm run gen-icon   # regenerate build/icon.ico only (run after editing build/gen-icon.js)
```

### Gotchas

- `src/renderer/lib/vue.global.prod.js` is gitignored and **must** be populated by `npm install`'s postinstall. If it's missing the renderer won't load Vue. Do not commit it.
- After changing `build/gen-icon.js`, run `npm run gen-icon` before `npm run build` — electron-builder embeds `build/icon.ico`.
- Dev-only screenshot capture: `electron . --dev --shot` (writes `main-shot.png` / `float-shot.png` then quits). These outputs are gitignored.
- Closing the main window hides to tray and (per `settings.showFloatOnClose`) auto-shows the float window. Quit only happens via the tray menu / `app.quit()` — `window-all-closed` is suppressed to keep the app alive in the tray.

## Architecture

Three Electron windows, each with its own preload; all renderers use `contextIsolation: true`, `nodeIntegration: false`, and all main-process access is via IPC exposed through the preloads.

- **Main window** — `src/renderer/index.html` + `js/main-app.js`, preload `src/main/preload.js`. Full reminder/ list/ settings UI.
- **Float window** — `src/renderer/float.html` + `js/float-app.js`, preload `src/main/preload-float.js`. Compact overlay: recent items, inline quick-add, theme toggle, minimize-to-logo.
- **Logo window** — `src/renderer/logo.html`, preload `src/main/preload-logo.js`. A 48px always-on-top dot the float window collapses into; click expands back to float. Position is shared with the float window via `savedPos`.

### Float ↔ logo mode switching

`src/main/index.js` tracks `floatMode` (`FLOAT` | `LOGO`). The float and logo windows share one screen position (`savedPos`) and are mutually exclusive: `minimizeToLogo()` records the float's position, hides it, shows the logo; `showFloat()` does the reverse. `toggleFloat()` acts on whichever mode is active. Both windows listen for `move` to update `savedPos`; the logo window is frameless/transparent and dragged by IPC (`logo:drag` with throttled deltas from `preload-logo.js`, click-vs-drag disambiguated in `mouseup`).

### IPC surface

Defined in `src/main/index.js` around the `ipcMain.handle`/`ipcMain.on` block. Handlers are wrapped in `wrapHandler` (try/catch + log). Channels:
- `store:*` (handle) — data CRUD: `getAll`, `getActive`, `getRecent`, `getLists`, `create`, `update`, `toggle`, `remove`, `toggleSubtask`, `createList`, `updateList`, `deleteList`, `getSettings`, `updateSettings`, `export`, `import`.
- Outbound main→renderer sends: `main:refresh`, `float-refresh`, `focus-reminder`, `new-reminder`, `toggle-theme`, `open-help`, `theme-changed`. `sendToMain()` queues messages in `pendingMainMsgs` until the main window finishes loading, so IPC sent during startup isn't lost.
- Mutating `store:*` handlers call `updateTray()` + `refreshFloat()` + `refreshMain()` to keep all three views in sync.

Main process entry is `src/main/index.js` (declared as `"main"` in package.json). It owns windows, tray, the application menu, global shortcuts, theme, and notification wiring. Single-instance locked via `app.requestSingleInstanceLock()`.

### Data layer — `src/main/store.js`

Single JSON store. Runtime data lives at `<userData>/data/reminders.json` (NOT in the repo; `<userData>` is per-user Electron app data). Writes are atomic via `.tmp` rename, with `.bak` and `.corrupt` siblings — on load failure the `.bak` is tried, then the corrupt file is moved aside (never silently overwritten). `importData()` validates structure per-record before accepting.

Key invariants when modifying the store:
- `ALLOWED_FIELDS` (reminder update whitelist) and `ALLOWED_SETTINGS` (settings whitelist) gate writes — adding a new persisted reminder field requires adding it to `ALLOWED_FIELDS` and `defaultData()`; bump `version` if it needs migration.
- `validateData()` runs v1→v2 priority migration (old 1=高/2=中 swapped to new 2=高/1=中) and clamps out-of-range priorities. `importData()` re-runs it.
- `nextId` is the monotonic ID counter (`genIdNoSave()`). Do **not** use `Date.now()` for reminder/subtask IDs in the store — the renderer uses `Date.now()+Math.random()` only for unsaved editor subtask placeholders, which `update()` re-maps to real IDs via `genIdNoSave()`.
- **Repeat + spawn logic** (`completeReminder`/`uncompleteReminder`, called by `toggle` and `toggleSubtask`): completing a reminder with `due`+`repeat` spawns the next occurrence as a new reminder and marks the original `spawned`/`spawnedId`; uncompleting deletes the spawned child. `toggleSubtask` auto-completes the parent when all subtasks are done (and auto-uncompletes if one is later unchecked). Compute-next uses `computeNextDue()` which handles month-end overflow and leap-year Feb-29 drift.
- `notify.reset()` must be called after `importData()` so newly imported items aren't suppressed by stale `notifiedIds`.

### Notification — `src/main/notify.js`

Polls every 15s (`setInterval`), fires a Windows `Notification` for due items within the `remindAhead` window, dedupes via `notifiedIds` Set, and prunes that set against active items each tick. Holds a `mainWindowRef` for click-to-focus; checks `isDestroyed()` before touching `webContents`. Re-`start()`s on `powerMonitor.resume` (laptop wake). `Notification` is Windows-only behavior here — the app is Windows-targeted.

### Tray — `src/main/tray-icon.js`

Generates the tray PNG with an unread badge count at runtime (Windows doesn't support SVG data URLs for tray icons). `updateTray()` re-renders the icon + tooltip on every data mutation.

## Renderer conventions

- Vue 3 via the **global build** (no build step, no SFCs, no npm bundling of renderer code). Logic lives in plain `js/*.js` files using `Vue.createApp({...}).mount('#app')`.
- Two separate Vue app instances (main + float) share no state directly — all data flows through IPC to the store. `src/renderer/js/util.js` (`window.ReminderUtil`) is the only shared renderer module (date formatting/classification), loaded via `<script>` in both HTML files.
- Every `onXxx` listener exposed by a preload returns a cleanup function; renderers push these into a `cleanups` array and invoke them in `onUnmounted`.
- Renderer→main settings updates use `toPlain()` (deep clone) so the renderer isn't holding a live reference into the main-process cache. Settings deep-clone on load for the same reason.

## Packaging

electron-builder config is inline in `package.json` (`build` key). Windows NSIS target only. `files` explicitly includes `src/**/*` and the vendored `vue.global.prod.js` — adding new runtime assets outside `src/` requires updating this `files` list or they won't be packaged.
