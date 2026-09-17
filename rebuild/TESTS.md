# Tests for the rebuild

Status, 2026-09-17, branch `rebuild-charter`. This replaces the 2026-09-16 test strategy (research/TESTS.md). That strategy made main's accuracy grid, oracles and filed reports first-class obligations. Here main's suite and obligations are a measurement corpus (CHARTER.md tentpole 5). The blocking layers are the rebuild's own:

- rule-targeted families, at widths derived from the browsers' observations;
- versioned probe facts;
- coverage of library rules.

The design is research/TEST-ARCHITECTURE.md. This document says what exists, how to run it and what the first runs found.

Terms:

- **Rule**: one library behaviour with a registry id such as `blink/lines/fit-bound-plus-one-lu`, a kind, a citation, probe labels and asserting tests.
- **Family**: paragraphs built to exercise named rules, with focus offsets where a rule should act at a line edge.
- **Target**: a question about one paragraph in one browser: at which width does the native line starting at offset s first reach offset k.
- **Bracket**: two adjacent grid widths; at one the line reaches k, at the other it doesn't.
- **Grid**: the unit available widths live on: 1/128 CSS px in Chrome at DPR 2, 1/64 in Safari, 1/60 (app units) in Firefox.
- **Environment key**: what `lab/score.ts environmentKey` names for a row: the browser, the app bundle build, the engine build, the OS build, DPR, visual-viewport scale and the scorer version.

## 1. Where things are

| Path | What |
|---|---|
| `rebuild/tests/rules.json`, `registry.ts`, `import-rules.ts`, `rule-changes.json` | The rule registry and how it's generated |
| `rebuild/tests/families/` | Family declarations (`lines.ts`, `breaks.ts`, `fonts.ts`, and `inline.ts` for inline structure, line slots, alignment and process languages), `catalogue.ts`, the family types and pairwise covering rows (`covering.ts`) |
| `rebuild/tests/fit.ts` | Each browser's fit arithmetic, from recorded probe verdicts |
| `rebuild/tests/derive.ts`, `noop-predictor.ts`, `observe-families.sh` | Width derivation and the observation loop |
| `rebuild/tests/facts.ts`, `seed-facts-20260916.sh`, `rerun-probes.sh`; `rebuild/facts/<engine>/<engine build>.ndjson` | Versioned probe facts |
| `rebuild/tests/coverage.ts` → `rebuild/tests/coverage.json` | The coverage matrix |
| `rebuild/tests/gate.ts` → `rebuild/tests/baselines/<browser>-<engine build>.json` | The layered gate |
| `rebuild/tests/independence.test.ts` | No expected value from `rebuild/src` |
| `rebuild/lab/browser-build.ts` | Reads the build from the app bundles for `lab/run.ts` and `probes/runner.ts` |

- `bunx tsc --noEmit -p rebuild/tests/tsconfig.json`
- `bun test rebuild/tests`: 35 tests in 8 files.

Derived case files, rows and derivation records live under `.artifacts/charter-20260916/tests/families-20260916/<browser>/`. A baseline names its case file with a sha256.

## 2. Layers

| Layer | Proves | Expected values from | Code | In the gate |
|---|---|---|---|---|
| L0 observer | The scorer compares rects by its stated rules | Hand-built rows | `lab/score.test.ts` (scorer owner) | bun |
| L1 engine data parity | Tables and shared algorithms equal the engines' libraries | ICU, BidiTest, recorded answers | `rebuild/src` bun tests (owners) | bun; counted as coverage through registry tests |
| L2 browser facts | A claim about one browser build holds | Probe observations with in-probe verdicts | `rebuild/facts`, `facts.ts` | blocking: flips and missing facts |
| L4 rule families | Named rules match the browser at the widths where its decision changes | Native observations at derived widths | `families/`, `derive.ts` | blocking: lost pairs |
| L5 natural families and main's corpus | Realistic paragraphs and main's suite, measured | Native observations | `lab/cases` | report only |
| L3 replay, L6 held-out | | | not built (§12) | |

## 3. Rule registry

- `bun rebuild/tests/import-rules.ts` writes `rules.json` from the 2026-09-16 catalogue (399 rules) and `rule-changes.json`:
  - 28 rules removed, each with its replacement: the lab-visibility widths, the choices by score and the name keys the owners replaced;
  - 7 reclassified;
  - 99 added: 44 from the owners' stage 1 reports, and 55 for stage 5 (2026-09-17).
  - 470 rules are current.
- `declaredBy` says where an id comes from:
  - the catalogue;
  - the Blink owner, who declared ids;
  - `provisional`, for 19 WebKit and Gecko replacements that the owner reports gave only as table rows;
  - `provisional (stage 5, feature families 2026-09-17)`, for the 55 stage 5 rules. They come from DESIGN.md §1.1, §2.9 and §8.3 stage 5 with the architect's citations; the engine owners confirm or rename them when they annotate the source.
- The stage 5 rules are 17 Blink, 17 WebKit and 16 Gecko rules for box edges, per-element styles, atomic inlines, `<br>`, `<wbr>`, text-indent, text-align and line slots; 3 observation rules for `Element.getClientRects()`; and 2 observer assumptions (kind `observer assumption`): `shared/lab/vertical-centre-grouping` and `shared/lab/slot-rows`.
- A rule's source annotation is `// rule <id>` in `rebuild/src`. `coverage.ts` lists rules without one (all 470 today) and annotations the registry doesn't know. Once owners annotate, the registry is regenerated from the annotations.

## 4. Rule-targeted families

A family declares:

- its name;
- rule ids per engine, which decide the browsers it runs in;
- `why`: the cited source or verdict behind its axes;
- relevant axes, covered exhaustively;
- neighbour axes, covered by pairwise covering rows, where every pair of values of two axes appears at least once (deterministic, greedy);
- a builder: from one combination and a seeded random stream, a paragraph with focus offsets. Background values that no rule reads are drawn from that stream.

Axis values that only move the focus give the same paragraph; they fold into one with the union of their focus offsets. Characters and fonts are written into the builders with their class noted, and nothing imports `rebuild/src`.

| Family | Engines | Relevant axes | Paragraphs |
|---|---|---|---:|
| fit-bound | all | words × size 16, 13, 17.3 | 90 |
| following-space | all | kerning word end × one, three or NBSP spaces × Arial, Times New Roman | 72 |
| controls | all | CR, FF, VT × normal, pre-wrap, pre-line, break-spaces | 48 |
| tabs | all | tab-size 0, 1, 4, 8 × pen position × Arial, Helvetica Neue, Menlo | 144 |
| hanging-white-space | all | trailing white space × pre-wrap, break-spaces, normal | 60 |
| forced-breaks | all | U+2028, U+2029, LF × normal, nowrap, pre-line, pre-wrap | 48 |
| rewind | all | prefix × word length × span placement | 72 |
| in-word-breaks | all | AV, Wa, ffi and n words × break-all, anywhere, break-word | 72 |
| languages | all | lang "", en, ja, zh, ko × line-break × text the tables disagree on | 120 |
| hyphen-classes | all | word-break × loose × `-`, U+2010, U+2013 × preceding letter, digit or ideograph | 108 |
| quotes | all | lang da, de, sv, en, fr, ja, "" × quote pair × ideograph or letter | 112 |
| keep-all-storage | all | punctuation, spaces, ZWSP × 8-bit or 16-bit node × keep-all or normal | 48 |
| segment-breaks | all | newline between wide characters, punctuation, ZWSP × lang × node edge | 80 |
| clusters | all | Bengali ya-phala and conjuncts, marks, Thai × break-all, anywhere, line-break anywhere | 48 |
| urls | all | slash, hyphen and query words × overflow-wrap | 32 |
| zwnj | all | white-space × ZWNJ placement × ZWNJ at a span start | 36 |
| hankerning | Blink | close, open, dot and comma marks × line end, start, middle × Hiragino Sans, PingFang SC, Songti SC | 90 |
| hyphen-glyph | all | fonts on both sides of mapsHyphen × one or two soft hyphens × letter spacing | 96 |
| joining | all | Geeza Pro (AAT), Arial, Noto Naskh Arabic, Amiri × soft hyphen, break-all, anywhere × span edge | 96 |
| monospace | all | Menlo, Courier New, Monaco, Arial × break-word, anywhere × word | 64 |
| system-fonts-and-sizes | all | system-ui, BlinkMacSystemFont, -apple-system, Georgia × 13, 17, 20.5, 13.33, 16.8px | 80 |
| object-replacement | Blink | U+FFFC placement × font | 36 |

Totals:

- Chrome: 1,652 paragraphs in 22 families.
- webkit-host and Firefox: 1,526 paragraphs in 20 families each.

**Stage 5 families** (`families/inline.ts`, 2026-09-17). Their paragraphs are trees (lab/types.ts `InlineStructure`, built with `lab/cases/build.ts` `treeParagraph`); a tree that is flat becomes an ordinary flat case with its flat id.

| Family | Engines | Relevant axes | Paragraphs per engine |
|---|---|---|---:|
| box-edges | all | padding, border, margin or negative margin × start, end or both sides × a span holding a word, crossing a break, or inside a word | 288 |
| nested-box-edges | all | end edges on the inner, outer or both spans × padding, border and padding, or margin × start edges or none | 72 |
| nowrap-spans | all | nowrap in normal, normal in nowrap, pre-wrap in nowrap, nowrap in pre-wrap, pre in normal × where the spaces sit against the span edges | 80 |
| atomic-inlines | all | letter, space, NBSP or ideograph before × the same after × normal block, nowrap span or pre-wrap block | 288 |
| br-elements | all | word, space, spaces and tab, or nothing before × word, space and word, or a second br after × normal, pre-wrap, pre-line, break-spaces | 192 |
| wbr-elements | all | Latin, Hangul, before a space, ideographs × normal, keep-all, break-all × normal, pre-wrap, inside a nowrap span | 144 |
| text-indent | all | 16, 40.3, −12, −40px × words, a tab, a br, a long word × LTR, RTL | 128 |
| text-align | all | start, end, center, justify, left, right × LTR, RTL × a last word that kerns with the space | 144 |
| line-slots | all | equal rows, a wide first row, a wide second row × left, right, both × 40 or 37.3px × words, a long first word, tabs | 216 |
| process-languages | Blink | `a”b`, small kana, iteration marks, a middle dot × lang="" on the block, a span, a span inside `lang=ja` × auto, strict, loose; derived under two application locales | 72 |

Totals: Chrome 1,624 paragraphs in 10 families (and the 72 process-languages paragraphs again under en-US); webkit-host and Firefox 1,552 in 9 each.

## 5. Deriving widths from observations

`bun rebuild/tests/derive.ts --browser=<browser> --dir=<dir>` runs one offline step. It exits 10 and prints the case files to observe, or exits 0 once `<dir>/final` holds the family cases. It reads native rows only; derivation runs use `noop-predictor.ts`, so no library code runs in the page.

- **Pass A.** Width 1 with overflow-wrap normal, plus width 1 with the paragraph's own styles when its overflow-wrap isn't normal. Line starts after the first line are break opportunities.
- **Pass B.** Width 100000px. The extent of [s, k) is the right edge of its code points' positive rects minus their left edge, without trailing SPACE, TAB or LF in the modes where they hang.
- **Targets.**
  - Wave 1 starts at 0 and after every forced break.
  - At each focus offset the candidate there is chosen, or the nearest candidates on each side, excluding the opportunity the line at s reaches at width 1.
  - Wave 2 starts at the native line starts that follow wave-1 lines at the derived and bracket widths. Among them are the line after a first word, where overflow-wrap breaks, and the line after a HanKerning trim.
- **Pass C.** Each target is observed at the derived threshold T, at T minus one grid unit, and at T ± 1, 4 and 16px. T comes from recorded facts (`fit.ts`):

  | Browser | Fits when | Recorded by |
  |---|---|---|
  | Chrome | C ≤ trunc(width × 64 × DPR) + 1 LayoutUnit, so T = C − 1 | blink-lines H2: 11959/128 content, 1 line at 93.421875, 2 at 93.4140625 |
  | Safari, webkit-host | first one-line width ceil(64 × E) − 1 LayoutUnits | probes-safari "Item widths"; webkit-lines H3: 2985/64 |
  | Firefox | content au ≤ round(width × 60) | gecko-lines H1: 5184 au fits at 86.4px, not at 86.38px |

- **Pass D.** While the nearest widths where the line reaches k and where it doesn't are more than one grid unit apart, 16 widths between them are observed, for at most 6 rounds.
- **Limits.** 4 targets per segment in wave 1; 2 per line start and 4 per paragraph in wave 2; at most 12,000 cases per file.
- **Outcomes.**
  - resolved: a bracket, with its offset from T in grid units;
  - no reach: no observed width has a native line at s that reaches k. Most are wave-2 line starts that exist only while the paragraph wraps;
  - unresolved, with a reason:
    - `no-line-inside`: every width inside the window was observed without a line starting at s;
    - `no-short-width`: no width below the window where the line doesn't reach k;
    - `rounds-exhausted`: bisection ran out of rounds.
- **Line keys.** A native line's key is its lowest code point offset with a positive rect, under `score.ts nativeLines` grouping (an observer assumption). Keys only decide where to look. An atomic inline, `<br>` or `<wbr>` holds no offset, so a break just before an atomic inline and one just after it have the same key; the bracket at that key still includes the box when the line can't break before it.
- **Consistency.** Derivation refuses rounds observed under another build, DPR or set of given process languages.
- **Structured paragraphs** (stage 5):
  - Pass A cases leave out the line slots and the text-indent: break opportunities are properties of the content, floats wider than width 1 stack past their rows, and a negative indent lets the first line hold more than one piece. Pass A sets `overflow-wrap: normal` on every span as well as the block.
  - No sized pass is narrower than the widest row's left plus right insets. Below that the row's floats don't fit side by side and one drops into the next row, which breaks the slot protocol (DESIGN.md §2.9).
  - T adds the first row's insets, and for targets starting at 0 the text-indent, to the extent. Box edges and atomic inlines aren't added; where they decide a bracket, pass D finds it.
- **Outputs** in `final/`:
  - `family-cases.ndjson`: per paragraph the A and B cases, and per resolved target the reach and short widths;
  - `derivation.ndjson`: each case's family, rules, role, target, offset and the case ids it was derived from;
  - `summary.json`: per family targets, resolved, at the derived width, the offset histogram and unresolved reasons.

`bash rebuild/tests/observe-families.sh <chrome|webkit-host|firefox> <dir>` loops:

1. Derive.
2. Observe each case file as one job under `with-browser-lock.py`. `run.ts` reads the app bundle build into every row, checks it against the user agent and records it in `run.json`.
3. Repeat until `final/` exists.
4. Run the family file in file order and reversed with `lab/predictor.ts`, and score both with `--native-compare`.

It stops after one failed job, and pauses 20 s after every hold of the lock. Environment:

- `FAMILIES=a,b`: derive only these families, read when the directory is first planned.
- `LAB_RUN_ARGS`: more `run.ts` arguments for every job, such as `--chrome-apple-languages=en-US --chrome-accept-languages=en-US,en`.
- `FINAL_RUNS=native`: the final runs use `noop-predictor.ts`, into `final/native-file` and `final/native-reverse`, and compare only native observations. This is for families whose inputs the engine ports don't implement yet. Coverage doesn't read these runs.

## 6. First runs, 2026-09-16/17

macOS 27.0 (26A428), DPR 2. Chrome 153.0.8010.48; webkit-host on WebKit.framework 22625.1.29.11.27 (Safari 27.0); Firefox 156.0. All jobs ran under the lock, between census chunks. The final runs predicted with font facts attached (`lab/font-facts.ts`, landed 23:55).

| Browser | Families | Paragraphs | Rounds | Targets | Resolved | At derived width | Unresolved | No reach | Non-monotone | Family cases |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Chrome | 22 | 1,652 | 15 | 5,335 | 4,053 | 2,864 | 444 | 838 | 16 | 10,976 |
| webkit-host | 20 | 1,526 | 17 | 4,406 | 3,438 | 149 | 229 | 739 | 8 | 9,584 |
| Firefox | 20 | 1,526 | 13 | 4,428 | 3,447 | 2,846 | 261 | 720 | 0 | 9,584 |

Unresolved reasons: all 444 in Chrome and all 261 in Firefox are `no-line-inside`; webkit-host has 227 `no-line-inside` and 2 `rounds-exhausted`.

What the offsets say:

- **Chrome.**
  - The next most common offset after 0 is −1 LayoutUnit: code point rects are rounded outward, so extents overshoot (TENTPOLES-CRITIC §2.E item 1).
  - hankerning has 36 brackets at −1,024 and −1,025: the 8px line-end trim of blink-lines H15.
  - hyphen-glyph brackets sit at 682, 766 and 930: the hyphen's width, which pass B's extent leaves out.
- **webkit-host.** 149 of 3,438 brackets at the derived width; most offsets are −3 to −105 units of 1/64px, because Safari snaps partial Range edges outward to whole px. Bisection is the protocol there, as TEST-ARCHITECTURE §2.3 expected.
- **Firefox.** 2,846 of 3,447 at the derived width. hyphen-glyph at 320 and 359 au is the hyphen. hyphen-classes at 1,068-1,074 au, urls at 1,760-2,349 au and in-word-breaks at 1,458-1,778 au aren't traced.

Scores of the forward runs, compared with the reverse runs:

| Browser | Cases | lineCount pass / fail | breaks pass / fail | widths pass / fail / unobserved / not applicable | painter pass / fail / unobserved | History-dependent |
|---|---:|---|---|---|---|---:|
| Chrome | 10,976 | 10,740 / 236 | 10,640 / 336 | 10,160 / 416 / 64 / 336 | 9,985 / 927 / 64 | 0 |
| webkit-host | 9,584 | 9,447 / 131 | 9,365 / 213 | 8,764 / 290 / 311 / 213 | 8,330 / 1,051 / 197 | 6 |
| Firefox | 9,584 | 9,422 / 162 | 9,166 / 418 | 8,481 / 685 / 0 / 418 | 8,048 / 1,536 / 0 | 0 |

Families with the most line count or break losses. These are measurements of the library today, not yet attributed; counts include each paragraph's A and B cases.

- **Chrome:**
  - object-replacement: lineCount 216 of 348, no width passes (U+FFFC, blink-shortcut-audit C-u4);
  - languages 828 of 848; quotes 504 of 516; joining 702 of 718; tabs 784 of 796; following-space 272 of 288.
- **webkit-host:**
  - joining: lineCount 681 of 752, breaks 654, widths 444;
  - controls: lineCount 312 of 336, breaks 288, widths 174;
  - hanging-white-space 226 of 238; keep-all-storage 371 of 376.
- **Firefox:**
  - system-fonts-and-sizes: lineCount 620 of 680, breaks 500, widths 216;
  - joining: lineCount 680 of 736, breaks 606;
  - fit-bound: lineCount 341 of 360, breaks 330, widths 240;
  - hyphen-classes 744 of 756; hyphen-glyph 536 of 544.

### Stage 5 families, 2026-09-17

Native derivation only, seed `feature-families-20260917`, into `.artifacts/tests/features-20260917/<browser>/` (`chain.sh` there). The same builds, macOS 26A428, DPR 2. The given process languages were Chrome `uiLanguage` zh-CN (and en-US for `chrome-en-US`), webkit-host `preferredLanguages` zh-CN with ICU default `en_US_POSIX`, Firefox `regionalPrefsLocale` zh-hans-us. The final runs used `noop-predictor.ts` (`FINAL_RUNS=native`), because the ports don't implement structured inputs yet. The last column compares the native observations of the forward and reverse runs.

| Browser | Families | Paragraphs | Rounds | Targets | Resolved | At derived width | Unresolved | No reach | Non-monotone | Family cases | History-dependent |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Chrome, zh-CN | 10 | 1,624 | 12 | 7,168 | 5,011 | 3,804 | 484 | 1,673 | 180 | 12,882 | 0 |
| Chrome, en-US | 1 | 72 | 6 | 270 | 180 | 165 | 18 | 72 | 0 | 468 | 0 |
| webkit-host | 9 | 1,552 | 12 | 6,792 | 4,699 | 131 | 489 | 1,604 | 184 | 12,150 | 0 |
| Firefox | 9 | 1,552 | 12 | 6,727 | 4,627 | 3,520 | 477 | 1,623 | 186 | 11,946 | 0 |

Every unresolved target is `no-line-inside`, most of them in line-slots (336 Chrome, 332 webkit-host, 339 Firefox), where the line before it moves between rows. No native observation errors, rejected styles or missing fonts; every code point rect found its node rect (`pointRectsByCentre` 0). The smoke runs before the chain saw one rect per `<wbr>` in Firefox and none in Chrome and webkit-host.

What the offsets say. They are lengths the derivation leaves to pass D, so they show the rules at work:

- **Box edges.**
  - Chrome: 6px (134 brackets); 0.3984375px (86), the declared 0.4px in LayoutUnits; 0.5px (41), a 0.4px border snapped to one device pixel; −6px (30), negative margins.
  - Firefox: 6px (146), 0.4px (93), 0.5px (48).
  - Nested end edges: Chrome 8px (120) and 16px (18); Firefox 8px (136) and 16px (24).
- **Atomic inlines and nowrap spans.** 24px, 13.296875px (13.3px in LayoutUnits) and 26px (24 + 4 − 2) in Chrome, 24, 13.3 and 26px in Firefox: brackets where the line can't break before the box. Nowrap spans: 4px padding.
- **text-align, Chrome.** 32 brackets at 0.3671875px, 16 at 0.546875px and 16 at 1.109375px, where the line ends after a word that kerns with the space. They occur under `center`, `end`, `justify` and `right` in both directions (8 of 36 targets each), and never under `start` or `left`. `line_info.cc:127-175` gives NeedsAccurateEndPosition for `left` in RTL and `right` in LTR, and an RTL block has bidi (`inline_items_builder.cc:1486-1488`), so `right` in RTL and `left` in RTL aren't explained yet: a fact for the Blink owner to attribute. Firefox has every text-align and wbr bracket at the derived width, as Gecko doesn't reshape line ends.
- **Line slots.**
  - −80, −74.6 and −48.2px in Chrome, −80 and −74.6px in Firefox: the line reaching k sits below a wide first row, in a narrower row or at full width.
  - +16.95 and +28.9px in Firefox's tab paragraphs: a tab beside floats takes more room than in the unwrapped pass.
- **text-indent and br, Chrome.** −40.04, −80.08, −116.52 and −144.49px only in RTL `pre-wrap` paragraphs with a tab after the indent, and −40 to −76.5px in RTL `pre-wrap` and `break-spaces` lines that start with a preserved space after `<br>`. There the unwrapped extent overshoots, and pass D resolved every target.
- **webkit-host.** Only 131 of 4,699 brackets are at the derived width; most offsets lie between −1.3 and 0px, from partial Range edges snapped to whole px (§6 above). 144 `<wbr>` brackets sit one LayoutUnit above it.
- **Process languages, Chrome zh-CN against en-US.** 18 of the 72 paragraphs have other break opportunities at width 1: all of them `aa”bb`, whether lang="" is on the block, a span or a span inside `lang=ja`, under `auto`, `strict` and `loose` alike. zh-CN breaks after `”` and en-US doesn't, and the line-break keyword changes nothing. The 162 targets resolved under both locales have the same brackets.

### Stage 5 families with predictions, 2026-09-17

The ceiling round 1 evaluation ran the stage 5 family cases forward and in reverse with `lab/predictor.ts`, scorer 3 and the given process languages (`.artifacts/ceiling-20260917/evaluate/<browser>/features-{forward,reverse}`, REPORT.md §2.3). No row had a prediction error or `UnportedFeature`.

| Browser | Cases | lineCount pass / fail / unobserved | breaks pass / fail / unobserved | widths pass / fail / unobserved / not applicable | painter pass / fail / unobserved | History-dependent |
|---|---:|---|---|---|---|---:|
| Chrome, zh-CN | 12,882 | 12,135 / 28 / 719 | 12,135 / 28 / 719 | 6,943 / 220 / 4,972 / 747 | 6,992 / 430 / 5,460 | 0 |
| Chrome, en-US | 468 | 468 / 0 / 0 | 468 / 0 / 0 | 468 / 0 / 0 / 0 | 468 / 0 / 0 | 0 |
| webkit-host | 12,150 | 11,426 / 19 / 705 | 11,416 / 29 / 705 | 8,547 / 0 / 2,869 / 734 | 8,449 / 315 / 3,386 | 0 |
| Firefox | 11,946 | 11,270 / 6 / 670 | 11,267 / 9 / 670 | 6,254 / 0 / 5,013 / 679 | 6,245 / 233 / 5,468 | 0 |

- The unobserved line counts are `atomic-inlines` and `br-elements` lines that hold no Range rect; element rects aren't compared yet.
- Chrome's 28 line count failures are all `text-align`, under `glyph-clusters` and `unsafe-to-break`.
- webkit-host's 16 `br-elements` line count failures report `page-history` and pass alone in a fresh document (WebKit owner).
- Firefox's 6 line count and 9 breaks failures, and 2 of webkit-host's `line-slots` failures, report no gap. They are rows where row 0's two insets and the text-indent exceed the width, so the page puts row 0's right float one row lower: the slot-rows assumption doesn't hold there, and the scorer doesn't check it yet (§13).

## 7. Versioned facts

A facts file holds one engine build's facts, one record per fact and scope:

```json
{"format":"pretext-fact/1","fact":"blink-lines H2 :: …","spec":"blink-lines H2",
 "scope":{"browser":"chrome","dpr":2,"probeSet":"blink-probes"},
 "verdict":"holds","decisive":{"expected":…,"measured":…},"supplementary":false,"probeSha256":"…",
 "env":{"engine":"blink","build":"153.0.8010.48","buildSource":"given","os":null,"userAgent":"…"},
 "observedAt":"…","run":"…","holdsIn":["153.0.8010.48"]}
```

- **Verdicts.**
  - `holds` and `fails` come from a check's `ok`; `undecided` from an `ok` of null.
  - `precondition-failed` marks every check of a probe whose Gecko `pre` check failed.
  - `errored` marks a probe or observation error.
- **Scope.** A Blink check at another DPR than the run's is outside the run's scope and isn't evaluated.
- **Supplementary.** Checks named `supplementary: …` are kept and never count for a rule.
- **Ids are provisional:** some check names still carry measured values, so a fact can change id between DPRs.
- **Build.** `probes/runner.ts` now records `build` in its output. Outputs recorded before that take the build as given, and the record says so.

| File | Facts | From |
|---|---:|---|
| `rebuild/facts/blink/153.0.8010.48.ndjson` | 756 | blink-probes at DPR 2 (340) and forced DPR 1 (336); zoom probes at forced DPR 3.5 (15) and emulated DPR 2 (22); system-ui in fresh browsers (19, 17, 7) |
| `rebuild/facts/webkit/22625.1.29.11.27.ndjson` | 176 | webkit-probes in webkit-host (88) and installed Safari (88) |
| `rebuild/facts/gecko/156.0.ndjson` | 321 | gecko-probes at apd 30 (269), 60 (13), 40 (12), 27 (12), 23 (12); follow-up (3) |

- **No facts yet from:**
  - outputs that return raw values without checks: blink followups and gaps, webkit followups, gecko followups, followups-f2 and emoji-font;
  - the WebKit cross-check probes, whose verdicts a separate script decides.
- **Cross-setup diffs** (`facts.ts diff --match-scope=probeSet`):
  - webkit-host against installed Safari: 88 compared, 0 flips, 2 changed decisive values;
  - Chrome at DPR 2 against forced DPR 1: 279 compared, 12 flips. 11 are the system-ui cache-order and size claims (cross X5); 1 is blink-lines H3's DPR report. 41 decisive values changed, 61 facts missing and 57 new, mostly from check names carrying DPR values;
  - Firefox apd 30 against apd 60: 12 compared, 0 flips, 5 changed decisive values.

Per release, `bash rebuild/tests/rerun-probes.sh <browser> <previous facts file> <out dir>`:

- reruns the engine's probe set under the lock;
- extracts facts under the build the runner records;
- `facts.ts release` writes `rebuild/facts/<engine>/<new build>.ndjson` with `holdsIn` carried forward.

A flip or a missing fact exits 1. Either the browser changed (read the new source, update specs and port), or the claim depends on process history (narrow its scope to fresh processes).

## 8. Coverage matrix

`bun rebuild/tests/coverage.ts --facts=<facts files> --derived=<derivation dirs> [--previous=<coverage.json>]`.

A current rule is covered by any of:

- a listed asserting test that is present in the tree;
- a holding fact joined through its probe labels;
- an observed family: a family naming the rule, scored in that engine's browser, with at least one resolved bracket.

Reach from generic or main-derived case families is measurement and doesn't count. Also listed:

- rules with probe labels but no holding fact;
- current heuristics and choices by score;
- stale test references;
- removed rules with their replacements.

With `--previous`, a rule that loses its last observed family exits 1.

Also listed: rules with a derived family, whose family has resolved brackets in the engine's browser but no scored prediction run yet (`derivedFamilies`, counted as `derivedOnly`). They don't count as covered.

Regenerated 2026-09-17 by the ceiling round 1 evaluation, from `rebuild/facts/*` and derivation directories whose `file` and `reverse` runs are that evaluation's predicted runs: `.artifacts/ceiling-20260917/evaluate/<browser>/{families-derived,features-derived}` (plus `chrome/features-en-US-derived`), against the previous matrix: no rule lost its last observed family.

| Engine | Current rules | Covered | By tests | By facts | By families | Uncovered | Uncovered with a derived family | Probe labels without a holding fact |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Blink | 175 | 140 | 39 | 57 | 109 | 35 | 0 | 8 |
| WebKit | 144 | 103 | 23 | 47 | 91 | 41 | 0 | 10 |
| Gecko | 122 | 101 | 51 | 55 | 77 | 21 | 0 | 2 |
| Shared | 29 | 12 | 6 | 6 | 0 | 17 | 0 | 0 |

What stays uncovered:

- of the stage 5 rules, the three `Element.getClientRects()` observation rules and the two observer assumptions (`shared/lab/vertical-centre-grouping`, `shared/lab/slot-rows`). All 50 stage 5 engine rules now have an observed family;
- by kind: Blink 25 ported rules, 5 named gaps, 2 recipes and 2 heuristics; WebKit 36 ported rules, 3 named gaps and 1 recipe; Gecko 16 ported rules and 4 named gaps; shared 9 recipes, 3 ported rules, 2 heuristics and 1 choice by score;
- the new output geometry rules. Their evidence is the observation ports' tests and scorer v2's comparisons, which the registry doesn't list yet;
- builder scaffolding: `webkit/builder/*`, `webkit/ilb/*`, `gecko/script/*`;
- gaps no family triggers: dictionary breaks unavailable, page zoom, page history, float32 precision, bitmap emoji size;
- the painter's 12 rules, since painter probes haven't run.

Six current rules are still heuristics or choices by score: `blink/measure/ignorables-left-out-if-8bit`, `blink/shape/wide-group-halved`, `shared/env/engine-from-user-agent` and three painter rules.

## 9. The gate

`bun rebuild/tests/gate.ts seed|check --derived=<derivation dir> --baseline=<file> [--facts=<file>] [--coverage=<file>] [--corpus-baseline=<lab gate file> --corpus-runs=<per-case files>] [--out=<report>]`

- **Rule families, blocking.** The (case id, metric) pairs that passed in both seeding runs, forward and reverse. The seed and check rules are `lab/gate.ts`'s, with `--complete`. History-dependent cases and unstable pairs never fail.
- **Facts, blocking.** The build's facts file against the one the baseline recorded; a verdict flip or a missing fact fails.
- **Coverage, blocking.** A rule of the engine that had an observed family at seeding and has none now fails.
- **Measurement corpus, report only.** Main-derived runs (`suite/`, `obligations/`) checked against a lab G0 baseline. Losses are counted per family group and never fail.
- **Exit 2** when runs come from another environment key than the baseline (derive the families again for the new build and seed a new baseline), when the derived cases changed, or when a run wasn't scored against the other order.

| Baseline | Environment | Family cases | Pass pairs (lineCount / breaks / widths / painter) | History-dependent | Unstable pairs |
|---|---|---:|---|---:|---:|
| `chrome-153.0.8010.48.json` | Google Chrome 153.0.8010.48, macOS 26A428, DPR 2, `uiLanguage` zh-CN, scorer 3 | 10,976 | 41,695 (10,772 / 10,690 / 10,258 / 9,975) | 0 | 0 |
| `chrome-features-153.0.8010.48.json` | the same | 12,882 | 38,205 (12,135 / 12,135 / 6,943 / 6,992) | 0 | 0 |
| `chrome-en-US-features-153.0.8010.48.json` | the same with `uiLanguage` en-US | 468 | 1,872 (468 / 468 / 468 / 468) | 0 | 0 |
| `webkit-host-22625.1.29.11.27.json` | webkit-host 27.0 on WebKit 22625.1.29.11.27, `preferredLanguages` zh-CN, `icuDefaultLocale` en_US_POSIX | 9,584 | 36,038 (9,458 / 9,376 / 8,822 / 8,382) | 6 | 0 |
| `webkit-host-features-22625.1.29.11.27.json` | the same | 12,150 | 39,838 (11,426 / 11,416 / 8,547 / 8,449) | 0 | 0 |
| `firefox-156.0.json` | Firefox 156.0, `regionalPrefsLocale` zh-hans-us | 9,584 | 35,117 (9,422 / 9,166 / 8,481 / 8,048) | 0 | 0 |
| `firefox-features-156.0.json` | the same | 11,946 | 35,036 (11,270 / 11,267 / 6,254 / 6,245) | 0 | 0 |

Seeded by the ceiling round 1 evaluation (REPORT.md §2.6) with the facts files and the regenerated coverage matrix, through derivation directories that link the evaluation's forward and reverse runs (`.artifacts/ceiling-20260917/evaluate/tools/derived-dirs.sh`). Each baseline checked against its own runs: 0 lost pairs, pass.

The previous rule-family baselines were keyed on scorer 2 without process languages, so `gate.ts check` refuses the new runs by design (exit 2). Checked by the same rules without the environment check, Chrome's rule families lost 44 painter pairs (`rule/joining`, the Blink owner's fix-r12), webkit-host's 22 line counts, 22 breaks and 6 painter pairs (`rule/joining` under `rtl-shaping-across-inline-boxes`), and Firefox's none.

## 10. Main's tests

Main-derived families are a measurement corpus. In this gate they are the report-only layer. They are admitted only through triage records (TEST-ARCHITECTURE §7): an objective fact to learn, a pass main got by accident, or an opinion we drop. research/TESTS.md §1a's first-class verdicts are withdrawn. The G0 baselines in `lab/gate.ts` stay the lab's regression check until they're retired (DESIGN §8.3 stage 4); their obligations pairs should be report-only there too (TENTPOLES-CRITIC §2.E item 7).

## 11. Independence

`rebuild/tests/independence.test.ts` checks every file under `rebuild/tests`, `rebuild/lab` and `rebuild/probes` except `lab/predictor.ts`, the prediction adapter. They may import from `rebuild/src` only:

- types from `src/model.ts` and `src/env.ts`;
- constants from those two files that aren't functions, such as `UNKNOWN_FONT_FACTS` and `PINNED_BUILDS`.

Engine or library logic fails the test. It passes today.

## 12. Per browser release

1. `run.ts` and `probes/runner.ts` read the new build from the app bundles; rows and outputs carry it.
2. `rerun-probes.sh` per browser: a new facts file, and flips block that engine.
3. `observe-families.sh` into a new derivation directory, deriving the families under the new key.
4. `coverage.ts` over the new facts and derivation directories, with `--previous`.
5. `gate.ts check` against the previous key exits 2 by design. Attribute the old key's pairs against the new runs (browser change, observation problem, history dependence, scorer change), then seed the new key.

A macOS update moves all three keys.

## 13. Not built yet

- L3 offline replay: full Canvas call logs in rows (DESIGN §8.3 stage 0).
- Triage records for the census's main-only rows (§7).
- Lock files and oracle answers under `rebuild/data`, with skipped oracle tests turned into failures (§5).
- Environment reruns for rules that read DPR or app units: forced DPR 1 in Chrome, other apd in Firefox. `run.ts` takes no browser switches.
- Family runs in installed Safari; webkit-host stands in. The ceiling evaluation's combined families file never reached installed Safari, because its first job stopped (REPORT.md §2.7).
- In-probe fact declarations with value-free check names (§4.1); painter probes.
- Page-history preludes and per-case isolation protocols (§6.5).
- For structured cases: the scorer's comparison of `elements` and the slot-rows assumption, which 11 feature-family rows break (§6); line keys that place atomic inlines.
- A second controlled locale for Firefox and webkit-host: Firefox's Mac command line passes a Cocoa `-AppleLanguages` pair on as arguments to open, and webkit-host rejects arguments it doesn't know (lab README, "Browser-process languages").
