// The files the harness keeps in git, all plain text with one entry per line, sorted, and nothing that changes from one
// run to the next, so a new recording diffs by the cases the browser changed and git's delta compression works:
// - harness/recordings/<browser>.txt: the recorded layout of every case whose two recordings agree, under an
//   environment key. A line is `<id>\t<height>\t<line> <line> ...`, each line `<first>-<last>:<width>` with `-` for no
//   visible character, or `<id>\terror\t<reason>`.
// - harness/recordings/<browser>.history.txt: the cases whose two recordings differ (page history), both recordings, as
//   `<id>\t<A|B>\t...`. They are never pinned.
// - harness/accepted/<browser>.txt: the failures a change accepted, under `## <reason>` headings, one `<id> <status>` per line.
// - harness/varying/<browser>.txt: the cases whose predictions move with the browser's state, under `## <reason>`
//   headings, one `<id> <kind>` per line: `runs` for one that moves between runs, predicted and printed but never
//   judged, and `order` for one that moves only with what was predicted before it, judged like any other.
import { readFileSync, writeFileSync } from 'node:fs'
import type { BrowserKind, Case, Failure, Recording, RecordedLine } from './types.ts'

export function recordingText(recording: Recording): string {
  if ('error' in recording) return `error\t${recording.error.replace(/\s+/g, ' ')}`
  const lines: string[] = []
  for (let i = 0; i < recording.lines.length; i++) {
    const line = recording.lines[i]!
    lines.push(`${line.first < 0 ? '-' : `${line.first}-${line.last}`}:${line.width}`)
  }
  return `${recording.height}\t${lines.join(' ')}`
}

export function parseRecording(text: string): Recording {
  const tab = text.indexOf('\t')
  const head = text.slice(0, tab)
  const rest = text.slice(tab + 1)
  if (head === 'error') return { error: rest }
  const lines: RecordedLine[] = []
  const tokens = rest === '' ? [] : rest.split(' ')
  for (let i = 0; i < tokens.length; i++) {
    const match = /^(?:-|(\d+)-(\d+)):(-?[\d.e+-]+)$/.exec(tokens[i]!)
    if (match === null) throw new Error(`Bad recorded line ${tokens[i]}`)
    lines.push({ first: match[1] === undefined ? -1 : Number(match[1]), last: match[2] === undefined ? -1 : Number(match[2]), width: Number(match[3]) })
  }
  const height = Number(head)
  if (tab < 0 || !Number.isFinite(height)) throw new Error(`Bad recording ${text}`)
  return { lines, height }
}

export type RecordingFile = { env: string; recordings: Map<string, Recording> }
export type HistoryFile = { env: string; cases: Map<string, [Recording, Recording]> }

// `root`: the harness folder, harness/ but in the tests.
export const recordingsPath = (root: string, browser: BrowserKind): string => `${root}/recordings/${browser}.txt`
export const historyPath = (root: string, browser: BrowserKind): string => `${root}/recordings/${browser}.history.txt`
export const acceptedPath = (root: string, browser: BrowserKind): string => `${root}/accepted/${browser}.txt`
export const varyingPath = (root: string, browser: BrowserKind): string => `${root}/varying/${browser}.txt`

function readLines(path: string): string[] | null {
  try {
    return readFileSync(path, 'utf8').split('\n').filter(line => line !== '')
  } catch {
    return null
  }
}

function readEnv(lines: string[], path: string): string {
  const header = lines[0]
  if (header?.startsWith('# env ') !== true) throw new Error(`${path} has no environment key`)
  return header.slice('# env '.length)
}

function sortedById(entries: string[]): string[] {
  return entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

export function readRecordings(path: string): RecordingFile | null {
  const lines = readLines(path)
  if (lines === null) return null
  const recordings = new Map<string, Recording>()
  for (let i = 1; i < lines.length; i++) {
    const tab = lines[i]!.indexOf('\t')
    recordings.set(lines[i]!.slice(0, tab), parseRecording(lines[i]!.slice(tab + 1)))
  }
  return { env: readEnv(lines, path), recordings }
}

export function writeRecordings(path: string, file: RecordingFile): void {
  const lines: string[] = []
  for (const [id, recording] of file.recordings) lines.push(`${id}\t${recordingText(recording)}`)
  writeFileSync(path, `# env ${file.env}\n${sortedById(lines).join('\n')}${lines.length > 0 ? '\n' : ''}`)
}

export function readHistory(path: string): HistoryFile | null {
  const lines = readLines(path)
  if (lines === null) return null
  const cases = new Map<string, [Recording, Recording]>()
  for (let i = 1; i < lines.length; i += 2) {
    const [a, b] = [lines[i]!.split('\t'), lines[i + 1]?.split('\t') ?? []]
    if (a[1] !== 'A' || b[1] !== 'B' || a[0] !== b[0]) throw new Error(`${path}:${i + 1}: expected lines A and B of one case`)
    cases.set(a[0]!, [parseRecording(a.slice(2).join('\t')), parseRecording(b.slice(2).join('\t'))])
  }
  return { env: readEnv(lines, path), cases }
}

export function writeHistory(path: string, file: HistoryFile): void {
  const ids = sortedById([...file.cases.keys()])
  let text = `# env ${file.env}\n`
  for (let i = 0; i < ids.length; i++) {
    const [a, b] = file.cases.get(ids[i]!)!
    text += `${ids[i]}\tA\t${recordingText(a)}\n${ids[i]}\tB\t${recordingText(b)}\n`
  }
  writeFileSync(path, text)
}

// Lines of `fields` words under `## <reason>` headings, each with its reason, which can't be empty. An id is listed once.
function readUnderReasons(path: string, fields: number): Array<{ reason: string; words: string[] }> {
  const out: Array<{ reason: string; words: string[] }> = []
  const lines = readLines(path) ?? []
  const ids = new Set<string>()
  let reason: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('## ')) {
      reason = line.slice(3).trim()
      continue
    }
    const words = line.trim().split(/\s+/)
    if (reason === null || reason === '' || words.length !== fields) throw new Error(`${path}:${i + 1}: expected ${fields} words per line under a '## <reason>' heading`)
    if (ids.has(words[0]!)) throw new Error(`${path}:${i + 1}: ${words[0]} is listed twice`)
    ids.add(words[0]!)
    out.push({ reason, words })
  }
  return out
}

// An accepted failure: the reason it was accepted under, and the failure it was.
export type Accepted = Map<string, { reason: string; status: Failure }>
const FAILURES: readonly string[] = ['count', 'breaks', 'error'] satisfies Failure[]

export function readAccepted(path: string): Accepted {
  const accepted: Accepted = new Map()
  const entries = readUnderReasons(path, 2)
  for (let i = 0; i < entries.length; i++) {
    const [id, status] = entries[i]!.words as [string, string]
    if (!FAILURES.includes(status)) throw new Error(`${path}: ${id} has status ${status}, not one of ${FAILURES.join(', ')}`)
    accepted.set(id, { reason: entries[i]!.reason, status: status as Failure })
  }
  return accepted
}

// A varying prediction: the reason it is listed under, and whether it moves between runs or only with what was
// predicted before it.
export type Varying = Map<string, { reason: string; kind: 'runs' | 'order' }>

export function readVarying(path: string): Varying {
  const varying: Varying = new Map()
  const entries = readUnderReasons(path, 2)
  for (let i = 0; i < entries.length; i++) {
    const [id, kind] = entries[i]!.words as [string, string]
    if (kind !== 'runs' && kind !== 'order') throw new Error(`${path}: ${id} has kind ${kind}, not runs or order`)
    varying.set(id, { reason: entries[i]!.reason, kind })
  }
  return varying
}

export function writeAccepted(path: string, accepted: Accepted): void {
  const byReason = new Map<string, string[]>()
  for (const [id, entry] of accepted) {
    let list = byReason.get(entry.reason)
    if (list === undefined) byReason.set(entry.reason, list = [])
    list.push(`${id} ${entry.status}`)
  }
  const reasons = sortedById([...byReason.keys()])
  let text = ''
  for (let i = 0; i < reasons.length; i++) text += `${i > 0 ? '\n' : ''}## ${reasons[i]}\n${sortedById(byReason.get(reasons[i]!)!).join('\n')}\n`
  writeFileSync(path, text)
}

// ---- Cases ----

const WHITE_SPACE = ['normal', 'pre', 'pre-wrap', 'pre-line', 'nowrap', 'break-spaces']
const WORD_BREAK = ['normal', 'break-all', 'keep-all', 'break-word']
const OVERFLOW_WRAP = ['normal', 'break-word', 'anywhere']
const LINE_BREAK = ['auto', 'loose', 'normal', 'strict', 'anywhere']

function fontProblem(font: Case['paragraph']['font'] | undefined): string | null {
  if (typeof font !== 'object' || typeof font.family !== 'string' || typeof font.size !== 'number' || typeof font.weight !== 'number') return 'bad font'
  return font.style === 'normal' || font.style === 'italic' ? null : 'bad font style'
}

// Why a parsed line isn't a case the harness can run, or null. Checked once, when a case file loads.
export function caseProblem(c: Case): string | null {
  if (typeof c.id !== 'string' || !/^[\w./:+-]+$/.test(c.id)) return 'id must be a non-empty string of word characters, . / : + -'
  if (typeof c.family !== 'string' || typeof c.origin !== 'string' || typeof c.pageLang !== 'string') return 'family, origin and pageLang must be strings'
  const p = c.paragraph
  if (typeof p !== 'object' || !Array.isArray(p.runs) || p.runs.length === 0) return 'paragraph.runs must be a non-empty array'
  if (typeof p.width !== 'number' || typeof p.lineHeight !== 'number' || !(p.lineHeight > 0) || typeof p.tabSize !== 'number') return 'width, lineHeight and tabSize must be numbers'
  if (!WHITE_SPACE.includes(p.whiteSpace) || !WORD_BREAK.includes(p.wordBreak) || !OVERFLOW_WRAP.includes(p.overflowWrap) || !LINE_BREAK.includes(p.lineBreak)) return 'unknown CSS keyword'
  if ((p.direction !== 'ltr' && p.direction !== 'rtl') || typeof p.lang !== 'string') return 'bad direction or lang'
  if (fontProblem(p.font) !== null) return fontProblem(p.font)
  for (let i = 0; i < p.runs.length; i++) {
    const run = p.runs[i]!
    if (typeof run.text !== 'string' || (run.node !== 'span' && run.node !== 'text')) return `run ${i}: bad text or node`
    if (fontProblem(run.font) !== null || typeof run.letterSpacing !== 'number' || typeof run.wordSpacing !== 'number') return `run ${i}: bad font or spacing`
    if ((run.atomic !== undefined || run.padding !== undefined) && run.node !== 'span') return `run ${i}: only a span can be atomic or padded`
    // A bare text node takes the paragraph's styles in the browser, and the adapter reads them from the run.
    const f = run.font
    if (run.node === 'text' && (f.family !== p.font.family || f.size !== p.font.size || f.weight !== p.font.weight || f.style !== p.font.style
      || run.letterSpacing !== p.letterSpacing || run.wordSpacing !== p.wordSpacing || run.lang !== null)) return `run ${i}: a bare text run must carry the paragraph's font and spacing, and no lang`
    if (run.atomic !== undefined && run.atomic !== true) return `run ${i}: atomic must be true or absent`
    if (run.padding !== undefined && !(run.padding > 0)) return `run ${i}: padding must be positive or absent`
  }
  if (c.sample !== undefined && (typeof c.sample.group !== 'string' || !(c.sample.weight > 0) || (c.sample.standIn !== undefined && c.sample.standIn !== true))) return 'sample needs a group, a positive weight and standIn true or absent'
  if (c.behaviour !== undefined && (typeof c.behaviour !== 'string' || c.behaviour === '')) return 'behaviour must be a non-empty string'
  if (c.edge !== undefined && (c.edge !== true || c.behaviour === undefined)) return 'edge must be true or absent, on a behaviour\'s case'
  return null
}

export function readCases(path: string): Case[] {
  const lines = readFileSync(path, 'utf8').split('\n')
  const cases: Case[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === '') continue
    const c = JSON.parse(lines[i]!) as Case
    const problem = caseProblem(c)
    if (problem !== null) throw new Error(`${path}:${i + 1}: ${problem}`)
    cases.push(c)
  }
  return cases
}

export function caseText(c: Case): string {
  let text = ''
  for (let i = 0; i < c.paragraph.runs.length; i++) text += c.paragraph.runs[i]!.text
  return text
}

// The two recordings of each case, in its two orders: the same layout is kept, and a case laid out differently after
// other cases goes on the page-history list, never pinned.
export type Stored = { recordings: ReadonlyMap<string, Recording>; history: ReadonlyMap<string, [Recording, Recording]> }

// A case laid out differently in its two orders is page history. So is one laid out differently from, or already page
// history in, the stored recordings of the same environment (`prior`): two orders miss some of what depends on the cases
// before it. Returns how many differ from the stored recordings.
export function splitHistory(ids: readonly string[], a: ReadonlyMap<string, Recording>, b: ReadonlyMap<string, Recording>, recordings: Map<string, Recording>, history: Map<string, [Recording, Recording]>, prior: Stored | null = null): number {
  let moved = 0
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!
    const first = a.get(id)!
    const second = b.get(id)!
    const stored = prior?.recordings.get(id)
    const earlier = prior?.history.get(id)
    recordings.delete(id)
    history.delete(id)
    if (recordingText(first) !== recordingText(second)) history.set(id, [first, second])
    else if (earlier !== undefined) history.set(id, earlier)
    else if (stored !== undefined && recordingText(stored) !== recordingText(first)) {
      history.set(id, [stored, first])
      moved++
    } else recordings.set(id, first)
  }
  return moved
}

export function assertSameEnvironment(browser: BrowserKind, recorded: string, live: string): void {
  if (recorded !== live) throw new Error(`${browser}: recorded under\n  ${recorded}\nbut this browser is\n  ${live}\nRecord again before scoring.`)
}
