# Blink (Chrome): where main wins, and what a superset would take

A **main-only case** is a case where main passes a metric (line count, breaks or widths) and the rebuild doesn't. The census found 1,710 of them in Chrome: 1,191 on line count or breaks, 592 on widths, 519 of those on widths only. That is 0.72% of 238,518 cases. Over the same cases the rebuild passes 60,034 line counts main fails.

## 0. Answers

1. **Every Chrome main-only case has one cause** (§2):

   | Cause | Cases | Evidence |
   |---|---:|---|
   | Rebuild bug, fixable from source | 524 | a Chrome rerun of a prototype (226), an offline replay (16), traces plus rules (257), suspected (25) |
   | Named gap where main's approach happens to win | 858 | prototype collateral, traces, recorded gaps |
   | History or observation artifact | 264 | census history reruns, native rects |
   | Unreachable with Canvas only | 62 | Blink source |
   | Unattributed | 2 | traced, not reduced |

   On 521 of these cases main passes line count while its breaks fail (256) or can't be observed (265). Those passes are coincidences.

2. **Main's API has features the rebuild lacks** (§3):
   - a prepare/layout split where resize makes no Canvas calls;
   - range walkers and routing lines at variable widths;
   - natural width;
   - rich inline items with atomic chips and extra width;
   - caches;
   - approximate support for any browser version.

   The rebuild's Blink interface can take variable widths and the walkers with moderate changes. Chips and padding need structural work. A layout with no Canvas calls isn't reachable for Blink.

3. **Superset estimate** (§4):
   - The source fixes plus two lab fixes bring Chrome main-only cases to about 922 (0.39%).
   - About 535 of those need a per-font fact that Canvas can't give.
   - The rest are named gaps with no known better default, and U+FFFC.
   - A strict superset with Canvas-only defaults isn't reachable. §5 says why that is the right trade.

## 1. Method

- **Case selection.** From `census/census-transitions.ndjson` I took every Chrome case with any main-only metric: 1,710 cases.
  - 146 are main-only only because main's own prediction changed in fresh sessions (census `history/chrome/history.json`).
  - That leaves 1,564 stable cases: 1,045 on line count or breaks, 519 on widths only.
- **Recording.** `record-predictor.ts` runs `rebuild/src` unchanged in Chrome 153 under the lock. For each case it records:
  - the environment;
  - every Canvas context's settings;
  - every `measureText` call that reached Canvas;
  - every `Intl.v8BreakIterator` text and its boundaries.

  It ran over those 1,710 cases (`record/`).
- **Checks.**
  - Recorded predictions equal the census rebuild predictions on 1,710 of 1,710.
  - Fresh native derivations equal the census rows on 1,710 of 1,710.
  - `replay.ts` lays every case out again in bun from the recording and reproduces all 1,710 predictions exactly.
- **Traces.** `trace.ts` replays one case and logs `LineBreaker` calls and results, Canvas strings and native rects.
- **Prototypes.** These are copies of `rebuild/src` in my artifacts directory; `rebuild/src` itself is untouched.
  - `src-exp`: HarfBuzz continuation clusters plus lam-alef as one cluster.
  - `src-exp1a`: continuation clusters only.
  - `src-exp2`: public width set to the engine width.
- **Chrome reruns under the lock, all background.**
  - The record run and `src-exp` over the 1,710 cases.
  - `src-exp1a` over the 1,710 cases.
  - `src-exp` and `src-exp1a` over the 23,396 suite cases the cluster rule can touch.
- **Classifier.** `attribute.py` assigns one cause per case in a fixed order and writes `attribution.json`.

## 2. Every Chrome main-only case, one cause

Counts per metric overlap: a case can be main-only on several metrics.

| Cause | Cases | lineCount / breaks / widths main-only | Largest families |
|---|---:|---|---|
| A. HarfBuzz continuation clusters (bug) | 226 | 178 / 80 / 18 | `maintained/corpus` 51, `cluster-v2-new` 40, `prefix-cap-control` 40, `cluster-v1` 34, `chromium-script-spacing` 23, `restart-next-word` 18 |
| B. Lone U+202F measured without letter spacing (bug) | 159 | 56 / 49 / 105 | `chromium-script-spacing` 137, `maintained/kinsoku-units` 22 |
| C. Canvas string crosses a script segment edge (bug) | 98 | 20 / 20 / 84 | `following-space-scope` 98 |
| D. Public width is a logical painted extent (bug) | 16 | 0 / 0 / 16 | `physical-window-terminal-seam` 12, `ideographic-source-edge` 4 |
| E. Zero-width characters at joined Arabic edges (suspected bug) | 25 | 25 / 2 / 0 | `accepted-r` 10, `U+0009/*` 4, `space` 3 |
| F. Lam-alef as one cluster is a font fact (gap) | 274 | 76 / 252 / 0 | `joined` 190, `joined-plain` 34, `space` 20, `mixed` 17 |
| G. Joining model in Geeza Pro fallback (gap) | 261 | 83 / 85 / 140 | `following-space-context` 84, `following-space-scope` 38, `joined` 33, `cross-item` 27 |
| H. Which glyph carries a pair adjustment (gap) | 196 | 93 / 99 / 108 | `following-space-context` 60, `following-space-scope` 56, `mixed` 22, `ligature-thresholds-v3` 15 |
| I. Script of Common punctuation (gap) | 101 | 86 / 38 / 0 | `mixed` 48, `raw-context` 16, `physical-window-terminal-seam` 10 |
| J. Joining edges in OpenType fonts (gap) | 26 | 26 / 4 / 3 | `joined` 20, `space` 6 |
| K. Main's prediction depends on page history | 146 | 131 / 27 / 0 | `raw-context` 34, `physical-window-terminal-seam` 30, `hidden-control-spacing` 20, `source-shaped-arabic` 20 |
| L. Hyphen drawn, soft hyphen rect empty (observation) | 118 | 0 / 0 / 118 | `following-space-scope` 86, `following-space-context` 18, `accepted-r` 14 |
| M. U+FFFC (unreachable) | 62 | 62 / 12 / 0 | `U+FFFC/middle` 32, `/start` 16, `/end` 14 |
| Unattributed | 2 | 2 / 2 / 0 | `ideographic-source-edge` 2 |

### 2.1 Rebuild bugs fixable from source (524)

**A. HarfBuzz continuation clusters: 226 cases, confirmed by a Chrome rerun.**

- **Engine.**
  - HarfBuzz flags every mark as a continuation, and so are ZWJ with a following pictograph, emoji modifiers, a second regional indicator, U+FF9E–U+FF9F and tags (hb-ot-shape.cc:471-585; hb-ot-layout.hh:246-249).
  - `hb_form_clusters` merges each continuation into the cluster before it. This happens even after a soft hyphen, ZWSP, U+2060 or U+034F, where Unicode grapheme rules put a boundary.
  - Blink gives a character that isn't a cluster base the cluster's position, and never marks it safe to break before (shape_result.cc:2113-2200 `ComputePositionData`, 2261-2323 `CachedOffsetForPosition`).
- **Port.** It uses ICU grapheme starts where Blink uses HarfBuzz clusters:
  - the safe test (shape.ts:322);
  - positions (shape.ts:390);
  - the RTL x positions in `offsetForPosition` (shape.ts:527).
- **Example.** `c-08ead50c71a1abcf`: `a` SHY U+0301 `b` in Courier New 16px, letter spacing −4, width 1px, pre-wrap.
  - Native: `[a][SHY U+0301][b]`.
  - Rebuild: `[a][SHY + hyphen][U+0301][b]`.
- **Prototype `src-exp1a`.** About 40 lines:
  - a `clusterStarts` array (types.ts, index.ts `harfBuzzClusterStarts`);
  - `passesSafeTest` and `groupPrefix16` use cluster starts;
  - the RTL x position takes the cluster's left edge.
- **Chrome rerun.**
  - It resolves all 226 and loses no metric on the 1,710 cases.
  - The collateral set is the 23,396 suite cases holding a mark after a control or format character, or lam-alef. The 244 corpus paragraphs over 1,000 units are excluded; the 55 main-only corpus cases were covered in the 1,710 run.
  - On that set it gains 437 line counts, 38 breaks and 32 widths, and loses **0** (`collateral-exp1a.ndjson`).
- **Myanmar.** All 55 Myanmar corpus rows are this cause (`maintained/corpus` 51, `my-bad-deeds-return-to-you-teacher` 4): Myanmar vowel signs after a ZWSP.
- **What main does.** Main passes line count with failed or unobserved breaks on 146 of the 226. Those passes are coincidences.

**B. A lone U+202F measured without letter spacing: 159 cases, traced.**

- **Trace.** `c-54aeaed1b5f03e4a`: `a` U+202F `b` in Arial 16px, letter spacing 1, width 9px.
  - In Canvas, `a`+U+202F = 26.2422 zoomed px = `a` 19.7969 + 6.4453, but U+202F alone = 4.4453, without the 2px spacing.
  - So `pairAdjust16` (shape.ts:307-316) finds +2px at offset 1 and calls the line start unsafe.
  - ShapeLine then reshapes [1, 2) alone (line-breaker.ts:452-459) and the letter spacing is lost.
  - Native line 1 is 3.2266px; the prediction is 2.2266px.
- **Same cause.** The `kinsoku-units` rows `中（ابب）` U+202F: with the spacing missing, U+202F takes its own line.
- **Fix.** A Canvas-recipe fix, like the existing space and FF letter-spacing corrections (shape.ts:268-275). One probe should settle why the lone string loses its spacing first.
- **What main does.** It measures segments and adds letter spacing per rendered grapheme itself (layout.ts:194-196). That is right here.

**C. A Canvas string crosses a script segment edge: 98 cases, traced once.**

- **Trace.** `c-02266b030454af2c`: `آگ` SHY space `A` in Arial 16px, one line at 48px.
  - The port measures item [2, 5) as the Canvas string U+2060 U+2028 `A` = 28.4688 zoomed px.
  - Native rects give 30.2344 = space 8.8906 + A 21.3438.
  - The 1.7656px difference is Arial's space–A kern.
- **Engine.** In the DOM the soft hyphen and the space take the Arabic script from the run before them, so A starts a Latin segment, its own HarfBuzz call (harfbuzz_shaper.cc:1072-1101). The port's comment says so (index.ts:53-57), but `measure16` measures across the edge.
- **Fix.** Split Canvas strings at the paragraph's script edges; `p.scripts` already holds them (index.ts:410).
- **Gaps.** The port reports `script-context` on most of these; 8 report no gap.
- **What main does.** It measures words separately, so it never kerns across the edge.

**D. The public `width` is a logical painted extent: 16 cases, confirmed offline.**

- **Terminal seam.** `c-25eb7c4c018d02e2`: `بِبِ((tail` space ZWSP `word`, RTL, Arial, 64px.
  - The engine width, 6,512 LayoutUnits, equals native 50.875px.
  - `paintedExtent` (index.ts:299-396) walks logical order and drops the trailing space. Bidi reordering puts that space in the middle of the line, so the lab observes it.
- **U+0600.** `c-163596965939fbe6`: U+0600 U+3000 `b`, Arial, pre-wrap, RTL.
  - The engine width is 4,704 LayoutUnits = native 36.75px.
  - The extent drops U+0600 because its general category is Cf, although it draws an 11.85px sign.
- **Prototype `src-exp2`.** Width = raw / 64 / zoom, replayed offline:
  - 16 widths pass;
  - nothing among the 1,710 is lost;
  - no collateral run.
- **Link.** This is blink-shortcuts D3: the output copies lab conventions instead of Blink's line width.

**E. Suspected: zero-width characters at joined Arabic edges: 25 cases.**

- **Trace.** `c-02a9276b047a1132`: `ب` SHY `ب` TAB in Amiri, pre-wrap, 3px.
  - Native: `[ب][SHY with its hyphen][ب TAB]`.
  - The port's break-anywhere ShapeLine starts from candidate offset 2, runs the reshape loop, overflows and breaks at 2 with a hyphen: `[ب SHY -][ب TAB]`.
- **Engine.** Blink's reshape loop is the same code (shaping_line_breaker.cc:540-583). So the divergence is the candidate offset, from the position the port gives the hidden soft hyphen.
- **Status.** Traced to the candidate, not reduced to a fix. Main passes line count with failed or unobserved breaks on 23 of the 25.

### 2.2 Named gaps where main's approach happens to win (858)

**F. Lam-alef as one cluster is a font fact: 274 cases.**

- **Fonts.** Arial 138, Shantell Sans 67, Times New Roman 62, Courier New 5, Georgia 2.
- **Example.** `c-00520dd17f45f4f9`: `بِلا` in Arial 32px.
  - Native: `بِ|لا`.
  - Rebuild: `بِل|ا`.
- **Cause.** The same cluster-position rule as A:
  - In Apple's fonts lam-alef is one ligature glyph, so Blink never lands inside it.
  - In Amiri, Noto Naskh Arabic and Noto Nastaliq Urdu it isn't: Chrome breaks between lam and alef (`c-01c71a79b98763bb`, `لالِا` in Amiri).
- **Prototype.** Treating lam-alef as one cluster (`src-exp`) resolves all 274. It also loses 347 suite cases, every one lam-alef in an OpenType fixture font (Noto Naskh Arabic 129, Amiri 126, Noto Nastaliq Urdu 91, Times New Roman 1). The losses are 90 line counts, 338 breaks and 331 widths (`collateral-exp1b.ndjson`).
- **Canvas can't see glyph clusters.** `TextMetrics.getIndexFromOffset` is experimental and origin-trial only (runtime_enabled_features.json5:2745-2749).
- **What main does.**
  - It sums graphemes measured alone: `sum-graphemes`, or `segment-prefixes` under letter spacing (layout.ts:510-517).
  - Isolated forms are wider, so main breaks earlier, which here lands before lam by accident.
  - In `suite/joined` that approach gives main 92 line-count and 204 breaks main-only cases, against 2,130 and 2,275 rebuild-only.

**G. Joining model in Geeza Pro fallback: 261 cases.**

- **Fonts.** Georgia, Shantell Sans and ProbeShantell have no Arabic glyphs, so Arabic falls back to Geeza Pro, whose `morx` shaping never reads the context outside a call.
- **Port.** `JOINING_CONTEXT = 'opentype'` (shape.ts:108) measures joined forms.
- **Example.** `c-037c01186a4dd598`: `بِبِ` space `ت` in Georgia 18px at 8px.
  - Native line 0: 11.5156px (isolated).
  - Rebuild: 5.3438px (initial), −790 units.
- **What main does.** Isolated measurements give isolated forms: right for these fonts, wrong for OpenType ones.
- **Needed.** A per-font joining fact, supplied by the caller or probed. Canvas can't tell `morx` from OpenType.

**H. Which glyph carries a pair adjustment: 196 cases.**

- **Port.** It puts the pair adjustment d = R(xy) − R(x) − R(y) on the glyph before k (shape.ts:304-316, 400) and reports `unsafe-to-break` (index.ts:85, 155-157).
- **Examples.**
  - `c-711ad74d23bb9476`: `A  B` in Times New Roman 16px, letter spacing −1, RTL, 10px. Canvas gives d(A|space) = −1.7656 zoomed px. The native A rect is unkerned at 10.5547px; the port says 9.6719, −113 units.
  - `c-062736d14be7e4a3`: `אב A` U+2060 `  B`. The same kern, reached through the ignorable U+2060, makes A fit at 12px. Native `[A][U+2060][B]`, rebuild `[A U+2060][B]`.
  - The ligature and kerning rows (`ffiffl` in ProbeShantell, `affinity` in Shantell Sans, `VAWAVAV` in Times New Roman) are the same limit: the pair test can't place positions inside a ligature or a kern.
- **Not traced.** Why the DOM leaves a letter unkerned against a following space wasn't traced to source.
- **What main does.** It measures words without the following space (`measureTextWithFollowingSpace` is WebKit-only, measurement.ts:311). It is wrong where GPOS first-glyph kerning is real.

**I. Script of Common punctuation: 101 cases.**

- **Pattern.** Mostly Amiri, with `((`, `([` or `«` after Arabic, Hebrew, Greek, Devanagari or emoji.
- **Trace.** `c-01c1942688f57dff`: `किरण((tail` in Amiri 16px, letter spacing −1, 32.58px.
  - The pair window `ण(` measures 6.4960 zoomed px more than its parts, across a fallback-font boundary. So the port breaks after `र`.
  - Native fits `किरण` in 32.2188px.
- **Gap.** Named `script-context`.
- **What main does.** It sums segments that never straddle the edge. 63 of main's 101 passes are coincidental line counts.

**J. Joining edges in OpenType fonts: 26 cases.**

- **Trace.** `c-ad42357c3ea1ff0b`: `بِلا` in Amiri, letter spacing 1, 8px.
  - Canvas `‍لا` = 22.1120 zoomed px, against 6.3040 + 7.3280 for the parts. The DOM rects draw lam and alef at 6.3125 and 7.3281.
  - Blink turns off liga, clig and calt under letter spacing for Canvas and DOM alike (font_features.cc:54-83), so ligatures don't explain it.
- **Status.** Unexplained. 22 of main's 26 passes are coincidental.

### 2.3 Not real losses (264)

**K. History: 146 cases, all Amiri.**

- **What happened.** Main's own prediction changed in fresh sessions, and the native lines didn't (census history reruns).
- **Cause.** Chrome caches shaped words per canvas, and main shares one canvas across prepares.
- **Example.** `c-cfcec2434df69b75`.

**L. A hyphen drawn over an empty soft hyphen rect: 118 cases.**

- **Pattern.** A line ends at a chosen soft hyphen next to Arabic or Hebrew text, followed by a space.
- **Engine.** Blink hyphenates there (shaping_line_breaker.cc:211-225).
- **Observation.** Chrome draws the hyphen, but the soft hyphen's rect has zero width in RTL runs (lab/ISSUES.md, last entry; probe blink-followups F3).
- **Confirmed from rects on the 28 LTR-paragraph cases.** The letters start exactly one hyphen width from the left edge: 5.3281, 6.0000 or 9.6016px.
- **The 90 RTL-paragraph cases** have the same texts and the same differences (+682, +768, +862 or +1,229 units of 1/128px), but their rects can't confirm it.
- **What main does.** It leaves the hyphen out, which matches the flawed observation. The fix belongs in the lab: mark these widths unobserved.

### 2.4 Unreachable with Canvas only (62)

- **U+FFFC.** Canvas normalizes U+FFFC to U+200B (character.h:167-175, applied in plain_text_node.cc). The DOM draws a fallback glyph, 16px in Arial 16px.
- **Open question.** Whether some other character falls back to the same glyph and measures the same (open probe).
- **What main does.** 50 of main's 62 passes are coincidental line counts.

### 2.5 Unattributed (2)

- **Cases.** `c-32e897f031fc55ea` and `c-c8df57f69da55e59`: `a` U+0600 U+3000 `b` in Amiri 24px, pre-wrap, 24px.
- **Trace.** The port hangs U+3000 (51.2px); native starts a third line. Not traced to source.

## 3. What main supports that the rebuild doesn't

| Main feature | Rebuild today | Fits without restructuring? |
|---|---|---|
| `prepare()` then `layout()`: arithmetic on resize, no Canvas calls | `layoutParagraph()` runs the whole pipeline each call. The measurer and memo live per call (measure/canvas.ts). | **No for "no Canvas calls".** Blink reshapes line edges at offsets that depend on the width (line-breaker.ts:452-567). A prepared handle plus a measurer kept with it can make resize cheap, but not free of Canvas calls. |
| `layoutNextLine` / `layoutNextLineRange` at a different width per line | `nextLine(prepared, start, availableWidth)` exists internally, and `BlinkLineStart` holds no width (types.ts:120-130). | **Mostly.** `firstLine` folds lines at `paragraph.width` (index.ts:444-452), the look-ahead uses the current line's width (index.ts:466-471), and gaps are written into the prepared paragraph while lines are filled (blink-shortcuts F5). Return lines with no line box as marked lines and move gaps onto each line. |
| `walkLineRanges`, `measureLineStats`, `layoutWithLines`, `materializeLineRange` | None, but fragments already carry painted text. | **Yes**: thin loops over `nextLine`. |
| `measureNaturalWidth` (max-content) | None. | **Additive**: port Blink's max-content line breaker mode. |
| Options: `whiteSpace` normal and pre-wrap, `wordBreak` normal and keep-all, `letterSpacing` | A superset: all six white-space values, four word-break values, three overflow-wrap values, five line-break values, `tabSize`, word spacing per run. | n/a |
| Rich inline items with their own font and letter spacing | Runs, spans with their own styles. | **Yes.** |
| Rich inline `break: 'never'` (atomic chips) | No per-span wrap style: the block's settings are read at 12 sites (index.ts:18-51, line-breaker.ts:114-123), and there are no atomic inlines (types.ts:7-9). | **No**: needs per-item styles and a tree-shaped model (blink-shortcuts F1, F8). |
| Rich inline `extraWidth` (padding, borders) and `gapBefore` / `gapItemIndex` | Tags add no box sizes (line-breaker.ts:672-702), and shaping groups ignore box edges (index.ts:58-82). | **Moderate**: port `ComputeOpenTagResult`, `ComputeInlineEndSize` and the shaping box checks. The gap API maps onto collapsed fragments. |
| Soft hyphens (`hyphens: manual`) | Supported. | n/a |
| `hyphens: auto` | Neither has it. | A named gap: no JavaScript API exposes Chrome's hyphenation data. |
| `text-transform` | Neither. Main leaves it to the app. | **No**: offsets map one to one (content.ts:89-93, blink-shortcuts F7). |
| `clearCache()`, `setLocale()`, caches shared across paragraphs | No cross-paragraph cache. `lang` per run and the page language from `detectEnvironment()`. | Performance work, not structure. |
| Bidi | Main computes no levels; the rebuild has an exact `ubidi` port and a painter. | The rebuild is the superset. |
| Any Chrome, Safari or Firefox version, approximately | `detectEnvironment()` refuses Chrome other than 153 (env.ts `engineFromUserAgent`). | **Policy decision**: a fallback mode for other versions. |
| Size and speed | 11,818 library lines against 6,862; 1.35 MB of generated tables against 29.5 KB. Development suite prediction takes 9.6 s against 1.5 s. Mean Canvas calls are 40.7 against 20.5 in development and 77.1 against 21.8 held-out (REPORT §3). | Table compaction and memo scope. |
| Emoji correction | Main reads a DOM span (pretext CLAUDE.md, implementation notes), which the brief forbids. | Not to be copied. |

## 4. What becoming a correctness superset takes for Blink

1. **Source fixes, no API change: 524 cases.**
   - Continuation clusters (A, 226): the prototype exists and showed no collateral loss on 23,396 cases.
   - Engine width as the public `width` (D, 16): move the extent rules into the lab's predictor adapter, next to the scorer they copy. It needs a collateral run.
   - Lone U+202F recipe (B, 159): one probe, then a recipe.
   - Canvas strings split at script edges (C, 98): measure per segment and add no pair adjustment across an edge.
   - Zero-width candidate offsets (E, 25): trace first.
   - Only A is proven clean. B, C, D and E need a Chrome run over their families.
2. **Lab fixes: 264 cases stop counting.**
   - Mark lines ending at a zero-width soft hyphen rect unobserved (L, 118).
   - Exclude main rows whose predictions depend on page history (K, 146).
3. **What is left: about 922 cases (0.39% of Chrome cases), of which 858 are named gaps.**
   - About 535 (F 274, G 261) are font facts:
     - is lam-alef one glyph?
     - does the font use `morx` or OpenType joining?

     Taking them needs a per-font input (DESIGN already plans font kerning and feature fields) or a probe that Canvas may not support. Changing the defaults instead costs more: 347 lost cases for lam-alef alone.
   - H (196), I (101) and J (26) need probe work. No better default is known.
   - U+FFFC (62) stays a gap unless a stand-in character is found.

So a correctness superset of main isn't reachable with Canvas-only defaults. With the source fixes and a font-kind input, the rebuild would leave main about 390 accidental wins (H, I, J, M and E if it resists) out of 238,518 Chrome cases. Main keeps 60,034 fewer line-count passes.

## 5. What can never be a superset, and why that is the right trade

- **Main's history-dependent passes (146).** Reproducing them means sharing a canvas across layouts on purpose. The rebuild makes a fresh measurer per layout so its predictions don't depend on earlier ones.
- **The hyphen observation (118).** The rebuild predicts what Chrome draws. Matching main means predicting a line without the hyphen Chrome paints.
- **Main's isolated-form wins (F 274, G 261).** They come from measuring graphemes alone. That approach loses 2,130 line counts in `suite/joined`, where it wins 92. No default takes both without a font fact.
- **A layout step with no Canvas calls.** Blink reshapes line edges at width-dependent offsets. Main's arithmetic fast path is part of how it approximates. The rebuild's cost here is the price of following ShapeLine.
- **Browser coverage.** Pinning Chrome 153 is what makes the claims checkable. Main's approximate everywhere-mode needs an explicit fallback, not a silent one.

## 6. Tests these findings point at

- **First-class the traced shapes as rule-targeted families:**
  - a mark after a soft hyphen, ZWSP or U+2060, in LTR and RTL (`a` SHY U+0301 `b`, `a` U+200B U+0301 `bbb…`, Myanmar after ZWSP);
  - U+202F with letter spacing ±;
  - `آگ` SHY space `A` across a script edge;
  - a bidi-reordered trailing space;
  - U+0600 at a line start.
- **Pin lam-alef per font as a font-fact test**: Arial against Amiri, same text, opposite answers.
- **Change the lab.** Mark the soft-hyphen RTL rows unobserved. Keep U+FFFC as a gap test.

## 7. Files and caveats

**Files.** Everything is under `.artifacts/research-20260916/superset-blink/`:

- **Case data.**
  - `cases.ndjson`: the 1,710 cases with native lines, both predictions and gaps.
  - `native-points.ndjson`: native per-code-point rects.
- **Tools.**
  - `record-predictor.ts`, `replay.ts`, `trace.ts`: recording, offline replay, tracing.
  - `score-runs.ts`, `score-collateral.ts`: scoring runs against native rows and the census.
- **Prototypes.** `src-exp/`, `src-exp1a/`, `src-exp2/`, with `exp-predictor.ts`, `exp1a-predictor.ts` and `record-exp-predictor.ts`.
- **Rows.** `record/`, `record-exp1/`, `record-exp1a/`, `affected-exp1b/`, `affected-exp1a/`.
- **Scores.** `scored-*.ndjson`, `collateral-exp1b.ndjson`, `collateral-exp1a.ndjson`.
- **Attribution.** `attribute.py` and `attribution.json`.

**Caveats.**

- **Classifier rules.** Buckets A, F and D rest on prototypes. The others use signature rules checked against one to three traces each; their counts are rule counts.
  - The C rule needs Arabic before a space followed by A. The 26 Times New Roman `😀A  ب`-style rows that match H's pattern instead went to H.
- **Collateral runs.** They exclude 244 corpus paragraphs over 1,000 units. My first collateral run stalled on 100k–257k-unit Arabic paragraphs with Canvas recording on; I reran once without them and without recording.
- **D.** Its effect was measured offline on the 1,710 cases only.
- **Unexplained mechanisms.** Why the DOM leaves letter–space pairs unkerned (H) and Amiri's lam-alef width under letter spacing (J).
