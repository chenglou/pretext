// Root schedules this. No browser is launched by importing the probe/check modules or by their smoke harness.
import { join, resolve } from 'node:path'
import { acquireBrowserAutomationLock } from '../../scripts/browser-automation.ts'
const argument = process.argv[2]
if (argument === undefined) throw new Error('usage: GECKO_BASE_TREE=... GECKO_HEAD_TREE=... bun gecko-dictionary-pair-run.ts <out-directory>')
const out = resolve(argument)
const repo = resolve(import.meta.dir, '../..')
async function runPair(): Promise<number> {
  const locks: Awaited<ReturnType<typeof acquireBrowserAutomationLock>>[] = []
  try {
    // Timing owns every maintained browser lane; acquire in one fixed order.
    for (const browser of ['chrome', 'firefox', 'safari'] as const) locks.push(await acquireBrowserAutomationLock(browser))
    const run = Bun.spawn(['bun', join(repo, 'rebuild/probes/runner.ts'), '--browser=firefox', ...(process.env['GECKO_PAIR_FOREGROUND'] === '1' ? ['--foreground'] : []), '--require-clean', `--probes=${join(import.meta.dir, 'gecko-dictionary-pair-probe.ts')}`, `--out=${out}`, `--firefox-prefs=${join(import.meta.dir, 'gecko-dictionary-pair-prefs.json')}`, '--probe-timeout-ms=300000', '--stall-ms=300000'], { cwd: repo, stdout: 'inherit', stderr: 'inherit', env: process.env })
    const code = await run.exited
    if (code !== 0) return code
    const check = Bun.spawn(['bun', join(import.meta.dir, 'gecko-dictionary-pair-check.ts'), join(out, 'firefox-probes.json')], { stdout: 'inherit', stderr: 'inherit' })
    return await check.exited
  } finally { for (let index = locks.length - 1; index >= 0; index--) locks[index]!.release() }
}
process.exit(await runPair())
