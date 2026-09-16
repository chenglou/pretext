# Painter results (rebuild/src/paint.ts, 2026-09-16)

Lab runs of the shared painter in installed Chrome 153, installed Firefox 156 and webkit-host (WebKit 22625.1.29.11.27,
Safari 27.0's build), Retina DPR 2. Installed Safari wasn't run. Rows, summaries and per-case scores are under
`.artifacts/lab/painter/<browser>/<run>/`, scored with `rebuild/lab/score.ts` sha256 `e0a7b4be…`.

- **before** runs bundle `.artifacts/lab/painter/predictor-before.ts`, the lab predictor with `paint-before.ts`, a copy
  of `paint.ts` from the start of this work. **after** runs bundle `rebuild/lab/predictor.ts`.
- Before and after of each set ran back to back on the same working tree. The Blink owner had uncommitted edits in
  `engines/blink/{index,shape}.ts` throughout (`src-diff-*.patch` next to the runs), so Chrome's lineCount, breaks and
  widths differ from specs/blink-RESULTS.md, but are identical between each before and after.
- "Good" cases are those whose prediction matches native: lineCount and breaks pass, widths pass or unobserved. A
  painter failure on another case is mostly the prediction's.
- Cells are pass / fail / unobserved.

## Scores

### Painter-failing cases

Every case the owners' latest per-case files mark painter fail (Chrome smoke-r7, ws-r7, policy-r6, runs-r7, suite-r4;
Firefox r11; webkit-host smoke-r7, ws-r7, policy-r5, runs-r5, suite-r4), with the case as served in those rows
(`.artifacts/lab/painter/cases/painter-failing-<browser>.ndjson`). A case in two sets counts in both.

| Browser | Set | Cases | before | after (`failing-after2`) |
|---|---|---|---|---|
| Chrome | smoke | 12 | 1 / 11 / 0 | 5 / 7 / 0 |
| Chrome | ws | 18 | 0 / 18 / 0 | 5 / 13 / 0 |
| Chrome | policy | 7 | 0 / 7 / 0 | 1 / 6 / 0 |
| Chrome | runs | 158 | 0 / 158 / 0 | 6 / 152 / 0 |
| Chrome | suite | 2,199 | 613 / 1,586 / 0 | 1,721 / 473 / 5 |
| Chrome | all | 2,386 | 613 / 1,773 / 0 | 1,736 / 645 / 5 |
| Chrome | all, good | 1,673 | 513 / 1,160 / 0 | 1,591 / 77 / 5 |
| Firefox | smoke, ws, policy, runs, suite | 12, 15, 21, 63, 1,196 | unchanged | unchanged |
| Firefox | all | 1,300 | 1 / 1,299 / 0 | 1 / 1,299 / 0 |
| Firefox | all, good | 455 | 1 / 454 / 0 | 1 / 454 / 0 |
| webkit-host | smoke | 35 | 0 / 35 / 0 | 5 / 30 / 0 |
| webkit-host | ws | 32 | 0 / 32 / 0 | 3 / 29 / 0 |
| webkit-host | policy | 139 | 0 / 139 / 0 | 0 / 139 / 0 |
| webkit-host | runs | 252 | 0 / 252 / 0 | 19 / 232 / 1 |
| webkit-host | suite | 2,036 | 0 / 2,036 / 0 | 1,075 / 959 / 2 |
| webkit-host | all | 2,473 | 0 / 2,473 / 0 | 1,101 / 1,369 / 3 |
| webkit-host | all, good | 2,181 | 0 / 2,181 / 0 | 1,100 / 1,078 / 3 |

Chrome's before already passes 613 of these, against 0 in the owners' rows: the Blink engine changed since those runs.
`failing-after1` is the first painter change alone (nowrap lines, empty spans, white-space first slices): Chrome and
webkit-host as above except 87 webkit-host bidi lines that the second change fixed; Firefox unchanged.

### Smoke and suite sample

| Browser | Set | Rows | before | after |
|---|---|---|---|---|
| Chrome | smoke | 299 | 284 / 11 / 4 | 288 / 7 / 4 |
| Chrome | suite sample | 19,994 | 18,241 / 1,586 / 167 | 19,349 / 473 / 172 |
| Firefox | smoke | 297 | 281 / 12 / 4 | 281 / 12 / 4 |
| Firefox | suite sample | 19,888 | 18,531 / 1,196 / 161 | 18,531 / 1,196 / 161 |
| webkit-host | smoke | 300 | 248 / 35 / 17 | 253 / 30 / 17 |
| webkit-host | suite sample | 19,933 | 17,507 / 2,036 / 390 | 18,580 / 961 / 392 |

Transitions, after against before:

- Chrome suite: 1,100 painted wraps pass (1,061 on good cases), 8 extents pass (form feeds and VT alone on a line), 5
  become unobserved (other space separators at the line end). No pass became a fail.
- webkit-host suite: 1,003 wraps and 72 extents pass, 2 become unobserved, and 2 passes fail (below, WebKit float32).
  Page-history cases aren't left out; both runs used file order.
- Firefox: no case changed status in any set.

## What changed

- **Lines that end with a hyphen or start with the painter's U+200D don't wrap** (`text-wrap-mode: nowrap` on the line
  block). In the paragraph the hyphen and the joined letters belong to a line after its break was taken; painted, the
  hyphen span and the leading joiner begin a new item and grapheme cluster, and an overflowing line broke there again.
  Chrome and webkit-host broke at the chosen soft hyphen left in the slice (`c-3a9a7b6cde7063c9`: `ب` + SHY in 15.25px,
  the hyphen span on the next line; WebKit `InlineFormattingUtils.cpp:385-437`, Blink's break iterator), Firefox after
  the joiner under `overflow-wrap` (`c-1f5bdb4aa7cd37d2`). This fixes the soft hyphen class: 1,066 Chrome and 1,009
  webkit-host painter-failing cases. The Gecko owner's `white-space: nowrap` on the Gecko hyphen span (SHARED-CHANGES.md
  09:05) is replaced by it.
- **Spans with no painted text between two painted slices are painted empty.** `c-0ca55250962649aa` (`nowrap`, bare FF,
  empty span, bare FF): without the empty span the second FF follows white space and gets no layout object in Blink
  (text.cc:319-364, the Blink port's `layoutTextNeeded`), losing 5.33px.
- **A bare slice of U+0020 and U+0009..U+000D that starts a line in `normal` or `nowrap` goes in a span.** As a block's
  first child such a node isn't laid out: a VT or FF alone on a painted line had no rect (`c-18cb262b839dc1d5`,
  `c-5da5814af5803361`, Chrome and webkit-host).
- **Text never sits directly in an override element.** WebKit measures a text box with its parent's `unicode-bidi` and
  `direction` (`TextUtil.cpp:89-90`): an RTL box under an override is measured as an RTL override run, where the
  paragraph measures an LTR run without override. The probe `probe-plain` (plain spans only) passed 66 of 154 webkit-host
  bidi lines one float32 step off (`c-004997d455186870`, 338.1091613769531px painted, 338.10919189453125px native), and
  0 of 14 Chrome bidi lines one LayoutUnit off.
- **The line's trailing white space takes the level of the text before it in the same run.** A painted line is a bidi
  paragraph of its own, and white space at its end takes the base level in all three browsers (ICU's `ubidi_setPara` in
  Blink and WebKit; Gecko's unicode-bidi FFI resolves with `visual_runs(0..len)`,
  `intl/bidi/rust/unicode-bidi-ffi/src/lib.rs:54`). Splitting the slice at the reset level cost WebKit its measurement
  of a word with the space after it (`TextUtil.cpp:76-77`, `c-1342a9f00ef67135`). With the plain spans: 87 more
  webkit-host lines pass.

Not changed: the per-engine hyphen span, R7's joiners, override levels, the A-wrap line block.

## Painter limitations

DESIGN.md §7 names each, with its condition. Counts are the remaining failures on good cases in `failing-after2`,
classified by line features, so they're approximate.

| Engine | Limitation | Remaining | Example |
|---|---|---|---|
| all | A soft hyphen inside an emoji sequence or ligated cluster: the rest draws as a glyph of its own | mostly on bad cases (Chrome lineCount, Firefox breaks unobserved) | `c-012cd24fb976dc63` |
| Gecko | U+200D doesn't reproduce the paragraph's joined widths; cursive attachment and kerning across a mid-word edge are lost (L1) | about 290 joiner lines, about 70 kerning and ligature lines (`f`\|`fi`, `office`) | `c-1f5bdb4aa7cd37d2`, `c-bc331df924f00daa` |
| Gecko | Letter spacing after the last character of a text run (format characters, tabs, bases whose marks are on the next line) | about 35 | `c-2ccbff7837117855` |
| Gecko, Blink | Common characters at a line start lose the previous run's script (L7), and in Blink the cursive letter-spacing exemption | about 20 each | `c-fbd2f77752afe430`, `c-27d5d232618787d5`, `c-7715aaeaa4fa426b` |
| Gecko | Trailing white space above the base level moves to the line end | about 9 | `c-01cfe05b2ffd874b` |
| Blink | HanKerning trims by a neighbour on the other line | about 11 | `c-b408d44e962b357e`, `c-342b6a8c28ff1dab` |
| Blink | A line ending at a space keeps the space's kerning with the next line | 3 | `c-0fe656a162eb2508` |
| Blink | Bidi lines under override spans one LayoutUnit wider (L9, not traced further) | about 15 | `c-05bbcacc0fe2f0e5` |
| WebKit | The rest of an item split by the overflow breaker is measured fresh instead of carried | about 700, including 35 painted wraps at narrow widths | `c-c62182c46f2a130d`, `c-16de89e4db9184ec` |
| WebKit | A word whose following space starts the next line | 73 | `c-0145610398f11164` |
| WebKit | RTL lines under overrides one float32 step off | about 40, and the 2 suite regressions | `c-5faed8f1476d8ed1`, `c-354eed076f010028` |

Untraced, on good cases: Chrome `mark-context` letter spacing after U+200B (3), `mixed-fonts-sizes` (2, 74 units),
`policy/overflow-wrap` `c-c8ded9f648a1aaba` (9px); webkit-host `suite/accepted-l` hyphen lines (`c-00272aea15923712`).

## Notes for owners

- **Blink (no change made, SHARED-CHANGES.md 12:20).** `lineOutput` classifies `cr-ff` control items as `collapsed`, so
  CR and FF in preserve modes aren't painted and the text on both sides becomes one item: ws/controls `c-35d44d2989d1a6e4`
  paints 1 LayoutUnit narrower, and `c-6212c8ea1b82a779` wraps between `文` and `中` where native has `文` FF `中` on one
  line. About 13 good cases. They need a `text` fragment of width 0.
- **specs/painter.md.** Probe 5 (R7) hasn't run, and the Firefox rows contradict R7 for Gecko at narrow widths. §5's
  A-wrap needs the nowrap exception above for lines that end at a hyphen or start with a joiner. R6's Gecko span keeps
  `unicode-bidi: isolate` only.
- The lab needed no change.

## Files

- `rebuild/src/paint.ts`, `rebuild/DESIGN.md` §7, `rebuild/SHARED-CHANGES.md` (12:20 entries).
- `.artifacts/lab/painter/cases/`: the failing-case files, `painter-failing-sets.json` (id to sets), the bidi probe
  cases.
- `.artifacts/lab/painter/compare.ts`: scores two row files and prints painter counts per set, transitions and reasons.
- `bun test rebuild/src`: 137 pass. `bunx tsc --noEmit -p rebuild/tsconfig.json` is clean.
