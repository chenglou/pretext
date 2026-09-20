// Page contexts on the plain path: plain-predictor.ts with one list of Canvas contexts for every case a document lays
// out, which is what an application runs: prepare without inspection, handed the page's list (page-contexts-predictor.ts).
// The plain path asks Canvas less than the inspected one, so its document leaves a canvas another history; its line ranges
// must equal a usual run's (`bun rebuild/tests/compare-sets.ts <its run> <a usual run> --prediction=line-ranges`).
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePlainPredictor } from '../predictor-core.ts'

export const { predict, paint } = makePlainPredictor(() => UNKNOWN_FONT_FACTS, true)
