# Rule catalogue and coverage matrix (charter tentpoles 3 and 4)

Library: rebuild/src at HEAD, unmodified. The data is in `.artifacts/research-20260916/tentpoles/rules/`:
- `rules.json`: every rule with id, engine, area, kind, statement, source citation, probes, asserting bun tests, audit id and code location (file:line of the rule's site).
- `coverage.json` and `coverage.tsv`: the matrix below per rule, with top families.
- `catalogue-{blink,webkit,gecko,shared}.ts`: the catalogue as data, with the anchors that mark each rule in an instrumented copy (`instrument.ts` writes `instr/rebuild/src` and `rules.json`).
- `census/<engine>/<set>.ndjson`: per case, the rules it reaches. `tests/test-hits.json`: rules reached per bun test file. `gaps-real/<engine>.json`: gap reports from the final lab rows.

## How the matrix was made

**Kinds.**
- *Ported rule*: a function or branch of the pinned engine source.
- *Recipe*: a Canvas stand-in for something the DOM computes, backed by source and often a probe.
- *Named gap*: a gap report condition.
- *Choice by score*: picked, or reshaped, by lab counts.
- *Heuristic*: a name key, an uncited approximation, an invented cut point, or an output rule copied from the lab scorer instead of the engine.

**Evidence per rule.**
- *Probes*: mapped by hand from code comments and the specs/probes-chrome.md, probes-firefox.md and probes-safari.md tables. The labels are the probe ids in rebuild/probes, for example `blink-lines H1`.
- *Bun tests, asserting*: a test whose expectations state the rule, found by reading the tests. *Reached*: the rule marked while each test file ran over the instrumented copy. `bun test rebuild/lab` covers no library rule, because the lab tests import no library code.
- *Census*: the instrumented copy with a stand-in Canvas (`standin.ts`). Widths are on a 1/64 em grid with an AV kern, an fi share and a fullwidth halt, and the painter runs over a fake document. Engines: Chrome DPR 2 with UI zh-CN; WebKit with preferred zh-CN; Firefox en-US.
  - Case files: dev (smoke 299, runs 2,580, ws 1,019, policy 1,606, suite sample 19,994), held-out (runs 2,579, ws 1,022, policy 1,604, suite sample 10,000) and obligations (8,020 in Blink).
  - Each case is joined to its final-20260916 forward per-case score. History-dependent cases are left out of the fail shares.
- *Real gap reports*: for gap rules, the cases whose forward lab rows (the installed browsers, real Canvas) report the gap. For gap rules they replace the census reach.
- *Case sources*:
  - rebuild-designed families: runs, ws, policy, their held-out sets, and smoke draws from them;
  - main-derived: the suite samples (main's suite import) and obligations (17 groups from main's tests).

**Classes.**
- U, uncovered: no probe, no asserting bun test, no lab case.
- M, covered only by main-derived cases: no probe, no asserting test, lab reach only from suite or obligations cases.
- L, only lab evidence: no probe and no asserting test, but lab cases reach it.
- S, chosen by lab score.
- N, the rule has probes, but none with a confirming verdict.

**Limits.**
- The census counts code paths, not accuracy. Reach under stand-in widths approximates reach under real widths.
- Three rules are marked only where content lands exactly on the fit bound: Blink `position <= available + 1`, WebKit `+ 1/64`, Gecko `≤` at equality. Stand-in widths rarely hit a bound, so these rules show little census reach even though probes and bun tests pin them.
- Bun has no `Intl.v8BreakIterator`, so the Blink census runs with dictionary breaks `unavailable`. Its dictionary-breaks-unavailable reach is an artifact; the real rows report 0.
- 854 obligation cases above 5,000 UTF-16 units were skipped. Blink's ICU rescan at every line start makes the long ones too slow offline.
- Blink's two joining gap sites share one detail string, so the real reports can't be split between them.
- Asserting tests of uneven strength:
  - WebKit's verdict tests go through a test-local copy of the opportunity rule, not the line builders.
  - Blink's oracle test is a C++ re-port that compares one ICU pass from the text start.

## Main findings

1. **14 uncovered rules**:
   - Blink: restore-removed-space; float32-precision and dictionary-breaks-unavailable, which the real rows never report.
   - WebKit: word-separator-tab-boundary, tab-size-zero, word-spacing-after-tab (heuristic E2), last-valid-breaking-position, revert-to-last-wrap-opportunity, leading-position-no-progress, dictionary-breaks-unavailable.
   - Gecko: raw-family-string-compare (heuristic E2), bengali-ya-phala, last-candidate-fallback, dictionary-breaks-unavailable.
   - Several are unreachable with block-level styles. For example, the WebKit wrap-opportunity list is filled only when the block wraps, so a nowrap line can't revert.
2. **12 rules no lab case reaches, pinned only by probes or tests**:
   - Blink system-ui at the CSS size and its optical-size gap; no case uses system-ui.
   - Gecko font-size-quantization and the optical-size family regex; every lab size is a whole px.
   - WebKit page-zoom.
   - WebKit's 7625 rule that U+2028 and U+2029 force breaks under white-space normal. Every lab U+2028/U+2029 case is pre-wrap; only the bun test H13 asserts it.
   - The Danish quote overrides; the simple builder's box-edge opportunity; Blink break-all + loose hyphen.
   - Gecko ICU4X `anywhere`: Gecko fills the breaks without calling ICU4X. Gecko's style-change word flush is unreachable in the model.
3. **10 rules covered only by main-derived cases**:
   - Blink: lang="" null locale; ZWNJ at an item start; ZWNJ split in preserve modes; no-line-box folding (3 cases).
   - Blink gaps: U+FFFC font-fallback (183 cases, all failing) and unsafe-to-break for wide groups.
   - WebKit: U+2028 appended to the bidi paragraph.
   - Gecko: a bidi paragraph after each preserved newline; a space kept before a combining mark; the space-in-shaping gap.
4. **150 rules with only lab evidence.**
   - 99 source-cited ports: Blink ShapeLine, overflow and HanKerning; WebKit Line, InlineContentBreaker, TextOnlySimpleLineBuilder and LineBuilder; Gecko scaffolding.
   - WebKit's lines, breaker, tos, ilb and output areas have no asserting bun test, and no bun test even reaches them.
   - 41 heuristics, recipes, gaps and choices by score, including all 12 painter rules; painter probes haven't run.
5. **11 choices by score**: Blink's OpenType joining constant and joinsNextLine; each engine's width copying the lab's visibility rules; WebKit canvas-language and simplified-measuring conditions; Gecko ZWJ + suffix; painter R7.
6. **Failure shares.** Rules on at least 100 scored cases, with the share of those cases failing a prediction metric:

   | Engine | Rule | Scored cases | Failing |
   |---|---|---:|---:|
   | Blink | U+FFFC gap | 183 | 100% |
   | Blink | group-edge joining gap | 364 | 86% |
   | Blink | reshaped part measured alone | 745 | 73% |
   | Blink | line-end reshape | 2,457 | 72% |
   | Blink | OpenType joining constant | 4,386 | 59% |
   | WebKit | ideograph quote rule | 813 | 22% |
   | Gecko | joinsNextLine | 3,416 | 24% |
   | Gecko | ZWJ + suffix | 7,391 | 12% |

7. **Families tentpole 4 still needs.** Each item names the rule it would exercise:
   - U+2028 and U+2029 under normal and nowrap;
   - tab-size 0, and word spacing next to tabs in pre-wrap;
   - lang="da" quotes;
   - break-all + loose before U+2010;
   - nowrap overflow with inline boxes;
   - Bengali ya-phala;
   - one family written with different quoting across spans;
   - ZWNJ in preserve modes and at item starts;
   - lang="";
   - U+FFFC;
   - system-ui and fractional sizes;
   - widths exactly at each engine's fit bound, derived from observations.

## Counts

| Group | Rules | Ported | Recipe | Gap | By score | Heuristic | With probe | Asserting bun test | Reached by bun tests | Reached by rebuild families | Reached only by main-derived cases | Only main-derived (no probe, no asserting test) | Only lab evidence | Uncovered |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| blink | 144 | 100 | 17 | 16 | 3 | 8 | 65 | 35 | 59 | 128 | 9 | 6 | 57 | 3 |
| webkit | 125 | 99 | 3 | 10 | 4 | 9 | 57 | 20 | 41 | 110 | 4 | 1 | 58 | 7 |
| gecko | 103 | 77 | 11 | 7 | 3 | 5 | 57 | 53 | 75 | 89 | 6 | 3 | 23 | 4 |
| shared | 27 | 9 | 14 | 0 | 1 | 3 | 6 | 9 | 13 | 25 | 0 | 0 | 12 | 0 |
| all | 399 | 285 | 45 | 33 | 11 | 25 | 185 | 117 | 188 | 352 | 19 | 10 | 150 | 14 |

### blink by area

| Group | Rules | Ported | Recipe | Gap | By score | Heuristic | With probe | Asserting bun test | Reached by bun tests | Reached by rebuild families | Reached only by main-derived cases | Only main-derived (no probe, no asserting test) | Only lab evidence | Uncovered |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| style | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 1 | 1 | 0 |
| shaping | 4 | 4 | 0 | 0 | 0 | 0 | 2 | 0 | 1 | 3 | 1 | 1 | 2 | 0 |
| content | 14 | 14 | 0 | 0 | 0 | 0 | 7 | 12 | 13 | 12 | 1 | 1 | 1 | 1 |
| bidi | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 3 | 3 | 0 | 0 | 0 | 0 |
| script | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 2 | 0 | 0 | 1 | 0 |
| grapheme | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 1 | 0 |
| units | 3 | 3 | 0 | 0 | 0 | 0 | 3 | 2 | 3 | 3 | 0 | 0 | 0 | 0 |
| measure | 17 | 0 | 12 | 0 | 1 | 4 | 14 | 0 | 6 | 16 | 0 | 0 | 3 | 0 |
| shape | 6 | 2 | 3 | 0 | 0 | 1 | 2 | 0 | 1 | 6 | 0 | 0 | 4 | 0 |
| lines | 29 | 28 | 0 | 0 | 0 | 1 | 10 | 6 | 10 | 27 | 2 | 1 | 15 | 0 |
| tabs | 3 | 3 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 3 | 0 | 0 | 1 | 0 |
| hyphen | 2 | 1 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 2 | 0 | 0 | 0 | 0 |
| hankerning | 8 | 7 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 8 | 0 | 0 | 6 | 0 |
| gap | 16 | 0 | 0 | 16 | 0 | 0 | 5 | 0 | 0 | 10 | 3 | 2 | 9 | 2 |
| breaks | 18 | 17 | 1 | 0 | 0 | 0 | 12 | 8 | 10 | 15 | 1 | 0 | 3 | 0 |
| shapeline | 10 | 10 | 0 | 0 | 0 | 0 | 2 | 0 | 6 | 10 | 0 | 0 | 8 | 0 |
| output | 7 | 4 | 0 | 0 | 2 | 1 | 2 | 3 | 3 | 7 | 0 | 0 | 2 | 0 |

### webkit by area

| Group | Rules | Ported | Recipe | Gap | By score | Heuristic | With probe | Asserting bun test | Reached by bun tests | Reached by rebuild families | Reached only by main-derived cases | Only main-derived (no probe, no asserting test) | Only lab evidence | Uncovered |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| content | 17 | 15 | 0 | 0 | 0 | 2 | 8 | 3 | 12 | 15 | 0 | 0 | 8 | 1 |
| measure | 16 | 10 | 2 | 0 | 0 | 4 | 9 | 0 | 3 | 14 | 0 | 0 | 5 | 2 |
| style | 2 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 1 | 1 | 1 | 0 | 0 | 0 |
| bidi | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 3 | 1 | 1 | 4 | 0 |
| builder | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 3 | 0 | 0 | 3 | 0 |
| breaks | 16 | 14 | 1 | 0 | 0 | 1 | 14 | 16 | 16 | 15 | 0 | 0 | 0 | 0 |
| lines | 17 | 17 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | 15 | 1 | 0 | 9 | 1 |
| breaker | 15 | 15 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | 13 | 0 | 0 | 6 | 2 |
| tos | 6 | 6 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 5 | 0 | 0 | 5 | 0 |
| range | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| ilb | 11 | 11 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 11 | 0 | 0 | 9 | 0 |
| output | 5 | 1 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | 5 | 0 | 0 | 5 | 0 |
| gap | 12 | 0 | 0 | 10 | 2 | 0 | 7 | 1 | 5 | 9 | 1 | 0 | 3 | 1 |

### gecko by area

| Group | Rules | Ported | Recipe | Gap | By score | Heuristic | With probe | Asserting bun test | Reached by bun tests | Reached by rebuild families | Reached only by main-derived cases | Only main-derived (no probe, no asserting test) | Only lab evidence | Uncovered |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| style | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| units | 2 | 2 | 0 | 0 | 0 | 0 | 2 | 1 | 2 | 2 | 0 | 0 | 0 | 0 |
| frames | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |
| bidi | 4 | 4 | 0 | 0 | 0 | 0 | 2 | 0 | 3 | 3 | 1 | 1 | 2 | 0 |
| textrun | 3 | 2 | 0 | 0 | 0 | 1 | 2 | 1 | 2 | 2 | 0 | 0 | 0 | 1 |
| transform | 11 | 11 | 0 | 0 | 0 | 0 | 7 | 9 | 9 | 9 | 2 | 1 | 1 | 0 |
| glyphs | 6 | 6 | 0 | 0 | 0 | 0 | 3 | 2 | 4 | 5 | 0 | 0 | 2 | 1 |
| script | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 3 | 0 | 0 | 3 | 0 |
| measure | 10 | 2 | 7 | 0 | 0 | 1 | 7 | 6 | 10 | 10 | 0 | 0 | 0 | 0 |
| linebreaker | 10 | 9 | 0 | 0 | 0 | 1 | 4 | 4 | 8 | 9 | 0 | 0 | 4 | 0 |
| icu4x | 9 | 8 | 1 | 0 | 0 | 0 | 7 | 4 | 3 | 8 | 0 | 0 | 0 | 0 |
| spacing | 3 | 3 | 0 | 0 | 0 | 0 | 3 | 1 | 2 | 3 | 0 | 0 | 0 | 0 |
| lines | 28 | 25 | 2 | 0 | 1 | 0 | 14 | 19 | 25 | 27 | 0 | 0 | 8 | 1 |
| output | 4 | 0 | 1 | 0 | 2 | 1 | 0 | 2 | 2 | 4 | 0 | 0 | 2 | 0 |
| gap | 8 | 0 | 0 | 7 | 0 | 1 | 5 | 2 | 2 | 2 | 3 | 1 | 1 | 1 |

### shared by area

| Group | Rules | Ported | Recipe | Gap | By score | Heuristic | With probe | Asserting bun test | Reached by bun tests | Reached by rebuild families | Reached only by main-derived cases | Only main-derived (no probe, no asserting test) | Only lab evidence | Uncovered |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| measure | 5 | 0 | 5 | 0 | 0 | 0 | 5 | 0 | 5 | 5 | 0 | 0 | 0 | 0 |
| bidi | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 3 | 3 | 0 | 0 | 0 | 0 |
| grapheme | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |
| breaks | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 4 | 4 | 4 | 0 | 0 | 0 | 0 |
| data | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| env | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| painter | 12 | 0 | 9 | 0 | 1 | 2 | 0 | 0 | 0 | 12 | 0 | 0 | 12 | 0 |

### Reach by case source

| Engine | Rules reached | Rebuild families and main-derived | Rebuild families only | Main-derived only | Obligations only (census) |
|---|---:|---:|---:|---:|---:|
| blink | 137 | 115 | 13 | 9 | 0 |
| webkit | 114 | 98 | 12 | 4 | 0 |
| gecko | 95 | 79 | 10 | 6 | 0 |
| shared | 25 | 25 | 0 | 0 | 0 |

## Coverage matrix

Census cells count the cases the instrumented library (stand-in Canvas) reaches the rule on: rebuild-designed families / main suite sample (dev and held-out) / obligations. The fail share is over those cases scored in the final forward runs, failing lineCount, breaks or widths. Gap cells count the cases whose real lab rows report the gap: rebuild / main. Class: U uncovered, M only main-derived, L only lab evidence, S chosen by lab score, N probes without a confirming verdict. Code locations are in rules.json.

### blink (144 rules)

**style** (1)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| lang-empty-null-locale | ported rule | 0 | 0/1 | 0/24/0 (fail 0%) |  | ML |

**shaping** (4)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| font-change-ends-group | ported rule | 1 | 0/0 | 6132/0/0 (fail 6%) |  |  |
| parity-change-ends-group | ported rule | 0 | 0/0 | 591/5174/1855 (fail 15%) |  | L |
| control-item-ends-group | ported rule | 1 | 0/1 | 511/1062/14 (fail 6%) |  |  |
| zwnj-at-item-start-ends-group | ported rule | 0 | 0/0 | 0/296/0 (fail 29%) |  | ML |

**content** (14)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| layout-text-needed | ported rule | 2 | 2/3 | 2017/269/256 (fail 11%) |  |  |
| collapse-space-runs | ported rule | 1 | 2/3 | 8868/16406/7480 (fail 4%) |  |  |
| cr-collapses-as-space | ported rule | 2 | 1/2 | 108/55/0 (fail 2%) |  |  |
| ff-vt-c0-stay-literal | ported rule | 3 | 1/2 | 101/774/0 (fail 20%) |  |  |
| paragraph-leading-space-dropped | ported rule | 0 | 1/2 | 38/27/0 (fail 3%) |  |  |
| newline-removed-next-to-zwsp | ported rule | 1 | 1/2 | 6/5/0 (fail 0%) |  |  |
| block-end-space-removed | ported rule | 0 | 1/2 | 139/154/246 (fail 14%) |  |  |
| restore-removed-space | ported rule | 0 | 0/0 | 0/0/0 |  | U |
| pre-line-space-before-newline-removed | ported rule | 0 | 1/1 | 33/0/0 (fail 0%) |  |  |
| forced-break-item | ported rule | 0 | 2/3 | 266/306/13 (fail 4%) |  |  |
| leading-preserved-spaces-get-zwsp | ported rule | 0 | 1/2 | 48/118/5 (fail 3%) |  |  |
| tab-run-control-item | ported rule | 1 | 1/2 | 163/646/4 (fail 5%) |  |  |
| zwnj-splits-preserved-item | ported rule | 0 | 0/1 | 0/590/0 (fail 28%) |  | ML |
| cr-ff-control-item | ported rule | 3 | 1/2 | 225/358/1 (fail 10%) |  |  |

**bidi** (3)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| enable | ported rule | 0 | 1/1 | 3783/18771/3780 (fail 13%) |  |  |
| ltr-unmixed-turns-bidi-off | ported rule | 0 | 2/1 | 1982/3840/899 (fail 1%) |  |  |
| items-split-at-level-changes | ported rule | 0 | 1/1 | 589/5106/1855 (fail 15%) |  |  |

**script** (2)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| single-latin-segment | ported rule | 0 | 0/1 | 2292/6005/2856 (fail 1%) |  | L |
| script-run-iterator | ported rule | 0 | 1/0 | 8118/24031/5164 (fail 9%) |  |  |

**grapheme** (1)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| 8bit-every-unit-but-crlf | ported rule | 0 | 0/1 | 2301/7773/2856 (fail 0%) |  | L |

**units** (3)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| layout-zoom-is-dpr | ported rule | 2 | 0/1 | 10410/30036/8020 (fail 8%) |  |  |
| lu-ceil | ported rule | 3 | 1/1 | 10368/29501/7507 (fail 8%) |  |  |
| available-width-trunc | ported rule | 3 | 1/1 | 10410/30036/8020 (fail 8%) |  |  |

**measure** (17)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| zoomed-font-size | recipe | 4 | 0/1 | 10410/30036/8020 (fail 8%) |  |  |
| system-ui-at-css-size | heuristic | 3 | 0/0 | 0/0/0 |  |  |
| explicit-context-language | recipe | 4 | 0/1 | 10410/30036/8020 (fail 8%) |  |  |
| canvas-letter-spacing | recipe | 5 | 0/0 | 1011/4047/21 (fail 4%) |  |  |
| optimize-legibility-context | recipe | 1 | 0/1 | 10410/30036/8020 (fail 8%) |  |  |
| partition-by-storage | recipe | 3 | 0/1 | 10410/30036/8020 (fail 8%) |  |  |
| raw16-rounding | recipe | 1 | 0/1 | 10358/29473/7506 (fail 8%) |  |  |
| space-as-u2028 | recipe | 1 | 0/1 | 7935/7667/5909 (fail 3%) |  | N |
| vt-ff-as-u0001 | recipe | 1 | 0/0 | 141/228/0 (fail 13%) |  |  |
| ignorables-as-u2060 | recipe | 1 | 0/0 | 447/13589/84 (fail 17%) |  | N |
| ignorables-left-out-if-8bit | heuristic | 1 | 0/0 | 205/7003/84 (fail 5%) |  | N |
| v8-short-slice-storage | heuristic | 0 | 0/0 | 5088/16431/2668 (fail 8%) |  | L |
| force-16bit-string | heuristic | 0 | 0/0 | 3157/3903/1904 (fail 6%) |  | L |
| word-spacing-in-js | recipe | 2 | 0/0 | 705/0/0 (fail 3%) |  |  |
| letter-spacing-cursive-adjust | recipe | 0 | 0/0 | 84/14/1 (fail 26%) |  | L |
| zwj-inside-group-edge | recipe | 2 | 0/0 | 1087/5478/1234 (fail 41%) |  | N |
| joining-context-opentype | choice by score | 2 | 0/0 | 410/3976/0 (fail 59%) |  | SN |

**shape** (6)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| joining-reads-5-code-points-context | ported rule | 0 | 0/0 | 1106/5486/1234 (fail 41%) |  | L |
| pair-adjustment-on-glyph-before | recipe | 1 | 0/0 | 446/946/415 (fail 3%) |  | N |
| default-ignorables-skipped-in-pair | ported rule | 0 | 0/0 | 157/10510/66 (fail 21%) |  | L |
| unsafe-to-break-offsets | recipe | 0 | 0/0 | 837/5023/924 (fail 42%) |  | L |
| wide-group-halved | heuristic | 0 | 0/0 | 9365/9148/7184 (fail 2%) |  | L |
| position-from-prefix-and-pair | recipe | 1 | 0/1 | 9757/25327/6797 (fail 9%) |  |  |

**lines** (29)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| fit-bound-plus-one-lu | ported rule | 4 | 1/1 | 0/1/0 (fail 0%) |  |  |
| leading-collapsible-space-skipped | ported rule | 0 | 1/0 | 15/0/0 (fail 7%) |  |  |
| overflow-at-space-takes-trailing-spaces | ported rule | 0 | 0/0 | 5/0/0 (fail 0%) |  | L |
| nowrap-item-added-whole | ported rule | 1 | 0/0 | 398/0/0 (fail 0%) |  |  |
| hyphen-retry-without-room | ported rule | 2 | 0/0 | 12/7042/3 (fail 23%) |  |  |
| no-result-if-overflow | ported rule | 0 | 0/0 | 3429/16242/864 (fail 11%) |  | L |
| can-break-after-item-end | ported rule | 1 | 0/1 | 9970/29486/7507 (fail 8%) |  |  |
| trailing-collapsible-spaces-skipped | ported rule | 0 | 0/1 | 4675/6073/5347 (fail 3%) |  | L |
| preserved-trailing-spaces-item | ported rule | 1 | 1/1 | 617/1130/8 (fail 4%) |  |  |
| u3000-not-collapsible-trailing | ported rule | 0 | 0/0 | 89/93/0 (fail 5%) |  | L |
| break-spaces-no-trailing-item | ported rule | 1 | 0/0 | 480/0/0 (fail 3%) |  |  |
| tab-item | ported rule | 1 | 0/0 | 163/646/4 (fail 5%) |  |  |
| generated-zwsp-break-after | ported rule | 0 | 0/0 | 48/118/5 (fail 3%) |  | L |
| cr-ff-empty-item | ported rule | 2 | 0/0 | 225/358/1 (fail 10%) |  |  |
| forced-break | ported rule | 0 | 1/1 | 266/306/13 (fail 4%) |  |  |
| open-tag-zero-size | ported rule | 0 | 0/1 | 6575/24/14 (fail 5%) |  | L |
| close-tag-break-after | ported rule | 2 | 0/0 | 4672/17/8 (fail 7%) |  |  |
| overflow-rebreak-at-size-minus-1px | ported rule | 0 | 0/0 | 979/4230/40 (fail 12%) |  | L |
| break-at-previous-opportunity | ported rule | 0 | 0/0 | 11/2544/0 (fail 2%) |  | L |
| break-anywhere-retry | ported rule | 1 | 0/0 | 1857/15607/526 (fail 12%) |  |  |
| overflow-kept | ported rule | 0 | 0/0 | 491/241/0 (fail 6%) |  | L |
| rewind-overflow | ported rule | 0 | 0/1 | 2277/1602/327 (fail 13%) |  | L |
| remove-trailing-collapsible-space | ported rule | 0 | 1/1 | 2078/617/557 (fail 7%) |  |  |
| trailing-space-truncated-without-reshape | ported rule | 0 | 0/1 | 523/348/317 (fail 6%) |  | L |
| reshaped-part-measured-alone-when-cut | heuristic | 0 | 0/0 | 2/743/0 (fail 73%) |  | L |
| split-trailing-bidi-space | ported rule | 0 | 0/0 | 6/20/0 (fail 0%) |  | L |
| rewind-trailing-open-tags | ported rule | 0 | 0/0 | 625/1/1 (fail 11%) |  | L |
| no-line-box-line-folded | ported rule | 0 | 0/0 | 0/3/0 (fail 0%) |  | ML |
| paragraph-without-line-box | ported rule | 0 | 1/1 | 31/528/512 (fail 0%) |  |  |

**tabs** (3)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| tab-stops | ported rule | 2 | 0/0 | 163/646/4 (fail 5%) |  |  |
| half-space-minimum | ported rule | 1 | 0/0 | 11/62/0 (fail 0%) |  |  |
| tab-size-zero | ported rule | 0 | 0/0 | 8/5/0 (fail 0%) |  | L |

**hyphen** (2)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| glyph-by-two-fallback-test | heuristic | 1 | 0/0 | 52/8658/22 (fail 25%) |  |  |
| shaped-alone-without-spacing | ported rule | 1 | 0/0 | 52/8658/22 (fail 25%) |  |  |

**hankerning** (8)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| font-data-from-canvas | recipe | 1 | 0/0 | 7934/19820/4906 (fail 11%) |  | N |
| applies-to-16bit-marks | ported rule | 0 | 0/0 | 2966/1641/334 (fail 5%) |  | L |
| start-context-halt | ported rule | 0 | 0/0 | 117/0/0 (fail 0%) |  | L |
| end-context-halt | ported rule | 0 | 0/0 | 47/7/0 (fail 0%) |  | L |
| open-mark-carries-adjustment | ported rule | 0 | 0/0 | 68/373/30 (fail 0%) |  | L |
| line-end-candidate-extension | ported rule | 1 | 0/0 | 259/378/10 (fail 1%) |  |  |
| line-end-halt-apply-end | ported rule | 0 | 0/0 | 259/378/10 (fail 1%) |  | L |
| halted-group-start-unsafe | ported rule | 0 | 0/0 | 51/0/0 (fail 0%) |  | L |

**gap** (16)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| han-kerning | named gap | 0 | 0/0 | 423/385/10 (fail 1%) | 295/199 (fail 2%) | L |
| control-character-width | named gap | 3 | 0/0 | 141/4235/0 (fail 21%) | 141/4235 (fail 21%) |  |
| font-fallback-u-fffc | named gap | 0 | 0/0 | 0/183/0 (fail 100%) | 0/183 (fail 100%) | ML |
| font-fallback-edge-in-cluster | named gap | 0 | 0/0 | 339/500/0 (fail 23%) | 339/500 (fail 23%) | L |
| ui-language | named gap | 1 | 0/0 | 0/24/0 (fail 0%) | 0/24 (fail 0%) |  |
| optical-size | named gap | 1 | 0/0 | 0/0/0 | 0/0 (fail 0%) |  |
| unsafe-to-break-group-edge-joining | named gap | 1 | 0/0 | 309/55/0 (fail 86%) | 361/3833 (fail 63%) | N |
| unsafe-to-break-line-edge-joining | named gap | 0 | 0/0 | 117/3904/0 (fail 57%) | 361/3833 (fail 63%) | L |
| unsafe-to-break-attribution | named gap | 0 | 0/0 | 167/186/9 (fail 10%) | 370/816 (fail 9%) | L |
| in-word-prefix | named gap | 0 | 0/0 | 5568/17558/1975 (fail 6%) | 5297/17275 (fail 7%) | L |
| soft-hyphen-shaping | named gap | 0 | 0/0 | 72/4650/80 (fail 3%) | 69/4668 (fail 2%) | L |
| script-context | named gap | 0 | 0/0 | 5844/16311/4146 (fail 12%) | 5602/15496 (fail 11%) | L |
| float32-precision | named gap | 0 | 0/0 | 12/0/0 (fail 0%) | 0/0 (fail 0%) | U |
| unsafe-to-break-wide-group | named gap | 0 | 0/0 | 27/2/1 (fail 17%) | 0/7 (fail 14%) | ML |
| tab-stops | named gap | 1 | 0/0 | 163/646/4 (fail 5%) | 163/646 (fail 5%) | N |
| dictionary-breaks-unavailable | named gap | 0 | 0/0 | 644/428/567 (fail 3%) | 0/0 (fail 0%) | U |

**breaks** (18)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| rule-file-per-locale | ported rule | 5 | 3/1 | 6286/17017/3563 (fail 13%) |  |  |
| null-locale-ui-language | ported rule | 3 | 1/1 | 0/24/0 (fail 0%) |  |  |
| ko-strict-retries-ui-language | ported rule | 2 | 1/1 | 84/0/0 (fail 0%) |  |  |
| icu-restarts-at-line-start | ported rule | 2 | 0/0 | 4441/11362/2202 (fail 13%) |  |  |
| dictionary-runs-from-running-browser | recipe | 2 | 0/1 | 644/428/567 (fail 3%) |  |  |
| space-rule | ported rule | 0 | 2/2 | 6086/6962/5475 (fail 3%) |  |  |
| break-spaces-after-every-space | ported rule | 3 | 0/0 | 447/0/0 (fail 3%) |  |  |
| hyphen-before-digit | ported rule | 0 | 2/1 | 211/55/25 (fail 18%) |  |  |
| latin1-pair-table | ported rule | 1 | 2/2 | 4695/13119/3586 (fail 3%) |  |  |
| break-all-table | ported rule | 2 | 0/0 | 247/0/0 (fail 2%) |  |  |
| break-all-loose-hyphen | ported rule | 1 | 0/0 | 0/0/0 |  | N |
| keep-all-letters-and-numbers | ported rule | 1 | 1/1 | 651/1575/8 (fail 1%) |  |  |
| icu-following-for-unknown-pairs | ported rule | 0 | 2/1 | 6286/17017/3563 (fail 13%) |  |  |
| soft-hyphen-skipped-when-disabled | ported rule | 1 | 0/0 | 0/0/0 |  |  |
| break-character-graphemes | ported rule | 2 | 0/0 | 2128/15607/526 (fail 12%) |  |  |
| previous-break-opportunity | ported rule | 0 | 0/1 | 9371/24609/6429 (fail 9%) |  | L |
| line-break-anywhere-settings | ported rule | 0 | 0/0 | 271/0/0 (fail 0%) |  | L |
| break-anywhere-if-overflow-settings | ported rule | 0 | 0/0 | 8118/30036/8020 (fail 8%) |  | L |

**shapeline** (10)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| whole-result-fits | ported rule | 0 | 0/1 | 5684/8432/2473 (fail 7%) |  | L |
| line-start-reshape | ported rule | 0 | 0/0 | 296/4120/9 (fail 53%) |  | L |
| candidate-from-position | ported rule | 0 | 0/1 | 9782/25227/6777 (fail 9%) |  | L |
| overflow-when-no-previous-opportunity | ported rule | 0 | 0/1 | 4245/16226/864 (fail 11%) |  | L |
| candidate-at-space | ported rule | 1 | 0/1 | 1971/3128/2223 (fail 4%) |  |  |
| only-trailing-spaces | ported rule | 0 | 0/0 | 460/461/61 (fail 9%) |  | L |
| no-reshape-at-space-line-end | ported rule | 1 | 0/1 | 5499/6351/5367 (fail 3%) |  |  |
| break-at-non-hangable-run-end | ported rule | 0 | 0/1 | 5200/6382/5367 (fail 3%) |  | L |
| line-end-reshape | ported rule | 0 | 0/0 | 192/2265/7 (fail 72%) |  | L |
| line-end-reshape-walk-back | ported rule | 0 | 0/0 | 45/14/0 (fail 0%) |  | L |

**output** (7)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| skipped-trailing-spaces-marked-trimmed | ported rule | 0 | 1/1 | 4674/6073/5347 (fail 3%) |  |  |
| engine-width-excludes-hanging | ported rule | 0 | 1/1 | 624/1120/8 (fail 4%) |  |  |
| hyphen-fragment | ported rule | 1 | 0/0 | 30/7025/14 (fail 24%) |  |  |
| joins-next-line-opentype | choice by score | 1 | 0/0 | 124/3909/0 (fail 57%) |  | SN |
| width-copies-lab-visibility | choice by score | 0 | 1/1 | 10379/29508/7508 (fail 8%) |  | S |
| other-space-separators-excluded | heuristic | 0 | 0/0 | 226/900/0 (fail 5%) |  | L |
| edge-caret-rounded-outward | ported rule | 0 | 0/0 | 24/2152/0 (fail 24%) |  | L |

### webkit (125 rules)

**content** (17)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| text-renderer-is-needed | ported rule | 2 | 0/1 | 3031/297/257 (fail 1%) |  |  |
| first-whitespace-node-dropped | ported rule | 0 | 0/0 | 74/268/256 (fail 0%) |  | L |
| vt-is-not-ascii-whitespace | ported rule | 2 | 0/1 | 24/63/0 (fail 0%) |  |  |
| complex-code-path | ported rule | 0 | 0/1 | 3151/10859/2243 (fail 1%) |  | L |
| simplified-measuring-eligible | ported rule | 1 | 0/1 | 5245/5526/3360 (fail 1%) |  | N |
| fixed-pitch-by-family-name | heuristic | 0 | 0/0 | 1987/2238/1792 (fail 0%) |  | L |
| courier-new-no-width-shortcut | heuristic | 0 | 0/0 | 1065/2238/1792 (fail 0%) |  | L |
| strong-directionality-16bit | ported rule | 0 | 0/1 | 1731/9013/2881 (fail 1%) |  | L |
| visual-reordering | ported rule | 0 | 0/1 | 1788/9013/2881 (fail 1%) |  | L |
| widths-after-bidi-splits | ported rule | 0 | 0/1 | 1788/9013/2881 (fail 1%) |  | L |
| word-separator-tab-boundary | ported rule | 0 | 0/0 | 0/0/0 |  | U |
| soft-line-break-items | ported rule | 1 | 1/1 | 266/930/13 (fail 0%) |  |  |
| u2028-u2029-force-in-collapse | ported rule | 1 | 1/1 | 0/0/0 |  |  |
| break-spaces-item-per-space | ported rule | 2 | 0/0 | 496/0/0 (fail 1%) |  | N |
| preserved-tab-defers-width | ported rule | 0 | 0/1 | 154/532/4 (fail 1%) |  | L |
| items-at-breakable-positions | ported rule | 2 | 1/1 | 10378/29432/7509 (fail 1%) |  |  |
| item-ends-at-soft-hyphen | ported rule | 1 | 0/1 | 101/11482/71 (fail 1%) |  |  |

**measure** (16)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| primary-font-coverage-by-lastresort | recipe | 1 | 0/0 | 1645/861/832 (fail 0%) |  |  |
| canvas-string-controls | recipe | 5 | 0/1 | 436/642/1 (fail 2%) |  |  |
| hyphen-always-u2010 | heuristic | 1 | 0/0 | 101/11482/71 (fail 1%) |  |  |
| tab-stop-from-pen-position | ported rule | 1 | 0/0 | 155/646/4 (fail 1%) |  |  |
| tab-half-space-jump | ported rule | 1 | 0/0 | 16/6/0 (fail 0%) |  |  |
| tab-size-zero | ported rule | 0 | 0/0 | 0/0/0 |  | U |
| letter-spacing-after-tab | heuristic | 0 | 0/0 | 9/253/0 (fail 0%) |  | L |
| word-spacing-after-tab | heuristic | 0 | 0/0 | 0/0/0 |  | U |
| canvas-word-spacing | heuristic | 0 | 0/0 | 705/0/0 (fail 0%) |  | L |
| fixed-pitch-width | ported rule | 0 | 0/0 | 878/0/0 (fail 1%) |  | L |
| following-space-rule | ported rule | 3 | 0/1 | 7506/7018/5588 (fail 1%) |  |  |
| collapsible-space-one-space | ported rule | 1 | 0/1 | 1822/3091/2880 (fail 0%) |  |  |
| break-word-probe-sequence | ported rule | 2 | 0/0 | 2338/13945/373 (fail 1%) |  |  |
| break-word-fixed-pitch-shortcut | ported rule | 0 | 0/0 | 186/88/70 (fail 0%) |  | L |
| break-word-complex-graphemes | ported rule | 0 | 0/0 | 615/5103/47 (fail 1%) |  | L |
| first-user-perceived-character | ported rule | 1 | 0/0 | 352/6996/11 (fail 1%) |  |  |

**style** (2)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| han-lang-specialized-chinese-locale | ported rule | 1 | 0/1 | 200/92/3 (fail 14%) |  |  |
| lang-empty-null-locale | ported rule | 1 | 0/0 | 0/24/0 (fail 0%) |  |  |

**bidi** (4)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| paragraph-text-lf-tab-as-space | ported rule | 0 | 0/1 | 1596/7174/2879 (fail 0%) |  | L |
| u2028-appended-itself | ported rule | 0 | 0/0 | 0/336/0 (fail 0%) |  | ML |
| item-split-at-logical-run | ported rule | 0 | 0/1 | 489/3362/573 (fail 1%) |  | L |
| opaque-inline-box-levels | ported rule | 0 | 0/0 | 1689/0/0 (fail 1%) |  | L |

**builder** (3)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| text-only-simple | ported rule | 0 | 0/1 | 3715/14569/4615 (fail 1%) |  | L |
| range-based | ported rule | 0 | 0/0 | 145/0/0 (fail 0%) |  | L |
| line-builder | ported rule | 0 | 0/1 | 6550/15406/3407 (fail 2%) |  | L |

**breaks** (16)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| breakable-positions-scan | ported rule | 1 | 2/1 | 9436/26954/7497 (fail 1%) |  |  |
| hyphen-before-digit | ported rule | 1 | 1/1 | 356/57/68 (fail 0%) |  |  |
| latin1-pair-table | ported rule | 1 | 2/1 | 6151/16142/4608 (fail 1%) |  |  |
| ideograph-quote-rule | ported rule | 2 | 1/1 | 736/77/0 (fail 22%) |  |  |
| stale-fast-forward-state | ported rule | 2 | 1/1 | 6438/16830/4367 (fail 1%) |  |  |
| icu-with-prior-context | ported rule | 2 | 2/1 | 2385/18/12 (fail 8%) |  |  |
| line-tables-per-locale | ported rule | 5 | 2/1 | 10392/29451/7510 (fail 1%) |  |  |
| apple-quote-overrides | ported rule | 3 | 3/1 | 10392/29451/7510 (fail 1%) |  |  |
| da-has-no-overrides | ported rule | 0 | 1/1 | 0/0/0 |  |  |
| dictionary-from-intl-segmenter | recipe | 1 | 1/1 | 665/556/695 (fail 0%) |  |  |
| dictionary-engine-by-block | heuristic | 0 | 1/1 | 775/556/695 (fail 0%) |  |  |
| keep-all-breakable-space | ported rule | 4 | 3/1 | 942/2478/12 (fail 2%) |  |  |
| keep-all-punctuation-16bit-only | ported rule | 2 | 1/1 | 475/1492/2 (fail 2%) |  |  |
| keep-all-before-zwsp | ported rule | 1 | 1/1 | 23/218/0 (fail 0%) |  |  |
| may-break-in-between | ported rule | 4 | 4/1 | 3770/24/14 (fail 7%) |  |  |
| can-break-before | ported rule | 1 | 1/1 | 10166/28256/7247 (fail 1%) |  |  |

**lines** (17)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| line-width-trunc64 | ported rule | 4 | 0/0 | 10389/29451/7510 (fail 1%) |  |  |
| available-width-plus-1-64 | ported rule | 1 | 0/0 | 0/1/0 (fail 0%) |  |  |
| white-space-collapses-completely | ported rule | 0 | 0/0 | 450/220/0 (fail 1%) |  | L |
| new-run-for-word-spacing-zwsp-rtl | ported rule | 0 | 0/0 | 728/147/1 (fail 0%) |  | L |
| negative-letter-spacing-expand | ported rule | 0 | 0/0 | 434/141/0 (fail 2%) |  | L |
| trimmable-trailing-content | ported rule | 0 | 0/0 | 6452/6670/5895 (fail 1%) |  | L |
| hanging-keeps-last-item | ported rule | 0 | 0/0 | 688/1373/18 (fail 0%) |  | L |
| trailing-hyphen | ported rule | 1 | 0/0 | 29/8264/16 (fail 1%) |  |  |
| remove-trimmable-trailing | ported rule | 1 | 0/0 | 4911/5665/5143 (fail 1%) |  |  |
| rtl-trailing-whitespace-width | ported rule | 0 | 0/0 | 438/37/0 (fail 1%) |  | L |
| reset-bidi-trailing-whitespace | ported rule | 0 | 0/0 | 1788/14858/2881 (fail 0%) |  | L |
| detach-trailing-whitespace | ported rule | 0 | 0/0 | 29/3/0 (fail 0%) |  | L |
| conditional-hang-stops-when-fits | ported rule | 1 | 0/0 | 30/51/3 (fail 0%) |  |  |
| partial-leading-uses-carried-width | ported rule | 1 | 0/0 | 1969/12737/367 (fail 1%) |  |  |
| leading-position-no-progress | ported rule | 0 | 0/0 | 0/0/0 |  | U |
| only-empty-runs-no-line-box | ported rule | 0 | 0/0 | 10389/29451/7510 (fail 1%) |  | L |
| block-without-contentful-item | ported rule | 2 | 0/0 | 21/524/512 (fail 0%) |  |  |

**breaker** (15)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| continuous-content-trimmable | ported rule | 0 | 0/0 | 5186/4064/3577 (fail 2%) |  | L |
| break-rule-anywhere | ported rule | 1 | 0/0 | 265/0/0 (fail 1%) |  |  |
| break-rule-break-all | ported rule | 1 | 0/0 | 421/0/0 (fail 1%) |  |  |
| break-rule-overflow-wrap | ported rule | 1 | 0/0 | 1665/13945/373 (fail 1%) |  |  |
| first-character-16bit-extends | ported rule | 1 | 0/0 | 151/213/0 (fail 4%) |  |  |
| mid-word-break | ported rule | 1 | 0/0 | 414/0/0 (fail 1%) |  |  |
| last-valid-breaking-position | ported rule | 0 | 0/0 | 0/0/0 |  | U |
| try-previous-runs | ported rule | 0 | 0/0 | 8790/21370/6423 (fail 1%) |  | L |
| try-next-runs | ported rule | 0 | 0/0 | 8790/21370/6423 (fail 1%) |  | L |
| process-overflowing-content | ported rule | 0 | 0/0 | 9926/25022/6687 (fail 1%) |  | L |
| not-even-first-glyph-fits | ported rule | 0 | 0/0 | 758/6996/11 (fail 1%) |  | L |
| wrap-unbreakable-content | ported rule | 0 | 0/0 | 8330/21458/6423 (fail 1%) |  | L |
| revert-to-last-wrap-opportunity | ported rule | 0 | 0/0 | 0/0/0 |  | U |
| wrap-with-hyphen | ported rule | 2 | 0/0 | 29/8309/16 (fail 1%) |  |  |
| carried-remainder-width | ported rule | 2 | 0/0 | 7848/21850/6681 (fail 1%) |  |  |

**tos** (6)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| place-inline-text-content | ported rule | 0 | 0/0 | 3649/14289/4358 (fail 1%) |  | L |
| box-edge-soft-wrap-opportunity | ported rule | 1 | 0/0 | 0/0/0 |  |  |
| non-wrapping-content | ported rule | 0 | 0/0 | 190/0/0 (fail 0%) |  | L |
| single-character-content | ported rule | 0 | 0/0 | 18/280/257 (fail 0%) |  | L |
| revert-to-non-overflowing-hyphen | ported rule | 0 | 0/0 | 7/1908/2 (fail 1%) |  | L |
| consume-trailing-line-break | ported rule | 0 | 0/0 | 92/273/11 (fail 0%) |  | L |

**range** (1)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| first-line-skips-box-start | ported rule | 0 | 0/0 | 145/0/0 (fail 0%) |  | L |

**ilb** (11)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| next-wrap-opportunity | ported rule | 0 | 0/0 | 6532/14882/2895 (fail 2%) |  | L |
| opportunity-at-open-box-start | ported rule | 0 | 0/0 | 5207/15/12 (fail 4%) |  | L |
| is-at-soft-wrap-opportunity | ported rule | 0 | 0/0 | 6509/14496/2895 (fail 2%) |  | L |
| level-change-rescans-same-box | ported rule | 0 | 0/0 | 492/3653/573 (fail 1%) |  | L |
| has-trailing-soft-wrap-opportunity | ported rule | 0 | 0/0 | 6532/14882/2895 (fail 2%) |  | L |
| soft-hyphen-counted-in-fit | ported rule | 1 | 0/0 | 32/8100/61 (fail 0%) |  | N |
| rebuild-line | ported rule | 0 | 0/0 | 78/4848/0 (fail 0%) |  | L |
| rebuild-for-soft-hyphen-no-epsilon | ported rule | 1 | 0/0 | 6/4848/0 (fail 0%) |  | N |
| wrap-reverts-after-box-start | ported rule | 0 | 0/0 | 72/0/0 (fail 0%) |  | L |
| spanning-inline-box | ported rule | 0 | 0/0 | 4622/19/11 (fail 4%) |  | L |
| last-line-with-inline-content | ported rule | 0 | 0/0 | 6529/14881/2895 (fail 2%) |  | L |

**output** (5)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| pre-wrap-trailing-marked-hanging | heuristic | 0 | 0/0 | 575/1053/12 (fail 0%) |  | L |
| fragment-levels-rederived | heuristic | 0 | 0/0 | 669/1637/1438 (fail 0%) |  | L |
| width-copies-lab-visibility | choice by score | 0 | 0/0 | 10389/29451/7510 (fail 1%) |  | LS |
| visual-order-display-boxes | ported rule | 0 | 0/0 | 1788/14858/2881 (fail 0%) |  | L |
| default-ignorables-trailing-excluded | choice by score | 0 | 0/0 | 334/4191/21 (fail 0%) |  | LS |

**gap** (12)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| page-zoom | named gap | 3 | 0/0 | 0/0/0 | 0/0 (fail 0%) | N |
| control-character-width | named gap | 1 | 0/1 | 476/4889/1 (fail 1%) | 476/4889 (fail 1%) | N |
| hyphen-glyph | named gap | 0 | 0/1 | 105/12074/72 (fail 1%) | 105/12074 (fail 1%) | L |
| letter-spacing-ligatures | named gap | 3 | 0/0 | 1011/4041/21 (fail 1%) | 1011/4041 (fail 1%) |  |
| canvas-language | choice by score | 2 | 0/1 | 3900/4506/1681 (fail 4%) | 3900/4506 (fail 4%) | S |
| fixed-pitch-path | named gap | 0 | 0/0 | 1987/2238/1792 (fail 0%) | 1987/2238 (fail 0%) | L |
| simplified-measuring | choice by score | 2 | 0/0 | 0/0/0 | 1903/1219 (fail 1%) | SN |
| dictionary-breaks-unavailable | named gap | 0 | 0/0 | 0/0/0 | 0/0 (fail 0%) | U |
| dictionary-breaks-stand-in | named gap | 0 | 1/0 | 26/1/0 (fail 7%) | 26/1 (fail 7%) |  |
| ui-language | named gap | 2 | 0/0 | 0/24/0 (fail 0%) | 0/24 (fail 0%) | N |
| string-storage | named gap | 1 | 0/1 | 427/786/263 (fail 0%) | 427/786 (fail 0%) |  |
| rtl-shaping-across-inline-boxes | named gap | 0 | 0/1 | 852/0/0 (fail 1%) | 852/0 (fail 1%) | L |

### gecko (103 rules)

**style** (1)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| break-word-is-overflow-wrap-anywhere | ported rule | 1 | 1/0 | 132/0/0 (fail 0%) |  |  |

**units** (2)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| app-units-per-dev-pixel | ported rule | 2 | 0/1 | 10410/29930/7976 (fail 3%) |  |  |
| spacing-px-to-au | ported rule | 3 | 2/1 | 1413/4033/7 (fail 1%) |  |  |

**frames** (1)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| no-frame-boundary-whitespace-node | ported rule | 0 | 1/1 | 107/268/256 (fail 0%) |  |  |

**bidi** (4)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| resolve-per-paragraph | ported rule | 1 | 0/1 | 1807/14890/2877 (fail 6%) |  |  |
| replace-separators | ported rule | 0 | 0/1 | 1807/14884/2877 (fail 6%) |  | L |
| paragraph-after-preserved-newline | ported rule | 0 | 0/0 | 0/182/0 (fail 7%) |  | ML |
| frames-split-at-level-runs | ported rule | 1 | 0/1 | 589/5833/1853 (fail 5%) |  |  |

**textrun** (3)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| continue-across-frames | ported rule | 4 | 1/1 | 1931/24/14 (fail 2%) |  |  |
| break-at-style-change | ported rule | 2 | 0/1 | 5731/5896/1853 (fail 4%) |  |  |
| raw-family-string-compare | heuristic | 0 | 0/0 | 0/0/0 |  | U |

**transform** (11)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| compress-none | ported rule | 0 | 1/1 | 1520/13056/10 (fail 5%) |  |  |
| discard-soft-hyphen | ported rule | 2 | 1/1 | 105/12071/69 (fail 7%) |  |  |
| discard-bidi-controls-16bit | ported rule | 1 | 0/0 | 0/123/0 (fail 4%) |  |  |
| collapse-space-tab | ported rule | 1 | 1/1 | 485/149/0 (fail 2%) |  |  |
| segment-break-to-space | ported rule | 0 | 1/1 | 86/439/500 (fail 0%) |  |  |
| segment-break-removed-next-to-zwsp | ported rule | 0 | 2/1 | 83/110/0 (fail 1%) |  |  |
| segment-break-east-asian | ported rule | 4 | 1/1 | 10/281/317 (fail 0%) |  |  |
| ja-zh-language-test | ported rule | 2 | 1/1 | 1764/179/61 (fail 0%) |  |  |
| pre-line-keeps-newline | ported rule | 2 | 2/1 | 68/0/0 (fail 0%) |  |  |
| space-before-combining-mark-kept | ported rule | 0 | 0/0 | 0/10/0 (fail 0%) |  | ML |
| cr-kept-stops-collapsing | ported rule | 3 | 1/1 | 99/55/0 (fail 8%) |  |  |

**glyphs** (6)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| cluster-boundaries | ported rule | 0 | 0/1 | 7843/20351/5126 (fail 4%) |  | L |
| bengali-ya-phala | ported rule | 0 | 0/0 | 0/0/0 |  | U |
| after-hyphen-emergency-wrap | ported rule | 2 | 3/1 | 901/65/64 (fail 1%) |  |  |
| word-cache-limit-32 | ported rule | 0 | 0/0 | 1121/876/835 (fail 1%) |  | L |
| boundary-space-nbsp-own-word | ported rule | 1 | 0/1 | 7967/7896/5884 (fail 1%) |  |  |
| invalid-character-zero-glyph | ported rule | 3 | 1/1 | 1188/9838/76 (fail 6%) |  |  |

**script** (3)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| itemizer | ported rule | 0 | 0/1 | 8086/22007/5139 (fail 3%) |  | L |
| itemizer-uint32-fixup-quirk | ported rule | 0 | 0/1 | 7899/20724/5134 (fail 3%) |  | L |
| latin-fast-path | ported rule | 0 | 0/0 | 283/4227/1853 (fail 4%) |  | L |

**measure** (10)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| range-in-script-context | recipe | 0 | 1/1 | 4303/8308/3150 (fail 1%) |  |  |
| context-per-text-run | recipe | 3 | 0/1 | 10392/29406/7464 (fail 3%) |  |  |
| letter-spacing-0.001px | recipe | 5 | 0/1 | 1011/4027/7 (fail 1%) |  |  |
| au-by-rounding | recipe | 3 | 0/1 | 10392/29406/7464 (fail 3%) |  |  |
| word-units | ported rule | 1 | 0/1 | 10324/29265/7463 (fail 3%) |  |  |
| emoji-device-size-advance | recipe | 4 | 1/1 | 1492/4271/1095 (fail 1%) |  |  |
| apple-color-emoji-family-literal | heuristic | 0 | 1/1 | 8051/22037/5138 (fail 3%) |  |  |
| synthesized-space-width | recipe | 0 | 1/1 | 420/928/61 (fail 1%) |  |  |
| tab-width-containing-block | ported rule | 1 | 1/1 | 163/642/0 (fail 2%) |  |  |
| min-tab-advance-and-hyphen-run | recipe | 2 | 1/1 | 268/12510/69 (fail 6%) |  |  |

**linebreaker** (10)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| words-across-flows | ported rule | 4 | 2/1 | 5885/5720/1867 (fail 3%) |  |  |
| ascii-nonbreakable-words-skip-icu | ported rule | 0 | 2/1 | 5359/8190/5379 (fail 1%) |  |  |
| compute-break-positions | ported rule | 0 | 1/1 | 8874/26047/5662 (fail 3%) |  |  |
| auto-strictness-is-strict | ported rule | 2 | 0/1 | 7864/25935/5661 (fail 3%) |  |  |
| cj-likely-script-approximation | heuristic | 0 | 0/1 | 7999/21967/4956 (fail 3%) |  | L |
| no-break-inside-cluster | ported rule | 0 | 0/0 | 172/478/0 (fail 0%) |  | L |
| nowrap-suppresses-breaks | ported rule | 2 | 1/1 | 400/0/0 (fail 0%) |  |  |
| compressed-leading-whitespace | ported rule | 0 | 0/1 | 253/0/0 (fail 0%) |  | L |
| trailing-break | ported rule | 0 | 0/1 | 94/340/244 (fail 5%) |  | L |
| style-change-flushes-word | ported rule | 1 | 0/0 | 0/0/0 |  |  |

**icu4x** (9)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| line-iterator | ported rule | 0 | 3/1 | 8791/25935/5661 (fail 3%) |  |  |
| lb9-combining-marks-and-zwj | ported rule | 0 | 1/1 | 1532/7460/67 (fail 4%) |  |  |
| break-all-letters-as-id | ported rule | 1 | 0/0 | 303/0/0 (fail 3%) |  |  |
| keep-all-pairs | ported rule | 1 | 2/1 | 714/1781/0 (fail 0%) |  |  |
| cj-as-id-under-loose-normal | ported rule | 2 | 1/0 | 130/0/0 (fail 0%) |  |  |
| normal-ja-zh-wave-dash | ported rule | 1 | 0/0 | 6/0/0 (fail 0%) |  |  |
| loose-rules | ported rule | 1 | 0/0 | 134/0/0 (fail 0%) |  |  |
| anywhere | ported rule | 1 | 0/0 | 0/0/0 |  |  |
| sa-from-intl-segmenter | recipe | 1 | 0/0 | 685/553/695 (fail 1%) |  |  |

**spacing** (3)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| letter-spacing-after-cluster | ported rule | 3 | 3/1 | 1011/4027/7 (fail 1%) |  |  |
| no-letter-spacing-cursive | ported rule | 2 | 0/0 | 99/262/0 (fail 12%) |  |  |
| word-spacing-space-nbsp | ported rule | 4 | 0/1 | 666/0/0 (fail 1%) |  |  |

**lines** (28)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| break-and-measure-text | ported rule | 0 | 0/1 | 10381/29346/7464 (fail 3%) |  | L |
| fit-integer-au-le | ported rule | 4 | 2/1 | 468/677/285 (fail 3%) |  |  |
| first-opportunity-taken-even-if-overflowing | ported rule | 1 | 1/1 | 1467/9536/81 (fail 8%) |  |  |
| word-wrap-break-priority | ported rule | 2 | 2/1 | 7102/21208/6203 (fail 3%) |  |  |
| break-spaces-after-space | ported rule | 1 | 1/1 | 458/0/0 (fail 1%) |  |  |
| soft-hyphen-opportunity | ported rule | 3 | 2/1 | 47/10744/64 (fail 7%) |  |  |
| last-candidate-fallback | ported rule | 0 | 0/0 | 0/0/0 |  | U |
| in-word-advance-unit-minus-suffix | recipe | 0 | 1/1 | 9168/27702/7200 (fail 3%) |  |  |
| zwj-before-joined-suffix | choice by score | 0 | 0/1 | 948/6511/1100 (fail 12%) |  | LS |
| in-cluster-offset-takes-cluster-end | recipe | 0 | 1/1 | 12/832/0 (fail 1%) |  |  |
| tab-stops | ported rule | 1 | 1/1 | 155/584/0 (fail 2%) |  |  |
| tabs-zero-when-width-not-positive | ported rule | 0 | 1/1 | 8/58/0 (fail 0%) |  |  |
| leading-whitespace-skipped | ported rule | 0 | 1/1 | 235/257/0 (fail 9%) |  |  |
| frame-ends-at-significant-newline | ported rule | 1 | 1/1 | 266/294/1 (fail 3%) |  |  |
| forced-break-in-redo | ported rule | 1 | 1/1 | 715/179/50 (fail 2%) |  |  |
| trim-trailing-at-break | ported rule | 1 | 1/1 | 4312/5567/5040 (fail 1%) |  |  |
| pre-wrap-hangs-overflowing-part | ported rule | 1 | 1/1 | 621/618/3 (fail 2%) |  |  |
| soft-hyphen-at-frame-end | ported rule | 1 | 1/1 | 29/194/5 (fail 0%) |  |  |
| trailing-break-flag | ported rule | 0 | 0/1 | 89/315/244 (fail 4%) |  | L |
| hyphen-in-frame-width | ported rule | 1 | 1/1 | 29/6946/14 (fail 10%) |  |  |
| break-before-frame | ported rule | 0 | 0/1 | 2549/2729/341 (fail 6%) |  | L |
| can-place-frame-requests-backup | ported rule | 1 | 1/1 | 803/181/50 (fail 1%) |  |  |
| notify-optional-break | ported rule | 0 | 0/1 | 8758/17861/7184 (fail 1%) |  | L |
| one-redo | ported rule | 2 | 2/1 | 715/179/50 (fail 2%) |  |  |
| empty-pass-joins-next-line | ported rule | 0 | 0/0 | 72/19/0 (fail 25%) |  | L |
| paragraph-without-line | ported rule | 0 | 0/0 | 29/584/512 (fail 1%) |  | L |
| trim-trailing-whitespace-floor-unclamped | ported rule | 0 | 1/1 | 1916/466/576 (fail 2%) |  |  |
| visual-frame-order | ported rule | 0 | 0/1 | 1807/14860/2877 (fail 6%) |  | L |

**output** (4)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| tab-marked-hanging | heuristic | 0 | 0/0 | 35/490/0 (fail 3%) |  | L |
| width-copies-lab-extent | choice by score | 0 | 3/1 | 10381/29346/7464 (fail 3%) |  | S |
| positive-advance-rect-rule | choice by score | 0 | 1/1 | 1074/9281/76 (fail 6%) |  | S |
| joins-next-line | recipe | 0 | 0/0 | 112/3342/0 (fail 24%) |  | L |

**gap** (8)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports: rebuild / main (fail %) | Class |
|---|---|---:|---|---|---|---|
| in-word-prefix | named gap | 0 | 1/1 | 5740/14009/4902 (fail 5%) | 1715/8571 (fail 10%) |  |
| font-size-quantization | named gap | 3 | 0/0 | 0/0/0 | 0/0 (fail 0%) |  |
| optical-size-by-family-name | heuristic | 2 | 0/0 | 0/0/0 | 0/0 (fail 0%) |  |
| space-in-shaping | named gap | 0 | 0/0 | 3203/4139/4151 (fail 1%) | 0/15 (fail 7%) | ML |
| font-fallback-pinned-emoji | named gap | 2 | 1/1 | 0/0/0 | 0/201 (fail 0%) | N |
| bitmap-emoji-size | named gap | 1 | 0/0 | 719/310/317 (fail 2%) | 66/17 (fail 40%) | N |
| ui-language | named gap | 2 | 0/0 | 0/24/0 (fail 0%) | 0/24 (fail 0%) |  |
| dictionary-breaks-unavailable | named gap | 0 | 0/0 | 0/0/0 | 0/0 (fail 0%) | U |

### shared (27 rules)

Census cells give b (Blink), w (WebKit) and g (Gecko) separately.

**measure** (5)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports | Class |
|---|---|---:|---|---|---|---|
| fresh-measurer-per-layout | recipe | 3 | 0/2 | b: 10410/30036/8020 (fail 8%); w: 10410/29975/8022 (fail 1%); g: 10410/29930/7976 (fail 3%) |  |  |
| context-per-settings | recipe | 1 | 0/3 | b: 10410/30036/8020 (fail 8%); w: 10392/29451/7510 (fail 1%); g: 10392/29406/7464 (fail 3%) |  |  |
| lang-before-font | recipe | 1 | 0/3 | b: 10410/30036/8020 (fail 8%); w: 10392/29451/7510 (fail 1%); g: 10392/29406/7464 (fail 3%) |  |  |
| memo-per-layout | recipe | 1 | 0/3 | b: 10358/29473/7506 (fail 8%); w: 9286/23963/6906 (fail 1%); g: 10106/28150/7202 (fail 3%) |  |  |
| font-string | recipe | 2 | 0/3 | b: 10410/30036/8020 (fail 8%); w: 10392/29451/7510 (fail 1%); g: 10392/29406/7464 (fail 3%) |  |  |

**bidi** (3)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports | Class |
|---|---|---:|---|---|---|---|
| icu-ubidi | ported rule | 0 | 6/3 | b: 3783/18771/3780 (fail 13%); w: 1788/14858/2881 (fail 0%); g: 0/0/0 |  |  |
| unicode-bidi-crate | ported rule | 0 | 3/2 | b: 0/0/0; w: 0/0/0; g: 1807/14884/2877 (fail 6%) |  |  |
| class-data-per-engine | ported rule | 0 | 3/7 | b: 3787/18771/3780 (fail 13%); w: 10410/29975/8022 (fail 1%); g: 1807/14890/2877 (fail 6%) |  |  |

**grapheme** (1)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports | Class |
|---|---|---:|---|---|---|---|
| per-engine-data | ported rule | 0 | 1/2 | b: 8109/22263/5164 (fail 10%); w: 615/5103/47 (fail 1%); g: 8051/22037/5138 (fail 3%) |  |  |

**breaks** (4)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports | Class |
|---|---|---:|---|---|---|---|
| rbbi-forward-iterator | ported rule | 0 | 2/4 | b: 8114/22270/5164 (fail 10%); w: 6941/18176/4380 (fail 1%); g: 0/0/0 |  |  |
| apple-category-overrides | ported rule | 0 | 1/2 | b: 0/0/0; w: 1500/554/184 (fail 7%); g: 0/0/0 |  |  |
| dictionary-category-count | ported rule | 0 | 1/3 | b: 644/428/567 (fail 3%); w: 665/556/695 (fail 0%); g: 0/0/0 |  |  |
| icu4x-rule-iterator | ported rule | 0 | 1/2 | b: 0/0/0; w: 0/0/0; g: 8051/22037/5138 (fail 3%) |  |  |

**data** (1)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports | Class |
|---|---|---:|---|---|---|---|
| pinned-tables-by-hash | ported rule | 0 | 3/0 | generator-time only, no runtime anchor |  |  |

**env** (1)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports | Class |
|---|---|---:|---|---|---|---|
| engine-from-user-agent | heuristic | 2 | 0/0 | detection runs only in a browser |  |  |

**painter** (12)

| Rule | Kind | Probes | Tests assert/reach | Census: rebuild / main / obligations (fail %) | Real gap reports | Class |
|---|---|---:|---|---|---|---|
| line-block-a-wrap | recipe | 0 | 0/0 | b: 10379/29508/7508 (fail 8%); w: 10389/29451/7510 (fail 1%); g: 10381/29346/7464 (fail 3%) |  | L |
| nowrap-hyphenated-or-joined | heuristic | 0 | 0/0 | b: 154/8037/14 (fail 29%); w: 29/8264/16 (fail 1%); g: 141/7231/14 (fail 11%) |  | L |
| leading-ascii-space-slice-in-span | heuristic | 0 | 0/0 | b: 3/32/0 (fail 6%); w: 9/54/0 (fail 6%); g: 3/10/0 (fail 15%) |  | L |
| empty-span-between-slices | recipe | 0 | 0/0 | b: 82/1/1 (fail 0%); w: 55/1/1 (fail 2%); g: 60/1/1 (fail 3%) |  | L |
| hyphen-span-blink-vertical-align | recipe | 0 | 0/0 | b: 30/7025/14 (fail 24%) |  | L |
| hyphen-span-gecko-isolate | recipe | 0 | 0/0 | g: 29/6946/14 (fail 10%) |  | L |
| hyphen-span-webkit-plain | recipe | 0 | 0/0 | w: 29/8264/16 (fail 1%) |  | L |
| zwj-at-joined-line-edges | choice by score | 0 | 0/0 | b: 124/3909/0 (fail 57%); w: 0/0/0; g: 112/3342/0 (fail 24%) |  | LS |
| bidi-override-levels | recipe | 0 | 0/0 | b: 1264/12370/2879 (fail 13%); w: 1280/14627/2882 (fail 1%); g: 1270/12323/2877 (fail 4%) |  | L |
| plain-span-under-override | recipe | 0 | 0/0 | b: 1264/12370/2879 (fail 13%); w: 1270/14627/2882 (fail 1%); g: 1270/12323/2877 (fail 4%) |  | L |
| trailing-white-space-at-text-level | recipe | 0 | 0/0 | b: 663/2126/1701 (fail 6%); w: 620/1920/1611 (fail 0%); g: 46/337/276 (fail 1%) |  | L |
| trimmed-and-hanging-painted | recipe | 0 | 0/0 | b: 6000/7325/5412 (fail 3%); w: 5486/6718/5155 (fail 1%); g: 5566/6656/5132 (fail 1%) |  | L |

## Uncovered rules (14)

| Rule | Kind | Why it matters | Lab reach (rebuild/main/obligations) |
|---|---|---|---|
| blink/content/restore-removed-space | ported rule | a trailing space removed earlier is restored when more text is appended | 0/0/0 |
| blink/gap/float32-precision | named gap | reports float32-precision for a grapheme cluster of 256 zoomed px or more | census 12/0/0; real reports 0 |
| blink/gap/dictionary-breaks-unavailable | named gap | reports dictionary-breaks-unavailable when a Thai, Lao, Khmer or Myanmar run needed boundaries the environment cannot give | census artifact 644/428/567; real reports 0 |
| webkit/content/word-separator-tab-boundary | ported rule | with word spacing in preserve modes, a white-space run stops before a TAB that follows a space | 0/0/0 |
| webkit/measure/tab-size-zero | ported rule | with tab-size 0 a tab is as wide as the letter spacing | 0/0/0 |
| webkit/measure/word-spacing-after-tab | heuristic (webkit E2) | word spacing on a space right after a TAB is added in JS because a Canvas string does not add it at index 0 | 0/0/0 |
| webkit/breaker/last-valid-breaking-position | ported rule | a non-overflowing run under break-all breaks at its end or at its last position that can start a line | 0/0/0 |
| webkit/breaker/revert-to-last-wrap-opportunity | ported rule | without wrapping, overflowing content reverts to the last wrap opportunity (unreachable while the list only fills for wrapping blocks) | 0/0/0 |
| webkit/lines/leading-position-no-progress | ported rule | a line that places nothing moves to the next item so layout makes progress | 0/0/0 |
| webkit/gap/dictionary-breaks-unavailable | named gap | reports dictionary-breaks-unavailable for dictionary text without Intl.Segmenter | 0/0/0; real reports 0 |
| gecko/textrun/raw-family-string-compare | heuristic (gecko E2) | fonts are compared as raw family strings, so Arial and "Arial" end a text run Gecko continues; marked where only quoting or case differ | 0/0/0 |
| gecko/glyphs/bengali-ya-phala | ported rule | U+09AF after U+09CD extends the cluster | 0/0/0 |
| gecko/lines/last-candidate-fallback | ported rule | when the scan aborts, the last candidate break recorded before the overflow is used | 0/0/0 |
| gecko/gap/dictionary-breaks-unavailable | named gap (gecko E7) | reports dictionary-breaks-unavailable for SA text when the environment has no segmenter (only for kind unavailable) | 0/0/0; real reports 0 |

## Rules no lab case reaches, pinned only by probes or bun tests (12)

| Rule | Kind | Why it matters | Probes | Asserting bun tests |
|---|---|---|---|---|
| blink/measure/system-ui-at-css-size | heuristic (blink E1) | families whose first name is system-ui or BlinkMacSystemFont are measured at the CSS size and scaled | blink-canvas H16: refuted, correction 7; CRITIC C7: refuted; cross X5: refuted (system-ui), confirmed (cache order) | 0 |
| blink/breaks/break-all-loose-hyphen | ported rule | break-all with line-break loose breaks before U+2010 or U+2013 after NU, AL, SA or ID | blink-text H20: refuted, correction 4 | 0 |
| blink/breaks/soft-hyphen-skipped-when-disabled | ported rule | with hyphens none, an ICU boundary after SHY is skipped (unreachable: the model has hyphens manual) | blink-text H25: confirmed (hyphens none 1 line) | 0 |
| blink/gap/optical-size | named gap (blink E1) | reports optical-size for system-ui and BlinkMacSystemFont at layout zoom other than 1 | cross X5: confirmed (cache order) | 0 |
| webkit/content/u2028-u2029-force-in-collapse | ported rule | U+2028 and U+2029 force breaks even under white-space: normal (a 7625 change); every lab U+2028/U+2029 case is pre-wrap | webkit-text H13: confirmed | 1 |
| webkit/breaks/da-has-no-overrides | ported rule | Danish gets no quote overrides |  | 1 |
| webkit/tos/box-edge-soft-wrap-opportunity | ported rule | between items of different boxes the simple builder asks mayBreakInBetween | webkit-text H1: confirmed | 0 |
| webkit/gap/page-zoom | named gap | reports page-zoom for page zoom other than 1 | webkit-lines H17: not run; webkit-canvas H9: not run; CRITIC C10: not run | 0 |
| gecko/icu4x/anywhere | ported rule | line-break anywhere breaks between every pair of characters the iterator reaches (Gecko fills the breaks without calling ICU4X) | gecko-text H20: confirmed | 0 |
| gecko/linebreaker/style-change-flushes-word | ported rule | a word-break or line-break change flushes the word (unreachable: the model sets them per paragraph) | gecko-text H19: confirmed (span-level, not modelled) | 0 |
| gecko/gap/font-size-quantization | named gap | reports font-size-quantization where Canvas's 7-bit size differs from round(q10(size) × 60) / 60 | gecko-canvas H3: refuted, correction 2; gecko-canvas H3b: confirmed; gecko-canvas H4: confirmed | 0 |
| gecko/gap/optical-size-by-family-name | heuristic (gecko E1) | reports optical-size for families matching a name regex (system-ui, -apple-system, ui-*, SF Pro, SF Compact, New York) | gecko-canvas H8: confirmed; cross-cutting 5: confirmed | 0 |

## Rules covered only by main-derived cases (10)

| Rule | Kind | Why it matters | Lab reach (rebuild/main/obligations) |
|---|---|---|---|
| blink/style/lang-empty-null-locale | ported rule | lang="" gives a null locale (explicitly unknown) instead of inheriting; run.lang null inherits the block locale | 0/24/0 (fail 0%) |
| blink/shaping/zwnj-at-item-start-ends-group | ported rule | an item that starts with U+200C starts a new shaping group | 0/296/0 (fail 29%) |
| blink/content/zwnj-splits-preserved-item | ported rule | in preserve modes U+200C splits a text item but stays text | 0/590/0 (fail 28%) |
| blink/lines/no-line-box-line-folded | ported rule (blink F5) | a line that creates no line box paints nothing; its content joins the painted line around it (by look-ahead) | 0/3/0 (fail 0%) |
| blink/gap/font-fallback-u-fffc | named gap (blink C-u4) | reports font-fallback for U+FFFC, which Canvas measures as U+200B | real reports 0/183, all failing |
| blink/gap/unsafe-to-break-wide-group | named gap | reports unsafe-to-break where a wide group has no safe cut near its middle | real reports 0/7 (fail 14%) |
| webkit/bidi/u2028-appended-itself | ported rule (webkit E6, fixed since c72550a) | with preserved newlines a U+2028 soft break is appended to the bidi paragraph as U+2028 | 0/336/0 (fail 0%) |
| gecko/bidi/paragraph-after-preserved-newline | ported rule | with significant newlines every preserved line is its own bidi paragraph | 0/182/0 (fail 7%) |
| gecko/transform/space-before-combining-mark-kept | ported rule | the last space of a run stays when a combining mark follows it | 0/10/0 (fail 0%) |
| gecko/gap/space-in-shaping | named gap (gecko C3) | reports space-in-shaping where a stretch of words and spaces measures differently from its units (detection unverified) | real reports 0/15 (fail 7%) |

## Rules whose only evidence is lab rows: heuristics, recipes, gaps and choices by score (41)

| Rule | Kind | Why it matters | Lab reach (rebuild/main/obligations) |
|---|---|---|---|
| blink/measure/v8-short-slice-storage | heuristic (blink E3) | slices of 1 or 2 code units of a segmented paragraph are treated as 8-bit strings when their units allow | 5088/16431/2668 (fail 8%) |
| blink/measure/force-16bit-string | heuristic (blink E3) | a Latin-1 slice of a segmented paragraph is forced to 16-bit storage with ('Ā' + s).slice(1) | 3157/3903/1904 (fail 6%) |
| blink/measure/letter-spacing-cursive-adjust | recipe | letter spacing is corrected in JS where Canvas and the DOM differ: spaces inside cursive runs get it, FF does not | 84/14/1 (fail 26%) |
| blink/shape/unsafe-to-break-offsets | recipe | an offset inside a group is unsafe to break inside a cluster, between joining letters, or where the pair total shows an adjustment (necessary, not sufficient) | 837/5023/924 (fail 42%) |
| blink/shape/wide-group-halved | heuristic (blink E4, B8) | a group of 256 zoomed px or more is cut near its middle, preferring a space edge that passes the safe test | 9365/9148/7184 (fail 2%) |
| blink/gap/han-kerning | named gap | reports han-kerning where a HanKerning trim was added from Canvas facts | real reports 295/199 (fail 2%) |
| blink/lines/reshaped-part-measured-alone-when-cut | heuristic (blink F6) | a reshaped part cut at an edge is measured again alone, where Blink slices its glyphs without reshaping | 2/743/0 (fail 73%) |
| blink/output/other-space-separators-excluded | heuristic (blink D3) | trailing U+1680, U+2000..U+200A, U+205F and U+3000 are left out of the extent like SPACE and TAB | 226/900/0 (fail 5%) |
| blink/gap/font-fallback-edge-in-cluster | named gap | reports font-fallback where a shaping-group edge falls inside a grapheme cluster | real reports 339/500 (fail 23%) |
| blink/gap/unsafe-to-break-line-edge-joining | named gap | reports unsafe-to-break at a chosen line edge between joining letters | real reports 361/3833 (fail 63%, shared with the group-edge site) |
| blink/gap/unsafe-to-break-attribution | named gap | reports unsafe-to-break where a line edge takes its width from the paragraph position and the pair total shows an adjustment | real reports 370/816 (fail 9%) |
| blink/gap/in-word-prefix | named gap | reports in-word-prefix at a line edge inside a word where the pair total shows no adjustment | real reports 5297/17275 (fail 7%) |
| blink/gap/soft-hyphen-shaping | named gap | reports soft-hyphen-shaping where an 8-bit Canvas string leaves default-ignorable characters out | real reports 69/4668 (fail 2%) |
| blink/gap/script-context | named gap | reports script-context where a character shapes under another script in Canvas than in the paragraph | real reports 5602/15496 (fail 11%) |
| webkit/content/fixed-pitch-by-family-name | heuristic (webkit E1) | the first listed family is fixed pitch when it is one of 10 family names | 1987/2238/1792 (fail 0%) |
| webkit/content/courier-new-no-width-shortcut | heuristic (webkit E1) | Courier New is fixed pitch but takes no width shortcut | 1065/2238/1792 (fail 0%) |
| webkit/measure/letter-spacing-after-tab | heuristic (webkit E3) | letter spacing is added after every TAB, and the tab base comes from Canvas W(" ") | 9/253/0 (fail 0%) |
| webkit/measure/canvas-word-spacing | heuristic (webkit E2) | ctx.wordSpacing carries the run's word spacing, relying on unprobed Canvas word-spacing behaviour | 705/0/0 (fail 0%) |
| webkit/output/pre-wrap-trailing-marked-hanging | heuristic (webkit F4) | every trailing pre-wrap white-space piece is output as hanging, even where Line stopped hanging it | 575/1053/12 (fail 0%) |
| webkit/output/fragment-levels-rederived | heuristic (webkit F4) | fragment levels re-derive the trailing bidi reset from pieces instead of the closed run list | 669/1637/1438 (fail 0%) |
| webkit/output/width-copies-lab-visibility | choice by score (webkit D1) | Line.width is the extent the lab observes: trailing SPACE and TAB and default ignorables left out, not the display box extent | 10389/29451/7510 (fail 1%) |
| webkit/output/default-ignorables-trailing-excluded | choice by score (webkit D1) | default-ignorable code points at the line end are left out of the extent, from data shipped for the lab's rule | 334/4191/21 (fail 0%) |
| webkit/gap/hyphen-glyph | named gap (webkit C1) | reports hyphen-glyph for every box with a soft hyphen | real reports 105/12074 (fail 1%) |
| webkit/gap/fixed-pitch-path | named gap (webkit E1) | reports fixed-pitch-path for the 10 family names | real reports 1987/2238 (fail 0%) |
| webkit/gap/rtl-shaping-across-inline-boxes | named gap (webkit C3) | reports rtl-shaping-across-inline-boxes for LineBuilder paragraphs with more than one complex RTL box | real reports 852/0 (fail 1%) |
| gecko/linebreaker/cj-likely-script-approximation | heuristic (gecko E4) | a language counts as Chinese or Japanese by its script subtag, or zh and ja, approximating ICU likely subtags | 7999/21967/4956 (fail 3%) |
| gecko/lines/zwj-before-joined-suffix | choice by score (gecko D1) | between joining letters the suffix is measured as U+200D + suffix | 948/6511/1100 (fail 12%) |
| gecko/output/tab-marked-hanging | heuristic (gecko E5) | a trailing TAB under pre-wrap is output as hanging, where Gecko hangs only CharIsSpace characters (U+0020, U+3000) | 35/490/0 (fail 3%) |
| gecko/output/joins-next-line | recipe | joinsNextLine is set where the break falls inside a word between joining letters | 112/3342/0 (fail 24%) |
| shared/painter/line-block-a-wrap | recipe | each line is a block at the paragraph width with the paragraph's wrapping styles, so the engine re-runs its line-end rules | b 10379/29508/7508; w 10389/29451/7510; g 10381/29346/7464 |
| shared/painter/nowrap-hyphenated-or-joined | heuristic (gecko E9) | a line ending at a hyphen or starting with a joiner gets text-wrap-mode: nowrap | b 154/8037/14; w 29/8264/16; g 141/7231/14 |
| shared/painter/leading-ascii-space-slice-in-span | heuristic (webkit E7, gecko E8) | a bare slice of ASCII white space starting a line in normal or nowrap goes in a span, by Blink's IsASCIISpace for every engine | b 3/32/0; w 9/54/0; g 3/10/0 |
| shared/painter/empty-span-between-slices | recipe | a span with no painted text between two painted slices is painted empty, keeping the element edge | b 82/1/1; w 55/1/1; g 60/1/1 |
| shared/painter/hyphen-span-blink-vertical-align | recipe | in Blink the hyphen span gets vertical-align: 0px, ending the shaping group without moving the baseline | b 30/7025/14 |
| shared/painter/hyphen-span-gecko-isolate | recipe | in Gecko the hyphen span gets unicode-bidi: isolate, ending the text run | g 29/6946/14 |
| shared/painter/hyphen-span-webkit-plain | recipe | in WebKit the hyphen span is plain: layout measures the hyphen alone, paint shapes it with the word | w 29/8264/16 |
| shared/painter/zwj-at-joined-line-edges | choice by score (gecko D3) | U+200D goes after a line's text and before the next line's where the paragraph joined letters across the break (R7) | b 124/3909/0 (fail 57%); g 112/3342/0 (fail 24%) |
| shared/painter/bidi-override-levels | recipe | a line with a fragment off the base level is painted under bidi-override with one nested override span per level step (R8) | b 1264/12370/2879; w 1280/14627/2882; g 1270/12323/2877 |
| shared/painter/plain-span-under-override | recipe | text never sits directly in an override element: a plain span goes between | b 1264/12370/2879; w 1270/14627/2882; g 1270/12323/2877 |
| shared/painter/trailing-white-space-at-text-level | recipe | a line's trailing white space is painted at the level of the text before it in the same run | b 663/2126/1701; w 620/1920/1611; g 46/337/276 |
| shared/painter/trimmed-and-hanging-painted | recipe | trimmed and hanging white space stay in their slice so the browser trims or hangs it again and shapes the text before it the same way (R3) | b 6000/7325/5412; w 5486/6718/5155; g 5566/6656/5132 |

## Rules whose only evidence is lab rows: ported rules (99)

These ports cite source, but no probe and no asserting bun test pins them; only lab rows exercise them.

| Engine / area | Rules |
|---|---|
| blink/shaping | parity-change-ends-group |
| blink/script | single-latin-segment |
| blink/grapheme | 8bit-every-unit-but-crlf |
| blink/shape | joining-reads-5-code-points-context, default-ignorables-skipped-in-pair |
| blink/tabs | tab-size-zero |
| blink/hankerning | applies-to-16bit-marks, start-context-halt, end-context-halt, open-mark-carries-adjustment, line-end-halt-apply-end, halted-group-start-unsafe |
| blink/breaks | previous-break-opportunity, line-break-anywhere-settings, break-anywhere-if-overflow-settings |
| blink/lines | overflow-at-space-takes-trailing-spaces, no-result-if-overflow, trailing-collapsible-spaces-skipped, u3000-not-collapsible-trailing, generated-zwsp-break-after, open-tag-zero-size, overflow-rebreak-at-size-minus-1px, break-at-previous-opportunity, overflow-kept, rewind-overflow, trailing-space-truncated-without-reshape, split-trailing-bidi-space, rewind-trailing-open-tags |
| blink/shapeline | whole-result-fits, line-start-reshape, candidate-from-position, overflow-when-no-previous-opportunity, only-trailing-spaces, break-at-non-hangable-run-end, line-end-reshape, line-end-reshape-walk-back |
| blink/output | edge-caret-rounded-outward |
| webkit/content | first-whitespace-node-dropped, complex-code-path, strong-directionality-16bit, visual-reordering, widths-after-bidi-splits, preserved-tab-defers-width |
| webkit/bidi | paragraph-text-lf-tab-as-space, item-split-at-logical-run, opaque-inline-box-levels |
| webkit/builder | text-only-simple, range-based, line-builder |
| webkit/measure | fixed-pitch-width, break-word-fixed-pitch-shortcut, break-word-complex-graphemes |
| webkit/lines | white-space-collapses-completely, new-run-for-word-spacing-zwsp-rtl, negative-letter-spacing-expand, trimmable-trailing-content, hanging-keeps-last-item, rtl-trailing-whitespace-width, reset-bidi-trailing-whitespace, detach-trailing-whitespace, only-empty-runs-no-line-box |
| webkit/breaker | continuous-content-trimmable, try-previous-runs, try-next-runs, process-overflowing-content, not-even-first-glyph-fits, wrap-unbreakable-content |
| webkit/tos | place-inline-text-content, non-wrapping-content, single-character-content, revert-to-non-overflowing-hyphen, consume-trailing-line-break |
| webkit/range | first-line-skips-box-start |
| webkit/ilb | next-wrap-opportunity, opportunity-at-open-box-start, is-at-soft-wrap-opportunity, level-change-rescans-same-box, has-trailing-soft-wrap-opportunity, rebuild-line, wrap-reverts-after-box-start, spanning-inline-box, last-line-with-inline-content |
| webkit/output | visual-order-display-boxes |
| gecko/bidi | replace-separators |
| gecko/glyphs | cluster-boundaries, word-cache-limit-32 |
| gecko/script | itemizer, itemizer-uint32-fixup-quirk, latin-fast-path |
| gecko/linebreaker | no-break-inside-cluster, compressed-leading-whitespace, trailing-break |
| gecko/lines | break-and-measure-text, trailing-break-flag, break-before-frame, notify-optional-break, empty-pass-joins-next-line, paragraph-without-line, visual-frame-order |

## Rules chosen by lab score (11)

| Rule | Audit | Lab reach (rebuild/main/obligations) |
|---|---|---|
| blink/measure/joining-context-opentype | blink D1 | 410/3976/0 (fail 59%) |
| blink/output/joins-next-line-opentype | blink D1 | 124/3909/0 (fail 57%) |
| blink/output/width-copies-lab-visibility | blink D3 | 10379/29508/7508 (fail 8%) |
| webkit/output/width-copies-lab-visibility | webkit D1 | 10389/29451/7510 (fail 1%) |
| webkit/output/default-ignorables-trailing-excluded | webkit D1 | 334/4191/21 (fail 0%) |
| webkit/gap/canvas-language | webkit D2 | real reports 3900/4506 (fail 4%) |
| webkit/gap/simplified-measuring | webkit D2 | real reports 1903/1219 (fail 1%) |
| gecko/lines/zwj-before-joined-suffix | gecko D1 | 948/6511/1100 (fail 12%) |
| gecko/output/width-copies-lab-extent | gecko F9, D2 | 10381/29346/7464 (fail 3%) |
| gecko/output/positive-advance-rect-rule | gecko D2 | 1074/9281/76 (fail 6%) |
| shared/painter/zwj-at-joined-line-edges | gecko D3 | b 124/3909/0 (fail 57%); g 112/3342/0 (fail 24%) |

## Rules whose probes give no confirming verdict (21)

blink/measure/space-as-u2028 (blink-gaps H5-H8 ran, no recorded verdict); blink/measure/ignorables-as-u2060 and ignorables-left-out-if-8bit (27 of 29 probe strings); blink/measure/zwj-inside-group-edge (blink-text H29 refuted); blink/measure/joining-context-opentype and blink/output/joins-next-line-opentype (blink-text H3 refuted); blink/shape/pair-adjustment-on-glyph-before (blink-gaps H12, no recorded verdict); blink/hankerning/font-data-from-canvas (F2, PingFang SC only); blink/breaks/break-all-loose-hyphen (H20 refuted); blink/gap/unsafe-to-break-group-edge-joining; blink/gap/tab-stops (F4); webkit/content/simplified-measuring-eligible (correction 5); webkit/content/break-spaces-item-per-space (H11 partly refuted, cache); webkit/ilb/soft-hyphen-counted-in-fit and rebuild-for-soft-hyphen-no-epsilon (H6 inconclusive); webkit/gap/page-zoom (not run); webkit/gap/control-character-width, simplified-measuring and ui-language (recorded rows only); gecko/gap/font-fallback-pinned-emoji (F2, F3); gecko/gap/bitmap-emoji-size (cross-cutting 1 refuted at apd 27).

## Rules most associated with failing cases

Rules reached on at least 100 scored cases, with the share of those cases failing lineCount, breaks or widths. Reach comes from the stand-in census; outcomes come from the installed browsers.

| Engine | Rule | Kind | Scored cases | Prediction fail % | Class |
|---|---|---|---:|---:|---|
| blink | gap/font-fallback-u-fffc | named gap | 183 | 100 | M, L |
| blink | gap/unsafe-to-break-group-edge-joining | named gap | 364 | 86 | N |
| blink | lines/reshaped-part-measured-alone-when-cut | heuristic | 745 | 73 | L |
| blink | shapeline/line-end-reshape | ported rule | 2457 | 72 | L |
| blink | measure/joining-context-opentype | choice by score | 4386 | 59 | S, N |
| blink | output/joins-next-line-opentype | choice by score | 4033 | 57 | S, N |
| blink | gap/unsafe-to-break-line-edge-joining | named gap | 4021 | 57 | L |
| blink | shapeline/line-start-reshape | ported rule | 4416 | 53 | L |
| blink | shape/unsafe-to-break-offsets | recipe | 5860 | 42 | L |
| blink | shape/joining-reads-5-code-points-context | ported rule | 6592 | 41 | L |
| webkit | breaks/ideograph-quote-rule | ported rule | 813 | 22 |  |
| webkit | style/han-lang-specialized-chinese-locale | ported rule | 292 | 14 |  |
| webkit | breaks/icu-with-prior-context | ported rule | 2401 | 8 |  |
| webkit | breaks/may-break-in-between | ported rule | 3789 | 7 |  |
| webkit | ilb/opportunity-at-open-box-start | ported rule | 5216 | 4 | L |
| webkit | ilb/spanning-inline-box | ported rule | 4635 | 4 | L |
| webkit | gap/canvas-language | choice by score | 8379 | 4 | S |
| webkit | breaker/first-character-16bit-extends | ported rule | 353 | 4 |  |
| gecko | output/joins-next-line | recipe | 3416 | 24 | L |
| gecko | spacing/no-letter-spacing-cursive | ported rule | 361 | 12 |  |
| gecko | lines/zwj-before-joined-suffix | choice by score | 7391 | 12 | L, S |
| gecko | lines/hyphen-in-frame-width | ported rule | 6901 | 10 |  |
| gecko | lines/leading-whitespace-skipped | ported rule | 479 | 9 |  |
| gecko | transform/cr-kept-stops-collapsing | ported rule | 154 | 8 |  |
| gecko | lines/first-opportunity-taken-even-if-overflowing | ported rule | 10902 | 8 |  |
| gecko | lines/soft-hyphen-opportunity | ported rule | 10673 | 7 |  |
| gecko | bidi/paragraph-after-preserved-newline | ported rule | 182 | 7 | M, L |
| gecko | transform/discard-soft-hyphen | ported rule | 12057 | 7 |  |
