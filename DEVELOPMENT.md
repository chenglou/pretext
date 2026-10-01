# Development

Commands are in `package.json` and the header of `harness/cli.ts`; the harness and the bench are in [harness/README.md](harness/README.md).

## Setup And Checks

Run `bun install` in a fresh checkout or worktree. `bun test` runs the unit tests, the harness's offline tests and the doc citation check, and `bun run check` the type check, lint, unused-code check and a check that the generated tables match their sources; both run without a browser. The browser harness needs pinned browser copies and webkit-host built first ([harness/README.md](harness/README.md), Setup).

## The Demo Server

`bun start` listens on every network interface, not only localhost, so a phone on the same Wi-Fi can open the demos; a PR binding it to localhost was closed for that (#114). It first kills whatever listens on port 3000, so a server left running from before can't hold the port.

## Engine Data

The break and grapheme tables (`src/generated/engine-break-data.ts`) are refreshed by hand, never in a build step: each must be the copy one browser build ships, and copies drift (Chromium 147's `line_normal.brk` differs from 153's on 239 code points, 2026-09-16). `bun harness repin` says when a browser no longer holds the bytes in `scripts/engine-data/`; then refresh that folder as the header of `scripts/generate-engine-break-data.ts` describes, run `bun run generate:engine-break-data`, then the grapheme check. Safari's generic-family table (`src/generated/webkit-generic-families.ts`: which font each generic family, such as `sans-serif`, names under each page language) comes from Core Text's answers dumped on one macOS and iOS release (`scripts/generate-webkit-generic-families.ts`, run by `bun run generate:webkit-generic-families`, says how they were taken); nothing checks it against a newer macOS or iOS but a new dump.

The engine files stay checked in so the tables rebuild offline, and so does the 30 MB behavior catalog (`harness/cases/catalog.ndjson`): its widths came from bisecting in the browsers, so it can't be made again offline, and deleting it wouldn't shrink the repository, since git history keeps it.

### Grapheme Check

After a grapheme table changes, compare `src/graphemes.ts` with `Intl.Segmenter` in Chrome, Firefox and webkit-host (the harness's background app on the system WebKit that Safari runs); the headers in `scripts/grapheme-check/` have the commands.

## Releasing

No release until after the API discussion, the review of the public API that TODO.md lists under End of project. Before one, run `bun run package-smoke-test`, the only check that packs and imports the built package, so the only one an extensionless import in `src/` fails. License notices for the ported engine code and `scripts/engine-data/` aren't written yet. At release, read CHANGELOG.md's Unreleased section as a 0.0.9 user would: fold its entries for break rules that #340's engine ports replaced into #340's entry, fold an entry that fixes or speeds up something only an unreleased main had into the entry that brought it (as #351 and #365 went into #340's, and #386 into #381's; the rich-inline fixes after #369 and #381 weren't checked against 0.0.9), and measure the bundle sizes again against the last release (`bun build src/layout.ts --minify`, then `gzip -9`, for each entry point).

Every push to `main` publishes the demo site (`.github/workflows/pages.yml`).

## Deep Profiling

Bun and Node microbenchmarks suit quick experiments; browser behavior needs browser measurements. For an algorithmic change, grow the text and its segments, forced lines and rich items (repeated punctuation, Arabic joins, CJK keep-all, long hyphenated URLs, whitespace runs), and count visited boundaries and submitted Canvas text with cold caches before trusting a timing: doubling an input should not quadruple repeated work ([RESEARCH.md](RESEARCH.md), Keeping Work Bounded).
