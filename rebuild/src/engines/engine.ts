// The interface each engine implements. index.ts runs the line loop over it; everything inside belongs to the engine.
import type { Measurer } from '../measure/canvas.js'
import type { Gap, LineOf, Paragraph } from '../model.js'

export type EngineImplementation<Env, Prepared, Start, Geometry> = {
  // Content building, itemization, bidi, break opportunities, and the widths the engine knows before it fills lines.
  prepare(paragraph: Paragraph, env: Env, measurer: Measurer): Prepared
  // Where the first line starts, or null when the paragraph makes no line.
  firstLine(prepared: Prepared): Start | null
  // Fills one line of `availableWidth` CSS px from `start`, measuring what the engine measures at line-edge time. Every
  // line the engine makes is returned, with or without a line box. The gaps its breaks decide go on the line; the
  // prepared paragraph never changes, so it can serve lines at other widths.
  nextLine(prepared: Prepared, start: Start, availableWidth: number, measurer: Measurer): LineOf<Start, Geometry>
  // The gaps of the paragraph's content, fonts and environment, whatever the width (DESIGN.md §5), computed by prepare.
  gaps(prepared: Prepared): Gap[]
}
