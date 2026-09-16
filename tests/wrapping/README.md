# Wrapping tests

This is the maintained browser test runner for main, wrapping worktrees and
experiments. [INVENTORY.md](INVENTORY.md) records the behavioral obligations and
their provenance; [VALIDATION.md](VALIDATION.md) records completed comparisons
and limitations.

The runner exports the pinned main revision in [baseline.json](baseline.json),
freezes every source and the harness, and observes each case in the installed
browser. Maintained cases use installed-font contexts in their original document language;
experiment fonts cannot override those fallback stacks. Each direction/context
runs in a fresh document before Canvas preparation.

Fixture pages use `en` as their document language; [RESEARCH.md](../../RESEARCH.md)
describes what page language changes.

The environment guard starts after font readiness and before case generation or
preparation. It records the page's start/end environment and latches observed
changes; a DPR, visual scale or document-context change invalidates the run.
Background correctness remains allowed. Snapshots also reject incompatible scales
across contexts. See [DEVELOPMENT.md](../../DEVELOPMENT.md) for the stricter
foreground benchmark rules.

## Gates and observations

Maintained cases preserve their original modes, content widths, locale, browser
scope, extraction method and tolerances. Their required metrics and the exact
filed-report obligations in [INVENTORY.md](INVENTORY.md) must pass even when main fails them. Elsewhere, the gate rejects lost passing main metrics and
lost observation coverage. All source execution errors fail the run. A candidate
fix does not offset an unrelated regression. Differences found only outside the
suite, in headless probes or research families, don't block a change that loses
nothing in the installed gate. Name them in the PR and [VALIDATION.md](VALIDATION.md),
and list the ones worth fixing in [ENGINE_FOLLOWUPS.md](../../ENGINE_FOLLOWUPS.md).
A candidate that changes the harness normalization contract gates from its own
harness and also runs once from main's harness, so contract-masked losses stay
visible.

For fractional CSS line heights, a separate two-line strut observes the browser’s
used line-box advance. Safari 26 rounds line boxes to whole pixels, and Safari 27
truncates the block height to 1/64px, so a block within 1/64px per line of k line
boxes counts as k lines. The API contract still requires the explicit requested
line height.

Height, extracted line count/boundaries, source placement, whitespace, widths,
selected hyphens, public API contracts and selected native rich-item heights
remain separate. `unobserved` and
`not-applicable` are never passes. Interrupted API groups retain their failures
and discard partial passes. API agreement does not establish native correctness. Line comparisons include all
serialized returned fields, so agreeing text and source positions cannot hide
lost break metadata. Widths retain their existing numeric tolerance.
The numeric companion covers five environment profiles, prohibits Canvas calls
after preparation, and retains the unverified-profile TAB compatibility checks.
Its synthetic Canvas supports letter spacing so control-bearing recipes exercise
entry observations as well as their disabled fallback. It also checks that
spacing/context changes and cache replacement preserve held and copied handles.
These are API and call checks, not native shaping measurements.

Most native observations use one unmodified text node and scalar `Range`
rectangles. Compact maintained cases also preserve their selected Range/span
extractor. Observer version 2 retains each extraction's exact normalized source,
method, own height, resolved line-height, every grapheme/scalar rectangle and
whole-content rectangles. Extraction count comes from that experiment's height, not the number
of inferred source groups. Normalizing source or inserting spans can change
wrapping; neither experiment replaces the original paragraph's observations.
Fresh comparisons run both library versions against the same observer; changing
an observer is not a library accuracy improvement.

Boundary comparisons use all positive rectangles of a visible source scalar. A
carried zero rectangle cannot move it to an earlier line, and positive rectangles
on multiple lines do not establish one source owner. Invisible controls and
whitespace likewise do not acquire exact consumed endpoints from rectangle
order or positivity. An internal unknown between established visible endpoints
cannot change that source envelope. In normal mode, the existing suppressed-boundary
contract also removes collapsed ASCII SPACE from compared starts and ends without
assigning it to either line. The selected span protocol can establish a literal
preserved SPACE or TAB's source placement when its single nonempty element
fragment agrees with its scalar Range in that same DOM. This does not turn its
hanging width into a painted endpoint: the existing boundary comparison still
trims line ends. Multiple, empty or conflicting fragments remain unobserved.
For pre-wrap LF, a measured extraction count equal to the number of forced
source lines excludes additional soft wraps and establishes their whitespace
boundaries, including consecutive empty lines and the absence of an extra line
after trailing LF. Other uncertain endpoint controls remain unobserved even on
a control-only hard line. Non-breaking spaces and other leading/trailing
controls retain their uncertainty. Known visible mismatches
remain failures; partial endpoint agreement is `unobserved`, not an exact-boundary
pass. Required metrics remain required even when their evidence is ambiguous.

Version 1 reports retain their recorded assessments and legacy source groups.
Those groups lack the extraction's own geometry and cannot be converted into
version 2 observations. Reassessing such a record leaves selected extraction
count/boundaries unobserved; original paragraph metrics can still be assessed.

Documented normal-mode normalization follows the observed browser's segment
break transformation, as [RESEARCH.md](../../RESEARCH.md) describes per engine.
The source contract, source placement and
normalized native paragraphs all use that form. Normalized native text renders
like its raw source when the run holds only SPACE, TAB and LF; the documented
form still approximates CR and FF as SPACE, and does not model Firefox
collapsing across SHY or bidi controls when no ZWSP removes the run. Firefox's
East Asian segment break rules are not part of the documented form, so Firefox
ja/zh corpus paragraphs are observed without them.

Generic selected-hyphen observation is restricted
to the verified normal-word-break `a\u00adb` protocol; eight maintained discretionary
cases also check exact expected text and line widths with their tighter tolerance.
Two exact Safari paint witnesses additionally retain the opening-quote marker
and keep-all's hidden SHY. The quote contract is required. Keep-all's marker and
width remain observed known failures: a positive SHY Range can describe source
allocation without a painted hyphen, so it cannot supply a generic keep-all oracle.

Public contracts require forward, nonoverlapping ranges and preservation of
visible/preserved source. Rendering ranges may leave collapsed SPACE, inactive
SHY/ZWSP and pre-wrap newlines between lines; exact all-source partition remains
diagnostic. Preserved SPACE/TAB, joiners and combining marks cannot disappear.
Copied returned continuations, variable widths, rich item coordinates, callback
ownership, atomic pills and signed SPACE gaps remain checked.

## Comparing and reproducing

```sh
bun run test:wrapping --suite=full --browser=chrome \
  --candidate=original=/path/to/old-worktree \
  --candidate=followup=/path/to/followup-worktree \
  --candidate=proposed=/path/to/proposed-worktree \
  --preserve=original,followup
```

Candidates can be worktrees or frozen source directories. `--preserve` also gates
losses against those references. Reports compare each reference with the other
sources; raw rows retain the evidence for any additional comparison.

Use `--family=substring` to select a family or provenance label, or
`--case=wrap-ID` for one case. The latter selects from full by default. IDs include
input settings and observation protocol. Near-threshold generated widths depend
on the browser/font environment; keep raw inputs when diagnosing an old run.
`--strict` additionally rejects existing observed supported failures. `--help`
lists the other options.

## Reports and maintenance

Reports go under `.artifacts/wrapping/`, or `--output=/new/directory`:

- `manifest.json` identifies frozen sources, harness hashes, the browser bundle,
  Bun version, selection and gates.
- `browser-direction-rows.ndjson` preserves inputs, native observations, candidate
  predictions and assertions, streamed in batches.
- `browser-direction.json` records completion and the environments used; the
  corresponding `browser-direction-context.json` files retain each page report,
  with `fixtures` or the installed context's language as the context label. Each
  report includes its request ID and requested/observed tab URL; host failures
  retain a separate `browser-direction-failure.json` artifact.
- `browser-direction-summary.json` records independent counts, required failures
  and exact changes against the preserved references.
- `numeric-*.json` and `numeric-summary.json` record synthetic API checks and TAB
  compatibility. These are test results, not library performance measurements.

`test:wrapping:snapshot` derives the accuracy/corpus snapshots from the same run.
Checked-in snapshots keep totals, provenance and mismatches; raw
successful rows are available in the run artifact. `/accuracy` displays those
snapshots. Publication requires a passing run with the numeric checks enabled;
failed run artifacts remain available for diagnosis.

Add a counterexample with its reproducer, nearby controls and relevant dimensions.
Do not retain a whole discovery crossproduct merely because it found that case.
Use faithful finite recipes for broad investigations and preserve exact threshold
widths. Never delete a valid failure to improve a score. Advance pinned main only
after reviewing per-case changes.

The pin identifies a source revision, not a list of disabled tests. Keep it for a
test-only merge. When accepting a bug fix, add a narrow required assertion,
validate against the existing reference, then advance the pin to the reviewed
fix commit. Otherwise a later change can lose a new success that the older
reference still fails. Existing fail-to-fail changes remain reported but do not
fail the ordinary gate unless the metric is required.

These commands are currently local checks. The checked-in GitHub workflow builds
the demo site; it does not run the unit or browser suites. Automatic enforcement
requires CI wiring, including access to the pinned Git revision and the intended
browser/font environment.
