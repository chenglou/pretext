# Harness

Each case's layout in the browser is recorded once per browser build and kept in git; later runs predict in the real
browser, as an app does, and are scored against it. `harness/cli.ts`'s header lists the commands, and each file's header
its part. Dated measurements are from an M5 Max under macOS 27.0 (26A428) at device pixel ratio 2, in Chrome 153,
Firefox 156.0 and Safari 27.0 (WebKit 22625.1.29.11.27); the pins moved to Chrome 154.0.8037.57 and Firefox 156.0.1 on
2026-09-25, and every recording stayed the same.

## Setup

- `bun install`, then `bun test`, which runs the harness's offline tests with no browser.
- Chrome and Firefox run as pinned copies of the installed apps, kept in `~/github/browser-engines/apps` (or the folder
  `HARNESS_APPS` names) and named in `pins.json`. `bun harness repin chrome` or `repin firefox` copies the installed app
  there; `--write` makes the copy the pin.
- webkit-host is the system WebKit that installed Safari runs, in a background app: build it with
  `harness/webkit-host/build.sh`, which puts it in `.artifacts/webkit-host/`. The harness won't run a build made from
  other source.
- Installed Safari is driven through AppleScript, so macOS asks once to let the terminal control Safari and System
  Events.
- Recordings count only on the machine setup they were made under (What a case is and when it passes): on another Mac,
  or under other OS languages, record every case again first (`bun harness record`).

## What a case is and when it passes

A case is one paragraph at one width. It passes when the line count is the browser's and each line's first and last
visible character sits in the predicted line of that index. `check` prints each failure with its status: `count` (a
wrong line count), `breaks` (the right count with a character on the wrong line) or `error` (the prediction threw).
`check` judges no width. It prints two things about the passing cases' widths and never fails on them: the shrink-wrap
check, whether a bubble sized to the predicted widest line, rounded up, is at least as wide as the browser's widest
line, and the share of lines whose predicted width is more than 0.05, 0.5 and 1 px from the recorded one. Between two
builds widths are compared exactly: to `equal <ref>` a line width that differs at all is a difference, on every case
(Proving "no change"). The library's consistency blocks on every case, recorded or not: the line APIs (`layout()`,
`measureLineStats()`, `walkLineRanges()`, `layoutNextLineRange()`, `layoutNextLine()`, `layoutWithLines()`,
`materializeLineRange()` and their rich-inline counterparts) must agree on lines, widths and text, and none may call
`measureText` after preparing. A rich fragment's text is `materializeLineRange()`'s over its cursors in its item's own
prepared text, but for the hyphen of a soft hyphen it ends at, which the text the items join decides.

A recording counts only under the environment that made it, the key in its file's first line: browser build, OS build,
OS languages, page languages, device pixel ratio and a hash of the served fonts. `check` refuses to score under any
other ("Record again before scoring"), so a browser or OS update never reads as a regression. A case laid out
differently in two recordings under one key has page history: its result depends on what the page laid out before,
through the browser's caches, which the paragraph alone can't predict, so it's never pinned. A pinned case is one whose
recordings all agree, and only pinned cases are scored. A new case fails `check` until `bun harness record --only-new`
records it, except in installed Safari, which records only a seeded sample: unobserved is never a pass.

Every pinned case blocks alike, CJK included, and a change that fails one lists it under a written reason, so a hard
tradeoff goes on record instead of being ruled out. Generated cases under 24 px are scored too, although narrower than
any real layout, and one the library doesn't model goes on the accepted list with a reason such as "narrower than real
layouts" (the narrowest real-usage draw is 25 px).

### Two kinds of set

- **The real-usage sample** answers how often a user sees a wrong line. Its draws follow how often apps lay out each
  surface (chat bubbles, AI replies, cards, documents, UI labels, editorial pages), script, style and width, by the
  shares in `sets/weights.json`. A share names a source or says it is a guess, and most are guesses, many with nothing
  written that they lean on (`bun harness/sets/make.ts sizes` counts them); a share that names a source may still be a
  judgement made from it. The headline, which `check` prints first, is the weighted share of draws that pass, over
  every draw and, always beside it, over the draws inside what Pretext claims: neither a style the adapter can't
  express (`break-all`) nor a `system-ui` font list (README, Caveats). Each has a 95% interval, which covers the error
  of drawing a sample and none of the guesses, so the headline is no firmer than the weights. Rare groups get at least
  300 draws, weighted back, so one with no failure is under 1% wrong at 95% confidence.
- **What the headline pools away** prints under it. About half the sample's weight is paragraphs the browser lays out
  on one line, which nearly always pass, so `check` prints the share right where the browser wraps, and the share with
  a wrong line count, the wrong height a virtualized list would get. Then a table counts draws one each, by script and
  by style (letter spacing, soft hyphens, pre-wrap, keep-all, rich inline, emoji): draws and failures, the same among
  the draws the browser wraps, and the passing draws that fail the shrink-wrap check. A row's rate doesn't move with
  the share `weights.json` gives its script or style, though the mix inside the row still follows the weights. Read the
  worst rows with the headline: easy kinds flatter a pooled number (`RESEARCH.md`, Evaluation Traps).
- **The behaviour catalog** (`catalog`, `facts`, `rich`) answers which behaviours we model; deduplicated by what the
  browsers do, its size says nothing about real use. `check` counts a behaviour as modelled when each of its cases
  away from the edges passes, width 1 and the widths under 24 px included, which are narrower than any real layout.
  Beside that it prints the count over the behaviour's cases at 24 px and wider, among the behaviours that have one
  there, away from the edges, that the browser lays out on more than one line. The others aren't counted: two thirds
  of the catalog's behaviours have a single case that wide, at 100,000 px on one line, which passes whatever the
  library does at a break. The count at the edges is likewise among the behaviours whose lines change at 24 px or
  wider.

| File in `cases/` | Holds | Made by |
|---|---|---|
| `sample.ndjson` | The real-usage sample | `make.ts write` |
| `reports.ndjson` | Filed reports with the text, font and width as filed (`sets/exact.ts`) | `make.ts write` |
| `catalog.ndjson` | Families of templates, from the engines' rules, the UAX #14 classes between the scripts apps mix, the shapes `ENGINE_FOLLOWUPS.md` names, bidi controls where Firefox's line breaking looks past them and CJK marks Chrome halts next to other punctuation, plus adversarial `main/*` cases taken from the old test suite | the width search |
| `facts.ndjson` | The engine facts `src/layout.test.ts` checks on plain text, in a browser | the width search |
| `rich.ndjson` | Rich-inline paragraphs: styled runs, span edges, chips, padded code spans, boxes (an empty inline-block of a width and a height, top-aligned), the shapes whose lines changed when items began to continue the line (#369), keep-all and pre-wrap paragraphs, plus `main/*` cases | the width search |
| `census.ndjson`, `books.ndjson`, `smoke.ndjson` | Real paragraphs of `corpora/` at several widths, and whole books, from the per-engine rebuild | taken once |
| `oracles.ndjson` | The mode oracles (pre-wrap, keep-all, symbols, letter spacing, soft hyphens) the old test suite ran | taken once |
| `followups.ndjson` | Two fuzz strings `ENGINE_FOLLOWUPS.md` names | taken once |
| `old-gate.ndjson` | Cases the old test suite's pre-landing check (its gate) lost to #340's engine ports at 24 px and wider, whose input no other case showed failing | taken once |

A browser takes the cases every browser shares and the ones its own width search made, which a case's `browsers`
names, so the files' total is no browser's count: each takes about three fifths of them (`bun harness/sets/make.ts
sizes` prints each file's count per browser and the totals). A case another browser's search made is neither recorded
nor predicted there.

A contributor adds to the catalog, facts or rich set through a template (How cases grow); the sets taken once can't be
made again, since their generators are gone. The old test suite is `tests/wrapping`, which the harness replaced (#341)
and which was removed in #348; read it with `git show 6d1d2106:tests/wrapping/<file>`.

### Why the old suite went

The harness replaced the old test suite wholesale and decided afresh what mustn't regress, since a pass rate means
something only against how much its cases matter. 88% of the suite's 238,524 cases were under 80 px, one family was 120
copies differing by one control character, and repros mixed with usage: main before #340 (commit 6d1d2106, the last main
whose break rules were Pretext's own rather than ports of the engines' line breakers) passed 99.96-100% of line counts
on 4,686 real paragraphs but failed 20-26% of the suite (2026-09-17), and it had the right count with a wrong break on
4.5-8.1% of the census set's cases (2026-09-24). The harness keeps exhaustive width sweeps, since typography's bugs sit
in combinations nobody can list, and tracks failures as well as passes, so a rewrite that moves a case outside what
Pretext claims still shows.

## How cases grow

New cases mustn't pile up as the old suite's did, a hand-written repro per bug.

- **A fix never adds to the sample**, which moves only with a sourced change to `weights.json`, or the headline drifts
  toward the bugs someone looked at.
- **A fix adds a few templates in the behaviour's shape** (inputs without a width, in a `sets/catalog.ts` family: a
  named group of templates, each family keeping at least one case), as does a behaviour modelled but never recorded. The
  width search (`sets/make.ts`, `sets/widths.ts`) finds each width where a browser's lines change, and the dedupe keeps
  a change only when its kind of break (the UAX #14 classes, Unicode's line-breaking classes, on either side) is one no
  earlier template showed, so a template showing nothing new adds almost nothing. Never a cross product or a family per
  variant: every family keeps a case, which gets past the dedupe. For example, the fix for Chrome's `text-spacing-trim`
  at a line end (#366, `src/han-kerning.ts`) first made 72 families (9 marks × 4 line endings × 2 languages), 751 cases
  (+2%) and 18 accepted failures, and landed with 41 cases and a unit test (2026-09-27).
- **When a rule is a small fixed table**, such as which closing marks Chrome trims, test every entry in a unit test on
  the unit tests' fake Canvas (`src/layout.test.ts`), confirmed by a few browser cases, in place of any test of the same
  rule. The dedupe's kinds of break are coarser than behaviour: `」` and `。` share a UAX #14 class, so it dropped the
  `。` inputs, though Chrome trims `」` and never `。`.
- **The PR states each set's growth** (`bun harness/sets/make.ts sizes`); more than about 1% of a set needs a sentence
  on why.

### Adding a case

`sets/make.ts`'s header has the commands:

1. Add templates to a family in `sets/catalog.ts` (or `facts.ts`, `rich.ts`).
2. `make.ts first <set> --browser=<b>` in Chrome, Firefox and webkit-host, then `make.ts select <set>`, then
   `make.ts bisect <set> --browser=<b>` in each.
3. `make.ts cut <set>` writes `cases/<set>.ndjson`. It keeps only the frozen `main/*` cases and the templates the saved
   search holds, so after a partial search it silently drops every other generated case (8,926 at b1fd05fc); search the
   whole set before cutting, then remove `.artifacts/harness-sets/<set>/`. A template added to an existing family should
   bring its older cases back byte for byte, and a whole-catalog search derives every generated case again, so a
   browser's drift lands in the PR.
4. `bun harness record --only-new`, then `bun harness check`; a new failure the change doesn't fix goes on the accepted
   list with `check --accept="<reason>"`.

A bug filed as a GitHub issue with its text, font and width goes in `sets/exact.ts` under the issue number; one whose
width came from the reporter's own Canvas becomes a catalog template. A repro's exact string may drop out when the sets
are made again, since they sample behaviour; the filed report, the fix's PR and `bun harness explain --text=…` keep it.
A case the dedupe can't see calls for a finer dedupe, not a hand-kept repro, since a repro per fix is how the old suite
grew.

`sets/data/engine-facts.json`'s `layout.test.ts` line numbers, the facts set's case origins and the four accepted-list
reasons that cite a `layout.test.ts` line point at the files of main before #340 (6d1d2106), not today's; read them with
`git show 6d1d2106:<path>`. ENGINE_FOLLOWUPS.md, Harness debt, has what to prune when the sets are made again.

## Commands

AGENTS.md's Validation says when to run `repin`, `check`, `gate` and `bench`. `gate` adds a prediction in reverse order
(a paragraph mustn't wrap differently because of what was prepared before it), 1,000 seeded cases recorded again (the
recordings must still describe the browser), and each new failure recorded and predicted alone, to attribute it.
`record --only-new` records new cases, `check --accept="<reason>"` puts the new failures on the accepted list under that
reason and drops the entries that pass again, and `explain` shows one case, or a paragraph given with `--text`, line by
line against the browser.

## Accepted and varying lists

`accepted/<browser>.txt` holds the cases main has failed since #340, each under a written reason: the gate protects what
main passes since #340, whose break rules port the engines' own, not what main before #340 passed by accident. A listed
case that passes again or is gone blocks until `check --accept` takes it off, so a fix gets recorded. A lost pass isn't
a regression until it's attributed: a true loss, two errors that cancelled, or a bad test or recording.

A reason isn't always a cause. The reasons #340's failures were accepted under name a shape of input and say that the
browser breaks there otherwise ("Arabic and Hebrew beside brackets, controls, U+FFFC or rich-item edges, at 24 px and
wider: Chrome breaks there where the library doesn't"), not the engine's rule: about a fifth of Chrome's and Firefox's
entries and a twelfth of webkit-host's (2026-09-30). Those entries are untraced, not explained. A new reason names the
browser's rule, or says that it isn't traced.

`varying/<browser>.txt` lists predictions that move with the browser's state, between runs (`runs`, never judged) or
with what was predicted before (`order`, judged in their own order). A lone prediction can't tell the library's caches
from the browser's Canvas, so attribution never calls such a move a library defect; Chrome's per-canvas shape cache
(Chromium #560614560) causes the known `order` cases.

Page history misleads (`RESEARCH.md`, Evaluation Traps, has the cases; Engine Facts, Safari (WebKit), has WebKit's
caches): when the gate's attribution calls a failure page history, that holds only once the case fails the same way
alone, and a webkit-host win or loss counts only if it holds alone or in fresh documents in both orders. The cases seen
with page history, `recordings/<browser>.history.txt`, are kept across every recording under one environment, and
`repin` carries them to a new build, since two orders miss history both share: one recording's two orders found 11 of
webkit-host's 87 (2026-09-24), and without the carried list 33 cases would have blocked when Firefox went to 156.0.1
(2026-09-25).

## Proving "no change"

A cleanup changes nothing only when every tool says so, run on old and new with the same inputs: `equal main`
(`--offline` first, then in the browsers), `check`, `gate`, the offline invariants (`bun test
harness/invariants.test.ts`) and the bench's floors.

- `equal` compares each case's predictions in the two builds, pinned or not: the lines, each line's width exactly, the
  line text, the line APIs' disagreements and the Canvas calls after preparing. So a change that moves only widths,
  which `check` never fails on, still shows there.
- An offline replay detects change but isn't an oracle: its stand-in Canvas gives each character a width from a
  formula, moved a little by each pair of neighbouring characters (`offline-equal.ts`), so it can't fail on shaping,
  painting or string storage. Every stand-in font kerns the space, so offline the Chromium profile never takes the
  path of a font that kerns nothing with it, which `src/layout.test.ts` and the browsers run. Where a stand-in font's
  kerning with the space sits depends on the character asked, which it did in no font measured, so a change that only
  asks another character first moves widths between a word and the space after it there, and nothing in a browser.
- Without the invariants' desktop user agent and string `letterSpacing` (`invariants.ts`), a planted defect in reusing
  a prepared handle went unseen in 500 draws.
- Canvas-call counts before #355 aren't comparable with later ones: the harness's adapter (`run.ts`) stopped calling
  `setLocale()` per case, cutting its calls 20-25% with no prediction change (2026-09-26).

## Bench

Speed claims rest on `bun harness bench`'s same-document ratios. Its rows (`new`, `rich`, `seen`, `resize`, `lines`,
`worst`) follow what an app does; never rank `prepare()` against `layout()`, as one is paid once and the other on every
resize. The `new` rows time text no library or browser has laid out: Firefox and Safari keep shaped text per font,
shared by every canvas and the DOM, so a fresh canvas doesn't make text new.

- **A control copy.** Each document runs base, the candidate and a second copy of base, shuffled each round, since only
  same-document ratios survive drift between sessions (`RESEARCH.md`, Evaluation Traps, has the numbers behind this and
  the next two).
- **Focus and a quiet machine.** Background windows' timers are slowed, so Chrome and Safari need a visible, focused
  window throughout. Using the machine spoils the sessions it overlaps, and only those; a loaded machine spoils them
  all.
- **Two sessions** (`--sessions=2`) do unless they disagree on a verdict that matters; the default of 3 calibrates the
  floors. A row reads slower or faster only when it does so in every session.
- **Floors**, the noise threshold under which a row's ratio isn't called a change (1-6% by row, `FLOORS` in
  `bench/report.ts`, with the builds and machine they came from), are the largest deviation held in one direction in all
  three sessions of a calibration of HEAD against itself; calibrate again, with `bun harness bench HEAD --sessions=3`,
  after a pin bump or on another machine. Floors from the worst single reading would be too wide, since one copy can run
  slow for a whole document (in one session Firefox 156.0.1's base copy took about twice as long as the other two on
  kept CJK handles, 2026-09-26), and would have hidden a real 20-25% slowdown. These floors flag all four slowdowns
  known between main before #340 (6d1d2106) and 217c84b8, a commit of #340: pre-wrap layout and walk at 1.05 of base's
  time in Chrome and 1.18-1.25 in Firefox, and letter-spaced CJK and control layouts at 1.12 and 1.20 in Safari.
- **WebKit's width cache** samples one Canvas call in 21 after a run of misses, so a prepare that submits n strings
  speeds up only after 21 / gcd(n, 21) repeats: compare submitted text and cold first prepares.

A full bench took about 27 minutes (2026-09-26). Nothing timed is checked in.

## Browsers and pins

Builds are read from the app bundles, since a user agent names only the major version. Each Firefox copy gets its update
policy before its first launch, since a pinned Firefox once updated itself (`browsers.ts` has how). Safari can't be
pinned, and a macOS update moves all three browsers (system fonts, Core Text, ICU, emoji). `repin` records every case
with the new build into a scratch copy of the recordings and prints the cases laid out otherwise, the new page history,
and whether the browser's break data still matches `scripts/engine-data/`.

webkit-host lays text out as Safari 27.0 does: the same line geometry on 25,180 cases in both orders (2026-09-17, in
the per-engine rebuild's harness) and on installed Safari's 2,000-case sample here, where the 1,990 cases pinned in both
recordings are identical, widths included, and the other 5 are page history in webkit-host (2026-09-24). That
compares the browsers' layouts only. Pretext's predictions aren't scored in installed Safari: it has no accepted list,
so `check --browser=safari` would report webkit-host's accepted failures as new, and its sample holds none of the cases
added since it was drawn. A Safari or macOS update voids the comparison, and no command makes it again: `repin safari`
records both browsers and prints each one's drift against its own earlier recordings, never one against the other, so
compare the two scratch recordings by hand, over the cases pinned in both. Installed Safari stalls when hidden (WebKit
suspends a hidden page past a CPU limit averaged over 8 minutes), so keep its window uncovered during a job.

Firefox changes fonts after it starts (see also `PLATFORM_BUGS.md`, the late family names): emoji beside Arial laid out
otherwise when recorded 11 s after launch than at 12, 15 or 30 s (91 cases, 2026-09-24), so each Firefox job holds its
first document until 15 s.

## Other ratios and phones

The checked-in recordings are one setup, macOS at device pixel ratio 2. A run outside it keeps its recordings and lists
in a store, a harness folder outside git (`--store=<dir>`, `.artifacts/harness-store` by default), and the environment
key carries the ratio, Chrome's zoom and a simulator's builds, so a store holds one setup per browser and `check`
refuses to score another. A new store has no accepted list, so every failure reads as new; copy `accepted/` and
`varying/` into it first and `check` blocks on what differs from the checked-in setup: the new failures fail there only,
and the accepted cases that pass, pass there only. These runs are evidence; nothing gates on them.

- **`--scale=<n>`** runs Chrome and Firefox at device scale factor n (Chrome's `--force-device-scale-factor`, Firefox's
  `layout.css.devPixelsPerPx`), and **`--zoom=<n>`** runs Chrome at that page zoom, on `record`, `check`, `gate` and
  `explain`; webkit-host has no switch for either. Inside what Pretext claims, the sample was wrong on 0.49%, 0.51%,
  0.50%, 0.49%, 0.50% and 0.49% of paragraphs in Chrome 154.0.8037.57 at ratios 1, 1.25, 1.5, 2, 2.5 and 3, and on
  0.13%, 0.14%, 0.15% and 0.15% in Firefox 156.0.1 at 1, 1.5, 2 and 3; at most 5 of 11,901 cases flip against ratio 2,
  none at 3 (2026-09-30). Chrome's page zoom is the same number to its layout: at 125% on a ratio-2 display it recorded
  every sample case as at ratio 2.5, widths included.
- **`--browser=ios --runtime="iOS 26.0"`** runs Safari in an iOS simulator. Each job makes a device of that runtime's
  first iPhone, boots it with `xcrun simctl` alone, so Simulator.app never opens, opens the page in its Safari and
  deletes the device; a boot takes about a minute. The cases are Safari's, so webkit-host's lists copied to
  `accepted/ios.txt` and `varying/ios.txt` compare it with Safari 27. Safari 26.0.1 in the iOS 26.0 simulator (23A8464)
  was wrong on 0.29% of the sample's paragraphs inside what Pretext claims, against 0.08% in Safari 27: of the 30 cases
  failing there only, 29 are `keep-all` paragraphs and one has a curly quote beside Hangul (2026-09-30; the WebKit
  profile follows Safari 27 only, `RESEARCH.md`, Decisions Log). No iOS 27 runtime was installed, so iPhone Safari 27
  has no number yet.

## Bounds and blind spots

Every job and its children have a memory and a time limit (`watchdog.ts`), since a planted defect, a deliberately broken
copy of `src/` run to prove a check catches it, is exactly the input that makes a loop run away: on 2026-09-25 three
orphaned test processes running such defects, with no timeout, held 42-49 GB each and froze a 36 GB Mac. A job's browser
is capped too (`browsers.ts`). The harness closes its browsers when it exits or is interrupted, but a SIGKILL leaves
them running: find them by their profiles (`pgrep -fl .artifacts/harness-profiles`, and `pgrep -fl webkit-host`) and
quit them, and delete a simulator device it left (`xcrun simctl list devices | grep pretext-harness`). Long paragraphs
are recorded by binary search over DOM `Range` rectangles for each line's end, not by reading every character's
rectangle (`observe.ts`): reading them all took 31-74 s natively on a 256,837-unit Arabic paragraph while building the
per-engine rebuild (branch `rebuild-20260916`, a from-scratch port of each engine's line breaking, kept as the
plain-text correctness reference; September 2026). Tools delete their own scratch files with `rmSync`.

The harness can't see the hyphen drawn at a soft-hyphen break: recordings keep no glyphs, and a rule over the boxes
found 93-358 mismatches per browser, some the recording's (2026-09-24), so it's left to `src/layout.test.ts`. A recorded
line width is the extent of the line's text boxes (`observe.ts`), which leaves out a padded span's padding at either end
of a line, so the shrink-wrap check can't fail on such a line and the width report counts the padding as a difference.
In webkit-host and Safari a line that ends in a space with a box, as a pre-wrap line that wraps at a space does, is
recorded in whole pixels, up to a pixel narrower than drawn: the recorder takes the space off by its box, which WebKit
rounds (`types.ts`, `wholePixelBoxes`). The width report leaves those lines out and prints how many: with them 8.6% of
the lines of webkit-host's passing sample draws inside the claims were more than 0.05 px off, without them 0.8%
(2026-10-01). The shrink-wrap check keeps them, so there it misses a box up to a pixel too narrow where such a line is
the widest, as in a fifth of the sample's pre-wrap draws, and webkit-host's `narrow` column reads low on pre-wrap text.
The harness doesn't see re-layout at a line's own width; a defect that changes the widths a prepared handle keeps for
one way of fitting lines when another is used (the stand-in Canvas gives the same widths to every way); a bracket-pair
error in the Gecko bidi port; several rules of the Gecko profile's analysis of bidi controls (`ENGINE_FOLLOWUPS.md`,
Harness debt); an emoji modifier split from its base across rich items; a rich paragraph of one item, which the adapter
writes as plain text, so `src/layout.test.ts` checks its line functions against the rich stepper; which line holds a box
of width 0, which has no rectangle, but through the text around it; Chrome's UI language, and so its `zh` table for
pages without a `lang`; rendering other than macOS's and an iOS simulator's (Other ratios and phones), though Android
and Windows are 65% of page views (`weights.json`);
text chat users wrote (the sample's chat draws are stand-ins); or the demos' painted layout. No planted defect guards
the watchdog's kill, the bench's shuffle and its separate compiles (each copy of the library compiled in a module of its
own), Firefox's start-up hold, the page passing the browser's name to the recorder, or the cap on a job's browser.
