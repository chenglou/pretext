// The paragraph's named Canvas-versus-DOM gaps (DESIGN.md §5), one entry per gap and run.
import type { GapName } from '../../model.js'
import type { BlinkPrepared } from './types.js'

export function addGap(p: BlinkPrepared, gap: GapName, run: number | null, detail: string): void {
  for (let i = 0; i < p.gaps.length; i++) if (p.gaps[i]!.gap === gap && p.gaps[i]!.run === run) return
  p.gaps.push({ gap, run, detail })
}
