// Test support: every line of a prepared paragraph through one engine's function set, walked as the lab's adapter walks
// it (lab/predictor-core.ts fillLines), with each line in the shape the ports' tests read (TestLine). No library file
// imports it.
import type { FillResultOf, Fragment, Gap, LineInspectionOf, LinePieces, LineSlot, Paragraph, TextAlign } from './model.js'

// A test's paragraph with the width every slot of its layout gets, and a slot's two insets.
export type Sized = Paragraph & { width: number }
export type Insets = { left: number; right: number }

// A line as the ports' tests read it: what the fill result, the pieces and the inspection say of it, and its slot.
export type TestLine<Start, Geometry> = {
  start: number
  end: number
  fragments: Fragment[]
  hasLineBox: boolean
  joinsNextLine: boolean
  slot: LineSlot
  indented: boolean
  align: TextAlign
  geometry: Geometry
  gaps: Gap[]
  next: Start | null
}

// One engine's function set over an inspected paragraph.
export type EngineLines<Start, Line, Refused, Geometry> = {
  first: Start | null
  fill: (start: Start, slot: LineSlot) => FillResultOf<Start, Line, Refused>
  inspect: (line: Line | Refused) => LineInspectionOf<Geometry>
  pieces: (line: Line) => LinePieces<unknown>
}

// The k-th line box goes in insets[k], and line boxes past the list at the full width; a refused slot takes no line, and a
// line without a line box takes no slot.
export function everyLine<Start, Line, Refused, Geometry>(
  engine: EngineLines<Start, Line, Refused, Geometry>, width: number, insets: readonly Insets[],
): { lines: TestLine<Start, Geometry>[]; belowFloats: { row: number; gaps: Gap[] }[] } {
  const lines: TestLine<Start, Geometry>[] = []
  const belowFloats: { row: number; gaps: Gap[] }[] = []
  let row = 0
  for (let start = engine.first; start !== null;) {
    const inset = row < insets.length ? insets[row]! : { left: 0, right: 0 }
    const slot = { width, left: inset.left, right: inset.right }
    const filled = engine.fill(start, slot)
    switch (filled.kind) {
      case 'below-floats':
        belowFloats.push({ row, gaps: engine.inspect(filled.line).gaps })
        row++
        break
      case 'line': {
        const { geometry, gaps } = engine.inspect(filled.line)
        if (geometry === null) throw new Error('the engine gave a filled line no geometry')
        const pieces = engine.pieces(filled.line)
        lines.push({
          start: filled.start, end: filled.end, fragments: pieces.fragments, hasLineBox: filled.hasLineBox, joinsNextLine: pieces.joinsNextLine, slot,
          indented: pieces.indented, align: pieces.align, geometry, gaps, next: filled.next,
        })
        if (filled.hasLineBox) row++
        break
      }
    }
    start = filled.next
  }
  return { lines, belowFloats }
}
