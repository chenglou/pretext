// What a shaping group keeps by offset (types.ts BlinkGroup.prefix16, pair16, wide16), held from outside: a kept paragraph
// against fresh ones at widths met in any order, on a stand-in Canvas that kerns a pair and widens a letter before a
// space by what stands two letters before it, so the pair window and the wide window show different adjustments and the
// wide window's depends on where it starts. lines.test.ts holds the same on a paragraph whose one group is cut; here a
// group below 256 px, which has no cuts, a group with cuts, a box that ends shaping, a right-to-left run, letter spacing
// and a soft hyphen.
import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type InlineNode, type Paragraph } from '../../model.js'
import { fillLine, firstLine, inspectLine, linePieces, prepare } from './index.js'

let asked = 0

class Context {
  font = '16px x'
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    asked++
    const units: string[] = []
    for (const c of text) if (c.codePointAt(0) !== 0x200d && c.codePointAt(0) !== 0x200b && c.codePointAt(0) !== 0x2060) units.push(c)
    let width = units.length * (10 + parseFloat(this.letterSpacing))
    for (let i = 0; i < units.length; i++) {
      // `ox` kerns by 1 px; a letter before a space is 2 px wider when `u` stands two letters before it.
      if (units[i] === 'o' && units[i + 1] === 'x') width -= 1
      if (i >= 2 && units[i - 2] === 'u' && units[i + 1]?.codePointAt(0) === 0x2028) width += 2
    }
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

const font = { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS } as const
const style = { font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'auto', tabSize: 8 } as const
const padded: BoxEdge = { margin: 0, border: 0, padding: 4 }
const none: BoxEdge = { margin: 0, border: 0, padding: 0 }

function paragraphOf(content: InlineNode[]): Paragraph {
  return { ...style, content, lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' }
}

function span(text: string, edge: BoxEdge, letterSpacing: number): InlineNode {
  return { ...style, letterSpacing, kind: 'span', lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text }] }
}

function laidOut(prepared: ReturnType<typeof prepare>, width: number, inspect: boolean): string {
  const lines: unknown[] = []
  for (let start = firstLine(prepared); start !== null;) {
    const result = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (result.kind === 'line') lines.push({ start: result.start, end: result.end, pieces: linePieces(prepared, result.line), gaps: inspect ? inspectLine(prepared, result.line).gaps : null })
    start = result.next
  }
  return JSON.stringify(lines)
}

// Five Hebrew letters, a right-to-left run, and the soft hyphen, written by number so that they show.
const HEBREW = String.fromCharCode(0x5d0, 0x5d1, 0x5d2, 0x5d3, 0x5d4)
const SHY = String.fromCharCode(0xad)
const SHORT = paragraphOf([{ kind: 'text', text: 'four ox quux box' }])
const RICH = paragraphOf([
  { kind: 'text', text: 'a quux ox in the fox box, then quu' },
  span('x ox boxed', padded, 0),
  { kind: 'text', text: ` ox ${HEBREW.slice(0, 3)} ${HEBREW.slice(3)} ox` },
  span(' spaced ox quux out', none, 1.5),
  { kind: 'text', text: ` hy${SHY}phen${SHY}at${SHY}ion ox quux box ox` },
])
const WIDTHS = [30, 55, 90, 140, 200, 330, 100000]

test('a group without cuts asks Canvas nothing at a width it has met', () => {
  const prepared = prepare(SHORT, env, false)
  const first = laidOut(prepared, 60, false)
  asked = 0
  expect(laidOut(prepared, 60, false)).toBe(first)
  expect(asked).toBe(0)
})

test('a kept paragraph gives a fresh paragraph\'s lines and pieces at every width, in any order, and again', () => {
  for (const p of [SHORT, RICH]) {
    const orders = [WIDTHS, WIDTHS.slice().reverse(), [140, 30, 100000, 55, 330, 90, 200]]
    for (let o = 0; o < orders.length; o++) {
      const prepared = prepare(p, env, false)
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < orders[o]!.length; i++) expect(laidOut(prepared, orders[o]![i]!, false)).toBe(laidOut(prepare(p, env, false), orders[o]![i]!, false))
      }
    }
  }
})

test('an inspected paragraph whose pieces were read at other widths first raises every gap a fresh one raises', () => {
  const prepared = prepare(RICH, env, true)
  for (let i = WIDTHS.length - 1; i >= 0; i--) laidOut(prepared, WIDTHS[i]!, false)
  for (let i = 0; i < WIDTHS.length; i++) expect(laidOut(prepared, WIDTHS[i]!, true)).toBe(laidOut(prepare(RICH, env, true), WIDTHS[i]!, true))
})
