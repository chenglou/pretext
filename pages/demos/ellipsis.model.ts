import {
  layout,
  layoutNextLine,
  layoutNextLineRange,
  layoutWithLines,
  measureNaturalWidth,
  prepareWithSegments,
  walkLineRanges,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '../../src/layout.ts'

// Local layout model for this demo: where a truncated line is cut, from Pretext's line
// stream. Userland structure on the public API, not a new core abstraction.

// Every value Pretext measures or a width depends on. The painter writes them inline, and
// CSS doesn't restate them.
export const FONT = '16px "Helvetica Neue", "PingFang SC", "Geeza Pro", sans-serif'
export const LINE_HEIGHT = 24
export const MAX_LINES = 5
export const DEFAULT_LINES = 3
export const DEFAULT_TEXT_WIDTH = 300
export const MIN_TEXT_WIDTH = 120
const MAX_TEXT_WIDTH = 440
const PAGE_MAX_WIDTH = 480
const PAGE_MARGIN_X = 16
const NARROW_PAGE_MARGIN_X = 10
// At this width and below, the page takes the narrow margins.
const NARROW_MAX_VIEWPORT_WIDTH = 640
// A card's padding around its text.
export const CARD_PADDING_X = 16
export const CARD_PADDING_Y = 12

export const ELLIPSIS = '…'
export const MORE_LABEL = 'more'
export const LESS_LABEL = 'less'

// Browsers draw a clamp's ellipsis in the paragraph's first font, or three periods where
// that font has none, so its width is measured in the paragraph's font. A lone space
// collapses to nothing, so a no-break space stands in for the space between words.
const ELLIPSIS_WIDTH = measureWidth(ELLIPSIS)
const SPACE_WIDTH = measureWidth('\u00A0')
// The links with what the painter puts before them: "… more", and a space then "less".
const MORE_WIDTH = measureWidth(`${ELLIPSIS} ${MORE_LABEL}`)
const LESS_WIDTH = SPACE_WIDTH + measureWidth(LESS_LABEL)

export type Sample = {
  label: string
  text: string
  direction: 'ltr' | 'rtl'
  prepared: PreparedTextWithSegments
}

// A one-line label, with the places it can be cut: each grapheme's start.
export type Label = {
  label: string
  text: string
  prepared: PreparedTextWithSegments
  starts: LayoutCursor[]
}

export type PageGeometry = {
  pageWidth: number
  maxTextWidth: number
  textWidth: number
}

// A paragraph clamped to a number of lines: the lines shown, the last cut to leave an
// ellipsis room when `truncated`, which the painter appends.
export type ClampLayout = {
  truncated: boolean
  height: number
  lines: string[]
}

// A paragraph that ends with a link: its lines, the line the link follows (one with no text
// when the last line has no room for it) and its height.
export type MoreLayout = {
  lines: string[]
  linkLine: number // -1 without a link
  height: number
}

const START: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
// Pretext fits a line as the browser does, which lets one run past its width by a
// rounding step, 1/64px at most. A line wider than that didn't fit.
const FIT_TOLERANCE = 1 / 64

function measureWidth(text: string): number {
  return measureNaturalWidth(prepareWithSegments(text, FONT))
}

function createSample(label: string, direction: 'ltr' | 'rtl', text: string): Sample {
  return { label, text, direction, prepared: prepareWithSegments(text, FONT) }
}

function createLabel(label: string, text: string): Label {
  const prepared = prepareWithSegments(text, FONT)
  // A line no wider than 0 holds one grapheme, as under overflow-wrap: break-word, so the
  // lines' starts are every place the text can be cut.
  const starts: LayoutCursor[] = []
  walkLineRanges(prepared, 0, line => {
    starts.push(line.start)
  })
  return { label, text, prepared, starts }
}

export const samples: Sample[] = [
  createSample('End', 'ltr', 'A weekend cabin on the north shore, twenty minutes from the ferry. Sleeps six, with a wood stove, no reception to speak of, and a rowing boat you’re welcome to borrow. Bring boots: the path down to the water is steep, and the nearest shop is back across on the mainland.'),
  createSample('End, right-to-left', 'rtl', 'بدأت الرحلة في الصباح الباكر، وكانت الطريق إلى الساحل طويلة، لكن المناظر على جانبيها جعلتنا ننسى التعب تماما حتى وصلنا إلى الميناء القديم. هناك جلسنا على الرصيف نشرب الشاي ونراقب القوارب وهي تعود محملة بالصيد، ثم مشينا في الأزقة الضيقة حتى غابت الشمس.'),
]

export const middleLabel = createLabel('Middle', '~/Projects/atlas/packages/renderer/src/text/layout/line-breaker.test.ts')

export const moreSample = createSample('Link after the cut', 'ltr', samples[0]!.text)

export function getPageGeometry(viewportWidth: number, requestedTextWidth: number): PageGeometry {
  const marginX = viewportWidth <= NARROW_MAX_VIEWPORT_WIDTH ? NARROW_PAGE_MARGIN_X : PAGE_MARGIN_X
  const pageWidth = Math.min(PAGE_MAX_WIDTH, viewportWidth - marginX * 2)
  const maxTextWidth = Math.min(MAX_TEXT_WIDTH, pageWidth - CARD_PADDING_X * 2)
  return { pageWidth, maxTextWidth, textWidth: Math.min(requestedTextWidth, maxTextWidth) }
}

function trimEndSpace(text: string): string {
  return text.endsWith(' ') ? text.slice(0, -1) : text
}

// The start of the line at `start` that fits in `room`, cut between any two graphemes.
// Pretext's line stream ends a line only where the browser wraps, so the line is taken in
// pieces: each call takes the words that fit the room left, and once not even one word fits,
// the call breaks inside it, as overflow-wrap: break-word does. A piece's width leaves out
// the space it ended at, so that space is counted here.
function fillLine(prepared: PreparedTextWithSegments, start: LayoutCursor, room: number): string {
  let text = ''
  let cursor = start
  let x = 0
  for (;;) {
    const piece = layoutNextLine(prepared, cursor, room - x)
    // A line holds at least one grapheme, even one that doesn't fit.
    if (piece === null || piece.width > room - x + FIT_TOLERANCE) return text
    x += piece.width
    if (piece.text.endsWith(' ')) {
      if (x + SPACE_WIDTH > room) return text + piece.text.slice(0, -1)
      x += SPACE_WIDTH
    }
    text += piece.text
    cursor = piece.end
  }
}

// The first `maxLines` lines of a paragraph at `width`. When text is left over, the last
// line leaves `tailWidth` free for an ellipsis or a link, the way browsers end a
// -webkit-line-clamp box: the line breaks where it would without the clamp, the tail
// follows it if both fit, and otherwise the line is cut after the last grapheme that leaves
// the tail room.
function clampLines(prepared: PreparedTextWithSegments, width: number, maxLines: number, tailWidth: number): string[] {
  const lines: string[] = []
  let cursor = START
  let lastStart = START
  let lastWidth = 0
  for (let i = 0; i < maxLines; i++) {
    const line = layoutNextLine(prepared, cursor, width)
    if (line === null) return lines
    lines.push(line.text)
    lastStart = cursor
    lastWidth = line.width
    cursor = line.end
  }
  if (layoutNextLineRange(prepared, cursor, width) === null) return lines
  const last = lines.length - 1
  lines[last] = lastWidth + tailWidth <= width ? trimEndSpace(lines[last]!) : fillLine(prepared, lastStart, width - tailWidth)
  return lines
}

// layout() alone gives a clamped paragraph's height and whether it is truncated, with no
// line built: all a list needs for the rows it doesn't paint.
export function layoutClamp(prepared: PreparedTextWithSegments, width: number, maxLines: number): ClampLayout {
  const lineCount = layout(prepared, width, LINE_HEIGHT).lineCount
  return {
    truncated: lineCount > maxLines,
    height: Math.min(lineCount, maxLines) * LINE_HEIGHT,
    lines: clampLines(prepared, width, maxLines, ELLIPSIS_WIDTH),
  }
}

// One line that keeps a label's start and end around an ellipsis. The end is the longest
// run of graphemes that fits half the room; the start fills what is left. The stream only
// walks forward, so each candidate end is measured as the line from its first grapheme.
export function layoutMiddle(label: Label, width: number): string {
  const { prepared, starts } = label
  const whole = layoutNextLineRange(prepared, START, Number.POSITIVE_INFINITY)
  if (whole === null || whole.width <= width) return label.text
  const room = width - ELLIPSIS_WIDTH
  let end = ''
  let endWidth = 0
  for (let i = starts.length - 1; i > 0; i--) {
    const rest = layoutNextLine(prepared, starts[i]!, Number.POSITIVE_INFINITY)
    if (rest === null || rest.width > room / 2) break
    end = rest.text
    endWidth = rest.width
  }
  return fillLine(prepared, START, room - endWidth) + ELLIPSIS + end
}

// A paragraph with a link after its text, when it has more than `maxLines` lines. Closed,
// it is clamped to them and the last one leaves "… more" room. Open, it shows every line,
// and "less" follows the last one where it fits, or takes a line of its own.
export function layoutMore(prepared: PreparedTextWithSegments, width: number, maxLines: number, open: boolean): MoreLayout {
  const lineCount = layout(prepared, width, LINE_HEIGHT).lineCount
  if (lineCount > maxLines && !open) {
    return { lines: clampLines(prepared, width, maxLines, MORE_WIDTH), linkLine: maxLines - 1, height: maxLines * LINE_HEIGHT }
  }
  const whole = layoutWithLines(prepared, width, LINE_HEIGHT).lines
  const lines: string[] = []
  for (let i = 0; i < whole.length; i++) lines.push(whole[i]!.text)
  if (lineCount <= maxLines) return { lines, linkLine: -1, height: lineCount * LINE_HEIGHT }
  if (whole[lineCount - 1]!.width + LESS_WIDTH > width) lines.push('')
  return { lines, linkLine: lines.length - 1, height: lines.length * LINE_HEIGHT }
}
