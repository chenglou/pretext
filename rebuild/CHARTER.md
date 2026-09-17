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

From rebuild/research/{blink,webkit,gecko}-shortcut-audit.md, 2026-09-16:

- Each engine's public `width` copies the lab scorer's visibility rules (tentpoles 1, 2).
- Choices by lab score: Blink's global OpenType joining constant; Gecko's U+200D in-word suffix variant, which probe A2
  contradicts; WebKit gap conditions reshaped to lab counts (tentpole 3).
- Name-keyed detection: system-ui in Blink, fixed pitch and hyphen-glyph tests in WebKit, similar font-fact guesses in
  Gecko (tentpole 3).
- Structural deviations that need rework before inline boxes, `<br>`, text-indent, text-align or variable widths land
  (Gecko audit class f).
- The lab's `obligations` family and gate baselines are derived from main's tests and the final runs; they are measurement
  inputs until each obligation is triaged under tentpole 5.
