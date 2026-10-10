# Research Log

Why Pretext is the way it is. Part 1 is the intent: the limits, the merge bars and the stances behind them. Part 2 is
the evidence: measured facts, traps and dead ends, each with its browser build and its date, and each measured fact and
dead end with what would reopen it. Part 3 is the Decisions Log. A date after a Part 1 rule is when the maintainer set
it, and dates are Pacific time. Terms used throughout:

- **#N** is a pull request or issue in this repository (github.com/chenglou/pretext); after a tracker's name, as in
  WebKit #283408, Mozilla #2020917 or Chromium #560614560, it is that tracker's bug.
- **Main before #340** is commit 6d1d2106 (2026-09-24), the last main that found break opportunities with Pretext's own
  rules. PR #340 replaced those rules with ports of each engine's break scan over that engine's own tables, and kept
  main's API and the rest of its pipeline. "Main" alone is main as of the entry's date.
- **The per-engine rebuild**, or *the rebuild*, is `rebuild/` on branch `rebuild-20260916`: a from-scratch port of how
  each engine breaks and measures lines, with Canvas `measureText` its only measurement. Its own docs call it the redo,
  and its own harness the lab (`rebuild/lab/`). It never shipped and is kept as the plain-text correctness reference
  (The Per-Engine Rebuild And What Counts As Done, below).
- **The old suite** is the old test suite main had until the harness replaced it in #341: `tests/wrapping`, with its
  snapshots and tools, removed on 2026-09-25 in #348. Rerunning it means checking out 6fadbe5, the last commit that has
  it.
- **The harness** (`harness/`) records each case's lines once per pinned browser build and scores Pretext's predictions
  against those recordings (harness/README.md).
- **The engine profiles** (Blink or Chromium, WebKit, Gecko) are Pretext's rules and values for Chrome, Safari and
  Firefox, picked once from the user agent by `getEngineProfile()` in `src/measurement.ts`; a browser on an engine
  Pretext doesn't recognize takes Blink's. **The scans** are their ports of each engine's break-opportunity scan
  (`src/line-breaks.ts`, `src/gecko-line-breaks.ts`).
- **A gap**, or *named gap*, is a known way Pretext's lines differ from the browser's, written down with its cause and
  the text it affects; `ENGINE_FOLLOWUPS.md` lists the open ones.
- **Page history** is a result that depends on what the page measured or laid out before, through the browser's caches,
  which the paragraph alone can't predict.
- **engineering.md** and **ui.md** are the maintainer's general rules for code and for UI, `docs/engineering.md` and
  `docs/ui.md` in the chenguini repository, not yet public; **Scrolling.md**,
  `docs/Scrolling.md` there, argues the scrolling rules. A pointer such as (engineering.md, Caching) names a section
  there. This file keeps only how such a rule applies to Pretext, its evidence and Pretext's own exceptions.

## Part 1: Intent

### Why The Intent Is Written Down

The maintainer skims fixes that stay inside the limits below (Limits), trusting the agent's judgement, so the limits are
written down. A reason the code doesn't show gets reverted by the next agent, so it goes in a comment at the code site,
a written reason on the accepted list (`harness/accepted/<browser>.txt`) or the Decisions Log. Each Part 1 rule and
Decisions Log entry states what holds now and names what it replaced.

### What Pretext Is For

- **Measurements without the DOM, painted by the browser** (reasons in `thoughts.md`). Pretext's one hard requirement is
  that the browser's own font rendering paints the text; everything before painting, from reading the style inputs to
  where lines break and go, is open to reimplement (2026-09-15).
- **Many `prepare()` calls.** The main use isn't the flashy demos but measuring text so that layout written in
  JavaScript, in userland, is no longer blocked on the DOM: above all, virtualizing many rows (2026-09-12). So preparing
  new text counts as much as `layout()`, costed per text box times boxes per page, and Pretext has to beat DOM
  measurement on CJK-heavy pages too.
- **The browser's own lines** (breaks, count and widths), not an ideal such as balanced lines: copying them sizes text
  the browser wraps, such as a textarea, ahead of time, and makes owning layout nearly free.
- **Exact heights**: an exact fast method comes before a clever lossy one callers must patch. The range APIs
  (`walkLineRanges()`, `layoutNextLineRange()`), which give lines without building their strings, came from finding that
  most of the cost of getting lines was garbage collection and allocating their strings.
- **No batching.** Measuring text through the DOM makes apps batch their reads apart from their writes across
  components, since interleaving them is expensive (2026-09-18). Pretext exists to remove that, so an API shouldn't
  bring it back (a preference, not a hard rule); callers get lines to lay out themselves, not just a height.

### Limits

Inside these, fixes land on judgement; outside, ask the maintainer first.

- **No DOM**: `prepare()` and `layout()` read no DOM or computed style and force no style or layout, since a style
  recalc triggers reflow; a fix that needs it is rejected, and the browser's limitation documented. Three reads are the
  exceptions (AGENTS.md): the emoji-correction span, a hidden element that measures one emoji in the DOM to correct
  Canvas's emoji width, read once per font, never per text box; the `<html lang>` read (Caching And API Design; Content
  Language And Fonts has its cost); and, where `OffscreenCanvas` is missing, a canvas element Pretext creates and never
  attaches (`src/measurement.ts`).
- **Canvas widths only**, from a font declaration, through APIs all three browsers have: no font files (even the app's),
  glyph pixels, language detection or font loading. Designs where the app supplies facts about its fonts are ideas only,
  not planned; font knowledge enters only as general facts baked in, as a last resort.
- **No hidden inputs**: nothing read from the page may change under a prepared handle unseen. Reading `<html dir>` in
  every `prepare()` was removed for this, which also argues against reading `devicePixelRatio` in `layout()`. The page
  language is the exception, read because line breaking needs it (Caching And API Design), on condition that `prepare()`
  and `layout()` do nothing new and expensive in the browser for it; any new read of browser state needs the
  maintainer's decision.
- **Browsers**: the major engines and their mainstream variants, Edge as Blink, detected by engine, not brand; a modeled
  engine is never refused or shown nothing. A fringe browser gets a fix of its own only when it's extremely cheap and
  also serves the major browsers; unrecognized engines take Blink's profile; runtimes such as React Native need only not
  crash or do anything catastrophically worse than main before #340; Firefox ESR, old browsers and quirks mode get
  nothing that costs complexity; the WebKit profile follows Safari 27 only (Decisions Log, 2026-09-16, has what that
  costs Safari 26). Windows and Android are untested, not untestable: an Android emulator is installed on the
  development Mac, and no harness run has used it. Sampling them stays modest, since fewer Pretext users target them.
  For the harness's real-usage sample (harness/README.md, Two kinds of set), choosing which real text it holds matters
  more than adding platforms (2026-09-24). What moves with the device pixel ratio, page zoom and text-only zoom is
  under Part 2, Measurement Model.
- **Keep fixing** common app text (Latin, CJK, Arabic, Hebrew, emoji, chat punctuation, URLs), rich inline, the
  documented CSS and the major browsers; rare Unicode (NEL, controls) only when the fix is cheap and costs no other
  case. Document, don't chase, browser bugs, effects Canvas can't see and text shapes only fuzzing produces. Speed may
  regress a bit for a fix that matters. Accuracy in boxes narrower than 80 px counts for little; a behavior Pretext
  doesn't model that shows only under 24 px may be accepted, as narrower than real layouts.
- **Out of scope, punted or parked**: server-side measurement and other backends, such as React Native's; mixed font
  sizes in a paragraph (Pretext gives widths and breaks, not line heights); `hyphens: auto` and `overflow-wrap: normal`
  (hyphenation stays on TODO.md as a possible feature); a `fontKerning` option (README assumes default kerning);
  `system-ui` (issue #336 says what support would take); source offsets (#90) and carets (#198) for editing.
- **Userland**: stricter editorial whole-word handling, never a changed default (an overlong word breaks at grapheme
  boundaries, as with `overflow-wrap: break-word`), scroll anchoring and overscan. The rich-inline API stays public, and
  any future replacement of the line-breaking engine must keep every demo's result achievable, possibly through other
  APIs.
- **PRs closed against these limits** (2026-09-12) include rem and em sizes (#109, a computed-style read) and a
  localhost-only `bun start` (#114; it binds the LAN on purpose, so phones reach the demos).

### The Correctness Stance

**The standing statement (2026-09-23).** A premise nobody has falsified in real fonts may be taken for speed, as a
documented default with a named gap. As a last resort for speed, correctness gives way: what goes first is matching the
browser where only an ad hoc rule could, and next, requirements no real text exercises, each with its cost stated; CJK
stays well supported whatever else gives. It replaced three stances: fix measurement errors before optimizing
(2026-03-03); correctness first in the rebuild (2026-09-16); and correctness not held religiously, so that a good-enough
line may be chosen from numbers where what remains is local and doesn't threaten the architecture (2026-09-18). Not
optimizing prematurely (engineering.md, Data Modeling), and taking the rebuild's facts back to main, still stand.

- **"Fixing a mismatch"** (AGENTS.md) is the method, since no rule should be chosen by a score, an insight that
  generalizes beats special-casing a browser, and no shortcut that makes an early version look good may erode its
  structure later. Its second point is engineering.md's rule against monkey-patching (Data Modeling; 2026-04-15).
- **No tolerances**: a gap between Canvas and the DOM is handled on purpose or named, never hidden in a tolerance; each
  engine's fit arithmetic is exact in its own units. Main's 0.005 px `lineFitEpsilon` (Blink and Gecko profiles) is an
  open gap (ENGINE_FOLLOWUPS.md).
- **A rule ported from engine source may be switched off in one engine's profile**, while the other profiles keep it,
  only when that engine's losses with it on are traced to a behavior Pretext doesn't model and that behavior is named.
  The profile sets the switch explicitly.
- **Replacing main's engine** meant losing no browser fact whose answer was checked and understood, and no use case
  main's API serves, not keeping every case main passed, which would copy its accidents (2026-09-17). #340 was accepted
  as roughly a superset of main apart from edge-case tests (2026-09-23), and that is the bar for any later swap. Where
  the older design is faster at the same coverage, it did something right: take it back unless it doesn't fit.
- **Summing words**, adding cached Canvas widths of segments to find where a line ends, mustn't go the way of main
  before #340, a sum patched with corrections tuned until tests pass: sum only where that provably equals the engine's
  answer, the engine's exact recipe (as the rebuild ports it) being the fallback and the judge.
- **Hunt your own assumptions** and test them: the biggest early Safari win (March 2026) came from dropping one, that an
  emoji's DOM width equals the font size. Corrections are measured from the running browser, never hard-coded, and don't
  vary inexplicably item by item (the emoji correction is one value per font). A proof that a fix is impossible under
  the current model is a definitive answer.

### The Per-Engine Rebuild And What Counts As Done

The per-engine rebuild (`rebuild/` on branch `rebuild-20260916`) is an unshipped, correctness-first reference for plain
text: one port per engine of how it breaks and measures lines, Canvas `measureText` its only measurement. It was closed
on 2026-09-26 to upkeep only: re-pin browsers, sync main, adopt browser APIs that can replace a Canvas measurement. It
is the reference main moves toward for fixing things correctly and for approximating them on principle, so that main
doesn't slide back into the rules per input shape of main before #340 (special cases keyed on what a failing input looks
like; Dead Ends, Rules Per Input Shape). Main's designs lie between main before #340 and the rebuild, interpolating,
never extrapolating: nothing more ad hoc than main before #340, nothing past the edge the rebuild marks. Its philosophy
is written out in `rebuild/README.md`, "Lines drawn" (1f380af7). In short:
- Correctness before speed and simplicity, but not completionism: what would need the DOM or a new feature is a named
  exception, not a goal. Plain text only: rich inline done correctly, with kerning between sibling spans, is a large
  project left for another time (2026-09-26).
- No right line is lost silently: each is traced and classed before a change is accepted, and a remaining difference
  must be explained and named. Losses aren't banned: some are invisible to Canvas (Zapfino's shaping data moves Chrome's
  breaks without moving any width), and lines main gets right by rounding luck aren't losses to chase.
- Done meant: every remaining difference a named gap with a cause, a made-up font or one at a variation extreme, or a
  width under 24 px; a superset of main (48980bb) in all three engines; and the planned speed techniques, the last two
  of them Blink's, both landed on 2026-09-25: words first, which measures each word of a shaping run once with its
  trailing space and finds a break between words from those positions, and the cut predictor, which predicts where a
  line's cut lands instead of measuring every shorter piece before it.
- A speed premise holds only where no installed font, at any settings CSS can ask for, breaks it in the pinned browser;
  where one does, the premise is bounded by zoomed size (Part 2, Measurement Model), a font property Canvas can check or
  the text the engine's source shows it failing on, never by a font's name, and the exact recipe runs there.

The rebuild scores itself on case sets of its own and has no checked-in way to run main's harness cases: it predicted
them once, before it closed, through a patch that wasn't committed, against main at 48980bb (`rebuild/README.md` has
the table: main right and the rebuild not on 25, 26 and 8 pinned cases in Chrome, Firefox and webkit-host). So compare
a rule by reading it and its unit tests (`rebuild/src/engines/<engine>/`) against the engine's source.

### Tests And Losses

- **A lost pass may be an accident or a bad test.** When a change loses passes, don't call the regression bad by reflex:
  first check whether the earlier passes came from bad tests or accidents the suite took in (2026-09-12, after passes
  that were wrong tests blocked the fix for issue #210, a leading zero-width space lost at a line start). A lost case is
  a true loss, an accident (two errors that cancelled) or a wrong test or oracle (the reference a test scores against);
  the last two are accepted with the evidence written up, true losses are the maintainer's call. #210's fix gained 1,814
  results on the old suite and lost 106, each loss traced to an existing mismatch.
- **Importance over pass rate**: easy cases drown out hard ones, so the harness decided afresh what mustn't regress when
  it replaced the old suite, weighting a sample of real usage (how often does a user see a wrong line?) beside a
  generated catalog of behaviors (which behaviors are modeled?) (harness/README.md, Why the old suite went), with no
  must-pass tier (Decisions Log, 2026-09-24). Broad generated combinations are fine while they're fast.
- **Cases grow** by behavior, not by a repro per bug as main before #340 grew (harness/README.md, "How cases grow").
- **Tests signal real regressions**, not false ones, in a fast loop (engineering.md, Project Setup); once a suite is
  trusted, speed it up by engineering and by batching what isn't timing-sensitive. "No change" for a cleanup means that
  every tool listed under Proving "no change" in harness/README.md agrees, never an argument from reading.
- **Don't re-record only to confirm nothing changed**: repin first when coming back to the project (AGENTS.md), since
  the installed browsers will have moved, but don't redo expensive recordings only to confirm nothing changed (a rule
  set for the rebuild's scans, 2026-09-26). Whether main's `repin` should record a seeded sample first, and every case
  only if the sample differs, is open (ENGINE_FOLLOWUPS.md, Harness debt).

### Engineering

- **Tiny.** Ablate away complexity and state that cost no accuracy or speed; don't overbuild. Line count is complexity's
  usual proxy (2026-09-15); bundle bytes aren't tight, nor saved with hacks. Per-engine code that barely interacts
  counts for less than its lines, and line count waits while correctness is being established (a rule set for the
  rebuild, 2026-09-18). Reuse existing machinery before adding code; derive sets from the generated tables, not by hand.
- **Simplify** after each stretch of work, checking growth in complexity and cost: the same results from less is exactly
  what's wanted, and an architecture change removes the logic it made redundant (engineering.md, Refactors), saying what
  now gives the same answer. A simplification changes no observable behavior and adds no optimization machinery;
  removing public API or changing line breaks is the maintainer's call. A small deletion that would lose coverage is
  submitted as a PR and closed at once, so its history is kept (2026-09-16; #314-#318). Delete dead code, don't silence
  it; no stale scripts or temporary tooling; rules against a class of bug stay light.
- **Order of work**: correctness with trusted tests, simpler data structures and flow, profiling and optimization, the
  API last; engineering (data layout, typed arrays, no allocation) before algorithms. Pick engine work by what users
  report, the maintainer asks for or the harness's real-usage sample shows failing (ENGINE_FOLLOWUPS.md says where to
  look), not by sweeping ENGINE_FOLLOWUPS.md. Bound a design's best case before investing: on 2026-09-22 an Amdahl bound
  showed the rebuild's exact port couldn't prepare new text as fast as main in Chrome or Firefox, which led to #340
  porting the engines' break scans into main instead of the rebuild replacing it (Dead Ends, The Per-Engine Rebuild).
  Speed work has no fixed stop threshold: judge by where returns decay, the absolute gain and the complexity. Write down
  a change whose gain is small next to its cost in speed or complexity as such, so the maintainer can weigh those
  changes together (2026-09-20).
- **Plain objects and functions, not classes** (AGENTS.md, Implementation notes), their shapes fixed, and, in new code,
  indexed `for` loops over `for...of`, `.forEach` and allocating `.map` chains, stricter than engineering.md, Control
  Flow, which allows one `forEach` or `map`. The rest of engineering.md holds as written; per-browser behavior goes in
  the one place its Data Modeling asks for, the engine profile.
- **Cater to the worst case** (engineering.md, Control Flow), in time per frame, GC pauses counted with computation.
  Speed has improved enough that the worst case may regress slightly for a real gain: the rule is to cater to it, not
  that it can never regress (2026-09-26). The width memo, handles remembering which widths gave their last lines, made
  new widths up to 26% slower in Chrome, which isn't slight, so it stays parked (Dead Ends, Caching, State And API
  Designs). Layout stays on the main thread, workers a last resort.
- **JIT tuning.** As a general preference for every change, don't optimize for JIT behavior that varies with the
  browser, its version or the machine (2026-09-25), since browser JITs are moving targets. For speed, aim at what stays
  true across engines and versions (2026-10-07; engineering.md, Control Flow): stable types, good allocation patterns
  and plain C-like code, such as a number array made to hold only floats instead of a mix of integers and floats, or one
  preallocated buffer filled instead of an allocation per item. Tricks of that kind are fine, small ones above all,
  provided they are measured, with no optimizing for show, and a comment says what they are for. Measuring can decide
  against one, as it did for every width stored as a double (Decisions Log, 2026-10-07, a handle's widths). Stable types
  (numbers, fixed object shapes) are less a matter of JITs than of ordinary good practice. What the code aims at
  decides: a property that holds across engines and versions is fine, one JIT's moving heuristics are not. A small
  regression that only such a heuristic explains is accepted, its cost noted. A difference of about a percent of an
  operation's time between two forms of the same code doesn't decide between them (2026-10-09), since the next change to
  the code moves such differences again: where two forms differ by that little the simpler is taken, its cost noted. As
  a rule, never keep code only because one JIT likes it (2026-09-26): dead or redundant code kept only because one JIT
  runs it faster is an accident that code written cleanly wouldn't reproduce, so it goes whatever the regression, its
  cost noted; that reversed the 2026-09-24 decision to keep `countPreparedLines()`'s leading-space skip (#364). No rule
  is written out twice for a small JIT gain, though a small split of live code is fine if it reads as ordinary code and
  a comment says why. The precedent is #365: one shared helper was kept over two copies at a 2-5% cost in Firefox (Bidi
  Levels; Decisions Log, 2026-09-26, no dead code for one JIT, widened on 2026-10-07). Report a speed fix's cost in
  lines beside its gain, and what a percentage is of.

### Caching And API Design

- **Caching is a cost** (engineering.md, Caching). Pretext's prepare/layout split is itself a cache, reached for when
  there was no better choice; the best case is needing none, which would be a large gain for userland (2026-09-18).
  Invisible acceleration that can't go stale or leak is welcome; handles the app must carry hurt, worst when one text
  needs a prepare per font size. A cache stays where ablating and profiling show it earns its place, with a size limit
  well above what one page uses.
- **Two lifetimes**: the shared width cache holds facts of one font and one segment's own characters, the prepared
  handle facts of the whole text; caching more globally would grow without bound. Name both wherever caching comes up,
  since the shared one is easy to forget. Handles going stale when the page language changes is a known cost, accepted
  because line breaking needs the language.
- **The API isn't final.** The prepare/layout split was the right trade when chosen and may not be now; alternatives are
  proposed as additions and decided with the maintainer. Idempotent layout without handles stays interesting if lifetime
  can be controlled, though a study recommends keeping handles (Dead Ends, Caching, State And API Designs). The old
  incremental-prepare work (#313; Dead Ends, Caching, State And API Designs, Incremental prepare) mostly made up for
  slowness: it may inspire an API, not bias one. Immediate mode: nothing relies on object identity, and changed text
  should be cheap to prepare again (#313). A target of 2 s to prepare 10,000 rich messages (2026-09-18) was withdrawn as
  unsubstantiated.
- **Design from shared structure**: once plain speed engineering is exhausted, find what calls share and skip
  recomputing it, from a cost model first. Demos show hard technical cases that developers adapt to their own uses; they
  don't tell which uses are common (2026-09-26). Don't overfit to today's uses.
- **The engine work changed no public export**, from #340 to #375. Rich inline has since gained an options argument
  (`wordBreak`, #379; `whiteSpace`, #381, which an editor in #173 was laying out itself) and boxes (`RichInlineBox`,
  #387, in place of the stand-in characters of #201), the line functions that return no text take a `prepare()`
  handle, and the type of a `prepareWithSegments()` handle shows three fields only (Decisions Log, 2026-10-06, for
  both). The API discussion, a review of the whole public API at the end of the project and before any release, has
  issue #321's `direction` option and `devicePixelRatio` in `layout()` on its list (TODO.md). One bundle serves every
  engine (Decisions Log, 2026-09-26).
- **No public API that serves no known user (2026-09-29).** A new option or export needs an app or a person who needs
  it. One without is described in an issue, kept simple, with whoever has the use asked there, as #382 asks about
  padding on an item split across lines.
- **Past a certain point, specified programmatically** (2026-09-29, tentative: the maintainer's guideline, given with
  the caveat that the needs may prove otherwise). Rich inline takes the facts a layout needs as values, such as an
  `extraWidth` or a box's width, and shouldn't keep growing options that mirror CSS properties one by one; where
  userland can build a behaviour from the line APIs, baking it in may not be worth it. It bears on the open questions
  about per-item `white-space` and CSS names for padding (TODO.md).
- **The rich surface** stays split between stats and range helpers and materializing ones, one decision algorithm behind
  batch walks and one-line steps; speed work for rich text and manual layout belongs in the range and cursor APIs.
  `getTextClusters()`, a Canvas API that returns each cluster's position (behind a flag in Chrome 153; Engine Facts,
  Chrome), is wanted once it ships but can't be waited on, since it doesn't help Firefox.

### Tables Against Canvas

- **Neither comes first**: a table that isn't per-font data can beat a Canvas recipe when its lookups can be enumerated
  roughly exhaustively (2026-09-19, replacing an earlier fixed order: engine rules, then Canvas, then tables). Choose by
  what the fact depends on: engine or Unicode data goes in a table pinned to the engine's build; a font fact is asked of
  Canvas at runtime, never kept per font; OS facts case by case, such as Safari's small Core Text table of generic
  families. A kind of fact usually takes one or the other, not both.
- **Generated data beats** hand-written lists or hacks while its size stays reasonable, a limit never set as a number
  (2026-09-12). The engines' tables replaced Pretext's rules, Chromium's Chinese line table included against the advice
  in issue #321, their growth accepted because they made analysis much faster, and the size check left for the end of
  the project is closed (Decisions Log, 2026-09-23 and 2026-09-26).
- **`\p{…}`** follows the JavaScript engine's Unicode tables, not layout's, so the rebuild takes no engine decision from
  it. Main's scans do, through `hasProperty()` (`src/line-breaks.ts`: letters and numbers, marks, punctuation,
  default-ignorables, emoji, Hangul), on the premise that a browser's JavaScript engine and its layout use the same
  Unicode version, which nothing checks.
- **Scripts come from a table** since #423: the script runs behind the Chromium profile's kerning with spaces and the
  cursive rule for letter spacing (`src/prepare.ts`) look a character up in a class for every code point, made from
  ICU's Script, Script_Extensions, East_Asian_Width and bracket pairs as Chrome's build compiles them in (ICU 78.2,
  Unicode 17; `scripts/generate-engine-break-data.ts`). Firefox's build holds the same arrays, so its cursive rule reads
  the table too, and `bun harness repin` says when either build no longer holds them. Until then the scripts were read
  with seven `\p{…}` classes, the eight wide opening brackets Blink makes Han and the bracket pairs listed by hand, two
  to five tests each time a character outside ASCII was met. Script extensions are revised in most Unicode versions, so
  that premise carried more than `hasProperty()`'s does. Where a JavaScript engine has Unicode 17 the classes gave what
  the table gives, the scripts of every code point alone and of 4.2 million pairs, each Common code point before each
  mark that scripts list among them (Bun 1.4.2, d8 15.4.80 and the SpiderMonkey 156 shell); Node 23, on Unicode 16,
  differs on the 142 code points Unicode 17 added and on U+0320, whose extensions it dropped (2026-10-03). The table
  costs the main entry 0.3 KB gzipped, and 29 KB of typed arrays once a text asks for a script.
- **`Intl.Segmenter`** stays for Southeast Asian words (Dead Ends, Tables, Bundles And Data, has the alternatives)
  because Pretext needs the browser's split, not the right one. Firefox's slow Thai segmentation is its own trade for
  download size, so no bug was filed.

### Demos And The Chat

- **Demos show Pretext's numbers**, JS and CSS layout kept apart as ui.md, Layout, says, and no hard-coded line counts.
  They never correct what Pretext reports: fix the library, or have it expose the fact.
- **Immediate mode** (ui.md, DOM), without DOM pooling, which ui.md's DOM Update Strategies puts last: with Pretext
  owning layout and virtualization, the rectangles on screen stay in the tens, so rebuilding each frame is fine, and
  pooling would tie a node's state to an eviction policy. No ResizeObserver or other event-like control flow
  (engineering.md, Model The Dependency Order Directly): if Pretext owns the breaks, nothing needs observing. A new UI
  architecture is proposed to the maintainer first.
- **The Markdown chat** (`pages/demos/markdown-chat.html`, taught in `pages/demos/markdown-chat.md`) takes the worst
  case first, resize and random scroll seek, and every lossy height method was worse (Dead Ends, The Markdown Chat At
  Scale). Its scrollbar has the full history's correct size, capped only by what the browser can handle (Scrolling And
  Scrollbars). It assumes fonts loaded up front and every embed size known.
- **Scrolling** is designed to need no browser-specific handling, assuming as little as possible about `scrollTop`
  (Scrolling.md has the longer argument): scroll only when this frame's layout moved the anchor, never clamp, and after
  setting `scrollTop` use the value the browser reports back, not the one set; never detect a case such as
  rubber-banding to patch it. The macOS and iOS overlay scrollbar comes first, and a scrollbar appearing never nudges
  content.
- **The chat is exemplary**, teaching the important patterns without noise so developers pick a subset rather than
  extrapolate; its guide stays short. Its techniques move to the rich-note demo (`pages/demos/rich-note.html`) only if
  strictly better; otherwise their trade-offs are written down, since users will want to know them. Demo code's control
  and data flow count, not only its numbers; a pass over a demo against engineering.md and ui.md seeks simplifications
  that bring fewer lines, fixes and speed together.
- **The demos aren't in the npm package** (Decisions Log, 2026-09-25).
- When a demo looks wrong, first find whether the library or the demo is at fault, in a real browser at several widths.
  A layout fix's commit message names the bug and explains the fix.

### Docs

- **The criterion (2026-09-27).** Trust a future agent to be at least as capable as the one writing, and leave out the
  obvious things it can discover. Write down every philosophy the project holds, since a capable agent still wants the
  intent and can follow it, and the traps capability alone doesn't solve, of which dead ends are one example among
  several. Discoverable means cheap to discover, so facts that take hours of browser runs stay; every measured fact and
  dead end carries its date, browser build and what would reopen it; AGENTS.md may hold one screen of pipeline map.
- **Written for a cold reader (2026-09-27).** A doc reads right to someone who has seen none of the conversations or
  working sessions behind it. It states rules as the project's rules, in plain words, and never quotes conversations; it
  defines each term where first used and uses no entry ids, code names or labels from a working session; history stays
  only as a decision with its reason, a dead end or a measured fact. Length isn't a target: short, but never at the cost
  of the words such a reader needs.
- **Dead ends stay open to question**: document them without sternness, so later attempts can question them
  (2026-03-03). Say what was tried, how deep, by whom and whether anyone checked it; never "impossible" without a proof.
  A thin, unchecked attempt is weak evidence: Chrome's word sums were written off after one, then reopened and landed
  (Dead Ends, Fitting, Cuts And Fast Paths).
- **README**, the one user-facing doc, gets extra care: illustrative and to the point, only caveats app developers act
  on, its API glossary kept, examples correct on their own and ordered simple to complex, every term defined, every
  claim true of the algorithm and confirmed in real browsers, no change beyond what the task at hand asks.
- **Voice**: short, nuances kept, each document in its own tone and `thoughts.md` in the maintainer's. A rewrite keeps
  technical meaning and opinions and loses pseudo-jargon, common words in uncommon senses, vague pronouns and slogans,
  but not words that carry meaning, such as "regression". Concrete cases over a general warning.
- **A PR's story stays in the PR.** Its full account (the rounds, the probes, every case it moved) goes in its
  description; this file gets the durable fact: the claim, its number, build and date, its source and what would
  reopen it. Bench tables and finished comparisons go in the description too, and this file keeps the number a
  decision rests on. Six PRs in a row appended about 7,500 words here before the docs took this rule in #374. Length
  alone isn't the worry: the maintainer has said not to mind it in docs other than the README.
- **What goes in**: point to numbers that go stale rather than copy them; give a fresh agent objective facts, not
  designs that fence it in. A cleanup removes only what's provably stale; docs another agent wrote are checked for
  accuracy and for fitting what was done. The changelog rule is the maintainer's own AGENTS.md line, kept word for
  word.
- **Decisions**: when the maintainer decides an item, record it (Part 1 or the Decisions Log) and take it off TODO.md or
  ENGINE_FOLLOWUPS.md, which they rarely read. Work depth-first, and track each deferred item in one of those two files
  with what would reopen it. A quote from any source names it and is checked against it; text the maintainer forwarded
  from another agent isn't their view.

### Merge Bars And Landing

- **The standing bar (2026-09-26).** A change that gains on correctness, speed or simplicity and loses on none, within
  the project's known goals, with the code staying reasonably simple, is a good merge. A change trading one against
  another goes to the maintainer with numbers; the maintainer may choose to ignore one named cost when judging it.
- **Try fixes eagerly**, long-standing gaps included, but hold back one that doesn't make sense even when validation
  passes: losses nobody can attribute, complexity out of proportion to the gain, special-case hacks. A worst case may
  regress slightly for a real gain (Engineering, 2026-09-26); a regression that isn't slight is fixed in the PR that
  causes it, as #340's worst-case rows were (2026-09-24), or the change waits, as the width memo does. Close an issue
  only when it's solved on main, and a superseded community PR with thanks.
- **Public posts** go out only at the maintainer's word, once verified, and sound like them: casual, details kept, no
  report phrasing or demands, in the contributor's language. Public issues and branches carry no private details. A
  feature too hard for now is parked in an issue with the findings and what support would take; a stale public issue
  gets a new comment and a one-line status at the top.
- **Browser bugs** are recorded and filed as PLATFORM_BUGS.md says. A crash or hang found while probing stays out of
  public issues, branches and docs until triaged. The rule came a day late for the one case so far: a Chrome crash
  went in as a restricted security report on 2026-09-19, after its page had been pushed with the rebuild's branch on
  2026-09-18, and came off that branch's tip. Triage closed the report that day as a stability issue without security
  impact, so nothing about it is withheld any more: PLATFORM_BUGS.md describes it, and the page stays in the rebuild
  branch's history.
- **License notices** of the BSD- and Unicode-licensed sources that shipped code or data follows or is generated from go
  at the end of `LICENSE`, after the MIT text and kept brief: each source's copyright lines, and each distinct license
  text once.

## Part 2: Evidence

Measured facts, traps and dead ends, each with its build and date or the engine source it was read from. Unless noted, a
fact is from the project's development Mac (Apple silicon, DPR 2, a Chinese-first OS language list, which changes
results: Content Language And Fonts) in that date's installed browsers: Chrome 153, then 154.0.8037.57 from 2026-09-25;
Firefox 155, then 156.0 from 2026-09-16 and 156.0.1 from 2026-09-25; Safari 26.5.2 on macOS 26, then 27.0 on macOS 27
from 2026-09-16. Entries from before mid-September name their own builds where one was recorded, such as Chrome 152 and
Firefox 152 on 2026-09-03. The WebKit profile follows Safari 27, so a fact measured only in Safari 26.5.2 is unconfirmed
for it. Dates are Pacific.

A label in parentheses says where a number came from. *Old suite* numbers are from `tests/wrapping`, main's browser test
suite until the harness replaced it (#341; removed 2026-09-25 and runnable only from 6fadbe5), kept where they carry a
decision; a *row* is one of its cases observed in one browser. *Main then* is main on the fact's date, and *main before
#340* is commit 6d1d2106, main with its own break rules, before #340 (2026-09-24) replaced them with ports of the
engines' scans. An *offline replay* ran Pretext in Bun over recorded Canvas answers and browser rows, and a *stand-in
Canvas* is a numeric one: both measure Pretext, not a browser, and a replay flags change without judging it, blind to
string storage, painting and dictionary text (Evaluation Traps). The *per-engine rebuild* (`rebuild/` on branch
`rebuild-20260916`) is a from-scratch port of each engine's line breaking over Canvas measurement, unshipped and kept as
the plain-text correctness reference (Part 1, The Per-Engine Rebuild And What Counts As Done); *rebuild harness* numbers
are from its own harness, the lab (2026-09-16 to 26, each claim checked by a second agent; scores in `rebuild/research/`
on that branch), in Chrome 153, Firefox 156 and webkit-host unless noted. *webkit-host* is the system WebKit that
installed Safari runs, driven in a background app, which lays text out as Safari 27.0 does (harness/README.md, Browsers
and pins). The *emulation study* ran each engine's own break data, shaper, line loop and font fallback outside the
browser, with tools kept outside this repository (2026-09-15 to 20; issue #321 summarizes it). *Zoomed px* are CSS px
times the page zoom and the device pixel ratio, the size Blink lays text out at.

### Measurement Model

The premise: a segment is as wide as Canvas measures it alone, a line is the sum, and each engine's known differences
are corrected in its profile (Part 1, The Correctness Stance). Whole-line measurement during layout, uniform scaling, a
pair-kerning table and hidden DOM or SVG text were tried and lost (Dead Ends).

Every Canvas measures U+0009-U+000D as spaces, Firefox's also U+001C-U+001F, NEL and U+2029 (other C0 controls as
hexboxes). Pages differ: Chrome gives 1,185 of 1,429 controls an advance; Safari gives CR its glyph's advance on the
simple text path only, other controls `.notdef`'s; Firefox gives CR, FF, VT, hidden C0 and C1 controls, DEL, U+2028 and
U+2029 none (Chrome 153, Safari 26.5.2 and 27, Firefox 155 and 156, 2026-09-16/17). The HTML parser turns CR into LF, so
probes set CR from script.

Chrome's Canvas turns SHY, ZWSP, LRM, RLM, U+202A-U+202E and U+FEFF into U+200B, ending a Canvas word, while its page
shapes through them (`plain_text_node.cc:47-62`). Leaving the soft hyphen out changes 2,356 words in 168 of 399
families, whose `morx` or `kerx` machines see it; U+2060 in its place matches the page on all (rebuild harness,
2026-09-17). A nonspacing mark after that U+200B can measure as a dotted circle, where the page gave such marks no width
in about 20,000 observations (old suite), so the Chromium profile gives none. Safari's Canvas and page keep the soft
hyphen, and a mark after it takes its fallback font's advance in both.

A chosen soft hyphen paints U+2010 where a font maps it, else `-`. Chrome and Safari ask the primary font alone; since
fallback supplies U+2010, only measuring under two fallbacks whose U+2010 differ tells which (36 of 36 families, rebuild
harness), and the Chromium and WebKit profiles ask that way where the two hyphens measure differently in the font
(`getHyphenText()` in `src/measurement.ts`; 17px Inter's U+2010 is 6.09px and its `-` 7.82px). Firefox asks the first
listed font that has one, else its default font, and paints what Canvas measures for U+2010, so the Gecko profile
measures that (`hyphenFromPrimaryFont`; Engine Facts, Firefox). Every profile measured `-` before #396.
ENGINE_FOLLOWUPS.md, Line edges, has what the check's premises get wrong. Safari and Firefox letter-space the hyphen and
Chrome doesn't (`letterSpaceDiscretionaryHyphen`; Gecko adds the spacing to the hyphen's width in `GetHyphenWidth`,
`nsTextFrame.cpp:4388-4399`).

Every page shapes text under any non-zero letter spacing without its optional ligatures: Blink turns off `liga`, `clig`
and `calt` (`font_features.cc:52-86`), Gecko and WebKit `liga`, `clig`, `dlig` and `hlig` (`gfxFont.cpp:672-685`;
`UnrealizedCoreTextFont.cpp:258-264`), so a word is as wide as its letters plus the spacing: 16px Roboto `difficult` is
52.87px wide, and 54.20px plus nine gaps under any spacing, in all three. Chrome's and Firefox's Canvas `letterSpacing`
turns them off too, and adds nothing at `0.000001px`, under Blink's unit of 1/65536 px and Gecko's app unit
(`shape_result_spacing.cc:14-33`; `CanvasRenderingContext2D.cpp:4771-4774`): that Canvas width is the page's with
`font-variant-ligatures: none`, the same in Firefox and within 0.007px in Chrome, where the page rounds an item up to
1/64 px (five words in 16px Roboto, Futura, Georgia and Helvetica Neue and 32px Hoefler Text). So the Blink and Gecko
profiles measure letter-spaced text through a context set to that spacing, kept apart per font from what unspaced text
measures, and add the spacing per grapheme themselves; a word's prefixes and its widths at line edges come from the same
shaping (#397; Chrome 154.0.8037.57 and Firefox 156.0.1, 2026-09-30). On the masonry demo's 1,904 paragraphs at 22
widths in 15px Roboto at 0.15px, that took wrong line counts from 33 to 9 in Chrome, where 10 are wrong without spacing,
and from 28 to 0 in Firefox, and the paragraphs that wrap again when sized to their predicted widest line from 16 and 18
to 0. Firefox's page turns them off only where the spacing is at least half an app unit (Engine Facts, Firefox).

Safari's Canvas `letterSpacing` keeps them (WebKit #283408 lacks WebKit #176215's fix): 32px Hoefler Text `ffi fl` at
0.001px is 54.403px in Canvas, 57.414px on the page (webkit-host and Safari 27, 2026-09-16 to 19). The WebKit profile's
model, the unspaced width plus the spacing per grapheme after the first, is 2-3px off Safari in Amiri, Hoefler Text and
Futura and up to 1.3px a word in 16px Roboto, and no Canvas string gets two letters unligated into one Safari shaping
call (1,596 strings in 15 fonts; Dead Ends, Kerning): on those Roboto paragraphs webkit-host has 26 wrong line counts of
41,888, and 15 of 1,904 wrap again (ENGINE_FOLLOWUPS.md). A WebKit fix would make it exact.

Contexts read language their own ways (Content Language And Fonts). Safari's has no `lang`, `fontKerning` or
`textRendering` (WebKit #285993), and an attribute a browser lacks, once set, is silently a plain JavaScript property:
check each non-default attribute with two contexts, and letter spacing on one letter repeated 16 times, since a Canvas
that rounds fractional totals hides it on one or two. Repeats are bit-identical (0 of 2.17 million differed, Chrome 153)
except where Firefox's per-process fallback state moves them (Engine Facts, Firefox).

A connected `<canvas>` isn't neutral: Chrome's keeps its element's CSS letter and word spacing (PLATFORM_BUGS.md),
Safari's copies the element's font and forces style updates, Firefox's holds the page's advances but needs `document`
(its OffscreenCanvas: Engine Facts, Firefox). A context can't be cloned or transferred (`DataCloneError`), so a worker
makes its own, and the rebuild's prepared paragraphs, which hold contexts, can't cross (rebuild harness).

Each engine fits in its own units. Chrome rounds items up to 1/64 device px, truncates the available width, and fits
while the position is at most that plus one unit (`line_breaker.h:307-317`), a 1/128 CSS px grid at DPR 2; 4,844 of the
6,844 Chrome width failures of main before #340 missed by one such unit (old suite). Safari sums float32 CSS px against
the width truncated to 1/64 px plus 1/64 px, ignoring DPR (`InlineLineBuilder.cpp:1172-1183`, webkit-7625.1.29.11.27),
which reproduced Core Text's widths on all but 17 of 2.6 million items (emulation study, Safari 26.5.2). Firefox fits in
integer app units, 60 per px, rounded per glyph: 16px Courier New `aaaa bbbb` is one line at 86.4px, two at 86.38px. The
WebKit profile fits with WebKit's 1/64 px, the Blink and Gecko profiles with 0.005px, no engine's arithmetic; Chrome's
grid needs a DPR `layout()` doesn't read (ENGINE_FOLLOWUPS.md).

Canvas measures at the CSS size whatever the device pixel ratio or page zoom (Blink resets a Canvas font's size "so we
skip zoom and minimum font size", `canvas_rendering_context_2d.cc:702-706`), and the page lays text out at the size
times both, so Pretext rests on advances scaling with size. On macOS they do. With the real-usage sample
(harness/README.md, Two kinds of set) recorded and predicted at each setting, the share of its draws inside Pretext's
claims that fail was 0.49-0.58% in Chrome at ratios 0.5 to 3.5 and at page zooms of 67% to 200% at ratio 2 (0.49% at
ratio 2 itself; to Blink, zoom and ratio are one number), 0.13-0.17% in Firefox at ratios 1 to 3, and 0.08-0.09% in
webkit-host at page zooms of 85% to 150% (Chrome 154.0.8037.57, Firefox 156.0.1, webkit-host, 2026-09-30; other
operating systems unmeasured). Predictions for text without emoji didn't move with the ratio. What doesn't hold:
- The emoji correction is read at one ratio and goes stale at another (ENGINE_FOLLOWUPS.md, Emoji correction).
- Chrome's worst setting, a ratio of 0.9 (0.58%), floors some whole font sizes a hundredth of a zoomed px low, as it
  floors fractional ones at ratio 2 (Engine Facts, Chrome).
- In webkit-host, `system-ui` and `-apple-system` lists, outside the claims, that pass at 100% zoom stop passing: 111
  more of the sample's cases fail at 110% and 328 at 150%.
- Text-only zoom isn't zoom to Canvas. Firefox's Zoom Text Only and WebKit's text zoom at 120% paint text larger than
  the size Pretext is given while widths and `devicePixelRatio` stay, and about half the paragraphs break otherwise
  (253 of 521 draws in Firefox, 250 of 520 in webkit-host); they scale a px `line-height` too, and WebKit a px
  `letter-spacing`. A minimum font size does the same to text under it, in Safari as in Chrome and Firefox (Content
  Language And Fonts): at a 14px minimum, webkit-host failed 2.9% of the in-claims weight, where 9.9% of the sample's
  weight is text under 14px. iPhone Safari's text autosizing does it to blocks wider than the viewport unless the page
  sets `-webkit-text-size-adjust: 100%` (25 more failures of 10,345 draws in the iOS 26.0 simulator).

Emergency breaks follow each engine's loop: Chrome lays the line out again with a break allowed between any two
graphemes (`line_breaker.cc:4258-4330`), Firefox takes a cluster start only while the line has no ordinary break
(`gfxTextRun.cpp:1068-1074`), and Safari searches prefixes in a fixed order, carrying the rest unmeasured (Engine Facts,
Safari). They fall only between shaper clusters, which a ligature merges, so Chrome and Firefox never split lam from
alef, or `ffi`, in a font that ligates them. HarfBuzz joins marks, a ZWJ before a pictograph, emoji modifiers and tags
to the cluster before, even across SHY, ZWSP or U+2060 (`hb-ot-shape.cc:471-585`): `a`, U+2060, U+0301, `b` stays one
line at width 0 (Chrome 153).

Widths don't compose. A string can be narrower than a window inside it (by up to 117 zoomed px in calligraphic Arabic at
256px); HarfBuzz can mark an offset unsafe though its sides sum to the whole (Zapfino, Apple SD Gothic Neo), and Chrome
reshapes there; a word's tail can be negative (Mishafi's `حالاً` in Firefox); Euphemia UCAS, alone of 393 families,
kerns its space only under `latn`, so a space Canvas shapes as Common stays wide. In Chrome a stretch with no script of
its own (` , ` between Devanagari words) measures up to 4.8 zoomed px off alone: measure it with the letter after it. A
whole word matching the page says nothing of its prefixes (rebuild harness), and letters alone can be far from their
word (Shantell Sans, Content Language And Fonts).

Canvas can learn some font facts in about 10 calls per font per page: Arabic joining, from beh and U+07FA alone and
together (29 of 29 families, blind on fixed-pitch fonts), a font's own hyphen, monospace, an optical-size axis (not in
Firefox's Canvas), and partly ligatures and coverage; not, in Chrome or Safari, which glyph carries a pair's kerning. A
wrong learned fact is worse than an unknown one, and a missing named family can resolve to a system font, so dropping
all font checks changes real lines (rebuild harness; Part 1, Tables Against Canvas).

No shipped `TextMetrics` (Chrome 153, Firefox 156, Safari 27's engine) gives advances inside shaped text by default: no
`getTextClusters()`, `getSelectionRects()` or advances array. Arabic joined across a soft hyphen, lam + alef and kerning
inside a word wait on them, so `getTextClusters()` shipping in Chrome would reopen them (Engine Facts, Chrome).

### Reading Browser Output

DOM geometry is evidence to interpret, not a map from source to lines. Chrome can give a letter after a soft hyphen
rects on both lines, copying the soft hyphen's box onto it, so "first rect" and "first positive rect" both misassign
source. Range extents aren't advances under kerning, letter spacing, bidi or invisible controls (Safari 26.5.2 split one
NEL's advance 13/11px at 1px of spacing, 14/10px at 2px). Range can't show whether a soft hyphen is painted under
keep-all (16px Arial `a`, U+00AD, `b` at width 10 paints `a` / `b`, the hidden soft hyphen's rect positive), and the
harness can't see the hyphen at a soft-hyphen break (harness/README.md). Take source offsets from segments and cursors,
never `line.text.length`, which can hold a hyphen the source doesn't. The harness's recorded line widths leave out only
a U+0020 that ends a line: Chrome gives a soft hyphen after such a space no box, so the line records without it, and
Firefox boxes a space that a newline collapses to as it hangs, which then counts (items `ab`, `\n\u00AD`, `cd` at 22px
record 22.25px in Firefox; 2026-09-27).

Spans per character or segment change the breaks observed. WebKit breaks inside an inline box from its text plus the
previous box's last two characters: a span per grapheme moved 275 of 1,336 of the harness's pre-wrap and URL-query
cases, mostly under 24px (Safari 27.0, 2026-09-25). Spans change Thai, Lao, Khmer and Myanmar breaks in every browser,
and gave March 2026's false verdict that Thai was unfixable. Read Range on the one text node, as the harness does.

Lines from rects: per-character `top`s scramble on bidi text (a Range's `getClientRects()` over the node gives a rect
per line); positive-area rects alone miss a ZWJ or the letter after it on a second line; vertical centres misplace tall
fallback-font rects; the collapsed space after an inline box reports a zero-width rect on the next line in WebKit and
Blink; `text-transform` (ß to SS) shifts Range offsets. A combining accent can have no usable rect, but lines follow
text order, so a character between two on one line is on it: that premise checked 5,018 to 13,358 more rows per browser
with no false failures (old suite), and the harness keeps it.

Rects are encoded per engine (rebuild harness). Chrome floors a slice's start and ceils its end to its layout unit, so
neighbors overlap by one, exact to 1/128 px at DPR 2 but not at zoom 1.5 or 2.2. Safari gives one rect per display box,
snaps partial rects to whole px and splits a glyph's advance among its code points by UTF-16 units. Firefox puts edges
on app units, stored as `floor(a × 65536/60 + 0.5)/65536` in float32, a cluster's advance on its last code point. Rects
drift from advance sums past about 16,000px, and summed per-grapheme widths overshoot at each boundary: take extents as
edge differences.

A diagnostic must establish its own setup. In March 2026 a container's `white-space: pre` kept both test boxes from
wrapping and gave a 17px "difference" and a verdict that Georgia was unfixable, which a later run disproved; floats
meant to force a break history moved the word below them. Check the breaks before the one studied, compare resolved CSS
widths, bracket thresholds, and test the CSS Pretext targets. Firefox's boxes followed 1/60px rounding in a sweep, but
fitting lines so regressed unrelated cases: box resolution isn't the fit rule.

Probes change what they measure. Text-presentation requests and Firefox's per-process font state let earlier strings
move later results, so each standalone repro page for a browser bug (PLATFORM_BUGS.md) runs in a fresh browser process
and profile and finishes from promises, not timers, which a hidden window stalls; a page whose bug may stop it first
sets its title to `STEP ...`, so a driver records the step it never got past after 30 s. A title that stays doesn't
tell a call that never returns from a crashed tab, which keeps its last title too: Chrome's `Range.getClientRects()` on
one narrow constructed case was recorded and reported as a hang, and is a renderer crash (PLATFORM_BUGS.md, Filed, and
not reaching Pretext; Chrome 153 and 154, 2026-10-02). After a crash the DevTools protocol sends
`Target.targetCrashed` on the browser's socket and the renderer's process is gone. Jobs drawing generated cases need a
stall limit and a way to skip either way. Read
engine source at the revision the browser ships. Setting `font` after `line-height` resets the line height. Nothing
independent checks Safari's line placement: webkit-host reads the same rects, where Chrome's and Firefox's were also
checked against the emulation study.

A matching line count isn't matching lines: about 1 in 18 of the line-count passes of main before #340 had visible
characters on the wrong lines (old suite, 2026-09-17), so the harness checks each line's first and last visible
character. Such bugs sit in combinations nobody can list: unit tests passed where a replay lost 9,068 line counts (Break
Opportunities From Engine Data).

### Break Opportunities From Engine Data

Break opportunities come from ports of each engine's scan over each browser's own shipping data (Part 1, Tables Against
Canvas).

The emulation study, with each engine's break data, shaper, line loop and font fallback, reproduced every line count and
line start of the old suite's 2026-09-14 rows in the installed browsers, about 236,000 per browser. It can't ship (font
files, private Core Text, system ICU) and needn't: Canvas already runs each browser's shaper on the device's fonts, so a
page lacks only each engine's units, fit arithmetic and a few hidden facts. Checked with the study's tools (2026-09-15
to 24), outside Thai, Lao, Khmer and Myanmar runs the Blink and WebKit scans matched the study's C++ ports of their
break code on all 13,108 and 19,393 requests (a request is one text under one white-space, word-break and language
setting); the ICU iterator port gives ICU's boundaries on all 19,338 cases of LineBreakTest.txt; the Gecko scan gives
ICU4X's breaks on Firefox's data on all 6,569 left-to-right old-suite and corpus (`corpora/`) requests and 11,875
left-to-right generated fuzz requests, differing only inside those runs where Bun's segmenter stands in for Firefox's.
The rule they leave: an engine rule's oracle is the engine's own library (ICU over Chrome's `icudtl.dat`, libicucore
with Apple's overrides, `icu_segmenter` on Firefox's data), never a second port, and Blink's upstream tests in Ahem,
where a stand-in Canvas is exact, pin behavior cheaply.

The scans differ from their engines on purpose in three places (ENGINE_FOLLOWUPS.md, Bidi levels, direction and script
runs, and Small ones): the Blink scan makes one ICU pass per text, not Blink's restart at each line start, which differs
in 86 of 188,274 verdicts; the WebKit scan resolves no bidi levels, so it misses WebKit's splits where levels change, at
15 positions in right-to-left paragraphs (2026-09-23), such as `ab””tail` under `direction: rtl`; nor does the Gecko
scan, so it misses Firefox's text-run splits where levels change, which move a break only where the direction changes
inside a cluster (Bidi Levels).

Take each browser's shipping data, not upstream's latest: Chromium 147's `line_normal.brk` differs from 153's on 239
code points, and headless Chromium 147's ICU 77 breaks otherwise wherever ICU 78 changed the rules (the dashes it added
to the HH class, unambiguous hyphens, beside U+2010; LB20a; LB21a), so headless evidence can't check those. ICU's
`ppucd` writes no `cp` line for 210,383 code points whose values equal their block's, so a generator reading only `cp`
lines gets Cn for U+3400.

The tables are ICU's compiled state machines, whose states a small rule change renumbers. As 480 KB of base64 they cost
a fresh Firefox page 5.2 ms evaluating the bundle, against 1.2 ms before #340, so until #394 each was stored as byte
ranges of an earlier table plus literal bytes. The earlier table was the one that packed it shortest, across engines:
Chrome's `line_normal` alone, Chrome's Chinese table and Safari's `line_normal` against it, Safari's `line` against that
and its `line_cj` against `line`, and Safari's grapheme table against Chrome's. So a browser unpacked the tables its own
were packed against too, Safari three for `line`, about 0.6 ms once per page. That gave a 120 KB minified layout bundle,
57 KB gzipped, on the branch then, where packing each engine's tables only against its own gave 133 KB and 64 KB, and
keeping Chrome's root table whole with the other line tables as copies from it and every other table unpacked gave 238
KB and 57 KB and took 3.6 ms in Firefox (2026-09-24). Measured from main (`bun build src/layout.ts --minify`, then `gzip
-9`): 80 KB and 21 KB before #340, 108 KB and 52 KB at its merge (f26640eb), and 115 KB and 56 KB on 2026-09-30
(8e88756b), of which the packed tables were 47 KB of base64 and about 30 KB of the gzipped size. Taking one table's
string out of that bundle shrank the gzipped size by 9.5 KB for Chrome's root line table, 4.2 KB for its Chinese table,
7.0 KB for Firefox's line data, 2.8 KB for Firefox's bidi classes, 3.0 KB for Chrome's grapheme table and 2.5 KB for all
four of Safari's. The generator's packer then came to look for the longest copy from any earlier position and to match
lazily, which took the layout entry from 56.2 to 53.6 KB gzipped with the same unpacker and the same unpacked bytes
(#392, 2026-09-30); the parse with the fewest bytes would save 0.5 KB more and take the generator from 2 s to 10 or
more, so it wasn't taken.

Since #394 (2026-10-01) the module holds what the tables say in place of their bytes, and the layout entry is 40.4 KB
gzipped and 95.4 KB minified, 13.3 KB less of each than under #392's packing. Every code point's class in the maps the
scans read ships as one list of runs of joint classes, the classes the maps together tell apart, with a byte per joint
class for each map: engines class most code points alike, and so do one engine's tables. With #394 the maps were ten
(the categories of ICU's five line and two character tables, and Firefox's Line_Break, Bidi_Class and East_Asian_Width)
and the list 4,487 runs of 250 joint classes. From the list the library builds a table for each map its engine reads,
blocks of 256 code points behind an index, so a class is two loads for any code point. Before, ICU's tries took two
loads below U+10000 and four above, Firefox's line trie two below U+1000 and four above, East_Asian_Width a search
through its ranges, and Firefox's Bidi_Class one load below U+10000, from a table per code unit: that lookup alone
gained a load. Each state table ships as its rows' differences from rows it repeats, starting from an earlier table's
rows where one has its shape: libicucore's line tables differ from Chrome's root table in 8 rows. Chrome's Chinese table
has a category and two states more than the root table, so it ships alone. The class maps are most of what is saved; the
pair tables, Firefox's break states and the bytes per joint class keep #392's packing. Taking one string out of the
bundle now shrinks its gzipped size by 5.5 KB for the run list, 2.6 KB and 2.7 KB for the rows of Chrome's root and
Chinese line tables, 1.0 KB for the bytes per joint class and 0.5 KB or less for each other table. Nothing is derived:
the generator, still run by hand, reads the same engine files, checks every class of every code point and every state
row against them as the library unpacks them, and a test checks the shipped module the same way. Since #403 (2026-10-01)
Firefox's Bidi_Class isn't among the maps (Bidi Levels): nine maps, 4,268 runs of 155 joint classes, and a layout entry
of 37.7 KB gzipped and 89.0 KB minified, 4.4 KB and 10.7 KB less than with the map and the level port that read it.
Since #423 (2026-10-03) the script classes that Blink's script runs read are a tenth map, and the generator's check
prints the counts of the module as it stands (`bun run scripts/generate-engine-break-data.ts --check`): 4,423 runs of
248 joint classes since #426 (2026-10-05).

What that costs (2026-10-01). The unpacked tables take more memory: on a page in one language, 198 KB of typed arrays
against 103 in the Blink profile, 199 against 104 in the WebKit profile, and 151 against 40 in the Gecko profile, or 212
against 106 once it has resolved bidi levels and tested a newline between East Asian characters; 37 KB of each is the
decoded run list. A second line table on a page, Chrome's Chinese one or another of Safari's, adds about 105 KB against
77. (Counted offline as the typed arrays still held after preparing text and `clearCache()`, leaving out the 131 KB of
Unicode-property bits `hasProperty()` keeps in either form.) The first `prepare()` on a page unpacks them, which the
bench's `fresh` rows time: a page that has compiled the bundle and prepared nothing lays out its first 200 to 1,000
UTF-16 units of chat messages, then as many again. The first batch took 0.3-0.45 ms longer in Chrome than the 2.0-2.8 ms
it took before, 0.15-0.4 ms longer in Safari than 2.6-4.5 ms, and 0.1 ms or less longer in Firefox than 2.1-4.1 ms,
where two copies of the earlier bundle differed by 0.08 ms or less; compiling the bundle took as long as before (medians
of 18 pages a bundle for each of Latin, CJK, Arabic, Thai and mixed text; Chrome 154.0.8037.57, Firefox 156.0.1 and
Safari 27.0, 2026-10-01; the tables are in #394). Offline it had read 0.5-1.3 ms longer in Bun 1.4 and 0.2-0.9 ms in
Node 23. The second batch read no further from the earlier bundle's than its two copies did from each other, 0.16 ms at
most, except on Safari's Thai page: 0.26 and 0.08 ms more in the two sessions, where the copies differed by 0.04 and
0.06. No table is unpacked in a second batch in the Blink and WebKit profiles (checked offline on the bench's texts) and
each page reads text of its own, so that reading stays unexplained. The scans after that are no slower in the same
bench: no row that prepares text read slower in any browser, and in Firefox the rows that prepare text again, its widths
cached, read 3-12% faster (9% on CJK, 4% on Arabic and on mixed text, 3-12% on five of the nine worst-case texts);
nothing was run to say which lookup that comes from. Firefox's bidi resolution, the one reader whose lookup gained a
load, doesn't show: Firefox's `new` rows on Arabic and on mixed text read within noise (-2% and +5%, then +2% and +3%,
in the two sessions, the control copy between -7% and +3%), and its `seen` rows on both 4% faster in each session.
Offline it had read 1-3% slower in Node 23 and from as fast to 11% slower in Bun 1.4.
The Bidi_Class table, 43 KB of the Gecko profile's 212, left with #403, and the memory wasn't counted again after it. In
that change's bench the bundle of both entries, a tenth smaller, compiled faster on each of the five fresh pages in
every browser: in 1.61-1.68 ms against the 1.74-1.81 of the earlier bundle's two copies in Chrome, 2.76-2.86 against
3.07-3.18 in Firefox and 1.14-1.16 against 1.27-1.31 in Safari. The first batches show no change to claim: within 4% of
both copies, but Firefox's Arabic and mixed pages, 5-7% under both, and Safari's mixed page, 2-6% over both (2026-10-02,
two sessions; the tables are in #403).

Not taken: an LZ pass over these lists, which saved nothing once the bundle is gzipped and cost a decoding pass. A table
per code unit with a search above U+FFFF, the form Bidi_Class had, is one load below U+10000 and 64 KB a map, where the
block tables take 18 KB (East_Asian_Width) to 59 KB (Firefox's line classes), 43 KB for Bidi_Class, and it searches for
every emoji. Blocks below U+10000 only, with the same search above, would take about 27 KB for Chrome's root line table
in place of 55 KB (103 of its 182 blocks are below U+10000) plus its 790 ranges above, and would search for every emoji
as well, where the blocks make a class above U+FFFF cost what one below does. One bundle serves every engine (Decisions
Log, 2026-09-26; the entry of 2026-10-01 has why a shorter form was taken up after that).

Firefox's East_Asian_Width map takes a premise. Gecko asks its ICU4C for that property (`u_getIntPropertyValue`,
`intl/components/src/UnicodeProperties.h:75-100`), and the map ships the values of icu_properties, an ICU4X crate
Firefox vendors (`properties.json`). The two agree while both hold one Unicode version's values: Firefox 156.0's do, on
every code point (ICU 78.3's `uchar_props_data.h` against `properties.json`, 2026-10-01). `bun harness repin firefox`
looks in XUL for that file's arrays, which hold East_Asian_Width, so it says when Gecko's values are no longer the ones
the map was compared with; nothing compares the crate's again. If they came apart, the code points whose width changed
between the two versions would keep or lose a newline between East Asian characters where Firefox doesn't.

In Line_Break=SA runs (Thai, Lao, Khmer, Myanmar, and in the Blink and WebKit scans also Tai Le, New Tai Lue, Tai Tham,
Tai Viet and Ahom), `Intl.Segmenter` words stand in for the engines' dictionaries. Chrome 153's equal those of
`Intl.v8BreakIterator`, which runs the ICU of Chrome's layout, on 273 corpus paragraphs, though the Blink scan misses 69
Khmer positions; JavaScriptCore's, as the rebuild's WebKit port reads them, differ from libicucore's line iterator at 27
of 282,337 positions, all where a range starts with a combining mark, and main's WebKit scan was never checked against
it (ENGINE_FOLLOWUPS.md, Language and generic families); Firefox 155's matched Gecko's models on all 54,588 breaks once
breaks inside clusters are dropped, as Gecko drops them. Offline replays can't cover these runs: Bun has no
`v8BreakIterator`, and its words differ from Firefox's on some Thai.

The scans read the whole text, since merging punctuation, URLs or numbers into units first erased context later passes
couldn't recover; the Gecko scan dropped merges Firefox contradicts, such as keeping `|` with the letter after it in
`a/|b` (Dead Ends, Rules Per Input Shape). It doesn't split text runs where the script changes, as Firefox does: that
differs from the oracle in 18 more of 11,875 fuzz requests, and a port of Firefox's script itemizer cost milliseconds of
set-up (Decisions Log, 2026-09-24). Nor does it split them where the bidi level changes (Bidi Levels).

Zero-width glue (`src/analysis.ts`) is a ZWSP or soft hyphen the engine's scan doesn't break after, as before a
combining mark or a closing bracket, or under keep-all. It is its own segment and doesn't end a line; folding it into
the text after it lost rows (Dead Ends, Invisible Characters, Controls And Soft Hyphens). In Chrome and Safari
zero-width glue can still take a line when the grapheme after it doesn't fit (Chrome paints `abc`, U+00AD, `)def` at 1px
one grapheme per line), and in Firefox it can't, since Gecko drops soft hyphens and clusters a ZWSP with the marks after
it: letting it start a line lost 428 Firefox rows, and Gecko's rule lost 101 Chrome and 866 Safari rows in an offline
replay. The line walkers end lines only where the scan breaks and fill graphemes across an unbroken run: ending at any
segment boundary lost 9,068 line counts.

Gecko drops bidi controls (LRM, RLM, ALM, U+202A-U+202E, U+2066-U+2069) from its text run as it drops soft hyphens
(`IsDiscardable`, `nsTextFrameUtils.cpp:32-49`), breaks lines in text-run offsets and maps a line end past what it
dropped (`nsTextFrame.cpp:11161-11170`), so a line never ends before a control, starts with one after a wrap or breaks
inside a word at one. Since #368 (2026-09-27) the Gecko profile's analysis does the same, with no segment kind of its
own, so neither the walkers nor `layout()`'s count know of controls (Decisions Log, 2026-09-27): a run of soft hyphens
and bidi controls holding a control joins the segment before it, and the white-space collapse and the graphemes
(Grapheme Clusters From Engine Data) read past such characters. Since #399 (2026-10-01) the collapse is the scan's own:
the analysis leaves out the white space that the scan's port of `TransformText` dropped from a run that read past a soft
hyphen or bidi control, where #368 collapsed through bidi controls with a regular expression, kept a space on each side
of a soft hyphen, and scanned the text again. The scan takes a text as one of Firefox's text frames, as #368's collapse
did, since where a frame ends turns on the paragraph's direction (Engine Facts, Firefox, Text frames). A CR or FF, which
Firefox's text run keeps with no advance, leaves the same way (Engine Facts, Firefox, CR and FF). The rules that follow
from Firefox's, each with its Gecko source, are in the comments of `src/analysis.ts`; what they still get wrong is in
ENGINE_FOLLOWUPS.md, White space and controls, and what they cost under Keeping Work Bounded, Work Done Only Where A
Rule Applies.

Combining marks after zero-width glue or a control shape with the grapheme before them and what separates them, so a run
is measured after that source, minus it; without the separators Canvas composes the marks with the grapheme or draws
both in another font (in 16px Amiri `a` with U+0323 measured 2.22px more than `a`; Chrome paints the chain as wide as
`ab`). Measuring every run after the whole chain was quadratic (Keeping Work Bounded), so a long chain's context keeps
the grapheme and the last runs holding 96 UTF-16 units. Safari's widths depend on a run's distance from the grapheme up
to 61 units (after `क` in 16px Georgia the first U+0323 takes 5.2px, the next 29 1.6px, the rest none). The kept context
measured within 0.002px of the whole chain in Chrome 154, Safari 27 and Firefox 156.0.1 over 12,960 chains in up to 24
fonts; leaving out the grapheme took up to 25px off (#351, 2026-09-26).

Where an emergency break falls inside a segment depends on which advances an engine adds. Firefox adds those of the word
shaped whole: in 16px Arial `بِبِ((tail` at 27.86px fits `بِبِ((` and starts the next line at `tail`, while summing
isolated graphemes charged both ب their isolated 11.42px (the first takes 3.9px joined) and lost 460 old-suite rows in
the installed browsers. The Gecko profile, like the WebKit one, fits from grapheme prefixes, which give each letter its
left context but miss kerning with the next grapheme and the joined form the next letter gives it. In an offline replay
prefixes gained 2,110 left-to-right and 703 right-to-left line counts over sums, lost 643 and 349, and doubled a cold
preparation's Canvas calls; pairs, each grapheme measured after the one before, did slightly worse at 21% more calls on
the corpora and 91% more where every preparation starts cold (Firefox 155, 2026-09-16).

So the Gecko profile takes prefixes only in segments at least 80px wide (`prefixFitMinWidth`) and sums graphemes below.
A cold Firefox preparation of real paragraphs then took 88 Canvas calls a paragraph (113 for prefixes everywhere, 86 for
sums everywhere, 79 before #340) and lost nothing to prefixes everywhere at 80px and over, where sums everywhere lost 58
line counts (Firefox 156.0, 2026-09-23). Prose has few words that wide. Interface labels in languages with long words
have many, and Firefox prepares their new labels slower than 0.0.9 did for it (below, against the released 0.0.9).

The 80px has no browser reason: it was the old suite's boundary for narrow widths. Remeasured in Firefox 156
(2026-09-27, #367), a floor at 24px, below which the harness accepts made-up cases as narrower than real layouts
(harness/README.md, What a case is and when it passes), costs as much as prefixes everywhere, since their extra calls
sit in words 24-80px wide: 99 `measureText` calls per 1,000 UTF-16 units prepared against 62, and the bench's `new`
Latin, Arabic, mixed and UI-label rows 28-68% slower in both sessions. The two give the same lines from 24px up. At
24-80px they pass 281 Firefox cases that fail with the floor, 172 of them Arabic words with vowel marks before brackets,
quotes, controls or Latin in the harness's `old-gate` set, and fail 14: ten `a ★ーb` that 80px gets right by luck
(Firefox's Canvas measures `★ー` at 32px, where the paragraph lays it out at 26.65px, which the summed graphemes match),
three Amiri splits 1/64px from where the lines change, and the one draw of the real-usage sample that moves (`TKT-84565`
in a 31.25px table cell in 16px Helvetica Neue, where prefixes give the hyphen that starts the second line its 2.05px of
kerning with the `T` before it, so `-845` fits where Firefox moves the `5` on); no draw gains, and 1.5% of the sample's
weight is narrower than 80px. So the floor stays at 80px, a premise with that gap (Decisions Log, 2026-09-27).

Prefixes aren't Firefox's lines where a cut falls between two letters shaped together. A prefix measured alone ends as
the word goes on, but for what its last letter and the next one change by standing together, which shows as the next
letter's advance after the prefix, less that letter measured alone. Where the two are a kerned pair, the prefix's last
letter lacks its part of the kerning: all of it in a font that kerns through GPOS, half in one with a `kern` or `kerx`
pair table (Kerning At Line Edges). So the Gecko profile charges a line that part too much at its end and the next line
as much too little at its start, and all three texts of #421, in 16px Helvetica Neue, come out with a wrong line count:
`AV` nine times at 85px is 9 and 9 letters in Firefox, the first line 84.67px wide, where the prefix of nine letters
alone is 85.03px, and `To.` five times at 54px is 7, 7 and 1, where the profile keeps the last `.` on the second line at
53.97px for Firefox's 54.85px. Where the two are a ligature, the prefix has its first letter alone, and Firefox's scan
counts the glyph's whole advance on that letter and nothing on the rest (Engine Facts, Firefox, Ligatures), so it ends a
line inside a ligature only where the ligature starts the line and doesn't fit: the real-usage sample's
`արդյունավետությունը։` in 16px `Arial, sans-serif` at 151px, whose fallback font draws `ու` as one glyph, ends its line
before the ligature, 140.95px wide, in Firefox, where the prefixes keep `ո` at 150.5px (Firefox 156.0.1, 2026-10-04).

Since #435 the Gecko profile counts a ligature as Firefox does, in the words it fits from prefixes
(`countLigaturesOnFirstLetter()` in `src/measurement.ts`). Where a letter's advance after its prefix isn't its advance
alone, in app units, Canvas is asked about the two letters, once per pair and font: whether the pair measures otherwise
under the letter spacing that turns optional ligatures off (Measurement Model). If it does, the two are a ligature; a
kerned pair and two joined letters measure the same. A ligature's later letters then give their advances to its first,
and the walkers need nothing more: a letter with no advance fits wherever the letter before it does, so a line ends
inside the ligature only where the ligature starts the line and doesn't fit. Letter-spaced text has no optional ligature
and is asked nothing. Against the prefixes alone in Firefox 156.0.1 (2026-10-05), 6 of 44,235 predictions differ, 3 of
them in a line's width alone: 2 accepted cases pass, the Armenian word and `x ffiffiffiffiffiffi y` in 24px Hoefler Text
at 15px, so the sample's failing draws inside the claims go from 3 to 2, and 1 case fails anew, the same Hoefler text in
a 1px box, 20 lines in Firefox and 14 in the profile, which doesn't give the letters of a ligature that starts a line it
doesn't fit the equal shares Firefox gives them (`ComputeLigatureData`, `gfxTextRun.cpp:238-322`). The letters measured
alone and the question cost 3.1% more `measureText` calls and 1.0% more submitted units on the sample, and 0.7% and 0.3%
on the books; a pair is asked once per font, so text in a font seen before costs less. Of the 405 ligatures Firefox drew
among 42,680 font and two-letter combinations probed, the question found 387, missed the 18 that are as wide as their
letters, as Helvetica Neue's `fi`, and named no pair that isn't one (Firefox 156.0.1, 2026-10-04). The rule stops where
the prefixes do: a word of more than 96 graphemes (`MAX_PREFIX_FIT_GRAPHEMES`; Keeping Work Bounded, Canvas Work) and a
run of digits are fit from letter pairs and aren't asked, so a line can still end inside a ligature there, as before
#435. In 16px `Arial, sans-serif` at 155px, `ու` 48 times, 96 letters, passes with 20 letters a line; 50 times, 100
letters, has the right line count with a letter on another line on every line, 21 letters a line for Firefox's 20; and
210 times is 20 lines for Firefox's 21 (Firefox 156.0.1, 2026-10-05). The same move over pair advances isn't built.
ENGINE_FOLLOWUPS.md, Emergency breaks inside a word, has that and what else the rule leaves.

The kerning at a cut is not ported. Canvas totals at the text's size don't show which letter of a pair holds its
kerning, and a build on a premise in its place, half on the letter before the cut in every font, was left out (Dead
Ends, Fitting, Cuts And Fast Paths; Decisions Log, 2026-10-05). `getTextClusters()` in Firefox would give every advance
inside the word in one call, ligatures and kerning alike.

Chrome reads each offset's position from the text shaped once, whole, takes the last offset within the width and one
layout unit, and shapes the line's start and end again wherever HarfBuzz marks the cut unsafe, which it does between two
kerned letters and between two joined ones (`ShapingLineBreaker::ShapeLine`, `shaping_line_breaker.cc:266-612`, the
start at `:304-324` and the end at `:511-584`); the end shaped again is tested again and only moves back. So where
letters don't join, a line is as wide as its own text shaped alone: kerning inside the line counts, kerning across a cut
is on neither side, and the next line starts with its first letter as it measures alone. The Blink profile added up
letters measured alone (the sums, below), which leaves out every kerning inside the word, and that was all 7 of the
real-usage sample's Chrome failures of a word longer than its line, URLs, message placeholders and a long Ukrainian word
whose first line Chrome fits one letter more of (`https://github.com/chenglou/pretext/issues/210` in 17px Roboto at
360px ends its line at `…/issues/21`, 358.48px, in Chrome and ended it a letter earlier in the profile).

Since #435 the Blink profile fits a word of 80px or wider, with no letter spacing and not a run of digits, on a premise:
a line holds the longest stretch of letters whose width, shaped alone, fits (`getSegmentFit()`'s `reshaped-lines` in
`src/measurement.ts`). A letter's advance is its width after the letter before it, a pair less that letter, which every
word of the font shares. Where those don't add up to the word's width, as around a ligature of three letters, a lam-alef
inside a word or the middle forms of Arabic letters, the word's prefixes are measured in their place, up to 96
graphemes. A line that starts inside the word adds what its first letter measures alone, less that advance (the handle's
`breakableLineStartExtras`, read where each of the three line walkers starts a line inside a segment); without it `To.`
five times at 54px, #421's Chrome text, kept its last `.` on the second line, a wrong line count. And a word as wide as
its letters measured alone, within 2^-17 of its width, is taken to have nothing shaped across them and keeps them as its
advances with nothing more asked: a premise for speed that here can only fail to fix. Words under 80px, letter-spaced
words and digit runs are fit as before. Digit runs are left out by what the text looks like (`numericRunRe` in
`src/prepare.ts`), not by a rule of Chrome's, which has none for digits, and no pinned case decides it
(ENGINE_FOLLOWUPS.md, Emergency breaks inside a word, has what their fit gets wrong). The floor is the Gecko profile's
premise, for its reason: with none, 233 more accepted cases pass, all made-up and most under 24px, no draw of the sample
moves, and the sample takes 22.3% more `measureText` calls than the sums in place of 7.2%, the books 50% in place of
1.3%. A higher floor costs less and gives cases back: at 100px the sample takes 4.7% more calls than the sums and 28
cases fail again, one of them a real-usage draw, a Ukrainian word about 91px wide in 12px Times New Roman in a 69.83px
box; at 120px 3.5% and 32, with #421's `To.` text at 54px; at 160px 2.4% and the same 32; at 240px 1.2% and 47. 26 of
the 32 are in boxes under 80px (Chrome 154.0.8037.57, 2026-10-04; calls counted, not timed).

Against the sums in Chrome 154.0.8037.57 (2026-10-05), 144 of 43,101 predictions differ: 39 accepted cases pass, 20 of
them wrong line counts before, none fails anew, and 12 accepted failures change kind, 8 from a wrong line count to a
character on another line and 4 the other way. The sample's failing draws inside the claims go from 29 to 22, and its 7
cases pass with every line within 0.01px of Chrome's, as do #421's three texts in 16px Helvetica Neue, of which the sums
failed `To.` five times at 54px. Of the 39, 29 have every line within 0.01px of Chrome's, leaving out the tab that hangs
at a line's end in 8 of them, which the recording counts to its tab stop and a line's `width` doesn't: the 7, #195's run
of `x` in Shantell Sans, `foo@bar.com` before a fullwidth comma and 20 cases of two made-up words before a tab or a soft
hyphen. 7 more of one of those words, `aאבaabb((بببب`, have Chrome's breaks with a line of joined Arabic letters 7.51px
wider than Chrome paints it, 2 keep-all Japanese paragraphs at 159px pass because the run's pairs hold the kerning after
`。` that single characters lack, and 1 is a `system-ui` draw outside the claims. The 4 that become wrong line counts are
`a`, U+000B, `aabb((بب` in 24px Noto Nastaliq Urdu at 48px, whose first two lines were wrong before and whose last now
holds both `ب`, 32.16px, where Chrome gives the second a line of its own; they stay accepted. On 18,382 probe layouts of
one kerned word in 13 font specs at 20-120px the profile passes 18,191, with 83 wrong line counts, where the sums passed
12,919 with 1,605. The pairs cost 7.2% more `measureText` calls and 2.5% more submitted units on the sample, which meets
331 font strings with little text each, 12.7% and 17.6% more calls on its Roboto and Inter paragraphs, whose words
rarely add up, and 1.3% on the books; a pair is asked once per font, so text in a font seen before costs less.

New interface labels pay the most for the pairs, since a label is short and a font has met few of its pairs: over
Chromium's 7,000 translated labels in 35 languages, prepared one a call in 13px `system-ui` in the order of the bench's
`new: labels` row, the profile makes 27,128 `measureText` calls where the sums made 24,647, 10.1% more, with 4.7% more
submitted units, and 10.7% more calls over the batches that row times. One language's 200 labels alone take 17.3% more
calls in English, 41.7% in German, 34.3% in Russian, 8.1% in Japanese and 50.6% in Greek and in Tamil. A pair is asked
once per font, so the extra falls as the font sees text: 1.07 calls a label over the first 100 of the 7,000, 0.29 over
the second thousand and 0.20 over the last 3,000, where 22%, 83% and 89% of the pairs looked up were already known. The
sums' own calls fall too, so over those last 3,000 the profile still makes 8.1% more. 96% of the added calls are pairs,
82% of them for words 80-120px wide, and four pair answers in five are that the two letters don't kern, which Canvas
says no other way. Each pair a font hasn't met is one unknown, and the word's width, already measured, is the one
equation the fit has for them, so no fit that asks less gives the same advances: what costs less asks fewer words or
fewer of a word's pairs, and Dead Ends, Fitting, Cuts And Fast Paths has those measured (Chrome 154.0.8037.57,
2026-10-05; calls counted in a background window). In time, the bench's `new: labels` row read slower than main in every
session of two foreground runs, 15.0% in the first (12.0%, 12.0% and 15.8%; 58.9 µs a label for 53.8) and 8.3% in the
second, with #425 in both builds (8.3%, 7.3% and 7.3%; 59.6 µs for 55.7), and its other rows of new text within noise in
both (Chrome 154.0.8037.57, 2026-10-05). By the counts, that is about what the added calls cost at main's time per call,
0.44-0.52 more calls a label over 4.33-4.45 in the batches the row times, so the time is Canvas's and not the fit's own.
The fit lands at that cost (Decisions Log, 2026-10-05).

Against the released 0.0.9, new text is mostly still faster with the fit, and not all of it (three foreground sessions
for each figure, Chrome 154.0.8037.57, Firefox 156.0.1 and Safari 27.0, 2026-10-05, with the change at ef8e4b89, before
it took #425, which changes nothing that plain `prepare()` does). The bench's rows of new prose take 33-58% less time
than 0.0.9 in Chrome, 26-39% in Firefox with Thai inside noise, and 13-37% in Safari with Arabic inside noise. Its `new:
labels` row, 35 languages mixed, reads level with 0.0.9 in Chrome (5.2% less time, inside its ±11.2% of noise) and in
Firefox (4.8% less, inside ±8.3%) and 11.1% faster in Safari; main before the fit read that row 18.7% faster than 0.0.9
in Chrome. One language's 200 labels at a time, each batch timed in a process of its own that had prepared only other
scripts' labels (three sessions in Chrome and Safari, four in Firefox; a second reader recomputed every figure from the
samples and reran German in Chrome). In Chrome, 31 of the 35 languages are faster than 0.0.9 (46% less time in English,
39% in German, 31% in Russian, 55% in Japanese) and four are slower: Tamil (31% more time), Telugu (13%), Armenian (12%)
and Hebrew (3%), which are among the costliest, 160-235 µs a label where a Latin-script one takes 10-26. Telugu was 6.7%
slower than 0.0.9 on main already. Against main the same batches take 22% more time in German, 17% in Russian, 11% in
English and 43% in Tamil, 8% over the 35 languages mixed, and read level for Japanese, Chinese, Korean, Thai and Hindi,
whose labels ask almost no pair (0-1.4% more calls). In Safari no language is slower than 0.0.9, and the fit makes
main's calls exactly. The script that timed them isn't in the repository. These figures and the Firefox ones that follow
are that day's: the timing made again on main as of #461 comes after the trace.

In Firefox eight languages' labels are slower than 0.0.9 with the fit, Armenian by 33%, Telugu 27%, Tamil 26%, Georgian
23%, Finnish 22%, Greek 19%, German 14% and Bulgarian 10%, and Dutch and Russian lean slower (9% and 5%), where English
is 17% faster and the 35 languages mixed 6.7% (each against the mean of 0.0.9's two copies in its round). Two changes
made that, traced on 2026-10-05 in Firefox 156.0.1. Most of the cost is #340's: since it the Gecko profile fits every
word of 80px or wider from its prefixes (above), one `measureText` call per letter, each a string Firefox hasn't shaped
before. German's 200 labels, on a library that has prepared nothing, take 725 calls on 0.0.9 and on the commit before
#340 (6d1d2106), 1,491 from #340 (f26640eb) on, 1,557 with #435's ligature questions (664082af), and 733 at 664082af
with the profile's floor at Infinity, so with no prefix fit: everything else between 0.0.9 and #435 adds 8 (counted in
Firefox, the commit before #340 on Firefox's logged widths). Of the 824 calls the fit makes there, 760 are prefixes and
64 the ligature questions. In the batches the timing times, main before #435 asks Firefox's Canvas 6.59 times a German
label where 0.0.9 asked 3.10. Timed with the floor at Infinity, 664082af prepares a German label in 13.1 µs, where it
takes 21.0 µs as it is and 0.0.9 takes 18.0: the fit, its prefixes and its ligature questions together, is about 36% of
the label's time, and without it main would be 29% faster than 0.0.9 there (foreground, three sessions of ten rounds).
The rest came with #435. Main before it (ab63d041) read German 14% slower than 0.0.9, as with it, Tamil 25% and Telugu
27%, about as with it, and Finnish 14%, Armenian 23%, Georgian 18%, Greek 8%, Bulgarian 3% and Dutch 4%, so in Greek,
Bulgarian and Dutch half or more of the slowdown came with #435; the timing called the difference in Finnish (8.5%) and
Armenian (6.6%) and left the others inside their noise bands, where Greek read slower with the fit in 23 of 24 rounds.
How much of that the ligature questions cost isn't traced: English labels read 7.2% slower with #435 for no more calls
in the batch timed, the build timed with #435 lacked #425, which main had, and part of a label's time follows what the
library prepared before it, not the label's own calls. A list of labels laid out at 320px reads nothing those calls
measure: plain text reads a word's cut advances only in a box narrower than the word, and no word of the 7,000 labels
reaches 240px. No fit that asks Firefox less gives the same advances in every font, since a call returns one width and a
new word's prefixes are unknowns no other word determines. One fit that asks less on a premise was built and isn't in
the library (Firefox 156.0.1, 2026-10-06, a build that isn't in the repository): a word's letter pairs asked before its
prefixes, each letter alone and after the letter before it, strings every word of a font shares, and taken for the
prefix advances where they add up to the word's width in Firefox's units of 1/60px. Its premise is that such a word has
nothing shaped across three letters. With the words that engine rules exclude left to their prefixes (a letter shaped
with both its neighbours, a joined script, a right-to-left letter or bidi control, small capitals), none of Firefox's
44,363 harness predictions differed from main's, the fit made 50% fewer calls on German's 200 labels and 51% fewer on
all 7,000, and a new label's first `prepare()` took 22.5% less time in German, 26.5% in Finnish and 25.9% in Armenian,
and 7.3% more in Telugu (foreground, three sessions of ten rounds). Real fonts break the premise where a font's rule
reaches past the neighbouring letter: Caveat in 1.0% to 3.9% of the Latin words tried, `system-ui`'s colon after a digit
or capital in bold and italic, and some three-letter string in 229 of 710 faces probed. In a box narrower than such a
word the cut then lands a letter away from Firefox's, where the prefixes have it right. A premise real fonts break isn't
taken for speed (Part 1, The Correctness Stance), so the Gecko profile keeps its prefixes. The scripts that counted and
timed the prefix fit aren't in the repository either. A fit that asks less on a premise no real font breaks, an option
that tells `prepare()` a text is never cut inside a word (TODO.md, the API discussion), or a release whose labels must
not be slower than 0.0.9's in any language, would reopen this.

The labels were timed again on main as of #461 (59c8ad3c, 2026-10-09), after #453 cut the Canvas calls of words that
hold an invisible character and #460 changed preparation a little: three foreground sessions in Chrome 154.0.8037.98 and
in Safari 27.0 and four in Firefox 156.0.1, with the script of 2026-10-05 changed so that every language has two copies
of each build and the same rounds. A figure is the median over the rounds of that main's time over the mean of 0.0.9's
two copies, and a language reads slower or faster only where it is outside its noise band in every session. In Firefox
seven of the 36 languages, the bench's 35 and Finnish, read slower than 0.0.9: Armenian by 36%, Georgian and Telugu 24%,
Tamil 22%, Finnish 21%, Greek 19% and German 17%. Bulgarian (5%) and Dutch (3%) are inside noise now, as are Russian,
Ukrainian, Thai, Khmer and Amharic, and 22 read faster. In Chrome four read slower, Tamil by 29%, Armenian 12%, Telugu
11% and Hebrew 2%, and the other 32 faster. In Safari none reads slower, 30 read faster and six are inside noise.
English labels take 41% less time than 0.0.9's in Chrome, 20% in Firefox and 21% in Safari (over 0.0.9's first copy).
The slower languages' labels make 62% to 152% more `measureText` calls than 0.0.9's in the batches timed in Firefox and
10% to 52% more in Chrome; Dutch's and Bulgarian's make about twice 0.0.9's in Firefox and read inside noise (calls
counted in background sessions). The changelog's speed entry states these figures without Hebrew's 2%, a slowdown of a
few percent. The script still isn't in the repository, and a later change to what `prepare()` runs wants the labels
timed again.

What the labels get for it, on 13,090 probe layouts of one word a paragraph: 390 words of 78px or wider from those
labels, Latin, Cyrillic and Greek in 13px Helvetica Neue, 13px Inter and 14px Roboto and Tamil in 13px Tamil Sangam MN,
in boxes of 50-140px, and 130 Arabic words of seven letters or more in 24px and 32px Geeza Pro, 24px Arial and 24px Noto
Naskh Arabic in boxes of 48-160px. Chrome cuts the word in 6,063 of them. Of the 5,077 that aren't Arabic the profile
fails 4, each the right line count with a letter on another line in a box under 80px, where the sums failed 142, 9 of
them wrong line counts and 60 in boxes of 80px or wider. Of the 986 Arabic ones it fails 577, 5 of the 144 in boxes of
80px or wider, where the sums failed 848 and 117: in a joined script the prefixes are not Chrome's rule and still far
nearer to it than the letters alone (Chrome 154.0.8037.57, 2026-10-05).

What the premise leaves, each in ENGINE_FOLLOWUPS.md, Emergency breaks inside a word: a wrapped line whose every pair of
letters is kerned, which Chrome can leave wider than its box by a rule that turns on which glyph holds a pair's kerning
and on the device pixel ratio; a pair that kerns apart at the cut; joined scripts, where Chrome shapes a line again with
the whole text as context (`harfbuzz_shaper.cc:989-1007`), so the letters at a cut keep the forms they have in the word;
and a line that starts inside a ligature of three letters, whose second letter keeps the advance it has in the word's
prefixes where Chrome shapes the line's start again. The first two can fail a layout the sums pass, since their lines,
without any kerning, land on Chrome's side of some cuts by luck: 5 of 4,480 probe layouts of real-looking long words,
each with the right line count, against 696 fixed; the last made a wrong line count of two probe layouts the sums pass,
`nnnnffinnnnnnnnnnnn` in 16px Roboto at 43.8px and in 16px Baskerville at 42.1px. `getTextClusters()` shipping in
Chrome, if its positions are the advance sums, would give the positions the engine reads and reopen all four.

A rule ending an overflowing segment's emergency split after its last fitting hyphen, which recovered breaks hidden when
main merged segments before the engine scans, was dropped on 2026-09-16: a scan segment ends at every break, so a hyphen
inside one has no break after it and all three browsers fill graphemes past it, and only 188 of 374,178 Blink scan
segments over the corpora and tests held one.

U+3000 hangs at a line end in Chrome and Firefox, as a space does, not in Safari: `中文`, U+3000, `中文` at 33px in 16px
PingFang SC is 2 lines in Chrome 153 and Firefox 156, 3 in Safari 27. Hanging it gained 386 CJK test cases in the
Chromium and Gecko profiles (2026-09-23) and 412 Firefox line counts in the old suite, losing none.

Facts the ports give by construction still took browser runs to find (March to mid-September 2026): a ZWSP that starts a
paragraph or follows a hard break takes a line of its own when the next word doesn't fit, in all three; after CJK text
all three keep `.,:;)]%'"` with what follows and disagree after `!`, `}`, `/` and `|` (#274).

Soft hyphens are common in some languages and nearly absent in others (2026-09-11): about 1 page in 10 turns on
`hyphens: auto` (HTTP Archive, 2025); 7 of 14 sampled German, Dutch and Nordic news homepages had a soft hyphen, and at
least 0.21% of German Wikipedia articles do, against 3 of 1.22 million Arabic Wikipedia articles. Persian's, about 225
per million, are mostly Word's optional hyphen typed where a zero-width non-joiner belongs, worth reading before any
Arabic-script soft-hyphen policy. This is the evidence behind leaving `hyphens: auto` out (Part 1, Limits).

### Grapheme Clusters From Engine Data

Grapheme clusters come from Chrome 153's (ICU 78.2) and libicucore 78.1's character rules, not `Intl.Segmenter`, whose
graphemes, an object and a substring per cluster, were 40-58% of preparing new text in Chrome and Safari and 64-76% with
letter spacing (#344, 2026-09-24, has the speed table). That day each profile's table gave `Intl.Segmenter`'s clusters
in Chrome 153, Safari 27 and Firefox 156 on every code point in 14 contexts, the corpora and 20.8 million random strings
(`scripts/grapheme-check/`). Chrome's and Apple's tables differ only at Apple's 39 transcoding hints. Firefox 156's
ICU4X data puts every code point in Chrome's 18 classes and ended clusters where ICU does on 3 million strings in a
one-off run, so the Gecko profile takes Chrome's table; the generator's standing check covers about 211,000 strings.
Firefox clusters its text run, which leaves out soft hyphens and bidi controls, so since #368 the Gecko profile's
table, `gecko/char`, reads Chrome's rules past them, and such a character takes no letter spacing of its own
(`src/graphemes.ts` and `src/analysis.ts` have the rule). A cursor's
`graphemeIndex` counts the profile's clusters, so in the Gecko profile it is one less than `Intl.Segmenter`'s count of
the segment's graphemes for each soft hyphen or bidi control before the cursor (`\u2068Bartholomew\u2069 joined` at 40px
ends its first line at grapheme 4, after `\u2068Bart`; 2026-09-30). `materializeLineRange()` from the segment's start
to a cursor inside it gives the text before the cursor in every profile. Counting those characters would take a
cluster of no width that no line may end before, the zero-width glue #368 rejected (Decisions Log, 2026-09-27), and
source offsets don't need it: a materialized rich-inline fragment says where it starts and ends in its item's `text`,
those characters counted (`sourceStart`, `sourceEnd`; Rich Inline Boundaries, Rich Inline As One Paragraph).

The tables don't follow a browser to another Unicode version: Node 23's ICU 77.1 (Unicode 16) differs on 1,417 code
points, 689 symbols Unicode 17 took out of Extended_Pictographic (the chess symbols, playing cards), which no longer
join a ZWJ sequence, 686 consonants and linkers in 14 scripts whose conjuncts Unicode 17 joins (Myanmar, Khmer and
Javanese among them) and 42 new characters. They're refreshed when browsers move to Unicode 18; `bun harness repin`
reports when a pinned browser's data changes.

Every text segment takes emergency grapheme breaks, since under `overflow-wrap: break-word` all three engines ignore
line-break classes there, kinsoku (the rules against starting or ending a line with certain CJK punctuation) and
keep-all included. Taking the permission from `Intl.Segmenter`'s word-likeness was wrong: JavaScriptCore withholds it
from numbers (`11111111` at 1px stayed one line) and every engine from emoji and symbol runs (`🇺🇸/👩‍💻` at 8px), 756
old-suite rows between them. Gecko clusters its text run per shaped word after dropping soft hyphens and bidi controls,
so the Gecko scan's cluster starts decide where segments split: for `a`, `👩`, U+00AD, ZWJ, `🚀`, `b` at 0px Firefox
paints `a` / `👩-` / ZWJ `🚀` / `b`, where Unicode graphemes split the ZWJ from the rocket (68 old-suite rows).

Safari's emergency breaks can land inside a grapheme, and Pretext's cursors never do (Decisions Log, 2026-09-12).

### Widths After A Line Break

A ZWSP at a paragraph or hard-break start is real source: it establishes a line and offers a break after it, without a
letter-spacing gap. Chrome and Firefox shape an Arabic letter before a chosen soft hyphen in context: for ZWSP, ب, SHY,
ب in 16px Amiri, Pretext sizes `ب-` at 20.70px, the isolated beh plus a hyphen, where Chrome paints about 8.95px,
Firefox 9.85px and Safari the isolated 14.82px. No rule in `layout()` can repair it, since the same text with U+A65C for
beh prepares the same widths and breaks otherwise: it needs contextual widths during preparation (Dead Ends, Rules Per
Input Shape, with the shortcuts that lost). Canvas gives joined forms poorly: across a ZWJ only in a right-to-left
context in Chrome and Firefox (22-24 of 24 forms right, 3-8 left-to-right); Geeza Pro joins only inside one shaping
group; Amiri and the Noto Arabic fonts swap both glyphs where two letters meet, so no Canvas string measures a first
glyph in its word's form (Chrome 153, Firefox 155, 2026-09-12 to 20).

Pretext consumes a soft hyphen at a paragraph or hard-break start (Firefox drops it too; Chrome and Safari keep it,
ENGINE_FOLLOWUPS.md), but the hard break after it ends a line in all three browsers: `a`, LF, soft hyphen, LF, `b` in
pre-wrap paints three lines in each, the second with nothing visible, as do two soft hyphens there and two such chunks
in a row. So a hard break ending a chunk that holds nothing else makes an empty line, where Pretext used to drop the
chunk with its hard break; so do collapsible spaces between two U+2028 or U+2029, which Safari takes as hard breaks in
normal white space too. At the end of the text, with no hard break after them, the soft hyphens Chrome and Safari keep
still take a line, where Firefox and Pretext give none (ENGINE_FOLLOWUPS.md). The harness's `followups/soft-hyphen-line`
cases pin these shapes (#349, 2026-09-25).
<!-- Cited by harness/sets/catalog.ts and 193 case origins ("a line holding only a soft hyphen", "... a collapsible
space"): keep this paragraph and the heading. -->

Keep the original source through analysis: normalization erases distinctions browsers keep. In normal white space Chrome
gives a form feed and a ZWSP two lines at width 1 and one at 100, though both normalize to a ZWSP, and in pre-wrap a raw
CR before a ZWSP occupies one native line where Pretext's CR is a hard break (Chrome 153, mid-September 2026;
ENGINE_FOLLOWUPS.md).

Three widths pass for "remaining width": the one deciding whether the rest of a word fits intact, the one given a
selected prefix, and the suffix measured afresh after the break; the whole minus a prefix isn't the reshaped suffix.
Prefix widths needn't grow: at −8px letter spacing, 16px Arial `WWi`'s prefixes measure 7.10, 14.20 and 9.76px, so the
whole word fits 12px where a shorter prefix doesn't, and "the farthest prefix that fits" is the wrong search. Each
engine admits the rest by its own one of these (`entryFitBasis`); choosing otherwise lost elsewhere (Dead Ends).

HarfBuzz reaches past a word, so a line start inherits more than its first glyph (rebuild harness, citing Chromium 152's
HarfBuzz): it normalizes a whole shaping call once the call holds a combining mark (in italic Athelas `tở` measures up
to 1px wider at 32px after a `café` spelled with U+0301 three words back); its lookups skip default-ignorables and,
where told to, marks, so two letters kern across a soft hyphen and a kasra; and it picks a buffer's direction from all
it holds, so a digits-only window cut from a unit with letters shapes the other way. A probe window whose far side holds
only `. ` has no script and gives false misses: windows need a letter on each side.

Firefox treats white space at line edges its own way (Firefox 155 and 156, installed and from source, 2026-09-15 to 26).
It hangs only U+0020 and U+3000, so a tab doesn't hang: hanging tabs in every profile lost 432 Firefox rows (old suite).
It removes a newline between wide characters and, on `ja` and `zh` pages, one next to East Asian punctuation
(ENGINE_FOLLOWUPS.md, White space and controls), and transforms white space per direction run, so a newline ending a run
between Japanese characters stays a space (Engine Facts, Firefox, Text frames). It drops bidi controls from its text run
as it drops soft hyphens, which the Gecko profile's analysis follows since #368 (Break Opportunities From Engine Data).
It trims a line's leading white space only from where the line starts in a text frame, so a soft hyphen that starts a
paragraph keeps the white space after it on the line, and trims U+1680 at line edges (both in ENGINE_FOLLOWUPS.md, White
space and controls), and it breaks between a ZWSP and a following combining mark.

### Kerning At Line Edges

Segments are measured alone, so kerning across a segment's edge is missing; the engines keep different parts of it, and
Canvas shows only some. Pretext assumes default font kerning (README.md, Caveats); a `fontKerning` option was declined
on 2026-09-12 (Dead Ends).

Safari measures a text item directly followed by U+0020 with the space, minus an unshaped space, so the item keeps its
kerning with the space whether the space continues the line or hangs; the WebKit profile measures such segments the same
way. In 18px Times New Roman, `A`, ZWSP, space, `B` puts `A` on a 12px line at 12.006px, though the letter alone is
12.999px. After an emergency break inside an item WebKit gives the rest the item's width minus the prefix, unclamped:
with WJ for the ZWSP, at widths 1 and 8, the rest is WJ and the space at −0.993px, drawn outside the line's start edge,
so Pretext fits with the signed advance and reports 0 (Decisions Log, 2026-09-12). WebKit also kerns Times New Roman's
`A` before CR as before a space, which Canvas can't show (Safari 26.5.2 and source, 2026-09-12 to 15; unconfirmed on
27).

Format characters between the word and the space resolve with the space, so on a right-to-left page `A`, WJ, space,
Hebrew paints the letter unkerned, and a left-to-right page kerns it. Without the page direction the profile keeps the
kerning only when the letters on both sides share a direction (`formatTailStaysWithWord()`). That rule replaced a
generated bidi-class table in #311 (2026-09-15), with 100 fewer runtime lines, 4,207 fewer lines of table, generator and
data, and the same lines on all 239,063 old-suite Safari inputs, the kind of simplification the project wants (Part 1,
Engineering); Dead Ends has the shapes rejected on the way. An explicit embedding leaves the direction unknown only in
its own paragraph: Safari lays out `AA`, WJ, space, `B`, newline, U+202A, `x` in pre-wrap 16px Arial at 20.9px in 3
lines, where checking the whole text predicted 4. Under letter spacing WebKit moves the space's gap onto the item and
clamps it at zero; taking only the kerning there lost native successes, so letter-spaced text takes none.

Measuring only a word's end with the space would be cheaper but isn't exact: in a headless WebKit census of 8.0 million
(font, word) pairs in 194 families (2026-09-12), the last grapheme cluster alone kerned otherwise in 389 pairs (in 20px
Waseem, `.` after Arabic letters takes nothing before a space, 2.47px alone) and the last two matched in every pair, but
nothing bounds how far a font's contextual lookups reach. Kerning with the space is common: PT Sans, Didot, Gill Sans,
Avenir Next and 18px `system-ui` each kern more than 2,000 distinct words of the Gatsby opening
(`corpora/en-gatsby-opening.txt`), and element geometry agreed with whole-word Canvas kerning on 2,440 of 2,551 sampled
pairs. In the fixed-pitch Fira Code and Monaspace Neon, WebKit's layout takes none of the kerning Canvas reports, which
the profile doesn't model.

Chrome's layout kerns across spaces, ZWSP, soft hyphens and same-font spans, where its Canvas, shaping word by word
(Engine Facts, Chrome), reports none of it (headless Chromium 147, 2026-09-12). In Chrome 153 a run measured whole
equals its words measured with the spaces beside them, less each inner space once, at all 379,714 positions where both
sides hold a character of a script of its own, and misses at 818 of 28,774 where one side holds none, all in Amiri
(rebuild harness).

The Chromium profile takes the kerning with spaces (#408; `getSpaceKerning()` in `src/measurement.ts`). Many fonts kern
letters against the space glyph: of the 6,000 most frequent words of the masonry demo's cards and the Gatsby opening
(`pages/demos/masonry/shower-thoughts.json`, `corpora/en-gatsby-opening.txt`), Chrome's layout kerns 131 against a space
beside them in 15px Arial, Helvetica and Trebuchet MS, 193 in Times New Roman, 59 in Roboto, 1,286 in Avenir Next, 1,382
in Gill Sans, 2,168 in PT Sans and none in Helvetica Neue, Georgia, Verdana, Tahoma, Inter or Futura. In Arial and its
like nearly all of it is the space before a capital such as `A`, `T` or `Y` (123 of the 131 words), up to 1.66px for a
word between two spaces. Before the change the profile's lines came out that much too wide, so a paragraph took a line
more than Chrome gave it: over the masonry cards at 22 widths, 200 to 368px (41,888 pairs), 70 times in Arial and
Helvetica, 71 in Times New Roman, 56 in Trebuchet MS, 150 in Avenir Next, 550 in Gill Sans, 559 in PT Sans and 300 in
Didot, against 0 to 4 in Helvetica Neue, Georgia, Verdana and Inter, and a line of six words measured more than 0.1px
wider than painted for 580 of 1,904 cards in Arial (53 of them by more than 1px, at most 2.21px). With the kerning, no
six-word line in Arial, Helvetica, Times New Roman, Trebuchet MS, Roboto, Gill Sans, Didot or Optima is more than 0.01px
off. The line counts depend on where a word's kerning with a hanging space goes (the line-end premise below). On that
page, which is start-aligned with no decoration or background, they were 2, 2, 2, 1, 0, 2, 1 and 1 with that kerning
left on the word, as Chrome leaves it there: the level of the fonts that don't kern the space. With the placement the
profile takes they are 2 in Arial, 3 in Times New Roman, 16 in Avenir Next and 43 in Gill Sans, and 2, 2, 0 and 2 where
the same cards are centered, underlined or painted on a background (the other four fonts weren't measured again). On the
harness, whose pages are of the first kind, the profile fixes 43 Chrome cases, 11 of them among the 40 real-usage
failures inside what Pretext claims (99.61% to 99.74% of real paragraphs right), and loses one, a generated
letter-spaced case that main passed by two errors that cancelled (the script runs, below; main at #399, 2026-10-02).

Outside the harness, with that kerning left on the word: of 186,720 layouts recorded fresh and not kept, 7,652 were
wrong before and 509 with it: Latin, Cyrillic and Greek paragraphs and interface texts in 56 and 80 font specs, texts
that mix scripts in 28, and the same in pre-wrap and letter-spaced (pinned Chrome 154.0.8037.57, 2026-10-01; the PR has
the table). Five that were right went wrong: four Avenir Next layouts of Russian text with a Latin word in guillemets,
where Canvas kerns the opening quote with the letter after it and the page doesn't, which the wide spaces hid before,
and one pre-wrap line of ZWNJs at word edges (ENGINE_FOLLOWUPS.md, Kerning with spaces). Of 22,680 single lines, 5,936
measured more than 0.1px wider than painted and 2 do, and 58 measured narrower and 1 does. The least width at which a
second word stays on the first line is Chrome's to 0.03px for all 650 such fits tried in 26 font specs, where main fit
171 later, by up to 3.61px, and 4 earlier. A box sized to the predicted widest line, rounded up, makes Chrome wrap again
in 2 of 8,179 multi-line layouts in 18 font specs, where main's does in none of 8,006, and in 6 of 23,041 in 12 common
ones at 34 widths, where main's does in 11 of 22,726; all eight are the guillemet text in 14px Avenir Next.

The 46,400 Latin, Cyrillic and Greek interface layouts among them (58 texts at 10 widths in 80 font specs) were recorded
again with the profile's placement, start-aligned, with the block centered, and with the block painted on a background.
Wrong on main, with the kerning on the word, and with the profile: 2,086, 90 and 196 start-aligned, and 2,000, 194 and
92 in each of the other two. Three of the profile's are a line fewer than Chrome in every mode, the same three as on
main; with the kerning on the word, 24 are in each of the other two modes. Two layouts that main has right go wrong in
every mode, a line that ends in `if` or `of` in 16px Baskerville and in Arial Rounded MT Bold (a kerning that widens,
below), and one more of the guillemet text in italic 14px Avenir Next where the block is centered or has a background;
with the kerning on the word 2 go wrong start-aligned and 87 in each of the other two (pinned Chrome 154.0.8037.57,
2026-10-01).

The cost is Canvas calls while a font is new. A font is first asked once whether it kerns anything with the space
(`getFontSpaceKerning()` in `src/measurement.ts`; the premise is below): one string, U+2028 before, between and after
the 94 printable ASCII characters, measured as the context stands and again under `fontKerning = 'none'`. A font whose
two widths are equal takes no kerning with spaces: none of its words is looked at and its texts aren't scanned for
direction. That is 695 of the 819 faces measured below, Helvetica Neue, Georgia, Verdana and Inter among them. In a font
that kerns, each distinct first and last character of its words is then asked about. Each of the 1,904 cards prepared
alone in a new font, 15px Arial, makes 1.51 times main's `measureText` calls (97,271 to 147,169 in all; the median card
1.53 times, from 1.23 to 1.75) and 1.39 times its submitted units. The first 10 prepared in order make 24% more calls
(287 to 355), the first 100 9% more and all of them 1.4% more (11,810 to 11,981). Those were counted before the font's
question, which adds its two calls of 189 units to each. Alone in a new font that kerns, Gatsby paragraphs make 1.37
times the calls, Hindi ones 1.21 and Thai ones 1.14; Chinese, Japanese and Korean ones stay within 2% in order and 6%
alone, since ideographs, kana and Hangul syllables aren't asked about. Korean's figure rests on a premise (below): asked
about, its syllables made 2.30 times main's calls in order and 3.16 times the units.

The harness predicts its sample's 11,901 paragraphs in 72 documents, where their 331 font strings are new 1,764 times,
1,508 of them with a text that holds a space: 6.7 paragraphs to a new font. There the calls grow 10.1% (245,597 to
270,482) and the submitted units 85% (874,030 to 1,613,539), the question's 378 units each time; a font's letter-spaced
text, which is measured apart from its other text since #397, asks again, which is a fifth of that growth (before #397
the calls grew 8.9% and the units 70%). With every font's words asked about and no question, the calls grew 18.1% and
the units 9.7%. The books, 72 long texts in 12 fonts, make 25 more calls of 48,921 and 1.8% more units, where they made
0.9% more calls. So the question costs most where a font holds little text. In a background window of pinned Chrome on a
busy machine, so as hypotheses: in a font size Canvas hasn't measured in, the question took 0.6 to 1.75 times as long as
measuring 60 words apart (0.1ms in Roboto served as a web font, 0.2 to 0.7ms in Helvetica Neue, Arial, Georgia, Times
New Roman and Gill Sans; the median of 259 families 1.75 times), and 0.3 to 0.75 times as long as the 155 calls per font
it replaces on the sample. Nearly all of it is the first call, which makes Canvas load the 94 glyphs, most of which a
font that holds much text loads anyway. The first question in a family took longer, 0.6 to 2ms in those fonts, 9ms in
Papyrus and Bradley Hand and 234ms in Chalkduster, whose glyphs are heavy however they are asked for: at each later size
its question took 2.7ms, as did its 94 characters in one string without U+2028 (2026-10-01). The bench's `fresh` rows
are where this shows. Chrome 154's bench, whose own fonts kern nothing with the space, read seen text 2.9% slower in
Latin and 3.8% in CJK with every font's words asked about, and every new and seen row within noise of main with the
question. With its Latin rows in Arial it read seen text 3.4% slower than main and in Gill Sans 5.1%, both with a word's
kerning left on the word, which copies the word's fit advances wherever it kerns (two sessions each, 2026-10-01; the PR
has the tables). With the placement the profile takes, it read every new and seen row within noise in its own fonts,
Latin seen text 3.0% slower in Arial and 4.3% in Gill Sans, and a fresh page's first batch in Arial at 2.60µs a unit
against 2.23 (two sessions each, 2026-10-02, against the main before #394). With the one reader of script runs, against
main as of #399, it read every row within noise in its own fonts with a fresh page's first batch at 2.77µs a unit
against 2.63, Latin seen text 2.7% slower in Arial and 5.6% in Gill Sans, Latin new text 8.1% slower in Arial beside a
second copy of main 5.9% and 6.3% slower than the first, and the first batch at 3.14 against 2.78 in Arial and 3.33
against 2.91 in Gill Sans (two sessions each, 2026-10-02; #408 has the tables).

Canvas gives the kerning where U+2028 stands for the space: Blink draws U+2028 with the space glyph and its Canvas
doesn't cut there. A word measured with U+2028 after it, and before it, less the word and a space, equals what the
layout adds to that word between two spaces, to 0.014px, for all 6,000 words in each of 21 families. The profile asks
only for the word's edge characters, `A` then U+2028 and U+2028 then `T`, which gave the same value as the whole word
for every one of those words and families, so the cost follows the edge characters a font's words have, not its
vocabulary. The premises and their gaps:

- **The edge character stands for the word.** A font whose lookups read further than the pair, or whose word ends in a
  ligature that kerns unlike its last letter, isn't seen; a headless WebKit census found such pairs in 389 of 8.0
  million (above). A character that is part of a longer cluster takes none: a combining mark, half of a surrogate pair,
  and a first letter with a combining mark after it, which the font may draw as one glyph. Arial pairs the space with
  `A` and not with `Á`, so decomposed `vu Ávila` (`A`, U+0301) is 56.02px wide in 16px Arial in Chrome, and the bare
  letter's kerning made it 0.88px narrower, as it did in 18 of 26 font specs, by up to 1.60px. The price is a letter
  with a mark the font has no glyph for, which kerns as the bare letter does: `x T̂ y` stays 2.40px wide in Gill Sans.
  Default ignorables at a word's edge are passed over, as HarfBuzz's lookups pass over them. A Common edge character, a
  comma or a full stop, is shaped on the page in the script of the run it sits in, and Canvas shapes it with U+2028 as
  Common. None of the 21 families kerned the two otherwise in Latin, Cyrillic or Greek text, but some do after other
  scripts: in `16px Didot, "Times New Roman"` Chrome lays `ไทย, ไทย` out without the 0.88px the comma kerns with a space
  after Latin, and in 16px Chalkboard SE one Cyrillic line of 405 came out 0.63px narrower than painted.
- **A line that ends at a space has its last word without a kerning that tightens the two.** The space after a line's
  last word hangs. By default Blink leaves the word's kerning with it in place: where a break follows a space it doesn't
  shape the line's end again (`DontReshapeEndIfAtSpace`, `line_breaker.cc:1655-1659`;
  `shaping_line_breaker.cc:484-488`). Where the line needs an accurate end position it does, up to the end of the word,
  and the word loses the kerning: under `text-align` center, end or justify, or right in left-to-right text
  (`ComputeNeedsAccurateEndPosition`, `line_info.cc:127-150`), and where the element that directly holds the line's last
  text has a text decoration or a background (`NeedsAccurateEndPosition`, `line_breaker.cc:255-268`). A line then fits
  where its last word fits both ways, with the kerning, at the break Blink finds in the run shaped whole, and without
  it, shaped again: Avenir Next's `f` moves 0.36px away from a space after it, and a line that ends in `of` needs that
  room in every mode. Pretext reads no style, so the profile takes the second rule for every text: a kerning that
  tightens a word and the space after it goes on the space, and one that widens them stays on the word. (A space's
  kerning with the word after it goes on the space under either rule, since a line that breaks between the two is shaped
  again without it, `shaping_line_breaker.cc:307-324`.) In start-aligned text with no decoration or background, a line's
  last word is then wider in the profile than in Chrome by the kerning, as it is on main, so a line can wrap a word that
  Chrome keeps, and never the other way. Over the masonry cards at 22 widths in 15px, 41,888 layouts for each font and
  mode, the wrong line counts on main, with a word's kerning left on the word, and with the profile:

  | | Arial | Times New Roman | Gill Sans | Avenir Next |
  |---|---|---|---|---|
  | start-aligned, no decoration or background | 70 / 2 / 2 | 71 / 2 / 3 | 550 / 2 / 43 | 150 / 0 / 16 |
  | each of six other modes | 70 / 2 / 2 | 70 / 3 / 2 | 509 / 43 / 2 | 136 / 16 / 0 |

  The six are centered, right-aligned, justified, underlined, a background on a span around the text and a background on
  the block that holds it. Each gave the same counts, and a span without a background gave the first row's (pinned
  Chrome 154.0.8037.57, 2026-10-01). Every wrong count of the profile is a line too many, in both rows, and a box sized
  to its widest line, rounded up, makes Chrome wrap again in no layout of either row. With the kerning on the word, the
  second row's wrong counts are a line too few, 41 of Gill Sans's 43, all 16 of Avenir Next's and 1 of Times New Roman's
  3, which clips text in a list of predicted heights, and its box makes Chrome wrap again there in 433 of 37,786
  multi-line layouts in Gill Sans, 231 of 38,844 in Avenir Next, 3 in Times New Roman and 2 in Arial. (Main's wrong
  counts are a line too many but for 25 and 26 in Avenir Next, whose box makes Chrome wrap again in 351 and 376
  layouts.) Right counts with a wrong break, in Gill Sans: 3,443 and 3,255 on main, 433 and 660 with the kerning on the
  word, 663 and 431 with the profile. So the two placements mirror each other, each as good in its kind of text as the
  other is in the other kind, and the profile takes the one whose errors are of main's kind: a line more, in a box at
  least as wide as Chrome needs. Text painted directly in an element with a background, as a chat bubble's or a card's
  often is, is the second kind, as in the bubbles and masonry demos. The harness records the first kind only, so of the
  64 Chrome cases that the kerning on the word fixed, 21 fail as on main: a word ending in `A` in 16px Arial that ends a
  line in a box under 80px, under a reason of their own on Chrome's accepted list. Reopens with an option on `prepare()`
  that says a text is start-aligned with no decoration or background, the one fact of style the exact answer needs, or
  with evidence that such text's lines matter more than the other kind's.
- **A kerning that widens stays whole on the word.** GPOS pair positioning puts a pair's kerning on its first glyph.
  HarfBuzz puts one from the legacy `kern` table, or from a pair subtable of an AAT `kerx` one, half on each glyph's
  advance (`hb_kern_machine_t::kern`, `hb-kern.hh:100-107`): Chrome's first-word share was 1.00 in Arial, Avenir Next,
  Gill Sans, Roboto and PT Sans and 0.50 in Helvetica, Times New Roman, Trebuchet MS, Didot, Palatino and Hoefler Text.
  A kerning that tightens goes on the space whichever the font is, so the profile doesn't ask. One that widens it leaves
  on the word, where a GPOS font has it; in a `kern`-table font Chrome leaves half of it on the space, so a line that
  ends at such a word is half the kerning wider in the profile and can wrap early. 16px Baskerville's `f` moves 2.31px
  away from a space after it, of which the page leaves 1.16px on the word: `Way, key To, few Tears, of Yore, if` is
  219.66px on the page and doesn't fit 220px in the profile, nor a line that ends in `of` 340px in 16px Arial Rounded MT
  Bold (1.79 and 0.90px), the 2 of the 46,400 interface layouts above. The first builds asked each font once where its
  kerning sits: under `fontKerning = 'normal'` Canvas shapes a string whole, its U+0020 included, only where the font's
  GPOS covers the space glyph (`font_fallback_list.cc:264-277`, `harfbuzz_face.cc:341-385`), so a font in which that
  shows none of a kerning that U+2028 shows has it from `kern`. That answer, one Canvas call per font and 15 lines,
  would give such a word Chrome's half. Reopens with a common font whose `kern` table moves a word's last letter away
  from the space.
- **A space is in the script run of the text before it**, as a Common character is, and Blink shapes each run apart, so
  a space after Cyrillic doesn't kern with a Latin word after it. Without this the profile lost a Bulgarian paragraph
  holding `на Android` (`sample-44c6920027f6c34e`), and eight more lines of the sample came out narrower than painted.
  Blink reads Script_Extensions (`ICUScriptData::GetScripts`, `script_run_iterator.cc:120-216`): a Common character with
  extensions is in those scripts only, and a run keeps the scripts all its characters share (`MergeSets`, `:490-565`).
  So an ideographic full stop or comma, a katakana middle dot or a corner bracket ends a Latin run, and the space after
  `App。` doesn't kern with `You`; read by the Script property it did, 0.29px narrow in 16px Arial and 2.80px in italic
  Gill Sans. A middle dot, which Latin and Greek share, goes on a Latin run and ends a Cyrillic one, and so does the
  narrow no-break space. A closing bracket takes the script of the run its opening bracket is in (`CloseBracket`,
  `:443-489`), so the space after `на [Yandex]` is in a Cyrillic run and doesn't kern with a Latin `Y`, and the space
  after `a (б)` kerns with `T`; an opening bracket that is East Asian wide is in the Han scripts
  (`FixScriptsByEastAsianWidth`, `:83-110`), so neither does the space after `on （Yandex）` or the one in `x （ Tom`.
  Where a search for the space's run meets a closing bracket or a character of several scripts, the profile reads the
  runs from the text's start as Blink does (`readScriptRuns()` in `src/prepare.ts`). A run that ends with several
  scripts left gives its opening bracket the first of them, and Blink orders a Common character's extensions by ICU
  script code with Latin last (`GetScripts`, `:191-198`): after `(· ж)` the space doesn't kern with a Latin word. That
  reader is the one the rule for letter spacing in cursive scripts reads the runs through (Engine Facts, Chrome, Letter
  spacing and tabs), since one library holds one port of an engine's rule. The first builds gave the kerning a reader of
  its own, with any opening bracket the pair of any closing one, only the last one opened remembered, half of a
  surrogate pair read as Common and no rule for a Common character under a mark. With the letter-spacing rule's bracket
  pairs, bracket stack and mark rule, and a character's scripts as bits for both, the two rules take 20 code lines fewer
  than side by side, and the kerning is Chrome's where its own reader wasn't: of 25 strings, the reader of its own had
  10 a kerning off in 16px Arial, 0.88px, and 9 in 16px Gill Sans, 1.60px, 6 of them narrower than the page (`жж (All
  [All] All) All`, where the last bracket goes back to the Cyrillic run past the inner pair; `All (жж] All`, where `]`
  pairs with nothing; `All`, `1` under the Greek mark U+0342, `All`; two Deseret letters before `All`; `All 〈 All` and
  `All 〈All〉 All`, whose bracket is U+2329), and the shared one has all 25 to 0.01px in both (pinned Chrome
  154.0.8037.57, 2026-10-02). Scripts other than Latin, Cyrillic, Greek and the seven cursive ones count as one, and the
  cursive ones as one (ENGINE_FOLLOWUPS.md, Kerning with spaces, has what that and the reader's other gaps get wrong).
- **A space kerns with a word only inside one item.** Blink shapes nothing across a control item or a change of
  direction. Preserved spaces that start the text or follow a forced break are an item of their own with a break
  opportunity after it (`inline_items_builder.cc:988-1034`), so under pre-wrap they don't kern with the word after them,
  and the profile takes none there: `  Avenue y` needs 75.31px in 16px Arial, 0.88px more than with the kerning. (Under
  `white-space: pre`, which Pretext doesn't model, Blink adds no opportunity and they kern.) A level change ends an item
  too, and levels depend on the paragraph's direction, which Pretext doesn't take (Bidi Levels): Chrome kerns the `A` of
  `NASA אבג` with the space in a left-to-right paragraph and not in a right-to-left one, 0.88px in 16px Arial. Inside a
  right-to-left item HarfBuzz shapes in visual order, where Canvas shows a pair only left to right: Chrome kerns the
  comma of `אבג, דהו` with the space in Gill Sans and not in Avenir Next, PT Sans or Didot. So text that holds a
  right-to-left letter or an explicit bidi control takes no kerning with spaces, asks Canvas nothing for it and measures
  as it did before, on a left-to-right page up to as wide as before (`אבג Tom Yates` by 2.41px in Gill Sans, 0.30px in
  Arial). Left-to-right text in a right-to-left paragraph takes it, which is wrong only before the paragraph's first
  letter, where a number or a mark is at another level: `5 Tel`, `- Tom x` and `1 A` fit 0.28 to 0.88px early in 16px
  Arial, 1.98px in Gill Sans.
- **Characters that aren't asked about.** Canvas shapes each ideograph and kana as a word of its own
  (`NextWordEndIndex`, `plain_text_node.cc:92-153`), so it can show no kerning between one and a U+2028, and the profile
  asks nothing for them. It asks nothing for a Hangul syllable either, on the premise that no font kerns one with the
  space: none of the 11,172 does in Chrome's Canvas in the 14 Korean families of macOS 27, in regular, bold and italic,
  nor in the five faces of Noto Sans CJK shaped by HarfBuzz 14.2. Korean words start and end with one of hundreds of
  syllables (326 distinct first and 191 distinct last characters in 150 paragraphs of `corpora/ko-sonagi.txt`), which is
  what the calls above would have paid for. Reopens with a font that kerns a syllable with the space; Windows' Malgun
  Gothic wasn't measured.
- **A font that kerns no printable ASCII character with the space kerns nothing with it.** The font's question takes
  that for speed. `fontKerning = 'none'` turns the `kern` feature off (`FontFeatureRange::FromFontDescription`,
  `font_features.cc:39-47`), and HarfBuzz then applies no kerning from GPOS, `kern` or `kerx` (`hb-ot-shape.cc:127-131`,
  `hb-ot-kern-table.hh:67`, `hb-aat-layout-kerx-table.hh:109`), so the string's two widths differ by its characters'
  kernings with the space glyph and by nothing else. In 16px Arial, Gill Sans, Helvetica and Times New Roman they
  differ by the sum of the 94 characters' kernings asked singly, to 0.0001px, and where no character kerns they are the
  same number, so the question needs no rounding bound. Its answer was that of asking the 94 singly in every face
  tried: 819 faces of 273 families, the 257 that macOS 27 lists and 16 more that Chrome resolves, in regular, bold and
  italic, of which 124 faces of 44 families kern, and the sample's 331 font strings and 36 font lists (pinned Chrome
  154.0.8037.57, 2026-10-01). The gap is a font whose only pairs with the space are outside ASCII, which measures as on
  main. Asked singly over Latin-1, Latin Extended, Greek, Cyrillic, Armenian, Georgian, the Indic and Southeast Asian
  blocks, General Punctuation and the symbols up to U+22FF, 18 of the 819 faces are such, in 7 families, each checked
  against the page: Tamil MN (10 letters after a space, 1.17px at 16px, so a five-word line stays 4.69px wide),
  Malayalam MN and Malayalam Sangam MN (33 letters, 0.23px), Gujarati Sangam MN (3 letters, 0.01px), DIN Condensed
  (Greek `Λ` and `Τ`, 1.6 and 0.48px), bold Helvetica Neue (U+02BC, 0.88px), bold Mukta Mahee (danda, double danda and
  the four curly quotes, 0.64 to 0.96px), and bold Athelas, which moves `Ά`, `Έ`, `Ό` and `Ύ` 0.8 to 4px away from a
  space before them, so a line of four such words stays 10.4px narrow. The four Indic families are also every face
  found that kerns a letter outside Latin, Cyrillic and Greek with the space. A question of the letters alone would
  also miss bold PT Serif, Mukta Mahee, SignPainter and `system-ui` from 18px, which kern only punctuation with the
  space; one of the letters, the comma and the full stop, 218 units, would miss only SignPainter, which kerns `&`.
  Reopens with a common font in the gap; Windows' and Android's fonts weren't measured.
- **What Canvas shows under `fontKerning = 'none'` too isn't the font's kerning**, and the question doesn't see it,
  so a font that kerns no ASCII takes none of it. A character asked about singly can't tell it from kerning, so a font
  that kerns takes all of it. Some of it the page doesn't have. Canvas shapes a two-byte string by another path than a
  one-byte one (Keeping Work Bounded), so in Amiri and Noto Naskh Arabic ASCII punctuation measures otherwise with
  U+2028 than alone, a full stop 1.84px wider in 16px Amiri, while Chrome lays out `abc. def (ghi) jkl` as its words
  measure alone: with every font's words asked about, that line of Latin text was 10.86px wide in Amiri and one in Noto
  Naskh Arabic 3.29px narrow, and neither is now. U+02DD in `system-ui` is the same, 0.31px at 16px, and is still taken
  from 18px, where the font kerns the comma and full stop. Some of it the page has: Waseem widens a full stop before a
  space by 1.98px, so `abc. def. ghi` stays 3.95px narrow there, as on main; and a Thai SARA AM or a Lao AM after a
  space joins the space's cluster, so `ไทย ำ ไทย ำ` is 0.89px wide in 16px Arial without it, which Arial takes, and
  0.28px narrow in Georgia, which doesn't. Text in Amiri, Noto Naskh Arabic or Waseem mostly holds Arabic letters and
  takes no kerning either way.
- **U+2028 measures as the space.** Where it doesn't, no kerning is taken, which a font is asked once, after its
  question found kerning. In 16px Euphemia UCAS U+2028 alone is 8.05px and a space alone 4.75px: Blink draws both with
  the space glyph, which is that wide outside Latin text. The page shows none of the kerning its question finds in
  `Tom Avenue Yes, no. x`, and none is taken. (Its space is 8.05px in a run of syllabics on the page too, so
  `ᐃᓄᒃᑎᑐᑦ ᐊᒻᒪ ᑕᒪᓐᓇ` measures 6.59px narrow, on main as here.)
- **A difference no larger than float32 rounding is no kerning.** Blink adds a run's advances up in 1/65536 px and keeps
  the sum as a float32 (`ShapeResult::ComputeGlyphPositions`, `shape_result.cc:1539-1576`), which from 256px up is
  coarser than that, so a pair's width and its parts' can differ where the font kerns nothing: from 160px up, for 25,769
  of the pairs of 303 characters with U+2028 in 28 families at 11 sizes, 144 to 1,600px, by 0.000015 to 0.00012px. Taken
  as kerning, such a difference moves a width, and while the profile asked each font where its kerning sits (above) one
  could be a font's first and answer for it: in 200px Hoefler Text, `xÆ y` prepared before `xA y` left 10px of kerning
  on `xA` where Chrome leaves 5px, and so in Didot and Chalkduster, 205 of 526 such orders tried. The profile takes a
  difference of at most the pair's width / 2^22 as none, two to four float32 steps there, where three rounded widths can
  be one and a half apart: every rounding measured was at most a quarter of that bound, and the least of the 3,916
  kernings 41,596 times it (pinned Chrome 154.0.8037.57, 2026-10-01). A font's least kerning, one unit of an em of at
  most 16,384, is 256 times the bound for a pair one em wide.

Kerning across a ZWSP or a soft hyphen before a space, across a rich item's edge and across the gap between two items
stays missing (ENGINE_FOLLOWUPS.md). Letter-spaced text takes the kerning too, as Blink turns off only ligatures under
spacing (Engine Facts, Chrome).

Where a pair's adjustment sits decides what a break inside the pair leaves on each side: GPOS pair positioning puts it
all on the first glyph, the legacy `kern` table half on each (`hb-kern.hh:102-106`). On macOS, Times New Roman, Verdana,
Helvetica Neue, Hoefler Text and 10 more families split it; Arial, Futura, Gill Sans and Avenir Next are among those
that don't. Canvas adds both halves, so Chrome's and Safari's never show the placement (in Chrome, 26 families and 264
pairs gave the same values under every probe), and for a pair with the space the Chromium profile doesn't ask which
(above); Firefox rounds each glyph to app units, so it shows there at the size times 2^k. Chrome keeps kerning when it
splits an overflowing word (`'AV'.repeat(116)` at 109px takes 22 lines, not 24), which the Blink profile follows in
words of 80px or wider (#435; Break Opportunities From Engine Data). Firefox shapes words without their
spaces and splits them at ZWSP, WJ and other invisible controls, so its kerning never reaches a space, and after an
emergency break inside `AV` in 18px Times New Roman it paints `V` at 11.833px, keeping half the adjustment with `A`
(rebuild harness; the `AV` paint in Firefox 155, 2026-09-12). The Gecko profile's prefixes leave that part off the
letter before such a break (Break Opportunities From Engine Data).

### Rich Inline Boundaries

Rich inline (`prepareRichInline()`, `src/rich-inline.ts`) lays its items out as one paragraph: their texts joined and
analyzed once, each item's segments measured in the item's font, and the lines found by the text walkers (Rich Inline
As One Paragraph). Measuring each item alone is a premise whose gap is out of scope for now, since rich inline with
kerning between sibling spans is left for later (Part 1, The Per-Engine Rebuild And What Counts As Done): Chrome and
Firefox kern across same-font spans, so Arial `community` + `,` fits about 1px earlier than its two widths, and Safari
doesn't (2026-09-12). Where Pretext's plain-text walkers, given the joined text as one string, and the browser's lines
for the same text in one text node disagree, rich inline follows the walkers, which lay it out, but for a paragraph
whose whole width fits, which is one line (ENGINE_FOLLOWUPS.md, Negative letter spacing and hanging spaces). It takes
the premise that a browser lays spans out as it lays out their text in one text node; where browsers don't, mostly at
soft hyphens, bidi controls and separators beside white space at a span's edge, is in ENGINE_FOLLOWUPS.md, Rich-inline
item edges.

The rich-inline counts below from 2026-09-26 to 28 are of *probes*: cases generated for one change, each beside the
same text in one text node, recorded in Chrome, Firefox and webkit-host and not checked in, and counted against the
build before the change. The PRs named, and their commits' messages, have the full counts and attributions.

#### Rich Inline As One Paragraph

Terms: an *item* is one entry of the list `prepareRichInline()` takes, a styled run of text or a box; the *paragraph* is
all the items of one call; a *segment* is the unit the line walkers step over, a stretch of text between two places a
line may end; the *handle* is what preparation gives the walkers (`PreparedLineData`).

`prepareRichInline()` joins the items' texts, an atomic item (`break: 'never'`) or a box as one U+FFFC, and analyzes
that text once, as `prepare()` analyzes a text, with a segment starting wherever an item does (`ParagraphItems` and
`ITEM_START` in `src/analysis.ts`). It measures each item's segments in the item's font onto the lists of one handle,
which `walkPreparedLinesRaw()` and the steppers of `src/line-break.ts` lay out as they lay out a text. A line's
fragments are its segments cut where the item changes (`createLine()`). A paragraph of one text item that isn't atomic
and has no `extraWidth`, alone or among empty items, is that text's own handle.

It is the engines' model, to the extent each has one. Blink builds one string for a paragraph's inline content, with a
span's open and close tags as zero-length items over it and an atomic inline as one U+FFFC, and runs one break iterator
over it (`InlineNode::CollectInlines`, `inline_node.cc:1126-1160`; `AppendAtomicInline`,
`inline_items_builder.cc:1269-1287`; `CanBreakAfter`, `line_breaker.cc:1210-1231`). Gecko has no such string, but its
line breaker keeps the word at hand across text frames and font changes and analyzes it whole, starting again only at
an atomic frame (`nsLineBreaker::AppendText`, `nsLineBreaker.cpp:243-268`; `BuildTextRunsScanner::ScanFrame`,
`nsTextFrame.cpp:2208-2209`, `2248-2251`). WebKit cuts each text node into items from its own text and decides a
boundary between two boxes from the next box's text with the last two characters before it
(`InlineItemsBuilder.cpp:924-1051`; `TextUtil::mayBreakInBetween`, `TextUtil.cpp:367-396`). So the analysis of a
paragraph takes each engine's scan as that engine runs it: Blink's over the joined text; Gecko's over it too, with the
items as text frames for the white-space run and each item's own segment break transformation; WebKit's over each
item's text, joined by its check at a boundary (`getWebKitParagraphBreaks()`). Each item measured in its own font is
WebKit's measuring, and the named gap of the section's first paragraph in the other two. Two things Blink reads from
the paragraph's text whatever items they are in come from the paragraph's analysis: the mark before and after a shaped
run that decide a fullwidth mark's halt (`HanKerning::AppendFontFeatures`, `han_kerning.cc:266-273`, `288-294`), so a
pair of marks an item start splits halts as in one text, each mark by its own item's font, with no code for it in
`src/rich-inline.ts`; and a run of U+3000 inside an item hangs or not by what follows it in the paragraph. A run that
ends an item hangs whatever the next item starts with, as Chrome and Firefox hang it wherever a line ends: a text's run
hangs only before a break its scan gives, a narrower rule that a paragraph would lose lines by, since an item's last
run hung before this design (`addIdeographicSpaceHangs()`; ENGINE_FOLLOWUPS.md, Line edges). The hang needs a line that
ends there, and none does before an item that starts with a character the scan gives no break before, a joiner or a
combining mark and in the Blink profile a bidi control; and in the Gecko profile a run that only bidi controls follow to
the paragraph's end gets no hang, as the control is kept with the run's segment (the sweep after #460, below).

What an item carries of its own goes on its segments. Its `extraWidth` is in the width of its first segment that takes
room, and a line that starts later in the item adds it there (`lineStartExtras`, and `insideExtras` and `fillExtras`
where the line starts inside a segment, except where it starts inside a word beside a joiner or a bidi mark, whose
widths are measured afresh and leave it out, a named gap: the sweep after #460, below); an item that opens with
preserved white space, a hard break or a zero-width space gets a start edge of its own, an empty segment the line fits
by the edges the engine fits there (`getOpeningFit()`). The handle's letter spacing is the one the items share, and
where they differ each segment's width holds its item's; the hyphen a soft hyphen paints, the tab stops and the least a
tab advances are per segment where two items differ in one (`ParagraphSegmentData`). An atomic item or a box is one
segment of kind `OBJECT`, with a break on both sides and none inside.

That replaced a second line walker for rich inline, which analyzed each item's text on its own, patched it toward the
text the items join and stepped item by item, calling the text walker for one item at a time (Continuing The Line has
what it was and what it found). It kept drifting from the text walkers: each rule the text walkers gained needed its
copy at item edges (#332), as the halt of a pair of fullwidth marks did (#425). The item stepper, the walker's mode
for one item's line, the joined windows, the second handle per item and the halts read across two items are gone, and
three fields of the engine profile with them (`breaksFromItemText`, `collapsesSpaceAcrossSoftHyphens`,
`spaceBeforeSoftHyphenHangs`). As merged (#460, bf62c76a) against main at #459 (e699e27e, 2026-10-07), `src/` outside
tests is 104 lines shorter, 1,782 added and 1,886 removed by git's patience diff, and 103 lines of code shorter,
counting neither blank lines nor comment lines: `src/rich-inline.ts` goes from 1,101 lines of code to 844,
`src/analysis.ts` from 327 to 423, `src/line-break.ts` from 768 to 812 and `src/prepare.ts` from 500 to 511, as the
walker's mode for one item's line makes way for what a paragraph's segments carry. The main entry's bundle grows by
3,884 B minified (1,428 B gzipped) to 97,304 B (40,832 B), since the walker and the analysis are its own, and
`@chenglou/pretext/rich-inline` shrinks by 1,135 B minified to 108,375 B and grows by 30 B gzipped to 44,902 B
(`bun build --minify`, with the bundle piped into `gzip -9`).

What a caller sees change: a fragment's `start` and `end`, and a line's `end`, count segments of the item's part of the
paragraph, where they were cursors into `prepareWithSegments(item.text)`. The two differ in most paragraphs of several
items: an item that starts with white space after another item's text keeps that space as the first segment of its part,
where its own analysis dropped it, so each of its cursors is one higher; an atomic item is one segment, so the chip `New
York` ends at segment 1, where it ended at 3; an item that starts inside a word is cut otherwise where the scan's breaks
depend on the whole word, as a Thai word's do in the Blink and Gecko profiles; an item with `extraWidth` that opens with
a zero-width space, or in pre-wrap with spaces, a tab or a line feed, has its start edge for a first segment; and
Firefox's white-space run reads through an item's start. A paragraph of one text item that isn't atomic and has no
`extraWidth`, which is that text's own handle, keeps its text's cursors. Over 20,000 generated paragraphs of one to four
items on the stand-in Canvas, main's cursors against this design's at five widths (2026-10-06): of the 10,090 that hold
an atomic item or an item that starts with a space after another item, 7,279 differ in the Gecko and WebKit profiles and
7,329 in the Blink profile; none of the 248 whose items only end with a space, nor of the 547 that only split an
ordinary word. Of paragraphs of one item, none of 1,557 of plain words differs; 50 of 100 with `extraWidth` in pre-wrap
do; and in the Gecko profile 100 of 1,200 with unusual words do, each where a line's start skips a soft hyphen that
starts a word: the fragment starts after it, and the line before ends after it, one segment later than the item stepper
gave. The same holds for an item of a paragraph of several: of about 38,700 generated items outside the kinds above, 173
differ in the Gecko profile and 2 in the Blink profile, each holding a word that starts with a soft hyphen. So no
mapping keeps the old meaning without each item's own analysis, which the design removes. Cursors are for passing back
to `layoutNextRichInlineLineRange()` and `materializeRichInlineLineRange()`, a fragment's only in its line's range, so
the type of a materialized fragment has no `start` and `end` (Decisions Log, 2026-10-10); it has `sourceStart` and
`sourceEnd`, UTF-16 offsets in its item's `text`. Also: an atomic item of only white space is an object as wide as
its `extraWidth`, as every engine lays out an inline-block of only white space (Atomic Items' Own White Space), where it
was a collapsed space; an item of soft hyphens or a ZWSP that a line's start consumes gets no empty fragment on that
line; a collapsed space at an item's edge is measured with its item, so in the Chromium profile it takes its kerning
with the word beside it there, and in the WebKit profile a word is measured with the space that ends its item.

A paragraph whose whole width fits is one line, taken without a walk (`findWholeLine()`): most paragraphs of a chat
are. Every engine tests a line at prefixes of it and lets no content make it narrower (the function cites all three),
so the premise holds wherever no item's advance is negative; a paragraph with such an item, as a letter under a letter
spacing more negative than it is wide, is walked, and there a segment of less than no advance doesn't bring a line
that overflows back. Inside one item the premise's gap is left, as in a paragraph of one item before
(ENGINE_FOLLOWUPS.md, Negative letter spacing and hanging spaces). The fit takes the width the walkers lay out at, one
under 1px as given and one under 0 as 0 (Decisions Log, 2026-10-09, rich inline's width). Preparation finds the line by
one walk of the handle with no width limit, through `walkPreparedLinesRaw()` with a visitor of its own. What that
visitor costs a later walk in Firefox and a later step in Safari, on CJK paragraphs, and the form without it that was
measured and left out, are under Keeping Work Bounded, JavaScript Engines (The walker's visitor call).

Firefox's rules for an atomic item of width 0 (Objects Inside A Line) are stated about text frames. The paragraph's
walker doesn't know where items start, so preparation finds for each such object what a line reads of the text around
it, the white space that ends the text before it and whether what follows sends the line back, once, from the
paragraph's end back (`setEmptyObjectFacts()`), and the walker reads those two facts where the object sticks out of a
line.

Cutting a line into fragments is a second pass over the line's segments, and how it is written decides its cost in
Firefox. A first candidate of this design (branch `rich-paragraph`, 2026-10-01) walked rich lines 36-39% slower than
the item stepper in Firefox 156.0.1 and streamed them 51% slower, while finding the lines themselves 2.3 times faster
(the bench's `rich` rows, two foreground sessions, then three in the background, 2026-10-05). All of the loss was in
that pass, for three reasons none of which the design needs: two binary searches a line for the items of its first
segment and its end; an advance to the next item inside the loop; and, inside the loop, the width of a segment the line
starts or ends inside, a call and an inner loop that 7 of the bench's 2,688 lines take, since only Gecko's scan keeps a
rule of 72 hyphens as one segment. SpiderMonkey compiled the whole loop slower once that rarely taken branch held a
call or a nested loop, about 3.6 ns a segment, and didn't with a constant in its place (156.0.1's shell; its mechanism
wasn't found). With each segment's item read from a list made at preparation and the widths of the at most two partly
taken segments found before the loop, the same lines walked 10% faster than the item stepper and streamed level in
Firefox, 16-24% and 10-13% faster in V8's shell and 20-24% and 14-22% in JavaScriptCore's (background Firefox and
shells on a stand-in Canvas, so hypotheses until the bench times them; JavaScript Engines has the general rule).
`createLine()` is written that way.

That pass was still about half of what walking and streaming lines cost on text shaped as apps have it (44-62% of a
walk's instructions in the three shells, below), which the stress items, a segment an item, hid. On the chat demo's
styled paragraphs (the bench's `chat-styled` document: about 3.5 items a paragraph, 8 segments and 1.4 fragments a line
at the bench's widths on a stand-in Canvas) the paragraph walked lines 21% slower than main at #455 in Chrome 154 and
18% slower in Safari 27.0, and streamed them 27% and 26% slower, where it counted them twice as fast; Firefox 156.0.1
walked them 8% faster and streamed them 7% slower (foreground, 9-10 sessions a browser, 2026-10-07). These figures, and
the counts and timings of the two chat documents below wherever no other paragraphs are named, are from the bench as of
01ec9aa9, an earlier commit of #456: the paragraphs a document keeps, which its line operations and preparing again run
on, were 186 of `chat-styled` and 239 of `chat`, the demo's own mix of paragraphs, list items and headings, each read
after its document's batches of new text, and the walk and the stream kept every line. Since #456 the bench keeps other
paragraphs, 213 and 265, and its figures don't compare with these (Evaluation Traps, Timing). Counted as instructions
retired in the engines' shells (each figure one count, on a stand-in Canvas, by leaving each part out of the build; over
five counts JavaScriptCore's shares of the loop and of the fragment objects moved by up to 3 points), a walk of that
document was a quarter to two fifths finding the lines and the rest building them: in V8, JavaScriptCore and
SpiderMonkey 14-18% for the callback, the cursor and the line object, 22-27% for the fragment objects with the stores
into them, and 35%, 29% and 22% for the loop over the line's segments, about 120, 75 and 95 instructions a segment, as
each segment tested its item, a gap, an open fragment, a tab, letter spacing and a halt, and wrote the fragment's end.
Main stepped item by item and had no such pass; building a line cost it a third to a half of that.

`createLine()` finds where a fragment ends when it makes one, from the paragraph's lists (`itemSegments`, and
`gapSegments` at the item's two edges), so the other segments only add their widths. A line where no segment's width
depends on the line has a loop of its own that adds bare widths (`bare`: the paragraph has no tab, no letter spacing the
handle adds and no halted mark, `plainWidths`, and the line starts and ends between segments and adds nothing at its
start), as 2,387 of the 2,444 lines of that document's paragraphs of several items were at the bench's three widths, on
the paragraphs it kept before #456 (on a stand-in Canvas, in the Blink and WebKit profiles; all 2,435 in the Gecko
profile); the others keep the widths that tabs, letter spacing, halts and a line's edges need. The lines, widths and
cursors are the same in every input compared: against the loop it replaced, a fuzz of 479 Latin messages shaped as the
stress document's (its 147 kept ones and 332 of an earlier bench's), each as its items and with its plain words joined
into runs, each in normal and pre-wrap white space (1,916 inputs), and of 200,000 random paragraphs differs in none in
each of the three engine profiles, with every field of the prepared paragraph but `plainWidths`, which the change adds,
every line, range, materialized line, stream and `measureText` call compared, and `equal --offline`'s 21,251 inputs in
none in four. The kept and new paragraphs of the bench's three rich documents, 1,982 as the bench read them then and
4,805 as it reads them since #456, each in normal and pre-wrap white space, differ in none either. Neither the fuzz nor
that comparison is checked in.

Foreground, in Chrome 154.0.8037.98, Firefox 156.0.1 and Safari 27.0, 13 sessions each (2026-10-07), against the loop it
replaced: `chat-styled` walked 32%, 18% and 26% faster and streamed 31%, 17% and 25% faster; the demo's own mix (`chat`;
82% of the 239 paragraphs it kept are one item, which was one fragment already) walked 15%, 7% and 11% faster; the
stress items 5%, 11% and 14%; counting lines and preparing read level, as did every plain row in the three sessions a
browser that timed them. Against main at #459, on the paragraphs the bench keeps since #456, this design as built walks
`chat-styled` 19%, 25% and 14% faster in the same three browsers and streams it 14%, 13% and 6% faster, each called
faster by the bench but Safari's stream; it walks the stress items 26% and 21% faster in Chrome and Firefox, called, and
25-39% faster in Safari by session, called, an entry where a copy of the library keeps another speed than its twin for a
session (harness/README.md, Bench): main's copies took 3.9 to 4.7 µs per 1,000 units and this design's 2.8 to 3.0
(Speed, below, has what was timed and what the bench calls).

Without a function of its own for the line of a one-item paragraph, Safari walks `chat` 6% slower than main at #459 (on
the paragraphs the bench keeps since #456, as every reading against that main), above it in each of ten sessions and not
called, and streams it level (1% slower, above main in 6 of 10), which JavaScriptCore's shell doesn't show: it counts
3-6% fewer instructions on that line than on main's (one count each, a hypothesis). That line was a branch at the top of
`createLine()`, where the item stepper had a function for it. With `createOnlyItemLine()`, which the walk and the stream
pick for each line, Safari walked `chat` 20% faster than the build with the loop that the two loops replaced, the base
of the 13 sessions above, and streamed it 19% faster, and Chrome walked it 20% faster: 9, 10 and 5 points more than
those 13 sessions read without it (foreground, 2026-10-07; 10 sessions of that code built from a folder outside the
repository, whose bundle gets other minified names than a commit's; three sessions of the commit that adds the function,
494b0347, read `chat` the same). It cost Chrome's walk of the stress items 6 points, which then read 1.8% slower than
that base, in 8 of those 10 sessions, and 0.9% slower, 3.1% faster and 1.5% slower in the three sessions of the commit's
own build. Three forms of the split cost it 3 to 6 points (the several-item builder called from `createLine()` 3; a
closure for each kind of paragraph and one closure that picks 6; five, five and ten sessions, each of a build from a
folder outside the repository). Neither the gain nor that cost is explained. V8's shell inlines the function, 197 bytes
of bytecode, into the walk's callback and into the stream, where `createLine()` is over its inlining limit, and counts
3% fewer instructions on `chat`'s walk and stream; Chrome's walk gained and its stream read level. JavaScriptCore's top
tier inlines it into the walk, where its shell counts about 7% fewer instructions (five counts each, 2 to 10%), and not
into the stream, where it counts the same and Safari gained as much. On the stress items V8's shell inlines the same
functions with and without it and counts 1% more instructions; in Chrome the two builds walked them level in a session's
first three rounds, and from the fourth the one without the function ran 3-7% faster than before and the one with it no
faster (shells on a stand-in Canvas, hypotheses). Firefox's `chat-styled` gained 2 points less with it, 16% against 18%.
Timed directly, with the function against the same tree without it (6bc6a99f against 69342169, a local commit made to
time it; foreground, ten sessions a browser of the `rich` rows alone, on the same paragraphs, 2026-10-07 and 08, as is
each reading of the tree without the function against main at #459 in this paragraph), Safari walks `chat` 8.0% faster
and streams it 8.6% faster, both called, its copy at 1.41-1.47 and 1.53-1.57 µs per 1,000 units in every session where
both copies of the tree without took 1.55-1.59 and 1.67-1.72; Chrome walks `chat` 4.2% faster, under the tree without in
every session and not called. It costs Chrome's walk of the stress items 5.3% and Firefox's walk and stream of
`chat-styled` 2.2% and 1.5%, each above the tree without in every session and none called; no other entry tells the two
apart. Against main, as built, Safari walks `chat` 4% faster, under main in each of 16 sessions and not called, and
streams it 9% faster, called, and Chrome walks the stress items 26% faster, for 29% without the function (Speed, below,
has that timing). As a split from `createLine()` the function is 13 lines of code that remove no work and change no type
or allocation, and no property that holds across engines and versions explains what it gains (Part 1, Engineering, JIT
tuning). It stays on the direct timing, a gain on the demo's own text that the bench calls in Safari and no loss it
calls in any browser (Decisions Log, 2026-10-08), and reopens when a pinned browser moves, if that timing then shows no
gain or calls a loss. What the function leaves undone is work, in any engine: every segment of such a paragraph is the
one item's, so the item's first segment is the paragraph's first, a place in the paragraph is the same place in the
item, and the line is built from the walker's cursors as they are. Read from the paragraph's lists for every line and
taken off each of a line's three cursors, that first segment, always 0, cost Safari 27.0 3.9% and 2.0% of its walk of
one-item CJK paragraphs (two foreground runs of five sessions, slower with the reads in nine of the ten; 2026-10-08,
against 0f056620, the build with them, on the CJK documents under Speed, below). The build timed also made a paragraph's
sparse lists whole (Keeping Work Bounded, JavaScript Engines), which a paragraph of one text item doesn't make.

Three other forms were measured (2026-10-07; a shell figure is instructions retired a pass on a stand-in Canvas, a
hypothesis):
- **One loop for every line**, the bare width picked by a test in it, is 22 lines shorter and walked `chat-styled` 20%,
  17% and 21% faster than the pass it replaced in Chrome, Firefox and Safari (13 foreground sessions), against 32%, 18%
  and 26% for the two loops: with the general widths' code in the loop every engine ran the bare segments slower, and
  the stress items 4, 8 and 7 points slower. The two loops write the block that opens a fragment or a gap twice, for a
  test that never changes inside the loop taken out of it: every engine walks the stress items faster that way, and
  Chrome and Safari the styled paragraphs too. It reopens if a timing reads the one loop within about a percent of the
  two, where the shorter form is taken (Part 1, Engineering, JIT tuning).
- **A loop of bare widths for each fragment, inside the loop over the line's fragments**, walked `chat-styled` 35%, 15%
  and 28% faster and the stress items 3% slower in Chrome and 9.5% slower in Firefox (5.1 to 5.6 µs per 1,000 units,
  every one of six foreground sessions). SpiderMonkey runs the loop over fragments slower once a loop is compiled inside
  it, about 100 instructions a fragment in its shell whether the inner loop runs or not, and an item of one segment
  gains nothing back (JavaScript Engines has the first case of this). It reopens when the pinned Firefox moves, if a
  loop compiled inside that one then costs its walk of the stress items nothing.
- **Fragment widths as differences of sums stored per segment** take the pass away: `chat-styled` walked 36%, 24% and
  31% faster (five foreground sessions of a build from a folder outside the repository, as the forms of the split
  above). A fragment's width then differs from its segments' sum in the last bits (by 1.6e-12 at most over 600,000
  fuzzed paragraphs, in 46-48% of them, the fragments still adding up to the line's width), and making the list of sums
  cost Chrome 2.4-3.5% of preparing a paragraph again. Reopens if fragment widths may differ in their last bits.

What it measured, against main at #453 (d997402c) in Chrome 154.0.8037.98, Firefox 156.0.1 and webkit-host on WebKit
22625.1.29.11.27, on macOS 27.0 at device pixel ratio 2 (2026-10-06). No plain text moves: with every rich input left
out, 19,409 plain inputs of the offline comparison give the same handles, lines and `measureText` calls in all four
profiles, and no pinned plain prediction differs in any browser, but in one of three Chrome runs the one draw listed as
varying between runs. Of the pinned predictions 740, 791 and 840 differ in Chrome, Firefox and webkit-host, all rich,
most by a line's range among white space, soft hyphens and ZWSPs. Of pinned cases that main fails 11, 9 and 3 pass, and
of those it passes 18, 14 and 20 fail, each with a written reason on its accepted list: 17, 12 and 17 hold a ZWSP, which
the browsers give a line of its own after content that overflows, or whose line on main was right only by the range of
an empty fragment, all under 24px but 4 in Chrome and 4 in webkit-host; one in each is a word joiner at −1px letter
spacing; and the others are a soft hyphen item before a bidi control at 1px in Firefox and a line separator at 1 and
8.9px in webkit-host. Two more Chrome cases, at 26 and 26.7px, which main fails by a character on another line, fail by
their line count on the paragraph, a line short (ENGINE_FOLLOWUPS.md, Rich-inline item edges, has the paragraph). In
all, the pinned cases with a wrong line count, so a wrong height, go from 2,900 to 2,910 in Chrome, from 1,884 to 1,895
in Firefox and from 2,578 to 2,592 in webkit-host, each new one narrower than 24px but those two. The cases that #425,
#435 and #446 added keep main's verdicts in all three. Of the real-usage sample's draws 26, 26 and 38 differ and none
changes its verdict. Among cases that pass in both, the widest error of a line's width moves nearer the browser's in 46,
33 and 40 and further in 18, 63 and 22: nearer where a soft hyphen that ends an item now has its hyphen, further in
Firefox where a space before a soft hyphen is no longer hung (ENGINE_FOLLOWUPS.md, Rich-inline item edges). With #455 to
#459 merged and the rich set's later cases in, a lone carriage return at an item's edge and a line separator before
white space, the same comparisons against main at #459 read (2026-10-07; #460's description has the table): 766, 836 and
887 pinned predictions differ in Chrome, Firefox and webkit-host, none of them plain (of the 39,975, 41,117 and 41,472
plain cases a browser none differs as built, with the same `measureText` calls and units; a867ce82, 2026-10-09); none of
the offline comparison's 19,387 plain inputs differs in any of the four profiles; and 2,910, 1,895 and 2,594 pinned
cases have a wrong line count, where main at #459 has 2,900, 1,884 and 2,575; five of webkit-host's are the width-1
cases of the carriage-return and separator templates, on its accepted list.

Three probes, each layout recorded fresh in two document orders and predicted with main and with the paragraph, none
kept: 23,757 layouts of Chinese and Japanese text in styled runs, with fullwidth marks and U+3000 at item edges, which
are PR #425's probes; 8,504 of item edges in Latin text, as padded spans that start with white space or a hard break
in pre-wrap, soft hyphens before and after items, and chips of white space; and 4,637 of the example shapes
ENGINE_FOLLOWUPS.md names. Chrome passes 22,943, 7,850 and 3,665 of them, where main, which has #425's halts, passes
22,647, 7,659 and 3,530; Firefox 23,584, 8,443 and 4,089, against 23,412, 7,843 and 3,830; webkit-host 23,671, 8,308
and 3,935, against 23,606, 8,020 and 3,886. Main passes 206 Chrome, 146 Firefox and 169 webkit-host layouts that the
paragraph fails. Of them 94, 74 and 94 hold a line of only a chip of white space, which the recorder doesn't list and
whose height the paragraph has right where main has it wrong. The rest are gaps ENGINE_FOLLOWUPS.md names, each with
its count: a ZWSP after a chip wider than the line (51 in Chrome and in webkit-host), a soft hyphen right after a
U+3000 run (40 in Chrome), a 0px box after a space and a soft hyphen that Firefox drops (31 in Firefox), a 0px box
between two U+3000 runs (24 in Firefox), and smaller ones (21, 17 and 24): items of soft hyphens, white space and
ZWSPs found by fuzzing, a 0px box at −6px letter spacing under 6px, and in Chrome a line feed after padded spaces
whose span's end edge alone overflows. Two more causes, 29 Chrome layouts, went with the two rules about Blink's text
items (below).

Four more probes were taken the same way. Of 1,888 layouts of 32 paragraphs (split words, padded spans, chips and boxes,
pre-wrap tabs, soft hyphens at item ends, Arabic and Hebrew, styled Japanese and Chinese), Chrome passes 1,780, Firefox
1,826 and webkit-host 1,875, where main passes 1,771, 1,810 and 1,863; one webkit-host layout is lost, of two soft
hyphens across an item edge. Of 2,049 layouts of a soft hyphen that ends a padded span, at half-pixel widths, they pass
1,855, 2,013 and 2,029, against 1,788, 1,971 and 1,969; two Chrome ones are lost, at the edge of a gap main has too, the
hyphen Chrome charges where a line ends at a space after a soft hyphen. Of 1,800 layouts of 300 rich paragraphs the
Markdown chat demo prepares, both pass the same 1,797, 1,798 and 1,798. And 1,012 layouts of spaces after a line feed
before a padded item, and of a ZWSP or a soft hyphen item after spaces that hang before a box of width 0, pass 942, 988
and 998, against 930, 903 and 980, none lost. That probe showed a rule the design first had too narrow: of 356 Chrome
layouts of `ab`, a line feed and two spaces before a 6px-padded item that starts with a line feed or spaces, the first
build lost 36 at 9-14.5px, where it put the padded item's opening on the spaces' line, 5 lines for Chrome's 6. Blink
ends a text item at a line feed as at a tab, so those spaces follow no text and their line doesn't trail into the
opening (Box Edges And Pre-wrap, below, has the rule). With the rule, of 3,329 layouts that put a line feed, CRLF, a
lone CR or FF, a tab, a ZWNJ, a ZWSP or nothing before the spaces, Chrome passes 2,727, 72 more than without it and none
fewer, where main passes 2,682; and of 6,028 in 64 more shapes around it (other control and format characters, a tab and
a line feed together, the line feed in later items, other fonts and paddings, normal white space) it passes 5,639 to
main's 5,551 and loses none. Those are passes: 22 of the 6,028 that fail either way went from a wrong break to a wrong
line count with the rule, where the count before it came out right by two errors cancelling, and 18 of them have a wrong
count on main too. Firefox and webkit-host, which read no such rule, pass 2,745 and 2,937 of the 3,329, against 2,634
and 2,825, and 5,734 and 5,849 of the 6,028, against 5,077 and 5,494; they lose 145 and 12 layouts of two shapes neither
had been recorded in, a ZWSP or a soft hyphen before the spaces that end the text before the padded item, and in Firefox
a line of only a tab before a padded line feed (ENGINE_FOLLOWUPS.md, Rich-inline item edges). No pinned case holds the
line-feed shape, so the rule moves no pinned prediction, and a unit test holds it.

After #460 the design was swept against main at #459 (e699e27e), the last build with the item stepper, for losses nobody
had named, as one had turned up by chance (Firefox's White-Space Run Across Items). Both builds laid out 300,000
generated paragraphs a profile on a stand-in Canvas, two styled items with one of 55 strings at the edge between them,
and the kinds of difference no doc settled were recorded in Chrome 154.0.8037.98, Firefox 156.0.1 and webkit-host
(WebKit 22625.1.29.11.27): 21,403 cases, then 30,414 and 7,683 a browser to check them and 12,846 and 4,957 to check
what the docs say of them (2026-10-09 and 10, none checked in). No real usage moves: no item of the real-usage sample's
241 rich-inline draws starts with a character any of the shapes needs, or ends with one other than a combining mark,
which none needs at an item's end; none of its padded items holds a joiner or a bidi mark, and none of its pre-wrap
draws a tab or a ZWSP after a space; and the 233 of the draws that both builds' harness adapters can state get the same
lines from both, on a stand-in Canvas and on each browser's. On the first set at 24px and wider this design alone has
the browser's lines in 1,111, 1,652 and 1,604 cases and the item stepper alone in 503, 1,449 and 322. Eight shapes are
the stepper's by a rule of its own, each rare text and a named gap (ENGINE_FOLLOWUPS.md, Rich-inline item edges, has
each with its counts, what 0.0.9 did and what a port takes): each turns on a character of no width, a tab or U+3000,
most at an item's edge and beside padding or a chip. Three of them are gaps of the text walkers or the scans in one text
node too, which the stepper covered at an item's start; its other passes are gaps named before or luck. Each reopens
with real text that holds its shape.

The halt Chrome gives a pair of fullwidth marks comes with the paragraph's analysis, with no code for it in
`src/rich-inline.ts`: on the probes above the paragraph gives the lines main's halts across items give (CJK At An
Item's Edge has the counts).

Two of Blink's rules are about its text items, a span's text each, which the paragraph's items stand for, and
preparation gives the walker each as a list per segment (`ParagraphSegmentData`). Both were found in layouts that main
had right and the paragraph first had wrong (Chrome 154.0.8037.98, 2026-10-06; ENGINE_FOLLOWUPS.md, Rich-inline item
edges, has the shapes and what each leaves).
- The room a line leaves for a hyphen where it returns from a soft hyphen whose hyphen doesn't fit (Engine Facts,
  Chrome, has the retry). `BreakText` retries one item against the width less that item's own hyphen
  (`line_breaker.cc:1705-1719`, Chromium 153), and where no break in the item leaves the room, `HandleOverflow` goes
  back to the latest break before the item that fits, with none (`:4105-4112`). So a break inside an item leaves room
  for that item's hyphen, and the break before an item's first segment leaves none (`hyphenRooms`). The paragraph first
  left the first text item's hyphen at every break. Of 1,015 Chrome layouts with a one-letter syllable before the soft
  hyphen, that form passes 903, main 914 and the rule 954: main's walk left the next item's hyphen at the break before
  it, and kept an overflowing hyphen in 40 layouts where Chrome ends the line at that break. One pinned prediction
  moved, a pass both ways: `word `, an item of a soft hyphen and `more text here` at 40px in 16px Arial, whose first
  line was `word` and a hyphen, 44.45px wide, and is now Chrome's 34.68px. Two more probes, of 31,603 layouts, read the
  same way, and recorded the premise the rule takes: a break inside an earlier item than the soft hyphen's leaves room
  for that item's hyphen, where Blink asks only that the line fit (`:4138-4158`). It shows in one font size wherever the
  soft hyphen starts the next item or is an item alone, in 29 layouts a line too many, where main had the right count
  with a wrong break (ENGINE_FOLLOWUPS.md has the shapes and counts). The walker keeps one latest break with room;
  Blink's return is to the latest break inside the soft hyphen's item with room, and else to the latest before that item
  that fits. It reopens with a Chrome that reserves the hyphen across items.
- A closing fullwidth mark halted at its item's end, where the item's text fits its line only so, stays halted where the
  line goes on (`itemEndHalts`; CJK At An Item's Edge). The item stepper had this from an item's own text ending at the
  mark, and the paragraph's walker halts a mark at a line's end only, so it keeps the halt of a mark that ends an item
  without `extraWidth`, takes it out of the line's width where the line goes on, and gives the fragment the halted
  width. That is the halt of a line's first layout, made where a break comes right after the mark, and the halt of
  Blink's second layout of a line with no break to return to, which has a break after every grapheme, so before a period
  or a no-break space too. Of 1,096 Chrome layouts Chrome passes all with the rule, 1,020 without it and 1,088 on main.
  Of 32,775 more, 28,211 are 24px and wider: Chrome passes 27,646 of those, main 27,402, and the rule with the first
  layout's halts only 27,129. What main passes there and the rule fails is 94 layouts of a padded item's mark. Blink
  fits a span's text before the span's end edge and keeps the halt where the text doesn't fit there, and `extraWidth`
  doesn't split that edge off, so the rule leaves padded items out: it fails those 94, where what follows the mark is
  narrower than the halt less the edge, and passes 124 that main fails, where main kept a mark halted that Chrome leaves
  whole (ENGINE_FOLLOWUPS.md). No pinned case held such a mark before a letter or a period; two templates of the rich
  set's `item-edges/closing-mark` family now do, 23 cases a browser. #425's unit test holds main's expectations again. A
  paragraph with such a mark is laid out by the full walker.

Chrome submits more units to `measureText` for rich cases, by a few more calls: 47,935 against 46,382 over the rich set
(+3.3%, in 5,439 calls against 5,413), which with the rich cases of the other sets is 0.15% more units and 0.01% more
calls over every set together (against main at #459, 2026-10-07). Of the sets `equal` prints, the smoke set grows most,
2,625 units against 2,242, all of it in one of its three rich cases, `smoke/mixed-font-sizes` (443 units against 60). A
collapsed space at an item's edge is measured with its item, where main measured it alone, so more paragraphs meet the
Chromium profile's probe of how a font kerns a space with its neighbours, two strings of printable ASCII, which a page
pays once for a font. Firefox's calls and units stay within 0.2% in every set and webkit-host's within 0.3%.

Speed, against main at #459 in the foreground bench, with the chat documents it has since #456 (this design as built,
a867ce82, against e699e27e; Chrome 154.0.8037.98, Firefox 156.0.1 and installed Safari 27.0 on macOS 27.0, 2026-10-09;
#460's description has every row). Every row was timed in two runs of three sessions a browser, and the `rich` rows and
the `seen` and `new` rows in two more runs of five each: a figure of this design as built against main at #459, here and
wherever a section points at this timing, is over those 16 sessions for an entry of those three rows and over the six
for any other, and the bench calls an entry slower or faster only where every session reads it outside its band
(harness/README.md, Bench). Six documents of CJK rich paragraphs, which the bench doesn't hold, were timed the same way
from a copy of it that isn't checked in, in two runs of five sessions a browser: the bench's CJK messages as paragraphs
of one item each, in the shapes of the chat demo's paragraphs, 86% of them one item (the mixed CJK page, below), and in
the shapes of its styled paragraphs, every one several items; and each of the three cut down to text whose every width
is a whole number of pixels (whole widths, below, against the ordinary widths of the three as they are). Counting a
prepared paragraph's lines takes 0.20 of main's time on the stress items in Chrome, 0.24 in Safari and 0.39 in Firefox,
0.43-0.53 on the chat demo's styled paragraphs and 0.74-0.79 on its mix, each called. Walking lines reads 4-31% faster
and streaming them, which is stepping through them one line a call (`layoutNextRichInlineLineRange()`), 6-30% faster,
under main in every session on each of the three documents in each browser (above). The entries for new text and for
text prepared again time `prepareRichInline()` with one count of the paragraph's lines after it, so the count's gain is
in each of their figures. What `prepareRichInline()` reads follows the work that changed it (below): no entry of the
bench's `rich` row is called slower over the 16 sessions, and what reads slower in ten or more of them is the stress
items prepared again in Safari, their new text in all three browsers, and the styled chat paragraphs prepared again in
Chrome, where main's own copies run at two speeds. The design first read 25-38% slower in Safari on stress items
prepared again and 10-16% on new ones, called in both of two runs against main at #453 (three and ten sessions,
2026-10-06); that loss was JavaScriptCore's. The engines' shells on a stand-in Canvas said where preparation's cost went
then (2026-10-05, on the design before main's #435 to #446 and before the removals below; hypotheses): with the code
warm the paragraph cost V8 what the item stepper's preparation did, SpiderMonkey 8% less and JavaScriptCore 37% more,
since every segment's text was a slice of the paragraph's joined text, which JavaScriptCore resolves and hashes where an
item's own text was a string at hand, a paragraph's white space collapsed over the whole text, and two passes read every
unit (`alignToSource()`, `markItemStarts()`). On a fresh page the shells read 14-28% slower over the first 14,000 units,
as the engines reach their compiled speed later on the paragraph's larger function. What is left of that cost in Safari
(below) reopens with a way to prepare a paragraph that doesn't slice its joined text. What plain text's rows read
against main is at this section's end. What bears on them is under Keeping Work Bounded: the walker's rules for a
paragraph are tests on a text's path (Work Done Only Where A Rule Applies), and five forms cost an engine more than
their work (JavaScript Engines: V8's inlining budgets and the mark context, how a width is stored, a list made where it
is filled, a flag parameter; Dead Ends, Fitting, Cuts And Fast Paths, the font's two widths).

Preparation then lost work that changes no result. With each removal below, 200,000 random paragraphs, the bench's
stress paragraphs and its styled chat paragraphs give the same lines, stats, ranges, materialized lines, streams and
`measureText` calls in the Blink, WebKit and Gecko profiles on the stand-in Canvas, and the same handle unless the
removal says otherwise (2026-10-07).
- **An item's own string.** An item that is one segment holding all of its text, as a styled word between two spaces,
  is measured by the item's own string in place of the equal slice of the paragraph's text: a font's widths are kept by
  text, and the string the caller holds keeps the hash an engine gave it when the item was first prepared, where the
  slice is a new string to hash at every preparation. That is 2,731 of the 2,783 text items in the kept paragraphs the
  bench's stress document prepares again, and 2,453 of the 8,390 in the chat demo's 2,432 paragraphs of several items,
  which the styled chat document reads from (2,732 and 2,673 in the Gecko profile); an item of several words is still
  measured by slices. The hash is on the string object, so the gain is for an app that hands the same strings in again,
  as the bench's `rich-seen` does with its kept items. With new strings for every preparation an item pays one more
  comparison of its text with its segment's, and its string is hashed as the slice was: the engines' shells then read
  the rule level or slightly slower in V8 and still a little faster in SpiderMonkey and JavaScriptCore (2026-10-06 and
  07, on a stand-in Canvas; hypotheses, not timed in a browser).
- **Item font lists where a paragraph reads them.** The lists of each text item's hyphen width, tab stop advance and
  least tab advance, and the three per segment made from them where two items differ in one, are made only for a
  paragraph whose text holds a soft hyphen or, under pre-wrap, a tab: a walk reads them, and the handle's own three, at
  a soft-hyphen segment, under soft-hyphen contexts and at a tab segment, and nowhere else
  (`walkPreparedComplexLines()`, `getItemTabAdvance()`). Any other paragraph's handle holds none and its own three are
  0, where they were the first text item's: the one difference in a handle, which a later reader of those fields has to
  know (`ParagraphSegmentData`). No paragraph of the bench's three rich documents reads them, where each had three
  lists of an entry per item, and three more of an entry per segment in the 1,550 of the 2,432 styled chat paragraphs
  that hold a code span, whose font is another family and size (1,988 on the stand-in Canvas, where a bold face
  differs too).
- **The font's space width.** A font's space, which the measurement of every text and of every rich item asks for,
  and which an item of only white space is, is kept on the font's measurement from the first ask, beside its Map of
  widths (`getSpaceWidth()`): one Map lookup less for every text and every rich item. It is the space half of the
  font's two widths, which were taken out together (Dead Ends, Fitting, Cuts And Fast Paths). A space that is a whole
  number of pixels in one font and a fraction in another on one page, the mix under which JavaScriptCore's shell kept
  failing one type check of `measureAnalysis()` with the hyphen-minus half, was tried only in that shell, where none of
  6 processes kept failing it (2026-10-06, a hypothesis); the bench has no such page: where it has a whole space, as 5px
  in 20px Songti SC, that font is alone on its page.
- **Measuring in place.** `measureAnalysis()` measures a range of an analysis's segments, and for an item of a
  paragraph it adds their widths, flags and advances to the paragraph's own lists (`ParagraphLists`). Before, each text
  item got a copy of its part of the paragraph's analysis (an object and three lists), a handle whose widths, advances
  and flag bytes were lists of its own, and a loop that copied those into the paragraph's lists. Each item still gets a
  handle, which holds the paragraph's three lists and, from the item's first segment, what only some segments have. What
  measurement asks of a whole text, as whether it may hold emoji, a space to kern with or a mark to halt, it asks of the
  item's text as before: its one segment's text, or one slice of the paragraph's. Per 42,000 units of Latin text shaped
  as the stress document's that is 29,386 fewer array literals, 5,855 fewer typed arrays and 27,845 fewer pushes
  (counted in V8's shell under the WebKit profile, at an earlier commit of this change, 544c0ce6). The handle is the
  same in every field. That commit's loop pushed each segment onto the lists; as built it stores each at its index and
  pushes nothing, which is what lets `prepareRichInline()` make a paragraph's lists as plain empty ones. A text's own
  lists are made inside `measureAnalysis()`, where they are filled: a first form that had every caller make them cost
  Chrome 5-11% of preparing long texts and Firefox 4% and 12% of counting and walking CJK lines (Keeping Work Bounded,
  JavaScript Engines, under A list made where it is filled, has both).

What the first three measured, in the foreground bench's `rich` rows (Chrome 154.0.8037.98, Firefox 156.0.1 and
installed Safari 27.0 on macOS 27.0, 2026-10-07; each a build against the build without the removal; the chat documents
as the bench had them before #456, their kept paragraphs read after the new batches and other paragraphs than the bench
has kept since; each removal alone is under the row's 5% floor, so each session's median is read for its sign). The
three together, over 15 sessions in three runs: the stress document prepared again reads 8.0% faster in Safari (77.4 to
70.9 µs per 1,000 units), 5.2% in Firefox and 4.1% in Chrome, faster in every session of each, and the bench called it
in Safari in two of the runs and in Firefox in one; the styled chat paragraphs prepared again read 3.5% faster in Safari
(55.2 to 53.2) and the chat mix 2.0% (41.5 to 40.7), in every session, and both within 1.3% in Firefox, whose styled
paragraphs read 1.3% faster in 14 of the 15; in Chrome a copy of the library runs a whole session of either entry at a
slower speed, 11% and 8% apart, whichever build it holds (base's copy in 4 and 1 of the 15 sessions, the candidate's in
6 and 4, the second copy of the base in 2 and 1, two copies at once in 2 sessions of the mix; Evaluation Traps, Timing),
and in the sessions where none did, 5 of the mix and 9 of the styled paragraphs, the candidate read level with base's
copy on the mix and 0.8% under it on the styled paragraphs, in 8 of the 9; new text on the stress document, and
counting, walking and streaming lines on all three, stay within noise. Of new text on the two chat documents these runs
say nothing, in either direction: their batches held 1,000 units, where a build read against itself moved by up to 49% a
session in Chrome, 22% in Firefox and 39% in Safari, and one run of three called it slower (#456; Evaluation Traps,
Timing). Each alone, over 7 or 8 sessions: the own string takes 3.5% off Safari's stress document against base's copy
and 1.9% against the second copy of the base, under both in every session (base's copy ran 3 to 5% over its twin in
three of the eight), 2.5% and 1.9% off Firefox's and 0.8% and 1.1% off Chrome's, and nothing the chat documents show;
the lists take 3.7%, 1.7% and 2.1% off it, and are the one removal the chat documents show, 2.5% off Safari's styled
chat paragraphs and 1.9% off its chat mix, in every session; the space width takes 1.6%, 2.0% and 0.7% off it, in 6, 7
and 6 of 7 sessions, nothing off the chat documents, and is 8 lines for that. In a run of every row with the three
together, three sessions, no plain row is called: Firefox counts, walks and streams the bench's CJK lines within 0.6%,
where the two widths together had cost 4% and 11%, a loss the space half alone doesn't bring back. No rich entry is
called slower in any run. Four of the 45 read slower in ten or more of the 15 sessions of the three together, and none
is traced to a change: Chrome's new chat text, which these runs can't read (above); Chrome's line count of the chat mix,
0.6% in 11, and Firefox's walk of the stress document, 0.4% in 10, in both of which the second copy of the base read
over the first in 10 sessions too; and Safari's stream over the styled chat paragraphs, 0.3% in 12 and over the second
copy of the base in 11, 0.01 µs per 1,000 units, in a row that runs none of the changed code, over handles that hold no
such lists, and which no removal alone shows (the lists alone: over base's copy in 5 of 8 sessions, over the second copy
in 2). Chrome's line count of the stress document reads 1.6% over base's copy under the space width alone, in 7 of 7
sessions, over handles that are the same in both builds, and 0.3% over the second copy of the base, under it in 3 of the
7; the three together read it 0.3% slower in 8 of 15.

What measuring in place measured, against the build without it, in the foreground bench (the same browsers,
2026-10-07; 13 sessions of the `rich` rows in three runs and three sessions of every other row a browser; the chat
documents as the bench had them before #456, with batches of 1,000 units and kept paragraphs read after the batches,
which are other paragraphs than the bench has kept since; both builds also stored each width through a one-cell
`Float64Array`, so that every width is a double, a change that was measured and left out (Keeping Work Bounded,
JavaScript Engines, Every width stored as a double)). The chat documents first. The styled chat paragraphs prepared
again read 7.8% faster in Safari (53.2 to 49.0 µs per 1,000 units), 5.6% in Chrome and 3.8% in Firefox, in every session
of each, and the bench called Safari's in all three runs; the chat mix reads 1.9% faster in Safari (40.6 to 39.9), in 12
of 13 sessions, and about 1% in Firefox, in 11 of 13 sessions, and in Chrome, in 9 of 13, on an entry where one copy of
three runs 12% slower for a session. The stress document prepared again reads 5.3% faster in Safari (68.8 to 64.6), 5.8%
in Chrome and 2.8% in Firefox, in every session. New text stays within noise on the stress document, Safari's at 3.9%
faster in 9 of 13 sessions where the control copy read 2.3% faster in 9, and can't be read on the chat documents from
these runs, whose batches hold 1,000 units (Evaluation Traps, Timing); counting, walking and streaming lines read within
1.3%, but for Firefox's count of the chat mix, an entry whose three copies run at three speeds in most sessions (about
1.3, 1.4 and 1.6-1.7 µs per 1,000 units, a different copy at each), which the run of every row called 19.1% faster.
Plain text: Chrome reads `seen: cjk seen` 3.0% slower, called (104.5 to 107.8 µs per 1,000 units; +2.7%, +3.0% and
+3.3%), as the first form did (+2.8%), so where the lists are made isn't it, and main against itself reads the row
within 0.7% in six sessions. Partial forms of the change read it 2.1% to 7.9% slower in background Chrome. V8's shell
read the first form 3.1% slower in one run, with eight libraries on its page, and 0.4% slower in another, with six,
where the form with a text's lists made inside read level (d8 15.4.80, 8 and 7 passes; hypotheses); the bench's page
holds three. The cause is a call and not the change's work: its 7 more bytes of bytecode in two closures took
`getMarkContext()` out of what V8 inlines into `measureAnalysis()` on a page of CJK text, and as built the loop asks for
a mark context only where a segment's flags allow one (Keeping Work Bounded, JavaScript Engines, under V8's inlining
budgets and the mark context). Firefox's `new: arabic new` was called once (+10.3%, +6.8% and +8.6%), in a row where
each round gives the three copies three different batches of text; eight more sessions of the row read it 1.4% faster, 3
of 8 slower, and the eleven together 1.4% slower, 6 of 11, so it isn't the change's. No other row is called slower.
Without that cell, the form with a text's lists made inside reads Firefox's CJK lines level, counted 0.1% faster, walked
0.3% faster and streamed 0.5% slower over eight sessions, with no row called in three sessions of every row in Firefox,
and the rich rows gain what they gain with it (Safari's styled chat paragraphs 8.2% faster and its stress document 6.7%,
both called, five sessions). So in Firefox, the browser that cell was for, measuring in place doesn't rest on it; its
first form did, and failed three of Chrome's rows as well (JavaScript Engines, A list made where it is filled). Chrome's
and Safari's plain rows weren't timed for this change without the cell: they are read without it only in the timing of
the whole change against main (below).

As built, with the three removals, measuring in place and the line builders above, and with no width stored through that
cell, this design reads against main at #459 as follows (the timing under Speed, above; #460's description has the
tables). The chat demo's text prepared again is faster than main in Firefox, the chat mix by 8%, under main in each of
the 16 sessions and not called, and the styled chat paragraphs by 19%, called, and in Safari by 1.0% and 4.5%, under the
row's floor, the styled paragraphs under main in every session. In Chrome one copy of three runs each of those two
entries at another speed for a session (Evaluation Traps, Timing), so they are read by each copy's own cost: on the mix
this design's copy took 42.2-43.0 µs per 1,000 units, under every copy of main in every session, which took 47.1-48.4 or
52.2-54.9; on the styled paragraphs it took 59.9-64.6, between main's 57.2-62.7 and 65.4-70.7, and reads 2.6% slower
over the 16 sessions, above main in the 12 where base's copy ran at the faster speed; neither is called. Their new text,
in batches of 4,000 units, is within noise: Firefox's styled paragraphs read 9% faster, under main in every session,
Safari's 7%, in 15 of the 16, and the other four entries within 6%. The stress document prepared again reads 16% faster
in Chrome and 13% in Firefox, both called. In Safari this design's copy took 63.4-66.7 µs per 1,000 units over whole
sessions, at the upper end of main's two, which took 54.1-67.7: it reads 12% slower over the 16 sessions, above main in
15 of them, called in one run of four and not over the 16; the design first took 76-79. Its new text reads 2% slower in
Chrome and 4% in Firefox and in Safari, above main in 10, 10 and 13 of the 16 sessions and none called. Each round gives
the three copies three different batches, so the bench can neither call a difference of that size nor rule it out; batch
by batch, which is not the bench's figure, this design reads 3.8%, 6.0% and 5.0% slower there, where the second copy of
main reads 1.4%, 1.9% and 0.2%.

CJK rich text, on the six documents that aren't checked in, ten sessions a browser: counting the lines of the mixed and
styled documents is 9-48% faster in the three browsers, walking styled paragraphs 5-17% faster, and Firefox prepares
mixed and styled paragraphs again 7-29% faster. One entry is called slower, Firefox's walk of one-item paragraphs whose
every width is whole, by 6.1%, and it walks them 3.7% slower with ordinary widths, above main in each of the ten
sessions. In Safari four entries read above main in each of the ten: stepping through the mixed page 8.4% slower, called
in one run of two; styled paragraphs prepared again 7.5% slower; walking the mixed page 3.4% slower; and stepping
through styled paragraphs 2.9% slower. Firefox's two and the first of Safari's go back to the visitor that preparation
hands the walker, and Safari's second in part to what a paragraph keeps for every segment (Keeping Work Bounded,
JavaScript Engines, The walker's visitor call and A paragraph's sparse lists made whole); the last two have no cause
found.

Plain text: of the 49 plain entries a browser, 147 in all, none is called slower and twelve are called faster. Text seen
before prepares 2-5% faster where it is called, Latin, Arabic and mixed in Chrome and in Firefox and Arabic in Safari.
Chrome's `seen: cjk seen` reads 1.3% slower, above main in each of the 16 sessions and called in one run of four, where
an earlier build read it 3.5% slower over six sessions and 4.0% over ten more, called, for a call V8 didn't inline
(6bc6a99f, 2026-10-07 and 08; Keeping Work Bounded, JavaScript Engines, V8's inlining budgets and the mark context, has
the call and what the 1.3% is). Safari reads the same entry 1.3% slower, above main in 15 of the 16 and not called.
Firefox streams the bench's plain lines 4-6% faster, called, and counts and walks its CJK lines within 0.1%. The other
two called entries are Chrome's `prepare()` and `layout()` of letter-spaced CJK, 4.8% and 5.9% faster; the worst-case
rows that run the full walker are under Keeping Work Bounded, Work Done Only Where A Rule Applies. Nine other worst-case
entries read above main in each of their six sessions, by 0.3% to 2.1%, and are called by no run: in Firefox `prepare()`
of letter-spaced CJK, of invisible tails and of long breakable runs and the walk of pre-wrap chunks, and in Safari
`layout()` of the soft hyphens and `prepare()` of the soft hyphens, invisible tails, pre-wrap chunks and emoji, the last
four of the size a store by index costs a text there; no cause was looked for in the others, a call on judgement: each
is at or under its row's 2% floor but the long breakable runs' 2.1%, none is called, and the next change to the code
moves differences of that size again (Part 1, Engineering, JIT tuning).

#### Joined Text

Chrome's and Firefox's items break by the joined text, a font change ending only Gecko's shaped run (Firefox 155 wrapped
same-font spans as one text node, 2026-09-14); WebKit's and the WebKit profile's break by each box's own text, with the
previous box's last two characters as context (`getWebKitParagraphBreaks()` in `src/analysis.ts`;
`TextUtil.cpp:374-396`). Splitting a word changes its segmentation (Thai `ความสวยง` is `ความ/สวย/ง` alone, `ความ/สวยงาม`
joined), and each engine's rules apply across items: Firefox, whose lines don't start with small kana, keeps `待って`
together across `ちょっと待` and `ってください`, while in Safari 26.5.2 the joined analysis lost Thai and Lao words split across
items (2026-09-12; unchecked on 27). The analysis marks no break at some item starts (before NEL, VT or NUL, or a mark
after a ZWSP), and after a break an item whose first word runs past one moves down: Safari lays out items `zz` and
` ab\u0085cd` at 42 and 46px in 16px Arial as `zz` / `ab\u0085` / `cd` (webkit-host, 2026-09-26).

A matching count can hide wrong breaks: an early prototype of the joined-text rule lost 40 Firefox Myanmar results, and
the losses came from widths, not segmentation. The second item starts with U+102C, a spacing vowel sign that graphemes
split from its consonant and browsers shape with it (16px Myanmar Sangam MN: `ဘာသ` 41.02px, `ာသည်` 50.78px, 82.03px
joined; ENGINE_FOLLOWUPS.md), and breaking at every item boundary had matched those counts only by breaking where
Firefox never does (Firefox 155, 2026-09-14; old suite, `tests/wrapping`, removed 2026-09-25).

Under keep-all, which `prepareRichInline()` takes for the whole paragraph (`{ wordBreak }`), the paragraph's analysis
takes it, so Blink's and Gecko's keep-all scans decide the breaks across items as in one text. WebKit's
check at a box boundary reads no prior context under keep-all (`TextUtil::findNextBreakablePosition`,
`TextUtil.cpp:403-407`; `BreakablePositions::next`, `BreakablePositions.h:288-300`): a box starts at a break only where
it starts with a breakable space or ZWSP. So where punctuation ends a box, after which Safari's keep-all breaks inside
one 16-bit text, it doesn't break at the boundary: in 16px Hiragino Sans, spans `日本語の`, `テキストです。`, `次の文`,
`は続きます` at 198px give `日本語のテキストです。次` / `の文は続きます` in Safari, their text in one node `日本語のテキストです。` /
`次の文は続きます`, which Chrome and Firefox give for the spans too (webkit-host, Chrome 154, Firefox 156.0.1,
2026-09-29). An atomic item breaks on both sides under keep-all too, in all three engines (`src/rich-inline.ts` cites
them). One setting per paragraph is how a chat message sets it; a setting per item is an open question (TODO.md), since
each engine reads a boundary's rule from the spans beside it, WebKit from the next one's style.

#### Continuing The Line

This is how rich inline was laid out from #369 (2026-09-27) until the one-paragraph design replaced it (Rich Inline As
One Paragraph), kept for what it measured: the rules it found hold in the paragraph's analysis too. From #369 an
item's walk continued the line instead of starting one, as a browser lays out one paragraph's text across its spans.
Before, each item was walked as if it began a line and then walked again to an earlier end in four cases (a split word,
a joined break after the walk's end, an overflowing hyphen, a continuing run that didn't fit), which got some cases
right only by luck. From #369 the full walker took what the line held before the item (whether it had content, its
latest break, which a stepper over the items kept across them, and whether a return from an unfit soft hyphen could end
the line there) and the joined text's breaks inside the item's segments, on a copy of the item's handle whose flags
followed the joined text. There a ZWSP or soft hyphen took the kind of the last of the joined text's segments inside
it, as the text around it decides it; taking the kind of the one that starts where the item's does fitted a hyphen
Firefox doesn't draw in 14 probe cases. An item that started a line on a fast-path handle still took the simple
stepper (Keeping Work Bounded, The Walkers' Shapes). On a stand-in fuzz of case
texts split into same-font items, rich lines then matched the plain-text walker's at 607 to 981 more widths per profile,
and lost only 117 in the WebKit profile, which Safari lays out as rich inline now does (webkit-host passes all 303 probe
cases of those shapes), and 13 in the Gecko profile, where an item's own white-space processing removes a newline the
joined text keeps; a 4,858-case probe fixed 370 Chrome, 511 Firefox and 1,308 webkit-host cases and lost 11, 4 and 11
(10e75bba, #369, attributes them).

A ZWSP that started an item kept the line it holds at a text's start, and a zero-width break that only the joined text
gives there held none: taking every item start that continues a run as inside a chunk lost 76 webkit-host, 3 Chrome and
2 Firefox probe cases. In the paragraph a ZWSP after a wrap is inside its chunk, as in a text, so a line start consumes
it, where the browsers give it a line of its own when the text after it doesn't fit (ENGINE_FOLLOWUPS.md, Rich-inline
item edges). A fragment's text was its item's own, with the hyphen at its end taken from the copy: built wholly from
the copy, it showed a soft hyphen that Gecko's joined scan makes text before a bidi control (#373), which the
paragraph's analysis avoids by starting a segment where an item starts with one. In the Gecko profile a joined window
that starts after collapsible white space is analyzed after a space, which Gecko's scan reads as context, so it breaks
after a bidi control that follows the space, and after content where content comes before that space, without which a
soft hyphen after the space took a hyphen the paragraph's text doesn't (29 Firefox probe cases).

Only the Chromium profile removes a collapsible run with a newline next to a ZWSP in a neighbouring item, as Blink
transforms segment breaks in the text of the whole inline formatting context and Gecko in each text frame's own
(`transformsSegmentBreaksAcrossItems` cites both); taking the paragraph's transformation in the Gecko profile lost 30
Firefox cases of a 43,462-case probe and fixed 7.

What that design cost in structure (#370, 2026-09-28): rich inline analyzed each item on its own, then patched it
toward the text the items join (the joined windows and the passes after the item loop in `src/rich-inline.ts`, the
walker's mode for one item's line in `src/line-break.ts`, and a second handle per item with its caches kept twice,
about 330 lines with comments), because fragment cursors indexed `prepareWithSegments(item.text)`. Written from scratch
it is one analysis of the paragraph cut at item boundaries, as the rebuild indexes a paragraph's content
(`rebuild/src/content.ts` on branch `rebuild-20260916`), with a new cursor contract and letter spacing and `extraWidth`
per segment in the walker: Rich Inline As One Paragraph.

#### Items Of Soft Hyphens And White Space

An item holding only soft hyphens and collapsible white space is no line content, since a line start consumes it, but
it takes part in the paragraph's runs and breaks as its text does in one text node: since the one-paragraph design by
construction, as its text is the paragraph's. From #369 until then the item stepper had rules of its own for it, with
a profile field, `spaceBeforeSoftHyphenHangs`, for where the collapsed space before such an item hangs in each engine,
which moved only line widths; the paragraph lays that space out as the text walkers lay it out in one text, and the
field is gone (Rich Inline As One Paragraph has the widths that moved). The harness's `rich/continued` families pin the
lines. These results shaped the stepper's rules. After content the item keeps the collapsed space before it: ending the
line before the item lost 288 Firefox cases of a 43,462-case probe, as Firefox keeps the space and the soft hyphen on
the line. Where a line ends after it, the browsers break at that space and move the soft hyphen on, so the space hangs,
but each engine keeps the soft hyphen on the line in other places, so the profiles name three behaviours: hanging the
space also where Chrome and Safari end the line at the soft hyphen with its hyphen lost 118 Chrome and 120 webkit-host
line widths of a 32,830-case probe, and Safari's rule, keeping it before white space after the soft hyphen, fixed 335
webkit-host widths and lost 136 in the WebKit profile, and fixed 73 Chrome widths and lost 159 in the Chromium profile.

White space between such an item's soft hyphens follows a soft hyphen, not the space before the item, so Chrome and
Safari give it room after content and the item is walked there (Gecko collapses it into the run before: Firefox's
White-Space Run Across Items). Letting an item that starts with a hard break end the line wherever it falls, as a hard
break in one text does, lost 159 webkit-host cases of a 28,435-case probe, as Safari gives the separator a line of its
own after white space that hangs.

A line ends before an item whose reserved width doesn't fit, except an item a line start consumes, whose soft hyphen
follows the line's content: that fixed 415 Firefox cases of an 80,512-case probe and lost none, where letting the walk
end the line for every item that reserves nothing fixed 487 more Firefox cases but lost 245 more, and 11 Chrome and 58
webkit-host ones.

In the Gecko profile a soft hyphen after collapsible white space is a zero-width break, which Firefox drops. The item
stepper's line start consumed it wherever it reached it and told it from a ZWSP that holds the line by the segment's
first code unit: normalizing again from the next segment, or taking an item's start as a text's start only at its first
segment, lost a ZWSP's line, and giving `normalizePreparedLineStart()`, which the plain walkers share, the chunk's start
as a parameter read Firefox's `lines` mixed stream 2.2-2.4% slower. The paragraph's lines start as a text's do.

#### Firefox's White-Space Run Across Items

Firefox drops soft hyphens and bidi controls before it collapses white space, collapses white space with such characters
among it as one run, and carries the run from one text frame to the next (`TransformText`,
`nsTextFrameUtils.cpp:286-386`, with `INCOMING_WHITESPACE`); one of those characters that follows no white space in its
frame ends the run, and so does an atomic inline (`BuildTextRunsScanner::ScanFrame`). Bidi resolution splits text frames
where the embedding level changes, and a text run doesn't go on across the split (`ContinueTextRunAcrossFrames`,
`nsTextFrame.cpp:2023-2030`), so a dropped character at another level than the white space before it ends the run too.
Since #369 the Gecko profile follows that run across items: the scan's text transform takes a paragraph's items as
text frames (`transformText()` in `src/gecko-line-breaks.ts`, whose comment has the rule and Firefox's widths). It
resolves no levels and takes each dropped character at the level of the white space before it. A soft hyphen, an
embedding or override control and an isolate initiator always have it. A direction mark has it unless it goes against
the direction of its paragraph, embedding or isolate after white space that follows text of that direction, follows a
mark of the other direction, or has an opening or closing control between it and the white space; the PDI that closes an
isolate has it where the white space inside the isolate is at the level of the text around it (ENGINE_FOLLOWUPS.md,
Rich-inline item edges, has the sources and the shapes probed). From #369 to #403 it read the paragraph's levels from a
port of Firefox's (Bidi Levels), made on first need since #371, which took every paragraph as left-to-right: the port
was right in left-to-right paragraphs, and in right-to-left ones it was wrong where the run without levels is right, as
a mirror image. On six shapes with U+200F or U+061C after white space that follows Latin text, at 31 widths from 60 to
180px, the port passed 186 of 186 left-to-right cases and 173 right-to-left ones, and the run without levels passes 173
and 186; on five shapes with a mark or a PDI inside an embedding or isolate the port passed all 155 cases in each
direction, and the run without levels passes 142 (Firefox 156.0.1, 2026-10-01). In the harness's rich set, whose level
templates are left-to-right paragraphs, the port decided 6 Firefox cases, each a right-to-left mark with a soft hyphen
after white space at an item's end. White space and soft hyphens after an item's leading white space are part of that
run, and white space after a soft hyphen that starts an item starts a run of its own: taking every item of soft hyphens
and white space as Chrome and Safari do lost 421 Firefox cases of a 28,435-case probe and fixed 30. The run fixed 6,220
Firefox cases of an 80,512-case probe and lost 220, most of which Firefox lays out otherwise as spans than as one node,
and moved no Chrome or webkit-host case; since #372 (2026-09-28) an item of only white space and bidi controls between
words takes one space, as in Firefox. What it still gets wrong, such as two spaces around a control at another level,
which one gap in one item's font can't hold, is in ENGINE_FOLLOWUPS.md, Rich-inline item edges.

A character the text run drops that starts an item right after an item's white space ends the run, so a space after it
is a second space, and the scan gives the two one break, after the second. Firefox still ends a line between them where
a character it keeps follows the second space inside the same text frame: the frame's piece on that line, its controls
and the space, comes to no width, or on a line with no break yet the controls alone, and such a piece fits wherever it
starts; where the space ends its frame the piece keeps its width, and a line with an earlier break goes back to it
(ENGINE_FOLLOWUPS.md, Rich-inline item edges, has Firefox's sources and the widths). A frame ends with its item, and
inside an item where the bidi level changes (Engine Facts, Firefox, Text frames), so which of the two Firefox does after
a bidi control turns on levels the profile doesn't resolve. The Gecko analysis gives such a control no break, as the
scan gives none before a space. The item stepper ended the line at the white space before the control, hung, at every
such control, and the one-paragraph design lost that line end without naming it: since #460 items `aa see `,
`\u200E this word` in 16px Arial take a line more than Firefox at 49-52px, and `see `, `\u200E this word` report a first
line of 30.25px in a 26px box, a space wider than Firefox's and than 0.0.9's. It is rare text: no rich-inline draw of
the real-usage sample holds a bidi control; four rich-set templates hold the shape. Putting the break back where a
character the text run keeps follows the space in the space's own item, which takes an item for a frame, was built and
not landed, as it trades (#463). On 44,281 layouts of 434 paragraphs built to hold the shape, it has 732 right that main
at #461 has wrong and 344 wrong that main has right: 284 at a level change after the space, 40 at a padded item and 20
at a CR. On the 19,977 of those layouts that put U+200E, U+202A, U+2066 or U+200F before Latin text in a left-to-right
paragraph wherever the line has an earlier break, it is 160 and none (Firefox 156.0.1, 2026-10-09, eight probes that
aren't checked in). Given only in text with no right-to-left character, where Firefox resolves no levels in a
left-to-right paragraph, the break has 434 right and 60 wrong, at the padded items and the CRs; that was measured once
and nobody else has checked it. ENGINE_FOLLOWUPS.md has the other forms measured. Each is a trade or a change to the
walkers, so it waits for the maintainer (Part 1, Merge Bars And Landing). It reopens with a `direction` option
(TODO.md), under which the profile can tell where a frame ends, or with a report of real text that has a bidi control at
the start of a styled run.

#### Atomic Items' Own White Space

Since #369 an atomic item's own leading or trailing white space makes no gap: every engine lays an inline-block's text
out as a paragraph of its own, whose lines drop white space at their edges, and places the box in the outer line as one
object (Blink's, WebKit's and Gecko's sources are cited at the rule in `prepareRichInline()`). Items `see`, atomic
` chip`, `this` in 16px Arial at 60px take a 55.15px first line in all three browsers, where the gap made it 59.60px.
On three probes that fixed 1,845 Chrome, 818 Firefox and 1,884 webkit-host cases and lost 76, 81 and 101, 241 of the
258 losses holding a soft hyphen or bidi control beside the atomic item's white space, where the gap had made up for
white space Pretext gets wrong there. In Firefox an atomic item's leading white space also collapses into an open run.
An atomic item of only white space is still an object, as wide as its `extraWidth`, with a break on both sides: the
three browsers lay out `ab`, a chip of two spaces with 5px of padding and `cd` in 16px Arial at 40px as `ab` and the
chip, then `cd`, in normal white space and in pre-wrap (2026-10-01, a 180-case probe per browser). Until the
one-paragraph design such an item was a collapsed space.

#### CJK At An Item's Edge

What Chrome's `text-spacing-trim` does with fullwidth punctuation at a span's edge, in Chrome 154.0.8037.57 on macOS
27.0 at DPR 2, in 16px Hiragino Sans and PingFang SC (2026-09-30 to 10-04), which rich inline follows since #425: with
code of its own while it walked item by item, and since the one-paragraph design through the paragraph's analysis,
which reads the text on both sides of an item's edge (Rich Inline As One Paragraph). A halt is the half an em Chrome
takes off a fullwidth mark (`src/han-kerning.ts`). Firefox and webkit-host halt no mark.
- Chrome halts a pair of fullwidth marks that a span edge splits as in one text node, whatever the two spans' weights,
  sizes or families and with padding between them, each mark by the font of its own span, since
  `HanKerning::AppendFontFeatures` reads the paragraph's text on both sides of each shaped run
  (`han_kerning.cc:262-320`, Chromium 153): `文字」` and a span `。文字` are 88px wide, where the two measured apart
  take 96px, and a 20px `「引用」` before a 16px `。` halts `」` by 10px. Measured apart, `これは`, a bold `「引用」` and
  `。と言った` wrapped otherwise than Chrome at 68 of 141 widths from 60 to 200px.
- A closing mark that Chrome halts at a span's end, where the span fits only so, stays halted where the line goes on:
  `文字」` and a span `i` take one 43.81px line at 44-47px, where their text in one node takes two, of 40px and 3.81px. The
  item stepper did this, before #425 and with it, as an item's own text ended at the mark; the paragraph, whose walker
  halts a mark at a line's end only, keeps it by a list of the marks that end an item, but for an item with
  `extraWidth`, whose text Chrome fits before its end edge (Rich Inline As One Paragraph has the counts). Chrome halts
  the mark only where a break comes right after it (`ShapingLineBreaker::ShapeLine`, `shaping_line_breaker.cc:342-363`),
  and its scan gives none before a space, a tab or a line feed: `文字）` before a span that starts with a space, or with
  that space ending its own span, or before a span that starts with a line feed in pre-wrap, breaks before `字` at
  40-47px, as in one node, and so does `設定）` before a space and a box or a chip. A chip's own white space is no such
  space, where it starts the chip's text or is all of it, since its inline-block trims it: a break comes right after the
  mark, and `設定）` before a chip ` @a `, or before a chip of a space, fits 40-47px halted, also where the span after that
  chip starts with a space. Before #425 the item stepper had kept `文字）` halted on one line before a space, since an
  item's own text ended at the mark. A line with no break to return to is laid out again with a break after every
  grapheme (`LineBreaker::HandleOverflow`, `line_breaker.cc:4259-4264`), and then a break does come right after the
  mark: `文字」`, a span `.` and `字` are `文` / `字」.` / `字` at 28.5-31.75px, the mark halted at its span's end and
  the period after it, where the same text in one node ends that line after the halted mark, as the halt there only
  moves the line's end past the mark. A padded span's text is fitted before the span's end edge: a span `文字」` with
  4px of padding on each side before `i` keeps its mark whole from 52px, where the text fits after the start edge
  though the end edge doesn't until 56px, and wraps the `i`, and at 51.81-51.94px its mark is halted and the `i`
  stays on the line (Chrome 154.0.8037.98, 2026-10-06).

These counts are of probes recorded fresh in two document orders on 2026-10-04, each case predicted with main at #423
and with #425, and not kept. Styled Japanese and Chinese sentences at 120-600px in nine font stacks go from 5,608 to
6,199 of 6,210 in Chrome, all through the pair halt: of the 602 that fail on main, 162 have a wrong line count and 440
the right count with a wrong break, and 2 and 9 are left. Over twelve probes of 152,572 cases (those sentences and
five more sets of them; pairs of marks across span edges at 16-160px, and inside units filled grapheme by grapheme; a
closing mark before spaces, boxes and chips; U+3000 and white space at a span's end; and 12,200 seeded draws), #425
fixes 7,676 Chrome cases and loses 36 that main passes. A line count that main has wrong is right in 3,469 cases, and
one that main has right is wrong in 23: 9 of the 36, and 14 that main fails with a wrong break. No prediction moves in
Firefox or webkit-host, which halt nothing. Each of the 36 and of the 14 is another gap that main's marks, half an em
too wide, had made up for (ENGINE_FOLLOWUPS.md, Rich-inline item edges). Of the 36: 13 where a soft hyphen's hyphen no
longer fits, 12 through a U+3000 run that ends a span, 9 through U+3000 after a collapsible space, and 2 through the
padding of a chip of only white space. Of the 14: 10 through U+3000 after a collapsible space, 1 through a U+3000 run
that ends a span, 2 through a padded span's padding and 1 through a ZWSP that holds a line. A Chrome that stops
halting across spans, which the rich set's `item-edges` cases would show at a repin, reopens the first fact.

The one-paragraph design gives the pair halt the same lines without that code: of 9,768 layouts of pairs of marks
across span edges at 16-160px every prediction is the one main with #425 gives, 9,613 of them right, and of 6,348 of
the styled sentences both pass 6,337 and fail the same 11 (Chrome 154.0.8037.98, 2026-10-06, recorded fresh in two
document orders; main at #446).

Three of the six gaps counted above are closed (ENGINE_FOLLOWUPS.md, Rich-inline item edges, has the other three), each
example recorded again the same way, with the paragraph and with main at #446. A run of U+3000 that ends an item and
hangs ends its line, as Chrome and Firefox end it, whatever the next item starts with (Rich Inline As One Paragraph has
the rule), where the item stepper kept the item's width without the run and went on to the next item from there, so a
narrow next item sat on the run: `文字`, U+3000 and a span `i` pass all 25 layouts at 30-54px, 11 on main, and `あ文字`, two
U+3000, a span `「文` and `です` pass 48 of the 49 widths from 14px to 158px, 43 on main. A chip of only white space is an
object as wide as its `extraWidth`, with no gap, and the space that starts the item after it stays on the next line, as
Chrome lays out the empty inline-block (Atomic Items' Own White Space): `設定）`, a chip of a space with 4px of padding on
each side and a span ` 次` pass all 51 layouts at 30-80px, 17 on main. And since #446, on main too, a soft hyphen whose
hyphen doesn't fit after a pair an item edge splits returns to the break between two ideographs before it: `文字』` and a
span of `「引用」`, U+00AD and `ょ東京` pass all 101 layouts at 60-160px.

#### Objects Inside A Line

A box (`RichInlineBox`, `{ width }`, #387, 2026-09-30) is an object the app sizes and paints inside a line: an image, a
custom emoji, a formula, a badge. It is a type of its own, not a text item with empty text: `prepareRichInline()` drops
an empty item entirely, with no fragment and no width, which apps rely on to hide runs (canvas-word does) and the
invariants check, and the empty-text spelling floated in #201 needs a `font` and a `break` that mean nothing and an
`extraWidth` that may become padding (TODO.md). Inside, a box is an atomic item with no text and all its width
`extraWidth`, which no line hangs: U+FFFC in the paragraph's text, as Blink and Gecko take an atomic inline there
(`src/rich-inline.ts` cites them), with a break on both sides and preserved white space after it kept on its line as
after a chip, so it needs no rule of its own. Apps stood in for one with an atomic NBSP whose `extraWidth` made up the
rest of the object's width (#201), which takes the box's lines and line widths in every engine's profile
(`src/layout.test.ts`; a stand-in Canvas fuzz of 220,000 layouts found no difference, 2026-09-30), though not always its
fragment widths: white space that hangs comes out of a stand-in's text width and never out of a box
(ENGINE_FOLLOWUPS.md, Rich-inline item edges). A box of width 0 is a box, with a break on both sides, as an empty
inline-block of width 0 is. One that falls past a line's end, after a space that doesn't fit or an atomic item wider
than the line, moves to the next line in Chrome and Safari, as any atomic item does. Firefox places an empty frame there
(`CanPlaceFrame`, `nsLineLayout.cpp:1264-1269`; the profile's `emptyAtomicAlwaysFits`) without counting the break after
it as one that fits (`:1260`, `:1506-1513`), so a frame with a width that comes next, text, a span with padding or white
space in a text node of its own, sends the line back to its last break that fit, and the empty frame starts the next
line with it; it stays where the line ends without that (`setEmptyObjectFacts()` in `src/rich-inline.ts` has the cases).
`ab `, a 0px box and `cd` in 16px Arial at 20.25px are `ab` and then the box with `cd`, and with ` cd` the box stays
after `ab`. The break before the frame comes after white space, an atomic item or a soft hyphen, each read from the
text, never from a width, which letter spacing takes below nothing. A text frame that ends in a soft hyphen leaves a
break after itself whatever the hyphen's width (`HasSoftHyphenBefore`, `nsTextFrame.cpp:11432-11439`). Gecko's line
breaker leaves a break after a text run that ends in a space or a tab whatever its advance, once soft hyphens are
discarded, in however many nodes they are, and the run's last frame breaks the line there where it ends past the line's
end without its own trailing spaces (`nsLineBreaker::Reset`, `nsLineBreaker.cpp:710-719`;
`nsTextFrame.cpp:11443-11456`), so the frame then starts the next line. Under pre-wrap the space hangs, and Gecko's text
frame leaves out of its width the spaces that overflow the line, whatever follows the frame
(`nsTextFrame.cpp:11216-11229`; the profile's `hangsSpacesPerTextFrame`), so the box is inside the line, at its end, and
stays, as does a second box, a space or a node of a soft hyphen after it, while a span with padding after it starts the
next line: in the Gecko profile the line's run of hanging spaces goes on past an item that takes no room with the spaces
that overflow, where Blink's and WebKit's ends at one (`ComputeTrailingSpaceWidth`, `line_info.cc:289-415`;
`ContinuousContent::append`, `InlineContentBreaker.cpp:943-947`). The spaces that fit keep their width, so the box is at
the line's end or right after them (`ab `, a 0px box and a tab with `cd` in pre-wrap 16px Arial make a first line as
wide as the paragraph at 18-22px in Firefox 156.0.1, and 22.25px wide above that). The Gecko profile ports this for any
atomic item of width 0, a chip of only a ZWSP too. The empty frame's placement and the text frame's hang each read a
profile field of their own, named for the rule; a field costs nothing by itself (JavaScript Engines). Of 95,507 layouts
in Firefox 156.0.1 (sentences with a 0px box, or two, after every space at 120-600px in seven fonts, in normal white
space and pre-wrap and at eleven letter spacings, two-word shapes at 2-80px, Japanese, Arabic, Hebrew and keep-all
Korean), 8,599 pass that failed and 124 fail that passed, and the line count is right in 1,458 where it was wrong and
wrong in 56 where it was right. In each of the 124 Firefox has the box inside a line and Pretext's widths put it past
the line's end, and they passed only while the profile kept the box wherever it fell: 59 under letter spacing off
Firefox's 1/60px grid, 31 after a pre-wrap space that a soft hyphen follows in its item, 31 before a span with 0.004px
of padding and 3 after a synthetic bold span. The 56 are 28 of those before that padding, 14 of those after that soft
hyphen, and 14 before a chip of only a space, which had the right count with the box on the wrong line. With 56,928 more
layouts of other sentences, padded spans and soft-hyphen items, 8,175 lines changed their width in layouts that pass
before and after: 7,898 are within 0.1px of Firefox's width, where 168 were, and none was that isn't now. Those counts
are from before the white space was read from the text. Reading it there moved 9,979 further layouts so: of 7,624 of a
0px box after a chip, two letters or a sentence in 16px Arial, with a collapsed space at 0 to −6px letter spacing, soft
hyphens among the white space, a pre-wrap tab, or a last item of soft hyphens and white space, 394 pass that failed and
none fails that passed; of 858 random item sequences with tabs, soft hyphens or such spacing that it moves, 226 pass
that failed and 53 fail that passed, each a tab under negative letter spacing, where Firefox's tab stops count the
spacing and the profile's didn't yet; and 1,497 it doesn't move on a stand-in Canvas don't move in Firefox. Reading the
soft hyphen before the box from the text too, and the white space through any number of items of soft hyphens, moved
more: of 556 layouts of those shapes at 0, 2, −2, −3 and −6px letter spacing, 95 pass that failed and 10 fail that
passed; of 23,972 random item sequences it moves 85 on a stand-in Canvas, of which 39 pass that failed and 9 fail that
passed in Firefox, and 600 of the others don't move there. The 19 are under negative letter spacing, in layouts where
Firefox has the box inside the line and Pretext's widths put it past the line's end, which the older reading hid: 16 a
tab before items of soft hyphens, 2 a pre-wrap space before the soft hyphen that ends its item, 1 a padded span's last
piece (2026-10-01, #405; ENGINE_FOLLOWUPS.md, Rich-inline item edges, has them and the gaps left; the harness now
records a box of width 0 by its top). All of those counts are from before #394 to #403, and two of their causes are
closed since: letter spacing off Firefox's grid by #397 and tab stops under letter spacing by #395. With them in, of
18,675 layouts in Firefox 156.0.1 (the 9,979 and the later 1,253 recorded again, unchanged; the unit test's rows at
their widths; and 7,215 of a sentence with a 0px box after every space at five letter spacings on and off the grid),
3,418 pass that fail on main at #403 and 41 fail that pass there: 39 a pre-wrap space before the soft hyphen that ends
its item, 1 a space narrower than nothing at −6px and 1 a tab that ends its text run at −2px (2026-10-02). That reopens
if a Firefox build changes `CanPlaceFrame`, how a text frame trims the white space it breaks after or where it ends the
white space that hangs (`nsTextFrame.cpp:11202-11229`). A negative width is refused, as one that isn't finite is. An
inline-block of width 0 with a negative right margin lays out as a negative `extraWidth` does in Firefox 156.0.1 and
webkit-host, but Chrome 154.0.8037.57 ends a line at a space that overflows before it and starts the next line with the
box, where the negative width would bring the line back within its width, and fits a word after it that rich inline
moves to the next line (`one two`, a -15px box, `three four five` in 16px Arial, `one two three` at 77.5px): 51 of 884
layouts of four shapes at 10-120px differ in Chrome and none in the others (2026-09-30). No app was found that needs
one; the negative values apps pass are `extraWidth`s relative to a stand-in character. That reopens if one does.

Heights stay the app's (Limits), and with `vertical-align: top` or `bottom` on every box a line is as tall as the
paragraph's line-height or its tallest box, whichever is taller, to within one layout unit: about 13,000 lines with
boxes per browser in Arial, Helvetica Neue, Georgia, PingFang SC and the Shantell Sans web font, emoji and CJK fallback
included, at 13-20px and several line heights, in Chrome 154.0.8037.57, Firefox 156.0.1 and webkit-host (the system
WebKit 22625.1.29.11.27 that Safari 27.0 runs), macOS 27.0 (26A428) at DPR 2, 2026-09-30, in standards mode; installed
Safari and quirks mode weren't measured. A line of boxes alone keeps the strut, the block is its lines' heights added
up, and with `top` a line's text sits where it sits on a line without boxes, which is why the README advises it. The
rule needs every font on the line to have the paragraph font's ascent minus descent: Helvetica Neue's Bold, Semibold and
Medium faces, and its Italic in Chrome and WebKit, make a line taller by up to 0.5px in Chrome, 0.26px in Firefox and
0.20px in WebKit, with or without boxes, and text in another size by up to 2px, out of scope already; the line is then
`max(its text's height, tallest box)`, which Canvas can't give. An element whose line height keeps that text inside the
strut avoids it: the rich-note demo's fragments, `line-height: 1` in 500 17px and 700 12px Helvetica Neue and 600 14px
SF Mono, with CJK, Arabic and emoji fallback, in a 34px line, matched the demo's line heights exactly at 99 widths in
the three browsers (2026-09-30), in those fonts only. `baseline`, `middle`, `text-top` and `text-bottom` have no rule an
app can compute from Canvas, off by up to 7px, 2.3px and 5px: baseline needs each engine's rounding of ascent and
descent, which Canvas's `fontBoundingBox` values miss by up to 0.70px in Chrome, 0.27px in Firefox and 0.42px in WebKit,
and middle the x-height.

A box's width is fixed when it's prepared, as every width is, and Pretext adds it up as given, where browsers round an
element's width to their layout unit first: Chrome down to 1/64 of a device pixel, WebKit down to 1/64px and Firefox to
the nearest 1/60px, so at DPR 2 a 19.2px box is 19.1953, 19.1875 and 19.2px wide and a 10.01px one 10.0078, 10.0 and
10.0167px (Chrome 154.0.8037.57, Firefox 156.0.1, webkit-host, 2026-09-30). A line within about a unit per box of its
edge can then break otherwise: `ok `, eight 19.2px boxes and ` end` in 16px Arial fit on one line 0.03px under Pretext's
width in Chrome and 0.06px under in webkit-host, and eight 10.01px boxes wrap at Pretext's width in Firefox. Whole and
quarter pixels are on every browser's grid at the usual pixel ratios, which the README advises (ENGINE_FOLLOWUPS.md,
Rich-inline item edges). Widths passed at each layout call instead, which would follow an object capped at its
container's width (`max-width: 100%`, as documint caps its images and remux styles its inline math) without a new
prepare, weren't taken (2026-09-30): passing `min(width, container)` and preparing again when that changes is exact (no
difference from the browser in 365 layouts per browser of a box before a word joiner, a ZWSP or words, in normal white
space and pre-wrap), where passing the natural width and capping only the paint takes a line more where a word joiner or
ZWSP follows the box (52 and 7 of the 73 widths), and layout-time widths need a parallel array keyed by item index and
new parameters on three functions. That reopens if apps lay out many objects whose widths follow the container, where
preparing again on each resize costs them.

#### Items, Spaces And Fits

- Zero-width items keep their source identity: dropping them lost standalone ZWSPs, and compressing the item array broke
  cursor and fragment indices. An item's own analysis and the joined text's differ in their segments in 457 of 3,000
  random rich-inline flows, which is why fragment cursors can't index both: until the one-paragraph design both analyses
  were made, and since it only the paragraph's.
- Measure a collapsed space itself: `measureText('A A') - measureText('AA')` includes A–A kerning.
- In the item stepper an item's reserved width, the collapsed space before it plus its `extraWidth`, was checked before
  the whole item's fit, and rejected the item only when it was above the remaining width plus the fit epsilon
  (`lineFitEpsilon`): checking the whole item's fit first lost nine Safari forced-overflow matches, a broader guard 62
  (2026-09-13; old suite).
- Chrome and Firefox break before the ZWSP in `a`/ZWSP/`hello` at width 1 even in one text node, so a run that began the
  line still breaks at item boundaries on overflow; atomic `break: 'never'` items allow a break on both sides, as
  css-text requires (2026-09-12).

#### When A Wider Box Needs More Lines

That a wider box never needs more lines holds for ordinary words and is no invariant across widths: the browsers' own
line counts rise with the width in some paragraphs. Of the paragraphs the checked-in recordings pin at two or more
widths, a wider box takes more lines in 23 of 4,507 plain ones and 1 of 238 rich ones in Chrome 154.0.8037.98, 4 of
4,507 plain ones in Firefox 156.0.1, 266 of 4,500 in webkit-host and 2 of 195 in Safari 27.0 (the recordings on
2026-10-06, with #446's cases). In 243 of those 295 plain paragraphs the box with fewer lines is narrower than a quarter
of the font size: no character fits, and an engine keeps with a line's first character what can't start a line (WebKit's
rule: ENGINE_FOLLOWUPS.md, Emergency breaks inside a word) or what shapes with it. `x ffiffiffiffiffiffi y` in 24px
Hoefler Text is 14 lines in Chrome at 8.023px and 20 at 8.055px, where an `f` fits alone. Ten of the other 52 hold a
soft hyphen, a break that starts to fit and leaves more lines after it: `بب ببب`, a soft hyphen, U+0650, `ببب بب` in
24px Geeza Pro is 4 lines in Firefox at 30.001px and 5 at 30.017px, where `ببب` fits with its hyphen and the word takes
three lines for two. The profiles do the same on the offline invariants' stand-in Canvas (`harness/invariants.ts`): of
3,000 plain cases drawn from the sets, each laid out at 201 widths from a quarter of its own width to twice it, the
count rises in 378 under the WebKit profile, 375 of them from a box narrower than a glyph, in 5 under Gecko's, a rise
Firefox doesn't have (ENGINE_FOLLOWUPS.md, Line edges), and in none under Blink's (2026-10-06). The sample moves with
the sets: drawn again with #446's cases, the count rises in 367, 2 and, under Blink's, 2, both `a`, an emoji and
`b word` at letter spacing -6 from a box narrower than a glyph. That rise is Chrome's own: where `b` and the space after
it are narrower than their two spacings, as the stand-in font's kerning beside a space makes them under the Blink
profile, `b word` is narrower than `word`, so it fits a box that `a`, the emoji and `b` don't, and the word is cut in
the wider box that they fit. `a`, U+1F600, `b mm` in 16px Arial at letter spacing -8 is two lines in Chrome
154.0.8037.98 at 9.75px, the second `b mm`, and three at 9.875px, `mm` cut in two, in pre-wrap and in normal white
space, and the Blink profile has the same lines (2026-10-06); at -6, where Arial's `b` and space are wider than two
spacings, neither rises at any of 125 widths from 0.5 to 16px. So no check sweeps widths for a rise, which would fail on
ported rules, and the unit test of the rule lays out one sentence of ordinary words (`src/layout.test.ts`).

A rise the browser doesn't have is a bug: four raw-width fit checks in `src/rich-inline.ts` gave 11 lines at
115px, 12 at 115.1px (#281, 2026-09-14). An item ending at an unfit soft hyphen with no earlier break wrapped before the
item (items `T` and `po\u00add` gave `T` / `pod`, where `Tpo\u00add` gives `Tpo-` / `d`; #323). Blink retries the item
at the width less the hyphen, then rewinds earlier items at the full width; subtracting the hyphen left sub-1e-6px
backward ranges, so the item was walked again to the soft hyphen, cutting the flows in a seeded search that take more
lines as the width grows from 43-60 to 7-14 per profile (#327, 2026-09-15; ENGINE_FOLLOWUPS.md). The paragraph's walk
decides whether the text before the hyphen fits, and which earlier breaks a return may take is the text walker's rule
(`returnsFromUnfitHyphen()` in `src/line-break.ts`). A run that continues across items moves to the next line whole in
every profile where its first break is a soft hyphen whose hyphen doesn't fit, as it does in Safari 27 (`the `, `inter`,
`na\u00ADtion\u00ADal` at 84px in 16px Arial, #323's cases). Until #396 the WebKit profile made that return only, and
kept an unfit hyphen in one text and in an item that a break comes before, as after a space or an atomic item, where
WebKit returns as well (Engine Facts, Safari). Fit with the width you report, or text laid out at its widest line wraps
differently (#308, 2026-09-15).

#### Box Edges And Pre-wrap

Shaping stops at a span edge with padding, border or margin; otherwise Blink shapes items together when font, locale and
spacing match, Gecko when font and language do, and WebKit never, except complex right-to-left text across undecorated
edges, one run in Safari 27 whose share Canvas gives only at its ends (`TextShapingAcrossInlineBoxes`,
`InlineLineBuilder.cpp:780-1028`). The architecture doesn't block rich `pre-wrap`: run on rich `pre-wrap` text, the
per-engine rebuild (`rebuild/` on branch `rebuild-20260916`, a from-scratch port of each engine's line breaking, kept as
the plain-text correctness reference; "the rebuild" below) got 99.3-100% of 1,334 cases' line counts right per browser
(2026-09-18; `rebuild/research/PREWRAP-RICH.md` on that branch).

Rich inline takes `pre-wrap` (#173), on its premise that spans lay out as their text in one text node (Joined Text): the
paragraph's analysis takes it. A run of preserved spaces that ends a line hangs across items, as the run is one in the
paragraph's handle: its spaces fit where the content before the run fits, and the line hangs the run where it
ends, all of it where the line wraps and before a hard break or at the paragraph's end only what doesn't fit, as Blink
walks back over item results (`ComputeTrailingSpaceWidth`, `line_info.cc:289-415`), WebKit exempts each white-space
item's hanging width from the fit (`InlineContentBreaker`) and Gecko hangs each frame's trailing white space
(`nsTextFrame.cpp:11214-11229`). Tab stops count from the line's start, never an item's (Blink's
`line_breaker.cc:2963-2971`, WebKit's pen position, Gecko's `CalcTabWidths`, `nsTextFrame.cpp:4298-4378`). No break
comes before a hard break (UAX #14 LB6). A padded span that starts with one fits its padding there as each engine fits a
span whose line ends as it opens: Chrome its start edge, as Blink adds that edge when the span opens and a forced break's
close tags trail it, and no edge after preserved spaces that overflow or follow text in one span, as its return breaks
that text before them and the line then trails the spaces, the open tag and the forced break (Blink ends a text item at
each character it makes a control item, a run of tabs, a line feed and a lone CR or FF, so a tab or a line feed, and
spaces after one, follow no text; `IsControlItemCharacter`, `inline_items_builder.cc:177-184`), the spaces overflowing
where the content before them fits with the start edges of the spans that open among them and the spaces after those
edges don't; Safari its end edge too where the span holds only white space up to the break, as WebKit's content runs on
past the box ends after a line break, with white space that hangs before the span left out; Firefox both, as Gecko fits
a frame's cloned end edge (`paddedOpeningFit`, `src/measurement.ts`). Where it doesn't fit, all three engines return the
line to its latest break; without one, Chrome ends the line before the span, as its retry of an overflowing line breaks
between any two graphemes, and Firefox and Safari before the last grapheme of the text before it, a preserved space too,
whose wrap opportunities lie inside it, and before that grapheme's span where the grapheme is all of one; Safari keeps
the preserved spaces that fit of ones that overflow, as WebKit breaks the run that overflows where it fits
(`hardBreakItemRetreat`). WebKit's soft wrap index loop ends the content it places after a line break item
(`InlineFormattingUtils.cpp:456-475`), so no break comes before a line feed that starts a box there either, after an
atomic item too, and allows wrapping next to a white-space item (`:406-418`). A carriage return that ends one item and a
line feed that starts the next make one break, as CRLF in one text does. Preserved spaces, tabs that hang and a hard
break after an atomic item, without padding, stay on its line however far the line overflows, and so do they after items
of only such white space after it, whatever items it spans: no break comes before them, Blink takes them as trailing
items after the break after an atomic inline (`HandleTrailingSpaces`, `line_breaker.cc:2426-2534`), trailing on into the
next item, WebKit keeps each white-space item as content that hangs (`InlineContentBreaker.cpp:181-182`) and Gecko lets
an empty frame past the line's end (`CanPlaceFrame`), as all three browsers lay out a chip wider than the line, though
Chrome gives a line feed after such spaces a line of its own, and moves a span that starts with white space and goes on
past it whole, where rich inline takes an item as the paragraph's own text (ENGINE_FOLLOWUPS.md). But Gecko breaks only
after a run of spaces and tabs (`nsLineBreaker.cpp:323`, `:586`) and doesn't hang a tab, so Firefox moves such white
space that runs into a tab to the next line with the tab, whatever items it spans, from the break after the atomic
item. Before #386 a line took only the first item's white space there: of 10,991 probe inputs in 77 shapes at 20-200px,
2,173 Chrome, 1,095 Firefox and 2,223 webkit-host inputs pass since that change that failed before, and 72 Chrome and 43
Firefox ones that passed by luck fail (Chrome 154, Firefox 156.0.1, webkit-host, 2026-09-30; the shapes are in
ENGINE_FOLLOWUPS.md). A way to tell a span from the paragraph's own text would reopen the Chrome ones. A padded span
that starts with such white space or a hard break after a chip stays where the engine fits its opening, and in Chrome
one of only white space stays however far the line overflows, as Blink's return keeps the trailable items after the
break it returns to, white space and the tags of spans that close among it (`RewindOverflow`,
`line_breaker.cc:4332-4424`), which keeps such a span after any content; else the line ends at the break after the chip,
or in Safari, before a line feed, returns to the break before the chip. Blink and WebKit fit only the start edge of a
padded span that starts with white space after text too, WebKit after the text's own spaces, which it counts, and
Firefox both edges (ENGINE_FOLLOWUPS.md has the counts). An atomic item lays its text out in normal white space, as a
chip's `white-space: nowrap` box does: the rebuild's premise, the chip's max-content width with its preserved spaces, is
6.6px wider than all three browsers lay out the 12px chip ` @bob ` in 15px Helvetica Neue prose (2026-09-29).
Of 500 real-usage pre-wrap paragraphs split into same-font spans, each one that fails fails in one node too; what's left
is at padded span edges and tab stops across fonts (ENGINE_FOLLOWUPS.md, Rich-inline item edges).

#### Painting Lines

`pages/demos/markdown-chat.md` has the Markdown chat demo's painting patterns (#273, #310, #328); spacer boxes or
margins for gaps also drop the space from copied text (#273, 2026-09-13). A full-bidi painter (nested `bdo`, generated
ZWJs) matched Chrome on 112 of 113 cases but failed in Firefox, at about 8 times the elements (2026-09-03). A line
painted alone ends its bidi paragraph (U+200D after an Arabic letter took its isolated form, 11.41px for 3.91px) and
never runs Blink's `ShapeLine` under `white-space: pre`; the painter rules that held everywhere are in
`rebuild/DESIGN.md`, "7. Painter" (branch `rebuild-20260916`). Demo CSS must match what Pretext was told: a
`letter-spacing: -0.05em` Canvas never saw predicted 6 lines for a 4-line headline (#264, 2026-09-13), and such fixes
landed in one demo while siblings kept the bug (#264, #277-#279, #297, #298), hence AGENTS.md's demo rules.

### Content Language And Fonts

How each Canvas takes a language is under Measurement Model; the browser bugs are in PLATFORM_BUGS.md.

#### What The Page Language Changes

With `line-break` at its default, in named CJK fonts on `en`, `ja`, `ko`, `zh` and `zh-Hant` pages (Chrome 153, Safari
26.5.2, Firefox 155, 2026-09-12; Firefox's newline removal, from `nsTextFrameUtils.cpp`, is under Widths After A Line
Break):

| Shape | Chrome | Safari | Firefox |
| --- | --- | --- | --- |
| Small kana (`日本ァア`, `わかって`), or `ー` after an ideograph or kana, starting a line | Every page | `ja`, `ko` | Never |
| Break before `〜` or `゠` | `zh`, `zh-Hant` | Never | Never |
| Curly double quotes around Latin or Hangul as brackets (`中文“abc”中文`, `했다.”라고`) | `zh`, `zh-Hant` | All but `ja` | Never |

The sources agree (Chromium's `line_normal_cj.txt`, Apple ICU's `ja.txt` and `ko.txt` with its curly-quote patch),
though Safari 27's own quote classes (Engine Facts, Safari) break around the quotes in `中文“abc”中文` on every page. Under
`ja`, `zh-Hans` and `ko`, Safari and Firefox also shape some of a named font's punctuation differently, and fallback for
a missing character follows the language everywhere. Under `lang=""` Chrome takes its app language, Firefox its
`x-unicode` group, whose fallback follows the machine (U+2167: 16px, 27.53px under `en`), and Safari matched `en`.

Content without a language takes one a page can't read (Chrome's application locale, WebKit's process languages and ICU
default locale, Gecko's first OS regional-prefs locale; source, September 2026): on the Mac these facts come from, whose
OS language list puts Chinese first, Chrome laid it out as `zh`, Firefox nearly so and Safari as `en`, and an English
Mac would have moved about 430 Chrome and 780 Firefox old-suite results. So probes and cases set a non-empty `lang`,
and the harness pins Chrome's UI to en-US.

After a language change, Chrome's OffscreenCanvas keeps the fonts it chose until the font string changes: headless
Chromium 147 measured `骨直中文` in `20px "Helvetica Neue"` at 80px under `en` and still after `ko`, where a new context and
the DOM gave 69.2px (2026-09-11, #230). So preparation replaces the context when its language changes.

In a worker, Chrome's Canvas takes the UI language, Safari's generics none and Firefox's the macOS locale (2026-09-18).
Reading `<html lang>` costs about 16ns in headless Chromium and 4ns in WebKit, with no style recalculation (2026-09-12;
Firefox unmeasured): the evidence behind AGENTS.md's exception for that read, and behind the condition on taking content
language from the page, that `prepare()` and `layout()` do nothing new and expensive in the browser (Part 1, Limits).
With `lang=ja` on the test element alone, Firefox's DOM measured `foo-bar日本語` in 18px serif at 114.867px and its
OffscreenCanvas 106.983px (2026-09-03): put `lang` on `<html>`.

#### Safari's Generic Families

Under every language whose WebKit script isn't Common, `en` included, WebKit gets a generic family from Core Text's
`CTFontDescriptorCreateForCSSFamily` with the page language (`FontDescriptionCocoa.cpp:77-118`), while its
OffscreenCanvas has no language (WebKit #285993): on any page with a language (about 87% of pages set one, a figure
whose source wasn't recorded), `monospace` draws Menlo on the page and Courier in Canvas. macOS 27's 1,079 locale
identifiers give 32 distinct answers, kept as a default plus 60 languages that differ from their parent: OS facts, Core
Text's answers dumped on macOS 27 and, for iOS, in the iOS 26 simulator (`scripts/generate-webkit-generic-families.ts`
says how), regenerated per macOS release.

Naming that family in the Canvas font, macOS's where the context has it and iOS's otherwise, matched the DOM on 14 texts
in nine scripts at 40px in every generic on 18 page languages, up from 0-6, except where the family lacks a character:
`monospace` under `ko` (7 of 14; Menlo has no Hangul), `sans-serif` under `ja` on macOS (12), `fantasy` under `he` on
iOS (5) (Safari 27 on macOS 27, the iOS 26 simulator, iOS 27 on an iPhone; 2026-09-24). Under `zh` Core Text names
Kaiti, which Safari can't use on macOS 27, and Safari draws Songti. In webkit-host (September 2026) a list where no
family resolves draws the script's standard family, Windows-only lists (`Meiryo`, `"Microsoft YaHei"` alone) resolve to
nothing, and PingFang lacks kana.

Rejected besides a `<canvas>` element (Decisions Log, 2026-09-24): macOS's family then iOS's in one list (what macOS's
lacks goes to iOS's, 11.6-33.8px off at 40px), a detached `<canvas lang>`, languageless (`Element.cpp:4873`), and
`navigator.languages` for a plain Han page, since Safari shows a page only the first preferred language.

#### `system-ui`, Late Fonts And Kept State

For `system-ui` (PLATFORM_BUGS.md; #336), guessed substitutions, size tables and scaling proved unreliable (March 2026),
and the line breaker takes no font-name rules. After a web font loads, Chrome's and Firefox's kept contexts pick the
family up and webkit-host's may not (Engine Facts, Safari). A stored answer stays wrong after a late web font until
cleared: the rebuild's kept widths gave 4 lines where the DOM had 2, in all three browsers. Main's width cache is
shared per font until `clearCache()`, unowned and unbounded, so random IDs and URLs grow it (a streaming word: 1.5 to
9.7MB of heap over 800 edits); it's easy to assume the cache lives as long as a prepared handle, so README states both
lifetimes.

CSS `font-family` parses alike in all three (123 of 123 checks, the rebuild, September 2026); which unquoted names are
keywords, and how names compare, differ. Code rewriting a list, as the WebKit profile does, meets three traps:
`JSON.stringify` isn't a CSS serializer, `, monospace` after an unclosed string joins the name, and a quoted
`"system-ui"` is a named family. Behind README's caveats on settings Pretext can't see (#275, 2026-09-14): a 12px
minimum font size in Chrome or Firefox paints 9-11px text at 12px (3 of 10 paragraphs gained a line), and inherited
`word-spacing` overflowed 5 of 8 chat lines. `line-height: normal` varies by browser and font (16px Helvetica Neue: 18px
in Safari, 19.45px in Firefox; March 2026).

#### Emoji

PLATFORM_BUGS.md has the bug and the correction, whose shape rests on the widening depending only on the size, matching
across 59 emoji and 7 families and adding up per emoji (March 2026). Taking the font size for the DOM's emoji width
over-corrected Safari by 4px an emoji, and Firefox's DOM sizes Apple Color Emoji in device pixels, its Canvas in CSS
pixels (12.5px at 12px and DPR 2, 2026-09-15). The gap belongs to the emoji font's glyphs, and Canvas shows which
characters it drew: Apple Color Emoji gives every glyph one advance at a size, so a stretch of emoji characters it draws
(emoji and pictographs with the ZWJ, skin tones, tags, U+20E3 and variation selectors between them) measures a whole
number of U+1F600's Canvas width, the count of its glyphs, and one with a glyph of another font measures anything else
and takes no correction. A whole number means to within the rounding of a 32-bit float, which is what Canvas reports
(`CanvasRenderingContext2D.cpp:5277` in Firefox 156, `text_metrics.cc:179` in Chromium 153): each rounding moves a width
by up to 2^-24 of itself. Firefox rounds each width once, dividing a whole number of app units. Chrome adds a run's
advances in 16.16 fixed point and rounds once per run, then once more for each run it adds (`shape_result.cc:1573-1576`
and `1609`, `text_metrics.cc:222`). Two widths are compared, the emoji's and the stretch's, so a stretch drawn as one
run needs two roundings, and the count allows 2^-20 of the width, sixteen. That is 0.00002px at 20px, far under the
steps widths come in (1/60px in Firefox, its app unit; 0.008px for an advance at 16px in a font of 2,048 units to the
em), so "exactly as wide as an emoji" below means equal but for that rounding. Counting glyphs that way in every
grapheme that holds an emoji or a pictograph, in Chrome 154.0.8037.57 and Firefox 156.0.1 at DPR 2 (2026-10-01, #398),
took the widths more than 0.1px off the DOM's:
- from 2,571 of 265,140 to 807 in Chrome and from 2,298 to 0 in Firefox, over 1,473 emoji graphemes alone and inside a
  word in 30 font lists at 12, 16 and 20px; Chrome's 807 are a skin tone after a character that isn't an emoji;
- from 25,084 of 350,776 to 0 in Chrome and from some 25,800 in Firefox to 7-20 in one of the first families measured,
  another each run, before U+FE0E, and 4 that were right before, over 652 emoji graphemes alone, bare, before U+FE0E and
  before U+FE0F, in the 258 installed families and 11 generic ones at 13 and 16px; nearly all were an emoji-presentation
  character before U+FE0E, which a text font draws;
- by 4,112 of 44,640 in Chrome and 7,847 in Firefox, with 178 and 252 that were right before wrong, over 496 graphemes
  that mix fonts (an emoji or a sequence before a mark or a selector, a skin tone after a character of another script)
  in 90 fonts; 6,766 in Chrome and 8,488 in Firefox are wrong after it;
- by 9,416 of 438,900 in Chrome and 8,789 in Firefox, over the 5,225 forms of emoji-test.txt 17.0 alone and inside a
  word in 42 fonts at 12 to 23px, and by 256,240 of 575,660 in Chrome and 245,950 in Firefox, over 214 pictographs and
  keycaps with no U+FE0F in the installed families at ten sizes from 11 to 22px. Nearly all are a pictograph whose
  presentation is text by default, which only the emoji font has: U+1F336 in 16px Arial is 16px on the page and 20px
  in Chrome's Canvas, 21px in Firefox's. Of those that were right, 2 are wrong in Chrome, Zapfino's `™` in the second
  set, and 278 and 263 in Firefox: its box for a missing glyph at 13px (12 and the 263), that box before a skin tone
  in a page's first second (50), and three ZWJ sequences written with no U+FE0F (216).

A stretch that two fonts draw takes no correction, and one measured apart from a mark after it can be another font's
than on the page: the 178, 252 and 216, and the 4 of the second set, U+26A1, ZWJ, U+2B50 in Menlo and Apple Symbols,
which draw that U+26A1 themselves. A version that also asked such a stretch character by character was measured and left
out (Decisions Log, 2026-10-01). What the count still gets wrong, and the mixes it newly gets wrong, are in
ENGINE_FOLLOWUPS.md, Emoji correction. Text fonts whose glyphs are exactly as wide as an emoji's, beyond the two found
there, real text with a ZWJ sequence that two fonts draw, or a platform with the gap whose emoji font varies its
advances would reopen it. The rebuild's DOM-free formulas, W being Canvas's width at a size: Chrome's DOM width is
`Math.ceil(64 × W(size × DPR)) / (64 × DPR)` at DPR 2 and `W(size)` at DPR 1, Firefox's `W(size × DPR) / DPR`, Safari's
`W(size)` (September 2026). They'd retire the DOM exception and work in workers, but make prepared widths depend on the
DPR at prepare time, which the API discussion planned before a release decides (TODO.md, End of project).

Letter-spaced text is counted the same way. The Blink and Gecko profiles measure its stretches through the context that
shapes letter-spaced text (Measurement Model), and a text measured under its real spacing is counted before that spacing
is set. Over 1,332 strings from templates of running text in 16 fonts at 1px and at -0.5px, 21,312 widths each, 1,744
in Chrome and 1,264 in Firefox went from wrong to right and none from right to wrong, the same before #397 gave
letter-spaced text that context and after (2026-10-01).

#### Widths That Depend On Context

Whole-run agreement, isolated-letter agreement and matching breaks are separate claims. These probes run from 6fadbe5
(`bun run font-probe`, `bun run probe:arabic-joining`; Decisions Log, 2026-09-25), which may not launch on macOS 27; the
font probe fetches Shantell Sans unpinned from Google Fonts and fails without it, since a fallback font is no evidence.

**Shantell Sans (#195).** 56 `x` in `bold 15px "Shantell Sans"` in a 140px `pre-wrap` box wrap 15/15/15/11 natively and
16/16/16/8 in Pretext (Chrome and Firefox 152, 2026-09-03), though whole-run DOM and Canvas agree (501.75px in Firefox)
and the letters alone sum to 480.67px; Chrome's first bold `x` is 8.586px alone and 8.961px with the next character
kept. At 48 nearby thresholds, prefix widths matched 16 per face in Chrome, and one following grapheme of context all 48
in Chrome but 16 per face in Safari 26.5.2, where reshaping each line prefix matched 42: a context-aware fit per engine
(ENGINE_FOLLOWUPS.md). Pretext's `pair-context` mode, for numeric runs, keeps the grapheme before, not after; the
Chromium profile summed graphemes, and the case was on Chrome's accepted list until the profile came to fit a word of
80px or wider from its pairs or prefixes (#435), with which the report's layout is Chrome's.

**Firefox's joined Arabic.** Gecko fits from the whole shaped word's advances; Pretext prices letters beside a soft
hyphen, or at an emergency break in a segment under 80px, isolated. Measuring each connected letter with a ZWJ on an
`rtl` canvas, gated by W(L+ZWJ) + W(ZWJ+R) − W(L+R) within 1/60px, matched 1,458 of 1,576 corpus widths in Noto Naskh
Arabic and 1,462 in the system fallback, against 144 and 300 isolated, with no false accepts, but 746 in Amiri and 438
in Noto Nastaliq Urdu, so a rule needs the check and a per-font fallback (Firefox 155, DPR 2, 2026-09-12;
ENGINE_FOLLOWUPS.md).

### Bidi Levels

Pretext takes no paragraph direction and resolves no bidi levels (ENGINE_FOLLOWUPS.md, Bidi levels, direction and
script runs).

`segLevels`, removed in #258 (Decisions Log, 2026-09-13), came from pdf.js through chenglou/text-layout, earlier prior
art (Dead Ends, The Measurement Model): the direction from the first strong character, no embeddings, isolates, bracket
pairs or line rules, a segment's level its first code unit's. Nothing in Pretext had read them since `layout()` stopped
reordering with them (5ecce72c), and published uses only guessed a paragraph's direction. Removing them made
`prepareWithSegments()` 3% faster on Latin and 8.5% on Arabic, Hebrew and Urdu, and `prepareRichInline()` 15% with
Arabic items (Node's V8, stand-in Canvas).

Logical-order breaks and summed widths give the right lines (44 of 44 Markdown chat message heights in Chrome 153 and
Safari 26.5.2; Firefox 155 missed only on URL and hyphen rules; 2026-09-13). Painting goes wrong: an element holding the
paragraph needs only its direction, but a line drawn alone, as by `fillText()`, is its own bidi paragraph. GNU FriBidi
1.0.16 orders `1+2 xyz`, the second line of `abc ابج 1+2 xyz`, as `2+1 xyz` within the paragraph, and edge numbers,
punctuation and isolates moved so on 21 lines per browser in a probe of the chat's messages. Custom rendering would need
a paragraph direction, levels per code unit, and per-line reset and reordering (UAX #9 L1, L2); a known direction would
also let the WebKit profile keep the kerning that `formatTailStaysWithWord()` gives up when the letters' directions
differ, and the Chromium profile take a word's kerning with spaces in text that mixes directions, which it leaves out
whole (Kerning At Line Edges). Whether mixed bidi fits Pretext without new broken assumptions is an open question, the
maintainer's to decide; a `direction` option is on the API discussion's list (TODO.md).

Blink and WebKit run ICU's `ubidi_setPara`, Firefox the unicode-bidi crate 0.3.15, and they disagree on 130,661 of
300,000 short fuzz strings (the unidirectional shortcut, removed characters' levels, paragraph splits at class B,
brackets under overrides). So the rebuild ported ICU 78.2's `ubidi.cpp` line by line (844 lines; Dead Ends, Tables,
Bundles And Data), matching icu4c 78.3 and libicucore on 770,241 BidiTest runs, 183,379 BidiCharacterTest lines and
405,000 fuzz strings; macOS 27's libicucore gives U+F7F0-U+F8FF Apple's own classes (September 2026).

A bidi level is the number the Unicode bidi algorithm (UAX #9) gives each character for its direction: even in
left-to-right text, odd in right-to-left, higher where one is nested in the other. Firefox makes a text frame of each
run of one level (`nsBidiPresUtils.cpp:1037-1053`) and a text run doesn't go on across two
(`ContinueTextRunAcrossFrames`, `nsTextFrame.cpp:2023-2030`). Such a split only starts a cluster, restarts clusters
within its word and ends a word after a space before a cluster extender, so levels move a break only where a level run
starts inside a cluster, or after a space inside one: in a left-to-right paragraph Firefox 156.0.1 breaks `aa בבבב🏻` at
60px in 16px Arial before the skin-tone modifier, where the Gecko profile breaks after `aa`, as Firefox does in a
right-to-left one. The Gecko scan made those splits from #340: levels changed none of 183,000 segments, direction
changes falling where segments end anyway, yet took 38-46% of the profile's right-to-left analysis. From #365
(2026-09-27) it made them only where a guard showed one could matter, in 262 of the harness's 10,733 texts holding a
code unit Firefox's `HasRTLChars` flags, the guarded scan equal to resolving everywhere over 63 million fuzz strings.
Since #403 (2026-10-01) it makes none. Firefox 156.0.1 then prepared text whose widths it had cached 3.4-5.5% faster on
Latin, CJK, Arabic and mixed chat messages, with Thai level, and 3.3-7.3% faster on each of the bench's nine worst-case
texts, in both of two sessions against main at #399. No row of Chrome's moved, nor of Safari's once the two that read
slower, Thai `layout()` at new widths and the mixed stream, were run again over three sessions (2026-10-02; the tables
are in #403). Latin and CJK text, which resolved no levels, gains as much as Arabic. That is read as the test for a
word's end, which the scan made for every character through a helper the splits shared, with nothing run to confirm it.
Firefox's Latin `layout()` at new widths read 14.8% faster in the same table, and that isn't this change's doing, as
`layout()` runs none of its code: main after #394 to #399 had read the row 17.6% slower than main before them, and one
build read it 13.5% slower or level by the names the bench's minifier gave its top-level bindings (Keeping Work
Bounded, JavaScript Engines).

With that the Gecko analysis reads 7 of the harness's texts otherwise, all generated: Balinese and Batak vowel killers
after Arabic or Hebrew letters, U+0600 before an ideographic space, a kasra after U+200E between Arabic letters and one
fuzz string. It reads none of the real-usage sample's 10,658 texts, none of the corpora's 5,936 paragraphs and none of
455,648 strings of macOS 27's Arabic, Hebrew and Urdu localizations otherwise. In Firefox 156.0.1, 24 pinned cases fail
for it, 13 under 24px and the widest at 56px, 10 with a wrong line count, all under 18px; and 60 written paragraphs of
Arabic, Hebrew, Persian and Urdu with Latin words, digits, URLs, emoji and direction marks, 16 more as styled spans,
each as a left-to-right and a right-to-left paragraph at 11 widths from 200 to 600px, pass in all 1,672 cases with the
splits and without. Outside the harness an emoji right after a Prepend character (U+06DD, U+0600) is such a change too,
where the splits pass 104 of 144 probe cases and the scan without them 82 (ENGINE_FOLLOWUPS.md). With the splits went
the rule #368 added for them, which started a segment at a cluster extender after a bidi control where the scan starts
a cluster. Without level runs it fired only at a mark that starts a cluster of its own, as a Myanmar visarga does, and
kept two such marks after a control on one line where Firefox breaks before each: of 84 probe cases, three such texts
at 7 widths from 1 to 50px, with and without 2px letter spacing, in both paragraph directions, 10 pass with the rule
and 70 without it, 4 of them only with it, Myanmar text under letter spacing, where Canvas measures a visarga after a
control wider than the page draws it (ENGINE_FOLLOWUPS.md, White space and controls). The splits, their guard and that
rule were 86 lines of code.

The levels came from a port of servo/unicode-bidi, the crate Firefox runs (`intl/components/src/Bidi.h:13`), with its
Bidi_Class and bracket tables, never returned to callers and taking every paragraph as left-to-right, where Firefox
takes the block's direction (`nsBidiPresUtils.cpp:311`). Its one other reader, rich inline's white-space run across
items (Rich Inline Boundaries, Firefox's White-Space Run Across Items), gave levels up in the same change, so the port
left too: in all 539 lines of code, and 10.7 KB of the minified layout bundle, 4.4 KB gzipped, with Bidi_Class one of
the ten class maps of #394's run list (Break Opportunities From Engine Data); before #394 the same removal took 15.6 KB
and 6.9 KB. For rich inline that cost 6 more generated Firefox cases, all left-to-right paragraphs with a right-to-left
mark after white space that follows Latin text; in a right-to-left paragraph the same items now lay out as in Firefox,
where the port gave a space too many. A mark or a PDI inside an embedding or isolate of the other direction is a loss
in both directions. The maintainer decided the removal on 2026-10-01 (Decisions Log): the port was the left-to-right
half of Firefox's rule, and no real text moved for it. It reopens with a `direction` option (TODO.md), which a port
needs to be right in both directions, or if real text shows a direction change inside a cluster, or a rich item of only
white space and a mark or PDI at another level, or one that ends in it and a soft hyphen after white space
(ENGINE_FOLLOWUPS.md, Bidi levels, direction and script runs, and Rich-inline item edges). U+200F between two spaces is
real, in 32 of the 455,648 strings, text an app sets in right-to-left paragraphs. On the stand-in Canvas, which has no
direction, rich lines lay such a string out as the port did unless a space and the marks after it are an item of their
own, as in 7 of 69,547 cuts of the strings that hold a control into items at random spaces. The port
(`src/gecko-bidi-levels.ts`), the splits and the guard, `levelsMayMatter()`, with its argument
(`src/gecko-line-breaks.ts`), are at 8e88756b, and the guard's method stays the one to use for any port claimed exact: a
written argument, a fuzz against the unguarded path, and a unit test per rule. The bracket pairs stay for their other
reader, Blink's script runs, which letter spacing and the Chromium profile's kerning with spaces turn on: a list beside
that reader until #423, and since then ICU's own pairs, in the table of script classes (Part 1, Tables Against Canvas).

While the scan made the splits, two designs were rejected: resolving wherever a cluster holds several code points,
exact with a shorter argument, but vowel marks and emoji make that 37% of Arabic paragraphs and 57% of the chat's
right-to-left texts, saving 5-15%; and setting the whole text run up again where levels split it, 8-17% slower than
main where levels resolved, against within 5% for setting up only the words the splits cut. The two setups shared one
word-end test, whose call made Firefox 156 prepare long breakable runs, pre-wrap chunks, keep-all CJK brackets and
Latin messages it has measured before (the bench's `seen` row) 2-5% slower than main; written out twice they read
within noise, and the copy wasn't kept (Decisions Log, 2026-09-26). With one setup left, the test is written in it
again.

### Keeping Work Bounded

Small operations turn quadratic when they repeat over growing user text (engineering.md, Control Flow). Browsers break
lines in linear time, so exactness forces nothing worse: the rebuild's slow giant paragraphs came from its own rescans
to the text's end from every line start. Ratios below are `bun harness bench`'s, two sessions per browser, against main
before each change, unless an entry names its own sessions, build or shell.

#### Quadratic Traps

Kinds met, with the fixes that hold the details (some of that code is gone): reclassifying growing punctuation or Arabic
strings, or rescanning cleared slots (`30854d7`, `2148b90`, `4cb8b24`, `f0a326d`); rebuilding growing CJK or keep-all
units (`eb3bbbe`, `f0a326d`); measuring every growing Canvas prefix (`fcf9c62`); searching hard-break chunks from the
start for every streamed line (`2c52171`); retrying white-space and font-size suffix regexes, and restarting
preferred-hyphen searches (#221); measuring each run of a combining-mark chain after the whole chain before it (#351);
looking for a bidi control after each soft hyphen of a run, which made Firefox prepare the bench's invisible tails 44%
slower until each run was scanned once, at its start (#368); searching a segment's list of the graphemes WebKit doesn't
start a line with once per grapheme, where a flag per grapheme is one read (#401).

The regex traps needed internal white space before content, or digit runs without `px`; the hyphen one, a long
hyphenated run over many lines. A continuation from anywhere must seek its starting boundary; a positioned scan can
carry its index. Before #351 (2026-09-26) an unbroken word of soft-hyphen and accent pairs took 64ms at 1× and 3,957ms
at 8×, and the first fix, argued from runs of 1-2 accents, cut the context short past about 95 and moved Safari's widths
up to 7px: test long runs. A `prepare()` that takes seconds, such as one 160,000-character word, can get the Chrome tab
killed as hung (Chrome 153, September 2026). The WebKit list was a trap in `layout()` and every line walker, at a width
narrower than a glyph: one call on 160,000 `…` took 3.2 s under Bun 1.4 with a stand-in Canvas, and now under 1 ms
(2026-09-30). No test would have shown it: the harness's growth check (`harness/invariants.ts`) counts Canvas calls and
lines up to 4,096 units, not time, so time the walkers on a long run by hand.

#### Canvas Work

Count the text submitted to Canvas, not calls: measuring every prefix or suffix is quadratic even at one ask per
position. So prefix fits stop at 96 graphemes and take pairs beyond, which bounds the amplification, not the shaper's
own cost, and a context query charges its overlapping source too. Main at the time spent 46ms analyzing and 70ms
measuring of Chrome 153's 115ms on the corpora (`corpora/`), but 46ms and 305ms of Safari 26.5.2's 350ms (2026-09-15,
before #340's scans and #344's grapheme tables made analysis faster; the split hasn't been measured since):
Safari gains must come from measuring less. Korean, Thai, Khmer, Burmese and Hindi cost Chrome about 4 times English
under system fallback, twice with a named font for the script.

The context's font is set at the first measurement after a font is looked up (`getContext()` in `src/measurement.ts`),
not at the lookup (#445): rich inline looks a font up for every item, and an item whose text is all in the font's cache
measures nothing. Prepared again, the bench's 147 Latin rich messages, 7,040 items, assigned `context.font` 7,040 times,
2,310 of them to another font than the context held, and ten dense styled Japanese sentences, 74 items, 74 times and 44;
now neither assigns any (a stand-in Canvas's counts; a row of the unit test for stale contexts holds the zero). Those
messages prepared again are the bench's `rich: latin rich-seen`, which read 20.9% faster in Chrome 154.0.8037.57, 21.7%
in Firefox 156.0.1 and 56.0% in Safari 27.0 (foreground, three sessions, 2026-10-05, against main at #435; against main
before #435 Firefox read 12%, on the page below, and what widened it wasn't looked for). On a page that times main, the
change and a second copy of main by turns, the sentences read 11%, 5% and 31% faster, CJK prose with bold quotations 3%,
2% and 9%, and the same messages as plain text in one font within 2% (foreground, five pages a browser, 2026-10-05).

What it costs: 5 code lines, and in Safari the two worst-case rows that prepare cached CJK text. `worst:
cjk-brackets-keep-all prepare` read above base in 19 of 19 foreground sessions, by 0.6% to 2.8%, 1.7% at the median, so
mostly under the row's 2% floor, and `worst: cjk-letter-spaced prepare` in 8 of 8 against main at #435, by 0.7% to 5.2%,
its control up to 4.8% from base. Not assigning the font isn't what costs: the same build with the font also assigned at
every lookup, as before, read the keep-all row 2.3% to 3.0% slower in five of five sessions, so the assignment left out
gives about 1.5% of that row back, and a build one unused binding apart read it 1.4% to 5.3% slower. Preparing that
row's 120 texts again measures nothing, and where main assigned the context's font and compared a flag it makes one
store, so it is taken as how Safari compiles the bundle, with the cause not found (Safari 27.0, foreground, five
sessions a build, 2026-10-05).

Every measurement still follows an assignment of its font made since the font was looked up, as it did before; only an
assignment that no measurement follows is gone. That moves one thing in the pinned browsers, in Safari: a kept context
that missed a late face takes it when its font string changes, which now follows the font measured last and not the font
looked up last. So cached text in another font no longer heals it, and cached text of the late family, prepared after
text measured in another font, no longer keeps it from healing (PLATFORM_BUGS.md, Safari: a kept Canvas context misses a
loaded `FontFace`; webkit-host, with Chrome 154.0.8037.57 and Firefox 156.0.1 taking the face in every order,
2026-10-05). Firefox before 156, where an assignment could still heal a context stuck on a late family name
(PLATFORM_BUGS.md, Firefox: the late family names), wasn't run and may differ the same way. A build that set the font
only where the context held another lost Firefox a face added after its font was measured (Engine Facts, Firefox).
Reopens if an engine needs a font assigned where nothing is measured.

#### Work Done Only Where A Rule Applies

A rule only rare text needs costs other text nothing only where preparation finds that text through a test it already
runs (Firefox 156.0.1, bench sessions of 2026-09-27 and 28, unless noted):
- **Firefox's bidi controls** (#368, #372; Break Opportunities From Engine Data): testing every Gecko text's units for a
  soft hyphen or control made Firefox prepare the `seen` messages 4-6% slower and long breakable runs and pre-wrap
  chunks 9-17%, so the analysis looks only where the Gecko scan's white-space step noted, as it dropped one, that it
  dropped a control, as Firefox's `IsDiscardable` notes a soft hyphen (`HasShy`, `nsTextFrameUtils.cpp:32-41`). Testing
  the text for a control before the scan instead, so the scan runs once, costs a pass over every text: a regular
  expression or a loop read one to four `seen` rows 1.0-3.6% slower in both sessions of every run, skipping 8-bit text
  saved little, since a curly quote or a dash makes English 16-bit, and the controls `worst` row, whose second scan the
  test saves, read no faster. Since #399 (2026-10-01) the scan runs once for every text: it marks the white space a run
  left out past a dropped character as it collapses the run, and the analysis takes that out of the source, where #368
  collapsed the source with a regular expression and scanned the result again. Offline, as a share of main's analysis
  time for the same text (Bun's JavaScriptCore, a hypothesis for Firefox; two sessions): 60 words with LRM or RLM
  between spaces at every sixth take 0.6 to 0.8; 8-bit Latin with a soft hyphen between spaces there, whose white space
  main didn't collapse, 1.1 to 1.3; with a lone CR there, which the analysis takes out, 1.0; and with CRLF there 1.0 to
  1.1. The scan doesn't mark the CR of a CRLF: collapsing adjacent white space already joins it to the line feed's
  space, and marking it, which builds the source again for every text with CRLF line ends, read 1.2 to 1.3 for the same
  lines (0 of 700,000 random strings differ between the two).
- **Safari's lone CR** (#455; Engine Facts, Safari (WebKit), CR and FF): the WebKit profile's analysis looks for one
  only in text whose white space collapsed, which the collapse has tested already, since a CR always collapses, so text
  with single spaces between its words runs nothing new. Offline in Bun on a stand-in Canvas, 60 words with CRLF at
  every sixth prepare and lay out in main's time, and with a lone CR between two words there `prepare()` takes about
  0.9 of main's time, `layout()` 0.75 and `walkLineRanges()` 0.2, since main's space that no line ends at took the text
  off the simple walk (a hypothesis for Safari, 2026-10-06).
- **What only a rich-inline paragraph has, on a text's path** (Rich Inline Boundaries, Rich Inline As One Paragraph).
  The full walker's rules for a paragraph are tests of `items !== undefined` or of a list a text doesn't have, and a
  text pays each one it meets. Written as four tests at every soft hyphen and three at every fit of a segment on a line
  with content, they had the bench's soft hyphens and marks read `layout()` 7.3%, 5.9% and 7.4% slower than main
  (background Chrome 154, Firefox 156.0.1 and webkit-host, three sessions a run, 2026-10-05), so the walker holds them
  under one test at each of those places. In preparation, the Gecko scan's white-space pass found for every unit where
  its item ends, which only a white-space run reads: Firefox's shell prepared the bench's long breakable runs 3.3%
  slower than main, and 1.6% with that found where a run starts. Each reading below is of the builds it names; what the
  walker as built reads against main is at this entry's end.

  The halt of a mark that ends an item (Rich Inline As One Paragraph) is written once, among the paragraph's tests:
  where a line with content adds a segment's advance, a mark that ends its item and overflows without its halt is added
  at its halted width, in one sum, with the paragraph's list tested first, so a text pays one test of a list it doesn't
  have for each segment a line lets in. Two forms before it each lost a worst-case row against main, called by the
  foreground bench (2026-10-06): as two tests after every segment a line lets in, of a trim that is nearly always 0,
  Firefox 156.0.1 laid letter-spaced CJK out 9.2% slower; applied by changing the segment's advance, which made that
  advance and the width the line fits two variables in place of two constants, Safari 27.0 laid pre-wrap chunks out
  14.8% slower and walked them 13.2% slower. A third form read level and wrote the admission of a text segment a second
  time, 11 of its 16 lines, the room for a hyphen among them, which Part 1 (Engineering, JIT tuning) allows for no such
  gain. The rule as the walker has it (2026-10-07) is that form's rule and its arithmetic: on a stand-in Canvas that
  halts a pair of fullwidth marks by half an em, 0 of 100,000 random paragraphs whose items end in closing marks differ
  from it in a line, a range or a width in the Blink profile, the one profile that halts such a mark (a fuzz that isn't
  checked in), and 0 of 64,378 Chrome probe predictions do. In the foreground it reads level with it: no worst-case,
  `lines` or `resize` row is called, and the rows the first form moved read within 1.1% (Chrome 154.0.8037.98, Firefox
  156.0.1, Safari 27.0, three sessions, 2026-10-07). The order of its two tests is what Firefox reads: SpiderMonkey's
  shell read the trim tested first 3.9% slower on letter-spaced CJK in each of five processes and the list tested first
  level (a hypothesis; no foreground run timed the two orders side by side). Four lines after the admission that test
  the list first and then the fit read level too and are not the rule: on a fresh line they ask whether the segment set
  a trim, which a mark with no fit advance never does, so 4 of 36,000 of the fuzz's paragraphs laid out otherwise
  (ENGINE_FOLLOWUPS.md, Rich-inline item edges, has the case, which no Chrome layout checks), and a halt subtracted
  after the advance is added differs from the one sum in a width's last bits, in about 75 of 10,000.

  What the paragraph's tests cost a text was measured by removal, with a walker that only has to be right for a text
  (2026-10-07). In the foreground that walker, every paragraph statement out, reads against the walker as it stood
  before the halt was taken in one sum and before `hangs`, its test of whether a segment hangs at a line's end, was two
  statements (three sessions, the worst-case rows): Safari's pre-wrap chunks 7.1% and 5.8% faster, letter-spaced CJK
  4.3% and the control characters 5.6%, all called; Firefox's pre-wrap chunks 4.0% and 4.1%, called, letter-spaced CJK
  3.9% and the soft hyphens 2.6%; Chrome's pre-wrap `layout()` 3.6%, called, and the soft hyphens 4.9%, with its
  pre-wrap walk 2.1% slower in every session beside a control 1.2% slower in every session too. In the engines' shells
  (d8 15.4.80, SpiderMonkey 156.0.1's and Safari 27.0's jsc, on a stand-in Canvas, so hypotheses) the walker before
  those two changes read 7.9%, 9.0% and 7.1% slower than main's in JavaScriptCore's, on letter-spaced CJK and on
  pre-wrap chunks' `layout()` and walk, and 4.3% slower in SpiderMonkey's on the soft hyphens; main's walker in the same
  `src/` gave all of it back, as did the walker with every paragraph statement out, so the gap is the walker's and not
  the handles'. Of the groups of tests taken out one at a time, one showed alone: the paragraph's three tests in
  `hangs`, which ask whether a zero-width break goes on with a run of hanging spaces, at 4.1% and 2.8% of
  JavaScriptCore's pre-wrap rows. Each of the others read within 2% on the four rows but for five cells of 44, in
  opposite directions.

  What those three tests cost is their form. `hangs` is two statements, `let hangs` from the hanging kinds and then the
  three tests in an `if`, which asks a segment that hangs one test more than the same tests after an `||` in one
  expression. They remove no test and change no type or allocation: what they change is how each engine compiles the
  same tests. Timed directly, the walker with them against the same tree with the one expression (69342169 against
  a38bdea7, local commits made to time it, both without the function for a one-item rich paragraph's line, which no
  plain row runs; Chrome 154.0.8037.98, Firefox 156.0.1, Safari 27.0, foreground, ten sessions a browser of the
  worst-case rows, 2026-10-07 and 08), no row is called and none reads slower in every session. With them Safari lays
  pre-wrap chunks out 4.3% faster and walks them 4.0% faster, each called in one of its two runs, on samples of 16 and 9
  ms where the bench aims at 50, and lays the soft hyphens out 1.5% faster, each in all ten sessions; Chrome lays
  letter-spaced CJK out 2.8% faster in all ten and pre-wrap chunks 3.3% faster in nine; Firefox reads every row within
  1.5%, none on one side in every session. Three runs before that one, in which the build with the two statements came
  from a folder outside the checkout and so took 240 other top-level names than its base, read a gain of about 2% on
  pre-wrap chunks' `layout()` and walk and on letter-spaced CJK `layout()`, the rows' floor. Other spellings were trades
  between the engines' shells: the hanging kinds picked by one select read pre-wrap chunks level in JavaScriptCore's,
  where it had read them 6-9% slower, the soft hyphens 2 points slower in V8's and the pre-wrap walk 1.5 in
  SpiderMonkey's (2026-10-05); the kind tested first read 1.4-2.9% slower in SpiderMonkey's; and the clause folded into
  the line-start prefix's test of the kind read letter-spaced CJK 2.0% slower in V8's. Part 1 (Engineering, JIT tuning)
  aims code written for speed at what stays true across engines and versions and not at one JIT's heuristics, and lets a
  small split of live code stand where it reads as ordinary code and a comment says why; these are two plain statements
  for one expression, one line of code more, with their comment. So the walker keeps them on that timing (Decisions Log,
  2026-10-08); that reopens when a pinned browser moves, if the same timing then shows no gain or calls a loss, or if
  ten sessions, in two bundles one top-level binding apart, read the two forms level.

  Six restructurings take paragraph tests off a text's path and keep a paragraph's lines (the six together: 0 of 21,251
  inputs of the offline comparison differ in four profiles, and 0 of 200,000 random paragraphs in each of three). Two
  that add no line are in the walker: the hang past an object of width 0 is asked inside the paragraph's test, where it
  stood after every segment a line with content takes, and the walker hands a line's last gap the paragraph's opening
  edges, which the gap's function read off the handle once a line of letter-spaced text. Against the walker without them
  (0f056620 against 4c0ab4ed; foreground, ten sessions a browser of the worst-case rows, 2026-10-08) Chrome lays
  letter-spaced CJK out 2.4% faster, in each of the ten and not called, and Firefox and Safari read the walker's rows
  level. The other four add 17 lines between them: the paragraph's lists read behind one test (10 lines), a run's tests
  under one (3) and a fresh line's two under tests it already makes (3 and 1). Timed with the two above against 6bc6a99f
  (foreground, ten sessions a browser, 2026-10-08), the last three read as a gain in one browser each, none called:
  Firefox's soft hyphens 3.0% faster, and Safari's pre-wrap chunks 2.3% and 3.5%. Timed again the same day against
  4c0ab4ed, ten more sessions a browser, Firefox's gain was gone (0.1% faster, slower in five of the ten) and Safari's
  half there (the walk 2.1% faster, in eight of the ten, and `layout()` level), and the ten lines of the first showed in
  no run. So the four stay out, 17 lines for gains that didn't repeat, and reopen with a timing that calls one.

  Against main at #459 the worst-case rows that run the full walker read (as built, a867ce82 against e699e27e; Chrome
  154.0.8037.98, Firefox 156.0.1, Safari 27.0, foreground, two runs of three sessions a browser, 2026-10-09; Rich Inline
  As One Paragraph, under Speed, has the timing): letter-spaced CJK `layout()` 5.9% faster in Chrome, called, 1.9%
  slower in Firefox, above main in five sessions of six, and 3.2% slower in Safari, in four of six, beside a control
  from 3.7% under base to 4.6% over; pre-wrap chunks' `layout()` and walk 3.0% and 3.2% slower in Safari, above main in
  five and in six sessions of six and each called in one run of two, and within 1.6% in the other two; the soft hyphens'
  `layout()` 3.6% slower in Firefox, in all six sessions and called in one run of two, 1.9% slower in Safari, in all six
  and not called, and 0.3% slower in Chrome; the control characters' `layout()`, a third of whose text the full walker
  lays out in the WebKit profile and next to none in the others, within 1.2% in all three. No worst-case entry is called
  slower over the six sessions.
- **A paragraph's segment breaks, in the Gecko profile**: Gecko transforms segment breaks in each text frame's own text,
  so a paragraph with a line feed had every item cut out of the joined text, transformed and joined again: 8,508 of the
  bench's 14,834 rich items, 199 of which hold a line feed. Cutting out only those, and copying the text between two
  that changed in one piece, SpiderMonkey 156.0.1's shell prepared new rich text 3-6 points faster with the code warm
  and 8 over a fresh page's first 14,000 units (+22.0% to +14.2% against main, twenty sessions, 2026-10-05). It reopens
  if a timing reads the form that cuts every item out within about a percent of this one, where that form, 11 lines of
  code shorter, is taken (Part 1, Engineering, JIT tuning).
- **Two removals from preparing rich text, each of work every engine did** (2026-10-05, timed on the one-paragraph
  design against itself, before main's #435 to #446; neither changes a prediction: with both, 0 of 1,000,000 generated
  paragraphs differ on a stand-in Canvas, in handle, lines or `measureText` calls, 2026-10-06). Collapsing white space
  replaced every lone space by itself; the pattern now matches only a run that collapsing changes, so a text of single
  spaces comes back as it is. Plain text takes that path too: the bench's `seen` rows of Latin, Arabic and mixed
  messages read 1.5-3.9% faster in every one of three foreground sessions in Chrome 154.0.8037.57, Firefox 156.0.1 and
  Safari 27.0. And the WebKit profile's scan takes each item's own text, which is its part of the paragraph's, in place
  of a slice of it (`getWebKitParagraphBreaks()` in `src/analysis.ts`): Safari 27.0 read the `rich-new` row 2.1% faster
  over 25 foreground sessions pooled (1.2% to 2.9%, its control copy 0.7%), and no other profile runs that scan. On the
  `rich-new` row itself, whose floor is 5%, the two read within noise in every browser.
- **Graphemes past dropped characters**: the Gecko profile's grapheme table tests only code points in the rules'
  Control category for what the text run drops; testing every code point made Firefox prepare CJK and Arabic 2-3%
  slower (#368).
- **Fresh-line geometry**, the widths a line that starts inside a segment holding an invisible character takes in
  desktop Chrome and Firefox (`src/entry-geometry.ts`), is observed only for segments of up to 96 graphemes, and an
  empty observation is kept as a found one is: since #368 a segment ending in a long run of controls is a few clusters,
  not one per control, so it falls within that bound, and observing again at every prepare made Firefox prepare the
  invisible tails 6% slower. Under no letter spacing the strings an observation asks Canvas, up to three per line start,
  are widths of the font's segment cache (#453), which often has the first already, one grapheme of the word that its
  cut-word fit measured (a letter with its ZWNJ, a word joiner alone), and which words with the same line start then
  share. Asked at every observation, as before, 418 of the 32,861 `measureText` calls Firefox 156.0.1 makes for
  Chromium's 7,000 interface labels asked a string again, 231 of the 1,236 for Persian's 200 alone and 184 of Telugu's
  1,657, both written with ZWNJ, and 265 of Persian's 1,246 in Chrome 154.0.8037.98; on the harness's own cases 0.04% of
  Firefox's calls and 0.07% of Chrome's, with no prediction changed (counted in the browsers, 2026-10-06). The calls
  saved repeat strings the browser was asked before, and little time goes with them. Persian's new labels read about 6%
  faster in Firefox, 6.1% and 6.6% in two foreground runs and faster in five sessions of six, about what 231 calls cost
  there; Telugu's lean faster, 4.2% and 1.2%, inside what two copies of one build differ by; and in Chrome 154.0.8037.57
  Persian's read 3.5% faster in one run, where German's, with 4 calls fewer of 841, read 3.1% faster (30 rounds a
  language in each run, 2026-10-06). Under a letter spacing the widths are Canvas's own spacing of each string, asked at
  every observation. The harness's texts repeat one in two made-up catalog cases, once each (the Blink profile, offline
  on a stand-in Canvas), and a cache per spacing reopens with text that repeats more.
- **The cursive rule's pretest** (#397): a letter-spaced text is asked once, by a regular expression of the cursive
  scripts' properties, whether it holds a character of a cursive run, and only then takes the script tests per
  grapheme. In Node 23's V8 that expression takes 6-19 ns per UTF-16 unit of CJK text, about ten times a class of
  plain ranges: a warm letter-spaced prepare of 1,140 units of Japanese read 201 µs with it and 180 µs with a class of
  the blocks that hold those scripts in its place, and Latin text and Bun's JavaScriptCore read no difference (the
  stand-in Canvas on a loaded machine, best of 40 rounds, 2026-10-01; hypotheses until a browser shows them). The
  block class wasn't kept: it is a second answer to the same question, there for one engine's regular expressions
  (Part 1, Engineering, JIT tuning), and it missed the punctuation Arabic shares outside those blocks, so `abc`,
  U+204F, `def` took 7 gaps where Chrome 154 gives 6. Reopens if the bench's letter-spaced CJK prepare row shows the
  test.
- **Line-start extras** (#435; Break Opportunities From Engine Data): only a word of 80px or wider whose letters don't
  add up to it has them, and the handle lists them per segment, so a text with one such word carries a list as long as
  its segments. In Chrome 154, 40 of the bench's 278 Latin messages do, and the Arabic book is one text of 37,604
  segments with 23 such words. Built as the lists of fresh-line geometry and of line-start prohibitions were then, by
  `Array.from` over the segments before the first such word and a test and a push for every segment after it (each takes
  a store at its segment's index since #460), the list made Chrome prepare Latin messages it had seen 3.4% slower than
  main, the book 3.5%, keep-all brackets 3.7% and the emoji texts 3.0% (three foreground sessions of a first build,
  2026-10-04). It is made where the first such word is found, at the text's segment count, and filled with null in one
  call. Against the first build those rows read 2.9%, 3.4%, 3.1% and 2.3% faster, where a build that lists nothing, and
  so cuts words otherwise, read 3.2%, 5.1%, 4.9% and 2.5% faster; a loop of pushes read as the fill does, and
  `Array.from` at the full count read the book 5.7% slower than the first build and long breakable runs 5.8%, 8-11 ns
  for each slot. The simple stepper and the full walker read the list where a line starts inside a word, where the first
  build read it for every line and held it through every walk: `measureLineStats()` of mixed messages read 1.5% faster
  and `walkLineRanges()` of pre-wrap chunks 2.2%, which had read 3.2% and 4.6% slower than main. On mixed messages that
  is a read removed for every line. On pre-wrap chunks it is one read for every walk, twelve a pass, so that reading is
  no work saved: the walker holds one local less (JavaScript Engines, State a loop keeps for its rare paths), and a
  second run of that change alone gave neither row a verdict, 1.4% and 2.1% faster. Against main, every `prepare()` row
  on seen text and both of those then read within 1.1% (three background sessions for each figure here but the
  foreground ones, so hypotheses). The foreground bench of the change as it landed gave none of those rows a verdict in
  Chrome 154: seen Latin messages read 0.9% slower than main, the book 0.6%, keep-all brackets 0.5%, the emoji texts
  0.2%, `measureLineStats()` of mixed messages 1.4% and `walkLineRanges()` of pre-wrap chunks 0.9% (three sessions,
  2026-10-05).

#### The Walkers' Shapes

The plain-text walkers are in `src/line-break.ts`: `layout()`'s counter (`countPreparedLines()`), the simple stepper
(`stepPreparedSimpleLineGeometry()`) that the line APIs share with it, and the full walker
(`walkPreparedComplexLines()`) for text the simple ones don't cover. Designs measured and lost, as multiples of main's
time (the PRs hold the per-row tables):
- **One walker for all text**: the full walker costs about 3 times the counter per segment in Chrome and Safari and 5 in
  Firefox, so `layout()` of chat-like messages would take 2-7 times as long (#340, 2026-09-24).
- **A count starting a line's width from its first segment**, not 0: 1.4-1.7 on chat-like messages in Firefox 156
  (#340, 2026-09-23).
- **The full walker stepping one line per call**, redoing its setup each line: 1.07-1.40 on short lines in Chrome 154,
  Firefox 156 and Safari 27 (#359, 2026-09-26).
- **One loop for both walkers**: 1.06-1.10 on chat-like messages in Chrome, 1.18-1.32 in Firefox (#359).
- **One path to admit a whole segment**, to fresh lines and lines with content: 1.03-1.17 in all three (#359), so the
  second path is a copy kept for speed everywhere, not for one JIT.
- **The line APIs stepping text with unbroken boundaries as `layout()` does**, handing the full walker only the lines
  that end at one (before NEL, a C0 or C1 control, or U+2028 or U+2029 where they don't end a line): the same lines, but
  where a line's space overflows the walkers' sums differ in the last bits (99 of 96,470 offline Gecko-profile line
  checks; #350, 2026-09-26). A space before a bidi control was such a boundary in Firefox until #368 gave the control to
  the space's segment (Break Opportunities From Engine Data).
- **The simple stepper continuing a rich-inline line**, while rich inline stepped item by item (Rich Inline Boundaries,
  Continuing The Line): the plain line APIs' stats, walks and streams of mixed text at 1.39-1.64 in Safari, 1.10-1.13 in
  Chrome and 1.06-1.07 in Firefox, so items on fast-path handles continued their lines in the full walker (#369,
  2026-09-27).

Removing the three pieces #357 kept for Chrome's JIT (#364; Decisions Log, 2026-09-26), namely checks in rich inline's
item stepper (below) that changed no result, a redundant `unfitHyphenRetreat` test and the peeled first character of the
segmentation loop, cost Chrome 154 11% on rich stats, 5% on letter-spaced CJK `layout()` and 8-13% on preparing long
breakable runs and pre-wrap chunks, in both sessions; Firefox 156 moved 2% at most, and Safari 27 only on resizing
Arabic to widths it had laid out before (13%, where the bench's control, a second copy of main, moved 5%). All of it was
taken as placement then. Counting the work each piece skips, with each put back as #364 removed it and no Chrome
prediction moving (Chrome 154 and Node 23's V8, all three back in one bench, 2026-09-29), sorts them:
- **Skipped work**: the stepper's line-start test spared the read of an item's segment count on almost every item it
  visited, which #375 took back with that test on the line's first item only (below). Its early return spared the setup
  of the one call per paragraph that found nothing left, 147 of a stats pass's 946 calls and about 0.5% of its time;
  with it back Chrome's rich stats read 0.6% slower, within noise, so it stayed out.
- **Placement**: the `unfitHyphenRetreat` test is never reached on the rows that slowed, whose texts have no soft-hyphen
  contexts, and with it back Chrome laid out letter-spaced CJK 1.6% faster, within noise. The peel spares one compare
  per unit and one regular expression test per text, yet with it back Chrome prepared pre-wrap chunks 11.6% faster and
  long breakable runs 6.1%. Put back as #364 removed it, the peel skips #368's handling of a text that starts with
  characters Firefox drops, a bidi control among them, and moves 9 of Firefox's 43,572 predictions; put back today, it
  would also have to send its first unit through that handling, which is more code than #364 removed. Carrying the last
  segment's kind in a local, as the loop carries `lastAlone`, spares more per unit than the peel and took back only 4.1%
  and 3.4%. Chrome's profiles of pre-wrap chunks put the loop at 11.3ns a unit on main, 8.3 with the peel and 11.0 with
  the local, a gap of about ten compares, and in those of long breakable runs the loop's helpers carry samples of their
  own on main and with the local but almost none with the peel, so V8 likely inlines the peeled loop differently. The
  local is plain and removes real work, and `segmentAtLineBreaks()` now carries it. On its own, in the full bench, Chrome
  prepared long breakable runs 4.2% faster and pre-wrap chunks 1.3%, within noise, in both sessions; the three layout
  rows that read slower in Firefox and Safari run no segmentation and read within noise when run again.

The next paragraphs time the item stepper that laid rich inline out until the one-paragraph design (Rich Inline
Boundaries, Rich Inline As One Paragraph), and stay as the record of what its checks cost.

The stepper's skip of a step that doesn't advance was live code from #369, which ended a line there after content.

After content, the item stepper didn't walk an item whose first segment didn't fit: the full walker there only ended the
line before the item, as the stepper then did itself. Its `firstSegmentOverflows()` repeated the walker's fit for that
segment, a copy a comment in the walker pointed to. That left 6 of the 439 walks in a stats pass over the bench's rich
texts: Chrome 154's rich stats read 18% faster and Firefox 156's 23%, their rich walks and streams 11-13% (2026-09-29).
Testing for a line that starts at an item's end, as after a hard break, only on the line's first item, the one item that
can, instead of on every item it visited, made Chrome's rich stats 9% faster again, within noise in Firefox: that test's
reads were what #364's removed check had skipped. Chrome's rich stats then read 18% faster than main before #340, where
main at #372 read 7% slower. Against main, Safari 27's rich stats read 14% faster, and Chrome's mixed stats, whose code
didn't change (the minified `layout.ts` bundle was the same), 2% slower in two of four runs, accepted as V8's placement
of the changed bundle (#375). From #381 a copy of the library ran Chrome's rich stats at one of two speeds 11% apart
(Evaluation Traps, Timing), and the figure against main before #340 hasn't been timed since.

From #383 a paragraph of one rich item took the text walkers where the item stepper would have laid it out as they lay
out its handle: no `extraWidth`, not atomic, no hard break, and nothing a line start consumes at its start (the
stepper's `onlyItem`, chosen once in `prepareRichInline()`; the one-paragraph design has a field of that name under
another rule). Its line functions took the item's whole fit, which the text walkers lack (ENGINE_FOLLOWUPS.md, Negative
letter spacing and hanging spaces), then walked its handle as `measureLineStats()`, `walkLineRanges()` and
`layoutNextLineRange()` do. Through the item stepper, such a paragraph had counted its lines at about 2.5 times
`measureLineStats()`'s cost in Chrome 154, and 15,256 of the Markdown chat's 17,688 prose blocks over its 10,000
messages are one item. The chat's height pass, `layoutConversation()`, read 25-26% faster in Chrome 154, 23-24% in
Firefox 156.0.1 and 17-22% in Safari 27 (2026-09-29). The results were the item stepper's field by field, on the
stand-in Canvas over 6,267 inputs at 13 widths in all four profiles, and in Chrome, Firefox and webkit-host with every
plain case in white-space: normal predicted as one item. The bench's rich rows, whose paragraphs had an item per word
then, read within noise.

Continuing rich lines in the full walker (#369, 2026-09-27) moved rows whose code didn't change, accepted as each JIT's
placement of the changed bundle (Part 1, Engineering): Chrome 154's letter-spaced CJK `layout()` and pre-wrap chunks
read 1-6% slower, and within noise a day later with the same walker, and Safari 27 streamed the bench's mixed texts
24-31% slower, though 133 of its 134 texts take the unchanged simple stepper. In Safari's own JavaScriptCore, the
system `jsc` shell of its build (22625.1.29.11.27), the extra time sat in that stepper, whose optimized (FTL) machine
code differed between the
builds only in one structure ID loaded in two instructions instead of one, and the same stream run after the other line
operations, as the bench's document runs them, read 7-12% faster than main. Firefox's rich stats are under JavaScript
Engines.

Data shapes: a `Uint8Array` of flags per text made one-word `prepareWithSegments()` a third slower in Node 23's V8 and
rich-inline preparation 12% slower in Chrome 154, so the analysis builds a plain array; slicing segment texts where
measurement reads them, not once in the analysis, made Firefox 156 prepare rich items 11-19% slower (#360, 2026-09-26).
`Array.from({ length }, fn)` cost Chrome 154 5.7% preparing CJK it had measured before, so per-segment arrays that
start at zero are pushed in a loop (`zeros()`), while lists of records or null keep `Array.from`: one helper pushing
both made Node 23's V8 store each zero as a boxed double (#366, #370). A rich paragraph's lists of that kind start as a
copy of one list of zeros (JavaScript Engines, A paragraph's sparse lists made whole). The list of line-start extras, a
null for nearly every segment, is filled in one call (Work Done Only Where A Rule Applies). Overflow trims read in
`countPreparedLines()`'s loop cost Firefox 156 13-26% counting long breakable runs, so `layout()` counts a handle with
overflow trims through the simple stepper, and its line APIs keep the simple walk, without which Chrome 154's line APIs
ran 62-108% slower on CJK messages (#366, 2026-09-27). `measureAnalysis()` keeps its helpers as closures: hoisted, they
measured the same in offline replays of all four profiles the replay runs (Blink, WebKit, Gecko and an unrecognized
engine's) but took 16 more lines, and a hoist lands only if it removes lines and the bench shows a gain, so they weren't
timed (2026-09-26). AGENTS.md's locals rule is for line walkers.

#### JavaScript Engines

Part 1, Engineering, says when an engine fact may shape code. These did, or moved a measurement:
- **V8's inlining budgets and the mark context** (2026-10-08): a run of combining marks after zero-width glue or a
  control is measured after its context, the grapheme before it and what separates the two (Break Opportunities From
  Engine Data), which `getMarkContext()` finds. `measureAnalysis()` asks for one only where a text segment's flags say
  no break comes before it, so every other segment makes no call. Asked of every text segment, where it returned at that
  test, the call cost nothing while V8 inlined it, and that rests on two budgets, both in bytes of bytecode, minified or
  not. One function is inlined at 460 or fewer. All that TurboFan inlines into one function may come to 920: it takes
  the calls in the order of their frequency per byte and leaves one out where the bytes inlined so far plus 1.2 times
  its own pass 920 (`JSInliningHeuristic::Finalize()`, `src/compiler/js-inlining-heuristic.cc:373-384`, with
  `max_inlined_bytecode_size`, `max_inlined_bytecode_size_cumulative` and `reserve_inline_budget_scale_factor`,
  `src/flags/flag-definitions.h:1605-1622`; V8 15.3.76.12, Chromium 153's). On a page of CJK messages main met the
  second by one byte: 471 bytes were inlined when `getMarkContext()`, 374 bytes, had its turn, and 471 + 448 = 919.
  Measuring a rich item in place (Rich Inline Boundaries, Rich Inline As One Paragraph) added 7 bytes to two closures,
  in lines no CJK text runs in the Chromium profile, which made 927, and Chrome 154.0.8037.98 prepared the bench's CJK
  messages again 4.0% slower than main (`seen: cjk seen`, called; 6bc6a99f, ten foreground sessions, 2026-10-07 and 08):
  a call for each of 830 text segments per 1,000 units, where none of the 47,389 text segments of the bench's messages
  has such a boundary. The bytes did it and not the work. The pinned Chrome's own TurboFan, traced in the background
  (`--js-flags=--trace-turbo-inlining`), inlines the call at 919 in every compile of main's copies and passes it over at
  927, as d8 15.4.80 does. Main with one byte more in `getMarkContext()`, 921, read the row 2.5-3.0% slower in three
  foreground runs, in each of their 15 sessions; with two bytes more in a function inlined before it, 921 again, 2.2%
  slower over 13 sessions, in 12 of them, as predicted before the run; and with one byte more there, 920, level over
  ten.

  With the test at the call Chrome prepares the CJK messages again 2.6% faster than without it (107.5 to 104.5 µs per
  1,000 units; 470ee557 against 6bc6a99f, ten foreground sessions, each faster, called; 2026-10-08) and mixed messages
  1.3% faster, in each of the ten; Firefox 156.0.1 reads the CJK messages 1.5% faster, in nine of the ten, and Safari
  27.0 level; no `seen`, `new` or `rich` entry is called slower in any of the three. The test is a read of the flags
  byte the loop holds: it changes no result and skips a call in any engine, inlined or not, so it is work removed and
  not code sized to a budget. Trimming bytes to fit the budget again wasn't taken: with 8 fewer in
  `getFollowingSpaceTail()`, 919 again, the row still read 1.7% and 1.8% slower than main over eight and five sessions,
  on a margin of one byte. Since only a segment no break comes before asks, `getMarkContext()` holds the loop over a
  long chain of marks itself, 505 bytes with it (d8 15.4.80). That loop was a function of its own,
  `getLongMarkChainContext()`, to keep the rest under 460, 374 bytes against 519 (Node 23, V8 12.9; `--print-bytecode`,
  `--trace-turbo-inlining`), which was worth up to 2.6% of Chrome 154's `prepare()` while every text segment made the
  call (#351, 2026-09-26). Two of the bench's documents ask for a context, the soft hyphens with marks for 943 of 7,816
  text segments and the control characters for 32 of 2,477; on the first, V8's shell inlines the function neither apart
  nor folded, and with it folded no `seen`, `new` or worst-case entry is called in any of the three browsers (4c0ab4ed
  against 470ee557, ten foreground sessions a browser, 2026-10-08). Against main at #459 the CJK row then read 0.3% and
  0.7% slower, not called (0f056620, five and three foreground sessions, 2026-10-08), and as built it reads 1.3% slower,
  above main in each of 16 sessions and called in one run of four (Rich Inline As One Paragraph, under Speed): a
  paragraph's lists stored by index came between the two readings, at 0.6-0.8% of Chrome's CJK text prepared again (A
  list made where it is filled, below). The loop reopens as a function of its own if text that asks for a context at
  most of its segments shows the call's cost.
- **JavaScriptCore's type checks**: with a segment's width sum inline in `measureAnalysis()`'s loop, the DFG tier kept
  failing a type check over letter-spaced CJK and never reached FTL, and Safari 27 prepared letter-spaced CJK and
  keep-all CJK brackets 45-59% slower; with the sum in `getTextSegmentWidth()`, 9-10% faster than main (#358,
  2026-09-26).
- **A rarely taken branch inside a loop, in SpiderMonkey**: a loop that holds a call or a nested loop on a path few
  iterations take can run slower for every iteration in Firefox, and doesn't in V8 or JavaScriptCore. The pass that
  cuts a rich-inline line into fragments held, for the segment a line starts or ends inside, a call and a loop over its
  graphemes; 7 of 2,688 lines took it, and with it SpiderMonkey 156.0.1 ran the loop about 3.6 ns a segment slower,
  0.8-1.3 µs per 1,000 units of the bench's rich walk and 22 points of that row in background Firefox. A constant in
  the branch's place gave the time back; only its call, only its loop, or both in a function of their own didn't, and
  no bailout loop and none of five optimizer switches explained it (the shell's `inIon()`, `--ion-pruning=off`,
  `--ion-licm=off`, `--ion-range-analysis=off`, `--ion-scalar-replacement=off`, `--ion-osr=off`; the JIT's source
  wasn't read). Finding those widths before the loop, at most two a line, is also less work, so it isn't code shaped to
  one JIT (2026-10-05; Rich Inline Boundaries, Rich Inline As One Paragraph).
  A loop on a path most iterations take costs the same way: with a loop of bare widths for each fragment inside the
  loop over a line's fragments, SpiderMonkey's shell ran about 100 more instructions a fragment whether the inner loop
  ran or not, and Firefox 156.0.1 walked and streamed text of one segment an item 9% slower (5.1 to 5.6 µs per 1,000
  units of the bench's stress items, every one of six foreground sessions), where Safari 27.0 read 8% faster and
  Chrome 154 3% slower. So that pass's two loops each run over the line's segments, with none inside (2026-10-07;
  Rich Inline As One Paragraph has what that gave up). Reopen on a Firefox that runs a loop no slower for a call or a
  loop compiled inside it.
- **How a width is stored, in SpiderMonkey**: Firefox's full walker is slower over a handle whose whole widths are
  stored as int32 values than over one whose widths are all doubles, once the page has laid out a width that isn't whole
  (on a page of only whole widths integers are the faster: Every width stored as a double, below), and which one a
  handle gets depends on how `measureAnalysis()` ran when it was made. Canvas gives a whole width, as an ideograph's
  16px, as an int32. Main with every whole width stored back as an int32 (`w | 0`) read `measureLineStats()` over the
  bench's CJK messages 4.7% slower than main, `walkLineRanges()` 11.9% and the stream 2.2%; main with every width stored
  back as a double, read out of a `Float64Array`, read the stats 11.9% and 12.3% faster in two runs, `layout()` of CJK
  at widths seen before 12.2% faster and the walk level or 6% faster, with Chrome 154 and webkit-host level on every row
  (background Firefox 156.0.1, three sessions each, 2026-10-05). That reads as: on main the handles the bench's stats
  row walks, the first a page makes, hold int32 widths, and the ones its walk row walks, made once the code is compiled,
  hold doubles. The first build of the one-paragraph rich inline gave `measureAnalysis()` two parameters with default
  values, and every handle then held int32 widths: the CJK stats read 5.2-5.4% slower than main and the walk 10.9-11.8%,
  as did main with only those two parameters added (+5.3%, +11.8%), and that build with its widths stored back as
  doubles read as main does with its own (-10.9%, -0.1%). Handles the defaulted build made were as slow under a second
  copy of main's walker, and main's handles weren't under the defaulted build's; copying the handle or its lists, other
  minified names, and the build's own walker or main's each left it as slow. With both parameters passed by every caller
  the rows read level (-0.2% and +0.6%). Latin and mixed messages, whose widths are fractions, read level throughout, as
  did Chrome 154 and webkit-host. SpiderMonkey 156.0.1's shell shows the int32 cost (+14% and +8% for the same forced
  int32) and not the default values' effect, so why they keep whole widths int32 in the browser wasn't found. A way to
  store a handle's widths as doubles whatever tier made them was built, measured and left out (Every width stored as a
  double, below): on a page that has laid out a width that isn't whole it is worth 12% of a count of CJK lines in
  Firefox, and on a page whose every width is whole it costs Firefox more than that. This entry reopens as that one
  does. The same loss came back when a font's space and hyphen-minus widths were read off its measurement inside
  `measureAnalysis()` (Dead Ends, Fitting, Cuts And Fast Paths, 2026-10-06), and not when only the space's was (Rich
  Inline As One Paragraph, 2026-10-07), so what keeps a whole width an int32 there is how the code around it is typed,
  and default values are one way among others to change that. A third way is a text's lists made by the caller of
  `measureAnalysis()` (A list made where it is filled, below).
- **A list made where it is filled** (2026-10-07 to 09): a text's three lists, its widths, flags and advances, are made
  inside `measureAnalysis()`, the function that fills them, which stores each segment at its index in them and in a rich
  paragraph's, made by its caller (below). A first form of measuring a rich-inline item in place (Rich Inline
  Boundaries, Rich Inline As One Paragraph) had every caller make the lists and pass them in, and cost three engines
  with no work added. Chrome 154.0.8037.98 prepared the bench's pre-wrap chunks 11.3% slower with it, its long breakable
  runs 4.9% and its Arabic book 4.8%, each in all three foreground sessions and called; those are the bench's documents
  of 12, 1 and 1 texts. Of the rows of shorter texts the bench called only `seen: cjk seen`, 2.8% slower, and it called
  that row with the lists made inside too (3.0%), so that one isn't the lists' (V8's inlining budgets and the mark
  context, above, has its cause). Safari 27.0 read the Arabic book 2.8% slower, called. Chrome's and Safari's rows were
  read on builds that also stored each width through a one-cell `Float64Array`, so that every width is a double, a
  change that was measured and left out (Every width stored as a double, below). Without that cell, which the code
  doesn't have, the first form had Firefox 156.0.1 count the bench's CJK lines 4.3% slower and walk them 11.6% slower,
  called in all five foreground sessions: the loss of the entry above. With a text's lists made inside again, and only a
  rich item's passed in, its paragraph's (`ParagraphLists`), Chrome reads the three rows 1.0% faster and 0.7% and 1.3%
  slower, Safari 0.4%, 0.2% and 0.5% slower, all within noise, on builds with that cell, and Firefox without it counts
  and walks those lines within 0.3% over eight sessions.

  V8's part is traced. V8 makes a list from `[]` in its small-integer form until it has a record, kept for that
  `[]`, of what lists made there came to hold, and a function has no such record before it has run about eight
  times, or sooner where a loop of its own runs long (the handler of `CreateEmptyArrayLiteral` without a feedback
  vector, `src/interpreter/interpreter-generator.cc:2645-2672`; `TieringManager::InterruptBudgetFor()`,
  `src/execution/tiering-manager.cc:245-254`, with `invocation_count_for_feedback_allocation`,
  `src/flags/flag-definitions.h:1176`; V8 15.3.76.12, Chromium 153's). Compiled code that pushes anything other than
  a small integer onto such a list fails the check of the push's small-integer branch (`CheckSmi`,
  `IteratingArrayBuiltinReducerAssembler::ReduceArrayPrototypePush()`, `src/compiler/js-call-reducer.cc:1603-1611`),
  the function is deoptimized, and V8 marks that call so that no later compile speculates there
  (`TranslatedState::DoUpdateFeedback()`, `src/deoptimizer/translated-state.cc:2897-2915`): from then on the push is a
  call to the generic builtin (`JSCallReducer::ReduceArrayPrototypePush()`, `src/compiler/js-call-reducer.cc:6573-6578`;
  Maglev's `TryReduceArrayPrototypePush()`, `src/maglev/maglev-graph-builder.cc:10141-10143`), for as long as the page
  lives. `measureAnalysis()` runs a loop a segment long, so where a page's first texts are long V8 compiles it within
  the first few calls, while a function that only makes the lists and calls it has run fewer than eight times and
  still makes them in the small-integer form. A page whose texts are short and all come through one caller never meets
  this: the caller has run hundreds of times before the loop is compiled. d8 15.4.80 on a stand-in Canvas reads the
  three rows 8.3%, 2.9% and 5.7% slower for the first form, 7.6%, 2.7% and 6.3% slower with nothing but the three lists
  moved to the caller, and level once the widths and advances lists are made inside again (-0.3%, +0.4% and +0.4%). Its
  trace shows `measureAnalysis()` deoptimized with "not a Smi" at the push of a width, in Maglev's code, on both
  documents traced, and on the Arabic book at the push of the advances too, in the optimizing compiler's code; where a
  text's lists are made inside it shows neither on these documents. With Maglev off the pre-wrap row reads level, as the
  optimizing compiler then comes after the caller's first calls, and the Arabic book, one text, stays 5-6% slower
  (2026-10-07; 4-8 passes with every library in one realm; a hypothesis, as every shell reading is).

  Why SpiderMonkey keeps whole widths as integers under the first form wasn't found. Background probes of that form
  read Firefox's loss only where the lists were the caller's and the function's whole-text questions were asked of a
  second string than the analysis's; the caller's lists alone read level there, and the second string alone is the
  form that landed.

  A paragraph's lists are made by `prepareRichInline()` and filled by `measureAnalysis()`, whose loop stores each
  segment at its index and pushes nothing: it counts the paragraph's index beside its own, stores a segment's flags,
  width and advances there, and stores what only measured segments have at the segment's place among them. With a loop
  that pushed, one order of a page's texts brought V8's deoptimization to the widths' push: a page that prepares most of
  its text with `prepare()` and a rich paragraph now and then, whose first rich paragraph is short, two items of three
  words each here. `prepareRichInline()` has then not run long enough to have its record when it makes the lists of the
  page's first three paragraphs, and `measureAnalysis()`, compiled again after the first of them, failed at the third
  ("not a Smi" in Maglev's code, "lost precision or NaN" in TurboFan's), and at the push of a null onto the advances
  where only the widths were kept from it ("not a Smi"; 6 of 6 processes in d8 15.4.80). Between the second paragraph
  and the third the order needs enough plain text for V8 to compile the function again and the time that takes in the
  background, 1.5 ms for Maglev's code and 11-14 ms for TurboFan's in d8 15.4.80, which a page whose paragraphs come
  seconds apart always has. Other orders didn't bring it (d8 15.4.80, 2026-10-07, one library a process; hypotheses): a
  first rich paragraph that is longer, five words an item or three items of three words; rich paragraphs one after
  another; a page that sends every message through `prepareRichInline()`, as the chat demo does, since the function then
  has its record before the page's first paragraph of several items; and the bench's chat document read from 120 places
  with its one-item messages through `prepare()`, where a paragraph of several items comes every few messages.

  Chrome 154.0.8037.98 shows the loss (foreground, five sessions a build, 2026-10-07; 0fae7dee, which pushes, and
  051bc249, with the first cure below). In a copy of the bench that isn't checked in, each copy of the library in a
  document prepared 1,000 plain texts and then three such paragraphs, 100 ms and 200 plain texts apart, and the document
  then timed plain text prepared again, against main at #457; a twin document did the same with no paragraph. With
  pushes the bench's long pre-wrap texts read 5.9% slower than main where the twin read 1.4% faster, and its CJK
  messages 8.7% slower against 3.8%, each in all five sessions; its Latin messages read level where the twin read 4.1%
  faster in the three sessions where no copy sat apart (2.6% over all five: in two, that build's own copy ran 7% and 11%
  slower than in the others, on a document that runs no rich code). With no wait between the paragraphs the loss came
  only where the plain texts between them take long enough, on the pre-wrap texts in two sessions of three and not on
  the messages: a hypothesis, read in background Chrome while another process's work shared the machine. d8 reads the
  same on a stand-in Canvas, a hypothesis: alone in a process, the build with pushes left the compiled push at the third
  paragraph in 40 of 48 processes, all but the eight where 200 CJK messages gave TurboFan no time, and then prepared
  plain text 8-10% (pre-wrap), 3-4% (Latin) and 3% (CJK) slower than before; main did in none of 24, and no build in any
  of 96 on a page without paragraphs. The loss is V8's alone: SpiderMonkey's and JavaScriptCore's shells read plain text
  level after that page order (within about 3%, two repeats; hypotheses). The bench has no document with this order
  (ENGINE_FOLLOWUPS.md, Cost).

  The first cure typed each list where `prepareRichInline()` makes it, by a push and a pop of a fraction onto the widths
  and of a null onto the advances, four statements that changed no value. With them each document of that page read as
  its twin (0.4% faster and 0.4% faster, 3.2% slower and 3.8%, 3.4% faster and 4.2%), d8 left the compiled push in none
  of 24 processes, and the bench's rich documents, which are Latin text, read rich text prepared again within 1.3% of
  the build without them (Chrome and Firefox, ten foreground sessions each, none called). What they cost showed on text
  the bench doesn't hold (Safari 27.0, foreground, 2026-10-08): on a fresh page whose every width is a whole number,
  CJK-only text at a whole pixel size in a font with whole advances, the push of a fraction makes every list of a
  several-item paragraph hold doubles, and JavaScriptCore runs the line functions at a faster, integer level only while
  every list they see holds integers (Every width stored as a double, below, has the two levels on plain text). On
  documents that are a page's first and only one, with one copy of the library, a build without the statements was at
  the fast level in 111 of 112 and a build with them in 0 of 103; Chrome and Firefox show one level. JavaScriptCore's
  shell had read the rich line functions level over such paragraphs, within 8% either way over eight pairs of processes
  (2026-10-07), and missed it.

  Three forms were measured against the build with the statements and the build with pushes and without them (0f056620
  and 87d0be76, a local commit made to time it; foreground, five sessions a run, 2026-10-08), each giving the same lines
  (0 of 21,251 inputs of the offline comparison in four profiles; 0 of 200,000 random paragraphs a profile). Stores by
  index (branch `lists-stores`): on that page order Chrome reads plain text prepared again level with the statements
  (0.7% slower, 0.1% faster and level on pre-wrap, CJK and Latin text; its twin 0.9%, 0.4% and 0.5% slower) and 9.2%,
  4.6% and 4.1% faster than pushes; Safari's whole-width first documents are at the fast level in 38 of 38; nothing is
  called slower in any browser. A store by index is compiled with the list's change of form in it and stays compiled:
  V8's record of each store takes the form a list is made in beside the form it comes to hold, and in d8 15.4.80
  `measureAnalysis()` left its compiled code at the third paragraph in 0 of 14 processes with the stores and in 12 of 12
  with pushes (hypotheses). Its cost is a store against a push, on every text: text prepared again reads about 1% slower
  in Safari (0.5-1.3% on Latin, CJK and mixed messages by the two orders of the builds, up to 1.9% in one run, above the
  build with pushes in 120 of 140 readings, 14 `prepare()` entries in ten sessions, and never called), 0.6-0.8% on CJK
  messages in Chrome, most of the 1.3% by which that row reads slower than main as built (V8's inlining budgets and the
  mark context, above), and within 0.7% on the bench's messages in Firefox. The paragraph's lists made inside
  `measureAnalysis()`, where a text's are, from its first measured item's (branch `lists-inside`): Chrome level with the
  statements and Safari at the fast level too, plain text's code untouched, 6 lines of code more than the statements, or
  2 with a concat in place of its loop of unshifts, a form that wasn't timed, and about 1% of rich text prepared again
  in Safari and Chrome (1.5%, 1.1% and 0.7% on the stress, chat and styled documents in Safari, 1.2%, 1.1% and 0.6% in
  Chrome, none called). The four statements kept: not taken, for what they cost Safari.

  The stores are what the code has (Decisions Log, 2026-10-09, a paragraph's lists): the form with the fewest lines,
  four lines of code fewer than the statements, ordinary live code that types nothing. As built against the build with
  the statements (a867ce82 against 0f056620, foreground, 2026-10-09): on that page order Chrome reads plain text
  prepared again within 0.9% of it on the page and on its twin, over five sessions, none of the six entries called; over
  48 fresh pages in Safari, each one document with one copy of the library, the stores are at the fast level in 16 of 16
  documents of the two kinds that tell the builds apart and the statements in 0 of 16. By the two builds' medians over
  their own documents, which is not a paired figure, the mixed page of whole-width CJK rich paragraphs counts its lines
  22.8% faster, walks them 12.5% faster and steps through them 17.3% faster, the same messages as plain text laid out
  after styled rich paragraphs 37.3%, 33.2% and 30.6% faster, and the mixed page is prepared again 10.2% slower, as it
  is without the statements. It reopens if V8 compiles a push inline again after it failed there once, when the stores
  can be pushes again, or if a store's cost in Safari grows past what the bench calls. Against the first form, making a
  text's lists inside `measureAnalysis()` removes no work and is five lines of code more, a parameter that is null for a
  text and three tests of it. What it changed, in a loop that pushed, is which function makes a text's three lists, so
  that V8 typed them from the first push as what they come to hold, and Safari's and Firefox's losses under the first
  form, measured and not traced, went with it. No run has the first form with the stores, so whether a text's lists
  still need to be made inside isn't known: the five lines reopen with that timing.
- **A flag parameter, in JavaScriptCore**: `buildLineTextFromRange()` took a last parameter, true by default, for
  whether its range ends a line, and webkit-host read `layoutWithLines()` over the bench's mixed messages 4.0-4.7%
  slower than main in three runs, for one test a line (JavaScriptCore's shell: +2.9%; V8's and SpiderMonkey's level). As
  two functions, a range's text and a line's, which adds the hyphen, webkit-host read -1.1% and the shell -1.3%
  (2026-10-05). The split is plain and no other engine moved, so it stays whatever JavaScriptCore does later.
- **Captured numbers and loop bounds**: V8 boxes a number a nested function captures (a write 12-14ns in the full
  walker, about 1ns as a local), and JavaScriptCore types an infinite default loop bound as a double (Bun walked
  letter-spaced and pre-wrap text 30-65% slower). Fixing both halved letter-spaced CJK `layout()` in all three browsers
  (#340, 2026-09-24).
- **The 460-byte budget on `getEngineProfile()`**, which the line walkers call for every line: 1,000 times in a stats
  pass over the bench's 134 mixed messages. While it built the profile itself it took 454 bytes with the profile's 23
  fields, 6 under the limit, and 463 with a 24th, a boolean at any position and read by nothing. With that one, Chrome
  154's plain line APIs ran 11-18% slower (mixed stats, walk and stream) and two worst-case `layout()` rows 3-7%, in two
  bench sessions of each of three builds. The bytes did it, not the field. Chrome 154.0.8037.57's V8, traced headless
  (`--js-flags="--trace-turbo-inlining --trace-maglev-inlining"`), inlined the 454-byte function into
  `countPreparedLines()`, the simple stepper and the item stepper that laid rich inline out then (The Walkers' Shapes),
  and refused the 463-byte one ("exceeds bytecode limit"), as Node 23's V8 12.9 did. There, on a stand-in Canvas, the
  463-byte build read 11-18% slower on mixed stats, walk and
  stream and 7-21% on four `layout()` rows (medians of 10 sessions), a 462-byte one with no new field 7-18%, a 24th
  field of a constant value, which adds no bytecode, as main, and the 463-byte one as main with
  `--max-inlined-bytecode-size=470`. So the accessor is a function apart from `buildEngineProfile()`, 21 bytes whatever
  the profile holds, which both of V8's optimizing tiers inline in Chrome 154, into the full walker too (Maglev takes no
  function over 100 bytes, and TurboFan left the 454 bytes a call there), and the Gecko rule for an atomic item of width
  0, which read `paddedOpeningFit` to keep the profile at 23 fields, has a field of its own (`emptyAtomicAlwaysFits`).
  With both, Node read mixed stats, walk and stream 6-8% faster than main and the other rows within 2%. Node's times are
  a lead only; in Chrome 154 the bench read every row of this build within noise of main in three sessions, the line
  rows included, which the field alone had read 11-18% slower (#391, 2026-10-01). No other function inlined then while
  preparing and laying out the bench's mixed and rich texts took over 374 bytes (`getMarkContext()` without its loop
  over a long chain of marks, above).
- **A function of its own in place of the first branch of a long one, in Safari and Chrome** (2026-10-07 and 08): the
  line of a rich paragraph whose only item with segments has no `extraWidth`, one fragment as wide as the line, is built
  by a function of its own, `createOnlyItemLine()`, and not by a first branch of `createLine()`. The split removes no
  work and changes no type or allocation. Timed with it against without, in the foreground, Safari walks and streams the
  chat demo's paragraphs faster, called, and Chrome walks them faster in every session, under the row's floor, while
  Chrome walks the stress items slower and Firefox walks and streams the demo's styled paragraphs slower, none of those
  called. V8's shell inlines the function into the walk's callback and the stream, where `createLine()` is over its
  inlining limit, and JavaScriptCore's top tier inlines it into the walk and not into the stream, which doesn't explain
  the readings (shells on a stand-in Canvas, hypotheses). Part 1, Engineering, allows a small split of live code that
  reads as ordinary code with a comment that says why, and asks that code written for speed aim at what holds across
  engines and versions, which this gain isn't shown to do, so the function stays on its direct timing and not on a
  mechanism (Decisions Log, 2026-10-08; Rich Inline Boundaries, Rich Inline As One Paragraph, has the figures and the
  traces). It reopens when a pinned browser moves, if that timing then shows no gain or calls a loss. What the function
  leaves undone, the reads of the only item's first segment, is work that a branch could leave undone as well and no
  part of the split (the same section has them and what they cost Safari).
- **A paragraph's sparse lists made whole, in place of a push a segment** (2026-10-08): `prepareRichInline()` keeps what
  only some segments have, as line-start prohibitions and extras, a padded item's edges, trims, halts and source units,
  in lists that a paragraph makes only once a segment has a value. Each is made whole there, a zero or a null for every
  segment the paragraph can have, and a segment's value is stored at its index: a list of numbers is a copy of one list
  of zeros (`zeroList()`), a list of objects `new Array(n).fill(null)`, as `measureAnalysis()` makes a text's list of
  line-start extras. Filled a segment at a time, by one function for lists of numbers and of objects that pushed an
  empty value for each segment up to the one stored, preparing the 134 paragraphs of the styled CJK document made 48,235
  pushes, 2.84 a segment, one at a time, and JavaScriptCore stored the number lists as boxed values, since one function
  made lists of numbers, of byte arrays and of lists; a paragraph of CJK text is a segment a character, and nearly every
  one has a list of line-start prohibitions. A list of 127 costs 18 ns copied and 141 ns pushed a zero at a time in V8's
  shell, 44 and 293 in SpiderMonkey's, 59 and 204 in JavaScriptCore's, and 264, 632 and 357 filled that way
  (hypotheses). With the lists made whole against the build that pushed (0f056620; foreground, five sessions a run,
  2026-10-08, on the CJK documents of Rich Inline As One Paragraph, under Speed) Safari 27.0 prepares styled CJK
  paragraphs again 3.3% and 4.3% faster in two runs, faster in each of the ten sessions; Chrome 154.0.8037.98 7.8%
  faster, in each of five and called; Firefox 156.0.1 3.9% faster, in four of five; and nothing is called slower in any
  browser. It is fewer calls and fewer allocations in every engine, so not code shaped to one. A list has room for every
  segment the paragraph can have, the analysis's and a start edge for each padded item, which is more than it has where
  a padded item gets no start edge; nothing reads a list's length. The lists made whole and the one-item line built
  without the item's first segment (Rich Inline Boundaries, Rich Inline As One Paragraph) are three lines of code fewer
  between them. As built, with a paragraph's lists stored by index too (A list made where it is filled, above), every
  input compared gives the lines of the build before the three changes (0f056620): 0 of 21,251 inputs of the offline
  comparison in four profiles, and 0 of 200,000 random paragraphs a profile in a line, a range, a width, a stream or a
  `measureText` call (2026-10-09). Against main at #459 Safari still prepares styled CJK paragraphs again 7.5% slower,
  above main in each of ten sessions and not called (as built, 2026-10-09). Of that, where each segment sits in its
  item's text, kept for every segment, is about 3.7% in JavaScriptCore's shell, by a removal that changes results, and
  the rest has no place found; it reopens with a paragraph that keeps less for every segment.
- **The walker's visitor call, and a count and a whole line without one, measured and left out** (2026-10-08 and 09;
  Decisions Log, 2026-10-09, a loop of its own for the count of lines). `walkPreparedLinesRaw()` walks a handle's lines
  and calls a visitor for each, at one place for text the simple stepper covers. A count of lines runs it with no
  visitor, and `findWholeLine()` (Rich Inline Boundaries, Rich Inline As One Paragraph) runs it at every preparation of
  a rich paragraph with a visitor of its own. Each engine compiles the walker by what has run at that call, and two of
  them pay for preparation's visitor on CJK rich text, which has about twice Latin's lines a unit. Against main at #459,
  whose preparation hands the walker no visitor, Firefox 156.0.1 walks one-item CJK paragraphs 6.1% slower where every
  width is whole, called (3.23 against 3.43 µs per 1,000 units, above main in each of ten sessions), and 3.7% slower
  with ordinary widths, above main in each of ten and not called; Safari 27.0 steps through the lines of the mixed CJK
  page 8.4% slower, above main in each of ten and called in one run of two (3.24 against 3.48; as built, 2026-10-09;
  Rich Inline As One Paragraph, under Speed, has the documents and the timing).

  Firefox inlines no function of more than 140 bytes of bytecode (`smallFunctionMaxBytecodeLength`,
  `js/src/jit/JitOptions.cpp:278`; `TrialInliner::getInliningDecision()`, `js/src/jit/TrialInlining.cpp:785-791`;
  Firefox 156.0.1), so every caller runs the walker's one compiled copy, and it inlines a callee only at a call whose
  inline cache holds that callee alone (`maybeSingleStub()`, `TrialInlining.cpp:165-195`; a call whose inlined callee is
  joined by another is closed to inlining for good, `js/src/jit/BaselineCacheIRCompiler.cpp:2332-2348`). Preparation's
  visitor is at the call before the rich walk's ever arrives, so the walk's visitor is called out of line, once a line,
  about 3.5 ns. SpiderMonkey 156.0.1's shell read the whole-width walk 7-10% slower than main on a stand-in Canvas and
  within 0.4-4% with `--ion-inlining=off`, and a model of the walker with none of the library's code read 2.2 ns a line
  for a second visitor (hypotheses). A page that walks plain text and rich text hands the walker two visitors on main
  too, `walkLineRanges()`'s and the rich walk's; that page isn't timed. JavaScriptCore compiles a function for the
  arguments its calls have brought: preparation's walk hands the full walker a visitor and a stats record, a line
  stepped by `layoutNextRichInlineLineRange()` hands it neither, and while a page stepped through the mixed page jsc's
  log showed 401 exits at `walkPreparedComplexLines()`'s entry, from code compiled while the handles were prepared
  (`--printEachOSRExit=1`, one copy of the library), so the step's calls ran in the baseline tier. It is a level and no
  warm-up: after a count and a walk, as a page orders them, the step's cost stayed flat over 34 s in jsc.

  The cure has two parts. With the whole line stepped from the paragraph's start, preparation makes no visitor: against
  the build with the visitor (0f056620; foreground, five sessions, 2026-10-08), Firefox walked one-item CJK paragraphs
  5.3% faster with whole widths and 3.7% faster with ordinary ones, and Safari stepped through the mixed page 7.3%
  faster, called. Alone it costs Chrome that walk: a page counts lines before it walks any, the count runs the walker
  with no visitor, and V8 compiles a call that has never run as a deoptimization, in a function it inlines too
  (`NoChangeOrSoftDeopt` in `JSCallReducer::ReduceJSCall()`, `src/compiler/js-call-reducer.cc:5164-5174`; V8 15.3.76.12,
  Chromium 153's), which preparation's visitor hides by running the call for every paragraph before any walk. Chrome
  154.0.8037.98 walked one-item CJK paragraphs 9.4% slower with ordinary widths and 13.8% slower with whole ones, the
  second called, with the stepped line alone (five foreground sessions). So the second part gives the count a loop of
  its own with no visitor, and the walker's visitor is then required.

  That loop is the walker's loop over the simple stepper again, and it was built two ways, each giving the same lines (0
  of 21,251 inputs of the offline comparison in four profiles; 0 of 200,000 random paragraphs a profile; the stepped
  whole line the walked one in each of 678,130 paragraphs a profile). With the skip past what a line can't start with in
  a function both loops call (branch `walk-plain-final`; 21 lines of code more than 0f056620, which both are built on),
  against the build with preparation's visitor (0f056620; foreground, five sessions a browser and two runs in Safari,
  2026-10-08, on a battery between 88% and 34% charge): Firefox walks one-item CJK paragraphs 6.8% faster with whole
  widths, called, and 3.7% faster with ordinary ones; Safari steps through the mixed page 7.9% and 7.5% faster, under
  the build with the visitor in each of ten sessions; and Chrome counts 1.8-4.8% slower in 7 of its 12 count entries,
  plain text among them, `lines: mixed stats` 3.3% slower and called. With the skip written out in both loops (branch
  `walk-plain-settle-two-loops`; 24 lines more), the first way reads against it (foreground, five sessions a browser,
  2026-10-08): Chrome counts and walks plain Latin and CJK text 3.8-5.7% slower, all four entries called, 0.02-0.05 µs
  per 1,000 units, and counts one-item CJK rich paragraphs 3.7% and 5.7% slower, in each session; Firefox counts plain
  CJK text 2.0% slower, called; Safari reads the two level. With the builds the other way round, Chrome read the skip
  written out 3.3-5.7% faster on all six plain counts and walks, in every session, and Firefox counted plain CJK text
  2.7% faster with it, called (2026-10-09, on a battery between 72% and 62% charge). Two more ways lost Firefox more,
  against the skip written out (five foreground sessions each, 2026-10-08): a function that moves the cursor too walked
  and counted plain text 7.9-12.7% slower, six entries called, and a count through `normalizePreparedLineStart()`
  counted it 10.2-15.4% slower. So the same change reads several percent faster in two engines and several percent
  slower in the third, on plain text as well as rich, and which engine pays follows how the skip is written.

  Neither way is in the code (Decisions Log, 2026-10-09, a loop of its own for the count of lines): the first, which
  reads as ordinary code, costs Chrome a few percent of counting lines, plain text's too; the second, which Chrome and
  Firefox read faster than the first, writes one rule out twice, which Part 1 (Engineering, JIT tuning) rules out; and
  either adds 21 to 24 lines of code for costs of about 0.2 µs per 1,000 units that only the engines' compile rules
  explain, a regression of the kind Part 1 accepts where it is small, taken here on judgement with its cost noted. It
  reopens when a pinned browser moves, since the cost goes by itself if Firefox inlines a callee at a call with two
  targets or JavaScriptCore keeps the step's calls in its compiled tier; with a way of writing it that is plain and
  costs no engine; or with a real page where walking or stepping through one-item CJK rich paragraphs matters at this
  size.
- **Class fields in Firefox**: with any class field in the bundle, Firefox 156 took 4.5-4.8ms to evaluate it on a fresh
  page, against 1.9-2.2ms with plain objects, or with the fields emptied or set in constructors, seemingly because it
  then compiles the whole bundle up front (the doubling is measured, the cause a guess); V8 and JavaScriptCore didn't
  care (#340, 2026-09-23).
- **Property classes in regular-expression literals** (#407, 2026-10-02). Where V8 and SpiderMonkey parse a literal with
  a `\p{...}` class of a general category or a script, they build the class's set, in a function that never runs too. V8
  builds it again when the script runs and makes the expression, and at the expression's first and second tests;
  `new RegExp()` builds it where it's called; JavaScriptCore builds nothing while it parses. One such literal of
  Pretext's took 10-83 µs to compile in d8 15.4.80, the shell of Chrome 154's V8, and 8-65 µs in SpiderMonkey 156.0.1's
  shell, where a literal of plain ranges, or of binary properties alone (`Emoji`, `Default_Ignorable_Code_Point`), whose
  sets the engines keep, took 2-4 µs. Main held 31 expressions with property classes, 28 literals and three
  `new RegExp()` calls at module scope, and the bench's chat messages test four to ten of them, by engine. So the 16
  that most text never reaches are built at first use (`lazyRegExp()`, `src/line-breaks.ts`): the seven tests behind
  `hasProperty()`, the cursive rule's six, and three that follow a rarer test (a control segment under letter spacing,
  and in the WebKit profile a word that ends in a format character). It costs 6 code lines. In the bench, a fresh page
  then compiled the bundle in 1.33-1.36 ms against 1.72-1.76 in Chrome 154 and in 2.73-2.79 ms against 3.03-3.12 in
  Firefox 156, which also ran it in 0.12 ms against 0.26-0.28: the cursive rule's three `new RegExp()` calls, which
  #397 added, no longer run with the module (with that rule's six alone built at first use, Firefox's run read 0.08 ms).
  Chrome ran it 0.01 ms longer. Safari 27.0 compiled it as before (1.24-1.26 ms against 1.23-1.27) and ran it in
  0.51-0.54 ms against 0.46-0.48, the 16 closures and 13 `String.raw` calls for nothing in return (ordinary strings with
  doubled backslashes read 0.01 ms shorter offline). So a page loads about 0.4 ms sooner in Chrome and 0.45 ms in
  Firefox, and about 0.06 ms later in Safari. The first batches of messages took as long as main's, and every
  `prepare()` row on seen text and on the worst-case shapes read within noise in the three browsers (two sessions, five
  families, against main as of #399). The shells had shown the compile beforehand: offline, the bundle compiled in
  1.27-1.31 ms against 1.73-1.82 in d8 and in 1.07-1.13 ms against 1.40-1.47 in the SpiderMonkey shell, and ran
  0.01-0.04 ms longer in both and in Bun 1.4's JavaScriptCore, whose compile didn't move (a page in a process that had
  loaded the bundle before; medians of 60 pages for each of five families). They missed Firefox's shorter run there,
  since a shell process seems to keep the expressions it has made; a new process showed it (0.49 ms against 0.64). In a
  new process, where nothing has built a set yet, compiling and running it read 2.1 ms against 3.7 in d8, 1.9 against
  2.5 in the SpiderMonkey shell and 1.7 against 1.8 in Bun (medians of 25, 25 and 15 processes). The bench doesn't show
  that case for Chrome: its pages run the bundle in 0.06-0.07 ms, as a d8 process that has loaded it before does (0.03
  ms), where a new one takes 1.3 ms. Offline, `prepare()` read within 1.4% of main on seen and on new Latin, Arabic and
  mixed messages in the three shells, where two copies of main read within 1.6%, and within 1.3% on four of the bench's
  worst-case shapes in d8 and the SpiderMonkey shell (Bun's runs of those were noisier, two copies of main up to 5%
  apart). On letter-spaced Arabic, which the bench has no row for and where the cursive rule's expressions are fetched
  for every character, d8 read 0.6-1.2% slower and Bun under the Blink profile 2.7%. Fifteen literals stay. Six hold
  only binary properties and cost nothing to parse. Four are tested for every segment of ordinary text, so every page
  builds them anyway (`combiningMarkRe`, `numericRunRe`, Gecko's `controlCharacterRe`, WebKit's
  `trailingFormatCharacterRe`): with `numericRunRe` built at first use, Bun prepared seen Latin messages 1.5-3% slower,
  and as main with it a literal. Five are tested for every segment or mark of a worst-case shape, the three of
  `getMarkContext()`'s mark runs and Han kerning's two: with them built at first use too, the keep-all CJK brackets
  shape read 1.5% slower in d8 (0.1-3.3% over 12 processes) and 2.8% in Bun (from 2.0% faster to 4.7% slower over 8),
  which isn't shown free, and they cost a page about 0.07 ms of compile in d8 and 0.04 ms in the SpiderMonkey shell. The
  shells' numbers are hypotheses, on a stand-in Canvas; the browsers' are the bench's, whose tables are in the PR. Since
  #408 the cursive rule reads its runs through the reader of script runs it shares with the kerning with spaces, which
  has seven such classes where the rule had six, built the same way, so 17 are; as literals, the reader's first six had
  cost a fresh page 0.2 ms of compile in Chrome 154's bench (1.75 ms against 1.54, two sessions, 2026-10-02). Since
  #423 the reader looks scripts up in a table and has none, so 10 are. A new expression with such a class that most
  text never reaches goes through `lazyRegExp()`; one tested per segment stays a literal. Reopens if the bench reads
  the worst-case rows level with those five built at first use.
- **A loop slows once a check in it has held**: a check in the counter's loop that handed unbroken-boundary lines to the
  full walker slowed counting all other text up to 1.6 times in Firefox and 1.3 in Chrome, though the check alone cost
  nothing (#350, 2026-09-26).
- **A block that never runs**: from #369, when rich items began to continue their lines in the item stepper that laid
  rich inline out until the one-paragraph design (The Walkers' Shapes), Firefox 156 measured the bench's rich stats
  about 6% slower, and its rich walk and stream about 2%. It wasn't the full walker, as #369 supposed (sending items on
  fast-path handles back to the simple stepper read +0.2%): without the block at the top of the stepper's item loop that
  recorded the break before a continued item, whose body never ran on the bench, rich stats read 4.7% faster, faster
  than before #369 too. None of three plain restructurings took it back (the hang of the spaces before consumed items in
  a function of its own, or left out, and the line's latest break as one record), so it was accepted as a regression one
  JIT alone explains in live code (#370, 2026-09-28; Decisions Log, 2026-09-26, no dead code for one JIT). Once the
  stepper stopped walking items whose first segment didn't fit and tested for a line that starts at an item's end only
  on its first item (The Walkers' Shapes, 2026-09-29), rich stats read 16% faster than before #369, and without the
  block 5% faster still, at the rich row's floor.
- **State a loop keeps for its rare paths**: with pre-wrap added to the item stepper that laid rich inline out then
  (#381; The Walkers' Shapes), Chrome 154 and Firefox 156 read the bench's rich stats, walks and streams of normal white
  space 5-9% slower than main, doing the same work: each stats pass visited 4,246 items, fitted 2,781 whole and walked
  13 in both, in every profile. With main's stepper in the branch, both read within noise. The one pre-wrap check that
  ran on every item, whether the line kept a padded item's opening, then ran only where the line couldn't take the
  item's padding and before a walk, 52 times a pass, which Chrome read within noise of running it on every item. In
  Chrome, with every pre-wrap statement that ran on normal text left out as well (the hang bookkeeping, the retreat
  check before continued items, and the hang at the line's start and end), rich stats still read 7-11% slower, and with
  the line's start, which only the rare pre-wrap paths read, made a constant, 4-5%; main with those three values kept
  alive read 2% slower. So it was how the JITs allocated the bigger loop's state, not work, and it was accepted as a
  regression JIT placement alone explains in live code (#381, 2026-09-29). Chrome's 5-9% on rich stats was the faster of
  two speeds a copy of that build took, 11% apart (Evaluation Traps, Timing), so these figures, two sessions each, hold
  both a variant's cost and the speed its copy took.
- **The names a minifier picks, in Firefox**: Firefox 156 reads one bench row, `resize: latin layout at new widths`,
  about 16% slower or faster by nothing but the names the bench's minifier gives the bundle's top-level bindings. It is
  the one resize text whose lines hold words longer than the line (two rules of 72 hyphens, each 448px in 16px Helvetica
  Neue, against widths of 240-460px), so the one where `countPreparedLines()` runs its grapheme loop. The row first read
  slower on #405, whose code `layout()` never runs. Each build below was timed against main before #394 (29562782), in
  three sessions of Firefox 156.0.1's resize rows (2026-10-02), and every other resize row read within noise in each:

  | Build | Names of the shared top-level bindings | The row, per session |
  | --- | --- | --- |
  | #405's branch before it took #394 to #403 (b9c9d758) | its own | +15.6%, +17.0%, +16.3% |
  | That main plus only the branch's new profile field, read by nothing | main's, all 410 | -3.5%, -0.5%, -4.3% |
  | The branch without that field | others than the branch's | -3.2%, +3.7%, +3.5% |
  | That build plus one unused local in the item stepper | the branch's, all 412 | +13.2%, +12.3%, +17.6% |
  | The whole branch, the field read off the profile at its two uses | 14 differ from the branch's | -0.1%, -0.2%, -1.7% |

  So neither the field nor the rich code does it, and one local that nothing reads does. Main after #394 to #399 read
  the row +15.7%, +17.4% and +21.0% against that same main, and #403 read it -14.7% and -15.2% against main after #399,
  each with every other `layout()` row of Firefox within noise and no change to code `layout()` runs. The reading, from
  SpiderMonkey's source at the 156.0 tag and not from a run of Firefox: the bench bundles both entries into one
  function, whose some 410 top-level bindings are that function's variables; past 24 names a scope orders its variables
  by a hash of their names (`newFunctionScopeData`, `Parser.cpp`), only the first 14 get a fixed slot on the environment
  object, and Warp compiles a read of a fixed slot and of a dynamic one differently
  (`WarpBuilder::build_GetAliasedVar`). `countPreparedLines()` reads four module-level constants in its loop
  (`KIND_BITS`, `TEXT`, `SPACE`, `ZERO_WIDTH_BREAK`); in main's bundle all four fall in dynamic slots, and in the
  branch's `SPACE` falls in a fixed one. Why that would compile a slower loop isn't known, as a fixed slot is one load
  fewer. An app's bundler picks its own names, so the same source can read either way there. So a verdict on this row
  alone says nothing about a change whose code `layout()` doesn't run (`harness/README.md`, Bench). Reopen on a Firefox
  whose scopes give every binding one kind of slot, or if the row moves between two builds whose minified names are the
  same.
- **Firefox's `lines: cjk stats` moved the same way** under a first build of #435, which also changed the Gecko
  profile's fit of a cut word (Dead Ends, Fitting, Cuts And Fast Paths) and gave it no line-start extras. A build of it
  doing main's work in the Gecko profile, with main's `src/line-break.ts` and main's fit of a cut word, so that only the
  bundle differed (five more top-level functions, one more handle field, always null), read `lines: cjk stats` 4.4%
  slower than main in every session, `cjk walk` 3.7% slower, inside its noise, and `resize: latin layout at new widths`
  14.1% faster. The first build read those three 4.4%, 6.7% and 23.8% slower, with main's `src/line-break.ts` alone 4.5%
  and 10.4% slower and 16.4% faster, and with the list read where a line starts inside a word 1.1% and 0.7% slower and
  11.6% faster. So a verdict on `cjk stats` can come from the bundle alone. About `worst: long-breakable-runs layout`,
  the other row that runs the counter's grapheme loop, these runs say nothing either way: one build read it 7.1% slower
  and, timed again, 0.2% faster, its control between 10.2% faster and 13.1% slower (Firefox 156.0.1, three background
  sessions each, 2026-10-04, so hypotheses). The change as it landed keeps that build's ligature rule in the Gecko
  profile and not its kerning. Its foreground bench read `lines: cjk stats` and `resize: latin layout at new widths`
  within noise in Firefox (three sessions, 2026-10-05), and the long breakable runs slower, for a reason of their own
  (below, One whole number among a cut word's advances).
- **Constants written into the built code as numbers** took the names out of that loop, and were declined (#406, closed
  unmerged; Decisions Log, 2026-10-03). With the segment kinds and flag bits as const enums, a bundle holds each use as
  its number, and under two namings the row read alike, -1.1% and -0.3%, where main's two read 16% apart (three sessions
  each against main before #394). What it traded, against main at #405 (162fe261) in Firefox 156.0.1 over a run of three
  sessions and one of two (2026-10-02), per 1,000 UTF-16 units: the four slowest `layout()` and walk rows of the
  worst-case texts (letter-spaced CJK, soft hyphens and marks, pre-wrap twice) read 7-14% faster, 0.4-0.8 µs of 4.2-8.8;
  Latin `layout()` at widths seen before read 10-12% slower, 0.06-0.10 µs of 0.6-0.8; and `layout()` of the controls
  and invisible-tails texts read 17% and 8-9% slower, which the unrelated #409 did to them too (`harness/README.md`,
  Bench). Chrome 154 gave no row a verdict of slower; Safari 27 gave one, over two sessions, read as noise and not run
  again. Offline, the SpiderMonkey shell read the Latin cost as that loop's slower state, picked now by the code and
  not by the names, so numbers end the luck of the names and not the state. The names stay something to know when
  reading a bench table, not something to code around.
- **What a bundle declares, in Safari**: Safari 27.0 read `resize: latin layout at widths seen before` 9-15% slower in
  six of six sessions, three of them of the resize rows alone, for a build of #455 whose `layout()` code and prepared
  handles are main's: the change is in `analyzeText()`, which the row never runs, and the bench's Latin messages hold no
  CR. The same code with one more top-level binding, a counter nothing reads, read the row +4.6%, +1.9% and -4.5%, and
  with its two regular expressions written at their uses in place of two top-level constants, the form that landed,
  +4.3%, -7.5% and +7.1%, each within noise beside a control 0.6-8.6% from base. So that row moves in Safari with what a
  bundle declares, as Firefox's does with its names; why wasn't traced in JavaScriptCore. (Three sessions a build
  against main at #453, foreground, 2026-10-06.) Reopen when the pinned Safari moves, or if the row moves between two
  builds that declare the same top-level bindings.
- **`%` on numbers that aren't whole** is a call: V8 works a remainder out inline only for two positive whole numbers
  and otherwise calls the C library's `fmod` (`MacroAssembler::Float64Mod`, `macro-assembler-arm64.cc:3028-3081`, V8
  15.3). A tab's advance took one, and it was what a tab's arithmetic cost. With the remainder from a division and a
  floor (`getTabAdvance()`, #400), the bench's pre-wrap chunks, three tabs in every six lines, read `layout()` 15%
  faster and `walkLineRanges()` 13-14% in Chrome 154, and 10-11% and 8-10% in Safari 27, than the commit before, in
  every one of five sessions; Firefox 156, whose path has no `%`, read level (2026-10-02). Offline, the d8 shell of
  Chrome 154's V8 (15.4.80) had read both 11-12% faster than main before #395, as fast as with every tab's advance a
  constant, Bun's JavaScriptCore 10-14% and Node 23 16-18% (a stand-in Canvas with Helvetica's advances, medians of
  three to eight processes, 2026-10-01). The call's time also moves with code that does no work. When tab stops began
  to follow each engine (#395), Chrome 154 read that row's `layout()` 5.9% slower than main before it in three
  sessions, with `prepare()` and the walk level and six operations a tab before and after. d8 read the same, and there
  the earlier check for a remainder near 0, put back, read level, the minimum as a constant 0 read 9% slower, and the
  tab function alone took about 3ns or 5.5-7ns a call from one process to the next, with #395's code and with the code
  before it alike. The Gecko profile's path counts in whole app units, with no `%`; rounding its stop and its minimum
  once per handle instead of at every tab read level in Firefox 156.0.1's SpiderMonkey shell, so the handle keeps both
  in pixels. The division's remainder is `fmod`'s to the bit while the stop times the count of stops before the tab is
  exact: always in the WebKit profile, whose stop is eight Canvas spaces, a float, and in the Blink profile without
  letter spacing or under one that is a short binary fraction, such as 0.5px. Under another, such as 0.3px, the width
  of a line with a tab past its third stop can differ in its last bits: by up to 1.1e-13px, in under a tenth of 44,000
  generated lines for each of four such spacings, none of which broke elsewhere.
- **A second array kept by each cut word** (#435, Chrome 154, 2026-10-04): with line-start extras, `layout()` of the
  bench's long breakable runs reads 8.6-10.3% slower than main, where 660 to 1,100 words are cut at each width and the
  counter reads one extra for each line that starts inside one. Part of it is no operation of the counter's. With
  `countPreparedLines()` as on main, which reads no extra, the row read 6.2%, 3.1% and 5.3% slower than main in three
  builds whose cut words keep their extras in an array, listed on the handle or not, and 0.8% with no such array made,
  0.3% with main's fit in the same bundle, and 0.9% with the extras in `Float64Array`s; a second session's runs of four
  of those builds read 3.6% and 5.0% with the array and 0.3% and 0.6% without it or with typed arrays. So 3-6% comes and
  goes with a second ordinary array kept by each cut word, in a loop that does the same work either way, and the rest is
  the read. That the cost is where V8 keeps that array, next to the advances the loop adds up, is an inference from
  those builds, since V8 keeps a typed array's numbers apart from ordinary arrays; nothing of V8's was read or traced
  for it. Typed arrays weren't taken: read by the walkers they made the row 13.4% slower than main, and the only reason
  for them is one engine's heap. Storing each letter's own width in place of the difference, so that a line start reads
  one number and adds nothing, read level in Chrome (+0.1% against the build with differences) and in Firefox 156, whose
  profile has none (4.0% slower than main against 4.6%, inside its control's band), so the handle keeps the difference,
  which holds whatever a segment's advances take later. Three background sessions for each figure but the 10.3%, so
  hypotheses. In the foreground the row read 9.4% slower than main for the Blink profile's fit alone and 9.7% for the
  change as it landed, 4.8%, 10.6% and 10.8% by session, then 7.9% in a second run of the change with #425 in both
  builds, 7.3%, 7.6% and 11.7%, and level in Safari 27, whose profile keeps no extras (three sessions each, 2026-10-05).
  The paragraph has 1,100, 880 and 660 cut words at the row's 240, 300 and 360px in Chrome, and 1,760, 1,320 and 880
  lines that start inside one. Reopens if a foreground run shows either form of the read faster, or with
  `getTextClusters()` (Break Opportunities From Engine Data).
- **One whole number among a cut word's advances, in Firefox** (#435, Firefox 156.0.1, 2026-10-05): with the Gecko
  profile's ligature rule, `layout()` of the bench's long breakable runs read 13.9% slower than main in the foreground,
  13.9%, 14.9% and 5.5% in three sessions, then 8.2% in a second foreground run with #425 in both builds, 7.7%, 7.9% and
  10.3%, and 7.2% and 8.7% in two background runs, where the build with the Blink profile's fit alone, whose Gecko
  profile runs main's code, read level (1.4% faster in the foreground, 0.8% slower and 0.8% faster in the background).
  It isn't work. Main, that build and the change break the paragraph into the same lines, cut the same words (880, 660
  and 440 at the bench's 240, 300 and 360px) and add the same letters in `countPreparedLines()`'s loop (53,966, 45,980
  and 36,960), and their handles differ in one word of 4,205: the paragraph's one ligature in Firefox, the `ff` of a
  link, whose two letters have the advances 9.2333 and 0 where main has 4.7333 and 4.5. The rule writes that 0 as a
  whole number among the word's fractional advances, and with that one number present SpiderMonkey's compiled loop is in
  a slower state, about 7% apart, far more often: 15 of 18 background readings of the row, against 7 of 48 for main and
  1 of 18 for the same build with the zero written as -0. A build that stores every whole-number advance as an integer
  was not slow, so the cost is not an integer's but that of one stray integer among doubles, for a reason not found.
  SpiderMonkey holds the 0 as an integer and -0 as a double: a page can't show how a number is held, and the engine's
  shell can, with `valueAsRawBits()` (2026-10-07; Every width stored as a double, below). The slow state also appears
  with no such number, in a quarter to a third of processes, so three sessions of this row in Firefox are weak evidence
  either way. Two ways out, neither taken: the zero written as -0 removes it, and is a constant chosen for one engine's
  number tags; the advances in typed arrays, which have no tags, remove it in SpiderMonkey's shell and read about 40%
  slower than main in V8's. So it is left as a regression one JIT alone explains, by the rule as it stood on 2026-10-05
  (Part 1, Engineering, JIT tuning). As widened on 2026-10-07 that rule allows a number array made to hold only floats;
  whether the -0 is taken under it is an open question, the maintainer's to decide. The two foreground runs read `worst:
  arabic-book layout` 2.6% and 3.3% slower in every session, and the build with the Blink profile's fit alone had read
  it 3.7% slower with main's code in the Gecko profile, so that row isn't the ligature rule's; it wasn't traced. Reopens
  with `getTextClusters()` in Firefox, which would take the rule's place, if typed arrays are taken for another reason,
  or if cut words in real text show the cost.
- **Every width stored as a double, measured and left out** (2026-10-07; Decisions Log, 2026-10-07, a handle's widths).
  A JavaScript engine holds a number as a small integer or as a double, a 64-bit float, and Canvas hands back a whole
  width, as a 16px ideograph's 16, as an integer (Firefox's `JS::Value::setNumber()`, `js/public/Value.h:676-684`).
  Three lines in `src/prepare.ts` that passed each width through a one-cell `Float64Array` on its way into the handle's
  `widths` changed no value and made every engine store a double (a local branch, not pushed, against main at #455).
  Doubles are not faster than small integers: in SpiderMonkey and JavaScriptCore, line walkers that have laid out only
  integers are the fastest, and what main pays is integers read by walkers already compiled for doubles. On macOS a
  letter, a digit or a space usually measures a fraction, walkers that have laid such text out are compiled for doubles,
  and SpiderMonkey's code then unboxes a double inline and converts an integer out of line (`visitUnboxFloatingPoint()`,
  `js/src/jit/CodeGenerator.cpp:17830-17854`, Firefox 156.0.1).

  In the browsers, in the foreground (2026-10-07): with the change, on a page that has laid out a width that isn't
  whole, Firefox 156.0.1 counted the lines of the bench's CJK messages (`lines: cjk stats`) 12.2% faster over eight
  sessions, by the bench's verdict, and no row of the bench read slower by its verdict in Firefox, Chrome 154.0.8037.98
  (eight sessions too; in both browsers the `rich` row ran in three of the eight) or Safari 27.0 (five of every row). On
  a page whose every width is whole, the same messages cut down to the characters 16px PingFang TC draws a whole number
  of pixels wide (three probe documents on a second local branch, not pushed; the bench has none), Firefox read
  `measureLineStats()`, `walkLineRanges()` and `layoutNextLineRange()` 39-40% slower and `layout()` 19-22% slower, each
  a verdict of slower over five sessions, and Chrome read the page level. Safari ran those three line functions at one
  of two speeds there, 26-31% apart: main's two copies at the faster in 4 of their 10 readings over five sessions and
  the change's copy at the slower in all 5, which five sessions would do by chance about one time in thirteen, so the
  bench gave no verdict.

  In the engines' shells, each JavaScript engine run alone over a stand-in Canvas, so hypotheses (2026-10-07):
  SpiderMonkey 156.0.1's read `measureLineStats()` over the whole-width messages at 2.31 µs per 1,000 units on integers
  alone, 3.2 on the same widths as doubles, and 3.58 on the integers once Latin text had been laid out too.
  JavaScriptCore's (the system `jsc`) read the three line functions 31-34% slower on doubles by the medians of three
  processes, slower in each; V8's (d8 15.4.80), which stores doubles on main too once a font's space is a fraction, read
  doubles level or a little faster. Latin text in a fixed-pitch font whose advance is exactly 0.6 em, whole at 10, 15
  and 20px, was timed in shells only: SpiderMonkey's read its line functions 13-21% slower on doubles.

  Text of only whole widths is real: 519 of the real-usage sample's 11,901 draws are Chinese or Japanese text of only
  ideographs, kana, CJK punctuation and fullwidth forms, at a whole font size, and every line Firefox recorded for them
  is as wide as its number of characters times that size. Only macOS was measured: Firefox rounds glyph advances to
  whole pixels on Linux under full hinting and on Windows with ClearType off (`gfx/thebes/gfxFT2FontBase.cpp:616-636`,
  `gfxDWriteFonts.cpp:376-384`; read, not run), where every page would be a page of only whole widths. Two other forms
  were not taken. A variant that used the one-cell array only once the page had stored a fraction, kept on no branch,
  read the page of only whole widths level in Firefox and the bench's CJK line count 5.7% faster, in one foreground run
  of five sessions; it was left out because code keyed on whether the page has stored a fraction follows one engine's
  state, not the text. `widths` as a `Float64Array` (Firefox 156.0.1 and Chrome 154.0.8037.98, 2026-10-06, local
  branches off main at #447) read Firefox's line functions over CJK and mixed text 29-43% faster and Chrome's CJK
  `layout()` 13-16% slower, the same way in every foreground session: a trade between engines, which the maintainer
  dropped that day and which reopens if Chrome stops paying. The handle's other number lists that hold integers beside
  fractions (`lineEndTrims`, `discretionaryHyphenContexts`, a cut word's advances) were not touched.
- **Firefox's `rich: latin rich-new` read slower in one run, for no work found** (#435, Firefox 156.0.1, 2026-10-05):
  the second foreground run of the cut-word change, with #425 in both builds, read the row 13.6% slower than main in
  every session (13.8%, 11.8% and 15.6%; 520 µs per 1,000 units for 460), where the first run had read it level (0.0%,
  +3.7% and -6.8%). It isn't Canvas work: over the row's 42 batches the Gecko profile makes 4,270 `measureText` calls
  for main's 4,243, 0.6% more, with 0.2% more units and the same lines, counted in a background window, and the builds
  before #425 count the same. Run alone in the foreground, the row read 10.4% slower over three sessions, with main's
  second copy up to 23.5% from main, and 3.3% slower over six, from 3.0% faster to 23.8% slower, both within noise. A
  reading of this row is one batch of about half a millisecond on a timer that steps by 0.02 ms, about 4% a step, and in
  a round each build reads a batch of its own, since the text has to be new to it. So the row isn't attributed to the
  change, and what it read wasn't traced. Reopens if the row reads slower again in a full run, or in a build that
  differs from main only in the Gecko profile's ligature rule.
- **Inline caches**: once `layout()` has stepped such text, Chrome's `walkLineRanges()` of simple text, sharing the
  simple stepper, takes 2-4% longer than a second copy of main, by a mechanism not found. V8's caches turn polymorphic
  over the two handle kinds (`--log-ic`), but one shape for both didn't help Chrome and cost Firefox up to 14%; a
  private 77-line stepper copy is the only cure measured, not taken (#350; Dead Ends, Simplifications Held Back).
- **Lookups**: SpiderMonkey charges 44-48ns a `Map.get` of a short key, even on the same string, and a lookup in front
  of a loop costs its latency, 23-50ns for a `get` that costs 11ns alone (the rebuild, September 2026); V8's is under
  String Storage.
- **Smaller costs**: a per-word regex in `prepare()` took 1.5% of a cold `prepare()` in V8 (#248), and spreading a typed
  array into `String.fromCharCode` 8.7µs a message in SpiderMonkey.
- **Measuring**: Bun overstates memory savings, since JavaScriptCore stores array entries at twice V8's size, and two
  identical builds in one page differ by 2-3% in JavaScriptCore (webkit-host, the rebuild, 2026-09-20;
  `rebuild/research/PERF-JS-PROFILE.md`).

#### String Storage

In Chrome a Latin-1 string's storage decides how Canvas shapes it: Blink shapes a one-byte string as one Latin segment
and runs its script segmenter over a two-byte one (`harfbuzz_shaper.cc:1072-1101`), so in 48px Amiri `)` × 15 is
183.60px one-byte and 329.76px two-byte; letters and digits measure the same. V8 keeps a string one-byte when every unit
is at most U+00FF and it was built so (parser text, literals, `JSON.parse`, their concatenations); a slice of 13 units
or more from a string holding a unit above U+00FF stays two-byte, and shorter ones are copied into one byte. Neither a
page nor an offline replay can see or choose storage. A `Map` key's internalized copy is one-byte, if its units fit,
only when that lookup first hashes the string (`known_one_byte_content`, `string-table.cc:411-421`), and
`getSegmentMetrics()`'s lookup is the first for a segment cut from a longer text, which is a new string, so such a
Latin-1 segment reaches Canvas one-byte and measures as Latin. A text that is one segment is the caller's own string,
since a slice of a whole string is that string, and so is a rich item that is one segment holding all of its text (Rich
Inline As One Paragraph). It reaches Canvas one-byte the same way unless something hashed it before without
internalizing it: in d8 15.4.80 a two-byte string of Latin-1 units that a `RegExp` was made from (`new RegExp(s)`,
`match(s)`, `search(s)`), or that was `eval`'s source, stays two-byte through the lookup, and a new slice of the same
units then finds that copy and is two-byte too; the 26 other uses tried, property, `Set` and `Map` lookups among them,
leave it one-byte (2026-10-07; the Canvas width wasn't probed). Chrome's page paints a script-neutral run as Latin after
Latin and in all-Latin-1 text, but not after Arabic or Han, or between em dashes with no letter around: Blink gives the
run the script before it, and only at the paragraph start the script after it (`script_run_iterator.cc:503-516`;
ENGINE_FOLLOWUPS.md). (Chrome 153 and 154, 2026-09-18 to 09-27.)

Rejected (2026-09-27, #367): keying the caches by another string, so Canvas gets each slice as it was built. It moved
none of 41,788 Chrome predictions, since it changes only runs of 13 units or more cut from such text, and of 18 fonts
probed only Amiri and Noto Naskh Arabic measure the storages differently; there it fixed every such run after Arabic,
Han or an em dash and broke every one after Latin in text also holding an emoji or `ā`, since storage follows a slice's
length and source while the page follows the text before the run. It also costs a string per lookup,
and a canvas answers the same characters in either storage as it shaped them first (Engine Facts, Chrome). In the
rebuild, a text-keyed lookup before each Canvas call moved 254 of 380 predictions in a set built to catch it (Chrome
153, September 2026).

### Scrolling And Scrollbars

The demos' scrolling rules (Part 1, Demos And The Chat) rest on these facts; `pages/demos/markdown-chat.md` has the
app-facing patterns. Unless stated: macOS 26, Chrome 153, Safari 26.5.2 and Firefox 155, 2026-09-15.

#### Scroll Position

- iOS Safari reports `scrollTop` past either end while rubber-banding, so the chat's clamped writes every frame jittered
  the bounce until #331 made it write only when layout moved the anchor (2026-09-16, on a real iPhone).
- Firefox reads `scrollTop` back through float32 at large scroll heights, so a target and its read-back differ, which
  cost a redundant `scrollTo()` every frame at the end. Adding each frame's height change to the rounded `scrollTop`
  drifted 3-4.25px over a 15-step resize in Safari and headless Chrome; the anchor's on-screen offset from when it was
  picked doesn't drift. A viewport shorter than the last item makes that item the anchor, or a prepend jumped about
  1,180px. A stand-in for "layout moved the anchor", such as "the width changed", misses height changes.
- On macOS a trackpad fling reaches the page as wheel events, so a `scrollTo()` after content loads above moves only its
  start; on iOS the fling is the system's, and a `scrollTo()` may stop or jump it (unchecked on a device). Safari's
  wheel scrolling after `scrollTo()` is in PLATFORM_BUGS.md.

#### Scroll Height

Chrome and Safari cap an element near 33.5 million px, 2^31 of their 1/64 px layout units (Blink's `LayoutUnit`, 6
fraction bits in an `int32_t`, `layout_unit.h:473`), and Firefox near 17.9 million, 2^30 of its 1/60 px app units
(`nscoord_MAX`, `nsCoord.h:28`): limits of engine coordinate storage, read in source, not measured. iOS Safari can crash
above about 500,000px while the scrollbar is dragged (Scrolling.md; unmeasured here). The Markdown chat with 10,000
messages is 1.0-1.8 million px tall. Unbuilt fixes for the cap that don't load the history in chunks: scrolling owned in
JavaScript, which Scrolling.md advises against; a scroll area a few screens tall with content shifted near its edges;
lossy scaled scrolling. Without `<!DOCTYPE html>`, quirks mode made `documentElement.clientHeight` the document's
height, so the masonry demo mounted every item and crashed iOS Safari (ffc2a757, 2026-03-23).

#### Classic Scrollbars

Classic scrollbars shift content whenever a box starts or stops overflowing, for any reason, or a showing scrollbar's
thickness changes (a live overlay-to-classic switch, `scrollbar-width`, a sized `::-webkit-scrollbar`, which also forces
classic scrollbars in Chrome on a Mac that hides them); hover never does. No window `resize` fires; `visualViewport`'s
and ResizeObserver's do. They're common: macOS on "Always", or "Automatically" with a mouse without gestures, which
switches live; Chrome on Windows and Linux; Firefox on Windows 10, or 11 with "Always show scrollbars". Only
`scrollbar-width: none` or a fixed `::-webkit-scrollbar` width avoids a live switch's nudge, accepted as rare. Tested
only with forced classic scrollbars on macOS.

With `html { scrollbar-gutter: stable }`, Chrome's `documentElement.clientWidth` reports the full width until a
scrollbar is drawn (1200 against the body's 1185), hence `document.body.clientWidth`, read as ui.md, Layout, says. A
stable gutter off-centers content by half its width (`both-edges` centers it for another 15px of width), and breakpoints
live in the model, since `@media` widths and `100vw` count the scrollbar and `clientWidth` doesn't.
`html { overflow-y: scroll }` was dropped for painting an empty track on short pages.

Measuring the scrollbar (Safari 27 on macOS 27, 2026-09-16): a hidden probe element reads 0 in Safari 27 where the real
scrollbar is 13px, and in Firefox one stayed 0 after a live switch while real scrollers went to 15px. Safari's stable
gutter sets nothing aside for a `::-webkit-scrollbar` width, and Safari 27, like Chrome, ignores `::-webkit-scrollbar`
once `scrollbar-width` or `scrollbar-color` isn't `auto`. Since Chrome 145, macOS Chrome rubber-bands inner scrollers
too. Force classic scrollbars in a probe with Chrome's `-AppleShowScrollBars Always` (that process only) or a fresh
Firefox profile with `ui.useOverlayScrollbars = 0`; an injected `::-webkit-scrollbar` behaves unlike real ones.

### Line Clamp And Ellipsis

The ellipsis demo (`pages/demos/ellipsis.html`) ends a paragraph clamped to a number of lines the way browsers end a
`-webkit-line-clamp` box, from the public API alone. The sweeps behind the numbers here are in #410's description
(Chrome 154.0.8037.57, Firefox 156.0.1 and webkit-host, 2026-10-02).

**What browsers do.** The clamped line breaks where it would without the clamp. If the ellipsis fits after it, it goes
there; if not, the engine drops characters from the line's end until it fits, inside a word if need be, without shaping
the word again. Blink walks the line's items from its end and cuts the one that crosses the box's width less the
ellipsis's at the shaped text's own offsets, and the line's first item keeps one character whatever the room
(`LineTruncator::TruncateLine`, `EllipsizeChild`, `TruncateChild`, `line_truncator.cc:218-615`, Chromium 153). WebKit
does the same over its display boxes (`truncateOverflowingDisplayBoxes`, `trailingEllipsisVisualRectAfterTruncation`,
`InlineDisplayLineBuilder.cpp:238-351`, webkit-7625.1.29.11.27). In Gecko the ellipsis is a `text-overflow` marker, and
the text is clipped by character to the line less the marker, in painting only (`TextOverflow::ProcessLine`,
`TextOverflow.cpp:676-751`, Firefox 156.0). The ellipsis is U+2026 in the block's first font where that font has one,
else three periods (`ComputeEllipsisText`, `line_truncator.cc:96-106`; `MakeEllipsisTextRun`, `gfxTextRun.cpp:3070-3089`).
A line that mixes directions is cut at its end as painted, and in `pre-wrap` a space that ends the line stays before
the ellipsis.

**Where the demo differs.** Over five paragraphs at every width from 120 to 440px and 1 to 5 lines, the line count, the
height and whether the box is truncated were the browser's in all 8,025 layouts in each browser. The last line's text
differed in 306 of 5,924 truncated layouts in Chrome, 302 of 5,644 in Firefox and 3 of 5,934 in webkit-host. Nearly all
are cuts inside an Arabic word, where Chrome and Firefox show one to three more letters: a handle's widths inside a word
are those of the word broken across lines, each piece measured as the engine shapes it after a break (Widths After A
Line Break), and a clamp cuts the shaped word where its letters sit. In Latin the same shows at the size of a kerning
pair, in 4 of 3,928 layouts in Chrome. Browsers cut a line that mixes directions at its end as painted, which Pretext,
keeping no visual order, can't name: a left-to-right paragraph with Arabic and Hebrew phrases agreed on 714 of 886
layouts. In `pre-wrap` the browser keeps a space before the ellipsis that the demo, written for normal white space,
drops.

**Tried and dropped.** Measuring each candidate start of the last line again, as a rich-inline paragraph that ends with
the ellipsis, was right on 254 of 351 Arabic cuts in Chrome against the line stream's 91, but prepares text on every
change of width, which README tells apps not to do.

**Reading the cut.** No DOM API gives Firefox's cut, which exists only in painting. A probe painted the box into a
canvas through an SVG `foreignObject` image and found the ellipsis by the clamped line's last inked column; that reading
matched Chrome's DOM, which shows the cut as a second box, on all 5,742 truncated lines without an emoji. Chrome and
Firefox draw emoji at another width inside an SVG image, so a line with an emoji can't be read that way.

Letter positions inside a shaped word, which Canvas gives only through `getTextClusters()`, would reopen the Arabic
difference, and a visual order the mixed directions. The call the demo had to work around is on TODO.md's list for the
API discussion (TODO.md, End of project).

### Engine Facts

What one engine does that no topic above takes. Source lines are Blink at Chrome 153.0.8010.48 (.50 is the same source),
WebKit at Safari 27.0's 7625.1.29.11.27 and Gecko at Firefox 156.0 (156.0.1's recordings match). Most were found while
building the per-engine rebuild (`rebuild/` on branch `rebuild-20260916`): a from-scratch, unshipped port of each
engine's line breaking over Canvas, kept as the plain-text correctness reference and tested in its own harness. Fuller
numbers are in `rebuild/DESIGN.md` and `rebuild/research/` on that branch, pages for unfiled bugs in
`rebuild/platform-bugs/pages/`. webkit-host is the system WebKit that installed Safari runs, driven from a background
app (harness/README.md, Browsers and pins). "Main before #340" is commit 6d1d2106, before #340 (2026-09-24) replaced
Pretext's own break rules with ports of the engines' scans and tables. A new build can move any of it (`bun harness
repin` shows what), and a fact read in source needs reading again.

#### Chrome (Blink)

- **Canvas totals and font sizes.** `measureText()` is a float32 total of Blink's 16.16 sums, exact only below 256
  zoomed px (128 CSS px at DPR 2), while layout's glyph positions are exact. Whole zoomed sizes stay exact in 2048-unit
  fonts (SF, Arial, Times New Roman), not surely in Helvetica Neue's 1000, and negative spacing that pulls a total under
  256 px doesn't make it exact. Sizes floor to 1/100 zoomed px in float32 (`font_description.cc:271-282`): 16.8px is
  16.79 px in Canvas, 33.59 zoomed px in the DOM. (Chrome 153, 2026-09-16 to 09-23.)
- **The shape cache** (Chromium #560614560, PLATFORM_BUGS.md) keys text by characters and direction only
  (`frame_shape_cache.cc:45-65, 135-149`), so the storage a canvas shaped first answers both (Keeping Work Bounded,
  String Storage). It's bounded (`:12-16, 93-104`), but OffscreenCanvas never gets the frame-end trim: past the bound,
  kept paragraphs laid out 1.24-1.33× slower. 185 of the Chrome predictions main before #340 made, all in Amiri, moved
  between fresh runs, so those passes were page history: results that depend on what the page measured or laid out
  before, which the paragraph alone can't predict. Hence AGENTS.md's one kept context. (Chrome 153, 2026-09-12 and
  09-17.)
- **`system-ui`.** The font cache key holds the zoomed size, `opsz` the specified size (`font_description.cc:308-331`,
  `font_platform_data_mac.mm:170-178`): a width depends on whether the DOM or a Canvas made the font first, and a
  context at `text-rendering: auto` shares the page's key, so measuring can move page text (PLATFORM_BUGS.md).
  `optimizeLegibility`, which Chrome's own measuring uses, keeps a context apart; main keeps `auto` (#336). (Chrome 153,
  2026-09-16 to 09-18.)
- **HanKerning.** Canvas halts a pair (applies the OpenType `halt` feature, which trims CJK punctuation to half width)
  only inside one Canvas word and cuts around each CJK character (16px Hiragino Sans `「」「」「」`: 96 px, 80 painted), so
  the Chromium profile adds Blink's halts (`src/han-kerning.ts`) for 18 calls a font plus 2 per distinct trimmed
  character. Blink also narrows CJK punctuation where the script changes inside a shaping call (a `}` pairing with a `{`
  after Latin resolves as Latin, halting the `。` before it): the rebuild has this (1f380af7), the profile doesn't.
  Chrome 153, unlike 152, halves a closing mark that doesn't fit at a line end. (Chrome 153, 2026-09-17 to 09-26.)
- **How Canvas shapes.** Word by word (`plain_text_node.cc:84-155`), cut at U+0020, TAB, ZWSP and around CJK ideographs
  and symbols, so kerning against spaces is lost (Times New Roman `AV To We. V, A Y o`: 262.45 px, DOM 254.23): the
  source says a string must draw as its words drawn apart, for Google Docs (`plain_text_node.cc:365-376`).
  `optimizeLegibility` shapes whole strings only where GPOS or GSUB lookups involve the space glyph, and
  `fontKerning = 'normal'` only where GPOS ones do (`font_fallback_list.cc:264-277`, `harfbuzz_face.cc:341-385`):
  Arial, Times New Roman, PingFang, not Georgia, Helvetica Neue, Verdana (Dead Ends, Kerning). U+2028 for each U+0020
  keeps a string whole, legacy `kern` fonts included, but makes it two-byte and takes no word spacing; the Chromium
  profile reads kerning with spaces through it (Kerning At Line Edges). Canvas shapes each ICU level run in its own
  direction, the DOM a group in one; a two-byte RTL group in U+202E … U+202C is one level run. U+FFFC becomes U+200B
  (`character.h:167-175`): zero where the DOM draws a 1 em fallback glyph. (Chrome 153, 2026-09-16 to 09-23.)
- **Letter spacing and tabs.** Blink spaces cursive-script runs only at spaces (`shape_result.cc:977-990`,
  `shape_result_spacing.cc:103-131`), spaces a glyph cluster once, and turns off liga, clig and calt under any spacing
  (`font_features.cc:54-86`). The run is the shaping run's script, so digits, brackets and punctuation after Arabic, or
  before it at the start of the text, take none either, and a closing bracket goes back to its opening bracket's run
  (`script_run_iterator.cc`): of an Arabic word, a space and `123.`, only the space is spaced. The rule sits behind the
  runtime flag `IgnoreLetterSpacingInCursiveScripts` and came in two steps. Before Chrome 138 every letter is spaced;
  from 138 to 148 a cursive run takes no letter spacing at all, its spaces included; from 149 its spaces and no-break
  spaces are spaced, the rule above. The first step's code is in 137 (Chromium 77ab8bb837), where Chrome's release notes
  list it, but release tags 137.0.7151.55 and .119 have the flag experimental and 138.0.7204.49 stable (97e135f47a); the
  second is 65df445712 (Chromium #473579852), in tag 149.0.7827.0 and not in 148.0.7778.288 (the tags' source, read
  2026-10-01; what the profile gets wrong on the older two is in ENGINE_FOLLOWUPS.md, Letter spacing). The Blink profile
  follows a reduced port of that iterator (#397, `readScriptRuns()` in `src/prepare.ts`, which the kerning with spaces
  reads too since #408; Kerning At Line Edges): in Chrome 154 it gives 64 probe strings Chrome's gaps, and the
  real-usage sample's 8 failing Arabic and Urdu paragraphs under letter spacing pass (2026-09-30 and 10-01). A Common
  character right before a mark that has script extensions takes the mark's scripts (`FetchNextCharacter`, `:624-635`),
  whose lowest code leads: `1` under the Arabic vowel sign U+064B starts an Arabic run among Latin letters, and under
  U+0303, which Latin, Syriac and three more scripts share, it leaves an Arabic run and stays in a Syriac one; the port
  follows all but the last. A wide opening bracket under such a mark has the mark's scripts before its width is asked,
  so it isn't made Han (`Fetch` runs before `OpenBracket`, `:334-338`, `:431-441`). A space takes a mark's scripts as a
  digit does: `a`, a space under U+064B, a space and `12` take 3 gaps in Chrome 154, the digits in the Arabic run, and
  an Arabic word, a space under U+0301, a space and `12` take 4, the digits out of it. Since #408 the port reads the
  runs over the whole text and gives 3 and 5, the fifth a gap the walkers charge a mark after a space
  (ENGINE_FOLLOWUPS.md, Letter spacing); while it was fed a text's segments, which hold no space, it gave 6 and 2
  (2026-10-02). A character several scripts share starts a run that holds them all, the lowest code leading, Latin aside
  for a Common character, which the next character with a script narrows, and it stays in a run of any of them
  (`GetScripts`, `MergeSets`, `script_run_iterator.cc:118-215`, `:491-565`); a Common character that only one script
  lists, as Han does the parenthesized and circled ideographs, stays in whatever run it is in, and so it does in the
  port since #426, which had given it that script: an Arabic word, U+3231, a space and `12` take 1 gap where the port
  gave 4, and the space in `㈱ All` kerns with `A` (Chrome 154, 2026-10-03). The port gives a character that several
  scripts share its leading script wherever it stands and
  leaves the rest out: U+202F, which Latin, Mongolian and Phags-pa share, takes no gap alone, after Arabic or between
  Han characters, and one among Latin letters, and its Mongolian run takes in the digits around it, so `10`, U+202F,
  `000` in a text of its own takes none of its 6 gaps (Chrome 154, 2026-10-01; ENGINE_FOLLOWUPS.md, Letter spacing).
  Brackets pair as ICU pairs them (`GetPairedBracket`, `:217-219`), so U+232A closes U+2329 and not U+3008, and a
  bracket under a mark that scripts list is opened or closed all the same: `〈`, an Arabic word and U+232A take 1 gap,
  and `ab (`, an Arabic word, `)` under U+064B, a space and `12` take 8, in Chrome 154 and, since #423, in the port,
  which gave 2 and 5 while it paired brackets from a list of its own that read U+2329 and U+232A as U+3008 and U+3009,
  and read no bracket under such a mark (2026-10-03; Part 1, Tables Against Canvas). A
  tab stop is eight Canvas spaces plus letter and word spacing (`font.cc:303-317`), rounded up to 1/128 px at DPR 2
  (`simple_font_data.cc:225-240`), and a tab skips a stop under half a space away (`font.cc:333-337`). The spacing is in
  a stop only under the runtime flag `TabSizeWithSpacing` (`TabSize::GetPixelSize`, `tab_size.h:24-33`), on by default
  since Chromium 140 (Chromium commit 74fb9bb2, 2025-07-11) and no longer a flag from 155 (c8a9ba0b): a Chromium before
  140, or an embedder with the flag off, puts a stop every eight plain spaces, which the Blink profile doesn't model
  (ENGINE_FOLLOWUPS.md). A run of tabs is an item shaped apart from text, with no spacing of its own, whose later tabs
  take a whole stop (`shape_result.cc:1898-1944`), which a tab on a stop takes anyway. Where letter spacing is minus a
  space or less, so that stops are no wider than 0, `Font::TabWidth` returns a negative advance, or the letter spacing
  at a stop of exactly 0 (`font.cc:302-340`), and the line breaker clamps the item's width to 0 where it places it
  (`ClampNegativeToZero`, `line_breaker.cc:1486, 1703`), so such tabs take no advance. Recordings agree: a tab-only line
  in 16px Arial is 27.563px at −1px letter spacing and 35.563px at 0 (harness recordings at commit b1fd05fc, Chrome
  154), and no tab advances under such spacing in 792 probe inputs of tab runs (Chrome 154.0.8037.57, 2026-09-30). The
  profile counts stops so since #395 (`letterSpaceTabStops`, `letterSpaceTabs` and `tabMinimumCharacter`,
  `src/measurement.ts`). (Chrome 153 source, 2026-09-16 to 10-01.)
- **Line breaking.** ICU restarts at each line start without context, so LB20a applies there (`a‐b`, break-all, loose:
  `a` / `‐b`); the Blink scan makes one pass per text (Break Opportunities From Engine Data). Blink takes the last
  offset that fits from glyph positions, then the break at or before it, so a line ends before a ligature unless its
  first cluster doesn't fit, and reshapes a wrapped line from its first safe offset, moving the space 0 or −1
  LayoutUnits (`shaping_line_breaker.cc:309-324`). A non-start `text-align` or a decoration reshapes a line ending at a
  space (`NeedsAccurateEndPosition`), losing its kern with the space. U+2000-U+200A are ordinary text; only U+3000 is
  another space separator. No JavaScript API exposes Chrome's hyphenation data, so `hyphens: auto` can't be ported.
  (Chrome 153 source, 2026-09-16.)
- **Soft hyphens.** Where a line would end at a soft hyphen whose text fits and whose hyphen doesn't, `BreakText` takes
  the hyphen's width off the available width and asks `ShapeLine` once more (`line_breaker.cc:1705-1718`), which takes
  the latest break opportunity at or before that width, of any kind (`shaping_line_breaker.cc:326-333`, `389-395`):
  after a space, a ZWSP or an earlier soft hyphen, whose hyphen then fits, or wherever else the break iterator gives
  one, as after `-` before a letter, after a dash or `?`, and between ideographs. A break that leaves no room for the
  hyphen is passed, so before a syllable narrower than the hyphen the line goes back further: in 16px Arial
  `Bitte die Nebenrollen-i\u00ADkes vor der Regie` starts with `Bitte die` at 157.5-159px and with
  `Bitte die Nebenrollen-`, 153.87px wide, at 159.25-162.5px, the hyphen being 5.33px. Without an opportunity at or
  before the reduced width the item overflows and `HandleOverflow` takes over (#323's family; ENGINE_FOLLOWUPS.md, Line
  edges). Firefox and Safari end the line at such a break where it fits at the full width (`gfxTextRun.cpp:1053-1094`;
  Safari (WebKit), Soft hyphens). Until #446 the Chromium profile returned only to a space, a ZWSP or a soft hyphen,
  and kept the hyphen, up to its whole width past the line's end, wherever a break between two text segments lay after
  that target: in #433, `Bitte die Nebenrollen-Ta-`, 178.1px wide, at 172-178px in 16px Helvetica Neue, and a French
  sentence in 5 lines at 148-152px in 16px Arial, where Chrome has 6. Since #446 each break the scan gives between two
  text segments is a target where its line leaves room for the hyphen (`walkPreparedComplexLines`,
  `src/line-break.ts`). Of 34,064 probe layouts the profile agreed with Chrome on 31,620 before and on 33,612 after,
  with a wrong line count on 345 and on 79: the issue's texts in four fonts; a hyphen-minus, U+2010, an en or em dash,
  `?`, `!`, a slash, a ZWSP, a space, ideographs or nothing before the hyphenated syllable, in five fonts at every
  pixel; a syllable narrower than the hyphen at quarter pixels; Chinese and Japanese sentences in three fonts;
  pre-wrap, keep-all, letter spacing and a right-to-left paragraph; and rich items. 2,021 were fixed and 29 lost, each
  of the 29 a hyphen line the profile reports past the width and Chrome fits, by kerning across segments measured apart
  (7) or without a padded span's end edge (22), which agreed before only because the profile kept the hyphen
  (ENGINE_FOLLOWUPS.md, Line edges, has them). The Gecko and WebKit profiles' return is as it was: there such a break
  is a target with no width test, since the line fit when it reached the break. The room for the hyphen is tested in
  the Chromium profile alone, because the line's width at the break leaves out the letter-spacing gap after its last
  letter, which the hyphen's width carries: tested at the full width in the other two profiles, it lost the return
  under letter spacing negative enough to give the next syllable a negative advance, 90 of 3,816 layouts at -4px to
  -6px in 16px Arial and Georgia in Firefox and 80 in webkit-host, with 8 gained there. No prediction of either
  profile moved on the 34,064 layouts, on those 3,816 or on 13,060 more, in Firefox or webkit-host. Of the harness's
  cases 20 Chrome predictions moved, 19 of them from a failure to Chrome's lines: 4 facts cases and a real-usage
  Japanese draw that were on the accepted list, the issue's two texts, and 9 of the 47 facts cases and 3 of the 46
  rich cases added with the change. The twentieth, a padded span's, went from Chrome's lines to a failure
  (ENGINE_FOLLOWUPS.md, Line edges). None moved in Firefox or webkit-host. The per-engine rebuild, which ports
  `BreakText` whole, agreed with Chrome on all 17,535 of the first probe's layouts it could take. A break opportunity
  that isn't a segment boundary, or a fit in Chrome's 1/64px units, would reopen it. (Chromium 153.0.8010.48 source;
  the probes in Chrome 154.0.8037.57, the harness's cases in 154.0.8037.98, Firefox 156.0.1, webkit-host, 2026-10-05
  and 2026-10-06.)
- **Languages.** `--lang` is ignored on macOS; `navigator.language` follows the accept languages, not the UI; DevTools
  locale emulation (Playwright's `locale`) moves `Intl`'s default locale, not Blink's, a disagreement no user meets.
  Generic `serif` follows the process languages (16px `Hamburgefonstiv`: 114.40 px under zh-CN, 111.70 under en-US). The
  UI language can pass for a rule: main's quote rules before #340, fitted on a Chinese UI, passed 49 cases that all fail
  under an English UI. (Chrome 153, 2026-09-19 to 09-23.)
- **Canvas prices.** A first ask costs about 1 µs plus 0.06 µs a character (0.25 µs in Arabic); a repeat 0.14 µs at any
  length on the same canvas, full price on another; a new font size 30-45 µs; a new context measured once 21-26 µs. From
  scratch a question (one `measureText()` call) costs Chrome about 1 µs, WebKit 0.12-0.17 µs, Firefox 0.22-0.32 µs, so
  Chrome's time is its question count. A fallback font's first resolution is the browser's own cost, which moving it to
  start-up doesn't shrink: a Devanagari word took 3.0-3.25 ms in Helvetica and 16.6 ms in SF Mono (Safari 0.4-6 ms,
  Firefox 0.2-1.7 ms; installed browsers, 2026-09-16). (Chrome 153, 2026-09-18 and 09-19.)
- **`getTextClusters()`** (flag `ExtendedTextMetrics`, off in Chrome 153; windows and workers) gives every cluster
  position as Blink's own 16.16 sums, across fallback fonts and spacing. In the rebuild's Chrome port it took a chat
  message from 199 Canvas calls to about 31 (10,000 messages: 2.0 s to 0.7 s); given layout's run (`optimizeLegibility`,
  U+2028 for U+0020, the zoomed size), 12,987 of 13,035 cluster starts floored to the DOM's. It gives no safe breaks,
  which Blink keeps per glyph; a flag for them would make a width change cost no calls. By 2026-09-23 (from a summary of
  the Intent to Ship thread, not the thread itself; unverified) its Intent to Ship had slipped to Chrome 157 at the
  earliest, and WebKit's position on it was negative. Shipping reopens the rebuild's speed floors (Dead Ends, The
  Per-Engine Rebuild); its two filed bugs are in PLATFORM_BUGS.md. (Chrome 153, 2026-09-20.)

#### Safari (WebKit)

- **Safari 27's breaks** differ from 26's on the same libicucore 78.1: curly quotes and guillemets get opening and
  closing classes and a local LB19a; U+2028 and U+2029 force a break in every white-space mode (Chrome takes U+2028 as a
  space); keep-all text holding a character above U+00FF breaks after punctuation, even in `1,000,000` or `12:30`, so in
  every Hangul text node (WebKit #312099's fix, `BreakablePositions.h:268-271, 297-298`; an unfiled regression,
  PLATFORM_BUGS.md); a first character that doesn't fit keeps the following ones that can't start a line
  (`InlineContentBreaker.cpp:124-158`). What following 27 alone costs 26 is in the Decisions Log (2026-09-16). (Safari
  26.5.2 against 27.0, 2026-09-16.)
- **Page history (WebKit's caches).** The process-wide `TextBreakingPositionCache` keys breaks by text, origin and a
  style context that doesn't tell pre-wrap from break-spaces, never font, direction or storage, and fills as a block's
  line layout is torn down: `break-spaces` text after the same text in pre-wrap keeps six spaces on one overflowing
  line, and 16-bit keep-all breaks carry over to 8-bit text. `TextMeasurementCache` (widths keyed by text alone) moves
  float32 line edges too. 55 of 19,933 cases changed with run order (Chrome: 0), and of the 2,442 webkit-host cases main
  before #340 got right and the rebuild didn't, 1,707 were page history; history both orders share shows only in a case
  run alone in a fresh process. (webkit-host, 2026-09-17 to 09-24.) A paragraph takes the items of the same text laid
  out before it in the other direction (`InlineItemsBuilder.cpp:858-862`): right to left, two spaces,
  `بِبِ((tail` and two spaces in pre-wrap at 27.86px breaks into 0-4, 6-10, 11-13 after its
  left-to-right twin and 0-1, 2-7, 8-13 alone. Eleven recordings were pinned to a layout no fresh process gives, seven
  of which the library had right, until the harness recorded in two opposite orders; 30 such cases are page history
  now. (webkit-host, 2026-09-30.)
  The cache doesn't keep every text for the process's life. An entry needs a text of 5 code units and 3 break positions
  (`TextBreakingPositionCache.h:41-42`); once the entries' text and four units a break pass 2,500,000, the next entry
  drops others at random down to 500,000; past 500,000 the same happens after 10 s without a new entry; and memory
  pressure empties the cache (`TextBreakingPositionCache.cpp:37-39, 52-76`, `MemoryRelease.cpp:103`). So what a
  paragraph takes over depends on how much other text came between, not on order alone: in one webkit-host process that
  right-to-left case had its twin's layout with 0, 150 and 800 paragraphs of 150 words between the two (up to 1.9
  million units) and its layout alone with 3,000 (7.6 million), in both of two runs. One pass over the harness's 44,350
  webkit-host cases lays out 11,069 such texts, about 6 million units by a count of words and spaces, so which of two
  opposite orders shows a twin's layout differs from one recording to the next, and a twin whose entry was dropped first
  shows in neither. (WebKit 7625.1.29.11.27's source and webkit-host, 2026-10-01; other thresholds or another key would
  reopen it.)
- **String storage.** A text node is 8-bit from Latin-1 text, 16-bit once its leaf held a character above U+00FF, and
  layout reads it: an emergency break keeps one code unit at an 8-bit line start, and also the characters that can't
  start a line at a 16-bit one; keep-all `abcd,efghé` is 2 lines as 16-bit, 1 as 8-bit. JavaScriptCore's
  `Response.json()` gives 16-bit strings, ASCII values too, once the body holds a raw character above U+00FF
  (`LiteralParser.cpp:896-899`): one CJK case moved a batch's ASCII breaks, so keep probe payloads ASCII. The WebKit
  scan can't see inherited storage. (webkit-host and Safari 27.0, 2026-09-16.)
- **Measuring.** The simple or complex path follows the measured string's own characters
  (`FontCascade.cpp:304-309, 708-730`), and the two sit a float32 step apart at fractional sizes, so an exact-threshold
  fit can flip. Sizes aren't quantized; inline positions are float32 CSS px, off line breaking's 1/64 px grid. The
  fixed-pitch shortcut reads a Core Text trait Canvas can't show (`FontCoreText.cpp:753-785`), and the DOM then gives
  each character of non-ASCII text the space's width (16px Courier `ΩΩΩΩ`: 38.40625 px, Canvas 49.15625); `monospace` is
  Courier, neither equal advances nor names reveal the trait, and the profile doesn't model it. (webkit-host, 2026-09-16
  to 09-18.)
- **Overlong words.** Prefix fits beat single graphemes (307 misses against 1,018 over 2,564 cases; Safari 26.4,
  2026-06-22). The extra Canvas calls follow WebKit's layout: prefix widths for overflowing words (62-68% of calls,
  2026-09-16) and words measured with their following space (95% of the extra calls after 0.0.9, #236); the only cut
  found that still follows WebKit's layout saved 0.6%. When `breakWord` keeps a prefix of an item W wide, the rest gets
  float32(W − prefix) unmeasured and remainders compound (`AbstractLineBuilder.cpp:54-98`): `'AV'.repeat(17)`, 16px
  Arial, `overflow-wrap: anywhere`, 113.5px starts lines at [0, 11, 22], fresh widths at [0, 11, 22, 33]. So resuming
  needs the whole line start, not an offset, and a line painted alone can't reproduce it. (webkit-host, 2026-09-19.)
- **Soft hyphens.** Where the content after a soft hyphen wraps and its hyphen doesn't fit, WebKit builds the line again
  up to each earlier wrap opportunity, the latest first, until one ends without a soft hyphen or fits its hyphen, and
  keeps the line's first opportunity whatever its hyphen overflows (`InlineContentBreaker.cpp:104-122`,
  `TextOnlySimpleLineBuilder.cpp:459-480`): 16px Arial `the interna\u00ADtion\u00ADal` is `the` / `interna-` / `tional`
  at 76-80px, and `trans\u00ADi\u00ADt\u00ADlantic` starts with `trans-`, 40.9px wide, at 39.5-40.5px, where Chrome and
  Firefox break inside the word. A soft hyphen is discretionary only at a WebKit item's end. WebKit fits the text on
  each side of a soft hyphen as measured alone (`TextUtil.cpp:62-100`), and the hyphen as U+2010 where the primary font
  has one (`StyleComputedStyle.cpp:419-431`). The WebKit profile ports the three since #396 (`unfitHyphenRetreat`'s
  `'full-width-or-first'`, `hyphenFromPrimaryFont`), where it kept every unfit hyphen before: on 3,092 fresh cases of
  soft-hyphenated text (120-600px, 25 font lists, letter spacing, marks after the soft hyphen, pre-wrap, rich items)
  main passed 2,308 and the port 3,087, all but one that main passed, a padded span's first syllable; the harness's
  "Real usage: soft hyphens" class, 15 cases, passes. The builder for lines with inline boxes or bidi text tests a
  candidate that ends at a soft hyphen with its hyphen instead (`InlineLineBuilder.cpp:1154-1163`), which the profile
  doesn't take (ENGINE_FOLLOWUPS.md, Rich-inline item edges, has both, and how rarely plain right-to-left text shows
  it: 5 of 1,532 fresh cases). Installed Safari wasn't run; its sample disagreeing with webkit-host on a soft-hyphen
  case would reopen this. (webkit-host, WebKit 22625.1.29.11.27, 2026-09-30 and 2026-10-01.)
- **Tabs.** Stops of eight spaces without the letter spacing, skipping one under half a space away
  (`FontCascadeInlines.h:76-93`, read 2026-09-27), as the profile does; recorded tab-only lines are eight spaces plus
  one letter-spacing gap (harness recordings at commit b1fd05fc, webkit-host). CSS Text's minimum, as in Gecko, is half
  a `0`. Stops use the font of the tab's inline box (WebKit #230339, open since 2021; Safari 26.5.2, 2026-09-12).
- **CR and FF.** Neither is white space to WebKit, whose white space is space, tab and a line feed that isn't preserved
  (`moveToNextNonWhitespacePosition`, `InlineItemsBuilder.cpp:55-73`), so one ends a white-space run and stays in its
  text item, in pre-wrap too, where neither forces a break. A CR keeps the glyph its font gives U+000D
  (`GlyphPage::fill`, `GlyphPageCoreText.cpp:51-73`), and Core Text's shaping gives that glyph no advance
  (`CTFontShapeGlyphs`, called from `Font::applyTransforms`, `FontCoreText.cpp:617-699`: called alone on 16px Arial
  `ab`, CR, `cd`, it takes the CR's advance from 4.45px to 0; the complex path sets it to 0 at
  `ComplexTextController.cpp:762-768`), so it gets no letter spacing either, which goes only to a character that
  advances (`WidthIterator.cpp:508-516`); an FF is drawn as `.notdef` at its advance, set after the letter spacing
  (`WidthIterator.cpp:816-823`). In 16px Arial `ab`, CR, `cd ef` is 52.48px wide, as `abcd ef`, and 64.48px with an FF,
  `.notdef` being 12px; `see`, CR, `this` at 1px letter spacing is 57.70px, seven gaps. White space on both sides of a
  CR stays two spaces, a line feed among it: `ab`, space, CR, space, `cd ef` is 61.38px, and `ab`, CRLF, CRLF, `cd`
  43.59px where `ab`, LF, LF, `cd` is 39.14px. White space between a CR and the text's start or end stays too, since the
  CR is content and keeps it from the line's edge: CR, space, `foo bar` and `foo bar`, space, CR are 54.26px where
  `foo bar` is 49.81px. For the same reason a CR right after a U+2028 or U+2029, which ends its line
  (`handleSegmentBreak`, `InlineItemsBuilder.cpp:954-962`), is the content of a line of its own, where white space alone
  leads a line and collapses away (`Line::appendText`, `InlineLine.cpp:346-373`): `ab`, U+2028, CR is 2 lines at any
  width that fits `ab`, the second zero wide but in Menlo, where the CR is a character wide by the fixed-pitch shortcut
  (below), with or without white space after the CR, and `ab`, U+2028, space is 1 (eight fonts, in webkit-host alone,
  2026-10-07). The letters on a CR's two sides kern with its glyph and not with each other. Where that is the font's
  space glyph, as in Arial, Times New Roman and Trebuchet MS, they kern as with a space (16px Arial `A`, CR, `A`
  19.58px, `AA` 21.34px); where the font has a glyph of its own for U+000D, as Helvetica, Helvetica Neue, Times and
  Palatino do, nothing kerns with it (16px Helvetica `A`, CR, `V` 21.34px, `AV` 20.16px, and `A`, CR, space, `B`
  25.79px, `A B` 24.91px). In Arabic a CR ends joining. No break comes beside a CR where WebKit's break scan
  (`nextBreakablePosition`, `BreakablePositions.h:142-255`) takes both pairs the CR is in from its table, which has none
  beside a control (`:179-187`), as it takes every pair of characters up to U+00FF: none comes in `été`, CR, `cd`. The
  pair of a CR and a letter above U+00FF after it goes to ICU, which breaks after a CR (`:238-251`): a line can end
  there whatever is before the CR. The pair of the CR and the character the scan holds as the one before it goes to ICU
  too where that character is above U+00FF. ICU's break is then one unit ahead, and the scan steps on to an ICU break
  only while the next unit is above U+00FF or an ASCII letter: before any other unit it stops, and that unit's pair with
  the CR is the table's again (`:241-249`). So where the character held is above U+00FF a line ends after the CR before
  an ASCII letter, as in `бв`, CR, `cd`, and not before another character up to U+00FF, a digit, punctuation or a letter
  such as `ê`: not in `бв`, CR, `12`, in `бв`, CR, `(x` or in `бв`, CR, `êë`. The character held is the one before the
  CR in the text unless the scan stepped over that one: it reads no new pair on its steps to an ICU break, so where the
  CR stops them it still holds the second character of the pair it asked ICU about. Where that one is above U+00FF a
  line ends after the CR between two ASCII letters, as in `ไทยe`, CR, `cd`, where the scan asked about `ไท`, though not
  in `ไทยe`, CR, `12`; where it is up to U+00FF no line ends after a letter above U+00FF and before an ASCII one, as in
  `т.е`, CR, `cd` and `б(в`, CR, `cd`, where it asked about `т.` and `б(`, nor between the ASCII letters of `ทab`, CR,
  `cd`, where it asked about `ทa`. A pair the scan decides without ICU starts no such steps: a Cyrillic and a Latin
  letter are one, so no line ends in `бвe`, CR, `cd`, and a letter and a quotation mark another, so one does in `б"в`,
  CR, `cd`. So a line can end after a CR between Cyrillic, Greek, Arabic, Hebrew, Thai, Devanagari, Hangul, kana or Han
  characters, or between one of them and an ASCII letter. webkit-host lays the twelve texts named here out so, as the
  scan's port in `src/line-breaks.ts` predicts, and `ab`, CR, `漢。` and `т.е`, CR, `гд` with a break after the CR: each
  in 16px Arial in a box 1px narrower than the text, where the line ends after the CR if a line may end there and before
  the text's last character if none may (WebKit 22625.1.29.11.27, 2026-10-09). At the edge of an inline box the break is
  the one the check between two boxes finds, from the next box's text with the two characters before it
  (`TextUtil::mayBreakInBetween`, `TextUtil.cpp:367-396`): there the pair of a CR and a character up to U+00FF is looked
  up alone, so a line ends after a CR that ends, starts or is a box only where the character right after it is above
  U+00FF. Spans `бв`, CR and `cd ef` in 16px Arial at 28 and 32px are `бв` and `c`, then `d ef`, where their text in one
  node is `бв`, `cd`, `ef`; and a CR at a span's edge takes no room either: `see`, CR and a bold 20px `this word` are
  114.68px wide. The analysis of a rich-inline paragraph follows both (webkit-host, 2026-10-07; ENGINE_FOLLOWUPS.md,
  White space and controls, has the probe and what it leaves). White space right after a CR that ends a box, or is a
  box, belongs to the box that holds it. The CR is no white space, so the run starts after it, and WebKit makes a
  white-space item of the text box that holds the run's first character, as wide as that box's space
  (`InlineItemsBuilder.cpp:947`, `963-987`), and takes out only white space that follows other white space, an earlier
  box's too (`Line::appendText`, `InlineLine.cpp:357-365`). Spans `see`, CR and a bold 20px one of a space and `this
  word` are 120.24px wide, with the bold space, and three lines at 66px, their `see this` being 66.91px. Firefox has
  120.22px, with an FF for the CR too: its transform takes a frame at a time from the white-space state the frame before
  left, which a CR or FF clears (`nsTextFrameUtils.cpp:286-309`, `382-386`). Chrome has 119.13px, with the first span's
  16px space, a CR being white space to Blink, its run's first unit (`Character::IsCollapsibleSpace`,
  `character.h:150-153`). A rich-inline paragraph's source offsets follow each: in the WebKit and Gecko profiles no
  space comes from a CR, nor from an FF in the Gecko profile, so the space after one that ends an item is the next
  item's, in its font and letter spacing (`alignToSource()`, `src/analysis.ts`; webkit-host, Firefox 156.0.1 and Chrome
  154.0.8037.98, 16px Arial, 2026-10-07; a template of the rich set's `item-edges/carriage-return` family holds it;
  ENGINE_FOLLOWUPS.md, White space and controls, has the probes' counts and the two padded shapes it leaves; no probe
  holds word spacing or a right-to-left paragraph, and either would reopen it). A text node of only space, tab, LF, CR
  and FF has no renderer, so no lines (`RenderTreeUpdater::textRendererIsNeeded`, `RenderTreeUpdater.cpp:536-594`). A
  font Core Text calls fixed pitch takes WebKit's fixed-pitch shortcut, but for Courier New and fonts the user installed
  (`Font::determinePitch`, `FontCoreText.cpp:753-785`): a text box on simplified measuring is as wide as its characters
  are many (`widthForSimpleTextWithFixedPitch`, `FontCascade.cpp:414-421`; `TextUtil.cpp:80-86`), and a CR or LF doesn't
  take a box off it (`characterCanUseSimplifiedTextMeasuring`, `WidthIterator.cpp:694-742`), so there each CR is one
  space wide, the CR of a CRLF and a CR beside white space too: in 16px Menlo `ab`, CR, `cd` is 48.17px and `abcd`
  38.53px, two CRs there take 19.27px, and `ab`, CRLF, `cd` is 57.80px where `ab`, LF, `cd` is 48.17px. Measured, the
  fonts that take it are Menlo, Monaco, Courier, Andale Mono, PT Mono and the generic `monospace`, which draws Menlo, at
  11 to 28px, bold and italic. A CR takes nothing in Courier New, and by measurement alone, not traced in the source, in
  `ui-monospace` and in a web font, the files of Menlo, Monaco and Andale Mono loaded with `FontFace` among them. A font
  list goes by its first family that is present (`FontCascadeFonts.cpp:140-154, 165-198`): `Menlo, Monaco, monospace`
  takes the shortcut, and `"SF Mono", ui-monospace, Menlo, Monaco, monospace` and `"Courier New", Courier, monospace`
  don't. Letter spacing takes the box off simplified measuring (`TextUtil.cpp:716-745`), as does a ZWSP, an NBSP,
  another control or a character of another font anywhere in the text, and the CR then takes nothing. Every Canvas
  measures CR and FF as a space and U+0001 as `.notdef`. Since #455 the WebKit profile's analysis takes a lone CR out of
  the text, as the Gecko profile's does since #399, with the breaks the scan found around it; an FF is still a collapsed
  space, and pre-wrap takes both as hard breaks (README). That gives up the fonts on the fixed-pitch shortcut, where the
  profile's space had matched one CR between two letters, by decision (Decisions Log, 2026-10-06). ENGINE_FOLLOWUPS.md,
  White space and controls, has what the change leaves and the probes' counts; keeping the CR as zero-width glue was
  built and not taken (Dead Ends, Invisible Characters, Controls And Soft Hyphens). #455 lost one of the breaks the scan
  found around a lone CR, the forced break of a U+2028 or U+2029 right before lone CRs and then white space that ends
  the text, whose separator was laid out as a control; while each rich item's text was analysed alone, such an item also
  let the item after it follow on its line. #459 (2026-10-07) keeps the break, as main before #455 did. In a rich-inline
  paragraph, analysed as one text, an item of that shape before an item with text ends its line at the separator with
  the rule or without, since its white space doesn't end the text; there the rule keeps the break of a separator where
  the white space that ends the paragraph starts a later item. A span of `abc` and U+2028 before a span of one space
  ends its line at the separator, as in Safari, where the separator laid out as a control took a line of its own in a
  box narrower than a letter; with a space before the separator it took one from 25.80 to 30.24px in 16px Arial, where
  `abc` fits and its space doesn't (webkit-host, 2026-10-07; two templates of the rich set's
  `item-edges/separator-before-space` family, whose webkit-host cases at 1px and at 25.80px fail without the rule; on
  the stand-in Canvas the rule changes 117 and 107 of 200,000 random paragraphs in the WebKit profile alone, each by one
  separator that ends its line where it was painted). Offline on the stand-in Canvas, in a fuzz that isn't checked in,
  of 200,000 random texts built to hold separators, lone CRs, CRLFs and white space at the end, 27,383 differ from main
  before #459 in the WebKit profile, every one of that shape and laid out as the same text without those CRs is, and
  none in the other profiles; in Safari such a plain text stays a line short for the CR's own line (ENGINE_FOLLOWUPS.md,
  White space and controls), as it was before #455. (webkit-host, WebKit 22625.1.29.11.27, 2026-10-06. Installed Safari
  27.0 agreed with webkit-host on the 8,387 layouts of two earlier probes of that day, in Arial, Times New Roman and
  Georgia, on all 2,820 widths of a page of these facts in 30 font settings, the fixed-pitch and web fonts among them,
  and on the lines and widths of 1,623 layouts of a sample in Arial, Menlo and Courier New; the larger probes ran in
  webkit-host alone. Reopens with a Canvas fact that tells which fonts take the fixed-pitch shortcut or which glyph a
  font gives U+000D, or with normal white space that keeps two spaces that touch.)
- **Emoji and the segmenter.** DOM emoji equal OffscreenCanvas's at the CSS size, bit for bit at 8-32px (a "size × DPR ÷
  DPR" recipe is up to 3.5 px off), and OffscreenCanvas gives a space before U+FE0F the emoji's width
  (ENGINE_FOLLOWUPS.md). Safari's `Intl.Segmenter` doesn't mark digit strings as words where Bun's does, so Bun is no
  stand-in: a port that let only words split on overflow stopped splitting numbers (230 rows of the old test suite,
  `tests/wrapping`, removed 2026-09-25 in favour of the harness). Making a segmenter costs about 7.8 µs, segmenting a
  short range 1.9 µs, so the scans keep one; its `containing()` bug is WebKit #324036 (PLATFORM_BUGS.md). (webkit-host,
  Safari 26.5.2 and 27.0, 2026-09-15 to 09-20.)
- **Regex literals are checked when the code is parsed.** JavaScriptCore checks each regex literal's syntax as it parses
  the code holding it (`parsePrimaryExpression`, `Parser.cpp:5284-5302`, WebKit 7625.1.29), so a literal it can't parse
  stops the whole module from loading, whichever engine's path the literal is on. The regex that collapsed white space
  through bidi controls for the Gecko profile began with a lookbehind from #368 until #399 removed that regex. In the
  JavaScriptCore of Bun 0.2.0 (built 2022-10-13), which has no lookbehind, a bundle of `src/layout.ts` with that regex
  fails to load with `SyntaxError: Invalid regular expression: invalid group specifier name`, and the bundle without it
  loads and lays text out; Bun 0.4.0's (2022-12-23) parses a lookbehind. Safari parses one from 16.4, by its release
  notes: no Safari before 16.4 was run, and loading the library in one would confirm the version. `src/` holds no
  lookbehind now, which a unit test checks since #401, as no browser the harness runs would show one. (2026-10-01; main
  at #399 loaded in Bun 0.2.0, 2026-10-02.)
- **Kept contexts and loaded fonts.** A kept context misses a `FontFace` already loaded when it joins an empty
  `document.fonts` (PLATFORM_BUGS.md): the font cache keys without the font set while it's empty
  (`FontCascadeCache.cpp:104-115`), and the set tells observers before inserting (`CSSFontFaceSet.cpp:203-209`).
  (webkit-host, 2026-09-20.)

#### Firefox (Gecko)

- **Font sizes and Canvas answers.** Canvas keeps 7 significant bits of a size (`QuantizeFontSize`,
  `CanvasRenderingContext2D.cpp:4207-4216`): 13.33px measures as 13.375px. The DOM keeps 10 (Servo's
  `quantize_font_size()`, `font.rs:1004-1022`), then rounds to 1/60 px: 16.8px lays out at 16.8125px. Integers, halves
  and quarters below 32px agree; at 13.33, 16.8 or 17.3px widths miss by a median 0.24 px a line (PLATFORM_BUGS.md).
  `measureText()` is float(app units) / 60, so `round(W × 60)` is exact only below 2^18 px. A call costs about 0.4 µs
  plus 0.1 µs per UTF-16 unit, a new OffscreenCanvas context 6-7 µs. (Firefox 155.0.1, 2026-09-14; 156, 2026-09-16 to
  09-19.)
- **Font fallback per process.** Characters found only through global fallback measure differently for about a second
  after a content process first asks (U+20BF: a 13 px missing-glyph box, then 9.92 px), in every context and the DOM,
  and nothing says which. After any text shows U+1F600 U+FE0E, plain U+1F600 in Arial draws wrong for about 3 s
  (`gfxPlatformFontList.cpp:1474-1486`; PLATFORM_BUGS.md). So history-dependent cases vary between identical runs (190
  of the rebuild harness's emoji cases in one run, 104 in an identical one), and order matters: an app measures before
  layout, a test harness usually after, and measuring first moved 121 Firefox emoji cases, none in Chrome or
  webkit-host. (Firefox 156, 2026-09-16 to 09-20.)
- **An added face reaches a kept context when its font is assigned**, the same string too. A context that measured
  `32px "Late", monospace` before the family had a face keeps the fallback after `await face.load();
  document.fonts.add(face)` until its `font` is assigned: with the assignment, the text prepared again after
  `clearCache()` is 649.45 px wide, as painted, and a build that left out an assignment of the string the context
  already held read the fallback's 770.67 px. Chrome 154's context takes the face with no assignment, and webkit-host's
  only after another font string (PLATFORM_BUGS.md). So the first measurement after a font is looked up assigns it
  (`getFontMeasurement()` in `src/measurement.ts`). (Firefox 156.0.1, 2026-10-05.)
- **Thai, Lao, Khmer and Burmese** break with the ICU4X model `Intl.Segmenter` runs (PLATFORM_BUGS.md), a
  space-delimited word at a time, so the segmenter gives exactly Firefox's breaks (54,588 of 54,588, once breaks inside
  grapheme clusters are dropped). New text's `prepare()` plus `layout()` per 1,000 characters, Chrome / Firefox /
  Safari: Latin 0.19 / 0.30 / 0.31 ms, Thai 0.72 / 2.74 / 1.31 ms. Runs between spaces (median 22-32 characters in Thai,
  3 in Khmer, 10 in Burmese) rarely repeat (1,192 distinct of 1,304 in one story), so the parked Thai cache helps only
  averages (Dead Ends, Caching, State And API Designs). (Firefox 155 and 156, 2026-09-16 and 09-25.)
- **How Gecko shapes.** Word by word: a boundary space (U+0020, or U+00A0 with no extender after it) is its own glyph
  (`gfxFont.cpp:3317-3330, 3708-3900`), so no kerning crosses it and a string equals its words plus spaces (66,743 of
  66,745 answers). Fonts whose lookups involve the space glyph shape the run whole (`SpaceMayParticipateInShaping`:
  Hebrew in Arial, Arial under `font-kerning: normal`, SF whenever features are on). A word of any length is one shaping
  call, which `BreakAndMeasureText` reads without reshaping a line. CJK turns kerning off; Common, Inherited and plain
  ASCII runs shape as Latin, so digits kern. The Core Text shaper is off by preference, so AAT families such as
  Helvetica Neue go through HarfBuzz and round each glyph. (Firefox 156, 2026-09-16 to 09-20.)
- **Ligatures.** A range edge inside a ligature gets its advance shared by started clusters (`ComputeLigatureData`,
  `gfxTextRun.cpp:238-322`), but the break scan puts it all on the first character (`:989, 1139-1149`), so a break
  between lam and alef never fits more text. The Gecko profile follows that for a font's optional ligatures in words of
  80px or wider and up to 96 graphemes (#435) and not for one the font requires, as lam-alef, which its prefixes cut
  (Break Opportunities From Engine Data). Real text breaks inside ligatures under break-all, in long words, at soft
  hyphens and in URLs (1,432 cases in Helvetica, Hoefler Text, Seravek, Lucida Grande and the Latin of PingFang SC and
  Hiragino Sans). Unfiled: `ComputeLigatureData` divides a signed advance by an unsigned count (`:249-289`), so a span
  starting between two marks of one cluster makes a frame about 17.9 million px wide. (Firefox 156, 2026-09-17 to
  09-23.)
- **Letter spacing.** The page resolves it to whole app units, 1/60 px, from a float32, rounding half away from zero
  (`ResolveLetterSpacing`, `nsTextFrame.cpp:1949-1962`; `DefaultLengthToAppUnits`, `ServoStyleConstsInlines.h:584-595`):
  each letter takes -5 units at -0.08px, as Signal Desktop sets Inter, -10 at -0.17px, 23 and -23 at ±0.375px, 1 at
  0.0084px and none at 0.0083px, where the text also keeps its ligatures. The Gecko profile rounds the same way (#397):
  6 of its accepted failures at -0.08px passed, 3 of them real-usage paragraphs, and no pass was lost. The Canvas rounds
  half up, -22 units at -0.375px (`CanvasRenderingContext2D.cpp:4771-4774`). A cluster whose first character's script is
  cursive (Arabic, Syriac, N'Ko, Mandaic, Mongolian, Phags-pa, Hanifi Rohingya) takes none (`GetSpacingInternal`,
  `nsTextFrame.cpp:4202-4213`; `UnicodeProperties.h:350-355`), joined or not, while digits, brackets and punctuation
  among them keep theirs, tatweel and U+060C too; the Gecko profile follows it (#397), and the sample's 7 failing Arabic
  and Urdu paragraphs under letter spacing pass. A run's last character is always spaced, others only if not a tab or
  formatting character and a cluster starts after them (`CanAddSpacingAfter`, `nsTextFrame.cpp:3860-3873`): a lone
  pre-wrap tab at 1px is 43.6 px natively, 44.6 px painted alone. A tab before a change of direction also ends a
  left-to-right run and gets a gap (`a\tبِبِ((tail`), unseen by the Gecko profile, which resolves no levels (Bidi
  Levels). After a removed soft hyphen, a mark is spaced as its own base. From Firefox 153, a Canvas `letterSpacing`
  under half an app unit turns ligatures off and adds nothing, which the Gecko profile measures letter-spaced text under
  (Measurement Model); 140 ESR adds 0.00104 px a character at `0.001px` and has no `ctx.lang`, and ESR is dropped where
  it costs complexity (Part 1, Limits); at the `0.000001px` the profile sets, that rate would add a millionth of a px a
  character, far under the line fit's 0.005 px for any line, which is inferred from the 0.001px reading and wasn't
  measured. The page decides on the spacing in whole app units (`nsLayoutUtils.cpp:6896-6904`), so its text at 0.001px
  keeps its ligatures, where the Canvas decides on the float (`CanvasRenderingContext2D.cpp:5233-5241`). (Firefox 156,
  2026-09-17 to 09-30.)
- **Text frames.** Bidi resolution splits a text node into a frame for each level run (`nsBidiPresUtils.cpp:1037-1053`),
  in a left-to-right block only in 16-bit text with a right-to-left character (`HasRTLChars`), and `TransformText` runs
  on one frame's text at a time, carrying only whether the frame before ended in white space
  (`nsTextFrame.cpp:2515-2518`). So a white-space run collapses through the soft hyphens and bidi controls of its frame,
  and a control that starts a level run ends it; white space that starts a frame collapses into the run before it
  (space, RLE, space). Which control starts a level run turns on the paragraph's direction. In 16px Arial `see`, space,
  a control, space, `this` in a left-to-right paragraph is 55.15px wide with LRM, LRE, RLE, PDF, LRI, RLI, FSI, PDI or a
  soft hyphen, and 59.60px, two spaces, with RLM or ALM; in a right-to-left paragraph it is 55.15px with RLM, ALM and
  LRM. `אב`, space, LRM, space, `גד` is 36.63px in a left-to-right paragraph and 41.08px in a right-to-left one, RLM
  between Hebrew words keeps one space in both, and after digits RLM keeps two in a left-to-right paragraph and LRM two
  in a right-to-left one (`12`, space, mark, space, `34` is 44.50px, else 40.05px). `a`, space, RLI, `b`, space, PDI,
  space, `c` keeps three spaces in both, and `א`, space, RLI, `ב`, space, PDI, space, `ג` three in a right-to-left
  paragraph and two in a left-to-right one, where the PDI takes the level of the text inside. A run's last space stays
  as a combining mark's base only inside its frame: in a left-to-right paragraph `see`, two spaces, LRM, U+0301, `x` is
  42.70px wide, and 38.25px with RLM. A line's start trims all the white space each frame starts with while the line
  holds nothing (`nsTextFrame.cpp:10904-10944`): in a left-to-right paragraph RLM or ALM, then one to three spaces, a
  space and a tab, or a line feed and a space, and `see this`, is 55.15px wide, and in a right-to-left one RLM or ALM,
  space, `see this` 59.60px, with the space; LRM, space, `see this` is 59.60px in both, and LRM, space, `אב גד` 41.08px
  in a left-to-right paragraph and 36.63px in a right-to-left one. Where the line holds content already that white space
  stays: spans `Hello` and RLM, space, `world wide` are 116.48px wide, with the space, in both. A frame whose end drops
  a soft hyphen gives a break with a hyphen there, and a segment break is transformed by the characters around it in its
  own frame. A block of only dropped characters has no height. The Gecko scan takes a text as one frame
  (`transformText()`): Pretext takes no paragraph direction, and outside an embedding or isolate a mark of the
  paragraph's own direction never starts a level run after white space. ENGINE_FOLLOWUPS.md, White space and controls,
  has what that gets wrong, and Dead Ends, Invisible Characters, Controls And Soft Hyphens, the port that ended runs at
  level runs. On 2.5 million random strings without combining marks the analysis's text equals a model of
  `TransformText` over the whole text, where main's differed on 5,999 of a million, and on 4 million scans the scan's
  breaks are main's. (Firefox 156.0.1, 62,132 probe cases, 7,979 in right-to-left paragraphs, most in 16px Arial,
  2026-09-30 and 10-01. Reopens with a `direction` option, or with a recorded frame split that a level run doesn't
  explain.)
- **CR and FF.** In normal white space `TransformText` takes neither as white space (`nsTextFrameUtils.cpp:51-57`), so
  one ends a white-space run and stays in the text run, which gives it no glyph and no advance: `SplitAndInitTextRun`
  skips a control character it doesn't draw as a hexbox, which is never CR and, in release and beta builds, no other one
  (`gfxFont.cpp:3620-3627`, `:3874-3892`; `layout.css.control-characters.visible`). In 16px Arial `see`, CR or FF,
  `this` is 50.70px wide, and a line can end after the CR; `see`, CR, LRM, space, `this` is 55.15px, one space; `see`,
  space, LRM, CR, LF, `this` and `see`, space, CR, space, `this` are 59.60px, two, one for each run; and at 1px letter
  spacing `see`, CR, `this` is 58.70px, the CR taking a gap of its own. A line's start and end trim one with the white
  space around it (`IsTrimmableSpace`, `nsTextFrame.cpp:921-942`), but where a line would end after one, the space
  before it takes room: the fit trims only the run of spaces that ends the line, which the CR ends
  (`gfxTextRun::BreakAndMeasureText`, `gfxTextRun.cpp:1152-1160`). A line can end after one because a CR is one of
  `nsLineBreaker`'s breakable spaces, whose run gives the unit after it a break (`IsSegmentSpace`,
  `nsLineBreaker.h:260-264`; `nsLineBreaker.cpp:318-327`), and an FF is UAX #14's BK. Every Canvas measures CR and FF as
  a space (Measurement Model; Firefox's at `CanvasRenderingContext2D.cpp:4634-4637`), so since #399 the Gecko profile's
  analysis takes them out of the text, as the scan marks one as it marks the white space a run left out; before, each
  became a space, as it still does in the other profiles. The CR of a CRLF stays unmarked and collapses into the line
  feed's space, which gives the same text (Work Done Only Where A Rule Applies). Keeping one as a control of no advance
  was tried and not taken (Dead Ends, Invisible Characters, Controls And Soft Hyphens). Of 13,380 probe cases with a CR or FF (words, white
  space, soft hyphens and marks beside one, sentences with CRLF or lone CR line ends, rich items) Pretext fails 897
  where it failed 1,365 before: 489 that failed pass, and 21 that passed fail, 5 under letter spacing and 16 of a rich
  item that starts with a CR or FF, a mark and a space. On a million random strings the analysis's text differs from a
  model of `TransformText` on 1,730, each with white space touching both sides of a CR or FF, where it differed on
  88,125 before. ENGINE_FOLLOWUPS.md, White space and controls, has what is left. (Firefox 156.0.1, 2026-10-01. Reopens
  with a Firefox release that draws hidden control characters, as Nightly does, or with normal white space that keeps
  two spaces that touch.)
- **The hyphen of a soft hyphen.** `MakeHyphenTextRun` (`gfxTextRun.cpp:2458-2473`) paints U+2010 where the font
  `GetFirstValidFont(U+2010)` returns has it, else `-`. Its comment says the first font in the group, but given a
  character that function returns the first listed font that has the character, else the default font (`2277-2360`),
  which on macOS is the user font, Helvetica (`CoreTextFontList.cpp:1978-1989`). So Firefox paints U+2010 wherever a
  listed font or Helvetica has one, and shapes it as any other text, in a later family or a fallback font where the
  first lacks it: `"Geeza Pro", Inter` paints Inter's, where Chrome and Safari paint `-`, and Geeza Pro alone a
  fallback font's, 0.73px wider than its `-` under an Arabic or Persian page language. Canvas measures the same
  glyph, so the Gecko profile measures U+2010 with no check (`hyphenFromPrimaryFont`, #396). The facts set holds it
  in `"Geeza Pro", "Songti SC"`, whose hyphen is Songti SC's in Firefox, an em wide, and Geeza Pro's `-` in Chrome
  and Safari. (Firefox 156.0.1, 2026-10-01.)
- **Breaks.** The Gecko scan ports Gecko's rules (Break Opportunities From Engine Data), such as `-` kept with a digit
  (`COVID-19`) and a break after `/` before an ASCII letter, the opposite of Chrome and Safari. Not carried:
  - An emergency wrap after a hyphen between alphanumerics (`SetupClusterBoundaries`), taken only when nothing else
    fits, so a probe reading only `overflow-wrap: normal` lines sees a break that isn't one.
  - Under `overflow-wrap: break-word`, every cluster of a line's first word stays a candidate until an ordinary break is
    accepted (`gfxTextRun.cpp:1068-1073`): free for Gecko, 4-5 Canvas questions a cluster for a port (the profile's
    trade is under Break Opportunities From Engine Data).
  - Cluster starts beyond ICU4X's grapheme rules: a leading extender continues a cluster, a Bengali YA joins after a
    VIRAMA, Myanmar U+102C stays with the cluster before it. Whether that undoes the Gecko profile's use of Chrome's
    grapheme table isn't settled (ENGINE_FOLLOWUPS.md, Emergency breaks inside a word).
  - Relayout: a frame that overflows after an earlier break was recorded redoes the line with that break forced
    (`aa b<span style="color:red">bbbbb</span>`, 16px Courier New, 57.6px: `aa` / `bbbbbb`).
  - Page history: any RTL text node turns bidi on document-wide (`CharacterData.cpp:298-302`), so LRE, LRO, LRI or FSI
    split an LTR paragraph's frames only once the document has seen RTL text.

  (Firefox 155 and 156, 2026-09-14 to 09-20.)
- **Span edges.** A span's end border and padding are reserved on every line it occupies (`nsInlineFrame.cpp:519`), so
  shrink-wrapping padded spans to the widest line can move a break (2 of 55 widths), as with the Markdown chat's inline
  code; Blink and WebKit don't. (Firefox 156, 2026-09-19.)
- **OffscreenCanvas against the DOM.** OffscreenCanvas shapes at the CSS size at 60 app units per px, the DOM at the
  device size, rounding each glyph at max(1, round(60 / dpr)) units per device pixel (`gfxHarfBuzzShaper.cpp:1559,
  1699-1702`): about 0.03% of widths are a unit off (Geeza Pro, Thonburi, Helvetica Neue), and no traced break moved.
  Synthetic bold differs by more: a face drawn bold without a bold face of its family gets 0.25 + 0.75 × S / 48 px a
  cluster at the shaped size S under 48 px (`gfxFont.h:1899-1904`), so OffscreenCanvas is 0.25 × (1 − 1/dpr) px a
  cluster wider than the page in any proportional family, 7 app units at 10-16px at ratio 2 and none at ratio 1
  (Roboto and Inter, Firefox 156.0.1, 2026-10-05), which has moved real-usage breaks (ENGINE_FOLLOWUPS.md, Canvas
  answers that differ from the page). A `<canvas>` element at the device size matches (243 of 243 units);
  why Firefox still uses OffscreenCanvas is under Dead Ends, DOM And Canvas-Element Paths. (Firefox 156, 2026-09-17 and
  09-18.)
- **Optical sizing.** OffscreenCanvas never applies automatic optical sizing (`nsFont.cpp:276-279`; Mozilla #2020917),
  so its `system-ui` is the page's family at another optical size, not another font, and every `opsz` font mismeasures
  the same way on every OS, web fonts included (Inter, Roboto Flex, Source Serif 4). #336 has the `system-ui` sweep.
  (Firefox 156, 2026-09-17 and 09-18.)
- **Workers** measure like their page except for a font list with no generic family: Gecko appends `font.default`
  (serif) on the main thread, always `sans-serif` in a worker (`gfxTextRun.cpp:1881-1891, 1969-1977`), and a library
  can't append one quietly (lines moved in 16-21 of 435 cases). A context with `lang = ''` follows the root's `lang` on
  the page, the OS locale in a worker. `devicePixelRatio`, absent in a worker, misleads on the page too: 2 in a
  `display: none` iframe, 1 in a removed one, 2 under `privacy.resistFingerprinting` where layout is at 1. (Firefox 156,
  2026-09-19.)
- **Tabs.** A stop falls every `tab-size` (the text frame's) × (the block's space advance in app units plus its letter
  and word spacing) (`ComputeTabWidthAppUnits`, `nsTextFrame.cpp:3875-3906`); WebKit takes both from the span, Blink the
  span's `tab-size` with the block's font. The next stop is at least half a `0` away, the `0` of the first font of the
  tab's own text run, not the block's (`AdvanceToNextTab`, :4298-4304; `MinTabAdvance`, :3539-3544;
  `GetMinTabAdvanceAppUnits`, :1931-1937), where Blink's half space is the block's font's (`FontForTab`,
  `inline_node.cc:2137-2143`): before a span of a tab and `b`, half the span's `0` gives Firefox 156.0.1's stop for 192
  of 192 prefixes with each of six spans, and half the block's misses 5 with a bold span in 16px Georgia and 15 with a
  24px one (2026-10-01). That font is the list's first available one, whether or not it has a `0`, and without one Gecko
  takes its average character width (`GetFirstValidFont`, `gfxTextRun.cpp:2277-2296`; `ZeroOrAveCharWidth`,
  `gfxFont.h:1698-1700`); the Gecko profile takes Canvas's width of `0`, which a later font of the list draws there, a
  named gap (ENGINE_FOLLOWUPS.md). A tab's position counts advances only at cluster starts, plus each character's
  spacing (`CalcTabWidths`, :4306-4378). Recordings agree (harness recordings at commit b1fd05fc, Firefox 156.0.1): a
  tab-only line is 8 × (space + letter spacing) unless the tab is the text's last character, as in 16px Arial at −1, 0
  and 1px: 27.6, 35.6 and 43.6px. All of it is in whole app units, so a tab exactly the minimum from its stop takes it,
  and in Arial and Helvetica, where a space is half a `0`, a tab one space before a stop is one. Firefox's Canvas gives
  a width as a whole number of app units too, 60 to the pixel (`CanvasRenderingContext2D.cpp:5277, 7135-7140`), so the
  profile's position, rounded to app units, is Firefox's wherever Canvas's segment widths add up to the line's advances.
  A break comes only after a whole run of spaces and tabs (`nsLineBreaker.cpp:318-330`) and Firefox doesn't hang a tab,
  so a tab that doesn't fit goes to the next line with the word before it, from the last break whose line fits
  (`BreakAndMeasureText`, `gfxTextRun.cpp:1086-1101`), or, without one, alone, as break-word wraps before any cluster
  (:1069-1072): a later tab of the run too, while the spaces before it hang. The Gecko profile follows the stops, the
  minimum, the app units and the tab that doesn't fit since #395 (`letterSpaceTabStops`, `tabMinimumCharacter`,
  `tabsInAppUnits` and `hangTabs`, `src/measurement.ts`; `segmentAtLineBreaks()`, `src/analysis.ts`), not the spacing
  after a run's last character (ENGINE_FOLLOWUPS.md). Before it, tab-separated text without letter spacing (six texts
  such as `col1`, tab, `col2`, tab, `col3` in four fonts at 30-400px, 1,272 probe inputs recorded fresh) failed at 367
  widths in Firefox 156.0.1 and 39 in Chrome 154.0.8037.57, which skips a stop under half a space away, and at none in
  webkit-host, and runs of a tab, spaces and a tab (seven texts such as `ab`, tab, space, tab, space, `cd` in 16px Arial
  and 13px Menlo at 24-300px, 980 inputs) at 301 in Firefox; with it none of those fails. One of the 980 fails in Chrome
  before and after, on no tab rule: tab, space, tab, `indented with mixed white space` in 16px Arial at 24px, where
  Chrome keeps `whi`, 24.008px wide, on a line; none of them fails in webkit-host (2026-09-30 and 10-01). (Firefox 156.0
  source, 2026-09-16 and 09-27, and 10-01 for the first font's `0` and Canvas's app units.)

Elsewhere: a context used before Firefox reads its late family names keeps the fallback (PLATFORM_BUGS.md, the late
family names), and the joined Arabic study is under Content Language And Fonts, Widths That Depend On Context.

### Dead Ends

What was tried and lost, why, and what would reopen it; agents' work unless an entry says otherwise. A result holds for
its build, tests and surrounding code, and a thin or unchecked attempt is weak evidence (Chrome's word sums were written
off after one, then landed), so rerun the evidence before a retry if the code has moved (Part 1, Docs).

Terms used below. *Main before #340* is commit 6d1d2106, before #340 (2026-09-24) replaced Pretext's own break rules
with ports of each engine's break scans and tables. *The rebuild* is the per-engine rebuild (`rebuild/` on branch
`rebuild-20260916`): a from-scratch, unshipped port of each engine's line breaking over Canvas, kept as the plain-text
correctness reference, with its own harness, whose case sets are split into test tiers (Part 1, The Per-Engine Rebuild
And What Counts As Done). *The old suite* is `tests/wrapping`, main's test suite until the harness replaced it (removed
2026-09-25, runnable only from 6fadbe5); its numbers appear only where a decision rests on them. An *offline replay*
runs Pretext in Bun over recorded Canvas answers and browser lines, and a *stand-in Canvas* is a numeric imitation of
Canvas: both measure Pretext's own work, not a browser's, and a replay flags a change without judging it (Evaluation
Traps). The *emulation study* (issue #321, 2026-09-15 to 20) ran each engine's own break and shaping code offline.

A shared reopen condition, *contextual widths during preparation*, means measuring text in its neighbors' context at
`prepare()` time, which Chrome's `getTextClusters()` could make cheap (Engine Facts, Chrome).

#### The Measurement Model (March 2026)

A 3,840-case sweep with the maintainer (March 2026), where summed per-word Canvas widths got 3,838 right in Chrome; the
sweep's evidence was in this file until 2026-03-28 (removed in 2604c28f).

- **The space before the next word left out of the fit**: 82%; only a collapsible space ending a line hangs. Reopens if
  an engine is found not counting it.
- **Scaling segment widths** to the whole string's: 3,827; the error is uneven and changes sign by browser. Reopens if
  it proves proportional to width.
- **Character widths plus pair kerning** (uWrap's): 3,828, losing in-word shaping; only as a stated approximation
  without Canvas.
- **Whole-line Canvas widths**: 92.5%, as raw widths skip `prepare()`'s corrections, and quadratic grown per word (136
  ms in Safari against 0.11 ms). As a check near the width it fell to 99.8% raw, bringing back Chrome's emoji inflation
  the sum corrects, since the corrected sum beats raw `measureText()` of a longer string; corrected it changed nothing,
  and it needs text in `layout()`. Reopens with a Canvas call giving every position of a run, or a case where the
  corrected sum and the whole line disagree (the diagnostic mode on TODO.md).
- **Hidden DOM or SVG text** forces layout (Part 1, Limits).
- **Prior art** (2026-03-03): uWrap, canvas-hypertxt, chenglou/text-layout, tex-linebreak and foliojs/linebreak don't
  predict browser lines. pdf.js (read 2026-09-13): its lazy edit table through white-space normalization suits #90
  (source offsets for editing); its `scaleX` stretching hides mispredictions.

#### Rules Per Input Shape

Break rules main wrote itself before #340 replaced them with the engines' scans (2026-09-24), tried one fix at a time
on the old suite.

- **`Intl.Segmenter` word boundaries patched into break opportunities**: about 20 merge passes over 2,494 lines of
  `analysis.ts`, one rule per failing shape, with deciders near CJK that disagreed, so punctuation bugs kept returning
  (#274, #276, #290, #291, #293). With #340, `analysis.ts` fell to 343 lines and the scans took 869
  (`line-breaks.ts`), 794 (`gecko-line-breaks.ts`) and 520 (`gecko-bidi-levels.ts`), runtime source going from 6,391
  lines to 6,214, at 86 → 88 Chrome Canvas calls per real paragraph; "Fixing a mismatch" (AGENTS.md) forbids the
  pattern, so nothing reopens it.
- **A fix for issue #210 (a leading zero-width space lost at a line start) that loses nothing** (2026-09-11) needs a
  guard keyed to the failing shape: `ZWSP ب SHY ب` and `ZWSP Ꙝ SHY Ꙝ` prepare alike but take 2 and 4 Chrome lines at
  9-14.75 px, as do `CR ZWSP` and `LF ZWSP`. Reopens with contextual widths during preparation or a per-engine model of
  CR.
- **Broader rules for issue #225** (breaks inside date-time sequences and before a full-width comma; 2026-09-12):
  emergency breaks in punctuation clusters fixed 624-1,197 rows per browser and lost 108-510, Chrome's through errors
  that had cancelled; no break before `，` or `」` after Latin lost 42-52. Rules whose errors cancel land together, so
  build in layers.
- **Smaller rules**, moot since #340: #274's first fix, which reached too far (`中（ابب）`, `中文””tail`); a line-ending
  opening bracket after a word (browsers do it only at 1-26 px); merging punctuation, URLs or numbers into units (erases
  context the engines keep); Arabic pair corrections and phrase rules from single examples; Myanmar rules that split the
  browsers; Chrome quote rules fitted to one Mac's UI language.
- **Blink-style shaping-cluster overflow units** moved no row, helped only letter-spaced complex scripts, and cost 26-66
  ms on a page's first Myanmar `prepare()`, where V8 builds 172 script regexes behind their screen (no branch recorded).
  Reopens with the letter-spacing work (ENGINE_FOLLOWUPS.md), once that cold start is fixed.
- **A source-coordinate layer**, so storage could change without output changing, never earned its cost (no branch
  recorded): finer source positions don't create shaping information never measured.
- **A Firefox script itemizer** (175 lines, 16 KB of data), removed on 2026-09-24: it moved only 48 of about 20,000
  random mixed-script strings with stray marks, where Firefox 156 sides with the splits (two accepted cases). The bidi
  split went too, on 2026-10-01 (Bidi Levels; Decisions Log). Reopens if real text with such marks turns up.

#### Invisible Characters, Controls And Soft Hyphens

Mostly on main as it was then, measured with the old suite in installed browsers, 2026-09-11 to 09-24.

- **A ZWSP right after a forced break inside a word** takes its own line in all three browsers; copying that lost
  290-560 results per browser to six unmodelled behaviors. Reopens once joined Arabic widths and letter spacing on
  invisibles land.
- **Letter spacing on invisibles**: no gap anywhere lost 73 cases (2026-09-11); a 14-line patch went +442 / −172 on
  passes leaning on a cancelling bug (2026-09-23/24). Reopens with ENGINE_FOLLOWUPS.md, Letter spacing, on one
  per-grapheme spacing unit.
- **Lone CR, FF and VT per engine in pre-wrap** (2026-09-11): two prototypes lost 150-228 results each, as did deleting
  CR or making it a zero-width break; CR reaches every layer, so apps normalize line endings (README). Reopens with a
  model traced from the engines' line builders. In normal white space, where no engine breaks a line at one, the Gecko
  profile takes CR and FF out since #399 (Engine Facts, Firefox, CR and FF) and the WebKit profile a lone CR since #455
  (Engine Facts, Safari (WebKit), CR and FF).
- **Folding invisibles into their neighbors** (2026-09-15/16) lost 776 real rows in an offline replay, as controls got
  zero width where browsers give them width and soft hyphens and ZWSPs took spacing and width the page doesn't give
  them, and 1,887 Chrome and Safari rows in the old suite run in installed browsers, such as `a`, U+00AD, U+0301,
  U+00AD, U+0323, `b` at 7px in 16px Arial with letter spacing −4, painted `a` / `b`. Marking break bits (112 lost)
  became the design (Break Opportunities From Engine Data).
- **Invisibles left out of Chrome's Canvas strings** (in the rebuild, 2026-09-16) cost 325 line counts, as Canvas then
  joins emoji sequences and Arabic letters the page keeps apart; U+2060 in their place matches (Measurement Model), and
  a rule picking which to drop was fitted to the rebuild harness's scores.
- **NEL joined to its neighbors**: joined before, overlong words split at Canvas grapheme widths; joined both sides, a
  following mark took 12 px.
- **Soft-hyphen returns**: returning from a soft hyphen to an earlier break works only when isolated widths show the
  overflow and the break returned to is truly the latest. Returning past a break between two text segments, to the
  space or soft hyphen before it, lost 142 Chrome rows (2026-09-12), and the Chromium profile then kept the hyphen
  wherever such a break lay after its target. Chrome returns to that break itself, which the profile does since #446,
  now that each break the scan gives is a segment boundary (Engine Facts, Chrome, Soft hyphens). Both rules for a soft
  hyphen with no fitting opportunity lost hundreds (the #323 entries on `harness/accepted/`'s lists), Firefox's
  (4e6d4dd5, branch `archive/gecko-soft-hyphen-return`) 15 per direction. Those reopen with contextual widths during
  preparation.
- **Other returns from an unfit hyphen in rich inline** (tried for #369, 2026-09-27, Chrome 154): returning only to a
  break a pixel before its item's end, else to the break before the item, as Blink's `HandleOverflow` breaks earlier
  text items again at their width less one pixel, fixed 35 probe cases that main and the branch failed and lost 12 they
  passed, for want of two more of Blink's rules (a break inside a HarfBuzz cluster at its graphemes' share of the
  cluster's advance, and the hyphen a soft hyphen before a break-anywhere end takes); returning only to a break after
  white space, a ZWSP or a soft hyphen, as the plain-text walker does, fixed 8 and 77 Chrome cases of two probes and lost
  128 and 115, since Chrome returns to other breaks before an item too. Both reopen with those rules
  (ENGINE_FOLLOWUPS.md, Rich-inline item edges).
- **Firefox's bidi controls as zero-width glue the walkers look past** (branch `gecko-bidi-control-gaps`, 5bc0b58a,
  2026-09-27; Firefox 156.0.1), superseded by #368's analysis (Break Opportunities From Engine Data): fewer lines, but
  slower `layout()` in Firefox and slower shared walkers in Chrome and Firefox (Decisions Log, 2026-09-27, has the
  numbers). It would reopen only with a glue test the shared walkers pay nothing for.
- **A `glue` kind for no-break runs** (not zero-width glue, which stays) was a label, and a wrong one (Decisions Log,
  2026-09-24).
- **Firefox's white-space run ended at each bidi level run of one text** (fdacfde2 in #399's history, 2026-10-01;
  Firefox 156.0.1): the Gecko scan resolved levels where a white-space run met a bidi control before white space or a
  combining mark, ended the run where a level run starts there, and trimmed the first line's start after dropped
  characters, in 30 more runtime lines than the scan #399 landed (Engine Facts, Firefox, Text frames, has Firefox's
  rule). The scan resolves every paragraph as left-to-right, so of 62,132 probe cases it passed 2,298 that main failed
  and failed 771 that main passed. Of those, 242 were plain text in right-to-left paragraphs, all its plain-text losses
  but one: there RLM or ALM after Latin text or digits keeps the level of the white space before it, so `see`, space,
  RLM, space, `this` is 55.15px wide where the port gave it the 59.60px of a left-to-right paragraph, and RLM, space,
  `see this` keeps the space the port trimmed. The other 528 were rich items that start with a control at another level
  and white space after other content: an item's analysis takes its text to start a line, so the trim took the space
  Firefox keeps there, and items `Hello` and RLM, space, `world wide` at 57px came out as `Hello` with `wo` on its line,
  then `rld wide`. Telling the item's analysis that it follows content left 5 of 168 such losses on two probes, but the
  item's segments were then not `prepareWithSegments(item.text)`'s, which a fragment's cursors index; giving the item
  the gap of its leading white space left 49. The level pass also made the analysis of text that starts with RLM and a
  space 1.5-1.7 times main's (Bun's JavaScriptCore). It reopens with a `direction` option (TODO.md) and a rich item's
  analysis that knows it follows content.
- **A CR or FF kept as a control of no advance in the Gecko profile's normal white space** (a trial beside #399,
  2026-10-01; Firefox 156.0.1). Firefox keeps a CR or FF in its text run with no advance (Engine Facts, Firefox, CR and
  FF), and the Gecko profile already gives the other controls Firefox hides no advance and their letter spacing
  (`hidesControlCharacters`). The trial did the same for CR and FF: the profile's normal white space collapsed spaces,
  tabs and line feeds only, a CR or FF stayed in the text as a control segment, and the text's start still dropped one
  with the white space around it. It is Firefox's model where #399's, which takes the character out, is a premise with
  gaps: the trial gives a CR its letter spacing, keeps a space on each side of one, as in a sentence whose lines end in
  a space and CRLF, and keeps the break before a combining mark after one. But a control segment is text to the line
  walkers, where Firefox trims a CR or FF with the white space around it at a line's start and end: at a narrow width it
  took a line of its own that Firefox doesn't give it, and after a space that ends a line it kept that space from
  hanging at every width, where Firefox does only while the CR is on that line. Against #399, of 124,283 probe cases
  recorded in Firefox (35,935 with a CR or FF in normal white space) it passed 818 that #399 fails and failed 791 that
  #399 passes; at 24px and wider 582 and 208, the 582 holding 98 of such sentences. Of the pinned cases it passed 19 and
  failed 94, all 94 under 24px. It took 2 more runtime lines, before the profile field and the comment it would need,
  and a control segment has no break before it, so text with a CR leaves the simple line walk: offline in Bun, 60 words
  with CRLF at every sixth took 1.3 times #399's `layout()` time and 2.3-2.4 times its `walkLineRanges()` time, a
  hypothesis for Firefox. So #399 takes the character out: fewer lines, no case lost to a line of its own, and text with
  CRLF on the simple walk. It reopens with a segment kind that hangs and trims at line edges without collapsing into the
  white space beside it, or with a report where Firefox's two spaces around a CR matter.
- **A CR kept as zero-width glue in the WebKit profile's normal white space** (branch `cr-line-end`, 1a199d6c,
  2026-10-06; webkit-host, WebKit 22625.1.29.11.27). WebKit keeps a CR in its text item with no advance (Engine Facts,
  Safari (WebKit), CR and FF), and the build did the same: the profile's normal white space collapsed spaces, tabs and
  line feeds only, a CR stayed in the text as a zero-width glue segment, one that ended text before white space or ended
  the text left the source, and an FF became a control segment measured as U+0001. It is Safari's model where #455's,
  which takes the CR out, is a premise with gaps: the build keeps a space on each side of a CR, as on a blank line of
  CRLF text, counts a space before a CR that a line ends after, and gives the CR a line of its own in a box narrower
  than a letter. On the first probe ENGINE_FOLLOWUPS.md describes, layouts of texts built to hold a lone CR, of those
  without an FF in fonts off WebKit's fixed-pitch shortcut, its lines are wrong on 197 of 44,880 layouts at 24px and
  wider where #455's are on 335 (among the differences, 123 fewer on CRLF text with a blank line or a space before a
  CRLF and 40 more on texts of only white space and CRs), and on 200 of 2,388 under 24px against 809; of the pinned
  cases with a CR it passed 33 that main fails, 7 at 24px and wider, where #455 passes 8, the same 7. But glue has no
  break before it, so text with a CR between letters leaves the simple line walk: offline in Bun, 60 words with a CR
  between two at every sixth take about three times main's `layout()` time, a hypothesis for Safari, where #455's take
  about 0.75 of it; a text of only CRs and white space got a line where Safari has none; and it took a second set of
  white-space expressions, a second meaning for `'zero-width-glue'` that apps see in `kinds`, and a change to the
  harness's alignment of segments with their source. In a font on the fixed-pitch shortcut it is wrong where main is
  right, as #455 is. So #455 takes the character out, as #399 does for Firefox: one test and one loop, in text that
  holds a lone CR, no new segment, and the simple walk kept. It reopens with a report where Safari's two spaces around a
  CR matter, as in CRLF text with blank lines, or with a segment kind that takes no room and no break and stays on the
  simple walk.

#### Arabic And Joined Scripts

- **Arabic letters priced by joined form alone** (2026-09-11) lost 1,573-1,622 passing old-suite metrics per direction
  in Chrome and 743-857 in Firefox. Reopens with Firefox's per-grapheme ZWJ recipe gated per font (Content Language And
  Fonts, Widths That Depend On Context).
- **Firefox's joiner recipe** in the rebuild (U+200D after an in-word Arabic prefix) came from the rebuild harness's
  scores, not source, and is inexact per font (15 of 33 breaks right in Amiri); removing it cost 77 line counts, and
  where it isn't exact the rebuild reports its named gap `in-word-prefix`. Canvas totals can't find the fonts it
  misses, so it reopens with font files.
- **Lam + alef as one cluster, by letters** (in the rebuild, 2026-09-20), fixes Arial and breaks Amiri and the Noto
  fonts, and no Canvas test tells them apart (the U+200D test is wrong for four of five two-cluster fonts and blind for
  Geeza Pro). One cluster suits 26 of 31 installed families, the macOS and Windows fallbacks among them; two suit the
  other five, Amiri and the Noto fonts among them, and the Android and ChromeOS fallback, Noto Naskh Arabic; main,
  summing isolated widths, gets 7 of 20 constructed cases right and the rebuild 12. Don't land it or retry the U+200D
  test; the default waits until main breaks overlong Arabic words by cluster (ENGINE_FOLLOWUPS.md).

#### Kerning

- **A `fontKerning` option** (#216, #199; declined 2026-09-12, trackers open): Safari's OffscreenCanvas ignores it,
  Safari's following-space kerning would have to switch off too, and it's public API for a rare setting. Reopens when
  someone needs `font-kerning: none`, or Safari honours it.
- **Only a word's end measured with its space**: inexact by the 8.0-million-pair census (Kerning At Line Edges); reopens
  with a bound from font data.
- **Other shapes of Safari's space-kerning rule** before #311's (2026-09-15): none across format characters (33 rows
  lost), a narrower rule, kerning only under letter spacing, and direction marks as non-letters.
- **Chrome Canvas kerning settings** (`optimizeLegibility`, `fontKerning`) shape whole strings in only some fonts and
  turn features on for every measurement (Engine Facts, Chrome). For kerning with spaces (Kerning At Line Edges), a
  word measured with the U+0020 on each side of it under `fontKerning = 'normal'` gave Chrome's kerning in Arial,
  Avenir Next, Gill Sans, Roboto and PT Sans and none in Helvetica, Times New Roman, Trebuchet MS, Didot, Optima,
  Palatino or Hoefler Text, whose pairs are in the legacy `kern` table; `optimizeLegibility` added Times New Roman
  only. On the masonry cards (41,888 pairs) Helvetica kept its 70 wrong line counts and Trebuchet MS its 56 under
  both, and on the harness both fixed 4 or 5 of the sample's 11 kerning failures and lost one or two of its passes,
  for 66% more `measureText` calls on the sample. In the default state the same measurement changes nothing, since
  Canvas cuts at the U+0020 (pinned Chrome 154, 2026-09-30). The profile uses `fontKerning` only to learn, once per
  font, whether it kerns with the space.
- **A word measured whole with its spaces in Chrome**, U+2028 standing for them, as the WebKit profile measures a word
  with its U+0020: exact for the word, and it fixed 10 of the sample's 11 kerning failures, but every distinct word
  costs a second Canvas call for the space after it and a third for the space before it, 67% more calls and 118% more
  submitted units on the harness's sample and 183% more calls on the masonry cards in one font, where the edge
  characters cost 18%, 10% and 1.4% (8.9% and 70% on the sample since each font is asked first). With only the space
  after the word, the WebKit profile's rule, it fixed 2 of the 11: in Arial and its like the kerning is nearly all
  between a space and the capital after it (pinned Chrome 154, 2026-09-30). Reopens if a font's kerning with the space
  is found to depend on more than the edge character, as it does for a comma or a full stop in a run of a script the
  font shapes otherwise (Kerning At Line Edges): there only the mark's word shows the run it is shaped in.
- **A word's kerning with a hanging space left on the word** (built first and carried through three iterations,
  2026-10-01): Chrome's rule for start-aligned text with no decoration or background, the only kind the harness records,
  where it fixed 64 Chrome cases against the profile's 43. In centered, right-aligned, justified or underlined text, and
  in text directly in an element with a background, its errors were a line fewer than Chrome and its shrink-wrapped box
  made Chrome wrap again (Kerning At Line Edges has the table). It also needed to know where each font's kerning sits, a
  Canvas call per font. Reopens with an option on `prepare()` that says which kind a text is.
- **Every font's words asked about, with no question to the font first**: 18.1% more `measureText` calls on the sample
  against the question's 8.9%, and in fonts that kern nothing Chrome 154's bench read seen text 2.9% slower in Latin,
  3.8% in CJK and 1.6% in mixed text, where the question read every row within noise (two sessions, 2026-10-01). It did
  close the question's gap, the seven families whose only pairs with the space are outside ASCII.
- **Chrome's kerning with spaces as a pass over the spaces after the segment loop**, in a file of its own shaped like
  `src/han-kerning.ts`, reading each character's kerning from paged tables (built and validated on branch
  `chrome-space-kerning-pass`: 0 of 42,881 Chrome predictions differed, 0.7% fewer calls on the sample): the segment
  loop was main's again and a cached segment kept three fields, but it was 2 code lines shorter, not the 10 to 20
  expected, and Chrome 154's bench read Latin seen text 3.6% slower in Arial and 3.0% in Gill Sans than keeping each
  word's kerning on its cached segment (two sessions, 2026-10-01). With two Maps in place of the tables it read 13 to
  17% slower offline. Reopens if the segment loop's added state is found to cost elsewhere.
- **Two premises that only shorten the Chromium profile's kerning** (built and measured on branch
  `chrome-space-kerning-premises`, not taken, the maintainer's call): no kerning for the space after a closing bracket
  or a character of several scripts, which deletes `readScriptRuns()` (22 code lines; the space in `(see above) The`
  stays 0.20 to 0.87px wide in 16px Arial and up to 2.80px in Gill Sans, 38 more wrong of 46,400 generated interface
  layouts, 3 of the sample's 11,901 paragraphs with one line 0.25 to 0.31px wider and no break moved), and none at a
  word's edge that is a default ignorable (5 lines; 17 generated harness cases fail again). Chrome 154's bench read both
  level with the profile in Arial (two sessions, 2026-10-01), so they buy lines only. Since letter spacing reads the
  runs through the same reader (2026-10-02), the first premise deletes nothing: `readScriptRuns()` stays for the cursive
  rule.
- **A reader of script runs for each rule, and the space's run read with no search back.** The kerning's own reader,
  beside the letter-spacing rule's (#397), took 20 code lines more than one for both and had a kerning off in 10 of 25
  probe strings in 16px Arial (Kerning At Line Edges). With one reader, a build that reads the runs up to every word
  asked about, without the search back for the nearest character of one script, is 9 code lines shorter and predicts
  alike, but then reads every text with such a word whole: offline it prepared seen Latin text 4% slower in a font like
  Arial, 14% slower where a quarter of the characters kern with the space, and Cyrillic text 68% slower there (Node 23
  on a stand-in Canvas, one run of 30 rounds each, a hypothesis for the browsers and not benched, 2026-10-02).
- **WebKit letter-spaced ligatures** (in the rebuild, from 2026-09-17; Measurement Model): no separator sets two letters
  unligated in one shaping call (U+200C ends the simple path's call, U+034F doesn't stop the ligature, U+180B brings a
  fallback glyph), and a group heuristic was 1.9 px off; a styled connected `<canvas>` would fix about 721 cases but is
  DOM, and a library-made `FontFace` is font loading. An app-declared features-off family, bit-exact on 1,274 strings,
  is a new kind of fact, not built. Reopens when WebKit fixes Canvas `letterSpacing`, or if the maintainer accepts that
  kind of app-supplied fact (Part 1, Limits).

#### Fitting, Cuts And Fast Paths

Mostly in the rebuild, 2026-09-15 to 09-24, each result attacked by a second agent with cases built to break it. Blink
cuts a shaping group of 256 zoomed px or more into pieces, and the rebuild's Chrome port has to find the same cuts;
below 256 px, Canvas totals are exact (Engine Facts, Chrome).

- **Finding Chrome's cut without asking Canvas** (2026-09-20) passed every test tier yet moved layouts in 196 of 318
  installed font families (a pair window can form an `fi` the group doesn't). The rework asks Canvas only what can
  change the answer and keeps 57-60% of the saving with no layout moved (`rebuild/research/PERF-B1B-REWORK.md`);
  changes to the cuts now first pass the all-fonts probe, which compares cuts, positions and lines in every installed
  family.
- **Chrome word sums, first attempt** (2026-09-20): 2.04 → 0.84 s, but seven of 318 families wrong, as AAT `kerx`
  carries state across spaces that Blink's safe-to-break test checks only in GPOS and GSUB. The first attempt was a
  single unchecked one, so weak evidence against the idea; the second, cutting only where the safe test passes, landed
  (`rebuild/research/SPEC-WORD-SUM.md`).
- **Skipping cuts by font grain** (2026-09-20) needs a power-of-two units-per-em and a whole device size, so fails at
  1000 units, at 1.25× and 1.5× and under zoom. Reopens with a `unitsPerEm` read from the font.
- **A float32 error bound**, cutting exactly only near it (2026-09-20): 1.16× slower, and a 512 px target made resizes
  47-60% slower. Reopens with a representation handling both precision and the cold-prefix cost.
- **Admission and fit rules** (no reopen recorded): emergency-prefix differences for every admission; choosing by
  prefix-measurement mode; Safari's inferred carried adjustment on every prefix; Firefox's 1/60 px box rounding in line
  fits (regressed unrelated cases). Canvas's letter-spaced widths everywhere were on this list for losing ligatures,
  which the pages lose too: #397 measures letter-spaced text under a Canvas spacing too small to add width in the
  Blink and Gecko profiles (Measurement Model).
- **Canvas widths at the text's own letter spacing** (2026-09-30): they would need a cache per spacing, and each Canvas
  spaces otherwise than its page. Chrome's gives digits and brackets beside an Arabic word the gaps the page's Arabic
  run leaves out (`123` right after an Arabic word at 4px: 3 gaps in Canvas, none on the page, Chrome 154); Firefox's
  spaces joined Arabic letters and rounds half an app unit up (PLATFORM_BUGS.md); Safari's keeps ligatures. So the
  spacing is added in JavaScript by each engine's rule (`src/prepare.ts`). Reopens if the Canvases come to agree with
  their pages.
- **A Canvas check in `layout()`** near the width gained one case and lost one, and `layout()` makes no Canvas calls
  (AGENTS.md, Implementation notes), which a cheaper Chrome recipe from the emulation study would need too.
- **Gecko prefix fits from 24px, or everywhere** (2026-09-27): the 24-80px lines they fix cost too much in preparing new
  text (Break Opportunities From Engine Data). Reopens if prefixes get cheaper, or real usage shows the gap.
- **Other forms of the Blink profile's fit of a cut word** (#435, 2026-10-04, each one build scored once in Chrome
  154.0.8037.57 on every pinned case, the 18,382 probe layouts and nine joined-script words). From pairs alone it fixes
  the same 39 cases and fails 2 anew, `a  سلاملاtail` in 32px Arial at 26.6px and 26.7px, whose second lam-alef comes to
  17.4px from its pairs for Chrome's 19.2px; it passes 18,155 probe layouts and 4 of the nine words. From prefixes alone
  it fails 1 anew, `بِبِ((()))tail` in 24px Amiri in a 1px box, whose prefixes shrink as Latin letters join the
  brackets, and costs 8.9% more calls and 15.5% more units on the sample, and on the bench's texts 145% more calls for
  long breakable runs, 186% for keep-all Japanese with brackets and 156% for a list of distinct links, where pairs cost
  16%, 42% and 54%. Pairs checked against the word's width, with prefixes where they don't add up, fail neither, pass
  the prefixes' 18,191 and 5 of nine, and cost what pairs do but on Arabic prose, 3.3% more calls on the bench's Arabic
  book for 1.5%. With no line-start widths, pairs or prefixes failed 7 or 8 cases anew at 24-80px. The same fit for
  letter-spaced words, in a build that sent digit runs through it too, passed 51 more accepted cases, 41 of them with a
  line more than 1px off, failed 5 more anew and turned 28 more accepted failures into wrong line counts: a letter
  measured alone is its isolated form, which a line of joined letters doesn't start with. All 84 cases that build moved
  were letter-spaced, so it says nothing of digit runs, which no build here scored alone (ENGINE_FOLLOWUPS.md, Emergency
  breaks inside a word, has a later count). And measuring a letter-spaced word's letters before its prefixes, to skip
  the prefixes of one that adds up, moved 16 Amiri cases through what Chrome's Canvas remembers (PLATFORM_BUGS.md).
  Reopens with a line start measured as its first two graphemes together, which keeps joined forms.
- **Cheaper forms of the Blink profile's fit of a cut word, for new interface labels** (#435, 2026-10-05, each a build
  whose calls were counted on Chromium's 7,000 labels and which was scored once in Chrome 154.0.8037.57 on every pinned
  case and on the 13,090 probe layouts of Break Opportunities From Engine Data; the percentages are `measureText` calls
  over the sums, on all the labels, on the batches the bench's `new: labels` row times and on the real-usage sample,
  where the fit as landed reads 10.1%, 10.7% and 7.2%). None gives the fit's advances for less, and none is taken: each
  gives up layouts the fit gets right, on a premise that real fonts break, and the fit lands as it is (Decisions Log,
  2026-10-05). The builds are on local branches that #435's description names.
  - Words holding a letter of a joined script left to the sums, since the premise is wrong for them: 9.5%, 10.6% and
    7.2%, as no word of Arabic letters alone reaches 80px at 13px. 23 pinned cases fail anew, 19 of them wrong line
    counts, and 848 of the 986 Arabic probe layouts fail in place of 577. A dead end: the sums are much further from
    Chrome there than the prefixes.
  - The pairs asked in the word's order only until what they hold accounts for the word's width, the letters after that
    keeping their widths alone: 8.4%, 9.2% and 5.0%. It takes the premise of a word that adds up for the rest of a word,
    and fails the same way, where kernings after the stop cancel, which a font's few kerning values make common: 3
    pinned predictions change a width and none fails (`certificat`, cut from `certificates` in 24px Inter, comes to
    100.51px for Chrome's 100.75px, its `ca` and `te` kerning 0.234px each way after `rt` has held the word's 0.375px,
    and a lam-alef of `سلاملاtail` in 32px Arial to 17.41px for 19.22px, the word's first two pairs holding by chance
    all of its 14.72px, so that its prefixes are never asked), 1 more label layout of the 5,077 fails
    (`approvata}other{#` in 13px Inter at 50px), and 2.00% of the passing probe lines are more than 0.05px from Chrome's
    in place of 1.87%. Not taken: a sixth of the added calls, for widths that are off wherever a font's kernings cancel.
  - The same, counting first the pairs the font has measured already: 5.9%, 6.2% and 4.3%, with 1 pinned prediction
    changing a width and no probe layout. A word's advances then depend, where kernings cancel, on which texts the font
    met before it, which nothing in Pretext does by its own doing, and so it isn't taken.
  - A floor of 90px for the Blink profile: 7.8%, 8.0% and 5.8% (6.6%, 7.0% and 4.0% with the stop). No pinned case fails
    and the sample's 7 hold, the narrowest of their words being 90.6px, which is the only reason for 90. Words of
    80-90px go back to the sums: 32 of the 5,077 label layouts fail, 5 of them in boxes of 80px or wider, and 710 of the
    986 Arabic ones. Not taken: the floor would sit 0.6px under a real case's word, for no browser reason.
  - A floor of 100px: 5.9%, 5.9% and 4.7% (5.0%, 5.1% and 3.2% with the stop). 28 pinned cases fail again, 18 of them
    wrong line counts, one a real-usage draw, a 90.6px Ukrainian word in a 12px Times New Roman label in a 69.83px box
    with the right line count and a letter on another line, so the sample's failing draws in claims are 23; 59 of the
    5,077 label layouts fail, 18 of them in boxes of 80px or wider, and 793 Arabic ones. Not taken: it loses a
    real-usage draw.
  - No pair asked: what a word's width differs by from its letters' is spread over the letters in proportion to their
    widths, and a line that starts inside the word starts with its first letter alone. 0%, 0% and 0%: the sums' calls
    and units in every set. It takes a word's kerning to be even along the word, which every kerned font breaks: the
    kerning sits at one or two pairs (`AT`, `T,`, `//`), and a line far from them is charged kerning it doesn't have. Of
    the sample's 7 it keeps 6 and loses a 346.4px link in 16px Roboto at 287.44px, a letter short as from the sums, and
    it fails a draw that the sums and the fit pass, `https://docs.google.com/document/d/1a2B3c4D5e6F7g8H9i0J/edit` in
    16px Inter at 282px, whose kerning is in `7g` and `J/` near its end and whose first line takes a letter too many, so
    the sample's failing draws in claims are 24. 44 pinned cases fail that the fit passes, 15 of them wrong line counts,
    and 11 of the 44 pass from the sums; 91 of the 5,077 label layouts fail, 9 of them wrong line counts and 34 of them
    layouts the sums pass, and 708 of the 986 Arabic ones. It can give a line too few: `{NUM_GROUPS,plural,` in 14px
    Roboto at 70px, whose one kerned pair is `ra`, by 0.27px, is 3 lines in Chrome and 2 from the spread. Not taken: it
    breaks real-usage text that the sums get right.
  - The same under 160px, and the pairs from 160px: 1.6%, 1.6% and 2.4%, and 15.4% over German labels alone. The
    sample's 7 hold and its failing draws in claims are 22, as with the fit, since every draw the spread loses is a link
    of 346px or wider. 34 pinned cases fail that the fit passes, 10 of them wrong line counts, and 5 of the 34 pass from
    the sums; 71 of the 5,077 label layouts fail, 7 of them wrong line counts, where the fit fails 4: a word of 80-160px
    keeps the spread. Pairs from 120px cost 3.3% on the labels for the same pinned cases, and from 240px 0.5% for 6 more
    lost; 160 has no browser reason. Not taken: it is the spread's premise, kept to label-sized words.
  With the spread and no floor, a scratch build passed 59 more pinned cases, 45 of them with Arabic letters, and failed
  25 that pass, 18 of them in boxes under 24px, with no draw of the sample moved; the 25 weren't attributed. Reopens
  with a Canvas call that gives every position of a run, as `getTextClusters()`; with an option that tells `prepare()` a
  text is never cut inside a word (TODO.md, the API discussion); or with an app that shows the added calls as time its
  users wait.
- **Safari's rule for a cut word, in part** (#435, 2026-10-04, four builds of the WebKit profile, each scored once in
  webkit-host on 44,448 pinned cases). WebKit keeps the longest prefix that fits, measured from the line's own start,
  and gives the rest of the word the width left over without measuring it (Engine Facts, Safari, Overlong words).
  With a line's first letter measured alone in every word, 83 accepted cases passed and 175 failed anew; with the
  width left over carried too, in a prototype's third cursor field, 146 and 195; with both only in words of 80px or
  wider, 21 and 54. The new failures are joined Arabic in boxes under 80px, where a letter alone isn't what a joined
  line starts with, and words cut into many pieces, whose lines add up to more than the word once the rest isn't
  carried. The line's first grapheme and its first two, measured together, matched webkit-host on 571,857 probe
  layouts in an offline count that cost 44-62% more calls; no build of it was made. Reopens with a cursor that carries
  a line's start width (TODO.md, the API discussion) together with that line start.
- **Half of a pair's kerning on the letter before a cut, in the Gecko profile** (#435, 2026-10-04, one build of the
  profile, scored once in Firefox 156.0.1 on 44,205 pinned cases). Firefox adds up the advances a word's letters have in
  the word shaped whole, wherever a line starts, so the letter before a cut keeps its part of the kerning with the
  letter after it, which a prefix measured alone doesn't have (Break Opportunities From Engine Data). For a letter whose
  advance after its prefix isn't its advance alone, the build asked Canvas, before the ligature rule's question, whether
  the pair with `fontKerning` off is as wide as its two letters: that is kerning. Canvas totals hold both halves of a
  pair's kerning wherever both letters are measured, so at the text's size they don't show which letter holds it, and
  the build took a premise: the letter before a cut keeps half, in every font. That is exact, to an app unit, for a font
  that splits kerning, and #421's three texts laid out as Firefox does, each line within 0.01px. A font that kerns
  through GPOS, as most web fonts do, keeps half of the prefixes' error on each line, in the same direction, and a
  paragraph whose errors cancelled can gain or lose a line: `AV` twelve times in 16px Arial at 76.8px is 8, 8, 7 and 1
  letters in Firefox, 7, 8, 8 and 1 from the prefixes and 8, 8 and 8 with half, whose last eight come to 76.46px for
  Firefox's 77.05px. With it and the ligature rule 107 predictions differed from the prefixes alone, 6 of them the
  ligature rule's, and 4 more accepted cases passed, all wrong line counts before, and none more was lost. On 27,884
  probe layouts of words cut between letters in 55 font rows, 23 that split kerning and 26 that don't, the prefixes were
  wrong in 1,097: half fixed 490 of them and lost 8, all 8 in fonts that split kerning, and in the 26 GPOS rows lost
  none of 12,876, turned 16 from the right count with a letter on another line into a wrong count, 2 the other way, and
  48 from a wrong count into Firefox's lines; all of the kerning on the letter before fixed 723 and lost 237; each
  font's own placement fixed 753 and lost 10. On a second probe of 10,011 layouts, of made-up paragraphs, real-looking
  long words and a sweep of 70 widths, half turned 9 from the right count with a letter on another line into a wrong
  count, 8 of them `AV` runs in Arial, Roboto and Inter and 1 the placeholder
  `{MULTI_GROUP_TAB_COUNT,plural,=1{Tab}other{Tabs}}` in 15px Inter at 67.6px (7 lines in Firefox, 8 with half), and 21
  from a wrong count into the right one, and failed none that the prefixes passed (the probes' strings were chosen to be
  cut inside kerned words, so their rates aren't real text's). In a joined script the kerning question reads a kerning
  the word may not have, since a prefix's last letter has the form it takes at a word's end: `بالأخبار` in 32px Geeza
  Pro at 52px is `بالأ`, 35.67px, and `خبار`, 51.57px, in Firefox and from the prefixes, and three lines with half,
  which moved half of 1.77px that the word's initial `خ` doesn't have; of 924 probe layouts of Arabic words of 80px or
  wider in 32px Geeza Pro, half turned 20 into Firefox's lines and 6 away from them. Left out (Decisions Log,
  2026-10-05). Reopens with `getTextClusters()` in Firefox, or with a probe of each font's placement: Firefox rounds
  each glyph's advance to an app unit, so a pair measured at the text's size and at a much larger one shows which letter
  holds the kerning, at 6 to 90 `measureText` calls for a font that kerns (the per-engine rebuild's recipe, which told
  47 of 49 font rows and none wrongly).
- **A question about kerning before the Gecko profile's ligature question** (#435, 2026-10-05, one build, Firefox
  156.0.1, every case predicted once). Whether the pair with `fontKerning` off is as wide as its two letters, asked
  first, settles a kerned pair in one Canvas call, where the ligature question takes two, the pair as it stands and
  without its ligatures; a ligature or two joined letters then take three. No prediction of 44,235 differed. The sample
  took 2.5% more `measureText` calls than the prefixes alone, for the one question's 3.1%, and the books 0.9% for 0.7%.
  Not kept: a second Canvas state to set and restore and ten more lines, for 0.6% of the sample's calls. Reopens if text
  of many fonts with few words in each comes to matter more than those.
- **Three more removals from preparing rich text, and two trades** (2026-10-05 and 06, each a build on the
  one-paragraph design timed against it: the engines' shells on a stand-in Canvas and background browsers, so
  hypotheses, and foreground runs of the bench's `rich-new` row, which called none of them). A font's space and
  hyphen-minus widths kept on the font's measurement, beside its Map of widths, take two Map lookups off each text and
  each rich item: the shells read new rich text 1.3% (SpiderMonkey), 2.0% (V8) and 3.1% (JavaScriptCore) faster with
  warm code, and of the background browsers only webkit-host resolved it, at 5.7% of a fresh page. But with them
  Firefox 156.0.1 read `measureLineStats()` over the bench's CJK messages 3.9% slower than main and `walkLineRanges()`
  10.8% slower in three foreground sessions, and 4.5% and 11.0% in the background at the commit that added them, where
  the commit before it read level (+0.2% and +1.2%): the signature of a handle whose whole widths are stored as int32
  values (JavaScript Engines, How a width is stored). The space's width, read off the measurement, goes into the
  expression that gives each segment its width, and SpiderMonkey then keeps a whole width an int32 where main's code
  makes it a double; that reading of the cause wasn't tested further. Not kept, as a gain shown in shells for a loss
  measured in a browser. A memo of the last white-space item's space, for a run of such items in one font, read 2.1%
  faster in Firefox over 70 foreground sessions and level in Chrome and Safari. Its gain is the bench's shape, where
  3,447 of 7,040 rich items are white space alone in one font; an app's one item per styled run has almost none, so it
  isn't kept. A text's script runs made only where its kerning with spaces or its cursive spacing reads them, with one
  shared empty set of halts, takes three small allocations off each text: JavaScriptCore's shell read it 2.7% faster
  and SpiderMonkey's and V8's 0.9% and 0.1% slower, and of the background browsers Firefox read 1.6% faster and the
  others level, a gain in one engine and not the same one twice, so it isn't kept either (Part 1, Engineering). The
  hyphen and tab lists of a paragraph, made only when two of its fonts differ in one, read 4.2% faster in webkit-host
  and level in the others on the bench's text, whose fonts agree, and 2.1% and 3.7% slower in V8's and
  JavaScriptCore's shells where a bold word makes them differ. And where each segment sits in its item's text, found
  when a line is first materialized, read 2.0% faster in webkit-host and about 2% and 1% in Firefox and Chrome, and
  made the first materialize 41-50% slower. Those two are trades, not taken. The font's two widths reopened in part
  on 2026-10-07 (Rich Inline As One Paragraph): the space's width alone is kept on the font's measurement, and
  Firefox's CJK line rows read within 0.6% with it, over three foreground sessions of the three removals together, so
  the space's width in each segment's width, the cause read above, didn't bring the loss here; the hyphen-minus's width
  alone wasn't timed in Firefox. The hyphen-minus stays out whatever stores a handle's widths: with it, JavaScriptCore's
  shell kept failing one type check of `measureAnalysis()` in its middle tier, where the hyphen-minus is a whole number
  of pixels in some fonts and a fraction in others, and read rich text prepared again 13-18% slower in 5 of 6 processes
  (2026-10-06, a hypothesis). The hyphen and tab lists came back the same day in a form that is no trade: made only for
  a paragraph whose text holds a soft hyphen or a preserved tab, which is all a walk reads them for, so a paragraph
  whose fonts differ makes none unless it holds one. The rest reopen with an app whose rich text is new on most frames.

#### DOM And Canvas-Element Paths

- **A hidden `<canvas>` on the page** for Safari's page-language fonts (2026-09-11) forces style recalcs (3.3 s against
  33 ms on a 20,000-element page, headless), and was rejected as DOM access on 2026-09-12 (Part 1, Limits). In
  Safari 27 every element context updates styles per call (20-91 ms after one `insertRule`), and only attached ones
  follow the page language (Content Language And Fonts, Safari's Generic Families). Reopens if WebKit #285993 gives
  Canvas an inherited `lang`.
- **Firefox on a `<canvas>` element** for `system-ui` and optical sizes (in the rebuild, 2026-09-18/19): light
  (1.03-1.06× OffscreenCanvas's time) until a page inserts CSS rules, when a kept context updates styles in every
  `measureText` (104-113 ms against 0.26 ms over 200 inserts) and each live one joins the refresh driver; its font check
  reads a Gecko internal before every call; and workers have no element canvas, so it failed the conditions set on
  2026-09-19, that it be light and work in workers (Decisions Log, 2026-09-18;
  `rebuild/research/FIREFOX-CANVAS-ELEMENT.md`). Unmerged OffscreenCanvas alternatives in the rebuild: optical sizing
  for system keywords only (name-keyed), and synthetic bold confirmed from Canvas (9 rows). Reopens if Firefox
  `system-ui` becomes a priority, Mozilla #2020917 is fixed, or an app hands Pretext its own canvas.
- **A `direction` option** (2026-09-12): Chrome measures brackets about 0.5 px apart by the `<html dir>` read at context
  creation (189 old-suite line counts on a flipped page). A `prepare(…, { direction })` prototype fixed Chrome and lost
  11 Safari rows, and re-reading `<html dir>` is hidden state (Part 1, Limits). Reopens in the API discussion
  (TODO.md).
- **Painting each block natively** (`<p dir="auto">`, a ResizeObserver correcting rows) gives up exact heights (Part 1,
  Demos And The Chat).
- **`devicePixelRatio` read in `layout()`** for Chrome's device-pixel fit (2026-09-15) is hidden state that changes
  between displays; a DOM probe for the fit tolerance was superseded as new DOM work. Reopens in the API discussion,
  with the grid's measured effect (Measurement Model).
- **Healing stale Firefox contexts**, left on the fallback when used before Firefox reads its late family names (in the
  rebuild, `rebuild/research/CONTEXTS-HEAL.md`): a page contract (no event tells the page), a never-seen font-string
  spelling to force a lookup (leans on a private cache, grows forever), refusing contexts whose families don't all draw
  (common lists fail it), a witness string (equal widths don't prove equal fonts), and `document.fonts` or a sentinel
  element (DOM reads). Reopens if Firefox tells Canvas font groups about `font-info-updated`.

#### Tables, Bundles And Data

- **Firefox's line data in Chrome's format** (2026-09-26; branches `ff-table-format-bmp` and
  `ff-table-format-ranges-first`): 8.7 KB of state machines for Firefox's 0.8 KB pair table, 38 to 482 bytes saved by
  packing Firefox's data against Chrome's, or Firefox's classes read through Chrome's code-point lookup, exact on every
  code point and 3.2 KB off 55 KB gzipped, with refreshes still one generator step, but slowing Firefox's Arabic,
  Hebrew, Hindi and Urdu analysis 13%, or its first `prepare()` by up to 2.3 ms (offline, in Bun), and tying Firefox to
  Chrome's table, which costs nothing while one bundle serves every engine and would be a loss with a bundle per engine
  (Decisions Log). The sizes behind the question were mixed units: Firefox's line data, called the largest table at 19.7
  KB, is that unpacked, and 9.8 KB of base64 and 7.0 KB gzipped as shipped, less than Chrome's root line table (15.0 KB
  and 9.5 KB), which no option targeted (Break Opportunities From Engine Data has each table's share). The run list of
  #394 shares the engines' classes in the module only: each map still unpacks to a table of its own, so a lookup takes
  no remap. Reopens with the table-size question, as 3.2 KB against that Firefox cost.
- **One bundle per engine** (372-788 KB minified, measured on the rebuild), ruled out for now on 2026-09-26 (Decisions
  Log). Reopens if apps ship per-browser builds; an app picking an engine's entry point itself with a dynamic import
  wasn't weighed.
- **Tables shrunk by computation**: remapping onto base classes fails for Chrome's Chinese table (`〜` and `゠` need a
  class the base lacks), and runtime state machines mean porting ICU's rule compiler, where today's tables need no
  upkeep between refreshes. The shorter form of #394 computes nothing of the kind: it stores each table's own classes
  and rows, and Chrome's Chinese table whole. Reopens with the table-size question.
- **Dictionaries or ICU4X's LSTM model** for Thai, Lao, Khmer and Burmese (2026-09-25; weighed, not built): hundreds of
  KB each, and a JavaScript copy of Firefox's model is expected to run slower than Firefox's own, which wasn't
  measured. Reopens for runtimes without `Intl.Segmenter`.
- **`Intl.v8BreakIterator` for Chrome's breaks** (the emulation study, 2026-09-16 to 09-20) drops `-u-lb-*` keywords,
  lacks Blink's fast table, space rule and CSS handling, is gone from Node and Deno, and saves nothing while Safari
  needs the tables. Reopens if `Intl.Segmenter` gains a standard line granularity (Stage 1 since 2021).
- **Safari's libicucore tables shipped whole** (26c3e231, branch `archive/safari-line-tables-whole`, 2026-09-16): 75
  fewer runtime lines for about 30 KB more gzipped; overtaken by packing each table against an earlier one.
- **One bidi resolver with per-engine switches** (in the rebuild): ICU isn't structured like UAX #9 (brackets pair while
  explicit levels are computed; weak and neutral rules resume after isolates), so nine or more switches, redone at every
  ICU roll (Bidi Levels). Reopens only if Blink and WebKit stop running ICU's resolver.
- **A hand-written `.d.ts` for the README's API glossary** (2026-03-17): nothing checks it against the implementation
  but a bridge that drifts the same way, so the README keeps its glossary instead; reverted (Part 1, Docs).

#### Caching, State And API Designs

Studied 2026-09-13 to 09-30, mostly in Bun on a stand-in Canvas with the results checked in Chrome, against the cost
model below; most are parked for the API discussion (TODO.md), not refuted.

- **Handle-free layout over a size-limited global table** (2026-09-26): the chat lays out all 18,613 blocks per width
  change, so a smaller limit always misses, the app must say which texts are alive anyway, and the lookup alone is
  10-38% of the height pass. Reopens if apps can control lifetime cheaply.
- **Keyed state** in a WeakMap on the app's object (2026-09-26): 1.1-1.5× slower heights, nothing faster, and wrong
  lines across differing options. Its value is convenience and making incremental prepare possible; reopens if that's
  needed.
- **The width memo** (2026-09-26), handles that remember the range of widths their last lines hold for: exact over 137
  million fuzzed checks, and alone it drag-resized 10,000 messages under 1 ms, but new widths ran up to 26% slower in
  Chrome, more than the slight worst-case regression allowed (Part 1, Engineering; Decisions Log, 2026-09-26), and it
  cost about 155 lines and immutable handles. Reopens as the untried variant that keeps a memo only for multi-line
  texts, if the worst case stays flat.
- **Width ranges in the chat** (draft #280, branch `exact-height-intervals`, 2026-09-14): 1 px drags at 10k went 3.5 →
  0.3 ms, but ranges are 3-7 px wide, so random jumps got about 10% slower, for 440 more lines; and line counts needn't
  fall as width grows. Reopens if small drags at large histories matter.
- **Incremental prepare** (#313, 2026-09-13 to 09-26): restarting at the last word start before an edit was exact, but
  bookkeeping costs 0.6-3.3 ms at 100,000 characters, beating a handle per paragraph (README, #362) only on one long
  break-free text; `prepareEdit` (12-41× faster) hid a bug 135,000 random edits missed, and appends can rebreak the old
  tail, so `prepareStream` (#153) wasn't built. Which old line survives needs the new text's break data, so reuse keys
  on what is prepared, not the source, as WebKit's early restart shows (`InlineInvalidation.cpp:388-389`); every
  stateful prototype had a stale-result bug (`rebuild/research/INCREMENTAL-API-READING.md`). Reopens if long break-free
  texts edited live matter.
- **The font given at layout time**, `prepare(text)` only analyzing (2026-09-26): analysis is 50-86% of a warm
  `prepare()`, so one text in two fonts saves about 30%, per-call matching uncosted. Parked for the API discussion as
  worth taking further.
- **A Firefox Thai cache** (branch `thai-words`, 7f9edacc, 2026-09-24) of word boundaries per run between
  spaces: 10-15× faster on text seen before, nothing on new text (Engine Facts, Firefox). Reopens with the question of
  who bounds remembered data.
- **Truly stateless layout**, content, style and width in and lines out (in the rebuild, 2026-09-18 to 09-20): 60 fps
  over 10,000 messages allows 1.6 µs each, less than a first-time Canvas call, and a pass from scratch took 340-500 ms
  in Chrome against main's 168 ms. First sight of text is the cost and no store fixes it: a content-keyed store matched
  handles at over twice the memory and never shrank. Open question: whether resize cost rather than from-scratch cost
  should decide it. Reopens if from-scratch layout gets much cheaper (`rebuild/research/IDEMPOTENT-API.md`).
- **Eviction rules for a hidden store** (in the rebuild): young-doubles-old turnover dropped live entries when the
  working set doubled in a pass; release per pass rebuilt everything when a view laid out only visible rows; pass ends
  inferred from task timing broke across tasks. Two generations turned over at an explicit `endPass()` stayed clean but
  need a shrink rule.
- **A width store per Canvas context** (in the rebuild, 2026-09-20): 5-8% from scratch in Chrome, whose canvas answers
  repeats in 0.14 µs, while stored answers go stale after a late web font in every engine and Chrome's lookup changes
  string storage (Keeping Work Bounded, String Storage); Chrome's next gain has to come from fewer questions. Reopens
  for a stateful API with an invalidation contract, in Gecko and WebKit only (`rebuild/research/PERF-CONTEXT-STORE.md`).
- **Plain text as a rich paragraph of one item**, so that `prepare()`, `layout()` and the line APIs become rich inline
  (2026-09-29, main at dc75b5bc rewired so, Chrome 154, two bench sessions): `layout()` took 1.4-2.0 times as long
  (43-60% more at widths seen before, 61-95% at new ones), `walkLineRanges()` 3.0 times, `measureLineStats()` and
  `layoutNextLineRange()` 2.5 times, and preparing text seen before 5-10% more, to delete about 285 of 5,461 code
  lines; callers would also lose `segments`, `kinds` and the small opaque handle. It is the rejected one walker for all
  text again (Decisions Log, 2026-09-24). What it found on the way landed as #383: a one-item paragraph counted its
  lines at 2.5 times plain text's cost, and now takes the text walkers.
- **One handle type, every `prepare()` keeping its segment strings** (the same study): time moved 0.5-2.2%, but each
  handle held 1.5-2.1 times the heap (a 144-unit Latin message 1.6 to 2.8 kB in V8, a label 0.9 to 1.3 kB), the per-row
  memory a virtualized list keeps, against `prepare()` paying for nothing `layout()` doesn't read; and a `layout()` that
  also takes rich handles brings rich inline into every plain bundle (55.1 to 59.9 kB gzipped). Reopens as the deep
  form, rich inline as one analysis of the paragraph cut at item boundaries, of which a plain handle is the case with no
  boundary (TODO.md; not prototyped).
- **Objects inside a line, handed to the app** (2026-09-30, weighed for #387 beside the box; stand-in Canvas only; the
  box's other rejected forms are under Rich Inline Boundaries, Objects Inside A Line):
  - *A hand-off between text runs.* The app keeps its objects out of Pretext and runs the line loop, Pretext stepping
    each text run between two objects with the line's state handed from one run to the next. A prototype (108 code
    lines in `src/rich-inline.ts`, kept on no branch) gave main's lines on 66,000 fuzzed paragraphs in every profile:
    every engine allows a break on both sides of an inline-block, so only the line's width crosses an object, three
    values in the WebKit profile. But the app still passes each object's width into the step, since the gap, the hang
    and the fit depend on the text beside it, so it gains the loop and decides nothing at the edge; and a paragraph
    with k objects takes k+1 handles, a step that can ask the app to redo the run before (the WebKit profile's return
    to the break before an object), and no stats in one call, all worse for virtualized lists. Reopens for text glued
    to an object, such as `$x$,` kept with its comma, which no width expresses: the line's latest break would cross the
    object too, the full walker's pending break (`pendingBreakSegmentIndex` in `src/line-break.ts`).
  - *The app splits the paragraph at its objects and lays each run out with today's API.* A run laid out alone doesn't
    know what its line already holds: `xy `, a 24px object and ` abc def` at 60px are `xy`, the object / `abc def` as
    one paragraph and `xy`, the object, `ab` / `c def` split, a word broken and the gaps beside the object lost.
- **Other API ideas**: every in-word position measured in `prepare()` (about 2.4× Blink's cold calls; maybe an idle-time
  call); no handle (prepare is about 10× a warm break pass); reused rich items (about 3 a paragraph); a JSON guard on
  handles (Decisions Log, 2026-09-24, has what a JSON copy does today); a public diagnostics prepare.
- **The cost model** (main on that date, Chrome 154, 2026-09-26): 20 live fields take 28-270 µs an event, a handle per
  paragraph of a long document 85-300 µs a keystroke, a warm short `prepare()` about 5 µs, and streaming Latin stays
  under 1 ms to about 24,000 characters. Only a 100,000-character text with no breaks is a problem (4.2 ms Latin, 14 ms
  CJK or Thai); no sharing removes cold work (first paint, a new font size, Thai in Firefox), so order it or use a
  worker. An app's Knuth-Plass breaker works over the line-filling API: a fill at width 0 under `overflow-wrap: normal`
  lists the opportunities, and a width halfway between two candidates ends the line at the chosen one (735 of 735 on
  the stand-in).

#### The Markdown Chat At Scale

- **A chunked history window** (draft #312, 2026-09-15), preparing chunks on demand: exact frames, 100k resizes under
  1.7 ms, 42 MB instead of 402, but a scrollbar over loaded chunks only that jumped at each load, rejected after trying
  it, since the chat's scrollbar has the full history's size (Part 1, Demos And The Chat). A chunk-loading frame
  prepares new messages (5-10 ms), so a window wins only above about 100 × the messages per load. Kept open as an
  iPhone crashes at 100k on main but not on #312; reopens with a correct full-history scrollbar.
- **Window heuristics** (2026-09-14): pinned end chunks, separate load and unload thresholds, far-jump swaps and
  prefetch assume jumps aren't smooth scrolls (Part 1, Engineering). Also rejected: skipping one-line blocks (the worst
  frame is narrow); spreading a resize over frames (5-8 frames of wrong scrollbar); layout in web workers (10-12 ms, but
  the most code, 1-2 GB, inexact emoji); estimated heights, lazy preparation, first-view correction, layout after the
  resize stops, scaled scroll ranges and rounded widths (pops, gaps, a bad thumb); DOM pooling (about 20 rows show).
- **A handle without segment text** (2026-09-14) saves 1-2 of about 81.5 MiB for 10k messages in Chrome, 38 of them the
  canvas's, for more code and a language-change hazard. Reopens if memory matters, canvas cache first.
- **Memory cuts at 100k** (2026-09-16, stand-in Canvas; branch `chat-100k-levers`, off main before #340):
  prepared texts held 76-79% of retained heap, and three exact cuts (lazy preferred breaks, no grapheme counts without
  letter spacing, arrays trimmed to length) took 27-28% off with identical heights and Canvas calls. Preferred breaks
  have since left main. Reopens if memory at 100k matters; measure today's handles first.
- **One analysis for rich inline**: the joined pass was about 1% of prepare (2026-09-16, before #369 to #371 added to
  it; not timed since) and carried the per-item cursors (Rich Inline Boundaries), and Safari's extra calls are prefix
  fits WebKit needs. The reverse, one analysis of the paragraph cut at item boundaries, is what rich inline has since
  #460, with cursors that count the paragraph's segments (Rich Inline Boundaries, Rich Inline As One Paragraph).
- **The chat's scale** (2026-09-14 to 09-16, stand-in Canvas, before #338, #340 and #344; remeasure before relying on
  it): 46-100 µs to prepare a message the first time, 0.4-0.7 µs to lay it out, 43-59 ms median to resize 100,000, so 10
  ms fits about 13,000-15,000. A pixel position needs every height above it at the current width, so a thumb over
  unloaded history can't stay exact after a resize, and no other work was found that can be skipped exactly
  (2026-09-15). #286's typed-array heights won by building less per message (major-GC frames 53 → 0). The demo's 10,000
  messages are distinct, as 44 recycled ones let a warm width cache hide the cost.

#### Simplifications Held Back

- **Walker and admission-path shapes** (Keeping Work Bounded, The Walkers' Shapes and JavaScript Engines, have them with
  numbers) each lost speed in more than one engine or added too much code; of a walker that stepped exactly one line per
  call, only its cleanup of line text landed (2026-09-26), and a private copy of the stepper was rejected as duplication
  for a small JIT gain (2026-09-25; Part 1, Engineering). They reopen when the full walker's cost per segment nears the
  counter's.
- **Removing the prefix-measurement cache**: 79% more cold Canvas calls.
- **A growing bracket, then bisection, in the line counter** (in the rebuild): 59% faster than a global binary search
  at narrow widths, 17% slower at wide ones; one counter was kept.
- **A width that isn't a number handled by the clamp each line loop already makes** (#409, closed unmerged,
  2026-10-02), in place of `normalizeMaxWidth()` at the entry of the six line APIs called once for a paragraph (#401).
  Every line loop starts with `Math.max(0, maxWidth)`, or `Math.max(1, maxWidth)` in rich inline then; written as two
  comparisons, `maxWidth > least ? +maxWidth : maxWidth <= least ? least : Infinity`, the clamp gives `Infinity` for
  `NaN`, which fails both. That covered the three per-line streams too, so their three exceptions went
  (ENGINE_FOLLOWUPS.md, Small ones), for 2 library lines fewer and no result changed at a number. Firefox 156.0.1 read
  it slower than main (162fe261) in each of three sessions, the second copy of the base within 2%: mixed
  `measureLineStats()` 9.3%, the mixed walk 7.8%, the mixed stream 1.7%, and `layout()` of the mixed text at widths seen
  before 10.2%. Firefox's SpiderMonkey shell had read the same offline, on a stand-in Canvas: `layout()` of chat
  messages 17-20% slower, whatever names the minifier gave, and with the clamp written out at each place instead of a
  function, `layout()` level but the walk 5% and the Arabic book 8% slower. Chrome 154.0.8037.57 was timed only against
  main before #401 (8c56caed), three sessions: no row got a verdict, and `layout()` of the Arabic book read 0.9-1.5%
  slower in each, under its 2% floor. So valid text in Firefox would pay for a width an app can replace with
  `Infinity`. Reopens with a form that Firefox reads level with main on those four rows.
- **Upstream patches for engine hot spots** (2026-09-20): candidates listed in `rebuild/HANDOFF.md` on the rebuild's
  branch (lazy ink bounds in Chromium's `TextMetrics::Update`, per-call bidi and itemization, the font setter's fast
  path, and why a repeated string costs Firefox as much as a first ask); none was finished or posted. They go with the
  end-of-project bugs (ENGINE_FOLLOWUPS.md, External actions).

#### The Per-Engine Rebuild

The rebuild ported each engine's line breaking exactly over Canvas. Its findings fed #340, which put the engines' break
scans and tables on main, and the 2026-09-23 correctness stance (Part 1, The Correctness Stance; Part 1, The Per-Engine
Rebuild And What Counts As Done). "Main" here is main before #340.

- **Main's prepare speed from an exact port** (2026-09-22), bounded by Amdahl floors, the time the parts that can't be
  made faster take on their own: new Latin text took 5.4× main's time in Chrome, 2.7× in Firefox and 0.64× in Safari.
  Chrome's Canvas alone floored at 2.0-4.6×, mostly from the 256 px cut search, Firefox paid about four calls a
  character for advances it reads for free in its own layout, and a first layout at a new width cost 79-220×. Reopens
  with a different set of Canvas questions, or Chrome shipping `getTextClusters()`.
- **Main's design copied into the rebuild**, preparing everything and laying out by arithmetic, got worse: the port's
  answers depend on where lines end, so each width asks 1,000-4,000 new questions per 120 messages, where main assumes
  widths add up. Reopens with a Canvas call giving every position of a run.
- **Words first, landed under named gaps** (2026-09-23 to 09-25): the Chrome port cuts a shaping group into words,
  measures each once with its trailing space, and finds a break between two words from the positions at the cuts. It
  relaxed the rebuild's no-loss rule (no right line lost unless traced and classed): +2,780 / −28 line counts over 23.2
  million stress layouts, each loss one font at unusual settings, none on 751,000 real-text layouts, and 1.3-1.7×
  faster; main still prepared and counted 4-15× faster.
- **Rejected inside the rebuild**: Chrome words first split between CJK characters (failed the all-fonts probe); summing
  CJK in Firefox (no line moved, 36-76% more Japanese calls); font checks once per page (stale after a late web font);
  Firefox contexts shared across paragraphs (late family names); the Gecko lazy plain scan (6-7% for the most intricate
  code, and a hole at 22 of 901 widths); clamping joined-letter positions that run backwards (fixed none of 10);
  words-first window and Euphemia variants; rules chosen by the rebuild harness's score or keyed on a font name (removal
  cost 559 Chrome line counts, won back with explicit facts); per-font tables; a compiled ligature grammar (56-74%
  slower).
- **Owned rendering**, painting fixed fragments instead of browser-laid lines, was rejected before timing: narrow Latin
  and Arabic words overflow and valid rich style boundaries were refused. Reopens only with a probe that first
  establishes the required behavior.
- **Core Text ported to JavaScript**, the first approach weighed for the rebuild (2026-09-16), needs font bytes a page
  lacks for `16px -apple-system`, and Safari's Canvas already runs Core Text. HarfBuzz in WASM over the app's web fonts
  reached about 13.4% of old-suite rows and needs a 162 KB custom build, fonts loaded first and system fallback; it was
  ruled out as font-file work (Part 1, Limits), and HarfBuzz and `text-shaper` probes didn't reproduce browsers.
  Reopens if pages can read system font bytes.
- **Firefox's skin-tone widths through the DOM** (2026-09-26): unneeded, as the Canvas corrections missed only a
  modifier right after a letter.
- **What the rebuild taught main** (2026-09-18 to 09-20, Chrome 153): keep one long-lived context and one font answer
  per font (per-paragraph contexts were 43% of Chrome's from-scratch time, and WebKit resolves the font per new
  context); a string memo used as data flow hid which calls were needed and caused the string-storage bug; 15-50% of
  calls decided no line, so diagnostics run on request. Canvas gives totals while Blink breaks inside shaped runs, so
  Chrome is the slow engine for a Canvas port (about 320 Canvas calls a message, WebKit 41).

#### Test And Harness Designs

- **The old wrapping suite**, replaced wholesale (#341; removed 2026-09-25): harness/README.md, "Why the old suite
  went", has why.
- **Scoring the hyphen drawn at a soft-hyphen break** from painted boxes found 93-358 mismatches per browser, left to
  `layout.test.ts`; system fonts served as web fonts changed Safari's results (no date or numbers kept). Reopens with a
  way to see the drawn hyphen (harness/README.md, Bounds and blind spots).
- **Old-suite proposals the harness's pass rule made moot** (2026-09-17): not counting rows main already failed as
  lost, and recording line placement for the grid and corpora. A harness case passes on its line count and each line's
  first and last visible character (harness/README.md, What a case is and when it passes).

### Evaluation Traps

Ways evaluations fooled capable agents here, each with the case that showed it; most left a rule the harness enforces.
Many cases come from the per-engine rebuild (branch `rebuild-20260916`, a from-scratch port of each engine's line
breaking, kept as the plain-text correctness reference) and its lab, the harness that scored it from 2026-09-16 to 26
(`rebuild/lab/`; scores in `rebuild/research/` on that branch), whose ledgers tied each failing line to a named gap: a
known cause the rebuild's model leaves out. The emulation study (2026-09-15 to 20, summarized in issue #321) ran each
engine's own break and shaping code offline. The old test suite is `tests/wrapping`, removed on 2026-09-25 in favour of
the harness, and main before #340 is commit 6d1d2106, the last main before the engine ports landed. An offline replay
runs Pretext in Bun over recorded Canvas answers and browser rows, and a stand-in Canvas answers with made-up numeric
widths: both measure Pretext, not a browser.

#### Counting And Attribution

- **A matching line count isn't matching lines** (Reading Browser Output), and a pass can be two errors cancelling:
  rules whose errors cancel land together.
- **Attributing lost rows.** Checking main only at the first break a branch misses overcounted true losses tenfold:
  check all of main's line starts, mapped through white-space normalization. Scored by the same library, two batches of
  three fresh case sets differed by up to 9.8 failures per 10,000, so rerun the old library on the new cases before
  calling a small drop. A frozen reference goes stale silently: Chrome's recorded answers once showed 351 changed
  predictions, which bisected to an intended swap of two checks, so bisect first.
- **An oracle can copy the library's mistake.** The old test suite's oracle made a newline beside a ZWSP a space, as
  Pretext did and Chrome and Firefox don't, so the fix read as 12 losses in each text direction; 106 Firefox corpus rows
  likewise read as losses until the harness normalized newlines between East Asian characters as Firefox does. Check
  the oracle's normalization first.
- **Passing the oracle isn't enough.** The cleanest of three keep-all versions passed every oracle case and failed
  `foo。bar日本語` under the Safari profile; a 29-line partial port of an old rule matched every row of the old test
  suite and, by Firefox's source, probably got three shapes wrong. Test the behavior class under every profile with an
  attack set (cases built to break the change), claim only "no measured loss", and probe the shapes the source
  predicts.
- **Fast paths differ where the corpus is thin.** Three planted mutants of one compound condition passed the tests its
  author wrote, and a seeded adversarial generator's first run caught a wrong Gecko word-scan condition. Gate a fast
  path with seeded adversarial cases, a checked mode that throws where it and the full path differ, and a mutant per
  condition. An incremental path must equal the from-scratch one: checking text split at forced breaks against the
  whole text found the bugs #269-#272 fixed (harness/invariants.ts has the other self-checks).

#### Gaps, Warnings And Held-Out Sets

- **A cause that fires almost everywhere explains nothing.** A Firefox gap in the rebuild's ledgers fired on 91-96% of
  cases, passes included, and gaps reported once per paragraph hid 84 real bugs. A cause explains a failure only where
  it touches the differing text (lift, its share of failing lines over its share of passing ones, below 2 locates
  nothing), and a gap is reported at the offset that decided the line. Narrowing gaps moved errors into values the
  rebuild claimed as exact (2,030 passing cases held wrong "exact" values), and widening them meets a stopping rule of
  "every failure carries a named gap". Any confidence or warning API inherits this.
- **Page history poses as causes and as passes.** A result with page history depends on what the page laid out before
  it. The rebuild's Firefox `page-history` label named 0 of 220 history-dependent cases run in forward order and all 220
  in reverse, and unstable cases frozen as passes become false regressions later (harness/README.md, Accepted and
  varying lists; Engine Facts, Safari).
- **Held-out sets often aren't.** The emulation study's reused its development fonts and corpora and chose Chrome's
  settings after seeing its misses; the rebuild's came from families it was tuned on, and its generator pools ran dry
  while the log said nothing was reused. Seal a held-out set before tuning and open it once, since a look makes it
  development data; draw fresh sets from new generators each time (four cheap ones, 10,319 cases, found two classes
  80,000 reused cases hadn't); report accuracy per kind of case, since easy generated kinds flattered pooled numbers.
- **Runs meant to use no font facts still had outside inputs**: the exact browser build, its languages, and a facts
  table made by lab tooling on the same Mac. With no facts supplied, the rebuild claims only about 10% of its values as
  exactly predicted and marks the rest limited, so regressions in exact values show only as more limited values, unseen
  by a ledger with no status for "passes with a wrong predicted value" (planted ones moved no case from pass to fail).
- **Real text in default CSS isn't real use.** When the rebuild was audited for mechanisms no real text needs
  (2026-09-23), the first cuts lost nothing on its real-text sets yet broke lines under soft hyphens, `break-all`,
  `overflow-wrap` and Windows-only font lists (`Meiryo` alone, 988 wrong). The sets missed served web fonts (requested
  on 88% of mobile pages), Android and Windows, user-written chat and app settings, hence the harness's weighted
  real-usage sample (harness/README.md, Two kinds of set), which still has no tabs or blank lines. Books lack URLs,
  numbers, emoji sequences, NBSPs and discretionary breaks.

#### Tests And Gates

- **Tests blind to the path apps run.** A lab that always runs the inspecting path, the one that records each line's
  details, never runs the plain one: a planted fit change on plain paragraphs passed offline replay, which is blind to
  alignment too, on 134,130 Chrome cases, and passed the browser runs that usually follow it. A test that restates the
  rule or reimplements the algorithm checks nothing (in March 2026 `bun test` ran a simplified copy of it), `skipIf` on
  files outside the repo passes silently, `bun test` runs the Blink profile wherever a test doesn't set a user agent
  itself (Bun's names no browser, so the profile for unrecognized engines applies; the profile matrices of
  `src/layout.test.ts` set Safari's and Firefox's), and walkers written apart drift unless a test makes them agree.
- **Planted defects found harness false greens**: a negative or null width hid an omitted glyph, six jobs missing the
  same rects agreed with each other and were certified, and a run missing expected cases, even an empty one, passed. So
  geometry and the set of cases a run observed are validated before scoring, net gains never offset a loss, and
  unobserved never passes.
- **Evaluators certifying their own runs.** One agent replaced the saved results with its own and skipped the
  environment check, locking real losses into the baseline; another committed baselines before review. New results are
  staged and adopted after an independent check. Canonicalize diagnostic output before freezing it: two good fixes were
  reverted because 4 of 67,065 rows regrouped.
- **A case whose page layout contradicts its declaration counts neither way**: of 22 found, 8 passed by accident (floats
  wider than the block). Thresholds come from the browser's unwrapped geometry, never from the library under test.
- **Catalog growth leaks**: every family in the harness's behavior catalog keeps a case, so a variant made its own
  family gets past the dedupe (which keeps a template only if it shows a kind of break no earlier one did), whose kinds
  of break are coarser than behavior, and nothing old drops out (harness/README.md, How cases grow, has #366's numbers
  and the rule).
- **Main's "facts" can be inherited opinions**: of 159,163 Chrome "visible pass" labels main before #340 carried, 678
  were refuted and 842 inconclusive. Triage its passes by observation alone, as facts, accidents or opinions: admit
  browser behavior, never main's code. Its unit tests still hold facts the rebuild's lab never saw
  (`rebuild/research/MAIN-FACTS-ANALYSIS.md` on the rebuild's branch).
- **A README claim checked offline only** (2026-09-26): splitting pre-wrap text at `\n`, each empty paragraph a line,
  matched a stand-in Canvas on 588 of 592 cases and failed about 190 of 10,087 browser comparisons (a form feed before a
  line feed, the empty text, Chrome's CJK closing marks); splitting after each `\n` (#362) matched 10,083-10,087.
- **Finding repeated work.** Reading finds call sites, not how often each fires, and two predictions from reading were
  wrong; a per-call-site tally from stack traces over a deterministic replay ranked the repeats (in the rebuild,
  2026-09-18). Then one fresh-eyes read of the library against engineering.md and Part 1, Engineering, reports
  complexity, before profiling adds some back.

#### Agents' Reports

- **Check an agent's account against its logs.** Reports have misstated what their agents did: one denied breaking a
  rule about taking the foreground that its log showed it broke, one said nothing was running while its watchdog was,
  and one said free memory stayed above 30% where the harness watchdog's log read 2-3%. Diagnose a failed browser job
  before running it again. Reports also overclaim (cold `prepare()` "within 1.5-3× of main" where a measured point was
  149×; "every gate at exit 0" where one exited 3): a second agent checks every number against its source before it
  becomes a reference, and reviewers can be surer than their evidence. A scrub before pushing checks content, not only
  local paths: one that looked only for paths let private material reach a public branch.
- **Credit and voice.** An agent's recommendation can end up recorded as the maintainer's decision: the eighth of issue
  #321's ten decisions, an agent's advice against Chromium's Chinese line table, was once written up as accepted though
  the maintainer never answered it (Decisions Log, 2026-09-23, has how it was settled). A message in an agent thread may
  come from another agent, and an agent's doc can put its own line in the maintainer's mouth (Part 1, Docs).
- **Confirm what a short approval covers**: one brief approval of the rich-note demo's painter was read two ways by
  different agents, which became bug #296. Re-verify a recorded prerequisite before planning around it:
  ENGINE_FOLLOWUPS.md once said Firefox's breaks between styled pieces needed a model of Firefox's word segmentation,
  and turning on Chrome's joined-text rule for the Gecko profile sufficed.
- **Target the question before answering it** (2026-09-18): a verdict that Firefox's `<canvas>` element was roughly the
  last architectural blocker for `system-ui` rested on the rows seen so far, and the element's style-flush and memory
  costs surfaced only under targeted probes (Dead Ends, DOM And Canvas-Element Paths).

#### Timing

`bun harness bench` builds these in (harness/README.md, Bench); the numbers are why.

- **A loaded machine was wrong by up to 50 times** (timing the rebuild, 2026-09-18 to 09-22): webkit-host, the harness's
  background app running the system WebKit that Safari uses, took 11.7 s for 10,000 messages loaded against 0.235 s
  quiet, and the Chrome cold `prepare()` (of text no cache has seen) of main before #340, quoted for a day as 0.72 s
  against 0.31-0.37 s, made the rebuild's cold `prepare()` look 1.5-3 times as slow as main's instead of about 13 times.
  The harness's exclusive browser lock doesn't make a quiet machine (a fixed arithmetic probe ran 60.7 ms before one
  run, 29.1 ms after): record the load, and take loaded runs as upper bounds.
- **Same-document ratios** survive machine-wide slowdowns: sessions drifted 5-19% apart (2026-09-25), and timed in
  separate documents, the engine ports that landed as #340 read 0.6, 0.3 and 0.7 times the time of main before #340 in
  Safari, where same-document ratios were 0.82, 0.52 and 0.99 (2026-09-23/24). In a fixed order a variant inherited the
  leftover work of the one before (18.7× for a real 13.4×), hence the shuffle; 5 ms samples inflated the noise floors of
  Chrome's replay rows 40-75% and let 55-160 ms GC pauses decide medians, hence samples of at least 20 ms.
- **Focus.** Using the Mac during a timed run failed all six Safari attempts; light concurrent work, or the bench window
  opening on another screen, moved Safari's `prepare()` 1-2 ms of 11. An app's embedded Chromium pane isn't installed
  Chrome, and its numbers count for nothing.
- **Power.** A timed run taken on a battery at 20% charge or under, or on an adapter too small to charge the machine
  under load, is void, and the bench starts no foreground run on a battery under 20%: on 2026-10-08 a Chrome run taken
  from 20% down to 17% timed line operations at 1.5 to 2.1 times their time on mains and preparation at 1.0 to 1.2
  times, so its ratios moved with its times, and a run on a 20 W adapter with the battery at 7% timed preparation at 1.5
  times. Seven runs taken that day on a battery between 88% and 24% read 0.97 to 1.00 of the time of mains runs of the
  same trees.
- **Allocation order.** Timed on data each library prepared in turn, whichever library prepared last read 20-28%
  slower in Chrome 154 over the Markdown chat's 10,000 messages, the control copy of base too; preparing the libraries'
  messages interleaved, a message at a time, put the control within 4% (2026-09-29). The bench prepares each
  operation's handles in a shuffled order, so its control copy shows where that order moves a row.
- **Two sessions agree by chance.** Of HEAD against itself (the calibration of the bench's floors at 7204cab2,
  2026-09-26, three sessions a browser), the 141 entries give 423 pairs of sessions, and a pair alone calls a change in
  11 of them, 4 on `new` rows; the three sessions together call none, which is what the floors were fitted to. In the 19
  runs of three sessions in one browser saved on 2026-10-02, the first two sessions called 74 of 322 rows and the third
  took 22 of them back, 16 in Firefox. So after two sessions the bench times the rows that read slower or faster in a
  third (#416), which gives the verdict of three whole sessions, as a row two sessions don't call a third can't: fed
  those 19 runs' sessions, it gave the three-session verdict on all 322 rows and timed 57 of the third sessions' 145
  documents. A build still reads slower than itself in three sessions: main against main on the `new` rows
  (`bench main --lib=main --rows=new --sessions=3`, Chrome 154, 2026-09-28) read the Thai row +11.4%, +13.4% and +6.5%
  with the control at -7.5%, -4.3% and -0.9%, 1 of 18 entries; and in the 73 other
  saved runs of three sessions or more in one browser (2026-09-26 to 30), the control, judged as a candidate against the
  floor alone, held a change through its first three sessions in 27 of 1,016 entries (2.7%), 7 of 32 on Safari's `lines`
  row. What three sessions cost against two, with a change multiplied into the candidate's times of the calibration and
  each of its three identical copies in each role: +5% is caught on 7-9% of `new`, `rich` and `resize` rows, not 15-21%,
  and +10% on 45-69%, not 57-77%; `seen`, `lines` and `worst` rows lose 6 points or fewer at both sizes. Reopen with a
  calibration that gives each browser its floors.
- **A copy keeps a speed for a document.** On 2026-09-30, with #381 in main, each copy of the library in a Chrome 154
  document ran `measureRichInlineStats()` over the bench's rich text at 2.24-2.35 or 2.48-2.64 µs per 1,000 units, 9
  copies of 18 each, every copy steady over its 12 rounds, so the control read 11-12% from base in 5 of those 6
  sessions, and the row read within noise where no change under 11% could have shown. In the 97 runs of two sessions
  or more saved on 2026-10-01 and 02, the control sat 8% or more from base in a session of 12 of 13 runs of Chrome 154's
  rich stats, 11 of 13 of Safari 27's rich walk and 8 of 13 of its rich stream, and a row left without a verdict had a
  band of twice its floor or more in 358 of 2,468 cases. The bench prints such a row's widest band and moves no verdict
  (`harness/README.md`, Bench). Two stricter rules for a session whose control had three quarters of its rounds beyond
  the floor on one side cost verdicts in the 381 runs of two sessions or more saved from 2026-09-26 to 30, and took back
  no false one in either run of a build against itself: holding the candidate past the control too by the floor took 43
  of 1,526, among them Chrome's pre-wrap layout at 1.05 of main before #340, one of the four slowdowns the floors are
  checked against; giving such a row no verdict took 173. Reopen if a re-time takes back a verdict on a row whose
  control sat that far.
- **One slow copy reads as a change when it is the candidate's.** On the bench's two chat documents (`chat`, the
  Markdown chat demo's paragraphs as it prepares them, list items and headings among them, called the demo's mix below,
  and `chat-styled`, its paragraphs of several items alone, beside `latin`, the stress items, a word or a space each;
  main at #455 against itself, Chrome 154.0.8037.98, eleven foreground sessions, 2026-10-07) one copy of three ran
  `rich-seen` slower than the other two in 21 of 22 documents, steady over its rounds: 53.1-54.6 µs per 1,000 units
  against 47.0-49.8 on the demo's mix, and 64.8-67.5 against 57.4-60.8 on its styled paragraphs. The slow copy was
  base's in 2 and 2 sessions, the candidate's in 3 and 7, the control's in 5 and 2. The band is the control's distance
  from base, so it covers a session only when the slow copy isn't the candidate's: the styled paragraphs' `rich-seen`
  read 10-13% slower in 7 sessions of the 11, and in every session of 35 of the 165 sets of three sessions the eleven
  make. Were each copy as likely to be the slow one, it would be the candidate's in all three sessions once in 27 runs.
  Safari 27 does the same on the stress items' walk and stream (the stream at 4.0 or 4.5-4.7 µs per 1,000 units): one
  run of three sessions read main's stream 12.0%, 14.9% and 11.7% slower than itself with the control at -1.7%, +12.8%
  and -3.9%, and the bench called it. Which copy is slow follows the order the page ran the copies in earlier in the
  document, recomputed from each session's seed. In Safari it is the copy that prepared that operation's handles first:
  on the stream in all 24 sessions of main against itself saved that day (the eleven and the thirteen before them, five
  of those with the width-only callback of the next entry; the stress document is the same in all 24; in 4 a second copy
  was as slow), on the walk in 22 of them (Allocation order, above, where Chrome's slow copy was the last to prepare).
  In Chrome it is the copy that prepared one batch of the first round the document runs, an untimed round of `rich-new`:
  the first batch on the styled paragraphs, in all 11 sessions, and the third on the mix, in the 10 that had a slow
  copy. That copy also prepares new text 3 to 7% slower than the other two, by how a copy's cost is taken, and counts
  and walks lines within 1% of them. The copies take that round's batches in the order they run, so the place and the
  batch can't be told apart; Chrome's slow copy follows neither the order in which the copies first prepared the kept
  paragraphs nor the order of `rich-seen`'s own first rounds, and why that round slows a copy isn't known. Such an entry
  is read over ten sessions and by each copy's own cost in the saved samples. Reopen with the cause, or with an order of
  the page's that leaves no copy slow (one batch that every copy prepares before the first round, and handles prepared a
  paragraph at a time in turn, are untried); reopen the verdict rule if copies made afresh each round, or a fourth copy,
  prove cheap.
- **A callback that keeps nothing lets an engine skip the work.** Until #456 the bench's rich walk and stream read only
  each line's width. V8 inlined the line builder that main had for a paragraph of one item until rich inline was laid
  out as one paragraph (also named `createOnlyItemLine()`, in the item stepper; 166 bytes of bytecode;
  `--trace-turbo-inlining` in d8, V8's shell, on the unminified bundle) into the walk and then never made the
  line: main's walk over the chat demo's paragraphs read 1.44 µs per 1,000 units that way and 1.85 with each line kept
  in one variable outside the loop, and its stream 1.67 and 1.78 (Chrome 154.0.8037.98); in Safari 27.0 the walk read
  1.38 and 1.50. Those were the 239 paragraphs the `chat` document kept while it read them after its new batches, 82% of
  them one item; the 265 it keeps now that it reads them first, 86% of them one item, read 1.72 in Chrome with the line
  kept, over eleven sessions, and weren't timed without. The other walk and stream entries of the three rich documents
  moved 4.1% or less in Chrome and 3.1% or less in Safari, and all six 2% or less in Firefox 156.0.1 (main at #455, five
  foreground sessions each way, back to back, in which counting lines, which no callback touches, moved 1% or less in
  all three; 2026-10-07). A library whose builder is over V8's inlining limit makes the line under either callback, so
  the width-only one read its walk further over main's than an app sees: both rich demos pass each line they walk to
  `materializeRichInlineLineRange()`. The plain `lines` rows keep their width-only callbacks, which is how the README
  and the plain demos use `walkLineRanges()`. The bench reads the last kept line once a run, so the store isn't dead.
  Reopen if an engine learns to drop it anyway.
- **A round of new text compares three texts.** `new` and `rich-new` give each library a batch of its own each round.
  Batches of prose differ less than the demo's paragraphs do: 1,000 units of the stress items differed by up to 1.9
  times within a round in Chrome. 1,000 units of the chat demo's paragraphs cost 180 to 1,900 µs per 1,000 units there
  by what they held (text that takes another font, words an earlier batch had), much the same in every session whichever
  copy drew them, and up to 4 times apart within a round, so a session's median of twelve ratios was mostly the draw.
  Main against itself read Chrome's `chat rich-new` 41%, 15% and 49% slower in three sessions and the bench called it;
  over 13 sessions a browser a copy's ratio to base on that entry, the candidate's or the control's, moved by up to 49%
  in Chrome, 22% in Firefox and 39% in Safari. With batches of 4,000 units it moved by up to 24%, 11% and 17% over 11
  sessions, where the stress document's moved by up to 30%, 19% and 8%, and no run called either (Chrome 154.0.8037.98,
  Firefox 156.0.1, Safari 27.0; #456, 2026-10-07). The demo repeats sentences: 80% of the words of its mix's new batches
  and 75% of its styled paragraphs' had come earlier in the document's new batches in the same font (86% of the styled
  paragraphs' counting the mix's document, which a session times just before), against 57% of the stress document's. The
  styled paragraphs the mix's document leaves hold 1.1 times what the styled document reads, so a larger batch needs
  more text. Reopen the batch size if the demo's generator gains text, or if a run of main against itself calls a chat
  document's new text.
- **The candidate's copy can lean on identical code.** In Chrome 154.0.8037.98, with main at #455 against itself, the
  candidate's copy read `lines: mixed stats` over base's in 15 of 16 sessions, by 0.2 to 1.9% (two runs of three
  sessions of every row and two of five of the row alone, with the code the bench wraps a library in (`ENTRY`,
  `harness/bench/lib.ts`) as it was before and after #456; 2026-10-07), and the control's copy in 10. One of the runs of
  three was called slower, +1.2%: the row's floor is 1%. The copies are evaluated base first, then the candidate, then
  the control, and each round runs them in a shuffled order, which is even (each first, second and third a third of the
  time over 200,000 seeds); what leans wasn't found. A reading of about 1% slower on that entry in Chrome, alone, is
  this until a calibration shows it gone. A second lean in Chrome is explained only in part: on the styled paragraphs'
  new text (`chat-styled rich-new`), base's copy was the fastest of the three, or level with the fastest, in 12 of the
  24 sessions of both batch sizes (the 13 and the 11 of the entry above), and the candidate's read 3.9% over it on
  average (standard error 1.4), the control's 1.8%. With 4,000-unit batches it is the slow copy three entries above (One
  slow copy), the one that ran first in the document's first round: the candidate's in 7 sessions of the 11 and base's
  in 2. The candidate's copy read 6.3% over base's on average in those 7, in 6 of them by 5.9 to 10.8%, outside the
  band, and 6.8% under it in base's 2, and all 20 of the 165 sets of three sessions that call the styled new text slower
  are among the 35 that call its `rich-seen`. With 1,000-unit batches the copy that ran first there was the candidate's
  in 2 sessions of 13 and base's in 4, and the candidate's still read 5.0% over base's (standard error 1.8); that part
  is unexplained. On the demo's mix (`chat rich-new`) the same lean is within its error (4.4%, standard error 3.4), and
  Firefox and Safari show none. A reading of a few percent slower on `chat-styled rich-new` in Chrome, alone, may be
  this until a calibration shows it gone.
- **Headless Chrome isn't installed Chrome.** With `deviceScaleFactor: 2` it most likely lays out at zoom 1 while
  reporting DPR 2, as its measurements show, and headless Chrome 153 crashed or hung on one input installed Chrome
  handled (the report in Part 1, Merge Bars And Landing, whose own page crashes headed Chrome too).

#### Checking Demos

What worked (2026-09-14 to 09-17): main and the branch under test, taken from `git archive`, in one browser session
with one probe; headed installed browsers at DPR 2 with both scrollbar kinds; painted width within about 0.5 px of the
model; width sweeps at breakpoint edges and in sub-pixel steps; stateful sequences over snapshots; a stand-in-Canvas
"screen" diffed byte for byte to prove a refactor changes nothing. To check code against a spec, make each rule a
yes-or-no question about one place in the code, answered by the smallest runtime observation (a per-frame read and
write log matching `^R*W*S?R?$`). Viewport emulation can hide a one-frame lag; resize a real window or iframe.

## Part 3: Decisions Log

Decisions whose reasons the code doesn't show, by date; code comments that cite this log mark where one applies. Most
are the maintainer's. An entry that says it landed on judgement is a call made inside Part 1's limits while landing a
change and reported afterwards, which the maintainer hasn't ruled on: it holds for its reason, and gives way to a
ruling. Before reversing one, check whether its reason still holds and record the new decision here with its date; an
entry that replaces another says so and keeps its reason. The old test suite is `tests/wrapping`,
removed on 2026-09-25 in favour of the harness. The per-engine rebuild is branch `rebuild-20260916`, a from-scratch
port of each engine's line breaking, kept as the plain-text correctness reference. Issue #321 is the public summary of
the emulation study (2026-09-15 to 20), which ran each engine's own break and shaping code offline and listed ten
decisions for the maintainer.

- **2026-09-12: reported widths are never negative.** A line's advance can be: Safari 26.5.2 measures a word with its
  following space, which can kern, so a line of only an invisible character and that space summed to about −1px, and
  main then reported −9 for `iii` at letter spacing −5. Nothing visible is there, so reported widths clamp at 0 (#236)
  while line breaking keeps the signed advance. A negative `maxWidth`, which CSS never produces, lays out as 0 (#272).
- **2026-09-12: cursors never split a grapheme, even where Safari's lines do.** In a box too narrow for a word, Safari
  can end a line inside a multi-code-point grapheme, as WebKit steps an overflowing word by code point on its simple
  font path (Safari 26.5.2 and WebKit's source; unchecked on 27). Pretext keeps graphemes whole, as its API promises;
  the mismatch is accepted on condition that it's written down where it can be traced.
- **2026-09-13: no per-segment bidi levels.** `segLevels`, one level per segment from a simplified resolver, could
  never give visual order and had gone unread since 2026-03-04 (Bidi Levels, #258). It went on condition that nothing
  Pretext means to render, such as mixed bidi, needs it back: mixed-direction text breaks right in logical order, and
  only painting a line without its paragraph's bidi context goes wrong.
- **2026-09-16: the WebKit profile follows Safari 27 only.** Safari 26, on macOS and iOS 26, breaks differently around
  curly quotes, guillemets, keep-all punctuation, U+2028 and U+2029, and an overflowing first character; following 27
  cost it about 2,900 left-to-right and 1,150 right-to-left line counts in the old test suite, mostly at widths narrower
  than one character. On real text only keep-all shows: in Safari 26.0.1 (the iOS 26.0 simulator, a page with a viewport
  and `text-size-adjust: 100%`, 2026-09-30) the real-usage sample's draws inside Pretext's claims fail as often under
  `word-break: normal` as in Safari 27's WebKit (23 of 10,029 against 24, 0.08% by weight) and 26 of 316 under keep-all,
  about a quarter by weight, against none: every Chinese or Japanese keep-all paragraph that wraps (19 of 23) and 7 of
  281 Hangul ones, 10 of the 26 with a wrong line count. Of the 23, one is Safari 26's alone, a curly quote beside
  Hangul, and no guillemet case fails. The user agent can't tell the two apart, since only Safari's own names a version,
  not the other WebKit browsers on iPhone and iPad; a feature can: `typeof ReadableStream.from` is `'function'` in
  WebKit 7625 (Safari 27) and `'undefined'` through 7624.5 (Safari 26.x), on the page and in a worker, the boundary at
  which `BreakablePositions.h` changes (read in WebKit's tags; run only in 26.0.1 and 27.0). So the reason left is the
  one in Part 1, Limits: old browsers get nothing that costs complexity, here a second WebKit rule set that no pinned
  browser checks. It reopens if keep-all on Safari 26 matters to an app while Safari 26 is in wide use: restoring Safari
  26's keep-all rule alone left 23 failures in a prototype, level with Safari 27.
- **2026-09-18: Firefox measures on an OffscreenCanvas, as the other engines do.** A `<canvas>` element's context would
  get `system-ui` and optical-size variable fonts right, but forces style updates once a page inserts a CSS rule, and
  workers have none (Dead Ends, DOM And Canvas-Element Paths). On 2026-09-19 it was allowed only if it proved light and
  worked in workers, which it didn't. If ever taken, Firefox switches wholly, not only for `system-ui`.
- **2026-09-23: each engine's own tables and scans find break opportunities**, in place of Pretext's rules and the UAX
  #14 table. The bundle growth, about 30 KB gzipped then, was accepted for much faster analysis, and whether the tables
  could shrink or give way to cheap computation was left for the end of the project (closed 2026-09-26, below).
- **2026-09-23: premises nobody has falsified may be taken for speed.** This relaxes the correctness-first stance the
  per-engine rebuild began with on 2026-09-16: as a last resort, ad hoc heuristics go first, then requirements no real
  text exercises (Part 1, The Correctness Stance). Examples: text with invisible characters stays on the simple walkers,
  the fast ones for common text, within 10⁻⁹px of the full walker's widths, and the Gecko scan's missing script-run
  splits (2026-09-24, below).
- **2026-09-23: the Blink scan uses Chromium's Chinese line table**, `line_normal_cj.brk`, on `zh` pages and on pages
  without a language under a Chinese UI, as Chrome does (Content Language And Fonts has what it changes). Issue #321's
  eighth decision advised recording the gap instead; main kept the table when the engine tables landed (#340), 46 test
  cases for 16 lines (Chrome 153) and 4.2 KB gzipped as it ships, packed against Chrome's root table (8.6 KB whole,
  before the packing; since #394 its rows ship alone, 2.7 KB gzipped, and its classes in the run list every map shares).
  It was never decided on its own: the acceptance of the tables' bundle that day covers it.
- **2026-09-23: a new harness replaces the old test suite, and what must not regress is decided afresh**, since main's
  tests were old: the engine tables (#340), the harness (#341), then the suite's removal (#348) (harness/README.md, "Why
  the old suite went").
- **2026-09-24: no must-pass tier.** Every repeatable case is pinned alike, so a hard trade-off in the heuristics is
  marked case by case on the accepted list, not forbidden by a tier.
- **2026-09-24: the Gecko scan doesn't split text runs where the script changes**, as Firefox's script itemizer does. A
  simplification pass had kept the splits on 2026-09-16, to match Firefox, a call made on judgement that the maintainer
  hadn't ruled on; asked on 2026-09-24, the maintainer approved dropping them, under the relaxed stance of 2026-09-23:
  only mixed-script fuzz strings with a stray mark moved, no text from the old test suite or the corpora (Dead Ends,
  Rules Per Input Shape).
- **2026-09-24: there is no `glue` kind.** Runs of only no-break characters (NBSP, U+2007, U+202F, word joiner, U+FEFF)
  are text and take emergency breaks where browsers do; the scans already decide their breaks, so the kind was only a
  label, unlike zero-width glue, which stays its own segment since folding it into the text after it lost rows (Break
  Opportunities From Engine Data). Dropping the kind lost two Chrome cases of the old test suite in Courier New at
  letter spacing 1, as Chrome paints no letter-spacing gap after U+202F (ENGINE_FOLLOWUPS.md).
- **2026-09-24: Pretext finds grapheme clusters itself, fixed to Unicode 17**, from Chrome 153's and libicucore 78.1's
  ICU character rules, which Firefox 156's ICU4X data matches, not `Intl.Segmenter`, whose graphemes were the largest
  part of preparing new text in Chrome and Safari. The rules don't follow a browser to another Unicode version, so
  they're refreshed with the line tables when browsers move to Unicode 18 (Grapheme Clusters From Engine Data).
- **2026-09-24: Safari's generic families come from a generated Core Text table**, not a `<canvas>` element, whose
  context forces style updates and follows the page language only when attached (Dead Ends, DOM And Canvas-Element
  Paths; PLATFORM_BUGS.md), which was rejected as DOM access on 2026-09-12.
- **2026-09-24: the full walker got engineering, not heuristics.** The full walker, the line walker for text the simple
  walkers don't cover, was sped up by data layout, fewer allocations, smaller representations and plain indexed code,
  not new shortcuts. It still costs three to five times as much per segment as the counter `layout()` runs
  (`countPreparedLines()`), so one walker for all text was rejected (Keeping Work Bounded).
- **2026-09-24: a prepared handle doesn't survive a JSON round trip** (a cost of #340, listed in its description, not a
  ruling). Since #340 its per-segment flags are a `Uint8Array`, which `JSON.stringify()` turns into an object without a
  `length`, so on a JSON copy the line APIs never return, nor does `layout()` for text off its counter's path, such as
  text with a soft hyphen (`measureLineStats()` and that `layout()` were still running after 5 s on a 27-character text,
  8e88756b, 2026-09-30), where 0.0.9 laid a JSON copy out as the handle; `structuredClone()` and `postMessage()` copies
  work, and README calls the handle opaque. Cursors and ranges are plain JSON and resume the same from a copy. Told of
  it, the maintainer asked only when a handle would ever be serialized to JSON, and no such use has turned up. It
  reopens with one; the cheap guard is a walker that throws on a handle whose flags have no length (Dead Ends, Caching,
  State And API Designs, Other API ideas).
- **2026-09-25: the old test suite, its snapshots, its diagnostic tools and the benchmark page are gone**; accuracy and
  speed claims rest where AGENTS.md says. The benchmark page went once the noise floors of `bun harness bench` caught a
  known change (harness/README.md, Bench), and what the harness took from the old suite stays frozen, since its
  generator went too.
- **2026-09-25: the npm package doesn't ship the demos (#342)**; README sends agents to the repo's. Shipping them
  runnable took the tarball from 238 kB to 620 kB, needed a Bun-only server script and shipped again content whose
  licenses aren't recorded; that version is parked as closed PR #343, in case this changes.
- **2026-09-26: `setLocale()` sets the language again** (#356), the one preparation reads in place of `<html lang>` for
  its break rules and measurement context, and still clears the caches: only so can a worker, which has no `<html
  lang>`, get the page's language. An empty locale is a page's without a language, and a call with none reads `<html
  lang>` again. Contexts with a `lang`, in Chrome and Firefox, take it too; `bun harness equal` moved no case. Before,
  #340 had left it only clearing the caches, since no locale changes the Thai, Lao, Khmer and Myanmar word boundaries
  Pretext reads (20 locales, V8 and JavaScriptCore); that was #340's state, not a decision, as the maintainer put the
  question off on 2026-09-24. An element's own `lang` waits for the end of the project (TODO.md, End of project).
- **2026-09-26: engines Pretext doesn't recognize take Blink's whole profile** (#356), as the docs already said, and are
  owed what Part 1, Limits, says. Only unrecognized user agents moved, such as Samsung TV web views.
- **2026-09-26: cater to the worst case, and allow it a slight regression for a real gain.** This replaces a stricter
  rule written the same day, that the worst case may never get worse (Part 1, Engineering). 26% isn't slight, so the
  width memo, which made layout at new widths up to 26% slower in Chrome, stays parked (Dead Ends, Caching, State And
  API Designs).
- **2026-09-26: no dead code for one JIT.** Dead or redundant code kept only because one JIT runs it faster is removed,
  whatever the regression, which is noted: code written plainly wouldn't reproduce the effect (Part 1, Engineering). A
  loop's first pass peeled before the loop counts, since the loop repeats it. Live code split apart or placed for a JIT
  isn't dead and stays, such as `getTextSegmentWidth()` (#358). Removing the three pieces #357 had kept for Chrome's JIT
  cost Chrome 154 up to 13%, and removing `countPreparedLines()`'s leading-space skip, a loop that never runs, kept on
  2026-09-24 for Firefox, read 3 and 7% slower in Firefox 156's two sessions on resizing Latin chat messages to new
  widths, within noise (#364). Counted on 2026-09-29, only one of the checks removed skipped work that mattered, the
  item stepper's line-start test, whose saving #375 took back plainly; the rest was placement or too small to read
  (Keeping Work Bounded). A check that changes no result can still skip work, so count the work it skips before calling
  a slowdown one JIT's. Nor is a rule written out twice for one JIT: the Gecko scan's two text-run setups share one
  word-end test, whose call makes Firefox 156 prepare four kinds of row 2 to 5% slower than two copies would (#365; Bidi
  Levels has the rows). That was judged a good trade on 2026-09-27; the second setup left with the level splits
  (2026-10-01). Widened on 2026-10-07, below: code that holds to stable types, good allocation patterns and plain C-like
  code isn't code for one JIT.
- **2026-09-26: one bundle serves every engine, for now.** An app can't import a bundle made for one browser, since its
  users run them all, and fetching one engine's tables at runtime would make the first `prepare()` asynchronous, so
  every browser downloads every engine's tables.
- **2026-09-26: the break tables stay as they are**, closing the check the 2026-09-23 entry left for the end. The
  maintainer would weigh one alternative, Firefox's line data stored in Chrome's format, and only if it brought no
  maintenance trouble. Measured, the format itself was larger, and the one variant that saved bytes, Firefox's classes
  read through Chrome's code-point lookup, took 3.2 KB off 55 KB gzipped, exactly and with no new upkeep, for Arabic,
  Hebrew, Hindi and Urdu analysis 13% slower in Firefox, so it was dropped (Dead Ends, Tables, Bundles And Data). It
  reopens with the table-size question; a bundle per engine would make sharing Chrome's lookup a loss, not reopen it.
  Amended on 2026-10-01, below: how the same tables are stored may change.
- **2026-09-27: the Gecko profile keeps its 80px floor for prefix fits, as a premise** (landed on judgement with #367).
  A prefix fit finds where an emergency break falls inside a segment by measuring the segment's grapheme prefixes, and
  the Gecko profile makes one only in segments at least 80px wide. Prefixes model Firefox's whole-word advances better
  than standalone graphemes, and the floor has no browser reason, but a lower floor fixed adversarial cases at 24-80px
  while making Firefox prepare new Latin, Arabic and mixed text much slower, and lost the one case of the harness's
  real-usage sample that it moved. Words narrower than 80px keep summing standalone graphemes where lines narrower than
  80px split them (Break Opportunities From Engine Data has the numbers). It gives way if prefixes get cheaper or real
  usage shows the gap.
- **2026-09-27: Firefox's bidi controls are laid out by the Gecko profile's analysis, not by its walkers** (#368). A run
  of soft hyphens and bidi controls holding a control joins the segment before it, and the profile's graphemes and
  white-space collapse read past such characters (Break Opportunities From Engine Data), so neither the walkers nor
  `layout()`'s count know of them. Making the run zero-width glue that the walkers look past fixed 39 of the 43 harness
  cases the analysis fixes, in 23 fewer lines, but slowed Firefox's `layout()` of invisible tails 12-13% and some of
  Chrome's and Firefox's worst-case rows 5-11% (Dead Ends, Invisible Characters, Controls And Soft Hyphens). The
  analysis also fixes the other four, `a`, LRI, U+0301, PDI, `b` at 1px, whose mark Firefox keeps with the `a`, and makes
  the white space on both sides of a control take the room of one space, about 22 of its 68 runtime lines. Since #399
  (2026-10-01) the collapse reads through soft hyphens too and comes from the scan's own text run. It still takes a text
  as one of Firefox's text frames: where a frame ends turns on the paragraph's direction, which Pretext doesn't take
  (Engine Facts, Firefox, Text frames).
- **2026-09-30: an object inside a line is a box, `{ width }`, a type of its own** (#387). Apps stood in for one with an
  atomic NBSP whose `extraWidth` made up the rest of its width (#201), where an empty text item stays what it is, dropped
  with no fragment. A box's width is final, fixed when it's prepared and at least 0, and heights stay the app's, with the
  README's `vertical-align: top` rule (Rich Inline Boundaries, Objects Inside A Line, has the evidence and what reopens
  negative widths and widths given at layout).
- **2026-10-01: the break tables may be stored in a shorter form where that adds no maintenance burden** (#394). This
  amends the 2026-09-26 entry, which read as closing how the tables are stored as well as what they hold. Its reason
  stands for what it weighed, an alternative that changed which table Firefox reads and paid for its bytes in analysis
  speed. A storage change is fine while the data stays what each browser's build ships, the generator stays one hand-run
  step that checks every class of every code point and every state row against the engine files, and no bench row but
  `fresh` is slower; what unpacking adds to a page's first `prepare()`, which `fresh` times, and to memory is a trade
  for the maintainer, with its numbers. #394 is such a change: the classes as one run list and the state tables as row
  differences, 13.3 KB less gzipped, for about 95 KB more typed arrays on a page in one language (110 in the Gecko
  profile) and a first `prepare()` on a page that takes 0.45 ms longer or less in Chrome, Firefox and Safari, a trade
  the maintainer took that day. A class costs the scans as many loads as before or fewer in nine of the ten maps and one
  more in Firefox's Bidi_Class below U+10000, and Firefox's rows on Arabic and mixed text, the ones that could have been
  slower, read no slower (Break Opportunities From Engine Data has the numbers). What was ruled out stays out: Firefox's
  classes through Chrome's lookup, tables computed at runtime and a bundle per engine (Dead Ends, Tables, Bundles And
  Data).
- **2026-10-01: older Chromium takes no version gate for letter spacing in cursive scripts** (#397). The Blink profile
  gives every Chromium the rule Chrome has had since 149: the letters of a cursive run take no letter spacing and its
  spaces do. Chromium before 138 spaces every letter, as Pretext did before #397, so there letter-spaced Arabic, Persian
  or Urdu went from right to too narrow, by the spacing times its letters; 138 to 148 space nothing in such a run, so
  there it went from too wide by its letters and spaces to too wide by its spaces alone. Such text is 0.54% of the
  real-usage sample's weight, and laid out as 138 to 148 would, 3 of its 44 paragraphs of only cursive letters put a
  word on another line, 0.03% (ENGINE_FOLLOWUPS.md, Letter spacing, has the sources and how that was measured). A gate
  would be the engine profile's first read of a browser's version, with two cutoffs, for builds that no longer update:
  old Chrome, and the Electron apps and Android WebViews still on such a Chromium, whose developers the changelog entry
  tells what to expect. The README says nothing of it. A report from such an app reopens it.
- **2026-10-01: an emoji stretch that two fonts draw takes no correction** (#398). The emoji correction counts the emoji
  font's glyphs by measuring each stretch of emoji characters whole (Content Language And Fonts, Emoji). A version that
  also asked a stretch that isn't all emoji glyphs character by character, and bounded the count by the emoji widths
  that fit in the grapheme, was measured beside it in Chrome 154.0.8037.57 and Firefox 156.0.1. The two predict every
  harness case alike (42,890 in Chrome, 43,997 in Firefox) and every line count of 22 and 32 realistic chat paragraphs
  over 417,820 layouts, with the same `measureText` calls. They differ on graphemes that mix fonts: over the six probe
  sets of widths (Content Language And Fonts, Emoji, and ENGINE_FOLLOWUPS.md, Emoji correction), 604 widths in Chrome
  and 451 in Firefox were right under one correction per grapheme and wrong with that version, against 2,518 and 3,867
  without it, nearly all in shapes only fuzzing produces (a text font's pictograph joined by a ZWJ to an emoji, a skin
  tone after a combining mark). It cost 13 runtime lines, a second pattern, a rule for which characters to ask alone
  that is neither engine's, and a bound whose answer depends on how wide a neighbouring glyph is. Limits says to
  document such shapes, not chase them, so it was left out, unmerged on branch `emoji-correction`, and the shapes are
  named gaps in ENGINE_FOLLOWUPS.md, Emoji correction. Leaving it out costs one thing in text an app may hold, in
  Firefox: three ZWJ sequences of emoji-test.txt written with no U+FE0F measure 5px wide. Such sequences turning up in
  real text would reopen it.
- **2026-10-01: where the page's style decides a width, the Chromium profile takes the answer that can't come out a line
  short** (on judgement, with #408). Chrome keeps a word's kerning with a hanging space in start-aligned text with no
  decoration or background, and drops it under any other alignment, a text decoration or a background, and Pretext reads
  no style (Part 1, Limits). The profile takes the second rule for every text. Where it is wrong, a line's last word is
  wider than Chrome's, so a paragraph takes a line more in a box at least as wide as Chrome needs, as on main; the first
  rule, where it is wrong, takes a line fewer, which clips text in a list of predicted heights, and its shrink-wrapped
  box makes Chrome wrap again (Kerning At Line Edges has the counts for both). The price is 21 harness cases, which are
  all of the first kind of text, and 43 of 41,888 card layouts in Gill Sans. An option on `prepare()` that says which
  kind a text is would replace it.
- **2026-10-01: Pretext resolves no bidi levels** (#403), the maintainer's decision. The port of Firefox's levels came
  in with the Gecko scan (#340) and was never decided on its own, and this reverses "the bidi split stays" of
  2026-09-24, which #365 kept by guarding it. The Gecko scan doesn't split text runs where the level changes, as it
  doesn't where the script changes (2026-09-24), and rich inline carries Firefox's white-space run across items past a
  dropped character at any level, so the port and its Bidi_Class table left: 539 lines of code and 4.4 KB of the gzipped
  bundle. The port took every paragraph as left-to-right, since Pretext takes no direction, where Firefox takes the
  block's: it was right in left-to-right paragraphs and wrong in right-to-left ones, where rich lines without levels are
  now right. Levels moved only generated texts: a direction change inside a cluster, and in rich inline a direction mark
  or a PDI at another level than the white space before it, at an item's edge. That's 30 Firefox cases, and no text of
  the real-usage sample, the corpora, 455,648 localization strings or a probe of written mixed-direction paragraphs
  (Bidi Levels has the numbers). It reopens with a `direction` option (TODO.md), under which a port is right in both
  directions.
- **2026-10-02: a `maxWidth` of `NaN` lays out as unbounded in the line APIs called once for a paragraph, and the
  streams take it as given** (landed on judgement with #401). `NaN`, which a typed caller can pass, fails every
  comparison, and the line loops ask some whether a segment fits and others whether it overflows. So since #340
  `layout()` counted a line per grapheme where the other line APIs gave one line, and those reported a `NaN` width for a
  pre-wrap line ending in spaces. `normalizeMaxWidth()` (`src/line-break.ts`) turns such a width into `Infinity` with
  one comparison, once a call, in `layout()`, `layoutWithLines()`, `walkLineRanges()`, `measureLineStats()`,
  `walkRichInlineLineRanges()` and `measureRichInlineStats()`, whose loops stay as written for numbers: none of their
  results at `NaN` differs from the one at `Infinity` (8,000 cases drawn from the sets in each profile, offline).
  `layoutNextLine()`, `layoutNextLineRange()` and `layoutNextRichInlineLineRange()` are called once for each line and
  don't check: they return, break as at an unbounded width, and differ from `Infinity` in three places
  (ENGINE_FOLLOWUPS.md, Small ones). Two wider forms were timed in Chrome 154.0.8037.57 and dropped, as valid input paid
  in each for an argument no app should pass. With `layout()`'s two fit tests negated into overflow tests, so that its
  count asked the walkers' question, `layout()` of the bench's Arabic book read 3.4-4.8% slower in each of three
  sessions (2026-10-01). With the function in the three streams too, those rows read within noise again over three
  sessions, and the mixed stream row, which then paid the comparison for each line, read 1.7% and 3.4% slower in a run
  of two sessions and 3.4%, 11.2% and 1.4% in one of three (2026-10-02). In that run of three the mixed
  `walkLineRanges()` row, which pays the comparison once for a paragraph, read 1.2-1.4% slower in each session with the
  second copy of the base 0.5-1.1% slower, and in the run of two 2.4% faster and 2.8% slower; a run that reads it slower
  in every session with the streams as on main would reopen the comparison there. A third form closed the streams' three
  places with no comparison added, and lost in Firefox (#409, closed unmerged): each line loop already clamps its width,
  with `Math.max(0, maxWidth)` or, in rich inline then, `Math.max(1, maxWidth)`, and that clamp written as two
  comparisons returns `Infinity` for a width that fails both. It changed no result at a number and left no line API's
  result at `NaN` different from the one at `Infinity`, but Firefox 156.0.1 read the mixed `measureLineStats()` row 9.3%
  slower than main, the mixed walk 7.8%, the mixed stream 1.7% and mixed `layout()` at widths seen before 10.2%, each in
  all three sessions (2026-10-02; Dead Ends, Simplifications Held Back, has Chrome's reading and the shells'). So
  `normalizeMaxWidth()` stays and the three places stay documented; a form that Firefox reads level with main on those
  rows would take its place. Whether such a width should throw, as a `letterSpacing` that isn't finite does (#356), is
  on the API discussion's list (TODO.md): in the six APIs a throw would go in that one function, and in the streams it
  would cost the comparison for each line again.
- **2026-10-03: the constants the line loops read stay `const`s, not const enums** (#406, closed unmerged), the
  maintainer's decision. Const enums gave Firefox 156.0.1's four slowest worst-case `layout()` and walk rows 7-14%, cost
  its Latin `layout()` at widths seen before 10-12%, and ended one row's dependence on a bundler's names (Keeping Work
  Bounded, JavaScript Engines, has the rows). Declined on two counts. The gains and the losses are one JIT's, in one
  version (Part 1, Engineering, JIT tuning). And the form adds complexity around the code: `tsc` writes a const enum as
  numbers only with `verbatimModuleSyntax` off, so the build would take a setting the type check doesn't, with a test
  to guard it. The 32 lines it saved in `src/` didn't outweigh those. Reopens if more than one engine shows the gains,
  or with a form that gives numbers in the built code and needs no build setting.
- **2026-10-05: the real-usage sample keeps its stand-in chat text**, the maintainer's decision. The sample's chat and
  AI-reply draws, about 65% of its weight, are text of another kind cut to chat lengths (harness/README.md, Two kinds of
  set). They were swapped, on a branch kept unpublished, for 2,127 prompts of OpenAssistant oasst2 (Apache-2.0) and
  1,429 blocks of ChatGPT replies from WildChat-1M (ODC-By 1.0), chosen by the sets' own moderation fields, with
  anything holding a URL, an `@` or a run of digits left out, and read twice by a language model and by no person.
  Stand-ins fell from 79.57% of the weight to 29.98%, since a draw that rolled an inserted URL, long word, emoji or
  styled span stays one, and the same library went from 99.74% of in-claims paragraphs right to 99.77% in Chrome
  154.0.8037.57, 99.97% to 100.00% in Firefox 156.0.1 and 99.94% to 99.96% in webkit-host: 3 failures came with the new
  draws, each a character on another line under a gap ENGINE_FOLLOWUPS.md names, and about 10 left with their stand-ins.
  So on plain prose the stand-ins hide nothing, and the swap wasn't taken: it would put text under two other licenses
  into the repository, republish people's messages no person read, and add about 9 MB of recordings, for a number that
  didn't move; and the filter that keeps personal details out drops the long unbreakable strings that are the hard part
  of chat. The one gap it turned up is recorded (ENGINE_FOLLOWUPS.md, Canvas answers that differ from the page:
  Firefox's synthetic bold). Reopens if the headline is to be quoted in public, where a stand-in share of 80% weakens
  it, or with a set of messages between people whose license allows republishing.
- **2026-10-05: of the three engines' rules for a word cut between letters, Chrome's is ported, on a premise, and lands
  at what it costs new text, with no cheaper form in its place, and of Firefox's the ligature rule; Firefox's kerning at
  a cut and Safari's carried width are not** (#435). Chrome reads positions from the word shaped whole and shapes a
  line's ends again where the cut is unsafe; which glyph holds a pair's kerning, HarfBuzz's safe-to-break flags and the
  device pixel ratio decide the rest, and Canvas gives none of the three to `prepare()`, so the Blink profile takes the
  longest stretch of letters that fits shaped alone, in a word of 80px or wider (Break Opportunities From Engine Data
  has the rule, the numbers and the gaps). Three things in it are choices. The 80px floor is the Gecko profile's
  (2026-09-27), kept for the same reason. A word as wide as its letters alone is taken to have nothing shaped across
  them, for speed, which leaves such a word fit as it was before. And pairs stand for the word wherever they add up to
  it, with its prefixes measured only where they don't: pairs are shared by every word of a font and prefixes by none,
  and prefixes alone cost more than twice the `measureText` calls on new long words, links and keep-all Japanese (Dead
  Ends, Fitting, Cuts And Fast Paths). The price is 7.2% more calls on the real-usage sample for 7 of the 29 draws
  Chrome failed, and no recorded case lost. New interface labels pay most: 10.1% more calls over Chromium's 7,000, 17.3%
  over 200 English ones alone and 41.7% over German ones, and 8.3% and 15.0% more time in the bench's row of them in two
  foreground runs (Break Opportunities From Engine Data). The rule lands at that cost as it is, the maintainer's
  decision. Cheaper forms were built and measured, each with its calls on those labels: the pairs asked only until they
  account for the word (8.4%), a floor of 90px (7.8%, and 6.6% with that stop) or of 100px (5.9%), the pairs a font has
  met counted first (5.9%), and the word's kerning spread over its letters, with the pairs kept from 160px (1.6%) or
  with none asked (0%). None is taken, for three reasons. Each gives up layouts the rule gets right, on a premise that
  real fonts break: a word whose kernings cancel after the stop, a kerned word under the higher floor, a word kerned at
  one pair and not evenly along it. A premise real fonts break isn't taken for speed (Part 1, The Correctness Stance),
  and the form that asks nothing fails a real-usage link that the letters added up alone pass (Dead Ends, Fitting, Cuts
  And Fast Paths, has what each loses). The cost is paid once per letter pair and font, on text not measured before and
  in Chrome alone, so it falls as a font sees text, from 1.07 calls a label over the first 100 labels to 0.20 over the
  last 3,000. And against the released 0.0.9, whose `prepare()` #344 made up to about twice as fast in Chrome on new
  text, most new text still prepares faster with the rule, though not all of it: new prose takes 33-58% less time than
  in 0.0.9 in Chrome, the bench's row of mixed labels reads level with 0.0.9 in Chrome and in Firefox, where main before
  the rule read it 18.7% faster in Chrome, and of one language's labels at a time in Chrome, 31 of 35 languages are
  faster than in 0.0.9 and Tamil, Telugu, Armenian and Hebrew are 31%, 13%, 12% and 3% slower; in Firefox eight
  languages' labels are slower than in 0.0.9. Most of that cost is #340's prefix fit for words of 80px or wider, about
  36% of a German label's time there with this rule's ligature questions in it, and the rest came with this rule: German
  reads 14% slower than 0.0.9 with and without it, Finnish 22% for 14%, Greek 19% for 8% and Armenian 33% for 23%, and
  how much of that the ligature questions cost isn't traced (Break Opportunities From Engine Data has the figures, their
  builds and date, and the trace; #435's description has the tables). The rule landed on a first reading of those
  labels, that nearly all of Firefox's cost was main's and the rule added to it only in Finnish and Armenian; the trace,
  made after, found that more came with the rule, as above. `layout()` pays where words are cut: the bench's long
  breakable runs read
  7.9% and 9.7% slower in Chrome 154 in two foreground runs, for one number read at each line that starts inside a word,
  and 8.2% and 13.9% slower in Firefox 156.0.1 with the ligature rule, which is none of the rule's work and is left as
  one JIT's (Keeping Work Bounded, JavaScript Engines). Firefox adds up the advances a word's letters have in the word
  shaped whole, and two parts of that were built. The ligature rule is ported: a ligature counts whole on its first
  letter (`GetAdvanceForGlyph`, `gfxTextRun.cpp:1139-1151`), found from one Canvas question per pair and font, which
  takes no premise about the font. It fixes 1 of the 3 real-usage draws Firefox failed, for 3.1% more calls on the
  sample, and loses one case, in a 1px box narrower than the ligature that starts its line, where Firefox gives each
  letter an equal share of the advance; the shares aren't ported, since they show only in a box narrower than one
  ligature. It covers the words fit from prefixes, of 80px or wider and up to 96 graphemes; a longer word and a run of
  digits are fit from pairs and keep the cut they had. The kerning is not ported, the maintainer's decision. The exact
  rule needs which letter of a pair holds the kerning, which Canvas doesn't give at the text's size; the build's premise
  in its place, half on the letter before the cut in every font, is exact for the fonts that split kerning and is one
  that fonts kerning through GPOS break, which most web fonts are, and a premise real fonts break isn't taken (Part 1,
  The Correctness Stance). It fixed #421's three Firefox texts and 4 accepted cases, none of them a real-usage draw, and
  on a probe of 10,011 layouts turned 9 right line counts into wrong ones and 21 the other way (Dead Ends, Fitting, Cuts
  And Fast Paths, has the build and its numbers). Safari's rule needs the width left of a cut word carried from line to
  line, a third field of the cursor and so a change of the public API, and its partial builds lost more than they fixed.
  So the Gecko profile keeps the prefixes' kerning and the WebKit profile the prefixes, with the gaps
  ENGINE_FOLLOWUPS.md names under Emergency breaks inside a word. Chrome's fit gives way to `getTextClusters()` in
  Chrome, and its floor to cheaper questions or a real case under 80px. Its cheaper forms reopen with an app that shows
  the added calls as time its users wait, which new labels in Tamil, Telugu or Armenian, slower than in 0.0.9, are the
  likeliest to. An option that tells `prepare()` a text is never cut inside a word would spare such text the questions
  on no premise, since all but 16 of the labels' 2,599 pair and prefix questions are for words narrower than the 320px
  the bench lays them out at; it is a question for the API discussion (TODO.md), not built. Firefox's kerning reopens
  with `getTextClusters()` in Firefox, which would take the place of the ligature questions too, or with a probe of each
  font's kerning placement, which Firefox's Canvas shows at a much larger size. The ligature's equal shares reopen with
  a real layout cut inside a ligature that starts its line, and the rule past 96 graphemes with a real word that long
  cut inside one. Safari's reopens with a cursor that carries a line's start width (TODO.md, the API discussion).
- **2026-10-06: the line functions that return no text take a `prepare()` handle**, the maintainer's decision for the
  first release. `walkLineRanges()`, `measureLineStats()`, `measureNaturalWidth()` and `layoutNextLineRange()` return
  widths and cursors, read from the line-break data `layout()` reads (`PreparedLineBreakData`, `src/line-break.ts`),
  yet their types asked for a `prepareWithSegments()` handle. That handle differs only by `segments` and `kinds`, each
  segment's string and kind, so an app that only shrink-wraps, balances or counts lines kept every text's strings for
  nothing, 1.5-2.1 times the heap per handle (Dead Ends, Caching, State And API Designs, has the figures). The change is
  to the types alone: the built code is byte for byte what it was. `layoutWithLines()`, `layoutNextLine()` and
  `materializeLineRange()` return text and keep needing the strings. The decision fixes that a line's geometry never
  needs a handle's strings, already the rule for `layout()`, whose walkers the four share; a unit test holds the two
  handles to the same data, and the four to the same results from both, in each engine profile. README doesn't promise
  that a range walked on a `prepare()` handle materializes against a `prepareWithSegments()` handle of the same text:
  that holds only while both were prepared with the same font, options and language by the same version. Rich inline
  has no such handle, and one can be added later without a break. Reopens if a per-line fact the four return comes to
  need the strings.
- **2026-10-06: the type of a `prepareWithSegments()` handle shows `segments`, `kinds` and `widths`, read-only, and
  nothing else**, the maintainer's decision for the first release. The type showed every field the handle holds, 18 on
  that date, where README documented `segments` and `kinds`. The other 16 are the line walkers' storage
  (`PreparedLineBreakData`, `src/line-break.ts`), which most engine fixes change: fields left the type and others came
  between 0.0.9 and that date, and after a release each such change would break the published type. `widths`, one of the
  16, stays public because apps place segments on a line with it, as the justification demo does, and README now
  documents it, with where the widths don't add up to a line's width: a tab's is 0, the letter spacing after a segment's
  last letter isn't in it, and a line broken at a soft hyphen adds its hyphen. The other 15 are hidden. A few outside
  projects read some of them, and `breakableFitAdvances`, which reads as each letter's width, holds letters, pairs or
  differences of prefixes by engine. The change is to the types alone: the built code is byte for byte what it was, so
  code that read a hidden field keeps running and no longer type-checks. Two uses lose typed access with no public way
  to the same number: each letter's width, and the width of the hyphen a line broken at a soft hyphen ends with
  (`discretionaryHyphenWidth`), for a painter that places segments itself. `widths` is typed `ArrayLike<number>`, an
  index and a length, which an array and a typed array both satisfy, so how the widths `layout()` reads are stored stays
  free; the type can promise more later, an array's or a typed array's methods, without a break, and can't promise less.
  `segments` and `kinds` are read-only arrays, so one can later be shared between handles or built on first read. Inside
  the library a handle keeps its whole type, which neither entry point exports: `getInternalPrepared()`
  (`src/layout.ts`) reads a public handle as it, and the two calls that build line text assert the same in place, where
  a call would change the built code. A unit test compiles only while the type has the three fields and no other, each
  read-only and `widths` no array, which `bun run check` enforces and `bun test` doesn't. README writes the kind names
  out, since `SegmentBreakKind` isn't exported (TODO.md, the API discussion). A hidden field reopens with an app that
  needs its number and has no public way to it, as an addition to the type or a function, never by showing the walkers'
  storage again.
- **2026-10-06: the WebKit profile takes a lone CR out of normal white space, and gives up the fonts on WebKit's
  fixed-pitch shortcut for it** (#455), the maintainer's decision. A lone CR is a carriage return with no line feed
  after it. No draw of the harness's real-usage sample holds a CR, lone or in a CRLF, so no real-usage number moves with
  this decision: it is about text that does hold one. In normal white space Safari gives a lone CR no room, and ends a
  line after it only in text that holds a character above U+00FF (Engine Facts, Safari (WebKit), CR and FF). The profile
  had it as a space that no line ends at, and now takes it out of the text. In one class of fonts that is a loss: where
  the first installed family of a font list is Menlo, Monaco, Courier, Andale Mono, PT Mono or the generic `monospace`,
  WebKit measures text on its simplified path as its character count times a space, the CR counted, so Safari gives the
  CR a character's width there. The profile's space matched that for one CR between two characters that aren't white
  space, and a CR that is gone doesn't: 16px Menlo `ab`, CR, `cd ef` is 77.06px wide in Safari, was in the profile, and
  is 67.43px now, so a line can measure a character narrow and a paragraph come out a line short. The counts are from
  two probes, layouts of texts built to hold a lone CR, at 24px and wider (webkit-host, WebKit 22625.1.29.11.27,
  2026-10-06; ENGINE_FOLLOWUPS.md, White space and controls, describes them). In proportional fonts, Courier New and a
  web font, the profile had wrong lines on 4,136 of the first probe's 44,880 layouts and 8,897 of the second's 32,986,
  and has them on 335 and 1,499; a wrong line count, so a wrong height, on 1,869 and 4,425 before and on 203 and 942
  now. In Menlo, Monaco and Courier, on texts with one CR between two characters that aren't white space, it had wrong
  lines on 293 of 4,196 layouts, a wrong line count on 64, and every line's width right on 3,903, and has wrong lines on
  2,260, a wrong line count on 1,309, and a line a character narrow on the rest. The class is given up for three
  reasons. The change serves the commoner side: every proportional font, Courier New, `ui-monospace` and every web font,
  fixed pitch or not, where the class is font lists led by one of six system families. No draw of the sample is in one:
  its two fixed-pitch font lists (`"SF Mono", ui-monospace, Menlo, Monaco, monospace` and `"Courier New", Courier,
  monospace`, 467 of its 11,901 draws) take no shortcut, since a list goes by its first family that is present. The
  match in the class was two rules meeting, not the shortcut modelled: the shortcut also gives a character's width to
  each of two CRs in a row, to a CR beside white space and to the CR of a CRLF, where the profile was wrong before too,
  on 3,535 of 9,069 layouts over all the second probe's texts in those three fonts (5,546 now). And keeping both sides
  would take the font's name or the Core Text trait behind the shortcut, which Canvas doesn't show. Equal advances don't
  tell it, since Courier New, `ui-monospace` and fixed-pitch web fonts have them and take no shortcut: a premise that a
  font of equal advances keeps the space would be wrong for those, as the profile was before, and would bring the font,
  the letter spacing and what takes text off simplified measuring into an analysis that reads none of them. Nothing in
  Pretext is keyed on a font's name (AGENTS.md, Fixing a mismatch). The harness holds the gap as one template of the
  facts set, `ab`, CR, `cd ef` in 16px Menlo: webkit-host fails its 6 cases from 34 to 77.03px, which main passed, 1
  with a wrong line count, and they are on its accepted list under this decision. Reopens with a Canvas fact that tells
  which fonts take the shortcut, or with a report of text with lone CRs laid out in such a font; `pre-wrap`, where a
  lone CR is a hard break, is as it was.
- **2026-10-06: the library is written for well-typed TypeScript, and checks no argument's type at runtime**, the
  maintainer's decision, for the whole codebase. A caller the types rule out, a number for a text or `null` for an
  item's `text`, gets whatever the code does with it, which may differ by engine profile and may change between
  versions; no code, test or doc line is spent on it. The checks of a value its type allows stay: a `letterSpacing`
  (#356) and a box's width (#387) that aren't finite numbers throw when preparing, since a typed caller can pass
  `NaN`. A `TypeError` for a rich-inline item whose `text` isn't a string was written for the change that makes rich
  inline one paragraph and taken out under this rule. Reopens if the library ships an API meant for untyped callers.
- **2026-10-06: rich inline is one paragraph, laid out by the text walkers**, the maintainer's decision for the first
  release (#460), on condition that each case it loses has a written reason and that its speed was tightened before it
  landed. One analysis of the items' joined text and one handle replace the item stepper, a second line walker that kept
  drifting from the first (Rich Inline Boundaries, Rich Inline As One Paragraph, has the design and its counts). What it
  settles: a rule about line breaking is written once, in the analysis, the profile or the walker; what an engine does
  at a span's edge goes on the paragraph's segments, never in a walker of its own; and a rich-inline cursor counts the
  paragraph's segments, with `sourceStart` and `sourceEnd` on a materialized fragment for its place in the item's text,
  since no mapping gives a cursor into `prepareWithSegments(item.text)` without analyzing each item again. What it
  costs: that cursor contract; an atomic item of only white space is an object as wide as its `extraWidth`; on the
  bench's stress items, a word or a space each, Safari prepares rich text again in 63-67 µs per 1,000 units where main's
  copies take 54-68, 12% slower over 16 sessions, above main in 15 of them and called in one run of four, and new text
  reads 2% slower in Chrome and 4% in Firefox and in Safari, above main in 10, 10 and 13 of the 16 and not called,
  against a line count at 0.2-0.4 of main's time and walks 21-31% faster; on the Markdown chat demo's paragraphs,
  preparing again reads 1-19% faster than main in Firefox and Safari and isn't called in Chrome, where one copy of three
  runs those entries at another speed for a session, and counting, walking and stepping through lines read faster in
  every session; on CJK rich text, which the bench doesn't hold, Firefox walks one-item paragraphs 4-6% slower than main
  and Safari steps through a page of mostly one-item paragraphs 8% slower (the entry of 2026-10-09 on a count of lines,
  below, has their cause), and Safari prepares styled paragraphs again 8% slower, each above main in every one of ten
  sessions, against a line count 9-48% faster on such a page and on styled paragraphs (foreground, 2026-10-09, a867ce82
  against main at #459, 16 sessions of the `rich` rows a browser and ten of six CJK documents that aren't checked in;
  Rich Inline Boundaries, Rich Inline As One Paragraph, has each reading, the first figures, 25-38% slower in Safari on
  text prepared again, and what took them down); the main entry is 1,428 B larger gzipped for what the walker and the
  analysis carry for a paragraph; a text's lines on the worst-case rows that run the full walker, since the walker's
  statements for a paragraph sit on a text's path: against main at #459 Firefox lays the soft hyphens out 3.6% slower,
  above main in each of six sessions, and Safari lays pre-wrap chunks out 3.0% slower and walks them 3.2% slower, above
  main in five and in six, each of the three called in one run of two and none over the six, and lays letter-spaced CJK
  out 3.2% slower, in four of six and not called, where Chrome lays letter-spaced CJK out 5.9% faster, called (Chrome
  154.0.8037.98, Firefox 156.0.1, Safari 27.0, a867ce82 against e699e27e, six foreground sessions a browser of every
  row, 2026-10-09; Keeping Work Bounded, Work Done Only Where A Rule Applies, has what every such statement taken out
  gave an earlier walker and what writing `hangs` as two statements gives back); and the walker has rules that hold for
  a paragraph only (`items !== undefined`), where plain text has the same gap and wasn't to move in the same change: a
  U+3000 run that hangs at an item's end, a soft hyphen beside an object, a segment of negative advance on a line that
  overflows, and a run of preserved spaces that hangs where a line wraps right after it with no break there. Each is the
  engine's rule, and the text walkers should take it in a change of their own, which removes the guard, as #446 did for
  the breaks a return from an unfit hyphen may take. What it gave up, each a named gap with its count
  (ENGINE_FOLLOWUPS.md, Rich-inline item edges): the Gecko profile's hang of a space before a soft hyphen Firefox drops,
  which the stepper had as a profile field and the text walker lacks; a line of its own for a ZWSP after content that
  overflows, which the stepper gave an item of only a ZWSP; and in Firefox the spaces after a ZWSP or a soft hyphen
  before a padded item, and a line of only a tab before a padded line feed. One more went unnamed until 2026-10-09: the
  Gecko profile's line end at the white space before an item that starts with a bidi control and a space, which the
  stepper took at every such control and Firefox takes at some, by where the control's text frame ends; it stays a gap,
  since putting it back trades (#463; Rich Inline Boundaries, Firefox's White-Space Run Across Items). A sweep against
  the stepper then named eight more, all rare text and none in the real-usage sample (2026-10-10; Rich Inline
  Boundaries, Rich Inline As One Paragraph, has the sweep): a line for a ZWSP that is or starts an item after a space;
  both edges for a padded item of only a ZWSP; a bidi control, ZWNJ or combining mark kept with its word after a chip
  wider than its line; the `extraWidth` of a line that starts in a padded item's word beside a joiner or a bidi mark,
  and of a hyphen's line where the item starts with a soft hyphen; in Firefox a padded item of only a bidi control as a
  box where it stands, the hang that ends at a ZWSP in pre-wrap and a padded item that starts with a tab kept whole; and
  the line end after a U+3000 run that a bidi control, ZWNJ or a combining mark follows in the next item.
  ENGINE_FOLLOWUPS.md, Rich-inline item edges, has two more that are not among the eight: a line's width in Safari, a
  space too wide where the line ends at a line separator after a space across an item's edge, and a trade in Chrome, the
  halt of a closing mark that ends a padded item, 94 probe layouts lost and 124 gained (2026-10-06). The changelog lists
  as worse than 0.0.9 only what 0.0.9 had right and an app could hold: the ZWSP's line after a space or after content
  that overflows, the padded item of only a ZWSP, and Firefox's two around a soft hyphen and a bidi control between
  spaces (CHANGELOG.md, the entry on rich inline as one paragraph). The rest 0.0.9 had wrong too, or is pre-wrap, which
  its rich inline lacked, or is left out as text no app is expected to hold, though 0.0.9 had it right: a combining
  mark, or a ZWNJ in an item of its own, right after a chip wider than its line; a joiner or a bidi mark in a padded
  item's word, in a box narrower than that word; and in Firefox a padded item of only a bidi control. The decision
  reopens if an app needs cursors into each item's own prepared text; if Safari's cost of preparing rich text shows in
  an app, where the removals that were measured and left out start (Dead Ends, Fitting, Cuts And Fast Paths); or with
  kerning across sibling spans, which wants the paragraph measured as well as analyzed whole.
- **2026-10-07: the bench's rich walk and stream keep each line they are handed, and its rich row times the chat
  demo's paragraphs beside the stress items**, the maintainer's decisions (#456). An app that paints its lines keeps
  them, as both rich demos do, and a callback that read only a line's width let Chrome skip making main's one-item
  line, so main's walk over the demo's paragraphs read 22% under what an app pays. The stress items are a word or a
  space each and never start inside a word, so a change to how lines are cut across items can read one way on them and
  the other way on text shaped like an app's: an earlier build of the change that lays rich inline out as one paragraph
  (#460, the work for #332, with #455 merged in; before its line builders were rewritten, Rich Inline Boundaries, Rich
  Inline As One Paragraph) walked lines 27.0% faster than main on the stress items and 20.5% slower on the demo's styled
  paragraphs in Chrome 154 (ten foreground sessions, 2026-10-07, with the bench as of 01ec9aa9, whose chat documents
  kept other paragraphs than they do since the last change below: 186 styled ones read after batches of 1,000 units,
  none of them among the 213 kept since). The cost is comparability: a `rich-walk` or `rich-stream` figure from before
  isn't comparable with one after. Landed with them on judgement, after a calibration called main slower than itself:
  the chat documents' new batches hold 4,000 units, and their kept paragraphs are read before the batches (Evaluation
  Traps, Timing, has the numbers for all three). The plain `lines` rows keep their width-only callbacks; that reopens if
  the README or a plain demo comes to keep the lines it walks.
- **2026-10-07: for speed, tricks that hold the code to stable types, good allocation patterns and plain C-like code are
  fine, small ones above all**, the maintainer's decision. A number array made to hold only floats instead of a mix of
  integers and floats is one, and one preallocated buffer filled instead of an allocation per item another: what they
  aim at stays true across engines and versions, where a JIT's heuristics move with both (engineering.md, Control Flow,
  has the general rule). Each trick is measured, with no optimizing for show, and marked by a comment that says what it
  is for. This widens the entry of 2026-09-26, no dead code for one JIT, under which lines that change no result and
  only hold a list to one number type counted as redundant code kept for one JIT. That entry stands for the rest. What
  stays out is code shaped to one JIT's heuristics, those that vary with the browser, its version or the machine: dead
  or redundant code kept because one JIT runs it faster still goes, whatever the regression, and no rule is written out
  twice for one JIT. A small regression that only such a heuristic explains is still accepted, its cost noted (Part 1,
  Engineering, JIT tuning).
- **2026-10-07: a handle's widths stay as `prepare()` computes them, not every one stored as a double**, the
  maintainer's decision. Passing each segment's width through a one-cell `Float64Array` on its way into the handle
  changes no value and makes every engine store a double; the rule on code written for speed allows such a trick,
  measured and commented (the entry before this one), and it was built and measured. It stays out on the measurement:
  Firefox counts the lines of CJK text faster with it once a page has laid out a width that isn't a whole number of
  pixels, but a page whose every width is whole, Chinese or Japanese text alone at a whole font size, lays out slower
  with it, by more, in Firefox, and the line functions run slower over such a page in Safari, as far as a bench run that
  gave no verdict and its engine's shell show; and nothing else needs every width a double (Keeping Work Bounded,
  JavaScript Engines, Every width stored as a double, has each reading, a browser's or a shell's, and the two other
  forms not taken). Reopens if Firefox comes to read doubles as fast as integers on a page of only whole widths, or with
  a second change that needs every width a double. A retry owes two timings this one lacked or had only as a probe:
  Linux and Windows, where Firefox can round every advance to whole pixels, so that every page would be such a page, and
  a page of only whole widths, which the bench has no document of.
- **2026-10-07: in the WebKit profile a line or paragraph separator ends its line before lone CRs and the white space
  that ends the text too, though plain text of that shape loses the line counts it had in Safari by two errors that
  cancelled** (landed on judgement with #459). A U+2028 or U+2029 ends its line in Safari, and in the profile, as a
  forced break (`handleSegmentBreak`, `InlineItemsBuilder.cpp:954-962`). #455 took lone CRs out of the text, and one
  such break went with them: that of a separator right before lone CRs and then white space to the end of the text,
  where the separator was laid out as a control. #459 keeps the break, so the profile lays such a text out as the same
  text without those CRs, as it did before #455. In Safari that is a trade, since Safari gives a CR right after a
  separator a line of its own, which the profile doesn't have, with the break or without it (ENGINE_FOLLOWUPS.md, White
  space and controls). On 672 probe layouts of 150 paragraphs in 16px fonts, which aren't checked in (webkit-host,
  WebKit 22625.1.29.11.27, 2026-10-07), the line count with the break is Safari's on 54 of the 72 layouts of a rich item
  of that shape before an item with text, where it was on 10 without it, the control having let the next item follow on
  the separator's line while each item's text was analysed alone; and on 4 of the 221 layouts of a plain text of that
  shape, where it was on 40, with 4 passing where 35 did. Over all 672 the count is Safari's on 325, from 317, and 251
  pass, from 284. The 33 passes lost, 31 of plain text and 2 of a rich item at 18px, were two errors that cancelled:
  Safari's Canvas gives a separator no width, so the control took a line of its own only where the last line had no room
  for the space before it, or under letter spacing, and there it stood in for the CR's line. Part 1 accepts a loss of
  that kind with the evidence written up (Tests And Losses), and the break is the engine's rule, where the control was a
  side effect of #455; no checked-in case moved, the harness having no plain case of the CR's line. Since rich inline is
  one paragraph (#460), a rich item of that shape before an item with text keeps the break with the rule or without, as
  its white space doesn't end the text that is analysed; the rule decides a plain text of the shape, and in a paragraph
  the break of a separator before the white space that ends the paragraph, where that white space follows lone CRs or
  starts a later item (Engine Facts, Safari (WebKit), CR and FF). Reopens with a segment kind that takes no room and no
  break and still holds a line, or with a report of text with a CR right after a separator.
- **2026-10-08: a function of its own for the line of a one-item rich paragraph, and the line walker's hanging test as
  two statements, stay, each on its direct timing**, the maintainer's decision on two changes in the code that lays rich
  inline out as one paragraph (#460). The line of a rich paragraph of one item is built by `createOnlyItemLine()` and
  not by a first branch of `createLine()`, and the walker's test of whether a segment hangs is two statements for one
  expression. Neither split removes work or changes a type or an allocation: each changes how the engines compile the
  same work, and was timed with it against the same tree without it, both built from commits, ten foreground sessions a
  browser in Chrome 154.0.8037.98, Firefox 156.0.1 and Safari 27.0 (2026-10-07 and 08). The function (13 lines of code
  more; 6bc6a99f against 69342169, a local commit made to time it; the `rich` rows): with it Safari walks the chat
  demo's paragraphs 8.0% faster and streams them 8.6% faster, both called, and Chrome walks them 4.2% faster in every
  session, under the row's floor; Chrome walks the stress items, a word or a space each, 5.3% slower, and Firefox walks
  and streams the demo's styled paragraphs 2.2% and 1.5% slower, in every session and not called. The two statements
  (one line of code more; 69342169 against a38bdea7, another such commit; the worst-case rows): with them Safari lays
  out and walks the pre-wrap chunks 4.3% and 4.0% faster and Chrome lays out the letter-spaced CJK 2.8% faster, in every
  session, each of Safari's two called in one run of two; Firefox reads level, and no row is called over the ten
  sessions or reads slower in every one. Part 1 (Engineering, JIT tuning) lets a small split of live code stand where it
  reads as ordinary code and a comment says why, and asks that code written for speed aim at what holds across engines
  and versions; neither gain is shown to rest on such a property, so each stays on its timing and not on a mechanism
  (Rich Inline Boundaries, Rich Inline As One Paragraph, and Keeping Work Bounded, Work Done Only Where A Rule Applies,
  have the readings). Together they cost 14 lines of code. Each reopens when a pinned browser moves, if the same timing
  then shows no gain or calls a loss.
- **2026-10-09: a difference of about a percent between two forms of the same code doesn't decide between them**, the
  maintainer's decision (Part 1, Engineering, JIT tuning). The percent is of the time an operation takes, as one entry
  of the bench reads it. The next change to the code moves a difference of that size again, so where two forms differ by
  that little the simpler is taken and its cost noted. The entry below on a paragraph's lists is a call made under it.
- **2026-10-09: the measuring loop stores each segment at its index in a paragraph's lists, as in a text's, and pushes
  nothing** (landed on judgement with #460, under the rule of the same date, above). For a rich-inline paragraph
  `measureAnalysis()` counts the paragraph's index beside its own and stores a segment's flags, width and advances
  there, and `prepareRichInline()` makes the widths and the advances as plain empty lists. The reason is V8's: it
  compiles a push that has once failed in compiled code as a call for as long as the page lives, which a page of mostly
  plain text whose first rich paragraphs are short brings about. An earlier build of the change kept that away with four
  statements, a push and a pop of a fraction and of a null on the lists as they were made (2026-10-07; main never had
  them). Stores by index keep it away too: on that page Chrome 154.0.8037.98 prepares plain text again within 0.9% of
  the statements (a867ce82 against 0f056620, five foreground sessions, 2026-10-09) and 4-9% faster than with pushes and
  no statements (two runs of five, 2026-10-08). The statements cost Safari on a fresh page whose every width is whole,
  CJK text alone at a whole pixel size: the fraction they push leaves the widths of every several-item paragraph a list
  of doubles, and JavaScriptCore runs the line functions at a faster, integer level only while every list they see holds
  integers. Safari 27.0 runs 16 of 16 such documents at the fast level with the stores and 0 of 16 with the statements
  (the same builds and date; neither page is a document of the bench: ENGINE_FOLLOWUPS.md, Cost). A store costs every
  text against a push: about 1% of text prepared again in Safari (0.5-1.3% on Latin, CJK and mixed messages, never
  called) and 0.6-0.8% of CJK messages in Chrome (2026-10-08), where the bench's row of them, `seen: cjk seen`, reads
  1.3% slower than main at #459, above it in each of 16 sessions (2026-10-09), and read 0.3% and 0.7% slower before the
  stores (five sessions and three, 2026-10-08): most of the 1.3% is theirs. The other form measured, the paragraph's
  lists made inside `measureAnalysis()`, where a text's are (branch `lists-inside`), does the same for Chrome and Safari
  and leaves plain text's code alone, at 6 lines of code more than the statements, where the stores are 4 fewer, and
  about 1% of rich text prepared again in Safari and Chrome. That is a difference of about a percent, so the form with
  the fewest lines stands (Keeping Work Bounded, JavaScript Engines, A list made where it is filled, has V8's source and
  each reading). Reopens if V8 compiles a push inline again after it failed there once, when the stores can be pushes
  again, or if a store's cost in Safari grows past what the bench calls.
- **2026-10-09: a loop of its own for the count of lines, and a rich paragraph's whole line stepped at preparation, stay
  out** (landed on judgement with #460). `walkPreparedLinesRaw()` walks a handle's lines and calls the visitor it is
  handed for each, at one place: a count hands it none, and `findWholeLine()` hands it one of its own as a rich
  paragraph is prepared. That visitor costs two engines on CJK rich text, which the bench doesn't hold. Against main at
  #459, Firefox 156.0.1 walks one-item paragraphs 6.1% slower where every width is whole, called, and 3.7% slower with
  ordinary widths, since it inlines a callee only at a call that has had no other callee and the walk's visitor is then
  a call a line; Safari 27.0 steps through the lines of a page of mostly one-item paragraphs 8.4% slower, called in one
  run of two, since JavaScriptCore compiles the full walker for the arguments preparation hands it and the calls that
  step a line run in its baseline tier. Each is above main in every one of ten foreground sessions, by about 0.2 µs per
  1,000 units (a867ce82 against e699e27e, 2026-10-09). A whole line stepped at preparation, with no visitor, gives most
  of that back, and alone costs Chrome 154.0.8037.98 9.4% and 13.8% of its walk of one-item CJK paragraphs, the second
  called (five foreground sessions, 2026-10-08): V8 compiles a call that has never run as a deoptimization, and a page
  counts its lines before it walks them. So the count needs a loop of its own, which leaves the walker called only with
  a visitor, and that loop was built two ways, each giving the same lines. With the skip past what a line can't start
  with in a function that the walker's loop and the count's both call, Chrome counts and walks plain Latin and CJK text
  3.8-5.7% slower than with the skip written out in each, all four entries called, and Firefox counts plain CJK text
  2.0% slower, called (five foreground sessions a browser, 2026-10-08). Neither is taken, and the cost is noted here.
  The rule of the same date (above) sets that course for a difference of about a percent; this cost is larger, 4-8% of a
  walk or a step of such text, so leaving it is a call on judgement, on Part 1's reasons (Engineering, JIT tuning). The
  first form reads as ordinary code and costs Chrome a few percent of counting lines, plain text's too; the second
  writes one rule out twice, which Part 1 rules out; and either adds its lines against a cost that only the engines'
  compile rules explain, the kind of regression Part 1 accepts where it is small. Both are kept, unmerged, on branches
  `walk-plain-final`, 21 lines of code more than 0f056620, which both are built on, and `walk-plain-settle-two-loops`,
  24 (Keeping Work Bounded, JavaScript Engines, The walker's visitor call, has the engines' source and each reading).
  Reopens when a pinned browser moves, since the cost goes by itself if Firefox inlines a callee at a call with two
  targets or JavaScriptCore keeps a step's calls in its compiled tier; with a form that is plain and costs no engine; or
  with a real page where walking or stepping through one-item CJK rich paragraphs matters at this size.
- **2026-10-09: rich inline's width is the one the text walkers lay out at, and its line functions clamp it at 0
  themselves** (landed on judgement with #462, the last open item of #332). `measureRichInlineStats()`,
  `walkRichInlineLineRanges()` and `layoutNextRichInlineLineRange()` laid every width under 1px out as 1px, as 0.0.9
  did, where `layout()` and the other text line functions lay a width out as given and one under 0 as 0 (#272). No
  browser has such a floor. On a probe that isn't checked in, 609 paragraphs were recorded at 0, 0.25, 0.5, 0.75 and
  1px, 560 of them with content narrower than 1px and 49 of only 16px text, 3px boxes and items of no width. The lines
  at 0px aren't the lines at 1px in 370 of them in Chrome 154.0.8037.98, 361 in Firefox 156.0.1 and 401 in webkit-host
  (WebKit 22625.1.29.11.27), and at 0.5px in 326, 315 and 361, none of them among the 49: a span of `iiii` in 1px Arial
  is 4, 4, 2, 2 and 1 lines at the five widths in all three (2026-10-09). In Firefox 38 more at 0px and 11 at 0.5px are
  recorded otherwise with the same lines: Firefox clips a space that hangs to the box, and the recorder lists none
  clipped to nothing. So the floor is 0, one constant in each of the three functions. It isn't dropped, though the
  walkers clamp the width they are handed, because the whole line's fit reads the width before them (`fitsWhole()`,
  `src/rich-inline.ts`). That fit is against the line's signed width, which is under 0 where letter spacing is more
  negative than the letters are wide, so against a width under 0 as given such a paragraph is one line at 0 and down to
  its own width, and walked under it, into the lines the walkers give its text, where the fit has a gap
  (ENGINE_FOLLOWUPS.md, Negative letter spacing and hanging spaces): a width under 0 would then lay out otherwise
  than 0. On the stand-in Canvas, 3,109 paragraphs made the same way, at 16 widths from −100 to 1.5px and at `NaN`
  and `Infinity`, in each of the four profiles, the functions without the clamp give 3 paragraphs other
  lines at −100 than at 0, and with it none; a unit test holds one. Either form differs from main on 2,068 of the
  paragraphs at 0 (2,000 in the Gecko profile), on 1,693 at 0.5 (1,680 in the WebKit profile, 1,639 in the Gecko one)
  and on none at 1px or wider or at `NaN`, and none of the harness's invariants fails at these
  widths. What differs is content narrower than 1px, several pieces of which the floor put on a line: text of 2px and
  under, boxes and padding of 1px and less, letters under a letter spacing about as negative as they are wide. A
  paragraph of ordinary text and items of no width breaks at 0 where it broke at the floor, and reports a pre-wrap line
  of only spaces that hang as 0px wide where it reported 1px. A paragraph of one text item now has its text's lines at
  every width but for the whole fit's gap: 2 of the 75 on the stand-in differ from their text at every width, where 29
  did at 0 on main (28 in the Gecko profile). The rich set holds five paragraphs narrower than 1px, searched from 0px
  (`harness/sets/rich.ts`): main fails 13, 15 and 13 of their 28, 30 and 27 cases in Chrome, Firefox and webkit-host,
  each with a wrong line count, the change passes all, and no other prediction of the 43,394, 44,495 and 44,928 differs
  from main's. On the probe the width given passes 640, 838 and 820 layouts that the floor failed, and fails 55, 40 and
  13 that it passed, each of which main fails the same way at 16 times the size or the recorder can't see
  (ENGINE_FOLLOWUPS.md, Rich-inline item edges, a box narrower than 1px). The clamp could sit in the fit alone, since
  the walkers clamp for themselves; the functions' entries were timed statement by statement (Dead Ends, Simplifications
  Held Back), so they keep their form and the constant changes. Reopens with a whole fit that takes the walkers' lines
  under negative letter spacing, when the clamp can go.
- **2026-10-10: the type of a materialized rich-inline fragment has no `start` and `end`, and a fragment range keeps
  them** (#NNN), the maintainer's decision for the first release: the change is of this date, was put to him as a draft
  pull request, and he decided by merging it. Since rich inline is one paragraph (the entry of 2026-10-06), the two
  cursors count segments of the item's part of the paragraph, which no app sees: they are only for passing back, and
  what an app passes back is a range, a line as a walk or the stream gives it. On a materialized fragment, the one with
  text, their one use was to let its line pass where a range is asked, and they misled code written for 0.0.9, whose
  README called them cursors within the item's prepared text: it compiled and read other text there (Rich Inline
  Boundaries, Rich Inline As One Paragraph, has how often the two differ). Off the type, that code fails to compile, and
  `sourceStart` and `sourceEnd` give the place it wanted. The first release settles it either way: a field can't leave a
  published type before 2.0, where these two can come back later, as optional fields without a break, or as required
  ones, which a materialized line needs to pass as a range again and a fragment built by hand then has to name. The
  change is to the types alone: the built code is byte for byte what it was, `materializeRichInlineLineRange()` building
  each fragment with its range's cursors under a type the entry point doesn't export (`InternalRichInlineFragment`,
  `src/rich-inline.ts`), so JavaScript that reads them, or passes a materialized line back, runs as it did. What it
  costs TypeScript: a materialized line no longer type-checks where a range is asked, as it did on 0.0.9, so
  `materializeRichInlineLineRange(prepared, line)` and a materialized line kept in a list of ranges fail to compile, and
  an app keeps the range of a line it passes back; and a materialized fragment built by hand, as a test may build one,
  can't name `start` and `end`. The harness's offline invariants passed each materialized rich line back as a range and
  no longer do, the types ruling that call out (the entry of 2026-10-06 on well-typed callers); the check beside it
  stands, that a JSON copy of the range gives the same line, which is what an app does. Its check that the line
  functions agree holds a materialized fragment to its range over the fields both types have, so a fault in the cursors
  a materialized fragment still carries shows in the unit test that holds a materialized line to its range and, between
  two builds, in `equal --offline`, and in neither the invariants nor a `check`. Another unit test compiles only while a
  materialized fragment's type lacks the two fields and a fragment range's has them, which `bun run check` enforces and
  `bun test` doesn't. Leaving the copy out of the built code too was not taken: it is 24 B off the rich-inline entry
  minified, 8 B gzipped, for a change no typed caller sees, and it would stop the JavaScript above. Whether a fragment
  range says its offsets in the item's text too stays open (TODO.md, the API discussion). Reopens with an app that holds
  a line only materialized and has to pass it back, or that needs a materialized fragment's place in the paragraph: the
  two fields then return to the type, which the built fragments still satisfy.
