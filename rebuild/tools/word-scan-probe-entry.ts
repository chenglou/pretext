// The page side of tools/word-scan-probe.ts: the library as an application runs it, with the mode of Gecko's word scan
// (src/engines/gecko/lines.ts wordScanState) behind a function, so one document times the engine's loop and the word scan
// in turns. Bundled by the probe module; nothing here measures time.
import { wordScanState } from '../src/engines/gecko/lines.ts'
import { detectEnvironment, fillLine, firstLine, prepare, type Context, type Environment, type Prepared } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type FontDecl, type InlineNode, type OverflowWrap, type Paragraph } from '../src/model.ts'

type Part = { code: boolean; text: string }

function environment(): Environment {
  const detected = detectEnvironment({ engine: 'gecko', build: null, contentLanguage: null, regionalPrefsLocale: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

// bench/page.ts chatInputs: no font facts supplied. The bench's overflow-wrap is break-word.
function paragraphOf(parts: readonly Part[], overflowWrap: OverflowWrap): Paragraph {
  const font: FontDecl = { family: '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  const codeFont: FontDecl = { family: 'Menlo', size: 14, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap, lineBreak: 'auto', tabSize: 8 } as const
  const edge: BoxEdge = { margin: 0, border: 0, padding: 6 }
  const content: InlineNode[] = []
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]!
    if (part.code) content.push({ ...text, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
    else content.push({ kind: 'text', text: part.text })
  }
  return { ...text, font, content, lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' }
}

function fillAll(prepared: Prepared, width: number): number {
  let lines = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    if (filled.hasLineBox) lines++
    start = filled.next
  }
  return lines
}

// From scratch: a list of contexts a message (`page` false), or one list for the set, as a page keeps it.
function scratch(paragraphs: readonly Paragraph[], env: Environment, width: number, page: boolean): number {
  const contexts: Context[] = []
  let lines = 0
  for (let i = 0; i < paragraphs.length; i++) lines += fillAll(page ? prepare(paragraphs[i]!, env, false, contexts) : prepare(paragraphs[i]!, env, false), width)
  return lines
}

function prepareAll(paragraphs: readonly Paragraph[], env: Environment, width: number): Prepared[] {
  const contexts: Context[] = []
  const out: Prepared[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    out.push(prepare(paragraphs[i]!, env, false, contexts))
    fillAll(out[i]!, width)
  }
  return out
}

function relayout(prepared: readonly Prepared[], widths: readonly number[]): number {
  let lines = 0
  for (let w = 0; w < widths.length; w++) for (let i = 0; i < prepared.length; i++) lines += fillAll(prepared[i]!, widths[w]!)
  return lines
}

// The lines of kept paragraphs at some widths by how their scans were decided, as tools/word-scan-diff.ts tallies them,
// and every line's range, for holding the two modes against each other.
function decided(prepared: readonly Prepared[], widths: readonly number[]): { lines: Record<string, number>; ranges: number } {
  const lines: Record<string, number> = {}
  let ranges = 0
  const refusedNow = (): number => {
    let n = 0
    for (const reason in wordScanState.refused) n += wordScanState.refused[reason]!
    return n
  }
  for (let w = 0; w < widths.length; w++) {
    for (let i = 0; i < prepared.length; i++) {
      for (let start = firstLine(prepared[i]!); start !== null;) {
        const refused = refusedNow()
        const proven = wordScanState.proven
        const premise = wordScanState.premise
        const filled = fillLine(prepared[i]!, start, { width: widths[w]!, left: 0, right: 0 })
        const how = refusedNow() > refused ? 'exact' : wordScanState.premise > premise ? 'premise' : wordScanState.proven > proven ? 'proven' : 'none'
        lines[how] = (lines[how] ?? 0) + 1
        if (filled.kind === 'line') ranges = (Math.imul(ranges, 31) + filled.start * 7 + filled.end) | 0
        start = filled.next
      }
    }
  }
  return { lines, ranges }
}

function setMode(mode: 'exact' | 'proven' | 'premise'): void {
  wordScanState.mode = mode
}

(globalThis as unknown as { wordScanProbe: unknown }).wordScanProbe = { environment, paragraphOf, scratch, prepareAll, relayout, decided, setMode }
