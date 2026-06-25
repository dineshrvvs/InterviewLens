export {}

export interface ShotMeta {
  id: string
  tStart: number
  included: boolean
}

export interface ShotAPI {
  capture: () => Promise<void>
  list: () => Promise<ShotMeta[]>
  remove: (id: string) => Promise<void>
  toggleInclude: (id: string) => Promise<void>
  thumb: (id: string) => Promise<string | null>
  preview: (id: string) => Promise<string | null>
  onCaptured: (cb: (shot: { id: string; tStart: number }) => void) => void
  onError: (cb: (message: string) => void) => void
}

declare global {
  interface Window {
    shot: ShotAPI
  }
}
