// Capability f: how a line ended: at the end of the text, at a forced break, at a hyphen, at a break opportunity, or
// inside a word (an emergency break of overflow-wrap). main's dynamic-layout and editorial-engine ask the last one to
// reject headline sizes that break a word (`line.end.graphemeIndex !== 0`).
//   bun rebuild/research/capability-check/line-end.ts
// Part 1, the function set alone: `next === null` says end of text, and the line's fragments say forced break and hyphen.
// Nothing says whether a soft break fell at an opportunity or inside a word. Part 2 reads that from each engine's internals.
// Part 3 is what a headline fit needs and the function set already gives: lay the paragraph out with overflow-wrap: normal,
// where a word that doesn't fit overflows its line, and read linePieces' `overflows`.
import { BREAK_NORMAL } from '../../src/engines/gecko/linebreak.ts'
import { LineBreakIterator } from '../../src/engines/blink/breaks.ts'
import { linePieces, type FillResult, type Prepared } from '../../src/index.ts'
import { fillAll, forEach, prepare } from './setup.ts'

const WIDTH = 150

type Filled = Extract<FillResult, { kind: 'line' }>

function byFunctionSet(prepared: Prepared, result: Filled): string {
  if (result.next === null) return 'end'
  const fragments = linePieces(prepared, result.line).fragments
  for (let i = 0; i < fragments.length; i++) {
    const kind = fragments[i]!.kind
    if (kind === 'forced-break' || kind === 'br') return 'forced'
    if (kind === 'hyphen') return 'hyphen'
  }
  return 'soft'
}

// Whether a soft break fell where the engine has no break opportunity under the paragraph's own rules.
function insideWord(prepared: Prepared, result: Filled): boolean {
  switch (prepared.engine) {
    case 'blink': {
      if (result.line.engine !== 'blink' || result.next === null || result.next.engine !== 'blink') throw new Error('not blink')
      // The iterator as LineBreaker sets it for the line, under the style's own break type, asked about the line's end.
      const p = prepared.state
      const style = result.line.start.style
      const iterator = new LineBreakIterator(p.text, p.is8Bit, p.settings[style]!, p.env.uiLanguage, p.env.dictionaryBreaks)
      iterator.locale = p.styles[style]!.locale
      iterator.setStartOffset(result.line.start.textOffset)
      return !iterator.isBreakable(result.next.textOffset)
    }
    case 'webkit':
      // Items end at break opportunities, so a next line that starts inside an item split a word.
      if (result.next === null || result.next.engine !== 'webkit') throw new Error('not webkit')
      return result.next.offset !== 0
    case 'gecko': {
      const p = prepared.state
      const t = p.nextT[result.end]!
      return t < p.breakFlags.length && p.breakFlags[t] !== BREAK_NORMAL && p.isSpace[t - 1] !== 1
    }
  }
}

forEach((engine, sample, env) => {
  const prepared = prepare(sample.paragraph, env, false)
  const lines = fillAll(prepared, WIDTH)
  const kinds: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    let kind = byFunctionSet(prepared, line)
    if (kind === 'soft') kind = insideWord(prepared, line) ? `INSIDE(${JSON.stringify(sample.text.slice(line.end - 3, line.end))}|${JSON.stringify(sample.text.slice(line.end, line.end + 3))})` : 'opportunity'
    kinds.push(kind)
  }
  // Part 3: the same text with overflow-wrap: normal; which lines overflow.
  const normal = prepare({ ...sample.paragraph, overflowWrap: 'normal' }, env, false)
  const normalLines = fillAll(normal, WIDTH)
  const overflowing: number[] = []
  for (let i = 0; i < normalLines.length; i++) if (linePieces(normal, normalLines[i]!.line).overflows) overflowing.push(i)
  console.log(`${engine.padEnd(6)} ${sample.name.padEnd(6)} ${lines.length} lines at ${WIDTH}px: ${kinds.join(' ')}`)
  console.log(`${''.padEnd(13)} with overflow-wrap: normal, lines that overflow: [${overflowing.join(', ')}] of ${normalLines.length}`)
})
