// The x-lam-alef study's predictor: no supplied font facts (no-facts-predictor.ts), with the Blink port's default for the
// boundaries no ligature fact settles at 'lam-alef' (src/engines/blink/ligatures.ts `study`).
//   bun rebuild/lab/run.ts --predictor=rebuild/lab/baselines/cluster-default-lam-alef-predictor.ts ...
import { study } from '../../src/engines/blink/ligatures.ts'
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePredictor } from '../predictor-core.ts'

study.clusterDefault = 'lam-alef'

export const { predict, paint, limits } = makePredictor(() => UNKNOWN_FONT_FACTS)
