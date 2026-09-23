// The audit's lab predictor: the plain count/range path (lab/baselines/plain-predictor.ts) with no supplied font facts, and
// a count of what each case asks Canvas, kept in the row beside the line ranges as `audit`: measureText calls, the
// characters they send, the contexts made, and the prediction's own time. The counter wraps the page's Canvas prototypes
// once and passes every string through untouched, so Canvas sees the library's own string objects (Blink shapes one-byte
// and two-byte strings differently; research/BLINK-STRING-STORAGE.md). Knockout runs (tools/audit/knockouts.md) import this
// module and set `globalThis.__auditKO` before a case is predicted.
//
//   bun rebuild/lab/run.ts --predictor=rebuild/tools/audit/count-predictor.ts ...
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePlainPredictor } from '../../lab/predictor-core.ts'
import type { Case, LinesPrediction } from '../../lab/types.ts'

type Counter = { calls: number; chars: number; contexts: number }
const counter: Counter = { calls: 0, chars: 0, contexts: 0 }

function wrapMeasure(proto: { measureText?: (this: unknown, text: string) => unknown } | undefined): void {
  if (proto === undefined || typeof proto.measureText !== 'function') return
  const measureText = proto.measureText
  proto.measureText = function (text: string) {
    counter.calls++
    counter.chars += text.length
    return measureText.call(this, text)
  }
}

function wrapContexts(proto: { getContext?: (this: unknown, ...rest: unknown[]) => unknown } | undefined): void {
  if (proto === undefined || typeof proto.getContext !== 'function') return
  const getContext = proto.getContext
  proto.getContext = function (...rest: unknown[]) {
    const context = getContext.apply(this, rest)
    if (context !== null) counter.contexts++
    return context
  }
}

const g = globalThis as unknown as Record<string, { prototype?: object } | undefined>
wrapMeasure(g['OffscreenCanvasRenderingContext2D']?.prototype as never)
wrapMeasure(g['CanvasRenderingContext2D']?.prototype as never)
wrapContexts(g['OffscreenCanvas']?.prototype as never)
wrapContexts(g['HTMLCanvasElement']?.prototype as never)

const plain = makePlainPredictor(() => UNKNOWN_FONT_FACTS, [], false, 'range')

export type AuditCounts = Counter & { ms: number; ko: string }

export const paint = plain.paint
export function predict(c: Case, env: Parameters<typeof plain.predict>[1]): (LinesPrediction & { audit: AuditCounts }) | { error: string } {
  const before = { ...counter }
  const start = performance.now()
  const result = plain.predict(c, env)
  const ms = performance.now() - start
  if ('error' in result) return result
  const ko = (globalThis as { __auditKO?: Record<string, unknown> }).__auditKO
  return {
    ...result,
    audit: { calls: counter.calls - before.calls, chars: counter.chars - before.chars, contexts: counter.contexts - before.contexts, ms, ko: ko === undefined ? '' : Object.keys(ko).join('+') },
  }
}
