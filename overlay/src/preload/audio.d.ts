export {}

interface AudioAPI {
  start: (source: 'system' | 'mic') => void
  stop: (source: 'system' | 'mic') => void
  pushPcm: (source: 'system' | 'mic', buffer: ArrayBuffer) => void
  dumpWav: (source: 'system' | 'mic') => Promise<{ success: boolean; filePath?: string; reason?: string }>
  logDeviceChange: (devices: { playback: string; recording: string }) => void
}

declare global {
  interface Window {
    audio: AudioAPI
  }
}
