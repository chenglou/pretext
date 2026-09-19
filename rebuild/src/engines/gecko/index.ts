// Gecko (Firefox 156.0, ICU4X icu_segmenter 2.1.2 with Firefox's baked data, bundled ICU 78.3).
// - prepare.ts: frames, element items, bidi splits, text runs, TransformText, glyph flags, nsLineBreaker breaks, spacing
//   and unit advances (specs/gecko-text.md, specs/gecko-canvas.md §2-§3).
// - linebreak.ts: nsLineBreaker and the ICU4X line iterator (specs/gecko-text.md §8-§10); likely.ts: the language test.
// - fonts.ts: family lists, the text-run font equality and the font facts.
// - lines.ts: the line loop over per-span line data with one redo, the band a slot gives, trimming, hanging, alignment,
//   positions and the placed frames (specs/gecko-lines.md §4-§6).
// The exports are the function set index.ts dispatches to (DESIGN.md §2.9).
import type { FillResultOf, Gap, LineInspectionOf, LinePieces, LineSlot } from '../../model.js'
import type { GeckoLineGeometry, GeckoLineStart } from './geometry.js'
import { nextGeckoLine } from './lines.js'
import type { GeckoLine, GeckoPrepared } from './types.js'

export { prepareGecko as prepare } from './prepare.js'
export { firstGeckoLine as firstLine } from './lines.js'

// The decided line: for now what nextGeckoLine returns, which computes the line's pieces, frames, characters and gaps
// while it fills, so linePieces and inspectLine only read.
export type GeckoFilledLine = { engine: 'gecko'; kind: 'line'; line: GeckoLine }
export type GeckoRefusedSlot = { engine: 'gecko'; kind: 'below-floats'; gaps: Gap[] }
export type GeckoFillResult = FillResultOf<GeckoLineStart, GeckoFilledLine, GeckoRefusedSlot>
// Gecko's painting rules read nothing beside the pieces.
export type GeckoPaintFacts = Record<never, never>

export function fillLine(p: GeckoPrepared, start: GeckoLineStart, slot: LineSlot): GeckoFillResult {
  const result = nextGeckoLine(p, start, slot, p.measurer)
  switch (result.kind) {
    case 'line': return { kind: 'line', line: { engine: 'gecko', kind: 'line', line: result.line }, start: result.line.start, end: result.line.end, next: result.line.next, hasLineBox: result.line.hasLineBox }
    // The next band lays the same line out again.
    case 'below-floats': return { kind: 'below-floats', line: { engine: 'gecko', kind: 'below-floats', gaps: result.gaps }, next: start }
  }
}

export function linePieces(_p: GeckoPrepared, filled: GeckoFilledLine): LinePieces<GeckoPaintFacts> {
  const line = filled.line
  const g = line.geometry
  return { fragments: line.fragments, joinsNextLine: line.joinsNextLine, indented: line.indented, align: line.align, overflows: g.width - g.hang - g.availableWidth > 0, facts: {} }
}

function inspected(p: GeckoPrepared, what: string): void {
  if (!p.inspect) throw new Error(`${what} reads an inspected paragraph, and this one was prepared plain`)
}

export function inspectLine(p: GeckoPrepared, decided: GeckoFilledLine | GeckoRefusedSlot): LineInspectionOf<GeckoLineGeometry> {
  inspected(p, 'inspectLine')
  switch (decided.kind) {
    case 'line': return { geometry: decided.line.geometry, gaps: decided.line.gaps }
    case 'below-floats': return { geometry: null, gaps: decided.gaps }
  }
}

// The gaps of the paragraph's content, fonts and environment, whatever the slot (DESIGN.md §5).
export function paragraphGaps(p: GeckoPrepared): Gap[] {
  inspected(p, 'paragraphGaps')
  return p.gaps
}
