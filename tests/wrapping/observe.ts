import { normalizeSource, segmentBreakRemovals, type Prediction, type PredictionLine } from './contracts.ts'
import type {
  Assessment, BrowserKind, MetricResult, NativeExtraction, NativeObservation, NativePoint, NativeRect, WrappingCase,
} from './types.ts'

const RECT_EPSILON = 0.00001
const HEIGHT_TOLERANCE = 0.02
const WIDTH_TOLERANCE = 0.05
const ASCII_SPACE = /^[ \t\n\r\f]+$/
const INVISIBLE = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Control}]+$/u
const WHITE_SPACE = /^\p{White_Space}+$/u
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// The compact mode oracles deliberately use both extraction methods. Span
// boundaries are an intervention, so keep this observation separate from the
// unmodified paragraph's height and scalar rectangles. Units come from source
// graphemes, never a candidate's private prepared representation.
function observeLineExtraction(element: HTMLElement, input: WrappingCase, browser: BrowserKind): Omit<NativeExtraction, 'usedLineHeight'> {
  const text = normalizeSource(input.text, input.whiteSpace, browser)
  const sourceUnits = Array.from(graphemeSegmenter.segment(text))
  element.textContent = text
  const method = input.lineMethod
  if (method === undefined) throw new Error('A line extraction method is required.')
  const spans = method === 'span' ? sourceUnits.map(unit => {
    const span = document.createElement('span')
    span.textContent = unit.segment
    return span
  }) : []
  if (method === 'span') element.replaceChildren(...spans)
  const origin = element.getBoundingClientRect()
  const relative = (rect: DOMRect): NativeRect => ({
    x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height,
  })
  const range = document.createRange()
  const units: NativePoint[] = []
  const points: NativePoint[] = []
  for (let index = 0; index < sourceUnits.length; index++) {
    const unit = sourceUnits[index]!
    let rects: NativeRect[]
    switch (method) {
      case 'range': {
        const node = element.firstChild!
        range.setStart(node, unit.index)
        range.setEnd(node, unit.index + unit.segment.length)
        rects = Array.from(range.getClientRects(), relative)
        break
      }
      case 'span': rects = Array.from(spans[index]!.getClientRects(), relative); break
    }
    const observedUnit = { start: unit.index, end: unit.index + unit.segment.length, text: unit.segment, rects }
    units.push(observedUnit)
    if (method === 'range' && unit.segment.length === (unit.segment.codePointAt(0)! > 0xffff ? 2 : 1)) {
      points.push(observedUnit)
    } else {
      const node = method === 'span' ? spans[index]!.firstChild! : element.firstChild!
      let start = 0
      for (const scalar of unit.segment) {
        const end = start + scalar.length
        const offset = method === 'span' ? 0 : unit.index
        range.setStart(node, offset + start)
        range.setEnd(node, offset + end)
        points.push({ start: unit.index + start, end: unit.index + end, text: scalar, rects: Array.from(range.getClientRects(), relative) })
        start = end
      }
    }
  }
  range.selectNodeContents(element)
  return {
    method, source: text, height: origin.height, units, points,
    lineRects: Array.from(range.getClientRects(), relative),
  }
}

// One unmodified text node is the oracle. Wrapping every letter in a span
// changes contextual shaping and dictionary breaks in the text under test.
export function observeNative(input: WrappingCase, browser: BrowserKind): NativeObservation {
  const text = input.nativeSource === 'normalized' ? normalizeSource(input.text, input.whiteSpace, browser) : input.text
  const element = document.createElement('div')
  Object.assign(element.style, {
    position: 'absolute', left: '0', top: '0', margin: '0', padding: '0', border: '0',
    font: input.font, lineHeight: `${input.lineHeight}px`, width: `${input.width}px`,
    letterSpacing: `${input.letterSpacing}px`, whiteSpace: input.whiteSpace,
    wordBreak: input.wordBreak, overflowWrap: 'break-word', lineBreak: 'auto',
    direction: input.direction, tabSize: '8',
    hyphens: 'manual',
  })
  if (input.lang !== undefined) element.lang = input.lang
  const node = document.createTextNode(text)
  element.append(node)
  document.body.append(element)
  try {
    const origin = element.getBoundingClientRect()
    const points: NativePoint[] = []
    const lineRects: NativeRect[] = []
    if (input.detail !== 'height') {
      const range = document.createRange()
      const relative = (rect: DOMRect): NativeRect => ({
        x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height,
      })
      let start = 0
      for (const scalar of text) {
        const end = start + scalar.length
        range.setStart(node, start)
        range.setEnd(node, end)
        points.push({ start, end, text: scalar, rects: Array.from(range.getClientRects(), relative) })
        start = end
      }
      range.selectNodeContents(node)
      lineRects.push(...Array.from(range.getClientRects(), relative))
    }
    let richHeight: number | undefined
    if (input.nativeItems === true) {
      if (input.parts === undefined || input.parts.join('') !== text || input.whiteSpace !== 'normal' || input.wordBreak !== 'normal') {
        throw new Error('Native inline-item height requires matching source parts in normal whitespace and word-break modes.')
      }
      element.replaceChildren(...input.parts.map(part => {
        const span = document.createElement('span')
        span.textContent = part
        return span
      }))
      richHeight = element.getBoundingClientRect().height
    }
    const extraction = input.lineMethod === undefined ? undefined : observeLineExtraction(element, input, browser)
    let usedLineHeight = input.lineHeight
    if (!Number.isInteger(input.lineHeight)) {
      // Safari can use integral line boxes despite retaining a fractional
      // computed CSS line-height. Observe the strut independently of wrapping.
      element.style.whiteSpace = 'pre'
      element.style.width = 'max-content'
      element.textContent = 'x\nx'
      usedLineHeight = element.getBoundingClientRect().height / 2
    }
    const count = origin.height / usedLineHeight
    return {
      height: origin.height, lineCount: Math.abs(count - Math.round(count)) < 0.000001 ? Math.round(count) : count, points, lineRects,
      ...(usedLineHeight === input.lineHeight ? {} : { usedLineHeight }),
      ...(extraction === undefined ? {} : { extraction: { ...extraction, usedLineHeight } }),
      ...(richHeight === undefined ? {} : { richHeight }),
    }
  } finally {
    element.remove()
  }
}

type SourceSpan = { rawStart: number; rawEnd: number; start: number; end: number }

// Map the documented whitespace transformation, not a candidate's private
// segmentation. Every observed raw scalar retains its normalized source view.
function sourceSpans(input: WrappingCase, browser: BrowserKind): SourceSpan[] {
  const spans: SourceSpan[] = []
  const removed = input.whiteSpace === 'normal' ? segmentBreakRemovals(input.text, browser) : null
  let normalizedOffset = 0
  for (let rawStart = 0; rawStart < input.text.length;) {
    const char = input.text[rawStart]!
    let rawEnd = rawStart + 1
    if (input.whiteSpace === 'normal' && ASCII_SPACE.test(char)) {
      let survives = removed?.[rawStart] !== true
      for (; rawEnd < input.text.length && ASCII_SPACE.test(input.text[rawEnd]!); rawEnd++) survives ||= removed?.[rawEnd] !== true
      // A run whose white space the engine deletes has no normalized offset.
      if (rawStart !== 0 && rawEnd !== input.text.length && survives) {
        spans.push({ rawStart, rawEnd, start: normalizedOffset, end: normalizedOffset + 1 })
        normalizedOffset++
      }
    } else {
      if (input.whiteSpace === 'pre-wrap' && char === '\r' && input.text[rawEnd] === '\n') rawEnd++
      spans.push({ rawStart, rawEnd, start: normalizedOffset, end: normalizedOffset + 1 })
      normalizedOffset++
    }
    rawStart = rawEnd
  }
  return spans
}

function lineOnGrid(rect: NativeRect, lineHeight: number, lineCount: number): number | null {
  const line = Math.floor((rect.y + rect.height / 2) / lineHeight)
  return line >= 0 && line < lineCount ? line : null
}

function rectLine(rect: NativeRect, input: WrappingCase, native: NativeObservation): number | null {
  return lineOnGrid(rect, native.usedLineHeight ?? input.lineHeight, Math.round(native.lineCount))
}

function pointLine(point: NativePoint, lineHeight: number, lineCount: number): number | null {
  let line: number | null = null
  for (const rect of point.rects) {
    if (rect.width <= RECT_EPSILON || rect.height <= RECT_EPSILON) continue
    const next = lineOnGrid(rect, lineHeight, lineCount)
    if (next === null || (line !== null && line !== next)) return null
    line = next
  }
  return line
}

function extractionLineCount(extraction: NativeExtraction): number | null {
  const { height, usedLineHeight } = extraction
  if (!Number.isFinite(height) || height < 0 || !Number.isFinite(usedLineHeight) || usedLineHeight <= 0) return null
  const count = height / usedLineHeight
  return Math.abs(count - Math.round(count)) < 0.000001 ? Math.round(count) : null
}

function forcedLineBounds(source: string, count: number): Array<{ start: number; end: number }> | null {
  if (!source.includes('\n')) return null
  const bounds: Array<{ start: number; end: number }> = []
  let start = 0
  for (let end = 0; end < source.length; end++) {
    if (source[end] !== '\n') continue
    bounds.push({ start, end })
    start = end + 1
  }
  if (start < source.length) bounds.push({ start, end: source.length })
  // Preserved LF forces one line per interval, including empty intervals. A
  // trailing LF does not create another final line. Equality with independently
  // measured height proves there are no additional soft-wrapped lines.
  return bounds.length === count ? bounds : null
}

function preservedSpanLine(unit: NativePoint | undefined, point: NativePoint, extraction: NativeExtraction, count: number): number | null {
  // This selected protocol observes the literal whitespace element's own box,
  // not a text Range that might carry a neighbouring glyph or zero rectangle.
  // Require its sole fragment to agree with the scalar Range in the SAME DOM.
  if (unit === undefined || unit.start !== point.start || unit.end !== point.end || unit.text !== point.text
    || unit.rects.length !== 1 || point.rects.length !== 1) return null
  const box = unit.rects[0]!, scalar = point.rects[0]!
  if (box.width <= RECT_EPSILON || box.height <= RECT_EPSILON
    || ![box.x, box.y, box.width, box.height, scalar.x, scalar.y, scalar.width, scalar.height].every(Number.isFinite)
    || Math.abs(box.x - scalar.x) > RECT_EPSILON || Math.abs(box.y - scalar.y) > RECT_EPSILON
    || Math.abs(box.width - scalar.width) > RECT_EPSILON || Math.abs(box.height - scalar.height) > RECT_EPSILON) return null
  return lineOnGrid(box, extraction.usedLineHeight, count)
}

function compareExtractedBreaks(extraction: NativeExtraction, count: number, whiteSpace: WrappingCase['whiteSpace'], prediction: Extract<Prediction, { detail: 'full' }>): MetricResult {
  if (prediction.normalized !== extraction.source) {
    return { status: 'fail', detail: 'Predicted normalized source differs from the selected extraction source.' }
  }
  const lines = prediction.lines
  const bounds = Array.from({ length: count }, () => ({ start: -1, end: -1 }))
  const uncertain: NativePoint[] = []
  let lineIndex = 0
  let unitIndex = 0
  let observed = 0
  for (const point of extraction.points) {
    // The existing boundary contract allows collapsed ASCII whitespace gaps.
    // Its ownership cannot affect trimmed ends or suppressed normal-mode starts.
    if (whiteSpace === 'normal' && ASCII_SPACE.test(point.text)) continue
    // A positive rectangle can include an adjacent glyph, and an invisible
    // control's box does not establish which consumed source range owns it.
    // In particular, Chrome b after SHY can have positive rectangles on BOTH
    // the hyphen's line and b's line. Never choose the first or last rectangle.
    let expected: number | null
    if (whiteSpace === 'pre-wrap' && extraction.method === 'span' && (point.text === ' ' || point.text === '\t')) {
      for (; unitIndex < extraction.units.length && extraction.units[unitIndex]!.end <= point.start; unitIndex++) { /* matching source element */ }
      expected = preservedSpanLine(extraction.units[unitIndex], point, extraction, count)
    } else {
      expected = INVISIBLE.test(point.text) ? null : pointLine(point, extraction.usedLineHeight, count)
    }
    if (expected === null) { uncertain.push(point); continue }
    for (; lineIndex < lines.length && lines[lineIndex]!.sourceEnd <= point.start; lineIndex++) { /* monotone source view */ }
    const actual = lines[lineIndex]
    if (actual === undefined || lineIndex !== expected || actual.sourceStart > point.start || actual.sourceEnd < point.end) {
      return { status: 'fail', detail: `Extraction source [${point.start}, ${point.end}) ${JSON.stringify(point.text)} belongs to line ${expected}; prediction does not place it there.` }
    }
    const bound = bounds[expected]!
    if (bound.start === -1) bound.start = point.start
    bound.end = point.end
    observed++
  }
  if (lines.length !== count) {
    return { status: 'fail', detail: `Predicted ${lines.length} source ranges; the ${extraction.method} extraction has ${count} measured line boxes.` }
  }
  let hardBounds = whiteSpace === 'pre-wrap' ? forcedLineBounds(extraction.source, count) : null
  if (hardBounds !== null && bounds.some((bound, index) => bound.start !== -1
    && (bound.start < hardBounds![index]!.start || bound.end > hardBounds![index]!.end))) hardBounds = null
  let boundIndex = 0
  let ambiguous = 0
  for (const point of uncertain) {
    // LF topology fixes these preserved source intervals without interpreting
    // a whitespace rectangle. Other controls or unobserved visible scalars at
    // their endpoints remain ambiguous, even on a control-only hard line.
    if (hardBounds !== null && (point.text === '\n' || point.text === ' ' || point.text === '\t')) continue
    for (; boundIndex < bounds.length && bounds[boundIndex]!.end <= point.start; boundIndex++) { /* monotone visible envelope */ }
    const bound = bounds[boundIndex]
    // This does not assign an internal control to a painted line. Source
    // strictly between fixed visible endpoints cannot change those endpoints.
    if (bound === undefined || bound.start > point.start || bound.end < point.end) ambiguous++
  }
  if (ambiguous > 0 || (hardBounds === null && bounds.some(bound => bound.start === -1))) {
    return { status: 'unobserved', reason: `${observed} extraction scalars agree; ${ambiguous} boundary scalars have unestablished source ownership. Exact endpoints are not determined by rectangle order or positivity.` }
  }
  for (let index = 0; index < bounds.length; index++) {
    const expected = (hardBounds ?? bounds)[index]!
    const actual = lines[index]!
    let start = actual.sourceStart
    if (whiteSpace === 'normal') {
      for (; start < actual.sourceEnd && prediction.normalized[start] === ' '; start++) { /* suppressed line-start space */ }
    }
    const end = actual.sourceStart + prediction.normalized.slice(actual.sourceStart, actual.sourceEnd).trimEnd().length
    const expectedEnd = expected.start + extraction.source.slice(expected.start, expected.end).trimEnd().length
    if (start !== expected.start || end !== expectedEnd) {
      return { status: 'fail', detail: `Line ${index}: predicted source envelope [${start}, ${end}), observed ${extraction.method} [${expected.start}, ${expectedEnd}).` }
    }
  }
  return { status: 'pass' }
}

function compareSource(
  input: WrappingCase, native: NativeObservation, lines: PredictionLine[], spans: SourceSpan[], whitespace: boolean,
): MetricResult {
  let applicable = 0
  let observed = 0
  let ambiguous = 0
  let spanIndex = 0
  for (const point of native.points) {
    if (whitespace ? !WHITE_SPACE.test(point.text) : INVISIBLE.test(point.text)) continue
    // Collapsed ASCII whitespace has no unique raw ownership. Pre-wrap hard
    // breaks also do not paint a width-bearing source rectangle.
    if (whitespace && (input.whiteSpace === 'normal' && ASCII_SPACE.test(point.text) || /[\r\n\f]/.test(point.text))) continue
    applicable++
    const expected = pointLine(point, native.usedLineHeight ?? input.lineHeight, Math.round(native.lineCount))
    if (expected === null) { ambiguous++; continue }
    for (; spanIndex < spans.length && spans[spanIndex]!.rawEnd <= point.start; spanIndex++) { /* monotonic source view */ }
    const start = spans[spanIndex]
    let endIndex = spanIndex
    for (; endIndex < spans.length && spans[endIndex]!.rawEnd < point.end; endIndex++) { /* astral scalar */ }
    const end = spans[endIndex]
    if (start === undefined || end === undefined || start.rawStart > point.start || end.rawEnd < point.end) {
      return { status: 'fail', detail: `No normalized source view for raw [${point.start}, ${point.end}).` }
    }
    const actual = lines.findIndex(line => line.sourceStart <= start.start && line.sourceEnd >= end.end)
    if (actual !== expected) {
      return { status: 'fail', detail: `Raw [${point.start}, ${point.end}) ${JSON.stringify(point.text)} belongs to line ${expected}; prediction assigns ${actual}.` }
    }
    observed++
  }
  if (applicable === 0) return { status: 'not-applicable', reason: whitespace ? 'No preserved width-bearing whitespace.' : 'No visible source scalars.' }
  if (ambiguous > 0) return { status: 'unobserved', reason: `${observed}/${applicable} source scalars agree; ${ambiguous} have zero or ambiguous native rectangles.` }
  return { status: 'pass' }
}

function compareWidths(input: WrappingCase, native: NativeObservation, lines: PredictionLine[]): MetricResult {
  if (lines.some(line => !Number.isFinite(line.width))) return { status: 'fail', detail: 'Predicted line width is not finite.' }
  if (input.text.length === 0) return { status: 'not-applicable', reason: 'Empty text has no inline width.' }
  // A DOM rectangle encloses overlaps and hanging whitespace. It is not a
  // general advance-width oracle for those layouts or a glyph ink extractor.
  if (input.discretionary === undefined && (input.letterSpacing < 0 || input.whiteSpace === 'pre-wrap' || /\u00ad|\u200b|\u200c|\u200d|\u2060|\ufeff/u.test(input.text))) {
    return { status: 'unobserved', reason: 'Range extents do not independently determine advances with overlap, preserved whitespace, or shaping controls.' }
  }
  // The explicit discretionary cases have separately verified whole-
  // line Range geometry, including terminal SHY and signed spacing. Their
  // original tighter tolerance is part of that explicit observation protocol.
  const tolerance = input.discretionary === undefined ? WIDTH_TOLERANCE : 0.025
  const bounds: Array<{ left: number; right: number } | undefined> = Array.from({ length: Math.round(native.lineCount) })
  for (const rect of native.lineRects) {
    if (rect.width <= RECT_EPSILON || rect.height <= RECT_EPSILON) continue
    const index = rectLine(rect, input, native)
    if (index === null) return { status: 'unobserved', reason: 'A native line rectangle lies outside the block line grid.' }
    const previous = bounds[index]
    bounds[index] = previous === undefined
      ? { left: rect.x, right: rect.x + rect.width }
      : { left: Math.min(previous.left, rect.x), right: Math.max(previous.right, rect.x + rect.width) }
  }
  if (bounds.some(bound => bound === undefined)) return { status: 'unobserved', reason: 'Native Range did not expose every line width.' }
  if (lines.length !== bounds.length) return { status: 'fail', detail: `Cannot match ${lines.length} predicted line widths to ${bounds.length} native lines.` }
  for (let i = 0; i < bounds.length; i++) {
    const bound = bounds[i]!
    const expected = bound.right - bound.left
    if (Math.abs(lines[i]!.width - expected) > tolerance) {
      return { status: 'fail', detail: `Line ${i} width ${lines[i]!.width} differs from native Range extent ${expected}.` }
    }
  }
  return { status: 'pass' }
}

function compareHyphens(input: WrappingCase, native: NativeObservation, lines: PredictionLine[]): MetricResult {
  if (input.discretionary !== undefined) {
    const expected = input.discretionary.expectedText
    const actual = lines.map(line => line.text)
    return actual.length === expected.length && actual.every((text, index) => text === expected[index])
      ? { status: 'pass' }
      : { status: 'fail', detail: `Discretionary line text ${JSON.stringify(actual)} differs from the maintained contract ${JSON.stringify(expected)}.` }
  }
  if (!input.text.includes('\u00ad')) return { status: 'not-applicable', reason: 'No soft hyphen.' }
  // This is the deliberately restricted oracle from the retained paint audit.
  // Safari can expose a positive SHY Range even when no hyphen was selected.
  // Keep-all also allocates visible-letter extents to a hidden SHY Range.
  // Arbitrary joining/control contexts need a separate observation method.
  if (input.text !== 'a\u00adb' || input.letterSpacing < 0 || input.wordBreak !== 'normal') {
    return { status: 'unobserved', reason: 'SHY selection oracle is verified only for normal word breaking in a SHY b with nonnegative spacing; raw rectangles remain available.' }
  }
  const a = native.points.find(point => point.text === 'a')!
  const b = native.points.find(point => point.text === 'b')!
  const shy = native.points.find(point => point.text === '\u00ad')!
  const aLine = pointLine(a, native.usedLineHeight ?? input.lineHeight, Math.round(native.lineCount))
  const bLine = pointLine(b, native.usedLineHeight ?? input.lineHeight, Math.round(native.lineCount))
  if (aLine === null || bLine === null) return { status: 'unobserved', reason: 'The SHY control letters have ambiguous native rectangles.' }
  const nativeLines: number[] = []
  if (aLine !== bLine) {
    for (const rect of shy.rects) {
      if (rect.width <= RECT_EPSILON || rect.height <= RECT_EPSILON) continue
      const line = rectLine(rect, input, native)
      if (line === null) return { status: 'unobserved', reason: 'Selected SHY rectangle is outside the native line grid.' }
      const whole = native.lineRects.filter(other => rectLine(other, input, native) === line)
      const contained = whole.some(other => other.x <= rect.x + WIDTH_TOLERANCE && other.x + other.width >= rect.x + rect.width - WIDTH_TOLERANCE)
      if (!contained) return { status: 'unobserved', reason: 'Positive SHY rectangle is not corroborated by the full native line extent.' }
      const letterRects = [...a.rects, ...b.rects].filter(other => other.width > RECT_EPSILON && rectLine(other, input, native) === line)
      if (letterRects.some(other => other.x <= rect.x + WIDTH_TOLERANCE && other.x + other.width >= rect.x + rect.width - WIDTH_TOLERANCE)) {
        return { status: 'unobserved', reason: 'Positive SHY rectangle adds no extent beyond ordinary-letter geometry; selection cannot be inferred.' }
      }
      if (!nativeLines.includes(line)) nativeLines.push(line)
    }
    // A missing SHY rectangle is only decisive if whole-line geometry contains
    // no unexplained advance. Otherwise zero-width extraction is inconclusive.
    if (nativeLines.length === 0) {
      for (const whole of native.lineRects) {
        if (whole.width <= RECT_EPSILON) continue
        const line = rectLine(whole, input, native)
        const letters = [...a.rects, ...b.rects].filter(rect => rect.width > RECT_EPSILON && rectLine(rect, input, native) === line)
        if (!letters.some(rect => Math.abs(rect.x - whole.x) <= WIDTH_TOLERANCE && Math.abs(rect.width - whole.width) <= WIDTH_TOLERANCE)) {
          return { status: 'unobserved', reason: 'Whole-line advance is unexplained by visible letters, but SHY geometry is absent.' }
        }
      }
    }
  }
  const predictedLines: number[] = []
  for (let i = 0; i < lines.length; i++) {
    for (const char of lines[i]!.text) if (char === '-' || char === '\u2010') predictedLines.push(i)
  }
  if (nativeLines.length !== predictedLines.length || nativeLines.some((line, i) => line !== predictedLines[i])) {
    return { status: 'fail', detail: `Selected hyphens occur on native lines [${nativeLines.join(', ')}], predicted [${predictedLines.join(', ')}]. This checks selection location, not glyph shape.` }
  }
  return { status: 'pass' }
}

export function predictionGeometry(input: WrappingCase, prediction: Prediction): { height: number; lineCount: number } {
  let height = prediction.height
  if (prediction.detail === 'full') {
    switch (input.heightSource) {
      case 'layout': height = prediction.countedHeight; break
      case 'lines': height = prediction.lines.length * input.lineHeight; break
      case undefined: break
    }
  }
  const lineCount = prediction.detail === 'full' && (input.lineMethod !== undefined || input.heightSource === 'lines')
    ? prediction.lines.length : prediction.lineCount
  return { height, lineCount }
}

export function assess(
  input: WrappingCase, native: NativeObservation, prediction: Prediction, browser: BrowserKind,
): Assessment {
  const { height: predictedHeight, lineCount: predictedLineCount } = predictionGeometry(input, prediction)
  const usedLineHeight = native.usedLineHeight ?? input.lineHeight
  const nativeScaleHeight = predictedHeight / input.lineHeight * usedLineHeight
  const difference = nativeScaleHeight - native.height
  let heightMatches = Math.abs(difference) <= HEIGHT_TOLERANCE
  switch (input.heightMode) {
    case 'exact': heightMatches = difference === 0; break
    case 'accuracy': heightMatches = Math.abs(difference) < 1; break
    case 'corpus': heightMatches = Math.round(difference) === 0; break
    case undefined: break
  }
  const height: MetricResult = heightMatches
    ? { status: 'pass' }
    : { status: 'fail', detail: `Predicted height ${predictedHeight}; native ${native.height}.${usedLineHeight === input.lineHeight ? '' : ` Native line boxes use ${usedLineHeight}px; equivalent predicted height ${nativeScaleHeight}.`}` }
  let lineCount: MetricResult = predictedLineCount === native.lineCount
    ? { status: 'pass' }
    : { status: 'fail', detail: `Predicted ${predictedLineCount} lines; native block observation has ${native.lineCount}.` }
  let breaks: MetricResult = { status: 'unobserved', reason: 'No source line-boundary extraction was selected.' }
  if (input.lineMethod !== undefined) {
    const extraction = native.extraction
    if (extraction === undefined) {
      lineCount = breaks = { status: 'unobserved', reason: `The selected ${input.lineMethod} extraction has no stage geometry. Legacy source groups cannot establish its height or source ownership.` }
    } else if (extraction.method !== input.lineMethod || extraction.source !== normalizeSource(input.text, input.whiteSpace, browser)) {
      lineCount = breaks = { status: 'unobserved', reason: 'The recorded extraction method or source differs from the selected observation protocol.' }
    } else {
      const count = extractionLineCount(extraction)
      if (count === null) {
        lineCount = breaks = { status: 'unobserved', reason: 'Extraction-stage height and resolved line-height do not establish an integral line-box count.' }
      } else {
        lineCount = predictedLineCount === count
          ? { status: 'pass' }
          : { status: 'fail', detail: `Predicted ${predictedLineCount} lines; the ${extraction.method} extraction's own height ${extraction.height} establishes ${count}.` }
        if (prediction.detail === 'full') breaks = compareExtractedBreaks(extraction, count, input.whiteSpace, prediction)
      }
    }
  }
  let richHeight: MetricResult = { status: 'not-applicable', reason: 'No native inline-item protocol was selected.' }
  if (input.nativeItems === true) {
    richHeight = native.richHeight === undefined || prediction.detail !== 'full' || prediction.richLineCount === undefined
      ? { status: 'unobserved', reason: 'Native inline-item height or completed rich prediction is absent.' }
      : Math.abs(prediction.richLineCount * usedLineHeight - native.richHeight) <= HEIGHT_TOLERANCE
        ? { status: 'pass' }
        : { status: 'fail', detail: `Rich prediction has ${prediction.richLineCount} lines; native inline-item height is ${native.richHeight}.` }
  }
  if (prediction.detail === 'height') {
    const unobserved: MetricResult = { status: 'unobserved', reason: 'This maintained case is scheduled for height observation only.' }
    return { height, lineCount, breaks, source: unobserved, whitespace: unobserved, widths: unobserved, hyphen: input.text.includes('\u00ad') ? unobserved : { status: 'not-applicable', reason: 'No soft hyphen.' }, api: unobserved, richHeight }
  }
  const observedInput = input.nativeSource === 'normalized' ? { ...input, text: normalizeSource(input.text, input.whiteSpace, browser) } : input
  const spans = sourceSpans(observedInput, browser)
  const normalizationCorrect = normalizeSource(input.text, input.whiteSpace, browser) === prediction.normalized
  const source = normalizationCorrect
    ? compareSource(observedInput, native, prediction.lines, spans, false)
    : { status: 'fail' as const, detail: 'Prepared segments do not preserve the documented normalized source.' }
  // Safari can give an incorrect line for hanging pre-wrap spaces. Keep the
  // raw rectangles, but do not promote this known extractor limitation to a
  // product failure (or silently call it a pass).
  const whitespace = browser === 'safari' && input.whiteSpace === 'pre-wrap' && /[ \t]/.test(input.text)
    ? { status: 'unobserved' as const, reason: 'Safari pre-wrap whitespace Range ownership requires an independent span cross-check.' }
    : compareSource(observedInput, native, prediction.lines, spans, true)
  return {
    height, lineCount, breaks, source, whitespace, richHeight,
    widths: compareWidths(input, native, prediction.lines),
    hyphen: compareHyphens(input, native, prediction.lines),
    api: prediction.contracts.length === 0 ? { status: 'pass' } : { status: 'fail', detail: prediction.contracts.map(failure => `${failure.contract}: ${failure.detail}`).join('; ') },
  }
}
