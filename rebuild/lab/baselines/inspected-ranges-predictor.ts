// The full inspected, facts-free core path, projected to source ranges for focused native comparisons.
// The lab sees a LinesPrediction, so it skips expected-observation generation and painting.
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePredictor, type PredictEnv } from '../predictor-core.ts'
import type { Case, LinesPrediction } from '../types.ts'

const inspected = makePredictor(() => UNKNOWN_FONT_FACTS)
export function predict(c: Case, env: PredictEnv): LinesPrediction | { error: string } {
  const result = inspected.predict(c, env)
  if ('error' in result) return result
  return {
    lines: result.layout.lines.filter(line => line.hasLineBox).map(line => ({ start: line.start, end: line.end })),
    measureLog: result.layout.measure.calls,
  }
}
export const paint = () => null
