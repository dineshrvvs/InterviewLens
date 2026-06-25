import { BrowserWindow } from 'electron'
import { join } from 'path'
import {
  WINDOW_WIDTH,
  WINDOW_HEIGHT,
  getInitialPosition
} from './config'

export function createOverlayWindow(): BrowserWindow {
  const { x, y } = getInitialPosition()

  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // fully transparent ARGB — REQUIRED with transparent:true on Windows
    hasShadow: false,
    resizable: false, // do NOT make a transparent window resizable on Windows (repaint/white-border bugs)
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true, // no taskbar icon (also keeps it out of Alt+Tab in most cases)
    focusable: true, // Enable focusable for input interactions (Phase 5)
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Highest practical level; floats over fullscreen apps
  win.setAlwaysOnTop(true, 'screen-saver')

  // Visible on all virtual desktops
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // ← THE stealth call: WDA_EXCLUDEFROMCAPTURE on Windows 10 2004+ (build 19041+)
  // On older builds falls back to WDA_MONITOR (window renders black in captures)
  win.setContentProtection(true)

  // Start interactive (not click-through)
  win.setIgnoreMouseEvents(false)

  return win
}

/**
 * Summon and focus the window, targeting the query input field.
 */
export function focusForInput(win: BrowserWindow): void {
  win.show()
  win.focus()
  win.webContents.send('input:focus')
}

/**
 * Remove focus from the overlay window, returning it to the previously focused application.
 */
export function releaseFocus(win: BrowserWindow): void {
  win.blur()
}
