## Development Setup

Install once:

```sh
bun install
```

### Day-To-Day

- `bun start` — stable local page server at <http://localhost:3000>
- `bun run start:windows` — Windows-friendly fallback without automatic port cleanup
- `bun run check` — typecheck, lint, dead-code scan (`knip`) and a check that the generated engine break data is current
- `bun test` — the unit tests, the harness's offline tests and the demo models' tests

### Harness

The harness in `harness/` keeps each browser's layout of every case in git, recorded once per browser build, and
predicts every case in the browser the way an app does. See [harness/README.md](harness/README.md) for how a case is
judged, the case sets and the pinned browsers.

- `bun test harness` — the harness's offline tests, each planting a fault it exists to catch, and the line APIs'
  invariants in four engine profiles on cases drawn from the case files (`harness/invariants.ts`)
- `bun harness check` — predict every pinned case in Chrome, Firefox and webkit-host and score it; a failure that
  `harness/accepted/<browser>.txt` doesn't list under a written reason blocks, and `--accept="<reason>"` lists the new ones
- `bun harness gate` — `check`, plus predictions in reverse order, a fresh recording of 1,000 cases and the attribution
  of new failures
- `bun harness equal main` — whether `main`'s build, its `src/` and the harness adapter that predicts with it, predicts
  what this tree's does on every case: the same lines, widths and line text, line APIs' disagreements and Canvas calls
  after preparing; it prints each case file's `measureText` calls and submitted units, here against there. `--offline`
  compares the two `src/` on a stand-in Canvas in four engine profiles in about 10 s, before any browser time
- `bun harness repin chrome` (also `firefox`, `safari`) — the first thing to run when you come back to the project: pin
  the installed Chrome or Firefox as a copy named by its version (Safari can't be pinned, so webkit-host and installed
  Safari are recorded as the system has them), record every case into a scratch copy of the recordings, and print the
  cases the new build lays out otherwise, the page history it changes and whether its break data is still
  `scripts/engine-data`'s; `--write` replaces the recordings and the pin, for a commit of its own
- `bun harness record --only-new` — record new cases; `bun harness record` records every case again
- `bun harness bench main` — time `main`'s `src/` against this tree's in the same documents, in pinned Chrome and
  Firefox and installed Safari in the foreground, 3 sessions, about 4-5 minutes per browser; `--rows=new,worst` narrows
  it while iterating, and `--background` runs the background browsers, whose results are hypotheses
  ([harness/README.md](harness/README.md), Bench)
- `bun harness explain <id>` — one case's recorded lines against the predicted ones; `bun harness explain --text='...'
  --width=120.5 --font='16px Arial'` (also `--lang=`, `--white-space=pre-wrap`, `--word-break=keep-all`,
  `--letter-spacing=`) or `--cases=<file of one case>` records that paragraph alone in a fresh document first, in any
  of the four browsers, and keeps nothing

Background harness jobs may run side by side, each in its own instance of a pinned browser or webkit-host, while free
plus inactive memory stays above about 30%. Installed Safari takes one job at a time, and the bench runs alone in the
foreground.

### Packaging And Release

- `bun run build:package` — emit `dist/` for the published ESM package
- `bun run package-smoke-test` — pack the tarball and verify temporary JS + TS consumers
- `bun run site:build` — build the static demo site into `site/`
- `bun run generate:engine-break-data` — refresh Chrome's, Safari's and Firefox's checked-in break and grapheme tables from the engine files in `scripts/engine-data/`, checking each table against its source; `--check` compares the generated file instead of writing it. After refreshing a grapheme table, run the grapheme check in each browser (below).
- `bun run generate:webkit-generic-families` — refresh the families Safari draws `serif`, `sans-serif`, `cursive`, `fantasy` and `monospace` in under each page language, from WebKit's language-to-script map and Core Text's answers on macOS and iOS in `scripts/engine-data/safari-27.0/`; `--check` compares instead of writing

### Grapheme Check

- `bun scripts/grapheme-check/build.ts`, then `bun scripts/grapheme-check/run.ts --browser=chrome` — compare `src/graphemes.ts` with the browser's own `Intl.Segmenter` on every code point in contexts that tell the grapheme classes apart, the harness's case texts with their prepared segments, and random strings, under the table the engine profile takes and the other one; also `firefox` and `webkit-host`, in the harness's background browsers, side by side like other background harness jobs. `ENGINE=webkit bun scripts/grapheme-check/offline.ts` runs it under Bun. Node can't load `src/` directly, so bundle it with `bun build --target=node scripts/grapheme-check/offline.ts --outfile=.artifacts/grapheme-check/offline.mjs` and run `ENGINE=blink node .artifacts/grapheme-check/offline.mjs`.

### Benchmarking

Speed claims rest on `bun harness bench` (above): each document times a base's `src/` and this tree's, with a second
copy of the base as the control, and the PR pastes its table. Nothing timed is checked in. Each row's noise floor is in
`harness/bench/report.ts`, with the date, builds, machine and device pixel ratio it was calibrated on; calibrate again
after a browser pin bump or on another machine ([harness/README.md](harness/README.md), Bench).

## Useful Pages

- `/demos` — index of the public demos; `/` redirects there

## Deep Profiling

For one-off performance and memory work, start with `bun start` and an isolated, foreground Chrome using a throwaway profile. Reproduce the issue in a bench row ([harness/bench/texts.ts](harness/bench/texts.ts)), or on a smaller dedicated page when the bench is too broad.

Bun/Node microbenchmarks are useful for quick experiments, but browser behavior needs browser measurements.

For algorithmic changes, scale both source length and the number of segments,
forced lines and rich items. Include repeated punctuation,
Arabic joins, CJK keep-all, long hyphenated URLs and internal whitespace runs.
Count visited boundaries and submitted Canvas text, with cold caches, before
relying on timings; doubling an input should not quadruple repeated work.
The history and current bounds are recorded in [RESEARCH.md](RESEARCH.md).
