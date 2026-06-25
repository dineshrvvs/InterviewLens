export {}

export interface SettingsAPI {
  get: () => Promise<{ settings: any; keys: { GEMINI: string; GROQ: string; OPENROUTER: string } }>
  save: (settings: any, keys: { GEMINI?: string; GROQ?: string; OPENROUTER?: string }) => Promise<void>
}

export interface InputAPI {
  onFocus: (cb: () => void) => void
}

declare global {
  interface Window {
    settings: SettingsAPI
    input: InputAPI
  }
}
