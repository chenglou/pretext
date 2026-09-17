import { describe, expect, test } from 'bun:test'
import { abcd, abcdExpected, abcdLayout, abcdNative, abcdOneLine, abcdOneLineExpected, at, blink, expect32, linesRow, native, observation, row } from './row-fixtures.ts'
import { applyDecision, mainCasesOf, requiredOf, triageCase, type TriageRecord } from './triage.ts'

// The rebuild predicts one line where the browser makes two.
const failing = { ...row('chrome', abcd, abcdNative, abcdOneLine, abcdOneLineExpected), case: { ...row('chrome', abcd, abcdNative, abcdOneLine, abcdOneLineExpected).case, origin: 'suite letter-spacing wrap-b61078af6d9d9b8d required=height,lineCount; suite joined wrap-0a1 items' } }
const passing = row('chrome', abcd, abcdNative, abcdLayout, abcdExpected)

function record(value: ReturnType<typeof triageCase>): TriageRecord {
  if (value === null || 'error' in value) throw new Error(`no record: ${JSON.stringify(value)}`)
  return value
}

describe('triage records from observations', () => {
  test('main passes everything observable where the rebuild fails: a fact to learn, class C', () => {
    const value = record(triageCase(failing, failing, linesRow(failing, [[0, 3], [3, 5]]), null))
    expect(value).toMatchObject({
      mainCase: 'wrap-b61078af6d9d9b8d', mainCases: ['wrap-b61078af6d9d9b8d', 'wrap-0a1'], labCase: 'c-test', class: 'C', isolation: 'same',
      outcome: 'fact-to-learn', fact: null, probe: null, family: null, decidedBy: 'rule', provisional: false,
      rebuild: { lineCount: 'fail', breaks: 'fail' }, main: { lineCount: 'pass', visibleBreaks: 'pass', predictionMovesInReverse: null },
      required: ['height', 'lineCount'],
    })
  })

  test('the right count with visible characters on the wrong lines is accidental, class A', () => {
    expect(record(triageCase(failing, null, linesRow(failing, [[0, 4], [4, 5]]), null))).toMatchObject({ class: 'A', isolation: 'unchecked', outcome: 'accidental', reason: 'right count, wrong breaks' })
  })

  test('cases outside the population make no record', () => {
    expect(triageCase(passing, null, linesRow(passing, [[0, 3], [3, 5]]), null)).toBeNull()
    expect(triageCase(failing, null, linesRow(failing, [[0, 5]]), null)).toBeNull()
  })

  test('a predict-only main row takes the rebuild row\'s native observation', () => {
    expect(record(triageCase(failing, null, linesRow(failing, [[0, 3], [3, 5]], { skipped: 'predict-only' }), null)).class).toBe('C')
  })

  test('native lines that move in the other order leave the case undecided', () => {
    const moved = { ...failing, native: native(abcd, [[at(0, 8)], [at(8, 7.625)], [at(15.625, 0)], [at(22, 7)], [at(29, 7.0625)]], [[at(0, 36.0625)]]) }
    expect(record(triageCase(failing, moved, linesRow(failing, [[0, 3], [3, 5]]), null))).toMatchObject({ isolation: 'moved', outcome: 'undecided' })
  })

  test('main\'s prediction changing and failing in reverse order is main\'s own history', () => {
    expect(record(triageCase(failing, failing, linesRow(failing, [[0, 3], [3, 5]]), linesRow(failing, [[0, 5]])))).toMatchObject({ outcome: 'accidental', main: { predictionMovesInReverse: true } })
  })

  test('zero-width characters on other lines make a provisional accidental pass', () => {
    const p = { ...abcd, runs: [{ ...abcd.runs[0]!, text: 'a​b' }] }
    const observed = native(p, [[at(0, 8)], [at(0, 0, 1)], [at(0, 8, 1)]], [[at(0, 8), at(0, 8, 1)]])
    // The rebuild puts all three code points on one line.
    const oneLine = observation(p, [[expect32(0, 0, 8)], [expect32(0, 8, 0)], [expect32(0, 8, 8)]], [[expect32(0, 0, 16)]])
    const rebuild = { ...row('chrome', p, observed, blink([[0, 3, 2048]]), oneLine), case: { ...failing.case, paragraph: p } }
    const value = record(triageCase(rebuild, null, linesRow(rebuild, [[0, 2], [2, 3]]), null))
    expect(value).toMatchObject({ class: 'C', outcome: 'accidental', provisional: true, main: { zeroWidthPlacement: 'fail' } })
  })

  test('a hand decision overrides the rule', () => {
    const value = applyDecision(record(triageCase(failing, failing, linesRow(failing, [[0, 3], [3, 5]]), null)), { labCase: 'c-test', browser: 'chrome', outcome: 'opinion-dropped', reason: 'requiredness held main\'s heuristic' })
    expect(value).toMatchObject({ outcome: 'opinion-dropped', decidedBy: 'hand', reason: 'requiredness held main\'s heuristic', provisional: false })
  })

  test('origins name main\'s cases and required metrics', () => {
    expect(mainCasesOf('suite a wrap-1 required=lineCount; suite b wrap-2 items; suite a wrap-1')).toEqual(['wrap-1', 'wrap-2'])
    expect(requiredOf('suite a wrap-1 required=lineCount,height; suite b wrap-2 required=breaks')).toEqual(['breaks', 'height', 'lineCount'])
    expect(requiredOf('generator=runs/split seed=x shape=1')).toEqual([])
  })
})
