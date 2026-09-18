# Round 4: critique (2026-09-18)

Paths are relative to `~/github/pretext-rebuild`. My work is in `.artifacts/ceiling-20260917/critic-r4/` (`tools/`, `honesty/`, `fresh/`, `tier1/`, `tier2-plant/`, `tier2-legibility/`, `isolate/`, `probes/`, `rescore/`). Fresh sets are in `.artifacts/lab/fresh/<browser>/critic-r4-1/`. I edited no repository file and ran no git command in the main tree. Planted changes lived in a scratch clone (`git clone --local` into the session scratchpad, with `.artifacts` and `node_modules` linked), run against the evaluator's private replay pack through links.

Library: HEAD 7645962, whose `rebuild/src` and lab bundle equal the evaluated 3c17016. Browsers: pinned Chrome 153.0.8010.50, Firefox 156.0, webkit-host on WebKit 22625.1.29.11.27, and Firefox 140.16.0esr for one probe. Installed Safari was not run.

## Verdict

- **Adopt the staged seeds** (tier 2 `staged-round4c-sets`, lab and tests `staged-round4-{no-facts,facts}`). Every lost pair has an attribution, and the 266 I checked mechanically are true.
- **Freeze the reference after two fixes**, listed under "Fix first". Neither moves a status. The first changes what Chrome asks Canvas, so it must come before the official recording.
- The evaluation's numbers reproduce. Its "two readings" of the headline zeros are honest, and my fresh set repeats them.

## My fresh set (seed `critic-r4-1`, headline configuration, both orders)

Kinds: runs 7,738, ws 3,043, policy 4,427, rich-prewrap 3,896, family-widths 5,656 / 5,260 / 4,679. **Suite-kind cases: 0 in every browser** (the pool is empty), so I used the evaluator's shape, `--repeat=3 --widths-per-paragraph=2`.

| | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| Cases | 24,728 | 24,364 | 23,783 |
| lineCount / breaks / widths / painter | 99.78 / 99.66 / 99.40 / 98.77% | 99.85 / 99.63 / 98.97 / 97.19% | 99.83 / 99.62 / 99.61 / 95.60% |
| Prediction failures | 226 | 332 | 178 |
| Without a covered explanation | 0 | 0 | 0 |
| The same cases with the lab's facts (a cross-check I added) | 10 open | 0 open, 15 residual | 0 |
| Passing cases with a wrong predicted value, either configuration | 0 | 0 | 0 |
| History-dependent, left out | 0 | 209 | 123 |

- Chrome's 10 with facts: 9 are the known observation class of a span holding only a trimmed space (`c-37d8aba59cf4bf1e`, `c-46ea681d8c17a24d`, `c-4dbf81710e0ad9f5`, `c-6768e607d4bf9c20`, `c-788fd90444342f50`, `c-8576d3231bda9d2f`, `c-bd483e5bb3744d5c`, `c-ce5569a93392074d`, `c-e3b12a26d8f93c2a`); 1 is a lam-alef ligature at an emergency break (`c-2e34aec7382cef8f`, 4307 units predicted, 4138 native). Without facts all 10 read covered by position (`glyph-clusters`, `optical-size`).
- Firefox's 15 residual rows are all the 1 au class by signature (`c-0ac1d02d25a64836`, `c-1a02722e1a804e91`, `c-23c126c5056c6545`, `c-516764cc99e8e3d9`, `c-ad2ac99b25213556`, `c-dcc0ee4415760dd8`, `c-0a1ad9a674ef7566`, `c-18ef08732311c4d8`, `c-1c362a246a6b12fa`, `c-42d9bb45fb59bbed`, `c-7238c39f65d4221c`, `c-b61b1c94b8f9af0a`, `c-e2e99ecad639a6b9`, `c-f21780caade0b69d`, `c-fd19a74a194892f4`); without facts `optical-size` covers them by position.
- No new class. No row is open in reverse order only.
- webkit-host's line counts and breaks sit about 0.1 point under the evaluator's (99.93 / 99.79%). The excess is `page-history` rows that fail the same way in both orders, so the two-order rule doesn't set them apart; see "Conditions".

## Fix first

### 1. The font checks measure under the DOM's font cache key

`src/measure/font-checks.ts` makes its contexts with `textRendering: 'auto'`. The engine's own contexts use `optimizeLegibility`.

- **Source, read at the pin.** `FontDescription::CacheKey` holds `text_rendering_` and `EffectiveFontSize()` (the zoomed size), not the specified size (font_description.cc:308-331). `opsz` is set from the specified size for any variable font with the axis, not only the system font (font_platform_data_mac.mm:170-178: "Do not use font size here, but specified size in order to account for zoom").
- **Consequence for a named font with an opsz axis at DPR 2.** Check 4's context at the zoomed size has the key DOM text of that family and size has.
  - DOM first: the check gets the DOM's font, the advances look linear, the fact is learned `false`, the engine measures at the zoomed size with another optical size, and no gap is reported. That is a wrong width without warning.
  - Library first, which is how an app measures: the DOM text takes the check's font, so the library changes the page's own rendering.
- **Evidence.** The mechanism is already probed with the system font (`probes/measure-first.ts` "font-check-word": 16px DOM text 71.24px instead of 81.125px). My probe (`probes/font-check-side-effects.ts`, each case alone in a fresh process) found no DOM change on this Mac: `ui-serif`, `ui-sans-serif`, `ui-rounded`, `ui-monospace`, `-apple-system`, `emoji` and `fangsong` don't resolve in Chrome 153, the skip rule holds for `system-ui` and `BlinkMacSystemFont`, and no installed named family has the axis. So the defect is proven from source and mechanism, not observed. Inter, Roboto Flex and Source Serif 4 have the axis.
- **The fix is one line** (`textRendering: 'optimizeLegibility'` in `width()`). Tried in the scratch clone:
  - tier 0 passes;
  - tier 1: all 66,685 Chrome no-facts cases and 160 Chrome facts cases ask a question the record lacks (the replay keys contexts by assigned settings), webkit-host 63,987 the same, Firefox asks nothing;
  - tier 2, Chrome no-facts, forward, 78 s: 0 status transitions, and `compare-sets.ts` finds no native observation, prediction or painted line that differs on 66,685 cases.
- **Why now.** After the freeze the same line costs a Chrome re-record and re-freeze in both configurations. Order: fix, record Chrome again (about 6 minutes), pack, freeze.

### 2. Tier 2 can't see a regression of exact values

I planted one semantic regression per engine, and separately one no-op rewrite per engine.

| | Chrome | Firefox | webkit-host |
|---|---|---|---|
| Planted | the justify and hang walk stops at a close tag again | a preserved newline no longer ends the line like a br (4c's G2 undone) | every display box of a span keeps the start edge (4b's W1 half undone) |
| Tier 1, no-op rewrites | 0 changed, exit 0, both configurations | 0, exit 0 | 0, exit 0 |
| Tier 1, the regression (same counts in both configurations) | 567 changed at `geometry.hangWidth`, 71 ask other questions, exit 1 | 28 changed (`geometry.hang` 18, `align` 10), exit 1 | 307 changed (`hasStartEdge` 251, box `width` 56), exit 1 |
| Tier 2 transitions on those cases, no facts | 638 cases: **0 from pass**; 4 widths unobserved → fail open; 9 painter moves | 28 cases: **0 transitions** | 307 cases: 54 widths pass → unobserved, exit 1 |
| Passing cases with a wrong predicted value on those cases, no facts | 0 → 9 (54 values); differing limited values 341 → 2,043 | 0 → 0; differing limited values 0 → 89 | 0 → 8 |
| The same with facts | 0 → 57 cases (1,578 values); ledger still 0 from pass | 0 → 5 cases (88 values); ledger still 0 | not run |

- Tier 1 is sharp: every change named by its first field, every no-op silent.
- The ledger's closed status set has no place for "passes with a wrong predicted value", although that count is one of the round's headline definitions and what rounds 4b and 4c spent their fixes on. With no supplied facts about 90% of values are limited (Chrome 11.8%, Firefox 8.3%, webkit-host 8.8% predicted on my set), so the wrong values hide under "limited" there as well.
- A re-architecture that changes measuring recipes will show in tier 1 mostly as "new question", which routes to tier 2, which is blind here. So this matters most exactly when the line is used.
- **Fix:** let `ledger.ts` and tier 2 carry, per case, the differing predicted values and rect counts (the per-case `facts` already hold them), print the delta with the transitions, and exit 1 when it rises. Read geometry changes in the facts configuration too. It needs no new recording. The ledger is pinned by the freeze, so it is cheapest before it.

## 1. Honesty

**Passing cases holding a wrong predicted value** (x or width; history-dependent cases and protocol rows apart; both orders agree), from the evaluation's per-case files (`tools/honesty.py`):

| | Tier sets, no facts / facts | Fresh eval-r4-1..3, no facts / facts | Giants |
|---|---|---|---|
| Chrome | 0 / 0 of 66,685 | 0 / 0 | 0 |
| Firefox | 0 / 6 (the registered Nastaliq cases) of 63,771 | 0 / 0 | 0 |
| webkit-host | 0 / 0 of 63,987 | 1 / 12 | 0 |

These equal the evaluator's counts. Sealed-4 has no per-case files (scored once, counts only), and I did not score it again.

What those zeros leave out:
- **Rect counts**, which the scorer calls predicted by definition, differ in passing cases: Chrome 404 tier cases in each configuration (392 of 1,352 `rule/wbr-elements` cases, for example `c-001fcd8457f501c5`: element 0 has 3 native rects and 2 expected; and 12 `rich-prewrap/nested`), 117 to 124 per fresh set. webkit-host has 30 tier cases (`rule/hanging-white-space` 12, `rule/br-elements` 12, `suite/tail` 4, `suite/mixed` 1, `rich-prewrap/nested` 1) and 19 to 35 per fresh set (`c-208a0aa61f43cbca`: a node with preserved spaces under word spacing reports 9 native rects, 2 expected). Firefox has 0. The 392 were the same in round 3, so this is not a regression, but CHARTER and the known tail say "12 tier cases".
- **Blink's port reports the x after a fallback-font cluster as predicted**: 14 failing tier cases (`rule/object-replacement` 10, `suite/U+FFFC/start` 4) pass lineCount and breaks and hold 2 wrong predicted values each. In `c-264ab6fc341a05d2` the space after U+FFFC is expected at x 0 and is at 16 natively. The `font-fallback` range covers U+FFFC, not what is placed after it. WebKit closed this shape in 4b with whole-line limits.
- WebKit's zero comes with the smallest claim: a line that reports a gap is limited as a whole.

## 2. Conditions new or widened since round 3

Citations I opened at the pins; each says what its owner says:
- hb-kern.hh:102-106 (the kern machine splits an adjustment between the two glyphs);
- font_description.cc:271-282 (`EffectiveFontSize` floors to 1/100 px) and :308-331 (the cache key);
- font_platform_data_mac.mm:170-178;
- gfxFontEntry.cpp:1362-1370, gfxFont.h:134 and nsFont.cpp:276-279 (no automatic opsz without `AddFontVariationsToStyle`);
- nsTextFrame.cpp:11472-11476 (`SetLineEndsInBR`);
- InlineDisplayContentBuilder.cpp:1036-1060;
- line_info.cc:275-300;
- han_kerning.cc:417-535 (read for a trace; the port's dot group of four matches it).

Firing on passing lines of my fresh set, no facts → with facts (lift over prediction failures):

| Engine | Condition | Passing lines | Lift |
|---|---|---|---|
| Blink | `unsafe-to-break` (4b's kerned pairs with `pairKerning` unknown) | 9.87% → 3.32% | 5.2 → 0.5 |
| Blink | `script-context` | 34.0% → 18.0% | 1.2 → 0.9 |
| Blink | `glyph-clusters` | 8.47% → 2.08% | 1.8 → 1.6 |
| Blink | `optical-size` (unknown axis, and 4b's scaled system font recipe) | 6.78% → 0.42% | 0.4 → 0 |
| Blink | `in-word-prefix` / `float32-precision` / `font-fallback` | 1.21% / 1.11% / 0.92% | 0.35 / 0.38 / 47 |
| Gecko | `optical-size` | 99.82% → 0.09% | 1.00 → 493 |
| Gecko | `in-word-prefix` | 1.14% → 0.66% | 53 → 49 |
| WebKit | `simplified-measuring` | 29.96% → 11.58% | 0.9 → 1.5 |
| WebKit | `page-history` | 6.21% | 7.4 |
| WebKit | `canvas-language` | 2.29% | 13.8 |

Is the named difference the cause? Mechanical checks over every covered failure of my set, not five:
- **Blink `unsafe-to-break`**: 118 of 118 rows it touches (94 alone) pass or go unobserved once `pairKerning` is supplied on the same case. Read: `c-fb8dc95f4e460db5` (`LYAY` before hanging spaces in Times New Roman, 6240 against 6288 units) and `c-6106dc674a8cf5c0`.
- **WebKit `page-history`**: I isolated all 90 fresh cases whose failure it touches (`sharded.ts --isolate`). 82 pass every metric alone in a fresh process. The other 8 (`rule/controls`, for example `c-1143d3b9677ac5c7`) fail widths alone and also sit under `control-character-width`, their real cause. None is covered by `page-history` alone without being history.
- **Gecko `optical-size` alone**, 76 rows: 61 are `rule/system-fonts-and-sizes`, where optical sizing is the cause and stays the cover with facts; 15 are the 1 au class, covered by position.
- **Gecko `in-word-prefix`**: 110 of 163 rows pass with `pairKerning`; 53 stay covered.
- **WebKit `canvas-language`**, read: `c-5f146d8fd76b57fa` (Hangul and `中` under `lang=ko` in Arial, 57.52 against 55.36px) and `c-743dad6e368aeb5b` (`测试` in Hiragino Sans under `ja`). The range is exactly the characters a language-chosen fallback draws.
- **Blink `font-fallback` on U+FFFC**, read: `c-264ab6fc341a05d2` (16px natively, measured as U+200B).
- **Cover by position without facts, as the evaluator says:** Blink `glyph-clusters` alone is 9 of 11 open with facts; `optical-size` alone is 1 of 1. The half-width `。` before `」` (`c-571b183504971c3f`: the line is 39px predicted and 32.5px native, a predicted value with facts) reads "covered by script-context" without facts. HanKerning doesn't read script lookups, so that cover is positional.

## 3. Runtime font checks

- **Learned facts against the lab's table.** I replayed `prepareParagraph` offline over every recorded tier case with no supplied facts, at each case's own size, weight, style and language (`tools/learned-facts.ts`). Chrome 65,918 cases and webkit-host 63,687: **0 disagreements** on primaryFamily, mapsHyphen, monospace, opticalSizeAxis and joining. Unknown answers are where a check isn't asked (no soft hyphen, no joining text) or can't tell (Geeza Pro, Apple Color Emoji, the system font). Gecko is asked nothing.
- **A check that can change the DOM's layout:** check 4, see "Fix first" 1. The other checks measure at 16px, which collides only with DOM text whose zoomed size is exactly 16px (8px CSS at DPR 2). At 8px the system font showed no change; my reading is that the font's opsz range clamps both sizes to one value.
- **Cost**, from the evaluation's recorded calls (`tools/check-cost.py`):
  - Chrome: 13.1 check calls a paragraph (13.1% of predict-phase calls) in 8.3 of its 10.6 contexts.
  - webkit-host: 11.7 calls (37.0%) in 5.8 of 7.7 contexts.
  - Firefox: 0.
  - Per declaration in my probe at DPR 2: 10 calls for a named Latin family, 4 for `system-ui`, 2 when nothing resolves. The owner's figures: 9.5 (Latin) to 18.9 (every check) in Chrome, 9.4 to 13.2 in webkit-host.
  - Every paragraph pays it again, because a measurer lives one paragraph. Most of a paragraph's canvases are check canvases.

## 4. Canvas capability checks

Probe `rebuild/probes/canvas-checks.ts`, run again in four builds:
- Firefox 140.16.0esr: **unsupported**, naming "the context attribute lang", "a letter spacing of 0.001px that adds 0px to each character's width (here it adds 0.001041412353515625px)" and the moved ink box.
- Firefox 156.0, Chrome 153.0.8010.50 and webkit-host: supported.
- `canvas-checks.ts` holds no browser or version name. The engine still comes from the user agent (registered heuristic).
- Planted `if (false && …)` in the check: 2 unit tests fail, so tier 0 guards it. No other tier calls `detectEngine()`.
- For the tail: `detectEngine()` answers supported for Chrome or Firefox on any OS, while every pinned rule and table is macOS's.

## 5. Tiers

- All six of the evaluator's recordings replay exactly at HEAD: 388,886 cases the same, 4 to 9 s a reference.
- Planted changes: the table under "Fix first" 2.
- **Tier 1 passing while a prediction changed:** a semantic change in `src/paint.ts` (letter spacing + 1px on every painted span) gives 66,685 of 66,685 the same, exit 0. The README says the painter is outside tier 1, but no path rule routes a `paint.ts` change to tier 2 the way `STORAGE_PATHS` does for strings.
- The string storage rule applies only against a frozen reference, not with `--against=browser`. Fine for the official flow.
- **Measure first:** the evaluator's comparison logs hold what it reports. Chrome and webkit-host have 0 differing native observations, predictions or painted lines on smoke and development in both configurations; Firefox has 120 native and 121 predictions, all in suite-sample part 2. The sets hold no named opsz font, so they can't show "Fix first" 1.
- **Coverage limits of the frozen line, for the tail:** every case is at DPR 2 on one Mac (`run.ts` has no option for another ratio; at DPR 1 Blink's check 4 and its size ratio never run, and Gecko's app units per device pixel differ); giants are in no tier.

## 6. Process

- **Sealed-4** was generated at 09:41, after the last library commit (3c17016 at 09:34), by the evaluator; no owner's tool names it. `sealed4-hang.py` filters its policy file mechanically and prints ids and positions only.
- **Font facts as result tables:** `lab/font-facts.json` and `font-facts.ts` didn't change in round 4.
- **Name-keyed code in the round 4 diff:** the CSS keywords Blink itself keys on (`system-ui`, `BlinkMacSystemFont`), WebKit's settings defaults (FontGenericFamilies.cpp) and the generic keyword list. No font-name heuristics.
- **Count-chosen items** are the registered ones: WebKit's suffix-difference shares, `hasLanguageDependentFallback`, Blink's cluster rule. WebKit's whole-line limit was chosen over the ranged rule after counting 109 wrong values; it errs toward claiming less.
- `aggregate/seed-records.json` shows every lost pair as "unattributed": it was written before attribution ran. The staged records themselves are complete.

## 7. Re-score and traces

- **Re-scored** `eval-r4-2` part-02 forward, no facts, with `--native-compare` against reverse: per-case files byte-identical in the three browsers (8,367 / 8,276 / 8,107 rows).
- **Rows without a covered explanation, traced:**
  - `c-2e34aec7382cef8f`: lam-alef at an emergency break, known class.
  - `c-26737b4c93d3c46b` and `c-571b183504971c3f`: `。` before `」` is 6.5px natively in 13px Hiragino Sans under `lang=en` and 13px predicted, on its own line and beside the bracket. An engine defect with no gap; its cause is not found, and the port's glyph-type grouping matches han_kerning.cc.
  - `c-37d8aba59cf4bf1e`: a span of collapsed spaces reports an element rect at x 211.92; every code point is on the right line.
  - `c-6fe680146b646fa8`: one LayoutUnit beside a soft hyphen, 11797 against 11798, without facts only.
  - `c-2871f9976509f924`: `d` after preserved spaces across a box end with a negative margin in an RTL block reports rects on two lines; the line count passes; an observer class.
  - `c-9255bce06885eb91`: regional indicators split across spans; the second flag is 18px predicted and 36px native; known convertible class.
  - Firefox's 15 residual rows: all 1 au by signature.
- **Covered rows, backed:** the 118 kerned-pair rows by the supplied fact, the 82 `page-history` rows by isolation, the 61 system font rows, the two `canvas-language` rows, the U+FFFC row, and `c-e65e747db195387e` (a control character float32 step, 66.95999908 against 66.96000671px).
- **Not backed by cause, only by position:** the 9 trimmed-space rows, `c-2e34aec7382cef8f`, the 15 Firefox 1 au rows, `c-571b183504971c3f`.

## 8. Seeds and the known tail

**Seeds.**
- Every staged record's lost pairs carry an attribution, written by rule.
- I checked the largest group against the reference ledger: in Chrome's no-facts tier 2 record, all 266 claims that "the round 3 library already failed a prediction metric on this case" are true (246 painter, 14 lineCount, 6 breaks).
- The no-facts lab and tests seeds lose pairs against adopted seeds that were recorded with facts. The records say so, and the like-for-like facts records lose exactly what round 3's lost.
- Firefox's 546 lost pairs are decision 2's measured cost.
- **Adopt them.** Neither fix moves a status.

**Freeze.** After the two fixes. Record Chrome again in both configurations after fix 1. Firefox's and webkit-host's recordings stand: their replay under the fix is identical.

**Known tail: add or correct.**
1. `lab/blink-element-rects-of-spans-without-a-box-fragment`: by rule `rule/wbr-elements` rect counts, 392 tier cases, and correct CHARTER's "12 tier cases".
2. New, WebKit rect counts in passing cases: `c-0584f659aa240683`, `c-2831e2b52af7ff89`, `c-0560e2fd253c8ca1`; fresh `c-208a0aa61f43cbca`, `c-222122a503c72e94`, `c-bdaefddc177645af`.
3. New, Blink port x after a fallback cluster: `c-264ab6fc341a05d2`, `c-312094430e8c9ea9`, `c-ad141fe451916fa9`, `c-79da2baaa3be78f7`, `c-24142053a8647b70`, `c-49e1db5b0d8dfb1f` (14 tier cases).
4. `gecko/process-font-fallback-state`.
   - My set had 209 history-dependent Firefox cases (`runs/split-word` 87, `word-spacing-spans` 57, `span-at-space` 33, `letter-spacing-spans` 32), against 0 on each of the evaluator's three sets from the same generators.
   - In file order 199 of them fail a prediction metric, in reverse 6. Counted, forward widths would be 98.21% instead of 98.97%.
   - Examples: `c-33f612e85fae1f04`, `c-42e7ed5ef76742ff`, `c-52224305a9d1969d`, `c-5749b85240285a04`.
   - The Firefox line is for runs where this state didn't occur.
5. `webkit/page-history`: the 82 cases that fail in both orders and pass alone (`isolate/webkit-part-0{1,3}.ids`). The two-order rule doesn't mark them, which is why webkit-host's rates move about 0.1 point between sets.
6. `blink/range-rects-hang`.
   - The signature is wider than the ledger's. My reverse job stalled in a round trip with no case between half an em and one em wide.
   - Candidates: `c-a3d4baab0945f957` (2.5 em, keep-all with break-word, `？」` at the end) and `c-a3deda1d0803dca9` (2px).
   - I set 32 aside, listed in `fresh/chrome-part-02-set-aside.ids`.
7. `lab/replay-blind-spots`: `src/paint.ts` has no path rule.
8. New: the OS is no part of the environment, and no case runs at another device pixel ratio.
9. Members from my set: `blink/arabic-at-shaping-edges` `c-2e34aec7382cef8f`; the 9 trimmed-space ids; `blink/cluster-split-across-spans` `c-9255bce06885eb91`, `c-d15651d1ef6b547b`; the 15 Firefox 1 au ids.
10. `blink/font-check-contexts-share-the-dom-font` closes with fix 1. `blink/pages-with-text-rendering-legibility` stays.

## Gecko's two unmerged alternatives (their owner's numbers)

- **`r4-gecko-alt-synthetic-bold` (c32a60a).**
  - It confirms synthetic bold from Canvas at two sizes for Emoji-property clusters in non-400 runs.
  - All 9 open fresh rows pass, nothing else moves on 15,386 cases, and it costs 0.1 more calls a paragraph.
  - The class stays, because symbols without the Emoji property aren't reached.
- **`r4-gecko-alt-opsz-default` (d9ad391).**
  - Where `opticalSizeAxis` isn't given, the documented default decides: true for the system font keywords, false for a named family.
  - `optical-size` is reported in 0 development cases instead of 24,488, and 95.4% of values are predicted instead of 6.5%.
  - It would remove Firefox's cover by position (on my set, the 15 residual rows would show as residual in the headline) and make the headline honesty count mean something in Firefox.
  - Risk: a named variable font with an opsz axis would measure wrong without a gap. Two unit tests fail on the branch.
  - Both remain the maintainer's call. Neither changes the verdict above.
