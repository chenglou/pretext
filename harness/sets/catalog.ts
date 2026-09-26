// The behaviour catalog's templates, before widths.ts cuts them. Four sources:
// - main's adversarial families, taken from its own generator (tests/wrapping/cases.ts) so nothing is retyped. main
//   measures some widths with the browser's Canvas; run with two made-up measures, a width that stays put is main's own
//   and one that moves was measured, and a template with measured widths is searched from the coarse grid instead.
//   main's real text (the accuracy grid, the corpus sweeps, two Myanmar corpus paragraphs) and its mode oracles are left
//   to the real-usage sample and oracles.ndjson; its same-font inline items go to the rich set;
// - the per-engine rebuild's rule families (data/rule-families.ndjson), the flat ones within what the library takes;
// - filed reports whose reporter measured the width with their own Canvas;
// - a matrix of every UAX #14 line-break class between the scripts apps mix, under the CSS settings the library takes,
//   each pair of values of two axes in at least one template.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateCases } from '../../tests/wrapping/cases.ts'
import { SYSTEM_UI_FONT } from '../score.ts'
import type { Paragraph } from '../types.ts'
import { font, lineBreakTable, paragraph, parseFont, span } from './build.ts'
import { templateKey, type Template } from './widths.ts'

type WrappingCase = ReturnType<typeof generateCases>[number]

const REAL_TEXT = /^maintained\/(accuracy|corpus)$/
// Two whole Myanmar corpus paragraphs (1,666 and 2,707 units) main keeps from a corpus analysis: real text, left to the
// sample like the corpus sweeps. At every width where their lines change they would be most of WebKit's search.
const CORPUS_ANALYSIS = /\/corpus-analysis\//
const ORACLE = /^maintained\/(pre-wrap|keep-all|symbols|letter-spacing|discretionary)\//

function fromMain(c: WrappingCase): { template: Omit<Template, 'widths' | 'grid'>; rich: boolean } {
  const f = parseFont(c.font)
  const pageLang = c.context?.lang ?? 'en'
  const rich = c.nativeItems === true && c.parts !== undefined
  const parts = rich ? c.parts!.map(part => span(part, f, { letterSpacing: c.letterSpacing })) : [c.text]
  const p = paragraph({ font: f, lang: c.lang ?? pageLang, lineHeight: c.lineHeight, whiteSpace: c.whiteSpace, wordBreak: c.wordBreak, letterSpacing: c.letterSpacing, direction: c.direction }, parts)
  return { template: { family: `main/${c.family.replace(/U\+[0-9A-F]{4,6}/g, 'U+control')}`, origin: `tests/wrapping/cases.ts ${c.family} (${c.origins[0] ?? ''})`, pageLang, paragraph: p }, rich }
}

export function mainTemplates(): { catalog: Template[]; rich: Template[] } {
  const measures = [
    (text: string, _font: string, letterSpacing: number): number => text.length * (7.31 + letterSpacing) + 0.37,
    (text: string, _font: string, letterSpacing: number): number => text.length * (9.13 + letterSpacing) + 0.53,
  ]
  const byKey = new Map<string, { template: Omit<Template, 'widths' | 'grid'>; rich: boolean; widths: [Set<number>, Set<number>] }>()
  for (let m = 0; m < measures.length; m++) {
    for (const browser of ['chrome', 'safari', 'firefox'] as const) {
      const cases = generateCases(measures[m]!, { schedule: 'full', browser })
      for (let i = 0; i < cases.length; i++) {
        const c = cases[i]!
        if (REAL_TEXT.test(c.family) || c.origins.some(origin => ORACLE.test(origin) || CORPUS_ANALYSIS.test(origin))) continue
        const converted = fromMain(c)
        const key = templateKey({ ...converted.template, widths: [], grid: false })
        let entry = byKey.get(key)
        if (entry === undefined) byKey.set(key, entry = { ...converted, widths: [new Set(), new Set()] })
        entry.widths[m]!.add(c.width)
      }
    }
  }
  const catalog: Template[] = []
  const rich: Template[] = []
  for (const entry of byKey.values()) {
    const [a, b] = entry.widths
    const own: number[] = []
    for (const width of a) if (b.has(width)) own.push(width)
    // A width main measured moved between the two runs: the template is searched from the coarse grid too.
    const template = { ...entry.template, widths: own, grid: own.length < a.size || own.length < b.size }
    ;(entry.rich ? rich : catalog).push(template)
  }
  return { catalog, rich }
}

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

export function catalogTemplates(): { catalog: Template[]; rich: Template[] } {
  const main = mainTemplates()
  const catalog: Template[] = []
  const seen = new Set<string>()
  // The order decides which template shows a line break first, which the cover keeps (widths.ts): filed reports, the
  // rebuild's rule families, main's families, then the class matrix.
  const lists = [reportedTemplates(), ruleFamilyTemplates(), main.catalog, classMatrixTemplates()]
  for (let l = 0; l < lists.length; l++) {
    for (let i = 0; i < lists[l]!.length; i++) {
      const t = lists[l]![i]!
      const key = templateKey(t)
      if (seen.has(key) || SYSTEM_UI_FONT.test(t.paragraph.font.family)) continue
      seen.add(key)
      catalog.push({ ...t, family: `catalog/${t.family}` })
    }
  }
  return { catalog, rich: main.rich }
}
