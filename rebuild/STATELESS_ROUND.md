# Plaintext stateless round — 2026-09-21

This bounded round follows `~/github/vibescript/docs/engineering.md`: interpret source data once, simplify its ownership,
and optimize the work a caller actually needs. It starts at `1b3cf7b` on `rebuild-20260916`, preserved at
`codex/plaintext-round-backup-20260921`. Owned rendering and rich painting remain paused.

## What changed

Blink now consumes its analyzer's script/priority arrays into one primary model: ordered source-script ends/codes and
direct per-unit edge/direction flags. Measurement walks existing script ordinals rather than rediscovering boundaries
for every prefix. Numeric direction classification is done once in its proper source context. Canvas questions, their
order and the previous right-associated arithmetic are preserved. The line-break cursor also uses two scalar fields,
with its rewind ordering unchanged.

Every engine now offers `fillLineRange` through the same break algorithm as `fillLine`. A range returns source bounds,
continuation and the line-box flag, or the same refused-slot continuation; it retains no full line record. Plain Gecko
also omits placed-frame output and unused justification metadata. Span child presence comes from the existing
pass-local placed count, so decisions no longer depend on retaining output. Inspected Gecko still keeps the frames
tab diagnostics need. Blink/WebKit retain scratch items/runs required for rollback and trimming. Their range path
omits the terminal wrapper, without pretending those scratch records are already gone.

The canonical native plain adapter and benchmark count mode use ranges. Full pieces and inspected output remain
independently checked. The foreground probe separates preparation, initial counting, new widths and repeated widths;
it imports actual main directly and refuses hidden or unfocused timing. Other acceptance rules and frozen references
were not relaxed.

## Difficult controls and rejected models

At 512 UTF-16 units, source-prefix bookkeeping changes as follows under the deterministic backend. Original numbers
count script reads; new numbers include all primary buffer reads. These counts describe our code, rather than native
Canvas work or native speed.

| Input | Original reads | Final reads |
|---|---:|---:|
| Latin | 4,599 | 511 |
| Hebrew | 266,231 | 4,599 |
| Arabic numeric control | 788,473 | 4,599 |
| Alternating scripts | 527,863 | 284,627 |

The model has three buffers and `5S + N` payload bytes, where S is exact source-script runs and N is source UTF-16
units. At 512 units that is 517 versus the old 1,024 for one script, or 3,072 versus 1,024 for alternating scripts.
Array headers and transient analyzer arrays are additional; this is no lower peak-memory claim. Random source-script
lookup is binary; ordered measurement walks ordinals. Direct edge/direction sweeps use constant reads per unit.
A separate 4,096-unit correction-cursor control reads all actual source facts in at most 2N primary reads, with no
Canvas questions. Alternating-script traversal and submitted Canvas text still retain costly growth cases.

The first five-column model was rejected after consistent native repeated-layout slowdowns. It used binary
edge/direction lookups, but their cost was not independently isolated. An 18-sample cursor ablation placed flattened and original cursors within about 1%, ruling out cursor
flattening as that regression's cause. One control failed timer calibration and remains an error, not a sample.
The final model uses direct flags rather than keeping another copy of the rejected model.

Independent counterexamples exposed two mistakes in the new source model. A lone low surrogate could overwrite
preceding Arabic's retained script. Keeping exact source runs fixed that, but a second assumption was still wrong:
Unknown can extend through following ordinary digits or inherited marks. The starting script controls Canvas string
formatting, while spacing and diagnostic corrections need each mapped unit's actual source script. Those corrections
now advance a temporary monotonic source-run cursor only when a question crosses an ignored source boundary.
Questions wholly inside one exact source run keep the known scalar without a cursor. The final independent study
checks 272 styled/unstyled cases, both directions and signed spacing, numeric/inherited characters, valid split pairs
and bidi overrides. Complete outputs, ranges, source facts and ordered questions match original source. Both incomplete
fixes and their counterexamples are preserved, with permanent tests and nine added general comparison cases.

## Final verification

The post-fix evidence is preserved under `.artifacts/plaintext-round-20260921/final-review/`, with exact proof inputs/helpers, native captures, gate reports/logs and comparison scripts. The gate archive SHA256 is `f970ed709415f895faf2e60353014f709930fcb31fe05dda936501437098b24a`. All 491 files in `source-frozen-before.json` remained unchanged at independent verification. `sources/frozen-runtime-src.tar.gz` reproduces the full TypeScript proof seal `9b54b14a2bfc93199507ec5bbb7f50a337fdfb64c4a3c1807aa5af80712f0de7`; each native workflow's recorded runtime file hashes also match that archive.

Full/count/range comparisons passed in all three engines against the original frozen redo source. Each covered **66 inputs, 4,062 workflows, 20,118 layouts and 138,768 fill records**, with stable source/input/helper seals and no differences. Full mode checked 4,189,155 ordered Canvas calls; count/range checked 2,362,590 each. Fill records include refused slots and records without a line box. Full mode also checked pieces; range used the baseline's full fill as its reference. The new inputs include malformed UTF-16 controls that exposed a bug shared by the earlier candidate models. Earlier intermediate evidence remains archived, rather than being presented as final acceptance.

All 18 complete check/plain/pure reports match both the three-buffer review and first candidate after removing **only** the top-level library fingerprint. All six complete check reports also match R5, and needs-browser ID files match all three references byte for byte. R5 did not preserve full plain/pure JSON, so that comparison is limited to gate summaries. The only changed non-timing gate field is unit coverage: **1,211 passing tests across 109 files**, versus 1,206/1,205 in the intermediate/candidate runs and 1,182 in R5. Six strict TypeScript projects pass.

Historical gate failures remain: two Chrome tier-1 exits are 1, two Firefox exits are 4, and 99,396 obligations still require tier 2. The other 21 gate exits are zero. Plain and pure checks each pass **393,720 configuration-cases with zero failures and 244 Chrome skips**. Those skips are not passes. Extra historical log files are preserved in the archive; fresh gate claims refer to its 25 `gates.json` entries.

Fresh native checks again report Chrome **999 pass / 1 fail**, Firefox **951 pass / 1 fail / 48 review**, and the WebKit host **998 pass / 2 fail**. All 12 recorder children exit zero; all three strict checkers/workflows exit 1 and remain non-adoptable. Across 3,000 cases and 12,000 outcomes per batch, every per-run scored outcome and predicted source range matches the intermediate review, first candidate, R5 and earlier compact capture. Complete case/geometry/prediction/painter records now match the first candidate. The same four Firefox cases differ in forward-run geometry, issue details and Canvas-call counts from the three-buffer review. R5 had 955 passes / 44 reviews; the changed native observations add four reviews here, giving 951 / 48, with unchanged predicted cuts and per-run scored outcomes. The earlier compact capture also had 951 / 48. Exact differences are retained in `native-comparison.json`, not waived.

The plain native adapter omits `linePieces`. Relative to R5 it therefore omits four post-decision paint-prefix questions in each of three Chrome pre-wrap/tab cases, in both orders, with unchanged cuts and native outcomes. Native logs provide call counts; the separate deterministic proof checks ordered questions at matched API boundaries.

The evidence covers whitespace modes, tabs/hard breaks, SHY/glue, narrow words, keep-all, spacing, bidi/scripts, combining marks/emoji, refused slots, fresh and reordered/repeated widths, six growth families at 64/128/256, and added malformed-text controls. Native checks cover 1,000 existing fast obligations per browser, in two orders and two adapters. They do not recapture the full historical main-pass population or books, supply fresh main results, or certify exact glyph positions, vertical metrics, painting or owned rendering. The stand-in Canvas proves preservation, not browser correctness. The retained alternating-script negative control also rules out claiming a universal linear cost bound.


## Native performance and the retention decision

The final campaign has 84 successful documents: 28 separate cohort/phase documents in each installed browser,
eight saved paired rounds each. Every timed row stays visible, focused and isolated at Retina DPR 2 and reaches the
20ms floor; each library occupies every order slot twice. AC power, Apple M5 Max, Chrome 153.0.8010.50, Firefox 156.0
and Safari 27.0 (22625.1.29.11.27) are recorded. All 491 captured source hashes remain unchanged after each browser.
Ordinary desktop activity and every pause remain in the raw samples. Preparation's two current controls execute the
same logic yet differ by several percent in some cohorts. This campaign establishes no broad preparation speedup.

Most ordinary native changes are small. Some reductions in our own source traversal do not produce comparable
native timing gains: unchanged Canvas work still dominates several inputs. Costs worth retaining explicitly are:

| Observed current-range cost versus original redo | Paired median | Absolute paired median addition |
|---|---:|---:|
| Chrome Latin, repeated widths | +4.2% | 0.062ms / 120 messages × 3 widths |
| Chrome alternating scripts, 64 units, preparation + count | +7.9% | 0.137ms / 4 paragraphs |
| Chrome alternating scripts, 128 units, preparation + count | +6.8% | 0.213ms / 4 paragraphs |
| Firefox Latin, new widths | +10.5% | 0.805ms / 120 messages × 3 widths |

Chrome Latin is slower in all eight paired rounds, with full and range close together. Alternating setup also has
consistent additional cost in most rounds, including the first seven 128-unit range pairs. Firefox Latin new-width
samples are inconsistent, including range/full ratios from 0.751 to 1.154; the observed cost stays open without a
claim about its cause. Tiny differences elsewhere are recorded rather than rounded into a universal no-regression
claim. Chrome Arabic repeats and Firefox ordinary range repeats improve modestly. Native Hebrew growth is not a
monotonic win: Chrome 256-unit repeats improve about 7%, while 512 units are about 1% slower.

Retain the round for its exact data ownership, removed repeated rescanning and unused output, accepting the measured
small ordinary costs and alternating-script memory/setup tradeoff. It does not meet a stricter requirement that every
input be faster or retained payload never grow. There is no changed measurement recipe, new answer cache or recovered
font guess. The earlier five-column timings, failed unfocused Firefox attempt and misleading all-phase preparation
results stay archived; none supplies a headline gain.

[MAIN_PERFORMANCE.md](MAIN_PERFORMANCE.md) gives the final actual-main comparison separately from its earlier
three-cohort capture. Main remains much cheaper at new and repeated widths. Safari preparation is cheaper in redo;
Chrome preparation is still substantially more expensive. Main's aggregate counts differ slightly in several cohorts,
so the main timings are a cost reference, not a certificate of identical cuts or geometry. The redo comparisons do
check complete source ranges and continuations, with exact call/character totals in every final probe.

Raw timing and independent reconstruction are in `.artifacts/plaintext-round-20260921/perf-final/`. The independent
report records every pair, absolute delta, order slot, identical-prepare control and source-seal result. Final
source/helper inputs are preserved completely. The historical-source availability index records missing exact helper
versions in superseded v5/v6 timing attempts; extant copies do not substitute for their recorded hashes.

## Stopping point and the next bounded experiments

This round is complete at the representation/output boundary. Testing infrastructure remains sufficient for current
iteration: complete-output/query proofs, function checks, full reference replays and a small native obligation set
serve different purposes. They do not establish that every historical main pass or every browser failure is settled.
Owned rendering and rich painting remain paused. Main's published source and canonical snapshots are unchanged.

The next cheap simplification is to remove all script/priority/segment allocations for paragraphs already classified
as unsegmented. The existing source predicate forces Latin scripts, zero priorities and disabled bidi; the retained
segment data is unused except for a direction value already known to be LTR. Model that source fact directly,
preserving the exact predicate and literal-versus-atomic U+FFFC handling. Test empty, styled, atomic-only, controls,
RTL and signed-spacing cases before native timing. Keep per-question script analysis needed by spacing/inspection.
This saves preparation work; it has not been shown to cure the Latin repeated-width cost.

The next larger architecture target is Blink's per-line decision data. Range still constructs item/shaping objects
needed for rollback and trimming. Identify the source bounds and numeric facts actually consumed, then test one
primary representation that also materializes full output. Require unchanged outputs/questions, difficult growth
controls and useful preparation/new-width/many-text improvement before retaining it. Gecko/WebKit scratch records
have similar remaining boundaries. Do not create a second breaker or retain parallel object and packed state.

Changing shaping recipes belongs to a separate experiment with explicit lost information and counterexamples. The
remaining Canvas cost is a limit of the current recipes, not a proven lower bound. Alternating-script work, supplied
ligature grammars and contextual shaping still have costly cases. This closure neither finishes all stateless work
nor proves a universal complexity bound.

## Evidence preservation

The round's `.artifacts/plaintext-round-20260921/reproducibility/` index preserves all 491 final sealed files,
additional native drivers/fixture fonts, the three used fast catalog triples, audit reference records and temporary
orchestrators. Exact original paths and SHA256 values are recorded. It works together with the enclosing round tree.
Historical full replay input/reference/ledger shards remain in the existing checkout; they are inventoried rather
than copied into this bounded backup. Browser/OS binaries, installed OS fonts and dependency runtimes are represented
by versions and locks, rather than vendored. Missing earlier helper versions remain explicit.

A verified persistent copy of the entire dated round evidence, final reports and all current Git refs lives at:

`/Users/chenglou/.codex/visualizations/2026/09/20/01a0c12e-d771-7763-acab-9b673ed39827/plaintext-stateless-round-20260921/`

Its `manifest.json` verifies every evidence-archive member. `bundle-metadata.json` records the final commit, bundle
hash and independent restore/fsck. The pre-round backup ref remains `codex/plaintext-round-backup-20260921`.
