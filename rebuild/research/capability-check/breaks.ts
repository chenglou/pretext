// Capability g, second half: break opportunities and candidate line widths for an application's own line breaker
// (justification-comparison runs Knuth-Plass over main's `segments` and `widths`).
//   bun rebuild/research/capability-check/breaks.ts
// Part 1, the function set alone: with overflow-wrap: normal, a fill in a slot of width 0 places exactly the content up to
// the first break opportunity, so walking the paragraph at width 0 lists every opportunity the engine's own greedy walk
// would see, one fill each. Blink's list is held against its break iterator run once from offset 0 (Blink restarts ICU at
// every line start, so the two could differ) and Gecko's against its prepared break flags.
// Part 2, with this branch's `lineWidth`: each unit's width is its width-0 line's width. A fill from a unit's start (the
// walk's own `next`) in a slot of a million px gives the width from there to the paragraph's end (or a forced break); the
// difference of two such widths is the width of what lies between, trailing space included. From those an application can
// sum candidate lines as main's demo sums segments. Part 3 holds that sum against the engine for the lines the engine
// really made at 320px: the function set can't close a line at a chosen offset, so the greedy lines are the only
// candidates it can check (close-here.ts checks the others through two unmerged changes).
import { BREAK_NORMAL } from '../../src/engines/gecko/linebreak.ts'
import { LineBreakIterator } from '../../src/engines/blink/breaks.ts'
import { fillLine, firstLine, lineWidth, type Prepared } from '../../src/index.ts'
import { delta, fillAll, forEach, fullSlot, prepare } from './setup.ts'

const UNBOUNDED = 1_000_000

// Source offsets the engine's prepared data calls break opportunities, where it keeps such a list.
function tableOpportunities(prepared: Prepared): number[] | null {
  switch (prepared.engine) {
    case 'blink': {
      const p = prepared.state
      const iterator = new LineBreakIterator(p.text, p.is8Bit, p.settings[0]!, p.env.uiLanguage, p.env.dictionaryBreaks)
      iterator.locale = p.styles[0]!.locale
      const out: number[] = []
      for (let t = iterator.nextBreakOpportunity(1); t < p.text.length; t = iterator.nextBreakOpportunity(t + 1)) out.push(p.sourceOffsets[t]!)
      return out
    }
    case 'webkit': return null
    case 'gecko': {
      const p = prepared.state
      const out: number[] = []
      for (let t = 1; t < p.breakFlags.length; t++) if (p.breakFlags[t] === BREAK_NORMAL) out.push(p.tSource[t]!)
      return out
    }
  }
}

const perSample = new Map<string, Map<string, string>>()

forEach((engine, sample, env, standIn) => {
  const prepared = prepare({ ...sample.paragraph, overflowWrap: 'normal' }, env, false)
  let before = standIn.asked()
  const units = fillAll(prepared, 0)
  const unitCalls = delta(standIn.asked(), before)
  const opportunities = units.slice(1).map(unit => unit.start)
  if (!perSample.has(sample.name)) perSample.set(sample.name, new Map())
  perSample.get(sample.name)!.set(engine, opportunities.join(' '))
  const table = tableOpportunities(prepared)
  // Flat text only: the iterator from 0 and the break flags know nothing of the opportunities elements make.
  const tableSays = table === null ? 'no such table' : sample.name === 'spans' ? 'not compared (elements)' : table.join(' ') === opportunities.join(' ') ? 'equal' : `differs (${table.length} against ${opportunities.length})`

  // Part 2: widths from each unit's start to the end, and each unit's own width.
  before = standIn.asked()
  const toEnd: number[] = []
  const own: number[] = []
  for (let u = 0; u < units.length; u++) {
    const start = u === 0 ? firstLine(prepared)! : units[u - 1]!.next!
    const rest = fillLine(prepared, start, fullSlot(UNBOUNDED))
    if (rest.kind !== 'line') throw new Error('refused')
    toEnd.push(rest.next === null ? lineWidth(prepared, rest.line) : Number.NaN)
    own.push(lineWidth(prepared, units[u]!.line))
  }
  const widthCalls = delta(standIn.asked(), before)

  // Part 3: the engine's own lines at 320px against the sums.
  const lines = fillAll(prepared, 320)
  let worst = 0
  let compared = 0
  for (let i = 0; i < lines.length; i++) {
    const a = units.findIndex(unit => unit.start === lines[i]!.start)
    const b = units.findIndex(unit => unit.start === lines[i]!.end)
    if (a < 0 || b < 1 || Number.isNaN(toEnd[a]!) || Number.isNaN(toEnd[b]!)) continue
    // What lies between the two starts, less the last unit's trailing space: that unit with its space, less the unit alone.
    const trailingSpace = toEnd[b - 1]! - toEnd[b]! - own[b - 1]!
    const sum = toEnd[a]! - toEnd[b]! - trailingSpace
    worst = Math.max(worst, Math.abs(sum - lineWidth(prepared, lines[i]!.line)))
    compared++
  }
  console.log(`${engine.padEnd(6)} ${sample.name.padEnd(6)} ${units.length} units from ${units.length} fills at width 0 (${unitCalls.calls} calls, ${unitCalls.distinct} new); the engine's own table: ${tableSays}`)
  console.log(`${''.padEnd(13)} unit and to-the-end widths: ${widthCalls.calls} calls (${widthCalls.distinct} new) | summed candidate against the engine's line, ${compared} lines at 320px: worst difference ${worst.toFixed(4)} px`)
})

for (const [name, engines] of perSample) {
  const lists = [...engines.values()]
  console.log(`${name.padEnd(6)} opportunities equal in the three engines: ${lists.every(list => list === lists[0])}`)
}
