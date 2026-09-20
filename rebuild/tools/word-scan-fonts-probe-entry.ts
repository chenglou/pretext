// The page side of tools/word-scan-fonts-probe.ts: one text in one font family, prepared plain and filled at some widths
// with every scan decided by the engine's loop and again with Gecko's word scan (src/engines/gecko/lines.ts
// wordScanState), and the layouts whose line ranges differ.
import { wordScanState } from '../src/engines/gecko/lines.ts'
import { detectEnvironment, fillLine, firstLine, prepare, type Environment } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS, type Direction, type Paragraph } from '../src/model.ts'

function environment(): Environment {
  const detected = detectEnvironment({ engine: 'gecko', build: null, contentLanguage: null, regionalPrefsLocale: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

type Counts = { layouts: number; unstable: number; lines: number; premise: number; proven: number; refused: number }
type Difference = { family: string; size: number; text: string; width: number; exact: string; word: string }

function ranges(p: Paragraph, env: Environment, width: number, mode: 'exact' | 'premise', counts: Counts | null): string {
  wordScanState.mode = mode
  const prepared = prepare(p, env, false)
  let out = ''
  for (let start = firstLine(prepared); start !== null;) {
    const premise = wordScanState.premise
    const proven = wordScanState.proven
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    out += `${filled.start}-${filled.end} `
    if (counts !== null) {
      counts.lines++
      if (wordScanState.premise > premise) counts.premise++
      else if (wordScanState.proven > proven) counts.proven++
      else counts.refused++
    }
    start = filled.next
  }
  return out
}

function compare(family: string, size: number, text: string, lang: string, direction: Direction, widths: readonly number[], env: Environment, counts: Counts, into: Difference[]): void {
  const p: Paragraph = {
    font: { family, size, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lang, direction,
    lineHeight: 2 * size, textIndent: 0, textAlign: 'start',
  }
  for (let w = 0; w < widths.length; w++) {
    // Each layout prepares anew, and Canvas doesn't always answer a fallback font's characters the same way twice in one
    // document (16px SignPainter measured `~~` as 1038 au for one prepare and 628 au for the next): the engine's loop runs
    // before and after the word scan, and a layout counts as unstable, not as differing, where those two disagree.
    const exact = ranges(p, env, widths[w]!, 'exact', null)
    const word = ranges(p, env, widths[w]!, 'premise', counts)
    const again = ranges(p, env, widths[w]!, 'exact', null)
    counts.layouts++
    if (exact !== again) counts.unstable++
    else if (exact !== word && into.length < 200) into.push({ family, size, text, width: widths[w]!, exact, word })
  }
  wordScanState.mode = 'premise'
}

(globalThis as unknown as { wordScanFontsProbe: unknown }).wordScanFontsProbe = { environment, compare }
