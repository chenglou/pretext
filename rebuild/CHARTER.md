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
The lab declares those facts the way an app that knows its fonts would.

## Tentpoles

1. **Engine-true output.** Layout returns what the engine computes: line boxes, fragments, advances and positions in the
   engine's own units, with trimmed, collapsed and hanging content marked. The library never shapes its output to what a
   test observer can see.

2. **Observation is ported too.** What a browser reports through DOM geometry (Range client rects, selection rects, box
   extents) comes from each engine's geometry code at the pinned version. The lab derives expected observations from
   engine-true output by those ported rules and compares them exactly. A fact that can't be observed is marked
   unobservable by a rule, never by fitting.

3. **Rules from source, facts from browsers.** Every rule in the library cites pinned source or a recorded probe verdict.
   No choices by lab score, no name-keyed heuristics, no allowlists, no tolerances. Where Canvas can't tell something the
   engine depends on (font technology such as AAT vs OpenType joining, glyph coverage such as U+2010, the monospace trait,
   optical sizing), the fact is an explicit input on the font declaration with a documented, Canvas-observable default,
   and the prediction reports the named gap it falls under.

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
   page-history effects are inputs or named effects, never hidden constants.

7. **The painter reproduces predicted geometry** or names exactly why it can't.

8. **Performance and API shape come later.** Record costs. Don't bend the data model or correctness for a prepare/layout
   split; that split may not be the sweet spot anymore.

## Known deviations to remove

From rebuild/research/{blink,webkit,gecko}-shortcut-audit.md, 2026-09-16, with their status after the ceiling round 1
evaluation of 2026-09-17 (REPORT.md §2-§7):

- Removed: each engine's public `width` copying the lab scorer's visibility rules. Engines return their own geometry, and
  the lab compares it through the observation ports (tentpoles 1, 2).
- Removed: Blink's global OpenType joining constant (now the `joining` fact); Gecko's U+200D in-word suffix variant (now
  `in-word-prefix`, at 77 line counts against the final runs); WebKit gap conditions reshaped to lab counts (now the source
  conditions) (tentpole 3).
- Removed: name-keyed detection of system-ui in Blink, fixed pitch and the hyphen glyph in WebKit, and optical sizing in
  Gecko. They are font facts; the lab declares them for its fonts from an offline table (tentpole 3).
- Removed in ceiling round 1: Blink's fitted length rule, "leave default ignorables out of the Canvas string at 1 or 2
  code units" (Blink fix-r8, probe blink-followups-20260917). The registry id `blink/measure/ignorables-left-out-if-8bit`
  now names what `engines/blink/shape.ts` does instead: an unsegmented Latin-1 paragraph's Canvas string leaves them out,
  and every other string keeps them as U+2060.
- Still heuristics in the rule registry: Blink `shape/wide-group-halved` and `shape/cluster-unit-grapheme`;
  `shared/env/engine-from-user-agent`; the painter's `nowrap-hyphenated-or-joined`, `leading-ascii-space-slice-in-span`
  and `zwj-at-joined-line-edges` (tentpoles 3, 7). In ceiling round 2 Blink's `measure/ignorables-left-out-if-8bit`
  became a ported rule, cited at Chrome 153's V8 (6b96683d). `shape/cluster-unit-grapheme` was chosen by lab counts in
  round 1: a position inside a grapheme takes the grapheme's position; treating every unit HarfBuzz doesn't mark a
  continuation as a cluster start (fix-r9) passed 2 cases (U+0600 U+3000 in Amiri) and lost 8 (Bengali conjuncts in
  Kohinoor Bangla). The source leaves it to the font, whose syllabic shaper and ligatures merge clusters
  (hb-ot-shaper-indic.cc:806-824, hb-ot-layout-gsubgpos.hh:1611), and the layout reports `glyph-clusters` there.
- Removed in ceiling round 1: the structural deviations before inline boxes, `<br>`, text-indent, text-align and variable
  widths (per-span styles and box sizes; Blink F1-F4, F7, F8; WebKit F1, F2; Gecko F1, F2, F5, F6). All three engines lay
  out the inline tree of DESIGN.md §1.1 with line slots, and no evaluation row raised `UnportedFeature`. Left: `<wbr>`
  rects are untraced in WebKit; Gecko's WBRFrame box is placed and reported since ceiling round 2. Removed in ceiling round 2: Blink threw `UnportedFeature` for `text-align:
  justify` over a character at U+02C7 or above; it now reads `IsCjkIdeographOrSymbol` from data generated from
  character_property_data.h and ICU 78.2's emoji data (tools/gen-blink-data.ts).
- Removed in ceiling round 2: Blink put every pair adjustment on the glyph before the offset, a default Canvas can't check.
  The font fact `pairKerning` now says where HarfBuzz puts it (GPOS on the first glyph, or the kern and kerx machine's
  `kern >> 1`), from the lab's font table; where it isn't given, the default stands and line edges report
  `unsafe-to-break` (tentpole 3).
- The lab's `obligations` family and G0 baselines are derived from main's tests and the final runs; they are measurement
  inputs until each obligation is triaged under tentpole 5. research/MAIN-TRIAGE.md re-observed main's regressions and
  required cases with the charter library, and `rebuild/lab/triage/` holds its records, refreshed by the ceiling round 2
  evaluation from the round 2 library's rows in both orders (Chrome 420, Firefox 587, webkit-host 736; charter library
  1,069, 745 and 736), but `cases/obligations.ts` doesn't read them yet (TEST-ARCHITECTURE §7.1). The lab gate baselines
  (`rebuild/lab/baselines/gate-<browser>-<build>.json`, seeded again by the ceiling round 2 evaluation for scorer 4 with
  every lost pair listed in `reseed-round2-lost-pairs.json`) block on the main-derived suite samples and the burned
  2026-09-16 held-out sets (CHARTER-CRITIC item 17); G0 is still keyed on user agents and scorer 1. The ceiling round 3
  evaluation staged scorer 5 seeds in `rebuild/lab/baselines/staged-round3` and `rebuild/tests/baselines/staged-round3`, each
  with a record of its lost pairs, their covering gaps and attributions, and the pairs that leave through history
  dependence; the adopted seeds refuse round 3's runs by scorer until those are adopted after the critic.
- Found in the charter evaluation, with their status now:
  - Removed: the browser-process languages are recorded per row and given to the library (Chrome `uiLanguage`, Firefox
    `regionalPrefsLocale`, webkit-host `preferredLanguages` and ICU default locale). Since ceiling round 2 Gecko measures
    `lang=""` runs under `regionalPrefsLocale` and reports `ui-language` only where it isn't given (prepare.ts;
    nsFontCache.cpp:61-63). Left: `contentLanguage` is read only by Blink, Chrome's accept languages have no input, and
    WebKit's full preferred-language list isn't settled (tentpole 6).
  - Still: a line whose WebKit `contentWidth` isn't the union of its boxes is marked unobserved by a scorer rule, not by a
    ported engine rule: 243 development, 261 held-out 09-16 and 244 sealed-2 cases in ceiling round 2, and 243, 257 and 279
    sealed-3 cases in round 3, with 8 of the 9 held-out giants (tentpole 2).
  - Still: native lines across nodes come from vertical-centre grouping, a named observer assumption (scorer 3 places a
    code point rect by its own node's box), and `y` and `height` are outside the observation contract (tentpole 2).
  - Still: the painter is scored by extents and wraps only, because `paint` doesn't report painted source offsets
    (tentpole 7).
  - Removed in ceiling round 3: rows didn't keep the Canvas call log, so nothing replayed offline (DESIGN §8.3 stage 0).
    `lab/run.ts --record-measurements` stores every Canvas call and dictionary segmentation of every case beside the rows,
    and `lab/measurements.ts` replays a library build against them with no browser: on the development `runs` set the
    replay gives the recorded layout on all 2,580 cases in each browser. Left: it is opt-in, and no recorded set is kept.
  - Still: no library rule carries a `// rule <id>` annotation in source; 19 registry ids are provisional, and so are the
    55 stage 5 ids (tentpole 4).
  - Removed: the sealed held-out set `sealed-20260917` exists and was run once, in the ceiling evaluation, scored counts
    only (tentpole 4). Two of its generator sources (`lab/cases/case.ts`, `build.ts`) gained tree cases after sealing;
    the case files' hashes are unchanged and flat cases keep their ids. The second set, `sealed-2-20260917`, ran once in
    the ceiling round 2 evaluation, counts only, and the third, `sealed-3-20260917`, once in the round 3 evaluation, counts
    only (all 11 hashes verified first; no sealed-4 exists yet).
- Found in ceiling round 1:
  - Removed in ceiling round 2: the slot-rows observer assumption wasn't checked. Scorer 4 marks a row whose slot floats
    sit outside their rows as a protocol row, never a pass or a fail (lab `score.ts` `slotProtocol`): Firefox 15 and
    webkit-host 7 of round 1's feature-family rows, the critic's 22. Firefox and WebKit move row 0's second float below the
    first line when it doesn't fit beside the indented line; derivation's width floor now follows each engine's rule
    (`tests/derive.ts` `minimumUnits`), and `lab/gate.ts --prune-protocol` removed the accidental passes from the feature
    baselines. Line boxes taller than the line height would move rows too, and no rule checks that yet (tentpole 2).
  - Removed in ceiling round 2: `Element.getClientRects()` wasn't compared. Scorer 4 compares element rects, so the 719
    Chrome, 670 Firefox and 701 webkit-host feature-family line counts left unobserved there are observed (tentpole 2).
  - Removed in ceiling round 2: webkit-host's `preferredLanguages` came from the tested page's `navigator.languages`. The
    driver now evaluates WebKit's steps from the UI process's `AppleLanguages` to the WebContent process's list with
    `webkit-host --print-languages` before launch, and the page only checks the first entry (lab README, "Browser-process
    languages"; tentpole 6).
  - Gecko failures without a gap name: 1 au per-glyph widths (specs/gecko-canvas.md §3 N7, inferred), a Helvetica Neue
    ligature whose width equals its parts, and two 69 au span edges where only the observation port marks a value limited
    (tentpole 3). Status in ceiling round 2 (specs/gecko-RESULTS.md): the 69 au rows were a port bug, an 8-bit text run's
    script (fixed from gfxTextRun.cpp:2744-2747, probe F8); the ligature is `f` taking half of `fi` at an emergency break,
    now reported as `in-word-prefix` where the clusters around the break measure differently with ligatures off (probe
    F9); the 1 au class is verified (probe F7) and has no Canvas-observable condition, so it stays a failure without a gap,
    reported as a residual class since the round 2 evaluation (below). Removed in ceiling round 3: a canvas element at the
    device font size reproduces the 1 au class, and the ligature is predicted by shares ("Gecko, ceiling round 3" below).
  - CHARTER-CRITIC items since resolved: 1 (WebKit's coverage recipe reports `font-fallback`), 8 and 9 (quoted family
    names), 12 (process languages given). Still open: 2, 3, 4 (library citations at Chromium 152; in ceiling round 2 Blink's
    V8 and HarfBuzz citations were read again at Chrome 153's pins 6b96683d and dfdc088c, and element.cc and
    locale_settings_mac.grd stay at 152), 10, 11, 13 to 16.
- Found in the ceiling round 2 evaluation (REPORT.md §2, 2026-09-17):
  - Gecko's 1 au class is a residual class, not a gap and not an open model bug: each of its 14 development and held-out
    rows has one node rect exactly 1 au off in one of probe F7's three strings, and the DOM paints the predicted line at
    the native width (REPORT §2.8). It stays without a Canvas-observable condition (tentpole 3). Removed in ceiling round
    3 where the page can create a `<canvas>` element; it stays a class of the OffscreenCanvas fallback (below).
  - Blink reports positions inside joined and ligated words as exact where Canvas prefix widths can't give them. Round 2
    narrowed `in-word-prefix` to break decisions, and the observation port's limited state went with it: 2,030 development
    cases that pass lineCount, breaks and widths hold a predicted code point x or width that differs from the browser
    (tentpoles 1 to 3).
  - Gecko: a heart after a keycap mark, split across spans (`⃣❤` in bold 14px Helvetica Neue), is 7 au narrower natively
    with no gap on the line, found on fresh development sets after three sealed-2 rows showed widths 8 au off outside the
    1 au signature. Not probed (tentpole 3). Removed in ceiling round 3: it is synthetic bold, whose offset isn't linear in
    the device size (gfxFont.h:1899-1904, probe F14), and the canvas element at the device size adds the DOM's.
  - WebKit's `page-history` condition misses a line that page history moves: `c-66ae4ab7d56cb0ae` passes alone in a fresh
    process and fails in both orders of its set, so the two-order protocol can't see it either (tentpoles 2, 3). Status in
    ceiling round 3: the condition is computed from history worlds (every other item list the break cache can hand a box,
    one box at a time, a declared approximation; specs/webkit-RESULTS.md "Ceiling round 3"). In the evaluation it reports
    every history-dependent webkit-host case (development 82, held-out 180, fresh 46, 66 and 54), no history-dependent case
    fails without a covered explanation in both orders, and it still fires on 2,148 of 25,098 other development cases.
  - Line-local gaps that fire on a large share of passing cases: Blink `script-context` on 76% of the development cases,
    WebKit `canvas-language` on 45%. They are read from source, and nearly every webkit-host prediction failure is covered
    only by gaps with a lift below 2 (development 201 of 210, held-out 261 of 261). Narrowing them needs inputs Canvas
    doesn't give (tentpole 3). Status in ceiling round 3: `script-context` fires on 38% of the development cases (31% of
    passing lines) and `canvas-language` on 17% (15%), narrowed from source readings and font facts. Whether webkit-host's
    coverage is weak now depends on the lift: over cases failing any metric, which its painter failures dominate, 187 of 205
    development prediction failures are still covered only by conditions under 2; over prediction failures alone, 2 are
    (`tab-stops`). `canvas-language` still covers 474 of webkit-host's 686 prediction failures on the evaluation's fresh
    sets.
  - The painter regressed on sets its owner didn't run: Blink's hanging spaces painted in their own text node move the
    letter before them by its pair adjustment with the space, 58 Chrome pairs with the prediction unchanged, not traced to
    source (tentpole 7). Removed in ceiling round 3: traced to `ShapeLine` (a node of its own ends the text's item, whose
    end is never reshaped, where the paragraph's overflow break reshaped it), and the spaces take one of three forms by
    that reading; the 33 hanging-space cases pass again. 24 pairs that round 2's trimmed-space box lost still fail: the
    paragraph reshaped the whole part (`first_safe.offset >= break_opportunity.offset`), which the layout doesn't say.
    Round 2's Blink hanging-space exclusion from the soft wrap box, settled by which family regressed, is replaced by
    source readings. `painterLimits` names a limit per line (DESIGN §7 "Limits"); the lab doesn't record it yet.
  - Installed Chrome is 153.0.8010.50 since 2026-09-17 and the library pins .48: every Chrome row reports `engine-build`,
    native views are equal on every case both rounds ran, and TESTS.md §12 hadn't run for .50. Chrome's round 2 gate seeds
    are new files that say their family cases were derived under .48 (tentpole 6). Status in ceiling round 3: the lab and
    the probe runner launch pinned byte-identical copies of Chrome and Firefox, so a browser no longer moves in the middle
    of a round; §12 ran for .50 (all 756 facts of .48 unchanged, every family case derived under .48 derived again). Left:
    the library's own pin, and seeds from the new case files.
  - Removed in ceiling round 3 (an installed Safari run goes through 5-minute parts, each in a fresh tab with a WebContent
    process of its own, checked with history-dependent cases; lab README "Parts"): a hidden installed Safari page stopped
    in the one job that ran longer than 8 minutes, so the held-out and sealed-2
    combined files didn't finish in installed Safari; the development and family files did, equal to webkit-host case by
    case. The cause is read from WebKit's background CPU limit and process throttler, not verified from Safari's logs
    (REPORT §2.7).
- Found in the ceiling round 3 evaluation (REPORT.md §2, 2026-09-18; library at the tag `round3-work-done`, one bundle in
  every run):
  - **The ceiling isn't reached in Chrome.** On three fresh sets nobody had seen (34,115 cases) every set has a failure
    without a covered explanation, 6 rows in three new classes: an exact-fit break in ProbeShantell under letter spacing on a
    first line with no gap at all (the font of `c-8c84627af834611f`, whose `in-word-prefix` condition fires at wrapped line
    starts only), U+3000 kerned with the next line's first letter in Times New Roman, and an emergency break after a marked
    waw in Geeza Pro whose gaps start after the decision text. Firefox and webkit-host each have two unseen sets in a row
    without a new class, and one open row each in a class their owners had named (tentpoles 3, 4).
  - Gecko's cursive letter spacing reading names the wrong cluster on `c-f3e8314c35b33990`: natively the first Phags-pa
    letter takes the spacing, and the `font-fallback` range sits on the marked cluster. The three held-out rows of the
    unbounded frame (probe F18) are covered by `in-word-prefix` by position only (tentpole 3).
  - Registered from the WebKit owner's round 3 report, constants and a decision rule without a source reading: the 64px
    letter spacing that counts a string's spacing-bearing glyphs, the sanity bound of 0.75 to 1.5 times the unshaped sum on
    the Sterbenz reading, and the "nearer of two sums" test for whether two shaped runs join (a decision between two
    source-backed hypotheses, not a choice by counts). History worlds vary one box at a time, a declared approximation
    (tentpole 3).
  - Registered from the scorer owner's report, scorer 5's coverage heuristics (lab `score.ts`, "Covered failures"): a unit
    is the grapheme cluster of a differing code point with its widthless and default-ignorable neighbours (in WebKit the
    differing node); runs of units whose widths net to zero need no gap (Gecko by the sum in app units, Blink within the
    one-LayoutUnit rounding of floored and ceiled carets); evidence comes from the failing line only; a point gap on a
    neighbouring line never covers; the painter keeps scorer 4's rule. The scorer checks where a range is, not what the
    source reading says: the unbounded-frame rows above count as covered. Two observation consequences have no rule and
    count as open rows: WebKit's rect width `f32(f32(x + w) − x)` at a moved x (`c-9a66d090891a825d`, `c-653ac96abf5487ff`)
    and Blink's `suite/U+FFFC/start` rows, where a soft hyphen's copied rect moves the attributed line (tentpole 2).
  - "Weak coverage" had no fixed definition: round 2's lift counts painter-only failures as failing cases. The evaluation
    reports both lifts; one should be fixed (REPORT §7 item 8).
  - The Gecko port's OffscreenCanvas fallback (no `document`) has no lab run, so its gaps and the 1 au and synthetic-bold
    classes are uncounted there (tentpoles 3, 6).
  - `painterLimits` isn't exported or recorded, so painter failures without a covered explanation rose where conditions
    narrowed (development: Firefox 189 to 451, webkit-host 622 to 960; Chrome 72 to 14) (tentpole 7).
  - Two tests fail at the evaluated tree, neither in engine code: `tests/independence.test.ts` on
    `lab/baselines/no-facts-predictor.ts`, which imports library logic, and `tests/families/families.test.ts` on the retired
    rule id `webkit/measure/word-spacing-in-js`, which the families `following-space` and `tabs` still name; the staged
    coverage matrix loses that rule's last observed family, and its replacement has none (tentpole 4).
- Blink, ceiling round 3 (specs/blink-RESULTS.md "Ceiling round 3"):
  - Removed: Chrome 153.0.8010.50 no longer reports `engine-build`. `env.ts` `SOURCE_IDENTICAL_BUILDS` accepts it with its
    evidence (`git diff --name-only 153.0.8010.48 153.0.8010.50` lists chrome/VERSION alone, DEPS unchanged).
  - Removed: in-word positions reported as exact. The Blink layout marks the positions it takes from Canvas stand-ins
    (`BlinkGlyphCluster.startLimit`, the text item's `sizeLimit`), and the observation port reports a value as predicted
    only where the layout knows the item's x and the position inside it. Predicted values agree on 99.85% (rule families,
    where most differing values sit on lines whose breaks fail) to 99.998% of the development, held-out, family and fresh
    sets (round 2: 96.9% to 99.95%); 73% of the fresh sets' values are predicted with the lab's ligature and coverage
    facts.
  - Removed: `in-word-prefix`'s two unregistered constants. The two-cluster window is gone: the safe test reads the
    adjustment over the widest exactly measured window around the offset. The 2 LayoutUnit margin is derived in
    `engines/blink/index.ts` `edgeGap` from ShapeLine's two ceilings (shaping_line_breaker.cc:309-324, :543-553).
  - Still a heuristic, new: `engines/blink/shape.ts` `positionAdjust16` decides which side of an offset an adjustment sits
    on that Canvas totals only show as a sum: the wide window's before white space (probe blink-round3 R1, Noto Nastaliq
    Urdu's word-final forms), the pair window's elsewhere. The full window everywhere gained 11 development and 16
    rule-family line counts at joined positions and lost 6 (`ريال` in Courier New's fallback, c-11abbf1905a0c6ef); the pair
    window everywhere loses the Nastaliq lines. Where the two windows differ and the offset isn't before white space, the
    position is marked as a stand-in and a line edge taken from it reports `unsafe-to-break`.
  - Still: the ligature facts don't settle ligatures that form in some contexts only (Geeza Pro lam-meem and lam-lam-heh,
    Courier New `لله` and `ريال`); their positions stay stand-ins and their lines report `glyph-clusters`.
- Gecko, ceiling round 3 (specs/gecko-RESULTS.md "Ceiling round 3"; the owner was stopped after fresh set 15, and its
  write-up was done afterwards):
  - Removed: the 1 au residual class and the heart after a keycap mark. Where the page can create a `<canvas>` element, the
    port measures on a detached one at the DOM's device font size, whose text runs have the page's app units per device
    pixel and whose fonts come from the DOM's font cache (CanvasRenderingContext2D.cpp:4256-4269, :4353, :7132-7155). It
    equals the DOM on 243 of 243 probed units and 126 of 126 synthetic bold rows (probes F13, F14), and the emoji
    device-size recipe, `bitmap-emoji-size`, `optical-size` and the U+2007 and U+2008 gap go with it. **A decision for the
    maintainer** (tentpoles 3, 6): the measurement needs `document`, so a worker falls back to the OffscreenCanvas with
    round 2's gaps and the two classes unnamed, a path the lab doesn't run; the element shares the DOM's font groups, and
    no run of round 3 checked history dependence in both orders; the element quantizes 13.33px to 13.3833px where the
    OffscreenCanvas had 13.375px, and 24 `rule/system-fonts-and-sizes` cases fail under `font-size-quantization` that
    passed by accident before.
  - Removed: `in-word-prefix` reported wherever letters join or a pair kerns. Positions between joined letters (both sides
    measured with U+200D), even and odd kern splits, ligature group shares and the letter spacing rules around clusters
    and ligature groups are predictions from source, and the observation port limits only what the layout marks as a
    stand-in: predicted values went from 29% to 46% of all values to 91% to 99.8%, at 99.88% to 100% agreement on the
    defined sets. `in-word-prefix` fires on 4.24% of passing development lines (round 2: 12.00%), `glyph-clusters` on
    0.01% (9.90%), the emergency-break `font-fallback` on none with the coverage fact.
  - Still, new: **a probe verdict without a source trace.** A grapheme cluster split between its two marks across spans in
    Geeza Pro gives a frame 2^30 + 56 au wide natively and moves the word to its own line (probe F18): 3 held-out and 6
    fresh rows. They count as covered by `in-word-prefix` at the frame edge inside the cluster, whose source reading
    doesn't say that. A Firefox bug candidate (tentpoles 3, 4).
  - Still, new: `page-history` was widened to every U+FFFD (the process's cached fallback family,
    gfxPlatformFontList.cpp:1244-1268, :1328-1330) and to every emoji-capable cluster that measures differently in the
    run's context and in "Apple Color Emoji" alone (font matching's state, gfxTextRun.cpp:4003-4005, :3559-3569). It fires
    on 0.26% of passing development lines with a lift of 0.85 there (round 2: 0.01%), and no both-orders run backs it yet.
    The observation port doesn't limit values under it or under the cursive letter spacing `font-fallback`: fresh sets 2,
    11 and 15 hold 121, 94 and 132 passing cases with a wrong predicted value (tentpoles 2, 3). Status in the round 3
    evaluation, which ran both orders: `page-history` reports all 227 history-dependent development and held-out cases
    (round 2: none) and 56 of 25,012 others; on the fresh sets it reports 8 of 104, 14 of 116 and 95 of 95 history-dependent
    cases, yet 527 of all 542 pass lineCount, breaks and widths in both orders with exact predicted values, because the
    canvas element follows the DOM's font state. The owner's passing cases with a wrong predicted value aren't
    reproduced: the evaluation's fresh sets hold 0, 0 and 1, and their history-dependent cases hold none in either order.
  - Still, new: assumptions and constants without a source reading. The suffix-side in-word recipe for clusters without
    joining forms came in for cost after a stalled job, and rests on such a cluster shaping alone as it does after its
    neighbour; U+200C is appended to a lone mirrored neutral only, after a held-out row showed a lone mark shaping
    otherwise with it; the odd-kerning recipe needs a context at 8 times the size or more; the port's `float32-precision`
    bound of 2^16 device px is derived for 30 app units per device pixel (tentpole 3).
  - Still: passing cases with a wrong predicted value on the defined sets, 24 Myanmar corpus cases (U+1038 is a cluster
    start natively) and 6 Noto Nastaliq Urdu ones (one in-word position 1 au off where the sides add up); fresh set 15's
    open class (a tab after a frame that starts inside a cluster, `CalcTabWidths`, nsTextFrame.cpp:4349-4357, read and not
    ported); round 3's Gecko rules aren't in the rule registry, and probes F7 to F19 give no facts (tentpoles 2, 4).
