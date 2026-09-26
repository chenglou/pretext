// Planted defects: each test plants one fault the harness exists to catch and checks that it is caught. The test name
// says what an app developer would see if the fault went unseen.
import './watchdog.ts'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { srcOf } from './bench/lib.ts'
import { fontsKey, keyOf, type Environment } from './browsers.ts'
import { icuEntries, rustByteStrings } from './break-data.ts'
import { check, drift, equal, gate, parseArgs, record, type Io, type Options } from './cli.ts'
import { groupLines, recordedLines, scanLineEnds, searchLineEnds, type RectsAt } from './observe.ts'
import { bundle, documents, LIB, type Job } from './run.ts'
import {
  accept, attribute, buildChange, checkBlocks, freshRecordings, gateBlocks, gateSample, headline, judge, libraryFaults, pinning, predictionChange, reverseOrder, score, SEED,
  type Outcome, type Verdict,
} from './score.ts'
import {
  acceptedPath, assertSameEnvironment, caseProblem, historyPath, parseRecording, readAccepted, readHistory, readRecordings, readVarying, recordingsPath, recordingText,
  splitHistory, varyingPath, writeAccepted, writeHistory, writeRecordings, type Varying,
} from './store.ts'
import type { Case, Failure, Prediction, Recording, Rect, TextRun } from './types.ts'

// A browser stand-in: the text laid out with a line starting at each of `starts`, every code point 8 px wide (a space 4)
// and 18 px tall in a 20 px line. Returns the recording `record` would make and the rect reader it made it from.
function layOut(text: string, starts: number[]): { recording: Recording; nodeRects: Rect[]; rectsAt: RectsAt; reads: () => number } {
  const rects = new Map<number, Rect[]>()
  const nodeRects: Rect[] = []
  let line = -1
  let x = 0
  for (let offset = 0; offset < text.length; offset += text.codePointAt(offset)! > 0xffff ? 2 : 1) {
    if (starts[line + 1] === offset) {
      line++
      x = 0
      nodeRects.push({ x: 0, y: line * 20 + 1, width: 0, height: 18 })
    }
    // U+200B has no width, like a zero-width character in a browser.
    const width = text[offset] === '\u200b' ? 0 : text[offset] === ' ' ? 4 : 8
    rects.set(offset, [{ x, y: line * 20 + 1, width, height: 18 }])
    x += width
    nodeRects[line]!.width = x
  }
  let reads = 0
  const rectsAt: RectsAt = offset => {
    reads++
    return rects.get(offset) ?? []
  }
  return { recording: { lines: recordedLines(text, nodeRects, 20, rectsAt, 'chrome'), height: starts.length * 20 }, nodeRects, rectsAt, reads: () => reads }
}

function predicted(text: string, starts: number[]): Prediction {
  const lines = []
  for (let i = 0; i < starts.length; i++) lines.push({ start: starts[i]!, end: starts[i + 1] ?? text.length, width: 0 })
  return { lines, textHash: 0, prepareCalls: 0, prepareUnits: 0, lineCalls: 0, disagreement: null }
}

const TEXT = 'The quick brown fox jumps over the lazy dog'
const STARTS = [0, 10, 20, 31]

// A paragraph of plain text in 16 px Arial, 100 px wide.
function paragraphCase(text: string): Case {
  const font = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const }
  return {
    id: 't', family: 'test', origin: 'harness.test.ts', pageLang: 'en',
    paragraph: {
      runs: [{ text, node: 'text', font, letterSpacing: 0, wordSpacing: 0, lang: null }], font, letterSpacing: 0, wordSpacing: 0, width: 100,
      lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en',
    },
  }
}

describe('the pass rule', () => {
  test('a dropped last line fails: a message would lose its last line and its bubble would be too short', () => {
    const { recording } = layOut(TEXT, STARTS)
    expect(score(recording, predicted(TEXT, STARTS)).status).toBe('pass')
    const outcome = score(recording, predicted(TEXT, [0, 10, 20]))
    expect(outcome.status).toBe('count')
    expect(outcome.line).toBe(3)
  })

  test('a break moved by one character fails even with the right line count: a word would paint on the wrong line at the right height', () => {
    const { recording } = layOut(TEXT, STARTS)
    for (const starts of [[0, 11, 20, 31], [0, 9, 20, 31], [0, 10, 20, 32]]) {
      const outcome = score(recording, predicted(TEXT, starts))
      expect(outcome.status).toBe('breaks')
    }
  })

  test('a letter after a soft hyphen is checked on its own line: a wrong break at a hyphen would pass unseen', () => {
    // Chrome 153's rects for "a\u00ADb\u000B" (RTL, 17.85 px): the break is at the soft hyphen, and the "b" after it also
    // reports the hyphen's box on the line above (census row c-1af8783d8fa18040). Main predicted "b" on line 0.
    const points: Rect[][] = [
      [{ x: 3.6171875, y: 15, width: 8.8984375, height: 18 }],
      [{ x: 12.515625, y: 15, width: 0, height: 18 }, { x: 12.515625, y: 15, width: 5.328125, height: 18 }],
      [{ x: 12.515625, y: 15, width: 5.328125, height: 18 }, { x: 8.9453125, y: 63, width: 8.8984375, height: 18 }],
      [{ x: 3.6171875, y: 63, width: 5.328125, height: 18 }],
    ]
    const nodeRects = [
      { x: 3.6171875, y: 15, width: 8.8984375, height: 18 }, { x: 12.515625, y: 15, width: 5.328125, height: 18 },
      { x: 3.6171875, y: 63, width: 5.328125, height: 18 }, { x: 8.9453125, y: 63, width: 8.8984375, height: 18 },
    ]
    const lines = recordedLines('a\u00ADb\u000b', nodeRects, 48, offset => points[offset]!, 'chrome')
    expect(lines.map(line => [line.first, line.last])).toEqual([[0, 1], [2, 3]])
    // Other browsers' equal boxes of neighbouring characters are no copies.
    for (const browser of ['firefox', 'webkit-host', 'safari'] as const) {
      expect(recordedLines('a\u00ADb\u000b', nodeRects, 48, offset => points[offset]!, browser).map(line => [line.first, line.last])).toEqual([[0, 1], [3, 3]])
    }
    const main: Prediction = { lines: [{ start: 0, end: 3, width: 17.796875 }, { start: 3, end: 4, width: 4.4453125 }], textHash: 0, prepareCalls: 6, prepareUnits: 12, lineCalls: 0, disagreement: null }
    expect(score({ lines, height: 96 }, main).status).toBe('breaks')
  })

  test('line count comes from rect positions: fractional line boxes would otherwise fail every Safari 27 case', () => {
    // Three line boxes 20.0149 px tall: 60.0447 / 20 is 3.002, which the old harness's height check rejected.
    const boxes = [0, 1, 2].map(line => ({ x: 0, y: line * 20.0149, width: 50, height: 20.0149 }))
    expect(groupLines(boxes, 20).lo.length).toBe(3)
  })

  test('long paragraphs searched for line starts give the same lines as a scan: a book\'s wrong line would hide, or a right one fail', () => {
    let text = ''
    const starts: number[] = []
    for (let line = 0; line < 120; line++) {
      starts.push(text.length)
      // Words of mixed lengths, astral characters (some lines end with one and a letter), zero-width spaces, and a line
      // of nothing but zero-width spaces.
      text += line === 57 ? '\u200b\u200b\u200b' : `word${line} \u{1F600}x\u200bab${'c'.repeat(line % 7)}${line % 3 === 0 ? '\u{1F680}b' : ' '}`
    }
    const { rectsAt, reads, nodeRects } = layOut(text, starts)
    const lines = groupLines(nodeRects, 20)
    const before = reads()
    const scanned = scanLineEnds(text, lines, rectsAt)
    const scanReads = reads() - before
    const searched = searchLineEnds(text, lines, rectsAt)
    expect(searched).toEqual(scanned)
    expect(scanned.first[57]).toBe(-1)
    expect(reads() - before - scanReads).toBeLessThan(scanReads)
    // Recording a paragraph this long searches.
    const beforeRecording = reads()
    const recorded = recordedLines(text, nodeRects, 20, rectsAt, 'chrome')
    expect([recorded.map(line => line.first), recorded.map(line => line.last)]).toEqual([scanned.first, scanned.last])
    expect(reads() - beforeRecording).toBeLessThan(scanReads)
  })

  test('a search that meets a character on an earlier line gives up for a scan: bidi reordering would put a word on the wrong line unseen', () => {
    // Lines of 40, 100 and 60 letters, but the letter at 80, where the search first probes line 1, paints on line 0, as
    // bidi reordering can.
    const text = 'x'.repeat(200)
    const { nodeRects, rectsAt } = layOut(text, [0, 40, 140])
    const reordered: RectsAt = offset => (offset === 80 ? rectsAt(0) : rectsAt(offset))
    expect(searchLineEnds(text, groupLines(nodeRects, 20), rectsAt)).toEqual({ first: [0, 40, 140], last: [39, 139, 199] })
    expect(searchLineEnds(text, groupLines(nodeRects, 20), reordered)).toBeNull()
  })

  test('a line\'s width leaves out the spaces that end it: every bubble sized to its text would read as a space too narrow', () => {
    // "The quick " is 8 code points of 8 px and two spaces of 4 px; the box it needs is 68 px, not 72.
    const { recording } = layOut(TEXT, STARTS)
    if ('error' in recording) throw new Error('unreachable')
    expect(recording.lines.map(line => line.width)).toEqual([68, 68, 76, 88])
  })

  test('a prediction whose breaks move with what was prepared before is order-dependent, one whose widths alone move is not: the gate would block on Chrome\'s shape cache before #340 too', () => {
    const forward = predicted(TEXT, STARTS)
    const widths = predicted(TEXT, STARTS)
    if (!('lines' in widths)) throw new Error('unreachable')
    widths.lines[1]!.width = 3.25
    expect(predictionChange(forward, predicted(TEXT, STARTS))).toBe('same')
    expect(predictionChange(forward, widths)).toBe('widths')
    expect(predictionChange(forward, predicted(TEXT, [0, 10, 21, 31]))).toBe('lines')
    expect(predictionChange(forward, { unsupported: 'word-break break-all' })).toBe('lines')
    // A line that ends one character earlier while the next starts where it did: a space moved off the line's end.
    const shorter = predicted(TEXT, STARTS)
    if (!('lines' in shorter)) throw new Error('unreachable')
    shorter.lines[0]!.end = 9
    expect(predictionChange(forward, shorter)).toBe('lines')
  })

  test('the headline weighs each draw by its share: a rare group topped up to 300 draws would move it far more than it moves real apps', () => {
    const draws = [{ group: 'chat', weight: 0.9, pass: true }]
    for (let i = 0; i < 9; i++) draws.push({ group: 'soft hyphens', weight: 0.1 / 9, pass: false })
    const head = headline(draws)!
    expect([head.share, head.low, head.high].map(x => x.toFixed(9))).toEqual(['0.900000000', '0.900000000', '0.900000000'])
  })
})

describe('the stored recordings', () => {
  test('two recordings swapped fail both cases: the gate would be green or red on another case\'s layout', async () => {
    const three = layOut(TEXT, [0, 16, 31]).recording
    const two = layOut(TEXT, [0, 20]).recording
    const dir = `${import.meta.dir}/../.artifacts`
    mkdirSync(dir, { recursive: true })
    const path = `${dir}/harness-test-recordings.txt`
    writeRecordings(path, { env: 'test', recordings: new Map([['b', two], ['a', three]]) })
    const read = readRecordings(path)!
    expect(recordingText(read.recordings.get('a')!)).toBe(recordingText(three))
    writeRecordings(`${path}.2`, { env: 'test', recordings: new Map([['a', three], ['b', two]]) })
    expect(await Bun.file(`${path}.2`).text()).toBe(await Bun.file(path).text())
    expect(score(two, predicted(TEXT, [0, 16, 31])).status).toBe('count')
    expect(score(three, predicted(TEXT, [0, 20])).status).toBe('count')
    expect(parseRecording(recordingText(three))).toEqual(three)
  })

  test('page history and the accepted list are written sorted, whatever order they were found in: every recording would churn in git', async () => {
    const three = layOut(TEXT, [0, 16, 31]).recording
    const two = layOut(TEXT, [0, 20]).recording
    const dir = `${import.meta.dir}/../.artifacts/harness-test-sorted`
    mkdirSync(dir, { recursive: true })
    writeHistory(`${dir}/history-1.txt`, { env: 'test', cases: new Map([['b', [two, three]], ['a', [three, two]]]) })
    writeHistory(`${dir}/history-2.txt`, { env: 'test', cases: new Map([['a', [three, two]], ['b', [two, three]]]) })
    expect(await Bun.file(`${dir}/history-1.txt`).text()).toBe(await Bun.file(`${dir}/history-2.txt`).text())
    const entries: Array<[string, { reason: string; status: Failure }]> = [
      ['d', { reason: 'second reason', status: 'count' }], ['c', { reason: 'first reason', status: 'breaks' }],
      ['b', { reason: 'second reason', status: 'breaks' }], ['a', { reason: 'first reason', status: 'error' }],
    ]
    writeAccepted(`${dir}/accepted-1.txt`, new Map(entries))
    writeAccepted(`${dir}/accepted-2.txt`, new Map(entries.slice().reverse()))
    expect(await Bun.file(`${dir}/accepted-1.txt`).text()).toBe('## first reason\na error\nc breaks\n\n## second reason\nb breaks\nd count\n')
    expect(await Bun.file(`${dir}/accepted-2.txt`).text()).toBe(await Bun.file(`${dir}/accepted-1.txt`).text())
  })

  test('a bare text run with a style of its own is refused: the adapter would predict with a font the browser never used', () => {
    const font = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const }
    const c: Case = {
      id: 'bare', family: 'test', origin: 'harness.test.ts', pageLang: 'en',
      paragraph: {
        runs: [{ text: 'hello', node: 'text', font, letterSpacing: 0, wordSpacing: 0, lang: null }], font, letterSpacing: 0, wordSpacing: 0, width: 100,
        lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en',
      },
    }
    expect(caseProblem(c)).toBeNull()
    c.paragraph.runs[0]!.font = { ...font, size: 12 }
    expect(caseProblem(c)).toContain('bare text run')
  })

  test('a stale environment key refuses to score: a browser update would read as library regressions or fixes', () => {
    const recorded = 'chrome 153.0.8010.48 os=26A428 os-languages=en-US page-languages=en-US,en dpr=2 fonts=abc'
    expect(() => assertSameEnvironment('chrome', recorded, recorded.replace('.48', '.50'))).toThrow('Record again')
    expect(() => assertSameEnvironment('chrome', recorded, recorded.replace('dpr=2', 'dpr=1'))).toThrow('Record again')
    expect(() => assertSameEnvironment('chrome', recorded, recorded)).not.toThrow()
  })

  test('each part of the environment key changes it, and so do the served fonts but not the notes on where they came from: a browser, OS or display change would read as library regressions or fixes', () => {
    const base: Environment = {
      browser: 'webkit-host', version: '27.0', webkit: '22625.1.29.11.27', os: '26A428', osLanguages: 'zh-Hans-US,en-US', pageLanguages: ['zh-CN'],
      devicePixelRatio: 2, fonts: 'eb39315129b7',
    }
    expect(keyOf(base)).toBe('webkit-host 27.0 webkit=22625.1.29.11.27 os=26A428 os-languages=zh-Hans-US,en-US page-languages=zh-CN dpr=2 fonts=eb39315129b7')
    const changes: Array<Partial<Environment>> = [
      { browser: 'safari' }, { version: '27.1' }, { webkit: '22625.1.29.11.28' }, { webkit: null }, { os: '26A429' }, { osLanguages: 'en-US' },
      { pageLanguages: ['en-US', 'en'] }, { devicePixelRatio: 1 }, { fonts: '0123456789ab' },
    ]
    for (let i = 0; i < changes.length; i++) expect(keyOf({ ...base, ...changes[i] })).not.toBe(keyOf(base))
    const dir = join(import.meta.dir, '../.artifacts/harness-test-fonts')
    mkdirSync(dir, { recursive: true })
    const manifest = (family: string, source: string): string => JSON.stringify([{ family, weight: '400', file: 'test.woff2', source }])
    writeFileSync(join(dir, 'fonts.json'), manifest('Test Sans', 'made for the test'))
    writeFileSync(join(dir, 'test.woff2'), 'one')
    const served = fontsKey(dir)
    writeFileSync(join(dir, 'fonts.json'), manifest('Test Sans', 'another note'))
    expect(fontsKey(dir)).toBe(served)
    writeFileSync(join(dir, 'fonts.json'), manifest('Test Serif', 'made for the test'))
    expect(fontsKey(dir)).not.toBe(served)
    writeFileSync(join(dir, 'fonts.json'), manifest('Test Sans', 'made for the test'))
    writeFileSync(join(dir, 'test.woff2'), 'two')
    expect(fontsKey(dir)).not.toBe(served)
  })

  test('a case laid out differently in its two orders is never pinned: page history would block changes at random', () => {
    const same = layOut(TEXT, STARTS).recording
    const other = layOut(TEXT, [0, 10, 26]).recording
    const recordings = new Map<string, Recording>([['moved', same]])
    const history = new Map<string, [Recording, Recording]>()
    splitHistory(['kept', 'moved'], new Map([['kept', same], ['moved', same]]), new Map([['kept', same], ['moved', other]]), recordings, history)
    expect([...recordings.keys()]).toEqual(['kept'])
    expect([...history.keys()]).toEqual(['moved'])
  })

  test('a case laid out differently from the stored recording of its environment is page history too: the gate would block at random', () => {
    const same = layOut(TEXT, STARTS).recording
    const other = layOut(TEXT, [0, 10, 26]).recording
    const prior = { recordings: new Map([['kept', same], ['moved', other]]), history: new Map<string, [Recording, Recording]>([['listed', [same, other]]]) }
    const recordings = new Map<string, Recording>()
    const history = new Map<string, [Recording, Recording]>()
    const both = new Map([['kept', same], ['moved', same], ['listed', same]])
    expect(splitHistory(['kept', 'listed', 'moved'], both, both, recordings, history, prior)).toBe(1)
    expect([...recordings.keys()]).toEqual(['kept'])
    expect([...history.keys()].sort()).toEqual(['listed', 'moved'])
  })
})

describe('the accepted-failures and varying lists', () => {
  const fail = (status: Outcome['status']): Outcome => ({ status, line: 0, detail: '' })
  const none: Varying = new Map()

  test('a failure off the list blocks, an accepted one counts under its reason, and a fixed one blocks until it leaves: accepted losses would go silent', () => {
    const outcomes = new Map<string, Outcome>([['new', fail('count')], ['known', fail('breaks')], ['fixed', fail('pass')], ['moved', fail('count')]])
    const accepted = new Map<string, { reason: string; status: Failure }>([
      ['known', { reason: 'Firefox splits scripts later', status: 'breaks' }],
      ['fixed', { reason: 'Firefox splits scripts later', status: 'count' }],
      ['moved', { reason: 'narrower than real layouts', status: 'breaks' }],
      ['gone', { reason: 'narrower than real layouts', status: 'count' }],
    ])
    const cases = new Set(['new', 'known', 'fixed', 'moved', 'other'])
    const verdict = judge(outcomes, accepted, none, cases, false)
    expect(verdict.newFailures).toEqual(['new'])
    expect(verdict.fixed.sort()).toEqual(['fixed', 'gone'])
    expect(verdict.changed).toEqual(['moved: breaks -> count'])
    expect(verdict.byReason.get('Firefox splits scripts later')).toEqual(['known'])
    const next = accept(outcomes, accepted, 'a written reason', none, cases, false)
    expect([...next]).toEqual([
      ['new', { reason: 'a written reason', status: 'count' }],
      ['known', { reason: 'Firefox splits scripts later', status: 'breaks' }],
      ['moved', { reason: 'narrower than real layouts', status: 'count' }],
    ])
    expect(judge(outcomes, next, none, cases, false).newFailures).toEqual([])
    expect(judge(outcomes, next, none, cases, false).fixed).toEqual([])
    // A run over other case files leaves this list alone.
    const elsewhere = new Map<string, Outcome>([['other', fail('breaks')]])
    expect(judge(elsewhere, next, none, new Set(['other']), true).fixed).toEqual([])
    expect([...accept(elsewhere, next, 'why', none, new Set(['other']), true).keys()].sort()).toEqual(['known', 'moved', 'new', 'other'])
  })

  test('an entry of either list with no written reason above it is refused: accepted losses would go silent', () => {
    const dir = join(import.meta.dir, '../.artifacts/harness-test-lists')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'list.txt')
    for (const [text, read] of [['a count\n', readAccepted], ['a runs\n', readVarying], ['## \na count\n', readAccepted]] as const) {
      writeFileSync(path, text)
      expect(() => read(path)).toThrow('under a \'## <reason>\' heading')
    }
    writeFileSync(path, '## narrower than real layouts\na count\n')
    expect([...readAccepted(path)]).toEqual([['a', { reason: 'narrower than real layouts', status: 'count' }]])
    writeFileSync(path, '## system-ui\na runs\n')
    expect([...readVarying(path)]).toEqual([['a', { reason: 'system-ui', kind: 'runs' }]])
  })

  test('an entry of either list that names no case blocks: a list would keep reasons for cases that are gone', () => {
    const outcomes = new Map<string, Outcome>([['kept', fail('count')]])
    const accepted = new Map<string, { reason: string; status: Failure }>([['kept', { reason: 'r', status: 'count' }], ['renamed', { reason: 'r', status: 'count' }]])
    const varying: Varying = new Map([['label', { reason: 'r', kind: 'runs' }], ['amiri', { reason: 'r', kind: 'order' }]])
    const verdict = judge(outcomes, accepted, varying, new Set(['kept', 'label']), false)
    expect(verdict.fixed).toEqual(['renamed'])
    expect(verdict.stale).toEqual(['amiri'])
    expect(checkBlocks('chrome', new Map(), [], verdict, false, id => id).join('\n')).toContain('harness/varying/chrome.txt name no case; take them off: amiri')
    expect(checkBlocks('chrome', new Map(), [], verdict, true, id => id)).toHaveLength(1)
    // A run over some case files only doesn't know every case.
    expect(judge(outcomes, accepted, varying, new Set(['kept']), true).stale).toEqual([])
  })

  test('--accept takes the new failures and every failing case that only moves with what was predicted before, but never one that varies between runs: an accepted flip would block the next run', () => {
    const outcomes = new Map<string, Outcome>([['label', fail('breaks')], ['amiri', fail('count')], ['new', fail('count')]])
    const varying: Varying = new Map([['label', { reason: 'system-ui', kind: 'runs' }], ['amiri', { reason: 'shape caches', kind: 'order' }]])
    const cases = new Set(['label', 'amiri', 'new'])
    expect(judge(outcomes, new Map(), varying, cases, false).newFailures).toEqual(['amiri', 'new'])
    expect([...accept(outcomes, new Map(), 'why', varying, cases, false).keys()]).toEqual(['amiri', 'new'])
  })
})

describe('what blocks', () => {
  const clean = (): Verdict => ({ newFailures: [], fixed: [], changed: [], stale: [], byReason: new Map(), varying: { pass: 0, fail: 0 } })

  test('a line API that disagrees with the walk, or asks Canvas anything after preparing, blocks check whatever the browser did, on any case predicted: a virtualized list would size rows for lines it doesn\'t paint', () => {
    const right = predicted(TEXT, STARTS)
    const disagrees: Prediction = { ...predicted(TEXT, STARTS), disagreement: 'layout() gives 3 lines, height 60; walkLineRanges 4 lines' } as Prediction
    const measures: Prediction = { ...predicted(TEXT, STARTS), lineCalls: 4 } as Prediction
    expect(checkBlocks('chrome', new Map([['a', right]]), [], clean(), false, id => id)).toEqual([])
    expect(checkBlocks('chrome', new Map([['a', right], ['history', disagrees]]), [], clean(), false, id => id)[0]).toStartWith('BLOCKS: 1 cases where another line API disagrees')
    expect(checkBlocks('chrome', new Map([['a', measures]]), [], clean(), true, id => id)[0]).toStartWith('BLOCKS: 1 cases whose line APIs called measureText after preparing')
  })

  test('a case without a recording blocks check, but in installed Safari, which is recorded on a sample: a generator change that renames ids would unpin cases silently', () => {
    expect(checkBlocks('webkit-host', new Map(), ['new-id'], clean(), false, id => id)[0]).toStartWith('BLOCKS: 1 cases have no recording')
    expect(checkBlocks('safari', new Map(), ['new-id'], clean(), false, id => id)).toEqual([])
  })

  test('a new failure and a fixed accepted entry block check until --accept rewrites the list: a regression would pass, or a fix go unrecorded', () => {
    const verdict = { ...clean(), newFailures: ['new'], fixed: ['fixed'] }
    const blocks = checkBlocks('firefox', new Map(), [], verdict, false, id => `${id} described`)
    expect(blocks).toEqual([
      'BLOCKS: 1 accepted cases pass, are no longer pinned or name no case; take them off with --accept: fixed',
      'BLOCKS: 1 new failures (accept them with --accept="<reason>")',
      '  new described',
    ])
    expect(checkBlocks('firefox', new Map(), [], verdict, true, id => id)).toEqual([])
  })

  test('the gate blocks on breaks that move in reverse order, on line APIs that disagree or measure in reverse order, and on fresh recordings that differ every time: a message would wrap differently after other messages', () => {
    const right = new Map([['a', predicted(TEXT, STARTS)]])
    expect(gateBlocks({ moved: [] }, right, { stale: [] })).toEqual([])
    expect(gateBlocks({ moved: ['a'] }, right, { stale: [] })[0]).toStartWith('BLOCKS: 1 predictions break differently in reverse order')
    const disagrees = new Map([['a', { ...predicted(TEXT, STARTS), disagreement: 'measureLineStats gives 3 lines' } as Prediction]])
    expect(gateBlocks({ moved: [] }, disagrees, { stale: [] })[0]).toStartWith('BLOCKS: 1 cases in reverse order where another line API disagrees')
    expect(gateBlocks({ moved: [] }, right, { stale: ['a'] })[0]).toStartWith('BLOCKS: 1 laid out differently from the recordings every time')
  })

  test('the gate\'s sample is the same in every run with the default seed, and moves by one case when one leaves the pinned cases: the gate would be green or red by the clock', () => {
    const cases: Case[] = []
    for (let i = 0; i < 40; i++) cases.push({ ...paragraphCase(TEXT), id: `case-${i}` })
    const sample = gateSample(cases, SEED, 5).map(c => c.id)
    expect(sample).toEqual(['case-15', 'case-24', 'case-36', 'case-2', 'case-1'])
    const fewer = gateSample(cases.filter(c => c.id !== sample[1]), SEED, 5).map(c => c.id)
    expect(fewer.filter(id => !sample.includes(id))).toHaveLength(1)
    expect([parseArgs(['gate']).options.seed, parseArgs(['gate', '--seed=7']).options.seed]).toEqual([SEED, 7])
  })

  test('page history, Firefox\'s U+FE0E cases, cases with nothing visible and cases with no recording aren\'t pinned, but every case is predicted, the pinned first: line APIs that disagree on a case with no recording would go unseen', () => {
    const recording = layOut(TEXT, STARTS).recording
    const blank: Recording = { lines: [{ first: -1, last: -1, width: 0 }], height: 20 }
    const cases = ['history', 'text-emoji', 'blank', 'unrecorded', 'pinned'].map(id => ({ ...paragraphCase(id === 'text-emoji' ? 'a☺︎' : TEXT), id }))
    const recordings = new Map<string, Recording>([['history', recording], ['text-emoji', recording], ['blank', blank], ['pinned', recording]])
    const history = new Map([['history', [recording, recording]]])
    const firefox = pinning('firefox', cases, recordings, history)
    expect(firefox.pinned.map(c => c.id)).toEqual(['pinned'])
    expect(firefox.predicted.map(c => c.id)).toEqual(['pinned', 'history', 'text-emoji', 'blank', 'unrecorded'])
    expect([firefox.history, firefox.unobservable, firefox.unrecorded]).toEqual([2, 1, ['unrecorded']])
    expect(pinning('chrome', cases, recordings, history).pinned.map(c => c.id)).toEqual(['text-emoji', 'pinned'])
  })
})

describe('the gate and page history of predictions', () => {
  const two = layOut(TEXT, [0, 20]).recording
  const three = layOut(TEXT, [0, 16, 31]).recording

  test('a reverse-order effect of the browser\'s, listed with its reason, doesn\'t block, and an unlisted one does: Chrome\'s shape cache kept the gate red before #340 too', () => {
    const widths = predicted(TEXT, STARTS)
    if (!('lines' in widths)) throw new Error('unreachable')
    widths.lines[0]!.width = 1.5
    const ids = ['amiri', 'plain', 'widths']
    const forward = new Map([['amiri', predicted(TEXT, STARTS)], ['plain', predicted(TEXT, STARTS)], ['widths', predicted(TEXT, STARTS)]])
    const reverse = new Map([['amiri', predicted(TEXT, [0, 10, 21, 31])], ['plain', predicted(TEXT, STARTS)], ['widths', widths]])
    expect(reverseOrder(ids, forward, reverse, new Map())).toEqual({ moved: ['amiri'], listed: [], widths: ['widths'] })
    const varying: Varying = new Map([['amiri', { reason: 'Chrome\'s per-canvas shape cache moves these breaks with the text measured before', kind: 'order' }]])
    expect(reverseOrder(ids, forward, reverse, varying)).toEqual({ moved: [], listed: ['amiri'], widths: ['widths'] })
  })

  test('a fresh re-recording that differs once but not alone doesn\'t block, and one that differs every time does: Firefox\'s emoji beside Arial blocked the gate at random', () => {
    const stored = new Map([['emoji', two], ['stale', two], ['same', two]])
    const inSample = new Map([['emoji', three], ['stale', three], ['same', two]])
    const alone = new Map([['emoji', two], ['stale', three]])
    expect(freshRecordings(['emoji', 'stale', 'same'], stored, [inSample, alone, alone])).toEqual({ stale: ['stale'], history: ['emoji'] })
    expect(freshRecordings(['same'], stored, [inSample])).toEqual({ stale: [], history: [] })
  })

  test('a prediction that flips between runs, once listed, is never judged, and the gate calls it varying, not a library defect: check blocked at random on a system-ui label', () => {
    const passing = predicted(TEXT, STARTS)
    const flipped = predicted(TEXT, [0, 10, 21, 31])
    const stored = layOut(TEXT, STARTS).recording
    const runs = [score(stored, passing), score(stored, flipped)].map(outcome => new Map<string, Outcome>([['label', outcome]]))
    const none = new Map<string, { reason: string; status: Failure }>()
    const cases = new Set(['label'])
    expect(runs.map(outcomes => judge(outcomes, none, new Map(), cases, false).newFailures)).toEqual([[], ['label']])
    const varying: Varying = new Map([['label', { reason: 'system-ui: Chrome resolves it for Canvas otherwise after some earlier documents, and not in every run', kind: 'runs' }]])
    for (let i = 0; i < runs.length; i++) {
      const verdict = judge(runs[i]!, none, varying, cases, false)
      expect([verdict.newFailures, verdict.fixed]).toEqual([[], []])
      expect(verdict.varying).toEqual(i === 0 ? { pass: 1, fail: 0 } : { pass: 0, fail: 1 })
    }
    expect(() => judge(runs[0]!, new Map([['label', { reason: 'r', status: 'breaks' }]]), varying, cases, false)).toThrow('both')
    expect(attribute(stored, stored, flipped, [passing, flipped])).toBe('varies between runs')
    expect(attribute(stored, stored, flipped, [passing, passing])).toBe('depends on what was predicted before')
    expect(attribute(stored, three, flipped, [flipped, flipped])).toBe('page history')
    expect(attribute(stored, stored, flipped, [flipped, flipped])).toBe('true loss')
  })
})

// check, the gate and record as `bun harness` runs them, each in a harness folder of its own under .artifacts, with a
// stand-in browser: what they read, predict, print and write.
describe('the commands, with a stand-in browser', () => {
  const laidOut = layOut(TEXT, STARTS).recording
  const other = layOut(TEXT, [0, 10, 26]).recording
  const right = predicted(TEXT, STARTS)
  const wrong = predicted(TEXT, [0, 10, 21, 31])
  const options: Options = parseArgs([]).options
  const cases = (ids: string[]): Case[] => ids.map(id => ({ ...paragraphCase(TEXT), id }))

  // Chrome's recordings under the environment 'test', its page history and its lists.
  function folder(name: string, recordings: Record<string, Recording>, lists: { history?: string[]; accepted?: string; varying?: string } = {}): string {
    const root = join(import.meta.dir, '../.artifacts/harness-test-commands', name)
    for (const sub of ['recordings', 'accepted', 'varying']) mkdirSync(join(root, sub), { recursive: true })
    writeRecordings(recordingsPath(root, 'chrome'), { env: 'test', recordings: new Map(Object.entries(recordings)) })
    writeHistory(historyPath(root, 'chrome'), { env: 'test', cases: new Map((lists.history ?? []).map(id => [id, [laidOut, other]])) })
    writeFileSync(acceptedPath(root, 'chrome'), lists.accepted ?? '')
    writeFileSync(varyingPath(root, 'chrome'), lists.varying ?? '')
    return root
  }

  // The browser records `layout(c, job)` for each case of a job, and the page predicts `prediction(c, job)`.
  function browser(root: string, prediction: (c: Case, job: Job) => Prediction, layout = (_c: Case, _job: Job): Recording => laidOut, env = 'test'): Io & { printed: () => string } {
    const printed: string[] = []
    const run = <T extends Recording | Prediction>(job: Job): Promise<{ env: string; results: Map<string, T>; ms: number }> => {
      const results = new Map<string, T>()
      for (let i = 0; i < job.cases.length; i++) results.set(job.cases[i]!.id, (job.mode === 'record' ? layout(job.cases[i]!, job) : prediction(job.cases[i]!, job)) as T)
      return Promise.resolve({ env, results, ms: 0 })
    }
    return { root, run, log: text => printed.push(text), printed: () => printed.join('\n') }
  }

  test('check blocks on a failure off the accepted list, --accept takes it, and a prediction that varies between runs is never judged or accepted: a regression would pass, or an accepted flip block the next run', async () => {
    const root = folder('accept', { pass: laidOut, fail: laidOut, label: laidOut }, { varying: '## system-ui\nlabel runs\n' })
    // Preparing asks Canvas 10 and 20 times, over 43 units each.
    const io = browser(root, c => (c.id === 'pass' ? { ...right, prepareCalls: 10 } : { ...wrong, prepareCalls: c.id === 'fail' ? 20 : 0 }) as Prediction)
    const list = cases(['pass', 'fail', 'label']).map(c => (c.id === 'label' ? c : { ...c, sample: { group: 'chat', weight: c.id === 'fail' ? 0.25 : 0.75 } }))
    const first = await check('chrome', list, options, io)
    expect([first.blocked, first.newFailures.map(c => c.id)]).toEqual([true, ['fail']])
    expect(io.printed()).toContain('  Canvas: 232.6 measureText calls per 1,000 units while preparing')
    await check('chrome', list, { ...options, accept: 'a written reason' }, io)
    expect([...readAccepted(acceptedPath(root, 'chrome')).keys()]).toEqual(['fail'])
    // Accepted losses print under their reason, with the share of real paragraphs they cover.
    const again = browser(root, c => (c.id === 'pass' ? right : wrong))
    expect((await check('chrome', list, options, again)).blocked).toBe(false)
    expect(again.printed()).toContain('\n  accepted 1 (25.00% of real paragraphs): a written reason\n')
  })

  test('check predicts every case, and blocks on a line API that disagrees where nothing is pinned and on a case with no recording: a virtualized list would size rows for lines it doesn\'t paint', async () => {
    const root = folder('unpinned', { pinned: laidOut, blank: { lines: [{ first: -1, last: -1, width: 0 }], height: 20 } }, { history: ['history'] })
    const disagrees = { ...right, disagreement: 'layout() gives 3 lines, height 60; walkLineRanges 4 lines' } as Prediction
    const io = browser(root, c => (c.id === 'pinned' ? right : disagrees))
    expect((await check('chrome', cases(['pinned', 'history', 'blank', 'unrecorded']), options, io)).blocked).toBe(true)
    expect(io.printed()).toContain('BLOCKS: 3 cases where another line API disagrees with the walk')
    expect(io.printed()).toContain('BLOCKS: 1 cases have no recording; record them with record --only-new: unrecorded')
    // A browser update would read as library regressions or fixes.
    const refused = await check('chrome', cases(['pinned']), options, browser(root, () => right, undefined, 'another build')).then(() => '', (error: Error) => error.message)
    expect(refused).toContain('Record again')
  })

  test('the gate blocks when check does, and attributes the failure: a regression would pass the gate', async () => {
    const io = browser(folder('gate-check', { pass: laidOut, fail: laidOut }), c => (c.id === 'pass' ? right : wrong))
    expect(await gate('chrome', cases(['pass', 'fail']), options, io)).toBe(true)
    expect(io.printed()).toContain('true loss  fail')
  })

  test('the gate blocks on breaks and line APIs that move in reverse order and on recordings that no longer hold, and moves page history it finds off the pinned and accepted cases: a message would wrap differently after other messages, or the next check block', async () => {
    // After "first" in a job, "moves" breaks otherwise and "measures" disagrees. "found", an accepted failure, is laid out
    // otherwise among other cases and as recorded alone. "emoji" and "late" are laid out otherwise among other cases, and
    // alone only after "found", as Firefox's color emoji are after a U+FE0E case: the sample puts one before "found" and
    // one after it, so each is laid out as recorded in one of the lone orders. "stale" is laid out otherwise every time.
    const recorded = { first: laidOut, moves: laidOut, measures: laidOut, found: laidOut, emoji: laidOut, late: laidOut, stale: laidOut }
    const root = folder('gate-order', recorded, { accepted: '## why\nfound breaks\n' })
    const afterFirst = (c: Case, job: Job): boolean => job.cases.indexOf(c) > job.cases.findIndex(x => x.id === 'first')
    const io = browser(root, (c, job) => {
      if (c.id === 'found') return wrong
      if (afterFirst(c, job)) return right
      return c.id === 'moves' ? wrong : c.id === 'measures' ? { ...right, disagreement: 'measureLineStats gives 3 lines' } as Prediction : right
    }, (c, job) => {
      if (c.id === 'stale' || (job.documentSize > 1 && c.id !== 'first' && c.id !== 'moves' && c.id !== 'measures')) return other
      return (c.id === 'emoji' || c.id === 'late') && job.cases.indexOf(c) > job.cases.findIndex(x => x.id === 'found') ? other : laidOut
    })
    const list = cases(Object.keys(recorded))
    expect(gateSample(list, SEED, 9).map(c => c.id).filter(id => ['emoji', 'found', 'late'].includes(id))).toEqual(['emoji', 'found', 'late'])
    expect(await gate('chrome', list, options, io)).toBe(true)
    expect(io.printed()).toContain('BLOCKS: 1 predictions break differently in reverse order: moves')
    expect(io.printed()).toContain('BLOCKS: 1 cases in reverse order where another line API disagrees with the walk')
    expect(io.printed()).toContain('BLOCKS: 1 laid out differently from the recordings every time, alone too: stale')
    expect([...readHistory(historyPath(root, 'chrome'))!.cases.keys()]).toEqual(['emoji', 'found', 'late'])
    expect([...readRecordings(recordingsPath(root, 'chrome'))!.recordings.keys()]).toEqual(['first', 'measures', 'moves', 'stale'])
    expect(readAccepted(acceptedPath(root, 'chrome')).size).toBe(0)
    expect((await check('chrome', list, options, io)).blocked).toBe(false)
  })

  test('a new failure the fresh recording finds to be page history is attributed as page history and moved: the gate crashed attributing it after a pin bump', async () => {
    // "found" fails and isn't accepted; it is laid out otherwise among other cases and as recorded alone.
    const root = folder('gate-found', { pass: laidOut, found: laidOut })
    const io = browser(root, c => (c.id === 'found' ? wrong : right), (c, job) => (c.id === 'found' && job.documentSize > 1 ? other : laidOut))
    const list = cases(['pass', 'found'])
    expect(await gate('chrome', list, options, io)).toBe(true)
    expect(io.printed()).toContain('    page history  found')
    expect([...readHistory(historyPath(root, 'chrome'))!.cases.keys()]).toEqual(['found'])
    expect((await check('chrome', list, options, io)).blocked).toBe(false)
  })

  test('record makes page history of a case its two orders lay out differently, and of one laid out otherwise than its recording under the same environment: cases that lay out differently after other cases would block changes at random', async () => {
    const root = folder('record', { kept: laidOut, moved: laidOut })
    const jobs: Job[] = []
    const layout = (c: Case, job: Job): Recording => {
      if (!jobs.includes(job)) jobs.push(job)
      return c.id === 'moved' || (c.id === 'orders' && jobs.indexOf(job) === 1) ? other : laidOut
    }
    await record('chrome', cases(['orders', 'kept', 'moved']), options, browser(root, () => right, layout))
    // Sorted, then shuffled, so each case sits among other cases in the second.
    expect(jobs.map(job => job.cases.map(c => c.id).join(' '))).toEqual(['kept moved orders', 'kept orders moved'])
    expect([...readRecordings(recordingsPath(root, 'chrome'))!.recordings.keys()]).toEqual(['kept'])
    expect([...readHistory(historyPath(root, 'chrome'))!.cases.keys()]).toEqual(['moved', 'orders'])
  })

  test('record --only-new records only the cases with no recording, and refuses to add them to recordings of another environment: a browser update would read as library regressions or fixes', async () => {
    const root = folder('only-new', { kept: laidOut }, { history: ['moving'] })
    const recordedIds: string[] = []
    const layout = (c: Case): Recording => {
      recordedIds.push(c.id)
      return laidOut
    }
    await record('chrome', cases(['kept', 'moving', 'new']), { ...options, onlyNew: true }, browser(root, () => right, layout))
    expect(recordedIds).toEqual(['new', 'new'])
    expect([...readRecordings(recordingsPath(root, 'chrome'))!.recordings.keys()]).toEqual(['kept', 'new'])
    expect([...readHistory(historyPath(root, 'chrome'))!.cases.keys()]).toEqual(['moving'])
    const refused = await record('chrome', cases(['kept', 'new', 'newer']), { ...options, onlyNew: true }, browser(root, () => right, layout, 'another build'))
      .then(() => '', (error: Error) => error.message)
    expect(refused).toContain('the other recordings were made under test; record every case')
    expect([...readRecordings(recordingsPath(root, 'chrome'))!.recordings.keys()]).toEqual(['kept', 'new'])
  })

  test('repin records every case into a scratch copy, reports what changed, keeps the page history a new build\'s two orders miss, and writes only when asked: a browser update would read as library regressions, or the next check pin page history', async () => {
    // Under the new build "moves" lays out otherwise, "found" differs between its two orders, "history", page history
    // before, lays out one way in both, and "new" has no recording yet.
    const root = folder('repin', { same: laidOut, moves: laidOut, found: laidOut }, { history: ['history'], accepted: '## why\nfound breaks\n' })
    const scratch = join(root, 'scratch')
    const jobs: Job[] = []
    const layout = (c: Case, job: Job): Recording => {
      if (!jobs.includes(job)) jobs.push(job)
      return c.id === 'moves' || (c.id === 'found' && jobs.indexOf(job) % 2 === 1) ? other : laidOut
    }
    const list = cases(['same', 'moves', 'found', 'history', 'new'])
    const io = browser(root, () => right, layout, 'new build')
    await drift('chrome', list, options, false, io, scratch)
    expect(io.printed()).toContain('chrome drift against harness/recordings (recorded under test): 1 cases laid out otherwise, 1 new page history, 1 newly recorded, 0 no longer recorded')
    expect(io.printed()).toContain('  1 of the 1 page-history cases were laid out one way in both orders; kept as page history')
    expect([...readHistory(historyPath(scratch, 'chrome'))!.cases.keys()]).toEqual(['found', 'history'])
    expect(readRecordings(recordingsPath(root, 'chrome'))!.env).toBe('test')
    await drift('chrome', list, options, true, io, scratch)
    expect(readRecordings(recordingsPath(root, 'chrome'))!.env).toBe('new build')
    expect([...readRecordings(recordingsPath(root, 'chrome'))!.recordings.keys()]).toEqual(['moves', 'new', 'same'])
    expect([...readHistory(historyPath(root, 'chrome'))!.cases.keys()]).toEqual(['found', 'history'])
    expect(readAccepted(acceptedPath(root, 'chrome')).size).toBe(0)
    const again = browser(root, () => right, layout, 'new build')
    await drift('chrome', list, options, false, again, scratch)
    expect(again.printed()).toContain('chrome drift against harness/recordings (same environment): 0 cases laid out otherwise, 0 new page history, 0 newly recorded, 0 no longer recorded')
  })

  test('equal counts a moved line, other line text, another disagreement and another Canvas call after preparing as a difference, and lists a case that varies between runs apart: a change to src/ or the adapter would show nothing, or main against itself differ', async () => {
    const root = folder('equal', {}, { varying: '## system-ui\nlabel runs\n' })
    // This tree's build is "here"; the ref, a src/ directory, predicts `right` for every case.
    const here: Record<string, Prediction> = {
      line: wrong, text: { ...right, textHash: 1 } as Prediction, disagrees: { ...right, disagreement: 'measureLineStats gives 3 lines' } as Prediction,
      measures: { ...right, lineCalls: 2 } as Prediction, label: wrong,
    }
    const io = browser(root, (c, job) => (job.lib === 'here' ? here[c.id] ?? right : right))
    const list = cases(['same', ...Object.keys(here)])
    expect(await equal('chrome', list, new Map(list.map(c => [c.id, 'smoke'])), LIB, { ...options, lib: 'here' }, io)).toBe(true)
    expect(io.printed()).toContain(`chrome: 4 of 6 predictions differ from ${LIB}`)
    for (const line of ['line  test  lines', 'text  test  text', 'disagrees  test  disagreement', 'measures  test  Canvas calls after preparing']) expect(io.printed()).toContain(`\n  ${line}`)
    expect(io.printed()).toContain('  and 1 that vary between runs (harness/varying), not counted: label  test  lines')
    const same = browser(root, () => right)
    expect(await equal('chrome', list, new Map(list.map(c => [c.id, 'smoke'])), LIB, { ...options, lib: 'here' }, same)).toBe(false)
  })
})

describe('the browser\'s break data', () => {
  test('an ICU data file\'s entries and a Rust source\'s byte strings read back as the bytes they hold: a browser whose break data changed would read as the same, and the tables go stale', () => {
    // A 32-byte header, then the table of contents (a count and two name and data offsets from its start), the names and
    // the data.
    const bytes = new Uint8Array(96)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 32, true)
    bytes.set([0xda, 0x27], 2)
    bytes.set(new TextEncoder().encode('CmnD'), 12)
    view.setUint32(32, 2, true)
    const names = ['p/brkitr/b.brk', 'p/brkitr/a.brk']
    let name = 20
    for (let i = 0; i < 2; i++) {
      view.setUint32(36 + 8 * i, name, true)
      bytes.set(new TextEncoder().encode(names[i]!), 32 + name)
      name += names[i]!.length + 1
    }
    view.setUint32(40, 58, true)
    view.setUint32(48, 54, true)
    bytes.set([1, 2, 3, 4, 5, 6, 7], 86)
    const entries = icuEntries(bytes.subarray(0, 93))
    expect([...entries].map(([key, data]) => [key, [...data]])).toEqual([['brkitr/a.brk', [1, 2, 3, 4]], ['brkitr/b.brk', [5, 6, 7]]])
    expect(rustByteStrings('from_bytes_unchecked (b"\\0A\\x7F\\\\\\"") , x: b""').map(array => [...array])).toEqual([[0, 65, 127, 92, 34], []])
  })
})

describe('the documents a job lays out', () => {
  test('in Firefox, cases with a text-presentation emoji go in documents after every other: color emoji laid out after one are 1 px wider, and the gate\'s fresh recording blocked at random', () => {
    const make = (id: string, text: string, pageLang = 'en'): Case => ({ ...paragraphCase(text), id, pageLang })
    const cases = [make('a', 'a\u{1F600}b'), make('text', '\u2764\uFE0F\u{1F600}\uFE0E'), make('b', '\u{1F600} a b'), make('ko', '\uD55C', 'ko')]
    const ids = (docs: Case[][]): string[][] => docs.map(doc => doc.map(c => c.id))
    expect(ids(documents('firefox', cases, 2))).toEqual([['a', 'b'], ['ko'], ['text']])
    expect(ids(documents('chrome', cases, 2))).toEqual([['a', 'text'], ['b'], ['ko']])
  })

  test('a ref\'s adapter is unpacked beside its src/, a build\'s own adapter is bundled with its src/, and this tree\'s with a src/ that has none beside it: equal would run this tree\'s adapter against itself and show no change to it', async () => {
    expect(existsSync(join(srcOf('HEAD'), '../harness/page.ts'))).toBe(true)
    const dir = join(import.meta.dir, '../.artifacts/harness-test-builds')
    for (const build of ['own', 'bare']) cpSync(join(import.meta.dir, '../src'), join(dir, build, 'src'), { recursive: true, dereference: true })
    mkdirSync(join(dir, 'own/harness'), { recursive: true })
    writeFileSync(join(dir, 'own/src/build.ts'), 'export const build = \'the own build\'\n')
    writeFileSync(join(dir, 'own/harness/page.ts'), 'import { build } from \'../src/build.ts\'\nconsole.log(`${build}\'s adapter`)\n')
    expect(await bundle(join(dir, 'own/src'))).toContain('the own build')
    writeFileSync(join(dir, 'bare/src/layout.ts'), `${readFileSync(join(dir, 'bare/src/layout.ts'), 'utf8')}\nconsole.log('the bare build')\n`)
    const bare = await bundle(join(dir, 'bare/src'))
    expect([bare.includes('the bare build'), bare.includes('harness done')]).toEqual([true, true])
  })
})

// The library itself, through the same adapter the page uses. The tests run under a page language of their own, so the
// library measures with a fresh Canvas context and gives it up afterwards; the Canvas is a stand-in when no other test
// file installed one.
describe('the library through the adapter', () => {
  let library: typeof import('../src/layout.ts')
  let adapter: typeof import('./predict.ts')
  const saved = { document: Reflect.get(globalThis, 'document') as unknown, installed: false, named: false, restore: () => {} }
  beforeAll(async () => {
    if (typeof OffscreenCanvas === 'undefined') {
      class Context {
        font = ''
        measureText(text: string): { width: number } {
          return { width: text.length * 9 }
        }
      }
      Reflect.set(globalThis, 'OffscreenCanvas', class { getContext(): Context { return new Context() } })
      saved.installed = true
    }
    Reflect.set(globalThis, 'document', { documentElement: { lang: 'x-harness-test' } })
    // Count calls on whatever Canvas the library measures with. The adapter counts on the context prototype, as in a
    // browser, so a stand-in's class is given that name.
    const context = new OffscreenCanvas(1, 1).getContext('2d')!
    if (typeof OffscreenCanvasRenderingContext2D === 'undefined') {
      Reflect.set(globalThis, 'OffscreenCanvasRenderingContext2D', context.constructor)
      saved.named = true
    }
    // The adapters wrap measureText; the original goes back afterwards.
    const proto = Object.getPrototypeOf(context) as object
    const measureText = Object.getOwnPropertyDescriptor(proto, 'measureText')!
    saved.restore = () => Object.defineProperty(proto, 'measureText', measureText)
    library = await import('../src/layout.ts')
    adapter = await import('./predict.ts')
  })
  afterAll(() => {
    saved.restore()
    if (saved.document === undefined) Reflect.deleteProperty(globalThis, 'document')
    else Reflect.set(globalThis, 'document', saved.document)
    if (saved.installed) Reflect.deleteProperty(globalThis, 'OffscreenCanvas')
    if (saved.named) Reflect.deleteProperty(globalThis, 'OffscreenCanvasRenderingContext2D')
  })

  // A copy of src/ with one defect planted, and a copy of the adapter that predicts with it, as `--lib` would.
  async function planted(name: string, file: string, pattern: RegExp, replacement: string): Promise<typeof import('./predict.ts')> {
    const dir = join(import.meta.dir, '../.artifacts/harness-test-libs', name)
    // Real files even when src/ is a link, so the defect lands in the copy only.
    cpSync(join(import.meta.dir, '../src'), join(dir, 'src'), { recursive: true, dereference: true })
    mkdirSync(join(dir, 'harness'), { recursive: true })
    cpSync(join(import.meta.dir, 'predict.ts'), join(dir, 'harness/predict.ts'))
    cpSync(join(import.meta.dir, 'types.ts'), join(dir, 'harness/types.ts'))
    const path = join(dir, 'src', file)
    const source = readFileSync(path, 'utf8')
    const found = source.match(new RegExp(pattern.source, 'g'))?.length ?? 0
    if (found !== 1) throw new Error(`${name}: ${pattern} matches src/${file} ${found} times; plant the same defect in the code as it is now`)
    writeFileSync(path, source.replace(pattern, replacement))
    return await import(join(dir, 'harness/predict.ts')) as typeof import('./predict.ts')
  }

  function paragraph(text: string, width: number): Case {
    const font = { family: 'Harness Test', size: 16, weight: 400, style: 'normal' as const }
    return {
      id: 't', family: 'test', origin: 'harness.test.ts', pageLang: 'en',
      paragraph: {
        runs: [{ text, node: 'text', font, letterSpacing: 0, wordSpacing: 0, lang: null }], font, letterSpacing: 0, wordSpacing: 0, width,
        lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en',
      },
    }
  }

  test('a width 1/64 px short at a fit threshold fails: text that exactly fits a bubble would wrap', () => {
    const text = 'aaaa bbbb'
    const fit = library.measureNaturalWidth(library.prepareWithSegments(text, '16px Harness Test'))
    const oneLine = layOut(text, [0]).recording
    expect(score(oneLine, adapter.predict(paragraph(text, fit))).status).toBe('pass')
    expect(score(oneLine, adapter.predict(paragraph(text, fit - 1 / 64))).status).toBe('count')
  })

  test('layout() counting other lines than the walk blocks: a virtualized list would size a row for lines it doesn\'t paint (the review\'s D1: an overflowing space starts the next line in layout()\'s counter)', async () => {
    const text = 'aaaa bbbb cccc'
    // "aaaa" fits exactly, so each space overflows and must hang.
    const c = paragraph(text, library.measureNaturalWidth(library.prepareWithSegments('aaaa', '16px Harness Test')))
    const right = adapter.predict(c)
    if (!('lines' in right)) throw new Error('unreachable')
    expect(right.disagreement).toBeNull()
    expect(right.lines.length).toBe(3)
    // Drop the counter's `continue` after an overflow ends a line, so the overflowing space opens the next one.
    const d1 = await planted('d1-counter', 'line-break.ts', /(export function countPreparedLines\([\s\S]*?hasContent = false\n(?:\s*\/\/[^\n]*\n)*)\s*if \([^\n]*\) continue\n/, '$1')
    const wrong = d1.predict(c)
    if (!('lines' in wrong)) throw new Error('unreachable')
    expect(wrong.lines).toEqual(right.lines)
    expect(wrong.disagreement).toStartWith('layout() gives')
    expect(libraryFaults(new Map([['t', wrong]])).disagree).toHaveLength(1)
    expect(libraryFaults(new Map([['t', right]]))).toEqual({ disagree: [], measuring: [] })
  })

  test('a text line API giving other text than the walk\'s lines blocks: a list painting layoutNextLine\'s text would drop a character its heights count', async () => {
    const c = paragraph('A message long enough to wrap at a few widths', 120)
    const dropped = await planted('next-line-text', 'layout.ts', /return \{ text, width, start: lineStart, end \}/, 'return { text: text.slice(1), width, start: lineStart, end }')
    const wrong = dropped.predict(c)
    if (!('lines' in wrong)) throw new Error('unreachable')
    expect(wrong.disagreement).toStartWith('layoutNextLine line 0')
  })

  test('line text the builder every text API shares gets wrong changes the prediction\'s text hash, which equal compares: a build that paints no hyphen where a line breaks at a soft hyphen would equal main', async () => {
    const c = paragraph('Supercali\u00ADfragilistic', 100)
    const right = adapter.predict(c)
    const hyphenless = await planted('line-text-hyphen', 'line-text.ts', /\? text \+ '-' : text/, '? text : text')
    const wrong = hyphenless.predict(c)
    expect([disagreement(right), disagreement(wrong)]).toEqual([null, null])
    expect([predictionChange(wrong, right), buildChange(wrong, right)]).toEqual(['same', 'text'])
  })

  test('a Canvas call per line in the walker blocks: every window resize would measure text again', async () => {
    const c = paragraph('A message long enough to wrap at a few widths, with CJK \u6587\u5B57 and numbers 3.14', 120)
    const right = adapter.predict(c)
    if (!('lines' in right)) throw new Error('unreachable')
    expect(right.lineCalls).toBe(0)
    expect(right.prepareCalls).toBeGreaterThan(0)
    const walker = await planted('walker-canvas', 'layout.ts', /onLine\(createLayoutLineRange\(/, 'new OffscreenCanvas(1, 1).getContext(\'2d\')!.measureText(\' \')\n      onLine(createLayoutLineRange(')
    const measuring = walker.predict(c)
    if (!('lines' in measuring)) throw new Error('unreachable')
    expect(measuring.lines).toEqual(right.lines)
    expect(measuring.lineCalls).toBe(right.lines.length)
    expect(libraryFaults(new Map([['t', measuring]])).measuring).toEqual([`t: ${right.lines.length}`])
  })

  function disagreement(prediction: Prediction): string | null {
    if (!('lines' in prediction)) throw new Error('unreachable')
    return prediction.disagreement
  }

  // The same paragraph as spans, one per text, through rich-inline.
  function spans(texts: string[], width: number): Case {
    const c = paragraph(texts.join(''), width)
    const runs: TextRun[] = []
    for (let i = 0; i < texts.length; i++) runs.push({ ...c.paragraph.runs[0]!, text: texts[i]!, node: 'span' })
    c.paragraph.runs = runs
    return c
  }

  test('measureLineStats giving another widest line than the walk blocks: a bubble shrink-wrapped to it would be too wide', async () => {
    const c = paragraph('A message long enough to wrap at a few widths', 120)
    expect(disagreement(adapter.predict(c))).toBeNull()
    const stats = await planted('line-stats', 'layout.ts', /(walkPreparedLinesRaw\(getInternalPrepared\(prepared\), maxWidth, undefined, stats\)\n)  return stats/, '$1  return { lineCount: stats.lineCount, maxLineWidth: stats.maxLineWidth + 1 }')
    expect(disagreement(stats.predict(c))).toStartWith('measureLineStats gives')
  })

  test('layoutWithLines giving a height for other lines than it lists blocks: a list sizing rows by it would leave a gap under each', async () => {
    const c = paragraph('A message long enough to wrap at a few widths', 120)
    const batch = await planted('batch-height', 'layout.ts', /return \{ lineCount, height: lineCount \* lineHeight, lines \}/, 'return { lineCount, height: (lineCount + 1) * lineHeight, lines }')
    expect(disagreement(batch.predict(c))).toStartWith('layoutWithLines gives')
  })

  test('measureRichInlineStats giving another widest line than the rich walk blocks: a rich bubble shrink-wrapped to it would be too narrow', async () => {
    const c = spans(['A message ', 'long enough ', 'to wrap at a few widths'], 120)
    expect(disagreement(adapter.predict(c))).toBeNull()
    const stats = await planted('rich-stats', 'rich-inline.ts', /if \(lineWidth > maxLineWidth\) maxLineWidth = lineWidth/, '')
    expect(disagreement(stats.predict(c))).toStartWith('measureRichInlineStats gives')
  })

  test('materializeRichInlineLineRange giving a line another width than its range blocks: a rich list would paint a line other than it sized', async () => {
    const c = spans(['A message ', 'long enough ', 'to wrap at a few widths'], 120)
    const moved = await planted('rich-materialize', 'rich-inline.ts', /fragments,\n(\s*)width: line\.width,/, 'fragments,\n$1width: line.width + 1,')
    expect(disagreement(moved.predict(c))).toStartWith('materializeRichInlineLineRange of line 0 changes')
  })

  test('a rich fragment whose text isn\'t its item\'s text over the fragment\'s cursors blocks: a word broken across lines in a span would paint its start again', async () => {
    const c = spans(['A ', 'Supercalifragilistic', ' word'], 60)
    expect(disagreement(adapter.predict(c))).toBeNull()
    const text = await planted('rich-fragment-text', 'rich-inline.ts', /fragment\.start\.segmentIndex,\n(\s*)fragment\.start\.graphemeIndex,/, 'fragment.start.segmentIndex,\n$10,')
    expect(disagreement(text.predict(c))).toMatch(/^materializeRichInlineLineRange line \d+ fragment \d+ is /)
  })

  test('layoutNextLineRange giving another width than the walk blocks: a bubble sized from streamed lines would be too wide', async () => {
    const c = paragraph('A message long enough to wrap at a few widths', 120)
    const range = await planted('next-line-range', 'layout.ts', /return width === null \? null : \{ width, start: lineStart, end \}/, 'return width === null ? null : { width: width + 1, start: lineStart, end }')
    expect(disagreement(range.predict(c))).toStartWith('layoutNextLineRange line 0 is')
  })

  test('materializeLineRange giving a walked range another start blocks: a long word broken across lines would paint its start again', async () => {
    const c = paragraph('A Supercalifragilistic word', 60)
    expect(disagreement(adapter.predict(c))).toBeNull()
    const start = await planted('materialize-start', 'layout.ts', /(getLineTextCache\(prepared\),\n\s*line\.width,\n\s*line\.start\.segmentIndex,\n\s*)line\.start\.graphemeIndex,/, '$10,')
    expect(disagreement(start.predict(c))).toMatch(/^materializeLineRange of line \d+ gives/)
  })

  test('walkRichInlineLineRanges giving line ends that stepping doesn\'t blocks: a rich list resuming from a walked line\'s end would skip to the paragraph\'s end', async () => {
    const c = spans(['A message ', 'long enough ', 'to wrap at a few widths'], 120)
    const walk = await planted('rich-walk-end', 'rich-inline.ts', /onLine\(line\)/, 'onLine({ ...line, end: cursor })')
    expect(disagreement(walk.predict(c))).toStartWith('layoutNextRichInlineLineRange line 0 differs')
  })

  test('prepare()\'s handle breaking otherwise than prepareWithSegments\' blocks: layout() would size a row for lines the list doesn\'t paint', async () => {
    const c = paragraph('one\ntwo\nthree', 400)
    c.paragraph.whiteSpace = 'pre-wrap'
    expect(disagreement(adapter.predict(c))).toBeNull()
    const fast = await planted('prepare-options', 'layout.ts', /return prepareInternal\(text, font, false, options\)/, 'return prepareInternal(text, font, false)')
    expect(disagreement(fast.predict(c))).toStartWith('layout() gives 1 lines')
  })
})
