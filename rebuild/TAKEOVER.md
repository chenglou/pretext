# Takeover decisions and evidence

2026-09-23, Blink's cut predictor (branch `blink-words-first`, on words first; [DESIGN.md §4.4, §4.6](DESIGN.md)): the
shrink of the wide window no longer measures every window only to learn that it is still 256 zoomed px or more. A plain
paragraph predicts the window it takes from the widest window's total, measures the window before it and that one, and
hands down totals the cuts already give (a group's one piece, the pieces between two cuts, a half's share of the range
cut in two). It takes the loop's windows on a premise about fonts, that a string is never narrower than a window inside
it, documented as a default with the named gap `nested-window-wider`, which an inspected paragraph reports where its
loop and the prediction take other windows. An inspected paragraph hands on what the prediction measured and leaves the
same halves unmeasured, so it asks every question a plain one asks: a first recording in which it measured them found 31
cases without facts and 30 with them where the plain path asked a question the record lacked, all halves of emoji words
at 80px or of Myanmar text whose share by length was far above what they measure. Under the stand-in Canvas a message of
the bench's mix is prepared and filled at 320px with 154.4 questions and 659 UTF-16 units where words first asks 157.1
and 780, of its real set 167.4 and 694 where 175.1 and 747, of the eleven languages 218.1 and 834 where 273.2 and 1,210;
plain ASCII 132.4 and 560 where 132.2 and 560, and the later widths within 0.3 of a question. The evidence, in pinned
Chrome 153 at DPR 2 unless
named (runs under `.artifacts/tests/runs/blink-words-first-20260923/c3`; the cut probe and the counts in `c2`,
`counts` and `fill-counts` read the plain path, which the inspected path's fix left as it was):
- Tier 2, recorded in both orders in both configurations: 0 status transitions against the references it replaces on
  all 69,224 cases, the exact-value tallies unchanged (316 and 839 differing values), the gates' seeds lost 0 and gained
  0. The plain predictor's line ranges equal the usual run's on every case without facts. The recordings pack with every
  case replaying exactly and are frozen at 2eb0edd: an inspected paragraph asks 45,051 and 45,028 more recorded
  questions than words first's (90.1 M and 93.4 M), the windows its walk of the prediction measures where the shrink
  didn't.
- The certified fast workflow and the real-text supplement: 999 of 1,000 (the same failure) and 64 of 64.
- The cut probe against words first over 318 families: 0 cuts, positions and layouts differ, of 769,917 layouts at
  DPR 2 and 784,173 at DPR 1.
- Offline, `tools/words-attack.ts` against words first over the 11,973 seeded paragraphs: no layout differs on `usual`
  at DPR 1, 2 and 3, on `fine` at the lines' own widths, or on `across`, `far` and `backwards`; on `backwards` 4
  inspected layouts report `nested-window-wider`, with words first's lines. Plain and inspected lines are equal in all.
- Counted in pinned Chrome (`tools/fill-counts-probe.ts`, 1,000 messages a set, from scratch at 320px): a message of the
  bench's mix asks 146.0 calls and 602 UTF-16 units where words first asks 148.8 and 722 (its Chinese messages 313.8 and
  1,164 where 349.4 and 2,539), a Latin one 121.8 and 501 where 121.6 and 500, and the bench's Chinese paragraph without
  spaces, 9,428 units in one shaping group, 26,044 and 95,947 where 29,397 and 371,074.

2026-09-23, Blink's words first (branch `blink-words-first`, unmerged; [DESIGN.md §4.4, §4.6](DESIGN.md)): a shaping
group is cut into words first, each measured once with its trailing space, and the offset between two words is a cut
where the two words together measure their sum and the pair window shows 0; a line that ends between two words finds
its candidate from the positions at the cuts. It is round 2's "V3" of the word study, ported onto 90e0266 by hand, with
three changes: a word without a character of a script of its own is no piece of its own; V3's rule that a window side
without a script of its own takes the next piece in is kept for sides Canvas shapes as Common and bounded to windows
below 256 zoomed px (V3's losses in Euphemia UCAS came from the script Blink gives each Canvas call, through word pieces
and, most of them, through that rule); and a position after characters every lookup skips at a cut takes the cut's
adjustment once (round 1's hole). It rests on two premises
about fonts, taken as documented defaults with named gaps: no shaping context reaches more than one word past a space
(`context-past-a-word`) and positions inside a word stay sorted (`positions-run-backwards`). An inspected paragraph cuts
every group by the cut search alone first, which asks what it asked before words, holds every read that depends on the
cuts against it and the walk against the search, and takes the words' values, so plain and inspected lines are the
same. The evidence, all in pinned Chrome 153 at DPR 2 unless named (runs under
`.artifacts/tests/runs/blink-words-first-20260923/c1`):
- Tier 2, recorded in both orders in both configurations: 0 status transitions against the reference of ff0f584 on all
  69,224 cases, the exact-value tallies unchanged (316 and 839 differing values), the gates' seeds lost 0 and gained 0,
  so they stay. The plain predictor's line ranges equal the usual run's on every case without facts. The recordings
  pack with every case replaying exactly and are frozen at 48de7f7; an inspected paragraph now asks 90.0 M recorded
  questions where it asked 51.0 M, since it cuts by the cut search and by words and holds every read against both.
- The certified fast workflow and the real-text supplement give the base's outcomes case for case: 999 of 1,000 (the
  same stable failure, `c-d0c13fd8c7aca939`) and 64 of 64.
- The cut probe over 318 families: at DPR 2, 61 of 769,917 layouts differ, all Zapfino; at DPR 1, 0 of 784,173. The
  Zapfino layouts as 1,932 lab cases: 13 breaks and 2 line counts go from fail to pass and none the other way.
- The second check's sum probe: the words are off Canvas's exact total in 0 of 679,661 short groups (V3: 2, Euphemia
  UCAS), and 983 of 1,534,771 long layouts differ from the base. Its differing layouts as 1,060 lab cases: breaks 887
  to 987 passes (120 gained, 20 lost), line counts 1,042 to 1,054 (17 and 5), widths 87 to 755. Of the 25 passes lost,
  18 are under negative word spacing, where the base's windows hold totals of 256 zoomed px or more once JS adds the
  spacing, each with `context-past-a-word` on the inspected paragraph; 6 are two Euphemia UCAS paragraphs, each at
  three widths a LayoutUnit apart, whose spaces Canvas measures alone as Common (DESIGN.md §4.6); 1 is Zapfino.
- The second check's own 1,171 lab cases, scored against their recorded native layouts: breaks 954 to 1,017, line
  counts 1,117 to 1,129, with 8 passes lost in four places; V3 had lost 44 breaks there, 41 in Euphemia UCAS.
- Offline, `tools/words-attack.ts` over 11,973 seeded paragraphs at four widths (47,892 layouts a Canvas): on `usual`
  at DPR 2 no layout differs from the base, at DPR 3 one case at four widths does, where the window rule moves a window
  under letter spacing, and on `fine` at the lines' own widths 0 of 80,206; plain and inspected lines are equal in all.
  Where the Canvas breaks a premise, every layout that differs from the base without the window rule reports its gap
  (context across a space 25, two words back 9,940, negative advances 666), and the window rule moves 197, 6 and 3
  more there without one.
- Under the stand-in Canvas (`tools/words-count.ts`, 1,000 messages a set) a chat message is prepared and filled at
  320px with 132.2 questions and 560 UTF-16 units where the base asks 179.5 and 1,941 (the bench's ASCII set), 157.1
  and 780 where 198.1 and 2,049 (its mix), 175.1 and 747 where 221.5 and 2,188 (its real set) and 273.2 and 1,210 where
  282.3 and 1,973 (eleven languages); a kept one at a new width with 27.6 and 113 where 60.5 and 264 (ASCII) and 37.2
  and 135 where 64.5 and 272 (mix).
- Counted in pinned Chrome (`tools/fill-counts-probe.ts`, 1,000 messages a set, from scratch at 320px): a message of the
  bench's mix asks 148.8 calls and 722 UTF-16 units where the base asks 178.4 and 1,947, a Latin one 121.6 and 500
  where 157.7 and 1,869; its Arabic messages ask more calls and fewer units (82.4 and 304 where 65.6 and 780), and the
  bench's Chinese paragraph without spaces asks what it asked.

2026-09-23, Gecko's word scan ([DESIGN.md §4.6](DESIGN.md)): a break scan is decided from the shaping units' advances
and passes over the break candidates inside a word whose end fits. It rests on a premise about fonts that the maintainer
accepted as a documented default with a named gap: no tail of a shaped word has a negative advance. No source gives it.
On the port's measurements every installed face at every instance CSS can ask for keeps it (1,229,216 recorded in-word
advances, 381,027 words in 321 families in pinned Firefox, about 2.7M more word and paragraph layouts in the attack of
2026-09-23). Skia at a variation corner and a made-up font break it, with the gap; Firefox breaks it in Mishafi and Diwan
Thuluth where the port can't see it, which was wrong before the word scan too (§4.6). Plain and inspected paragraphs take its lines; an
inspected one also runs the engine's loop, so it asks exactly what it asked, and reports `negative-word-tail` where the
two differ. Both Firefox tier 1 reports equal the base's but for the library's fingerprint, the 192 existing
question-order cases and the citation ledger's 17 existing losses included; plain, pure, sweep and painter pass in both
configurations; the plain path asks 25% fewer recorded questions. In pinned Firefox the certified fast workflow and the
real-text supplement give the base's outcomes case for case (955/1/44 and 64/64), and the plain predictor's tier 2 has
no transition, its 21 moved line ranges all on history-dependent cases whose native lines moved too. The two attacks
find no layout that differs from the loop's on fonts that keep the premise, and a gap on every one that differs where
the font breaks it. Timed in pinned Firefox 156 against the base in alternating runs (per 1,000 units): new Latin text
0.63 ms where 1.04 (main keeping its caches 0.41), new Arabic text 0.81 where 1.41 (0.50), CJK unchanged (4.85 against
4.94); first fills of that text at three new widths 0.17 where 0.49 and 0.10 where 0.93; repeated widths 0.057 where
0.103 (Latin) and 0.054 where 0.093 (Arabic), main 0.007.

2026-09-22, current [prepared plaintext round](PREPARED_LAYOUT_EXPERIMENT.md): the only runtime change is the public
simple count specialization; the redo core matches `0bdea4d`. Fair public-API pairs show ordinary repeated layout
about 31–70% faster across Chrome, Firefox and Safari, without preparation or retained-data changes. The bounded
ASCII preparation experiment supports Canvas-free layout on observed inputs, but does not cover the general
main-pass population. Preparation ownership and broader numeric representations come next; exact identity source
maps are deferred. Rich painting stays paused. All required snapshots are refreshed; 1,496 tests and the fresh three-browser
gates pass, with Safari 27’s single native-height obligation explicitly deferred and its failures retained. The
[round report](PREPARED_LAYOUT_EXPERIMENT.md) records the corrected fractional observer and exact validation; the dated rounds below retain their original evidence and stopping decisions.

2026-09-22, completed bounded [plaintext round 3](STATELESS_ROUND3.md): Blink reuses its immediate retry search and Gecko
reuses adjacent range endpoints, preserving existing measurements and arithmetic. Full/count/range ordered proofs,
1,223 tests and strict projects pass; maintained gates and fresh native outcome categories retain existing failures,
reviews and the documented four Firefox geometry/count/issue-list variations. The complete 108-document / 5,400-row
foreground matrix shows useful narrow Chrome and general Firefox repeat gains, no general preparation gain and mixed
new-width costs. Main's resize gap remains large. Temporary startup experiments are dropped after the user confirms
external focus interruptions and original startup diagnostics pass. Rich painting stays paused. Exact identity source
maps are the next bounded ownership experiment; remaining costs are open, not proved necessary.

2026-09-20, `rebuild-20260916`, from Claude's final `9369b7f`. The goal and routine commands are in
[README.md](README.md). This record replaces the previous phase queue. Main's published API/source remain unchanged.

2026-09-22, earlier completed closure: [plaintext round2](STATELESS_ROUND2.md) removes unused unsegmented Blink metadata,
stores a single-part shape view in one record and removes two demonstrated scan factors without changing Canvas recipes.
Final verification passes 1,215 tests and six strict projects; complete replay reports and fast native outcomes stay
unchanged. The same strict native failures/reviews remain; no rules or references are relaxed.

The complete 108-document / 5,400-row foreground matrix shows ordinary Chrome repeats about 11–15% faster and the
long narrow ASCII control about 2× faster. Preparation has no general gain; a frozen follow-up retains Latin cold
costs and mixed new-width results. Main remains substantially cheaper at resize, including zero-Canvas controls.
Next, measure remaining per-line scratch production, preserving one breaker and required rollback/trim facts.
Width-dependent measurement is separate research. Rich painting remains paused. The dated report links exact inputs,
complete audits and the persistent evidence/all-ref backup.

2026-09-21, earlier closure: the bounded [plaintext stateless round](STATELESS_ROUND.md) consumes Blink script data
into one exact primary model, walks fixed source boundaries, flattens its line cursor and adds ranges through each
engine's existing break algorithm. Plain Gecko omits unused frame/justification output. Canonical plain checks and
benchmark counts use ranges. Final verification passes 1,211 tests and six strict projects, complete-output/ordered
question proofs, and unchanged replay outcomes. Native strict failures remain Chrome 1, Firefox 1 plus 48 reviews,
and WebKit host 2. No acceptance rules or references were relaxed.

Native gains are mostly small; this is a structural reduction of repeated source work, not a large preparation win.
Chrome Latin repeats cost an additional 0.062ms per 120 messages across three widths; alternating setup/memory costs
and uncertain Firefox Latin new-width cost are retained explicitly. Fresh [main comparisons](MAIN_PERFORMANCE.md)
still show large resize gaps. Owned rendering and rich painting remain paused. The round stops with committed useful
simplifications and a concrete next experiment: remove unused unsegmented metadata, then simplify per-line primary
decision data. Measurement recipes and the full historical main-pass population remain unresolved.

Earlier closure, 2026-09-21 (before the plaintext round): testing infrastructure is sufficient for the current
iteration. Five [general-cost checkpoints](GENERAL_COST.md)
repair input-driven ordered access, Builder relocation, font/source interpretation, diagnostic scans and deep formatting
and geometry. Blink numeric conversion, saturation and physical fragment producers now follow their source operation
boundaries. The final closure passes 1,182 tests and six strict projects, preserves all replay-report fields except the
source fingerprint, and retains the known strict Native failures. The detailed closure and practical stopping frontier
are in that shorter record. Arbitrary supplied ligature grammar and contextual/counterfactual shaping retain costly cases; this is not a universal linear-cost claim.
The earlier cohort stopping decisions below remain historical evidence, rather than general worst-case conclusions.
Fresh foreground [main comparisons](MAIN_PERFORMANCE.md) still show substantial preparation and scalar-fill gaps. The
general input-growth audit is a bounded stopping point, not a claim that application performance is finished.

## Owned-rendering decision

The [fixed-word prototype](experiments/owned-rendering/README.md) is rejected as a general replacement before timing.
Narrow ordinary Latin and Arabic words overflow, valid rich style boundaries are rejected, and ordinary item chrome
is not yet supported. Existing fixed-fragment/bidi tests do not establish those capabilities. Full-paragraph bidi and
independent painting remain reusable research; a shared algorithm is not disproved by the prototype omissions.
Any next probe must establish required behavior before comparing separate preparation and resize costs to main.
Small concrete differences may earn their cost; broad restrictions and routine word overflow do not.

## Preservation

`codex/redo-handoff-backup-20260920` preserves the handed-over branch. A verified all-ref bundle preserves every
committed study, including unfinished attackers that found counterexamples. Its SHA256 is
`eafaf9101ff5bbec070ea4d911630d41925de29a39bad3ce79023a4b67648993`.
Before acceptance migration, 48 reference/ledger/pin/seed files were backed up in a metadata ZIP, SHA256
`25cc4dc2fffbe02adc3cfc046440aca259a48a09ade1fd3d72eac99c9d168721`.
Both live under `/Users/chenglou/.codex/visualizations/2026/09/20/01a0c12e-d771-7763-acab-9b673ed39827/redo-takeover-backup/`.
An interim uncommitted-source archive preserves all 91 changed/new files before the compact checker adapter, verified file by file; SHA256 `446225e635858965581bcae10e5dc1902d0466f81c971286ba6f1c4cb850e3be`. Native rows and Canvas recordings were not replaced. Historical guides/reports remain references with one active entry
point. Completed temporary studies are archived under `.artifacts/takeover-20260920/prototypes/`, with SHA256SUMS.

## Core changes

- **Blink plain work:** omit six sampled linear-advance questions used only by diagnostic gaps. Retain primary-family
  discovery, optical-size decisions and supplied facts. Missing named families can resolve to system fonts, so deleting
  all font checks would change actual line decisions.
- **Blink measuring text:** omit per-character source maps when neither diagnostics nor effective letter spacing reads
  them. Compile equal-length Canvas spellings once on eligible plain Latin-1 paragraphs; slicing preserves emitted
  characters and one-byte/two-byte encoding. Normally two extra bytes per source unit, at most about three plus a small
  object. No compiled strings on inspected, segmented, SHY or all-nonzero-spacing paragraphs; general recipes remain.
- **Blink accepted cuts:** carry an already measured complete child width directly into its recursive call, within the
  same accepted unshrunk shaping window. Shrink/failure discards the carry. This removes duplicate questions without
  an answer table, new paragraph state or a changed cut.
- **Gecko dictionary work:** the existing preparation-local line-breaker owns four lazy locale machines, discarded after
  preparation; no text or returned-answer cache. Consume original-coordinate boundary arrays by cursor instead of
  copying/subtracting every remaining suffix. This removes quadratic boundary-copy growth.
- **Gecko language:** carry the raw inherited tag through the existing content events; canonicalize only at text
  leaves. Preparation no longer walks ancestors for each leaf. Empty tags still reset, closes restore the parent, and
  localized empty spans cause no new language or Canvas work. The unused ancestor-walk helper was removed.
  Long accumulated words use bounded UTF-16 conversion instead of an unbounded argument spread; ordinary words
  retain their path. Two million-unit multi-flow regressions and 126 full-flag comparisons protect this runtime fix.
- **WebKit growth:** append finished bidi splits once instead of repeatedly inserting into/moving the item and offset
  tails. Carry inherited language in the existing renderer traversal frame instead of walking ancestors for every leaf.
  Null inherits; an empty language remains an explicit reset. No cross-paragraph cache.

`DESIGN.md` describes the lifetimes and measuring contracts. Permanent regression tests protect the requested-output
boundary, Canvas encodings, dictionary answers/fresh preparations, bidi split metadata and inherited-language resets.

All-engine offline closure before the compact lab adapter: **25 gates in 212.7 s, exit 0**. Six strict
projects and **1,026 unit tests in 86 files** passed. All **393,964** recorded full predictions remained unchanged;
Gecko/WebKit Canvas questions were exact, and Blink changed repetition only. Plain and pure checks each covered all
393,964 browser/configuration observations with zero failures or skips. Plain mode deliberately omits diagnostic-only
questions; the full-prediction replay changed no first Canvas question. The two Blink replay children exit 3 for
accepted repetition/storage changes; the aggregate records their remaining tier-2 request rather than claiming it ran.
Evidence: `.artifacts/takeover-20260920/gates-takeover-complete.log` and the archived exact 25 selected logs in
`gates-takeover-complete.tar.gz`. Earlier closure/prototype reports remain archived historical evidence.

## Measured payoff and stopping

The focused headed Firefox 156 pair proved complete ordered Canvas questions/all numeric TextMetrics, segmentation
requests/answers and inspected/plain output equal before direct-native timing. All 192 cells recorded actual focused
and visible endpoints at screen DPR 2. Short Thai/Myanmar/Khmer preparations saved a modest, noisy
11.81/18.14/10.37 microseconds per message (2.58/3.81/4.37%). Native whole-boundary passes on long single SA ranges saved
11.63/3.985/3.795 ms (29.8/22.7/20.3%), all 36 pairs positive. Those boundary timings exclude Canvas and are not whole
message timings. Raw data: `.artifacts/bench/takeover-gecko-dictionary-native-v3-20260920/`.
[Portable reproduction](tools/GECKO-DICTIONARY-PAIR.md).

The headed Chrome 153 compiled-text pair used 2,000 mixed and 2,000 Latin chat messages, twelve alternating fresh
preparation pairs and six three-width resize pairs. Actual ordered question/settings/context/width-left-right triples
and complete plain materialized outputs at all four widths matched. Paired scratch ratios were 0.920/0.989;
resize ratios 0.977/1.016. Timing was noisy and power changed AC to battery, so these are scoped observations,
not a universal or maintained benchmark speedup. Own-JS/free-answer prototypes showed clearer savings; their numbers
exclude actual Canvas cost. Raw/native focus/power/source seals: `.artifacts/bench/takeover-blink-compiled-foreground-20260920/`.

WebKit public-preparation prototypes under Bun/JavaScriptCore removed large-input growth: repeated bidi split/tail
sizes 512/2,048/4,096 saved about 0.215/3.36/13.77 ms; deeply inherited language with 1,024 leaves and 64/256/1,024
ancestors saved 0.143/0.501/2.98 ms. Ordinary messages and a no-split control were within timing noise. These are
own-JS structural results, not Safari performance claims. Full metadata, break flags and output matched in 1,856
combined-prototype comparisons, with 105,136 ordered Canvas questions and 558 segmentation requests.

Gecko language preparation matched 261 inputs across five widths and both modes: 2,610 complete layouts, 65,886 lines
and 743,282 ordered Canvas questions/answers. Bun own-JS prototypes saved about 2.69 ms with 1,024 inherited ancestors
and leaves (ratio 0.176); shallow/mixed controls were neutral. Canonicalizing at span opens was rejected because it made
localized empty trees slower. These are structural measurements, not Firefox wall-time claims.

**Deferred coarse shaping:** doubling Blink's exact-leaf target to 512 zoomed px saved only about 12/17 microseconds
per mixed/Latin message in fresh preparation but added 44/51 across the tested three fresh widths. All twelve resize
pairs lost (47/60% slower): questions rose 11/16% and shaped units 76/104%, as fewer prefix anchors made cold queries
longer. Sampled complete outputs matched, but an odd raw16 rounding counterexample disproves unguarded exactness.
Intervals/refinement would add a precision contract and retained-line lifetime machinery without removing that query
length debt. Keep the 256 px exactness contract. Reopen with a representation addressing both precision and cold-prefix
cost; more coefficients or font-specific exceptions are not a foundation.
Native raw data: `.artifacts/bench/takeover-blink-coarse512-native-20260920/`; the full decision/counterexample is in
`prototypes/blink-candidates.tar.gz` under `.artifacts/takeover-20260920/`. Whole-group and other tiny scan prototypes were
also rejected or deferred with their evidence preserved.

Two further candidates stopped at prototype. Replacing only Blink diagnostic canonicalization with sorted interval union preserved 10,036 adversarial/randomized outputs, but canonicalization accounted for just 38.18 ms of a 4,693.62 ms giant inspected free-answer profile (0.81%); small and un-ranged inputs could slow down. Moving Gecko's original-unit-start return before eager windows preserved 300 targeted full-output comparisons and 6,000 ordinary message comparisons, but saved no questions or shaped units in the ordinary cohort and reordered some inspected questions. Neither warranted a core change on that cohort evidence. The 2026-09-21 general audit lands the original-start
guard after proving substantial unbreakable-word savings. The then-deferred canonical-only prototype was later
replaced by source-preserving raw accumulation and canonical union in the general-cost checkpoints. Exact proofs and stopping reports are archived as `prototypes/blink-canonical-deferred.tar.gz` and `prototypes/gecko-unit-start-deferred.tar.gz` under `.artifacts/takeover-20260920/`. These are scoped own-JS observations, not native wall-time claims.

## Acceptance and main requirements

Scorer 8 compares the complete native scorer view: collection lengths, point/node/element rects and slot floats.
Native geometry is validated before scoring: finite coordinates and nonnegative finite dimensions, with negative
positions and zero dimensions valid. A planted negative/JSON-null width previously hid an omitted glyph and passed;
it now makes certification inconclusive. The observer's source population is also required: one rect list per text
run, including empty runs, and one list per non-text inline node. Empty lists remain valid. Identical missing lists in all
six jobs formerly certified; real old/new CLI probes now reject them. Valid observations allocate no geometry-error descriptions.
Ledger format 3 separates actual native variation from prediction order dependence. Stable native targets with different
prediction metrics/exact values cannot acquire a browser-history exemption. Existing unstable entries retain per-order
pass/exact/error-count obligations; becoming consistently wrong cannot read as an improvement. New native variation
blocks prior obligations instead of silently retiring them. Planted asymmetry, omitted-letter, wrong-cut and process
failure tests demonstrate these checks.

Line-range diagnostics validate ordered disjoint integer ranges once and use indexed lookup instead of scanning every
predicted line for every native code point. Legacy overlapping, reordered or malformed ranges retain their original
first-match scan; failure descriptions are built only when stored. Complete diagnostics/errors matched in 24,000
randomized cases. Permanent regressions cover UTF-16 gaps/empty ranges, legacy lookup and 65,536-point coverage. In Bun
with synthetic geometry, a 269,000-point/4,484-line diagnostic fell from 441.8 to 11.8 ms. This is checker own CPU,
not browser or full-workflow speed. The independent complete-source evaluator uses the same indexed containment
lookup after its stricter validation; all 12,003 full-evaluation comparisons matched. Scorer 8 is unchanged; source
seals require renewed audits.

The native line grouper indexes each node's first matching box while building its existing centre IDs, removing another
O(points × lines) full-book scan. WebKit raw/truncated top aliases retain first-match order; NaN tops retain their
standalone fallback. Full output matched 20,000 randomized observations and 6,387 retained actual browser rows,
including a 106,857-point giant per browser. With synthetic geometry in Bun, grouping 269,000 points/4,484 boxes
fell from 699–859 ms to about 7.2 ms. These are checker CPU measurements, not browser or full-workflow timings.
The transient index lasts one grouping call. The original observer and all native rows remain unchanged.

Complete selected ledger runs now fail when expected reference cases disappear, including an empty run. Focused
subsets remain allowed. Actual old/new CLI comparisons reproduced the missing-case false green; one command-level
regression protects both boundaries.

Input content-box widths now match the browser's source-defined encoding, including fractional declarations and
Blink's final float32 client conversion. All 3,000 saved actual widths passed; all 3,000 planted one-unit defects were
blocked. Source-derived/emulated-unit tests are distinguished from actual installed-browser observations. No fitted
tolerance or predictor geometry determines the expected width. Glyph geometry and vertical positions remain outside
this source-cut tier.

Native workflows seal complete runtime trees, fonts, configuration, acceptance entries and inputs, including the
actual WebKit host executable. They verify after acquiring the lock and after all jobs/checking, including strict-red
and failed-child paths. Edits/additions/deletions and input drift block adoption; actual exits and diagnostics remain.
Twenty-five separate-process driver tests passed in 3.33 s before integration. Measure-first run documents and every raw row now require complete populations and exact document positions. Twenty-two actual old/new CLI probes reproduced metadata false greens; 40 focused checker/book/width tests and 397 assertions passed after the fix. Native-first controls and predict-only diagnostics remain distinct. Source snapshots detect persistent
concurrent edits, not transient edits reverted between snapshots.

Six existing ledgers were explicitly staged, reviewed and adopted from both saved orders. No predictions, Canvas rows,
input manifests or recording shards changed; **zero new native-history exclusions** were added. Firefox has one and
WebKit four previously misclassified prediction-order cases. Older Firefox seeds had already retired 3 no-facts/296
facts pairs through witnessed native history; the migration records that inherited debt explicitly. Adoption seals:
`.artifacts/tests/migrations/takeover-20260920/adoption.json`. Known native exclusions are not general predictor waivers.

The independent raw-source audit evaluated every historical main visible-pass label in the original twelve chunks:

| Browser | Historical labels | Verified original native passes | Refuted | Inconclusive |
|---|---:|---:|---:|---:|
| Chrome | 159,163 | 157,643 | 678 | 842 |
| Firefox | 175,488 | 175,480 | 8 | 0 |
| WebKit | 167,722 | 167,674 | 48 | 0 |

All 502,373 labels stay catalogued; **500,797** are certified requirements. Verification checks complete unambiguous
visible source coverage independently of redo outcomes/gaps. A native-only same-node SHY duplicate-report rule retains
the following glyph's actual placement; unmatched/report-only multi-line placement stays inconclusive. An original
single-order observation is not a current stability certificate. Scope is explicit; separate long-form coverage follows
below. The catalog/generator/audit seals are under `.artifacts/tests/main-native/takeover-certified-compact-final-20260920/` and
`.artifacts/takeover-20260920/main-audit-compact-final/`; preserve the original staging catalogs they reference.

The fast sample selects 1,000 certified requirements per browser by input features, seed and cost, never redo success.
It covers all eligible families/marginal tokens; Chrome's two historical-only start-control families have no certified
original passes and remain visible. Marginal coverage does not cover every combination or threshold. The native workflow
runs fresh inspected/plain preparations in both orders, with optional diagnostic main comparisons and honest child exits.
Active native workflows hold the maintained browser lock directly and do not depend on an untracked artifact scheduler.
With those two extra main jobs, measured workflow times were **17.8/21.8/9.0 seconds** for Chrome/Firefox/WebKit.
Without them it runs four native jobs. Ten driver tests took 0.70 s; the original all-engine quick check took 180.6 s.

The earlier fresh certified run, before the final protocol tightening: Chrome 999 passes/1 stable failure; Firefox 952 passes/1 stable failure/47 reviews
(44 native variations and 3 main-only prediction-order changes); WebKit 998 passes/2 failures with actual reverse-native
variation. All strict workflows correctly exit 1. Plain/inspected parity losses and unexpected rows were zero. These
results establish neither exact widths/positions/painter accuracy nor a fresh 500,797-case sweep.
Raw rows, completed run records, input/bundle/environment seals and reports:
`.artifacts/tests/main-native-runs/takeover-certified-20260920/`.

All six audits were actually renewed again after the compact-adapter and plain-role guard integration. The final scorer, evaluator and auditor give identical classifications and fast/full required-case bytes to the prior certificates. `.artifacts/takeover-20260920/compact-final-audits.json` records all six executions and comparisons; source hashes are in their sealed audit manifests.

## Maintained suites and additional texts

The no-facts frozen references contain all 7,680 maintained accuracy cases per browser, each passing line count, and
the applicable compact keep-all, symbol, pre-wrap, letter-spacing, discretionary and filed families. The certified chunk
set is stricter than the old height-only accuracy criterion: it does not certify 517/519/512 of those existing line-count
passes for Chrome/Firefox/WebKit as complete visible-cut passes. Their line-count requirement remains protected by
replay. Do not claim the certified native tier alone covers every existing main metric.

A separate application-text audit certifies 4,679/4,628/4,679 original passes, with zero refuted/inconclusive labels. Its
64-input supplements cover all 89 eligible marginal tokens, independent of redo outcomes. Catalogs and audits are
`.artifacts/tests/main-native/takeover-real-text-certified-compact-final-20260920/` and
`.artifacts/takeover-20260920/main-audit-real-text-compact-final/`; fresh opposing-order reports are in
`.artifacts/tests/main-native-runs/takeover-real-text-20260920/`. All three supplements passed 64/64 fresh requirements,
zero native variation/order/parity issues, strict exit 0; four native jobs plus check took 9.4/13.5/4.5 s. The final checker revalidated those unchanged own-native rows: all three remain 64/64, exit 0. These saved-row rechecks are `.artifacts/takeover-20260920/final-real-text-saved-*.json`, not new browser observations.

Original long-form corpus coverage is only 47 reference cases per browser and excludes the >50,000-unit giants. The
chunk audit does not include the 1,098 separate original corpus cases. Corpus00–04 contain two Arabic books,
05–07 a long English book, and 08–10 fourteen smaller texts. Existing WebKit corpus04 is incomplete; the apparent
04a/06a/07a replacements are failed partial runs with mismatched inputs, not evidence of completeness. They cannot
be silently reconstructed as successful original sources. Imported corpus sampling now validates exact raw paragraph
shape and mandates a representative for each eligible text SHA256, in addition to family/font coverage.

An independent required-membership inventory counts 7,803 merged identities representing 7,807 original aliases.
Every applicable identity is present and passing its frozen line-count requirement: 7,799 Chrome, 7,755 Firefox and
7,802 WebKit. Evidence is `.artifacts/takeover-20260920/required-roster/`. This proves membership/stored status,
not preservation of the original height tolerance, preparation locale, Range/span extractor or rich public API contract. Of these, 7,275/7,229/7,279 additionally have independent visible/count certificates. The remaining 524/526/523 retain count protection; 512 per browser are empty-text accuracy cases with no visible cuts.

The new [book survey](tests/BOOK_SURVEY.md) selects every entire maintained text at both original endpoint widths,
with raw and exact maintained-normalized paragraphs recorded separately. It validates all 1,098 original input cases
before selecting 72 predetermined paragraphs (about 3.3 million UTF-16 units). Requirements derive from main's own
native full-source visible/count passes in both orders, independently of redo outcomes. Actual default-locale public
count/height instrumentation and the original raw-prepared/normalized-painted height criterion stay separate. A
height-only main pass cannot silently become a source-cut certificate. Wrong observed widths, truncated scalar
observations, unavailable geometry and native variation block acceptance. All three completed workflows close with source verification and exit 0. The survey preserves installed-font contexts and the complete maintained CSS fallback stacks. Missing-family diagnostics check every named stack alternative; they do not identify the selected face or establish coverage of unavailable Noto/CJK alternatives. Loading fixture fonts here would change the original contract.

Firefox's completed endpoint survey passes all 72 redo/plain own-source count and visible-cut cases in both orders;
main supplies 37 strong requirements, with 35 main misses retained visibly. Main and redo each pass 29/36 of the
original mixed-source height comparisons, but only 22 passing pairs overlap. Seven main-only Japanese/Chinese
passes conceal actual raw-source public count errors: main matches the normalized native count while exceeding
the raw paragraph's stable native count by 1–7 lines. Gecko's documented East Asian LF transformation explains
this difference. The equal aggregate totals do not establish equivalent passing cases. Another seven main legacy
height passes have correct raw counts but wrong visible cuts. The [book survey](tests/BOOK_SURVEY.md) records the
exact pairs and keeps that original height diagnostic separate; this endpoint supplement does not certify every
inherited wrapping contract or the full 1,098-point canary sweep.

## Focused workflow and completed book results

The focused `inspected-ranges-predictor.ts` runs the unchanged complete facts-free inspected core and returns its
contentful source ranges and measurement-call count. It omits lab expected-observation generation, limits and painting.
Full geometry suites retain `no-facts-predictor.ts`. Sixty-four fresh stand-in comparisons preserve projected output
and every ordered prediction-phase configuration/question/all-numeric-metrics answer, including 5,903,334 questions on
the actual 256,837-unit Arabic text. These are dataflow proofs, not native timings. WebKit's omitted observation port
asks additional Canvas questions, so fresh own-native captures were required under this distinct focused protocol.

Those final four-job captures now exist for all three browsers. Every native child exits 0; all strict checks/workflows
exit 1 and remain non-adoptable as acceptance certificates. No new core miss, predictor-order change, mode-parity loss,
inconclusive case or unexpected row appeared. The standalone checker also rejects inspected rows relabelled as plain:
two old/new CLI probes reproduce and close that false claim, while genuine plain and diagnostic/control modes remain.

| Browser | Fast pass | Stable/core or reverse-native failures | Native-variation reviews | Workflow seconds |
|---|---:|---:|---:|---:|
| Chrome | 999 | 1 stable core miss | 0 | 16.2 |
| Firefox | 951 | 1 stable core miss | 48 | 15.7 |
| WebKit | 998 | 2 reverse-native cut changes | 0 (2 failures also vary) | 7.7 |

All 48 Firefox reviews pass their own count/cuts; full native geometry varies. The earlier four-job full-adapter run
also observed these 48, rather than only the 44 in the older main-diagnostic run. These are accuracy-workflow durations,
not core benchmarks. Main diagnostics were not supplied here; zero `mainBaselineFailed` is not a fresh main-pass result.
Final rows/reports/source-verified workflow records: `.artifacts/tests/main-native-runs/takeover-compact-final-20260920/`.
The old WebKit fast launcher did not run after its explicit 30-minute book wait bound; that orchestration failure is
preserved in `final-fast-wait-status.json`, not counted as a browser result. The new focused capture covers all three.

| Browser | Strong own-main book requirements retained | Stable main misses retained | Redo/plain own-source passes |
|---|---:|---:|---:|
| Chrome | 64 | 8 | 72/72, both orders |
| Firefox | 37 | 35 | 72/72, both orders |
| WebKit | 68 | 4 | 72/72, both orders |

All 216 whole-book inputs pass candidate/plain count and complete visible cuts in both orders, retaining all 169
independent main requirements. There are zero book native variations, reviews, inconclusive cases or mode/order losses.
The captures used the full NoFacts adapter before the lab simplification; they are not fresh compact book captures.
The final checker rechecks these unchanged rows with identical outcomes under `book-survey-saved-final/` in
`.artifacts/takeover-20260920/`. Application-text saved rechecks also remain 64/64 in every browser under
`compact-final-real-text-saved-*.json`. Neither saved recheck is a new native observation.

The old WebKit forward diagnostic sums were about 1.6 s core prediction, 355 s native extraction, 255 s expected
observation and 69 s painting/paint observation. The adapter removes those last lab phases and their retained payload;
it does not accelerate native extraction. An actual Chrome Arabic row projects from 66.6 MB to 11.1 MB while retaining
its 10.8 MB native observation. These are old phase totals and an artifact projection, not a measured new book speedup.
Do not blindly repeat the costly whole-book capture for a lab-only projection: unchanged core traces, fresh focused
native checks and retained full captures justify that scoped reuse. A future core or observer change needs its own proof.

The exact completed book reports, six WebKit phase sums and provenance are archived in
`prototypes/book-final-proof.tar.gz`; final compact reports, audits and saved checks are in
`prototypes/compact-final-proof.tar.gz`. Final all-engine offline closure is recorded in
`.artifacts/takeover-20260920/gates-takeover-final.log`; the selected gate logs are archived separately. The core remains
unchanged from the preceding 393,964-output closure, and acceptance tightening cannot make a genuine miss pass.

## Open foundation and environment issues

- Chrome `c-d0c13fd8c7aca939`: Arial 16, letter spacing 1, lam-alef text `لألالإلآ`. Stable native four lines, redo/plain
  three. Font glyph clusters cannot be inferred from default grapheme boundaries. Assuming all lam/alef pairs merge fixes
  Arial but breaks Amiri/Noto Arabic fonts; do not land that shortcut. The compact regression checks true visible cuts
  without relying on inspection or diagnostic gaps.
- Firefox `c-4e2eb3330e0edd98`: Amiri Arabic/SHY/form-feed, stable native three lines, redo/plain four. The joined-prefix
  advance differs; a form-feed special case would repair a symptom. Existing contextual-prefix/optical limitations
  remain visible. Main's visible pass is a requirement, not evidence that its widths are exact.
- WebKit `c-a952a6005f24147c` and `c-b680273a18a11dd9`: unchanged predictions match original and fresh forward native;
  reverse native moves a guillemet or Latin character onto another line. Both modes reproduce it. Keep the actual
  differing targets and strict failures visible; no automatic history waiver or port precision diagnosis.
- Firefox native variation and main-only prediction-order differences remain review items. The runtime protocol is part
  of the test evidence. Neither main diagnostics nor known gaps can withdraw a genuine requirement.

Large recorded replays, direct-native protocol/output proofs, targeted browser sets and native encoding checks justify
skipping an indiscriminate 94,571-case tier-2 rerun requested by the conservative storage/repeat file rule. The recorded full-prediction replay changed no first
question; plain preparation explicitly drops diagnostic-only work. That request is retained in the offline report; it was not silently marked completed. Full installed
Safari, exhaustive interactions and fresh all-main-obligation sweeps remain larger follow-ups when a concrete question
needs them. No new public feature, cache surface, font heuristic or compiler upgrade was introduced.
