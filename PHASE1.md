# Phase 1 — Dual-Source Audio Capture

**Build spec for Claude Code.** Extend the Phase 0 overlay (`d:\Cluely\overlay\`) to capture
**system/speaker audio (loopback)** and the **microphone** simultaneously, resample both to
**16 kHz mono PCM**, and prove they're clean by (a) live per-source level meters in the overlay
and (b) on-demand verification WAV dumps. **No STT, no VAD, no LLM this phase** — the only goal is
two clean, correctly-pitched 16 kHz mono streams.

Target OS: **Windows 10/11 (x64)**. Builds on the existing electron-vite structure, the
`window.overlay` contextBridge pattern, and `config.ts` as the single source of truth.

---

## Definition of done (acceptance criteria)

1. A **System** toggle starts loopback capture; its level meter moves when any audio plays
   (browser, media, a call). A 16 kHz / mono / 16-bit WAV dump plays back **at correct pitch,
   speed, and duration** (no chipmunk / no slow-motion).
2. A **Mic** toggle starts microphone capture; its meter moves when you speak; WAV is clean.
3. **Both run simultaneously**, producing two independent clean streams.
4. Loopback works whether output is **speakers or headphones** (it captures the render-endpoint mix).
5. **No native build tools required** — pure Web Audio path. App still launches; overlay still
   invisible to screen capture; `focusable: false` unchanged.
6. Permission plumbing in place: mic permission granted programmatically, and `getDisplayMedia`
   returns system loopback **without showing a source-picker dialog**.
7. Switching the default playback/recording device mid-session does not crash (detect + log;
   auto-restart is a stretch goal).

---

## Key architectural decision (do not deviate)

System audio is captured via **`getDisplayMedia` with `audio: 'loopback'`**, handled through a
main-process `setDisplayMediaRequestHandler`. All capture + resampling happens in the **renderer**
via the Web Audio API + an AudioWorklet. This keeps everything in the existing runtime — **no
`naudiodon`, no WASAPI native addon, no sidecar process, no `node-gyp`.**

Fallback (only if loopback proves unreliable): a native capture sidecar (C#/NAudio, Rust/wasapi,
or Python/pyaudiowpatch) emitting PCM over local IPC. Do **not** build this unless Phase 1
verification fails on the Web Audio path.

---

## Dependencies

Ideally none beyond the existing tree. For WAV writing, either hand-roll a 44-byte RIFF/WAVE
header (trivial) or add **`wavefile`**. No other new deps.

---

## Project structure additions

```
src/
  main/
    audio.ts            # NEW: display-media + permission handlers, IPC for PCM, WAV writer
    config.ts           # EXTEND: TARGET_SAMPLE_RATE=16000, CHUNK_MS, DEBUG_WAV_DIR, default toggles
    index.ts            # EXTEND: call audio setup in whenReady
  preload/
    index.ts            # EXTEND: expose window.audio (start/stop/onState/pushPcm)
    audio.d.ts          # NEW: types for window.audio
  renderer/
    audio/
      capture.ts        # NEW: getUserMedia + getDisplayMedia, AudioContext@16k, worklet + meter wiring
      meter.ts          # NEW: AnalyserNode → RMS → bar animation
    renderer.ts         # EXTEND: wire toggles, meters, debug-record button
    index.html          # EXTEND: System/Mic/Both toggles, two meters, "Record 10s" buttons
    style.css           # EXTEND: meter + toggle styles
  public/
    pcm-worklet.js      # NEW: AudioWorkletProcessor (plain JS, standalone — see bundling note)
```

Keep new audio settings in `config.ts` alongside the Phase 0 hotkeys/geometry.

---

## Implementation details

### `src/main/audio.ts` — permissions, loopback source, WAV writer

Register both handlers on `session.defaultSession` during `whenReady` (before the window loads):

```ts
import { session, desktopCapturer, ipcMain } from 'electron'

// 1) Allow the renderer's microphone request
session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
  cb(permission === 'media')
})

// 2) Feed getDisplayMedia a screen source + request full system loopback audio, no picker UI
session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] })
  cb({ video: sources[0], audio: 'loopback' })   // 'loopback' = system output mix on Windows
}, { useSystemPicker: false })                    // omit this 2nd arg if your Electron version lacks it
```

- `audio: 'loopback'` captures the system mix while you still hear it. Do **not** use
  `'loopbackWithMute'` (that silences local playback — you'd stop hearing the call).
- A video source is required by the handler; the renderer stops the video track immediately and
  keeps only the audio track.

IPC + WAV: the renderer converts to Int16 and pushes chunks; main appends per source and writes a
canonical WAV on stop.

```ts
const buffers: Record<'system'|'mic', number[]> = { system: [], mic: [] }

ipcMain.on('audio:pcm', (_e, source: 'system'|'mic', chunk: ArrayBuffer) => {
  buffers[source].push(...new Int16Array(chunk))     // for debug only; use Buffer concat for volume
})

ipcMain.handle('audio:dump-wav', (_e, source: 'system'|'mic') => {
  // write 44-byte RIFF/WAVE header: PCM(1), channels=1, sampleRate=16000, bits=16, + Int16 data
  // → d:\Cluely\overlay\.audio_debug\<source>-<timestamp>.wav   (use `wavefile` or hand-roll)
})
```

### `src/renderer/audio/capture.ts` — the capture pipeline

Force the AudioContext to 16 kHz so Chromium does the resampling for you; downmix to mono in the
worklet; convert to Int16 and coalesce to ~100 ms before IPC.

```ts
const TARGET_RATE = 16000

async function capture(stream: MediaStream, source: 'system'|'mic') {
  const ctx = new AudioContext({ sampleRate: TARGET_RATE })            // forces 16k resample
  await ctx.audioWorklet.addModule(new URL('pcm-worklet.js', document.baseURI).href)  // see bundling note
  const src = ctx.createMediaStreamSource(stream)

  attachMeter(ctx, src, source)                                        // AnalyserNode tap (meter.ts)

  const node = new AudioWorkletNode(ctx, 'pcm-mono', { numberOfOutputs: 0 })
  let acc: number[] = []                                               // coalesce ~100ms (1600 samples)
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    for (const v of e.data) acc.push(v)
    if (acc.length >= 1600) {
      const i16 = floatToInt16(Float32Array.from(acc)); acc = []
      window.audio.pushPcm(source, i16.buffer)                         // → ipcRenderer.send('audio:pcm', ...)
    }
  }
  src.connect(node)
  return () => { ctx.close(); stream.getTracks().forEach(t => t.stop()) }
}

// mic — disable AEC/NS/AGC so STT (Phase 2) gets raw audio
const mic = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
})

// system loopback — request video to satisfy the handler, then drop it
const sys = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
sys.getVideoTracks().forEach(t => t.stop())
```

Trigger capture from the UI **toggle click** (also satisfies any user-gesture requirement). Click-
through must be OFF to press the toggles.

```ts
function floatToInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}
```

### `public/pcm-worklet.js` — mono downmix (plain JS, standalone)

```js
class PcmMono extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const frames = input[0].length, ch = input.length
    const mono = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      let s = 0
      for (let c = 0; c < ch; c++) s += input[c][i]
      mono[i] = s / ch
    }
    this.port.postMessage(mono)
    return true
  }
}
registerProcessor('pcm-mono', PcmMono)
```

**Vite/AudioWorklet bundling — the #1 Phase-1 trap:** the worklet runs in a separate
`AudioWorkletGlobalScope`, so it must be a **standalone plain-`.js` file**, not a TS module you
`import`. Keep it in `public/` (served at the renderer root in dev, copied to output on build) and
load it by URL via `addModule(new URL('pcm-worklet.js', document.baseURI).href)`. Do **not** try to
`import './pcm-worklet.ts'` — Vite won't bundle it correctly and `registerProcessor` will be
undefined at runtime. Verify the URL resolves in both `npm run dev` and the packaged `.exe`.

### `src/preload/index.ts` — extend the bridge

Add a `window.audio` namespace (keep `window.overlay` as-is):
`start(source)`, `stop(source)`, `dumpWav(source)`, `onState(cb)`, and `pushPcm(source, buffer)`
(→ `ipcRenderer.send('audio:pcm', source, buffer)`). Type it in `audio.d.ts`.

### UI additions

Three toggles (**System / Mic / Both**), two horizontal **level meters**, and a **"Record 10 s"**
debug button per source that calls `audio.dumpWav(...)`. Meters animate from `meter.ts` (AnalyserNode
→ `getFloatTimeDomainData` → RMS → bar width in a `requestAnimationFrame` loop). All interactive
elements need `-webkit-app-region: no-drag`.

---

## Windows gotchas (consolidated)

- **Sample-rate mismatch is the classic bug** → chipmunk (too fast) or slow-motion audio. Forcing
  `new AudioContext({ sampleRate: 16000 })` makes Chromium resample correctly. **If the WAV pitch/
  speed is wrong**, the rate wasn't honored — fall back to capturing at the device's native rate
  (e.g. 48 kHz) and downsample to 16 kHz in the worklet (linear interpolation / decimation). Always
  verify a dumped WAV by ear before declaring done.
- **`getDisplayMedia` rejects without the main-process handler.** The `setDisplayMediaRequestHandler`
  returning `audio: 'loopback'` is mandatory.
- **Mic needs two grants:** the Electron `setPermissionRequestHandler` (above) **and** the Windows OS
  setting (Settings → Privacy & security → Microphone → "Let desktop apps access your microphone").
  Note this in the README; a silent mic meter usually means the OS toggle is off.
- **AudioWorklet must be standalone JS in `public/`** — see the bundling note above.
- **Disable `echoCancellation` / `noiseSuppression` / `autoGainControl`** on the mic so Phase 2 STT
  gets unprocessed audio (AEC would also try to cancel the loopback you're capturing).
- **IPC volume:** posting raw worklet frames per 128-sample quantum floods IPC. Coalesce to ~100 ms
  and convert to Int16 in the renderer (halves payload) before `pushPcm`.

---

## Verification protocol (run all before Phase 1 is done)

1. `npm run dev`. Enable **System**; play any audio → its meter moves. Click **Record 10 s** →
   open the WAV from `.audio_debug\` → it plays back clean at correct pitch/speed/length.
2. Enable **Mic**; speak → meter moves; dump WAV → clean.
3. Enable **Both** at once → two independent clean WAVs; meters move independently.
4. Switch output to **headphones**, repeat step 1 → loopback still captures.
5. Confirm overlay is **still invisible** in a Zoom/OBS screen-share while capturing, and the app
   needed **no `node-gyp`/native build** to run.
6. Change the default mic/output device mid-capture → app logs the change, does not crash.

---

## Out of scope for Phase 1 (do not build yet)

No STT, no VAD, no transcription, no diarization beyond the static System-vs-Mic source label, no
LLM, no persistence of audio beyond the debug WAVs. Just two clean 16 kHz mono PCM streams + meters
+ verification dumps.

## Forward-compat notes

- Phase 2 (STT) consumes the **same per-source Float32/Int16 mono frames** — keep the worklet→
  capture.ts→IPC frame interface clean and stable; Phase 2 will tee these frames into the STT engine
  (sherpa-onnx Parakeet) and a VAD instead of (or alongside) the WAV writer.
- The System-vs-Mic labeling established here becomes the "them vs you" speaker attribution later.
- Keep `audio.ts` provider-agnostic about *what* consumes the PCM, so swapping the WAV-dump sink for
  the STT sink in Phase 2 is a one-point change.
