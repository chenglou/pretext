// Capability d: several slots per row, and a cursor carried from one column to the next (dynamic-layout,
// editorial-engine). The function set alone.
//   bun rebuild/research/capability-check/columns.ts
// Two columns of 260px and 7 rows. In column one an obstacle takes 90px to 170px of rows 2 to 4, so those rows have two
// slots, [0, 90) and [170, 260), written as the column's width with an inset on the other side; row 5 has a 12px sliver
// beside a wide obstacle, which the engine refuses instead of breaking a word into it. Call sequence: fillLine(prepared,
// start, slot) per slot, in reading order; a line result's `next` starts the next slot, in the same row, the next row or
// the next column; a below-floats result takes no line and its `next` starts the next slot; a line without a line box takes
// no slot. The check: the lines tile the text from 0, in order, and whatever didn't fit is what the last `next` points at.
import { fillLine, firstLine, type LineSlot, type LineStart } from '../../src/index.ts'
import { delta, forEach, prepare } from './setup.ts'

const COLUMN = 260
const ROWS = 7

// `--plain-slots` gives every slot as a width of its own without insets: the application's own geometry instead of the
// engine's float model, so nothing is ever refused and a word too wide for a slot breaks as overflow-wrap says.
const PLAIN = process.argv.includes('--plain-slots')
const part = (from: number, to: number): LineSlot => PLAIN ? { width: to - from, left: 0, right: 0 } : { width: COLUMN, left: from, right: COLUMN - to }

function slotsOf(column: number, row: number): LineSlot[] {
  if (column === 0 && row >= 2 && row <= 4) return [part(0, 90), part(170, COLUMN)]
  if (column === 0 && row === 5) return [part(0, 12), part(60, COLUMN)]
  return [part(0, COLUMN)]
}

forEach((engine, sample, env, standIn) => {
  const prepared = prepare(sample.paragraph, env, false)
  const before = standIn.asked()
  let start: LineStart | null = firstLine(prepared)
  let at = 0
  let lines = 0
  let refused = 0
  let tiles = true
  const perColumn: number[] = []
  for (let column = 0; column < 2 && start !== null; column++) {
    const from = lines
    for (let row = 0; row < ROWS && start !== null; row++) {
      const slots = slotsOf(column, row)
      for (let s = 0; s < slots.length && start !== null;) {
        const result = fillLine(prepared, start, slots[s]!)
        start = result.next
        if (result.kind === 'below-floats') {
          refused++
          s++
          continue
        }
        if (result.start !== at) tiles = false
        at = result.end
        if (result.hasLineBox) {
          lines++
          s++
        }
      }
    }
    perColumn.push(lines - from)
  }
  const asked = delta(standIn.asked(), before)
  const rest = start === null ? 'all placed' : `${sample.text.length - at} units left for a third column`
  console.log(`${engine.padEnd(6)} ${sample.name.padEnd(6)} lines per column ${perColumn.join(' + ')}, ${refused} slots refused, tiles the text: ${tiles}, reached ${at}/${sample.text.length} (${rest}) | ${asked.calls} calls (${asked.distinct} new)`)
})
