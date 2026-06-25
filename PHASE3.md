# Phase 3 — Screenshot Capture

**Build spec for Claude Code.** Add on-demand **screen capture** to the overlay (`d:\Cluely\overlay\`):
a hotkey/button grabs the screen, the **overlay excludes itself from its own shot**, and the image
is downscaled, JPEG-encoded, and held in an in-memory store with a per-image include toggle. **No
OCR, no LLM this phase** — the model reads images directly in Phase 4. The output is a small set of
LLM-ready screenshots the router will pull from.

Target OS: **Windows 10/11 (x64)**. Builds on the existing `main`/`preload`/`renderer` structure,
the `window.*` contextBridge pattern, the Phase 0 `setContentProtection(true)`, and `config.ts`.

---

## Definition of done (acceptance criteria)

1. A screenshot **hotkey** (and a UI button) captures the current screen; a **thumbnail** appears in
   a strip in the overlay.
2. The captured image shows the real screen content **with the overlay absent** from it.
3. Capture is **crisp on HiDPI / scaled displays** (e.g., 150% scaling) — not blurry/downscaled.
4. Each thumbnail has **remove** and **include/exclude** controls; toggling updates the store.
5. Stored images are **JPEG, reasonably sized** (not multi-MB 4K PNGs), and downscaled for LLM use.
6. Pure Electron — **no new native dependencies**; still packages to a working portable `.exe`.
7. On multi-monitor, capture targets the intended display (default: primary).

---

## Key architectural decisions (do not deviate)

1. **Capture via `desktopCapturer.getSources` in the main process** with `thumbnailSize` set to the
   display's **physical** pixel size. The returned `thumbnail` (a `NativeImage`) *is* the
   full-resolution screenshot. No native modules, consistent with the no-`node-gyp` philosophy.
   `desktopCapturer` is **main-process only** in current Electron — do not call it from the renderer.

2. **Self-exclusion via the existing content-protection, verified, with a hide/show fallback.** The
   overlay already has `setContentProtection(true)` (Phase 0 → `WDA_EXCLUDEFROMCAPTURE`), which on
   Win10 2004+ should keep it out of the `desktopCapturer` grab too — meaning **no flicker**.
   Verify this. If on some build it still appears, fall back to `win.hide()` → capture →
   `win.showInactive()` behind a config flag (`hideBeforeCapture`, default `false`).

3. **Downscale + JPEG for LLM-readiness at capture time.** Vision models downsample large images
   anyway, so cap the long edge at ~**1568 px** and encode **JPEG ~80** before storing. Sending 4K
   PNGs just wastes upload and tokens. Keep a separate tiny (~200 px) thumbnail for the UI strip.

4. **Store in an in-memory screenshot context store the router reads.** Hold
   `{ id, jpeg, tStart, included }[]` in main; expose an `includedShots()` accessor. Phase 4's
   **thinking** mode pulls the included images. Per-image include toggle mirrors the per-screenshot
   control pattern.

---

## Dependencies

None new — `desktopCapturer`, `nativeImage`, and `screen` are built into Electron.

---

## Project structure additions

```
src/
  main/
    screenshot.ts       # NEW: capture (desktopCapturer→NativeImage→resize→JPEG), store, IPC, includedShots()
    shortcuts.ts        # EXTEND: register the screenshot hotkey
    config.ts           # EXTEND: SCREENSHOT block (hotkey, maxLongEdge, jpegQuality, captureMode, hideBeforeCapture)
    index.ts            # EXTEND: init screenshot module in whenReady
  preload/
    index.ts            # EXTEND: expose window.shot (capture, list, remove, toggleInclude, thumb, onCaptured)
    shot.d.ts           # NEW: types for window.shot + Shot meta shape
  renderer/
    screenshots/
      strip.ts          # NEW: thumbnail strip with remove + include toggle, optional larger preview
    index.html          # EXTEND: thumbnail strip container
    style.css           # EXTEND: strip + thumbnail styling
    renderer.ts         # EXTEND: wire window.shot.onCaptured → refresh strip
```

---

## Implementation details

### `src/main/screenshot.ts` — capture + store

```ts
import { desktopCapturer, screen, ipcMain, BrowserWindow } from 'electron'
import crypto from 'node:crypto'
import { SCREENSHOT } from './config'

type Shot = { id: string; jpeg: string; tStart: number; included: boolean }  // jpeg = base64
const shots: Shot[] = []
export function includedShots() { return shots.filter(s => s.included) }      // Phase 4 reads this

async function grab(): Promise<string> {            // returns base64 JPEG, overlay-excluded, downscaled
  const display = pickDisplay()                     // primary | under-cursor | overlay's display
  const sf = display.scaleFactor
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {                                // PHYSICAL px → crisp on scaled displays
      width: Math.round(display.size.width * sf),
      height: Math.round(display.size.height * sf),
    },
  })
  const src = sources.find(s => s.display_id === String(display.id)) ?? sources[0]
  let img = src.thumbnail                            // NativeImage = full-res screenshot (overlay excluded by content-protection)

  const { width, height } = img.getSize()            // downscale for LLM
  const long = Math.max(width, height)
  if (long > SCREENSHOT.maxLongEdge) {
    const k = SCREENSHOT.maxLongEdge / long
    img = img.resize({ width: Math.round(width * k), height: Math.round(height * k) })
  }
  return img.toJPEG(SCREENSHOT.jpegQuality).toString('base64')
}

export async function capture(win: BrowserWindow) {
  if (SCREENSHOT.hideBeforeCapture) { win.hide(); await wait(60) }   // fallback only; default false (no flicker)
  const jpeg = await grab()
  if (SCREENSHOT.hideBeforeCapture) win.showInactive()
  const shot: Shot = { id: crypto.randomUUID(), jpeg, tStart: Date.now(), included: true }
  shots.push(shot)
  win.webContents.send('shot:captured', { id: shot.id, tStart: shot.tStart })
}

ipcMain.handle('shot:list',    () => shots.map(s => ({ id: s.id, tStart: s.tStart, included: s.included })))
ipcMain.handle('shot:remove',  (_e, id: string) => { const i = shots.findIndex(s => s.id === id); if (i >= 0) shots.splice(i, 1) })
ipcMain.handle('shot:toggle',  (_e, id: string) => { const s = shots.find(x => x.id === id); if (s) s.included = !s.included })
ipcMain.handle('shot:thumb',   (_e, id: string) => makeSmallDataUrl(shots.find(s => s.id === id)))  // ~200px for the strip
```

`pickDisplay()`: per `SCREENSHOT.captureMode` — `'primary'` → `screen.getPrimaryDisplay()`;
`'cursor'` → `screen.getDisplayNearestPoint(screen.getCursorScreenPoint())`; `'overlay'` →
`screen.getDisplayMatching(win.getBounds())`.

### `src/main/shortcuts.ts` — capture hotkey

Add to the existing `globalShortcut` registrations:
```ts
globalShortcut.register(SCREENSHOT.hotkey, () => capture(win))   // default 'Control+Shift+S'
```

### `src/main/config.ts` — SCREENSHOT block

```ts
export const SCREENSHOT = {
  hotkey: 'Control+Shift+S',
  maxLongEdge: 1568,          // downscale target for vision models
  jpegQuality: 80,
  captureMode: 'primary',     // 'primary' | 'cursor' | 'overlay'
  hideBeforeCapture: false,   // content-protection self-excludes the overlay; enable only if it still appears
}
```

### `src/preload` + renderer

Expose `window.shot`: `capture()` (→ `ipcRenderer.invoke('shot:capture')` if you also want a UI
button path, or just trigger via hotkey in main), `list()`, `remove(id)`, `toggleInclude(id)`,
`thumb(id)`, and `onCaptured(cb)`. Type in `shot.d.ts`.

`renderer/screenshots/strip.ts`: on `onCaptured`, call `list()` + `thumb(id)` and render a strip of
thumbnails; each thumbnail has a remove (×) and an include checkbox bound to `toggleInclude`.
Optionally click to show a larger preview. Interactive controls need `-webkit-app-region: no-drag`.

---

## Windows / Electron gotchas (consolidated)

- **`desktopCapturer` is main-process only.** Calling it from the renderer silently fails in current
  Electron — keep all capture in `screenshot.ts`.
- **`thumbnailSize` must be physical pixels** (`display.size × scaleFactor`). Passing logical size on
  a 150%-scaled display yields a blurry, downscaled capture. This is the #1 screenshot-quality bug.
- **Verify content-protection self-excludes the overlay** from the `desktopCapturer` thumbnail (it
  should on Win10 2004+). If the overlay shows up in its own shot, set `hideBeforeCapture: true` and
  accept the brief flicker.
- **JPEG, not PNG, and downscale.** A full-res 4K PNG is many MB; JPEG@80 capped at ~1568 px long
  edge is small and matches what vision models ingest. Don't store the raw PNG for the LLM path.
- **`getSources` has latency** (it enumerates screens/windows) — capture is async/on-demand; never
  poll it in a loop.
- **Multi-monitor:** match `display_id` to the chosen display, or you'll capture the wrong screen.
- **Don't send full base64 over IPC for the UI** — return only `{id, tStart}` on capture and a small
  ~200 px dataURL for the thumbnail; keep the ~1568 px JPEG in the main-process store for the LLM.

---

## Verification protocol (run all before Phase 3 is done)

1. Open an IDE/document, press the screenshot hotkey → a thumbnail appears in the strip; opening it
   shows your real screen content.
2. Inspect the captured image → the **overlay is not in it**.
3. On a scaled display (e.g., 150%), the capture is **sharp**, not soft/downscaled.
4. Capture several, then **remove** one and **toggle include** on another → `list()` reflects both.
5. Multi-monitor: with `captureMode` set appropriately, the intended display is captured.
6. Check stored JPEG size is sane (hundreds of KB, not many MB).
7. `npm run build:win` → screenshots work in the portable `.exe`.

---

## Out of scope for Phase 3 (do not build yet)

No OCR (the multimodal model reads the image in Phase 4), no region/window-specific capture, no
annotation/markup, no LLM, no auto-capture-on-event, no disk persistence. Just on-demand capture +
an in-memory, togg-able, LLM-ready screenshot store + a thumbnail strip.

## Forward-compat notes

- Phase 4 **thinking** mode pulls `includedShots()` (base64 JPEGs) alongside the transcript window
  and sends both to a multimodal model (Gemini/Claude/GPT). Keep the `Shot` shape and
  `includedShots()` accessor stable.
- The per-image **include toggle** lets you curate exactly which screens the model sees — keep it.
- Capture stays decoupled from *what consumes* the images, so wiring the store into the router in
  Phase 4 is a read-only addition.
