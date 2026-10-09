## Pretext

Changelog updates guideline: don't add dev-facing notes, only user-facing ones. Refer to closed PR numbers.

### Where things are

- `README.md`: the public API and user-facing limitations, with no per-browser accuracy or speed figures.
- `RESEARCH.md`: the terms the docs share, then intent (Part 1), evidence and dead ends (Part 2) and the Decisions Log
  (Part 3). Read the log before reversing a documented decision; code comments that cite it mark where each one applies.
  A PR's full story goes in its description; `RESEARCH.md` gets the durable fact: the claim, its number, build and date,
  its source, and what would reopen it.
- `harness/README.md`: how cases pass and grow. Accuracy claims rest on its recordings and accepted lists; bench tables
  and finished comparisons go in PR descriptions, and `RESEARCH.md` keeps the number a decision rests on.
- `ENGINE_FOLLOWUPS.md`: open gaps. `PLATFORM_BUGS.md`: browser and OS bugs, read before changing an engine-profile
  workaround or a line-fit tolerance. `TODO.md`: priorities. `DEVELOPMENT.md`: the demo server, engine data, releases.
  `pages/demos/markdown-chat.md`: the chat demo's patterns for app developers, updated with the chat.
- engineering.md and ui.md, the maintainer's general rules for code and UI (`docs/` in the chenguini repository, not yet
  public), hold here; a pointer such as (engineering.md, Caching) names a section there.
- Keep a doc current in the change that makes it stale.

A text goes through analysis (`src/analysis.ts`: white space, break opportunities from ports of each engine's scan in
`src/line-breaks.ts` and `src/gecko-line-breaks.ts`, segments), measurement (`src/prepare.ts` over `src/measurement.ts`:
Canvas widths cached per font and segment, and the corrections at line edges) and line walking (`src/line-break.ts`, for
`src/layout.ts` and `src/rich-inline.ts`). Engine differences live in the engine profile (`getEngineProfile()`,
`src/measurement.ts`) and its tables in `src/generated/`.

### Intent

The reasons are in `RESEARCH.md` Part 1, under the same headings. A fix inside these limits lands on the agent's
judgement; one outside them needs the maintainer first.

- **What Pretext Is For.** Layout in app code without DOM measurement, above all virtualized lists that prepare many
  texts, so preparing new text matters as much as `layout()`. Heights are exact, never estimated.
- **Limits.** `prepare()` and `layout()` read no DOM or style beyond the emoji-correction span, the `<html lang>` read
  and, without `OffscreenCanvas`, a canvas element never attached. Widths come only from Canvas `measureText`. Every
  browser on a modeled engine gets a layout. Stricter editorial whole-word handling stays in userland.
- **The Correctness Stance.** Port each engine's rule; never go back to rules keyed on what a failing input looks like. A
  premise no real font breaks may be taken for speed, with a named gap. CJK stays well supported.
- **Tests And Losses.** A lost pass may be luck or a wrong oracle; a true loss is the maintainer's call. Cases grow by a
  behaviour's shape, never by one pinned reproduction per bug.
- **Engineering.** Complexity stays down, line count its usual proxy. The worst case is catered to but may regress
  slightly for a real gain.
- **Tables Against Canvas.** Engine and Unicode data go in tables pinned to the engine's build; font facts come from
  Canvas at runtime.
- **Merge Bars And Landing.** A change no worse on correctness, speed or simplicity that improves one merges; a trade
  goes to the maintainer with numbers; a fix that doesn't make sense waits, even when validation passes.
- **Docs.** Leave out what the code shows cheaply. Write for a reader who saw none of the sessions behind a change:
  define terms where first used, state decisions as project rules, don't quote conversations.

### Fixing a mismatch

- Start from the engine's source: find where Blink, WebKit or Gecko decides the behaviour, and port that rule or its data, citing where it lives.
- Model the structure, not the symptom: a fix reads as "the browser does X", never as "inputs shaped like Y get Z". Nothing keyed on font names or on the failing strings.
- Where Pretext can't do what the engine does cheaply, state the premise it takes instead and name its gap: what it gets wrong, and when. Pretext itself is such an approximation: Canvas widths summed per segment, with the engines' known differences corrected.
- For plain text, the per-engine rebuild (`rebuild/` on branch `rebuild-20260916`) is the correctness reference: where it gets a case right, port its rule. For rich inline, follow the engine's own inline model: one paragraph's text broken across its spans.
- Engine differences live in the engine profile and its tables, not in branches elsewhere.
- Attribute every case a change moves (fixed, right by luck, page history) before landing; a new accepted failure needs a written reason.
- Write plain predictable code. For speed, aim at what stays true across engines and versions: stable types, good allocation patterns and plain C-like code, measured and commented (engineering.md, Control Flow). Don't shape code to one JIT's moving heuristics; accept a small regression that only such a heuristic explains, and don't keep dead or redundant code because one JIT runs it faster. Note what it costs (`RESEARCH.md`, Decisions Log).

### Implementation notes

- Plain objects and functions, not classes; a line walker's state in its own locals, with integer loop bounds: a class
  field doubles Firefox 156's time to evaluate the bundle, V8 boxes a captured number, and JavaScriptCore types an
  infinite bound as a double (`RESEARCH.md`, Keeping Work Bounded).
- `layout()` is the resize hot path: no Canvas calls, no string work, no gratuitous allocations. `prepare()` stays the
  opaque fast handle, paying for nothing `layout()` doesn't read. The per-segment break kinds (`SegmentBreakKind`) aren't
  merged back into one can-break flag.
- Preparation makes a new Canvas context when its language changes, because Chrome's OffscreenCanvas picks fonts for a
  new language only when the font string changes; not on `clearCache()`, because Chrome caches shaped text per canvas
  (`PLATFORM_BUGS.md`).
- Callers are well-typed TypeScript: no runtime check of an argument's type, and nothing promised to a caller the
  types rule out (`RESEARCH.md`, Decisions Log, 2026-10-06).
- Source imports keep `.js` specifiers in `.ts` files so plain `tsc` emits working JS; extensionless ones pass
  `moduleResolution: "bundler"` and only `bun run package-smoke-test` catches them.
- Engine data is refreshed by hand, never in a build step (`DEVELOPMENT.md`). `Intl.Segmenter` only splits words in the
  Southeast Asian runs the scans send it.

### Validation

- When you come back to the project, or after a browser or OS update, run `bun harness repin chrome`, `repin firefox`
  and `repin safari` first; `--write` takes the new build, in a commit of its own (`harness/README.md`, Browsers and
  pins).
- Keep `bun test`, `bun run check` and `bun harness check` (Chrome, Firefox, webkit-host) green; run `bun harness gate`
  before landing a change to `src/` or `harness/`. Record new cases with `bun harness record --only-new`, and commit
  changed recordings and accepted or varying lists with the change that caused them.
- Before landing a change to `src/` other than `layout.test.ts`, or to `harness/bench/`, paste `bun harness bench main`'s
  table, every row, into the PR. A row slower in every session needs a sentence, as does growth over 5% in the
  `measureText` calls or submitted units `bun harness equal main` prints.
- Settle behaviour in the harness's pinned headed browsers, not headless ones; `--background` bench results are
  hypotheses. Jobs may run side by side while free plus inactive memory stays above about 30%, installed Safari one at a
  time; the bench runs alone, in the foreground, on a quiet machine.
- Use named fonts and give probe pages an explicit, non-empty `lang`, or the OS's and browser's language settings leak
  in. Re-test the macOS emoji and `system-ui` bugs headed on a Retina display: headless DPR 1 masks them.
- Traps: a right line count can hide wrong breaks (`RESEARCH.md`, Reading Browser Output); WebKit's per-process caches
  make a webkit-host result depend on earlier layouts (`harness/README.md`, Accepted and varying lists); a result
  becomes the baseline only after a check by someone other than the tool or agent that made it (`RESEARCH.md`,
  Evaluation Traps).

### Demos

Demos in `pages/demos/` follow ui.md. The model owns every value Pretext measures or a layout width depends on (fonts,
the text as painted, padding, borders, breakpoints); the painter writes them inline, and a border inside a model width is
an inset box-shadow. Demos never correct what Pretext reports. An inner scroller gets `scrollbar-gutter: stable`
(`RESEARCH.md`, Scrolling And Scrollbars). After a demo fix, check the sibling demos.
