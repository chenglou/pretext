// Blink's prepared paragraph and line state (Chrome 153.0.8010.48). The Blink port owns this file.
import type { Environment } from '../../env.js'
import type { Measurer } from '../../measure/canvas.js'
import type { FontDecl, Gap, Paragraph } from '../../model.js'
import type { HanKerningFontData } from './hankerning.js'

// InlineItem types this model produces (specs/blink-text.md §1). The model has no <br>, <wbr>, atomic inlines, floats
// or unicode-bidi, so there are no bidi control, atomic or float items.
export type BlinkItemType = 'text' | 'control' | 'open-tag' | 'close-tag'

// TextItemType of a control item: kForcedLineBreak (LF in preserve-breaks modes), or kFlowControl: a tab run, a
// generated U+200B after leading preserved spaces, CR or FF in preserve modes (inline_items_builder.cc:1040-1136).
export type BlinkControl = 'none' | 'forced-break' | 'tab' | 'generated-zwsp' | 'cr-ff'

// End collapse types (inline_item.h:307).
export type BlinkEndCollapseType = 'not-collapsible' | 'collapsible' | 'collapsed' | 'opaque-to-collapsing'

// A ComputedStyle as far as this model varies it: the block's (index 0, also every bare text node's) or a span's.
export type BlinkStyle = {
  run: number | null
  font: FontDecl
  letterSpacing: number
  wordSpacing: number
  // FontDescription::Locale(): the nearest non-empty lang, then <html lang>, then Content-Language; null without any
  // (element.cc:12653-12660, style_resolver.cc:2405-2406, specs/blink-text.md §2.F.3).
  locale: string | null
  // Equal keys mean equal Font (font_description.cc:136-157): family, size, weight, style, locale and spacing.
  fontKey: string
}

// Canvas contexts per style: shaping (LTR, RTL) and the hyphen (no spacing), and the factor from Canvas px to zoomed px
// (the layout zoom for fonts measured at the CSS size, else 1).
export type StyleContexts = { ltr: number; rtl: number; hyphen: number; scale: number }

export type BlinkItem = {
  type: BlinkItemType
  control: BlinkControl
  // [start, end) into text_content.
  start: number
  end: number
  // The run whose DOM node produced the item.
  run: number
  // Index into BlinkPrepared.styles: the style the item is handled under (a span's text and tags: the span's).
  style: number
  bidiLevel: number
  endCollapseType: BlinkEndCollapseType
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

export type BlinkPrepared = {
  paragraph: Paragraph
  env: Environment
  // The layout's one measurer, which firstLine also lays a line out with.
  measurer: Measurer
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
  // Per source unit, its run.
  sourceRuns: Int32Array
  sourceLength: number
  items: BlinkItem[]
  styles: BlinkStyle[]
  groups: BlinkGroup[]
  contexts: StyleContexts[]
  bidiEnabled: boolean
  baseLevel: number
  settings: IteratorSettings
  // Extended grapheme cluster boundaries over text_content (flags per offset, the end included).
  graphemeStarts: Uint8Array
  // Word spacing at text_content index 0 (WordSpacingWhiteSpacePre, inline_node.cc:1561-1565).
  wordSpacingAnywhere: boolean
  // HanKerning::FontData per style, measured when a style's text first needs it.
  hanKerning: (HanKerningFontData | null)[]
  // Named gaps found so far; nextLine adds the ones that depend on chosen breaks.
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
