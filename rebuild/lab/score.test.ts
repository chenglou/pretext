import { describe, expect, test } from 'bun:test'
import { mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveNative, indexRows, readRowAt, scoreRow, withNativeRow, type Derived } from './score.ts'
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
  if ('skipped' in row.native) throw new Error('native observation skipped')
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

describe('a control other than TAB, LF and CR with a positive rect is visible', () => {
  test('Safari: a line holding only U+001C observes its .notdef advance', () => {
    const row = makeRow('webkit-host', paragraph([['ab', 'text']], { width: 20 }),
      [[at(0, 9)], [at(9, 9)], [at(0, 12, 1)]], [[at(0, 18), at(0, 12, 1)]], [[0, 2, 18], [2, 3, 12]])
    const lines = derive(row).lines
    expect(lines.map(line => [line.firstVisible, line.lastVisible, line.widthSource, line.right - line.left])).toEqual([[0, 1, 'nodes', 18], [2, 2, 'nodes', 12]])
    expect(scoreRow(row).metrics.widths).toEqual({ status: 'pass' })
  })

  test('Safari: a trailing FF with an advance ends the extent instead of hanging', () => {
    const row = makeRow('webkit-host', paragraph([['ab', 'span'], ['\f', 'text']], { whiteSpace: 'nowrap' }),
      [[at(0, 9)], [at(9, 9)], [at(18, 16)]], [[at(0, 18)], [at(18, 16)]], [[0, 3, 34]])
    const line = derive(row).lines[0]!
    expect([line.lastVisible, line.widthSource, line.right]).toEqual([2, 'nodes', 34])
    expect(scoreRow(row).metrics.widths).toEqual({ status: 'pass' })
  })

  test('Firefox: U+0000 with a 1px rect counts, and a zero-width VT does not', () => {
    const nul = makeRow('firefox', paragraph([['a  b', 'text']], { whiteSpace: 'pre-wrap', width: 20 }),
      [[at(0, 8.1)], [at(8.1, 1)], [at(9.1, 5)], [at(0, 9, 1)]], [[at(0, 14.1), at(0, 9, 1)]], [[0, 3, 9.1], [3, 4, 9]])
    const first = derive(nul).lines[0]!
    expect([first.lastVisible, first.widthSource]).toEqual([1, 'code points'])
    expect(first.right - first.left).toBeCloseTo(9.1, 9)
    expect(scoreRow(nul).metrics.widths).toEqual({ status: 'pass' })
    const vt = makeRow('firefox', paragraph([['ab', 'text']], { whiteSpace: 'pre-wrap' }),
      [[at(0, 9)], [at(9, 9)], [at(18, 0)]], [[at(0, 18)]], [[0, 3, 18]])
    expect([derive(vt).lines[0]!.lastVisible, derive(vt).lines[0]!.right]).toEqual([1, 18])
  })
})

describe('breaks compare clusters as native layout drew them', () => {
  // `nai` in one span, U+0308 U+0301 `v` in the next: WebKit and Firefox break between `i` and U+0308, which the lab's
  // segmenter keeps in one grapheme. Native lines: `n`, `a`, `i`, then the marks, then `v`.
  const p = paragraph([['nai', 'span'], ['̈́v', 'span']], { width: 1 })
  const rects = [[at(0, 9, 0)], [at(0, 8, 1)], [at(0, 5, 2)], [at(0, 7, 3)], [at(0, 7, 3)], [at(0, 7, 4)]]
  const runRects = [[at(0, 9, 0), at(0, 8, 1), at(0, 5, 2)], [at(0, 7, 3), at(0, 7, 4)]]

  test('a line start where native layout splits the grapheme is a cluster start', () => {
    const row = makeRow('webkit-host', p, rects, runRects, [[0, 1, 9], [1, 2, 8], [2, 3, 5], [3, 5, 7], [5, 6, 7]])
    const derived = derive(row)
    expect([derived.graphemeStart[3], derived.clusterStart[3], derived.clusterStart[4]]).toEqual([2, 3, 3])
    expect(derived.lines[3]!.firstVisible).toBe(3)
    expect(scoreRow(row).metrics.breaks).toEqual({ status: 'pass' })
  })

  test('a prediction that starts elsewhere inside the native cluster still splits it', () => {
    const row = makeRow('webkit-host', p, rects, runRects, [[0, 1, 9], [1, 2, 8], [2, 4, 5], [4, 5, 7], [5, 6, 7]])
    expect(scoreRow(row).metrics.breaks).toEqual({ status: 'fail', reason: 'predicted line splits a grapheme', detail: '3 "̈́v"' })
  })

  test('a grapheme native layout keeps on one line still counts as one', () => {
    // One text node: Chrome keeps `i` + U+0308 on one line and gives the mark a copy of the letter's rect.
    const q = paragraph([['naïv', 'text']], { width: 1 })
    const row = makeRow('chrome', q, [[at(0, 9, 0)], [at(0, 8, 1)], [at(0, 5, 2)], [at(0, 5, 2)], [at(0, 7, 3)]],
      [[at(0, 9, 0), at(0, 8, 1), at(0, 5, 2), at(0, 7, 3)]], [[0, 1, 9], [1, 2, 8], [2, 3, 5], [3, 5, 7]])
    expect(derive(row).clusterStart[3]).toBe(2)
    expect(scoreRow(row).metrics.breaks).toEqual({ status: 'fail', reason: 'predicted line splits a grapheme', detail: `2 ${JSON.stringify('ïv')}` })
  })

  test('Chrome break-all: a Thai vowel alone on its line in one text node', () => {
    const row = makeRow('chrome', paragraph([['ทู', 'text']], { width: 2, wordBreak: 'break-all' }),
      [[at(0, 12)], [at(0, 10, 1)]], [[at(0, 12), at(0, 10, 1)]], [[0, 1, 12], [1, 2, 10]])
    expect(derive(row).lines.map(line => line.firstVisible)).toEqual([0, 1])
    expect(scoreRow(row).metrics.breaks).toEqual({ status: 'pass' })
  })
})

describe('rows from run.ts --predict-only take native observations from another run', () => {
  const p = paragraph([['ab cd', 'text']], { width: 30 })
  // `ab ` on line 0 and `cd` on line 1, with a hanging space.
  const rects = [[at(0, 9)], [at(9, 9)], [at(18, 4)], [at(0, 9, 1)], [at(9, 9, 1)]]
  const runRects = [[at(0, 22), at(0, 18, 1)]]
  const native = makeRow('chrome', p, rects, runRects, [[0, 3, 18], [3, 5, 18]])
  const predictOnly = (lines: Array<[number, number, number]>): LabRow => ({ ...makeRow('chrome', p, rects, runRects, lines), native: { skipped: 'predict-only' } })

  test('without a native row, every metric is unobserved', () => {
    expect(scoreRow(predictOnly([[0, 5, 36]])).metrics.lineCount).toEqual({ status: 'unobserved', reason: 'native observation skipped', detail: 'predict-only' })
  })

  test('combined with the native row, the prediction scores against that observation', () => {
    const combined = withNativeRow(predictOnly([[0, 5, 36]]), native)
    if ('error' in combined) throw new Error(combined.error)
    expect(combined.native).toBe(native.native)
    expect(scoreRow(combined).metrics.lineCount).toEqual({ status: 'fail', reason: 'line count differs', detail: 'native 2, predicted 1' })
    const good = withNativeRow(predictOnly([[0, 3, 18], [3, 5, 18]]), native)
    if ('error' in good) throw new Error(good.error)
    expect([scoreRow(good).metrics.breaks.status, scoreRow(good).metrics.widths.status]).toEqual(['pass', 'pass'])
  })

  test('refuses rows it cannot combine', () => {
    const errorOf = (value: LabRow | { error: string }): string => ('error' in value ? value.error : 'combined')
    expect(errorOf(withNativeRow(native, native))).toBe('row c-test has its own native observation; --native-rows takes rows from run.ts --predict-only')
    expect(errorOf(withNativeRow(predictOnly([]), predictOnly([])))).toBe('the native row for c-test has no native observation either')
    const otherCase = { ...native, case: { ...native.case, paragraph: { ...p, width: 31 } } }
    expect(errorOf(withNativeRow(predictOnly([]), otherCase))).toBe('the native row for c-test observed a different case')
    const otherBrowser = { ...native, env: { ...native.env, userAgent: 'other', devicePixelRatio: 1 } }
    expect(errorOf(withNativeRow(predictOnly([]), otherBrowser))).toBe('the environments differ for c-test: userAgent "test" vs "other"; devicePixelRatio 2 vs 1')
    expect(errorOf(withNativeRow(predictOnly([]), { ...native, browser: 'firefox' }))).toBe('the environments differ for c-test: browser "chrome" vs "firefox"')
  })

  test('indexRows finds rows by byte offset, past multi-byte text and blank lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lab-score-test-'))
    const path = join(dir, 'rows.ndjson')
    const texts = ['日本語 テキスト', 'emoji 👩‍👩‍👧 and U+2028   here', 'plain']
    const rows = texts.map((text, i) => ({ ...predictOnly([]), id: `c-${i}`, case: { ...native.case, id: `c-${i}`, paragraph: paragraph([[text, 'text']]) } }))
    // A row whose id isn't first is found by parsing it.
    const reordered = JSON.stringify({ family: 'test', id: 'c-late' })
    writeFileSync(path, `${JSON.stringify(rows[0])}\n\n${JSON.stringify(rows[1])}\n${reordered}\n${JSON.stringify(rows[2])}`)
    return indexRows(path).then(index => {
      expect([...index.keys()]).toEqual(['c-0', 'c-1', 'c-late', 'c-2'])
      const fd = openSync(path, 'r')
      for (let i = 0; i < rows.length; i++) expect(readRowAt(fd, index.get(`c-${i}`)!)).toEqual(rows[i]!)
      expect(Buffer.byteLength(readFileSync(path, 'utf8').split('\n')[2]!)).toBe(index.get('c-1')!.length)
      writeFileSync(path, `${JSON.stringify(rows[0])}\n${JSON.stringify(rows[0])}\n`)
      return expect(indexRows(path)).rejects.toThrow(`${path}: two rows for case c-0`)
    })
  })

  test('score.ts --native-rows scores a predict-only run and refuses another environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lab-score-cli-'))
    const nativePath = join(dir, 'native.ndjson')
    const predictPath = join(dir, 'predict.ndjson')
    writeFileSync(nativePath, `${JSON.stringify(native)}\n`)
    writeFileSync(predictPath, `${JSON.stringify(predictOnly([[0, 3, 18], [3, 5, 18]]))}\n`)
    const run = (nativeRows: string): { code: number; stderr: string; summary: unknown } => {
      const out = join(dir, 'summary.json')
      writeFileSync(out, '')
      const result = Bun.spawnSync(['bun', join(import.meta.dir, 'score.ts'), `--rows=${predictPath}`, `--native-rows=${nativeRows}`, `--out=${out}`])
      const text = readFileSync(out, 'utf8')
      return { code: result.exitCode, stderr: result.stderr.toString(), summary: text === '' ? null : JSON.parse(text) }
    }
    const ok = run(nativePath)
    expect(ok.code).toBe(0)
    const summary = ok.summary as { nativeRows: unknown; browsers: { chrome: { metrics: { breaks: { pass: number } } } } }
    expect(summary.nativeRows).toEqual({ used: 1, missing: 0 })
    expect(summary.browsers.chrome.metrics.breaks.pass).toBe(1)
    writeFileSync(nativePath, `${JSON.stringify({ ...native, env: { ...native.env, userAgent: 'other' } })}\n`)
    const refused = run(nativePath)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('the environments differ for c-test: userAgent "test" vs "other"')
    expect(refused.summary).toBeNull()
    writeFileSync(nativePath, `${JSON.stringify({ ...native, id: 'c-other' })}\n`)
    const missing = run(nativePath)
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('1 rows have no row for their case in --native-rows=')
    expect((missing.summary as { nativeRows: unknown }).nativeRows).toEqual({ used: 0, missing: 1 })
  })
})
