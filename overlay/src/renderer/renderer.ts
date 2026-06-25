import { startCapture, stopCapture } from './audio/capture'
import { addTranscript, setSpeaking, clearTranscripts, getTranscriptStore } from './transcript/panel'
import { refreshStrip, appendCapturedShot } from './screenshots/strip'
import { startResponse, appendToken, finalizeResponse, showError, clearResponse } from './response/panel'
import { initInputBox } from './input/box'
import { initSettingsPanel } from './settings/panel'

// ─── STT event wiring (Phase 2) ──────────────────────────────────────────────
const sttStatus = document.getElementById('stt-status') as HTMLSpanElement

window.stt.onTranscript((t) => addTranscript(t))
window.stt.onSpeaking((source, isSpeaking) => setSpeaking(source, isSpeaking))

window.stt.onReady(() => {
  console.log('[Renderer] STT model loaded')
  if (sttStatus) {
    sttStatus.textContent = 'ready ✓'
    sttStatus.className = 'stt-status ready'
  }
})

// ─── Screen Capture event wiring (Phase 3) ───────────────────────────────────
const btnCapture = document.getElementById('btn-capture') as HTMLButtonElement

if (btnCapture) {
  btnCapture.addEventListener('click', async () => {
    btnCapture.disabled = true
    const origText = btnCapture.textContent
    btnCapture.textContent = 'Capturing...'
    try {
      await window.shot.capture()
    } catch (err) {
      console.error('[Renderer] Capture failed:', err)
    } finally {
      btnCapture.disabled = false
      btnCapture.textContent = origText
    }
  })
}

window.shot.onCaptured((shot) => {
  appendCapturedShot(shot.id, shot.tStart)
})

window.shot.onError((message) => {
  console.error('[Renderer] Screenshot error:', message)
  const statusEl = document.getElementById('status-line')
  if (statusEl) {
    statusEl.textContent = `Capture error: ${message}`
  }
})

// Load any existing screenshots in the store on startup
refreshStrip()

window.stt.onError((message) => {
  console.error('[Renderer] STT error:', message)
  if (sttStatus) {
    sttStatus.textContent = 'error'
    sttStatus.className = 'stt-status error'
  }
})

// ─── LLM Copilot event wiring (Phase 4) ──────────────────────────────────────
const btnFast = document.getElementById('btn-fast') as HTMLButtonElement
const btnThinking = document.getElementById('btn-thinking') as HTMLButtonElement

function updateLlmButtons(generating: boolean): void {
  if (btnFast) btnFast.disabled = generating
  if (btnThinking) btnThinking.disabled = generating
}

if (btnFast) {
  btnFast.addEventListener('click', async () => {
    updateLlmButtons(true)
    try {
      await window.llm.run('fast')
    } catch (err) {
      console.error('[Renderer] Fast copilot trigger failed:', err)
      updateLlmButtons(false)
    }
  })
}

if (btnThinking) {
  btnThinking.addEventListener('click', async () => {
    updateLlmButtons(true)
    try {
      await window.llm.run('thinking')
    } catch (err) {
      console.error('[Renderer] Thinking copilot trigger failed:', err)
      updateLlmButtons(false)
    }
  })
}

window.llm.onStart((data) => {
  updateLlmButtons(true)
  startResponse(data.id, data.mode, data.provider)
})

window.llm.onToken((data) => {
  appendToken(data.id, data.delta)
})

window.llm.onDone((data) => {
  finalizeResponse(data.id)
  updateLlmButtons(false)
})

window.llm.onError((data) => {
  showError(data.id, data.error)
  updateLlmButtons(false)
})

// ─── Click-through UI ────────────────────────────────────────────────────────
const ctDot = document.getElementById('ct-dot') as HTMLSpanElement
const ctLabel = document.getElementById('ct-label') as HTMLSpanElement

function updateClickThroughUI(enabled: boolean): void {
  if (enabled) {
    ctDot.classList.add('active')
    ctLabel.textContent = 'Click-through: ON'
  } else {
    ctDot.classList.remove('active')
    ctLabel.textContent = 'Click-through: OFF'
  }
}

window.overlay.onClickThroughChanged((enabled) => {
  updateClickThroughUI(enabled)
})

window.overlay.getClickThroughState().then((enabled) => {
  updateClickThroughUI(enabled)
})

// ─── Audio Capture Toggles ───────────────────────────────────────────────────
const btnSystem = document.getElementById('btn-system') as HTMLButtonElement
const btnMic = document.getElementById('btn-mic') as HTMLButtonElement
const statusLine = document.getElementById('status-line') as HTMLDivElement

let isSystemActive = false
let isMicActive = false

async function toggleSystemAudio(): Promise<void> {
  if (!isSystemActive) {
    try {
      statusLine.textContent = 'Starting system loopback...'
      await startCapture('system')
      isSystemActive = true
      btnSystem.classList.add('active')
      btnSystem.textContent = 'System: ON'
      statusLine.textContent = 'System loopback capturing'
    } catch (err: any) {
      statusLine.textContent = `System capture error: ${err.message || err}`
    }
  } else {
    stopCapture('system')
    isSystemActive = false
    btnSystem.classList.remove('active')
    btnSystem.textContent = 'System: OFF'
    statusLine.textContent = 'System loopback stopped'
  }
}

async function toggleMicAudio(): Promise<void> {
  if (!isMicActive) {
    try {
      statusLine.textContent = 'Starting mic capture...'
      await startCapture('mic')
      isMicActive = true
      btnMic.classList.add('active')
      btnMic.textContent = 'Mic: ON'
      statusLine.textContent = 'Mic capturing'
    } catch (err: any) {
      statusLine.textContent = `Mic capture error: ${err.message || err}`
    }
  } else {
    stopCapture('mic')
    isMicActive = false
    btnMic.classList.remove('active')
    btnMic.textContent = 'Mic: OFF'
    statusLine.textContent = 'Mic stopped'
  }
}

btnSystem.addEventListener('click', toggleSystemAudio)
btnMic.addEventListener('click', toggleMicAudio)

// ─── Record 10 Seconds Debug Actions ─────────────────────────────────────────
const btnRecSystem = document.getElementById('btn-rec-system') as HTMLButtonElement
const btnRecMic = document.getElementById('btn-rec-mic') as HTMLButtonElement

async function recordTenSeconds(source: 'system' | 'mic', btn: HTMLButtonElement): Promise<void> {
  const isAlreadyActive = source === 'system' ? isSystemActive : isMicActive

  btn.disabled = true
  btn.classList.add('recording')
  
  let countdown = 10
  btn.textContent = `Rec ${countdown}s`

  const intervalId = setInterval(() => {
    countdown--
    if (countdown > 0) {
      btn.textContent = `Rec ${countdown}s`
    }
  }, 1000)

  // Ensure capture is started
  let startedLocally = false
  if (!isAlreadyActive) {
    try {
      await startCapture(source)
      startedLocally = true
      if (source === 'system') {
        isSystemActive = true
        btnSystem.classList.add('active')
        btnSystem.textContent = 'System: ON'
      } else {
        isMicActive = true
        btnMic.classList.add('active')
        btnMic.textContent = 'Mic: ON'
      }
    } catch (err: any) {
      clearInterval(intervalId)
      btn.disabled = false
      btn.classList.remove('recording')
      btn.textContent = 'Record 10s'
      statusLine.textContent = `Capture error: ${err.message || err}`
      return
    }
  } else {
    // If already active, tell main process to clear buffer so we get a clean 10s dump
    window.audio.start(source)
  }

  statusLine.textContent = `Recording 10s of ${source} audio...`

  setTimeout(async () => {
    clearInterval(intervalId)
    
    statusLine.textContent = `Dumping WAV file for ${source}...`
    const result = await window.audio.dumpWav(source)

    if (startedLocally) {
      stopCapture(source)
      if (source === 'system') {
        isSystemActive = false
        btnSystem.classList.remove('active')
        btnSystem.textContent = 'System: OFF'
      } else {
        isMicActive = false
        btnMic.classList.remove('active')
        btnMic.textContent = 'Mic: OFF'
      }
    }

    btn.disabled = false
    btn.classList.remove('recording')
    btn.textContent = 'Record 10s'

    if (result.success) {
      // Show short filename for clean display
      const parts = result.filePath ? result.filePath.split(/[\\/]/) : []
      const filename = parts[parts.length - 1] || 'audio.wav'
      statusLine.textContent = `WAV dumped: ${filename}`
    } else {
      statusLine.textContent = `Failed to dump WAV: ${result.reason}`
    }
  }, 10000)
}

btnRecSystem.addEventListener('click', () => recordTenSeconds('system', btnRecSystem))
btnRecMic.addEventListener('click', () => recordTenSeconds('mic', btnRecMic))

// ─── Phase 5: Input & Settings Panel Initialization ─────────────────────────
initInputBox()
initSettingsPanel()

// ─── STT Unload / Loading Status events ──────────────────────────────────────
window.stt.onLoading(() => {
  console.log('[Renderer] STT model loading...')
  if (sttStatus) {
    sttStatus.textContent = 'loading model…'
    sttStatus.className = 'stt-status loading'
  }
})

window.stt.onUnloaded(() => {
  console.log('[Renderer] STT model unloaded')
  if (sttStatus) {
    sttStatus.textContent = 'unloaded (idle)'
    sttStatus.className = 'stt-status unloaded'
  }
})

// ─── Session actions: Clear & Save ───────────────────────────────────────────
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement
if (btnClear) {
  btnClear.addEventListener('click', async () => {
    try {
      await window.overlay.clearContext()
    } catch (err) {
      console.error('[Renderer] Clear context failed:', err)
    }
  })
}

window.overlay.onContextCleared(() => {
  clearTranscripts()
  clearResponse()
  refreshStrip()
  if (statusLine) {
    statusLine.textContent = 'Context and screenshots cleared'
    setTimeout(() => {
      if (statusLine.textContent === 'Context and screenshots cleared') {
        statusLine.textContent = 'Overlay ready'
      }
    }, 3000)
  }
})

const btnSaveSession = document.getElementById('btn-save-session') as HTMLButtonElement
if (btnSaveSession) {
  btnSaveSession.addEventListener('click', () => {
    const transcripts = getTranscriptStore()
    const responseEl = document.getElementById('response-text')
    const responseText = responseEl ? responseEl.textContent || '' : ''
    
    let content = `# InterviewLens Session Log\n`
    content += `Exported: ${new Date().toLocaleString()}\n\n`
    
    content += `## Transcripts\n`
    if (transcripts.length === 0) {
      content += `*No transcripts in this session.*\n`
    } else {
      transcripts.forEach(t => {
        const label = t.source === 'system' ? 'Them (System)' : 'You (Mic)'
        const time = new Date(t.tStart).toLocaleTimeString()
        content += `[${time}] **${label}**: ${t.text}\n`
      })
    }
    
    content += `\n## Copilot Suggestions\n`
    content += responseText || '*No suggestions generated yet.*\n'
    
    try {
      const blob = new Blob([content], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `interviewlens-session-${Date.now()}.md`
      a.click()
      URL.revokeObjectURL(url)

      if (statusLine) {
        statusLine.textContent = 'Session saved successfully!'
        setTimeout(() => {
          if (statusLine.textContent === 'Session saved successfully!') {
            statusLine.textContent = 'Overlay ready'
          }
        }, 3000)
      }
    } catch (err) {
      console.error('[Renderer] Save session failed:', err)
    }
  })
}

