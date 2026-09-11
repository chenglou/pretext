## Pretext

Use `README.md` as the public source of truth for API examples and user-facing limitations. See `DEVELOPMENT.md` for commands, packaging/release checks, and the canonical dashboards/snapshots to consult before making browser-accuracy or benchmark claims. Use `TODO.md` for the current priorities. **Every time before you commit, ensure you've synced the docs**.
Do not change the existing tone of the documents unless they're wrong.
Do `bun install` if you're in a fresh worktree.

**Important:** do NOT monkey-patch. If you found yourself solving the symptom instead of the root cause, reconsider and do a proper fix, then YELL **I SOLVED THE ROOT CAUSE NOT THE SYMPTOM** with a brief summary.

Changelog updates guideline: don't add dev-facing notes, only user-facing ones. Refer to closed PR numbers.

### Important files

- `package.json` — published entrypoints now target `dist/layout.js` + `dist/layout.d.ts`; keep the package/export surface aligned with the emitted files
- `tsconfig.build.json` — publish-time emit config for `dist/`
- `scripts/package-smoke-test.ts` — tarball-level JS/TS consumer verification for the published package shape
- `src/layout.ts` — core library; keep `layout()` fast and allocation-light
- `src/analysis.ts` — normalization, segmentation, glue rules, and text-analysis phase for `prepare()`
- `src/measurement.ts` — canvas measurement runtime, segment metrics cache, emoji correction, and engine-profile shims
- `src/line-break.ts` — internal line-walking core shared by the rich layout APIs and the hot-path line counter
- `src/bidi.ts` — simplified bidi metadata helper for the rich `prepareWithSegments()` path
- `src/rich-inline.ts` — inline-only helper for rich-text inline flow, atomic pills, and boundary whitespace collapse
- `src/test-data.ts` — shared corpus for browser accuracy pages/checkers and benchmarks
- `src/layout.test.ts` — small durable invariant tests for the exported prepare/layout APIs
- `tests/wrapping/` — shared wrapping fixtures, native observations, public API contracts and explicit research limitations; use its ordinary/full schedules for comparisons
- `scripts/wrapping-check.ts` — freezes suite and candidate sources, compares them with pinned main in the same native browser, and reports each lost success
- `pages/accuracy.ts` — viewer for the shared suite’s checked-in accuracy snapshots
- `pages/benchmark.ts` — performance comparisons
- `PLATFORM_BUGS.md` — current browser/OS bug ledger, issue links, workarounds, and investigated non-bugs
- `RESEARCH.md` — durable findings and rejected approaches, including script-specific wrapping and corpus lessons
- `FONT_DIAGNOSTICS.md` — contextual font measurement findings and limitations
- `pages/diagnostic-utils.ts` — shared grapheme-safe diagnostic helpers used by the browser check pages
- `tests/wrapping/cases.ts` — maintained browser oracles and explicit ordinary/full wrapping selections
- `pages/demos/index.html` — public static demo landing page used as the GitHub Pages site root
- `pages/demos/bubbles.ts` — bubble shrinkwrap demo using the rich non-materializing line-range walker
- `pages/demos/dynamic-layout.ts` — fixed-height editorial spread with a continuous two-column flow, obstacle-aware title routing, and live logo-driven reflow
- `pages/demos/markdown-chat.ts` — rich chat virtualization demo that stress-tests prepared templates and manual block layout
- `pages/demos/rich-note.ts` — inline-rich-note demo that dogfoods the rich-text inline flow helper at `@chenglou/pretext/rich-inline`

### Implementation notes

- The published package ships built ESM from `dist/`; `dist/` is publish-time output, not checked-in source.
- Keep shipped library source imports runtime-honest with `.js` specifiers inside `.ts` files. That keeps plain `tsc` emit producing correct JS and `.d.ts` files without a declaration rewrite step.
- `prepare()` / `prepareWithSegments()` do horizontal-only work. `layout()` / `layoutWithLines()` take explicit `lineHeight`.
- `setLocale(locale?)` retargets the hoisted word segmenter for future `prepare()` calls and clears shared caches. Use it before preparing new text when the app wants a specific `Intl.Segmenter` locale instead of the runtime default.
- `prepare()` should stay the opaque fast-path handle. If a page/script needs segment arrays, that should usually flow through `prepareWithSegments()` instead of re-exposing internals on the main prepared type.
- The rich public surface is intentionally split between stats/range helpers (`walkLineRanges()`, `measureLineStats()`, `layoutNextLineRange()`) and text-materializing helpers (`layoutWithLines()`, `layoutNextLine()`, `materializeLineRange()`). Keep their break semantics aligned.
- `walkLineRanges()` is the rich-path batch range API: no string materialization, but still browser-like line widths/cursors/discretionary-hyphen state. Prefer it over private line walkers for shrinkwrap or aggregate layout work.
- Keep prepare-time diagnostics internal to benchmark tooling. Do not grow a second public prepare surface just to expose timing splits.
- `prepare()` is internally split into a text-analysis phase and a measurement phase; keep that seam clear, but keep the public API simple unless requirements force a change.
- The internal segment model now distinguishes at least eight break kinds: normal text, collapsible spaces, preserved spaces, tabs, non-breaking glue (`NBSP` / `NNBSP` / `WJ`-like runs), zero-width break opportunities, soft hyphens, and hard breaks. Do not collapse those back into one boolean unless the model gets richer in a better way.
- `layout()` is the resize hot path: no DOM reads, no canvas calls, no string work, and avoid gratuitous allocations.
- Segment metrics cache is `Map<font, Map<segment, metrics>>`; shared across texts and resettable via `clearCache()`. Width is only one cached fact now; grapheme widths and other segment-derived facts can be populated lazily.
- Word and grapheme segmenters are hoisted at module scope. Any locale reset should also clear the word cache.
- Punctuation can join word or symbol runs depending on context; `isWordLike` alone does not determine break opportunities.
- Keep script-specific break-policy fixes in preprocessing, not `layout()`. See `RESEARCH.md` for the rules and rejected approaches.
- `NBSP`-style glue should survive `prepare()` as visible content and prevent ordinary word-boundary wrapping; `ZWSP` should survive as a zero-width break opportunity.
- Soft hyphens should stay invisible when unbroken. When one is selected, stop at that boundary and expose a visible trailing `-` in the rich line APIs' `line.text`.
- Keep `layoutNextLine()`'s line stepping separate from text materialization and aligned with `layoutWithLines()`. Keep its grapheme-cache bookkeeping out of the hot `layout()` path.
- Astral CJK ideographs, compatibility ideographs, and the later extension blocks must still hit the CJK path; do not rely on BMP-only `charCodeAt()` checks there.
- CJK grapheme splitting plus kinsoku merging keeps prohibited punctuation attached to adjacent graphemes.
- Emoji correction is auto-detected per font size, constant per emoji grapheme, and effectively font-independent.
- Bidi levels now stay on the rich `prepareWithSegments()` path as custom-rendering metadata only. The opaque fast `prepare()` handle should not pay for bidi metadata that `layout()` does not consume, and line breaking itself does not read those levels.
- The rich-path bidi classifier now comes from checked-in generated Unicode range data. Refresh it manually with `bun run generate:bidi-data`; do not turn that into a normal build step.
- A larger pure-TS Unicode stack like `text-shaper` is useful as reference material, especially for Unicode coverage and richer bidi metadata, but its runtime segmentation and greedy glyph-line breaker are not replacements for our browser-facing `Intl.Segmenter` + preprocessing + canvas-measurement model.
- Supported CSS target is still the common app-text configuration: `white-space: normal`, `word-break: normal`, `overflow-wrap: break-word`, `line-break: auto`.
- Narrow widths may still break inside words, but only at grapheme boundaries. Keep stricter editorial whole-word handling in userland instead of changing the library default.
- There is also an explicit opt-in `{ wordBreak: 'keep-all' }` mode for CJK/Hangul text and CJK-leading no-space mixed-script runs; keep its policy work in preprocessing, not `layout()`.
- There is now a second explicit whitespace mode, `{ whiteSpace: 'pre-wrap' }`, for ordinary spaces, `\t` tabs, and `\n` hard breaks. Tabs follow the default browser-style tab stops. Treat it as editor/input-oriented, not the whole CSS `pre-wrap` surface.

### Validation

- Keep `src/layout.test.ts` and permanent `pre-wrap` coverage small and durable. Use throwaway probes for narrow hypotheses, and promote only stable regression cases.
- The maintained accuracy cases in `bun run test:wrapping --browser=all` should be green in all three installed browsers on fresh runs. Check for stale tabs/servers before changing the algorithm.
- Do not run multiple checkers in parallel against the same browser. Locks recover from dead owners; on a lock timeout, check whether a live checker still owns it.
- Keep benchmarks foreground. Follow `DEVELOPMENT.md` for browser automation and deep profiling; Bun microbenchmarks are only quick hypothesis checks.
- Use named fonts for accuracy. Re-test the macOS emoji and `system-ui` bugs in a headed browser on a Retina display; headless DPR 1 runs can mask them. Consult `PLATFORM_BUGS.md` before changing engine-profile workarounds or line-fit tolerances.
- Use the batched accuracy and `step=10` corpus sweeps first, then diagnose mismatching widths with the detailed checkers. Do not navigate once per width for a full sweep.
- Small automation reports can use the hash; large batched reports need the local POST side channel. A timeout in the `posting` phase points to report transport first.
- Scripted checkers use temporary `--no-hmr` servers. Connection-refused tabs after teardown are expected; use `bun start` for a persistent dev server.
- For Arabic/Urdu, use normalized slices, the exact corpus font, and RTL `Range` diagnostics. Use `Range` for Thai/Lao/Khmer/Myanmar too; span probing can change their line breaks.
- Follow the Safari extractor caveats in `DEVELOPMENT.md`: cross-check suspicious `pre-wrap` and URL-query `Range` results with spans before changing the engine.
- Derive diagnostic lines from `layoutWithLines()` and source offsets from prepared segments and grapheme cursors. Do not duplicate the line walker or reconstruct offsets from `line.text.length`.
- Use existing corpus `font` / `lineHeight` overrides for font comparisons. Start font matrices in Chrome; use Safari for follow-up smoke coverage.
- Keep mixed app text as a canary for URLs, emoji ZWJ runs, and mixed-script punctuation. See `RESEARCH.md` for corpus findings and rejected fixes.
- Refresh `benchmarks/chrome.json` and `benchmarks/safari.json` when a diff changes benchmark methodology or the text engine hot path (`src/analysis.ts`, `src/measurement.ts`, `src/line-break.ts`, `src/layout.ts`, `src/bidi.ts`, or `pages/benchmark.ts`). Regenerate `status/dashboard.json` after snapshot changes.
- Refresh `accuracy/chrome.json`, `accuracy/safari.json`, and `accuracy/firefox.json` when a diff changes the browser sweep methodology or the main text engine behavior (`src/analysis.ts`, `src/measurement.ts`, `src/line-break.ts`, `src/layout.ts`, `src/bidi.ts`, or the wrapping suite’s case/observation methodology). Use `bun run test:wrapping:snapshot`.
- Refresh `corpora/chrome-step10.json`, `corpora/safari-step10.json`, and `corpora/firefox-step10.json`, then regenerate `corpora/dashboard.json`, when corpus sweep methodology or long-form canary behavior changes in a way that moves the dashboard counts. Use `bun run test:wrapping:snapshot`.
