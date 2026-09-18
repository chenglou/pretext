// The coverage map (research/ARCHITECTURE-PLAN-2.md §7 check 5): the lines of rebuild/src that the replay of the recorded
// sets never executes, per engine. Tier 1 compares to the bit where a path runs, and says nothing of a path it never runs
// (WebKit's TAB sums, a script no case holds); code on such a path moves verbatim in a rewrite, or gets a browser run.
//
//   bun rebuild/tests/coverage-map.ts [--browser=<b>|all] [--config=no-facts|facts|all] [--sets=a,b] [--groups=...] [--jobs=N] [--out=<dir>]
//
// Per browser it replays every shard of the chosen replay folders (both configurations by default) under `bun test
// --coverage` (coverage-map.shard.ts), one process per shard, and merges the shards' lcov records: a line ran when any
// shard of the browser ran it. It writes <out>/<engine>.json and <out>/<engine>.txt (default rebuild/tests/.check/coverage-map):
// for the engine's own folder and for every shared file, the measured lines that never ran, as ranges with the function
// each starts in and its first line of source. Other engines' folders are left out of an engine's map: they load, and
// nothing of them runs.
//
// What the numbers mean. bun measures lines, from JavaScriptCore's basic blocks: a line ran when any part of it did, so a
// one-line `if (rare) return x` counts as run once its test ran. Lines without code (comments, types, a lone brace) aren't
// measured. A file that no replay loads has no record and is listed whole. The painter (src/paint.ts paintLines) needs a
// DOM and never runs here; painterLimits does.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import * as ts from 'typescript'
import { checkDir, defaultJobs, dirtyFiles, readInputs, referenceDir, runShardJobs, shardJobs } from './replay.ts'
import { CONFIGS, REPO, TIER_BROWSERS, selectSets, type Config, type TierBrowser } from './sets.ts'

const SRC = 'rebuild/src'
const ENGINES: Record<TierBrowser, string> = { chrome: 'blink', firefox: 'gecko', 'webkit-host': 'webkit' }

// Per file, the lines bun measured and the ones that ran.
export type Coverage = Map<string, { measured: Set<number>; ran: Set<number> }>

// Adds one lcov record file to `into`. bun names files relative to the directory it ran in.
export function addLcov(into: Coverage, lcov: string): void {
  let file: { measured: Set<number>; ran: Set<number> } | null = null
  const lines = lcov.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('SF:')) {
      const name = line.slice(3)
      let known = into.get(name)
      if (known === undefined) {
        known = { measured: new Set(), ran: new Set() }
        into.set(name, known)
      }
      file = known
    } else if (line.startsWith('DA:') && file !== null) {
      const comma = line.indexOf(',')
      const number = Number(line.slice(3, comma))
      file.measured.add(number)
      if (Number(line.slice(comma + 1)) > 0) file.ran.add(number)
    }
  }
}

// Measured lines that never ran, as ranges. Two such lines join when no measured line between them ran, so a comment or a
// closing brace inside a never-run block doesn't cut it in two.
export function neverRan(file: { measured: Set<number>; ran: Set<number> }): Array<[number, number]> {
  const measured = [...file.measured].sort((a, b) => a - b)
  const out: Array<[number, number]> = []
  let open: [number, number] | null = null
  for (let i = 0; i < measured.length; i++) {
    const line = measured[i]!
    if (file.ran.has(line)) {
      open = null
    } else if (open === null) {
      open = [line, line]
      out.push(open)
    } else {
      open[1] = line
    }
  }
  return out
}

// The innermost function a line sits in, by name, or '' at module level.
export function functionAt(source: ts.SourceFile, line: number): string {
  let name = ''
  const visit = (node: ts.Node): void => {
    const from = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    const to = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1
    if (line < from || line > to) return
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node)) {
      const parent = node.parent
      if (ts.isConstructorDeclaration(node)) name = 'constructor'
      else if (node.name !== undefined && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) name = node.name.text
      else if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) name = parent.name.text
      else if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) name = parent.name.text
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return name
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) out.push(path)
  }
  return out
}

type FileMap = { measured: number; neverRan: number; ranges: Array<{ from: number; to: number; function: string; source: string }> } | { neverLoaded: true }
type EngineMap = {
  format: 'pretext-coverage-map/1'
  engine: string
  browser: TierBrowser
  configs: Config[]
  sets: string[]
  library: { commit: string; dirty: string[] }
  cases: number
  totals: { files: number; measured: number; neverRan: number; ranges: number; neverLoaded: string[] }
  files: Record<string, FileMap>
}

// An engine's map from its browser's coverage: its own folder and the shared files.
export function engineMap(engine: string, coverage: Coverage, read: (file: string) => string, files: readonly string[]): { files: Record<string, FileMap>; totals: EngineMap['totals'] } {
  const out: Record<string, FileMap> = {}
  const totals: EngineMap['totals'] = { files: 0, measured: 0, neverRan: 0, ranges: 0, neverLoaded: [] }
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!
    const inEngines = file.startsWith(`${SRC}/engines/`)
    if (inEngines && !file.startsWith(`${SRC}/engines/${engine}/`) && file.slice(`${SRC}/engines/`.length).includes('/')) continue
    const covered = coverage.get(file)
    const text = read(file)
    if (covered === undefined) {
      // A file of types alone has no code to load.
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
      if (source.statements.every(statement => ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly === true))) continue
      out[file] = { neverLoaded: true }
      totals.neverLoaded.push(file)
      continue
    }
    const ranges = neverRan(covered)
    const lines = text.split('\n')
    const source = ranges.length === 0 ? null : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    let lineCount = 0
    const described = ranges.map(([from, to]) => {
      for (let line = from; line <= to; line++) if (covered.measured.has(line)) lineCount++
      return { from, to, function: functionAt(source!, from), source: (lines[from - 1] ?? '').trim().slice(0, 100) }
    })
    out[file] = { measured: covered.measured.size, neverRan: lineCount, ranges: described }
    totals.files++
    totals.measured += covered.measured.size
    totals.neverRan += lineCount
    totals.ranges += ranges.length
  }
  return { files: out, totals }
}

function listing(map: EngineMap): string {
  const out = [
    `The ${map.engine} port and the shared files: measured lines that the replay of the recorded sets never ran.`,
    `bun rebuild/tests/coverage-map.ts --browser=${map.browser}; ${map.browser} ${map.configs.join(' and ')}, ${map.cases} replayed cases in ${map.sets.length} sets; library ${map.library.commit.slice(0, 12)}${map.library.dirty.length === 0 ? '' : ` with ${map.library.dirty.length} changed files`}.`,
    `${map.totals.neverRan} of ${map.totals.measured} measured lines in ${map.totals.ranges} ranges over ${map.totals.files} files. A line ran when any part of it did; lines without code aren't measured.`,
    'Tier 1 says nothing of these lines: in a rewrite they move verbatim, or get a browser run. Columns: lines, the function the range starts in, its first line.',
    '',
  ]
  for (const [file, value] of Object.entries(map.files)) {
    if ('neverLoaded' in value) {
      out.push(`${file}: no replay loads it`, '')
      continue
    }
    if (value.ranges.length === 0) continue
    out.push(`${file}: ${value.neverRan} of ${value.measured} measured lines`)
    for (const range of value.ranges) out.push(`  ${`${range.from}${range.to === range.from ? '' : `-${range.to}`}`.padEnd(11)} ${range.function.padEnd(28)} ${range.source}`)
    out.push('')
  }
  return `${out.join('\n')}`
}

function fail(text: string): never {
  console.error(`[coverage-map] ${text}`)
  process.exit(2)
}

if (import.meta.main) {
  const options = new Map<string, string>()
  for (const raw of process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
    if (match === null) fail(`Unknown argument ${raw}`)
    options.set(match[1]!, match[2]!)
  }
  const browsers = (options.get('browser') ?? 'all') === 'all' ? [...TIER_BROWSERS] : TIER_BROWSERS.filter(name => name === options.get('browser'))
  const configs = (options.get('config') ?? 'all') === 'all' ? [...CONFIGS] : CONFIGS.filter(name => name === options.get('config'))
  if (browsers.length === 0 || configs.length === 0) fail('--browser must be chrome, firefox, webkit-host or all, and --config no-facts, facts or all')
  const outDir = resolve(options.get('out') ?? join(REPO, 'rebuild/tests/.check/coverage-map'))
  mkdirSync(outDir, { recursive: true })
  const commit = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: REPO }).stdout.toString().trim()
  const files = sourceFiles(join(REPO, SRC)).map(path => relative(REPO, path))
  for (const browser of browsers) {
    const started = Date.now()
    const coverage: Coverage = new Map()
    let cases = 0
    let sets: string[] = []
    const ran: Config[] = []
    for (const config of configs) {
      const dir = referenceDir(browser, config)
      if (!existsSync(join(dir, 'inputs/manifest.json'))) continue
      const inputs = readInputs(dir)
      sets = selectSets(browser, options.get('sets'), options.get('groups')).map(set => set.name).filter(name => inputs.sets[name] !== undefined)
      const scratch = join(checkDir(browser, config), `coverage-work-${process.pid}`)
      const jobs = shardJobs(dir, inputs, null, sets, scratch)
      await runShardJobs(jobs, Math.max(1, Number(options.get('jobs') ?? defaultJobs())), job => ({
        // bun test prints its own summary per shard; the lcov record is what is read.
        args: ['test', '--coverage', '--coverage-reporter=lcov', `--coverage-dir=${job.result}.coverage`, join(REPO, 'rebuild/tests/coverage-map.shard.ts')],
        env: { COVERAGE_MAP_INPUTS: job.inputs, COVERAGE_MAP_PREDICTOR: inputs.predictor },
      }))
      for (const job of jobs) {
        addLcov(coverage, readFileSync(join(`${job.result}.coverage`, 'lcov.info'), 'utf8'))
        cases += job.shard.cases
      }
      Bun.spawnSync(['trash', scratch])
      ran.push(config)
    }
    if (ran.length === 0) fail(`${browser}: no replay folder with inputs`)
    const engine = ENGINES[browser]
    const map: EngineMap = {
      format: 'pretext-coverage-map/1', engine, browser, configs: ran, sets, library: { commit, dirty: dirtyFiles([SRC]) }, cases,
      ...engineMap(engine, coverage, file => readFileSync(join(REPO, file), 'utf8'), files),
    }
    writeFileSync(join(outDir, `${engine}.json`), `${JSON.stringify(map, null, 1)}\n`)
    writeFileSync(join(outDir, `${engine}.txt`), listing(map))
    const own = Object.entries(map.files).filter(([file]) => file.startsWith(`${SRC}/engines/${engine}/`))
    const sum = (entries: Array<[string, FileMap]>, key: 'measured' | 'neverRan'): number => entries.reduce((total, [, value]) => total + ('neverLoaded' in value ? 0 : value[key]), 0)
    const shared = Object.entries(map.files).filter(([file]) => !file.startsWith(`${SRC}/engines/${engine}/`))
    console.log(`[coverage-map] ${engine} (${browser} ${ran.join(' and ')}, ${cases} replayed cases): the port ${sum(own, 'neverRan')} of ${sum(own, 'measured')} measured lines never ran, the shared files ${sum(shared, 'neverRan')} of ${sum(shared, 'measured')}; ${map.totals.ranges} ranges; ${map.totals.neverLoaded.length} files never loaded (${Math.round((Date.now() - started) / 1000)} s)`)
    console.log(`  ${relative(REPO, join(outDir, `${engine}.txt`))}, ${relative(REPO, join(outDir, `${engine}.json`))}`)
  }
}
