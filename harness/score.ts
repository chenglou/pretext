// The pass rule and the numbers a run prints.
//
// A case passes when the prediction has the browser's line count and each line's first and last visible character sits
// in the predicted line of that index. The predicted lines are ranges in source order, so that checks every visible
// character (observe.ts). A right count with a wrong break is a failure of its own kind, 'breaks': main before #340
// passed 4.5-8.1% of its census cases that way by accident.
import { createRng } from './sets/build.ts'
import { caseText, recordingText, type Varying, type Widths } from './store.ts'
import { BROWSER, isRich, type BrowserKind, type Case, type Failure, type Prediction, type Recording, type Status } from './types.ts'

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
export function lateTextEmoji(browser: BrowserKind, c: Case): boolean {
  if (!BROWSER[browser].textEmojiLast) return false
  for (let i = 0; i < c.paragraph.runs.length; i++) if (c.paragraph.runs[i]!.text.includes('\uFE0E')) return true
  return false
}

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
    if (history.has(c.id) || lateTextEmoji(browser, c)) out.history++
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

// How two builds' predictions of one case differ, for equal: in their lines or widths, their line text, how another
// line API disagrees with the walk, or the Canvas calls their line APIs made; null when they don't. Line text is
// compared where both adapters hash it.
export function buildChange(a: Prediction, b: Prediction): string | null {
  const change = predictionChange(a, b)
  if (change !== 'same' || !('lines' in a) || !('lines' in b)) return change === 'same' ? null : change
  if (a.textHash !== b.textHash && a.textHash !== undefined && b.textHash !== undefined) return 'text'
  if (a.disagreement !== b.disagreement) return 'disagreement'
  return a.lineCalls === b.lineCalls ? null : 'Canvas calls after preparing'
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

// A font list the library doesn't take (README.md, Caveats): system-ui and its aliases resolve differently for Canvas on
// macOS.
export const SYSTEM_UI_FONT = /^\s*(system-ui|-apple-system|BlinkMacSystemFont|ui-sans-serif)\b/

// Why a case is outside what the library claims, or null when it is inside: a style the adapter can't express (break-all),
// in the adapter's words, or a system-ui font list. The headline prints the share outside, and the share right without it.
export function outsideClaims(c: Case, prediction: Prediction): string | null {
  if ('unsupported' in prediction) return prediction.unsupported
  return SYSTEM_UI_FONT.test(c.paragraph.font.family) ? 'a system-ui font list' : null
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

// ---- What check prints beside the headline ----
//
// The headline is one number over a sample drawn by sets/weights.json's shares, many of them guesses, and about half
// its weight is paragraphs of one line, which nearly always pass. So check prints beside it the share right where the
// browser wraps, the share with a wrong height, and a table that counts draws one each.

// A draw of the real-usage sample as check scored it. `inClaims`: inside what the library claims. `wrapped`: the browser
// lays it out on more than one line. `height`: the prediction has the browser's line count, so a virtualized list gives
// the paragraph its height, whichever line a character is on.
export type Draw = { group: string; weight: number; pass: boolean; inClaims: boolean; wrapped: boolean; height: boolean }

export function percent(part: number, whole: number): string {
  return whole === 0 ? '-' : `${(100 * part / whole).toFixed(2)}%`
}

// The share of the weight of the draws `among` picks that `of` picks too.
export function weightedShare(draws: readonly Draw[], among: (draw: Draw) => boolean, of: (draw: Draw) => boolean): string {
  let part = 0
  let whole = 0
  for (let i = 0; i < draws.length; i++) {
    const draw = draws[i]!
    if (!among(draw)) continue
    whole += draw.weight
    if (of(draw)) part += draw.weight
  }
  return percent(part, whole)
}

// The styles the table has a row for. Emoji are the characters a browser paints in color: those of emoji presentation,
// and any before U+FE0F.
const STYLES: ReadonlyArray<readonly [string, (c: Case, text: string) => boolean]> = [
  ['letter spacing', c => c.paragraph.runs.some(run => run.letterSpacing !== 0)],
  ['soft hyphens', (_, text) => text.includes('\u00AD')],
  ['pre-wrap', c => c.paragraph.whiteSpace === 'pre-wrap'],
  ['keep-all', c => c.paragraph.wordBreak === 'keep-all'],
  ['rich inline', c => isRich(c.paragraph.runs)],
  ['emoji', (_, text) => /[\p{Emoji_Presentation}\uFE0F]/u.test(text)],
]

// The table's rows a draw inside the claims counts in: its script, which ends its family (sets/sample.ts), and each of
// STYLES it has.
export function strata(c: Case): string[] {
  const text = caseText(c)
  const out = [`script ${c.family.slice(c.family.lastIndexOf('/') + 1)}`]
  for (let i = 0; i < STYLES.length; i++) if (STYLES[i]![1](c, text)) out.push(STYLES[i]![0])
  return out
}

// A row of the table: its draws and those that fail, the same among the draws the browser wraps, and the passing draws
// whose box would be too narrow (`narrow`: shrinkWrapShort).
export type Stratum = { draws: number; wrong: number; wrapped: number; wrappedWrong: number; narrow: number }

const IN_CLAIMS = 'in claims'
const OUTSIDE = 'outside claims: '

// The rows a draw counts in: every draw inside the claims and its strata, or the reason it is outside them
// (outsideClaims).
export function drawRows(c: Case, outside: string | null): string[] {
  return outside === null ? [IN_CLAIMS, ...strata(c)] : [OUTSIDE + outside]
}

export function countDraw(table: Map<string, Stratum>, rows: readonly string[], pass: boolean, wrapped: boolean, narrow: boolean): void {
  for (let i = 0; i < rows.length; i++) {
    let row = table.get(rows[i]!)
    if (row === undefined) table.set(rows[i]!, row = { draws: 0, wrong: 0, wrapped: 0, wrappedWrong: 0, narrow: 0 })
    row.draws++
    if (wrapped) row.wrapped++
    if (!pass) row.wrong++
    if (!pass && wrapped) row.wrappedWrong++
    if (narrow) row.narrow++
  }
}

// The table as check prints it: the draws inside the claims, then by script, the most drawn first, then by style, then
// the draws outside the claims, by reason. Each share is of the count two columns to its left; `narrow` is a share of
// the row's draws.
export function tableLines(table: ReadonlyMap<string, Stratum>): string[] {
  const byDraws = (a: string, b: string): number => table.get(b)!.draws - table.get(a)!.draws || (a < b ? -1 : 1)
  const names = [...table.keys()]
  const order = [
    ...names.filter(name => name === IN_CLAIMS), ...names.filter(name => name.startsWith('script ')).sort(byDraws),
    ...STYLES.map(style => style[0]).filter(name => table.has(name)), ...names.filter(name => name.startsWith(OUTSIDE)).sort(byDraws),
  ]
  let label = 0
  for (let i = 0; i < order.length; i++) label = Math.max(label, order[i]!.length)
  const count = (n: number, width: number): string => String(n).padStart(width)
  const share = (part: number, whole: number): string => percent(part, whole).padStart(8)
  const out = [`${''.padEnd(label)}  draws  wrong            wrapped  wrong            narrow`]
  for (let i = 0; i < order.length; i++) {
    const row = table.get(order[i]!)!
    out.push(`${order[i]!.padEnd(label)}  ${count(row.draws, 5)}  ${count(row.wrong, 5)} ${share(row.wrong, row.draws)}  ${count(row.wrapped, 7)}  ${count(row.wrappedWrong, 5)} ${share(row.wrappedWrong, row.wrapped)}  ${count(row.narrow, 6)} ${share(row.narrow, row.draws)}`)
  }
  return out
}

// The distances check counts lines beyond: the old suite's width tolerance, half a pixel and a pixel.
export const WIDTH_STEPS: readonly number[] = [0.05, 0.5, 1]

// Lines counted by how far their predicted width is from the recorded one, and the lines left out (`inexact`).
export type WidthTally = { lines: number; over: number[]; inexact: number }

// Counts the lines of a case that passes, whose lines pair up with the recorded ones. `text` is the case's text in a
// browser that gives a character's box in whole pixels (BROWSER's `wholePixelBoxes`), else null. The recorder takes the
// spaces that end a line off its width by their boxes (observe.ts, lineWidths), so there a line that ends in a space
// with a box, as pre-wrap's do, is recorded up to a pixel narrower than the browser draws it. Such a line is left out,
// not counted as a difference: in webkit-host they were 91% of the sample's lines more than 0.05 px off (2026-10-01).
export function countWidths(tally: WidthTally, recording: Recording, prediction: Prediction, text: string | null): void {
  if ('error' in recording || !('lines' in prediction)) return
  for (let i = 0; i < recording.lines.length; i++) {
    const line = recording.lines[i]!
    if (text !== null && line.last >= 0 && text.charCodeAt(line.last) === 0x20) {
      tally.inexact++
      continue
    }
    const gap = Math.abs(prediction.lines[i]!.width - line.width)
    tally.lines++
    for (let k = 0; k < WIDTH_STEPS.length; k++) if (gap > WIDTH_STEPS[k]!) tally.over[k]!++
  }
}

export function widthShares(tally: WidthTally): string {
  return `${tally.over.map(n => percent(n, tally.lines)).join(' / ')} of the ${tally.lines} lines`
}

// ---- The behaviour catalog's counts ----

// A behaviour as check scored its cases. `inside`: each case away from the edges where its lines change passes; `edges`:
// each case at an edge does. Then its cases at 24 px and wider (the narrowest real-usage draw is 25 px): `wraps`, the
// browser lays one of them away from the edges out on more than one line; `wide` and `wideEdges`, as `inside` and
// `edges`, over those cases alone; `edgeThere`, one of them is at an edge.
export type Behaviour = { inside: boolean; edges: boolean; wraps: boolean; wide: boolean; wideEdges: boolean; edgeThere: boolean }

export function countBehaviour(list: Map<string, Behaviour>, c: Case, wrapped: boolean, pass: boolean): void {
  let entry = list.get(c.behaviour!)
  if (entry === undefined) list.set(c.behaviour!, entry = { inside: true, edges: true, wraps: false, wide: true, wideEdges: true, edgeThere: false })
  const wide = c.paragraph.width >= 24
  if (c.edge === true) {
    entry.edges &&= pass
    if (wide) entry.wideEdges &&= pass
    if (wide) entry.edgeThere = true
  } else {
    entry.inside &&= pass
    if (wide) entry.wide &&= pass
    if (wide && wrapped) entry.wraps = true
  }
}

// A set's line of check's report. The first two counts fail a behaviour for a case at width 1 or under 24 px, narrower
// than any real layout. The counts at 24 px and wider are over the behaviours the browser wraps there, since two thirds
// of the catalog's have one case that wide, at 100,000 px on one line, which passes whatever the library does at a
// break; and the count at the edges is over the ones whose lines change there.
export function behaviourLine(set: string, list: ReadonlyMap<string, Behaviour>): string {
  let modelled = 0
  let exact = 0
  let wraps = 0
  let wide = 0
  let edged = 0
  let wideExact = 0
  for (const entry of list.values()) {
    if (entry.inside) modelled++
    if (entry.inside && entry.edges) exact++
    if (!entry.wraps) continue
    wraps++
    if (entry.wide) wide++
    if (entry.edgeThere) edged++
    if (entry.edgeThere && entry.wide && entry.wideEdges) wideExact++
  }
  return `${set}: ${modelled} of ${list.size} behaviours modelled, ${exact} of them also 1/64 px either side of where the lines change; at 24 px and wider, ${wide} modelled of the ${wraps} the browser wraps there, ${wideExact} also at the edges of the ${edged} whose lines change there`
}

// ---- Line widths in the gate ----
//
// check judges no width, so a change that leaves every line where it was and moves its width passes it. The gate holds
// each passing case's widths to where they stand: harness/widths lists the cases with a line more than 0.05 px from its
// recording, with that distance, and a case further from its recording than listed, or closer, blocks until the list
// says so. A build's predictions of the judged cases come out the same in every run: six fresh runs of each pinned
// browser gave every one of them the same widths (2026-09-30), once the predictions that move with the browser's state
// are left out (cli.ts).

// A passing case's largest distance between a predicted line width and the recorded one as the list holds it, px to
// two places, or null within the smallest of WIDTH_STEPS. Every line counts, the ones a browser records in whole pixels
// too (countWidths): the list holds a case to where it stands, whatever put it there.
export function widestGap(recording: Recording, prediction: Prediction): string | null {
  if ('error' in recording || !('lines' in prediction)) return null
  let most = 0
  for (let i = 0; i < recording.lines.length; i++) most = Math.max(most, Math.abs(prediction.lines[i]!.width - recording.lines[i]!.width))
  return most > WIDTH_STEPS[0]! ? most.toFixed(2) : null
}

// What the widths list makes of the judged cases' gaps (`gaps`: null for one within tolerance): the cases further from
// their recordings than listed, which block as a new failure does, and those closer, which block as a fixed one does, so
// a regression can't hide in an entry grown loose. Each as `<id> <listed> -> <now>`. An entry of a case not judged in
// this run says nothing.
export function judgeWidths(gaps: ReadonlyMap<string, string | null>, listed: Widths): { worse: string[]; better: string[] } {
  const out = { worse: [] as string[], better: [] as string[] }
  for (const [id, gap] of gaps) {
    const was = listed.get(id)?.gap ?? null
    if (gap !== was) out[Number(gap ?? 0) > Number(was ?? 0) ? 'worse' : 'better'].push(`${id} ${was ?? 'unlisted'} -> ${gap ?? 'within tolerance'}`)
  }
  return out
}

// The list after `gate --accept-widths=<reason>`: every judged case over the tolerance with its gap, under that reason
// when it is new or further off than listed and under its own otherwise. Entries of cases not judged go, but those of
// cases outside a run over some case files only (`partial`).
export function acceptWidths(gaps: ReadonlyMap<string, string | null>, listed: Widths, reason: string, cases: ReadonlySet<string>, partial: boolean): Widths {
  const next: Widths = new Map()
  for (const [id, entry] of listed) if (partial && !cases.has(id)) next.set(id, entry)
  for (const [id, gap] of gaps) {
    if (gap === null) continue
    const was = listed.get(id)
    next.set(id, { reason: was !== undefined && Number(gap) <= Number(was.gap) ? was.reason : reason, gap })
  }
  return next
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
  if (unrecorded.length > 0 && BROWSER[browser].sample === null) out.push(`BLOCKS: ${unrecorded.length} cases have no recording; record them with record --only-new: ${shown(unrecorded)}`)
  if (verdict.stale.length > 0) out.push(`BLOCKS: ${verdict.stale.length} entries of harness/varying/${browser}.txt name no case; take them off: ${shown(verdict.stale)}`)
  if (!accepting && verdict.fixed.length > 0) out.push(`BLOCKS: ${verdict.fixed.length} accepted cases pass, are no longer pinned or name no case; take them off with --accept: ${shown(verdict.fixed)}`)
  if (!accepting && verdict.newFailures.length > 0) {
    out.push(`BLOCKS: ${verdict.newFailures.length} new failures (accept them with --accept="<reason>")`)
    for (let i = 0; i < verdict.newFailures.length && i < 30; i++) out.push(`  ${describe(verdict.newFailures[i]!)}`)
  }
  return out
}

// Why the gate blocks besides check: breaks that move in reverse order (but on the varying list), line APIs that
// disagree or measure in reverse order, fresh recordings that differ from the stored ones every time, and line widths
// that left where the widths list holds them (unless --accept-widths rewrote it).
export function gateBlocks(order: { moved: readonly string[] }, reverse: ReadonlyMap<string, Prediction>, fresh: { stale: readonly string[] }, widths: { worse: readonly string[]; better: readonly string[] }): string[] {
  const out: string[] = []
  if (order.moved.length > 0) out.push(`BLOCKS: ${order.moved.length} predictions break differently in reverse order: ${shown(order.moved)}`)
  out.push(...faultLines(' in reverse order', libraryFaults(reverse)))
  if (fresh.stale.length > 0) out.push(`BLOCKS: ${fresh.stale.length} laid out differently from the recordings every time, alone too: ${shown(fresh.stale)}`)
  if (widths.worse.length > 0) out.push(`BLOCKS: ${widths.worse.length} passing cases have a line width further from its recording than harness/widths lists, in px (accept them with gate --accept-widths="<reason>"): ${widths.worse.slice(0, 10).join('; ')}${widths.worse.length > 10 ? ' ...' : ''}`)
  if (widths.better.length > 0) out.push(`BLOCKS: ${widths.better.length} passing cases' line widths are closer to their recordings than harness/widths lists, in px; write them with gate --accept-widths="<reason>": ${widths.better.slice(0, 10).join('; ')}${widths.better.length > 10 ? ' ...' : ''}`)
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
