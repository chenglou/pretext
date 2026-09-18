// Seals a held-out case set (research/TEST-ARCHITECTURE.md §3): runs, ws and policy from a fresh random seed, and a suite
// sample, all without any case id used so far. The seed goes only into <out-dir>/SEAL.json, next to the sha256 of every
// file; case origins and summaries name the seed by its label. Owners must not open or run the files before the
// evaluation stage, and scoring them uses score.ts --sealed.
//
//   bun rebuild/lab/cases/seal.ts --out-dir=.artifacts/lab/sealed [--label=sealed-YYYYMMDD] [--suite-sample=10000]
//     [--public=rebuild/lab/baselines/sealed-<label>.json]
//
// Used ids (cases/used-ids.ts): every case file a run.json under .artifacts names (casesFile), every case file under
// .artifacts/lab/cases and .artifacts/lab/final-20260916/cases, every earlier sealed set, every fresh round's set
// (lab/fresh.ts) and rebuild/lab/smoke-cases.ndjson. The census of 2026-09-16 observed all of main's suite once, in chunk
// files under census/cases/chunks; those chunks aren't excluded, or no suite case would be left. The census published
// aggregates, and its per-case lists (main-only cases, history reruns) are excluded through their own run.json files.
// SEAL.json records all of this. Generation holds the generation lock, so no fresh round draws cases at the same time.
//
// Giants (cases/parts.ts: a paragraph over 50,000 UTF-16 units) leave the generated files for <out-dir>/giants.ndjson before
// the files are hashed, by length alone, with their ids and lines unchanged: they run on their own, exclusively, with
// --chunk=1 (lab/README.md, "Giants"). The first two sealed sets keep theirs inside suite-sample.ndjson.
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { isGiant, readCaseLines, writeCaseLines, type CaseLine } from './parts.ts'
import { collectUsedIds, generationLock, writeIdsFile } from './used-ids.ts'

const REPO = resolve(import.meta.dir, '../../..')

function fail(text: string): never {
  console.error(`[seal] ${text}`)
  process.exit(1)
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const args = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null || !['out-dir', 'label', 'suite-sample', 'public'].includes(match[1]!)) fail(`Unknown argument ${raw}`)
  args.set(match[1]!, match[2]!)
}
const outDir = resolve(args.get('out-dir') ?? fail('--out-dir is required'))
const label = args.get('label') ?? `sealed-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
const suiteSample = Number(args.get('suite-sample') ?? 10000)
const publicPath = resolve(args.get('public') ?? join(REPO, `rebuild/lab/baselines/${label}.json`))
if (existsSync(join(outDir, 'SEAL.json'))) fail(`${outDir} is already sealed`)
mkdirSync(outDir, { recursive: true })

// ---- Used ids, generation and giants, under the generation lock ----

const seed = randomBytes(32).toString('hex')
const idsPath = join(outDir, 'excluded-ids.ndjson')
const { used, sourceList, notExcluded, giantCount } = await generationLock(`seal ${label}`, () => {
  const collected = collectUsedIds({ skip: outDir, failOnMissing: true })
  writeIdsFile(idsPath, collected.ids)
  console.log(`[seal] ${collected.ids.size} used case ids from ${collected.sources.length} files; census chunks not excluded: ${collected.notExcluded.length}`)
  const generator = join(REPO, 'rebuild/lab/cases/generate.ts')
  // The suite sample fills every family by one quota: no family kept whole and no required case kept, so the sample has exactly
  // --suite-sample cases (a held-out set has no reason to favour main's small families or its required cases).
  const SUITE_OPTIONS = ['--suite-keep-whole=0', '--suite-keep-required=false']
  const result = spawnSync('bun', [generator, 'runs', 'ws', 'policy', 'suite', `--seed=${seed}`, `--seed-label=${label}`, `--suite-sample=${suiteSample}`, ...SUITE_OPTIONS, `--exclude-ids=${idsPath}`, `--out-dir=${outDir}`], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256 << 20 })
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}`.split(seed).join('<seed>')
  writeFileSync(join(outDir, 'generate.log'), log)
  if (result.status !== 0) fail(`generate.ts exited ${result.status}; see ${join(outDir, 'generate.log')}`)
  // Giants leave the case files by length alone. A file's summary keeps its family table and gets the new case count.
  const giants: CaseLine[] = []
  for (const name of readdirSync(outDir).sort()) {
    if (!name.endsWith('.ndjson') || name === 'excluded-ids.ndjson' || name === 'giants.ndjson') continue
    const path = join(outDir, name)
    const lines = readCaseLines(path)
    const big = lines.filter(isGiant)
    if (big.length === 0) continue
    giants.push(...big)
    writeCaseLines(path, lines.filter(line => !isGiant(line)))
    const summaryPath = path.replace(/\.ndjson$/, '.summary.json')
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as { cases: number; families: Record<string, number>; movedToGiants?: number }
    summary.cases = lines.length - big.length
    for (const line of big) {
      summary.families[line.family]!--
      if (summary.families[line.family] === 0) delete summary.families[line.family]
    }
    summary.movedToGiants = big.length
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  }
  if (giants.length > 0) writeCaseLines(join(outDir, 'giants.ndjson'), giants)
  return { used: collected.ids, sourceList: collected.sources, notExcluded: collected.notExcluded, giantCount: giants.length }
})

// ---- Seal ----

const files: Array<{ name: string; sha256: string; cases: number | null; families: number | null }> = []
for (const name of readdirSync(outDir).sort()) {
  if (name === 'SEAL.json' || name === 'README') continue
  const path = join(outDir, name)
  const text = readFileSync(path, 'utf8')
  if (text.includes(seed)) fail(`${name} holds the seed`)
  let cases: number | null = null
  let families: number | null = null
  if (name.endsWith('.summary.json')) {
    const summary = JSON.parse(text) as { cases?: number; families?: Record<string, number> }
    cases = summary.cases ?? null
    families = summary.families === undefined ? null : Object.keys(summary.families).length
  }
  files.push({ name, sha256: createHash('sha256').update(text).digest('hex'), cases, families })
}
const generatorSources = readdirSync(join(REPO, 'rebuild/lab/cases')).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts')).sort()
  .map(name => ({ path: `rebuild/lab/cases/${name}`, sha256: sha256(join(REPO, 'rebuild/lab/cases', name)) }))
const createdAt = new Date().toISOString()
const common = {
  format: 'pretext-lab-sealed/1', label, createdAt,
  seedSha256: createHash('sha256').update(seed).digest('hex'),
  command: `bun rebuild/lab/cases/generate.ts runs ws policy suite --seed=<seed> --seed-label=${label} --suite-sample=${suiteSample} --exclude-ids=${relative(REPO, idsPath)} --out-dir=${relative(REPO, outDir)}`,
  generatorSources,
  excluded: {
    ids: used.size, idsFile: relative(REPO, idsPath), idsFileSha256: sha256(idsPath), sources: sourceList,
    notExcluded: { files: notExcluded, reason: 'the 2026-09-16 census observed every suite case once in these chunks; excluding them would leave no suite case' },
  },
  files,
  giants: { file: giantCount === 0 ? null : 'giants.ndjson', cases: giantCount, run: 'exclusively (with-browser-lock.py <job> --browser=all), with run.ts --chunk=1' },
  rules: 'Owners must not open, run or score these files before the evaluation stage. At evaluation: score.ts --sealed (counts only). Any look at a case burns the set (TEST-ARCHITECTURE §3).',
}
writeFileSync(join(outDir, 'SEAL.json'), `${JSON.stringify({ ...common, seed }, null, 2)}\n`)
mkdirSync(resolve(publicPath, '..'), { recursive: true })
writeFileSync(publicPath, `${JSON.stringify({ ...common, sealDirectory: relative(REPO, outDir) }, null, 2)}\n`)
writeFileSync(join(outDir, 'README'), [
  `Sealed held-out cases: ${label}, created ${createdAt}.`,
  '',
  'Owners must not open, read, run or score these files before the evaluation stage. That covers every file in this',
  'directory apart from this README: the case files, their summaries, generate.log and SEAL.json.',
  '',
  'Why: these cases measure whether the library generalizes to paragraphs nobody iterated on. Looking at a case, a family',
  'breakdown or a failure example burns the set, and burned cases become development cases (research/TEST-ARCHITECTURE.md §3).',
  '',
  'At the evaluation stage, run them like any case file under the browser lock (split by a tool, never by hand), run',
  'giants.ndjson, when there is one, exclusively with --chunk=1, and score with bun rebuild/lab/score.ts --sealed, which',
  'writes counts per browser, metric and gap and nothing about single cases.',
  '',
  `SEAL.json holds the seed and the sha256 of every file. ${relative(REPO, publicPath)} holds the same record without the seed,`,
  'for the repository.',
  '',
].join('\n'))
console.log(`[seal] sealed ${files.filter(file => file.name.endsWith('.ndjson') && file.name !== 'excluded-ids.ndjson').length} case files in ${relative(REPO, outDir)} (label ${label})`)
for (const file of files) if (file.cases !== null) console.log(`[seal]   ${file.name}: ${file.cases} cases, ${file.families} families`)
console.log(`[seal]   giants.ndjson: ${giantCount} cases${giantCount === 0 ? ' (no file)' : ', to run exclusively with --chunk=1'}`)
