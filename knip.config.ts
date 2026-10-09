import type { KnipConfig } from 'knip'

// Test files are in `ignore` so their imports don't count as "usage", flagging exports used only by test files as unused.
// Tradeoff: dead code & exports within test files won't be detected. See: https://github.com/webpro-nl/knip/issues/1374. This is acceptable
const config: KnipConfig = {
  entry: [
    // Library entry points — match the `exports` field in package.json
    'src/layout.ts',
    'src/rich-inline.ts',
    // Scripts run directly: by package.json's scripts, or by hand as the headers in scripts/grapheme-check say
    'scripts/**/*.ts',
    // Browser pages and demos — the modules a `<script type="module" src="…">` in a sibling `.html` loads, and the ones those
    // import (shared code, models, data and a type declaration), every one of them an entry
    'pages/**/*.ts',
    // The page the harness's runner bundles, the case-set maker, and the invariants and offline equal it runs in child
    // processes.
    'harness/page.ts',
    'harness/sets/make.ts',
    'harness/invariants.ts',
    'harness/offline-equal.ts',
    // The bench's page, bundled by its runner.
    'harness/bench/page.ts',
  ],
  ignore: [
    '**/*.test.ts', // Exclude tests so their imports don't count as "usage"
  ],
  ignoreBinaries: [
    // Used in package.json scripts
    'lsof',
  ],
  // slightly confusing config. We detect dead code just fine
  // this one's just to silence exported types and values that aren't used elsewhere but that are still used within their file
  // yelling on unnecessary exports is a bit noisy so we turn it off
  ignoreExportsUsedInFile: true,
}

export default config
