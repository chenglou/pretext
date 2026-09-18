import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

test.each([0, -1])('corpus taxonomy rejects a nonpositive step (%s)', step => {
  const result = Bun.spawnSync([
    process.execPath, 'scripts/corpus-taxonomy.ts',
    '--browser=chrome', '--id=mixed-app-text', `--step=${step}`,
  ], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 1_000,
  })
  expect(result.exitCode).not.toBe(0)
  expect(new TextDecoder().decode(result.stderr)).toContain('--step must be > 0')
})
