import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Exercise the driver with controlled browser exits. No browser or lock helper is started.
function run(failed: string, reportFails = false): { code: number | null; output: string; attempted: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'pretext-chat-driver-'))
  try {
    const bench = join(dir, 'rebuild/bench')
    const bin = join(dir, 'bin')
    const out = join(dir, 'out')
    const trace = join(dir, 'trace')
    mkdirSync(bench, { recursive: true })
    mkdirSync(bin)
    copyFileSync(join(import.meta.dir, 'chat-night.sh'), join(bench, 'chat-night.sh'))
    writeFileSync(join(bin, 'python3'), `#!/bin/sh
printf '%s\n' "$2" >> "$TRACE"
if [ "$FAILED" = all ] || [ "$2" = "$FAILED" ]; then exit 7; fi
touch "$OUTPUT/\${2#bench-chat-}-bench.json"
`, { mode: 0o755 })
    writeFileSync(join(bin, 'bun'), `#!/bin/sh
if [ "$REPORT_FAILS" = yes ]; then exit 5; fi
printf 'report\n'
`, { mode: 0o755 })
    const result = spawnSync('sh', [join(bench, 'chat-night.sh'), out], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env['PATH']}`, TRACE: trace, OUTPUT: out,
        FAILED: failed, REPORT_FAILS: reportFails ? 'yes' : 'no' },
    })
    return { code: result.status, output: result.stdout + result.stderr,
      attempted: readFileSync(trace, 'utf8').trim().split('\n') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const browsers = ['bench-chat-chrome', 'bench-chat-firefox', 'bench-chat-webkit-host']

test('chat driver succeeds only when every browser and the report succeed', () => {
  const result = run('none')
  expect(result.code).toBe(0)
  expect(result.attempted).toEqual(browsers)
  expect(result.output).toContain('summary')
})

test('one failed browser blocks success while remaining browsers and partial reporting still run', () => {
  const result = run('bench-chat-firefox')
  expect(result.code).toBe(1)
  expect(result.attempted).toEqual(browsers)
  expect(result.output).toContain('firefox: exit 7')
  expect(result.output).toContain('summary')
})

test('all failed browsers do not produce a successful summary', () => {
  const result = run('all')
  expect(result.code).toBe(1)
  expect(result.attempted).toEqual(browsers)
  expect(result.output).toContain('no browser report')
  expect(result.output).not.toContain('summary')
})

test('report failure also blocks success', () => {
  const result = run('none', true)
  expect(result.code).toBe(1)
  expect(result.attempted).toEqual(browsers)
})
