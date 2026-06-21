import {
  layoutNextLine,
  layoutWithLines,
  prepareWithSegments,
  walkLineRanges,
  type LayoutCursor,
  type PreparedTextWithSegments,
  setLocale,
} from '../../src/layout.ts'
import { BODY_TEXT as BODY_TEXT_FR, PULLQUOTE_TEXTS as PULLQUOTE_TEXTS_FR } from './editorial-engine-text-fr.ts'

const lang = new URLSearchParams(window.location.search).get('lang') === 'fr' ? 'fr' : 'en'
if (lang === 'fr') setLocale('fr')
document.documentElement.lang = lang
if (lang === 'fr') {
  const hint = document.querySelector('.hint')
  if (hint) hint.textContent = 'Déplacez les orbes \u00B7 Cliquez pour les figer \u00B7 Zéro lecture DOM'
}

const BODY_FONT = '18px "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif'
const BODY_LINE_HEIGHT = 30
const HEADLINE_FONT_FAMILY = '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif'
const HEADLINE_TEXT = lang === 'fr'
  ? 'L\u2019AVENIR DE LA MISE EN PAGE N\u2019EST PAS LE CSS'
  : 'THE FUTURE OF TEXT LAYOUT IS NOT CSS'
const GUTTER = 48
const COL_GAP = 40
const BOTTOM_GAP = 20
const DROP_CAP_LINES = 3
const MIN_SLOT_WIDTH = 50
const NARROW_BREAKPOINT = 760
const NARROW_GUTTER = 20
const NARROW_COL_GAP = 20
const NARROW_BOTTOM_GAP = 16
const NARROW_ORB_SCALE = 0.58
const NARROW_ACTIVE_ORBS = 3

type Interval = {
  left: number
  right: number
}

type PositionedLine = {
  x: number
  y: number
  width: number
  text: string
}

type TextProjection = {
  headlineLeft: number
  headlineTop: number
  headlineFont: string
  headlineLineHeight: number
  headlineLines: PositionedLine[]
  bodyFont: string
  bodyLineHeight: number
  bodyLines: PositionedLine[]
  pullquoteFont: string
  pullquoteLineHeight: number
  pullquoteLines: PositionedLine[]
}

type CircleObstacle = {
  cx: number
  cy: number
  r: number
  hPad: number
  vPad: number
}

type RectObstacle = {
  x: number
  y: number
  w: number
  h: number
}

type PullquotePlacement = {
  colIdx: number
  yFrac: number
  wFrac: number
  side: 'left' | 'right'
}

type PullquoteRect = RectObstacle & {
  lines: PositionedLine[]
  colIdx: number
}

type OrbColor = [number, number, number]

type OrbDefinition = {
  fx: number
  fy: number
  r: number
  vx: number
  vy: number
  color: OrbColor
}

type Orb = {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  paused: boolean
}

type HeadlineFit = {
  fontSize: number
  lines: PositionedLine[]
}

type PullquoteSpec = {
  prepared: PreparedTextWithSegments
  placement: PullquotePlacement
}

type PointerSample = {
  x: number
  y: number
}

type PointerState = {
  x: number
  y: number
}

type DragState = {
  orbIndex: number
  startPointerX: number
  startPointerY: number
  startOrbX: number
  startOrbY: number
}

type InteractionMode = 'idle' | 'text-select'

type AppState = {
  orbs: Orb[]
  pointer: PointerState
  drag: DragState | null
  interactionMode: InteractionMode
  selectionActive: boolean
  events: {
    pointerDown: PointerSample | null
    pointerMove: PointerSample | null
    pointerUp: PointerSample | null
  }
  lastFrameTime: number | null
}

function getRequiredDiv(id: string): HTMLDivElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLDivElement)) throw new Error(`#${id} not found`)
  return element
}

function carveTextLineSlots(base: Interval, blocked: Interval[]): Interval[] {
  let slots = [base]
  for (let blockedIndex = 0; blockedIndex < blocked.length; blockedIndex++) {
    const interval = blocked[blockedIndex]!
    const next: Interval[] = []
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex]!
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left })
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right })
    }
    slots = next
  }
  return slots.filter(slot => slot.right - slot.left >= MIN_SLOT_WIDTH)
}

function circleIntervalForBand(
  cx: number,
  cy: number,
  r: number,
  bandTop: number,
  bandBottom: number,
  hPad: number,
  vPad: number,
): Interval | null {
  const top = bandTop - vPad
  const bottom = bandBottom + vPad
  if (top >= cy + r || bottom <= cy - r) return null
  const minDy = cy >= top && cy <= bottom ? 0 : cy < top ? top - cy : cy - bottom
  if (minDy >= r) return null
  const maxDx = Math.sqrt(r * r - minDy * minDy)
  return { left: cx - maxDx - hPad, right: cx + maxDx + hPad }
}

const BODY_TEXT_EN = `The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one. Every step requires the rendering engine to consult its internal layout tree — a structure so expensive to maintain that browsers guard access to it behind synchronous reflow barriers that can freeze the main thread for tens of milliseconds at a time.

For a paragraph in a blog post, this pipeline is invisible. The browser loads, lays out, and paints before the reader’s eye has traveled from the address bar to the first word. But the web is no longer a collection of static documents. It is a platform for applications, and those applications need to know about text in ways the original pipeline never anticipated.

A messaging application needs to know the exact height of every message bubble before rendering a virtualized list. A masonry layout needs the height of every card to position them without overlap. An editorial page needs text to flow around images, advertisements, and interactive elements. A responsive dashboard needs to resize and reflow text in real time as the user drags a panel divider.

Every one of these operations requires text measurement. And every text measurement on the web today requires a synchronous layout reflow. The cost is devastating. Measuring the height of a single text block forces the browser to recalculate the position of every element on the page. When you measure five hundred text blocks in sequence, you trigger five hundred full layout passes. This pattern, known as layout thrashing, is the single largest source of jank on the modern web.

Chrome DevTools will flag it with angry red bars. Lighthouse will dock your performance score. But the developer has no alternative — CSS provides no API for computing text height without rendering it. The information is locked behind the DOM, and the DOM makes you pay for every answer.

Developers have invented increasingly desperate workarounds. Estimated heights replace real measurements with guesses, causing content to visibly jump when the guess is wrong. ResizeObserver watches elements for size changes, but it fires asynchronously and always at least one frame too late. IntersectionObserver tracks visibility but says nothing about dimensions. Content-visibility allows the browser to skip rendering off-screen elements, but it breaks scroll position and accessibility. Each workaround addresses one symptom while introducing new problems.

The CSS Shapes specification, finalized in 2014, was supposed to bring magazine-style text wrap to the web. It allows text to flow around a defined shape — a circle, an ellipse, a polygon, even an image alpha channel. On paper, it was the answer. In practice, it is remarkably limited. CSS Shapes only works with floated elements. Text can only wrap on one side of the shape. The shape must be defined statically in CSS — you cannot animate it or change it dynamically without triggering a full layout reflow. And because it operates within the browser’s layout engine, you have no access to the resulting line geometry. You cannot determine where each line of text starts and ends, how many lines were generated, or what the total height of the shaped text block is.

The editorial layouts we see in print magazines — text flowing around photographs, pull quotes interrupting the column, multiple columns with seamless text handoff — have remained out of reach for the web. Not because they are conceptually difficult, but because the performance cost of implementing them with DOM measurement makes them impractical. A two-column editorial layout that reflows text around three obstacle shapes requires measuring and positioning hundreds of text lines. At thirty milliseconds per measurement, this would take seconds — an eternity for a render frame.

What if text measurement did not require the DOM at all? What if you could compute exactly where every line of text would break, exactly how wide each line would be, and exactly how tall the entire text block would be, using nothing but arithmetic?

This is the core insight of pretext. The browser’s canvas API includes a measureText method that returns the width of any string in any font without triggering a layout reflow. Canvas measurement uses the same font engine as DOM rendering — the results are identical. But because it operates outside the layout tree, it carries no reflow penalty.

Pretext exploits this asymmetry. When text first appears, pretext measures every word once via canvas and caches the widths. After this preparation phase, layout is pure arithmetic: walk the cached widths, track the running line width, insert line breaks when the width exceeds the maximum, and sum the line heights. No DOM. No reflow. No layout tree access.

The performance improvement is not incremental. Measuring five hundred text blocks with DOM methods costs fifteen to thirty milliseconds and triggers five hundred layout reflows. With pretext, the same operation costs 0.05 milliseconds and triggers zero reflows. This is a three hundred to six hundred times improvement. But even that number understates the impact, because pretext’s cost does not scale with page complexity — it is independent of how many other elements exist on the page.

With DOM-free text measurement, an entire class of previously impractical interfaces becomes trivial. Text can flow around arbitrary shapes, not because the browser’s layout engine supports it, but because you control the line widths directly. For each line of text, you compute which horizontal intervals are blocked by obstacles, subtract them from the available width, and pass the remaining width to the layout engine. The engine returns the text that fits, and you position the line at the correct offset.

This is exactly what CSS Shapes tried to accomplish, but with none of its limitations. Obstacles can be any shape — rectangles, circles, arbitrary polygons, even the alpha channel of an image. Text wraps on both sides simultaneously. Obstacles can move, animate, or be dragged by the user, and the text reflows instantly because the layout computation takes less than a millisecond.

Shrinkwrap is another capability that CSS cannot express. Given a block of multiline text, what is the narrowest width that preserves the current line count? CSS offers fit-content, which works for single lines but always leaves dead space for multiline text. Pretext solves this with a binary search over widths: narrow until the line count increases, then back off. The result is the tightest possible bounding box — perfect for chat message bubbles, image captions, and tooltip text.

Virtualized text rendering becomes exact rather than estimated. A virtual list needs to know the height of items before they enter the viewport, so it can position them correctly and calculate scroll extent. Without pretext, you must either render items off-screen to measure them (defeating the purpose of virtualization) or estimate heights and accept visual jumping when items enter the viewport with different heights than predicted. Pretext computes exact heights without creating any DOM elements, enabling perfect virtualization with zero visual artifacts.

Multi-column text flow with cursor handoff is perhaps the most striking capability. The left column consumes text until it reaches the bottom, then hands its cursor to the right column. The right column picks up exactly where the left column stopped, with no duplication, no gap, and perfect line breaking at the column boundary. This is how newspapers and magazines work on paper, but it has never been achievable on the web without extreme hacks involving multiple elements, hidden overflow, and JavaScript-managed content splitting.

Pretext makes it trivial. Call layoutNextLine in a loop for the first column, using the column width. When the column is full, take the returned cursor and start a new loop for the second column. The cursor carries the exact position in the prepared text — which segment, which grapheme within that segment. The second column continues seamlessly from the first.

Adaptive headline sizing is a detail that separates professional typography from amateur layout. The headline should be as large as possible without breaking any word across lines. This requires a binary search: try a font size, measure the text, check if any line breaks occur within a word, and adjust. With DOM measurement, each iteration costs a reflow. With pretext, each iteration is a microsecond of arithmetic.

Real-time text reflow around animated obstacles is the ultimate stress test. The demonstration you are reading right now renders text that flows around multiple moving objects simultaneously, every frame, at sixty frames per second. Each frame, the layout engine computes obstacle intersections for every line of text, determines the available horizontal slots, lays out each line at the correct width and position, and updates the DOM with the results. The total computation time is typically under half a millisecond.

The glowing orbs drifting across this page are not decorative — they are the demonstration. Each orb is a circular obstacle. For every line of text, the engine checks whether the line’s vertical band intersects each orb. If it does, it computes the blocked horizontal interval and subtracts it from the available width. The remaining width might be split into two or more segments — and the engine fills every viable slot, flowing text on both sides of the obstacle simultaneously. This is something CSS Shapes cannot do at all.

All of this runs without a single DOM measurement. The line positions, widths, and text contents are computed entirely in JavaScript using cached font metrics. The only DOM writes are setting the left, top, and textContent of each line element — the absolute minimum required to show text on screen. The browser never needs to compute layout because all positioning is explicit.

This performance characteristic has profound implications for the web platform. For thirty years, the browser has been the gatekeeper of text information. If you wanted to know anything about how text would render — its width, its height, where its lines break — you had to ask the browser, and the browser made you pay for the answer with a layout reflow. This created an artificial scarcity of text information that constrained what interfaces could do.

Pretext removes that constraint. Text information becomes abundant and cheap. You can ask how text would look at a thousand different widths in the time it used to take to ask about one. You can recompute text layout every frame, every drag event, every pixel of window resize, without any performance concern.

The implications extend beyond layout into composition. When you have instant text measurement, you can build compositing engines that combine text with graphics, animation, and interaction in ways that were previously reserved for game engines and native applications. Text becomes a first-class participant in the visual composition, not a static block that the rest of the interface must work around.

Imagine a data visualization where labels reflow around chart elements as the user zooms and pans. Imagine a collaborative document editor where text flows around embedded widgets, images, and annotations placed by other users, updating live as they move things around. Imagine a map application where place names wrap intelligently around geographic features rather than overlapping them. These are not hypothetical — they are engineering problems that become solvable when text measurement costs a microsecond instead of thirty milliseconds.

The open web deserves typography that matches its ambition. We build applications that rival native software in every dimension except text. Our animations are smooth, our interactions are responsive, our graphics are stunning — but our text sits in rigid boxes, unable to flow around obstacles, unable to adapt to dynamic layouts, unable to participate in the fluid compositions that define modern interface design.

This is what changes when text measurement becomes free. Not slightly better — categorically different. The interfaces that were too expensive to build become trivial. The layouts that existed only in print become interactive. The text that sat in boxes begins to flow.

The web has been waiting thirty years for this. A fifteen kilobyte library with zero dependencies delivers it. No browser API changes needed. No specification process. No multi-year standardization timeline. Just math, cached measurements, and the audacity to ask: what if we simply stopped asking the DOM?

Fifteen kilobytes. Zero dependencies. Zero DOM reads. And the text flows.`

const PULLQUOTE_TEXTS_EN = [
  '”The performance improvement is not incremental — it is categorical. 0.05ms versus 30ms. Zero reflows versus five hundred.”',
  '”Text becomes a first-class participant in the visual composition — not a static block, but a fluid material that adapts in real time.”',
]

const BODY_TEXT = lang === 'fr' ? BODY_TEXT_FR : BODY_TEXT_EN
const PULLQUOTE_TEXTS = lang === 'fr' ? PULLQUOTE_TEXTS_FR : PULLQUOTE_TEXTS_EN

const stage = getRequiredDiv('stage')

const orbDefs: OrbDefinition[] = [
  { fx: 0.52, fy: 0.22, r: 110, vx: 24, vy: 16, color: [196, 163, 90] },
  { fx: 0.18, fy: 0.48, r: 85, vx: -19, vy: 26, color: [100, 140, 255] },
  { fx: 0.74, fy: 0.58, r: 95, vx: 16, vy: -21, color: [232, 100, 130] },
  { fx: 0.38, fy: 0.72, r: 75, vx: -26, vy: -14, color: [80, 200, 140] },
  { fx: 0.86, fy: 0.18, r: 65, vx: -13, vy: 19, color: [150, 100, 220] },
]

function createOrbEl(color: OrbColor): HTMLDivElement {
  const element = document.createElement('div')
  element.className = 'orb'
  element.style.background = `radial-gradient(circle at 35% 35%, rgba(${color[0]},${color[1]},${color[2]},0.35), rgba(${color[0]},${color[1]},${color[2]},0.12) 55%, transparent 72%)`
  element.style.boxShadow = `0 0 60px 15px rgba(${color[0]},${color[1]},${color[2]},0.18), 0 0 120px 40px rgba(${color[0]},${color[1]},${color[2]},0.07)`
  stage.appendChild(element)
  return element
}

const W0 = window.innerWidth
const H0 = window.innerHeight

await document.fonts.ready

const preparedBody = prepareWithSegments(BODY_TEXT, BODY_FONT)
const PQ_FONT = `italic 19px ${HEADLINE_FONT_FAMILY}`
const PQ_LINE_HEIGHT = 27
const preparedPullquotes = PULLQUOTE_TEXTS.map(text => prepareWithSegments(text, PQ_FONT))
const pullquoteSpecs: PullquoteSpec[] = [
  { prepared: preparedPullquotes[0]!, placement: { colIdx: 0, yFrac: 0.48, wFrac: 0.52, side: 'right' } },
  { prepared: preparedPullquotes[1]!, placement: { colIdx: 1, yFrac: 0.32, wFrac: 0.5, side: 'left' } },
]
const DROP_CAP_SIZE = BODY_LINE_HEIGHT * DROP_CAP_LINES - 4
const DROP_CAP_FONT = `700 ${DROP_CAP_SIZE}px ${HEADLINE_FONT_FAMILY}`
const DROP_CAP_TEXT = BODY_TEXT[0]!
const preparedDropCap = prepareWithSegments(DROP_CAP_TEXT, DROP_CAP_FONT)

let dropCapWidth = 0
walkLineRanges(preparedDropCap, 9999, line => {
  dropCapWidth = line.width
})
const DROP_CAP_TOTAL_W = Math.ceil(dropCapWidth) + 10

const dropCapEl = document.createElement('div')
dropCapEl.className = 'drop-cap'
dropCapEl.textContent = DROP_CAP_TEXT
dropCapEl.style.font = DROP_CAP_FONT
dropCapEl.style.lineHeight = `${DROP_CAP_SIZE}px`
stage.appendChild(dropCapEl)

const linePool: HTMLSpanElement[] = []
const headlinePool: HTMLSpanElement[] = []
const pullquoteLinePool: HTMLSpanElement[] = []
const pullquoteBoxPool: HTMLDivElement[] = []
const domCache = {
  stage, // cache lifetime: same as page
  dropCap: dropCapEl, // cache lifetime: same as page
  bodyLines: linePool, // cache lifetime: on body line-count changes
  headlineLines: headlinePool, // cache lifetime: on headline line-count changes
  pullquoteLines: pullquoteLinePool, // cache lifetime: on pullquote line-count changes
  pullquoteBoxes: pullquoteBoxPool, // cache lifetime: on pullquote-count changes
  orbs: orbDefs.map(definition => createOrbEl(definition.color)), // cache lifetime: same as orb defs
}

const st: AppState = {
  orbs: orbDefs.map(definition => ({
    x: definition.fx * W0,
    y: definition.fy * H0,
    r: definition.r,
    vx: definition.vx,
    vy: definition.vy,
    paused: false,
  })),
  pointer: { x: -9999, y: -9999 },
  drag: null,
  interactionMode: 'idle',
  selectionActive: false,
  events: {
    pointerDown: null,
    pointerMove: null,
    pointerUp: null,
  },
  lastFrameTime: null,
}

let committedTextProjection: TextProjection | null = null

function syncPool<T extends HTMLElement>(pool: T[], count: number, create: () => T): void {
  while (pool.length < count) {
    const element = create()
    stage.appendChild(element)
    pool.push(element)
  }
  for (let index = 0; index < pool.length; index++) {
    pool[index]!.style.display = index < count ? '' : 'none'
  }
}

let cachedHeadlineWidth = -1
let cachedHeadlineHeight = -1
let cachedHeadlineMaxSize = -1
let cachedHeadlineFontSize = 24
let cachedHeadlineLines: PositionedLine[] = []

function fitHeadline(maxWidth: number, maxHeight: number, maxSize: number = 92): HeadlineFit {
  if (maxWidth === cachedHeadlineWidth && maxHeight === cachedHeadlineHeight && maxSize === cachedHeadlineMaxSize) {
    return { fontSize: cachedHeadlineFontSize, lines: cachedHeadlineLines }
  }

  cachedHeadlineWidth = maxWidth
  cachedHeadlineHeight = maxHeight
  cachedHeadlineMaxSize = maxSize
  let lo = 20
  let hi = maxSize
  let best = lo
  let bestLines: PositionedLine[] = []

  while (lo <= hi) {
    const size = Math.floor((lo + hi) / 2)
    const font = `700 ${size}px ${HEADLINE_FONT_FAMILY}`
    const lineHeight = Math.round(size * 0.93)
    const prepared = prepareWithSegments(HEADLINE_TEXT, font)
    let breaksWord = false
    let lineCount = 0

    walkLineRanges(prepared, maxWidth, line => {
      lineCount++
      if (line.end.graphemeIndex !== 0) breaksWord = true
    })

    const totalHeight = lineCount * lineHeight
    if (!breaksWord && totalHeight <= maxHeight) {
      best = size
      const result = layoutWithLines(prepared, maxWidth, lineHeight)
      bestLines = result.lines.map((line, index) => ({
        x: 0,
        y: index * lineHeight,
        text: line.text,
        width: line.width,
      }))
      lo = size + 1
    } else {
      hi = size - 1
    }
  }

  cachedHeadlineFontSize = best
  cachedHeadlineLines = bestLines
  return { fontSize: best, lines: bestLines }
}

function layoutColumn(
  prepared: PreparedTextWithSegments,
  startCursor: LayoutCursor,
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number,
  lineHeight: number,
  circleObstacles: CircleObstacle[],
  rectObstacles: RectObstacle[],
  singleSlotOnly: boolean = false,
): { lines: PositionedLine[], cursor: LayoutCursor } {
  let cursor: LayoutCursor = startCursor
  let lineTop = regionY
  const lines: PositionedLine[] = []
  let textExhausted = false

  while (lineTop + lineHeight <= regionY + regionH && !textExhausted) {
    const bandTop = lineTop
    const bandBottom = lineTop + lineHeight
    const blocked: Interval[] = []

    for (let obstacleIndex = 0; obstacleIndex < circleObstacles.length; obstacleIndex++) {
      const obstacle = circleObstacles[obstacleIndex]!
      const interval = circleIntervalForBand(
        obstacle.cx,
        obstacle.cy,
        obstacle.r,
        bandTop,
        bandBottom,
        obstacle.hPad,
        obstacle.vPad,
      )
      if (interval !== null) blocked.push(interval)
    }

    for (let rectIndex = 0; rectIndex < rectObstacles.length; rectIndex++) {
      const rect = rectObstacles[rectIndex]!
      if (bandBottom <= rect.y || bandTop >= rect.y + rect.h) continue
      blocked.push({ left: rect.x, right: rect.x + rect.w })
    }

    const slots = carveTextLineSlots({ left: regionX, right: regionX + regionW }, blocked)
    if (slots.length === 0) {
      lineTop += lineHeight
      continue
    }

    const orderedSlots = singleSlotOnly
      ? [slots.reduce((best, slot) => {
          const bestWidth = best.right - best.left
          const slotWidth = slot.right - slot.left
          if (slotWidth > bestWidth) return slot
          if (slotWidth < bestWidth) return best
          return slot.left < best.left ? slot : best
        })]
      : [...slots].sort((a, b) => a.left - b.left)

    for (let slotIndex = 0; slotIndex < orderedSlots.length; slotIndex++) {
      const slot = orderedSlots[slotIndex]!
      const slotWidth = slot.right - slot.left
      const line = layoutNextLine(prepared, cursor, slotWidth)
      if (line === null) {
        textExhausted = true
        break
      }
      lines.push({
        x: Math.round(slot.left),
        y: Math.round(lineTop),
        text: line.text,
        width: line.width,
      })
      cursor = line.end
    }

    lineTop += lineHeight
  }

  return { lines, cursor }
}

function hitTestOrbs(orbs: Orb[], px: number, py: number, activeCount: number, radiusScale: number): number {
  for (let index = activeCount - 1; index >= 0; index--) {
    const orb = orbs[index]!
    const radius = orb.r * radiusScale
    const dx = px - orb.x
    const dy = py - orb.y
    if (dx * dx + dy * dy <= radius * radius) return index
  }
  return -1
}

function pointerSampleFromEvent(event: PointerEvent): PointerSample {
  return { x: event.clientX, y: event.clientY }
}

function isSelectableTextTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.line, .headline-line, .pullquote-line') !== null
}

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed && selection.rangeCount > 0
}

function clearQueuedPointerEvents(): void {
  st.events.pointerDown = null
  st.events.pointerMove = null
  st.events.pointerUp = null
}

function positionedLinesEqual(a: PositionedLine[], b: PositionedLine[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    const left = a[index]!
    const right = b[index]!
    if (
      left.x !== right.x ||
      left.y !== right.y ||
      left.width !== right.width ||
      left.text !== right.text
    ) {
      return false
    }
  }
  return true
}

function textProjectionEqual(a: TextProjection | null, b: TextProjection): boolean {
  return a !== null &&
    a.headlineLeft === b.headlineLeft &&
    a.headlineTop === b.headlineTop &&
    a.headlineFont === b.headlineFont &&
    a.headlineLineHeight === b.headlineLineHeight &&
    a.bodyFont === b.bodyFont &&
    a.bodyLineHeight === b.bodyLineHeight &&
    a.pullquoteFont === b.pullquoteFont &&
    a.pullquoteLineHeight === b.pullquoteLineHeight &&
    positionedLinesEqual(a.headlineLines, b.headlineLines) &&
    positionedLinesEqual(a.bodyLines, b.bodyLines) &&
    positionedLinesEqual(a.pullquoteLines, b.pullquoteLines)
}

function projectTextProjection(projection: TextProjection): void {
  syncPool(domCache.headlineLines, projection.headlineLines.length, () => {
    const element = document.createElement('span')
    element.className = 'headline-line'
    return element
  })
  for (let index = 0; index < projection.headlineLines.length; index++) {
    const element = domCache.headlineLines[index]!
    const line = projection.headlineLines[index]!
    element.textContent = line.text
    element.style.left = `${projection.headlineLeft + line.x}px`
    element.style.top = `${projection.headlineTop + line.y}px`
    element.style.font = projection.headlineFont
    element.style.lineHeight = `${projection.headlineLineHeight}px`
  }

  syncPool(domCache.bodyLines, projection.bodyLines.length, () => {
    const element = document.createElement('span')
    element.className = 'line'
    return element
  })
  for (let index = 0; index < projection.bodyLines.length; index++) {
    const element = domCache.bodyLines[index]!
    const line = projection.bodyLines[index]!
    element.textContent = line.text
    element.style.left = `${line.x}px`
    element.style.top = `${line.y}px`
    element.style.font = projection.bodyFont
    element.style.lineHeight = `${projection.bodyLineHeight}px`
  }

  syncPool(domCache.pullquoteLines, projection.pullquoteLines.length, () => {
    const element = document.createElement('span')
    element.className = 'pullquote-line'
    return element
  })
  for (let index = 0; index < projection.pullquoteLines.length; index++) {
    const element = domCache.pullquoteLines[index]!
    const line = projection.pullquoteLines[index]!
    element.textContent = line.text
    element.style.left = `${line.x}px`
    element.style.top = `${line.y}px`
    element.style.font = projection.pullquoteFont
    element.style.lineHeight = `${projection.pullquoteLineHeight}px`
  }
}

function enterTextSelectionMode(): void {
  st.interactionMode = 'text-select'
  clearQueuedPointerEvents()
  st.lastFrameTime = null
  domCache.stage.style.userSelect = ''
  domCache.stage.style.webkitUserSelect = ''
  document.body.style.cursor = ''
}

function syncSelectionState(): void {
  st.selectionActive = hasActiveTextSelection()
  if (st.selectionActive) {
    enterTextSelectionMode()
  } else if (st.interactionMode === 'text-select' && st.drag === null) {
    st.interactionMode = 'idle'
  }
}

function isTextSelectionInteractionActive(): boolean {
  return st.interactionMode === 'text-select' || st.selectionActive
}

let scheduledRaf: number | null = null
function scheduleRender(): void {
  if (scheduledRaf !== null) return
  scheduledRaf = requestAnimationFrame(function renderAndMaybeScheduleEditorialFrame(now) {
    scheduledRaf = null
    if (render(now)) scheduleRender()
  })
}

stage.addEventListener('pointerdown', event => {
  if (isSelectableTextTarget(event.target)) {
    if (event.pointerType === 'touch') enterTextSelectionMode()
    return
  }

  const activeOrbCount = window.innerWidth < NARROW_BREAKPOINT ? NARROW_ACTIVE_ORBS : st.orbs.length
  const radiusScale = window.innerWidth < NARROW_BREAKPOINT ? NARROW_ORB_SCALE : 1
  const hitOrbIndex = hitTestOrbs(st.orbs, event.clientX, event.clientY, activeOrbCount, radiusScale)
  if (hitOrbIndex !== -1) {
    event.preventDefault()
  } else if (event.pointerType === 'touch' && st.selectionActive) {
    enterTextSelectionMode()
    return
  }
  st.events.pointerDown = pointerSampleFromEvent(event)
  scheduleRender()
})

stage.addEventListener('touchmove', event => {
  if (isTextSelectionInteractionActive()) return
  event.preventDefault()
}, { passive: false })

window.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch' && isTextSelectionInteractionActive() && st.drag === null) return
  st.events.pointerMove = pointerSampleFromEvent(event)
  scheduleRender()
})

window.addEventListener('pointerup', event => {
  if (event.pointerType === 'touch' && isTextSelectionInteractionActive() && st.drag === null) {
    syncSelectionState()
    return
  }
  if (event.pointerType === 'touch') syncSelectionState()
  st.events.pointerUp = pointerSampleFromEvent(event)
  scheduleRender()
})

window.addEventListener('pointercancel', event => {
  if (event.pointerType === 'touch') syncSelectionState()
  st.events.pointerUp = pointerSampleFromEvent(event)
  scheduleRender()
})

window.addEventListener('resize', () => scheduleRender())
document.addEventListener('selectionchange', () => {
  syncSelectionState()
  scheduleRender()
})

function render(now: number): boolean {
  if (isTextSelectionInteractionActive() && st.drag === null) {
    return false
  }

  const pageWidth = document.documentElement.clientWidth
  const pageHeight = document.documentElement.clientHeight
  const isNarrow = pageWidth < NARROW_BREAKPOINT
  const gutter = isNarrow ? NARROW_GUTTER : GUTTER
  const colGap = isNarrow ? NARROW_COL_GAP : COL_GAP
  const bottomGap = isNarrow ? NARROW_BOTTOM_GAP : BOTTOM_GAP
  const orbRadiusScale = isNarrow ? NARROW_ORB_SCALE : 1
  const activeOrbCount = isNarrow ? Math.min(NARROW_ACTIVE_ORBS, st.orbs.length) : st.orbs.length
  const orbs = st.orbs

  let pointer = st.pointer
  let drag = st.drag
  if (st.events.pointerDown !== null) {
    const down = st.events.pointerDown
    pointer = down
    if (drag === null) {
      const orbIndex = hitTestOrbs(orbs, down.x, down.y, activeOrbCount, orbRadiusScale)
      if (orbIndex !== -1) {
        const orb = orbs[orbIndex]!
        drag = {
          orbIndex,
          startPointerX: down.x,
          startPointerY: down.y,
          startOrbX: orb.x,
          startOrbY: orb.y,
        }
      }
    }
  }

  if (st.events.pointerMove !== null) {
    const move = st.events.pointerMove
    pointer = move
    if (drag !== null) {
      const orb = orbs[drag.orbIndex]!
      orb.x = drag.startOrbX + (move.x - drag.startPointerX)
      orb.y = drag.startOrbY + (move.y - drag.startPointerY)
    }
  }

  if (st.events.pointerUp !== null) {
    const up = st.events.pointerUp
    pointer = up
    if (drag !== null) {
      const dx = up.x - drag.startPointerX
      const dy = up.y - drag.startPointerY
      const orb = orbs[drag.orbIndex]!
      if (dx * dx + dy * dy < 16) {
        orb.paused = !orb.paused
      } else {
        orb.x = drag.startOrbX + dx
        orb.y = drag.startOrbY + dy
      }
      drag = null
    }
  }

  const draggedOrbIndex = drag?.orbIndex ?? -1
  const lastFrameTime = st.lastFrameTime ?? now
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05)
  let stillAnimating = false

  for (let index = 0; index < orbs.length; index++) {
    if (index >= activeOrbCount) continue
    const orb = orbs[index]!
    const radius = orb.r * orbRadiusScale
    if (orb.paused || index === draggedOrbIndex) continue
    stillAnimating = true
    orb.x += orb.vx * dt
    orb.y += orb.vy * dt

    if (orb.x - radius < 0) {
      orb.x = radius
      orb.vx = Math.abs(orb.vx)
    }
    if (orb.x + radius > pageWidth) {
      orb.x = pageWidth - radius
      orb.vx = -Math.abs(orb.vx)
    }
    if (orb.y - radius < gutter * 0.5) {
      orb.y = radius + gutter * 0.5
      orb.vy = Math.abs(orb.vy)
    }
    if (orb.y + radius > pageHeight - bottomGap) {
      orb.y = pageHeight - bottomGap - radius
      orb.vy = -Math.abs(orb.vy)
    }
  }

  for (let index = 0; index < activeOrbCount; index++) {
    const a = orbs[index]!
    const aRadius = a.r * orbRadiusScale
    for (let otherIndex = index + 1; otherIndex < activeOrbCount; otherIndex++) {
      const b = orbs[otherIndex]!
      const bRadius = b.r * orbRadiusScale
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const minDist = aRadius + bRadius + (isNarrow ? 12 : 20)
      if (dist >= minDist || dist <= 0.1) continue

      const force = (minDist - dist) * 0.8
      const nx = dx / dist
      const ny = dy / dist

      if (!a.paused && index !== draggedOrbIndex) {
        a.vx -= nx * force * dt
        a.vy -= ny * force * dt
      }
      if (!b.paused && otherIndex !== draggedOrbIndex) {
        b.vx += nx * force * dt
        b.vy += ny * force * dt
      }
    }
  }

  const circleObstacles: CircleObstacle[] = []
  for (let index = 0; index < activeOrbCount; index++) {
    const orb = orbs[index]!
    circleObstacles.push({
      cx: orb.x,
      cy: orb.y,
      r: orb.r * orbRadiusScale,
      hPad: isNarrow ? 10 : 14,
      vPad: isNarrow ? 2 : 4,
    })
  }

  const headlineWidth = Math.min(pageWidth - gutter * 2 - (isNarrow ? 12 : 0), 1000)
  const maxHeadlineHeight = Math.floor(pageHeight * (isNarrow ? 0.2 : 0.24))
  const { fontSize: headlineSize, lines: headlineLines } = fitHeadline(
    headlineWidth,
    maxHeadlineHeight,
    isNarrow ? 38 : 92,
  )
  const headlineLineHeight = Math.round(headlineSize * 0.93)
  const headlineFont = `700 ${headlineSize}px ${HEADLINE_FONT_FAMILY}`
  const headlineHeight = headlineLines.length * headlineLineHeight

  const bodyTop = gutter + headlineHeight + (isNarrow ? 14 : 20)
  const bodyHeight = pageHeight - bodyTop - bottomGap
  const columnCount = pageWidth > 1000 ? 3 : pageWidth > 640 ? 2 : 1
  const totalGutter = gutter * 2 + colGap * (columnCount - 1)
  const maxContentWidth = Math.min(pageWidth, 1500)
  const columnWidth = Math.floor((maxContentWidth - totalGutter) / columnCount)
  const contentLeft = Math.round((pageWidth - (columnCount * columnWidth + (columnCount - 1) * colGap)) / 2)
  const column0X = contentLeft
  const dropCapRect: RectObstacle = {
    x: column0X - 2,
    y: bodyTop - 2,
    w: DROP_CAP_TOTAL_W,
    h: DROP_CAP_LINES * BODY_LINE_HEIGHT + 2,
  }

  const pullquoteRects: PullquoteRect[] = []
  for (let index = 0; index < pullquoteSpecs.length; index++) {
    if (isNarrow) break
    const { prepared, placement } = pullquoteSpecs[index]!
    if (placement.colIdx >= columnCount) continue

    const pullquoteWidth = Math.round(columnWidth * placement.wFrac)
    const pullquoteLines = layoutWithLines(prepared, pullquoteWidth - 20, PQ_LINE_HEIGHT).lines
    const pullquoteHeight = pullquoteLines.length * PQ_LINE_HEIGHT + 16
    const columnX = contentLeft + placement.colIdx * (columnWidth + colGap)
    const pullquoteX = placement.side === 'right' ? columnX + columnWidth - pullquoteWidth : columnX
    const pullquoteY = Math.round(bodyTop + bodyHeight * placement.yFrac)
    const positionedLines = pullquoteLines.map((line, lineIndex) => ({
      x: pullquoteX + 20,
      y: pullquoteY + 8 + lineIndex * PQ_LINE_HEIGHT,
      text: line.text,
      width: line.width,
    }))

    pullquoteRects.push({
      x: pullquoteX,
      y: pullquoteY,
      w: pullquoteWidth,
      h: pullquoteHeight,
      lines: positionedLines,
      colIdx: placement.colIdx,
    })
  }

  const allBodyLines: PositionedLine[] = []
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 1 }
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    const columnX = contentLeft + columnIndex * (columnWidth + colGap)
    const rects: RectObstacle[] = []
    if (columnIndex === 0) rects.push(dropCapRect)
    for (let rectIndex = 0; rectIndex < pullquoteRects.length; rectIndex++) {
      const pullquote = pullquoteRects[rectIndex]!
      if (pullquote.colIdx !== columnIndex) continue
      rects.push({ x: pullquote.x, y: pullquote.y, w: pullquote.w, h: pullquote.h })
    }

    const result = layoutColumn(
      preparedBody,
      cursor,
      columnX,
      bodyTop,
      columnWidth,
      bodyHeight,
      BODY_LINE_HEIGHT,
      circleObstacles,
      rects,
      isNarrow,
    )
    allBodyLines.push(...result.lines)
    cursor = result.cursor
  }

  const pullquoteLines: PositionedLine[] = []
  for (let index = 0; index < pullquoteRects.length; index++) {
    const pullquote = pullquoteRects[index]!
    for (let lineIndex = 0; lineIndex < pullquote.lines.length; lineIndex++) {
      pullquoteLines.push(pullquote.lines[lineIndex]!)
    }
  }

  const hoveredOrbIndex = hitTestOrbs(orbs, pointer.x, pointer.y, activeOrbCount, orbRadiusScale)
  const cursorStyle = drag !== null ? 'grabbing' : hoveredOrbIndex !== -1 ? 'grab' : ''

  st.pointer = pointer
  st.drag = drag
  st.events.pointerDown = null
  st.events.pointerMove = null
  st.events.pointerUp = null
  st.lastFrameTime = stillAnimating ? now : null

  const textProjection: TextProjection = {
    headlineLeft: gutter,
    headlineTop: gutter,
    headlineFont,
    headlineLineHeight,
    headlineLines,
    bodyFont: BODY_FONT,
    bodyLineHeight: BODY_LINE_HEIGHT,
    bodyLines: allBodyLines,
    pullquoteFont: PQ_FONT,
    pullquoteLineHeight: PQ_LINE_HEIGHT,
    pullquoteLines,
  }

  if (!textProjectionEqual(committedTextProjection, textProjection)) {
    projectTextProjection(textProjection)
    committedTextProjection = textProjection
  }

  domCache.dropCap.style.left = `${column0X}px`
  domCache.dropCap.style.top = `${bodyTop}px`

  syncPool(domCache.pullquoteBoxes, pullquoteRects.length, () => {
    const element = document.createElement('div')
    element.className = 'pullquote-box'
    return element
  })

  for (let index = 0; index < pullquoteRects.length; index++) {
    const pullquote = pullquoteRects[index]!
    const boxElement = domCache.pullquoteBoxes[index]!
    boxElement.style.left = `${pullquote.x}px`
    boxElement.style.top = `${pullquote.y}px`
    boxElement.style.width = `${pullquote.w}px`
    boxElement.style.height = `${pullquote.h}px`
  }

  for (let index = 0; index < orbs.length; index++) {
    const orb = orbs[index]!
    const element = domCache.orbs[index]!
    if (index >= activeOrbCount) {
      element.style.display = 'none'
      continue
    }
    const radius = orb.r * orbRadiusScale
    element.style.display = ''
    element.style.left = `${orb.x - radius}px`
    element.style.top = `${orb.y - radius}px`
    element.style.width = `${radius * 2}px`
    element.style.height = `${radius * 2}px`
    element.style.opacity = orb.paused ? '0.45' : '1'
  }

  domCache.stage.style.userSelect = drag !== null ? 'none' : ''
  domCache.stage.style.webkitUserSelect = drag !== null ? 'none' : ''
  document.body.style.cursor = cursorStyle
  return stillAnimating
}

scheduleRender()
