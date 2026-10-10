import '../harness/watchdog.ts'
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { AnalysisProfile } from './analysis.ts'
import type { PreparedText, PreparedTextWithSegments } from './layout.ts'
import type { PreparedLineBreakData } from './line-break.ts'
import type { RichInlineBox, RichInlineItem } from './rich-inline.ts'

// Unit checks over a deterministic fake canvas backend: the shipped prepare/layout
// and rich-inline exports, and the rules behind them (the engines' break scans, the
// engine profile's fields, the line walkers), which a test of one engine's rule sets
// by hand on the cached profile. What a browser does is settled in the harness
// (harness/README.md), not here: for narrow browser-specific investigations, prefer
// throwaway probes and harness cases over mirroring the full implementation here.

const FONT = '16px Test Sans'
const LINE_HEIGHT = 19

type AnalysisModule = typeof import('./analysis.ts')
type LayoutModule = typeof import('./layout.ts')
type LineBreakModule = typeof import('./line-break.ts')
type LineBreaksModule = typeof import('./line-breaks.ts')
type GeckoLineBreaksModule = typeof import('./gecko-line-breaks.ts')
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
let walkPreparedLinesRaw: LineBreakModule['walkPreparedLinesRaw']
let SPACED: AnalysisModule['SPACED']
let ONE_CLUSTER: AnalysisModule['ONE_CLUSTER']
let getSegmentFit: MeasurementModule['getSegmentFit']
let getFontMeasurement: MeasurementModule['getFontMeasurement']
let getPreparationLanguage: MeasurementModule['getPreparationLanguage']
let getEngineProfile: MeasurementModule['getEngineProfile']
let analyzeText: AnalysisModule['analyzeText']
let SEGMENT_KINDS: AnalysisModule['SEGMENT_KINDS']
let KIND_BITS: AnalysisModule['KIND_BITS']
let getBlinkLineBreaks: LineBreaksModule['getBlinkLineBreaks']
let getGeckoLineBreaks: GeckoLineBreaksModule['getGeckoLineBreaks']
let prepareRichInline: RichInlineModule['prepareRichInline']
let layoutNextRichInlineLineRange: RichInlineModule['layoutNextRichInlineLineRange']
let materializeRichInlineLineRange: RichInlineModule['materializeRichInlineLineRange']
let measureRichInlineStats: RichInlineModule['measureRichInlineStats']
let walkRichInlineLineRanges: RichInlineModule['walkRichInlineLineRanges']
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

// An analysis' segment kinds, as prepareWithSegments() gives them.
type TextAnalysis = ReturnType<AnalysisModule['analyzeText']>
function kindsOf(analysis: TextAnalysis): string[] {
  return Array.from(analysis.flags, flags => SEGMENT_KINDS[flags & KIND_BITS]!)
}

type TestLayoutCursor = {
  segmentIndex: number
  graphemeIndex: number
}

type TestPreparedTextWithSegments = {
  readonly segments: readonly string[]
}

type TestLayoutLine = {
  text: string
  width: number
  start: TestLayoutCursor
  end: TestLayoutCursor
}

// A handle as the line walkers read it. The type of a prepareWithSegments() handle shows
// `segments`, `kinds` and `widths` only, so a test of the walkers' own fields reads them
// through here.
function internals(prepared: PreparedText): PreparedText & PreparedLineBreakData {
  return prepared as PreparedText & PreparedLineBreakData
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
    // Real fonts give ZWSP and bidi controls no advance.
    if (ch === '\u200B' || /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(ch)) continue
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
  // A stream that goes past a line per unit, plus one, fails instead of running on.
  const most = prepared.segments.join('').length + 1

  while (true) {
    const line = layoutNextLine(prepared as Parameters<typeof layoutNextLine>[0], cursor, width)
    if (line === null) break
    if (lines.push(line) > most) throw new Error(`layoutNextLine gives more than ${most} lines`)
    cursor = line.end
  }

  return lines
}

function terminalCursor(prepared: TestPreparedTextWithSegments): TestLayoutCursor {
  return { segmentIndex: prepared.segments.length, graphemeIndex: 0 }
}

// Each engine's tab fields (EngineProfile), which the tab tests set together.
const TAB_FIELDS = {
  blink: { letterSpaceTabStops: true, letterSpaceTabs: false, tabMinimumCharacter: ' ', tabsInAppUnits: false },
  webkit: { letterSpaceTabStops: false, letterSpaceTabs: true, tabMinimumCharacter: ' ', tabsInAppUnits: false },
  gecko: { letterSpaceTabStops: true, letterSpaceTabs: false, tabMinimumCharacter: '0', tabsInAppUnits: true },
} as const

// The pinned browsers' desktop user agents, which name only a major version.
const CHROME_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36'
const SAFARI_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15'
const FIREFOX_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0'

// The whole engine profile a user agent gets, from a copy of the measurement module of its
// own, as the library computes its profile once per module.
async function engineProfileUnder(userAgent: string): Promise<ReturnType<MeasurementModule['getEngineProfile']>> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true })
    return (await import(`./measurement.ts?user-agent=${encodeURIComponent(userAgent)}`) as MeasurementModule).getEngineProfile()
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, 'navigator')
    else Object.defineProperty(globalThis, 'navigator', descriptor)
  }
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
  const [mod, lineBreakMod, measurementMod, richInlineMod, analysisMod, lineBreaksMod, geckoLineBreaksMod] = await Promise.all([
    import('./layout.ts'),
    import('./line-break.ts'),
    import('./measurement.ts'),
    import('./rich-inline.ts'),
    import('./analysis.ts'),
    import('./line-breaks.ts'),
    import('./gecko-line-breaks.ts'),
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
  ;({ countPreparedLines, walkPreparedLinesRaw } = lineBreakMod)
  ;({ getSegmentFit, getFontMeasurement, getPreparationLanguage, getEngineProfile } = measurementMod)
  ;({ analyzeText, SEGMENT_KINDS, KIND_BITS, SPACED, ONE_CLUSTER } = analysisMod)
  ;({ getBlinkLineBreaks } = lineBreaksMod)
  ;({ getGeckoLineBreaks } = geckoLineBreaksMod)
  ;({ prepareRichInline, layoutNextRichInlineLineRange, materializeRichInlineLineRange, measureRichInlineStats, walkRichInlineLineRanges } = richInlineMod)
})

beforeEach(() => {
  // Retargeting the locale also clears the shared caches.
  setLocale(undefined)
})

describe('shared public contracts', () => {
  test('a ZWSP-only paragraph retains one line and its complete source range', () => {
    for (const [text, whiteSpace, letterSpacing] of [
      ['​', 'normal', 0],
      ['​​', 'pre-wrap', -1],
      ['​​', 'normal', 1],
    ] as const) for (const width of [0, 100]) {
      const prepared = prepareWithSegments(text, FONT, { whiteSpace, letterSpacing })
      const result = layoutWithLines(prepared, width, LINE_HEIGHT)
      expect(result.lineCount).toBe(1)
      expect(result.height).toBe(LINE_HEIGHT)
      expect(result.lines[0]!.text).toBe(text)
      expect(result.lines[0]!.width).toBe(0)
      expect(result.lines[0]!.start).toEqual({ segmentIndex: 0, graphemeIndex: 0 })
      expect(result.lines[0]!.end).toEqual(terminalCursor(prepared))
      expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
      expect(layout(prepare(text, FONT, { whiteSpace, letterSpacing }), width, LINE_HEIGHT).lineCount).toBe(1)
    }
  })

  test('a selected soft-hyphen threshold preserves every public line API', () => {
    // The threshold leaves room for a hyphen plus one suffix grapheme, but
    // selecting SHY must still end this line at the discretionary boundary.
    const text = 'foo trans­atlantic said "hello" to 世界 and waved.'
    const width = measureWidth('foo transa-', FONT) + 0.1
    const prepared = prepareWithSegments(text, FONT)
    const result = layoutWithLines(prepared, width, LINE_HEIGHT)
    expect(result.lines[0]!.text).toBe('foo trans-')
    expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
    expect(layout(prepare(text, FONT), width, LINE_HEIGHT).lineCount).toBe(result.lineCount)
    expect(measureLineStats(prepared, width).lineCount).toBe(result.lineCount)
    // The lines' ranges give the source back, soft hyphen and all, where the first line's text shows a hyphen.
    expect(reconstructFromLineBoundaries(prepared, result.lines)).toBe(text)
  })

  test('a line\'s width leaves out the space it ends at', () => {
    // 'hello ' fits in 60px with its space, which hangs: a width with the
    // space would size a bubble one space too wide.
    const prepared = prepareWithSegments('hello world', FONT)
    const hello = measureWidth('hello', FONT)
    expect(measureWidth('hello ', FONT)).toBeLessThan(60)
    expect(layoutWithLines(prepared, 60, LINE_HEIGHT).lines.map(line => line.width)).toEqual([hello, measureWidth('world', FONT)])
    expect(measureLineStats(prepared, 60).maxLineWidth).toBe(hello)
  })

  test('a range kept from a longer text builds only the text a shorter one prepared since holds', () => {
    // An app that keeps line ranges across an edit can pass one past the end of
    // the text it prepared again.
    const before = prepareWithSegments('alpha beta gamma', FONT)
    const after = prepareWithSegments('alpha', FONT)
    const richBefore = prepareRichInline([{ text: 'alpha beta', font: FONT }, { text: 'gamma', font: FONT }])
    const richAfter = prepareRichInline([{ text: 'alpha', font: FONT }, { text: 'gamma', font: FONT }])
    for (const width of [measureWidth('alpha beta', FONT), 1]) {
      const texts: string[] = []
      walkLineRanges(before, width, range => texts.push(materializeLineRange(after, range).text))
      expect(texts.join('|')).toBe(width === 1 ? 'a|l|p|h|a' + '|'.repeat(9) : 'alpha|')
      const fragments: string[] = []
      walkRichInlineLineRanges(richBefore, width, range => {
        for (const fragment of materializeRichInlineLineRange(richAfter, range).fragments) fragments.push(fragment.text)
      })
      expect(fragments.join('|')).toBe(width === 1 ? 'a|l|p|h|a' + '|'.repeat(4) + '|g|a|m|m|a' : 'alpha||gamma')
    }
  })

  test('a range that ends at segment Infinity builds its text to the end', () => {
    const prepared = prepareWithSegments('alpha beta', FONT)
    const rich = prepareRichInline([{ text: 'alpha beta', font: FONT }])
    const richRange = layoutNextRichInlineLineRange(rich, Infinity)!
    for (const graphemeIndex of [0, 2]) {
      const end = { segmentIndex: Infinity, graphemeIndex }
      expect(materializeLineRange(prepared, { width: 0, start: { segmentIndex: 0, graphemeIndex: 0 }, end }).text).toBe('alpha beta')
      const fragments = richRange.fragments.map(fragment => ({ ...fragment, end }))
      expect(materializeRichInlineLineRange(rich, { ...richRange, fragments }).fragments.map(fragment => fragment.text)).toEqual(['alpha beta'])
    }
  })

  test('a line API called once for a paragraph lays a width that is not a number out as an unbounded one', () => {
    // layout(), layoutWithLines(), walkLineRanges(), measureLineStats() and the two rich
    // walks pass their width through normalizeMaxWidth() once, so their loops meet no
    // NaN. The first three texts take layout()'s three counts: its own loop, the simple
    // stepper, where the scan gives no break at NEL, and the full walker. Where a NaN
    // reaches the loops, layout() counts a line per grapheme, and a pre-wrap line that
    // ends in spaces or a tab reports a NaN width. The streams, called once for each
    // line, take their width as given (ENGINE_FOLLOWUPS.md, Small ones).
    const widths = [NaN, undefined as unknown as number]
    for (const [text, options, walkFastPath, countFastPath] of [
      ['aaaa bbbb 中文字', {}, true, true],
      ['aaaa\u0085bbbb cccc', {}, false, true],
      ['aaaa bb­bb cccc', {}, false, false],
      ['aaaa bbbb cccc', { letterSpacing: 1 }, false, false],
      ['aaaa  \nbbbb\t\ncc  ', { whiteSpace: 'pre-wrap' }, false, false],
    ] as const) {
      const prepared = prepareWithSegments(text, FONT, options)
      expect([internals(prepared).simpleLineWalkFastPath, internals(prepared).simpleLineCountFastPath]).toEqual([walkFastPath, countFastPath])
      const at = (width: number): unknown => {
        const ranges: unknown[] = []
        const rangeCount = walkLineRanges(prepared, width, line => ranges.push(line))
        return {
          layout: layout(prepare(text, FONT, options), width, LINE_HEIGHT),
          layoutWithLines: layoutWithLines(prepared, width, LINE_HEIGHT),
          walkLineRanges: [rangeCount, ranges],
          measureLineStats: measureLineStats(prepared, width),
        }
      }
      const unbounded = at(Infinity) as { layout: { lineCount: number } }
      expect(unbounded.layout.lineCount).toBe(text.split('\n').length)
      for (let i = 0; i < widths.length; i++) expect(at(widths[i]!)).toEqual(unbounded)
    }
    for (const [items, options] of [
      [[{ text: 'aaaa bbbb ', font: FONT }, { text: 'cccc 中文字', font: FONT, extraWidth: 4 }], {}],
      [[{ text: 'aaaa bbbb  ', font: FONT }], { whiteSpace: 'pre-wrap' }],
      [[{ text: 'aaaa  ', font: FONT }, { text: '\nbbbb\t\ncc  ', font: FONT }], { whiteSpace: 'pre-wrap' }],
    ] as const) {
      const prepared = prepareRichInline([...items], options)
      const at = (width: number): unknown => {
        const lines: unknown[] = []
        const lineCount = walkRichInlineLineRanges(prepared, width, line => lines.push(materializeRichInlineLineRange(prepared, line)))
        return {
          walkRichInlineLineRanges: [lineCount, lines],
          measureRichInlineStats: measureRichInlineStats(prepared, width),
        }
      }
      const unbounded = at(Infinity) as { measureRichInlineStats: { lineCount: number } }
      expect(unbounded.measureRichInlineStats.lineCount).toBe(items.map(item => item.text).join('').split('\n').length)
      for (let i = 0; i < widths.length; i++) expect(at(widths[i]!)).toEqual(unbounded)
    }
  })

  test('numeric layout APIs do not measure text after preparation', () => {
    const text = 'foo trans­atlantic 世界\n\tbar'
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

  test('the line functions that return no text give the same lines from a prepare() handle', () => {
    // walkLineRanges(), measureLineStats(), measureNaturalWidth() and layoutNextLineRange()
    // read the line-break data alone, and a prepare() handle holds all of it: it leaves out
    // only the strings, `segments` and `kinds` (RESEARCH.md, Decisions Log, 2026-10-06).
    // The calls here are typed, so this file compiles only while all four take the handle
    // prepare() returns.
    const light: PreparedText = prepare('a\tbb trans\u00ADatlantic 中文字 Superlongword', FONT, { whiteSpace: 'pre-wrap' })
    const withSegments = prepareWithSegments('a\tbb trans\u00ADatlantic 中文字 Superlongword', FONT, { whiteSpace: 'pre-wrap' })
    const linesOf = (prepared: PreparedText): unknown => {
      const walked: unknown[] = []
      const count = walkLineRanges(prepared, 60, line => walked.push(line))
      const first = layoutNextLineRange(prepared, { segmentIndex: 0, graphemeIndex: 0 }, 60)
      return [count, walked, first, measureLineStats(prepared, 60), measureNaturalWidth(prepared)]
    }
    expect(linesOf(light)).toEqual(linesOf(withSegments))

    // The engine profile is computed once per process, so each engine runs in a child
    // process. Its canvas fills every field of the handle that an engine fills: an ASCII
    // character is 8px, a space 4px, an invisible character 0 and any other 16px, `To` kerns,
    // 3px narrower, fullwidth marks halt as in Chrome's Canvas, and the context takes a
    // letterSpacing. For each text and set of options, the prepare() handle holds the data
    // of the prepareWithSegments() one less `segments` and `kinds`, and at each width the
    // four functions give the same lines, widths and cursors from both.
    const texts = [
      "Just tried the new update and it's so much better, especially on older devices.",
      '这是一段中文文本，用于测试「文本布局」库。每个字符之间都可以断行。',
      '中」「中」中」 中。」、「中',
      'これはテキストレイアウトのテストです。パフォーマンスは非常に重要です。',
      '이것은 텍스트 레이아웃 라이브러리의 테스트입니다. 한국어 텍스트를 확인합니다.',
      'هذا النص باللغة العربية لاختبار دعم الاتجاه من اليمين إلى اليسار',
      'นี่คือข้อความทดสอบสำหรับไลบรารีจัดวางข้อความ ทดสอบการตัดคำภาษาไทย',
      'Great work! 👏👏👏 exactly what we needed 🎯 👩‍💻 🇯🇵 👍🏽',
      'trans\u00ADatlantic co\u00ADoperation inter\u00ADnation\u00ADal\u00ADisation',
      'a\tbb\tccc\n\n  dd  \tee  \n',
      'see https://example.com/Tomato/Tomorrow?To=more or Superlongwordwithoutanyspaces',
      'aaaa\u200Cbbbb\u2060cccc\u200Ddddd ab\u200Bcd\u200Bef',
      '中文\u3000\u3000中文 0123456789012345678901234567890',
      'aaaa\u0085bbbb cccc\u2028dddd',
      'Hello مرحبا שלום 你好 こんにちは 안녕하세요 สวัสดี',
      '',
      '   ',
    ]
    const layoutUrl = new URL('./layout.ts', import.meta.url).href
    const rowsOf = (userAgent: string): unknown => JSON.parse(runInChild(`
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ${JSON.stringify(userAgent)} } })
      class Context {
        font = ''
        letterSpacing = '0px'
        fontKerning = 'auto'
        measureText(text) {
          const spacing = Number.parseFloat(this.letterSpacing)
          let width = 0
          let count = 0
          for (const ch of text) {
            count++
            if (!/[\\u00AD\\u200B-\\u200D\\u2060]/.test(ch)) width += ch > '\\u2E7F' ? 16 : ch === ' ' ? 4 : 8
          }
          if (this.fontKerning === 'auto') width -= 3 * (text.split('To').length - 1)
          width -= 8 * (text.match(/[\\u3002\\u300D](?=[\\u3002\\u300D])|(?<=[\\u3002\\u300D\\u300C])\\u300C/g) ?? []).length
          if (Math.abs(spacing) >= 1 / 65536) width += count * spacing
          return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width - (/[\\u3001\\u3002]$/.test(text) ? 8 : 0) }
        }
      }
      globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
      const { prepare, prepareWithSegments, walkLineRanges, measureLineStats, measureNaturalWidth, layoutNextLineRange } = await import(${JSON.stringify(layoutUrl)})
      const linesOf = (prepared, text, width) => {
        const walked = []
        const count = walkLineRanges(prepared, width, line => walked.push(line))
        const streamed = []
        let cursor = { segmentIndex: 0, graphemeIndex: 0 }
        // No text has more lines than a line per unit, plus one.
        for (let i = 0; i <= text.length + 1; i++) {
          const line = layoutNextLineRange(prepared, cursor, width)
          if (line === null) break
          streamed.push(line)
          cursor = line.end
        }
        return JSON.stringify([count, walked, streamed, measureLineStats(prepared, width), measureNaturalWidth(prepared)])
      }
      let compared = 0
      const different = []
      for (const text of ${JSON.stringify(texts)}) for (const options of [
        undefined,
        { whiteSpace: 'pre-wrap' },
        { wordBreak: 'keep-all' },
        { letterSpacing: 2 },
        { whiteSpace: 'pre-wrap', wordBreak: 'keep-all', letterSpacing: -1 },
      ]) {
        const light = prepare(text, '16px Test', options)
        const { segments, kinds, ...data } = prepareWithSegments(text, '16px Test', options)
        compared++
        if (JSON.stringify(light) !== JSON.stringify(data)) different.push([text, options, 'handle'])
        for (const width of [0, 9, 28, 40, 85.5, 160, 320, Infinity]) {
          compared++
          if (linesOf(light, text, width) !== linesOf(prepareWithSegments(text, '16px Test', options), text, width)) different.push([text, options, width])
        }
      }
      console.log(JSON.stringify({ compared, different }))
    `))
    const compared = texts.length * 5 * 9
    for (const userAgent of [CHROME_USER_AGENT, FIREFOX_USER_AGENT, SAFARI_USER_AGENT]) {
      expect(rowsOf(userAgent)).toEqual({ compared, different: [] })
    }
  })

  test('the type of a prepareWithSegments() handle shows segments, kinds and widths, and nothing else', () => {
    // The other fields are the line walkers' storage, which changes with engine fixes
    // (RESEARCH.md, Decisions Log, 2026-10-06). This file compiles only while the type
    // has these three fields and no other, read-only: `bun run check` fails otherwise,
    // where `bun test` doesn't check types.
    const prepared = prepareWithSegments('hello world', FONT)
    const segments: readonly string[] = prepared.segments
    const kinds: readonly string[] = prepared.kinds
    const widths: ArrayLike<number> = prepared.widths
    expect([segments, kinds, [widths[0], widths[1], widths[2]]]).toEqual([
      ['hello', ' ', 'world'],
      ['text', 'space', 'text'],
      [measureWidth('hello', FONT), measureWidth(' ', FONT), measureWidth('world', FONT)],
    ])
    const shown: { readonly [Field in Exclude<keyof PreparedTextWithSegments, symbol>]: true } = { segments: true, kinds: true, widths: true }
    expect(Object.keys(prepared)).toEqual(expect.arrayContaining(Object.keys(shown)))
    // A hidden field is still there for code that read it, and no longer type-checks.
    // @ts-expect-error
    expect(prepared.breakableFitAdvances).toBeDefined()
    // Read-only, and `widths` an index and a length, not an array. Each line below runs,
    // since nothing is frozen, and is a type error: one that compiles is the type
    // promising more, which a release can't take back.
    const write = (_list: unknown[]): void => {}
    // @ts-expect-error
    write(prepared.segments)
    // @ts-expect-error
    write(prepared.kinds)
    // @ts-expect-error
    expect([...prepared.widths]).toHaveLength(3)
    const other = prepareWithSegments('hello world', FONT)
    // @ts-expect-error
    prepared.segments = other.segments
    // @ts-expect-error
    prepared.kinds = other.kinds
    // @ts-expect-error
    prepared.widths = other.widths
  })

  test('emergency wrapping preserves complete graphemes inside continuous words', () => {
    for (const cluster of ['é', '👩‍💻', '👍🏽', 'क्ष']) {
      expect(getSegmentGraphemes(cluster)).toHaveLength(1)
      for (const text of [cluster, `a${cluster}b`]) {
        const prepared = prepareWithSegments(text, FONT)
        const lines = layoutWithLines(prepared, 1, LINE_HEIGHT).lines
        expect(lines.map(line => line.text)).toEqual(getSegmentGraphemes(text))
        expect(collectStreamedLines(prepared, 1)).toEqual(lines)
      }
    }
  })
})

describe('entry geometry', () => {
  test('entry admission and fresh prefixes have distinct roles; the right anchor does not own a correction', async () => {
    const { getSegmentEntryWidth, observeSegmentEntries } = await import('./entry-geometry.ts')
    const text = 'a⁠́bXYZ'
    const advances = [8, 0, 0, 8, 11, -2, 3]
    const measure = (source: string) => source.endsWith('b') ? 6 : 0
    const fresh = observeSegmentEntries(text, advances, -4, 4, 'fresh', measure)!
    const original = observeSegmentEntries(text, advances, -4, 4, 'original', measure)!
    expect(getSegmentEntryWidth(fresh, 0, 7)).toBeNull()
    expect(getSegmentEntryWidth(fresh, 3, 7)).toBeNull()
    expect(getSegmentEntryWidth(fresh, 2, 3)).toBe(0)
    expect(getSegmentEntryWidth(fresh, 2, 5)).toBe(13)
    expect(getSegmentEntryWidth(fresh, 2, 6)).toBe(7)
    expect(getSegmentEntryWidth(fresh, 2, 7)).toBe(6)
    expect(getSegmentEntryWidth(original, 2, 7)).toBe(6)
    expect(fresh.entries[2]!.admissionFit).toBe(6)
    expect(original.entries[2]!.admissionFit).toBe(0)
  })

  test('missing anchors, oversized runs and incomplete observations retain the original entry', async () => {
    const { getSegmentEntryWidth, observeSegmentEntries } = await import('./entry-geometry.ts')
    const queried: string[] = []
    const measure = (source: string) => { queried.push(source); return 0 }
    expect(observeSegmentEntries('a⁠́', [8, 0, 0], 0, 8, 'fresh', measure)).toBeNull()
    expect(observeSegmentEntries('a'.repeat(94) + '⁠́b', Array(97).fill(8), 0, 8, 'fresh', measure)).toBeNull()
    expect(queried).toEqual([])
    const geometry = observeSegmentEntries('a⁠́b', [8, 0, 0, 8], 0, 16, 'fresh', source =>
      source.startsWith('⁠') ? null : 0)!
    expect(getSegmentEntryWidth(geometry, 1, 4)).toBeNull()
    expect(getSegmentEntryWidth(geometry, 2, 4)).toBe(0)
  })
})

describe('boundary rules', () => {
  const baseProfile = {
    lineBreakScan: 'blink' as const,
    graphemeTable: 'chromium/char' as const,
    hangTabs: true,
  }
  const geckoProfile = { ...baseProfile, lineBreakScan: 'gecko' as const, hangTabs: false }

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
      const kinds = kindsOf(analysis)
      return analysis.texts.map((segment, i) => [segment, kinds[i]])
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
    expect(kindsOf(preWrap)).toEqual(['text', 'hard-break', 'soft-hyphen', 'text'])
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
    // Firefox splits text runs where the script changes, which would break before the Bengali
    // letter here, and where the bidi level changes, which would start a cluster at a Balinese
    // vowel killer after Arabic letters and at a skin-tone modifier after a Hebrew letter. The
    // Gecko scan splits at neither, on purpose (RESEARCH.md, Decisions Log, 2026-09-24 and
    // 2026-10-01).
    expect(analyzeText('\u1019\u17D2\u09AF', geckoProfile).texts).toEqual(['\u1019\u17D2\u09AF'])
    expect(analyzeText('\u0628\u0628\u1B44\u0628\u0628', geckoProfile).texts).toEqual(['\u0628\u0628\u1B44', '\u0628\u0628'])
    expect(analyzeText('\u05D0\uD83C\uDFFB', geckoProfile).flags[0]! & ONE_CLUSTER).toBe(ONE_CLUSTER)
    // The profile's graphemes look past a bidi control, so a mark after one joins the cluster
    // before it. One that starts a cluster, as a Myanmar visarga does, goes on in the segment as
    // it does without the control, and Firefox breaks before each where nothing fits.
    expect(analyzeText('a\u200E\u0301b', geckoProfile).texts).toEqual(['a\u200E\u0301b'])
    const visargas = analyzeText('a\u200E\u1038\u1038', geckoProfile)
    expect(visargas.texts).toEqual(['a\u200E\u1038\u1038'])
    expect(visargas.flags[0]! & ONE_CLUSTER).toBe(0)
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
      const kinds = kindsOf(analysis)
      return analysis.texts.map((segment, i) => `${segment}:${kinds[i]}`)
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
      const kinds = kindsOf(analysis)
      return analysis.texts.map((segment, i) => `${segment}:${kinds[i]}`)
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
      expect(internals(prepared).segmentFlags[1]! & SPACED).toBe(0)
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
        expect(kindsOf(analysis)).toEqual(['text', separator ? 'hard-break' : 'text', 'text'])
        expect(analyzeText(`a${control}${control} b`, profile).texts).toEqual(['a', control, control, ' ', 'b'])
      }
    }
    // A separator that ICU's fast-forward passes stays inside a text item and ends no line.
    const passed = analyzeText('か中？\u2028b', webkit)
    expect({ texts: passed.texts, kinds: kindsOf(passed) }).toEqual({ texts: ['か', '中？', '\u2028', 'b'], kinds: ['text', 'text', 'text', 'text'] })
    // NEL is text in the Blink profile and a control in the WebKit profile.
    expect(kindsOf(analyzeText('ab\u0085cd', blink))).toEqual(['text', 'text', 'text'])
    expect(kindsOf(analyzeText('ab\u0085cd', webkit))).toEqual(['text', 'control', 'text'])
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
        expect({ control, width: hidden.widths[index], spaced: (internals(hidden).segmentFlags[index]! & SPACED) !== 0 }).toEqual({ control, width: 0, spaced: true })
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
      // break where its line fits, such as the break after a hidden control. That break
      // takes no room, so Blink's retry at the width less the hyphen ends there too.
      const text = '\u000Btrans\u00ADic'
      const width = measureWidth('trans', FONT) + 0.1
      const expected = ['\u000B', 'trans-', 'ic']
      for (const unfitHyphenRetreat of ['reduced-width', 'full-width'] as const) {
        profile.unfitHyphenRetreat = unfitHyphenRetreat
        clearCache()
        const prepared = prepareWithSegments(text, FONT, { whiteSpace: 'pre-wrap' })
        expect(layoutWithLines(prepared, width, LINE_HEIGHT).lines.map(line => line.text)).toEqual(expected)
        expect(collectStreamedLines(prepared, width).map(line => line.text)).toEqual(expected)
        expect(layout(prepare(text, FONT, { whiteSpace: 'pre-wrap' }), width, LINE_HEIGHT).lineCount).toBe(expected.length)
      }
    } finally {
      [profile.lineBreakScan, profile.hidesControlCharacters, profile.unfitHyphenRetreat] = previous
      clearCache()
    }
  })

  test('every text segment of an engine scan takes emergency grapheme breaks', () => {
    const profile = getEngineProfile()
    const previous = { lineBreakScan: profile.lineBreakScan, keepsLineStartPunctuation: profile.keepsLineStartPunctuation }
    try {
      for (const scan of ['blink', 'webkit', 'gecko'] as const) {
        profile.lineBreakScan = scan
        profile.keepsLineStartPunctuation = scan === 'webkit'
        // Segment metrics belong to one engine profile.
        clearCache()
        // Digits, which Safari's JavaScriptCore doesn't mark word-like, symbols and emoji.
        for (const text of ['11111111', '-0.475', '\u{1F1FA}\u{1F1F8}/\u{1F469}\u200D\u{1F4BB}', '\u{1F600}--tail']) {
          const prepared = prepareWithSegments(text, FONT)
          for (let i = 0; i < prepared.segments.length; i++) {
            if (prepared.kinds[i] === 'text' && getSegmentGraphemes(prepared.segments[i]!).length > 1) {
              expect({ text, segment: prepared.segments[i], breakable: internals(prepared).breakableFitAdvances[i] !== null }).toEqual({ text, segment: prepared.segments[i], breakable: true })
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
      Object.assign(profile, previous)
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
      expect(internals(prepared).breakableFitAdvances[zwj]).toBeNull()
      expect(layoutWithLines(prepared, 0, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['a', '\u{1F469}-', '‍\u{1F680}', 'b'])
      profile.lineBreakScan = 'blink'
      clearCache()
      const blink = prepareWithSegments('ab‍\u{1F680}', FONT)
      expect(internals(blink).breakableFitAdvances[0]).not.toBeNull()
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

  test('Gecko lays out bidi controls as its text run, which leaves them out', () => {
    const profile = getEngineProfile()
    const previous = { lineBreakScan: profile.lineBreakScan, graphemeTable: profile.graphemeTable, zeroWidthGlueTakesLine: profile.zeroWidthGlueTakesLine }
    profile.lineBreakScan = 'gecko'
    profile.graphemeTable = 'gecko/char'
    profile.zeroWidthGlueTakesLine = false
    clearCache()
    try {
      const lines = (text: string, width: number, options?: { whiteSpace?: 'normal' | 'pre-wrap' }) => {
        const prepared = prepareWithSegments(text, FONT, options)
        const result = layoutWithLines(prepared, width, LINE_HEIGHT)
        expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
        expect(layout(prepare(text, FONT, options), width, LINE_HEIGHT).lineCount).toBe(result.lineCount)
        return result.lines.map(line => line.text)
      }
      // A run inside a word goes with the cluster before it, and at the start with the one after
      // it, so no emergency break falls at a control.
      expect(prepareWithSegments('\u202A\u200Eab', FONT).kinds).toEqual(['text'])
      expect(lines('\u202A\u200Eab', 1)).toEqual(['\u202A\u200Ea', 'b'])
      expect(lines('a\u200Eb', 1)).toEqual(['a\u200E', 'b'])
      // White space before a run takes it: a line that ends after the run hangs the space.
      expect(prepareWithSegments('ab \u200Ecd', FONT).kinds).toEqual(['text', 'space', 'text'])
      const fits = measureWidth('ab', FONT) + measureWidth(' ', FONT)
      for (const whiteSpace of ['normal', 'pre-wrap'] as const) {
        expect(lines('ab \u200Ecd', fits, { whiteSpace })).toEqual(['ab \u200E', 'cd'])
        expect(layoutWithLines(prepareWithSegments('ab \u200Ecd', FONT, { whiteSpace }), fits, LINE_HEIGHT).lines[0]!.width).toBe(measureWidth('ab', FONT))
      }
      // A run that starts a paragraph starts its line, and a space after it takes room; one after
      // a wrap goes with the line before.
      expect(lines('\u200E ab', 1)).toEqual(['\u200E ', 'a', 'b'])
      expect(lines('ab\u200E cd', 1)).toEqual(['a', 'b\u200E ', 'c', 'd'])
      // After a hard break the text after a run joins it, and a chunk of only a run holds no line
      // but its hard break's.
      expect(lines('a\n\u200Eb', 1, { whiteSpace: 'pre-wrap' })).toEqual(['a', '\u200Eb'])
      expect(lines('a\n\u200E\u200F\nb', 1, { whiteSpace: 'pre-wrap' })).toEqual(['a', '', 'b'])
      expect(lines('a\n\u202A', 1, { whiteSpace: 'pre-wrap' })).toEqual(['a'])
      expect(lines('ab \u200E\ncd', measureWidth('ab', FONT), { whiteSpace: 'pre-wrap' })).toEqual(['ab \u200E', 'cd'])
      // A chunk that starts with what the text run drops, a control in it, offers no break after it.
      expect(lines('\u202C\u00ADab', 1)).toEqual(['\u202C\u00ADa', 'b'])
      // Nor does one that starts with white space the line start removes, before the control:
      // Firefox 156.0.1 lays out a space, U+200E and `abcdef gh` in 16px Arial at 30px in 3
      // lines, with no empty line before `abc` (2026-09-30).
      expect(lines(' \u200Eabcdef gh', measureWidth('abc', FONT))).toEqual(['\u200Eabc', 'def ', 'gh'])
      // Firefox collapses white space through a run of controls, keeping its first space, or its
      // segment break if it holds one, and the line end trims one before only controls.
      expect(prepareWithSegments('ab \u200E cd', FONT).segments).toEqual(['ab', ' \u200E', 'cd'])
      expect(lines(' \u200E\nab', 1)).toEqual(lines('\u200E ab', 1))
      expect(prepareWithSegments('ab \u200E', FONT).segments).toEqual(['ab\u200E'])
      expect(measureRichInlineStats(prepareRichInline([{ text: 'ab \u200E', font: FONT }, { text: 'cd', font: FONT }]), 1000).maxLineWidth)
        .toBe(measureWidth('ab cd', FONT))
      // The run reads through every control, whichever bidi level run it starts. Whether Firefox
      // ends the run at one turns on the paragraph's direction, which Pretext doesn't take, so a
      // text is one text frame's (transformText in src/gecko-line-breaks.ts): U+200F between Latin
      // words keeps Firefox's one space in a right-to-left paragraph, where a left-to-right one
      // keeps two, and U+200E between Hebrew words the one of a left-to-right paragraph.
      const segments = (text: string) => prepareWithSegments(text, FONT).segments
      expect(segments('ab \u200F cd')).toEqual(['ab', ' \u200F', 'cd'])
      expect(segments('\u05D0 \u200E \u05D1')).toEqual(['\u05D0', ' \u200E', '\u05D1'])
      expect(segments('ab\t\u061C\ncd')).toEqual(['ab\u061C', ' ', 'cd'])
      expect(segments('a \u2067b \u2069 c')).toEqual(['a', ' \u2067', 'b', ' \u2069', 'c'])
      expect(segments('\u200F ab')).toEqual(['\u200F', ' ', 'ab'])
      // A run's last space stays as the base of a mark after it, through controls.
      expect(segments('ab \u200E \u200E\u0301c')).toEqual(['ab', ' \u200E \u200E', '\u0301c'])
      // The run reads through soft hyphens as through controls. The break after white space that
      // left from after a soft hyphen is that white space's, which draws no hyphen.
      expect(segments('ab \u00AD cd')).toEqual(['ab', ' ', '\u00AD', 'cd'])
      expect(segments('ab \u00AD \u200E cd')).toEqual(['ab', ' \u00AD\u200E', 'cd'])
      expect(prepareWithSegments('ab \u200E \u00AD cd', FONT).kinds).toEqual(['text', 'space', 'zero-width-break', 'text'])
      // A run whose dropped characters all come after its white space leaves out only white space
      // that touches the unit it keeps, which the scan doesn't name.
      expect(getGeckoLineBreaks('ab  \u200Ecd', false, false, 'gecko/char').leftOut).toBeNull()
      // A run that goes on into the text's trailing white space keeps its first white space, where
      // its segment break comes after a soft hyphen: with the trailing white space left out, a rich
      // item's text still holds the run's one space. A run that keeps its first white space
      // anyway keeps no second one.
      expect(segments('ab \u00AD\n\u2066 ')).toEqual(['ab', ' \u00AD\u2066'])
      expect(segments('ab \u00AD\n')).toEqual(['ab', ' ', '\u00AD'])
      expect(segments('ab \u00AD\n\u2066 cd')).toEqual(['ab', '\u00AD', ' \u2066', 'cd'])
      expect(segments('ab \u00AD \u00AD ')).toEqual(['ab', ' ', '\u00AD\u00AD'])
      // A CR or FF takes no room, as Firefox's text run gives it no advance, and a line can
      // end where it was. It is no white space of a run, so the white space on its two sides
      // is two runs, which keep a space each through a control, and CRLF is one space.
      expect(segments('ab\rcd')).toEqual(['ab', 'cd'])
      expect(lines('ab\fcd', measureWidth('ab', FONT))).toEqual(['ab', 'cd'])
      expect(segments('ab\r\ncd')).toEqual(['ab', ' ', 'cd'])
      // The CR of a CRLF collapses into the line feed's space, so the scan doesn't name it.
      expect(getGeckoLineBreaks('ab\r\ncd', false, false, 'gecko/char').leftOut).toBeNull()
      expect(segments('ab\r\u200E cd')).toEqual(['ab\u200E', ' ', 'cd'])
      expect(segments('ab \u200E\fcd')).toEqual(['ab', ' \u200E', 'cd'])
      expect(segments('ab\r\u200E\rcd')).toEqual(['ab\u200E', 'cd'])
      expect(segments('ab \u200E\r\ncd')).toEqual(['ab', ' \u200E ', 'cd'])
      expect(segments('ab\r\n\u00AD cd')).toEqual(['ab', ' ', '\u00AD', 'cd'])
      // Nor is it the white space of a run that goes on into a text's trailing white space: the
      // space after the soft hyphen is a run of its own.
      expect(segments('ab\r\u00AD ')).toEqual(['ab', '\u00AD'])
      expect(prepareWithSegments('ab\rcd', FONT, { whiteSpace: 'pre-wrap' }).segments).toEqual(['ab', '\n', 'cd'])
      // Controls, and soft hyphens before them, take no letter spacing.
      expect(prepareWithSegments('a\u200Eb', FONT, { letterSpacing: 2 }).widths).toEqual([measureWidth('ab', FONT) + 2])
      expect(prepareWithSegments('a\u00AD\u200Eb', FONT, { letterSpacing: 2 }).widths).toEqual([measureWidth('a\u00AD\u200Eb', FONT) + 2])
    } finally {
      profile.lineBreakScan = previous.lineBreakScan
      profile.graphemeTable = previous.graphemeTable
      profile.zeroWidthGlueTakesLine = previous.zeroWidthGlueTakesLine
      clearCache()
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
        expect(reconstructFromLineBoundaries(prepared, result.lines)).toBe(prepared.segments.join(''))
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
          expect(internals(prepared).segmentFlags[markIndex]! & SPACED).toBe(0)
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

  test('a long chain of mark runs is measured after its grapheme and the fewest last runs holding 96 units', () => {
    const measureText = Object.getOwnPropertyDescriptor(TestCanvasRenderingContext2D.prototype, 'measureText')!
    const measured = new Set<string>()
    let longest = 0
    Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
      ...measureText,
      value(this: TestCanvasRenderingContext2D, text: string) {
        measured.add(text)
        // The longest string with a mark: the Chromium profile also asks the font one long string (getFontSpaceKerning).
        if (text.includes('\u0301')) longest = Math.max(longest, text.length)
        return { width: measureWidth(text, this.font) }
      },
    })
    // Chains of a grapheme and runs of U+0301, each after U+0001, and a space between chains.
    const shapes: Array<{ chains: Array<[string, number[]]>; longest: number }> = [
      { chains: [['x', new Array<number>(40).fill(1)]], longest: 81 },
      { chains: [['x', new Array<number>(400).fill(1)]], longest: 99 },
      { chains: [['x', [94, 95, 96, 97, 200, 1, 1, 1]]], longest: 300 },
      { chains: [['x', [300, ...new Array<number>(60).fill(1)]]], longest: 398 },
      { chains: [['x', new Array<number>(60).fill(1)], ['y', new Array<number>(60).fill(1)]], longest: 99 },
    ]
    try {
      for (let s = 0; s < shapes.length; s++) {
        const { chains } = shapes[s]!
        const contexts: string[] = []
        const parts: string[] = []
        for (let c = 0; c < chains.length; c++) {
          const [grapheme, runs] = chains[c]!
          const pairs = runs.map(n => '\u0001' + '́'.repeat(n))
          parts.push(grapheme + pairs.join(''))
          for (let r = 0; r < runs.length; r++) {
            // The whole chain before the run, or the fewest last runs, each with its U+0001, that hold 96 units.
            let tail = pairs.slice(0, r).join('') + '\u0001'
            for (let first = r - 1; first > 0; first--) {
              const kept = pairs.slice(first, r).join('') + '\u0001'
              if (kept.length >= 96) {
                tail = kept
                break
              }
            }
            contexts.push(grapheme + tail)
          }
        }
        clearCache()
        measured.clear()
        longest = 0
        const prepared = prepareWithSegments(parts.join(' '), FONT)
        let run = 0
        for (let i = 0; i < prepared.segments.length; i++) {
          if (!/^́+$/.test(prepared.segments[i]!)) continue
          const context = contexts[run++]!
          expect(measured.has(context)).toBe(true)
          expect(prepared.widths[i]).toBeCloseTo(measureWidth(context + prepared.segments[i], FONT) - measureWidth(context, FONT), 9)
        }
        expect(run).toBe(contexts.length)
        expect(longest).toBe(shapes[s]!.longest)
      }
    } finally {
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
      clearCache()
    }
  })

  test('a rich item keeps its collapsed leading whitespace as WebKit break context', () => {
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    profile.lineBreakScan = 'webkit'
    try {
      // The WebKit scan reads each item's own text, where a SPACE or TAB before the ZWSP
      // separates the mark, and a fragment's text is its item's between its source offsets.
      for (const parts of [[' \u200B\u0301ab', 'c'], ['x', '\t\u200B\u0301ab']]) for (const width of [1, 20]) {
        const prepared = prepareRichInline(parts.map(text => ({ text, font: FONT })))
        const items = parts.map(text => prepareWithSegments(text, FONT))
        const texts = parts.map(() => '')
        walkRichInlineLineRanges(prepared, width, range => {
          for (const fragment of materializeRichInlineLineRange(prepared, range).fragments) {
            expect(parts[fragment.itemIndex]!.slice(fragment.sourceStart, fragment.sourceEnd)).toBe(fragment.text)
            texts[fragment.itemIndex] += fragment.text
          }
        })
        // A line start after a wrap consumes the ZWSP, which is then in no fragment, as in no text line.
        expect(texts.map(text => text.replace('\u200B', ''))).toEqual(items.map(item => item.segments.join('').replace('\u200B', '')))
      }
    } finally {
      profile.lineBreakScan = previous
    }
  })

  test('Chrome and Firefox remove a newline run next to a zero-width space through their own runs', () => {
    const profile = getEngineProfile()
    const previous = { lineBreakScan: profile.lineBreakScan, transformsSegmentBreaksAcrossItems: profile.transformsSegmentBreaksAcrossItems }
    try {
      for (const [scan, column] of [['webkit', 1], ['blink', 2], ['gecko', 3]] as const) {
        profile.lineBreakScan = scan
        profile.transformsSegmentBreaksAcrossItems = scan === 'blink'
        // Source, then the normalized text in Safari, Chrome and Firefox.
        for (const shape of [
          ['ab\n\u200Bcd', 'ab \u200Bcd', 'ab\u200Bcd', 'ab\u200Bcd'],
          ['ab\u200B \n\tcd', 'ab\u200B cd', 'ab\u200Bcd', 'ab\u200Bcd'],
          ['\u200B\nab', '\u200B ab', '\u200Bab', '\u200Bab'],
          // The ZWSP must touch the run, and the run must contain a newline.
          ['ab\n\u2060\u200Bcd', 'ab \u2060\u200Bcd', 'ab \u2060\u200Bcd', 'ab \u2060\u200Bcd'],
          ['ab \u200Bcd', 'ab \u200Bcd', 'ab \u200Bcd', 'ab \u200Bcd'],
          // CR joins Blink's run only. FF joins neither run, and takes no room in Firefox.
          ['ab\u200B\r\ncd', 'ab\u200B cd', 'ab\u200Bcd', 'ab\u200B cd'],
          ['ab\u200B\f\ncd', 'ab\u200B cd', 'ab\u200B cd', 'ab\u200B cd'],
          ['ab\u200B\n\fcd', 'ab\u200B cd', 'ab\u200B cd', 'ab\u200Bcd'],
          // Gecko's run continues through SHY without ending on one, and leaves
          // out a last SPACE before a combining mark.
          ['ab\u200B\n\u00AD\ncd', 'ab\u200B \u00AD cd', 'ab\u200B\u00AD cd', 'ab\u200B\u00ADcd'],
          ['ab\n\u00AD\u200Bcd', 'ab \u00AD\u200Bcd', 'ab \u00AD\u200Bcd', 'ab \u00AD\u200Bcd'],
          ['ab\u200B\n \u0301cd', 'ab\u200B \u0301cd', 'ab\u200B\u0301cd', 'ab\u200B \u0301cd'],
        ] as const) {
          expect(prepareWithSegments(shape[0], FONT).segments.join('')).toBe(shape[column])
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
      Object.assign(profile, previous)
    }
  })

  test('the WebKit profile keeps NEL with the content before it, breaks after it and gives it no letter spacing', () => {
    const profile = getEngineProfile()
    const previous = [profile.lineBreakScan, profile.unspacedCursive] as const
    // Blink and Gecko keep NEL as ordinary text.
    expect(prepareWithSegments('zz ab\u0085cd', FONT).kinds).not.toContain('control')
    profile.lineBreakScan = 'webkit'
    profile.unspacedCursive = 'none'
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
      expect(kindsOf(keepAll)).toEqual(['text', 'space', 'text', 'control', 'text', 'space', 'text', 'control', 'text'])
      // A rich item that ends in NEL breaks before the next item.
      const rich = prepareRichInline([{ text: 'ab\u0085', font: FONT }, { text: 'cd', font: FONT }])
      expect(measureRichInlineStats(rich, measureWidth('ab\u0085', FONT) + 0.5).lineCount).toBe(2)
      // A rich paragraph's lines, with a space where a collapsed space falls between items.
      const richLines = (parts: readonly string[], width: number, letterSpacing = 0): string[] => {
        const prepared = prepareRichInline(parts.map(text => ({ text, font: FONT, letterSpacing })))
        const texts: string[] = []
        walkRichInlineLineRanges(prepared, width, range => {
          texts.push(materializeRichInlineLineRange(prepared, range).fragments
            .map(fragment => (fragment.gapItemIndex < 0 ? '' : ' ') + fragment.text).join('').trimEnd())
        })
        return texts
      }
      // A rich item that starts with NEL keeps the word before it, as the joined text does.
      const parts = ['ab foo', '\u0085b'] as const
      const width = measureWidth('ab foo', FONT) + 0.5
      const flatLines = lines(parts.join(''), width).map(line => line.text.trimEnd())
      expect(flatLines).toEqual(['ab', 'foo\u0085b'])
      expect(richLines(parts, width)).toEqual(flatLines)

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
        // After content, a rich item that starts with NEL keeps the NEL on the line where
        // it fits with 0.5px to spare, counting a gap after each of `z`, `z` and the space
        // and the NEL's own, as the joined text does: none before `cd`, one before a mark
        // on Arabic.
        for (const [text, gaps] of [['\u0085cd', 3], ['\u0085\u0651\u0628', 4]] as const) {
          const nelWidth = measureWidth('zz \u0085', FONT) + gaps * letterSpacing + 0.5
          const expected = ['zz \u0085', text.slice(1)]
          expect(lines(`zz ${text}`, nelWidth, { letterSpacing }).map(line => line.text.trimEnd())).toEqual(expected)
          expect(richLines(['zz ', text], nelWidth, letterSpacing)).toEqual(expected)
        }
      }
      // A preserved space does not hang after a NEL that already overflows.
      expect(lines('a\u0085 b', nel - 0.5, { whiteSpace: 'pre-wrap', letterSpacing: 1 }).map(line => line.text)).toEqual(['a', '\u0085', ' ', 'b'])
    } finally {
      [profile.lineBreakScan, profile.unspacedCursive] = previous
    }
  })

  test('the WebKit profile takes a lone carriage return out of normal white space, with the breaks its scan found around it', () => {
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    // The Blink profile's CR is a space.
    expect(prepareWithSegments('ab\rcd', FONT).segments).toEqual(['ab', ' ', 'cd'])
    profile.lineBreakScan = 'webkit'
    try {
      const segments = (text: string, options?: { whiteSpace?: 'pre-wrap', letterSpacing?: number }) => prepareWithSegments(text, FONT, options).segments
      const lines = (text: string, width: number) => {
        const prepared = prepareWithSegments(text, FONT)
        const result = layoutWithLines(prepared, width, LINE_HEIGHT)
        expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
        expect(layout(prepare(text, FONT), width, LINE_HEIGHT).lineCount).toBe(result.lineCount)
        return result.lines.map(line => line.text)
      }
      // It takes no room, no letter spacing and no segment: the word lays out as without it.
      for (const [text, without] of [['ab\rcd ef', 'abcd ef'], ['ab\r\rcd', 'abcd'], ['\rab\r', 'ab'], ['ab\r cd', 'ab cd'], ['ab \rcd', 'ab cd']] as const) {
        expect(segments(text)).toEqual(segments(without))
        for (const letterSpacing of [0, 2]) expect(prepareWithSegments(text, FONT, { letterSpacing }).widths).toEqual(prepareWithSegments(without, FONT, { letterSpacing }).widths)
      }
      expect(prepareWithSegments('ab\rcd', FONT).kinds).toEqual(['text'])
      // The scan read the source, so a CR keeps the break before it from the letter after it:
      // none after the hyphen, where the text without the CR has one.
      expect(segments('ab-cd')).toEqual(['ab-', 'cd'])
      expect(segments('ab-\rcd')).toEqual(['ab-cd'])
      // ICU breaks after the CR, and the line can end there where the scan takes that break, as
      // before a letter above U+00FF, or before an ASCII letter after one.
      expect(segments('\u0431\u0432\u0433\u0434')).toEqual(['\u0431\u0432\u0433\u0434'])
      for (const [text, halves] of [['\u0431\u0432\r\u0433\u0434', ['\u0431\u0432', '\u0433\u0434']], ['ab\r\u0433\u0434', ['ab', '\u0433\u0434']], ['\u0431\u0432\rcd', ['\u0431\u0432', 'cd']]] as const) {
        expect(segments(text)).toEqual([...halves])
        expect(lines(text, measureWidth(halves[0], FONT) + 0.5)).toEqual([...halves])
      }
      expect(segments('\u00E9t\u00E9\rcd')).toEqual(['\u00E9t\u00E9cd'])
      // Not before a digit. And the break goes by the character the scan holds as the one before
      // the CR, the second of the last pair it took to ICU where it stepped on from there: the full
      // stop of `т.е`, so no line ends before `cd`, and a Thai letter of `ไทยe`, so one does
      // (RESEARCH.md, Engine Facts, Safari (WebKit), CR and FF).
      expect(segments('\u0431\u0432\r12')).toEqual(['\u0431\u043212'])
      expect(segments('\u0442.\u0435\rcd')).toEqual(['\u0442.\u0435cd'])
      expect(segments('\u0E44\u0E17\u0E22e\rcd')).toEqual(['\u0E44\u0E17\u0E22e', 'cd'])
      // The break before a CR after white space goes to the unit after it, which has none of
      // its own, so the line ends there (under letter spacing, the test of where a line ends).
      expect(lines('ab \rcd', measureWidth('ab', FONT) + 0.5)).toEqual(['ab ', 'cd'])
      expect(analyzeText('ab \rcd', profile).hasUnbroken).toBe(false)
      // The mark after the text's last unit moves with the units, so a line separator that ends
      // the text is still a hard break.
      expect(prepareWithSegments('a\rb\u2028', FONT).kinds).toEqual(['text', 'hard-break'])
      // White space on its two sides is one space, where Safari keeps two.
      expect(segments('ab \r cd')).toEqual(['ab', ' ', 'cd'])
      // A text of only CRs and white space has no lines.
      for (const text of ['\r', '\r\r', '\r\n', ' \r ', '\t\r\t', '\r\n\r\n', '\r \r', '\f\r']) {
        expect({ text, ...layout(prepare(text, FONT), 200, LINE_HEIGHT) }).toEqual({ text, lineCount: 0, height: 0 })
        expect(lines(text, 200)).toEqual([])
      }
      // The CR of a CRLF collapses into the line feed's space, as before.
      expect(segments('ab\r\ncd')).toEqual(['ab', ' ', 'cd'])
      expect(segments('ab\r\n\r\ncd ef\r\n')).toEqual(['ab', ' ', 'cd', ' ', 'ef'])
      expect(segments('ab\r\r\ncd')).toEqual(['ab', ' ', 'cd'])
      expect(segments('ab\rcd\r\nef gh')).toEqual(['abcd', ' ', 'ef', ' ', 'gh'])
      expect(lines('ab\r\ncd', measureWidth('ab', FONT) + 0.5)).toEqual(['ab ', 'cd'])
      // Pre-wrap keeps its hard break (README, Caveats).
      expect(segments('ab\rcd', { whiteSpace: 'pre-wrap' })).toEqual(['ab', '\n', 'cd'])
    } finally {
      profile.lineBreakScan = previous
      clearCache()
    }
  })

  test('the WebKit profile ends a line at a separator where a lone carriage return and then white space end the text', () => {
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    // The white space that ends the text starts with a space or a tab, where the scan has a
    // break, and takes the mark of the carriage returns the analysis took out before it: the
    // separator's forced break.
    const texts = ['ab\u2028\r ', 'ab\u2029\r ', 'ab\u2028\r\t', 'ab\u2028\r \n', 'ab\u2028\r\r ']
    const narrow = measureWidth('ab', FONT) + 0.5
    try {
      for (const scan of ['blink', 'gecko', 'webkit'] as const) {
        profile.lineBreakScan = scan
        clearCache()
        // Only WebKit's items builder makes a separator a forced break. In the Blink and Gecko
        // profiles it is a control character, laid out as text.
        for (const text of texts) expect({ scan, text, kinds: prepareWithSegments(text, FONT).kinds }).toEqual({ scan, text, kinds: ['text', scan === 'webkit' ? 'hard-break' : 'text'] })
      }
      // The line ends at the separator and nothing follows it, where the separator as a control,
      // which the fake Canvas gives a width, took a line more at this width. Safari has a second
      // line here too, for the carriage return itself, which the profile takes out
      // (ENGINE_FOLLOWUPS.md, White space and controls).
      for (const text of texts) {
        const prepared = prepareWithSegments(text, FONT)
        const result = layoutWithLines(prepared, narrow, LINE_HEIGHT)
        expect({ text, lines: result.lines.map(line => line.text) }).toEqual({ text, lines: ['ab'] })
        expect(collectStreamedLines(prepared, narrow)).toEqual(result.lines)
        expect(layout(prepare(text, FONT), narrow, LINE_HEIGHT).lineCount).toBe(1)
      }
      // The CR of a CRLF stays in the text and starts that white space, with the separator's
      // mark alone.
      expect(prepareWithSegments('ab\u2028\r\n', FONT).kinds).toEqual(['text', 'hard-break'])
      // The same text as a rich item ends its line before the item after it. The item's white
      // space doesn't end the paragraph's text, so the separator's mark there is the scan's
      // own, kept without this rule.
      const prepared = prepareRichInline([{ text: 'ab\u2028\r ', font: FONT }, { text: 'cd', font: FONT }])
      const richLines: string[] = []
      walkRichInlineLineRanges(prepared, 1000, range => { richLines.push(materializeRichInlineLineRange(prepared, range).fragments.map(fragment => fragment.text).join('|')) })
      expect(richLines).toEqual(['ab', 'cd'])
      expect(measureRichInlineStats(prepared, 1000).lineCount).toBe(2)
    } finally {
      profile.lineBreakScan = previous
      clearCache()
    }
  })

  test('each engine profile counts its own tab stops under letter spacing', () => {
    // At 20px the fake Canvas's widths are whole app units, as Firefox's are.
    const LARGE = '20px Test Sans'
    const profile = getEngineProfile()
    const previous = { ...profile }
    const space = measureWidth(' ', LARGE)
    const a = measureWidth('a', LARGE)
    const foo = measureWidth('foo', LARGE)
    const width = (text: string, letterSpacing: number) =>
      layoutWithLines(prepareWithSegments(text, LARGE, { whiteSpace: 'pre-wrap', letterSpacing }), 1000, LINE_HEIGHT).lines[0]!.width
    const round = (value: number) => Math.round(value * 1e6) / 1e6
    try {
      for (const engine of ['blink', 'gecko', 'webkit'] as const) {
        const fields = TAB_FIELDS[engine]
        Object.assign(profile, fields)
        for (const letterSpacing of [-1, -0.5, 2, 4]) {
          // Blink and Gecko put a stop every eight letter-spaced spaces and add no spacing after a
          // tab; WebKit puts one every eight spaces and spaces each tab. The line's last glyph
          // keeps its spacing.
          const stop = fields.letterSpaceTabStops ? 8 * (space + letterSpacing) : 8 * space
          const tabSpacing = fields.letterSpaceTabs ? letterSpacing : 0
          expect({ engine, letterSpacing, width: round(width('a\tb', letterSpacing)) }).toEqual({ engine, letterSpacing, width: round(stop + tabSpacing + a + letterSpacing) })
          // Each tab of a run takes a whole stop, under negative spacing too: WebKit's spacing
          // after a tab leaves the next one that far before or after a stop, and under half a
          // space before one it takes the stop after.
          for (let tabs = 1; tabs <= 4; tabs++) {
            const expected = round(tabs * stop + tabSpacing + foo + 3 * letterSpacing)
            expect({ engine, letterSpacing, tabs, width: round(width('\t'.repeat(tabs) + 'foo', letterSpacing)) }).toEqual({ engine, letterSpacing, tabs, width: expected })
            expect({ engine, letterSpacing, tabs, width: round(width('a' + '\t'.repeat(tabs) + 'foo', letterSpacing)) }).toEqual({ engine, letterSpacing, tabs, width: expected })
          }
        }
        // Gecko rounds the letter spacing a stop counts to app units: -0.08px is -5/60px there.
        if (fields.letterSpaceTabStops) expect(width('\ta', -0.08)).toBeCloseTo(8 * (space - (fields.tabsInAppUnits ? 5 / 60 : 0.08)) + a - 0.08, 9)
        // Stops no wider than 0 leave a tab no advance.
        if (fields.letterSpaceTabStops) expect(width('a\t\tb', -space - 1)).toBeCloseTo(2 * (a - space - 1), 9)
      }
    } finally {
      Object.assign(profile, previous)
    }
  })

  test('a tab nearer its stop than the engine\'s minimum takes the stop after', () => {
    // At 20px the fake Canvas's widths are whole app units, as Firefox's are.
    const LARGE = '20px Test Sans'
    const profile = getEngineProfile()
    const previous = { ...profile }
    const space = measureWidth(' ', LARGE)
    const zero = measureWidth('0', LARGE)
    const stop = 8 * space
    const b = measureWidth('b', LARGE)
    const width = (text: string) => layoutWithLines(prepareWithSegments(text, LARGE, { whiteSpace: 'pre-wrap' }), 1000, LINE_HEIGHT).lines[0]!.width
    try {
      // The minimum is half a space in Blink and WebKit and half a `0` in Gecko. `aaaa` ends
      // between the two from the first stop, `a.....` under both, `aaa` over both, and `aa  0`
      // exactly half a `0` from it, where Gecko's tab takes the stop.
      expect(stop - measureWidth('aaaa', LARGE)).toBeGreaterThan(space / 2)
      expect(stop - measureWidth('aaaa', LARGE)).toBeLessThan(zero / 2)
      expect(stop - measureWidth('a.....', LARGE)).toBeLessThan(space / 2)
      expect(stop - measureWidth('aa  0', LARGE)).toBeCloseTo(zero / 2, 9)
      for (const engine of ['blink', 'gecko', 'webkit'] as const) {
        const fields = TAB_FIELDS[engine]
        Object.assign(profile, fields)
        const halfZero = fields.tabMinimumCharacter === '0'
        const stops = (text: string) => Math.round((width(`${text}\tb`) - b) / stop)
        expect({ engine, stops: stops('aaa') }).toEqual({ engine, stops: 1 })
        expect({ engine, stops: stops('aaaa') }).toEqual({ engine, stops: halfZero ? 2 : 1 })
        expect({ engine, stops: stops('a.....') }).toEqual({ engine, stops: 2 })
        expect({ engine, stops: stops('aa  0') }).toEqual({ engine, stops: 1 })
        expect(width('aaaa\tb')).toBeCloseTo((halfZero ? 2 : 1) * stop + b, 9)
      }
    } finally {
      Object.assign(profile, previous)
    }
  })

  test('the Gecko profile returns a line from a tab that doesn\'t fit to its latest break', () => {
    const LARGE = '20px Test Sans'
    const profile = getEngineProfile()
    const previous = { ...profile }
    const stop = 8 * measureWidth(' ', LARGE)
    const col = measureWidth('col1', LARGE)
    const lines = (text: string, width: number) =>
      layoutWithLines(prepareWithSegments(text, LARGE, { whiteSpace: 'pre-wrap' }), width, LINE_HEIGHT).lines.map(line => [line.text, Math.round(line.width * 1e6) / 1e6])
    const round = (value: number) => Math.round(value * 1e6) / 1e6
    try {
      for (const scan of ['gecko', 'blink'] as const) {
        profile.lineBreakScan = scan
        profile.hangTabs = scan !== 'gecko'
        Object.assign(profile, TAB_FIELDS[scan])
        clearCache()
        // `col3` fits and its tab doesn't. Firefox doesn't hang the tab and no line ends before
        // one, so the word goes to the next line with it; Chrome's tab hangs.
        expect(col).toBeLessThan(stop)
        expect({ scan, lines: lines('col1\tcol2\tcol3\tcol4', 2 * stop + col + 1) }).toEqual({ scan, lines: scan === 'gecko'
          ? [['col1\tcol2\t', round(2 * stop)], ['col3\tcol4', round(stop + col)]]
          : [['col1\tcol2\tcol3\t', round(2 * stop + col)], ['col4', round(col)]] })
        if (scan !== 'gecko') continue
        // The break is the latest before the tab's white space, however much of it fits.
        expect(lines('aaaa bb \tc', measureWidth('aaaa bb ', LARGE) + 1)).toEqual([['aaaa ', round(measureWidth('aaaa', LARGE))], ['bb \tc', round(stop + measureWidth('c', LARGE))]])
        // Without a break on the line, it wraps before the tab, between two tabs too, and the
        // spaces before the tab hang.
        const long = measureWidth('aaaaaaaaa', LARGE)
        const tabbed = round(stop + measureWidth('x', LARGE))
        expect(long).toBeGreaterThan(2 * stop)
        expect(lines('aaaaaaaaa\tx', long + 1)).toEqual([['aaaaaaaaa', round(long)], ['\tx', tabbed]])
        expect(lines('aaaaaaaaa \tx', long + 6)).toEqual([['aaaaaaaaa ', round(long)], ['\tx', tabbed]])
        expect(lines('a\t\tb', stop + 1)).toEqual([['a\t', round(stop)], ['\t', round(stop)], ['b', round(measureWidth('b', LARGE))]])
        // No line ends between a tab and the spaces after it either: where a later tab of the
        // run doesn't fit, the line wraps before that tab, or returns to the break before the run.
        const b = round(measureWidth('b', LARGE))
        expect(lines('a\t \t b', stop + 6)).toEqual([['a\t ', round(stop)], ['\t ', round(stop)], ['b', b]])
        expect(lines('x a\t \t b', stop + 6)).toEqual([['x ', round(measureWidth('x', LARGE))], ['a\t ', round(stop)], ['\t ', round(stop)], ['b', b]])
        // A break of the joined text inside a rich item's segment is such a break: the two Thai
        // items join into words that break after the second item's first letter, and its tab, under
        // half a `0` before its stop, takes the stop after and doesn't fit.
        const THAI = '\u0E2A\u0E27\u0E31\u0E2A'
        const rich = prepareRichInline([{ text: THAI, font: LARGE }, { text: THAI + '\tx', font: LARGE }], { whiteSpace: 'pre-wrap' })
        const richLines: string[] = []
        walkRichInlineLineRanges(rich, stop + 1, range => { richLines.push(materializeRichInlineLineRange(rich, range).fragments.map(fragment => fragment.text).join('')) })
        expect(measureWidth(THAI, LARGE)).toBeLessThan(stop)
        expect(richLines).toEqual([THAI, '\u0E2A', '\u0E27\u0E31\u0E2A\t', 'x'])
        // A soft hyphen before the tab keeps its break, with its hyphen.
        expect(lines('aaaaaaaaa\u00AD\tx', long + 10)).toEqual([['aaaaaaaaa-', round(long + measureWidth('-', LARGE))], ['\tx', tabbed]])
      }
    } finally {
      Object.assign(profile, previous)
      clearCache()
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
      const prepared = prepareWithSegments(text, FONT)
      const result = layoutWithLines(prepared, width, LINE_HEIGHT)
      expect(result.lines.map(line => line.text)).toEqual([...expected])
      expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
      expect(layout(prepare(text, FONT), width, LINE_HEIGHT).lineCount).toBe(expected.length)
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
      expect({ text, breaks: positions(getBlinkLineBreaks(text, false, null), text.length) }).toEqual({ text, breaks: [...expected] })
    }
  })

  test("Blink's scan opens Chrome's zh table for a zh page", () => {
    const positions = (breaks: Uint8Array) => Array.from(breaks.keys()).filter(i => breaks[i] === 1)
    // line_normal_cj.brk treats curly quotes as brackets and lets 〜 start a line.
    for (const [text, root, zh] of [
      ['中文“abc”中文', [1, 8], [1, 2, 7, 8]],
      ['x〜y', [2], [1, 2]],
    ] as const) {
      expect(positions(getBlinkLineBreaks(text, false, null))).toEqual([...root])
      expect(positions(getBlinkLineBreaks(text, false, 'ja'))).toEqual([...root])
      expect(positions(getBlinkLineBreaks(text, false, 'zh-Hant'))).toEqual([...zh])
      // A page without a language follows Chrome's UI language, which Intl shows as its
      // default and preparation gives the scan.
      const locale = new Intl.DateTimeFormat().resolvedOptions().locale
      setLocale('')
      expect(getPreparationLanguage(getEngineProfile())).toBe(locale)
      setLocale()
      expect(positions(getBlinkLineBreaks(text, false, locale))).toEqual([...(locale.toLowerCase().startsWith('zh') ? zh : root)])
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
      expect({ text, keepAll, breaks: positions(getBlinkLineBreaks(text, keepAll, null), text.length) })
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
      expect({ text, language, keepAll, breaks: positions(getWebKitLineBreaks(text, preserve, keepAll, language), text.length) })
        .toEqual({ text, language, keepAll, breaks: [...expected] })
    }
    // Between inline boxes, the previous box's last two characters are prior context.
    expect(getWebKitBreakBetweenItems('丙!', 'a', false, 'en')).toBe(false)
    expect(getWebKitBreakBetweenItems('ex-', 'ample', false, 'en')).toBe(true)
    expect(getWebKitBreakBetweenItems('a', '-1', false, 'en')).toBe(false)
    // Keep-all reads none: a box starts at a break only where it starts with a ZWSP, so
    // not after punctuation that ends the box before, where one 16-bit text breaks.
    expect(getWebKitBreakBetweenItems('ex-', 'ample', true, 'en')).toBe(false)
    expect(getWebKitBreakBetweenItems('中。', '文字', true, 'zh')).toBe(false)
    expect(positions(getWebKitLineBreaks('中。文字', false, true, 'zh'), 4)).toEqual([2])
    expect(getWebKitBreakBetweenItems('ab', '\u200Bcd', true, 'en')).toBe(true)
    // A separator that starts an item forces a break after it, marked FORCED_BREAK (4);
    // one inside a text item doesn't.
    expect(Array.from(getWebKitLineBreaks('ab\u2028cd', false, false, 'en'))).toEqual([0, 0, 0, 4, 0, 0])
    expect(Array.from(getWebKitLineBreaks('か中？\u2028b', false, false, 'en'))).toEqual([0, 1, 0, 0, 1, 0])
  })

  test("Gecko's scan follows its white-space transform, text runs, nsLineBreaker and ICU4X's rules", async () => {
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
      expect(preserve ? text : removeSkippableSegmentBreaks(text, { lineBreakScan: 'gecko', graphemeTable: 'chromium/char', hangTabs: false }, language)).toBe(text)
      expect({ text, language, keepAll, breaks: positions(getGeckoLineBreaks(text, preserve, keepAll, 'chromium/char').breaks, text.length) })
        .toEqual({ text, language, keepAll, breaks: [...expected] })
    }
  })

  test('grapheme clusters end where ICU ends them, in one pass', async () => {
    const { findGraphemeEnds } = await import('./graphemes.ts')
    const { getBreakRules, markRuleBoundaries } = await import('./line-breaks.ts')
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
      const rules = getBreakRules(table)
      for (let t = 0; t < 20_000; t++) {
        const alphabet = Array.from({ length: 2 + random(4) }, () => samples[random(samples.length)]!)
        let text = ''
        for (let length = 1 + random(24); length > 0; length--) text += String.fromCodePoint(alphabet[random(alphabet.length)]!)
        const flags = new Uint8Array(text.length + 1)
        markRuleBoundaries(rules, text, flags)
        const expected: number[] = []
        for (let b = 1; b <= text.length; b++) if (flags[b] === 1) expected.push(b)
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
    const measurement = getFontMeasurement('16px Fit Mode Test', null, false)
    const metrics: SegmentMetrics = { width: 80, emojiCount: -1, fit: null, spaceKerning: null }
    for (const [text, width] of [['a', 10], ['b', 20], ['c', 30], ['ab', 35], ['bc', 60]] as const) {
      measurement.metrics.set(text, { width, emojiCount: -1, fit: null, spaceKerning: null })
    }
    measurement.metrics.set('abc', metrics)

    expect(getSegmentFit('abc', metrics, measurement, 0, 'sum-graphemes').advances).toEqual([10, 20, 30])
    expect(getSegmentFit('abc', metrics, measurement, 0, 'pair-context').advances).toEqual([10, 25, 40])
    expect(getSegmentFit('abc', metrics, measurement, 0, 'segment-prefixes').advances).toEqual([10, 25, 45])
    expect(getSegmentFit('abc', metrics, measurement, 0, 'sum-graphemes').advances).toEqual([10, 20, 30])
  })

  test('the emoji correction counts the glyphs the emoji font draws', () => {
    // Like Chrome and Firefox on macOS at small sizes, Canvas measures each glyph of the
    // emoji font 20px wide where DOM text draws it 16px wide. Each font shapes its own
    // characters together, so a grapheme is drawn as the longest pieces a font has a
    // glyph for. The named font draws U+26A1 itself, 9.5px wide, U+26AA nearly as wide as
    // an emoji, and U+231A where U+FE0E asks for a text font.
    const font = '16px Emoji Correction Test'
    const emojiFontGlyphs = [
      '\u{1F600}', '\u2764\uFE0F', '\u{1F44B}', '\u{1F44B}\u{1F3FD}', '\u{1F3FB}', '\u{1F3FD}', '\u231A', '\u{1F680}', '1\uFE0F\u20E3', '#\uFE0F\u20E3',
      // Chrome and Firefox draw these from the emoji font too, with the same gap.
      '1\uFE0F', '#\uFE0F',
      // The emoji font draws U+26A1 before U+FE0F.
      '\u26A1\uFE0F',
      // No text font has U+1F336, a pictograph whose presentation is text by default, so
      // the emoji font draws it with no U+FE0F.
      '\u{1F336}',
      // Sequences, and the parts the emoji font draws where it has no glyph for the whole.
      '\u{1F468}\u200D\u{1F680}', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', '\u{1F469}\u200D\u{1F467}',
      '\u{1F468}', '\u{1F469}', '\u{1F467}', '\u{1F1EF}\u{1F1F5}', '\u{1F1EF}', '\u{1F1F5}',
    ]
    const pieces = new Map<string, number>([
      ['\u26A1', 9.5], ['\u26AA', 20.25], ['\u231A\uFE0E', 9.25], ['\u00A9', 11.75], ['\u306A', 16], ['\u17C8', 3],
      ['\u200D', 0], ['\uFE0F', 0], ['\uFE0E', 0],
      // Chrome's Canvas draws U+20E3 after a character of the named font as that font's
      // missing glyph, which after `1` adds up to an emoji's width, as in 12px Baskerville.
      ['a\uFE0F\u20E3', 21.5], ['1\u20E3', 20], ['\u00A9\u20E3', 23.75],
    ])
    for (let i = 0; i < emojiFontGlyphs.length; i++) pieces.set(emojiFontGlyphs[i]!, 20)
    const measureText = Object.getOwnPropertyDescriptor(TestCanvasRenderingContext2D.prototype, 'measureText')!
    Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
      ...measureText,
      value(this: TestCanvasRenderingContext2D, text: string) {
        let width = 0
        for (const grapheme of getSegmentGraphemes(text)) {
          for (let at = 0, end = 0; at < grapheme.length; at = end) {
            end = grapheme.length
            while (end > at && !pieces.has(grapheme.slice(at, end))) end--
            if (end > at) width += pieces.get(grapheme.slice(at, end))!
            else width += measureWidth(grapheme.slice(at, end = at + String.fromCodePoint(grapheme.codePointAt(at)!).length), this.font)
          }
        }
        // A 32-bit float, as Canvas reports: three glyphs are 60.000004px.
        return { width: Math.fround(width * (1 + 2 ** -24)) }
      },
    })
    const cases: [string, number][] = [
      ['a\uFE0Fb', 0],
      [' \uFE0F', 0],
      ['\u3000\uFE0F', 0],
      ['1\u20E3', 0],
      ['a\uFE0F\u20E3', 0],
      ['\u2764\uFE0F', 1],
      ['\u{1F44B}', 1],
      ['1\uFE0F\u20E3', 1],
      ['#\uFE0F\u20E3', 1],
      ['1\uFE0F', 1],
      ['#\uFE0F', 1],
      // With no U+FE0F, the font that draws the character decides: the emoji font, or
      // the named font, as for a pictograph code point that is no emoji yet (U+1F02C).
      ['\u{1F336}', 1],
      ['\u00A9 \u{1F02C}', 0],
      // A glyph of the named font is measured as the page draws it, beside an emoji too.
      ['\u26A1', 0],
      ['\u26AA', 0],
      ['done\u26A1 \u26A1\u{1F44B}!', 1],
      ['\u26A1\u26A1\uFE0F', 1],
      ['\u231A \u231A\uFE0E', 1],
      // A sequence the emoji font has no glyph for takes one correction for each part.
      ['\u{1F468}\u200D\u{1F680}\u200D\u{1F680}', 2],
      ['\u{1F600}\u200D\u{1F600}\u200D\u{1F600}', 3],
      // Graphemes that mix fonts. A skin tone after a character of the named font is
      // asked apart from it, as Firefox draws it, from the emoji font. Chrome draws that
      // tone as the named font's missing glyph, in the character's cluster, and gets this
      // count all the same: a named gap (ENGINE_FOLLOWUPS.md, Emoji correction).
      ['\u306A\u{1F3FB}', 1],
      ['\u26AA\u{1F3FB}', 1],
      ['2\u{1F3FB}', 1],
      // An emoji, a ZWJ sequence, a skin-toned emoji and a flag before a combining mark
      // of another script, each still one glyph:
      ['\u{1F600}\u17C8', 1],
      ['\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u17C8', 1],
      ['\u{1F44B}\u{1F3FD}\u17C8', 1],
      ['\u{1F1EF}\u{1F1F5}\u17C8', 1],
      // A skin tone after that mark is asked apart too, an emoji as Firefox draws it.
      // Chrome draws it in the mark's cluster as the named font's missing glyph: the
      // same named gap.
      ['\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u17C8\u{1F3FB}', 2],
      // A stretch that two fonts draw takes no correction. That is right for U+20E3 after
      // a character of the named font, and a named gap for a sequence joined by a ZWJ to
      // such a character, where Firefox draws the sequence from the emoji font.
      ['\u00A9\u20E3', 0],
      ['\u00A9\u200D\u{1F469}\u200D\u{1F467}', 0],
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
    // There is no `glue` kind any more, on purpose (RESEARCH.md, Decisions Log, 2026-09-24).
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

  test('a letter-spaced hyphen takes one more spacing where letterSpaceDiscretionaryHyphen is set', () => {
    const profile = getEngineProfile()
    const previous = profile.letterSpaceDiscretionaryHyphen
    try {
      profile.letterSpaceDiscretionaryHyphen = true
      const spaced = internals(prepareWithSegments('trans\u00ADatlantic', FONT, { letterSpacing: 2 })).discretionaryHyphenWidth
      profile.letterSpaceDiscretionaryHyphen = false
      const unspaced = internals(prepareWithSegments('trans\u00ADatlantic', FONT, { letterSpacing: 2 })).discretionaryHyphenWidth
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
      profile.unfitHyphenRetreat = 'reduced-width'
      const expected = ['foo ', 'trans-', 'atlantic']
      const prepared = prepareWithSegments(text, FONT)
      expect(layoutWithLines(prepared, width, LINE_HEIGHT).lines.map(line => line.text)).toEqual(expected)
      expect(collectStreamedLines(prepared, width).map(line => line.text)).toEqual(expected)
      expect(measureLineStats(prepared, width).lineCount).toBe(expected.length)
      expect(layout(prepare(text, FONT), width, LINE_HEIGHT).lineCount).toBe(expected.length)

      // The zero-width space leaves no room for the hyphen, so the line returns
      // to the soft hyphen that the zero-width space replaced as pending.
      const replaced = prepareWithSegments('a b\u00ADc\u200B\u00ADjki', FONT)
      expect(layoutWithLines(replaced, 36, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['a b-', 'c\u200B-', 'jki'])

      // A break between two text segments, as after `-`, after an en dash or between
      // ideographs, is an opportunity like a space: the line returns to it, with no hyphen.
      const lineTexts = (source: string, maxWidth: number, letterSpacing = 0): string[] => {
        const handle = prepareWithSegments(source, FONT, { letterSpacing })
        const lines = layoutWithLines(handle, maxWidth, LINE_HEIGHT).lines.map(line => line.text)
        expect(collectStreamedLines(handle, maxWidth).map(line => line.text)).toEqual(lines)
        expect(measureLineStats(handle, maxWidth).lineCount).toBe(lines.length)
        expect(layout(prepare(source, FONT, { letterSpacing }), maxWidth, LINE_HEIGHT).lineCount).toBe(lines.length)
        return lines
      }
      expect(prepareWithSegments('x ab-cd\u00ADefgh', FONT).segments).toEqual(['x', ' ', 'ab-', 'cd', '\u00AD', 'efgh'])
      expect(lineTexts('x ab-cd\u00ADefgh', 62)).toEqual(['x ab-', 'cdefgh'])
      expect(lineTexts('x 10\u201320\u00ADabcd', 58)).toEqual(['x 10\u2013', '20abcd'])
      expect(lineTexts('x \u65E5\u672C\u8A9E\u00AD\u65E5\u672C', measureWidth('x \u65E5\u672C\u8A9E', FONT) + 0.1)).toEqual(['x \u65E5\u672C', '\u8A9E\u65E5\u672C'])
      // The break after `-` is the only one on its line.
      expect(lineTexts('ab-cd\u00ADefgh', measureWidth('ab-cd', FONT) + 0.1)).toEqual(['ab-', 'cd-', 'efgh'])
      // The retry passes a break that leaves no room for the hyphen, here the one after `-`
      // before a syllable narrower than the hyphen, where a return at the full width ends
      // the line there.
      const measureText = Object.getOwnPropertyDescriptor(TestCanvasRenderingContext2D.prototype, 'measureText')!
      // An `i` is 3px wide.
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
        ...measureText,
        value(this: TestCanvasRenderingContext2D, measured: string) {
          return { width: measureWidth(measured, this.font) - 6.6 * (measured.match(/i/g) ?? []).length }
        },
      })
      clearCache()
      try {
        const narrowSyllable = 'x ab-i\u00ADefgh'
        const narrowWidth = measureWidth('x ab-', FONT) + 3.1
        expect(lineTexts(narrowSyllable, narrowWidth)).toEqual(['x ', 'ab-i-', 'efgh'])
        profile.unfitHyphenRetreat = 'full-width'
        expect(lineTexts(narrowSyllable, narrowWidth)).toEqual(['x ab-', 'iefgh'])
        // A return at the full width tests no width at such a break: the line fit when it
        // reached the break, with the letter-spacing gap after its last letter. Under spacing
        // that gives the syllable a negative advance, `x ab-` fits 22px only with that gap.
        for (const unfitHyphenRetreat of ['full-width', 'full-width-or-first'] as const) {
          profile.unfitHyphenRetreat = unfitHyphenRetreat
          expect(lineTexts(narrowSyllable, 22, -4)).toEqual(['x ab-', 'iefgh'])
        }
      } finally {
        Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
        profile.unfitHyphenRetreat = 'reduced-width'
        clearCache()
      }
      // Text the scan doesn't break before, as after a control character, holds no
      // opportunity, so the line returns past it.
      const unbroken = 'ab cd\u0001ef\u00ADgh'
      expect(prepareWithSegments(unbroken, FONT).segments).toEqual(['ab', ' ', 'cd', '\u0001', 'ef', '\u00AD', 'gh'])
      expect(layoutWithLines(prepareWithSegments(unbroken, FONT), measureWidth('ab cd\u0001ef', FONT) + 0.1, LINE_HEIGHT).lines.map(line => line.text))
        .toEqual(['ab ', 'cd\u0001efgh'])

      // A handle without soft-hyphen contexts keeps the overflowing hyphen.
      const withoutContexts = { ...internals(prepareWithSegments(text, FONT)), discretionaryHyphenContexts: null }
      expect(walkPreparedLinesRaw(withoutContexts, width)).toBe(2)
    } finally {
      profile.unfitHyphenRetreat = previous
    }
  })

  test('a rich-inline paragraph leaves Blink\'s room for the hyphen of the item that holds the soft hyphen, and none at the break before that item', () => {
    const profile = getEngineProfile()
    const previous = profile.unfitHyphenRetreat
    const measureText = Object.getOwnPropertyDescriptor(TestCanvasRenderingContext2D.prototype, 'measureText')!
    const SMALL = '10px Test Sans'
    const LARGE = '24px Test Sans'
    // An `i` is 3/16 em wide, narrower than a hyphen.
    const iWidth = (font: string): number => parseFontSize(font) * 3 / 16
    Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
      ...measureText,
      value(this: TestCanvasRenderingContext2D, measured: string) {
        return { width: measureWidth(measured, this.font) - (measureWidth('i', this.font) - iWidth(this.font)) * (measured.match(/i/g) ?? []).length }
      },
    })
    clearCache()
    const richLines = (items: { text: string, font: string }[], width: number): string[] => {
      const prepared = prepareRichInline(items)
      const lines: string[] = []
      walkRichInlineLineRanges(prepared, width, range => {
        lines.push(materializeRichInlineLineRange(prepared, range).fragments.map(fragment => (fragment.gapItemIndex < 0 ? '' : ' ') + fragment.text).join(''))
      })
      expect(measureRichInlineStats(prepared, width).lineCount).toBe(lines.length)
      return lines
    }
    try {
      profile.unfitHyphenRetreat = 'reduced-width'
      // `x ab-i` fits and its hyphen doesn't. The break after `ab-` is inside the large item, so
      // it has to leave room for the large hyphen, which it doesn't, though it would for the small
      // one of the item the paragraph starts with. The break before the large item needs none.
      const items = [{ text: 'x ', font: SMALL }, { text: 'ab-i\u00ADkes', font: LARGE }]
      const lead = measureWidth('x ', SMALL) + measureWidth('ab-', LARGE)
      const smallHyphen = measureWidth('-', SMALL)
      const largeHyphen = measureWidth('-', LARGE)
      expect(iWidth(LARGE) + smallHyphen).toBeLessThan(largeHyphen)
      expect(richLines(items, lead + iWidth(LARGE) + smallHyphen)).toEqual(['x', 'ab-i-', 'kes'])
      // With room for the large hyphen after `ab-`, the line returns there.
      expect(richLines(items, lead + largeHyphen)).toEqual(['x ab-', 'ikes'])
      // The same letters in the small item's font leave room for their own hyphen sooner.
      const small = [{ text: 'x ', font: LARGE }, { text: 'ab-i\u00ADkes', font: SMALL }]
      const smallLead = measureWidth('x ', LARGE) + measureWidth('ab-', SMALL)
      expect(richLines(small, smallLead + smallHyphen)).toEqual(['x ab-', 'ikes'])
      // A break right before the item that holds the soft hyphen leaves no room: the line goes
      // back over that item to a break that fits. In one text the break after `ab-` leaves none
      // for the hyphen and the hyphen stays, overflowing.
      const width = measureWidth('ab-', FONT) + iWidth(FONT) + 0.1
      expect(richLines([{ text: 'ab-', font: FONT }, { text: 'i\u00ADk', font: FONT }], width)).toEqual(['ab-', 'ik'])
      expect(layoutWithLines(prepareWithSegments('ab-i\u00ADk', FONT), width, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['ab-i-', 'k'])
      // The other engines leave no room anywhere.
      profile.unfitHyphenRetreat = 'full-width'
      expect(richLines(items, lead + iWidth(LARGE) + smallHyphen)).toEqual(['x ab-', 'ikes'])
    } finally {
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
      profile.unfitHyphenRetreat = previous
      clearCache()
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
      const hyphenLine = measureWidth('ab A', font) + internals(joined).discretionaryHyphenWidth
      expect(layoutWithLines(joined, hyphenLine - 1, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['ab A-', 'VAV'])
      expect(layoutWithLines(joined, hyphenLine - 3, LINE_HEIGHT).lines.map(line => line.text)).toEqual(['ab ', 'AVAV'])
    } finally {
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
      profile.unfitHyphenRetreat = previous
    }
  })

  test('WebKit returns an unfit soft hyphen to the latest earlier break that fits, else to the first on the line, with each side measured alone', () => {
    const profile = getEngineProfile()
    const previous = profile.unfitHyphenRetreat
    const measureText = Object.getOwnPropertyDescriptor(TestCanvasRenderingContext2D.prototype, 'measureText')!
    // An `i` is 3px wide, narrower than the hyphen, and A and V kern by -2px, so A and VAV
    // measure 2px wider apart than AVAV.
    const measure = (text: string): number => measureWidth(text, FONT) - 6.6 * (text.match(/i/g) ?? []).length - 2 * (text.match(/AV/g) ?? []).length
    Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
      ...measureText,
      value(this: TestCanvasRenderingContext2D, text: string) {
        measured.push(text)
        return { width: measure(text) }
      },
    })
    const lineTexts = (text: string, width: number): string[] => {
      const prepared = prepareWithSegments(text, FONT)
      const lines = layoutWithLines(prepared, width, LINE_HEIGHT).lines.map(line => line.text)
      expect(collectStreamedLines(prepared, width).map(line => line.text)).toEqual(lines)
      expect(measureLineStats(prepared, width).lineCount).toBe(lines.length)
      expect(layout(prepare(text, FONT), width, LINE_HEIGHT).lineCount).toBe(lines.length)
      return lines
    }
    const measured: string[] = []
    const measuredFor = (text: string): string[] => {
      clearCache()
      measured.length = 0
      prepare(text, FONT)
      return measured.slice()
    }
    clearCache()
    try {
      profile.unfitHyphenRetreat = 'full-width-or-first'
      // `the interna` fits and its hyphen doesn't: the line returns to the space. A
      // soft hyphen whose hyphen fits is returned to before it.
      const text = 'the interna\u00ADtion\u00ADal'
      expect(lineTexts(text, measure('the interna') + 0.1)).toEqual(['the ', 'interna-', 'tional'])
      expect(lineTexts(text, measure('the internation') + 0.1)).toEqual(['the interna-', 'tional'])
      // A break between two text segments ends the line as well.
      expect(lineTexts('x ab-cd\u00ADefgh', measure('x ab-cd') + 0.1)).toEqual(['x ab-', 'cdefgh'])
      // Text the scan doesn't break before doesn't, and the line returns past it.
      expect(lineTexts('ab cd\u0001ef\u00ADgh', measure('ab cd\u0001ef') + 0.1)).toEqual(['ab ', 'cd\u0001efgh'])

      // No break on the line fits its hyphen: `trans-` overflows, and so does `transi-`.
      // WebKit's return stops at the line's first break, where Gecko's finds none and the
      // line stays at its last.
      const narrow = 'trans\u00ADi\u00ADt\u00ADlantic'
      const width = measure('transi') + 0.1
      expect(lineTexts(narrow, width)).toEqual(['trans-', 'it-', 'lantic'])
      profile.unfitHyphenRetreat = 'full-width'
      expect(lineTexts(narrow, width)).toEqual(['transi-', 't-', 'lantic'])

      // Gecko shapes A and VAV together, so a hyphen that overflows by less than they narrow
      // stays. WebKit fits the two as it measures them, apart: the line returns, nothing is joined.
      const kerned = 'ab A\u00ADVAV'
      const hyphenLine = measure('ab A-')
      expect(lineTexts(kerned, hyphenLine - 1)).toEqual(['ab A-', 'VAV'])
      expect(measuredFor(kerned)).toContain('AVAV')
      profile.unfitHyphenRetreat = 'full-width-or-first'
      expect(lineTexts(kerned, hyphenLine - 1)).toEqual(['ab ', 'AVAV'])
      expect(measuredFor(kerned)).not.toContain('AVAV')
    } finally {
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
      profile.unfitHyphenRetreat = previous
      clearCache()
    }
  })

  test('a chosen soft hyphen measures as the hyphen the engine paints: U+2010 where the primary font has it, or in Gecko where any font draws it', () => {
    const profile = getEngineProfile()
    const previous = profile.hyphenFromPrimaryFont
    const previousScan = profile.lineBreakScan
    const measureText = Object.getOwnPropertyDescriptor(TestCanvasRenderingContext2D.prototype, 'measureText')!
    // Each character is drawn by the first listed family that has it. `Own Hyphen Sans`
    // has a U+2010 narrower than its `-`, `Latin Only Sans` has none, `Even Hyphen Sans`
    // has one as wide as its `-`, `Missing Sans` gives no font, and the two generic
    // families draw everything, monospace wider.
    const hyphenFonts: string[] = []
    Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
      ...measureText,
      value(this: TestCanvasRenderingContext2D, text: string) {
        canvasMeasurementCount++
        if (text === '\u2010') hyphenFonts.push(this.font)
        const families = this.font.replace(/^.*?\dpx\s+/, '').split(',').map(family => family.trim().replace(/^"|"$/g, ''))
        let width = 0
        for (const ch of text) {
          let family = ''
          for (let i = 0; i < families.length && family === ''; i++) {
            if (families[i] !== 'Missing Sans' && !(families[i] === 'Latin Only Sans' && ch === '\u2010')) family = families[i]!
          }
          if (family === 'monospace') width += 10
          else if (ch === '\u2010') width += family === 'Own Hyphen Sans' ? 4 : family === 'Even Hyphen Sans' ? measureWidth('-', this.font) : 5
          else width += measureWidth(ch, this.font)
        }
        return { width }
      },
    })
    const hyphen = measureWidth('-', FONT)
    const text = 'trans\u00ADatlantic'
    try {
      profile.hyphenFromPrimaryFont = true
      for (const [family, expected, hyphenCalls] of [
        // The font's own, after a later family's or a generic one's: both hyphens measure
        // differently, so the two generic families and then each family are asked.
        ['"Own Hyphen Sans", serif', 4, 5],
        ['"Missing Sans", "Own Hyphen Sans", serif', 4, 5],
        ['Own Hyphen Sans', 4, 5],
        // The primary font has none, so `-`, though a later family or a generic one draws U+2010.
        ['"Latin Only Sans", "Own Hyphen Sans", serif', hyphen, 5],
        ['"Latin Only Sans", serif', hyphen, 5],
        // Both hyphens measure the same, which asks nothing more.
        ['"Even Hyphen Sans", serif', hyphen, 1],
        // No family gives a font: the last asked is the generic family itself.
        ['"Missing Sans", serif', 5, 5],
      ] as const) {
        clearCache()
        hyphenFonts.length = 0
        const font = `16px ${family}`
        expect({ family, width: internals(prepareWithSegments(text, font)).discretionaryHyphenWidth }).toEqual({ family, width: expected })
        expect({ family, calls: hyphenFonts.length }).toEqual({ family, calls: hyphenCalls })
        // The font's later texts ask nothing again, and measure in the font itself.
        expect(internals(prepareWithSegments(`x ${text}`, font)).discretionaryHyphenWidth).toBe(expected)
        expect(hyphenFonts.length).toBe(hyphenCalls)
        expect(prepareWithSegments('new words', font).widths[0]).toBe(measureWidth('new', font))
      }
      // That hyphen follows the gap before it, as `-` does.
      expect(internals(prepareWithSegments(text, '16px "Own Hyphen Sans", serif', { letterSpacing: 2 })).discretionaryHyphenWidth).toBe(4 + 2)
      // A text without a soft hyphen asks for no hyphen but `-`.
      clearCache()
      hyphenFonts.length = 0
      prepareWithSegments('transatlantic crossing', '16px "Own Hyphen Sans", serif')
      expect(hyphenFonts).toEqual([])
      // Gecko takes U+2010 from the first listed font that has it, as Canvas draws it,
      // and asks no family.
      profile.hyphenFromPrimaryFont = false
      for (const [family, expected] of [
        ['"Own Hyphen Sans", serif', 4],
        ['"Latin Only Sans", "Own Hyphen Sans", serif', 4],
        ['"Latin Only Sans", serif', 5],
      ] as const) {
        clearCache()
        hyphenFonts.length = 0
        expect({ family, width: internals(prepareWithSegments(text, `16px ${family}`)).discretionaryHyphenWidth }).toEqual({ family, width: expected })
        expect(hyphenFonts).toEqual([`16px ${family}`])
      }
      // An item that starts with a soft hyphen holds it as glue under the Gecko scan, which
      // gives no break after it there. The text its items join ends a line at it, with the
      // hyphen the same text in one item paints.
      profile.lineBreakScan = 'gecko'
      clearCache()
      const font = '16px "Latin Only Sans", "Own Hyphen Sans", serif'
      const rich = prepareRichInline([{ text: 'trans', font }, { text: '\u00ADatlantic', font }])
      const hyphenLine = measureWidth('trans', font) + 4
      expect(layoutNextRichInlineLineRange(rich, hyphenLine)!.width).toBe(hyphenLine)
      expect(layoutWithLines(prepareWithSegments(text, font), hyphenLine, LINE_HEIGHT).lines[0]!.width).toBe(hyphenLine)
      // The two generic families measure a space or U+2010 alike, which tells nothing: `-`.
      profile.lineBreakScan = previousScan
      profile.hyphenFromPrimaryFont = true
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
      clearCache()
      expect(measureWidth('\u2010', FONT)).not.toBe(hyphen)
      expect(internals(prepareWithSegments(text, FONT)).discretionaryHyphenWidth).toBe(hyphen)
    } finally {
      Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', measureText)
      profile.hyphenFromPrimaryFont = previous
      profile.lineBreakScan = previousScan
      clearCache()
    }
  })

  test('segments at least prefixFitMinWidth wide take the engine\'s fit of a cut word, narrower ones their graphemes alone', () => {
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
      const advances = () => internals(prepareWithSegments('AVA', font)).breakableFitAdvances[0]!.map(advance => Math.round(advance * 1000) / 1000)
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

  test('treats soft hyphens as discretionary break points', () => {
    const prepared = prepareWithSegments('trans\u00ADatlantic', FONT)
    expect(prepared.segments).toEqual(['trans', '\u00AD', 'atlantic'])
    expect(prepared.kinds).toEqual(['text', 'soft-hyphen', 'text'])

    const wide = layoutWithLines(prepared, 200, LINE_HEIGHT)
    expect(wide.lineCount).toBe(1)
    expect(wide.lines.map(line => line.text)).toEqual(['transatlantic'])

    const prefixed = prepareWithSegments('foo trans\u00ADatlantic', FONT)
    const softBreakWidth = Math.max(
      prefixed.widths[0]! + prefixed.widths[1]! + prefixed.widths[2]! + internals(prefixed).discretionaryHyphenWidth,
      prefixed.widths[4]!,
    ) + 0.1
    const narrow = layoutWithLines(prefixed, softBreakWidth, LINE_HEIGHT)
    expect(narrow.lineCount).toBe(2)
    expect(narrow.lines.map(line => line.text)).toEqual(['foo trans-', 'atlantic'])
    expect(narrow.lines[0]!.width).toBeCloseTo(
      prefixed.widths[0]! + prefixed.widths[1]! + prefixed.widths[2]! + internals(prefixed).discretionaryHyphenWidth,
      5,
    )
    expect(layout(prefixed, softBreakWidth, LINE_HEIGHT).lineCount).toBe(narrow.lineCount)
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

  test('the library has no regex lookbehind, which a JavaScriptCore without it refuses to load', async () => {
    // JavaScriptCore checks every regex literal when it parses a module, so where it can't
    // parse a lookbehind, one stops the whole library from loading, whichever engine's path
    // it is on: Safari before 16.4, by its release notes (RESEARCH.md, Engine Facts, Safari).
    // No browser the harness runs would show it.
    const directory = new URL('.', import.meta.url).pathname
    for (const file of new Bun.Glob('**/*.ts').scanSync(directory)) {
      if (file === 'layout.test.ts' || file === 'test-data.ts') continue
      expect({ file, lookbehind: /\(\?<[=!]/.test(await Bun.file(directory + file).text()) }).toEqual({ file, lookbehind: false })
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
    const texts = ['\u65E5\u672C\u30A1\u30A2', '\u65E5\u672C\u30FC\u30FC', '\u307F\u305D\u30E9\u30FC\u30E1\u30F3', '\u65E5\u672C\uFF01\u30FC\u30FC', 'a xxxxーb', '約3ヶ月', '日本abcァア']
    try {
      // ICU's normal rules resolve CJ to ID, as Chromium does on every page, so both
      // may start a line after ideographs, kana and EX, and after a word or a number.
      expect(texts.map(text => segments(text))).toEqual(['\u65E5|\u672C|\u30A1|\u30A2', '\u65E5|\u672C|\u30FC|\u30FC', '\u307F|\u305D|\u30E9|\u30FC|\u30E1|\u30F3', '\u65E5|\u672C\uFF01|\u30FC|\u30FC', 'a| |xxxx|ー|b', '約|3|ヶ|月', '日|本|abc|ァ|ア'])
      // A closing bracket (CL) keeps NS after it but not ID (LB16).
      expect(segments('\u65E5\u672C\u300D\u30A1\u30A2', 'keep-all')).toBe('\u65E5\u672C\u300D|\u30A1\u30A2')
      // Strict rules resolve CJ to NS, as libicucore does on pages other than ja and
      // ko, and Gecko on every page, so neither may.
      const strict = ['\u65E5|\u672C\u30A1|\u30A2', '\u65E5|\u672C\u30FC\u30FC', '\u307F|\u305D|\u30E9\u30FC|\u30E1|\u30F3', '\u65E5|\u672C\uFF01\u30FC\u30FC', 'a| |xxxxー|b', '約|3ヶ|月', '日|本|abcァ|ア']
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

  test('each engine\'s user agent builds its whole profile', async () => {
    // Every field getEngineProfile() gives Chrome, Safari and Firefox, as [field, Blink's,
    // WebKit's, Gecko's]. The tests that set a field by hand check what its value does; this one
    // checks which engine takes which, so that a value moved to another engine fails here and
    // not only in that browser's cases. It restates the table, so it shows that a value moved,
    // never that one is right for its engine: that rests on the browser's cases and on each
    // field's rule and source in EngineProfile (src/measurement.ts).
    type Profile = ReturnType<MeasurementModule['getEngineProfile']>
    const fields: Array<{ [K in keyof Profile]: [K, Profile[K], Profile[K], Profile[K]] }[keyof Profile]> = [
      ['entryFitBasis', 'fresh', 'disabled', 'original'],
      ['lineBreakScan', 'blink', 'webkit', 'gecko'],
      ['graphemeTable', 'chromium/char', 'apple/char', 'gecko/char'],
      ['lineFitEpsilon', 0.005, 1 / 64, 0.005],
      ['cutWordFit', 'reshaped-lines', 'segment-prefixes', 'segment-prefixes'],
      ['prefixFitMinWidth', 80, 0, 80],
      ['cutWordKeepsLigatures', false, false, true],
      ['measureTextWithFollowingSpace', false, true, false],
      ['kernsSpacesInScriptRun', true, false, false],
      ['letterSpaceDiscretionaryHyphen', false, true, true],
      ['letterSpacingInAppUnits', false, false, true],
      ['canvasLetterSpacingDropsLigatures', true, false, true],
      ['unspacedCursive', 'run', 'none', 'cluster'],
      ['shapesMarksAcrossSoftHyphen', true, false, false],
      ['unfitHyphenRetreat', 'reduced-width', 'full-width-or-first', 'full-width'],
      ['hyphenFromPrimaryFont', true, true, false],
      ['letterSpaceTabStops', true, false, true],
      ['letterSpaceTabs', false, true, false],
      ['tabMinimumCharacter', ' ', ' ', '0'],
      ['tabsInAppUnits', false, false, true],
      ['hangTabs', true, true, false],
      ['zeroWidthGlueTakesLine', true, true, false],
      ['keepsLineStartPunctuation', false, true, false],
      ['hidesControlCharacters', false, false, true],
      ['hanKerning', true, false, false],
      ['hangsIdeographicSpace', true, false, true],
      ['laysOutUnderDefaultLocale', true, false, false],
      ['namesGenericFamiliesByLanguage', false, true, false],
      ['hardBreakItemRetreat', 'item', 'fit', 'last-grapheme'],
      ['paddedOpeningFit', 'start', 'placed', 'both'],
      ['emptyAtomicAlwaysFits', false, false, true],
      ['hangsSpacesPerTextFrame', false, false, true],
      ['testsHyphenBeforeAtomic', true, false, true],
      ['transformsSegmentBreaksAcrossItems', true, false, false],
    ]
    const profileOf = (engine: 1 | 2 | 3, entryFitBasis?: Profile['entryFitBasis']): Record<string, unknown> => {
      const profile: Record<string, unknown> = {}
      for (let i = 0; i < fields.length; i++) profile[fields[i]![0]] = fields[i]![engine]
      if (entryFitBasis !== undefined) profile['entryFitBasis'] = entryFitBasis
      return profile
    }
    for (const [userAgent, profile] of [
      [CHROME_USER_AGENT, profileOf(1)],
      [SAFARI_USER_AGENT, profileOf(2)],
      [FIREFOX_USER_AGENT, profileOf(3)],
      // Entry fits are verified only on desktop, Windows and Linux too, so Chrome and Firefox on
      // a phone take none; an app's web view on an iPhone names no browser and is WebKit.
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36', profileOf(1)],
      ['Mozilla/5.0 (X11; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0', profileOf(3)],
      ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36', profileOf(1, 'disabled')],
      ['Mozilla/5.0 (Android 14; Mobile; rv:156.0) Gecko/156.0 Firefox/156.0', profileOf(3, 'disabled')],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', profileOf(2)],
      // Engines Pretext doesn't recognize take Blink's profile: a desktop web view without a Blink
      // token takes desktop Chrome's, entry fits and all.
      ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36', profileOf(1)],
      ['Bun/1.4.0', profileOf(1, 'disabled')],
    ] as const) {
      const built: unknown = await engineProfileUnder(userAgent)
      expect({ userAgent, profile: built }).toEqual({ userAgent, profile })
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
    // Safari 26's rules aren't ported (RESEARCH.md, Decisions Log, 2026-09-16).
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

    expect(collectStreamedLines(prepared, width).map(line => line.text)).toEqual(['foo 世', '界 bar'])
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
      profile.keepsLineStartPunctuation = true
      // Safari 27 paints these at a width below one character; 8-bit `xb((c` takes one
      // character per line.
      expect(lines('xb((cā')).toEqual(['x', 'b((', 'c', 'ā'])
      expect(lines('xb((cā', { letterSpacing: 1 })).toEqual(['x', 'b((', 'c', 'ā'])
      expect(lines('xb((c')).toEqual(['x', 'b', '(', '(', 'c'])
      // Blink and Gecko end the line after the first grapheme.
      profile.lineBreakScan = 'blink'
      profile.keepsLineStartPunctuation = false
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
      // Collapsible spaces or a soft hyphen between two of them are an empty line, as in Safari.
      const emptyLineTexts = ['aaa\u2028 \u2028bbb', 'aaa\u2029  \u2029bbb', 'aaa\u2028\u00AD\u2028bbb']
      for (let i = 0; i < emptyLineTexts.length; i++) {
        const text = emptyLineTexts[i]!
        const prepared = prepareWithSegments(text, FONT)
        const result = layoutWithLines(prepared, 1000, LINE_HEIGHT)
        expect(result.lines.map(line => line.text)).toEqual(['aaa', '', 'bbb'])
        expect(collectStreamedLines(prepared, 1000)).toEqual(result.lines)
        expect(layout(prepare(text, FONT), 1000, LINE_HEIGHT).lineCount).toBe(3)
      }
    } finally {
      profile.lineBreakScan = previous
    }
  })

  test('keep-all letter groups take emergency breaks where the word segmenter marks CJK as not a word', async () => {
    const { clearWordSegmenter } = await import('./line-breaks.ts')
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
    clearWordSegmenter()
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
      clearWordSegmenter()
    }
  })

  test('text needs Intl.Segmenter only in the runs the scans break by dictionary, such as Thai', async () => {
    const { clearWordSegmenter } = await import('./line-breaks.ts')
    const Segmenter = Intl.Segmenter
    Reflect.deleteProperty(Intl, 'Segmenter')
    clearWordSegmenter()
    try {
      for (const lineBreakScan of ['blink', 'webkit', 'gecko'] as const) {
        const profile = { lineBreakScan, graphemeTable: 'chromium/char' as const, hangTabs: lineBreakScan !== 'gecko' }
        for (const text of ['Hello, world.', '漢字かな、한국어', 'العربية', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} #\uFE0F\u20E3', '\u0915\u094D\u0937\u093F', 'a\u00ADb c\u200Bd']) {
          expect(analyzeText(text, profile).texts.join('')).toBe(text)
        }
        expect(() => analyzeText('ภาษาไทย', profile)).toThrow()
      }
      const prepared = prepareWithSegments('Hello \u{1F44B} 漢字', FONT, { letterSpacing: 1 })
      expect(layoutWithLines(prepared, 1000, LINE_HEIGHT).lineCount).toBe(1)
    } finally {
      Reflect.set(Intl, 'Segmenter', Segmenter)
      clearWordSegmenter()
    }
  })

  test('setLocale() gives later prepares the language a worker lacks, in place of <html lang>', () => {
    // Like Chrome's and Firefox's, this context resolves fonts under its own lang.
    const contexts: Array<{ lang: string }> = []
    class LanguageContext {
      font = ''
      lang = 'inherit'

      measureText(text: string): { width: number } {
        return { width: measureWidth(text, this.font) * (this.lang === 'ja' ? 0.75 : 1) }
      }
    }
    Reflect.set(globalThis, 'OffscreenCanvas', class {
      getContext(): LanguageContext {
        const context = new LanguageContext()
        contexts.push(context)
        return context
      }
    })
    // Chrome's zh line table makes the curly quotes brackets here.
    const text = '中文“abc”中文'
    try {
      // No document, as in a worker.
      const root = prepareWithSegments(text, FONT)
      const width = measureNaturalWidth(root)
      setLocale('zh')
      const zh = prepareWithSegments(text, FONT).segments
      expect(zh).not.toEqual(root.segments)
      setLocale('ja')
      const ja = prepareWithSegments(text, FONT)
      expect({ segments: ja.segments, lang: contexts.at(-1)!.lang }).toEqual({ segments: root.segments, lang: 'ja' })
      expect(measureNaturalWidth(ja)).toBeCloseTo(width * 0.75, 10)
      // An empty locale is a page's without a language, which Blink lays out under its default locale.
      setLocale('')
      prepare(text, FONT)
      expect(contexts.at(-1)!.lang).toBe(new Intl.DateTimeFormat().resolvedOptions().locale)
      // Without a locale, preparation reads <html lang> again.
      Reflect.set(globalThis, 'document', { documentElement: { lang: 'zh' } })
      setLocale()
      expect(prepareWithSegments(text, FONT).segments).toEqual(zh)
      expect(contexts.at(-1)!.lang).toBe('zh')
      // A locale takes the place of <html lang> on a page too.
      setLocale('ja')
      expect({ segments: prepareWithSegments(text, FONT).segments, lang: contexts.at(-1)!.lang }).toEqual({ segments: root.segments, lang: 'ja' })
      expect(measureNaturalWidth(root)).toBe(width)
    } finally {
      setLocale()
      Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
      Reflect.deleteProperty(globalThis, 'document')
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

  test('the WebKit profile names the generic families of the page language in the Canvas font', () => {
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
    // purpose (RESEARCH.md, Decisions Log, 2026-09-24).
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

  test('a paragraph of one item lays out as that item with an empty item after it', async () => {
    // One text item alone is its text's own handle (prepareRichInline) unless it's atomic or has
    // extraWidth, and so is a paragraph whose other items are empty, which are dropped. Only the
    // cursor after the last line counts the empty item. The stream takes one more line than the
    // walk, so a stream that doesn't end fails.
    const walk = (prepared: ReturnType<typeof prepareRichInline>, maxWidth: number, items: number) => {
      const lines: unknown[] = []
      const count = walkRichInlineLineRanges(prepared, maxWidth, range => {
        const line = materializeRichInlineLineRange(prepared, range)
        lines.push({ ...line, end: line.end.itemIndex === items ? { ...line.end, itemIndex: 1 } : line.end })
      })
      const stream: unknown[] = []
      for (let cursor = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 }; stream.length <= lines.length;) {
        const range = layoutNextRichInlineLineRange(prepared, maxWidth, cursor)
        if (range === null) break
        stream.push({ ...range, end: range.end.itemIndex === items ? { ...range.end, itemIndex: 1 } : range.end })
        cursor = range.end
      }
      return { count, lines, stream, stats: measureRichInlineStats(prepared, maxWidth) }
    }
    const texts = ['alpha beta gamma delta', 'A B', 'supercalifragilistic word', '​ab cd', 'ab­cd ef', ' lead trail ', '­ab cd', 'ab cd ef', ' ​', '­']
    const widths = [-1, 0, 0.5, 1, 8, 12, 20, 37.5, 60, 1000, Infinity]
    const expectSame = (text: string, options: Parameters<typeof prepareRichInline>[1], letterSpacings: readonly number[], font = FONT) => {
      for (const letterSpacing of letterSpacings) {
        for (const style of [{}, { break: 'never' as const }, { extraWidth: 3 }]) {
          const one = prepareRichInline([{ text, font, letterSpacing, ...style }], options)
          const two = prepareRichInline([{ text, font, letterSpacing, ...style }, { text: '', font: FONT }], options)
          const whole = measureRichInlineStats(two, Infinity).maxLineWidth
          for (const maxWidth of [...widths, whole - 0.004]) expect({ text, options, letterSpacing, style, maxWidth, ...walk(one, maxWidth, 1) }).toEqual({ text, options, letterSpacing, style, maxWidth, ...walk(two, maxWidth, 2) })
        }
      }
    }
    for (const text of texts) expectSame(text, undefined, [0, -6, -12, 2])
    // So does text that the widths under 1px break, two words of a 0.5px font.
    expectSame('ab cd', undefined, [0], '0.5px Test Sans')
    // So do an item holding a hard break or a tab, as every line feed and tab of a pre-wrap
    // paragraph is, and U+2028 in the WebKit profile, and one whose start a line start consumes
    // past its first segment, as the Gecko profile's does where it starts with white space and
    // soft hyphens.
    const engines = [await engineProfileUnder(CHROME_USER_AGENT), await engineProfileUnder(SAFARI_USER_AGENT), await engineProfileUnder(FIREFOX_USER_AGENT)]
    const profile = getEngineProfile()
    const previous = { ...profile }
    try {
      for (let e = 0; e < engines.length; e++) {
        Object.assign(profile, engines[e]!)
        clearCache()
        for (const text of ['ab\ncd', 'a\n\u{1F600}', '\nab\n\ncd\n', 'ab\tcd ef', '\tab', 'ab cd\t', '   ', 'ab  cd', 'ab\u2028cd ef']) expectSame(text, { whiteSpace: 'pre-wrap' }, [0, -6, -12, 2])
        for (const text of [' \u00AD \u00AD中', ' \u00AD\u00AD中文 中', '\u00AD \u00ADab', 'ab\u2028cd ef', '민수 씨 오늘']) {
          expectSame(text, undefined, [0, -6, -12, 2])
          expectSame(text, { wordBreak: 'keep-all' }, [0, -6, -12, 2])
        }
      }
    } finally {
      Object.assign(profile, previous)
      clearCache()
    }
    // A paragraph of one text item lays out as that text: its lines are the text walkers'.
    for (const text of texts) {
      for (const letterSpacing of [0, 2]) {
        const one = prepareRichInline([{ text, font: FONT, letterSpacing }])
        const plain = prepareWithSegments(text, FONT, { letterSpacing })
        for (const maxWidth of widths) expect({ text, letterSpacing, maxWidth, ...measureRichInlineStats(one, maxWidth) }).toEqual({ text, letterSpacing, maxWidth, ...measureLineStats(plain, maxWidth) })
      }
    }
    // But for its whole fit: at -6px, `A B` fits whole at 8px, where the text walkers break at
    // the space after `A`, and the paragraph takes it (findWholeLine in rich-inline.ts), as Blink
    // takes a text item whole where its width fits.
    const whole = prepareRichInline([{ text: 'A B', font: FONT, letterSpacing: -6 }])
    expect(measureRichInlineStats(whole, 8).lineCount).toBe(1)
    expect(measureLineStats(prepareWithSegments('A B', FONT, { letterSpacing: -6 }), 8).lineCount).toBe(2)
  })

  test('a rich paragraph lays out at the width given under 1px, and at 0 under 0', () => {
    // A browser lays a paragraph's spans out in a box 0.5px or 0px wide as it lays their text out
    // there, with no floor at 1px, and the text walkers lay a width under 0 out as 0. The rich
    // line functions hand them the width so. Each line here is its fragments' text, a space for
    // a gap, and its width; the three line functions agree.
    const round = (width: number): number => Math.round(width * 1e6) / 1e6
    const lineOf = (prepared: ReturnType<typeof prepareRichInline>, range: Parameters<typeof materializeRichInlineLineRange>[1]): [string, number] => [
      materializeRichInlineLineRange(prepared, range).fragments.map(fragment => `${fragment.gapItemIndex >= 0 ? ' ' : ''}${fragment.text}`).join(''), round(range.width),
    ]
    const lay = (prepared: ReturnType<typeof prepareRichInline>, maxWidth: number): Array<[string, number]> => {
      const lines: Array<[string, number]> = []
      expect(walkRichInlineLineRanges(prepared, maxWidth, range => { lines.push(lineOf(prepared, range)) })).toBe(lines.length)
      const stream: Array<[string, number]> = []
      for (let range = layoutNextRichInlineLineRange(prepared, maxWidth); range !== null && stream.length <= lines.length; range = layoutNextRichInlineLineRange(prepared, maxWidth, range.end)) stream.push(lineOf(prepared, range))
      expect({ maxWidth, stream }).toEqual({ maxWidth, stream: lines })
      const stats = measureRichInlineStats(prepared, maxWidth)
      expect({ maxWidth, lineCount: stats.lineCount, maxLineWidth: round(stats.maxLineWidth) }).toEqual({ maxWidth, lineCount: lines.length, maxLineWidth: Math.max(0, ...lines.map(line => line[1])) })
      return lines
    }
    // A paragraph of one text item has its text's lines at every width. In the 0.5px font a
    // letter is 0.3px wide and a space 0.165px, so a width of 1px fits a word and one of 0.5px
    // a letter.
    const TINY = '0.5px Test Sans'
    const texts: Array<[string, string, Parameters<typeof prepareRichInline>[1]]> = [
      ['ab cd', TINY, undefined], ['ab cd', FONT, undefined], ['ab\u00ADcd\u200Bef', TINY, undefined], ['ab  cd \n e', TINY, { whiteSpace: 'pre-wrap' }], ['   ', FONT, { whiteSpace: 'pre-wrap' }],
    ]
    for (const [text, font, options] of texts) {
      const one = prepareRichInline([{ text, font }], options)
      const plain = prepareWithSegments(text, font, options)
      for (const maxWidth of [-5, -0.5, 0, 0.2, 0.5, 0.7, 1, 1.4]) {
        const lines = layoutWithLines(plain, maxWidth, LINE_HEIGHT).lines.map((line): [string, number] => [line.text, round(line.width)])
        expect({ text, font, maxWidth, lines: lay(one, maxWidth) }).toEqual({ text, font, maxWidth, lines })
      }
    }
    const words = prepareRichInline([{ text: 'ab cd', font: TINY }])
    expect(lay(words, 1)).toEqual([['ab ', 0.6], ['cd', 0.6]])
    for (const maxWidth of [0.5, 0.2, 0, -0.5, -5]) expect(lay(words, maxWidth)).toEqual([['a', 0.3], ['b ', 0.3], ['c', 0.3], ['d', 0.3]])
    // So has a paragraph of several items that is narrower than 1px. Two items of a 0.25px font
    // are one line from their width, 0.6825px, a word a line at 0.5px and a letter a line at
    // 0.2px and under.
    const QUARTER = '0.25px Test Sans'
    const items = prepareRichInline([{ text: 'ab ', font: QUARTER }, { text: 'cd', font: QUARTER }])
    expect(lay(items, 1)).toEqual([['ab cd', 0.6825]])
    expect(lay(items, 0.5)).toEqual([['ab', 0.3], ['cd', 0.3]])
    for (const maxWidth of [0.2, 0, -0.5, -5]) expect(lay(items, maxWidth)).toEqual([['a', 0.15], ['b', 0.15], ['c', 0.15], ['d', 0.15]])
    // A pre-wrap line of only spaces, which hang, is as wide as the width that holds them.
    const spaces = prepareRichInline([{ text: '  ', font: FONT }, { text: ' ', font: '700 16px Test Sans' }], { whiteSpace: 'pre-wrap' })
    expect([1, 0.5, 0, -5].map(maxWidth => lay(spaces, maxWidth))).toEqual([[['   ', 1]], [['   ', 0.5]], [['   ', 0]], [['   ', 0]]])
    // A width under 0 is 0 to the whole line's fit too (fitsWhole in rich-inline.ts). At -14px
    // `A B` is narrower than nothing, and one line at 0, where its text has two. Fitted against
    // a width under 0 as given, it would be one line down to its own width and two under it.
    const whole = prepareRichInline([{ text: 'A B', font: FONT, letterSpacing: -14 }])
    expect(measureRichInlineStats(whole, Infinity).maxLineWidth).toBe(0)
    expect([0, -1, -5, -100].map(maxWidth => lay(whole, maxWidth).length)).toEqual([1, 1, 1, 1])
    expect(layoutWithLines(prepareWithSegments('A B', FONT, { letterSpacing: -14 }), 0, LINE_HEIGHT).lineCount).toBe(2)
  })

  test('a following negative-advance rich item cannot undo forced overflow', () => {
    // `B` continues `A`'s run with less than no advance, which would bring the line back under
    // its width: no engine lets content make a line narrower, so the line that `A` overflows
    // ends before it, and the paragraph has no whole line to take (findWholeLine).
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
      // An item holding only a soft hyphen isn't line content, but after content its
      // fragment keeps the space before it, as the text keeps a space before a soft hyphen.
      [['a ', '\u00AD', ' b'], [[0, -1], [1, 0], [2, 2]]],
    ] as const) {
      expect(gapItems(texts.map(text => ({ text })))).toEqual([fragments.map(fragment => [...fragment])])
    }
    // An atomic item's own white space is inside its box, which trims it, so it makes no gap.
    expect(gapItems([{ text: 'Tag' }, { text: ' @maya', break: 'never' }])).toEqual([[[0, -1], [1, -1]]])
    expect(gapItems([{ text: '@maya ', break: 'never' }, { text: 'Tag' }])).toEqual([[[0, -1], [1, -1]]])
    expect(gapItems([{ text: '@maya ', break: 'never' }, { text: ' Tag' }])).toEqual([[[0, -1], [1, 1]]])
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
    // A collapsible run with a newline that a ZWSP in the item before or after touches
    // goes in Blink, which transforms the paragraph's text, and stays in Gecko, which
    // transforms each text frame's own text.
    const profile = getEngineProfile()
    const previous = { lineBreakScan: profile.lineBreakScan, transformsSegmentBreaksAcrossItems: profile.transformsSegmentBreaksAcrossItems }
    try {
      for (const [lineBreakScan, afterZwsp, beforeZwsp] of [
        ['blink', [[0, -1], [1, -1]], [[0, -1], [1, -1]]],
        ['gecko', [[0, -1], [1, 1]], [[0, -1], [1, 0]]],
      ] as const) {
        profile.lineBreakScan = lineBreakScan
        profile.transformsSegmentBreaksAcrossItems = lineBreakScan === 'blink'
        clearCache()
        expect(gapItems([{ text: 'ab\u200B' }, { text: '\ncd' }])).toEqual([afterZwsp.map(fragment => [...fragment])])
        expect(gapItems([{ text: 'ab\n' }, { text: '\u200Bcd' }])).toEqual([beforeZwsp.map(fragment => [...fragment])])
      }
    } finally {
      Object.assign(profile, previous)
      clearCache()
    }
  })

  test('rich items in one font lay out as the text walkers lay out their text in one node', () => {
    // A paragraph is one analysis of its items' joined text, cut where an item starts, so in the
    // Blink and Gecko profiles, which break by that text, its lines are the text's: as wide,
    // and ending at the same places.
    const lineEnds = (text: string, maxWidth: number) => {
      const prepared = prepareWithSegments(text, FONT)
      const lines: Array<[number, string]> = []
      walkLineRanges(prepared, maxWidth, range => { lines.push([Math.round(range.width * 1e6) / 1e6, materializeLineRange(prepared, range).text.replace(/[ \u00AD\u200B]+$/, '')]) })
      return lines
    }
    const richLineEnds = (parts: readonly string[], maxWidth: number) => {
      const prepared = prepareRichInline(parts.map(text => ({ text, font: FONT })))
      const lines: Array<[number, string]> = []
      walkRichInlineLineRanges(prepared, maxWidth, range => {
        let sum = 0
        let text = ''
        for (const fragment of materializeRichInlineLineRange(prepared, range).fragments) {
          sum += fragment.gapBefore + fragment.occupiedWidth
          text += (fragment.gapBefore === 0 ? '' : ' ') + fragment.text
        }
        // A line is as wide as its fragments and their gaps together.
        expect(range.width).toBeCloseTo(Math.max(0, sum), 8)
        lines.push([Math.round(range.width * 1e6) / 1e6, text.replace(/[ \u00AD\u200B]+$/, '')])
      })
      expect(measureRichInlineStats(prepared, maxWidth).lineCount).toBe(lines.length)
      return lines
    }
    const rows: ReadonlyArray<readonly string[]> = [
      ['see', ' \u00AD', 'this word'], ['see', ' \u00AD', 'this', 'word'], ['see', ' \u00AD', ' \u00AD'], ['see', ' \u00AD ', 'this word'],
      ['ab', ' \u00AD \u00AD', 'cd'], ['ab', ' \u00AD ', 'cd'], ['ab', ' \u00AD \u00AD', ')x'], ['ab', ' \u00AD \u00ADxyzw'], ['ab ', '\u00AD\u200Bxyzw'],
      ['see\u00AD', ' this word'], ['see ', 'x', ' this word'], ['\u300D', '\u00AD \u00AD', 'ab'], ['the ', 'inter', 'na\u00ADtion\u00ADal'],
      ['al', 'pha be', 'ta gam', 'ma del', 'ta'], ['a\u200B', 'b c', '\u200Bd'], ['ab', 'c\u0085d', 'e f'],
    ]
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    try {
      for (const scan of ['blink', 'gecko'] as const) {
        profile.lineBreakScan = scan
        clearCache()
        for (const parts of rows) {
          for (const maxWidth of [1, 9, 17, 25, 33, 41, 49, 57, 65, 81, 97, Infinity]) {
            expect({ scan, parts, maxWidth, lines: richLineEnds(parts, maxWidth) }).toEqual({ scan, parts, maxWidth, lines: lineEnds(parts.join(''), maxWidth) })
          }
        }
      }
      // In the Chromium profile a line returns from an unfit hyphen to a break the scan gives before
      // text, as Chrome's does, in a paragraph whose item starts inside the word as in its text.
      profile.lineBreakScan = 'blink'
      clearCache()
      const width = measureWidth('\u4E2D\u6587ab ', FONT) + 1
      expect(richLineEnds(['\u4E2D\u6587', 'a', 'b \u00ADcd ef'], width).map(line => line[1])).toEqual(['\u4E2D\u6587', 'ab cd', 'ef'])
      expect(lineEnds('\u4E2D\u6587ab \u00ADcd ef', width).map(line => line[1])).toEqual(['\u4E2D\u6587', 'ab cd', 'ef'])
    } finally {
      profile.lineBreakScan = previous
      clearCache()
    }
  })

  test('the Gecko profile collapses a rich paragraph\'s white space past soft hyphens and bidi controls, across items', () => {
    const width = (parts: readonly string[]) => measureRichInlineStats(prepareRichInline(parts.map(text => ({ text, font: FONT }))), Infinity).maxLineWidth
    const space = measureWidth(' ', FONT)
    const profile = getEngineProfile()
    const previous = { lineBreakScan: profile.lineBreakScan, transformsSegmentBreaksAcrossItems: profile.transformsSegmentBreaksAcrossItems }
    try {
      for (const scan of ['blink', 'webkit', 'gecko'] as const) {
        profile.lineBreakScan = scan
        profile.transformsSegmentBreaksAcrossItems = scan === 'blink'
        clearCache()
        // Gecko collapses a run of white space with the soft hyphens and bidi controls after it,
        // whichever item holds it, so white space that starts the next item collapses into it:
        // the paragraph is as wide as without that white space, and a space wider elsewhere.
        const second = scan === 'gecko' ? 0 : space
        expect(width(['see', ' \u00AD', ' this word'])).toBeCloseTo(width(['see', ' \u00AD', 'this word']) + second, 9)
        expect(width(['see \u00AD', ' this word'])).toBeCloseTo(width(['see \u00AD', 'this word']) + second, 9)
        expect(width(['see', ' \u00AD', ' ', 'this word'])).toBeCloseTo(width(['see', ' \u00AD', '', 'this word']) + second, 9)
        expect(width(['see', ' \u00AD \u00ADthis word'])).toBeCloseTo(width(['see', ' \u00AD\u00ADthis word']) + second, 9)
        expect(width(['see', ' \u200E', ' this word'])).toBeCloseTo(width(['see', ' \u200E', 'this word']) + second, 9)
        // One of those characters that starts an item follows no white space in its text frame,
        // so it ends the run, and white space after it takes room.
        expect(width(['see ', '\u00AD ', ' this word'])).toBeCloseTo(width(['see ', '\u00AD ', 'this word']), 9)
        // The run carries past the characters Gecko drops at any bidi level, as Pretext resolves
        // none (ENGINE_FOLLOWUPS.md), and past bidi controls that end an item after its white space.
        expect(width(['see \u202B\u00AD', ' this word'])).toBeCloseTo(width(['see \u202B\u00AD', 'this word']) + second, 9)
        expect(width(['see \u200F\u00AD', ' this word'])).toBeCloseTo(width(['see \u200F\u00AD', 'this word']) + second, 9)
        expect(width(['see', ' \u202B', ' this word'])).toBeCloseTo(width(['see', ' \u202B', 'this word']) + second, 9)
        // A soft hyphen after no white space opens no run, and text after one closes it.
        expect(width(['see\u00AD', ' this word'])).toBeCloseTo(width(['see\u00AD', 'this word']) + space, 9)
        expect(width(['see \u00AD', 'x', ' this word'])).toBeCloseTo(width(['see \u00AD', 'x', 'this word']) + space, 9)
      }
    } finally {
      Object.assign(profile, previous)
      clearCache()
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

  test('letterSpacing leaves no gap after a rich-inline object', () => {
    // Letter spacing follows each character (CSS Text 3, letter-spacing), and a chip or a box is none: the character
    // before one keeps its gap, and nothing comes between the object and the text after it.
    const spacing = 3
    const text = { text: 'CD', font: FONT, letterSpacing: spacing }
    const chip = { text: 'ab', font: FONT, break: 'never' as const }
    const box = { width: 10 }
    const textWidth = measureWidth('CD', FONT) + spacing * 2
    const chipWidth = measureWidth('ab', FONT)
    const paragraphs: Array<[Array<RichInlineItem | RichInlineBox>, number[]]> = [
      [[chip, text], [chipWidth, textWidth]],
      [[box, box, text], [10, 10, textWidth]],
      [[text, box, text, chip], [textWidth, 10, textWidth, chipWidth]],
    ]
    for (const [items, widths] of paragraphs) {
      const prepared = prepareRichInline(items)
      const line = layoutNextRichInlineLineRange(prepared, 500)!
      expect(line.fragments.map(fragment => fragment.occupiedWidth)).toEqual(widths)
      expect(line.width).toBe(widths.reduce((sum, width) => sum + width, 0))
      expect(measureRichInlineStats(prepared, 500)).toEqual({ lineCount: 1, maxLineWidth: line.width })
    }
  })

  test('a rich line starts after the collapsible space its start removes, as the joined text\'s line does', () => {
    // Under negative letter spacing a line whose last word just fits can end before the
    // space after it (ENGINE_FOLLOWUPS.md), and the next line starts after that space, as
    // the browsers remove collapsible spaces at a line's start (CSS Text 3 §4.1.2). Its
    // first fragment starts there too, at −1 as for large headings and at the spacing
    // apps give body text.
    for (const letterSpacing of [-1, -0.2, -0.08]) {
      // `zz ab` fits with the gap after its `b` from this width, for |letterSpacing| more.
      const width = measureWidth('zz ab', FONT) + 5 * letterSpacing - letterSpacing / 2
      for (const parts of [['zz ', 'ab cd'], ['zz ab cd']]) {
        const prepared = prepareRichInline(parts.map(text => ({ text, font: FONT, letterSpacing })))
        const lines: string[] = []
        walkRichInlineLineRanges(prepared, width, range => {
          lines.push(materializeRichInlineLineRange(prepared, range).fragments.map(fragment => fragment.text).join('|'))
        })
        const flat = layoutWithLines(prepareWithSegments(parts.join(''), FONT, { letterSpacing }), width, LINE_HEIGHT).lines
        expect(flat.map(line => line.text.trimEnd())).toEqual(['zz ab', 'cd'])
        expect(lines).toEqual([parts.length === 1 ? 'zz ab' : 'zz|ab', 'cd'])
      }
    }
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
      expect({ ...line, fragments: line.fragments.map(({ text: _text, sourceStart: _start, sourceEnd: _end, ...fragment }) => fragment) }).toEqual(range)
    }
  })

  test('an atomic rich item of only white space is an object as wide as its extraWidth, and one of no text is dropped', () => {
    // An inline-block is a box in its line whatever its text: its own white space collapses away inside
    // it, and a line can break on both sides of it. Chrome, Firefox and Safari lay out `ab`, a chip of two
    // spaces with 5px padding and `cd` in 16px Arial at 40px as `ab` and the chip, then `cd`, in normal
    // white space and in pre-wrap.
    const ab = measureWidth('ab', FONT)
    const round = (value: number) => Math.round(value * 1e6) / 1e6
    const lines = (items: Parameters<typeof prepareRichInline>[0], whiteSpace: 'normal' | 'pre-wrap', width: number) => {
      const prepared = prepareRichInline(items, { whiteSpace })
      const out: Array<Array<[number, string, number, number, number]>> = []
      walkRichInlineLineRanges(prepared, width, range => {
        out.push(materializeRichInlineLineRange(prepared, range).fragments.map(f => [f.itemIndex, f.text, round(f.occupiedWidth), f.sourceStart, f.sourceEnd]))
      })
      expect(measureRichInlineStats(prepared, width).lineCount).toBe(out.length)
      return out
    }
    for (const whiteSpace of ['normal', 'pre-wrap'] as const) {
      for (const text of ['  ', '\n']) {
        const items = [{ text: 'ab', font: FONT }, { text, font: FONT, break: 'never', extraWidth: 10 } as const, { text: 'cd', font: FONT }]
        const chip: [number, string, number, number, number] = [1, '', 10, text.length, text.length]
        expect(lines(items, whiteSpace, Infinity)).toEqual([[[0, 'ab', round(ab), 0, 2], chip, [2, 'cd', round(ab), 0, 2]]])
        expect(measureRichInlineStats(prepareRichInline(items, { whiteSpace }), Infinity).maxLineWidth).toBeCloseTo(2 * ab + 10, 6)
        expect(lines(items, whiteSpace, ab + 10)).toEqual([[[0, 'ab', round(ab), 0, 2], chip], [[2, 'cd', round(ab), 0, 2]]])
        expect(lines(items, whiteSpace, ab + 9)).toEqual([[[0, 'ab', round(ab), 0, 2]], [chip], [[2, 'cd', round(ab), 0, 2]]])
      }
      // An item whose text is empty is dropped, an atomic one with its extraWidth too: no fragment, no
      // width and no break where it was, as apps empty a run to hide it.
      const hidden = [{ text: 'ab', font: FONT }, { text: '', font: FONT, break: 'never' } as const, { text: '', font: FONT, break: 'never', extraWidth: 10 } as const, { text: 'cd', font: FONT }]
      expect(lines(hidden, whiteSpace, Infinity)).toEqual([[[0, 'ab', round(ab), 0, 2], [3, 'cd', round(ab), 0, 2]]])
      expect(measureRichInlineStats(prepareRichInline(hidden, { whiteSpace }), Infinity).maxLineWidth).toBeCloseTo(2 * ab, 6)
      expect(lines(hidden, whiteSpace, 2 * ab)).toHaveLength(1)
      expect(lines([{ text: '', font: FONT, break: 'never', extraWidth: 10 }], whiteSpace, Infinity)).toEqual([])
    }
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
        // A stream past 24 lines, one per unit of the longer paragraph plus one, fails.
        if (streamed.push(range) > 24) throw new Error('layoutNextRichInlineLineRange gives more than 24 lines')
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

  test('the Chromium profile and the Gecko scan break rich items only where their joined text breaks', () => {
    // Same-font runs from a product page: native text keeps "community," whole,
    // so the comma that starts the third run moves with the word before it.
    // Run extents also come from the joined text: split words, dictionary
    // words, a kinsoku unit and a soft hyphen before a space. At width 30 the
    // item's own segmentation breaks inside a joined Lao word. In the four rows
    // after `T` and `po\u00ADd`, an item's first word runs past its first segment
    // after a break, and the joined text breaks inside a later segment of an
    // item. In the row after those the walk ends at the space before the first item's
    // Thai word, which doesn't fit, where the joined text breaks inside that word. In
    // the four after it a soft hyphen starts an item after other text, in the one after
    // those an inner break ties with a pending break before the item, in the one after that
    // the joined text breaks inside the second item's first segment, which doesn't fit whole
    // after the first item, so the line takes that segment's first grapheme, and in the last
    // the joined text breaks twice inside the first item's one segment, which no line fits
    // whole: graphemes fill the second line from the first of those breaks, and it returns to
    // the second.
    const expectFlatLines = (parts: readonly string[], width: number) => {
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
      [['zz ', 'ab\u0000', 'cd'], 45],
      [['\u0E15\u0E32\u0E21\u0E18\u0E23\u0E23\u0E21\u0E40\u0E19\u0E35\u0E22\u0E21 \u0E43', '\u0E19\u0E17\u0E35\u0E48\u0E2A\u0E38\u0E14\u0E40\u0E21\u0E37\u0E48\u0E2D'], 48],
      [['\u6F22', '\u5B57\u0000\u6F22\u5B57'], 32],
      [['\u0E19\u0E32\u0E07\u0E40\u0E2B\u0E22\u0E35\u0E22\u0E1A\u0E14\u0E2D\u0E01\u0E1A\u0E31', '\u0E27\u0E19\u0E31\u0E49\u0E19'], 30],
      [['x \u0E17\u0E39\u0E17\u0E39', '\u0E17\u0E39', ' y'], 35],
      [['u', '\u00ADzv', 'uo'], 20],
      [['u', '\u00ADzv', 'uo'], 28.8],
      [['nmdo', '\u00ADau', 'o a'], 50],
      [['nmdo', '\u00ADau', 'o a'], 57.6],
      [['\u4E2D\u6587\u201C', '\uD83D\uDE0A\u201D\u4E2D\u6587'], 44],
      [['\u0E2A\u0E27\u0E31\u0E2A', '\u0E2A\u0E27\u0E31\u0E2A'], 48],
      [['\u0E2D\u0E32\u0E2B\u0E32\u0E23', '\u0E2D'], 32],
    ] as const) expectFlatLines(parts, width)
    // An item that a line start consumes, holding only a soft hyphen, keeps the break
    // before it, where the next item continues its run: the line ends there, after the
    // ZWSP, instead of at the ZWSP before the ideograph, whose break a run starting at
    // the first item's end took (ENGINE_FOLLOWUPS.md). A collapsible run with a newline
    // right after a ZWSP that ends the item before, or before one that starts the next,
    // goes as in the text of the whole paragraph, where it leaves one space around a soft
    // hyphen, not two, and where the run is an item of its own, the item before it keeps
    // its text.
    for (let width = 16; width <= 72; width += 4) {
      expectFlatLines(['  cd', '\u0E44\u0E17\u0E22', '\u200B\u4E2D\u200B', '\u00AD', '-'], width)
      expectFlatLines(['ab\u200B', '\n\u00AD\nc', 'd'], width)
      expectFlatLines(['ab\n', '\u200Bcd'], width)
      expectFlatLines(['wor', 'd', '\n', '\u200Bn', 'ext words'], width)
    }
    // The Gecko scan of the second item alone doesn't break before `\u0000`, where
    // the joined text does, so the item's copied flags mark that start returnable.
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    try {
      profile.lineBreakScan = 'gecko'
      clearCache()
      expectFlatLines(['xx \u0E01', '\u0E02\u0000\u0E01\u0E02 yy'], 30)
      // An item's soft hyphens take the kind of the joined text's segment that ends where
      // theirs does, where the item's own analysis sees the start of a text, and its
      // fragments paint the hyphen their line fits: after an ideograph, a zero-width
      // break, which holds no line of its own at 1px; two there, which the item's own
      // analysis joins as zero-width glue, the joined text's soft hyphen and zero-width
      // break, so the line ends after both with no hyphen at 32px; after an ideograph and
      // a mark, a zero-width break that paints no hyphen; and before a mark, a soft
      // hyphen, which its own analysis makes zero-width glue. A bidi control after the
      // space before the joined text breaks after it, as that space is the scan's context,
      // and a soft hyphen that starts the joined text after that space follows the content
      // before it, a zero-width break that paints no hyphen, as in one text.
      for (const width of [1, 32, 40]) expectFlatLines(['\u6F22\u5B57', '\u00ADa', 'b', 'c'], width)
      for (const width of [16, 32]) expectFlatLines(['\u6F22\u5B57', '\u00AD\u00ADa', 'b'], width)
      expectFlatLines(['\u6F22', '\u0301\u00ADab'], 32)
      for (const width of [40, 60]) expectFlatLines(['\u0628\u0628 \u0628\u0628\u0628', '\u00AD\u0650\u0628\u0628\u0628 \u0628\u0628'], width)
      expectFlatLines(['AA\u2060 B\n', '\u202Ax'], 40)
      for (const width of [12, 20]) expectFlatLines(['ab \u00AD\u200B', 'cd'], width)
      for (const width of [20, 40]) expectFlatLines(['a', 'b\t \u00ADc', 'd'], width)
    } finally {
      profile.lineBreakScan = previous
      clearCache()
    }
  })

  test('a rich fragment shows its item\'s own text, and the hyphen of a soft hyphen it ends at where its line\'s width counts one', () => {
    // Each line's fragments as their items and texts.
    const texts = (parts: readonly string[], maxWidth: number) => {
      const prepared = prepareRichInline(parts.map(text => ({ text, font: FONT })))
      const lines: Array<Array<[number, string]>> = []
      walkRichInlineLineRanges(prepared, maxWidth, range => {
        lines.push(materializeRichInlineLineRange(prepared, range).fragments.map(fragment => [fragment.itemIndex, fragment.text]))
      })
      return lines
    }
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    try {
      profile.lineBreakScan = 'gecko'
      clearCache()
      // An item's soft hyphens take the kind of the joined text's segment there, which
      // decides whether a line that ends at one counts a hyphen, and the fragment paints
      // the hyphen its line counts: in Gecko's scan a soft hyphen that starts an item
      // before a combining mark, which the item's own analysis makes zero-width glue,
      // and not one after an ideograph and a mark, a zero-width break there.
      expect(texts(['ab', '\u00AD\u0650cd'], 30)).toEqual([[[0, 'ab'], [1, '-']], [[1, '\u0650cd']]])
      expect(texts(['\u6F22', '\u0301\u00ADab'], 32)).toEqual([[[0, '\u6F22'], [1, '\u0301']], [[1, 'ab']]])
      // The fragment's text is otherwise its item's. An item that starts with a bidi control
      // starts a segment there, so the control stays in its fragment, and a soft hyphen that
      // ends the item before it shows in no fragment.
      expect(texts(['\u00AD', '\u202B-'], Infinity)).toEqual([[[0, ''], [1, '\u202B-']]])
      expect(texts(['ab \u00AD', '\u2066cd'], Infinity)).toEqual([[[0, 'ab '], [1, '\u2066cd']]])
    } finally {
      profile.lineBreakScan = previous
      clearCache()
    }
  })

  test('a rich fragment\'s sourceStart and sourceEnd name its text in its item where white space inside a segment was removed', () => {
    const BOLD = '700 16px Test Sans'
    // Each line's fragments as their items, their texts, and their items' texts from sourceStart to sourceEnd.
    const sources = (items: RichInlineItem[], options: Parameters<typeof prepareRichInline>[1], maxWidth: number) => {
      const prepared = prepareRichInline(items, options)
      const lines: Array<Array<[number, string, string]>> = []
      walkRichInlineLineRanges(prepared, maxWidth, range => {
        lines.push(materializeRichInlineLineRange(prepared, range).fragments.map(f => [f.itemIndex, f.text, items[f.itemIndex]!.text.slice(f.sourceStart, f.sourceEnd)]))
      })
      return lines
    }
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    try {
      profile.lineBreakScan = 'gecko'
      clearCache()
      // Firefox removes a line feed between two ideographs, so under keep-all the ideographs around
      // it are one segment, which a narrow line breaks between graphemes. A fragment that starts or
      // ends inside the segment is its item's text there: with the line feed where the fragment
      // spans it, without it where the fragment starts or ends at it.
      const ideographs = '\u6F22\u5B57\u6F22\u5B57\n\u6F22\u5B57\u6F22\u5B57\u6F22\u5B57'
      const wide = measureWidth('\u6F22', FONT)
      expect(sources([{ text: ideographs, font: FONT }, { text: ' x', font: BOLD }], { wordBreak: 'keep-all' }, 3 * wide)).toEqual([
        [[0, '\u6F22\u5B57\u6F22', '\u6F22\u5B57\u6F22']],
        [[0, '\u5B57\u6F22\u5B57', '\u5B57\n\u6F22\u5B57']],
        [[0, '\u6F22\u5B57\u6F22', '\u6F22\u5B57\u6F22']],
        [[0, '\u5B57', '\u5B57'], [1, 'x', 'x']],
      ])
      expect(sources([{ text: ideographs, font: FONT }, { text: ' x', font: BOLD }], { wordBreak: 'keep-all' }, 4 * wide)).toEqual([
        [[0, '\u6F22\u5B57\u6F22\u5B57', '\u6F22\u5B57\u6F22\u5B57']],
        [[0, '\u6F22\u5B57\u6F22\u5B57', '\u6F22\u5B57\u6F22\u5B57']],
        [[0, '\u6F22\u5B57', '\u6F22\u5B57'], [1, 'x', 'x']],
      ])
      // The same in a paragraph of one item, which finds its segments in the item's text when a
      // line is first materialized.
      expect(sources([{ text: ideographs, font: FONT }], { wordBreak: 'keep-all' }, 3 * wide)).toEqual([
        [[0, '\u6F22\u5B57\u6F22', '\u6F22\u5B57\u6F22']],
        [[0, '\u5B57\u6F22\u5B57', '\u5B57\n\u6F22\u5B57']],
        [[0, '\u6F22\u5B57\u6F22', '\u6F22\u5B57\u6F22']],
        [[0, '\u5B57', '\u5B57']],
      ])
      // And where Firefox's run of white space goes on past a bidi control: the white space after
      // the control is inside the segment the control and the solidus make, and in neither's text.
      expect(sources([{ text: ' \u202A /-\u201Cq', font: FONT }, { text: 'uote\u201D', font: FONT }], {}, 9).slice(0, 2)).toEqual([[[0, '\u202A', '\u202A']], [[0, '/', '/']]])
      expect(sources([{ text: ' \u202A /-\u201Cq', font: FONT }, { text: 'uote\u201D', font: FONT }], {}, Infinity)).toEqual([[[0, '\u202A/-\u201Cq', '\u202A /-\u201Cq'], [1, 'uote\u201D', 'uote\u201D']]])
    } finally {
      profile.lineBreakScan = previous
      clearCache()
    }
  })

  test('a carriage return in a rich paragraph is what its text has in one item: a space in the Blink profile, and nothing in the Gecko and WebKit profiles, with the breaks each scan finds around it', () => {
    const BOLD = '700 16px Test Sans'
    const item = (text: string, font = FONT): RichInlineItem => ({ text, font })
    // Each line's fragments as their items, their texts, their items' texts from sourceStart to
    // sourceEnd and the items whose space is the gap before them, or -1. The stream from each
    // line's end gives the walk's next line, and the stats its line count.
    const lines = (items: RichInlineItem[], maxWidth: number) => {
      const prepared = prepareRichInline(items)
      const out: Array<Array<[number, string, string, number]>> = []
      const ends: Array<NonNullable<ReturnType<typeof layoutNextRichInlineLineRange>>['end']> = []
      walkRichInlineLineRanges(prepared, maxWidth, range => {
        ends.push(range.end)
        out.push(materializeRichInlineLineRange(prepared, range).fragments.map(f => [f.itemIndex, f.text, items[f.itemIndex]!.text.slice(f.sourceStart, f.sourceEnd), f.gapItemIndex]))
      })
      let range = layoutNextRichInlineLineRange(prepared, maxWidth)
      for (let i = 0; i < ends.length; i++) {
        expect(range!.end).toEqual(ends[i]!)
        range = layoutNextRichInlineLineRange(prepared, maxWidth, range!.end)
      }
      expect(range).toBeNull()
      expect(measureRichInlineStats(prepared, maxWidth).lineCount).toBe(out.length)
      return out
    }
    // Each line's end, as its item, segment and grapheme.
    const ends = (items: RichInlineItem[], maxWidth: number) => {
      const out: string[] = []
      walkRichInlineLineRanges(prepareRichInline(items), maxWidth, range => out.push(`${range.end.itemIndex}:${range.end.segmentIndex}:${range.end.graphemeIndex}`))
      return out
    }
    // A text cut into items of one font has the lines of the text in one item, the gaps as spaces.
    const expectLinesOfOneItem = (parts: readonly string[]) => {
      for (const width of [1, 20, 30, 40, 50, 60, Infinity]) {
        const rich = lines(parts.map(text => item(text)), width).map(line => line.map(f => (f[3] < 0 ? '' : ' ') + f[1]).join('').trimEnd())
        expect({ parts, width, rich }).toEqual({ parts, width, rich: lines([item(parts.join(''))], width).map(line => line[0]![1].trimEnd()) })
      }
    }
    // A CR inside an item, one that ends an item, one that starts an item, one that is an item
    // between two others, and a CRLF whose line feed starts the next item.
    const inside = [item('x '), item('ab\rcd', BOLD), item(' y')]
    const atEnd = [item('ab\r'), item('cd ef', BOLD)]
    const atStart = [item('ab'), item('\rcd ef', BOLD)]
    const between = [item('ab'), item('\r', BOLD), item('cd ef')]
    const split = [item('ab\r'), item('\ncd ef', BOLD)]
    const cuts = [['x ', 'ab\rcd', ' y'], ['ab\r', 'cd ef'], ['ab', '\rcd ef'], ['ab', '\r', 'cd ef'], ['ab\r', '\ncd ef'], ['ab\r\n', 'cd ef'], ['ab', '\r\ncd ef'], ['ab\r', ' cd'], ['ab ', '\rcd'], ['ab\r', '\rcd']] as const
    // `abc` fits and `abcd` doesn't.
    const narrow = measureWidth('abc', FONT) + 1
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    try {
      // To Blink a CR is white space: one space with the white space around it, the gap of the
      // item it ends or starts where that is its edge, and a break.
      profile.lineBreakScan = 'blink'
      clearCache()
      expect(lines(inside, Infinity)).toEqual([[[0, 'x', 'x', -1], [1, 'ab cd', 'ab\rcd', 0], [2, 'y', 'y', 2]]])
      expect(lines(atEnd, Infinity)).toEqual([[[0, 'ab', 'ab', -1], [1, 'cd ef', 'cd ef', 0]]])
      expect(lines(atStart, Infinity)).toEqual([[[0, 'ab', 'ab', -1], [1, 'cd ef', 'cd ef', 1]]])
      expect(lines(between, Infinity)).toEqual([[[0, 'ab', 'ab', -1], [2, 'cd ef', 'cd ef', 1]]])
      expect(lines(split, Infinity)).toEqual([[[0, 'ab', 'ab', -1], [1, 'cd ef', 'cd ef', 0]]])
      expect(lines(atEnd, narrow)).toEqual([[[0, 'ab', 'ab', -1]], [[1, 'cd ', 'cd ', -1]], [[1, 'ef', 'ef', -1]]])
      for (const parts of [...cuts, ['\u0431\u0432\r', 'cd'], ['ab\r', '\u0433\u0434']]) expectLinesOfOneItem(parts)

      // The WebKit profile takes a lone CR out wherever it is in its item, and one that is an
      // item leaves no fragment. No line ends where it was between characters up to U+00FF: the
      // word goes on across the items, and a narrow line cuts it between graphemes. A fragment's
      // place in its item spans a CR inside it and stops short of one at its item's edge.
      profile.lineBreakScan = 'webkit'
      clearCache()
      expect(lines(inside, Infinity)).toEqual([[[0, 'x', 'x', -1], [1, 'abcd', 'ab\rcd', 0], [2, 'y', 'y', 2]]])
      expect(lines(inside, narrow)).toEqual([[[0, 'x', 'x', -1]], [[1, 'abc', 'ab\rc', -1]], [[1, 'd', 'd', -1], [2, 'y', 'y', 2]]])
      expect(ends(inside, narrow)).toEqual(['1:0:0', '1:0:3', '3:0:0'])
      expect(lines(atEnd, Infinity)).toEqual([[[0, 'ab', 'ab', -1], [1, 'cd ef', 'cd ef', -1]]])
      expect(lines(atEnd, narrow)).toEqual([[[0, 'ab', 'ab', -1], [1, 'c', 'c', -1]], [[1, 'd ', 'd ', -1]], [[1, 'ef', 'ef', -1]]])
      expect(ends(atEnd, narrow)).toEqual(['1:0:1', '1:2:0', '2:0:0'])
      expect(lines(atStart, Infinity)).toEqual([[[0, 'ab', 'ab', -1], [1, 'cd ef', 'cd ef', -1]]])
      expect(lines(atStart, narrow)).toEqual([[[0, 'ab', 'ab', -1], [1, 'c', 'c', -1]], [[1, 'd ', 'd ', -1]], [[1, 'ef', 'ef', -1]]])
      expect(lines(between, Infinity)).toEqual([[[0, 'ab', 'ab', -1], [2, 'cd ef', 'cd ef', -1]]])
      expect(lines(between, narrow)).toEqual([[[0, 'ab', 'ab', -1], [2, 'c', 'c', -1]], [[2, 'd ', 'd ', -1]], [[2, 'ef', 'ef', -1]]])
      expect(ends(between, narrow)).toEqual(['2:0:1', '2:2:0', '3:0:0'])
      // The CR of a CRLF collapses into the line feed's space, in the next item too, and that
      // space is the gap of the item that holds the line feed, the pair's only white space to
      // WebKit: Safari lays out 16px Arial spans `see`, CR and LF, `this word`, the second in
      // bold 20px, 120.24px wide, with the bold space, and `see`, CR, LF and `this word` 119.13px.
      expect(lines(split, Infinity)).toEqual([[[0, 'ab', 'ab', -1], [1, 'cd ef', 'cd ef', 1]]])
      expect(lines(split, narrow)).toEqual([[[0, 'ab', 'ab', -1]], [[1, 'cd ', 'cd ', -1]], [[1, 'ef', 'ef', -1]]])
      for (const parts of cuts) expectLinesOfOneItem(parts)
      // WebKit decides a boundary between two boxes from the next box's text with the last two
      // characters before it (getWebKitBreakBetweenItems), where the pair of a CR and a
      // character up to U+00FF has no break, so there only the character after the CR brings
      // ICU's break: a text breaks after a CR that follows a Cyrillic letter, and items cut
      // right after that CR don't, as Safari lays out the spans.
      for (const parts of [['ab\r', '\u0433\u0434'], ['ab', '\r\u0433\u0434'], ['\u0431\u0432\r', '\u0433\u0434']]) expectLinesOfOneItem(parts)
      expect(lines([item('ab\r'), item('\u0433\u0434', BOLD)], narrow)).toEqual([[[0, 'ab', 'ab', -1]], [[1, '\u0433\u0434', '\u0433\u0434', -1]]])
      expect(lines([item('\u0431\u0432\rcd')], narrow)).toEqual([[[0, '\u0431\u0432', '\u0431\u0432', -1]], [[0, 'cd', 'cd', -1]]])
      expect(lines([item('\u0431\u0432\r'), item('cd', BOLD)], narrow)).toEqual([[[0, '\u0431\u0432', '\u0431\u0432', -1], [1, 'c', 'c', -1]], [[1, 'd', 'd', -1]]])
      // A line separator that ends an item ends its line as in one item where only white-space
      // items follow to the paragraph's end: the paragraph's scan has a break where such an item
      // starts, and the separator's forced break keeps its mark beside it (mapSourceLineBreaks).
      expectLinesOfOneItem(['ab\u2028', ' '])
      expectLinesOfOneItem(['ab\u2028', '\n'])

      // The Gecko profile takes it out too, and a line can end where it was.
      profile.lineBreakScan = 'gecko'
      clearCache()
      expect(lines(inside, Infinity)).toEqual([[[0, 'x', 'x', -1], [1, 'abcd', 'ab\rcd', 0], [2, 'y', 'y', 2]]])
      expect(lines(inside, narrow)).toEqual([[[0, 'x', 'x', -1]], [[1, 'ab', 'ab', -1]], [[1, 'cd', 'cd', -1]], [[2, 'y', 'y', -1]]])
      expect(ends(inside, narrow)).toEqual(['1:0:0', '1:1:0', '2:1:0', '3:0:0'])
      expect(lines(atEnd, Infinity)).toEqual([[[0, 'ab', 'ab', -1], [1, 'cd ef', 'cd ef', -1]]])
      expect(lines(atEnd, narrow)).toEqual([[[0, 'ab', 'ab', -1]], [[1, 'cd ', 'cd ', -1]], [[1, 'ef', 'ef', -1]]])
      expect(lines(atStart, Infinity)).toEqual([[[0, 'ab', 'ab', -1], [1, 'cd ef', 'cd ef', -1]]])
      expect(lines(atStart, narrow)).toEqual([[[0, 'ab', 'ab', -1]], [[1, 'cd ', 'cd ', -1]], [[1, 'ef', 'ef', -1]]])
      expect(lines(between, Infinity)).toEqual([[[0, 'ab', 'ab', -1], [2, 'cd ef', 'cd ef', -1]]])
      expect(lines(between, narrow)).toEqual([[[0, 'ab', 'ab', -1]], [[2, 'cd ', 'cd ', -1]], [[2, 'ef', 'ef', -1]]])
      expect(ends(between, narrow)).toEqual(['2:0:0', '2:2:0', '3:0:0'])
      // The space of a CRLF split across two items is the line feed's item's here too: Firefox
      // has those spans 120.22px and 119.12px wide.
      expect(lines(split, Infinity)).toEqual([[[0, 'ab', 'ab', -1], [1, 'cd ef', 'cd ef', 1]]])
      for (const parts of [...cuts, ['\u0431\u0432\r', 'cd'], ['ab\r', '\u0433\u0434']]) expectLinesOfOneItem(parts)
    } finally {
      profile.lineBreakScan = previous
      clearCache()
    }
  })

  test('white space right after a carriage return that ends a rich item is the next item\'s in the WebKit and Gecko profiles, as after a form feed in the Gecko profile, in that item\'s font and letter spacing; in the Blink profile, where a CR is white space, it is the CR\'s item\'s', () => {
    const BIG = '32px Test Sans'
    const item = (text: string, font = FONT, letterSpacing = 0): RichInlineItem => ({ text, font, letterSpacing })
    // Each line's fragments as their items, their texts, their items' texts from sourceStart to
    // sourceEnd, the items whose space is the gap before them, or -1, and that gap.
    const lines = (items: RichInlineItem[], maxWidth: number) => {
      const prepared = prepareRichInline(items)
      const out: Array<Array<[number, string, string, number, number]>> = []
      walkRichInlineLineRanges(prepared, maxWidth, range => {
        out.push(materializeRichInlineLineRange(prepared, range).fragments.map(f => [f.itemIndex, f.text, items[f.itemIndex]!.text.slice(f.sourceStart, f.sourceEnd), f.gapItemIndex, f.gapBefore]))
      })
      expect(measureRichInlineStats(prepared, maxWidth).lineCount).toBe(out.length)
      return out
    }
    const small = measureWidth(' ', FONT)
    const big = measureWidth(' ', BIG)
    // A CR that ends an item before a space that starts the next, whose font has a wider space;
    // a CRLF split there; a CR that is an item, in that font, before such a space; a form feed
    // for the CR; and the next item in the first one's font under letter spacing.
    const space = [item('ab\r'), item(' cd ef', BIG)]
    const feed = [item('ab\r'), item('\ncd ef', BIG)]
    const alone = [item('ab'), item('\r', BIG), item(' cd ef')]
    const formFeed = [item('ab\f'), item(' cd ef', BIG)]
    const spaced = [item('ab\r'), item(' cd ef', FONT, 3)]
    // `ab cd` fits with the first item's space and not with the second's.
    const turn = measureWidth('ab', FONT) + (small + big) / 2 + measureWidth('cd', BIG)
    // `ab` and a space fit and `ab cd` doesn't.
    const narrow = measureWidth('ab ', FONT) + 1
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    try {
      // To Blink the CR is the run's first white space, so the space is its item's: Chrome lays
      // out 16px Arial spans `see`, CR and space, `this word`, the second in bold 20px, 119.13px
      // wide, with the 16px space and none of the second span's letter spacing. An FF is the
      // profile's white space too.
      profile.lineBreakScan = 'blink'
      clearCache()
      expect(lines(space, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [1, 'cd ef', 'cd ef', 0, small]]])
      expect(lines(feed, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [1, 'cd ef', 'cd ef', 0, small]]])
      expect(lines(alone, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [2, 'cd ef', 'cd ef', 1, big]]])
      expect(lines(formFeed, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [1, 'cd ef', 'cd ef', 0, small]]])
      expect(lines(spaced, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [1, 'cd ef', 'cd ef', 0, small]]])
      expect(lines(space, turn).map(line => line.map(f => f[1]))).toEqual([['ab', 'cd '], ['ef']])
      expect(lines([item('ab\r cd')], narrow)).toEqual([[[0, 'ab ', 'ab\r', -1, 0]], [[0, 'cd', 'cd', -1, 0]]])

      // To WebKit a CR is no white space, so the run starts after it and its space is the next
      // item's, in that item's font and letter spacing: Safari lays those spans out 120.24px
      // wide, with the bold space, and on three lines at 66px, where `see this` is 66.91px wide
      // and would be 65.80px with the 16px space. A fragment that ends with that space ends
      // after it in its item's text, past the CR, in a paragraph of one item or of several, and
      // one that starts with it starts at it, which no expectation here pins. An FF is the
      // profile's white space still.
      profile.lineBreakScan = 'webkit'
      clearCache()
      expect(lines(space, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [1, 'cd ef', 'cd ef', 1, big]]])
      expect(lines(feed, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [1, 'cd ef', 'cd ef', 1, big]]])
      expect(lines(alone, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [2, 'cd ef', 'cd ef', 2, small]]])
      expect(lines(formFeed, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [1, 'cd ef', 'cd ef', 0, small]]])
      expect(lines(spaced, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [1, 'cd ef', 'cd ef', 1, small + 3]]])
      expect(lines(space, turn).map(line => line.map(f => f[1]))).toEqual([['ab'], ['cd '], ['ef']])
      expect(lines([item('ab\r cd')], narrow)).toEqual([[[0, 'ab ', 'ab\r ', -1, 0]], [[0, 'cd', 'cd', -1, 0]]])
      expect(lines([item('ab\r cd'), item('ef', BIG)], narrow)[0]).toEqual([[0, 'ab ', 'ab\r ', -1, 0]])
      expect(lines([item('ab\r\ncd')], narrow)).toEqual([[[0, 'ab ', 'ab\r\n', -1, 0]], [[0, 'cd', 'cd', -1, 0]]])

      // Nor is a CR white space to Gecko, or an FF: Firefox lays the spans out 120.22px wide,
      // and so with a form feed for the CR.
      profile.lineBreakScan = 'gecko'
      clearCache()
      expect(lines(space, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [1, 'cd ef', 'cd ef', 1, big]]])
      expect(lines(feed, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [1, 'cd ef', 'cd ef', 1, big]]])
      expect(lines(alone, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [2, 'cd ef', 'cd ef', 2, small]]])
      expect(lines(formFeed, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [1, 'cd ef', 'cd ef', 1, big]]])
      expect(lines(spaced, Infinity)).toEqual([[[0, 'ab', 'ab', -1, 0], [1, 'cd ef', 'cd ef', 1, small + 3]]])
      expect(lines(space, turn).map(line => line.map(f => f[1]))).toEqual([['ab'], ['cd '], ['ef']])
      expect(lines([item('ab\r cd')], narrow)).toEqual([[[0, 'ab ', 'ab\r ', -1, 0]], [[0, 'cd', 'cd', -1, 0]]])
      expect(lines([item('ab\f cd'), item('ef', BIG)], narrow)[0]).toEqual([[0, 'ab ', 'ab\f ', -1, 0]])
    } finally {
      profile.lineBreakScan = previous
      clearCache()
    }
  })

  test('a rich fragment\'s sourceStart never passes its sourceEnd where a padded item\'s start edge comes before the space or soft hyphens that lead it', () => {
    // The start edge of a padded item's opening is the item's first segment, before a collapsed space
    // or soft hyphens that lead its text, so a fragment that holds the edge and that space starts at
    // the item's start, or, where a CR (an FF too in the Gecko profile) starts the item, at the white
    // space after it in the WebKit and Gecko profiles.
    const ranges = (items: RichInlineItem[], options: Parameters<typeof prepareRichInline>[1], maxWidth: number) => {
      const prepared = prepareRichInline(items, options)
      const out: Array<[number, number, number]> = []
      walkRichInlineLineRanges(prepared, maxWidth, range => {
        const fragments = materializeRichInlineLineRange(prepared, range).fragments
        for (let i = 0; i < fragments.length; i++) out.push([fragments[i]!.itemIndex, fragments[i]!.sourceStart, fragments[i]!.sourceEnd])
      })
      return out
    }
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    try {
      // U+2028 ends a line in the WebKit profile, so an item of spaces and U+2028 opens with a hard break.
      profile.lineBreakScan = 'webkit'
      clearCache()
      expect(ranges([{ text: 'ab', font: FONT }, { text: '  \u2028', font: FONT, extraWidth: 5 }, { text: 'cd', font: FONT }], {}, 0)).toEqual([
        [0, 0, 1], [0, 1, 2], [1, 0, 1], [2, 0, 1], [2, 1, 2],
      ])
    } finally {
      profile.lineBreakScan = previous
      clearCache()
    }
    for (const width of [0, 20, 1000]) {
      const all = ranges([{ text: 'ab', font: FONT }, { text: '\u00AD\u00AD  x', font: FONT, extraWidth: 5 }], { whiteSpace: 'pre-wrap' }, width)
      for (let i = 0; i < all.length; i++) expect(all[i]![1]).toBeLessThanOrEqual(all[i]![2])
    }
  })

  test('the Gecko profile cuts a run of white space at every item that starts with a soft hyphen or bidi control, however many', () => {
    const profile = getEngineProfile()
    const previous = { lineBreakScan: profile.lineBreakScan, transformsSegmentBreaksAcrossItems: profile.transformsSegmentBreaksAcrossItems }
    try {
      profile.lineBreakScan = 'gecko'
      profile.transformsSegmentBreaksAcrossItems = false
      clearCache()
      // One pass over the run, with no call per item: 4,000 such items overflowed the stack.
      for (const dropped of ['\u00AD', '\u200F']) {
        const items = [{ text: 'ab ', font: FONT }]
        for (let i = 0; i < 20000; i++) items.push({ text: `${dropped} `, font: FONT })
        items.push({ text: 'cd', font: FONT })
        expect(measureRichInlineStats(prepareRichInline(items), Infinity).lineCount).toBe(1)
      }
    } finally {
      Object.assign(profile, previous)
      clearCache()
    }
  })

  test('white space after a rich object that overflows is walked in work that grows with its length', () => {
    const profile = getEngineProfile()
    const previous = { lineBreakScan: profile.lineBreakScan, hangTabs: profile.hangTabs }
    // How many times a walk of the paragraph's lines at 40px reads a segment's flags.
    const flagReads = (items: Parameters<typeof prepareRichInline>[0]): number => {
      const data = (prepareRichInline(items, { whiteSpace: 'pre-wrap' }) as unknown as { data: Parameters<typeof walkPreparedLinesRaw>[0] }).data
      let reads = 0
      const counted = new Proxy(data.segmentFlags, {
        get(target, key) {
          if (typeof key === 'string' && key !== 'length') reads++
          return Reflect.get(target, key) as unknown
        },
      })
      walkPreparedLinesRaw({ ...data, segmentFlags: counted }, 40)
      return reads
    }
    // Preserved white space after an object that overflows stays on its line, however many items
    // hold it: the walk asks once per run whether it stays, not once per segment.
    const spaces = (count: number) => {
      const items: Parameters<typeof prepareRichInline>[0] = [{ text: '@alice-with-a-long-name', font: FONT, break: 'never' }]
      for (let i = 0; i < count; i++) items.push({ text: ' ', font: FONT })
      items.push({ text: 'cd', font: FONT })
      return items
    }
    const tabs = (count: number) => {
      const items: Parameters<typeof prepareRichInline>[0] = [{ width: 500 }]
      for (let i = 0; i < count; i++) items.push({ text: i % 2 === 0 ? ' ' : '\t', font: FONT })
      items.push({ text: 'cd', font: FONT })
      return items
    }
    try {
      for (const scan of ['blink', 'webkit', 'gecko'] as const) {
        profile.lineBreakScan = scan
        profile.hangTabs = scan !== 'gecko'
        clearCache()
        expect(flagReads(spaces(2000))).toBeLessThan(5 * flagReads(spaces(500)))
        expect(flagReads(tabs(2000))).toBeLessThan(5 * flagReads(tabs(500)))
      }
    } finally {
      Object.assign(profile, previous)
      clearCache()
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
      for (const unfitHyphenRetreat of ['reduced-width', 'full-width', 'full-width-or-first'] as const) {
        profile.unfitHyphenRetreat = unfitHyphenRetreat
        expect(lineTexts(split, poFits - 0.1)).toEqual(['Tp', 'od'])
        expect(lineTexts(split, poFits)).toEqual(['Tpo-', 'd'])
        expect(lineTexts([{ text: 'T', font: FONT }, { text: 'p\u00ADd', font: FONT }], 12)).toEqual(['T', 'p-', 'd'])
      }

      // As in plain text, the line returns from the unfit hyphen to a break before
      // the item, here the space, whichever item holds the space.
      const width = measureWidth('a po', FONT) + 0.1
      for (const unfitHyphenRetreat of ['reduced-width', 'full-width', 'full-width-or-first'] as const) {
        profile.unfitHyphenRetreat = unfitHyphenRetreat
        expect(lineTexts([{ text: 'a ', font: FONT }, { text: 'po\u00ADd', font: FONT }], width)).toEqual(['a', 'pod'])
        expect(lineTexts([{ text: 'a', font: FONT }, { text: ' po\u00ADd', font: FONT }], width)).toEqual(['a', 'pod'])
        expect(layoutWithLines(prepareWithSegments('a po\u00ADd', FONT), width, LINE_HEIGHT).lines.map(line => line.text.trimEnd()))
          .toEqual(['a', 'pod'])
      }

      // A soft hyphen that starts the text right after an atomic item breaks there with
      // its hyphen where that fits. Where it doesn't, the line returns to the break
      // after the item, in every engine's return.
      const chip = [{ text: 'ab ', font: FONT }, { text: 'xy', font: FONT, break: 'never' as const }, { text: '\u00ADcd ef', font: FONT }]
      const chipHyphenFits = measureWidth('xy-', FONT)
      for (const unfitHyphenRetreat of ['reduced-width', 'full-width', 'full-width-or-first'] as const) {
        profile.unfitHyphenRetreat = unfitHyphenRetreat
        expect(lineTexts(chip, chipHyphenFits - 0.1)).toEqual(['ab', 'xy', 'cd', 'ef'])
        expect(lineTexts(chip, chipHyphenFits)).toEqual(['ab', 'xy-', 'cd', 'ef'])
      }

      // A soft hyphen that ends an item right before an atomic item needs room for its hyphen
      // in Blink and Gecko, whose line returns to the space. WebKit never tests that hyphen, so
      // its line ends there with the hyphen past its width.
      const beforeChip = [{ text: 'ab cd\u00AD', font: FONT }, { text: 'xyz', font: FONT, break: 'never' as const }]
      const bare = measureWidth('ab cd', FONT) + 0.1
      const tested = profile.testsHyphenBeforeAtomic
      try {
        for (const [unfitHyphenRetreat, tests, expected] of [
          ['reduced-width', true, ['ab', 'cd-', 'xyz']],
          ['full-width', true, ['ab', 'cd-', 'xyz']],
          ['full-width-or-first', false, ['ab cd-', 'xyz']],
        ] as const) {
          profile.unfitHyphenRetreat = unfitHyphenRetreat
          profile.testsHyphenBeforeAtomic = tests
          expect({ unfitHyphenRetreat, lines: lineTexts(beforeChip, bare) }).toEqual({ unfitHyphenRetreat, lines: [...expected] })
        }
      } finally {
        profile.testsHyphenBeforeAtomic = tested
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

  test('rich items under keep-all break where their text in one node does, and WebKit reads each item boundary alone', () => {
    type Items = Parameters<typeof prepareRichInline>[0]
    // Each line's text, with a space for a gap.
    const richLines = (items: Items, width: number, wordBreak: 'normal' | 'keep-all' = 'keep-all', whiteSpace: 'normal' | 'pre-wrap' = 'normal') => {
      const prepared = prepareRichInline(items, { wordBreak, whiteSpace })
      const lines: string[] = []
      walkRichInlineLineRanges(prepared, width, range => {
        lines.push(materializeRichInlineLineRange(prepared, range).fragments.map(fragment => (fragment.gapItemIndex < 0 ? '' : ' ') + fragment.text).join('').trimEnd())
      })
      expect(measureRichInlineStats(prepared, width).lineCount).toBe(lines.length)
      return lines
    }
    const flatLines = (items: Items, width: number, wordBreak: 'normal' | 'keep-all' = 'keep-all', whiteSpace: 'normal' | 'pre-wrap' = 'normal') =>
      layoutWithLines(prepareWithSegments(items.map(item => item.text).join(''), FONT, { wordBreak, whiteSpace }), width, LINE_HEIGHT).lines.map(line => line.text.trimEnd())
    // The fake Canvas measures bold as regular, so same-size runs lay out as one node would.
    const BOLD = '700 16px Test Sans'
    const wide = measureWidth('\u4E2D', FONT)
    // A Korean chat message with a bold run inside a word, and Chinese split inside a word.
    const korean: Items = [{ text: '\uBBFC\uC218 \uC528, \uC624\uB298 ', font: FONT }, { text: '\uD68C\uC758', font: BOLD }, { text: '\uB294 \uC138\uC2DC\uC5D0 \uC2DC\uC791\uD569\uB2C8\uB2E4', font: FONT }]
    const chinese: Items = [{ text: '\u4E2D\u6587\u5B57', font: FONT }, { text: '\u4F53\u6392\u7248', font: BOLD }, { text: '\u6D4B\u8BD5\u6587\u672C', font: FONT }]
    // A run that ends an item with a full stop, after which one text node breaks.
    const stop: Items = [{ text: '\u65E5\u672C\u8A9E\u306E', font: FONT }, { text: '\u30C6\u30AD\u30B9\u30C8\u3067\u3059\u3002', font: BOLD }, { text: '\u6B21\u306E\u6587\u3067\u3059', font: FONT }]
    // A mention chip inside Korean words.
    const chip: Items = [{ text: '\uC548\uB155', font: FONT }, { text: '@\uBBFC\uC218', font: '700 12px Test Sans', break: 'never', extraWidth: 24 }, { text: '\uB2D8 \uBC18\uAC00\uC6CC\uC694', font: FONT }]
    const chipWidth = measureWidth('@\uBBFC\uC218', '700 12px Test Sans') + 24
    // A Korean message as an editor holds it, with two spaces after the comma, a line feed
    // after the bold word's ending and two more spaces inside the last item. The bold word
    // ends inside its line's text, so only keep-all keeps the ending after it.
    const preserved: Items = [{ text: '\uBBFC\uC218 \uC528,  \uC624\uB298 ', font: FONT }, { text: '\uD68C\uC758', font: BOLD }, { text: '\uC5D0\uC11C\uB294\n\uC138 \uAC00\uC9C0\uB97C  \uC815\uD569\uB2C8\uB2E4', font: FONT }]
    const profile = getEngineProfile()
    const previous = { lineBreakScan: profile.lineBreakScan }
    try {
      for (const scan of ['blink', 'webkit', 'gecko'] as const) {
        profile.lineBreakScan = scan
        clearCache()
        // Keep-all breaks the Korean only at its spaces and the Chinese nowhere, and the
        // items across their edges as one node, at every width a syllable fits. Without it,
        // Korean breaks between syllables.
        for (let width = wide; width <= 26 * wide; width += wide / 4) {
          for (const items of [korean, chinese]) expect({ scan, width, lines: richLines(items, width) }).toEqual({ scan, width, lines: flatLines(items, width) })
          if (scan !== 'webkit') expect({ scan, width, lines: richLines(stop, width) }).toEqual({ scan, width, lines: flatLines(stop, width) })
          // Keep-all and pre-wrap together, as prepare() takes them together: the items break as
          // their text in one keep-all pre-wrap node.
          expect({ scan, width, lines: richLines(preserved, width, 'keep-all', 'pre-wrap') }).toEqual({ scan, width, lines: flatLines(preserved, width, 'keep-all', 'pre-wrap') })
        }
        expect(richLines(preserved, 5 * wide + 0.1, 'keep-all', 'pre-wrap')).toEqual(['\uBBFC\uC218 \uC528,', '\uC624\uB298', '\uD68C\uC758\uC5D0\uC11C\uB294', '\uC138 \uAC00\uC9C0\uB97C', '\uC815\uD569\uB2C8\uB2E4'])
        expect(richLines(preserved, 5 * wide + 0.1, 'normal', 'pre-wrap')).not.toEqual(richLines(preserved, 5 * wide + 0.1, 'keep-all', 'pre-wrap'))
        expect(richLines(korean, 5 * wide + 0.1)).toEqual(['\uBBFC\uC218 \uC528,', '\uC624\uB298', '\uD68C\uC758\uB294', '\uC138\uC2DC\uC5D0', '\uC2DC\uC791\uD569\uB2C8\uB2E4'])
        expect(richLines(korean, 5 * wide + 0.1, 'normal')).toEqual(flatLines(korean, 5 * wide + 0.1, 'normal'))
        expect(richLines(korean, 5 * wide + 0.1, 'normal')).not.toEqual(richLines(korean, 5 * wide + 0.1))
        // Keep-all breaks after the full stop in one text in all three engines, but WebKit's
        // check at an item boundary reads only the next item's text (getWebKitBreakBetweenItems),
        // so there the run goes on into the next item, and a line that can't take it all
        // breaks it between graphemes.
        const width = 12 * wide + 0.1
        expect(flatLines(stop, width)).toEqual(['\u65E5\u672C\u8A9E\u306E\u30C6\u30AD\u30B9\u30C8\u3067\u3059\u3002', '\u6B21\u306E\u6587\u3067\u3059'])
        expect(richLines(stop, width)).toEqual(scan === 'webkit'
          ? ['\u65E5\u672C\u8A9E\u306E\u30C6\u30AD\u30B9\u30C8\u3067\u3059\u3002\u6B21', '\u306E\u6587\u3067\u3059']
          : flatLines(stop, width))
        // An atomic item still breaks on both sides under keep-all, and the words around
        // it stay whole where they fit.
        expect(richLines(chip, 2 * wide + chipWidth - 0.1)).toEqual(['\uC548\uB155', '@\uBBFC\uC218\uB2D8', '\uBC18\uAC00\uC6CC\uC694'])
        expect(richLines(chip, chipWidth + wide - 0.1)).toEqual(['\uC548\uB155', '@\uBBFC\uC218', '\uB2D8', '\uBC18\uAC00\uC6CC\uC694'])
      }
    } finally {
      Object.assign(profile, previous)
      clearCache()
    }
  })

  test('rich items in pre-wrap lay out as their text in one pre-wrap node, in each engine', () => {
    type Items = RichInlineItem[]
    const preWrap = { whiteSpace: 'pre-wrap' } as const
    // Each line's text and width, and that its fragments add up to it.
    const richLines = (items: Items, width: number) => {
      const prepared = prepareRichInline(items, preWrap)
      const lines: Array<[string, number]> = []
      walkRichInlineLineRanges(prepared, width, range => {
        const line = materializeRichInlineLineRange(prepared, range)
        let sum = 0
        for (const fragment of line.fragments) {
          expect(fragment.gapBefore).toBe(0)
          expect(fragment.occupiedWidth).toBeGreaterThanOrEqual(items[fragment.itemIndex]!.extraWidth ?? 0)
          sum += fragment.occupiedWidth
        }
        expect(sum).toBeCloseTo(line.width, 9)
        lines.push([line.fragments.map(fragment => fragment.text).join(''), Math.round(line.width * 1e6) / 1e6])
      })
      expect(measureRichInlineStats(prepared, width).lineCount).toBe(lines.length)
      return lines
    }
    const flatLines = (items: Items, width: number) =>
      layoutWithLines(prepareWithSegments(items.map(item => item.text).join(''), FONT, preWrap), width, LINE_HEIGHT).lines
        .map((line): [string, number] => [line.text, Math.round(line.width * 1e6) / 1e6])
    // The fake Canvas measures bold as regular, so same-size runs lay out as one node would.
    const BOLD = '700 16px Test Sans'
    const rows: Items[] = [
      // Preserved spaces at an item's end and start, and in an item of their own, which hang
      // across the style change where the line wraps.
      [{ text: 'Ship it   ', font: FONT }, { text: 'today', font: BOLD }, { text: ' and', font: FONT }, { text: '   then', font: BOLD }, { text: ' more words', font: FONT }],
      [{ text: 'one  ', font: FONT }, { text: '  ', font: BOLD }, { text: 'two three', font: FONT }],
      // A line that returns to a break right after spaces that go on from the item before.
      [{ text: 'foo   ', font: FONT }, { text: '  bar', font: BOLD }, { text: 'baz more', font: FONT }],
      // WebKit breaks next to preserved spaces, as before `!` after them, where UAX #14 doesn't.
      [{ text: 'say it ', font: FONT }, { text: '!ok', font: BOLD }, { text: ' now', font: FONT }],
      // Line feeds at an item's end, its start and alone, a blank line across items, and a
      // line feed at the paragraph's start and end.
      [{ text: 'first line\n', font: FONT }, { text: 'second', font: BOLD }, { text: ' line', font: FONT }, { text: '\nthird', font: BOLD }, { text: '\n', font: FONT }, { text: 'four', font: BOLD }],
      [{ text: '\na b\n', font: FONT }, { text: '\nc d\n', font: BOLD }],
      // Spaces before a line feed in the next item, and at the paragraph's end in their own item,
      // which hang only where they don't fit.
      [{ text: 'words   ', font: FONT }, { text: '\nnext', font: BOLD }, { text: ' end', font: FONT }, { text: '      ', font: BOLD }],
      // Tab stops across items count from the line's start.
      [{ text: 'col\t', font: FONT }, { text: '\tcol two', font: BOLD }, { text: '\tthree\t', font: FONT }, { text: ' x', font: BOLD }],
      // A carriage return that ends an item and a line feed that starts the next make one hard break.
      [{ text: 'first\r', font: FONT }, { text: '\nsecond\r', font: BOLD }, { text: '\n\nthird', font: FONT }],
    ]
    const profile = getEngineProfile()
    const previous = { ...profile }
    try {
      for (const scan of ['blink', 'webkit', 'gecko'] as const) {
        profile.lineBreakScan = scan
        profile.hangTabs = scan !== 'gecko'
        Object.assign(profile, TAB_FIELDS[scan])
        clearCache()
        for (const items of rows) {
          for (let width = 4; width <= 320; width += 3.7) expect({ scan, width, lines: richLines(items, width) }).toEqual({ scan, width, lines: flatLines(items, width) })
        }
        // The spaces after `one` hang on its line whichever item holds them, and nothing
        // else from them goes to the next line.
        const round = (value: number) => Math.round(value * 1e6) / 1e6
        expect(richLines(rows[1]!, measureWidth('three', FONT) + 1)).toEqual([['one    ', round(measureWidth('one', FONT))], ['two ', round(measureWidth('two', FONT))], ['three', round(measureWidth('three', FONT))]])
      }
    } finally {
      Object.assign(profile, previous)
      clearCache()
    }
  })

  test('rich pre-wrap tab stops count from the line\'s start, at eight of the item\'s own spaces', () => {
    const LARGE = '24px Test Sans'
    const stop = 8 * measureWidth(' ', FONT)
    const abc = measureWidth('abc', LARGE)
    const x = measureWidth('x', FONT)
    const width = (items: Parameters<typeof prepareRichInline>[0]) => {
      const prepared = prepareRichInline(items, { whiteSpace: 'pre-wrap' })
      const widths: number[] = []
      walkRichInlineLineRanges(prepared, 1000, range => { widths.push(range.width) })
      return widths
    }
    // `abc` in 24px ends past the first stop of the 16px item, so its tab ends at the second.
    expect(abc).toBeGreaterThan(stop)
    expect(width([{ text: 'abc', font: LARGE }, { text: '\tx', font: FONT }])[0]).toBeCloseTo(2 * stop + x, 9)
    // An item's text starts after half its extraWidth, its start edge; the end edge follows its text.
    expect(width([{ text: 'abc', font: LARGE }, { text: '\tx', font: FONT, extraWidth: 10 }])[0]).toBeCloseTo(2 * stop + x + 5, 9)
    // A tab on a line of its own after a wrap counts from that line's start.
    expect(width([{ text: 'abc ', font: LARGE }, { text: 'x\t\tx', font: FONT }]).length).toBe(1)
    const wrapped = prepareRichInline([{ text: 'abc ', font: LARGE }, { text: 'x\tx', font: FONT }], { whiteSpace: 'pre-wrap' })
    const lines: number[] = []
    walkRichInlineLineRanges(wrapped, abc + 10, range => { lines.push(range.width) })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBeCloseTo(abc, 9)
    expect(lines[1]).toBeCloseTo(stop + x, 9)
    // A tab that starts a line inside a padded item comes after the start edge that line paints.
    const padded = width([{ text: 'x\n\tx', font: FONT, extraWidth: 10 }])
    expect(padded).toHaveLength(2)
    expect(padded[1]).toBeCloseTo(stop + x + 5, 9)
    // A tab's stops count its own item's letter spacing in each space, here as Blink counts it,
    // whether the items share a letter spacing or differ: the lines differ only by the last
    // item's own gap.
    const shared = width([{ text: 'x\tx', font: FONT, letterSpacing: 2 }, { text: 'x', font: FONT, letterSpacing: 2 }])
    const differ = width([{ text: 'x\tx', font: FONT, letterSpacing: 2 }, { text: 'x', font: FONT, letterSpacing: 1 }])
    expect(shared[0]).toBeCloseTo(8 * (measureWidth(' ', FONT) + 2) + x + 2 + x + 2, 9)
    expect(differ[0]).toBeCloseTo(shared[0]! - 1, 9)
  })

  test('rich pre-wrap lines leave out the spaces that hang at their end, across items, from their fragments too', () => {
    const BOLD = '700 16px Test Sans'
    const foo = measureWidth('foo', FONT)
    const space = measureWidth(' ', FONT)
    const lines = (items: Parameters<typeof prepareRichInline>[0], width: number) => {
      const prepared = prepareRichInline(items, { whiteSpace: 'pre-wrap' })
      const out: Array<{ width: number; fragments: Array<[string, number]> }> = []
      walkRichInlineLineRanges(prepared, width, range => {
        const line = materializeRichInlineLineRange(prepared, range)
        out.push({ width: Math.round(line.width * 1e6) / 1e6, fragments: line.fragments.map(f => [f.text, Math.round(f.occupiedWidth * 1e6) / 1e6]) })
      })
      return out
    }
    const round = (value: number) => Math.round(value * 1e6) / 1e6
    // Where the line wraps, all of the run hangs, and a padded item's extraWidth doesn't: the line
    // paints the edges of a padded item of only white space, or of one that starts with white space
    // after a word's own, though Blink fits none of them (getOpeningFit in rich-inline.ts), so the
    // run hangs past a line they overflow.
    expect(lines([{ text: 'foo  ', font: FONT }, { text: '  ', font: BOLD, extraWidth: 6 }, { text: 'bar', font: FONT }], foo + 7)).toEqual([
      { width: round(foo + 6), fragments: [['foo  ', round(foo)], ['  ', 6]] },
      { width: round(measureWidth('bar', FONT)), fragments: [['bar', round(measureWidth('bar', FONT))]] },
    ])
    expect(lines([{ text: 'foo  ', font: FONT }, { text: '  ', font: BOLD, extraWidth: 6 }, { text: 'bar', font: FONT }], foo + 1)[0]).toEqual(
      { width: round(foo + 6), fragments: [['foo  ', round(foo)], ['  ', 6]] },
    )
    expect(lines([{ text: 'foo  ', font: FONT }, { text: ' x', font: BOLD, extraWidth: 6 }, { text: ' bar', font: FONT }], foo + 7)[0]).toEqual(
      { width: round(foo + 6), fragments: [['foo  ', round(foo)], [' ', 6]] },
    )
    // Such an edge is no character: under letter spacing it follows the gap after the glyph before
    // it, and leaves none after itself, so none where it starts a line.
    expect(lines([{ text: 'foo', font: FONT, letterSpacing: 2 }, { text: ' ', font: FONT, letterSpacing: 2, extraWidth: 6 }], foo + 7)).toEqual([
      { width: round(foo + 3 * 2 + 6), fragments: [['foo', round(foo + 3 * 2)], [' ', 6]] },
    ])
    expect(lines([{ text: 'foo\n', font: FONT, letterSpacing: 2 }, { text: '  ', font: FONT, letterSpacing: 2, extraWidth: 6 }], Infinity)[1]).toEqual(
      { width: round(6 + 2 * space + 2 * 2), fragments: [['  ', round(6 + 2 * space + 2 * 2)]] },
    )
    // Where the line goes on into the item, the edges count once, with the white space after them.
    expect(lines([{ text: 'foo  ', font: FONT }, { text: ' x', font: BOLD, extraWidth: 6 }], Infinity)).toEqual([
      { width: round(foo + 2 * space + 6 + measureWidth(' x', BOLD)), fragments: [['foo  ', round(foo + 2 * space)], [' x', round(6 + measureWidth(' x', BOLD))]] },
    ])
    expect(lines([{ text: 'foo  ', font: FONT, extraWidth: 6 }, { text: '  ', font: BOLD }, { text: 'bar', font: FONT }], foo + 7)[0]).toEqual(
      { width: round(foo + 6), fragments: [['foo  ', round(foo + 6)], ['  ', 0]] },
    )
    // At the paragraph's end and before a hard break, only what doesn't fit hangs, from the last fragment first.
    const width = foo + 3.5 * space
    expect(lines([{ text: 'foo  ', font: FONT }, { text: '     ', font: BOLD }], width)).toEqual([
      { width: round(width), fragments: [['foo  ', round(foo + 2 * space)], ['     ', round(1.5 * space)]] },
    ])
    expect(lines([{ text: 'foo  ', font: FONT }, { text: '     \nbar', font: BOLD }], width)[0]).toEqual(
      { width: round(width), fragments: [['foo  ', round(foo + 2 * space)], ['     ', round(1.5 * space)]] },
    )
    // A line that wraps inside an item after a run that starts in the item before.
    expect(lines([{ text: 'foo   ', font: FONT }, { text: '  bar baz', font: BOLD }], foo + space)[0]).toEqual(
      { width: round(foo), fragments: [['foo   ', round(foo)], ['  ', 0]] },
    )
  })

  test('a line that trails overflowing spaces takes a padded opening after them with no fit in the Chromium profile', () => {
    const BOLD = '700 16px Test Sans'
    const foo = measureWidth('foo', FONT)
    const boldSpace = measureWidth(' ', BOLD)
    const round = (value: number) => Math.round(value * 1e6) / 1e6
    const lines = (items: Parameters<typeof prepareRichInline>[0], width: number) => {
      const prepared = prepareRichInline(items, { whiteSpace: 'pre-wrap' })
      const out: Array<{ width: number; fragments: Array<[string, number]> }> = []
      walkRichInlineLineRanges(prepared, width, range => {
        const line = materializeRichInlineLineRange(prepared, range)
        out.push({ width: round(line.width), fragments: line.fragments.map(f => [f.text, round(f.occupiedWidth)]) })
      })
      expect(measureRichInlineStats(prepared, width).lineCount).toBe(out.length)
      return out
    }
    const texts = (items: Parameters<typeof prepareRichInline>[0], width: number) => lines(items, width).map(line => line.fragments.map(f => f[0]).join('|'))
    const profile = getEngineProfile()
    const previous = profile.paddedOpeningFit
    try {
      // Spaces that are a span of their own follow no text in their item, so Chrome fits the start edge
      // of a padded span after them where they fit. Once they overflow, its line trails: it takes the
      // white space after them and the tags that open among it with no fit, and still paints the edge.
      // Chrome lays out `Some words`, a bold `  `, an 8px-padded `  indented code` and ` tail` in 16px
      // Arial at 92px as 3 lines, the first one through the padded span's spaces.
      const padded = [{ text: 'foo', font: FONT }, { text: '  ', font: BOLD }, { text: '  bar', font: FONT, extraWidth: 40 }]
      profile.paddedOpeningFit = 'start'
      expect(lines(padded, foo + 1)[0]).toEqual({ width: round(foo + 40), fragments: [['foo', round(foo)], ['  ', 0], ['  ', 40]] })
      expect(lines(padded, foo + 2 * boldSpace - 1)[0]).toEqual({ width: round(foo + 40), fragments: [['foo', round(foo)], ['  ', 0], ['  ', 40]] })
      expect(texts(padded, foo + 2 * boldSpace + 19)[0]).toBe('foo|  ')
      expect(lines(padded, foo + 2 * boldSpace + 21)[0]).toEqual({ width: round(foo + 2 * boldSpace + 40), fragments: [['foo', round(foo)], ['  ', round(2 * boldSpace)], ['  ', 40]] })
      // The same before a padded line feed, which ends the line.
      expect(texts([{ text: 'foo', font: FONT }, { text: '  ', font: BOLD }, { text: '\nbar', font: FONT, extraWidth: 40 }], foo + 1)[0]).toBe('foo|  |')
      // Safari and Firefox fit the edges they fit after the spaces, however far those overflow.
      for (const fit of ['placed', 'both'] as const) {
        profile.paddedOpeningFit = fit
        expect(texts(padded, foo + 1)[0]).toBe('foo|  ')
      }
    } finally {
      profile.paddedOpeningFit = previous
    }
  })

  test('spaces after a line feed follow no text, so the Chromium profile fits a padded opening after them by its start edge', () => {
    const space = measureWidth(' ', FONT)
    const texts = (items: Parameters<typeof prepareRichInline>[0], width: number) => {
      const prepared = prepareRichInline(items, { whiteSpace: 'pre-wrap' })
      const out: string[] = []
      walkRichInlineLineRanges(prepared, width, range => {
        out.push(materializeRichInlineLineRange(prepared, range).fragments.map(f => f.text).join('|'))
      })
      expect(measureRichInlineStats(prepared, width).lineCount).toBe(out.length)
      return out
    }
    const profile = getEngineProfile()
    const previous = profile.paddedOpeningFit
    try {
      profile.paddedOpeningFit = 'start'
      // Blink ends a text item at a line feed, so the spaces after one are a text item with no text
      // before them, and a line that ends with them doesn't trail into the padded span after them: the
      // span's start edge, half its extraWidth, is fitted after the spaces, and where it doesn't fit
      // the span starts the next line. Chrome lays out `ab\n  ` and a 6px-padded `\ncd` in 16px Arial
      // at 9-14.5px as 6 lines, the spaces on a line of their own, and at 15-17.5px, where the spaces
      // and the 6px start edge fit, as 5. A lone CR is a line feed to the analysis.
      for (const before of ['a\n  ', 'a\r  ']) {
        const items = [{ text: before, font: FONT }, { text: '\nb', font: FONT, extraWidth: 8 }]
        expect(texts(items, 2 * space + 5)).toEqual(['a', '  |', 'b'])
        expect(texts(items, 2 * space + 3)).toEqual(['a', '  ', '', 'b'])
      }
      // Spaces after text in their item, a ZWNJ too, which Blink keeps as text, trail into the span
      // however far its edge overflows.
      for (const [before, line] of [['a  ', 'a  '], ['a\u200C  ', 'a\u200C  '], ['a\nc  ', 'c  ']] as const) {
        const items = [{ text: before, font: FONT }, { text: '\nb', font: FONT, extraWidth: 8 }]
        expect(texts(items, measureWidth(line.trimEnd(), FONT) + 1).slice(-2)).toEqual([line + '|', 'b'])
      }
    } finally {
      profile.paddedOpeningFit = previous
    }
  })

  test('no line ends inside a run of preserved spaces that goes on across items, but in the WebKit profile', () => {
    const BOLD = '700 16px Test Sans'
    const boldSpace = measureWidth(' ', BOLD)
    const texts = (items: Parameters<typeof prepareRichInline>[0], width: number) => {
      const prepared = prepareRichInline(items, { whiteSpace: 'pre-wrap' })
      const out: string[] = []
      walkRichInlineLineRanges(prepared, width, range => {
        out.push(materializeRichInlineLineRange(prepared, range).fragments.map(f => f.text).join('|'))
      })
      expect(measureRichInlineStats(prepared, width).lineCount).toBe(out.length)
      return out
    }
    const profile = getEngineProfile()
    const previous = { paddedOpeningFit: profile.paddedOpeningFit, lineBreakScan: profile.lineBreakScan }
    try {
      // A run of preserved spaces goes on across items with no break inside it (UAX #14 LB7), so where the
      // start edge of a padded span that the run goes into doesn't fit, the line returns to the break
      // before the word: Chrome and Firefox lay out `Some words`, a bold `  `, an italic ` `, an
      // 8px-padded ` x y` and ` tail` in 16px Arial at 103px as `Some `, then `words` through `y`.
      // WebKit finds a break next to each white-space item, so there the line ends between two.
      const run = [{ text: 'foo bar', font: FONT }, { text: '  ', font: BOLD }, { text: ' ', font: BOLD }, { text: ' x', font: FONT, extraWidth: 40 }]
      const width = measureWidth('foo bar', FONT) + 3 * boldSpace + 1
      profile.paddedOpeningFit = 'start'
      expect(texts(run, width)).toEqual(['foo ', 'bar|  | | ', 'x'])
      profile.paddedOpeningFit = 'both'
      expect(texts(run, width)).toEqual(['foo ', 'bar|  | ', ' x'])
      profile.lineBreakScan = 'webkit'
      profile.paddedOpeningFit = 'placed'
      clearCache()
      expect(texts(run, width)).toEqual(['foo bar|  | ', ' x'])
    } finally {
      profile.paddedOpeningFit = previous.paddedOpeningFit
      profile.lineBreakScan = previous.lineBreakScan
      clearCache()
    }
  })

  test('a padded rich item that starts with a zero-width space fits its start edge before it', () => {
    const round = (value: number) => Math.round(value * 1e6) / 1e6
    const lines = (items: Parameters<typeof prepareRichInline>[0], width: number) => {
      const prepared = prepareRichInline(items)
      const out: Array<{ width: number; fragments: Array<[number, string, number]> }> = []
      walkRichInlineLineRanges(prepared, width, range => {
        const line = materializeRichInlineLineRange(prepared, range)
        out.push({ width: round(line.width), fragments: line.fragments.map(f => [f.itemIndex, f.text, round(f.occupiedWidth)]) })
      })
      expect(measureRichInlineStats(prepared, width).lineCount).toBe(out.length)
      return out
    }
    const some = measureWidth('some', FONT)
    const space = measureWidth(' ', FONT)
    const pad = measureWidth('pad', FONT)
    const items = [{ text: 'some ', font: FONT }, { text: '\u200Bpad', font: FONT, extraWidth: 16 }]
    const profile = getEngineProfile()
    const previous = profile.paddedOpeningFit
    try {
      for (const fit of ['start', 'placed', 'both'] as const) {
        profile.paddedOpeningFit = fit
        // A line that takes the zero-width space and no more of the item fits the edges the engine fits
        // there, half the extraWidth in Chrome and Safari and all of it in Firefox, and paints all of it:
        // in 16px Arial, `some ` and an 8px-padded U+200B `padded words` at 54px keep the zero-width
        // space on the first line in Chrome and Safari, and Firefox gives it a line of its padding.
        const edge = fit === 'both' ? 16 : 8
        expect(lines(items, some + space + edge)).toEqual([
          { width: round(some + space + 16), fragments: [[0, 'some', round(some)], [1, '\u200B', 16]] },
          { width: round(pad + 16), fragments: [[1, 'pad', round(pad + 16)]] },
        ])
        // Where that edge doesn't fit, the line ends before the item.
        expect(lines(items, some + space + edge - 1)).toEqual([
          { width: round(some), fragments: [[0, 'some', round(some)]] },
          { width: round(pad + 16), fragments: [[1, '\u200Bpad', round(pad + 16)]] },
        ])
        // A line that goes on into the item counts the extraWidth once.
        expect(lines(items, some + space + 16 + pad)).toEqual([
          { width: round(some + space + 16 + pad), fragments: [[0, 'some', round(some)], [1, '\u200Bpad', round(16 + pad)]] },
        ])
      }
    } finally {
      profile.paddedOpeningFit = previous
    }
  })

  test('a padded rich item that starts with a line feed returns its line to a break, or else starts the next line, and a blank line is one empty fragment', () => {
    const round = (value: number) => Math.round(value * 1e6) / 1e6
    const lines = (items: Parameters<typeof prepareRichInline>[0], width: number) => {
      const prepared = prepareRichInline(items, { whiteSpace: 'pre-wrap' })
      const out: Array<{ width: number; fragments: Array<[number, string, number]> }> = []
      walkRichInlineLineRanges(prepared, width, range => {
        const line = materializeRichInlineLineRange(prepared, range)
        out.push({ width: round(line.width), fragments: line.fragments.map(f => [f.itemIndex, f.text, round(f.occupiedWidth)]) })
      })
      return out
    }
    const texts = (items: Parameters<typeof prepareRichInline>[0], width: number) => lines(items, width).map(line => line.fragments.map(f => f[1]).join('|'))
    const foo = measureWidth('foo', FONT)
    const bar = measureWidth('bar', FONT)
    const baz = measureWidth('baz', FONT)
    // Where the padding of a span that starts with a line feed doesn't fit, the line returns to
    // its break before `foo`, as Chrome, Firefox and Safari return a padded span's line.
    const words = measureWidth('foo foo', FONT)
    expect(texts([{ text: 'foo foo', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], words + 5)).toEqual(['foo ', 'foo|', 'bar'])
    // With no break to return to, the line ends before the span, as Blink's retry of an
    // overflowing line breaks between any two graphemes, and the span's line feed makes a line
    // of its padding. Without padding, the line keeps the line feed, as no line ends before
    // one (UAX #14 LB6).
    const foofoo = measureWidth('foofoo', FONT)
    expect(lines([{ text: 'foofoo', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], foofoo + 5)).toEqual([
      { width: round(foofoo), fragments: [[0, 'foofoo', round(foofoo)]] },
      { width: 15, fragments: [[1, '', 15]] },
      { width: round(bar + 15), fragments: [[1, 'bar', round(bar + 15)]] },
    ])
    expect(texts([{ text: 'foo', font: FONT }, { text: '\nbar', font: FONT }], 1)).toEqual(['f', 'o', 'o|', 'b', 'a', 'r'])
    expect(texts([{ text: 'foofo', font: FONT }, { text: 'o', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], foofoo + 5)).toEqual(['foofo|o', '', 'bar'])
    // A blank line inside a padded item is as wide as the item's extraWidth, which its empty
    // fragment paints, and so is a line that holds only the item's spaces, which hang.
    expect(lines([{ text: 'foo\n\nbar', font: FONT, extraWidth: 15 }], 1000)).toEqual([
      { width: round(foo + 15), fragments: [[0, 'foo', round(foo + 15)]] },
      { width: 15, fragments: [[0, '', 15]] },
      { width: round(bar + 15), fragments: [[0, 'bar', round(bar + 15)]] },
    ])
    expect(lines([{ text: 'foo\n  ', font: FONT, extraWidth: 15 }, { text: 'foofoo', font: FONT }], foofoo + 5)).toEqual([
      { width: round(foo + 15), fragments: [[0, 'foo', round(foo + 15)]] },
      { width: 15, fragments: [[0, '  ', 15]] },
      { width: round(foofoo), fragments: [[1, 'foofoo', round(foofoo)]] },
    ])
    // WebKit and Gecko end that line before the last grapheme of the text before the span, and
    // keep the span on a line that grapheme starts.
    const profile = getEngineProfile()
    const previous = profile.hardBreakItemRetreat
    try {
      profile.hardBreakItemRetreat = 'last-grapheme'
      const foofo = measureWidth('foofo', FONT)
      expect(lines([{ text: 'foofoo', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], foofoo + 5)).toEqual([
        { width: round(foofo), fragments: [[0, 'foofo', round(foofo)]] },
        { width: round(foofoo - foofo + 15), fragments: [[0, 'o', round(foofoo - foofo)], [1, '', 15]] },
        { width: round(bar + 15), fragments: [[1, 'bar', round(bar + 15)]] },
      ])
      expect(texts([{ text: 'foo', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], 1)).toEqual(['f', 'o', 'o|', 'b', 'a', 'r'])
      const o = measureWidth('o', FONT)
      expect(texts([{ text: 'foo', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], o + 1)).toEqual(['f', 'o', 'o|', 'b', 'a', 'r'])
      // Where that grapheme is a segment of its own, as an item of one grapheme is, the line
      // ends before it, unless it starts the line.
      expect(lines([{ text: 'foofo', font: FONT }, { text: 'o', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], foofoo + 5)).toEqual([
        { width: round(foofo), fragments: [[0, 'foofo', round(foofo)]] },
        { width: round(o + 15), fragments: [[1, 'o', round(o)], [2, '', 15]] },
        { width: round(bar + 15), fragments: [[2, 'bar', round(bar + 15)]] },
      ])
      const close = measureWidth(')', FONT)
      expect(lines([{ text: 'foo ', font: FONT }, { text: ')', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], measureWidth('foo )', FONT) + 5)).toEqual([
        { width: round(foo), fragments: [[0, 'foo ', round(foo)]] },
        { width: round(close + 15), fragments: [[1, ')', round(close)], [2, '', 15]] },
        { width: round(bar + 15), fragments: [[2, 'bar', round(bar + 15)]] },
      ])
      expect(texts([{ text: 'fo', font: FONT }, { text: 'o', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], o + 1)).toEqual(['f', 'o', 'o|', 'b', 'a', 'r'])
      // A line with a break returns to it.
      expect(texts([{ text: 'foo foofo', font: FONT }, { text: 'o', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], measureWidth('foo foofoo', FONT) + 5)).toEqual(['foo ', 'foofo|o|', 'bar'])
      // The grapheme takes its letter spacing with it.
      const spaced = (text: string) => measureRichInlineStats(prepareRichInline([{ text, font: FONT, letterSpacing: 2 }], { whiteSpace: 'pre-wrap' }), 1000).maxLineWidth
      expect(lines([{ text: 'foofoo', font: FONT, letterSpacing: 2 }, { text: '\nbar', font: FONT, extraWidth: 15 }], spaced('foofoo') + 5)[0]!.width).toBe(round(spaced('foofo')))
      // An item of two graphemes keeps its first on the line.
      expect(texts([{ text: 'foof', font: FONT }, { text: 'oo', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], foofoo + 5)).toEqual(['foof|o', 'o|', 'bar'])
    } finally {
      profile.hardBreakItemRetreat = previous
    }
    // After preserved spaces, which hang, Chrome keeps the line feed where the text before them
    // fits; Safari fits the span's start edge without them, else keeps the spaces that fit but
    // for the last, and Firefox fits both edges with them, else moves the last space.
    const previousFit = {
      hardBreakItemRetreat: profile.hardBreakItemRetreat, paddedOpeningFit: profile.paddedOpeningFit,
      emptyAtomicAlwaysFits: profile.emptyAtomicAlwaysFits, hangsSpacesPerTextFrame: profile.hangsSpacesPerTextFrame,
    }
    try {
      const space = measureWidth(' ', FONT)
      for (const [retreat, fit] of [['item', 'start'], ['fit', 'placed'], ['last-grapheme', 'both']] as const) {
        profile.hardBreakItemRetreat = retreat
        profile.paddedOpeningFit = fit
        profile.emptyAtomicAlwaysFits = fit === 'both'
        profile.hangsSpacesPerTextFrame = fit === 'both'
        // The lines up to the one the padded span's line feed ends.
        const head = (items: Parameters<typeof prepareRichInline>[0], width: number) => {
          const out = lines(items, width)
          const end = out.findIndex(line => line.fragments.some(f => f[0] === items.length - 1))
          return out.slice(0, end + 1).map(line => line.fragments.map(f => f[1]).join('|'))
        }
        const feed = (width: number) => head([{ text: 'foo   ', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 40 }], width)
        expect(feed(foo + 0.5 * space)).toEqual(fit === 'start' ? ['foo   |'] : fit === 'placed' ? ['foo', '   |'] : ['foo  ', ' |'])
        expect(feed(foo + 1.5 * space)).toEqual(fit === 'start' ? ['foo   |'] : fit === 'placed' ? ['foo ', '  |'] : ['foo  ', ' |'])
        // The spaces the line keeps hang, from its width and its fragment's.
        if (fit !== 'start') expect(lines([{ text: 'foo   ', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 40 }], foo + 1.5 * space)[0]).toEqual({ width: round(foo), fragments: [[0, fit === 'placed' ? 'foo ' : 'foo  ', round(foo)]] })
        expect(feed(foo + 3 * space + 1)).toEqual(fit === 'start' ? ['foo   |'] : ['foo  ', ' |'])
        expect(feed(foo + 21)).toEqual(fit === 'both' ? ['foo  ', ' |'] : ['foo   |'])
        expect(feed(foo + 3 * space + 41)).toEqual(['foo   |'])
        // Under a letter spacing more negative than a space is wide, the spaces have no advance to
        // give back: Safari's fit gives up all of them, and the walk ends.
        const tight = prepareRichInline([{ text: 'foo   ', font: FONT, letterSpacing: -space - 2, extraWidth: 40 }, { text: '\nbar', font: FONT, extraWidth: 40 }], { whiteSpace: 'pre-wrap' })
        for (const width of [1, 20, 60]) {
          const out: string[] = []
          walkRichInlineLineRanges(tight, width, range => {
            if (out.length === 20) throw new Error(`the walk goes on past 20 lines at ${width}px`)
            out.push(materializeRichInlineLineRange(tight, range).fragments.map(f => f.text).join('|'))
          })
          if (fit === 'placed' && width < 60) expect(out).toEqual(['f', 'o', 'o', '   |', 'b', 'a', 'r'])
        }
        // A space that is all of its item moves with the span; Chrome's return finds no break before
        // it, so there it keeps the line feed only where that space overflows.
        const spaceItem = [{ text: 'foo', font: FONT }, { text: ' ', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 40 }]
        expect(head(spaceItem, foo + space + 1)).toEqual(fit === 'start' ? ['foo| ', ''] : ['foo', ' |'])
        expect(head(spaceItem, foo + 0.5 * space)).toEqual(fit === 'start' ? ['foo| |'] : ['foo', ' |'])
        // Blink gives every run of preserved tabs an item of its own (inline_items_builder.cc:1098-1110),
        // so a tab follows no text: where the tab fits and the span's start edge doesn't, Chrome
        // ends the line before the span, whose line feed and padding make a line of their own.
        const stop = 8 * space
        expect(foo).toBeLessThan(stop)
        if (fit === 'start') expect(head([{ text: 'foo\t', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 40 }], stop + 1)).toEqual(['foo\t', ''])
        // Chrome takes the spaces that start a padded span with no edge too, after spaces that
        // follow text; without spaces before the span, it fits the span's start edge. Safari fits
        // the start edge, and Firefox both edges.
        const first = (items: Parameters<typeof prepareRichInline>[0], width: number) => lines(items, width)[0]!.fragments.map(f => f[1]).join('|')
        expect(first([{ text: 'foo   ', font: FONT }, { text: '  bar', font: FONT, extraWidth: 40 }], foo + 1)).toBe(fit === 'start' ? 'foo   |  ' : 'foo   ')
        // Safari and Firefox count the text's spaces before the edges they fit, and Firefox, with
        // no break before the text's last word, ends the line before the span.
        expect(first([{ text: 'foo   ', font: FONT }, { text: '  bar', font: FONT, extraWidth: 40 }], foo + 41)).toBe(fit === 'both' ? 'foo   ' : 'foo   |  ')
        expect(first([{ text: 'foo', font: FONT }, { text: '  bar', font: FONT, extraWidth: 40 }], foo + 21)).toBe(fit === 'both' ? 'foo' : 'foo|  ')
        expect(first([{ text: 'foo', font: FONT }, { text: '  bar', font: FONT, extraWidth: 40 }], foo + 19)).toBe('foo')
      }
      profile.hardBreakItemRetreat = previousFit.hardBreakItemRetreat
      for (const fit of ['start', 'placed', 'both'] as const) {
        profile.paddedOpeningFit = fit
        // Chrome and Safari fit the start edge only of a span that starts with a line feed, and
        // Safari its end edge too where the span ends at its line feed; Firefox fits both.
        expect(texts([{ text: 'foofoo', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], foofoo + 10)).toEqual(fit === 'both' ? ['foofoo', '', 'bar'] : ['foofoo|', 'bar'])
        expect(texts([{ text: 'foofoo', font: FONT }, { text: '\n', font: FONT, extraWidth: 15 }, { text: 'bar', font: FONT }], foofoo + 10)).toEqual(fit === 'start' ? ['foofoo|', 'bar'] : ['foofoo', '', 'bar'])
      }
      // A line that keeps the opening by the start edge alone still paints the whole extraWidth, past the line's width.
      profile.paddedOpeningFit = 'start'
      expect(lines([{ text: 'foofoo', font: FONT }, { text: '\nbar', font: FONT, extraWidth: 15 }], foofoo + 10)[0]).toEqual({ width: round(foofoo + 15), fragments: [[0, 'foofoo', round(foofoo)], [1, '', 15]] })
    } finally {
      Object.assign(profile, previousFit)
    }
    // A blank line is the next item's line feed, and the line feed that ends the paragraph makes
    // no line: its item gives the last line an empty fragment.
    expect(lines([{ text: 'foo\n', font: FONT }, { text: '\nbaz', font: FONT, extraWidth: 8 }, { text: '\n', font: FONT }], 200)).toEqual([
      { width: round(foo), fragments: [[0, 'foo', round(foo)]] },
      { width: 8, fragments: [[1, '', 8]] },
      { width: round(baz + 8), fragments: [[1, 'baz', round(baz + 8)], [2, '', 0]] },
    ])
  })

  test('rich pre-wrap white space and a line feed after an atomic item stay on its line, however far it overflows, and with padding where the engine fits it', () => {
    const texts = (items: Parameters<typeof prepareRichInline>[0], width: number) => {
      const prepared = prepareRichInline(items, { whiteSpace: 'pre-wrap' })
      const out: string[] = []
      walkRichInlineLineRanges(prepared, width, range => {
        out.push(materializeRichInlineLineRange(prepared, range).fragments.map(f => f.text).join('|'))
      })
      return out
    }
    const alice = { text: '@alice', font: FONT, break: 'never', extraWidth: 20 } as const
    const bob = { text: '@bob', font: FONT, break: 'never', extraWidth: 20 } as const
    const width = measureWidth('@bob', FONT) + 10
    const profile = getEngineProfile()
    const previous = {
      lineBreakScan: profile.lineBreakScan, hangTabs: profile.hangTabs,
      hardBreakItemRetreat: profile.hardBreakItemRetreat, paddedOpeningFit: profile.paddedOpeningFit,
      emptyAtomicAlwaysFits: profile.emptyAtomicAlwaysFits, hangsSpacesPerTextFrame: profile.hangsSpacesPerTextFrame,
    }
    try {
      for (const scan of ['blink', 'webkit', 'gecko'] as const) {
        profile.lineBreakScan = scan
        profile.hangTabs = scan !== 'gecko'
        profile.hardBreakItemRetreat = scan === 'blink' ? 'item' : scan === 'webkit' ? 'fit' : 'last-grapheme'
        profile.paddedOpeningFit = scan === 'blink' ? 'start' : scan === 'webkit' ? 'placed' : 'both'
        profile.emptyAtomicAlwaysFits = scan === 'gecko'
        profile.hangsSpacesPerTextFrame = scan === 'gecko'
        clearCache()
        // No break comes before them (UAX #14 LB6, LB7), and the break after a chip takes them
        // onto its line, as Blink takes trailing items.
        expect(texts([{ text: 'Ping ', font: FONT }, alice, { text: '\n', font: FONT }, bob, { text: '  go', font: FONT }], width)).toEqual(['Ping ', '@alice|', '@bob|  ', 'go'])
        // A tab hangs too where tabs hang.
        expect(texts([bob, { text: '\tgo', font: FONT }], width)[0]).toBe(scan === 'gecko' ? '@bob' : '@bob|\t')
        // So does white space after items of only such white space after the chip, whatever items
        // it spans and whatever their fonts: Blink trails on into the next item and its return keeps
        // every item that starts with trailable spaces, and WebKit hangs each white-space item.
        const space = (text: string, font = FONT) => ({ text, font })
        expect(texts([bob, space(' '), space('  ', `700 ${FONT}`), space('go')], width)).toEqual(['@bob| |  ', 'go'])
        expect(texts([bob, space(' '), space(' '), space(' '), space('go')], width)).toEqual(['@bob| | | ', 'go'])
        expect(texts([bob, space(' '), space('  go')], width)).toEqual(['@bob| |  ', 'go'])
        expect(texts([bob, space(' '), space('\ngo')], width)).toEqual(['@bob| |', 'go'])
        // Firefox breaks only after a run of spaces and tabs and hangs no tab, so it moves white
        // space that runs into a tab to the next line with the tab, whatever items it spans.
        expect(texts([bob, space('  \tgo')], width)).toEqual(scan === 'gecko' ? ['@bob', '  \t', 'go'] : ['@bob|  \t', 'go'])
        expect(texts([bob, space(' '), space('\tgo')], width)).toEqual(scan === 'gecko' ? ['@bob', ' |\t', 'go'] : ['@bob| |\t', 'go'])
        expect(texts([bob, space(' '), space('  \t'), space('go')], width)).toEqual(scan === 'gecko' ? ['@bob', ' |  \t', 'go'] : ['@bob| |  \t', 'go'])
        expect(texts([bob, space(' '), space('  '), space('\tgo')], width)).toEqual(scan === 'gecko' ? ['@bob', ' |  |\t', 'go'] : ['@bob| |  |\t', 'go'])
        // Spaces before text stay, where a tab follows the text too.
        expect(texts([bob, space(' '), space('  go\tx')], width)).toEqual(['@bob| |  ', 'go\t', 'x'])
        // A tab that doesn't hang ends that white space in Firefox: the tab takes the next line,
        // and the spaces after it the one after where the tab overflows it. Text ends it everywhere.
        expect(texts([bob, space('\t'), space('  go')], width)).toEqual(scan === 'gecko' ? ['@bob', '\t|  ', 'go'] : ['@bob|\t|  ', 'go'])
        expect(texts([bob, space('\t'), space('  go')], 8 * measureWidth(' ', FONT) - 1)).toEqual(scan === 'gecko' ? ['@bob', '\t', '  go'] : ['@bob|\t|  ', 'go'])
        expect(texts([bob, space(' x'), space('  go')], width)).toEqual(['@bob| ', 'x|  go'])
        // A padded span that starts with a line feed or spaces stays on the chip's line where the
        // line fits the span's start edge in Chrome and Safari, and all of its padding in Firefox.
        // Otherwise the line ends after the chip, but in Safari before a line feed, which the chip's
        // content goes on to: the line returns to the break before the chip, or keeps the line
        // feed where the chip starts it.
        const line = measureWidth('Ping @alice', FONT) + 20
        const feed = { text: '\nbar', font: FONT, extraWidth: 20 }
        const spaces = { text: '  go', font: FONT, extraWidth: 20 }
        expect(texts([{ text: 'Ping ', font: FONT }, alice, feed], line + 5)).toEqual(scan === 'webkit' ? ['Ping ', '@alice|', 'bar'] : ['Ping |@alice', '', 'bar'])
        expect(texts([{ text: 'Ping ', font: FONT }, alice, feed], line + 15)).toEqual(scan === 'gecko' ? ['Ping |@alice', '', 'bar'] : ['Ping |@alice|', 'bar'])
        expect(texts([{ text: 'Ping ', font: FONT }, alice, feed], line + 25)).toEqual(['Ping |@alice|', 'bar'])
        expect(texts([alice, feed], measureWidth('@alice', FONT) + 25)).toEqual(scan === 'webkit' ? ['@alice|', 'bar'] : ['@alice', '', 'bar'])
        // A chip is one whole: the line never ends inside it.
        const team = { text: '@web team', font: FONT, break: 'never', extraWidth: 20 } as const
        expect(texts([team, feed], measureWidth('@web team', FONT) + 25)).toEqual(scan === 'webkit' ? ['@web team|', 'bar'] : ['@web team', '', 'bar'])
        expect(texts([{ text: 'Ping ', font: FONT }, alice, spaces], line + 5)).toEqual(['Ping |@alice', '  go'])
        expect(texts([{ text: 'Ping ', font: FONT }, alice, spaces], line + 15)).toEqual(scan === 'gecko' ? ['Ping |@alice', '  go'] : ['Ping |@alice|  ', 'go'])
        // Chrome keeps a padded span of only white space on the chip's line however far it
        // overflows, as it trails the break after the chip; Safari and Firefox fit both its edges.
        const blank = { text: '  ', font: FONT, extraWidth: 20 }
        expect(texts([{ text: 'Ping ', font: FONT }, alice, blank, { text: 'go', font: FONT }], line + 5)).toEqual(scan === 'blink' ? ['Ping |@alice|  ', 'go'] : ['Ping |@alice', '  |go'])
        expect(texts([{ text: 'Ping ', font: FONT }, alice, blank, { text: 'go', font: FONT }], line + 25)).toEqual(['Ping |@alice|  ', 'go'])
        expect(texts([alice, blank, { text: 'go', font: FONT }], measureWidth('@alice', FONT) + 10)).toEqual(scan === 'blink' ? ['@alice|  ', 'go'] : ['@alice', '  |go'])
        // That return doesn't depend on the chip (RewindOverflow): Chrome keeps such a span after
        // text too, and after spaces of their own after the chip.
        expect(texts([{ text: 'foofoo', font: FONT }, blank, { text: 'go', font: FONT }], measureWidth('foofoo', FONT) + 5)).toEqual(scan === 'blink' ? ['foofoo|  ', 'go'] : ['foofoo', '  |go'])
        if (scan === 'blink') expect(texts([{ text: 'Ping ', font: FONT }, alice, { text: '  ', font: FONT }, blank, { text: 'go', font: FONT }], line + 5)).toEqual(['Ping |@alice|  |  ', 'go'])
        expect(texts([{ text: 'Ping ', font: FONT }, alice, { text: '\t', font: FONT, extraWidth: 20 }, { text: 'go', font: FONT }], line + 5)).toEqual(scan === 'blink' ? ['Ping |@alice|\t', 'go'] : ['Ping |@alice', '\t|go'])
        // Safari fits both edges too of a span that ends at its line feed.
        const feedAfterSpaces = { text: '  \n', font: FONT, extraWidth: 20 }
        expect(texts([{ text: 'Ping ', font: FONT }, alice, feedAfterSpaces, { text: 'go', font: FONT }], line + 15)).toEqual(scan === 'blink' ? ['Ping |@alice|  ', 'go'] : ['Ping |@alice', '  ', 'go'])
        expect(texts([{ text: 'Ping ', font: FONT }, alice, feedAfterSpaces, { text: 'go', font: FONT }], line + 25)).toEqual(['Ping |@alice|  ', 'go'])
      }
    } finally {
      Object.assign(profile, previous)
      clearCache()
    }
  })

  test('a box lays out as the atomic NBSP it replaces, whose extraWidth made up the rest of its width, in each engine', async () => {
    const engines = [await engineProfileUnder(CHROME_USER_AGENT), await engineProfileUnder(SAFARI_USER_AGENT), await engineProfileUnder(FIREFOX_USER_AGENT)]
    const nbsp = measureWidth(' ', FONT)
    const standIn = (items: Array<RichInlineItem | RichInlineBox>): RichInlineItem[] =>
      items.map(item => item.text === undefined ? { text: ' ', font: FONT, break: 'never', extraWidth: item.width - nbsp } : item)
    const round = (value: number) => Math.round(value * 1e6) / 1e6
    // Each line's fragments, a box's text, which is empty, as its stand-in's, and the paragraph's stats.
    const laidOut = (items: Array<RichInlineItem | RichInlineBox>, width: number, options: Parameters<typeof prepareRichInline>[1]) => {
      const prepared = prepareRichInline(items, options)
      const lines: unknown[] = []
      walkRichInlineLineRanges(prepared, width, range => {
        const fragments = materializeRichInlineLineRange(prepared, range).fragments
        for (const f of fragments) {
          if (items[f.itemIndex]!.text === undefined) {
            expect(f.text).toBe('')
            f.text = '\u00A0'
          }
          f.gapBefore = round(f.gapBefore)
          f.occupiedWidth = round(f.occupiedWidth)
          // A box has no text for its source offsets to span, where its stand-in has its NBSP.
          f.sourceStart = f.sourceEnd = 0
        }
        lines.push({ fragments, width: round(range.width), end: range.end })
      })
      const stats = measureRichInlineStats(prepared, width)
      return { lines, stats: [stats.lineCount, round(stats.maxLineWidth)] }
    }
    const BOLD = '700 16px Test Sans'
    const text = (value: string, font = FONT): RichInlineItem => ({ text: value, font })
    const rows: Array<Array<RichInlineItem | RichInlineBox>> = [
      // Between words, with a space on either side, and none; beside punctuation and a soft hyphen.
      [text('Ship '), { width: 20 }, text(' today, and'), { width: 44 }, text(', then more words')],
      [text('ab'), { width: 22 }, text('cd ef'), { width: 0 }, text('gh')],
      [text('see ('), { width: 16 }, text(') now'), text('word­'), { width: 18 }, text('­more text')],
      // Between ideographs and inside a Korean word, which keep-all doesn't break.
      [text('日本'), { width: 16 }, text('語のテキスト'), text('안녕하세요'), { width: 20 }, text('님, 반가워요')],
      // White space after a box, which pre-wrap keeps on its line, a tab, line feeds, and a box last.
      [text('Ping  '), { width: 30 }, text('  '), text('\tgo', BOLD), text('\n'), { width: 12 }, text('   end   '), { width: 60 }],
      [text('first\n'), { width: 24 }, text('\nsecond'), { width: 24 }, { width: 24 }, text(' ')],
    ]
    const profile = getEngineProfile()
    const previous = { ...profile }
    try {
      for (let e = 0; e < engines.length; e++) {
        Object.assign(profile, engines[e]!)
        clearCache()
        for (const options of [{}, { whiteSpace: 'pre-wrap' }, { wordBreak: 'keep-all' }] as const) {
          for (const items of rows) {
            for (let width = 1; width <= 300; width += 3.7) {
              expect({ engine: profile.lineBreakScan, options, width, ...laidOut(items, width, options) })
                .toEqual({ engine: profile.lineBreakScan, options, width, ...laidOut(standIn(items), width, options) })
            }
          }
        }
        // A box of width 0 that sticks out of the line, after a space that doesn't fit or an atomic
        // item wider than the line. Chrome and Safari move it to the next line as any other.
        // Firefox places it there (emptyAtomicAlwaysFits, Gecko's CanPlaceFrame) and keeps it,
        // unless a frame with a width comes next, which sends the line back to its last break that
        // fit, before the box (setEmptyObjectFacts). Each row matches Firefox 156.0.1 (2026-10-02):
        // the items, the options, each line's items in Firefox, and whether the line is narrower
        // than `a` (else `ab` and a pixel wide). A line's items are those with a fragment on it,
        // so a space the line's end consumes is on none, nor are soft hyphens the next line's
        // start consumes; Firefox still paints two such spaces at the end of the first line, the
        // space at -6px and the second space of `ab`, a space, a soft hyphen and a space before
        // `cd` (ENGINE_FOLLOWUPS.md, Rich-inline item edges, which also has the shape the profile
        // misses: a soft hyphen between two spaces of one item that ends right before the box).
        const zero = { width: 0 }
        const chip: RichInlineItem = { text: 'abcdef', font: FONT, break: 'never' }
        const padded = (value: string): RichInlineItem => ({ text: value, font: FONT, extraWidth: 1 })
        const preWrap = { whiteSpace: 'pre-wrap' } as const
        type Row = [items: Array<RichInlineItem | RichInlineBox>, options: Parameters<typeof prepareRichInline>[1], lines: number[][], narrow?: true]
        const emptyBoxRows: Row[] = [
          // Text right after it, a second empty box between them, a soft hyphen or a tab: the box moves
          // down. A tab that doesn't fit after it takes the next line (hangTabs): a line that holds
          // an empty box can break before the text that follows it.
          [[text('ab '), zero, text('cd')], {}, [[0], [1, 2]]],
          [[text('ab '), zero, zero, text('cd')], {}, [[0], [1, 2, 3]]],
          [[text('ab '), zero, text('\u00ADcd')], {}, [[0], [1, 2]]],
          [[chip, zero, text('cd')], {}, [[0], [1, 2]]],
          [[chip, zero, text('\tcd')], preWrap, [[0], [1], [2], [2]]],
          // The paragraph's end, white space that ends it in a text node of the paragraph's own, an
          // atomic item with a width, or text that starts with a space of its own node, a ZWSP, a
          // line feed or preserved spaces: the box stays. An item of a soft hyphen alone between
          // takes no room.
          [[text('ab '), zero], {}, [[0, 1]]],
          [[text('ab '), zero, text(' ')], {}, [[0, 1]]],
          [[text('ab '), zero, { text: 'cd', font: FONT, break: 'never' }], {}, [[0, 1], [2]]],
          [[text('ab '), zero, text(' cd')], {}, [[0, 1], [2]]],
          [[text('ab '), zero, text('\u200Bcd')], {}, [[0, 1, 2], [2]]],
          [[text('ab '), zero, text('\u00AD')], {}, [[0, 1, 2]]],
          [[text('ab '), zero, text('\u00AD'), text(' ')], {}, [[0, 1, 2]]],
          [[text('ab '), zero, text('\u00AD'), text(' cd')], {}, [[0, 1], [3]]],
          [[chip, zero, text(' cd')], {}, [[0, 1], [2]]],
          [[chip, zero, text('\ncd')], preWrap, [[0, 1, 2], [2]]],
          [[chip, zero, text('  cd')], preWrap, [[0, 1, 2], [2]]],
          // A span with padding after it is a frame with a width whatever its text starts with: the
          // box moves down.
          [[text('ab '), zero, padded(' cd')], {}, [[0], [1], [2]]],
          [[text('ab '), zero, padded('\u200Bcd')], {}, [[0], [1, 2]]],
          // So is white space in a node of its own after it, with soft hyphens or without, and
          // the white space that ends the paragraph after soft hyphens in their node.
          [[text('ab '), zero, text(' '), text('cd')], {}, [[0], [1], [3]]],
          [[text('ab '), zero, text(' '), zero], {}, [[0], [1, 3]]],
          [[text('ab '), zero, text(' '), { width: 5 }], {}, [[0], [1, 3]]],
          [[text('ab '), zero, text(' \u00AD'), text('cd')], {}, [[0], [1, 2], [3]]],
          [[text('ab '), zero, text(' \u00AD')], {}, [[0], [1, 2]]],
          [[text('ab '), zero, text('\u00AD ')], {}, [[0], [1, 2]]],
          // White space before it after content already past the line's end breaks the line itself.
          [[chip, text(' '), zero], {}, [[0], [2]]],
          [[chip, text(' '), zero], preWrap, [[0, 1], [2]]],
          [[chip, zero, text(' '), zero, text('cd')], preWrap, [[0, 1, 2], [3, 4]]],
          // White space is read from the text, not from a width: a space narrower than nothing
          // under letter spacing, and a tab, which Firefox doesn't hang, break the line after
          // themselves too.
          [[chip, { text: ' ', font: FONT, letterSpacing: -6 }, zero], {}, [[0], [2]]],
          [[chip, text('\t'), zero], preWrap, [[0], [1], [2]]],
          // Firefox drops soft hyphens before it reads the white space. A space before the soft
          // hyphens that end its node is that frame's own, so the frame ends before it and the
          // line has a break there; an item of soft hyphens after the space of another node is
          // an empty frame past the line's end, after which the line breaks.
          [[text('ab \u00AD '), zero, text('cd')], {}, [[0], [1, 2]]],
          [[text('ab '), text('\u00AD'), zero], {}, [[0], [2]]],
          [[chip, text(' \u00AD '), zero], {}, [[0], [2]]],
          // The white space may be any number of such items back: before a second item of soft
          // hyphens, in a node that ends in a space and a soft hyphen before one, or a tab.
          [[text('ab '), text('\u00AD'), text('\u00AD'), zero], {}, [[0], [3]]],
          [[text('ab \u00AD'), text('\u00AD'), zero], {}, [[0], [2]]],
          [[chip, text('\t'), text('\u00AD'), zero], preWrap, [[0], [1], [3]]],
          // After text wider than the line the first break is the one after the box, which stays,
          // unless a soft hyphen ends that text, in its item or one of its own, which gives a break
          // before the box, as an atomic item before the soft hyphen does.
          [[text('a'), zero, text('b')], {}, [[0, 1], [2]], true],
          [[text('a\u00AD'), zero, text('b')], {}, [[0], [1], [2]], true],
          [[text('a'), text('\u00AD'), zero, text('b')], {}, [[0, 1], [2], [3]], true],
          [[chip, text('\u00AD'), zero, text('cd')], {}, [[0], [2, 3]]],
          // The soft hyphen is read from the text too, not from its hyphen's width, which letter
          // spacing takes below nothing.
          [[chip, { text: '\u00AD', font: FONT, letterSpacing: -6 }, zero, text('cd')], {}, [[0], [2, 3]]],
          // Preserved spaces that hang end their frame at the line's end, so the box is inside the
          // line, and so is what follows it without a width: a second box, a space, which hangs too,
          // and a box after an item of a soft hyphen.
          [[text('ab '), zero, text('cd')], preWrap, [[0, 1], [2]]],
          [[text('ab '), zero, zero, text('cd')], preWrap, [[0, 1, 2], [3]]],
          [[text('ab '), zero, text(' '), zero, text('cd')], preWrap, [[0, 1, 2, 3], [4]]],
          [[text('ab '), zero, text(' '), zero], preWrap, [[0, 1, 2, 3]]],
          [[text('ab '), text('\u00AD'), zero, text('cd')], preWrap, [[0, 1, 2], [3]]],
          // A span with padding after it has a width and starts the next line, its spaces too, as
          // after an item of a soft hyphen there.
          [[text('ab '), zero, padded(' cd')], preWrap, [[0, 1], [2], [2]]],
          [[text('ab '), text('\u00AD'), padded(' cd')], preWrap, [[0], [2], [2]]],
        ]
        for (const [items, options, gecko, narrow] of emptyBoxRows) {
          const prepared = prepareRichInline(items, options)
          const lines: number[][] = []
          const width = narrow === true ? measureWidth('a', FONT) - 1 : measureWidth('ab', FONT) + 1
          walkRichInlineLineRanges(prepared, width, range => { lines.push(range.fragments.map(f => f.itemIndex)) })
          const shown = { engine: profile.lineBreakScan, items, options }
          if (e === 2) expect({ ...shown, lines }).toEqual({ ...shown, lines: gecko })
          else expect({ ...shown, firstLineHasBox: lines[0]!.includes(items.indexOf(zero)) }).toEqual({ ...shown, firstLineHasBox: false })
        }
        // Firefox's line keeps a run of such boxes for what follows the run, which preparation
        // finds once for all of them, from the paragraph's end back. Looking again from every box
        // made a line of N of them N²/2 steps (RESEARCH.md, Keeping Work Bounded), so a walk may
        // read each box's flags only a few times.
        if (e === 2) {
          const run = 2000
          const { data } = prepareRichInline([text('ab '), ...Array.from({ length: run }, () => zero)]) as unknown as { data: Parameters<typeof walkPreparedLinesRaw>[0] }
          let reads = 0
          const counted = new Proxy(data.segmentFlags, {
            get(target, key) {
              if (typeof key === 'string' && key !== 'length') reads++
              return Reflect.get(target, key) as unknown
            },
          })
          expect(walkPreparedLinesRaw({ ...data, segmentFlags: counted }, measureWidth('ab', FONT) + 1)).toBe(1)
          expect(reads).toBeGreaterThan(run)
          expect(reads).toBeLessThan(40 * run)
        }
        // Firefox's text frame leaves out the preserved spaces that overflow the line and keeps
        // those that fit, so the box after them is at the line's end, or right after the spaces,
        // and the line is that wide.
        const ab = measureWidth('ab', FONT)
        const space = measureWidth(' ', FONT)
        const firstWidth = (width: number) => {
          let first = -1
          walkRichInlineLineRanges(prepareRichInline([text('ab  '), zero, text('cd')], preWrap), width, range => { if (first < 0) first = range.width })
          return first
        }
        expect(firstWidth(ab + space + 1)).toBe(e === 2 ? ab + space + 1 : ab)
        expect(firstWidth(ab + 2 * space + 1)).toBe(ab + 2 * space)
      }
    } finally {
      Object.assign(profile, previous)
      clearCache()
    }
  })

  test('a box is one fragment of its width, with no text, whether alone, first, last, beside another or wider than the line', () => {
    const lines = (items: Array<RichInlineItem | RichInlineBox>, width: number, options?: Parameters<typeof prepareRichInline>[1]) => {
      const prepared = prepareRichInline(items, options)
      const out: string[][] = []
      walkRichInlineLineRanges(prepared, width, range => {
        out.push(materializeRichInlineLineRange(prepared, range).fragments.map(f => `${f.itemIndex}:${f.text}:${Math.round(f.occupiedWidth * 100) / 100}`))
      })
      expect(measureRichInlineStats(prepared, width).lineCount).toBe(out.length)
      return out
    }
    const ab = measureWidth('ab', FONT)
    // Alone, and beside another, with no gap between them; each wider than the line on a line of its own.
    expect(lines([{ width: 30 }], 100)).toEqual([['0::30']])
    expect(lines([{ width: 30 }, { width: 30 }, { width: 30 }], 70)).toEqual([['0::30', '1::30'], ['2::30']])
    expect(lines([{ width: 30 }, { width: 30 }], 20)).toEqual([['0::30'], ['1::30']])
    // First and last, and wider than the line between words, where it overflows its own line.
    expect(lines([{ width: 10 }, { text: 'ab cd', font: FONT }, { width: 10 }], 1e5)).toEqual([['0::10', '1:ab cd:' + Math.round(measureWidth('ab cd', FONT) * 100) / 100, '2::10']])
    expect(lines([{ text: 'ab ', font: FONT }, { width: 50 }, { text: ' cd', font: FONT }], 30).map(line => line.length)).toEqual([1, 1, 1])
    // A line breaks at a box of width 0 inside a word, as at an <img> of width 0, and an empty text item
    // makes no fragment.
    expect(lines([{ text: 'ab', font: FONT }, { width: 0 }, { text: 'cd', font: FONT }], ab + 5)).toEqual([[`0:ab:${ab}`, '1::0'], [`2:cd:${ab}`]])
    expect(lines([{ text: 'ab', font: FONT }, { text: '', font: FONT }, { text: 'cd', font: FONT }], 1e5)[0]!.map(f => f.split(':')[0])).toEqual(['0', '2'])
    // Spaces on its two sides don't collapse into one: the box takes the gap before it, from the item
    // that held the space, and the text after it its own, whose cursors come after that space's segment.
    const prepared = prepareRichInline([{ text: 'ab ', font: FONT }, { width: 20 }, { text: ' cd', font: FONT }])
    const line = layoutNextRichInlineLineRange(prepared, 1e5)!
    const space = measureWidth(' ', FONT)
    expect(line.fragments.map(f => [f.itemIndex, f.gapItemIndex, f.gapBefore, f.occupiedWidth, f.start, f.end])).toEqual([
      [0, -1, 0, ab, { segmentIndex: 0, graphemeIndex: 0 }, { segmentIndex: 1, graphemeIndex: 0 }],
      [1, 0, space, 20, { segmentIndex: 0, graphemeIndex: 0 }, { segmentIndex: 1, graphemeIndex: 0 }],
      [2, 2, space, ab, { segmentIndex: 1, graphemeIndex: 0 }, { segmentIndex: 2, graphemeIndex: 0 }],
    ])
    expect(line.width).toBeCloseTo(2 * ab + 2 * space + 20, 9)
    // A line that ends after a box ends at the next item, and one that starts at a box starts at it.
    const wrapped = prepareRichInline([{ text: 'ab', font: FONT }, { width: 20 }, { width: 20 }])
    const first = layoutNextRichInlineLineRange(wrapped, ab + 25)!
    expect(first.end).toEqual({ itemIndex: 2, segmentIndex: 0, graphemeIndex: 0 })
    expect(layoutNextRichInlineLineRange(wrapped, ab + 25, first.end)!.fragments.map(f => f.itemIndex)).toEqual([2])
    // In pre-wrap, spaces after a box wider than the line stay on its line and hang, as after a chip.
    expect(lines([{ width: 50 }, { text: ' ', font: FONT }, { text: '  next', font: FONT }], 40, { whiteSpace: 'pre-wrap' })).toEqual([['0::50', '1: :0', '2:  :0'], [`2:next:${Math.round(measureWidth('next', FONT) * 100) / 100}`]])
    // A width that isn't finite, or is negative, throws, naming the item.
    for (const width of [Number.NaN, Infinity, -Infinity, -10]) expect(() => prepareRichInline([{ text: 'ab', font: FONT }, { width }])).toThrow(RangeError)
    expect(() => prepareRichInline([{ text: 'ab', font: FONT }, { width: -10 }])).toThrow('Item 1 has no text')
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
    expect(internals(zero).breakableFitAdvances).toEqual(internals(base).breakableFitAdvances)
  })

  test('a letterSpacing that isn\'t finite throws at preparation', () => {
    for (const letterSpacing of [NaN, Infinity, -Infinity]) {
      expect(() => prepare('Hello', FONT, { letterSpacing })).toThrow(RangeError)
      expect(() => prepareWithSegments('Hello', FONT, { letterSpacing })).toThrow(RangeError)
      // A blank item is never prepared on its own.
      expect(() => prepareRichInline([{ text: ' ', font: FONT, letterSpacing }, { text: 'Hello', font: FONT }])).toThrow(RangeError)
    }
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
    const softHyphenLineWidth = prepared.widths[0]! + internals(prepared).discretionaryHyphenWidth
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

  test('letterSpacing leaves an Arabic run unspaced but for its space, as Chrome does', () => {
    const spacing = 2
    const text = 'مرحبا، عالم؟'
    const line = layoutWithLines(
      prepareWithSegments(text, FONT, { letterSpacing: spacing }),
      300,
      LINE_HEIGHT,
    ).lines[0]!

    expect(line.width).toBeCloseTo(measureWidth(text, FONT) + spacing, 5)
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

  // False in general, in the browsers themselves: contextual shaping and discretionary breaks can make a wider box
  // take more lines, and where not even a first character fits, WebKit keeps the characters after it that can't start
  // a line, so a box narrower than a glyph can take fewer lines than one a glyph wide (RESEARCH.md, A Wider Box Never
  // Needs More Lines; ENGINE_FOLLOWUPS.md, Emergency breaks inside a word).
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
    const graphemeWidths = internals(prepared).breakableFitAdvances[0]!
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

  test('mixed-script canary keeps layoutWithLines and layoutNextLine aligned across CJK, RTL, and emoji', () => {
    const prepared = prepareWithSegments('Hello 世界 مرحبا 🌍 test', FONT)
    const width = 80
    const expected = layoutWithLines(prepared, width, LINE_HEIGHT)

    expect(expected.lines.map(line => line.text)).toEqual(['Hello 世', '界 مرحبا ', '🌍 test'])

    const actual = collectStreamedLines(prepared, width)
    expect(actual).toEqual(expected.lines)
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

  test('a word that fits past its soft hyphen stays whole, and the overflow after it breaks at the space', () => {
    const prepared = prepareWithSegments('foo trans\u00ADatlantic labels', FONT)
    const width = measureWidth('foo transatlantic', FONT) + 0.1
    const result = layoutWithLines(prepared, width, LINE_HEIGHT)

    expect(result.lines.map(line => line.text)).toEqual(['foo transatlantic ', 'labels'])
    expect(layout(prepared, width, LINE_HEIGHT).lineCount).toBe(result.lineCount)
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
    const result = layoutWithLines(prepared, width, LINE_HEIGHT)
    expect(result.lines.map(line => line.text)).toEqual(['a\t', 'b'])
    expect(collectStreamedLines(prepared, width)).toEqual(result.lines)
    expect(reconstructFromLineBoundaries(prepared, result.lines)).toBe(prepared.segments.join(''))
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

  test('consecutive chunks of a soft hyphen or ZWSP each hold a line and keep the visible tail', () => {
    for (const control of ['\u00AD', '\u200B']) for (const prefix of ['', 'a\n']) for (const emptyLine of ['', '\n']) {
      const prepared = prepareWithSegments(prefix + control + '\n' + control + '\n' + emptyLine + 'b', FONT, { whiteSpace: 'pre-wrap' })
      // A hard break ends a line, as in Chrome, Safari and Firefox: a chunk that starts
      // with ZWSP retains that source as a line, and one holding only a soft hyphen,
      // which a line start consumes, is an empty line.
      const retained = control === '\u200B' ? [control, control] : ['', '']
      const expected = [...(prefix === '' ? [] : ['a']), ...retained, ...(emptyLine === '' ? [] : ['']), 'b']
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
    const wordBreaks = internals(prepared).breakableFitAdvances[2]!
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
      const segmentWidths = prepared.widths
      const widths = [-5, 0]
      for (let width = 1; width <= 400; width += 0.5) widths.push(width)
      let prefix = 0
      for (let i = 0; i < segmentWidths.length; i++) {
        prefix += segmentWidths[i]!
        widths.push(prefix - epsilon, prefix - 0.001, prefix, prefix + 0.001)
      }
      for (let widthIndex = 0; widthIndex < widths.length; widthIndex++) {
        const width = widths[widthIndex]!
        const counted = countPreparedLines(internals(prepared), width)
        const walked = walkPreparedLinesRaw(internals(prepared), width)
        expect(counted).toBe(walked)
      }
    }
  })

  test('countPreparedLines counts text with boundaries the scan does not break as the full walker does', () => {
    const profile = getEngineProfile()
    const previous = profile.lineBreakScan
    const texts = [
      // No break before NEL (UAX #14 LB6), after text or a space.
      'alpha\u0085beta gamma \u0085delta epsilon\u0085',
      // C0 controls stay their own segments, with no break on either side.
      'one\u0001two three\u0007 four fivesixseven\u0001eight',
      // A mark after a control stays apart from the text after it.
      'x\u0001\u0301yz abc\u0001\u0301',
      // Gecko finds no break before a bidi control, and a space before one takes it: the simple
      // walkers lay the text out there.
      'said \u2066quoted\u2069 words and \u200Emore \u202Bnested\u202C text',
    ]
    const scans = ['blink', 'gecko'] as const
    try {
      for (let scanIndex = 0; scanIndex < scans.length; scanIndex++) {
        const scan = scans[scanIndex]!
        profile.lineBreakScan = scan
        clearCache()
        for (let textIndex = 0; textIndex < texts.length; textIndex++) {
          const text = texts[textIndex]!
          const prepared = prepareWithSegments(text, FONT)
          const internal = internals(prepared)
          // The line APIs take the full walker, and layout() the simple stepper.
          if (textIndex < 3) expect(internal.simpleLineWalkFastPath).toBe(false)
          else if (scan === 'gecko') expect(internal.simpleLineWalkFastPath).toBe(true)
          expect(internal.simpleLineCountFastPath).toBe(true)
          const compact = prepare(text, FONT)
          const widths = [-5, 0, 0.5, 1]
          for (let width = 2; width <= 300; width += 1.5) widths.push(width)
          let prefix = 0
          for (let i = 0; i < internal.widths.length; i++) {
            prefix += internal.widths[i]!
            widths.push(prefix - 0.001, prefix, prefix + 0.001)
          }
          for (let widthIndex = 0; widthIndex < widths.length; widthIndex++) {
            const width = widths[widthIndex]!
            const walked = walkPreparedLinesRaw(internal, width)
            expect({ scan, text, width, count: countPreparedLines(internal, width) }).toEqual({ scan, text, width, count: walked })
            expect(layout(compact, width, LINE_HEIGHT).lineCount).toBe(walked)
          }
        }
      }
    } finally {
      profile.lineBreakScan = previous
      clearCache()
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
        expect(countPreparedLines(internals(prepared), width)).toBe(expected.length)
        expect(walkPreparedLinesRaw(internals(prepared), width)).toBe(expected.length)
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
      expect(countPreparedLines(internals(prepared), nextWidth)).toBe(ranges.lineCount)
      expect(layout(compact, nextWidth, LINE_HEIGHT).lineCount).toBe(ranges.lineCount)
    }
    expect(countPreparedLines(internals(prepared), width)).toBe(expected.length)
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
        expect(countPreparedLines(internals(prepared), width)).toBe(expected.length)
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
        expect(countPreparedLines(internals(prepared), width)).toBe(1)
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
    // mark before another, or before ・ or U+3000, lose half an em, as Canvas shapes them. 、。，．：
    // are closing marks that draw in the left half of their em next to Han text and centered
    // alone, as locl can place them, and ； draws in the left half. Canvas shapes `(`, `)`, `·`,
    // `；` and curly quotes as words of their own, so it halts nothing between them and those
    // marks, but the first of two ；. A font named Wide Dots draws 、。，． and ； across their em,
    // marks of no type that nothing halts and that halt nothing; one named Wide Colons draws ：
    // and ； so, and one named Wide Full Stop only ．, which leaves the four dots without a type,
    // as Blink types them only together. Curly quotes are narrow, but in the font named Wide
    // Quotes, where each is an em wide, an opening one drawn in its right half and a closing one
    // in its left, and the second of two opening ones and the first of two closing ones are
    // halted; where only the opening ones, the closing ones or the double ones are wide, none is.
    Object.defineProperty(TestCanvasRenderingContext2D.prototype, 'measureText', {
      ...measureText,
      value(this: TestCanvasRenderingContext2D, text: string) {
        canvasMeasurementCount++
        const em = parseFontSize(this.font)
        const named = (names: [string, string][]): string => names.find(([name]) => this.font.includes(name))?.[1] ?? ''
        const wideQuotes = named([['Wide Quotes', '“‘”’'], ['Wide Opening Quotes', '“‘'], ['Wide Closing Quotes', '”’'], ['Wide Double Quotes', '“”']])
        const wide = named([['Wide Dots', '、。，．；'], ['Wide Colons', '：；'], ['Wide Full Stop', '．']])
        const closing = '」』）】〉》' + (/[、。，．]/.test(wide) ? '' : '、。，．') + (wide.includes('：') ? '' : '：')
        let pairs = (text.match(new RegExp(`(?<=[${closing}「])「|[${closing}](?=[${closing}・\u3000])`, 'g')) ?? []).length
        if (!wide.includes('；')) pairs += (text.match(/；(?=；)/g) ?? []).length
        if (wideQuotes.length === 4) pairs += (text.match(/(?<=[“‘])[“‘]|[”’](?=[”’])/g) ?? []).length
        // Ink bounds over the characters, each at its advance.
        const han = /\p{sc=Han}/u.test(text)
        let x = 0
        let left = Infinity
        let right = -Infinity
        for (const ch of text) {
          const quote = wideQuotes.includes(ch)
          const opens = ch === '“' || ch === '‘'
          const w = quote ? em : measureWidth(ch, this.font)
          const dot = '、。，．：；'.includes(ch)
          const leftHalf = ch === '；' || han
          left = Math.min(left, x + (quote ? (opens ? 0.6 : 0.1) * em : dot ? (leftHalf ? 0.1 : 0.3) * em : 0))
          right = Math.max(right, x + (quote ? (opens ? 0.9 : 0.4) * em : dot && wide.includes(ch) ? 0.9 * em : dot ? (leftHalf ? 0.4 : 0.7) * em : w))
          x += w
        }
        const width = (wideQuotes === '' ? measureWidth(text, this.font) : x) - pairs * em / 2
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
        // Just narrower than a halted closing mark fits, before a space or a line feed.
        ['中」 中', 23, ['中', '」 ', '中'], [16, 16, 16]],
        ['中」\n中', 23, ['中', '」', '中'], [16, 16, 16]],
        ['」\n', 8, ['」'], [8]],
        ['」\n', 7, ['」'], [16]],
        ['」\u200B中', 7, ['」\u200B', '中'], [16, 16]],
        // A line whose closing mark follows text the scan gives no break before.
        ['中\u0001」\n', 34, ['中\u0001」'], [33.6]],
        // Only where no break before it fits, and a space after it still hangs.
        ['中 中\u0001」\n', 56, ['中 ', '中\u0001」'], [16, 41.6]],
        ['中\u0001」 中', 34, ['中\u0001」 ', '中'], [33.6, 16]],
        ['中\u0001」\n', 33, ['中\u0001', '」'], [25.6, 16]],
      ]
      // Which marks halt at a line end, before which endings. Blink halts the marks
      // Character::MaybeHanKerningClose takes, 」』）】〉》, and never 、。，, which type as dots,
      // though this font draws them as closing marks. The scan gives no break before a space, a
      // line feed or some text, such as a C0 control, and there only Blink's retry of a line that
      // no break fits, which breaks after every grapheme, halts the mark: `中` and the mark fit
      // 24px only halted, while `中中` and the mark have a break before the mark that fits 40px.
      const endings: [string, string, string[], boolean][] = [
        // The text after the mark, what the mark's line holds after it, the lines after that,
        // and whether the scan gives a break after the mark.
        ['中', '', ['中'], true],
        ['', '', [], true],
        ['\n中', '', ['中'], false],
        ['\n', '', [], false],
        [' 中', ' ', ['中'], false],
        ['\u0001', '', ['\u0001'], false],
        ['\t中', '\t', ['中'], false],
        ['\u200B中', '\u200B', ['中'], false],
      ]
      const marks: [string, boolean][] = [['」', true], ['』', true], ['）', true], ['】', true], ['〉', true], ['》', true], ['。', false], ['、', false], ['，', false]]
      for (let m = 0; m < marks.length; m++) {
        const [mark, halts] = marks[m]!
        for (let e = 0; e < endings.length; e++) {
          const [after, hung, rest, breakAfter] = endings[e]!
          const restWidths = rest.map(line => measureWidth(line, font))
          if (halts) cases.push([`中${mark}${after}`, 24, [`中${mark}${hung}`, ...rest], [24, ...restWidths]])
          else cases.push([`中${mark}${after}`, 24, ['中', `${mark}${hung}`, ...rest], [16, 16, ...restWidths]])
          if (halts && breakAfter) cases.push([`中中${mark}${after}`, 40, [`中中${mark}${hung}`, ...rest], [40, ...restWidths]])
          else cases.push([`中中${mark}${after}`, 40, ['中', `中${mark}${hung}`, ...rest], [16, 32, ...restWidths]])
        }
      }
      for (const [text, width, expected, widths] of cases) {
        // Spaces hang in both white-space modes; a line feed is a hard break only in pre-wrap.
        const modes = /[\n\t]/.test(text) ? ['pre-wrap'] as const : ['normal', 'pre-wrap'] as const
        for (let m = 0; m < modes.length; m++) {
          const whiteSpace = modes[m]!
          const options = { whiteSpace }
          const prepared = prepareWithSegments(text, font, options)
          const lines = layoutWithLines(prepared, width, LINE_HEIGHT)
          expect({ text, whiteSpace, width, lines: lines.lines.map(line => line.text), widths: lines.lines.map(line => line.width) })
            .toEqual({ text, whiteSpace, width, lines: expected, widths })
          expect(collectStreamedLines(prepared, width)).toEqual(lines.lines)
          expect(countPreparedLines(internals(prepared), width)).toBe(expected.length)
          expect(walkPreparedLinesRaw(internals(prepared), width)).toBe(expected.length)
          expect(layout(prepare(text, font, options), width, LINE_HEIGHT).lineCount).toBe(expected.length)
          // The complex walker, for text that leaves the fast path, agrees.
          const complex = { ...prepared, simpleLineWalkFastPath: false } as typeof prepared
          expect(layoutWithLines(complex, width, LINE_HEIGHT)).toEqual(lines)
        }
      }
      // Every character HanKerning types by itself, before Ps and Pe (getStaticCharType in
      // src/han-kerning.ts), as [the character, whether 「 after it is halted, whether 」 before it
      // is, whether it is halted itself before a closing mark]: in Chrome 154.0.8037.57, 16px
      // PingFang SC under zh draws `中X「中`, `中」X中` and `中X」中` 8px narrower than `中X中中` and
      // `中中X中` where the pair halts, and `中X”中` 8px narrower than `中X中”中` less its `中` where
      // `中X」中` is (2026-10-01). An opening quote in a narrow glyph halts only the mark after it
      // and a closing one only the mark before it; a dot, a colon, a semicolon and a middle halt
      // both, and of those only a middle is never halted itself. The closing mark after it is the one
      // Canvas shapes as another word, `”` after a CJK symbol and `」` after the rest, so that
      // the type the library gives the character decides the halt.
      const typed: [string, boolean, boolean, boolean][] = [
        ['\u2018', true, false, false], ['\u201C', true, false, false], ['\u2019', false, true, false], ['\u201D', false, true, false],
        ['\u3001', true, true, true], ['\u3002', true, true, true], ['\uFF0C', true, true, true], ['\uFF0E', true, true, true],
        ['\uFF1A', true, true, true], ['\uFF1B', true, true, true],
        ['\u00B7', true, true, false], ['\u2027', true, true, false], ['\u3000', true, true, false], ['\u30FB', true, true, false],
      ]
      // Blink types the four dots together, and the colon and the semicolon each alone, from their
      // glyphs' ink in the font (HanKerning::FontData, han_kerning.cc:504-509): 16px Hiragino Sans
      // under ja halts the same pairs in Chrome, but its colon and semicolon, drawn centered, are
      // never halted themselves. Three fonts no browser was asked about each give some of them no
      // type and so no pair, as [the font, its marks of no type]: between them a dot, the colon,
      // the semicolon and a middle each pair otherwise than the other three, and the dots lose
      // their type where one of them is drawn otherwise than the rest.
      const typedFonts: [string, string][] = [[font, ''], ['16px Halt Wide Dots Sans', '、。，．；'], ['16px Halt Wide Colons Sans', '：；'], ['16px Halt Wide Full Stop Sans', '、。，．']]
      for (let f = 0; f < typedFonts.length; f++) {
        const [typedFont, typeless] = typedFonts[f]!
        for (let t = 0; t < typed.length; t++) {
          const [mark, haltsAfter, haltsBefore, halted] = typed[t]!
          const closer = '‘“’”·‧；'.includes(mark) ? '」' : '”'
          const pairs: [string, boolean][] = [[`中${mark}「中`, haltsAfter], [`中」${mark}中`, haltsBefore], [`中${mark}${closer}中`, halted]]
          for (let p = 0; p < pairs.length; p++) {
            const [text, halts] = pairs[p]!
            expect({ font: typedFont, text, width: measureNaturalWidth(prepareWithSegments(text, typedFont)) }).toEqual({ font: typedFont, text, width: measureWidth(text, font) - (halts && !typeless.includes(mark) ? 8 : 0) })
          }
        }
      }
      // Curly quotes an em wide type as opening and closing marks, and narrow ones as narrow marks
      // (HanKerning::GetCharType, han_kerning.cc:142-168). Only a fullwidth opening quote is halted
      // after `」` and only a fullwidth closing one halts `「` after it: 16px Hiragino Sans GB under
      // zh, whose quotes are an em wide, draws `中」“中`, `中」‘中`, `中”「中` and `中’「中` at 56px in
      // Chrome 154.0.8037.57, 8px narrower than `中中“中`, and PingFang SC, whose quotes are narrow,
      // draws each as wide as its characters (2026-10-01). The other four pairs halt under either
      // type, and are the only ones here of an opening mark after an opening one and a closing
      // mark before a closing one that Canvas shapes as two words.
      for (const text of ['中」“中', '中」‘中', '中”「中', '中’「中', '中“「中', '中‘「中', '中」”中', '中」’中']) {
        expect({ text, width: measureNaturalWidth(prepareWithSegments(text, '16px Halt Wide Quotes Sans')) }).toEqual({ text, width: 56 })
      }
      for (const text of ['中」“中', '中」‘中', '中”「中', '中’「中']) {
        expect({ text, width: measureNaturalWidth(prepareWithSegments(text, font)) }).toEqual({ text, width: measureWidth(text, font) })
      }
      // A fullwidth closing quote is halted before the middles Canvas shapes as another word,
      // U+30FB and U+3000, so there the type the library gives those decides the halt: Hiragino
      // Sans GB draws both at 56px in Chrome 154.0.8037.57, and `中”中中` at 64 (2026-10-01).
      for (const text of ['中”・中', '中”\u3000中']) {
        expect({ text, width: measureNaturalWidth(prepareWithSegments(text, '16px Halt Wide Quotes Sans')) }).toEqual({ text, width: 56 })
      }
      // Quotes are fullwidth only where both opening ones draw in the right half of an em and
      // both closing ones in the left (han_kerning.cc:525-534), so in a font whose opening quotes
      // alone, closing quotes alone or double quotes alone are an em wide a closing quote stays a
      // narrow mark, and `「` after it as it is. No browser was asked about such a font.
      const partlyWide: [string, number][] = [['Opening', 54.4], ['Closing', 64], ['Double', 64]]
      for (let q = 0; q < partlyWide.length; q++) {
        const [quotes, width] = partlyWide[q]!
        expect({ quotes, width: measureNaturalWidth(prepareWithSegments('中”「中', `16px Halt Wide ${quotes} Quotes Sans`)) }).toEqual({ quotes, width })
      }
      // A line that ends with a halted mark paints it halted, where what follows it takes no room:
      // a space, which fits with letter spacing where the mark and the gap after it don't, and
      // a preserved space that fits at the end of the text.
      const haltedCases: [string, { whiteSpace?: 'pre-wrap', letterSpacing?: number }, number, string[], number[]][] = [
        ['中」 中', { letterSpacing: 2 }, 35, ['中」 ', '中'], [28, 18]],
        ['中\u0001」 中', { letterSpacing: 2 }, 46, ['中\u0001」 ', '中'], [39.6, 18]],
        ['中」 ', { whiteSpace: 'pre-wrap' }, 30, ['中」 '], [29.28]],
        ['中」 \n中', { whiteSpace: 'pre-wrap' }, 30, ['中」 ', '中'], [29.28, 16]],
        ['中」 中', { whiteSpace: 'pre-wrap', letterSpacing: 2 }, 30, ['中」 ', '中'], [28, 18]],
      ]
      for (const [text, options, width, expected, widths] of haltedCases) {
        const prepared = prepareWithSegments(text, font, options)
        const lines = layoutWithLines(prepared, width, LINE_HEIGHT)
        expect({ text, options, width, lines: lines.lines.map(line => line.text), widths: lines.lines.map(line => line.width) })
          .toEqual({ text, options, width, lines: expected, widths })
        expect(collectStreamedLines(prepared, width)).toEqual(lines.lines)
        expect(layout(prepare(text, font, options), width, LINE_HEIGHT).lineCount).toBe(expected.length)
      }
      // A rich line halts a mark before a space only where no break before its item fits, as
      // the flat line does: one does after `中 ` and after a chip, and none after `中`. A mark
      // before text still halts at a line end after a break that fits.
      const richCases: [Array<{ text: string, break?: 'never', extraWidth?: number }>, number, string[]][] = [
        [[{ text: '中 ' }, { text: '中」 中' }], 46, ['中', '中」', '中']],
        [[{ text: '中 ' }, { text: '中」 中' }], 24, ['中', '中」', '中']],
        [[{ text: '中' }, { text: '」 中' }], 24, ['中」', '中']],
        [[{ text: '@ab', break: 'never', extraWidth: 8 }, { text: '「中」 中' }], 80, ['@ab', '「中」 中']],
        [[{ text: '中 ' }, { text: '中」中」 中' }], 48, ['中 中」', '中」', '中']],
      ]
      for (const [items, width, expected] of richCases) {
        const rich = prepareRichInline(items.map(item => ({ font, ...item })))
        const lines: string[] = []
        walkRichInlineLineRanges(rich, width, range => {
          lines.push(materializeRichInlineLineRange(rich, range).fragments.map(fragment => (fragment.gapBefore > 0 ? ' ' : '') + fragment.text).join('').trimEnd())
        })
        expect({ items, width, lines }).toEqual({ items, width, lines: expected })
        if (items.every(item => item.break === undefined)) {
          const text = items.map(item => item.text).join('')
          expect(layoutWithLines(prepareWithSegments(text, font), width, LINE_HEIGHT).lines.map(line => line.text.trimEnd())).toEqual(expected)
        }
      }
      // A pair that two rich-inline items split halts as in one text, as the marks read the
      // paragraph's text around their item (getHanKerningTrims): a closing mark before the next
      // item's closing mark or middle dot, wherever the line ends, and an opening mark after the
      // mark that ends the item before, but for where it starts a line. Each takes its own item's
      // font, so the pair halts across a change of weight or size too. From 56px, where no
      // line fills a pair's unit grapheme by grapheme, the lines and their widths are the text's.
      const richLines = (items: Array<{ text: string, font?: string, break?: 'never', extraWidth?: number } | RichInlineBox>, width: number): string[] => {
        const rich = prepareRichInline(items.map(item => (item.text === undefined ? item : { font, ...item })))
        const lines: string[] = []
        walkRichInlineLineRanges(rich, width, range => {
          lines.push(`${range.fragments.map(fragment => materializeRichInlineLineRange(rich, { ...range, fragments: [fragment] }).fragments[0]!.text).join('')}:${Math.round(range.width * 100) / 100}`)
        })
        expect(measureRichInlineStats(rich, width).lineCount).toBe(lines.length)
        return lines
      }
      const pairs: [string, string][] = [['中中」', '。中中'], ['中中」', '「中中'], ['中中）', '、中中'], ['中中「', '「中中'], ['中中」', '」中中'], ['中中。', '「中中'], ['中「中」', '。中'], ['中」', '·中']]
      for (const [first, second] of pairs) {
        const text = first + second
        const prepared = prepareWithSegments(text, font)
        for (let width = 56; width <= 104; width += 8) {
          const flat = layoutWithLines(prepared, width, LINE_HEIGHT).lines.map(line => `${line.text}:${Math.round(line.width * 100) / 100}`)
          expect({ first, second, width, lines: richLines([{ text: first }, { text: second }], width) }).toEqual({ first, second, width, lines: flat })
          expect({ first, second, width, lines: richLines([{ text: first, font: `700 ${font}` }, { text: second }], width) }).toEqual({ first, second, width, lines: flat })
        }
      }
      expect(richLines([{ text: '中中」' }, { text: '。中中' }], 88)).toEqual(['中中」。中中:88'])
      expect(richLines([{ text: '中中」' }, { text: '「中中' }], 88)).toEqual(['中中」「中中:88'])
      expect(richLines([{ text: '中中」' }, { text: '「中中' }], 71)).toEqual(['中中」:48', '「中中:48'])
      // The halted mark takes the trim of its own item's font: 10px at 20px.
      expect(richLines([{ text: '中中」', font: '20px Halt Test Sans' }, { text: '。中中' }], 1e5)).toEqual(['中中」。中中:98'])
      expect(richLines([{ text: '中中」' }, { text: '「中中', font: '20px Halt Test Sans' }], 1e5)).toEqual(['中中」「中中:98'])
      // Also a trim its item's own text never asked for, a dot's, which the pair is the first to
      // measure, after the item after it was measured in another font: 12px at 24px.
      expect(richLines([{ text: '中中。', font: '24px Halt Test Sans' }, { text: '」中' }], 1e5)).toEqual(['中中。」中:92'])
      // No pair crosses an atomic item, a box or a collapsed space.
      expect(measureRichInlineStats(prepareRichInline([{ text: '中」', font }, { width: 0 }, { text: '。中', font }]), 1e5).maxLineWidth).toBe(64)
      expect(measureRichInlineStats(prepareRichInline([{ text: '中」', font }, { text: '。', font, break: 'never' }, { text: '中', font }]), 1e5).maxLineWidth).toBe(64)
      expect(measureRichInlineStats(prepareRichInline([{ text: '中」 ', font }, { text: '。中', font }]), 1e5).maxLineWidth).toBe(69.28)
      // A closing mark that Blink halts at its item's end, where the item doesn't fit otherwise,
      // stays halted, and the line goes on after it, where one text node ends the line: `中中」`
      // and a 5px box take one 45px line at 46px.
      const halted = prepareRichInline([{ text: '中中」', font }, { width: 5 }])
      expect(measureRichInlineStats(halted, 46)).toEqual({ lineCount: 1, maxLineWidth: 45 })
      expect(measureRichInlineStats(halted, 53)).toEqual({ lineCount: 1, maxLineWidth: 53 })
      expect(measureRichInlineStats(halted, 52)).toEqual({ lineCount: 2, maxLineWidth: 48 })
      // Its fragment is as wide as the halted text, and the line's fragments add up to the line.
      expect(layoutNextRichInlineLineRange(halted, 46)!.fragments.map(fragment => fragment.occupiedWidth)).toEqual([40, 5])
      // Under letter spacing the halted fragment keeps the spacing after each of its characters.
      for (const [letterSpacing, width, widths] of [[1, 50, [43, 5.8]], [-1, 43, [37, 3.8]]] as const) {
        const spaced = prepareRichInline([{ text: '中中」', font, letterSpacing }, { text: 'i', font: `8px ${font.slice(font.indexOf(' ') + 1)}`, letterSpacing }, { text: ' 中', font, letterSpacing }])
        const line = layoutNextRichInlineLineRange(spaced, width)!
        expect({ letterSpacing, widths: line.fragments.map(fragment => Math.round(fragment.occupiedWidth * 100) / 100) }).toEqual({ letterSpacing, widths: [...widths] })
        expect(line.width).toBeCloseTo(widths[0] + widths[1], 9)
      }
      // An item with extraWidth keeps the halt at a line's end only: Blink fits its text before
      // its end edge.
      expect(richLines([{ text: '中中」', extraWidth: 8 }, { width: 5 }], 54)).toEqual(['中中」:48', ':5'])
      // Blink halts it only where a break comes right after it, and its scan gives none before
      // a space, so before its item's own trailing space, the next item's leading one or an item
      // of one, the mark keeps its width, as in one text; before a letter it halts.
      for (const items of [[{ text: '中中」 ' }, { text: '中' }], [{ text: '中中」' }, { text: ' 中' }], [{ text: '中中」' }, { text: ' ' }, { text: '中' }]]) {
        for (const width of [40, 47, 48]) {
          const flat = layoutWithLines(prepareWithSegments('中中」 中', font), width, LINE_HEIGHT).lines.map(line => `${line.text.trimEnd()}:${Math.round(line.width * 100) / 100}`)
          expect({ items, width, lines: richLines(items, width) }).toEqual({ items, width, lines: flat })
        }
        expect(richLines(items, 46)).toEqual(['中:16', '中」:32', '中:16'])
      }
      expect(richLines([{ text: '中中」' }, { text: '中' }], 46)).toEqual(['中中」:40', '中:16'])
      // Before a space the mark's line-end halt is left to a line broken between graphemes, which
      // an item of one character and the mark takes at 24-31px. A run of U+3000 that ends an
      // item keeps its hang before a space. And a closing mark halted by its pair has no
      // line-end halt left to take: `中中」` is 40px before `·`, never 32. Each as the text.
      const edges: [string, string, number, string[]][] = [
        ['中」', ' 中', 28, ['中」:24', '中:16']],
        ['中中\u3000', ' 中', 40, ['中中\u3000:32', '中:16']],
        ['中中」', '·中', 36, ['中:16', '中」·:33.6', '中:16']],
      ]
      for (const [first, second, width, expected] of edges) {
        expect({ first, second, width, lines: richLines([{ text: first }, { text: second }], width) }).toEqual({ first, second, width, lines: expected })
        const flat = layoutWithLines(prepareWithSegments(first + second, font), width, LINE_HEIGHT).lines.map(line => `${line.text.replace(/ $/, '')}:${Math.round(line.width * 100) / 100}`)
        expect({ first, second, width, lines: flat }).toEqual({ first, second, width, lines: expected })
      }
      // Before a period, which gives no break either, the mark halts only on a line broken
      // between graphemes too, and there the mark that ends its item stays halted and the line
      // goes on: `中」` halted and the period take 30.4px. So does a mark alone in its item
      // after text with no break on its line.
      expect(richLines([{ text: '中中」' }, { text: '.中' }], 30)).toEqual(['中:16', '中」:24', '.中:22.4'])
      expect(richLines([{ text: '中中」' }, { text: '.中' }], 31)).toEqual(['中:16', '中」.:30.4', '中:16'])
      expect(richLines([{ text: '中中」' }, { text: '.中' }], 32)).toEqual(['中:16', '中」:32', '.中:22.4'])
      expect(richLines([{ text: 'ab' }, { text: '」' }, { text: '.x' }], 33)).toEqual(['ab」:27.2', '.x:16'])
      expect(richLines([{ text: 'ab' }, { text: '」' }, { text: '.x' }], 34)).toEqual(['ab」.:33.6', 'x:9.6'])
      expect(layoutNextRichInlineLineRange(prepareRichInline([{ text: 'ab', font }, { text: '」', font }, { text: '.x', font }]), 34)!.fragments.map(fragment => Math.round(fragment.occupiedWidth * 100) / 100)).toEqual([19.2, 8, 6.4])
      // Not after an item with extraWidth: where its text fits before its end edge, as with 1px
      // on each side at 33px, Blink leaves the mark whole and the period wraps.
      expect(richLines([{ text: '中中」', extraWidth: 2 }, { text: '.中' }], 33).map(line => line.slice(0, line.indexOf(':')))).toEqual(['中', '中」', '.中'])
      // A run of U+3000 that ends an item hangs whatever the next item starts with, where a
      // text's run hangs only before a break its scan gives (ENGINE_FOLLOWUPS.md, Line edges).
      for (const second of ['\u200B中', '」中', { width: 0 }]) {
        expect({ second, lines: richLines([{ text: '中中\u3000' }, typeof second === 'string' ? { text: second } : second], 24).slice(0, 2) }).toEqual({ second, lines: ['中:16', second === '\u200B中' ? '中\u3000\u200B:16' : '中\u3000:16'] })
      }
      // In pre-wrap the next item's preserved space, tab or line feed joins the mark's text, which
      // gives no break before it, and a ZWSP that starts the next item gives none in either mode.
      for (const [second, whiteSpace] of [[' 中', 'pre-wrap'], ['\t中', 'pre-wrap'], ['\n中', 'pre-wrap'], ['\u200B中', 'normal']] as const) {
        for (const width of [40, 46, 47, 48]) {
          const rich = prepareRichInline([{ text: '中中」', font }, { text: second, font }], { whiteSpace })
          const lines: string[] = []
          walkRichInlineLineRanges(rich, width, range => {
            lines.push(`${materializeRichInlineLineRange(rich, range).fragments.map(fragment => fragment.text).join('')}:${range.width}`)
          })
          const flat = layoutWithLines(prepareWithSegments(`中中」${second}`, font, { whiteSpace }), width, LINE_HEIGHT).lines.map(line => `${line.text}:${line.width}`)
          expect({ second, width, lines }).toEqual({ second, width, lines: flat })
          expect(lines.length).toBe(width < 48 ? 3 : 2)
        }
      }
      // A space before a box or a chip is such a space too, in its own item or the mark's. A
      // chip's own leading space is none: its box trims it, so a break comes right after the
      // mark, which halts as before a chip without one.
      for (const items of [[{ text: '中中」 ' }, { width: 5 }], [{ text: '中中」' }, { text: ' ' }, { width: 5 }]]) {
        expect({ items, lines: richLines(items, 46) }).toEqual({ items, lines: ['中:16', '中」:42.28'] })
        expect({ items, lines: richLines(items, 48) }).toEqual({ items, lines: ['中中」:48', ':5'] })
      }
      expect(richLines([{ text: '中中」' }, { width: 5 }], 46)).toEqual(['中中」:45'])
      for (const text of [' @a ', ' @a', '@a']) {
        expect({ text, lines: richLines([{ text: '中中」' }, { text, break: 'never', extraWidth: 8 }, { text: '中' }], 46) }).toEqual({ text, lines: ['中中」:40', '@a中:43.2'] })
      }
      // Nor is the white space of a chip that holds nothing else, an object as wide as its
      // extraWidth, before text or a box: it fits after the halted mark, as a box does.
      expect(richLines([{ text: '中中」' }, { text: ' ', break: 'never', extraWidth: 5 }, { text: '中' }], 46)).toEqual(['中中」:45', '中:16'])
      expect(richLines([{ text: '中中」' }, { text: ' ', break: 'never', extraWidth: 5 }, { width: 5 }], 46)).toEqual(['中中」:45', ':5'])
      // Nor is a space that starts the item after such a chip, which the chip comes before.
      expect(richLines([{ text: '中中」' }, { text: ' ', break: 'never', extraWidth: 5 }, { text: ' 中' }], 46)).toEqual(['中中」:45', '中:16'])
      expect(richLines([{ text: '中中」 ' }, { text: ' ', break: 'never', extraWidth: 5 }, { text: '中' }], 46)).toEqual(['中:16', '中」:42.28', '中:16'])
      expect(richLines([{ text: '中中」' }, { text: ' ' }, { text: ' ', break: 'never', extraWidth: 5 }, { text: ' 中' }], 46)).toEqual(['中:16', '中」:42.28', '中:16'])
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
      expect(countPreparedLines(internals(prepared), width)).toBe(expected.length)
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
      expect(countPreparedLines(internals(prepared), width)).toBe(expected.length)
      expect(layout(compact, width, LINE_HEIGHT).lineCount).toBe(expected.length)
      for (const nextWidth of [0, width / 2, width, 0]) {
        const next = layoutWithLines(prepared, nextWidth, LINE_HEIGHT)
        expect(countPreparedLines(internals(prepared), nextWidth)).toBe(next.lineCount)
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

// A child process, as the library computes its engine profile once per process. It loads the watchdog first
// (harness/watchdog.ts) and is killed after 10 s.
function runInChild(script: string): string {
  const watchdog = new URL('../harness/watchdog.ts', import.meta.url).pathname
  const child = Bun.spawnSync([process.execPath, '--preload', watchdog, '-e', script], { timeout: 10_000, killSignal: 'SIGKILL' })
  if (child.exitCode !== 0) throw new Error(child.exitedDueToTimeout === true ? 'the child process ran over 10 s' : child.stderr.toString())
  return child.stdout.toString()
}

test('the Safari profile breaks inside rich items from each item alone', () => {
  // The engine profile is computed once per process, so Safari runs in a child
  // process. Letters are 8px and marks and spaces 4px. WebKit breaks inside an
  // inline box from that box's text, and reads only the previous box's last
  // two characters at a boundary. The Thai item's own last run moves with the
  // continuation, where the joined text would split the word differently. The
  // Myanmar continuation is only the vowel sign: analysis of the second item
  // alone would join that sign to the word after it. A U+2028 that the WebKit scan
  // makes a hard break ends its line, after the item before it too, and a collapsed
  // space before it takes no room.
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
      [['ab\\u2028cd', ' ef'], 40],
      [['x', '\\u2028y'], 20],
      [['xx', ' \\u2028yy'], 18],
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
  expect(JSON.parse(runInChild(script))).toEqual([
    [['\u0E04\u0E27\u0E32\u0E21'], ['\u0E2A\u0E27\u0E22'], ['\u0E07', '\u0E32\u0E21'], ['\u0E02\u0E2D\u0E07']],
    [['\u1019\u102C\u1018\u102C'], ['\u101E', '\u102C'], ['\u101E\u100A\u103A'], ['\u101C\u103E\u1015']],
    [['ab'], ['cd', 'ef']],
    [['x', ''], ['y']],
    [['xx', ''], ['yy']],
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
  const result = JSON.parse(runInChild(script)) as {
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
      if (streamed.push(range.width) > 5) throw new Error('layoutNextLineRange gives more than 5 lines')
      range = layoutNextLineRange(remainder, range.end, 8.5)
    }
    const rich = []
    walkRichInlineLineRanges(prepareRichInline([{ text: 'A\\u2060 B', font: '16px Test' }]), 8.5, line => rich.push(line.width))
    const paragraphs = [['AA\\u2060 B\\n\\u202Ax', 'pre-wrap'], ['AA\\u2060 B\\u2029\\u202Ax', 'normal'], ['AA\\u2060 B\\u202Ax', 'normal']]
      .map(([text, whiteSpace]) => prepareWithSegments(text, '16px Test', { whiteSpace }).widths[0])
    const quote = layoutWithLines(prepareWithSegments('a\\u00AD\\u201Cb', '16px Test', { whiteSpace: 'pre-wrap' }), 20, 20).lines.map(line => line.text)
    console.log(JSON.stringify({ kerning, spaced, wordMeasurements, paragraphs, quote, remainder: {
      lines: layoutWithLines(remainder, 8.5, 20).lines.map(line => [line.text, line.width, line.start.segmentIndex, line.start.graphemeIndex, line.end.segmentIndex, line.end.graphemeIndex]),
      signed,
      streamed,
      rich,
      lineCount: layout(prepare('A\\u2060 B', '16px Test'), 8.5, 20).lineCount,
    } }))
  `
  const { kerning, spaced, wordMeasurements, paragraphs, quote, remainder } =
    JSON.parse(runInChild(script)) as Record<'kerning' | 'spaced' | 'wordMeasurements' | 'paragraphs' | 'quote' | 'remainder', unknown>
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
  // Safari 27 lets an opening curly quote start a line after a soft hyphen,
  // which paints its hyphen at the end of the line before.
  expect(quote).toEqual(['a-', '\u201Cb'])
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


test('the Chromium profile takes the kerning between a word and the spaces beside it', () => {
  // The engine profile is computed once per process, so Chrome runs in a child
  // process. A is 10px, other letters 8px, a space 4px, format characters and
  // marks 0px. Canvas cuts a string at U+0020 and kerns nothing across it. U+2028
  // draws the space glyph, 4px, without a cut: in one string A kerns -1px with a
  // space glyph after it, past a word joiner, B +1px, and a space glyph -2px with a
  // Latin or Cyrillic T after it, and a mark after a space glyph sits on it, 3px
  // narrower. Under fontKerning 'none' nothing kerns. The `Plain` fonts kern nothing
  // under either, and `16px Cyrillic` only the Cyrillic T. In `16px Glyph` U+2028 has a
  // glyph of its own, 8px. Widths are float32, as Canvas's are, and W is 253 + 1/65536
  // px, so W with a space glyph, past 256px, loses its last bit.
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const richInlineUrl = new URL('./rich-inline.ts', import.meta.url).href
  const script = `
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
    } })
    const measured = []
    class Context {
      font = ''
      letterSpacing = '0px'
      fontKerning = 'auto'
      measureText(text) {
        measured.push(this.fontKerning === 'auto' ? text : this.fontKerning + ':' + text)
        let width = 0
        for (const ch of text) width += ch === ' ' ? 4 : ch === '\\u2028' ? (this.font.includes('Glyph') ? 8 : 4) : /[\\u2060\\u0301]/.test(ch) ? 0 : ch === 'A' ? 10 : ch === 'W' ? 253 + 1 / 65536 : 8
        const pairs = this.font.includes('Cyrillic') ? [/(?!)/g, /(?!)/g, /\\u2028\\u0422/g] : [/A\\u2060*\\u2028/g, /B\\u2028/g, /\\u2028[T\\u0422]/g]
        const kerning = this.fontKerning === 'none' || this.font.includes('Plain') ? 0 : (text.match(pairs[0]) ?? []).length - (text.match(pairs[1]) ?? []).length + 2 * (text.match(pairs[2]) ?? []).length
        return { width: Math.fround(width - kerning - 3 * (text.match(/\\u2028\\u0301/g) ?? []).length) }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const { prepare, prepareWithSegments, layout, layoutWithLines } = await import(${JSON.stringify(layoutUrl)})
    const { prepareRichInline, measureRichInlineStats } = await import(${JSON.stringify(richInlineUrl)})
    const widths = []
    for (const [text, font, options] of [
      ['AA TT', '16px Test', {}], ['TT AA', '16px Test', {}], ['AA  TT', '16px Test', { whiteSpace: 'pre-wrap' }],
      ['AA\\u2060 \\u2060TT', '16px Test', {}], ['AA \\u0301T', '16px Test', {}], ['AA TT', '16px Test', { letterSpacing: 1 }],
      ['\\u0436\\u0436 TT', '16px Test', {}], ['\\u0436\\u0436 \\u0422\\u0422', '16px Test', {}], ['TT \\u0436\\u0436, TT', '16px Test', {}],
      ['12 TT', '16px Test', {}], ['AA TT', '16px Glyph', {}],
      ['  TT\\n TT', '16px Test', { whiteSpace: 'pre-wrap' }], ['\\u0436\\u0436 \\u2060TT', '16px Test', {}],
      ['\\u0436\\u0436 (TT) TT', '16px Test', {}], ['TT (\\u0436\\u0436) TT', '16px Test', {}], ['(TT) \\u0422\\u0422', '16px Test', {}],
      ['(12) TT', '16px Test', {}], ['\\u05D0 AA TT AA \\u05D1', '16px Test', {}], ['\\u202AAA TT', '16px Test', {}],
      ['AA T\\u0301T', '16px Test', {}],
      ['TT\\u3002 TT', '16px Test', {}], ['TT \\u00B7 TT', '16px Test', {}], ['\\u03B1\\u03B1 \\u00B7 TT', '16px Test', {}],
      ['\\u3231 TT', '16px Test', {}],
      ['TT \\uFF08TT\\uFF09 TT', '16px Test', {}], ['TT \\uFF08 TT', '16px Test', {}], ['(\\u00B7 \\u0436\\u0436) TT', '16px Test', {}],
      ['\\u0436\\u0436 (TT [TT] TT) TT', '16px Test', {}], ['\\u0436\\u0436 (TT] TT', '16px Test', {}], ['TT \\uFE35 TT', '16px Test', {}],
      ['TT 1\\u0342 TT', '16px Test', {}], ['\\u{10400}\\u{10401} TT', '16px Test', {}],
      ['BB TT', '16px Test', {}], ['xW y', '16px Wide', {}], ['y Wx', '16px Wide', {}],
      ['AA TT', '16px Plain', {}], ['\\u0436\\u0436 \\u0422\\u0422', '16px Cyrillic', {}],
    ]) widths.push(prepareWithSegments(text, font, options).widths)
    const lines = []
    for (const [text, width, font] of [['AA TT', 20, '16px Test'], ['AA TT', 37, '16px Test'], ['AAA TT', 10.5, '16px Test'], ['BB TT', 16.5, '16px Test']]) {
      const result = layoutWithLines(prepareWithSegments(text, font), width, 20)
      lines.push({ lines: result.lines.map(line => [line.text, line.width]), lineCount: layout(prepare(text, font), width, 20).lineCount })
    }
    const rich = [[{ text: 'AA TT', font: '16px Test' }], [{ text: 'AA', font: '16px Test' }, { text: ' TT', font: '16px Test' }]]
      .map(items => measureRichInlineStats(prepareRichInline(items), 100).maxLineWidth)
    // What a prepare asks Canvas with a U+2028 in it, the font's probe as its length.
    const asks = (text, font) => {
      measured.length = 0
      prepare(text, font)
      return measured.filter(text => text.includes('\\u2028')).map(text => text.length > 9 ? text.slice(0, text.indexOf('\\u2028')) + (text.length - text.indexOf('\\u2028')) : text)
    }
    const asked = asks('AA TT AT TA AA TT', '16px Fresh')
    const cut = measured.filter(text => text.length > 1 && text.includes(' '))
    const fontAsked = [asks('AATT', '16px Fresh Two'), asks('AA TT AT', '16px Plain Two'), asks('AA TT', '16px Plain Two'), asks('AA TT', '16px Glyph Two')]
    const unasked = [asks('\\u6F22 \\u3042 \\u30A2 \\uD55C\\uAD6D \\u6F22', '16px Words'), asks('\\u05D0 AA TT', '16px Mixed')]
    console.log(JSON.stringify({ widths, lines, rich, asked, fontAsked, unasked, cut }))
  `
  const { widths, lines, rich, asked, fontAsked, unasked, cut } = JSON.parse(runInChild(script)) as Record<'widths' | 'lines' | 'rich' | 'asked' | 'fontAsked' | 'unasked' | 'cut', unknown>
  expect(widths).toEqual([
    // The space takes the word's kerning with it, which tightens the two, and its own with
    // the word after it.
    [20, 1, 16],
    [16, 4, 20],
    // The first and the last of a run of preserved spaces.
    [20, 5, 16],
    // HarfBuzz's lookups skip a word joiner, on either side.
    [20, 1, 16],
    // A mark after the space is the space's own cluster, no pair with it.
    [20, 3, 8],
    // Letter spacing keeps the kerning.
    [21, 1, 17],
    // The space is in the script run of the text before it: after Cyrillic it kerns
    // with a Cyrillic word, not with a Latin one, and a comma keeps the run's script.
    [16, 4, 16],
    [16, 2, 16],
    [16, 4, 24, 4, 16],
    // Before any script the run takes the script of what follows.
    [16, 2, 16],
    // Where U+2028 doesn't measure as the space, no kerning is taken.
    [20, 4, 16],
    // Preserved spaces that start the text or follow a line feed are an item of their own.
    [8, 16, 0, 4, 16],
    // The script is read at the letter whose kerning is taken, past a word joiner.
    [16, 4, 16],
    // A closing bracket takes the script of the run its opening bracket is in, so the space
    // after it kerns with a word of that script only. A bracket that starts the text is in
    // the run of the first letter after it, or of the word past the space when none comes.
    [16, 4, 32, 4, 16],
    [16, 4, 32, 2, 16],
    [32, 4, 16],
    [32, 2, 16],
    // Which spaces share a level with a word depends on the paragraph's direction once a
    // text holds a right-to-left letter or an explicit bidi control, so such a text takes no
    // kerning.
    [8, 4, 20, 4, 16, 4, 20, 4, 8],
    [28, 4, 16],
    // A first letter with a combining mark after it may be drawn as one glyph, which the
    // bare letter's kerning with the space says nothing about.
    [20, 3, 16],
    // Script_Extensions: an ideographic full stop is in East Asian scripts only, so it ends a
    // Latin run and the space after it is in its run. A middle dot is in Latin and Greek among
    // others: it goes on a Latin run, and after Greek it leaves the run Greek.
    [24, 4, 16],
    [16, 4, 8, 2, 16],
    [16, 4, 8, 4, 16],
    // A parenthesized ideograph, which Han alone lists, is a Common character still and stays in
    // any run: the space after it is in the run of the word that follows.
    [8, 2, 16],
    // A fullwidth opening bracket is in the Han scripts, a run of its own, which its closing
    // bracket takes, and which the space after it is in.
    [16, 4, 32, 4, 16],
    [16, 4, 8, 4, 16],
    // A bracket opened in a run that ends with several scripts left takes the first of them, and
    // Latin is the last: after a middle dot, which Latin and Greek share, the run is Greek, so
    // the space after the closing bracket doesn't kern with a Latin word.
    [16, 4, 24, 4, 16],
    // Brackets pair as Unicode pairs them, the ones opened since closing with theirs: the
    // outer closing bracket goes back to the Cyrillic run past an inner pair, a closing
    // bracket that pairs with none stays in its run, and a bracket Unicode gives no pair, as
    // a vertical form, is no bracket.
    [16, 4, 24, 4, 32, 2, 24, 4, 16],
    [16, 4, 32, 2, 16],
    [16, 4, 8, 2, 16],
    // A digit under a mark that only Greek lists is Greek, so the space after it is.
    [16, 4, 16, 4, 16],
    // A letter outside the Basic Multilingual Plane has its script like any other.
    [16, 4, 16],
    // A kerning that widens the two stays on the word.
    [17, 2, 16],
    // What float32 rounding leaves between a pair's width and its parts' is no kerning.
    [261, 4, 8],
    [8, 4, 261],
    // A font is asked once whether it kerns the printable ASCII characters with the space. One
    // that kerns none takes no kerning, with a character outside them either: the premise's gap.
    [20, 4, 16],
    [16, 4, 16],
  ])
  expect(lines).toEqual([
    // The space hangs with the kerning it took from both words, so a line that ends there
    // has the word without it.
    { lines: [['AA ', 20], ['TT', 16]], lineCount: 2 },
    { lines: [['AA TT', 37]], lineCount: 1 },
    { lines: [['A', 10], ['A', 10], ['A ', 10], ['T', 8], ['T', 8]], lineCount: 5 },
    // A word needs the room of a kerning that widens it, on its last letter where it breaks.
    { lines: [['B', 8], ['B ', 9], ['TT', 16]], lineCount: 3 },
  ])
  // A space kerns with the words of its own rich item, as in plain text, and not with a
  // word of another item (ENGINE_FOLLOWUPS.md): `AA`, ` TT` take the kerning of ` T` alone.
  expect(rich).toEqual([37, 38])
  // The font is asked once whether it kerns the space: U+2028 between the printable ASCII
  // characters, 189 units, as the context stands and under fontKerning 'none', then U+2028
  // alone. Then each edge letter once with U+2028, however many words share the letter. No
  // string holds a U+0020 beside other text.
  expect(asked).toEqual(['189', 'none:189', '\u2028', '\u2028A', 'A\u2028', '\u2028T', 'T\u2028'])
  expect(cut).toEqual([])
  // A text without a space doesn't ask the font. A font that kerns nothing is asked once and
  // its words never; one whose U+2028 isn't the space likewise.
  expect(fontAsked).toEqual([[], ['189', 'none:189'], [], ['189', 'none:189', '\u2028']])
  // Canvas shapes an ideograph or a kana as a word of its own, no font kerns a Hangul syllable
  // with the space, and text that mixes directions takes no kerning, so only their fonts are
  // asked.
  expect(unasked).toEqual([['189', 'none:189', '\u2028'], ['189', 'none:189', '\u2028']])
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
  const output = runInChild(script)
  // Apple ICU opens its normal line rules, where CJ is ID, for ja and ko. Under
  // its other rules CJ is NS and stays with the character before it. The first
  // preparation after a language change reads the language once too.
  const root = { segments: ['日|本ァ|ア', '日|本ーー', 'わ|かっ|て'], readsPerPrepare: 1, rich: ['日', '本ァ', 'ア'] }
  const normalRules = { segments: ['日|本|ァ|ア', '日|本|ー|ー', 'わ|か|っ|て'], readsPerPrepare: 1, rich: ['日本', 'ァア'] }
  expect(JSON.parse(output)).toEqual({ '': root, en: root, 'zh-Hant': root, ja: normalRules, 'ko-KR': normalRules })
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
  const { rows, intl } = JSON.parse(runInChild(script)) as { rows: Record<string, string[]>; intl: string }
  expect(rows).toEqual({ '': [intl], en: ['en'] })
})

test('letter-spaced text is measured as each engine\'s Canvas shapes it', () => {
  // The engine profile is computed once per process, so each engine runs in a child
  // process. Every character is 8px and `fi` ligates, 3px narrower. Like Chrome's and
  // Firefox's, the context shapes without the ligature under any letterSpacing but 0, and
  // adds a spacing only from 1/65536 px. Safari's keeps the ligature under letterSpacing,
  // so the WebKit profile leaves the context's alone and measures the ligature.
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const richInlineUrl = new URL('./rich-inline.ts', import.meta.url).href
  const rowsOf = (userAgent: string): unknown => JSON.parse(runInChild(`
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ${JSON.stringify(userAgent)} } })
    const log = []
    class Context {
      font = ''
      letterSpacing = '0px'
      measureText(text) {
        log.push(this.letterSpacing)
        const spacing = Number.parseFloat(this.letterSpacing)
        const count = [...text].length
        const ligatures = spacing === 0 ? text.split('fi').length - 1 : 0
        return { width: count * 8 - ligatures * 3 + (Math.abs(spacing) >= 1 / 65536 ? count * spacing : 0) }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const { prepareWithSegments, layoutWithLines } = await import(${JSON.stringify(layoutUrl)})
    const { prepareRichInline, measureRichInlineStats } = await import(${JSON.stringify(richInlineUrl)})
    const font = '16px Test'
    const row = letterSpacing => {
      const before = log.length
      const prepared = prepareWithSegments('fig find', font, { letterSpacing })
      return [prepared.widths, prepared.breakableFitAdvances[2], layoutWithLines(prepared, 76, 20).lineCount, [...new Set(log.slice(before))], log.length - before]
    }
    // Without spacing, under two spacings, which share their measurements, and without again.
    const rows = [row(0), row(2), row(-1), row(0)]
    // A letter-spaced item between items that aren't.
    const rich = prepareRichInline([{ text: 'fig ', font }, { text: 'fig', font, letterSpacing: 2 }, { text: ' fig', font }])
    console.log(JSON.stringify([...rows, measureRichInlineStats(rich, 1000).maxLineWidth]))
  `))
  // Each row: the segments' widths, the advances a break inside `find` falls by, the lines
  // at 76px, the letterSpacing the context measured under, and its measureText calls. The
  // Chromium profile asks the font twice more, under each letterSpacing it measures with,
  // whether it kerns the space (getFontSpaceKerning).
  const shaped = (fontCalls: number): unknown => [
    [[21, 8, 29], [8, 8, 8, 8], 1, ['0px'], 9 + fontCalls],
    [[28, 8, 38], [8, 8, 8, 8], 2, ['0.000001px'], 7 + fontCalls],
    [[22, 8, 29], [8, 8, 8, 8], 1, [], 0],
    [[21, 8, 29], [8, 8, 8, 8], 1, [], 0],
    88,
  ]
  expect(rowsOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36')).toEqual(shaped(2))
  expect(rowsOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0')).toEqual(shaped(0))
  expect(rowsOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15')).toEqual([
    [[21, 8, 29], [8, 5, 8, 8], 1, ['0px'], 7],
    [[25, 8, 35], [8, 5, 8, 8], 1, ['0px'], 1],
    [[19, 8, 26], [8, 5, 8, 8], 1, [], 0],
    [[21, 8, 29], [8, 5, 8, 8], 1, [], 0],
    85,
  ])
})

test('the Firefox profile resolves letter spacing to whole app units', () => {
  // The engine profile is computed once per process, so each engine runs in a child
  // process. Every character is 8px and `fi` ligates, 3px narrower, unless the context has
  // a letterSpacing. Firefox 156 gives each letter these app units, 1/60 px, at these
  // spacings, rounding half away from zero, and keeps ligatures where the spacing rounds to 0.
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const spacings: Array<[number, number]> = [
    [-0.08, -5], [-0.17, -10], [0.15, 9], [0.2, 12], [-0.2, -12], [0.375, 23], [-0.375, -23], [0.125, 8], [-0.125, -8],
    [0.025, 2], [-0.025, -2], [1 / 120, 1], [-1 / 120, -1], [0.0084, 1], [0.0083, 0], [-0.008, 0], [1e300, 2 ** 30 - 1],
  ]
  const rowsOf = (userAgent: string): Array<[number, number, number]> => JSON.parse(runInChild(`
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ${JSON.stringify(userAgent)} } })
    class Context {
      font = ''
      letterSpacing = '0px'
      measureText(text) {
        return { width: [...text].length * 8 - (this.letterSpacing === '0px' ? 3 * (text.split('fi').length - 1) : 0) }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const { prepareWithSegments, measureNaturalWidth } = await import(${JSON.stringify(layoutUrl)})
    // Each letter's spacing in app units, and the width of \`fi\` without its two gaps.
    console.log(JSON.stringify(${JSON.stringify(spacings)}.map(([spacing]) => {
      const gap = measureNaturalWidth(prepareWithSegments('ab', '16px Test', { letterSpacing: spacing })) - 16
      return [spacing, gap * 30, measureNaturalWidth(prepareWithSegments('fi', '16px Test', { letterSpacing: spacing })) - gap]
    })))
  `)) as Array<[number, number, number]>
  const firefox = rowsOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0')
  for (let i = 0; i < spacings.length; i++) {
    const [spacing, units] = spacings[i]!
    expect({ spacing, units: Math.round(firefox[i]![1] * 1e6) / 1e6, fi: Math.round(firefox[i]![2]) }).toEqual({ spacing, units, fi: units === 0 ? 13 : 16 })
  }
  // Chrome keeps the spacing as given.
  const chrome = rowsOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36')
  for (let i = 0; i < spacings.length - 1; i++) expect(chrome[i]![1]).toBeCloseTo(spacings[i]![0] * 60, 9)
})

test('the Chromium profile cuts a word as lines shaped alone', () => {
  // The engine profile is computed once per process, so each engine runs in a child
  // process. A letter is 8px and a full stop 4px. `To` kern, 3px narrower, and `ffi` is a
  // ligature, 6px narrower than its letters, of which `fi` alone has 2px. Each row: the
  // advances a cut falls by, what a line that starts at each letter adds to it, the lines
  // with their widths, as layoutWithLines(), layout(), the stream and the full walker give
  // them, and the strings of two or more letters Canvas was asked, the word aside.
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const rowsOf = (userAgent: string): unknown => JSON.parse(runInChild(`
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ${JSON.stringify(userAgent)} } })
    const asked = []
    class Context {
      font = ''
      letterSpacing = '0px'
      fontKerning = 'auto'
      measureText(text) {
        if (text.length > 1) asked.push(text)
        const ligatures = text.split('ffi').length - 1
        return { width: [...text].length * 8 - 4 * (text.split('.').length - 1) - 3 * (text.split('To').length - 1) - 6 * ligatures - 2 * (text.split('fi').length - 1 - ligatures) }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const { prepare, prepareWithSegments, layout, layoutWithLines, layoutNextLine } = await import(${JSON.stringify(layoutUrl)})
    const font = '16px Test'
    const row = (text, width, letterSpacing = 0) => {
      asked.length = 0
      const prepared = prepareWithSegments(text, font, { letterSpacing })
      const questions = asked.filter(question => question !== text)
      const lines = layoutWithLines(prepared, width, 20).lines.map(line => [line.text, line.width])
      const stream = []
      for (let line = layoutNextLine(prepared, { segmentIndex: 0, graphemeIndex: 0 }, width); line !== null; line = layoutNextLine(prepared, line.end, width)) stream.push([line.text, line.width])
      // Preserved spaces send a text to the full walker.
      const walked = layoutWithLines(prepareWithSegments('  ' + text, font, { whiteSpace: 'pre-wrap', letterSpacing }), width, 20).lines.slice(1).map(line => [line.text, line.width])
      const same = layout(prepare(text, font, { letterSpacing }), width, 20).lineCount === lines.length && JSON.stringify(stream) === JSON.stringify(lines) && JSON.stringify(walked) === JSON.stringify(lines)
      return [prepared.breakableFitAdvances[0], prepared.breakableLineStartExtras === null ? null : prepared.breakableLineStartExtras[0], lines, same, questions]
    }
    console.log(JSON.stringify([row('To.To.To.To.To.', 44), row('aaaaaaaaaaaa', 44), row('To.To.', 14), row('aaaaffiaaaaa', 44), row('To.To.To.To.To.', 44, 1)]))
  `))
  expect(rowsOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36')).toEqual([
    // Each letter after the one before it, so a line holds its kerning: seven letters are
    // 42px, where they are 48px alone. The line after starts with `o` alone, 8px, so its
    // seven letters are 42px too and the last full stop takes a third line; the prefixes'
    // differences give that `o` 5px and keep all eight letters, 43px, on the second.
    [
      [8, 5, 4, 8, 5, 4, 8, 5, 4, 8, 5, 4, 8, 5, 4], [0, 3, 0, 0, 3, 0, 0, 3, 0, 0, 3, 0, 0, 3, 0],
      [['To.To.T', 42], ['o.To.To', 42], ['.', 4]], true, ['To', 'o.', '.T'],
    ],
    // A word as wide as its letters alone is fit from them, with nothing more asked.
    [[8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8], null, [['aaaaa', 40], ['aaaaa', 40], ['aa', 16]], true, []],
    // A word under 80px adds up its letters alone, kerned or not.
    [[8, 8, 4, 8, 8, 4], null, [['T', 8], ['o.', 12], ['T', 8], ['o.', 12]], true, []],
    // Where the pairs don't add up to the word, as around a ligature of three letters, its
    // prefixes are measured. The second line shows what that leaves, not the premise: it
    // starts inside the ligature, and its `i` keeps the 2px it has after `ff`, so `fiaaaa`
    // comes to 42px where that text alone is 46px here, wider than the box, and Chrome, which
    // shapes `fi` again, would end the line a letter earlier (ENGINE_FOLLOWUPS.md, Emergency
    // breaks inside a word).
    [
      [8, 8, 8, 8, 8, 8, 2, 8, 8, 8, 8, 8], [0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0],
      [['aaaaf', 40], ['fiaaaa', 42], ['a', 8]], true,
      ['aa', 'af', 'ff', 'fi', 'ia', 'aaa', 'aaaa', 'aaaaf', 'aaaaff', 'aaaaffi', 'aaaaffia', 'aaaaffiaa', 'aaaaffiaaa', 'aaaaffiaaaa'],
    ],
    // Letter-spaced text keeps its prefixes, and its lines start as they come.
    [
      [8, 5, 4, 8, 5, 4, 8, 5, 4, 8, 5, 4, 8, 5, 4], null,
      [['To.To.', 40], ['To.To.', 40], ['To.', 20]], true, ['To', 'To.', 'To.T', 'To.To', 'To.To.', 'To.To.T', 'To.To.To', 'To.To.To.', 'To.To.To.T', 'To.To.To.To', 'To.To.To.To.', 'To.To.To.To.T', 'To.To.To.To.To'],
    ],
  ])
  // WebKit carries the rest of a cut word's width, and Gecko leaves a pair's kerning where
  // the word shaped whole has it. Neither is ported: both profiles take the lines of a kerned
  // word from its prefixes (ENGINE_FOLLOWUPS.md, Emergency breaks inside a word).
  for (const userAgent of [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
  ]) {
    expect((rowsOf(userAgent) as unknown[][])[0]!.slice(0, 4))
      .toEqual([[8, 5, 4, 8, 5, 4, 8, 5, 4, 8, 5, 4, 8, 5, 4], null, [['To.To.T', 42], ['o.To.To.', 43]], true])
  }
})

test('a rich-inline paragraph cuts a kerned word as its text is cut, and the fragment that starts a line inside the word takes the width a line start adds', () => {
  // The Chromium profile and the Canvas of the test above: letters are 8px, a full stop kerns
  // 4px under the letter before it and `To` 3px. The word is 81px, so it is fit as Chrome's
  // lines are shaped: its second line starts with `o` alone, 8px where the `o` after `T` is
  // 5px. That line's first fragment holds those 3px, and the item after it its own width.
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const richUrl = new URL('./rich-inline.ts', import.meta.url).href
  const out: unknown = JSON.parse(runInChild(`
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36' } })
    class Context {
      font = ''
      letterSpacing = '0px'
      fontKerning = 'auto'
      measureText(text) {
        return { width: [...text].length * 8 - 4 * (text.split('.').length - 1) - 3 * (text.split('To').length - 1) }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const { prepareWithSegments, layoutWithLines } = await import(${JSON.stringify(layoutUrl)})
    const { prepareRichInline, walkRichInlineLineRanges, materializeRichInlineLineRange, measureRichInlineStats } = await import(${JSON.stringify(richUrl)})
    const font = '16px Test'
    const plain = layoutWithLines(prepareWithSegments('To.To.To.To.To b', font), 60, 20).lines.map(line => [line.text, line.width])
    const prepared = prepareRichInline([{ text: 'To.To.To.To.To', font }, { text: ' b', font }])
    const rich = []
    walkRichInlineLineRanges(prepared, 60, range => {
      const line = materializeRichInlineLineRange(prepared, range)
      rich.push([line.fragments.map(fragment => [fragment.text, fragment.gapBefore, fragment.occupiedWidth]), line.width])
    })
    console.log(JSON.stringify([plain, rich, measureRichInlineStats(prepared, 60)]))
  `))
  expect(out).toEqual([
    [['To.To.To.T', 59], ['o.To b', 41]],
    [[[['To.To.To.T', 0, 59]], 59], [[['o.To', 0, 25], ['b', 8, 8]], 41]],
    { lineCount: 2, maxLineWidth: 59 },
  ])
})

test('the Firefox profile counts a ligature whole on its first letter where it cuts a word', () => {
  // The engine profile is computed once per process, so each engine runs in a child
  // process. Every letter is 8px. `fi` is a ligature, 3px narrower than its letters, which
  // the context turns off under any letterSpacing but 0, as Firefox's does. `AV` kern and
  // `xy` join, as two Arabic letters do, 2px narrower under every letterSpacing. Each word is
  // 80px or wider, so the Gecko profile fits it from its prefixes.
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const rowsOf = (userAgent: string): unknown => JSON.parse(runInChild(`
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ${JSON.stringify(userAgent)} } })
    const asked = []
    class Context {
      font = ''
      letterSpacing = '0px'
      measureText(text) {
        asked.push((this.letterSpacing === '0px' ? '' : 'spaced:') + text)
        const ligatures = this.letterSpacing === '0px' ? text.split('fi').length - 1 : 0
        return { width: [...text].length * 8 - 3 * ligatures - 2 * (text.split(/AV|xy/).length - 1) }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const { prepareWithSegments, layoutWithLines } = await import(${JSON.stringify(layoutUrl)})
    const font = '16px Test'
    const row = (text, width, letterSpacing = 0) => {
      asked.length = 0
      const prepared = prepareWithSegments(text, font, { letterSpacing })
      return [prepared.breakableFitAdvances[0], layoutWithLines(prepared, width, 20).lines.map(line => line.text), letterSpacing === 0 ? asked.filter(text => text.startsWith('spaced:')) : []]
    }
    console.log(JSON.stringify([row('aaaafiaaaaaa', 44), row('bbbbbbbbfifi', 44), row('aaaafiaaaaaa', 44, 1), row('aaaaxyaaaaaa', 44), row('ccfiaaaaaaaa', 10), row('AVAVAVAVAVAV', 21)]))
  `))
  // Each row: the advances a cut falls by, the lines, and what the profile asked Canvas under
  // the letterSpacing that turns ligatures off, for text that has no letter spacing.
  expect(rowsOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0')).toEqual([
    // The ligature counts whole on its first letter, so no line ends inside it: `aaaaf` alone
    // would fit 44px. One Canvas question, the pair without its ligatures.
    [[8, 8, 8, 8, 13, 0, 8, 8, 8, 8, 8, 8], ['aaaa', 'fiaaa', 'aaa'], ['spaced:fi']],
    // Asked once per pair and font.
    [[8, 8, 8, 8, 8, 8, 8, 8, 13, 0, 13, 0], ['bbbbb', 'bbbfi', 'fi'], []],
    // Letter-spaced text has no ligature to keep whole.
    [[8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8], ['aaaa', 'fiaa', 'aaaa'], []],
    // Letters that join are no ligature the context can turn off, and stay as the prefixes have them.
    [[8, 8, 8, 8, 8, 6, 8, 8, 8, 8, 8, 8], ['aaaax', 'yaaaa', 'aa'], ['spaced:xy']],
    // A line narrower than the ligature it starts with takes the first letter, as every line
    // takes one, and the rest of the ligature has no width left (ENGINE_FOLLOWUPS.md,
    // Emergency breaks inside a word).
    [[8, 8, 13, 0, 8, 8, 8, 8, 8, 8, 8, 8], ['c', 'c', 'f', 'ia', 'a', 'a', 'a', 'a', 'a', 'a', 'a'], []],
    // A kerned pair is asked about too and stays as the prefixes have it: the part of the
    // kerning Firefox leaves on the letter before a cut isn't ported, so `AVA`, 22px as a
    // prefix, doesn't fit 21px.
    [[8, 6, 8, 6, 8, 6, 8, 6, 8, 6, 8, 6], ['AV', 'AV', 'AV', 'AV', 'AV', 'AV'], ['spaced:AV']],
  ])
  // Blink and WebKit shape or measure a line again from its start, so their profiles end a
  // line inside the ligature and ask nothing.
  for (const userAgent of [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
  ]) {
    expect((rowsOf(userAgent) as unknown[][])[0]).toEqual([[8, 8, 8, 8, 8, 5, 8, 8, 8, 8, 8, 8], ['aaaaf', 'iaaaa', 'aa'], []])
  }
})

test('letter spacing leaves out cursive scripts as Chrome and Firefox do', () => {
  // The engine profile is computed once per process, so each engine runs in a child
  // process. Each row: what the string shows, the string, and the letter-spacing gaps
  // Chrome 154, Firefox 156 and webkit-host gave it in 16px Arial, read from the page's
  // widths at 4px and 8px (2026-09-30; the thirteen rows before the last three at 0 and 10px,
  // 2026-10-01; the last three 2026-10-03). Every code point is 8px here, so the profile's gaps
  // are its widths at 4px and 8px, less each other, over 4.
  const strings: Array<[string, string, number, number, number]> = [
    ['latin', 'abc', 3, 3, 3],
    ['hebrew', '\u05D0\u05D1\u05D2', 3, 3, 3],
    ['arabic joined', '\u0628\u064A\u062A', 0, 0, 3],
    ['arabic unjoined dal-alef-reh', '\u062F\u0627\u0631', 0, 0, 3],
    ['arabic one letter', '\u0628', 0, 0, 1],
    ['two words', '\u0628\u064A\u062A \u0628\u064A\u062A', 1, 1, 7],
    ['letter space letter', '\u0628 \u0628', 1, 1, 3],
    ['harakat', '\u0628\u0650\u0628\u0650', 0, 0, 2],
    ['lam-alef', '\u0644\u0627', 0, 0, 1],
    ['tatweel', '\u0628\u0640\u0628', 0, 1, 3],
    ['tatweel alone', '\u0640', 0, 1, 1],
    ['arabic+ascii digits', '\u0628\u064A\u062A123', 0, 3, 6],
    ['arabic space digits', '\u0628\u064A\u062A 123', 1, 4, 7],
    ['digits space arabic', '123 \u0628\u064A\u062A', 1, 4, 7],
    ['digits only', '123', 3, 3, 3],
    ['arabic-indic digits', '\u0661\u0662\u0663', 0, 0, 3],
    ['arabic then arabic-indic', '\u0628\u064A\u062A\u0661\u0662\u0663', 0, 0, 6],
    ['ext arabic-indic (persian)', '\u06F1\u06F2\u06F3', 0, 0, 3],
    ['arabic period', '\u0628\u064A\u062A.', 0, 1, 4],
    ['arabic excl', '\u0628\u064A\u062A!', 0, 1, 4],
    ['arabic comma', '\u0628\u064A\u062A\u060C', 0, 1, 4],
    ['arabic comma alone', '\u060C', 0, 1, 1],
    ['arabic question', '\u0628\u064A\u062A\u061F', 0, 1, 4],
    ['latin then arabic comma', 'abc\u060C', 3, 4, 4],
    ['paren arabic', '(\u0628\u064A\u062A)', 0, 2, 5],
    ['latin paren arabic', 'abc (\u0628\u064A\u062A)', 6, 6, 9],
    ['arabic paren latin', '\u0628\u064A\u062A (abc)', 4, 6, 9],
    ['arabic paren latin arabic', '\u0628\u064A\u062A (abc) \u0628\u064A\u062A', 5, 7, 13],
    ['han fullwidth paren arabic', '\u4E2D\uFF08\u0627\u0628\u0628\uFF09', 3, 3, 6],
    ['arabic ideographic comma', '\u0628\u064A\u062A\u3001', 1, 1, 4],
    ['arabic fullwidth comma', '\u0628\u064A\u062A\uFF0C', 0, 1, 4],
    ['arabic latin', '\u0628\u064A\u062Aabc', 3, 3, 6],
    ['latin arabic', 'abc\u0628\u064A\u062A', 3, 3, 6],
    ['arabic space latin', '\u0628\u064A\u062A abc', 4, 4, 7],
    ['latin space arabic', 'abc \u0628\u064A\u062A', 4, 4, 7],
    ['nbsp', '\u0628\u064A\u062A\u00A0\u0628\u064A\u062A', 1, 1, 7],
    ['zwnj persian', '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645', 0, 0, 7],
    ['urdu', '\u0627\u0631\u062F\u0648 \u0632\u0628\u0627\u0646', 1, 1, 9],
    ['syriac', '\u0710\u0712\u0713', 0, 0, 3],
    ['nko', '\u07CA\u07CB\u07CC', 0, 0, 3],
    ['mongolian', '\u182E\u1823\u1829', 0, 0, 3],
    ['thaana', '\u078B\u07A8\u0788\u07AC', 2, 2, 2],
    ['adlam', '\u{1E900}\u{1E901}\u{1E902}', 3, 3, 3],
    ['emoji after arabic', '\u0628\u064A\u062A\u{1F600}', 0, 1, 4],
    ['arabic hyphen arabic', '\u0628\u064A\u062A-\u0628\u064A\u062A', 0, 1, 7],
    ['arabic slash', '\u0628\u064A\u062A/\u0628\u064A\u062A', 0, 1, 7],
    ['quote arabic', '"\u0628\u064A\u062A"', 0, 2, 5],
    ['leading digits arabic nospace', '123\u0628\u064A\u062A', 0, 3, 6],
    ['leading punct', '.\u0628\u064A\u062A', 0, 1, 4],
    ['latin digits arabic', 'abc 123 \u0628\u064A\u062A', 8, 8, 11],
    ['arabic colon digits', '\u0628\u064A\u062A: 123', 1, 5, 8],
    ['mongolian comma in latin', 'abc\u1802def', 6, 7, 7],
    ['mongolian comma in arabic', '\u0628\u064A\u062A\u1802\u0628\u064A\u062A', 0, 1, 7],
    ['reversed semicolon in latin', 'abc\u204Fdef', 6, 7, 7],
    ['ideographic space in arabic', '\u0645\u0631\u062D\u0628\u0627\u3000\u0628\u0643\u0645', 0, 1, 9],
    ['second closing bracket, latin inside', '\u0628\u064A\u062A (abc) def) ghi', 12, 15, 18],
    ['second closing bracket, arabic inside', 'abc (\u0628\u064A\u062A) \u0628\u064A\u062A) \u0628\u064A\u062A', 9, 9, 18],
    ['digits, then a fullwidth bracket around arabic', '12\uFF08\u0628\u064A\u062A\uFF09', 4, 4, 7],
    ['digits and a fullwidth comma before arabic', '1\uFF0C2\u0628\u064A\u062A', 0, 3, 6],
    ['digit under an arabic vowel sign among latin', 'ab 1\u064B2 cd', 6, 8, 8],
    ['dotted circle under a vowel sign starts the text', '\u25CC\u064B abc', 4, 5, 5],
    ['digit under a devanagari stress mark after arabic', '\u0628\u064A\u062A 1\u0951 2', 4, 4, 7],
    ['digit under a tilde after arabic', '\u0628\u064A\u062A 5\u0303 6', 4, 4, 7],
    ['fullwidth bracket under an arabic vowel sign among latin', 'abc \uFF08\u064B12', 4, 7, 7],
    ['closing bracket under an arabic vowel sign', 'ab (\u0628\u064A\u062A)\u064B 12', 8, 8, 11],
    ['angle bracket before the other pair\'s closing one', '\u3008\u0628\u064A\u062A\u232A', 1, 2, 5],
    ['a parenthesized ideograph, which han alone lists, after arabic', '\u0628\u064A\u062A\u3231 12', 1, 4, 7],
  ]
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const richInlineUrl = new URL('./rich-inline.ts', import.meta.url).href
  const rowsOf = (userAgent: string): { gaps: number[]; spaceUnderMark: number; lines: string[]; rich: number } => JSON.parse(runInChild(`
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ${JSON.stringify(userAgent)} } })
    class Context {
      font = ''
      letterSpacing = '0px'
      measureText(text) { return { width: [...text].length * 8 } }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const { prepareWithSegments, measureNaturalWidth, layoutWithLines } = await import(${JSON.stringify(layoutUrl)})
    const { prepareRichInline, measureRichInlineStats } = await import(${JSON.stringify(richInlineUrl)})
    const font = '16px Test'
    const width = (text, letterSpacing) => measureNaturalWidth(prepareWithSegments(text, font, { letterSpacing }))
    console.log(JSON.stringify({
      gaps: ${JSON.stringify(strings.map(row => row[1]))}.map(text => (width(text, 8) - width(text, 4)) / 4),
      spaceUnderMark: (width('a \\u064B 12', 8) - width('a \\u064B 12', 4)) / 4,
      // Four 8px letters too long for a 20px line, at 4px.
      lines: layoutWithLines(prepareWithSegments('\\u0628\\u0628\\u0628\\u0628', font, { letterSpacing: 4 }), 20, 20).lines.map(line => line.text),
      // A letter-spaced Arabic item after a Latin one.
      rich: measureRichInlineStats(prepareRichInline([{ text: 'ab ', font }, { text: '\\u0628\\u0628', font, letterSpacing: 4 }]), 1000).maxLineWidth,
    }))
  `)) as { gaps: number[]; spaceUnderMark: number; lines: string[]; rich: number }
  const chrome = rowsOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36')
  const firefox = rowsOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0')
  const safari = rowsOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15')
  for (let i = 0; i < strings.length; i++) {
    const [shows, , inChrome, inFirefox, inSafari] = strings[i]!
    // Safari draws lam and alef as one glyph with one gap, where the profile spaces both
    // graphemes (ENGINE_FOLLOWUPS.md, Letter spacing).
    expect({ shows, chrome: chrome.gaps[i], firefox: firefox.gaps[i], safari: safari.gaps[i] })
      .toEqual({ shows, chrome: inChrome, firefox: inFirefox, safari: shows === 'lam-alef' ? 2 : inSafari })
  }
  // A space takes the scripts of a mark right after it as a digit does, though the two are
  // segments apart: of `a`, a space under U+064B, a space and `12`, Chrome 154 spaces `a` and
  // the two spaces, and the digits are in the Arabic run (2026-10-02). Firefox and Safari
  // give the space and its mark one gap and the profiles two (ENGINE_FOLLOWUPS.md, Letter
  // spacing), so only Chrome's row is checked.
  expect(chrome.spaceUnderMark).toBe(3)
  const pairs = ['\u0628\u0628', '\u0628\u0628']
  const letters = ['\u0628', '\u0628', '\u0628', '\u0628']
  expect([chrome.lines, firefox.lines, safari.lines]).toEqual([pairs, pairs, letters])
  expect([chrome.rich, firefox.rich, safari.rich]).toEqual([40, 40, 48])
})

test('a width is measured under its own font, shaping and language, whatever was measured before it', () => {
  // The engine profile is computed once per process, so each engine runs in a child process.
  // Preparation sets the context where it measures, not where it looks a font up, so each row
  // measures something new right after the context was left on another font, another
  // letterSpacing or another language's context. An ASCII character is half an em wide and
  // any other a whole one; `fi` ligates, 3px narrower, unless the context has a letterSpacing;
  // a context under `ja` measures three quarters; Canvas draws an emoji an em and a quarter
  // wide and the page an em; U+2010 is three quarters of an em; a font named Kern kerns `b`
  // with the space after it by 1px; and one named Halt halts fullwidth marks as Chrome's
  // Canvas does, its dots closing ones. Like Firefox's, the context takes a face the page
  // adds only when its font is assigned: a family named Late measures twice as wide before.
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const richInlineUrl = new URL('./rich-inline.ts', import.meta.url).href
  const rowsOf = (userAgent: string): unknown => JSON.parse(runInChild(`
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ${JSON.stringify(userAgent)} } })
    const root = { lang: 'en' }
    const em = font => Number.parseFloat(/[\\d.]+(?=px)/.exec(font)[0])
    let contexts = 0
    let measuredIn = ''
    let added = false
    let assignments = 0
    class Context {
      assigned = '10px sans-serif'
      late = false
      get font() { return this.assigned }
      set font(value) {
        assignments++
        this.assigned = value
        this.late = added
      }
      letterSpacing = '0px'
      fontKerning = 'auto'
      lang = 'inherit'
      constructor() { contexts++ }
      measureText(text) {
        const size = em(this.font)
        measuredIn = this.font
        let width = 0
        for (const ch of text) width += ch === '\\u{1F600}' ? size * 1.25 : ch === '\\u2010' ? size * 0.75 : ch > '\\u2E7F' ? size : size / 2
        if (Number.parseFloat(this.letterSpacing) === 0) width -= 3 * (text.split('fi').length - 1)
        if (this.font.includes('Kern') && this.fontKerning === 'auto') width -= text.split('b\\u2028').length - 1
        if (this.font.includes('Halt')) width -= (text.match(/[\\u3002\\u300D](?=[\\u3002\\u300D])|(?<=[\\u3002\\u300D\\u300C])\\u300C/g) ?? []).length * size / 2
        if (this.lang === 'ja') width *= 0.75
        if (this.font.includes('Late') && !this.late) width *= 2
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width - (/[\\u3001\\u3002\\uFF0C\\uFF0E]$/.test(text) ? size / 2 : 0) }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    globalThis.document = {
      documentElement: root,
      body: { appendChild() {}, removeChild() {} },
      createElement() {
        const style = {}
        return { style, getBoundingClientRect: () => ({ width: em(style.font) }) }
      },
    }
    const { prepareWithSegments, measureNaturalWidth, clearCache } = await import(${JSON.stringify(layoutUrl)})
    const { prepareRichInline, measureRichInlineStats } = await import(${JSON.stringify(richInlineUrl)})
    const width = (text, font, letterSpacing = 0) => measureNaturalWidth(prepareWithSegments(text, font, { letterSpacing }))
    const rich = items => measureRichInlineStats(prepareRichInline(items), 1e5).maxLineWidth
    const rows = {}

    // Two fonts by turns, where all the text is cached but one segment.
    const a = '16px Test', b = '20px Test'
    rich([{ text: 'aa', font: a }, { text: 'bb', font: b }, { text: 'aa', font: a }])
    rows.fonts = [rich([{ text: 'aa', font: a }, { text: 'bb', font: b }, { text: 'cc', font: a }]), rich([{ text: 'bb', font: b }, { text: 'aa', font: a }, { text: 'dd', font: b }])]
    // Prepared again, with every segment cached, the items measure nothing and assign no font.
    const assigned = assignments
    rich([{ text: 'aa', font: a }, { text: 'bb', font: b }, { text: 'cc', font: a }])
    rows.again = assignments - assigned

    // One font, with and without letter spacing: new text each time, then new text after a cached item of the other kind.
    const spaced = '16px Spaced'
    rows.spacing = [
      rich([{ text: 'fig', font: spaced }, { text: 'fin', font: spaced, letterSpacing: 2 }, { text: 'fit', font: spaced }]),
      rich([{ text: 'fit', font: spaced }, { text: 'fib', font: spaced, letterSpacing: 2 }]),
      rich([{ text: 'fin', font: spaced, letterSpacing: 2 }, { text: 'fir', font: spaced }]),
    ]

    // Another language makes another context, which starts with neither the font nor the shaping.
    const made = contexts
    rows.language = [width('fig', '16px Language', 1)]
    root.lang = 'ja'
    rows.language.push(width('fig', '16px Language', 1), width('fig', '16px Language'))
    root.lang = 'en'
    rows.language.push(width('fig', '16px Language'), contexts - made)

    // clearCache() keeps the context, with the font and the shaping it was left on.
    const kept = contexts
    rows.cleared = [width('fin', '16px Cleared', 2)]
    clearCache()
    rows.cleared.push(width('fin', '16px Cleared'))
    clearCache()
    rows.cleared.push(width('fin', '16px Cleared', 2))
    clearCache()
    rows.cleared.push(width('aa', '20px Cleared'))
    clearCache()
    rows.cleared.push(width('aa', '16px Cleared'), contexts - kept)

    // A face added after its font was measured shows in new text prepared in that font, with nothing prepared in
    // another between, and after clearCache() in the text measured before.
    rows.added = [width('aa', '16px Late')]
    added = true
    rows.added.push(width('bb', '16px Late'), width('aa', '16px Late'))
    clearCache()
    rows.added.push(width('aa', '16px Late'))

    // What a font is asked once, asked first when its text is cached and another font was measured last: the emoji
    // correction, whether it kerns with the space, a character's kerning with one, and a mark's halt beside the next
    // item's.
    width('ab', '16px Emoji')
    width('x', b)
    rows.emoji = width('ab \\u{1F600}', '16px Emoji')
    width('ab', '16px Kern')
    width('cb', '16px Kern')
    width('y', b)
    rows.kerning = [width('ab ab', '16px Kern')]
    width('z', b)
    rows.kerning.push(width('cb cb', '16px Kern'))
    rows.halt = rich([{ text: '\\u4E2D\\u4E2D\\u3002', font: '24px Halt' }, { text: '\\u300D\\u4E2D', font: '16px Halt' }])
    // Asking a font which hyphen it paints sets the context to other fonts and back, so the marks' halts, read after
    // it in the same preparation, are the font's.
    rows.hyphen = width('a\\u00ADb\\u4E2D\\u300D\\u300C\\u4E2D', '16px Hyphen Halt')
    // Where a line that starts inside a word at an invisible character takes its widths from Canvas, they are observed
    // again under another letter spacing, with the word's other measurements cached.
    width('ab\\u2060cd', '16px Entry', 1)
    width('s', b)
    width('ab\\u2060cd', '16px Entry', 2)
    rows.entry = measuredIn
    // Whether two letters are a ligature is asked of the context without its ligatures, here first asked with the
    // word, its letters and the pair all cached, after letter-spaced text in a font whose \`fi\` without the ligature
    // is as wide as this font's with it. The text measured next has its ligature, and the letter-spaced text after it none.
    rich([{ text: 'f i fi', font: '100px Liga', break: 'never' }])
    width('x', '97px Test', 1)
    rows.ligature = [measureRichInlineStats(prepareRichInline([{ text: 'fi', font: '100px Liga' }]), 60).maxLineWidth, width('fig', '16px Liga'), width('fix', '16px Liga', 2)]
    console.log(JSON.stringify(rows))
  `))
  // `fin` under letter spacing is 24px and its three spacings where the context drops the
  // ligature, and 21px and them in the WebKit profile, which measures with it. Two contexts
  // are made for the two language changes and none for the four clearCache() calls. Only the
  // Chromium profile asks for kerning with the space and for halts, and the WebKit profile
  // observes no line starts inside a word, so its last measurement is the 20px text's. Only
  // the Gecko profile asks for ligatures: a line that cuts \`fi\` has the ligature's 97px on its
  // \`f\`, and the others the letter's 50px.
  const rows = (fin: number, kerned: number, halted: number, entry: string, cutLigature: number): unknown => ({
    fonts: [52, 56],
    again: 0,
    spacing: [21 + fin + 21, 21 + fin, fin + 21],
    language: [fin - 3, (fin - 6) * 0.75 + 3, 15.75, 21, 2],
    cleared: [fin, 21, fin, 20, 16, 0],
    added: [32, 16, 32, 16],
    emoji: 40,
    kerning: [kerned, kerned],
    halt: halted,
    hyphen: halted === 92 ? 72 : 80,
    entry,
    ligature: [cutLigature, 21, fin],
  })
  expect(rowsOf(CHROME_USER_AGENT)).toEqual(rows(30, 39, 92, '16px Entry', 50))
  expect(rowsOf(FIREFOX_USER_AGENT)).toEqual(rows(30, 40, 104, '16px Entry', 97))
  expect(rowsOf(SAFARI_USER_AGENT)).toEqual(rows(27, 40, 104, '20px Test', 50))
})

test('a line start inside a word asks Canvas for each of its strings once', () => {
  // The engine profile is computed once per process, so each engine runs in a child process.
  // In the desktop Chromium and Firefox profiles a line that starts inside a word at an
  // invisible character takes its widths from Canvas: for a word joiner between `b` and `c`,
  // the joiner alone and the joiner with `c`. Under no letter spacing those are widths of the
  // font's segment cache, which has the joiner alone as one of the word's letters, and where
  // a second word with the same line start finds both.
  const layoutUrl = new URL('./layout.ts', import.meta.url).href
  const askedIn = (userAgent: string): unknown => JSON.parse(runInChild(`
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ${JSON.stringify(userAgent)} } })
    const asked = []
    class Context {
      font = ''
      letterSpacing = '0px'
      fontKerning = 'auto'
      measureText(text) {
        if (text.includes('\\u2060')) asked.push(text)
        const width = text.replaceAll('\\u2060', '').length * 8
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
      }
    }
    globalThis.OffscreenCanvas = class { getContext() { return new Context() } }
    const { prepare } = await import(${JSON.stringify(layoutUrl)})
    prepare('ab\\u2060cd', '16px Test')
    prepare('xb\\u2060cd', '16px Test')
    console.log(JSON.stringify(asked))
  `))
  const asked = ['ab⁠cd', '⁠', '⁠c', 'xb⁠cd']
  expect(askedIn(CHROME_USER_AGENT)).toEqual(asked)
  expect(askedIn(FIREFOX_USER_AGENT)).toEqual(asked)
})
