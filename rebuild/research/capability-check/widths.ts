// Capability c: widths in CSS px: each line's width, the widest line, a natural (unwrapped) width, and shrink-wrap.
//   bun rebuild/research/capability-check/widths.ts
// The function set hands out no width: linePieces has `overflows` alone, and a width lives in the engine's own unit on the
// decided line (Blink LineInfo.width in LayoutUnits of zoomed px, WebKit Line.contentLogicalWidth in float32 px, Gecko only
// after placement, in app units). This script reads it through `lineWidth`, a tiny export on this branch (src/index.ts), and
// holds it against inspectLine's geometry on an inspected paragraph, converted the way DESIGN.md §2.6 says.
// Then: the widest line at a width; the natural width as the widest line in a slot of a million px; and shrink-wrap, a fill
// at the widest line's width rounded up to the engine's unit, which must give the same lines.
import { fillLine, firstLine, inspectLine, lineWidth, type LineInspection, type LineStart, type Prepared } from '../../src/index.ts'
import { delta, fillAll, forEach, fullSlot, prepare, ranges, type EngineName } from './setup.ts'

const WIDTH = 320
const UNBOUNDED = 1_000_000

// A line's alignment width in CSS px from the inspected geometry, per engine (DESIGN.md §2.6).
function geometryWidth(engine: EngineName, inspection: LineInspection): number {
  const g = inspection.geometry as unknown as Record<string, number>
  switch (engine) {
    case 'blink': return (g['width']! - g['hangWidth']!) / 64 / g['layoutZoom']!
    case 'webkit': return g['contentWidth']! - g['hangingWidth']!
    case 'gecko': return (g['width']! - g['hang']!) / 60
  }
}

// The smallest slot width, in the engine's unit, that is at least `px`: the width a shrink-wrapped box would get.
function roundUp(engine: EngineName, px: number, zoom: number): number {
  switch (engine) {
    case 'blink': return Math.ceil(px * 64 * zoom) / 64 / zoom
    case 'webkit': return Math.ceil(px * 64) / 64
    case 'gecko': return Math.ceil(px * 60) / 60
  }
}

function widths(prepared: Prepared, width: number): { list: number[]; ranges: string } {
  const lines = fillAll(prepared, width)
  const list: number[] = []
  for (let i = 0; i < lines.length; i++) if (lines[i]!.hasLineBox) list.push(lineWidth(prepared, lines[i]!.line))
  return { list, ranges: ranges(lines) }
}

forEach((engine, sample, env, standIn) => {
  const plain = prepare(sample.paragraph, env, false)
  fillAll(plain, WIDTH)
  let before = standIn.asked()
  const at = widths(plain, WIDTH)
  const widthCalls = delta(standIn.asked(), before).calls
  // The same numbers from an inspected paragraph's geometry.
  const inspected = prepare(sample.paragraph, env, true)
  const fromGeometry: number[] = []
  const slot = fullSlot(WIDTH)
  for (let start: LineStart | null = firstLine(inspected); start !== null;) {
    const result = fillLine(inspected, start, slot)
    if (result.kind !== 'line') throw new Error('refused')
    if (result.hasLineBox) fromGeometry.push(geometryWidth(engine, inspectLine(inspected, result.line)))
    start = result.next
  }
  const agrees = at.list.length === fromGeometry.length && at.list.every((w, i) => w === fromGeometry[i])
  const widest = Math.max(...at.list)
  before = standIn.asked()
  const natural = Math.max(...widths(plain, UNBOUNDED).list)
  const naturalCalls = delta(standIn.asked(), before).calls
  const wrapAt = roundUp(engine, widest, env.devicePixelRatio)
  const wrapped = widths(plain, wrapAt)
  console.log(`${engine.padEnd(6)} ${sample.name.padEnd(6)} at ${WIDTH}px: ${at.list.map(w => w.toFixed(3)).join(' ')}`)
  console.log(`${''.padEnd(13)} equals the inspected geometry: ${agrees} | widest ${widest.toFixed(4)} | natural ${natural.toFixed(3)} (${naturalCalls} calls) | fills and widths again at ${WIDTH}px: ${widthCalls} calls | same lines at ${wrapAt}px: ${wrapped.ranges === at.ranges}`)
})
