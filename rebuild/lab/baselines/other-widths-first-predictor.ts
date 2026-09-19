// Other widths first: no-facts-predictor.ts, which fills every prepared paragraph at half and at one and a half times the
// case's width before it fills it at the case's own (predictor-core.ts layoutParagraph `otherWidthsFirst`).
//   bun rebuild/lab/run.ts --predictor=rebuild/lab/baselines/other-widths-first-predictor.ts ...
// One prepared paragraph serves any width (src/model.ts LineSlot), and Chrome keeps the first shaping of a word per canvas
// (specs/blink-canvas.md §1.7), so what a paragraph measured for other widths could answer for this one. The rows' layouts
// must equal no-facts-predictor.ts's (`bun rebuild/lab/compare-rows.ts <its rows> <the other rows> --prediction=without-measure`:
// `measure` counts the other widths' questions too). Offline a replay can't run it: another width asks questions no record holds.
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePredictor } from '../predictor-core.ts'

export const { predict, paint, limits } = makePredictor(() => UNKNOWN_FONT_FACTS, [0.5, 1.5])
