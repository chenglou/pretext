# Bench notes

What the Bench section of `harness/README.md` leaves to this file: each row's texts and the code they reach, the
measurements behind the protocol, how the floors were fitted, and the entries known to misread. An *entry* is one table
row: one operation on one document's texts.

## Rows

Speed claims rest on `bun harness bench`'s same-document ratios. Its rows (`new`, `fresh`, `rich`, `seen`, `resize`,
`lines`, `worst`) follow what an app does; never rank `prepare()` against `layout()`, as one is paid once and the other
on every resize. The `new` rows time text no library or browser has laid out: Firefox and Safari keep shaped text per
font, shared by every canvas and the DOM, so a fresh canvas doesn't make text new. The `fresh` rows are the one kind
with no same-document ratio: each document holds one library, and times compiling its bundle, running it and its first
two batches of new messages, which the table after the rows gives as medians per library, with no verdict. The `rich`
row has three documents: `latin`, the stress items, a word or a space each; `chat`, the Markdown chat demo's paragraphs,
list items and headings as it prepares them, 86% of them one item; and `chat-styled`, only its paragraphs of several
items, where an item is several words and 37% of the paragraphs (40% of the ones the line operations run on) hold an
item that starts inside a word, with no space on either side of its start: punctuation right after a styled run (a
comma, a full stop, a closing bracket) or a code run right after an opening bracket, never a letter after a letter. A
change can read faster on one and slower on another: the stress items never start inside a word and have a segment an
item. Each one's `rich-new` gives every library a batch of its own a round: 1,000 units of the stress items, which the
length of the Latin text caps (The Great Gatsby's opening, which the `new` and `fresh` rows read forward too), and 4,000
of the demo's paragraphs, which differ more from one batch to the next than prose does. The demo repeats sentences, so
its batches are paragraphs of words mostly seen, and 6% of `chat`'s new paragraphs repeat an earlier one whole. Each
one's `rich-seen` prepares its kept paragraphs again, where every item looks its font up and measures nothing.
`rich-new` and `rich-seen` both time `prepareRichInline()` followed by one `measureRichInlineStats()` of what it
returns, so a figure for either entry is the cost of both calls. Each one's `rich-walk` and `rich-stream` keep every
line they are handed, in one variable outside the loop, as an app that paints its lines keeps them: both rich demos, the
Markdown chat and the rich note, pass each line they walk to `materializeRichInlineLineRange()`. A callback that reads
only the line's width times less than an app pays, and not the same less for every library, since an engine that inlines
a library's line builder into the walk then never makes the line. So a `rich-walk` or `rich-stream` figure from before
#456 isn't comparable with one after it, on the stress document either (`RESEARCH.md`, Evaluation Traps, Timing, has the
numbers behind the batches and the kept line). The `lines` row times the line functions on mixed, Latin and CJK
messages, each family in a document of its own. Nearly all of those messages take the simple stepper
(`stepPreparedSimpleLineGeometry()`, `src/line-break.ts`) and not the full walker (`walkPreparedComplexLines()`), which
lays out the text the simple one doesn't cover: in every engine profile all 147 Latin and all 134 CJK messages do, and
133 of the 134 mixed ones, 19,905 of their 20,000 units (prepared on the stand-in Canvas at bf62c76a, 2026-10-09). So
the row times the simple stepper, not the full walker, and a verdict there on a change that touches only the full walker
isn't that change's cost: it comes from how the browser runs the changed bundle, or from chance. The `worst` row times
the full walker, which lays out all of `cjk-letter-spaced` and `pre-wrap-chunks`, 99% of the units of
`soft-hyphens-marks` and 25% of those of `invisible-tails`, and in the WebKit profile 34% of those of `controls`; in the
other profiles `layout()`, the one line function the row runs on `controls`, counts those texts with the simple stepper
and hands the full walker only the lines that end where the text has no break (`countSteppedLines()`). None of the text
of four more of its documents goes to the full walker, and two run no line function: `hindi-letter-spaced` and
`arabic-letter-spaced`, 94 Hindi paragraphs in 16px Kohinoor Devanagari and 400 Arabic ones in 16px Geeza Pro at a 0.5px
letter spacing. Theirs is text of WebKit's complex path, where the WebKit profile asks Canvas, under a `letterSpacing`,
how many glyphs each prefix of a word new to the library spaces (`getExtraSpacings()`, `src/measurement.ts`). Their
`prepare` prepares the texts again, as every document's does, and measures nothing. Their `prepare-cleared` calls
`clearCache()` before each pass over the texts, so a pass measures them all again: text the browser has shaped and the
library hasn't, as an app's is after a font loads. WebKit keeps no width measured under a letter spacing, so in
webkit-host that entry is mostly those calls, the only entry that times them: a build that asks none of them, as main
before the glyph spacings did, costs a tenth as much there.

## Protocol

- **A control copy.** Each document runs base, the candidate and a second copy of base, shuffled each round, since only
  same-document ratios survive drift between sessions (`RESEARCH.md`, Evaluation Traps, has the numbers behind this
  section).
- **A quiet machine, and power.** Using the machine spoils the sessions it overlaps, and only those; a loaded machine
  spoils them all, whatever the windows, so a run is timed alone. Time on mains, from an adapter that charges the
  machine under load, or on a battery above 20% charge: at 20% and under the machine throttles, some operations more
  than others, so the ratios of a run that starts or ends there are void as well as its times, and no run starts there
  (`RESEARCH.md`, Evaluation Traps, Timing; a run prints its power source and charge as it starts and as it ends).
- **Background windows, side by side.** The bench times in the harness's own windows, webkit-host for WebKit, which need
  no focus, so every session of every browser runs at once, each in a browser process of its own: three sessions by
  default, since a third costs no time and three need no confirming one. A bench is one busy thread a browser and a
  verdict rests on ratios inside one document, so sessions side by side share the machine's cores and not each other's
  samples, and a run takes its slowest session's time. Five runs of main against itself took 133 to 136 s each, where
  the foreground bench of the same build took 689 s that morning, and were called on 0, 0, 1, 2 and 2 of 192 entries by
  the foreground's floors (the foreground run on 1) and on 0, 0, 0, 0 and 2 by their own (Floors); two more that
  afternoon, with other work on the machine, took 150 and 157 s and were called on one entry each (bac1774c, 2026-10-11,
  Chrome 154.0.8037.98, Firefox 157.0.1 and webkit-host on WebKit 22625.1.29.11.27, no other browser job beside any
  run). #435's slowdown of `worst: long-breakable-runs layout` (07834b75 against 664082af, about 8% in its own
  foreground table in Chrome and in Firefox) was timed four times that day, in 137, 153, 146 and 143 s. Chrome's was
  called in all four, at +5.8% to +13.9% by session. Firefox's was called in the first, at +10.3%, +11.8% and +17.7%,
  and in the last, at +6.1%, +6.2% and +8.6%, and not in the two between, which read +1.0%, +7.8% and +11.8%, then
  -0.8%, +8.5% and +4.3%: Firefox keeps a copy at one of two speeds for a document on that entry (base's copy ran at
  0.531 µs per 1,000 units in the session that read +1.0% and at 0.507 in the two beside it, and the control, base's
  own code, sat 2 to 6% from base in every session of the first three runs), so two of its twelve sessions read the
  change level, and three sessions that must all agree call it in some runs only (Reading a table).
- **Why a background window times as a foreground one.** The harness's Chrome starts with
  `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows` and
  `--disable-renderer-backgrounding` (`browsers.ts`); webkit-host's window reports itself visible whatever covers it
  (`webkit-host/main.swift`); and the page yields with a `MessageChannel` message between samples, never a timer or an
  animation frame, which are what a browser slows in a window it takes for hidden (`bench/page.ts`; its one timer waits
  for the focus, in the foreground form). The busy thread of Chrome's renderer and of WebKit's web content process ran
  at priority 47 and Firefox's at 31 in background windows and in foreground ones alike (`ps -M` every 5 s through five
  background benches and a foreground one, 2026-10-11). In the runs saved from 2026-09-27 to 10-10 the control, base's
  own code, sat as far from base in background windows as in foreground ones: read as a change against its row's floor
  over three sessions on 1.9% of 5,039 entries and on 1.7% of 17,280. The one case left is a Firefox window covered
  whole, whose page is hidden and whose process Firefox then slows: one saved Firefox session of 497 had six such
  documents, timed 1.7 to 4.4 times slower. A table counts the documents that ran hidden, under the browser's rows and
  in the last lines of the output; time again when it counts any. Firefox's window keeps its size for that reason
  (`harness/README.md`, Browsers and pins).
- **What side by side costs** is speed and spread: the machine has six fast cores, and nine sessions are more busy
  threads than that. In the five runs above a browser's median entry cost 1.3 to 1.6 times what it cost in that
  morning's foreground run (webkit-host's against installed Safari's, which runs the same WebKit; entries of 2 µs or
  more per 1,000 units), and a copy of base sits further from base by chance: on `seen` and `lines`, whose floor is 1%
  in the foreground, a copy held more than 1% in one direction through all three sessions of a run 62 times in 1,215,
  which is why this form has its own floors (Floors). One browser at a time (`--browser=`) times three sessions at once.
  The browsers one job has open are bounded together at two thirds of the machine's memory, the one holding the most
  killed first (`browsers.ts`): nine sessions each within their own 6 GB bound add up to more than the machine holds.
- **The foreground form** (`--foreground`) times pinned Chrome and Firefox and installed Safari one at a time, each
  window visible and focused throughout: the page checks both around every sample, and a document that loses the focus
  waits a minute and starts again. It is the form the bench had until 2026-10-11, and a release's bench against the last
  release keeps it (`DEVELOPMENT.md`, Releasing): it times installed Safari, the browser a reader has, which no
  background window can.
- **Two sessions and a confirming one.** A row reads slower or faster only when it does so in every session, and the
  floors are fitted to three, where two agree by chance: in the 19 runs of three sessions saved on 2026-10-02, the first
  two called 74 of 322 rows and the third took 22 of them back. So after the foreground form's two sessions each browser
  times the documents of its rows that read slower or faster once more, and a row keeps its verdict only if that session
  agrees. That is the verdict three whole sessions give, as a row two sessions don't call a third can't. A verdict left
  with two sessions, as when the confirming one failed, prints "(unconfirmed)". `--sessions=1` is a hypothesis and gets
  no confirming session; three or more need none, which is every run side by side.
- **The quick form** (`--quick`) times every row with a verdict in three sessions of three rounds a document, where the
  default times twelve or sixteen, and no fresh pages; the `new` row keeps its twelve rounds, which cost half a second.
  A reading's spread is mostly between documents, where a copy of a library keeps one speed, not between a document's
  rounds: replayed over the 16,652 entries saved with three sessions from 2026-09-27 to 10-11 (872 runs), three sessions
  read over their first three rounds give the verdict of all their rounds on 96.3%, and keep 97% of its calls of 20% or
  more, 85% of those of 10 to 20%, 71% of 5 to 10%, 70% of 2 to 5% and 28% of those under 2%. Timed on 2026-10-11, a
  quick run took 42 to 44 s; main against itself was called on 4, 3, 4, 3 and 4 of 192 entries in five quick runs by the
  foreground's floors and on 3, 1, 3, 2 and 3 by the floors of sessions side by side, which no quick run was fitted to;
  #435's slowdown was called in Chrome in both of two quick runs and in Firefox in neither, where the default called
  Chrome's in four runs of four and Firefox's in two; and a build with work planted in it (15% more counting in
  `layout()`, 5% more walking in `measureLineStats()`, 15% more Canvas calls on new text) was called on 52 and 50
  entries by either form's floors, where the default called 71 by the foreground's and 67 by its own. So it says where
  to look while a change is being written, a call or a level reading there is a hypothesis, and the table a change
  lands on is the default's.

## Reading a table

- **A row without a verdict prints its widest band**, as in "within noise (±11.5%)": the smallest change those sessions
  could have called on it. A session's band is the larger of the row's floor and how far the control, base's own code,
  sat from base, so most rows print their floor. A copy of the library can keep one speed for a whole document and
  another in the next (Chrome 154's rich stats ran at 2.3 or 2.6 µs per 1,000 units copy by copy, 2026-09-30), and the
  band is then the distance between two copies: on 2026-10-01 and 02 the control sat 8% or more from base in a session
  of 12 of 13 runs of Chrome's rich stats, 11 of 13 of Safari's rich walk and 8 of 13 of its rich stream, and in most
  runs of Chrome's CJK and Thai `new` rows, whose spread is between batches of text. Such a row says nothing of a change
  smaller than its band: time it again alone with more sessions (`--rows`, `--sessions`) when the change touches what
  the row times.
- **The band misses a slow copy that is the candidate's.** Where one copy of three keeps another speed for a document, a
  session reads level when that copy is the control's and as a change when it is the candidate's. Chrome 154 runs one
  copy of main about 12% slower than the other two on the chat documents' `rich-seen` (47.5 or 53.5 µs per 1,000 units
  on `chat`, 58 or 65 on `chat-styled`), a different copy from session to session, and Safari 27 does the same on the
  stress document's `rich-walk` and `rich-stream`; on its `rich-seen` the two copies of main can stand as far apart
  through a session's rounds: 64.6 and 57.0, 64.9 and 54.5, and 57.5 and 60.5 µs per 1,000 units in the three sessions
  of one run of main at #455 (2026-10-07). Main against itself read Safari's stress `rich-stream` 12-15% slower in all
  three sessions of one run, which called it slower, and Chrome's `chat-styled rich-seen` 10-13% slower in 7 sessions of
  11 (2026-10-07; `RESEARCH.md`, Evaluation Traps, Timing). When the slow copy is base's, a real slowdown reads level:
  Firefox read #435's 8% on `worst: long-breakable-runs layout` at +1.0% and at -0.8% in two sessions of twelve, and so
  called it in two runs of four (2026-10-11; Protocol). Read such an entry over ten sessions, and by each copy's own
  cost in the saved samples, since the table prints base's and the candidate's medians only: the line a run prints as it
  starts names their folder, `.artifacts/harness-bench/<time>/`, which holds one file for each browser and session, with
  each round's `ms` and `units` by `label`, and a `run.json` that names the two builds and how they were timed.
- **The builds.** The first line of the output names base and the candidate with their commits and dates, and says when
  this tree's `src/` has uncommitted changes, so a pasted table says what it compared. Two builds whose bundles are the
  same bytes, as after a change to comments or types alone, aren't timed: the bench says so and starts no browser. One
  build named on both sides (`bun harness bench HEAD --lib=HEAD`) is timed against itself. A candidate given as a folder
  outside any checkout (`--lib=<dir>`) is minified with other names than the same source given as a commit: the
  repository's `package.json` (`"sideEffects": false`) isn't above it, and 241 names of main's bench bundle differ, one
  for one, at the same length (bf62c76a, 2026-10-09); the `src/` of another checkout, a worktree's too, has that file
  above it and gets the commit's names. Some rows move with those names (Entries that misread), so a figure a decision
  rests on names commits on both sides, and a build that is no commit goes inside a checkout, as under this one's
  `.artifacts/`, where it gets the names a commit gets.
- **The last lines** are for a pull request to quote in place of the tables, of whose 204 rows nearly all read within
  noise: one line with the builds, the sessions, the browsers, the form, the wall clock and how many entries read
  slower, faster and within noise, then each entry that read slower or faster with its readings by session and the
  control's, or a line that says none did. That line also counts the documents that ran hidden and names a browser that
  failed a session, since a reader of those lines alone has to know to time again.

## Floors

- **Floors**, the noise threshold under which a row's ratio isn't called a change (1-6% by row, `FLOORS` in
  `bench/report.ts`, with the builds and machine they came from), are the largest deviation held in one direction in all
  three sessions of a calibration of HEAD against itself. Each form has its own: calibrate again after a pin bump or on
  another machine, with `bun harness bench HEAD --lib=HEAD` for sessions side by side, several runs of it, and with
  `--foreground --sessions=3` added for the foreground's.
- **The floors of sessions side by side** are 2% on `seen` and 3% on `lines`, and the foreground's on the other rows.
  The rule was applied a run at a time to the 22 runs of every row saved on 2026-10-11 at bac1774c (Chrome
  154.0.8037.98, Firefox 157.0.1, webkit-host on WebKit 22625.1.29.11.27, each run alone on the machine): five of main
  against itself, where the candidate and the control both count, and 17 of other builds against main, whose control is
  the same code against itself (one of them with other text in its CJK documents; the floors come out the same without
  it). `seen` held 2% or less in all 22 runs and more than 1% in 11; `lines` 3% or less in 19 and more than 1% in 20;
  and both hold it on entries of every browser (8 of the 15 `seen` entries and 23 of the 30 `lines` entries in some
  run), so their 1% doesn't fit this form. `rich` and `resize` held their 5% or less in 18 and 19 runs. `new` held its
  6% or less in 8 and `worst` its 2% or less in 12, but what holds more there is copies that keep another speed for a
  document and batches of new text that differ, which the band covers and no floor short of that distance does (the
  foreground's `rich`, below): 13 of the 14 readings over 2% on `worst` are on eight entries whose copies sit 4.7% or
  more from base in a tenth of their sessions, and every `new` entry sits 8% or more from base in a tenth of its. Floors
  that three quarters of the runs fit within would be 12% on `new` and 4% on `worst`, and at 4% a change of 5% on
  `worst` is called on 37% of its entries where 2% calls it on 76% (main's five runs with a copy multiplied by 1.05, the
  three copies in every role). With these floors main against itself is called on 0, 0, 0, 0 and 2 of 192 entries in its
  five runs, where the foreground's call 0, 0, 1, 2 and 2, and on 16 of 5,760 with the copies in every role, where they
  call 31; the controls of the 17 builds hold more than their row's floor on 34 of 3,264 entries, where they held more
  than the foreground's on 72, 41 of those on `seen` and `lines`. What that costs: a change of 3% is called on 38% of
  `seen` entries and 10% of `lines` entries, where 1% called it on 56% and 38%; one of 5% on 84% and 55%, where it was
  86% and 73%; one of 8% on 97% and 92%, as before within a point. A change under about 5% on those two rows wants the
  foreground form, or more runs. The letter-spaced Hindi and Arabic documents joined `worst` on 2026-10-12 and take
  its 2%: in five runs of the row, a build against itself (e440dd64, the same browsers and machine, each run alone), a
  copy held 2% or less on their twelve entries in 118 of 120 readings, 1.6% at most in webkit-host, and one entry was
  called, Firefox's `hindi-letter-spaced prepare-cleared`, at -5.8%, -2.5% and -4.2%. Two runs of the row with main
  against itself (abd3e10b, where a pass of `prepare-cleared` costs webkit-host a tenth as much) called none of its 66
  entries; a copy held more than 2% on three of those twelve entries' 48 readings, none in webkit-host: Chrome's
  `hindi-letter-spaced prepare` 2.5%, and Firefox's `arabic-letter-spaced prepare-cleared` 2.2% in one run and 4.0%,
  on the control, in the other.
- **The foreground's floors.** Floors from the worst single reading would be too wide, since one copy can run slow for a
  whole document (in one session Firefox 156.0.1's base copy took about twice as long as the other two on kept CJK
  handles, 2026-09-26), and would have hidden a real 20-25% slowdown. These floors flag all four slowdowns known between
  main before #340 (6d1d2106) and 217c84b8, a commit of #340: pre-wrap layout and walk at 1.05 of base's time in Chrome
  and 1.18-1.25 in Firefox, and letter-spaced CJK and control layouts at 1.12 and 1.20 in Safari. One floor serves a row
  in all three browsers, and the `lines` row's Latin and CJK entries, added after that calibration (#416), take the
  row's (`ENGINE_FOLLOWUPS.md`, Harness debt). The `rich` row's was fitted to the stress items with a callback that read
  only a line's width; with the kept line and the two chat documents, main against itself was called on none of the
  row's 45 entries in a run of eight sessions of the row or in a run of three sessions of every row (e1c6ed68,
  2026-10-07), so the row keeps it. A verdict needs every session to agree, so a run of eight says less than a run of
  three: three at a time, those eleven sessions call a chat entry in Chrome in 37 of their 165 sets
  (`chat-styled rich-seen` in 35, 20 of them `chat-styled rich-new` too: the slow copy was the candidate's in 7 of the
  11 sessions, where an even shuffle makes it a third of them and a call once in 27 runs), a rich entry in Safari in 12
  (the stress `rich-stream` in 10) and in Firefox in 2. By the letter of the fitting rule the run of three sessions of
  every row would give 7%, from the control's copy on Safari's stress `rich-walk` (6.2%, 15.4% and 20.9% over base), an
  entry where a copy keeps a speed: the band covers a control's copy, and no floor short of the distance between two
  speeds covers a candidate's (Reading a table).

## Entries that misread

- **WebKit's width cache** samples one Canvas call in 21 after a run of misses, so a prepare that submits n strings
  speeds up only after 21 / gcd(n, 21) repeats: compare submitted text and cold first prepares.
- **Firefox's `resize: latin layout at new widths`** moves about 16% with the names the bench's minifier gives the
  bundle's top-level bindings (`RESEARCH.md`, JavaScript Engines; Firefox 156, 2026-10-02), so where it alone reads
  slower or faster, with Firefox's other `layout()` rows level and no change to code `layout()` runs, it is read as the
  names and not the change: a build one unused local apart gets other names and settles it. Writing the constants that
  loop reads into the built code as numbers ended this for that loop and was declined (#406; `RESEARCH.md`, Decisions
  Log, 2026-10-03), so the row still moves with the names.
- **Firefox's `worst: controls layout` and `worst: invisible-tails layout`** read 15.8% and 5.9% slower under #409 and
  16.8% and 8.7% slower under #406, two unrelated changes timed against the same main on the same day (Firefox 156.0.1,
  three sessions each, 2026-10-02), so they move with unrelated changes to the bundle and want a second change's table
  before being blamed on one.
- **Safari's `resize: latin layout at widths seen before`** read 9-15% slower in six sessions of a build whose
  `layout()` code was main's, and within noise for the same code one top-level binding apart (Safari 27.0, 2026-10-06;
  `RESEARCH.md`, JavaScript Engines). Where it alone reads slower or faster with no change to code `layout()` runs, time
  a build one binding apart before blaming the change.
- **A verdict on one of those three Firefox rows** prints "(moves with the bundle)" in Firefox's table and in the
  output's last lines (`MOVES_WITH_BUNDLE`, `bench/report.ts`). The list is Firefox 156's: after a pin bump a row stays
  on it only while unrelated changes still move it.
- **Firefox's `resize: cjk layout at new widths`** moved with two changes to preparation code, which `layout()` never
  runs, and isn't on that list: it read 8.6% to 10.8% faster under #512 and 6.1% to 12.6% slower under #513 after it,
  the Gecko profile's handles the same under each, and level across the two (-0.6% [-2.5%, +1.8%] against main before
  #512, six sessions; Firefox 157.0.1, 2026-10-12). Under #513 it read the same one do-nothing top-level variable apart,
  and level with main's `src/prepare.ts` under #513's `src/measurement.ts`, a build that also lacks the three top-level
  bindings #513 adds. So it comes with the 42 lines #513 changes in `measureAnalysis()`, of which the Gecko profile runs
  two tests a segment and no allocation, or with those bindings: one variable more needn't move the names that matter. A
  reading of 6% to 13% there with no change to code `layout()` runs wants a second change's table before being blamed on
  one. A third change moved it and does change that code: #525, which lays a zero-width space out as content, as first
  built took a test out of `countPreparedLines()`'s loop where a line starts and swapped one where it ends, and now
  makes one test of the two, where a line starts, and reads a segment's kind only there. As first built the row read
  5.4% to 8.4% slower over six sessions and 8% to 15% in three runs of every row, on messages that hold no zero-width
  space and all take that loop; as much with main's two tests put back (5.8% to 11.3% in five sessions, 51.6% in a
  sixth) and with one do-nothing top-level variable more (4.7% to 10.3%); and level under a narrower form of the same
  change that leaves the loop as it was (medians of +0.4% to +1.1% in three runs of every row). `lines: cjk walk` read
  5.5% to 7.7% slower with it over six sessions, and 5.9% to 10.0% with main's stepper and line start put back, where
  the Latin messages' entries then read level. Moving the full walker's tests for a zero-width space under its test for
  a break segment, code neither row runs, left the two as they were over six sessions, +4.5% to +12.1% and +6.4% to
  +8.4%, while two runs of every row called neither: in each, one session of three read 10% to 13% slower and the other
  two -2% to +5%, so Firefox keeps a copy at one of two speeds on these rows. The converse builds read level over six
  sessions each: main with the change's two tests in the loop, -1.3% to +2.9% on the first row, main with one do-nothing
  top-level variable more, -1.4% to +1.1%, and main with the change's stepper and line start, -1.8% to +1.6% on
  `lines: cjk walk`, where the Latin messages' entries read 3% to 9% faster. So both readings come with the rest of the
  change's bundle and not with the loops they run, and one variable more doesn't make them. Builds of main with one of
  the change's files each place the first: main with the change's lines in `measureAnalysis()` (`src/prepare.ts`), which
  no text of that row runs, read it 5.8% to 9.5% slower over six sessions and 3.8% to 8.6% over six more, where main
  with the changed analysis read level in three runs of six (medians of +0.2% to +2.4%) and main with the changed
  analysis and line walkers level too (+1.5%). On that src the two rows read +5.4% to +9.5% and +7.8% to +11.6% (Firefox
  157.0.1, 2026-10-14). The change then took those lines out again: the analysis marks the soft hyphen that is a
  zero-width break where it classifies it, and `measureAnalysis()` is main's but for one test (3102bd1c). Against the
  commit before it, six sessions read the first row -4.0% to -9.8% and `lines: cjk walk` -0.7% to -9.6%, medians of
  -7.8% and -6.1%, and against main the change's last src reads them -0.2% to -4.4% and -0.7% to +1.9% over six sessions
  (2026-10-15; `RESEARCH.md`, Decisions Log, 2026-10-14). What Firefox reads with the loop's one test is under the next
  entry.
- **Firefox's `resize: latin layout at widths seen before`** reads 12% to 23% slower since #515, and that is no
  misreading: the change runs that code. Removing entry geometry (2ece40cb), the widths the library measured afresh for
  a line that starts inside a word at an invisible character, takes one test out of the loop in which
  `countPreparedLines()` fills a line with the graphemes of a word longer than the line, and adds nothing to it. Six
  sessions of Firefox's resize rows alone read the row +12.0% to +22.7%, called, and the same loop at new widths 1.5% to
  8.3% faster, within noise; the run of every row read it +13.4% to +15.2%, called, with Chrome and webkit-host level
  (Firefox 157.0.1, Chrome 154.0.8037.98 and webkit-host on WebKit 22625.1.29.11.27, 2026-10-12, against main before
  #515). By commit, six sessions each: +2.9%, +5.6% and +3.4% at the three removals before that one, +14.2% at it and
  +11.8% at the commit after it, medians that no run called, in bands of ±9.5% to ±14.3%. It isn't the bundle's names,
  as it is at new widths (above): with one, two and three do-nothing top-level variables, in builds from a folder
  outside any checkout, the row read +14.6%, +11.7% and +14.8%, medians of six sessions again, not called. So it is how
  Firefox 157 compiles the shorter loop, a cost that is recorded and not coded around (`RESEARCH.md`, Decisions Log,
  2026-10-12). A reading of that size on this row against a base from before #515 is this. #525 moved it again, and
  three more entries with it. Its last form of that function's main loop asks once whether a segment is a space, after
  the block that ends a line, where main asked in each of two branches, and reads a segment's kind only there. By that
  commit alone (9f004030 against its parent, six sessions of each browser's `resize` and `worst` rows; Chrome
  155.0.8059.80, Firefox 157.0.1 and webkit-host, 2026-10-15) Chrome read all ten `resize` entries 6% to 31% faster and
  `layout()` of four `worst` documents 6% to 35% faster, each called; webkit-host read the ten 6% to 17% faster by the
  median and `layout()` of five `worst` documents 5% to 15%, four entries called; and Firefox read this row +11.7%,
  Thai's +15.0% and Arabic's +6.3% by the median, and `worst: controls layout` and `worst: invisible-tails layout`
  +13.6% to +15.4% and +10.3% to +16.9%, called, with every entry at new widths within 3%. It comes with the one test,
  wherever the kind is read: with the kind read at every segment, as main reads it, Firefox read the three rows +10.7%,
  +15.5% and +7.0% and `controls layout` +11.3% to +15.4%, and Chrome and webkit-host kept most of their gain (Chrome's
  `resize` entries 6% to 20% faster by the median, webkit-host's 3% to 15%). With main's two tests and the kind read
  only at them, Firefox read this row 7.8% to 18.3% faster and `resize: latin layout at new widths` 22.7% to 36.7%
  slower, and Chrome read every `resize` entry within 1% and `layout()` of three `worst` documents 7% to 13% faster. So
  Firefox's readings of this loop swing both ways with its form, on the same work or less, and Chrome's on `resize` come
  with V8 inlining the function into `layout()`: it is 474 bytes of bytecode on main, 461 as #525 was first built, 475
  in that last form and 450 with the one test, wherever the kind is read (Node 23.10's V8 12.9), and V8 inlines a
  function of 460 or fewer (`RESEARCH.md`, JavaScript Engines, the 460-byte budget), so an edit that takes it back over
  460 gives that gain back. The form is the one the code asks for (`RESEARCH.md`, Decisions Log, 2026-10-14). Against
  main the change's last src reads this row +3.8% to +12.9% in Firefox over six sessions alone, Thai's +13.7% to +18.9%
  and `worst: controls layout` +11.9% to +16.5%, both called, and `worst: invisible-tails layout` +6.1% to +15.0%. Two
  runs of every row read this row +3.6% to +6.9%, called in one, and Thai's -6.8% to +1.8%, where the six sessions alone
  read it 14% to 19% over; both called `controls layout`, +15.8% to +20.3%, and `invisible-tails layout`, +5.2% to
  +17.1%, and one called `worst: long-breakable-runs layout`, +18.2%, +17.2% and +2.5%, which six sessions alone read
  -10.2% to +8.6%.
- **Chrome's `lines: mixed stats`** read the candidate's copy about 1% over base's on identical code, in 15 of 16
  sessions of main against itself and with the code the bench wraps a library in (`ENTRY`, `bench/lib.ts`) as it was
  before and after #456 (Chrome 154.0.8037.98, 2026-10-07; `RESEARCH.md`, Evaluation Traps, Timing), and the row's floor
  is 1% in the foreground. A reading of about 1% slower there, alone, is this.
- **Firefox's `new` row side by side.** A copy of base sat 11 to 14% from base in the median session of its `cjk`,
  `mixed`, `latin` and `arabic` entries, and 27 to 45% in a tenth of their sessions, where Chrome's and webkit-host's
  `new` entries sat 3 to 9% and 8 to 20% (the 22 runs under Floors, Firefox 157.0.1, 2026-10-11). Its bands are that
  wide, so an entry there says nothing of a smaller change, and one it calls has its control nearly as far out: read a
  change to new text in the other two browsers' rows, and time Firefox's again alone (`--browser=firefox --rows=new`) or
  in the foreground before quoting it.
- **webkit-host's `worst: cjk-letter-spaced prepare`.** A copy of the library can keep another speed for that document:
  a copy of base's own code sat 18% to 33% from base in 11 of 94 session readings (the controls of 17 runs and the
  candidates of the seven of them that timed a build against itself, with abd3e10b, 3585bb66 or e440dd64 as base;
  2026-10-11 and 12, webkit-host on WebKit 22625.1.29.11.27), and a build against itself was called slower there in
  one run of five, at +10.0%, +23.0% and +23.5% (e440dd64). The band covers such a copy only when it is the control's
  (Reading a table), so read a change to letter-spaced CJK preparation there over ten sessions (`--rows=worst
  --browser=webkit-host --sessions=10`).

## Session times

Side by side, a run takes its slowest session's time: a session of every row took 84 to 88 s in webkit-host, 97 to
101 s in Chrome and 131 to 138 s in Firefox with nine at once, and a run 133 to 138 s (24 runs, 2026-10-11); with the
two letter-spaced documents two runs took 142 s each, Firefox's sessions 140 to 142 s (2026-10-12). In the
foreground a session of every row takes 96 s in Chrome, 117 s in Firefox and 98 s in Safari (six sessions each,
2026-10-07; a document that loses focus waits a minute and starts again): a little over ten minutes for the two, and
then the confirming sessions, which would have timed 57 of the third sessions' 145 documents in the 19 runs above
(Protocol). A quick run took 42 to 44 s. Nothing timed is checked in.
