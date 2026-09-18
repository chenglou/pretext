// The giants set (lab/README.md, "Giants"): cases whose paragraph exceeds GIANT_UNITS UTF-16 units leave the routine case
// files for <dir>/giants.ndjson, which runs on its own, exclusively, with --chunk=1. Ids and case lines don't change.
//
//   bun rebuild/lab/cases/giants.ts --scan=<cases.ndjson>[,<file>...]      # list giants, change nothing
//   bun rebuild/lab/cases/giants.ts --move [--dir=<dir>[,<dir>...]]        # move them out of every case file in the directories
//
// The default directories are .artifacts/lab/cases and .artifacts/lab/final-20260916/cases (the combined evaluation files);
// giants.ndjson and the record always sit in the first. --move records the move in giants.moves.json: per case its id,
// family, length and the file and line it came from, and per file the sha256 and case count before and after. Before a file is replaced, the tool puts the giants back at their
// recorded lines in memory and checks that the result hashes to the original, so the record alone restores it. The original
// goes to the Trash, never rm. A file's <name>.summary.json gets its new counts and a `movedToGiants` note.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { GIANT_UNITS, isGiant, readCaseLines, type CaseLine } from './parts.ts'

const REPO = resolve(import.meta.dir, '../../..')

function fail(text: string): never {
  console.error(`[giants] ${text}`)
  process.exit(1)
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function familyCounts(lines: readonly CaseLine[]): Record<string, number> {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line.family, (counts.get(line.family) ?? 0) + 1)
  return Object.fromEntries([...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
}

const args = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
  if (match === null || !['scan', 'move', 'dir'].includes(match[1]!)) fail(`Unknown argument ${raw}`)
  args.set(match[1]!, match[2] ?? '')
}

if (args.has('scan')) {
  for (const file of args.get('scan')!.split(',')) {
    const lines = readCaseLines(resolve(file))
    const giants = lines.filter(isGiant)
    console.log(`${file}: ${lines.length} cases, ${giants.length} over ${GIANT_UNITS} UTF-16 units`)
    for (const line of giants) console.log(`  ${line.id} line ${line.index} ${line.units} units ${line.family}`)
  }
  process.exit(0)
}
if (!args.has('move')) fail('Usage: giants.ts --scan=<file>[,<file>...] | --move [--dir=<directory>]')

const dirs = (args.get('dir') || `${join(REPO, '.artifacts/lab/cases')},${join(REPO, '.artifacts/lab/final-20260916/cases')}`).split(',').map(value => resolve(value))
const giantsPath = join(dirs[0]!, 'giants.ndjson')
const movesPath = join(dirs[0]!, 'giants.moves.json')
type Move = { id: string; family: string; units: number; from: string; line: number }
type FileRecord = { file: string; sha256Before: string; sha256After: string; casesBefore: number; casesAfter: number; movedAt: string }
type MovesRecord = { format: 'pretext-lab-giants/1'; thresholdUnits: number; note: string; moves: Move[]; files: FileRecord[] }
const record: MovesRecord = existsSync(movesPath)
  ? (JSON.parse(readFileSync(movesPath, 'utf8')) as MovesRecord)
  : { format: 'pretext-lab-giants/1', thresholdUnits: GIANT_UNITS, note: 'Cases moved out of routine case files into giants.ndjson. Ids and lines are unchanged: putting each case back at `line` (its index among its file\'s cases) restores a file to sha256Before. Old rows of these ids compare with giants runs by id.', moves: [], files: [] }
const giants: CaseLine[] = existsSync(giantsPath) ? readCaseLines(giantsPath) : []
const known = new Set(giants.map(line => line.id))

let moved = 0
const files: string[] = []
for (const dir of dirs) for (const name of readdirSync(dir).sort()) if (name.endsWith('.ndjson') && name !== 'giants.ndjson') files.push(join(dir, name))
for (const path of files) {
  const name = relative(REPO, path)
  const original = readFileSync(path, 'utf8')
  const lines = readCaseLines(path)
  const big = lines.filter(isGiant)
  if (big.length === 0) continue
  if (original !== `${lines.map(line => line.line).join('\n')}\n`) fail(`${name} isn't one case per line with a final line feed; left alone`)
  const kept = lines.filter(line => !isGiant(line))
  const after = `${kept.map(line => line.line).join('\n')}\n`
  // Put the giants back at their recorded lines and compare with the original before touching anything.
  const restored = kept.map(line => line.line)
  for (const line of big) restored.splice(line.index, 0, line.line)
  if (sha256(`${restored.join('\n')}\n`) !== sha256(original)) fail(`${name}: the recorded lines don't restore the file; left alone`)
  const temporary = `${path}.without-giants`
  writeFileSync(temporary, after)
  if (spawnSync('trash', [path]).status !== 0) fail(`trash ${path} failed; ${temporary} holds the new file`)
  renameSync(temporary, path)
  const movedAt = new Date().toISOString()
  for (const line of big) {
    record.moves.push({ id: line.id, family: line.family, units: line.units, from: relative(REPO, path), line: line.index })
    if (!known.has(line.id)) {
      giants.push(line)
      known.add(line.id)
    }
  }
  record.files.push({ file: relative(REPO, path), sha256Before: sha256(original), sha256After: sha256(after), casesBefore: lines.length, casesAfter: kept.length, movedAt })
  const summaryPath = path.replace(/\.ndjson$/, '.summary.json')
  if (existsSync(summaryPath)) {
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as Record<string, unknown>
    summary['cases'] = kept.length
    if (summary['families'] !== undefined) summary['families'] = familyCounts(kept)
    summary['movedToGiants'] = { cases: big.length, ids: big.map(line => line.id), file: relative(REPO, giantsPath), record: relative(REPO, movesPath), movedAt }
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  }
  moved += big.length
  console.log(`[giants] ${name}: moved ${big.length} of ${lines.length} cases (${big.map(line => `${line.id} ${line.units}`).join(', ')})`)
}
if (moved === 0) {
  console.log(`[giants] no case over ${GIANT_UNITS} UTF-16 units in ${dirs.map(dir => relative(REPO, dir)).join(', ')}`)
  process.exit(0)
}
writeFileSync(giantsPath, `${giants.map(line => line.line).join('\n')}\n`)
writeFileSync(join(dirs[0]!, 'giants.summary.json'), `${JSON.stringify({ file: giantsPath, cases: giants.length, thresholdUnits: GIANT_UNITS, run: 'exclusively (with-browser-lock.py <job> --browser=all), with run.ts --chunk=1', families: familyCounts(giants), units: Object.fromEntries(giants.map(line => [line.id, line.units])) }, null, 2)}\n`)
writeFileSync(movesPath, `${JSON.stringify(record, null, 2)}\n`)
console.log(`[giants] ${giantsPath}: ${giants.length} cases; record ${relative(REPO, movesPath)}`)
