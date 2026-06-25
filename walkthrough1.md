# Phase 1 — Dual-Source Audio Capture Walkthrough

## What was built

Implemented loopback system/speaker audio and microphone capture, resampled to 16 kHz mono PCM. Volume levels are visualized in real-time, and 10s audio debug dumps can be triggered dynamically.

## Project Structure & Additions

```
overlay/
  public/
    pcm-worklet.js                # [NEW] AudioWorkletProcessor downmixes channels to mono
  src/
    main/
      audio.ts                    # [NEW] IPC streams, OS media request handling & WAV file compiler
      config.ts                   # [EXTEND] Audio constants: 16k sample rate, 100ms chunk sizes
      index.ts                    # [EXTEND] Set up default media requests prior to window creation
    preload/
      index.ts                    # [EXTEND] Expose window.audio namespace (start, stop, pushPcm, dumpWav)
      audio.d.ts                  # [NEW] Type definitions for window.audio interface
    renderer/
      audio/
        capture.ts                # [NEW] Initializes getUserMedia / getDisplayMedia at 16kHz
        meter.ts                  # [NEW] Calculates RMS from time-domain buffers for animation
      index.html                  # [EXTEND] Control layout (System/Mic buttons, Record 10s actions, meters)
      style.css                   # [EXTEND] Premium styling for toggles, level indicators, and countdowns
      renderer.ts                 # [EXTEND] Wires user interactions and handles countdown intervals
```

## Key Technical Details

### Audio Resampling and Downmixing
- **Automatic Resampling**: By initializing `new AudioContext({ sampleRate: 16000 })`, Chromium's native resampling is used to convert device audio rates down to 16 kHz.
- **AudioWorklet (`pcm-worklet.js`)**: Runs inside `AudioWorkletGlobalScope`. It receives multi-channel streams and downmixes them to mono by averaging the samples.
- **IPC Coalescing**: Worklet float frames are collected in a queue. Every 100ms (~1600 samples at 16kHz), they are down-scaled to 16-bit Int16 PCM, cutting payload transfer size in half before emitting to the main process via IPC.

### Seamless Permissions & Loopback Capture
- **Microphone Grant**: Main process calls `session.defaultSession.setPermissionRequestHandler` to automatically approve `media` permission requests.
- **Display Picker Bypass**: Main process registers `setDisplayMediaRequestHandler` to fetch the default screen source automatically and requests `audio: 'loopback'` to record speaker output mix on Windows.
- **No Native Addons**: The implementation is pure Web Audio / JS, avoiding native rebuilds (`node-gyp`).

### Debug WAV Exporter
- Wires a hand-rolled, zero-dependency 44-byte WAVE file writer.
- Writes to local directory `d:\Cluely\overlay\.audio_debug\<source>-<timestamp>.wav` when clicking the **Record 10s** buttons.

## Verification

### 1. Verification of build and bundle ✅
- Compiles successfully.
- `npm run build:win` packages cleanly into `dist/Cluely Overlay-0.1.0-portable.exe` with `pcm-worklet.js` correctly resolved in production.

### 2. Live Dev Session Logs ✅
During runtime, the console reports successful capture bindings:
```
Audio capture started on main process for: system
Audio capture started on main process for: mic
```

### Manual Verification
Run the dev environment via `npm run dev`:
1. **System Loopback**: Turn on **System**, play music in your browser. Verify the green level meter animates. Click **Record 10s**, play audio, and verify that the resulting `.wav` in `.audio_debug/` is clean, plays back at normal speed, pitch, and duration.
2. **Microphone**: Turn on **Mic**, speak. Verify the microphone meter animates. Click **Record 10s**, speak, and verify the resulting `.wav` file.
3. **Simultaneous Capture**: Turn both on simultaneously. Verify both level meters react independently, and distinct WAV files are produced.
4. **Device Swapping**: Plug/unplug headphones or change the active device. Verify the app logs the device change without crashing.
