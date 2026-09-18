// The interface each engine implements, and what it returns for a slot. index.ts dispatches over it one line at a time;
// everything inside belongs to the engine.
import type { EngineName } from '../env.js'
import type { Measurer } from '../measure/canvas.js'
import type { Fragment, Gap, LineSlot, Paragraph, TextAlign } from '../model.js'

export type EngineImplementation<Env, Prepared, Start, Geometry> = {
  // Content building from the inline tree, itemization, bidi, break opportunities, and the widths the engine knows before
  // it fills lines.
  prepare(paragraph: Paragraph, env: Env, measurer: Measurer): Prepared
  // Where the first line starts, or null when the paragraph makes no line.
  firstLine(prepared: Prepared): Start | null
  // Fills one line from `start` in `slot`: the content box less the slot's insets, as the engine turns float intrusion
  // into a line's offsets and available width, measuring what the engine measures at line-edge time (DESIGN.md §2.9).
  // Returns the line, with or without a line box, or below-floats when the slot has an inset and the engine moves the
  // line down past the floats instead. The gaps its breaks decide go on the line; the prepared paragraph never changes,
  // so it can serve lines in other slots, and a start state serves any slot of the next line.
  nextLine(prepared: Prepared, start: Start, slot: LineSlot, measurer: Measurer): LineResultOf<Start, Geometry>
  // The gaps of the paragraph's content, fonts and environment, whatever the slot (DESIGN.md §5), computed by prepare.
  gaps(prepared: Prepared): Gap[]
}

export type LineOf<Start, Geometry> = {
  // [start, end) covers every source unit the line consumed; consecutive lines tile the text. Elements that hold no text
  // are placed by fragments.
  start: number
  end: number
  fragments: Fragment[]
  // Whether the engine gives the line a line box that holds content: false for Blink's empty lines
  // (LineInfo::ShouldCreateLineBox, line_breaker.cc:945-975), WebKit lines without contentful inline content
  // (LineLayoutResult.h:94-105) and Gecko line boxes of block size 0 (nsLineLayout.cpp:1690-1712). A span's box edge,
  // an atomic inline or a <br> makes content. Such a line is still a line of the engine and is returned; it paints
  // nothing, takes no block size, and the lab and the painter skip it.
  hasLineBox: boolean
  // The paragraph's shaping joined the letters on both sides of this line's end: Blink reshaped the edge with HarfBuzz
  // context under an OpenType joining font (FontFacts.joining), Gecko broke inside one shaped word. The painter puts
  // U+200D on both sides of the edge (specs/painter.md R7). Always false in WebKit, which never shapes across a line
  // edge (specs/painter.md §3.2 c).
  joinsNextLine: boolean
  // The slot the line was laid out in.
  slot: LineSlot
  // The engine applied the paragraph's text-indent to this line.
  indented: boolean
  // The alignment the engine used for this line: text-align, or start for the last line and a line ending at a forced
  // break under justify (TextAlign).
  align: TextAlign
  geometry: Geometry
  // Gaps that depend on this line's breaks (DESIGN.md §2.8).
  gaps: Gap[]
  // null after the paragraph's last line.
  next: Start | null
}

// What an engine returns for one slot: the line it places there, or its decision to move the line box down past the
// floats narrowing the slot, because the line's first content doesn't fit beside them (CSS 2.1 §9.5). Blink continues
// with the next layout opportunity (inline_layout_algorithm.cc:1336-1367); WebKit wraps the candidate and moves the next
// line top below the float (InlineLineBuilder.cpp:1452-1457, InlineFormattingUtils.cpp:54-103); Gecko redoes the line in
// the next band (LineReflowStatus::RedoNextBand, nsBlockFrame.cpp:5289-5299, :5549-5555). A slot without insets never
// gives below-floats. `gaps` are the gaps the decision rests on. `next`, when given, is the start the next slot lays out
// instead of the same one, because building the refused line changed the engine's state: WebKit's first build places the
// slot floats, which later builds find in the formatting context (InlineLineBuilder.cpp:478, :1394-1396).
export type LineResultOf<Start, Geometry> =
  | { kind: 'line'; line: LineOf<Start, Geometry> }
  | { kind: 'below-floats'; gaps: Gap[]; next?: Start }

// Thrown by an engine for an input its port doesn't implement yet, such as a span with box edges before the per-span line
// state is ported (DESIGN.md §8.3, stage 5). It is a prediction error, never a silent prediction: the lab records it as
// one, and it never passes a metric.
export class UnportedFeature extends Error {
  readonly engine: EngineName
  readonly feature: string

  constructor(engine: EngineName, feature: string, detail: string) {
    super(`the ${engine} port doesn't implement ${feature} yet: ${detail}`)
    this.name = 'UnportedFeature'
    this.engine = engine
    this.feature = feature
  }
}
