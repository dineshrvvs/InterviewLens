import { desktopCapturer, screen, ipcMain, BrowserWindow } from 'electron'
import crypto from 'node:crypto'
import { SCREENSHOT } from './config'

export interface Shot {
  id: string
  jpeg: string          // Base64 JPEG for the LLM
  thumbDataUrl: string  // Data URL (PNG/JPEG) of ~200px image for UI strip
  tStart: number
  included: boolean
}

// In-memory screenshots store
const shots: Shot[] = []

/**
 * Returns the list of screenshots currently toggled "included" for LLM consumption.
 * Called in Phase 4.
 */
export function includedShots(): Shot[] {
  return shots.filter((s) => s.included)
}

/**
 * Helper to pause execution.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Selects the display to capture based on config captureMode.
 */
function pickDisplay(win: BrowserWindow): Electron.Display {
  const mode = SCREENSHOT.captureMode

  if (mode === 'cursor') {
    const point = screen.getCursorScreenPoint()
    return screen.getDisplayNearestPoint(point)
  }

  if (mode === 'overlay') {
    const bounds = win.getBounds()
    return screen.getDisplayMatching(bounds)
  }

  // Default: primary display
  return screen.getPrimaryDisplay()
}

/**
 * Grabs the screen, downscales for LLM, and creates a small thumbnail data URL.
 */
async function grab(win: BrowserWindow): Promise<{ jpeg: string; thumbDataUrl: string }> {
  const display = pickDisplay(win)
  const sf = display.scaleFactor

  // Calculate physical resolution size to prevent blurriness on HiDPI displays
  const thumbnailSize = {
    width: Math.round(display.bounds.width * sf),
    height: Math.round(display.bounds.height * sf)
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize
  })

  // Match the display ID or fall back to the first screen source
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!src) {
    throw new Error('No screen sources available')
  }

  const img = src.thumbnail // NativeImage representing the screenshot

  // 1) Generate the tiny thumbnail data URL (width 200px) for the UI strip
  const { width: origWidth, height: origHeight } = img.getSize()
  const thumbScale = 200 / origWidth
  const thumbImg = img.resize({
    width: 200,
    height: Math.round(origHeight * thumbScale),
    quality: 'good'
  })
  const thumbDataUrl = thumbImg.toDataURL()

  // 2) Downscale the main image if it exceeds maxLongEdge
  let mainImg = img
  const longEdge = Math.max(origWidth, origHeight)
  if (longEdge > SCREENSHOT.maxLongEdge) {
    const k = SCREENSHOT.maxLongEdge / longEdge
    mainImg = img.resize({
      width: Math.round(origWidth * k),
      height: Math.round(origHeight * k),
      quality: 'good'
    })
  }

  // 3) Compress to JPEG@80 base64
  const jpeg = mainImg.toJPEG(SCREENSHOT.jpegQuality).toString('base64')

  return { jpeg, thumbDataUrl }
}

/**
 * Performs screenshot capture of the screen, manages overlay visibility self-exclusion,
 * updates the store, and dispatches IPC messages to the renderer.
 */
export async function capture(win: BrowserWindow): Promise<void> {
  try {
    if (SCREENSHOT.hideBeforeCapture) {
      win.hide()
      await wait(60) // Let OS window animations settle
    }

    const { jpeg, thumbDataUrl } = await grab(win)

    if (SCREENSHOT.hideBeforeCapture) {
      win.showInactive()
    }

    const shot: Shot = {
      id: crypto.randomUUID(),
      jpeg,
      thumbDataUrl,
      tStart: Date.now(),
      included: true
    }

    shots.push(shot)

    if (!win.isDestroyed()) {
      win.webContents.send('shot:captured', { id: shot.id, tStart: shot.tStart })
    }
  } catch (err: any) {
    console.error('[Screenshot] Error during capture:', err)
    if (SCREENSHOT.hideBeforeCapture) {
      win.showInactive()
    }
    if (!win.isDestroyed()) {
      win.webContents.send('shot:error', err.message || String(err))
    }
  }
}

/**
 * Sets up IPC listeners for screenshot actions.
 */
export function setupScreenshotHandlers(win: BrowserWindow): void {
  ipcMain.handle('shot:capture', async () => {
    await capture(win)
  })

  ipcMain.handle('shot:list', () => {
    return shots.map((s) => ({
      id: s.id,
      tStart: s.tStart,
      included: s.included
    }))
  })

  ipcMain.handle('shot:remove', (_e, id: string) => {
    const idx = shots.findIndex((s) => s.id === id)
    if (idx >= 0) {
      shots.splice(idx, 1)
    }
  })

  ipcMain.handle('shot:toggle', (_e, id: string) => {
    const shot = shots.find((s) => s.id === id)
    if (shot) {
      shot.included = !shot.included
    }
  })

  ipcMain.handle('shot:thumb', (_e, id: string) => {
    const shot = shots.find((s) => s.id === id)
    return shot ? shot.thumbDataUrl : null
  })

  ipcMain.handle('shot:preview', (_e, id: string) => {
    const shot = shots.find((s) => s.id === id)
    return shot ? shot.jpeg : null
  })
}

/**
 * Clears the in-memory screenshot store.
 */
export function clear(): void {
  shots.length = 0
}

