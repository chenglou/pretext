# Plaintext stateless round — 2026-09-22

This bounded round starts at `a6ae4c6` on `rebuild-20260916`, backed up at
`codex/plaintext-round2-backup-20260922`. It follows `~/github/vibescript/docs/engineering.md`: remove unused source
data, keep one primary representation and check difficult input growth. Owned rendering and rich painting remain
paused. [STATELESS_ROUND.md](STATELESS_ROUND.md) preserves the previous accepted round.

## What changed

Known-Latin unsegmented Blink preparation records `segments: null`. It constructs neither analyzer script/priority
arrays nor the segment object/buffers, and retains no duplicate mode boolean. The exact source predicate is unchanged:
literal U+FFFC and bidi remain segmented; generated atomic placeholders can be unsegmented. Per-question Canvas
script analysis remains where spacing/inspection need it.

A single-part Blink shape view is its part plus the view's numeric metadata. Empty/multiple-part views own one part
array. Direct result views and scalar endpoints avoid temporary one-part arrays. Clipping, later trimming/numbering,
end-before-start measurements, visual run order, float32 summation and wide-run diagnostics are preserved. Full and
range output still share one breaker; rewind/trim still retain the item and shape-result facts they consume.

Plain filling omits the post-line suffix scan used only to establish inspection's decision extent. Inspected filling
keeps that scan. Text/overflow handlers pass the result index they already know instead of searching for their own row
to add a hyphen or rewind preserved spaces. No break decision or measurement recipe is skipped.

## Source and growth evidence

At 512 Latin units, retained metadata falls from three buffers / 517 payload bytes to zero, prefix metadata reads
from 511 to zero. Preparation also skips two temporary N-byte analyzer arrays and the segment constructor: five typed
arrays/backing stores and one segment object overall. Headers and total peak memory are unmeasured. Segmented loads
and payloads stay unchanged. Empty, styled, atomic, literal ORC, Latin-1, bidi/controls, malformed/split surrogates and
signed spacing have explicit controls.

The independent state/query proof checks 183 inputs in four modes: 732 comparisons and 229,142 identical ordered
questions. Complete prepared/post facts, line parts, pieces and inspection match. Its only normalization expands the
new single-Part View into the old parts representation, preserving every Part and view metadata field, and excludes
only unconsumed plain `decisionEnd`; inspected extents stay exact. Separate null-only isolation distinguishes the two
changes. Exact helpers/source capsules are in `.artifacts/plaintext-round2-20260922/segments/`. Its index labels
terminal summaries; original full terminal streams were unavailable.

Owned-read controls check N64/128/256/512 ASCII at 8/32px and separate SHY leaves on one wide line, full/range and
plain/inspected. All 48 source/continuation/line-box and ordered Canvas comparisons agree.

| N | ASCII 8px: prior finalization reads | Current plain reads | SHY: prior identity comparisons | Current comparisons |
|---|---:|---:|---:|---:|
| 64 | 4,032 | 0 | 2,080 | 0 |
| 128 | 16,256 | 0 | 8,256 | 0 |
| 256 | 65,280 | 0 | 32,896 | 0 |
| 512 | 261,632 | 0 | 131,328 | 0 |

These controls remove N(N−1) suffix reads and N(N+1)/2 identity comparisons. Break-phase reads and Canvas events
stay unchanged; inspected ASCII suffix reads remain equal. Immutable source/own-array observers leave global
prototypes untouched. This removes two owned factors, without claiming universally linear shaping or Canvas work.

An independent View search checks 1,330 cuts, 13,448 trims, 36 joins, 210,340 prefix/position-limit checks and 19,080
grapheme-numbering checks: empty/outside versus inside-zero parts, RTL recuts, WHOLE and float32 thresholds match.
Original views remain unchanged. Reports, exact helpers/commands and stable runtime seals are in
`.artifacts/plaintext-round2-20260922/growth/`.

## Recorded and native validation

Final full/count/range proofs each cover 80 inputs, 5,028 workflows, 25,116 layouts and 158,396 fill records, with no
output/query/independence differences and stable source/helper seals. Ordered Canvas calls are 4,556,024 full and
2,581,894 each count/range. Full separately checks pieces, inspection/geometry/gaps and read order. The original 66
inputs stay unchanged by ID; 14 metadata cases extend them. Endpoint and generated-JS planted defects are caught.
The earlier strict-query controls remain the reference; scoring rules are unchanged.

All 25 quick/fresh gates keep their exits. Six strict projects pass; unit tests increase from 1,211 / 109 files to
1,215 / 110 files with no failures. All 18 complete check/plain/pure reports match accepted prior reports excluding
only library fingerprint; six needs-browser ID files are byte-identical. Plain and pure each keep 393,720 passes,
zero problems and 244 Chrome skips. Two Chrome tier-1 jobs still exit 1, two Firefox jobs exit 4, and 99,396 tier-2
requests remain. Aggregate gate remains 1; this is not a newly green foundation.

The fast native workflow captures 1,000 cases per engine, inspected/plain in both orders: 12,000 scored outcomes.
Complete predictions/measurement logs, cuts, scored records and native geometry exactly match accepted
`native-frozen`. Counts remain Chrome 999 pass / 1 fail, Firefox 951 pass / 1 fail / 48 review, WebKit host 998 pass /
2 fail. Twelve record children exit 0; all three strict workflows/checkers exit 1, none adoptable. There is no new
waiver. This checks cuts, visible units/counts, mode parity, width and stability, not arbitrary glyph placement or
vertical painting. Full historical native/book recapture and fresh main native accuracy were not needed for unchanged
behavior; all 500,797 historical main passes are not newly certified.

Independent reconstructions are in `.artifacts/plaintext-round2-20260922/final-audit/`. Main's published source,
package/API surface and canonical snapshots are unchanged.

## Performance status

Broad fresh timing is pending a stable foreground window. Failed Chrome whole runs and interrupted Firefox are
preserved and excluded; strict visibility/focus/isolation guards remain. Ordinary foreground Chrome uses normal
startup, as the canonical benchmark does. Background/emulated-DPR behavior is unchanged. A short successful preflight
does not prove sustained focus.

One valid Chrome Latin repeated-width preflight has ten samples, five balanced rotating variants and a 20ms floor,
120 messages across three warm widths. Full/full and range/range improve in all ten pairs: paired median ratios
0.903 and 0.894, absolute paired savings 0.147ms / 0.166ms per batch. Current range remains 15.16× actual main's
median on this phase. Focus/DPR/isolation pass; a later enclosing source seal matches all 711 input paths/hashes,
explicitly not an immediate post-preflight check. There is no preparation/new-width, growth or general speed claim.
[MAIN_PERFORMANCE.md](MAIN_PERFORMANCE.md) separates this from the dated prior broad comparison.

The planned broad probe imports actual main `2e5e2bd` directly and prior/current full/range separately, with preparation,
initial count, new widths and repeated widths in distinct documents. Ordinary Latin/CJK/Arabic/mixed each use 120
messages. Hebrew64/128/256/512, alternating64/128 and narrow unbroken ASCII64/128/256/512 controls expose growth.
Ten samples balance five order slots. Exact input/helper versions are preserved before capture.

## Setup and preservation

The initial temporary baseline omitted tracked `rebuild/tsconfig.json`. An optional TypeScript check emitted JavaScript
sidecars that Bun could resolve instead of TS. Preliminary self-checks/pilots are invalidated and preserved. The baseline
was rebuilt from the exact commit with the no-emit config; original tracked hashes were unchanged. Generic/growth
helpers reject generated runtime sidecars before/after; final TypeScript commands use `--noEmit`. The fault contributes
no acceptance evidence. The generated ASCII probe script passed syntax smoke checking before timing; its unused
pre-fix version remains archived.

The final input capsule and SHA256 index are in `.artifacts/plaintext-round2-20260922/reproducibility/`; earlier capsule
versions remain distinct. Mid-gate temporary output is identified rather than treated as runtime source. Historical
full replay shards, OS/browser binaries, installed fonts and dependency runtimes remain external; the prior verified
backup preserves unchanged earlier inputs and records that boundary.

## Stopping boundary

The implementation reduces unused data, single-part shape ownership and two demonstrated scan factors. Wider item
packing/SoA, provenance arrays, margin derivation and other engines' scratch records remain separate prototypes. Keep
one primary representation and one breaker. Existing Canvas string/shaping cost and inspected suffix scans remain
frontiers; counts/allocations do not prove the measurement recipes necessary or close main's performance gap.
Broad foreground timing remains the outstanding closure check.
