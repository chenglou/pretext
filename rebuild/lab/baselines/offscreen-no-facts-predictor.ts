// x-sysui experiment: no-facts-predictor.ts with Gecko measuring on an OffscreenCanvas only, as the correctness line does.
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePredictor } from '../predictor-core.ts'

export const { predict, paint, limits } = makePredictor(() => UNKNOWN_FONT_FACTS, { geckoCanvasElement: false })
