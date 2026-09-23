# Rebuild charter

The active goal and iteration guide are in [README.md](README.md). The phase plans and dated outcomes below record the previous research endpoint.

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

1. **Engine-true output.** Layout gives what the engine computes: line boxes and fragments, with trimmed, collapsed and
   hanging content marked, and on request, from a paragraph prepared for inspection, advances and positions in the
   engine's own units. The library never shapes its output to what a test observer can see.

2. **Observation is ported too.** What a browser reports through DOM geometry (Range client rects, selection rects, box
   extents) comes from each engine's geometry code at the pinned version. The lab derives expected observations from
   engine-true output by those ported rules and compares them exactly. A fact that can't be observed is marked
   unobservable by a rule, never by fitting.

3. **Rules from source, facts from browsers.** Every rule in the library cites pinned source or a recorded probe verdict.
   No choices by lab score, no name-keyed heuristics, no allowlists, no tolerances. Where no measured width of the
   paragraph's text tells something the engine depends on (font technology such as AAT vs OpenType joining, glyph coverage
   such as U+2010, the monospace trait, optical sizing, which glyph of a kerned pair carries the adjustment), the fact is
   an optional input on the font declaration. A fact that isn't given is asked of Canvas by a dedicated check where one is
   sound for the engine (`src/measure/font-checks.ts`); otherwise its documented default stands, and the named gap it
   falls under is reported on request, by a paragraph prepared for inspection.

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
     cases; synthetic bold costs 0 rows on the defined sets and 9 on the fresh ones (U+2764 alone in a bold span, 7 or
     8 au). Both stay named residual classes with probe evidence (`gecko/one-shaping-unit-one-app-unit`, probes F7, F13, F27;
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
   Looked at again on 2026-09-19, on the maintainer's two conditions (the element is truly light, and workers keep working
   by feature detection), and left as decided: the element costs the same time and less memory, but a kept element
   context makes Firefox carry out the page's pending style sheet update inside `measureText`, and the only test for a
   document that gives the element the page's fonts reads a Gecko internal and has to be asked at every measuring call
   (research/FIREFOX-CANVAS-ELEMENT.md, with what would reopen it).
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

## Decisions of the re-architecture (2026-09-18 and 19)

The clean-up of decision 3 ran by research/ARCHITECTURE-PLAN-2.md, whose four decisions were taken as recommended
(DESIGN.md has the result, REPORT.md "The re-architecture" what it measured):

1. **Gaps and engine geometry are output on request.** A paragraph is prepared plain, which is what an application runs
   (lines and their pieces, no gap, no limit, none of the lab's geometry, no Canvas question that only those read), or
   inspected, which is what the lab runs. Tentpoles 1 and 3 read "on request" since; nothing about what is computed or
   reported for the lab changed, and a plain paragraph gives the inspected one's lines on every recorded case.
2. **The width belongs to the line slot**, not the paragraph: one prepared paragraph serves any width.
3. **The painter names no engine**: each engine gives its painting rules as data.
4. **No structure stores a measured value by its string.** The string memo was the ports' data flow and went; what a
   port needs twice it keeps as a local, a handed-on value or a field. The maintainer's line on caching: acceleration that
   is invisible, can't go stale and doesn't leak is fine, and a structure local to one layout call is data flow, not a
   cache; what outlives a call waits for profiling, apart from fixed data with a page's lifetime (parsed engine tables, a
   Canvas context per font, the runtime font checks' answers per font). The order of work stays: simplicity from data
   structures and data flow, then profiling and optimization, which may add complexity back, then the API
   (research/PROFILING-START.md has where profiling starts; the bar is 10,000 chat messages laid out from scratch in about
   2 s after the performance work, or the stateless ideal is dropped).

## Known deviations to remove

What still stands against the tentpoles, then what was removed, one line each. The detail of a removed item is in
REPORT.md, specs/*-RESULTS.md and this file's history. Sources: research/{blink,webkit,gecko}-shortcut-audit.md
(2026-09-16), the charter evaluation and ceiling rounds 1 to 3 (REPORT.md, research/ROUND*-EVALUATION.md and -CRITIC.md),
the round 4a to 4c owners' reports, the round 4 evaluation and its critic (2026-09-18; REPORT.md "Round 4 evaluation",
research/ROUND4-CRITIC.md). The line was frozen on 2026-09-18 (decision 3; REPORT.md "The correctness line, frozen"): what it
leaves open is listed with case ids in `rebuild/tests/known-tail.json`.

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
  lookups on a lone character at an odd level aren't predicted or named. The 16 probe pairs of correctness round 5
  (`measure/probe-pairs-per-context`) rest on "a face places all its Latin pairs one way", which no Canvas question
  closes and the source doesn't guarantee (below, under `pairKerning`; none of 1,008 installed faces does otherwise).
  The word scan (`lines/word-scan`, 2026-09-23) passes over the break candidates inside a word whose end fits on "no
  tail of a shaped word has a negative advance", a premise about fonts that no source gives and Canvas isn't asked
  for; the maintainer accepted it as a documented default. On the port's measurements it holds in every installed face
  at every instance CSS can ask for, though Firefox itself breaks it in two Arabic faces where the port can't see it
  (DESIGN.md §4.6), and an inspected paragraph reports `negative-word-tail` where the engine's loop decides a scan
  otherwise. Since the same day the port doesn't test for an optional ligature at a break opportunity that line breaking
  finds inside a shaping unit without `word-break: break-all` or `line-break: anywhere`, between Han characters, after a
  hyphen, at a dictionary break (`measure/no-optional-ligature-at-ordinary-breaks`), on the premise, which no source
  gives, that none spans one; a line that breaks a word inside itself keeps the test, where real text needs it, and an
  inspected paragraph reports `in-word-prefix` where a ligature spans such a break opportunity (DESIGN.md §4.4, "Taken
  out for speed"). On the same premise a group that required shaping forms isn't looked for there either
  (`measure/no-group-at-ordinary-breaks`); an inspected paragraph reports `in-word-prefix` where one spans the offset.
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

**Facts no check answers (tentpole 3).** `pairKerning` (in Blink and WebKit Canvas totals don't show which glyph carries
the adjustment; Gecko asks per offset, below), the per-family `coverage`, `ligatures` and `spacingInputs` sets, and
`scriptLookups` have no Canvas check. `opticalSizeAxis`
is never learned as true, stays unknown for the system UI font and for primary families without Latin letters, and can't
be learned in Gecko at all; `joining` stays unknown for fonts whose joined forms are as wide as isolated ones (Courier New,
Menlo, Monaco). Without them the defaults stand under their gaps: Blink `script-context` fires on about a third of passing
lines, and the ligature facts don't settle ligatures that form in some contexts only (Geeza Pro lam-meem and lam-lam-heh,
Courier New `لله` and `ريال`), whose positions stay stand-ins under `glyph-clusters`. The re-queued U+3000 rule and
font-run edges in Blink read the coverage fact; without it those edges report `font-fallback`. The checks measure in
the engine's own kind of context (Blink: text-rendering `optimizeLegibility`, part of the font cache key,
font_description.cc:308-331), so a platform font they make is shared only with the engine's contexts and with a page whose
text sets `text-rendering: optimizeLegibility`, where the engine's contexts share it too (platform bug A).

Gecko is the exception for `pairKerning` since correctness round 5 (2026-09-19; DESIGN.md §4.4,
`engines/gecko/advance.ts` `pairKernedShare`). Where the fact isn't given, Canvas tells which glyph of a kerned pair
carries the adjustment, per offset between two kerned glyphs and never as a fact of the declaration. Gecko rounds each
glyph's advance to app units, so HarfBuzz's three placements (all on the first glyph, half on each, all on the second)
can give totals one app unit apart. The adjustment R is what the unit's two measured sides show crossing the offset,
which the pair measured alone must equal, or be within 2 app units of for halves; the two clusters and the one after
them must be printable ASCII. Widths at the size times 2^k give the advances before rounding, and the pair's own total
tells a placement where that one gives R and the other two don't: never near a rounding tie, in a font whose advances
aren't linear in the size, or for the third placement, for which the port has no value. What it tells is about that pair
alone. Where it doesn't tell, 16 probe pairs asked once per Canvas context of a prepared paragraph strike placements out
together, and what they tell counts for a pair only where Canvas shows the probe letters' face draws one of its clusters
(a kerned pair is one face's) and, where the fractions let it be computed, the told placement gives the pair's own R.
That path rests on one inference Canvas can't close: a face places all its Latin pairs one way. HarfBuzz chooses between
GPOS and the kern machine once per face, script and language (hb-ot-shape.cc:131-187); nothing says so for a kerx table
that holds both subtable kinds or for a GPOS second value record, and a wrong answer there carries no gap
(`gecko/pair-placement-one-way-per-face` in `rebuild/tests/known-tail.json`). A pair that isn't told stays a stand-in
under `in-word-prefix`.

WebKit and Blink got no such recipe in the round (DESIGN.md §5). WebKit: what is left of `letter-spacing-ligatures` is a
pair adjustment no Canvas string gives, the one between two letters that the DOM leaves unligated under letter spacing
(liga, clig, dlig and hlig off) and Canvas merges. The port measures them apart with U+200C where the measured string
takes the simple font code path, which since the round is the string's own and not the box's
(`engines/webkit/measure.ts` `mergedGlyphs`, `isComplexCodePath`), and reports the gap on the pair; a family the
application declares again with the four features off would give the adjustment, and it is not built. Blink: it keeps
16.16 advances and rounds no glyph, so no total moves with the placement, and the ink box, `direction`, a bidi override,
letter spacing and the size times 2^k show neither the placement nor which letters one glyph cluster covers (probe
blink-cr5 K and L). The round's wider pair window, which reaches past a cluster that holds only default-ignorable
characters and marks (`engines/blink/shape.ts` `holdsNoBase`), changes which strings give the adjustment, not which
glyph carries it.

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

**Reported as predicted, or covered, where it shouldn't be (the round 4 evaluation; definitions of REPORT §2.8).**

- With no supplied facts some conditions fire widely enough to cover failures they don't cause, because the scorer checks
  where a range is, not what its reading says: Gecko's `optical-size` on 99.7% of passing lines at a lift of 1.00 (Firefox's
  Canvas can't show an opsz axis, so the fact is never learned; 212 tier failures and 224 fresh rows are covered by it
  alone, 48 of the fresh ones open or residual with the lab's facts), Blink's `script-context` on 31.9% (lift 1.64) and
  `glyph-clusters` on 11.0% (1.60): 30 of the 31 fresh Chrome rows that are open with the lab's facts read covered without
  them. The headline configuration's open counts are read beside the facts configuration's (REPORT.md "The correctness
  line"). Blink's scaled recipe for the system UI font reports `optical-size` over the whole run, which also covers by
  position (4 of 2,860 values at 13.33px are one LayoutUnit off).
- 13 fresh rich pre-wrap webkit-host cases pass every metric and hold one element rect width a float32 step or two off (1
  of them with no supplied facts); no tier set holds one. Traced at the freeze on the bidi members: not an observation rule
  but the engine's inline box width, which WebKit gets from `InlineRect::setRight` (`FloatRect::shiftMaxXEdgeTo`: the line
  box's width plus a float32 delta, InlineDisplayContentBuilder.cpp:728-822) where the library sums the children
  (`lab/webkit-element-rect-width-float-step`).
- Rect counts, predicted by definition, differ in cases whose prediction metrics all pass: 404 Chrome tier cases in each
  configuration (392 `rule/wbr-elements`, 12 `rich-prewrap/nested`) and 30 webkit-host ones; and the Blink observation port
  reports the x after a fallback-font cluster (U+FFFC) as predicted in 14 failing tier cases (research/ROUND4-CRITIC.md §1).
  The ledger's exact-value status shows them as `not exact` since the freeze.

**Observation (tentpole 2).**

- A line whose WebKit `contentWidth` isn't the union of its boxes is marked unobserved by a scorer rule, not by a ported
  engine rule: 243 development, 257 held-out 09-16 and 279 sealed-3 cases in round 3, with 8 of the 9 held-out giants.
- Native lines across nodes come from vertical-centre grouping, a named observer assumption (scorer 3 places a code point
  rect by its own node's box), and `y` and `height` are outside the observation contract. Line boxes taller than the line
  height would move slot rows, and no rule checks that.
- Firefox's history-dependent emoji cases aren't a stable set between identical runs (190 and 104 on the held-out suite
  sample with the same files, parts and orders: the asynchronous character map loading,
  gfxPlatformFontList.cpp:1474-1486), so the ledger can't compare them as a fixed set.
- Two observation classes of rich pre-wrap content stay open rows: a span whose only text is a trimmed space reports an
  element rect in Chrome where the Blink port expects none (`c-a37545c096e939be` on the tier sets, 26 of 11,892 fresh rich
  pre-wrap cases; every code point is on the right line), and a letter after preserved trailing spaces across a box end
  reports rects on two lines in WebKit (2 fresh cases, untraced). Element rects of spans without a box fragment (a `<wbr>`
  inside one, the font height stand-in) differ in rect counts only (404 tier cases: 392 of `rule/wbr-elements` and the 12
  `rich-prewrap/nested` ones first counted).
- Chrome's `Range.getClientRects()` hang (rebuild/platform-bugs entry 13) stalls a lab job, and the lab has no rule that
  sets such cases aside before a run: round 4b set 7 fresh cases aside by signature, and the evaluation one sealed-4 case
  without opening it.

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
- Tier 1 can't see V8 string storage; Chrome's storage-sensitive cases (4,695 with the lab's facts, 65,384 of 66,685
  without, where font check 4 asks a 15-unit sample) go to tier 2 by rule when the code that builds Canvas strings changed,
  a path rule, not a detection. No such rule routes a change under `src/paint.ts`, which tier 1 can't see at all.
- Chrome: a text node's storage is an input the library can't read. The Blink port takes a text node for 8-bit exactly
  when its characters are at most U+00FF, which is what the HTML parser and V8 make of literals, `JSON.parse`,
  `String.fromCharCode` and their concatenations, and what the library's painter paints. V8 keeps a slice, `split` part or
  match of 13 units or more out of a string that holds a character above U+00FF in two bytes, with whatever is built from
  it; a text node made from one is 16-bit, and Chrome segments its paragraph by script where the port takes one Latin
  segment (inline_items_builder.cc:725, inline_node.cc:1256-1290). Only a paragraph with no character that has a script of
  its own is shaped otherwise, in a font with other lookups for Common and Latin. No script can read a string's storage
  and no condition reports it (probe blink-storage S2, S4; specs/blink-RESULTS.md "String storage";
  research/BLINK-STRING-STORAGE.md, decision 2).
- The frozen line is one Mac at a device pixel ratio of 2: the OS is no part of the environment, `detectEngine()` answers
  supported for Chrome or Firefox on any OS, and no case runs at another ratio.

**Tests (tentpoles 4, 5).**

- 21 rule ids carry a `// rule <id>` annotation in source, of 550 current rules, and ids an owner's report gave only as
  a row stay provisional in the registry (`declaredBy` says which).
- The lab's `obligations` family and G0 baselines are derived from main's tests and the final runs; they are measurement
  inputs until each obligation is triaged under tentpole 5. research/MAIN-TRIAGE.md and `rebuild/lab/triage/` hold the
  records, but `cases/obligations.ts` doesn't read them (TEST-ARCHITECTURE §7.1). The adopted lab gate baselines block
  on the main-derived suite samples and the burned 2026-09-16 held-out sets (CHARTER-CRITIC item 17) and are scorer 4's;
  G0 is still keyed on user agents and scorer 1. The scorer 7 seeds of both configurations are adopted since the freeze
  (`rebuild/lab/baselines/{no-facts,facts}`, `rebuild/tests/baselines/{no-facts,facts}` and `sets`), with every lost pair
  attributed; they still block on the main-derived suite samples and the burned held-out sets. The seeds they replaced were
  recorded with the lab's facts, so the no-facts records list the pairs that need a supplied fact as lost.
- `lab/gate.ts` keys on case ids alone; 714 ids sit in two tier sets (the smoke sample, `features-en-US`), where the gate
  is coarser than the ledger, which keys on set and id.
- Sealed sets 1 to 4 each ran once, counts only. Every one of main's 238,524 suite cases has been used, so sealed-4 holds
  runs, ws and policy cases only and fresh sets draw no suite case: unseen suite-like cases need a new source.
- No derived-width rule family exists for round 4c's three fixes (tab-size on a span, justify beside a preserved newline or
  beside preserved spaces across a box end); the generated `rich-prewrap` set, at estimated widths, stands in.
- CHARTER-CRITIC items still open: 2, 3 (`measure/font.ts`: WebKit's page zoom recipe is unverified), 4 (`breaks/rbbi.ts`,
  element.cc and locale_settings_mac.grd cite Chromium 152; Blink's V8 and HarfBuzz citations were read again at Chrome
  153's pins 6b96683d and dfdc088c), 10 in part (`contentLanguage`), 13 to 16.

**Painter (tentpole 7).** It is scored by extents and wraps only, because `paint` doesn't report painted source offsets.
Painter limits are recorded per painted line and explain painter failures since scorer 6. 24 Blink pairs from round 2's
hanging-space regression still fail: the geometry now says which runs ShapeLine reshaped (`runs[].reshaped`), and the
painter doesn't read it yet. A wrapped line whose first cluster kept an adjustment with the previous line's last cluster
(U+3000 in a font without it, `c-0ee8c36920378f9f`) paints without it and has no limit. Painting a line as its own block
makes it a last line, which is most of the rich pre-wrap painter failures without an explanation (23 of Chrome's 28 on
three fresh sets with no facts).

**Performance (tentpole 8).** Recorded, not worked on yet: over 10,000 chat messages the library costs an application 3
to 21 times main's cold prepare from scratch, and 8 to 490 times main's layout at a new width on kept paragraphs
(research/BENCH-NIGHT.md, "The real pass"; one run, Chrome's under load). Most of it is Canvas contexts and runtime font
checks made per paragraph, and in Blink positions asked again at every fill (DESIGN.md §4.7).
research/PROFILING-START.md has the order of work.

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
    effect (WebKit's fixed pitch is answered by the registered heuristic above). With no supplied facts Chrome's line
    counts go from 98.28% to 99.50% (table 99.60%), and webkit-host equals the table.
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
- Round 4b, engines and lab (checked by the round 4 evaluation): Blink's `page-history` covering system UI failures it
  doesn't cause (the platform font sizes are the computed sizes floored to 1/100 px in float32, font_description.cc:271-282,
  so 16.8px is a 16.79px font in Canvas and a 33.59px one in the DOM; all 64 rule-family rows pass and `page-history` fires on
  no line); no-facts rows open because a pair adjustment inside a line had no gap (`unsafe-to-break` over the two clusters,
  hb-kern.hh:102-106; the 72 rows are covered and still fail); WebKit's observation port reporting values as predicted under
  the layout's own gaps (a line that reports a gap is limited as a whole, and the lines after it up to a forced break: 0
  differing predicted values on the tier sets in both configurations and orders; values predicted 10.6% and 14.5%); the 75
  passing webkit-host family cases with a wrong predicted value (98 traced: 42 an engine defect in a span's first and last
  display box, fixed; 28 page history; 28 beside runs shaped across inline boxes); the port's stand-ins measured with the
  declared family list (`WebKitTextBox.canvasFamily`); no measure-first check (Chrome and webkit-host move nothing; Firefox
  moves 121 emoji cases through the process's font fallback state, and a prediction holds for the state it was measured in);
  the synthetic bold rows counted as open (a registered residual class); the scorer's attribution leftovers (scorer 7).
- Round 4c: Gecko's tab-size read from the block instead of the text frame, a preserved newline that didn't set
  `lineEndsInBR`, Blink's justify end offset stopping at a close tag.
- The freeze (2026-09-18, research/ROUND4-CRITIC.md "Fix first"): the runtime font checks' contexts at text-rendering auto,
  which shared Blink's font cache key with the page's own text (they measure in the engine's own kind of context; WebKit's
  key holds the size opsz comes from, and Gecko is asked nothing); tier 2 blind to a predicted value going wrong where every
  metric passes (the ledger's exact-value status, format 2; tier 2 exits 1 on it); seeds staged and references not frozen
  (adopted; six references frozen at 6b21b68, 388,886 cases replaying exactly).
- Round 4b, shared: the build number as the only guard against a browser whose Canvas differs. `detectEngine()` checks what each
  port's recipes assume (context attributes, the ink box, what the ligature-free letter spacing adds) in two contexts and
  two `measureText` calls, and answers unsupported by name; Firefox 140.16.0esr, where predictions collapsed under an
  `engine-build` gap alone, is refused for its missing `lang`, the 0.001px spacing kept as a fraction and the ink box it
  moves, and the five neighbouring builds that predicted well pass (probe `probes/canvas-checks.ts`).
- After the line, string storage: the Blink port's two-byte slice reaching Canvas as one byte (the memo's lookup
  internalized it), one canvas asked the same characters in both storages, a text node's U+FFFC taken for an atomic
  inline's, and, in fonts Canvas shapes whole, a Latin range of script-neutral characters with a space measured as a
  two-byte string and shaped as Common (`shape.ts` `spacesStay`; fonts shaped word by word keep U+2028 and
  `script-context`). research/BLINK-STRING-STORAGE.md.
- The re-architecture (2026-09-18 and 19): gap building threaded through measuring, the string memo as the ports' data
  flow with the call log and Gecko's module-level memos, lab-only output computed on every line, shared code that named
  engines (the painter's 74 mentions last), the width on the paragraph, Blink's justification written into the item
  results it then read, a Blink gap list's grouping following how often a range was raised, the painter taking every
  8-bit line for one Latin segment in an RTL block, and `rebuild/bench/page.ts`, which didn't compile against the
  inline-tree model and has run the chat benchmark since.
