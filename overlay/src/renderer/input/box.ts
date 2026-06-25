const inputEl = document.getElementById('query-input') as HTMLInputElement
const btnMode = document.getElementById('query-mode-btn') as HTMLButtonElement

let mode: 'fast' | 'thinking' = 'fast'

/**
 * Initializes the keyboard input box event listeners and VAD modes.
 */
export function initInputBox(): void {
  if (!inputEl) return

  // Handle enter key to submit query
  inputEl.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const query = inputEl.value.trim()
      if (query) {
        inputEl.disabled = true
        try {
          await window.llm.run(mode, { userQuery: query })
        } catch (err) {
          console.error('[Input Box] Failed to run copilot query:', err)
        } finally {
          inputEl.disabled = false
          inputEl.value = ''
          // Release focus on submit
          window.overlay.releaseFocus()
        }
      }
    } else if (e.key === 'Escape') {
      // Release focus on escape
      window.overlay.releaseFocus()
    }
  })

  // Focus the input when summoned by main process
  window.input.onFocus(() => {
    inputEl.focus()
    inputEl.select()
  })

  // Wire mode toggle button if present
  if (btnMode) {
    btnMode.addEventListener('click', () => {
      if (mode === 'fast') {
        mode = 'thinking'
        btnMode.textContent = 'Thinking'
        btnMode.className = 'btn btn-mode-toggle btn-mode-thinking no-drag'
      } else {
        mode = 'fast'
        btnMode.textContent = 'Fast'
        btnMode.className = 'btn btn-mode-toggle btn-mode-fast no-drag'
      }
    })
  }
}

/**
 * Returns the currently selected typed query mode.
 */
export function getActiveQueryMode(): 'fast' | 'thinking' {
  return mode
}
