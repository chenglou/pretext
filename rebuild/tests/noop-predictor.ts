// The predictor for derivation passes (rebuild/tests/derive.ts): observation only. No library code runs in the page
// while family widths are derived, so no derived width can depend on a prediction.
import type { BrowserKind, Case, LayoutPrediction } from '../lab/types.ts'

export function predict(_c: Case, _env: { browser: BrowserKind; build: string }): LayoutPrediction | { error: string } {
  return { error: 'derivation observation: no prediction' }
}

export function paint(_c: Case, _prediction: LayoutPrediction, _host: HTMLElement): HTMLElement[] | null {
  return null
}
