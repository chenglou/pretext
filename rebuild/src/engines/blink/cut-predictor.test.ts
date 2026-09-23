// The cut predictor (shape.ts windowAdjust16, predictedWindow; addPieces and adjustBetweenCuts16 handing totals down) on a
// stand-in Canvas where every code point is 10px wide at 16px, at a device pixel ratio of 1, so a string of 26 code points
// or more is 256 zoomed px or more. Family `Mono` adjusts nothing. `Context` takes 200px off a string that holds `Q` and not
// `Z`: a window inside a string can then be wider than the string, which breaks the predictor's premise. `Wide` draws `M`
// 100px wide, so a range's share of a total by its length can be far off.
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { createContextPool } from '../../measure/canvas.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, firstLine, paragraphGaps, prepare } from './index.js'
import type { BlinkPrepared } from './types.js'

let asked: { text: string; width: number }[] = []

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
    let width = text.length * 10
    if (this.font.includes('Context') && text.includes('Q') && !text.includes('Z')) width -= 200
    if (this.font.includes('Wide')) width += 90 * (text.split('M').length - 1)
    width = width * size / 16
    asked.push({ text, width })
    return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

function prepared(family: string, text: string, inspect: boolean): BlinkPrepared {
  const paragraph: Paragraph = {
    font: { family, size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr',
    lang: 'en', textIndent: 0, textAlign: 'start',
  }
  return prepare(paragraph, env, inspect, createContextPool())
}

function lineEnds(p: BlinkPrepared, width: number): number[] {
  const ends: number[] = []
  let start = firstLine(p)
  while (start !== null) {
    const filled = fillLine(p, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('a slot without insets never refuses a line')
    ends.push(filled.end)
    start = filled.next
  }
  return ends
}

describe('blink cut predictor', () => {
  test('a plain paragraph takes the windows the shrink takes, asking fewer strings of 256 zoomed px or more', () => {
    const text = 'x'.repeat(400)
    asked = []
    const plain = prepared('Mono', text, false)
    const wide = asked.filter(a => a.width >= 256).length
    asked = []
    const inspected = prepared('Mono', text, true)
    const wideInspected = asked.filter(a => a.width >= 256).length
    expect(plain.groups[0]!.cuts).toEqual(inspected.groups[0]!.cuts)
    expect(plain.groups[0]!.prefixAtCut).toEqual(inspected.groups[0]!.prefixAtCut)
    expect(paragraphGaps(inspected).filter(g => g.gap === 'nested-window-wider')).toEqual([])
    expect(wide).toBeLessThan(wideInspected / 2)
    for (let width = 40; width <= 4000; width += 173) expect(lineEnds(plain, width)).toEqual(lineEnds(inspected, width))
  })

  test('a window wider than the string around it: the shrink and the prediction take other windows, and an inspected paragraph reports nested-window-wider', () => {
    // [0, 61) holds Q and Z and measures 610px. Around offset 30 the shrink tries [0, 45), 250px since it holds Q without Z,
    // and takes it; the prediction scales 610px to each window's length, starts at [23, 45), and confirms it by [15, 45),
    // 300px. Both windows show no adjustment at 30, so the cut and the lines are the same.
    const text = `Q${'x'.repeat(59)}Z`
    const plain = prepared('Context', text, false)
    const inspected = prepared('Context', text, true)
    expect(plain.groups[0]!.cuts).toEqual(inspected.groups[0]!.cuts)
    expect(inspected.groups[0]!.cuts).toContain(30)
    expect(paragraphGaps(inspected).filter(g => g.gap === 'nested-window-wider').length).toBeGreaterThan(0)
    for (let width = 30; width <= 700; width += 37) expect(lineEnds(plain, width)).toEqual(lineEnds(inspected, width))
  })

  test('an inspected paragraph asks every string a plain one asks where a range measures far less than its estimate', () => {
    // The cut at 20 hands [20, 40) half of 2,200px as its estimate, twice 256 zoomed px and more, where it measures 200px:
    // a plain paragraph searches it without measuring it first, and an inspected one must ask what that search asks. The
    // letters after the Ms differ, so each window of them is a string of its own.
    const text = `${'M'.repeat(20)}abcdefghijklmnopqrst`
    const strings = (inspect: boolean): { p: BlinkPrepared; ends: number[][]; asked: Set<string> } => {
      asked = []
      const p = prepared('Wide', text, inspect)
      const ends: number[][] = []
      for (let width = 30; width <= 2400; width += 97) ends.push(lineEnds(p, width))
      return { p, ends, asked: new Set(asked.map(a => a.text)) }
    }
    const plain = strings(false)
    const inspected = strings(true)
    expect(plain.p.groups[0]!.cuts.slice(-2)).toEqual([20, 40])
    expect([...plain.asked].filter(s => !inspected.asked.has(s))).toEqual([])
    expect(plain.p.groups[0]!.cuts).toEqual(inspected.p.groups[0]!.cuts)
    expect(plain.ends).toEqual(inspected.ends)
  })
})
