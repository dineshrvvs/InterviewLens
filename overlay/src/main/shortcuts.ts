import { BrowserWindow, globalShortcut } from 'electron'
import { app } from 'electron'
import { HOTKEYS, SCREENSHOT } from './config'
import { capture } from './screenshot'
import { run } from './llm/router'
import { focusForInput } from './window'

let lastBounds: Electron.Rectangle | null = null
let clickThroughEnabled = false

function registerShortcut(
  accelerator: string,
  handler: () => void,
  label: string
): void {
  const success = globalShortcut.register(accelerator, handler)
  if (!success) {
    console.warn(
      `⚠ Failed to register shortcut "${accelerator}" for "${label}" — ` +
        'combo may be taken by another app. Rebind in config.ts.'
    )
  }
}

export function registerShortcuts(win: BrowserWindow): void {
  // ─── Toggle visibility ─────────────────────────────────────────────────────
  registerShortcut(
    HOTKEYS.toggleVisibility,
    () => {
      if (win.isVisible()) {
        lastBounds = win.getBounds()
        win.hide()
      } else {
        if (lastBounds) {
          win.setBounds(lastBounds)
        }
        win.showInactive() // never steal focus
      }
    },
    'Toggle visibility'
  )

  // ─── Toggle click-through ──────────────────────────────────────────────────
  registerShortcut(
    HOTKEYS.toggleClickThrough,
    () => {
      clickThroughEnabled = !clickThroughEnabled
      if (clickThroughEnabled) {
        // Mouse events pass to the app beneath; forward:true lets renderer still see hover
        win.setIgnoreMouseEvents(true, { forward: true })
      } else {
        win.setIgnoreMouseEvents(false)
      }
      // Notify renderer of the state change
      win.webContents.send('click-through-changed', clickThroughEnabled)
    },
    'Toggle click-through'
  )

  // ─── Nudge position ────────────────────────────────────────────────────────
  const NUDGE_PX = 20

  registerShortcut(
    HOTKEYS.nudgeUp,
    () => {
      const bounds = win.getBounds()
      win.setBounds({ ...bounds, y: bounds.y - NUDGE_PX })
    },
    'Nudge up'
  )

  registerShortcut(
    HOTKEYS.nudgeDown,
    () => {
      const bounds = win.getBounds()
      win.setBounds({ ...bounds, y: bounds.y + NUDGE_PX })
    },
    'Nudge down'
  )

  registerShortcut(
    HOTKEYS.nudgeLeft,
    () => {
      const bounds = win.getBounds()
      win.setBounds({ ...bounds, x: bounds.x - NUDGE_PX })
    },
    'Nudge left'
  )

  registerShortcut(
    HOTKEYS.nudgeRight,
    () => {
      const bounds = win.getBounds()
      win.setBounds({ ...bounds, x: bounds.x + NUDGE_PX })
    },
    'Nudge right'
  )

  // ─── Quit ──────────────────────────────────────────────────────────────────
  registerShortcut(
    HOTKEYS.quit,
    () => {
      app.quit()
    },
    'Quit'
  )

  // ─── Screenshot capture ────────────────────────────────────────────────────
  registerShortcut(
    SCREENSHOT.hotkey,
    () => {
      capture(win)
    },
    'Capture Screen'
  )

  // ─── Ask Copilot (Focus input) ──────────────────────────────────────────────
  registerShortcut(
    'Control+Space',
    () => {
      focusForInput(win)
    },
    'Ask Copilot'
  )

  // ─── Fast Mode LLM Copilot ──────────────────────────────────────────────────
  registerShortcut(
    'Control+Return',
    () => {
      run('fast', {}, win)
    },
    'Fast Copilot'
  )

  // ─── Thinking Mode LLM Copilot ──────────────────────────────────────────────
  registerShortcut(
    'Control+Shift+Return',
    () => {
      run('thinking', {}, win)
    },
    'Thinking Copilot'
  )
}

export function getClickThroughState(): boolean {
  return clickThroughEnabled
}
