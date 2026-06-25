const pane = document.getElementById('response-pane') as HTMLDivElement
const badge = document.getElementById('response-badge') as HTMLSpanElement
const spinner = document.getElementById('response-spinner') as HTMLSpanElement
const textEl = document.getElementById('response-text') as HTMLDivElement

let currentResponseId = ''

/**
 * Resets the response panel state to idle.
 */
export function clearResponse(): void {
  currentResponseId = ''
  if (spinner) spinner.style.display = 'none'
  if (badge) {
    badge.textContent = 'Idle'
    badge.className = 'response-badge'
  }
  if (textEl) {
    textEl.textContent = 'Press Ctrl+Enter (Fast) or Ctrl+Shift+Enter (Thinking) to generate suggestions…'
    textEl.classList.remove('error-text')
  }
}

/**
 * Prepares the response panel for streaming a new response.
 */
export function startResponse(id: string, mode: 'fast' | 'thinking', provider: string): void {
  currentResponseId = id
  if (spinner) spinner.style.display = 'inline-block'
  if (badge) {
    const formattedProvider = provider.charAt(0).toUpperCase() + provider.slice(1)
    badge.textContent = `${mode === 'fast' ? 'Fast' : 'Thinking'} • ${formattedProvider}`
    badge.className = `response-badge badge-${mode}`
  }
  if (textEl) {
    textEl.textContent = ''
    textEl.classList.remove('error-text')
  }
}

/**
 * Appends a token to the response text container.
 */
export function appendToken(id: string, delta: string): void {
  if (id !== currentResponseId) return
  if (textEl) {
    // If it was empty or default text, make sure it is cleared
    if (textEl.textContent && textEl.textContent.startsWith('Press Ctrl+Enter')) {
      textEl.textContent = ''
    }
    
    // Unescape common HTML entities if returned raw by API (rare, but good safety)
    textEl.textContent += delta

    // Auto-scroll the response pane to the bottom so the user sees text streaming in
    requestAnimationFrame(() => {
      if (pane) {
        pane.scrollTop = pane.scrollHeight
      }
    })
  }
}

/**
 * Marks the active streaming response as completed.
 */
export function finalizeResponse(id: string): void {
  if (id !== currentResponseId) return
  if (spinner) spinner.style.display = 'none'
}

/**
 * Displays an error inside the response text container.
 */
export function showError(id: string, message: string): void {
  currentResponseId = id
  if (spinner) spinner.style.display = 'none'
  if (badge) {
    badge.textContent = 'Error'
    badge.className = 'response-badge badge-error'
  }
  if (textEl) {
    textEl.textContent = `Error: ${message}`
    textEl.classList.add('error-text')
  }
}
