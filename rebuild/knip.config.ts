import type { KnipConfig } from 'knip'

// Knip over rebuild/, from the repository root: bunx knip --config rebuild/knip.config.ts
// Test files are ignored so their imports don't count as usage, which flags test helpers (lab/row-fixtures.ts,
// engines/webkit/test-paragraph.ts) and exports only tests read; dead code inside tests isn't looked for. `project` keeps
// it to rebuild/; knip.config.ts at the root covers the main library.
const config: KnipConfig = {
  entry: [
    'rebuild/src/index.ts',
    // Command-line tools (each parses its own arguments or runs on import).
    'rebuild/tools/*.ts',
    'rebuild/lab/{run,score,gate,fresh,sharded,measurements,compare-rows,triage}.ts',
    'rebuild/lab/cases/{generate,giants,parts,seal,twins}.ts',
    'rebuild/tests/{browser-sets,coverage,derive,facts,gate,import-rules,ledger,replay}.ts',
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
