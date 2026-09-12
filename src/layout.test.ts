import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createVariant } from '../tests/wrapping/contracts.ts'

// Keep the permanent suite small and durable. These tests exercise the shipped
// prepare/layout exports with a deterministic fake canvas backend. For narrow
// browser-specific investigations, prefer throwaway probes and browser checkers
// over mirroring the full implementation here.

const FONT = '16px Test Sans'
const LINE_HEIGHT = 19

type LayoutModule = typeof import('./layout.ts')
type LineBreakModule = typeof import('./line-break.ts')
type MeasurementModule = typeof import('./measurement.ts')
type RichInlineModule = typeof import('./rich-inline.ts')
type AnalysisModule = typeof import('./analysis.ts')
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
let getSegmentBreakableFitAdvances: MeasurementModule['getSegmentBreakableFitAdvances']
let prepareRichInline: RichInlineModule['prepareRichInline']
let layoutNextRichInlineLineRange: RichInlineModule['layoutNextRichInlineLineRange']
let materializeRichInlineLineRange: RichInlineModule['materializeRichInlineLineRange']
let measureRichInlineStats: RichInlineModule['measureRichInlineStats']
let walkRichInlineLineRanges: RichInlineModule['walkRichInlineLineRanges']
let isCJK: AnalysisModule['isCJK']
let variant: ReturnType<typeof createVariant>
let canvasMeasurementCount = 0

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
  segLevels?: Int8Array | null
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

  for (const ch of text) {
    if (ch === '\u200B') continue
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

function getNonSpaceSegmentLevels(
  prepared: TestPreparedTextWithSegments,
): Array<{ level: number, text: string }> {
  if (prepared.segLevels === null || prepared.segLevels === undefined) return []

  const levels: Array<{ level: number, text: string }> = []
  for (let i = 0; i < prepared.segments.length; i++) {
    const text = prepared.segments[i]!
    if (text.trim().length === 0) continue
    levels.push({ level: prepared.segLevels[i]!, text })
  }
  return levels
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
  const [analysisMod, mod, lineBreakMod, measurementMod, richInlineMod] = await Promise.all([
    import('./analysis.ts'),
    import('./layout.ts'),
    import('./line-break.ts'),
    import('./measurement.ts'),
    import('./rich-inline.ts'),
  ])
  ;({ isCJK } = analysisMod)
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
  ;({ countPreparedLines, measurePreparedLineGeometry, stepPreparedLineGeometry, walkPreparedLinesRaw } = lineBreakMod)
  ;({ getSegmentBreakableFitAdvances } = measurementMod)
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

  test('symbol overflow eligibility preserves emoji ordinary-boundary policy', async () => {
    const { isIndependentSymbolRun } = await import('./analysis.ts')
    expect(isIndependentSymbolRun('|\u0301|')).toBe(true)
    for (const text of ['😀((', '☀\uFE0F((', '🏽', '\u0301', '|\u200D|']) {
      expect(isIndependentSymbolRun(text)).toBe(false)
    }
  })

  test('Gecko ASCII opener attachment does not broaden the Unicode-affix model', async () => {
    const { analyzeText } = await import('./analysis.ts')
    const profile = {
      geckoAsciiLineBreaks: true, carryCJKAfterClosingQuote: false, breakKeepAllAfterPunctuation: true,
      breakKeepAllAfterNonstarterLetters: true, keepZeroWidthSpaceMarkAtScanStart: false,
      breakBeforeConditionalJapaneseStarter: false,
      wordInitialHyphenLetters: 'none' as const, breakHyphenAfterCollapsedTab: false,
      segmentBreakRemovalRun: 'none' as const,
    }
    for (const text of ['####((aabb', '""""[[aabb', '−+x«value»!']) {
      expect(analyzeText(text, profile).texts).toEqual([text])
    }
    // Intl word partitions differ between Bun and Firefox. The ASCII policy
    // must preserve the existing CJK result for either partition.
    expect(analyzeText('한글x{value}', profile).texts).toEqual(
      analyzeText('한글x{value}', { ...profile, geckoAsciiLineBreaks: false }).texts,
    )
  })

  test('exclamation punctuation keeps the break browsers offer before a word', async () => {
    const { analyzeText } = await import('./analysis.ts')
    const profile = {
      geckoAsciiLineBreaks: false, carryCJKAfterClosingQuote: false, breakKeepAllAfterPunctuation: true,
      breakKeepAllAfterNonstarterLetters: false, keepZeroWidthSpaceMarkAtScanStart: false,
      breakBeforeConditionalJapaneseStarter: false,
      wordInitialHyphenLetters: 'alphabetic' as const, breakHyphenAfterCollapsedTab: false,
      segmentBreakRemovalRun: 'none' as const,
    }
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
    expect(analyzeText('x?-b', { ...profile, geckoAsciiLineBreaks: true }).texts).toEqual(['x?-', 'b'])
    // Iteration marks are NS and stay after EX. CJ such as U+30FC breaks only
    // under ICU's normal rules.
    expect(analyzeText('\u65E5\uFF01\u3005', profile).texts).toEqual(['\u65E5\uFF01\u3005'])
    expect(analyzeText('\u65E5\uFF1F\u30FC', profile).texts).toEqual(['\u65E5\uFF1F\u30FC'])
    expect(analyzeText('\u65E5\uFF1F\u30FC', { ...profile, breakBeforeConditionalJapaneseStarter: true }).texts)
      .toEqual(['\u65E5\uFF1F', '\u30FC'])
  })

  test('ZWJ and a word-initial hyphen keep the following character', async () => {
    const { analyzeText, getBreakablePreferredBreaks } = await import('./analysis.ts')
    const profile = {
      geckoAsciiLineBreaks: false, carryCJKAfterClosingQuote: false, breakKeepAllAfterPunctuation: true,
      breakKeepAllAfterNonstarterLetters: false, keepZeroWidthSpaceMarkAtScanStart: false,
      breakBeforeConditionalJapaneseStarter: false,
      wordInitialHyphenLetters: 'alphabetic' as const, breakHyphenAfterCollapsedTab: false,
      segmentBreakRemovalRun: 'none' as const,
    }
    // UAX #14 LB8a and LB20a. A ZWJ after a space belongs to that space's
    // grapheme cluster and keeps its existing boundaries. The pair tables still
    // break '-' before an ASCII letter, and Firefox's ICU4X rules predate LB20a.
    expect(analyzeText('\u200Dab', profile).texts).toEqual(['\u200Dab'])
    expect(analyzeText('a\n\u200Db', profile, 'pre-wrap').texts).toEqual(['a', '\n', '\u200Db'])
    expect(analyzeText('a \u200Db', profile).texts).toEqual(['a', ' ', '\u200D', 'b'])
    // Only an extender joins the space, astral code points included.
    expect(analyzeText('x \u{1F600}\u200Db', profile).texts).toEqual(['x', ' ', '\u{1F600}\u200Db'])
    expect(analyzeText('a \u{1F3FB}\u200Db', profile).texts).toEqual(['a', ' ', '\u{1F3FB}\u200D', 'b'])
    expect(analyzeText('a \u2010b', profile).texts).toEqual(['a', ' ', '\u2010b'])
    expect(analyzeText('a -b', profile).texts).toEqual(['a', ' ', '-', 'b'])
    // WebKit's scan still reads a collapsed TAB (BA) before the hyphen.
    expect(analyzeText('a\t\u2010b', profile).texts).toEqual(['a', ' ', '\u2010b'])
    expect(analyzeText('a\t\u2010b', { ...profile, breakHyphenAfterCollapsedTab: true }).texts)
      .toEqual(['a', ' ', '\u2010', 'b'])
    expect(analyzeText('a \u2010b', { ...profile, wordInitialHyphenLetters: 'none' }).texts).toEqual(['a', ' ', '\u2010', 'b'])
    // Only AL letters keep it, plus HL letters where the profile says so.
    expect(analyzeText('a \u2010\u3105b', profile).texts).toEqual(['a', ' ', '\u2010', '\u3105b'])
    expect(analyzeText('a \u2010\u05D1b', profile).texts).toEqual(['a', ' ', '\u2010', '\u05D1b'])
    expect(analyzeText('a \u2010\u05D1b', { ...profile, wordInitialHyphenLetters: 'alphabetic-and-hebrew' }).texts)
      .toEqual(['a', ' ', '\u2010\u05D1b'])
    // The other Unicode 17 HH dashes keep their letter like U+2010, astral ones included.
    const hebrewProfile = { ...profile, wordInitialHyphenLetters: 'alphabetic-and-hebrew' as const }
    const noneProfile = { ...profile, wordInitialHyphenLetters: 'none' as const }
    expect(analyzeText('a \u2012b', hebrewProfile).texts).toEqual(['a', ' ', '\u2012b'])
    expect(analyzeText('a \u2013\u05D1b', hebrewProfile).texts).toEqual(['a', ' ', '\u2013\u05D1b'])
    for (const text of ['a \u05BE\u05D1b', 'a \u1400b', 'a \u{10EAD}\u0430b']) {
      expect(analyzeText(text, hebrewProfile).texts).toEqual(['a', ' ', text.slice(2)])
    }
    expect(analyzeText('a \u2013b', noneProfile).texts).toEqual(['a', ' ', '\u2013', 'b'])
    // WebKit's scan reads a collapsed TAB before U+002D, U+2010, U+2012 and
    // U+2013, pairing source and normalized hyphens by count. The other HH
    // dashes already join the next text after a TAB in every profile, while
    // WebKit breaks there.
    const tabProfile = { ...hebrewProfile, breakHyphenAfterCollapsedTab: true }
    expect(analyzeText('x-y  \t\u2012b  \u2013b', tabProfile).texts)
      .toEqual(['x-', 'y', ' ', '\u2012', 'b', ' ', '\u2013b'])
    for (const text of ['a\t\u05BEb', 'a\t\u{10EAD}b']) {
      for (const tabCaseProfile of [tabProfile, hebrewProfile, noneProfile]) {
        expect(analyzeText(text, tabCaseProfile).texts).toEqual(['a', ' ', text.slice(2)])
      }
    }
    // An overflowing word does not prefer the break LB20a removed.
    expect(getBreakablePreferredBreaks('\u2010ab', profile)).toBeNull()
    expect(getBreakablePreferredBreaks('a\u2010b', profile)).toEqual([2])
    expect(getBreakablePreferredBreaks('\u2010 bar', profile)).toEqual([1])
    expect(getBreakablePreferredBreaks('\u058A\u0561b', hebrewProfile)).toBeNull()
    expect(getBreakablePreferredBreaks('\u058A\u0561b', noneProfile)).toEqual([1])
  })

  test('the profile without a navigator keeps Hebrew letters after a word-initial hyphen', async () => {
    // Unknown user agents, such as Bun's, get the ICU 78 letters, and so does
    // a runtime with no navigator.
    const { getEngineProfile } = await import('./measurement.ts')
    expect(getEngineProfile().wordInitialHyphenLetters).toBe('alphabetic-and-hebrew')
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true })
    try {
      const specifier = './measurement.ts?no-navigator'
      const fresh = await import(specifier) as MeasurementModule
      expect(typeof navigator).toBe('undefined')
      expect(fresh.getEngineProfile().wordInitialHyphenLetters).toBe('alphabetic-and-hebrew')
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, 'navigator')
      else Object.defineProperty(globalThis, 'navigator', descriptor)
    }
  })

  test('segmenting a ZWJ after a space grows linearly with the text', async () => {
    const { analyzeText, clearAnalysisCaches } = await import('./analysis.ts')
    const profile = {
      geckoAsciiLineBreaks: false, carryCJKAfterClosingQuote: false, breakKeepAllAfterPunctuation: true,
      breakKeepAllAfterNonstarterLetters: false, keepZeroWidthSpaceMarkAtScanStart: false,
      breakBeforeConditionalJapaneseStarter: false,
      wordInitialHyphenLetters: 'alphabetic' as const, breakHyphenAfterCollapsedTab: false,
      segmentBreakRemovalRun: 'none' as const,
    }
    const Segmenter = Intl.Segmenter
    let segmentedUnits = 0
    Reflect.set(Intl, 'Segmenter', class extends Segmenter {
      override segment(input: string): Intl.Segments {
        segmentedUnits += input.length
        return super.segment(input)
      }
    })
    clearAnalysisCaches()
    try {
      for (const whiteSpace of ['normal', 'pre-wrap'] as const) {
        const counts: number[] = []
        for (const repeats of [64, 256]) {
          segmentedUnits = 0
          analyzeText('ab \u200Dcd '.repeat(repeats), profile, whiteSpace)
          counts.push(segmentedUnits)
        }
        // Four times the text is about four times the segmenter input. A pass
        // over the whole text per joiner would make it sixteen times.
        expect(counts[1]!).toBeLessThan(counts[0]! * 5)
      }
    } finally {
      Reflect.set(Intl, 'Segmenter', Segmenter)
      clearAnalysisCaches()
    }
  })

  test('a ZWSP that starts a WebKit scan keeps a basic combining mark', async () => {
    const { analyzeText } = await import('./analysis.ts')
    const profile = {
      geckoAsciiLineBreaks: false, carryCJKAfterClosingQuote: false, breakKeepAllAfterPunctuation: false,
      breakKeepAllAfterNonstarterLetters: false, keepZeroWidthSpaceMarkAtScanStart: true,
      breakBeforeConditionalJapaneseStarter: false,
      wordInitialHyphenLetters: 'alphabetic-and-hebrew' as const, breakHyphenAfterCollapsedTab: true,
      segmentBreakRemovalRun: 'none' as const,
    }
    expect(analyzeText('\u200B\u0301ab', profile).texts).toEqual(['\u200B\u0301ab'])
    expect(analyzeText('x\n\u200B\u0301ab', profile, 'pre-wrap').texts).toEqual(['x', '\n', '\u200B\u0301ab'])
    // Source before the ZWSP, even a collapsed leading space, is prior context.
    expect(analyzeText(' \u200B\u0301ab', profile).texts).toEqual(['\u200B', '\u0301ab'])
    expect(analyzeText('x\u200B\u0301ab', profile).texts).toEqual(['x', '\u200B', '\u0301ab'])
  })

  test('a rich item keeps its collapsed leading whitespace as WebKit break context', async () => {
    const { getEngineProfile } = await import('./measurement.ts')
    const profile = getEngineProfile()
    const previous = profile.keepZeroWidthSpaceMarkAtScanStart
    profile.keepZeroWidthSpaceMarkAtScanStart = true
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
      profile.keepZeroWidthSpaceMarkAtScanStart = previous
    }
  })

  test('Chrome and Firefox remove a newline run next to a zero-width space through their own runs', async () => {
    const { getEngineProfile } = await import('./measurement.ts')
    const profile = getEngineProfile()
    const previous = profile.segmentBreakRemovalRun
    try {
      for (const [browser, run, column] of [['safari', 'none', 1], ['chrome', 'blink', 2], ['firefox', 'gecko', 3]] as const) {
        profile.segmentBreakRemovalRun = run
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
          expect(line?.fragments.map(fragment => fragment.gapBefore > 0)).toEqual([false, gaps[column]])
        }
      }
    } finally {
      profile.segmentBreakRemovalRun = previous
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

  test('keeps non-breaking spaces as glue instead of collapsing them away', () => {
    const prepared = prepareWithSegments('Hello\u00A0world', FONT)
    expect(prepared.segments).toEqual(['Hello\u00A0world'])
    expect(prepared.kinds).toEqual(['text'])
  })

  test('keeps standalone non-breaking spaces as visible glue content', () => {
    const prepared = prepareWithSegments('\u00A0', FONT)
    expect(prepared.segments).toEqual(['\u00A0'])
    expect(layout(prepared, 200, LINE_HEIGHT)).toEqual({ lineCount: 1, height: LINE_HEIGHT })
  })

  test('pre-wrap mode keeps whitespace-only input visible', () => {
    const prepared = prepare('   ', FONT, { whiteSpace: 'pre-wrap' })
    expect(layout(prepared, 200, LINE_HEIGHT)).toEqual({ lineCount: 1, height: LINE_HEIGHT })
  })

  test('keeps narrow no-break spaces as glue content', () => {
    const prepared = prepareWithSegments('10\u202F000', FONT)
    expect(prepared.segments).toEqual(['10\u202F000'])
    expect(prepared.kinds).toEqual(['text'])
  })

  test('keeps figure spaces as glue content', () => {
    const doubled = prepareWithSegments('a\u2007\u2007b', FONT)
    expect(doubled.segments).toEqual(['a\u2007\u2007b'])
    expect(doubled.kinds).toEqual(['text'])

    const prepared = prepareWithSegments('tail\u2007word', FONT)
    expect(prepared.segments).toEqual(['tail\u2007word'])
    expect(prepared.kinds).toEqual(['text'])
    const width = measureWidth('tail\u2007w', FONT) + 0.1
    expect(layoutWithLines(prepared, width, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['tail\u2007w', 'ord'])
  })

  test('keeps word joiners as glue content', () => {
    const prepared = prepareWithSegments('foo\u2060bar', FONT)
    expect(prepared.segments).toEqual(['foo\u2060bar'])
    expect(prepared.kinds).toEqual(['text'])
  })

  test('treats zero-width spaces as explicit break opportunities', () => {
    const prepared = prepareWithSegments('alpha\u200Bbeta', FONT)
    expect(prepared.segments).toEqual(['alpha', '\u200B', 'beta'])
    expect(prepared.kinds).toEqual(['text', 'zero-width-break', 'text'])

    const alphaWidth = prepared.widths[0]!
    expect(layout(prepared, alphaWidth + 0.1, LINE_HEIGHT).lineCount).toBe(2)
  })

  test('only the Blink profile returns from an unfit hyphen and paints the hyphen unspaced', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    try {
      for (const [index, userAgent, unfitHyphenRetreat, letterSpaceDiscretionaryHyphen] of [
        [0, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', 'reduced-width', false],
        [1, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Safari/605.1.15', 'none', true],
        [2, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0', 'none', true],
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

    const { getEngineProfile } = await import('./measurement.ts')
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

  test('Blink returns an unfit soft hyphen to the latest earlier break that leaves room for the hyphen', async () => {
    const { getEngineProfile } = await import('./measurement.ts')
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

      // A hand-built handle without soft-hyphen contexts keeps the overflowing hyphen.
      const handBuilt = { ...prepareWithSegments(text, FONT) } as Record<string, unknown>
      Reflect.deleteProperty(handBuilt, 'discretionaryHyphenContexts')
      expect(walkPreparedLinesRaw(handBuilt as unknown as Parameters<typeof walkPreparedLinesRaw>[0], width)).toBe(2)
    } finally {
      profile.unfitHyphenRetreat = previous
    }
  })

  test('Blink keeps an unfit hyphen where the text around the soft hyphen measures narrower joined', async () => {
    const { getEngineProfile } = await import('./measurement.ts')
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
      expect(layoutWithLines(prepareWithSegments('ab A\u00ADVAV', font), 36, LINE_HEIGHT).lines.map(line => line.text))
        .toEqual(['ab A-', 'VAV'])
    } finally {
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
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

  test('keeps closing punctuation attached to the preceding word', () => {
    const prepared = prepareWithSegments('hello.', FONT)
    expect(prepared.segments).toEqual(['hello.'])
  })

  test('keeps arabic punctuation attached to the preceding word', () => {
    const prepared = prepareWithSegments('مرحبا، عالم؟', FONT)
    expect(prepared.segments).toEqual(['مرحبا،', ' ', 'عالم؟'])
  })

  test('keeps arabic punctuation-plus-mark clusters attached to the preceding word', () => {
    const prepared = prepareWithSegments('وحوارى بكشء،ٍ من قولهم', FONT)
    expect(prepared.segments).toEqual(['وحوارى', ' ', 'بكشء،ٍ', ' ', 'من', ' ', 'قولهم'])
  })

  test('keeps arabic no-space punctuation clusters together', () => {
    const prepared = prepareWithSegments('فيقول:وعليك السلام', FONT)
    expect(prepared.segments).toEqual(['فيقول:وعليك', ' ', 'السلام'])
  })

  test('keeps arabic comma-followed text together without a space', () => {
    const prepared = prepareWithSegments('همزةٌ،ما كان', FONT)
    expect(prepared.segments).toEqual(['همزةٌ،ما', ' ', 'كان'])
  })

  test('keeps leading arabic combining marks with the following word', () => {
    const prepared = prepareWithSegments('كل ِّواحدةٍ', FONT)
    expect(prepared.segments).toEqual(['كل', ' ', 'ِّواحدةٍ'])
  })

  test('keeps devanagari danda punctuation attached to the preceding word', () => {
    const prepared = prepareWithSegments('नमस्ते। दुनिया॥', FONT)
    expect(prepared.segments).toEqual(['नमस्ते।', ' ', 'दुनिया॥'])
  })

  test('keeps myanmar punctuation attached to the preceding word', () => {
    const prepared = prepareWithSegments('ဖြစ်သည်။ နောက်တစ်ခု၊ ကိုက်ချီ၍ ယုံကြည်မိကြ၏။', FONT)
    expect(prepared.segments.slice(0, 7)).toEqual(['ဖြစ်သည်။', ' ', 'နောက်တစ်ခု၊', ' ', 'ကိုက်', 'ချီ၍', ' '])
    expect(prepared.segments.at(-1)).toBe('ကြ၏။')
  })

  test('keeps myanmar possessive marker attached to the following word', () => {
    const prepared = prepareWithSegments('ကျွန်ုပ်၏လက်မဖြင့်', FONT)
    expect(prepared.segments).toEqual(['ကျွန်ုပ်၏လက်မ', 'ဖြင့်'])
  })

  test('keeps opening quotes attached to the following word', () => {
    const prepared = prepareWithSegments('“Whenever', FONT)
    expect(prepared.segments).toEqual(['“Whenever'])
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

  test('keeps apostrophe-led elisions attached to the following word', () => {
    const prepared = prepareWithSegments('“Take ’em downstairs', FONT)
    expect(prepared.segments).toEqual(['“Take', ' ', '’em', ' ', 'downstairs'])
  })

  test('keeps stacked opening quotes attached to the following word', () => {
    const prepared = prepareWithSegments('invented, “‘George B. Wilson', FONT)
    expect(prepared.segments).toEqual(['invented,', ' ', '“‘George', ' ', 'B.', ' ', 'Wilson'])
  })

  test('treats ascii quotes as opening and closing glue by context', () => {
    const prepared = prepareWithSegments('said "hello" there', FONT)
    expect(prepared.segments).toEqual(['said', ' ', '"hello"', ' ', 'there'])
  })

  test('treats escaped ascii quote clusters as opening and closing glue by context', () => {
    const text = String.raw`say \"hello\" there`
    const prepared = prepareWithSegments(text, FONT)
    expect(prepared.segments).toEqual(['say', ' ', String.raw`\"hello\"`, ' ', 'there'])
  })

  test('keeps escaped quote clusters attached through preceding opening punctuation', () => {
    const text = String.raw`((\"\"word`
    const prepared = prepareWithSegments(text, FONT)
    expect(prepared.segments).toEqual([text])
  })

  test('keeps numeric prefix and postfix line-break classes attached', () => {
    expect(prepareWithSegments('$___', FONT).segments).toEqual(['$___'])
    expect(prepareWithSegments('$500', FONT).segments).toEqual(['$500'])
    expect(prepareWithSegments('500€', FONT).segments).toEqual(['500€'])
    expect(prepareWithSegments('+500', FONT).segments).toEqual(['+500'])
    expect(prepareWithSegments('−500', FONT).segments).toEqual(['−500'])
    expect(prepareWithSegments('foo%bar', FONT).segments).toEqual(['foo%bar'])
    expect(prepareWithSegments('50°C', FONT).segments).toEqual(['50°C'])
    expect(prepareWithSegments('$(12.35)', FONT).segments).toEqual(['$(12.35)'])
    expect(prepareWithSegments('-1/12', FONT).segments).toEqual(['-1/12'])
  })

  test('keeps URL-like runs together as one breakable segment', () => {
    const prepared = prepareWithSegments('see https://example.com/reports/q3?lang=ar&mode=full now', FONT)
    expect(prepared.segments).toEqual([
      'see',
      ' ',
      'https://example.com/reports/q3?',
      'lang=ar&mode=full',
      ' ',
      'now',
    ])
  })

  test('prefers hyphen-like boundaries inside overlong breakable runs', () => {
    const text = 'https://alpha-beta-gamma-delta.example.test/path'
    const prepared = prepareWithSegments(text, FONT)
    const width = measureWidth('https://alpha-bet', FONT) + 0.1

    expect(prepared.segments).toEqual([text])

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

  test('resumes around preferred boundaries without reusing consumed hyphens', () => {
    const text = 'https://a-bc-defgh-ij'
    for (const letterSpacing of [0, 1]) {
      const prepared = prepareWithSegments(text, FONT, { letterSpacing })
      const width = measureWidth('bc-def', FONT) + 6 * letterSpacing + 0.1
      for (const [graphemeIndex, expected] of [[9, '-bc-'], [10, 'bc-'], [11, 'c-'], [19, 'ij']] as const) {
        const start = { segmentIndex: 0, graphemeIndex }
        const line = layoutNextLine(prepared, start, width)!
        expect(line.text).toBe(expected)
        const range = layoutNextLineRange(prepared, start, width)!
        expect(materializeLineRange(prepared, range)).toEqual(line)
      }
    }
  })

  test('does not prefer hyphen-like boundaries in keep-all runs', () => {
    const text = 'foo-bar日本語'
    const prepared = prepareWithSegments(text, FONT, { wordBreak: 'keep-all' })

    expect(prepared.segments).toEqual(['foo-', 'bar日本語'])
    expect(prepared.breakablePreferredBreaks).toEqual([null, null])
  })

  test('keeps no-space punctuation chains together as one breakable segment', () => {
    const prepared = prepareWithSegments(
      'foo;bar foo:bar foo,bar foo.bar as;lkdfjals;k ééé.ééé αβγ.δεζ אבג.דהו',
      FONT,
    )
    expect(prepared.segments).toEqual([
      'foo;bar',
      ' ',
      'foo:bar',
      ' ',
      'foo,bar',
      ' ',
      'foo.bar',
      ' ',
      'as;lkdfjals;k',
      ' ',
      'ééé.ééé',
      ' ',
      'αβγ.δεζ',
      ' ',
      'אבג.דהו',
    ])
  })

  test('keeps no-space word-internal symbol chains together as one breakable segment', () => {
    for (const symbol of ['`', '~', '!', '@', '#', '^', '&', '*', '=', '/', '{', '}', '[', ']', '|', '"', '<', '>', '♂', '╥', '∟', '┌']) {
      expect(prepareWithSegments(`foo${symbol}bar`, FONT).segments).toEqual([`foo${symbol}bar`])
    }

    expect(prepareWithSegments('foo#$bar', FONT).segments).toEqual(['foo#$bar'])
    expect(prepareWithSegments('#hashtag mention@domain', FONT).segments).toEqual([
      '#hashtag',
      ' ',
      'mention@domain',
    ])
  })

  test('keeps browser break symbols out of no-space word-internal symbol chains', () => {
    expect(prepareWithSegments('foo?bar', FONT).segments).toEqual(['foo?', 'bar'])
    expect(prepareWithSegments('foo—bar', FONT).segments).toEqual(['foo', '—', 'bar'])
    expect(prepareWithSegments('foo…bar', FONT).segments).toEqual(['foo…', 'bar'])
    expect(prepareWithSegments('foo‼bar', FONT).segments).toEqual(['foo', '‼', 'bar'])
    expect(prepareWithSegments('foo🙂bar', FONT).segments).toEqual(['foo', '🙂', 'bar'])
  })

  test('keeps numeric time ranges together', () => {
    const prepared = prepareWithSegments('window 7:00-9:00 only', FONT)
    expect(prepared.segments).toEqual(['window', ' ', '7:00-', '9:00', ' ', 'only'])
  })

  test('splits hyphenated numeric identifiers at preferred boundaries', () => {
    const prepared = prepareWithSegments('SSN 420-69-8008 filed', FONT)
    expect(prepared.segments).toEqual(['SSN', ' ', '420-', '69-', '8008', ' ', 'filed'])
  })

  test('keeps unicode-digit numeric expressions together', () => {
    const prepared = prepareWithSegments('यह २४×७ सपोर्ट है', FONT)
    expect(prepared.segments).toEqual(['यह', ' ', '२४×७', ' ', 'सपोर्ट', ' ', 'है'])
  })

  test('does not attach opening punctuation to following whitespace', () => {
    const prepared = prepareWithSegments('“ hello', FONT)
    expect(prepared.segments).toEqual(['“', ' ', 'hello'])
  })

  test('keeps japanese iteration marks attached to the preceding kana', () => {
    const prepared = prepareWithSegments('棄てゝ行く', FONT)
    expect(prepared.segments).toEqual(['棄', 'てゝ', '行', 'く'])
  })

  test('carries trailing cjk opening punctuation forward across segment boundaries', () => {
    const prepared = prepareWithSegments('作者はさつき、「下人', FONT)
    expect(prepared.segments).toEqual(['作', '者', 'は', 'さ', 'つ', 'き、', '「下', '人'])
  })

  test('keeps em dashes breakable', () => {
    const prepared = prepareWithSegments('universe—so', FONT)
    expect(prepared.segments).toEqual(['universe', '—', 'so'])
  })

  test('coalesces repeated punctuation runs into a single segment', () => {
    const prepared = prepareWithSegments('=== heading ===', FONT)
    expect(prepared.segments).toEqual(['===', ' ', 'heading', ' ', '==='])
  })

  test('keeps long repeated punctuation runs coalesced', () => {
    const text = '('.repeat(256)
    const prepared = prepareWithSegments(text, FONT)
    expect(prepared.segments).toEqual([text])
  })

  test('keeps repeated punctuation runs attachable to trailing closing punctuation', () => {
    const prepared = prepareWithSegments('((()', FONT)
    expect(prepared.segments).toEqual(['((()'])
    expect(prepareWithSegments('((() ===', FONT).segments).toEqual(['((()', ' ', '==='])
  })

  test('applies CJK and Hangul punctuation attachment rules', () => {
    expect(prepareWithSegments('中文，测试。', FONT).segments).toEqual(['中', '文，', '测', '试。'])
    expect(prepareWithSegments('테스트입니다.', FONT).segments.at(-1)).toBe('다.')
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

  test('the Chromium profile carries CJK text after closing quotes, not closing brackets', async () => {
    const { getEngineProfile } = await import('./measurement.ts')
    const profile = getEngineProfile()
    const previous = profile.carryCJKAfterClosingQuote
    profile.carryCJKAfterClosingQuote = true
    try {
      // Fullwidth closing brackets are UAX #14 CL, and Chromium breaks between CL and ID.
      for (const close of ['\u300D', '\u300F', '\u3011', '\u300B', '\u3009', '\u3015', '\uFF09']) {
        expect(prepareWithSegments(`\u6587${close}\u6587`, FONT).segments).toEqual([`\u6587${close}`, '\u6587'])
      }
      expect(prepareWithSegments('\uB2E4.\u300D\uB77C\uACE0', FONT).segments).toEqual(['\uB2E4.\u300D', '\uB77C', '\uACE0'])
      // No break after a period and closing quote before Hangul (UAX #14 LB19a).
      expect(prepareWithSegments('\uC5B4.\u201D\uB77C\uACE0', FONT).segments).toEqual(['\uC5B4.\u201D\uB77C', '\uACE0'])
    } finally {
      profile.carryCJKAfterClosingQuote = previous
    }
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

  test('keep-all runs continue after letters that cannot start a line', async () => {
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
    const { getEngineProfile } = await import('./measurement.ts')
    const profile = getEngineProfile()
    const previous = profile.breakKeepAllAfterNonstarterLetters
    profile.breakKeepAllAfterNonstarterLetters = true
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
      profile.breakKeepAllAfterNonstarterLetters = previous
    }
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

  test('keeps non-CJK glue-connected runs intact before CJK text', () => {
    const prepared = prepareWithSegments('foo\u00A0世界', FONT)
    expect(prepared.segments).toEqual(['foo\u00A0', '世', '界'])
  })

  test('keep-all keeps CJK-containing no-space runs cohesive with punctuation fallback boundaries', () => {
    expect(prepareWithSegments('中文，测试。', FONT, { wordBreak: 'keep-all' }).segments).toEqual(['中文，', '测试。'])
    expect(prepareWithSegments('한국어테스트', FONT, { wordBreak: 'keep-all' }).segments).toEqual(['한국어테스트'])
    expect(prepareWithSegments('漢'.repeat(256), FONT, { wordBreak: 'keep-all' }).segments).toEqual(['漢'.repeat(256)])

    for (const text of ['abc日本語', '123日本語', 'abc123日本語', 'foo_bar日本語', 'foo.bar日本語', '500円テスト', '日本語foo.bar']) {
      expect(prepareWithSegments(text, FONT, { wordBreak: 'keep-all' }).segments).toEqual([text])
    }

    expect(prepareWithSegments('日本語foo-bar', FONT, { wordBreak: 'keep-all' }).segments).toEqual(['日本語foo-', 'bar'])
    expect(prepareWithSegments('日本語foo—bar', FONT, { wordBreak: 'keep-all' }).segments).toEqual(['日本語foo—', 'bar'])
    expect(prepareWithSegments('foo-bar日本語', FONT, { wordBreak: 'keep-all' }).segments).toEqual(['foo-', 'bar日本語'])
    expect(prepareWithSegments('foo—bar日本語', FONT, { wordBreak: 'keep-all' }).segments).toEqual(['foo', '—', 'bar日本語'])
    expect(prepareWithSegments('foo?bar日本語', FONT, { wordBreak: 'keep-all' }).segments).toEqual(['foo?', 'bar日本語'])
    expect(prepareWithSegments('foo\u00A0世界', FONT, { wordBreak: 'keep-all' }).segments).toEqual(['foo\u00A0', '世界'])
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

  test('treats astral CJK ideographs as CJK break units', () => {
    const samples = ['𠀀', '\u{2EBF0}', '\u{31350}', '\u{323B0}']

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]!
      expect(prepareWithSegments(`${sample}${sample}`, FONT).segments).toEqual([sample, sample])
      expect(prepareWithSegments(`${sample}。`, FONT).segments).toEqual([`${sample}。`])
    }
  })

  test('isCJK covers Hangul compatibility jamo and the newer CJK extension blocks', () => {
    expect(isCJK('ㅋ')).toBe(true)
    expect(isCJK('\u{2EBF0}')).toBe(true)
    expect(isCJK('\u{31350}')).toBe(true)
    expect(isCJK('\u{323B0}')).toBe(true)
    expect(isCJK('hello')).toBe(false)
  })

  test('keeps opening brackets after CJK attached to following annotation text', () => {
    expect(prepareWithSegments('서울(Seoul)과', FONT).segments).toEqual(['서', '울', '(Seoul)', '과'])
    expect(prepareWithSegments('東京(Tokyo)と', FONT).segments).toEqual(['東', '京', '(Tokyo)', 'と'])
    expect(prepareWithSegments('北京(Beijing)和', FONT).segments).toEqual(['北', '京', '(Beijing)', '和'])
    expect(prepareWithSegments('참조[1]와', FONT).segments).toEqual(['참', '조', '[1]', '와'])
    expect(prepareWithSegments('AB(CD)', FONT).segments).toEqual(['AB(CD)'])
  })

  test('locale can be reset without disturbing later prepares', () => {
    setLocale('th')
    const thai = prepare('ภาษาไทยภาษาไทย', FONT)
    expect(layout(thai, 80, LINE_HEIGHT).lineCount).toBeGreaterThan(0)

    setLocale(undefined)
    const latin = prepare('hello world', FONT)
    expect(layout(latin, 200, LINE_HEIGHT)).toEqual({ lineCount: 1, height: LINE_HEIGHT })
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

  test('pure LTR text skips rich bidi metadata', () => {
    expect(prepareWithSegments('hello world', FONT).segLevels).toBeNull()
  })

  test('rich bidi metadata uses the first strong character for paragraph direction', () => {
    const ltrFirst = prepareWithSegments('one اثنان three', FONT)
    expect(ltrFirst.segLevels).not.toBeNull()
    expect(ltrFirst.segLevels).toHaveLength(ltrFirst.segments.length)
    expect(getNonSpaceSegmentLevels(ltrFirst)).toEqual([
      { text: 'one', level: 0 },
      { text: 'اثنان', level: 1 },
      { text: 'three', level: 0 },
    ])

    const rtlFirst = prepareWithSegments('123 واحد three', FONT)
    expect(rtlFirst.segLevels).not.toBeNull()
    expect(rtlFirst.segLevels).toHaveLength(rtlFirst.segments.length)
    expect(getNonSpaceSegmentLevels(rtlFirst)).toEqual([
      { text: '123', level: 2 },
      { text: 'واحد', level: 1 },
      { text: 'three', level: 2 },
    ])

    const astralRtlFirst = prepareWithSegments('𞤀𞤁 abc', FONT)
    expect(astralRtlFirst.segLevels).not.toBeNull()
    expect(astralRtlFirst.segLevels).toHaveLength(astralRtlFirst.segments.length)
    expect(getNonSpaceSegmentLevels(astralRtlFirst)).toEqual([
      { text: '𞤀𞤁', level: 1 },
      { text: 'abc', level: 2 },
    ])
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
    const texts = [
      'The quick brown fox jumps over the lazy dog.',
      'said "hello" to 世界 and waved.',
      'مرحبا، عالم؟',
      'author 7:00-9:00 only',
      'alpha\u200Bbeta gamma',
    ]
    const widths = [40, 80, 120, 200]

    for (let textIndex = 0; textIndex < texts.length; textIndex++) {
      const prepared = prepareWithSegments(texts[textIndex]!, FONT)
      for (let widthIndex = 0; widthIndex < widths.length; widthIndex++) {
        const width = widths[widthIndex]!
        const counted = countPreparedLines(prepared, width)
        const walked = walkPreparedLinesRaw(prepared, width)
        expect(counted).toBe(walked)
      }
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
        for (const ch of text) width += ch === ' ' ? 4 : /[\\u00AD\\u200B\\u2060]/.test(ch) ? 0 : ch === 'A' ? 10 : 8
        return { width: width - (text.match(/A[\\u00AD\\u200B\\u2060]* /g) ?? []).length }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const { prepare, prepareWithSegments, layout, layoutWithLines, layoutNextLineRange } = await import(${JSON.stringify(layoutUrl)})
    const { walkPreparedLinesRaw } = await import(${JSON.stringify(lineBreakUrl)})
    const { prepareRichInline, walkRichInlineLineRanges } = await import(${JSON.stringify(richInlineUrl)})
    const kerning = []
    for (const [text, letterSpacing] of [
      ['AA B', 0], ['AA\\u200B B', 0], ['AA\\u200B \\u05D0', 0], ['AA\\u2060 (x\\u05D0)', 0], ['AA\\u00AD B', 0], ['AA B', 1],
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
    console.log(JSON.stringify({ kerning, spaced, wordMeasurements, remainder: {
      lines: layoutWithLines(remainder, 8.5, 20).lines.map(line => [line.text, line.width, line.start.segmentIndex, line.start.graphemeIndex, line.end.segmentIndex, line.end.graphemeIndex]),
      signed,
      streamed,
      rich,
      lineCount: layout(prepare('A\\u2060 B', '16px Test'), 8.5, 20).lineCount,
    } }))
  `
  const child = Bun.spawnSync([process.execPath, '-e', script])
  if (child.exitCode !== 0) throw new Error(child.stderr.toString())
  const { kerning, spaced, wordMeasurements, remainder } = JSON.parse(child.stdout.toString())
  expect(kerning).toEqual([
    // The kerned word fits and the space hangs.
    { lines: [['AA ', 19], ['B', 8]], lineCount: 2 },
    { lines: [['AA\u200B ', 19], ['B', 8]], lineCount: 2 },
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


describe('bidi paragraph boundaries', () => {
  test('pre-wrap metadata matches independently prepared paragraphs', () => {
    const paragraphs = ['אבג.', 'abc.', 'ا', '123', '\u0301abc', '𞤀𞤁 xyz']
    const actual = prepareWithSegments(paragraphs.join('\r\n'), FONT, { whiteSpace: 'pre-wrap' })
    const expected = paragraphs.flatMap(text => {
      const paragraph = prepareWithSegments(text, FONT, { whiteSpace: 'pre-wrap' })
      return paragraph.segments.map((segment, i) => ({ text: segment, level: paragraph.segLevels?.[i] ?? 0 }))
    })
    expect(actual.segments.flatMap((text, i) => text === '\n' ? [] : [{ text, level: actual.segLevels?.[i] ?? 0 }])).toEqual(expected)
    expect(prepareWithSegments('one\ntwo\n', FONT, { whiteSpace: 'pre-wrap' }).segLevels).toBeNull()
    // Normal whitespace collapses newline before bidi analysis, so it remains
    // one paragraph; the rich metadata must follow that normalized input.
    const normal = prepareWithSegments('אבג.\r\nabc.', FONT)
    const collapsed = prepareWithSegments('אבג. abc.', FONT)
    expect(normal.segments).toEqual(collapsed.segments)
    expect(normal.segLevels).toEqual(collapsed.segLevels)
    expect(getNonSpaceSegmentLevels(normal).at(-1)?.level).toBe(2)
  })

  test('all B separators reset base and weak state, while tabs and line separators do not', async () => {
    const { computeSegmentLevels } = await import('./bidi.js')
    const levels = (text: string) => Array.from(computeSegmentLevels(text, Array.from({ length: text.length }, (_, i) => i)) ?? new Int8Array(text.length))
    for (const separator of ['\n', '\r', '\u001C', '\u001D', '\u001E', '\u0085', '\u2029']) {
      expect(levels(`אבג.${separator}abc.`)).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0])
      expect(levels(`ا${separator}123`)).toEqual([1, 1, 0, 0, 0])
      expect(levels(`א${separator}\u0301a`)).toEqual([1, 1, 0, 0])
    }
    expect(levels('אבג.\n\nabc.')).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0, 0])
    for (const separator of ['\t', '\u2028']) expect(levels(`אבג${separator}abc`).at(-1)).toBe(2)
  })
})
