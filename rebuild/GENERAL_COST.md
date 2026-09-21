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

## Remaining general frontier

The next batch targets measured avoidable growth: Common-script witness searches, grapheme continuation scans,
engine-local context-record lookup, WebKit preserved-whitespace TAB scans, nested content propagation, alternate-history
boundary scans and deep geometry recursion. Diagnostic gap accumulation still linearly searches the growing raw list;
its first-touch widening and rollback semantics require a different representation, not canonicalization alone.

Two broader questions remain explicit. Blink box-edge suffix shifts repeat over visual children and need a deliberate
numeric model before reassociation. Signed spacing can make a fixed pixel-width shaping window unbounded in source
length. Gecko units that fail all certified additive cuts still require long per-offset Canvas recipes: question counts
can be linear while total shaped units are quadratic. Removing metadata scans does not close that observability cost.
The general performance goal is not complete while substantial justified repairs remain.
