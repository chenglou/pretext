# Test architecture for the rebuild

Scope: charter tentpoles 4 (tests designed for this rebuild) and 5 (main is an external corpus, not a spec). This is a design; nothing under `rebuild/` was edited. Three questions were settled with small offline programs under `~/github/pretext-rebuild/.artifacts/research-20260916/tentpoles/tests/`:

- `threshold-derivation.ts` derives threshold widths from native rows alone and checks them against census rows (section 2.3).
- `facts-extract.ts` turns probe outputs into facts and diffs two runs (section 4.2).
- `triage/census-main-only-classes.json` sorts the census's "main passes, rebuild fails" cases into classes (section 7).

Paths are relative to `~/github/pretext-rebuild` unless they start with an engine checkout. Engine citations are at the pinned tags: `chromium-153.0.8010.48`, `webkit-7625.1.29.11.27` and `firefox-156.0`.

Terms:

- **Observation**: what a browser reports through DOM geometry for a case: Range rects, box sizes.
- **Expected value**: what a test compares against. Here it is always an observation, a recorded fact, or the output of engine code or data run as an oracle. The library never supplies one.
- **Grid**: the unit a browser's layout widths sit on:
  - Chrome: 1/(64 × DPR) CSS px, so 1/128 at DPR 2;
  - Safari: float32 CSS px at 1/64 LayoutUnit bounds;
  - Firefox: 1/60 CSS px (app units).
- **Environment key**: the browser build, OS build, DPR, zoom, page and UI languages, font set, observer version and scorer version that a result was produced under.

## 0. Rules every layer follows

1. **No expected value, threshold width or verdict comes from `rebuild/src`.** A bun test enforces this: it fails when any file under `rebuild/lab/cases`, `rebuild/probes` or the triage and fact tools imports `rebuild/src`. Only the prediction adapters are exempt (`rebuild/lab/predictor.ts` and the gaps predictor).
2. **Each layer states what it proves and what it can't.** A pass in one layer never stands in for another.
3. **Every result carries its environment key**, and baselines are per key.
4. **Inspection burns held-out data** (section 3).
5. **Unobserved and not-applicable are never passes.** This is already true in `rebuild/lab/gate.ts:18-19`.

## 1. Layers and what each proves

| Layer | Proves | Can't prove | Where the expected value comes from | Runs |
|---|---|---|---|---|
| L0 Observer tests | The scorer derives native lines from rects by its stated rules (`rebuild/lab/score.test.ts`); later, the ported observation rules of tentpole 2 | Anything about the library | Hand-built rows | bun, seconds |
| L1 Engine data parity | Generated tables and shared algorithms equal the engine's own library on inputs that cover every class pair | That the engine calls them the way the port does | ICU C over Chrome's `icudtl.dat`, system libicucore, `icu_segmenter` with Firefox 156's baked data, BidiTest and GraphemeBreakTest, answers recorded from installed browsers | bun, offline |
| L2 Browser facts | A numbered claim about one browser build holds, such as a fit bound, a Canvas-versus-DOM recipe or a cache effect | Behaviour outside the probed shapes | Probe observations with verdict rules inside the probe | installed browsers, per release |
| L3 Offline replay | A library change doesn't move predictions on rows already observed | New shapes; Canvas values the library didn't record | Native lines of recorded lab rows; Canvas widths replayed from recorded call logs | bun, offline |
| L4 Rule families (development) | Each library rule and its neighbours match the browser at exact threshold widths | Rules without a family (listed in the coverage matrix) | Native observations at widths derived from earlier native observations | installed browsers |
| L5 Natural families and external corpus | Realistic paragraphs and main's suite, measured, not required | Why something passes | Native observations | installed browsers |
| L6 Held-out | The port generalizes to cases nobody iterated on | Anything about a specific case until the set is burned | Native observations; only counts are reported | installed browsers |
| L7 Gate | No layer lost what it had under the same environment key | Correctness of new behaviour | Baselines seeded from L1-L6 | offline over recorded runs |

What each layer rests on today:

- **L1:** `rbbi.test.ts`, `ubidi.test.ts`, `unicode-bidi.test.ts`, `grapheme.test.ts`, `bidi.test.ts`, `props.test.ts` and `script.test.ts`, which ports Chrome's own `script_run_iterator_test.cc`.
- **L2:** the probe files and their verdict scripts.
- **L3:** doesn't exist yet. Lab rows keep `measureLog` as a count only (`rebuild/lab/types.ts:90-94`), and the WebKit audit T2 asks for full call logs. With the context settings, text and width of every `measureText` call recorded, `layoutParagraph` can replay any lab row in bun against its native lines. A replay that asks for a string the log lacks reports "needs a browser run" instead of passing.
- **L4 and L5:** `runs`, `ws`, `policy`, `smoke` and the suite import. L4 as defined here doesn't exist yet.
- **L7:** `gate.ts` with `baselines/gate-*.json`.

The painter metric belongs to L4-L6. It proves tentpole 7: painted lines draw at the predicted geometry.

**Coverage matrix.**

- **Rows:** library rule ids (section 2.1).
- **Columns:** parity tests, fact ids, development families with cases and pass rates per engine, held-out counts, and a reason when uncovered.
- **Output:** `rebuild/lab/coverage.json`, written by a tool that reads rule annotations, family declarations, the fact files and the latest per-case scores.
- **Gate:** the gate fails when a rule that had an observed family loses it.

## 2. Rule-targeted case generation

### 2.1 Rules have ids

Engine code already cites source. There are 152 comment lines citing `file:line` in `rebuild/src/engines/blink`, 67 in `webkit` and 127 in `gecko`. The rule id sits on the same comment:

```ts
// rule blink/fit-bound: line_breaker.h:307-317 (AvailableWidthToFit = AddEpsilon); fact blink/fit/available-plus-one-lu
```

A family declares the rule ids it targets, and the coverage tool joins the two. A rule without a family, a fact or a parity test is listed as uncovered.

### 2.2 A family is a trigger, its neighbours, a context and axes

Worked example: Blink's HanKerning trim at a line end (`third_party/blink/renderer/platform/fonts/shaping/han_kerning.cc:292-301`, `ShouldKernLast`). A fullwidth closing mark at a line end loses half its advance.

- **Trigger:** a closing mark of `han_kerning`'s close type (`」`, `）`, `。`) exactly at a break candidate that ends a line.
- **Neighbours, one factor flipped each:**
  - the same mark mid-line;
  - the mark at a line start;
  - an opening mark (`「`) at the line end;
  - a halfwidth `)`;
  - a font whose bracket has no `halt`;
  - `white-space: pre-wrap`;
  - letter spacing other than 0;
  - RTL direction.
- **Context:** Han and kana before the mark, Latin before it, a digit before it, and text after it or nothing.
- **Axes:** below.

**Axes without a crossproduct.** Each rule's axes fall into three classes:

- **Relevant axes:** what the cited source reads. Covered exhaustively, because they are few: here mark type (close, open, dot, colon), position (line end, start, middle) and whether the font has `halt`, which is 24 combinations.
- **Neighbour axes:** what nearby code reads. Covered by a pairwise covering array, a fixed list of rows in which every pair of values of two axes appears at least once: `white-space` normal, pre-wrap or break-spaces; direction; letter spacing 0, 2 or −2; `lang` ja, zh or en. That is 9-12 rows instead of 54.
- **Background axes:** everything else. Font size, other runs, surrounding text and span structure are drawn from seeded background distributions, like `runs.ts` does today.

Environment and language axes follow the same classes:

- **DPR and zoom** are relevant only to rules whose source reads layout zoom or app units per device pixel (Blink's fit arithmetic, Gecko's apd, emoji at device size). Only those families run under forced DPR 1 or Firefox's `layout.css.devPixelsPerPx`; the rest of the suite doesn't.
- **Language** is relevant only where the source reads it: Blink's per-locale line tables, WebKit's Han `lang` replacement, Gecko's ja/zh segment-break removal.
- **Characters** come from each engine's own generated class tables, never from JavaScript `\p{…}` escapes (DESIGN.md §6.1). Each relevant Line_Break class gets a BMP member, and an astral member where the class has one, in a font that covers it.

### 2.3 Threshold widths from the browser's own observations

The rule must be exercised at the widths where the browser's decision changes, and no test may depend on the library's predictions. Each rule-family paragraph is observed in up to four passes:

1. **Pass A, opportunities.** Observe the paragraph at width 1 with `overflow-wrap: normal` and the case's own `word-break`. Nothing fits, so every line holds one unbreakable piece, and the native line starts list the soft wrap opportunities taken after a line start. Opportunities that exist only mid-line show up in pass C.
2. **Pass B, unwrapped extents.** Observe at a huge width, 100,000px, with the case's own styles. For each grapheme, take the union of its code points' positive Range rects. The extent of a source range [s, k) is the sum of its graphemes' widths, without trailing SPACE or TAB in the modes where they hang.
3. **Derive bracket widths** with each engine's fit arithmetic, taken from recorded facts, not from the library:
   - **Chrome:** content fits when content ≤ available + 1 LayoutUnit (`third_party/blink/renderer/core/layout/inline/line_breaker.h:307-317`; probe blink-lines H2: C128 = 11959, 93.421875px gives 1 line and 93.4140625px gives 2). So T = (C − 1)/(64 × DPR).
   - **Safari:** the first one-line width is (ceil64(E) − 1)/64 (PROBES.md, WebKit gaps table, "Item widths").
   - **Firefox:** integer app units against round(width × 60) (PROBES.md, Firefox table, "Line-fit grid"). So T = au/60, and one grid unit below is (au − 1)/60.
4. **Pass C, observe at T and at T minus one grid unit.** The expected lines are these observations. The derivation only decided where to look.
5. **Pass D, bisection, when a bracket misses.** If the two widths give the same first line, bisect on the grid between the nearest observed widths whose line ends differ. That takes about 10 observations from 1px down to 1/128px in Chrome. The measured offset from the derived threshold is recorded with the family. Explaining it is the rule's job.

Later lines work the same way. After the browser's own line n break at a bracket width, line n+1's thresholds come from pass B extents measured from the native start of line n+1.

**Prototype over existing rows.** `threshold-derivation.ts` read the Chrome census chunks that hold main's 1px sweep families: `chunk04`, `chunk05`, `chunk08` and `chunk11` under `.artifacts/research-20260916/census/chrome/`, 79,130 rows. It read only their `native` fields. The sweep rows carry the case's own `overflow-wrap: break-word`, so there is no pass A row. As a stand-in, a line end counts as a soft opportunity when its line had room for one more grapheme by the unwrapped extents, which an emergency break wouldn't leave.

- **Input:** 20,579 rows of `kinsoku-units` and `closing-punctuation` with clean native derivations, in 1,631 paragraph groups. 151 groups have a one-line row and at least two rows.
- **Line ends** (`out-sweeps/threshold-derivation.json`): from each native line start, the longest candidate that fits by the extents matches the native end on 16,925 of 18,833 lines (89.9%). First lines match 5,831 of 7,261 (80.3%); later lines 11,094 of 11,572 (95.9%). 19,925 lines where nothing fits (emergency breaks or overflow) are not threshold questions and aren't counted.
- **First-line transitions at 1px:** 214 transitions have an observed row one px below:
  - 197 happen at the derived pixel exactly;
  - 13 happen 8px earlier, all at `」` (for example `x「hello world」` in 16px Hiragino Sans: derived 125.953125, native reaches the line end at 118). That is HanKerning's line-end trim, the rule of 2.2: the browser fits more than the unwrapped extent says, by exactly half a 16px fullwidth mark;
  - 4 happen 1px earlier, in `739x「value」! end`, 16px Hiragino Sans, LTR and RTL, at the space and at `d`. They aren't traced;
  - none happen later.
- **Where line ends differ, the leaders are rule effects:**
  - native longer: `」` 416 lines, `。` 160, `！` 112 and `ー` 112 (line-end trims and marks that can't start a line);
  - native shorter: Arabic kasra `ِ` 284 (joining and reshaping at the break), `「` 144 (an opener whose opportunity depends on the line start) and a combining mark 84.
- **The accuracy grid shows why pass A is needed.** With `maintained/accuracy` added (`out/threshold-derivation.json`): 2,591 groups, 477 usable, 21,105 of 23,328 lines match. The misses there are candidate gaps: 8 widths per text rarely show an opportunity with room to spare. For example `c-e006e601e447e75e`, 12px Helvetica Neue at 200px: native line end 36, derived 25.
- **Cost:** peak RSS 320 MB over 400 MB of rows.

**Engine caveats the design has to carry:**

- **Blink.** Pass B has no line-end reshape. A line ending at a space isn't reshaped under `text-align: start` (`line_breaker.cc:255-268`, `NeedsAccurateEndPosition`), but a line ending inside a word at an unsafe offset is (ShapeLine, blink-lines §6). Derived thresholds there are approximate, and pass D exists for them.
- **Safari.** A code point's Range edge inside a text box snaps outward to whole CSS px (`rebuild/lab/README.md:287-297`). Pass B extents are only good to about 1px, so Safari families always run pass D, from a ±1px window down to 1/64px in 7 steps.
- **Firefox.** Rects are app units read through float32 and can be one float32 step off (README "Range geometry"). Snap to au before deriving.
- **Derived widths are per environment key.** A Chrome family at DPR 1 derives its own widths. Each derived case records the ids of the pass A and pass B rows it came from, and every browser update re-derives. Cases derived under the old key stay as ordinary development cases.

## 3. Held-out generation, and keeping it held out

- **Same generators, sealed seeds.**
  - A held-out set is the rule-family and natural generators run with a seed that is never committed.
  - `rebuild/lab/heldout/SEALED.json` is committed with: sha256 of the seed; sha256 of the generator sources at generation time; sha256 of the case file; its case count; and the ids of the development files it excludes (`--exclude-ids`, `rebuild/lab/cases/generate.ts:12-14`).
  - Case ids are content hashes (`rebuild/lab/cases/case.ts:16`, `ID_VERSION`), so exclusion and burning work by id.
  - The seed and case file live under `.artifacts/heldout/<name>/`.
- **Structural held-out.** Some covering-array rows of each family (axis-value pairs) are held out as well as some seeds, so held-out cases also combine factors development never saw.
- **Sealed scoring.**
  - A `--sealed` scoring mode writes only counts per rule id, metric and engine: no ids, texts, examples or failure reasons.
  - The iterating agent sees these counts and nothing else.
  - The report tables that exist today name held-out families and cases (REPORT §6), which is exactly what sealed mode forbids.
- **Burning.**
  - Any look inside a held-out set burns it: examples, per-family breakdowns with cases, triage of one case. Burning moves the set to development and draws a new sealed seed.
  - `heldout-20260916` is burned: REPORT §6 names held-out families and case counts, and TAKE-BACK cites held-out cases.
  - Its pass pairs are already in the development gate.
- **Use.** Held-out counts answer "does the port generalize", after a change is decided on source and facts. They never choose between two recipes; that would be a choice by lab score, which tentpole 3 bans.
- **Rotation.** Each browser release gets a new sealed set, generated after the port for that release is frozen.

## 4. Probe verdicts as versioned browser facts

### 4.1 File format

One NDJSON file per engine per browser build, under `rebuild/facts/<engine>/<build>.ndjson`, such as `rebuild/facts/blink/chrome-153.0.8010.48.ndjson`. One record per fact:

```json
{"fact":"blink/fit/available-plus-one-lu",
 "claim":"a line fits when its content in LayoutUnits is at most the available width plus 1",
 "cites":["third_party/blink/renderer/core/layout/inline/line_breaker.h:307-317"],
 "probe":"blink-lines H2","probeSha256":"<sha of the probe definition as served>",
 "scope":{"dpr":2,"zoom":1,"process":"any","pageLang":"en"},
 "env":{"build":"Chrome 153.0.8010.48","os":"26A428","dpr":2,"fonts":"<font digest>"},
 "verdict":"holds",
 "decisive":{"c128":11959,"oneLineAt":93.421875,"twoLinesAt":93.4140625},
 "supplementary":{"strings":["nnnnn nnnnn","Hello world"]},
 "observedAt":"2026-09-16T..","run":".artifacts/probes/blink/dpr2/chrome-probes.json",
 "holdsIn":["Chrome 153.0.8010.48"]}
```

- `fact` is declared in the probe. It is not a check name, and it never contains a measured value.
- `scope` names the environments where the claim applies. A run outside its scope doesn't evaluate it.
- `decisive` holds the values the verdict rule reads. A change there is always reported. `supplementary` values are shown but never gate.
- The verdict rule is a pure function stored with the probe, run by one extractor. It is never a separate script that reads output afterwards.
- Library rules cite fact ids (section 2.1). The coverage matrix lists rules whose facts don't hold in the current build.

### 4.2 What the prototype found in today's probe outputs

`facts-extract.ts` reads the three encodings in `rebuild/probes`:

- `checks` with name, ok, expected, measured and DPR, in Blink and Gecko (`rebuild/probes/blink-probes.ts:5-8`);
- `pre` preconditions, in Gecko;
- a single `ok` per probe, in WebKit (`rebuild/probes/webkit-probes.ts:1-6`).

It diffs two runs of the same probe file. Outputs are under `tentpoles/tests/facts/`.

- **webkit-host against installed Safari, `webkit-probes.ts`:**
  - 88 facts each, all compared, 0 verdict flips;
  - 86 identical;
  - 2 with the same verdict but other measurements: `CRITIC §7 font-size` reads `nbspDom` 0 in the host and 65.934 in Safari, and `cross-cutting 6 environment` differs only in the user agent;
  - 10 facts have `ok: null`, meaning the probe records no decisive expectation;
  - 1 probe has no check at all.
- **`webkit-probes-crosscheck.ts`:** 0 facts. None of the 118 host probes or 140 Safari probes records a verdict; `webkit-verdicts-crosscheck.ts` decides them afterwards. These can't be rerun as facts until their rules move into the probes.
- **Chrome DPR 2 against forced DPR 1, `blink-probes.ts`:**
  - 353 and 351 facts, 307 compared, 244 identical;
  - 38 with the same verdict and other measurements, such as blink-lines H9 "scanned 1-line threshold = C − 1 layout unit", 13136 at DPR 2 against 6568 at DPR 1;
  - 25 flips. 11 are the system-ui probes (cross X5), whose outcome depends on which text created the platform font first in that browser process (TAKE-BACK 5.3). Most of the others are checks written for one DPR;
  - 46 facts exist only at DPR 2 and 44 only at DPR 1, because check names carry values ("16px, available 8701 layout units: …").
- **Firefox apd 30 against apd 60:** the apd 60 run is a 13-check subset. 12 compared, 0 flips, 5 measurement changes.

Consequences for the format: declared ids, explicit scopes (DPR, fresh process), decisive values kept apart from supplementary ones, and verdict rules inside the probe.

### 4.3 Per release

1. Detect the build from app bundles, not user agents. Today: Chrome 153.0.8010.48, Firefox 156.0, Safari 27.0 on WebKit 22625.1.29.11.27, OS build 26A428. Chrome's user agent says `Chrome/153.0.0.0` for every 153 build (`rebuild/lab/README.md:268-271`).
2. Rerun every probe file in every scope it declares, one browser at a time under the lock. The fresh-process scopes use a single-probe document in a new browser session.
3. Extract a new facts file for the new build, keeping the old file.
4. Diff:
   - **unchanged:** append the build to `holdsIn`;
   - **same verdict, different decisive values:** reported, and the fact's owner decides whether the claim still means the same;
   - **flip:** blocks that engine's gate until triaged. Either the browser changed (read the new source, update the spec and port) or the claim depends on process history (narrow the fact's scope to fresh processes and add a history family, section 6.5);
   - **new or missing facts:** reported.

What changes when a browser updates:

- the environment key, and with it the facts file and the lab baseline for that engine;
- for Safari, the webkit-host stand-in rule, until the combined comparison runs again (`rebuild/lab/WEBKIT-HOST.md` "Rule").

A macOS update moves all three browsers' keys (fonts, Core Text, libicucore).

## 5. Engine data parity, and generators that pin hashes

**Today.** Generators check every input's sha256 (`rebuild/tools/gen-shared.ts:16-22`) against `data/blink/manifest.json`, `data/webkit/FILES.tsv`, `data/gecko/segmenter-data-sha256.json` and the ppucd and uscript hashes in the generators. What's missing:

- the generated modules' own hashes;
- the generator source hash;
- oracle answers that can't silently skip: `rebuild/src/engines/blink/breaks.test.ts:87` skips when the groundwork answers are missing, and the WebKit audit found the same pattern in `webkit/breaks.test.ts`.

**Design.** `rebuild/data/<engine>/LOCK.json`:

- `engine` and its version, the source tag, and the app bundle path the data came from;
- `inputs`: path, bytes, sha256 and the extraction command, such as cutting `line_normal_cj.brk` from Chrome 153's `icudtl.dat`;
- `generator`: path and sha256 of the generator source and of `gen-shared.ts`;
- `outputs`: path and sha256 of each generated module;
- `oracles`: each answer file under `rebuild/data/<engine>/oracle/`, with sha256, the program that produced it and that program's library, such as `icu-bidi-oracle.c` against system libicucore.

Two checks read it:

- `bun rebuild/tools/gen-<engine>-data.ts --check` regenerates in memory and fails unless the bytes equal the lock's outputs.
- A bun test hashes the checked-in modules against the lock. A hand edit to a generated module then fails, and a new browser's data fails until a new lock lands as a reviewed diff.

**Oracles are the engines' own libraries, never a second port:**

- **Blink.** ICU C over Chrome 153's `icudtl.dat` for the rule tables. For Blink's layer on top (the space rule, the fast pair table, restarts at line starts), answers recorded from installed Chrome: `Intl.v8BreakIterator` boundaries and DOM line starts at width 1, stored as data with hashes. The current oracle is a C++ re-port of 152's `LazyLineBreakIterator` and compares only the first ICU pass (blink-shortcut-audit §6), so it can't pin restarts.
- **WebKit.** The compiled `classify` dump and pair table that already exist (131,072 lookups, 1,547 pairs); libicucore through `ubrk_open` with Apple's overrides; Safari DOM line starts at width 1 recorded as data.
- **Gecko.** The Rust `icu_segmenter` oracle rebuilt on Firefox 156's data (specs/gecko-oracle-replay.md: 5,060,059 positions agree, 401 differ), turned into answer files.
- **Shared.** BidiTest, BidiCharacterTest and GraphemeBreakTest 17.0.0, plus the ICU bidi oracle linked against icu4c and libicucore, as today.

**Inputs that cover every class:**

- every pair of line-break classes in each pair table (223 × 28 for Blink's fast table);
- one representative per class, BMP and astral, in seeded random contexts of 0-3 characters on each side;
- every lab paragraph's text;
- seeded fuzz that includes CR LF, lone surrogates and Apple's private-use classes.

Answers are regenerated only when the lock's inputs change.

## 6. The gate

### 6.1 What it keys on

- **Environment key:** browser build from the app bundle; OS build; DPR; zoom; page language set; `navigator.languages`; a font digest (Canvas widths of a fixed probe string in every family the lab uses, plus fixture font hashes); observer version (`page.ts`); scorer version (`score.ts`).
- **Items:**
  - L1: parity test ids;
  - L2: fact ids with their verdicts;
  - L4-L6: pairs of case id and metric.
- **Today's gate** keys environments by the user-agent, DPR and scale strings the page reports (`rebuild/lab/gate.ts:14-16`, `runProblems` at `:213-228`), so it can't tell two 153 builds apart.

### 6.2 What fails

- a lost pass in L1, L4 or L5, as `checkRuns` does today (`gate.ts:327-380`);
- a fact flip or missing fact in L2;
- a rule losing its last observed family (coverage);
- the unstable pair count growing (today gate-webkit.json holds 17 unstable pairs on 16 cases);
- missing cases under `--complete`.

New passes are reported, and gains never offset a loss. Held-out losses show only as counts per rule.

### 6.3 How baselines move with browser versions

1. On a new environment key, observe every layer with the library unchanged.
2. Seed a new baseline file for that key. `seedBaseline` (`gate.ts:230-282`) stays as it is: a pair is a pass only if every seeding run passed it.
3. Attribute every lost pair against the previous key's baseline: the browser changed, an observation problem, new history dependence, or a scorer change.
4. Only then port from the new source.

The old baseline stays in git and still checks rows from its own key.

**Scorer or observer changes.** Rows are kept and scoring is offline. A scorer change re-scores the same rows with both scorers and seeds under the new scorer version with the library unchanged. The library change then gates against that seed in a later commit. This is main's rule too: a harness change gates from its own harness and once from the old one (`tests/wrapping/README.md:34-36`).

### 6.4 Environment reruns

- Chrome at forced DPR 1 and Firefox at other apd values run only the families and facts whose rules read DPR or app units (section 2.2).
- Their baselines are separate keys.

### 6.5 Cases that depend on page history

**Today.** Two-order runs mark cases history-dependent, and the gate skips them (`gate.ts:20-23`):

- Chrome: 0;
- Firefox: development suite 123, held-out 216, 116 and 113 of them with U+1F600 after `😀︎`;
- webkit-host: 55 and 154;
- installed Safari combined files: 73 and 124 (REPORT §2.2, TAKE-BACK §4).

That hides real layouts from the gate. Tentpole 6 says history is an input or a named effect. The design:

- **Detection stays.** Forward and reverse, plus a seeded shuffle on each release.
- **Every case declares an isolation protocol:**
  - `shared`: any predecessors;
  - `fresh-document`: a page reload before it;
  - `fresh-process`: a single-case run, which gets a new browser process (README "Page-history dependence").
  The reference observation of a history-dependent case is its `fresh-process` observation, and that one gates.
- **History families make the prelude an explicit input.** A case field `prelude` lists paragraphs laid out and removed in the same document and process before the case. Examples:
  - WebKit's `TextBreakingPositionCache`, keyed by string, style context and security origin (`Source/WebCore/layout/formattingContexts/inline/text/TextBreakingPositionCache.h:48`): `abc      def` under `pre-wrap`, removed, then the same text under `break-spaces` at 30.234375px (TAKE-BACK 5.1);
  - Firefox's emoji state: `😀︎` measured, then `😀` in 16px Arial (TAKE-BACK 5.5);
  - Gecko's document-wide bidi flag (`dom/base/CharacterData.cpp:302`, `:410` `SetBidiEnabled`): an LTR paragraph with LRE and no RTL character, with and without an earlier Hebrew node (gecko-shortcut-audit F3).
- **A case that is still history-dependent under its declared protocol** gates on nothing, is listed, and gets the library's `page-history` gap (REPORT §7 item 3).

## 7. How main's tests are admitted: triage

### 7.1 Protocol

Input: census transitions where main passes a metric the rebuild fails (`.artifacts/research-20260916/census/<browser>/<chunk>/transitions.ndjson`).

1. **Isolate.** Rerun the case alone in a fresh session, in both orders (`census/tools/run-history.sh`). If the native derivation moves, the case goes to section 6.5, not triage.
2. **Classify from observations only:**
   - **A:** main passes lineCount, breaks are observed, and main's breaks fail. Right count, wrong places;
   - **B:** main passes lineCount, and breaks can't be observed;
   - **C:** main passes breaks and the rebuild doesn't;
   - **D:** only widths.
3. **Decide one of three outcomes:**
   - **Objective fact to learn.** Minimize the case by removing characters, runs and styles while the native derivation keeps its shape and the rebuild still fails. Map the minimal shape to a rule candidate in engine source, write a probe, record the fact (section 4), then add a rule family (section 2) whose origin names main's case.
   - **Accidental pass.** Main's metric passed, but a metric that was observed shows the pass wasn't a model of the browser. Nothing of main's is admitted. If the rebuild's miss is real, it is learned through its own probe, not from main's answer.
   - **Opinion we drop.** Main's special status held a tolerance, an API contract, an observer protocol or one of its heuristics in place. The input stays an ordinary case; its requiredness is dropped.
   - Until decided, a case is **undecided**: class B, or D before the observation port of tentpole 2 lands. Undecided cases stay ordinary and are never admitted.
4. **Record** in `rebuild/lab/triage/main-<browser>.ndjson`: `{ mainCase: "wrap-…", labCase: "c-…", browser, class, isolation: "same" | "moved", outcome, fact, probe, family, reason }`. The `obligations` importer reads these records instead of main's `required` lists (`rebuild/lab/cases/obligations.ts:34-60`).

### 7.2 The census so far

`tentpoles/tests/triage/census-main-only-classes.json`.

- **Chrome, complete** (23 chunks, 238,518 rows):
  - lineCount: both pass 175,301; rebuild only 60,034; main only 838; both fail 2,305;
  - rows where main passes something the rebuild fails: A 321, B 200, C 670, D 519;
  - the only one on a case main requires is `c-9c5a66597ebf5aef` (class B).
- **Firefox, 9 of 12 small chunks** (177,998 rows):
  - lineCount: main only 314 against rebuild only 32,814;
  - classes: C 503, D 79, A 55, B 7;
  - required: `c-ed263bd4b6656704` (class C).
- **Safari** hasn't run yet.

In the Chrome aggregate of 19:34 (1,136 rows), 557 of the 615 class C rows report `unsafe-to-break`, `font-fallback` or `control-character-width`, the gaps that locate failures (REPORT §4).

### 7.3 Worked examples

**Accidental passes:**

- `c-1267fee582f30f2c`, `suite/U+FFFC/middle`: `ب` SHY `ب` U+FFFC `ب`, 16px Arial, `pre-wrap`, 15.35px.
  - Native: [0,3) [3,4) [4,5). Main: [0,2) [2,4) [4,5), the right count with line 2 at the wrong offset. The rebuild predicts 2 lines.
  - Outcome: accidental. The rebuild's miss is its U+FFFC gap: all 183 lab cases holding U+FFFC fail a prediction metric (blink-shortcut-audit C-u4), which gets its own probe.
- `suite/original-vs-reshaped-admission`: all 16 of Chrome's main-only rows are class A. REPORT §2.3 counted them among main-only line-count passes ("16 of 25 are Amiri brackets after Arabic"). Triage shows main's breaks were wrong on every one.

**Objective facts to learn:**

- `c-00520dd17f45f4f9`, `suite/joined`: `بِلا`, 32px Arial, letter spacing 1px, 24.0667px.
  - Native: `بِ` / `لا`. The rebuild starts line 2 at offset 3, between lam and alef. Main is right.
  - Candidate fact: Blink's emergency break lands on a glyph-cluster boundary and never inside the lam-alef ligature (`OffsetForPosition`, shape_result.cc:2261-2363 per blink-shortcut-audit §2).
  - 204 of the 245 Chrome main-only `suite/joined` rows are class C.
- `c-08bceab4491a000c`, `kinsoku-units`: `中（ابب）` U+202F, 16px Arial, letter spacing −2px, 49px.
  - Native: 2 lines, [0,1) and [1,7). The rebuild puts U+202F on a line of its own. Main is right.
  - Candidate fact: no break before U+202F (class GL) after `）`. To be settled by a probe and by a parity test over Chrome 153's own line tables.
- `c-ed263bd4b6656704` (Firefox, `maintained/accuracy`, main requires height only): native line 2 starts at 11, `rdwithoutany…`; the rebuild starts it at 12 and reports `in-word-prefix`.
  - Candidate fact: the DOM's advance at a mid-word emergency break, measured through Firefox's cluster rects.
  - This is the probe gecko-shortcut-audit D1 asks for, and it replaces a recipe chosen by suite score.
- `c-95bbe646a6febe00` (Chrome, a Myanmar corpus paragraph, 1,666 units): native line 2 starts at 56 and the rebuild's at 53. The painted line 0 measures 528.28125px against 539.09375px predicted.
  - Candidate fact: a Canvas-versus-DOM width difference for Myanmar text, to be pinned by a probe before any recipe.
  - 51 of the 1,098 corpus paragraphs are class C in Chrome.

**Fact to learn, opinion dropped:**

- `c-9c5a66597ebf5aef`: `a` U+2060 U+0301 `b`, 16px Courier New, letter spacing −4px, width 1, `pre-wrap`.
  - Native: 3 lines, `a` / U+2060 U+0301 / `b`. Main: 3. The rebuild splits U+2060 from U+0301 and predicts 4. Breaks are unobserved because the middle line has no visible code point.
  - Main requires it only to hold its entry-geometry heuristic (INVENTORY.md:19), so the requiredness is an opinion we drop.
  - The line count is an objective fact: Chrome keeps an invisible base and its mark together at width 1. It joins the `emergency-graphemes` family.

**Opinions dropped** (from tests/wrapping/INVENTORY.md and TAKE-BACK):

- The accuracy grid's height tolerance below 1px (INVENTORY.md:11-13). The inputs are admitted at exact lineCount; the tolerance isn't.
- `wrap-4faaad4b08f18c01`, #210 in Safari 27 (TAKE-BACK §1 item 2). The line count comes from a 1/64px paragraph height divided by 20.96. That is an observer artifact; the lab counts lines from rects.
- Source-view curation (INVENTORY.md:9) and direction-conflict special status (INVENTORY.md:25). They hold main's source-ownership model and its API without a direction argument.
- Main's `api` metric and its UA-profile checks (rebuild/research/TESTS.md §1b).

**Research observations that become facts:**

- Firefox removes normal-mode newlines between wide characters (INVENTORY.md:26 `content-language`, research scope, requires nothing; settled across text nodes by CRITIC C9). Admitted as a Gecko rule family with a probe.
- Safari keeps a word's kerning with its following space (`maintained/space-kerning`, INVENTORY.md:21). The width main pinned sits between main's two measurements, which is an opinion. The browser behaviour is WebKit's following-space rule (TextUtil.cpp:76-77 per DESIGN.md §7), admitted as a WebKit family.

**Undecided:**

- Class B families: `suite/cluster-v2-new` 40, `cluster-v1` 34, `restart-next-word` 18. Their breaks can't be settled from rects. They need a discriminating probe or observer first.
- Class D: `suite/following-space-scope` 220 and `following-space-context` 150 in Chrome. They differ only in widths and wait for the observation port, because today's `width` copies the scorer's visibility rules (blink-shortcut-audit D3).

## 8. What survives, what gets rewritten, and a migration order

| Piece | Verdict |
|---|---|
| `lab/run.ts`, `lab/page.ts` | **Survive.** Background sessions, page contexts, orders, lock discipline and the Range-rect protocol are the observation layer. Additions later: app-bundle build in `run.json`, `prelude` and isolation support. Both files have uncommitted edits and the census depends on them, so nothing changes until it finishes. |
| `lab/score.ts` | **Survives as L0's observer** (`deriveNative`, `score.ts:291`). The width rules migrate with tentpole 2 into per-engine observation modules under `lab/observe/`. Engines return geometry; the lab derives what the rects will show. |
| `lab/gate.ts`, `gate.test.ts` | **Survive** with seed and check logic intact. Rewritten parts: the environment key, layer items (parity ids, fact ids), scorer version and coverage failures. |
| `lab/types.ts`, `cases/case.ts`, `prng.ts`, `sample.ts`, `build.ts` | **Survive.** `Case` gains `rules`, `split` (development or held-out), `isolation`, `prelude` and `derivedFrom` (pass A and B row ids). |
| `cases/runs.ts`, `ws.ts`, `policy.ts`, `smoke-cases.ndjson` | **Survive as L5** natural families. |
| `cases/widths.ts` | **Survives for L5 only.** Rule families use derived widths (section 2.3); the estimate (`widths.ts:1-4`) never chooses a rule family's width. |
| `cases/suite.ts` | **Survives** as the external corpus import. |
| `cases/obligations.ts` | **Rewritten** into a triage-record importer (section 7.1). |
| `baselines/gate-*.json` | **Kept as G0** until retired (below). |
| `baselines/main-predictor.ts` | **Survives** as the external comparator. |
| `probes/runner.ts`, `probes/page.ts`, `probes/types.ts` | **Survive.** `Probe` (`probes/types.ts:63-91`) gains `facts`: declared ids, scope, and a verdict rule over named decisive values. |
| `probes/*-probes.ts` | **Survive as definitions.** Check names lose embedded values; the cross-check file gets in-probe verdicts. |
| `blink-verdicts.ts`, `gecko-verdicts.ts`, `webkit-verdicts-crosscheck.ts` | **Rewritten** into one extractor and differ (`facts-extract.ts` is the prototype). |
| `rebuild/src` bun tests over real engine data | **Survive as L1.** Tests whose expected values are the port's own arithmetic (for example `engines/blink/lines.test.ts`'s `engineWidth.raw 3200` stand-in; blink-shortcut-audit §6) move to L3 replay, or are re-based on upstream tests such as Chrome's 25 Ahem line-breaker tests. |

**Migration order.** A working gate exists at every step:

1. **Now, offline.** Keep G0 (the 2026-09-16 `gate-*.json` and its seed runs) as the gate for every library change. Land the independence test (section 0, rule 1).
2. **Offline.**
   - Facts extractor and differ.
   - Record facts files from the existing probe outputs under today's names, with a note that the ids aren't final.
   - Diffs against those files join the gate.
3. **Offline.** Lock files, oracle answers moved under `rebuild/data`, and skips turned into failures. Adds L1 to the gate.
4. **After the census finishes.**
   - `run.ts` records app-bundle builds.
   - The next observation of every set seeds baselines under the new key with the library unchanged.
   - G0 stays for older rows.
5. **Offline.** Rule annotations and the coverage report, report-only at first.
6. **Browser runs.**
   - The bracket generator (passes A-D) for the first 3-5 rules: HanKerning's line-end trim, Blink's fit bound, WebKit's carried remainder, Gecko's redo, WebKit's following space.
   - Each family gets its own baseline file, seeded from two orders.
   - G0 is untouched.
7. **Sealed held-out.** Seal a new set, and move `heldout-20260916` into development. Its pairs are already in G0.
8. **Triage.** Records for Chrome (complete census), then Firefox and Safari as their chunks finish. `obligations` is rebuilt from the records; cases already in G0 keep their pairs.
9. **Tentpole 2.**
   - First commit: the observation port, re-scoring kept rows with both scorers and seeding scorer-v2 baselines with the library unchanged.
   - Second commit: engines stop computing the lab's extent and are gated against the v2 seed.
10. **Retire G0** once every G0 pair is either in a v2 baseline or attributed in the seed diff.

## 9. Decisions for the maintainer

1. Make derived-width rule families (section 2.3) the main correctness layer, with pass D bisection wherever a bracket misses, always in Safari.
2. Seal held-out sets with a committed seed hash, allow counts-only scoring, and burn on any inspection. `heldout-20260916` counts as burned.
3. Should a fact flip block that engine's gate until triaged? The recommendation is to block.
4. Should history-dependent cases gate through `fresh-process` observations and explicit preludes instead of being skipped?
5. Admit main's tests only through triage records, with the three outcomes plus "undecided".
