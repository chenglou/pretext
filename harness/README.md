# Harness

The browser's own layout of every case is recorded once per browser build and kept in git. Every later run only
predicts, in the real browser, the way an app does, and scores the prediction against the recording. The case format is
the per-engine rebuild's without inline structure.

```sh
bun harness record [--only-new]         # the browser's layout of every case, sorted and shuffled, in fresh short documents
bun harness check [--accept="<reason>"]  # predict every pinned case and score it; about a minute
bun harness gate [--sample=1000]         # check, plus reverse-order predictions, a fresh re-recording and attribution
bun harness equal <ref> [--offline]      # whether <ref>'s build predicts what this tree's does on every case, and each
                                         # set's measureText calls and submitted units here and there; --offline, their
                                         # src/ on a stand-in Canvas in about 10 s (Equal)
bun harness bench <base> [--sessions=3]  # <base>'s src/ timed against this tree's in the same documents (Bench)
bun harness repin <chrome|firefox|safari> [--write]
                                         # after a browser update: the drift a new build brings (Browsers)
bun harness explain <id>                 # one case's recorded lines against the predicted ones
bun harness explain --text=<text> --width=<px> [--font=] [--lang=] [--white-space=] [--word-break=] [--letter-spacing=]
                                         # the same for a paragraph, recorded alone in a fresh document and not kept
```

Every command takes `--browser=chrome|firefox|webkit-host|safari` (several with commas; default Chrome, Firefox and
webkit-host side by side, Chrome for `explain`, which takes one, and for `bench` the browsers under Bench),
`--cases=<file.ndjson>` in place of `harness/cases/*.ndjson`, and `--lib=<dir>` to predict with another build: a `src/`
directory and the adapter beside it in `../harness`, or this tree's adapter where it has none.
`record` and `gate` draw with `--seed=<n>`, 20260924 by default, so a gate's result doesn't depend on the clock.
`bun test harness` runs the offline tests.

## How a case is judged

- **Pass:** the predicted line count is the browser's, and each line's first and last visible character is in the
  predicted line of that index. Predicted lines are ranges in source order, so that checks every visible character. A
  right count with a wrong break is a failure of its own, `breaks`.
- **Every line API:** the prediction is `walkLineRanges`' lines (`walkRichInlineLineRanges`' for a rich case), and the
  adapter runs the others on the same case: `layout()` on `prepare()`'s handle, which counts lines with its own loop on
  the resize path, `measureLineStats`, `layoutNextLineRange`, `layoutNextLine`, `layoutWithLines` and
  `materializeLineRange`; for rich cases `measureRichInlineStats`, `layoutNextRichInlineLineRange` and
  `materializeRichInlineLineRange`, whose fragments' text must be `materializeLineRange`'s over each fragment's cursors
  in its item's own prepared text. A case where any of them gives other lines, counts, widths (to 1e-6 px) or text than
  the walk blocks, whatever the browser did, and so does a case whose line APIs call `measureText` after preparing.
  Every case is checked this way, page history and cases with nothing visible too, since it needs no recording. Calls
  while preparing are printed per 1,000 units. The text APIs build line text with one shared builder, so they are
  compared only with each other, and as a hash between builds by `equal`; `src/layout.test.ts` checks that builder
  against the source.
- **What the pass rule can't see:** the hyphen a browser draws where a line breaks at a soft hyphen. The soft hyphen's
  box is visible there, but also where no hyphen is drawn: with a combining mark after it, and in WebKit at the end of a
  paragraph or before a line feed. The recordings keep no glyphs to tell these apart, and a rule over the boxes found
  93-358 mismatches per browser for the library as #340 left it, most of them narrower than 24 px and some of them the recording's. So
  line text that leaves out the hyphen at a soft-hyphen line end passes here, and is left to `src/layout.test.ts`;
  `equal` shows it changing between builds.
- **Lines come from rect positions:** text box rects grouped by vertical centre, never height divided by line height.
- **A visible character** is a code point whose positive-size Range rects all sit on one line. Chrome also reports a
  soft hyphen's box for the code point next to it; that copy is left out.
- **Recording:** paragraphs under 1,000 UTF-16 units are read code point by code point; longer ones search from each line's
  first visible character for the next line's.
- **Pinned:** every recorded case with a visible character whose recordings agree: its two orders, and every earlier
  recording under the same environment key. A case laid out differently in any two is page history and is never pinned,
  so recording again under one key only adds to that list. Cases with nothing visible, or a style the browser refused,
  aren't. A case with no recording blocks until `record --only-new` records it, except in installed Safari, which is
  recorded on a sample. In Firefox a case holding a text-presentation emoji (U+FE0E) is page history by construction:
  once a document has laid one out, Firefox lays color emoji out 1 px wider in the documents after it, in most runs, and
  lays out and measures the other U+FE0E cases otherwise too. So every Firefox job lays those cases out after all the
  others, and they are never pinned.
- **Accepted failures:** a pinned case that fails blocks unless `harness/accepted/<browser>.txt` lists it under a
  written reason. Each run prints every reason with its count and, for real-usage draws, the share of real paragraphs it
  covers. A listed case that passes again, is no longer pinned or names no case blocks until it leaves the list;
  `--accept` writes the new failures under its reason and removes those. The lists hold the failures of main's `src/`
  since #340, whose passes the gate protects; main before #340 (6d1d210) blocks.
- **Varying predictions:** `harness/varying/<browser>.txt` lists, each under a written reason, the cases whose
  predictions move with the browser's state rather than with the library: what earlier documents in the same browser
  process laid out, or what a Canvas measured before. A case listed as `runs` moves between runs: it is predicted and
  counted, never judged, and never on the accepted list. One listed as `order` moves only with what was predicted
  before it: check judges it like any other, so a failing one is accepted too, and a fix or a new regression shows. The
  gate's reverse-order check skips both. An entry that names no case blocks.
- **Real-usage sample:** cases with `sample: { group, weight }` give the headline, the weighted share of real paragraphs
  right with a 95% interval from resampling within groups. It also prints the share of the weight outside what Pretext
  claims (break-all, rich-inline in pre-wrap, system-ui font lists) and the share right without it.
- **Shrink-wrap, report only:** a bubble sized to the predicted widest line, rounded up, is at least the browser's widest line.
  A recorded line's width leaves out the U+0020 spaces that end it, which hang past the line end, as the library's widths do.
- **Environment key:** browser build (and the system WebKit's, for webkit-host and Safari), OS build, the OS's and the
  page's languages, device pixel ratio and the web fonts served. The harness refuses to score recordings made under
  another key.

The gate adds three checks:
- **Reverse order:** predictions in reverse order must break every line where the forward ones do, and the line APIs
  must still agree, or it blocks. Chrome's per-canvas shape caches (Chromium #560614560) move the breaks of six old-gate
  cases (Arabic with vowel marks before brackets) before #340 (6d1d210) as after it, so they are varying predictions of kind
  `order`: in check's order they fail the same way every time and are accepted. Predictions whose line widths alone
  move are printed, not blocked: the same caches and a Firefox width-1 case move them before #340 too, in some runs
  webkit-host moves those of one or two Ethiopic draws in a system-ui font list, and widths only reach the shrink-wrap
  check, which reports.
- **Fresh re-recording:** the 1,000 pinned cases whose ids rank first under the seed are recorded again, and each case
  that differs is recorded twice more, alone in a document of its own, in the sample's order and then in reverse. It
  blocks only where the browser lays a case out differently from the recording every time: the recordings no longer
  describe the browser. A case laid out as recorded in some attempt depends on the cases before it: page history the
  recordings missed, which the gate moves to the page-history list, as `record` would, for the next check not to pin,
  and off the accepted list. Commit the changed files. Ranked by id, a case leaving the pinned set changes the sample by
  one case.
- **Attribution:** each new failure is recorded alone (page history if that differs, or if the fresh recording just
  moved it there) and predicted alone twice. Two lone predictions that differ vary between runs; lone predictions that
  agree but differ from the check's depend on what was predicted before. A lone prediction can't tell the library's
  caches from the browser's Canvas state, so neither is called a library defect: the browser's go on the varying list
  with a reason. Otherwise the failure is a true loss, printed with its family, width band and first differing line.

## Equal

`bun harness equal <ref>` predicts every case in each browser with this tree's build and with `<ref>`'s, a git ref or a
`src/` directory. A build is its `src/` and the adapter that predicts with it: a ref's `harness/*.ts`, unpacked with its
`src/` into `.artifacts/harness-builds/<sha>`, or this tree's adapter for a ref from before the harness (096ae30e). So a
change to the adapter shows as well as one to the library. A case differs when its lines, their widths or their text
move, or its line APIs disagree otherwise or make other Canvas calls after preparing. A case that varies between runs
(`harness/varying`) is listed apart, not counted. It prints each case file's measureText calls and submitted units, here
against there, and exits 1 on a difference. Line text goes out as a hash, which adapters before it send none of; texts
are then not compared, and it says so.

`--offline` runs no browser. `offline-equal.ts` gives this tree's `src/` and `<ref>`'s the same inputs in the same order
on the invariants' stand-in Canvas, in one process per engine profile (Blink, WebKit, Gecko, and an engine Pretext
doesn't recognize), in about 10 s: 15,000 plain and 1,500 rich seeded draws from the case files, each under its page
language, and the bench's texts. An input differs when a field of `prepareWithSegments`' handle differs, or any line
API's output, line text included, at 11 widths (a text over 4,000 units, a bench shape's, at its width and Infinity).
It is measured otherwise when its measureText calls, in order, name another font, letter spacing or text. The stand-in's
widths also move with each pair of neighbouring units, so a text measured whole and in pieces measures differently. It
prints per profile the inputs that differ and in which parts, those measured otherwise and each build's calls and units,
and exits 1 when an input differs. This tree's harness drives both builds, so it compares `src/` only, and only on a
stand-in: `equal` in the browsers still decides.

## Offline invariants

`bun test harness` also runs `invariants.ts` in one process per engine profile (Blink, WebKit, Gecko, and an engine
Pretext doesn't recognize, which no browser here runs), each with a stand-in Canvas, on about 500 plain and 100 rich
cases drawn from the case files with a fixed seed, at each case's width, half and 1.5 times it, 1 and Infinity, and on a
few fixed inputs. It checks what an app relies on that no recording shows: every line API agrees with the walk and
layoutWithLines and layoutNextLine give equal line objects; lines cover the source forward, at a fixed width and at one
that changes per line; stepping leaves its cursor alone and the ranges a stream gives as they were, and JSON copies of
cursors and ranges resume the same; a visitor that edits its range changes no later line; rich gaps and line widths,
empty items, atomic items and extraWidth; held handles and their `structuredClone()` copies after other prepares,
`clearCache()` and `setLocale()`, and prepares with filled caches against cold ones; and that measureText calls and the
units submitted to them grow at most linearly while every walker ends. A handle is copied with `structuredClone()`: it
needn't survive a JSON round trip. The Blink and Gecko processes run under a desktop user agent with a string
`letterSpacing` on the context, as Chrome's and Firefox's have; without both, preparation skips the geometry of a fresh
line's first graphemes that those browsers take, and a held handle changed by a later prepare went unseen in 500 draws.
`invariants.test.ts` plants a fault in a copy of `src/` for every check but coverage, round trip and asking Canvas
nothing after preparing, and two that `equal --offline` must see: line text every text API gets wrong alike, and each
segment measured twice. Every walk and stream stops after a line per source unit, plus one, as a failure, and a range
or rich fragment that names no place in its text fails before its text is built. A walker that never returns inside the
library can take a gigabyte a second, or spin without allocating, so four processes run at a time, each is killed after
10 s, all of them once one ends without its report, and `watchdog.ts` kills a process that holds more than 1 GB (bun
test itself 2 GB), whose parent is gone or whose main thread has run no timer for 30 s. `bun test` preloads it
(`bunfig.toml`), which bun reads only when started from the repository root, so each test file that runs the library in
bun test's own process imports it first too.

## Bench

`bun harness bench <base> [--lib=<dir|ref>] [--browser=chrome,firefox,safari] [--sessions=3] [--rows=…] [--background]`
times `<base>`'s `src/`, a git ref or a directory, against `--lib`'s, this tree's by default. Every document evaluates
three minified bundles with the timing loops inside them: base, the candidate and a second copy of base as the
control, each with a comment of its own so no compiled code is shared, and each round times every one once, in an
order shuffled with a seed the run prints. Costs are per 1,000 UTF-16 units, and per call for labels.

| Row | What it times | Rounds (warm-up + timed) |
|---|---|---|
| new | `prepare()` + `layout()` at 320 px of chat messages no library or browser has laid out, in Latin, CJK, Arabic, Thai, mixed scripts and UI labels (`sets/data/ui-strings.json`, the per-call cost of many `prepare()` calls in a virtualized list) | 2 + 12 |
| fresh | A new page per library per round: compiling and running the bundle, timed apart, then two batches of new messages, in the five message families | 2 + 9 |
| rich | `prepareRichInline()` of new rich messages (code pills, chips, italics), then its stats, walk and stream at 180/220/260 px | 2 + 12 |
| seen | The same messages prepared again after their handles are dropped, as on a remount | 2 + 16 |
| resize | `layout()` of kept handles at widths used before (260, 380, 440) and at new fractional widths each round | 2 + 16 each |
| lines | `measureLineStats()`, `walkLineRanges()`, `layoutNextLineRange()` and `layoutWithLines()` on mixed messages at 180/240/320 px | 2 + 12 each |
| worst | One document per shape: letter-spaced CJK, soft hyphens with marks, controls next to spaces, invisible tails, pre-wrap chunks, keep-all CJK brackets, emoji (prepare only), long breakable runs and one book-length Arabic paragraph | 2 + 12 each |

- **Samples:** a new-text sample prepares a batch of its own, read forward, and batches hold the same units; the rows
  that want new text read each family's text in order, so no document meets text one before it laid out. A repeated
  sample runs its operation enough times to take 50 ms, sized from the fastest library in the warm-up rounds. A
  MessageChannel yield comes before each sample.
- **Guards:** the page must be cross-origin isolated and prints its timer step. Focus and visibility are checked around
  every sample and the device pixel ratio at both ends; a document that loses focus is laid out again after 60 s, up to
  4 times. In the foreground the bench refuses to time on battery under 20%; it prints the load and the power source
  at both ends.
- **Browsers:** pinned Chrome and Firefox and installed Safari run one at a time in the foreground, each brought to the
  front. `--background` runs the harness's background browsers, webkit-host for WebKit, where no focus can be required,
  so every verdict is a hypothesis. A browser whose session fails sits out the rest of the run; the others' tables still
  print, and then the bench exits with the failure.
- **Output,** per browser, row and family or operation: base's and the candidate's cost; candidate/base as the median
  over rounds of each round's paired ratio, with its quartiles and each session's median; control/base the same way;
  and a verdict. A session's band is 1 ± the larger of its |control/base − 1| and the row's floor, and a row reads
  "slower" or "faster" only when candidate/base is outside the band in every session, otherwise "within noise"; a
  browser's verdicts from one session are hypotheses. Then the costliest entry per row, the fresh pages and each bundle's
  minified and gzipped size. Raw samples go to `.artifacts/harness-bench/`; nothing timed is checked in, and the bench
  never blocks.
- **Floors:** each row's floor comes from a calibration of HEAD against itself: the largest deviation from base that
  the candidate or the control held in one direction in all three sessions, the only kind a verdict can call, rounded
  up to a whole percent. A single document can run one copy of the same code 15-50% slower, which the control's band
  or the other sessions absorb (`RESEARCH.md`, Reading Browser Output). The floors are kept in `bench/report.ts` with
  the date, builds, machine and device pixel ratio they came from; calibrate again after a browser pin bump or on
  another machine. A row without one prints as uncalibrated.

What each piece catches, as an app developer would see it. `bun test harness` plants each fault, running the commands
with a stand-in browser. Three pieces run only in a real browser and aren't planted: the Firefox hold, the page
(`page.ts`) passing the browser's name to the recorder, which leaves Chrome's soft hyphen copies out, and the bound on a
job's browser (Browsers):

| Piece | Without it |
|---|---|
| Line count | A message loses or gains a line, so its bubble or row has the wrong height |
| Every line API against the walk | `layout()` counts lines the list doesn't paint, so a virtualized row is sized wrong: a counter that let an overflowing space start the next line passed every check before |
| Each rich fragment's text against its item's text over the fragment's cursors | A word broken inside a span paints its start again, while every rich API agrees |
| Line APIs checked on every case, recorded or not | A disagreement on a page-history case, or one with nothing visible, goes unseen |
| First and last visible character per line | A word paints on the wrong line while the height is right; main before #340 passed 4.5-8.1% of its census cases this way |
| Chrome's soft hyphen copies left out | A wrong break at a soft hyphen passes unseen |
| Lines from rect positions | Fractional line boxes read as a wrong count, as Safari 27's did in the old harness (`tests/wrapping`, since removed) |
| Line-start search | Long paragraphs would take minutes per browser; a wrong search would hide or invent a book's wrong line |
| Environment key | A browser or OS update reads as library regressions or fixes |
| `repin`: the page-history list kept under a new build | A pin bump pins page history its two orders missed, and check blocks on it: 33 cases when Firefox went to 156.0.1 |
| `repin`: the browser's break data against `scripts/engine-data` | A browser update changes its line or grapheme rules while the tables stay as they were |
| Page-history list, kept across recordings of one environment | Cases that lay out differently after other cases block changes at random; one recording's two sorted orders found 11 of WebKit's 87 |
| Firefox's first document held until 15 s after launch | Emoji beside Arial lay out differently for Firefox's first 12 s: 91 cases, and the gate's fresh recording, would block at random |
| Firefox's U+FE0E cases laid out after every other, never pinned | The gate's fresh recording blocked at random on 7-9 emoji cases beside Arial, laid out after a text-presentation emoji |
| Varying list with reasons | `check` and the gate block at random on predictions the browser's state moves, such as a system-ui label in Chrome |
| Order-dependent cases judged in check's order, skipped only by the reverse-order check | A fix or a new regression on Chrome's Amiri cases goes unseen |
| An entry of either list that names no case blocks | The lists keep reasons for cases that are gone |
| Accepted list with reasons | Accepted losses go silent, and a fix goes unrecorded |
| Exact widths through the adapter | Text that exactly fits its bubble wraps (a width 1/64 px short) |
| Recorded widths without the spaces that end a line | The shrink-wrap check calls a bubble a space too narrow; that was 94% of Chrome's misses before |
| Reverse-order predictions (gate), judged by where lines break | A message wraps differently depending on what the app prepared before; widths moved by Chrome's shape caches would block main before #340 too |
| Fresh re-recording (gate), a differing case recorded alone twice more | Stored recordings stop describing the browser; or the gate blocks at random on emoji beside Arial in Firefox |
| Seeded sample with a fixed default, ranked by id | The gate is green or red by the clock, or draws another sample whenever a case leaves |
| Line APIs asking Canvas nothing after preparing (blocks), calls while preparing (printed) | Every window resize measures text again, or preparing gets slower unnoticed |
| A walk that goes past a line per source unit, plus one, or a range or rich fragment that names no place in its text, fails its case | A walker that never ends stalls the page until the 2-minute watchdog, naming no case, and so does a line that ends at segment Infinity in a build before #353, whose text builder builds its text without end |
| The line APIs' invariants offline, in four engine profiles (`invariants.ts`) | A list keeping the cursor it passed, the ranges a walk visits or a stream gives, or a JSON copy of a cursor lays out other lines, a chip counts its padding twice, and the profile of an engine Pretext doesn't recognize is checked nowhere |
| Held handles and their copies after other prepares, `clearCache()` and `setLocale()`, and warm prepares against cold ones | A message a list prepared moves when another is prepared with other letter spacing, or a message prepared again at other letter spacing takes the first one's geometry |
| Canvas calls and submitted units that grow at most linearly | A long word measures every prefix, so preparing it grows with the square of its length while the calls grow linearly |
| `watchdog.ts`: past 1 GB (bun test 2 GB), a parent that is gone, or 30 s without a timer | A library under test whose walker runs away inside it fills the machine's memory from a process no test waits for any more, or hangs `bun test` |
| A job's browser killed past 4 GB, and every open browser killed when the process exits | A page that allocates without end fills the machine's memory: Firefox's content process grew 1.35 GB a second, and Chrome's renderer stopped only at its 4.4 GB heap limit; Ctrl-C left 9 Chrome and 11 Firefox processes running |
| `equal`'s calls and submitted units per set, here against there | Preparing a set gets slower with the same lines, unseen until someone times it |
| `equal`: each build's own adapter, its line text, disagreements and Canvas calls after preparing | A change to the adapter shows no difference, and neither do a line text every text API gets wrong alike, such as a hyphen left out at a soft hyphen, or a new disagreement |
| `equal`: cases that vary between runs listed apart | main against itself differs, on Chrome's system-ui label |
| `equal --offline`: the prepared handle and each input's measureText calls in order, in four engine profiles | A change to preparation that no line shows, or that measures other text to the same widths, waits for a browser run to show, and the profile of an engine Pretext doesn't recognize is compared nowhere |
| Bench: base, candidate and a control copy of base in each document, in a shuffled order | A change's speed reads from sessions that drifted apart by 5-19%, so a slower row goes unseen or noise reads as a change |
| Bench: new text read forward, never prepared twice | Browser and library caches make new text look as fast as seen text |
| A case without a recording blocks | A generator change that renames ids unpins cases silently |
| Two recordings kept apart, sorted and stable | The gate is green or red on another case's layout, and every recording churns in git |
| Sample draws weighted back to their share | A rare group topped up to 300 draws moves the headline far more than it moves real apps |
| The checked-in sample equal to what the weights draw | A changed weight scores the old usage |
| The checked-in reports equal to what `sets/exact.ts` makes | A report added there goes unchecked |
| Controls of one category merged where browsers agree | Each copy of a pasted-control family counts as a behaviour of its own |
| Only the widths around a change, at most three per template, the widest first | One input is pinned at hundreds of widths, and review drowns in near-copies |
| A width inside each layout besides the edges of a change | A behaviour the library models reads as missing whenever its fit is off by 1/128 px |
| One change per kind of break in the catalog | Two inputs that break alike double the review for one behaviour |

## Files

- `recordings/<browser>.txt`: one case per line, sorted, under a `# env` header: `<id>\t<height>\t<first>-<last>:<width> ...`
  per line, `-` for a line with no visible character. `recordings/<browser>.history.txt`: two recordings of each
  page-history case that differ. `recordings/safari.txt` holds installed Safari's recording of 1,995 of the 2,000 cases it recorded, and its history file the other 5.
- `accepted/<browser>.txt`: `## <reason>` headings, each followed by `<id> <status>` lines, the status `count`, `breaks`
  or `error`.
- `varying/<browser>.txt`: `## <reason>` headings, each followed by `<id> <kind>` lines, the kind `runs` or `order`.
- `cases/*.ndjson`: one case per line. `smoke.ndjson` holds the rebuild's hand-written smoke cases within what Pretext
  claims, and 300 real-text census cases across 18 corpora and six widths. The case sets are below.

## Case sets

`bun harness/sets/make.ts` makes every case file but the smoke, census and book sets, which are the rebuild's, and the
old-gate, follow-up and oracle sets, all taken once; its header lists the steps. main's catalog and rich cases
(`catalog/main/*`, `rich/main/*`) were taken once from the old harness's generator too: `cut` keeps them as they are. A
case's id hashes what the browser lays out, not its family or origin, so making a set again keeps its ids and their
recordings. The catalog's line-break classes come from `sets/data/LineBreak-17.0.0.txt`, Unicode 17's file, which
main's generic table was made from before the engine tables replaced it. Line numbers of `src/layout.test.ts` in case
origins, `sets/data/engine-facts.json`, the `rich.ts` header and five accepted-list reasons are those of main before #340
(6d1d210); the files keep them as they were taken.

| File | Cases | What it holds | Reported as |
|---|---:|---|---|
| `sample.ndjson` | 11,901 | The real-usage sample: 10,000 draws by `sets/weights.json`, plus the draws that bring 21 rare groups to 300 each, weighted back to their real share | The headline |
| `catalog.ndjson` | 37,822 (18,253-19,644 per browser) | main's adversarial families (taken once), the rebuild's rule families, filed reports whose reporter measured the width, every UAX #14 line-break class between the scripts apps mix, pairwise over the CSS settings the library takes, the shapes `ENGINE_FOLLOWUPS.md` names, with their neighbours, and long chains of combining-mark runs on one grapheme | Behaviours modelled |
| `facts.ndjson` | 10,018 (4,820-4,929) | The 28 engine facts `src/layout.test.ts` checks on plain text with a fake Canvas, in a browser | Behaviours modelled |
| `rich.ndjson` | 3,334 (1,617-1,636) | Rich-inline paragraphs: styled runs, span edges, atomic chips and padded code spans, main's inline items (taken once), #120, #171, #177, #323 and main's engine facts about rich items | Behaviours modelled |
| `census.ndjson` | 4,386 | The rebuild's census of real text (census-20260919): paragraphs of the 18 corpora at six widths, less the 300 in the smoke set | Pinned cases |
| `books.ndjson` | 72 | The rebuild's book survey: each corpus whole, raw and as main normalizes it, at 220 and 820 px | Pinned cases |
| `reports.ndjson` | 28 | Filed reports, with the input and width as filed | Pinned cases |
| `oracles.ndjson` | 56 | The mode oracles the old harness ran in Chrome and Safari, now in Firefox too; taken once | Pinned cases |
| `followups.ndjson` | 2 | The two fuzz strings `ENGINE_FOLLOWUPS.md` names for Firefox's accepted list: the Gecko scan no longer splits text runs where the script changes; taken once | Pinned cases |
| `old-gate.ndjson` | 322 | The rows the old gate (`tests/wrapping`, since removed) lost with #340's engine at 24 px and wider, true losses by its attribution, whose input no other case shows that engine failing; taken once | Pinned cases |

**The sample.** A draw picks a surface (chat, AI replies, cards, documents, UI, editorial pages), a script by that
surface's mix, a text from the pools, the style settings apps use, and a width from a device, its viewport and the
app's rule. Every share in `weights.json` names a source or says what its guess leans on, and `pools` names each text
pool's source and license. The rare groups (break-all, pre-wrap with newlines, URLs and long words, keep-all Korean, soft
hyphens, Windows-only font lists, letter spacing, mixed scripts, table cells, and every script) get at least 300 draws,
so a group with no failure is under 1% wrong with 95% confidence. A draw whose text stands in for the kind asked for
(every chat draw, since no chat that users wrote is checked in yet) is marked, and `check` prints their share.

**The searched sets** (catalog, facts, rich) start from templates, inputs without a width:
1. `first` records each template at a coarse grid and at width 1 and 100000, in each browser.
2. `select` merges inputs that differ only in which Cc or Cf control they hold, where all three browsers lay them out
   alike. The catalog then keeps a change between neighbouring widths only when it shows a kind of line break no
   earlier template showed in that browser, and every family keeps one. The facts and rich sets keep every change.
3. `bisect` narrows each kept change to one layout unit: 1/128 px in Chrome, 1/64 px in WebKit, 1/60 px in Firefox.
4. `cut` pins width 1 and 100000 and, per browser, at most three exact changes per template, each a new kind of break,
   the widest first. Each change gets a width 1/64 px either side of where the lines change (`edge`, where
   the fit is exact to 1/64 px) and a whole pixel well inside each of its two layouts (where the break chosen is checked
   away from the fit). One Chrome layout unit (1/128 px) either side was finer than the fit is exact to: half those
   cases failed before and after #340 alike.

`check` reports a behaviour as modelled when every width away from the edges passes, and counts those that pass at the
edges too.

The searches' own recordings stay in `.artifacts/harness-sets/`. A behaviour narrower than 24 px is pinned like any
other, so one the library doesn't model goes on the accepted list with a reason such as "narrower than real layouts".

## Browsers

Chrome and Firefox are pinned copies in `~/github/browser-engines/apps` (`HARNESS_APPS`), named in `browsers.ts`. A
Firefox copy also gets the `DisableAppUpdate` policy in its bundle before its first launch (`browsers.ts`), since Firefox
updates the bundle it runs from under any profile but the harness's. Chrome gets its own profile, an en-US interface and
one background window opened through the DevTools protocol; Firefox launches through LaunchServices, which macOS 27 needs.
For about 12 s after it starts, Firefox changes fonts under a page (`PLATFORM_BUGS.md`, the late family names), so every
Firefox job holds its first document until 15 s after launch. WebKit runs as webkit-host (`webkit-host/build.sh`), the
system WebKit.framework that installed Safari runs, in a window below every other. Nothing takes focus.

The installed browsers are likely a version newer each time the project is picked up again, so `bun harness repin
<browser>` comes first. For Chrome and Firefox it copies the installed app as a pinned copy named by its version, as the
rebuild's `rebuild/lab/pin-browser.sh` makes one: a clone that must hash as the installed tree does, the policy for
Firefox, and the tree hash beside it, its paths sorted under `LC_ALL=C`. It then records every case with that copy into a
copy of the recordings in `.artifacts/harness-repin`. Safari can't be pinned, so `repin safari` records webkit-host and
installed Safari's sample as the system has them. It prints the cases laid out otherwise than the checked-in
recordings, the new page history and the cases newly recorded or gone, and whether the browser's break data is still
the bytes of `scripts/engine-data`: Chrome's `line_normal.brk`, `line_normal_cj.brk` and `char.brk` in its
`icudtl.dat`, the system ICU's four tables for Safari, and for Firefox the byte arrays of the Gecko line, grapheme and
Bidi_Class data in XUL. A new environment starts the page-history list empty and two orders find few of Firefox's, so a
case that was page history stays so. `--write` then replaces the recordings, takes the cases now page history off the
accepted list and bumps the pin in `browsers.ts`. Commit that on its own, and calibrate the bench floors again after a
pin bump.

While a job runs, the harness sums the memory footprint of its browser's processes every 100 ms: the one it launched,
their descendants, and webkit-host's web content process, which launchd starts and the host names on its stdout
(`webkit-host/build.sh` records the source it built from, and the harness runs no other build). Past 4 GB it kills them
and fails the job, as a page that allocates without end grows a content process by gigabytes a second and neither
Firefox nor WebKit stops it; a check takes up to 2.3 GB. The bench and the grapheme check, whose pages take up to 3.6
and 4.6 GB in Chrome, allow 6 GB. A browser that quits fails its job at once. The process kills every browser it still
has open when it exits, on an interrupt, SIGTERM or hang-up too; one killed outright leaves Chrome and Firefox running,
as they start through LaunchServices, outside its process group.

Installed Safari opens a window of its own, only while another app is frontmost, and hands the focus back if it takes it;
the window must stay uncovered while a job runs. It is recorded on a sample drawn from every set,
`bun harness record --browser=safari --sample=2000 --seed=20260924`, which replaces the sample recorded before and
which webkit-host matched on every case but WebKit's page history.
