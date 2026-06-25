# Phase 2 — Local Live Transcription (VAD + Offline STT)

**Build spec for Claude Code.** Wire the Phase 1 dual-source PCM (`d:\Cluely\overlay\`) into
**local, offline speech-to-text** and render a **live, source-labeled transcript** in the overlay.
System audio → "Them", microphone → "You". Everything runs on-device — **no cloud STT, no LLM this
phase.** The output of this phase is a clean, timestamped, labeled transcript stream that Phase 4
will feed to the model router.

Target OS: **Windows 10/11 (x64)**. Builds on the existing `main`/`preload`/`renderer` structure,
the `window.*` contextBridge pattern, the IPC `audio:pcm` stream, and `config.ts` as the single
source of truth.

---

## Definition of done (acceptance criteria)

1. With **System** capture on, speech playing through the output (a video call, a YouTube clip) is
   transcribed and appears in the transcript pane labeled **Them**, within ~1–2 s of a pause.
2. With **Mic** on, your speech is transcribed and labeled **You**.
3. **Both at once** produce two independent, correctly-attributed transcript streams.
4. Transcription is **fully offline** — disconnect the network and it still works.
5. STT inference runs **off the main thread**; the overlay stays responsive (drag, toggles, hotkeys
   never freeze) while transcribing.
6. The app still launches and still packages to a working portable `.exe` with models resolved
   correctly in production.
7. Switching the active capture device mid-session does not crash the STT pipeline.

---

## Key architectural decisions (do not deviate)

1. **STT lives in an Electron `utilityProcess`** forked from `main`. Audio inference is CPU-heavy;
   running it on the main process would jank the overlay. `main/audio.ts` tees each `audio:pcm`
   chunk to this worker via `postMessage` (transfer the ArrayBuffer); the worker posts transcripts
   back; `main` forwards them to the renderer. Crash-isolated and off the event loop.

2. **Silero VAD + offline recognizer, one pipeline per source.** Parakeet (and Whisper, Moonshine,
   SenseVoice) in sherpa-onnx are **non-streaming**; the live pattern is: VAD segments speech →
   each completed utterance is decoded when the speaker pauses. Run **two** independent
   {VAD + recognizer} pipelines (system, mic) inside the worker, each tagging output with its label.
   Follow the canonical example `nodejs-addon-examples/test_vad_asr_non_streaming_parakeet_microphone.js`
   for the exact current API — but **adapt it to consume the Phase 1 PCM frames; do NOT add
   `node-cpal`** (the examples use it to capture the mic; you already have the audio).

3. **Native addon primary, WASM fallback.** Use the native `sherpa-onnx` addon for speed. If the
   Electron native-addon packaging proves painful, the **same package has a WASM build** with a
   near-identical API and zero native-binary/ABI concerns — switch to it with a smaller model
   (Moonshine/SenseVoice) at some speed cost. Decide based on whether packaging fights you.

---

## Dependencies

- `npm i sherpa-onnx` (provides both the native addon and WASM paths).
- **Model files** (downloaded once, not via npm) — see Models below.
- `electron-builder.yml`: **`asarUnpack`** the package so the native `.node` + onnxruntime DLLs are
  real files on disk, and **`extraResources`** (or a first-run download) for the model directory.
- Do **not** add `node-cpal`.

---

## Models (pick in `config.ts`; download the `.onnx` set once)

All run per-utterance after VAD, so even a 0.6 B model gives acceptable latency.

| Model | Role | Language | Notes |
|---|---|---|---|
| **Parakeet TDT 0.6b v2 int8** | **Default** | English | Transducer: encoder/decoder/joiner `.int8.onnx`; fast + accurate |
| **Whisper** (small/medium) | Multilingual / Hindi fallback | 99+ langs | Slower, hallucinates on silence — VAD mitigates |
| **Moonshine tiny en (quantized)** | Minimal footprint | English | Available as a quantized Node example model |
| **SenseVoice int8** | Fast multilingual | zh/en/ja/ko/yue | Multilingual int8 — option if you want non-English speed |

Newer multilingual options also exist if you need broader coverage — Qwen3-ASR 0.6B int8 and a Cohere 14-language transcribe model are in the Node examples. Prefer **int8** builds to cut size and CPU. For Indian-language meetings, use Whisper (or verify Hindi is in the Qwen3/Cohere language list).

> Streaming alternative: if you later want live word-by-word partials instead of per-utterance
> finals, sherpa-onnx also has streaming zipformer transducers and newer multilingual streaming ASR. Keep VAD+offline for now — it's more accurate and simpler for dual-source.

---

## Project structure additions

```
src/
  main/
    stt.ts              # NEW: fork the utilityProcess, route PCM in, receive transcripts, push to renderer
    stt-worker.ts       # NEW: utilityProcess entry — per-source {Silero VAD + offline recognizer}
    audio.ts            # EXTEND: tee each audio:pcm chunk to stt.ts (the one-point change from Phase 1)
    config.ts           # EXTEND: STT block — model type/paths, VAD params, threads, provider
    index.ts            # EXTEND: start STT in whenReady; forward transcripts to the window
  preload/
    index.ts            # EXTEND: expose window.stt (onTranscript, onSpeaking, clear)
    stt.d.ts            # NEW: types for window.stt + the Transcript shape
  renderer/
    transcript/
      panel.ts          # NEW: render labeled, scrolling, timestamped transcript
    index.html          # EXTEND: transcript pane + per-source color/labels (Them / You)
    style.css           # EXTEND: transcript styling
    renderer.ts         # EXTEND: wire window.stt.onTranscript → panel
models/                 # NEW: downloaded .onnx model dirs (gitignored; shipped via extraResources)
```

---

## Implementation details

### `src/main/stt.ts` — worker lifecycle + routing

```ts
import { utilityProcess } from 'electron'
import path from 'node:path'

type Transcript = { source: 'system'|'mic'; text: string; tStart: number; tEnd: number; final: boolean }

let worker: Electron.UtilityProcess | null = null

export function startStt(onTranscript: (t: Transcript) => void) {
  worker = utilityProcess.fork(path.join(__dirname, 'stt-worker.js'))
  worker.on('message', (m: Transcript) => onTranscript(m))
}

// called by audio.ts for every audio:pcm chunk (Int16, 16k mono, ~100ms)
export function feedPcm(source: 'system'|'mic', int16: ArrayBuffer) {
  worker?.postMessage({ type: 'pcm', source, int16 }, [int16])   // transfer, don't copy
}

export function stopStt() { worker?.kill(); worker = null }
```

In `audio.ts`, in the existing `ipcMain.on('audio:pcm', ...)` handler, add a single call to
`feedPcm(source, chunk)`. Keep the WAV-debug sink available behind a flag.

### `src/main/stt-worker.ts` — the per-source pipeline (utilityProcess)

**Mirror the current `test_vad_asr_non_streaming_parakeet_microphone.js` for exact API names**
(`Vad`/`VoiceActivityDetector`, recognizer construction, `getResult`, etc. differ between the addon
and WASM builds and across versions — follow the example, not the sketch below). The contract is:
per-source {VAD + offline recognizer}, convert incoming Int16 → Float32, feed VAD, decode each
completed segment, post the result up.

```js
const sherpa = require('sherpa-onnx')

function makePipeline(cfg) {
  const recognizer = new sherpa.OfflineRecognizer(/* cfg.model: Parakeet transducer paths, numThreads, provider */)
  const vad = new sherpa.Vad(/* sileroVad: { model, threshold, minSilenceDuration, minSpeechDuration, maxSpeechDuration }, sampleRate: 16000 */)
  return { recognizer, vad }
}
const pipes = { system: makePipeline(CFG), mic: makePipeline(CFG) }

process.parentPort.on('message', (e) => {
  const { source, int16 } = e.data
  const f32 = int16ToFloat32(new Int16Array(int16))   // i / 32768
  const { vad, recognizer } = pipes[source]
  vad.acceptWaveform(f32)
  while (!vad.isEmpty()) {
    const seg = vad.front()
    const stream = recognizer.createStream()
    stream.acceptWaveform({ samples: seg.samples, sampleRate: 16000 })
    recognizer.decode(stream)
    const text = recognizer.getResult(stream).text.trim()
    if (text) process.parentPort.postMessage({ source, text, final: true, tStart: Date.now(), tEnd: Date.now() })
    vad.pop()
  }
})

function int16ToFloat32(i16) { const f = new Float32Array(i16.length); for (let i=0;i<i16.length;i++) f[i]=i16[i]/32768; return f }
```

Optional, emit a lightweight `onSpeaking` signal (VAD active) so the UI can show a "…" while an
utterance is in progress before its final text lands.

### `src/main/config.ts` — STT block

```ts
export const STT = {
  provider: 'cpu',           // 'cpu' | 'cuda' if you have NVIDIA + the CUDA onnxruntime build
  numThreads: 2,
  model: { type: 'parakeet', dir: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8' },  // resolved vs models/
  vad: { threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25, maxSpeechDuration: 20 },
}
```

Resolve model paths: **dev** → `./models/...`; **prod** → `path.join(process.resourcesPath, 'models', ...)`.

### `src/preload` + renderer

Expose `window.stt.onTranscript(cb)` (and optional `onSpeaking`, `clear`), typed in `stt.d.ts`.
The renderer `transcript/panel.ts` keeps an ordered list of `{source, text, tStart}` and renders a
scrolling pane with **Them** (one color) and **You** (another) lanes/labels + relative timestamps.
Keep this list as the canonical transcript store — Phase 4 reads from it. Interactive elements need
`-webkit-app-region: no-drag`.

---

## VAD tuning (these knobs decide latency vs. fragmentation)

- `threshold` (default `0.5`): lower → catches quieter speech but more false positives. Dropping it toward 0.2 can recover quiet words the default misses.
- `minSilenceDuration` (~`0.5` s): how long a pause ends an utterance. Lower = snappier finals,
  more fragmentation; higher = fewer, longer segments with more latency.
- `maxSpeechDuration`: **raise the default** so long sentences aren't chopped mid-thought — going from ~5 s to ~20 s fixes truncated transcripts.
- `minSpeechDuration` (~`0.25` s): filters blips/clicks.

Expose all four in `config.ts`; tune by watching the live transcript.

---

## Windows / Electron gotchas (consolidated)

- **Native addon packaging is the #1 trap.** The `.node` and its onnxruntime `.dll`s must be
  unpacked from asar and co-located: `asarUnpack: ["**/node_modules/sherpa-onnx/**"]` in
  `electron-builder.yml`. If the addon still fails to load in the packaged build, switch to the
  **WASM** build of the same package (no native binaries to unpack).
- **Do NOT add `node-cpal`.** Feed the Phase 1 PCM. Re-capturing would double audio and conflict
  with the existing capture path.
- **Int16 → Float32 scaling.** sherpa wants normalized Float32 `[-1,1]`; divide Int16 by 32768.
  Wrong scaling = silence or garbage transcripts.
- **Model path resolution differs dev vs prod** — use `process.resourcesPath` in the packaged app;
  a "model not found" crash on the `.exe` but not in dev is this.
- **First-load latency:** constructing the recognizer loads hundreds of MB; do it once at worker
  start, not per utterance, and show a "loading model…" state.
- **Inference must stay off main** — that's the whole point of the `utilityProcess`; don't be
  tempted to load sherpa in `main` directly.
- **Model size in the `.exe`:** bundling Parakeet via `extraResources` bloats the portable exe by
  hundreds of MB. For personal use that's fine; otherwise download-on-first-run into `userData`.

---

## Verification protocol (run all before Phase 2 is done)

1. `npm run dev`. Enable **System**, play a clip with clear speech → transcript appears under
   **Them** within ~1–2 s of pauses, reasonably accurate.
2. Enable **Mic**, speak → text appears under **You**.
3. Enable **both** during a real call → two correctly-labeled streams, no cross-attribution.
4. **Pull the network** → transcription continues (proves offline).
5. While transcribing, drag the overlay and fire hotkeys → no freeze (inference is off-main).
6. Long monologue (>10 s without pause) → not truncated (validates `maxSpeechDuration`).
7. `npm run build:win` → the portable `.exe` transcribes (validates `asarUnpack` + model path).

---

## Out of scope for Phase 2 (do not build yet)

No LLM/router, no screenshots, no diarization beyond the System-vs-Mic source label, no transcript
persistence to disk, no summarization. Just live, labeled, offline transcription + a clean
transcript store.

## Forward-compat notes

- Keep the in-memory transcript store as `{source, text, tStart, tEnd, final}[]` — Phase 4's router
  reads a window of this (recent turns for **fast** mode, full session for **thinking** mode).
- **Them/You** labels become the speaker attribution the LLM prompt uses ("the other person said…
  / I said…").
- Optional polish (defer): sherpa-onnx has CT-transformer punctuation models, including a streaming one to add casing/punctuation to raw ASR output; alternatively let Phase 4's model clean it up in the prompt.
- Phase 3 (screenshots) and Phase 4 (router) attach to this shell; the `utilityProcess` boundary and
  the `window.stt` API should stay stable as they're added.
