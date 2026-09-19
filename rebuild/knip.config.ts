import type { KnipConfig } from 'knip'

// Knip over rebuild/, from the repository root: bunx knip --config rebuild/knip.config.ts
// Test files are ignored so their imports don't count as usage, which flags the test helpers (lab/row-fixtures.ts,
// src/test-lines.ts, engines/webkit/test-paragraph.ts, tests/fake-browser.ts) and exports only tests read; dead code inside
// tests isn't looked for. `project` keeps it to rebuild/; knip.config.ts at the root covers the main library.
const config: KnipConfig = {
  entry: [
    'rebuild/src/index.ts',
    // Command-line tools (each parses its own arguments or runs on import).
    'rebuild/tools/*.ts',
    'rebuild/lab/{run,score,gate,fresh,sharded,measurements,compare-rows,triage}.ts',
    'rebuild/lab/cases/{generate,giants,parts,seal,twins}.ts',
    'rebuild/tests/{browser-sets,compare-sets,coverage,coverage-map,derive,facts,function-set,gate,import-rules,known-tail,ledger,replay}.ts',
    // Run by path under `bun test --coverage` (tests/coverage-map.ts).
    'rebuild/tests/coverage-map.shard.ts',
    'rebuild/bench/{run,report}.ts',
    'rebuild/platform-bugs/verify.ts',
    'rebuild/probes/{runner,blink-verdicts,gecko-verdicts,webkit-verdicts-crosscheck}.ts',
    // Bundled into browser pages by their drivers.
    'rebuild/lab/page.ts', 'rebuild/lab/predictor.ts', 'rebuild/lab/baselines/*.ts', 'rebuild/tests/noop-predictor.ts',
    'rebuild/bench/page.ts', 'rebuild/probes/page.ts',
    // Probe sets, loaded by path through runner.ts --probes=<file>.
    'rebuild/probes/*.ts',
  ],
  project: ['rebuild/**/*.ts'],
  ignore: ['**/*.test.ts'],
  // The root package's own: knip.config.ts at the root answers for them.
  ignoreDependencies: ['marked', 'playwright-core', 'tsgolint'],
  ignoreBinaries: ['lsof'],
  ignoreExportsUsedInFile: true,
}

export default config
