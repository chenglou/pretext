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
import sourcesData from '../corpora/sources.json' with { type: 'json' }
import arAlBukhala from '../corpora/ar-al-bukhala.txt' with { type: 'text' }
import arRisalatAlGhufranPart1 from '../corpora/ar-risalat-al-ghufran-part-1.txt' with { type: 'text' }
import enGatsbyOpening from '../corpora/en-gatsby-opening.txt' with { type: 'text' }
import heMasaotBinyaminMetudela from '../corpora/he-masaot-binyamin-metudela.txt' with { type: 'text' }
import hiEidgah from '../corpora/hi-eidgah.txt' with { type: 'text' }
import jaKumoNoIto from '../corpora/ja-kumo-no-ito.txt' with { type: 'text' }
import jaRashomon from '../corpora/ja-rashomon.txt' with { type: 'text' }
import kmPrachumReuangPrengKhmerVolume7Stories1To10 from '../corpora/km-prachum-reuang-preng-khmer-volume-7-stories-1-10.txt' with { type: 'text' }
import myBadDeedsReturnToYouTeacher from '../corpora/my-bad-deeds-return-to-you-teacher.txt' with { type: 'text' }
import myCunningHeronTeacher from '../corpora/my-cunning-heron-teacher.txt' with { type: 'text' }
import koUnsuJohEunNal from '../corpora/ko-unsu-joh-eun-nal.txt' with { type: 'text' }
import mixedAppText from '../corpora/mixed-app-text.txt' with { type: 'text' }
import thNithanVetalStory1 from '../corpora/th-nithan-vetal-story-1.txt' with { type: 'text' }
import thNithanVetalStory7 from '../corpora/th-nithan-vetal-story-7.txt' with { type: 'text' }
import urChughd from '../corpora/ur-chughd.txt' with { type: 'text' }
import zhGuxiang from '../corpora/zh-guxiang.txt' with { type: 'text' }
import zhZhufu from '../corpora/zh-zhufu.txt' with { type: 'text' }

type CorpusMeta = {
  id: string
  language: string
  direction?: 'ltr' | 'rtl'
  title: string
  output: string
  font_family?: string
  font_size_px?: number
  line_height_px?: number
  default_width?: number
  min_width?: number
  max_width?: number
}

type CorpusReport = {
  status: 'ready' | 'error'
  requestId?: string
  environment?: EnvironmentFingerprint
  corpusId?: string
  sliceStart?: number | null
  sliceEnd?: number | null
  title?: string
  language?: string
  direction?: string
  width?: number
  contentWidth?: number
  font?: string
  lineHeight?: number
  predictedHeight?: number
  actualHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  browserLineMethod?: 'span-probe' | 'range'
  alternateBrowserLineMethod?: 'span-probe' | 'range'
  alternateBrowserLineCount?: number
  probeHeight?: number
  normalizedHeight?: number
  mismatchCount?: number
  firstMismatch?: CorpusLineMismatch | null
  firstBreakMismatch?: CorpusBreakMismatch | null
  alternateFirstBreakMismatch?: CorpusBreakMismatch | null
  extractorSensitivity?: string | null
  maxLineWidthDrift?: number
  maxDriftLine?: {
    line: number
    drift: number
    text: string
    sumWidth: number
    fullWidth: number
    domWidth: number
    pairAdjustedWidth: number
    segments: Array<{
      text: string
      width: number
      domWidth: number
      isSpace: boolean
    }>
  } | null
  widths?: number[]
  widthCount?: number
  exactCount?: number
  rows?: CorpusSweepRow[]
  message?: string
}

type CorpusSweepRow = {
  width: number
  contentWidth: number
  predictedHeight: number
  actualHeight: number
  diffPx: number
  predictedLineCount: number
  browserLineCount: number
  browserLineMethod?: 'span-probe' | 'range'
  maxLineWidthDrift?: number
  firstBreakMismatch?: {
    line: number
    deltaText: string
    reasonGuess: string
    oursContext: string
    browserContext: string
  } | null
}

type CorpusLineMismatch = {
  line: number
  ours: string
  browser: string
}

type CorpusBreakMismatch = {
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
  oursSegments: Array<{
    text: string
    width: number
    domWidth: number
    isSpace: boolean
  }>
}

type DiagnosticLine = {
  text: string
  renderedText: string
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

const rangeProbeScriptRe = /[\u0E00-\u0E7F\u0E80-\u0EFF\u1000-\u109F\u1780-\u17FF]/u

type EnvironmentFingerprint = {
  userAgent: string
  devicePixelRatio: number
  viewport: {
    innerWidth: number
    innerHeight: number
    outerWidth: number
    outerHeight: number
    visualViewportScale: number | null
  }
  screen: {
    width: number
    height: number
    availWidth: number
    availHeight: number
    colorDepth: number
    pixelDepth: number
  }
}

declare global {
  interface Window {
    __CORPUS_REPORT__?: CorpusReport
    __CORPUS_DEBUG__?: {
      corpusId: string
      font: string
      lineHeight: number
      padding: number
      direction: string
      width: number
      contentWidth: number
      getNormalizedText: () => string
      layoutWithLines: (width: number) => ReturnType<typeof layoutWithLines>
    }
  }
}

const book = document.getElementById('book')!
const slider = document.getElementById('slider') as HTMLInputElement
const valLabel = document.getElementById('val')!
const stats = document.getElementById('stats')!
const select = document.getElementById('corpus') as HTMLSelectElement

const PADDING = 40

const params = new URLSearchParams(location.search)
const requestId = params.get('requestId') ?? undefined
const requestedCorpusId = params.get('id')
const requestedWidth = Number.parseInt(params.get('width') ?? '', 10)
const diagnosticMode = params.get('diagnostic') ?? 'light'
const requestedDiagnosticMethod = params.get('method')
const requestedFont = params.get('font')
const requestedLineHeight = Number.parseInt(params.get('lineHeight') ?? '', 10)
const requestedSliceStart = Number.parseInt(params.get('sliceStart') ?? '', 10)
const requestedSliceEnd = Number.parseInt(params.get('sliceEnd') ?? '', 10)
const reportEndpoint = params.get('reportEndpoint')
const requestedWidths = parseWidthList(params.get('widths'))

const diagnosticCanvas = document.createElement('canvas')
const diagnosticCtx = diagnosticCanvas.getContext('2d')!
const diagnosticDiv = document.createElement('div')
diagnosticDiv.style.position = 'absolute'
diagnosticDiv.style.top = '-99999px'
diagnosticDiv.style.left = '-99999px'
diagnosticDiv.style.visibility = 'hidden'
diagnosticDiv.style.pointerEvents = 'none'
diagnosticDiv.style.boxSizing = 'border-box'
diagnosticDiv.style.whiteSpace = 'normal'
diagnosticDiv.style.wordWrap = 'break-word'
diagnosticDiv.style.overflowWrap = 'break-word'
diagnosticDiv.style.padding = `${PADDING}px`
document.body.appendChild(diagnosticDiv)

const lineProbeDiv = document.createElement('div')
lineProbeDiv.style.position = 'absolute'
lineProbeDiv.style.top = '-99999px'
lineProbeDiv.style.left = '-99999px'
lineProbeDiv.style.visibility = 'hidden'
lineProbeDiv.style.pointerEvents = 'none'
lineProbeDiv.style.boxSizing = 'border-box'
lineProbeDiv.style.whiteSpace = 'normal'
lineProbeDiv.style.wordWrap = 'break-word'
lineProbeDiv.style.overflowWrap = 'break-word'
lineProbeDiv.style.padding = `${PADDING}px`
document.body.appendChild(lineProbeDiv)

const diagnosticGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

let corpusList: CorpusMeta[] = []
let currentMeta: CorpusMeta | null = null
let currentText = ''
let currentPrepared: PreparedTextWithSegments | null = null
let currentSliceStart: number | null = null
let currentSliceEnd: number | null = null

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

function withRequestId<T extends CorpusReport>(report: T): CorpusReport {
  return requestId === undefined ? report : { ...report, requestId }
}

function toNavigationReport(report: CorpusReport): CorpusReport {
  if (report.rows === undefined) return report
  const { rows: _rows, ...navigationReport } = report
  return navigationReport
}

function getEnvironmentFingerprint(): EnvironmentFingerprint {
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      visualViewportScale: window.visualViewport?.scale ?? null,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      colorDepth: window.screen.colorDepth,
      pixelDepth: window.screen.pixelDepth,
    },
  }
}

function buildFont(meta: CorpusMeta): string {
  if (requestedFont !== null && requestedFont.length > 0) {
    return requestedFont
  }
  const size = meta.font_size_px ?? 18
  const family = meta.font_family ?? 'serif'
  return `${size}px ${family}`
}

function getLineHeight(meta: CorpusMeta): number {
  if (Number.isFinite(requestedLineHeight) && requestedLineHeight > 0) {
    return requestedLineHeight
  }
  return meta.line_height_px ?? Math.round((meta.font_size_px ?? 18) * 1.6)
}

function getDirection(meta: CorpusMeta): 'ltr' | 'rtl' {
  return meta.direction === 'rtl' ? 'rtl' : 'ltr'
}

function estimateBrowserLineCount(actualHeight: number, lineHeight: number): number {
  const contentHeight = Math.max(0, actualHeight - PADDING * 2)
  return Math.max(0, Math.round(contentHeight / lineHeight))
}

function pushDiagnosticLine(
  lines: DiagnosticLine[],
  text: string,
  start: number | null,
  end: number,
  normalizedText: string,
  font: string,
  direction: string,
): void {
  if (text.length === 0 || start === null) return
  const content = getLineContent(text, end)
  lines.push({
    text,
    renderedText: text,
    contentText: content.text,
    start,
    end,
    contentEnd: content.end,
    fullWidth: measureCanvasTextWidth(diagnosticCtx, content.text, font),
    rawFullWidth: measureCanvasTextWidth(diagnosticCtx, normalizedText.slice(start, end), font),
    domWidth: measureDomTextWidth(document, content.text, font, direction),
    rawDomWidth: measureDomTextWidth(document, normalizedText.slice(start, end), font, direction),
  })
}

function getBrowserLinesFromSpans(
  prepared: PreparedTextWithSegments,
  div: HTMLDivElement,
  normalizedText: string,
  font: string,
): { lines: DiagnosticLine[], height: number } {
  const units = getDiagnosticUnits(prepared)
  const browserLines: DiagnosticLine[] = []
  const spans: HTMLSpanElement[] = []
  let currentLine = ''
  let currentStart: number | null = null
  let currentEnd = 0
  let lastTop: number | null = null

  div.textContent = ''
  for (const unit of units) {
    const span = document.createElement('span')
    span.textContent = unit.text
    div.appendChild(span)
    spans.push(span)
  }

  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!
    const span = spans[i]!
    const rect = span.getBoundingClientRect()
    const rectTop: number | null = rect.width > 0 || rect.height > 0 ? rect.top : lastTop

    if (rectTop !== null && lastTop !== null && rectTop > lastTop + 0.5) {
      pushDiagnosticLine(browserLines, currentLine, currentStart, currentEnd, normalizedText, font, div.dir || 'ltr')
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

  pushDiagnosticLine(browserLines, currentLine, currentStart, currentEnd, normalizedText, font, div.dir || 'ltr')
  const height = div.getBoundingClientRect().height
  div.textContent = ''
  return { lines: browserLines, height }
}

function getBrowserLinesFromRange(
  prepared: PreparedTextWithSegments,
  div: HTMLDivElement,
  normalizedText: string,
  font: string,
): { lines: DiagnosticLine[], height: number } {
  const textNode = div.firstChild
  const browserLines: DiagnosticLine[] = []
  if (!(textNode instanceof Text)) {
    return { lines: browserLines, height: div.getBoundingClientRect().height }
  }

  const units = getDiagnosticUnits(prepared)
  const range = document.createRange()
  let currentLine = ''
  let currentStart: number | null = null
  let currentEnd = 0
  let lastTop: number | null = null

  for (const unit of units) {
    range.setStart(textNode, unit.start)
    range.setEnd(textNode, unit.end)
    const rects = range.getClientRects()
    const rectTop: number | null = rects.length > 0 ? rects[0]!.top : lastTop

    if (rectTop !== null && lastTop !== null && rectTop > lastTop + 0.5) {
      pushDiagnosticLine(browserLines, currentLine, currentStart, currentEnd, normalizedText, font, div.dir || 'ltr')
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

  pushDiagnosticLine(browserLines, currentLine, currentStart, currentEnd, normalizedText, font, div.dir || 'ltr')
  return { lines: browserLines, height: div.getBoundingClientRect().height }
}

function getCursorOffset(prepared: PreparedTextWithSegments, segmentIndex: number, graphemeIndex: number): number {
  let offset = 0
  for (let i = 0; i < segmentIndex; i++) {
    offset += prepared.segments[i]!.length
  }
  if (graphemeIndex === 0 || segmentIndex >= prepared.segments.length) {
    return offset
  }

  let localOffset = 0
  let localGraphemeIndex = 0
  for (const grapheme of diagnosticGraphemeSegmenter.segment(prepared.segments[segmentIndex]!)) {
    if (localGraphemeIndex === graphemeIndex) break
    localOffset += grapheme.segment.length
    localGraphemeIndex++
  }
  return offset + localOffset
}

function getOurLines(
  prepared: PreparedTextWithSegments,
  normalizedText: string,
  maxWidth: number,
  lineHeight: number,
  font: string,
): DiagnosticLine[] {
  return layoutWithLines(prepared, maxWidth, lineHeight).lines.map(line => {
    const start = getCursorOffset(prepared, line.start.segmentIndex, line.start.graphemeIndex)
    const end = getCursorOffset(prepared, line.end.segmentIndex, line.end.graphemeIndex)
    const logicalText = normalizedText.slice(start, end)
    const content = getLineContent(logicalText, end)
    const renderedContentText = line.text.trimEnd()
    return {
      text: logicalText,
      renderedText: line.text,
      contentText: content.text,
      start,
      end,
      contentEnd: content.end,
      sumWidth: line.width,
      fullWidth: measureCanvasTextWidth(diagnosticCtx, renderedContentText, font),
      rawFullWidth: measureCanvasTextWidth(diagnosticCtx, line.text, font),
    }
  })
}

function getLineSegments(
  prepared: PreparedTextWithSegments,
  start: number,
  end: number,
  font: string,
  direction: string,
): Array<{ text: string, width: number, domWidth: number, isSpace: boolean }> {
  const segments: Array<{ text: string, width: number, domWidth: number, isSpace: boolean }> = []
  let offset = 0
  for (let i = 0; i < prepared.segments.length; i++) {
    const text = prepared.segments[i]!
    const nextOffset = offset + text.length
    if (nextOffset > start && offset < end) {
      segments.push({
        text,
        width: prepared.widths[i]!,
        domWidth: measureDomTextWidth(document, text, font, direction),
        isSpace: prepared.kinds[i] === 'space',
      })
    }
    if (offset >= end) break
    offset = nextOffset
  }
  return segments
}

function measurePairAdjustedWidth(
  segments: Array<{ text: string, width: number, domWidth: number, isSpace: boolean }>,
  font: string,
  direction: string,
): number {
  let total = 0
  for (const segment of segments) {
    total += segment.domWidth
  }
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]!
    const next = segments[i]!
    total += measureDomTextWidth(document, prev.text + next.text, font, direction) - prev.domWidth - next.domWidth
  }
  return total
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

  return 'different break opportunity around punctuation or shaping context'
}

function getFirstBreakMismatch(
  prepared: PreparedTextWithSegments,
  normalizedText: string,
  contentWidth: number,
  ourLines: DiagnosticLine[],
  browserLines: DiagnosticLine[],
  font: string,
  direction: string,
): CorpusBreakMismatch | null {
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
        oursContext: formatBreakContext(normalizedText, oursEnd),
        browserContext: formatBreakContext(normalizedText, browserEnd),
        deltaText: normalizedText.slice(minEnd, maxEnd),
        reasonGuess: classifyBreakMismatch(contentWidth, ours, browser),
        oursSumWidth: ours?.sumWidth ?? 0,
        oursDomWidth: ours ? measureDomTextWidth(document, ours.contentText, font, direction) : 0,
        oursFullWidth: ours?.fullWidth ?? 0,
        browserDomWidth: browser?.domWidth ?? 0,
        browserFullWidth: browser?.fullWidth ?? 0,
        oursSegments: ours ? getLineSegments(prepared, ours.start, ours.end, font, direction) : [],
      }
    }
  }
  return null
}

function setReport(report: CorpusReport): void {
  window.__CORPUS_REPORT__ = report
  if (reportEndpoint !== null) {
    publishNavigationPhase('posting', requestId)
    void (async () => {
      try {
        await fetch(reportEndpoint, {
          method: 'POST',
          body: JSON.stringify(report),
        })
        publishNavigationReport(toNavigationReport(report))
      } catch {
        // Best-effort side channel for larger sweep reports.
      }
    })()
    return
  }
  publishNavigationReport(toNavigationReport(report))
}

function setError(message: string): void {
  stats.textContent = `Error: ${message}`
  setReport(withRequestId({ status: 'error', message }))
}

function updateTitle(meta: CorpusMeta): void {
  document.title = `Pretext — ${meta.title}`
  document.documentElement.lang = meta.language
  document.documentElement.dir = getDirection(meta)
}

function getRequestedSlice(normalizedLength: number): { start: number | null, end: number | null } {
  const hasSliceStart = Number.isFinite(requestedSliceStart)
  const hasSliceEnd = Number.isFinite(requestedSliceEnd)
  if (!hasSliceStart && !hasSliceEnd) {
    return { start: null, end: null }
  }

  const rawStart = hasSliceStart ? requestedSliceStart : 0
  const rawEnd = hasSliceEnd ? requestedSliceEnd : normalizedLength
  const start = Math.max(0, Math.min(normalizedLength, rawStart))
  const end = Math.max(start, Math.min(normalizedLength, rawEnd))
  return { start, end }
}

function configureControls(meta: CorpusMeta): void {
  slider.min = String(meta.min_width ?? 300)
  slider.max = String(meta.max_width ?? 900)
}

function getInitialWidth(meta: CorpusMeta): number {
  const min = meta.min_width ?? 300
  const max = meta.max_width ?? 900
  const fallback = meta.default_width ?? 600
  const width = Number.isFinite(requestedWidth) ? requestedWidth : fallback
  return Math.max(min, Math.min(max, width))
}

function getRequestedSweepWidths(meta: CorpusMeta): number[] | null {
  if (requestedWidths === null) return null

  const min = meta.min_width ?? 300
  const max = meta.max_width ?? 900
  return requestedWidths.map(width => Math.max(min, Math.min(max, width)))
}

function buildReadyReport(
  meta: CorpusMeta,
  width: number,
  font: string,
  lineHeight: number,
  predictedHeight: number,
  actualHeight: number,
  predictedLineCount: number,
): CorpusReport {
  return withRequestId({
    status: 'ready',
    environment: getEnvironmentFingerprint(),
    corpusId: meta.id,
    sliceStart: currentSliceStart,
    sliceEnd: currentSliceEnd,
    title: meta.title,
    language: meta.language,
    direction: getDirection(meta),
    width,
    contentWidth: width - PADDING * 2,
    font,
    lineHeight,
    predictedHeight,
    actualHeight,
    diffPx: predictedHeight - actualHeight,
    predictedLineCount,
    browserLineCount: estimateBrowserLineCount(actualHeight, lineHeight),
  })
}

function addDiagnostics(
  report: CorpusReport,
  prepared: PreparedTextWithSegments,
  font: string,
  lineHeight: number,
  contentWidth: number,
  normalizedText: string,
  direction: string,
): CorpusReport {
  if (diagnosticMode !== 'full' || report.status !== 'ready') {
    return report
  }

  const ourLines = getOurLines(prepared, normalizedText, contentWidth, lineHeight, font)
  const probeResult = getBrowserLinesFromSpans(prepared, lineProbeDiv, normalizedText, font)
  const rangeResult = getBrowserLinesFromRange(prepared, diagnosticDiv, normalizedText, font)
  const probeHeight = probeResult.height
  const normalizedHeight = diagnosticDiv.getBoundingClientRect().height
  const requiresRangeProbe = rangeProbeScriptRe.test(normalizedText)
  const probeReliable =
    !requiresRangeProbe &&
    direction !== 'rtl' &&
    Math.abs(probeHeight - normalizedHeight) <= Math.max(1, lineHeight / 2)
  const forcedMethod = requestedDiagnosticMethod === 'span' || requestedDiagnosticMethod === 'range'
    ? requestedDiagnosticMethod
    : null
  const browserResult = forcedMethod === 'span'
    ? probeResult
    : forcedMethod === 'range'
      ? rangeResult
      : probeReliable
        ? probeResult
        : rangeResult
  const browserLines = browserResult.lines
  const browserLineMethod = forcedMethod === 'span'
    ? 'span-probe'
    : forcedMethod === 'range'
      ? 'range'
      : probeReliable
        ? 'span-probe'
        : 'range'
  const alternateBrowserLineMethod = browserLineMethod === 'span-probe' ? 'range' : 'span-probe'
  const alternateBrowserLines = alternateBrowserLineMethod === 'span-probe'
    ? probeResult.lines
    : rangeResult.lines

  let mismatchCount = 0
  let firstMismatch: CorpusLineMismatch | null = null
  let maxLineWidthDrift = 0
  let maxDriftLine: NonNullable<CorpusReport['maxDriftLine']> | null = null
  const maxLines = Math.max(ourLines.length, browserLines.length)

  for (let i = 0; i < maxLines; i++) {
    const ours = ourLines[i]
    const browser = browserLines[i]
    const oursText = ours?.contentText ?? ''
    const browserText = browser?.contentText ?? ''
    if (oursText !== browserText) {
      mismatchCount++
      if (firstMismatch === null) {
        firstMismatch = { line: i + 1, ours: oursText, browser: browserText }
      }
    }
    if (ours !== undefined) {
      const drift = (ours.sumWidth ?? ours.fullWidth) - ours.fullWidth
      if (Math.abs(drift) > Math.abs(maxLineWidthDrift)) {
        maxLineWidthDrift = drift
        const segments = getLineSegments(prepared, ours.start, ours.end, font, direction)
        maxDriftLine = {
          line: i + 1,
          drift,
          text: ours.contentText,
          sumWidth: ours.sumWidth ?? ours.fullWidth,
          fullWidth: ours.fullWidth,
          domWidth: measureDomTextWidth(document, ours.contentText, font, direction),
          pairAdjustedWidth: measurePairAdjustedWidth(segments, font, direction),
          segments,
        }
      }
    }
  }

  const firstBreakMismatch = getFirstBreakMismatch(
    prepared,
    normalizedText,
    contentWidth,
    ourLines,
    browserLines,
    font,
    direction,
  )
  const alternateFirstBreakMismatch = getFirstBreakMismatch(
    prepared,
    normalizedText,
    contentWidth,
    ourLines,
    alternateBrowserLines,
    font,
    direction,
  )
  const extractorSensitivity =
    firstBreakMismatch !== null && alternateFirstBreakMismatch === null
      ? `${browserLineMethod} mismatch disappears with ${alternateBrowserLineMethod}`
      : null

  return {
    ...report,
    predictedLineCount: ourLines.length,
    browserLineCount: browserLines.length,
    browserLineMethod,
    alternateBrowserLineMethod,
    alternateBrowserLineCount: alternateBrowserLines.length,
    probeHeight,
    normalizedHeight,
    mismatchCount,
    firstMismatch,
    firstBreakMismatch,
    alternateFirstBreakMismatch,
    extractorSensitivity,
    maxLineWidthDrift,
    maxDriftLine,
  }
}

function updateStats(report: CorpusReport, msPretext: number, msDOM: number): void {
  if (report.status !== 'ready') return
  const diff = report.diffPx ?? 0
  const diffText = diff === 0 ? 'exact' : `${diff > 0 ? '+' : ''}${Math.round(diff)}px`
  stats.textContent =
    `${report.title} | Pretext: ${msPretext.toFixed(2)}ms (${Math.round(report.predictedHeight ?? 0)}px)` +
    ` | DOM: ${msDOM.toFixed(1)}ms (${Math.round(report.actualHeight ?? 0)}px)` +
    ` | Diff: ${diffText}` +
    ` | Lines: ${report.predictedLineCount ?? 0}/${report.browserLineCount ?? 0}` +
    ` | ${currentText.length.toLocaleString()} chars`
}

function measureWidth(
  width: number,
  options: { publish?: boolean, updateStats?: boolean } = {},
): CorpusReport | null {
  if (currentMeta === null || currentPrepared === null) {
    return null
  }

  const font = buildFont(currentMeta)
  const lineHeight = getLineHeight(currentMeta)
  const direction = getDirection(currentMeta)
  const contentWidth = width - PADDING * 2
  const prepared = currentPrepared
  const normalizedText = prepared.segments.join('')

  slider.value = String(width)
  valLabel.textContent = `${width}px`

  const t0p = performance.now()
  const predicted = layout(prepared, contentWidth, lineHeight)
  const msPretext = performance.now() - t0p

  const t0d = performance.now()
  book.style.width = `${width}px`
  diagnosticDiv.style.width = `${width}px`
  lineProbeDiv.style.width = `${width}px`
  const actualHeight = book.getBoundingClientRect().height
  const msDOM = performance.now() - t0d

  const predictedHeight = predicted.height + PADDING * 2
  let report = buildReadyReport(
    currentMeta,
    width,
    font,
    lineHeight,
    predictedHeight,
    actualHeight,
    predicted.lineCount,
  )
  report = addDiagnostics(report, prepared, font, lineHeight, contentWidth, normalizedText, direction)

  window.__CORPUS_DEBUG__ = {
    corpusId: currentMeta.id,
    font,
    lineHeight,
    padding: PADDING,
    direction,
    width,
    contentWidth,
    getNormalizedText: () => normalizedText,
    layoutWithLines: nextWidth => layoutWithLines(prepared, nextWidth - PADDING * 2, lineHeight),
  }

  if (options.updateStats !== false) {
    updateStats(report, msPretext, msDOM)
  }
  if (options.publish !== false) {
    setReport(report)
  }

  return report
}

function toSweepRow(report: CorpusReport): CorpusSweepRow {
  if (
    report.width === undefined ||
    report.contentWidth === undefined ||
    report.predictedHeight === undefined ||
    report.actualHeight === undefined ||
    report.diffPx === undefined ||
    report.predictedLineCount === undefined ||
    report.browserLineCount === undefined
  ) {
    throw new Error('Corpus report was missing sweep row fields')
  }

  return {
    width: report.width,
    contentWidth: report.contentWidth,
    predictedHeight: report.predictedHeight,
    actualHeight: report.actualHeight,
    diffPx: report.diffPx,
    predictedLineCount: report.predictedLineCount,
    browserLineCount: report.browserLineCount,
    ...(report.browserLineMethod === undefined ? {} : { browserLineMethod: report.browserLineMethod }),
    ...(report.maxLineWidthDrift === undefined ? {} : { maxLineWidthDrift: report.maxLineWidthDrift }),
    ...(report.firstBreakMismatch === undefined
      ? {}
      : report.firstBreakMismatch === null
        ? { firstBreakMismatch: null }
        : {
            firstBreakMismatch: {
              line: report.firstBreakMismatch.line,
              deltaText: report.firstBreakMismatch.deltaText,
              reasonGuess: report.firstBreakMismatch.reasonGuess,
              oursContext: report.firstBreakMismatch.oursContext,
              browserContext: report.firstBreakMismatch.browserContext,
            },
          }),
  }
}

function runSweep(widths: number[]): void {
  if (currentMeta === null || currentPrepared === null) {
    return
  }

  const font = buildFont(currentMeta)
  const lineHeight = getLineHeight(currentMeta)
  const rows = widths.map(width => {
    const report = measureWidth(width, { publish: false, updateStats: false })
    if (report === null || report.status === 'error') {
      throw new Error(report?.message ?? `Failed to measure ${currentMeta?.id ?? 'corpus'} @ ${width}`)
    }
    return toSweepRow(report)
  })
  const exactCount = rows.filter(row => Math.round(row.diffPx) === 0).length

  stats.textContent =
    `${currentMeta.title} | Sweep: ${exactCount}/${rows.length} exact | ${rows.length - exactCount} nonzero` +
    ` | ${currentText.length.toLocaleString()} chars`

  setReport(withRequestId({
    status: 'ready',
    environment: getEnvironmentFingerprint(),
    corpusId: currentMeta.id,
    sliceStart: currentSliceStart,
    sliceEnd: currentSliceEnd,
    title: currentMeta.title,
    language: currentMeta.language,
    direction: getDirection(currentMeta),
    font,
    lineHeight,
    widths,
    widthCount: rows.length,
    exactCount,
    rows,
  }))
}

function setWidth(width: number): void {
  measureWidth(width)
}

function populateSelect(selectedId: string): void {
  select.textContent = ''
  for (const meta of corpusList) {
    const option = document.createElement('option')
    option.value = meta.id
    option.textContent = `${meta.language} — ${meta.title}`
    option.selected = meta.id === selectedId
    select.appendChild(option)
  }
}

async function loadSources(): Promise<CorpusMeta[]> {
  return sourcesData as CorpusMeta[]
}

async function loadText(meta: CorpusMeta): Promise<string> {
  switch (meta.id) {
    case 'ar-al-bukhala':
      return arAlBukhala
    case 'ar-risalat-al-ghufran-part-1':
      return arRisalatAlGhufranPart1
    case 'en-gatsby-opening':
      return enGatsbyOpening
    case 'he-masaot-binyamin-metudela':
      return heMasaotBinyaminMetudela
    case 'hi-eidgah':
      return hiEidgah
    case 'ja-kumo-no-ito':
      return jaKumoNoIto
    case 'ja-rashomon':
      return jaRashomon
    case 'km-prachum-reuang-preng-khmer-volume-7-stories-1-10':
      return kmPrachumReuangPrengKhmerVolume7Stories1To10
    case 'my-cunning-heron-teacher':
      return myCunningHeronTeacher
    case 'my-bad-deeds-return-to-you-teacher':
      return myBadDeedsReturnToYouTeacher
    case 'ko-unsu-joh-eun-nal':
      return koUnsuJohEunNal
    case 'mixed-app-text':
      return mixedAppText
    case 'th-nithan-vetal-story-1':
      return thNithanVetalStory1
    case 'th-nithan-vetal-story-7':
      return thNithanVetalStory7
    case 'ur-chughd':
      return urChughd
    case 'zh-zhufu':
      return zhZhufu
    case 'zh-guxiang':
      return zhGuxiang
    default:
      throw new Error(`No bundled text import for corpus ${meta.id}`)
  }
}

async function loadCorpus(meta: CorpusMeta): Promise<void> {
  currentMeta = meta
  const rawText = await loadText(meta)

  updateTitle(meta)
  configureControls(meta)
  populateSelect(meta.id)

  const font = buildFont(meta)
  const lineHeight = getLineHeight(meta)
  const direction = getDirection(meta)

  if ('fonts' in document) {
    await document.fonts.ready
  }

  publishNavigationPhase('measuring', requestId)
  const fullPrepared = prepareWithSegments(rawText, font)
  const fullNormalizedText = fullPrepared.segments.join('')
  const requestedSlice = getRequestedSlice(fullNormalizedText.length)

  currentSliceStart = requestedSlice.start
  currentSliceEnd = requestedSlice.end
  currentText = requestedSlice.start === null
    ? fullNormalizedText
    : fullNormalizedText.slice(requestedSlice.start, requestedSlice.end ?? fullNormalizedText.length)
  currentPrepared = requestedSlice.start === null
    ? fullPrepared
    : prepareWithSegments(currentText, font)
  diagnosticDiv.textContent = currentPrepared.segments.join('')

  book.textContent = currentText
  book.lang = meta.language
  book.dir = direction
  book.style.font = font
  book.style.lineHeight = `${lineHeight}px`
  book.style.padding = `${PADDING}px`
  diagnosticDiv.style.font = font
  diagnosticDiv.style.lineHeight = `${lineHeight}px`
  diagnosticDiv.style.padding = `${PADDING}px`
  diagnosticDiv.lang = meta.language
  diagnosticDiv.dir = direction
  lineProbeDiv.style.font = font
  lineProbeDiv.style.lineHeight = `${lineHeight}px`
  lineProbeDiv.style.padding = `${PADDING}px`
  lineProbeDiv.lang = meta.language
  lineProbeDiv.dir = direction
  const sweepWidths = getRequestedSweepWidths(meta)
  if (sweepWidths !== null) {
    runSweep(sweepWidths)
    return
  }

  setWidth(getInitialWidth(meta))
}

function navigateToCorpus(id: string): void {
  const nextParams = new URLSearchParams(location.search)
  nextParams.set('id', id)
  nextParams.delete('width')
  nextParams.delete('requestId')
  nextParams.delete('report')
  nextParams.delete('diagnostic')
  location.search = nextParams.toString()
}

slider.addEventListener('input', () => {
  setWidth(Number.parseInt(slider.value, 10))
})

select.addEventListener('change', () => {
  navigateToCorpus(select.value)
})

window.__CORPUS_REPORT__ = withRequestId({ status: 'error', message: 'Pending initial layout' })
stats.textContent = 'Loading...'
clearNavigationReport()
publishNavigationPhase('loading', requestId)

async function init(): Promise<void> {
  try {
    corpusList = await loadSources()
    if (corpusList.length === 0) {
      throw new Error('No corpora found')
    }

    const selected = corpusList.find(meta => meta.id === requestedCorpusId) ?? corpusList[0]!
    await loadCorpus(selected)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setError(message)
  }
}

void init()
