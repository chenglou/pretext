// A study tool, not a test: over case files under the stand-in Canvas (tools/stand-in-canvas.ts), how each line of Blink's
// plain path found its candidate (src/engines/blink/shape.ts wordsCheck): from the positions at the edges of words, without
// a search at all (the rest of the item fits), or by the search over every offset, with the reason. Every candidate found
// from words is held against the search (the checked run), so a difference throws and is counted as an error.
//
//   bun rebuild/tools/words-coverage.ts --cases=<cases.ndjson>[,<more>] [--widths=60,150,400] [--dpr=2] [--out=<report.json>]
//
// Tallied per case family's set (the file's name), per script at a line's start (UScriptCode numbers) and per outcome,
// with the paragraphs all of whose lines were found without the search.
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { predict } from '../lab/baselines/plain-predictor.ts'
import type { PredictEnv } from '../lab/predictor-core.ts'
import type { Case } from '../lab/types.ts'
import { wordsCheck } from '../src/engines/blink/shape.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}

// The page and process facts of the lab's Mac, as tools/two-trees.ts has them.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const ENV: PredictEnv = { browser: 'chrome', build: '153.0.8010.50', languages: { engine: 'blink', uiLanguage: 'zh-CN' } }

wordsCheck.on = true
wordsCheck.log = []

const searched = (): number => {
  let n = 0
  for (const [key, count] of wordsCheck.lines) if (!key.endsWith('|no search') && !key.endsWith('|words')) n += count
  return n
}

const files = (options.get('cases') ?? '').split(',').filter(file => file !== '')
const widths = options.get('widths') === undefined ? null : options.get('widths')!.split(',').map(Number)
const sets: unknown[] = []
for (let f = 0; f < files.length; f++) {
  wordsCheck.lines.clear()
  let layouts = 0
  let withoutSearch = 0
  const errors = new Map<string, number>()
  const lines = readFileSync(resolve(files[f]!), 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') continue
    const given = JSON.parse(lines[i]!) as Case
    const at = widths ?? [given.paragraph.width]
    for (let w = 0; w < at.length; w++) {
      const c: Case = { ...given, paragraph: { ...given.paragraph, width: at[w]! } }
      const standIn = installStandInCanvas({ userAgent: USER_AGENT, devicePixelRatio: Number(options.get('dpr') ?? 2), pageLang: c.pageLang })
      const before = searched()
      layouts++
      try {
        const prediction = predict(c, ENV)
        if ('error' in prediction) errors.set(prediction.error.slice(0, 120), (errors.get(prediction.error.slice(0, 120)) ?? 0) + 1)
        else if (searched() === before) withoutSearch++
      } catch (error) {
        const text = (error instanceof Error ? error.message : String(error)).slice(0, 120)
        errors.set(text, (errors.get(text) ?? 0) + 1)
      }
      standIn.restore()
    }
  }
  let total = 0
  for (const count of wordsCheck.lines.values()) total += count
  sets.push({
    file: basename(files[f]!), layouts, layoutsWithoutSearch: withoutSearch, lines: total, errors: Object.fromEntries(errors),
    byOutcome: [...wordsCheck.lines].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ script: Number(key.slice(0, key.indexOf('|'))), candidate: key.slice(key.indexOf('|') + 1), lines: count })),
  })
  console.error(`[words-coverage] ${basename(files[f]!)}: ${layouts} layouts, ${withoutSearch} without a search, ${total} lines, ${errors.size} kinds of error`)
}
const text = `${JSON.stringify({ widths, sets }, null, 1)}\n`
if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), text)
else process.stdout.write(text)
