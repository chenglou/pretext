// The x-lam-alef study's predictor with the lab's font facts (predictor.ts), and the Blink port's default for the
// boundaries no ligature fact settles at 'lam-alef' (src/engines/blink/ligatures.ts `study`): what the default does where
// facts are supplied and say nothing of the font that draws (the engine's fallback, a list that isn't complete).
//   bun rebuild/lab/run.ts --predictor=rebuild/lab/baselines/cluster-default-lam-alef-facts-predictor.ts ...
import { study } from '../../src/engines/blink/ligatures.ts'
import { fontFactsFor } from '../font-facts.ts'
import { makePredictor } from '../predictor-core.ts'

study.clusterDefault = 'lam-alef'

export const { predict, paint, limits } = makePredictor(fontFactsFor)
