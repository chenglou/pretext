// The pair window of shape.ts pairAdjust16 on a stand-in Canvas that kerns `A` with `V` by -4px at 16px, across
// default-ignorable characters and marks, as a font's pair lookup with the IgnoreMarks flag does (and the kern and kerx
// machine always, hb-kern.hh:58). Every other code point is 10px wide, default-ignorable characters and marks 0.
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, firstLine, prepare } from './index.js'

const WJ = String.fromCodePoint(0x2060)
const ZWJ = String.fromCodePoint(0x200d)
const ACUTE = String.fromCodePoint(0x301)

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
    const bases = text.split(WJ).join('').split(ZWJ).join('').split(ACUTE).join('')
    return { width: (bases.length * 10 - (bases.includes('AV') ? 4 : 0)) * size / 16, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

function linesOf(text: string, width: number): [number, number][] {
  const paragraph: Paragraph = {
    font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr',
    lang: 'en', textIndent: 0, textAlign: 'start',
  }
  const prepared = prepare(paragraph, env, false, [])
  const lines: [number, number][] = []
  let start = firstLine(prepared)
  while (start !== null) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('a slot without insets never refuses a line')
    lines.push([filled.start, filled.end])
    start = filled.next
  }
  return lines
}

describe('blink pair window', () => {
  // `A` is 6px wide before `V` whatever stands between them that lookups skip, so at 7px the break candidate is `V` and
  // the line ends before it. A window that stopped at the cluster of U+2060 and the mark measured no adjustment, left `A`
  // 10px wide, and the line overflowed after `A` alone.
  test('reaches past a cluster of a default-ignorable character and a mark', () => {
    expect(linesOf(`A${WJ}${ACUTE}V`, 7)).toEqual([[0, 3], [3, 4]])
  })

  test('as it does past a default-ignorable character alone, and with nothing between', () => {
    expect(linesOf(`A${WJ}V`, 7)).toEqual([[0, 2], [2, 3]])
    expect(linesOf('AV', 7)).toEqual([[0, 1], [1, 2]])
  })
})
