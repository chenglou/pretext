// The plain predictor with Blink's checked run on (predictor-core.ts makePlainPredictor): every candidate a plain line
// finds from the positions at the edges of words is held against the search over every offset, in the browser's own
// Canvas answers, and a difference throws, so the case's row holds the error in place of its line ranges.
//   bun rebuild/tests/browser-sets.ts --browser=chrome --config=no-facts --predictor=rebuild/lab/baselines/plain-checked-predictor.ts --out=<dir>
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePlainPredictor } from '../predictor-core.ts'

export const { predict, paint } = makePlainPredictor(() => UNKNOWN_FONT_FACTS, false, true)
