// A predictor of the x-lam-alef study: no supplied font facts, as lab/baselines/no-facts-predictor.ts, with the Blink
// port's default for the boundaries no ligature fact settles at 'canvas-lam-alef'
// (src/engines/blink/ligatures.ts `study`). It sits outside the lab because it reaches into an engine, which no file of
// the lab may (tests/independence.test.ts).
//   bun rebuild/lab/run.ts --predictor=rebuild/tools/cluster-default/canvas-lam-alef-predictor.ts ...
import { study } from '../../src/engines/blink/ligatures.ts'
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePredictor } from '../../lab/predictor-core.ts'

study.clusterDefault = 'canvas-lam-alef'

export const { predict, paint, limits } = makePredictor(() => UNKNOWN_FONT_FACTS)
