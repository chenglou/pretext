// Named Canvas-versus-DOM gaps (DESIGN.md §5), one entry per gap and run in a list: the paragraph's in prepare, a line's
// while that line is filled.
import type { Gap, GapName } from '../../model.js'

export function addGap(gaps: Gap[], gap: GapName, run: number | null, detail: string): void {
  for (let i = 0; i < gaps.length; i++) if (gaps[i]!.gap === gap && gaps[i]!.run === run) return
  gaps.push({ gap, run, detail })
}
