// Named Canvas-versus-DOM gaps (DESIGN.md §5). A gap goes to one of two lists: a line's while that line is filled, for
// conditions of its break decisions, or the paragraph's with `at`, the source range whose widths the condition concerns
// (model.ts Gap), for conditions of the content itself. A paragraph gap without `at` concerns the environment or a font as
// a whole.
import type { Gap, GapName } from '../../model.js'
import type { BlinkPrepared } from './types.js'

// One entry per gap name, run, detail and range; ranges of one gap, run and detail that meet merge.
export function addGap(gaps: Gap[], gap: GapName, run: number | null, detail: string, at?: { start: number; end: number }): void {
  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i]!
    if (g.gap !== gap || g.run !== run || g.detail !== detail) continue
    if (at === undefined) {
      if (g.at === undefined) return
      continue
    }
    if (g.at === undefined) continue
    if (at.start <= g.at.end && at.end >= g.at.start) {
      g.at = { start: Math.min(g.at.start, at.start), end: Math.max(g.at.end, at.end) }
      return
    }
  }
  gaps.push(at === undefined ? { gap, run, detail } : { gap, run, detail, at: { start: at.start, end: at.end } })
}

// The source range of text_content [from, to): from the first unit with a source offset to the last one's end. A range
// holding only generated units (a <wbr>'s or an atomic inline's) is the break offset before the next source unit.
export function sourceRange(p: BlinkPrepared, from: number, to: number): { start: number; end: number } {
  let start = -1
  let end = -1
  for (let t = from; t < to && t < p.text.length; t++) {
    const s = p.sourceOffsets[t]!
    if (s < 0) continue
    if (start < 0) start = s
    end = s + 1
  }
  if (start >= 0) return { start, end }
  let at = p.sourceLength
  for (let t = to; t < p.text.length; t++) if (p.sourceOffsets[t]! >= 0) { at = p.sourceOffsets[t]!; break }
  return { start: at, end: at }
}

// The source break offset at text_content offset k: the source offset of the first unit at or after k.
export function sourceOffsetAt(p: BlinkPrepared, k: number): { start: number; end: number } {
  for (let t = k; t < p.text.length; t++) if (p.sourceOffsets[t]! >= 0) return { start: p.sourceOffsets[t]!, end: p.sourceOffsets[t]! }
  return { start: p.sourceLength, end: p.sourceLength }
}
