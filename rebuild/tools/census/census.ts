// Main's whole wrapping suite on today's library: one record per case and browser, from which every calibration table is
// counted (tables.ts).
//   bun rebuild/tools/census/census.ts chunk <browser> <chunk> [--partial] [--out=<dir>]   # <dir>/<browser>/<chunk>/cases.ndjson
//   bun rebuild/tools/census/census.ts then <browser> <chunk> [--out=<dir>]    # <dir>/<browser>/<chunk>/then.ndjson
//   bun rebuild/tools/census/census.ts rerun-cases <browser> [<ids file>] [--out=<dir>]   # <dir>/rerun/<browser>-cases.ndjson
// `chunk` streams the chunk's rows (run-chunk.sh: native observation + today's library, no supplied font facts) and takes
// main's prediction of the same case from its --predict-only rows (score.ts withNativeRow), so both are scored against one
// native observation with the lab's scorer. `then` reads the census rows of 2026-09-17 for the same chunk and records each
// case's native view of that day, so a case whose browser layout moved since can be told from one whose prediction moved.
// `rerun-cases` writes the cases to run again in short fresh documents, in file order and reversed (chunks rerun-file and
// rerun-reverse), to tell a wrong prediction from a native layout that depends on the long document's history: every suite
// case of at most 1,000 units where the rebuild fails lineCount or breaks; or, with an ids file, the listed cases
// (<dir>/rerun/<browser>-listed-cases.ndjson).
//
// A record:
// - rebuild: the scorer's status of lineCount, breaks, widths and painter for today's library;
// - covered: for each of lineCount, breaks and widths that fails, whether every failing line has a gap that covers it
//   (score.ts "Covered failures": lineGaps[metric].covered);
// - main: the scorer's lineCount status for main's line ranges, and its visible-breaks diagnostic (research/MAIN-TRIAGE.md:
//   main passes a case when its line count equals the native count; visible breaks tell a right count with wrong breaks);
// - native: the native line count and a hash of the native view (every code point and node rect's x, width and native line), the same hash
//   `then` writes for the rows of 2026-09-17.
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { readLines, plainRows } from '../../lab/rows.ts'
import { indexRows, nativeView, readRowAt, rowText, scoreRow, withNativeRow, type MetricName } from '../../lab/score.ts'
import type { LabRow } from '../../lab/types.ts'

const THEN = '.artifacts/research-20260916/census'
const PREDICTED: MetricName[] = ['lineCount', 'breaks', 'widths']

const args = process.argv.slice(2)
const outArg = args.find(a => a.startsWith('--out='))
const OUT = outArg === undefined ? '.artifacts/census-20260919' : outArg.slice('--out='.length)
const [mode, browser, chunk] = args.filter(a => !a.startsWith('--'))

function nativeKey(row: LabRow): { lines: number; key: string } {
  const view = nativeView(row)
  return { lines: view.lines, key: view.error !== null ? 'error' : createHash('sha1').update(JSON.stringify([view.points, view.nodes])).digest('hex').slice(0, 16) }
}

async function chunkStep(browser: string, chunk: string): Promise<void> {
  const dir = join(OUT, browser, chunk)
  const runOf = (kind: string): { status: string; bundleSha256: string } => JSON.parse(readFileSync(join(dir, kind, `${browser}-run.json`), 'utf8')) as { status: string; bundleSha256: string }
  // --partial: the rows a stalled run wrote before it stopped are whole rows; main's run over the same cases must be ok.
  if ((runOf('rebuild').status !== 'ok' && !args.includes('--partial')) || runOf('main').status !== 'ok') throw new Error(`${dir}: a run did not finish ok`)
  const mainRows = plainRows(join(dir, 'main', `${browser}-rows.ndjson`))
  const mainIndex = await indexRows(mainRows.path)
  const mainFd = openSync(mainRows.path, 'r')
  // Written under another name and renamed when whole, so a cut-off step never leaves a short file that reads as finished.
  const out = openSync(join(dir, 'cases.ndjson.part'), 'w')
  let rows = 0
  for await (const line of readLines(join(dir, 'rebuild', `${browser}-rows.ndjson`))) {
    const row = JSON.parse(line) as LabRow
    const entry = mainIndex.get(row.id)
    if (entry === undefined) throw new Error(`${dir}: no main row for ${row.id}`)
    const combined = withNativeRow(readRowAt(mainFd, entry), row)
    if ('error' in combined) throw new Error(`${dir}: ${combined.error}`)
    const rebuild = scoreRow(row)
    const main = scoreRow(combined)
    const covered: Partial<Record<MetricName, boolean>> = {}
    for (let m = 0; m < PREDICTED.length; m++) {
      const attribution = rebuild.lineGaps[PREDICTED[m]!]
      if (rebuild.metrics[PREDICTED[m]!].status === 'fail' && attribution !== undefined) covered[PREDICTED[m]!] = attribution.covered
    }
    const p = row.case.paragraph
    writeSync(out, JSON.stringify({
      browser, id: row.id, family: row.family, chunk, units: rowText(row.case).length, direction: p.direction, whiteSpace: p.whiteSpace, letterSpacing: p.letterSpacing,
      rebuild: { lineCount: rebuild.metrics.lineCount.status, breaks: rebuild.metrics.breaks.status, widths: rebuild.metrics.widths.status, painter: rebuild.metrics.painter.status },
      ...('error' in row.prediction ? { rebuildError: row.prediction.error.slice(0, 200) } : {}),
      covered, gaps: rebuild.gaps,
      main: { lineCount: main.metrics.lineCount.status, visibleBreaks: main.diagnostics === null ? 'none' : main.diagnostics.visibleBreaks.status },
      ...('error' in combined.prediction ? { mainError: combined.prediction.error.slice(0, 200) } : {}),
      native: nativeKey(row),
    }) + '\n')
    rows++
  }
  closeSync(mainFd)
  closeSync(out)
  renameSync(join(dir, 'cases.ndjson.part'), join(dir, 'cases.ndjson'))
  mainRows.release()
  console.log(`${browser} ${chunk}: ${rows} cases`)
}

async function thenStep(browser: string, chunk: string): Promise<void> {
  const out = openSync(join(OUT, browser, chunk, 'then.ndjson.part'), 'w')
  let rows = 0
  for await (const line of readLines(join(THEN, browser, chunk, 'rebuild', `${browser}-rows.ndjson`))) {
    const row = JSON.parse(line) as LabRow
    writeSync(out, JSON.stringify({ id: row.id, native: nativeKey(row) }) + '\n')
    rows++
  }
  closeSync(out)
  renameSync(join(OUT, browser, chunk, 'then.ndjson.part'), join(OUT, browser, chunk, 'then.ndjson'))
  console.log(`${browser} ${chunk}: ${rows} native views of 2026-09-17`)
}

async function rerunCases(browser: string, idsFile: string | undefined): Promise<void> {
  const listed = idsFile === undefined ? null : new Set(readFileSync(idsFile, 'utf8').split('\n'))
  const wanted = new Set<string>()
  const chunks = readdirSync(join(OUT, browser)).sort()
  mkdirSync(join(OUT, 'rerun'), { recursive: true })
  const out = openSync(join(OUT, 'rerun', `${browser}-${idsFile === undefined ? 'cases' : 'listed-cases'}.ndjson`), 'w')
  for (let c = 0; c < chunks.length; c++) {
    const records = join(OUT, browser, chunks[c]!, 'cases.ndjson')
    if (!chunks[c]!.startsWith('chunk') || !existsSync(records)) continue
    for await (const line of readLines(records)) {
      const r = JSON.parse(line) as { id: string; rebuild: { lineCount: string; breaks: string } }
      if (listed === null ? r.rebuild.lineCount === 'fail' || r.rebuild.breaks === 'fail' : listed.has(r.id)) wanted.add(r.id)
    }
    for await (const line of readLines(join(THEN, 'cases/chunks', `${chunks[c]}.ndjson`))) {
      if (wanted.has((JSON.parse(line) as { id: string }).id)) writeSync(out, line + '\n')
    }
  }
  closeSync(out)
  console.log(`${browser}: ${wanted.size} cases to run again`)
}

if (mode === 'chunk' && browser !== undefined && chunk !== undefined) await chunkStep(browser, chunk)
else if (mode === 'rerun-cases' && browser !== undefined) await rerunCases(browser, chunk)
else if (mode === 'then' && browser !== undefined && chunk !== undefined) await thenStep(browser, chunk)
else throw new Error('Usage: bun rebuild/tools/census/census.ts chunk|then <browser> <chunk> [--out=<dir>] | rerun-cases <browser> [<ids file>] [--out=<dir>]')
