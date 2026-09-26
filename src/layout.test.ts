import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createVariant } from '../tests/wrapping/contracts.ts'
import type { AnalysisProfile } from './analysis.ts'

// Keep the permanent suite small and durable. These tests exercise the shipped
// prepare/layout exports with a deterministic fake canvas backend. For narrow
// browser-specific investigations, prefer throwaway probes and browser checkers
// over mirroring the full implementation here.

const FONT = '16px Test Sans'
const LINE_HEIGHT = 19

type AnalysisModule = typeof import('./analysis.ts')
type LayoutModule = typeof import('./layout.ts')
type LineBreakModule = typeof import('./line-break.ts')
type LineBreaksModule = typeof import('./line-breaks.ts')
type MeasurementModule = typeof import('./measurement.ts')
type RichInlineModule = typeof import('./rich-inline.ts')
type SegmentMetrics = ReturnType<MeasurementModule['getSegmentMetrics']>

let prepare: LayoutModule['prepare']
let prepareWithSegments: LayoutModule['prepareWithSegments']
let layout: LayoutModule['layout']
let layoutWithLines: LayoutModule['layoutWithLines']
let layoutNextLine: LayoutModule['layoutNextLine']
let layoutNextLineRange: LayoutModule['layoutNextLineRange']
let materializeLineRange: LayoutModule['materializeLineRange']
let measureLineStats: LayoutModule['measureLineStats']
let measureNaturalWidth: LayoutModule['measureNaturalWidth']
let walkLineRanges: LayoutModule['walkLineRanges']
let setLocale: LayoutModule['setLocale']
let clearCache: LayoutModule['clearCache']
let countPreparedLines: LineBreakModule['countPreparedLines']
let measurePreparedLineGeometry: LineBreakModule['measurePreparedLineGeometry']
let stepPreparedLineGeometry: LineBreakModule['stepPreparedLineGeometry']
let walkPreparedLinesRaw: LineBreakModule['walkPreparedLinesRaw']
let SPACED: LineBreakModule['SPACED']
let getSegmentBreakableFitAdvances: MeasurementModule['getSegmentBreakableFitAdvances']
let getEngineProfile: MeasurementModule['getEngineProfile']
let analyzeText: AnalysisModule['analyzeText']
let getBlinkLineBreaks: LineBreaksModule['getBlinkLineBreaks']
let prepareRichInline: RichInlineModule['prepareRichInline']
let layoutNextRichInlineLineRange: RichInlineModule['layoutNextRichInlineLineRange']
let materializeRichInlineLineRange: RichInlineModule['materializeRichInlineLineRange']
let measureRichInlineStats: RichInlineModule['measureRichInlineStats']
let walkRichInlineLineRanges: RichInlineModule['walkRichInlineLineRanges']
let variant: ReturnType<typeof createVariant>
let canvasMeasurementCount = 0
// Real fonts give WJ and U+FEFF no advance, and a mark on its base almost none. A
// font without U+0323 draws a letter right before it in a wider font, as Amiri does.
let shapesMarksAndJoiners = false
// A font with a dotted circle draws one for a nonspacing mark that starts a Canvas
// word, as Blink's Canvas does after a soft hyphen or ZWSP in Georgia.
let drawsDottedCircles = false

const emojiPresentationRe = /\p{Emoji_Presentation}/u
const punctuationRe = /[.,!?;:%)\]}'"”’»›…—-]/u
const decimalDigitRe = /\p{Nd}/u
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

type TestLayoutCursor = {
  segmentIndex: number
  graphemeIndex: number
}

type TestPreparedTextWithSegments = {
  segments: string[]
}

type TestLayoutLine = {
  text: string
  width: number
  start: TestLayoutCursor
  end: TestLayoutCursor
}

function parseFontSize(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)\s*px/)
  return match ? Number.parseFloat(match[1]!) : 16
}

function isWideCharacter(ch: string): boolean {
  const code = ch.codePointAt(0)!
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0xF900 && code <= 0xFAFF) ||
    (code >= 0x2F800 && code <= 0x2FA1F) ||
    (code >= 0x20000 && code <= 0x2A6DF) ||
    (code >= 0x2A700 && code <= 0x2B73F) ||
    (code >= 0x2B740 && code <= 0x2B81F) ||
    (code >= 0x2B820 && code <= 0x2CEAF) ||
    (code >= 0x2CEB0 && code <= 0x2EBEF) ||
    (code >= 0x2EBF0 && code <= 0x2EE5D) ||
    (code >= 0x30000 && code <= 0x3134F) ||
    (code >= 0x31350 && code <= 0x323AF) ||
    (code >= 0x323B0 && code <= 0x33479) ||
    (code >= 0x3000 && code <= 0x303F) ||
    (code >= 0x3040 && code <= 0x309F) ||
    (code >= 0x30A0 && code <= 0x30FF) ||
    (code >= 0x3130 && code <= 0x318F) ||
    (code >= 0xAC00 && code <= 0xD7AF) ||
    (code >= 0xFF00 && code <= 0xFFEF)
  )
}

function measureWidth(text: string, font: string): number {
  const fontSize = parseFontSize(font)
  let width = 0
  let previousWasDecimalDigit = false

  let previous = ''
  for (const ch of text) {
    const before = previous
    previous = ch
    if (drawsDottedCircles && /\p{Mn}/u.test(ch) && (before === '' || before === '\u00AD' || before === '\u200B')) {
      width += fontSize * 0.5
      continue
    }
    if (ch === '\u200B') continue
    if (shapesMarksAndJoiners && ch === '\u0323' && /\p{L}/u.test(before)) {
      width += fontSize * 0.14
      continue
    }
    if (shapesMarksAndJoiners && (ch === '\u2060' || ch === '\uFEFF' || (width > 0 && /\p{M}/u.test(ch)))) continue
    if (ch === ' ') {
      width += fontSize * 0.33
      previousWasDecimalDigit = false
    } else if (ch === '\t') {
      width += fontSize * 1.32
      previousWasDecimalDigit = false
    } else if (emojiPresentationRe.test(ch) || ch === '\uFE0F') {
      width += fontSize
      previousWasDecimalDigit = false
    } else if (decimalDigitRe.test(ch)) {
      width += fontSize * (previousWasDecimalDigit ? 0.48 : 0.52)
      previousWasDecimalDigit = true
    } else if (isWideCharacter(ch)) {
      width += fontSize
      previousWasDecimalDigit = false
    } else if (punctuationRe.test(ch)) {
      width += fontSize * 0.4
      previousWasDecimalDigit = false
    } else {
      width += fontSize * 0.6
      previousWasDecimalDigit = false
    }
  }

  return width
}

function nextTabAdvance(lineWidth: number, spaceWidth: number, tabSize = 8): number {
  const tabStopAdvance = spaceWidth * tabSize
  const remainder = lineWidth % tabStopAdvance
  return remainder === 0 ? tabStopAdvance : tabStopAdvance - remainder
}

function getSegmentGraphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), segment => segment.segment)
}

function slicePreparedText(
  prepared: TestPreparedTextWithSegments,
  start: TestLayoutCursor,
  end: TestLayoutCursor,
): string {
  if (start.segmentIndex === end.segmentIndex) {
    const segment = prepared.segments[start.segmentIndex]
    if (segment === undefined) return ''
    return getSegmentGraphemes(segment).slice(start.graphemeIndex, end.graphemeIndex).join('')
  }

  let result = ''
  for (let segmentIndex = start.segmentIndex; segmentIndex < end.segmentIndex; segmentIndex++) {
    const segment = prepared.segments[segmentIndex]
    if (segment === undefined) break
    if (segmentIndex === start.segmentIndex && start.graphemeIndex > 0) {
      result += getSegmentGraphemes(segment).slice(start.graphemeIndex).join('')
    } else {
      result += segment
    }
  }

  if (end.graphemeIndex > 0) {
    const segment = prepared.segments[end.segmentIndex]
    if (segment !== undefined) {
      result += getSegmentGraphemes(segment).slice(0, end.graphemeIndex).join('')
    }
  }

  return result
}

function reconstructFromLineBoundaries(
  prepared: TestPreparedTextWithSegments,
  lines: TestLayoutLine[],
): string {
  return lines.map(line => slicePreparedText(prepared, line.start, line.end)).join('')
}

function collectStreamedLines(
  prepared: TestPreparedTextWithSegments,
  width: number,
  start: TestLayoutCursor = { segmentIndex: 0, graphemeIndex: 0 },
): TestLayoutLine[] {
  const lines: TestLayoutLine[] = []
  let cursor = { ...start }

  while (true) {
    const line = layoutNextLine(prepared as Parameters<typeof layoutNextLine>[0], cursor, width)
    if (line === null) break
    lines.push(line)
    cursor = line.end
  }

  return lines
}

function collectStreamedLinesWithWidths(
  prepared: TestPreparedTextWithSegments,
  widths: number[],
  start: TestLayoutCursor = { segmentIndex: 0, graphemeIndex: 0 },
): TestLayoutLine[] {
  const lines: TestLayoutLine[] = []
  let cursor = { ...start }
  let widthIndex = 0

  while (true) {
    const width = widths[widthIndex]
    if (width === undefined) {
      throw new Error('collectStreamedLinesWithWidths requires enough widths to finish the paragraph')
    }

    const line = layoutNextLine(prepared as Parameters<typeof layoutNextLine>[0], cursor, width)
    if (line === null) break
    lines.push(line)
    cursor = line.end
    widthIndex++
  }

  return lines
}

function reconstructFromWalkedRanges(
  prepared: TestPreparedTextWithSegments,
  width: number,
): string {
  const slices: string[] = []
  walkLineRanges(prepared as Parameters<typeof walkLineRanges>[0], width, line => {
    slices.push(slicePreparedText(prepared, line.start, line.end))
  })
  return slices.join('')
}

function compareCursors(a: TestLayoutCursor, b: TestLayoutCursor): number {
  if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex
  return a.graphemeIndex - b.graphemeIndex
}

function terminalCursor(prepared: TestPreparedTextWithSegments): TestLayoutCursor {
  return { segmentIndex: prepared.segments.length, graphemeIndex: 0 }
}

class TestCanvasRenderingContext2D {
  font = ''

  measureText(text: string): { width: number } {
    canvasMeasurementCount++
    return { width: measureWidth(text, this.font) }
  }
}

class TestOffscreenCanvas {
  constructor(_width: number, _height: number) {}

  getContext(_kind: string): TestCanvasRenderingContext2D {
    return new TestCanvasRenderingContext2D()
  }
}

beforeAll(async () => {
  Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
  const [mod, lineBreakMod, measurementMod, richInlineMod, analysisMod, lineBreaksMod] = await Promise.all([
    import('./layout.ts'),
    import('./line-break.ts'),
    import('./measurement.ts'),
    import('./rich-inline.ts'),
    import('./analysis.ts'),
    import('./line-breaks.ts'),
  ])
  ;({
    prepare,
    prepareWithSegments,
    layout,
    layoutWithLines,
    layoutNextLine,
    layoutNextLineRange,
    materializeLineRange,
    measureLineStats,
    measureNaturalWidth,
    walkLineRanges,
    setLocale,
    clearCache,
  } = mod)
  ;({ countPreparedLines, measurePreparedLineGeometry, stepPreparedLineGeometry, walkPreparedLinesRaw, SPACED } = lineBreakMod)
  ;({ getSegmentBreakableFitAdvances, getEngineProfile } = measurementMod)
  ;({ analyzeText } = analysisMod)
  ;({ getBlinkLineBreaks } = lineBreaksMod)
  ;({ prepareRichInline, layoutNextRichInlineLineRange, materializeRichInlineLineRange, measureRichInlineStats, walkRichInlineLineRanges } = richInlineMod)
  variant = createVariant('unit', mod, richInlineMod)
})

beforeEach(() => {
  // Retargeting the locale also clears the shared caches.
  setLocale(undefined)
})

describe('shared public contracts', () => {
  test('source coverage permits newline ownership gaps but retains preserved spaces, tabs, and visible text', async () => {
    const api = await import('./layout.ts')
    const omitted = createVariant('omitted-source', {
      ...api,
      layoutWithLines(...args: Parameters<typeof api.layoutWithLines>) {
        const result = api.layoutWithLines(...args)
        // Return the first rendering range through only its initial "a".
        // The next line still starts after the explicit newline.
        const firstSegmentLength = getSegmentGraphemes(args[0].segments[0]!).length
        result.lines[0]!.end = firstSegmentLength === 1
          ? { segmentIndex: 1, graphemeIndex: 0 }
          : { segmentIndex: 0, graphemeIndex: 1 }
        return result
      },
    })
    for (const gap of ['\n', ' \n', '\t\n', 'X\n']) {
      const result = omitted.predict({
        id: 'unit-source-coverage', family: 'api', origins: ['maintained'], scope: 'supported',
        text: `a${gap}b`, whiteSpace: 'pre-wrap', font: FONT, width: 100, lineHeight: LINE_HEIGHT,
        wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
      })
      if (result.detail !== 'full') throw new Error('Expected full public contract checks')
      expect(result.contracts.some(failure => failure.contract === 'source-coverage/source-coverage')).toBe(gap !== '\n')
      expect(result.diagnostics.some(failure => failure.contract === 'source-conservation')).toBe(true)
    }
  })

  test('interrupted contract groups cannot report their partial checks as passes', async () => {
    const api = await import('./layout.ts')
    for (const interruption of ['throw', 'stalled']) {
      let calls = 0
      const interrupted = createVariant('interrupted', {
        ...api,
        layoutNextLine(...args: Parameters<typeof api.layoutNextLine>) {
          if (interruption === 'throw' && ++calls > 1) throw new Error('Interrupted test adapter')
          const line = api.layoutNextLine(...args)
          return line === null ? null : {
            ...line, width: line.width + 1,
            end: interruption === 'stalled' ? { ...args[1] } : line.end,
          }
        },
      })
      const result = interrupted.predict({
        id: 'unit-interrupted-contracts', family: 'api', origins: ['maintained'], scope: 'supported',
        text: 'a b c', whiteSpace: 'normal', font: FONT, width: 20, lineHeight: LINE_HEIGHT,
        wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
      })
      if (result.detail !== 'full') throw new Error('Expected full public contract checks')
      expect(result.contracts.some(failure => failure.contract === 'fixed-stream/completion')).toBe(true)
      expect(result.contracts.some(failure => failure.contract === 'fixed-stream/stream-range-agreement')).toBe(true)
      expect(result.passedContracts.some(contract => contract.startsWith('fixed-stream/'))).toBe(false)
      expect(result.passedContracts).toContain('batch-result')
    }
  })

  test('fixed and variable-width APIs preserve source and copied range behavior', () => {
    for (const [text, whiteSpace] of [
      ['a b c', 'normal'],
      ['foo trans\u00ADatlantic', 'normal'],
      ['foo\n\tbar baz\n', 'pre-wrap'],
      ['e\u0301 🌍 test', 'normal'],
    ] as const) {
      const result = variant.predict({
        id: 'unit-contracts', family: 'api', origins: ['maintained'], scope: 'supported',
        text, whiteSpace, font: FONT, width: 64, lineHeight: LINE_HEIGHT,
        wordBreak: 'normal', letterSpacing: 0, direction: 'ltr', locale: '',
      })
      if (result.detail !== 'full') throw new Error('Expected full public contract checks')
      expect(result.contracts).toEqual([])
    }
  })

  test('a ZWSP-only paragraph retains one line and its complete source range', () => {
    for (const [text, whiteSpace, letterSpacing] of [
      ['\u200B', 'normal', 0],
      ['\u200B\u200B', 'pre-wrap', -1],
      ['\u200B\u200B', 'normal', 1],
    ] as const) for (const width of [0, 100]) {
      const result = variant.predict({
        id: 'unit-standalone-zwsp', family: 'api', origins: ['maintained'], scope: 'supported',
        text, whiteSpace, font: FONT, width, lineHeight: LINE_HEIGHT,
        wordBreak: 'normal', letterSpacing, direction: 'ltr',
      })
      if (result.detail !== 'full') throw new Error('Expected full public contract checks')
      expect(result.lineCount).toBe(1)
      expect(result.height).toBe(LINE_HEIGHT)
      expect(result.lines[0]!.text).toBe(text)
      expect(result.lines[0]!.width).toBe(0)
      expect(result.lines[0]!.sourceStart).toBe(0)
      expect(result.lines[0]!.sourceEnd).toBe(text.length)
      expect(result.contracts).toEqual([])
      expect(result.diagnostics).toEqual([])
    }
  })

  test('a selected soft-hyphen threshold preserves every public line API', () => {
    // The threshold leaves room for a hyphen plus one suffix grapheme, but
    // selecting SHY must still end this line at the discretionary boundary.
    const width = measureWidth('foo transa-', FONT) + 0.1
    const result = variant.predict({
      id: 'unit-selected-shy', family: 'api', origins: ['maintained'], scope: 'supported',
      text: 'foo trans\u00ADatlantic said "hello" to 世界 and waved.',
      whiteSpace: 'normal', font: FONT, width, lineHeight: LINE_HEIGHT,
      wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
    })
    if (result.detail !== 'full') throw new Error('Expected full public contract checks')
    expect(result.lines[0]!.text).toBe('foo trans-')
    expect(result.contracts).toEqual([])
  })

  test('public contracts detect lost line metadata even when text and cursors agree', async () => {
    const api = await import('./layout.ts')
    const inconsistent = createVariant('inconsistent-line-metadata', {
      ...api,
      layoutWithLines(...args: Parameters<typeof api.layoutWithLines>) {
        const result = api.layoutWithLines(...args)
        return { ...result, lines: result.lines.map(line => ({ ...line, selectedMarker: null })) }
      },
    })
    const result = inconsistent.predict({
      id: 'unit-line-metadata', family: 'api', origins: ['maintained'], scope: 'supported',
      text: 'a\nb', whiteSpace: 'pre-wrap', font: FONT, width: 64, lineHeight: LINE_HEIGHT,
      wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
    })
    if (result.detail !== 'full') throw new Error('Expected full public contract checks')
    expect(result.contracts.some(failure => failure.contract === 'fixed-stream/fixed-stream')).toBe(true)
  })

  test('maintained height observations retain the rich prepare/layout route', async () => {
    const api = await import('./layout.ts')
    const richHandles = new WeakSet<object>()
    const observed = createVariant('height-source', {
      ...api,
      prepareWithSegments(...args: Parameters<typeof api.prepareWithSegments>) {
        const prepared = api.prepareWithSegments(...args)
        richHandles.add(prepared)
        return prepared
      },
      layout(...args: Parameters<typeof api.layout>) {
        return { ...api.layout(...args), height: richHandles.has(args[0]) ? 111 : 222 }
      },
    })
    const input: Parameters<typeof observed.predict>[0] = {
      id: 'unit-height-source', family: 'api', origins: ['maintained'], scope: 'supported',
      text: 'abc', whiteSpace: 'normal', font: FONT, width: 100, lineHeight: LINE_HEIGHT,
      wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
    }
    const full = observed.predict({ ...input, heightSource: 'layout' })
    if (full.detail !== 'full') throw new Error('Expected full public contract checks')
    expect(full.height).toBe(LINE_HEIGHT)
    expect(full.countedHeight).toBe(111)
    expect(observed.predict({ ...input, detail: 'height', heightSource: 'layout' }).height).toBe(111)
    expect(observed.predict({ ...input, detail: 'height' }).height).toBe(222)
  })

  test('one prepared group preserves standalone results across widths', () => {
    for (const detail of ['height', 'full'] as const) {
      const input: Parameters<typeof variant.predict>[0] = {
        id: 'unit-prepared-group', family: 'api', origins: ['maintained'], scope: 'supported',
        text: 'foo trans\u00ADatlantic\n\tbar e\u0301', whiteSpace: 'pre-wrap',
        font: FONT, width: 100, lineHeight: LINE_HEIGHT, detail, heightSource: 'layout',
        wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
      }
      const predict = variant.prepare(input)
      const measurements = canvasMeasurementCount
      const cases = [30, 80, 160].map(width => ({ ...input, width }))
      const grouped = cases.map(predict)
      expect(canvasMeasurementCount).toBe(measurements)
      expect(grouped).toEqual(cases.map(value => variant.predict(value)))
    }
  })

  test('grouped predictions inspect normalized source after each layout', async () => {
    const api = await import('./layout.ts')
    const observed = createVariant('mutated-source', {
      ...api,
      layoutWithLines(...args: Parameters<typeof api.layoutWithLines>) {
        const result = api.layoutWithLines(...args)
        args[0].segments[0] = 'z'
        return result
      },
    })
    const input: Parameters<typeof observed.predict>[0] = {
      id: 'unit-source-observation', family: 'api', origins: ['maintained'], scope: 'supported',
      text: 'a', whiteSpace: 'normal', font: FONT, width: 100, lineHeight: LINE_HEIGHT,
      wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
    }
    const result = observed.prepare(input)(input)
    if (result.detail !== 'full') throw new Error('Expected full public contract checks')
    expect(result.contracts.some(failure => failure.contract === 'source-normalization')).toBe(true)
  })

  test('numeric layout APIs do not measure text after preparation', () => {
    const text = 'foo trans\u00ADatlantic 世界\n\tbar'
    const options = { whiteSpace: 'pre-wrap' } as const
    const opaque = prepare(text, FONT, options)
    const rich = prepareWithSegments(text, FONT, options)
    const before = canvasMeasurementCount
    for (const width of [30, 80, 160]) {
      layout(opaque, width, LINE_HEIGHT)
      measureLineStats(rich, width)
      walkLineRanges(rich, width, () => {})
      layoutNextLineRange(rich, { segmentIndex: 0, graphemeIndex: 0 }, width)
    }
    expect(canvasMeasurementCount).toBe(before)
  })

  test('emergency wrapping preserves complete graphemes inside continuous words', () => {
    for (const cluster of ['e\u0301', '👩‍💻', '👍🏽', 'क्ष']) {
      expect(getSegmentGraphemes(cluster)).toHaveLength(1)
      for (const text of [cluster, `a${cluster}b`]) {
        const result = variant.predict({
          id: 'unit-emergency-graphemes', family: 'emergency-graphemes', origins: ['maintained'], scope: 'supported',
          text, whiteSpace: 'normal', font: FONT, width: 1, lineHeight: LINE_HEIGHT,
          wordBreak: 'normal', letterSpacing: 0, direction: 'ltr', emergencyGraphemes: true,
        })
        if (result.detail !== 'full') throw new Error('Expected full public contract checks')
        expect(result.contracts).toEqual([])
      }
    }
  })
})

describe('boundary-policy regressions', () => {
  const baseProfile = {
    lineBreakScan: 'blink' as const,
    graphemeTable: 'chromium/char' as const,
  }
  const geckoProfile = { ...baseProfile, lineBreakScan: 'gecko' as const }

  test('independent symbols use grapheme overflow without splitting attached marks', () => {
    for (const text of ['||||', '|\u0301|\u0301']) {
      const clusters = getSegmentGraphemes(text)
      const width = measureWidth(clusters[0]!, FONT) + 0.1
      const prepared = prepareWithSegments(text, FONT)
      const lines = layoutWithLines(prepared, width, LINE_HEIGHT).lines
      expect(lines.map(line => line.text)).toEqual(clusters)
      expect(collectStreamedLines(prepared, width)).toEqual(lines)
      expect(layout(prepare(text, FONT), width, LINE_HEIGHT).lineCount).toBe(clusters.length)
    }
  })

  test('the Gecko profile keeps ASCII openers with the text after them', () => {
    // As the Gecko break oracle answers, ICU4X keeps an opener after other ASCII
    // punctuation, but breaks between the numeric prefixes U+2212 and `+` (PR).
    for (const [text, expected] of [
      ['####((aabb', ['####((aabb']],
      ['""""[[aabb', ['""""[[aabb']],
      ['−+x«value»!', ['−', '+x«value»!']],
    ] as const) {
      expect(analyzeText(text, geckoProfile).texts).toEqual([...expected])
    }
  })

  test('the Gecko profile takes a soft hyphen at a normal break as a zero-width break', () => {
    const kinds = (text: string) => {
      const analysis = analyzeText(text, geckoProfile)
      return analysis.texts.map((segment, i) => [segment, analysis.kinds[i]])
    }
    // Ideographs break before Latin letters, so no hyphen is drawn or fitted there.
    expect(kinds('漢字\u00ADabc')).toEqual([['漢', 'text'], ['字', 'text'], ['\u00AD', 'zero-width-break'], ['abc', 'text']])
    expect(kinds('ab\u00AD漢')).toEqual([['ab', 'text'], ['\u00AD', 'zero-width-break'], ['漢', 'text']])
    // Inside a Latin word the soft hyphen is the only break and keeps its hyphen.
    expect(kinds('cd\u00ADef')).toEqual([['cd', 'text'], ['\u00AD', 'soft-hyphen'], ['ef', 'text']])
    // After a space the break is normal too, but a soft hyphen that starts the text or a pre-wrap
    // line stays one, as a zero-width break there would hold a line.
    expect(kinds('ab \u00ADcd')).toEqual([['ab', 'text'], [' ', 'space'], ['\u00AD', 'zero-width-break'], ['cd', 'text']])
    expect(kinds(' \u00ADcd')[0]).toEqual(['\u00AD', 'soft-hyphen'])
    expect(kinds(' \u00AD\u00ADcd').map(([, kind]) => kind)).toEqual(['soft-hyphen', 'text'])
    const preWrap = analyzeText('ab\n\u00ADcd', geckoProfile, 'pre-wrap')
    expect(preWrap.kinds).toEqual(['text', 'hard-break', 'soft-hyphen', 'text'])
  })

  test('the Gecko profile removes a newline between East Asian characters', () => {
    const normalized = (text: string, profile: AnalysisProfile, language: string | null = null) =>
      analyzeText(text, profile, 'normal', 'normal', language).normalized
    // Between two wide characters other than Hangul, past default-ignorables.
    expect(normalized('中文\n中文', geckoProfile)).toBe('中文中文')
    expect(normalized('中文 \n \u00AD中文', geckoProfile)).toBe('中文\u00AD中文')
    expect(normalized('中\n\u{20000}', geckoProfile)).toBe('中\u{20000}')
    expect(normalized('한\n한', geckoProfile)).toBe('한 한')
    expect(normalized('中\nabc', geckoProfile)).toBe('中 abc')
    // Next to East Asian punctuation only on a ja or zh page.
    expect(normalized('abc\n「中文」', geckoProfile, 'ja')).toBe('abc「中文」')
    expect(normalized('abc\n「中文」', geckoProfile, 'en')).toBe('abc 「中文」')
    expect(normalized('中文　\nabc', geckoProfile, 'zh-Hant')).toBe('中文　abc')
    // Blink and WebKit keep the space.
    expect(normalized('中文\n中文', baseProfile)).toBe('中文 中文')
    expect(normalized('中文\n中文', { ...baseProfile, lineBreakScan: 'webkit' })).toBe('中文 中文')
  })

  test('exclamation punctuation keeps the break browsers offer before a word', () => {
    const profile = baseProfile
    // The ASCII pair tables keep '!' with a following ASCII letter, and break
    // '?' before '-' and '|'. UAX #14 otherwise separates EX from any
    // following class that allows a break before it (LB31).
    for (const [text, expected] of [
      ['\u200B?ab', ['\u200B', '?', 'ab']],
      ['\u200B!ab', ['\u200B', '!ab']],
      ['x!\u00E9b', ['x!', '\u00E9b']],
      ['\u200B!\u0430b', ['\u200B', '!', '\u0430b']],
      ['\u200B?#ab', ['\u200B', '?', '#ab']],
      ['?_ab', ['?', '_ab']],
      ['\u200B\u061F\u0628\u0628', ['\u200B', '\u061F', '\u0628\u0628']],
      ['x?$b', ['x?', '$b']],
      ['x?-b', ['x?', '-', 'b']],
      ['x?|b', ['x?', '|b']],
      ['x!\u00A9b', ['x!', '\u00A9b']],
      ['x!\u00ABb', ['x!\u00ABb']],
      ['\u0628\u061B\u0628\u0628', ['\u0628\u061B', '\u0628\u0628']],
    ] as const) {
      expect(analyzeText(text, profile).texts).toEqual([...expected])
    }
    expect(analyzeText('x?-b', geckoProfile).texts).toEqual(['x?-', 'b'])
    // Iteration marks are NS and stay after EX. CJ such as U+30FC starts a line
    // under Chromium's normal rules, and not under Gecko's strict rules.
    expect(analyzeText('\u65E5\uFF01\u3005', profile).texts).toEqual(['\u65E5\uFF01\u3005'])
    expect(analyzeText('\u65E5\uFF1F\u30FC', profile).texts).toEqual(['\u65E5\uFF1F', '\u30FC'])
    expect(analyzeText('\u65E5\uFF1F\u30FC', geckoProfile).texts).toEqual(['\u65E5\uFF1F\u30FC'])
  })

  test('closing punctuation and nonstarters stay with the text before them (#225)', () => {
    // No break precedes CL, CP, EX, IS or NS, whatever comes before it (UAX #14
    // LB13, LB21). Chrome, Safari and Firefox keep the mark with a word or a number
    // until only the word fits an empty line.
    const lines = (text: string, width: number) =>
      layoutWithLines(prepareWithSegments(text, FONT), width, LINE_HEIGHT).lines.map(line => line.text.trimEnd())
    for (const word of ['xxxx', '1234']) {
      for (const mark of ['，', '」', '：', '。', '）', '！', '？', '、', '」。']) {
        const text = `a ${word}${mark}b`
        expect(lines(text, measureWidth(`${word}${mark}`, FONT) + 0.1)).toEqual(['a', `${word}${mark}`, 'b'])
        // Half a mark wider than the word, which an emergency fill of the digits needs.
        const narrow = lines(text, measureWidth(word, FONT) + measureWidth(mark[0]!, FONT) / 2)
        expect(narrow.slice(0, 2)).toEqual(['a', word])
        expect(narrow.join('')).toBe(`a${word}${mark}b`)
      }
    }
    // The mark stays with the whole unit before it, and a space or zero-width space
    // still separates it from the text before.
    for (const [text, expected] of [
      ['a 00:00:00：b', ['a', ' ', '00:00:00：', 'b']],
      ['(10:30)，b', ['(10:30)，', 'b']],
      ['foo@bar.com，b', ['foo@bar.com，', 'b']],
      ['x“value”，b', ['x“value”，', 'b']],
      ['x?，b', ['x?，', 'b']],
      ['abcヽカ', ['abcヽ', 'カ']],
      ['中（ابب） ', ['中', '（ابب） ']],
      ['a ，b', ['a', ' ', '，', 'b']],
      ['a​，b', ['a', '​', '，', 'b']],
    ] as const) {
      expect(prepareWithSegments(text, FONT).segments).toEqual([...expected])
    }
    // The opener starts a unit with the text after it.
    const bracket = '739x「value」! end'
    expect(prepareWithSegments(bracket, FONT).segments).toEqual(['739x', '「value」!', ' ', 'end'])
    expect(lines(bracket, measureWidth('「value」!', FONT) + 0.1)).toEqual(['739x', '「value」!', 'end'])
    expect(lines(bracket, measureWidth('「value', FONT) + 0.1)).toEqual(['739x', '「value', '」! end'])
    // An overlong unit still breaks between graphemes.
    expect(lines('abc」。d', measureWidth('c」', FONT) + 0.1)).toEqual(['ab', 'c」', '。d'])
    // Firefox breaks at the end of a run of complex-script letters, whatever follows.
    const khmer = 'a ខ\u17D2ម\u17C2រ，b'
    expect(analyzeText(khmer, baseProfile).texts).toEqual(['a', ' ', 'ខ\u17D2ម\u17C2រ，', 'b'])
    expect(analyzeText(khmer, geckoProfile).texts).toEqual(['a', ' ', 'ខ\u17D2ម\u17C2រ', '，', 'b'])
    // Firefox splits text runs where the script changes, which would break before the
    // Bengali letter here. The Gecko scan doesn't, on purpose (RESEARCH.md, Decisions Log).
    expect(analyzeText('\u1019\u17D2\u09AF', geckoProfile).texts).toEqual(['\u1019\u17D2\u09AF'])
  })

  test('small kana and U+30FC stay with the text before them where the profile resolves them to NS', () => {
    const profile = getEngineProfile()
    const previous = { ...profile }
    const segments = (text: string) => prepareWithSegments(text, FONT).segments.join('|')
    const texts = ['a xxxxーb', '約3ヶ月', '日本abcァア']
    try {
      // Chromium's normal line rules, on every page.
      expect(texts.map(text => segments(text))).toEqual(['a| |xxxx|ー|b', '約|3|ヶ|月', '日|本|abc|ァ|ア'])
      // libicucore's strict rules, on pages other than ja and ko.
      profile.lineBreakScan = 'webkit'
      expect(texts.map(text => segments(text))).toEqual(['a| |xxxxー|b', '約|3ヶ|月', '日|本|abcァ|ア'])
      // Gecko's strict rules.
      profile.lineBreakScan = 'gecko'
      expect(texts.map(text => segments(text))).toEqual(['a| |xxxxー|b', '約|3ヶ|月', '日|本|abcァ|ア'])
    } finally {
      Object.assign(profile, previous)
    }
  })

  test('the Gecko profile keeps a hyphen with the number after it', () => {
    const gecko = geckoProfile
    // ICU4X keeps a hyphen-minus (HY) with a following number (NU), ASCII or not
    // (LB25): Firefox moves `log-2026` to the next line whole and breaks
    // `crash-log-2026-09-12.txt` only after `crash-`. Blink's pair table breaks `-`
    // before an ASCII digit after a letter or digit.
    for (const [text, expected] of [
      ['log-2026', ['log-2026']],
      ['crash-log-2026-09-12.txt', ['crash-', 'log-2026-09-12.txt']],
      ['2025-08-01 00:00:00\uFF0C2025-08-01 00:00:00', ['2025-08-01', ' ', '00:00:00\uFF0C', '2025-08-01', ' ', '00:00:00']],
      ['n2-1o(r)', ['n2-1o(r)']],
      ['x--1', ['x--1']],
      ['a-\u0661\u0662', ['a-\u0661\u0662']],
    ] as const) {
      expect(analyzeText(text, gecko).texts).toEqual([...expected])
    }
    expect(analyzeText('crash-log-2026-09-12.txt', baseProfile).texts).toEqual(['crash-', 'log-', '2026-', '09-', '12.txt'])
    expect(analyzeText('log-2026', gecko, 'normal', 'keep-all').texts).toEqual(['log-2026'])
    expect(analyzeText('a 2025-08-01', gecko, 'pre-wrap').texts).toEqual(['a', ' ', '2025-08-01'])
    // Fullwidth digits are ID, and U+2010 and U+2013 aren't HY, so the pair
    // doesn't apply; Firefox still breaks there, as before a letter or `+`.
    for (const text of ['a-\uFF11\uFF12', 'a\u20101', 'a\u20131', 'x-y', '1-+2']) {
      expect(analyzeText(text, gecko).texts).toEqual(analyzeText(text, baseProfile).texts)
    }
  })

  test('the Gecko profile breaks after a slash before a letter', () => {
    const gecko = geckoProfile
    // ICU4X breaks after `/` (SY) wherever UAX #14 allows it, before a letter of
    // any script, an opener or `#`: Firefox paints `https:// | example.com` and
    // `example.com/ | docs`, and ends an overflowing unit's line there. It also
    // breaks after `|` (BA).
    for (const [text, expected] of [
      ['https://example.com/docs?a=b', ['https://', 'example.com/', 'docs?', 'a=b']],
      ['and/or', ['and/', 'or']],
      ['~/src/layout.ts', ['~/', 'src/', 'layout.ts']],
      ['a//b', ['a//', 'b']],
      ['a/(b)', ['a/', '(b)']],
      ['a/#b', ['a/', '#b']],
      ['a/\u0301b', ['a/\u0301', 'b']],
      ['a/\u0639\u0631\u0628\u064a', ['a/', '\u0639\u0631\u0628\u064a']],
      ['a/\u0e44\u0e17\u0e22', ['a/', '\u0e44\u0e17\u0e22']],
      ['https://example.com/2026/09/docs', ['https://', 'example.com/2026/09/', 'docs']],
      // No break before `/` after CJK text either (LB13).
      ['\u6f22/abc', ['\u6f22/', 'abc']],
      ['a/|b', ['a/|', 'b']],
    ] as const) {
      expect(analyzeText(text, gecko).texts).toEqual([...expected])
    }
    // The pair tables of Chromium and WebKit keep `/` with an ASCII letter.
    for (const text of ['https://example.com/2026/09/docs', 'and/or', '~/src/layout.ts', 'a//b', 'a/(b)', 'a/#b', 'a/|b', '\u6f22/abc']) {
      expect(analyzeText(text, baseProfile).texts).toEqual([text])
    }
    expect(analyzeText('and/or', gecko, 'normal', 'keep-all').texts).toEqual(['and/', 'or'])
    expect(analyzeText('\u6f22/abc', gecko, 'normal', 'keep-all').texts).toEqual(['\u6f22/', 'abc'])
    expect(analyzeText('a src/layout.ts', gecko, 'pre-wrap').texts).toEqual(['a', ' ', 'src/', 'layout.ts'])
    // No break before a quote, IS, BA, a Hebrew letter (LB21b) or a number (LB25).
    for (const text of ['a/"b"', 'a/.b', 'a/\u05e2\u05d1\u05e8', '1/2', 'a/1', 'docs/']) {
      expect(analyzeText(text, gecko).texts).toEqual(analyzeText(text, baseProfile).texts)
    }
  })

  test('a mark after CJK text stays with it, and each engine keeps the text after the mark as its pair rules do (#293)', () => {
    const blink = { ...baseProfile, lineBreakScan: 'blink' as const }
    const webkit = { ...baseProfile, lineBreakScan: 'webkit' as const }
    const gecko = geckoProfile
    // No engine breaks before these marks after CJK text (LB13, LB19, LB21). Blink's
    // pair table keeps an ASCII mark with an ASCII letter or digit, except `?`.
    // WebKit's table decides before a digit, and ICU before a letter where the mark
    // follows a character that reached ICU; CL and CP after an ideograph or Hangul
    // syllable skip ICU. Gecko follows UAX #14.
    for (const [text, blinkTexts, webkitTexts, geckoTexts] of [
      ["\u4e19'first", ["\u4e19'first"], ["\u4e19'first"], ["\u4e19'first"]],
      ['\u4e19/first', ['\u4e19/first'], ['\u4e19/', 'first'], ['\u4e19/', 'first']],
      ['\u4e19|first', ['\u4e19|first'], ['\u4e19|', 'first'], ['\u4e19|', 'first']],
      ['\u4e19!first', ['\u4e19!first'], ['\u4e19!', 'first'], ['\u4e19!', 'first']],
      ['\u4e19}first', ['\u4e19}first'], ['\u4e19}first'], ['\u4e19}', 'first']],
      ['\ub2e4}first', ['\ub2e4}first'], ['\ub2e4}first'], ['\ub2e4}', 'first']],
      ['\u3046}first', ['\u3046}first'], ['\u3046}', 'first'], ['\u3046}', 'first']],
      ['\u4e19|1234', ['\u4e19|1234'], ['\u4e19|1234'], ['\u4e19|', '1234']],
      ['\u4e19!1234', ['\u4e19!1234'], ['\u4e19!1234'], ['\u4e19!', '1234']],
      ['\u4e19/1234', ['\u4e19/1234'], ['\u4e19/1234'], ['\u4e19/1234']],
      // The table decides the pair after a mark that follows another mark.
      ['\u4e19.!first', ['\u4e19.!first'], ['\u4e19.!first'], ['\u4e19.!', 'first']],
      ['\u4e19?first', ['\u4e19?', 'first'], ['\u4e19?', 'first'], ['\u4e19?', 'first']],
      ['\u4e19}\u03b1\u03b2', ['\u4e19}', '\u03b1\u03b2'], ['\u4e19}', '\u03b1\u03b2'], ['\u4e19}', '\u03b1\u03b2']],
      ["\u4e19'\u03b1\u03b2", ["\u4e19'\u03b1\u03b2"], ["\u4e19'\u03b1\u03b2"], ["\u4e19'\u03b1\u03b2"]],
    ] as const) {
      expect(analyzeText(text, blink).texts).toEqual([...blinkTexts])
      expect(analyzeText(text, webkit).texts).toEqual([...webkitTexts])
      expect(analyzeText(text, gecko).texts).toEqual([...geckoTexts])
    }
    // Punctuation attaches by its class, such as NS and PO, and a hyphen keeps its
    // own rules.
    for (const [text, expected] of [
      ['\u4e19\u203cfirst', ['\u4e19\u203c', 'first']],
      ['\u6587\uff05\u6587', ['\u6587\uff05', '\u6587']],
      ['\u4e19-first', ['\u4e19-', 'first']],
    ] as const) {
      expect(analyzeText(text, baseProfile).texts).toEqual([...expected])
    }
  })

  test('ZWJ and a word-initial hyphen keep the following character', () => {
    const profile = baseProfile
    // UAX #14 LB8a and LB20a. The pair tables still break '-' before an ASCII letter,
    // and Firefox's ICU4X rules predate LB20a.
    expect(analyzeText('\u200Dab', profile).texts).toEqual(['\u200Dab'])
    expect(analyzeText('a\n\u200Db', profile, 'pre-wrap').texts).toEqual(['a', '\n', '\u200Db'])
    expect(analyzeText('x \u{1F600}\u200Db', profile).texts).toEqual(['x', ' ', '\u{1F600}\u200Db'])
    expect(analyzeText('a \u2010b', profile).texts).toEqual(['a', ' ', '\u2010b'])
    expect(analyzeText('a -b', profile).texts).toEqual(['a', ' ', '-', 'b'])
    // WebKit's scan still reads a collapsed TAB (BA) before the hyphen.
    expect(analyzeText('a\t\u2010b', profile).texts).toEqual(['a', ' ', '\u2010b'])
    expect(analyzeText('a\t\u2010b', { ...profile, lineBreakScan: 'webkit' }).texts)
      .toEqual(['a', ' ', '\u2010', 'b'])
    expect(analyzeText('a \u2010b', geckoProfile).texts).toEqual(['a', ' ', '\u2010', 'b'])
    // HL letters keep it too, and so do the other Unicode 17 HH dashes, astral ones included.
    const hebrewProfile = profile
    const noneProfile = geckoProfile
    expect(analyzeText('a \u2010\u05D1b', hebrewProfile).texts).toEqual(['a', ' ', '\u2010\u05D1b'])
    expect(analyzeText('a \u2012b', hebrewProfile).texts).toEqual(['a', ' ', '\u2012b'])
    expect(analyzeText('a \u2013\u05D1b', hebrewProfile).texts).toEqual(['a', ' ', '\u2013\u05D1b'])
    for (const text of ['a \u05BE\u05D1b', 'a \u1400b', 'a \u{10EAD}\u0430b']) {
      expect(analyzeText(text, hebrewProfile).texts).toEqual(['a', ' ', text.slice(2)])
    }
    expect(analyzeText('a \u2013b', noneProfile).texts).toEqual(['a', ' ', '\u2013', 'b'])
    // WebKit's scan reads the source, where a collapsed TAB is still BA, and Gecko's
    // has no LB20a, so both break after every hyphen that follows one.
    const tabProfile = { ...hebrewProfile, lineBreakScan: 'webkit' as const }
    expect(analyzeText('x-y  \t\u2012b  \u2013b', tabProfile).texts)
      .toEqual(['x-', 'y', ' ', '\u2012', 'b', ' ', '\u2013b'])
    for (const text of ['a\t\u05BEb', 'a\t\u{10EAD}b']) {
      for (const breakingProfile of [tabProfile, noneProfile]) {
        expect(analyzeText(text, breakingProfile).texts).toEqual(['a', ' ', text.slice(2, -1), 'b'])
      }
      expect(analyzeText(text, hebrewProfile).texts).toEqual(['a', ' ', text.slice(2)])
    }
  })

  test('a ZWSP that starts a WebKit scan keeps a basic combining mark', () => {
    const profile = { ...baseProfile, lineBreakScan: 'webkit' as const }
    const segments = (text: string, whiteSpace?: 'pre-wrap') => {
      const analysis = analyzeText(text, profile, whiteSpace)
      return analysis.texts.map((segment, i) => `${segment}:${analysis.kinds[i]}`)
    }
    // The ZWSP stays its own zero-width segment, with no break after it, and the
    // mark after it stays apart from the letters.
    expect(segments('\u200B\u0301ab')).toEqual(['\u200B:zero-width-glue', '\u0301:text', 'ab:text'])
    expect(segments('x\n\u200B\u0301ab', 'pre-wrap')).toEqual(['x:text', '\n:hard-break', '\u200B:zero-width-glue', '\u0301:text', 'ab:text'])
    // Source before the ZWSP, even a collapsed leading space, is prior context.
    expect(segments(' \u200B\u0301ab')).toEqual(['\u200B:zero-width-break', '\u0301ab:text'])
    expect(segments('x\u200B\u0301ab')).toEqual(['x:text', '\u200B:zero-width-break', '\u0301ab:text'])
  })

  test('a soft hyphen or ZWSP the scan does not break after stays its own zero-width segment', () => {
    const blink = { ...baseProfile, lineBreakScan: 'blink' as const }
    const webkit = { ...baseProfile, lineBreakScan: 'webkit' as const }
    const segments = (text: string, profile: Parameters<typeof analyzeText>[1], whiteSpace?: 'pre-wrap', wordBreak?: 'keep-all') => {
      const analysis = analyzeText(text, profile, whiteSpace, wordBreak)
      return analysis.texts.map((segment, i) => `${segment}:${analysis.kinds[i]}`)
    }
    // No break between a soft hyphen and a combining mark or a closing bracket, or
    // between a ZWSP and a mark, so neither breaks like its kind; each stays apart
    // instead of joining the text after it.
    for (const profile of [blink, webkit]) {
      expect(segments('a\u00AD\u0301\u00AD\u0323b', profile, 'pre-wrap')).toEqual(['a:text', '\u00AD:zero-width-glue', '\u0301:text', '\u00AD:zero-width-glue', '\u0323:text', 'b:text'])
      expect(segments('ab\u00AD)cd', profile)).toEqual(['ab:text', '\u00AD:zero-width-glue', ')cd:text'])
      expect(segments('a\u00AD\u3000b', profile)).toEqual(['a:text', '\u00AD:zero-width-glue', '\u3000:text', 'b:text'])
      // A break follows a ZWSP even before a mark (LB8), and none precedes it (LB7).
      expect(segments('a\u00AD\u200B\u0301b', profile)).toEqual(['a:text', '\u00AD:soft-hyphen', '\u200B:zero-width-break', '\u0301b:text'])
      expect(segments('a\u200B\u00AD\u0301b', profile)).toEqual(['a:text', '\u200B:zero-width-break', '\u00AD:zero-width-glue', '\u0301:text', 'b:text'])
      // A break after the soft hyphen or ZWSP keeps its kind, as does one before a
      // space or a hard break, where the line can still end.
      expect(segments('ab\u00ADcd', profile)).toEqual(['ab:text', '\u00AD:soft-hyphen', 'cd:text'])
      expect(segments('a\u200B\u200Bb', profile)).toEqual(['a:text', '\u200B:zero-width-break', '\u200B:zero-width-break', 'b:text'])
      expect(segments('a\u00AD b\u00AD\nc\u00AD', profile, 'pre-wrap')).toEqual(['a:text', '\u00AD:soft-hyphen', ' :preserved-space', 'b:text', '\u00AD:soft-hyphen', '\n:hard-break', 'c:text', '\u00AD:soft-hyphen'])
    }
    // Blink keeps letters across a ZWSP under keep-all; WebKit breaks before it.
    expect(segments('abc\u200Bd', blink, undefined, 'keep-all')).toEqual(['abc:text', '\u200B:zero-width-break', 'd:text'])
    expect(segments('a\u200B\u0301b', webkit, 'pre-wrap', 'keep-all')).toEqual(['a:text', '\u200B:zero-width-glue', '\u0301:text', 'b:text'])

    // Zero-width glue is zero-width and unmeasured, takes no letter spacing, and a
    // line neither ends at it nor draws a hyphen for it: without a break, graphemes
    // fill the line across it.
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    profile.lineBreakScan = 'blink'
    try {
      const lines = (text: string, width: number, letterSpacing = 0) => {
        const prepared = prepareWithSegments(text, FONT, { letterSpacing })
        const result = layoutWithLines(prepared, width, LINE_HEIGHT)
        expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
        expect(layout(prepare(text, FONT, { letterSpacing }), width, LINE_HEIGHT).lineCount).toBe(result.lineCount)
        return result.lines
      }
      const prepared = prepareWithSegments('ab\u00AD)cd', FONT, { letterSpacing: 2 })
      expect(prepared.kinds).toEqual(['text', 'zero-width-glue', 'text'])
      expect(prepared.widths[1]).toBe(0)
      expect(prepared.segmentFlags[1]! & SPACED).toBe(0)
      const whole = lines('ab\u00AD)cd', 1000, 2)
      expect(whole.map(line => line.text)).toEqual(['ab)cd'])
      expect(whole[0]!.width).toBeCloseTo(measureWidth('ab)cd', FONT) + 5 * 2)
      const split = lines('ab\u00AD)cd', measureWidth('ab)c', FONT), 2)
      expect(split.map(line => line.text)).toEqual(['ab)', 'cd'])
      expect(split[0]!.width).toBeCloseTo(measureWidth('ab)', FONT) + 3 * 2)
    } finally {
      profile.lineBreakScan = previous
    }
  })

  test('a control character stays its own segment on the scan path, measured alone', () => {
    const blink = { ...baseProfile, lineBreakScan: 'blink' as const }
    const webkit = { ...baseProfile, lineBreakScan: 'webkit' as const }
    for (const profile of [blink, webkit]) {
      for (const control of ['\u0000', '\u000B', '\u007F', '\u009F', '\u2028', '\u2029']) {
        const analysis = analyzeText(`ab${control}cd`, profile)
        expect(analysis.texts).toEqual(['ab', control, 'cd'])
        // WebKit's items builder makes a separator that starts an item a forced break.
        const separator = profile === webkit && control >= '\u2028'
        expect(analysis.kinds).toEqual(['text', separator ? 'hard-break' : 'text', 'text'])
        expect(analyzeText(`a${control}${control} b`, profile).texts).toEqual(['a', control, control, ' ', 'b'])
      }
    }
    // A separator that ICU's fast-forward passes stays inside a text item and ends no line.
    const passed = analyzeText('か中？\u2028b', webkit)
    expect({ texts: passed.texts, kinds: passed.kinds }).toEqual({ texts: ['か', '中？', '\u2028', 'b'], kinds: ['text', 'text', 'text', 'text'] })
    // NEL is text in the Blink profile and a control in the WebKit profile.
    expect(analyzeText('ab\u0085cd', blink).kinds).toEqual(['text', 'text', 'text'])
    expect(analyzeText('ab\u0085cd', webkit).kinds).toEqual(['text', 'control', 'text'])
  })

  test('the Gecko profile gives control characters no advance, only letter spacing', () => {
    const profile = getEngineProfile()
    const previous = profile.hidesControlCharacters
    try {
      for (const control of ['\u0000', '\u000B', '\u001C', '\u007F', '\u0085', '\u009f', '\u2028', '\u2029']) {
        profile.hidesControlCharacters = true
        clearCache()
        const hidden = prepareWithSegments(`ab${control}cd`, FONT, { letterSpacing: 2 })
        const index = hidden.segments.indexOf(control)
        expect({ control, width: hidden.widths[index], spaced: (hidden.segmentFlags[index]! & SPACED) !== 0 }).toEqual({ control, width: 0, spaced: true })
        profile.hidesControlCharacters = false
        clearCache()
        const shown = prepareWithSegments(`ab${control}cd`, FONT)
        expect(shown.widths[shown.segments.indexOf(control)]).toBe(measureWidth(control, FONT))
      }
    } finally {
      profile.hidesControlCharacters = previous
      clearCache()
    }
  })

  test('Gecko returns an unfit soft hyphen to the latest earlier break that fits', () => {
    const profile = getEngineProfile()
    const previous = [profile.lineBreakScan, profile.hidesControlCharacters, profile.unfitHyphenRetreat] as const
    try {
      profile.lineBreakScan = 'gecko'
      profile.hidesControlCharacters = true
      // Gecko records a soft-hyphen break only where its hyphen fits, and any other
      // break where its line fits, such as the break after a hidden control.
      const text = '\u000Btrans\u00ADic'
      const width = measureWidth('trans', FONT) + 0.1
      for (const [unfitHyphenRetreat, expected] of [
        ['none', ['\u000Btrans-', 'ic']],
        ['reduced-width', ['\u000Btrans-', 'ic']],
        ['full-width', ['\u000B', 'trans-', 'ic']],
      ] as const) {
        profile.unfitHyphenRetreat = unfitHyphenRetreat
        clearCache()
        const prepared = prepareWithSegments(text, FONT, { whiteSpace: 'pre-wrap' })
        expect(layoutWithLines(prepared, width, LINE_HEIGHT).lines.map(line => line.text)).toEqual([...expected])
        expect(collectStreamedLines(prepared, width).map(line => line.text)).toEqual([...expected])
        expect(layout(prepare(text, FONT, { whiteSpace: 'pre-wrap' }), width, LINE_HEIGHT).lineCount).toBe(expected.length)
      }
    } finally {
      [profile.lineBreakScan, profile.hidesControlCharacters, profile.unfitHyphenRetreat] = previous
      clearCache()
    }
  })

  test('every text segment of an engine scan takes emergency grapheme breaks', () => {
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    try {
      for (const scan of ['blink', 'webkit', 'gecko'] as const) {
        profile.lineBreakScan = scan
        // Segment metrics belong to one engine profile.
        clearCache()
        // Digits, which Safari's JavaScriptCore doesn't mark word-like, symbols and emoji.
        for (const text of ['11111111', '-0.475', '\u{1F1FA}\u{1F1F8}/\u{1F469}\u200D\u{1F4BB}', '\u{1F600}--tail']) {
          const prepared = prepareWithSegments(text, FONT)
          for (let i = 0; i < prepared.segments.length; i++) {
            if (prepared.kinds[i] === 'text' && getSegmentGraphemes(prepared.segments[i]!).length > 1) {
              expect({ text, segment: prepared.segments[i], breakable: prepared.breakableFitAdvances[i] !== null }).toEqual({ text, segment: prepared.segments[i], breakable: true })
            }
          }
          const graphemes = getSegmentGraphemes(text).filter(grapheme => grapheme !== ' ')
          const width = Math.min(...graphemes.map(grapheme => measureWidth(grapheme, FONT))) + 0.1
          // WebKit keeps `/` on the line of an overflowing first character in text above U+00FF.
          const expected = scan === 'webkit' && text.includes('/') ? ['\u{1F1FA}\u{1F1F8}/', '\u{1F469}‍\u{1F4BB}'] : graphemes
          const result = layoutWithLines(prepared, width, LINE_HEIGHT)
          expect(result.lines.map(line => line.text)).toEqual(expected)
          expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
          expect(layout(prepare(text, FONT), width, LINE_HEIGHT).lineCount).toBe(expected.length)
        }
      }
    } finally {
      profile.lineBreakScan = previous
    }
  })

  test('a Gecko text segment that is one cluster takes no emergency breaks', () => {
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    try {
      // Gecko drops the soft hyphen before it clusters, so ZWJ continues the woman's
      // cluster and joins the rocket to it, where Unicode graphemes split ZWJ off.
      profile.lineBreakScan = 'gecko'
      const text = 'a\u{1F469}\u00AD‍\u{1F680}b'
      const prepared = prepareWithSegments(text, FONT)
      const zwj = prepared.segments.indexOf('‍\u{1F680}')
      expect(getSegmentGraphemes(prepared.segments[zwj]!).length).toBe(2)
      expect(prepared.breakableFitAdvances[zwj]).toBeNull()
      expect(layoutWithLines(prepared, 0, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['a', '\u{1F469}-', '‍\u{1F680}', 'b'])
      profile.lineBreakScan = 'blink'
      clearCache()
      const blink = prepareWithSegments('ab‍\u{1F680}', FONT)
      expect(blink.breakableFitAdvances[0]).not.toBeNull()
    } finally {
      profile.lineBreakScan = previous
    }
  })

  test('zero-width glue at a line start holds the line only where the engine lets it', () => {
    const profile = getEngineProfile()
    const previous = { lineBreakScan: profile.lineBreakScan, zeroWidthGlueTakesLine: profile.zeroWidthGlueTakesLine }
    try {
      const lines = (text: string, width: number) => {
        const prepared = prepareWithSegments(text, FONT)
        const result = layoutWithLines(prepared, width, LINE_HEIGHT)
        expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
        expect(layout(prepare(text, FONT), width, LINE_HEIGHT).lineCount).toBe(result.lineCount)
        return result.lines.map(line => slicePreparedText(prepared, line.start, line.end))
      }
      // Blink has no break between a soft hyphen and a closing bracket, and its
      // break-anywhere retry gives the soft hyphen a line of its own, as Chrome paints it.
      profile.lineBreakScan = 'blink'
      profile.zeroWidthGlueTakesLine = true
      expect(prepareWithSegments('ab\u00AD)c', FONT).kinds[1]).toBe('zero-width-glue')
      expect(lines('ab\u00AD)c', 1)).toEqual(['a', 'b', '\u00AD', ')', 'c'])
      // Gecko drops a soft hyphen from its text run, so one at the start offers no break
      // and holds no line.
      profile.lineBreakScan = 'gecko'
      profile.zeroWidthGlueTakesLine = false
      expect(prepareWithSegments('\u00ADa\u00ADb', FONT).kinds[0]).toBe('zero-width-glue')
      expect(lines('\u00ADa\u00ADb', 0)).toEqual(['\u00ADa\u00AD', 'b'])
      expect(lines('\u00ADb', 1)).toEqual(['\u00ADb'])
      // A soft hyphen taken as a zero-width break leaves line text, drawing no hyphen.
      const cjk = prepareWithSegments('漢字\u00ADabc', FONT)
      const cjkWidth = measureWidth('漢字', FONT) + 0.1
      expect(layoutWithLines(cjk, cjkWidth, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['漢字', 'abc'])
      expect(collectStreamedLines(cjk, cjkWidth).map(line => line.text)).toEqual(['漢字', 'abc'])
    } finally {
      profile.lineBreakScan = previous.lineBreakScan
      profile.zeroWidthGlueTakesLine = previous.zeroWidthGlueTakesLine
    }
  })

  test('a line ends only where the scan breaks, and marks after zero-width glue shape after the source before them', () => {
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    const previousShapesMarks = profile.shapesMarksAcrossSoftHyphen
    shapesMarksAndJoiners = true
    clearCache()
    try {
      const lines = (text: string, width: number, options?: { whiteSpace?: 'pre-wrap', letterSpacing?: number }) => {
        const prepared = prepareWithSegments(text, FONT, options)
        const result = layoutWithLines(prepared, width, LINE_HEIGHT)
        expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
        expect(layout(prepare(text, FONT, options), width, LINE_HEIGHT).lineCount).toBe(result.lineCount)
        const contract = variant.predict({
          id: 'unit-scan-breaks', family: 'api', origins: ['maintained'], scope: 'supported',
          text, whiteSpace: options?.whiteSpace ?? 'normal', font: FONT, width, lineHeight: LINE_HEIGHT,
          wordBreak: 'normal', letterSpacing: options?.letterSpacing ?? 0, direction: 'ltr',
        })
        if (contract.detail !== 'full') throw new Error('Expected full public contract checks')
        expect(contract.contracts).toEqual([])
        return result.lines.map(line => slicePreparedText(prepared, line.start, line.end))
      }
      for (const scan of ['blink', 'webkit'] as const) {
        profile.lineBreakScan = scan
        profile.shapesMarksAcrossSoftHyphen = scan === 'blink'
        // No break on either side of the soft hyphen before WJ, so the glue goes
        // with WJ, which fits, as both browsers paint it.
        expect(lines('a\u00AD\u2060b', 0)).toEqual(['a', '\u00AD\u2060', 'b'])
        // With no break on the line, graphemes fill it across a control.
        expect(lines('ab\u000Bcd', measureWidth('ab\u000Bc', FONT) + 0.1)).toEqual(['ab\u000Bc', 'd'])
        // With one, the line returns to it instead of ending before the control.
        expect(lines('a\u00ADb\u0080b', measureWidth('b\u0080', FONT) + 0.1)).toEqual(['a\u00AD', 'b\u0080', 'b'])
        // WebKit breaks before the CR after the space, which is a break after the
        // collapsed space, so the line returns there as Safari paints it.
        expect(lines('ab \rcd', measureWidth('ab c', FONT) - 2, { letterSpacing: -1 })).toEqual(['ab ', 'cd'])

        // A mark after zero-width glue or a control adds the source before it with the
        // mark, minus that source, and takes no letter spacing of its own.
        for (const [text, markIndex] of [['aaaa\u00AD\u0301tail', 2], ['ab\u0000\u0301cd', 2]] as const) {
          const prepared = prepareWithSegments(text, FONT, { letterSpacing: 1 })
          expect(prepared.segments[markIndex]).toBe('\u0301')
          expect(prepared.widths[markIndex]).toBe(0)
          expect(prepared.segmentFlags[markIndex]! & SPACED).toBe(0)
        }
        const tail = 'aaaa\u00AD\u0301tail'
        expect(lines(tail, measureWidth('aaaatail', FONT) + 0.1)).toEqual([tail])
        // Glue and marks fit like the line that ends with the letter's gap: at
        // letter spacing -4 both browsers keep them with `a`, at 0 they wrap them.
        const marks = 'a\u00AD\u0301\u00AD\u0323b'
        expect(lines(marks, 7, { whiteSpace: 'pre-wrap', letterSpacing: -4 })).toEqual(['a\u00AD\u0301\u00AD\u0323', 'b'])
        expect(lines(marks, 7, { whiteSpace: 'pre-wrap' })).toEqual(['a', '\u00AD\u0301\u00AD\u0323', 'b'])
        // Measured with the soft hyphens, U+0323 doesn't take `a` into another font,
        // so the text fits where `ab` fits, as Chrome paints it in Amiri.
        expect(lines(marks, measureWidth('ab', FONT) + 0.1)).toEqual([marks])
        // Where Canvas draws a dotted circle for the mark after a soft hyphen, Chrome
        // shapes the mark with `a` and gives it no advance; Safari draws the circle.
        drawsDottedCircles = true
        clearCache()
        const circled = 'a\u00AD́b'
        expect(lines(circled, measureWidth('ab', FONT) + 0.1)).toEqual(scan === 'blink' ? [circled] : ['a\u00AD́', 'b'])
        drawsDottedCircles = false
        clearCache()
      }
    } finally {
      profile.lineBreakScan = previous
      profile.shapesMarksAcrossSoftHyphen = previousShapesMarks
      shapesMarksAndJoiners = false
      drawsDottedCircles = false
      clearCache()
    }
  })

  test('a rich item keeps its collapsed leading whitespace as WebKit break context', () => {
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    profile.lineBreakScan = 'webkit'
    try {
      // Rich fragment cursors index prepareWithSegments(item.text), where a
      // SPACE or TAB before the ZWSP separates the mark.
      for (const parts of [[' \u200B\u0301ab', 'c'], ['x', '\t\u200B\u0301ab']]) for (const width of [1, 20]) {
        const result = variant.predict({
          id: 'unit-rich-scan-context', family: 'api', origins: ['maintained'], scope: 'supported',
          text: parts.join(''), parts, nativeItems: true, whiteSpace: 'normal', font: FONT, width,
          lineHeight: LINE_HEIGHT, wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
        })
        if (result.detail !== 'full') throw new Error('Expected full public contract checks')
        expect(result.contracts).toEqual([])
      }
    } finally {
      profile.lineBreakScan = previous
    }
  })

  test('Chrome and Firefox remove a newline run next to a zero-width space through their own runs', () => {
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    try {
      for (const [browser, scan, column] of [['safari', 'webkit', 1], ['chrome', 'blink', 2], ['firefox', 'gecko', 3]] as const) {
        profile.lineBreakScan = scan
        // Source, then the normalized text in Safari, Chrome and Firefox.
        for (const shape of [
          ['ab\n\u200Bcd', 'ab \u200Bcd', 'ab\u200Bcd', 'ab\u200Bcd'],
          ['ab\u200B \n\tcd', 'ab\u200B cd', 'ab\u200Bcd', 'ab\u200Bcd'],
          ['\u200B\nab', '\u200B ab', '\u200Bab', '\u200Bab'],
          // The ZWSP must touch the run, and the run must contain a newline.
          ['ab\n\u2060\u200Bcd', 'ab \u2060\u200Bcd', 'ab \u2060\u200Bcd', 'ab \u2060\u200Bcd'],
          ['ab \u200Bcd', 'ab \u200Bcd', 'ab \u200Bcd', 'ab \u200Bcd'],
          // CR joins Blink's run only. FF joins neither run and still collapses.
          ['ab\u200B\r\ncd', 'ab\u200B cd', 'ab\u200Bcd', 'ab\u200B cd'],
          ['ab\u200B\f\ncd', 'ab\u200B cd', 'ab\u200B cd', 'ab\u200B cd'],
          ['ab\u200B\n\fcd', 'ab\u200B cd', 'ab\u200B cd', 'ab\u200B cd'],
          // Gecko's run continues through SHY without ending on one, and leaves
          // out a last SPACE before a combining mark.
          ['ab\u200B\n\u00AD\ncd', 'ab\u200B \u00AD cd', 'ab\u200B\u00AD cd', 'ab\u200B\u00ADcd'],
          ['ab\n\u00AD\u200Bcd', 'ab \u00AD\u200Bcd', 'ab \u00AD\u200Bcd', 'ab \u00AD\u200Bcd'],
          ['ab\u200B\n \u0301cd', 'ab\u200B \u0301cd', 'ab\u200B\u0301cd', 'ab\u200B \u0301cd'],
        ] as const) {
          expect(prepareWithSegments(shape[0], FONT).segments.join('')).toBe(shape[column])
          // The documented source contract of the observed browser agrees.
          const result = variant.predict({
            id: 'unit-segment-break-removal', family: 'api', origins: ['maintained'], scope: 'supported',
            text: shape[0], whiteSpace: 'normal', font: FONT, width: 20,
            lineHeight: LINE_HEIGHT, wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
          }, browser)
          if (result.detail !== 'full') throw new Error('Expected full public contract checks')
          expect(result.contracts).toEqual([])
        }
        expect(prepareWithSegments('ab\n\u200Bcd', FONT, { whiteSpace: 'pre-wrap' }).segments.join('')).toBe('ab\n\u200Bcd')
        // A rich item's own boundary newline next to its ZWSP leaves no gap.
        for (const [text, gaps] of [
          ['ab\u200B\n', [false, true, false, false]],
          ['ab\u200B\n\u00AD\n', [false, true, true, false]],
        ] as const) {
          const rich = prepareRichInline([{ text, font: FONT }, { text: 'cd', font: FONT }])
          const line = layoutNextRichInlineLineRange(rich, Number.POSITIVE_INFINITY)
          expect(line?.fragments.map(fragment => fragment.gapItemIndex >= 0)).toEqual([false, gaps[column]])
        }
      }
    } finally {
      profile.lineBreakScan = previous
    }
  })

  test('the WebKit profile keeps NEL with the content before it, breaks after it and gives it no letter spacing', () => {
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    // Blink and Gecko keep NEL as ordinary text.
    expect(prepareWithSegments('zz ab\u0085cd', FONT).kinds).not.toContain('control')
    profile.lineBreakScan = 'webkit'
    try {
      const lines = (text: string, width: number, options?: { whiteSpace?: 'pre-wrap', letterSpacing?: number }) => {
        const prepared = prepareWithSegments(text, FONT, options)
        const result = layoutWithLines(prepared, width, LINE_HEIGHT)
        expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
        expect(layout(prepare(text, FONT, options), width, LINE_HEIGHT).lineCount).toBe(result.lineCount)
        return result.lines
      }
      const text = 'zz ab\u00A0\u0085\u0085cd \u0085ef'
      const prepared = prepareWithSegments(text, FONT)
      expect(prepared.segments).toEqual(['zz', ' ', 'ab\u00A0', '\u0085', '\u0085', 'cd', ' ', '\u0085', 'ef'])
      expect(prepared.kinds).toEqual(['text', 'space', 'text', 'control', 'control', 'text', 'space', 'control', 'text'])
      // Glued content moves to the next line with its NEL, while a space still breaks before one.
      expect(lines(text, measureWidth('zz ab\u00A0', FONT) + 0.5).map(line => line.text)).toEqual(['zz ', 'ab\u00A0\u0085\u0085', 'cd \u0085ef'])
      // Content that starts a line can still overflow right before the NEL.
      expect(lines(text, measureWidth('ab\u00A0', FONT) + 0.5).map(line => line.text)).toEqual(['zz ', 'ab\u00A0', '\u0085\u0085', 'cd ', '\u0085ef'])
      // WebKit's keep-all breaks only at spaces in this text. A NEL with no break after it still
      // stays its own control segment, measured alone.
      const keepAll = analyzeText('zz ab\u00A0\u0085cd \u6F22\u00A0\u0085\u5B57', profile, 'normal', 'keep-all')
      expect(keepAll.texts).toEqual(['zz', ' ', 'ab\u00A0', '\u0085', 'cd', ' ', '\u6F22\u00A0', '\u0085', '\u5B57'])
      expect(keepAll.kinds).toEqual(['text', 'space', 'text', 'control', 'text', 'space', 'text', 'control', 'text'])
      // A rich item that ends in NEL breaks before the next item.
      const rich = prepareRichInline([{ text: 'ab\u0085', font: FONT }, { text: 'cd', font: FONT }])
      expect(measureRichInlineStats(rich, measureWidth('ab\u0085', FONT) + 0.5).lineCount).toBe(2)
      // A rich item that starts with NEL keeps the word before it, as the joined text does.
      const parts = ['ab foo', '\u0085b'] as const
      const width = measureWidth('ab foo', FONT) + 0.5
      const leading = prepareRichInline(parts.map(part => ({ text: part, font: FONT })))
      const richLines: string[] = []
      walkRichInlineLineRanges(leading, width, range => {
        richLines.push(materializeRichInlineLineRange(leading, range).fragments.map(fragment => fragment.text).join('').trimEnd())
      })
      const flatLines = lines(parts.join(''), width).map(line => line.text.trimEnd())
      expect(flatLines).toEqual(['ab', 'foo\u0085b'])
      expect(richLines).toEqual(flatLines)

      // NEL takes no letter spacing at either sign, but the gap after the
      // grapheme before it stays.
      const a = measureWidth('a', FONT)
      const nel = measureWidth('\u0085', FONT)
      for (const letterSpacing of [-1, 2]) {
        const natural = lines('a\u0085\u0085b', 1000, { letterSpacing })
        expect(natural.map(line => line.text)).toEqual(['a\u0085\u0085b'])
        expect(natural[0]!.width).toBeCloseTo(2 * a + 2 * nel + 2 * letterSpacing)
        const split = lines('a\u0085\u0085b', a + nel + letterSpacing + 0.5, { letterSpacing })
        expect(split.map(line => line.text)).toEqual(['a\u0085', '\u0085b'])
        for (const line of split) expect(line.width).toBeCloseTo(a + nel + letterSpacing)
        // Text on WebKit's simple path, such as CJK, leaves the NEL after it
        // unspaced, while text on its complex path, such as Arabic, spaces it.
        expect(lines('\u6F22\u0085', 1000, { letterSpacing })[0]!.width).toBeCloseTo(measureWidth('\u6F22', FONT) + nel + letterSpacing)
        expect(lines('\u0628\u0085', 1000, { letterSpacing })[0]!.width).toBeCloseTo(measureWidth('\u0628', FONT) + nel + 2 * letterSpacing)
      }
      // A preserved space does not hang after a NEL that already overflows.
      expect(lines('a\u0085 b', nel - 0.5, { whiteSpace: 'pre-wrap', letterSpacing: 1 }).map(line => line.text)).toEqual(['a', '\u0085', ' ', 'b'])
    } finally {
      profile.lineBreakScan = previous
    }
  })

  test('the WebKit profile moves a tab to the following stop when less than half a space remains', () => {
    const profile = getEngineProfile()
    const previous = profile.skipNarrowTabStops
    const space = measureWidth(' ', FONT)
    const a = measureWidth('a', FONT)
    const tabLineWidth = (letterSpacing: number) =>
      layoutWithLines(prepareWithSegments('a\tb', FONT, { whiteSpace: 'pre-wrap', letterSpacing }), 1000, LINE_HEIGHT).lines[0]!.width
    try {
      // Letter spacing places the tab a quarter or three quarters of a space
      // before the first stop, eight spaces from the line start.
      for (const [remaining, skipped] of [[space / 4, true], [space * 3 / 4, false]] as const) {
        const letterSpacing = 8 * space - remaining - a
        profile.skipNarrowTabStops = false
        const nearest = tabLineWidth(letterSpacing)
        profile.skipNarrowTabStops = true
        expect(tabLineWidth(letterSpacing) - nearest).toBeCloseTo(skipped ? 8 * space : 0)
      }
    } finally {
      profile.skipNarrowTabStops = previous
    }
  })

  test('numeric signs stay with their numbers while ordinary hyphens retain their breaks', () => {
    for (const [text, prefix, expected] of [
      ['-0.475', '-0.47', ['-0.47', '5']],
      ['≥-100nA', '≥-100n', ['≥-100', 'nA']],
      ['well-known', 'well-kn', ['well-', 'known']],
      ['foo -bar', '-bar', ['foo ', '-bar']],
    ] as const) {
      const width = measureWidth(prefix, FONT) + 0.1
      const result = variant.predict({
        id: 'unit-numeric-sign', family: 'api', origins: ['maintained'], scope: 'supported',
        text, whiteSpace: 'normal', font: FONT, width, lineHeight: LINE_HEIGHT,
        wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
      })
      if (result.detail !== 'full') throw new Error('Expected full public contract checks')
      expect(result.lines.map(line => line.text)).toEqual([...expected])
      expect(result.contracts).toEqual([])
    }
  })

  test('CJK hyphens attach left while overlong units retain emergency progress', () => {
    for (const [text, prefix, expected] of [
      ['(试验前-试验后)/试验前', '前-试验', ['(试验', '前-试验', '后)/试', '验前']],
      ['温度-100nA', '度-100', ['温', '度-10', '0nA']],
    ] as const) {
      const width = measureWidth(prefix, FONT) + 0.1
      const prepared = prepareWithSegments(text, FONT, { whiteSpace: 'pre-wrap' })
      const result = layoutWithLines(prepared, width, LINE_HEIGHT)
      expect(result.lines.map(line => line.text)).toEqual([...expected])
      expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
      expect(layout(prepare(text, FONT, { whiteSpace: 'pre-wrap' }), width, LINE_HEIGHT).lineCount).toBe(expected.length)
    }
  })

  test('a run of openers stays with the text after it', () => {
    const text = 'e\u0301e\u0301「「tail'
    const width = measureWidth('「「tail', FONT) + 0.1
    const prepared = prepareWithSegments(text, FONT)
    const result = layoutWithLines(prepared, width, LINE_HEIGHT)
    expect(result.lines.map(line => line.text)).toEqual(['e\u0301e\u0301', '「「tail'])
    expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
    expect(layout(prepare(text, FONT), width, LINE_HEIGHT).lineCount).toBe(2)
  })

  test('a collapsible space or zero-width space after an overflowing first glyph ends that line', () => {
    // A soft hyphen later in the text moves the handle off the simple line
    // walker, which must not move where the first line ends.
    for (const separator of [' ', '\u200B']) {
      for (const tail of ['', ' ab\u00ADcd']) {
        const prepared = prepareWithSegments(`字${separator}字${tail}`, FONT)
        const lines = layoutWithLines(prepared, 5, LINE_HEIGHT).lines
        expect(lines.slice(0, 2).map(line => line.text)).toEqual([`字${separator}`, tail === '' ? '字' : '字 '])
        expect(lines[0]!.end).toEqual({ segmentIndex: 2, graphemeIndex: 0 })
        expect(collectStreamedLines(prepared, 5)).toEqual(lines)
      }
    }
  })

  test('a negative width lays out like 0 on both line walkers', () => {
    // The soft hyphen moves the handle off the simple line walker.
    for (const tail of ['', ' ab\u00ADcd']) {
      const prepared = prepareWithSegments(`\u200B\u200Bb${tail}`, FONT)
      const lines = layoutWithLines(prepared, 0, LINE_HEIGHT).lines
      expect(lines[0]!.text).toBe('\u200B\u200B')
      expect(layoutWithLines(prepared, -5, LINE_HEIGHT).lines).toEqual(lines)
      expect(collectStreamedLines(prepared, -5)).toEqual(lines)
    }
  })
})

describe('engine break scans', () => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  const wordSegmenter = () => segmenter
  const positions = (breaks: Uint8Array, length: number) => {
    const out: number[] = []
    for (let i = 1; i < length; i++) if (breaks[i] === 1) out.push(i)
    return out
  }

  test('the ICU iterator finds the boundaries ICU C finds over the same line rules', () => {
    // Every position in these texts reaches ICU in Blink's scan. The boundaries come from
    // ICU C 78.3 opening Chrome 153's line_normal.brk with ubrk_openBinaryRules.
    for (const [text, expected] of [
      ['日本語「テスト」です。', [1, 2, 3, 5, 6, 8, 9]],
      ['한국어테스트입니다', [1, 2, 3, 4, 5, 6, 7, 8]],
      ['中文“你好”中文', [1, 2, 4, 6, 7]],
      ['１２３，４５６円', [1, 2, 4, 5, 6, 7]],
      ['‐אב״גד', []],
      ['«مرحبا»،عالم', []],
      ['👩‍💻👍🏽🇯🇵🇰🇷', [5, 9, 13]],
      ['₩１００％ᄀᄀ가각', [2, 3, 5, 8]],
      ['〈〔漢字〕〉ー々', [3, 6]],
      ['ⅣⅤ→★☆※‼⁉', []],
      // Cases from LineBreakTest.txt. In the last two, ICU's normal rules resolve small
      // kana (CJ) to ID and break before them, where the file expects no break.
      ['\u3066\u300C\uBD24\uC5B4?\u300D\u3068', [1, 3, 6]],
      ['\u25CC\uA9B3\uA9C0\uA9A0', []],
      ['\u0085\u0308\u2757', [1]],
      ['\u200B\u0308\u3000', [1]],
      ['\u200D\u0308\uFFFC', [2]],
      ['\u2014-', []],
      ['\u00B4\u05D0', []],
      ['}\uFE19', []],
      ['\uFE56\u00AB', []],
      ['p\uFF08\u30AF\u30A4\u30C3\u30AF\u30FB\u30D6', [1, 3, 4, 5, 7]],
      ['\u2757\u3041', [1]],
    ] as const) {
      expect({ text, breaks: positions(getBlinkLineBreaks(text, false, null, wordSegmenter), text.length) }).toEqual({ text, breaks: [...expected] })
    }
  })

  test("Blink's scan opens Chrome's zh table for a zh page", () => {
    const positions = (breaks: Uint8Array) => Array.from(breaks.keys()).filter(i => breaks[i] === 1)
    // line_normal_cj.brk treats curly quotes as brackets and lets 〜 start a line.
    for (const [text, root, zh] of [
      ['中文“abc”中文', [1, 8], [1, 2, 7, 8]],
      ['x〜y', [2], [1, 2]],
    ] as const) {
      expect(positions(getBlinkLineBreaks(text, false, null, wordSegmenter))).toEqual([...root])
      expect(positions(getBlinkLineBreaks(text, false, 'ja', wordSegmenter))).toEqual([...root])
      expect(positions(getBlinkLineBreaks(text, false, 'zh-Hant', wordSegmenter))).toEqual([...zh])
      // A page without a language follows Chrome's UI language, which Intl shows as its default.
      const uiIsChinese = new Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh')
      expect(positions(getBlinkLineBreaks(text, false, '', wordSegmenter))).toEqual([...(uiIsChinese ? zh : root)])
    }
  })

  test("Blink's scan follows its space rule, pair table, hyphen-digit rule and keep-all rule", () => {
    // Cases the Blink break oracle was checked on, from Chromium source and installed Chrome.
    for (const [text, keepAll, expected] of [
      ['x?$b', false, [2]],
      ['x?-b', false, [2, 3]],
      ['x!©b', false, [2]],
      ['丙!a', false, []],
      ['a )', false, [2]],
      ['a-$', false, []],
      ['a\u00A0b', false, []],
      ['a\u00ADb', false, [2]],
      ['ABCD-1234', false, [5]],
      ['a -1', false, [2]],
      ['a -eb', false, [2, 3]],
      ['a -éb', false, [2]],
      ['a ‐©b', false, [2]],
      ['xxxx，b', false, [5]],
      ['1234」。b', false, [6]],
      ['日本語 テスト', false, [1, 2, 4, 5, 6]],
      ['日本語 テスト', true, [4]],
      ['中文，中文', true, [3]],
      ['日本語foo-bar', true, [7]],
      ['a　b', false, [2]],
      ['a\tb', false, [2]],
      ['a\rb', false, []],
      ['1234-5678', false, [5]],
      ['AB-12', false, [3]],
      ['a -אב', false, [2]],
      ['a -\u0301\u00E9b', false, [2]],
      ['abcァア', false, [3, 4]],
      ['中文\u201Cabc\u201D中文', false, [1, 8]],
      ['中文中文\u201D漢字kana', true, [5]],
      ['한국어테스트 테스트입니다', true, [7]],
      ['\u{1F600}\u{1F600}', false, [2]],
    ] as const) {
      expect({ text, keepAll, breaks: positions(getBlinkLineBreaks(text, keepAll, null, wordSegmenter), text.length) })
        .toEqual({ text, keepAll, breaks: [...expected] })
    }
  })

  test("WebKit's scan follows its pair table, classes, ICU skip, keep-all rule and page language", async () => {
    const { getWebKitBreakBetweenItems, getWebKitLineBreaks } = await import('./line-breaks.ts')
    // Cases the WebKit break oracle was checked on, from WebKit source and installed Safari,
    // with the oracle's breaks.
    for (const [text, language, keepAll, preserve, expected] of [
      ['丙!a', 'en', false, false, [2]],
      ['丙!1', 'en', false, false, []],
      ['か}a', 'en', false, false, [2]],
      ['丙}a', 'en', false, false, []],
      ['x?$b', 'en', false, false, [2]],
      ['x?-b', 'en', false, false, [2, 3]],
      ['$-1', 'en', false, false, []],
      ['a -ª', 'en', false, false, [1, 2]],
      ['a ‐b', 'en', false, false, [1, 2]],
      ['a\t-b', 'en', false, false, [1, 2, 3]],
      ['a/é', 'en', false, false, [2]],
      ['foo\u00A0世界', 'en', false, false, [5]],
      ['日本ァア', 'en', false, false, [1, 3]],
      ['日本ァア', 'ja', false, false, [1, 2, 3]],
      ['日本ァア', 'zh', false, false, [1, 3]],
      ['中文“abc”中文', 'en', false, false, [1, 2, 7, 8]],
      ['中文“abc”中文', 'ja', false, false, [1, 2, 7, 8]],
      ['A 中文测试', 'zh', true, false, [1, 2]],
      ['ab　cd', 'en', true, false, [3]],
      ['a​b', 'en', true, false, [1]],
      ['a​b', 'en', false, false, [2]],
      ['a\nb', 'en', false, true, []],
      ['한}a', 'en', false, false, []],
      ['x!b', 'en', false, false, []],
      ['x!(b', 'en', false, false, [2]],
      ['a-1', 'en', false, false, [2]],
      ['x -1', 'en', false, false, [1, 2]],
      ['a -\u0301\u00E9b', 'en', false, false, [1, 2]],
      ['and/or', 'en', false, false, []],
      ['a/б', 'en', false, false, [2]],
      ['a\u2007b', 'en', false, false, []],
      ['日本ァア', 'ko', false, false, [1, 2, 3]],
      ['日本ーー', 'en', false, false, [1]],
      ['xyz abc\u201Ddef', 'en', false, false, [3, 4]],
      ['xyz abc\u201Ddef', 'ja', false, false, [3, 4]],
      ['日本\uFF01ァア', 'ja', true, false, [3]],
      ['a\nb', 'en', false, false, [1, 2]],
      // Safari 27's opening and closing quotation classes, and keep-all breaks after
      // punctuation in text above U+00FF.
      ['中文«abc»中文', 'en', false, false, [1, 2, 7, 8]],
      ['go 한글x\u201Dvalue\u201C!', 'en', false, false, [2, 3, 4, 5]],
      ['(试验前-试验后)/试验前', 'zh', true, false, [1, 9, 10]],
      ['foo。bar日本語', 'ja', true, false, [4]],
      ['a,b', 'ja', true, false, []],
    ] as const) {
      expect({ text, language, keepAll, breaks: positions(getWebKitLineBreaks(text, preserve, keepAll, language, wordSegmenter), text.length) })
        .toEqual({ text, language, keepAll, breaks: [...expected] })
    }
    // Between inline boxes, the previous box's last two characters are prior context.
    expect(getWebKitBreakBetweenItems('丙!', 'a', 'en', wordSegmenter)).toBe(false)
    expect(getWebKitBreakBetweenItems('ex-', 'ample', 'en', wordSegmenter)).toBe(true)
    expect(getWebKitBreakBetweenItems('a', '-1', 'en', wordSegmenter)).toBe(false)
    // A separator that starts an item forces a break after it, marked 2; one inside a
    // text item doesn't.
    expect(Array.from(getWebKitLineBreaks('ab\u2028cd', false, false, 'en', wordSegmenter))).toEqual([0, 0, 0, 2, 0, 0])
    expect(Array.from(getWebKitLineBreaks('か中？\u2028b', false, false, 'en', wordSegmenter))).toEqual([0, 1, 0, 0, 1, 0])
  })

  test("Gecko's scan follows its white-space transform, text runs, nsLineBreaker and ICU4X's rules", async () => {
    const { getGeckoLineBreaks } = await import('./gecko-line-breaks.ts')
    const { removeSkippableSegmentBreaks } = await import('./analysis.ts')
    // Cases from the Gecko break oracle's tests and others, with the oracle's breaks,
    // soft-hyphen breaks included. The scan reads the text after the segment break
    // transformation, as analyzeText gives it: the text and breaks of a row whose
    // segment break goes are shown after it.
    for (const [text, language, keepAll, preserve, expected] of [
      ['https://example.com', 'en', false, false, [8]],
      ['example.com/docs', 'en', false, false, [12]],
      ['and/or', 'en', false, false, [4]],
      ['a/(b)', 'en', false, false, [2]],
      ['see /docs', 'en', false, false, [4, 5]],
      ['1/2', 'en', false, false, []],
      ['a/"b"', 'en', false, false, []],
      ['log-2026', 'en', false, false, []],
      ['crash-log-2026-09-12.txt', 'en', false, false, [6]],
      ['ab\u201012', 'en', false, false, [3]],
      ['a \u1781\u17D2\u1798\u17C2\u179A\uFF0Cb', 'en', false, false, [2, 7, 8]],
      ['x?-b', 'en', false, false, [3]],
      ['a|b', 'en', false, false, [2]],
      ['a\u200B\u0301b', 'en', false, false, []],
      ['a\u200Bb', 'en', false, false, [2]],
      ['a\u2007b', 'en', false, false, []],
      ['a\u00A0b', 'en', false, false, []],
      ['\u05D0|\u6587', 'en', true, false, []],
      ['\u6587\u05D0|\u6587', 'en', true, false, [1]],
      ['\u00AB word', 'en', false, false, [2]],
      ['a   b', 'en', false, false, [4]],
      ['ab\ncd', 'en', false, true, [3]],
      ['ab\ncd\u4E2D', 'en', false, true, [5]],
      ['a\tb', 'en', false, true, [2]],
      ['a  b', 'en', false, true, [3]],
      ['ab\u00ADcd', 'en', false, false, [3]],
      ['ab-cd', 'en', true, false, []],
      ['a\u200Bb', 'en', false, false, [2]], // a, ZWSP, LF, b
      ['a\nb', 'en', false, false, [2]],
      ['a \n\t b', 'en', false, false, [5]],
      ['\u0628\u200E\u0650\u0628', 'en', false, false, []],
      ['\u65E5\uFF1F\u30FC', 'en', false, false, []],
      ['\u4E2D\u6587\u4E2D\u6587', 'en', false, false, [1, 2, 3]], // an LF between the two words
      ['a\u3002', 'ja', false, false, []], // a, LF, U+3002
      ['a\n\u3002', 'en', false, false, [2]],
      ['\u0915\u0947 \u0301b', 'en', false, false, [3]],
      ['a (\u05D0\u05D1) b', 'en', false, false, [2, 7]],
    ] as const) {
      // The transformation leaves these rows as they are.
      expect(preserve ? text : removeSkippableSegmentBreaks(text, { lineBreakScan: 'gecko', graphemeTable: 'chromium/char' }, language)).toBe(text)
      expect({ text, language, keepAll, breaks: positions(getGeckoLineBreaks(text, preserve, keepAll, 'chromium/char', wordSegmenter), text.length) })
        .toEqual({ text, language, keepAll, breaks: [...expected] })
    }
  })

  test('grapheme clusters end where ICU ends them, in one pass', async () => {
    const { findGraphemeEnds } = await import('./graphemes.ts')
    const { charTablesPacked } = await import('./generated/engine-break-data.ts')
    const { createRuleBreakIterator, nextRuleBoundary, parseBreakRules, unpackTable } = await import('./line-breaks.ts')
    const ends = (table: 'chromium/char' | 'apple/char', text: string) => {
      const out = new Int32Array(text.length)
      return Array.from(out.subarray(0, findGraphemeEnds(table, text, 0, text.length, out)))
    }
    for (const [text, expected] of [
      ['\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', [8]],
      ['\u{1F1EF}\u{1F1F5}\u{1F1FA}\u{1F1F8}\u{1F1EB}', [4, 8, 10]],
      ['1\uFE0F\u20E3#', [3, 4]],
      ['\u0915\u094D\u0937\u093F\u0915', [4, 5]],
      ['\u1100\u1161\u11A8\uAC00\uAC01', [3, 4, 5]],
      ['\u6F22\uFE00\u5B57', [2, 3]],
      ['a\r\nb\n\r', [1, 3, 4, 5, 6]],
      ['\u0600a b', [2, 3, 4]],
      ['a\uD800\u0301\uDC00', [1, 3, 4]],
    ] as const) {
      expect({ text, ends: ends('chromium/char', text) }).toEqual({ text, ends: [...expected] })
      expect({ text, ends: ends('apple/char', text) }).toEqual({ text, ends: [...expected] })
    }
    // libicucore's rules take Apple's transcoding hints as Extend.
    expect(ends('chromium/char', 'a\uF870\uF89F')).toEqual([1, 2, 3])
    expect(ends('apple/char', 'a\uF870\uF89F')).toEqual([3])
    // A range reads as if the text began and ended there.
    const out = new Int32Array(4)
    expect(Array.from(out.subarray(0, findGraphemeEnds('chromium/char', 'x\u0301\u0301y', 1, 3, out)))).toEqual([3])

    // Against ICU's handleNext over random strings of one code point per class.
    const samples = [0x0, 0xa, 0xd, 0x20, 0xa9, 0x300, 0x600, 0x903, 0x915, 0x94d, 0x1100, 0x1160, 0x11a8, 0x200c, 0x200d, 0xac00, 0xac01, 0x1f1e6, 0xf870, 0xd800]
    let seed = 7
    const random = (n: number) => { seed = (seed * 48271) % 0x7fffffff; return seed % n }
    for (const table of ['chromium/char', 'apple/char'] as const) {
      const [reference, packed] = charTablesPacked[table]
      const bytes = unpackTable(packed, reference === null ? null : unpackTable(charTablesPacked[reference][1]))
      const iterator = createRuleBreakIterator(parseBreakRules(bytes))
      for (let t = 0; t < 20_000; t++) {
        const alphabet = Array.from({ length: 2 + random(4) }, () => samples[random(samples.length)]!)
        let text = ''
        for (let length = 1 + random(24); length > 0; length--) text += String.fromCodePoint(alphabet[random(alphabet.length)]!)
        iterator.text = text
        iterator.position = 0
        const expected: number[] = []
        for (let b = nextRuleBoundary(iterator); b !== -1; b = nextRuleBoundary(iterator)) expected.push(b)
        expect({ table, text, ends: ends(table, text) }).toEqual({ table, text, ends: expected })
      }
    }
  })
})

describe('measurement invariants', () => {
  test('font-size parsing retains pixel and fallback behavior', async () => {
    const { parseFontSize: parseCssFontSize } = await import('./measurement.ts')
    for (const [font, expected] of [
      ['700 12.5px/1.4 Test Sans', 12.5],
      ['12.34.56px Test Sans', 34.56],
      ['12\tpx Test Sans', 12],
      [`${'1'.repeat(4096)}pt Test Sans`, 16],
    ] as const) expect(parseCssFontSize(font)).toBe(expected)
  })

  test('breakable fit cache distinguishes fit modes', () => {
    const metrics: SegmentMetrics = { width: 80 }
    const cache = new Map<string, SegmentMetrics>([
      ['a', { width: 10 }],
      ['b', { width: 20 }],
      ['c', { width: 30 }],
      ['ab', { width: 35 }],
      ['bc', { width: 60 }],
      ['abc', metrics],
    ])

    expect(getSegmentBreakableFitAdvances('abc', metrics, cache, 0, 'sum-graphemes')).toEqual([10, 20, 30])
    expect(getSegmentBreakableFitAdvances('abc', metrics, cache, 0, 'pair-context')).toEqual([10, 25, 40])
    expect(getSegmentBreakableFitAdvances('abc', metrics, cache, 0, 'segment-prefixes')).toEqual([10, 25, 45])
    expect(getSegmentBreakableFitAdvances('abc', metrics, cache, 0, 'sum-graphemes')).toEqual([10, 20, 30])
  })

  test('the emoji correction counts U+FE0F only after an emoji character', () => {
    // Like Chrome and Firefox on macOS at small sizes, Canvas measures the emoji
    // 4px wider than DOM text.
    const font = '16px Emoji Correction Test'
    const measureText = Object.getOwnPropertyDescriptor(TestCanvasRenderingContext2D.prototype, 'measureText')!
    Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
      ...measureText,
      value(this: TestCanvasRenderingContext2D, text: string) {
        return { width: text === '\u{1F600}' ? 20 : measureWidth(text, this.font) }
      },
    })
    const cases: [string, number][] = [
      ['a\uFE0Fb', 0],
      [' \uFE0F', 0],
      ['\u3000\uFE0F', 0],
      ['1\u20E3', 0],
      ['\u2764\uFE0F', 1],
      ['\u{1F44B}', 1],
      ['1\uFE0F\u20E3', 1],
      ['#\uFE0F\u20E3', 1],
      // Chrome and Firefox draw these from the emoji font too, with the same gap.
      ['1\uFE0F', 1],
      ['#\uFE0F', 1],
    ]
    try {
      const uncorrected = cases.map(([text]) => measureNaturalWidth(prepareWithSegments(text, font)))
      Reflect.set(globalThis, 'document', {
        body: { appendChild: () => undefined, removeChild: () => undefined },
        createElement: () => ({ style: {}, getBoundingClientRect: () => ({ width: 16 }) }),
      })
      clearCache()
      const removed = cases.map(([text], i) => Math.round(uncorrected[i]! - measureNaturalWidth(prepareWithSegments(text, font))))
      expect(removed).toEqual(cases.map(([, count]) => count * 4))
    } finally {
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
      Reflect.deleteProperty(globalThis, 'document')
    }
  })
})

describe('prepare invariants', () => {
  test('whitespace-only input stays empty', () => {
    const prepared = prepare('  \t\n  ', FONT)
    expect(layout(prepared, 200, LINE_HEIGHT)).toEqual({ lineCount: 0, height: 0 })
  })

  test('collapses ordinary whitespace runs and trims the edges', () => {
    const prepared = prepareWithSegments('  Hello\t \n  World  ', FONT)
    expect(prepared.segments).toEqual(['Hello', ' ', 'World'])
  })

  test('pre-wrap mode keeps ordinary spaces instead of collapsing them', () => {
    const prepared = prepareWithSegments('  Hello   World  ', FONT, { whiteSpace: 'pre-wrap' })
    expect(prepared.segments).toEqual(['  ', 'Hello', '   ', 'World', '  '])
    expect(prepared.kinds).toEqual(['preserved-space', 'text', 'preserved-space', 'text', 'preserved-space'])
  })

  test('pre-wrap mode keeps hard breaks as explicit segments', () => {
    const prepared = prepareWithSegments('Hello\nWorld', FONT, { whiteSpace: 'pre-wrap' })
    expect(prepared.segments).toEqual(['Hello', '\n', 'World'])
    expect(prepared.kinds).toEqual(['text', 'hard-break', 'text'])
  })

  test('pre-wrap mode normalizes CRLF into a single hard break', () => {
    const prepared = prepareWithSegments('Hello\r\nWorld', FONT, { whiteSpace: 'pre-wrap' })
    expect(prepared.segments).toEqual(['Hello', '\n', 'World'])
    expect(prepared.kinds).toEqual(['text', 'hard-break', 'text'])
  })

  test('pre-wrap mode keeps tabs as explicit segments', () => {
    const prepared = prepareWithSegments('Hello\tWorld', FONT, { whiteSpace: 'pre-wrap' })
    expect(prepared.segments).toEqual(['Hello', '\t', 'World'])
    expect(prepared.kinds).toEqual(['text', 'tab', 'text'])
  })

  test('a run of no-break spaces is visible text that takes emergency breaks', () => {
    // There is no `glue` kind any more, on purpose (RESEARCH.md, Decisions Log).
    const prepared = prepareWithSegments('\u00A0', FONT)
    expect(prepared.segments).toEqual(['\u00A0'])
    expect(layout(prepared, 200, LINE_HEIGHT)).toEqual({ lineCount: 1, height: LINE_HEIGHT })
    // Between spaces the run is its own segment, which browsers split where it overflows.
    const run = prepareWithSegments('a \u00A0\u202F\u2007 b', FONT)
    expect(run.segments).toEqual(['a', ' ', '\u00A0\u202F\u2007', ' ', 'b'])
    expect(run.kinds).toEqual(['text', 'space', 'text', 'space', 'text'])
    const width = measureWidth('\u00A0\u202F', FONT) + 0.1
    expect(layoutWithLines(run, width, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['a ', '\u00A0\u202F', '\u2007 ', 'b'])
    expect(layout(prepare('a \u00A0\u202F\u2007 b', FONT), width, LINE_HEIGHT).lineCount).toBe(4)
  })

  test('pre-wrap mode keeps whitespace-only input visible', () => {
    const prepared = prepare('   ', FONT, { whiteSpace: 'pre-wrap' })
    expect(layout(prepared, 200, LINE_HEIGHT)).toEqual({ lineCount: 1, height: LINE_HEIGHT })
  })

  test('a word holding a figure space takes emergency breaks', () => {
    const prepared = prepareWithSegments('tail\u2007word', FONT)
    expect(prepared.segments).toEqual(['tail\u2007word'])
    expect(prepared.kinds).toEqual(['text'])
    const width = measureWidth('tail\u2007w', FONT) + 0.1
    expect(layoutWithLines(prepared, width, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['tail\u2007w', 'ord'])
  })

  test('treats zero-width spaces as explicit break opportunities', () => {
    const prepared = prepareWithSegments('alpha\u200Bbeta', FONT)
    expect(prepared.segments).toEqual(['alpha', '\u200B', 'beta'])
    expect(prepared.kinds).toEqual(['text', 'zero-width-break', 'text'])

    const alphaWidth = prepared.widths[0]!
    expect(layout(prepared, alphaWidth + 0.1, LINE_HEIGHT).lineCount).toBe(2)
  })

  test('Blink and Gecko return from an unfit hyphen, and only Blink paints the hyphen unspaced', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    try {
      for (const [index, userAgent, unfitHyphenRetreat, letterSpaceDiscretionaryHyphen] of [
        [0, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', 'reduced-width', false],
        [1, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Safari/605.1.15', 'none', true],
        [2, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0', 'full-width', true],
      ] as const) {
        Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true, writable: true })
        const specifier = `./measurement.ts?unfit-hyphen-${index}`
        const fresh = await import(specifier) as MeasurementModule
        expect(fresh.getEngineProfile()).toMatchObject({ unfitHyphenRetreat, letterSpaceDiscretionaryHyphen })
      }
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, 'navigator')
      else Object.defineProperty(globalThis, 'navigator', descriptor)
    }

    const profile = getEngineProfile()
    const previous = profile.letterSpaceDiscretionaryHyphen
    try {
      profile.letterSpaceDiscretionaryHyphen = true
      const spaced = prepareWithSegments('trans\u00ADatlantic', FONT, { letterSpacing: 2 }).discretionaryHyphenWidth
      profile.letterSpaceDiscretionaryHyphen = false
      const unspaced = prepareWithSegments('trans\u00ADatlantic', FONT, { letterSpacing: 2 }).discretionaryHyphenWidth
      // Both keep the gap before the hyphen; only the first spaces the hyphen.
      expect(spaced - unspaced).toBe(2)
    } finally {
      profile.letterSpaceDiscretionaryHyphen = previous
    }
  })

  test('Blink returns an unfit soft hyphen to the latest earlier break that leaves room for the hyphen', () => {
    const profile = getEngineProfile()
    const previous = profile.unfitHyphenRetreat
    try {
      // "foo trans" fits and "foo trans-" does not.
      const text = 'foo trans\u00ADatlantic'
      const width = measureWidth('foo trans', FONT) + 0.1
      for (const [unfitHyphenRetreat, expected] of [
        ['none', ['foo trans-', 'atlantic']],
        ['reduced-width', ['foo ', 'trans-', 'atlantic']],
      ] as const) {
        profile.unfitHyphenRetreat = unfitHyphenRetreat
        const prepared = prepareWithSegments(text, FONT)
        expect(layoutWithLines(prepared, width, LINE_HEIGHT).lines.map(line => line.text)).toEqual([...expected])
        expect(collectStreamedLines(prepared, width).map(line => line.text)).toEqual([...expected])
        expect(measureLineStats(prepared, width).lineCount).toBe(expected.length)
        expect(layout(prepare(text, FONT), width, LINE_HEIGHT).lineCount).toBe(expected.length)
      }

      // The zero-width space leaves no room for the hyphen, so the line returns
      // to the soft hyphen that the zero-width space replaced as pending.
      const replaced = prepareWithSegments('a b\u00ADc\u200B\u00ADjki', FONT)
      expect(layoutWithLines(replaced, 36, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['a b-', 'c\u200B-', 'jki'])

      // Text after text, or a dash inside a segment, can hold a later real
      // opportunity, so the line never returns past it to the space.
      expect(layoutWithLines(prepareWithSegments('x ab-cd\u00ADefgh', FONT), 62, LINE_HEIGHT).lines.map(line => line.text))
        .toEqual(['x ab-cd-', 'efgh'])
      expect(layoutWithLines(prepareWithSegments('x 10\u201320\u00ADabcd', FONT), 58, LINE_HEIGHT).lines.map(line => line.text))
        .toEqual(['x 10\u201320-', 'abcd'])

      // A handle without soft-hyphen contexts keeps the overflowing hyphen.
      const withoutContexts = { ...prepareWithSegments(text, FONT), discretionaryHyphenContexts: null }
      expect(walkPreparedLinesRaw(withoutContexts, width)).toBe(2)
    } finally {
      profile.unfitHyphenRetreat = previous
    }
  })

  test('Blink keeps an unfit hyphen where the text around the soft hyphen measures narrower joined by the overflow', () => {
    const profile = getEngineProfile()
    const previous = profile.unfitHyphenRetreat
    const measureText = Object.getOwnPropertyDescriptor(TestCanvasRenderingContext2D.prototype, 'measureText')!
    // A and V kern by -2px, so A and VAV measure 2px wider apart than AVAV.
    Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
      ...measureText,
      value(this: TestCanvasRenderingContext2D, text: string) {
        return { width: measureWidth(text, this.font) - 2 * (text.match(/AV/g) ?? []).length }
      },
    })
    profile.unfitHyphenRetreat = 'reduced-width'
    try {
      const font = '16px Kerning Test Sans'
      expect(layoutWithLines(prepareWithSegments('ab B\u00ADVAV', font), 36, LINE_HEIGHT).lines.map(line => line.text))
        .toEqual(['ab ', 'B-', 'VAV'])
      // A and VAV measure 2px narrower joined: the hyphen line stays where it
      // overflows by less, and returns where it overflows by more.
      const joined = prepareWithSegments('ab A\u00ADVAV', font)
      const hyphenLine = measureWidth('ab A', font) + joined.discretionaryHyphenWidth
      expect(layoutWithLines(joined, hyphenLine - 1, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['ab A-', 'VAV'])
      expect(layoutWithLines(joined, hyphenLine - 3, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['ab ', 'AVAV'])
    } finally {
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
      profile.unfitHyphenRetreat = previous
    }
  })

  test('segments at least prefixFitMinWidth wide fit emergency breaks from prefixes, narrower ones from standalone graphemes', () => {
    const profile = getEngineProfile()
    const previous = profile.prefixFitMinWidth
    const measureText = Object.getOwnPropertyDescriptor(TestCanvasRenderingContext2D.prototype, 'measureText')!
    // A and V kern by -2px.
    Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
      ...measureText,
      value(this: TestCanvasRenderingContext2D, text: string) {
        return { width: measureWidth(text, this.font) - 2 * (text.match(/AV/g) ?? []).length }
      },
    })
    try {
      const font = '16px Kerning Fit Test'
      const a = measureWidth('A', font)
      const v = measureWidth('V', font)
      const width = a + v + a - 2
      const advances = () => prepareWithSegments('AVA', font).breakableFitAdvances[0]!.map(advance => Math.round(advance * 1000) / 1000)
      profile.prefixFitMinWidth = width + 1
      expect(advances()).toEqual([a, v, a])
      clearCache()
      profile.prefixFitMinWidth = width
      expect(advances()).toEqual([a, v - 2, a])
    } finally {
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
      profile.prefixFitMinWidth = previous
      clearCache()
    }
  })

  test('an end-limited step returns from an unfit soft hyphen as the continuing text does', () => {
    const profile = getEngineProfile()
    const previous = profile.unfitHyphenRetreat
    profile.unfitHyphenRetreat = 'reduced-width'
    try {
      // "foo trans" fits and "foo trans-" does not.
      const prepared = prepareWithSegments('foo trans\u00ADatlantic', FONT)
      const width = measureWidth('foo trans', FONT) + 0.1
      const continuing = { segmentIndex: 0, graphemeIndex: 0 }
      const continuingWidth = stepPreparedLineGeometry(prepared, continuing, width)
      expect(continuing).toEqual({ segmentIndex: 2, graphemeIndex: 0 })
      // A limit right after the soft hyphen, or inside the word after it, is an
      // ordinary break before later text, so the line returns to the space too.
      for (const [segmentIndex, graphemeIndex] of [[4, 0], [4, 2]] as const) {
        const cursor = { segmentIndex: 0, graphemeIndex: 0 }
        expect(stepPreparedLineGeometry(prepared, cursor, width, segmentIndex, graphemeIndex)).toBe(continuingWidth)
        expect(cursor).toEqual(continuing)
      }
    } finally {
      profile.unfitHyphenRetreat = previous
    }
  })

  test('treats soft hyphens as discretionary break points', () => {
    const prepared = prepareWithSegments('trans\u00ADatlantic', FONT)
    expect(prepared.segments).toEqual(['trans', '\u00AD', 'atlantic'])
    expect(prepared.kinds).toEqual(['text', 'soft-hyphen', 'text'])

    const wide = layoutWithLines(prepared, 200, LINE_HEIGHT)
    expect(wide.lineCount).toBe(1)
    expect(wide.lines.map(line => line.text)).toEqual(['transatlantic'])

    const prefixed = prepareWithSegments('foo trans\u00ADatlantic', FONT)
    const softBreakWidth = Math.max(
      prefixed.widths[0]! + prefixed.widths[1]! + prefixed.widths[2]! + prefixed.discretionaryHyphenWidth,
      prefixed.widths[4]!,
    ) + 0.1
    const narrow = layoutWithLines(prefixed, softBreakWidth, LINE_HEIGHT)
    expect(narrow.lineCount).toBe(2)
    expect(narrow.lines.map(line => line.text)).toEqual(['foo trans-', 'atlantic'])
    expect(narrow.lines[0]!.width).toBeCloseTo(
      prefixed.widths[0]! + prefixed.widths[1]! + prefixed.widths[2]! + prefixed.discretionaryHyphenWidth,
      5,
    )
    expect(layout(prefixed, softBreakWidth, LINE_HEIGHT).lineCount).toBe(narrow.lineCount)

    const hyphenAndOneGraphemeWidth =
      prefixed.widths[0]! +
      prefixed.widths[1]! +
      prefixed.widths[2]! +
      prefixed.breakableFitAdvances[4]![0]! +
      prefixed.discretionaryHyphenWidth +
      0.1
    const strict = layoutWithLines(prefixed, hyphenAndOneGraphemeWidth, LINE_HEIGHT)
    expect(strict.lines.map(line => line.text)).toEqual(['foo trans-', 'atlantic'])
    expect(collectStreamedLines(prefixed, hyphenAndOneGraphemeWidth)).toEqual(strict.lines)
    expect(layout(prefixed, hyphenAndOneGraphemeWidth, LINE_HEIGHT).lineCount).toBe(strict.lineCount)
  })

  test("text segments end where Blink's scan finds a break", () => {
    // A user agent Pretext doesn't recognize takes Blink's scan, so each text segment
    // runs to the scan's next break, and a collapsed space is its own segment.
    const cases = (wordBreak: 'normal' | 'keep-all', rows: ReadonlyArray<readonly [string, readonly string[]]>) => {
      for (const [text, expected] of rows) {
        const { segments, kinds } = prepareWithSegments(text, FONT, { wordBreak })
        expect({ text, wordBreak, segments, kinds }).toEqual({ text, wordBreak, segments: [...expected], kinds: expected.map(segment => segment === ' ' ? 'space' : 'text') })
      }
    }
    cases('normal', [
      ['hello.', ['hello.']],
      // No-break spaces and joiners stay inside their text.
      ['Hello\u00A0world', ['Hello\u00A0world']],
      ['10\u202F000', ['10\u202F000']],
      ['a\u2007\u2007b', ['a\u2007\u2007b']],
      ['foo\u2060bar', ['foo\u2060bar']],
      ['مرحبا، عالم؟', ['مرحبا،', ' ', 'عالم؟']],
      ['وحوارى بكشء،ٍ من قولهم', ['وحوارى', ' ', 'بكشء،ٍ', ' ', 'من', ' ', 'قولهم']],
      ['فيقول:وعليك السلام', ['فيقول:وعليك', ' ', 'السلام']],
      ['همزةٌ،ما كان', ['همزةٌ،ما', ' ', 'كان']],
      ['كل ِّواحدةٍ', ['كل', ' ', 'ِّواحدةٍ']],
      ['नमस्ते। दुनिया॥', ['नमस्ते।', ' ', 'दुनिया॥']],
      ['ဖြစ်သည်။ နောက်တစ်ခု၊ ကိုက်ချီ၍ ယုံကြည်မိကြ၏။', ['ဖြစ်သည်။', ' ', 'နောက်တစ်ခု၊', ' ', 'ကိုက်', 'ချီ၍', ' ', 'ယုံကြည်', 'မိ', 'ကြ၏။']],
      ['ကျွန်ုပ်၏လက်မဖြင့်', ['ကျွန်ုပ်၏လက်မ', 'ဖြင့်']],
      ['“Whenever', ['“Whenever']],
      ['“Take ’em downstairs', ['“Take', ' ', '’em', ' ', 'downstairs']],
      ['invented, “‘George B. Wilson', ['invented,', ' ', '“‘George', ' ', 'B.', ' ', 'Wilson']],
      ['said "hello" there', ['said', ' ', '"hello"', ' ', 'there']],
      [String.raw`say \"hello\" there`, ['say', ' ', String.raw`\"hello\"`, ' ', 'there']],
      [String.raw`((\"\"word`, [String.raw`((\"\"word`]],
      ['“ hello', ['“', ' ', 'hello']],
      ['$___', ['$___']],
      ['$500', ['$500']],
      ['500€', ['500€']],
      ['+500', ['+500']],
      ['−500', ['−500']],
      ['foo%bar', ['foo%bar']],
      ['50°C', ['50°C']],
      ['$(12.35)', ['$(12.35)']],
      ['-1/12', ['-1/12']],
      // Times and numbers keep a closing full-width comma (#225).
      ['a 00:00:00\uFF0Cb', ['a', ' ', '00:00:00\uFF0C', 'b']],
      ['2025-08-01 00:00:00\uFF0C2025-08-01 00:00:00', ['2025-', '08-', '01', ' ', '00:00:00\uFF0C', '2025-', '08-', '01', ' ', '00:00:00']],
      ['00:00:00\uFF0C2025', ['00:00:00\uFF0C', '2025']],
      ['12:30\uFF0Cb', ['12:30\uFF0C', 'b']],
      ['window 7:00-9:00 only', ['window', ' ', '7:00-', '9:00', ' ', 'only']],
      ['SSN 420-69-8008 filed', ['SSN', ' ', '420-', '69-', '8008', ' ', 'filed']],
      ['यह २४×७ सपोर्ट है', ['यह', ' ', '२४×७', ' ', 'सपोर्ट', ' ', 'है']],
      ['see https://example.com/reports/q3?lang=ar&mode=full now', ['see', ' ', 'https://example.com/reports/q3?', 'lang=ar&mode=full', ' ', 'now']],
      [
        'foo;bar foo:bar foo,bar foo.bar as;lkdfjals;k ééé.ééé αβγ.δεζ אבג.דהו',
        ['foo;bar', ' ', 'foo:bar', ' ', 'foo,bar', ' ', 'foo.bar', ' ', 'as;lkdfjals;k', ' ', 'ééé.ééé', ' ', 'αβγ.δεζ', ' ', 'אבג.דהו'],
      ],
      ...['`', '~', '!', '@', '#', '^', '&', '*', '=', '/', '{', '}', '[', ']', '|', '"', '<', '>', '♂', '╥', '∟', '┌', '#$']
        .map(symbol => [`foo${symbol}bar`, [`foo${symbol}bar`]] as const),
      ['#hashtag mention@domain', ['#hashtag', ' ', 'mention@domain']],
      ['foo?bar', ['foo?', 'bar']],
      ['foo—bar', ['foo', '—', 'bar']],
      ['foo…bar', ['foo…', 'bar']],
      ['foo‼bar', ['foo‼', 'bar']],
      ['foo🙂bar', ['foo', '🙂', 'bar']],
      ['universe—so', ['universe', '—', 'so']],
      ['=== heading ===', ['===', ' ', 'heading', ' ', '===']],
      ['('.repeat(256), ['('.repeat(256)]],
      ['((()', ['((()']],
      ['((() ===', ['((()', ' ', '===']],
      ['棄てゝ行く', ['棄', 'てゝ', '行', 'く']],
      ['作者はさつき、「下人', ['作', '者', 'は', 'さ', 'つ', 'き、', '「下', '人']],
      ['中文，测试。', ['中', '文，', '测', '试。']],
      ['테스트입니다.', ['테', '스', '트', '입', '니', '다.']],
      ['foo 世界', ['foo 世', '界']],
      // An opening bracket after CJK stays with the annotation after it.
      ['서울(Seoul)과', ['서', '울', '(Seoul)', '과']],
      ['東京(Tokyo)と', ['東', '京', '(Tokyo)', 'と']],
      ['北京(Beijing)和', ['北', '京', '(Beijing)', '和']],
      ['참조[1]와', ['참', '조', '[1]', '와']],
      ['AB(CD)', ['AB(CD)']],
      ...['𠀀', '\u{2EBF0}', '\u{31350}', '\u{323B0}'].flatMap(sample => [
        [`${sample}${sample}`, [sample, sample]] as const,
        [`${sample}。`, [`${sample}。`]] as const,
      ]),
    ])
    cases('keep-all', [
      // Blink's pair table breaks before `¿` after `.`, and after `?` before a letter.
      ['アwww.¿www.?־', ['アwww.', '¿www.?־']],
      ['x中www.a/www.b?q', ['x中www.a/www.b?', 'q']],
      ['中文，测试。', ['中文，', '测试。']],
      ['한국어테스트', ['한국어테스트']],
      ['漢'.repeat(256), ['漢'.repeat(256)]],
      ...['abc日本語', '123日本語', 'abc123日本語', 'foo_bar日本語', 'foo.bar日本語', '500円テスト', '日本語foo.bar', 'foo 世界']
        .map(text => [text, [text]] as const),
      ['日本語foo-bar', ['日本語foo-', 'bar']],
      // UAX #14 breaks before an em dash (B2) after a letter (LB31), and Chrome
      // breaks there too once the text is narrow enough.
      ['日本語foo—bar', ['日本語foo', '—', 'bar']],
      ['foo-bar日本語', ['foo-', 'bar日本語']],
      ['foo—bar日本語', ['foo', '—', 'bar日本語']],
      ['foo?bar日本語', ['foo?', 'bar日本語']],
    ])
  })

  test('keeps opening punctuation attached to the following word', () => {
    const textBefore = 'aaaaaaaaaaaaaaaaaaa'
    for (const opener of ['¡', '¿', '‚', '„', '\u2E18']) {
      const prepared = prepareWithSegments(`${textBefore} ${opener}Wort`, FONT)
      expect(prepared.segments).toEqual([textBefore, ' ', `${opener}Wort`])

      const strandedOpenerWidth = measureWidth(`${textBefore} ${opener}`, FONT) + 0.1
      expect(layoutWithLines(prepared, strandedOpenerWidth, LINE_HEIGHT).lines.map(line => line.text)).toEqual([
        `${textBefore} `,
        `${opener}Wort`,
      ])
    }
  })

  test('a URL line returns to the latest hyphen that fits', () => {
    const text = 'https://alpha-beta-gamma-delta.example.test/path'
    // Blink's pair table breaks after these hyphens, and ICU after U+2010.
    const prepared = prepareWithSegments(text, FONT)
    expect(prepared.segments).toEqual(['https://alpha-', 'beta-', 'gamma-', 'delta.example.test/path'])
    const width = measureWidth('https://alpha-bet', FONT) + 0.1
    const batched = layoutWithLines(prepared, width, LINE_HEIGHT)
    expect(batched.lines[0]?.text).toBe('https://alpha-')
    expect(batched.lines[1]?.text).toBe('beta-gamma-')
    expect(collectStreamedLines(prepared, width)).toEqual(batched.lines)
    expect(layout(prepared, width, LINE_HEIGHT).lineCount).toBe(batched.lineCount)
    expect(measureLineStats(prepared, width).lineCount).toBe(batched.lineCount)

    const unicodeDash = prepareWithSegments('https://alpha\u2010beta\u2010gamma.example.test/path', FONT)
    const unicodeWidth = measureWidth('https://alpha\u2010b', FONT) + 0.1
    expect(layoutWithLines(unicodeDash, unicodeWidth, LINE_HEIGHT).lines[0]?.text).toBe('https://alpha\u2010')
  })

  test('keeps text after a mark that ends CJK text where the engine keeps the pair', () => {
    // #274 and #293. IS, CP, PO and QU keep a following letter or number, and
    // Blink's pair table, which this profile follows, also keeps `/`, `|`, `!` and
    // `}`. `?` and full-width marks don't, and a hyphen keeps its own rules.
    for (const [text, expected] of [
      ['甲乙丙.first_week_voltage}户', ['甲', '乙', '丙.first_week_voltage}', '户']],
      ['甲乙丙,1234户', ['甲', '乙', '丙,1234', '户']],
      ['甲乙丙)first户', ['甲', '乙', '丙)first', '户']],
      ['甲乙丙%first户', ['甲', '乙', '丙%first', '户']],
      ["甲乙丙'first_week户", ['甲', '乙', "丙'first_week", '户']],
      ['甲乙丙|first_week户', ['甲', '乙', '丙|first_week', '户']],
      ['甲乙丙/first_week户', ['甲', '乙', '丙/first_week', '户']],
      ['가나다.first', ['가', '나', '다.first']],
      ['甲乙丙.foo-bar', ['甲', '乙', '丙.foo-', 'bar']],
      ['甲乙丙?first户', ['甲', '乙', '丙?', 'first', '户']],
      ['甲乙丙。first户', ['甲', '乙', '丙。', 'first', '户']],
      // Chromium's line_normal.brk keeps the text after a closing curly quote (LB19a).
      // Chrome breaks there under line_normal_cj.brk, which Pretext doesn't ship.
      ['中文””tail', ['中', '文””tail']],
    ] as const) {
      expect(prepareWithSegments(text, FONT).segments).toEqual([...expected])
    }
    // A joined run that doesn't fit an empty line still breaks between graphemes.
    const prepared = prepareWithSegments('丙.first_week_voltage', FONT)
    const width = measureWidth('丙.first', FONT) + 0.1
    const lines = layoutWithLines(prepared, width, LINE_HEIGHT).lines
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.map(line => line.text).join('')).toBe('丙.first_week_voltage')
    expect(collectStreamedLines(prepared, width)).toEqual(lines)
  })

  test('engine profiles follow the layout engine the user agent names', async () => {
    const { getLayoutEngine } = await import('./measurement.ts')
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
    const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)'
    const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
    // A page and its workers see the same user agent, so each row names one
    // engine in every scope.
    for (const [userAgent, engine] of [
      [`${mac} Version/26.5.2 Safari/605.1.15`, 'webkit'],
      [`${iPhone} Version/18.5 Mobile/15E148 Safari/604.1`, 'webkit'],
      // iOS browsers run WebKit, whatever their brand token.
      [`${iPhone} CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1`, 'webkit'],
      [`${iPhone} FxiOS/142.0 Mobile/15E148 Safari/604.1`, 'webkit'],
      [`${iPhone} EdgiOS/140.0.3485.94 Mobile/15E148 Safari/605.1.15`, 'webkit'],
      // iPadOS desktop-mode requests name a Mac, and an app's web view names no browser.
      [`${mac} CriOS/140 Version/11.1.1 Safari/605.1.15`, 'webkit'],
      [`${iPhone} Mobile/15E148`, 'webkit'],
      [mac, 'webkit'],
      // Blink's user agent also names Safari/537.36.
      [chrome, 'blink'],
      [`${chrome} Edg/140.0.3485.94`, 'blink'],
      ['Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.7339.101 Mobile Safari/537.36', 'blink'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0', 'gecko'],
      ['Mozilla/5.0 (Android 14; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0', 'gecko'],
      // AppleWebKit/537.36 without a Blink token names no engine: a Samsung TV
      // web view, and jsdom, whose navigator.vendor is Apple's.
      ['Mozilla/5.0 (SMART-TV; LINUX; Tizen 9.0) AppleWebKit/537.36 (KHTML, like Gecko) 120.0.6099.5/9.0 TV Safari/537.36', null],
      ['Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0', null],
      ['Bun/1.4.0', null],
    ] as const) {
      expect({ userAgent, engine: getLayoutEngine(userAgent) }).toEqual({ userAgent, engine })
    }
  })

  test('Chromium breaks after closing brackets before CJK text, not after a closing quote before Hangul', () => {
    // Fullwidth closing brackets are UAX #14 CL, and Chromium breaks between CL and ID.
    for (const close of ['\u300D', '\u300F', '\u3011', '\u300B', '\u3009', '\u3015', '\uFF09']) {
      expect(prepareWithSegments(`\u6587${close}\u6587`, FONT).segments).toEqual([`\u6587${close}`, '\u6587'])
    }
    expect(prepareWithSegments('\uB2E4.\u300D\uB77C\uACE0', FONT).segments).toEqual(['\uB2E4.\u300D', '\uB77C', '\uACE0'])
    // No break after a period and closing quote before Hangul (UAX #14 LB19a).
    expect(prepareWithSegments('\uC5B4.\u201D\uB77C\uACE0', FONT).segments).toEqual(['\uC5B4.\u201D\uB77C', '\uACE0'])
  })

  test('CJK closing punctuation and nonstarters cannot start a line', () => {
    // UAX #14 CL, NS and the non-extending CM U+3035, in context and after a bracket.
    for (const follower of ['\u301E', '\u301F', '\uFF3D', '\uFF5D', '\uFF60', '\uFF61', '\uFF63', '\uFF64', '\u301C', '\u303C', '\u309B', '\u309C', '\u30A0', '\uFF65', '\u3035']) {
      expect(prepareWithSegments(`\u6587${follower}\u6587`, FONT).segments).toEqual([`\u6587${follower}`, '\u6587'])
      expect(prepareWithSegments(`\u6587\u300D${follower}\u30A2`, FONT).segments).toEqual([`\u6587\u300D${follower}`, '\u30A2'])
    }
    // The word segmenter can join a nonstarter with the kana after it.
    expect(prepareWithSegments('\u6587\u30FD\u30A2', FONT).segments).toEqual(['\u6587\u30FD', '\u30A2'])
  })

  test('small kana and U+30FC start a line only where the profile resolves them to ID', () => {
    const profile = getEngineProfile()
    const previous = { ...profile }
    const segments = (text: string, wordBreak: 'normal' | 'keep-all' = 'normal') =>
      prepareWithSegments(text, FONT, { wordBreak }).segments.join('|')
    const texts = ['\u65E5\u672C\u30A1\u30A2', '\u65E5\u672C\u30FC\u30FC', '\u307F\u305D\u30E9\u30FC\u30E1\u30F3', '\u65E5\u672C\uFF01\u30FC\u30FC']
    try {
      // ICU's normal rules resolve CJ to ID, as Chromium does on every page, so both
      // may start a line after ideographs, kana and EX.
      expect(texts.map(text => segments(text))).toEqual(['\u65E5|\u672C|\u30A1|\u30A2', '\u65E5|\u672C|\u30FC|\u30FC', '\u307F|\u305D|\u30E9|\u30FC|\u30E1|\u30F3', '\u65E5|\u672C\uFF01|\u30FC|\u30FC'])
      // A closing bracket (CL) keeps NS after it but not ID (LB16).
      expect(segments('\u65E5\u672C\u300D\u30A1\u30A2', 'keep-all')).toBe('\u65E5\u672C\u300D|\u30A1\u30A2')
      // Strict rules resolve CJ to NS, as libicucore does on pages other than ja and
      // ko, and Gecko on every page, so neither may.
      const strict = ['\u65E5|\u672C\u30A1|\u30A2', '\u65E5|\u672C\u30FC\u30FC', '\u307F|\u305D|\u30E9\u30FC|\u30E1|\u30F3', '\u65E5|\u672C\uFF01\u30FC\u30FC']
      profile.lineBreakScan = 'webkit'
      expect(texts.map(text => segments(text))).toEqual(strict)
      profile.lineBreakScan = 'gecko'
      expect(texts.map(text => segments(text))).toEqual(strict)
      expect(segments('\u65E5\u672C\u300D\u30A1\u30A2', 'keep-all')).toBe('\u65E5\u672C\u300D\u30A1\u30A2')
    } finally {
      Object.assign(profile, previous)
    }
  })

  test('keep-all runs continue after letters that cannot start a line', () => {
    const keepAll = { wordBreak: 'keep-all' } as const
    // Blink keeps any pair of letters, including U+3005, U+303C, U+3035, U+309D,
    // U+30FD and U+30FC.
    for (const letter of ['\u3005', '\u303C', '\u3035', '\u309D', '\u30FD', '\u30FC']) {
      const text = `\u4E2D\u6587${letter}\u4E2D\u6587`
      expect(prepareWithSegments(text, FONT, keepAll).segments).toEqual([text])
    }
    expect(prepareWithSegments('\u30E9\u30FC\u30E1\u30F3', FONT, keepAll).segments).toEqual(['\u30E9\u30FC\u30E1\u30F3'])
    // Punctuation still ends a run.
    for (const punctuation of ['\u300D', '\u3001', '\u30FB']) {
      const text = `\u4E2D\u6587${punctuation}\u4E2D\u6587`
      expect(prepareWithSegments(text, FONT, keepAll).segments).toEqual([`\u4E2D\u6587${punctuation}`, '\u4E2D\u6587'])
    }

    // ICU4X keeps pairs by line-break class: it breaks after NS letters, but not
    // after U+3035 (CM) or U+30FC (CJ).
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    profile.lineBreakScan = 'gecko'
    try {
      for (const letter of ['\u3005', '\u303C', '\u309D', '\u30FD']) {
        const text = `\u4E2D\u6587${letter}\u4E2D\u6587`
        expect(prepareWithSegments(text, FONT, keepAll).segments).toEqual([`\u4E2D\u6587${letter}`, '\u4E2D\u6587'])
      }
      for (const letter of ['\u3035', '\u30FC']) {
        const text = `\u4E2D\u6587${letter}\u4E2D\u6587`
        expect(prepareWithSegments(text, FONT, keepAll).segments).toEqual([text])
      }
    } finally {
      profile.lineBreakScan = previous
    }
  })

  test('keep-all runs end where the engine does not keep a pair and its ordinary rules break', () => {
    const keepAll = { wordBreak: 'keep-all' } as const
    const segments = (text: string) => prepareWithSegments(text, FONT, keepAll).segments
    // Engines break before an opening bracket (UAX #14 OP) after an ideograph,
    // including a letter that cannot start a line, and next to an SA letter.
    for (const letter of ['\u6587', '\u3005', '\u30FC']) {
      expect(segments(`\u4E2D\u6587${letter}\u300C\u4E2D\u6587`)).toEqual([`\u4E2D\u6587${letter}`, '\u300C\u4E2D\u6587'])
    }
    expect(segments('\uC11C\uC6B8(\uD55C\uAD6D)\uC5D0\uC11C')).toEqual(['\uC11C\uC6B8', '(\uD55C\uAD6D)', '\uC5D0\uC11C'])
    expect(segments('\u4E2D\u6587\u00A1\u6F22\u5B57')).toEqual(['\u4E2D\u6587', '\u00A1\u6F22\u5B57'])
    expect(segments('\u4E2D\u6587\u0E44\u0E17\u0E22\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u0E44\u0E17\u0E22', '\u4E2D\u6587'])
    // SA letters read as AL, which keeps a following Latin letter (LB28).
    expect(segments('\u4E2D\u6587\u0E44\u0E17\u0E22abc\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u0E44\u0E17\u0E22abc\u4E2D\u6587'])
    // Blink never keeps a symbol or a supplementary character, whatever marks
    // follow it. U+09FA is AL, not a numeric affix.
    for (const symbol of ['\u2605', '\u2665\uFE0F', '\u09FA', '\u{20000}']) {
      expect(segments(`\u4E2D\u6587${symbol}\u4E2D\u6587`)).toEqual(['\u4E2D\u6587', symbol, '\u4E2D\u6587'])
    }
    // Blink looks past one mark, so an ideographic variation selector, a
    // surrogate to Blink, or a second mark hides the letter before it.
    expect(segments('\u4E2D\u6587\u845B\u{E0100}\u4E2D\u6587')).toEqual(['\u4E2D\u6587\u845B\u{E0100}', '\u4E2D\u6587'])
    expect(segments('\u4E2D\u6587\u6587\u0301\u0301\u4E2D\u6587')).toEqual(['\u4E2D\u6587\u6587\u0301\u0301', '\u4E2D\u6587'])
    expect(segments('\u4E2D\u6587\u6587\u0301\u4E2D\u6587')).toEqual(['\u4E2D\u6587\u6587\u0301\u4E2D\u6587'])
    // Emoji and fullwidth symbols are ID, so the ordinary rules break next to
    // them, but not between AL pictographs such as U+1F4AF. A closing bracket
    // ends a run before an ideograph, and the run inside the brackets stays whole.
    expect(segments('\u8F9B\u82E6\u4E86\u{1F389}\u{1F389}')).toEqual(['\u8F9B\u82E6\u4E86', '\u{1F389}', '\u{1F389}'])
    expect(segments('\u660E\u5929\u89C1\u{1F44B}\uFF5E')).toEqual(['\u660E\u5929\u89C1', '\u{1F44B}', '\uFF5E'])
    expect(segments('\u4E2D\u6587\u{1F4AF}\u{1F4AF}\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u{1F4AF}\u{1F4AF}', '\u4E2D\u6587'])
    expect(segments('\u4E2D\u6587\u2768\u{1F60A}\u2769\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u2768\u{1F60A}\u2769', '\u4E2D\u6587'])
    // Punctuation whose class breaks after it ends a run before an ideograph (SY,
    // NS, IN and BA), and so does a keycap. AL symbols such as U+00A9 and U+2192
    // keep each other but break before an East Asian opener (LB30), and a pair of
    // regional indicators breaks against the next pair (LB30a). BB keeps what
    // follows, and fullwidth digits are ID.
    for (const [text, expected] of [
      ['\u4E2D\u6587\u{1F60A}/\u4E2D\u6587', ['\u4E2D\u6587', '\u{1F60A}/', '\u4E2D\u6587']],
      ['\u4E2D\u6587\u{1F60A}\u203C\u4E2D\u6587', ['\u4E2D\u6587', '\u{1F60A}\u203C', '\u4E2D\u6587']],
      ['\u4E2D\u6587\u{1F60A}\u2025\u4E2D\u6587', ['\u4E2D\u6587', '\u{1F60A}\u2025', '\u4E2D\u6587']],
      ['\u4E2D\u6587\u2605|\u4E2D\u6587', ['\u4E2D\u6587', '\u2605|', '\u4E2D\u6587']],
      ['\u4E2D\u65871\uFE0F\u20E3\u4E2D\u6587', ['\u4E2D\u65871\uFE0F\u20E3', '\u4E2D\u6587']],
      ['\u4E2D\u6587\u00A9\u00A9\u2192\u300C\u4E2D\u6587', ['\u4E2D\u6587', '\u00A9\u00A9\u2192', '\u300C\u4E2D\u6587']],
      ['\u4E2D\u6587\u{1F1EF}\u{1F1F5}\u{1F1F0}\u{1F1F7}\u4E2D\u6587', ['\u4E2D\u6587', '\u{1F1EF}\u{1F1F5}', '\u{1F1F0}\u{1F1F7}', '\u4E2D\u6587']],
      ['\u4E2D\u6587\u00B4\u{E0100}\u4E2D\u6587', ['\u4E2D\u6587', '\u00B4\u{E0100}\u4E2D\u6587']],
      ['\u4E2D\u6587\uFF11\uFF10\uFF5E\uFF12\uFF10\u4E2D\u6587', ['\u4E2D\u6587\uFF11\uFF10', '\uFF5E', '\uFF12\uFF10\u4E2D\u6587']],
    ] as const) {
      expect(segments(text)).toEqual([...expected])
    }
    // Where some rule keeps the pair, a run continues: before a closing bracket
    // or U+3002, after an opening bracket or ZWJ, and next to a mark, which takes
    // its base's class, even U+3035 (CM) after an opening bracket. U+035C is GL
    // and keeps the next character. Listed punctuation ends the keep-all group,
    // so text without CJK after it keeps its ordinary boundaries.
    for (const [text, expected] of [
      ['\u597D\u7684\u{1F60A}\u3002', ['\u597D\u7684', '\u{1F60A}\u3002']],
      ['\u8A55\u4FA1\uFF3B\u2605\u2605\uFF3D\u3067\u3059', ['\u8A55\u4FA1', '\uFF3B\u2605\u2605\uFF3D', '\u3067\u3059']],
      ['\u4E2D\u200D\u2665\u4E2D\u6587', ['\u4E2D\u200D\u2665', '\u4E2D\u6587']],
      ['\u4E2D\u6587\u300C\u3035\u2605\u4E2D\u6587', ['\u4E2D\u6587', '\u300C\u3035\u2605', '\u4E2D\u6587']],
      ['\u4E2D\u6587\u2605\u035C\u4E2D\u6587', ['\u4E2D\u6587', '\u2605\u035C\u4E2D\u6587']],
      ['\u4E2D\u6587\u300D\u{1F60A}abc def', ['\u4E2D\u6587\u300D', '\u{1F60A}', 'abc', ' ', 'def']],
      // LB30 keeps a letter or number only with an opener that is not East
      // Asian, and a BB letter such as U+02C8 keeps any following character.
      ['\u4E2D\u6587a\u300Cb\u4E2D\u6587', ['\u4E2D\u6587a', '\u300Cb\u4E2D\u6587']],
      ['\u4E2D\u6587a(b\u4E2D\u6587', ['\u4E2D\u6587a(b\u4E2D\u6587']],
      ['\u4E2D\u6587\u02C8\u300C\u6F22\u5B57', ['\u4E2D\u6587\u02C8\u300C\u6F22\u5B57']],
    ] as const) {
      expect(segments(text)).toEqual([...expected])
    }
    // Latin letters, digits such as Thai digits (NU) and symbols whose class keeps
    // a neighbor, such as U+275D (QU), continue a run. U+3000 (BA) ends one.
    for (const text of [
      '\u4E2D\u6587abc\u4E2D\u6587', '\u4E2D\u6587\uFF11\uFF12\u4E2D\u6587',
      '\u4E2D\u6587\u0E51\u0E52\u0E53\u4E2D\u6587', '\u4E2D\u6587\u275D\u6F22\u5B57\u275E\u4E2D\u6587',
    ]) {
      expect(segments(text)).toEqual([text])
    }
    expect(segments('\u4E2D\u6587\u6587\u3000\u300C\u4E2D\u6587')).toEqual(['\u4E2D\u6587\u6587\u3000', '\u300C\u4E2D\u6587'])
    // A run split from a keep-all group keeps the group's emergency grapheme
    // breaks, even when none of its own pieces is a word.
    for (const [narrow, lines] of [
      ['\u4E2D\u6587\u2605\u3001\u4E2D\u6587', ['\u4E2D', '\u6587', '\u2605', '\u3001', '\u4E2D', '\u6587']],
      ['\u4E2D\u6587\u300C\u2605\u4E2D\u6587', ['\u4E2D', '\u6587', '\u300C', '\u2605', '\u4E2D', '\u6587']],
    ] as const) {
      expect(layoutWithLines(prepareWithSegments(narrow, FONT, keepAll), 16.1, LINE_HEIGHT).lines.map(line => line.text))
        .toEqual([...lines])
      expect(layout(prepare(narrow, FONT, keepAll), 16.1, LINE_HEIGHT).lineCount).toBe(6)
    }

    const profile = getEngineProfile()
    const previous = { ...profile }
    try {
      // A conditional Japanese starter such as U+30FC starts a line after a symbol
      // under Chromium's normal rules.
      expect(segments('\u4E2D\u6587\u2605\u30FC\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u2605', '\u30FC\u4E2D\u6587'])

      // ICU 78 breaks before an opening quotation mark and after a closing one
      // between East Asian characters (LB19a), but not after a period.
      expect(segments('\u4E2D\u6587\u201C\u6F22\u5B57\u201D\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u201C\u6F22\u5B57\u201D', '\u4E2D\u6587'])
      expect(segments('\u4E2D\u6587\u2018\u6F22\u5B57\u2019\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u2018\u6F22\u5B57\u2019', '\u4E2D\u6587'])
      expect(segments('\uC5B4.\u201D\uB77C\uACE0')).toEqual(['\uC5B4.\u201D\uB77C\uACE0'])
      expect(segments('\u4E2D\u6587a\u201C\u6F22\u5B57')).toEqual(['\u4E2D\u6587a\u201C\u6F22\u5B57'])
      // Emoji-presentation characters count as East Asian, and U+303F does not.
      expect(segments('\u4E2D\u6587\u201C\u{1F60A}\u201D\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u201C\u{1F60A}\u201D', '\u4E2D\u6587'])
      expect(segments('\u4E2D\u6587\u303F\u201C\u6F22\u5B57')).toEqual(['\u4E2D\u6587', '\u303F\u201C\u6F22\u5B57'])

      // After a Hebrew letter, ICU 78 keeps the next character only after HY or
      // HH (LB21a), so a run ends after U+007C (BA).
      expect(segments('\u4E2D\u6587\u05D0|\u4E2D\u6587')).toEqual(['\u4E2D\u6587\u05D0|', '\u4E2D\u6587'])

      // Gecko's scan follows ICU4X, whose Unicode 15.0 rules put no break next to a
      // quotation mark. They also keep any character after a Hebrew letter and BA,
      // past marks, though a Hebrew letter still starts a run after an ideograph.
      profile.lineBreakScan = 'gecko'
      expect(segments('\u4E2D\u6587\u2605\u30FC\u4E2D\u6587')).toEqual(['\u4E2D\u6587\u2605\u30FC\u4E2D\u6587'])
      expect(segments('\u4E2D\u6587\u201C\u6F22\u5B57\u201D\u4E2D\u6587')).toEqual(['\u4E2D\u6587\u201C\u6F22\u5B57\u201D\u4E2D\u6587'])
      expect(segments('\u4E2D\u6587\u05D0|\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u05D0|\u4E2D\u6587'])
      expect(segments('\u4E2D\u6587\u05D0\u05B8\u2027\u0301\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u05D0\u05B8\u2027\u0301\u4E2D\u6587'])

      // ICU4X keeps symbols, supplementary ideographs and variation selectors by
      // class, but still breaks before an opening bracket, after a closing one and
      // next to an SA letter, and Firefox breaks at the end of a run of SA letters
      // whatever follows, small kana (CJ) included. A mark takes its base's class,
      // so U+3035 after a closing bracket breaks. WebKit breaks at spaces, and after
      // punctuation in text above U+00FF.
      for (const symbol of ['\u2605', '\u2665\uFE0F', '\u{20000}', '\u845B\u{E0100}', '\u{1F389}\u{1F389}']) {
        const text = `\u4E2D\u6587${symbol}\u4E2D\u6587`
        expect(segments(text)).toEqual([text])
      }
      expect(segments('\u4E2D\u6587\u00A1\u6F22\u5B57')).toEqual(['\u4E2D\u6587', '\u00A1\u6F22\u5B57'])
      expect(segments('\u4E2D\u6587\u2768\u6F22\u5B57\u2769\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u2768\u6F22\u5B57\u2769', '\u4E2D\u6587'])
      expect(segments('\u4E2D\u6587\u0E44\u0E17\u0E22\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u0E44\u0E17\u0E22', '\u4E2D\u6587'])
      expect(segments('\u4E2D\u6587\u{11700}\u{11701}\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u{11700}\u{11701}', '\u4E2D\u6587'])
      expect(segments('\u4E2D\u6587\u0E44\u0E17\u0E22\u3041\u4E2D\u6587')).toEqual(['\u4E2D\u6587', '\u0E44\u0E17\u0E22', '\u3041\u4E2D\u6587'])
      expect(segments('\u4E2D\u6587\u300D\u3035\u4E2D\u6587')).toEqual(['\u4E2D\u6587\u300D\u3035', '\u4E2D\u6587'])
      profile.lineBreakScan = 'webkit'
      for (const text of ['\u4E2D\u6587\u2605\u4E2D\u6587', '\u4E2D\u6587\u0E44\u0E17\u0E22\u4E2D\u6587']) {
        expect(segments(text)).toEqual([text])
      }
      expect(segments('\u4E2D\u6587\u00A1\u6F22\u5B57')).toEqual(['\u4E2D\u6587\u00A1', '\u6F22\u5B57'])
    } finally {
      Object.assign(profile, previous)
    }
  })

  test('break scans follow the layout engine the user agent names', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    try {
      // WebKit fits emergency breaks from grapheme prefixes, Gecko in segments at least 80px wide,
      // Blink from standalone graphemes.
      for (const [userAgent, scan, prefixes] of [
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', 'blink', Infinity],
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0', 'gecko', 80],
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Safari/605.1.15', 'webkit', 0],
        // An app web view names no browser.
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', 'webkit', 0],
        // Engines Pretext doesn't recognize take Blink's scan.
        ['Bun/1.4.0', 'blink', Infinity],
      ] as const) {
        Object.defineProperty(globalThis, 'navigator', { value: { userAgent, vendor: '' }, configurable: true })
        const measurement = await import(`./measurement.ts?user-agent=${encodeURIComponent(userAgent)}`) as MeasurementModule
        const profile = measurement.getEngineProfile()
        expect({ userAgent, scan: profile.lineBreakScan, prefixes: profile.prefixFitMinWidth }).toEqual({ userAgent, scan, prefixes })
      }
    } finally {
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, 'navigator')
      } else {
        Object.defineProperty(globalThis, 'navigator', descriptor)
      }
    }
  })

  test("Safari's scan follows the page language, and Chromium's line rules don't", () => {
    const segments = (text: string, lineBreakScan: 'blink' | 'webkit', language: string) =>
      analyzeText(text, { ...getEngineProfile(), lineBreakScan }, 'normal', 'normal', language).texts.join('|')
    // libicucore opens its normal line rules on ja and ko pages, where small kana (CJ)
    // are ID, and strict rules, where CJ is NS, on others. Chromium's line_normal.brk
    // resolves CJ to ID on every page.
    for (const [language, webkit] of [['en', '日|本ァ|ア'], ['ja', '日|本|ァ|ア'], ['ko-KR', '日|本|ァ|ア'], ['zh', '日|本ァ|ア']] as const) {
      expect({ language, webkit: segments('日本ァア', 'webkit', language), blink: segments('日本ァア', 'blink', language) })
        .toEqual({ language, webkit, blink: '日|本|ァ|ア' })
    }
    // Apple ICU's quotation remap makes curly quotes brackets, except on ja pages. Next to
    // East Asian text, Safari 27's quotation classes decide before ICU on every page.
    // Safari 26's rules aren't ported (RESEARCH.md, Decisions Log).
    expect(segments('£€£€““tail', 'webkit', 'en')).toBe('£|€|£|€|““tail')
    expect(segments('£€£€““tail', 'webkit', 'ja')).toBe('£|€|£|€““tail')
    expect(segments('中文“abc”中文', 'webkit', 'ja')).toBe('中|文|“abc”|中|文')
    // The remap is looked up under ICU's case, then with its parent fallback: pt_PT
    // doesn't remap ‘, where pt, through root, does.
    for (const language of ['pt-PT', 'pt-pt', 'PT_pt', 'pt-pt-x-a']) expect(segments('£€£€‘‘tail', 'webkit', language)).toBe('£|€|£|€‘‘tail')
    expect(segments('£€£€‘‘tail', 'webkit', 'pt')).toBe('£|€|£|€|‘‘tail')
  })

  test('treats Hangul compatibility jamo as CJK break units', () => {
    const prepared = prepareWithSegments('ㅋㅋㅋ 진짜', FONT)
    expect(prepared.segments).toEqual(['ㅋ', 'ㅋ', 'ㅋ', ' ', '진', '짜'])

    const width = measureWidth('ㅋㅋ', FONT) + 0.1
    const lines = layoutWithLines(prepared, width, LINE_HEIGHT)
    expect(lines.lines.map(line => line.text)).toEqual(['ㅋㅋ', 'ㅋ ', '진짜'])
    expect(layout(prepared, width, LINE_HEIGHT)).toEqual({
      lineCount: 3,
      height: LINE_HEIGHT * 3,
    })
  })

  test('adjacent CJK text units stay breakable after visible text, not only after spaces', () => {
    const prepared = prepareWithSegments('foo 世界 bar', FONT)
    expect(prepared.segments).toEqual(['foo', ' ', '世', '界', ' ', 'bar'])

    const width = prepared.widths[0]! + prepared.widths[1]! + prepared.widths[2]! + 0.1
    const batched = layoutWithLines(prepared, width, LINE_HEIGHT)
    expect(batched.lines.map(line => line.text)).toEqual(['foo 世', '界 bar'])

    const streamed = []
    let cursor = { segmentIndex: 0, graphemeIndex: 0 }
    while (true) {
      const line = layoutNextLine(prepared, cursor, width)
      if (line === null) break
      streamed.push(line.text)
      cursor = line.end
    }
    expect(streamed).toEqual(['foo 世', '界 bar'])
    expect(layout(prepared, width, LINE_HEIGHT)).toEqual({ lineCount: 2, height: LINE_HEIGHT * 2 })
  })

  test('kinsoku clusters stay ordinary units but still take emergency grapheme breaks', () => {
    const text = '漢。字'
    const prepared = prepareWithSegments(text, FONT)
    expect(prepared.segments).toEqual(['漢。', '字'])
    const clusterWidth = measureWidth('漢。', FONT)
    for (const [width, expected] of [
      [clusterWidth + 0.1, ['漢。', '字']],
      [clusterWidth - 0.1, ['漢', '。', '字']],
    ] as const) {
      const result = layoutWithLines(prepared, width, LINE_HEIGHT)
      expect(result.lines.map(line => line.text)).toEqual([...expected])
      expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
      const walked: string[] = []
      walkLineRanges(prepared, width, line => walked.push(slicePreparedText(prepared, line.start, line.end)))
      expect(walked).toEqual([...expected])
      expect(layout(prepare(text, FONT), width, LINE_HEIGHT).lineCount).toBe(expected.length)
    }

    const lines = (source: string, width: number) =>
      layoutWithLines(prepareWithSegments(source, FONT), width, LINE_HEIGHT).lines.map(line => line.text)
    const graphemeWidth = measureWidth('漢', FONT)
    expect(lines('「漢字」。', graphemeWidth + 0.1)).toEqual(['「', '漢', '字', '」', '。'])
    // A number keeps the punctuation after it until only the number fits.
    expect(lines('1234。b', (measureWidth('1234', FONT) + measureWidth('1234。', FONT)) / 2)).toEqual(['1234', '。b'])

    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    try {
      // Where U+30FC can't start a line, as under libicucore's root rules, `本ーー` is one
      // unit that still breaks in an emergency.
      profile.lineBreakScan = 'webkit'
      expect(lines('日本ーー', graphemeWidth * 2.5)).toEqual(['日', '本ー', 'ー'])
    } finally {
      profile.lineBreakScan = previous
    }
  })

  test('the WebKit profile keeps punctuation after an overflowing first character in text above U+00FF', () => {
    const profile = getEngineProfile()
    const previous = { ...profile }
    const lines = (source: string, options?: { letterSpacing: number }) => {
      const prepared = prepareWithSegments(source, FONT, options)
      const result = layoutWithLines(prepared, 1, LINE_HEIGHT)
      expect(collectStreamedLines(prepared, 1)).toEqual(result.lines)
      expect(layout(prepare(source, FONT, options), 1, LINE_HEIGHT).lineCount).toBe(result.lineCount)
      return result.lines.map(line => line.text)
    }
    try {
      profile.lineBreakScan = 'webkit'
      // Safari 27 paints these at a width below one character; 8-bit `xb((c` takes one
      // character per line.
      expect(lines('xb((cā')).toEqual(['x', 'b((', 'c', 'ā'])
      expect(lines('xb((cā', { letterSpacing: 1 })).toEqual(['x', 'b((', 'c', 'ā'])
      expect(lines('xb((c')).toEqual(['x', 'b', '(', '(', 'c'])
      // Blink and Gecko end the line after the first grapheme.
      profile.lineBreakScan = 'blink'
      expect(lines('xb((cā')).toEqual(['x', 'b', '(', '(', 'c', 'ā'])
    } finally {
      Object.assign(profile, previous)
    }
  })

  test('the WebKit profile ends a line at U+2028 and U+2029', () => {
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    try {
      profile.lineBreakScan = 'webkit'
      for (const text of ['aaa\u2028bbb ccc', 'aaa\u2029bbb ccc']) {
        const prepared = prepareWithSegments(text, FONT)
        const result = layoutWithLines(prepared, 1000, LINE_HEIGHT)
        expect(result.lines.map(line => line.text)).toEqual(['aaa', 'bbb ccc'])
        expect(collectStreamedLines(prepared, 1000)).toEqual(result.lines)
        expect(layout(prepare(text, FONT), 1000, LINE_HEIGHT).lineCount).toBe(2)
      }
    } finally {
      profile.lineBreakScan = previous
    }
  })

  test('keep-all letter groups take emergency breaks where the word segmenter marks CJK as not a word', async () => {
    const { clearAnalysisCaches } = await import('./analysis.ts')
    // Firefox's word segmenter doesn't mark some CJK text as a word.
    const Segmenter = Intl.Segmenter
    Reflect.set(Intl, 'Segmenter', class extends Segmenter {
      override segment(input: string): Intl.Segments {
        const segments = super.segment(input)
        if (this.resolvedOptions().granularity !== 'word') return segments
        const pieces = Array.from(segments, piece => /[\p{Script=Han}\p{Script=Hangul}]/u.test(piece.segment) ? { ...piece, isWordLike: false } : piece)
        return Object.assign(pieces, { containing: (index?: number) => segments.containing(index) }) as unknown as Intl.Segments
      }
    })
    clearAnalysisCaches()
    try {
      for (const text of ['漢字漢字', '한국어텍스트']) {
        const graphemes = getSegmentGraphemes(text)
        const width = measureWidth(graphemes[0]!, FONT) + 0.1
        const prepared = prepareWithSegments(text, FONT, { wordBreak: 'keep-all' })
        const result = layoutWithLines(prepared, width, LINE_HEIGHT)
        expect(result.lines.map(line => line.text)).toEqual(graphemes)
        expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
        expect(layout(prepare(text, FONT, { wordBreak: 'keep-all' }), width, LINE_HEIGHT).lineCount).toBe(graphemes.length)
      }
    } finally {
      Reflect.set(Intl, 'Segmenter', Segmenter)
      clearAnalysisCaches()
    }
  })

  test('text needs Intl.Segmenter only in the runs the scans break by dictionary, such as Thai', async () => {
    const { clearAnalysisCaches } = await import('./analysis.ts')
    const Segmenter = Intl.Segmenter
    Reflect.deleteProperty(Intl, 'Segmenter')
    clearAnalysisCaches()
    try {
      for (const lineBreakScan of ['blink', 'webkit', 'gecko'] as const) {
        const profile = { lineBreakScan, graphemeTable: 'chromium/char' as const }
        for (const text of ['Hello, world.', '漢字かな、한국어', 'العربية', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} #\uFE0F\u20E3', '\u0915\u094D\u0937\u093F', 'a\u00ADb c\u200Bd']) {
          expect(analyzeText(text, profile).texts.join('')).toBe(text)
        }
        expect(() => analyzeText('ภาษาไทย', profile)).toThrow()
      }
      const prepared = prepareWithSegments('Hello \u{1F44B} 漢字', FONT, { letterSpacing: 1 })
      expect(layoutWithLines(prepared, 1000, LINE_HEIGHT).lineCount).toBe(1)
    } finally {
      Reflect.set(Intl, 'Segmenter', Segmenter)
      clearAnalysisCaches()
    }
  })

  test('locale can be reset without disturbing later prepares', () => {
    setLocale('th')
    const thai = prepare('ภาษาไทยภาษาไทย', FONT)
    expect(layout(thai, 80, LINE_HEIGHT).lineCount).toBeGreaterThan(0)

    setLocale(undefined)
    const latin = prepare('hello world', FONT)
    expect(layout(latin, 200, LINE_HEIGHT)).toEqual({ lineCount: 1, height: LINE_HEIGHT })
  })

  test('setLocale() only clears the caches, so the page language still picks the break rules', () => {
    // Kept for compatibility, a documented decision (RESEARCH.md, Decisions Log). Chrome's
    // zh table would make the curly quotes brackets here.
    const text = '中文“abc”中文'
    const segments = prepareWithSegments(text, FONT).segments
    for (const locale of ['zh', 'zh-Hant', 'ja']) {
      setLocale(locale)
      expect(prepareWithSegments(text, FONT).segments).toEqual(segments)
    }
  })

  test('later prepares measure under a changed document language', () => {
    // Like Chrome's OffscreenCanvas, this context resolves a font under the
    // document language only when a different font string is assigned.
    const root = { lang: 'en' }
    class LanguageResolvingContext {
      resolvedFont = ''
      resolvedLanguage = ''

      get font(): string {
        return this.resolvedFont
      }

      set font(value: string) {
        if (value === this.resolvedFont) return
        this.resolvedFont = value
        this.resolvedLanguage = root.lang
      }

      measureText(text: string): { width: number } {
        return { width: measureWidth(text, this.resolvedFont) * (this.resolvedLanguage === 'ko' ? 0.75 : 1) }
      }
    }
    Reflect.set(globalThis, 'OffscreenCanvas', class {
      getContext(): LanguageResolvingContext {
        return new LanguageResolvingContext()
      }
    })
    Reflect.set(globalThis, 'document', { documentElement: root })
    try {
      const english = measureNaturalWidth(prepareWithSegments('中文 日本語', FONT))
      root.lang = 'ko'
      expect(measureNaturalWidth(prepareWithSegments('中文 日本語', FONT))).toBeCloseTo(english * 0.75, 10)
      root.lang = 'en'
      clearCache()
      expect(measureNaturalWidth(prepareWithSegments('中文 日本語', FONT))).toBeCloseTo(english, 10)
    } finally {
      Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
      Reflect.deleteProperty(globalThis, 'document')
    }
    // The restored backend replaces the language-resolving context.
    expect(measureNaturalWidth(prepareWithSegments('中文 日本語', FONT))).toBeCloseTo(measureWidth('中文日本語', FONT) + measureWidth(' ', FONT), 10)
  })

  test('the WebKit profile names the generic families of the page language in the Canvas font', async () => {
    const { getEngineProfile } = await import('./measurement.ts')
    const profile = getEngineProfile()
    const previous = profile.namesGenericFamiliesByLanguage
    const root = { lang: '' }
    const assigned: string[] = []
    // The families a context has: macOS's of the table's pairs, or none of them, as on iOS.
    let installed: readonly string[] = []
    class RecordingContext {
      current = ''
      get font(): string {
        return this.current
      }
      set font(value: string) {
        this.current = value
        assigned.push(value)
      }
      measureText(text: string): { width: number } {
        const first = /"([^"]+)"/.exec(this.current)?.[1]
        return { width: measureWidth(text, this.current) + (first !== undefined && installed.includes(first) ? 1 : 0) }
      }
    }
    Reflect.set(globalThis, 'OffscreenCanvas', class {
      getContext(): RecordingContext {
        return new RecordingContext()
      }
    })
    // A document that can't create a `<canvas>`: the families come from a table, on
    // purpose (RESEARCH.md, Decisions Log).
    Reflect.set(globalThis, 'document', { documentElement: root })
    profile.namesGenericFamiliesByLanguage = true
    const macos = ['AppleMyungjo', 'Songti SC', 'Songti TC', 'Lucida Grande', 'Apple Chancery', 'ITF Devanagari']
    try {
      // Language, font, then the Canvas font with macOS's families and, where it differs, with iOS's.
      for (const [lang, font, onMacOS, onIOS] of [
        ['ko', '16px "PingFang SC", sans-serif', '16px "PingFang SC", "Apple SD Gothic Neo"'],
        ['ko-KR', '16px serif', '16px "AppleMyungjo"', '16px "Apple SD Gothic Neo"'],
        ['ja-JP', 'italic 700 16px/20px Georgia, SERIF', 'italic 700 16px/20px Georgia, "Hiragino Mincho ProN"'],
        // Safari on macOS can't use Core Text's Kaiti SC and draws Songti SC.
        ['zh-Hans', '16px cursive', '16px "Songti SC"', '16px "PingFang SC"'],
        ['zh-Hant-HK', '16px monospace', '16px "Menlo"'],
        ['zh-Hans-HK', '16px sans-serif', '16px "PingFang SC"'],
        ['zh-Hant-CN', '16px serif', '16px "Songti TC"', '16px "PingFang TC"'],
        // A plain Han language takes zh-hans, whatever Core Text names for its region.
        ['zh', '16px sans-serif', '16px "PingFang SC"'],
        ['zh-MO', '16px sans-serif', '16px "PingFang SC"'],
        ['zh-Hant-MO', '16px sans-serif', '16px "PingFang MO"'],
        ['yue-Hant', '16px sans-serif', '16px "PingFang HK"'],
        // Latin pages change only fantasy and monospace.
        ['en', '16px sans-serif, fantasy, monospace', '16px sans-serif, "Zapfino", "Menlo"'],
        ['en-US', '16px "Courier New", Courier, monospace', '16px "Courier New", Courier, "Menlo"'],
        ['ru', '16px cursive', '16px "Snell Roundhand"'],
        ['he', '16px sans-serif, cursive, fantasy', '16px "Lucida Grande", "Apple Chancery", fantasy', '16px "Arial Hebrew", "Arial Hebrew", fantasy'],
        ['hi', '16px serif', '16px "ITF Devanagari"', '16px "Kohinoor Devanagari"'],
        // Where iOS has macOS's family too, macOS's stands.
        ['ar-SA', '16px monospace', '16px "Menlo"'],
        ['th', '16px serif', '16px "Thonburi"'],
        ['sr-Latn', '16px cursive', '16px "Snell Roundhand"'],
        // Quoted names aren't keywords, and a language whose script is Common keeps them.
        ['ja', '16px "sans-serif", "Foo, serif", \'a,serif\', system-ui, ui-serif', '16px "sans-serif", "Foo, serif", \'a,serif\', system-ui, ui-serif'],
        ['yue', '16px sans-serif', '16px sans-serif'],
        ['eo', '16px monospace', '16px monospace'],
        ['en-Zyyy', '16px monospace', '16px monospace'],
      ] as const) {
        for (const [system, families, expected] of [['macOS', macos, onMacOS], ['iOS', [], onIOS ?? onMacOS]] as const) {
          installed = families
          // A new language makes a new context, which asks again which families it has.
          root.lang = ''
          prepare('あ', font)
          root.lang = lang
          prepare('あ', font)
          expect({ system, lang, font: assigned.at(-1) }).toEqual({ system, lang, font: expected })
        }
      }
      profile.namesGenericFamiliesByLanguage = false
      root.lang = 'ko'
      prepare('あ', '16px serif')
      expect(assigned.at(-1)).toBe('16px serif')
    } finally {
      profile.namesGenericFamiliesByLanguage = previous
      Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
      Reflect.deleteProperty(globalThis, 'document')
      clearCache()
    }
  })

  test('the page language resolves to a break language by its primary subtag', async () => {
    const { getBreakLanguage } = await import('./line-breaks.ts')
    for (const [tag, language] of [
      ['ja', 'ja'], ['JA', 'ja'], ['ja-JP', 'ja'], ['jA_jp', 'ja'], ['ko', 'ko'], ['Ko-KR', 'ko'],
      ['zh', 'zh'], ['zh-Hant-TW', 'zh'], ['ZH-hans', 'zh'],
      ['en', 'root'], ['', 'root'], [null, 'root'], ['j', 'root'], ['jav', 'root'], ['kok', 'root'], ['x-ja', 'root'],
    ] as const) {
      expect({ tag, language: getBreakLanguage(tag) }).toEqual({ tag, language })
    }
  })
})

describe('rich-inline invariants', () => {
  test('rich boundary trimming preserves internal spaces and non-collapsible content', () => {
    for (const boundary of [' ', '\t', '\n', '\f', '\r']) {
      const prepared = prepareRichInline([
        { text: `${boundary}A${boundary.repeat(64)}B${boundary}`, font: FONT },
        { text: '', font: FONT },
        { text: boundary, font: '32px Test Sans' },
        { text: '\u00A0C\u00A0', font: FONT },
      ])
      const range = layoutNextRichInlineLineRange(prepared, Infinity)!
      const line = materializeRichInlineLineRange(prepared, range)
      expect(line.fragments.map(fragment => [fragment.itemIndex, fragment.text])).toEqual([
        [0, 'A B'], [3, '\u00A0C\u00A0'],
      ])
      expect(line.fragments[1]!.gapBefore).toBeCloseTo(measureWidth(' ', FONT), 8)
      expect(range.end).toEqual({ itemIndex: 4, segmentIndex: 0, graphemeIndex: 0 })
    }
  })

  test('a whole zero-width rich item fits the end of an exactly filled line', () => {
    const prepared = prepareRichInline([
      { text: 'A', font: FONT },
      { text: '', font: FONT },
      { text: '\u200B', font: FONT },
    ])
    const line = layoutNextRichInlineLineRange(prepared, measureWidth('A', FONT))!
    expect(line.fragments.map(fragment => fragment.itemIndex)).toEqual([0, 2])
    expect(line.end).toEqual({ itemIndex: 3, segmentIndex: 0, graphemeIndex: 0 })
    expect(layoutNextRichInlineLineRange(prepared, 1, line.end)).toBeNull()
    expect(measureRichInlineStats(prepared, measureWidth('A', FONT)).lineCount).toBe(1)
  })

  test('a following negative-advance rich item cannot undo forced overflow', () => {
    const prepared = prepareRichInline([
      { text: 'A', font: FONT },
      { text: 'B', font: FONT, letterSpacing: -measureWidth('B', FONT) - 1 },
    ])
    const width = measureWidth('A', FONT) - 0.02
    const first = layoutNextRichInlineLineRange(prepared, width)!
    expect(first.fragments.map(fragment => fragment.itemIndex)).toEqual([0])
    expect(first.end).toEqual({ itemIndex: 1, segmentIndex: 0, graphemeIndex: 0 })
    expect(measureRichInlineStats(prepared, width).lineCount).toBe(2)
  })

  test('rich boundary SPACE retains signed advance and public geometry', () => {
    const zeroGapSpacing = -measureWidth(' ', FONT)
    for (const letterSpacing of [-10, zeroGapSpacing - 0.1, zeroGapSpacing, zeroGapSpacing + 0.1, 0, 2]) {
      expect(variant.checkRichContracts({ font: FONT, letterSpacing }).failures).toEqual([])
    }
  })

  test('collapsed rich whitespace keeps the first SPACE style even at nonpositive advance', () => {
    const spaceFont = '8px Test Sans'
    for (const letterSpacing of [-5, -measureWidth(' ', spaceFont), 1]) {
      const source = prepareWithSegments(' ', spaceFont, { whiteSpace: 'pre-wrap', letterSpacing })
      const space = layoutNextLineRange(source, { segmentIndex: 0, graphemeIndex: 0 }, Infinity)!
      // The gap keeps the signed advance; a line holding only this SPACE
      // reports it clamped at zero.
      const spaceAdvance = measureWidth(' ', spaceFont) + letterSpacing
      expect(space.width).toBeCloseTo(Math.max(0, spaceAdvance), 8)
      const prepared = prepareRichInline([
        { text: 'A', font: FONT },
        { text: ' ', font: spaceFont, letterSpacing },
        { text: ' ', font: '32px Test Sans', letterSpacing: 3 },
        { text: 'B', font: FONT },
      ])
      const line = layoutNextRichInlineLineRange(prepared, Infinity)!
      expect(line.fragments.map(fragment => fragment.itemIndex)).toEqual([0, 3])
      expect(line.fragments[1]!.gapBefore).toBeCloseTo(spaceAdvance, 8)
      expect(line.width).toBeCloseTo(measureWidth('A', FONT) + spaceAdvance + measureWidth('B', FONT), 8)
    }
  })

  test('a rich fragment names the item whose collapsed whitespace made its gap', () => {
    const gapItems = (items: Array<{ text: string, font?: string, break?: 'never', letterSpacing?: number }>, maxWidth = Infinity) => {
      const prepared = prepareRichInline(items.map(item => ({ font: FONT, ...item })))
      const lines: Array<Array<[number, number]>> = []
      walkRichInlineLineRanges(prepared, maxWidth, range => {
        lines.push(range.fragments.map(fragment => [fragment.itemIndex, fragment.gapItemIndex]))
      })
      return lines
    }
    // The previous item's trailing whitespace, else the first whitespace-only
    // item after it, else the item's own leading whitespace.
    for (const [texts, fragments] of [
      [['a', 'b'], [[0, -1], [1, -1]]],
      [['a ', ' b'], [[0, -1], [1, 0]]],
      [['a', ' b'], [[0, -1], [1, 1]]],
      [['a', ' ', '  ', 'b'], [[0, -1], [3, 1]]],
      [['a ', '\t', 'b'], [[0, -1], [2, 0]]],
      [['a', '', '\n b'], [[0, -1], [2, 2]]],
      [['a ', '\u200B', 'b'], [[0, -1], [1, 0], [2, -1]]],
      // An item holding only a soft hyphen isn't line content: its fragment
      // has no gap, and it ends the pending space.
      [['a ', '\u00AD', ' b'], [[0, -1], [1, -1], [2, 2]]],
    ] as const) {
      expect(gapItems(texts.map(text => ({ text })))).toEqual([fragments.map(fragment => [...fragment])])
    }
    expect(gapItems([{ text: 'Tag' }, { text: ' @maya', break: 'never' }])).toEqual([[[0, -1], [1, 1]]])
    // A gap of zero or negative advance still names its item.
    for (const letterSpacing of [-measureWidth(' ', FONT), -measureWidth(' ', FONT) - 2]) {
      expect(gapItems([{ text: 'A' }, { text: ' B', letterSpacing }])).toEqual([[[0, -1], [1, 1]]])
    }
    // A line's first fragment has no gap.
    expect(gapItems([{ text: 'A ' }, { text: 'B' }], measureWidth('A', FONT))).toEqual([[[0, -1]], [[1, -1]]])
    // Materialized fragments keep the item, and the gap takes that item's font.
    const codeFont = '12px Test Sans'
    const prepared = prepareRichInline([
      { text: 'Call', font: FONT },
      { text: ' make build', font: codeFont },
      { text: ' now', font: FONT },
    ])
    const range = layoutNextRichInlineLineRange(prepared, Infinity)!
    expect(materializeRichInlineLineRange(prepared, range).fragments.map(fragment => [fragment.text, fragment.gapItemIndex])).toEqual([
      ['Call', -1], ['make build', 1], ['now', 2],
    ])
    expect(range.fragments[1]!.gapBefore).toBeCloseTo(measureWidth(' ', codeFont), 8)
  })

  test('rich ordinary break rights survive zero and negative SPACE advances', () => {
    for (const gap of [-2, 0, 2]) {
      const prepared = prepareRichInline([
        { text: 'A', font: FONT },
        { text: ' ', font: FONT, letterSpacing: gap - measureWidth(' ', FONT) },
        { text: 'BCDEF', font: FONT },
      ])
      const first = layoutNextRichInlineLineRange(prepared, measureWidth('AB', FONT))!
      expect(materializeRichInlineLineRange(prepared, first).fragments.map(fragment => fragment.text)).toEqual(['A'])
      expect(first.end).toEqual({ itemIndex: 2, segmentIndex: 0, graphemeIndex: 0 })
    }
  })

  test('a signed rich gap retains the width deficit after forced overflow', () => {
    const letterSpacing = -measureWidth(' ', FONT) - 2
    const prepared = prepareRichInline([
      { text: 'x ', font: FONT, letterSpacing },
      { text: 'y', font: FONT, letterSpacing },
    ])
    const first = layoutNextRichInlineLineRange(prepared, 1)!
    expect(materializeRichInlineLineRange(prepared, first).fragments.map(fragment => fragment.text)).toEqual(['x'])
    const second = layoutNextRichInlineLineRange(prepared, 1, first.end)!
    expect(materializeRichInlineLineRange(prepared, second).fragments.map(fragment => fragment.text)).toEqual(['y'])
    expect(second.fragments[0]!.gapBefore).toBe(0)
  })

  test('letterSpacing preserves the terminal gap inside rich-inline items', () => {
    const spacing = 3
    const prepared = prepareRichInline([
      { text: 'AB', font: FONT, letterSpacing: spacing },
    ])

    expect(measureRichInlineStats(prepared, 200)).toEqual({
      lineCount: 1,
      maxLineWidth: measureWidth('AB', FONT) + spacing * 2,
    })
  })

  test('letterSpacing preserves rich-inline gaps across styled item boundaries', () => {
    const spacing = 3
    const prepared = prepareRichInline([
      { text: 'A', font: '700 16px Test Sans', letterSpacing: spacing },
      { text: 'BC', font: FONT, letterSpacing: spacing },
    ])
    const expectedWidth =
      measureWidth('A', '700 16px Test Sans') +
      measureWidth('BC', FONT) +
      spacing * 3
    const firstItemWidth = measureWidth('A', '700 16px Test Sans') + spacing

    expect(measureRichInlineStats(prepared, 200)).toEqual({
      lineCount: 1,
      maxLineWidth: expectedWidth,
    })
    expect(layoutNextRichInlineLineRange(prepared, firstItemWidth + 0.1)).toMatchObject({
      fragments: [
        { itemIndex: 0 },
      ],
      width: firstItemWidth,
    })
  })

  test('rich range materialization preserves styled atomic-item geometry', () => {
    const prepared = prepareRichInline([
      { text: 'Ship ', font: FONT },
      { text: '@maya', font: '700 12px Test Sans', break: 'never', extraWidth: 18 },
      { text: "'s rich note wraps cleanly", font: FONT },
    ])
    const ranges: NonNullable<ReturnType<typeof layoutNextRichInlineLineRange>>[] = []
    const count = walkRichInlineLineRanges(prepared, 120, range => ranges.push(structuredClone(range)))
    expect(count).toBe(ranges.length)
    expect(measureRichInlineStats(prepared, 120)).toEqual({
      lineCount: count,
      maxLineWidth: Math.max(...ranges.map(range => range.width)),
    })
    for (const range of ranges) {
      const line = materializeRichInlineLineRange(prepared, range)
      expect({ ...line, fragments: line.fragments.map(({ text: _text, ...fragment }) => fragment) }).toEqual(range)
    }
  })

  test('layoutNextRichInlineLineRange leaves the start cursor reusable', () => {
    const prepared = prepareRichInline([
      { text: 'Ship ', font: FONT },
      { text: '@maya', font: '700 12px Test Sans', break: 'never', extraWidth: 18 },
      { text: "'s rich note wraps cleanly", font: FONT },
    ])
    const start = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 }
    const firstLine = layoutNextRichInlineLineRange(prepared, 120, start)

    expect(firstLine).not.toBeNull()
    expect(start).toEqual({ itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 })
    expect(layoutNextRichInlineLineRange(prepared, 120, start)).toEqual(firstLine)

    const nextStart = { ...firstLine!.end }
    expect(layoutNextRichInlineLineRange(prepared, 120, firstLine!.end)).not.toBeNull()
    expect(firstLine!.end).toEqual(nextStart)
  })

  test('rich inline item boundaries do not accept forced-progress overflow', () => {
    const maxWidth = measureWidth('A', FONT) + 1
    const prepared = prepareRichInline([
      { text: 'A', font: FONT },
      { text: 'C', font: FONT },
      { text: 'D', font: FONT },
    ])
    const widths: number[] = []

    const lineCount = walkRichInlineLineRanges(prepared, maxWidth, line => {
      widths.push(line.width)
    })

    expect(widths).toEqual([
      measureWidth('A', FONT),
      measureWidth('C', FONT),
      measureWidth('D', FONT),
    ])
    expect(measureRichInlineStats(prepared, maxWidth)).toEqual({
      lineCount,
      maxLineWidth: Math.max(...widths),
    })
  })

  test('rich line counts do not go up where an item fits within the fit epsilon', () => {
    // Where the walk over the second item takes `on the` only within the fit
    // epsilon, wrapping before that whole item took one more line than 0.1px
    // narrower, where the walk takes only `on`.
    const epsilon = getEngineProfile().lineFitEpsilon
    const lineTexts = (prepared: ReturnType<typeof prepareRichInline>, maxWidth: number): string[] => {
      const streamed: NonNullable<ReturnType<typeof layoutNextRichInlineLineRange>>[] = []
      let range = layoutNextRichInlineLineRange(prepared, maxWidth)
      while (range !== null) {
        streamed.push(range)
        range = layoutNextRichInlineLineRange(prepared, maxWidth, range.end)
      }
      const walked: typeof streamed = []
      expect(walkRichInlineLineRanges(prepared, maxWidth, line => walked.push(structuredClone(line)))).toBe(streamed.length)
      expect(walked).toEqual(streamed)
      expect(measureRichInlineStats(prepared, maxWidth)).toEqual({
        lineCount: streamed.length,
        maxLineWidth: Math.max(...streamed.map(line => line.width)),
      })
      return streamed.map(line => materializeRichInlineLineRange(prepared, line).fragments
        .map(fragment => (fragment.gapItemIndex < 0 ? '' : ' ') + fragment.text).join('').trimEnd())
    }
    const words = prepareRichInline([
      { text: 'Is that ', font: FONT },
      { text: 'on the roadmap?', font: '700 16px Test Sans' },
    ])
    const wider = measureWidth('Is that on the', FONT) - epsilon / 2
    expect(lineTexts(words, wider - 0.1)).toEqual(['Is that on', 'the roadmap?'])
    expect(lineTexts(words, wider)).toEqual(['Is that on the', 'roadmap?'])
    // An atomic item that overflows by less than the epsilon stays on the line too.
    const chip = prepareRichInline([
      { text: 'Tag ', font: FONT },
      { text: '@maya', font: FONT, break: 'never', extraWidth: 18 },
    ])
    expect(lineTexts(chip, measureWidth('Tag @maya', FONT) + 18 - epsilon / 2)).toEqual(['Tag @maya'])
  })

  test('the Chromium profile breaks rich items only where their joined text breaks', () => {
    // Same-font runs from a product page: native text keeps "community," whole,
    // so the comma that starts the third run moves with the word before it.
    // Run extents also come from the joined text: split words, dictionary
    // words, a kinsoku unit and a soft hyphen before a space. At width 30 the
    // item's own segmentation breaks inside a joined Lao word.
    for (const [parts, width] of [
      [['Midjourney operates non-traditionally. Our features are suggested and prioritized by our ', 'community', ', projects are led by engineers and the founder, and the team is strikingly small compared to the size of our community and ambitions.'], 258],
      [['Hello wor', 'ld again'], 85],
      [['\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E27\u0E22\u0E07', '\u0E32\u0E21\u0E02\u0E2D\u0E07\u0E18\u0E23\u0E23\u0E21\u0E0A\u0E32\u0E15\u0E34'], 50],
      [['\u0E9E\u0EB2\u0EAA\u0EB2\u0EA5', '\u0EB2\u0EA7\u0EC0\u0E9B\u0EB1\u0E99\u0E9E\u0EB2\u0EAA\u0EB2'], 60],
      [['\u0E9E\u0EB2\u0EAA\u0EB2\u0EA5', '\u0EB2\u0EA7\u0EC0\u0E9B\u0EB1\u0E99\u0E9E\u0EB2\u0EAA\u0EB2'], 30],
      [['\u1019\u103C\u1014\u103A\u1019\u102C\u1018\u102C\u101E', '\u102C\u101E\u100A\u103A\u101C\u103E\u1015\u101E\u1031\u102C'], 100],
      [['\u4E2D\u6587\u4E2D\u6587', '\u3002\u65E5\u672C\u8A9E'], 40],
      [['foo ba', 'r\u00AD baz'], 64],
      [['a xxxx', '\uFF0Cb'], 54.5],
      [['T', 'po\u00ADd'], 28.8],
    ] as const) {
      const prepared = prepareRichInline(parts.map(text => ({ text, font: FONT })))
      const richLines: string[] = []
      walkRichInlineLineRanges(prepared, width, range => {
        const line = materializeRichInlineLineRange(prepared, range)
        richLines.push(line.fragments.map(fragment => (fragment.gapItemIndex < 0 ? '' : ' ') + fragment.text).join('').trimEnd())
      })
      const flat = layoutWithLines(prepareWithSegments(parts.join(''), FONT), width, LINE_HEIGHT)
      expect(richLines).toEqual(flat.lines.map(line => line.text.trimEnd()))
      expect(measureRichInlineStats(prepared, width).lineCount).toBe(flat.lineCount)
    }
  })

  test('rich line counts do not go up where a soft hyphen line fits only without its hyphen', () => {
    const lineTexts = (items: Parameters<typeof prepareRichInline>[0], maxWidth: number): string[] => {
      const prepared = prepareRichInline(items)
      const lines: string[] = []
      walkRichInlineLineRanges(prepared, maxWidth, range => {
        lines.push(materializeRichInlineLineRange(prepared, range).fragments
          .map(fragment => (fragment.gapItemIndex < 0 ? '' : ' ') + fragment.text).join('').trimEnd())
      })
      expect(measureRichInlineStats(prepared, maxWidth).lineCount).toBe(lines.length)
      return lines
    }
    const profile = getEngineProfile()
    const previous = profile.unfitHyphenRetreat
    try {
      // After `T`, the walk over `po\u00ADd` ends the item's line at the soft
      // hyphen once `po` fits, with a width that includes the hyphen, which
      // doesn't fit. Wrapping before the item then took one more line than 0.1px
      // narrower, although the joined text `Tpo\u00ADd` has no break before `p`.
      // A letter that the walk forces onto the line still wraps before the item.
      const smallFont = '12px Test Sans'
      const split = [{ text: 'T', font: smallFont }, { text: 'po\u00ADd', font: FONT }]
      const poFits = measureWidth('T', smallFont) + measureWidth('po', FONT)
      for (const unfitHyphenRetreat of ['none', 'reduced-width'] as const) {
        profile.unfitHyphenRetreat = unfitHyphenRetreat
        expect(lineTexts(split, poFits - 0.1)).toEqual(['Tp', 'od'])
        expect(lineTexts(split, poFits)).toEqual(['Tpo-', 'd'])
        expect(lineTexts([{ text: 'T', font: FONT }, { text: 'p\u00ADd', font: FONT }], 12)).toEqual(['T', 'p-', 'd'])
      }

      // As in plain text, only the Chromium profile returns from the unfit hyphen
      // to a break before the item, here the space.
      const width = measureWidth('a po', FONT) + 0.1
      for (const [unfitHyphenRetreat, expected] of [
        ['none', ['a po-', 'd']],
        ['reduced-width', ['a', 'pod']],
      ] as const) {
        profile.unfitHyphenRetreat = unfitHyphenRetreat
        expect(lineTexts([{ text: 'a ', font: FONT }, { text: 'po\u00ADd', font: FONT }], width)).toEqual([...expected])
        expect(layoutWithLines(prepareWithSegments('a po\u00ADd', FONT), width, LINE_HEIGHT).lines.map(line => line.text.trimEnd()))
          .toEqual([...expected])
      }
    } finally {
      profile.unfitHyphenRetreat = previous
    }
  })

  test('rich item boundaries keep their breaks while kinsoku units take emergency breaks', () => {
    const richLines = (parts: string[], width: number) => {
      const prepared = prepareRichInline(parts.map(text => ({ text, font: FONT })))
      const lines: string[] = []
      walkRichInlineLineRanges(prepared, width, range => {
        lines.push(materializeRichInlineLineRange(prepared, range).fragments.map(fragment => fragment.text).join(''))
      })
      expect(measureRichInlineStats(prepared, width).lineCount).toBe(lines.length)
      return lines
    }
    expect(richLines(['漢', '。字'], measureWidth('漢。', FONT) + 0.1)).toEqual(['漢。', '字'])
    expect(richLines(['漢', '。字'], measureWidth('漢。', FONT) - 0.1)).toEqual(['漢', '。', '字'])
    expect(richLines(['漢', '字。字'], measureWidth('字。', FONT) + 0.1)).toEqual(['漢', '字。', '字'])
    expect(richLines(['漢', '字。字'], measureWidth('字', FONT) + 0.1)).toEqual(['漢', '字', '。', '字'])
  })

  test('split CJK rich inline items stay inside the line width', () => {
    const maxWidth = measureWidth('中', FONT) + 1
    const prepared = prepareRichInline([
      { text: '中', font: FONT },
      { text: '国 ', font: FONT },
      { text: '文', font: FONT },
    ])
    const widths: number[] = []

    const lineCount = walkRichInlineLineRanges(prepared, maxWidth, range => {
      const line = materializeRichInlineLineRange(prepared, range)
      widths.push(line.width)
    })

    expect(widths).toEqual([
      measureWidth('中', FONT),
      measureWidth('国', FONT),
      measureWidth('文', FONT),
    ])
    expect(measureRichInlineStats(prepared, maxWidth)).toEqual({
      lineCount,
      maxLineWidth: Math.max(...widths),
    })
  })
})

describe('layout invariants', () => {
  test('letterSpacing preserves terminal line-end gaps like browsers', () => {
    const spacing = 4

    const single = layoutWithLines(
      prepareWithSegments('A', FONT, { letterSpacing: spacing }),
      200,
      LINE_HEIGHT,
    )
    expect(single.lines[0]!.width).toBeCloseTo(measureWidth('A', FONT) + spacing, 5)

    const pair = layoutWithLines(
      prepareWithSegments('AB', FONT, { letterSpacing: spacing }),
      200,
      LINE_HEIGHT,
    )
    expect(pair.lines[0]!.width).toBeCloseTo(measureWidth('AB', FONT) + spacing * 2, 5)

    const segmented = layoutWithLines(
      prepareWithSegments('A B', FONT, { letterSpacing: spacing }),
      200,
      LINE_HEIGHT,
    )
    expect(segmented.lines[0]!.width).toBeCloseTo(measureWidth('A B', FONT) + spacing * 3, 5)
  })

  test('letterSpacing zero preserves prepared widths', () => {
    const base = prepareWithSegments('Hello World', FONT)
    const zero = prepareWithSegments('Hello World', FONT, { letterSpacing: 0 })
    expect(zero.widths).toEqual(base.widths)
    expect(zero.breakableFitAdvances).toEqual(base.breakableFitAdvances)
  })

  test('letterSpacing trims the gap before hanging collapsible spaces', () => {
    const spacing = 6
    const lineAWidth = measureWidth('A', FONT)
    const wrapped = layoutWithLines(
      prepareWithSegments('A B', FONT, { letterSpacing: spacing }),
      lineAWidth + 0.1,
      LINE_HEIGHT,
    )

    expect(wrapped.lines.map(line => line.text)).toEqual(['A ', 'B'])
    expect(wrapped.lines[0]!.width).toBeCloseTo(lineAWidth + spacing, 5)
  })

  test('letterSpacing restarts at grapheme line breaks inside a word', () => {
    const spacing = 5
    const prepared = prepareWithSegments('abcd', FONT, { letterSpacing: spacing })
    const twoGraphemesWidth = measureWidth('ab', FONT) + spacing * 2
    const wrapped = layoutWithLines(prepared, twoGraphemesWidth + 0.1, LINE_HEIGHT)

    expect(wrapped.lines.map(line => line.text)).toEqual(['ab', 'cd'])
    expect(wrapped.lines[0]!.width).toBeCloseTo(twoGraphemesWidth, 5)
    expect(wrapped.lines[1]!.width).toBeCloseTo(twoGraphemesWidth, 5)
    expect(layout(prepared, twoGraphemesWidth + 0.1, LINE_HEIGHT).lineCount).toBe(wrapped.lineCount)
  })

  test('letterSpacing uses the trailing fit gap when wrapping inside a word', () => {
    const spacing = 5
    const text = 'abcd'
    const prepared = prepareWithSegments(text, FONT, { letterSpacing: spacing })
    const allPaintWidth = measureWidth(text, FONT) + spacing * (getSegmentGraphemes(text).length - 1)
    const wrapped = layoutWithLines(prepared, allPaintWidth + spacing / 2, LINE_HEIGHT)

    expect(wrapped.lines.map(line => line.text)).toEqual(['abc', 'd'])
    expect(wrapped.lines[0]!.width).toBeCloseTo(measureWidth('abc', FONT) + spacing * 3, 5)
  })

  test('letterSpacing preserves terminal spacing after a visible soft hyphen', () => {
    const spacing = 5
    const prepared = prepareWithSegments('trans\u00ADatlantic', FONT, { letterSpacing: spacing })
    const softHyphenLineWidth = prepared.widths[0]! + prepared.discretionaryHyphenWidth
    const wrapped = layoutWithLines(prepared, softHyphenLineWidth - spacing / 2, LINE_HEIGHT)

    expect(wrapped.lines[0]!.text).toBe('trans-')
    expect(wrapped.lines[0]!.width).toBeCloseTo(softHyphenLineWidth, 5)
    expect(wrapped.lines[1]!.text.startsWith('-')).toBe(false)
  })

  test('letterSpacing trailing fit gap respects combining graphemes', () => {
    const spacing = 5
    const text = 'Cafe\u0301 naive'
    const prepared = prepareWithSegments(text, FONT, { letterSpacing: spacing })
    const prefixPaintWidth = measureWidth('Cafe\u0301', FONT) + spacing * (getSegmentGraphemes('Cafe\u0301').length - 1)
    const wrapped = layoutWithLines(prepared, prefixPaintWidth + spacing / 2, LINE_HEIGHT)

    expect(wrapped.lines[0]!.text).toBe('Caf')
  })

  test('letterSpacing trailing fit gap applies to mixed-direction text', () => {
    const spacing = 5
    const text = 'abc אבג def'
    const prepared = prepareWithSegments(text, FONT, { letterSpacing: spacing })
    const prefixPaintWidth = measureWidth('abc', FONT) + spacing * 2
    const wrapped = layoutWithLines(prepared, prefixPaintWidth + spacing / 2, LINE_HEIGHT)

    expect(wrapped.lines[0]!.text).toBe('ab')
  })

  test('negative letterSpacing tightens inter-grapheme gaps', () => {
    const spacing = -1.5
    const line = layoutWithLines(
      prepareWithSegments('AB', FONT, { letterSpacing: spacing }),
      200,
      LINE_HEIGHT,
    ).lines[0]!

    expect(line.width).toBeCloseTo(measureWidth('AB', FONT) + spacing * 2, 5)
  })

  test('letterSpacing applies across CJK segment boundaries', () => {
    const spacing = 3
    const line = layoutWithLines(
      prepareWithSegments('春天', FONT, { letterSpacing: spacing }),
      200,
      LINE_HEIGHT,
    ).lines[0]!

    expect(line.width).toBeCloseTo(measureWidth('春天', FONT) + spacing * 2, 5)
  })

  test('letterSpacing applies through digits and punctuation', () => {
    const spacing = 2
    const text = '24×7, 7:00-9:00?'
    const line = layoutWithLines(
      prepareWithSegments(text, FONT, { letterSpacing: spacing }),
      300,
      LINE_HEIGHT,
    ).lines[0]!
    const gapCount = getSegmentGraphemes(text).length

    expect(line.width).toBeCloseTo(measureWidth(text, FONT) + spacing * gapCount, 5)
  })

  test('letterSpacing applies through RTL punctuation runs', () => {
    const spacing = 2
    const text = 'مرحبا، عالم؟'
    const line = layoutWithLines(
      prepareWithSegments(text, FONT, { letterSpacing: spacing }),
      300,
      LINE_HEIGHT,
    ).lines[0]!
    const gapCount = getSegmentGraphemes(text).length

    expect(line.width).toBeCloseTo(measureWidth(text, FONT) + spacing * gapCount, 5)
  })

  test('letterSpacing applies across emoji graphemes', () => {
    const spacing = 2
    const line = layoutWithLines(
      prepareWithSegments('A😀B', FONT, { letterSpacing: spacing }),
      200,
      LINE_HEIGHT,
    ).lines[0]!

    expect(line.width).toBeCloseTo(measureWidth('A😀B', FONT) + spacing * 3, 5)
  })

  test('letterSpacing stays line-local across hard breaks', () => {
    const spacing = 4
    const lines = layoutWithLines(
      prepareWithSegments('A\nB', FONT, { whiteSpace: 'pre-wrap', letterSpacing: spacing }),
      200,
      LINE_HEIGHT,
    ).lines

    expect(lines.map(line => line.text)).toEqual(['A', 'B'])
    expect(lines[0]!.width).toBeCloseTo(measureWidth('A', FONT) + spacing, 5)
    expect(lines[1]!.width).toBeCloseTo(measureWidth('B', FONT) + spacing, 5)
  })

  test('letterSpacing participates in pre-wrap tab positioning', () => {
    const spacing = 4
    const text = 'A\tB'
    const prepared = prepareWithSegments(text, FONT, { whiteSpace: 'pre-wrap', letterSpacing: spacing })
    const line = layoutWithLines(prepared, 200, LINE_HEIGHT).lines[0]!
    const aWidth = measureWidth('A', FONT)
    const tabAdvance = nextTabAdvance(aWidth + spacing, measureWidth(' ', FONT))
    const expected = aWidth + spacing + tabAdvance + spacing + measureWidth('B', FONT) + spacing

    expect(line.text).toBe(text)
    expect(line.width).toBeCloseTo(expected, 5)
  })

  // Contextual shaping and discretionary breaks can make this false in general.
  test('ordinary positive-width words gain lines as the container shrinks', () => {
    const prepared = prepare('The quick brown fox jumps over the lazy dog', FONT)
    let previous = 0

    for (const width of [320, 200, 140, 90]) {
      const { lineCount } = layout(prepared, width, LINE_HEIGHT)
      expect(lineCount).toBeGreaterThanOrEqual(previous)
      previous = lineCount
    }
  })

  test('normal mode trims trailing paragraph whitespace before layout', () => {
    const prepared = prepareWithSegments('Hello ', FONT)
    const widthOfHello = prepared.widths[0]!

    expect(layout(prepared, widthOfHello, LINE_HEIGHT).lineCount).toBe(1)

    const withLines = layoutWithLines(prepared, widthOfHello, LINE_HEIGHT)
    expect(withLines.lineCount).toBe(1)
    expect(withLines.lines).toEqual([{
      text: 'Hello',
      width: widthOfHello,
      start: { segmentIndex: 0, graphemeIndex: 0 },
      end: { segmentIndex: 1, graphemeIndex: 0 },
    }])
  })

  test('breaks long words at grapheme boundaries and keeps both layout APIs aligned', () => {
    const prepared = prepareWithSegments('Superlongword', FONT)
    const graphemeWidths = prepared.breakableFitAdvances[0]!
    const maxWidth = graphemeWidths[0]! + graphemeWidths[1]! + graphemeWidths[2]! + 0.1

    const plain = layout(prepared, maxWidth, LINE_HEIGHT)
    const rich = layoutWithLines(prepared, maxWidth, LINE_HEIGHT)

    expect(plain.lineCount).toBeGreaterThan(1)
    expect(rich.lineCount).toBe(plain.lineCount)
    expect(rich.height).toBe(plain.height)
    expect(rich.lines.map(line => line.text).join('')).toBe('Superlongword')
    expect(rich.lines[0]!.start).toEqual({ segmentIndex: 0, graphemeIndex: 0 })
    expect(rich.lines.at(-1)!.end).toEqual({ segmentIndex: 1, graphemeIndex: 0 })
  })

  test('mixed-direction text is a stable smoke test', () => {
    const prepared = prepareWithSegments('According to محمد الأحمد, the results improved.', FONT)
    const result = layoutWithLines(prepared, 120, LINE_HEIGHT)

    expect(result.lineCount).toBeGreaterThanOrEqual(1)
    expect(result.height).toBe(result.lineCount * LINE_HEIGHT)
    expect(result.lines.map(line => line.text).join('')).toBe('According to محمد الأحمد, the results improved.')
  })

  test('mixed-script canary keeps layoutWithLines and layoutNextLine aligned across CJK, RTL, and emoji', () => {
    const prepared = prepareWithSegments('Hello 世界 مرحبا 🌍 test', FONT)
    const width = 80
    const expected = layoutWithLines(prepared, width, LINE_HEIGHT)

    expect(expected.lines.map(line => line.text)).toEqual(['Hello 世', '界 مرحبا ', '🌍 test'])

    const actual = collectStreamedLines(prepared, width)
    expect(actual).toEqual(expected.lines)
  })

  test('layout and layoutWithLines stay aligned when ZWSP triggers narrow grapheme breaking', () => {
    const cases = [
      'alpha\u200Bbeta',
      'alpha\u200Bbeta\u200Cgamma',
    ]

    for (const text of cases) {
      const plain = prepare(text, FONT)
      const rich = prepareWithSegments(text, FONT)
      const width = 10

      expect(layout(plain, width, LINE_HEIGHT).lineCount).toBe(layoutWithLines(rich, width, LINE_HEIGHT).lineCount)
    }
  })

  test('layoutWithLines strips leading collapsible space after a ZWSP break the same way as layoutNextLine', () => {
    const prepared = prepareWithSegments('生活就像海洋\u200B 只有意志坚定的人才能到达彼岸', FONT)
    const width = prepared.widths[0]! - 1

    expect(layoutWithLines(prepared, width, LINE_HEIGHT).lines).toEqual(collectStreamedLines(prepared, width))
  })

  test('chunked batch line walking normalizes spaces after zero-width breaks like streaming', () => {
    const prepared = prepareWithSegments('x\u00AD A\u200B B', FONT)
    const width = measureWidth('x A', FONT) + 0.1
    const batched = layoutWithLines(prepared, width, LINE_HEIGHT)

    expect(batched.lines.map(line => line.text.trimEnd())).toEqual(['x A\u200B', 'B'])
    expect(collectStreamedLines(prepared, width)).toEqual(batched.lines)
    expect(layout(prepared, width, LINE_HEIGHT).lineCount).toBe(batched.lineCount)
  })

  test('layoutNextLine can resume from any fixed-width line start without hidden state', () => {
    const prepared = prepareWithSegments('foo trans\u00ADatlantic said "hello" to 世界 and waved. alpha\u200Bbeta 🚀', FONT)
    const width = 90
    const expected = layoutWithLines(prepared, width, LINE_HEIGHT)

    expect(expected.lines.length).toBeGreaterThan(2)

    for (let i = 0; i < expected.lines.length; i++) {
      const suffix = collectStreamedLines(prepared, width, expected.lines[i]!.start)
      expect(suffix).toEqual(expected.lines.slice(i))
    }

    expect(layoutNextLine(prepared, terminalCursor(prepared), width)).toBeNull()
  })

  test('rich line boundary cursors reconstruct normalized source text exactly', () => {
    const cases = [
      'a b c',
      '  Hello\t \n  World  ',
      'foo trans\u00ADatlantic said "hello" to 世界 and waved.',
      'According to محمد الأحمد, the results improved.',
      'see https://example.com/reports/q3?lang=ar&mode=full now',
      'alpha\u200Bbeta gamma',
    ]
    const widths = [40, 80, 120, 200]

    for (const text of cases) {
      const prepared = prepareWithSegments(text, FONT)
      const expected = prepared.segments.join('')

      for (const width of widths) {
        const batched = layoutWithLines(prepared, width, LINE_HEIGHT)
        const streamed = collectStreamedLines(prepared, width)

        expect(reconstructFromLineBoundaries(prepared, batched.lines)).toBe(expected)
        expect(reconstructFromLineBoundaries(prepared, streamed)).toBe(expected)
        expect(reconstructFromWalkedRanges(prepared, width)).toBe(expected)
      }
    }
  })

  test('soft-hyphen round-trip uses source slices instead of rendered line text', () => {
    const prepared = prepareWithSegments('foo trans\u00ADatlantic', FONT)
    const width =
      prepared.widths[0]! +
      prepared.widths[1]! +
      prepared.widths[2]! +
      prepared.breakableFitAdvances[4]![0]! +
      prepared.discretionaryHyphenWidth +
      0.1
    const result = layoutWithLines(prepared, width, LINE_HEIGHT)

    expect(result.lines.map(line => line.text).join('')).toBe('foo trans-atlantic')
    expect(reconstructFromLineBoundaries(prepared, result.lines)).toBe('foo trans\u00ADatlantic')
  })

  test('soft-hyphen fallback does not crash when overflow happens on a later space', () => {
    const prepared = prepareWithSegments('foo trans\u00ADatlantic labels', FONT)
    const width = measureWidth('foo transatlantic', FONT) + 0.1
    const result = layoutWithLines(prepared, width, LINE_HEIGHT)

    expect(result.lines.map(line => line.text)).toEqual(['foo transatlantic ', 'labels'])
    expect(layout(prepared, width, LINE_HEIGHT).lineCount).toBe(result.lineCount)
  })

  test('layoutNextLine variable-width streaming stays contiguous and reconstructs normalized text', () => {
    const prepared = prepareWithSegments(
      'foo trans\u00ADatlantic said "hello" to 世界 and waved. According to محمد الأحمد, alpha\u200Bbeta 🚀',
      FONT,
    )
    const widths = [140, 72, 108, 64, 160, 84, 116, 70, 180, 92, 128, 76]
    const lines = collectStreamedLinesWithWidths(prepared, widths)
    const expected = prepared.segments.join('')

    expect(lines.length).toBeGreaterThan(2)
    expect(lines[0]!.start).toEqual({ segmentIndex: 0, graphemeIndex: 0 })

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      expect(compareCursors(line.end, line.start)).toBeGreaterThan(0)
      if (i > 0) {
        expect(line.start).toEqual(lines[i - 1]!.end)
      }
    }

    expect(lines.at(-1)!.end).toEqual(terminalCursor(prepared))
    expect(reconstructFromLineBoundaries(prepared, lines)).toBe(expected)
    expect(layoutNextLine(prepared, terminalCursor(prepared), widths.at(-1)!)).toBeNull()
  })

  test('layoutNextLine variable-width streaming stays contiguous in pre-wrap mode', () => {
    const prepared = prepareWithSegments('foo\n  bar baz\n\tquux quuz', FONT, { whiteSpace: 'pre-wrap' })
    const widths = [200, 62, 80, 200, 72, 200]
    const lines = collectStreamedLinesWithWidths(prepared, widths)
    const expected = prepared.segments.join('')

    expect(lines.length).toBeGreaterThanOrEqual(4)
    expect(lines[0]!.start).toEqual({ segmentIndex: 0, graphemeIndex: 0 })

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      expect(compareCursors(line.end, line.start)).toBeGreaterThan(0)
      if (i > 0) {
        expect(line.start).toEqual(lines[i - 1]!.end)
      }
    }

    expect(lines.at(-1)!.end).toEqual(terminalCursor(prepared))
    expect(reconstructFromLineBoundaries(prepared, lines)).toBe(expected)
    expect(layoutNextLine(prepared, terminalCursor(prepared), widths.at(-1)!)).toBeNull()
  })

  test('pre-wrap mode keeps hanging spaces visible at line end', () => {
    const prepared = prepareWithSegments('foo   bar', FONT, { whiteSpace: 'pre-wrap' })
    const width = measureWidth('foo', FONT) + 0.1
    const lines = layoutWithLines(prepared, width, LINE_HEIGHT)
    expect(lines.lineCount).toBe(2)
    expect(lines.lines.map(line => line.text)).toEqual(['foo   ', 'bar'])
    expect(layout(prepared, width, LINE_HEIGHT).lineCount).toBe(2)
  })

  test('pre-wrap line widths leave out the spaces and tabs a wrapped line ends on', () => {
    const foo = measureWidth('foo', FONT)
    const bar = measureWidth('bar', FONT)
    const cases: Array<[string, number]> = [
      ['foo   bar', foo + 0.1],
      ['foo\tbar', foo + 0.1],
      ['foo\tbar', 50],
      // Main put the tab and the space after it on lines of their own here.
      ['foo \t bar', foo],
      ['foo \t bar', 60],
    ]
    for (const [text, width] of cases) {
      const prepared = prepareWithSegments(text, FONT, { whiteSpace: 'pre-wrap' })
      const { lines } = layoutWithLines(prepared, width, LINE_HEIGHT)
      expect(lines.map(line => line.text)).toEqual([text.slice(0, -3), 'bar'])
      expect(lines.map(line => line.width)).toEqual([foo, bar])
      const walked: number[] = []
      walkLineRanges(prepared, width, line => walked.push(line.width))
      expect(walked).toEqual([foo, bar])
      expect(collectStreamedLines(prepared, width)).toEqual(lines)
      expect(measureLineStats(prepared, width)).toEqual({ lineCount: 2, maxLineWidth: Math.max(foo, bar) })
      // Laid out at its widest line, the text wraps the same way.
      expect(layoutWithLines(prepared, Math.max(foo, bar), LINE_HEIGHT).lines.map(line => line.text)).toEqual([text.slice(0, -3), 'bar'])
    }

    // With letter spacing the width keeps the gap after the last letter, as in normal mode.
    for (const letterSpacing of [2, -1]) {
      const preWrap = layoutWithLines(prepareWithSegments('foo bar', FONT, { whiteSpace: 'pre-wrap', letterSpacing }), 50, LINE_HEIGHT).lines
      const normal = layoutWithLines(prepareWithSegments('foo bar', FONT, { letterSpacing }), 50, LINE_HEIGHT).lines
      expect(preWrap.map(line => line.text)).toEqual(['foo ', 'bar'])
      expect(preWrap.map(line => line.width)).toEqual(normal.map(line => line.width))
    }
  })

  test('the Gecko profile counts a pre-wrap tab in the fit and the width, as Firefox does not hang tabs', () => {
    const profile = getEngineProfile()
    const previous = profile.hangTabs
    const foo = measureWidth('foo', FONT)
    const tab = prepareWithSegments('foo\tbar', FONT, { whiteSpace: 'pre-wrap' })
    const mixed = prepareWithSegments('foo \t bar', FONT, { whiteSpace: 'pre-wrap' })
    try {
      profile.hangTabs = false
      const gecko = layoutWithLines(tab, 50, LINE_HEIGHT).lines
      expect(gecko.map(line => line.text)).toEqual(['foo\t', 'bar'])
      expect(gecko[0]!.width).toBeCloseTo(measureWidth(' ', FONT) * 8, 9)
      // A tab that doesn't fit after a space starts the next line, and the space hangs.
      expect(layoutWithLines(mixed, foo + 1, LINE_HEIGHT).lines.map(line => [line.text, line.width])).toEqual([['foo ', foo], ['\t', measureWidth(' ', FONT) * 8], [' ', 0], ['bar', measureWidth('bar', FONT)]])
      profile.hangTabs = true
      expect(layoutWithLines(tab, 50, LINE_HEIGHT).lines.map(line => [line.text, line.width])).toEqual([['foo\t', foo], ['bar', measureWidth('bar', FONT)]])
      expect(layoutWithLines(mixed, foo + 1, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['foo \t ', 'bar'])
    } finally {
      profile.hangTabs = previous
    }
  })

  test('pre-wrap spaces and tabs before a hard break or the end of the text count as far as they fit', () => {
    const foo = measureWidth('foo', FONT)
    const withSpaces = measureWidth('foo   ', FONT)
    const prepared = prepareWithSegments('foo   \nbar', FONT, { whiteSpace: 'pre-wrap' })
    expect(layoutWithLines(prepared, 200, LINE_HEIGHT).lines.map(line => line.width)).toEqual([withSpaces, measureWidth('bar', FONT)])
    expect(layoutWithLines(prepared, foo + 5, LINE_HEIGHT).lines.map(line => [line.text, line.width])).toEqual([['foo   ', foo + 5], ['bar', measureWidth('bar', FONT)]])
    expect(measureNaturalWidth(prepared)).toBe(withSpaces)

    // Two tabs at the end stay on one line, which the width clamps to.
    const tabs = prepareWithSegments('foo\t\t', FONT, { whiteSpace: 'pre-wrap' })
    expect(layoutWithLines(tabs, 60, LINE_HEIGHT).lines.map(line => [line.text, line.width])).toEqual([['foo\t\t', 60]])
    expect(layout(tabs, 60, LINE_HEIGHT).lineCount).toBe(1)
    expect(measureNaturalWidth(tabs)).toBeCloseTo(measureWidth(' ', FONT) * 16, 9)
  })

  test('pre-wrap mode treats hard breaks as forced line boundaries', () => {
    const prepared = prepareWithSegments('a\nb', FONT, { whiteSpace: 'pre-wrap' })
    const lines = layoutWithLines(prepared, 200, LINE_HEIGHT)
    expect(lines.lines.map(line => line.text)).toEqual(['a', 'b'])
    expect(layout(prepared, 200, LINE_HEIGHT).lineCount).toBe(2)
  })

  test('pre-wrap mode treats tabs as hanging whitespace aligned to tab stops', () => {
    const prepared = prepareWithSegments('a\tb', FONT, { whiteSpace: 'pre-wrap' })
    const spaceWidth = measureWidth(' ', FONT)
    const prefixWidth = measureWidth('a', FONT)
    const tabAdvance = nextTabAdvance(prefixWidth, spaceWidth, 8)
    const textWidth = prefixWidth + tabAdvance + measureWidth('b', FONT)
    const width = textWidth - 0.1

    const lines = layoutWithLines(prepared, width, LINE_HEIGHT)
    expect(lines.lines.map(line => line.text)).toEqual(['a\t', 'b'])
    expect(layout(prepared, width, LINE_HEIGHT).lineCount).toBe(2)
  })

  test('pre-wrap mode treats consecutive tabs as distinct tab stops', () => {
    const prepared = prepareWithSegments('a\t\tb', FONT, { whiteSpace: 'pre-wrap' })
    const spaceWidth = measureWidth(' ', FONT)
    const prefixWidth = measureWidth('a', FONT)
    const firstTabAdvance = nextTabAdvance(prefixWidth, spaceWidth, 8)
    const afterFirstTab = prefixWidth + firstTabAdvance
    const secondTabAdvance = nextTabAdvance(afterFirstTab, spaceWidth, 8)
    const width = prefixWidth + firstTabAdvance + secondTabAdvance - 0.1

    const lines = layoutWithLines(prepared, width, LINE_HEIGHT)
    expect(lines.lines.map(line => line.text)).toEqual(['a\t\t', 'b'])
    expect(layout(prepared, width, LINE_HEIGHT).lineCount).toBe(2)
  })

  test('pre-wrap mode keeps whitespace-only middle lines visible', () => {
    const prepared = prepareWithSegments('foo\n  \nbar', FONT, { whiteSpace: 'pre-wrap' })
    const lines = layoutWithLines(prepared, 200, LINE_HEIGHT)
    expect(lines.lines.map(line => line.text)).toEqual(['foo', '  ', 'bar'])
    expect(layout(prepared, 200, LINE_HEIGHT)).toEqual({ lineCount: 3, height: LINE_HEIGHT * 3 })
  })

  test('pre-wrap mode keeps trailing spaces before a hard break on the current line', () => {
    const prepared = prepareWithSegments('foo  \nbar', FONT, { whiteSpace: 'pre-wrap' })
    const lines = layoutWithLines(prepared, 200, LINE_HEIGHT)
    expect(lines.lines.map(line => line.text)).toEqual(['foo  ', 'bar'])
    expect(layout(prepared, 200, LINE_HEIGHT)).toEqual({ lineCount: 2, height: LINE_HEIGHT * 2 })
  })

  test('pre-wrap mode keeps trailing tabs before a hard break on the current line', () => {
    const prepared = prepareWithSegments('foo\t\nbar', FONT, { whiteSpace: 'pre-wrap' })
    const lines = layoutWithLines(prepared, 200, LINE_HEIGHT)
    expect(lines.lines.map(line => line.text)).toEqual(['foo\t', 'bar'])
    expect(layout(prepared, 200, LINE_HEIGHT)).toEqual({ lineCount: 2, height: LINE_HEIGHT * 2 })
  })

  test('pre-wrap mode restarts tab stops after a hard break', () => {
    const prepared = prepareWithSegments('foo\n\tbar', FONT, { whiteSpace: 'pre-wrap' })
    const lines = layoutWithLines(prepared, 200, LINE_HEIGHT)
    const spaceWidth = measureWidth(' ', FONT)
    const expectedSecondLineWidth = nextTabAdvance(0, spaceWidth, 8) + measureWidth('bar', FONT)

    expect(lines.lines.map(line => line.text)).toEqual(['foo', '\tbar'])
    expect(lines.lines[1]!.width).toBeCloseTo(expectedSecondLineWidth, 5)
  })

  test('layoutNextLine stays aligned with layoutWithLines in pre-wrap mode', () => {
    const prepared = prepareWithSegments('foo\n  bar baz\nquux', FONT, { whiteSpace: 'pre-wrap' })
    const width = measureWidth('  bar', FONT) + 0.1
    const expected = layoutWithLines(prepared, width, LINE_HEIGHT)

    const actual = []
    let cursor = { segmentIndex: 0, graphemeIndex: 0 }
    while (true) {
      const line = layoutNextLine(prepared, cursor, width)
      if (line === null) break
      actual.push(line)
      cursor = line.end
    }

    expect(actual).toEqual(expected.lines)
  })

  test('pre-wrap soft hyphen does not preempt a closer preserved-space break', () => {
    const prepared = prepareWithSegments('A\nbا \u00ADb، b', FONT, { whiteSpace: 'pre-wrap' })
    const width =
      measureWidth('bا', FONT) +
      measureWidth(' ', FONT) +
      measureWidth('b،', FONT) +
      measureWidth(' ', FONT) +
      0.1
    const expected = layoutWithLines(prepared, width, LINE_HEIGHT)

    expect(expected.lines.map(line => line.text)).toEqual(['A', 'bا b، ', 'b'])
    expect(collectStreamedLines(prepared, width)).toEqual(expected.lines)
    expect(layout(prepared, width, LINE_HEIGHT).lineCount).toBe(expected.lineCount)
  })

  test('streaming keeps a later hanging break after an unselected soft hyphen', () => {
    const width = measureWidth('a-', FONT) + 0.1
    const prepared = prepareWithSegments('a\u00AD\tb', FONT, { whiteSpace: 'pre-wrap' })
    const result = variant.predict({
      id: 'unit-shy-hanging-break', family: 'api', origins: ['maintained'], scope: 'supported',
      text: 'a\u00AD\tb', whiteSpace: 'pre-wrap', font: FONT, width, lineHeight: LINE_HEIGHT,
      wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
    })
    if (result.detail !== 'full') throw new Error('Expected full public contract checks')
    expect(result.lines.map(line => line.text)).toEqual(['a\t', 'b'])
    expect(result.contracts).toEqual([])
    expect(collectStreamedLines(prepared, width)).toEqual(layoutWithLines(prepared, width, LINE_HEIGHT).lines)
  })

  test('pre-wrap mode keeps empty lines from consecutive hard breaks', () => {
    const prepared = prepareWithSegments('\n\n', FONT, { whiteSpace: 'pre-wrap' })
    const lines = layoutWithLines(prepared, 200, LINE_HEIGHT)
    expect(lines.lines.map(line => line.text)).toEqual(['', ''])
    expect(layout(prepared, 200, LINE_HEIGHT)).toEqual({ lineCount: 2, height: LINE_HEIGHT * 2 })

    const mixed = prepareWithSegments('中文\n\n世界', FONT, { whiteSpace: 'pre-wrap' })
    const mixedLines = layoutWithLines(mixed, 200, LINE_HEIGHT)
    expect(mixedLines.lines.map(line => line.text)).toEqual(['中文', '', '世界'])
    expect(collectStreamedLines(mixed, 200)).toEqual(mixedLines.lines)
  })

  test('consecutive consumed-only chunks retain the visible tail and real empty lines', () => {
    for (const control of ['\u00AD', '\u200B']) for (const prefix of ['', 'a\n']) for (const emptyLine of ['', '\n']) {
      const prepared = prepareWithSegments(prefix + control + '\n' + control + '\n' + emptyLine + 'b', FONT, { whiteSpace: 'pre-wrap' })
      // A hard-break chunk that starts with ZWSP retains that source as a line.
      const retained = control === '\u200B' ? [control, control] : []
      const expected = [...(prefix ? ['a'] : []), ...retained, ...(emptyLine ? [''] : []), 'b']
      const batch = layoutWithLines(prepared, 100, LINE_HEIGHT)
      expect(batch.lines.map(line => line.text)).toEqual(expected)
      expect(layout(prepared, 100, LINE_HEIGHT).lineCount).toBe(expected.length)
      expect(measureLineStats(prepared, 100).lineCount).toBe(expected.length)
      const ranges: NonNullable<ReturnType<LayoutModule['layoutNextLineRange']>>[] = []
      walkLineRanges(prepared, 100, line => ranges.push(line))
      const streamed: NonNullable<ReturnType<LayoutModule['layoutNextLineRange']>>[] = []
      let cursor = { segmentIndex: 0, graphemeIndex: 0 }
      for (let lineIndex = 0; lineIndex <= expected.length; lineIndex++) {
        const line = layoutNextLineRange(prepared, JSON.parse(JSON.stringify(cursor)) as typeof cursor, 100)
        if (line === null) break
        streamed.push(line)
        cursor = JSON.parse(JSON.stringify(line.end)) as typeof cursor
      }
      expect(streamed).toEqual(ranges)
      expect(streamed.map(line => materializeLineRange(prepared, line).text)).toEqual(expected)
    }
  })

  test('pre-wrap mode does not invent an extra trailing empty line', () => {
    const prepared = prepareWithSegments('a\n', FONT, { whiteSpace: 'pre-wrap' })
    const lines = layoutWithLines(prepared, 200, LINE_HEIGHT)
    expect(lines.lines.map(line => line.text)).toEqual(['a'])
    expect(layout(prepared, 200, LINE_HEIGHT)).toEqual({ lineCount: 1, height: LINE_HEIGHT })
  })

  test('overlong breakable segments wrap onto a fresh line when the current line already has content', () => {
    const prepared = prepareWithSegments('foo abcdefghijk', FONT)
    const prefixWidth = prepared.widths[0]! + prepared.widths[1]!
    const wordBreaks = prepared.breakableFitAdvances[2]!
    const width = prefixWidth + wordBreaks[0]! + wordBreaks[1]! + 0.1

    const batched = layoutWithLines(prepared, width, LINE_HEIGHT)
    expect(batched.lines[0]?.text).toBe('foo ')
    expect(batched.lines[1]?.text.startsWith('ab')).toBe(true)

    const streamed = layoutNextLine(prepared, { segmentIndex: 0, graphemeIndex: 0 }, width)
    expect(streamed?.text).toBe('foo ')
    expect(layout(prepared, width, LINE_HEIGHT).lineCount).toBe(batched.lineCount)
  })

  test('mixed CJK-plus-numeric runs use cumulative widths when breaking the numeric suffix', () => {
    const prepared = prepareWithSegments('中文11111111111111111', FONT)
    const width = measureWidth('11111', FONT) + 0.1

    expect(prepared.segments).toEqual(['中', '文', '11111111111111111'])

    const batched = layoutWithLines(prepared, width, LINE_HEIGHT)
    expect(batched.lines.map(line => line.text)).toEqual([
      '中文',
      '11111',
      '11111',
      '11111',
      '11',
    ])

    const streamed = collectStreamedLines(prepared, width)
    expect(streamed).toEqual(batched.lines)
    expect(layout(prepared, width, LINE_HEIGHT)).toEqual({ lineCount: 5, height: LINE_HEIGHT * 5 })
  })

  test('keep-all suppresses ordinary CJK intra-word breaks after existing line content', () => {
    const text = 'A 中文测试'
    const normal = prepareWithSegments(text, FONT)
    const keepAll = prepareWithSegments(text, FONT, { wordBreak: 'keep-all' })
    const width = measureWidth('A 中', FONT) + 0.1

    expect(layoutWithLines(normal, width, LINE_HEIGHT).lines[0]?.text).toBe('A 中')
    expect(layoutWithLines(keepAll, width, LINE_HEIGHT).lines[0]?.text).toBe('A ')
    expect(layout(keepAll, width, LINE_HEIGHT).lineCount).toBeGreaterThan(layout(normal, width, LINE_HEIGHT).lineCount)
  })

  test('keep-all lets mixed no-space CJK runs break through the script boundary', () => {
    const text = '日本語foo-bar'
    const normal = prepareWithSegments(text, FONT)
    const keepAll = prepareWithSegments(text, FONT, { wordBreak: 'keep-all' })
    const width = measureWidth('日本語f', FONT) + 0.1

    expect(layoutWithLines(normal, width, LINE_HEIGHT).lines[0]?.text).toBe('日本語')
    expect(layoutWithLines(keepAll, width, LINE_HEIGHT).lines[0]?.text).toBe('日本語f')
  })

  test('measureNaturalWidth returns the widest forced line', () => {
    const prepared = prepareWithSegments('wide line\nfit\nmid', FONT, { whiteSpace: 'pre-wrap' })

    expect(measureNaturalWidth(prepared)).toBe(measureWidth('wide line', FONT))
  })

  test('line-break geometry helpers stay aligned with streamed line ranges', () => {
    const prepared = prepareWithSegments('foo trans\u00ADatlantic said "hello" to 世界 and waved.', FONT)
    const widths = [48, 72, 120]

    for (let index = 0; index < widths.length; index++) {
      const width = widths[index]!
      const cursor = { segmentIndex: 0, graphemeIndex: 0 }
      const streamedWidths: number[] = []

      while (true) {
        const line = layoutNextLineRange(prepared, cursor, width)
        const geometryCursor = { ...cursor }
        const geometryWidth = stepPreparedLineGeometry(prepared, geometryCursor, width)
        expect(geometryWidth).toBe(line?.width ?? null)
        if (line === null) break
        expect(geometryCursor).toEqual(line.end)
        streamedWidths.push(line.width)
        cursor.segmentIndex = line.end.segmentIndex
        cursor.graphemeIndex = line.end.graphemeIndex
      }

      expect(measurePreparedLineGeometry(prepared, width)).toEqual({
        lineCount: streamedWidths.length,
        maxLineWidth: Math.max(0, ...streamedWidths),
      })
    }
  })

  test('countPreparedLines stays aligned with the walked line counter', () => {
    const epsilon = getEngineProfile().lineFitEpsilon
    const texts = [
      'The quick brown fox jumps over the lazy dog.',
      'said "hello" to 世界 and waved.',
      'مرحبا، عالم؟',
      'author 7:00-9:00 only',
      'alpha\u200Bbeta gamma',
      'a\u200B b',
      'https://a-bc-defgh-ij/klm-nopq',
      '\u200Balpha-beta \u200B\u200Bgamma',
      '\u6625\u7720\u4E0D\u89C9\u6653\uFF0C\u5904\u5904\u95FB\u557C\u9E1F\u3002',
    ]

    // The count-only walker must agree with the simple walker at every width,
    // including emergency widths and widths around each segment end. At the
    // end minus the fit epsilon, the text up to there fits with nothing to spare.
    for (let textIndex = 0; textIndex < texts.length; textIndex++) {
      const prepared = prepareWithSegments(texts[textIndex]!, FONT)
      const { widths: segmentWidths } = prepared as unknown as { widths: number[] }
      const widths = [-5, 0]
      for (let width = 1; width <= 400; width += 0.5) widths.push(width)
      let prefix = 0
      for (let i = 0; i < segmentWidths.length; i++) {
        prefix += segmentWidths[i]!
        widths.push(prefix - epsilon, prefix - 0.001, prefix, prefix + 0.001)
      }
      for (let widthIndex = 0; widthIndex < widths.length; widthIndex++) {
        const width = widths[widthIndex]!
        const counted = countPreparedLines(prepared, width)
        const walked = walkPreparedLinesRaw(prepared, width)
        expect(counted).toBe(walked)
      }
    }
  })

  test('line counts preserve leading and resumed zero-width spaces at emergency widths', () => {
    for (const [text, expected] of [
      [' \u200Babc', ['\u200B', 'a', 'b', 'c']],
      ['a \u200Babc', ['a ', 'a', 'b', 'c']],
      ['\u200B\u200Bab', ['\u200B\u200B', 'a', 'b']],
      ['abc', ['a', 'b', 'c']],
      ['字\u200B字', ['字\u200B', '字']],
    ] as const) {
      const prepared = prepareWithSegments(text, FONT)
      const compact = prepare(text, FONT)
      const measured = canvasMeasurementCount
      // Each first grapheme must consume source even when wider than the line.
      for (const width of [0, -5, 0]) {
        const lines = layoutWithLines(prepared, width, LINE_HEIGHT)
        expect(lines.lines.map(line => line.text)).toEqual([...expected])
        const streamed = collectStreamedLines(prepared, width)
        // The two APIs sum paint widths differently; compare source cuts exactly.
        expect(streamed.map(({ text, start, end }) => ({ text, start, end }))).toEqual(
          lines.lines.map(({ text, start, end }) => ({ text, start, end })),
        )
        expect(countPreparedLines(prepared, width)).toBe(expected.length)
        expect(walkPreparedLinesRaw(prepared, width)).toBe(expected.length)
        expect(layout(compact, width, LINE_HEIGHT)).toEqual({ lineCount: expected.length, height: expected.length * LINE_HEIGHT })
      }
      expect(canvasMeasurementCount).toBe(measured)
    }
  })

  test('line counts follow the break segments of a hyphenated URL across widths', () => {
    const text = 'https://a-bc-defgh-ij'
    const width = measureWidth('bc-def', FONT) + 0.1
    const prepared = prepareWithSegments(text, FONT)
    const compact = prepare(text, FONT)
    const measured = canvasMeasurementCount
    const expected = ['https:', '//a-', 'bc-', 'defgh-', 'ij']
    const lines = layoutWithLines(prepared, width, LINE_HEIGHT)
    expect(lines.lines.map(line => line.text)).toEqual(expected)
    expect(collectStreamedLines(prepared, width)).toEqual(lines.lines)
    for (const nextWidth of [width + 20, 0, width, width + 20, width]) {
      const ranges = layoutWithLines(prepared, nextWidth, LINE_HEIGHT)
      expect(countPreparedLines(prepared, nextWidth)).toBe(ranges.lineCount)
      expect(layout(compact, nextWidth, LINE_HEIGHT).lineCount).toBe(ranges.lineCount)
    }
    expect(countPreparedLines(prepared, width)).toBe(expected.length)
    expect(canvasMeasurementCount).toBe(measured)
  })

  test('line counts admit a shaped whole before using isolated emergency advances', () => {
    const measureText = Object.getOwnPropertyDescriptor(TestCanvasRenderingContext2D.prototype, 'measureText')!
    // The whole AV is 17.2px, while its isolated letters add up to 19.2px.
    Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
      ...measureText,
      value(this: TestCanvasRenderingContext2D, text: string) {
        canvasMeasurementCount++
        return { width: measureWidth(text, this.font) - 2 * (text.match(/AV/g) ?? []).length }
      },
    })
    try {
      const font = '16px Count Admission Test Sans'
      const prepared = prepareWithSegments('AV', font)
      const compact = prepare('AV', font)
      const measured = canvasMeasurementCount
      for (const [width, expected] of [[18, ['AV']], [0, ['A', 'V']], [18, ['AV']]] as const) {
        const lines = layoutWithLines(prepared, width, LINE_HEIGHT)
        expect(lines.lines.map(line => line.text)).toEqual([...expected])
        expect(collectStreamedLines(prepared, width)).toEqual(lines.lines)
        expect(countPreparedLines(prepared, width)).toBe(expected.length)
        expect(layout(compact, width, LINE_HEIGHT).lineCount).toBe(expected.length)
      }
      expect(canvasMeasurementCount).toBe(measured)
    } finally {
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
    }
  })

  test('line counts lay out a negative width as 0 across zero-width graphemes', () => {
    const measureText = Object.getOwnPropertyDescriptor(TestCanvasRenderingContext2D.prototype, 'measureText')!
    // Invisible text: the word and each of its letters measure 0, so all of it
    // fits on a line of width 0.
    Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
      ...measureText,
      value() {
        canvasMeasurementCount++
        return { width: 0 }
      },
    })
    try {
      const font = '16px Zero Width Test Sans'
      const prepared = prepareWithSegments('abc', font)
      const compact = prepare('abc', font)
      const measured = canvasMeasurementCount
      for (const width of [0, -5]) {
        expect(layoutWithLines(prepared, width, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['abc'])
        expect(countPreparedLines(prepared, width)).toBe(1)
        expect(layout(compact, width, LINE_HEIGHT).lineCount).toBe(1)
      }
      expect(canvasMeasurementCount).toBe(measured)
    } finally {
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
    }
  })

  test("Blink's HanKerning trims an opening mark after a closing one and a line-end closing mark", () => {
    const measureText = Object.getOwnPropertyDescriptor(TestCanvasRenderingContext2D.prototype, 'measureText')!
    // A font with halt: inside one string, 「 after a closing or opening mark and a closing
    // mark before another lose half an em, as Canvas shapes them. 、。，． are closing marks
    // that draw in the left half of their em next to Han text and centered alone, as locl
    // can place them. Canvas shapes `(`, `)`, `·` and `”` as words of their own, so it
    // halts nothing next to them.
    Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
      ...measureText,
      value(this: TestCanvasRenderingContext2D, text: string) {
        canvasMeasurementCount++
        const em = parseFontSize(this.font)
        const pairs = (text.match(/(?<=[」「、。，．])「|[」、。，．](?=[」、。，．])/g) ?? []).length
        const width = measureWidth(text, this.font) - pairs * em / 2
        // Ink bounds over the characters, each at its advance.
        const han = /\p{sc=Han}/u.test(text)
        let x = 0
        let left = Infinity
        let right = -Infinity
        for (const ch of text) {
          const w = measureWidth(ch, this.font)
          const dot = /^[、。，．]$/.test(ch)
          left = Math.min(left, x + (dot ? (han ? 0.1 : 0.3) * em : 0))
          right = Math.max(right, x + (dot ? (han ? 0.4 : 0.7) * em : w))
          x += w
        }
        return { width, actualBoundingBoxLeft: -left, actualBoundingBoxRight: right }
      },
    })
    try {
      const font = '16px Halt Test Sans'
      const cases: [string, number, string[], number[]][] = [
        // Each 「 after 」 is halted in the line, but not where it starts a line, and the
        // last 」 where the line doesn't fit otherwise.
        ['「」「」「」', 80, ['「」「」「」'], [80]],
        ['「」「」「」', 79, ['「」「」「」'], [72]],
        ['「」「」「」', 71, ['「」「」', '「」'], [56, 32]],
        // 、 is a closing mark in this font, so 「 after it is halted too.
        ['中、「中」', 64, ['中、「中」'], [64]],
        // A closing mark that ends the line drops half an em where it doesn't fit otherwise.
        ['中中中中」「中', 72, ['中中中中」', '「中'], [72, 32]],
        ['中中中中」', 72, ['中中中中」'], [72]],
        ['中中中中」', 71, ['中中中', '中」'], [48, 32]],
        // Inside one segment the page halts 「 after `(` and 」 before `)`, where Canvas cuts
        // the string into words.
        ['中(「中」)中', 80, ['中(「中」)中'], [80]],
        ['中(「中」)中', 79, ['中(「中」)', '中'], [64, 16]],
        // 」 before a middle dot in the next segment is halted wherever the line ends.
        ['中」·中', 50, ['中」·中'], [49.6]],
        ['中」·中', 49, ['中」·', '中'], [33.6, 16]],
        ['中」·中', 30, ['中」', '·中'], [24, 25.6]],
        // 。 types as a closing mark from its Han shape, so the page halts it before ”.
        ['中。”中', 47, ['中。”中'], [46.4]],
        ['中。”中', 46, ['中。”', '中'], [30.4, 16]],
      ]
      for (const [text, width, expected, widths] of cases) {
        const prepared = prepareWithSegments(text, font)
        const lines = layoutWithLines(prepared, width, LINE_HEIGHT)
        expect({ text, width, lines: lines.lines.map(line => line.text), widths: lines.lines.map(line => line.width) })
          .toEqual({ text, width, lines: expected, widths })
        expect(collectStreamedLines(prepared, width)).toEqual(lines.lines)
        expect(countPreparedLines(prepared, width)).toBe(expected.length)
        expect(walkPreparedLinesRaw(prepared, width)).toBe(expected.length)
        expect(layout(prepare(text, font), width, LINE_HEIGHT).lineCount).toBe(expected.length)
        // The complex walker, for text that leaves the fast path, agrees.
        const complex = { ...prepared, simpleLineWalkFastPath: false } as typeof prepared
        expect(layoutWithLines(complex, width, LINE_HEIGHT)).toEqual(lines)
      }
    } finally {
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
    }
  })

  test('Blink and Gecko hang U+3000 at a line end, where a hyphen before it has to fit in Blink', () => {
    for (const [text, width, expected, widths] of [
      ['中中\u3000中', 48, ['中中\u3000', '中'], [48, 16]],
      ['中中\u3000中', 40, ['中中\u3000', '中'], [32, 16]],
      ['中中\u3000中', 31, ['中', '中\u3000', '中'], [16, 16, 16]],
      // A collapsible space after the run hangs with it.
      ['中中\u3000 中', 40, ['中中\u3000 ', '中'], [32, 16]],
      ['中中\u3000 中', 31, ['中', '中\u3000 ', '中'], [16, 16, 16]],
      ['中 中\u3000 中', 40, ['中 中\u3000 ', '中'], [32 + measureWidth(' ', FONT), 16]],
    ] as const) {
      const prepared = prepareWithSegments(text, FONT)
      const lines = layoutWithLines(prepared, width, LINE_HEIGHT)
      expect({ text, width, lines: lines.lines.map(line => line.text), widths: lines.lines.map(line => line.width) })
        .toEqual({ text, width, lines: [...expected], widths: [...widths] })
      expect(countPreparedLines(prepared, width)).toBe(expected.length)
      expect(layout(prepare(text, FONT), width, LINE_HEIGHT).lineCount).toBe(expected.length)
      // The complex walker, which letter-spaced text takes, hangs the run too.
      const complex = { ...prepared, simpleLineWalkFastPath: false } as typeof prepared
      expect(layoutWithLines(complex, width, LINE_HEIGHT)).toEqual(lines)
    }
    // After a soft hyphen the line ends hyphenated, and the hyphen has to fit.
    const hyphenated = prepare('中中\u00AD\u3000中', FONT)
    expect(layout(hyphenated, 32 + measureWidth('-', FONT), LINE_HEIGHT).lineCount).toBe(2)
    expect(layout(hyphenated, 32 + measureWidth('-', FONT) - 1, LINE_HEIGHT).lineCount).toBe(3)
  })

  test('line counts preserve spacing, tabs, hard breaks and selected soft hyphens', () => {
    for (const [text, options, width, expected] of [
      ['abc', { letterSpacing: -2 }, 16, ['ab', 'c']],
      ['abc', { letterSpacing: 2 }, 23.3, ['ab', 'c']],
      ['ab\n\ncd', { whiteSpace: 'pre-wrap', letterSpacing: -1 }, 100, ['ab', '', 'cd']],
      ['a\tb\nc\u00ADd', { whiteSpace: 'pre-wrap', letterSpacing: 2 }, 100, ['a\tb', 'cd']],
      ['foo trans\u00ADatlantic', {}, measureWidth('foo trans-', FONT) + 0.1, ['foo trans-', 'atlantic']],
    ] as const) {
      const prepared = prepareWithSegments(text, FONT, options)
      const compact = prepare(text, FONT, options)
      const measured = canvasMeasurementCount
      const lines = layoutWithLines(prepared, width, LINE_HEIGHT)
      expect(lines.lines.map(line => line.text)).toEqual([...expected])
      expect(collectStreamedLines(prepared, width)).toEqual(lines.lines)
      expect(countPreparedLines(prepared, width)).toBe(expected.length)
      expect(layout(compact, width, LINE_HEIGHT).lineCount).toBe(expected.length)
      for (const nextWidth of [0, width / 2, width, 0]) {
        const next = layoutWithLines(prepared, nextWidth, LINE_HEIGHT)
        expect(countPreparedLines(prepared, nextWidth)).toBe(next.lineCount)
        expect(layout(compact, nextWidth, LINE_HEIGHT).lineCount).toBe(next.lineCount)
      }
      expect(canvasMeasurementCount).toBe(measured)
    }
  })
})


test('unchosen terminal soft hyphens consume source without painting a hyphen', () => {
  for (const whiteSpace of ['normal', 'pre-wrap'] as const) {
    for (const letterSpacing of [-1, 0, 2]) {
      for (const text of ['abc\u00AD', 'abc\u00AD\u00AD', 'abc\u00AD\nx']) {
        const prepared = prepareWithSegments(text, FONT, { whiteSpace, letterSpacing })
        const reference = prepareWithSegments(text.replaceAll('\u00AD', ''), FONT, { whiteSpace, letterSpacing })
        const expected = layoutWithLines(reference, 500, LINE_HEIGHT)
        const actual = layoutWithLines(prepared, 500, LINE_HEIGHT)
        expect(actual.lines.map(line => line.text)).toEqual(expected.lines.map(line => line.text))
        expect(layout(prepared, 500, LINE_HEIGHT).lineCount).toBe(expected.lineCount)
        expect(measureNaturalWidth(prepared)).toBeCloseTo(measureNaturalWidth(reference))
        expect(measureLineStats(prepared, 500).maxLineWidth).toBeCloseTo(measureLineStats(reference, 500).maxLineWidth)
        let cursor: TestLayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
        for (const line of actual.lines) {
          const range = layoutNextLineRange(prepared, cursor, 500)!
          expect(materializeLineRange(prepared, range)).toEqual(line)
          cursor = range.end
        }
        expect(cursor.segmentIndex).toBe(prepared.segments.length)
        expect(layoutNextLine(prepared, cursor, 500)).toBeNull()
      }
    }
  }
})


test('the Safari profile breaks inside rich items from each item alone', () => {
  // The engine profile is computed once per process, so Safari runs in a child
  // process. Letters are 8px and marks and spaces 4px. WebKit breaks inside an
  // inline box from that box's text, and reads only the previous box's last
  // two characters at a boundary. The Thai item's own last run moves with the
  // continuation, where the joined text would split the word differently. The
  // Myanmar continuation is only the vowel sign: analysis of the second item
  // alone would join that sign to the word after it.
  const richInlineUrl = new URL('./rich-inline.ts', import.meta.url).href
  const script = `
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      vendor: 'Apple Computer, Inc.',
    } })
    class Context {
      font = ''
      measureText(text) {
        let width = 0
        for (const ch of text) width += ch === ' ' || /\\p{M}/u.test(ch) ? 4 : 8
        return { width }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const { prepareRichInline, walkRichInlineLineRanges, materializeRichInlineLineRange } = await import(${JSON.stringify(richInlineUrl)})
    const rows = []
    for (const [parts, width] of [
      [['\\u0E04\\u0E27\\u0E32\\u0E21\\u0E2A\\u0E27\\u0E22\\u0E07', '\\u0E32\\u0E21\\u0E02\\u0E2D\\u0E07'], 40],
      [['\\u1019\\u102C\\u1018\\u102C\\u101E', '\\u102C\\u101E\\u100A\\u103A\\u101C\\u103E\\u1015'], 28],
    ]) {
      const prepared = prepareRichInline(parts.map(text => ({ text, font: '16px Test' })))
      const lines = []
      walkRichInlineLineRanges(prepared, width, range => {
        lines.push(materializeRichInlineLineRange(prepared, range).fragments.map(fragment => fragment.text))
      })
      rows.push(lines)
    }
    console.log(JSON.stringify(rows))
  `
  const child = Bun.spawnSync([process.execPath, '-e', script])
  if (child.exitCode !== 0) throw new Error(child.stderr.toString())
  expect(JSON.parse(child.stdout.toString())).toEqual([
    [['\u0E04\u0E27\u0E32\u0E21'], ['\u0E2A\u0E27\u0E22'], ['\u0E07', '\u0E32\u0E21'], ['\u0E02\u0E2D\u0E07']],
    [['\u1019\u102C\u1018\u102C'], ['\u101E', '\u102C'], ['\u101E\u100A\u103A'], ['\u101C\u103E\u1015']],
  ])
})

test('the Firefox profile breaks rich items only where their joined text breaks', () => {
  // The engine profile is computed once per process, so Firefox runs in a child
  // process. Every character but a space is 8px, and a space 4px. Gecko collects
  // a word across text frames until a space and breaks it in one pass, so rich
  // lines follow the flat lines of the joined text under the Gecko profile's own
  // rules. At each width, breaking at every item boundary gives other lines.
  // Small kana don't start a line in the Gecko profile, so in the fifth row the
  // joined text keeps a small kana with the ideograph before it, where the
  // Chromium profile breaks before the kana.
  const measurementUrl = new URL('./measurement.ts', import.meta.url).href
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const richInlineUrl = new URL('./rich-inline.ts', import.meta.url).href
  const script = `
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0',
      vendor: '',
    } })
    class Context {
      font = ''
      measureText(text) {
        let width = 0
        for (const ch of text) width += ch === ' ' ? 4 : 8
        return { width }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const { getEngineProfile } = await import(${JSON.stringify(measurementUrl)})
    const { layoutWithLines, prepareWithSegments } = await import(${JSON.stringify(layoutUrl)})
    const { prepareRichInline, walkRichInlineLineRanges, materializeRichInlineLineRange, measureRichInlineStats } = await import(${JSON.stringify(richInlineUrl)})
    const rows = []
    for (const [parts, width] of [
      [['see (', 'docs', ') now please'], 70],
      [['We like ', 'Pretext', "'s speed a lot"], 112],
      [['now 50', '% faster than before'], 48],
      [['\u4E2D\u6587\u4E2D\u6587', '\u3002\u65E5\u672C\u8A9E'], 36],
      [['\u3061\u3087\u3063\u3068\u5F85', '\u3063\u3066\u304F\u3060\u3055\u3044'], 44],
      [['he said \u201Chello', '\u201D and left'], 108],
      [['a xxxx', '\uFF0Cb'], 46],
    ]) {
      const prepared = prepareRichInline(parts.map(text => ({ text, font: '16px Test' })))
      const rich = []
      walkRichInlineLineRanges(prepared, width, range => {
        rich.push(materializeRichInlineLineRange(prepared, range).fragments
          .map(fragment => (fragment.gapItemIndex < 0 ? '' : ' ') + fragment.text).join('').trimEnd())
      })
      const flat = layoutWithLines(prepareWithSegments(parts.join(''), '16px Test'), width, 20)
      rows.push({
        rich: [rich, measureRichInlineStats(prepared, width).lineCount],
        flat: [flat.lines.map(line => line.text.trimEnd()), flat.lineCount],
      })
    }
    const marks = ['\\u064B$', 'x\\n\\u064B$', 'x \\u064B$'].map(text => prepareWithSegments(text, '16px Test', { whiteSpace: 'pre-wrap' }).segments)
    console.log(JSON.stringify({ lineBreakScan: getEngineProfile().lineBreakScan, rows, marks }))
  `
  const child = Bun.spawnSync([process.execPath, '-e', script])
  if (child.exitCode !== 0) throw new Error(child.stderr.toString())
  const result = JSON.parse(child.stdout.toString()) as {
    lineBreakScan: string
    rows: Array<{ rich: [string[], number], flat: [string[], number] }>
    marks: string[][]
  }
  expect(result.lineBreakScan).toBe('gecko')
  expect(result.rows).toHaveLength(7)
  for (const row of result.rows) expect(row.rich).toEqual(row.flat)
  // A mark after a line break or a space has no base and counts as a letter,
  // as at the start of the text, so it stays with a following numeric prefix.
  expect(result.marks).toEqual([['\u064B$'], ['x', '\n', '\u064B$'], ['x', ' ', '\u064B$']])
})

test('the Safari profile keeps the kerning between a word and a following space', () => {
  // The engine profile is computed once per process, so Safari runs in a child
  // process. A is 10px, other letters 8px, a space 4px, format characters 0px,
  // and A kerns -1px with a following space, also across format characters.
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const lineBreakUrl = new URL('./line-break.ts', import.meta.url).href
  const richInlineUrl = new URL('./rich-inline.ts', import.meta.url).href
  const script = `
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      vendor: 'Apple Computer, Inc.',
    } })
    const measured = []
    class Context {
      font = ''
      measureText(text) {
        measured.push(text)
        let width = 0
        for (const ch of text) width += ch === ' ' ? 4 : /[\\u00AD\\u200B\\u200E\\u2060]/.test(ch) ? 0 : ch === 'A' ? 10 : 8
        return { width: width - (text.match(/A[\\u00AD\\u200B\\u200E\\u2060]* /g) ?? []).length }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const { prepare, prepareWithSegments, layout, layoutWithLines, layoutNextLineRange } = await import(${JSON.stringify(layoutUrl)})
    const { walkPreparedLinesRaw } = await import(${JSON.stringify(lineBreakUrl)})
    const { prepareRichInline, walkRichInlineLineRanges } = await import(${JSON.stringify(richInlineUrl)})
    const kerning = []
    for (const [text, letterSpacing] of [
      ['AA B', 0], ['AA\\u200B B', 0], ['AA\\u200E \\u05D0', 0], ['AA\\u2060 \\u2060B', 0], ['AA\\u2060 1', 0],
      ['AA\\u200B \\u05D0', 0], ['AA\\u2060 (x\\u05D0)', 0], ['AA\\u00AD B', 0], ['AA B', 1],
    ]) {
      const lines = layoutWithLines(prepareWithSegments(text, '16px Test', { letterSpacing }), 19.5, 20).lines
      kerning.push({ lines: lines.map(line => [line.text, line.width]), lineCount: layout(prepare(text, '16px Test', { letterSpacing }), 19.5, 20).lineCount })
    }
    measured.length = 0
    const spaced = layoutWithLines(prepareWithSegments('QA XA q', '16px Spaced'), 25.5, 20).lines.map(line => [line.text, line.width])
    const wordMeasurements = measured.filter(text => text.length > 1 && text !== ' ' && text !== '-')
    const remainder = prepareWithSegments('A\\u2060 B', '16px Test')
    const signed = []
    walkPreparedLinesRaw(remainder, 8.5, (width, ...cursors) => signed.push([width, ...cursors]))
    const streamed = []
    let range = layoutNextLineRange(remainder, { segmentIndex: 0, graphemeIndex: 0 }, 8.5)
    while (range !== null) {
      streamed.push(range.width)
      range = layoutNextLineRange(remainder, range.end, 8.5)
    }
    const rich = []
    walkRichInlineLineRanges(prepareRichInline([{ text: 'A\\u2060 B', font: '16px Test' }]), 8.5, line => rich.push(line.width))
    const paragraphs = [['AA\\u2060 B\\n\\u202Ax', 'pre-wrap'], ['AA\\u2060 B\\u2029\\u202Ax', 'normal'], ['AA\\u2060 B\\u202Ax', 'normal']]
      .map(([text, whiteSpace]) => prepareWithSegments(text, '16px Test', { whiteSpace }).widths[0])
    console.log(JSON.stringify({ kerning, spaced, wordMeasurements, paragraphs, remainder: {
      lines: layoutWithLines(remainder, 8.5, 20).lines.map(line => [line.text, line.width, line.start.segmentIndex, line.start.graphemeIndex, line.end.segmentIndex, line.end.graphemeIndex]),
      signed,
      streamed,
      rich,
      lineCount: layout(prepare('A\\u2060 B', '16px Test'), 8.5, 20).lineCount,
    } }))
  `
  const child = Bun.spawnSync([process.execPath, '-e', script])
  if (child.exitCode !== 0) throw new Error(child.stderr.toString())
  const { kerning, spaced, wordMeasurements, paragraphs, remainder } = JSON.parse(child.stdout.toString())
  expect(kerning).toEqual([
    // The kerned word fits and the space hangs.
    { lines: [['AA ', 19], ['B', 8]], lineCount: 2 },
    { lines: [['AA\u200B ', 19], ['B', 8]], lineCount: 2 },
    // A direction mark is a strong character that ends the word like a letter,
    // and format characters after the space are skipped to the next letter.
    { lines: [['AA\u200E ', 19], ['\u05D0', 8]], lineCount: 2 },
    { lines: [['AA\u2060 ', 19], ['\u2060B', 8]], lineCount: 2 },
    // An ASCII digit after the space takes the word's direction either way.
    { lines: [['AA\u2060 ', 19], ['1', 8]], lineCount: 2 },
    // Before right-to-left text the zero-width space may leave the word's bidi
    // run, which is unknown without the paragraph direction.
    { lines: [['A', 10], ['A\u200B ', 10], ['\u05D0', 8]], lineCount: 3 },
    // A closed bracket pair after the space can take the paragraph direction.
    { lines: [['A', 10], ['A\u2060 ', 10], ['(x', 16], ['\u05D0)', 16]], lineCount: 4 },
    // On an RTL page a soft hyphen before the space also costs a hyphen.
    { lines: [['A', 10], ['A ', 10], ['B', 8]], lineCount: 3 },
    // With letter spacing the measurement also moves gaps; not modeled.
    { lines: [['A', 11], ['A ', 11], ['B', 9]], lineCount: 3 },
  ])
  // A word before a space is measured together with that space instead of
  // alone, and keeps the -1px kerning.
  expect(spaced).toEqual([['QA ', 17], ['XA ', 17], ['q', 8]])
  expect(wordMeasurements).toEqual(['QA ', 'XA '])
  // An explicit bidi control ends with its paragraph, at a newline in pre-wrap
  // or at U+2029, so one in a later paragraph keeps the kerning. One in the same
  // paragraph leaves the space's direction unknown.
  expect(paragraphs).toEqual([19, 19, 20])
  // An emergency break inside A and the word joiner leaves the joiner alone
  // with the -1px kerning. Breaking keeps that signed advance, so the cursors
  // match the internal walker's, but every reported width is clamped at zero.
  expect(remainder).toEqual({
    lines: [['A', 10, 0, 0, 0, 1], ['\u2060 ', 0, 0, 1, 2, 0], ['B', 8, 2, 0, 3, 0]],
    signed: [[10, 0, 0, 0, 1], [-1, 0, 1, 2, 0], [8, 2, 0, 3, 0]],
    streamed: [10, 0, 8],
    rich: [10, 0, 8],
    lineCount: 3,
  })
})


test('the Safari profile lets small kana and U+30FC start a line only on Japanese and Korean pages', () => {
  // The engine profile is computed once per process, so Safari runs in a child
  // process. Every character is 16px. Preparation reads <html lang> once.
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const richInlineUrl = new URL('./rich-inline.ts', import.meta.url).href
  const script = `
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Safari/605.1.15',
      vendor: 'Apple Computer, Inc.',
    } })
    class Context {
      font = ''
      measureText(text) {
        return { width: [...text].length * 16 }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    let lang = ''
    let reads = 0
    globalThis.document = { documentElement: { get lang() { reads++; return lang } } }
    const { prepareWithSegments } = await import(${JSON.stringify(layoutUrl)})
    const { prepareRichInline, walkRichInlineLineRanges, materializeRichInlineLineRange } = await import(${JSON.stringify(richInlineUrl)})
    const rows = {}
    for (const language of ['', 'en', 'zh-Hant', 'ja', 'ko-KR']) {
      lang = language
      reads = 0
      const segments = ['日本ァア', '日本ーー', 'わかって'].map(text => prepareWithSegments(text, '16px Test').segments.join('|'))
      const readsPerPrepare = reads / 3
      const prepared = prepareRichInline(['日本', 'ァア'].map(text => ({ text, font: '16px Test' })))
      const rich = []
      walkRichInlineLineRanges(prepared, 32.1, range => {
        rich.push(materializeRichInlineLineRange(prepared, range).fragments.map(fragment => fragment.text).join(''))
      })
      rows[language] = { segments, readsPerPrepare, rich }
    }
    console.log(JSON.stringify(rows))
  `
  const child = Bun.spawnSync([process.execPath, '-e', script])
  if (child.exitCode !== 0) throw new Error(child.stderr.toString())
  // Apple ICU opens its normal line rules, where CJ is ID, for ja and ko. Under
  // its other rules CJ is NS and stays with the character before it. The first
  // preparation after a language change reads the language once too.
  const root = { segments: ['日|本ァ|ア', '日|本ーー', 'わ|かっ|て'], readsPerPrepare: 1, rich: ['日', '本ァ', 'ア'] }
  const normalRules = { segments: ['日|本|ァ|ア', '日|本|ー|ー', 'わ|か|っ|て'], readsPerPrepare: 1, rich: ['日本', 'ァア'] }
  expect(JSON.parse(child.stdout.toString())).toEqual({ '': root, en: root, 'zh-Hant': root, ja: normalRules, 'ko-KR': normalRules })
})

test('the Chromium profile measures a page without a language under Intl\'s default locale', () => {
  // The engine profile is computed once per process, so Chrome runs in a child process.
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const script = `
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    } })
    const langs = []
    class Context {
      font = ''
      lang = 'inherit'
      measureText(text) {
        langs.push(this.lang)
        return { width: [...text].length * 16 }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    let lang = ''
    globalThis.document = { documentElement: { get lang() { return lang } } }
    const { prepare } = await import(${JSON.stringify(layoutUrl)})
    const rows = {}
    for (const language of ['', 'en', '']) {
      lang = language
      langs.length = 0
      prepare('中文 text', '16px Test')
      rows[language] = [...new Set(langs)]
    }
    console.log(JSON.stringify({ rows, intl: new Intl.DateTimeFormat().resolvedOptions().locale }))
  `
  const child = Bun.spawnSync([process.execPath, '-e', script])
  if (child.exitCode !== 0) throw new Error(child.stderr.toString())
  const { rows, intl } = JSON.parse(child.stdout.toString()) as { rows: Record<string, string[]>; intl: string }
  expect(rows).toEqual({ '': [intl], en: ['inherit'] })
})
