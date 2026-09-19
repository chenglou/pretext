// Capability b, the cost side: what a count saves by not reading pieces, as CPU time under the stand-in Canvas (whose
// measureText is slower than a browser's, so only the ratio between the two loops means anything) and as Canvas calls.
// The three loops alternate after a warm-up, and the median of seven turns is printed.
//   bun rebuild/research/capability-check/count-cost.ts
import { linePieces, lineWidth } from '../../src/index.ts'
import { delta, fillAll, forEach, prepare } from './setup.ts'

const WIDTH = 320
const ROUNDS = 60
const TURNS = 7

const cpu = (): number => { const u = process.cpuUsage(); return (u.user + u.system) / 1000 }
const median = (values: number[]): number => values.slice().sort((a, b) => a - b)[values.length >> 1]!

forEach((engine, sample, env, standIn) => {
  const prepared = prepare(sample.paragraph, env, false)
  const fills = (): void => { fillAll(prepared, WIDTH) }
  const both = (): void => {
    const lines = fillAll(prepared, WIDTH)
    for (let i = 0; i < lines.length; i++) linePieces(prepared, lines[i]!.line)
  }
  // Fills and this branch's lineWidth per line: what a widest-line walk costs.
  const widths = (): void => {
    const lines = fillAll(prepared, WIDTH)
    for (let i = 0; i < lines.length; i++) lineWidth(prepared, lines[i]!.line)
  }
  for (let r = 0; r < ROUNDS; r++) { fills(); both(); widths() }
  let before = standIn.asked()
  fills()
  const fillCalls = delta(standIn.asked(), before).calls
  before = standIn.asked()
  both()
  const bothCalls = delta(standIn.asked(), before).calls
  const fillMs: number[] = []
  const bothMs: number[] = []
  const widthMs: number[] = []
  for (let turn = 0; turn < TURNS; turn++) {
    let t = cpu()
    for (let r = 0; r < ROUNDS; r++) fills()
    fillMs.push((cpu() - t) / ROUNDS)
    t = cpu()
    for (let r = 0; r < ROUNDS; r++) both()
    bothMs.push((cpu() - t) / ROUNDS)
    t = cpu()
    for (let r = 0; r < ROUNDS; r++) widths()
    widthMs.push((cpu() - t) / ROUNDS)
  }
  console.log(`${engine.padEnd(6)} ${sample.name.padEnd(6)} fills alone ${median(fillMs).toFixed(3)} ms, ${fillCalls} calls | fills and pieces ${median(bothMs).toFixed(3)} ms, ${bothCalls} calls | fills and widths ${median(widthMs).toFixed(3)} ms`)
})
