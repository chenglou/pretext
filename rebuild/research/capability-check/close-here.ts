// Capability g, "close the line here": fill a line from a start and end it at a break opportunity the application chose,
// whatever the width. The function set has no such call. This script proves how near each port is, with two unmerged
// changes on this branch that reuse what the ports already have:
// - WebKit: its builders take their layout range's end as data (Builder.rangeEnd, always the last item today). fillLine
//   got an optional `endIndex` that is passed there: 3 changed lines in engines/webkit/lines.ts.
// - Gecko: the block's redo already forces a saved break position (reflowPass's `force`). fillLine got an optional source
//   offset that is turned into such a position: 3 changed lines and a 15-line helper in engines/gecko/lines.ts.
// - Blink: nothing to reuse. LineBreaker finds a line's end from a width (ShapeLine searches the offset for a position), and
//   the reshape of the line's end is the tail of that search. Closing at a given offset needs that tail as a step of its own.
//   bun rebuild/research/capability-check/close-here.ts
// Check 1: every line the engine made itself at 320px, closed again at its own end in a slot of a million px, must be the
// same line: range and width, and the next start. WebKit's next start differs in one field, the width the greedy line
// carried for the content that overflowed it, which a line closed by choice never measured and which a start at an item's
// beginning doesn't read. Check 2: every candidate line from each of those starts to each of the next 12
// opportunities, against the sum of parts breaks.ts builds from the function set (worst difference in px).
import * as gecko from '../../src/engines/gecko/index.ts'
import * as webkit from '../../src/engines/webkit/index.ts'
import { fillLine, firstLine, lineWidth, type FillResult, type LineStart, type Prepared } from '../../src/index.ts'
import { delta, fillAll, forEach, fullSlot, prepare } from './setup.ts'

const WIDE = fullSlot(1_000_000)

function closeAt(prepared: Prepared, start: LineStart, end: number): FillResult | null {
  switch (prepared.engine) {
    case 'blink': return null
    case 'webkit': {
      if (start.engine !== 'webkit') throw new Error('not webkit')
      const at = webkit.lineStartAt(prepared.state, end)
      return webkit.fillLine(prepared.state, start, WIDE, at === null ? prepared.state.items.length : at.itemIndex)
    }
    case 'gecko':
      if (start.engine !== 'gecko') throw new Error('not gecko')
      return gecko.fillLine(prepared.state, start, WIDE, end)
  }
}

forEach((engine, sample, env, standIn) => {
  if (engine === 'blink') return
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
  let same = 0
  let sameNext = 0
  let tried = 0
  let candidates = 0
  let worst = 0
  const before = standIn.asked()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const start = i === 0 ? firstLine(prepared)! : lines[i - 1]!.next!
    if (line.next !== null) {
      tried++
      const closed = closeAt(prepared, start, line.end)
      if (closed !== null && closed.kind === 'line' && closed.start === line.start && closed.end === line.end && lineWidth(prepared, closed.line) === lineWidth(prepared, line.line)) {
        same++
        if (JSON.stringify(closed.next) === JSON.stringify(line.next)) sameNext++
      }
    }
    const a = units.findIndex(unit => unit.start === line.start)
    for (let b = a + 1; a >= 0 && b < units.length && b <= a + 12; b++) {
      if (Number.isNaN(toEnd[a]!) || Number.isNaN(toEnd[b]!)) continue
      const closed = closeAt(prepared, start, units[b]!.start)
      if (closed === null || closed.kind !== 'line' || closed.end !== units[b]!.start) continue
      const sum = toEnd[a]! - toEnd[b]! - (toEnd[b - 1]! - toEnd[b]! - own[b - 1]!)
      worst = Math.max(worst, Math.abs(sum - lineWidth(prepared, closed.line)))
      candidates++
    }
  }
  const asked = delta(standIn.asked(), before)
  console.log(`${engine.padEnd(6)} ${sample.name.padEnd(6)} the engine's own lines closed again at their ends: ${same}/${tried} the same range and width, ${sameNext} the same next start | ${candidates} candidate lines closed, worst difference from the sum of parts ${worst.toFixed(4)} px | ${asked.calls} calls (${asked.distinct} new)`)
})
