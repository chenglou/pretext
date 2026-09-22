# Main's native obligations

`main-obligations.ts` stages cases labelled by the original census as agreeing with native **line count and visible
breaks**. These historical labels need a stricter source-coverage audit: the old diagnostic omitted uncovered visible
code points as well as zero-width edge content. The browser observation supplies the requirement after that audit.
Main's prediction is evidence of an existing passing case, not expected geometry for the new engine. A heuristic origin, a rebuild failure, a covering gap or a known
native-history finding cannot remove a case from the full obligations or influence the fast sample.

```sh
bun rebuild/tests/main-obligations.ts --from=.artifacts/census-20260919 \
  --artifact-root=.artifacts --browser=chrome --out=.artifacts/tests/main-native/<staged>/chrome
bun rebuild/tests/audit-main-obligations.ts \
  --catalog=.artifacts/tests/main-native/<staged>/chrome --out=.artifacts/tests/main-audit/<new>/chrome
bun rebuild/tests/main-obligations.ts --from=.artifacts/census-20260919 \
  --artifact-root=.artifacts --browser=chrome --audit=.artifacts/tests/main-audit/<new>/chrome \
  --out=.artifacts/tests/main-native/<certified>/chrome
bun test rebuild/tests/main-obligations.test.ts
```

The default scope is the original `chunk00`–`chunk11` population. `--parts=real-text`, `--parts=chunk00,real-text`, and
`--parts=all` select other original parts explicitly. Failure-selected reruns are outside discovery. Every selected part
must have its original metadata, successful file-order native/main run records, matching recorded row counts and case
inputs. The old worktree's recorded `.artifacts/` suffix resolves only against the explicit `--artifact-root`.

The new folder holds:

- `population.ndjson`: every original observation, including main failures and ambiguous visible breaks.
- `full-cases.ndjson` and `obligations.ndjson`: every historical main-pass label and its native/run/input provenance,
  with the rebuild's original outcome and covering gaps still visible. `mainEvidence` distinguishes pending, verified,
  refuted and inconclusive labels; `required` is `null` until independent raw-native evidence verifies the label.
- `required-cases.ndjson` and `required-obligations.ndjson`: the entire certified population for larger checks, retaining
  genuine main passes even when the original rebuild failed. They are empty before certification.
- `fast-cases.ndjson` and `fast-obligations.ndjson`: a preview of historical labels without an audit, or the
  representative certified browser subset when an audit is supplied. Pending labels cannot automatically gate.
- `manifest.json`: the selected scope, all discovered original parts and missing metadata, observed outcome counts,
  input/run/metadata/output hashes, browser build and process languages, and exact fast coverage omissions.

Maintained corpus inputs also carry an exact raw-text SHA256 coverage token. Their one normal-whitespace text-node
shape is validated, and at least one representative per eligible text is mandatory alongside family coverage. Two books
sharing every font/policy token cannot stand in for one another. The manifest lists population texts without an eligible
original pass and texts omitted from fast coverage; size and budget limits cannot silently become complete book coverage.

The fast sample defaults to 1,000 cases and a 4,096-unit size cap. With `--audit`, eligibility requires a verified main
pass at the original native observation; refuted and inconclusive historical labels stay in the full catalog. It covers every eligible family first, then marginal
font family/size/style, script class, language, direction, white-space/break/spacing policy, width bucket and inline
structure. The generator indexes one best input-ranked representative per token and keeps a bounded deterministic fill pool;
it never repeatedly scans the full population for each feature. The seed, unit costs and input features determine selection; the
rebuild's success never does. `--budget=500` reduces the loop, and `--max-units=<n>` changes its cost cap. Too small a
budget to cover eligible families fails; size-excluded families and other uncovered tokens are listed. The full corpus
retains those obligations. Marginal coverage does not establish coverage of every combination or line-fit threshold.

`--history-ledger=<reviewed format-3 ledger>` annotates demonstrated native history without removing cases. Legacy
ledgers are refused because they mixed native and prediction order dependence. The native key in census metadata is a
single observation's provenance, **not a stability certificate**. Discovery outside the selected scope is separately
marked complete or incomplete; missing WebKit corpus metadata cannot become zero obligations.

For routine iteration, run the affected function tests and the fast cases through the real engine with no supplied font
facts, in both orders and under the application's measure-first protocol. Root schedules browser jobs sequentially with
the maintained canonical browser lock. Compare the full native scorer view between orders before interpreting a lost obligation;
keep native history, prediction order dependence and unavailable observations visible. Replays protect prior output but
do not replace fresh native checks when measurement questions or acceptance rules change.

Both native drivers seal runtime and acceptance source trees, served font assets, configuration and inputs. Their
hashes and file populations are verified after lock acquisition and after all jobs/checking, including failed runs.
WebKit workflows include the actually executed host binary. Drift leaves `adoptable: false`, records the error and
preserves actual child exits. This detects ordinary persistent edits during a workflow; source snapshots are not a
filesystem event journal. See `workflow.json` for its exact paths and verification times.

The obligations concern line count and **visible breaks**. The lab's stricter `breaks` metric also checks observation-port
rect placement/count rules; an extra failure there requires examining the visible cuts before calling it a main
compatibility regression. Glyph widths, exact x positions and painter positions need their own native comparisons; the input content-box width is checked here. Do not
adopt a smaller suite's history exclusions as an automatic waiver of the full population.

The initial default Chrome extraction staged 237,400 observations and all 159,163 qualifying main passes, including
390 observed rebuild line-count/break failures. The fast 1,000-case sample was selected independently of those failures.
These dated census labels stage candidate obligations; new browser results must report their own build, protocol and counts.

The raw-source audit streams the original main predict-only rows and rebuild native rows, verifies their full census
population and sealed input/metadata/run provenance, and combines environments through the shared scorer. It certifies
line count and complete unambiguous visible source ranges, with hashes of both exact case rows and complete raw files.
Refuted and inconclusive labels grant no automatic main-pass requirement. The native-only Blink soft-hyphen report
rule removes only a positive rect exactly matching a soft-hyphen rect of the same text node on the same native line.
The following glyph's own placement remains required; a point reporting only the hyphen remains inconclusive.
Unmatched multiple-line reports remain inconclusive. The full native-history comparison retains every original rect.

Audits seal scorer, range evaluator and auditor sources. `--audit` refuses changed acceptance code, raw evidence,
catalog provenance, scope or input/run metadata. Keep the staging catalog used by an audit. Audit folders use relative
output names and can be copied intact; their referenced original sources and staging catalog must remain available.
One original file-order observation does not establish native stability; fresh opposing-order application checks do.

## Fresh opposing-order check

`check-main-obligations.ts` checks the staged population against fresh lab rows. It derives source ranges from both
`LayoutPrediction` and `LinesPrediction`, then uses the shared native line grouping and visible source-coverage
diagnostic. An inspected observation port, covering gap, or painter result cannot make a visible failure pass.
Uncovered positive-width code points and ranges that split a visible code point fail. Ambiguous positive-width
placement on multiple native lines remains inconclusive. The observed paragraph content-box width must also match
the declared CSS width after the browser’s source-defined encoding. This is independent of predictor geometry and
child overflow. Fractional widths use the actual layout-unit and client-bound conversion, with no fitted tolerance.
Exact glyph x positions, glyph widths, vertical coordinates and painting are outside this check; the generic native
scorer view is unchanged. The book survey separately checks physical paragraph height.

```sh
bun rebuild/tests/check-main-obligations.ts \
  --cases=<generated>/fast-cases.ndjson --obligations=<generated>/fast-obligations.ndjson \
  --forward=<redo-forward>/chrome-rows.ndjson --reverse=<redo-reverse>/chrome-rows.ndjson \
  --plain-forward=<plain-forward>/chrome-rows.ndjson --plain-reverse=<plain-reverse>/chrome-rows.ndjson \
  --main-forward=<main-forward>/chrome-rows.ndjson --main-reverse=<main-reverse>/chrome-rows.ndjson \
  --out=<new>/fresh-check.json
bun test rebuild/tests/check-main-obligations.test.ts rebuild/lab/score.test.ts
```

Use each browser's lab filename; compressed rows are accepted. Redo and plain require fresh successful
`--measure-first` runs. Completed prediction documents must cover every raw row contiguously; each row must carry its exact prediction index and document population, including reverse order and resets between documents. Missing, null, repeated or inconsistent row tags block acceptance. Native-first controls and predict-only main diagnostics retain their distinct protocols. Opposing orders must use the same recorded bundle and protocol. Optional
`--control-forward=<rows> --control-reverse=<rows>` adds native observations under another protocol, such as the
usual native-first protocol. All own-native rows are compared using the full scorer view after environment checks.
Native variation requires review; it never becomes a new automatic history exclusion. Prediction-order differences
and plain/inspected source-range parity are reported independently, including when every visible metric still passes.

Main may use `--predict-only` rows with its corresponding redo native observation. The report explicitly records that
main's own measurement state was not observed. Main's fresh failures are diagnostic and cannot withdraw a required
redo case. Use own-native main controls when claiming that main's Canvas recipe and native state are compatible.
Known native-history annotations remain visible and grant no waiver. Missing rows, unavailable or ambiguous native
observations, input/protocol mismatches and new native variation block a green result. Width certification assumes
the lab’s installed, untransformed browser recipe: unemulated Blink DPR is layout zoom; WebKit page zoom is 1;
Gecko uses the reviewed unclamped client-bound transform range. Headless/DevTools scale overrides and arbitrary
Safari zoom need a separately observed protocol before these encodings can certify them. The input-width function
is in the sealed range evaluator, so changing it requires rerunning original audits and certification.

The report seals hashes for inputs, rows and completed run metadata, plus browser environments, bundle and predictor
provenance. Exit 0 means every staged obligation passed the supplied checks; exit 1 means lost passes, incomplete
observations or required review; exit 2 means invalid inputs or run records. The report path must be new. Neither the
historical catalog nor this check adopts a seed, a history ledger or a smaller accepted population.

## Fast native workflow

For engine iteration, run the affected function tests, then the affected browser's certified fast obligations. Use the
occasional full quick gate and larger native corpus as broader checks. The fast workflow checks both inspected and
plain application paths in both orders; a prior output replay does not substitute for these fresh native observations.
The focused redo adapter is `inspected-ranges-predictor.ts`: it runs the full facts-free inspected core path, then
returns contentful source ranges and the core measurement-call count. It omits the lab’s expected observation, painter
and painter limits. The full geometry suites continue to use `no-facts-predictor.ts`. Both adapters are accepted for
redo evidence, but opposing orders must use the same adapter and bundle. Other predictors cannot supply redo evidence.
Plain evidence requires `plain-predictor.ts`; supplying inspected rows as plain evidence cannot establish that path's parity. The canonical
plain adapter now calls `fillLineRange` without materializing pieces; the driver records this count/range scope.
Its full-piece factory default remains available to the independent function-set checks. A separate range adapter
was rejected by the existing provenance guard; that incomplete attempt is retained as a checker error, not a native
verdict. Fresh canonical jobs after integration supply the new range-path evidence. No checker, scorer, evaluator or
auditor acceptance rule changed.

This changes the focused lab protocol. WebKit’s expected-observation port can ask Canvas questions; removing that
phase may change measurement/native cache history. Equal core traces alone do not establish equal native state. After
integration, run fresh inspected-range/plain measure-first jobs in both orders in all three browsers before adopting
the focused workflow. Native variation, lost source passes and mode/order changes retain their existing blocking rules.

```sh
bun rebuild/tests/run-main-obligations.ts --browser=chrome \
  --catalog=.artifacts/tests/main-native/<certified>/chrome \
  --out=.artifacts/tests/main-native-runs/<new>/chrome
bun test rebuild/tests/run-main-obligations.test.ts
```

The catalog must be an audited format-2 stage for that browser. Preflight checks certification, fast-input hashes,
complete selection, and the recorded acceptance-source hashes against the current scorer, range evaluator and auditor.
A change to acceptance source requires recertification; an engine-only edit does not. It does not reread the original
full corpus on each iteration. Output must be new; existing folders and files are never reused.

The driver holds the maintained browser-automation lock (webkit-host maps to safari) across every sequential job and
the checker. It launches each child with an argument array and preserves the first actual nonzero exit even if a later
checker exits zero. There is no dependency on the previous phase's untracked artifact scheduler.

`--main-comparison` adds two fresh main `--predict-only` processes. Their native observation is borrowed from the
corresponding inspected redo run and the report labels them diagnostic. Main's failures cannot withdraw required
redo passes; this comparison does not establish compatibility of main's Canvas measurement state with native state.

It is an accuracy workflow and records no foreground performance claim. No new lock implementation or global UI
action is added.
