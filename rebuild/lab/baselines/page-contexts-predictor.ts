// Page contexts: no-facts-predictor.ts with one list of Canvas contexts for every case a document lays out, where the
// usual predictors hand prepare none, so every case makes its own (predictor-core.ts makePredictor `pageContexts`;
// src/index.ts prepare).
//   bun rebuild/tests/browser-sets.ts --browser=<browser> --both-orders --predictor=rebuild/lab/baselines/page-contexts-predictor.ts --out=<dir>
// A document's cases share their Canvas contexts, as an application's paragraphs do when it keeps one list per page, and
// every case asks its font checks of Canvas again, on the kept contexts. Chrome keeps the first shaping of a word per
// canvas (specs/blink-canvas.md §1.7), so with shared contexts what a canvas shaped before is the document's history and
// not the paragraph's. The rows' layouts must equal no-facts-predictor.ts's in every order (`bun
// rebuild/tests/compare-sets.ts <its run> <a usual run> --prediction=without-measure`: `measure` counts fewer contexts).
// Offline a replay can't run it: a case's record holds what the case asked when nothing outlived a paragraph
// (research/PROFILING-START.md, "Records are per case").
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePredictor } from '../predictor-core.ts'

export const { predict, paint, limits } = makePredictor(() => UNKNOWN_FONT_FACTS, [], true)
