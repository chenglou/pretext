// Blink's prepared paragraph (Chrome 153.0.8010.48). The Blink port owns this file.
import type { ContentIndex } from '../../content.js'
import type { BlinkEnvironment } from '../../env.js'
import type { Context } from '../../measure/canvas.js'
import type { FontDecl, Gap, LineBreak, OverflowWrap, Paragraph, VerticalAlign, WhiteSpace, WordBreak } from '../../model.js'
import type { HanKerningFontData } from './hankerning.js'

// End collapse types (inline_item.h:307).
export type EndCollapseType = 'not-collapsible' | 'collapsible' | 'collapsed' | 'opaque-to-collapsing'

// One inline side of a span's box in raw LayoutUnits: ComputeLineMarginsForSelf, ComputeLineBorders and ComputeLinePadding
// resolve fixed lengths as LayoutUnit(float) of the zoomed px (line_breaker.cc:3937-3955; layout_unit.h:125-130).
export type BlinkBoxEdge = { margin: number; border: number; padding: number }

// LazyLineBreakIterator's settings from SetCurrentStyleForce (line_breaker.cc:4557-4643) for one style.
export type IteratorSettings = {
  autoWrap: boolean
  strictness: 'default' | 'normal' | 'strict' | 'loose'
  // LineBreakType before an override: kNormal, kBreakAll, kKeepAll, or kBreakCharacter for line-break: anywhere.
  breakType: 'normal' | 'break-all' | 'keep-all' | 'break-character'
  breakAnywhereIfOverflow: boolean
  softHyphen: boolean
  breakSpace: 'after-space-run' | 'after-every-space'
}

// A ComputedStyle as far as this model varies it, with its box: the block's (index 0, also every bare text node's) or a
// span's. Text nodes share their parent element's style, so a text item's style is its span's (Text::AttachLayoutTree).
// What the font declaration's facts say is read from `font.facts` where it decides something: `joining` (null lays joining
// letters at shaping-call edges out as an AAT font does and reports joining-technology there), `pairKerning` (where a pair
// adjustment sits between two glyphs; null places it on the first glyph and reports unsafe-to-break at line edges taken
// from positions where it isn't 0), `mapsHyphen`, and the listed families' coverage and ligatures.
export type ComputedStyle = {
  // The span this style belongs to, or -1 for the block.
  element: number
  // The style index of the element's parent: HandleCloseTag sets the parent's style (line_breaker.cc:4034).
  parent: number
  // The first text leaf directly under the element, for gap reports; null when there is none.
  run: number | null
  font: FontDecl
  letterSpacing: number
  wordSpacing: number
  whiteSpace: WhiteSpace
  wordBreak: WordBreak
  overflowWrap: OverflowWrap
  lineBreak: LineBreak
  tabSize: number
  // FontDescription::Locale(): the nearest lang; null for lang="" (element.cc:12653-12686 at 153, specs/blink-text.md §2.F.3).
  locale: string | null
  // Whether the DOM's advances at the zoomed size are the CSS-size advances scaled: FontFacts.opticalSizeAxis, by default
  // true for Blink's system-font keywords (DESIGN.md §1.2, probes-chrome correction 7).
  measuresAtCssSize: boolean
  // A span's own box edges; zero for the block, whose edges aren't inline boxes.
  start: BlinkBoxEdge
  end: BlinkBoxEdge
  verticalAlign: VerticalAlign
  iterator: IteratorSettings
  // A span's InlineItem::ShouldCreateBoxFragment, which Blink keeps on the LayoutInline (layout_inline.cc:183-231,
  // inline_items_builder.cc:244-273): its own box decorations, or a child that needs the box, so it is set while the items
  // are built. False for the block.
  shouldCreateBoxFragment: boolean
}

// Canvas contexts per style: shaping (LTR, RTL), shaping without liga, clig and calt (1/64 px letter spacing), the hyphen
// (no spacing), and the factor from Canvas px to zoomed px (the layout zoom for fonts measured at the CSS size, else 1).
export type StyleContexts = { ltr: Context; rtl: Context; ltrNoLigatures: Context; rtlNoLigatures: Context; hyphen: Context; scale: number }

// A style with what measuring keeps beside it. The two answers Canvas gives when they are first needed are the only
// prepared data written after prepare (the first adds its contexts to BlinkPrepared.canvases); each is a fact of the
// style's fonts that no layout changes.
export type BlinkStyle = ComputedStyle & {
  // The contexts the style's strings are measured on: references into BlinkPrepared.canvases.
  contexts: StyleContexts
  // In a segmented paragraph the contexts of the style's one-byte strings, null until one is asked (shape.ts contextsOf).
  oneByteContexts: StyleContexts | null
  // Whether Canvas shapes the style's strings word by word (Font::CanShapeWordByWord), measured when a 16-bit string first
  // holds a word edge; null until then (shape.ts canvasSplitsWords).
  canvasSplitsWords: boolean | null
  // HanKerning::FontData, measured in prepare for a style with a shaping group HanKerning may apply to; null for the others.
  hanKerning: HanKerningFontData | null
}

// What every InlineItem holds (inline_item.h).
type ItemBase = {
  // [start, end) into text_content.
  start: number
  end: number
  // Index into BlinkPrepared.styles: the style the item is handled under (a span's text and tags: the span's; an atomic,
  // <br> or <wbr> item: its parent's, which the model's elements inherit).
  style: number
  bidiLevel: number
  endCollapseType: EndCollapseType
}

// The InlineItem types this model produces (specs/blink-text.md §1; inline_item.h): text, control items, the open and close
// tags of spans, and atomic inlines. Floats, bidi controls, block-in-inline and ruby aren't in the model. `run` is the text
// leaf whose DOM node produced the item, `element` the element whose item it is. A non-empty text item's shaping group is
// BlinkPrepared.groupOfUnit at its start.
//
// A control item's TextItemType is kForcedLineBreak or kFlowControl (inline_items_builder.cc:317-326, 1040-1136,
// 1163-1218). Of a text leaf: `forced-break`, LF in preserve-breaks modes; `tab`, a tab run; `generated-zwsp`, a U+200B
// generated for line breaking (after leading preserved spaces, or where a nowrap space run meets a wrapping one);
// `cr-ff`, CR or FF in preserve modes. Of an element: `br`, a <br>'s LF, a forced break like the leaf's; `wbr`, a <wbr>'s
// U+200B.
export type TextItem = ItemBase & { type: 'text'; run: number; isEndCollapsibleNewline: boolean }
export type ControlItem =
  | ItemBase & { type: 'control'; control: 'forced-break' | 'tab' | 'generated-zwsp' | 'cr-ff'; run: number }
  | ItemBase & { type: 'control'; control: 'br' | 'wbr'; element: number }
export type TagItem = ItemBase & { type: 'open-tag' | 'close-tag'; element: number }
export type AtomicItem = ItemBase & { type: 'atomic'; element: number }
export type InlineItem = TextItem | ControlItem | TagItem | AtomicItem

// The text of one HarfBuzzShaper::Shape call over consecutive text items (inline_node.cc:1551-1796). Measured whole while
// below 256 zoomed px, else in pieces (shape.ts explains the model).
export type BlinkGroup = {
  start: number
  end: number
  style: number
  rtl: boolean
  // [start, piece ends..., end].
  cuts: number[]
  // 16.16 advance sum before each cut, including the pair adjustment at that cut, without HanKerning edge trims.
  prefixAtCut: number[]
  // What HanKerning's start and end contexts halt at the group's edges.
  startTrim16: number
  endTrim16: number
}

// What prepare keeps for inspection alone (index.ts inspectLine, paragraphGaps): the paragraph's gaps, its content's, its
// fonts' and the environment's, with the ones preparation's measuring raised first; canonical once prepare ends (gaps.ts
// canonicalGaps).
export type BlinkInspect = { gaps: Gap[] }

// Everything prepare computes. Filling a line only reads it, but for the two answers a style gets from Canvas when they
// are first needed (BlinkStyle).
export type BlinkPrepared = {
  paragraph: Paragraph
  env: BlinkEnvironment
  index: ContentIndex<FontDecl>
  // Device scale factor times browser zoom: every LayoutUnit counts 1/64 of a zoomed px (specs/blink-lines.md §2.1).
  layoutZoom: number
  // text_content: the paragraph string after white-space processing (specs/blink-text.md §2.C).
  text: string
  is8Bit: boolean
  // RunSegmenter segments text_content: it is 16-bit with a character other than U+FFFC, or bidi is on
  // (inline_node.cc:1256-1290). Otherwise the paragraph is one Latin segment.
  segmented: boolean
  // The script each text_content unit is shaped with (ScriptRunIterator over text_content, or Latin).
  scripts: Uint8Array
  // The font fallback priority RunSegmenter gives each text_content unit (emoji.ts): text, or one of the emoji kinds. A
  // change of priority ends a shaping segment like a change of script.
  priorities: Uint8Array
  // Per text_content unit, its source offset, or -1 for a unit Blink generated or an element's (U+200B after leading
  // spaces, a <wbr>'s U+200B, a <br>'s LF, an atomic inline's U+FFFC).
  sourceOffsets: Int32Array
  // Per source unit, its text_content unit, or -1 when white-space processing removed it.
  contentOffsets: Int32Array
  items: InlineItem[]
  styles: BlinkStyle[]
  groups: BlinkGroup[]
  bidiEnabled: boolean
  baseLevel: number
  // Extended grapheme cluster boundaries over text_content (flags per offset, the end included).
  graphemeStarts: Uint8Array
  // hanKerningCandidates(text_content), for HanKerning::MayApply over any range.
  hanKerningCandidates: Int32Array
  // Per text_content unit, 1 when HarfBuzz marks it a continuation of the glyph cluster before it: a mark, a ZWJ and the
  // pictograph after it, an emoji modifier, the second of a regional indicator pair, a halfwidth voiced sound mark or a
  // tag character (hb-ot-shape.cc:470-546, hb-ot-layout.hh:247 at harfbuzz dfdc088c), or the trail unit of a surrogate pair.
  continuations: Uint8Array
  // Per text_content offset, what the font declaration's ligature facts say about a glyph cluster over the boundary before
  // it (ligatures.ts): unknown, none, merged into a ligature's cluster, or uncertain.
  ligature: Uint8Array
  // Per text_content unit of a shaping group, the listed family that draws its glyph cluster by the declaration's coverage
  // facts, or -1 for a font they don't name. HarfBuzzShaper makes a run of every stretch one font draws.
  fontRun: Int16Array
  // Per text_content unit, its shaping group, or -1.
  groupOfUnit: Int32Array
  // The Canvas contexts the paragraph makes its own in, one per settings (measure/canvas.ts contextFor): the caller's list,
  // a page's or this paragraph's alone (measure/font-checks.ts Measurer). The styles' contexts are references into it,
  // styles with equal settings share a context, and it grows when a segmented paragraph first asks a one-byte string.
  canvases: Context[]
  // Null on a paragraph prepared plain: it gives lines and their pieces, computes no gap, no limit, no glyph cluster and no
  // offset mapping, and asks Canvas nothing that only those read; inspectLine and paragraphGaps throw on it.
  inspect: BlinkInspect | null
}
