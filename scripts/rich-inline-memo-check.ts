// Differential check for prepareRichInline(items, previous).
//
// Random chains of rich-inline item edits run in one child process per engine
// profile, against a deterministic fake canvas and page stub. After every step,
// the flow prepared with the previous flow must equal a fresh
// prepareRichInline(items) prepared right after it in the same process, and
// that fresh flow must equal pinned main's: every internal item field, every
// item handle array, and every rich line API result at a grid of widths. The
// previous flow must stay unchanged, no item may be reused after clearCache(),
// setLocale() or a page-language change, and in sampled chains a step may make
// no more Canvas calls than a fresh prepare against the same caches.
//
// --canary=font-key|generation|language|all removes one reuse check from
// src/rich-inline.ts at import time. Each canary must find differences.
//
// Usage:
//   bun run scripts/rich-inline-memo-check.ts [--chains=1500] [--large=16] [--seed=1]
//     [--profiles=blink,webkit,gecko,android] [--canary=all]
//     [--main=<ref, default: merge-base of HEAD and main>] [--main-dir=<directory holding main's src/>]

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PreparedRichInline, RichInlineCursor, RichInlineItem, RichInlineLineRange } from '../src/rich-inline.ts'

type RichModule = typeof import('../src/rich-inline.ts')
type LayoutModule = typeof import('../src/layout.ts')
type Profile = 'blink' | 'webkit' | 'gecko' | 'android'
type Canary = 'none' | 'font-key' | 'generation' | 'language'
type DifferenceKind = 'memoFields' | 'memoLayout' | 'mainFields' | 'mainLayout' | 'heldFlow' | 'reuseAfterInvalidation' | 'callExcess'

type Summary = {
  profile: Profile
  canary: Canary
  inlineItemBreaks: string
  entryFitBasis: string
  seed: number
  chains: number
  largeChains: number
  steps: number
  largeSteps: number
  differences: Record<DifferenceKind, number>
  coresReused: number
  coresCreated: number
  stepsWithReuse: number
  invalidatedSteps: number
  unrelatedPreviousSteps: number
  events: { fontLoads: number, locales: number, languages: number, contextReplacements: number }
  callSamples: number
  sampledMemoCalls: number
  sampledFreshCalls: number
  emojiProbes: number
  seconds: number
}

type InternalFlow = {
  items: Array<object | undefined>
  cores: object[]
  documentLanguage: string | null
}

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = fileURLToPath(import.meta.url)

const USER_AGENTS: Record<Profile, string> = {
  blink: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  webkit: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  gecko: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
}
const PROFILES: readonly Profile[] = ['blink', 'webkit', 'gecko', 'android']

// Each canary removes one reuse check. Every search string must occur once.
const CANARY_MUTATIONS: Record<Exclude<Canary, 'none'>, ReadonlyArray<readonly [string, string]>> = {
  'font-key': [
    ['core.text === item.text && core.font === item.font && ', 'core.text === item.text && '],
    ['`${core.font}\\u0000${core.letterSpacing}', '`${core.letterSpacing}'],
    ['`${item.font}\\u0000${item.letterSpacing ?? 0}', '`${item.letterSpacing ?? 0}'],
  ],
  generation: [['prior.generation === generation && prior.documentLanguage', 'prior.documentLanguage']],
  language: [[' && prior.documentLanguage === documentLanguage', '']],
}

const DIFFERENCE_KINDS: readonly DifferenceKind[] = ['memoFields', 'memoLayout', 'mainFields', 'mainLayout', 'heldFlow', 'reuseAfterInvalidation', 'callExcess']

const TOKENS: readonly string[] = [
  // English
  'word', 'Ship', 'the', 'rich', 'note', 'don\'t', 'e.g.', '“quoted”', 'it’s', '–', '—', 'end.', 'foo-bar', '(docs)', ',', '.', '!', '?',
  // CJK
  '中文字', '。', '「', '」', '，', 'ア', 'ー', 'ッ', 'ゃ', '々', 'ラーメン', 'ァア', '한국어', '（', '）', '\u3000',
  // Arabic and Hebrew
  'عربي', '،', '؟', '\u064B', 'שלום', '־',
  // Southeast Asian
  'ภาษาไทย', 'ไทย', 'ျ', '၏',
  // Emoji
  '\u{1F600}', '\u{1F44D}\u{1F3FD}', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', '\u{1F1EF}\u{1F1F5}\u{1F1FA}\u{1F1F8}', '❤\uFE0F',
  // Glue and breaks
  'ab\u00ADcd', '\u00AD', '\u00A0', '\u202F', '\u2060', '\u200B', '\u200D', '\u0301', '\u202A', '\u2066', '\u202C', '\u2069',
  // URLs
  'https://a.com/p?q=1&r=2', 'www.a.com/www.b?q=1',
  // Numbers
  '1,000.5', '1-2-3-4-5x', '3.14', '00:00', '$5', '-5%',
  // Whitespace
  ' ', '  ', '\t', '\n', '\r\n', '\r', '\f', '\u0085', '\u2029',
  // Broken input
  '\uD83D', '\uDE00',
]

const CORPORA = [
  'mixed-app-text', 'en-gatsby-opening', 'ja-rashomon', 'zh-zhufu', 'ko-sonagi', 'ar-risalat-al-ghufran-part-1', 'ur-chughd',
  'he-masaot-binyamin-metudela', 'th-nithan-vetal-story-1', 'my-cunning-heron-teacher', 'km-prachum-reuang-preng-khmer-volume-7-stories-1-10', 'hi-eidgah',
]

const FONTS = ['16px Test', 'bold 16px Test', '600 13px Test'] as const
const LETTER_SPACINGS = [0, 1, -0.5, 2.25] as const
const LOCALES = [undefined, 'en', 'ja', 'th', 'ar-EG'] as const
const LANGUAGES = ['', 'ja', 'ko', 'en'] as const
const WIDTHS = [1, 23, 57.5, 120, 300, 1e7] as const

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i]!.startsWith(prefix)) return process.argv[i]!.slice(prefix.length)
  }
  return undefined
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

// Main's src/ at a pinned commit, loaded as separate modules in each child.
function extractMainSources(ref: string): string {
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`])
  const directory = join(tmpdir(), `pretext-rich-inline-memo-main-${commit.slice(0, 12)}`)
  if (!existsSync(join(directory, 'src', 'rich-inline.ts'))) {
    mkdirSync(directory, { recursive: true })
    execFileSync('sh', ['-c', 'git archive "$1" src | tar -x -C "$2"', 'sh', commit, directory], { cwd: ROOT })
  }
  return directory
}

async function runDriver(): Promise<void> {
  const profiles = (getArg('profiles') ?? PROFILES.join(',')).split(',') as Profile[]
  const canaryArg = getArg('canary') ?? 'none'
  const canaries: Canary[] = canaryArg === 'all' ? ['font-key', 'generation', 'language'] : [canaryArg as Canary]
  const mainDir = getArg('main-dir') ?? extractMainSources(getArg('main') ?? git(['merge-base', 'HEAD', 'main']))
  const forwarded = process.argv.slice(2).filter(arg => /^--(chains|large|seed)=/.test(arg))
  const jobs: Array<{ profile: Profile, canary: Canary }> = []
  for (let c = 0; c < canaries.length; c++) {
    for (let p = 0; p < profiles.length; p++) jobs.push({ profile: profiles[p]!, canary: canaries[c]! })
  }

  const summaries: Summary[] = []
  let failed = false
  let nextJob = 0
  async function worker(): Promise<void> {
    while (nextJob < jobs.length) {
      const job = jobs[nextJob++]!
      const label = `[${job.profile} ${job.canary}]`
      const child = Bun.spawn(
        [process.execPath, SCRIPT, `--child=${job.profile}`, `--canary=${job.canary}`, `--main-dir=${mainDir}`, ...forwarded],
        { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
      )
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      const lines = stdout.trimEnd().split('\n')
      for (let i = 0; i < lines.length - 1; i++) console.log(`${label} ${lines[i]}`)
      if (exitCode !== 0) {
        failed = true
        console.error(`${label} exited with ${exitCode}\n${lines.at(-1) ?? ''}\n${stderr}`)
        continue
      }
      summaries.push(JSON.parse(lines.at(-1)!) as Summary)
    }
  }
  // At most four children at a time.
  await Promise.all([worker(), worker(), worker(), worker()])

  for (let i = 0; i < summaries.length; i++) {
    const summary = summaries[i]!
    const { differences } = summary
    let total = 0
    for (let k = 0; k < DIFFERENCE_KINDS.length; k++) total += differences[DIFFERENCE_KINDS[k]!]
    const detected = differences.memoFields + differences.memoLayout + differences.reuseAfterInvalidation
    const verdict = summary.canary === 'none'
      ? (total === 0 ? 'pass' : 'FAIL')
      : (detected > 0 && differences.mainFields + differences.mainLayout === 0 ? 'canary detected' : 'CANARY MISSED')
    if (verdict === 'FAIL' || verdict === 'CANARY MISSED') failed = true
    console.log(`${verdict}: ${JSON.stringify(summary)}`)
  }
  if (summaries.length !== jobs.length) failed = true
  console.log(failed ? 'FAIL' : 'PASS')
  process.exit(failed ? 1 : 0)
}

// --- Child process: fake page, canvas and chains ---

const page = { lang: '' }
// Start proportional, where emoji correction applies; font loads cycle tables.
let widthTable = 1
let canvasCalls = 0
let contextsCreated = 0
let emojiProbes = 0

function parseFontSize(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font)
  return match === null ? 16 : Number(match[1])
}

const ignorableRe = /\p{Default_Ignorable_Code_Point}/u
const wideRe = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-〿\uFF00-｠]/u
const emojiRe = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u
const advanceCache = new Map<number, number>()

// Advance at 16px. A width table stands in for a loaded web font. Table 0 is
// fixed width: 10 per code point and 4 per space. Tables 1 and 2 are
// proportional, with different glyph widths, emoji wider than the font size,
// and East Asian glyphs that depend on the page language of the context.
function getAdvance(code: number, language: string): number {
  const languageIndex = language === 'ja' ? 1 : language === 'ko' ? 2 : 0
  const key = (code * 3 + widthTable) * 3 + languageIndex
  let advance = advanceCache.get(key)
  if (advance !== undefined) return advance
  const character = String.fromCodePoint(code)
  if (ignorableRe.test(character)) advance = 0
  else if (widthTable === 0) advance = code === 0x20 ? 4 : 10
  else if (code === 0x20) advance = widthTable === 1 ? 4.25 : 3.5
  else if (emojiRe.test(character)) advance = 20
  else if (wideRe.test(character)) advance = 16 - languageIndex * 0.5
  else advance = 5 + ((Math.imul(code + widthTable * 7919, 2654435761) >>> 0) % 8) + (code % 8) / 8
  advanceCache.set(key, advance)
  return advance
}

// Fixed width: -1 for a space after 'o', -2 for 'bc'. Proportional: some pairs.
function getKerning(previous: number, code: number): number {
  if (widthTable === 0) return previous === 0x6F && code === 0x20 ? 1 : previous === 0x62 && code === 0x63 ? 2 : 0
  return previous !== 0 && (previous * 31 + code) % 7 === widthTable ? 0.75 : 0
}

class FakeContext {
  font = '16px Test'
  letterSpacing = '0px'
  direction = 'ltr'
  fontKerning = 'auto'
  fontStretch = 'normal'
  fontVariantCaps = 'normal'
  textRendering = 'auto'
  wordSpacing = '0px'
  lang = 'inherit'
  // A context resolves fonts under the page language it was created under.
  readonly pageLanguage = page.lang

  constructor() {
    contextsCreated++
  }

  measureText(text: string): { width: number } {
    canvasCalls++
    const scale = parseFontSize(this.font) / 16
    const bold = /bold|[6-9]00/.test(this.font) ? 0.5 : 0
    const spacing = Number.parseFloat(this.letterSpacing)
    let width = 0
    let visible = 0
    let previous = 0
    for (let i = 0; i < text.length;) {
      const code = text.codePointAt(i)!
      i += code > 0xFFFF ? 2 : 1
      const advance = getAdvance(code, this.pageLanguage)
      if (advance === 0) continue
      visible++
      width += advance * scale + bold - getKerning(previous, code)
      previous = code
    }
    return { width: width + (Number.isFinite(spacing) ? spacing : 0) * visible }
  }
}

function installPage(profile: Profile): void {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: USER_AGENTS[profile] } })
  Reflect.set(globalThis, 'OffscreenCanvas', class {
    getContext(): FakeContext {
      return new FakeContext()
    }
  })
  Reflect.set(globalThis, 'document', {
    documentElement: page,
    body: { appendChild() {}, removeChild() {} },
    // The emoji-correction probe. The DOM draws an emoji at the font size, so
    // proportional tables give a nonzero correction.
    createElement() {
      emojiProbes++
      const style = { font: '' }
      return { style, textContent: '', getBoundingClientRect: () => ({ width: parseFontSize(style.font) }) }
    },
  })
}

function installCanary(canary: Exclude<Canary, 'none'>): void {
  const path = fileURLToPath(new URL('../src/rich-inline.ts', import.meta.url))
  Bun.plugin({
    name: `rich-inline-memo-canary-${canary}`,
    setup(build) {
      build.onLoad({ filter: new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }, async args => {
        let contents = await Bun.file(args.path).text()
        const mutations = CANARY_MUTATIONS[canary]
        for (let i = 0; i < mutations.length; i++) {
          const [search, replacement] = mutations[i]!
          const count = contents.split(search).length - 1
          if (count !== 1) throw new Error(`--canary=${canary}: ${JSON.stringify(search)} occurs ${count} times in src/rich-inline.ts`)
          contents = contents.replace(search, () => replacement)
        }
        return { contents, loader: 'ts' }
      })
    },
  })
}

function internal(flow: PreparedRichInline): InternalFlow {
  return flow as unknown as InternalFlow
}

function escapeForLog(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007F-\uFFFF]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeItem(text: string, font: string, letterSpacing?: number, breakMode?: 'normal' | 'never', extraWidth?: number): RichInlineItem {
  const item: RichInlineItem = { text, font }
  if (letterSpacing !== undefined) item.letterSpacing = letterSpacing
  if (breakMode !== undefined) item.break = breakMode
  if (extraWidth !== undefined) item.extraWidth = extraWidth
  return item
}

function copyItem(item: RichInlineItem, text: string, font: string = item.font): RichInlineItem {
  return makeItem(text, font, item.letterSpacing, item.break, item.extraWidth)
}

function layoutSignature(rich: RichModule, flow: PreparedRichInline, widths: readonly number[]): string {
  const parts: string[] = []
  for (let w = 0; w < widths.length; w++) {
    const width = widths[w]!
    const walked: RichInlineLineRange[] = []
    const lineCount = rich.walkRichInlineLineRanges(flow, width, range => {
      walked.push(range)
    })
    const stepped: RichInlineLineRange[] = []
    let cursor: RichInlineCursor | undefined
    while (stepped.length <= lineCount) {
      const range = rich.layoutNextRichInlineLineRange(flow, width, cursor)
      if (range === null) break
      stepped.push(range)
      cursor = range.end
    }
    const lines = []
    for (let i = 0; i < walked.length; i++) lines.push(rich.materializeRichInlineLineRange(flow, walked[i]!))
    parts.push(JSON.stringify([width, lineCount, walked, stepped, lines, rich.measureRichInlineStats(flow, width)]))
  }
  return parts.join('\n')
}

type Environment = { widthTable: number, language: string, locale: string | undefined }
type EnvironmentEvent =
  | { kind: 'font-load' }
  | { kind: 'locale', locale: string | undefined }
  | { kind: 'language', language: string }
type HistoryStep = { items: RichInlineItem[], event: EnvironmentEvent | null, unrelated: PreparedRichInline | null }
type Edit = { items: RichInlineItem[], operation: string }

async function runChild(profile: Profile): Promise<void> {
  const canary = (getArg('canary') ?? 'none') as Canary
  const seed = Number(getArg('seed') ?? 1)
  const chainCount = Number(getArg('chains') ?? 1500)
  const largeChainCount = Number(getArg('large') ?? 16)
  const mainDir = getArg('main-dir')
  if (mainDir === undefined) throw new Error('A child process needs --main-dir')

  installPage(profile)
  if (canary !== 'none') installCanary(canary)
  const branchLayout: LayoutModule = await import('../src/layout.ts')
  const branchRich: RichModule = await import('../src/rich-inline.ts')
  const { getEngineProfile } = await import('../src/measurement.ts')
  const { TEXTS } = await import('../src/test-data.ts')
  const mainLayout = (await import(join(mainDir, 'src', 'layout.ts'))) as LayoutModule
  const mainRich = (await import(join(mainDir, 'src', 'rich-inline.ts'))) as RichModule

  const random = createRandom(seed * 7919 + PROFILES.indexOf(profile) * 104729)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!
  const { lineFitEpsilon } = getEngineProfile()
  const corpora = CORPORA.map(id => readFileSync(join(ROOT, 'corpora', `${id}.txt`), 'utf8').slice(0, 8000))
  const largeWordLists = [corpora[1]!, corpora[0]!].map(text => text.split(/\s+/).filter(word => word.length > 0))

  const differences: Record<DifferenceKind, number> = {
    memoFields: 0, memoLayout: 0, mainFields: 0, mainLayout: 0, heldFlow: 0, reuseAfterInvalidation: 0, callExcess: 0,
  }
  const summary: Summary = {
    profile,
    canary,
    inlineItemBreaks: getEngineProfile().inlineItemBreaks,
    entryFitBasis: getEngineProfile().entryFitBasis,
    seed,
    chains: chainCount,
    largeChains: largeChainCount,
    steps: 0,
    largeSteps: 0,
    differences,
    coresReused: 0,
    coresCreated: 0,
    stepsWithReuse: 0,
    invalidatedSteps: 0,
    unrelatedPreviousSteps: 0,
    events: { fontLoads: 0, locales: 0, languages: 0, contextReplacements: 0 },
    callSamples: 0,
    sampledMemoCalls: 0,
    sampledFreshCalls: 0,
    emojiProbes: 0,
    seconds: 0,
  }

  function record(kind: DifferenceKind, describe: () => object): void {
    differences[kind]++
    if (differences[kind] <= 3) console.log(`DIFF ${kind} ${escapeForLog(describe())}`)
  }

  // Break mostly outside surrogate pairs, sometimes inside one.
  function snapOffset(text: string, offset: number): number {
    const code = text.charCodeAt(offset)
    return offset > 0 && code >= 0xDC00 && code <= 0xDFFF && random() < 0.9 ? offset - 1 : offset
  }

  function randomSlice(source: string): string {
    const start = snapOffset(source, Math.floor(random() * source.length))
    return source.slice(start, snapOffset(source, Math.min(source.length, start + 3 + Math.floor(random() * 38))))
  }

  function randomPiece(): string {
    const r = random()
    if (r < 0.12) return randomSlice(pick(corpora))
    if (r < 0.18) return randomSlice(pick(TEXTS).text)
    return pick(TOKENS)
  }

  function randomText(): string {
    const r = random()
    if (r < 0.05) return ''
    if (r < 0.12) return pick([' ', '  ', '\n', '\t ', ' \n', '\r\n', '\f'])
    let text = random() < 0.3 ? pick([' ', '\n ', '  ', '\t']) : ''
    const count = 1 + Math.floor(random() * 6)
    for (let i = 0; i < count; i++) {
      text += randomPiece()
      if (random() < 0.45) text += ' '
    }
    if (random() < 0.25) text += pick([' ', '\u200B', '\n', '\t'])
    return text
  }

  function randomItem(): RichInlineItem {
    return makeItem(
      randomText(),
      pick(FONTS),
      random() < 0.2 ? pick(LETTER_SPACINGS) : undefined,
      random() < 0.12 ? 'never' : undefined,
      random() < 0.2 ? pick([0, 6, 16.5]) : undefined,
    )
  }

  // The baseline's chat message: plain spans with their spaces, bold spans that
  // abut the next span, links, and atomic mention chips.
  function buildLargeItems(words: readonly string[], count: number): RichInlineItem[] {
    let cursor = Math.floor(random() * words.length)
    const take = (n: number): string => {
      const out: string[] = []
      for (let i = 0; i < n; i++) out.push(words[cursor++ % words.length]!)
      return out.join(' ')
    }
    const items: RichInlineItem[] = []
    for (let i = 0; i < count; i++) {
      switch (i % 6) {
        case 0: items.push(makeItem(`${take(4)} `, '16px Test')); break
        case 1: items.push(makeItem(take(2), 'bold 16px Test')); break
        case 2: items.push(makeItem(`, ${take(5)} `, '16px Test')); break
        case 3: items.push(makeItem(`example.com/${take(1)}/${i}`, '16px Test')); break
        case 4: items.push(makeItem(` ${take(3)} `, '16px Test')); break
        default: items.push(makeItem(`@${take(1)}`, '600 13px Test', undefined, 'never', 16)); break
      }
    }
    return items
  }

  function editItems(items: readonly RichInlineItem[]): Edit {
    const out = items.slice()
    if (out.length === 0) {
      out.push(randomItem())
      return { items: out, operation: 'insert' }
    }
    const index = Math.floor(random() * out.length)
    const item = out[index]!
    const { text } = item
    const r = random()
    if (r < 0.2) {
      const at = snapOffset(text, Math.floor(random() * (text.length + 1)))
      const edited = random() < 0.55
        ? text.slice(0, at) + randomPiece() + text.slice(at)
        : text.slice(0, at) + text.slice(snapOffset(text, Math.min(text.length, at + 1 + Math.floor(random() * 5))))
      out[index] = copyItem(item, edited)
      return { items: out, operation: 'edit' }
    }
    if (r < 0.3) {
      out[index] = copyItem(item, text + pick(['h', 'e', 'l', 'o', ' ', 'ー', '字', 'ก', '\u0301', '\u{1F44D}', '\u00AD']))
      return { items: out, operation: 'type' }
    }
    if (r < 0.38) {
      // Restyle a sub-range: a three-way split with another font.
      const a = snapOffset(text, Math.floor(random() * (text.length + 1)))
      const b = snapOffset(text, a + Math.floor(random() * (text.length - a + 1)))
      out.splice(index, 1, copyItem(item, text.slice(0, a)), copyItem(item, text.slice(a, b), pick(FONTS)), copyItem(item, text.slice(b)))
      return { items: out, operation: 'split' }
    }
    if (r < 0.44) {
      for (let i = 0; i + 1 < out.length; i++) {
        const j = (index + i) % (out.length - 1)
        const left = out[j]!
        const right = out[j + 1]!
        if (left.font === right.font && left.letterSpacing === right.letterSpacing && left.break === right.break && left.extraWidth === right.extraWidth) {
          out.splice(j, 2, copyItem(left, left.text + right.text))
          return { items: out, operation: 'merge' }
        }
      }
      // No equal neighbors: insert instead.
    }
    if (r < 0.49) {
      out.splice(Math.floor(random() * (out.length + 1)), 0, randomItem())
      return { items: out, operation: 'insert' }
    }
    if (r < 0.54) {
      out.splice(index, 1)
      return { items: out, operation: 'delete' }
    }
    if (r < 0.58) {
      out.push(randomItem())
      return { items: out, operation: 'append' }
    }
    if (r < 0.61) {
      out.unshift(randomItem())
      return { items: out, operation: 'prepend' }
    }
    if (r < 0.65) {
      out.splice(index, 1)
      out.splice(Math.floor(random() * (out.length + 1)), 0, item)
      return { items: out, operation: 'reorder' }
    }
    if (r < 0.7) {
      out[index] = copyItem(item, text, pick(FONTS))
      return { items: out, operation: 'font' }
    }
    if (r < 0.74) {
      out[index] = makeItem(text, item.font, pick([undefined, ...LETTER_SPACINGS]), item.break, item.extraWidth)
      return { items: out, operation: 'letter-spacing' }
    }
    if (r < 0.77) {
      out[index] = makeItem(text, item.font, item.letterSpacing, item.break === 'never' ? 'normal' : 'never', item.extraWidth)
      return { items: out, operation: 'break' }
    }
    if (r < 0.8) {
      out[index] = makeItem(text, item.font, item.letterSpacing, item.break, pick([undefined, 0, 9, 16.5]))
      return { items: out, operation: 'extra-width' }
    }
    if (r < 0.9) {
      // A re-parse: new item objects and new strings with the same content.
      return { items: out.map(entry => copyItem(entry, ` ${entry.text}`.slice(1))), operation: 'reparse' }
    }
    return { items: out, operation: 'unchanged' }
  }

  // Keystrokes into the middle text item of a large flow.
  function typeIntoMiddle(items: readonly RichInlineItem[], step: number): Edit {
    let index = Math.floor(items.length / 2)
    while (index < items.length && items[index]!.break === 'never') index++
    if (index === items.length) return editItems(items)
    const out = items.slice()
    out[index] = copyItem(items[index]!, items[index]!.text + 'hello '.charAt(step % 6))
    return { items: out, operation: 'type-middle' }
  }

  let locale: string | undefined
  let epoch = 0
  let branchHasContext = false
  const flowStates = new WeakMap<PreparedRichInline, { epoch: number, language: string }>()
  const otherFlows: PreparedRichInline[] = []

  function randomEvent(): EnvironmentEvent | null {
    const r = random()
    if (r < 0.02) return { kind: 'font-load' }
    if (r < 0.035) return { kind: 'locale', locale: pick(LOCALES) }
    if (r < 0.05) return { kind: 'language', language: pick(LANGUAGES.filter(language => language !== page.lang)) }
    return null
  }

  function applyEvent(event: EnvironmentEvent | null, includeMain: boolean): void {
    if (event === null) return
    switch (event.kind) {
      case 'font-load':
        // A web font loaded, then the app cleared the caches.
        widthTable = (widthTable + 1) % 3
        branchLayout.clearCache()
        if (includeMain) mainLayout.clearCache()
        epoch++
        break
      case 'locale':
        locale = event.locale
        branchLayout.setLocale(event.locale)
        if (includeMain) mainLayout.setLocale(event.locale)
        epoch++
        break
      case 'language':
        page.lang = event.language
        break
    }
  }

  function restoreEnvironment(environment: Environment): void {
    widthTable = environment.widthTable
    page.lang = environment.language
    locale = environment.locale
    branchLayout.setLocale(environment.locale)
    epoch++
  }

  // A branch context created after the first replaces it for a new page
  // language, which clears the caches.
  function prepareBranch(items: RichInlineItem[], previous: PreparedRichInline | null): PreparedRichInline {
    const before = contextsCreated
    const flow = previous === null ? branchRich.prepareRichInline(items) : branchRich.prepareRichInline(items, previous)
    const created = contextsCreated - before
    if (created > 0) {
      const replacements = branchHasContext ? created : created - 1
      branchHasContext = true
      summary.events.contextReplacements += replacements
      if (replacements > 0) epoch++
    }
    return flow
  }

  function checkStep(items: RichInlineItem[], previous: PreparedRichInline | null, large: boolean, describe: () => object): PreparedRichInline {
    const held = previous !== null && (!large || random() < 0.25) ? structuredClone(internal(previous)) : null
    const previousState = previous === null ? undefined : flowStates.get(previous)
    const invalidated = previousState !== undefined && (previousState.epoch !== epoch || previousState.language !== page.lang)
    const state = { epoch, language: page.lang }
    const memo = prepareBranch(items, previous)
    const fresh = prepareBranch(items, null)
    flowStates.set(memo, state)
    const main = mainRich.prepareRichInline(items)
    const memoFlow = internal(memo)
    const freshFlow = internal(fresh)

    if (
      !Bun.deepEquals(memoFlow.items, freshFlow.items, true) ||
      !Bun.deepEquals(memoFlow.cores, freshFlow.cores, true) ||
      memoFlow.documentLanguage !== freshFlow.documentLanguage
    ) {
      record('memoFields', describe)
    }
    if (!Bun.deepEquals(freshFlow.items, internal(main).items, true)) record('mainFields', describe)

    const widths: number[] = [...WIDTHS]
    if (!large) {
      // Lines whose width is within the fit epsilon of the available width.
      let added = 0
      branchRich.walkRichInlineLineRanges(fresh, 120, range => {
        if (added++ < 2) widths.push(range.width - lineFitEpsilon, range.width + lineFitEpsilon)
      })
    }
    const freshLayout = layoutSignature(branchRich, fresh, widths)
    if (layoutSignature(branchRich, memo, widths) !== freshLayout) record('memoLayout', describe)
    if (layoutSignature(mainRich, main, widths) !== freshLayout) record('mainLayout', describe)
    if (held !== null && !Bun.deepEquals(held, internal(previous!), true)) record('heldFlow', describe)

    let reused = 0
    if (previous !== null) {
      const previousCores = new Set<object>(internal(previous).cores)
      for (let i = 0; i < memoFlow.cores.length; i++) {
        if (previousCores.has(memoFlow.cores[i]!)) reused++
      }
      if (reused > 0) summary.stepsWithReuse++
      if (invalidated) {
        summary.invalidatedSteps++
        if (reused > 0) record('reuseAfterInvalidation', describe)
      }
    }
    summary.coresReused += reused
    summary.coresCreated += memoFlow.cores.length - reused
    return memo
  }

  // Canvas calls of one step against the caches a replay of the chain before
  // it leaves, prepared with the previous flow and freshly.
  function replayCanvasCalls(history: readonly HistoryStep[], start: Environment, stepIndex: number, withPrevious: boolean): number {
    restoreEnvironment(start)
    let flow: PreparedRichInline | null = null
    for (let j = 0; j < stepIndex; j++) {
      applyEvent(history[j]!.event, false)
      flow = branchRich.prepareRichInline(history[j]!.items)
    }
    const step = history[stepIndex]!
    applyEvent(step.event, false)
    const before = canvasCalls
    if (withPrevious) branchRich.prepareRichInline(step.items, step.unrelated ?? flow!)
    else branchRich.prepareRichInline(step.items)
    return canvasCalls - before
  }

  function runChain(chain: number, initialItems: RichInlineItem[], stepCount: number, large: boolean, sampleCalls: boolean): void {
    const start: Environment = { widthTable, language: page.lang, locale }
    const history: HistoryStep[] = [{ items: initialItems, event: null, unrelated: null }]
    let items = initialItems
    let flow = checkStep(items, null, large, () => ({ chain, step: 0, items }))
    if (large) summary.largeSteps++
    else summary.steps++
    for (let step = 1; step <= stepCount; step++) {
      const event = randomEvent()
      if (event !== null) {
        if (event.kind === 'font-load') summary.events.fontLoads++
        else if (event.kind === 'locale') summary.events.locales++
        else summary.events.languages++
      }
      applyEvent(event, true)
      const edit = large && step % 2 === 1 ? typeIntoMiddle(items, step) : editItems(items)
      const unrelated = otherFlows.length > 0 && random() < 0.03 ? pick(otherFlows) : null
      if (unrelated !== null) summary.unrelatedPreviousSteps++
      items = edit.items
      history.push({ items, event, unrelated })
      const stepItems = items
      flow = checkStep(items, unrelated ?? flow, large, () => ({
        chain, step, operation: edit.operation, event, unrelatedPrevious: unrelated !== null,
        language: page.lang, widthTable, locale: locale ?? null, items: stepItems,
      }))
      if (large) summary.largeSteps++
      else summary.steps++
    }
    otherFlows.push(flow)
    if (otherFlows.length > 8) otherFlows.shift()

    if (!sampleCalls) return
    const end: Environment = { widthTable, language: page.lang, locale }
    for (let step = 1; step < history.length; step++) {
      const memoCalls = replayCanvasCalls(history, start, step, true)
      const freshCalls = replayCanvasCalls(history, start, step, false)
      summary.callSamples++
      summary.sampledMemoCalls += memoCalls
      summary.sampledFreshCalls += freshCalls
      if (memoCalls > freshCalls) record('callExcess', () => ({ chain, step, memoCalls, freshCalls, items: history[step]!.items }))
    }
    restoreEnvironment(end)
  }

  const started = performance.now()
  for (let chain = 0; chain < chainCount; chain++) {
    const items: RichInlineItem[] = []
    const itemCount = 1 + Math.floor(random() * 16)
    for (let i = 0; i < itemCount; i++) items.push(randomItem())
    runChain(chain, items, 1 + Math.floor(random() * 10), false, chain % 10 === 0)
  }
  for (let chain = 0; chain < largeChainCount; chain++) {
    const items = buildLargeItems(largeWordLists[chain % 2]!, chain % 4 < 2 ? 50 : 500)
    runChain(chainCount + chain, items, 10, true, chain % 4 === 0)
  }
  summary.emojiProbes = emojiProbes
  summary.seconds = Math.round((performance.now() - started) / 100) / 10
  console.log(JSON.stringify(summary))
}

const childProfile = getArg('child')
if (childProfile === undefined) await runDriver()
else await runChild(childProfile as Profile)
