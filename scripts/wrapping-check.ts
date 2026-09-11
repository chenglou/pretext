import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { acquireBrowserAutomationLock, type BrowserSession } from './browser-automation.ts'
import { createOracleSession } from './oracle-session.ts'
import { createWrappingTransport } from './wrapping-transport.ts'
import { environmentFailure, parseBrowserEnvironmentReport } from '../shared/browser-environment.ts'
import { createSummary, printSummary, regressionCount, type CompactRow } from '../tests/wrapping/report.ts'
import type { BrowserConfig, BrowserContext, BrowserKind, BrowserReport, FontFixture } from '../tests/wrapping/types.ts'
import baseline from '../tests/wrapping/baseline.json'
import { createSnapshots } from '../tests/wrapping/snapshots.ts'

const root = resolve(import.meta.dir, '..')
const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(`Compare public wrapping behavior against fresh native browser observations.

bun run test:wrapping [--browser=chrome|safari|firefox|all] [--suite=ordinary|full]
  --candidate=name=/path    Add a worktree or frozen src directory (repeatable).
  --preserve=old,other      Also gate losses against these candidate names.
  --direction=ltr|rtl       Run one direction; default runs separate pages for both.
  --family=substring        Select a family or provenance label.
  --case=wrap-ID            Reproduce one ID (defaults to the full inventory).
  --strict                 Fail on all observed supported incompatibilities.
  --snapshot               Refresh maintained dashboards from this checkout.
  --skip-numeric           Browser-only diagnostic; omits numeric API validation.
  --transport=playwright   Portable headed installed Chrome; native is default.
  --output=/new/directory   Frozen sources, raw NDJSON, and summaries.
  --timeout=900000          Browser run timeout in milliseconds.

Default candidate is this checkout. Main comes from tests/wrapping/baseline.json.
Default gate requires maintained absolute checks and no lost main successes.
Ordinary includes every maintained check and curated regression obligations.
Full additionally runs the exploratory matrices; known failures remain visible.`)
  process.exit(0)
}
const seenOptions = new Set<string>()
for (const arg of args) {
  const key = arg.split('=', 1)[0]!
  const takesValue = ['--browser', '--suite', '--candidate', '--preserve', '--direction', '--family', '--case', '--transport', '--output', '--timeout'].includes(key)
  const flag = ['--strict', '--snapshot', '--skip-numeric'].includes(key)
  if ((!takesValue && !flag) || (takesValue && !arg.includes('=')) || (flag && arg.includes('='))) throw new Error(`Invalid option: ${arg}; see --help`)
  if (key !== '--candidate' && seenOptions.has(key)) throw new Error(`Repeated option: ${key}`)
  seenOptions.add(key)
}
const value = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const browserOption = value('browser') ?? 'chrome'
const browsers: BrowserKind[] = browserOption === 'all' ? ['chrome', 'safari', 'firefox'] : [parseBrowser(browserOption)]
const schedule = value('suite') ?? (value('case') === undefined ? 'ordinary' : 'full')
if (schedule !== 'ordinary' && schedule !== 'full') throw new Error('--suite must be ordinary or full')
const snapshot = args.includes('--snapshot')
if (snapshot && (browserOption !== 'all' || value('case') !== undefined || value('family') !== undefined || value('direction') !== undefined || args.some(arg => arg.startsWith('--candidate=')))) throw new Error('--snapshot requires --browser=all, both directions, no filters, and this checkout as the candidate')
if (snapshot && args.includes('--skip-numeric')) throw new Error('--snapshot requires numeric validation; --skip-numeric is diagnostic only')
const requestedDirection = value('direction')
if (requestedDirection !== undefined && requestedDirection !== 'ltr' && requestedDirection !== 'rtl') throw new Error('--direction must be ltr or rtl')
const directions: Array<'ltr' | 'rtl'> = requestedDirection === undefined ? ['ltr', 'rtl'] : [requestedDirection]
const transport = value('transport') ?? 'native'
if (transport !== 'native' && transport !== 'playwright') throw new Error('--transport must be native or playwright')
if (transport === 'playwright' && browsers.some(browser => browser !== 'chrome')) throw new Error('Playwright transport supports installed Chrome; native automation supports all three browsers')
const timeout = Number(value('timeout') ?? 900000)
if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('--timeout must be positive milliseconds')
const runId = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`
const output = resolve(value('output') ?? join(root, '.artifacts', 'wrapping', runId))
await mkdir(dirname(output), { recursive: true })
await mkdir(output, { recursive: false })

function parseBrowser(browser: string): BrowserKind {
  switch (browser) {
    case 'chrome': case 'safari': case 'firefox': return browser
    default: throw new Error(`Unsupported browser: ${browser}`)
  }
}

function parseSource(raw: string) {
  const separator = raw.indexOf('=')
  if (separator < 1 || separator === raw.length - 1) throw new Error('Use --candidate=name=/path/to/worktree-or-src')
  const name = raw.slice(0, separator)
  if (!/^[a-z][a-z0-9-]*$/.test(name) || name === 'main') throw new Error(`Invalid/reserved candidate name: ${name}`)
  return { name, path: resolve(raw.slice(separator + 1)) }
}

function hash(contents: string | Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex')
}

async function fingerprint(directory: string, include: (path: string) => boolean = () => true): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function visit(relative: string): Promise<void> {
    for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) await visit(name)
      else if (entry.isFile() && include(name)) result[name] = hash(await readFile(join(directory, name)))
    }
  }
  await visit('')
  return result
}

const sources: Array<{ name: string; path: string; revision: string | null; files: Record<string, string> }> = []
const pinnedSource = join(output, 'sources', 'main', 'src')
await mkdir(pinnedSource, { recursive: true })
const gitFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline.revision, '--', 'src'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
for (const file of gitFiles) {
  if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'src/test-data.ts') continue
  const target = join(pinnedSource, file.slice(4))
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, execFileSync('git', ['show', `${baseline.revision}:${file}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 }))
}
sources.push({ name: 'main', path: pinnedSource, revision: baseline.revision, files: await fingerprint(pinnedSource) })
const requested = args.filter(arg => arg.startsWith('--candidate=')).map(arg => parseSource(arg.slice(12)))
if (requested.length === 0) requested.push({ name: 'current', path: root })
if (new Set(requested.map(source => source.name)).size !== requested.length) throw new Error('Candidate names must be unique')
for (const candidate of requested) {
  const source = await Bun.file(join(candidate.path, 'src', 'layout.ts')).exists() ? join(candidate.path, 'src') : candidate.path
  if (!await Bun.file(join(source, 'layout.ts')).exists()) throw new Error(`Missing layout.ts: ${source}`)
  const frozen = join(output, 'sources', candidate.name, 'src')
  await cp(source, frozen, { recursive: true, filter: path => !path.endsWith('.test.ts') && basename(path) !== 'test-data.ts' })
  let revision: string | null = null
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* Frozen experiments may not be Git checkouts. */ }
  sources.push({ name: candidate.name, path: frozen, revision, files: await fingerprint(frozen) })
}
const preserve = ['main', ...(value('preserve')?.split(',') ?? [])]
if (new Set(preserve).size !== preserve.length) throw new Error('Preserved baselines must be unique; main is always included')
for (const name of preserve) if (!sources.some(source => source.name === name)) throw new Error(`Unknown preserved baseline: ${name}`)
if (sources.every(source => preserve.includes(source.name))) throw new Error('At least one candidate must remain outside --preserve')

const harness = join(output, 'harness')
await cp(join(root, 'tests/wrapping'), join(harness, 'tests/wrapping'), { recursive: true })
await mkdir(join(harness, 'src'), { recursive: true })
await cp(join(root, 'src/test-data.ts'), join(harness, 'src/test-data.ts'))
await cp(join(root, 'shared'), join(harness, 'shared'), { recursive: true })
await mkdir(join(harness, 'scripts'), { recursive: true })
for (const file of ['wrapping-check.ts', 'wrapping-transport.ts', 'browser-automation.ts', 'oracle-session.ts']) {
  await cp(join(root, 'scripts', file), join(harness, 'scripts', file))
}
await mkdir(join(harness, 'corpora'), { recursive: true })
for (const file of await readdir(join(root, 'corpora'))) {
  if (file.endsWith('.txt') || file === 'sources.json') await cp(join(root, 'corpora', file), join(harness, 'corpora', file))
}
const entry = join(output, 'entry.ts')
await writeFile(entry, [
  `import {runBrowser} from ${JSON.stringify(join(harness, 'tests/wrapping/browser.ts'))}`,
  `import {createVariant} from ${JSON.stringify(join(harness, 'tests/wrapping/contracts.ts'))}`,
  ...sources.flatMap((source, index) => [
    `import * as api${index} from ${JSON.stringify(join(source.path, 'layout.ts'))}`,
    `import * as rich${index} from ${JSON.stringify(join(source.path, 'rich-inline.ts'))}`,
  ]),
  `await runBrowser([${sources.map((source, index) => `createVariant(${JSON.stringify(source.name)},api${index},rich${index})`).join(',')}])`,
].join('\n'))
const build = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'esm', outdir: join(output, 'bundle') })
if (!build.success) throw new Error(build.logs.map(String).join('\n'))
const bundle = build.outputs.find(file => file.kind === 'entry-point')
if (bundle === undefined) throw new Error('Browser bundle missing')
const suiteFiles = await fingerprint(harness, path => !path.endsWith('.md') && !path.endsWith('.test.ts'))
const suiteHash = hash(JSON.stringify(suiteFiles))
const snapshots = createSnapshots()
const manifest = {
  createdAt: new Date().toISOString(), suiteHash, suiteFiles, bundleHash: hash(await readFile(bundle.path)), bunVersion: Bun.version, schedule, browsers, directions,
  family: value('family') ?? null, caseId: value('case') ?? null,
  numericEnabled: !args.includes('--skip-numeric'), strict: args.includes('--strict'),
  sources, preserve, transport,
}
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

// Web font bytes are served locally; installed faces retain their native loading mode.
const fontDirectory = join(harness, 'tests/wrapping/fonts')
const fontMetadata = await Bun.file(join(fontDirectory, 'fonts.json')).json() as Array<{ family: string; weight: string; file: string; sha256: string }>
const fonts: FontFixture[] = []
for (const font of fontMetadata) {
  const bytes = await readFile(join(fontDirectory, font.file))
  if (hash(bytes) !== font.sha256) throw new Error(`Font fixture changed: ${font.file}`)
  fonts.push({ family: font.family, weight: font.weight, url: `/fonts/${font.file}`, sha256: font.sha256 })
}

type NumericResult = {
  rows: Array<{
    recipe: string; size: number; letterSpacing: number
    failures: Array<{ contract: string; detail: string; width: number | 'unbounded' }>
    passedContracts: Array<{ contract: string; width: number | 'unbounded' }>
  }>
  tabSizing: unknown
}
let failed = false
const numericSummary = []
if (!args.includes('--skip-numeric')) {
  for (const profile of ['chrome', 'safari', 'firefox', 'crios', 'crios-desktop', 'fxios', 'edgios', 'unknown', 'none']) {
    const reports: Array<{ name: string; report: NumericResult }> = []
    for (const source of sources) {
      const file = join(output, `numeric-${profile}-${source.name}.json`)
      execFileSync(process.execPath, [join(harness, 'tests/wrapping/numeric.ts'), `--source=${source.path}`, `--profile=${profile}`, `--output=${file}`], { cwd: root, stdio: 'pipe', timeout })
      const report = await Bun.file(file).json() as NumericResult
      reports.push({ name: source.name, report })
    }
    for (const { name, report } of reports) {
      const comparisons = []
      for (const reference of reports.filter(value => preserve.includes(value.name) && value.name !== name)) {
        let newFailures = 0
        let previouslyUnobserved = 0
        if (report.rows.length !== reference.report.rows.length) throw new Error(`Numeric input count changed: ${name}/${profile}`)
        for (let i = 0; i < report.rows.length; i++) {
          const current = report.rows[i]!, previous = reference.report.rows[i]!
          if (current.recipe !== previous.recipe || current.size !== previous.size || current.letterSpacing !== previous.letterSpacing) throw new Error('Numeric input ordering changed')
          for (const failure of current.failures) {
            if (previous.passedContracts.some(old => old.contract === failure.contract && old.width === failure.width)) newFailures++
            else if (!previous.failures.some(old => old.contract === failure.contract && old.width === failure.width)) previouslyUnobserved++
          }
        }
        const unverifiedProfile = !['chrome', 'safari', 'firefox'].includes(profile)
        const tabBehaviorChanged = unverifiedProfile && JSON.stringify(report.tabSizing) !== JSON.stringify(reference.report.tabSizing)
        if (!preserve.includes(name)) failed ||= newFailures > 0 || tabBehaviorChanged
        comparisons.push({ baseline: reference.name, newFailures, previouslyUnobserved, tabBehaviorChanged })
      }
      numericSummary.push({ profile, name, preparations: report.rows.length, knownFailures: report.rows.reduce((count, row) => count + row.failures.length, 0), comparisons })
    }
  }
  await writeFile(join(output, 'numeric-summary.json'), JSON.stringify(numericSummary, null, 2) + '\n')
  console.log(`Numeric API checks: ${numericSummary.length} source/profile runs; ${numericSummary.reduce((count, row) => count + row.comparisons.reduce((n, pair) => n + pair.newFailures, 0), 0)} new failures`)
}
let observedRows = 0
for (const browser of browsers) for (const direction of directions) {
  let page: ReturnType<typeof createWrappingTransport> | undefined
  let pageUrl: string | undefined
  const collector = createSummary(sources.map(source => source.name), preserve)
  const reports: BrowserReport[] = []
  let rowCount = 0
  const rowsFile = join(output, `${browser}-${direction}-rows.ndjson`)
  // Acquire before creating the server; every acquired resource is in the
  // same cleanup scope, including session setup failures.
  const lock = await acquireBrowserAutomationLock(browser)
  let server: ReturnType<typeof Bun.serve> | undefined
  let session: BrowserSession | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      const url = new URL(request.url)
      switch (url.pathname) {
        case '/':
          if (request.url !== pageUrl) return new Response('Inactive request', { status: 409 })
          return new Response('<!doctype html><meta charset="utf-8"><title>Pretext wrapping suite</title><script type="module" src="/runner.js"></script>', { headers: { 'content-type': 'text/html' } })
        case '/runner.js': return new Response(Bun.file(bundle.path), { headers: { 'content-type': 'text/javascript' } })
        case '/config': case '/report': case '/rows': case '/progress':
          return page === undefined ? new Response('No active request', { status: 409 }) : page.fetch(request)
        default: {
          const font = fontMetadata.find(font => url.pathname === `/fonts/${font.file}`)
          return font === undefined ? new Response('Not found', { status: 404 }) : new Response(Bun.file(join(fontDirectory, font.file)))
        }
      }
    } })
    session = await createOracleSession(browser, transport)
    console.log(`Running ${browser}/${direction}, ${schedule}; ${sources.map(source => source.name).join(', ')}`)
    // Fixture fonts must not override maintained installed-font fallbacks.
    // Generic Canvas fonts also inherit the document language at resolution.
    const contexts: BrowserContext[] = [{ kind: 'fixtures' }]
    for (const context of contexts) {
      const config: BrowserConfig = { requestId: randomUUID(), context, browser, schedule, direction, family: value('family') ?? null, caseId: value('case') ?? null, fonts }
      const label = context.kind === 'fixtures' ? 'fixtures' : context.lang
      const before = rowCount
      pageUrl = `http://127.0.0.1:${server.port}/?request=${config.requestId}`
      page = createWrappingTransport(config, pageUrl, async batch => {
        await appendFile(rowsFile, batch.map(row => JSON.stringify(row)).join('\n') + '\n')
        const compact: CompactRow[] = batch.map(row => ({
          input: { id: row.input.id, family: row.input.family, scope: row.input.scope, ...(row.input.required === undefined ? {} : { required: row.input.required }) },
          predictions: row.predictions.map(result => 'error' in result ? { name: result.name, error: result.error } : {
            name: result.name, assessment: result.assessment,
            ...(result.prediction.detail === 'full' ? {
              contracts: result.prediction.contracts.map(failure => failure.contract),
              passedContracts: result.prediction.passedContracts,
            } : {}),
          }),
        }))
        collector.addRows(compact)
        if (snapshot) snapshots.addRows(browser, batch)
        rowCount += batch.length
      }, progress => {
        if (progress.completed % 1024 === 0 || progress.completed === progress.total) console.log(`${browser}/${direction}/${label}: ${progress.completed}/${progress.total}`)
      })
      await session.navigate(pageUrl)
      const completion = await Promise.race([page.completed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out after ${timeout}ms; last progress is above`)), timeout) })])
      clearTimeout(timer)
      timer = undefined
      const report = completion.report
      const reportFile = join(output, `${browser}-${direction}-${label}.json`)
      const record = { ...report, requestId: completion.requestId, url: completion.url, suiteHash, sourceManifest: 'manifest.json', rowsFile: `${browser}-${direction}-rows.ndjson` }
      // Persist page failures and their environment before another automation
      // call can fail or the browser session is closed.
      await writeFile(reportFile, JSON.stringify(record) + '\n')
      if (report.status === 'error') throw new Error(report.message)
      const observedUrl = await session.readLocationUrl()
      await writeFile(reportFile, JSON.stringify({ ...record, observedUrl }) + '\n')
      if (observedUrl !== pageUrl) throw new Error(`Browser left the requested wrapping page: expected ${pageUrl}, observed ${observedUrl}`)
      const measurement = parseBrowserEnvironmentReport(report.environment.measurement)
      report.environment.measurement = measurement
      const invalidEnvironment = environmentFailure(measurement, 'correctness')
      if (invalidEnvironment !== null) throw new Error(invalidEnvironment)
      if (rowCount - before !== report.rowCount) throw new Error(`Incomplete ${label} report: ${rowCount - before}/${report.rowCount} rows received`)
      if (reports.length === 0) {
        const actual = report.environment.measurement.end
        console.log(`${browser}/${direction}: DPR ${actual.dpr}; screen ${actual.screenWidth}×${actual.screenHeight}; viewport ${actual.innerWidth}×${actual.innerHeight}; window at ${actual.screenX},${actual.screenY}`)
      }
      reports.push(report)
      if (context.kind === 'fixtures') contexts.push(...report.contexts)
      if (snapshot && report.rowCount > 0) snapshots.addEnvironment(browser, direction, report.environment)
    }
    const richContracts = reports.flatMap(report => report.richContracts)
    await writeFile(join(output, `${browser}-${direction}.json`), JSON.stringify({
      status: 'ready', rowCount, suiteHash, sourceManifest: 'manifest.json', rowsFile: `${browser}-${direction}-rows.ndjson`,
      contexts: reports.map(({ rowCount, environment }) => ({ rowCount, environment })), richContracts,
    }) + '\n')
    if (rowCount === 0) {
      console.log(`${browser}/${direction}: no matching cases; this direction was not tested`)
      continue
    }
    observedRows += rowCount
    const summary = collector.finish(richContracts)
    printSummary(summary)
    const regressions = regressionCount(summary, preserve)
    const errors = summary.totals.reduce((sum, total) => sum + total.errors, 0)
    const strictFailures = args.includes('--strict') ? summary.totals.filter(total => !preserve.includes(total.name)).reduce((sum, total) => sum + Object.values(total.supported).reduce((count, metric) => count + metric.fail, 0) + total.research.api.fail + total.richFailures.length, 0) : 0
    const requiredFailures = summary.totals.filter(total => !preserve.includes(total.name)).reduce((sum, total) => sum + total.requiredFailures.length, 0)
    failed ||= regressions > 0 || errors > 0 || strictFailures > 0 || requiredFailures > 0
    await writeFile(join(output, `${browser}-${direction}-summary.json`), JSON.stringify({ ...summary, regressions, errors, strictFailures, requiredFailures }, null, 2) + '\n')
    console.log(`${browser}/${direction}: ${regressions} new regressions, ${requiredFailures} failed required checks, ${errors} execution errors; report ${join(output, `${browser}-${direction}.json`)}`)
  } catch (error) {
    await writeFile(join(output, `${browser}-${direction}-failure.json`), JSON.stringify({
      status: 'error', message: error instanceof Error ? error.stack ?? error.message : String(error),
      expectedUrl: pageUrl ?? null, receivedRows: rowCount, suiteHash, sourceManifest: 'manifest.json',
    }, null, 2) + '\n')
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    try {
      await session?.close()
    } finally {
      try { await server?.stop() } finally { lock.release() }
    }
  }
}
if (observedRows === 0) throw new Error('No cases matched the requested browser, family, case ID, and schedule')
console.log(`Suite ${suiteHash}; sources and reports: ${output}`)
if (snapshot && !failed) await snapshots.write(root, { suiteHash, source: sources.find(source => source.name === 'current')!, output })
if (failed) process.exitCode = 1
