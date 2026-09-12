# Wrapping tests

This is the maintained browser test runner for main, wrapping worktrees and
experiments. [INVENTORY.md](INVENTORY.md) records the behavioral obligations and
their provenance; [VALIDATION.md](VALIDATION.md) records completed comparisons,
limitations and test timings.

```sh
bun test
bun run test:wrapping --browser=all
bun run test:wrapping --suite=full --browser=all
bun run test:wrapping:snapshot
```

The ordinary schedule runs all maintained accuracy, corpus, whitespace, keep-all,
symbol, spacing and discretionary checks, plus explicit regressions and nearby
controls. [ordinary.ts](fixtures/ordinary.ts) explains which behavioral dimensions
matter. The full schedule adds the broad exploratory matrices. Both use the same
case definitions and assertions; passing ordinary does not establish a full pass.

The runner exports the pinned main revision in [baseline.json](baseline.json),
freezes every source and the harness, and observes each case in the installed
browser. The fixture context loads checked-in font bytes with verified hashes.
Maintained cases use installed-font contexts in their original document language;
experiment fonts cannot override those fallback stacks. Each direction/context
runs in a fresh document before Canvas preparation. Generic fonts inherit
document language when resolved; changing `lang` between cases can otherwise
leave an earlier font resolution in the Canvas context. Native element language
and preparation locale remain separate inputs. Loading the same font through
`FontFace` can also change Safari behavior.

Fixture pages use `en` as their document language. Without one, Chrome uses its
app language and Firefox the macOS preferred language, while Safari matched `en`.
Language changes native results in three ways. Chrome allows extra breaks around
curly double quotes on Chinese pages. Safari allows extra breaks around curly
quotes on pages without a language and in `en`, `zh-Hans` and `ko`, but not `ja`.
Glyphs missing from the named font fall back to a language-specific font with
different widths. Under `ja`, `zh-Hans` and `ko`, Safari and Firefox also shape
some of the named font's own punctuation differently. Pretext's OffscreenCanvas
follows `<html lang>` in Chrome and Firefox, never in Safari. The case generator
measures width recipes with a hidden canvas attached to the page, which inherits
`<html lang>` in all three browsers. A detached canvas ignores it in all three:
Chrome and Firefox measure in the machine language, and Safari passes no
language, so its fallback follows the machine's preferred languages. An
element's `lang=""` marks its language as unknown rather than inheriting the
page's, and remains a reset input. Chrome resolves it to its app language, which
the report records as `locale`, so these results can differ between machines.
In their sources, Firefox maps it to its generic `x-unicode` font group and
Safari passes no language. Firefox's fallback glyphs then follow the machine
language too: on a Mac preferring `zh-Hans`, U+2167 under `lang=""` measured
16px, as with no language, against 27.53px under `en`. Safari's matched `en`.
No recorded empty-language row contains a fallback glyph, so no recorded result
separates from `en` yet. Give standalone probe pages an explicit, non-empty
`lang`.

The environment guard starts after font readiness and before case generation or
preparation. It records the page's start/end environment and latches observed
changes; a DPR, visual scale or document-context change invalidates the run.
Background correctness remains allowed. Snapshots also reject incompatible scales
across contexts. See [DEVELOPMENT.md](../../DEVELOPMENT.md) for the stricter
foreground benchmark rules and what screen metadata can establish.

## Gates and observations

Maintained cases preserve their original modes, content widths, locale, browser
scope, extraction method and tolerances. Their required metrics and the exact
boundary-policy report obligations (#206/#208, #212/#213 and #214/#215) in
[INVENTORY.md](INVENTORY.md) must pass even when main fails them. Elsewhere, the gate rejects lost passing main metrics and
lost observation coverage. All source execution errors fail the run. A candidate
fix does not offset an unrelated regression. The twelve native rich-inline
#210/#211 reproductions also require `richHeight` to pass. The two exact flat
reproductions require native height, line count and API agreement; the visible
text also requires source placement.
Two additional native rich cases retain exact-fit ZWSP and forced-overflow WJ
admission. Their `richHeight` must pass too.

For fractional CSS line heights, a separate two-line strut observes the browser’s
used line-box advance. This keeps Safari’s integer rounding out of the wrapping
comparison; the API contract still requires the explicit requested line height.

Height, extracted line count/boundaries, source placement, whitespace, widths,
selected hyphens, public API contracts and selected native rich-item heights
remain separate. `unobserved` and
`not-applicable` are never passes. Interrupted API groups retain their failures
and discard partial passes. API agreement does not establish native correctness. Line comparisons include all
serialized returned fields, so agreeing text and source positions cannot hide
lost break metadata. Widths retain their existing numeric tolerance.
The numeric companion covers nine environment profiles, prohibits Canvas calls
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
Canonical accuracy and corpus cases retain their height-only scope. Corpus
native paragraphs use documented whitespace normalization while the candidate
still receives the original source.

Documented normal-mode normalization follows the observed browser's segment
break transformation. In Chrome and Firefox, a collapsible run containing LF is
removed when a ZWSP immediately precedes or follows it; in Safari it becomes
SPACE. Adjacency uses the engine's own run: Chrome's holds SPACE, TAB, LF and CR;
Firefox's holds SPACE, TAB and LF, continues through SHY and bidi controls, and
leaves out a last SPACE before a combining mark. Characters outside that run,
such as FF, still collapse like SPACE. The source contract, source placement and
normalized native paragraphs all use that form. Normalized native text renders
like its raw source when the run holds only SPACE, TAB and LF; the documented
form still approximates CR and FF as SPACE, and does not model Firefox
collapsing across SHY or bidi controls when no ZWSP removes the run. Firefox's
East Asian segment break rules are not part of the documented form, so Firefox
ja/zh corpus paragraphs are observed without them.

Twelve explicit ZWSP item cases also measure a native paragraph made from the
original same-font inline spans. `richHeight` compares that height with the rich
public walk, independently of the flat paragraph and API consistency. This small
normal-mode protocol does not establish general styled-inline shaping or native
rich source boundaries. Other rich inputs retain their existing API contracts.

Ambiguous or invisible rectangles cannot establish source ownership. Generic
Range extents do not establish advances with negative spacing, preserved
whitespace or shaping controls. Generic selected-hyphen observation is restricted
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

`test:wrapping:snapshot` derives the accuracy/corpus snapshots and dashboards from
the same run. Checked-in snapshots keep totals, provenance and mismatches; raw
successful rows are available in the run artifact. `/accuracy` displays those
snapshots. Publication requires a passing run with the numeric checks enabled;
failed run artifacts remain available for diagnosis. Individual corpus/probe/font tools remain detailed investigations,
including alternate extractors and slices; they are not a second acceptance suite.

Add a counterexample with its reproducer, nearby controls and relevant dimensions.
Do not retain a whole discovery crossproduct merely because it found that case.
Use faithful finite recipes for broad investigations and preserve exact threshold
widths. Never delete a valid failure to improve a score. Advance pinned main only
after reviewing per-case changes. Runtime performance and packaging checks remain
separate from this correctness suite.

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
