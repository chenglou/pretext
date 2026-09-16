// WebKit's prepared paragraph and line state (Safari 27.0, WebKit 7625.1.29.11.27). The WebKit port owns this file.
import type { Environment } from '../../env.js'
import type { Paragraph } from '../../model.js'

// The three line builders give different results for soft hyphens and tabs (specs/webkit-lines.md §2).
export type WebKitLineBuilder = 'text-only-simple' | 'range-based' | 'line-builder'

export type WebKitItemKind = 'word' | 'whitespace' | 'soft-line-break' | 'inline-box-start' | 'inline-box-end'

export type WebKitItem = {
  kind: WebKitItemKind
  // The text box (run index) and [start, end) into that box's content.
  box: number
  start: number
  end: number
  bidiLevel: number
  // Word separator white space (specs/webkit-text.md §5.2).
  isWordSeparator: boolean
  hasTrailingSoftHyphen: boolean
  // The float32 width stored when the item was built, or null when measurement is deferred (specs/webkit-lines.md §3.2).
  storedWidth: number | null
}

export type WebKitPrepared = {
  paragraph: Paragraph
  env: Environment
  builder: WebKitLineBuilder
  // Per run, the text box content after text-transform, or null for a run that gets no renderer (specs/webkit-text.md §2).
  boxes: (string | null)[]
  items: WebKitItem[]
}

// InlineItemPosition plus the PreviousLine facts the next line reads (specs/webkit-lines.md §8.2).
export type WebKitLineStart = {
  engine: 'webkit'
  itemIndex: number
  offset: number
  // trailingOverflowingContentWidth: the float32 width the rest of a split item keeps without being measured again
  // (AbstractLineBuilder.cpp:54-98), or null when the rest is measured fresh.
  carriedWidth: number | null
  endsWithLineBreak: boolean
  isFirstFormattedLine: boolean
}
