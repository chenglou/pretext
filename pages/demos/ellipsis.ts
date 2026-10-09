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
  // How far the link row is from its closed state, 0, to its open one, 1, and the time of the
  // frame that last moved it, null while it rests.
  moreFade: number
  moreFadedAt: number | null
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

// One of the link row's two layers: the lines the closed and the open paragraph don't share,
// each with its own link.
type MoreLayerDom = {
  lines: LinesDom
  link: HTMLButtonElement
  linkLine: number // the line the link is attached to, -1 while detached
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
  moreBox: HTMLDivElement
  reducedMotion: MediaQueryList
  moreShared: LinesDom
  moreClosed: MoreLayerDom
  moreOpen: MoreLayerDom
}

const st: State = {
  requestedTextWidth: DEFAULT_TEXT_WIDTH,
  maxLines: DEFAULT_LINES,
  moreOpen: false,
  moreFade: 0,
  moreFadedAt: null,
  events: {
    widthValue: null,
    linesValue: null,
    moreClicked: false,
  },
}

// The link row's fade covers 63% of what is left of it every this many milliseconds.
const FADE_TIME_CONSTANT = 60
// The fade is at its end once the box is within this many pixels of its height there.
const FADE_REST = 0.05

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

domCache.moreClosed.link.addEventListener('click', toggleMore)
domCache.moreOpen.link.addEventListener('click', toggleMore)

window.addEventListener('resize', () => {
  scheduleRender()
})

scheduleRender()

function toggleMore(): void {
  st.events.moreClicked = true
  scheduleRender()
}

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

// A layer of the link row: the lines from where the two states part, and a link.
function createMoreLayer(box: HTMLDivElement, label: string, expanded: boolean): MoreLayerDom {
  const layer = createElement('div', 'layer', box)
  const link = document.createElement('button')
  link.type = 'button'
  link.className = 'more-link'
  link.textContent = label
  link.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  return { lines: { box: layer, lines: [] }, link, linkLine: -1 }
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
  moreBox.classList.add('more')
  boxes.push(moreBox)

  return {
    page: getRequiredElement('page', HTMLElement),
    widthSlider: getRequiredElement('width-slider', HTMLInputElement),
    widthValue: getRequiredElement('width-value', HTMLSpanElement),
    linesSlider: getRequiredElement('lines-slider', HTMLInputElement),
    linesValue: getRequiredElement('lines-value', HTMLSpanElement),
    boxes,
    clamps,
    middle: createLine(middleBox, 0),
    moreBox,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)'),
    // The shared lines get an element of their own ahead of the two layers, so the row's DOM is
    // in reading order, which a selection, a copy and a screen reader follow.
    moreShared: { box: createElement('div', 'shared', moreBox), lines: [] },
    moreClosed: createMoreLayer(moreBox, MORE_LABEL, false),
    moreOpen: createMoreLayer(moreBox, LESS_LABEL, true),
  }
}

function scheduleRender(): void {
  if (scheduledRaf !== null) return
  scheduledRaf = requestAnimationFrame(function renderEllipsisFrame(now) {
    scheduledRaf = null
    if (render(now)) scheduleRender()
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

// Writes one layer of the link row: where it starts, its lines, the link after `linkLine`, and
// how much of it shows. The layer of the state the row isn't in is inert, so its link takes no
// click and no focus, even while it still fades out.
function paintMoreLayer(dom: MoreLayerDom, top: number, lines: string[], linkLine: number, tail: string, opacity: number, shown: boolean): void {
  dom.lines.box.style.top = `${top}px`
  paintLines(dom.lines, lines, linkLine < 0 ? '' : tail)
  if (dom.linkLine !== linkLine) {
    if (linkLine < 0) dom.link.remove()
    else dom.lines.lines[linkLine]!.root.appendChild(dom.link)
    dom.linkLine = linkLine
  }
  dom.lines.box.style.opacity = String(opacity)
  dom.lines.box.toggleAttribute('inert', !shown)
}

// Returns whether the link row is still fading, which takes another frame.
function render(now: number): boolean {
  // DOM reads
  // body.clientWidth leaves out the scrollbar gutter. Chrome's documentElement.clientWidth includes
  // the gutter while the page doesn't overflow.
  const viewportWidth = document.body.clientWidth
  const linkHadFocus = document.activeElement === domCache.moreClosed.link || document.activeElement === domCache.moreOpen.link
  const reducedMotion = domCache.reducedMotion.matches

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
  // Both states of the link row, so that one can fade into the other, at whatever width the
  // frame has: every height is known before the click.
  const closed = layoutMore(moreSample.prepared, textWidth, maxLines, false)
  const open = layoutMore(moreSample.prepared, textWidth, maxLines, true)
  // A paragraph that fits its lines has no link, and its two states are the same lines. Otherwise
  // they share every line before the closed one's last, which stays as it is while the rest fades.
  const sharedLines = closed.linkLine >= 0 ? closed.linkLine : closed.lines.length

  // Animation tick
  // The fade closes on its state by exponential decay, which is closed-form: a frame of any
  // length lands on the same curve, and a click halfway turns it around from where it is.
  const fadeDest = moreOpen ? 1 : 0
  let moreFade = st.moreFade
  let moreFadedAt: number | null = null
  if (moreFade !== fadeDest) {
    moreFade = fadeDest + (moreFade - fadeDest) * Math.exp(-(now - (st.moreFadedAt ?? now)) / FADE_TIME_CONSTANT)
    if (reducedMotion || Math.abs(moreFade - fadeDest) * (open.height - closed.height) < FADE_REST) moreFade = fadeDest
    else moreFadedAt = now
  }

  st.requestedTextWidth = requestedTextWidth
  st.maxLines = maxLines
  st.moreOpen = moreOpen
  st.moreFade = moreFade
  st.moreFadedAt = moreFadedAt
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

  // The box is as far between the two states' heights as the fade is, and clips the open
  // layer's lines below that.
  domCache.moreBox.style.height = `${closed.height + (open.height - closed.height) * moreFade}px`
  paintLines(domCache.moreShared, closed.lines.slice(0, sharedLines), '')
  const layerTop = sharedLines * LINE_HEIGHT
  paintMoreLayer(domCache.moreClosed, layerTop, closed.lines.slice(sharedLines), closed.linkLine - sharedLines, `${ELLIPSIS} `, 1 - moreFade, !moreOpen)
  paintMoreLayer(domCache.moreOpen, layerTop, open.lines.slice(sharedLines), open.linkLine < 0 ? -1 : open.linkLine - sharedLines, ' ', moreFade, moreOpen)

  // Side effects
  // Focus stays on the link that shows: a click leaves it on the layer that fades out, and a link
  // moved to another line loses it. Without a scroll, so a click doesn't jump the page to the link.
  if (linkHadFocus && closed.linkLine >= 0) (moreOpen ? domCache.moreOpen : domCache.moreClosed).link.focus({ preventScroll: true })

  return moreFadedAt !== null
}
