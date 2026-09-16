// WebKit break opportunities against their sources:
// - classify() over every code unit against data/webkit/breakable-positions/classify.tsv (BreakablePositions.h at 7625);
// - the pair table against linebreak-table-pairs.tsv;
// - the installed-browser verdicts of specs/probes-safari.md for webkit-text H1-H3, H9, H13-H18, H23 (single-line
//   answers at width 1px give the opportunities);
// - the groundwork's WebKit oracle answers (runtime-parity/blink-webkit/work, Safari 7624), for rows the 7625 changes of
//   specs/webkit-text.md §15 don't touch and without Thai, Lao, Khmer or Myanmar text.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DATA } from '../../../tools/gen-shared.ts'
import { forEachLine } from '../../../tools/lines.ts'
import { WEBKIT, type Environment } from '../../env.js'
import { createMeasurer } from '../../measure/canvas.js'
import type { Paragraph, TextRun } from '../../model.js'
import { getCategory } from '../../breaks/rbbi.js'
import { canBreakBefore, classify, findNextBreakablePosition, makeFactory, mayBreakInBetween } from './breaks.js'
import { lineRules, pairTableBreaks } from './data.js'
import { prepareWebKit } from './content.js'
import type { WebKitPrepared, WebKitTextItem } from './types.js'

// A fixed-advance OffscreenCanvas: the scan doesn't read widths, but preparing a paragraph measures items.
class FixedContext {
  font = ''
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(s: string): { width: number } {
    return { width: s.length * 8 }
  }
}
;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
  getContext(): FixedContext {
    return new FixedContext()
  }
}

const env: Environment = {
  engine: WEBKIT, devicePixelRatio: 2, pageZoom: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'zh-CN',
  preferredLanguages: ['zh-CN'], dictionaryBreaks: { kind: 'unavailable' },
}
const font = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const }

function paragraph(runs: Array<[string, TextRun['node']]>, overrides: Partial<Paragraph> = {}): Paragraph {
  return {
    runs: runs.map(([text, node]) => ({ text, node, font, letterSpacing: 0, wordSpacing: 0, lang: null })),
    font, letterSpacing: 0, wordSpacing: 0, width: 1, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', ...overrides,
  }
}

// Soft wrap opportunities between items, as TextOnlySimpleLineBuilder and LineBuilder decide them for text in one
// wrapping block (specs/webkit-text.md §7.1-§7.4), in source offsets.
function opportunities(p: WebKitPrepared): { breaks: number[]; forced: number[] } {
  const breaks: number[] = []
  const forced: number[] = []
  let previous: WebKitTextItem | null = null
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    if (item.kind === 'soft-line-break') {
      forced.push(p.boxes[item.box]!.sourceStart + item.start + 1)
      previous = null
      continue
    }
    if (item.kind !== 'text') continue
    if (previous !== null) {
      let opportunity: boolean
      if (previous.isWhitespace || item.isWhitespace) {
        opportunity = true
      } else if (previous.box === item.box) {
        const box = p.boxes[item.box]!
        opportunity = previous.level === item.level || findNextBreakablePosition(makeFactory(box.text, box.is8Bit, box.locale, p.style.lineBreakMode, p.env.dictionaryBreaks), item.start, p.style) === item.start
      } else {
        const a = p.boxes[previous.box]!
        const b = p.boxes[item.box]!
        opportunity = mayBreakInBetween(a.text, a.is8Bit, b.text, b.is8Bit, b.locale, p.style, p.env.dictionaryBreaks)
      }
      if (opportunity) breaks.push(p.boxes[item.box]!.sourceStart + item.start)
    }
    previous = item
  }
  return { breaks, forced }
}

function breaksOf(runs: Array<[string, TextRun['node']]>, overrides: Partial<Paragraph> = {}): number[] {
  return opportunities(prepareWebKit(paragraph(runs, overrides), env, createMeasurer())).breaks
}

describe('BreakablePositions data', () => {
  test('classify.tsv', () => {
    const rows = readFileSync(resolve(DATA, 'webkit/breakable-positions/classify.tsv'), 'utf8').split('\n')
    let checked = 0
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
      if (row.length === 0 || row.startsWith('#')) continue
      const [rules, nbsp, first, last, bits] = row.split('\t')
      if (rules !== 'Normal') continue
      for (let c = parseInt(first!, 16); c <= parseInt(last!, 16); c++) {
        expect(classify(c, nbsp === 'Break')).toBe(Number(bits))
        checked++
      }
    }
    expect(checked).toBe(2 * 65536)
  })

  test('linebreak-table-pairs.tsv', () => {
    const rows = readFileSync(resolve(DATA, 'webkit/breakable-positions/linebreak-table-pairs.tsv'), 'utf8').split('\n')
    const expected = new Set<string>()
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
      if (row.length === 0 || row.startsWith('#')) continue
      const [before, after] = row.split('\t')
      expected.add(`${parseInt(before!, 16)} ${parseInt(after!, 16)}`)
    }
    let breakable = 0
    for (let before = 0x21; before <= 0xff; before++) {
      for (let after = 0x21; after <= 0xff; after++) {
        const breaks = pairTableBreaks(before, after)
        if (breaks) breakable++
        expect(breaks).toBe(expected.has(`${before} ${after}`))
      }
    }
    expect(breakable).toBe(1547)
  })

  test('libicucore line tables per locale (specs/webkit-canvas.md §2.5)', () => {
    const quoteCategory = (locale: string) => {
      const { rules, overrides } = lineRules(locale, 'Default')
      const index = overrides.chars.indexOf(0x201c)
      return index < 0 ? getCategory(rules, 0x201c) : overrides.categories[index]
    }
    const { rules: en } = lineRules('en', 'Default')
    expect(quoteCategory('en')).toBe(getCategory(en, 0x7b))
    expect(lineRules('ja', 'Default').overrides.chars).toEqual([])
    expect(lineRules('da', 'Default').overrides.chars).toEqual([])
    // fr's quotation and alternate quotation delimiters are both « », so the loop installs each override twice; the
    // first match wins (AppleICU76 rbbi.cpp:1065-1080).
    expect([...new Set(lineRules('fr', 'Default').overrides.chars)]).toEqual([0xab, 0xbb])
  })

  test('canBreakBefore (InlineContentBreaker.cpp:124-137)', () => {
    expect(canBreakBefore(0x2c, 'auto')).toBe(false)
    expect(canBreakBefore(0x5c, 'auto')).toBe(true)
    expect(canBreakBefore(0x2010, 'auto')).toBe(false)
    expect(canBreakBefore(0x2010, 'loose')).toBe(true)
    expect(canBreakBefore(0xa0, 'loose')).toBe(false)
    expect(canBreakBefore(0x3001, 'auto')).toBe(false)
    expect(canBreakBefore(0x61, 'auto')).toBe(true)
  })
})

describe('installed-browser verdicts (specs/probes-safari.md)', () => {
  test('H1: no break between bold foo and bar; a space breaks', () => {
    expect(breaksOf([['foo', 'span'], ['bar', 'text']])).toEqual([])
    expect(breaksOf([['foo', 'span'], [' bar', 'text']])).toEqual([3, 4])
  })
  test('H2: break after a hyphen at a span edge', () => {
    expect(breaksOf([['ex-', 'span'], ['ample', 'text']])).toEqual([3])
  })
  test('H3: a one-character previous box loses context', () => {
    expect(breaksOf([['x', 'text'], ['-', 'span'], ['1', 'text']])).toEqual([])
    expect(breaksOf([['x-1', 'text']])).toEqual([2])
  })
  test('H9: stale scan state after the ICU fast-forward', () => {
    expect(breaksOf([['中.abc(d', 'text']])).toEqual([5])
    expect(breaksOf([['x.abc(d', 'text']])).toEqual([])
    expect(breaksOf([['中,abc[d', 'text']])).toEqual([5])
    expect(breaksOf([['中.abc<d', 'text']])).toEqual([5])
  })
  test('H13: U+2028 and U+2029 force breaks in normal white space', () => {
    const p = prepareWebKit(paragraph([['a b', 'text']]), env, createMeasurer())
    expect(opportunities(p).forced).toEqual([2])
  })
  test('H15: keep-all breaks after punctuation only in 16-bit text', () => {
    expect(breaksOf([['abc,def(ghi中', 'text']], { wordBreak: 'keep-all' })).toEqual([4, 8])
    expect(breaksOf([['abc,def(ghi', 'text']], { wordBreak: 'keep-all' })).toEqual([])
  })
  test('H16: keep-all never breaks at a span edge', () => {
    expect(breaksOf([['中文，', 'span'], ['中文', 'span']], { wordBreak: 'keep-all' })).toEqual([])
    expect(breaksOf([['中文，中文', 'text']], { wordBreak: 'keep-all' })).toEqual([3])
  })
  test('H17 and H14: soft hyphens under keep-all and manual', () => {
    expect(breaksOf([['co­op', 'text']], { wordBreak: 'keep-all' })).toEqual([])
    expect(breaksOf([['co­op', 'text']])).toEqual([3])
  })
  test('H18: ZWSP position depends on keep-all', () => {
    expect(breaksOf([['a​b', 'text']])).toEqual([2])
    expect(breaksOf([['a​b', 'text']], { wordBreak: 'keep-all' })).toEqual([1])
  })
  test('H23: hyphen-minus and question mark', () => {
    expect(breaksOf([['ab-12 -12 a -12 12-34', 'text']])).toEqual([3, 5, 6, 9, 10, 11, 12, 15, 16, 19])
    expect(breaksOf([['x?-b x?$b x!(b', 'text']])).toEqual([2, 3, 4, 5, 7, 9, 10, 12])
  })
  test('H4 and H5: WebKit 7625 quote rule next to ideographs, under ja', () => {
    expect(breaksOf([['中文“abc”中文', 'text']], { lang: 'ja' })).toEqual([1, 2, 7, 8])
    expect(breaksOf([['中«abc»中', 'text']])).toEqual([1, 6])
  })
  test('H6: Apple ICU quote overrides follow the locale', () => {
    expect(breaksOf([['----““aabb', 'text']])).toEqual([1, 2, 3, 4])
    expect(breaksOf([['----““aabb', 'text']], { lang: 'ja' })).toEqual([1, 2, 3])
  })
})

// runtime-parity/blink-webkit/work: requests { id, text, parts?, whiteSpace, wordBreak, lang, direction } and the C++
// oracle's answers { breaks, forced, items }, WebKit 7624 over libicucore 78.1.
const WORK = resolve(process.env['HOME'] ?? '', 'github/browser-engines/pretext-emulation-20260915/runtime-parity/blink-webkit/work')

describe.skipIf(!existsSync(resolve(WORK, 'webkit-answers.jsonl')))('groundwork WebKit oracle answers', () => {
  test('soft wrap opportunities and forced breaks', async () => {
    type Request = { id: string; text: string; parts?: string[]; whiteSpace: 'normal' | 'pre-wrap'; wordBreak: 'normal' | 'keep-all'; lang: string | null; direction: 'ltr' | 'rtl' }
    type Answer = { breaks?: number[]; forced?: number[] }
    const requests: Request[] = []
    await forEachLine(resolve(WORK, 'webkit-requests.jsonl'), line => { if (line.length > 0) requests.push(JSON.parse(line) as Request) })
    let index = 0
    let compared = 0
    let excluded = 0
    const failures: string[] = []
    // specs/webkit-text.md §15: U+2028/U+2029 became forced breaks, curly quotes and guillemets got the local LB19a
    // rule, and keep-all breaks after punctuation in 16-bit text. The oracle has none of these.
    const changed = new RegExp('[\\u2028\\u2029\\u2018\\u2019\\u201c\\u201d\\u00ab\\u00bb]')
    const dictionary = new RegExp('[\\u0e00-\\u0eff\\u1000-\\u109f\\u1780-\\u17ff\\u19e0-\\u19ff\\uaa60-\\uaadf]')
    await forEachLine(resolve(WORK, 'webkit-answers.jsonl'), line => {
      if (line.length === 0) return
      const request = requests[index++]!
      const answer = JSON.parse(line) as Answer
      if (answer.breaks === undefined) return
      const parts = request.parts !== undefined ? request.parts.filter(part => part.length > 0) : [request.text]
      const text = parts.join('')
      // The oracle builds items for every text node; a node of only ASCII white space at the block start gets no
      // renderer in WebKit (specs/webkit-text.md §2), so the port builds none.
      const onlyASCIIWhiteSpace = /^[ \n\t\r\f]*$/.test(parts[0]!)
      if (onlyASCIIWhiteSpace || changed.test(text) || dictionary.test(text) || (request.wordBreak === 'keep-all' && /[^ -ÿ]/.test(text))) {
        excluded++
        return
      }
      const p = prepareWebKit(paragraph(parts.map(part => [part, 'text'] as [string, TextRun['node']]), {
        whiteSpace: request.whiteSpace, wordBreak: request.wordBreak, direction: request.direction, lang: request.lang ?? 'en',
      }), env, createMeasurer())
      const actual = opportunities(p)
      compared++
      if (actual.breaks.join(' ') !== answer.breaks.join(' ') || actual.forced.join(' ') !== (answer.forced ?? []).join(' ')) {
        if (failures.length < 20) failures.push(`${request.id} ${JSON.stringify(text)}: got ${actual.breaks.join(' ')} / ${actual.forced.join(' ')}, expected ${answer.breaks.join(' ')} / ${(answer.forced ?? []).join(' ')}`)
        else failures.push('')
      }
    })
    console.log(JSON.stringify({ requests: requests.length, compared, excluded, differing: failures.length }))
    expect(failures.slice(0, 20)).toEqual([])
    expect(compared).toBeGreaterThan(10000)
  }, 300_000)
})
