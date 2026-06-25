import { contextBridge, ipcRenderer } from 'electron'

export interface OverlayAPI {
  onClickThroughChanged: (cb: (enabled: boolean) => void) => void
  getClickThroughState: () => Promise<boolean>
  releaseFocus: () => Promise<void>
  clearContext: () => Promise<void>
  onContextCleared: (cb: () => void) => void
}

const api: OverlayAPI = {
  onClickThroughChanged(cb: (enabled: boolean) => void): void {
    ipcRenderer.on('click-through-changed', (_event, enabled: boolean) => {
      cb(enabled)
    })
  },

  getClickThroughState(): Promise<boolean> {
    return ipcRenderer.invoke('get-click-through-state')
  },

  releaseFocus(): Promise<void> {
    return ipcRenderer.invoke('overlay:release-focus')
  },

  clearContext(): Promise<void> {
    return ipcRenderer.invoke('context:clear')
  },

  onContextCleared(cb: () => void): void {
    ipcRenderer.on('context:cleared', () => cb())
  }
}

contextBridge.exposeInMainWorld('overlay', api)

export interface AudioAPI {
  start: (source: 'system' | 'mic') => void
  stop: (source: 'system' | 'mic') => void
  pushPcm: (source: 'system' | 'mic', buffer: ArrayBuffer) => void
  dumpWav: (source: 'system' | 'mic') => Promise<{ success: boolean; filePath?: string; reason?: string }>
  logDeviceChange: (devices: { playback: string; recording: string }) => void
}

const audioAPI: AudioAPI = {
  start(source) {
    ipcRenderer.send('audio:start', source)
  },
  stop(source) {
    ipcRenderer.send('audio:stop', source)
  },
  pushPcm(source, buffer) {
    // Send PCM chunk
    ipcRenderer.send('audio:pcm', source, buffer)
  },
  dumpWav(source) {
    return ipcRenderer.invoke('audio:dump-wav', source)
  },
  logDeviceChange(devices) {
    ipcRenderer.send('audio:device-change', devices)
  }
}

contextBridge.exposeInMainWorld('audio', audioAPI)

// ─── STT API (Phase 2) ──────────────────────────────────────────────────────

export interface Transcript {
  source: 'system' | 'mic'
  text: string
  tStart: number
  tEnd: number
  final: boolean
}

export interface SttAPI {
  onTranscript: (cb: (t: Transcript) => void) => void
  onSpeaking: (cb: (source: 'system' | 'mic', isSpeaking: boolean) => void) => void
  onReady: (cb: () => void) => void
  onError: (cb: (message: string) => void) => void
  onLoading: (cb: () => void) => void
  onUnloaded: (cb: () => void) => void
  clear: () => void
}

const sttAPI: SttAPI = {
  onTranscript(cb) {
    ipcRenderer.on('stt:transcript', (_e, t) => cb(t))
  },
  onSpeaking(cb) {
    ipcRenderer.on('stt:speaking', (_e, source, isSpeaking) => cb(source, isSpeaking))
  },
  onReady(cb) {
    ipcRenderer.on('stt:ready', () => cb())
  },
  onError(cb) {
    ipcRenderer.on('stt:error', (_e, message) => cb(message))
  },
  onLoading(cb) {
    ipcRenderer.on('stt:loading', () => cb())
  },
  onUnloaded(cb) {
    ipcRenderer.on('stt:unloaded', () => cb())
  },
  clear() {
    ipcRenderer.send('stt:clear')
  }
}

contextBridge.exposeInMainWorld('stt', sttAPI)

// ─── Screenshot API (Phase 3) ──────────────────────────────────────────────
const shotAPI = {
  capture() {
    return ipcRenderer.invoke('shot:capture')
  },
  list() {
    return ipcRenderer.invoke('shot:list')
  },
  remove(id: string) {
    return ipcRenderer.invoke('shot:remove', id)
  },
  toggleInclude(id: string) {
    return ipcRenderer.invoke('shot:toggle', id)
  },
  thumb(id: string) {
    return ipcRenderer.invoke('shot:thumb', id)
  },
  preview(id: string) {
    return ipcRenderer.invoke('shot:preview', id)
  },
  onCaptured(cb: (shot: { id: string; tStart: number }) => void) {
    ipcRenderer.on('shot:captured', (_e, shot) => cb(shot))
  },
  onError(cb: (message: string) => void) {
    ipcRenderer.on('shot:error', (_e, message) => cb(message))
  }
}

contextBridge.exposeInMainWorld('shot', shotAPI)

// ─── LLM Router API (Phase 4) ────────────────────────────────────────────────
const llmAPI = {
  run(mode: 'fast' | 'thinking', opts?: { userQuery?: string }) {
    return ipcRenderer.invoke('llm:run', mode, opts)
  },
  cancel(id?: string) {
    return ipcRenderer.invoke('llm:cancel', id)
  },
  onStart(cb: (data: any) => void) {
    ipcRenderer.on('llm:start', (_e, data) => cb(data))
  },
  onToken(cb: (data: any) => void) {
    ipcRenderer.on('llm:token', (_e, data) => cb(data))
  },
  onDone(cb: (data: any) => void) {
    ipcRenderer.on('llm:done', (_e, data) => cb(data))
  },
  onError(cb: (data: any) => void) {
    ipcRenderer.on('llm:error', (_e, data) => cb(data))
  }
}

contextBridge.exposeInMainWorld('llm', llmAPI)

// ─── Settings API (Phase 5) ──────────────────────────────────────────────────
const settingsAPI = {
  get() {
    return ipcRenderer.invoke('settings:get')
  },
  save(settings: any, keys: any) {
    return ipcRenderer.invoke('settings:save', settings, keys)
  }
}

contextBridge.exposeInMainWorld('settings', settingsAPI)

// ─── Input API (Phase 5) ─────────────────────────────────────────────────────
const inputAPI = {
  onFocus(cb: () => void) {
    ipcRenderer.on('input:focus', () => cb())
  }
}

contextBridge.exposeInMainWorld('input', inputAPI)
