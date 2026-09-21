// Original maintained corpus preparation contract: exact case text, default locale, prepareWithSegments/layout.
// Each raw/normalized survey case is an ordinary real paragraph; this adapter never overrides its native source.
import { predictWithLocale } from './main-predictor.ts'
import type { BrowserKind, Case } from '../types.ts'
export function predict(c: Case, env: { browser: BrowserKind; build: string }) {
  return predictWithLocale(c, env, undefined, true)
}
export function paint(): null { return null }
