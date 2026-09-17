# Test strategy for the rebuild

Everything here was counted offline from existing rows and scores. No browser ran. Research data is under `~/github/pretext-rebuild/.artifacts/research-20260916/test-strategy/`.

## 0. What I added to rebuild/lab

- **`cases/obligations.ts`**, plus the `obligations` kind in `cases/generate.ts`.
  - It reads the same old-suite rows as the `suite` kind (`.artifacts/rows-20260916`, main's full suite observed in Chrome 153, Safari 27.0 and Firefox 156), in one shared pass.
  - It writes 8,889 cases in 17 `obligations/<group>` families: 7,791 with requirements and 1,098 corpus canaries.
  - Each case's `origin` names main's origin label, its suite id (`wrap-…`), main's required metrics and the lab metrics required per browser.
  - The summary adds `groups` and `required` (per case: browser → lab metrics).
  - `generate.ts all` now also writes `obligations.ndjson`. The other outputs are byte-identical to `.artifacts/lab/cases/`: runs, ws, policy, smoke and suite-sample, whose summaries differ only in `file`. The full regeneration takes 8.4 s at 3.1 GB RSS.
  - `suite.ts` only gained `export` on `orderParagraph`.
- **`gate.ts`**, the no-regression gate, and **`gate.test.ts`** (14 tests). **`cases/obligations.test.ts`** has 6 tests.
- **Baselines** `baselines/gate-chrome.json`, `gate-firefox.json` and `gate-webkit.json`. Each is about 1.13 MB and 40.5k lines, with one case id per line so a diff names cases.
- A "No-regression gate" section in `rebuild/lab/README.md`.
- `bunx tsc --noEmit -p rebuild/lab/tsconfig.json`: exit 0. `bun test rebuild/lab`: 127 pass across 6 files.

How main's metrics become lab metrics (`labRequirement`):

| Main metric | Lab metric |
|---|---|
| height, lineCount | lineCount |
| richHeight, on the span-per-part variant only | lineCount |
| breaks, source (visible source placement) | breaks |
| hyphen (expected line text) | breaks |
| widths | widths |
| api | none: a contract of main's API |
| Hyphen glyph paint | none: Range rects can't establish it |

A requirement applies in the browser whose rows carried the input, when the input's own browser scope allows it. That's because measured threshold widths such as `measure('-0.47') + 0.1` are each browser's own.

## 1. Main's tests, group by group

**Verdict terms**
- **First-class**: a real browser behaviour the rebuild must keep. It's in `obligations` with required metrics.
- **Ordinary**: a valid input with no special status. The gate protects its passes once they pass.
- **Drop**: its special status existed to hold one of main's heuristics, tolerances or observer protocols in place.
- **API**: a contract of main's public surface, listed for the superset question.

"Status" means the rebuild's required pairs that passed in every seeding run, out of all required pairs (`obligation-status.json`).

### 1a. tests/wrapping case groups (cases.ts, INVENTORY.md)

| Group (cases.ts lines) | Size | Main requires | Verdict | Why | Rebuild status |
|---|---|---|---|---|---|
| Accuracy grid (388-393; INVENTORY:11) | 7,680 cases, all browsers | height, <1px tolerance | **First-class** (lineCount, exact) | App-like texts at fixed widths; nothing is tuned to main | 7,680/7,680 in Chrome, Firefox and WebKit |
| Corpora (394-404; :12) | 1,098 cases | nothing; rounded-height tolerance, normalized native source | **First-class canary** (requires nothing) | Long-form canary; the lab lays out the raw text | Only 56 of 1,098 observed in the final runs |
| pre-wrap oracle (365-379) | 15, Chrome and Safari | height, lineCount; span extractor | **First-class** | Documented user-facing mode | 15/15 Chrome, 15/15 Safari |
| keep-all oracle | 11 (10 per browser) | height, lineCount, breaks | **First-class** | Includes `wrap-06c1e0111950efed`, which main fails in Safari 27 (TAKE-BACK §1) | 20/20 pairs Chrome, 20/20 Safari |
| symbols oracle | 3, Chrome and Safari | + breaks | **First-class** | | 6/6 each |
| letter-spacing oracle | 14, Chrome and Safari | height, lineCount | **First-class** | | 14/14 each |
| discretionary (380-386) | 11; 8 have expected text | height, lineCount, widths, hyphen | **First-class** for the 8 (lineCount, breaks, widths); the 3 characterization inputs are ordinary | Soft hyphen paint contract | 23/24 Chrome, 23/24 Firefox, 17/24 WebKit. Every miss is widths unobserved ("positive soft hyphen rect at line end") |
| Filed reports: #208 (540-541), #210 flat (454-457), #212 (458-464), #214 (465-468), #225 (484-507), #274 (471-480) | 6, 2, 4, 2, 20 and 2 cases | height, lineCount, source, api | **First-class** (lineCount, breaks) | User reports | 100% in all engines (#225: 24/24 Chrome, 20/20 Firefox, 24/24 Safari) |
| Historical #210-#214 variants and controls (523-539) | 112 lab cases | nothing | Ordinary | Neighbouring probes, not reports | gate-protected |
| #210 rich witnesses (508-516) | 12 span variants | richHeight | **First-class** (lineCount on span-per-part) | Filed report | 12/12 in each engine |
| rich-boundaries (153-177) | 10 inputs → 20 lab cases; 2 required (161-162) | richHeight | **First-class** for parenthesized-item and split-word (#177/#194); the rest ordinary | | 2/2 each |
| Native rich admission, exact fit (517-522; :24) | 2 inputs | richHeight | **Drop** → ordinary | Pins main's rich fit arithmetic at thresholds from main's Canvas (10.671875, 9.651875) | passes |
| Entry geometry (118-128; :19) | 3 (Chrome 3, Firefox 2) | height, lineCount, api | **Drop** → ordinary | Holds main's entry-geometry heuristic (`src/entry-geometry.ts`) | `c-9c5a66597ebf5aef` (`a` WJ U+0301 `b`, 16px Courier New, width 1, spacing -4) fails in Chrome in both orders: native 3, predicted 4, breaks unobserved. Main passes it. This is the one required check main passes that the rebuild loses. |
| standalone-zwsp (130-132) | 1 | height, lineCount, api | **Drop** → ordinary | Pins main's ZWSP-only fix; #210's lone ZWSP already covers the behaviour | passes |
| space-kerning (138-141) | 1, Safari | height, lineCount, api | **Drop** → ordinary | Width sits between main's kerned and unkerned measurements (VALIDATION "Safari kerning across paragraphs") | passes |
| space-after-overflow (145-146) | 1 | height, lineCount, api | **Drop** → ordinary | Pins main's fix | passes |
| source-views (fixtures/source-views.ts) | 23 | nothing, but main gates lost passes | Ordinary; drop the curation | Pins main's source-ownership model for SHY, SPACE and TAB, which the lab doesn't score | gate-protected |
| Retained inputs and ordinary selection (fixtures/ordinary.ts: 20 behaviours) | 209,138 public inputs | lost-pass gate | Ordinary | The behaviours name main's internals ("restart-source-rights", "carried-versus-fresh", "partial-advance-threshold") | sampled into suite-sample |
| Policy recipes (352-363) | 3,154 plus the language, seam and acceptance recipes | acceptance recipe in ordinary | Ordinary | | gate-protected |
| content-language, kinsoku-units, closing-punctuation (185-350) | 297, 10,858 and 9,732 lab cases | nothing (research) | Ordinary | Real browser behaviour, but nothing verified as required | sampled |
| direction-conflicts (408-417; :25) | Chrome and Firefox rows | research | **Drop** special status | Exists only because main's prepare/layout take no direction; the lab paragraph carries it | ordinary |
| Observer controls (421-424) | 7 | nothing | **Drop** | Tests main's observer machinery | ordinary |
| Safari paint witnesses (426-434) | 2, Safari | quote marker: height, hyphen, widths, api; keep-all marker: height, api | **First-class** (lineCount, breaks; + widths for the quote marker) | Corroborated by engine traces and screenshots | 4/5; the quote marker's widths are unobserved |
| Emergency graphemes (435-437) | 8 | API contract `emergency-graphemes` | **First-class** (lineCount, breaks) | Browsers never split these graphemes at width 1 | 16/16 each |
| Extraction and height protocols | lineMethod span/range, heightMode exact/accuracy/corpus, fractional line-height strut, `normalizeSource` | | **Drop** | One lab observer, no tolerances | |

Reconciliation:
- Main marks 7,803 lab cases required. The suite import counts both variants of an items input.
- `obligations` keeps 7,783 of them, plus 8 grapheme cases, for 7,791.
- The 20 left out are 10 pin cases and 10 text variants of rich inputs that main requires only on the span variant.

### 1b. Main's harness and checks

| Item | Verdict | Why / replacement |
|---|---|---|
| `contracts.ts`, `createVariant` (~30 named contracts) | **API** | See 1d |
| `numeric.ts`: 5 UA profiles (chrome, safari, firefox, crios, none), 8 recipes, contracts `numeric/no-canvas`, `numeric/api-agreement`, `numeric/completion`, `materialize/*`, `numeric/cache-lifetime` | **API** for no-Canvas-after-prepare and cache lifetime; **Drop** the UA-profile branch checks | The rebuild takes the engine as an input (`Environment`); it doesn't sniff the UA |
| `snapshots.ts`, `accuracy/*.json`, `corpora/*-step10.json` | **Drop** | Replaced by `gate-*.json` and the REPORT tables |
| `baseline.json` pin and `--preserve` candidates | **Drop** | Replaced by the gate baselines |
| `report.test.ts` (17) | **Drop** the file; keep its principles in `gate.test.ts` | Net gains can't hide a loss; unobserved isn't a pass; duplicate ids invalidate a run; lost coverage is visible |
| `observe.test.ts` (21) | **Drop** | Main's observer; the lab has `score.test.ts` |
| `cases.test.ts` (7), `snapshots.test.ts` (2) | **Drop** | Main's generator and publication |
| `entry-geometry.test.ts` (3) | **Drop** | Internals of main's heuristic |

### 1c. src/layout.test.ts (191 tests)

Every test uses a deterministic fake canvas (`measureWidth`, layout.test.ts:88-128). Buckets follow explicit rules over describe blocks, test names and internal symbols (`layout-test-buckets.json`). Coverage counts a test's string literals that equal, or occur inside, some lab case text (238,524 suite cases plus runs/ws/policy and their held-out sets and the smoke cases; `layout-test-coverage.json`).

| Bucket | Tests | Verdict |
|---|---:|---|
| API contracts (shared public contracts; alignment, resume, walker and materialize tests) | 32 | **API** (1d) |
| Segment-model pins (prepare invariants: "keeps X attached / glue") | 57 | **Drop**: they assert main's `segments` arrays |
| Fake-canvas layout pins (letter spacing, pre-wrap tabs and hanging at synthetic widths) | 52 | **Drop**: the same behaviours are lab families (ws, runs letter-spacing spans, the letter-spacing and pre-wrap oracles) |
| Internal-module pins (`analyzeText`, fit cache, `isIndependentSymbolRun`…) | 14 | **Drop** |
| Engine facts through main's profiles (named engines, UA or issue) | 36 | **Convert the facts into lab cases** |

Overall:
- 63 tests have a literal equal to a lab case text.
- 77 tests only have literals inside lab case texts.
- 41 tests have no literal in any lab case.
- 10 tests have no text literals.

Of the 36 engine-fact tests, 33 have at least one text no lab case holds, and 20 have no literal equal to any case text. Examples:
- :706, Gecko breaks after a slash: 37 literals, 0 exact (`and/or`, `~/src/layout.ts`)
- :674, Gecko hyphen before a number: 31 literals, 1 exact (`log-2026`, `crash-log-2026-09-12.txt`)
- :739, #293 marks after CJK: 34 literals, 0 exact (`丙/first`)
- :915, newlines next to ZWSP: 30 literals, 0 exact
- :966, WebKit NEL: 28 literals, 2 exact
- :1883, keep-all pair models: 76 literals, 0 exact
- :3621, Safari kerning with a following space: 30 literals, 1 exact
- :3175, Firefox pre-wrap tab: 7 literals, 0 exact
- :1339 and :1380, Blink soft-hyphen retreat: 18 and 8 literals, 1 and 0 exact

These are real browser facts that main found. The rebuild ports the same rules from engine source, but the lab has never observed these shapes. Until a generator emits them with width sweeps (1px steps from 1 to the text width, as kinsoku-units does), the superset claim doesn't cover them.

### 1d. Main's API contracts (superset list)

From contracts.ts, numeric.ts and the API bucket:

1. `prepare`/`layout` agrees with `prepareWithSegments`/`layoutWithLines` (`opaque-rich-agreement`, `batch-result`).
2. No Canvas call after preparation (`numeric/no-canvas`, `materialize/no-canvas`; layout.test.ts:487).
3. One prepared handle at many widths equals fresh prepares (:450).
4. Source coverage: forward, nonoverlapping ranges; only collapsed SPACE, inactive SHY/ZWSP and pre-wrap LF may fall between lines (`source-coverage`).
5. Emergency lines keep graphemes whole (`emergency-graphemes`, `emergency-source-text`).
6. `measureLineStats` equals the batch result (`stats-agreement`); `measureNaturalWidth` is the widest forced line (:3423).
7. Streaming at a fixed width equals the batch result (`fixed-stream`), and text and range stepping agree (`stream-range-agreement`). Input cursors aren't mutated; JSON-copied cursors and ranges resume identically (`cursor-json-resume`, `range-json-copy`, `line-rematerialization`); streaming makes progress (`cursor-progress`).
8. Variable-width streaming covers the source (`variable-stream`; :3085, :3110).
9. `walkLineRanges` equals the batch result, and visitor mutation can't change later lines (`range-walker`).
10. Rich inline: `rich-cursor-input-immutable`, `rich-source-coverage`, `rich-range-json-copy`, `rich-line-rematerialization`, `rich-cursor-progress`, `rich-stats-agreement`, `rich-range-walker`, `rich-boundary-space`, `rich-source-item-coordinates`, `rich-visitor-isolation`, `rich-atomic-item`, `rich-atomic-width`, `rich-atomic-stats`.
11. `setLocale` resets and cache lifetime (`numeric/cache-lifetime`; :2259).
12. A negative width lays out like 0 (:1141).

Against the rebuild's surface (`layoutParagraph(paragraph, env)`, an internal `nextLine`, and a `LineStart` valid only at its own width; REPORT §1.2):
- 4, 5 and the visible half of 6 map onto the lab's breaks metric natively.
- 2, 3, 7 (resume), 8 (variable width), 9, 10 and 11 have no counterpart.
- The rebuild has no test of its own continuation contract.

## 2. The rebuild's tests

### 2a. Bun tests

`bun test rebuild/src` runs 137 tests (REPORT §3); per-file counts below are literal `test(` occurrences.

| File | Tests | What it pins | Keep? |
|---|---:|---|---|
| breaks/rbbi.test.ts | 4 | libicucore 78.1 and Chrome 153 icudtl tables against recorded ICU C probes and dumped bytes | **First-class**: oracle conformance |
| unicode/ubidi.test.ts | 9 | BidiTest-17, BidiCharacterTest, seeded fuzz against clang-built icu4c; D-cases | **First-class** |
| unicode/unicode-bidi.test.ts | 8 | Crate conformance and D-cases | **First-class** |
| unicode/grapheme.test.ts | 1 | GraphemeBreakTest-17.0.0 per engine | **First-class** |
| unicode/bidi.test.ts, engines/gecko/props.test.ts | 3, 1 | Generated data equals ICU 78.2 / icu_properties 2.1.2 / Unicode 17 | **First-class** |
| engines/blink/script.test.ts | 47 | Blink's own script_run_iterator_test.cc cases | **First-class**: upstream test port |
| engines/blink/content, lines, breaks | 6, 4, 2 | Spec examples with source citations | Keep |
| engines/webkit/breaks.test.ts | 18 | BreakablePositions tsv, libicucore tables, installed-browser verdicts H1-H23 | Keep; re-check after each Safari release |
| engines/gecko/gecko.test.ts | 31 | Probe verdicts H1-H24, groundwork oracle cases, TransformText, and B1-B4, the rebuild's own Canvas recipes | Keep; B1-B4 are the rebuild's own recipes and need their probes re-run per Firefox release |
| index.ts, env.ts, model.ts, paint.ts, measure/, gap reports | 0 | none | **Gap**: the painter is checked only through the lab painter metric |

`bun test rebuild/lab`: 127 tests across 6 files: score.test.ts, cases/case.test.ts, cases/font.test.ts, cases/suite.test.ts, gate.test.ts (new, 14) and cases/obligations.test.ts (new, 6).

### 2b. Probe sets

Counts are from `runner.ts --dry-run`; check counts are from the existing outputs.

| Browser | Probe files |
|---|---|
| Chrome | smoke 16 · blink-probes 96 (DPR 2 run: 95 probes, 353 checks, 321 ok) · zoom 7 · sysui 4 · sysui-domfirst 1 · followups 5 · gaps 2 · ignorables 30 (Chrome only, raw widths, no checks) |
| Firefox | gecko-probes 99 (main run: 98 probes, 259 checks, 256 ok) · followups 2 · emoji-font 1 |
| WebKit | webkit-probes 89 (Safari only: 74 ok, 4 not ok, 10 with no decisive expectation) · crosscheck 140 (118 in the host run; verdicts by tool) · followups 7 |

### 2c. Lab case families

- runs: 7 families, 2,580 cases (held-out 2,579)
- ws: 3 families, 1,019 (1,022)
- policy: 8 families, 1,606 (1,604)
- smoke: 300, plus 25 hand-written cases
- suite import: 238,524 cases in 387 families from 707,431 row inputs; suite-sample 20,000 (held-out 10,000)
- obligations: 8,889 in 17 families (new)

## 3. The gate

Usage:

```
bun rebuild/lab/gate.ts --baseline=rebuild/lab/baselines/gate-<browser>.json --runs=<per-case files or dirs> [--complete] [--allow-uncompared] [--out=report.json]
bun rebuild/lab/gate.ts --seed --engine=blink|webkit|gecko --engine-version=<label> --note=<text> --baseline=<file> --runs=...
```

**Seeding**
- A (case, metric) pair is a baseline pass only if every seeding run observing the case passed it.
- A pair that passes in some seeding runs and not others is `unstable`.
- Cases a seeding run marked history-dependent hold no pairs.
- Observed cases that pass nothing are listed in `withoutPasses`, so coverage and diffs see them.

**Checking**
- Exit 1 on a lost pass: a baseline pass that isn't a pass in any current run observing the case. unobserved and not-applicable count as losses.
- With `--complete`, exit 1 also when a baseline case with passes isn't observed.
- New passes are reported.
- History-dependent cases, current or at seeding, and unstable pairs never fail; the report lists them.
- Exit 2 for runs from an unrecorded environment (DPR, scale, user agent), another engine, or scoring without `--native-compare`.
- Seeding over an existing baseline prints the pairs lost and gained.

**Seeded baselines** (`seed-gates.sh`): 18 runs per browser, forward and reverse of all dev and held-out sets. WebKit adds installed Safari's and webkit-host's combined forward runs, for 22.

| File | Cases | Pass pairs (lineCount / breaks / widths / painter) | History-dependent cases | Without passes | Unstable pairs |
|---|---:|---|---:|---:|---:|
| gate-chrome.json | 40,446 | 147,776 (40,191 / 39,535 / 30,078 / 37,972) | 0 | 137 | 0 |
| gate-firefox.json | 40,340 | 146,474 (39,929 / 38,880 / 30,990 / 36,675) | 339 | 48 | 0 |
| gate-webkit.json | 40,385 | 142,309 (40,036 / 39,471 / 28,297 / 34,505) | 241 | 88 | 17 |

The 17 unstable pairs sit on 16 cases:
- 6 in `suite/original-vs-reshaped-admission` (Amiri brackets)
- 2 in `runs/mixed-fonts-sizes`, including `c-2abe3876793e1120`
- 2 in `ws/controls`
- one each in `policy/zh-lang`, `suite/hanging-FIGURE`, `suite/hanging-NBSP`, `suite/hanging-ZWSP`, `suite/U+001E/middle` and `suite/accepted-l`

**Validation**
- Each baseline gated against its own runs with `--complete` gives 0 lost passes.
- Installed Safari's two combined runs alone also pass against gate-webkit.json.
- **Cross-check:** a baseline seeded from main's rescored per-case files, with the rebuild's forward suite runs gated against it. The lost pairs are main-only passes.

  | Browser | Main-only lineCount (dev / held-out) | Rebuild-only lineCount (dev / held-out) |
  |---|---|---|
  | Chrome | 25 / 24 | 4,513 / 3,533 |
  | Firefox | 14 / 6 | 2,015 / 2,258 |
  | webkit-host | 5 / 20 | 4,225 / 3,171 |

  These equal REPORT §2.3.

  All main-only pairs, over every metric (dev / held-out): Chrome 35 / 42, Firefox 28 / 17, webkit-host 11 / 65. Among them, only three sit on cases main requires, or on obligation cases:
  - the entry-geometry pin
  - Firefox breaks on accuracy case `c-ed263bd4b6656704` (main requires only height there)
  - Chrome breaks on corpus case `c-d5eb3c81229a2b09`

## 4. Per browser release

**Order**, all background under the lock:
1. probe smoke
2. the engine's probe set
3. the lab dev sets, held-out sets and `obligations`, each in file order and reverse
4. `score.ts --native-compare`
5. the gate

**Probe sets to re-run**

| Browser | Probe files to re-run |
|---|---|
| Chrome | blink-probes.ts at native DPR 2 and forced DPR 1 · blink-ignorables.ts (the U+2060 substitution recipe; 27 of 29 strings equal) · blink-probes-sysui.ts in a fresh browser (system-ui cache order) · blink-probes-zoom.ts only when a zoom claim changes |
| Firefox | gecko-probes.ts main set · `GECKO_PROBE_SET=apd` at apd 60/40/27/23 when emoji size or font-size quantization might move · gecko-emoji-font.ts and gecko-followups.ts (the text-presentation emoji state behind history-dependent rows) |
| WebKit | webkit-probes.ts in webkit-host and installed Safari, compared with `compare-probes.ts` · webkit-probes-crosscheck.ts when a verdict flips · webkit-followups.ts (break-position cache, string storage), in a fresh host process |

The follow-up and gap probes from 2026-09-16 were one-off questions whose answers now live in the specs; they don't need re-running.

What's missing is a tool that diffs one probe file's check vector (probe id, check name → ok) between two outputs. The verdict scripts summarize a single output.

**Browser updates**

Detection:
- The installed app versions today are Chrome 153.0.8010.48, Firefox 156.0, Safari 27.0 and WebKit.framework 22625.1.29.11.27 (Info.plist).
- The gate's environment string holds the user agent. That is `Chrome/153.0.0.0`, `rv:156.0` and `Version/27.0`; only webkit-host's names the WebKit build.
- So the gate sees a Chrome major-version change, but not a later 153 build.
- Recommended: `run.ts` records the app bundle version in run.json and the summary. `run.ts` has uncommitted edits from another agent, so I left it alone.

Procedure:
1. Keep `rebuild/src` unchanged.
2. Re-run the probes and all lab sets in both orders.
3. Seed a new baseline over the same file; git keeps the previous version.
4. Attribute every lost pair the seed prints: the browser changed, an observation problem, or new history dependence. Only then port from the new engine source and update the pinned versions in specs.

Which baselines move:
- A Chrome update moves only gate-chrome.json.
- A Firefox update moves only gate-firefox.json.
- A Safari update moves gate-webkit.json and voids the webkit-host stand-in rule until the combined Safari-versus-host comparison re-runs (lab/WEBKIT-HOST.md).
- A macOS update moves all three (system fonts, CoreText, libicucore, Apple Color Emoji) and all probe sets.
- Case files and obligations don't move. Ids are content hashes, and regeneration reproduces the bytes.
- Obligation threshold widths stay the ones each browser measured on 2026-09-16. They remain valid paragraphs; only re-observing main's suite would re-measure them.

## 5. Named limits

- **10 required width pairs the lab can't observe:** Chrome 1, Firefox 1, WebKit 8. In WebKit, 7 are `abc­` at 100px, where main's discretionary oracle establishes `abc` with no hyphen, but Safari gives the trailing soft hyphen a positive rect. Hyphen glyph paint isn't observed anywhere in the lab.
- **Corpus canaries:** only 56 of 1,098 were observed. `obligations.ndjson` is 95.6 MB, mostly corpus text.
- **Oracle browser scope:** the small oracles keep main's Chrome and Safari scope. Extending them to Firefox would add unobserved ordinary cases.
