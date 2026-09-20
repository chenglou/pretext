// Plain, many widths in two orders, each against a fresh paragraph, in the page: an attacker's check of what a plain Blink
// paragraph keeps by offset (src/engines/blink/types.ts BlinkGroup; research/PROFILING-START.md, item 2).
//   bun rebuild/tests/browser-sets.ts --browser=chrome --predictor=rebuild/lab/baselines/plain-width-orders-predictor.ts --sets=... --out=...
// plain-other-widths-first-predictor.ts fills two other widths first and hands back the line ranges at the case's width,
// which compare-sets.ts compares with the usual run's. That says nothing of the other widths, of another order, of a
// width met twice, or of the pieces. Here one plain paragraph is filled at a quarter, a half, three quarters, one and a
// half and three times the case's width and then at the case's own, narrowest first, and at each of them once more; a
// second one widest first. At every width its fill results and its pieces must equal a paragraph's that was prepared in
// the same page for that width alone, which has its own canvases and has read nothing back. A difference throws, so the
// row holds the error and no lines. The lines handed back are the first paragraph's at the case's width, after every
// other width, for compare-sets.ts --prediction=line-ranges against the usual run.
// The paragraph and the environment come from the usual predictor's layout of the case (no-facts-predictor.ts), which
// makes its own canvases too.
import { fillLine, firstLine, linePieces, prepare, type Prepared } from '../../src/index.ts'
import type { Case, LinesPrediction, PredictionLine } from '../types.ts'
import { predict as usual } from './no-facts-predictor.ts'

const FACTORS = [0.25, 0.5, 0.75, 1.5, 3, 1]

type Laid = { lines: PredictionLine[]; read: string }

function layout(prepared: Prepared, width: number, insets: ReadonlyArray<{ left: number; right: number }>): Laid {
  const lines: PredictionLine[] = []
  const read: unknown[] = []
  let row = 0
  for (let start = firstLine(prepared); start !== null;) {
    const slot = row < insets.length ? insets[row]! : { left: 0, right: 0 }
    const filled = fillLine(prepared, start, { width, left: slot.left, right: slot.right })
    switch (filled.kind) {
      case 'below-floats':
        read.push({ kind: filled.kind, next: filled.next })
        row++
        break
      case 'line':
        read.push({ kind: filled.kind, start: filled.start, end: filled.end, next: filled.next, hasLineBox: filled.hasLineBox, pieces: linePieces(prepared, filled.line) })
        if (filled.hasLineBox) {
          lines.push({ start: filled.start, end: filled.end })
          row++
        }
        break
    }
    start = filled.next
  }
  return { lines, read: JSON.stringify(read) }
}

export function predict(c: Case, env: Parameters<typeof usual>[1]): LinesPrediction | { error: string } {
  const inspected = usual(c, env)
  if (!('layout' in inspected)) return inspected as { error: string }
  const paragraph = inspected.paragraph
  const insets = c.inline?.lineSlots ?? []
  const widths: number[] = []
  for (let i = 0; i < FACTORS.length; i++) widths.push(c.paragraph.width * FACTORS[i]!)
  const alone: string[] = []
  for (let i = 0; i < widths.length; i++) alone.push(layout(prepare(paragraph, inspected.layout.env, false), widths[i]!, insets).read)
  const narrowestFirst = prepare(paragraph, inspected.layout.env, false)
  let lines: PredictionLine[] = []
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < widths.length; i++) {
      const laid = layout(narrowestFirst, widths[i]!, insets)
      if (laid.read !== alone[i]) throw new Error(`positions-attack: narrowest first${round === 1 ? ', a width met before' : ''}, at ${widths[i]!}px the kept paragraph differs from a fresh one`)
      if (round === 0 && i === widths.length - 1) lines = laid.lines
    }
  }
  const widestFirst = prepare(paragraph, inspected.layout.env, false)
  const order = [4, 3, 5, 2, 1, 0]
  for (let n = 0; n < order.length; n++) {
    const i = order[n]!
    if (layout(widestFirst, widths[i]!, insets).read !== alone[i]) throw new Error(`positions-attack: widest first, at ${widths[i]!}px the kept paragraph differs from a fresh one`)
  }
  return { lines }
}

export const paint = (): null => null
