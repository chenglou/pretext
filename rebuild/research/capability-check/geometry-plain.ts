// Capability h, second half: positions of a line's pieces in CSS px, for an application that paints on Canvas or SVG
// (justification-comparison paints words with fillText at its own x). The function set gives geometry through inspectLine,
// on an inspected paragraph only, which also computes every gap (DESIGN.md §2.8 has what that costs in Canvas questions).
// This asks each engine's geometry code for a plain paragraph's lines, around inspectLine, to see whether geometry alone is
// separable from the gaps today.
//   bun rebuild/research/capability-check/geometry-plain.ts
import { geometryOf } from '../../src/engines/blink/inspect.ts'
import { inspectLine as geckoInspectLine } from '../../src/engines/gecko/inspect.ts'
import { lineGeometry } from '../../src/engines/webkit/output.ts'
import { inspectLine } from '../../src/index.ts'
import { delta, fillAll, forEach, prepare } from './setup.ts'

forEach((engine, sample, env, standIn) => {
  const plain = prepare(sample.paragraph, env, false)
  const lines = fillAll(plain, 320)
  const before = standIn.asked()
  let outcome: string
  try {
    let pieces = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.line
      switch (plain.engine) {
        case 'blink': if (line.engine === 'blink') pieces += geometryOf({ p: plain.state, gaps: null }, line.info, line.start).items.length; break
        case 'webkit': if (line.engine === 'webkit') pieces += lineGeometry(plain.state, line).boxes.length; break
        case 'gecko': if (line.engine === 'gecko') pieces += geckoInspectLine(plain.state, line).geometry!.frames.length; break
      }
    }
    outcome = `${pieces} positioned pieces, ${delta(standIn.asked(), before).calls} calls`
  } catch (error) {
    outcome = `throws: ${error instanceof Error ? error.message : String(error)}`
  }
  // The supported way: an inspected paragraph.
  const inspected = prepare(sample.paragraph, env, true)
  const inspectedLines = fillAll(inspected, 320)
  const mark = standIn.asked()
  for (let i = 0; i < inspectedLines.length; i++) inspectLine(inspected, inspectedLines[i]!.line)
  console.log(`${engine.padEnd(6)} ${sample.name.padEnd(6)} geometry code on a plain paragraph: ${outcome} | inspectLine on an inspected one: ${delta(standIn.asked(), mark).calls} calls`)
})
