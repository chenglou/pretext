// A predictor of the x-lam-alef study: the lab's font facts, as lab/predictor.ts, with the Blink port's default for the
// boundaries no ligature fact settles at 'lam-alef' (src/engines/blink/ligatures.ts `study`).
// What the default does where facts are supplied and say nothing of the font that draws: the engine's fallback, a list
// that isn't complete.
//   bun rebuild/lab/run.ts --predictor=rebuild/tools/cluster-default/lam-alef-facts-predictor.ts ...
import { study } from '../../src/engines/blink/ligatures.ts'
import { fontFactsFor } from '../../lab/font-facts.ts'
import { makePredictor } from '../../lab/predictor-core.ts'

study.clusterDefault = 'lam-alef'

export const { predict, paint, limits } = makePredictor(fontFactsFor)
