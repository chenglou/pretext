// What browser-sets.ts refuses before it spends browser time. These launch no browser.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LAB_APPS } from '../lab/browser-build.ts'
import { writeLedger, type LedgerHeader } from './ledger.ts'

const run = (args: string[]): { exitCode: number; stderr: string } => {
  const result = Bun.spawnSync(['bun', join(import.meta.dir, 'browser-sets.ts'), ...args])
  return { exitCode: result.exitCode, stderr: result.stderr.toString() }
}

describe('browser-sets refuses before running', () => {
  // The pinned copy is this lab's (lab README, "Pinned browsers"); elsewhere there is nothing to read a build from.
  test.skipIf(!existsSync(LAB_APPS.chrome))('a reference ledger of another browser build: nothing runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-sets-'))
    const header: LedgerHeader = {
      format: 'pretext-ledger/1', browser: 'chrome', config: 'no-facts', predictor: 'p.ts', build: { app: 'Google Chrome', appVersion: '1.0.0.0', engine: '1.0.0.0', os: '00A000' },
      environments: [], scorer: 6, bundles: [], library: null, orders: 'both', historyCarriedFrom: null, sets: {}, counts: { lineCount: {}, breaks: {}, widths: {}, painter: {} },
    }
    writeLedger(join(dir, 'reference'), { header, entries: [] })
    const result = run(['--browser=chrome', '--sets=smoke-hand', `--out=${join(dir, 'out')}`, `--reference=${join(dir, 'reference')}`])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('A browser or OS build moved')
    expect(result.stderr).toContain('Nothing ran')
    expect(existsSync(join(dir, 'out'))).toBe(false)
  })

  test('unknown browsers, sets and arguments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-sets-'))
    expect(run(['--browser=safari', `--out=${dir}`])).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('--browser must be chrome, firefox or webkit-host') })
    // The cases per round trip are part of the protocol (sets.ts), not an option.
    expect(run(['--browser=chrome', `--out=${dir}`, '--chunk=1'])).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('Unknown argument --chunk=1') })
    expect(run(['--browser=chrome', `--out=${dir}`, '--sets=nothing'])).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('Unknown set nothing') })
  })
})
