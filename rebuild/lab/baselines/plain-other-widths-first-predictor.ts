// Plain, other widths first: plain-predictor.ts, which fills every prepared paragraph at half and at one and a half times
// the case's width before it fills it at the case's own (predictor-core.ts plainLines `otherWidthsFirst`).
//   bun rebuild/lab/run.ts --predictor=rebuild/lab/baselines/plain-other-widths-first-predictor.ts ...
// A plain Blink paragraph keeps by offset what its lines measured (src/engines/blink/types.ts BlinkGroup), so at the case's
// width it reads back what the other widths asked of Canvas, and asks the rest of a canvas that has shaped their strings.
// Its line ranges must equal the inspected path's (`bun rebuild/lab/compare-rows.ts <its rows> <no-facts-predictor.ts rows>
// --prediction=line-ranges`). other-widths-first-predictor.ts is the inspected path's, where only linePieces reads back.
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePlainPredictor } from '../predictor-core.ts'

export const { predict, paint } = makePlainPredictor(() => UNKNOWN_FONT_FACTS, [0.5, 1.5])
