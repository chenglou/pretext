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
  2026-09-16 held-out sets (CHARTER-CRITIC item 17); G0 is still keyed on user agents and scorer 1.
- Found in the charter evaluation, with their status now:
  - Removed: the browser-process languages are recorded per row and given to the library (Chrome `uiLanguage`, Firefox
    `regionalPrefsLocale`, webkit-host `preferredLanguages` and ICU default locale). Left: Gecko reports `ui-language` for
    every `lang=""` run even when `regionalPrefsLocale` is given, `contentLanguage` is read only by Blink, Chrome's accept
    languages have no input, and WebKit's full preferred-language list isn't settled (tentpole 6).
  - Still: a line whose WebKit `contentWidth` isn't the union of its boxes is marked unobserved by a scorer rule, not by a
    ported engine rule: 243 development, 261 held-out 09-16 and 244 sealed-2 cases in ceiling round 2 (tentpole 2).
  - Still: native lines across nodes come from vertical-centre grouping, a named observer assumption (scorer 3 places a
    code point rect by its own node's box), and `y` and `height` are outside the observation contract (tentpole 2).
  - Still: the painter is scored by extents and wraps only, because `paint` doesn't report painted source offsets
    (tentpole 7).
  - Still: rows don't keep the Canvas call log, so nothing replays offline (DESIGN §8.3 stage 0).
  - Still: no library rule carries a `// rule <id>` annotation in source; 19 registry ids are provisional, and so are the
    55 stage 5 ids (tentpole 4).
  - Removed: the sealed held-out set `sealed-20260917` exists and was run once, in the ceiling evaluation, scored counts
    only (tentpole 4). Two of its generator sources (`lab/cases/case.ts`, `build.ts`) gained tree cases after sealing;
    the case files' hashes are unchanged and flat cases keep their ids. The second set, `sealed-2-20260917`, ran once in
    the ceiling round 2 evaluation, counts only.
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
    reported as a residual class since the round 2 evaluation (below).
  - CHARTER-CRITIC items since resolved: 1 (WebKit's coverage recipe reports `font-fallback`), 8 and 9 (quoted family
    names), 12 (process languages given). Still open: 2, 3, 4 (library citations at Chromium 152; in ceiling round 2 Blink's
    V8 and HarfBuzz citations were read again at Chrome 153's pins 6b96683d and dfdc088c, and element.cc and
    locale_settings_mac.grd stay at 152), 10, 11, 13 to 16.
- Found in the ceiling round 2 evaluation (REPORT.md §2, 2026-09-17):
  - Gecko's 1 au class is a residual class, not a gap and not an open model bug: each of its 14 development and held-out
    rows has one node rect exactly 1 au off in one of probe F7's three strings, and the DOM paints the predicted line at
    the native width (REPORT §2.8). It stays without a Canvas-observable condition (tentpole 3).
  - Blink reports positions inside joined and ligated words as exact where Canvas prefix widths can't give them. Round 2
    narrowed `in-word-prefix` to break decisions, and the observation port's limited state went with it: 2,030 development
    cases that pass lineCount, breaks and widths hold a predicted code point x or width that differs from the browser
    (tentpoles 1 to 3).
  - Gecko: a heart after a keycap mark, split across spans (`⃣❤` in bold 14px Helvetica Neue), is 7 au narrower natively
    with no gap on the line, found on fresh development sets after three sealed-2 rows showed widths 8 au off outside the
    1 au signature. Not probed (tentpole 3).
  - WebKit's `page-history` condition misses a line that page history moves: `c-66ae4ab7d56cb0ae` passes alone in a fresh
    process and fails in both orders of its set, so the two-order protocol can't see it either (tentpoles 2, 3).
  - Line-local gaps that fire on a large share of passing cases: Blink `script-context` on 76% of the development cases,
    WebKit `canvas-language` on 45%. They are read from source, and nearly every webkit-host prediction failure is covered
    only by gaps with a lift below 2 (development 201 of 210, held-out 261 of 261). Narrowing them needs inputs Canvas
    doesn't give (tentpole 3).
  - The painter regressed on sets its owner didn't run: Blink's hanging spaces painted in their own text node move the
    letter before them by its pair adjustment with the space, 58 Chrome pairs with the prediction unchanged, not traced to
    source (tentpole 7).
  - Installed Chrome is 153.0.8010.50 since 2026-09-17 and the library pins .48: every Chrome row reports `engine-build`,
    native views are equal on every case both rounds ran, and TESTS.md §12 hasn't run for .50. Chrome's round 2 gate seeds
    are new files that say their family cases were derived under .48 (tentpole 6).
  - A hidden installed Safari page stopped in the one job that ran longer than 8 minutes, so the held-out and sealed-2
    combined files didn't finish in installed Safari; the development and family files did, equal to webkit-host case by
    case. The cause is read from WebKit's background CPU limit and process throttler, not verified from Safari's logs
    (REPORT §2.7).
