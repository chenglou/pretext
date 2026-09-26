# Harness

The browser's own layout of every case is recorded once per browser build and kept in git. Every later run only
predicts, in the real browser, the way an app does, and scores the prediction against the recording. The case format is
the per-engine rebuild's without inline structure.

```sh
bun harness record [--only-new]         # the browser's layout of every case, sorted and shuffled, in fresh short documents
bun harness check [--accept="<reason>"]  # predict every pinned case and score it; about a minute
bun harness gate [--sample=1000]         # check, plus reverse-order predictions, a fresh re-recording and attribution
bun harness equal <ref>                  # whether <ref>'s src/ predicts the same lines on every case
bun harness explain <id>                 # one case's recorded lines against the predicted ones
```

Every command takes `--browser=chrome|firefox|webkit-host|safari` (several with commas; default Chrome, Firefox and
webkit-host side by side, and Chrome for `explain`, which takes one), `--cases=<file.ndjson>` in place of
`harness/cases/*.ndjson`, and `--lib=<dir>` to predict with another build's `src/`. `record` and `gate` draw with
`--seed=<n>`, 20260924 by default, so a gate's result doesn't depend on the clock. `bun test harness` runs the offline
tests.

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
  compared only with each other; `src/layout.test.ts` checks that builder against the source.
- **What the pass rule can't see:** the hyphen a browser draws where a line breaks at a soft hyphen. The soft hyphen's
  box is visible there, but also where no hyphen is drawn: with a combining mark after it, and in WebKit at the end of a
  paragraph or before a line feed. The recordings keep no glyphs to tell these apart, and a rule over the boxes found
  93-358 mismatches per browser for the library as #340 left it, most of them narrower than 24 px and some of them the recording's. So
  line text that leaves out the hyphen at a soft-hyphen line end passes here, and is left to `src/layout.test.ts`.
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
- **Attribution:** each new failure is recorded alone (page history if that differs) and predicted alone twice. Two lone
  predictions that differ vary between runs; lone predictions that agree but differ from the check's depend on what was
  predicted before. A lone prediction can't tell the library's caches from the browser's Canvas state, so neither is
  called a library defect: the browser's go on the varying list with a reason. Otherwise the failure is a true loss,
  printed with its family, width band and first differing line.

What each piece catches, as an app developer would see it. `bun test harness` plants each fault, running the commands
with a stand-in browser. Two pieces run only in a real browser and aren't planted: the Firefox hold, and the page
(`page.ts`) passing the browser's name to the recorder, which leaves Chrome's soft hyphen copies out:

| Piece | Without it |
|---|---|
| Line count | A message loses or gains a line, so its bubble or row has the wrong height |
| Every line API against the walk | `layout()` counts lines the list doesn't paint, so a virtualized row is sized wrong: a counter that let an overflowing space start the next line passed every check before |
| Each rich fragment's text against its item's text over the fragment's cursors | A word broken inside a span paints its start again, while every rich API agrees |
| Line APIs checked on every case, recorded or not | A disagreement on a page-history case, or one with nothing visible, goes unseen |
| First and last visible character per line | A word paints on the wrong line while the height is right; main before #340 passed 4.5-8.1% of its census cases this way |
| Chrome's soft hyphen copies left out | A wrong break at a soft hyphen passes unseen |
| Lines from rect positions | Fractional line boxes read as a wrong count, as Safari 27's did in the old harness (`tests/wrapping`) |
| Line-start search | Long paragraphs would take minutes per browser; a wrong search would hide or invent a book's wrong line |
| Environment key | A browser or OS update reads as library regressions or fixes |
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
| A case without a recording blocks | A generator change that renames ids unpins cases silently |
| Two recordings kept apart, sorted and stable | The gate is green or red on another case's layout, and every recording churns in git |
| Sample draws weighted back to their share | A rare group topped up to 300 draws moves the headline far more than it moves real apps |
| The checked-in sample equal to what the weights draw | A changed weight scores the old usage |
| The checked-in reports and oracles equal to what their sources make | An oracle added to `src/test-data.ts` goes unchecked |
| Controls of one category merged where browsers agree | Each copy of a pasted-control family counts as a behaviour of its own |
| Only the widths around a change, at most three per template, the widest first | One input is pinned at hundreds of widths, and review drowns in near-copies |
| A width inside each layout besides the edges of a change | A behaviour the library models reads as missing whenever its fit is off by 1/128 px |
| One change per kind of break in the catalog | Two inputs that break alike double the review for one behaviour |

## Files

- `recordings/<browser>.txt`: one case per line, sorted, under a `# env` header: `<id>\t<height>\t<first>-<last>:<width> ...`
  per line, `-` for a line with no visible character. `recordings/<browser>.history.txt`: two recordings of each
  page-history case that differ. `recordings/safari.txt` holds installed Safari's recording of 2,000 cases.
- `accepted/<browser>.txt`: `## <reason>` headings, each followed by `<id> <status>` lines, the status `count`, `breaks`
  or `error`.
- `varying/<browser>.txt`: `## <reason>` headings, each followed by `<id> <kind>` lines, the kind `runs` or `order`.
- `cases/*.ndjson`: one case per line. `smoke.ndjson` holds the rebuild's hand-written smoke cases within what Pretext
  claims, and 300 real-text census cases across 18 corpora and six widths. The case sets are below.

## Case sets

`bun harness/sets/make.ts` makes every case file but the smoke, census and book sets, which are the rebuild's, and the
old-gate and follow-up sets, all taken once; its header lists the steps. A case's id hashes what the browser lays out, so making a set again keeps its ids and
their recordings. The catalog's line-break classes come from `sets/data/LineBreak-17.0.0.txt`, Unicode 17's file, which
main's generic table was made from before the engine tables replaced it.

| File | Cases | What it holds | Reported as |
|---|---:|---|---|
| `sample.ndjson` | 11,901 | The real-usage sample: 10,000 draws by `sets/weights.json`, plus the draws that bring 21 rare groups to 300 each, weighted back to their real share | The headline |
| `catalog.ndjson` | 37,511 (18,101-19,514 per browser) | main's adversarial families, the rebuild's rule families, filed reports whose reporter measured the width, and every UAX #14 line-break class between the scripts apps mix, pairwise over the CSS settings the library takes | Behaviours modelled |
| `facts.ndjson` | 10,018 (4,820-4,929) | The 28 engine facts `src/layout.test.ts` checks on plain text with a fake Canvas, in a browser | Behaviours modelled |
| `rich.ndjson` | 3,334 (1,617-1,636) | Rich-inline paragraphs: styled runs, span edges, atomic chips and padded code spans, main's inline items, #120, #171, #177, #323 and main's engine facts about rich items | Behaviours modelled |
| `census.ndjson` | 4,386 | The rebuild's census of real text (census-20260919): paragraphs of the 18 corpora at six widths, less the 300 in the smoke set | Pinned cases |
| `books.ndjson` | 72 | The rebuild's book survey: each corpus whole, raw and as main normalizes it, at the narrowest and widest step-10 widths | Pinned cases |
| `reports.ndjson` | 28 | Filed reports, with the input and width as filed | Pinned cases |
| `oracles.ndjson` | 56 | The mode oracles in `src/test-data.ts`, now in Firefox too | Pinned cases |
| `followups.ndjson` | 2 | The two fuzz strings `ENGINE_FOLLOWUPS.md` names for Firefox's accepted list: the Gecko scan no longer splits text runs where the script changes; taken once | Pinned cases |
| `old-gate.ndjson` | 322 | The rows the old gate (`tests/wrapping`) lost with #340's engine at 24 px and wider, true losses by its attribution, whose input no other case shows that engine failing; taken once | Pinned cases |

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

Chrome and Firefox are pinned copies in `~/github/browser-engines/apps` (`HARNESS_APPS`), named in `browsers.ts`: make one
with `ditto` from `/Applications` and bump the version there. A Firefox copy also gets the `DisableAppUpdate` policy in
its bundle before its first launch (`browsers.ts`), since Firefox updates the bundle it runs from under any profile but
the harness's. Chrome gets its own profile, an en-US interface and one background window opened through the DevTools
protocol; Firefox launches through LaunchServices, which macOS 27 needs.
For about 12 s after it starts, Firefox changes fonts under a page (`PLATFORM_BUGS.md`, the late family names), so every
Firefox job holds its first document until 15 s after launch. WebKit runs as webkit-host (`webkit-host/build.sh`), the
system WebKit.framework that installed Safari runs, in a window below every other. Nothing takes focus.

Installed Safari opens a window of its own, only while another app is frontmost, and hands the focus back if it takes it;
the window must stay uncovered while a job runs. It is recorded on a sample drawn from every set,
`bun harness record --browser=safari --sample=2000 --seed=20260924`, which webkit-host matched on every case but WebKit's
page history.
