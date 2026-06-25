import { attachMeter } from './meter'

const TARGET_RATE = 16000
const COALESCE_SIZE = 1600 // 100ms of audio at 16kHz is 1600 samples

// Track active streams to clean up correctly on stops
let activeCaptures: Record<'system' | 'mic', { stop: () => void } | null> = {
  system: null,
  mic: null
}

export async function startCapture(
  source: 'system' | 'mic'
): Promise<void> {
  // If already capturing, do nothing or stop first
  if (activeCaptures[source]) {
    console.warn(`Already capturing ${source}, stopping first`)
    stopCapture(source)
  }

  // Tell main process we are starting capture (clears buffers)
  window.audio.start(source)

  let stream: MediaStream
  try {
    if (source === 'mic') {
      // Microphone: Disable AEC/NS/AGC to ensure raw high-quality audio for downstream STT
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        }
      })
    } else {
      // System Loopback: Request video & audio to satisfy desktop display media requirement,
      // then immediately stop the video track to save resources and CPU.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      })
      stream.getVideoTracks().forEach((track) => track.stop())
    }
  } catch (err) {
    console.error(`Failed to get media stream for ${source}:`, err)
    window.audio.stop(source)
    throw err;
  }

  // Create AudioContext forced to target 16kHz sample rate.
  // This causes Chromium to resample loopback/microphone streams automatically.
  const ctx = new AudioContext({ sampleRate: TARGET_RATE })
  const src = ctx.createMediaStreamSource(stream)

  // Attach AnalyserNode to feed the visual level meter in meter.ts
  const meterCtrl = attachMeter(ctx, src, source)

  // Load the standalone pcm-worklet JS file from the root/public path
  const workletUrl = new URL('pcm-worklet.js', document.baseURI).href
  await ctx.audioWorklet.addModule(workletUrl)

  const node = new AudioWorkletNode(ctx, 'pcm-mono', { numberOfOutputs: 0 })
  
  let acc: number[] = []

  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    // Collect samples
    for (let i = 0; i < e.data.length; i++) {
      acc.push(e.data[i])
    }

    // Coalesce samples to reduce IPC traffic (coalesce to ~100ms chunks)
    if (acc.length >= COALESCE_SIZE) {
      const float32Array = Float32Array.from(acc.slice(0, COALESCE_SIZE))
      acc = acc.slice(COALESCE_SIZE)
      
      const int16Buffer = floatToInt16(float32Array)
      window.audio.pushPcm(source, int16Buffer.buffer)
    }
  }

  src.connect(node)

  activeCaptures[source] = {
    stop: () => {
      // Signal stop to main
      window.audio.stop(source)
      
      // Stop the level meter loop
      meterCtrl.disconnect()

      // Close Web Audio nodes
      try {
        src.disconnect(node)
      } catch (e) {}

      try {
        ctx.close()
      } catch (e) {}

      // Stop all media tracks
      stream.getTracks().forEach((t) => t.stop())
      activeCaptures[source] = null
    }
  }
}

export function stopCapture(source: 'system' | 'mic'): void {
  const cap = activeCaptures[source]
  if (cap) {
    cap.stop()
  }
}

/**
 * Converts Float32 audio samples in [-1.0, 1.0] to Int16 PCM array
 */
function floatToInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

// ─── Monitor Device Changes ──────────────────────────────────────────────────
// Automatically log device changes and forward them to the main process
navigator.mediaDevices.ondevicechange = async () => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const playbackDevices = devices.filter((d) => d.kind === 'audiooutput').map((d) => d.label).join(', ')
    const recordingDevices = devices.filter((d) => d.kind === 'audioinput').map((d) => d.label).join(', ')
    
    console.log('[MediaDevices] Device change detected. Reporting current status...')
    window.audio.logDeviceChange({
      playback: playbackDevices || 'No output devices listed (unlabeled)',
      recording: recordingDevices || 'No input devices listed (unlabeled)'
    })
  } catch (err) {
    console.error('Error handling device change:', err)
  }
}
