import {
  BODY_DEFAULT_WIDTH,
  BODY_FONT,
  BODY_MIN_WIDTH,
  DEFAULT_RICH_NOTE_SPECS,
  prepareRichInlineNote,
  layoutRichNote,
  LINE_HEIGHT,
  NARROW_VIEWPORT_QUERY,
  resolveRichNoteBodyWidth,
  type PreparedRichInlineNote,
  type RichNoteLayout,
} from './rich-note.model.ts'

type State = {
  events: {
    sliderValue: number | null
  }
  requestedWidth: number
}

const domCache = {
  root: document.documentElement, // cache lifetime: page
  narrowViewport: window.matchMedia(NARROW_VIEWPORT_QUERY), // cache lifetime: page
  noteBody: getRequiredDiv('note-body'), // cache lifetime: page
  widthSlider: getRequiredInput('width-slider'), // cache lifetime: page
  widthValue: getRequiredSpan('width-value'), // cache lifetime: page
}

const richInline = prepareRichInlineNote(DEFAULT_RICH_NOTE_SPECS)

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

function renderBody(note: PreparedRichInlineNote, layout: RichNoteLayout): void {
  domCache.noteBody.textContent = ''
  const fragment = document.createDocumentFragment()

  for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex++) {
    const line = layout.lines[lineIndex]!
    // Each Pretext line is one line box, so the browser orders its bidi runs.
    // The body font sets the baseline.
    const row = document.createElement('div')
    row.className = 'line-row'
    row.dir = layout.direction
    row.style.setProperty('--font', BODY_FONT)
    row.style.top = `${lineIndex * LINE_HEIGHT}px`

    for (let fragmentIndex = 0; fragmentIndex < line.fragments.length; fragmentIndex++) {
      const part = line.fragments[fragmentIndex]!
      const element = renderPart(part.className, part.font, part.href, part.text)
      // A collapsed space paints inside the element of the item whose font
      // measured it: this fragment's, the previous fragment's, or, for an item
      // holding only whitespace, an element of its own.
      const gapItemIndex = part.gapItemIndex
      if (gapItemIndex === part.itemIndex) {
        element.prepend(' ')
      } else if (gapItemIndex >= 0 && gapItemIndex === line.fragments[fragmentIndex - 1]?.itemIndex) {
        row.lastElementChild!.append(' ')
      } else if (gapItemIndex >= 0) {
        row.appendChild(renderPart(note.classNames[gapItemIndex]!, note.fonts[gapItemIndex]!, note.hrefs[gapItemIndex] ?? null, ' '))
      }
      row.appendChild(element)
    }

    fragment.appendChild(row)
  }

  domCache.noteBody.appendChild(fragment)
}

function renderPart(className: string, font: string, href: string | null, text: string): HTMLElement {
  const element = href === null
    ? document.createElement('span')
    : document.createElement('a')
  element.className = className
  // Paint with the font the item was measured with.
  element.style.setProperty('--font', font)
  element.textContent = text
  if (element instanceof HTMLAnchorElement && href !== null) {
    element.href = href
    element.target = '_blank'
    element.rel = 'noreferrer'
  }
  return element
}

function render(): void {
  // DOM reads
  // Chrome's root clientWidth ignores an empty gutter. body has no margin,
  // border or padding, so its clientWidth is the room the page lays out in.
  const viewportWidth = document.body.clientWidth
  const narrowViewport = domCache.narrowViewport.matches

  // Handle inputs
  let requestedWidth = st.requestedWidth
  if (st.events.sliderValue !== null) requestedWidth = st.events.sliderValue

  // Layout
  const { bodyWidth, maxBodyWidth, notePaddingX } = resolveRichNoteBodyWidth(viewportWidth, narrowViewport, requestedWidth)
  const layout = layoutRichNote(richInline, bodyWidth, notePaddingX)

  // Commit state
  st.requestedWidth = bodyWidth
  st.events.sliderValue = null

  // DOM writes
  domCache.widthSlider.min = String(BODY_MIN_WIDTH)
  domCache.widthSlider.max = String(maxBodyWidth)
  domCache.widthSlider.value = String(bodyWidth)
  domCache.widthValue.textContent = `${Math.round(bodyWidth)}px`
  domCache.root.style.setProperty('--note-width', `${layout.noteWidth}px`)
  domCache.root.style.setProperty('--note-padding-x', `${notePaddingX}px`)
  domCache.root.style.setProperty('--note-content-width', `${bodyWidth}px`)
  domCache.noteBody.style.height = `${layout.noteBodyHeight}px`

  renderBody(richInline, layout)
}
