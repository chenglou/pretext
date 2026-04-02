import {
  BODY_DEFAULT_WIDTH,
  BODY_MIN_WIDTH,
  DEFAULT_RICH_NOTE_SPECS,
  prepareRichInlineFlow,
  layoutRichNote,
  LINE_HEIGHT,
  resolveRichNoteBodyWidth,
  type RichLine,
} from './rich-note.model.ts'

type State = {
  events: {
    sliderValue: number | null
  }
  requestedWidth: number
}

const domCache = {
  root: document.documentElement, // cache lifetime: page
  noteBody: getRequiredDiv('note-body'), // cache lifetime: page
  widthSlider: getRequiredInput('width-slider'), // cache lifetime: page
  widthValue: getRequiredSpan('width-value'), // cache lifetime: page
}

const richInline = prepareRichInlineFlow(DEFAULT_RICH_NOTE_SPECS)

const st: State = {
  events: {
    sliderValue: null,
  },
  requestedWidth: BODY_DEFAULT_WIDTH,
}

let scheduledRaf: number | null = null

domCache.widthSlider.addEventListener('input', () => {
  st.events.sliderValue = Number.parseInt(domCache.widthSlider.value, 10)
  scheduleRender()
})

window.addEventListener('resize', () => scheduleRender())

scheduleRender()

function getRequiredDiv(id: string): HTMLDivElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLDivElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredInput(id: string): HTMLInputElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLInputElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredSpan(id: string): HTMLSpanElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLSpanElement)) throw new Error(`#${id} not found`)
  return element
}

function scheduleRender(): void {
  if (scheduledRaf !== null) return
  scheduledRaf = requestAnimationFrame(function renderRichNoteDemo() {
    scheduledRaf = null
    render()
  })
}

function renderBody(lines: RichLine[]): void {
  domCache.noteBody.textContent = ''
  const fragment = document.createDocumentFragment()

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!
    const row = document.createElement('div')
    row.className = 'line-row'
    row.style.top = `${lineIndex * LINE_HEIGHT}px`

    for (let fragmentIndex = 0; fragmentIndex < line.fragments.length; fragmentIndex++) {
      const part = line.fragments[fragmentIndex]!
      const element = document.createElement('span')
      element.className = part.className
      element.textContent = part.text
      if (part.leadingGap > 0) element.style.marginLeft = `${part.leadingGap}px`
      row.appendChild(element)
    }

    fragment.appendChild(row)
  }

  domCache.noteBody.appendChild(fragment)
}

function render(): void {
  // DOM reads
  const viewportWidth = document.documentElement.clientWidth

  // Handle inputs
  let requestedWidth = st.requestedWidth
  if (st.events.sliderValue !== null) requestedWidth = st.events.sliderValue

  // Layout
  const { bodyWidth, maxBodyWidth } = resolveRichNoteBodyWidth(viewportWidth, requestedWidth)
  const layout = layoutRichNote(richInline, bodyWidth)

  // Commit state
  st.requestedWidth = bodyWidth
  st.events.sliderValue = null

  // DOM writes
  domCache.widthSlider.min = String(BODY_MIN_WIDTH)
  domCache.widthSlider.max = String(maxBodyWidth)
  domCache.widthSlider.value = String(bodyWidth)
  domCache.widthValue.textContent = `${Math.round(bodyWidth)}px`
  domCache.root.style.setProperty('--note-width', `${layout.noteWidth}px`)
  domCache.root.style.setProperty('--note-content-width', `${bodyWidth}px`)
  domCache.noteBody.style.height = `${layout.noteBodyHeight}px`

  renderBody(layout.lines)
}
