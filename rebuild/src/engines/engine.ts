// The interface each engine implements. index.ts runs the line loop over it; everything inside belongs to the engine.
import type { Environment } from '../env.js'
import type { Measurer } from '../measure/canvas.js'
import type { Gap, LineOf, Paragraph } from '../model.js'

export type EngineImplementation<Prepared, Start> = {
  // Content building, itemization, bidi, break opportunities, and the widths the engine knows before it fills lines.
  prepare(paragraph: Paragraph, env: Environment, measurer: Measurer): Prepared
  // Where the first line starts, or null when the paragraph produces no line box.
  firstLine(prepared: Prepared): Start | null
  // Fills one line of `availableWidth` CSS px from `start`, measuring what the engine measures at line-edge time.
  nextLine(prepared: Prepared, start: Start, availableWidth: number, measurer: Measurer): LineOf<Start>
  // The Canvas-versus-DOM gaps this paragraph runs into (DESIGN.md §5).
  gaps(prepared: Prepared): Gap[]
}
