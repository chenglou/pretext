import {
  layout,
  layoutWithLines,
  prepareWithSegments,
  type PreparedTextWithSegments,
} from '../src/layout.ts'
import {
  formatBreakContext,
  getDiagnosticUnits,
  getLineContent,
  measureCanvasTextWidth,
  measureDomTextWidth,
} from './diagnostic-utils.ts'
import { clearNavigationReport, publishNavigationPhase, publishNavigationReport } from './report-utils.ts'

type ProbeLine = {
  text: string
  renderedText: string
  contentText: string
  start: number
  end: number
  contentEnd: number
  fullWidth: number
  domWidth: number
  sumWidth?: number
}

type ProbeBreakMismatch = {
  line: number
  oursStart: number
  browserStart: number
  oursEnd: number
  browserEnd: number
  oursText: string
  browserText: string
  oursRenderedText: string
  browserRenderedText: string
  oursContext: string
  browserContext: string
  deltaText: string
  reasonGuess: string
  oursSumWidth: number
  oursDomWidth: number
  oursFullWidth: number
  browserDomWidth: number
  browserFullWidth: number
}

type ProbeLineSummary = {
  line: number
  text: string
  renderedText: string
  start: number
  end: number
}

type ProbeReport = {
  status: 'ready' | 'error'
  requestId?: string
  text?: string
  whiteSpace?: 'normal' | 'pre-wrap'
  wordBreak?: 'normal' | 'keep-all'
  width?: number
  contentWidth?: number
  font?: string
  lineHeight?: number
  direction?: string
  browserLineMethod?: 'range' | 'span'
  predictedHeight?: number
  actualHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  firstBreakMismatch?: ProbeBreakMismatch | null
  alternateBrowserLineMethod?: 'range' | 'span'
  alternateBrowserLineCount?: number
  alternateFirstBreakMismatch?: ProbeBreakMismatch | null
  extractorSensitivity?: string | null
  ourLines?: ProbeLineSummary[]
  browserLines?: ProbeLineSummary[]
  alternateBrowserLines?: ProbeLineSummary[]
  message?: string
}

declare global {
  interface Window {
    __PROBE_REPORT__?: ProbeReport
  }
}

const PADDING = 40
const params = new URLSearchParams(location.search)
const requestId = params.get('requestId') ?? undefined
const text = params.get('text') ?? ''
const width = Math.max(100, Number.parseInt(params.get('width') ?? '600', 10))
const font = params.get('font') ?? '18px serif'
const lineHeight = Math.max(1, Number.parseInt(params.get('lineHeight') ?? '32', 10))
const direction = params.get('dir') === 'rtl' ? 'rtl' : 'ltr'
const lang = params.get('lang') ?? (direction === 'rtl' ? 'ar' : 'en')
const browserLineMethod = params.get('method') === 'span' ? 'span' : 'range'
const verbose = params.get('verbose') === '1'
const whiteSpace = params.get('whiteSpace') === 'pre-wrap' ? 'pre-wrap' : 'normal'
const wordBreak = params.get('wordBreak') === 'keep-all' ? 'keep-all' : 'normal'
const cssWhiteSpace = whiteSpace === 'pre-wrap' ? 'pre-wrap' : 'normal'
const cssWordBreak = wordBreak === 'keep-all' ? 'keep-all' : 'normal'

const stats = document.getElementById('stats')!
const book = document.getElementById('book')!

const diagnosticDiv = document.createElement('div')
diagnosticDiv.style.position = 'absolute'
diagnosticDiv.style.top = '-99999px'
diagnosticDiv.style.left = '-99999px'
diagnosticDiv.style.visibility = 'hidden'
diagnosticDiv.style.pointerEvents = 'none'
diagnosticDiv.style.boxSizing = 'border-box'
diagnosticDiv.style.whiteSpace = cssWhiteSpace
diagnosticDiv.style.wordBreak = cssWordBreak
diagnosticDiv.style.wordWrap = 'break-word'
diagnosticDiv.style.overflowWrap = 'break-word'
diagnosticDiv.style.padding = `${PADDING}px`
document.body.appendChild(diagnosticDiv)

const diagnosticCanvas = document.createElement('canvas')
const diagnosticCtx = diagnosticCanvas.getContext('2d')!
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function withRequestId<T extends ProbeReport>(report: T): ProbeReport {
  return requestId === undefined ? report : { ...report, requestId }
}

function publishReport(report: ProbeReport): void {
  window.__PROBE_REPORT__ = report
  publishNavigationReport(report)
}

function setError(message: string): void {
  stats.textContent = `Error: ${message}`
  publishReport(withRequestId({ status: 'error', message }))
}

function getBrowserLinesFromSpans(prepared: PreparedTextWithSegments, measuredFont: string, dir: string): ProbeLine[] {
  const lines: ProbeLine[] = []
  const units = getDiagnosticUnits(prepared)
  const spans: HTMLSpanElement[] = []
  let currentLine = ''
  let currentStart: number | null = null
  let currentEnd = 0
  let lastTop: number | null = null

  diagnosticDiv.textContent = ''
  for (const unit of units) {
    const span = document.createElement('span')
    span.textContent = unit.text
    diagnosticDiv.appendChild(span)
    spans.push(span)
  }

  function pushLine(): void {
    if (currentStart === null || currentLine.length === 0) return
    const content = getLineContent(currentLine, currentEnd)
    lines.push({
      text: currentLine,
      renderedText: currentLine,
      contentText: content.text,
      start: currentStart,
      end: currentEnd,
      contentEnd: content.end,
      fullWidth: measureCanvasTextWidth(diagnosticCtx, content.text, measuredFont),
      domWidth: measureDomTextWidth(document, content.text, measuredFont, dir),
    })
  }

  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!
    const span = spans[i]!
    const rect = span.getBoundingClientRect()
    const top: number | null = rect.width > 0 || rect.height > 0 ? rect.top : lastTop

    if (top !== null && lastTop !== null && top > lastTop + 0.5) {
      pushLine()
      currentLine = unit.text
      currentStart = unit.start
      currentEnd = unit.end
    } else {
      if (currentStart === null) currentStart = unit.start
      currentLine += unit.text
      currentEnd = unit.end
    }

    if (top !== null) lastTop = top
  }

  pushLine()
  diagnosticDiv.textContent = text
  return lines
}

function getBrowserLines(
  prepared: PreparedTextWithSegments,
  measuredFont: string,
  dir: string,
  method: 'range' | 'span',
): ProbeLine[] {
  return method === 'span'
    ? getBrowserLinesFromSpans(prepared, measuredFont, dir)
    : getBrowserLinesFromRange(prepared, measuredFont, dir)
}

function getBrowserLinesFromRange(prepared: PreparedTextWithSegments, measuredFont: string, dir: string): ProbeLine[] {
  const textNode = diagnosticDiv.firstChild
  const lines: ProbeLine[] = []
  if (!(textNode instanceof Text)) return lines

  const units = getDiagnosticUnits(prepared)
  const range = document.createRange()
  let currentLine = ''
  let currentStart: number | null = null
  let currentEnd = 0
  let lastTop: number | null = null

  function pushLine(): void {
    if (currentStart === null || currentLine.length === 0) return
    const content = getLineContent(currentLine, currentEnd)
    lines.push({
      text: currentLine,
      renderedText: currentLine,
      contentText: content.text,
      start: currentStart,
      end: currentEnd,
      contentEnd: content.end,
      fullWidth: measureCanvasTextWidth(diagnosticCtx, content.text, measuredFont),
      domWidth: measureDomTextWidth(document, content.text, measuredFont, dir),
    })
  }

  for (const unit of units) {
    range.setStart(textNode, unit.start)
    range.setEnd(textNode, unit.end)
    const rects = range.getClientRects()
    const top: number | null = rects.length > 0 ? rects[0]!.top : lastTop

    if (top !== null && lastTop !== null && top > lastTop + 0.5) {
      pushLine()
      currentLine = unit.text
      currentStart = unit.start
      currentEnd = unit.end
    } else {
      if (currentStart === null) currentStart = unit.start
      currentLine += unit.text
      currentEnd = unit.end
    }

    if (top !== null) lastTop = top
  }

  pushLine()
  return lines
}

function measurePreparedSlice(
  prepared: PreparedTextWithSegments,
  start: number,
  end: number,
  measuredFont: string,
): number {
  let total = 0
  let offset = 0

  for (let i = 0; i < prepared.segments.length; i++) {
    const segment = prepared.segments[i]!
    const nextOffset = offset + segment.length
    if (nextOffset <= start) {
      offset = nextOffset
      continue
    }
    if (offset >= end) break

    const overlapStart = Math.max(start, offset)
    const overlapEnd = Math.min(end, nextOffset)
    if (overlapStart >= overlapEnd) {
      offset = nextOffset
      continue
    }

    const localStart = overlapStart - offset
    const localEnd = overlapEnd - offset
    if (localStart === 0 && localEnd === segment.length) {
      total += prepared.widths[i]!
    } else {
      total += measureCanvasTextWidth(diagnosticCtx, segment.slice(localStart, localEnd), measuredFont)
    }

    offset = nextOffset
  }

  return total
}

function getPublicLines(
  prepared: PreparedTextWithSegments,
  normalizedText: string,
  contentWidth: number,
  lineHeight: number,
  measuredFont: string,
): ProbeLine[] {
  return layoutWithLines(prepared, contentWidth, lineHeight).lines.map(line => {
    const start = line.start.segmentIndex === 0 && line.start.graphemeIndex === 0
      ? 0
      : computeOffsetFromCursor(prepared, line.start)
    const end = computeOffsetFromCursor(prepared, line.end)
    const content = getLineContent(line.text, end)
    const contentEnd = start + content.text.length
    const logicalText = normalizedText.slice(start, contentEnd)

    return {
      text: logicalText,
      renderedText: line.text,
      contentText: content.text,
      start,
      end,
      contentEnd,
      fullWidth: measureCanvasTextWidth(diagnosticCtx, content.text, measuredFont),
      domWidth: measureDomTextWidth(document, content.text, measuredFont, direction),
      sumWidth: measurePreparedSlice(prepared, start, contentEnd, measuredFont),
    }
  })
}

function summarizeLines(lines: ProbeLine[]): ProbeLineSummary[] {
  return lines.map((line, index) => ({
    line: index + 1,
    text: line.text,
    renderedText: line.renderedText,
    start: line.start,
    end: line.end,
  }))
}

function computeOffsetFromCursor(prepared: PreparedTextWithSegments, cursor: { segmentIndex: number, graphemeIndex: number }): number {
  let offset = 0
  for (let i = 0; i < cursor.segmentIndex; i++) offset += prepared.segments[i]!.length
  if (cursor.graphemeIndex === 0 || cursor.segmentIndex >= prepared.segments.length) return offset

  let graphemeIndex = 0
  for (const grapheme of graphemeSegmenter.segment(prepared.segments[cursor.segmentIndex]!)) {
    if (graphemeIndex >= cursor.graphemeIndex) break
    offset += grapheme.segment.length
    graphemeIndex++
  }
  return offset
}

function classifyBreakMismatch(contentWidth: number, ours: ProbeLine | undefined, browser: ProbeLine | undefined): string {
  if (!ours || !browser) return 'line-count mismatch after an earlier break shift'

  const longer = ours.contentEnd >= browser.contentEnd ? ours : browser
  const longerLabel = longer === ours ? 'ours' : 'browser'
  const overflow = longer.fullWidth - contentWidth
  if (Math.abs(overflow) <= 0.05) {
    return `${longerLabel} keeps text with only ${overflow.toFixed(3)}px overflow`
  }

  const oursDrift = (ours.sumWidth ?? ours.fullWidth) - ours.fullWidth
  if (Math.abs(oursDrift) > 0.05) {
    return `our segment sum drifts from full-string width by ${oursDrift.toFixed(3)}px`
  }

  if (browser.contentEnd > ours.contentEnd && browser.fullWidth <= contentWidth) {
    return 'browser fits the longer line while our break logic cuts earlier'
  }

  return 'different break opportunity around punctuation or shaping context'
}

function getFirstBreakMismatch(
  normalizedText: string,
  contentWidth: number,
  ourLines: ProbeLine[],
  browserLines: ProbeLine[],
): ProbeBreakMismatch | null {
  const maxLines = Math.max(ourLines.length, browserLines.length)
  for (let i = 0; i < maxLines; i++) {
    const ours = ourLines[i]
    const browser = browserLines[i]
    if (!ours || !browser || ours.start !== browser.start || ours.contentEnd !== browser.contentEnd) {
      const oursEnd = ours?.contentEnd ?? ours?.start ?? browser?.start ?? 0
      const browserEnd = browser?.contentEnd ?? browser?.start ?? ours?.start ?? 0
      const minEnd = Math.min(oursEnd, browserEnd)
      const maxEnd = Math.max(oursEnd, browserEnd)

      return {
        line: i + 1,
        oursStart: ours?.start ?? -1,
        browserStart: browser?.start ?? -1,
        oursEnd,
        browserEnd,
        oursText: ours?.contentText ?? '',
        browserText: browser?.contentText ?? '',
        oursRenderedText: ours?.renderedText ?? '',
        browserRenderedText: browser?.renderedText ?? browser?.text ?? '',
        oursContext: formatBreakContext(normalizedText, oursEnd, 24),
        browserContext: formatBreakContext(normalizedText, browserEnd, 24),
        deltaText: normalizedText.slice(minEnd, maxEnd),
        reasonGuess: classifyBreakMismatch(contentWidth, ours, browser),
        oursSumWidth: ours?.sumWidth ?? 0,
        oursDomWidth: ours?.domWidth ?? 0,
        oursFullWidth: ours?.fullWidth ?? 0,
        browserDomWidth: browser?.domWidth ?? 0,
        browserFullWidth: browser?.fullWidth ?? 0,
      }
    }
  }

  return null
}

function init(): void {
  try {
    publishNavigationPhase('measuring', requestId)
    document.title = 'Pretext — Text Probe'
    document.documentElement.lang = lang
    document.documentElement.dir = direction

    book.textContent = text
    book.lang = lang
    book.dir = direction
    book.style.font = font
    book.style.lineHeight = `${lineHeight}px`
    book.style.padding = `${PADDING}px`
    book.style.width = `${width}px`
    book.style.whiteSpace = cssWhiteSpace
    book.style.wordBreak = cssWordBreak

    diagnosticDiv.textContent = text
    diagnosticDiv.lang = lang
    diagnosticDiv.dir = direction
    diagnosticDiv.style.font = font
    diagnosticDiv.style.lineHeight = `${lineHeight}px`
    diagnosticDiv.style.padding = `${PADDING}px`
    diagnosticDiv.style.width = `${width}px`
    diagnosticDiv.style.whiteSpace = cssWhiteSpace
    diagnosticDiv.style.wordBreak = cssWordBreak

    const prepared = prepareWithSegments(text, font, { whiteSpace, wordBreak })
    const normalizedText = prepared.segments.join('')
    const contentWidth = width - PADDING * 2
    const predicted = layout(prepared, contentWidth, lineHeight)
    const actualHeight = book.getBoundingClientRect().height
    const ourLines = getPublicLines(prepared, normalizedText, contentWidth, lineHeight, font)
    const alternateBrowserLineMethod = browserLineMethod === 'span' ? 'range' : 'span'
    const browserLines = getBrowserLines(prepared, font, direction, browserLineMethod)
    const alternateBrowserLines = getBrowserLines(prepared, font, direction, alternateBrowserLineMethod)
    const firstBreakMismatch = getFirstBreakMismatch(normalizedText, contentWidth, ourLines, browserLines)
    const alternateFirstBreakMismatch = getFirstBreakMismatch(normalizedText, contentWidth, ourLines, alternateBrowserLines)
    const extractorSensitivity =
      firstBreakMismatch !== null && alternateFirstBreakMismatch === null
        ? `${browserLineMethod} mismatch disappears with ${alternateBrowserLineMethod}`
        : null

    const report = withRequestId({
      status: 'ready',
      text,
      whiteSpace,
      wordBreak,
      width,
      contentWidth,
      font,
      lineHeight,
      direction,
      browserLineMethod,
      predictedHeight: predicted.height + PADDING * 2,
      actualHeight,
      diffPx: predicted.height + PADDING * 2 - actualHeight,
      predictedLineCount: ourLines.length,
      browserLineCount: browserLines.length,
      firstBreakMismatch,
      alternateBrowserLineMethod,
      alternateBrowserLineCount: alternateBrowserLines.length,
      alternateFirstBreakMismatch,
      extractorSensitivity,
      ...(verbose ? {
        ourLines: summarizeLines(ourLines),
        browserLines: summarizeLines(browserLines),
        alternateBrowserLines: summarizeLines(alternateBrowserLines),
      } : {}),
    })

    stats.textContent =
      `Width ${width}px | Pretext ${report.predictedLineCount} lines | DOM ${report.browserLineCount} lines | Diff ${report.diffPx}px`
    publishReport(report)
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error))
  }
}

window.__PROBE_REPORT__ = withRequestId({ status: 'error', message: 'Pending initial layout' })
clearNavigationReport()
publishNavigationPhase('loading', requestId)
if ('fonts' in document) {
  void document.fonts.ready.then(init)
} else {
  init()
}
