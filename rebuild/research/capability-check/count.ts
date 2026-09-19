// Capability b: a line count at a new width without preparing again, and without building fragments.
//   bun rebuild/research/capability-check/count.ts
// Call sequence: prepare(paragraph, env, false) once; then per width firstLine, and fillLine until next is null, counting
// results with hasLineBox. linePieces is never called. Per step it prints the Canvas questions the stand-in was asked:
// calls, and how many of them were a (context, string) pair never asked before. A fresh prepare at each width checks the
// ranges.
import { delta, fillAll, forEach, prepare, ranges } from './setup.ts'

const WIDTHS = [320, 240, 410, 320]

forEach((engine, sample, env, standIn) => {
  standIn.reset()
  const prepared = prepare(sample.paragraph, env, false)
  const afterPrepare = standIn.asked()
  const cells: string[] = [`prepare ${afterPrepare.calls} calls (${afterPrepare.distinct} new), ${afterPrepare.contexts} contexts`]
  let before = afterPrepare
  const counted: { width: number; lines: number; ranges: string }[] = []
  for (let w = 0; w < WIDTHS.length; w++) {
    const lines = fillAll(prepared, WIDTHS[w]!)
    const now = standIn.asked()
    const d = delta(now, before)
    before = now
    let count = 0
    for (let i = 0; i < lines.length; i++) if (lines[i]!.hasLineBox) count++
    counted.push({ width: WIDTHS[w]!, lines: count, ranges: ranges(lines) })
    cells.push(`${WIDTHS[w]}px: ${count} lines, ${d.calls} calls (${d.distinct} new)`)
  }
  // The same widths on paragraphs prepared for each alone.
  let same = true
  for (let w = 0; w < WIDTHS.length; w++) {
    const alone = fillAll(prepare(sample.paragraph, env, false), WIDTHS[w]!)
    if (ranges(alone) !== counted[w]!.ranges) same = false
  }
  console.log(`${engine.padEnd(6)} ${sample.name.padEnd(6)} ${cells.join(' | ')} | equals fresh prepares: ${same}`)
})
