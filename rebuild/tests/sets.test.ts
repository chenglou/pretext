// The tiers' sets and their protocol (sets.ts).
import { describe, expect, test } from 'bun:test'
import { CASES_PER_ROUND_TRIP, SETS, selectSets, setProtocol, sha256File, partFiles } from './sets.ts'

describe('the tiers\' sets', () => {
  test('names are unique, and every browser has each group', () => {
    expect(new Set(SETS.map(set => set.name)).size).toBe(SETS.length)
    for (const browser of ['chrome', 'firefox', 'webkit-host'] as const) {
      expect([...new Set(selectSets(browser, undefined, undefined).map(set => set.group))].sort()).toEqual(['development', 'families', 'heldout', 'smoke'])
    }
    // The process-languages family under en-US runs in Chrome alone, with the launch arguments that set its locale.
    expect(selectSets('firefox', undefined, undefined).some(set => set.name === 'features-en-US')).toBe(false)
    expect(selectSets('chrome', 'features-en-US', undefined)[0]!.runArgs).toEqual(['--chrome-apple-languages=en-US', '--chrome-accept-languages=en-US,en'])
  })

  test('--sets and --groups select a set named by either, in the list\'s order, and refuse unknown names', () => {
    expect(selectSets('chrome', 'ws,smoke-hand', undefined).map(set => set.name)).toEqual(['smoke-hand', 'ws'])
    expect(selectSets('chrome', 'ws', 'smoke').map(set => set.name)).toEqual(['smoke-hand', 'smoke', 'ws'])
    expect(() => selectSets('chrome', 'nothing', undefined)).toThrow('Unknown set nothing')
    expect(() => selectSets('chrome', undefined, 'nothing')).toThrow('Unknown group nothing')
  })

  test('a protocol names the parts by their case files\' hashes, the cases per round trip and the run arguments', () => {
    const set = SETS.find(value => value.name === 'smoke-hand')!
    const protocol = setProtocol(set, 'chrome')
    expect(protocol).toEqual({ set: 'smoke-hand', parts: [{ casesFile: 'rebuild/lab/smoke-cases.ndjson', casesSha256: sha256File(partFiles(set, 'chrome')[0]!) }], casesPerRoundTrip: CASES_PER_ROUND_TRIP, freshProcessPerPart: true, runArgs: [] })
    // A browser's own derived family files are part of its protocol.
    expect(SETS.find(value => value.name === 'families')!.parts[0]).toContain('{browser}')
  })
})
