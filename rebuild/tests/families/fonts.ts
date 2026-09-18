// Families about font facts and fonts: HanKerning, the hyphen glyph, joining technology, the monospace trait, system
// fonts and fractional sizes, and U+FFFC. The fact families have cases on both sides of each fact (DESIGN.md §8.3 stage 3):
// fonts that do and don't map U+2010, AAT and OpenType Arabic fonts, fonts with and without the monospace trait.
import { font, paragraph, span, text, type Part } from '../../lab/cases/build.ts'
import { breakingStyles, direction, whiteSpace } from './lines.ts'
import { num, str, type RuleFamily } from './types.ts'

const FIXTURES: Readonly<Record<string, readonly string[]>> = { 'Noto Naskh Arabic': ['Noto Naskh Arabic'], Amiri: ['Amiri'] }

export const FONT_FAMILIES: readonly RuleFamily[] = [
  {
    name: 'hankerning',
    rules: {
      blink: ['blink/hankerning/line-end-candidate-extension', 'blink/hankerning/line-end-halt-apply-end', 'blink/hankerning/end-context-halt', 'blink/hankerning/start-context-halt', 'blink/hankerning/open-mark-carries-adjustment', 'blink/hankerning/applies-to-16bit-marks', 'blink/hankerning/halted-group-start-unsafe', 'blink/hankerning/font-data-from-canvas', 'blink/gap/han-kerning'],
    },
    why: "HanKerning halves a fullwidth closing mark at a line end and by its neighbours (han_kerning.cc:292-301, shaping_line_breaker.cc:344-378; blink-lines H15: あああ」 in Hiragino Sans fits 8px below its unwrapped width). Relevant: the mark's type (close, open, dot, comma), its place relative to the line edge, and the font (TEST-ARCHITECTURE §2.2).",
    relevant: [
      { name: 'mark', values: ['」', '）', '。', '「', '、'] },
      { name: 'position', values: ['end', 'start', 'middle'] },
      { name: 'family', values: ['Hiragino Sans', 'PingFang SC', 'Songti SC'] },
    ],
    neighbours: [
      { name: 'whiteSpace', values: ['normal', 'pre-wrap'] },
      { name: 'letterSpacing', values: [0, 2] },
      { name: 'lang', values: ['ja', 'zh', 'en'] },
      { name: 'before', values: ['kana', 'latin'] },
    ],
    build(v) {
      const prefix = str(v, 'before') === 'kana' ? 'ああ' : 'ab'
      const lead = `${prefix}いうえ`
      const at = lead.length
      const focus = str(v, 'position') === 'end' ? at + 1 : str(v, 'position') === 'start' ? at : at + 3
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), 16), lang: str(v, 'lang'), letterSpacing: num(v, 'letterSpacing'), whiteSpace: whiteSpace(str(v, 'whiteSpace')) }, [text(`${lead}${str(v, 'mark')}おかきく`)]),
        focus: [focus],
        note: `mark at the line ${str(v, 'position')}`,
      }
    },
  },
  {
    name: 'hyphen-glyph',
    rules: {
      blink: ['blink/hyphen/glyph-from-fact', 'blink/hyphen/shaped-alone-without-spacing', 'blink/lines/hyphen-retry-without-room', 'blink/output/hyphen-fragment', 'blink/gap/hyphen-glyph', 'blink/gap/soft-hyphen-shaping'],
      webkit: ['webkit/measure/hyphen-from-fact', 'webkit/lines/trailing-hyphen', 'webkit/breaker/wrap-with-hyphen', 'webkit/ilb/soft-hyphen-counted-in-fit', 'webkit/content/item-ends-at-soft-hyphen', 'webkit/tos/revert-to-non-overflowing-hyphen', 'webkit/gap/hyphen-glyph'],
      gecko: ['gecko/transform/discard-soft-hyphen', 'gecko/lines/soft-hyphen-opportunity', 'gecko/lines/soft-hyphen-at-frame-end', 'gecko/lines/hyphen-in-frame-width', 'gecko/measure/min-tab-advance-and-hyphen-run'],
    },
    why: 'A chosen soft hyphen draws U+2010 when the primary font maps it, else "-" (computed_style.cc:1804-1820; StyleComputedStyle.cpp:419-435); Gecko substitutes in Canvas as in the DOM (gecko-canvas A8: Georgia has no U+2010). The hyphen is shaped without letter spacing in Blink (blink-lines H8) and fits with its width (H7). Relevant: fonts on both sides of mapsHyphen, one or two soft hyphens, letter spacing.',
    relevant: [
      { name: 'family', values: ['Arial', 'Georgia', 'Courier New', 'Menlo', 'Verdana', 'Helvetica Neue'] },
      { name: 'body', values: ['aaaa­bbbb', 'super­cali­fragi'] },
      { name: 'letterSpacing', values: [0, 3] },
    ],
    neighbours: [
      { name: 'nodes', values: ['single', 'span-after'] },
      { name: 'direction', values: ['ltr', 'rtl'] },
    ],
    build(v) {
      const body = str(v, 'body')
      const shy = body.indexOf('­')
      const f = font(str(v, 'family'), 16)
      const parts: Part[] = str(v, 'nodes') === 'single'
        ? [text(`cc ${body} dd`)]
        : [text(`cc ${body.slice(0, shy + 1)}`), span(body.slice(shy + 1), f), text(' dd')]
      const focus: number[] = []
      for (let i = 0; i < body.length; i++) if (body[i] === '­') focus.push(3 + i + 1)
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: f, lang: 'en', letterSpacing: num(v, 'letterSpacing'), direction: direction(str(v, 'direction')) }, parts),
        focus,
        note: 'breaks at the soft hyphens',
      }
    },
  },
  {
    name: 'joining',
    rules: {
      blink: ['blink/measure/joining-from-fact', 'blink/output/joins-next-line-from-fact', 'blink/gap/joining-technology', 'blink/measure/zwj-inside-group-edge', 'blink/shape/joining-reads-5-code-points-context', 'blink/measure/letter-spacing-cursive-adjust', 'blink/shape/pair-window-whole-clusters'],
      webkit: ['webkit/gap/rtl-shaping-across-inline-boxes', 'webkit/measure/break-word-complex-graphemes', 'webkit/content/complex-code-path'],
      gecko: ['gecko/lines/in-word-advance-unit-minus-suffix', 'gecko/output/joins-next-line', 'gecko/spacing/no-letter-spacing-cursive', 'gecko/gap/in-word-prefix'],
    },
    why: "Letters joined across a shaping-call edge keep joined forms in OpenType fonts and lose them in morx fonts (hb-ot-shape.cc:60-66, 100-101; blink-text H3: Geeza Pro is AAT; blink-followups F1: Amiri joins). Gecko's in-word advance at a break inside a joined word had no exact recipe in any font (probe-in-word, 2026-09-16). A mark after a soft hyphen continues the soft hyphen's glyph cluster (hb_form_clusters, hb-ot-shape.cc:578-586), so what is measured around that break holds both. Relevant: fonts on both sides of the joining fact, how the word breaks, a mark after the soft hyphen, and a span edge inside it.",
    relevant: [
      { name: 'family', values: ['Geeza Pro', 'Arial', 'Noto Naskh Arabic', 'Amiri'] },
      { name: 'breaking', values: ['shy', 'shy-mark', 'break-all', 'anywhere'] },
      { name: 'span', values: ['none', 'split'] },
    ],
    neighbours: [
      { name: 'letterSpacing', values: [0, 1] },
      { name: 'size', values: [16, 24] },
      { name: 'direction', values: ['rtl', 'ltr'] },
    ],
    build(v) {
      const family = str(v, 'family')
      const f = font(family, num(v, 'size'))
      const breaking = str(v, 'breaking')
      // 'shy-mark': a kasra right after the soft hyphen.
      const shy = breaking === 'shy' || breaking === 'shy-mark'
      const word = breaking === 'shy' ? 'ببب­ببب' : breaking === 'shy-mark' ? 'ببب­ِببب' : 'بببببب'
      const half = shy ? 4 : 3
      const parts: Part[] = str(v, 'span') === 'none'
        ? [text(`بب ${word} بب`)]
        : [text('بب '), span(word.slice(0, half), f), span(word.slice(half), f), text(' بب')]
      const styles = shy ? {} : breakingStyles(breaking)
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: f, lang: 'ar', letterSpacing: num(v, 'letterSpacing'), direction: direction(str(v, 'direction')), ...styles }, parts),
        ...(FIXTURES[family] === undefined ? {} : { fontFixtures: FIXTURES[family] }),
        focus: [3 + half, 3 + 2],
        note: 'breaks inside a joined word',
      }
    },
  },
  {
    name: 'monospace',
    rules: {
      blink: ['blink/lines/break-anywhere-retry', 'blink/breaks/break-anywhere-if-overflow-settings'],
      webkit: ['webkit/content/monospace-from-fact', 'webkit/content/courier-new-no-width-shortcut', 'webkit/measure/fixed-pitch-width', 'webkit/measure/break-word-fixed-pitch-shortcut', 'webkit/content/simplified-measuring-eligible', 'webkit/gap/fixed-pitch-path', 'webkit/gap/simplified-measuring'],
      gecko: ['gecko/lines/word-wrap-break-priority', 'gecko/measure/word-units'],
    },
    why: "WebKit's fixed-pitch path returns length × space width for fonts with kCTFontMonoSpaceTrait, and breakWord estimates by the space width (FontCoreText.cpp:753-785; webkit-gaps §2.3-§2.5); Courier New gets no width shortcut (:776-782). Relevant: fonts on both sides of the monospace fact, Courier New itself, and the overflow-wrap values that run breakWord.",
    relevant: [
      { name: 'family', values: ['Menlo', 'Courier New', 'Monaco', 'Arial'] },
      { name: 'breaking', values: ['break-word', 'anywhere'] },
      { name: 'body', values: ['aaaaaaaaaaaaaaaaaaaaaaaa', 'iiiWWWiiiWWWiiiWWW'] },
    ],
    neighbours: [
      { name: 'letterSpacing', values: [0, 1] },
      { name: 'whiteSpace', values: ['normal', 'pre-wrap'] },
      { name: 'size', values: [12, 16] },
    ],
    build(v) {
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), num(v, 'size')), lang: 'en', letterSpacing: num(v, 'letterSpacing'), whiteSpace: whiteSpace(str(v, 'whiteSpace')), ...breakingStyles(str(v, 'breaking')) }, [text(`x ${str(v, 'body')} y`)]),
        focus: [2 + 8, 2 + 16],
        note: 'emergency breaks in a monospaced word',
      }
    },
  },
  {
    name: 'system-fonts-and-sizes',
    rules: {
      blink: ['blink/measure/optical-size-from-fact', 'blink/gap/optical-size', 'blink/gap/page-history', 'blink/measure/zoomed-font-size'],
      webkit: ['webkit/gap/canvas-language'],
      gecko: ['gecko/gap/optical-size-from-fact', 'gecko/gap/font-size-quantization', 'gecko/measure/au-by-rounding'],
    },
    why: "system-ui and BlinkMacSystemFont resolve to the platform UI font, whose opsz axis the DOM sets at the CSS size (blink-canvas H16, cross X5; -apple-system resolves like sans-serif in Chrome 153); Gecko quantizes sizes to 10 bits in the DOM and 7 in Canvas (gecko-canvas H3b: 16.8px lays out at 16.8125). No lab case used system-ui or a fractional size (RULES.md item 2). Relevant: the keyword families against a named font, and sizes with and without fractional parts.",
    relevant: [
      { name: 'family', values: ['system-ui', 'BlinkMacSystemFont', '-apple-system', 'Georgia'] },
      { name: 'size', values: [13, 17, 20.5, 13.33, 16.8] },
    ],
    neighbours: [
      { name: 'letterSpacing', values: [0, 0.5] },
      { name: 'weight', values: [400, 700] },
    ],
    build(v) {
      const words = 'Hello world again and more'
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), num(v, 'size'), num(v, 'weight')), lang: 'en', letterSpacing: num(v, 'letterSpacing') }, [text(words)]),
        focus: [words.indexOf('again'), words.indexOf('and')],
        note: 'breaks at the third and fourth words',
      }
    },
  },
  {
    name: 'object-replacement',
    rules: { blink: ['blink/gap/font-fallback-u-fffc'] },
    why: "Blink's Canvas measures U+FFFC as U+200B, and all 183 lab cases holding it failed a prediction metric (blink-shortcut-audit C-u4). Relevant: where U+FFFC sits relative to letters and spaces, and fonts that may or may not cover it.",
    relevant: [
      { name: 'body', values: ['aa￼bb', 'aa ￼ bb', '￼aaaa'] },
      { name: 'family', values: ['Arial', 'Times New Roman', 'Menlo'] },
    ],
    neighbours: [
      { name: 'whiteSpace', values: ['normal', 'pre-wrap'] },
      { name: 'overflowWrap', values: ['normal', 'anywhere'] },
    ],
    build(v) {
      const body = str(v, 'body')
      const at = 3 + body.indexOf('￼')
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), 16), lang: 'en', whiteSpace: whiteSpace(str(v, 'whiteSpace')), overflowWrap: str(v, 'overflowWrap') === 'anywhere' ? 'anywhere' : 'normal' }, [text(`zz ${body} yyyy ww`)]),
        focus: [at, at + 1, 3 + body.length + 1],
        note: 'breaks around U+FFFC',
      }
    },
  },
]
