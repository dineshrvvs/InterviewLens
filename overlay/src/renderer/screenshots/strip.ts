import { ShotMeta } from '../../preload/shot'

const stripContainer = document.getElementById('screenshot-strip') as HTMLDivElement
const stripEmpty = document.getElementById('strip-empty') as HTMLDivElement

function formatAbsoluteTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  const s = d.getSeconds().toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

/**
 * Creates the DOM element for a screenshot thumbnail.
 */
async function createThumbElement(meta: ShotMeta): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  container.className = 'screenshot-thumb-container no-drag'
  if (!meta.included) {
    container.classList.add('excluded')
  }

  // Retrieve thumbnail data URL from main process
  const thumbUrl = await window.shot.thumb(meta.id)

  // Thumbnail Image
  const img = document.createElement('img')
  img.className = 'screenshot-thumb-img'
  img.src = thumbUrl || ''
  img.alt = `Screenshot at ${formatAbsoluteTime(meta.tStart)}`

  // Click to preview large modal
  img.addEventListener('click', async () => {
    try {
      const fullJpeg = await window.shot.preview(meta.id)
      if (fullJpeg) {
        showPreviewModal(`data:image/jpeg;base64,${fullJpeg}`)
      }
    } catch (err) {
      console.error('[Strip] Failed to load preview:', err)
    }
  })

  // Timestamp overlay
  const timeOverlay = document.createElement('span')
  timeOverlay.className = 'screenshot-thumb-time'
  timeOverlay.textContent = formatAbsoluteTime(meta.tStart)

  // Include checkbox
  const checkboxContainer = document.createElement('label')
  checkboxContainer.className = 'screenshot-thumb-include-lbl no-drag'

  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.className = 'screenshot-thumb-include-cb'
  checkbox.checked = meta.included
  checkbox.addEventListener('change', async () => {
    await window.shot.toggleInclude(meta.id)
    container.classList.toggle('excluded', !checkbox.checked)
  })

  const checkMark = document.createElement('span')
  checkMark.className = 'screenshot-thumb-checkmark'
  checkMark.textContent = '✓'

  checkboxContainer.appendChild(checkbox)
  checkboxContainer.appendChild(checkMark)

  // Delete button (×)
  const btnRemove = document.createElement('button')
  btnRemove.className = 'screenshot-thumb-remove-btn no-drag'
  btnRemove.innerHTML = '&times;'
  btnRemove.title = 'Remove screenshot'
  btnRemove.addEventListener('click', async (e) => {
    e.stopPropagation()
    await window.shot.remove(meta.id)
    container.remove()
    checkEmptyState()
  })

  container.appendChild(img)
  container.appendChild(timeOverlay)
  container.appendChild(checkboxContainer)
  container.appendChild(btnRemove)

  return container
}

/**
 * Checks if the strip has any screenshot thumbnails and displays the empty state if not.
 */
function checkEmptyState(): void {
  const thumbContainers = stripContainer.querySelectorAll('.screenshot-thumb-container')
  if (thumbContainers.length === 0) {
    if (stripEmpty) stripEmpty.style.display = ''
  } else {
    if (stripEmpty) stripEmpty.style.display = 'none'
  }
}

/**
 * Re-renders the entire screenshot thumbnail strip.
 */
export async function refreshStrip(): Promise<void> {
  // Clear any existing thumbnail elements (excluding the empty message placeholder)
  const existingThumbs = stripContainer.querySelectorAll('.screenshot-thumb-container')
  existingThumbs.forEach((el) => el.remove())

  try {
    const list = await window.shot.list()
    if (list.length > 0) {
      if (stripEmpty) stripEmpty.style.display = 'none'
      
      // Render elements in chronological order
      for (const meta of list) {
        const el = await createThumbElement(meta)
        stripContainer.appendChild(el)
      }
    } else {
      if (stripEmpty) stripEmpty.style.display = ''
    }
  } catch (err) {
    console.error('[Strip] Error refreshing strip:', err)
  }
}

/**
 * Appends a single newly captured screenshot element to the strip.
 */
export async function appendCapturedShot(id: string, tStart: number): Promise<void> {
  if (stripEmpty) stripEmpty.style.display = 'none'
  
  const meta: ShotMeta = { id, tStart, included: true }
  const el = await createThumbElement(meta)
  stripContainer.appendChild(el)
  
  // Auto scroll horizontally to the end of the strip
  requestAnimationFrame(() => {
    stripContainer.scrollLeft = stripContainer.scrollWidth
  })
}

/**
 * Displays a fullscreen preview modal of the selected screenshot.
 */
function showPreviewModal(imageSrc: string): void {
  const backdrop = document.createElement('div')
  backdrop.className = 'screenshot-preview-backdrop no-drag'

  const container = document.createElement('div')
  container.className = 'screenshot-preview-container'

  const img = document.createElement('img')
  img.className = 'screenshot-preview-img'
  img.src = imageSrc

  const closeBtn = document.createElement('button')
  closeBtn.className = 'screenshot-preview-close'
  closeBtn.innerHTML = '&times;'

  const closeAction = () => backdrop.remove()

  closeBtn.addEventListener('click', closeAction)
  backdrop.addEventListener('click', closeAction)
  container.addEventListener('click', (e) => e.stopPropagation()) // prevent close on clicking image

  container.appendChild(img)
  container.appendChild(closeBtn)
  backdrop.appendChild(container)
  document.body.appendChild(backdrop)
}
