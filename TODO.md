Current priorities:

1. Keep the canaries honest

- Mixed app text still has the extractor-sensitive `710px` soft-hyphen miss.
- Chinese is still the clearest active CJK canary: Safari anchors are clean, while Chrome keeps a broader narrow-width positive field with real font sensitivity.
- Myanmar and Urdu remain useful shaping/context canaries, but they are not the active tuning target right now.

2. Next engine work

- Use the split `analyze()` / `measure()` benchmark rows to steer any remaining `prepare()` work, and use the chunk-heavy rich benchmark rows to steer `layoutNextLine()` work, instead of reopening generic profiling.
- Use the synthetic long-breakable-run canary to steer any Safari prefix-width work; naive cache-space cleanups there can trade retained heap for meaningfully slower `prepare()`.
- Expand mixed app text only when it adds a real product-shaped class, e.g. URL/query runs, mixed bidi with numbers, emoji ZWJ runs, or `NBSP` / `ZWSP` / `WJ` behavior.
- Broaden canaries only when the source text is clean.
- If we add another Southeast Asian canary, prefer a clean source text that broadens the class instead of another wrapped/legal/raw-source artifact.
- Expand the sampled font matrix only where a canary still looks genuinely imperfect.
- Treat strongly font-sensitive or shaping-sensitive misses as boundary-finding for the current architecture, not automatic invitations for another local glue rule.
- Keep the hot `layout()` path simple and allocation-light while the rich path absorbs more userland layout needs.
- If chunk-heavy manual layout keeps growing, consider a stateful streaming variant or a cursor-carried chunk hint so sequential `layoutNextLine()` flows can stay overall linear instead of paying a lookup per emitted line.
- If arbitrary interior rich cursors become common, consider a compact `segmentIndex -> chunkIndex` side table, ideally only on rich prepared handles or only when `chunks.length > 1`.

3. Demo work

- Keep the editorial demos as the dogfood path for the rich line APIs.
- Prefer `layoutNextLine()` / `walkLineRanges()` when a demo is really about streaming or obstacle-aware layout.
- Add a new demo only if it exposes something the current editorial demos do not already cover.

Not worth doing right now:

- Do not chase universal exactness as the product claim.
- Do not put measurement back in `layout()`.
- Do not resurrect dirty corpora just to cover another language.
- Do not overfit one-line misses in one browser/corpus without broader evidence.
- Do not let browser-profile shims turn into a grab bag of ad hoc engine knobs.
- Do not explode the public API with cache or engine knobs.

Still-open design questions:

- Whether line-fit tolerance should stay as a browser shim or move toward runtime calibration.
- Whether `{ whiteSpace: 'pre-wrap' }` should grow beyond spaces / tabs / `\n`.
- Whether strong real-world demand for `system-ui` would justify a narrow prepare-time DOM fallback.
- Whether server canvas support should become an explicit supported backend.
- Whether automatic hyphenation beyond manual soft hyphen is in scope.
- Whether intrinsic sizing / logical width APIs are needed beyond fixed-width height prediction.
- Whether bidi rendering concerns like selection and copy/paste belong here or stay out of scope.
- Whether a separate optional slow verify path is worth having as a diagnostic mode, without contaminating `layout()`.
