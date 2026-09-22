import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../src/model.js'

export type PlainCase = { id: string; paragraph: Paragraph; widths: readonly number[]; growth: string | null; insets?: ReadonlyArray<{ left: number; right: number }> }
const WIDTHS = [0, 1, 7.75, 16, 23.984375, 37, 96, 320, 100000] as const
const FONT = '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif'

function make(id: string, text: string, overrides: Partial<Paragraph> = {}, growth: string | null = null, widths: readonly number[] = WIDTHS): PlainCase {
  return { id, growth, widths, paragraph: {
    font: { family: FONT, size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS } },
    content: [{ kind: 'text', text }], letterSpacing: 0, wordSpacing: 0, lineHeight: 20,
    whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8,
    direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', ...overrides,
  } }
}

// Existing stand-in Canvas answers these. This list is a data-flow check, never a replacement for native accuracy cases.
export function cases(growthSizes: readonly number[] = [64, 128, 256]): PlainCase[] {
  const out = [
    make('empty', ''), make('normal-spaces', '   A  V   office AV fi fl  '), make('only-spaces', ' \t\n  '),
    make('long-word', 'antidisestablishmentarianism'), make('controls', 'a\u200bb\u00a0c\u2060d\u00ade'),
    make('selected-soft-hyphen', 'ab\u00adcd\u00adef'), make('word-joiner', 'one\u2060two three'),
    make('pre-wrap', '  A\tV \n\n  office   \tend ', { whiteSpace: 'pre-wrap' }),
    make('pre-line', '  A\tV \r\n\n  office   \tend ', { whiteSpace: 'pre-line' }),
    make('pre', ' A\tV \n end  ', { whiteSpace: 'pre' }),
    make('break-spaces', ' A  V\t\n end  ', { whiteSpace: 'break-spaces' }),
    make('tab-size-fractional', 'A\tB\tC\n\tD', { whiteSpace: 'pre-wrap', tabSize: 3.5 }),
    make('newline-normal', 'one\r\ntwo\n\nthree\rfour'),
    make('explicit-br', '', { content: [{ kind: 'text', text: 'A' }, { kind: 'br' }, { kind: 'br' }, { kind: 'text', text: 'B' }, { kind: 'br' }] }),
    make('no-overflow-wrap', 'longwordlongword words', { overflowWrap: 'normal' }),
    make('break-all', 'AVoffice世界한국어', { wordBreak: 'break-all' }),
    make('anywhere', 'AVoffice世界한국어', { overflowWrap: 'anywhere' }),
    make('keep-all', '世界你好 「かな」 한국어 문장 English', { wordBreak: 'keep-all', lang: 'ko' }),
    make('cjk-strict', '「世界」、かな。小さいゃ文字！', { lang: 'ja', lineBreak: 'strict' }),
    make('positive-spacing', 'AV fi fl A  V\u00adxyz', { letterSpacing: 1.25, wordSpacing: 2.5 }),
    make('negative-spacing', 'AV fi fl A  V\u00adxyz', { letterSpacing: -1.25, wordSpacing: -2.5 }),
    make('non-monotone-spacing', 'office AV office', { letterSpacing: -14 }),
    make('fractional-spacing', 'AV office ilfi', { letterSpacing: 1 / 128, wordSpacing: -1 / 128 }),
    make('combining', 'e\u0301\u0327 AV a\u0308\u034f\u0301'),
    // JavaScript text may hold unpaired surrogates. Source script facts and accepted shaping splits differ there.
    make('lone-low-arabic-positive', 'ب\uDC00ب', { letterSpacing: 1.5, lang: 'ar' }),
    make('lone-low-arabic-negative-rtl', 'ب\uDC00ب', { letterSpacing: -2, lang: 'ar', direction: 'rtl' }),
    make('lone-low-chain', 'ב\uDC00\uDC01بक', { letterSpacing: 1.5 }),
    make('lone-high-control', 'ب\uD800ب', { letterSpacing: -2, lang: 'ar' }),
    make('lone-low-hebrew-numerals', 'אב12\uDC00\uDC0134גד', { letterSpacing: 1.5, lang: 'he' }),
    make('lone-low-indic-numerals', 'क12\uDC00\uDC0134ख', { letterSpacing: -2, lang: 'hi' }),
    make('lone-low-arabic-override', '\u202Dب12\uDC00\uDC0134ب\u202C', { letterSpacing: 1.5, lang: 'ar' }),
    make('lone-low-arabic-numerals', 'ب12\uDC00\uDC0134ب', { letterSpacing: 1.5, lang: 'ar' }),
    make('lone-low-mongolian', '\u182012\uDC00\uDC0134\u1820', { letterSpacing: -2, lang: 'mn' }),
    make('emoji', '👩🏽‍💻 👨‍👩‍👧‍👦 🇺🇸 ❤️ 👩‍❤️‍👩 end'),
    make('arabic', 'سَلَام لا العربية في الكلمة', { lang: 'ar', direction: 'rtl' }),
    make('arabic-ltr', 'abc سَلَام 123 العربية xyz', { lang: 'ar' }),
    make('hebrew', 'אבג (123) xyz דהו', { lang: 'he', direction: 'rtl' }),
    make('rtl-in-ltr', 'A אבג 123 عربي 456 Z'),
    make('ltr-in-rtl', 'A אבג 123 عربي 456 Z', { direction: 'rtl' }),
    make('bidi-controls', 'A\u2067אבג 12\u2069B\u202dعربي\u202cC'),
    make('devanagari', 'क्षि हिन्दी भाषा शब्द', { lang: 'hi' }),
    make('bangla', 'বাংলা ভাষা শব্দ', { lang: 'bn' }),
    make('thai', 'ภาษาไทยเป็นภาษาที่น่าสนใจ', { lang: 'th' }),
    make('myanmar', 'မြန်မာဘာသာစကား စမ်းသပ်မှု', { lang: 'my' }),
    make('khmer', 'ភាសាខ្មែរជាភាសា', { lang: 'km' }),
    make('indent-justify', 'one two three four five six', { textIndent: 12.5, textAlign: 'justify' }),
    make('fixed-pitch', 'AV office A\tB\u00adCD', { font: { family: 'Menlo', size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS } }, whiteSpace: 'pre-wrap' }),
  ]
  out.push({ ...make('float-refusal-and-retry', 'unbrokenword words here', {}, null, [96, 320]), insets: [{ left: 90, right: 0 }, { left: 20, right: 20 }] })
  const patterns: ReadonlyArray<[string, string, Partial<Paragraph>]> = [
    ['ordinary-latin', 'office AV words ', {}],
    ['unbroken-latin', 'AVoffice', {}],
    ['joining-arabic', 'سَلَام', { lang: 'ar', direction: 'rtl' }],
    ['signed-tracking', 'office', { letterSpacing: -14 }],
    ['alternating-scripts', 'Aאבג12عرب3あ世 ', {}],
    ['tabs-and-breaks', 'A\t B\n  C\t', { whiteSpace: 'pre-wrap' }],
  ]
  for (const n of growthSizes) for (const [name, pattern, overrides] of patterns) {
    const text = pattern.repeat(Math.ceil(n / pattern.length)).slice(0, n)
    out.push(make(`growth/${name}/${n}`, text, overrides, name, [37, 320, 100000]))
  }
  return out
}
