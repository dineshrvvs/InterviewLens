import { screen, app } from 'electron'
import { join } from 'path'

// ─── Hotkeys ───────────────────────────────────────────────────────────────────
export const HOTKEYS = {
  toggleVisibility: 'Control+\\',
  toggleClickThrough: 'Control+Shift+C',
  nudgeUp: 'Control+Alt+Up',
  nudgeDown: 'Control+Alt+Down',
  nudgeLeft: 'Control+Alt+Left',
  nudgeRight: 'Control+Alt+Right',
  quit: 'Control+Shift+Q'
} as const

// Human-readable labels for the renderer
export const HOTKEY_LABELS: Record<string, string> = {
  'Toggle overlay': HOTKEYS.toggleVisibility,
  'Toggle click-through': HOTKEYS.toggleClickThrough,
  'Nudge position': 'Ctrl+Alt+Arrow',
  'Screenshot': 'Ctrl+Shift+S',
  'Quit': HOTKEYS.quit
}

// ─── Window geometry ───────────────────────────────────────────────────────────
export const WINDOW_WIDTH = 420
export const WINDOW_HEIGHT = 780 // Increased to accommodate transcript + response panes (Phase 4)
export const WINDOW_INSET = 24 // px from edge

export function getInitialPosition(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: workArea.x + workArea.width - WINDOW_WIDTH - WINDOW_INSET,
    y: workArea.y + WINDOW_INSET
  }
}

// ─── Audio parameters (Phase 1) ────────────────────────────────────────────────
export const TARGET_SAMPLE_RATE = 16000
export const CHUNK_MS = 100
export const DEBUG_WAV_DIR = join(process.cwd(), '.audio_debug')

// ─── STT parameters (Phase 2) ──────────────────────────────────────────────────
// ─── STT parameters (Phase 2 & 5) ──────────────────────────────────────────────
export let STT = {
  provider: 'cpu' as 'cpu' | 'cuda',           // 'cpu' | 'cuda' (NVIDIA + CUDA onnxruntime build)
  numThreads: 2,
  model: {
    type: 'parakeet' as 'parakeet',
    dir: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'
  },
  vad: {
    threshold: 0.5,
    minSilenceDuration: 0.5,
    minSpeechDuration: 0.25,
    maxSpeechDuration: 20
  },
  idleUnload: true,
  idleTimeoutMins: 2
}

/**
 * Resolve a relative model path to an absolute path.
 * Dev: ./models/...  |  Prod: process.resourcesPath/models/...
 */
export function resolveModelPath(relativePath: string): string {
  const isDev = !app.isPackaged
  const base = isDev
    ? join(process.cwd(), 'models')
    : join(process.resourcesPath!, 'models')
  return join(base, relativePath)
}

// ─── Screenshot parameters (Phase 3 & 5) ───────────────────────────────────────
export let SCREENSHOT = {
  hotkey: 'Control+Shift+S',
  maxLongEdge: 1568,          // downscale target for vision models
  jpegQuality: 80,
  captureMode: 'primary' as 'primary' | 'cursor' | 'overlay',
  hideBeforeCapture: false,   // content-protection self-excludes the overlay; enable only if it still appears
}

// ─── LLM Router parameters (Phase 4 & 5) ───────────────────────────────────────
export let LLM = {
  modes: {
    fast: {
      providers: [
        { name: 'groq',   baseURL: 'https://api.groq.com/openai/v1',                          model: 'llama-3.3-70b-versatile',      keyRef: 'GROQ' },
        { name: 'gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.5-flash',            keyRef: 'GEMINI' },
      ],
      contextWindowTurns: 12,
      includeScreenshots: false,
      maxTokens: 400,
      temperature: 0.4,
    },
    thinking: {
      providers: [
        { name: 'gemini-pro',   baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.5-pro',              keyRef: 'GEMINI' },
        { name: 'gemini-flash', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.0-flash',            keyRef: 'GEMINI' },
        { name: 'openrouter',   baseURL: 'https://openrouter.ai/api/v1',                            model: 'google/gemini-2.5-pro',        keyRef: 'OPENROUTER' },
      ],
      contextWindowTurns: Infinity,
      includeScreenshots: true,
      maxTokens: 1500,
      temperature: 0.6,
    },
  },
}

// ─── Forward-compat placeholders (Phase 1+) ────────────────────────────────────
// Future phases will add:
// - modelList: string[]
// - promptPresets: Record<string, string>
// - audioSettings: { ... }
// Structure config.ts to accommodate these as top-level exports.

