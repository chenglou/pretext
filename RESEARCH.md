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
  nothing that costs complexity; the WebKit profile follows Safari 27 only (Decisions Log). Windows is untested, and
  sampling platforms the project can't run (Windows, Android) stays modest, since fewer Pretext users target them. For
  the harness's real-usage sample (harness/README.md, Two kinds of set), choosing which real text it holds matters more
  than adding platforms (2026-09-24).
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

The rebuild scores itself on case sets of its own and never runs main's harness cases, so compare a rule by reading it
and its unit tests (`rebuild/src/engines/<engine>/`) against the engine's source.

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
- **The public exports didn't change** while the engine work from #340 on landed. The API discussion, a review of the
  whole public API at the end of the project and before any release, has issue #321's `direction` option and
  `devicePixelRatio` in `layout()` on its list (TODO.md). One bundle serves every engine (Decisions Log, 2026-09-26).
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
- **A PR's story stays in the PR (2026-09-28).** Its full account (the rounds, the probes, every case it moved) goes in
  its description; this file gets the durable fact: the claim, its number, build and date, its source and what would
  reopen it. Six PRs in a row appended about 7,500 words here before this rule.
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
  passes: losses nobody can attribute, complexity out of proportion to the gain, special-case hacks. If a change makes a
  worst case worse, its fix goes in the same PR. Close an issue only when it's solved on main, and a superseded
  community PR with thanks.
- **Public posts** go out only at the maintainer's word, once verified, and sound like them: casual, details kept, no
  report phrasing or demands, in the contributor's language. Public issues and branches carry no private details. A
  feature too hard for now is parked in an issue with the findings and what support would take; a stale public issue
  gets a new comment and a one-line status at the top.
- **Browser bugs** are recorded and filed as PLATFORM_BUGS.md says. A crash or hang found while probing stays out of
  public issues, branches and docs until triaged; one such Chrome hang went in as a restricted security report.
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

A chosen soft hyphen paints U+2010 where the primary font maps it, else `-`; since fallback supplies U+2010, only
measuring under two fallbacks whose U+2010 differ tells which (36 of 36 families, rebuild harness). Only Safari
letter-spaces the hyphen. Pretext measures `-`, a gap ENGINE_FOLLOWUPS.md sizes.

Safari's page turns off `liga`, `clig`, `dlig` and `hlig` under any non-zero letter spacing and its Canvas
`letterSpacing` doesn't (WebKit #283408 lacks WebKit #176215's fix): 32px Hoefler Text `ffi fl` at 0.001px is 54.403px
in Canvas, 57.414px on the page (webkit-host and Safari 27, 2026-09-16 to 19); Chrome's agree. Pretext's model, the
unspaced width plus the spacing per grapheme after the first, is 2-3px off Safari in Amiri, Hoefler Text and Futura, and
no Canvas string gets two letters unligated into one Safari shaping call (1,596 strings in 15 fonts; Dead Ends,
Kerning). A WebKit fix would make it exact.

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
and profile and finishes from promises, not timers, which a hidden window stalls; a page whose bug is a call that never
returns first sets its title to `STEP ...`, so a driver records a hang after 30 s. Chrome's `Range.getClientRects()` can
hang forever on one narrow constructed case, reported to Chromium with restricted access, so jobs drawing generated
cases need a stall limit and a way to skip, and the trigger stays unpublished (Part 1, Merge Bars And Landing). Read
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
15 positions in right-to-left paragraphs (2026-09-23), such as `ab””tail` under `direction: rtl`; the Gecko scan takes
every paragraph as left-to-right, since Pretext takes no direction, which, compared with resolving under each
paragraph's real direction, moves none of 4,346 right-to-left old-suite and corpus requests and 192 of 8,125 fuzz
requests.

Take each browser's shipping data, not upstream's latest: Chromium 147's `line_normal.brk` differs from 153's on 239
code points, and headless Chromium 147's ICU 77 breaks otherwise wherever ICU 78 changed the rules (the dashes it added
to the HH class, unambiguous hyphens, beside U+2010; LB20a; LB21a), so headless evidence can't check those. ICU's
`ppucd` writes no `cp` line for 210,383 code points whose values equal their block's, so a generator reading only `cp`
lines gets Cn for U+3400.

The tables are ICU's compiled state machines, whose states a small rule change renumbers. As 480 KB of base64 they cost
a fresh Firefox page 5.2 ms evaluating the bundle, against 1.2 ms before #340, so each is stored as byte ranges of an
earlier table plus literal bytes and a browser unpacks only its own, 0.4-0.6 ms a page, for 133 KB minified and 64 KB
gzipped. Keeping Chrome's root table whole and copying the other line tables from it at runtime instead gave 238 KB and
57 KB and took 3.6 ms in Firefox (2026-09-24). The tables stay as they are, and one bundle serves every engine
(Decisions Log, 2026-09-26).

In Line_Break=SA runs (Thai, Lao, Khmer, Myanmar, and in the Blink and WebKit scans also Tai Le, New Tai Lue, Tai Tham,
Tai Viet and Ahom), `Intl.Segmenter` words stand in for the engines' dictionaries. Chrome 153's equal those of
`Intl.v8BreakIterator`, which runs the ICU of Chrome's layout, on 273 corpus paragraphs, though the Blink scan misses 69
Khmer positions; JavaScriptCore's differ from libicucore's line iterator at 27 of 282,337 positions, all where a range
starts with a combining mark; Firefox 155's matched Gecko's models on all 54,588 breaks once breaks inside clusters are
dropped, as Gecko drops them. Offline replays can't cover these runs: Bun has no `v8BreakIterator`, and its words differ
from Firefox's on some Thai.

The scans read the whole text, since merging punctuation, URLs or numbers into units first erased context later passes
couldn't recover; the Gecko scan dropped merges Firefox contradicts, such as keeping `|` with the letter after it in
`a/|b` (Dead Ends, Rules Per Input Shape). It doesn't split text runs where the script changes, as Firefox does: that
differs from the oracle in 18 more of 11,875 fuzz requests, and a port of Firefox's script itemizer cost milliseconds of
set-up (Decisions Log, 2026-09-24).

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
(Grapheme Clusters From Engine Data) read past such characters. The rules that follow from Firefox's, each with its
Gecko source, are in the comments of `src/analysis.ts`; what they still get wrong is in ENGINE_FOLLOWUPS.md, White space
and controls, and what they cost under Keeping Work Bounded, Work Done Only Where A Rule Applies.

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
(`src/graphemes.ts` and `src/analysis.ts` have the rule and where a bidi level run overrides it).

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
between Japanese characters stays a space. It drops bidi controls from its text run as it drops soft hyphens, which the
Gecko profile's analysis follows since #368 (Break Opportunities From Engine Data). It trims a line's leading white
space only from where the line starts in a text frame, so a soft hyphen that starts a paragraph keeps the white space
after it on the line, and trims U+1680 at line edges (both in ENGINE_FOLLOWUPS.md, White space and controls), and it
breaks between a ZWSP and a following combining mark.

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
of its own, and misses at 818 of 28,774 where one side holds none, all in Amiri (rebuild harness).

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

Rich inline (`prepareRichInline()` and its line functions, `src/rich-inline.ts`) is one paragraph's text broken across
its items: it measures each item alone and breaks by the paragraph's joined text, which it analyzes once and lays out
with the text walkers (One Paragraph, Cut At Its Items). Measuring alone is a premise whose gap is out of scope for now,
since rich inline with kerning
between sibling spans is left for later (Part 1, The Per-Engine Rebuild And What Counts As Done): Chrome and Firefox
kern across same-font spans, so Arial `community` + `,` fits about 1px earlier than its two widths, and Safari doesn't
(2026-09-12). Where Pretext's plain-text walkers, given the joined text as one string, and the browser's lines for the
same text in one text node disagree, rich inline follows the plain-text walkers. It takes the premise that a browser
lays spans out as it lays out their text in one text node; where browsers don't, mostly at soft hyphens, bidi controls
and separators beside white space at a span's edge, is in ENGINE_FOLLOWUPS.md, Rich-inline item edges.

#### One Paragraph, Cut At Its Items

Since #TBD (2026-10-01) `prepareRichInline()` joins the items' texts, an atomic item or a box as one U+FFFC, analyzes
that text once with a segment starting wherever an item does, measures each item's segments in its font, and hands the
text walkers one handle. It replaced each item's own analysis patched toward the joined text and an item stepper
(Continuing The Line has what those cost and the facts they were built on). What spans have of their own sits on that
handle: an atomic item or a box is an object segment with a break on both sides, an atomic item of only white space
too, as an inline-block is a box whatever its text, while an item whose text is empty, atomic or not, stays dropped
(Objects Inside A Line); an item's `extraWidth` is in the width of its first
segment, and a line that starts later in the item pays it there; a padded item that opens with preserved white space, a
hard break or a zero-width space has a start edge of its own, fitted by the edges the engine fits (`paddedOpeningFit`,
`hardBreakItemRetreat`) and painted whole by a line that takes it, and where the engine fits none, the edge takes no
room in the white space around it, which hangs, so the walker keeps such edges' width apart from the width it fits the
run at; each item keeps its font's hyphen and tab stops; and where text items differ in letter spacing, each segment's
width holds its own. A paragraph of one text item is that text's own handle, and a paragraph that fits its line whole
takes it without a walk, a premise with a gap under negative advances (ENGINE_FOLLOWUPS.md, Negative letter spacing and
hanging spaces). A line's fragments are its segments cut where the item changes, and their widths add up to the line's.
Fragment cursors index the item's part of the paragraph's segments; before, they indexed
`prepareWithSegments(item.text)`, which a caller could read only by preparing every item a second time, so a
materialized fragment now carries `sourceStart` and `sourceEnd`, its place in its item's text. A segment's text isn't
always one stretch of its item's: Firefox removes a line feed between two ideographs, and white space after a bidi
control that follows white space, so such a segment keeps where each of its units is, or a fragment that starts or ends
inside it names the wrong stretch (13 of 32 probe cases of a line feed between ideographs failed so in Firefox before
the rich set's `keep-all/line-feed-between-ideographs` cases held one).

Against main at 8e88756b in Chrome 154.0.8037.57, Firefox 156.0.1 and webkit-host (macOS 27.0, 26A428, 2026-10-01): no
real-usage draw moves in any browser, and `bun harness equal main --offline` moves no text input in any profile (21,251
inputs), with measureText calls within 0.04% of main's. Of the rich set's cases that main's build passes, Chrome fails
19, Firefox 26 and webkit-host 25, and of those it fails they pass 22, 15 and 11; 15, 17 and 20 of the losses are under
24px, and of the 4, 9 and 5 wider ones, 4, 3 and 4 have main's lines and differ only in which line holds an invisible
character (the shapes are in ENGINE_FOLLOWUPS.md, Rich-inline item edges, and on the accepted lists). The rest are
Firefox's 6 of bidi levels that end its white-space run and one webkit-host case of spaces in spans of their own before
a padded span. On probes recorded fresh in the three browsers and not kept, 4,807 cases of realistic paragraphs, span
edges, padded pre-wrap openings, soft hyphens and chips of only white space or of no text at 24-587px, Chrome passes
4,458 where main's build passes 4,348, Firefox 4,566 against 4,379 and webkit-host 4,590 against 4,353; Chrome loses 1
case main passes, Firefox none and webkit-host 63, all padded pre-wrap spans that open with white space or a line feed
after preserved spaces, and the 1,690 realistic ones move in no browser. On a second set, 12,718 cases, the 8,007
realistic paragraphs at 120-600px move in no browser either; of its 1,436 cases of soft hyphens in and beside spans
webkit-host passes 1,435 against 1,052, and of all its soft-hyphen and edge cases Chrome fails 68 that main's build
passes and passes 83 that it fails, Firefox none and 71, and webkit-host 27 and 420, the losses padded pre-wrap spans
but one soft-hyphen case each in Chrome and webkit-host (ENGINE_FOLLOWUPS.md, Rich-inline item edges, has the shapes).
Same-font items without chips, padding or boxes take the text walkers' line count in all but 52 of
6,012 offline layouts in the Blink profile (Skia's Canvas; main 195), the rest words measured in two parts and the
paragraph's return from an unfit hyphen. `src/`'s runtime code went from 5,104 lines to 4,794 (`src/rich-inline.ts`
1,027 to 653, `src/line-break.ts` 758 to 740, `src/analysis.ts` 296 to 386), and the engine profile from 23 fields to
20: `spaceBeforeSoftHyphenHangs` went with the rule it switched, and what `breaksFromItemText` and
`collapsesSpaceAcrossSoftHyphens` switched now reads `lineBreakScan`, whose doc says so.

Not carried over, each a rule that read the items: the collapsed space before an item of only soft hyphens that hung per
engine (Items Of Soft Hyphens And White Space), the bidi levels that end Firefox's white-space run (Firefox's White-Space
Run Across Items), and a ZWSP or separator item that took a line of its own after a character that overflows (under
24px). Two costs are open (TODO.md): an item that starts inside a word cuts a segment with no break before it, which
sends the whole paragraph to the full walker, where the stepper walked only the items that needed it (95 of the
real-usage sample's 233 rich draws take the full walker); and every item is measured in a pass of its own, with the
same Canvas calls, so a paragraph of an item per word takes more work to prepare from text seen before than main's.
Keeping a word two unpadded items share as one segment, and measuring items in one font as one run, would take both
back, and would reopen this if the bench's rich rows read slower than main's. No timing is recorded here: the bench
hasn't run on this design, and it has no row for a one-item paragraph laid out after multi-item ones in the same
process, where the text walkers see two kinds of handle (#TBD's description has the offline readings to check).

The rich-inline counts below from 2026-09-26 to 28 are of *probes*: cases generated for one change, each beside the
same text in one text node, recorded in Chrome, Firefox and webkit-host and not checked in, and counted against the
build before the change. The PRs named, and their commits' messages, have the full counts and attributions.

#### Joined Text

Chrome's and Firefox's items break by the joined text, a font change ending only Gecko's shaped run (Firefox 155 wrapped
same-font spans as one text node, 2026-09-14); WebKit's and the WebKit profile's break by each box's own text, with the
previous box's last two characters as context (`getWebKitParagraphBreaks()` in `src/analysis.ts`; `TextUtil.cpp:374-396`). Splitting a word changes
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

Before #TBD each item was prepared on its own and an item stepper laid the items out (One Paragraph, Cut At Its Items);
this section keeps what that design measured. From #369 (2026-09-27) an item's walk continued the line instead of
starting one, as a browser lays out one paragraph's text across its spans. Before, each item was walked as if it began a
line and then walked again to an earlier end in
four cases (a split word, a joined break after the walk's end, an overflowing hyphen, a continuing run that didn't fit),
which got some cases right only by luck. From #369 the full walker took what the line held before the item (whether it has
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

What that design cost in structure (#370, 2026-09-28): rich inline analysed each item on its own, then patched it toward
the text the items join (`recordJoinedBreaks()`, `markUnbroken()`, `getWalkedHandle()`, the joined windows and the
passes after the item loop in `src/rich-inline.ts`, `ItemLine` and the walker's item mode in `src/line-break.ts`, and a
second handle per item with its caches kept twice, about 330 lines with comments), because fragment cursors index
`prepareWithSegments(item.text)`. Written from scratch it would be one analysis of the paragraph cut at item boundaries,
as the rebuild indexes a paragraph's content (`rebuild/src/content.ts` on branch `rebuild-20260916`), which needs a new
cursor contract and letter spacing and `extraWidth` per segment in the walker. #TBD built it (One Paragraph, Cut At Its
Items).

#### Items Of Soft Hyphens And White Space

An item holding only soft hyphens and collapsible white space is no line content, since a line start consumes it, but
since #369 it takes part in the paragraph's runs and breaks as its text does in one text node. Until #TBD the item
stepper hung the collapsed space before such an item per engine (the profile's `spaceBeforeSoftHyphenHangs`, removed
with it); the paragraph's lines are now the text walkers' there, and the harness's `rich/continued` families pin the
browsers' behaviour; these results shaped the stepper's rules. After content the item keeps the
collapsed space before it: ending the line before the item lost 288 Firefox cases of a 43,462-case probe, as Firefox
keeps the space and the soft hyphen on the line. Where a line
ends after it, the browsers break at that space and move the soft hyphen on, so the space hangs, but each engine keeps
the soft hyphen on the line in other places, so the profiles name three behaviours: hanging the space also where Chrome
and Safari end the line at the soft hyphen with its hyphen lost 118 Chrome and 120 webkit-host line widths of a
32,830-case probe, and Safari's rule, keeping it before white space after the soft hyphen, fixed 335 webkit-host
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

In the Gecko profile a soft hyphen after collapsible white space is a zero-width break, which Firefox drops, so until
#TBD a rich line start consumed it wherever it reached it and told it from a ZWSP that holds the line
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
Since #TBD the Gecko profile's analysis of a paragraph collapses that run in the joined text, through soft hyphens too,
and ends it at a dropped character that starts an item (`collapseWhiteSpaceRun()` in `src/analysis.ts`); it reads no
bidi levels, so a dropped character at another level doesn't end the run (ENGINE_FOLLOWUPS.md). From #369 the item
stepper followed the run across items, with levels from the Gecko scan's port of Firefox's, made only for text with
right-to-left characters and only once a run would go on past such characters (#371; Keeping Work Bounded, Work Done
Only Where A Rule Applies). White space and soft hyphens after
an item's leading white space are part of that run, so the Gecko profile walks an item of soft hyphens and white space
only where it starts with a soft hyphen, whose white space starts a run of its own: walking every such item there, as
Chrome and Safari do, lost 421 Firefox cases of a 28,435-case probe and fixed 30. The run
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

#### Objects Inside A Line

A box (`RichInlineBox`, `{ width }`, #387, 2026-09-30) is an object the app sizes and paints inside a line: an image, a
custom emoji, a formula, a badge. It is a type of its own, not a text item with empty text: `prepareRichInline()` drops
an empty item entirely, with no fragment and no width, which apps rely on to hide runs (canvas-word does) and the
invariants check, and the empty-text spelling floated in #201 needs a `font` and a `break` that mean nothing and an
`extraWidth` that may become padding (TODO.md). Inside, a box is an atomic item with no text and all its width
`extraWidth`, which no line hangs: U+FFFC in the paragraph's text, as Blink and Gecko take an atomic inline there
(`src/rich-inline.ts` cites them), with a break on both sides and preserved white space after it kept on its line as
after a chip, so it needs no rule of its own. Apps stood in for one with an atomic NBSP whose `extraWidth` made up the
rest of the object's width (#201), which lays out as the box does in every engine's profile (`src/layout.test.ts`; a
stand-in Canvas fuzz of 220,000 layouts found no difference, 2026-09-30). A box of width 0 is a box, with a break on
both sides, as an empty inline-block of width 0 is; Firefox places one wherever it falls, even on a line that already
overflows (`CanPlaceFrame`, `nsLineLayout.cpp:1264-1269`), as the Gecko profile does for any atomic item of width 0
(`paddedOpeningFit`, whose `'both'` ports that function), where Chrome and Safari move it to the next line. A negative width is refused, as one that isn't finite is. An
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
  cursor and fragment indices. Both analyses stay, each item's own and the joined text's: their segments differ in 457
  of 3,000 random rich-inline flows, and the joined pass is about 1% of preparation (2026-09-16).
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
lines as the width grows from 43-60 to 7-14 per profile (#327, 2026-09-15; ENGINE_FOLLOWUPS.md). Since #TBD the text
walkers decide whether the text before the hyphen fits and which earlier break a return takes
(`returnsFromUnfitHyphen()` in `src/line-break.ts`). A run that continues across items moves to the next line whole in
every profile where its first break is a soft hyphen whose hyphen doesn't fit: Safari 27 moves it too (`the `, `inter`,
`na\u00ADtion\u00ADal` at 84px in 16px Arial, #323's cases). WebKit lays a paragraph with inline boxes out with its
line builder, whose line reverts from a soft hyphen whose hyphen doesn't fit to the last wrap opportunity where the
hyphen fits or none is needed (`rebuildLineForTrailingSoftHyphen`, `InlineLineBuilder.cpp:1862-1887`), wherever the soft
hyphen sits in its span or text node, so in the WebKit profile a paragraph of several items returns from every unfit
hyphen, where a text keeps it (`unfitHyphenRetreat`): of 360 probe cases of soft hyphens in and beside spans at
40-243px, webkit-host passes 360 and main's build 236 (2026-10-01; #TBD). Fit with the width you report, or text laid
out at its widest line wraps differently (#308, 2026-09-15).

#### Box Edges And Pre-wrap

Shaping stops at a span edge with padding, border or margin; otherwise Blink shapes items together when font, locale and
spacing match, Gecko when font and language do, and WebKit never, except complex right-to-left text across undecorated
edges, one run in Safari 27 whose share Canvas gives only at its ends (`TextShapingAcrossInlineBoxes`,
`InlineLineBuilder.cpp:780-1028`). The architecture doesn't block rich `pre-wrap`: run on rich `pre-wrap` text, the
per-engine rebuild (`rebuild/` on branch `rebuild-20260916`, a from-scratch port of each engine's line breaking, kept as
the plain-text correctness reference; "the rebuild" below) got 99.3-100% of 1,334 cases' line counts right per browser
(2026-09-18; `rebuild/research/PREWRAP-RICH.md` on that branch).

Rich inline takes `pre-wrap` (#173), on its premise that spans lay out as their text in one text node (Joined Text): the
paragraph's analysis takes it. A run of preserved spaces that ends a line hangs across items, as the text walkers hang
one: its spaces fit where the content before the run fits, and the line hangs the run where it ends, all of it where the line wraps and before a hard break or at the paragraph's end only what doesn't fit, as Blink
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
white-space item (`:406-418`), where in Blink and Gecko no line ends inside a run of preserved spaces and tabs that goes
on from one item to the next (UAX #14 LB7): Chrome and Firefox lay out `Some words`, a bold `  `, an italic ` `, an
8px-padded ` x y` and ` tail` in 16px Arial at 103px as `Some `, then `words` through `y` (2026-10-01). A carriage return that ends one item and a
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
pixels (12.5px at 12px and DPR 2, 2026-09-15). The rebuild's DOM-free formulas, W being Canvas's width at a size:
Chrome's DOM width is `Math.ceil(64 × W(size × DPR)) / (64 × DPR)` at DPR 2 and `W(size)` at DPR 1, Firefox's
`W(size × DPR) / DPR`, Safari's `W(size)` (September 2026). They'd retire the DOM exception and work in workers, but
make prepared widths depend on the DPR at prepare time, which the API discussion planned before a release decides
(TODO.md, End of project).

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

Pretext takes no paragraph direction. Only the Gecko scan resolves levels, to split text runs where Firefox does, with a
port of servo/unicode-bidi whose levels are used only inside the scan, never returned to callers, and which takes every
paragraph as left-to-right (`src/gecko-bidi-levels.ts`; ENGINE_FOLLOWUPS.md).

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
405,000 fuzz strings; macOS 27's libicucore gives U+F7F0-U+F8FF Apple's own classes (September 2026). Nothing checked in
would catch a subtle bracket-pair (N0) error in main's Gecko port.

Levels changed none of 183,000 segments, direction changes falling where segments end anyway, yet took 38-46% of the
Gecko profile's right-to-left analysis before #365. They matter where a level run starts inside a cluster: Firefox
156.0.1 breaks `aa בבבב🏻` at 60px in 16px Arial before the skin-tone modifier, where the profile without levels breaks
after `aa`, and 22 pinned cases need them, all Balinese and Batak vowel killers after Arabic or Hebrew. Since #365
(2026-09-27) levels resolve only there (`levelsMayMatter()` holds the argument): in 262 of the harness's 10,733 texts
holding a code unit Firefox's `HasRTLChars` flags, no corpus or chat text among them, at about 150-200ns a unit in
Firefox 156. Over 63 million strings (#365 lists the kinds) the guarded scan equaled resolving everywhere, and the unit
tests fail without each rule the argument uses. This is the method to use for any port claimed exact: a written
argument, a fuzz against the unguarded path, and a unit test per rule.

Rejected: resolving wherever a cluster holds several code points, exact with a shorter argument, but vowel marks and
emoji make that 37% of Arabic paragraphs and 57% of the chat's right-to-left texts, saving 5-15%; and setting the whole
text run up again where levels split it, 8-17% slower than main where levels resolve, against within 5% for setting up
only the words the splits cut. The two setups share one word-end test (`endsWord()`), whose call makes Firefox 156
prepare long breakable runs, pre-wrap chunks, keep-all CJK brackets and Latin messages it has measured before (the
bench's `seen` row) 2-5% slower than main; written out twice they read within noise, and the copy isn't kept (Decisions
Log, 2026-09-26).

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
slower until each run was scanned once, at its start (#368); and, in a rich paragraph of many items, scanning the run of
white space after an object again for each of its segments (1.8 s for 32,000 one-space items after a chip wider than the
line, offline), and a call per item start in Gecko's run of white space, which overflowed the stack at 4,000 items
(#TBD).

The regex traps needed internal white space before content, or digit runs without `px`; the hyphen one, a long
hyphenated run over many lines. A continuation from anywhere must seek its starting boundary; a positioned scan can
carry its index. Before #351 (2026-09-26) an unbroken word of soft-hyphen and accent pairs took 64ms at 1× and 3,957ms
at 8×, and the first fix, argued from runs of 1-2 accents, cut the context short past about 95 and moved Safari's widths
up to 7px: test long runs. A `prepare()` that takes seconds, such as one 160,000-character word, can get the Chrome tab
killed as hung (Chrome 153, September 2026).

#### Canvas Work

Count the text submitted to Canvas, not calls: measuring every prefix or suffix is quadratic even at one ask per
position. So prefix fits stop at 96 graphemes and take pairs beyond, which bounds the amplification, not the shaper's
own cost, and a context query charges its overlapping source too. Main at the time spent 46ms analyzing and 70ms
measuring of Chrome 153's 115ms on the corpora (`corpora/`), but 46ms and 305ms of Safari 26.5.2's 350ms (2026-09-15):
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
  test saves, read no faster.
- **Graphemes past dropped characters**: the Gecko profile's grapheme table tests only code points in the rules'
  Control category for what the text run drops; testing every code point made Firefox prepare CJK and Arabic 2-3%
  slower (#368).
- **Fresh-line geometry**, the widths a line that starts inside a segment holding an invisible character takes in
  desktop Chrome and Firefox (`src/entry-geometry.ts`), is observed only for segments of up to 96 graphemes, and an
  empty observation is kept as a found one is: since #368 a segment ending in a long run of controls is a few clusters,
  not one per control, so it falls within that bound, and observing again at every prepare made Firefox prepare the
  invisible tails 6% slower.
- **The paragraph's bidi levels for rich items** (#371; Rich Inline Boundaries, Firefox's White-Space Run Across Items)
  are made only the first time an item's white-space run goes on past a character Firefox drops, which none of the
  bench's messages do. Made for every Gecko paragraph they made `prepareRichInline()` of Latin and Arabic messages 8%
  and 25% slower than main, and made only where an item holds a soft hyphen or bidi control 5% and 3%, where on first
  need they read within 2% (Bun's JavaScriptCore on the stand-in Canvas, warm caches, medians of 5 or 6 processes;
  hypotheses until a browser shows them).

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

After content, the rich stepper, which #TBD replaced with the text walkers over one paragraph, didn't walk an item whose
first segment doesn't fit: the full walker there only ended the line before the item, as the stepper then did itself,
repeating the walker's fit for that segment. That left 6 of the 439 walks in a stats pass over the bench's rich
texts: Chrome 154's rich stats read 18% faster and Firefox 156's 23%, their rich walks and streams 11-13% (2026-09-29).
Testing for a line that starts at an item's end, as after a hard break, only on the line's first item, the one item that
can, instead of on every item it visits, made Chrome's rich stats 9% faster again, within noise in Firefox: that test's
reads were what #364's removed check had skipped. Chrome's rich stats now read 18% faster than main before #340, where
main at #372 read 7% slower. Against main, Safari 27's rich stats read 14% faster, and Chrome's mixed stats, whose code
didn't change (the minified `layout.ts` bundle is the same), 2% slower in two of four runs, accepted as V8's placement
of the changed bundle (#375).

A paragraph of one rich item took the text walkers (#383) where the rich stepper would lay it out as they lay out its
handle: no `extraWidth`, not atomic, no hard break, and nothing a line start consumes at its start; since #TBD every
paragraph of one text item is that text's handle. Its line functions take the paragraph's whole fit, which the text
walkers lack
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
- **A 25th field on the engine profile**: one more boolean on `getEngineProfile()`'s object, at any position and
  read by nothing, made Chrome 154's plain line APIs 11-18% slower (mixed stats, walk and stream) and two worst-case
  `layout()` rows 3-7%, with identical work, in two bench sessions of each of three builds; Node 23's V8 keeps the
  object's properties fast either way (2026-09-30). So the Gecko profile's rule for an atomic item of width 0 reads
  `paddedOpeningFit`, whose `'both'` already ports the function it comes from (`CanPlaceFrame`), and a new profile
  field is benched before it lands.
- **Class fields in Firefox**: any class field seems to make Firefox 156 compile the whole bundle up front, 4.5-4.8ms on
  a fresh page against 1.9-2.2ms with plain objects, or with the fields emptied or set in constructors; V8 and
  JavaScriptCore didn't care (#340, 2026-09-23).
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
- **Letter spacing and tabs.** Blink spaces cursive-script runs only at spaces (`shape_result.cc:977-990`), spaces a
  glyph cluster once, and turns off liga, clig and calt under any spacing (`font_features.cc:54-86`). A tab stop is
  eight Canvas spaces plus letter and word spacing (`font.cc:303-317`), rounded up to 1/128 px at DPR 2
  (`simple_font_data.cc:225-240`), and a tab skips a stop under half a space away (`font.cc:333-337`). Recordings agree:
  a tab-only line in 16px Arial is 27.563px at −1px letter spacing and 35.563px at 0 (harness recordings at commit
  b1fd05fc, Chrome 154). The profile models neither the cursive rule nor the spacing and skip in stops, and a unit test
  pins its stops of spaces alone ("letterSpacing participates in pre-wrap tab positioning", `src/layout.test.ts`), so a
  port changes that test (ENGINE_FOLLOWUPS.md). (Chrome 153 source, 2026-09-16 and 09-27.)
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
- **Soft hyphens.** A candidate ending in one is tested with the hyphen and its 1/64 px allowance
  (`InlineLineBuilder.cpp:1154-1161`), and it's discretionary only at a WebKit item's end. With no break that fits,
  Safari overflows with the hyphen where Chrome and Firefox break inside the word (`abc­def­ghi` at 26px; Safari
  26.5.2); inside spans it charges the hyphen, then backs off to an earlier break, which the profile doesn't model.
  (webkit-host, 2026-09-26.)
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
- **Letter spacing.** A run's last character is always spaced, others only if not a tab or formatting character and a
  cluster starts after them (`CanAddSpacingAfter`, `nsTextFrame.cpp:3860-3873`): a lone pre-wrap tab at 1px is 43.6 px
  natively, 44.6 px painted alone. A tab before a change of direction also ends a left-to-right run and gets a gap
  (`a\tبِبِ((tail`), unseen by the Gecko profile where it resolves no levels (Bidi Levels). After a removed soft hyphen,
  a mark is spaced as its own base. From Firefox 153, `letterSpacing = '0.001px'` turns ligatures off as the DOM's
  non-zero spacing does and adds nothing, so a port can add spacing in JavaScript; 140 ESR adds 0.00104 px a character
  and has no `ctx.lang`, and ESR is dropped where it costs complexity (Part 1, Limits). (Firefox 156, 2026-09-17 to
  09-27.)
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
  span's `tab-size` with the block's font. The next stop is at least half the first font's `0` away (`AdvanceToNextTab`,
  :4298-4304; `GetMinTabAdvanceAppUnits`, :1931-1937). A tab's position counts advances only at cluster starts, plus
  each character's spacing (`CalcTabWidths`, :4306-4378). Recordings agree (harness recordings at commit b1fd05fc,
  Firefox 156.0.1): a tab-only line is 8 × (space + letter spacing) unless the tab is the text's last character, as in
  16px Arial at −1, 0 and 1px: 27.6, 35.6 and 43.6px. The profile follows none of this (ENGINE_FOLLOWUPS.md). (Firefox
  156.0 source, 2026-09-16 and 09-27.)

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
  (#274, #276, #290, #291, #293). The scans take 341 lines, at 86 → 88 Chrome Canvas calls per real paragraph; "Fixing a
  mismatch" (AGENTS.md) forbids the pattern, so nothing reopens it.
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
  split stays (Bidi Levels; Decisions Log). Reopens if real text with such marks turns up.

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
  model traced from the engines' line builders.
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
  lists), Firefox's (4e6d4dd5) 15 per direction. They reopen with contextual widths during preparation.
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
  turn features on for every measurement (Engine Facts, Chrome). Reopens with a whole-string mode.
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
  prefix-measurement mode; Canvas's letter-spaced widths everywhere (breaks ligatures); Safari's inferred carried
  adjustment on every prefix; Firefox's 1/60 px box rounding in line fits (regressed unrelated cases).
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
  `ff-table-format-ranges-first`): 8.7 KB of state machines for Firefox's 0.8 KB, or Chrome's code-point lookup, exact
  and 3.2 KB off 55 KB gzipped but tying Firefox to Chrome's table and slowing its Arabic, Hebrew, Hindi and Urdu
  analysis 13% (Decisions Log). Reopens only if table size and per-engine bundles both return.
- **One bundle per engine** (372-788 KB minified, measured on the rebuild), ruled out on 2026-09-26 (Decisions Log).
  Reopens if apps ship per-browser builds.
- **Tables shrunk by computation**: remapping onto base classes fails for Chrome's Chinese table (`〜` and `゠` need a
  class the base lacks), and runtime state machines mean porting ICU's rule compiler, where today's tables need no
  upkeep between refreshes. Reopens with the table-size question.
- **Dictionaries or ICU4X's LSTM model** for Thai, Lao, Khmer and Burmese (2026-09-25): hundreds of KB each, and slower
  in JavaScript than in Firefox. Reopens for runtimes without `Intl.Segmenter`.
- **`Intl.v8BreakIterator` for Chrome's breaks** (the emulation study, 2026-09-16 to 09-20) drops `-u-lb-*` keywords,
  lacks Blink's fast table, space rule and CSS handling, is gone from Node and Deno, and saves nothing while Safari
  needs the tables. Reopens if `Intl.Segmenter` gains a standard line granularity (Stage 1 since 2021).
- **Safari's libicucore tables shipped whole** (26c3e231, 2026-09-16): 75 fewer runtime lines for about 30 KB more
  gzipped; overtaken by packing each table against an earlier one.
- **One bidi resolver with per-engine switches** (in the rebuild): ICU isn't structured like UAX #9 (brackets pair while
  explicit levels are computed; weak and neutral rules resume after isolates), so nine or more switches, redone at every
  ICU roll (Bidi Levels). Reopens only if Blink and WebKit stop running ICU's resolver.
- **A hand-written `.d.ts` for the README's API glossary** (2026-03-17): nothing checks it against the implementation
  but a bridge that drifts the same way, so the README keeps its glossary instead; reverted (Part 1, Docs).

#### Caching, State And API Designs

Studied 2026-09-13 to 09-26, mostly in Bun on a stand-in Canvas with the results checked in Chrome, against the cost
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
- **Other API ideas**: every in-word position measured in `prepare()` (about 2.4× Blink's cold calls; maybe an idle-time
  call); no handle (prepare is about 10× a warm break pass); reused rich items (about 3 a paragraph); a JSON guard on
  handles; a public diagnostics prepare.
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
- **One analysis for rich inline**: the joined pass is about 1% of prepare and carries the per-item cursors (Rich Inline
  Boundaries), and Safari's extra calls are prefix fits WebKit needs. The reverse, one analysis of the paragraph cut at
  item boundaries, is on the API discussion's list (Rich Inline Boundaries, Continuing The Line; TODO.md).
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
  files outside the repo passes silently, `bun test` runs only the Blink profile (Bun's user agent names no browser, so
  the profile for unrecognized engines applies), and walkers written apart drift unless a test makes them agree.
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
  handled (reported privately; Part 1, Merge Bars And Landing).

#### Checking Demos

What worked (2026-09-14 to 09-17): main and the branch under test, taken from `git archive`, in one browser session
with one probe; headed installed browsers at DPR 2 with both scrollbar kinds; painted width within about 0.5 px of the
model; width sweeps at breakpoint edges and in sub-pixel steps; stateful sequences over snapshots; a stand-in-Canvas
"screen" diffed byte for byte to prove a refactor changes nothing. To check code against a spec, make each rule a
yes-or-no question about one place in the code, answered by the smallest runtime observation (a per-frame read and
write log matching `^R*W*S?R?$`). Viewport emulation can hide a one-frame lag; resize a real window or iframe.

## Part 3: Decisions Log

Decisions the maintainer made or accepted whose reasons the code doesn't show, by date; code comments that cite this
log mark where one applies. Before reversing one, check whether its reason still holds and record the new decision here
with its date; an entry that replaces another says so and keeps its reason. The old test suite is `tests/wrapping`,
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
  cost it about 2,900 left-to-right and 1,150 right-to-left line counts in the old test suite, mostly at widths
  narrower than one character. A profile can't tell the two apart: only Safari's own user agent names a version, not
  the other WebKit browsers on iPhone and iPad.
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
  cases for 8.6 KB gzipped and 16 lines (Chrome 153). It was never decided on its own: the acceptance of the tables'
  bundle that day covers it.
- **2026-09-23: a new harness replaces the old test suite, and what must not regress is decided afresh**, since main's
  tests were old: the engine tables (#340), the harness (#341), then the suite's removal (#348) (harness/README.md, "Why
  the old suite went").
- **2026-09-24: no must-pass tier.** Every repeatable case is pinned alike, so a hard trade-off in the heuristics is
  marked case by case on the accepted list, not forbidden by a tier.
- **2026-09-24: the Gecko scan doesn't split text runs where the script changes**, as Firefox's script itemizer does.
  Dropping the splits was first rejected on 2026-09-16, to match Firefox, then approved under the relaxed stance of
  2026-09-23: only mixed-script fuzz strings with a stray mark moved, no text from the old test suite or the corpora
  (Dead Ends, Rules Per Input Shape).
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
- **2026-09-25: a prepared handle needn't survive a JSON round trip.** Its per-segment flags are a `Uint8Array`, which
  `JSON.stringify()` turns into an object without a `length`, so the line walkers never finish on a JSON copy;
  `structuredClone()` and `postMessage()` copies work, and README calls the handle opaque. Cursors and ranges are plain
  JSON and resume the same from a copy.
- **2026-09-25: the old test suite, its snapshots, its diagnostic tools and the benchmark page are gone**; accuracy and
  speed claims rest where AGENTS.md says. The benchmark page went once the noise floors of `bun harness bench` caught a
  known change (harness/README.md, Bench), and what the harness took from the old suite stays frozen, since its
  generator went too.
- **2026-09-25: the npm package doesn't ship the demos (#342)**; README sends agents to the repo's. Shipping them
  runnable took the tarball from 238 kB to 620 kB, needed a Bun-only server script and shipped again content whose
  licenses aren't recorded; that version is parked as closed PR #343, in case this changes.
- **2026-09-26: `setLocale()` sets the language again** (#356), the one preparation reads in place of `<html lang>` for
  its break rules and measurement context, and still clears the caches: only so can a worker, which has no
  `<html lang>`, get the page's language. An empty locale is a page's without a language, and a call with none reads
  `<html lang>` again. Contexts with a `lang`, in Chrome and Firefox, take it too; `bun harness equal` moved no case.
  This replaces the 2026-09-24 decision to have it only clear the caches, taken because no locale changes the Thai,
  Lao, Khmer and Myanmar word boundaries Pretext reads (20 locales, V8 and JavaScriptCore). An element's own `lang`
  waits for the end of the project (TODO.md, End of project).
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
  leading-space skip, a loop that never runs, kept on 2026-09-24 for Firefox, cost Firefox 156 3 to 7% on resizing Latin
  chat messages to new widths (#364). Counted on 2026-09-29, only one of the checks removed skipped work that mattered,
  the rich stepper's line-start test, whose saving #375 took back plainly; the rest was placement or too small to read
  (Keeping Work Bounded). A check that changes no result can still skip work, so count the work it skips before calling
  a slowdown one JIT's. Nor is a rule written out twice for one JIT: the Gecko scan's two text-run setups share one
  word-end test, whose call makes Firefox 156 prepare four kinds of row 2 to 5% slower than two copies would (#365; Bidi
  Levels has the rows). That was judged a good trade on 2026-09-27.
- **2026-09-26: one bundle serves every engine.** An app can't import a bundle made for one browser, since its users run
  them all, and fetching one engine's tables at runtime would make the first `prepare()` asynchronous, so every browser
  downloads every engine's tables.
- **2026-09-26: the break tables stay as they are**, closing the check the 2026-09-23 entry left for the end. The one
  alternative left to weigh, Firefox's line data stored in Chrome's format, was worth taking only without a maintenance
  burden, and it wasn't worth it (Dead Ends, Tables, Bundles And Data). It reopens only if table size and per-engine
  bundles both return.
- **2026-09-27: the Gecko profile keeps its 80px floor for prefix fits, as a premise.** A prefix fit finds where an
  emergency break falls inside a segment by measuring the segment's grapheme prefixes, and the Gecko profile makes one
  only in segments at least 80px wide. Prefixes model Firefox's whole-word advances better than standalone graphemes,
  and the floor has no browser reason, but a lower floor fixed adversarial cases at 24-80px while making Firefox prepare
  new Latin, Arabic and mixed text much slower, and lost the one case of the harness's real-usage sample that it moved.
  Words narrower than 80px keep summing standalone graphemes where lines narrower than 80px split them (Break
  Opportunities From Engine Data has the numbers).
- **2026-09-27: Firefox's bidi controls are laid out by the Gecko profile's analysis, not by its walkers** (#368). A run
  of soft hyphens and bidi controls holding a control joins the segment before it, and the profile's graphemes and
  white-space collapse read past such characters (Break Opportunities From Engine Data), so neither the walkers nor
  `layout()`'s count know of them. Making the run zero-width glue that the walkers look past fixed 39 of the 43 harness
  cases the analysis fixes, in 23 fewer lines, but slowed Firefox's `layout()` of invisible tails 12-13% and some of
  Chrome's and Firefox's worst-case rows 5-11% (Dead Ends, Invisible Characters, Controls And Soft Hyphens). The
  analysis also fixes the other four, `a`, LRI, U+0301, PDI, `b` at 1px, whose mark Firefox keeps with the `a`, and makes
  the white space on both sides of a control take the room of one space, about 22 of its 68 runtime lines.
- **2026-09-30: an object inside a line is a box, `{ width }`, a type of its own** (#387). Apps stood in for one with an
  atomic NBSP whose `extraWidth` made up the rest of its width (#201), where an empty text item stays what it is, dropped
  with no fragment. A box's width is final, fixed when it's prepared and at least 0, and heights stay the app's, with the
  README's `vertical-align: top` rule (Rich Inline Boundaries, Objects Inside A Line, has the evidence and what reopens
  negative widths and widths given at layout).
