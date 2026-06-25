import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { STT, SCREENSHOT, LLM } from './config'
import { PROMPTS } from './llm/prompts'
import { getApiKeys, saveApiKeys, ApiKeys } from './llm/keys'

const SETTINGS_FILE = join(app.getPath('userData'), 'settings.json')

export interface AppSettings {
  stt?: {
    idleUnload?: boolean
    idleTimeoutMins?: number
    vad?: {
      threshold?: number
      minSilenceDuration?: number
      minSpeechDuration?: number
      maxSpeechDuration?: number
    }
  }
  screenshot?: {
    captureMode?: 'primary' | 'cursor' | 'overlay'
    hideBeforeCapture?: boolean
    maxLongEdge?: number
    jpegQuality?: number
  }
  llm?: {
    fast?: {
      provider?: string
      model?: string
      prompt?: string
    }
    thinking?: {
      provider?: string
      model?: string
      prompt?: string
    }
    ollama?: {
      baseURL?: string
    }
  }
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  }
}

let activeSettings: AppSettings = {}

/**
 * Loads settings from userData settings.json, parses them,
 * and overrides properties in global CONFIG (STT, SCREENSHOT, LLM, PROMPTS).
 */
export function loadSettings(): AppSettings {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
      activeSettings = data
      applyHotReload(data)
    }
  } catch (err) {
    console.error('[Settings] Error loading settings.json:', err)
  }
  return activeSettings
}

/**
 * Saves non-secret settings to JSON and triggers encryption migration for keys.
 */
export function saveSettings(s: AppSettings, keys?: ApiKeys): void {
  // Update in-memory settings
  activeSettings = { ...activeSettings, ...s }
  // Retain existing bounds if they exist
  if (activeSettings.bounds && !s.bounds) {
    s.bounds = activeSettings.bounds
  }

  // 1) Save non-secret settings
  try {
    writeFileSync(SETTINGS_FILE, JSON.stringify(activeSettings, null, 2), 'utf8')
    console.log(`[Settings] Configuration successfully written to: ${SETTINGS_FILE}`)
  } catch (err) {
    console.error('[Settings] Error writing settings.json:', err)
  }

  // 2) Save secret keys via secure safeStorage manager in keys.ts
  if (keys) {
    saveApiKeys(keys)
  }

  // 3) Instantly hot-reload configurations
  applyHotReload(activeSettings)
}

/**
 * Saves and updates the window bounds coordinates in settings.
 */
export function saveWindowBounds(bounds: { x: number; y: number; width: number; height: number }): void {
  activeSettings.bounds = bounds
  try {
    writeFileSync(SETTINGS_FILE, JSON.stringify(activeSettings, null, 2), 'utf8')
  } catch (err) {
    console.warn('[Settings] Failed to save window bounds:', err)
  }
}

/**
 * Returns saved window bounds if they exist.
 */
export function getSavedWindowBounds(): any {
  return activeSettings.bounds || null
}

/**
 * Re-arranges the provider list so that the selected primary provider is placed first.
 */
function getFastProviders(s: AppSettings) {
  const primary = s.llm?.fast?.provider || 'groq'
  const customModel = s.llm?.fast?.model
  const ollamaBaseUrl = s.llm?.ollama?.baseURL || 'http://localhost:11434/v1'

  const all = [
    { name: 'groq',   baseURL: 'https://api.groq.com/openai/v1',                          model: 'llama-3.3-70b-versatile',      keyRef: 'GROQ' },
    { name: 'gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.5-flash',            keyRef: 'GEMINI' },
    { name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1',                            model: 'google/gemini-2.5-flash',      keyRef: 'OPENROUTER' },
    { name: 'ollama', baseURL: ollamaBaseUrl,                                            model: 'qwen3:4b',                     keyRef: 'OLLAMA' }
  ]

  const primaryIdx = all.findIndex(p => p.name === primary)
  if (primaryIdx !== -1) {
    const [p] = all.splice(primaryIdx, 1)
    if (customModel) p.model = customModel
    all.unshift(p)
  }
  return all
}

/**
 * Re-arranges the provider list so that the selected primary provider is placed first.
 */
function getThinkingProviders(s: AppSettings) {
  const primary = s.llm?.thinking?.provider || 'gemini-pro'
  const customModel = s.llm?.thinking?.model
  const ollamaBaseUrl = s.llm?.ollama?.baseURL || 'http://localhost:11434/v1'

  const all = [
    { name: 'gemini-pro',   baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.5-pro',              keyRef: 'GEMINI' },
    { name: 'gemini-flash', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.0-flash',            keyRef: 'GEMINI' },
    { name: 'openrouter',   baseURL: 'https://openrouter.ai/api/v1',                            model: 'google/gemini-2.5-pro',        keyRef: 'OPENROUTER' },
    { name: 'ollama',       baseURL: ollamaBaseUrl,                                            model: 'qwen3:4b',                     keyRef: 'OLLAMA' }
  ]

  const primaryIdx = all.findIndex(p => p.name === primary)
  if (primaryIdx !== -1) {
    const [p] = all.splice(primaryIdx, 1)
    if (customModel) p.model = customModel
    all.unshift(p)
  }
  return all
}

/**
 * Hot-swaps memory references on the fly.
 */
export function applyHotReload(s: AppSettings): void {
  console.log('[Settings] Applying hot-reload configuration updates...')

  // 1) Update System Prompts
  if (s.llm?.fast?.prompt) {
    (PROMPTS as any).fast = s.llm.fast.prompt
  }
  if (s.llm?.thinking?.prompt) {
    (PROMPTS as any).thinking = s.llm.thinking.prompt
  }

  // 2) Update Screenshot Toggles
  if (s.screenshot) {
    if (s.screenshot.captureMode) SCREENSHOT.captureMode = s.screenshot.captureMode
    if (s.screenshot.hideBeforeCapture !== undefined) SCREENSHOT.hideBeforeCapture = s.screenshot.hideBeforeCapture
    if (s.screenshot.maxLongEdge !== undefined) SCREENSHOT.maxLongEdge = s.screenshot.maxLongEdge
    if (s.screenshot.jpegQuality !== undefined) SCREENSHOT.jpegQuality = s.screenshot.jpegQuality
  }

  // 3) Update STT Toggles
  if (s.stt) {
    if (s.stt.idleUnload !== undefined) STT.idleUnload = s.stt.idleUnload
    if (s.stt.idleTimeoutMins !== undefined) STT.idleTimeoutMins = s.stt.idleTimeoutMins
    if (s.stt.vad) {
      const v = s.stt.vad
      if (v.threshold !== undefined) (STT.vad as any).threshold = v.threshold
      if (v.minSilenceDuration !== undefined) (STT.vad as any).minSilenceDuration = v.minSilenceDuration
      if (v.minSpeechDuration !== undefined) (STT.vad as any).minSpeechDuration = v.minSpeechDuration
      if (v.maxSpeechDuration !== undefined) (STT.vad as any).maxSpeechDuration = v.maxSpeechDuration
    }
  }

  // 4) Rebuild and Hot-Reload LLM provider stacks
  if (s.llm) {
    const newFastProviders = getFastProviders(s)
    const newThinkingProviders = getThinkingProviders(s);
    
    (LLM.modes.fast as any).providers = newFastProviders;
    (LLM.modes.thinking as any).providers = newThinkingProviders
  }
}
