// Plain predictor: the line ranges of a paragraph prepared plain, with no supplied font facts.
//   bun rebuild/lab/run.ts --predictor=rebuild/lab/baselines/plain-predictor.ts ...
// It runs the path an application runs: prepare without inspection, fill every line, read each line's pieces. Nothing is
// inspected, so the library asks Canvas only what deciding and painting the lines takes. A row of it holds line ranges alone
// (types.ts LinesPrediction); `bun rebuild/lab/compare-rows.ts <its rows> <no-facts-predictor.ts rows>
// --prediction=line-ranges` holds them against the inspected path's lines, and the native observations against each other,
// since a page that was asked fewer questions has another history.
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePlainPredictor } from '../predictor-core.ts'

export const { predict, paint } = makePlainPredictor(() => UNKNOWN_FONT_FACTS)
