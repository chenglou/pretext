import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'

// Keep the permanent suite small and durable. These tests exercise the shipped
// prepare/layout exports with a deterministic fake canvas backend. For narrow
// browser-specific investigations, prefer throwaway probes and browser checkers
// over mirroring the full implementation here.

const FONT = '16px Test Sans'
const LINE_HEIGHT = 19

type LayoutModule = typeof import('./layout.ts')
type LineBreakModule = typeof import('./line-break.ts')
type RichInlineModule = typeof import('./rich-inline.ts')
type AnalysisModule = typeof import('./analysis.ts')

let prepare: LayoutModule['prepare']
let prepareWithSegments: LayoutModule['prepareWithSegments']
let layout: LayoutModule['layout']
let layoutWithLines: LayoutModule['layoutWithLines']
let layoutNextLine: LayoutModule['layoutNextLine']
let layoutNextLineRange: LayoutModule['layoutNextLineRange']
let measureLineStats: LayoutModule['measureLineStats']
let walkLineRanges: LayoutModule['walkLineRanges']
let clearCache: LayoutModule['clearCache']
let setLocale: LayoutModule['setLocale']
let countPreparedLines: LineBreakModule['countPreparedLines']
let measurePreparedLineGeometry: LineBreakModule['measurePreparedLineGeometry']
let stepPreparedLineGeometry: LineBreakModule['stepPreparedLineGeometry']
let walkPreparedLines: LineBreakModule['walkPreparedLines']
let prepareRichInline: RichInlineModule['prepareRichInline']
let materializeRichInlineLineRange: RichInlineModule['materializeRichInlineLineRange']
let measureRichInlineStats: RichInlineModule['measureRichInlineStats']
let walkRichInlineLineRanges: RichInlineModule['walkRichInlineLineRanges']
let isCJK: AnalysisModule['isCJK']

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
    (code >= 0xAC00 && code <= 0xD7AF) ||
    (code >= 0xFF00 && code <= 0xFFEF)
  )
}

function measureWidth(text: string, font: string): number {
  const fontSize = parseFontSize(font)
  let width = 0
  let previousWasDecimalDigit = false

  for (const ch of text) {
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
  const [analysisMod, mod, lineBreakMod, richInlineMod] = await Promise.all([
    import('./analysis.ts'),
    import('./layout.ts'),
    import('./line-break.ts'),
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
    measureLineStats,
    walkLineRanges,
    clearCache,
    setLocale,
  } = mod)
  ;({ countPreparedLines, measurePreparedLineGeometry, stepPreparedLineGeometry, walkPreparedLines } = lineBreakMod)
  ;({ prepareRichInline, materializeRichInlineLineRange, measureRichInlineStats, walkRichInlineLineRanges } = richInlineMod)
})

beforeEach(() => {
  setLocale(undefined)
  clearCache()
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
    expect(layout(prefixed, softBreakWidth, LINE_HEIGHT).lineCount).toBe(narrow.lineCount)

    const continuedSoftBreakWidth =
      prefixed.widths[0]! +
      prefixed.widths[1]! +
      prefixed.widths[2]! +
      prefixed.breakableWidths[4]![0]! +
      prefixed.discretionaryHyphenWidth +
      0.1
    const continued = layoutWithLines(prefixed, continuedSoftBreakWidth, LINE_HEIGHT)
    expect(continued.lines.map(line => line.text)).toEqual(['foo trans-a', 'tlantic'])
    expect(layout(prefixed, continuedSoftBreakWidth, LINE_HEIGHT).lineCount).toBe(continued.lineCount)
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

  test('keeps no-space ascii punctuation chains together as one breakable segment', () => {
    const prepared = prepareWithSegments('foo;bar foo:bar foo,bar as;lkdfjals;k', FONT)
    expect(prepared.segments).toEqual([
      'foo;bar',
      ' ',
      'foo:bar',
      ' ',
      'foo,bar',
      ' ',
      'as;lkdfjals;k',
    ])
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

  test('applies CJK and Hangul punctuation attachment rules', () => {
    expect(prepareWithSegments('中文，测试。', FONT).segments).toEqual(['中', '文，', '测', '试。'])
    expect(prepareWithSegments('테스트입니다.', FONT).segments.at(-1)).toBe('다.')
  })

  test('keeps non-CJK glue-connected runs intact before CJK text', () => {
    const prepared = prepareWithSegments('foo\u00A0世界', FONT)
    expect(prepared.segments).toEqual(['foo\u00A0', '世', '界'])
  })

  test('keep-all keeps CJK-leading no-space runs cohesive without swallowing preceding latin runs', () => {
    expect(prepareWithSegments('中文，测试。', FONT, { wordBreak: 'keep-all' }).segments).toEqual(['中文，', '测试。'])
    expect(prepareWithSegments('한국어테스트', FONT, { wordBreak: 'keep-all' }).segments).toEqual(['한국어테스트'])

    for (const text of ['日本語foo-bar', '日本語foo.bar', '日本語foo—bar']) {
      expect(prepareWithSegments(text, FONT, { wordBreak: 'keep-all' }).segments).toEqual([text])
    }

    expect(prepareWithSegments('foo-bar日本語', FONT, { wordBreak: 'keep-all' }).segments).toEqual(['foo-', 'bar', '日本語'])
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

  test('isCJK covers the newer CJK extension blocks', () => {
    expect(isCJK('\u{2EBF0}')).toBe(true)
    expect(isCJK('\u{31350}')).toBe(true)
    expect(isCJK('\u{323B0}')).toBe(true)
    expect(isCJK('hello')).toBe(false)
  })

  test('isCJK covers the newer CJK extension blocks', () => {
    expect(isCJK('\u{2EBF0}')).toBe(true)
    expect(isCJK('\u{31350}')).toBe(true)
    expect(isCJK('\u{323B0}')).toBe(true)
    expect(isCJK('hello')).toBe(false)
  })

  test('prepare and prepareWithSegments agree on layout behavior', () => {
    const plain = prepare('Alpha beta gamma', FONT)
    const rich = prepareWithSegments('Alpha beta gamma', FONT)
    for (const width of [40, 80, 200]) {
      expect(layout(plain, width, LINE_HEIGHT)).toEqual(layout(rich, width, LINE_HEIGHT))
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
  test('non-materializing range walker matches range materialization', () => {
    const prepared = prepareRichInline([
      { text: 'Ship ', font: FONT },
      { text: '@maya', font: '700 12px Test Sans', break: 'never', extraWidth: 18 },
      { text: "'s rich note wraps cleanly", font: FONT },
    ])
    const rangedLines: Array<{
      end: TestLayoutCursor & { itemIndex: number }
      fragments: Array<{
        end: TestLayoutCursor
        gapBefore: number
        itemIndex: number
        occupiedWidth: number
        start: TestLayoutCursor
      }>
      width: number
    }> = []
    const materializedLines: Array<{
      end: TestLayoutCursor & { itemIndex: number }
      fragments: Array<{
        end: TestLayoutCursor
        gapBefore: number
        itemIndex: number
        occupiedWidth: number
        start: TestLayoutCursor
        text: string
      }>
      width: number
    }> = []

    const rangeLineCount = walkRichInlineLineRanges(prepared, 120, line => {
      rangedLines.push({
        end: line.end,
        fragments: line.fragments.map(fragment => ({
          end: fragment.end,
          gapBefore: fragment.gapBefore,
          itemIndex: fragment.itemIndex,
          occupiedWidth: fragment.occupiedWidth,
          start: fragment.start,
        })),
        width: line.width,
      })
    })
    const materializedLineCount = walkRichInlineLineRanges(prepared, 120, range => {
      const line = materializeRichInlineLineRange(prepared, range)
      materializedLines.push({
        end: line.end,
        fragments: line.fragments.map(fragment => ({
          end: fragment.end,
          gapBefore: fragment.gapBefore,
          itemIndex: fragment.itemIndex,
          occupiedWidth: fragment.occupiedWidth,
          start: fragment.start,
          text: fragment.text,
        })),
        width: line.width,
      })
    })

    expect(rangeLineCount).toBe(materializedLineCount)
    expect(measureRichInlineStats(prepared, 120)).toEqual({
      lineCount: rangeLineCount,
      maxLineWidth: Math.max(...rangedLines.map(line => line.width)),
    })
    expect(rangedLines).toHaveLength(materializedLines.length)

    for (let index = 0; index < rangedLines.length; index++) {
      const rangeLine = rangedLines[index]!
      const materializedLine = materializedLines[index]!
      expect(rangeLine.width).toBe(materializedLine.width)
      expect(rangeLine.end).toEqual(materializedLine.end)
      expect(rangeLine.fragments).toEqual(
        materializedLine.fragments.map(({ text: _text, ...fragment }) => fragment),
      )
    }
  })
})

describe('layout invariants', () => {
  test('line count grows monotonically as width shrinks', () => {
    const prepared = prepare('The quick brown fox jumps over the lazy dog', FONT)
    let previous = 0

    for (const width of [320, 200, 140, 90]) {
      const { lineCount } = layout(prepared, width, LINE_HEIGHT)
      expect(lineCount).toBeGreaterThanOrEqual(previous)
      previous = lineCount
    }
  })

  test('trailing whitespace hangs past the line edge', () => {
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
    const graphemeWidths = prepared.breakableWidths[0]!
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

  test('layoutNextLine reproduces layoutWithLines exactly', () => {
    const prepared = prepareWithSegments('foo trans\u00ADatlantic said "hello" to 世界 and waved.', FONT)
    const width = prepared.widths[0]! + prepared.widths[1]! + prepared.widths[2]! + prepared.breakableWidths[4]![0]! + prepared.discretionaryHyphenWidth + 0.1
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
      prepared.breakableWidths[4]![0]! +
      prepared.discretionaryHyphenWidth +
      0.1
    const result = layoutWithLines(prepared, width, LINE_HEIGHT)

    expect(result.lines.map(line => line.text).join('')).toBe('foo trans-atlantic')
    expect(reconstructFromLineBoundaries(prepared, result.lines)).toBe('foo trans\u00ADatlantic')
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

  test('pre-wrap mode keeps empty lines from consecutive hard breaks', () => {
    const prepared = prepareWithSegments('\n\n', FONT, { whiteSpace: 'pre-wrap' })
    const lines = layoutWithLines(prepared, 200, LINE_HEIGHT)
    expect(lines.lines.map(line => line.text)).toEqual(['', ''])
    expect(layout(prepared, 200, LINE_HEIGHT)).toEqual({ lineCount: 2, height: LINE_HEIGHT * 2 })
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
    const wordBreaks = prepared.breakableWidths[2]!
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

  test('walkLineRanges reproduces layoutWithLines geometry without materializing text', () => {
    const prepared = prepareWithSegments('foo trans\u00ADatlantic said "hello" to 世界 and waved.', FONT)
    const width = prepared.widths[0]! + prepared.widths[1]! + prepared.widths[2]! + prepared.breakableWidths[4]![0]! + prepared.discretionaryHyphenWidth + 0.1
    const expected = layoutWithLines(prepared, width, LINE_HEIGHT)
    const actual: Array<{
      width: number
      start: { segmentIndex: number, graphemeIndex: number }
      end: { segmentIndex: number, graphemeIndex: number }
    }> = []

    const lineCount = walkLineRanges(prepared, width, line => {
      actual.push({
        width: line.width,
        start: { ...line.start },
        end: { ...line.end },
      })
    })

    expect(lineCount).toBe(expected.lineCount)
    expect(actual).toEqual(expected.lines.map(line => ({
      width: line.width,
      start: line.start,
      end: line.end,
    })))
  })

  test('measureLineStats matches walked line count and widest line', () => {
    const prepared = prepareWithSegments('foo trans\u00ADatlantic said "hello" to 世界 and waved.', FONT)
    const width = prepared.widths[0]! + prepared.widths[1]! + prepared.widths[2]! + prepared.breakableWidths[4]![0]! + prepared.discretionaryHyphenWidth + 0.1
    let walkedLineCount = 0
    let walkedMaxLineWidth = 0

    walkLineRanges(prepared, width, line => {
      walkedLineCount++
      walkedMaxLineWidth = Math.max(walkedMaxLineWidth, line.width)
    })

    expect(measureLineStats(prepared, width)).toEqual({
      lineCount: walkedLineCount,
      maxLineWidth: walkedMaxLineWidth,
    })
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
        const walked = walkPreparedLines(prepared, width)
        expect(counted).toBe(walked)
      }
    }
  })
})
