// Families about break opportunities: languages and line-break keywords, hyphen classes, quotes, keep-all and string
// storage, segment breaks between wide characters, clusters, URLs and ZWNJ.
import { font, paragraph, span, text, type Part } from '../../lab/cases/build.ts'
import { breakingStyles, whiteSpace } from './lines.ts'
import { str, type RuleFamily } from './types.ts'
import type { Paragraph } from '../../lab/types.ts'

function wordBreak(value: string): Paragraph['wordBreak'] {
  switch (value) {
    case 'normal': case 'break-all': case 'keep-all': case 'break-word': return value
    default: throw new Error(`word-break ${value}`)
  }
}

function lineBreak(value: string): Paragraph['lineBreak'] {
  switch (value) {
    case 'auto': case 'loose': case 'normal': case 'strict': case 'anywhere': return value
    default: throw new Error(`line-break ${value}`)
  }
}

function offsetsAfter(value: string, characters: string, base: number): number[] {
  const out: number[] = []
  for (let i = 0; i < value.length; i++) if (characters.includes(value[i]!)) out.push(base + i + 1)
  return out
}

export const BREAK_FAMILIES: readonly RuleFamily[] = [
  {
    name: 'languages',
    rules: {
      blink: ['blink/style/lang-empty-null-locale', 'blink/breaks/null-locale-ui-language', 'blink/breaks/rule-file-per-locale', 'blink/breaks/ko-strict-retries-ui-language', 'blink/breaks/icu-following-for-unknown-pairs', 'blink/gap/ui-language'],
      webkit: ['webkit/style/lang-empty-null-locale', 'webkit/breaks/line-tables-per-locale', 'webkit/style/han-lang-specialized-chinese-locale', 'webkit/gap/ui-language'],
      gecko: ['gecko/gap/ui-language', 'gecko/icu4x/cj-as-id-under-loose-normal', 'gecko/icu4x/normal-ja-zh-wave-dash', 'gecko/icu4x/loose-rules', 'gecko/linebreaker/auto-strictness-is-strict', 'gecko/transform/ja-zh-language-test'],
    },
    why: 'The break table depends on the locale and the line-break keyword: Blink opens the UI language table for text without a locale (blink-text H15, H16: あぁ strict gives 1 line under <html lang=en> and 2 with no lang anywhere) and retries it for ko strict; WebKit replaces a Han lang; Gecko applies CJ rules under loose and normal. lang="" gives a null locale (blink style resolver; webkit-text H7). Relevant: the paragraph lang including "", the keyword, and text whose breaks the tables disagree on.',
    relevant: [
      { name: 'lang', values: ['', 'en', 'ja', 'zh', 'ko'] },
      { name: 'lineBreak', values: ['auto', 'strict', 'normal', 'loose'] },
      { name: 'body', values: ['aa”bb', 'あぁいぃうぅ', '中々中々'] },
    ],
    neighbours: [{ name: 'family', values: ['Hiragino Sans', 'PingFang SC'] }],
    build(v) {
      const body = str(v, 'body')
      const focus = body.includes('”') ? [3 + 3] : [3 + 1, 3 + 3]
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), 16), lang: str(v, 'lang'), lineBreak: lineBreak(str(v, 'lineBreak')) }, [text(`xx ${body} cc dd`)]),
        focus,
        note: 'breaks the locale tables disagree on',
      }
    },
  },
  {
    name: 'hyphen-classes',
    rules: {
      blink: ['blink/breaks/break-all-loose-hyphen', 'blink/breaks/break-all-table', 'blink/breaks/hyphen-before-digit', 'blink/breaks/keep-all-letters-and-numbers', 'blink/breaks/latin1-pair-table', 'blink/breaks/icu-restarts-at-line-start'],
      webkit: ['webkit/breaks/hyphen-before-digit', 'webkit/breaks/latin1-pair-table', 'webkit/breaks/may-break-in-between', 'webkit/breaker/break-rule-break-all', 'webkit/breaks/keep-all-breakable-space'],
      gecko: ['gecko/glyphs/after-hyphen-emergency-wrap', 'gecko/icu4x/break-all-letters-as-id', 'gecko/icu4x/keep-all-pairs', 'gecko/linebreaker/ascii-nonbreakable-words-skip-icu'],
    },
    why: 'U+2010 is class HH at ICU 78 and the break-all table has an empty HH row, so break-all + loose never breaks before it (blink-text H20); "-" before a digit breaks only after a letter or digit (webkit-text H23; gecko-lines H8, gecko-text H26). Relevant: word-break, loose or not, the hyphen character and what precedes it.',
    relevant: [
      { name: 'wordBreak', values: ['normal', 'break-all', 'keep-all'] },
      { name: 'lineBreak', values: ['auto', 'loose'] },
      { name: 'hyphen', values: ['-', '‐', '–'] },
      { name: 'before', values: ['a', '1', '中'] },
    ],
    neighbours: [{ name: 'family', values: ['Arial', 'Georgia'] }],
    build(v) {
      const before = `zz ${str(v, 'before')}${str(v, 'before')}`
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), 16), lang: 'en', wordBreak: wordBreak(str(v, 'wordBreak')), lineBreak: lineBreak(str(v, 'lineBreak')) }, [text(`${before}${str(v, 'hyphen')}2b q`)]),
        focus: [before.length, before.length + 1],
        note: 'breaks before and after the hyphen',
      }
    },
  },
  {
    name: 'quotes',
    rules: {
      blink: ['blink/breaks/rule-file-per-locale', 'blink/breaks/icu-following-for-unknown-pairs'],
      webkit: ['webkit/breaks/apple-quote-overrides', 'webkit/breaks/da-has-no-overrides', 'webkit/breaks/ideograph-quote-rule', 'webkit/breaks/icu-with-prior-context', 'webkit/breaks/line-tables-per-locale', 'webkit/gap/ui-language'],
      gecko: ['gecko/icu4x/line-iterator', 'gecko/linebreaker/words-across-flows'],
    },
    why: "Apple's ICU reads a locale's CLDR delimiters as opening and closing punctuation (webkit-canvas H11: en and zh break at 5, sv, da, de and fr don't; webkit-text H6); Danish has no overrides in the lab's dump; an ideograph next to a quote breaks by 7625's local LB19a rule (webkit-text H4). Relevant: the lang including \"\", the quote pair, and a neighbour that is an ideograph or a letter; one variant writes the opening quote in its own span.",
    relevant: [
      { name: 'lang', values: ['da', 'de', 'sv', 'en', 'fr', 'ja', ''] },
      { name: 'quote', values: ['„x“', '»x«', '“x”', '‚x‘'] },
      { name: 'context', values: ['中', 'ab'] },
    ],
    neighbours: [{ name: 'nodes', values: ['single', 'span-quote'] }],
    build(v) {
      const quote = str(v, 'quote')
      const open = quote[0]!
      const close = quote[2]!
      const context = str(v, 'context')
      const f = font('Hiragino Sans', 16)
      const lead = `yy ${context}`
      const parts: Part[] = str(v, 'nodes') === 'single'
        ? [text(`${lead}${open}word${close}${context} zz`)]
        : [text(lead), span(open, f), text(`word${close}${context} zz`)]
      const openAt = lead.length
      const closeAt = openAt + 5
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: f, lang: str(v, 'lang') }, parts),
        focus: [openAt, openAt + 1, closeAt, closeAt + 1],
        note: 'breaks around the quote pair',
      }
    },
  },
  {
    name: 'keep-all-storage',
    rules: {
      blink: ['blink/breaks/keep-all-letters-and-numbers', 'blink/breaks/latin1-pair-table'],
      webkit: ['webkit/breaks/keep-all-breakable-space', 'webkit/breaks/keep-all-punctuation-16bit-only', 'webkit/breaks/keep-all-before-zwsp', 'webkit/gap/string-storage'],
      gecko: ['gecko/icu4x/keep-all-pairs', 'gecko/linebreaker/compute-break-positions'],
    },
    why: 'WebKit keep-all breaks after punctuation only in 16-bit strings (webkit-text H15: abc,def(ghi中 gives [0, 4, 8], abc,def(ghi 1 line) and before rather than after ZWSP (H18); Blink and Gecko keep letters and numbers together per their tables. Relevant: the body, whether a non-Latin-1 character makes the node 16-bit, and keep-all against normal.',
    relevant: [
      { name: 'body', values: ['abc,def(ghi', 'abc def', '한국어,텍스트', 'a​b​c'] },
      { name: 'storage', values: ['8bit', '16bit'] },
      { name: 'wordBreak', values: ['keep-all', 'normal'] },
    ],
    neighbours: [
      { name: 'family', values: ['Arial', 'Apple SD Gothic Neo'] },
      { name: 'nodes', values: ['single', 'split'] },
    ],
    build(v) {
      const body = `${str(v, 'body')}${str(v, 'storage') === '16bit' ? '中' : ''}`
      const f = font(str(v, 'family'), 16)
      const comma = body.indexOf(',')
      const parts: Part[] = str(v, 'nodes') === 'split' && comma !== -1
        ? [text('xx '), span(body.slice(0, comma + 1), f), text(`${body.slice(comma + 1)} yy`)]
        : [text(`xx ${body} yy`)]
      return {
        pageLang: 'ko',
        paragraph: paragraph({ font: f, lang: 'ko', wordBreak: wordBreak(str(v, 'wordBreak')) }, parts),
        focus: [...offsetsAfter(body, ',(​ ', 3), 3 + body.length + 1],
        note: 'breaks after punctuation, spaces and ZWSP',
      }
    },
  },
  {
    name: 'segment-breaks',
    rules: {
      blink: ['blink/content/newline-removed-next-to-zwsp', 'blink/content/collapse-space-runs'],
      webkit: ['webkit/bidi/paragraph-text-lf-tab-as-space', 'webkit/lines/white-space-collapses-completely'],
      gecko: ['gecko/transform/segment-break-east-asian', 'gecko/transform/segment-break-to-space', 'gecko/transform/segment-break-removed-next-to-zwsp', 'gecko/transform/ja-zh-language-test', 'gecko/gap/ui-language'],
    },
    why: 'Gecko removes a newline between two East Asian wide characters, and next to East Asian punctuation under ja or zh (gecko-text H12-H15, across text nodes per CRITIC C9); Blink removes one only next to ZWSP. Relevant: the characters on each side, the lang including "", and whether the newline sits at a node edge.',
    relevant: [
      { name: 'pair', values: ['日本\n語', 'abc\n日本', '。\na', '한\n국', '中​\n中'] },
      { name: 'lang', values: ['ja', 'zh', 'en', ''] },
      { name: 'nodes', values: ['single', 'edge'] },
    ],
    neighbours: [{ name: 'family', values: ['PingFang SC', 'Hiragino Sans'] }],
    build(v) {
      const pair = str(v, 'pair')
      const newline = pair.indexOf('\n')
      const f = font(str(v, 'family'), 16)
      const lead = 'ああ '
      const parts: Part[] = str(v, 'nodes') === 'single'
        ? [text(`${lead}${pair}いい うう`)]
        : [text(lead), span(pair.slice(0, newline), f), text(`${pair.slice(newline)}いい うう`)]
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: f, lang: str(v, 'lang') }, parts),
        focus: [lead.length + newline, lead.length + newline + 1],
        note: 'breaks at the newline between wide characters',
      }
    },
  },
  {
    name: 'clusters',
    rules: {
      blink: ['blink/breaks/break-character-graphemes', 'blink/breaks/line-break-anywhere-settings', 'blink/breaks/break-all-table'],
      webkit: ['webkit/measure/break-word-complex-graphemes', 'webkit/measure/first-user-perceived-character', 'webkit/breaker/break-rule-anywhere'],
      gecko: ['gecko/glyphs/bengali-ya-phala', 'gecko/glyphs/cluster-boundaries', 'gecko/linebreaker/no-break-inside-cluster', 'gecko/icu4x/anywhere', 'gecko/icu4x/lb9-combining-marks-and-zwj'],
    },
    why: "Emergency breaks land on each engine's clusters: Gecko extends a cluster by U+09AF after U+09CD (ya-phala), Blink's break-all table breaks between two Thai characters inside a grapheme (lab README), line-break: anywhere breaks between every pair the iterator reaches (gecko-text H20). Relevant: words whose clusters the engines disagree on and the property that breaks them.",
    relevant: [
      { name: 'word', values: ['ক্যক্যক্য', 'স্ত্রস্ত্র', 'ééééé', 'ทูทูทู'] },
      { name: 'breaking', values: ['break-all', 'anywhere', 'line-break-anywhere'] },
    ],
    neighbours: [
      { name: 'size', values: [16, 24] },
      { name: 'letterSpacing', values: [0, 1] },
    ],
    build(v) {
      const word = str(v, 'word')
      const family = /[ঀ-৿]/.test(word) ? 'Kohinoor Bangla' : /[฀-๿]/.test(word) ? 'Thonburi' : 'Arial'
      const lang = /[ঀ-৿]/.test(word) ? 'bn' : /[฀-๿]/.test(word) ? 'th' : 'en'
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(family, Number(v['size'])), lang, letterSpacing: Number(v['letterSpacing']), ...breakingStyles(str(v, 'breaking')) }, [text(`x ${word} y`)]),
        focus: [2 + 1, 2 + 3, 2 + 5],
        note: 'emergency breaks inside the word',
      }
    },
  },
  {
    name: 'urls',
    rules: {
      blink: ['blink/breaks/latin1-pair-table', 'blink/breaks/icu-restarts-at-line-start'],
      webkit: ['webkit/breaks/latin1-pair-table', 'webkit/breaks/stale-fast-forward-state', 'webkit/breaks/breakable-positions-scan'],
      gecko: ['gecko/linebreaker/compute-break-positions', 'gecko/icu4x/line-iterator', 'gecko/glyphs/after-hyphen-emergency-wrap'],
    },
    why: "Breaks after slashes, hyphens and query punctuation come from each engine's pair tables and ICU restarts (main's layout.test.ts:706, :674 found the Gecko slash and hyphen-before-number shapes; research/TESTS.md §1c). Relevant: the URL-like word and whether overflow-wrap can split it.",
    relevant: [
      { name: 'body', values: ['and/or', '~/src/layout.ts', 'crash-log-2026-09-12.txt', 'https://example.com/a?b=c&d=e'] },
      { name: 'overflowWrap', values: ['normal', 'anywhere'] },
    ],
    neighbours: [
      { name: 'family', values: ['Arial', 'Menlo'] },
      { name: 'size', values: [12, 16] },
    ],
    build(v) {
      const body = str(v, 'body')
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), Number(v['size'])), lang: 'en', overflowWrap: str(v, 'overflowWrap') === 'anywhere' ? 'anywhere' : 'normal' }, [text(`see ${body} now`)]),
        focus: offsetsAfter(body, '/-?&.', 4),
        note: 'breaks after URL punctuation',
      }
    },
  },
  {
    name: 'zwnj',
    rules: {
      blink: ['blink/content/zwnj-splits-preserved-item', 'blink/shaping/zwnj-at-item-start-ends-group', 'blink/shape/default-ignorables-skipped-in-pair', 'blink/measure/ignorables-as-u2060'],
      webkit: ['webkit/content/items-at-breakable-positions'],
      gecko: ['gecko/glyphs/invalid-character-zero-glyph'],
    },
    why: 'Blink splits a preserved item at U+200C and starts a new shaping group at an item that starts with it (inline_node.cc:1625-1680); these rules were reached only by main-derived cases (RULES.md item 3). Relevant: the mode, where the ZWNJ sits, and whether it starts a span.',
    relevant: [
      { name: 'whiteSpace', values: ['normal', 'pre-wrap', 'break-spaces'] },
      { name: 'body', values: ['ab‌cd', 'ab ‌cd', 'بب‌بب'] },
      { name: 'span', values: ['none', 'item-start'] },
    ],
    neighbours: [{ name: 'family', values: ['Arial', 'Geeza Pro'] }],
    build(v) {
      const body = str(v, 'body')
      const zwnj = body.indexOf('‌')
      const f = font(str(v, 'family'), 16)
      const parts: Part[] = str(v, 'span') === 'none'
        ? [text(`xx ${body} yy zz`)]
        : [text(`xx ${body.slice(0, zwnj)}`), span(body.slice(zwnj), f), text(' yy zz')]
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: f, lang: 'en', whiteSpace: whiteSpace(str(v, 'whiteSpace')) }, parts),
        focus: [3 + zwnj, 3 + body.length + 1],
        note: 'breaks at and after the ZWNJ word',
      }
    },
  },
]
