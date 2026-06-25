export {}

export interface LlmStartData {
  id: string
  mode: 'fast' | 'thinking'
  provider: string
}

export interface LlmTokenData {
  id: string
  delta: string
}

export interface LlmDoneData {
  id: string
}

export interface LlmErrorData {
  id: string
  error: string
}

export interface LlmAPI {
  run: (mode: 'fast' | 'thinking', opts?: { userQuery?: string }) => Promise<void>
  cancel: (id?: string) => Promise<void>
  onStart: (cb: (data: LlmStartData) => void) => void
  onToken: (cb: (data: LlmTokenData) => void) => void
  onDone: (cb: (data: LlmDoneData) => void) => void
  onError: (cb: (data: LlmErrorData) => void) => void
}

declare global {
  interface Window {
    llm: LlmAPI
  }
}
