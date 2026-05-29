import {
  layout,
  layoutWithLines,
  prepareWithSegments,
  type PreparedTextWithSegments,
} from '../src/layout.ts'
import {
  KEEP_ALL_ORACLE_CASES,
  LETTER_SPACING_ORACLE_CASES,
  PRE_WRAP_ORACLE_CASES,
  SYMBOL_ORACLE_CASES,
  type ProbeOracleCase,
} from '../src/test-data.ts'
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

type ProbeBreakTraceEntry = {
  label: string
  start: number
  end: number
  text: string
  kind: string
  unitWidth: number
  lineFitWidth: number
  marker: 'ours' | 'browser' | 'ours+browser' | null
}

type ProbeBreakTrace = {
  line: number
  lineStart: number
  contentWidth: number
  entries: ProbeBreakTraceEntry[]
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
  letterSpacing?: number
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
  breakTrace?: ProbeBreakTrace | null
  ourLines?: ProbeLineSummary[]
  browserLines?: ProbeLineSummary[]
  alternateBrowserLines?: ProbeLineSummary[]
  message?: string
}

type ProbeBatchReport = {
  status: 'ready' | 'error'
  requestId?: string
  results?: Array<{
    label: string
    report: ProbeReport
  }>
  message?: string
}

type ProbeConfig = {
  text: string
  width: number
  font: string
  letterSpacing: number
  lineHeight: number
  direction: 'ltr' | 'rtl'
  lang: string
  browserLineMethod: 'range' | 'span'
  verbose: boolean
  whiteSpace: 'normal' | 'pre-wrap'
  wordBreak: 'normal' | 'keep-all'
}

type ProbeBatchSpec = {
  title: string
  cases: readonly ProbeOracleCase[]
  defaults: {
    letterSpacing?: number
    whiteSpace?: 'normal' | 'pre-wrap'
    wordBreak?: 'normal' | 'keep-all'
    method?: 'range' | 'span'
  }
}

type OracleBrowser = NonNullable<ProbeOracleCase['browsers']>[number]

declare global {
  interface Window {
    __PROBE_REPORT__?: ProbeReport | ProbeBatchReport
  }
}

const PADDING = 40
const params = new URLSearchParams(location.search)
const requestId = params.get('requestId') ?? undefined
const batch = params.get('batch')
const reportEndpoint = params.get('reportEndpoint')

let text = params.get('text') ?? ''
let width = Math.max(100, Number.parseInt(params.get('width') ?? '600', 10))
let font = params.get('font') ?? '18px serif'
let letterSpacing = Number.parseFloat(params.get('letterSpacing') ?? '0')
let lineHeight = Math.max(1, Number.parseInt(params.get('lineHeight') ?? '32', 10))
let direction: 'ltr' | 'rtl' = params.get('dir') === 'rtl' ? 'rtl' : 'ltr'
let lang = params.get('lang') ?? (direction === 'rtl' ? 'ar' : 'en')
let browserLineMethod: 'range' | 'span' = params.get('method') === 'span' ? 'span' : 'range'
let verbose = params.get('verbose') === '1'
let whiteSpace: 'normal' | 'pre-wrap' = params.get('whiteSpace') === 'pre-wrap' ? 'pre-wrap' : 'normal'
let wordBreak: 'normal' | 'keep-all' = params.get('wordBreak') === 'keep-all' ? 'keep-all' : 'normal'
let cssWhiteSpace = whiteSpace === 'pre-wrap' ? 'pre-wrap' : 'normal'
let cssWordBreak = wordBreak === 'keep-all' ? 'keep-all' : 'normal'

const stats = document.getElementById('stats')!
const details = document.getElementById('details') as HTMLPreElement | null
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

function getProbeBatchSpec(name: string | null): ProbeBatchSpec | null {
  switch (name) {
    case null:
      return null
    case 'letter-spacing':
      return {
        title: 'Letter-spacing',
        cases: LETTER_SPACING_ORACLE_CASES,
        defaults: {},
      }
    case 'pre-wrap':
      return {
        title: 'Pre-wrap',
        cases: PRE_WRAP_ORACLE_CASES,
        defaults: { whiteSpace: 'pre-wrap', method: 'span' },
      }
    case 'symbol-runs':
      return {
        title: 'Symbol runs',
        cases: SYMBOL_ORACLE_CASES,
        defaults: {},
      }
    case 'keep-all':
      return {
        title: 'Keep-all',
        cases: KEEP_ALL_ORACLE_CASES,
        defaults: { wordBreak: 'keep-all', method: 'span' },
      }
    default:
      throw new Error(`Unknown probe batch ${name}`)
  }
}

function materializeCase(testCase: ProbeOracleCase, defaults: ProbeBatchSpec['defaults']): ProbeConfig {
  const dir = testCase.dir ?? 'ltr'
  return {
    text: testCase.text,
    width: testCase.width,
    font: testCase.font,
    letterSpacing: testCase.letterSpacing ?? defaults.letterSpacing ?? 0,
    lineHeight: testCase.lineHeight,
    direction: dir,
    lang: testCase.lang ?? (dir === 'rtl' ? 'ar' : 'en'),
    browserLineMethod: testCase.method ?? defaults.method ?? 'range',
    verbose: false,
    whiteSpace: testCase.whiteSpace ?? defaults.whiteSpace ?? 'normal',
    wordBreak: testCase.wordBreak ?? defaults.wordBreak ?? 'normal',
  }
}

function getCurrentOracleBrowser(): OracleBrowser | null {
  const ua = navigator.userAgent
  const vendor = navigator.vendor

  if (ua.includes('Firefox/') || ua.includes('FxiOS/')) return 'firefox'
  if (
    vendor === 'Apple Computer, Inc.' &&
    ua.includes('Safari/') &&
    !ua.includes('Chrome/') &&
    !ua.includes('Chromium/') &&
    !ua.includes('CriOS/') &&
    !ua.includes('FxiOS/') &&
    !ua.includes('EdgiOS/')
  ) {
    return 'safari'
  }
  if (
    ua.includes('Chrome/') ||
    ua.includes('Chromium/') ||
    ua.includes('CriOS/') ||
    ua.includes('Edg/')
  ) {
    return 'chrome'
  }
  return null
}

function caseRunsInCurrentBrowser(testCase: ProbeOracleCase, browser: OracleBrowser | null): boolean {
  return testCase.browsers === undefined || browser === null || testCase.browsers.includes(browser)
}

function applyConfig(config: ProbeConfig): void {
  text = config.text
  width = config.width
  font = config.font
  letterSpacing = config.letterSpacing
  lineHeight = config.lineHeight
  direction = config.direction
  lang = config.lang
  browserLineMethod = config.browserLineMethod
  verbose = config.verbose
  whiteSpace = config.whiteSpace
  wordBreak = config.wordBreak
  cssWhiteSpace = whiteSpace === 'pre-wrap' ? 'pre-wrap' : 'normal'
  cssWordBreak = wordBreak === 'keep-all' ? 'keep-all' : 'normal'
}

function withRequestId<T extends ProbeReport>(report: T): ProbeReport {
  return requestId === undefined ? report : { ...report, requestId }
}

function withBatchRequestId<T extends ProbeBatchReport>(report: T): ProbeBatchReport {
  return requestId === undefined ? report : { ...report, requestId }
}

function publishCompactReport(report: ProbeReport | ProbeBatchReport): void {
  publishNavigationReport({
    status: report.status,
    ...(report.requestId === undefined ? {} : { requestId: report.requestId }),
    ...('message' in report && report.message !== undefined ? { message: report.message } : {}),
  })
}

function publishReport(report: ProbeReport | ProbeBatchReport): void {
  window.__PROBE_REPORT__ = report
  if (reportEndpoint !== null) {
    publishNavigationPhase('posting', requestId)
    void (async () => {
      try {
        await fetch(reportEndpoint, {
          method: 'POST',
          body: JSON.stringify(report),
        })
        publishCompactReport(report)
      } catch {
        // The runner is waiting on the side channel; leaving the phase at
        // posting makes the transport failure obvious.
      }
    })()
    return
  }
  publishNavigationReport(report)
}

function setError(message: string): void {
  stats.textContent = `Error: ${message}`
  if (details !== null) details.textContent = `Error: ${message}`
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

function buildSegmentRanges(prepared: PreparedTextWithSegments): { start: number, end: number }[] {
  const ranges: { start: number, end: number }[] = []
  let start = 0

  for (const segment of prepared.segments) {
    const end = start + segment.length
    ranges.push({ start, end })
    start = end
  }

  return ranges
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

function getBreakTrace(
  prepared: PreparedTextWithSegments,
  measuredFont: string,
  contentWidth: number,
  ourLine: ProbeLine | undefined,
  browserLine: ProbeLine | undefined,
  mismatch: ProbeBreakMismatch | null,
): ProbeBreakTrace | null {
  if (mismatch === null) return null

  const units = getDiagnosticUnits(prepared)
  if (units.length === 0) return null

  const lineStart = Math.min(ourLine?.start ?? browserLine?.start ?? 0, browserLine?.start ?? ourLine?.start ?? 0)
  const oursEnd = ourLine?.contentEnd ?? mismatch.oursEnd
  const browserEnd = browserLine?.contentEnd ?? mismatch.browserEnd
  const segmentRanges = buildSegmentRanges(prepared)

  const firstLineUnitIndex = units.findIndex(unit => unit.end > lineStart)
  if (firstLineUnitIndex < 0) return null

  const oursBoundaryIndex = units.findIndex(unit => unit.end >= oursEnd)
  const browserBoundaryIndex = units.findIndex(unit => unit.end >= browserEnd)
  const boundaryStart = Math.max(firstLineUnitIndex, Math.min(
    oursBoundaryIndex < 0 ? units.length - 1 : oursBoundaryIndex,
    browserBoundaryIndex < 0 ? units.length - 1 : browserBoundaryIndex,
  ) - 4)
  const boundaryEnd = Math.min(
    units.length,
    Math.max(
      oursBoundaryIndex < 0 ? units.length - 1 : oursBoundaryIndex,
      browserBoundaryIndex < 0 ? units.length - 1 : browserBoundaryIndex,
    ) + 5,
  )

  const entries: ProbeBreakTraceEntry[] = []
  let segmentIndex = 0
  const graphemeOrdinalBySegment = new Map<number, number>()

  for (let i = boundaryStart; i < boundaryEnd; i++) {
    const unit = units[i]!
    while (segmentIndex < segmentRanges.length && unit.start >= segmentRanges[segmentIndex]!.end) {
      segmentIndex++
    }
    if (segmentIndex >= segmentRanges.length) break

    const range = segmentRanges[segmentIndex]!
    const wholeSegment = unit.start === range.start && unit.end === range.end
    const unitWidth = measurePreparedSlice(prepared, unit.start, unit.end, measuredFont)
    const lineSliceWidth = measurePreparedSlice(prepared, lineStart, unit.end, measuredFont)
    const lineFitWidth = wholeSegment
      ? lineSliceWidth - prepared.widths[segmentIndex]! + prepared.lineEndFitAdvances[segmentIndex]!
      : lineSliceWidth
    const graphemeOrdinal = (graphemeOrdinalBySegment.get(segmentIndex) ?? 0) + 1
    graphemeOrdinalBySegment.set(segmentIndex, graphemeOrdinal)

    entries.push({
      label: wholeSegment ? `s${segmentIndex}` : `s${segmentIndex}:g${graphemeOrdinal}`,
      start: unit.start,
      end: unit.end,
      text: unit.text,
      kind: prepared.kinds[segmentIndex]!,
      unitWidth,
      lineFitWidth,
      marker:
        unit.end === oursEnd && unit.end === browserEnd
          ? 'ours+browser'
          : unit.end === oursEnd
            ? 'ours'
            : unit.end === browserEnd
              ? 'browser'
              : null,
    })
  }

  return {
    line: mismatch.line,
    lineStart,
    contentWidth,
    entries,
  }
}

function formatBreakTrace(trace: ProbeBreakTrace | null | undefined): string[] {
  if (trace === null || trace === undefined || trace.entries.length === 0) return []

  return [
    `Trace L${trace.line} from offset ${trace.lineStart} (content width ${trace.contentWidth}px):`,
    ...trace.entries.map(entry =>
      `  ${entry.label.padEnd(7)} ${String(entry.start).padStart(4)}-${String(entry.end).padEnd(4)} ` +
      `${JSON.stringify(entry.text).padEnd(12)} kind=${entry.kind.padEnd(15)} ` +
      `unit=${entry.unitWidth.toFixed(3).padStart(7)} fit=${entry.lineFitWidth.toFixed(3).padStart(8)}` +
      (entry.marker === null ? '' : ` [${entry.marker}]`),
    ),
  ]
}

function formatReportDetails(report: ProbeReport): string {
  if (report.status === 'error') return `Error: ${report.message ?? 'unknown error'}`

  const lines = [
    `Width ${report.width}px | method ${report.browserLineMethod ?? '-'} | Pretext ${report.predictedLineCount} lines | DOM ${report.browserLineCount} lines | diff ${report.diffPx}px`,
  ]

  if (report.extractorSensitivity !== null && report.extractorSensitivity !== undefined) {
    lines.push(`Extractor sensitivity: ${report.extractorSensitivity}`)
  }

  if (report.firstBreakMismatch === null || report.firstBreakMismatch === undefined) {
    lines.push('No first-break mismatch.')
    return lines.join('\n')
  }

  const mismatch = report.firstBreakMismatch
  lines.push(`Break mismatch L${mismatch.line}: ${mismatch.reasonGuess}`)
  lines.push(`Offsets: ours ${mismatch.oursStart}-${mismatch.oursEnd} | browser ${mismatch.browserStart}-${mismatch.browserEnd}`)
  lines.push(`Delta: ${JSON.stringify(mismatch.deltaText)}`)
  lines.push(`Ours text:    ${JSON.stringify(mismatch.oursText)}`)
  lines.push(`Browser text: ${JSON.stringify(mismatch.browserText)}`)
  lines.push(`Ours ctx:     ${mismatch.oursContext}`)
  lines.push(`Browser ctx:  ${mismatch.browserContext}`)
  lines.push(
    `Widths: ours sum/dom/full ${mismatch.oursSumWidth.toFixed(3)}/${mismatch.oursDomWidth.toFixed(3)}/${mismatch.oursFullWidth.toFixed(3)} | ` +
    `browser dom/full ${mismatch.browserDomWidth.toFixed(3)}/${mismatch.browserFullWidth.toFixed(3)}`,
  )
  lines.push(...formatBreakTrace(report.breakTrace))

  return lines.join('\n')
}

function buildProbeReport(): ProbeReport {
  document.title = 'Pretext — Text Probe'
  document.documentElement.lang = lang
  document.documentElement.dir = direction

  book.textContent = text
  book.lang = lang
  book.dir = direction
  book.style.font = font
  book.style.letterSpacing = `${letterSpacing}px`
  book.style.lineHeight = `${lineHeight}px`
  book.style.padding = `${PADDING}px`
  book.style.width = `${width}px`
  book.style.whiteSpace = cssWhiteSpace
  book.style.wordBreak = cssWordBreak

  diagnosticDiv.textContent = text
  diagnosticDiv.lang = lang
  diagnosticDiv.dir = direction
  diagnosticDiv.style.font = font
  diagnosticDiv.style.letterSpacing = `${letterSpacing}px`
  diagnosticDiv.style.lineHeight = `${lineHeight}px`
  diagnosticDiv.style.padding = `${PADDING}px`
  diagnosticDiv.style.width = `${width}px`
  diagnosticDiv.style.whiteSpace = cssWhiteSpace
  diagnosticDiv.style.wordBreak = cssWordBreak

  const prepared = prepareWithSegments(text, font, { whiteSpace, wordBreak, letterSpacing })
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
  const breakTrace = firstBreakMismatch === null
    ? null
    : getBreakTrace(
        prepared,
        font,
        contentWidth,
        ourLines[firstBreakMismatch.line - 1],
        browserLines[firstBreakMismatch.line - 1],
        firstBreakMismatch,
      )
  const extractorSensitivity =
    firstBreakMismatch !== null && alternateFirstBreakMismatch === null
      ? `${browserLineMethod} mismatch disappears with ${alternateBrowserLineMethod}`
      : null

  return withRequestId({
    status: 'ready',
    text,
    whiteSpace,
    wordBreak,
    width,
    contentWidth,
    font,
    letterSpacing,
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
    breakTrace,
    ...(verbose ? {
      ourLines: summarizeLines(ourLines),
      browserLines: summarizeLines(browserLines),
      alternateBrowserLines: summarizeLines(alternateBrowserLines),
    } : {}),
  })
}

function renderProbeReport(report: ProbeReport): void {
  stats.textContent =
    `Width ${width}px | Pretext ${report.predictedLineCount} lines | DOM ${report.browserLineCount} lines | Diff ${report.diffPx}px`
  if (details !== null) details.textContent = formatReportDetails(report)
}

function init(): void {
  try {
    publishNavigationPhase('measuring', requestId)
    const report = buildProbeReport()
    renderProbeReport(report)
    publishReport(report)
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error))
  }
}

function runProbeBatch(batchSpec: ProbeBatchSpec): void {
  try {
    publishNavigationPhase('measuring', requestId)
    const results: NonNullable<ProbeBatchReport['results']> = []
    const currentBrowser = getCurrentOracleBrowser()

    for (const testCase of batchSpec.cases) {
      if (!caseRunsInCurrentBrowser(testCase, currentBrowser)) continue
      applyConfig(materializeCase(testCase, batchSpec.defaults))
      try {
        results.push({ label: testCase.label, report: buildProbeReport() })
      } catch (error) {
        results.push({
          label: testCase.label,
          report: withRequestId({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          }),
        })
      }
    }

    stats.textContent = `${batchSpec.title} batch: ${results.length} cases`
    if (details !== null) {
      details.textContent = results
        .map(result => `${result.label}: ${result.report.status}`)
        .join('\n')
    }
    publishReport(withBatchRequestId({ status: 'ready', results }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stats.textContent = `Error: ${message}`
    if (details !== null) details.textContent = `Error: ${message}`
    publishReport(withBatchRequestId({ status: 'error', message }))
  }
}

window.__PROBE_REPORT__ = withRequestId({ status: 'error', message: 'Pending initial layout' })
clearNavigationReport()
publishNavigationPhase('loading', requestId)
let batchSpec: ProbeBatchSpec | null = null
let batchError: string | null = null
try {
  batchSpec = getProbeBatchSpec(batch)
} catch (error) {
  batchError = error instanceof Error ? error.message : String(error)
}

function runReadyProbe(): void {
  if (batchError !== null) {
    setError(batchError)
    return
  }
  if (batchSpec === null) {
    init()
  } else {
    runProbeBatch(batchSpec)
  }
}
if ('fonts' in document) {
  void document.fonts.ready.then(runReadyProbe)
} else {
  runReadyProbe()
}
