# Phase 5 — Typed Input, Settings & Finish

**Build spec for Claude Code.** Complete the overlay (`d:\Cluely\overlay\`): add a **typed-question
input** (the deferred `focusable` flip), a **settings UI** (keys, per-mode models incl. a local
Ollama option, editable prompts), **idle STT-model unload**, **clear/save**, **state persistence**,
and **final packaging**. After this phase the app is feature-complete for personal use.

Target OS: **Windows 10/11 (x64)**. Builds on the full existing stack — the Phase 0 stealth window
(with its `// PHASE 5: revisit focusable` marker), the Phase 4 router (`run(mode, { userQuery })`,
already accepts a query), `keys.ts` (safeStorage), `context.ts`, and `config.ts`.

---

## Definition of done (acceptance criteria)

1. An **Ask** hotkey focuses the overlay with the cursor in a text input; typing a question and
   pressing Enter streams a response (using the query **plus** transcript/screenshot context).
2. **Esc** (or submit) returns focus to the previously-active app — the overlay stops capturing
   keystrokes; your IDE/call regains focus.
3. The **passive Phase 4 triggers still work** (`Ctrl+Enter` fast / `Ctrl+Shift+Enter` thinking)
   **without** stealing focus, exactly as before.
4. A **settings panel** lets you paste/save API keys (encrypted), pick the model per mode (including
   a **local Ollama** provider), and edit the fast/thinking prompts — applied **without restart**.
5. **Idle STT unload** frees the model's RAM when capture is off/idle and reloads on demand.
6. **Clear** resets transcript, responses, and screenshots; window **reopens at its last position**.
7. The overlay (input + settings included) stays **invisible in screen-share** and **off the
   taskbar**; final `npm run build:win` produces a named, icon'd portable `.exe` that works
   end-to-end.

---

## Key architectural decisions (do not deviate)

1. **`focusable: true` + focus-on-demand.** Flip the Phase 0 flag, but keep the passive behavior:
   the overlay still **appears via `showInactive()`** (no focus steal on show), and only **grabs
   focus when explicitly summoned** by the Ask hotkey or a click into the input. On submit/Esc it
   **releases focus** (`win.blur()` returns focus to the prior window on Windows). The honest
   trade-off: while you're typing a question, focus is on the overlay — acceptable because you're
   actively interacting with it. The passive suggestion triggers never focus.

2. **Settings persist to `userData`; keys stay encrypted.** Reuse `keys.ts`/`safeStorage` for keys;
   store the rest (model choices, prompts, toggles, window bounds) as JSON in `app.getPath('userData')`.
   On save, **hot-reload** config (re-resolve providers, swap prompts) — no app restart.

3. **Local Ollama is just another provider.** Because Phase 4 unified on OpenAI-compatible
   endpoints, adding local inference is a config entry: `baseURL: 'http://localhost:11434/v1'`,
   a model field (e.g. `qwen3:4b`). Selectable in settings; participates in the same failover.

4. **Idle unload by killing the STT worker.** The cleanest way to reclaim the ~1–1.5GB the model
   holds is to `stopStt()` (kill the utilityProcess) on idle and `startStt()` on next capture.
   Tie to a toggle + idle timer; show a "loading model…" state on reload.

---

## Project structure additions

```
src/
  main/
    settings.ts         # NEW: load/save settings JSON (userData) + key encryption bridge + hot-reload
    window.ts           # EDIT: focusable:true; helpers focusForInput() / releaseFocus()
    shortcuts.ts        # EXTEND: "Ask" hotkey (focus input); keep fast/thinking triggers
    stt.ts              # EXTEND: idle-unload timer + unload/reload (kill/refork worker)
    context.ts          # EXTEND: clear()
    screenshot.ts       # EXTEND: clear()
    llm/keys.ts         # EXTEND: saveFromUi() — encrypt + persist keys entered in settings
    llm/providers.ts    # EXTEND: add Ollama provider; re-resolve on settings change
    index.ts            # EXTEND: load settings on boot; wire settings IPC; restore window bounds
    config.ts           # EXTEND: defaults for new toggles; mark which values are user-overridable
  preload/
    index.ts            # EXTEND: window.input (onFocus, submit), window.settings (get/save), window.overlay.releaseFocus
    settings.d.ts       # NEW: types
  renderer/
    input/box.ts        # NEW: ask input — Enter submits to run(mode,{userQuery}), Esc releases focus
    settings/panel.ts   # NEW: settings form (keys, per-mode model, prompts, toggles)
    index.html          # EXTEND: input box, mode selector, settings button/panel
    style.css           # EXTEND: input + settings styling
    renderer.ts         # EXTEND: wire input + settings + clear
build/
  icon.ico              # NEW: app icon for packaging
```

---

## Implementation details

### `window.ts` — the focusable flip

```ts
// BEFORE: focusable: false,  // PHASE 5: revisit
focusable: true,              // Phase 5: input box needs keyboard focus
// KEEP appearing without stealing focus:
//   show the window with win.showInactive() everywhere it's shown (unchanged from Phase 0)
```
Add helpers:
```ts
export function focusForInput(win) { win.show(); win.focus(); win.webContents.send('input:focus') }
export function releaseFocus(win)  { win.blur() }   // Windows returns focus to the prior window
```
**Verify** after the flip that the window still does **not** appear in Alt+Tab (`skipTaskbar` should
hold; if it now shows, note the tool-window caveat) and is **still excluded from screen capture**.

### `shortcuts.ts` — Ask hotkey

```ts
globalShortcut.register('Control+Space', () => focusForInput(win))   // summon + focus input
// existing Control+Return (fast) / Control+Shift+Return (thinking) stay — they call run() directly, no focus needed
```

### `renderer/input/box.ts`

```ts
let mode: 'fast'|'thinking' = 'fast'   // bound to a small toggle next to the input
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (inputEl.value.trim()) window.llm.run(mode, { userQuery: inputEl.value.trim() })  // router already takes it
    inputEl.value = ''
  } else if (e.key === 'Escape') {
    window.overlay.releaseFocus()   // → main win.blur(), focus returns to IDE/call
  }
})
window.input.onFocus(() => inputEl.focus())
```

### `settings.ts` (main) + settings UI

```ts
import { app, safeStorage } from 'electron'
import fs from 'node:fs'; import path from 'node:path'
const FILE = path.join(app.getPath('userData'), 'settings.json')

export function loadSettings() { /* read JSON; decrypt key blob via safeStorage */ }
export function saveSettings(s) { /* encrypt keys, write JSON */ ; applyHotReload(s) }
function applyHotReload(s) { /* update CONFIG.LLM models/prompts + re-resolve providers, no restart */ }
```
`settings/panel.ts` renders a form: **API keys** (masked inputs → `window.settings.save`),
**per-mode model** dropdowns/fields (each provider incl. **Ollama (local)** with a model field and
the localhost base URL), **editable fast/thinking prompts** (textareas), and **toggles**: idle STT
unload, `hideBeforeCapture`, capture mode, optional VAD params. Save → encrypt + persist + hot-reload.
All controls need `-webkit-app-region: no-drag`.

### `stt.ts` — idle unload

Add an idle timer: when no audio for N minutes or all sources are off and the toggle is on, call
`stopStt()` (kills the utilityProcess → frees the model RAM). On the next capture start, `startStt()`
and surface a "loading model…" state until the worker reports ready. This is what makes a local 7B
viable alongside the app — free STT's ~1.5GB first.

### Clear / save

`context.clear()` empties the turn buffer; clear the screenshot store; renderer clears transcript +
response panes. Optional: a "save session" that writes transcript + responses (+ screenshots) to a
file for later. Persist window bounds on move/close and restore on boot.

### Packaging finalize

Add `build/icon.ico`, set `productName` + `version` in `electron-builder.yml`; keep the `portable`
target (optionally add an `nsis` installer). Confirm models ship via `extraResources` **or** document
the first-run download — note the portable `.exe` is large (~660MB) if Parakeet is bundled.

---

## Windows / Electron gotchas (consolidated)

- **The overlay can now steal focus** — only let it on the explicit Ask hotkey/click. Keep
  `showInactive()` for every passive show. Verify Esc/submit returns focus to the prior app, and
  re-confirm Alt+Tab exclusion and screen-capture invisibility after the focusable flip.
- **Stealth still applies to the input and settings** — they're in the same content-protected
  window, so they're excluded from capture; verify, don't assume.
- **`safeStorage` requires app-ready** and is per-user (DPAPI) — don't keep plaintext keys after
  encrypting; handle the case where a `keys.secure.json` was written on a different user profile.
- **Hot-reload must re-resolve providers** after a settings save, or model/key changes silently
  won't apply until restart.
- **Idle unload via worker kill**: drain/await any in-flight utterance; reload latency is seconds
  (model load) — show the loading state so it doesn't look hung.
- **Ollama is optional infra**: it must be installed, running, and the model pulled. Treat a
  connection-refused as a normal provider failure that fails over — don't crash if it's absent.
- **Don't regress the passive triggers** when adding the input — `Ctrl+Enter`/`Ctrl+Shift+Enter`
  must keep working focus-free.

---

## Verification protocol (run all before Phase 5 is done)

1. Press the **Ask** hotkey → overlay focuses, cursor in the input; type a question + Enter →
   response streams, clearly using both your typed query and the transcript/screenshot context.
2. **Esc** → focus returns to your IDE (keystrokes go to the editor, not the overlay).
3. `Ctrl+Enter` / `Ctrl+Shift+Enter` still fire **without** focusing the overlay.
4. **Settings:** paste keys + save → encrypted `keys.secure.json`; change a mode's model + edit its
   prompt + save → the **next** query uses the new model/prompt with no restart.
5. Add **Ollama (local)** as a fast provider, pull `qwen3:4b`, **disconnect network** → the local
   provider answers offline.
6. Enable **idle unload**, stop capture/wait → RAM drops (STT worker gone); start capture → reloads
   with a visible loading state.
7. **Clear** → transcript/responses/screenshots reset; move the window, restart → it **reopens at
   the last position**.
8. Screen-share the desktop with the input + settings open → overlay still **absent** from capture;
   **no taskbar icon**; not in Alt+Tab.
9. `npm run build:win` → named, icon'd portable `.exe` runs the full pipeline end-to-end.

---

## Out of scope (genuinely optional, beyond v1)

Auto-trigger on speech-end, searchable conversation history/persistence, a multi-monitor capture
picker, prompt-preset library beyond the editable two, and auto-update. None are needed for a
complete personal tool — add later only if you want them.

## You're done

After Phase 5 the overlay is feature-complete: stealth window, dual-source offline STT, screenshots,
a provider-agnostic router with fast/thinking modes, typed + trigger-based input, settings, local
fallback, and a packaged build. Ship it to yourself.
