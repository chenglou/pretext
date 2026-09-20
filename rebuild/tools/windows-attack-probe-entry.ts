// The page side of tools/windows-attack-probe.ts: the Gecko port of the tree this is bundled from, behind one function
// that prepares a paragraph of one text node and reads the advance before every cluster start, then fills lines at
// widths that put breaks beside the 16th, 32nd and 48th cluster. Nothing here reads the DOM.
import { detectEnvironment } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../src/model.ts'
import { advanceBefore } from '../src/engines/gecko/advance.ts'
import { fillLine, firstLine } from '../src/engines/gecko/index.ts'
import { prepareGecko } from '../src/engines/gecko/prepare.ts'
import type { GeckoEnvironment } from '../src/env.ts'

type Sample = { family: string; size: number; weight: number; style: 'normal' | 'italic'; lang: string; direction: 'ltr' | 'rtl'; letterSpacing: number; text: string }

function environment(): GeckoEnvironment {
  const detected = detectEnvironment({ engine: 'gecko', build: null, contentLanguage: null, regionalPrefsLocale: null })
  if (detected.kind === 'unsupported' || detected.env.engine !== 'gecko') throw new Error('not Gecko')
  return detected.env
}

function paragraphOf(s: Sample): Paragraph {
  return {
    font: { family: s.family, size: s.size, weight: s.weight, style: s.style, facts: UNKNOWN_FONT_FACTS },
    letterSpacing: s.letterSpacing, wordSpacing: 0, lineHeight: 40, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'auto',
    tabSize: 8, direction: s.direction, lang: s.lang, textIndent: 0, textAlign: 'start', content: [{ kind: 'text', text: s.text }],
  }
}

function linesAt(prepared: ReturnType<typeof prepareGecko>, width: number): number[] {
  const ends: number[] = []
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('refused')
    ends.push(filled.end)
    start = filled.next
  }
  return ends
}

// Per cluster start of every text run, in text order: its source offset, the advance before it in au, and the kind of
// its stand-in reason ('' where the port calls the advance exact). Then the long units' windows where the tree has them,
// and the lines' ends at each width, plain and inspected.
function dump(s: Sample, env: GeckoEnvironment): unknown {
  const p = prepareGecko(paragraphOf(s), env, false, [])
  const src: number[] = []
  const au: number[] = []
  const kinds: string[] = []
  for (let r = 0; r < p.textRuns.length; r++) {
    const run = p.textRuns[r]!
    for (let t = run.tStart; t < run.tEnd; t++) {
      if (p.clusterStart[t] === 0) continue
      const a = advanceBefore(p, run, t)
      src.push(p.tSource[t]!)
      au.push(a.au)
      kinds.push(a.standIn === null ? '' : a.standIn.kind)
    }
  }
  const windows: number[][] = []
  for (let u = 0; u < p.units.length; u++) {
    const inWord = p.units[u]!.inWord as { windows?: { tStart: number }[] | null } | null
    if (inWord === null || inWord.windows === undefined || inWord.windows === null || inWord.windows.length === 0) continue
    const starts: number[] = []
    for (let k = 0; k < inWord.windows.length; k++) starts.push(inWord.windows[k]!.tStart)
    windows.push(starts)
  }
  const total = p.textRuns.length === 0 ? 0 : p.textRuns[0]!.totalAdvance
  const widths: number[] = []
  const marks = [16, 32, 48, 24]
  for (let k = 0; k < marks.length; k++) {
    if (marks[k]! >= au.length) continue
    const at = au[marks[k]!]!
    if (k === 0) widths.push((at - 1) / 60, at / 60, (at + 1) / 60)
    else widths.push((at + k) / 60)
  }
  widths.push(total / 60 / 3.7)
  const lines: number[][] = []
  for (let k = 0; k < widths.length; k++) lines.push(linesAt(p, widths[k]!))
  const inspected = prepareGecko(paragraphOf(s), env, true, [])
  const inspectedLines: number[][] = []
  for (let k = 0; k < widths.length; k += 3) inspectedLines.push(linesAt(inspected, widths[k]!))
  return { units: p.units.length, src, au, kinds, windows, widths, lines, inspectedLines }
}

(globalThis as unknown as { windowsAttack: unknown }).windowsAttack = { environment, dump }
