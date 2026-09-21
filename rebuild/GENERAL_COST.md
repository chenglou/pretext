# General stateless cost

2026-09-21. Testing infrastructure is sufficient for the current iteration. General core work is active: the earlier
chat-cohort stopping decisions did not establish predictable worst-case cost. The approach follows
`~/github/vibescript/docs/engineering.md`: model the input dimensions, repair repeated access at its source, and avoid
answer caches or a fast common path with an unbounded slow fallback.

## First landed batch

N means source/transformed UTF-16 units, F distinct font/context records, P bidi paragraphs, B logical boxes, C accepted
exact shaping pieces, D ancestor depth, and L consumed lines. The following bounds concern our own work, not native
Canvas shaping or arbitrary browser internals.

| Access or analysis | Previous growth | Current data flow |
|---|---|---|
| Shared font resolution, fallback contexts and Canvas settings | quadratic in distinct records within one preparation | insertion-only AVL over exact fields; creation-order records and existing context identity retained |
| Gecko font checks | traversed/copied fonts despite no enabled checks | original paragraph returned immediately; zero Canvas checks |
| Shared inherited font analysis | recursive input-depth walk | iterative preparation-local stacks; explicit empty language reset retained |
| Automatic bidi paragraph level | repeated scan from paragraph zero | binary search of ordered paragraph limits |
| Blink measured-cut adjustment | scan every cut for each lookup | binary search of ordered cuts |
| Blink accepted-piece prefixes | every adjustment rewrote every later prefix, including zero corrections | one logical accumulation of each corrected piece advance |
| Blink failed safe-cut tests | expensive wider windows asked before a rejecting pair | same predicates, rejecting pair checked first; zero pair still requires wider context |
| WebKit history collection | every box scanned every item, including identity-only worlds | one logical item cursor; no world when structural and separator facts are identical |
| WebKit ancestor lookup | Cartesian ancestor comparisons | align depths and walk parents together |
| WebKit complex graphemes | repeated whole-box or whole-suffix segmentation | original-box boundary metadata plus a streaming iterator over the actual suffix; stop at first overflow |
| Gecko long windows | remeasured every growing merged prefix | unchanged cut certification; measure merged width only when a cut closes it or final total needs it |
| Gecko original unit start | discovered windows before returning known zero | return zero first; interior window boundaries retain their guard |
| Gecko ordered metadata | tabs, continuation closes and script runs rescanned from zero; repeated suffix LF search | ordered lookups; line-feed positions collected during the existing scan |
| Gecko tabs during reflow | every line rebuilt all remaining tabs | local builder advances only through consulted positions; decided frame retains consumed tabs |

Canvas questions and measured strings are not pooled answers. Font probe answers remain temporary within preparation,
indexed by Context identity with a fixed probe vocabulary; measured text is never a key. The pool's former 512-context
clear remains between preparations, preserving held contexts. It cannot bound one paragraph's F; the ordered lookup does.
Gecko still owns a fresh pool per preparation because late family-name discovery can silently stale retained canvases.

The Blink prefix numeric contract is purposeful: accumulate corrected exact-piece advances in logical order, then apply
the existing float32/LayoutUnit conversions. It does not preserve an accidental association of every old JavaScript
addition. A 16,384-glyph regression with optical scaling proves the old suffix rewriting can round a correct whole by
one raw LayoutUnit; the logical joint sum gets the source-composed target. Internal raw prefix/cluster values can differ
slightly. Near-whole and narrow cut attacks preserve public ranges, pieces and positions; no quadratic legacy guard.

Gecko lazy tabs intentionally remove warnings from prefix queries at unused future tab origins. A complete temporary
proof preserves every filled range, piece, geometry, per-offset advance and materialized window fact. Actual consulted
tab uncertainty remains covered by a permanent regression. Eagerly measuring unused suffixes merely to reproduce their
incidental warnings would retain the growth problem.

## Evidence and limits

Focused full-state proofs include 620 shared font trees with 49,890 exact ordered questions; 600 WebKit full outputs and
ordered questions; 1,512 Gecko lazy-tab comparisons (1,491 exact traces, 21 identical reordered submultisets, no new or
changed answer); and 40 ordinary Blink full outputs/traces plus numeric boundary attacks. Permanent tests protect the
semantic branches and workload budgets. Example own-work reductions, using stand-ins rather than native timing:

- 8,192 distinct declarations: 33,550,337 prior equality comparisons become logarithmic access.
- 65,536 bidi units/16,384 paragraphs: 536,870,911 paragraph visits become 917,490.
- 4,096 ordinary WebKit leaves: 33,554,432 item/world visits become 12,287 with zero alternate worlds in both versions.
- 1,024 tiny-line Arabic WebKit units: 5,242,881 segmentation transitions become 5,121; questions stay identical.
- 4,096 Gecko TAB-source units over 2,048 lines: 2,098,176 temporary tab records become 2,048; Canvas work stays identical.
- 4,096 joined Gecko units at the first narrow line: 554,940 shaped units become 28,652 with the same window decisions.
- A 600-edge all-kerned Blink cut attack: 1,350,553 shaped units become 6,596; cut semantics remain unchanged.

These are structural/scoped proofs, not universal browser speed claims. Independent pool review finds small ordinary
stand-in overhead (roughly 0.25–0.48 microseconds per preparation) and much cheaper high-F work; retain the general
logarithmic design rather than a hybrid representation. Full six-project strict checks pass.

Fresh certified MF1000 native checks preserve prior identities/results: Chrome 999 pass/1 stable miss; Firefox 951
pass/1 stable miss/48 geometry reviews; WebKit 998 pass/2 native-variation failures. No new cuts, mode mismatch or predictor
order changes. These strict workflows still exit 1 and remain unadoptable; there is no waiver. Evidence:
`.artifacts/tests/main-native-runs/general-cost-20260921-r1/`.

Input-only stress sets run inspected/plain in both orders with independent native observations and source seals:
Chrome 32/32, WebKit 34/34, Firefox 58/64. The preserved pre-change core has exactly the same six Firefox failures,
including complete reported ranges and outcomes. All 500 Chrome cases with changed replay predictions or previously
unrecorded questions were also checked in four fresh jobs: current and preserved core both have the same 489 passes and
11 stable misses. No case/result was dropped. Evidence: `.artifacts/tests/general-cost-native-20260921-{r2,base}/`
and `.artifacts/tests/general-cost-native-replay-20260921-{r1,base}/`.

All-engine quick gates ran 25 checks in 197.9 seconds: 1,057 tests/88 files and six strict projects pass. WebKit and
Firefox preserve all 255,516 complete recorded predictions; WebKit questions are exact. Blink changes 351 no-facts and
86 facts predictions: complete comparisons prove every difference is diagnostic gaps, with all other output equal.
Blink has 154/90 previously unrecorded questions, which the plain/pure replays skip; all remaining 393,720 observations
pass with zero function failures. Firefox reorders/drops questions in 192 cases per configuration with unchanged output.
The aggregate gate exit is **1**, correctly preserving these intentional changes and skipped replays. The 99,396
conservative tier-2 requests were not all run: the native MF1000 and targeted sets above are narrower evidence, not a
fabricated full sweep. Supplied-font-facts native parity and all combinations are not newly certified by these targets.
Prior native rows, reference predictions and acceptance rules are retained. Captured logs and full difference proofs
are archived with the batch evidence; a pure-refactor gate pass is not claimed.

## Second batch

The same input-dimension audit continues; these changes remove own-code growth without changing ordered measurement
questions or diagnostic output:

| Access or analysis | Previous growth | Current data flow |
|---|---|---|
| Blink raw diagnostic gaps | scan every prior gap per raise | sparse source-position first-entry index per gap/run/detail; widening and rollback retain their original order |
| Gecko Common-script witnesses | rescan script neighbors at each offset | sparse intervals collected during the existing script scan; ordered witness lookup |
| Gecko grapheme continuations | walk to the end of the cluster on every query | sparse continuation intervals collected during the existing correction scan |
| Gecko run context records | search all prior Context records | preparation-local identity Map owning the existing records |
| WebKit preserved-whitespace TAB check | search whole box for each item | one box classification per contiguous item range |
| WebKit nested content state | mark every ancestor on each content item | two depth values representing the same true-prefix/false-suffix state |
| WebKit alternate-history extra boundaries | test every extra boundary for each item | merge ordered boundaries through a local cursor |
| WebKit deeply nested geometry | recurse to create/close ancestors | explicit parent and geometry stacks; source arithmetic order retained |

Blink's private GapAccumulator materializes ordinary Gap[] snapshots at decided-line/output boundaries. Its index
stores the earliest active entry at inclusive source positions; it keeps retained widenings when later speculative
entries are discarded, removes dead groups, and coalesces uniform nodes. No text or measured answer is a key. A sole
gap extended over 65,536 positions retains at most 33 nodes before coalescing to one; truncating all entries drops all
nodes and groups. At 8,192 disjoint ranges, 33,550,336 old list visits become roughly 229,000 indexed visits. Ordinary
stand-in inspection adds a small constant cost (about 0.3% Latin and 2.5% Arabic); the general design avoids an unbounded
quadratic fallback. Complete raw-state comparisons include 102,225 raised/widened/truncated states and 40 full engine
comparisons, with exact ordered Canvas questions.

Gecko preserves 1,023 complete prepared/layout/pieces/inspection comparisons and all ordered questions. The sparse
metadata is empty/shared on ordinary single-unit Latin. A 2,050-unit Han/Common case replaces 1,049,600 neighbor reads
with 1,024 ordered interval lookups and the existing one-time character classification. A 2,049-unit combining cluster
replaces 2,096,128 repeated continuation reads with 2,048 lookups; preparation still asks one 2,049-unit question and
filling asks none. At 2,048 distinct one-character font runs, 2,096,128 context-record visits become 2,048 identity lookups.

WebKit preserves 580 complete engine comparisons and 250 rich geometry comparisons over 10,126 lines, including all
ordered questions. A real deferred-bidi 2,048-unit box replaces 2,097,152 nominal TAB-search units with one 2,048-unit
classification. Depth/content 1,024 replaces 1,048,576 ancestor writes with constant-time state changes. A legitimate
513-item alternate world replaces 65,792 boundary tests with 1,025. Geometry survives 65,536 ancestors without recursive
call-stack growth; the previous engine could fail at 32,768. These are stand-in/operation-budget results, not native
browser timing claims.

Fresh certified MF1000 native checks at `.artifacts/tests/main-native-runs/general-cost-20260921-r2/` preserve all
statuses and ranges above. Chrome/WebKit complete reports are exact; Firefox changes only four existing native geometry
review details. Fresh input-only checks at `.artifacts/tests/general-cost-native-20260921-r3/` preserve every complete
result of the preceding 32/64/34-case runs, including the six pre-existing Firefox misses. Sources are sealed before and
after every native job; the strict failures remain visible. The 25 all-engine quick gates finish in 208.5 seconds:
1,069 tests and six strict projects pass, with exactly the preceding replay counts and question classifications, no new
skips, and the same deliberate aggregate exit 1. All 393,720 replayable plain/pure observations pass; 244 remain skipped
for the first batch's unrecorded questions. Second-batch logs, reports and temporary proofs are preserved under
`.artifacts/general-cost-20260921-r2/`.

## Third batch

| Access or analysis | Previous growth | Current data flow |
|---|---|---|
| Blink paragraph diagnostics | scan all paragraph gaps for every line | one static interval tree over canonical numeric gap ordinals; return matches in first-raise order |
| Blink declared diagnostic styles | repeatedly scan all items per style | temporary per-style item buckets built in the existing pass, discarded after preparation |
| Gecko connected candidate rows | rediscover every boundary at every queried offset | publish the same discovered row into its existing per-offset row slots once |
| Gecko known group edges/agreement | linear edge lookup and nested membership tests | binary ordered lookup and monotone required-cut merge |
| Gecko parsed family declarations | parse/compare long shared vectors at every adjacent frame | one preparation-local declaration-identity registry and canonical parsed-vector records; unchanged first-demand validation |
| WebKit real alternate-history worlds | copy whole item/mapping/change arrays per world; scan all worlds for each line | splice views sharing finished own items, local maps and sorted changed positions; ordered world-range selection |
| WebKit wrapping ancestors | recompute both root depths per sibling wrap | depth stored on the existing element record during preorder construction; walk only differing ancestor paths |

Blink replaces 29,991,895 actual Bukhala paragraph-gap inspections with 388,608 interval visits plus 13,098 matching
entries. At 2,048 same-font mark spans, 12,589,056 diagnostic style-item inspections become 2,048, with the same single
Canvas question shaping 2,048 units. Complete output/raw-gap/question comparisons cover 112 inputs, with 42,000
independent interval-query comparisons including overlaps and zero/reversed query ranges. The static index stores numeric
endpoints and ordinals, not Gap/Entry back-references or measured answers; it lives in the inspected preparation. It does
not change gap order or canonicalization.

Gecko's 1,024-unit connected-row discovery drops 1,047,552 repeated boundary steps to 1,024 discovery and 1,023 once-only
publication steps. Known-edge lookup drops 392,960 comparisons to 9,212; required-cut agreement drops 262,656 to 1,024.
Existing offset slots share the same row; no additional row, edge vector, offset record or context is allocated. The row
batch preserves 2,448 complete outputs and ordered questions, including nonmonotone direct offset queries. Family
analysis preserves another 2,664 complete outputs/questions and 240 validation/short-circuit/error comparisons. With
512 flows alternating two equivalent 512-family declarations, parsing drops 1,022 calls/7,211,232 source units to two
calls/14,112 units; entry comparisons drop 261,632 to 512. The registry dies before preparation returns. Each distinct
raw declaration is still validated on first demand; malformed self-equality still throws.

WebKit's 1,024 genuinely differing TAB-space boxes retain 15,360 local item/map/change entries instead of 31,458,304
whole-paragraph entries; both versions have 2,048 worlds and ask 3,072 Canvas questions shaping 4,096 units. Local views
preserve untouched prefix/suffix object identity, map the source item containing a carried line start, and keep worlds
in logical box order. The generic list reader is constant time; preparation retains its direct mutable array phase.
Only necessary consumed slices materialize. A late tiny line searches matching histories rather than scanning all
worlds. At 1,024 shared ancestors/1,024 Han sibling spans, 2,100,220 parent reads become 3,070 with identical 2,048 Canvas
questions/units. Depth is one scalar on the existing element record, not a separate table.

Temporary full-state comparisons explicitly materialize the views and maps to the old representation and omit only the
new internal depth scalar. Existing fields/output/questions must remain exact. They cover 918 complete comparisons,
including an independent 326-input review with atomics, break elements, empty/short leaves, mixed styles and deep Han
siblings. No cycle or mutation of finished base items is introduced. Rotating free-answer prototypes show the expected
large-input preparation reduction (roughly 309 ms to 4.7 ms in the 1,024-world case), and a small constant generic-reader
cost: ordinary three-width fill/pieces/inspection adds about 3–7 microseconds per message in these controls. Those
stand-in costs are scoped own-code evidence, not native speed claims; retain the general bounded representation.

The 25 all-engine quick gates finish in 216.5 seconds: 1,079 tests/88 files and all six strict projects pass. All replay
counts/classifications/skips remain exactly those of the preceding checkpoint: no new prediction/question differences
and deliberate aggregate exit 1. Fresh sealed MF1000 checks at
`.artifacts/tests/main-native-runs/general-cost-20260921-r3/` retain every status and range, with only four existing
Firefox native geometry review details changing. The preceding 32/64/34 input-only targets have exactly identical
complete results at `.artifacts/tests/general-cost-native-20260921-r4/`. Twenty additional Firefox row/witness/family
inputs pass. Eleven of twelve additional WebKit real-world/deep-ancestor inputs pass; one native layout changes with
run order (48 versus 64 lines). A fresh four-role run of the preserved second-checkpoint core has **exactly the same
complete twelve results**, including that native variation. Both strict reviews are retained at
`.artifacts/tests/general-cost-native-new-20260921-{r3,r3-base}/`. New targets confer no main or supplied-facts waiver.

## Fourth batch

| Access or analysis | Previous growth | Current data flow |
|---|---|---|
| Blink generated source and cluster extents | rescan long generated/non-boundary runs at every slice | maximal fixed-property runs built once; clipped ordered endpoint lookup |
| Blink final diagnostic union | scan all previous canonical entries, including disjoint keys | temporary per-key sorted inclusive interval components; earliest input slots preserve output order |
| Blink no-base context extension | rescan each expanding mark/default-ignorable interval | carry the already-proven interval and inspect only newly included cluster units |
| Gecko frame continuity ancestry | rebuild ancestor arrays and Cartesian membership, including shared prefixes | actual source-event close ancestry, separate from synthetic bidi continuation ancestry |
| Gecko whole-leaf whitespace | scan the same leaf at every justified line end | exact ASCII whitespace participation compiled in the existing leaf classification |
| Gecko tab origins | fold every ancestor for every frame, including frames without consumed tabs | retain original numeric order; fold only when the first consumed tab needs its origin |
| Gecko deeply nested formatting | source depth becomes JavaScript stack depth in reflow/placement/inspection | explicit local ordered work stacks, including trimming, justification and tab diagnostics |
| WebKit TAB range membership | scan every queried original-box prefix, even without TAB | actual TAB offsets collected during byte classification; empty/ordered membership lookup |

Blink keeps maximal generated/source/grapheme/cluster exception runs alongside the prepared flags they describe; the
source/grapheme runs exist only on inspected preparation. Ordinary boundary-per-unit text retains no range entries; a
single 65,536-unit cluster retains one pair. Construction is O(N) per fixed property, storage O(R), and a lookup already
known to be inside a run is O(log(R+1)); local shaping clamps remain exact. Complete helper comparisons include 240,000
results, arbitrary nonmonotone source maps, generated-only, empty/reversed, EOF and clipped windows. Seventy-two full
engine/prepared/raw-gap/Canvas comparisons are exact except the explicitly added private run fields. At 2,048 same-font
mark spans, 2,096,128 backward-cluster and 8,384,512 forward-slice flag visits are removed with the same one preparation
Canvas question. The extra linear preparation has a real constant cost; ordinary controls are noisy, not a universal
speed claim.

Canonical diagnostic components use O(G + sum Gk log(Gk+1)) time and O(G) local scratch. Scalar entries keep their own
input slots; connected inclusive intervals keep the first entry's fields and earliest original slot, including late
bridges. There is no quadratic fallback or persistent canonicalization index. Complete old/new outputs match on
30,011 independent cases. Disjoint 8,192-gap own-function prototypes fall from about 63.3 ms to 0.294 ms; already-linear
connected and tiny scalar cases pay a small constant cost. No source/measurement-answer cache is added.

The no-base extension repair adds no prepared field. Actual producer cluster boundaries keep incremental code-point
checks equivalent even around paired/unpaired or split UTF-16 and local clamps. Complete outputs/questions match on
108 engine cases and 25,600 direct pair/window comparisons. A two-line 2,048-WORD-JOINER input keeps 84 Canvas questions
and 125,045 shaped units, while own code-point checks fall from 39,542,454 to 43,008. This does not remove the questions'
string-length cost.

Gecko preserves 1,221 broad, 1,443 additional font/fact, and 234 targeted full prepared/output/ordered-question
comparisons. Forty-eight depth-8,192/16,384 cases agree with equivalent shallow source on ranges, painted text, text
geometry, gaps and questions; additional ancestor geometry is required output. Temporary ordered stacks use O(depth)
space, with one added whole-leaf boolean on each existing leaf. At depth/flows 512, the prior shared-prefix walk built
524,286 ancestor entries, made 263,676 membership comparisons and visited 263,168 tab-origin parents; these eager
metadata costs are removed. A justified 512-space leaf loses 261,632 repeated reads, retaining one preparation scan.
Consumed tabs still add their actual ancestor coordinates in the original innermost-to-root order. Permanent regressions
fail the preserved core with an actual deep RangeError and a whole-leaf read budget; no production counters or injection.

WebKit's sorted TAB offsets belong to the immutable compiled box and are shared by alternate worlds. Ordinary no-TAB
boxes share an empty vector. Independent review compares 420,173 membership queries, 216 protocol pairs over 21,402
ranges, and 144 complete engine/history comparisons with exact numbers and ordered questions. Split UTF-16, aliases,
all six whitespace modes, signed spacing and negative/reversed/out-of-box integral ranges are covered. At 4,096 queried
prefixes, 8,390,656 prior character checks become zero (no TAB) or 8,192 offset reads (one later TAB); shaped units remain
8,394,754 in both versions. Extra byte classification continues beyond the first non-Latin-1 character to find later
TABs; ordinary stand-in preparation costs are small/noisy (roughly 0.07–0.47 microseconds here), not native speed evidence.

The 25 all-engine quick gates finish in 153.5 seconds: 1,092 tests/91 files and all six strict projects pass. Every field
of all six replay reports except the library source fingerprint is **exactly** the third-checkpoint report: no new
prediction/question changes or skips. All 393,720 replayable plain/pure observations pass; 244 remain skipped, and the
99,396 conservative tier-2 requests remain narrower targeted evidence rather than a completed sweep. Aggregate exit 1
is retained. Fresh sealed MF1000 checks at `.artifacts/tests/main-native-runs/general-cost-20260921-r4/` preserve every
status and outcome field: Chrome/WebKit complete reports are exact, Firefox changes only four existing native geometry
review details. The strict failures and unadoptable workflows remain visible. Logs, six full reports, exact replay-field
comparison and completed temporary proofs are archived under `.artifacts/general-cost-20260921-r4/`.

## Remaining general frontier

Further measured own-code factors remain active prototypes: Blink empty-span and collapsible-space/WBR Builder state
rediscovery, and recursive script splitting at many script runs; Gecko prior-frame tab diagnostics, whole-unit Arabic
numeric classification, known-unrealized font prefixes and connected-group share counting; WebKit repeated compilation
of one shared long font declaration, and rightmost geometry rescans under simultaneous negative letter/word spacing.
They are independent of ordinary message speed and native shaping, and remain worth repairing.

Blink box-edge suffix shifts also repeat over visual children. A source-preserving ordered product of saturated
LayoutUnit shifts has been proved in a temporary candidate; simple reassociation loses the source's saturating event
order. The coherent ownership boundary includes LineBreaker and trailing-space geometry inputs, not merely late output
clamps. Independent tiny signed-margin cases confirm the source's nonnegative physical fragment law against fresh
Chrome. The old observation port already clamped negative rectangles, so range/score passes masked the internal defect.
The broader 25-case Native experiment also exposed the earlier computed CSS Length DOUBLE-clamp/FLOAT storage
boundary. Both source stages and full physical rectangles are being classified before landing; passing cuts alone do
not certify giant geometry or separate per-glyph/InlineLayoutUnit shaping arithmetic.

Signed spacing can make a fixed pixel-width shaping window unbounded in source length. Gecko units that fail all
certified additive cuts still require long per-offset Canvas recipes: question counts can be linear while total shaped
units are quadratic. Removing metadata scans does not close that observability cost. WebKit nonmonotone complex-word,
TAB-prefix and cross-box joining recipes have related shaped-unit/counterfactual cost. The general performance goal is
not complete while substantial justified own-code repairs remain.
