# Research Log

Why Pretext is the way it is. Part 1 is the intent: the limits, the merge bars and the stances behind them. Part 2 is
the evidence: measured facts, traps and dead ends, each with its browser build, its date and what would reopen it. Part
3 is the Decisions Log. A date after a Part 1 rule is when the maintainer set it, and dates are Pacific time. Terms used
throughout:

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
  `docs/ui.md` in the vibescript repository, not yet public and to be open-sourced as chenguini; **Scrolling.md**,
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
- **Plain objects with fixed shapes** (AGENTS.md) and, in new code, indexed `for` loops over `for...of`, `.forEach` and
  allocating `.map` chains, stricter than engineering.md, Control Flow, which allows one `forEach` or `map`. The rest of
  engineering.md holds as written; per-browser behavior goes in the one place its Data Modeling asks for, the engine
  profile.
- **Cater to the worst case** (engineering.md, Control Flow), in time per frame, GC pauses counted with computation.
  Speed has improved enough that the worst case may regress slightly for a real gain: the rule is to cater to it, not
  that it can never regress (2026-09-26). The width memo, handles remembering which widths gave their last lines, made
  new widths up to 26% slower in Chrome, which isn't slight, so it stays parked (Dead Ends, Caching, State And API
  Designs). Layout stays on the main thread, workers a last resort.
- **JIT tuning.** As a general preference for every change, don't optimize for JIT behavior that varies with the
  browser, its version or the machine (2026-09-25). As a rule, never keep code only because one JIT likes it
  (2026-09-26): dead or redundant code kept only because one JIT runs it faster is an accident that code written cleanly
  wouldn't reproduce, so it goes whatever the regression, its cost noted; that reversed the 2026-09-24 decision to keep
  `countPreparedLines()`'s leading-space skip (#364). No rule is written out twice for a small JIT gain, though a small
  split of live code is fine if it reads as ordinary code and a comment says why. The precedent is #365: one shared
  helper was kept over two copies at a 2-5% cost in Firefox (Bidi Levels; Decisions Log, 2026-09-26, no dead code for
  one JIT). Report a speed fix's cost in lines beside its gain, and what a percentage is of.

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
  #387, in place of the stand-in characters of #201). The API discussion, a review of the whole public API at the end
  of the project and before any release, has issue #321's `direction` option and `devicePixelRatio` in `layout()` on
  its list (TODO.md). One bundle serves every engine (Decisions Log, 2026-09-26).
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
  default-ignorables, emoji, Hangul), and so does the cursive rule for letter spacing, which reads scripts and script
  extensions (`src/prepare.ts`), on the premise that a browser's JavaScript engine and its layout use the same Unicode
  version, which nothing checks. Script extensions are revised in most Unicode versions, more than those classes are,
  so the premise carries more there: where the two differ, a punctuation mark or a combining mark that scripts share
  is spaced otherwise than the browser spaces it. What no property says is listed by hand in the code with how it was
  derived, as the eight wide opening brackets Blink makes Han are, and the unit tests of these rules read Bun's
  tables (Unicode 17 in Bun 1.4.2).
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
- **Voice**: short, nuances kept, each document in its own tone (AGENTS.md) and `thoughts.md` in the maintainer's. A
  rewrite keeps technical meaning and opinions and loses pseudo-jargon, common words in uncommon senses, vague pronouns
  and slogans, but not words that carry meaning, such as "regression". Concrete cases over a general warning.
- **A PR's story stays in the PR.** Its full account (the rounds, the probes, every case it moved) goes in its
  description; this file gets the durable fact: the claim, its number, build and date, its source and what would
  reopen it. Six PRs in a row appended about 7,500 words here before the docs took this rule in #374. Length alone
  isn't the worry: the maintainer has said not to mind it in docs other than the README.
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
- **License notices** for the ported engine code and data are deferred until the end of the project (TODO.md, End of
  project).

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
ENGINE_FOLLOWUPS.md, Line edges, has what the check's premises get wrong. Only Safari letter-spaces the hyphen.

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
gzipped and 95.4 KB minified, 13.3 KB less of each than under #392's packing. Every code point's class in the ten maps
the scans read (the categories of ICU's five line and two character tables, and Firefox's Line_Break, Bidi_Class and
East_Asian_Width) ships as one list of 4,487 runs of joint classes, the 250 classes the maps together tell apart, with a
byte per joint class for each map: engines class most code points alike, and so do one engine's tables. From the list
the library builds a table for each map its engine reads, blocks of 256 code points behind an index, so a class is two
loads for any code point. Before, ICU's tries took two loads below U+10000 and four above, Firefox's line trie two below
U+1000 and four above, East_Asian_Width a search through its ranges, and Firefox's Bidi_Class one load below U+10000,
from a table per code unit: that lookup alone gained a load. Each state table ships as
its rows' differences from rows it repeats, starting from an earlier table's rows where one has its shape: libicucore's
line tables differ from Chrome's root table in 8 rows. Chrome's Chinese table has a category and two states more than
the root table, so it ships alone. The class maps are most of what is saved; the pair tables, Firefox's break states and
the bytes per joint class keep #392's packing. Taking one string out of the bundle now shrinks its gzipped size by 5.5
KB for the run list, 2.6 KB and 2.7 KB for the rows of Chrome's root and Chinese line tables, 1.0 KB for the bytes per
joint class and 0.5 KB or less for each other table. Nothing is derived: the generator, still run by hand, reads the
same engine files, checks every class of every code point and every state row against them as the library unpacks them,
and a test checks the shipped module the same way. Since #403 (2026-10-01) Firefox's Bidi_Class isn't among the maps
(Bidi Levels): nine maps, 4,268 runs of 155 joint classes, and a layout entry of 37.7 KB gzipped and 89.0 KB minified,
4.4 KB and 10.7 KB less than with the map and the level port that read it.

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
every code point (ICU 78.3's `uchar_props_data.h` against `properties.json`, 2026-10-01). Nothing compares a later
Firefox's, since `bun harness repin firefox` looks for the line and grapheme data's bytes only; if they came
apart, the code points whose width changed between the two versions would keep or lose a newline between East Asian
characters where Firefox doesn't.

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
left context but miss kerning with the next grapheme. In an offline replay prefixes gained 2,110 left-to-right and 703
right-to-left line counts over sums, lost 643 and 349, and doubled a cold preparation's Canvas calls; pairs, each
grapheme measured after the one before, did slightly worse at 21% more calls on the corpora and 91% more where every
preparation starts cold (Firefox 155, 2026-09-16).

So the Gecko profile takes prefixes only in segments at least 80px wide (`prefixFitMinWidth`) and sums graphemes below.
A cold Firefox preparation of real paragraphs then took 88 Canvas calls a paragraph (113 for prefixes everywhere, 86 for
sums everywhere, 79 before #340) and lost nothing to prefixes everywhere at 80px and over, where sums everywhere lost 58
line counts (Firefox 156.0, 2026-09-23).

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
cluster of no width that no line may end before, the zero-width glue #368 rejected (Decisions Log, 2026-09-27); it
reopens with a public way from cursors to source offsets (#90).

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
(Engine Facts, Chrome), reports none of it for Arial or Times New Roman; the Chromium profile follows Canvas's cuts
(headless Chromium 147, 2026-09-12; Dead Ends). In Chrome 153 a run measured whole equals its words measured with the
spaces beside them, less each inner space once, at all 379,714 positions where both sides hold a character of a script
of its own, and misses at 818 of 28,774 where one side holds none, all in Amiri (rebuild harness). This kerning is the
largest cause of Chrome's wrong lines in real usage, across spaces in Latin text and between kana, which Canvas cuts
apart as it cuts around every CJK character: 15px Arial `x A x` lays out 31.69px wide where Canvas measures 33.34px,
and 16px Hiragino Sans `キス` eight times 244.96px where Canvas measures 256px, as Firefox and Safari lay it out
(Chrome 154.0.8037.57, Firefox 156.0.1, webkit-host, 2026-09-30; ENGINE_FOLLOWUPS.md, Kerning Chrome's Canvas doesn't
report, has the rates and what a fix would cost).

Where a pair's adjustment sits decides what a break inside the pair leaves on each side: GPOS pair positioning puts it
all on the first glyph, the legacy `kern` table half on each (`hb-kern.hh:102-106`). On macOS, Times New Roman, Verdana,
Helvetica Neue, Hoefler Text and 10 more families split it; Arial, Futura, Gill Sans and Avenir Next are among those
that don't. Canvas adds both halves, so Chrome's and Safari's never show the placement (in Chrome, 26 families and 264
pairs gave the same values under every probe); Firefox rounds each glyph to app units, so it shows there at the size
times 2^k. Chrome keeps kerning when it splits an overflowing word (`'AV'.repeat(116)` at 109px takes 22 lines, not 24).
Firefox shapes words without their spaces and splits them at ZWSP, WJ and other invisible controls, so its kerning never
reaches a space, and after an emergency break inside `AV` in 18px Times New Roman it paints `V` at 11.833px, keeping
half the adjustment with `A` (rebuild harness; the `AV` paint in Firefox 155, 2026-09-12).

### Rich Inline Boundaries

Rich inline (`prepareRichInline()` and its walkers, `src/rich-inline.ts`) measures each item alone and breaks by the
paragraph's joined text. Measuring alone is a premise whose gap is out of scope for now, since rich inline with kerning
between sibling spans is left for later (Part 1, The Per-Engine Rebuild And What Counts As Done): Chrome and Firefox
kern across same-font spans, so Arial `community` + `,` fits about 1px earlier than its two widths, and Safari doesn't
(2026-09-12). The one width read across items is the halt Chrome gives a pair of fullwidth marks (CJK At An Item's
Edge). Where Pretext's plain-text walkers, given the joined text as one string, and the browser's lines for the
same text in one text node disagree, rich inline follows the plain-text walkers, but for a few places where it follows
the browser and the walkers don't yet: in the Gecko profile a rich line hangs the space before a soft hyphen Firefox
drops and its start consumes that soft hyphen, and in every profile an item whose whole width fits goes on its line
(ENGINE_FOLLOWUPS.md, White space and controls, and Negative letter spacing and hanging spaces). It takes the premise
that a browser lays spans out as it lays out their text in one text node; where browsers don't, mostly at soft
hyphens, bidi controls and separators beside white space at a span's edge, is in ENGINE_FOLLOWUPS.md, Rich-inline item
edges.

The rich-inline counts below from 2026-09-26 to 28 are of *probes*: cases generated for one change, each beside the
same text in one text node, recorded in Chrome, Firefox and webkit-host and not checked in, and counted against the
build before the change. The PRs named, and their commits' messages, have the full counts and attributions.

#### Joined Text

Chrome's and Firefox's items break by the joined text, a font change ending only Gecko's shaped run (Firefox 155 wrapped
same-font spans as one text node, 2026-09-14); WebKit's and the WebKit profile's break by each box's own text, with the
previous box's last two characters as context (`breaksFromItemText` in the profile; `TextUtil.cpp:374-396`). Splitting a word changes
its segmentation (Thai `ความสวยง` is `ความ/สวย/ง` alone, `ความ/สวยงาม` joined), and each engine's rules apply across
items: Firefox, whose lines don't start with small kana, keeps `待って` together across `ちょっと待` and `ってください`, while in
Safari 26.5.2 the joined analysis lost Thai and Lao words split across items (2026-09-12; unchecked on 27). The analysis
marks no break at some item starts (before NEL, VT or NUL, or a mark after a ZWSP), and after a break an item whose
first word runs past one moves down: Safari lays out items `zz` and ` ab\u0085cd` at 42 and 46px in 16px Arial as `zz` /
`ab\u0085` / `cd` (webkit-host, 2026-09-26).

A matching count can hide wrong breaks: an early prototype of the joined-text rule lost 40 Firefox Myanmar results, and
the losses came from widths, not segmentation. The second item starts with U+102C, a spacing vowel sign that graphemes
split from its consonant and browsers shape with it (16px Myanmar Sangam MN: `ဘာသ` 41.02px, `ာသည်` 50.78px, 82.03px
joined; ENGINE_FOLLOWUPS.md), and breaking at every item boundary had matched those counts only by breaking where
Firefox never does (Firefox 155, 2026-09-14; old suite, `tests/wrapping`, removed 2026-09-25).

Under keep-all, which `prepareRichInline()` takes for the whole paragraph (`{ wordBreak }`), each item's analysis and
the joined text's take it, so Blink's and Gecko's keep-all scans decide the breaks across items as in one text. WebKit's
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

Since #369 (2026-09-27) an item's walk continues the line instead of starting one, as a browser lays out one paragraph's
text across its spans. Before, each item was walked as if it began a line and then walked again to an earlier end in
four cases (a split word, a joined break after the walk's end, an overflowing hyphen, a continuing run that didn't fit),
which got some cases right only by luck. Now the full walker takes what the line holds before the item (whether it has
content, its latest break, which the rich stepper keeps across items, and whether a return from an unfit soft hyphen can
end the line there) and the joined text's breaks inside the item's segments, on a copy of the item's handle whose flags
follow the joined text (`getWalkedHandle()`). There a ZWSP or soft hyphen takes the kind of the last of the joined
text's segments inside it, as the text around it decides it (`recordJoinedBreaks()`); taking the kind of the one that
starts where the item's does fitted a hyphen Firefox doesn't draw in 14 probe cases. An item that starts a line on a
fast-path handle still takes the simple stepper (Keeping Work Bounded, The Walkers' Shapes). On a stand-in fuzz of case
texts split into same-font items, rich lines then matched the plain-text walker's at 607 to 981 more widths per profile,
and lost only 117 in the WebKit profile, which Safari lays out as rich inline now does (webkit-host passes all 303 probe
cases of those shapes), and 13 in the Gecko profile, where an item's own white-space processing removes a newline the
joined text keeps; a 4,858-case probe fixed 370 Chrome, 511 Firefox and 1,308 webkit-host cases and lost 11, 4 and 11
(10e75bba, #369, attributes them).

A ZWSP that starts an item keeps the line it holds at a text's start, and a zero-width break that only the joined text
gives there holds none: taking every item start that continues a run as inside a chunk lost 76 webkit-host, 3 Chrome and
2 Firefox probe cases. A fragment's text is its item's own, with the hyphen at its end taken from the copy
(harness/README.md, What a case is and when it passes): built wholly from the copy, it showed a soft hyphen that Gecko's
joined scan makes text before a bidi control (#373). In the Gecko profile a joined window that starts after collapsible
white space is analyzed after a space, which Gecko's scan reads as context, so it breaks after a bidi control that
follows the space, and after content where content comes before that space, without which a soft hyphen after the space
took a hyphen the paragraph's text doesn't (29 Firefox probe cases).

Only the Chromium profile removes a collapsible run with a newline next to a ZWSP in a neighbouring item, as Blink
transforms segment breaks in the text of the whole inline formatting context and Gecko in each text frame's own
(`transformsSegmentBreaksAcrossItems` cites both); taking the paragraph's transformation in the Gecko profile lost 30
Firefox cases of a 43,462-case probe and fixed 7.

What the design costs in structure (#370, 2026-09-28): rich inline analyses each item on its own, then patches it toward
the text the items join (`recordJoinedBreaks()`, `markUnbroken()`, `getWalkedHandle()`, the joined windows and the
passes after the item loop in `src/rich-inline.ts`, `ItemLine` and the walker's item mode in `src/line-break.ts`, and a
second handle per item with its caches kept twice, about 330 lines with comments), because fragment cursors index
`prepareWithSegments(item.text)`. Written from scratch it would be one analysis of the paragraph cut at item boundaries,
as the rebuild indexes a paragraph's content (`rebuild/src/content.ts` on branch `rebuild-20260916`), which needs a new
cursor contract and letter spacing and `extraWidth` per segment in the walker. It isn't prototyped, and is on the API
discussion's list (TODO.md).

#### Items Of Soft Hyphens And White Space

An item holding only soft hyphens and collapsible white space is no line content, since a line start consumes it, but
since #369 it takes part in the paragraph's runs and breaks as its text does in one text node. The rules, with each
browser's example, are in the comments of `src/rich-inline.ts` and of the engine profile's `spaceBeforeSoftHyphenHangs`,
and the harness's `rich/continued` families pin the lines; which engine takes which `spaceBeforeSoftHyphenHangs` value
moves only line widths, which the harness doesn't judge, so `src/layout.test.ts` pins it with each engine's whole
profile. These results shaped them. After content the item keeps the collapsed space before it: ending the line before
the item lost 288 Firefox cases of a 43,462-case probe, as Firefox keeps the space and the soft hyphen on the line.
Where a line ends after it, the browsers break at that space and move the soft hyphen on, so the space hangs, but each
engine keeps the soft hyphen on the line in other places, so the profiles name three behaviours: hanging the space also
where Chrome and Safari end the line at the soft hyphen with its hyphen lost 118 Chrome and 120 webkit-host line widths
of a 32,830-case probe, and Safari's rule, keeping it before white space after the soft hyphen, fixed 335 webkit-host
widths and lost 136 in the WebKit profile, and fixed 73 Chrome widths and lost 159 in the Chromium profile.

White space between such an item's soft hyphens follows a soft hyphen, not the space before the item, so Chrome and
Safari give it room after content and the item is walked there (Gecko collapses it into the run before: Firefox's
White-Space Run Across Items). Letting an item that starts with a hard break end the line wherever it falls, as a hard
break in one text does, lost 159 webkit-host cases of a 28,435-case probe, as Safari gives the separator a line of its
own after white space that hangs.

A line ends before an item whose reserved width doesn't fit, except an item a line start consumes, whose soft hyphen
follows the line's content: that fixed 415 Firefox cases of an 80,512-case probe and lost none, where letting the walk
end the line for every item that reserves nothing fixed 487 more Firefox cases but lost 245 more, and 11 Chrome and 58
webkit-host ones.

In the Gecko profile a soft hyphen after collapsible white space is a zero-width break, which Firefox drops, so a rich
line start consumes it wherever it reaches it (`normalizeItemLineStart()`) and tells it from a ZWSP that holds the line
by the segment's first code unit: normalizing again from the next segment, or taking an item's start as a text's start
only at its first segment, lost a ZWSP's line, and giving `normalizePreparedLineStart()`, which the plain walkers share,
the chunk's start as a parameter read Firefox's `lines` mixed stream 2.2-2.4% slower.

#### Firefox's White-Space Run Across Items

Firefox drops soft hyphens and bidi controls before it collapses white space, collapses white space with such characters
among it as one run, and carries the run from one text frame to the next (`TransformText`,
`nsTextFrameUtils.cpp:286-386`, with `INCOMING_WHITESPACE`); one of those characters that follows no white space in its
frame ends the run, and so does an atomic inline (`BuildTextRunsScanner::ScanFrame`). Bidi resolution splits text frames
where the embedding level changes, and a text run doesn't go on across the split (`ContinueTextRunAcrossFrames`,
`nsTextFrame.cpp:2023-2030`), so a dropped character at another level than the white space before it ends the run too.
Since #369 the Gecko profile follows that run across items (`collapsesSpaceAcrossSoftHyphens`; `whitespaceRunOpen` in
`src/rich-inline.ts`, whose comments have the rules and Firefox's widths). It resolves no levels and takes each dropped
character at the level of the white space before it. A soft hyphen, an embedding or override control and an isolate
initiator always have it. A direction mark has it unless it goes against the direction of its paragraph, embedding or
isolate after white space that follows text of that direction, follows a mark of the other direction, or has an opening
or closing control between it and the white space; the PDI that closes an isolate has it where the white space inside
the isolate is at the level of the text around it (ENGINE_FOLLOWUPS.md, Rich-inline item edges, has the sources and the
shapes probed). From #369 to #403 it read the paragraph's levels from a port of Firefox's (Bidi Levels), made on first
need since #371, which took every paragraph as left-to-right: the port was right in left-to-right paragraphs, and in
right-to-left ones it was wrong where the run without levels is right, as a mirror image. On six shapes with U+200F or
U+061C after white space that follows Latin text, at 31 widths from 60 to 180px, the port passed 186 of 186
left-to-right cases and 173 right-to-left ones, and the run without levels passes 173 and 186; on five shapes with a
mark or a PDI inside an embedding or isolate the port passed all 155 cases in each direction, and the run without levels
passes 142 (Firefox 156.0.1, 2026-10-01). In the harness's rich set, whose level templates are left-to-right paragraphs,
the port decided 6 Firefox cases, each a right-to-left mark with a soft hyphen after white space at an item's end. White
space and soft hyphens after an item's leading white space are part of that run, so the Gecko profile walks an item of
soft hyphens and white space only where it starts with a soft hyphen, whose white space starts a run of its own: walking
every such item there, as Chrome and Safari do, lost 421 Firefox cases of a 28,435-case probe and fixed 30. The run
fixed 6,220 Firefox cases of an 80,512-case probe and lost 220, most of which Firefox lays out otherwise as spans than
as one node, and moved no Chrome or webkit-host case; since #372 (2026-09-28) an item of only white space and bidi
controls between words takes one space, as in Firefox. What it still gets wrong, such as two spaces around a control at
another level, which one gap in one item's font can't hold, is in ENGINE_FOLLOWUPS.md, Rich-inline item edges.

#### Atomic Items' Own White Space

Since #369 an atomic item's own leading or trailing white space makes no gap: every engine lays an inline-block's text
out as a paragraph of its own, whose lines drop white space at their edges, and places the box in the outer line as one
object (Blink's, WebKit's and Gecko's sources are cited at the rule in `prepareRichInline()`). Items `see`, atomic
` chip`, `this` in 16px Arial at 60px take a 55.15px first line in all three browsers, where the gap made it 59.60px.
On three probes that fixed 1,845 Chrome, 818 Firefox and 1,884 webkit-host cases and lost 76, 81 and 101, 241 of the
258 losses holding a soft hyphen or bidi control beside the atomic item's white space, where the gap had made up for
white space Pretext gets wrong there. In Firefox an atomic item's leading white space also collapses into an open run.

#### CJK At An Item's Edge

Three facts about span edges, in Chrome 154.0.8037.57 and Firefox 156.0.1 on macOS 27.0 at DPR 2, in 16px Hiragino Sans
and PingFang SC (2026-09-30 to 10-03), which rich inline follows since #TBD. webkit-host hangs no U+3000 and halts no
mark, and none of its cases moved.
- A run of U+3000 that ends a span is the line's trailing white space. Where the span fits only without it, Chrome and
  Firefox end the line after it, so a narrow letter, a box or a chip in the next span starts the next line, as in one
  text node: `文字`, U+3000 and a span `i` take two lines at 36-47px, where `i` would fit after `文字` (Blink's
  `HandleTrailingSpaces`, `line_breaker.cc:2447-2456` and `2518-2533`, Chromium 153; Gecko trims a frame's trailing
  white space only where the frame itself breaks, `nsTextFrame.cpp:11202-11214`). Rich inline had kept the item's
  width without the run and put the next item over it. What the next span starts with, where no break comes before it,
  tells the two engines apart. Chrome's trailing line ends before it whatever it is: `文字`, U+3000 and a span `」文`
  are `文字　` and `」文` at 32-47px, where their text in one node returns to the break before `字`. Chrome trails
  the run only where its trailing white space starts with it: after a collapsible space in the same span its line
  trails that space alone, and the run starts the next line (`line_breaker.cc:2447-2471` and `2518-2522`), so
  `日本語 `, U+3000 and a span `」文` are `日本語` and `　」文` at 54-60px. Firefox fits the next frame's text to the
  room left, none after white space that hangs, without the spaces a break follows, and takes the first break
  whatever fits (`BreakAndMeasureText`, `gfxTextRun.cpp:1091-1107` and `1152-1160`), and it places a frame that is
  then empty past the line's end (`CanPlaceFrame`, `nsLineLayout.cpp:1264-1270`). So a start that takes no room, a
  ZWSP, a word joiner or a U+3000 that hangs, stays on the run's line with the preserved spaces after it, after a
  box of width 0 too, unless that line has no break of its own (ENGINE_FOLLOWUPS.md), and a closing mark there
  takes the line back to its latest break. With a span of a ZWSP and `ab`, both browsers give `文字　` and `ab` at
  32-44px; in 16px Arial pre-wrap at 40-52px, after `ab cd   `, Firefox keeps the two spaces of a span of a ZWSP,
  two spaces and `ef` on the first line. A ZWSP that is all of its span stays there before a span that starts with a
  line feed too, where no break follows it: its frame is as empty. Two things take that frame off the line. Firefox
  breaks after a run of spaces and tabs and never before a tab (`nsLineBreaker.cpp:316-331`), and a tab has an
  advance, so where the start, and the spaces and text of no width after it, run into a tab, in the same span or a
  later one, no break after the frame's start fits, and a frame that can end before its first character places no
  text (`nsTextFrame.cpp:11469-11471`): Firefox starts the second line with the space and the tab of a span of a
  ZWSP, a space, a tab and `ef`. It can end there where the line has a break to end at, before the span or earlier;
  a line with none wraps before any cluster (`gfxTextRun.cpp:1068-1074`), so there the start stays and only the tab
  moves down: `文字`, U+3000 and a span of a ZWSP, a tab and `go` in pre-wrap are `文`, `字　`, the tab and `go` at
  24-30px, with no line for the ZWSP, and go back to the break before `字` at 32-42px. Since #395 the plain-text
  walker ends a Firefox line before a tab that doesn't fit, so the stepper reads the tab from the text and no
  longer from what its walk took (2026-10-03). And Firefox gives a run of U+3000 right before a line feed in the
  same span its width, as in one text node (ENGINE_FOLLOWUPS.md, Line edges), so the U+3000 of a span of U+3000,
  a line feed and `ef` takes a line of its own, where it hangs on the first line before a letter, at the
  paragraph's end and before a line feed that starts the next span.
- Chrome's `text-spacing-trim` halts a pair of fullwidth marks that a span edge splits as in one text node, whatever
  the two spans' weights, sizes or families and with padding between them, each mark by the font of its own span, since
  `HanKerning::Compute` reads the paragraph's text on both sides of each shaped run (`han_kerning.cc:262-320`): `文字」`
  and a span `。文字` are 88px wide, where the two measured apart take 96px, and a 20px `「引用」` before a 16px `。` halts
  `」` by 10px. Measured apart, `これは`, a bold `「引用」` and `。と言った` wrapped otherwise than Chrome at 68 of 141
  widths from 60 to 200px.
- A closing mark that Chrome halts at a span's end, where the span fits only so, stays halted where the line goes on:
  `文字」` and a span `i` take one 43.81px line at 44-47px, where their text in one node takes two, of 40px and
  3.81px. Rich inline did this before #TBD, and still does. Chrome halts the mark only where a break comes right
  after it (`ShapingLineBreaker::ShapeLine`, `shaping_line_breaker.cc:342-363`), and its scan gives none before a
  space, a tab or a line feed: `文字）` before a span that starts with a space, or with that space ending its own
  span, or before a span that starts with a line feed in pre-wrap, breaks before `字` at 40-47px, as in one node,
  and so does `設定）` before a space and a box or a chip. A chip's own leading space is no such space, since its
  inline-block trims it: a break comes right after the mark, and `設定）` before a chip ` @a ` fits 40-47px halted.
  Rich inline had kept `文字）` halted on one line there, since an item's own text ends at the mark: 8 of the 49
  widths from 28px to 76px for each of 12 such shapes, and 50 of 726 widths for six styled sentences with a space
  after a bold or linked closing bracket, which all pass since #TBD but 32 widths of two sentences that fail for
  U+3000 after a space (below).

The Chromium profile's break before the item after a trailed run reads `trailedSpacesEndLine`, and the Gecko
profile's walk with no room reads `emptyFrameAlwaysFits`, the field #405 gave the same `CanPlaceFrame` rule for an
atomic item of width 0 (as `emptyAtomicAlwaysFits`), now named for the frame.

These counts are of probes recorded fresh in two document orders on 2026-10-03, each case predicted with main at
#411 and with #TBD. On one of 23,757 cases (styled Japanese and Chinese sentences at 120-600px in nine font stacks;
pairs of marks across span edges at 16-160px, and inside units filled grapheme by grapheme; U+3000 at a span's end
before letters, digits, emoji, boxes, chips, closing marks, a ZWSP, a soft hyphen and a word joiner, in normal white
space and pre-wrap; a ZWSP or U+3000 that starts a span after other overflow; and a chip of only white space, Objects
Inside A Line), #TBD fixes 3,286 Chrome, 538 Firefox and 397 webkit-host cases and loses none. The styled sentences
go from 5,608 to 6,199 of 6,210 in Chrome through the pair halt: of the 602 that fail on main, 162 have a wrong line
count and 440 the right count with a wrong break, and 2 and 9 are left. None moves in Firefox, which doesn't halt,
since only something narrower than the run can follow it wrongly. Six more probes of 71,644 cases that looked for
what breaks at these edges (a collapsible space before or after the run, a start that takes no room before tabs,
spaces and line feeds in its own span and the next, a closing mark before spaces, boxes and chips, a soft hyphen
after a split pair, sentences that use U+3000 as a separator, and 9,800 seeded draws) fix 5,768 Chrome, 2,274
Firefox and 773 webkit-host cases and lose 24 Chrome, 16 Firefox and 1 webkit-host case that main passes. In
Chrome: 13 where the pair halt gives the right widths and a soft hyphen's hyphen then doesn't fit, and 11 through
U+3000 hangs the plain-text walker gets wrong, which main's own errors hid. In Firefox: 15 at 16-20px and one of
those hangs. In webkit-host: one sentence at one width, where main's line, short of a chip's 8px of padding, hid a
width 1px over WebKit's. Two last probes of 40,196 cases, aimed at white space that goes on after the run and at
starts that take no room, fix 4,755 Chrome, 1,922 Firefox and 248 webkit-host cases and lose 314 Chrome and 139
Firefox cases. All 314 and 124 of the 139 are white space after the run with a second run of U+3000 among it,
which both browsers hang whole and the plain-text walker doesn't (ENGINE_FOLLOWUPS.md, Line edges), and the other
15 are a start before a tab, through two more of the walker's gaps. Each of those shapes fails in one text node
on main and here alike, and main passed them as spans only because its line gave the run no room. What it leaves
is in ENGINE_FOLLOWUPS.md (Line edges; Rich-inline item edges, CJK at an item's edge). A Chrome that stops halting
across spans, which the rich set's `item-edges` cases would show at a repin, reopens the second fact.

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
(`CanPlaceFrame`, `nsLineLayout.cpp:1264-1269`; the profile's `emptyFrameAlwaysFits`) without counting the break after
it as one that fits (`:1260`, `:1506-1513`), so a frame with a width that comes next, text, a span with padding or white
space in a text node of its own, sends the line back to its last break that fit, and the empty frame starts the next
line with it; it stays where the line ends without that (`getKeptEmptyEnd()` in `src/rich-inline.ts` has the cases). `ab
`, a 0px box and `cd` in 16px Arial at 20.25px are `ab` and then the box with `cd`, and with ` cd` the box stays after
`ab`. The break before the frame comes after white space, an atomic item or a soft hyphen, each read from the text,
never from a width, which letter spacing takes below nothing. A text frame that ends in a soft hyphen leaves a break
after itself whatever the hyphen's width (`HasSoftHyphenBefore`, `nsTextFrame.cpp:11432-11439`). Gecko's line breaker
leaves a break after a text run that ends in a space or a tab whatever its advance, once soft hyphens are discarded, in
however many nodes they are, and the run's last frame breaks the line there where it ends past the line's end without
its own trailing spaces (`nsLineBreaker::Reset`, `nsLineBreaker.cpp:710-719`; `nsTextFrame.cpp:11443-11456`;
`getFrameEndSpace()`), so the frame then starts the next line. Under pre-wrap the space hangs, and Gecko's text frame
leaves out of its width the spaces that overflow the line, whatever follows the frame (`nsTextFrame.cpp:11216-11229`;
the profile's `hangsSpacesPerTextFrame`), so the box is inside the line, at its end, and stays, as does a second box, a
space or a node of a soft hyphen after it, while a span with padding after it starts the next line: in the Gecko profile
the line's run of hanging spaces goes on past an item that takes no room with the spaces that overflow, where Blink's
and WebKit's ends at one (`ComputeTrailingSpaceWidth`, `line_info.cc:289-415`; `ContinuousContent::append`,
`InlineContentBreaker.cpp:943-947`). The spaces that fit keep their width, so the box is at the line's end or right
after them (`ab `, a 0px box and a tab with `cd` in pre-wrap 16px Arial make a first line as wide as the paragraph at
18-22px in Firefox 156.0.1, and 22.25px wide above that). The Gecko profile ports this for any atomic item of width 0, a
chip of only a ZWSP too. The empty frame's placement and the text frame's hang each read a profile field of their own,
named for the rule; a field costs nothing by itself (JavaScript Engines). Of 95,507 layouts in Firefox 156.0.1
(sentences with a 0px box, or two, after every space at 120-600px in seven fonts, in normal white space and pre-wrap and
at eleven letter spacings, two-word shapes at 2-80px, Japanese, Arabic, Hebrew and keep-all Korean), 8,599 pass that
failed and 124 fail that passed, and the line count is right in 1,458 where it was wrong and wrong in 56 where it was
right. In each of the 124 Firefox has the box inside a line and Pretext's widths put it past the line's end, and they
passed only while the profile kept the box wherever it fell: 59 under letter spacing off Firefox's 1/60px grid, 31 after
a pre-wrap space that a soft hyphen follows in its item, 31 before a span with 0.004px of padding and 3 after a
synthetic bold span. The 56 are 28 of those before that padding, 14 of those after that soft hyphen, and 14 before a
chip of only a space, which had the right count with the box on the wrong line. With 56,928 more layouts of other
sentences, padded spans and soft-hyphen items, 8,175 lines changed their width in layouts that pass before and after:
7,898 are within 0.1px of Firefox's width, where 168 were, and none was that isn't now. Those counts are from before the
white space was read from the text. Reading it there moved 9,979 further layouts so: of 7,624 of a 0px box after a chip,
two letters or a sentence in 16px Arial, with a collapsed space at 0 to −6px letter spacing, soft hyphens among the
white space, a pre-wrap tab, or a last item of soft hyphens and white space, 394 pass that failed and none fails that
passed; of 858 random item sequences with tabs, soft hyphens or such spacing that it moves, 226 pass that failed and 53
fail that passed, each a tab under negative letter spacing, where Firefox's tab stops count the spacing and the
profile's didn't yet; and 1,497 it doesn't move on a stand-in Canvas don't move in Firefox. Reading the soft hyphen
before the box from the text too, and the white space through any number of items of soft hyphens, moved more: of 556
layouts of those shapes at 0, 2, −2, −3 and −6px letter spacing, 95 pass that failed and 10 fail that passed; of 23,972
random item sequences it moves 85 on a stand-in Canvas, of which 39 pass that failed and 9 fail that passed in Firefox,
and 600 of the others don't move there. The 19 are under negative letter spacing, in layouts where Firefox has the box
inside the line and Pretext's widths put it past the line's end, which the older reading hid: 16 a tab before items of
soft hyphens, 2 a pre-wrap space before the soft hyphen that ends its item, 1 a padded span's last piece (2026-10-01,
#405; ENGINE_FOLLOWUPS.md, Rich-inline item edges, has them and the gaps left; the harness now records a box of width 0
by its top). All of those counts are from before #394 to #403, and two of their causes are closed since: letter spacing
off Firefox's grid by #397 and tab stops under letter spacing by #395. With them in, of 18,675 layouts in Firefox
156.0.1 (the 9,979 and the later 1,253 recorded again, unchanged; the unit test's rows at their widths; and 7,215 of a
sentence with a 0px box after every space at five letter spacings on and off the grid), 3,418 pass that fail on main at
#403 and 41 fail that pass there: 39 a pre-wrap space before the soft hyphen that ends its item, 1 a space narrower than
nothing at −6px and 1 a tab that ends its text run at −2px (2026-10-02). That reopens if a Firefox build changes
`CanPlaceFrame`, how a text frame trims the white space it breaks after or where it ends the white space that hangs
(`nsTextFrame.cpp:11202-11229`). A negative width is refused, as one that isn't finite is. An inline-block of width 0
with a negative right margin lays out as a negative `extraWidth` does in Firefox 156.0.1 and webkit-host, but Chrome
154.0.8037.57 ends a line at a space that overflows before it and starts the next line with the box, where the negative
width would bring the line back within its width, and fits a word after it that rich inline moves to the next line (`one
two`, a -15px box, `three four five` in 16px Arial, `one two three` at 77.5px): 51 of 884 layouts of four shapes at
10-120px differ in Chrome and none in the others (2026-09-30). No app was found that needs one; the negative values apps
pass are `extraWidth`s relative to a stand-in character. That reopens if one does.

An atomic item whose text is only white space is a box of its `extraWidth` (#TBD): its inline-block trims the white
space and is then empty, so it makes no gap, keeps its padding and breaks on both sides. The paragraph's height tells,
since nothing of the chip is visible: of 150 layouts at 20-150px (`hello`, a chip of a space and `world again` in 16px
Arial, bare, with 6px of padding on each side, with spaces around the chip and in pre-wrap, and a padded one between
ideographs in 16px Hiragino Sans), the box gives the browser's line count in all 150 in Chrome 154.0.8037.57, Firefox
156.0.1 and webkit-host, where the gap that main made of the chip in normal white space, and the item of no segments
it made in pre-wrap, gave it in 128, 130 and 128 (2026-10-01). An empty atomic item stays no item, as any empty item.

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
  cursor and fragment indices. Both analyses stay, each item's own and the joined text's: their segments differ in 457
  of 3,000 random rich-inline flows, and the joined pass was about 1% of preparation on 2026-09-16, before #369 to #371
  gave it joined windows, a second handle per item and Firefox's levels, which left with #403; it hasn't been timed
  since.
- Measure a collapsed space itself: `measureText('A A') - measureText('AA')` includes A–A kerning.
- An item's reserved width, the collapsed space before it plus its `extraWidth`, is checked before the whole item's fit,
  and rejects the item only when it's above the remaining width plus the fit epsilon (`lineFitEpsilon`): checking the
  whole item's fit first lost nine Safari forced-overflow matches, a broader guard 62 (2026-09-13; old suite).
- Chrome and Firefox break before the ZWSP in `a`/ZWSP/`hello` at width 1 even in one text node, so a run that began the
  line still breaks at item boundaries on overflow; atomic `break: 'never'` items allow a break on both sides, as
  css-text requires (2026-09-12).

#### A Wider Box Never Needs More Lines

A line count that rises with the width is a bug: four raw-width fit checks in `src/rich-inline.ts` gave 11 lines at
115px, 12 at 115.1px (#281, 2026-09-14). An item ending at an unfit soft hyphen with no earlier break wrapped before the
item (items `T` and `po\u00add` gave `T` / `pod`, where `Tpo\u00add` gives `Tpo-` / `d`; #323). Blink retries the item
at the width less the hyphen, then rewinds earlier items at the full width; subtracting the hyphen left sub-1e-6px
backward ranges, so the item was walked again to the soft hyphen, cutting the flows in a seeded search that take more
lines as the width grows from 43-60 to 7-14 per profile (#327, 2026-09-15; ENGINE_FOLLOWUPS.md). Since #369 the walk
that continues the line decides whether the text before the hyphen fits, and which earlier breaks a return may take is
at the rich stepper's return in `src/rich-inline.ts`. A run that continues across items moves to the next line whole in
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

Rich inline takes `pre-wrap` (#173), on its premise that spans lay out as their text in one text node (Joined Text): each
item's analysis and the joined text's take it, and since nothing collapses, a window runs from one atomic item to the
next. A run of preserved spaces that ends a line hangs across items: an item's walk starts inside the run the line ends
with (`ItemLine`), so its spaces fit where the content before the run fits, and the rich line hangs the run where it
ends, all of it where the line wraps and before a hard break or at the paragraph's end only what doesn't fit, as Blink
walks back over item results (`ComputeTrailingSpaceWidth`, `line_info.cc:289-415`), WebKit exempts each white-space
item's hanging width from the fit (`InlineContentBreaker`) and Gecko hangs each frame's trailing white space
(`nsTextFrame.cpp:11214-11229`). Tab stops count from the line's start, never an item's (Blink's
`line_breaker.cc:2963-2971`, WebKit's pen position, Gecko's `CalcTabWidths`, `nsTextFrame.cpp:4298-4378`). No break
comes before a hard break (UAX #14 LB6). A padded span that starts with one fits its padding there as each engine fits a
span whose line ends as it opens: Chrome its start edge, as Blink adds that edge when the span opens and a forced break's
close tags trail it, and no edge after preserved spaces that overflow or follow text in one span, as its return breaks
that text before them and the line then trails the spaces, the open tag and the forced break (a run of tabs is an item
of its own there, so a tab, and spaces after one, follow no text); Safari its end edge too
where the span holds only white space up to the break, as WebKit's content runs on past the box ends after a line break,
with white space that hangs before the span left out; Firefox both, as Gecko fits a frame's cloned end edge
(`paddedOpeningFit`, `src/measurement.ts`). Where it doesn't fit, all three engines return the line to its latest break;
without one, Chrome ends the line before the span, as its retry of an overflowing line breaks between any two graphemes,
and Firefox and Safari before the last grapheme of the text before it, a preserved space too, whose wrap opportunities
lie inside it, and before that grapheme's span where the grapheme is all of one; Safari keeps the preserved spaces that
fit of ones that overflow, as WebKit breaks the run that overflows where it fits (`hardBreakItemRetreat`). A break the
walk of an item gives after its preserved spaces is the next item's, which the text the items join decides. WebKit's
soft wrap index loop ends the content it places after a line break item (`InlineFormattingUtils.cpp:456-475`), so no
break comes before a line feed that starts a box there either, after an atomic item too, and allows wrapping next to a
white-space item (`:406-418`). A carriage return that ends one item and a
line feed that starts the next make one break, as CRLF in one text does. Preserved spaces, tabs that hang and a hard
break after an atomic item, without padding, stay on its line however far the line overflows, and so do they after items
of only such white space after it, whatever items it spans: no break comes before them, Blink takes them as trailing
items after the break after an atomic inline (`HandleTrailingSpaces`, `line_breaker.cc:2426-2534`), trailing on into the
next item, WebKit keeps each white-space item as content that hangs (`InlineContentBreaker.cpp:181-182`) and Gecko lets
an empty frame past the line's end (`CanPlaceFrame`), as all three browsers lay out a chip wider than the line, though
Chrome gives a line feed after such spaces a line of its own, and moves a span that starts with white space and goes on
past it whole, where rich inline takes an item as the paragraph's own text (ENGINE_FOLLOWUPS.md). But Gecko breaks only
after a run of spaces and tabs (`nsLineBreaker.cpp:323`, `:586`) and doesn't hang a tab, so Firefox moves such white
space that runs into a tab to the next line with the tab, whatever items it spans. Before #386 a line took only the
first item's white space there: of 10,991 probe inputs in 77 shapes at 20-200px, 2,173 Chrome, 1,095 Firefox and 2,223
webkit-host inputs pass since that change that failed before, and 72 Chrome and 43 Firefox ones that passed by luck fail
(Chrome 154, Firefox 156.0.1, webkit-host, 2026-09-30; the shapes are in ENGINE_FOLLOWUPS.md). A way to tell a span from
the paragraph's own text would reopen the Chrome ones. A padded span that starts with such white space or a hard break
after a chip stays where the engine fits its opening, and in Chrome one of only white space stays however far the line
overflows, as Blink's return keeps the trailable items after the break it returns to, white space and the tags of spans
that close among it (`RewindOverflow`, `line_breaker.cc:4332-4424`), which keeps such a span after any content; else the
line ends at the break after the chip, or in Safari, before a line feed, returns to the break before the chip. Blink
fits only the start edge of a padded span that starts with white space after text too, where rich inline takes the whole
`extraWidth` in Safari and Firefox (ENGINE_FOLLOWUPS.md). An atomic item lays its text out in normal white space, as a
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
Chromium profile sums graphemes, and the case stays on Chrome's accepted list.

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
differ (Kerning At Line Edges). Whether mixed bidi fits Pretext without new broken assumptions is an open question, the
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
reader, Blink's script runs under letter spacing, as a list where that rule is (`bracketPairs`, `src/prepare.ts`).

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
before each change.

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
- **Graphemes past dropped characters**: the Gecko profile's grapheme table tests only code points in the rules'
  Control category for what the text run drops; testing every code point made Firefox prepare CJK and Arabic 2-3%
  slower (#368).
- **Fresh-line geometry**, the widths a line that starts inside a segment holding an invisible character takes in
  desktop Chrome and Firefox (`src/entry-geometry.ts`), is observed only for segments of up to 96 graphemes, and an
  empty observation is kept as a found one is: since #368 a segment ending in a long run of controls is a few clusters,
  not one per control, so it falls within that bound, and observing again at every prepare made Firefox prepare the
  invisible tails 6% slower.
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
- **The simple stepper continuing a rich-inline line**: the plain line APIs' stats, walks and streams of mixed text at
  1.39-1.64 in Safari, 1.10-1.13 in Chrome and 1.06-1.07 in Firefox, so items on fast-path handles continue their lines
  in the full walker (#369, 2026-09-27).

Removing the three pieces #357 kept for Chrome's JIT (#364; Decisions Log, 2026-09-26), namely checks in rich inline's
stepper that change no result, a redundant `unfitHyphenRetreat` test and the peeled first character of the segmentation
loop, cost Chrome 154 11% on rich stats, 5% on letter-spaced CJK `layout()` and 8-13% on preparing long breakable runs
and pre-wrap chunks, in both sessions; Firefox 156 moved 2% at most, and Safari 27 only on resizing Arabic to widths it
had laid out before (13%, where the bench's control, a second copy of main, moved 5%). All of it was taken as placement
then. Counting the work each piece skips, with each put back as #364 removed it and no Chrome prediction moving (Chrome
154 and Node 23's V8, all three back in one bench, 2026-09-29), sorts them:
- **Skipped work**: the stepper's line-start test spared the read of an item's segment count on almost every item it
  visits, which #375 took back with that test on the line's first item only (below). Its early return spares the setup
  of the one call per paragraph that finds nothing left, 147 of a stats pass's 946 calls and about 0.5% of its time;
  with it back Chrome's rich stats read 0.6% slower, within noise, so it stays out.
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

The stepper's skip of a step that doesn't advance is live code since #369, which ends a line there after content.

After content, the rich stepper doesn't walk an item whose first segment doesn't fit: the full walker there only ends
the line before the item, as the stepper now does itself. `firstSegmentOverflows()` repeats the walker's fit for that
segment, a copy a comment in the walker points to. That leaves 6 of the 439 walks in a stats pass over the bench's rich
texts: Chrome 154's rich stats read 18% faster and Firefox 156's 23%, their rich walks and streams 11-13% (2026-09-29).
Testing for a line that starts at an item's end, as after a hard break, only on the line's first item, the one item that
can, instead of on every item it visits, made Chrome's rich stats 9% faster again, within noise in Firefox: that test's
reads were what #364's removed check had skipped. Chrome's rich stats now read 18% faster than main before #340, where
main at #372 read 7% slower. Against main, Safari 27's rich stats read 14% faster, and Chrome's mixed stats, whose code
didn't change (the minified `layout.ts` bundle is the same), 2% slower in two of four runs, accepted as V8's placement
of the changed bundle (#375).

A paragraph of one rich item takes the text walkers where the rich stepper would lay it out as they lay out its handle:
no `extraWidth`, not atomic, no hard break, and nothing a line start consumes at its start (`onlyItem`, chosen once in
`prepareRichInline()`). Its line functions take the item's whole fit, which the text walkers lack
(ENGINE_FOLLOWUPS.md, Negative letter spacing and hanging spaces), then walk its handle as `measureLineStats()`,
`walkLineRanges()` and `layoutNextLineRange()` do. Through the rich stepper, such a paragraph counted its lines at about
2.5 times `measureLineStats()`'s cost in Chrome 154, and 15,256 of the Markdown chat's 17,688 prose blocks over its
10,000 messages are one item. The chat's height pass, `layoutConversation()`, reads 25-26% faster in Chrome 154, 23-24%
in Firefox 156.0.1 and 17-22% in Safari 27 (2026-09-29). The results are the rich stepper's field by field, on the
stand-in Canvas over 6,267 inputs at 13 widths in all four profiles, and in Chrome, Firefox and webkit-host with every
plain case in white-space: normal predicted as one item. The bench's rich rows, whose paragraphs have an item per word,
read within noise.

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
both made Node 23's V8 store each zero as a boxed double (#366, #370). Overflow trims read in `countPreparedLines()`'s
loop cost Firefox 156 13-26% counting long breakable runs, so `layout()` counts a handle with overflow trims through
the simple stepper, and its line APIs keep the simple walk, without which Chrome 154's line APIs ran 62-108% slower on
CJK messages (#366, 2026-09-27). `measureAnalysis()` keeps its helpers as closures: hoisted, they
measured the same in offline replays of all four profiles the replay runs (Blink, WebKit, Gecko and an unrecognized
engine's) but took 16 more lines, and a hoist lands only if it removes lines and the bench shows a gain, so they weren't
timed (2026-09-26). AGENTS.md's locals rule is for line walkers.

#### JavaScript Engines

Part 1, Engineering, says when an engine fact may shape code. These did, or moved a measurement:
- **V8's inlining budget**, about 460 bytes of bytecode, minified or not, is why `getLongMarkChainContext()` holds the
  long-chain loop: inside `getMarkContext()` it cost the inlining and up to 2.6% of Chrome 154's `prepare()` (#351,
  2026-09-26; the comment there has the bytes and the flags).
- **JavaScriptCore's type checks**: with a segment's width sum inline in `measureAnalysis()`'s loop, the DFG tier kept
  failing a type check over letter-spaced CJK and never reached FTL, and Safari 27 prepared letter-spaced CJK and
  keep-all CJK brackets 45-59% slower; with the sum in `getTextSegmentWidth()`, 9-10% faster than main (#358,
  2026-09-26).
- **Captured numbers and loop bounds**: V8 boxes a number a nested function captures (a write 12-14ns in the full
  walker, about 1ns as a local), and JavaScriptCore types an infinite default loop bound as a double (Bun walked
  letter-spaced and pre-wrap text 30-65% slower). Fixing both halved letter-spaced CJK `layout()` in all three browsers
  (#340, 2026-09-24).
- **The same budget on `getEngineProfile()`**, which the line walkers call for every line: 1,000 times in a stats pass
  over the bench's 134 mixed messages. While it built the profile itself it took 454 bytes with the profile's 23 fields,
  6 under the limit, and 463 with a 24th, a boolean at any position and read by nothing. With that one, Chrome 154's
  plain line APIs ran 11-18% slower (mixed stats, walk and stream) and two worst-case `layout()` rows 3-7%, in two bench
  sessions of each of three builds. The bytes did it, not the field. Chrome 154.0.8037.57's V8, traced headless
  (`--js-flags="--trace-turbo-inlining --trace-maglev-inlining"`), inlines the 454-byte function into
  `countPreparedLines()` and the simple and rich steppers and refuses the 463-byte one ("exceeds bytecode limit"), as
  Node 23's V8 12.9 does. There, on a stand-in Canvas, the 463-byte build read 11-18% slower on mixed stats, walk and
  stream and 7-21% on four `layout()` rows (medians of 10 sessions), a 462-byte one with no new field 7-18%, a 24th
  field of a constant value, which adds no bytecode, as main, and the 463-byte one as main with
  `--max-inlined-bytecode-size=470`. So the accessor is a function apart from `buildEngineProfile()`, 21 bytes whatever
  the profile holds, which both of V8's optimizing tiers inline in Chrome 154, into the full walker too (Maglev takes no
  function over 100 bytes, and TurboFan left the 454 bytes a call there), and the Gecko rule for an atomic item of width
  0, which read `paddedOpeningFit` to keep the profile at 23 fields, has a field of its own (`emptyFrameAlwaysFits`).
  With both, Node read mixed stats, walk and stream 6-8% faster than main and the other rows within 2%. Node's times are
  a lead only; in Chrome 154 the bench read every row of this build within noise of main in three sessions, the line
  rows included, which the field alone had read 11-18% slower (#391, 2026-10-01). No other function inlined while
  preparing and laying out the bench's mixed and rich texts takes over 374 bytes (`getMarkContext()`, above).
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
  shells' numbers are hypotheses, on a stand-in Canvas; the browsers' are the bench's, whose tables are in the PR. A new
  expression with such a class that most text never reaches goes through `lazyRegExp()`; one tested per segment stays a
  literal. Reopens if the bench reads the worst-case rows level with those five built at first use.
- **A loop slows once a check in it has held**: a check in the counter's loop that handed unbroken-boundary lines to the
  full walker slowed counting all other text up to 1.6 times in Firefox and 1.3 in Chrome, though the check alone cost
  nothing (#350, 2026-09-26).
- **A block that never runs**: since rich items continue their lines, Firefox 156 measured the bench's rich stats about
  6% slower, and its rich walk and stream about 2%. It isn't the full walker, as #369 supposed (sending items on
  fast-path handles back to the simple stepper read +0.2%): without the block at the top of the rich stepper's item loop
  that records the break before a continued item, whose body never runs on the bench, rich stats read 4.7% faster,
  faster than before #369 too. None of three plain restructurings took it back (the hang of the spaces before consumed
  items in a function of its own, or left out, and the line's latest break as one record), so
  it was accepted as a regression one JIT alone explains in live code (#370, 2026-09-28; Decisions Log, 2026-09-26, no
  dead code for one JIT). Since the rich stepper stopped walking items whose first segment doesn't fit and tests for a
  line that starts at an item's end only on its first item (The Walkers' Shapes, 2026-09-29), rich stats read 16% faster
  than before #369, and without the block 5% faster still, at the rich row's floor.
- **State a loop keeps for its rare paths**: with pre-wrap (#381), Chrome 154 and Firefox 156 read the bench's rich
  stats, walks and streams of normal white space 5-9% slower than main, doing the same work: each stats pass visits
  4,246 items, fits 2,781 whole and walks 13 in both, in every profile. With main's stepper in the branch, both read
  within noise. The one pre-wrap check that ran on every item, whether the line keeps a padded item's opening, now runs
  only where the line can't take the item's padding and before a walk, 52 times a pass, which Chrome read within noise
  of running it on every item. In Chrome, with every pre-wrap statement that runs on normal text left out as well (the
  hang bookkeeping, the retreat check before continued items, and the hang at the line's start and end), rich stats
  still read 7-11% slower, and with the line's start, which only the rare pre-wrap paths read, made a constant, 4-5%;
  main with those three values kept alive read 2% slower. So it's how the JITs allocate the bigger loop's state, not
  work, and it was accepted as a regression JIT placement alone explains in live code (#381, 2026-09-29).
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
  | That build plus one unused local in the rich stepper | the branch's, all 412 | +13.2%, +12.3%, +17.6% |
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
  alone says nothing about a change whose code `layout()` doesn't run (`harness/README.md`, Bench). Making those
  constants literals in the emitted code would take the names out of it, and is being tried apart from #405. Reopen on a
  Firefox whose scopes give every binding one kind of slot, or if the row moves between two builds whose minified names
  are the same.
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
`getSegmentMetrics()`'s lookup is a segment's first, so every Latin-1 segment reaches Canvas one-byte and measures as
Latin. Chrome's page paints a script-neutral run that way after Latin and in all-Latin-1 text, but not after Arabic or
Han, or between em dashes with no letter around: Blink gives the run the script before it, and only at the paragraph
start the script after it (`script_run_iterator.cc:503-516`; ENGINE_FOLLOWUPS.md). (Chrome 153 and 154, 2026-09-18 to
09-27.)

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
  and symbols, so kerning against spaces is lost (Times New Roman `AV To We. V, A Y o`: 262.45 px, DOM 254.23).
  `optimizeLegibility` shapes whole strings only where lookups involve the space glyph
  (`font_fallback_list.cc:264-277`): Arial, Times New Roman, PingFang, not Georgia, Helvetica Neue, Verdana (Dead Ends,
  Kerning). U+2028 for each U+0020 keeps a string whole, legacy `kern` fonts included, but makes it two-byte and takes
  no word spacing. Canvas shapes each ICU level run in its own direction, the DOM a group in one; a two-byte RTL group
  in U+202E … U+202C is one level run. U+FFFC becomes U+200B (`character.h:167-175`): zero where the DOM draws a 1 em
  fallback glyph. (Chrome 153, 2026-09-16 to 09-23.)
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
  follows a reduced port of that iterator (#397, `src/prepare.ts`): in Chrome 154 it gives 64 probe strings Chrome's
  gaps, and the real-usage sample's 8 failing Arabic and Urdu paragraphs under letter spacing pass (2026-09-30 and
  10-01). A Common character right before a mark that has script extensions takes the mark's scripts
  (`FetchNextCharacter`, `:624-635`), whose lowest code leads: `1` under the Arabic vowel sign U+064B starts an Arabic
  run among Latin letters, and under U+0303, which Latin, Syriac and three more scripts share, it leaves an Arabic run
  and stays in a Syriac one; the port follows all but the last. A wide opening bracket under such a mark has the mark's
  scripts before its width is asked, so it isn't made Han (`Fetch` runs before `OpenBracket`, `:334-338`, `:431-441`). A
  character several scripts share starts a run that holds them all, the lowest code leading, Latin aside for a Common
  character, which the next character with a script narrows, and it stays in a run of any of them (`GetScripts`,
  `MergeSets`, `script_run_iterator.cc:118-215`, `:491-565`); a Common character that only one script lists stays in
  whatever run it is in. The port gives a shared character its leading script wherever it stands and leaves the rest
  out: U+202F, which Latin, Mongolian and Phags-pa share, takes no gap alone, after Arabic or between Han characters,
  and one among Latin letters, and its Mongolian run takes in the digits around it, so `10`, U+202F, `000` in a text of
  its own takes none of its 6 gaps (Chrome 154, 2026-10-01; ENGINE_FOLLOWUPS.md, Letter spacing). A tab stop is eight
  Canvas spaces plus letter and word spacing (`font.cc:303-317`), rounded up to 1/128 px at DPR 2
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
  run alone in a fresh process. (webkit-host, 2026-09-17 to 09-24.)
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
  between lam and alef never fits more text. Real text breaks inside ligatures under break-all, in long words, at soft
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
- **Span edges.** A span's end border and padding are reserved on every line it occupies (`nsInlineFrame.cpp:516`), so
  shrink-wrapping padded spans to the widest line can move a break (2 of 55 widths), as with the Markdown chat's inline
  code; Blink and WebKit don't. (Firefox 156, 2026-09-19.)
- **OffscreenCanvas against the DOM.** OffscreenCanvas shapes at the CSS size at 60 app units per px, the DOM at the
  device size, rounding each glyph at max(1, round(60 / dpr)) units per device pixel (`gfxHarfBuzzShaper.cpp:1559,
  1699-1702`): about 0.03% of widths are a unit off (Geeza Pro, Thonburi, Helvetica Neue), no traced break moved, and
  synthetic bold likewise (`gfxFont.h:1899-1904`). A `<canvas>` element at the device size matches (243 of 243 units);
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
  profile takes CR and FF out since #399 (Engine Facts, Firefox, CR and FF).
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
  overflow and the break returned to is truly the latest. Returning past breaks with no segment kind lost 142 Chrome
  rows, both rules for a soft hyphen with no fitting opportunity hundreds (the #323 entries on `harness/accepted/`'s
  lists), Firefox's (4e6d4dd5, branch `archive/gecko-soft-hyphen-return`) 15 per direction. They reopen with contextual
  widths during preparation.
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
  turn features on for every measurement (Engine Facts, Chrome). Reopens with a whole-string mode, which U+2028 in
  place of each space is, as the rebuild measures: it was never weighed for main on its own (ENGINE_FOLLOWUPS.md,
  Kerning Chrome's Canvas doesn't report).
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
    to an object, such as `$x$,` kept with its comma, which no width expresses and which needs the rich stepper's
    pending break.
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
  it; not timed since) and carries the per-item cursors (Rich Inline Boundaries), and Safari's extra calls are prefix
  fits WebKit needs. The reverse, one analysis of the paragraph cut at item boundaries, is on the API discussion's list
  (Rich Inline Boundaries, Continuing The Line; TODO.md).
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
  Every line loop starts with `Math.max(0, maxWidth)`, or `Math.max(1, maxWidth)` in rich inline; written as two
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
- **Allocation order.** Timed on data each library prepared in turn, whichever library prepared last read 20-28%
  slower in Chrome 154 over the Markdown chat's 10,000 messages, the control copy of base too; preparing the libraries'
  messages interleaved, a message at a time, put the control within 4% (2026-09-29). The bench prepares each
  operation's handles in a shuffled order, so its control copy shows where that order moves a row.
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
  isn't dead and stays, such as `getLongMarkChainContext()` (#351) and `getTextSegmentWidth()` (#358). Removing the
  three pieces #357 had kept for Chrome's JIT cost Chrome 154 up to 13%, and removing `countPreparedLines()`'s
  leading-space skip, a loop that never runs, kept on 2026-09-24 for Firefox, read 3 and 7% slower in Firefox 156's two
  sessions on resizing Latin chat messages to new widths, within noise (#364). Counted on 2026-09-29, only one of the
  checks removed skipped work that mattered, the rich stepper's line-start test, whose saving #375 took back plainly;
  the rest was placement or too small to read (Keeping Work Bounded). A check that changes no result can still skip
  work, so count the work it skips before calling a slowdown one JIT's. Nor is a rule written out twice for one JIT: the
  Gecko scan's two text-run setups share one word-end test, whose call makes Firefox 156 prepare four kinds of row 2 to
  5% slower than two copies would (#365; Bidi Levels has the rows). That was judged a good trade on 2026-09-27; the
  second setup left with the level splits (2026-10-01).
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
- **2026-10-02: a `maxWidth` that isn't a number lays out as unbounded in the line APIs called once for a paragraph, and
  the streams take it as given** (landed on judgement with #401). `NaN`, or the `undefined` of a container not measured
  yet, fails every comparison, and the line loops ask some whether a segment fits and others whether it overflows. So
  since #340 `layout()` counted a line per grapheme where the other line APIs gave one line, and those reported a `NaN`
  width for a pre-wrap line ending in spaces. `normalizeMaxWidth()` (`src/line-break.ts`) turns such a width into
  `Infinity` with one comparison, once a call, in `layout()`, `layoutWithLines()`, `walkLineRanges()`,
  `measureLineStats()`, `walkRichInlineLineRanges()` and `measureRichInlineStats()`, whose loops stay as written for
  numbers: none of their results at `NaN` or `undefined` differs from the one at `Infinity` (8,000 cases drawn from the
  sets in each profile, offline). `layoutNextLine()`, `layoutNextLineRange()` and `layoutNextRichInlineLineRange()` are
  called once for each line and don't check: they return, break as at an unbounded width, and differ from `Infinity` in
  three places (ENGINE_FOLLOWUPS.md, Small ones). Two wider forms were timed in Chrome 154.0.8037.57 and dropped, as
  valid input paid in each for an argument no app should pass. With `layout()`'s two fit tests negated into overflow
  tests, so that its count asked the walkers' question, `layout()` of the bench's Arabic book read 3.4-4.8% slower in
  each of three sessions (2026-10-01). With the function in the three streams too, those rows read within noise again
  over three sessions, and the mixed stream row, which then paid the comparison for each line, read 1.7% and 3.4% slower
  in a run of two sessions and 3.4%, 11.2% and 1.4% in one of three (2026-10-02). In that run of three the mixed
  `walkLineRanges()` row, which pays the comparison once for a paragraph, read 1.2-1.4% slower in each session with the
  second copy of the base 0.5-1.1% slower, and in the run of two 2.4% faster and 2.8% slower; a run that reads it slower
  in every session with the streams as on main would reopen the comparison there. A third form closed the streams'
  three places with no comparison added, and lost in Firefox (#409, closed unmerged): each line loop already clamps its
  width, with `Math.max(0, maxWidth)` or, in rich inline, `Math.max(1, maxWidth)`, and that clamp written as two
  comparisons returns `Infinity` for a width that fails both. It changed no result at a number and left no line API's
  result at `NaN` or `undefined` different from the one at `Infinity`, but Firefox 156.0.1 read the mixed
  `measureLineStats()` row 9.3% slower than main, the mixed walk 7.8%, the mixed stream 1.7% and mixed `layout()` at
  widths seen before 10.2%, each in all three sessions (2026-10-02; Dead Ends, Simplifications Held Back, has Chrome's
  reading and the shells'). So `normalizeMaxWidth()` stays and the three places stay documented; a form that Firefox
  reads level with main on those rows would take its place. Whether such a width should throw, as a `letterSpacing`
  that isn't finite does (#356), is on the API discussion's list (TODO.md): in the six APIs a throw would go in that
  one function, and in the streams it would cost the comparison for each line again.
