// Seals a held-out case set (research/TEST-ARCHITECTURE.md §3): runs, ws and policy from a fresh random seed, and a suite
// sample, all without any case id used so far. The seed goes only into <out-dir>/SEAL.json, next to the sha256 of every
// file; case origins and summaries name the seed by its label. Owners must not open or run the files before the
// evaluation stage, and scoring them uses score.ts --sealed.
//
//   bun rebuild/lab/cases/seal.ts --out-dir=.artifacts/lab/sealed [--label=sealed-YYYYMMDD] [--suite-sample=10000]
//     [--public=rebuild/lab/baselines/sealed-<label>.json]
//
// Used ids: every case file a run.json under .artifacts names (casesFile), every case file under .artifacts/lab/cases and
// .artifacts/lab/final-20260916/cases, and rebuild/lab/smoke-cases.ndjson. The census of 2026-09-16 observed all of main's
// suite once, in chunk files under census/cases/chunks; those chunks aren't excluded, or no suite case would be left. The
// census published aggregates, and its per-case lists (main-only cases, history reruns) are excluded through their own
// run.json files. SEAL.json records all of this.
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO = resolve(import.meta.dir, '../../..')
const ARTIFACTS = join(REPO, '.artifacts')
// Directories that hold no case files a run used: browser profiles, virtualenvs and source caches.
const SKIP_DIRS = new Set(['profiles', 'venv', 'src-cache', 'node_modules', 'scratchpad-backup'])
const CENSUS_CHUNKS = '/research-20260916/census/cases/chunks/'

function fail(text: string): never {
  console.error(`[seal] ${text}`)
  process.exit(1)
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function* walk(dir: string, into: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (path === into) continue
    let stat
    try {
      stat = statSync(path)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(path, into)
    } else {
      yield path
    }
  }
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

// ---- Used ids ----

const sources = new Set<string>()
const notExcluded = new Set<string>()
for (const path of walk(ARTIFACTS, outDir)) {
  if (path.endsWith('run.json')) {
    let casesFile: unknown
    try {
      casesFile = (JSON.parse(readFileSync(path, 'utf8')) as { casesFile?: unknown }).casesFile
    } catch {
      continue
    }
    if (typeof casesFile !== 'string') continue
    const file = resolve(casesFile.replace('/pretext-rebuild-charter/', '/pretext-rebuild/'))
    if (file.includes(CENSUS_CHUNKS)) notExcluded.add(file)
    else sources.add(file)
  } else if ((path.includes('/.artifacts/lab/cases/') || path.includes('/.artifacts/lab/final-20260916/cases/')) && path.endsWith('.ndjson')) {
    sources.add(path)
  } else if (path.endsWith('/SEAL.json')) {
    // Every earlier sealed set, whether or not a run named its files: its case files go in whole, read for ids only.
    const dir = resolve(path, '..')
    for (const name of readdirSync(dir)) if (name.endsWith('.ndjson')) sources.add(join(dir, name))
  }
}
sources.add(join(REPO, 'rebuild/lab/smoke-cases.ndjson'))
const used = new Set<string>()
const sourceList: Array<{ path: string; ids: number }> = []
for (const file of [...sources].sort()) {
  if (!existsSync(file)) fail(`A run names ${file}, which is gone`)
  const text = readFileSync(file, 'utf8')
  let ids = 0
  for (let start = 0; start < text.length;) {
    let end = text.indexOf('\n', start)
    if (end === -1) end = text.length
    const match = /"id":"(c-[0-9a-f]{16})"/.exec(text.slice(start, Math.min(end, start + 4096)))
    if (match !== null) {
      used.add(match[1]!)
      ids++
    }
    start = end + 1
  }
  sourceList.push({ path: relative(REPO, file), ids })
}
const idsPath = join(outDir, 'excluded-ids.ndjson')
writeFileSync(idsPath, [...used].sort().map(id => `{"id":"${id}"}\n`).join(''))
console.log(`[seal] ${used.size} used case ids from ${sourceList.length} files; census chunks not excluded: ${notExcluded.size}`)

// ---- Generation ----

const seed = randomBytes(32).toString('hex')
const generator = join(REPO, 'rebuild/lab/cases/generate.ts')
// The suite sample fills every family by one quota: no family kept whole and no required case kept, so the sample has exactly
// --suite-sample cases (a held-out set has no reason to favour main's small families or its required cases).
const SUITE_OPTIONS = ['--suite-keep-whole=0', '--suite-keep-required=false']
const result = spawnSync('bun', [generator, 'runs', 'ws', 'policy', 'suite', `--seed=${seed}`, `--seed-label=${label}`, `--suite-sample=${suiteSample}`, ...SUITE_OPTIONS, `--exclude-ids=${idsPath}`, `--out-dir=${outDir}`], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256 << 20 })
const log = `${result.stdout ?? ''}${result.stderr ?? ''}`.split(seed).join('<seed>')
writeFileSync(join(outDir, 'generate.log'), log)
if (result.status !== 0) fail(`generate.ts exited ${result.status}; see ${join(outDir, 'generate.log')}`)

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
    notExcluded: { files: [...notExcluded].sort().map(file => relative(REPO, file)), reason: 'the 2026-09-16 census observed every suite case once in these chunks; excluding them would leave no suite case' },
  },
  files,
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
  'At the evaluation stage, run them like any case file, one browser job at a time under the browser lock, and score with',
  'bun rebuild/lab/score.ts --sealed, which writes counts per browser, metric and gap and nothing about single cases.',
  '',
  `SEAL.json holds the seed and the sha256 of every file. ${relative(REPO, publicPath)} holds the same record without the seed,`,
  'for the repository.',
  '',
].join('\n'))
console.log(`[seal] sealed ${files.filter(file => file.name.endsWith('.ndjson') && file.name !== 'excluded-ids.ndjson').length} case files in ${relative(REPO, outDir)} (label ${label})`)
for (const file of files) if (file.cases !== null) console.log(`[seal]   ${file.name}: ${file.cases} cases, ${file.families} families`)
