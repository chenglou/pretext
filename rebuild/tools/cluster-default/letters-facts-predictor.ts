// A predictor of the x-lam-alef study: the lab's font facts, as lab/predictor.ts, with the Blink port's default for the
// boundaries no ligature fact settles at 'letters' (src/engines/blink/ligatures.ts `study`).
// The base of lam-alef-facts-predictor.ts, whatever the switch's start value is.
//   bun rebuild/lab/run.ts --predictor=rebuild/tools/cluster-default/letters-facts-predictor.ts ...
import { study } from '../../src/engines/blink/ligatures.ts'
import { fontFactsFor } from '../../lab/font-facts.ts'
import { makePredictor } from '../../lab/predictor-core.ts'

study.clusterDefault = 'letters'

export const { predict, paint, limits } = makePredictor(fontFactsFor)
