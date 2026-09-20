// Gecko's word scan (src/engines/gecko/lines.ts wordScan) against the engine's loop, under the stand-in Canvas, with no
// browser: every paragraph of a source is prepared plain by the tree's library and by its copy with the word scan off
// (tools/word-scan-variants.ts `loop`), and filled at every width; each line's fill result and pieces must be the same.
// It also says what the word scan saves and covers:
// - Canvas calls and characters sent, from scratch (prepare and the first fill) and per fill of a kept paragraph at the
//   other widths, with the word scan and without;
// - with `--checked`, a third pass by the `checked` copy, where every scan the word scan decides is decided by the loop
//   too and a difference throws, and whose tally files each line: every scan by the word scan (`word`), a scan left to
//   the loop (`loop`), or no text scan at all (`none`), split by the scripts of the line's text.
// A difference says the two don't compute the same thing from the same answers. The answers are the stand-in's, so
// equality says nothing about a font: that is the function set's plain check on recorded answers, and the browser.
//
//   bun rebuild/tools/word-scan-diff.ts --source=tier|cases|chat-mix|chat-latin|chat-real|languages
//     [--cases=<cases.ndjson>[,<more>]] [--sets=a,b] [--count=N] [--widths=own|60,150,400] [--library=tree|proven]
//     [--overflow-wrap=break-word|normal|anywhere] [--checked] [--shard=i/n] [--out=<report.json>]
//
// `tier` reads the recorded sets' Firefox case files (tests/sets.ts); `cases` any case files; the chat sources and
// `languages` are the bench's (bench/cases.ts), as the bench builds its paragraphs (bench/page.ts chatInputs), at the
// bench's four widths unless --widths names others. `--widths=own` is a case's own width. `--library=proven` holds the
// copy that never passes over a unit's inner candidates against the loop, which is what needs no premise.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CHAT_CODE_FONT, CHAT_CODE_PADDING, CHAT_RESIZE_WIDTHS, CHAT_STYLE, CHAT_WIDTH, buildChat, buildLanguages } from '../bench/cases.ts'
import { makePredictor } from '../lab/predictor-core.ts'
import type { Case } from '../lab/types.ts'
import * as tree from '../src/index.ts'
import type { BoxEdge, Environment, FontDecl, InlineNode, LineSlot, OverflowWrap, Paragraph } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS } from '../src/model.ts'
import { selectSets, partFiles } from '../tests/sets.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'
import { wordScanLibrary, type WordScanTally } from './word-scan-variants.ts'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2] ?? '')
}
const source = options.get('source') ?? 'chat-latin'
const shard = (options.get('shard') ?? '0/1').split('/').map(Number)
const count = options.get('count') === undefined ? Infinity : Number(options.get('count'))
const ownWidths = source === 'tier' || source === 'cases' ? 'own' : [CHAT_WIDTH, ...CHAT_RESIZE_WIDTHS].join(',')
const widthsOption = options.get('widths') ?? ownWidths

type Library = typeof tree
const word: Library = options.get('library') === 'proven' ? await wordScanLibrary('proven') : tree
const loop = await wordScanLibrary('loop')
const checked = options.has('checked') ? await wordScanLibrary('checked') : null

type Input = { id: string; paragraph: Paragraph; env: Environment; width: number; insets: readonly { left: number; right: number }[] }

// ---- Sources ----

// The bench's text style, and its overflow-wrap unless --overflow-wrap names another (the chat sources and languages).
const TEXT_STYLE = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: (options.get('overflow-wrap') ?? 'break-word') as OverflowWrap, lineBreak: 'auto', tabSize: 8 } as const

function chatParagraph(content: InlineNode[]): Paragraph {
  const s = CHAT_STYLE
  const font: FontDecl = { ...s.font, facts: UNKNOWN_FONT_FACTS }
  return { ...TEXT_STYLE, font, content, lineHeight: s.lineHeight, direction: s.direction, lang: s.lang, textIndent: 0, textAlign: 'start' }
}

function chatEnv(): Environment {
  const page = installStandInCanvas({ userAgent: USER_AGENT, devicePixelRatio: 2, pageLang: CHAT_STYLE.lang })
  const detected = tree.detectEnvironment({ engine: 'gecko', build: '156.0', contentLanguage: null, regionalPrefsLocale: null })
  page.restore()
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

let skipped = 0

function inputs(): Input[] {
  switch (source) {
    case 'chat-mix':
    case 'chat-latin':
    case 'chat-real': {
      // bench/page.ts chatInputs.
      const env = chatEnv()
      const messages = buildChat(source === 'chat-mix' ? 'mix' : source === 'chat-latin' ? 'latin' : 'real', Number.isFinite(count) ? count : 10000)
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
    case 'languages': {
      const env = chatEnv()
      return buildLanguages(Number.isFinite(count) ? count : 10000).map((message, i) => ({ id: `${message.language}-${i}`, paragraph: chatParagraph([{ kind: 'text', text: message.text }]), env, width: CHAT_WIDTH, insets: [] }))
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

// ---- One paragraph at its widths, by one library ----

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

type LineRecord = { json: string; decided: 'word' | 'loop' | 'none'; scripts: string }
type Asked = { calls: number; characters: number }
type Pass = { lines: LineRecord[][]; scratch: Asked; kept: Asked & { fills: number }; error: string | null }

const tally = ((globalThis as { wordScanTally?: WordScanTally }).wordScanTally ??= { decided: 0, left: 0 })

function fillAll(lib: Library, prepared: tree.Prepared, width: number, insets: Input['insets'], text: string): LineRecord[] {
  const out: LineRecord[] = []
  let row = 0
  for (let start = lib.firstLine(prepared); start !== null;) {
    const inset = row < insets.length ? insets[row]! : { left: 0, right: 0 }
    const slot: LineSlot = { width, left: inset.left, right: inset.right }
    const decided = tally.decided
    const left = tally.left
    const result = lib.fillLine(prepared, start, slot)
    const lineText = result.kind === 'line' ? text.slice(result.start, result.end) : ''
    const pieces = result.kind === 'line' ? lib.linePieces(prepared, result.line) : null
    out.push({
      json: JSON.stringify(result.kind === 'line' ? { kind: result.kind, start: result.start, end: result.end, next: result.next, hasLineBox: result.hasLineBox, pieces } : { kind: result.kind, next: result.next }),
      decided: tally.left > left ? 'loop' : tally.decided > decided ? 'word' : 'none', scripts: scriptsOf(lineText),
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

function pass(lib: Library, input: Input, widths: readonly number[]): Pass {
  const page = installStandInCanvas({ userAgent: USER_AGENT, devicePixelRatio: 2, pageLang: input.env.pageLang })
  const result: Pass = { lines: [], scratch: { calls: 0, characters: 0 }, kept: { calls: 0, characters: 0, fills: 0 }, error: null }
  try {
    const prepared = lib.prepare(input.paragraph, input.env, false)
    const text = prepared.engine === 'gecko' ? prepared.state.text : ''
    for (let w = 0; w < widths.length; w++) {
      const asked = page.asked()
      result.lines.push(fillAll(lib, prepared, widths[w]!, input.insets, text))
      const after = page.asked()
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
const add = (into: Record<string, number>, key: string): void => { into[key] = (into[key] ?? 0) + 1 }
const report = {
  source, library: options.get('library') ?? 'tree', checked: checked !== null, overflowWrap: TEXT_STYLE.overflowWrap, shard: options.get('shard') ?? '0/1', widths: widthsOption,
  paragraphs: all.length, skipped, layouts: 0, lines: 0,
  differing: [] as { id: string; width: number; line: number; loop: string; word: string }[], errors: [] as { id: string; pass: string; error: string }[],
  linesBy: {} as Record<string, number>, linesByScript: {} as Record<string, Record<string, number>>, layoutsAllWord: 0,
  scratch: { loop: { calls: 0, characters: 0 }, word: { calls: 0, characters: 0 } },
  kept: { loop: { calls: 0, characters: 0, fills: 0 }, word: { calls: 0, characters: 0, fills: 0 } },
  scans: { decided: 0, left: 0 },
}
for (let n = 0; n < all.length; n++) {
  const input = all[n]!
  const widths = widthsOption === 'own' ? [input.width] : widthsOption.split(',').map(Number)
  const byLoop = pass(loop, input, widths)
  const byWord = pass(word, input, widths)
  const byChecked = checked === null ? null : pass(checked, input, widths)
  if (byLoop.error !== null) report.errors.push({ id: input.id, pass: 'loop', error: byLoop.error })
  if (byWord.error !== null) report.errors.push({ id: input.id, pass: 'word', error: byWord.error })
  if (byChecked !== null && byChecked.error !== null) report.errors.push({ id: input.id, pass: 'checked', error: byChecked.error })
  if (byLoop.error !== null || byWord.error !== null || (byChecked !== null && byChecked.error !== null)) continue
  report.scratch.loop.calls += byLoop.scratch.calls
  report.scratch.loop.characters += byLoop.scratch.characters
  report.scratch.word.calls += byWord.scratch.calls
  report.scratch.word.characters += byWord.scratch.characters
  report.kept.loop.calls += byLoop.kept.calls
  report.kept.loop.characters += byLoop.kept.characters
  report.kept.loop.fills += byLoop.kept.fills
  report.kept.word.calls += byWord.kept.calls
  report.kept.word.characters += byWord.kept.characters
  report.kept.word.fills += byWord.kept.fills
  for (let w = 0; w < widths.length; w++) {
    const a = byLoop.lines[w]!
    const lists = byChecked === null ? [byWord.lines[w]!] : [byWord.lines[w]!, byChecked.lines[w]!]
    report.layouts++
    report.lines += a.length
    let differs = false
    for (let l = 0; l < lists.length && !differs; l++) {
      const b = lists[l]!
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (i < a.length && i < b.length && a[i]!.json === b[i]!.json) continue
        differs = true
        if (report.differing.length < 50) report.differing.push({ id: input.id, width: widths[w]!, line: i, loop: i < a.length ? a[i]!.json : '', word: i < b.length ? b[i]!.json : '' })
        else report.differing.length++
        break
      }
    }
    if (byChecked === null) continue
    let allWord = true
    const b = byChecked.lines[w]!
    for (let i = 0; i < b.length; i++) {
      add(report.linesBy, b[i]!.decided)
      add(report.linesByScript[b[i]!.scripts] ??= {}, b[i]!.decided)
      if (b[i]!.decided === 'loop') allWord = false
    }
    if (allWord) report.layoutsAllWord++
  }
}
report.skipped = skipped
report.scans = { decided: tally.decided, left: tally.left }
const out = options.get('out')
if (out !== undefined && out !== '') writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`)
const share = (n: number, of: number): string => of === 0 ? 'none' : `${(100 * n / of).toFixed(1)}%`
console.log(`[word-scan-diff] ${source}, library ${report.library}${report.checked ? ', checked' : ''}, overflow-wrap ${report.overflowWrap}, widths ${widthsOption}, shard ${report.shard}: ${report.paragraphs} paragraphs (${skipped} skipped), ${report.layouts} layouts, ${report.lines} lines`)
console.log(`  differing layouts: ${report.differing.length}; errors: ${report.errors.length}`)
if (report.checked) {
  console.log(`  lines by how they were decided: ${Object.entries(report.linesBy).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v} (${share(v, report.lines)})`).join(', ')}; scans: ${tally.decided} by the word scan, ${tally.left} left to the loop`)
  console.log(`  layouts with no line left to the loop: ${report.layoutsAllWord} (${share(report.layoutsAllWord, report.layouts)})`)
  for (const scripts in report.linesByScript) console.log(`  ${scripts}: ${Object.entries(report.linesByScript[scripts]!).map(([k, v]) => `${k} ${v}`).join(', ')}`)
}
console.log(`  from scratch, per paragraph: loop ${(report.scratch.loop.calls / report.paragraphs).toFixed(2)} calls, ${(report.scratch.loop.characters / report.paragraphs).toFixed(1)} characters; word scan ${(report.scratch.word.calls / report.paragraphs).toFixed(2)} calls, ${(report.scratch.word.characters / report.paragraphs).toFixed(1)} characters`)
if (report.kept.loop.fills > 0) console.log(`  kept, per fill at another width: loop ${(report.kept.loop.calls / report.kept.loop.fills).toFixed(2)} calls, ${(report.kept.loop.characters / report.kept.loop.fills).toFixed(1)} characters; word scan ${(report.kept.word.calls / report.kept.word.fills).toFixed(2)} calls, ${(report.kept.word.characters / report.kept.word.fills).toFixed(1)} characters`)
for (let i = 0; i < Math.min(5, report.differing.length); i++) console.log(`  differs: ${JSON.stringify(report.differing[i])}`)
for (let i = 0; i < Math.min(5, report.errors.length); i++) console.log(`  error: ${JSON.stringify(report.errors[i])}`)
process.exit(report.differing.length > 0 || report.errors.length > 0 ? 1 : 0)
