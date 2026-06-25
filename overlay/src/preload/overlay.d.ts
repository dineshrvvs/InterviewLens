export {}

interface OverlayAPI {
  onClickThroughChanged: (cb: (enabled: boolean) => void) => void
  getClickThroughState: () => Promise<boolean>
  releaseFocus: () => Promise<void>
  clearContext: () => Promise<void>
  onContextCleared: (cb: () => void) => void
}

declare global {
  interface Window {
    overlay: OverlayAPI
  }
}
