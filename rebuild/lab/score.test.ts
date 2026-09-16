import { describe, expect, test } from 'bun:test'
import { deriveNative, scoreRow, type Derived } from './score.ts'
import type { BrowserKind, CodePointObservation, FontDecl, LabRow, Paragraph, PainterLine, Rect, TextRun } from './types.ts'

const arial: FontDecl = { family: 'Arial', size: 16, weight: 400, style: 'normal' }

function paragraph(runs: Array<[text: string, node: TextRun['node']]>, overrides: Partial<Paragraph> = {}): Paragraph {
  return {
    runs: runs.map(([text, node]) => ({ text, node, font: arial, letterSpacing: 0, wordSpacing: 0, lang: null })),
    font: arial, letterSpacing: 0, wordSpacing: 0, width: 200, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', ...overrides,
  }
}

// A rect on line `line` (lines are 20px tall).
const at = (x: number, width: number, line = 0): Rect => ({ x, y: line * 20, width, height: 20 })

// Code point observations for text, taking each code point's rects in order.
function observe(text: string, rects: Rect[][]): CodePointObservation[] {
  const points: CodePointObservation[] = []
  for (let offset = 0; offset < text.length;) {
    const length = text.codePointAt(offset)! > 0xffff ? 2 : 1
    points.push({ offset, length, rects: rects[points.length]! })
    offset += length
  }
  if (points.length !== rects.length) throw new Error(`${rects.length} rect lists for ${points.length} code points`)
  return points
}

function makeRow(browser: BrowserKind, p: Paragraph, rects: Rect[][], runRects: Rect[][], predicted: Array<[start: number, end: number, width: number]>,
  painted: PainterLine[] | null = null): LabRow {
  const text = p.runs.map(run => run.text).join('')
  return {
    id: 'c-test', family: 'test', browser,
    case: { id: 'c-test', family: 'test', origin: 'test', pageLang: 'en', paragraph: p },
    env: { userAgent: 'test', devicePixelRatio: 2, visualViewportScale: 1, pageLang: 'en', fontFixtures: [], innerWidth: 0, innerHeight: 0, outerWidth: 0, outerHeight: 0, visibilityState: 'visible', hasFocus: false },
    native: { fontsStatusBefore: 'loaded', fontsStatusAfter: 'loaded', rejectedStyles: [], height: predicted.length * p.lineHeight, width: p.width, points: observe(text, rects), runRects },
    prediction: { lines: predicted.map(([start, end, width]) => ({ start, end, width })) },
    painter: painted === null ? null : { lines: painted },
    timings: { nativeMs: 0, predictMs: 0, paintMs: 0, painterObserveMs: 0 },
  }
}

function derive(row: LabRow): Derived {
  if ('error' in row.native) throw new Error(row.native.error)
  const derived = deriveNative(row.case, row.native, row.case.paragraph.runs.map(run => run.text).join(''), row.browser, row.env.devicePixelRatio)
  if ('error' in derived) throw new Error(derived.error)
  return derived
}

describe('a grapheme with ink is visible through the code point that has its rect', () => {
  // Firefox puts an emoji + VS16 cluster's advance on the VS16 and gives U+2764 a zero-width rect.
  const text = 'a ❤️❤️'
  const firefoxRects = [[at(0, 10)], [at(10, 5)], [at(15, 0)], [at(15, 18)], [at(33, 0)], [at(33, 18)]]

  test('Firefox: the VS16 carries the cluster, so the space before it is not hanging and the extent reaches the hearts', () => {
    const row = makeRow('firefox', paragraph([[text, 'text']]), firefoxRects, [[at(0, 51)]], [[0, 6, 51]])
    const line = derive(row).lines[0]!
    expect(line.firstVisible).toBe(0)
    expect(line.lastVisible).toBe(5)
    expect(line.widthSource).toBe('nodes')
    expect(line.right).toBe(51)
    expect(scoreRow(row).metrics.widths).toEqual({ status: 'pass' })
  })

  test('Firefox: a line holding only an emoji + VS16 has a visible code point at the grapheme start', () => {
    const row = makeRow('firefox', paragraph([['ab ❤️', 'text']], { width: 30 }),
      [[at(0, 10)], [at(10, 10)], [at(20, 0)], [at(0, 0, 1)], [at(0, 18, 1)]], [[at(0, 20), at(0, 18, 1)]], [[0, 3, 20], [3, 5, 18]])
    const lines = derive(row).lines
    expect(lines.map(line => [line.firstVisible, line.lastVisible, line.right - line.left])).toEqual([[0, 1, 20], [3, 4, 18]])
    expect(scoreRow(row).metrics.widths).toEqual({ status: 'pass' })
  })

  test('Chrome: every code point of the cluster copies its rect, so only the last visible code point moves', () => {
    const chromeRects = [[at(0, 10)], [at(10, 5)], [at(15, 18)], [at(15, 18)], [at(33, 18)], [at(33, 18)]]
    const row = makeRow('chrome', paragraph([[text, 'text']]), chromeRects, [[at(0, 51)]], [[0, 6, 51]])
    const line = derive(row).lines[0]!
    expect([line.lastVisible, line.widthSource, line.right]).toEqual([5, 'nodes', 51])
  })

  test('painter: painted code points follow the same rule', () => {
    const painted: PainterLine = { box: at(0, 200), height: 20, rects: [at(0, 51)], extent: { left: 0, right: 51 }, text, points: observe(text, firefoxRects) }
    const row = makeRow('firefox', paragraph([[text, 'text']]), firefoxRects, [[at(0, 51)]], [[0, 6, 51]], [painted])
    expect(scoreRow(row).metrics.painter).toEqual({ status: 'pass' })
  })

  test('white space in a grapheme with ink keeps hanging', () => {
    // A trailing SPACE + U+0301 at a line end under pre-wrap: the space has the rect, the mark none.
    const row = makeRow('firefox', paragraph([['ab ́', 'text']], { whiteSpace: 'pre-wrap' }),
      [[at(0, 10)], [at(10, 10)], [at(20, 5)], [at(25, 0)]], [[at(0, 25)]], [[0, 4, 20]])
    const line = derive(row).lines[0]!
    expect([line.lastVisible, line.widthSource, line.right]).toEqual([1, 'code points', 20])
  })
})

describe('Safari widths take box edges from whole-node rects', () => {
  const f32 = Math.fround

  test('a box right edge is the float32 sum of its x and width', () => {
    const left = f32(30.469196319580078)
    const width = f32(71.9345703125)
    const row = makeRow('webkit-host', paragraph([['ab', 'span'], ['cd', 'span']]),
      [[at(0, 16)], [at(15, f32(left - 15))], [at(left, 36)], [at(66, f32(f32(left + width) - 66))]],
      [[at(0, left)], [at(left, width)]], [[0, 4, f32(left + width)]])
    const line = derive(row).lines[0]!
    expect(line.widthSource).toBe('nodes')
    expect(line.right).toBe(f32(left + width))
    expect(scoreRow(row).metrics.widths).toEqual({ status: 'pass' })
  })

  // `ab` in a span whose box ends at 20.6px, then a hanging space in a bare text node, so widths come from code points.
  const boxEnd = f32(20.6)
  const floored = Math.floor(boxEnd * 64) / 64
  const spanThenSpace = paragraph([['ab', 'span'], [' ', 'text']], { whiteSpace: 'pre-wrap' })

  test('an edge floored to 1/64px at a box end comes from that box', () => {
    const row = makeRow('webkit-host', spanThenSpace, [[at(0, 11)], [at(10, floored - 10)], [at(boxEnd, 5)]],
      [[at(0, boxEnd)], [at(boxEnd, 5)]], [[0, 3, boxEnd]])
    const line = derive(row).lines[0]!
    expect(floored).toBe(20.59375)
    expect([line.widthSource, line.widthIssue, line.right]).toEqual(['code points', null, boxEnd])
    expect(scoreRow(row).metrics.widths).toEqual({ status: 'pass' })
  })

  test('a whole-px edge that no box edge equals is unobserved', () => {
    // One text node `ab `: `b` ends inside the box, so Safari snaps its right edge outward to 21.
    const row = makeRow('webkit-host', paragraph([['ab ', 'text']], { whiteSpace: 'pre-wrap' }),
      [[at(0, 11)], [at(10, 11)], [at(20, Math.floor(f32(25.6) * 64) / 64 - 20)]], [[at(0, f32(25.6))]], [[0, 3, boxEnd]])
    expect(derive(row).lines[0]!.widthIssue).toBe('Safari snaps partial Range rects to whole CSS px; hanging white space rules out whole-node geometry')
    expect(scoreRow(row).metrics.widths.status).toBe('unobserved')
  })

  test('an edge off the whole px that no box end floors to is unobserved', () => {
    const row = makeRow('webkit-host', spanThenSpace, [[at(0, 11)], [at(10, floored - 10)], [at(f32(20.7), 5)]],
      [[at(0, f32(20.7))], [at(f32(20.7), 5)]], [[0, 3, f32(20.7)]])
    expect(derive(row).lines[0]!.widthIssue).toBe('Safari floors a text box end in Range rects to 1/64px; no whole-node rect ends at the edge code point')
    expect(scoreRow(row).metrics.widths.status).toBe('unobserved')
  })

  test('a whole-px edge equal to a box edge is observed', () => {
    const row = makeRow('webkit-host', paragraph([['ab', 'span'], [' ', 'text']], { whiteSpace: 'pre-wrap' }),
      [[at(0, 16)], [at(16, 16)], [at(32, 4)]], [[at(0, 32)], [at(32, 4)]], [[0, 3, 32]])
    const line = derive(row).lines[0]!
    expect([line.widthIssue, line.right]).toEqual([null, 32])
    expect(scoreRow(row).metrics.widths).toEqual({ status: 'pass' })
  })

  test('Chrome keeps the code point rect edge', () => {
    const row = makeRow('chrome', spanThenSpace, [[at(0, 11)], [at(10, 10.59375)], [at(20.59375, 5)]],
      [[at(0, 20.59375)], [at(20.59375, 5)]], [[0, 3, 20.59375]])
    expect(derive(row).lines[0]!.right).toBe(20.59375)
  })
})
