// Families about inline structure, line slots and alignment (DESIGN.md §1.1, §2.9, §8.3 stage 5): box edges of spans at
// wrap points, nested spans, nowrap and wrapping spans inside each other, atomic inlines next to NBSP, CJK and spaces,
// <br> and <wbr>, text-indent, text-align, and per-line available widths through stacked floats. Plus unlabeled content
// under the browser process's languages, which the lab launches Chrome with.
import { atomic, br, el, font, leaf, treeParagraph, wbr, type SpanSpec, type TreePart } from '../../lab/cases/build.ts'
import type { BoxEdge } from '../../src/model.ts'
import type { InlineStructure, LineSlot, Paragraph } from '../../lab/types.ts'
import { direction, whiteSpace } from './lines.ts'
import { num, str, type RuleFamily } from './types.ts'

const LTR_RTL: readonly string[] = ['ltr', 'rtl']

function verticalAlign(value: string): 'baseline' | '0px' {
  switch (value) {
    case 'baseline': case '0px': return value
    default: throw new Error(`vertical-align ${value}`)
  }
}

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

function textAlign(value: string): InlineStructure['textAlign'] {
  switch (value) {
    case 'start': case 'end': case 'left': case 'right': case 'center': case 'justify': return value
    default: throw new Error(`text-align ${value}`)
  }
}

function edgeOf(kind: string, amount: number): Partial<BoxEdge> {
  switch (kind) {
    case 'padding': return { padding: amount }
    case 'border': return { border: amount }
    case 'border-padding': return { border: amount / 2, padding: amount / 2 }
    case 'margin': return { margin: amount }
    case 'negative-margin': return { margin: -amount }
    default: throw new Error(`box edge ${kind}`)
  }
}

// Offsets inside the text, never 0 or the end, deduplicated in order.
function inside(offsets: readonly number[], length: number): number[] {
  return [...new Set(offsets.filter(offset => offset > 0 && offset < length))].sort((a, b) => a - b)
}

function textLength(paragraph: Paragraph): number {
  let length = 0
  for (let i = 0; i < paragraph.runs.length; i++) length += paragraph.runs[i]!.text.length
  return length
}

export const INLINE_FAMILIES: readonly RuleFamily[] = [
  {
    name: 'box-edges',
    rules: {
      blink: ['blink/lines/open-tag-edge-size', 'blink/lines/close-tag-edge-size', 'blink/style/box-edge-layout-units', 'blink/shaping/box-edge-ends-group', 'blink/output/inline-box-item', 'blink/lines/close-tag-break-after', 'blink/lines/rewind-overflow'],
      webkit: ['webkit/lines/inline-box-edge-widths', 'webkit/lines/line-spanning-inline-boxes', 'webkit/lines/decorated-box-is-content', 'webkit/style/box-geometry-units'],
      gecko: ['gecko/lines/begin-span-line-data', 'gecko/lines/continuation-reserves-end-edge', 'gecko/lines/end-margin-last-continuation', 'gecko/textrun/box-edges-end-run', 'gecko/style/box-edge-app-units'],
    },
    why: "A span's inline start and end edges take room on the lines holding them: Blink adds margin, border and padding at the open and close tags (ComputeOpenTagResult, HandleOpenTag, HandleCloseTag, ComputeInlineEndSize, line_breaker.cc:245-252, :3937-4025); WebKit makes inline box start and end items that wide (inlineItemWidth, InlineFormattingUtils.cpp:300-333); Gecko reserves the end border and padding on every continuation and the end margin on the last (nsInlineFrame.cpp:505-522, nsLineLayout.cpp:1199-1228). A nonzero edge or vertical-align other than baseline ends shaping in Blink (inline_node.cc:494-527) and a text run in Gecko (nsTextFrame.cpp:2054-2137). Each style system turns declared lengths into its units, border widths included. Relevant: the edge's kind, its side, and where the span sits against a break (a whole word, across a break, inside a word).",
    relevant: [
      { name: 'kind', values: ['padding', 'border', 'margin', 'negative-margin'] },
      { name: 'side', values: ['start', 'end', 'both'] },
      { name: 'placement', values: ['word', 'across', 'in-word'] },
    ],
    neighbours: [
      { name: 'amount', values: [6, 0.4] },
      { name: 'family', values: ['Arial', 'Menlo', 'Times New Roman'] },
      { name: 'whiteSpace', values: ['normal', 'pre-wrap'] },
      { name: 'direction', values: LTR_RTL },
      { name: 'verticalAlign', values: ['baseline', '0px'] },
    ],
    build(v) {
      const edge = edgeOf(str(v, 'kind'), num(v, 'amount'))
      const side = str(v, 'side')
      const spec: SpanSpec = { ...(side === 'end' ? {} : { start: edge }), ...(side === 'start' ? {} : { end: edge }), verticalAlign: verticalAlign(str(v, 'verticalAlign')) }
      // xx aaaa bbbb cccc dddd: bbbb starts at 8, cccc at 13, dddd at 18.
      let parts: TreePart[]
      switch (str(v, 'placement')) {
        case 'word': parts = [leaf('xx aaaa '), el(spec, leaf('bbbb')), leaf(' cccc dddd')]; break
        case 'across': parts = [leaf('xx aaaa '), el(spec, leaf('bbbb cccc')), leaf(' dddd')]; break
        default: parts = [leaf('xx aaaa b'), el(spec, leaf('bbb')), leaf(' cccc dddd')]; break
      }
      const tree = treeParagraph({ font: font(str(v, 'family'), 16), lang: 'en', whiteSpace: whiteSpace(str(v, 'whiteSpace')), direction: direction(str(v, 'direction')) }, parts)
      return { pageLang: 'en', ...tree, focus: [8, 13, 18], note: `${str(v, 'kind')} at the span's ${side} edge, span placement ${str(v, 'placement')}` }
    },
  },
  {
    name: 'nested-box-edges',
    rules: {
      blink: ['blink/lines/open-tag-edge-size', 'blink/lines/close-tag-edge-size', 'blink/lines/rewind-trailing-open-tags', 'blink/output/inline-box-item'],
      webkit: ['webkit/lines/inline-box-edge-widths', 'webkit/lines/line-spanning-inline-boxes', 'webkit/lines/trimmable-trailing-content'],
      gecko: ['gecko/lines/begin-span-line-data', 'gecko/lines/continuation-reserves-end-edge', 'gecko/lines/end-margin-last-continuation', 'gecko/lines/trim-recurses-into-spans'],
    },
    why: 'Nested spans stack their end edges where they close together, and Gecko reserves each open span\'s end border and padding on every line it continues on, whether or not the span ends there (nsInlineFrame.cpp:505-522); its trailing white space trimming recurses into spans (nsLineLayout.cpp:2851-2985). Blink moves open tags at a line end to the next line (RewindOverflow). Relevant: which spans have end edges, the edge kind, and whether the start edges match.',
    relevant: [
      { name: 'ends', values: ['inner', 'outer', 'both'] },
      { name: 'kind', values: ['padding', 'border-padding', 'margin'] },
      { name: 'starts', values: ['none', 'same'] },
    ],
    neighbours: [
      { name: 'family', values: ['Arial', 'Courier New'] },
      { name: 'whiteSpace', values: ['normal', 'pre-wrap'] },
      { name: 'direction', values: LTR_RTL },
    ],
    build(v) {
      const edge = edgeOf(str(v, 'kind'), 8)
      const ends = str(v, 'ends')
      const withStart = str(v, 'starts') === 'same'
      const inner: SpanSpec = ends === 'outer' ? {} : { end: edge, ...(withStart ? { start: edge } : {}) }
      const outer: SpanSpec = ends === 'inner' ? {} : { end: edge, ...(withStart ? { start: edge } : {}) }
      // xx <outer>aaaa <inner>bbbb</inner> cccc</outer> dddd: bbbb at 8, cccc at 13, dddd at 18.
      const tree = treeParagraph({ font: font(str(v, 'family'), 16), lang: 'en', whiteSpace: whiteSpace(str(v, 'whiteSpace')), direction: direction(str(v, 'direction')) },
        [leaf('xx '), el(outer, leaf('aaaa '), el(inner, leaf('bbbb')), leaf(' cccc')), leaf(' dddd')])
      return { pageLang: 'en', ...tree, focus: [8, 13, 18], note: `end edges on ${ends} span, ${str(v, 'kind')}` }
    },
  },
  {
    name: 'nowrap-spans',
    rules: {
      blink: ['blink/lines/per-item-wrap-style', 'blink/lines/wrap-span-inside-nowrap-recomputes-break', 'blink/lines/nowrap-item-added-whole'],
      webkit: ['webkit/style/per-box-style-record', 'webkit/breaks/nearest-common-ancestor-white-space', 'webkit/builder/eligibility-over-style-record'],
      gecko: ['gecko/lines/nowrap-span-fits', 'gecko/lines/begin-span-line-data', 'gecko/linebreaker/nowrap-suppresses-breaks'],
    },
    why: "Wrapping follows each element's own white-space, read at different places: Blink reads the item's style at every block-style site and recomputes the break after the text before a wrapping span opened inside a nowrap one (line_breaker.cc:3996-4005, :4557-4643; inline_items_builder.cc:851-866); WebKit decides a soft wrap opportunity between two text items by the white-space of their nearest common ancestor (InlineFormattingUtils.cpp:357-383, :436); Gecko fits everything inside a nowrap span (psd->mNoWrap, nsLineLayout.cpp:1230-1234). Relevant: the block's and the span's modes, and where the spaces sit against the span's edges.",
    relevant: [
      { name: 'pair', values: ['nowrap-in-normal', 'normal-in-nowrap', 'pre-wrap-in-nowrap', 'nowrap-in-pre-wrap', 'pre-in-normal'] },
      { name: 'placement', values: ['space-before', 'space-inside-start', 'space-after', 'nested'] },
    ],
    neighbours: [
      { name: 'family', values: ['Arial', 'Courier New'] },
      { name: 'direction', values: LTR_RTL },
      { name: 'edges', values: ['none', 'padding'] },
    ],
    build(v) {
      const [spanMode, blockMode] = str(v, 'pair').split('-in-') as [string, string]
      const edges: SpanSpec = str(v, 'edges') === 'padding' ? { start: { padding: 4 }, end: { padding: 4 } } : {}
      const span: SpanSpec = { ...edges, whiteSpace: whiteSpace(spanMode) }
      // xx aaaa bbbb cccc dddd eeee: bbbb at 8, cccc at 13, dddd at 18, eeee at 23.
      let parts: TreePart[]
      switch (str(v, 'placement')) {
        case 'space-before': parts = [leaf('xx aaaa '), el(span, leaf('bbbb cccc')), leaf(' dddd eeee')]; break
        case 'space-inside-start': parts = [leaf('xx aaaa'), el(span, leaf(' bbbb cccc')), leaf(' dddd eeee')]; break
        case 'space-after': parts = [leaf('xx aaaa '), el(span, leaf('bbbb cccc ')), leaf('dddd eeee')]; break
        default: parts = [leaf('xx aaaa '), el(span, leaf('bbbb '), el({ whiteSpace: whiteSpace(blockMode) }, leaf('cccc dddd'))), leaf(' eeee')]; break
      }
      const tree = treeParagraph({ font: font(str(v, 'family'), 16), lang: 'en', whiteSpace: whiteSpace(blockMode), direction: direction(str(v, 'direction')) }, parts)
      return { pageLang: 'en', ...tree, focus: [8, 13, 18, 23], note: `${spanMode} span in a ${blockMode} block, ${str(v, 'placement')}` }
    },
  },
  {
    name: 'atomic-inlines',
    rules: {
      blink: ['blink/content/atomic-inline-object-replacement', 'blink/lines/atomic-inline-item', 'blink/output/inline-box-item'],
      webkit: ['webkit/breaks/atomic-soft-wrap-opportunity', 'webkit/lines/atomic-margin-box-width'],
      gecko: ['gecko/lines/break-after-non-text-frame', 'gecko/lines/nowrap-span-fits'],
    },
    why: 'An atomic inline is one unbreakable item of its margin box: Blink puts U+FFFC in text_content and breaks around it by the line-break tables (inline_items_builder.cc:1269-1283; HandleAtomicInline, line_breaker.cc:3043-3110; MayBeAtomicInline, :1269-1300); WebKit treats it like an ideograph for soft wrap opportunities (isAtSoftWrapOpportunity, InlineFormattingUtils.cpp:446-450); Gecko records a break opportunity after a non-text frame (nsLineLayout.cpp:1057-1080). All follow the parent\'s white-space. Relevant: the character before and after the box (a letter, a collapsible space, NBSP, an ideograph) and the parent\'s mode.',
    relevant: [
      { name: 'before', values: ['letter', 'space', 'nbsp', 'ideograph'] },
      { name: 'after', values: ['letter', 'space', 'nbsp', 'ideograph'] },
      { name: 'parent', values: ['normal', 'nowrap-span', 'pre-wrap'] },
    ],
    neighbours: [
      { name: 'family', values: ['Arial', 'Hiragino Sans'] },
      { name: 'width', values: [24, 13.3] },
      { name: 'margins', values: ['none', 'mixed'] },
      { name: 'direction', values: LTR_RTL },
    ],
    build(v) {
      const character: Readonly<Record<string, string>> = { letter: 'a', space: ' ', nbsp: ' ', ideograph: '中' }
      const before = character[str(v, 'before')]!
      const after = character[str(v, 'after')]!
      const mixed = str(v, 'margins') === 'mixed'
      const box = atomic(num(v, 'width'), 20, mixed ? 4 : 0, mixed ? -2 : 0)
      const parent = str(v, 'parent')
      const lead = `xx aaaa${before}`
      const parts: TreePart[] = parent === 'nowrap-span'
        ? [leaf('xx '), el({ whiteSpace: 'nowrap' }, leaf(`aaaa${before}`), box, leaf(`${after}bbbb`)), leaf(' cccc')]
        : [leaf(lead), box, leaf(`${after}bbbb cccc`)]
      const tree = treeParagraph({ font: font(str(v, 'family'), 16), lang: 'en', whiteSpace: parent === 'pre-wrap' ? 'pre-wrap' : 'normal', direction: direction(str(v, 'direction')) }, parts)
      const at = lead.length
      return { pageLang: 'en', ...tree, focus: inside([3, at, at + after.length, at + after.length + 5], textLength(tree.paragraph)), note: `atomic inline between ${str(v, 'before')} and ${str(v, 'after')}, parent ${parent}` }
    },
  },
  {
    name: 'br-elements',
    rules: {
      blink: ['blink/content/br-forced-break-item', 'blink/lines/forced-break', 'blink/lines/remove-trailing-collapsible-space', 'blink/content/collapse-space-runs'],
      webkit: ['webkit/content/hard-line-break-item', 'webkit/lines/trimmable-trailing-content', 'webkit/lines/remove-trimmable-trailing'],
      gecko: ['gecko/lines/br-frame-always-placed', 'gecko/lines/trim-trailing-at-break', 'gecko/lines/trim-recurses-into-spans'],
    },
    why: '<br> forces a break: Blink appends LayoutBR\'s "\\n" as a forced-break control item (layout_br.cc:33-37, inline_items_builder.cc:1163-1198), WebKit a hard line break item (InlineItemsBuilder.cpp:91, :1073-1076), Gecko always places the BRFrame (nsLineLayout.cpp:1273-1278). The collapsible white space before it is trimmed at the line end, and what follows starts a fresh line. Relevant: what precedes the br (a word, spaces, a tab, nothing), what follows (a word, a space, another br), and the mode.',
    relevant: [
      { name: 'before', values: ['word', 'space', 'spaces-tab', 'start'] },
      { name: 'after', values: ['word', 'space-word', 'double'] },
      { name: 'whiteSpace', values: ['normal', 'pre-wrap', 'pre-line', 'break-spaces'] },
    ],
    neighbours: [
      { name: 'family', values: ['Arial', 'Georgia'] },
      { name: 'direction', values: LTR_RTL },
      { name: 'inSpan', values: ['no', 'yes'] },
    ],
    build(v) {
      const beforeText: Readonly<Record<string, string>> = { word: 'xx aaaa', space: 'xx aaaa ', 'spaces-tab': 'xx aaaa  \t', start: '' }
      const afterText: Readonly<Record<string, string>> = { word: 'bbbb', 'space-word': ' bbbb', double: 'bbbb' }
      const lead = beforeText[str(v, 'before')]!
      const next = afterText[str(v, 'after')]!
      const breaks: TreePart[] = str(v, 'after') === 'double' ? [br(), br()] : [br()]
      const head: TreePart[] = lead === '' ? breaks : [leaf(lead), ...breaks]
      const parts: TreePart[] = str(v, 'inSpan') === 'yes'
        ? [el({ end: { padding: 3 } }, ...head), leaf(`${next} cccc dddd`)]
        : [...head, leaf(`${next} cccc dddd`)]
      const tree = treeParagraph({ font: font(str(v, 'family'), 16), lang: 'en', whiteSpace: whiteSpace(str(v, 'whiteSpace')), direction: direction(str(v, 'direction')), tabSize: 4 }, parts)
      const at = lead.length
      return { pageLang: 'en', ...tree, focus: inside([3, at, at + next.length + 1, at + next.length + 6], textLength(tree.paragraph)), note: `br after ${str(v, 'before')}, followed by ${str(v, 'after')}` }
    },
  },
  {
    name: 'wbr-elements',
    rules: {
      blink: ['blink/content/wbr-flow-control-zwsp', 'blink/breaks/keep-all-letters-and-numbers', 'blink/lines/per-item-wrap-style'],
      webkit: ['webkit/content/word-break-opportunity-item', 'webkit/breaks/keep-all-breakable-space', 'webkit/style/per-box-style-record'],
      gecko: ['gecko/lines/wbr-frame-opportunity', 'gecko/icu4x/keep-all-pairs', 'gecko/lines/nowrap-span-fits'],
    },
    why: '<wbr> is a soft wrap opportunity without a character: Blink appends an opaque U+200B flow-control item (layout_word_break.cc:35; inline_items_builder.cc:597-607, :1211-1218), WebKit a word break opportunity item (InlineFormattingUtils.cpp:311, :469; InlineItemsBuilder.cpp:596-616), Gecko a WBRFrame. Whether it breaks under keep-all, inside a nowrap span or before a space is the question. Relevant: the text around it, word-break and the mode.',
    relevant: [
      { name: 'body', values: ['latin', 'hangul', 'before-space', 'ideographs'] },
      { name: 'wordBreak', values: ['normal', 'keep-all', 'break-all'] },
      { name: 'mode', values: ['normal', 'pre-wrap', 'nowrap-span'] },
    ],
    neighbours: [
      { name: 'family', values: ['Apple SD Gothic Neo', 'Hiragino Sans'] },
      { name: 'lang', values: ['ko', 'en'] },
    ],
    build(v) {
      const bodies: Readonly<Record<string, readonly [string, string]>> = { latin: ['aaaa', 'bbbb'], hangul: ['한국어', '텍스트'], 'before-space': ['aaaa', ' bbbb'], ideographs: ['中文字', '中文字'] }
      const [first, second] = bodies[str(v, 'body')]!
      const mode = str(v, 'mode')
      const parts: TreePart[] = mode === 'nowrap-span'
        ? [leaf('xx '), el({ whiteSpace: 'nowrap' }, leaf(first), wbr(), leaf(second)), leaf(' yyyy zz')]
        : [leaf(`xx ${first}`), wbr(), leaf(`${second} yyyy zz`)]
      const tree = treeParagraph({ font: font(str(v, 'family'), 16), lang: str(v, 'lang'), wordBreak: wordBreak(str(v, 'wordBreak')), whiteSpace: mode === 'pre-wrap' ? 'pre-wrap' : 'normal' }, parts)
      const at = 3 + first.length
      return { pageLang: 'en', ...tree, focus: inside([at, at + second.length + 1], textLength(tree.paragraph)), note: `wbr in ${str(v, 'body')}, ${str(v, 'wordBreak')}, ${mode}` }
    },
  },
  {
    name: 'text-indent',
    rules: {
      blink: ['blink/lines/text-indent-first-formatted-line', 'blink/tabs/tab-stops', 'blink/output/apply-text-align'],
      webkit: ['webkit/lines/text-indent-start-margin', 'webkit/tabs/content-edge-offset', 'webkit/measure/tab-stop-from-pen-position'],
      gecko: ['gecko/lines/text-indent-root-span', 'gecko/lines/tab-stops', 'gecko/tabs/distance-from-content-edge'],
    },
    why: 'text-indent applies to the first formatted line: Blink starts the line position at it, so tab stops count from the content edge (ShouldApplyTextIndent, line_breaker.cc:45-56, :846-857, :878-879); WebKit applies it as a start margin of the line rect, and tab stops read m_lineContentEdgeOffset (InlineFormattingUtils.cpp:143-176; InlineLineBuilder.cpp:454-478); Gecko adds it to the root span\'s position (nsLineLayout.cpp:178-201). Relevant: positive and negative, whole and fractional indents, a tab on the first line, a line after <br>, a word longer than the line, and the direction.',
    relevant: [
      { name: 'indent', values: [16, 40.3, -12, -40] },
      { name: 'body', values: ['words', 'tab', 'br', 'long-word'] },
      { name: 'direction', values: LTR_RTL },
    ],
    neighbours: [
      { name: 'family', values: ['Arial', 'Menlo'] },
      { name: 'tabSize', values: [4, 8] },
      { name: 'textAlign', values: ['start', 'center'] },
    ],
    build(v) {
      const body = str(v, 'body')
      let parts: TreePart[]
      let focus: number[]
      switch (body) {
        case 'words': parts = [leaf('aaaa bbbb cccc dddd eeee')]; focus = [5, 10, 15, 20]; break
        case 'tab': parts = [leaf('aa\tbbbb cccc dddd eeee')]; focus = [8, 13, 18]; break
        case 'br': parts = [leaf('aaaa bbbb'), br(), leaf('cccc dddd eeee')]; focus = [5, 9, 14, 19]; break
        default: parts = [leaf('aaaaaaaaaaaaaaaa bbbb cccc')]; focus = [8, 17, 22]; break
      }
      const tree = treeParagraph({
        font: font(str(v, 'family'), 16), lang: 'en', whiteSpace: body === 'tab' ? 'pre-wrap' : 'normal', overflowWrap: body === 'long-word' ? 'anywhere' : 'normal',
        tabSize: num(v, 'tabSize'), direction: direction(str(v, 'direction')), textIndent: num(v, 'indent'), textAlign: textAlign(str(v, 'textAlign')),
      }, parts)
      return { pageLang: 'en', ...tree, focus, note: `text-indent ${num(v, 'indent')}px, ${body}` }
    },
  },
  {
    name: 'text-align',
    rules: {
      blink: ['blink/shapeline/needs-accurate-end-position', 'blink/shapeline/no-reshape-at-space-line-end', 'blink/shapeline/line-end-reshape', 'blink/output/apply-text-align'],
      webkit: ['webkit/output/horizontal-alignment-offset', 'webkit/output/justify-expansion', 'webkit/builder/eligibility-over-style-record', 'webkit/measure/following-space-rule'],
      gecko: ['gecko/output/text-align-line', 'gecko/lines/trim-trailing-at-break'],
    },
    why: "Blink's NeedsAccurateEndPosition is true for end, center, justify, left in RTL and right in LTR (line_info.cc:127-175), and a line ending at a space is then reshaped at its end where under start it isn't (line_breaker.cc:255-268, :1658, :2387): with Arial's (A, space) kerning the fit changes by a fraction of a px (blink-lines H6). WebKit's simple builder refuses justify (TextOnlySimpleLineBuilder.cpp:488-528) and justification expands boxes (InlineContentAligner.cpp:230-302); Gecko aligns in TextAlignLine (nsLineLayout.cpp:3482-3670). Relevant: every text-align value, the direction, and a last word that kerns with the space after it.",
    relevant: [
      { name: 'align', values: ['start', 'end', 'center', 'justify', 'left', 'right'] },
      { name: 'direction', values: LTR_RTL },
      { name: 'word', values: ['AAAA', 'LYAY', 'nnnn'] },
    ],
    neighbours: [
      { name: 'spaces', values: [' ', '   '] },
      { name: 'whiteSpace', values: ['normal', 'pre-wrap'] },
      { name: 'family', values: ['Arial', 'Times New Roman'] },
    ],
    build(v) {
      const before = `xx ${str(v, 'word')}${str(v, 'spaces')}`
      const tree = treeParagraph({ font: font(str(v, 'family'), 20), lang: 'en', whiteSpace: whiteSpace(str(v, 'whiteSpace')), direction: direction(str(v, 'direction')), textAlign: textAlign(str(v, 'align')) },
        [leaf(`${before}bbbb cc dddd`)])
      return { pageLang: 'en', ...tree, focus: [before.length, before.length + 5], note: `text-align ${str(v, 'align')}, line ends after the kerning word and its spaces` }
    },
  },
  {
    name: 'line-slots',
    rules: {
      blink: ['blink/lines/line-layout-opportunity', 'blink/lines/overflow-moves-to-next-opportunity', 'blink/tabs/float-offset', 'blink/units/available-width-trunc'],
      webkit: ['webkit/lines/float-avoiding-rect', 'webkit/lines/candidate-beside-float-wraps', 'webkit/tabs/content-edge-offset'],
      gecko: ['gecko/lines/float-available-space', 'gecko/lines/impacted-by-floats', 'gecko/lines/redo-next-band', 'gecko/tabs/distance-from-content-edge'],
    },
    why: "Floats narrow each line box by their margin boxes, and every engine turns the insets into line offsets with its own arithmetic: Blink's LineLayoutOpportunity truncates the content width and each float edge to LayoutUnits separately (inline_layout_algorithm.cc:1166-1224), WebKit's float-avoiding line rect (InlineLineBuilder.cpp:463-476, :1185-1216), Gecko's float available space (nsBlockFrame.cpp:5252-5273). A line whose first content doesn't fit beside the floats moves below them (Blink :1336-1367; WebKit InlineLineBuilder.cpp:1452-1457; Gecko RedoNextBand, nsBlockFrame.cpp:5549-5555), and tab stops read the float offset (line_breaker.cc:674-693; InlineLineBuilder.cpp:478; nsTextFrame.cpp:11063-11067). Relevant: which sides have floats, rows of equal insets or a wide row before or after a narrow one, whole and fractional insets, and a first word or tab the slot can't hold.",
    relevant: [
      { name: 'shape', values: ['uniform', 'decreasing', 'increasing'] },
      { name: 'sides', values: ['left', 'right', 'both'] },
      { name: 'inset', values: [40, 37.3] },
      { name: 'body', values: ['words', 'long-word', 'tabs'] },
    ],
    neighbours: [
      { name: 'direction', values: LTR_RTL },
      { name: 'family', values: ['Arial', 'Menlo'] },
      { name: 'textIndent', values: [0, 10] },
    ],
    build(v) {
      const inset = num(v, 'inset')
      const rows = str(v, 'shape') === 'uniform' ? [inset, inset, inset] : str(v, 'shape') === 'decreasing' ? [3 * inset, inset, inset] : [inset, 3 * inset, inset]
      const sides = str(v, 'sides')
      const lineSlots: LineSlot[] = rows.map(row => ({ left: sides === 'right' ? 0 : row, right: sides === 'left' ? 0 : row }))
      const body = str(v, 'body')
      let text: string
      let focus: number[]
      switch (body) {
        case 'words': text = 'aaaa bbbb cccc dddd eeee ffff gggg'; focus = [5, 10, 15, 20, 25]; break
        case 'long-word': text = 'aaaaaaaaaaaa bbbb cccc dddd eeee'; focus = [13, 18, 23, 28]; break
        default: text = 'aaaa\tbbbb cccc\tdddd eeee'; focus = [10, 15, 20]; break
      }
      const tree = treeParagraph({
        font: font(str(v, 'family'), 16), lang: 'en', whiteSpace: body === 'tabs' ? 'pre-wrap' : 'normal', tabSize: 4, direction: direction(str(v, 'direction')),
        textIndent: num(v, 'textIndent'), lineSlots,
      }, [leaf(text)])
      return { pageLang: 'en', ...tree, focus, note: `${str(v, 'shape')} slot rows on ${sides}, inset ${inset}px, ${body}` }
    },
  },
  {
    name: 'process-languages',
    rules: {
      blink: ['blink/breaks/null-locale-ui-language', 'blink/style/lang-empty-null-locale', 'blink/breaks/ko-strict-retries-ui-language', 'blink/gap/ui-language'],
    },
    why: "Content without a usable language breaks by the browser process's languages: Blink opens the UI language's break table for a style with no locale and drops the line-break keywords (DefaultLanguage, language.cc:62-99; blink-text H15, H16; a zh UI gives line_normal_cj, so a”b breaks after ”), and lang=\"\" gives a null locale (element.cc; style_resolver.cc:2405-2406). The lab launches Chrome under two application locales (lab/languages.ts); each derivation runs under one, and the environment key names it. Relevant: text the zh and en tables disagree on, the line-break keyword, and where the empty lang sits: the block, a span in a labeled block, a span inside a span with another lang.",
    relevant: [
      { name: 'body', values: ['aa”bb', 'あぁいぃうぅ', '中々中々', 'ab·cd'] },
      { name: 'where', values: ['block', 'span', 'nested'] },
      { name: 'lineBreak', values: ['auto', 'strict', 'loose'] },
    ],
    neighbours: [{ name: 'family', values: ['Hiragino Sans', 'PingFang SC'] }],
    build(v) {
      const body = str(v, 'body')
      const where = str(v, 'where')
      const parts: TreePart[] = where === 'block'
        ? [leaf(`xx ${body} cc dd`)]
        : where === 'span'
          ? [leaf('xx '), el({ lang: '' }, leaf(body)), leaf(' cc dd')]
          : [leaf('xx '), el({ lang: 'ja' }, el({ lang: '' }, leaf(body))), leaf(' cc dd')]
      const tree = treeParagraph({ font: font(str(v, 'family'), 16), lang: where === 'block' ? '' : 'en', lineBreak: lineBreak(str(v, 'lineBreak')) }, parts)
      const focus = body.includes('”') ? [3 + 3] : [3 + 1, 3 + 2, 3 + 3]
      return { pageLang: 'en', paragraph: tree.paragraph, inline: tree.inline, focus, note: `lang="" on the ${where}, ${body}` }
    },
  },
]
