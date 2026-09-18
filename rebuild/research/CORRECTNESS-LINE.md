# The correctness line (frozen 2026-09-18)

Two parts: the freeze report, then an independent verification made from a scratch clone.

---

# Correctness line frozen: fixes 1 and 2 landed, six references frozen at 6b21b68, tier 1 exits 0

The two critic fixes are in. Everything was re-recorded on the committed tree and nothing moved against the round 4 evaluation. The seeds are adopted and the known tail is updated. At HEAD `af50a11` the tree is clean, tier 0 is 727 pass, and tier 1 exits 0 with 388,886 cases the same in 42 s. No commit carries an attribution line or mentions Claude.

Paths are under `~/github/pretext-rebuild`. Tools and logs are in `.artifacts/ceiling-20260917/freeze-line`.

## Commits
- `feb3937`: fix 1 and fix 2.
- `6b21b68`: adopted seeds; superseded staging folders removed.
- `e673675`: six references frozen at 6b21b68 and pinned, plus the docs of the line.
- `086280b`: known tail.
- `da90ab0`, `af50a11`: probe names and docs.

## Fix 1: font checks measure in the engine's own context
- **The change.** `rebuild/src/measure/font-checks.ts` now takes its text rendering from `checkTextRendering(engine)`. Blink gets `optimizeLegibility`, as `styleContexts` does. WebKit and Gecko keep the default their recipes assign.
- **Source reading.** It is in the file header:
  - font_description.cc:308-331: the font cache key holds text-rendering and the zoomed size, not the specified size;
  - font_platform_data_mac.mm:170-178: opsz is set from the specified size.
- **Unit tests.** There are two. One holds every check context to the text rendering of the engine's own contexts through `prepareParagraph`, in all three engines. Both fail without the fix.
- **Observed with the system font as stand-in.** Probes ran in pinned Chrome at DPR 2, each alone in a fresh process.
  - Under the checks' new contexts (probes `font-check-legibility`, `font-check-legibility-word`), DOM system-ui text at 8px to 16px keeps the clean rule's width.
  - Under text-rendering auto (probes `font-check`, `font-check-word`), 16px text is 71.2421875px instead of 81.125px.
- **Other engines.**
  - WebKit has no such defect. Its key holds the computed size, the text rendering mode and optical sizing (FontCascadeCache.h:113-154), and opsz comes from the font's own size (UnrealizedCoreTextFont.cpp:303-315), so a font a check makes is the font the page makes. Its glyph geometry cache keeps computed values (FontCascade.cpp:319-352).
  - Gecko runs no check.
- **What remains.** On a page whose text sets `text-rendering: optimizeLegibility`, the checks share platform fonts with the page. That is known-tail item `blink/pages-with-text-rendering-legibility`.

## Fix 2: the ledger carries an exact-value status
- **Format.** Ledger format is now `pretext-ledger/2`. Beside the four metrics, every case has an `exact` status. The values are:
  - `exact`
  - `not exact (values n, rect counts m)`
  - `history-dependent`
  - `protocol row`
  - `unobserved`
- **Source of the counts.** They come from the scorer's per-case facts: rect counts, and the x and width of rects in the predicted state.
- **Gating.** `ledger.ts transitions` and `browser-sets.ts` list exact-value transitions and name known-tail items on them. Both exit 1 when an exact case stops being exact, or when a case that was not exact holds more differing values.
- **Limited values.** Differing limited values are kept per case and printed as a sum. They never block. No metric's meaning changed.
- **Header counts.** The header counts cases without a failing prediction metric that hold a wrong predicted value or a differing rect count.
- **Known-tail rules.** Rules can read the status through a `not exact` rule by family. There are tests for all of it, and README lines.
- **Check against the critic's planted runs**, read through the new status:

| Planted run | Blocking cases, facts | Blocking cases, no facts | Exit (facts / no facts) |
|---|---|---|---|
| Chrome | 61 | 10 | 1 / 1 |
| Firefox | 5 | 0 | 1 / 0 |

Firefox without facts shows the change only as differing limited values, 0 → 89. That is why tier 2 runs both configurations.

## What moved: nothing
Tier 2 was re-recorded at `feb3937` in the three pinned browsers, both configurations and both orders, with `rich-prewrap` included. The giants were re-run too. Compared with the evaluation's recordings:
- **Ledgers.** In all six there are 0 transitions on the four metrics and on the exact status, and the same differing predicted, rect-count and limited values.
- **History-dependent sets.** They are the same: Firefox 313 (314 on widths), webkit-host 279 (283 on the painter).
- **Per-case files.** All 208 tier 2 files and the giants' 12 are byte-identical.
- **Row comparison.** `compare-sets.ts` over both orders finds no differing native observation, prediction or painted line. Row counts per configuration:
  - Chrome: 133,370
  - Firefox: 127,542
  - webkit-host: 127,974
- **Packing.** All 388,886 cases replay exactly, with 0 unfaithful.
- **Sanity plant.** With the old check context planted, all 66,685 Chrome no-facts cases ask a new question (exit 3).

## Seeds
- **Regenerated.** The gates' own commands were used: `browser-sets.ts --seed`, `lab/gate.ts --seed` and `tests/gate.ts seed`. The new seeds match the evaluation's staged seeds in passes, history-dependent cases, unstable pairs, protocol rows and environments.
- **Attributions.** All 2,251 lost pairs in 26 records carry the evaluation's attribution, matched by (case id, metric) with the same status. Tier 2's records compare with round 4a's staged seeds, as the evaluation's did: Chrome no-facts loses 270 pairs and Firefox 546. Against the evaluation's own staged seeds the new ones lose 0 and gain 0.
- **Checks.** All 20 lab and tests checks of an adopted seed against its own runs pass, and tier 2 passes six times.
- **Adopted layout** (my choice, because the baseline names carry no configuration):
  - `rebuild/lab/baselines/{no-facts,facts}/`
  - `rebuild/tests/baselines/{no-facts,facts}/`, each with its own `coverage.json`; `rebuild/tests/coverage.json` is the no-facts one
  - `rebuild/tests/baselines/sets/`
- **Removed from the tree** (all remain in git history):
  - the round 3 and round 4 staging folders;
  - the round 2 `.50` seeds (scorer 4) that the new seeds replace.

  Removing those `.50` seeds goes beyond the brief, which named only the round 3 staged folders. The seed records' `against` paths now point at files that exist only in history. The `.48` seeds and the G0 seeds stay.

## Frozen headline numbers (tier sets)
Columns are line count / breaks / widths / painter. "Open" means a failure without a covered explanation.

| Browser, config | lc / br / w / p (%) | Open | Painter open | Not exact | Predicted values differing | Wrong value in a case with no failing metric |
|---|---|---|---|---|---|---|
| Chrome, no facts | 99.48 / 99.38 / 99.04 / 98.07 | 1 (`c-a37545c096e939be`, breaks) | 4 | 816 of 66,685 | 266 of 586,352 | 0 |
| Chrome, facts | 99.58 / 99.52 / 99.51 / 98.28 | the same 1 | 10 | 720 | 549 of 3,577,258 | 0 |
| Firefox, no facts | 99.77 / 99.47 / 97.54 / 93.68 | 0 | 0 | 312 of 63,771 | 301 of 378,400 | 0 |
| Firefox, facts | 99.81 / 99.56 / 97.82 / 93.68 | 0, plus 19 residual rows | 34 | 286 | 744 of 5,015,298 | 6 (the registered Nastaliq cases) |
| webkit-host, no facts | 99.87 / 99.78 / 99.58 / 93.04 | 0 | 24 | 125 of 63,987 | 0 of 565,440 | 0 |
| webkit-host, facts | 99.87 / 99.78 / 99.58 / 93.04 | 0 | 25 | 125 | 0 of 772,758 | 0 |

- **Left out as history-dependent.** Firefox 314 cases and webkit-host 283 are excluded in both configurations.
- **Rect counts in passing cases.** Counts differ in 404 Chrome cases (`rule/wbr-elements` 392, `rich-prewrap/nested` 12), 30 webkit-host cases and 0 Firefox cases. All are in the known tail.
- **Unseen-case rates.** The evaluation's rates on unseen cases still stand.

## Commands that define the line
- **Tier 0:** `bun test rebuild` (727 tests, 11 s).
- **Tier 1:** `bun rebuild/tests/replay.ts check --browser=all --config=all` (exit 0, 42 s).
- **Tier 2:** `bun rebuild/tests/browser-sets.ts --browser=<chrome|firefox|webkit-host> --config=<no-facts|facts> --out=<dir> [--both-orders] [--ids-file=…]`
  - By default it reads the frozen reference's ledger and the adopted seed.
  - A fresh forward-only run from HEAD in all three browsers and both configurations gave exit 0 six times, with 0 transitions. It took 92 to 195 s per browser and configuration with the three running at once.
- **Moving a prediction on purpose:** re-record, then run `replay.ts pack --force`, then `freeze --force --reason=…`.

## Known tail: 62 items, 589 named cases, 24 rules
Three items were added with the tool:
- `lab/webkit-rect-counts-in-passing-cases` holds the 30 tier ids and 3 fresh ids.
- `lab/blink-x-after-a-fallback-cluster-reported-as-predicted` holds 14 ids.
- `shared/one-device-pixel-ratio-one-os`.

Several existing items were edited:
- `lab/blink-element-rects-of-spans-without-a-box-fragment` gained a `not exact` rule over `rule/wbr-elements`, which corrects CHARTER's "12 tier cases".
- `gecko/process-font-fallback-state` now records the critic's 209 cases against the evaluator's 0.
- `webkit/page-history` gained the 82 cases that pass alone.
- `blink/range-rects-hang` records the wider hang signature.
- `lab/replay-blind-spots` records that a `src/paint.ts` change is invisible to tier 1.
- The ideographic full stop item gained its trace.
- The critic's fresh-set members were added, and the font-check item is closed.

**WebKit element rects one float32 step off.** This is not an observation rule, so I did not fix it before recording; it stays in the tail with the trace below.
- **What is already right.** The observation port already applies `FloatQuad::boundingBox` to element rects.
- **Where the wrong value is.** It is the width of the engine's own inline box.
- **The arithmetic.** On a bidi line, WebKit's `InlineRect::setRight` calls `FloatRect::shiftMaxXEdgeTo`. It computes the width in float32 as w0 + (R − (L + w0)), starting from the line box's width, which leaves out the hanging trailing space.
- **Evidence.** This reproduces the native width to the bit on `c-cb91481c4f72e2ef` and `c-e13d8aa9e28342ab` (38.94573974609375). Citations: InlineDisplayContentBuilder.cpp:728-822, FloatRect.h:139-143.
- **What a fix needs.** It would be a library change in two engine paths. The members on lines without bidi content are not traced.

## Still not true of the frozen line
- **Recording commit.** The recordings ran at `feb3937` and the references say `6b21b68`. The library, predictors, font facts, ports, page, runner and scorer are identical at both commits (checked with `git diff`). Tier 1 exits 0 at HEAD.
- **No-facts blind spot.** With no supplied facts most values are limited. An exact-value regression blocks in the facts configuration and shows only as a rising limited-value sum in the headline one. `exact` is vacuous where no value is predicted.
- **Tier 1 routing in Chrome.** In the no-facts reference, 65,384 of 66,685 Chrome cases are storage-sensitive, because font check 4 asks a 15-unit sample. Any change under `src/measure` or `engines/blink/shape.ts` therefore sends nearly every Chrome no-facts case to tier 2, and tier 1 cannot exit 0 there even for a no-op.
- **The painter.** `src/paint.ts` changes pass tier 1 silently; tier 2 sees them only through the painter metric.
- **Coverage.**
  - One Mac at DPR 2.
  - Giants are in no tier.
  - Installed Safari was not re-run.
- **Instability.**
  - Firefox's history-dependent set was stable today but not on the critic's fresh set.
  - Chrome's hang signature is wider than the set-aside rule; no tier job stalled today.
- **Recording metadata.** Resumed invocations for seeding and checking rewrote `timing.json` in the recording folders. The first-run times are in `freeze-line/logs/tier2-*.log`.
- **Rows.** Row files are compressed with zstd (19 GB → 1.8 GB), with the originals in the Trash. To re-pack from these recordings, decompress the forward rows first.

---

# Independent verification

# Freeze check: the line holds for a re-architecture, under two conditions

Everything the freeze report claims that I checked reproduces, and nothing in it is false. The line is safe to hold a re-architecture to if tier 2 runs in both configurations and if `src/paint.ts` changes get tier 2 by hand. Even then, a painter change that only moves text passes tier 2 in Chrome and Firefox.

I changed nothing in the repository. The main tree and the scratch clone are both at `af50a11` with `git status` empty, and the frozen folders are untouched. Tier 1 ran through links into `.artifacts/tests/reference`.

- Scratch clone: `/private/tmp/claude-501/-Users-chenglou-github-pretext/7e07dee5-fc27-4046-b679-3f61a43f7436/scratchpad/freeze-verify`
- Tools, logs, plants and results: `/Users/chenglou/github/pretext-rebuild/.artifacts/ceiling-20260917/freeze-verify` (`tools/`, `logs/`, `plants/`, `tier1/`, `tier2/`, `seeds/`, `ledgers/`, `probes/`)

## Needs you
- **Run tier 2 in both configurations.** In Firefox's headline configuration an exact-value regression exits 0 and shows only as a rising limited-value sum. Two plants showed this (below).
- **Give `src/paint.ts` changes tier 2 by hand, and don't trust tier 2 alone for where text is painted.** Tier 1 stays silent on a painter change and routes nothing. Tier 2 compares only the width of painted extents and whether a line wraps.
- **Known tail, two small gaps.** It doesn't name the painter's blindness to alignment. It also doesn't name `canvas-checks.ts`'s `16px serif` context, which still measures at text-rendering auto in Blink (detail under "Still not visible").
- **Optional: block on a rise in limited values.** Differing limited values rose in 0 cases on every HEAD, no-op and painter run here, so a rise could get its own exit code without false alarms. That would close the Firefox headline blind spot.

## The committed line
- **Commits.** The six commits from `feb3937` to `af50a11` carry no attribution line and no mention of Claude.
- **Commit the references name.** All six pinned manifests name `6b21b68`, not HEAD. Between `6b21b68` and HEAD, `git diff` lists only docs, the pins, `known-tail.json` and `probes/measure-first.ts`. Between `feb3937` (the recording) and HEAD, nothing under `rebuild/src` or `rebuild/lab` differs but the README.
- **Pins by hash.** Each pinned manifest is byte-equal to its `reference/manifest.json`. All 480 reference shards, all 480 input shards, the input manifests and both ledger hashes match in each of the six. No case is unfaithful and none has a log disagreement.
- **Library bundle.** A fresh clone at HEAD builds bundle `1545f944f502`, the one the no-facts references recorded.
- **Tier 0.** 727 pass, 0 fail, 10.7 s.
- **Tier 1 at HEAD.** All six references exit 0, 388,886 cases the same, 41 s. Against the browsers' own recorded predictions (`--against=browser`) it is also 388,886 the same.
- **Ledgers.** All six rebuild byte-identically from the line recordings with `ledger.ts build`. The headline table recomputes from the entries exactly:
  - rates, and the single open row `c-a37545c096e939be`;
  - the 19 Firefox residual rows;
  - exact and not-exact counts (816, 720, 312, 286, 125, 125);
  - history-dependent counts (313 and 314; 279 and 283);
  - passing cases with differing values or rect counts (0, 6, 404, 30).
- **Known tail.** `known-tail.ts check` reports 62 items, 589 named cases, 24 rules.

## Adopted seeds
- **Checks.** All 26 checks of an adopted seed against the runs it was seeded from pass, with the environment check on: 6 lab gate, 6 tier 2 and 14 tests gate. Each ran on real counts (for example 65,864 Chrome ids, and 313 Firefox history-dependent cases).
- **Coverage matrix.** The freezer's `check-adopted.sh` passed the no-facts `coverage.json` to the facts checks too. I used each configuration's own, and it still passes.
- **Attributions.** The 26 seed records hold 2,251 lost pairs and none lacks an attribution.
- **`against` paths.** All 26 point at files that exist only in git history, as the freeze report disclosed.

## Tier 2 at HEAD
One forward run per browser in the headline configuration, one browser at a time, against the frozen ledgers and the adopted seeds:

| Browser | Exit | Cases | Time |
|---|---|---|---|
| Chrome | 0 | 66,685 | 75 s |
| Firefox | 0 | 63,771 | 65 s |
| webkit-host | 0 | 63,987 | 96 s |

- All three show 0 status transitions and 0 exact-value transitions.
- Differing predicted values are unchanged: 266, 301 and 0. Rect counts are unchanged too.
- Limited values rose in 0 cases.
- The seed gates pass in all three.

## Plants
Plants are saved as patches in `plants/`. Tier 2 ran in forward order on the cases tier 1 named, except where the table says otherwise.

| Plant | Tier 0 | Tier 1 | Tier 2 |
|---|---|---|---|
| **Semantic, Blink**: the keep-all rule is off (`breaks.ts`) | 1 fail (break oracle) | exit 1; 935 changed without facts, 782 with; 889 first differ at `lines[].end` | exit 1; 3,092 from pass (lineCount 442, breaks 1,323, widths 1,323); 1,275 exact → not exact |
| **Semantic, Gecko**: the soft hyphen's width is left out of the fit test | passes | exit 1; 648 and 652 changed at `lines[].end` | exit 1; 1,741 from pass; 387 exact → not exact |
| **Semantic, WebKit**: the 1/64 px is left out of the available width in both builders | passes | exit 1; 1,541 changed, 6,528 new questions | exit 1; 20,430 from pass; 6,152 exact → not exact |
| **Exact-value only: the critic's three plants, remade** | 4 fail (each fix has its own test) | exit 1, the critic's counts exactly: Chrome 567 at `hangWidth` plus 71 with other questions; Firefox 28; webkit-host 307 | see the next table |
| **Exact-value only: center alignment rounding** (Blink and Gecko `trunc` → `ceil`; WebKit `f32(x / 2)` → `floor`) | 727 pass, blind | exit 1; Chrome 508, Firefox 382, webkit-host 701, all at `alignOffset` | see the next table |
| **`src/paint.ts`: aligned lines painted at the start** (center, end, right and left all painted at start) | 727 pass | exit 0 on all six, nothing routed | full forward run: Chrome exit 0, 0 transitions of 66,685; Firefox exit 0, 0 of 63,771; webkit-host exit 1 on 3 painter passes |
| **`src/paint.ts`: word spacing +1px on every painted line** | 727 pass | exit 0 on the three no-facts references (the only ones checked) | Chrome on `smoke`, `runs` and `ws` (3,898 cases): exit 1, 2,077 painter passes lost |
| **No-op**: equivalent rewrites in the three engines | 727 pass | exit 0 on all six | not run (nothing to route); the row below has these rewrites in the tree |
| **No-op plus a comment in `src/measure/canvas.ts`** | 727 pass | Chrome exit 3, 0 changed, 65,384 (no facts) and 4,695 (facts) storage-sensitive cases routed; Firefox and webkit-host exit 0 | Chrome's routed cases: exit 0, 0 transitions, 77 s; Firefox and webkit-host on the smoke and development sets: exit 0, 0 transitions |

Exact-value plants in tier 2, as exact → not exact cases and exit code per configuration:

| Plant | Browser | No facts | Facts |
|---|---|---|---|
| Critic's three | Chrome | 10, exit 1 | 61, exit 1 |
| Critic's three | Firefox | 0, exit 0 | 5, exit 1 |
| Critic's three | webkit-host | 8, plus 54 widths pass → unobserved, exit 1 | 47, plus the same 54, exit 1 |
| Center rounding | Chrome | 49, exit 1 | 489, exit 1 |
| Center rounding | Firefox | 0, exit 0 | 366, exit 1 |
| Center rounding | webkit-host | 184, exit 1 | 506, exit 1 |

- **Fix 2 works.** Exact-value regressions now show under `exact:` in tier 2 and block. The critic's plants match the freeze report's 61 and 10 for Chrome and 5 and 0 for Firefox. My center plants are purely exact-value: no metric leaves pass in any browser.
- **Firefox without facts stays blind.** Both exact-value plants exit 0 there:
  - The critic's plant shows only as limited values going 0 → 89 in 5 cases.
  - The center plant shows only as limited values going 84 → 9,746 in 382 cases, which is every changed case.
- **The aligned-lines painter plant passes every tier in Chrome and Firefox.** webkit-host's 3 catches are accidental. They are `rule/text-align` cases `c-28fb8940045f363a`, `c-886c7c3eb1bd0cb0` and `c-df185722d66629af`: a 208.65px line ending near x 99,999.99, where float32 rounding of the extent moved.
- **Tier 0 alone is thin.** It missed the Gecko and WebKit semantic plants and all three center plants.

## Fix 1
- **Code.** `font-checks.ts` creates contexts in one place only, `width()`, which takes its text rendering from `checkTextRendering(engine)`. Blink gets `optimizeLegibility`, as `shape.ts` `styleContexts` does.
- **Source reading, opened at the pin.**
  - `font_description.cc:308-331`: the cache key holds `text_rendering_` and `EffectiveFontSize()`, not the specified size.
  - `font_platform_data_mac.mm:170-178`: opsz comes from the specified size.
  - `canvas_rendering_context_2d_state.cc:406`: Canvas puts `textRendering` into the font description.

  So the checks no longer share a cache key with default DOM text.
- **Old context planted.**
  - Both of fix 1's unit tests fail.
  - Tier 1 sees all 66,685 Chrome no-facts cases, and 160 facts cases, ask a new question (exit 3).
  - webkit-host and Firefox are unchanged.

  So the Chrome references hold the fixed recipe.
- **Mechanism probes.** Run again in pinned Chrome 153.0.8010.50 at DPR 2, each in a fresh process:
  - `font-check-legibility` and `font-check-legibility-word` leave DOM `system-ui` text at the clean rule's width at 8, 10, 13 and 16px.
  - `font-check-word` still gives 71.2421875px for 81.125px at 16px.

## Still not visible to the tiers
- **Painted positions.** Alignment and x inside a painted line aren't compared: tier 2 checks only the extent's width and wrapping. No path rule routes a `paint.ts` change out of tier 1.
- **Exact values in Firefox without facts.** `exact` is vacuous there because nearly every value is limited.
- **Measuring code in Chrome.** Any change under `src/measure` or `engines/blink/shape.ts` sends nearly every Chrome no-facts case to tier 2, a no-op included. There, tier 1 is only a router.
- **The capability check's own context.** `src/measure/canvas-checks.ts` still measures `16px serif` at text-rendering auto in Blink. That is fix 1's mechanism for serif page text whose zoomed size is 16px. Times has no opsz axis, so nothing moves on this Mac. No tier calls `detectEngine()`.
- **Not run here:**
  - both orders;
  - the facts configuration at HEAD in full;
  - giants;
  - installed Safari;
  - any device pixel ratio but 2 on this one Mac.

  Firefox's history-dependent set was stable today and wasn't on the critic's fresh set.

## Housekeeping
- **Rows.** My 225 row files are compressed with zstd (14 GB → 1.2 GB), with the originals in the Trash. Per-case files, ledgers and `transitions.json` are kept.
- **Browser jobs.** None failed or stalled, and no lock or browser process is left running.
