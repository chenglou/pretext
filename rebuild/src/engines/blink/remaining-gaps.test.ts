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

function paragraphIn(family: string, text: string, size: number): Paragraph {
  return {
    font: { family, size, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr',
    lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

function prepared(family: string, text: string, size: number = 16, inspect: boolean = true): BlinkPrepared {
  return prepare(paragraphIn(family, text, size), env, inspect, createContextPool())
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
const START_REACH = 'a wrapped line start taken from a stand-in position, and the line'
const WHITE_SPACE_SIDE = 'a window side of white space alone'
const COMMON_SIDE = 'a window side that Canvas shapes as Common alone'

describe('blink gaps of a fit within what positions can be off by', () => {
  test('a wrapped line start beside a space whose line fits within a LayoutUnit reports in-word-prefix over the line and the content its decision measured', () => {
    // 10px a code point: at 90px `xxxx xxxx` and `Vxxx xxxx` fit with no LayoutUnit to spare. The first line's start is
    // the paragraph's, which no reshape corrects; the third starts after a space, which the pair window calls safe.
    const text = 'xxxx xxxx xxxx xxx Vxxx xxxx xxxx xxxx'
    const exact = lines(prepared('Mono', text), 90)
    expect(exact.map(line => line.end)).toEqual([10, 19, 29, 38])
    expect(withDetail(exact[0]!.gaps, ONE_UNIT)).toEqual([])
    expect(withDetail(exact[2]!.gaps, ONE_UNIT).map(gap => [gap.gap, gap.at])).toEqual([['in-word-prefix', { start: 19, end: 34 }]])
    // 5px more leaves 320 LayoutUnits, and the next word would need more than the line has.
    for (const line of lines(prepared('Mono', text), 95)) expect(withDetail(line.gaps, ONE_UNIT)).toEqual([])
    // A plain paragraph lays the same lines out and reports nothing.
    expect(lines(prepared('Mono', text, 16, false), 90).map(line => line.end)).toEqual(exact.map(line => line.end))
  })

  test('a wrapped line start taken from a stand-in position reports its reach where the fit lies within the adjustment', () => {
    // `Kern` kerns the space before `V` by -4px, which no pairKerning fact places, and no ligature fact says no ligature
    // forms there: the line that starts at `V` corrects its space from a position that can be 4px, 256 LayoutUnits, off
    // (limits.ts positionLimit names it glyph-clusters first). At 181px the line's fit lies within that; the reach reports
    // from 180.25 to 184px.
    const text = 'xxxx xxxx xxxx xxx Vxxx xxxx xxxx xxxx'
    const within = lines(prepared('Kern', text), 181)
    expect(within.map(line => line.end)).toEqual([19, 34, 38])
    expect(withDetail(within[1]!.gaps, START_REACH).map(gap => [gap.gap, gap.at])).toEqual([['glyph-clusters', { start: 19, end: 38 }]])
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
