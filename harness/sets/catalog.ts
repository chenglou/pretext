// The behaviour catalog's templates, before widths.ts cuts them. Five sources:
// - the per-engine rebuild's rule families (data/rule-families.ndjson), the flat ones within what the library takes;
// - filed reports whose reporter measured the width with their own Canvas;
// - a matrix of every UAX #14 line-break class between the scripts apps mix, under the CSS settings the library takes,
//   each pair of values of two axes in at least one template;
// - shapes ENGINE_FOLLOWUPS.md names, with their neighbours, each neighbour a family of its own, so the cover keeps a
//   change of each;
// - chains of combining-mark runs longer than the part of the chain a run's context keeps, each shape a family of its own,
//   so the cover keeps a change of each.
// main's adversarial families were taken once from the old harness's generator, which is gone: their cases,
// `catalog/main/*` and `rich/main/*`, stay in the case files as they were cut, and `make.ts cut` keeps them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_UI_FONT } from '../score.ts'
import type { Paragraph } from '../types.ts'
import { font, lineBreakTable, paragraph, parseFont } from './build.ts'
import { templateKey, type Template } from './widths.ts'

export function ruleFamilyTemplates(): Template[] {
  const out: Template[] = []
  const lines = readFileSync(join(import.meta.dir, 'data/rule-families.ndjson'), 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') continue
    const t = JSON.parse(lines[i]!) as Omit<Template, 'widths' | 'grid'>
    if (SYSTEM_UI_FONT.test(t.paragraph.font.family)) continue
    out.push({ ...t, widths: [], grid: true })
  }
  return out
}

// Filed reports whose width the reporter measured with their own Canvas: the search finds where the lines change.
export function reportedTemplates(): Template[] {
  const out: Template[] = []
  const add = (issue: string, text: string, shorthand: string, lang = 'en', options: Partial<Paragraph> = {}): void => {
    out.push({ family: `reported/${issue}`, origin: `github.com/chenglou/pretext/issues/${issue.slice(1)}`, pageLang: lang, widths: [], grid: true,
      paragraph: { ...paragraph({ font: parseFont(shorthand), lang }, [text]), ...options } })
  }
  add('#11', 'word   ', '16px Arial')
  add('#43', '生活就像海洋\u{200B} 只有意志坚定的人才能到达彼岸', '16px "Test Sans"', 'zh')
  for (const text of ['東京(Tokyo)', '北京(Beijing)', '인공지능(AI)', '서울(Seoul)과 부산(Busan)']) add('#145', text, '20px serif', /[가-힣]/.test(text) ? 'ko' : 'en')
  add('#169', 'Supercalifragilisticexpialidocious.andthenmoreletters', '16px Arial')
  for (const mark of ['\'', '/', '|', '!', '}']) add('#293', `甲乙丙${mark}first_week户`, '16px Arial, sans-serif')
  return out
}

// ---- The class matrix ----

const CONTEXTS: ReadonlyArray<readonly [string, string]> = [
  ['latin', 'ab'], ['digits', '12'], ['han', '漢字'], ['kana', 'かな'], ['hangul', '한글'], ['arabic', 'بب'], ['hebrew', 'אב'],
  ['thai', 'กข'], ['emoji', '\u{1F600}'], ['space', ' '], ['edge', ''],
]
const WHITE_SPACE = ['normal', 'pre-wrap'] as const
const WORD_BREAK = ['normal', 'keep-all'] as const
const LETTER_SPACING = [0, 1.5, -1] as const
const FONTS = [font('Arial', 16), font('"Hiragino Sans"', 16), font('"Helvetica Neue"', 15)] as const
const DIRECTIONS = ['ltr', 'rtl'] as const

// Up to three assigned code points of each line-break class: its first, middle and last, from the BMP where the class
// has any.
function classSamples(): Array<{ lineBreak: string; codePoint: number }> {
  const { from, to, names } = lineBreakTable()
  const byClass = new Map<string, number[]>()
  for (let r = 0; r < names.length; r++) {
    const lineBreak = names[r]!
    if (lineBreak === 'SG' || lineBreak === 'XX') continue
    let list = byClass.get(lineBreak)
    if (list === undefined) byClass.set(lineBreak, list = [])
    for (let cp = from[r]!; cp <= to[r]! && list.length < 200_000; cp++) if (!/[\p{gc=Cn}\p{gc=Co}\p{gc=Cs}]/u.test(String.fromCodePoint(cp))) list.push(cp)
  }
  const out: Array<{ lineBreak: string; codePoint: number }> = []
  for (const [lineBreak, all] of [...byClass].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const bmp = all.filter(cp => cp <= 0xffff)
    const list = bmp.length > 0 ? bmp : all
    const picks = new Set([list[0]!, list[Math.floor(list.length / 2)]!, list[list.length - 1]!])
    for (const codePoint of picks) out.push({ lineBreak, codePoint })
  }
  return out
}

// Rows in which every pair of values of two axes appears at least once: greedy, each row starting from the first pair
// still uncovered and filling the other axes with the value that covers the most uncovered pairs (rebuild/tests/families/
// covering.ts).
export function pairwiseRows(sizes: readonly number[]): number[][] {
  const n = sizes.length
  const uncovered: Uint8Array[][] = []
  let left = 0
  for (let i = 0; i < n; i++) {
    uncovered.push([])
    for (let j = 0; j < n; j++) {
      uncovered[i]!.push(new Uint8Array(j > i ? sizes[i]! * sizes[j]! : 0).fill(1))
      if (j > i) left += sizes[i]! * sizes[j]!
    }
  }
  const covered = (i: number, a: number, j: number, b: number): boolean => (i < j ? uncovered[i]![j]![a * sizes[j]! + b] : uncovered[j]![i]![b * sizes[i]! + a]) === 0
  const rows: number[][] = []
  while (left > 0) {
    const row: number[] = Array.from({ length: n }, () => -1)
    // The first uncovered pair.
    search: for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const table = uncovered[i]![j]!
      const at = table.indexOf(1)
      if (at >= 0) {
        row[i] = Math.floor(at / sizes[j]!)
        row[j] = at % sizes[j]!
        break search
      }
    }
    for (let k = 0; k < n; k++) {
      if (row[k] !== -1) continue
      let best = 0
      let bestCount = -1
      for (let v = 0; v < sizes[k]!; v++) {
        let count = 0
        for (let other = 0; other < n; other++) if (row[other] !== -1 && !covered(other, row[other]!, k, v)) count++
        if (count > bestCount) {
          best = v
          bestCount = count
        }
      }
      row[k] = best
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const index = row[i]! * sizes[j]! + row[j]!
      if (uncovered[i]![j]![index] === 1) {
        uncovered[i]![j]![index] = 0
        left--
      }
    }
    rows.push(row)
  }
  return rows
}

export function classMatrixTemplates(): Template[] {
  const samples = classSamples()
  const rows = pairwiseRows([samples.length, CONTEXTS.length, CONTEXTS.length, WHITE_SPACE.length, WORD_BREAK.length, LETTER_SPACING.length, FONTS.length, DIRECTIONS.length])
  const out: Template[] = []
  for (let r = 0; r < rows.length; r++) {
    const [s, l, rr, ws, wb, ls, f, d] = rows[r]!
    const sample = samples[s!]!
    const [leftName, leftText] = CONTEXTS[l!]!
    const [rightName, rightText] = CONTEXTS[rr!]!
    const x = String.fromCodePoint(sample.codePoint)
    const text = `${leftText === '' ? '' : `xx ${leftText}`}${x}${rightText === '' ? '' : `${rightText} yy`}`
    const p = paragraph({ font: FONTS[f!]!, lang: 'en', whiteSpace: WHITE_SPACE[ws!]!, wordBreak: WORD_BREAK[wb!]!, letterSpacing: LETTER_SPACING[ls!]!, direction: DIRECTIONS[d!]! }, [text])
    out.push({
      family: `classes/${sample.lineBreak}`,
      origin: `U+${sample.codePoint.toString(16).toUpperCase().padStart(4, '0')} (line-break class ${sample.lineBreak}) between ${leftName} and ${rightName}`,
      pageLang: 'en', paragraph: p, widths: [], grid: true,
    })
  }
  return out
}

// A line holding only soft hyphens, which a hard break ends (RESEARCH.md, Widths After A Line Break): between lines of
// text, at the paragraph start and end, as a run, twice over, beside a combining mark or a preserved space, between
// CRLFs, and before text; and between two U+2028, which WebKit takes as hard breaks in normal white space too, where a
// line holding only a collapsible space is one as well. Two words on each side give the search widths where the lines
// around it change.
export function followupTemplates(): Template[] {
  const shapes: ReadonlyArray<readonly [string, string, 'normal' | 'pre-wrap', string?]> = [
    ['between', 'ab cd\n\u00AD\nef gh', 'pre-wrap'],
    ['start', '\u00AD\nab cd', 'pre-wrap'],
    ['end', 'ab cd\n\u00AD', 'pre-wrap'],
    ['run', 'ab cd\n\u00AD\u00AD\nef gh', 'pre-wrap'],
    ['twice', 'ab cd\n\u00AD\n\u00AD\nef gh', 'pre-wrap'],
    ['mark-after', 'ab cd\n\u00AD\u0301\nef gh', 'pre-wrap'],
    ['mark-before', 'ab cd\n\u0301\u00AD\nef gh', 'pre-wrap'],
    ['space-before', 'ab cd\n \u00AD\nef gh', 'pre-wrap'],
    ['space-after', 'ab cd\n\u00AD \nef gh', 'pre-wrap'],
    ['crlf', 'ab cd\r\n\u00AD\r\nef gh', 'pre-wrap'],
    ['text-after', 'ab cd\n\u00ADef gh', 'pre-wrap'],
    ['line-separators', 'ab cd\u2028\u00AD\u2028ef gh', 'pre-wrap'],
    ['line-separators-normal', 'ab cd\u2028\u00AD\u2028ef gh', 'normal'],
    ['line-separators-space', 'ab cd\u2028 \u2028ef gh', 'normal', 'a collapsible space'],
  ]
  const out: Template[] = []
  for (let i = 0; i < shapes.length; i++) {
    const [name, text, whiteSpace, holds = 'a soft hyphen'] = shapes[i]!
    out.push({
      family: `followups/soft-hyphen-line/${name}`, origin: `RESEARCH.md, Widths After A Line Break: a line holding only ${holds}, ${name}`,
      pageLang: 'en', paragraph: paragraph({ font: font('Arial', 16), lang: 'en', whiteSpace }, [text]), widths: [], grid: true,
    })
  }
  return out
}

// Runs of combining marks chained to one grapheme through soft hyphens or U+0001, past the 96 UTF-16 units after which a
// run's context leaves out the chain's first runs (MARK_CHAIN_CONTEXT_UNITS in src/layout.ts): runs of 100 and 200 marks,
// whose widths Safari gives by their place after the grapheme, a separator and one mark repeated, two chains in one
// paragraph, a long run before such pairs, and Arabic vowel marks and keycaps after U+0001, which take no advance when
// measured without the grapheme.
export function markChainTemplates(): Template[] {
  const pairs = (separator: string, marks: string, count: number): string => (separator + marks).repeat(count)
  const shapes: ReadonlyArray<readonly [string, string, string, number]> = [
    ['long-runs', `ab \u0915${pairs('\u00AD', '\u0323'.repeat(100), 4)} cd ef`, 'Arial', 16],
    ['long-runs-times', `ab \u0915${pairs('\u00AD', '\u0301'.repeat(200), 3)} cd ef`, 'Times New Roman', 16],
    ['pairs', `ab \u0915${pairs('\u00AD', '\u0323', 80)} cd ef`, 'Arial', 16],
    ['control-pairs', `ab x${pairs('\u0001', '\u0301', 80)} cd ef`, 'Arial', 16],
    ['two-chains', `ab \u0915${pairs('\u00AD', '\u0323', 60)} cd \u0915${pairs('\u00AD', '\u0323', 60)} ef`, 'Arial', 16],
    ['long-run-then-pairs', `ab \u0915\u00AD${'\u0323'.repeat(150)}${pairs('\u00AD', '\u0323', 50)} cd ef`, 'Times New Roman', 16],
    ['arabic-control', `ab \u0627${pairs('\u0001', '\u064E'.repeat(100), 3)} cd ef`, 'Arial', 16],
    ['keycap-control', `ab 1${pairs('\u0001', '\u20E3', 60)} cd ef`, 'Georgia', 24],
  ]
  const out: Template[] = []
  for (let i = 0; i < shapes.length; i++) {
    const [name, text, family, size] = shapes[i]!
    out.push({
      family: `mark-chains/${name}`, origin: `a chain of mark runs past MARK_CHAIN_CONTEXT_UNITS (src/layout.ts): ${name}`,
      pageLang: 'en', paragraph: paragraph({ font: font(family, size), lang: 'en' }, [text]), widths: [], grid: true,
    })
  }
  return out
}

export function catalogTemplates(): Template[] {
  const catalog: Template[] = []
  const seen = new Set<string>()
  // The order decides which template shows a line break first, which the cover keeps (widths.ts): filed reports, the
  // rebuild's rule families, the class matrix, the follow-ups' shapes, then the mark chains. main's families came before
  // the class matrix when they were cut.
  const lists = [reportedTemplates(), ruleFamilyTemplates(), classMatrixTemplates(), followupTemplates(), markChainTemplates()]
  for (let l = 0; l < lists.length; l++) {
    for (let i = 0; i < lists[l]!.length; i++) {
      const t = lists[l]![i]!
      const key = templateKey(t)
      if (seen.has(key) || SYSTEM_UI_FONT.test(t.paragraph.font.family)) continue
      seen.add(key)
      catalog.push({ ...t, family: `catalog/${t.family}` })
    }
  }
  return catalog
}
