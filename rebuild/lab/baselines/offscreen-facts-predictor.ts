// x-sysui experiment: predictor.ts with Gecko measuring on an OffscreenCanvas only, as the correctness line does.
import { fontFactsFor } from '../font-facts.ts'
import { makePredictor } from '../predictor-core.ts'

export const { predict, paint, limits } = makePredictor(fontFactsFor, { geckoCanvasElement: false })
