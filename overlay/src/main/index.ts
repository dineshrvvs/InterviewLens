import { app, globalShortcut, ipcMain } from 'electron'
import { join } from 'path'
import { createOverlayWindow, releaseFocus } from './window'
import { registerShortcuts, getClickThroughState } from './shortcuts'
import { setupAudio } from './audio'
import { startStt, stopStt } from './stt'
import { setupScreenshotHandlers, clear as clearScreenshot } from './screenshot'
import { setupLlmHandlers } from './llm/router'
import { loadSettings, saveSettings, saveWindowBounds, getSavedWindowBounds } from './settings'
import { clear as clearContext } from './context'
import { getApiKeys } from './llm/keys'

// ─── Single instance lock ────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

// ─── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Load settings from disk on startup
  loadSettings()

  // Initialize permission and display handlers before loading the window
  setupAudio()

  const win = createOverlayWindow()

  // Restore window position bounds if saved settings exist
  const savedBounds = getSavedWindowBounds()
  if (savedBounds) {
    win.setBounds(savedBounds)
  }

  // Track window moves to persist bounds
  win.on('moved', () => {
    saveWindowBounds(win.getBounds())
  })

  // Load renderer
  // In dev, electron-vite serves from a local dev server
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Forward renderer console messages to main terminal
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] [L${level}] ${message} (${sourceId}:${line})`)
  })

  // Register global shortcuts
  registerShortcuts(win)

  // Initialize screenshot IPC handlers
  setupScreenshotHandlers(win)

  // Initialize LLM router IPC handlers
  setupLlmHandlers(win)

  // Show without stealing focus
  win.showInactive()

  // IPC: renderer can request current click-through state
  ipcMain.handle('get-click-through-state', () => {
    return getClickThroughState()
  })

  // IPC Settings Get
  ipcMain.handle('settings:get', () => {
    const settings = loadSettings()
    const keys = getApiKeys()
    return {
      settings,
      keys: {
        GEMINI: keys.GEMINI ? '••••••••' : '',
        GROQ: keys.GROQ ? '••••••••' : '',
        OPENROUTER: keys.OPENROUTER ? '••••••••' : ''
      }
    }
  })

  // IPC Settings Save
  ipcMain.handle('settings:save', (_e, settings, keys) => {
    saveSettings(settings, keys)
  })

  // IPC Release Focus
  ipcMain.handle('overlay:release-focus', () => {
    releaseFocus(win)
  })

  // IPC Context Clear
  ipcMain.handle('context:clear', () => {
    clearContext()
    clearScreenshot()
    win.webContents.send('context:cleared')
    console.log('[Main] In-memory context and screenshots cleared.')
  })

  // Phase 2: Start the STT worker and relay transcripts to renderer
  startStt(win)
})

// Do not quit when the window is closed — the overlay is the only window
// and toggling hides it, not closes it.
app.on('window-all-closed', () => {
  // Intentionally empty: keep app alive
})

// Clean up global shortcuts on quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopStt()
})
