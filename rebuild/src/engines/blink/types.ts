// Blink's prepared paragraph and line state (Chrome 153.0.8010.48). The Blink port owns this file.
import type { BlinkEnvironment } from '../../env.js'
import type { FontDecl, FontFacts, Gap, Paragraph } from '../../model.js'
import type { HanKerningFontData } from './hankerning.js'

// InlineItem types this model produces (specs/blink-text.md §1). The model has no <br>, <wbr>, atomic inlines, floats
// or unicode-bidi, so there are no bidi control, atomic or float items.
export type InlineItemType = 'text' | 'control' | 'open-tag' | 'close-tag'

// TextItemType of a control item: kForcedLineBreak (LF in preserve-breaks modes), or kFlowControl: a tab run, a
// generated U+200B after leading preserved spaces, CR or FF in preserve modes (inline_items_builder.cc:1040-1136).
export type ControlKind = 'none' | 'forced-break' | 'tab' | 'generated-zwsp' | 'cr-ff'

// End collapse types (inline_item.h:307).
export type EndCollapseType = 'not-collapsible' | 'collapsible' | 'collapsed' | 'opaque-to-collapsing'

// A ComputedStyle as far as this model varies it: the block's (index 0, also every bare text node's) or a span's.
export type BlinkStyle = {
  run: number | null
  font: FontDecl
  letterSpacing: number
  wordSpacing: number
  // FontDescription::Locale(): the nearest non-empty lang; null for lang="" (element.cc:12568-12600,
  // specs/blink-text.md §2.F.3).
  locale: string | null
  // Equal keys mean equal Font (font_description.cc:136-157): family, size, weight, style, locale and spacing.
  fontKey: string
  // The primary family: FontFacts.primaryFamily, or the first family of the list (DESIGN.md §1.2).
  primaryFamily: string
  // Whether the DOM's advances at the zoomed size are the CSS-size advances scaled: FontFacts.opticalSizeAxis, by default
  // true for Blink's system-font keywords (DESIGN.md §1.2, probes-chrome correction 7).
  measuresAtCssSize: boolean
  // FontFacts.joining as given; null lays joining letters at shaping-call edges out as an AAT font does and reports
  // joining-technology there.
  joining: FontFacts['joining']
}

// Canvas contexts per style: shaping (LTR, RTL) and the hyphen (no spacing), and the factor from Canvas px to zoomed px
// (the layout zoom for fonts measured at the CSS size, else 1).
export type StyleContexts = { ltr: number; rtl: number; hyphen: number; scale: number }

export type InlineItem = {
  type: InlineItemType
  control: ControlKind
  // [start, end) into text_content.
  start: number
  end: number
  // The run whose DOM node produced the item.
  run: number
  // Index into BlinkPrepared.styles: the style the item is handled under (a span's text and tags: the span's).
  style: number
  bidiLevel: number
  endCollapseType: EndCollapseType
  isEndCollapsibleNewline: boolean
  // Source offset of the collapsible space RemoveTrailingCollapsibleSpace erased, for a later restore; -1 otherwise.
  removedSpaceSource: number
  // The shaping group of a non-empty text item, -1 otherwise.
  group: number
}

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

export type IteratorSettings = {
  autoWrap: boolean
  strictness: 'default' | 'normal' | 'strict' | 'loose'
  // LineBreakType before an override: kNormal, kBreakAll, kKeepAll, or kBreakCharacter for line-break: anywhere.
  breakType: 'normal' | 'break-all' | 'keep-all' | 'break-character'
  breakAnywhereIfOverflow: boolean
  softHyphen: boolean
  breakSpace: 'after-space-run' | 'after-every-space'
}

// Everything prepare computes. nextLine only reads it.
export type BlinkPrepared = {
  paragraph: Paragraph
  env: BlinkEnvironment
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
  // Per text_content unit, its source offset, or -1 for a unit Blink generated (U+200B after leading spaces).
  sourceOffsets: Int32Array
  // Per source unit, its text_content unit, or -1 when white-space processing removed it.
  contentOffsets: Int32Array
  // Per source unit removed by white-space processing, the text_content offset its collapsed OffsetMapping unit maps to:
  // the length of text_content when it was collapsed (offset_mapping_builder.cc:95-117).
  collapsedAt: Int32Array
  // Per source unit, its run.
  sourceRuns: Int32Array
  sourceLength: number
  items: InlineItem[]
  styles: BlinkStyle[]
  groups: BlinkGroup[]
  contexts: StyleContexts[]
  bidiEnabled: boolean
  baseLevel: number
  settings: IteratorSettings
  // Extended grapheme cluster boundaries over text_content (flags per offset, the end included).
  graphemeStarts: Uint8Array
  // Per text_content unit, 1 when HarfBuzz marks it a continuation of the glyph cluster before it: a mark, a ZWJ and the
  // pictograph after it, an emoji modifier, the second of a regional indicator pair, a halfwidth voiced sound mark or a
  // tag character (hb-ot-shape.cc:466-522, hb-ot-layout.hh:246-251), or the trail unit of a surrogate pair.
  continuations: Uint8Array
  // Word spacing at text_content index 0 (WordSpacingWhiteSpacePre, inline_node.cc:1561-1565).
  wordSpacingAnywhere: boolean
  // HanKerning::FontData per style whose shaping groups HanKerning may apply to, measured in prepare.
  hanKerning: (HanKerningFontData | null)[]
  // The paragraph's gaps: its content, fonts and environment.
  gaps: Gap[]
}

// The break token (line_breaker.cc:4696-4774): nothing else carries to the next line (specs/blink-lines.md §4.1).
export type BlinkLineStart = {
  engine: 'blink'
  // InlineItemTextIndex.
  itemIndex: number
  textOffset: number
  // The style current at the break (index into BlinkPrepared.styles).
  style: number
  // The previous line ended in a forced break, so this line is not a wrapped line start and ShapeLine doesn't reshape
  // its start (shaping_line_breaker.cc IsStartOfWrappedLine).
  afterForcedBreak: boolean
}
