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

## Remaining general frontier

Measured avoidable work remains: Blink repeatedly selects paragraph gaps per line and rescans all items per diagnostic
style; WebKit allocates whole paragraph item and mapping arrays per genuinely differing alternate world; Gecko can
rediscover a connected candidate row per offset and compare ordered cuts with nested membership searches. These are
active prototypes rather than accepted costs. Blink source/grapheme mapping across many distinct spans also warrants
ordered boundary access.

Blink box-edge suffix shifts repeat over visual children. A source-preserving ordered product of saturated LayoutUnit
shifts is being prototyped; simple reassociation loses the source's saturating event order. The geometry numeric boundary
must be explicit, including atomic border-box widths and nonnegative exported inline-box fragments, before it lands.
Signed spacing can make a fixed pixel-width shaping window unbounded in source length. Gecko units that fail all
certified additive cuts still require long per-offset Canvas recipes: question counts can be linear while total shaped
units are quadratic. Removing metadata scans does not close that observability cost. The general performance goal is
not complete while substantial justified repairs remain.
