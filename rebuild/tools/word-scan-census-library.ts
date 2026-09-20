// The word scan's premise counted on recorded answers (src/engines/gecko/lines.ts wordScan): the library with every scan
// decided by the engine's loop, which also reads, from each Gecko paragraph once its lines were filled, every advance
// measuring found inside a word, and counts the ones the premise forbids: more than the advance before the word's end.
// It counts the ones below the advance before the word's start too, which the word scan doesn't lean on. For the function
// set's plain check, whose replay answers from a browser's recording:
//   WORD_SCAN_CENSUS=<folder> bun rebuild/tests/function-set.ts plain --browser=firefox --library=rebuild/tools/word-scan-census-library.ts
// Every worker process appends one JSON line to <folder>/census.ndjson as it exits.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { wordScanState } from '../src/engines/gecko/lines.ts'
import type { GeckoPrepared } from '../src/engines/gecko/types.ts'
import * as library from '../src/index.ts'

wordScanState.mode = 'exact'
export * from '../src/index.ts'

type Example = { text: string; font: string; at: number; au: number; start: number; end: number; reason: string }
const census = { paragraphs: 0, words: 0, wordsAsked: 0, offsets: 0, aboveEnd: 0, belowStart: 0, wordsAboveEnd: 0, examples: [] as Example[] }
let last: GeckoPrepared | null = null

function count(p: GeckoPrepared): void {
  census.paragraphs++
  for (let u = 0; u < p.units.length; u++) {
    const unit = p.units[u]!
    if (unit.kind !== 'word') continue
    census.words++
    if (unit.inWord === null) continue
    census.wordsAsked++
    let above = false
    for (let k = 1; k < unit.inWord.offsets.length; k++) {
      const entry = unit.inWord.offsets[k]!
      if (entry === null || entry.advance === null) continue
      census.offsets++
      const au = entry.advance.au
      if (au < unit.startAdvance) census.belowStart++
      if (au <= unit.startAdvance + unit.au) continue
      census.aboveEnd++
      above = true
      if (census.examples.length < 40) {
        let text = ''
        for (let i = unit.tStart; i < unit.tEnd; i++) text += String.fromCharCode(p.tUnits[i]!)
        census.examples.push({ text, font: p.textRuns[0]!.contexts.own.settings.font, at: k, au, start: unit.startAdvance, end: unit.startAdvance + unit.au, reason: entry.advance.standIn === null ? 'told' : entry.advance.standIn.kind })
      }
    }
    if (above) census.wordsAboveEnd++
  }
}

export function prepare(...args: Parameters<typeof library.prepare>): library.Prepared {
  if (last !== null) count(last)
  const prepared = library.prepare(...args)
  last = prepared.engine === 'gecko' ? prepared.state : null
  return prepared
}

process.on('exit', () => {
  if (last !== null) count(last)
  appendFileSync(join(process.env['WORD_SCAN_CENSUS']!, 'census.ndjson'), `${JSON.stringify(census)}\n`)
})
