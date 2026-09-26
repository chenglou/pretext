// bun harness <command> [--browser=chrome|firefox|webkit-host|safari|all] [--cases=<file.ndjson>]
//   record [--only-new]      record the browser's layout of every case (or the new ones), sorted and shuffled, in fresh short documents;
//                            --sample=N --seed=S records N of them, drawn from every set
//   check [--accept=<why>]   predict every pinned case in the browser and score it against the recordings
//   gate [--sample=N]        check, plus a prediction in reverse order, N cases recorded again, and attribution
// record and gate draw with --seed=S (default 20260924).
//   equal <ref>              whether this tree's src/ and <ref>'s predict the same lines for every case
//   explain <id>             one case's recorded lines against the predicted ones, character by character
// --lib=<dir> predicts with another build's src/ directory. Default browsers: chrome, firefox and webkit-host, side by side;
// explain takes one, chrome by default.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  accept, attribute, checkBlocks, freshRecordings, gateBlocks, gateSample, headline, judge, observable, outsideClaims, pinning, predictionChange, reverseOrder, score, SEED,
  shown, shrinkWrapShort, widthBand, type Outcome,
} from './score.ts'
import { LIB, runJob, type Job, type JobResult, type Mode } from './run.ts'
import { createRng } from './sets/build.ts'
import {
  acceptedPath, assertSameEnvironment, caseText, historyPath, readAccepted, readCases, readHistory, readRecordings, readVarying, recordingText,
  recordingsPath, splitHistory, varyingPath, writeAccepted, writeHistory, writeRecordings, type Accepted, type Varying,
} from './store.ts'
import { BROWSERS, type BrowserKind, type Case, type Prediction, type Recording } from './types.ts'

// A document holds this many cases while recording, so each case sees a short page history.
const RECORD_DOCUMENT = 200
const ALONE = 1
const WHOLE = Number.MAX_SAFE_INTEGER
const ATTRIBUTE_AT_MOST = 200

// What the flags ask for. `sample`: --sample's count, or null. `partial`: the run covers some case files only (--cases),
// so it leaves the other cases' entries alone.
export type Options = { lib: string; seed: number; sample: number | null; accept: string; partial: boolean; onlyNew: boolean }
export type Args = { command: string | undefined; positional: string[]; browsers: BrowserKind[]; cases: string | null; options: Options }

export function parseArgs(args: readonly string[]): Args {
  const flags = new Map<string, string>()
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(args[i]!)
    if (match === null) positional.push(args[i]!)
    else flags.set(match[1]!, match[2] ?? '')
  }
  const command = positional[0]
  const browserFlag = flags.get('browser') ?? (command === 'explain' ? 'chrome' : 'all')
  const browsers: BrowserKind[] = browserFlag === 'all' ? ['chrome', 'firefox', 'webkit-host'] : browserFlag.split(',') as BrowserKind[]
  for (let i = 0; i < browsers.length; i++) if (!BROWSERS.includes(browsers[i]!)) throw new Error(`Unknown browser ${browsers[i]}`)
  const options: Options = {
    lib: resolve(flags.get('lib') ?? LIB), seed: Number(flags.get('seed') ?? SEED), sample: flags.has('sample') ? Number(flags.get('sample')) : null,
    accept: flags.get('accept') ?? '', partial: flags.has('cases'), onlyNew: flags.has('only-new'),
  }
  return { command, positional, browsers, cases: flags.get('cases') ?? null, options }
}

// Where a command reads and writes the harness's files, how it runs a job in a browser, and where it prints. The tests
// give it a folder of their own and a stand-in browser.
export type Io = { root: string; run: <T extends Recording | Prediction>(job: Job) => Promise<JobResult<T>>; log: (text: string) => void }

function loadCases(files: readonly string[]): Case[] {
  const cases: Case[] = []
  const ids = new Set<string>()
  for (let f = 0; f < files.length; f++) {
    const list = readCases(files[f]!)
    for (let i = 0; i < list.length; i++) {
      if (ids.has(list[i]!.id)) throw new Error(`${files[f]}: duplicate case ${list[i]!.id}`)
      ids.add(list[i]!.id)
      cases.push(list[i]!)
    }
  }
  return cases
}

// webkit-host runs installed Safari's engine, so it takes Safari's cases.
function applies(c: Case, browser: BrowserKind): boolean {
  return c.browsers === undefined || c.browsers.includes(browser) || (browser === 'webkit-host' && c.browsers.includes('safari'))
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '-' : `${(100 * part / whole).toFixed(2)}%`
}

function describe(c: Case, outcome: Outcome): string {
  return `${c.id}  ${c.family}  ${widthBand(c)}  ${outcome.status}${outcome.line >= 0 ? ` at line ${outcome.line}` : ''}: ${outcome.detail}`
}

// A 32-bit LCG's `state % n` picked the first fifth of the sorted ids twice as often as the rest.
function shuffled<T>(list: T[], seed: number): T[] {
  const out = list.slice()
  const rng = createRng(String(seed))
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    const swap = out[i]!
    out[i] = out[j]!
    out[j] = swap
  }
  return out
}

// ---- record ----

export async function record(browser: BrowserKind, cases: Case[], o: Options, io: Io): Promise<void> {
  const old = readRecordings(recordingsPath(io.root, browser))
  const oldHistory = readHistory(historyPath(io.root, browser))
  let list = cases.filter(c => applies(c, browser))
  if (o.onlyNew) list = list.filter(c => old?.recordings.has(c.id) !== true && oldHistory?.cases.has(c.id) !== true)
  let sorted = list.slice().sort((a, b) => (a.id < b.id ? -1 : 1))
  // A seeded sample of every set, for installed Safari, whose window has to stay uncovered while it records.
  if (o.sample !== null) sorted = shuffled(sorted, o.seed).slice(0, o.sample).sort((a, b) => (a.id < b.id ? -1 : 1))
  // One browser instance at a time per browser. The second order is shuffled, so each case sits among other cases in
  // other documents, as in the gate's fresh recording.
  const a = await io.run<Recording>({ browser, mode: 'record', cases: sorted, documentSize: RECORD_DOCUMENT, lib: o.lib })
  const b = await io.run<Recording>({ browser, mode: 'record', cases: shuffled(sorted, o.seed + 1), documentSize: RECORD_DOCUMENT, lib: o.lib })
  if (a.env !== b.env) throw new Error(`The environment changed between the two recordings: ${a.env} | ${b.env}`)
  // Recording some cases (--only-new, --cases, --sample) keeps the other recordings, which must share the environment.
  const merge = (o.onlyNew || o.partial || o.sample !== null) && old !== null
  if (merge && old.env !== a.env) throw new Error(`${browser}: the other recordings were made under ${old.env}; record every case`)
  const sameEnv = old !== null && old.env === a.env
  const prior = sameEnv ? { recordings: new Map(old.recordings), history: new Map(oldHistory?.cases ?? []) } : null
  const recordings = merge ? old.recordings : new Map<string, Recording>()
  const history = merge ? oldHistory?.cases ?? new Map<string, [Recording, Recording]>() : new Map<string, [Recording, Recording]>()
  const moved = splitHistory(sorted.map(c => c.id), a.results, b.results, recordings, history, prior)
  mkdirSync(join(io.root, 'recordings'), { recursive: true })
  writeRecordings(recordingsPath(io.root, browser), { env: a.env, recordings })
  writeHistory(historyPath(io.root, browser), { env: a.env, cases: history })
  io.log(`${browser}: recorded ${sorted.length} cases in sorted and shuffled (seed ${o.seed + 1}) order, ${((a.ms + b.ms) / 2000).toFixed(0)} s each; ${history.size} with page history; ${a.env}`)
  if (sameEnv) io.log(`${browser}: ${moved} cases laid out differently from the stored recordings of this environment, now page history`)
  // What the browser changed since the last recording, by family and width band.
  if (old !== null && !sameEnv) {
    const changed = new Map<string, number>()
    const byId = new Map(sorted.map(c => [c.id, c]))
    let count = 0
    for (const [id, now] of recordings) {
      const before = old.recordings.get(id)
      if (before === undefined || recordingText(before) === recordingText(now)) continue
      const c = byId.get(id)!
      const key = `${c.family}  ${widthBand(c)}`
      changed.set(key, (changed.get(key) ?? 0) + 1)
      count++
    }
    io.log(`${browser}: ${count} recordings changed since ${old.env}`)
    const rows = [...changed].sort((x, y) => y[1] - x[1])
    for (let i = 0; i < rows.length && i < 30; i++) io.log(`  ${rows[i]![1]}  ${rows[i]![0]}`)
  }
}

// ---- check and gate ----

type Scored = {
  browser: BrowserKind
  env: string
  pinned: Case[]
  // Every case this browser takes, the pinned ones first.
  predicted: Case[]
  varying: Varying
  accepted: Accepted
  recordings: Map<string, Recording>
  history: Map<string, [Recording, Recording]>
  predictions: Map<string, Prediction>
  outcomes: Map<string, Outcome>
  newFailures: Case[]
  blocked: boolean
}

export async function check(browser: BrowserKind, cases: Case[], o: Options, io: Io): Promise<Scored> {
  const recorded = readRecordings(recordingsPath(io.root, browser))
  if (recorded === null) throw new Error(`${browser}: no recordings; run record first`)
  const history = readHistory(historyPath(io.root, browser))?.cases ?? new Map<string, [Recording, Recording]>()
  const path = acceptedPath(io.root, browser)
  const accepted = readAccepted(path)
  const varying = readVarying(varyingPath(io.root, browser))
  const mine = cases.filter(c => applies(c, browser))
  const ids = new Set<string>()
  for (let i = 0; i < mine.length; i++) ids.add(mine[i]!.id)
  const plan = pinning(browser, mine, recorded.recordings, history)
  const pinned = plan.pinned
  const job = await io.run<Prediction>({ browser, mode: 'predict', cases: plan.predicted, documentSize: WHOLE, lib: o.lib })
  if (pinned.length > 0) assertSameEnvironment(browser, recorded.env, job.env)
  const counts = { pass: 0, count: 0, breaks: 0, error: 0 }
  const outcomes = new Map<string, Outcome>()
  const byId = new Map<string, Case>()
  const draws: Array<{ group: string; weight: number; pass: boolean }> = []
  const drawsInClaims: Array<{ group: string; weight: number; pass: boolean }> = []
  let sampleWeight = 0
  let standInWeight = 0
  let outsideWeight = 0
  // Per set of the behaviour catalog (catalog, facts, rich): whether each behaviour passes at every width away from the
  // edges where its lines change, and at the edges.
  const behaviours = new Map<string, Map<string, { inside: boolean; edges: boolean }>>()
  let shortBubbles = 0
  let calls = 0
  let units = 0
  for (let i = 0; i < pinned.length; i++) {
    const c = pinned[i]!
    byId.set(c.id, c)
    const recording = recorded.recordings.get(c.id)!
    const prediction = job.results.get(c.id)!
    const outcome = score(recording, prediction)
    outcomes.set(c.id, outcome)
    counts[outcome.status]++
    if ('lines' in prediction) {
      calls += prediction.prepareCalls
      units += caseText(c).length
    }
    if (c.sample !== undefined) {
      const draw = { group: c.sample.group, weight: c.sample.weight, pass: outcome.status === 'pass' }
      draws.push(draw)
      sampleWeight += c.sample.weight
      if (c.sample.standIn === true) standInWeight += c.sample.weight
      if (outsideClaims(c, prediction)) outsideWeight += c.sample.weight
      else drawsInClaims.push(draw)
    }
    if (c.behaviour !== undefined) {
      const set = c.family.split('/')[0]!
      let list = behaviours.get(set)
      if (list === undefined) behaviours.set(set, list = new Map())
      const entry = list.get(c.behaviour) ?? { inside: true, edges: true }
      if (c.edge === true) entry.edges &&= outcome.status === 'pass'
      else entry.inside &&= outcome.status === 'pass'
      list.set(c.behaviour, entry)
    }
    if (outcome.status === 'pass' && shrinkWrapShort(recording, prediction)) shortBubbles++
  }
  const verdict = judge(outcomes, accepted, varying, ids, o.partial)
  const updated = o.accept !== ''
  if (updated) {
    mkdirSync(join(io.root, 'accepted'), { recursive: true })
    writeAccepted(path, accept(outcomes, accepted, o.accept, varying, ids, o.partial))
    io.log(`${browser}: accepted ${verdict.newFailures.length} new failures as "${o.accept}", dropped ${verdict.fixed.length} entries`)
  }

  const out: string[] = []
  out.push(`${browser}: ${pinned.length} pinned cases predicted in ${(job.ms / 1000).toFixed(1)} s, with ${plan.predicted.length - pinned.length} others whose line APIs are checked too`)
  out.push(`  pass ${counts.pass} | wrong line count ${counts.count} | right count, wrong breaks ${counts.breaks} | error ${counts.error}`)
  out.push(`  not pinned: ${plan.history} page history, ${plan.unobservable} with nothing visible or unrecordable, ${plan.unrecorded.length} not recorded`)
  let runs = 0
  for (const entry of varying.values()) if (entry.kind === 'runs') runs++
  if (varying.size > 0) out.push(`  varying (harness/varying): ${runs} that vary between runs, predicted but not judged (${verdict.varying.pass} pass, ${verdict.varying.fail} fail); ${varying.size - runs} that move with what was predicted before, judged, and skipped by the gate's reverse-order check`)
  const head = headline(draws)
  const inClaims = headline(drawsInClaims)
  if (head !== null) out.push(`  real-usage sample: ${(100 * head.share).toFixed(2)}% of real paragraphs right, 95% interval ${(100 * head.low).toFixed(2)}-${(100 * head.high).toFixed(2)}% (${draws.length} draws, ${percent(standInWeight, sampleWeight)} of their weight stand-ins; macOS rendering only)`)
  if (inClaims !== null && outsideWeight > 0) out.push(`    ${percent(outsideWeight, sampleWeight)} of the weight is outside what Pretext claims (break-all, rich-inline in pre-wrap, system-ui); ${(100 * inClaims.share).toFixed(2)}% right without it, 95% interval ${(100 * inClaims.low).toFixed(2)}-${(100 * inClaims.high).toFixed(2)}%`)
  for (const [set, list] of [...behaviours].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    let modelled = 0
    let exact = 0
    for (const entry of list.values()) {
      if (entry.inside) modelled++
      if (entry.inside && entry.edges) exact++
    }
    out.push(`  ${set}: ${modelled} of ${list.size} behaviours modelled, ${exact} of them also 1/64 px either side of where the lines change`)
  }
  const reasons = [...verdict.byReason].sort((x, y) => y[1].length - x[1].length)
  for (let i = 0; i < reasons.length; i++) {
    const [reason, list] = reasons[i]!
    let weight = 0
    for (let k = 0; k < list.length; k++) weight += byId.get(list[k]!)!.sample?.weight ?? 0
    out.push(`  accepted ${list.length}${sampleWeight > 0 ? ` (${percent(weight, sampleWeight)} of real paragraphs)` : ''}: ${reason}`)
  }
  if (verdict.changed.length > 0) out.push(`  ${verdict.changed.length} accepted failures changed kind (not blocking): ${shown(verdict.changed)}`)
  out.push(`  shrink-wrap, report only: ${shortBubbles} passing cases predict a widest line narrower than the browser's`)
  out.push(`  Canvas: ${units === 0 ? '-' : (1000 * calls / units).toFixed(1)} measureText calls per 1,000 units while preparing`)
  const blocks = checkBlocks(browser, job.results, plan.unrecorded, verdict, updated, id => describe(byId.get(id)!, outcomes.get(id)!))
  for (let i = 0; i < blocks.length; i++) out.push(`  ${blocks[i]}`)
  io.log(out.join('\n'))
  const newFailures: Case[] = []
  for (let i = 0; !updated && i < verdict.newFailures.length; i++) newFailures.push(byId.get(verdict.newFailures[i]!)!)
  return {
    browser, env: recorded.env, pinned, predicted: plan.predicted, varying, accepted, recordings: recorded.recordings, history, predictions: job.results, outcomes, newFailures,
    blocked: blocks.length > 0,
  }
}

export async function gate(browser: BrowserKind, cases: Case[], o: Options, io: Io): Promise<boolean> {
  const job = <T extends Recording | Prediction>(mode: Mode, list: Case[], documentSize: number): Promise<Map<string, T>> =>
    io.run<T>({ browser, mode, cases: list, documentSize, lib: o.lib }).then(result => result.results)
  const scored = await check(browser, cases, o, io)
  const ids = scored.pinned.map(c => c.id)
  const out: string[] = []
  // The same predictions in reverse order, the pinned cases first: moved breaks mean results depend on what was
  // prepared before. Widths alone move with Chrome's per-canvas shape caches and Firefox's kept contexts
  // (PLATFORM_BUGS.md), before #340 too; they only reach the shrink-wrap check, which reports. A case whose breaks the
  // browser's state moves is listed in harness/varying.
  const others = scored.predicted.slice(scored.pinned.length)
  const reverse = await job<Prediction>('predict', scored.pinned.slice().reverse().concat(others.reverse()), WHOLE)
  const order = reverseOrder(ids, scored.predictions, reverse, scored.varying)
  if (order.widths.length > 0) out.push(`  ${order.widths.length} predictions change only their line widths in reverse order (report only): ${shown(order.widths)}`)
  if (order.listed.length > 0) out.push(`  ${order.listed.length} varying predictions break differently in reverse order (listed, not blocking)`)
  // A fresh recording of a seeded sample, then each case that differs alone, in forward and in reverse order: blocks
  // where the browser lays it out differently from the recording every time.
  const sample = gateSample(scored.pinned, o.seed, o.sample ?? 1000)
  const first = await io.run<Recording>({ browser, mode: 'record', cases: sample, documentSize: RECORD_DOCUMENT, lib: o.lib })
  if (sample.length > 0) assertSameEnvironment(browser, scored.env, first.env)
  const attempts = [first.results]
  const differ = sample.filter(c => recordingText(first.results.get(c.id)!) !== recordingText(scored.recordings.get(c.id)!))
  if (differ.length > 0) {
    attempts.push(await job<Recording>('record', differ, ALONE))
    attempts.push(await job<Recording>('record', differ.slice().reverse(), ALONE))
  }
  const fresh = freshRecordings(sample.map(c => c.id), scored.recordings, attempts)
  out.push(`  ${sample.length} cases recorded again (seed ${o.seed}): ${differ.length} differ from the recordings, ${fresh.history.length} of them laid out as recorded when alone`)
  // Those depend on the cases before them: page history the recordings missed, which goes on the page-history list as
  // record would put it, so check stops pinning them. An accepted entry of one leaves the list in the same write, since
  // the next check would block on an accepted case no longer pinned.
  if (fresh.history.length > 0) {
    splitHistory(fresh.history, first.results, first.results, scored.recordings, scored.history, { recordings: new Map(scored.recordings), history: new Map(scored.history) })
    writeRecordings(recordingsPath(io.root, browser), { env: scored.env, recordings: scored.recordings })
    writeHistory(historyPath(io.root, browser), { env: scored.env, cases: scored.history })
    const unaccepted = fresh.history.filter(id => scored.accepted.delete(id))
    if (unaccepted.length > 0) writeAccepted(acceptedPath(io.root, browser), scored.accepted)
    out.push(`  ${fresh.history.length} moved to recordings/${browser}.history.txt as page history, ${unaccepted.length} of them off accepted/${browser}.txt (not blocking; commit it): ${shown(fresh.history)}`)
  }
  const blocks = gateBlocks(order, reverse, fresh)
  for (let i = 0; i < blocks.length; i++) out.push(`  ${blocks[i]}`)
  // Each new failure recorded alone, and predicted alone twice, each in a fresh document of its own.
  const failures = scored.newFailures.slice(0, ATTRIBUTE_AT_MOST)
  if (scored.newFailures.length > ATTRIBUTE_AT_MOST) out.push(`  ${scored.newFailures.length} new failures; attributing the first ${ATTRIBUTE_AT_MOST} (more than that usually means the change is wrong)`)
  if (failures.length > 0) {
    const alone = await job<Recording>('record', failures, ALONE)
    const predicted = [await job<Prediction>('predict', failures, ALONE), await job<Prediction>('predict', failures, ALONE)] as const
    out.push(`  attribution of ${failures.length} new failures (a prediction that moves may be the library's caches or the browser's Canvas state; the browser's go in harness/varying with a reason)`)
    for (let i = 0; i < failures.length; i++) {
      const c = failures[i]!
      const verdict = attribute(scored.recordings.get(c.id)!, alone.get(c.id)!, scored.predictions.get(c.id)!, [predicted[0].get(c.id)!, predicted[1].get(c.id)!])
      out.push(`    ${verdict}  ${describe(c, scored.outcomes.get(c.id)!)}`)
    }
  }
  io.log(`${browser} gate:\n${out.join('\n')}`)
  return scored.blocked || blocks.length > 0
}

// ---- equal and explain ----

async function equal(browser: BrowserKind, cases: Case[], ref: string, lib: string): Promise<boolean> {
  const sha = execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim()
  const dir = resolve(import.meta.dir, `../.artifacts/harness-equal/${sha}`)
  mkdirSync(dir, { recursive: true })
  execFileSync('sh', ['-c', `git archive ${sha} src | tar -x -C "${dir}"`])
  const list = cases.filter(c => applies(c, browser))
  const mine = await runJob<Prediction>({ browser, mode: 'predict', cases: list, documentSize: WHOLE, lib })
  const theirs = await runJob<Prediction>({ browser, mode: 'predict', cases: list, documentSize: WHOLE, lib: join(dir, 'src') })
  const differ = list.filter(c => predictionChange(mine.results.get(c.id)!, theirs.results.get(c.id)!) !== 'same')
  let callsMine = 0
  let callsTheirs = 0
  for (let i = 0; i < list.length; i++) {
    const a = mine.results.get(list[i]!.id)!
    const b = theirs.results.get(list[i]!.id)!
    if ('lines' in a) callsMine += a.prepareCalls + a.lineCalls
    if ('lines' in b) callsTheirs += b.prepareCalls + b.lineCalls
  }
  console.log(`${browser}: ${differ.length} of ${list.length} predictions differ from ${ref} (${sha.slice(0, 10)}); measureText calls ${callsMine} here, ${callsTheirs} there`)
  for (let i = 0; i < differ.length && i < 20; i++) console.log(`  ${differ[i]!.id}  ${differ[i]!.family}`)
  return differ.length > 0
}

async function explain(browser: BrowserKind, cases: Case[], id: string, lib: string): Promise<void> {
  const c = cases.find(x => x.id === id)
  if (c === undefined) throw new Error(`No case ${id}`)
  const recording = readRecordings(recordingsPath(import.meta.dir, browser))?.recordings.get(id) ?? readHistory(historyPath(import.meta.dir, browser))?.cases.get(id)?.[0]
  if (recording === undefined) throw new Error(`${browser} has no recording of ${id}`)
  if ('error' in recording) throw new Error(`${browser} couldn't record ${id}: ${recording.error}`)
  const job = await runJob<Prediction>({ browser, mode: 'predict', cases: [c], documentSize: ALONE, lib })
  const prediction = job.results.get(id)!
  const p = c.paragraph
  const text = caseText(c)
  console.log(`${id}  ${c.family}  ${browser}  width ${p.width}  ${p.runs.length} runs, first font ${p.runs[0]!.font.size}px ${p.runs[0]!.font.family}  ${p.whiteSpace} ${p.wordBreak} ${p.direction} lang ${p.lang}`)
  if (!('lines' in prediction)) {
    console.log('unsupported' in prediction ? `unsupported: ${prediction.unsupported}` : `prediction error: ${prediction.error}`)
    return
  }
  if (prediction.disagreement !== null) console.log(`another line API disagrees with the walk: ${prediction.disagreement}`)
  const outcome = observable(recording) ? score(recording, prediction) : { status: 'nothing visible', line: -1, detail: '' }
  console.log(`native ${recording.lines.length} lines, predicted ${prediction.lines.length}: ${outcome.status}${outcome.line >= 0 ? ` at line ${outcome.line}` : ''} ${outcome.detail}`)
  const show = (from: number, to: number): string => JSON.stringify(text.slice(from, to)).slice(1, -1)
  for (let i = 0; i < Math.max(recording.lines.length, prediction.lines.length); i++) {
    const native = recording.lines[i]
    const predicted = prediction.lines[i]
    const nativeText = native === undefined ? '' : native.first < 0 ? '(nothing visible)' : `${native.first}-${native.last} "${show(native.first, native.last + (text.codePointAt(native.last)! > 0xffff ? 2 : 1))}"`
    const predictedText = predicted === undefined ? '' : `${predicted.start}-${predicted.end} "${show(predicted.start, predicted.end)}"`
    const mark = i === outcome.line ? '>' : ' '
    console.log(`${mark} ${String(i).padStart(3)}  native ${nativeText.padEnd(50)}  predicted ${predictedText}  widths ${native?.width ?? '-'} / ${predicted?.width ?? '-'}`)
  }
  // The text around the first differing line, with the browser's line starts (‖) and the predicted ones (|).
  const at = Math.max(0, outcome.line)
  const from = Math.min(prediction.lines[Math.max(0, at - 1)]?.start ?? 0, Math.max(0, recording.lines[Math.max(0, at - 1)]?.first ?? 0))
  const to = Math.max(prediction.lines[at + 1]?.end ?? text.length, (recording.lines[at + 1]?.last ?? text.length - 1) + 1)
  const starts = new Map<number, string>()
  for (let i = 1; i < recording.lines.length; i++) if (recording.lines[i]!.first >= 0) starts.set(recording.lines[i]!.first, '‖')
  for (let i = 1; i < prediction.lines.length; i++) starts.set(prediction.lines[i]!.start, (starts.get(prediction.lines[i]!.start) ?? '') + '|')
  let marked = ''
  for (let i = from; i < Math.min(to, text.length); i++) marked += (starts.get(i) ?? '') + text[i]
  console.log(`breaks near line ${at}, the browser's ‖ and predicted |: ${JSON.stringify(marked)}`)
}

async function main(): Promise<number> {
  const { command, positional, browsers, cases: file, options: o } = parseArgs(process.argv.slice(2))
  const dir = join(import.meta.dir, 'cases')
  const cases = loadCases(file !== null ? [file] : readdirSync(dir).filter(name => name.endsWith('.ndjson')).sort().map(name => join(dir, name)))
  const io: Io = { root: import.meta.dir, run: runJob, log: text => console.log(text) }
  switch (command) {
    case 'record':
      await Promise.all(browsers.map(b => record(b, cases, o, io)))
      return 0
    case 'check': {
      const results = await Promise.all(browsers.map(b => check(b, cases, o, io)))
      return results.some(r => r.blocked) ? 1 : 0
    }
    case 'gate': {
      const blocked = await Promise.all(browsers.map(b => gate(b, cases, o, io)))
      return blocked.some(Boolean) ? 1 : 0
    }
    case 'equal': {
      if (positional[1] === undefined) throw new Error('equal needs a git ref')
      const differ = await Promise.all(browsers.map(b => equal(b, cases, positional[1]!, o.lib)))
      return differ.some(Boolean) ? 1 : 0
    }
    case 'explain':
      if (positional[1] === undefined) throw new Error('explain needs a case id')
      await explain(browsers[0]!, cases, positional[1], o.lib)
      return 0
    default:
      console.error('Usage: bun harness record|check|gate|equal <ref>|explain <id> [--browser=...] [--cases=...] [--lib=...]')
      return 2
  }
}

if (import.meta.main) process.exit(await main())
