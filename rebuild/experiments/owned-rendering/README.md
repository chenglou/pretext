# Owned-rendering experiment: replacement rejected

2026-09-21. This directory is a bounded prototype, not a new public API or the next implementation plan. Main and the redo engine remain unchanged. `codex/owned-rendering-backup-20260921` preserves the redo branch before this experiment.

The fixed-word design is rejected as a general replacement. Do not optimize or benchmark it as though it performs main's required work. Independently positioned fragments and a shared wrapping algorithm remain separate ideas; these failures do not disprove either.

## Capability before speed

Critical small cases with the same deterministic 10px character backend:

| Input | Main | Current prototype | Judgment |
| --- | --- | --- | --- |
| `hello`, 20px container | `he / ll / o` | One overflowing 50px word | Serious missing ordinary emergency wrapping. |
| `سلام`, 20px container | Two 20px lines | One overflowing 40px word | Serious missing word splitting; glyph correctness is not established by this backend. |
| Rich items `س` and `لام`, different font weights, 40px container | Accepted | Rejected by the contextual-word policy | Lost accepted input. Main's acceptance does not prove accurate widths or joining in every font. |
| `a` with 12px ordinary item padding, at ample width | 22px occupied width | 10px occupied width | Required padding silently omitted. |
| Selected soft-hyphen break in `ab\u00ADcd`, at 30px | Visible `ab-`, 30px | Invisible hyphen retained, 20px | Required hyphen painting and width omitted. |

`capability-check.ts` compares 21 cases at 78 width observations against the actual main APIs. Eight backend sanity
checks verify the controlled measurements. Cases include whitespace, bidi controls, grapheme-safe script edges, atoms,
soft hyphens, zero-width breaks and no-break glue. Its stand-in backend checks source consumption, breaks and item-width
semantics, not browser glyph correctness. Five declared critical checks permit different chosen cuts and oversized single graphemes, but fail on omitted work.
The command exits 1 for this prototype. A failed capability check is the expected outcome of this rejected prototype, not a waived acceptance gate. Run it before any speed comparison:

```sh
bun rebuild/experiments/owned-rendering/capability-check.ts
```

The [committed summary](capability-summary.json) preserves the five failures, backend checks and listed-file hashes.
The full 78-row report is retained under `.artifacts/owned-rendering/20260921-capability/`; rerunning the command
reproduces it against the sibling main checkout. The listed-file source seal is not a claim that every dependency was
hashed.

Supplied edges inside graphemes are outside the agreed input contract. Routine word overflow, lost readable joining,
and broad language or valid-style restrictions are not acceptable default tradeoffs. An explicitly unbreakable item
may overflow, as in main. Flat input itself is not a loss: main's rich API is already flat. Padding, borders and
decorations have not been dropped from the requirements. Different breaks from an untouched native paragraph are
allowed for owned rendering.

Main is an empirical baseline. It already measures rich items separately while the demos paint ordinary inline
spans. The recorded Myanmar `ဘာသ|ာသည်` measurements total 91.80px separately but occupy 82.03px joined. Preserving
that erroneous width is not a requirement (`RESEARCH.md`, rich-inline item boundaries). Smaller kerning, ligature or
position differences can be worthwhile tradeoffs, assessed with concrete inputs and actual painting.

## Candidate decisions

Padding and selected soft-hyphen handling are straightforward omissions: keep item chrome and discretionary break
kinds in the data model, charge chrome on each emitted fragment, and measure the visible hyphen at preparation. They
do not justify a new font shaper or larger substring tables. Style grouping is another local repair for compatible
fonts. Emergency cuts with arbitrary font shaping are the unresolved cost question. Judge that necessary work before
repairing every edge case of this prototype.

- **Discard this fixed-word replacement.** Omitting emergency splitting affects Latin too; it is not a narrow complex-font exception. The existing tests that expect overflow describe the prototype, not adequate library behavior.
- **Retain only as evidence:** the reusable full-paragraph bidi adapter, numeric walk and positioned painter demonstrate fixed-fragment ownership. They are not evidence of broad capability or a speed win.
- **Cheap repair to test separately:** compatible same-font/same-spacing parts of a word can form one measured shaping group with ordinary styled/link children. Input stays flat. Child positions inside the group belong to the browser. Current merged painting variants erase item identity and do not validate those nested children. Safari has recorded small group-width differences, so one-string Canvas measurement is not a universal equality proof.
- **Bounded next emergency-wrap probe:** use main-like grapheme/pair estimates, then measure the selected complete shaped fragments. Check actual overflow, readability, preparation, fresh widths and narrow difficult inputs before expanding it. This adds width-dependent measurement; it does not preserve the current numeric-only resize promise. Stop if that work defeats main's costs.
- **Discard eager arbitrary-substring widths.** For n graphemes, all substrings require O(n²) questions and O(n³) submitted text in the no-reuse case. Growing prefix/suffix measurements submit O(n²) text and do not provide exact arbitrary interior-fragment widths through subtraction.
- **Discard independently painted graphemes as a general repair.** Their advances become easy only by removing within-word shaping. Disconnected Arabic and broken complex syllables are readability failures.
- **Arabic font changes:** matching Unicode-directed joiners in measurement and painting are a small candidate, not a solved contract. They need glyph and copied-text checks; they do not repair Myanmar/Indic syllable cuts. Do not infer glyph shares or create font-name patches.

[`measurement-accounting.ts`](measurement-accounting.ts) exercises main's actual helper, with fresh caches per case;
[`measurement-accounting.jsonl`](measurement-accounting.jsonl) preserves its 15 output rows. Repeated strings still
reuse measurements within a case. For 96 alternating A/V letters, sum/pair/prefix modes submit 98/102/4,656 UTF-16
units in 3/5/96 calls. At 1,000 letters, prefix mode falls back to pairs and submits 1,006 units in five calls; its loops
and retained advance arrays still grow with the source. These are measurement accounting, not browser timings.

```sh
bun rebuild/experiments/owned-rendering/measurement-accounting.ts
```

Main's measurement helper already caps growing-prefix fitting at 96 graphemes and uses pair context beyond that.
Its cheap numeric walker has known approximation limits. A new design must show a practical gain over that actual
baseline instead of trading away routine behavior to produce a smaller timing.

## Native evidence and limits

The v1 Chrome and Firefox foreground validation captures retain source seals, fixed-fragment advances, positions,
baselines and logical Range text under `.artifacts/owned-rendering/20260921-{chrome,firefox}-v1/`. They expose within-
fragment Canvas/DOM differences, including emoji fallback and tracking. Safari v1 lost final focus and remains
exploratory evidence, not a valid foreground result. None includes performance timings. The captures retain reported
source hashes and painted HTML; the original complete v1 driver was not separately archived before later edits. They
are retained diagnostics, not certification of the current files.

The later `measure.ts` corrections and the raw/wrapped/HTML/SVG diagnostics have not had fresh native validation.
They are provisional research, not established fixes. `run.ts` blocks timing mode before acquiring a lock or launching a browser; validation remains available. The benchmark generator also marks code parts atomic, whereas
main's Markdown demo wraps code spans normally and makes image chips unbreakable. Those populations do not establish
realistic demo feature parity.

No main or redo runtime source, package exports, public demo, canonical benchmark or accuracy snapshot changes here.
Native-flow plaintext prediction remains separate. A next implementation must preserve required source and rich-item
behavior first, then report preparation and resize costs separately, including difficult growth cases and all omitted
work.
