/**
 * STT Worker — runs in an Electron utilityProcess.
 *
 * Creates two independent {Silero VAD + OfflineRecognizer} pipelines
 * (one for 'system', one for 'mic'). Receives Int16 PCM chunks from main,
 * converts to Float32, feeds VAD, decodes completed utterances, and posts
 * transcript results back to main.
 *
 * Following the sherpa-onnx-node API from nodejs-addon-examples.
 */

import { join } from 'node:path'

// sherpa-onnx-node is a native addon — require() it at runtime
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sherpa_onnx = require('sherpa-onnx-node')

// ─── Types ──────────────────────────────────────────────────────────────────────
interface PcmMessage {
  type: 'pcm'
  source: 'system' | 'mic'
  int16: ArrayBuffer
}

interface InitMessage {
  type: 'init'
  config: {
    provider: string
    numThreads: number
    modelDir: string        // absolute path to model dir
    vadModelPath: string    // absolute path to silero_vad.onnx
    vad: {
      threshold: number
      minSilenceDuration: number
      minSpeechDuration: number
      maxSpeechDuration: number
    }
  }
}

type WorkerMessage = PcmMessage | InitMessage

interface Transcript {
  source: 'system' | 'mic'
  text: string
  tStart: number
  tEnd: number
  final: boolean
}

// ─── Pipeline state ─────────────────────────────────────────────────────────────
interface Pipeline {
  vad: any
  recognizer: any
}

let pipelines: Record<'system' | 'mic', Pipeline> | null = null

function createPipeline(config: InitMessage['config']): Pipeline {
  const modelDir = config.modelDir

  // Create offline recognizer (Parakeet TDT transducer)
  const recognizerConfig = {
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      transducer: {
        encoder: join(modelDir, 'encoder.int8.onnx'),
        decoder: join(modelDir, 'decoder.int8.onnx'),
        joiner: join(modelDir, 'joiner.int8.onnx'),
      },
      tokens: join(modelDir, 'tokens.txt'),
      numThreads: config.numThreads,
      provider: config.provider,
      debug: 0,
    },
  }

  const recognizer = new sherpa_onnx.OfflineRecognizer(recognizerConfig)

  // Create Silero VAD
  const vadConfig = {
    sileroVad: {
      model: config.vadModelPath,
      threshold: config.vad.threshold,
      minSpeechDuration: config.vad.minSpeechDuration,
      minSilenceDuration: config.vad.minSilenceDuration,
      maxSpeechDuration: config.vad.maxSpeechDuration,
      windowSize: 512,
    },
    sampleRate: 16000,
    debug: false,
    numThreads: 1,
  }

  const bufferSizeInSeconds = 60
  const vad = new sherpa_onnx.Vad(vadConfig, bufferSizeInSeconds)

  return { vad, recognizer }
}

/**
 * Convert Int16 PCM to Float32 normalized [-1, 1]
 */
function int16ToFloat32(int16: Int16Array): Float32Array {
  const f32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    f32[i] = int16[i] / 32768
  }
  return f32
}

// Track VAD speaking state per source to emit speaking signals
const isSpeaking: Record<'system' | 'mic', boolean> = {
  system: false,
  mic: false
}

/**
 * Safely converts any incoming buffer (ArrayBuffer, Node Buffer, or TypedArray)
 * into an Int16Array view without copying values incorrectly.
 */
function toInt16Array(buffer: any): Int16Array {
  if (buffer instanceof ArrayBuffer) {
    return new Int16Array(buffer)
  }
  if (ArrayBuffer.isView(buffer)) {
    return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2)
  }
  if (buffer && buffer.buffer instanceof ArrayBuffer) {
    return new Int16Array(buffer.buffer, buffer.byteOffset || 0, (buffer.byteLength || buffer.length * 2) / 2)
  }
  return new Int16Array(buffer)
}

/**
 * Process a PCM chunk through the VAD + recognizer pipeline
 */
function processPcm(source: 'system' | 'mic', int16Buffer: any): void {
  if (!pipelines) return

  const pipeline = pipelines[source]
  const int16 = toInt16Array(int16Buffer)
  const f32 = int16ToFloat32(int16)

  // Feed samples to VAD
  pipeline.vad.acceptWaveform(f32)

  // Check if VAD detects speech (for speaking indicator)
  const speaking = pipeline.vad.isDetected()
  if (speaking !== isSpeaking[source]) {
    isSpeaking[source] = speaking
    console.log(`[STT Worker] VAD speaking state for ${source} changed to: ${speaking}`)
    process.parentPort!.postMessage({
      type: 'speaking',
      source,
      isSpeaking: speaking
    })
  }

  // Process completed speech segments
  while (!pipeline.vad.isEmpty()) {
    console.log(`[STT Worker] Completed speech segment detected for ${source}`)
    const segment = pipeline.vad.front(false)
    const tEnd = Date.now()

    // Create a stream and decode the segment
    const stream = pipeline.recognizer.createStream()
    stream.acceptWaveform({
      samples: segment.samples,
      sampleRate: 16000
    })
    console.log(`[STT Worker] Segment samples count: ${segment.samples.length}`)
    pipeline.recognizer.decode(stream)

    const result = pipeline.recognizer.getResult(stream)
    const text = (result.text || '').trim()
    console.log(`[STT Worker] Decoded text result: "${text}"`)

    if (text) {
      // Estimate tStart from segment duration
      const durationMs = (segment.samples.length / 16000) * 1000
      const tStart = tEnd - durationMs

      const transcript: Transcript = {
        source,
        text,
        tStart,
        tEnd,
        final: true
      }
      process.parentPort!.postMessage({ type: 'transcript', ...transcript })
    }

    pipeline.vad.pop()
  }
}

// ─── Message handler ────────────────────────────────────────────────────────────
process.parentPort!.on('message', (event: { data: WorkerMessage }) => {
  const msg = event.data

  if (msg.type === 'init') {
    try {
      console.log('[STT Worker] Initializing pipelines...')
      const startTime = Date.now()

      // Create two independent pipelines
      pipelines = {
        system: createPipeline(msg.config),
        mic: createPipeline(msg.config)
      }

      const elapsed = Date.now() - startTime
      console.log(`[STT Worker] Pipelines ready in ${elapsed}ms`)
      process.parentPort!.postMessage({ type: 'ready' })
    } catch (err: any) {
      console.error('[STT Worker] Failed to initialize:', err)
      process.parentPort!.postMessage({ type: 'error', message: err.message || String(err) })
    }
  } else if (msg.type === 'pcm') {
    try {
      processPcm(msg.source, msg.int16)
    } catch (err: any) {
      console.error(`[STT Worker] Error processing PCM for ${msg.source}:`, err)
    }
  }
})

console.log('[STT Worker] Process started, waiting for init message...')
