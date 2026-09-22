# General stateless cost

The current [prepared plaintext round](PREPARED_LAYOUT_EXPERIMENT.md) removes range bookkeeping from public count-only
layout. Fair public-API pairs show ordinary repeats about 31–70% faster across all three browsers, with unchanged
preparation and retained data. The redo core matches `0bdea4d`. A bounded numeric ASCII value also supports unfamiliar
widths without Canvas, source strings or per-line records; eager original-prefix preparation is rejected for general
use because its submitted text grows quadratically.

The smaller direct preparation still costs about 9.5–13.5× main in the captured N512 controls. General preparation
ownership, contextual shaping, signed spacing and broader native coverage remain open. Bracket search is about 59%
faster than global binary narrow and 17% slower wide; neither traversal nor preparation is proved necessary. Exact
identity source maps are deferred behind the next broader prepared-data experiment. Rich painting remains paused.

The completed bounded [plaintext round 3](STATELESS_ROUND3.md) removes repeated Blink retry searches and Gecko adjacent
endpoint lookups without changing measurement rules or arithmetic. Controlled ASCII 512 prefix/map reads fall about
41%/34%; the complete foreground matrix supports useful repeat gains. Preparation has no general gain, new-width costs
are mixed and unchanged WebKit control variation is retained. Main's large resize gap remains open.
The [preparation ownership account](experiments/plaintext-round/preparation-cost-account.md) separates actual consumers
from unexamined representations; exact implicit identity source maps remain a deferred experiment. Dense maps,
temporary source copies, per-line rollback/trim scratch, new-width Canvas work and inspected scans remain open costs.
Neither these gains nor rejected small prototypes prove the remaining costs necessary or close general performance.

2026-09-22. Testing infrastructure is sufficient for the current iteration. The general-cost work follows
`~/github/vibescript/docs/engineering.md`: model input dimensions, repair repeated access at its source, and stop when
further gains require substantially more machinery, assumptions or retained data. Ordinary chat timings alone do not
establish predictable worst-case cost.

Five general-cost checkpoints remove justified input-driven traversal, rescanning and relocation factors across the
three ports. This is a practical stopping point for that input-growth audit after the final validation below, rather than
a claim that arbitrary text, supplied font grammar and contextual shaping now have linear cost. [Current main comparisons](MAIN_PERFORMANCE.md)
show material preparation and scalar-fill gaps; they do not support closing application performance work. Testing work
reopens when a concrete change needs a new observable contract.

The subsequent bounded [plaintext round](STATELESS_ROUND.md) replaces Blink's retained per-unit script/priority
arrays with one representation of the consumed facts and separates exact source-range output from full line output.
It preserves measurement rules, ordered questions and numeric arithmetic. At 512 units, single-script prefix work
falls from 266,231 script reads to 4,599 total buffer reads (Hebrew); the Arabic numeric control falls from 788,473 to
4,599. These stand-in counts describe our access, not Canvas's submitted-text cost. Ordered script ends/codes serve
measurement traversal, including exact source facts for lone low surrogates; accepted measurement boundaries separately
ignore low starts. Direct per-unit flags serve boundary/direction readers. Known-Latin unsegmented paragraphs now
use null as their source fact, retain no script/edge/direction buffers or duplicate mode boolean, and skip two transient
analyzer arrays plus the segment constructor. The exact original predicate and per-question Canvas analysis remain.
Segmented paragraphs' three buffers contain `5S + N` bytes for S
exact source-script runs and N UTF-16 units:
517 versus the former 1,024 on 512 single-script units, or 3,072 versus 1,024 on a 512-unit alternating-script input.
No lower peak-memory claim follows: analyzer arrays coexist during construction and typed-array objects also cost
space. Random script lookup is binary; cross-script measurement walks known ordinals directly. Spacing and gap
corrections use the exact source script of mapped units. Questions crossing an ignored low-surrogate boundary use a
temporary monotonic cursor in O(mapped units + crossed source runs); questions covered by one source run keep the
known scalar script. Dense edge/direction reads stay O(1). An initial five-column model was rejected after consistent native repeated-layout slowdowns;
its cursor ablation ruled out flattening the cursor as their source. The direct-flags model replaces that prototype
rather than retaining it as a second representation.

Plain Gecko ranges omit retained placed frames and unused justification output. Span child presence is derived from
the existing pass-local placed count, rather than retained output membership. Full and range fills share one decision
algorithm in every port. Blink/WebKit retain scratch items/runs needed for break/trim/rollback and omit only their
terminal full wrapper. This round does not close the contextual measurement frontier below.

Final native timing is mostly close to the original redo, without a broad preparation gain. Retention accepts a
small consistent Chrome Latin repeat cost (0.062ms per 120 messages across three widths), alternating-script setup
and payload growth, and an unresolved Firefox Latin new-width cost. Exact removal of repeated source rescanning is
the main benefit. The round's record distinguishes that own-code improvement from unchanged native Canvas work;
the subsequent [bounded round](STATELESS_ROUND2.md) removes unused unsegmented metadata and simplifies single-part
Blink shape views. Plain narrow ASCII lines no longer pay the N(N−1) suffix-read control; many SHY leaves no longer
pay the N(N+1)/2 identity-search control. Inspected suffix scans and Canvas questions stay unchanged. The completed foreground matrix shows about 11–15% faster ordinary Chrome repeats and about 2× on the N512 narrow control. Preparation has no general gain; Latin cold costs remain explicit and new widths are mixed. Unchanged Firefox/WebKit paths are controls. Even zero-Canvas repeats retain large main gaps. See the round record for every sample, pause tail and the stopping boundary.

## Current data flow

N is source/transformed UTF-16 units, F actual font/context records, P bidi paragraphs, B source boxes, D source depth,
L consumed lines, G diagnostic entries, R fixed-property exception runs, C logical/visual children, V positioned visual
children and H required extra visual fragments. Source-font bounds additionally name E range endpoints and U consumed
distinct coverage identities; Kdistinct is the distinct decisive codepoints in one whole-cluster query. Bounds below
concern our own access and bookkeeping. Native shaping, Intl and JS string implementation costs are separate.

| Work | Current ownership and access |
|---|---|
| Shared font/context resolution | insertion-only AVL over exact settings; creation order and context identity retained |
| Inherited font analysis | preparation-local iterative source stack; explicit empty-language resets retained |
| Bidi paragraph selection | binary lookup of ordered paragraph limits |
| Blink accepted shaping pieces | one logical accumulation of corrected exact-piece advances; ordered cut lookup |
| Blink failed safe cuts | same predicates, rejecting pair first; a zero pair still needs wider context |
| Blink Builder state | last meaningful source event and collapse cursor; pending toggled-space epoch materializes once |
| Blink script splitting | primary shaping segments and ordinal traversal; right-associated arithmetic and question order retained |
| Blink generated/cluster extents | maximal fixed-property runs, clipped ordered endpoint lookup; ordinary text has no entries |
| Blink source mapping | source runs shared at preparation; collapsed inverse-source runs exist only for inspection |
| Blink raw diagnostic gaps | sparse first-active-entry source-position index; widening and rollback preserve order |
| Blink final diagnostic union | temporary per-key sorted inclusive components; earliest input slot preserves output order |
| Blink paragraph/style gaps | static interval index of numeric gap ordinals; temporary style buckets discarded after preparation |
| Blink no-base context extension | carry already-proven interval; inspect only newly included units |
| Blink visual box reconstruction | source forest and local open paths; O(B log B + C + H log H), O(B + H) scratch |
| Blink ordered box-edge shifts | saturated-function product tree; O(B log B + V), O(B) scratch; source event order retained |
| Blink wrapped box ancestors | nearest actual fragment ancestor, inspection only; skip styles producing no geometry |
| Blink supplied ligature facts | source-local fact/locale owner, carried same-font/script stretch endpoint and monotone uncertain-boundary extension |
| Gecko fallback-font checks | no enabled checks means zero font traversal and zero Canvas probes |
| Gecko long measured windows | unchanged cut certification; merged width measured only at a closing cut or final total |
| Gecko original unit start | return known zero before discovering windows; interior guards retained |
| Gecko tabs/scripts/continuations | ordered source metadata; lazy traversal only through consumed tabs |
| Gecko Common-script witnesses | sparse intervals collected during the existing script pass |
| Gecko context records | preparation-local identity Map over the existing records |
| Gecko known ligature rows | one canonical row in existing per-offset slots; actual parts own edges, counts and mark facts |
| Gecko family/language declarations | consumed source records; equivalent parsed family vectors canonical within preparation |
| Gecko inherited geometry | source-event ancestry and local iterative reflow/trim/placement/justification stacks |
| Gecko whole-leaf/whole-unit policy | exact ASCII whitespace and Arabic numeric direction classified once at their source |
| Gecko tab uncertainty | one append/rollback prefix per speculative pass; inspected hyphen points use binary lookup |
| WebKit bidi/content/language | append finished splits once; source stacks and true-prefix/false-suffix state |
| WebKit complex graphemes | original-box metadata and streaming actual suffix; stop at first overflow |
| WebKit TAB membership | sorted positions on the immutable box, borrowed by alternate worlds; empty vector shared |
| WebKit alternate worlds | local splice/map/change views sharing completed base items; ordered world selection |
| WebKit ancestors/geometry | source depths and local iterative stacks; only differing branches walked |
| WebKit negative-spacing extents | line-local rightmost prefix owner, sealed once as runs append |
| WebKit font/language source | one consumed declaration, resolved generated row and finite mode policy per preparation |
| WebKit spacing policy | first-family source partition at the existing compiled font; source-volume budget replaces partial interpretation |
| WebKit inspected gap merging | local latest-ordinal overlay; O(G log(N+2)) access/scratch, discarded with one inspection |

Source font coverage assumes the documented sorted inclusive range contract. Source metadata is interpreted once,
while numeric endpoints are consumed only when their relation warrants it:

- Gecko replaces one ordered font table's source/demand view with a complete first-family partition after a source-volume
  budget. Cells are delimited by actual source endpoints, with unknown barriers and hyphen aliases retained. A tiny text
  does not sweep a giant unused later cmap. Shared coverage identities retain the earliest eligible family.
- Blink's whole-cluster lookup discovers only consumed source families and shares identical cmap identities. Deferred
  weighted blocks heap-merge endpoint streams into persistent covering-family bitmap roots. With S=F+E+1, construction is
  O((U+E) log S log(F+1)), live storage O(F+E log(F+1)); scalar compiled lookup is ordered, while genuine Kdistinct-way
  conjunction can still visit every family word. The first complete literal cluster query is an explicit startup allowance.
  The table disappears with its preparation-local fact owner. Supplied-fact ordinary controls pay a measured constant
  overhead (roughly 0.2–9.6 microseconds across stand-in passes); those are not Native performance results.
- WebKit spacing policy similarly replaces a demand view after B=(F+E) ceil(log2(F+1)) consulted source work. Here E
  counts coverage **and spacing-input intervals**. A final demand may overshoot by O(F+E), then heap merging costs
  O((F+E) log(F+1)) with O(F) temporary streams and O(E) retained cells. All cell cuts come from actual source endpoints.
  The existing whole-declaration unknown-fact barrier and first-family ownership remain exact; no queried codepoint
  answer table is added. Tiny text does not inspect giant unused later numeric ranges.

Blink retains first-unit dispatch for supplied ligature patterns. Carried uncertainty updates each newly covered
boundary once, and a listed string too long for the remaining across-mark range is rejected before scanning it, allowing
one final astral UTF-16 overrun exactly as the existing matcher does. A larger compiled grammar remains deferred:
shared-initial 8,192-pattern controls improve about 60–74 ms to 3–7 ms, but ordinary supplied-fact controls regress
about 56–74% and add 424 helper lines. A later-demand content-alias case still repeats input work by pattern count.
The exact full-output/query prototype and its negative controls are preserved; it is not part of the landed runtime.
The remaining pattern-count × cluster-count factor is avoidable source work, not a Native lower bound.

The font pool's existing 512-context clear remains between preparations, preserving held contexts. It does not bound
one paragraph's F; ordered lookup does. Gecko still owns a fresh pool per preparation because late family discovery can
silently stale retained canvases. No new measured-text answer cache or public prepare surface is introduced.

Sparse fixed-property runs use O(N) construction, O(R) storage and O(log(R+1)) lookup inside a known run. Cluster runs
are common preparation data; source runs serve plain source ranges too. Grapheme and collapsed inverse-source runs
are inspection data. The extra views follow the flags/maps they describe, rather than retaining copied strings.

Canonical diagnostic components use O(G + sum Gk log(Gk+1)) time and O(G) temporary scratch. Inclusive late bridges,
scalar entries, earliest fields and first-raise order remain exact. Raw accumulation retains widening/rollback semantics
and drops dead index groups; one extended gap coalesces rather than retaining a record for every point.

## Numeric ownership

Blink geometry obeys the source's LayoutUnit storage and operation boundaries. CSS fixed lengths first clamp the DOUBLE
product, then store FLOAT, then convert to raw i32/1-64-pixel LayoutUnit. Borders have their separate integer-pixel
producer. LineBreaker lengths, item advances and trailing/hanging space operations saturate as they are computed.
Physical inline fragment widths become nonnegative at fragment creation; atomic border-box width is independent of
its margin-box advance. There are no late clamps repairing invalid output.

Saturation is not associative. Ordered box-edge transforms preserve every source event's order while activating it
at its child threshold. Shaping's 16.16/i64/f32 laws remain separate: clamping every number to LayoutUnit would be wrong.
The discarded overflow placeholder adds one whole pixel, not one raw epsilon.

Pinned c153 PhysicalRect-to-FloatQuad/DOMRect projection is a separate observation producer. The temporary source-law
oracle follows f32 casts, corner addition/scaling and bounding subtraction without a width-repair clamp. All 72 element
x/width checks on the 25 ordinary-font giant-box cases match Native, versus 16/72 for the preserved core. Direct tiny
signed-margin rectangles separately improve 14/16 to 16/16. These certify those inputs, not arbitrary extreme typography.

Blink's earlier corrected-piece prefix change also deliberately fixes old JavaScript association: logical joint sums
with the source's float32/LayoutUnit conversions get the correct 16,384-glyph whole; old suffix rewriting can be off by
one raw unit. Near-whole and narrow attacks retain public ranges and positions; no quadratic legacy guard remains.
Gecko lazy tabs intentionally omit incidental warnings for unused future origins. Actual consulted uncertainty stays
protected. Reproducing unused suffix diagnostics would retain the growth problem.

## Evidence and validation

The five checkpoints preserve their full reports, temporary source snapshots, proof drivers, outputs and ordered
Canvas traces under `.artifacts/general-cost-20260921-r{1,2,3,4,5}/`. Their manifests and archive SHA256 distinguish
completed comparisons from proposals and failed protocol runs. Earlier detailed chronology remains in Git history.

Representative own-work reductions under stand-ins, not Native timing claims:

- 8,192 font declarations: 33,550,337 equality comparisons become ordered logarithmic access.
- 65,536 bidi units/16,384 paragraphs: 536,870,911 visits become 917,490.
- Blink depth-1,024 decorated source: 179,480,576 box-parent visits become 3,071 with identical required geometry.
- Blink 2,048 toggled-space epochs: 25,169,916 relocations become 12,288; the same single Canvas question remains.
- Blink 8,192-cluster known-font stretch: 33,550,336 repeated endpoint visits become 8,191.
- Blink 128 groups/8,192 unused fact tables: 1,048,576 fact interpretations become one.
- Gecko 1,024 connected-row units: 1,047,552 repeated steps become one discovery/publication pass.
- WebKit 1,024 real alternate boxes: 31,458,304 whole-input retained entries become 15,360 local entries.
- WebKit 4,096 queried TAB prefixes: 8,390,656 character checks become zero without tabs, or 8,192 offset reads with a late tab.
- WebKit 2,048 leaves sharing a 2,048-family declaration: 48,054,272 parsed source units become 23,464; fallback questions remain unchanged.
- WebKit 512 characters/513 font families: 526,336 spacing-policy reads become 1,538 with the same six Canvas questions.
- WebKit 4,096 inspected gaps: 8,386,560 reverse-list visits become 131,043 overlay-node visits with complete output/question equality.

Identical permanent regressions fail preserved implementations on their observable work budgets or actual deep
RangeErrors while retaining the semantic assertions. Production functions carry no counters. Permanent tests count supplied-data reads through local facades/Proxies;
deeper production-work instrumentation exists only in temporary source copies.
Complete-state proofs compare prepared/post state, ranges, pieces, geometry, raw gaps and ordered settings/text/answers;
new representation fields are the only declared projections. Required output and independent shaped-unit cost are not
silently excluded from full exports.

Final fifth-checkpoint closure runs 25 all-engine quick gates in 142.2 seconds. All six strict projects and
**1,182 tests in 106 files** pass. Every field of all six full replay reports, excluding only the library source
fingerprint, is exactly the fourth-checkpoint report. All 393,720 replayable plain/pure observations pass; 244 remain
skipped. Aggregate exit 1 and the 99,396 conservative tier-2 requests remain explicit rather than a completed sweep.

Fresh source-sealed MF1000 workflows finish all twelve Native children with exit 0. Every one of the 3,000 complete
case outcome/range records matches the fourth checkpoint. Chrome is 999 pass/1 stable miss; WebKit 998 pass/2 prior
reverse-Native cut changes. Their complete case reports are exact. Firefox is 955 pass/1 stable miss/44 Native geometry
reviews: four previously varying geometry cases are stable in this capture, changing only issues/status. That is not an
engine accuracy improvement or a history waiver. All three strict workflows retain exit 1 and are non-adoptable.
Reports and every changed complete case are under `.artifacts/tests/main-native-runs/general-cost-20260921-r5/`.

The 18 input-only Blink source-geometry cases run the full inspected/plain ports in both orders against frozen R4 and
current R5. All 72 complete predictions and raw Native observations match; all complete result/scorer records match
as well. Fifteen cases certify count/cuts. Three collapse/restore whitespace-only cases are inconclusive because Native
has no positive-width codepoint on a line; they are retained, not passes. Complete geometry scores are additional
diagnostics and remain outside the source-cut certificate. The focused numeric 25 pass count/cuts, mode/order parity
and full Native stability in all four roles; the independent pinned source projection separately certifies the 72
physical element coordinates above. Target reports are `.artifacts/tests/general-cost-blink-source-geometry-20260921-r{4,5}/`
and `.artifacts/tests/general-cost-numeric-20260921-r5/`.

Full prototype state/question proofs, frozen replays, fresh feature samples and focused source/Native cases justify
skipping an indiscriminate tier-2 or expensive whole-book recapture in this batch. The prior 216-input/four-role book
captures remain retained evidence, not fresh fifth-checkpoint observations. This closure does not claim an exhaustive
fresh 500,797-obligation sweep, all inherited API contracts, or universal Native geometry accuracy.

## Practical frontier

The five-checkpoint input-growth audit stopped here. Subsequent bounded plaintext results are in the dated round
reports; [PREPARED_LAYOUT_EXPERIMENT.md](PREPARED_LAYOUT_EXPERIMENT.md) records the current frontier. The source
coverage and gap structures described here address demonstrated large factors;
ordinary supplied-fact controls still pay small constant overhead (Blink up to about 9.6 microseconds in stand-ins,
WebKit gap inspection about 0.51 microseconds). The singleton gap variant adds code without a measurable win and is
rejected. These own-JS observations are not maintained Native benchmark claims.

WebKit inspection also reevaluates item-wide conditions and remaining measured-item ranges. This batch removes the
proved reverse-gap merge factor; it does **not** prove every remaining scan is output-required. That work and the
supplied ligature grammar remain open to a concrete cheaper representation, with their prototype evidence retained.

Long unwindowable joining runs and arbitrary signed spacing do not establish monotone interior fitting. Correct
per-offset Canvas recipes can ask linearly many questions while shaping quadratically many total units. A fixed
pixel window is not a source-length bound under negative spacing. Related WebKit nonmonotone complex-word, TAB-prefix
and cross-box recipes retain contextual/counterfactual costs. Fewer metadata scans do not close that observability debt.

Depth times lines/splits can itself be required retained boxes and fragments; per-character geometry materializes
painted units. Arbitrary supplied matching grammar, source string comparisons and Unicode/Canvas host algorithms are
not covered by a universal linear claim. Reopen a concrete factor when a cheaper representation can preserve its
actual semantics; ordinary cohort speed or a smaller question count alone is insufficient.
