// Page measurer: no-facts-predictor.ts with one measurer for every case a document lays out, where the usual predictors
// make one per case (predictor-core.ts makePredictor `pageMeasurer`; src/measure/font-checks.ts Measurer).
//   bun rebuild/tests/browser-sets.ts --browser=<browser> --both-orders --predictor=rebuild/lab/baselines/page-measurer-predictor.ts --out=<dir>
// A document's cases share their Canvas contexts and the font checks' answers, as an application's paragraphs do when it
// makes one measurer per page. Chrome keeps the first shaping of a word per canvas (specs/blink-canvas.md §1.7), so with
// shared contexts what a canvas shaped before is the document's history and not the paragraph's. The rows' layouts must
// equal no-facts-predictor.ts's in every order (`bun rebuild/tests/compare-sets.ts <its run> <a usual run>
// --prediction=without-measure`: `measure` counts fewer contexts and questions). Offline a replay can't run it: a case's
// record holds what the case asked when nothing outlived a paragraph (research/PROFILING-START.md, "Records are per case").
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePredictor } from '../predictor-core.ts'

export const { predict, paint, limits } = makePredictor(() => UNKNOWN_FONT_FACTS, [], true)
