// x-sysui experiment: predictor.ts, but a font list that names the platform UI font anywhere declares the optical size axis,
// not only a list whose primary family is that font. Tests whether Blink's failures on `"Geeza Pro", system-ui` come from
// deciding the measuring size by the primary family alone.
import { fontFactsFor } from '../font-facts.ts'
import { makePredictor } from '../predictor-core.ts'

const SYSTEM = /(^|,)\s*(system-ui|-apple-system|BlinkMacSystemFont)\s*(,|$)/

export const { predict, paint, limits } = makePredictor((font, engine, fixtures) => {
  const facts = fontFactsFor(font, engine, fixtures)
  return SYSTEM.test(font.family) && facts.opticalSizeAxis === false ? { ...facts, opticalSizeAxis: true } : facts
})
