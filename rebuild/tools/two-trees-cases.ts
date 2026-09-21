// Random tree paragraphs for two-trees.ts, for a step that means to change no prediction. Tier 1 holds a tree to the
// recorded cases, and says nothing of a path no recorded case runs (tests/coverage-map.ts lists those lines). These cases
// go where the recorded WebKit sets don't: word-break and overflow-wrap before content that doesn't wrap
// (lastValidBreakingPosition), complex right-to-left text across spans broken inside a shaped range (the second shaping),
// one span around text and line breaks, inline boxes alone around an empty leaf, soft hyphens before box ends, white space
// to trim beside floats. Planted in the WebKit port on 2026-09-20, a skipped second shaping, a lastValidBreakingPosition
// that never breaks at the run boundary, a history world's item index off by the run's start and a shaping range that
// forgets its leading entry's locale all passed tier 1 with 0 questions changed; two-trees.ts over these cases found each.
//
//   bun rebuild/tools/two-trees-cases.ts --out=<cases.ndjson> [--shapes=20000] [--seed=two-trees-cases-1]
//   bun rebuild/tools/two-trees.ts --a=<commit> --cases=<cases.ndjson> --browser=webkit-host --widths=12,24,40,56,72,96,120,160,220,300,420,640
//
// The file is the same for the same seed and count. Every case has the placeholder width it was drawn with; --widths in
// two-trees.ts lays each out at several. The cases are for the stand-in Canvas alone: nothing here was seen in a browser,
// the ids are in no registry, and --out has no default so that no run writes into the lab's case folder by accident.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { atomic, br, el, font, leaf, treeParagraph, wbr, type BlockSpec, type SpanSpec, type TreePart } from '../lab/cases/build.ts'
import { makeCase } from '../lab/cases/case.ts'
import { createRng, type Rng } from '../lab/cases/prng.ts'
import type { Case } from '../lab/types.ts'

const SHY = String.fromCharCode(0xad)
const NBSP = String.fromCharCode(0xa0)
const ZWSP = String.fromCharCode(0x200b)
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000)
const TAB = String.fromCharCode(9)
const NEWLINE = String.fromCharCode(10)

const LATIN = ['alpha', `be${SHY}ta`, `gam${SHY}ma${SHY}delta`, `end${SHY}`, 'supercalifragilistic', 'a', 'I', 'x-y', 'co-op', 'http://example.com/a/b?c=d', '3.14', 'Hello,', 'world!', '(paren)', 'dash—dash', 'fi', 'ffl', `no${NBSP}break`, `zero${ZWSP}width`]
const ARABIC = ['مرحبا', 'بالعالم', 'اللغة', 'العربية', 'بةتثجح', 'سلام']
const HEBREW = ['שלום', 'עולם', 'עברית']
const CJK = ['日本語のテキスト', '中文文本。', '한국어', '「引用」', `全角${IDEOGRAPHIC_SPACE}空白`]
const OTHER = ['ภาษาไทย', '👍🏽', 'नमस्ते']
const SPACES = [' ', ' ', ' ', '  ', '   ', TAB, NEWLINE, ` ${NEWLINE} `, `${NEWLINE}${NEWLINE}`]

const FAMILIES = ['Arial', 'Times New Roman', 'Geeza Pro', 'Helvetica Neue', 'Courier New', 'serif', 'sans-serif']
const WHITE_SPACE = ['normal', 'normal', 'normal', 'pre-wrap', 'pre-line', 'nowrap', 'pre', 'break-spaces'] as const
const WORD_BREAK = ['normal', 'normal', 'normal', 'break-all', 'keep-all', 'break-word'] as const
const OVERFLOW_WRAP = ['normal', 'normal', 'anywhere', 'break-word'] as const
const LINE_BREAK = ['auto', 'auto', 'auto', 'auto', 'loose', 'normal', 'strict', 'anywhere'] as const
const TEXT_ALIGN = ['start', 'start', 'end', 'left', 'right', 'center', 'justify'] as const

type Edge = { margin: number; border: number; padding: number }
type Shape = { family: string; spec: BlockSpec; parts: TreePart[] }

// Draws one shape a call. The draws come in one fixed order from one stream, so a change to any of them changes every
// case after it.
function shapeDrawer(rng: Rng): () => Shape {
  const words = (pool: readonly string[], length: number): string => {
    let text = ''
    for (let i = 0; i < length; i++) {
      if (i > 0 || rng.chance(0.15)) text += rng.pick(SPACES)
      text += rng.pick(pool)
      if (rng.chance(0.1)) text += SHY
    }
    if (rng.chance(0.3)) text += rng.pick(SPACES)
    return text
  }
  const pool = (): readonly string[] => {
    const roll = rng.int(10)
    if (roll < 5) return LATIN
    if (roll < 7) return ARABIC
    if (roll < 8) return HEBREW
    if (roll < 9) return CJK
    return OTHER
  }
  const edge = (): Edge => ({ margin: rng.pick([0, 0, 0, 3, -3, 7]), border: rng.pick([0, 0, 1, 2]), padding: rng.pick([0, 0, 2, 5]) })
  const spanSpec = (plain: boolean): SpanSpec => {
    const spec: SpanSpec = {}
    if (rng.chance(0.3)) spec.font = font(rng.pick(FAMILIES), rng.pick([12, 16, 16, 20]), rng.pick([400, 400, 700]))
    if (rng.chance(0.2)) spec.letterSpacing = rng.pick([-1, 0.5, 2])
    if (rng.chance(0.2)) spec.wordSpacing = rng.pick([-2, 3])
    if (rng.chance(0.3)) spec.whiteSpace = rng.pick(WHITE_SPACE)
    if (rng.chance(0.2)) spec.wordBreak = rng.pick(WORD_BREAK)
    if (rng.chance(0.2)) spec.overflowWrap = rng.pick(OVERFLOW_WRAP)
    if (rng.chance(0.1)) spec.lineBreak = rng.pick(LINE_BREAK)
    if (rng.chance(0.1)) spec.lang = rng.pick(['ar', 'ja', 'zh', 'he', 'en'])
    if (!plain && rng.chance(0.4)) spec.start = edge()
    if (!plain && rng.chance(0.4)) spec.end = edge()
    if (rng.chance(0.05)) spec.verticalAlign = '0px'
    return spec
  }
  const content = (depth: number, length: number): TreePart[] => {
    const parts: TreePart[] = []
    for (let i = 0; i < length; i++) {
      const roll = rng.int(20)
      if (roll < 9) parts.push(leaf(words(pool(), 1 + rng.int(4))))
      else if (roll < 15 && depth < 3) parts.push(el(spanSpec(rng.chance(0.5)), ...content(depth + 1, rng.int(4))))
      else if (roll < 16) parts.push(atomic(rng.pick([0, 10, 30, 80]), 10, rng.pick([0, 0, 4, -4]), rng.pick([0, 0, 4])))
      else if (roll < 17) parts.push(br())
      else if (roll < 18) parts.push(wbr())
      else if (roll < 19) parts.push(leaf(rng.pick(SPACES)))
      else parts.push(leaf(''))
    }
    return parts
  }
  const blockSpec = (): BlockSpec => {
    const spec: BlockSpec = { font: font(rng.pick(FAMILIES), rng.pick([14, 16, 16, 18]), rng.pick([400, 400, 700])), lang: rng.pick(['en', 'en', 'ar', 'ja']), lineHeight: 40 }
    spec.whiteSpace = rng.pick(WHITE_SPACE)
    spec.wordBreak = rng.pick(WORD_BREAK)
    spec.overflowWrap = rng.pick(OVERFLOW_WRAP)
    spec.lineBreak = rng.pick(LINE_BREAK)
    spec.direction = rng.chance(0.3) ? 'rtl' : 'ltr'
    if (rng.chance(0.2)) spec.letterSpacing = rng.pick([-1, 0.5, 2])
    if (rng.chance(0.2)) spec.wordSpacing = rng.pick([-2, 3])
    if (rng.chance(0.2)) spec.textIndent = rng.pick([10, -5, 30])
    spec.textAlign = rng.pick(TEXT_ALIGN)
    if (rng.chance(0.2)) spec.tabSize = rng.pick([0, 4, 8])
    if (rng.chance(0.25)) {
      // Floats on one side or on both: every row's inset on a side is positive, or every row's is 0 (lab/types.ts).
      const side = rng.pick(['left', 'right', 'both'] as const)
      const rows = 1 + rng.int(4)
      const slots: { left: number; right: number }[] = []
      for (let row = 0; row < rows; row++) slots.push({ left: side === 'right' ? 0 : 5 + rng.int(60), right: side === 'left' ? 0 : 5 + rng.int(60) })
      spec.lineSlots = slots
    }
    return spec
  }
  return () => {
    const spec = blockSpec()
    const roll = rng.int(12)
    if (roll < 5) return { family: 'fuzz/mixed', spec, parts: content(0, 1 + rng.int(6)) }
    if (roll < 6) {
      // One span around text and line breaks: the range based builder where the styles allow it.
      const inner: TreePart[] = []
      const length = 1 + rng.int(5)
      for (let i = 0; i < length; i++) inner.push(rng.chance(0.2) ? br() : leaf(words(LATIN, 1 + rng.int(5))))
      return { family: 'fuzz/one-span', spec: { ...spec, direction: 'ltr' }, parts: [el(rng.chance(0.7) ? {} : spanSpec(true), ...inner)] }
    }
    if (roll < 7) {
      // Inline boxes alone: a case needs a text leaf, so an empty one sits inside.
      const inner = rng.chance(0.5) ? [el({}, leaf(''))] : [leaf('')]
      return { family: 'fuzz/boxes-only', spec, parts: [el(rng.chance(0.5) ? {} : { start: edge(), end: edge() }, ...inner), ...(rng.chance(0.5) ? [el({}, leaf(''))] : [])] }
    }
    if (roll < 9) {
      // Text alone: the simple builder, with soft hyphens and white space to trim.
      return { family: 'fuzz/text-only', spec, parts: [leaf(words(rng.chance(0.8) ? LATIN : pool(), 2 + rng.int(12)))] }
    }
    if (roll < 11) {
      // Complex right-to-left text across undecorated spans, broken inside: shaping across inline boxes and its second pass.
      const arabic: BlockSpec = { ...spec, font: font(rng.pick(['Geeza Pro', 'Arial', 'Times New Roman']), 16), direction: 'rtl', lang: 'ar', wordBreak: rng.pick(['normal', 'break-all'] as const), overflowWrap: rng.pick(['normal', 'anywhere'] as const) }
      const parts: TreePart[] = []
      const length = 2 + rng.int(4)
      for (let i = 0; i < length; i++) {
        const text = rng.pick(ARABIC) + (rng.chance(0.2) ? ' ' : '') + (rng.chance(0.3) ? rng.pick(ARABIC) : '')
        parts.push(i % 2 === 0 ? leaf(text) : el(rng.chance(0.8) ? {} : spanSpec(rng.chance(0.7)), leaf(text), ...(rng.chance(0.2) ? [el({}, leaf(rng.pick(ARABIC)))] : [])))
      }
      return { family: 'fuzz/arabic-spans', spec: arabic, parts }
    }
    // A breakable run before content that doesn't break: the breaker's walk over the runs before and after the overflow.
    const breaking: BlockSpec = { ...spec, whiteSpace: 'normal', wordBreak: rng.pick(['break-all', 'break-word', 'normal'] as const), overflowWrap: rng.pick(['anywhere', 'break-word', 'normal'] as const), lineBreak: rng.pick(['auto', 'anywhere'] as const) }
    const parts: TreePart[] = []
    const length = 2 + rng.int(4)
    for (let i = 0; i < length; i++) {
      const kind = rng.int(6)
      if (kind < 2) parts.push(leaf(rng.pick(LATIN) + (rng.chance(0.2) ? ' ' : '')))
      else if (kind < 4) parts.push(el({ whiteSpace: 'nowrap', ...(rng.chance(0.3) ? { start: edge() } : {}) }, leaf(rng.pick(LATIN) + rng.pick(LATIN))))
      else if (kind < 5) parts.push(el({}, leaf(rng.pick(LATIN))))
      else parts.push(atomic(rng.pick([10, 40]), 10))
    }
    return { family: 'fuzz/breaker', spec: breaking, parts }
  }
}

function generateCases(seed: string, count: number): Case[] {
  const rng = createRng(seed)
  const draw = shapeDrawer(rng)
  const cases: Case[] = []
  const seen = new Set<string>()
  for (let i = 0; i < count; i++) {
    const s = draw()
    const made = treeParagraph(s.spec, s.parts)
    // A tree without a text leaf isn't a case (lab/cases/case.ts validateCase).
    if (made.paragraph.runs.length === 0) continue
    const width = rng.pick([40, 80, 120, 200, 320])
    const c = makeCase({ family: s.family, origin: `generator=${s.family} seed=${seed} shape=${i}`, pageLang: rng.pick(['en', 'en', 'ar', 'ja']), paragraph: { ...made.paragraph, width }, inline: made.inline })
    if (seen.has(c.id)) continue
    seen.add(c.id)
    cases.push(c)
  }
  return cases
}

if (import.meta.main) {
  let out: string | null = null
  let count = 20000
  let seed = 'two-trees-cases-1'
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--out=')) out = resolve(arg.slice(6))
    else if (arg.startsWith('--shapes=')) count = Number(arg.slice(9))
    else if (arg.startsWith('--seed=')) seed = arg.slice(7)
    else throw new Error(`Unknown argument ${arg}; usage: bun rebuild/tools/two-trees-cases.ts --out=<cases.ndjson> [--shapes=N] [--seed=S]`)
  }
  if (out === null) throw new Error('--out=<cases.ndjson> is required')
  const cases = generateCases(seed, count)
  const lines: string[] = []
  const byFamily: Record<string, number> = {}
  for (let i = 0; i < cases.length; i++) {
    lines.push(JSON.stringify(cases[i]!))
    byFamily[cases[i]!.family] = (byFamily[cases[i]!.family] ?? 0) + 1
  }
  writeFileSync(out, `${lines.join('\n')}\n`)
  console.log(`[two-trees-cases] ${cases.length} cases of ${count} shapes (seed ${seed}) -> ${out}`, byFamily)
}
