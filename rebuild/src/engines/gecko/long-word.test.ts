import { expect, test } from 'bun:test'
import { BREAK_NONE, BREAK_NORMAL, LineBreakerState, type BreakSink } from './linebreak.js'

test('long spaceless words cross mapped flows without exceeding the string-conversion argument limit', () => {
  const length = 1_048_576, half = length / 2
  for (const [unit, mode] of [[0x61, 'break-all'], [0x6f22, 'normal']] as const) {
    const breaker = new LineBreakerState({ kind: 'unavailable' })
    breaker.setWordBreak(mode)
    const breakFlags = new Uint8Array(length), clusterStart = new Uint8Array(length).fill(1), isSpace = new Uint8Array(length)
    const run = { noBreaks: true }, flow = new Uint16Array(half).fill(unit)
    for (let start = 0; start < length; start += half) {
      const sink: BreakSink = { breakFlags, clusterStart, isSpace, textRunStart: 0, flowStart: start, run }
      breaker.appendText('en', flow, unit > 0xff, 0, sink)
    }
    expect(breaker.reset()).toBe(false)
    expect(breakFlags[0]).toBe(mode === 'break-all' ? BREAK_NORMAL : BREAK_NONE)
    expect(breakFlags.subarray(1).every(flag => flag === BREAK_NORMAL)).toBe(true)
    expect(run.noBreaks).toBe(false)
    expect(breaker.word).toEqual([])
    expect(breaker.items).toEqual([])
  }
})
