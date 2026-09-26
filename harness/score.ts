// The pass rule and the numbers a run prints.
//
// A case passes when the prediction has the browser's line count and each line's first and last visible character sits
// in the predicted line of that index. The predicted lines are ranges in source order, so that checks every visible
// character (observe.ts). A right count with a wrong break is a failure of its own kind, 'breaks': main before #340
// passed 4.5-8.1% of its census cases that way by accident.
import { createRng } from './sets/build.ts'
import { recordingText, type Varying } from './store.ts'
import type { BrowserKind, Case, Failure, Prediction, Recording, Status } from './types.ts'

export type Outcome = { status: Status; line: number; detail: string }

// Whether a recording can be scored at all: a recording error, or no visible character to check, can't be.
export function observable(recording: Recording): boolean {
  if ('error' in recording) return false
  for (let i = 0; i < recording.lines.length; i++) if (recording.lines[i]!.first >= 0) return true
  return false
}

// Once a document has laid out a text-presentation emoji (U+FE0E), Firefox lays color emoji out 1 px wider in the
// documents after it in the same process, in most runs, and lays out and measures the other U+FE0E cases otherwise too.
// So in Firefox such a case is page history, which check never pins, and every job lays it out in documents after all
// the others, where it can't move them (run.ts).
export function firefoxTextEmoji(browser: BrowserKind, c: Case): boolean {
  if (browser !== 'firefox') return false
  for (let i = 0; i < c.paragraph.runs.length; i++) if (c.paragraph.runs[i]!.text.includes('\uFE0E')) return true
  return false
}

// Installed Safari is recorded on a sample (its window must stay uncovered), so cases it has no recording of are expected.
export const SAMPLED: readonly BrowserKind[] = ['safari']

// Which of a browser's cases check pins, and which it predicts. A case is pinned when its recording shows a visible
// character and every recording of it agrees; page history (with Firefox's U+FE0E cases), cases with nothing visible
// and cases with no recording aren't. Every case is predicted, the pinned ones first, since the line APIs' agreement
// needs no recording.
export type Pinning = { pinned: Case[]; predicted: Case[]; history: number; unobservable: number; unrecorded: string[] }

export function pinning(browser: BrowserKind, cases: readonly Case[], recordings: ReadonlyMap<string, Recording>, history: ReadonlyMap<string, unknown>): Pinning {
  const out: Pinning = { pinned: [], predicted: [], history: 0, unobservable: 0, unrecorded: [] }
  const others: Case[] = []
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!
    const recording = recordings.get(c.id)
    if (history.has(c.id) || firefoxTextEmoji(browser, c)) out.history++
    else if (recording === undefined) out.unrecorded.push(c.id)
    else if (!observable(recording)) out.unobservable++
    else {
      out.pinned.push(c)
      continue
    }
    others.push(c)
  }
  out.predicted = out.pinned.concat(others)
  return out
}

export function score(recording: Recording, prediction: Prediction): Outcome {
  if ('error' in recording) throw new Error('A recording error has no score')
  if ('unsupported' in prediction) return { status: 'error', line: -1, detail: `unsupported: ${prediction.unsupported}` }
  if ('error' in prediction) return { status: 'error', line: -1, detail: prediction.error }
  const native = recording.lines
  const predicted = prediction.lines
  if (native.length !== predicted.length) {
    let line = 0
    while (line < native.length && line < predicted.length && (native[line]!.first < 0 || (inLine(native[line]!.first, predicted[line]!) && inLine(native[line]!.last, predicted[line]!)))) line++
    return { status: 'count', line, detail: `native ${native.length} lines, predicted ${predicted.length}` }
  }
  for (let line = 0; line < native.length; line++) {
    const { first, last } = native[line]!
    if (first < 0) continue
    const range = predicted[line]!
    if (!inLine(first, range)) return { status: 'breaks', line, detail: `native line ${line} starts at ${first}, predicted line holds ${range.start}-${range.end}` }
    if (!inLine(last, range)) return { status: 'breaks', line, detail: `native line ${line} ends at ${last}, predicted line holds ${range.start}-${range.end}` }
  }
  return { status: 'pass', line: -1, detail: '' }
}

function inLine(offset: number, range: { start: number; end: number }): boolean {
  return offset >= range.start && offset < range.end
}

// Report only, for now: a chat bubble sized to the predicted widest line, rounded up (pages/demos/bubbles-shared.ts),
// must be at least as wide as the browser's widest line, or the browser wraps the text again.
export function shrinkWrapShort(recording: Recording, prediction: Prediction): boolean {
  if ('error' in recording || !('lines' in prediction)) return false
  let native = 0
  let predicted = 0
  for (let i = 0; i < recording.lines.length; i++) native = Math.max(native, recording.lines[i]!.width)
  for (let i = 0; i < prediction.lines.length; i++) predicted = Math.max(predicted, prediction.lines[i]!.width)
  return Math.ceil(predicted) < native
}

// How two predictions of one case differ: 'lines' when a line holds other characters (what the pass rule judges),
// 'widths' when only line widths moved (what the report-only shrink-wrap check reads), else 'same'.
export type PredictionChange = 'same' | 'widths' | 'lines'

export function predictionChange(a: Prediction, b: Prediction): PredictionChange {
  if (!('lines' in a) || !('lines' in b)) return JSON.stringify(a) === JSON.stringify(b) ? 'same' : 'lines'
  if (a.lines.length !== b.lines.length) return 'lines'
  let change: PredictionChange = 'same'
  for (let i = 0; i < a.lines.length; i++) {
    const x = a.lines[i]!
    const y = b.lines[i]!
    if (x.start !== y.start || x.end !== y.end) return 'lines'
    if (x.width !== y.width) change = 'widths'
  }
  return change
}

// What predictions say about the library itself, whatever the browser did: the cases where another line API disagrees
// with the walk, and those whose line APIs asked Canvas anything after preparing. Both block.
export type Faults = { disagree: string[]; measuring: string[] }

export function libraryFaults(predictions: ReadonlyMap<string, Prediction>): Faults {
  const out: Faults = { disagree: [], measuring: [] }
  for (const [id, prediction] of predictions) {
    if (!('lines' in prediction)) continue
    if (prediction.disagreement !== null) out.disagree.push(`${id}: ${prediction.disagreement}`)
    if (prediction.lineCalls > 0) out.measuring.push(`${id}: ${prediction.lineCalls}`)
  }
  return out
}

// A font list the README says the library doesn't take: system-ui and its aliases resolve differently for Canvas on macOS.
export const SYSTEM_UI_FONT = /^\s*(system-ui|-apple-system|BlinkMacSystemFont|ui-sans-serif)\b/

// Whether a case is outside what the library claims: a style the adapter can't express (break-all, rich-inline in
// pre-wrap) or a system-ui font list. The headline prints its share, and the share right without it.
export function outsideClaims(c: Case, prediction: Prediction): boolean {
  return 'unsupported' in prediction || SYSTEM_UI_FONT.test(c.paragraph.font.family)
}

export function widthBand(c: Case): string {
  const width = c.paragraph.width
  return width < 24 ? '<24 px' : width < 80 ? '24-80 px' : '>=80 px'
}

// The headline: the weighted share of real-usage draws that pass, with a 95% interval from resampling the draws within
// each group (a seeded generator, so the same results print the same interval).
export function headline(draws: ReadonlyArray<{ group: string; weight: number; pass: boolean }>): { share: number; low: number; high: number } | null {
  if (draws.length === 0) return null
  const groups = new Map<string, Array<{ weight: number; pass: boolean }>>()
  for (let i = 0; i < draws.length; i++) {
    const draw = draws[i]!
    let group = groups.get(draw.group)
    if (group === undefined) groups.set(draw.group, group = [])
    group.push(draw)
  }
  const lists = [...groups.values()]
  const share = (pick: (list: Array<{ weight: number; pass: boolean }>, k: number) => { weight: number; pass: boolean }): number => {
    let right = 0
    let total = 0
    for (let g = 0; g < lists.length; g++) {
      const list = lists[g]!
      for (let k = 0; k < list.length; k++) {
        const draw = pick(list, k)
        total += draw.weight
        if (draw.pass) right += draw.weight
      }
    }
    return right / total
  }
  let seed = 0x9e3779b9
  const random = (): number => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const shares: number[] = []
  for (let r = 0; r < 1000; r++) shares.push(share(list => list[Math.floor(random() * list.length)]!))
  shares.sort((a, b) => a - b)
  return { share: share((list, k) => list[k]!), low: shares[24]!, high: shares[975]! }
}

// What the accepted-failures list makes of the pinned cases' outcomes. A failure off the list is new and blocks. An
// entry whose case passes, is no longer pinned or names no case is fixed and blocks until it leaves the list, so accepted
// losses never go silent. An accepted case that fails another way is printed, not blocked. A case that varies between
// runs (harness/varying) is never judged, only counted, and a varying entry that names no case is stale, which blocks.
// `cases`: the ids of the cases this browser takes in the run; a run over some case files only (`partial`) leaves the
// entries of other cases alone.
export type Verdict = { newFailures: string[]; fixed: string[]; changed: string[]; stale: string[]; byReason: Map<string, string[]>; varying: { pass: number; fail: number } }
type AcceptedList = ReadonlyMap<string, { reason: string; status: Failure }>

export function judge(outcomes: ReadonlyMap<string, Outcome>, accepted: AcceptedList, varying: Varying, cases: ReadonlySet<string>, partial: boolean): Verdict {
  const verdict: Verdict = { newFailures: [], fixed: [], changed: [], stale: [], byReason: new Map(), varying: { pass: 0, fail: 0 } }
  for (const [id, entry] of varying) {
    if (entry.kind === 'runs' && accepted.has(id)) throw new Error(`${id} is both an accepted failure and a prediction that varies between runs`)
    if (!partial && !cases.has(id)) verdict.stale.push(id)
  }
  for (const [id, outcome] of outcomes) {
    if (varying.get(id)?.kind === 'runs') {
      verdict.varying[outcome.status === 'pass' ? 'pass' : 'fail']++
      continue
    }
    const entry = accepted.get(id)
    if (outcome.status === 'pass') {
      if (entry !== undefined) verdict.fixed.push(id)
      continue
    }
    if (entry === undefined) {
      verdict.newFailures.push(id)
      continue
    }
    if (entry.status !== outcome.status) verdict.changed.push(`${id}: ${entry.status} -> ${outcome.status}`)
    let list = verdict.byReason.get(entry.reason)
    if (list === undefined) verdict.byReason.set(entry.reason, list = [])
    list.push(id)
  }
  for (const id of accepted.keys()) if (!outcomes.has(id) && (!partial || cases.has(id))) verdict.fixed.push(id)
  return verdict
}

// The gate's reverse-order predictions against the forward ones: the cases whose breaks move, which block unless listed
// as varying (either kind), and those whose widths alone move, which only the report-only shrink-wrap check reads.
export function reverseOrder(ids: readonly string[], forward: ReadonlyMap<string, Prediction>, reverse: ReadonlyMap<string, Prediction>, varying: Varying): { moved: string[]; listed: string[]; widths: string[] } {
  const out = { moved: [] as string[], listed: [] as string[], widths: [] as string[] }
  for (let i = 0; i < ids.length; i++) {
    const change = predictionChange(reverse.get(ids[i]!)!, forward.get(ids[i]!)!)
    if (change === 'lines') out[varying.has(ids[i]!) ? 'listed' : 'moved'].push(ids[i]!)
    else if (change === 'widths') out.widths.push(ids[i]!)
  }
  return out
}

// The gate's fresh re-recording of a sample against the stored recordings. `attempts[0]` records every sampled case;
// the later attempts record again, each case alone in its own document, the cases the first laid out differently. A
// case laid out differently in every attempt is stale: the stored recording no longer describes the browser, which
// blocks. One laid out as stored in some attempt depends on the cases or documents before it: page history the
// recordings missed, which record would list.
export function freshRecordings(ids: readonly string[], stored: ReadonlyMap<string, Recording>, attempts: ReadonlyArray<ReadonlyMap<string, Recording>>): { stale: string[]; history: string[] } {
  const out = { stale: [] as string[], history: [] as string[] }
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!
    const want = recordingText(stored.get(id)!)
    if (recordingText(attempts[0]!.get(id)!) === want) continue
    let always = true
    for (let k = 1; k < attempts.length; k++) if (recordingText(attempts[k]!.get(id)!) === want) always = false
    out[always ? 'stale' : 'history'].push(id)
  }
  return out
}

// Why a new failure fails, from the gate's recording of it alone and its two predictions alone (each in a fresh
// document of its own job). A lone prediction can't tell the library's caches from the browser's Canvas state, so a
// prediction that moves is never called a library defect.
export type Attribution = 'page history' | 'varies between runs' | 'depends on what was predicted before' | 'true loss'

export function attribute(stored: Recording, recordedAlone: Recording, inCheck: Prediction, alone: readonly [Prediction, Prediction]): Attribution {
  if (recordingText(recordedAlone) !== recordingText(stored)) return 'page history'
  if (predictionChange(alone[0], alone[1]) === 'lines') return 'varies between runs'
  if (predictionChange(alone[0], inCheck) === 'lines') return 'depends on what was predicted before'
  return 'true loss'
}

// The list after `check --accept=<reason>`: the new failures under that reason, fixed entries gone, statuses current.
// A case that varies between runs never goes on it.
export function accept(outcomes: ReadonlyMap<string, Outcome>, accepted: AcceptedList, reason: string, varying: Varying, cases: ReadonlySet<string>, partial: boolean): Map<string, { reason: string; status: Failure }> {
  const next = new Map<string, { reason: string; status: Failure }>()
  for (const [id, entry] of accepted) if (!outcomes.has(id) && partial && !cases.has(id)) next.set(id, entry)
  for (const [id, outcome] of outcomes) {
    if (outcome.status === 'pass' || varying.get(id)?.kind === 'runs') continue
    next.set(id, { reason: accepted.get(id)?.reason ?? reason, status: outcome.status })
  }
  return next
}

// ---- What blocks ----

export function shown(ids: readonly string[]): string {
  return `${ids.slice(0, 10).join(' ')}${ids.length > 10 ? ' ...' : ''}`
}

function faultLines(label: string, faults: Faults): string[] {
  const out: string[] = []
  if (faults.disagree.length > 0) out.push(`BLOCKS: ${faults.disagree.length} cases${label} where another line API disagrees with the walk`, ...faults.disagree.slice(0, 10).map(line => `  ${line}`))
  if (faults.measuring.length > 0) out.push(`BLOCKS: ${faults.measuring.length} cases${label} whose line APIs called measureText after preparing (layout must ask Canvas nothing)`, ...faults.measuring.slice(0, 10).map(line => `  ${line} calls`))
  return out
}

// Why check blocks, as the lines it prints; none when it is green. The line APIs of every predicted case must agree
// with the walk and ask Canvas nothing after preparing, every case needs a recording (but in installed Safari), every
// varying entry must name a case, and, unless --accept rewrote the accepted list (`accepting`), every pinned failure must
// be on it and every entry on it must still fail. `describe` says what a new failure is.
export function checkBlocks(browser: BrowserKind, predictions: ReadonlyMap<string, Prediction>, unrecorded: readonly string[], verdict: Verdict, accepting: boolean, describe: (id: string) => string): string[] {
  const out = faultLines('', libraryFaults(predictions))
  // A case without a recording is unpinned silently otherwise, as when a generator change renames ids.
  if (unrecorded.length > 0 && !SAMPLED.includes(browser)) out.push(`BLOCKS: ${unrecorded.length} cases have no recording; record them with record --only-new: ${shown(unrecorded)}`)
  if (verdict.stale.length > 0) out.push(`BLOCKS: ${verdict.stale.length} entries of harness/varying/${browser}.txt name no case; take them off: ${shown(verdict.stale)}`)
  if (!accepting && verdict.fixed.length > 0) out.push(`BLOCKS: ${verdict.fixed.length} accepted cases pass, are no longer pinned or name no case; take them off with --accept: ${shown(verdict.fixed)}`)
  if (!accepting && verdict.newFailures.length > 0) {
    out.push(`BLOCKS: ${verdict.newFailures.length} new failures (accept them with --accept="<reason>")`)
    for (let i = 0; i < verdict.newFailures.length && i < 30; i++) out.push(`  ${describe(verdict.newFailures[i]!)}`)
  }
  return out
}

// Why the gate blocks besides check: breaks that move in reverse order (but on the varying list), line APIs that
// disagree or measure in reverse order, and fresh recordings that differ from the stored ones every time.
export function gateBlocks(order: { moved: readonly string[] }, reverse: ReadonlyMap<string, Prediction>, fresh: { stale: readonly string[] }): string[] {
  const out: string[] = []
  if (order.moved.length > 0) out.push(`BLOCKS: ${order.moved.length} predictions break differently in reverse order: ${shown(order.moved)}`)
  out.push(...faultLines(' in reverse order', libraryFaults(reverse)))
  if (fresh.stale.length > 0) out.push(`BLOCKS: ${fresh.stale.length} laid out differently from the recordings every time, alone too: ${shown(fresh.stale)}`)
  return out
}

// A fixed default seed, so a gate's result doesn't depend on the clock.
export const SEED = 20260924

// The gate's fresh re-recording sample: the n pinned cases whose ids rank first under the seed. The same seed draws the
// same cases, and a case leaving the pinned set (as page history the gate finds does) changes the sample by one case.
export function gateSample(pinned: readonly Case[], seed: number, n: number): Case[] {
  const ranks = new Map<string, number>()
  for (let i = 0; i < pinned.length; i++) ranks.set(pinned[i]!.id, createRng(`${seed} ${pinned[i]!.id}`).next())
  return pinned.slice().sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!).slice(0, n)
}
