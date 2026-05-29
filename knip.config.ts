import type { KnipConfig } from 'knip'

// Test files are in `ignore` so their imports don't count as "usage", flagging exports used only by test files as unused.
// Tradeoff: dead code & exports within test files won't be detected. See: https://github.com/webpro-nl/knip/issues/1374. This is acceptable
const config: KnipConfig = {
  entry: [
    // Library entry points — match the `exports` field in package.json
    'src/layout.ts',
    'src/rich-inline.ts',
    // Scripts invoked via package.json
    'scripts/**/*.ts',
    // Browser pages and demos — each `pages/**/*.ts` is the target of a `<script type="module" src="…">` in a sibling `.html`
    'pages/**/*.ts',
  ],
  ignore: [
    'src/layout.test.ts', // Exclude tests so their imports don't count as "usage"
  ],
  ignoreDependencies: [
    'tsgolint', // Type-aware checker invoked by `oxlint --type-aware` via oxlint-tsgolint
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
