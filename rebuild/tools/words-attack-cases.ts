// Seeded random paragraphs of words for tools/words-attack.ts: text that breaks at spaces, which is where Blink's port
// finds a line's candidate from the words' edges (src/engines/blink/line-breaker.ts wordCandidate), with everything beside
// a space that the word pieces study's conditions name or leave out: words without a script of their own, quotes and
// brackets at a word's edge, hyphens and slashes, several spaces, no-break and other spaces, tabs and line feeds, soft
// hyphens and the other default-ignorable characters, combining marks (one after a space too), emoji sequences, words of
// other scripts and directions, a word split across inline boxes and fonts, letter and word spacing of either sign, text
// indent, and every white-space, word-break and overflow-wrap value. tools/two-trees-cases.ts draws trees, where under 2%
// of lines end between two words; here most do.
//
//   bun rebuild/tools/words-attack-cases.ts --out=<cases.ndjson> [--shapes=50000] [--seed=words-attack-cases-1]
//
// The cases are for the stand-in Canvas alone: nothing here was seen in a browser and the ids are in no registry.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { atomic, br, el, font, leaf, treeParagraph, type BlockSpec, type SpanSpec, type TreePart } from '../lab/cases/build.ts'
import { makeCase } from '../lab/cases/case.ts'
import { createRng, type Rng } from '../lab/cases/prng.ts'
import type { Case } from '../lab/types.ts'

const ch = (...codes: number[]): string => String.fromCodePoint(...codes)
const SHY = ch(0xad)
const NBSP = ch(0xa0)
const ZWSP = ch(0x200b)
const WJ = ch(0x2060)
const ZWJ = ch(0x200d)
const ZWNJ = ch(0x200c)
const LRM = ch(0x200e)
const RLM = ch(0x200f)
const ACUTE = ch(0x301)

const WORDS = [
  'the', 'of', 'and', 'To', 'AVATAR', 'Wave', 'Yo', 'Ty', 'fly', 'office', 'affix', 'fjord', 'Tr', 'r.', 'P.', 'L', 'T', 'V', 'A', 'a', 'I', 'we', 'you', 'your', 'layout', 'every', 'width', 'message',
  'supercalifragilisticexpialidocious', 'internationalization', 'x', 'ok', 'Hello,', 'world!', 'really?', 'yes;', 'no:', 'wait...', 'it\'s', 'don\'t', 'rock\'n\'roll',
]
const NEUTRAL = ['-', '--', ch(0x2014), ch(0x2013), '320,', '3.14', '1,000', '(1)', '[2]', '...', '&', '+', '=', '100%', '$5', '#1', '@', '*', '/', ':', '42', '2026-09-20', '12:30']
const EDGED = ['"quoted"', '(paren)', '[bracket]', ch(0x201c) + 'curly' + ch(0x201d), ch(0xab) + 'guillemets' + ch(0xbb), '(a', 'b)', 'a(', ')b', '"a', 'b"', '\'tis', ch(0x2018) + 'single' + ch(0x2019), 'end.', 'end,', 'end!)', '(start']
const BROKEN = ['x-y', 'co-op', 'well-known-word', 'a/b', 'and/or', 'http://example.com/a/b?c=d&e=f', 'user@example.com', 'path/to/file.ts', 'snake_case_name', 'camelCaseName', `soft${SHY}hyphen`, `be${SHY}ta${SHY}gam${SHY}ma`, `zero${ZWSP}width`, `word${WJ}joiner`, `non${ZWNJ}joiner`, `l${LRM}rm`, `r${RLM}lm`, `no${NBSP}break`, `thin${ch(0x2009)}space`, `narrow${ch(0x202f)}nbsp`, `wide${ch(0x3000)}space`, `e${ACUTE}tude`, `cafe${ACUTE}`, `${ACUTE}mark`]
const EMOJI = [ch(0x1f44d, 0x1f3fd), ch(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467), ch(0x1f1ef, 0x1f1f5), ch(0x2764, 0xfe0f), ch(0x1f600), `ok${ch(0x1f44d)}`, `${ch(0x1f600)}${ch(0x1f600)}`, ch(0x263a), '1' + ch(0xfe0f, 0x20e3)]
const GREEK = [ch(0x3b1, 0x3b2, 0x3b3), ch(0x39a, 0x3b1, 0x3bb, 0x3b7, 0x3bc, 0x3ad, 0x3c1, 0x3b1), ch(0x3ba, 0x3cc, 0x3c3, 0x3bc, 0x3b5)]
const CYRILLIC = [ch(0x43f, 0x440, 0x438, 0x432, 0x435, 0x442), ch(0x43c, 0x438, 0x440), ch(0x413, 0x423, 0x422, 0x410)]
const ARABIC = [ch(0x645, 0x631, 0x62d, 0x628, 0x627), ch(0x628, 0x627, 0x644, 0x639, 0x627, 0x644, 0x645), ch(0x627, 0x644, 0x644, 0x63a, 0x629), ch(0x633, 0x644, 0x627, 0x645), ch(0x648), ch(0x661, 0x662, 0x663)]
const HEBREW = [ch(0x5e9, 0x5dc, 0x5d5, 0x5dd), ch(0x5e2, 0x5d5, 0x5dc, 0x5dd), ch(0x5e2, 0x5d1, 0x5e8, 0x5d9, 0x5ea)]
const INDIC = [ch(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947), ch(0x939, 0x93f, 0x928, 0x94d, 0x926, 0x940), ch(0x915, 0x94d, 0x937), ch(0xe20, 0xe32, 0xe29, 0xe32, 0xe44, 0xe17, 0xe22), ch(0xe2a, 0xe27, 0xe31, 0xe2a, 0xe14, 0xe35)]
const CJK = [ch(0x65e5, 0x672c, 0x8a9e), ch(0x4e2d, 0x6587, 0x3002), ch(0xd55c, 0xad6d, 0xc5b4), ch(0x300c, 0x5f15, 0x7528, 0x300d), ch(0x30c6, 0x30ad, 0x30b9, 0x30c8), ch(0x3001)]
const BETWEEN = [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '  ', '   ', ch(9), ch(10), ` ${ch(10)}`, NBSP, ` ${NBSP}`, `${NBSP} `, ch(0x3000), ` ${ACUTE}`, ` ${ZWSP}`, `${ZWSP} `, ` ${SHY}`, ` ${WJ}`, ` ${ZWJ}`, ` ${LRM}`, ` ${RLM}`]

const FAMILIES = ['Arial', 'Times New Roman', 'Helvetica Neue', 'Georgia', 'Courier New', 'Geeza Pro', 'serif', 'sans-serif', '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif']
const WHITE_SPACE = ['normal', 'normal', 'normal', 'normal', 'pre-wrap', 'pre-line', 'break-spaces', 'nowrap', 'pre'] as const
const WORD_BREAK = ['normal', 'normal', 'normal', 'normal', 'break-all', 'keep-all', 'break-word'] as const
const OVERFLOW_WRAP = ['normal', 'normal', 'break-word', 'break-word', 'anywhere'] as const
const LINE_BREAK = ['auto', 'auto', 'auto', 'auto', 'auto', 'loose', 'normal', 'strict', 'anywhere'] as const
const TEXT_ALIGN = ['start', 'start', 'start', 'end', 'left', 'right', 'center', 'justify'] as const
const SPACINGS = [-3, -1, -0.5, 0.25, 0.5, 1, 2.5, 7]

type Shape = { family: string; spec: BlockSpec; parts: TreePart[] }

function shapeDrawer(rng: Rng): () => Shape {
  const word = (latinOnly: boolean): string => {
    const roll = rng.int(latinOnly ? 14 : 24)
    if (roll < 8) return rng.pick(WORDS)
    if (roll < 10) return rng.pick(NEUTRAL)
    if (roll < 12) return rng.pick(EDGED)
    if (roll < 14) return rng.pick(BROKEN)
    if (roll < 15) return rng.pick(EMOJI)
    if (roll < 16) return rng.pick(GREEK)
    if (roll < 17) return rng.pick(CYRILLIC)
    if (roll < 19) return rng.pick(ARABIC)
    if (roll < 20) return rng.pick(HEBREW)
    if (roll < 22) return rng.pick(INDIC)
    return rng.pick(CJK)
  }
  const words = (length: number, latinOnly: boolean): string => {
    let text = rng.chance(0.08) ? rng.pick(BETWEEN) : ''
    for (let i = 0; i < length; i++) {
      if (i > 0) text += rng.pick(BETWEEN)
      text += word(latinOnly)
    }
    if (rng.chance(0.2)) text += rng.pick(BETWEEN)
    return text
  }
  const edge = (): { margin: number; border: number; padding: number } => ({ margin: rng.pick([0, 0, 0, 3, -3, 7]), border: rng.pick([0, 0, 1, 2]), padding: rng.pick([0, 0, 2, 6]) })
  const spanSpec = (): SpanSpec => {
    const spec: SpanSpec = {}
    if (rng.chance(0.5)) spec.font = font(rng.pick(FAMILIES), rng.pick([12, 14, 16, 16, 20, 33]), rng.pick([400, 400, 700]), rng.chance(0.2) ? 'italic' : 'normal')
    if (rng.chance(0.12)) spec.letterSpacing = rng.pick(SPACINGS)
    if (rng.chance(0.15)) spec.wordSpacing = rng.pick(SPACINGS)
    if (rng.chance(0.12)) spec.whiteSpace = rng.pick(WHITE_SPACE)
    if (rng.chance(0.08)) spec.wordBreak = rng.pick(WORD_BREAK)
    if (rng.chance(0.08)) spec.overflowWrap = rng.pick(OVERFLOW_WRAP)
    if (rng.chance(0.05)) spec.lineBreak = rng.pick(LINE_BREAK)
    if (rng.chance(0.05)) spec.lang = rng.pick(['ar', 'ja', 'zh', 'he', 'en', 'th'])
    if (rng.chance(0.3)) spec.start = edge()
    if (rng.chance(0.3)) spec.end = edge()
    return spec
  }
  const blockSpec = (): BlockSpec => {
    const spec: BlockSpec = { font: font(rng.pick(FAMILIES), rng.pick([10, 13, 16, 16, 16, 18, 21.5]), rng.pick([400, 400, 400, 700])), lang: rng.pick(['en', 'en', 'en', 'ar', 'ja', 'th']), lineHeight: 40 }
    spec.whiteSpace = rng.pick(WHITE_SPACE)
    spec.wordBreak = rng.pick(WORD_BREAK)
    spec.overflowWrap = rng.pick(OVERFLOW_WRAP)
    spec.lineBreak = rng.pick(LINE_BREAK)
    spec.direction = rng.chance(0.1) ? 'rtl' : 'ltr'
    if (rng.chance(0.1)) spec.letterSpacing = rng.pick(SPACINGS)
    if (rng.chance(0.2)) spec.wordSpacing = rng.pick(SPACINGS)
    if (rng.chance(0.2)) spec.textIndent = rng.pick([10, -5, 30, 0.5, 100])
    spec.textAlign = rng.pick(TEXT_ALIGN)
    if (rng.chance(0.1)) spec.tabSize = rng.pick([0, 4, 8])
    if (rng.chance(0.1)) {
      const side = rng.pick(['left', 'right', 'both'] as const)
      const rows = 1 + rng.int(4)
      const slots: { left: number; right: number }[] = []
      for (let row = 0; row < rows; row++) slots.push({ left: side === 'right' ? 0 : 5 + rng.int(60), right: side === 'left' ? 0 : 5 + rng.int(60) })
      spec.lineSlots = slots
    }
    return spec
  }
  // A word cut in two at a random unit, its second half in a span: a word split across inline boxes and fonts.
  const splitWord = (): TreePart[] => {
    const whole = rng.pick(WORDS) + rng.pick(WORDS)
    const at = 1 + rng.int(whole.length - 1)
    return [leaf(`${words(1 + rng.int(3), true)} ${whole.slice(0, at)}`), el(spanSpec(), leaf(`${whole.slice(at)} ${words(1 + rng.int(3), true)}`))]
  }
  return () => {
    const spec = blockSpec()
    const roll = rng.int(10)
    if (roll < 4) {
      // Plain chat text: one leaf of Latin words, the block's defaults but for the width.
      const chat: BlockSpec = rng.chance(0.6) ? { font: spec.font, lang: 'en', lineHeight: 40, overflowWrap: 'break-word' } : spec
      return { family: 'attack/text', spec: chat, parts: [leaf(words(3 + rng.int(40), rng.chance(0.7)))] }
    }
    if (roll < 7) {
      // Text with spans: a span around some words, words split across spans, an atomic inline, a forced break.
      const parts: TreePart[] = []
      const length = 2 + rng.int(6)
      for (let i = 0; i < length; i++) {
        const kind = rng.int(12)
        if (kind < 5) parts.push(leaf(words(1 + rng.int(8), rng.chance(0.6)) + (rng.chance(0.7) ? ' ' : '')))
        else if (kind < 8) parts.push(el(spanSpec(), leaf(words(1 + rng.int(5), rng.chance(0.6)))), leaf(rng.chance(0.7) ? ' ' : ''))
        else if (kind < 10) parts.push(...splitWord())
        else if (kind < 11) parts.push(atomic(rng.pick([0, 10, 30, 80]), 10, rng.pick([0, 0, 4, -4]), rng.pick([0, 0, 4])))
        else parts.push(br())
      }
      return { family: 'attack/spans', spec, parts }
    }
    if (roll < 9) {
      // Spacing on the block: every sign and a fraction, with words of every kind.
      const spaced: BlockSpec = { ...spec, letterSpacing: rng.chance(0.5) ? rng.pick(SPACINGS) : 0, wordSpacing: rng.pick(SPACINGS) }
      return { family: 'attack/spacing', spec: spaced, parts: [leaf(words(3 + rng.int(25), rng.chance(0.5)))] }
    }
    // Right-to-left and mixed paragraphs.
    const mixed: BlockSpec = { ...spec, direction: rng.chance(0.5) ? 'rtl' : 'ltr', font: font(rng.pick(['Geeza Pro', 'Arial', 'Times New Roman']), 16) }
    let text = ''
    const length = 3 + rng.int(20)
    for (let i = 0; i < length; i++) text += (i > 0 ? rng.pick(BETWEEN) : '') + (rng.chance(0.6) ? rng.pick(rng.chance(0.7) ? ARABIC : HEBREW) : word(false))
    return { family: 'attack/mixed', spec: mixed, parts: [leaf(text)] }
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
    if (made.paragraph.runs.length === 0) continue
    const width = rng.pick([8, 24, 40, 64, 97.3, 130, 180, 240.5, 320, 480, 640])
    const c = makeCase({ family: s.family, origin: `generator=${s.family} seed=${seed} shape=${i}`, pageLang: rng.pick(['en', 'en', 'en', 'ar', 'ja']), paragraph: { ...made.paragraph, width }, inline: made.inline })
    if (seen.has(c.id)) continue
    seen.add(c.id)
    cases.push(c)
  }
  return cases
}

let out: string | null = null
let count = 50000
let seed = 'words-attack-cases-1'
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--out=')) out = resolve(arg.slice(6))
  else if (arg.startsWith('--shapes=')) count = Number(arg.slice(9))
  else if (arg.startsWith('--seed=')) seed = arg.slice(7)
  else throw new Error(`Unknown argument ${arg}; usage: bun rebuild/tools/words-attack-cases.ts --out=<cases.ndjson> [--shapes=N] [--seed=S]`)
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
console.log(`[words-attack-cases] ${cases.length} cases from ${count} shapes, seed ${seed}: ${JSON.stringify(byFamily)}`)
