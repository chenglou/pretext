// Gecko's word scan (src/engines/gecko/lines.ts wordScan) against the engine's loop, under the stand-in Canvas, with no
// browser: every paragraph of a source is prepared plain twice, once with every scan decided by the engine's loop and once
// with the word scan, and filled at every width; each line's fill result and pieces must be the same. It also says what
// the word scan covers and what it saves:
// - lines and paragraphs by how they were decided: every scan by the word scan without its premise (`proven`), with it
//   (`premise`), a scan left to the engine's loop (`exact`, by the first reason), or no text scan at all (`none`); split
//   by the scripts of the line's text;
// - Canvas calls and characters sent, from scratch (prepare and one fill) and per fill of a kept paragraph at the
//   other widths, in both modes.
// - what a store of answers with the page's lifetime would hold: of the questions from scratch, the ones whose context
//   settings and string no earlier paragraph of the run asked (`new to the page`), over the run and over its last 1,000
//   paragraphs. No store is built; the questions are counted.
// A difference says the two don't compute the same thing from the same answers. The answers are the stand-in's, so
// equality says nothing about a browser: that is the function set's plain check on recorded answers, and tier 2.
//
//   bun rebuild/tools/word-scan-diff.ts --source=tier|chat-mix|chat-latin|ascii-once|languages-once|cases
//     [--cases=<cases.ndjson>[,<more>]] [--sets=a,b] [--count=N] [--widths=own|60,150,400] [--mode=premise|proven]
//     [--checked] [--shard=i/n] [--out=<report.json>] [--dump-texts=<texts.json>]
//
// `tier` reads the recorded sets' Firefox case files (tests/sets.ts); `cases` any case files; the chat sources are the
// bench's generator as the bench builds its paragraphs (bench/page.ts chatInputs) and the long-form corpora cut once
// (tools/store-real-text.ts). `--widths=own` is a case's own width, 320 for a chat source. `--checked` runs the word scan's
// checked mode in the second pass too, which throws at the first scan that differs. `--dump-texts` writes the texts of
// ascii-once or languages-once as the browser probe takes messages (tools/word-scan-probe.ts) and stops.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CHAT_CODE_FONT, CHAT_CODE_PADDING, CHAT_LENGTH_CLASSES, CHAT_STYLE, CHAT_WIDTH, buildChat } from '../bench/cases.ts'
import { makePredictor } from '../lab/predictor-core.ts'
import type { Case } from '../lab/types.ts'
import { wordScanState } from '../src/engines/gecko/lines.ts'
import { detectEnvironment, fillLine, firstLine, linePieces, prepare, type BoxEdge, type Environment, type FontDecl, type InlineNode, type LineSlot, type Paragraph, type Prepared } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS } from '../src/model.ts'
import { selectSets, partFiles } from '../tests/sets.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2] ?? '')
}
const source = options.get('source') ?? 'chat-latin'
const mode = (options.get('mode') ?? 'premise') as 'premise' | 'proven'
const checked = options.has('checked')
const shard = (options.get('shard') ?? '0/1').split('/').map(Number)
const count = options.get('count') === undefined ? Infinity : Number(options.get('count'))

type Input = { id: string; paragraph: Paragraph; env: Environment; width: number; insets: readonly { left: number; right: number }[] }

// ---- Sources ----

const CORPORA = resolve(import.meta.dir, '../../corpora')
const NO_SPACES = ['zh', 'ja']

// tools/store-real-text.ts flow, toAscii, cutOnce: a text's paragraphs as one flow, cut once into the bench's lengths.
function flow(id: string): string {
  const parts = readFileSync(join(CORPORA, `${id}.txt`), 'utf8').split(/\n\s*\n/)
  const kept: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.replace(/\s+/g, ' ').trim()
    if (part !== '' && !/^[-{]/.test(part)) kept.push(part)
  }
  return kept.join(NO_SPACES.includes(id.slice(0, 2)) ? '' : ' ')
}

function toAscii(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—/g, ' - ').replace(/–/g, '-').replace(/…/g, '...')
    .normalize('NFKD').replace(/[^ -~]/g, '')
}

let state = 12345
const random = (): number => {
  state = (Math.imul(state, 1103515245) + 12345) >>> 0
  return state / 4294967296
}

function nextLength(): number {
  const r = random()
  let lengths = CHAT_LENGTH_CLASSES[CHAT_LENGTH_CLASSES.length - 1]!
  for (let i = 0, edge = 0; i < CHAT_LENGTH_CLASSES.length; i++) {
    edge += CHAT_LENGTH_CLASSES[i]!.share
    if (r < edge) {
      lengths = CHAT_LENGTH_CLASSES[i]!
      break
    }
  }
  return lengths.min + Math.floor(random() * (lengths.max - lengths.min + 1))
}

function cutOnce(text: string): string[] {
  const out: string[] = []
  let at = 0
  while (at < text.length) {
    let end = Math.min(text.length, at + nextLength())
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end)
      if (space > at + 4) end = space
      else if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) < 0xdc00) end++
    }
    const slice = text.slice(at, end).trim()
    if (slice !== '') out.push(slice)
    at = end
  }
  return out
}

const TEXT_STYLE = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 } as const

function chatParagraph(content: InlineNode[]): Paragraph {
  const s = CHAT_STYLE
  const font: FontDecl = { ...s.font, facts: UNKNOWN_FONT_FACTS }
  return { ...TEXT_STYLE, font, content, lineHeight: s.lineHeight, direction: s.direction, lang: s.lang, textIndent: 0, textAlign: 'start' }
}

function chatEnv(): Environment {
  const page = installStandInCanvas({ userAgent: USER_AGENT, devicePixelRatio: 2, pageLang: CHAT_STYLE.lang })
  const detected = detectEnvironment({ engine: 'gecko', build: '156.0', contentLanguage: null, regionalPrefsLocale: null })
  page.restore()
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

function inputs(): Input[] {
  switch (source) {
    case 'chat-mix':
    case 'chat-latin': {
      // bench/page.ts chatInputs.
      const env = chatEnv()
      const messages = buildChat(source === 'chat-mix' ? 'mix' : 'latin', Number.isFinite(count) ? count : 10000)
      const codeFont: FontDecl = { ...CHAT_CODE_FONT, facts: UNKNOWN_FONT_FACTS }
      const edge: BoxEdge = { margin: 0, border: 0, padding: CHAT_CODE_PADDING }
      return messages.map((message, i) => {
        const content: InlineNode[] = []
        for (let k = 0; k < message.parts.length; k++) {
          const part = message.parts[k]!
          if (part.code) content.push({ ...TEXT_STYLE, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
          else content.push({ kind: 'text', text: part.text })
        }
        return { id: `${source}-${i}`, paragraph: chatParagraph(content), env, width: CHAT_WIDTH, insets: [] }
      })
    }
    case 'ascii-once':
    case 'languages-once': {
      const env = chatEnv()
      let texts: string[]
      if (source === 'ascii-once') texts = cutOnce(toAscii(flow('en-gatsby-opening')))
      else {
        const ids = readdirSync(CORPORA).filter(file => file.endsWith('.txt') && file !== 'mixed-app-text.txt' && file !== 'ar-risalat-al-ghufran-part-1.txt').map(file => file.slice(0, -4)).sort()
        const lists = ids.map(id => cutOnce(flow(id)))
        texts = []
        for (let round = 0, more = true; more; round++) {
          more = false
          for (let i = 0; i < lists.length; i++) {
            if (round >= lists[i]!.length) continue
            texts.push(lists[i]![round]!)
            more = true
          }
        }
      }
      const dump = options.get('dump-texts')
      if (dump !== undefined) {
        writeFileSync(resolve(dump), JSON.stringify(texts.slice(0, count).map(text => ({ parts: [{ code: false, text }] }))))
        process.exit(0)
      }
      return texts.slice(0, count).map((text, i) => ({ id: `${source}-${i}`, paragraph: chatParagraph([{ kind: 'text', text }]), env, width: CHAT_WIDTH, insets: [] }))
    }
    case 'tier':
    case 'cases': {
      const files = source === 'tier'
        ? selectSets('firefox', options.get('sets'), options.get('groups')).flatMap(set => partFiles(set, 'firefox'))
        : (options.get('cases') ?? '').split(',').filter(file => file !== '').map(file => resolve(file))
      // The paragraph and the environment as the lab's predictor gives them to the library, which reads a case's own page.
      const predictor = makePredictor(() => UNKNOWN_FONT_FACTS)
      const out: Input[] = []
      let index = 0
      for (const file of files) {
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          if (line === '') continue
          if (index++ % shard[1]! !== shard[0]!) continue
          if (out.length >= count) break
          const c = JSON.parse(line) as Case
          const page = installStandInCanvas({ userAgent: USER_AGENT, devicePixelRatio: 2, pageLang: c.pageLang })
          try {
            const predicted = predictor.predict(c, { browser: 'firefox', build: '156.0', languages: { engine: 'gecko', regionalPrefsLocale: 'zh-hans-us' } })
            if ('layout' in predicted) out.push({ id: c.id, paragraph: predicted.paragraph as Paragraph, env: predicted.layout.env, width: c.paragraph.width, insets: c.inline?.lineSlots ?? [] })
            else skipped++
          } catch {
            skipped++
          } finally {
            page.restore()
          }
        }
      }
      return out
    }
    default: throw new Error(`Unknown source ${source}`)
  }
}

// ---- One paragraph at its widths, in one mode ----

const SCRIPTS: readonly (readonly [string, RegExp])[] = [
  ['han-kana-hangul', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u],
  ['arabic-hebrew', /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u],
  ['indic-southeast-asian', /[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}]/u],
  ['latin-greek-cyrillic', /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u],
]

function scriptsOf(text: string): string {
  let found = ''
  for (let i = 0; i < SCRIPTS.length; i++) if (SCRIPTS[i]![1].test(text)) found = found === '' ? SCRIPTS[i]![0] : 'several'
  return found === '' ? 'no-script' : found
}

type LineRecord = { json: string; decided: string; scripts: string }
type Pass = { lines: LineRecord[][]; scratch: { calls: number; characters: number }; kept: { calls: number; characters: number; fills: number }; error: string | null }

let skipped = 0

function refusedNow(): number {
  let n = 0
  for (const reason in wordScanState.refused) n += wordScanState.refused[reason]!
  return n
}

function firstNewReason(before: Record<string, number>): string {
  for (const reason in wordScanState.refused) if (wordScanState.refused[reason]! > (before[reason] ?? 0)) return reason
  return 'exact'
}

function fillAll(prepared: Prepared, width: number, insets: Input['insets'], text: string): LineRecord[] {
  const out: LineRecord[] = []
  let row = 0
  for (let start = firstLine(prepared); start !== null;) {
    const inset = row < insets.length ? insets[row]! : { left: 0, right: 0 }
    const slot: LineSlot = { width, left: inset.left, right: inset.right }
    const before = { ...wordScanState.refused }
    const refused = refusedNow()
    const proven = wordScanState.proven
    const premise = wordScanState.premise
    const result = fillLine(prepared, start, slot)
    let decided = 'none'
    if (refusedNow() > refused) decided = `exact:${firstNewReason(before)}`
    else if (wordScanState.premise > premise) decided = 'premise'
    else if (wordScanState.proven > proven) decided = 'proven'
    const lineText = result.kind === 'line' ? text.slice(result.start, result.end) : ''
    const pieces = result.kind === 'line' ? linePieces(prepared, result.line) : null
    out.push({
      json: JSON.stringify(result.kind === 'line' ? { kind: result.kind, start: result.start, end: result.end, next: result.next, hasLineBox: result.hasLineBox, pieces } : { kind: result.kind, next: result.next }),
      decided, scripts: scriptsOf(lineText),
    })
    switch (result.kind) {
      case 'below-floats':
        row++
        break
      case 'line':
        if (result.hasLineBox) row++
        break
    }
    start = result.next
  }
  return out
}

// The questions of a run's from-scratch layouts by context settings and string, per mode (tools/store-real-text.ts
// installLog): how many were asked, and how many no earlier paragraph had asked.
const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'] as const
type Repeats = { seen: Set<string>; asks: number; fresh: number; asksLast: number; freshLast: number }
const repeats: Record<'exact' | 'word', Repeats> = {
  exact: { seen: new Set(), asks: 0, fresh: 0, asksLast: 0, freshLast: 0 }, word: { seen: new Set(), asks: 0, fresh: 0, asksLast: 0, freshLast: 0 },
}
let onCall: (settings: string, text: string) => void = () => {}

function installLog(): void {
  const globals = globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => { getContext(kind: string): Record<string, unknown> & { measureText(text: string): unknown } } }
  const Inner = globals.OffscreenCanvas
  class Logged {
    inner = new Inner(1, 1).getContext('2d')
    assigned: Record<string, string> = {}
    measureText(text: string): unknown {
      let key = ''
      for (let i = 0; i < SETTINGS.length; i++) key += `${this.assigned[SETTINGS[i]!] ?? ''}|`
      onCall(key, text)
      return this.inner.measureText(text)
    }
  }
  for (let i = 0; i < SETTINGS.length; i++) {
    const name = SETTINGS[i]!
    Object.defineProperty(Logged.prototype, name, {
      get(this: Logged): unknown { return this.inner[name] },
      set(this: Logged, value: unknown): void {
        this.assigned[name] = String(value)
        this.inner[name] = value
      },
    })
  }
  globals.OffscreenCanvas = class { getContext(): Logged { return new Logged() } } as never
}

function pass(input: Input, widths: readonly number[], scanMode: 'exact' | 'proven' | 'premise', scanChecked: boolean, last: boolean): Pass {
  wordScanState.mode = scanMode
  wordScanState.checked = scanChecked
  const page = installStandInCanvas({ userAgent: USER_AGENT, devicePixelRatio: 2, pageLang: input.env.pageLang })
  installLog()
  const tally = repeats[scanMode === 'exact' ? 'exact' : 'word']
  let scratch = true
  onCall = (settings, text) => {
    if (!scratch) return
    tally.asks++
    if (last) tally.asksLast++
    const key = `${settings}\n${text}`
    if (tally.seen.has(key)) return
    tally.seen.add(key)
    tally.fresh++
    if (last) tally.freshLast++
  }
  const result: Pass = { lines: [], scratch: { calls: 0, characters: 0 }, kept: { calls: 0, characters: 0, fills: 0 }, error: null }
  try {
    const prepared = prepare(input.paragraph, input.env, false)
    const text = prepared.engine === 'gecko' ? prepared.state.text : ''
    for (let w = 0; w < widths.length; w++) {
      const asked = page.asked()
      result.lines.push(fillAll(prepared, widths[w]!, input.insets, text))
      const after = page.asked()
      scratch = false
      if (w === 0) result.scratch = { calls: after.calls, characters: after.characters }
      else {
        result.kept.calls += after.calls - asked.calls
        result.kept.characters += after.characters - asked.characters
        result.kept.fills++
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  } finally {
    page.restore()
  }
  return result
}

// ---- The run ----

const all = inputs()
const tally = (into: Record<string, number>, key: string): void => { into[key] = (into[key] ?? 0) + 1 }
const report = {
  source, mode, checked, shard: options.get('shard') ?? '0/1', widths: options.get('widths') ?? 'own', paragraphs: all.length, skipped,
  layouts: 0, lines: 0, differing: [] as { id: string; width: number; line: number; exact: string; word: string }[], errors: [] as { id: string; pass: string; error: string }[],
  linesBy: {} as Record<string, number>, linesByScript: {} as Record<string, Record<string, number>>,
  layoutsAllWord: 0, layoutsAllProven: 0,
  scratch: { exact: { calls: 0, characters: 0 }, word: { calls: 0, characters: 0 } },
  kept: { exact: { calls: 0, characters: 0, fills: 0 }, word: { calls: 0, characters: 0, fills: 0 } },
  scans: { proven: 0, premise: 0, refused: {} as Record<string, number> },
  newToThePage: { exact: { asks: 0, fresh: 0, asksLast: 0, freshLast: 0 }, word: { asks: 0, fresh: 0, asksLast: 0, freshLast: 0 } },
}
for (let n = 0; n < all.length; n++) {
  const input = all[n]!
  const widths = (options.get('widths') ?? 'own') === 'own' ? [input.width] : options.get('widths')!.split(',').map(Number)
  const last = n >= all.length - 1000
  const exact = pass(input, widths, 'exact', false, last)
  wordScanState.proven = 0
  wordScanState.premise = 0
  wordScanState.refused = {}
  const word = pass(input, widths, mode, checked, last)
  report.scans.proven += wordScanState.proven
  report.scans.premise += wordScanState.premise
  for (const reason in wordScanState.refused) report.scans.refused[reason] = (report.scans.refused[reason] ?? 0) + wordScanState.refused[reason]!
  if (exact.error !== null) report.errors.push({ id: input.id, pass: 'exact', error: exact.error })
  if (word.error !== null) report.errors.push({ id: input.id, pass: 'word', error: word.error })
  if (exact.error !== null || word.error !== null) continue
  report.scratch.exact.calls += exact.scratch.calls
  report.scratch.exact.characters += exact.scratch.characters
  report.scratch.word.calls += word.scratch.calls
  report.scratch.word.characters += word.scratch.characters
  report.kept.exact.calls += exact.kept.calls
  report.kept.exact.characters += exact.kept.characters
  report.kept.exact.fills += exact.kept.fills
  report.kept.word.calls += word.kept.calls
  report.kept.word.characters += word.kept.characters
  report.kept.word.fills += word.kept.fills
  for (let w = 0; w < widths.length; w++) {
    const a = exact.lines[w]!
    const b = word.lines[w]!
    report.layouts++
    let allWord = true
    let allProven = true
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length || i >= b.length || a[i]!.json !== b[i]!.json) {
        if (report.differing.length < 50) report.differing.push({ id: input.id, width: widths[w]!, line: i, exact: i < a.length ? a[i]!.json : '', word: i < b.length ? b[i]!.json : '' })
        else report.differing.length++
        break
      }
    }
    for (let i = 0; i < b.length; i++) {
      const line = b[i]!
      report.lines++
      const key = line.decided.startsWith('exact:') ? line.decided : line.decided
      tally(report.linesBy, key)
      tally(report.linesByScript[line.scripts] ??= {}, line.decided.startsWith('exact:') ? 'exact' : line.decided)
      if (line.decided.startsWith('exact:')) allWord = allProven = false
      if (line.decided === 'premise') allProven = false
    }
    if (allWord) report.layoutsAllWord++
    if (allProven) report.layoutsAllProven++
  }
}
report.skipped = skipped
report.newToThePage = {
  exact: { asks: repeats.exact.asks, fresh: repeats.exact.fresh, asksLast: repeats.exact.asksLast, freshLast: repeats.exact.freshLast },
  word: { asks: repeats.word.asks, fresh: repeats.word.fresh, asksLast: repeats.word.asksLast, freshLast: repeats.word.freshLast },
}
const out = options.get('out')
if (out !== undefined && out !== '') writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`)
const share = (n: number, of: number): string => of === 0 ? 'none' : `${(100 * n / of).toFixed(1)}%`
console.log(`[word-scan-diff] ${source}, mode ${mode}${checked ? ', checked' : ''}, shard ${report.shard}: ${report.paragraphs} paragraphs (${skipped} skipped), ${report.layouts} layouts, ${report.lines} lines`)
console.log(`  differing layouts: ${report.differing.length}; errors: ${report.errors.length}`)
console.log(`  lines by how they were decided: ${Object.entries(report.linesBy).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v} (${share(v, report.lines)})`).join(', ')}`)
console.log(`  layouts with every line decided by the word scan: ${report.layoutsAllWord} (${share(report.layoutsAllWord, report.layouts)}); without the premise: ${report.layoutsAllProven} (${share(report.layoutsAllProven, report.layouts)})`)
for (const scripts in report.linesByScript) console.log(`  ${scripts}: ${Object.entries(report.linesByScript[scripts]!).map(([k, v]) => `${k} ${v}`).join(', ')}`)
console.log(`  from scratch, per paragraph: exact ${(report.scratch.exact.calls / report.paragraphs).toFixed(2)} calls, ${(report.scratch.exact.characters / report.paragraphs).toFixed(1)} characters; word scan ${(report.scratch.word.calls / report.paragraphs).toFixed(2)} calls, ${(report.scratch.word.characters / report.paragraphs).toFixed(1)} characters`)
if (report.kept.exact.fills > 0) console.log(`  kept, per fill at another width: exact ${(report.kept.exact.calls / report.kept.exact.fills).toFixed(2)} calls, ${(report.kept.exact.characters / report.kept.exact.fills).toFixed(1)} characters; word scan ${(report.kept.word.calls / report.kept.word.fills).toFixed(2)} calls, ${(report.kept.word.characters / report.kept.word.fills).toFixed(1)} characters`)
for (const name of ['exact', 'word'] as const) {
  const r = report.newToThePage[name]
  console.log(`  ${name}, from scratch: ${r.asks} questions, ${r.fresh} new to the page (${share(r.asks - r.fresh, r.asks)} asked before); in the last 1,000 paragraphs ${r.asksLast} and ${r.freshLast} (${share(r.asksLast - r.freshLast, r.asksLast)} asked before)`)
}
for (let i = 0; i < Math.min(5, report.differing.length); i++) console.log(`  differs: ${JSON.stringify(report.differing[i])}`)
for (let i = 0; i < Math.min(5, report.errors.length); i++) console.log(`  error: ${JSON.stringify(report.errors[i])}`)
process.exit(report.differing.length > 0 || report.errors.length > 0 ? 1 : 0)
