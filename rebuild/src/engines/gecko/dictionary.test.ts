import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { GeckoEnvironment } from '../../env.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type InlineNode, type Paragraph } from '../../model.js'
import { icu4xLineBoundaries } from './linebreak.js'
import { fillLine, firstGeckoLine } from './lines.js'
import { linePieces } from './pieces.js'
import { prepareGecko } from './prepare.js'

const NativeSegmenter = Intl.Segmenter
const mutableIntl = Intl as unknown as { Segmenter: typeof Intl.Segmenter }
const options = { strictness: 'strict', wordOption: 'normal', jaZh: false } as const
const available = { kind: 'intl-segmenter-word' } as const
const words = { th: 'ภาษาไทยเป็นภาษาที่น่าสนใจ', lo: 'ພາສາລາວເປັນພາສາ', my: 'မြန်မာဘာသာစကား', km: 'ភាសាខ្មែរជាភាសា' }
type Asked = { locale: string; text: string; indices: number[] }
let constructors: string[]
let asked: Asked[]
let oldCanvas: typeof OffscreenCanvas
let oldSegmenter: typeof Intl.Segmenter

beforeEach(() => {
  oldCanvas = globalThis.OffscreenCanvas
  oldSegmenter = Intl.Segmenter
  constructors = []
  asked = []
})
afterEach(() => {
  globalThis.OffscreenCanvas = oldCanvas
  mutableIntl.Segmenter = oldSegmenter
})

function nativeBoundaries(text: string, language: string): number[] {
  const result = [0]
  for (const part of new NativeSegmenter(language, { granularity: 'word' }).segment(text)) if (part.index > 0) result.push(part.index)
  if (text.length > 0) result.push(text.length)
  return result
}

test('a long SA range follows the native dictionary word boundaries through its final EOF boundary', () => {
  for (const language of ['th', 'my', 'km'] as const) {
    const text = words[language].repeat(128)
    const expected = nativeBoundaries(text, language)
    expect(expected.length).toBeGreaterThan(200)
    expect(icu4xLineBoundaries(text, options, available)).toEqual(expected)
    expect(icu4xLineBoundaries(text, options, { kind: 'unavailable' })).toEqual([0, text.length])
  }
  expect(icu4xLineBoundaries('', options, available)).toEqual([0])
  expect(icu4xLineBoundaries('ก', options, available)).toEqual([0, 1])
})

test('empty, one and dense dictionary results consume the range once, including a following character', () => {
  let mode: 'empty' | 'one' | 'dense' = 'empty'
  mutableIntl.Segmenter = class extends NativeSegmenter {
    override segment(text: string): Intl.Segments {
      if (mode === 'empty') return [] as unknown as Intl.Segments
      if (mode === 'one') return [{ index: 0, segment: text }] as unknown as Intl.Segments
      return Array.from({ length: text.length }, (_, index) => ({ index, segment: text[index] })) as unknown as Intl.Segments
    }
  }
  const text = 'ก'.repeat(257)
  for (mode of ['empty', 'one'] as const) {
    expect(icu4xLineBoundaries(text, options, available)).toEqual([0, text.length])
    expect(icu4xLineBoundaries(text + 'X', options, available)).toEqual([0, text.length, text.length + 1])
  }
  mode = 'dense'
  expect(icu4xLineBoundaries(text, options, available)).toEqual(Array.from({ length: text.length + 1 }, (_, i) => i))
  expect(icu4xLineBoundaries(text + 'X', options, available)).toEqual(Array.from({ length: text.length + 2 }, (_, i) => i))
})

function installParagraphDoubles(): void {
  mutableIntl.Segmenter = class extends NativeSegmenter {
    requested: string
    constructor(locales?: Intl.LocalesArgument, settings?: Intl.SegmenterOptions) {
      super(locales, settings)
      this.requested = String(locales)
      constructors.push(this.requested)
    }
    override segment(text: string): Intl.Segments {
      const result = super.segment(text)
      const fresh = new NativeSegmenter(this.requested, { granularity: 'word' }).segment(text)
      // Reuse must give the fresh machine's complete answer, not just the same call count.
      expect([...result]).toEqual([...fresh])
      asked.push({ locale: this.requested, text, indices: [...result].map(part => part.index) })
      return result
    }
  }
  class Context {
    font = '16px Courier New'; lang = 'en'; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(text: string): TextMetrics {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 16)
      const spacing = Math.round(Number.parseFloat(this.letterSpacing) * 60) / 60
      const width = [...text].length * (size / 2 + spacing)
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: size * 0.75, actualBoundingBoxDescent: size * 0.25, fontBoundingBoxAscent: size * 0.9, fontBoundingBoxDescent: size * 0.2 } as TextMetrics
    }
  }
  globalThis.OffscreenCanvas = class { getContext(): Context { return new Context() } } as unknown as typeof OffscreenCanvas
}

const env: GeckoEnvironment = { engine: 'gecko', build: '156.0', devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us', dictionaryBreaks: available }
const style = {
  font: { family: 'Courier New', size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false } },
  letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8,
} as const
function mixedParagraph(): Paragraph {
  const content: InlineNode[] = []
  for (let round = 0; round < 2; round++) for (const [language, word] of Object.entries(words)) {
    content.push({ ...style, kind: 'span', lang: language, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text: word + ' ' + word }] })
    // An atomic frame stops the text run and resets the line breaker between two uses of each locale.
    content.push({ kind: 'atomic', width: 8, height: 8, marginInlineStart: 0, marginInlineEnd: 0 })
  }
  return { ...style, content, lang: 'en', direction: 'ltr', lineHeight: 20, textIndent: 0, textAlign: 'start' }
}
function outputs(prepared: ReturnType<typeof prepareGecko>): unknown[] {
  const result: unknown[] = []
  for (const width of [37, 320]) for (let start = firstGeckoLine(prepared); start !== null;) {
    const line = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (line.kind === 'below-floats') throw new Error('unrestricted slot refused')
    result.push({ start: line.start, end: line.end, next: line.next, box: line.hasLineBox, pieces: linePieces(prepared, line.line) })
    start = line.next
  }
  return result
}

test('one preparation reuses each explicit dictionary locale across resets, and a new preparation has fresh machines', () => {
  installParagraphDoubles()
  const first = prepareGecko(mixedParagraph(), env, false, [])
  expect(constructors.sort()).toEqual(['km', 'lo', 'my', 'th'])
  const firstQuestions = [...asked]
  for (const language of Object.keys(words)) expect(firstQuestions.filter(call => call.locale === language).length).toBeGreaterThan(1)
  const firstOutput = outputs(first)
  constructors = []; asked = []
  const second = prepareGecko(mixedParagraph(), { ...env, pageLang: 'ar', contentLanguage: 'ja', regionalPrefsLocale: 'ja-jp' }, false, [])
  expect(constructors.sort()).toEqual(['km', 'lo', 'my', 'th'])
  expect(asked).toEqual(firstQuestions)
  expect([...second.breakFlags]).toEqual([...first.breakFlags])
  expect(outputs(second)).toEqual(firstOutput)
  constructors = []; asked = []
  prepareGecko(mixedParagraph(), { ...env, dictionaryBreaks: { kind: 'unavailable' } }, false, [])
  expect(constructors).toEqual([])
  expect(asked).toEqual([])
})
