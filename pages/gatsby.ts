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
} from './diagnostic-utils.ts'
import {
  clearNavigationReport,
  publishNavigationPhase,
  publishNavigationReport as publishHashReport,
} from './report-utils.ts'

const book = document.getElementById('book')!
const slider = document.getElementById('slider') as HTMLInputElement
const valLabel = document.getElementById('val')!
const stats = document.getElementById('stats')!

import text from '../corpora/en-gatsby-opening.txt' with { type: 'text' }

type GatsbyLineMismatch = {
  line: number
  ours: string
  browser: string
}

type GatsbyReport = {
  status: 'ready' | 'error'
  requestId?: string
  width?: number
  contentWidth?: number
  predictedHeight?: number
  actualHeight?: number
  diagnosticHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  mismatchCount?: number
  firstMismatch?: GatsbyLineMismatch | null
  firstBreakMismatch?: GatsbyBreakMismatch | null
  widths?: number[]
  widthCount?: number
  exactCount?: number
  rows?: GatsbySweepRow[]
  message?: string
}

type GatsbyNavigationReport = {
  status: 'ready' | 'error'
  requestId?: string
  width?: number
  widthCount?: number
  exactCount?: number
  predictedHeight?: number
  actualHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  mismatchCount?: number
  firstMismatch?: GatsbyLineMismatch | null
  firstBreakMismatch?: Pick<GatsbyBreakMismatch, 'line' | 'deltaText' | 'oursContext' | 'browserContext' | 'reasonGuess'> | null
  message?: string
}

type GatsbySweepRow = {
  width: number
  predictedHeight: number
  actualHeight: number
  diffPx: number
  predictedLineCount: number | null
  browserLineCount: number | null
  mismatchCount: number | null
  firstMismatch?: GatsbyLineMismatch | null
  firstBreakMismatch?: Pick<GatsbyBreakMismatch, 'line' | 'deltaText' | 'oursContext' | 'browserContext' | 'reasonGuess'> | null
}

type GatsbyBreakMismatch = {
  line: number
  start: number
  oursEnd: number
  browserEnd: number
  oursRawEnd: number
  browserRawEnd: number
  deltaText: string
  oursContext: string
  browserContext: string
  contentWidth: number
  oursText: string
  browserText: string
  oursSumWidth: number
  oursFullWidth: number
  oursRawWidth: number
  browserDomWidth: number
  browserFullWidth: number
  browserRawDomWidth: number
  browserRawWidth: number
  reasonGuess: string
  oursBoundary: GatsbyBoundary
  browserBoundary: GatsbyBoundary
  segmentWindow: GatsbyBreakSegment[]
}

type DiagnosticLine = {
  text: string
  contentText: string
  start: number
  end: number
  contentEnd: number
  fullWidth: number
  rawFullWidth: number
  sumWidth?: number
  domWidth?: number
  rawDomWidth?: number
}

type GatsbyBoundary = {
  offset: number
  description: string
}

type GatsbyBreakSegment = {
  index: number
  start: number
  end: number
  text: string
  width: number
  isSpace: boolean
  breakable: boolean
  oursAtStart: boolean
  oursAtEnd: boolean
  oursInside: boolean
  browserAtStart: boolean
  browserAtEnd: boolean
  browserInside: boolean
}

type SegmentSpan = {
  index: number
  start: number
  end: number
  text: string
  width: number
  isSpace: boolean
  breakable: boolean
}

declare global {
  interface Window {
    __GATSBY_REPORT__?: GatsbyReport
  }
}

const FONT = '16px Georgia, "Times New Roman", serif'
const LINE_HEIGHT = 26
const PADDING = 40
const DEFAULT_WIDTH = 600

const collapsibleWhitespaceRunRe = /[ \t\n\r\f]+/g
const needsWhitespaceNormalizationRe = /[\t\n\r\f]| {2,}|^ | $/
const diagnosticGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const diagnosticCanvas = document.createElement('canvas')
const diagnosticCtx = diagnosticCanvas.getContext('2d')!
diagnosticCtx.font = FONT

function normalizeWhitespaceNormal(input: string): string {
  if (!needsWhitespaceNormalizationRe.test(input)) return input

  let normalized = input.replace(collapsibleWhitespaceRunRe, ' ')
  if (normalized.charCodeAt(0) === 0x20) {
    normalized = normalized.slice(1)
  }
  if (normalized.length > 0 && normalized.charCodeAt(normalized.length - 1) === 0x20) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

const normalizedText = normalizeWhitespaceNormal(text)

book.textContent = text

const diagnosticDiv = document.createElement('div')
diagnosticDiv.style.position = 'absolute'
diagnosticDiv.style.top = '-99999px'
diagnosticDiv.style.left = '-99999px'
diagnosticDiv.style.visibility = 'hidden'
diagnosticDiv.style.pointerEvents = 'none'
diagnosticDiv.style.font = FONT
diagnosticDiv.style.lineHeight = `${LINE_HEIGHT}px`
diagnosticDiv.style.padding = `${PADDING}px`
diagnosticDiv.style.boxSizing = 'border-box'
diagnosticDiv.style.whiteSpace = 'normal'
diagnosticDiv.style.wordWrap = 'break-word'
diagnosticDiv.style.overflowWrap = 'break-word'
diagnosticDiv.textContent = normalizedText
document.body.appendChild(diagnosticDiv)

const params = new URLSearchParams(location.search)
const reportMode = params.get('report') === '1'
const diagnosticMode = params.get('diagnostic') ?? 'full'
const requestId = params.get('requestId') ?? undefined
const reportEndpoint = params.get('reportEndpoint')
const requestedWidths = parseWidthList(params.get('widths'))
const prepared = prepareWithSegments(text, FONT)
const segmentSpans = buildSegmentSpans(prepared)
const segmentSpansByStart = new Map(segmentSpans.map(span => [span.start, span] as const))

function parseWidthList(raw: string | null): number[] | null {
  if (raw === null) return null

  const widths = raw
    .split(',')
    .map(part => Number.parseInt(part.trim(), 10))
    .filter(width => Number.isFinite(width))

  if (widths.length === 0) {
    throw new Error(`Invalid widths parameter: ${raw}`)
  }

  return [...new Set(widths)]
}

function parseInitialWidth(): number {
  const requested = Number.parseInt(params.get('width') ?? '', 10)
  const fallback = Number.isFinite(requested) ? requested : DEFAULT_WIDTH
  const min = Number.parseInt(slider.min, 10)
  const max = Number.parseInt(slider.max, 10)
  return Math.max(min, Math.min(max, fallback))
}

function withRequestId<T extends GatsbyReport>(report: T): GatsbyReport {
  return requestId === undefined ? report : { ...report, requestId }
}

function toNavigationReport(report: GatsbyReport): GatsbyNavigationReport {
  if (report.status === 'error') {
    return {
      status: report.status,
      ...(report.requestId === undefined ? {} : { requestId: report.requestId }),
      ...(report.message === undefined ? {} : { message: report.message }),
    }
  }

  return {
    status: report.status,
    ...(report.requestId === undefined ? {} : { requestId: report.requestId }),
    ...(report.width === undefined ? {} : { width: report.width }),
    ...(report.widthCount === undefined ? {} : { widthCount: report.widthCount }),
    ...(report.exactCount === undefined ? {} : { exactCount: report.exactCount }),
    ...(report.predictedHeight === undefined ? {} : { predictedHeight: report.predictedHeight }),
    ...(report.actualHeight === undefined ? {} : { actualHeight: report.actualHeight }),
    ...(report.diffPx === undefined ? {} : { diffPx: report.diffPx }),
    ...(report.predictedLineCount === undefined ? {} : { predictedLineCount: report.predictedLineCount }),
    ...(report.browserLineCount === undefined ? {} : { browserLineCount: report.browserLineCount }),
    ...(report.mismatchCount === undefined ? {} : { mismatchCount: report.mismatchCount }),
    ...(report.firstMismatch === undefined ? {} : { firstMismatch: report.firstMismatch }),
    ...(report.firstBreakMismatch === undefined
      ? {}
      : report.firstBreakMismatch === null
        ? { firstBreakMismatch: null }
        : {
            firstBreakMismatch: {
              line: report.firstBreakMismatch.line,
              deltaText: report.firstBreakMismatch.deltaText,
              oursContext: report.firstBreakMismatch.oursContext,
              browserContext: report.firstBreakMismatch.browserContext,
              reasonGuess: report.firstBreakMismatch.reasonGuess,
            },
          }),
  }
}

function publishNavigationReport(report: GatsbyReport): void {
  const navigationReport = toNavigationReport(report)
  publishHashReport(navigationReport)
}

function setReport(report: GatsbyReport): void {
  window.__GATSBY_REPORT__ = report
  if (reportEndpoint !== null) {
    publishNavigationPhase('posting', requestId)
    void (async () => {
      try {
        await fetch(reportEndpoint, {
          method: 'POST',
          body: JSON.stringify(report),
        })
        publishNavigationReport(report)
      } catch {
        // Best-effort side channel for larger sweep reports.
      }
    })()
    return
  }
  publishNavigationReport(report)
}

function buildSegmentSpans(preparedText: PreparedTextWithSegments): SegmentSpan[] {
  const spans: SegmentSpan[] = []
  let offset = 0

  for (let i = 0; i < preparedText.segments.length; i++) {
    const segText = preparedText.segments[i]!
    const start = offset
    offset += segText.length
    spans.push({
      index: i,
      start,
      end: offset,
      text: segText,
      width: preparedText.widths[i]!,
      isSpace: preparedText.kinds[i] === 'space',
      breakable: preparedText.breakableWidths[i] !== null,
    })
  }

  return spans
}

function describeBoundary(offset: number, spans: SegmentSpan[]): GatsbyBoundary {
  if (offset <= 0) {
    return { offset, description: 'start of text' }
  }
  if (offset >= normalizedText.length) {
    return { offset, description: 'end of text' }
  }

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!
    if (offset === span.start) {
      const prev = i > 0 ? spans[i - 1] : null
      return {
        offset,
        description: prev
          ? `between #${prev.index} ${JSON.stringify(prev.text)} and #${span.index} ${JSON.stringify(span.text)}`
          : `before #${span.index} ${JSON.stringify(span.text)}`,
      }
    }
    if (offset > span.start && offset < span.end) {
      const localOffset = offset - span.start
      if (span.breakable) {
        let graphemeStart = 0
        let graphemeIndex = 0
        for (const gs of diagnosticGraphemeSegmenter.segment(span.text)) {
          const nextStart = graphemeStart + gs.segment.length
          if (localOffset > graphemeStart && localOffset < nextStart) {
            return {
              offset,
              description: `inside breakable #${span.index} ${JSON.stringify(span.text)} at ${localOffset}/${span.text.length}, inside grapheme ${graphemeIndex} ${JSON.stringify(gs.segment)}`,
            }
          }
          graphemeStart = nextStart
          graphemeIndex++
        }
      }
      return {
        offset,
        description: `inside #${span.index} ${JSON.stringify(span.text)} at ${localOffset}/${span.text.length}`,
      }
    }
    if (offset === span.end) {
      const next = i + 1 < spans.length ? spans[i + 1] : null
      return {
        offset,
        description: next
          ? `between #${span.index} ${JSON.stringify(span.text)} and #${next.index} ${JSON.stringify(next.text)}`
          : `after #${span.index} ${JSON.stringify(span.text)}`,
      }
    }
  }

  return { offset, description: 'end of text' }
}

function getSegmentWindow(
  spans: SegmentSpan[],
  oursOffset: number,
  browserOffset: number,
  radius = 3,
): GatsbyBreakSegment[] {
  const minOffset = Math.min(oursOffset, browserOffset)
  const maxOffset = Math.max(oursOffset, browserOffset)

  let startIndex = spans.findIndex(span => span.end >= minOffset)
  if (startIndex === -1) startIndex = Math.max(0, spans.length - 1)

  let endIndex = startIndex
  while (endIndex + 1 < spans.length && spans[endIndex]!.start <= maxOffset) {
    endIndex++
  }

  startIndex = Math.max(0, startIndex - radius)
  endIndex = Math.min(spans.length - 1, endIndex + radius)

  const windowSegments: GatsbyBreakSegment[] = []
  for (let i = startIndex; i <= endIndex; i++) {
    const span = spans[i]!
    windowSegments.push({
      index: span.index,
      start: span.start,
      end: span.end,
      text: span.text,
      width: span.width,
      isSpace: span.isSpace,
      breakable: span.breakable,
      oursAtStart: oursOffset === span.start,
      oursAtEnd: oursOffset === span.end,
      oursInside: oursOffset > span.start && oursOffset < span.end,
      browserAtStart: browserOffset === span.start,
      browserAtEnd: browserOffset === span.end,
      browserInside: browserOffset > span.start && browserOffset < span.end,
    })
  }

  return windowSegments
}

function getBrowserLines(
  preparedText: PreparedTextWithSegments,
  div: HTMLDivElement,
): DiagnosticLine[] {
  const textNode = div.firstChild
  if (!(textNode instanceof Text)) return []
  const safeTextNode: Text = textNode

  const units = getDiagnosticUnits(preparedText)
  const unitRange = document.createRange()
  const lineRange = document.createRange()
  const browserLines: DiagnosticLine[] = []
  let currentLine = ''
  let currentStart: number | null = null
  let currentEnd = 0
  let lastTop: number | null = null

  function pushBrowserLine(): void {
    if (currentLine.length === 0 || currentStart === null) return
    const content = getLineContent(currentLine, currentEnd)
    lineRange.setStart(safeTextNode, currentStart)
    lineRange.setEnd(safeTextNode, currentEnd)
    const rawDomWidth = lineRange.getBoundingClientRect().width
    lineRange.setEnd(safeTextNode, content.end)
    browserLines.push({
      text: currentLine,
      contentText: content.text,
      start: currentStart,
      end: currentEnd,
      contentEnd: content.end,
      fullWidth: measureCanvasTextWidth(diagnosticCtx, content.text, FONT),
      rawFullWidth: measureCanvasTextWidth(diagnosticCtx, currentLine, FONT),
      domWidth: lineRange.getBoundingClientRect().width,
      rawDomWidth,
    })
  }

  for (const unit of units) {
    unitRange.setStart(safeTextNode, unit.start)
    unitRange.setEnd(safeTextNode, unit.end)
    const rects = unitRange.getClientRects()
    const rectTop: number | null = rects.length > 0 ? rects[0]!.top : lastTop

    if (rectTop !== null && lastTop !== null && rectTop > lastTop + 0.5) {
      pushBrowserLine()
      currentLine = unit.text
      currentStart = unit.start
      currentEnd = unit.end
    } else {
      if (currentStart === null) currentStart = unit.start
      currentLine += unit.text
      currentEnd = unit.end
    }

    if (rectTop !== null) lastTop = rectTop
  }

  pushBrowserLine()
  return browserLines
}

function getOurLines(
  preparedText: PreparedTextWithSegments,
  maxWidth: number,
): DiagnosticLine[] {
  const layoutLines = layoutWithLines(preparedText, maxWidth, LINE_HEIGHT).lines
  const lines: DiagnosticLine[] = []
  let rawOffset = 0

  for (const line of layoutLines) {
    const start = rawOffset
    const visibleEnd = start + line.text.length
    let end = visibleEnd
    while (segmentSpansByStart.get(end)?.isSpace === true) {
      end = segmentSpansByStart.get(end)!.end
    }
    const content = getLineContent(line.text, visibleEnd)
    lines.push({
      text: line.text,
      contentText: content.text,
      start,
      end,
      contentEnd: content.end,
      sumWidth: line.width,
      fullWidth: measureCanvasTextWidth(diagnosticCtx, content.text, FONT),
      rawFullWidth: measureCanvasTextWidth(diagnosticCtx, normalizedText.slice(start, end), FONT),
    })
    rawOffset = end
  }

  return lines
}

function classifyBreakMismatch(
  contentWidth: number,
  ours: DiagnosticLine | undefined,
  browser: DiagnosticLine | undefined,
): string {
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

  return 'different break opportunity around punctuation or quotes'
}

function getFirstBreakMismatch(
  contentWidth: number,
  ourLines: DiagnosticLine[],
  browserLines: DiagnosticLine[],
): GatsbyBreakMismatch | null {
  const maxLines = Math.max(ourLines.length, browserLines.length)
  for (let i = 0; i < maxLines; i++) {
    const ours = ourLines[i]
    const browser = browserLines[i]

    if (!ours || !browser || ours.start !== browser.start || ours.contentEnd !== browser.contentEnd) {
      const start = ours?.start ?? browser?.start ?? 0
      const oursEnd = ours?.contentEnd ?? start
      const browserEnd = browser?.contentEnd ?? start
      const minEnd = Math.min(oursEnd, browserEnd)
      const maxEnd = Math.max(oursEnd, browserEnd)

      return {
        line: i + 1,
        start,
        oursEnd,
        browserEnd,
        oursRawEnd: ours?.end ?? start,
        browserRawEnd: browser?.end ?? start,
        deltaText: normalizedText.slice(minEnd, maxEnd),
        oursContext: formatBreakContext(normalizedText, oursEnd),
        browserContext: formatBreakContext(normalizedText, browserEnd),
        contentWidth,
        oursText: ours?.contentText ?? '',
        browserText: browser?.contentText ?? '',
        oursSumWidth: ours?.sumWidth ?? 0,
        oursFullWidth: ours?.fullWidth ?? 0,
        oursRawWidth: ours?.rawFullWidth ?? 0,
        browserDomWidth: browser?.domWidth ?? 0,
        browserFullWidth: browser?.fullWidth ?? 0,
        browserRawDomWidth: browser?.rawDomWidth ?? 0,
        browserRawWidth: browser?.rawFullWidth ?? 0,
        reasonGuess: classifyBreakMismatch(contentWidth, ours, browser),
        oursBoundary: describeBoundary(oursEnd, segmentSpans),
        browserBoundary: describeBoundary(browserEnd, segmentSpans),
        segmentWindow: getSegmentWindow(segmentSpans, oursEnd, browserEnd),
      }
    }
  }
  return null
}

function buildReport(width: number, predictedHeight: number, actualHeight: number, diagnosticHeight: number): GatsbyReport {
  if (!reportMode) {
    return withRequestId({
      status: 'ready',
      width,
      contentWidth: width - PADDING * 2,
      predictedHeight,
      actualHeight,
      diagnosticHeight,
      diffPx: predictedHeight - actualHeight,
    })
  }

  const contentWidth = width - PADDING * 2
  if (diagnosticMode !== 'full') {
    return withRequestId({
      status: 'ready',
      width,
      contentWidth,
      predictedHeight,
      actualHeight,
      diagnosticHeight,
      diffPx: predictedHeight - actualHeight,
    })
  }

  const ourLines = getOurLines(prepared, contentWidth)
  const browserLines = getBrowserLines(prepared, diagnosticDiv)

  let mismatchCount = 0
  let firstMismatch: GatsbyLineMismatch | null = null
  const maxLines = Math.max(ourLines.length, browserLines.length)

  for (let i = 0; i < maxLines; i++) {
    const ours = ourLines[i]?.contentText ?? ''
    const browser = browserLines[i]?.contentText ?? ''
    if (ours !== browser) {
      mismatchCount++
      if (firstMismatch === null) {
        firstMismatch = { line: i + 1, ours, browser }
      }
    }
  }

  return withRequestId({
    status: 'ready',
    width,
    contentWidth,
    predictedHeight,
    actualHeight,
    diagnosticHeight,
    diffPx: predictedHeight - actualHeight,
    predictedLineCount: ourLines.length,
    browserLineCount: browserLines.length,
    mismatchCount,
    firstMismatch,
    firstBreakMismatch: getFirstBreakMismatch(contentWidth, ourLines, browserLines),
  })
}

function measureWidth(
  width: number,
  options: { publish?: boolean, updateStats?: boolean } = {},
): GatsbyReport {
  slider.value = String(width)
  valLabel.textContent = `${width}px`

  const contentWidth = width - PADDING * 2

  const t0p = performance.now()
  const predicted = layout(prepared, contentWidth, LINE_HEIGHT)
  const msPretext = performance.now() - t0p

  const t0d = performance.now()
  book.style.width = `${width}px`
  diagnosticDiv.style.width = `${width}px`
  const actualHeight = book.getBoundingClientRect().height
  const diagnosticHeight = diagnosticDiv.getBoundingClientRect().height
  const msDOM = performance.now() - t0d

  const predictedHeight = predicted.height + PADDING * 2
  const report = buildReport(width, predictedHeight, actualHeight, diagnosticHeight)
  if (options.updateStats !== false) {
    const diff = report.diffPx ?? 0
    const diffStr = diff === 0 ? 'exact' : `${diff > 0 ? '+' : ''}${Math.round(diff)}px`

    if (reportMode && report.status === 'ready') {
      const linesText = report.predictedLineCount !== undefined && report.browserLineCount !== undefined
        ? ` | Lines: ${report.predictedLineCount}/${report.browserLineCount}`
        : ''
      const breakText = report.firstBreakMismatch !== null && report.firstBreakMismatch !== undefined
        ? ` | Break L${report.firstBreakMismatch.line}: ${report.firstBreakMismatch.reasonGuess}`
        : ''
      stats.textContent = `Pretext: ${msPretext.toFixed(2)}ms (${Math.round(predictedHeight)}px) | DOM: ${msDOM.toFixed(1)}ms (${Math.round(actualHeight)}px) | Diff: ${diffStr}${linesText}${breakText}`
    } else {
      stats.textContent = `Pretext: ${msPretext.toFixed(2)}ms (${Math.round(predictedHeight)}px) | DOM: ${msDOM.toFixed(1)}ms (${Math.round(actualHeight)}px) | Diff: ${diffStr} | ${text.length.toLocaleString()} chars`
    }
  }

  if (options.publish !== false) {
    setReport(report)
  }
  return report
}

function toSweepRow(report: GatsbyReport): GatsbySweepRow {
  if (
    report.width === undefined ||
    report.predictedHeight === undefined ||
    report.actualHeight === undefined ||
    report.diffPx === undefined
  ) {
    throw new Error('Gatsby report was missing sweep row fields')
  }

  return {
    width: report.width,
    predictedHeight: report.predictedHeight,
    actualHeight: report.actualHeight,
    diffPx: report.diffPx,
    predictedLineCount: report.predictedLineCount ?? null,
    browserLineCount: report.browserLineCount ?? null,
    mismatchCount: report.mismatchCount ?? null,
    ...(report.firstMismatch === undefined ? {} : { firstMismatch: report.firstMismatch }),
    ...(report.firstBreakMismatch === undefined
      ? {}
      : report.firstBreakMismatch === null
        ? { firstBreakMismatch: null }
        : {
            firstBreakMismatch: {
              line: report.firstBreakMismatch.line,
              deltaText: report.firstBreakMismatch.deltaText,
              oursContext: report.firstBreakMismatch.oursContext,
              browserContext: report.firstBreakMismatch.browserContext,
              reasonGuess: report.firstBreakMismatch.reasonGuess,
            },
          }),
  }
}

function runSweep(widths: number[]): void {
  const rows = widths.map(width => toSweepRow(measureWidth(width, { publish: false, updateStats: false })))
  const exactCount = rows.filter(row => Math.round(row.diffPx) === 0).length

  stats.textContent =
    `Gatsby | Sweep: ${exactCount}/${rows.length} exact | ${rows.length - exactCount} nonzero` +
    ` | ${text.length.toLocaleString()} chars`

  setReport(withRequestId({
    status: 'ready',
    widths,
    widthCount: rows.length,
    exactCount,
    rows,
  }))
}

function setWidth(width: number) {
  measureWidth(width)
}

slider.addEventListener('input', () => {
  setWidth(Number.parseInt(slider.value, 10))
})

const controlsEl = document.querySelector<HTMLDivElement>('.controls')!
controlsEl.addEventListener('mousemove', (e) => {
  const sliderRect = slider.getBoundingClientRect()
  const ratio = (e.clientX - sliderRect.left) / sliderRect.width
  const min = Number.parseInt(slider.min, 10)
  const max = Number.parseInt(slider.max, 10)
  const width = Math.round(min + (max - min) * Math.max(0, Math.min(1, ratio)))
  setWidth(width)
})

window.__GATSBY_REPORT__ = withRequestId({ status: 'error', message: 'Pending initial layout' })
stats.textContent = 'Loading...'
clearNavigationReport()
publishNavigationPhase('loading', requestId)

const initialWidth = parseInitialWidth()

async function init() {
  try {
    if ('fonts' in document) {
      await document.fonts.ready
    }
    publishNavigationPhase('measuring', requestId)
    diagnosticCtx.font = FONT
    if (requestedWidths !== null) {
      runSweep(requestedWidths)
      return
    }
    setWidth(initialWidth)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stats.textContent = `Error: ${message}`
    const report = withRequestId({ status: 'error', message } satisfies GatsbyReport)
    setReport(report)
  }
}

void init()
