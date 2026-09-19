// Shrink-wrap over many widths (bubbles, markdown-chat): fill at a width, take the widest line's width (this branch's
// `lineWidth`), round it up to the engine's unit, fill again there, and compare the lines. DESIGN.md §2.6 says they are
// the same whenever no line overflows. Widths from 120px to 500px in steps of 7.
//   bun rebuild/research/capability-check/shrink-wrap.ts
import { lineWidth, linePieces, type Prepared } from '../../src/index.ts'
import { fillAll, forEach, prepare, ranges, type EngineName } from './setup.ts'

function roundUp(engine: EngineName, px: number, zoom: number): number {
  switch (engine) {
    case 'blink': return Math.ceil(px * 64 * zoom) / 64 / zoom
    case 'webkit': return Math.ceil(px * 64) / 64
    case 'gecko': return Math.ceil(px * 60) / 60
  }
}

function widest(prepared: Prepared, width: number): { px: number; ranges: string; overflows: boolean } {
  const lines = fillAll(prepared, width)
  let px = 0
  let overflows = false
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.hasLineBox) continue
    px = Math.max(px, lineWidth(prepared, lines[i]!.line))
    if (linePieces(prepared, lines[i]!.line).overflows) overflows = true
  }
  return { px, ranges: ranges(lines), overflows }
}

forEach((engine, sample, env) => {
  const prepared = prepare(sample.paragraph, env, false)
  let tried = 0
  let moved = 0
  let first = ''
  for (let width = 120; width <= 500; width += 7) {
    const at = widest(prepared, width)
    if (at.overflows) continue
    tried++
    const wrapAt = roundUp(engine, at.px, env.devicePixelRatio)
    if (widest(prepared, wrapAt).ranges !== at.ranges) {
      moved++
      if (first === '') first = ` (first at ${width}px, shrunk to ${wrapAt}px)`
    }
  }
  console.log(`${engine.padEnd(6)} ${sample.name.padEnd(6)} ${tried} widths without an overflowing line: the shrunk width moved lines at ${moved}${first}`)
})
