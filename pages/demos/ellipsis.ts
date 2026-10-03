import {
  CARD_PADDING_X,
  CARD_PADDING_Y,
  DEFAULT_LINES,
  DEFAULT_TEXT_WIDTH,
  ELLIPSIS,
  FONT,
  getPageGeometry,
  layoutClamp,
  layoutMiddle,
  layoutMore,
  LESS_LABEL,
  LINE_HEIGHT,
  MAX_LINES,
  middleLabel,
  MIN_TEXT_WIDTH,
  MORE_LABEL,
  moreSample,
  samples,
  type ClampLayout,
} from './ellipsis.model.ts'

type State = {
  requestedTextWidth: number
  maxLines: number
  moreOpen: boolean
  events: {
    widthValue: number | null
    linesValue: number | null
    moreClicked: boolean
  }
}

// One painted line: its element and the text node inside it.
type LineDom = {
  root: HTMLDivElement
  text: Text
}

// A box of lines Pretext laid out. `lines` grows to the most lines painted so far.
type LinesDom = {
  box: HTMLDivElement
  lines: LineDom[]
}

// cache lifetime: page, for every node.
type DomCache = {
  page: HTMLElement
  widthSlider: HTMLInputElement
  widthValue: HTMLSpanElement
  linesSlider: HTMLInputElement
  linesValue: HTMLSpanElement
  boxes: HTMLDivElement[]
  clamps: LinesDom[]
  middle: LineDom
  more: LinesDom
  moreLink: HTMLButtonElement
  moreLinkLine: number // the line the link is attached to, -1 while detached
}

const st: State = {
  requestedTextWidth: DEFAULT_TEXT_WIDTH,
  maxLines: DEFAULT_LINES,
  moreOpen: false,
  events: {
    widthValue: null,
    linesValue: null,
    moreClicked: false,
  },
}

const domCache = createDom()
let scheduledRaf: number | null = null

domCache.widthSlider.addEventListener('input', () => {
  st.events.widthValue = Number.parseInt(domCache.widthSlider.value, 10)
  scheduleRender()
})

domCache.linesSlider.addEventListener('input', () => {
  st.events.linesValue = Number.parseInt(domCache.linesSlider.value, 10)
  scheduleRender()
})

domCache.moreLink.addEventListener('click', () => {
  st.events.moreClicked = true
  scheduleRender()
})

window.addEventListener('resize', () => {
  scheduleRender()
})

document.fonts.ready.then(() => {
  scheduleRender()
})

scheduleRender()

function getRequiredElement<T extends HTMLElement>(id: string, ctor: { new (): T }): T {
  const element = document.getElementById(id)
  if (!(element instanceof ctor)) throw new Error(`#${id} not found`)
  return element
}

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: Element): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  element.className = className
  parent.appendChild(element)
  return element
}

function createLine(box: HTMLDivElement, index: number): LineDom {
  const root = createElement('div', 'line', box)
  root.style.top = `${index * LINE_HEIGHT}px`
  const text = document.createTextNode('')
  root.appendChild(text)
  return { root, text }
}

// A row: its label, then a card that holds a box of text in the font and line height Pretext
// measured. The card takes its width from the box and its own padding.
function createRow(label: string, direction: 'ltr' | 'rtl', parent: Element): HTMLDivElement {
  createElement('div', 'row-label', parent).textContent = label
  const card = createElement('div', 'card', parent)
  card.style.padding = `${CARD_PADDING_Y}px ${CARD_PADDING_X}px`
  const box = createElement('div', 'text', card)
  box.dir = direction
  box.style.font = FONT
  box.style.lineHeight = `${LINE_HEIGHT}px`
  return box
}

function createDom(): DomCache {
  const rows = getRequiredElement('rows', HTMLElement)

  const boxes: HTMLDivElement[] = []
  const clamps: LinesDom[] = []
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!
    const box = createRow(sample.label, sample.direction, rows)
    boxes.push(box)
    clamps.push({ box, lines: [] })
  }

  const middleBox = createRow(middleLabel.label, 'ltr', rows)
  middleBox.style.height = `${LINE_HEIGHT}px`
  boxes.push(middleBox)

  const moreBox = createRow(moreSample.label, moreSample.direction, rows)
  boxes.push(moreBox)
  const moreLink = document.createElement('button')
  moreLink.type = 'button'
  moreLink.className = 'more-link'

  return {
    page: getRequiredElement('page', HTMLElement),
    widthSlider: getRequiredElement('width-slider', HTMLInputElement),
    widthValue: getRequiredElement('width-value', HTMLSpanElement),
    linesSlider: getRequiredElement('lines-slider', HTMLInputElement),
    linesValue: getRequiredElement('lines-value', HTMLSpanElement),
    boxes,
    clamps,
    middle: createLine(middleBox, 0),
    more: { box: moreBox, lines: [] },
    moreLink,
    moreLinkLine: -1,
  }
}

function scheduleRender(): void {
  if (scheduledRaf !== null) return
  scheduledRaf = requestAnimationFrame(function renderEllipsisFrame() {
    scheduledRaf = null
    render()
  })
}

// Writes a box's lines, `tail` after the last one, and hides the line elements left over.
function paintLines(dom: LinesDom, lines: string[], tail: string): void {
  for (let i = dom.lines.length; i < lines.length; i++) dom.lines.push(createLine(dom.box, i))
  for (let i = 0; i < dom.lines.length; i++) {
    const line = dom.lines[i]!
    const text = i < lines.length ? lines[i]! + (i === lines.length - 1 ? tail : '') : ''
    line.root.style.display = i < lines.length ? 'block' : 'none'
    // Only on a change: writing a text node's data collapses a selection inside it.
    if (line.text.data !== text) line.text.data = text
  }
}

function render(): void {
  // DOM reads
  // body.clientWidth leaves out the scrollbar gutter. Chrome's documentElement.clientWidth includes
  // the gutter while the page doesn't overflow.
  const viewportWidth = document.body.clientWidth
  const linkHadFocus = document.activeElement === domCache.moreLink

  // Inputs
  let requestedTextWidth = st.requestedTextWidth
  if (st.events.widthValue !== null) requestedTextWidth = st.events.widthValue
  let maxLines = st.maxLines
  if (st.events.linesValue !== null) maxLines = st.events.linesValue
  let moreOpen = st.moreOpen
  if (st.events.moreClicked) moreOpen = !moreOpen

  // Layout
  const geometry = getPageGeometry(viewportWidth, requestedTextWidth)
  const textWidth = geometry.textWidth
  const clamps: ClampLayout[] = []
  for (let i = 0; i < samples.length; i++) clamps.push(layoutClamp(samples[i]!.prepared, textWidth, maxLines))
  const middle = layoutMiddle(middleLabel, textWidth)
  const more = layoutMore(moreSample.prepared, textWidth, maxLines, moreOpen)

  st.requestedTextWidth = requestedTextWidth
  st.maxLines = maxLines
  st.moreOpen = moreOpen
  st.events.widthValue = null
  st.events.linesValue = null
  st.events.moreClicked = false

  // DOM writes
  domCache.page.style.width = `${geometry.pageWidth}px`
  domCache.page.toggleAttribute('data-ready', true)
  domCache.widthSlider.min = String(Math.min(MIN_TEXT_WIDTH, geometry.maxTextWidth))
  domCache.widthSlider.max = String(geometry.maxTextWidth)
  domCache.widthSlider.value = String(textWidth)
  domCache.widthValue.textContent = `${textWidth}px`
  domCache.linesSlider.max = String(MAX_LINES)
  domCache.linesSlider.value = String(maxLines)
  domCache.linesValue.textContent = String(maxLines)
  for (let i = 0; i < domCache.boxes.length; i++) domCache.boxes[i]!.style.width = `${textWidth}px`

  for (let i = 0; i < samples.length; i++) {
    const clamp = clamps[i]!
    const dom = domCache.clamps[i]!
    dom.box.style.height = `${clamp.height}px`
    paintLines(dom, clamp.lines, clamp.truncated ? ELLIPSIS : '')
  }

  if (domCache.middle.text.data !== middle) domCache.middle.text.data = middle

  domCache.more.box.style.height = `${more.height}px`
  paintLines(domCache.more, more.lines, more.linkLine < 0 ? '' : moreOpen ? ' ' : `${ELLIPSIS} `)
  const linkLabel = moreOpen ? LESS_LABEL : MORE_LABEL
  if (domCache.moreLink.textContent !== linkLabel) domCache.moreLink.textContent = linkLabel
  domCache.moreLink.setAttribute('aria-expanded', moreOpen ? 'true' : 'false')
  const linkMoved = domCache.moreLinkLine !== more.linkLine
  if (linkMoved) {
    if (more.linkLine < 0) domCache.moreLink.remove()
    else domCache.more.lines[more.linkLine]!.root.appendChild(domCache.moreLink)
    domCache.moreLinkLine = more.linkLine
  }

  // Side effects
  // Moving a focused element drops its focus.
  if (linkHadFocus && linkMoved && more.linkLine >= 0) domCache.moreLink.focus()
}
