// Families about line filling: the fit bound, spaces at a line end, controls, tabs, hanging white space, forced breaks,
// rewinds and breaks inside words.
import { font, paragraph, span, text, type Part } from '../../lab/cases/build.ts'
import type { Paragraph } from '../../lab/types.ts'
import { num, str, type RuleFamily } from './types.ts'

const LTR_RTL: readonly string[] = ['ltr', 'rtl']

function whiteSpace(value: string): Paragraph['whiteSpace'] {
  switch (value) {
    case 'normal': case 'pre': case 'pre-wrap': case 'pre-line': case 'nowrap': case 'break-spaces': return value
    default: throw new Error(`white-space ${value}`)
  }
}

function direction(value: string): Paragraph['direction'] {
  switch (value) {
    case 'ltr': case 'rtl': return value
    default: throw new Error(`direction ${value}`)
  }
}

function breakingStyles(value: string): { wordBreak: Paragraph['wordBreak']; overflowWrap: Paragraph['overflowWrap']; lineBreak: Paragraph['lineBreak'] } {
  switch (value) {
    case 'break-all': return { wordBreak: 'break-all', overflowWrap: 'normal', lineBreak: 'auto' }
    case 'anywhere': return { wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'auto' }
    case 'break-word': return { wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto' }
    case 'line-break-anywhere': return { wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'anywhere' }
    default: throw new Error(`breaking ${value}`)
  }
}

export const LINE_FAMILIES: readonly RuleFamily[] = [
  {
    name: 'fit-bound',
    rules: {
      blink: ['blink/lines/fit-bound-plus-one-lu', 'blink/units/lu-ceil', 'blink/units/available-width-trunc', 'blink/shapeline/candidate-at-space', 'blink/measure/zoomed-font-size'],
      webkit: ['webkit/lines/available-width-plus-1-64', 'webkit/lines/line-width-trunc64', 'webkit/measure/following-space-rule'],
      gecko: ['gecko/lines/fit-integer-au-le', 'gecko/lines/trim-trailing-at-break', 'gecko/measure/au-by-rounding'],
    },
    why: 'The fit test compares content in engine units with the available width: Blink LayoutUnits with +1 (line_breaker.h:307-317), WebKit float32 with +1/64 (InlineLineBuilder), Gecko integer app units (nsLineLayout). Relevant: the words and a font size whose zoomed or quantized value is not whole (blink-lines §2.3, gecko-canvas H3b).',
    relevant: [
      { name: 'words', values: ['nnnnn nnnnn nnnnn', 'Hello world again', 'aaaa bbbb cccc'] },
      { name: 'size', values: [16, 13, 17.3] },
    ],
    neighbours: [
      { name: 'family', values: ['Arial', 'Georgia', 'Courier New'] },
      { name: 'letterSpacing', values: [0, 0.5, -1] },
      { name: 'whiteSpace', values: ['normal', 'pre-wrap'] },
      { name: 'direction', values: LTR_RTL },
    ],
    build(v) {
      const words = str(v, 'words')
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), num(v, 'size')), lang: 'en', letterSpacing: num(v, 'letterSpacing'), whiteSpace: whiteSpace(str(v, 'whiteSpace')), direction: direction(str(v, 'direction')) }, [text(words)]),
        focus: [words.lastIndexOf(' ') + 1],
        note: 'third word starts a line',
      }
    },
  },
  {
    name: 'following-space',
    rules: {
      blink: ['blink/shapeline/no-reshape-at-space-line-end', 'blink/lines/trailing-space-truncated-without-reshape', 'blink/lines/remove-trailing-collapsible-space', 'blink/content/collapse-space-runs', 'blink/measure/word-spacing-in-js'],
      webkit: ['webkit/measure/following-space-rule', 'webkit/measure/collapsible-space-one-space', 'webkit/lines/trimmable-trailing-content', 'webkit/lines/remove-trimmable-trailing', 'webkit/measure/word-spacing-in-js'],
      gecko: ['gecko/lines/trim-trailing-at-break', 'gecko/transform/collapse-space-tab', 'gecko/spacing/word-spacing-space-nbsp', 'gecko/gap/space-in-shaping'],
    },
    why: 'A word is measured with the space after it (WebKit TextUtil.cpp:76-77, webkit-lines H19), and a line end at a space is not reshaped (Blink NeedsAccurateEndPosition, blink-lines H6: Arial (A, space) kerning −0.8828125). Relevant: a last glyph that kerns with a space, how many spaces, and a font with such a pair.',
    relevant: [
      { name: 'word', values: ['AAAA', 'LYAY', 'nnnn'] },
      { name: 'spaces', values: [' ', '   ', '  '] },
      { name: 'family', values: ['Arial', 'Times New Roman'] },
    ],
    neighbours: [
      { name: 'whiteSpace', values: ['normal', 'pre-wrap'] },
      { name: 'wordSpacing', values: [0, 4] },
      { name: 'direction', values: LTR_RTL },
    ],
    build(v) {
      const before = `xx ${str(v, 'word')}${str(v, 'spaces')}`
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), 20), lang: 'en', wordSpacing: num(v, 'wordSpacing'), whiteSpace: whiteSpace(str(v, 'whiteSpace')), direction: direction(str(v, 'direction')) }, [text(`${before}bbbb cc`)]),
        focus: [before.length],
        note: 'line ends after the kerning word and its spaces',
      }
    },
  },
  {
    name: 'controls',
    rules: {
      blink: ['blink/content/cr-collapses-as-space', 'blink/content/ff-vt-c0-stay-literal', 'blink/content/cr-ff-control-item', 'blink/lines/cr-ff-empty-item', 'blink/output/cr-ff-text', 'blink/shaping/control-item-ends-group', 'blink/measure/vt-ff-as-u0001', 'blink/gap/control-character-width'],
      webkit: ['webkit/content/vt-is-not-ascii-whitespace', 'webkit/measure/canvas-string-controls', 'webkit/gap/control-character-width'],
      gecko: ['gecko/transform/cr-kept-stops-collapsing', 'gecko/glyphs/invalid-character-zero-glyph', 'gecko/transform/collapse-space-tab'],
    },
    why: 'CR, FF and VT are handled per white-space mode: Blink collapses CR as a space and keeps FF and VT literal in collapse modes, and makes CR and FF zero-width control items in preserve modes (cross X2, blink-lines H12); WebKit gives FF and VT .notdef (webkit-text H12); Gecko keeps CR and stops collapsing (gecko-text H9, H10). Relevant: the control and the mode.',
    relevant: [
      { name: 'control', values: ['\r', '\f', '\v'] },
      { name: 'whiteSpace', values: ['normal', 'pre-wrap', 'pre-line', 'break-spaces'] },
    ],
    neighbours: [
      { name: 'family', values: ['Arial', 'Helvetica Neue'] },
      { name: 'place', values: ['inside', 'after-space'] },
    ],
    build(v) {
      const control = str(v, 'control')
      const body = str(v, 'place') === 'inside' ? `A${control}V` : `A ${control}V`
      const before = `aaaa ${body} `
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), 16), lang: 'en', whiteSpace: whiteSpace(str(v, 'whiteSpace')) }, [text(`${before}bbbb cc`)]),
        focus: [before.length, before.length + 5],
        note: 'lines end after the word holding the control',
      }
    },
  },
  {
    name: 'tabs',
    rules: {
      blink: ['blink/tabs/tab-stops', 'blink/tabs/half-space-minimum', 'blink/tabs/tab-size-zero', 'blink/lines/tab-item', 'blink/content/tab-run-control-item', 'blink/gap/tab-stops'],
      webkit: ['webkit/measure/tab-stop-from-pen-position', 'webkit/measure/tab-half-space-jump', 'webkit/measure/tab-size-zero', 'webkit/measure/letter-spacing-after-tab', 'webkit/measure/word-spacing-in-js', 'webkit/content/word-separator-tab-boundary', 'webkit/content/preserved-tab-defers-width', 'webkit/gap/tab-stops'],
      gecko: ['gecko/lines/tab-stops', 'gecko/measure/tab-width-containing-block', 'gecko/measure/min-tab-advance-and-hyphen-run', 'gecko/lines/tabs-zero-when-width-not-positive'],
    },
    why: 'Tab stops count from the line start in units of the space advance times tab-size, with a jump when the remainder is below half a space (webkit-lines H15; Blink simple_font_data.cc:225-240, blink-followups F4 with Helvetica Neue trak; gecko-lines H15). Relevant: tab-size including 0, the pen position before the tab, and fonts with and without trak.',
    relevant: [
      { name: 'tabSize', values: [0, 1, 4, 8] },
      { name: 'body', values: ['a\tb', 'abc\tdef', 'aaaaaaa\tb'] },
      { name: 'family', values: ['Arial', 'Helvetica Neue', 'Menlo'] },
    ],
    neighbours: [
      { name: 'letterSpacing', values: [0, 1] },
      { name: 'wordSpacing', values: [0, 3] },
      { name: 'whiteSpace', values: ['pre-wrap', 'break-spaces'] },
    ],
    build(v) {
      const before = `xx ${str(v, 'body')} `
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), 16), lang: 'en', tabSize: num(v, 'tabSize'), letterSpacing: num(v, 'letterSpacing'), wordSpacing: num(v, 'wordSpacing'), whiteSpace: whiteSpace(str(v, 'whiteSpace')) }, [text(`${before}yyyy zz`)]),
        focus: [before.length],
        note: 'line ends after the word holding the tab',
      }
    },
  },
  {
    name: 'hanging-white-space',
    rules: {
      blink: ['blink/lines/preserved-trailing-spaces-item', 'blink/lines/break-spaces-no-trailing-item', 'blink/breaks/break-spaces-after-every-space', 'blink/output/hang-width', 'blink/lines/trailing-collapsible-spaces-skipped'],
      webkit: ['webkit/lines/conditional-hang-stops-when-fits', 'webkit/lines/hanging-keeps-last-item', 'webkit/content/break-spaces-item-per-space', 'webkit/lines/rtl-trailing-whitespace-width'],
      gecko: ['gecko/lines/pre-wrap-hangs-overflowing-part', 'gecko/lines/break-spaces-after-space', 'gecko/output/hanging-from-char-is-space', 'gecko/lines/trim-trailing-whitespace-floor-unclamped'],
    },
    why: 'Preserved trailing white space hangs under pre-wrap (Gecko hangs only the overflowing part, gecko-lines H13), starts the next line under break-spaces (gecko-lines H14), and is trimmed under normal. Relevant: how much trailing white space, whether it holds a tab, and the mode.',
    relevant: [
      { name: 'trailing', values: [' ', '   ', '        ', '\t', ' \t '] },
      { name: 'whiteSpace', values: ['pre-wrap', 'break-spaces', 'normal'] },
    ],
    neighbours: [
      { name: 'family', values: ['Courier New', 'Arial'] },
      { name: 'direction', values: LTR_RTL },
    ],
    build(v) {
      const before = `aa aaaa${str(v, 'trailing')}`
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), 16), lang: 'en', whiteSpace: whiteSpace(str(v, 'whiteSpace')), direction: direction(str(v, 'direction')), tabSize: 4 }, [text(`${before}bb cc`)]),
        focus: [before.length],
        note: 'line ends after the trailing white space',
      }
    },
  },
  {
    name: 'forced-breaks',
    rules: {
      blink: ['blink/content/forced-break-item', 'blink/lines/forced-break', 'blink/content/collapse-space-runs'],
      webkit: ['webkit/content/u2028-u2029-force-in-collapse', 'webkit/content/soft-line-break-items', 'webkit/bidi/u2028-appended-itself'],
      gecko: ['gecko/bidi/paragraph-after-preserved-newline', 'gecko/lines/frame-ends-at-significant-newline', 'gecko/transform/segment-break-to-space', 'gecko/bidi/replace-separators'],
    },
    why: 'U+2028 and U+2029 force breaks in every white-space mode in WebKit 7625 (webkit-text H13, InlineItemsBuilder:954-962); LF only in preserve modes. Every lab U+2028 case was pre-wrap (RULES.md item 7). Relevant: the separator and the mode; the focus sits before and after it.',
    relevant: [
      { name: 'separator', values: [' ', ' ', '\n'] },
      { name: 'whiteSpace', values: ['normal', 'nowrap', 'pre-line', 'pre-wrap'] },
    ],
    neighbours: [
      { name: 'family', values: ['Arial', 'Georgia'] },
      { name: 'direction', values: LTR_RTL },
    ],
    build(v) {
      const first = `aaaa bbbb${str(v, 'separator')}`
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), 16), lang: 'en', whiteSpace: whiteSpace(str(v, 'whiteSpace')), direction: direction(str(v, 'direction')) }, [text(`${first}cc dddd eeee`)]),
        focus: [5, first.length + 8],
        note: 'breaks before and after the separator',
      }
    },
  },
  {
    name: 'rewind',
    rules: {
      blink: ['blink/lines/rewind-overflow', 'blink/lines/break-at-previous-opportunity', 'blink/lines/close-tag-break-after', 'blink/lines/open-tag-zero-size', 'blink/lines/overflow-kept'],
      webkit: ['webkit/breaker/try-previous-runs', 'webkit/breaker/revert-to-last-wrap-opportunity', 'webkit/ilb/wrap-reverts-after-box-start', 'webkit/ilb/next-wrap-opportunity'],
      gecko: ['gecko/lines/one-redo', 'gecko/lines/forced-break-in-redo', 'gecko/lines/first-opportunity-taken-even-if-overflowing', 'gecko/lines/can-place-frame-requests-backup', 'gecko/lines/break-before-frame', 'gecko/textrun/continue-across-frames', 'gecko/linebreaker/words-across-flows'],
    },
    why: 'When a frame or item overflows after an earlier break opportunity, the engine goes back to it: Gecko lays the line out once more with the saved break forced (gecko-lines H10: aa b<span>bbbbb</span> at 57.6px gives aa / bbbbbb); Blink rewinds (RewindOverflow); WebKit reverts to the last wrap opportunity. Relevant: a word continued by a span, the prefix before it and the word length.',
    relevant: [
      { name: 'prefix', values: ['aa', 'aaa aa'] },
      { name: 'tail', values: ['bbbbb', 'bbbbbbbb'] },
      { name: 'span', values: ['none', 'tail', 'word'] },
    ],
    neighbours: [
      { name: 'family', values: ['Courier New', 'Menlo', 'Arial'] },
      { name: 'whiteSpace', values: ['normal', 'pre-wrap'] },
    ],
    build(v) {
      const f = font(str(v, 'family'), 16)
      const prefix = `${str(v, 'prefix')} `
      const tail = str(v, 'tail')
      const parts: Part[] = []
      switch (str(v, 'span')) {
        case 'none': parts.push(text(`${prefix}b${tail} cc`)); break
        case 'tail': parts.push(text(`${prefix}b`), span(tail, f), text(' cc')); break
        case 'word': parts.push(text(prefix), span(`b${tail}`, f), text(' cc')); break
      }
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: f, lang: 'en', whiteSpace: whiteSpace(str(v, 'whiteSpace')) }, parts),
        focus: [prefix.length, prefix.length + 1 + tail.length + 1],
        note: 'the word after the prefix continues in a span',
      }
    },
  },
  {
    name: 'in-word-breaks',
    rules: {
      blink: ['blink/shapeline/line-end-reshape', 'blink/shapeline/line-start-reshape', 'blink/shapeline/line-end-reshape-walk-back', 'blink/shape/unsafe-to-break-offsets', 'blink/lines/reshape-slice', 'blink/lines/break-anywhere-retry', 'blink/breaks/break-all-table', 'blink/lines/overflow-rebreak-at-size-minus-1px', 'blink/gap/in-word-prefix', 'blink/gap/unsafe-to-break-attribution', 'blink/measure/pair-kerning-from-fact'],
      webkit: ['webkit/breaker/carried-remainder-width', 'webkit/lines/partial-leading-uses-carried-width', 'webkit/measure/break-word-probe-sequence', 'webkit/breaker/break-rule-anywhere', 'webkit/breaker/break-rule-break-all', 'webkit/breaker/break-rule-overflow-wrap', 'webkit/breaker/mid-word-break'],
      gecko: ['gecko/lines/in-word-advance-unit-minus-suffix', 'gecko/icu4x/break-all-letters-as-id', 'gecko/lines/word-wrap-break-priority', 'gecko/style/break-word-is-overflow-wrap-anywhere', 'gecko/gap/in-word-prefix', 'gecko/spacing/letter-spacing-after-cluster', 'gecko/lines/in-word-advance-split-kerning'],
    },
    why: 'A break inside a word reshapes the line edges at unsafe offsets in Blink (blink-lines §6), carries the rest of a split item without measuring it again in WebKit (webkit-lines H4: AV×17 in 16px Arial starts lines at [0, 11, 22]), and takes in-word advances from one shaping of the unit in Gecko. Where a break falls inside a kerning pair, HarfBuzz has put the adjustment on the first glyph (GPOS) or split it over both (the kern and kerx pair machine, hb-kern.hh:102-106; probe gecko-port F12: Times New Roman splits), which the pairKerning font fact says. Relevant: kerning pairs and ligatures inside the word, fonts on both sides of that fact, and which property breaks it.',
    relevant: [
      { name: 'word', values: ['AVAVAVAVAVAVAVAVAVAVAV', 'WaWaWaWaWaWaWaWaWa', 'ffiffiffiffiffiffi', 'nnnnnnnnnnnnnnnnnnnn'] },
      { name: 'breaking', values: ['break-all', 'anywhere', 'break-word'] },
    ],
    neighbours: [
      { name: 'family', values: ['Arial', 'Hoefler Text', 'Times New Roman'] },
      { name: 'size', values: [16, 24] },
      { name: 'letterSpacing', values: [0, 1] },
    ],
    build(v) {
      const word = str(v, 'word')
      const third = Math.floor(word.length / 3)
      return {
        pageLang: 'en',
        paragraph: paragraph({ font: font(str(v, 'family'), num(v, 'size')), lang: 'en', letterSpacing: num(v, 'letterSpacing'), ...breakingStyles(str(v, 'breaking')) }, [text(`x ${word} y`)]),
        focus: [2 + third, 2 + 2 * third],
        note: 'lines break inside the word',
      }
    },
  },
]

export { breakingStyles, direction, whiteSpace }
