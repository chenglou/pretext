// WebKit's prepared paragraph and line state (Safari 27.0, WebKit 7625.1.29.11.27). The WebKit port owns this file.
import type { WebKitEnvironment } from '../../env.js'
import type { Gap, Paragraph } from '../../model.js'

// Which line builder InlineFormattingContext::layout picks (specs/webkit-lines.md §2, InlineFormattingContext.cpp:170-184).
export type WebKitLineBuilder = 'text-only-simple' | 'range-based' | 'line-builder'

// white-space as WebKit stores it: WhiteSpaceCollapse plus TextWrapMode (specs/webkit-text.md §5.1).
export type WhiteSpaceCollapse = 'collapse' | 'preserve-breaks' | 'preserve' | 'break-spaces'

// TextBreakIterator::LineMode::Behavior from line-break (TextUtil.cpp:450-466).
export type LineBreakMode = 'Default' | 'Loose' | 'Normal' | 'Strict'

// The block's styles. In the model every span and bare text node inherits them.
export type WebKitStyle = {
  collapse: WhiteSpaceCollapse
  wrap: boolean
  wordBreak: Paragraph['wordBreak']
  overflowWrap: Paragraph['overflowWrap']
  lineBreak: Paragraph['lineBreak']
  lineBreakMode: LineBreakMode
  tabSize: number
  rtl: boolean
}

// One rendered Text node, WebKit's InlineTextBox, and the facts WebKit derives from its content and font.
export type WebKitBox = {
  run: number
  // Source offset of the box content's first code unit.
  sourceStart: number
  text: string
  // Stored as Latin-1: every code unit is at most U+00FF, what JS-created nodes get (gap string-storage).
  is8Bit: boolean
  // RenderText::canUseSimpleFontCodePath: FontCascade::characterRangeCodePath isn't Complex.
  simpleFontCodePath: boolean
  // InlineTextBox::canUseSimplifiedContentMeasuring (RenderText.cpp:480-524). The primary-font coverage condition is tested
  // only for fixed-pitch boxes, the only ones that read the result.
  simplifiedMeasuring: boolean
  // Font::determinePitch of the primary font (FontCoreText.cpp:753-785), from FontFacts.monospace: the breakWord shortcut
  // (TextUtil.cpp:265-280).
  fixedPitch: boolean
  // canTakeFixedPitchFastContentMeasuring: fixed pitch and a primary family other than Courier New (FontCoreText.cpp:776-784;
  // Safari hides user-installed fonts, so :784's attribute is never set for web content). The width shortcut.
  fixedPitchFastMeasuring: boolean
  // FontFacts.monospace was null: laid out as variable pitch, with the fixed-pitch-path gap where test T1 fails.
  monospaceUnknown: boolean
  // The primary family as a lowercase name, from FontFacts.primaryFamily or the first family listed.
  primaryFamily: string
  // hyphenString() (StyleComputedStyle.cpp:419-435): U+2010 when the primary font maps it, else U+002D. FontFacts.mapsHyphen
  // null lays out U+2010 and reports hyphen-glyph where the two measure differently.
  hyphen: string
  hyphenUnknown: boolean
  // computedLocale after the Han swap; '' for a null locale (specs/webkit-text.md §4.1).
  locale: string
  // Canvas contexts: the run's font with its letter spacing and no word spacing (JS adds word spacing as WidthIterator
  // does), and the same font with no spacing (the primary font's space advance for tab stops and the fixed-pitch shortcut).
  context: number
  plainContext: number
  // float32 px after page zoom.
  letterSpacing: number
  wordSpacing: number
  // InlineTextBox::hasStrongDirectionalityContent (TextUtil.cpp:486-576).
  hasStrongDirectionality: boolean
}

// InlineTextItem (InlineTextItem.h). `level` is UBIDI_DEFAULT_LTR (254) when bidi didn't run.
export type WebKitTextItem = {
  kind: 'text'
  box: number
  start: number
  end: number
  level: number
  isWhitespace: boolean
  isWordSeparator: boolean
  hasTrailingSoftHyphen: boolean
  // The float32 width stored when the item was built, the carried remainder of a split item, or null when the item is
  // measured when placed (specs/webkit-lines.md §3.2, §8.2).
  width: number | null
}

export type WebKitItem =
  | WebKitTextItem
  // A preserved LF, U+2028 or U+2029 (InlineSoftLineBreakItem).
  | { kind: 'soft-line-break'; box: number; start: number; level: number }
  | { kind: 'inline-box-start'; run: number; level: number }
  | { kind: 'inline-box-end'; run: number; level: number }

export type WebKitPrepared = {
  paragraph: Paragraph
  env: WebKitEnvironment
  // env.pageZoom, or 1 when it isn't given (gap page-zoom).
  zoom: number
  // env.icuDefaultLocale, or en_US_POSIX, what Apple ICU computes without LANG or LC_* (specs/webkit-gaps.md §8.2), when it
  // isn't given (gap ui-language where it decides).
  icuDefaultLocale: string
  style: WebKitStyle
  builder: WebKitLineBuilder
  boxes: WebKitBox[]
  // Source offset of each run's first code unit, and the total length at runs.length.
  runStarts: number[]
  items: WebKitItem[]
  gaps: Gap[]
}

// InlineItemPosition plus the PreviousLine facts the next line reads (specs/webkit-lines.md §5, §8.2).
export type WebKitLineStart = {
  engine: 'webkit'
  itemIndex: number
  offset: number
  // null on the first line, which has no PreviousLine.
  previousLine: {
    // trailingOverflowingContentWidth: the float32 width the rest of a split item keeps without being measured again
    // (AbstractLineBuilder.cpp:54-98), or null when the rest is measured fresh.
    carriedWidth: number | null
    endsWithLineBreak: boolean
  } | null
  isFirstFormattedLine: boolean
}
