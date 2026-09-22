# Gecko adjacent endpoint reuse

Integrated engineering change, 2026-09-22, based on `198193903861127670cd3f246f2cb1d8b65c12aa`.
The isolated checkout is `/private/tmp/pretext-round3-gecko`; the frozen reference is
`/private/tmp/pretext-stateless-round3-baseline-20260922`. The accepted runtime is integrated into actual redo; public main remains unchanged.
The complete final proof/native/screening scope is in [STATELESS_ROUND3.md](../../STATELESS_ROUND3.md).

`breakAndMeasureText` now carries the resolved end of the previous pending interval within one traversal. The next
adjacent interval reuses that endpoint instead of repeating `scanOffset`, group/window lookup and `advanceBefore` for
its start. The local closure fixes the Provider/from/to bounds and ends with the traversal; a new frame, changed bounds
or redo creates fresh locals. No retained width cache or width-monotonicity assumption was added.

The first interval still discovers its end before its start. Each end/start consultation preserves its original order,
offset and stand-in duplicate. Arithmetic remains `end - start + spacing + tabs`; trimming keeps arbitrary-range
`scanAdvance`, and final fitted range measurement keeps `rangeAdvance`'s partial ligature shares. Full and range outputs
continue to share one break algorithm. Painting records and measurement recipes were not changed.

## Evidence

Full and range ordered-question proofs both pass against the frozen reference: 86 cases, 1,818 rows, 9,114 layouts and
66,220 lines each, with stable source/helper seals and no observable output or Canvas-event drift. Six controls add
overlapping ffi/fff candidates, frame bounds inside groups, soft hyphens, Arabic signed tracking, preserved tabs and
span/object rewinds. The explicit `gecko-endpoint-proof.ts` diagnostic compares complete inspection's consulted-offset
sequences and duplicates over reordered retained widths and float refusal/retry: six cases pass, including 1,317
consultations and 660 repeated offsets. The captured cross-tree test version and its original 47-pass focused log remain
available in `rejected/gecko-endpoint-captured-cross-tree.test.ts.txt` and `focused-tests.txt`.

Maintained test discovery now uses a self-contained `gecko-endpoint.test.ts` with five small fixed cut/consultation
controls captured from the frozen baseline, plus a warm owned-read budget. It has no external checkout dependency.
The original implementation passes all five semantic controls and fails exactly the read budget (2,247 > 1,600); the
current implementation reads 1,485 entries. The new complete focused run passes 46 tests in `focused-tests-standalone.txt`, and the
planted original-implementation rejection is retained in `baseline-counterexample.txt`. Both TypeScript projects pass
`--noEmit`; there are no JavaScript runtime sidecars under `rebuild/src`.

The counter wraps indexed reads of the existing owned source maps and retained unit/window/offset tables after warming
the same widths. Inputs match the performance probe's ASCII contract: four identical `abcd` texts at each length,
16px `"Helvetica Neue"`, normal whitespace/word breaking, overflow-wrap break-word, zero spacing, en/LTR, widths
24/36/48. The controlled backend yields 1,948 lines at length 512 in both full and range; this is not the native probe's
2,120-line population. Both versions make zero Canvas calls during counted warm filling.

| ASCII512 range indexed reads | Reference | Integrated | Reduction |
| --- | ---: | ---: | ---: |
| Source-to-unit map | 36,180 | 23,916 | 33.90% |
| Units | 36,180 | 23,916 | 33.90% |
| Retained windows | 216,864 | 143,280 | 33.93% |
| Retained offsets | 48,604 | 31,324 | 35.55% |
| Cluster flags | 39,308 | 27,416 | 30.25% |

The 64/128/256 controls and all six difficult controls also reduce counted reads with equal cuts and Canvas counts.
These are observed lookup reductions, not allocation, memory, browser accuracy or speed results. The counter reports
stable before/after source and helper seals in `/private/tmp/pretext-round3-gecko/counters.json`. Proofs are
`proof-full.json` and `proof-range.json`; their captured source/helper versions were not overwritten by the test routing
change. `frozen-controls.json` records the small baseline capture used to write the standalone expected values.

No engine version was rejected. The first new test harness omitted the engine prepare function's required ContextPool;
its rejected version is retained in `rejected/gecko-endpoint-missing-context-pool.test.ts.txt` outside source. The fixed
harness supplies each tree's own pool. The earlier mixed-font counter capture is retained as `counters-mixed-font.json`.

## Commands

```sh
bun rebuild/experiments/plaintext-round/compare.ts --base=/private/tmp/pretext-stateless-round3-baseline-20260922 --engines=gecko --read=full --out=/private/tmp/pretext-round3-gecko/proof-full.json
bun rebuild/experiments/plaintext-round/compare.ts --base=/private/tmp/pretext-stateless-round3-baseline-20260922 --engines=gecko --read=range --out=/private/tmp/pretext-round3-gecko/proof-range.json
bun rebuild/experiments/plaintext-round/gecko-endpoint-proof.ts /private/tmp/pretext-stateless-round3-baseline-20260922
bun test rebuild/experiments/plaintext-round/gecko-endpoint.test.ts rebuild/experiments/plaintext-round/gecko-range.test.ts rebuild/src/engines/gecko/windows.test.ts rebuild/src/engines/gecko/windows-reversed.test.ts rebuild/src/engines/gecko/ordered-access.test.ts
bunx tsc -p rebuild/experiments/plaintext-round/tsconfig.json --noEmit
bunx tsc -p rebuild/tsconfig.json --noEmit
bun rebuild/experiments/plaintext-round/gecko-endpoint-counter.ts /private/tmp/pretext-stateless-round3-baseline-20260922 /private/tmp/pretext-round3-gecko/counters.json
```

The original captured cross-tree check used the same `bun test ...gecko-endpoint.test.ts ...` focused command above
before the external-reference test was turned into the explicit diagnostic driver. The archived version preserves that
command's exact source; normal test discovery uses only the new standalone version.

The foreground Firefox screening pair supports retention: ordinary full repeats save about 11–31%, and the ASCII 512
range control saves about 19%. Complete maintained reports and fresh native cuts/scored outcomes remain unchanged.
The subsequent complete foreground phase matrix confirms ordinary repeat gains and mixed new-width costs. The earlier
screening samples remain distinct and do not themselves time preparation or unfamiliar widths. Exact isolated sources and the earlier local proof/counter captures are preserved under
`.artifacts/plaintext-round3-20260922/isolated-studies/`; final integrated audits are under `final-audit/`.
The earlier commands and paths above describe the preserved isolated capture, not an additional active checkout queue.
