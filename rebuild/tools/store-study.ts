// A study tool, not a test: what the chat benchmark's messages ask of Canvas, offline, under the stand-in Canvas
// (tools/stand-in-canvas.ts), with every question logged where it reaches Canvas. It changes nothing in rebuild/src.
//
//   bun rebuild/tools/store-study.ts --engine=blink|webkit|gecko --set=mix|latin|real [--count=10000]
//     [--part=store|sites|widths|short|trace|tier] [--widths=260,320,380,440] [--sets=a,b] [--device-pixel-ratio=2]
//     [--out=<report.json>]
//
// A question is a context's assigned settings and a string. Parts:
// - store: every message prepared from scratch and filled at 320px, as the bench's `scratch, count` row does. Counts what
//   a store with the page's lifetime, found by settings and string, would answer without Canvas as messages accumulate:
//   by phase (font checks, engine prepare, fill), by what a question is for (purposeOf, read from the call's stack) and
//   by what its string is (shapeOf).
// - sites: the same pass, tallied by call site, which is how purposeOf was written.
// - widths: per message, what a fill asks at each width from a fresh prepared paragraph, the union over the widths, and
//   what the union adds to what prepare asked; and the bench's resize on a kept paragraph.
// - short: the questions of a word-and-boundary recipe over the same messages: main's own segments (src/analysis.ts) as
//   the words, and the two clusters around every segment boundary as the boundary.
// - trace: the calls themselves, for tools/store-replay-probe.ts to make again in a browser.
// - tier: the recorded tier cases (tests/replay.ts inputs, no supplied facts) on the plain path, from a real browser's
//   recorded answers, tallied like `store`.
// The stand-in is no font: its kerning, ligatures and fallback are hashes. Counts that follow answers (where a line
// breaks, whether a pair kerns) are the stand-in's, and the bench's browser counts are the check on them.
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { prepareWithSegments } from '../../src/layout.ts'
import { blinkFontChecks } from '../src/engines/blink/checks.ts'
import * as blink from '../src/engines/blink/index.ts'
import { geckoFontChecks } from '../src/engines/gecko/checks.ts'
import * as gecko from '../src/engines/gecko/index.ts'
import { webkitFontChecks } from '../src/engines/webkit/checks.ts'
import * as webkit from '../src/engines/webkit/index.ts'
import { detectEnvironment, fillLine, firstLine, type Environment, type EngineName, type GivenFacts, type Prepared } from '../src/index.ts'
import { withLearnedFontFacts } from '../src/measure/font-checks.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type FontDecl, type InlineNode, type Paragraph } from '../src/model.ts'
import { installReplay, NewQuestion } from '../lab/measurements.ts'
import { predict as plainPredict } from '../lab/baselines/plain-predictor.ts'
import { readInputs, readShard, referenceDir, type InputCase } from '../tests/replay.ts'
import type { TierBrowser } from '../tests/sets.ts'
import { CHAT_CODE_FONT, CHAT_CODE_PADDING, CHAT_STYLE, CHAT_WIDTH, buildChat } from '../bench/cases.ts'
import type { ChatMessage, ChatSetId } from '../bench/protocol.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

const USER_AGENTS: Record<EngineName, string> = {
  blink: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  gecko: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
  webkit: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15 webkit-host/22625.1.29.11.27',
}

function givenFacts(engine: EngineName): GivenFacts {
  switch (engine) {
    case 'blink': return { engine, build: '153.0.8010.50', contentLanguage: null, uiLanguage: null }
    case 'webkit': return { engine, build: '22625.1.29.11.27', contentLanguage: null, pageZoom: 1, preferredLanguages: null, icuDefaultLocale: null }
    case 'gecko': return { engine, build: '156.0', contentLanguage: null, regionalPrefsLocale: null }
  }
}

// bench/page.ts chatInputs: the message as the rebuild takes it, no font facts supplied.
function paragraphOf(message: ChatMessage): Paragraph {
  const s = CHAT_STYLE
  const font: FontDecl = { ...s.font, facts: UNKNOWN_FONT_FACTS }
  const codeFont: FontDecl = { ...CHAT_CODE_FONT, facts: UNKNOWN_FONT_FACTS }
  const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 } as const
  const edge: BoxEdge = { margin: 0, border: 0, padding: CHAT_CODE_PADDING }
  const content: InlineNode[] = []
  for (let k = 0; k < message.parts.length; k++) {
    const part = message.parts[k]!
    if (part.code) content.push({ ...text, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
    else content.push({ kind: 'text', text: part.text })
  }
  return { ...text, font, content, lineHeight: s.lineHeight, direction: s.direction, lang: s.lang, textIndent: 0, textAlign: 'start' }
}

function withFontChecks(paragraph: Paragraph, env: Environment): Paragraph {
  switch (env.engine) {
    case 'blink': return withLearnedFontFacts(paragraph, blinkFontChecks(env), [])
    case 'webkit': return withLearnedFontFacts(paragraph, webkitFontChecks, [])
    case 'gecko': return withLearnedFontFacts(paragraph, geckoFontChecks, [])
  }
}

function prepareChecked(checked: Paragraph, env: Environment): Prepared {
  switch (env.engine) {
    case 'blink': return { engine: 'blink', state: blink.prepare(checked, env, false, []) }
    case 'webkit': return { engine: 'webkit', state: webkit.prepare(checked, env, false, []) }
    case 'gecko': return { engine: 'gecko', state: gecko.prepare(checked, env, false, []) }
  }
}

function fillAll(prepared: Prepared, width: number): number {
  let lines = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    if (filled.hasLineBox) lines++
    start = filled.next
  }
  return lines
}

// ---- The log ----

type Phase = 'checks' | 'prepare' | 'fill'
type Call = { phase: Phase; settings: string; text: string; stack: string; context: object }

// Deep enough for every library frame of a call and the lab's frame under it (Blink's measure16 recurses per script edge).
Error.stackTraceLimit = 2000

let phase: Phase = 'checks'
let wantStacks = false
let onCall: (call: Call) => void = () => {}
let contextsMade = 0
// The contexts made since the list was last emptied, in order, for the trace part.
let liveContexts: Array<{ assigned: Record<string, string> }> = []

const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'] as const

// Wraps the installed OffscreenCanvas: every context reports its calls with the settings assigned to it.
function installLog(): void {
  const globals = globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => { getContext(kind: string): Record<string, unknown> & { measureText(text: string): unknown } } }
  const Inner = globals.OffscreenCanvas
  class Logged {
    inner = new Inner(1, 1).getContext('2d')
    assigned: Record<string, string> = {}
    key: string | null = null
    constructor() {
      contextsMade++
      liveContexts.push(this)
    }
    measureText(text: string): unknown {
      if (this.key === null) {
        let key = ''
        for (let i = 0; i < SETTINGS.length; i++) key += `${this.assigned[SETTINGS[i]!] ?? ''}|`
        this.key = key
      }
      onCall({ phase, settings: this.key, text, stack: wantStacks ? new Error().stack ?? '' : '', context: this })
      return this.inner.measureText(text)
    }
  }
  for (let i = 0; i < SETTINGS.length; i++) {
    const name = SETTINGS[i]!
    Object.defineProperty(Logged.prototype, name, {
      get(this: Logged): unknown { return this.inner[name] },
      set(this: Logged, value: unknown): void {
        this.assigned[name] = String(value)
        this.key = null
        this.inner[name] = value
      },
    })
  }
  globals.OffscreenCanvas = class { getContext(): Logged { return new Logged() } } as never
}

// ---- Question classes, by call site ----

// The library functions on a call's stack, innermost first, as `name@file`.
const LIBRARY = '/rebuild/src/'
const stackCache = new Map<string, { under: string[]; site: string }>()
function readStack(stack: string): { under: string[]; site: string } {
  let read = stackCache.get(stack)
  if (read !== undefined) return read
  const under: string[] = []
  const frames: string[] = []
  const lines = stack.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const match = /^\s*at (?:(.*?) \()?(.*?):(\d+):\d+\)?$/.exec(lines[i]!)
    if (match === null) continue
    const at = match[2]!.indexOf(LIBRARY)
    if (at === -1 || match[2]!.endsWith('/measure/canvas.ts')) continue
    const name = `${match[1] ?? '(anonymous)'}@${match[2]!.slice(at + LIBRARY.length)}`
    if (frames.length < 5) frames.push(`${name}:${match[3]!}`)
    if (!under.includes(name)) under.push(name)
  }
  read = { under, site: frames.join(' < ') }
  stackCache.set(stack, read)
  return read
}

// What a question is for, read from the functions it was asked under. Each engine's rules follow its measuring code:
// engines/blink/shape.ts and contexts.ts, engines/webkit/measure.ts, content.ts and items.ts, engines/gecko/measure.ts,
// advance.ts and prepare.ts. The first rule that matches wins.
const has = (under: readonly string[], name: string): boolean => {
  for (let i = 0; i < under.length; i++) if (under[i]!.startsWith(`${name}@`)) return true
  return false
}

const PICTOGRAPH = /\p{Extended_Pictographic}/u

function purposeOf(engineName: EngineName, call: Call, under: readonly string[]): string {
  if (call.phase === 'checks') return 'font checks'
  switch (engineName) {
    case 'blink': {
      if (has(under, 'canvasSplitsWords') || has(under, 'measureHanKerningFontData') || has(under, 'trim16')) return 'probe strings of a style (word split, HanKerning)'
      if (has(under, 'shapeHyphen') || has(under, 'tabShapeResult')) return 'hyphen or tab space'
      const pair = has(under, 'pairAdjust16')
      if (has(under, 'passesSafeTest')) return pair ? 'cut of a group over 256px: pair window' : 'cut of a group over 256px: wide window'
      // The cut search's own totals; its safe tests are the rule above, and measureGroups is on both stacks.
      if (has(under, 'addPieces')) return 'total of a group or of a piece'
      if (has(under, 'safeToBreak')) return pair ? 'safe-to-break test: pair window' : 'safe-to-break test: wide window'
      if (has(under, 'groupPrefix16') || has(under, 'callPrefix16') || has(under, 'measureGroups')) {
        if (pair) return 'position: pair window'
        if (has(under, 'windowAdjust16') || has(under, 'adjust16')) return 'position before a space: wide window'
        return 'position: prefix from the last cut'
      }
      if (has(under, 'reshape') || has(under, 'reshapeHanKerningEnd')) return 'line-edge reshape'
      return 'other'
    }
    case 'webkit':
      if (has(under, 'breakWord')) return 'break inside a word: prefixes'
      if (has(under, 'lineHyphenWidth')) return 'hyphen'
      if (has(under, 'fixedPitchWidth')) return 'fixed-pitch space'
      if (has(under, 'mergedGlyphs') || has(under, 'controlIsAdjusted')) return 'letter-spacing and control recipes'
      if (has(under, 'boxWidth') || has(under, 'itemWidth')) return 'item width (a word, with its trailing space)'
      if (has(under, 'makeBox')) return call.text === ' ' ? 'space of a box' : 'coverage probe per code point (fixed-pitch box)'
      return 'other'
    case 'gecko':
      if (has(under, 'ligatureAcross')) return 'ligature test: a pair in two contexts'
      if (has(under, 'groups') || has(under, 'groupAcross')) return 'ligature groups by letter spacing'
      if (has(under, 'pairKernedShare') || has(under, 'askedPlacement') || has(under, 'sameFace')) return 'pair placement'
      if (has(under, 'suffixAlone')) return 'suffix from a break candidate'
      if (has(under, 'inWordAdvance') || has(under, 'sidesAdvance')) return call.text.length <= 2 ? 'cluster before a break candidate' : 'prefix or suffix with a joiner'
      if (has(under, 'prepareGecko')) {
        if (call.text === ' ' || call.text === '\u00a0') return 'space'
        if (PICTOGRAPH.test(call.text) || call.settings.includes('Apple Color Emoji')) return 'emoji recipe'
        return 'unit (a word)'
      }
      return 'other'
  }
}

// What the string is, whatever it is for: clusters are counted as code points that aren't marks, joiners or variation
// selectors, which is near enough for a table of shapes.
const NO_CLUSTER = /[\p{M}\u200c\u200d\u2060\ufe00-\ufe0f]/u
const SPACES = /[ \u00a0\u2028\u3000]/
function shapeOf(text: string): string {
  let clusters = 0
  for (const ch of text) if (!NO_CLUSTER.test(ch)) clusters++
  if (clusters <= 1) return SPACES.test(text) ? 'a space alone' : 'one cluster'
  if (clusters === 2) return 'two clusters'
  // A space inside, not only at the end (WebKit measures a word with its trailing space).
  return SPACES.test(text.slice(0, -1).trimStart()) ? 'several words' : 'one word or a part of one'
}

// ---- Parts ----

type Tally = { asks: number; units: number; firstInParagraph: number; firstOnPage: number; firstOnPageUnits: number }
const newTally = (): Tally => ({ asks: 0, units: 0, firstInParagraph: 0, firstOnPage: 0, firstOnPageUnits: 0 })

function add(map: Map<string, Tally>, key: string): Tally {
  let tally = map.get(key)
  if (tally === undefined) {
    tally = newTally()
    map.set(key, tally)
  }
  return tally
}

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const engine = (options.get('engine') ?? 'blink') as EngineName
const set = (options.get('set') ?? 'mix') as ChatSetId
const count = Number(options.get('count') ?? 10000)
const part = options.get('part') ?? 'store'
const widths = (options.get('widths') ?? '260,320,380,440').split(',').map(Number)
// The study counted at 2. Blink measures at the zoomed size, so what it asks follows the ratio (research: the realism study).
const devicePixelRatio = Number(options.get('device-pixel-ratio') ?? 2)

const messages = part === 'tier' ? [] : buildChat(set, count)
if (part !== 'tier') {
  installStandInCanvas({ userAgent: USER_AGENTS[engine], devicePixelRatio, pageLang: CHAT_STYLE.lang })
  installLog()
}
const detected = part === 'tier' ? null : detectEnvironment(givenFacts(engine))
if (detected !== null && detected.kind === 'unsupported') throw new Error(detected.reason)
const env = (detected !== null && detected.kind === 'supported' ? detected.env : null)!

function prepareMessage(message: ChatMessage): Prepared {
  phase = 'checks'
  const checked = withFontChecks(paragraphOf(message), env)
  phase = 'prepare'
  const prepared = prepareChecked(checked, env)
  phase = 'fill'
  return prepared
}

const report: Record<string, unknown> = { engine, set, messages: count, part, devicePixelRatio }
const CHECKPOINTS = [100, 1000, 10000]

// A store with the page's lifetime: per settings, the strings it holds.
type Store = Map<string, Set<string>>
function firstIn(store: Store, settings: string, text: string): boolean {
  let strings = store.get(settings)
  if (strings === undefined) {
    strings = new Set()
    store.set(settings, strings)
  }
  if (strings.has(text)) return false
  strings.add(text)
  return true
}

function rows(map: Map<string, Tally>, total: Tally, over: number): unknown[] {
  return [...map].sort((a, b) => b[1].asks - a[1].asks).map(([key, tally]) => ({
    key, asksPerMessage: tally.asks / over, share: tally.asks / total.asks, meanUnits: tally.units / tally.asks, unitsShare: tally.units / total.units,
    firstInParagraphPerMessage: tally.firstInParagraph / over, missesPerMessage: tally.firstOnPage / over, hitRate: 1 - tally.firstOnPage / tally.asks,
    meanMissUnits: tally.firstOnPage === 0 ? 0 : tally.firstOnPageUnits / tally.firstOnPage,
  }))
}

if (part === 'store' || part === 'sites') {
  wantStacks = true
  const page: Store = new Map()
  let paragraph = new Set<string>()
  const byPhase = new Map<string, Tally>()
  const byPurpose = new Map<string, Tally>()
  const byShape = new Map<string, Tally>()
  const byPurposeAndShape = new Map<string, Tally>()
  const bySite = new Map<string, Tally>()
  // The same tallies over the last tenth of the messages, where the store is as warm as the run makes it.
  const lateByPurpose = new Map<string, Tally>()
  const lateByPhase = new Map<string, Tally>()
  const lateTotal = newTally()
  const lateFrom = count - Math.floor(count / 10)
  const total = newTally()
  const curve: unknown[] = []
  let last = { ...total }
  let longest = 0
  let message = 0
  onCall = call => {
    const read = readStack(call.stack)
    const purpose = purposeOf(engine, call, read.under)
    const shape = shapeOf(call.text)
    const tallies = [total, add(byPhase, call.phase), add(byPurpose, `${call.phase}: ${purpose}`), add(byShape, shape), add(byPurposeAndShape, `${call.phase}: ${purpose} / ${shape}`)]
    if (part === 'sites') tallies.push(add(bySite, `${call.phase}: ${read.site}`))
    if (message >= lateFrom) tallies.push(lateTotal, add(lateByPhase, call.phase), add(lateByPurpose, `${call.phase}: ${purpose}`))
    const local = `${call.settings}\n${call.text}`
    const firstInParagraph = !paragraph.has(local)
    if (firstInParagraph) paragraph.add(local)
    const firstOnPage = firstIn(page, call.settings, call.text)
    if (call.text.length > longest) longest = call.text.length
    for (let i = 0; i < tallies.length; i++) {
      const tally = tallies[i]!
      tally.asks++
      tally.units += call.text.length
      if (firstInParagraph) tally.firstInParagraph++
      if (firstOnPage) {
        tally.firstOnPage++
        tally.firstOnPageUnits += call.text.length
      }
    }
  }
  for (message = 0; message < count; message++) {
    paragraph = new Set()
    fillAll(prepareMessage(messages[message]!), CHAT_WIDTH)
    if (CHECKPOINTS.includes(message + 1)) {
      const n = message + 1
      curve.push({
        messages: n, settingsOnPage: page.size,
        cumulative: { asksPerMessage: total.asks / n, missesPerMessage: total.firstOnPage / n, hitRate: 1 - total.firstOnPage / total.asks, storedStrings: total.firstOnPage, storedUnits: total.firstOnPageUnits },
        sinceLastCheckpoint: {
          asks: total.asks - last.asks, misses: total.firstOnPage - last.firstOnPage, hitRate: 1 - (total.firstOnPage - last.firstOnPage) / (total.asks - last.asks),
          missUnits: total.firstOnPageUnits - last.firstOnPageUnits,
        },
      })
      last = { ...total }
    }
  }
  report['perMessage'] = { asks: total.asks / count, units: total.units / count, firstInParagraph: total.firstInParagraph / count, misses: total.firstOnPage / count, contexts: contextsMade / count }
  report['longestUnits'] = longest
  report['curve'] = curve
  report['byPhase'] = rows(byPhase, total, count)
  report['byPurpose'] = rows(byPurpose, total, count)
  report['byShape'] = rows(byShape, total, count)
  report['byPurposeAndShape'] = rows(byPurposeAndShape, total, count)
  report['lastTenth'] = { messages: count - lateFrom, total: rows(new Map([['all', lateTotal]]), lateTotal, count - lateFrom), byPhase: rows(lateByPhase, lateTotal, count - lateFrom), byPurpose: rows(lateByPurpose, lateTotal, count - lateFrom) }
  if (part === 'sites') report['bySite'] = rows(bySite, total, count).slice(0, 60)
}

// What fills ask: per message, from a fresh prepared paragraph per width so that nothing a fill left on the paragraph
// answers the next, the distinct questions of the fill at each width, their union over the widths, and the part of the
// union that prepare hadn't asked. `kept` is the bench's resize: one prepared paragraph filled at 320px, then at the
// other widths, every question counted.
if (part === 'widths') {
  let oneFill = 0
  let oneFillDistinct = 0
  let union = 0
  let unionNew = 0
  let unionUnits = 0
  let prepareAsks = 0
  let keptNew = 0
  let keptAgain = 0
  let fills = 0
  const growth: number[] = widths.map(() => 0)
  for (let i = 0; i < count; i++) {
    const asked = new Set<string>()
    const all = new Set<string>()
    let prepared = new Set<string>()
    for (let w = 0; w < widths.length; w++) {
      const atPrepare = new Set<string>()
      const atFill = new Set<string>()
      onCall = call => {
        const key = `${call.settings}\n${call.text}`
        if (call.phase === 'fill') {
          oneFill++
          atFill.add(key)
        } else if (w === 0) {
          prepareAsks++
          atPrepare.add(key)
        }
      }
      fillAll(prepareMessage(messages[i]!), widths[w]!)
      if (w === 0) prepared = atPrepare
      oneFillDistinct += atFill.size
      fills++
      for (const key of atFill) {
        all.add(key)
        if (!prepared.has(key) && !asked.has(key)) {
          asked.add(key)
          unionUnits += key.length - key.indexOf('\n') - 1
        }
      }
      growth[w]! += all.size
    }
    union += all.size
    unionNew += asked.size
    // The bench's resize: one prepared paragraph filled at 320px, then at the other widths, then at those again.
    const kept = prepareMessage(messages[i]!)
    onCall = () => {}
    fillAll(kept, CHAT_WIDTH)
    onCall = () => { keptNew++ }
    for (let w = 0; w < widths.length; w++) if (widths[w] !== CHAT_WIDTH) fillAll(kept, widths[w]!)
    onCall = () => { keptAgain++ }
    for (let w = 0; w < widths.length; w++) if (widths[w] !== CHAT_WIDTH) fillAll(kept, widths[w]!)
  }
  const otherWidths = widths.filter(width => width !== CHAT_WIDTH).length
  report['widths'] = widths
  report['perMessage'] = {
    prepareAsks: prepareAsks / count, oneFillAsks: oneFill / fills, oneFillDistinct: oneFillDistinct / fills, unionOverWidths: union / count,
    unionNotAskedByPrepare: unionNew / count, unionNotAskedByPrepareMeanUnits: unionNew === 0 ? 0 : unionUnits / unionNew,
    unionAfterEachWidth: growth.map(value => value / count),
    keptAsksPerLayoutAtANewWidth: keptNew / count / otherWidths, keptAsksPerLayoutAtAWidthMetBefore: keptAgain / count / otherWidths,
  }
}

// The questions of a word-and-boundary recipe: every segment of main's analysis alone, and at every boundary between two
// segments the two clusters around it together (each cluster alone is a question too, which a font's few hundred
// clusters soon answer). Counted with a page-lifetime store, as `store` counts today's questions.
if (part === 'short') {
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const firstCluster = (text: string): string => { for (const g of graphemes.segment(text)) return g.segment; return '' }
  const lastCluster = (text: string): string => { let out = ''; for (const g of graphemes.segment(text.slice(-8))) out = g.segment; return out }
  const page: Store = new Map()
  const kinds = ['word', 'boundary pair', 'cluster alone']
  const tallies = new Map<string, Tally>()
  const total = newTally()
  const curve: unknown[] = []
  let last = { ...total }
  const ask = (kind: string, settings: string, text: string): void => {
    const first = firstIn(page, settings, text)
    const both = [total, add(tallies, kind)]
    for (let i = 0; i < both.length; i++) {
      both[i]!.asks++
      both[i]!.units += text.length
      if (first) {
        both[i]!.firstOnPage++
        both[i]!.firstOnPageUnits += text.length
      }
    }
  }
  onCall = () => {}
  for (let i = 0; i < count; i++) {
    const parts = messages[i]!.parts
    for (let k = 0; k < parts.length; k++) {
      const font = parts[k]!.code ? '14px Menlo' : CHAT_STYLE.mainFont
      const segments = prepareWithSegments(parts[k]!.text, font).segments
      for (let s = 0; s < segments.length; s++) {
        ask(kinds[0]!, font, segments[s]!)
        if (s === 0) continue
        const a = lastCluster(segments[s - 1]!)
        const b = firstCluster(segments[s]!)
        ask(kinds[1]!, font, a + b)
        ask(kinds[2]!, font, a)
        ask(kinds[2]!, font, b)
      }
    }
    if (CHECKPOINTS.includes(i + 1)) {
      const n = i + 1
      curve.push({
        messages: n, cumulative: { factsPerMessage: total.asks / n, missesPerMessage: total.firstOnPage / n, storedStrings: total.firstOnPage, storedUnits: total.firstOnPageUnits },
        sinceLastCheckpoint: { missesPerMessage: (total.firstOnPage - last.firstOnPage) / (n - (curve.length === 0 ? 0 : CHECKPOINTS[curve.length - 1]!)), missUnits: total.firstOnPageUnits - last.firstOnPageUnits },
      })
      last = { ...total }
    }
  }
  report['curve'] = curve
  report['byKind'] = rows(tallies, total, count)
}

// The recorded tier cases (tests/replay.ts inputs, no supplied facts) laid out on the plain path from their recorded
// Canvas answers, which are a real browser's: the same tallies as `store`, with the phase read from the stack. A case
// whose plain path asks something its record lacks is left out and counted.
// The lines of lab/predictor-core.ts plainLines that call prepare, fillLine and linePieces.
const PLAIN_LINES_PREPARE = 272
const PLAIN_LINES_FILL = 277
const PLAIN_LINES_PIECES = 284
if (part === 'tier') {
  wantStacks = true
  const browser: TierBrowser = engine === 'blink' ? 'chrome' : engine === 'gecko' ? 'firefox' : 'webkit-host'
  const dir = referenceDir(browser, 'no-facts')
  const manifest = readInputs(dir)
  const chosen = (options.get('sets') ?? Object.keys(manifest.sets).filter(name => !name.startsWith('heldout') && name !== 'twins').join(',')).split(',')
  const page: Store = new Map()
  let paragraph = new Set<string>()
  const total = newTally()
  const byPhase = new Map<string, Tally>()
  const byPurpose = new Map<string, Tally>()
  const byShape = new Map<string, Tally>()
  let cases = 0
  let leftOut = 0
  let lastLine = 0
  onCall = call => {
    const read = readStack(call.stack)
    // The phase is the statement of lab/predictor-core.ts plainLines the call was made under (JavaScriptCore drops the
    // frames of the library's tail calls, so fillLine itself can be missing from the stack).
    const at = /plainLines \(.*predictor-core\.ts:(\d+):/.exec(call.stack)
    // A stack deeper than the host keeps (Blink's measure16 recurses once per script edge) has lost the frame: such a
    // call belongs to the statement the call before it was under.
    const line = at === null ? lastLine : Number(at[1])
    lastLine = line
    let inChecks = false
    for (let i = 0; i < read.under.length; i++) if (read.under[i]!.endsWith('@measure/font-checks.ts')) inChecks = true
    const callPhase: Phase = inChecks ? 'checks' : line === PLAIN_LINES_PREPARE ? 'prepare' : 'fill'
    if (line !== PLAIN_LINES_PREPARE && line !== PLAIN_LINES_FILL && line !== PLAIN_LINES_PIECES) throw new Error(`a call outside plainLines' three statements: line ${line}`)
    const purpose = purposeOf(engine, { ...call, phase: callPhase }, read.under)
    const tallies = [total, add(byPhase, callPhase), add(byPurpose, `${callPhase}: ${purpose}`), add(byShape, shapeOf(call.text))]
    const local = `${call.settings}\n${call.text}`
    const firstInParagraph = !paragraph.has(local)
    if (firstInParagraph) paragraph.add(local)
    const firstOnPage = firstIn(page, call.settings, call.text)
    for (let i = 0; i < tallies.length; i++) {
      const tally = tallies[i]!
      tally.asks++
      tally.units += call.text.length
      if (firstInParagraph) tally.firstInParagraph++
      if (firstOnPage) {
        tally.firstOnPage++
        tally.firstOnPageUnits += call.text.length
      }
    }
  }
  for (let n = 0; n < chosen.length; n++) {
    const shards = manifest.sets[chosen[n]!]!.shards
    for (let k = 0; k < shards.length; k++) {
      const inputs = readShard<InputCase>(join(dir, 'inputs', shards[k]!.file))
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i]!
        paragraph = new Set()
        const replay = installReplay(input.record, input.env, 'predict')
        installLog()
        try {
          plainPredict(input.case, { browser: input.browser, build: input.build.engine, languages: input.languages })
          cases++
        } catch (error) {
          if (!(error instanceof NewQuestion)) throw error
          leftOut++
        } finally {
          replay.restore()
        }
      }
    }
  }
  report['sets'] = chosen
  report['cases'] = cases
  report['leftOutForANewQuestion'] = leftOut
  report['perCase'] = { asks: total.asks / cases, units: total.units / cases, firstInParagraph: total.firstInParagraph / cases, firstOnPage: total.firstOnPage / cases, contexts: contextsMade / cases }
  report['byPhase'] = rows(byPhase, total, cases)
  report['byPurpose'] = rows(byPurpose, total, cases)
  report['byShape'] = rows(byShape, total, cases)
}

// The calls themselves, for a browser to make again (tools/store-replay-probe.ts): per message the contexts it made, in
// order, with their assigned settings, and its calls as (context, string, phase) triples over tables of distinct
// settings and strings. `short` holds the word-and-boundary recipe's questions for the same messages.
if (part === 'trace') {
  const strings = new Map<string, number>()
  const settingsTable = new Map<string, number>()
  const index = (table: Map<string, number>, key: string): number => {
    let at = table.get(key)
    if (at === undefined) {
      at = table.size
      table.set(key, at)
    }
    return at
  }
  const out: Array<{ contexts: number[]; calls: number[]; short: number[] }> = []
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const firstCluster = (value: string): string => { for (const g of graphemes.segment(value)) return g.segment; return '' }
  const lastCluster = (value: string): string => { let last = ''; for (const g of graphemes.segment(value.slice(-8))) last = g.segment; return last }
  for (let i = 0; i < count; i++) {
    liveContexts = []
    const calls: Array<[object, number, number]> = []
    onCall = call => { calls.push([call.context, index(strings, call.text), call.phase === 'checks' ? 0 : call.phase === 'prepare' ? 1 : 2]) }
    fillAll(prepareMessage(messages[i]!), CHAT_WIDTH)
    onCall = () => {}
    const made = liveContexts
    const contexts: number[] = []
    for (let c = 0; c < made.length; c++) {
      const assigned = made[c]!.assigned
      contexts.push(index(settingsTable, JSON.stringify(SETTINGS.map(name => assigned[name] ?? ''))))
    }
    const flat: number[] = []
    for (let k = 0; k < calls.length; k++) flat.push(made.indexOf(calls[k]![0] as { assigned: Record<string, string> }), calls[k]![1], calls[k]![2])
    // 0: the message's main font, 1: the code span's.
    const short: number[] = []
    const parts = messages[i]!.parts
    for (let k = 0; k < parts.length; k++) {
      const font = parts[k]!.code ? 1 : 0
      const segments = prepareWithSegments(parts[k]!.text, parts[k]!.code ? '14px Menlo' : CHAT_STYLE.mainFont).segments
      for (let n = 0; n < segments.length; n++) {
        short.push(font, index(strings, segments[n]!))
        if (n === 0) continue
        const a = lastCluster(segments[n - 1]!)
        const b = firstCluster(segments[n]!)
        short.push(font, index(strings, a + b), font, index(strings, a), font, index(strings, b))
      }
    }
    out.push({ contexts, calls: flat, short })
  }
  report['settingNames'] = SETTINGS
  report['settings'] = [...settingsTable.keys()].map(key => JSON.parse(key) as string[])
  report['strings'] = [...strings.keys()]
  report['trace'] = out
}

const text = part === 'trace' ? JSON.stringify(report) : `${JSON.stringify(report, null, 1)}\n`
if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), text)
else process.stdout.write(text)
