// Which layers block, and where a seed is written (rebuild/tests/gate.ts).
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GateReport } from '../lab/gate.ts'
import type { FactsDiff } from './facts.ts'
import { blockingLosses } from './gate.ts'

function families(ok: boolean, lostPairs = 0): GateReport {
  return {
    ok, engine: 'blink', engineVersion: '153.0.8010.48', runs: [],
    counts: { baselineCases: 1, observedCases: 1, lostPairs, newPairs: 0, historyDependentCases: 0, unstablePairs: 0, missingCases: 0, missingPairs: 0, protocolCases: 0 },
    lost: [], newPasses: [], historyDependent: [], protocol: [], unstable: [], missing: { cases: 0, pairs: 0, ids: [] },
  }
}

const NO_CHANGE: FactsDiff = { compared: 3, unchanged: 3, decisiveChanged: [], flips: [], missing: [], added: [] }

describe('tests gate layers', () => {
  test('nothing lost, nothing blocks', () => {
    expect(blockingLosses(families(true), NO_CHANGE, { lost: [] })).toEqual([])
  })

  test('lost family pairs, fact flips, missing facts and lost coverage each block', () => {
    expect(blockingLosses(families(false, 2), null, null).length).toBe(1)
    expect(blockingLosses(families(true), { ...NO_CHANGE, flips: [{ fact: 'f', scope: '', before: 'holds', after: 'fails', decisiveBefore: 1, decisiveAfter: 2 }] }, null).length).toBe(1)
    expect(blockingLosses(families(true), { ...NO_CHANGE, missing: ['f []'] }, null).length).toBe(1)
    expect(blockingLosses(families(true), null, { lost: ['blink/lines/fit-bound-plus-one-lu'] }).length).toBe(1)
  })

  test('changed decisive values and new facts are reported, not blocking', () => {
    const diff: FactsDiff = { ...NO_CHANGE, decisiveChanged: [{ fact: 'f', scope: '', verdict: 'holds', before: 1, after: 2 }], added: ['g []'] }
    expect(blockingLosses(families(true), diff, null)).toEqual([])
  })
})

// A derivation folder with one family case that passes in both orders, as observe-families.sh leaves it.
function derivedDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tests-gate-'))
  const environment = 'chrome: Google Chrome 153.0.8010.50, engine build 153.0.8010.50, macOS 26A428; DPR 2, scale 1; uiLanguage zh-CN; scorer 6'
  const build = { app: 'Google Chrome', appVersion: '153.0.8010.50', engine: '153.0.8010.50', os: '26A428' }
  mkdirSync(join(dir, 'final/file'), { recursive: true })
  mkdirSync(join(dir, 'final/reverse'), { recursive: true })
  writeFileSync(join(dir, 'final/summary.json'), JSON.stringify({ browser: 'chrome', build, totals: { cases: 1 }, families: {} }))
  writeFileSync(join(dir, 'final/family-cases.ndjson'), '{"id":"c-1"}\n')
  const pass = { status: 'pass' }
  for (const order of ['file', 'reverse']) {
    writeFileSync(join(dir, 'final', order, 'chrome-per-case.ndjson'), `${JSON.stringify({ id: 'c-1', family: 'rule/test', browser: 'chrome', lineCount: pass, breaks: pass, widths: pass, painter: pass })}\n`)
    writeFileSync(join(dir, 'final', order, 'chrome-summary.json'), JSON.stringify({ casesFile: join(dir, 'final/family-cases.ndjson'), nativeCompareFile: '/other-rows.ndjson', browsers: { chrome: { rows: 1, environments: { [environment]: 1 }, historyDependent: { compared: 1 } } } }))
  }
  return dir
}

describe('a tests gate seed goes to a staging folder', () => {
  const seed = (dir: string, extra: string[]): { exitCode: number; stderr: string } => {
    const result = Bun.spawnSync(['bun', join(import.meta.dir, 'gate.ts'), 'seed', `--derived=${dir}`, `--baseline=${join(dir, 'baselines/chrome.json')}`, ...extra])
    return { exitCode: result.exitCode, stderr: result.stderr.toString() }
  }

  test('without --staging, or staged into the baseline\'s own folder, nothing is written', () => {
    const dir = derivedDir()
    expect(seed(dir, [])).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('--staging=<dir> is required') })
    expect(seed(dir, [`--staging=${join(dir, 'baselines')}`])).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('is the folder the baseline is in') })
    expect(existsSync(join(dir, 'baselines'))).toBe(false)
  })

  test('the seed and its record are staged, and the adopted baseline stays byte for byte', () => {
    const dir = derivedDir()
    expect(seed(dir, [`--staging=${join(dir, 'staged')}`]).exitCode).toBe(0)
    expect(existsSync(join(dir, 'baselines/chrome.json'))).toBe(false)
    const staged = JSON.parse(readFileSync(join(dir, 'staged/chrome.json'), 'utf8')) as { families: { baseline: { passes: Record<string, string[]> } } }
    expect(staged.families.baseline.passes).toEqual({ lbwp: ['c-1'] })
    // Adopt it by hand, then seed again from runs that lost a pair: the record names the pair, the adopted file doesn't move.
    mkdirSync(join(dir, 'baselines'))
    writeFileSync(join(dir, 'baselines/chrome.json'), readFileSync(join(dir, 'staged/chrome.json')))
    const adopted = readFileSync(join(dir, 'baselines/chrome.json'), 'utf8')
    const fail = { status: 'fail', reason: 'width differs' }
    writeFileSync(join(dir, 'final/file/chrome-per-case.ndjson'), `${JSON.stringify({ id: 'c-1', family: 'rule/test', browser: 'chrome', lineCount: { status: 'pass' }, breaks: { status: 'pass' }, widths: fail, painter: { status: 'pass' } })}\n`)
    expect(seed(dir, [`--staging=${join(dir, 'staged-2')}`]).exitCode).toBe(0)
    expect(readFileSync(join(dir, 'baselines/chrome.json'), 'utf8')).toBe(adopted)
    const record = JSON.parse(readFileSync(join(dir, 'staged-2/chrome.seed-record.json'), 'utf8')) as { lost: Array<{ id: string; metric: string; covered: boolean }>; casesChanged: boolean }
    expect(record.lost).toMatchObject([{ id: 'c-1', metric: 'widths', covered: false }])
    expect(record.casesChanged).toBe(false)
  })
})
