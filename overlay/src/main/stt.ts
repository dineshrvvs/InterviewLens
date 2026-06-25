/**
 * STT lifecycle manager — runs in the main process.
 *
 * Forks the stt-worker utilityProcess, routes PCM chunks to it,
 * receives transcripts back, and forwards them to the renderer window.
 */

import { utilityProcess, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { STT, resolveModelPath } from './config'
import { addTurn } from './context'

export interface Transcript {
  source: 'system' | 'mic'
  text: string
  tStart: number
  tEnd: number
  final: boolean
}

let worker: Electron.UtilityProcess | null = null
let targetWindow: BrowserWindow | null = null

const activeSources = new Set<'system' | 'mic'>()
let idleTimer: NodeJS.Timeout | null = null

/**
 * Handle audio capture starting for a source. Cancels idle timer and reloads STT worker on demand.
 */
export function onAudioStart(source: 'system' | 'mic'): void {
  activeSources.add(source)
  if (idleTimer) {
    console.log('[STT] Active audio detected. Cancelling idle unload timer.')
    clearTimeout(idleTimer)
    idleTimer = null
  }

  if (!worker && targetWindow) {
    console.log('[STT] Reloading STT worker on capture start...')
    if (!targetWindow.isDestroyed()) {
      targetWindow.webContents.send('stt:loading')
    }
    startStt(targetWindow)
  }
}

/**
 * Handle audio capture stopping for a source. Sets idle timer if all sources are inactive.
 */
export function onAudioStop(source: 'system' | 'mic'): void {
  activeSources.delete(source)

  if (activeSources.size === 0 && STT.idleUnload && worker) {
    if (idleTimer) clearTimeout(idleTimer)

    const timeoutMs = STT.idleTimeoutMins * 60 * 1000
    console.log(`[STT] No active audio sources. Setting idle timer for ${STT.idleTimeoutMins} minutes...`)

    idleTimer = setTimeout(() => {
      console.log('[STT] Idle timeout reached. Unloading STT worker to free memory...')
      stopStt()
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('stt:unloaded')
      }
      idleTimer = null
    }, timeoutMs)
  }
}

/**
 * Start the STT worker process and begin relaying transcripts to the renderer.
 */
export function startStt(win: BrowserWindow): void {
  targetWindow = win

  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }

  // Fork the utility process from the compiled stt-worker.js
  const workerPath = join(__dirname, 'stt-worker.js')
  console.log(`[STT] Forking worker from: ${workerPath}`)

  worker = utilityProcess.fork(workerPath, [], { stdio: 'pipe' })

  worker.stdout?.on('data', (chunk) => {
    console.log(`[STT Worker Stdout] ${chunk.toString().trim()}`)
  })

  worker.stderr?.on('data', (chunk) => {
    console.error(`[STT Worker Stderr] ${chunk.toString().trim()}`)
  })

  worker.on('message', (msg: any) => {
    if (msg.type === 'transcript') {
      const transcript: Transcript = {
        source: msg.source,
        text: msg.text,
        tStart: msg.tStart,
        tEnd: msg.tEnd,
        final: msg.final
      }
      // Forward to renderer
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('stt:transcript', transcript)
      }
      // Tee the transcript turn into the router's context store (if final)
      if (transcript.final) {
        addTurn(transcript.source, transcript.text)
      }
    } else if (msg.type === 'speaking') {
      // Forward VAD speaking state to renderer
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('stt:speaking', msg.source, msg.isSpeaking)
      }
    } else if (msg.type === 'ready') {
      console.log('[STT] Worker reports ready')
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('stt:ready')
      }
    } else if (msg.type === 'error') {
      console.error('[STT] Worker error:', msg.message)
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('stt:error', msg.message)
      }
    }
  })

  worker.on('exit', (code) => {
    console.log(`[STT] Worker exited with code ${code}`)
    worker = null
  })

  // Send init message with resolved model paths
  const modelDir = resolveModelPath(STT.model.dir)
  const vadModelPath = resolveModelPath('silero_vad.onnx')

  console.log(`[STT] Model dir: ${modelDir}`)
  console.log(`[STT] VAD model: ${vadModelPath}`)

  worker.postMessage({
    type: 'init',
    config: {
      provider: STT.provider,
      numThreads: STT.numThreads,
      modelDir,
      vadModelPath,
      vad: { ...STT.vad }
    }
  })
}

/**
 * Feed a PCM chunk to the STT worker for processing.
 * Called by audio.ts for every audio:pcm chunk.
 *
 * @param source - 'system' or 'mic'
 * @param int16Buffer - ArrayBuffer containing Int16 PCM samples
 */
export function feedPcm(source: 'system' | 'mic', int16Buffer: any): void {
  if (!worker) return

  // Clone the buffer since the original is owned by renderer/ipc and may be modified
  const clone = int16Buffer.slice ? int16Buffer.slice(0) : int16Buffer
  worker.postMessage({ type: 'pcm', source, int16: clone })
}

/**
 * Stop the STT worker process.
 */
export function stopStt(): void {
  if (worker) {
    console.log('[STT] Stopping worker...')
    worker.kill()
    worker = null
  }
}
