// The interface each engine implements. index.ts runs the line loop over it; everything inside belongs to the engine.
import type { EngineName } from '../env.js'
import type { Measurer } from '../measure/canvas.js'
import type { Gap, LineResultOf, LineSlot, Paragraph } from '../model.js'

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
