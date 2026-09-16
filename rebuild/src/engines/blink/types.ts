// Blink's prepared paragraph and line state (Chrome 153.0.8010.48). The Blink port owns this file and may reshape it.
import type { Environment } from '../../env.js'
import type { Paragraph } from '../../model.js'

// InlineItem types in scope (specs/blink-text.md §1).
export type BlinkItemType = 'text' | 'control' | 'open-tag' | 'close-tag' | 'bidi-control'

// End collapse types (inline_item.h:307).
export type BlinkEndCollapseType = 'not-collapsible' | 'collapsible' | 'collapsed' | 'opaque-to-collapsing'

export type BlinkItem = {
  type: BlinkItemType
  // [start, end) into textContent.
  start: number
  end: number
  // The run whose style the item has; null for the paragraph's (open and close tags of spans carry their run).
  run: number | null
  bidiLevel: number
  endCollapseType: BlinkEndCollapseType
}

export type BlinkPrepared = {
  paragraph: Paragraph
  env: Environment
  // Device scale factor times browser zoom: every LayoutUnit counts 1/64 of a zoomed px (specs/blink-lines.md §2.1).
  layoutZoom: number
  // text_content: the paragraph string after white-space processing (specs/blink-text.md §2.C).
  textContent: string
  // Per textContent unit, its offset into the concatenated run text, or -1 for a unit Blink generated (U+200B, bidi controls).
  sourceOffsets: Int32Array
  items: BlinkItem[]
}

// The break token (line_breaker.cc:4696-4774): nothing else carries to the next line (specs/blink-lines.md §4.1).
export type BlinkLineStart = {
  engine: 'blink'
  // InlineItemTextIndex.
  itemIndex: number
  textOffset: number
  // The run whose style is current at the break, or null for the paragraph's style.
  styleRun: number | null
  // The previous line ended in a forced break, so this line is not a wrapped line start and ShapeLine doesn't reshape
  // its start (shaping_line_breaker.cc IsStartOfWrappedLine). A wrapped start at an unsafe offset is reshaped when the
  // line is filled; the state holds no width.
  afterForcedBreak: boolean
}
