/**
 * Transcript Panel — renders a live, scrolling, source-labeled transcript.
 *
 * Maintains an in-memory transcript store that Phase 4 will read from.
 * Each entry is rendered with a source label (Them/You), text, and timestamp.
 */

// ─── Types ──────────────────────────────────────────────────────────────────────
interface TranscriptEntry {
  source: 'system' | 'mic'
  text: string
  tStart: number
  tEnd: number
  final: boolean
}

// ─── State ──────────────────────────────────────────────────────────────────────
const transcriptStore: TranscriptEntry[] = []
const speakingState: Record<'system' | 'mic', boolean> = {
  system: false,
  mic: false
}

// ─── DOM refs ───────────────────────────────────────────────────────────────────
const entriesContainer = document.getElementById('transcript-entries') as HTMLDivElement
const emptyMessage = document.getElementById('transcript-empty') as HTMLDivElement
const pane = document.getElementById('transcript-pane') as HTMLDivElement

// Speaking indicator elements (created dynamically)
let systemIndicator: HTMLDivElement | null = null
let micIndicator: HTMLDivElement | null = null

/**
 * Get the source label for display
 */
function getSourceLabel(source: 'system' | 'mic'): string {
  return source === 'system' ? 'Them' : 'You'
}

/**
 * Format a timestamp as relative time (e.g., "0:05", "1:23")
 */
function formatTimestamp(tStart: number): string {
  const now = Date.now()
  const diffSec = Math.max(0, Math.floor((now - tStart) / 1000))
  const min = Math.floor(diffSec / 60)
  const sec = diffSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

/**
 * Format as absolute time (HH:MM:SS)
 */
function formatAbsoluteTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  const s = d.getSeconds().toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

/**
 * Create a transcript entry DOM element
 */
function createEntryElement(entry: TranscriptEntry): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `transcript-entry source-${entry.source === 'system' ? 'them' : 'you'}`
  el.setAttribute('data-source', entry.source)

  const header = document.createElement('div')
  header.className = 'transcript-entry-header'

  const label = document.createElement('span')
  label.className = 'transcript-source-label'
  label.textContent = getSourceLabel(entry.source)

  const time = document.createElement('span')
  time.className = 'transcript-timestamp'
  time.textContent = formatAbsoluteTime(entry.tStart)

  header.appendChild(label)
  header.appendChild(time)

  const text = document.createElement('div')
  text.className = 'transcript-text'
  text.textContent = entry.text

  el.appendChild(header)
  el.appendChild(text)

  return el
}

/**
 * Create or update a speaking indicator
 */
function createSpeakingIndicator(source: 'system' | 'mic'): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `transcript-speaking source-${source === 'system' ? 'them' : 'you'}`
  el.id = `speaking-${source}`

  const label = document.createElement('span')
  label.className = 'transcript-source-label'
  label.textContent = getSourceLabel(source)

  const dots = document.createElement('span')
  dots.className = 'speaking-dots'
  dots.innerHTML = '<span>.</span><span>.</span><span>.</span>'

  el.appendChild(label)
  el.appendChild(dots)

  return el
}

/**
 * Auto-scroll the transcript pane to the bottom
 */
function scrollToBottom(): void {
  requestAnimationFrame(() => {
    pane.scrollTop = pane.scrollHeight
  })
}

/**
 * Remove the empty state message if present
 */
function hideEmptyMessage(): void {
  if (emptyMessage) {
    emptyMessage.style.display = 'none'
  }
}

/**
 * Update speaking indicators in the DOM
 */
function updateSpeakingIndicators(): void {
  // Remove existing indicators
  if (systemIndicator) {
    systemIndicator.remove()
    systemIndicator = null
  }
  if (micIndicator) {
    micIndicator.remove()
    micIndicator = null
  }

  // Add indicators for active sources
  if (speakingState.system) {
    systemIndicator = createSpeakingIndicator('system')
    entriesContainer.appendChild(systemIndicator)
  }
  if (speakingState.mic) {
    micIndicator = createSpeakingIndicator('mic')
    entriesContainer.appendChild(micIndicator)
  }

  if (speakingState.system || speakingState.mic) {
    scrollToBottom()
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Add a transcript entry to the store and render it.
 * This is the canonical transcript store — Phase 4 reads from it.
 */
export function addTranscript(entry: TranscriptEntry): void {
  transcriptStore.push(entry)
  hideEmptyMessage()

  // Remove speaking indicators before adding new entry
  if (systemIndicator) systemIndicator.remove()
  if (micIndicator) micIndicator.remove()
  systemIndicator = null
  micIndicator = null

  // Render the entry
  const el = createEntryElement(entry)
  entriesContainer.appendChild(el)

  // Re-add speaking indicators after the entry
  updateSpeakingIndicators()

  scrollToBottom()
}

/**
 * Update the VAD speaking state for a source
 */
export function setSpeaking(source: 'system' | 'mic', isSpeaking: boolean): void {
  speakingState[source] = isSpeaking
  updateSpeakingIndicators()
}

/**
 * Clear all transcripts
 */
export function clearTranscripts(): void {
  transcriptStore.length = 0
  speakingState.system = false
  speakingState.mic = false

  // Clear DOM
  entriesContainer.innerHTML = ''
  if (emptyMessage) {
    emptyMessage.style.display = ''
    entriesContainer.appendChild(emptyMessage)
  }

  systemIndicator = null
  micIndicator = null
}

/**
 * Get the full transcript store (for Phase 4 consumption)
 */
export function getTranscriptStore(): readonly TranscriptEntry[] {
  return transcriptStore
}
