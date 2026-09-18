# Rebuild charter

This branch establishes the edge: the most correct text layout predictor we can build from engine source, with Canvas as
the only measurement. Current Pretext (main) and this rebuild will later be interpolated. That only works if this is the
extreme endpoint rather than a compromise, so nothing here is shaped by main's history. Main contributes convenient
helpers and objective facts (this glyph behaves like this in that browser), not targets.

Correct means: for a paragraph of styled runs and an environment, predict the lines each installed browser's own layout
produces (breaks, line count, widths) and paint them with the DOM, without DOM reads for widths and without font files.

## Boundaries for this session

Stated by the maintainer on 2026-09-16:

- **No detection of system or OS languages** (macOS AppleLanguages and similar). The library reads only page facts: the
  engine from the user agent, `devicePixelRatio`, `<html lang>`. The UI or system language an engine uses for unlabeled
  content is an explicit input; when it isn't given, predictions for such content report the `ui-language` gap.
  Offline research may read OS settings to explain an observation, but nothing in the library does.
- **No glyph rendering.** The library never draws text to read pixels (no `fillText`/`getImageData`); Canvas
  `measureText` results are the only font information.
- **No font loading.** The library doesn't fetch or parse font files. Pages may use web fonts like any app; allowing the
  library to load fonts is a possible future direction, deliberately out of scope now.

Everything else is open: data model, API, algorithms, harnesses and tests.

Research tooling is outside these boundaries: offline programs may read OS settings or font tables to explain an
observation or to produce objective inputs for tests, such as the lab's table of font facts for the fonts its cases use.
The lab declares those facts the way an app that knows its fonts would, in its `facts` configuration; the headline
configuration declares none (decisions of 2026-09-18, below).

## Tentpoles

1. **Engine-true output.** Layout returns what the engine computes: line boxes, fragments, advances and positions in the
   engine's own units, with trimmed, collapsed and hanging content marked. The library never shapes its output to what a
   test observer can see.

2. **Observation is ported too.** What a browser reports through DOM geometry (Range client rects, selection rects, box
   extents) comes from each engine's geometry code at the pinned version. The lab derives expected observations from
   engine-true output by those ported rules and compares them exactly. A fact that can't be observed is marked
   unobservable by a rule, never by fitting.

3. **Rules from source, facts from browsers.** Every rule in the library cites pinned source or a recorded probe verdict.
   No choices by lab score, no name-keyed heuristics, no allowlists, no tolerances. Where no measured width of the
   paragraph's text tells something the engine depends on (font technology such as AAT vs OpenType joining, glyph coverage
   such as U+2010, the monospace trait, optical sizing, which glyph of a kerned pair carries the adjustment), the fact is
   an optional input on the font declaration. A fact that isn't given is asked of Canvas by a dedicated check where one is
   sound for the engine (`src/measure/font-checks.ts`); otherwise its documented default stands, and the prediction
   reports the named gap it falls under.

4. **Tests designed for this rebuild.** Layers:
   - engine data parity against oracles (break scans, bidi, graphemes, ICU4X replay);
   - probe verdicts per browser release, as regression tests of browser facts;
   - rule-targeted generated cases: every library rule has at least one family, at widths derived from the browser's own
     unwrapped observations so thresholds are exact without using the library's predictions;
   - held-out random cases the port never iterated on;
   - a no-regression gate over all of the above.
   A coverage matrix maps rules to tests and lists uncovered rules.

5. **Main is an external corpus, not a spec.** Main's suite stays a measurement corpus. Main's tests enter this branch
   only as objective browser facts with provenance. Pins that hold main's heuristics in place, tolerances, main's API
   contracts and families built around main's weaknesses aren't inherited. Where main passes and this fails, the case is
   triaged: an objective fact this must learn, a pass main got by accident, or an opinion we no longer hold.

6. **Environment is explicit.** Engine and version, device pixel ratio and zoom, page and UI language, string storage and
   page-history effects are inputs or named effects, never hidden constants. What a port's measuring recipes assume of
   the Canvas API is checked in the running browser, and a browser that lacks it is unsupported, by name.

7. **The painter reproduces predicted geometry** or names exactly why it can't.

8. **Performance and API shape come later.** Record costs. Don't bend the data model or correctness for a prepare/layout
   split; that split may not be the sweet spot anymore.

## Decisions of 2026-09-18

The maintainer's, after ceiling round 3's evaluation and critic (research/ROUND3-EVALUATION.md, ROUND3-CRITIC.md):

1. **The headline is with no supplied font facts.** The deliverable needs no font files and no font table. The library
   may ask Canvas things itself at runtime (`src/measure/font-checks.ts`; research/FACTS-FREE.md has what each fact
   decides); supplied facts stay an optional input, and a supplied fact is never checked. Tiers and evaluations run both
   configurations, `no-facts` first (lab README, "Test tiers").
2. **Firefox measures on an OffscreenCanvas always**: one measuring path. Round 3's detached `<canvas>` element at the
   device font size is removed. Its cost, measured against the round 3 evaluation's rows on the same cases and orders
   (specs/gecko-RESULTS.md "Ceiling round 4"):
   - outside the system font no line count or break moves;
   - widths lose 17 rows of the 1 au class on about 40,000 development and held-out cases, and 23 more on 48,290 fresh
     cases; synthetic bold costs 0 rows on the defined sets and 9 on the fresh ones (U+2764 alone in a bold span, 7 or 8 au).
     Both stay named residual classes with probe evidence (`gecko/one-shaping-unit-one-app-unit`, probes F7, F13, F27;
     `gecko/synthetic-bold-offset`, probes F14, F24);
   - an OffscreenCanvas never applies optical sizing, so `system-ui` and `-apple-system` widths are stand-ins: 192 widths,
     96 breaks and 32 line counts lost in `rule/system-fonts-and-sizes`, all covered by `optical-size`;
   - with no supplied facts `optical-size` is reported on 24,488 of 25,013 development cases, because Firefox's Canvas can't
     show an opsz axis, and the share of values reported as predicted falls from 96.3% to 6.5%. The metrics barely move
     (development widths 98.26% to 98.06%). Canvas calls are within 2% of the element path.
   Two alternatives are built, measured and left unmerged for the maintainer: `r4-gecko-alt-synthetic-bold` (c32a60a:
   synthetic bold confirmed from Canvas at two sizes; all 9 open rows pass, 0.1 more calls a paragraph; it doesn't reach
   symbols without the Emoji property, so the class stays) and `r4-gecko-alt-opsz-default` (d9ad391: where
   `opticalSizeAxis` isn't given, its documented default decides, true for the system font keywords and false for a named
   family; `optical-size` is then reported in 0 development cases and 95.4% of values are predicted, and a named variable
   font with an opsz axis would measure wrong without a gap. The charter removed Gecko's name-keyed optical sizing, which
   is why it isn't merged).
3. **The correctness line freezes after round 4, with a known tail.** Round 4b fixes only defects that give wrong lines or
   wrong exact values without warning, and what the test suite needs before the reference is frozen. Everything else found
   (classes under gaps that could become predictions, conditions that only diagnose, the rare-script tail, painter
   exactness) goes to the ledger's backlog as a known tail with case ids. It is local to the engines and doesn't shape the
   architecture. After the freeze: a simplicity-first clean-up of the library, then profiling; API questions later.
   Complexity matters, line count doesn't yet. Performance stays deferred (tentpole 8), but cost isn't added carelessly.
4. **Core Text's per-language family table is engine data**, like the libicucore break tables: macOS 27.0's answers to
   `CTFontDescriptorCreateForCSSFamily`, dumped offline and generated into the WebKit engine
   (`data/webkit/coretext-macos27/css-families.tsv`, `engines/webkit/generated/fonts.ts`), so the no-facts headline
   includes it. The orchestrator's call, flagged for the maintainer; the alternative is an environment input.
5. **No parity work against current Pretext (main)** (tentpole 5 stands as written).

## Known deviations to remove

What still stands against the tentpoles, then what was removed, one line each. The detail of a removed item is in
REPORT.md, specs/*-RESULTS.md and this file's history. Sources: research/{blink,webkit,gecko}-shortcut-audit.md
(2026-09-16), the charter evaluation and ceiling rounds 1 to 3 (REPORT.md, research/ROUND*-EVALUATION.md and -CRITIC.md),
and the round 4a owners' reports (2026-09-18).

### Standing

**Heuristics, constants and decision rules without a source reading (tentpole 3).** Each is in the rule registry as a
heuristic, or named here.

- Shared: `shared/env/engine-from-user-agent`. Since round 4b the user agent no longer stands alone: `detectEngine()` also
  asks the running Canvas for what the engine's measuring recipes assume (`src/measure/canvas-checks.ts`, below).
- Blink: `shape/wide-group-halved`; `shape/cluster-unit-grapheme` (chosen by lab counts in round 1: a position inside a
  grapheme takes the grapheme's position; treating every unit HarfBuzz doesn't mark a continuation as a cluster start
  passed 2 cases, U+0600 U+3000 in Amiri, and lost 8, Bengali conjuncts in Kohinoor Bangla; the source leaves it to the
  font, hb-ot-shaper-indic.cc:806-824, hb-ot-layout-gsubgpos.hh:1611, and the layout reports `glyph-clusters` there);
  `positionAdjust16` (`engines/blink/shape.ts`; `shape/position-adjust-window`), which decides the side of an offset an
  adjustment sits on that Canvas totals show only as a sum: the wide window before white space (probe blink-round3 R1),
  the pair window elsewhere. No source reading places a contextual adjustment, since the input glyphs of a chaining rule
  are the font's; where the two windows differ and the offset isn't before white space the position is a stand-in, and a
  line edge taken from it reports `unsafe-to-break`.
- Gecko: "the two sides measured with U+200D add up to the unit, so the prefix is the advance"
  (`measure/sides-add-up-is-exact`) holds to the app unit only: 6 passing Noto Nastaliq Urdu cases hold a position 1 au
  off (probe F22; F15 1,013 of 1,015). The suffix-side in-word recipe for clusters without joining forms
  (`measure/suffix-side-recipe`) has a probe verdict (F26, 567 of 567 offsets) and no source reading. A font's `rtla`
  lookups on a lone character at an odd level aren't predicted or named.
- WebKit: a run's share of text shaped across inline boxes (`lines/shaped-run-in-joining-context`) is a suffix
  difference of Canvas totals, chosen over the run alone in its joining context and over prefix differences by probe
  R10's counts (509, 492 and 474 of 770); that the shares add up to the joined total is from source.
  `hasLanguageDependentFallback` (`gap/language-dependent-fallback-table`), the table of characters whose system
  fallback a language moves (Han, kana, Hangul, CJK punctuation, fullwidth forms, enclosed alphanumerics, box drawing,
  geometric shapes and vertical forms under Han, kana and Hangul scripts; Arabic under ur and ks), comes from probes R3,
  R13 and R14, which see a font change only where advances differ: the source reading (every character no list family
  draws, under any locale) fires on 29% of passing lines at a lift of 0.8. Shaping under a locale has no condition (an
  Ethiopic word differs from Canvas under every language but am and none, R13; no lab case holds Ethiopic). History
  worlds vary one box at a time, a declared approximation: checked against the isolation protocol on 400 cases and not
  contradicted; products of worlds aren't laid out.
- Runtime font checks: `monospace` in WebKit (`measure/font-check-fixed-pitch`) is inferred from equal advances of `i`,
  `M`, `.` and the space, where WebKit reads a Core Text trait and three names Canvas doesn't show
  (FontCoreText.cpp:753-785); it is wrong for a font whose trait and advances disagree (MS-PGothic, MonotypeCorsiva).
  The linearity bound of the `opticalSizeAxis` check is a constant from source arithmetic, not from counts.
- Painter: `nowrap-hyphenated-or-joined`, `leading-ascii-space-slice-in-span` and `zwj-at-joined-line-edges` (tentpole 7).
- The scorer (tentpole 2), lab `score.ts` "Covered failures". Scorer 5: a unit is the grapheme cluster of a differing
  code point with its widthless and default-ignorable neighbours (in WebKit the differing node); runs of units whose
  widths net to zero need no gap (Gecko by the sum in app units, Blink within the one-LayoutUnit rounding of floored and
  ceiled carets); evidence comes from the failing line only; a point gap on a neighbouring line never covers; the painter
  keeps scorer 4's rule. Scorer 6: report-only rects are identified from geometry on both sides (a rect equal to the soft
  hyphen's positive rect on the same line; a zero-width rect on a line above another rect of the same code point), not
  from the engine's items or boxes; the WebKit moved-x rule explains a native rect width from the prediction's box width;
  a WebKit line where only the sum differs takes as units the nodes whose expected width the port marks limited. The
  scorer checks where a range or a stand-in is, not what the condition's source reading says.

**Facts no check answers (tentpole 3).** `pairKerning` (Canvas totals don't show which glyph carries the adjustment), the
per-family `coverage`, `ligatures` and `spacingInputs` sets, and `scriptLookups` have no Canvas check. `opticalSizeAxis`
is never learned as true, stays unknown for the system UI font and for primary families without Latin letters, and can't
be learned in Gecko at all; `joining` stays unknown for fonts whose joined forms are as wide as isolated ones (Courier New,
Menlo, Monaco). Without them the defaults stand under their gaps: Blink `script-context` fires on about a third of passing
lines, and the ligature facts don't settle ligatures that form in some contexts only (Geeza Pro lam-meem and lam-lam-heh,
Courier New `لله` and `ريال`), whose positions stay stand-ins under `glyph-clusters`. The re-queued U+3000 rule and
font-run edges in Blink read the coverage fact; without it those edges report `font-fallback`. A cost the checks can't
avoid: a platform font Canvas creates at 16px is the one Blink's DOM then uses for that family at 16px after zoom, which
matters for opsz fonts; no native observation moved on 256,381 lab cases, and the lab has no system UI text at that size.

**Failing classes the ports can't settle from Canvas.** Blink: 4 ProbeShantell exact-fit rows depend on which offsets
HarfBuzz left safe, and 3 `suite/space` Amiri rows on a contextual form's share of a joined pair; both report
`in-word-prefix`. The port's safe offsets pass its own width tests, which HarfBuzz's flags needn't, so `partsKnown` is
false on most wrapped lines, values within a float step of a LayoutUnit edge are then limited past 256 px unless the
advances' granularity keeps sums exact, and a cluster of several code points in an RTL item gets `graphemesLimit`. Gecko:
the two residual classes of the OffscreenCanvas decision; the unbounded frame of probes F18 and F20 is a Firefox bug
(`ComputeLigatureData` divides a signed advance by an unsigned count, gfxTextRun.cpp:249-289; rebuild/platform-bugs entry
14) that Canvas can't show, named in `in-word-prefix`'s reading. WebKit: ranges WebKit doesn't shape across boxes (several
Core Text glyph runs) and ligatures or pair adjustments across a box edge are stand-ins under
`rtl-shaping-across-inline-boxes`; `<wbr>` rects are untraced.

**Reported as predicted, or covered, where it shouldn't be (round 4b's engine items; definitions of REPORT §2.8).**

- Blink's `page-history` on runs measured at the CSS size (`system-ui`, `BlinkMacSystemFont`) covers failures page
  history doesn't cause: 28 isolated rows fail the same way alone in a fresh process, and measuring order doesn't move
  the DOM (ROUND3-CRITIC item 1). With `pairKerning` unknown, Blink reports positions between kerned glyphs inside a line
  as predicted with no gap on the line (43 rows behind the table in the no-facts configuration, one class: `xx LYAY bbbb
  cc dddd` in 20px Times New Roman, e.g. `c-0f3ea3e4202d62d0`), which `optical-size` masked while it fired on every line.
- WebKit's observation port reports values as predicted under the layout's own ranged gaps, and the x of nodes after a
  limited node (ROUND3-CRITIC item 3: 1,092 of 123,460 predicted node widths on one fresh set).

**Observation (tentpole 2).**

- A line whose WebKit `contentWidth` isn't the union of its boxes is marked unobserved by a scorer rule, not by a ported
  engine rule: 243 development, 257 held-out 09-16 and 279 sealed-3 cases in round 3, with 8 of the 9 held-out giants.
- Native lines across nodes come from vertical-centre grouping, a named observer assumption (scorer 3 places a code point
  rect by its own node's box), and `y` and `height` are outside the observation contract. Line boxes taller than the line
  height would move slot rows, and no rule checks that.
- Firefox's history-dependent emoji cases aren't a stable set between identical runs (190 and 104 on the held-out suite
  sample with the same files, parts and orders: the asynchronous character map loading,
  gfxPlatformFontList.cpp:1474-1486), so the ledger can't compare them as a fixed set.
- 75 passing webkit-host family cases hold one wrong predicted value each (a code point or element rect; untraced), and
  the WebKit observation port measures its in-box stand-ins with the declared family list where the engine names the
  generic's family; those values are limited, never predicted. Both are round 4b items.

**Environment (tentpole 6).**

- `contentLanguage` is read only by Blink, Chrome's accept languages have no input, and WebKit's full preferred-language
  list isn't settled.
- The library pins Chrome 153.0.8010.48 and accepts .50 as source-identical (`env.ts` `SOURCE_IDENTICAL_BUILDS`); the pin
  itself hasn't moved. A neighbouring build is predicted with the nearest data under `engine-build` (research/
  VERSION-DRIFT.md: on Chrome 152 and 155 and Firefox 153.3esr and 157.0b2 no status changed outside the cases whose
  native layout drifted, at most 0.07 points on a metric).
- The lab's page doesn't call `detectEngine()`: its predictor derives the engine from the browser it launched, so a lab
  run in a browser whose Canvas lacks an assumption still predicts. The probe `probes/canvas-checks.ts` is the check per
  release until the page refuses (tests owner).
- Tier 1 can't see V8 string storage; Chrome's 4,528 storage-sensitive cases go to tier 2 by rule when the code that
  builds Canvas strings changed, a path rule, not a detection.

**Tests (tentpoles 4, 5).**

- No library rule carries a `// rule <id>` annotation in source, and ids an owner's report gave only as a row stay
  provisional in the registry (`declaredBy` says which).
- The lab's `obligations` family and G0 baselines are derived from main's tests and the final runs; they are measurement
  inputs until each obligation is triaged under tentpole 5. research/MAIN-TRIAGE.md and `rebuild/lab/triage/` hold the
  records, but `cases/obligations.ts` doesn't read them (TEST-ARCHITECTURE §7.1). The adopted lab gate baselines block
  on the main-derived suite samples and the burned 2026-09-16 held-out sets (CHARTER-CRITIC item 17) and are scorer 4's;
  G0 is still keyed on user agents and scorer 1. Round 3's staged seeds (scorer 5) refuse scorer 6's runs; tier 2's
  seeds are staged in `rebuild/tests/baselines/staged-round4-sets` and describe the round 3 library until they are made
  again after round 4's merges.
- `lab/gate.ts` keys on case ids alone; 714 ids sit in two tier sets (the smoke sample, `features-en-US`), where the gate
  is coarser than the ledger, which keys on set and id.
- Sealed sets 1 to 3 each ran once, counts only; no sealed-4 exists yet.
- CHARTER-CRITIC items still open: 2, 3 (`measure/font.ts`: WebKit's page zoom recipe is unverified), 4 (`breaks/rbbi.ts`,
  element.cc and locale_settings_mac.grd cite Chromium 152; Blink's V8 and HarfBuzz citations were read again at Chrome
  153's pins 6b96683d and dfdc088c), 10 in part (`contentLanguage`), 13 to 16.

**Painter (tentpole 7).** It is scored by extents and wraps only, because `paint` doesn't report painted source offsets.
Painter limits are recorded per painted line and explain painter failures since scorer 6. 24 Blink pairs from round 2's
hanging-space regression still fail: the geometry now says which runs ShapeLine reshaped (`runs[].reshaped`), and the
painter doesn't read it yet. A wrapped line whose first cluster kept an adjustment with the previous line's last cluster
(U+3000 in a font without it, `c-0ee8c36920378f9f`) paints without it and has no limit. `rebuild/bench/page.ts` fails at
its first row against the inline-tree model (tentpole 8's record).

### Removed

- Charter and ceiling round 1: each engine's public `width` copying the lab scorer's visibility rules; Blink's global
  OpenType joining constant, Gecko's U+200D in-word suffix variant and WebKit's gap conditions shaped to lab counts;
  name-keyed detection of system-ui in Blink, of fixed pitch and the hyphen glyph in WebKit and of optical sizing in Gecko
  (font facts since); Blink's fitted "leave default ignorables out at 1 or 2 code units" rule (a ported rule since round
  2, cited at V8 6b96683d); the structural deviations before inline boxes, `<br>`, text-indent, text-align and variable
  widths (the inline tree of DESIGN.md §1.1 with line slots; no evaluation row raised `UnportedFeature`); browser-process
  languages recorded per row and given to the library; the first sealed held-out set.
- Ceiling round 2: Blink's `UnportedFeature` for `text-align: justify` over U+02C7 and above; Blink's pair adjustment put
  on the glyph before the offset by default (the `pairKerning` fact); the unchecked slot-rows assumption (protocol rows);
  `Element.getClientRects()` not compared; webkit-host's `preferredLanguages` taken from the tested page; Gecko's 69 au
  span edges (an 8-bit text run's script, probe F8) and the `fi` ligature at an emergency break (probe F9); Gecko
  `ui-language` reported even where `regionalPrefsLocale` is given.
- Ceiling round 3: rows without a Canvas call log; Blink and Gecko in-word positions reported as exact (limited states
  marked by the layouts; Gecko's joined sides, kern splits, ligature shares and spacing rules are predictions from source);
  `in-word-prefix`'s two unregistered Blink constants; Blink's hanging spaces painted in their own text node (traced to
  `ShapeLine`); `engine-build` on Chrome 153.0.8010.50; a browser moving in the middle of a round (pinned copies); the
  installed Safari page that stopped after 8 minutes (parts); WebKit `page-history` missing a line that history moves
  (history worlds); Blink `script-context` on 76% and WebKit `canvas-language` on 45% of development cases.
- Round 4a (2026-09-18):
  - Runtime font checks (`src/measure/font-checks.ts`, probe `probes/font-checks.ts`): tentpole 3's list of facts Canvas
    can't tell no longer holds for the primary family, U+2010 coverage, and in Blink joining and the absence of an opsz
    effect (WebKit's fixed pitch is answered by the registered heuristic above). With no supplied facts Chrome's line counts go from 98.28% to 99.50% (table 99.60%), and
    webkit-host equals the table.
  - Tests and lab: no recorded set was kept and nothing replayed as a test (`rebuild/tests/replay.ts` compares every case's
    full prediction with a frozen reference from recorded Canvas answers; on the six recordings of 2026-09-18 all 380,882
    cases replay the browser's own prediction exactly; it is a change detector whose expected values are the library's
    own at a commit, so it gates nothing by itself and sits outside the independence rule); the two observation
    consequences without a scorer rule and `c-4bb3746469073e4d` (scorer 6; no metric status changes against scorer 5 on
    round 3's rows); `painterLimits` not exported or recorded (painter-only failures without an explanation, facts
    configuration, development: Chrome 14 to 1, Firefox 451 to 6, webkit-host 960 to 4); two definitions of weak coverage
    (lift is over prediction failures alone, painter-only failures apart); the two failing tests and the staged coverage
    matrix's exit 1; the second residual registry (`lab/residual-classes.json`).
  - Blink: the round 3 evaluation's three Chrome classes (the marked waw fixed, U+3000 across a wrap predicted with the
    coverage fact, the exact-fit break traced and covered); passing cases with a wrong predicted value (0 on every defined
    set and three fresh sets); `float32-precision` on 5.8% of passing lines (0.25%, narrowed from float32 arithmetic: 24
    bits and the advances' common power of two).
  - Gecko: round 3's detached canvas element and its open decision (decision 2 above); the OffscreenCanvas path without a
    lab run; the tab after a frame that starts inside a cluster (`CalcTabWidths` ported, probe F21); F18's verdict without
    a source trace; the Myanmar U+1038 values and wrong values under ranged paragraph gaps (30 passing cases to 6); the
    odd-kern guard k ≥ 3; the `float32-precision` bound derived for one app-unit ratio; `page-history` without a
    both-orders run (123 of 123 and 190 of 190 history-dependent cases reported); probes F7 to F19 without checks (83
    facts); the evaluation's open row `c-f3e8314c35b33990`, whose reading names the right cluster (probe F25) and which
    scorer 5 split into two runs; round 3's and round 4's Gecko rules missing from the registry.
  - WebKit: `canvas-language` on generic families (serif, sans-serif, cursive, fantasy, monospace and -webkit-standard are
    measured as the family the locale resolves them to, decision 4 above; 15.4% to 1.1% of passing development lines); the
    three registered items of round 3 (the 64px letter-spacing probe has a derived float32 bound checked per string, the
    0.75 to 1.5 bound is the Sterbenz interval, the nearer-of-two-sums test is Unicode Joining_Type); a `page-history` world
    laid out with the own carried width where the world's item differs.
- Round 4b: the build number as the only guard against a browser whose Canvas differs. `detectEngine()` checks what each
  port's recipes assume (context attributes, the ink box, what the ligature-free letter spacing adds) in two contexts and
  two `measureText` calls, and answers unsupported by name; Firefox 140.16.0esr, where predictions collapsed under an
  `engine-build` gap alone, is refused for its missing `lang`, the 0.001px spacing kept as a fraction and the ink box it
  moves, and the five neighbouring builds that predicted well pass (probe `probes/canvas-checks.ts`).
