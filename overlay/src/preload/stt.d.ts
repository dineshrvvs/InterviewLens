export {}

interface Transcript {
  source: 'system' | 'mic'
  text: string
  tStart: number
  tEnd: number
  final: boolean
}

interface SttAPI {
  onTranscript: (cb: (t: Transcript) => void) => void
  onSpeaking: (cb: (source: 'system' | 'mic', isSpeaking: boolean) => void) => void
  onReady: (cb: () => void) => void
  onError: (cb: (message: string) => void) => void
  onLoading: (cb: () => void) => void
  onUnloaded: (cb: () => void) => void
  clear: () => void
}

declare global {
  interface Window {
    stt: SttAPI
  }
}
