# Round 4 evaluation (2026-09-18): the correctness line

All paths are under `~/github/pretext-rebuild`. My work is in `.artifacts/ceiling-20260917/evaluate-r4/`: `tools/`, `tier1/`, `tier2/`, `aggregate/`, `conditions/`, `sealed4/`, `giants/`, `mf/`, `safari/`, `gates/`, `replay/` and `known-tail/`. Fresh sets are in `.artifacts/lab/fresh/<browser>/eval-r4-{1,2,3}/` (`runs-no-facts/`, `runs-facts/`).

- **Library:** 3c17016 (round 4c on r4b-merged 7567cf3); the orchestrator had committed it before my first job.
- **Bundles:** all 464 successful run records hold one bundle per configuration, `68f7adaf4423…` without facts and `f5f6654c04cb…` with.
- **Browsers:** pinned Chrome 153.0.8010.50, pinned Firefox 156.0, webkit-host on WebKit 22625.1.29.11.27, and installed Safari 27.0 as a spot check. Scorer 7, DPR 2.
- **Rows:** compressed (420 files); the folder is 4.0 GB.

## 1. The correctness line

Headline configuration (no supplied font facts), three unseen fresh sets a browser, both orders:

| | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| Fresh cases | 75,132 | 74,200 | 72,542 |
| lineCount / breaks / widths / painter | 99.77 / 99.65 / 99.44 / 98.73% | 99.86 / 99.68 / 98.91 / 97.08% | 99.93 / 99.79 / 99.59 / 95.74% |
| Prediction failures per 10,000 | 89 | 138 | 59 |
| Open rows per 10,000, by the scorer | 0.27 (2 rows) | 0 | 0.28 (2 rows) |
| Open rows on the same cases with the lab's facts | 4.1 (31 rows) | 0.8 (6 rows), plus 5.7 residual (42) | 0.28 (2 rows) |
| Passing cases with a wrong predicted value | 0 | 0 | 1 (12 with facts) |
| History-dependent cases, left out | 0 | 0 | 383 |

**Why two readings.** Without facts some conditions fire widely enough to cover failures they don't cause, because the scorer checks where a range is, not what its reading says.
- Gecko's `optical-size` fires on 99.7% of passing lines at lift 1.00, because Firefox's Canvas can't show an opsz axis.
- Blink's `script-context` fires on 31.9% (lift 1.64) and `glyph-clusters` on 11.0% (lift 1.60).
- 30 of Chrome's 31 rows and all 48 of Firefox's (6 open, 42 residual) read covered without facts.
- Open in either configuration: Chrome 33 rows (4.4 per 10,000), Firefox 6, webkit-host 2.

**Fresh open rows by set.**

| Browser | No facts (sets 1 / 2 / 3) | With facts (sets 1 / 2 / 3) |
|---|---|---|
| Chrome | 0 / 1 / 1 | 7 / 14 / 10 |
| Firefox | 0 / 0 / 0 | 0 / 3 / 3 (residual 18 / 12 / 12) |
| webkit-host | 0 / 1 / 1 | 0 / 1 / 1 |

No row is open in reverse order only. No new line-breaking class appeared in any engine.

**What the fresh prediction failures are made of, no facts.**
- **Chrome (672):**
  - `font-fallback`, 302: U+FFFC and clusters split across spans.
  - `unsafe-to-break` alone, 249: `pairKerning` unknown.
  - About 120 more: stand-ins inside shaping groups and Arabic at shaping edges.
- **Firefox (1,026):** `in-word-prefix` 506, `font-size-quantization` 321, `optical-size` alone 192.
- **webkit-host (431):**
  - `canvas-language`, 155.
  - `page-history`, about 175.
  - `control-character-width`, about 80.
  - `rtl-shaping-across-inline-boxes`, 28.

**What would move the line.**
- **Supplied facts.**
  - Chrome: failures 89 → 48 per 10,000, widths 99.44 → 99.77%, values predicted 12 → 74%. `pairKerning` is most of it.
  - Firefox: failures 138 → 90 per 10,000 and widths 98.91 → 99.36% (`pairKerning`, then `coverage`). Values predicted go 8 → 98%, from `opticalSizeAxis: false` alone.
  - webkit-host: no metric moves; values predicted 9 → 14%.
- **The canvas element in Firefox** (declined) removes:
  - the 1 au class: 19 tier rows and 45 fresh rows;
  - synthetic bold: 3 fresh rows;
  - the system font loss: 192 widths, 96 breaks and 32 line counts.
- **Font loading** (out of scope): the facts without a table, units per em for a `font-size-quantization` recipe, and `joining` for fixed-pitch Arabic.
- **Not moved by any of these**, about half of each browser's failures: Chrome's fallback-font classes, Firefox's joined sides, and WebKit's `canvas-language` and `page-history`.

**Gecko's unmerged alternatives, from their owner's numbers.**
- **`r4-gecko-alt-synthetic-bold` (c32a60a).**
  - All 9 open fresh rows pass, and nothing else moves on 15,386 cases.
  - It costs 0.1 more calls a paragraph.
  - It covers Emoji-property clusters only, so the class stays.
- **`r4-gecko-alt-opsz-default` (d9ad391).**
  - `optical-size` is reported in 0 development cases instead of 24,488.
  - 95.4% of values are predicted instead of 6.5%.
  - No covered explanation is lost.
  - A named variable font with an opsz axis would measure wrong without a gap, and two unit tests fail on the branch.
  - My numbers show what it would remove: the by-position cover on Firefox's headline.

## 2. Tiers

- **Tier 0:** `bun test rebuild` gives 716 pass and 0 fail in 11 s. tsc is clean for the four projects.
- **Tier 1** against the official references (round 3's library), one check at a time, reports under `tier1/`:

| Reference | Same | Changed | New question | What it is |
|---|---:|---:|---:|---|
| Chrome, no facts | 0 | 0 | 65,351 | the font checks' questions |
| Chrome, facts | 597 | 64,392 | 362 | 64,020 differ first at `items[].runs`, 325 at a limit field, 32 in `rule/system-fonts-and-sizes` (4b's font ratio) |
| Firefox, both | 0 | 618 | 61,819 | `env.canvasElement` is gone; other measuring contexts |
| webkit-host, no facts | 0 | 0 | 62,653 | the font checks' questions |
| webkit-host, facts | 545 | 55,381 | 6,727 | 55,333 at `canvasFamily`, 35 at `hasEndEdge`, 12 in `rule/joining` |

- **Tier 2,** both orders, recorded, three browsers at once: Chrome 169 s, Firefox 168 s, webkit-host 247 s a configuration.
  - Cases: Chrome 66,685, Firefox 63,771, webkit-host 63,987.
  - Packed privately into `replay/`, all 388,886 cases replay exactly, with 0 unfaithful.
  - The recordings to pack officially are `tier2/<browser>-<config>`.

**Transitions against round 4a's reference ledgers** (read with `--allow=scorer`):

| Browser, configuration | Transitions | From pass | What |
|---|---:|---:|---|
| Chrome, no facts | 8,050 | 270 | 14 lineCount and 6 breaks in 14 cases that already failed another metric under round 3's no-facts library; 12 fail with facts too, and 2 need `ligatures`. 246 painter → unobserved on cases whose prediction was wrong before. 4 painter under a named limit. |
| Chrome, facts | 240 | 0 | gained 8 / 24 / 40 / 64 |
| Firefox, both | 5,888 and 1,003 | 550 | `rule/system-fonts-and-sizes` under `optical-size`: 32 lineCount, 96 breaks, 120 widths, 72 unobserved. 19 widths of the 1 au class. 211 painter pairs. |
| webkit-host, no facts | 1,793 | 0 | gained 35 / 113 / 244, plus 149 widths from unobserved |
| webkit-host, facts | 902 | 0 | gained 33 / 109 / 227, plus 145 widths from unobserved |

Every pass that became a failure has a covered explanation or a registered residual class. The list is in `aggregate/lost-passes-*.json`.

**Tier sets, no facts** (lineCount / breaks / widths / painter):

| Browser | development | families | held-out 09-16 |
|---|---|---|---|
| Chrome | 99.78 / 99.77 / 99.72 / 99.36 | 99.19 / 98.94 / 98.17 / 96.44 | 99.43 / 99.39 / 99.21 / 98.12 |
| Firefox | 99.91 / 99.89 / 98.15 / 94.94 | 99.53 / 98.68 / 97.07 / 92.60 | 99.89 / 99.86 / 97.08 / 92.77 |
| webkit-host | 99.96 / 99.93 / 99.89 / 95.68 | 99.80 / 99.65 / 99.09 / 95.01 | 99.81 / 99.73 / 99.69 / 85.94 |

- One open row: `c-a37545c096e939be` (Chrome, breaks).
- Passing cases with a wrong predicted value: 0 without facts; with facts, Gecko's 6 Nastaliq cases only.
- History-dependent cases: Firefox 123 development and 191 held-out; webkit-host 96, 6 and 181.
- REPORT.md holds the with-facts tables.

**Conditions** (`conditions/`). Failures covered only by conditions with lift below 2:

| Browser | No facts | With facts |
|---|---:|---:|
| Chrome | 15 | 1 |
| Firefox | 212 (all `optical-size`) | 1 |
| webkit-host | 0 | 0 |

- Blink `unsafe-to-break`: 10.0% of passing lines, lift 5.0.
- Blink `font-fallback`: 0.70%, lift 73.
- WebKit `simplified-measuring`: 20.7% without facts, lift 0.51.
- Blink's `page-history` fires on no line.

## 3. Sealed-4, giants, measure first, Safari

- **Sealed-4** (`sealed-4-20260918`).
  - Generated by `seal.ts` exactly as sealed-3.
  - Verified:
    - all 10 hashes equal SEAL.json;
    - the repository record equals SEAL.json without the seed;
    - 0 of 1,406,595 excluded ids are shared;
    - the generator sources are unchanged.
  - It holds runs 2,579, ws 1,011 and policy 1,492 cases. It has no giant and no suite case: all 238,524 suite cases are used (`tools/suite-pool.ts`).
  - Run both orders and both configurations, scored once, counts only: 0 open rows, 0 residual and 0 wrong predicted values in every browser.
  - No-facts rates:
    - Chrome 99.98 / 99.96 / 99.72 / 99.35;
    - Firefox 100 / 100 / 99.57 / 98.56;
    - webkit-host 100 / 99.98 / 99.77 / 95.57.
- **Fresh sets.**
  - They held 0 suite-kind cases in every set, so I ran `--repeat=3 --widths-per-paragraph=2`.
  - I added the rich pre-wrap kind to `fresh.ts`.
  - Per set: about 7,740 runs, 3,050 ws, 4,440 policy, 3,960 rich pre-wrap and 5,000 to 6,000 family-width cases.
- **Giants** (9 held-out).
  - All pass lineCount and breaks everywhere.
  - Firefox and webkit-host pass everything.
  - Chrome without facts fails widths on 6 of 9: 1 to 3 lines of about a thousand are one LayoutUnit off, covered by `float32-precision` and `optical-size`. With facts all 9 pass. This was the first giants run in the headline configuration.
- **Measure first** (smoke and development, both configurations).
  - Chrome (26,857 cases) and webkit-host (26,797): nothing differs.
  - Firefox: 120 native observations and 121 predictions differ, all U+1F600 after a U+FE0E request.
    - 116 are known history-dependent cases.
    - There are 0 ledger transitions.
- **Installed Safari 27.0** (`--allow-safari-frontmost`, 2-minute parts, six jobs of 42 to 179 s, every row visible).
  - `dev-all` has 25,180 cases and `families-all` 21,734. I ran no facts in both orders and facts forward.
  - 0 differing native observations, predictions or painted lines against webkit-host, which ran with `--parts-from` each Safari job.
  - Both score 99.96 / 99.93 / 99.90 / 95.54 on `dev-all` and 99.80 / 99.64 / 99.12 / 94.98 on `families-all`.

## 4. Costs

Mean `measureText` calls a paragraph, round 3 (facts) → round 4 facts / round 4 no facts:

| Engine | runs | ws | policy | dev suite sample | rule families | feature families |
|---|---|---|---|---|---|---|
| Blink | 161.0 → 161.1 / 181.2 | 98.8 → 98.8 / 115.3 | 112.8 → 112.8 / 122.9 | 114.1 → 114.1 / 119.0 | 44.4 → 44.2 / 55.1 | 50.8 → 50.8 / 57.8 |
| Gecko | 152.8 → 154.5 / 154.0 | 87.7 → 87.9 / 87.5 | 108.6 → 111.4 / 111.1 | 92.3 → 93.7 / 93.2 | 34.4 → 34.3 / 34.2 | 41.3 → 41.3 / 41.2 |
| WebKit | 40.0 → 48.6 / 72.2 | 26.0 → 32.5 / 48.8 | 23.1 → 34.5 / 42.4 | 38.5 → 18.0 / 29.1 | 10.6 → 11.5 / 25.3 | 12.3 → 12.6 / 20.7 |

## 5. Staged seeds (nothing adopted, references not frozen)

- **Tier 2 seeds:** `rebuild/tests/baselines/staged-round4c-sets/`, six files, compared with round 4a's staged seeds.
- **Lab gate seeds:** `rebuild/lab/baselines/staged-round4-{no-facts,facts}/`.
- **Tests gate seeds:** `rebuild/tests/baselines/staged-round4-{no-facts,facts}/`, with a regenerated coverage matrix (exit 0).
- Every staged seed passes its own check with the environment check on.
- Every lost pair is attributed by `tools/attribute-records.py`: round 3's attribution where the pair was lost then, else by rule from the other configuration and the reference ledger.
- **With facts,** the lab and tests seeds lose exactly what round 3's staged seeds lost:
  - Chrome: 0 lab pairs and 2 painter pairs.
  - Firefox: 5 and 12.
  - webkit-host: 4 and 16.
- **Without facts,** Chrome loses 79, 208 and 276 pairs and Firefox 100 and 167. All pass with facts: the adopted seeds were recorded with facts.
- **Tier 2:**
  - Chrome no-facts loses 270 pairs.
  - Firefox loses 546 (decision 2).
  - webkit-host loses 0.
- **Left through history dependence** (lab gate): Firefox 28 pairs, webkit-host 175 (81 pass now).
- **Left with a dropped case:** 18, 6 and 12 pairs.
- TESTS.md §9 has the table.

## Known tail

`rebuild/tests/known-tail.json` now has 59 items, 427 named cases and 23 rules. Every failing prediction row of the six tier ledgers belongs to an item (`aggregate/tail-coverage.json`).

**New from this evaluation.**
1. **`lab/blink-rect-of-a-span-holding-only-a-trimmed-space`** (existing item).
   - 26 fresh Chrome rich pre-wrap cases: open with facts, and covered by `glyph-clusters` by position without.
   - Every code point is on the right line.
   - Ids: `c-0df13485b3a02fe6`, `c-1e9e9355c90bc06f`, `c-382e54c603972772`, `c-8b91fe180c399005`, `c-de944e30c951da16`, `c-fa3a3325f1104d15`, `c-42527d91d65d32d8`, `c-4b48ed2b5796d0b2`, `c-79e993637593f69a`, `c-8e453621afc9d1a9`, `c-95b03803066c1248`, `c-a195eb8e6c64a17d`, `c-cdb798eb56bd8847`, `c-ce62a274bc8b06a2`, `c-d0fc7b5ddd8fd804`, `c-d5790e9f98c4b882`, `c-2c687125c2b149dd`, `c-5a50f90dd5db6963`, `c-5ecec4040af75883`, `c-7a11676d178ac1ec`, `c-7bd390945c42de18`, `c-7daefe44ed573dd6`, `c-8089b1e09b0b8afd`, `c-b01cacc2c5c99eb6`, `c-b2c030b8c1089435`, `c-d2d84e93f46fc221`.
   - Tier example: `c-a37545c096e939be`.
2. **`blink/han-kerning-full-stop-before-closing-bracket`** (new engine class, untraced).
   - `。` before `」` is 6.5px natively and predicted 13px, a predicted value.
   - Ids: `c-26737b4c93d3c46b`, `c-571b183504971c3f`, `c-76b22c0d56a08b5c`.
3. **`blink/arabic-at-shaping-edges`.** Lam-alef at an emergency break: `c-2ed43b0ea3b0d67a`, `c-dbc017ac8f974bb2`.
4. **`blink/soft-hyphen-line-one-unit-off-without-facts`.**
   - `c-6fe680146b646fa8`, `c-db8e5d8f353e4dfb`: the only headline-open Chrome rows. They pass with facts.
   - By rule, it also names 32 tier rows of `rule/hyphen-glyph`.
5. **`blink/no-facts-conditions-cover-by-position`** and **`gecko/optical-size-without-facts`.** The by-position cover described in section 1.
6. **`blink/giants-widths-without-facts`:** `c-66bc1953a23b79d3`, `c-98ab54a5eeff7b16`, `c-c8110fb16910a3a7`, `c-def592b648d927eb`, `c-ed7fc24c9ab52c94`, `c-f4d60d8ee5be0ec0`.
7. **`gecko/one-app-unit-class`.**
   - 19 tier rows and 39 fresh residual rows (6 probed, 33 by signature; all ids are in the file).
   - 6 open rows hold two units on one line: `c-375cc85fc7286468`, `c-8f4918e24c9ce889`, `c-a0585277e809b588`, `c-82a84ab0dbe330b0`, `c-91d3b53be9b144f8`, `c-94022fa447cc1542`.
8. **`gecko/synthetic-bold-class`:** `c-2a347f303f724329`, `c-31041374a25c754e`, `c-ce3bdf9e4d432fc0`.
9. **`lab/webkit-element-rect-width-float-step`.**
   - 13 passing cases hold one predicted element rect width one or two float32 steps off, under centring, in an RTL block, or beside a negative margin.
   - Ids: `c-cb91481c4f72e2ef`, `c-e13d8aa9e28342ab`, `c-1a389cabaa8cd733`, `c-92db96d401d33726`, `c-d3350805aba6e8be`, `c-900a17b368e9f70c`, `c-a48922607cc10d8e`, `c-04923fec3fbcfd0e`, `c-f61c804bfe74414f`, `c-48c81e6d8f5d8d7d` (also without facts), `c-aa174afdba2470ad`, `c-c4c385420cb7f558`.
   - The fix is in `lab/observe/webkit.ts`, then a new recording.
10. **`lab/webkit-code-point-rects-on-two-lines`:** `c-2871f9976509f924`, `c-e8517dd4816952ce`. Untraced.
11. **`lab/suite-pool-used-up`.**
12. **`painter/without-explanation`.**

   | Browser | Tier sets (no facts / facts) | Fresh sets (no facts / facts) |
   |---|---|---|
   | Chrome | 4 / 10 | 28 / 54 |
   | Firefox | 0 / 20 | 0 / 40 |
   | webkit-host | 24 / 25 | 31 / 36 |

   - All ids are in the file.
   - Most rich pre-wrap ones are the painted form of a last line.

**From the round 4b reports** (they weren't in the file yet).
- `blink/scaled-system-font-recipe`: `c-3ec3cd2536bf85bf`, `c-6f9d2063f8bcb5c8`, `c-c20059999b74e9ca`, `c-dd72cd90c56b7d64`, `c-56d1c38e222bf938`, `c-906c6bc491c83c9d`, `c-a52d0bfda6f53a43`, `c-f1877e45ed22478e`.
- `blink/kerned-positions-without-pair-kerning-fact`.
  - Restated as a covered class with a rule that names 390 tier rows.
  - It is no longer an "open rows" rule, which had been claiming `c-a37545c096e939be`.
- `blink/range-rects-hang`:
  - round 4b's 7 cases set aside;
  - sealed-4's one case.
- `webkit/whole-line-limits`.
- `webkit/dictionary-breaks-stand-in`: `c-865597c8631ac2ca`, `c-e2636af0c0d4c0ed`, `c-fecc7f07676530b7`.
- `webkit/page-history`: 9 named cases.
- `shared/canvas-checks-presence-only`.
- `shared/registry-and-coverage-after-round-4`.
- `blink/stand-ins-tail-in-suite-families`: `c-87e013cf240ecbdc`, `c-9f72ec9d12c60092`, `c-9af51f5066fb4970`, `c-5bba1ce400ecad74`.
- `webkit/wrong-values-in-passing-family-cases` is marked closed on the tier sets since round 4b.

**Unchanged from earlier rounds.** The remaining 40-odd items come from ROUND3-CRITIC and round 4a: U+FFFC fallback, clusters split across spans, ProbeShantell exact fit, Gecko joined sides, `font-size-quantization`, Hoefler Text tied faces, WebKit `canvas-language`, the ligature classes and others.

## Files changed in the repository

- **Documents:** REPORT.md, CHARTER.md, TESTS.md, `lab/README.md`, SHARED-CHANGES.md.
  - REPORT.md: new headlines, and "Round 4 evaluation" replaces the "Round 4a" section.
  - CHARTER.md: known deviations.
  - TESTS.md: tiers state, §1 and §9.
- **Lab tools:**
  - `rebuild/lab/fresh.ts` gains the `rich-prewrap` kind and `--config`.
  - `rebuild/lab/cases/used-ids.ts` follows dangling links into removed worktrees; the test is in `parts.test.ts`.
- **Data:**
  - `rebuild/tests/known-tail.json`;
  - `rebuild/lab/baselines/sealed-4-20260918.json`;
  - the five staging folders.

I SOLVED THE ROOT CAUSE NOT THE SYMPTOM: `seal.ts` refused because a run named a case file through a link into the removed charter worktree. The used-ids registry now follows such links. I did not switch off the missing-file check.
