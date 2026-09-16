## Pretext

Use `README.md` as the public source of truth for API examples and user-facing limitations. See `DEVELOPMENT.md` for commands, packaging/release checks, and the canonical snapshots to consult before making browser-accuracy or benchmark claims. Use `TODO.md` for the current priorities. `ENGINE_FOLLOWUPS.md` holds deferred engine decisions, known gaps and harness debt; update it when an item lands or is dropped. `PLATFORM_BUGS.md` is the browser/OS bug ledger, `RESEARCH.md` keeps durable findings and rejected approaches, `FONT_DIAGNOSTICS.md` keeps contextual font measurements, and `tests/wrapping/README.md`, `INVENTORY.md` and `VALIDATION.md` describe the wrapping suite, its coverage and completed comparisons. `pages/demos/markdown-chat.md` teaches app developers the Markdown chat demo's patterns; update it when the chat changes. **Every time before you commit, ensure you've synced the docs**.
Do not change the existing tone of the documents unless they're wrong.
Do `bun install` if you're in a fresh worktree.

**Important:** do NOT monkey-patch. If you found yourself solving the symptom instead of the root cause, reconsider and do a proper fix, then YELL **I SOLVED THE ROOT CAUSE NOT THE SYMPTOM** with a brief summary.

Changelog updates guideline: don't add dev-facing notes, only user-facing ones. Refer to closed PR numbers.

### Implementation notes

- The published package ships built ESM from `dist/`; `dist/` is publish-time output, not checked-in source. `package.json` maps `.` to `dist/layout.js` + `dist/layout.d.ts` and `./rich-inline` to `dist/rich-inline.js` + `dist/rich-inline.d.ts`, and also ships `src`; keep the package/export surface aligned with the emitted files.
- Keep shipped library source imports runtime-honest with `.js` specifiers inside `.ts` files. That keeps plain `tsc` emit producing correct JS and `.d.ts` files without a declaration rewrite step.
- `prepare()` / `prepareWithSegments()` do horizontal-only work. `prepare()` should stay the opaque fast-path handle: segment arrays flow through `prepareWithSegments()`, and the fast handle should not pay for data that `layout()` does not consume. `prepare()` is internally split into a text-analysis phase and a measurement phase; keep that seam clear, and keep prepare-time diagnostics internal to benchmark tooling instead of growing a second public prepare surface.
- The rich public surface is intentionally split between stats/range helpers (`walkLineRanges()`, `measureLineStats()`, `layoutNextLineRange()`) and text-materializing helpers (`layoutWithLines()`, `layoutNextLine()`, `materializeLineRange()`). Keep their break semantics aligned.
- The internal segment model distinguishes several break kinds (`SegmentBreakKind` in `src/analysis.ts`). Do not collapse those back into one boolean unless the model gets richer in a better way.
- `layout()` is the resize hot path: no DOM reads, no canvas calls, no string work, and avoid gratuitous allocations. Don't add DOM access, computed-style reads, or anything that forces style or layout to `prepare()` or `layout()`. The emoji-correction span, the `<html lang>` attribute read and the detached-canvas fallback when `OffscreenCanvas` is missing are the existing exceptions.
- Segment metrics cache is `Map<font, Map<segment, metrics>>`; shared across texts and resettable via `clearCache()`, which also drops the other shared caches and the segmenters. Width is only one cached fact; grapheme widths and other segment-derived facts can be populated lazily.
- Preparation replaces the measurement context and clears the segment metrics caches when `document.documentElement.lang` changes. Chrome's OffscreenCanvas re-resolves a font under the page language only when the font string changes. Do not replace the context on every `clearCache()`: Chrome caches shaped text per canvas, so that moves unrelated widths. See `PLATFORM_BUGS.md`.
- Keep script-specific break-policy fixes, including `{ wordBreak: 'keep-all' }` policy, in preprocessing, not `layout()`. See `RESEARCH.md` for the rules and rejected approaches. Keep stricter editorial whole-word handling in userland instead of changing the library default.
- Chrome's, Safari's and Firefox's break opportunities come from ports of Blink's and WebKit's scans in `src/line-breaks.ts` and Gecko's in `src/gecko-line-breaks.ts`, over their own tables in checked-in generated data. Refresh that data manually with `bun run generate:engine-break-data` from the engine files in `scripts/engine-data/`; do not turn it into a normal build step. Pretext takes no paragraph direction and resolves bidi levels only inside Gecko's scan, to split text runs as Firefox does; see `RESEARCH.md` before adding them anywhere else.

### Demos

- In `pages/demos/`, the model owns every value Pretext measures or a layout width depends on: fonts, letter spacing, the text as painted (for example upper-cased), padding and borders inside a model width, and breakpoints. The painter writes them inline instead of restating them in CSS, and a border inside a model width is drawn as an inset box-shadow. A page that scrolls reserves classic scrollbar room with `html { scrollbar-gutter: stable }` and reads its width from `document.body.clientWidth`; an inner scroller reads its own `clientWidth` and gets `scrollbar-gutter: stable`. When a demo fix lands, check the sibling demos for the same bug.

### Validation

- The maintained accuracy cases in `bun run test:wrapping --browser=all` should be green in all three installed browsers on fresh runs. Treat headless replays as hypotheses.
- Do not run multiple checkers in parallel against the same browser. Locks recover from dead owners; on a lock timeout, check whether a live checker still owns it.
- Keep benchmarks foreground.
- Use named fonts for accuracy, and give standalone probe pages an explicit, non-empty `lang`. Re-test the macOS emoji and `system-ui` bugs in a headed browser on a Retina display; headless DPR 1 runs can mask them. Consult `PLATFORM_BUGS.md` before changing engine-profile workarounds or line-fit tolerances.
- Follow the Safari extractor caveats in `DEVELOPMENT.md`: cross-check suspicious `pre-wrap` and URL-query `Range` results with spans before changing the engine.
- Refresh `benchmarks/chrome.json` and `benchmarks/safari.json` when a diff changes benchmark methodology or the text engine (`src/` other than `layout.test.ts`, or `pages/benchmark.ts`).
- Refresh `accuracy/chrome.json`, `accuracy/safari.json`, `accuracy/firefox.json`, `accuracy/letter-spacing.json` and `corpora/*-step10.json` when a diff changes the browser sweep methodology, the main text engine behavior (`src/` other than `layout.test.ts`), the wrapping suite’s case/observation methodology, or long-form canary behavior. One `bun run test:wrapping:snapshot` run writes them all.
