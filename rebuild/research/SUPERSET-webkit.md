# The rebuild as a superset of main in webkit-host

The census found 2,442 webkit-host cases where main passes a metric and the rebuild doesn't: 1,460 on line count, 1,751 on breaks and 1,123 on widths. This part gives each of those cases one cause, lists what main supports that the rebuild doesn't, and estimates what becoming a correctness superset of main would take for this engine.

Data and tools are under `~/github/pretext-rebuild/.artifacts/research-20260916/superset-webkit/`.

## 1. Answer first

Most of main's wins in webkit-host aren't about how text is laid out.

- **1,707 of the 2,442 cases (70%) depend on page history.**
  - In a document that holds only those cases, WebKit derives other lines or other float32 line edges.
  - There the rebuild wins on 1,661 of them and main fails.
  - Main's rules on these cases fit what one long document had cached.
- **721 cases are one named gap:** letter spacing turns ligatures off in the DOM, while OffscreenCanvas keeps them.
  - Main counts the spacing once per grapheme on top of unspaced Canvas widths.
  - On ProbeShantell that lands within 1/64 px of the DOM, but main's widths still fail on all 540 ligature-threshold cases.
  - On 53 of the 721, main's line count is an accident: its breaks fail.
- **Only 14 cases are other causes:**
  - 3 control glyphs that kern in Times New Roman;
  - 10 lines with no visible text, where the rebuild's painted-width rule leaves a tiny width;
  - 1 unexplained.

To become a correctness superset of main here:

- 14 cases need small fixes or probes.
- 721 cases need one decision about how to measure with ligatures off.
- 1,707 cases need nothing, beyond reporting a `page-history` gap.

## 2. Method

- **Inputs.** `census/census-transitions.ndjson`, webkit-host lines only (238,457 cases), and each case's census rows: native observation plus rebuild prediction, and main's predict-only row.
  - `extract.ts` wrote `cases.ndjson`, one record per main-only case. Each record holds:
    - the native lines and code point rects, both predictions and the rebuild's gaps;
    - for cases the census reran, both reruns scored with main's census row combined with the rerun's native row (`score.ts withNativeRow`).
  - `show.ts <id>` prints a case's whole-node and code point rects.
- **History reruns for line count and breaks.** The census agent's reruns: 2,056 cases, `census/history/webkit-host/`.
- **History reruns for widths (new).** The census never checked the 386 widths-only cases, where the rebuild's breaks pass and main passes widths. I ran them again in fresh webkit-host documents holding only those cases:
  - reverse order at 02:46 and file order from 02:51 to 02:59, with the final gaps predictor, 25 cases per round trip;
  - lock jobs `superset-webkit-widths-reverse` and `-forward`; 386 rows each, no errors.
  - `rerun-compare.ts` compares each rerun's native lines with the census row (`nativeView` + `nativeDifference`) and rescores both predictors.
    - Reverse: 269 native derivations differ, 20 cases stay main-only.
    - File order: 270 differ, 21 stay main-only.
    - The rebuild's predictions didn't change (0 differ).
    - Main's predictions don't depend on history in webkit-host (census: 0 of 2,056 changed), so its census rows stand.
- **Classification.** `classify.py` assigns each case one cause by signature and writes `causes.json` and `causes-table.json`. `buckets-vs-rerun.py` crosses the widths signatures with the reruns (`rerun-widths/buckets.json`).
- **No other browser runs.** Traces use native rects, both predictions and the pinned source `~/github/browser-engines/webkit-7625.1.29.11.27`.

## 3. Attribution

### 3.1 Totals

| Cause | Cases | lineCount main-only | breaks main-only | widths main-only |
|---|---:|---:|---:|---:|
| A. Page history | 1,707 | 991 | 1,110 | 1,100 |
| B. Letter spacing turns ligatures off (named gap) | 721 | 467 | 637 | 13 |
| C. CR and FF kerning in Times New Roman (named gap) | 3 | 1 | 3 | 0 |
| D. Unexplained emergency break after CR | 1 | 1 | 1 | 0 |
| E. Leftover width on a line with no visible text (rebuild bug) | 10 | 0 | 0 | 10 |
| **Total** | **2,442** | **1,460** | **1,751** | **1,123** |

- The columns add up to the census totals.
- A case can be main-only on several metrics, so each row's metric counts can exceed its case count.

### 3.2 A. Page history: 1,707 cases

**What the reruns show.** In a document holding only these cases, WebKit derives other lines or other line edges than it did deep inside a census document of about 19,784 cases.

**Line count and breaks, 1,340 cases** (the census history set). Against both fresh documents:

| Outcome in both fresh documents | Cases |
|---|---:|
| Rebuild passes line count and breaks; main fails both | 916 |
| Rebuild passes both; main passes line count, fails breaks | 347 |
| Rebuild passes line count, breaks unobserved; main fails line count | 35 |
| Every metric unobserved | 1 |
| Main-only in one fresh document and not the other | 41 |

- **Largest families** (census report): `U+001C`–`U+001F/middle` 350, `raw-context` 287, `physical-window-terminal-seam` 85, `maintained/kinsoku-units` 80, `signed-spacing/ascii-matrix` 67, `following-space-scope` 48, `U+000B/middle` 44.
- **Example: `c-109a381d39bcdbe3`**, `a` SHY `b` VT `b` in 16px Arial at 26.65px, pre-wrap.
  - The census document derives `[a SHY b][VT b]`.
  - Both fresh documents derive `[a SHY][b VT][b]`, which is the rebuild's prediction. Main predicts `[a SHY b VT][b]`.
  - The soft hyphen's rect is 5px wide in the census document and 10.21875px in the fresh ones.
- **Example: `c-1334b04dd7b4cd4d`**, `a` SHY `b` U+001C `b` at 31.18px.
  - Census `[0,4)[4,5)`, fresh `[0,2)[2,5)`. The rebuild predicts the fresh lines, main the census ones.

**Widths, native lines differ, 270 cases.** In both fresh documents the rebuild passes widths and main fails on 268; 1 case flips and 1 is unobserved there. By signature:

- **249: kerning before a space after an invisible character.** A letter, then CR, ZWSP, U+2060 or a soft hyphen, then a space.
  - The census document shows no letter–space kerning. Fresh documents show it, equal to the rebuild's prediction.
  - Example `c-7e96cffad69316ff`, `😀A` CR ` B` in 16px Arial at 48px: census 46.796875px, fresh 45.90625px, rebuild 45.90625px.
  - The difference is Arial's A–space kern: 56/64px at 16px, and 64/64 in 18px Times New Roman.
  - Main passes all 249 in the census documents and fails all 249 in fresh ones.
  - Main's rule, layout.ts:342-379 ("WebKit splits text items where resolved bidi levels change before it measures them…"), skips this kerning when the letters on each side of the space differ in direction. It passes and fails in exact step with page history, so it describes what these documents cached, not layout.
  - Within the census, the same rule's pattern only appears in LTR paragraphs followed by an RTL word, which is how it looked like a bidi rule (`following-space-ids.json`).
- **9: the rest of a split Arabic word.**
  - Example `c-748c57a35027ee57`, `بِبِ` U+0085 `بِبِ` in 16px Arial, RTL, 8px wide.
  - The census document gives line 1 as 3.90625px; fresh documents give 11.421875px, as the rebuild does.
- **3: `signed-spacing/pair`.** Example `c-9e64313477057185`, `1111"""bbb`: census 30.75px, fresh 31.9375px, rebuild 31.9375px.
- **6: U+001C–U+001F in Shantell Sans.** Census 40px, fresh 39.96875px, rebuild 39.968px.
- **3 others:**
  - `c-94502ac6a015f948`: the rebuild passes in both fresh documents.
  - `c-c9aae97c69c82598`: flips between them.
  - `c-d473d361056e9caf`: unobserved in both.

**Widths, only float32 line edges differ, 97 cases.**

- The derived lines and scored widths are equal, but the raw float32 edges moved, so the exact edge comparison changes.
- In both fresh documents the rebuild passes and main fails on 95; 2 flip.
- Families: `maintained/kinsoku-units` in Hiragino Sans with letter spacing 2 (42), and Amiri, Noto Naskh Arabic and Noto Nastaliq Urdu cases.
- Example `c-04843232fe4dc2f6`, `1234。b`: census line 1 is 30.799999237060547px; the rebuild predicts 30.800003051757812px, one float32 step above.
- In the census document, main's float64 sum happened to round to the same float32 as the DOM.

**Mechanism** [I].

- `TextMeasurementCache` (TextMeasurementCache.h:57, 135-175) stores a width keyed by the text alone, up to 64 code units.
- It stores only when a countdown of recent lookups runs out, and only with kerning or ligatures and without letter or word spacing.
- So whether a width comes from what the page measured earlier depends on history. `TextBreakingPositionCache` is the confirmed page-history input (REPORT §7 item 3).
- No case was traced to a single cache entry.

**What this means for main.**

- Main's old-suite Safari rows were observed in one long document, after about 119,000 rows (lab/WEBKIT-HOST.md).
- Rules tuned to those rows can pin page history.
- Nothing here needs fixing in the rebuild. The rebuild should report a `page-history` gap, and any regression gate should rerun candidate regressions in fresh documents before counting them.

### 3.3 B. Letter spacing turns ligatures off: 721 cases

**Counts.**

- 637 where main passes breaks.
- 53 where main passes line count but its breaks fail, so main isn't right either. Example: `c-a5c2304c6fbd3d10`.
- 22 where main passes line count and breaks are unobserved.
- 9 widths only.
- Every one is stable in both fresh documents.

**Where they are.** All have non-zero letter spacing, and the rebuild reports `letter-spacing-ligatures` on all 721:

- ProbeShantell 589, Shantell Sans 59, Amiri 48: text with `ff`, `fi` or `fl`.
- 16 Arabic cases in Courier New, Arial and Times New Roman.
- 9 widths-only cases: Shantell Sans `office((tail`, `officially`, `bِبِ{{office`.

**The DOM.** A non-zero `letter-spacing` sets `shouldDisableLigaturesForSpacing` (StyleComputedStyleBase.cpp:324-354). The font is then built with liga, clig, dlig and hlig off, and calt kept (UnrealizedCoreTextFont.cpp:258-264).

**The rebuild.**

- It measures with `ctx.letterSpacing` on an OffscreenCanvas (content.ts:220-222).
- Canvas `setLetterSpacing` only sets the spacing (CanvasRenderingContext2DBase.cpp:3271-3296). Nothing on that path sets the ligature flag; the flag is only set at StyleComputedStyleBase.cpp:324-354.
- So Canvas keeps ligatures and adds the spacing once per ligature glyph. Probe C13: ligature + 1, not f + i + 2.
- **Example `c-0033f34a9d6b3f85`**, `affinity` in ProbeShantell 700 16px, letter spacing −4, width 20.2239990234375px.
  - Native `[affini][ty]`, with `affini` 20.208px.
  - The rebuild predicts `[aff][init][y]`; main `[affini][ty]`, with `affini` 20.224px.
- **Example `c-03b40bb88cf00d90`**, `office((tail` in Shantell Sans, letter spacing −1: native 69.96875px, rebuild 71.968px. The ffi ligature loses two −1px spacings.
- **Arabic example `c-a5c2304c6fbd3d10`**, `صلىالله` in 16px Arial, letter spacing 1, width 21.68px.
  - Native `[ص][لىا][لله]`, with boxes 18.57, 13.89 and 11.59px.
  - The rebuild predicts `[ص][لىالله]` at 20.71875px, because Canvas keeps Arial's Allah ligature.
  - Main predicts `[ص][لىال][له]`: its breaks fail too.
- **Example `c-141c93572251129a`**, `لالِا` in Courier New.
  - The rebuild's carried width for the rest of the word comes out 0. WebKit's carry rule (lines.ts:1579, 1649) is applied faithfully, but to Canvas widths that include a ligature.

**What main does.**

- Main takes the Canvas width at zero spacing, with ligatures on, and adds `letterSpacing × (graphemes − 1)` (layout.ts:194-196, 497-509). Inside words it uses unspaced prefix widths (layout.ts:512-514; measurement.ts:465-485).
- This isn't a DOM read or a tolerance. It's a guess: the spacing count is right when ligatures are off, but the glyph advances are still the ligated ones.
- **On ProbeShantell** a ligature's advance is within 1/64px of its letters, so breaks land. Main still fails widths on all 540 ligature-threshold cases (census family widths: main-only 0, both fail 980).
  - 53 of those cases have a paragraph width equal to one of main's own line widths.
- **On Hoefler Text** it's wrong. 32px `ffi fl` at 1px spacing: DOM 63.408px, while unspaced Canvas 54.40px plus the spacings is about 60.4px (probes-safari.md:114, PROBES.md:179).

**What would reach it.**

1. **A connected `<canvas>` element styled with `font-variant-ligatures: no-common-ligatures`.**
   - It equals the DOM exactly: 16px Hoefler Text `fifl` at 10px spacing, 59.344002 (probes-safari.md:88, webkit-canvas H4).
   - It's still `measureText` with no layout read. But it needs a DOM element with a style, doesn't run in workers, and goes against measure/canvas.ts:1-3, which avoids connected canvases on purpose.
   - This is the maintainer's decision. It would make the 721 cases principled rather than approximated.
2. **OffscreenCanvas only.**
   - Count glyphs as `W(ls = 1) − W(ls = 0)` (C13), sum per-grapheme widths, and add pair kerning where a pair doesn't form a ligature.
   - This loses kerning inside ligating pairs and calt context, which Shantell Sans uses. It stays a named gap.
3. **Adopt main's rule.** Breaks improve on ProbeShantell; real ligature fonts stay wrong.

### 3.4 C. CR and FF kerning in Times New Roman: 3 cases

Stable in both fresh documents: `c-0774ff114d939edf`, `c-af325ec8545eb5af` and `c-d1da84746a9b926a`.

**`A` CR TAB `B`** in 18px Times New Roman at 12px, white-space normal.

- **Native:** `[A][B]`, and the line 0 box is 12.005859375px.
  - That's A's 12.9990234375px minus 0.993px: the same −113/2048 em kern Times New Roman applies to A–space.
  - It fits under WebKit's 1/64px epsilon (lines.ts:802, 1269).
- **Rebuild:** `[A][CR TAB][B]`.
  - It measures CR as U+0000 (measure.ts:15-25, probes-safari correction 4), which Canvas deletes after shaping, so there's no kerning.
  - "A CR" is then 12.999px > 12 + 1/64, and `breakWord` splits A from CR.
- **`😀A` FF TAB `B`** at 48px: native line 0 is 48.0068359375px. The rebuild measures FF as U+0001, 14.0px with no kerning, gets 49.0px and breaks after the emoji.
- **What main does.** Its normalization collapses CR and FF into spaces as white space. WebKit only treats SPACE, LF and TAB as white space (InlineItemsBuilder.cpp:54-73, ported at content.ts:249-263). So main's lines match by another route, and its widths fail (12.999px).
- **Reachable with Canvas?**
  - Canvas replaces U+0009–U+000D with spaces (CanvasRenderingContext2DBase.cpp:2858-2875), so the CR or FF glyph itself never shows.
  - Measuring `W("A ") − W(" ")` for CR would give 12.006px here. But that assumes the control glyph has zero advance and shares the space's kerning class, which no probe has checked [I].
  - Keep it under the named gap `control-character-width` until a probe over several fonts settles it.

### 3.5 D. Unexplained: 1 case

**`c-49feb03a06bd4b90`**, `بِبِ` CR `aabb((بب` in 24px Amiri at 8px, normal.

- Native breaks at every grapheme: `…[b][(][(][ب][ب]`. Main matches.
- The rebuild keeps `b((` together at 23.9px. It emergency-breaks `a`, `a` and `b` first, then places the rest of the item with its carried width whole.
- From the source, `breakWord` on the complex path (measure.ts:199-207) should keep one grapheme.
- Settling this needs the Canvas call log. The library records every call with its width (measure/canvas.ts:75-86), but lab rows keep only the count, so no case can be replayed offline (audit T2).

### 3.6 E. Leftover width on a line with no visible text: 10 cases

Stable in both fresh documents: 6 in `space-context` and 4 in `terminal-spacing`, ProbeShantell.

- **Example `c-16c39154a053d3c2`**, `a` U+0000 ` b` at 7px, pre-wrap, letter spacing −1.
  - Native line 1 has no visible code point, so its width is 0.
  - The rebuild reports 9.5367431640625e-07px. The trailing-space measurement leaves `f32(W(U+0000 + " ") − W(" "))`, and `paintedExtent` (lines.ts:1489-1565) keeps a run holding U+0000. U+0000 is Cc, not default-ignorable, so the rule doesn't leave it out.
- **Example `c-98871ccdf00aec65`**, NBSP + space at letter spacing −6: the rebuild reports 0.496px.
- **What main does:** gives 0.
- **Fix.** This is a rebuild bug in the painted-width rule, audit item D1. The principled fix is to report display-box geometry and let the scorer decide what is visible. A narrower fix is to give a line with no visible code point no width.

## 4. What main supports that the rebuild doesn't

Main's public surface: README.md, `src/layout.ts:720-949`, `src/rich-inline.ts:40-46, 452-1006`. The rebuild's: `rebuild/src/index.ts:19-39`, `model.ts`, `env.ts`, `paint.ts:76`.

**Inputs.** The rebuild accepts more:

- all six white-space values;
- `word-break`, `overflow-wrap` and `line-break`;
- word spacing, tab size and direction;
- per-span `lang`, and runs with different fonts.

Main's adapter rejects 196 of 300 smoke cases and 2,559 of 2,580 runs cases for those reasons (lab/BASELINE-main.md).

Main's features, and whether the WebKit engine fits each:

1. **Prepare once, then lay out at many widths** (`prepare`/`layout`, `prepareWithSegments`, `layoutWithLines`, `walkLineRanges`, `measureLineStats`).
   - The rebuild exposes only `layoutParagraph`, which prepares on every call and creates a new `Measurer` (index.ts:19-39).
   - Internally the split exists: `prepare`, `firstLine` and `nextLine` (engines/engine.ts). WebKit's `prepare` doesn't depend on the width (content.ts:522-571). Exposing it is additive (REPORT §7 item 6).
   - **Not the same promise:** main's `layout()` makes no Canvas calls. WebKit's `nextLine` measures at 6 sites:
     - the hyphen, lines.ts:159 and 1153;
     - trailing white space, :293;
     - emergency-break widths, :504-512 and :562-604;
     - `breakWord`, :552 and :608;
     - white space items, :809-810.
   - A new width means new `breakWord` probes.
   - **Fits without restructuring:** keep a `Measurer` on the prepared handle. The memo can't change results (measure/canvas.ts:9-12).
   - **Canvas-free layout** would need every grapheme prefix of every item that could overflow, measured at prepare: calls proportional to text length. That's a cost trade, not a redesign.
2. **Variable width per line with a plain cursor** (`layoutNextLine`, `layoutNextLineRange`, `materializeLineRange`).
   - The rebuild's `nextLine` takes a width per line (lines.ts:1569-1572).
   - Its `LineStart` carries `carriedWidth` (types.ts:98), the width WebKit carries to the next line (DESIGN.md §2.3; audit F12, sound).
   - **Difference:** code that resumes from a saved position has to keep the whole `LineStart`, not an offset. That's an API point, not structural.
3. **`measureNaturalWidth`.**
   - WebKit's intrinsic width path isn't ported. Laying out at a huge width only approximates it.
   - Porting it is new code from the pinned source.
4. **Rich inline items** (`break: 'never'`, `extraWidth`, `gapBefore`/`gapItemIndex`).
   - `gapBefore` has an equivalent: the rebuild's `collapsed` and `text` fragments carry run indices and bidi levels (model.ts:76-91).
   - **`break: 'never'` doesn't fit today.** It's a span with its own `white-space`, or an atomic inline. The engine reads one block style at 50 sites (audit F1) and has no atomic items (F9).
   - **`extraWidth` doesn't fit today.** It's span padding, border and margin, and inline boxes have zero width (F3).
   - **This is the one structural gap:** a computed style per box, box widths, and fragments derived from the engine's own run list (F4).
5. **Any canvas font string.**
   - `FontDecl` is family, size, weight and style only (model.ts:11-18). There's no `font-stretch`, `small-caps` or variation settings.
   - Additive; DESIGN.md:105-110 already lists them as planned fields.
6. **Any WebKit build.**
   - Main detects engines by `AppleWebKit/` (measurement.ts:283-289), so it covers every Safari version, iOS and WebKit shells like CriOS.
   - The rebuild refuses Safari other than 27.0 (env.ts:61) and anything that isn't Safari's user agent.
   - That's on purpose (pinned engine data). A superset needs a policy for builds it hasn't pinned, for example predicting with the nearest pinned engine and reporting a version gap.
7. **DOM canvas fallback** when OffscreenCanvas is missing (measurement.ts:163-181). The rebuild uses OffscreenCanvas only (measure/canvas.ts:48). This doesn't matter for Safari 27; it matters only once point 6 widens.
8. **Caches shared across paragraphs, plus `clearCache` and `setLocale`** (layout.ts:941-949).
   - The rebuild caches nothing across paragraphs; its memo lives for one layout.
   - A long-lived `Measurer` keyed by context settings fits. This matters for the virtualization use case, many `prepare()` calls.
9. **Hyphens and `text-transform`.**
   - Both libraries handle manual soft hyphens only.
   - Neither transforms text; main expects the caller to pass transformed text.
   - No difference today. The rebuild's planned `textTransform` needs a map from content offsets to source offsets (audit F7).
10. **Main's 1/64 fit tolerance at every fit site** (measurement.ts:302; line-break.ts:323, 577, 986).
    - The rebuild adds 1/64 only where the source does (lines.ts:802, 1269; not at :1209).
    - Main isn't more correct here: this is a tolerance the brief rules out.

## 5. Estimate for WebKit

**Correctness, from the census rows:**

- **Page history, 1,707 cases:** no engine work.
  - Add a `page-history` gap.
  - Make regression gates rerun candidate losses in fresh documents in both orders. Here that turned 2,442 apparent losses into 735 stable ones.
  - Look again at main's rules that exist only for such rows: layout.ts:342-379 is one.
- **Letter-spacing ligatures, 721 cases:** one decision.
  - Allowing a connected, styled `<canvas>` makes these exact per probe H4. It needs a new measurement context type in `measure/` and the `letter-spacing-ligatures` gap becomes a recipe.
  - Otherwise they stay a named gap with an approximation.
- **CR and FF kerning, 3 cases:** a probe across fonts, then either a recipe or keep the gap.
- **Unexplained break, 1 case:** full Canvas call logs in lab rows and a recorded-width `Measurer` (audit T2), then a source trace.
- **Leftover width, 10 cases:** fix the painted-width rule (D1). The proper fix removes the lab's visibility rules from the engine.

**API, to be a feature superset:**

- **Additive, no restructuring:**
  - public prepare and `nextLine`;
  - a `Measurer` that lives across paragraphs;
  - line stats;
  - more fields in `FontDecl`;
  - a version policy.
- **Porting from source:** the natural width (intrinsic width) path.
- **Restructuring:** rich inline. It needs a style per box at the 50 sites that read the block style, inline box widths, atomic inline items, and fragments derived from the engine's runs. Decide the tree and style shape before adding features (audit §6 item 4).

**What can never be a superset, and why that's the right trade:**

- **Main's wins that come from page history.** A predictor sees the paragraph, not the page's measurement caches. Predicting the fresh-document layout is what a caller can rely on; matching one long document's cache state isn't.
- **Main's accidental line counts:** 53 cases where main's breaks fail, and more among the history cases (347 where main passes line count but fails breaks in both fresh documents). Chasing them would reward wrong breaks.
- **Letter-spacing ligatures, if measurement stays OffscreenCanvas only.** WebKit's OffscreenCanvas can't turn ligatures off; `ctx.textRendering` isn't a native property (PROBES.md:179).
  - Main's per-grapheme spacing will keep winning on fonts whose ligature advances equal their letters (ProbeShantell), and losing where they don't (Hoefler Text).
  - The principled choices are a recipe from probe H4 or a named gap, not main's guess.
- **Float32 edges that move with page history** (97 cases). No model built from Canvas totals can match the DOM's float32 noise when that noise itself changes with the page.

## 6. Files

In `~/github/pretext-rebuild/.artifacts/research-20260916/superset-webkit/`:

- `transitions-webkit-host.ndjson`: webkit-host lines of the census transitions.
- `extract.ts` → `cases.ndjson`: 2,442 records.
- `show.ts`: rect dump for case ids.
- `classify.py` → `causes.json`, `causes-table.json`: cause, per-metric counts, example ids.
- `following-space-ids.json`: example ids per following-space context.
- `rerun-widths/`:
  - `cases.ndjson`, `run.sh`, `run.log`;
  - `reverse/` and `forward/` rows and run.json;
  - `rerun-compare.ts` → `reverse-natives.ndjson`, `forward-natives.ndjson`, `summary.json`;
  - `buckets-vs-rerun.py` → `buckets.json`.
