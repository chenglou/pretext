// Capability g, "close the line here" without any engine change: a line from A to B is the greedy line in any slot at
// least as wide as that line and narrower than the line to the next opportunity. So an application that knows candidate
// widths (breaks.ts sums them from the function set and this branch's `lineWidth`) can ask fillLine for the line it chose
// by handing it a slot halfway between the two sums, and gets a real decided line whose pieces it can paint. Halfway
// forgives an error in the sums of up to half the next unit's width, which is what a line-end reshape in a real font would
// need; the stand-in has no such error to show. This checks how often the fill lands on B: from every line start the
// engine reached at 320px to each of the next 12 break opportunities.
//   bun rebuild/research/capability-check/close-by-width.ts
import { fillLine, firstLine, lineWidth } from '../../src/index.ts'
import { delta, fillAll, forEach, fullSlot, prepare } from './setup.ts'

const WIDE = fullSlot(1_000_000)

forEach((engine, sample, env, standIn) => {
  const prepared = prepare({ ...sample.paragraph, overflowWrap: 'normal' }, env, false)
  const units = fillAll(prepared, 0)
  const toEnd: number[] = []
  const own: number[] = []
  for (let u = 0; u < units.length; u++) {
    const rest = fillLine(prepared, u === 0 ? firstLine(prepared)! : units[u - 1]!.next!, WIDE)
    toEnd.push(rest.kind === 'line' && rest.next === null ? lineWidth(prepared, rest.line) : Number.NaN)
    own.push(lineWidth(prepared, units[u]!.line))
  }
  const lines = fillAll(prepared, 320)
  let tried = 0
  let landed = 0
  let sameWidth = 0
  const misses: string[] = []
  const before = standIn.asked()
  for (let i = 0; i < lines.length; i++) {
    const start = i === 0 ? firstLine(prepared)! : lines[i - 1]!.next!
    const a = units.findIndex(unit => unit.start === lines[i]!.start)
    for (let b = a + 1; a >= 0 && b < units.length && b <= a + 12; b++) {
      if (Number.isNaN(toEnd[a]!) || Number.isNaN(toEnd[b]!)) continue
      // The line to opportunity k: what lies between the two starts, less the last unit's trailing space.
      const to = (k: number): number => toEnd[a]! - toEnd[k]! - (toEnd[k - 1]! - toEnd[k]! - own[k - 1]!)
      const sum = to(b)
      const longer = b + 1 < units.length && !Number.isNaN(toEnd[b + 1]!) ? to(b + 1) : toEnd[a]!
      const result = fillLine(prepared, start, fullSlot((sum + longer) / 2))
      tried++
      if (result.kind === 'line' && result.end === units[b]!.start) {
        landed++
        if (Math.abs(lineWidth(prepared, result.line) - sum) < 1 / 64) sameWidth++
      } else if (misses.length < 2 && result.kind === 'line') misses.push(`${units[a]!.start}-${units[b]!.start} gave ${result.start}-${result.end}`)
    }
  }
  const asked = delta(standIn.asked(), before)
  console.log(`${engine.padEnd(6)} ${sample.name.padEnd(6)} ${landed}/${tried} candidate lines closed at the chosen offset, ${sameWidth} within 1/64 px of the sum | ${asked.calls} calls${misses.length > 0 ? ` | misses: ${misses.join('; ')}` : ''}`)
})
