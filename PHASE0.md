# Phase 0 — Stealth Overlay Skeleton

**Build spec.** Implement an Electron + TypeScript app that renders an
always-on-top, frameless, translucent overlay that is **invisible to screen-share/recording**,
toggled by a global hotkey, kept out of the taskbar, and that **never steals focus** from the
active app. No audio, STT, screenshots, or LLM yet — this phase only proves the stealth shell.

Target OS: **Windows 10/11 (x64)**. Validate on Windows, not macOS.

---

## Definition of done (acceptance criteria)

1. `npm run dev` launches a small translucent panel pinned top-right of the primary display,
   showing a status line and the active hotkeys.
2. A global hotkey toggles visibility. On re-show, the panel returns to its previous position.
3. **Screen-share invisibility:** while sharing the full screen in Zoom / Teams / Google Meet /
   OBS Display Capture, the overlay does **not** appear in the shared/recorded output.
4. The app has **no taskbar icon**, and ideally does not appear in Alt+Tab.
5. Toggling or showing the overlay **does not steal focus** — the user can keep typing in their
   editor while the overlay is shown or toggled.
6. The panel is **draggable** to reposition (frameless drag region).
7. A hotkey toggles **click-through** (mouse events pass to the app underneath).
8. A hotkey quits cleanly; all global shortcuts are unregistered on quit.
9. `npm run build:win` produces a **single portable `.exe`** in `dist/` that runs without `npm`.

---

## Stack & tooling (pin these — do not improvise)

- **Electron** (latest stable) + **TypeScript**.
- **Node 20 LTS+**.
- Scaffolding/bundling: **electron-vite** (TS template; clean `main` / `preload` / `renderer`
  separation). `electron-forge` + vite-typescript template is an acceptable alternative.
- Package manager: **npm**.
- Renderer: **plain HTML/CSS/TS** — no React this phase. Keep the shell lean.
- Packaging: **electron-builder**, `portable` Windows x64 target.

---

## Project structure

```
overlay/
  package.json
  electron.vite.config.ts
  tsconfig.json
  electron-builder.yml          # portable win x64
  src/
    main/
      index.ts                  # app lifecycle + bootstraps window & shortcuts
      window.ts                 # BrowserWindow factory (all stealth options live here)
      shortcuts.ts              # globalShortcut registration + handlers
      config.ts                 # single source of truth: hotkeys, window size/pos
    preload/
      index.ts                  # contextBridge: minimal, typed API surface
    renderer/
      index.html
      style.css
      renderer.ts
```

Keep `config.ts` as the single source of truth for hotkeys and window geometry — later phases
extend it with model lists, etc.

---

## Implementation details

### `window.ts` — the part that matters most

Create the window with **exactly** this option set. The Windows transparency + stealth behavior
is fragile; these specific flags are load-bearing.

```ts
const win = new BrowserWindow({
  width: 420,
  height: 320,
  x, y,                          // computed: top-right of primary work area, ~24px inset
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',  // fully transparent ARGB — REQUIRED with transparent:true on Windows
  hasShadow: false,
  resizable: false,              // do NOT make a transparent window resizable on Windows (repaint/white-border bugs)
  movable: true,
  alwaysOnTop: true,
  skipTaskbar: true,             // no taskbar icon (also keeps it out of Alt+Tab in most cases)
  focusable: false,              // never steal focus — see the focus note below
  fullscreenable: false,
  webPreferences: {
    preload: /* resolved path to preload/index.js */,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  },
});

win.setAlwaysOnTop(true, 'screen-saver');                 // highest practical level; floats over fullscreen apps
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
win.setContentProtection(true);                           // ← THE stealth call (WDA_EXCLUDEFROMCAPTURE on Windows)
win.setIgnoreMouseEvents(false);                          // start interactive
```

**`setContentProtection(true)` is the whole trick.** On Windows it calls
`SetWindowDisplayAffinity`. On Windows 10 build 19041 (2004) and later it uses
`WDA_EXCLUDEFROMCAPTURE` → the window is fully **absent** from captures. On older builds it falls
back to `WDA_MONITOR` → the window renders **black** in captures rather than absent. Set it
immediately after window creation, and re-assert it if the window is ever recreated.

**Focus note (important for later phases):** `focusable: false` is the clean way to guarantee the
overlay never steals focus, and it's correct for Phase 0 because there is no text input yet.
However, a non-focusable window **cannot receive keyboard input**, so when Phase 5 adds a chat
text box you must switch to `focusable: true` and instead show the window with
`win.showInactive()` while managing focus manually. Leave a `// PHASE 5: revisit focusable` comment.

### `index.ts` — lifecycle

- Standard single-instance lock (`app.requestSingleInstanceLock()`); quit second instances.
- On `whenReady`: create the window, load the renderer, register shortcuts.
- Show with **`win.showInactive()`**, never `win.show()` — `show()` focuses the window and steals
  focus from the user's active app.
- Track `win.getBounds()` before hiding so re-show restores the same position.
- `app.on('will-quit', () => globalShortcut.unregisterAll())`.
- Do not quit on `window-all-closed`; the overlay is the only window and toggling hides it.

### `shortcuts.ts` — global hotkeys

Register via `globalShortcut`. Defaults (make them configurable in `config.ts`; choose uncommon
combos to avoid clashing with other apps):

| Action | Default | Handler |
|---|---|---|
| Toggle visibility | `Control+\` | if visible → `win.hide()`; else `win.showInactive()` at last bounds |
| Toggle click-through | `Control+Shift+C` | flip `setIgnoreMouseEvents` (see below) |
| Nudge position | `Control+Alt+Arrow` | move window 20px (optional, nice for tiling) |
| Quit | `Control+Shift+Q` | `app.quit()` |

`globalShortcut.register` returns `false` if the combo is already taken — log a warning so the
user knows to rebind.

### Click-through

```ts
// click-through ON: mouse events pass to the app beneath; forward:true still lets the renderer see hover
win.setIgnoreMouseEvents(true, { forward: true });
// click-through OFF:
win.setIgnoreMouseEvents(false);
```

Expose the current state to the renderer via the preload API so the UI can show a small indicator.

### `preload/index.ts`

Use `contextBridge.exposeInMainWorld('overlay', { ... })`. Keep the surface tiny for this phase:
an `onClickThroughChanged(cb)` listener and maybe `getState()`. No `nodeIntegration` in the
renderer. Type the exposed API in a shared `.d.ts`.

### Renderer (minimal)

`index.html` + `style.css` + `renderer.ts`. A single rounded translucent card:

```css
html, body { margin: 0; background: transparent; overflow: hidden; }
.card {
  background: rgba(20, 20, 22, 0.62);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  color: #e8e8ea;
  font: 13px/1.4 system-ui, sans-serif;
  height: 100vh; box-sizing: border-box; padding: 12px;
}
.drag-handle { -webkit-app-region: drag; height: 22px; cursor: move; }
.no-drag, button, input { -webkit-app-region: no-drag; }   /* interactive elements must opt out of drag */
```

`renderer.ts`: render the status line ("Overlay ready"), the active hotkeys, a click-through
indicator, and a tiny live clock or pulsing dot so it's obvious the window is alive and repainting.
The `.drag-handle` is what makes the frameless window movable.

---

## Windows gotchas (consolidated)

- Transparency must be set at **creation** (`transparent: true` + `backgroundColor: '#00000000'`).
  It cannot be toggled at runtime. Avoid `resizable: true` on a transparent window.
- `setContentProtection(true)` needs **Win10 2004 / build 19041+** for true exclusion; older builds
  go black-in-capture. State the OS build in the README.
- Native build tools: if `npm install` fails with `node-gyp` / MSVC errors, install the C++ build
  tools: `winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`.
- If the build fails with a **symlink privilege error**, enable Windows Developer Mode or run the
  build from an elevated terminal.
- If the window still shows in **Alt+Tab** despite `skipTaskbar: true`, note it — fully removing it
  may need a native tool-window flag, but `skipTaskbar` is sufficient in most cases.

---

## Verification protocol (run all before calling Phase 0 done)

1. `npm run dev` → translucent panel top-right, on top of a maximized browser window.
2. Toggle hotkey hides/shows; re-show is in the same spot; **type in your editor while toggling —
   focus must never move to the overlay.**
3. Start a Zoom/Teams/Meet call (or OBS Display Capture), **share the full screen**, and inspect
   the shared output from a second device or the meeting self-preview → overlay is **absent**
   (or black on pre-2004 Windows).
4. Windows taskbar shows **no icon**; Alt+Tab ideally does not list it.
5. Click-through hotkey → click "through" the panel onto the app beneath; toggle back → panel
   intercepts clicks again.
6. `npm run build:win` → portable `.exe` in `dist/`; double-click runs standalone.

---

## Out of scope for Phase 0 (do not build yet)

No audio capture, no STT, no screenshots, no LLM/router, no settings UI, no React, no multi-window,
no persistence beyond in-memory window bounds. Just the stealth shell + hotkeys + portable build.

## Forward-compat notes

- `config.ts` will grow model lists and prompt presets in later phases — structure it for that now.
- Phase 1 (audio) and Phase 2 (STT) attach to this shell; keep the `main`/`preload`/`renderer`
  boundary and the typed contextBridge API clean so they extend cleanly.
- Remember the **`focusable` switch** when Phase 5 introduces a chat input.
