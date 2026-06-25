const drawer = document.getElementById('settings-drawer') as HTMLDivElement
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement
const btnCloseSettings = document.getElementById('btn-settings-close') as HTMLButtonElement
const form = document.getElementById('settings-form') as HTMLFormElement

/**
 * Initializes settings panel drawer triggers and form submit listeners.
 */
export function initSettingsPanel(): void {
  if (!drawer || !btnSettings || !btnCloseSettings || !form) return

  // Open settings drawer
  btnSettings.addEventListener('click', async () => {
    try {
      const data = await window.settings.get()
      populateForm(data.settings, data.keys)
      drawer.classList.add('open')
    } catch (err) {
      console.error('[Settings UI] Failed to load settings:', err)
    }
  })

  // Close settings drawer
  btnCloseSettings.addEventListener('click', () => {
    drawer.classList.remove('open')
  })

  // Handle form save
  form.addEventListener('submit', async (e) => {
    e.preventDefault()

    const payload = serializeForm()
    try {
      await window.settings.save(payload.settings, payload.keys)
      console.log('[Settings UI] Settings saved successfully!')
      drawer.classList.remove('open')
      
      const statusLine = document.getElementById('status-line')
      if (statusLine) {
        statusLine.textContent = 'Settings saved and applied!'
        setTimeout(() => {
          if (statusLine.textContent === 'Settings saved and applied!') {
            statusLine.textContent = 'Overlay ready'
          }
        }, 3000)
      }
    } catch (err) {
      console.error('[Settings UI] Failed to save settings:', err)
    }
  })
}

function populateForm(settings: any, keys: any): void {
  const setVal = (id: string, val: any) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    if (el) el.value = val !== undefined ? val : ''
  }

  const setCheckbox = (id: string, checked: boolean) => {
    const el = document.getElementById(id) as HTMLInputElement
    if (el) el.checked = !!checked
  }

  // Secret API Keys (Masked)
  setVal('key-gemini', keys.GEMINI)
  setVal('key-groq', keys.GROQ)
  setVal('key-openrouter', keys.OPENROUTER)

  // System Prompts
  setVal('prompt-fast', settings.llm?.fast?.prompt || '')
  setVal('prompt-thinking', settings.llm?.thinking?.prompt || '')

  // Providers & Models
  setVal('provider-fast', settings.llm?.fast?.provider || 'groq')
  setVal('model-fast', settings.llm?.fast?.model || 'llama-3.3-70b-versatile')

  setVal('provider-thinking', settings.llm?.thinking?.provider || 'gemini-pro')
  setVal('model-thinking', settings.llm?.thinking?.model || 'gemini-2.5-pro')

  setVal('ollama-url', settings.llm?.ollama?.baseURL || 'http://localhost:11434/v1')

  // STT Idle Options
  setCheckbox('stt-idle-unload', settings.stt?.idleUnload !== false)
  setVal('stt-idle-timeout', settings.stt?.idleTimeoutMins !== undefined ? settings.stt.idleTimeoutMins : 2)
  setVal('stt-vad-threshold', settings.stt?.vad?.threshold !== undefined ? settings.stt.vad.threshold : 0.5)

  // Screenshot capture options
  setVal('shot-mode', settings.screenshot?.captureMode || 'primary')
  setCheckbox('shot-hide', !!settings.screenshot?.hideBeforeCapture)
}

function serializeForm(): { settings: any; keys: any } {
  const getVal = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    return el ? el.value.trim() : ''
  }

  const getNumVal = (id: string, def: number) => {
    const el = document.getElementById(id) as HTMLInputElement
    return el && el.value ? parseFloat(el.value) : def
  }

  const getCheckbox = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement
    return el ? el.checked : false
  }

  const keys: any = {}
  const rawGemini = getVal('key-gemini')
  const rawGroq = getVal('key-groq')
  const rawOpenRouter = getVal('key-openrouter')

  // Only assign if they are not the masked placeholder
  if (rawGemini !== undefined) keys.GEMINI = rawGemini
  if (rawGroq !== undefined) keys.GROQ = rawGroq
  if (rawOpenRouter !== undefined) keys.OPENROUTER = rawOpenRouter

  const settings = {
    stt: {
      idleUnload: getCheckbox('stt-idle-unload'),
      idleTimeoutMins: getNumVal('stt-idle-timeout', 2),
      vad: {
        threshold: getNumVal('stt-vad-threshold', 0.5)
      }
    },
    screenshot: {
      captureMode: getVal('shot-mode'),
      hideBeforeCapture: getCheckbox('shot-hide')
    },
    llm: {
      fast: {
        provider: getVal('provider-fast'),
        model: getVal('model-fast'),
        prompt: getVal('prompt-fast')
      },
      thinking: {
        provider: getVal('provider-thinking'),
        model: getVal('model-thinking'),
        prompt: getVal('prompt-thinking')
      },
      ollama: {
        baseURL: getVal('ollama-url')
      }
    }
  }

  return { settings, keys }
}
