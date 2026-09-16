// The library's data: the styled paragraph it takes and the lines it gives back. DESIGN.md §1 and §2 explain every
// field with examples. The lab's case shapes re-export the input types (rebuild/lab/types.ts).
import type { EngineName } from './env.js'
import type { BlinkLineStart } from './engines/blink/types.js'
import type { GeckoLineStart } from './engines/gecko/types.js'
import type { WebKitLineStart } from './engines/webkit/types.js'
import type { MeasureLog } from './measure/log.js'

// ---- Input ----

export type FontDecl = {
  // CSS font-family list, e.g. '"Helvetica Neue", Arial'.
  family: string
  // CSS px.
  size: number
  weight: number
  style: 'normal' | 'italic'
}

export type WhiteSpace = 'normal' | 'pre' | 'pre-wrap' | 'pre-line' | 'nowrap' | 'break-spaces'
export type WordBreak = 'normal' | 'break-all' | 'keep-all' | 'break-word'
export type OverflowWrap = 'normal' | 'break-word' | 'anywhere'
export type LineBreak = 'auto' | 'loose' | 'normal' | 'strict' | 'anywhere'
export type Direction = 'ltr' | 'rtl'

export type TextRun = {
  text: string
  // 'span': the text in its own <span> carrying this run's styles.
  // 'text': a bare text node inheriting the paragraph's styles (for example white space between spans);
  // its font, letterSpacing, wordSpacing and lang must equal the paragraph's.
  node: 'span' | 'text'
  font: FontDecl
  letterSpacing: number
  wordSpacing: number
  // The span's lang attribute; null inherits the paragraph's.
  lang: string | null
}

export type Paragraph = {
  runs: TextRun[]
  // The block's own styles, inherited by bare text nodes.
  font: FontDecl
  letterSpacing: number
  wordSpacing: number
  // Content-box width in CSS px.
  width: number
  // Fixed line height in CSS px.
  lineHeight: number
  whiteSpace: WhiteSpace
  wordBreak: WordBreak
  overflowWrap: OverflowWrap
  lineBreak: LineBreak
  tabSize: number
  direction: Direction
  // The paragraph element's lang attribute.
  lang: string
}

// ---- Output ----

// A line's width in the engine's own unit, before conversion to CSS px.
export type EngineWidth =
  // LayoutUnit: 1/64 of a zoomed px. CSS px = raw / 64 / layoutZoom (specs/blink-lines.md §1.1, §2.4).
  | { unit: 'blink-layout-unit'; raw: number; layoutZoom: number }
  // InlineLayoutUnit: a float32 CSS px value (specs/webkit-lines.md §1.1).
  | { unit: 'webkit-float32-px'; value: number }
  // nscoord: integer app units, 60 per CSS px at any DPR (specs/gecko-lines.md §2).
  | { unit: 'gecko-app-unit'; au: number }

// A piece of a line in logical order. `run` indexes paragraph.runs; start/end are UTF-16 offsets into the concatenation
// of all run texts. Widths are CSS px.
//
// `level` is the bidi embedding level the engine reorders the piece with, after its own line-end rule for trailing white
// space (Blink compares levels, WebKit parity, Gecko has none; specs/bidi.md §6). Engines split pieces where the level
// changes, as they split items and frames, so the painter can rebuild the paragraph's levels (specs/painter.md §4.4).
export type Fragment =
  // Painted text: the source range as the engine lays it out (collapsed white space becomes one space, and so on).
  | { kind: 'text'; run: number; start: number; end: number; painted: string; width: number; level: number }
  // Collapsible white space the engine removed at the end of the line after choosing the break. It has no width, but it
  // is painted: the browser trims it again and shapes the text before it as the engine did (specs/painter.md §3.1 c,
  // §3.2 a, R3).
  | { kind: 'trimmed'; run: number; start: number; end: number; painted: string; level: number }
  // Source text the engine never lays out: white space collapsed into earlier white space, a removed segment break,
  // leading white space skipped at a line start. Not painted.
  | { kind: 'collapsed'; run: number; start: number; end: number }
  // Preserved trailing white space that stays on the line but doesn't count against the available width.
  | { kind: 'hanging'; run: number; start: number; end: number; painted: string; width: number; level: number }
  // The hyphen drawn at a soft-hyphen break, after source offset `at`. letterSpacing is what the engine applies to it.
  | { kind: 'hyphen'; run: number; at: number; painted: string; letterSpacing: number; width: number; level: number }
  // A preserved newline, U+2028 or U+2029 that ended the line. Not painted.
  | { kind: 'forced-break'; run: number; start: number; end: number }

// The state the next line starts from, per engine (DESIGN.md §2).
export type LineStart = BlinkLineStart | WebKitLineStart | GeckoLineStart

export type LineOf<Start> = {
  // [start, end) covers every source unit the line consumed, collapsed and hanging white space and a forced break included.
  start: number
  end: number
  // CSS px: the extent of the painted content, hanging white space excluded.
  width: number
  engineWidth: EngineWidth
  fragments: Fragment[]
  // The paragraph's shaping joined the letters on both sides of this line's end: a cursive connection that the engine
  // shaped across the break (Blink through HarfBuzz's context, Gecko inside one shaped word). The painter puts U+200D on
  // both sides of the edge to keep the joining forms (specs/painter.md R7). Always false in WebKit, which never shapes
  // across a line edge (specs/painter.md §3.2 c).
  joinsNextLine: boolean
  // null after the paragraph's last line.
  next: Start | null
}

export type Line = LineOf<LineStart>

// A Canvas-versus-DOM gap a paragraph runs into: the prediction can be wrong where it applies (DESIGN.md §5).
export type GapName =
  | 'control-character-width'
  | 'soft-hyphen-shaping'
  | 'hyphen-glyph'
  | 'letter-spacing-ligatures'
  | 'canvas-language'
  | 'optical-size'
  | 'font-size-quantization'
  | 'bitmap-emoji-size'
  | 'unsafe-to-break'
  | 'script-context'
  | 'space-in-shaping'
  | 'in-word-prefix'
  | 'fixed-pitch-path'
  | 'simplified-measuring'
  | 'rtl-shaping-across-inline-boxes'
  | 'page-zoom'
  | 'dictionary-breaks-unavailable'
  | 'font-fallback'
  | 'float32-precision'
  | 'string-storage'
  | 'ui-language'
  | 'han-kerning'
  | 'dictionary-breaks-stand-in'
  | 'tab-stops'

export type Gap = { gap: GapName; run: number | null; detail: string }

export type ParagraphLayout = {
  engine: EngineName
  lines: Line[]
  measure: MeasureLog
  gaps: Gap[]
}
