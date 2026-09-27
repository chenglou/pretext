// The gaps that name what words first leaves against the rebuild line in installed faces (DESIGN.md §4.6, "Blink's words
// first"; gaps.ts windowSides, lineEdgeGaps), on a stand-in Canvas where every code point is 10px wide at 16px. Family
// `Mono` adjusts nothing. `Kern` kerns a space with `V` by -4px, which the pair window shows. In `SpaceScript` a lone
// U+2028, shaped as Common, is 2px wider than the 8-bit space, as Euphemia UCAS's space is (shape.ts spaceTakesScript).
// `Neutral` adds 3px to a string that holds no letter of any script and something other than white space, as a string
// without a script of its own takes another script alone than in its run. U+2060 has no advance. Measured strings carry
// U+2028 for U+0020 in a segmented paragraph (shape.ts canvasString).
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { createContextPool } from '../../measure/canvas.js'
import { UNKNOWN_FONT_FACTS, type Gap, type Paragraph } from '../../model.js'
import { fillLine, firstLine, inspectLine, paragraphGaps, prepare } from './index.js'
import type { BlinkPrepared } from './types.js'

const LS = String.fromCodePoint(0x2028)
const WJ = String.fromCodePoint(0x2060)

function count(text: string, part: string): number {
  return text.split(part).length - 1
}

class Context {
  font = '16px x'
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    const size = parseFloat(/([\d.]+)px/.exec(this.font)![1]!)
    let width = 0
    for (let i = 0; i < text.length; i++) width += text[i] === WJ ? 0 : 10
    if (this.font.includes('Kern')) width -= 4 * count(text, `${LS}V`)
    if (this.font.includes('SpaceScript') && text === LS) width += 2
    if (this.font.includes('Neutral') && !/\p{L}/u.test(text) && /[^\s\u2028\u2060]/u.test(text)) width += 3
    return { width: width * size / 16, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

function paragraphIn(family: string, text: string, size: number, direction: Paragraph['direction']): Paragraph {
  return {
    font: { family, size, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lineHeight: 20, direction,
    lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

function prepared(family: string, text: string, size: number = 16, inspect: boolean = true, direction: Paragraph['direction'] = 'ltr'): BlinkPrepared {
  return prepare(paragraphIn(family, text, size, direction), env, inspect, createContextPool())
}

// Every line's range, and on an inspected paragraph the gaps each line reports.
function lines(p: BlinkPrepared, width: number): { start: number; end: number; gaps: Gap[] }[] {
  const out: { start: number; end: number; gaps: Gap[] }[] = []
  let start = firstLine(p)
  let offset = 0
  while (start !== null) {
    const filled = fillLine(p, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('a slot without insets never refuses a line')
    out.push({ start: offset, end: filled.end, gaps: p.inspect !== null ? inspectLine(p, filled.line).gaps : [] })
    offset = filled.end
    start = filled.next
  }
  return out
}

function withDetail(gaps: readonly Gap[], prefix: string): Gap[] {
  return gaps.filter(gap => gap.detail.startsWith(prefix))
}

const ONE_UNIT = 'a wrapped line start beside a space that the port'
const ONE_UNIT_IN_WORD = 'a wrapped line start that isn\'t beside a space'
const IN_WORD = 'a line edge inside a word where the pair total shows no adjustment'
const RTL_END_REACH = 'a line that ends inside a right-to-left item'
const START_REACH = 'a wrapped line start taken from a stand-in position, and the line'
const WHITE_SPACE_SIDE = 'a window side of white space alone'
const COMMON_SIDE = 'a window side that Canvas shapes as Common alone'

describe('blink gaps of a fit within what positions can be off by', () => {
  test('a wrapped line start beside a space whose line fits within a LayoutUnit reports in-word-prefix at the break its decision took', () => {
    // 10px a code point: at 90px `xxxx xxxx` and `Vxxx xxxx` fit with no LayoutUnit to spare. The first line's start is
    // the paragraph's, which no reshape corrects; the third starts after a space, which the pair window calls safe.
    const text = 'xxxx xxxx xxxx xxx Vxxx xxxx xxxx xxxx'
    const exact = lines(prepared('Mono', text), 90)
    expect(exact.map(line => line.end)).toEqual([10, 19, 29, 38])
    expect(withDetail(exact[0]!.gaps, ONE_UNIT)).toEqual([])
    // It reports at the break the decision took, before the next line's `xxxx`, and, since the line's own end is what the
    // fit test decided, at the break before the `xxxx` the line ends with, where a LayoutUnit wider line would break.
    expect(withDetail(exact[2]!.gaps, ONE_UNIT).map(gap => [gap.gap, gap.at])).toEqual([['in-word-prefix', { start: 29, end: 29 }], ['in-word-prefix', { start: 24, end: 24 }]])
    // 5px more leaves 320 LayoutUnits, and the next word would need more than the line has.
    for (const line of lines(prepared('Mono', text), 95)) expect(withDetail(line.gaps, ONE_UNIT)).toEqual([])
    // A plain paragraph lays the same lines out and reports nothing.
    expect(lines(prepared('Mono', text, 16, false), 90).map(line => line.end)).toEqual(exact.map(line => line.end))
  })

  test('a wrapped line start after a soft hyphen whose line fits within a LayoutUnit reports at the breaks its decision chose between', () => {
    // At 90px `xxxxxxxx` and its hyphen fill the first line, and `xxxx xxxx ` the second with no LayoutUnit to spare. The
    // second line starts after SHY, not beside a space: in-word-prefix at its start, and the start's correction at the break
    // the decision took and at the break before the `xxxx` its end holds.
    const text = 'xxxxxxxx\u00adxxxx xxxx xxxx'
    const exact = lines(prepared('Mono', text), 90)
    expect(exact.map(line => line.end)).toEqual([9, 19, 23])
    expect(withDetail(exact[1]!.gaps, ONE_UNIT_IN_WORD).map(gap => [gap.gap, gap.at])).toEqual([['in-word-prefix', { start: 19, end: 19 }], ['in-word-prefix', { start: 14, end: 14 }]])
    for (const line of lines(prepared('Mono', text), 95)) expect(withDetail(line.gaps, ONE_UNIT_IN_WORD)).toEqual([])
    // Between two ideographs the start's condition reports at the start alone (and the end's at the end, as before):
    // `日本語` fills 30px exactly on every line.
    const cjk = lines(prepared('Mono', '日本語日本語日本語'), 30)
    expect(cjk.map(line => line.end)).toEqual([3, 6, 9])
    expect(withDetail(cjk[1]!.gaps, IN_WORD).map(gap => gap.at)).toEqual([{ start: 3, end: 3 }, { start: 6, end: 6 }])
    expect(withDetail(cjk[1]!.gaps, ONE_UNIT_IN_WORD)).toEqual([])
  })

  test('a line that ends inside an RTL item reports the conditions of the item\'s text after its end where the fit lies within a LayoutUnit', () => {
    // 64px, 40px a code point: the first line `אאאא אאאא ` fills 360px exactly, and the item goes on past it to a ` ! ` whose
    // window side `Neutral` measures as Common 12px wider alone (script-context). An RTL position counts from the item's
    // logical end, so that side reaches the first line's two breaks; 0.5px more and the fit is 33 LayoutUnits away.
    const text = 'אאאא אאאא אאאא ! אאאא אאאא אאאא'
    const exact = lines(prepared('Neutral', text, 64, true, 'rtl'), 360)
    expect(exact[0]!.end).toBe(10)
    // (The unsafe-to-break the second line's edges raise in that text reaches it too.)
    const reach = withDetail(exact[0]!.gaps, RTL_END_REACH)
    expect(reach.filter(gap => gap.gap === 'script-context').map(gap => gap.at)).toEqual([{ start: 10, end: 10 }, { start: 5, end: 5 }])
    for (const gap of reach) expect([5, 10]).toContain(gap.at!.start)
    expect(withDetail(lines(prepared('Neutral', text, 64, true, 'rtl'), 360.5)[0]!.gaps, RTL_END_REACH)).toEqual([])
    // Left to right a position counts from the item's start, and nothing after the line end reaches it.
    const ltr = lines(prepared('Neutral', 'жжжж жжжж жжжж ! жжжж жжжж жжжж', 64, true, 'ltr'), 360)
    expect(ltr[0]!.end).toBe(10)
    expect(withDetail(ltr[0]!.gaps, RTL_END_REACH)).toEqual([])
  })

  test('a wrapped line start taken from a stand-in position reports its reach where the fit lies within the adjustment', () => {
    // `Kern` kerns the space before `V` by -4px, which no pairKerning fact places, and no ligature fact says no ligature
    // forms there: the line that starts at `V` corrects its space from a position that can be 4px, 256 LayoutUnits, off
    // (limits.ts positionLimit names it glyph-clusters first). At 181px the line's fit lies within that; the reach reports
    // from 180.25 to 184px.
    const text = 'xxxx xxxx xxxx xxx Vxxx xxxx xxxx xxxx'
    const within = lines(prepared('Kern', text), 181)
    expect(within.map(line => line.end)).toEqual([19, 34, 38])
    expect(withDetail(within[1]!.gaps, START_REACH).map(gap => [gap.gap, gap.at])).toEqual([['glyph-clusters', { start: 34, end: 34 }]])
    // At 185px the fit lies past what the start can be off by; and `Mono`'s start is known.
    for (const line of lines(prepared('Kern', text), 185)) expect(withDetail(line.gaps, START_REACH)).toEqual([])
    for (const line of lines(prepared('Mono', text), 181)) expect(withDetail(line.gaps, START_REACH)).toEqual([])
  })
})

describe('blink gaps of a window side Canvas shapes otherwise than the paragraph', () => {
  test('a window side of white space alone in a face whose space takes the script reports script-context', () => {
    // A group of 256 zoomed px or more whose windows shrink to sides of spaces and no-break spaces alone; `ж` makes the
    // paragraph 16-bit, so it is segmented and its spaces are U+2028 in Canvas strings.
    const text = `x${' \u00a0'.repeat(20)}x ж`
    const space = withDetail(paragraphGaps(prepared('SpaceScript', text)), WHITE_SPACE_SIDE)
    expect(space.length).toBeGreaterThan(0)
    for (const gap of space) expect(gap.gap).toBe('script-context')
    // A face whose lone U+2028 measures as its 8-bit space reports nothing, and neither does an unsegmented paragraph.
    expect(withDetail(paragraphGaps(prepared('Mono', text)), WHITE_SPACE_SIDE)).toEqual([])
    expect(withDetail(paragraphGaps(prepared('SpaceScript', `x${' \u00a0'.repeat(20)}x`)), WHITE_SPACE_SIDE)).toEqual([])
  })

  test('a window side Canvas shapes as Common alone between letters of one script reports script-context where it decides', () => {
    // At 64px (40px a code point, words first off) the cut search's windows around the digits between Cyrillic words
    // shrink to a side ` 1234` alone, which `Neutral` measures 12px wider as Common than in its run.
    const text = 'жжжж жжжж жжжж жжжж 1234 жжжж жжжж жжжж жжжж'
    const common = withDetail(paragraphGaps(prepared('Neutral', text, 64)), COMMON_SIDE)
    expect(common.length).toBeGreaterThan(0)
    for (const gap of common) {
      expect(gap.gap).toBe('script-context')
      expect(gap.at!.start).toBeGreaterThanOrEqual(14)
      expect(gap.at!.end).toBeLessThanOrEqual(30)
    }
    expect(withDetail(paragraphGaps(prepared('Mono', text, 64)), COMMON_SIDE)).toEqual([])
  })
})
