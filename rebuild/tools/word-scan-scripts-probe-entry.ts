// The page side of tools/word-scan-scripts-probe.ts and tools/word-scan-paragraphs-probe.ts: one library as an
// application runs it, behind a few functions the probes' scripts call. A probe bundles it once per library, with the
// imports below pointed at that library's source folder. Nothing here measures time.
import { detectEnvironment, fillLine, firstLine, prepare, type Environment, type Prepared } from '../src/index.ts'
import type { Direction, FontFacts, Gap, LineBreak, OverflowWrap, Paragraph, WhiteSpace, WordBreak } from '../src/model.ts'

export type Spec = {
  family: string
  size: number
  weight: number
  style: 'normal' | 'italic'
  facts: FontFacts
  text: string
  lang: string
  direction: Direction
  overflowWrap: OverflowWrap
  wordBreak: WordBreak
  letterSpacing?: number
  wordSpacing?: number
  whiteSpace?: WhiteSpace
  lineBreak?: LineBreak
}

function environment(): Environment {
  const detected = detectEnvironment({ engine: 'gecko', build: null, contentLanguage: null, regionalPrefsLocale: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

function paragraphOf(s: Spec): Paragraph {
  return {
    font: { family: s.family, size: s.size, weight: s.weight, style: s.style, facts: s.facts }, letterSpacing: s.letterSpacing ?? 0,
    wordSpacing: s.wordSpacing ?? 0, whiteSpace: s.whiteSpace ?? 'normal', wordBreak: s.wordBreak, overflowWrap: s.overflowWrap, lineBreak: s.lineBreak ?? 'auto', tabSize: 8,
    content: [{ kind: 'text', text: s.text }], lang: s.lang, direction: s.direction, lineHeight: 2 * s.size, textIndent: 0, textAlign: 'start',
  }
}

// Every line's range at a width in au, and on an inspected paragraph the negative-word-tail gaps its lines report.
function lay(prepared: Prepared, widthAu: number): { starts: number[]; ranges: string; gaps: string[] } {
  const starts: number[] = []
  let ranges = ''
  const gaps: string[] = []
  let guard = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width: widthAu / 60, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    if (filled.hasLineBox) starts.push(filled.start)
    ranges += `${filled.start}-${filled.end} `
    const found = (filled.line as { inspect?: { gaps: readonly Gap[] } | null }).inspect?.gaps ?? []
    for (let i = 0; i < found.length; i++) if (found[i]!.gap === 'negative-word-tail') gaps.push(found[i]!.detail)
    if (++guard > 5000) throw new Error('more than 5,000 lines')
    start = filled.next
  }
  return { starts, ranges, gaps }
}

function lineCount(prepared: Prepared, widthAu: number): number {
  let lines = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width: widthAu / 60, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    if (filled.hasLineBox) lines++
    start = filled.next
  }
  return lines
}

// The smallest width in au, from 1, where one plain paragraph gives one line; null where it never does below `high`.
function oneLineFrom(env: Environment, s: Spec, high: number): number | null {
  const prepared = prepare(paragraphOf(s), env, false)
  if (lineCount(prepared, high) !== 1) return null
  if (lineCount(prepared, 1) === 1) return 1
  let low = 1
  let top = high
  while (top - low > 1) {
    const mid = (low + top) >> 1
    if (lineCount(prepared, mid) === 1) top = mid
    else low = mid
  }
  return top
}

// A paragraph prepared anew, plain or inspected, laid out at a width.
function layAt(env: Environment, s: Spec, widthAu: number, inspect: boolean): { starts: number[]; ranges: string; gaps: string[] } {
  return lay(prepare(paragraphOf(s), env, inspect), widthAu)
}

// A paragraph prepared once, laid out at each width, plain or inspected.
function layAtWidths(env: Environment, s: Spec, widths: readonly number[], inspect: boolean): { starts: number[]; ranges: string; gaps: string[] }[] {
  const prepared = prepare(paragraphOf(s), env, inspect)
  const out: { starts: number[]; ranges: string; gaps: string[] }[] = []
  for (let w = 0; w < widths.length; w++) out.push(lay(prepared, widths[w]!))
  return out
}

function prepareSpec(env: Environment, s: Spec, inspect: boolean): Prepared {
  return prepare(paragraphOf(s), env, inspect)
}

(globalThis as unknown as { wordScanScriptsProbe: unknown }).wordScanScriptsProbe = { environment, oneLineFrom, layAt, layAtWidths, prepareSpec, lay }
