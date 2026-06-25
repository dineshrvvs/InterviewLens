import { session, desktopCapturer, ipcMain } from 'electron'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { TARGET_SAMPLE_RATE, DEBUG_WAV_DIR } from './config'
import { feedPcm, onAudioStart, onAudioStop } from './stt'

// Buffers to accumulate Int16 PCM samples in memory
const pcmBuffers: Record<'system' | 'mic', number[]> = {
  system: [],
  mic: []
}

// Track default devices change logs
let currentDeviceLog = {
  playback: 'default',
  recording: 'default'
}

export function setupAudio(): void {
  // 1) Allow the renderer's media/microphone request
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media')
  })

  // 2) Feed getDisplayMedia a screen source + request full system loopback audio, no picker UI
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      if (sources.length === 0) {
        console.error('No screen sources found for loopback audio capture')
        cb({ video: undefined as any, audio: undefined })
        return
      }
      cb({ video: sources[0], audio: 'loopback' }) // 'loopback' = system output mix on Windows
    } catch (err) {
      console.error('Error in setDisplayMediaRequestHandler:', err)
      cb({ video: undefined as any, audio: undefined })
    }
  }, { useSystemPicker: false })

  // 3) Setup IPC handlers for PCM data streams
  ipcMain.on('audio:pcm', (_event, source: 'system' | 'mic', chunk: any) => {
    const int16Array = chunk instanceof ArrayBuffer
      ? new Int16Array(chunk)
      : new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2)
    // Accumulate the samples for WAV debug
    for (let i = 0; i < int16Array.length; i++) {
      pcmBuffers[source].push(int16Array[i])
    }
    // Phase 2: tee PCM to STT worker for live transcription
    feedPcm(source, chunk)
  })

  // Start capture (clear buffer for the source)
  ipcMain.on('audio:start', (_event, source: 'system' | 'mic') => {
    pcmBuffers[source] = []
    console.log(`Audio capture started on main process for: ${source}`)
    onAudioStart(source)
  })

  // Stop capture
  ipcMain.on('audio:stop', (_event, source: 'system' | 'mic') => {
    console.log(`Audio capture stopped on main process for: ${source}. Buffer size: ${pcmBuffers[source].length} samples.`)
    onAudioStop(source)
  })

  // Dump WAV on demand
  ipcMain.handle('audio:dump-wav', async (_event, source: 'system' | 'mic') => {
    try {
      const samples = pcmBuffers[source]
      if (samples.length === 0) {
        console.warn(`No samples collected to write WAV for ${source}`)
        return { success: false, reason: 'No audio samples collected' }
      }

      if (!existsSync(DEBUG_WAV_DIR)) {
        mkdirSync(DEBUG_WAV_DIR, { recursive: true })
      }

      const wavBuffer = createWavFile(samples, TARGET_SAMPLE_RATE)
      const filename = `${source}-${Date.now()}.wav`
      const filePath = join(DEBUG_WAV_DIR, filename)

      writeFileSync(filePath, wavBuffer)
      console.log(`WAV file successfully written: ${filePath}`)
      return { success: true, filePath }
    } catch (error: any) {
      console.error(`Failed to dump WAV for ${source}:`, error)
      return { success: false, reason: error.message }
    }
  })

  // Log audio device changes
  ipcMain.on('audio:device-change', (_event, devices: { playback: string; recording: string }) => {
    currentDeviceLog = devices
    console.log(`[Audio Device Change] Playback: ${devices.playback} | Recording: ${devices.recording}`)
  })
}

/**
 * Creates a standard 44-byte WAVE file buffer from 16-bit PCM samples
 */
function createWavFile(samples: number[], sampleRate: number): Buffer {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const fileSize = 36 + dataSize

  const header = Buffer.alloc(44)

  // RIFF identifier
  header.write('RIFF', 0)
  // File size minus RIFF and WAVE headers
  header.writeUInt32LE(fileSize, 4)
  // WAVE identifier
  header.write('WAVE', 8)
  // fmt chunk identifier
  header.write('fmt ', 12)
  // format chunk size (16 for PCM)
  header.writeUInt32LE(16, 16)
  // audio format (1 for uncompressed PCM)
  header.writeUInt16LE(1, 20)
  // number of channels
  header.writeUInt16LE(numChannels, 22)
  // sample rate
  header.writeUInt32LE(sampleRate, 24)
  // byte rate
  header.writeUInt32LE(byteRate, 28)
  // block align
  header.writeUInt16LE(blockAlign, 32)
  // bits per sample
  header.writeUInt16LE(bitsPerSample, 34)
  // data chunk identifier
  header.write('data', 36)
  // data chunk size
  header.writeUInt32LE(dataSize, 40)

  // Write PCM data
  const dataBuffer = Buffer.alloc(dataSize)
  for (let i = 0; i < samples.length; i++) {
    dataBuffer.writeInt16LE(samples[i], i * 2)
  }

  return Buffer.concat([header, dataBuffer])
}
