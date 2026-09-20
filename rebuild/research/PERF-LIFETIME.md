# Profiling item 1: the measurer's lifetime (2026-09-19)

research/PROFILING-START.md's first item, built as an unmerged prototype on branch `x-perf-lifetime` by one agent
(interrupted three times by a lost network connection and finished by successors from the evidence on disk), then
attacked by a second agent who reran its numbers on a quiet machine. The attacker's review comes first, because it
corrects the report. Nothing here is merged.

## What landed: the smaller form (2026-09-20)

The orchestrator's decision below was built, reviewed and merged: `prepare(paragraph, env, inspect, contexts: Context[] = [])`
takes a plain list of Canvas contexts; there is no `Measurer` type, and the font checks ask Canvas again at every
`prepare`, on the kept contexts. Library code +15 −13 lines in five files.
- **Lifetime, invalidation, bound:** the list is the caller's (a page's, or one call's when nothing is passed). A kept
  context heals by itself after a web font loads in Chrome and Firefox; webkit-host's doesn't, so there the caller makes
  a new list after the page's fonts change. `prepare` empties a list longer than 512 contexts (a lookup costs 4 to 7 ns a
  settings record compared; the cliff is about 60 font declarations used in turn in Chrome, past which a page pays what
  it paid before the list; with 10,000 distinct declarations the list never holds more than 514).
- **Proof (tier 2, case by case against the usual run):** Chrome 0 differences in 134,130 rows in both orders in each
  configuration, 0 of 67,065 shuffled, 0 on the plain path, page-wide twin scan 0 of 67,072; webkit-host 0 of 127,974 in
  each configuration; Firefox 0 with facts and 7 cases without, all history-dependent in the frozen ledger, each equal to
  the usual recording's other order. The critic reproduced the shuffled Chrome run and both Firefox runs. A device pixel
  ratio probe (nobody had one): 0 of 135 kept-against-new pairs differ; an OffscreenCanvas context doesn't read the
  device scale factor.
- **Numbers:** the owner's bench ran on a loaded machine, so ratios: Chrome ×0.75 on the mix and ×0.855 on plain ASCII
  from scratch; preparing and keeping 10,000 messages in Chrome 45.6 s to 9.0 s under that load; kept ASCII paragraphs
  lay out again 1.27 times slower at a width they have met (Chrome's per-canvas cache), which item 2's kept positions
  then removed (research/PERF-POSITIONS.md). The quiet absolute numbers for this form are the review's §4 below.
- **Found on the way:** `twin-scan.ts --page` named a context by its place in the list, which the bound can reuse; it now
  names a context by identity.

## What came back, and the orchestrator's reading

- **The morning's baselines were wrong.** They were taken while other jobs loaded the machine. On a quiet machine, 10,000
  chat messages laid out from scratch take Chrome 4.6 s on the mix and 4.0 s on plain ASCII (not 9.59 and 4.16 s),
  Firefox 2.76 s and 0.58 s, and webkit-host 0.235 s and 0.195 s (not 11.7 and 8.83 s; main's cold prepare ran 0.31 s
  where that morning had 1.53 s). Both agents measured this independently, in alternating passes under the exclusive
  lock. So webkit-host is far under the maintainer's 2 s bar already, Firefox is under it on ASCII and at 2.5 s on the
  mix, and Chrome is the engine that is not there.
- **What the item buys:** Chrome 4.60 to 3.68 s on the mix (a fifth, not the half the guide expected) and 4.01 to 3.36 s
  on ASCII; Firefox 2.76 to 2.51 s and 0.58 to 0.46 s; webkit-host 0.235 to 0.131 s and 0.195 to 0.102 s. Preparing and
  keeping 10,000 messages in Chrome goes from 10 to 16 s to under 4 s, because a kept message no longer keeps about five
  canvases alive.
- **Sharing contexts across paragraphs is safe in Chrome:** 0 of 67,065 cases differ from the usual run in file order,
  reversed and shuffled, in both configurations, the twins included, and a mixed page of 1,997 Amiri cases on one
  measurer in four orders shows 0 differences. webkit-host: 0 of 63,987. Firefox's 94 and 74 differing cases are the
  process's two font states: the same 74 differ between two usual runs.
- **One cost:** in Chrome, kept plain ASCII paragraphs lay out again 1.24 to 1.33 times slower at a width they have
  met, because a page's canvas is asked more distinct strings than Chrome's per-canvas cache holds. It costs time only
  (0 of 120,000 widths differ), and the next item (fewer questions per layout) is what removes it.
- **The claim that doesn't stand:** "no smaller form pays as much". Keeping the list of contexts alone, without the
  font checks' kept answers, is 1% slower in Chrome and 7 to 8 ms per 10,000 messages in webkit-host, and equal in
  Firefox. The kept answers are the one part that goes stale silently: after a web font loads, a kept context in
  Chrome and Firefox measures with the loaded font by itself, and the kept answers stay wrong for as long as the page
  lives. **The orchestrator's decision: build the smaller form.** `prepare` takes a plain list of contexts; there is no
  `Measurer` type and nothing derived is kept. Only webkit-host then needs a contract (make a new list after the page's
  fonts change), which main's cache needs too. It still has to go through tier 2 before it merges.
- **Next by number:** Chrome's questions (about 280 to 320 calls a message; research/PERF-STORE-STUDY.md has the
  smallest change that cuts them), then Firefox's fill on CJK and Arabic.
- Not probed by anyone: a change of devicePixelRatio or zoom under kept contexts.

## Review of the measurer's lifetime prototype (profiling item 1), 2026-09-19

This is a second reading of the unmerged prototype on branch `x-perf-lifetime` (worktree `~/github/pretext-rebuild-wt/perf-lifetime`, the first agent's head 8f8262d). I reran its central numbers, attacked its weakest claims, and give a verdict per claim. Nothing here merges. I added three files as three commits on top (head 290e0f7) and edited none of theirs.

The brief also listed checks for a "store study". That is the other track (`x-perf-store-study`). I was given no report for it and did not review it.

Paths, all under `~/github/pretext-rebuild/.artifacts`:
- `RB` = `bench/perf-lifetime-review-20260919` (my benchmark runs: `run-1`, `variant-contexts-only`, `variant-checks-only`).
- `RT` = `tests/runs/perf-lifetime-review-20260919` (my browser runs in `mixed-amiri`, my scripts and logs in `report-tools`).
- `RP` = `probes/measurer/page-lang` and `probes/measurer/canvas-churn` (my two probes' results).

Words used:
- **Measurer**: the prototype's object. It holds the Canvas contexts and the font checks' questions with their answers.
- **Before**: `prepare` is given no measurer and makes its own, as at the base commit.
- **Both**: one measurer for every message. This is the prototype.
- **Checks alone**: the page keeps the font checks' contexts and answers; every paragraph makes its own engine contexts, as before.
- **Contexts list alone**: the page keeps every context, the checks' and the engine's; the checks' answers live for one call, as at the base commit. This form is mine. The first agent did not measure it.
- **Headline**: 10,000 chat messages from scratch, the forms taking turns in one document, forward order on even passes and reverse on odd ones.
- **Timed rows**: 1,000 messages, repeated samples, run while the page holds other kept paragraphs.
- **The mix** and **latin**: the benchmark's two message sets (27% of the mix hold emoji, CJK, Arabic, a URL or a code span; latin is plain ASCII).

### 1. Outcome

- The build is sound, the proof holds, and the headline numbers reproduce within a few percent.
- Sharing contexts in Chrome survived every new attack I made.
- One claim does not stand: "no smaller form pays as much". In the headline, in Chrome, the checks' half alone gives nearly the whole from-scratch gain (section 4).
- A smaller form exists that the first agent did not try: keep the contexts list, keep no answers. It costs 1% in Chrome and 7 to 8 ms per 10,000 messages in webkit-host, and it removes the one kept thing that goes stale silently in Chrome and Firefox (sections 4 and 6).
- Two corrections of detail: the 1,024-context bound is a cliff, and five files hold code changes, not six.
- One thing nobody probed: a change of devicePixelRatio or zoom.

### 2. Verdict per claim

| Claim | Verdict |
|---|---|
| Full offline gates exit 0 on the head; tier 1 Chrome exit 3 by the storage rule alone | **Stands.** My own run, my own worktree. |
| Chrome's usual tier 2 shows 0 transitions | **Stands**, read from their logs: forward order only, both configurations, commit 33a5af1. After that commit `rebuild/src` and `rebuild/lab` changed in comments only (I checked the diff). |
| Chrome: 0 of 67,065 differ in three orders, both configurations, twins included | **Stands.** I reran two of the comparisons from their rows and added a harder page (section 5). |
| The largest document is 13,010 cases on one measurer | **Stands, with a number added.** That document made 212 contexts and never restarted. The Chrome forward page run restarted the measurer 60 times in all: 29 in `runs`, 28 in `heldout-runs`, 2 in `smoke`, 1 in `ws`. |
| Page-wide twin scan finds 0 | **Stands.** Rerun: 67,072 cases, 377 ask a two-byte slice, 0 twins. |
| webkit-host: 0 of 63,987 differ | **Stands.** Rerun from their rows: 0 of 127,974 (both orders, no facts). |
| Firefox: 94 and 74 differ, all the process's two font states | **Stands.** Rerun: 74 with facts; without facts 94 predictions and 92 native observations differ. The two prediction-only cases (c-6403c221b98778d6, c-bd4a89130a560c90) are marked history-dependent in the frozen ledger on the metric that moved, so the usual predictor already flips them between orders. |
| Sharing contexts across paragraphs is safe in Chrome | **Stands**, by the code's construction and by every browser check so far. |
| Chrome keeps 32,768 strings and 32,768 words per canvas, least recently used half dropped | **Stands, with a fact added.** Only `HTMLCanvasElement::PostFinalizeFrame` tells a canvas's caches that a frame ended (`html_canvas_element.cc:734`). An OffscreenCanvas never does, so the size rule is the only thing that drops entries there. |
| From scratch: Chrome x0.80 and x0.85, Firefox x0.92 and x0.75, webkit-host x0.56 and x0.52 | **Stands.** Mine: x0.80, x0.84; x0.91, x0.80; x0.56, x0.52. |
| Keeping 10,000 prepared messages in Chrome: 11 to 15 s down to 3.9 to 4.2 s | **Stands.** Mine: 10.3 to 3.8 s (mix), 15.8 to 3.5 s (latin). |
| Kept ASCII paragraphs lay out again 27 to 33% slower in Chrome | **Stands.** Mine: x1.24 at a width met before, x1.05 at a new width; the mix x0.97 and x1.02. The cause rests on their probe, which I did not rerun. Why the mix doesn't move is still unknown. |
| Calls and contexts per message; the time shares after the change | **Stands.** Every count equals theirs. Shares after, Chrome mix: 1% / 75% / 25% and 68% / 0% / 32%. |
| PROFILING-START's webkit-host and Chrome baselines don't reproduce | **Stands.** Mine: Chrome before 4.60 s, webkit-host before 0.235 s, main 0.31 to 0.34 s. |
| "No smaller form pays as much" | **Does not stand** for Chrome from scratch. Section 4. |
| Bound: never more than 1,030 contexts, 6.02 contexts a prepare, +8% | **Stands, with a correction:** it is a cliff at about 128 families. Section 7. |
| The document's language does not invalidate the measurer | **Stands**, now probed. One note on Firefox. Section 6. |
| Device pixel ratio does not invalidate it | **Not shown.** Reasoned from the context's key, never probed, by them or by me. Section 6. |
| Font load: Chrome and Firefox contexts pick the font up, webkit-host's stay stale | **Stands.** Their probe's recorded widths match the report. |
| Library code +28 −23 lines, comments +47 −19, total +562 −174 | **Stands, with a correction:** five files hold code changes, not six. `canvas.ts` and the three `types.ts` changed in comments only. |
| "Contexts alone" slower than before on Chrome's mix is unexplained | **Stands as unexplained.** Reproduced (1.59 s against 1.09 s per 1,000 messages). I tested one guess and it failed (section 8). No caller of `prepare` can reach that form. |

### 3. The numbers I reran

One run of the chat benchmark per browser (`RB/run-1`), from a clean detached worktree of 8f8262d, under the exclusive lock, on AC power, background windows. The benchmark's fixed arithmetic took 26.6 to 29.3 ms in all three, which is what the first agent's quiet runs show.

1-minute load at each start: Chrome 5.69 (it had been 34 twenty minutes earlier; the 5-minute average was still 20), Firefox 3.24, webkit-host 3.68. My mistake: a single-threaded offline tool of mine ran during the Firefox and webkit-host runs. The load stayed under 5 and both agree with the first agent's numbers within 1 to 5%.

**From scratch, 10,000 messages, passes before then after:**

| | mix | latin |
|---|---|---|
| Chrome | 4.87, 4.60, 4.52 to 3.62, 3.83, 3.68 s (x0.80; pairs 0.74, 0.83, 0.81) | 4.14, 4.01, 3.99 to 3.35, 3.41, 3.36 s (x0.84) |
| Firefox | 2.62, 2.76, 2.77 to 2.42, 2.51, 2.51 s (x0.91) | 597, 577, 574 to 980, 441, 459 ms (x0.80; one outlier pass) |
| webkit-host | 301, 234, 235 to 136, 131, 131 ms (x0.56) | 202, 191, 195 to 102, 102, 99 ms (x0.52) |

Main, cold, the mix: Chrome 341, 312, 318 ms; Firefox 313, 328, 314 ms; webkit-host 333, 309, 305 ms. So after the change Chrome is x11.6 main, Firefox x8.0, webkit-host x0.42.

**Kept, 10,000 messages** (one measurement each, not alternating):
- Chrome prepare-and-keep: mix 10.30 to 3.78 s, latin 15.81 to 3.50 s. Laid out at 3 new widths: 2.84 to 2.74 s and 2.37 to 2.46 s. Main: 8.1 and 6.5 ms.
- Firefox: prepare-and-keep 2.60 to 2.44 s and 617 to 488 ms; 3 widths 726 to 713 ms and 594 to 589 ms.
- webkit-host: prepare-and-keep 251 to 152 ms and 205 to 109 ms; 3 widths 100 to 99 ms and 77 to 72 ms.

**Chrome timed rows, latin, 3,000 layouts:** at a width met before 145 to 180 ms (48 to 60 µs a layout, x1.24); at a new width 175 to 184 ms (x1.05). The mix: 173 to 167 ms and 210 to 215 ms.

**Counts** (they don't depend on load), per message, before to after:
- Chrome mix 322.13 to 311.38 calls, 11.07 to 0.024 contexts; latin 281.86 to 271.87 and 10 to 0.01.
- Firefox mix 120.44 calls unchanged, 3.557 to 0.013 contexts; latin 78.35 and 2.938 to 0.003.
- webkit-host mix 39.78 to 30.28 calls, 5.378 to 0.011 contexts; latin 30 to 21 and 5 to 0.005.
- Calls per layout at a new width: 136.8 and 112.9 in Chrome, 28.1 and 29.5 in Firefox, 0.12 and 0 in webkit-host.
- Contexts a page holds for 1,000 messages: 24, 13, 11 on the mix; 10, 3, 5 on latin.

**Time shares after the change** (font checks / engine prepare / fill, then inside `measureText` / making contexts / outside Canvas):
- Chrome mix 1% / 75% / 25% and 68% / 0% / 32%, 0.805 µs a call.
- Firefox mix 0% / 9% / 90% and 63% / 0% / 37%.
- webkit-host mix 13% / 67% / 20% and 32% / 0% / 67%.

So the next item by number is Chrome's 311 calls a message, as the first agent says.

**Gates.** `bun rebuild/tests/gates.ts`, full form, on 8f8262d in my own detached worktree: exit 0, 39 gates in 549.5 s, load 22 to 34 at the start.
- Tier 1 Chrome: exit 3 in both configurations, 0 predictions changed, 0 repeats, dropped, other or new questions; 65,764 and 5,105 cases go to tier 2 by the storage rule.
- Tier 1 webkit-host and Firefox: exit 0 in both configurations.
- Twin scan: 67,072 cases, 377 and 0.
- `--quick` on my head 290e0f7: exit 0, 25 gates in 131 s.

### 4. Does a smaller form pay as much? The claim that doesn't stand

The first agent answered "no" from the timed rows. Its own report says those rows run while the page holds other kept paragraphs' canvases and should be read as relative. I put each smaller form into the headline pass, in the slot of "before", so it alternates with "both" in one document. 10,000 messages, 5 passes. The change is a scratch patch of `bench/page.ts` only (`RT/report-tools/variant-*.patch`); the library is untouched.

| Headline, medians of 5 passes | smaller form | both | both as a ratio |
|---|---|---|---|
| Chrome mix, checks alone | 3.71 s | 3.57 s | x0.96 (pairs 0.92 to 1.00) |
| Chrome latin, checks alone | 3.30 s | 3.32 s | x1.005 |
| Chrome mix, contexts list alone | 3.70 s | 3.67 s | x0.99 |
| Chrome latin, contexts list alone | 3.35 s | 3.30 s | x0.985 |
| webkit-host mix, contexts list alone | 138 ms | 131 ms | x0.95 |
| webkit-host latin, contexts list alone | 104 ms | 96 ms | x0.92 |

Loads: 2.6 at the start of the checks-alone run; 7.3 for the contexts-list run in Chrome (it waited for a load of 26 to fall), 3.4 in webkit-host. "Before" in the same kind of pass is 4.60 s (mix) and 4.01 s (latin).

What follows:
- **In Chrome from scratch, the checks' half is nearly the whole gain.** Making the engine's 4.7 contexts a message costs about 14 µs a message in the headline. The checks' 6.4 contexts cost about 78 µs. My reading, untested: every check context is asked a question, so each one resolves its font, while a plain paragraph uses one or two of its five engine contexts.
- **What the engine-contexts half buys is elsewhere:** kept paragraphs in Chrome (prepare-and-keep 10.3 to 3.8 s, because a kept message no longer holds about 4.7 canvases alive), all of Firefox's gain (its checks ask nothing) and part of webkit-host's. Virtualized layout keeps prepared paragraphs, so "both" is still the right build. The report's reason for it should change.
- This also settles the first agent's option (b), keeping Blink's engine contexts per paragraph. From scratch it costs only 0 to 4% against "both". It avoids the relayout cost. It gives the kept-paragraph gain back. I would still accept the relayout cost until item 2.
- **The contexts list alone is a smaller design that pays nearly as much:** 1% slower in Chrome, 5 to 8% in webkit-host (7 to 8 ms per 10,000 messages), equal in Firefox. The measurer becomes a plain `Context[]`: no `Measurer` type, no `newMeasurer`, no kept answers. Code size is about the same; the difference is what can go stale (section 6). I did not run this form through tier 2. It asks the base commit's questions on the prototype's contexts, so I expect tier 2 to be unmoved, but that is not shown.

### 5. Correctness under shared contexts in Chrome

**Read from the code.**
- `canvasString` sets `twoByte` only when the string holds a unit above U+00FF, or when the paragraph is segmented.
- `contextsOf` then sends every Latin-1-only string of an unsegmented paragraph to an `8bit` context. A segmented paragraph's Latin-1-only string is either one-byte on `8bit` or a forced slice of 13 units or more on `16bit`.
- So no context can see the same characters in both storages anywhere on a page. The partition names are constants, not per-paragraph values.
- The other sites that ask Canvas (the hyphen, the tab's space, HanKerning, the word-splitting probe) ask strings that are two-byte by a character, or one-byte on `8bit`.
- No code touches a context's `ctx` outside `measure/canvas.ts`, so a context is never changed after it is made. With a page's list, one paragraph can't leak a setting into another.

**A page the first agent's runs never had.** In its runs the 380 twins cases were a document of their own. I put every Chrome case of the page context (`en`, fixture font Amiri) into one document: 380 twins, 1,393 of `suite-sample`, 218 of `families`, 6 of `smoke`. That is 1,997 cases, ordered by a hash of their ids so the twins sit between the others. Amiri is the font where a string's storage shows in its width.
- The page-measurer runs made 102 contexts for the whole page. The usual run made 29,131 (14.59 a case).
- Runs: hash order, reverse, shuffle seed 7, shuffle seed 20260919, without facts; one shuffled run with facts (72 contexts against 12,708); one shuffled run of the plain path.
- Compared with `lab/compare-rows.ts` against a usual run of the same file: **0 native observations, 0 predictions and 0 painted lines differ in all six comparisons.**
- Rows and logs: `RT/mixed-amiri`.

**Not attacked further:** long sessions past Chrome's cache bound. Their probe (0 of 120,000 strings differ) and the benchmark's equal line totals stand as they are. My benchmark runs reproduce the equal totals: 35,076 and 32,549 lines in both forms.

### 6. Staleness

**A font that loads later.** Their probe's recorded widths match the report: Chrome and Firefox old contexts go from 433.48 to 327.79, webkit-host's stays at 432.07 until another font string is assigned.

One consequence the report doesn't draw. In Chrome and Firefox a kept context heals by itself. The kept answers are what stays wrong. A page that forgets to make a new measurer then gets right widths with wrong font facts (primary family, hyphen, fixed pitch) for as long as it lives. Before the change the next `prepare` healed everything. With the contexts list alone, Chrome and Firefox heal on the next `prepare` again, and only webkit-host needs the contract. That is the argument for the smaller form.

**The document's language.** New probe `rebuild/probes/measurer-page-lang.ts`, in the three pinned browsers. Contexts are made under `<html lang="en">` with `lang` assigned as '', en, ja, zh-CN and sr, then the page goes to ja.
- In all three browsers every old context measures what a context made after the change measures, for strings it had measured and strings it hadn't. So the claim stands.
- Chrome: no context with an assigned `lang` moves, '' included. The control (never assigned) moves for a new context only.
- Firefox: a context whose `lang` is '' follows `<html lang>` on every call (161.73 px, then 186.97 px for `Hello, world` at 32px serif). Old and new agree because both follow the document. Gecko's port gives a context '' for content with `lang=""` when the process languages are unknown (`engines/gecko/prepare.ts` `canvasLang`). That is the port's existing behaviour, not the measurer's, but the DESIGN.md sentence "a context is found by every setting that reaches Canvas, so the document's language can't make it stale" is true there only because a new context would follow the document too.
- webkit-host: the context has no `lang` attribute and nothing moves.

**devicePixelRatio and zoom.** Not probed by anyone. The argument is that Blink's font size carries the zoom, so a new ratio makes new contexts. It has a gap: a font with an optical size axis is measured at the CSS size, so its context is reused across zooms, and in Chrome a reused canvas answers from what it shaped before. It is safe if an OffscreenCanvas never reads the device scale, which the rebuild assumes everywhere. What would settle it: a Chrome probe that measures on a kept context, changes the device scale factor through the DevTools protocol's `Emulation.setDeviceMetricsOverride`, and compares the kept context with a new one. The probe runner sets that override only at launch today.

### 7. The bound

New tool `rebuild/tools/measurer-bound.ts`: Blink, stand-in Canvas, where a context costs nothing to make, so it prices the list searches alone.
- Their counts reproduce exactly: never more than 1,030 contexts held, 6.02 contexts made a prepare with sizes that never repeat.
- Their test varied the size, and the checks measure at 16px whatever the size, so the checks' contexts and answers were shared. I also varied the family (both lists grow: up to 1,028 contexts and 762 answers held) and the letter spacing. Ratios of one measurer to a measurer a call: 0.96, 1.02, 0.94. In those rows the stand-in's own work on never-seen fonts dominates (1.3 to 2.1 ms a prepare), so they understate the search's share.
- **The bound is a cliff.** A page that cycles through D families holds about 8 contexts a family.
  - 120 families: 964 contexts held, 0 made a prepare, x0.95 to x1.03 in time.
  - 128 families: the measurer starts over in every cycle, 8.03 contexts are made a prepare (10.2 without a measurer), x1.02 to x1.13 in time.
  - Two runs at loads 3 and 11.5; the counts are exact, the times are not.
- So past about 128 families (or about 200 sizes of one family) the page gets a fifth of the contexts gain and pays up to a tenth more in JS. A chat page is far from it (24 contexts). I would not add code for it; the text should say "cliff".

### 8. The engineering guide

Follows it: one object with one lifetime, arrays instead of maps, no defensive code, contexts never changed after creation, and the default parameter is not glue (it costs nothing and keeps the recorded references valid).

Against it, small:
- **The restart sits in the wrong place.** `withLearnedFontFacts` in `font-checks.ts` empties the list the engines measure in. The bound of the whole measurer lives inside one of its two users. `prepare` in `index.ts` is the one place that sees both.
- **`asked` is the guide's "derived field that becomes state".** It is the part with an invalidation problem the library can't see, and it buys 1% in Chrome and 7 to 8 ms per 10,000 messages in webkit-host (section 4).
- `Measurer` is declared in `font-checks.ts` though half of it is `canvas.ts`'s. With the contexts list alone there is no such type.
- "In six files" should read five.

The slowness of the bench's "contexts alone" form is still unexplained. My guess was that collections walk what the page's filled canvases hold. Probe `rebuild/probes/measurer-canvas-churn.ts` says no: 2,000 short-lived canvases take 28 to 40 ms whether 0 or 8 canvases that have answered 40,000 strings each are alive (one 66 ms outlier). No caller of `prepare` can reach that form.

### 9. What I added

Three commits on `x-perf-lifetime`, no library change:
- 1b61233 `rebuild/probes/measurer-page-lang.ts`, with its verdicts in the header.
- 99c4f9d `rebuild/tools/measurer-bound.ts`.
- 290e0f7 `rebuild/probes/measurer-canvas-churn.ts`, a negative result kept as the record of a tested guess.

Browser work: one chat benchmark run per browser, two headline-only variant runs in Chrome and one in webkit-host, eight lab runs of the mixed Amiri page, three page-language probe runs, one churn probe. No job failed.

Offline: the full gates, the quick gates, the page-wide twin scan, five comparisons rerun from the first agent's rows, a count of measurer restarts from its rows.

### 10. Needs the maintainer

1. Both halves, or the contexts list alone? Same code size, 1% in Chrome and 7 ms per 10,000 messages in webkit-host, against kept answers that go stale silently in Chrome and Firefox.
2. Accept Chrome's relayout cost until item 2. I agree with the first agent. It shows on ASCII only, x1.24 at a width met before.
3. Replace PROFILING-START's Chrome and webkit-host baselines (4.6 s and 0.24 s from scratch, not 9.59 s and 11.7 s), and correct item 1's "expected" text: in Chrome the checks were the cost, not the engine's contexts.

## The measurer's lifetime: the prototype, its proof and its numbers (2026-09-19)

This is PROFILING-START.md item 1, as an unmerged prototype on branch `x-perf-lifetime`. The worktree is `~/github/pretext-rebuild-wt/perf-lifetime`. The branch has 14 commits on 8058f06, head 8f8262d, and is local only. An earlier agent built it and ran the browsers. A second agent finished it from those files. It ran every comparison again, ran the gates on the head, and added two Chrome probes and three offline counts where the evidence had a hole. Nothing here merges.

Paths, all under `~/github/pretext-rebuild/.artifacts`:
- `P` = `tests/runs/perf-lifetime-20260919`, the browser proof.
- `B` = `bench/perf-lifetime-20260919`, the benchmark runs `night-1`, `night-2` and `night-3`.
- `F` = `P/report-tools/finish`, the second agent's scripts, logs and probe results.

Words used:
- **Measurer**: the new object. It holds the Canvas contexts, each found by its settings, and the runtime font checks' questions with Canvas's answers.
- **A measurer a message** ("before"): `prepare` is given none and makes its own, so nothing outlives a prepared paragraph. This is the base commit's behaviour.
- **One measurer** ("after"): the caller makes one and hands it to every `prepare`.
- **Usual run**: tier 2 with the lab's usual predictor, which makes a measurer per case.
- **Page-measurer run**: the same sets with a new predictor that keeps one measurer for a document.
- **Document**: one page load of the lab, holding the cases of a part that share a page language and fixture fonts.
- **Configurations**: `no-facts` (font facts asked of Canvas at run time) and `facts` (the lab supplies them).
- **The mix** and **latin**: the benchmark's two sets of chat messages. 27% of the mix hold emoji, CJK, Arabic, a URL or a code span. Latin is plain ASCII.
- **Headline**: 10,000 messages from scratch in three passes, the forms taking turns in one document.
- **Timed rows**: 1,000 messages, repeated samples per variant.

### 1. Outcome

- **Built.** `prepare(paragraph, env, inspect, measurer?)`. Library code is +28 −23 lines (net +5) in six files, with comments +47 −19. A caller that passes nothing gets today's behaviour at no cost.
- **Correctness held.**
  - The full offline gates exit 0 on the head (39 gates, `F/gates-8f8262d-second.log`).
  - Chrome: 0 of 67,065 cases differ from the usual run in file order, reversed and shuffled, in both configurations, `twins` included. The page-wide twin scan finds 0.
  - webkit-host: 0 of 63,987 cases differ.
  - Firefox: 94 and 74 cases differ. All of them are Firefox's two font states of a process, shown by controls (§4).
- **Bought** (10,000 messages from scratch, quiet runs):

| | the mix | latin |
|---|---|---|
| Chrome | 4.79/5.08 s to 3.82/4.08 s (×0.80) | 4.11 s to 3.49 s (×0.85) |
| Firefox | 2.63 s to 2.41 s (×0.92) | 0.60 s to 0.45 s (×0.75) |
| webkit-host | 0.25 s to 0.14 s (×0.56) | 0.19 s to 0.10 s (×0.52) |

  Preparing and keeping 10,000 messages in Chrome went from 11.1 s and 14.7 s to 3.9 s and 4.2 s.
- **One cost.** In Chrome, kept ASCII paragraphs lay out again 27–33% slower at a width they have met. The cause is found (§5). It costs time only.
- **Against the bar** (2 s for 10,000 messages from scratch): Chrome is not there (3.8–4.1 s). Firefox is there on ASCII and close on the mix (2.4 s). webkit-host is far under.

### 2. What was built

- `measure/font-checks.ts` (+44 −17):
  - `type Measurer = { contexts: Context[]; asked: { context; text; width }[] }` and `newMeasurer()`.
  - A call still resolves its declarations locally. No fact of a declaration is kept, because a fact also depends on what the paragraph's text needs (a soft hyphen, joining letters) and on the zoom. The kept Canvas answers depend on neither.
  - A call that finds more than `MAX_CONTEXTS` = 1,024 contexts starts the measurer over.
- `index.ts` (+9 −6): `prepare(..., measurer: Measurer = newMeasurer())`. It hands the measurer to the checks and `measurer.contexts` to the engine. It exports `newMeasurer` and `Measurer`.
- The three engine sites take the list: `blink/index.ts` (+1 −2), `webkit/content.ts` (+3 −3), `gecko/prepare.ts` (+1 −2). Records that hold contexts by reference are unchanged.
- The per-call form is kept because it costs nothing. It is a default parameter. It keeps the lab's usual predictors, the recorded references and tier 1 valid: tier 1 shows 0 changed predictions and 0 changed questions.
- Held as the guide says:
  - Sharing is three predictors under `lab/baselines/page-measurer-*.ts`.
  - `browser-sets.ts --shuffle=<seed>` gives a third order.
  - `twin-scan.ts --page` scans a case file as one page.
  - The bench runs both forms in one document.
  - A font-load probe sits under `rebuild/probes`.

### 3. Lifetime, what invalidates it, what bounds it

**Lifetime.** It is the caller's: a page's, or one call's when nothing is passed.

**What invalidates it.** Only the page's fonts changing.
- Probe `measurer-font-load`, in the three pinned browsers (`.artifacts/probes/measurer/font-load/*-probes.json`):
  - After a FontFace loads, Chrome's and Firefox's old contexts measure with the loaded family. That includes a string they had measured before (327.79 where it was 433.48).
  - webkit-host's old context keeps the fallback (432.07, and 604.90 for an unseen string), even after the same font string is assigned again. A fresh context gives 327.79.
- So a kept WebKit context is stale after a font loads. A kept font-check answer is stale in every engine. So are prepared paragraphs.
- The library reads nothing of the document, so it cannot know. It could not detect it from inside either: the stale WebKit context answers consistently.
- Contract: make the measurer after the text's fonts have loaded, and make a new one where paragraphs are prepared again after `document.fonts` changes.
- The document's language does not invalidate it.
  - Blink and Gecko contexts get an explicit `ctx.lang`, which is part of the settings a context is found by.
  - WebKit's OffscreenCanvas has no locale (DESIGN.md §4.6 table).
- Device pixel ratio does not invalidate it either. Blink's font size includes the zoom, so a new ratio makes new contexts.

**What bounds it.** The distinct settings a page measures with, and about a dozen probe strings per checks' context.
- The chat mix uses 24 contexts in Chrome, 13 in Firefox and 11 in webkit-host for 1,000 messages. Latin uses 10, 3 and 5 (bench counts).
- On the tier sets, contexts a case with one measurer against a measurer a case: Chrome 1.13 against 15.75, Firefox 0.28 against 4.62, webkit-host 0.13 against 7.77 (`F/docs.py` over the run rows).
- Letter spacing and word spacing are continuous, hence the restart at 1,024 contexts.
- With 10,000 distinct declarations (each prepare another font size; offline stand-in Canvas, where contexts are free, so this prices the list alone; 3 rounds taking turns, load 4.5, tool `P/report-tools/bound.ts`):
  - the list never held more than 1,030 contexts;
  - 6.02 contexts were made a prepare instead of 10;
  - a prepare took 408–422 µs against 377–389 µs (+8%).
  - With one declaration it took 385–393 µs against 415–434 µs.
- What a kept canvas holds inside the browser is the browser's to bound. Chrome keeps at most 32,768 strings and 32,768 words per canvas and drops the least recently used half when full (`frame_shape_cache.cc:12-16, :93-104`, read in the local chromium 153.0.8010.48).

### 4. The proof

**Offline gates.** `bun rebuild/tests/gates.ts`, full form.
- On 29aff57: exit 0 (`F/gates-29aff57.log`).
- On the head 8f8262d, which differs by DESIGN.md only:
  - The first run exited 2. Under a load of 60, two webkit-host gates (`plain` and `pure`, facts) failed to connect to the runner's cores socket (`F/gates-8f8262d.log`).
  - Both pass when run alone: 63,987 pass, 0 fail (`F/*-alone.log`).
  - A second full run exited 0 (`F/gates-8f8262d-second.log`), and the worktree's `gates.json` is from it.
- Tier 1 for webkit-host and Firefox exits 0 in both configurations.
- Tier 1 for Chrome exits 3 by the string storage rule alone: 0 predictions changed, and 0 repeats, dropped, other or new questions.
- Chrome's usual tier 2 (forward, both configurations, commit 33a5af1) then shows 0 transitions and the gate passes (`P/chrome-*-usual.log`).
- After 33a5af1 the library changed in comments only.

**Tier 2 with the page-measurer predictors**, compared case by case. The view compares layouts with widths, the observation port's values, painter limits and painted lines. It leaves out only the counts of Canvas work. I re-ran all of them (`F/v-*.log`).

| Browser | Runs | Rows compared | Differ |
|---|---|---|---|
| Chrome | both orders, both configurations | 134,130 each | 0 |
| Chrome | shuffled third order, both configurations | 67,065 each | 0 |
| Chrome | plain path, line ranges | 67,065 | 0 |
| Chrome | against the branch's own usual runs | 67,065 each | 0 |
| webkit-host | both orders, both configurations | 127,974 each | 0 |
| Firefox no-facts | both orders | 127,542 | 94 |
| Firefox facts | both orders | 127,542 | 74 |

- Chrome's shuffle really is another order: 1 of 13,010 cases keeps its place.
- `twins` is one document of 380 cases. It makes 70 contexts with one measurer where the usual run makes 6,395. 0 cases differ in all three orders.
- Twin scan over each case file as one page: 67,072 cases, 377 ask a two-byte slice, and 0 ask one context the same characters in both storages (`P/twin-scan-page.log`).
- The largest document is 13,010 cases on one measurer.

**Firefox's 94 and 74 differing cases**, classed (`F/firefox-checks.log`, `F/ff*.py`).
- Native observation and prediction move together, in two parts only. The reference ledger marks every one history-dependent.
- Control: two usual runs (the cr5-merge recording and the Gecko follow-up's run) differ in the same 74 cases (`F/control-ff-facts-usual-vs-usual.log`).
- The facts page-measurer run equals that follow-up usual run on all 63,771 forward cases (`F/cmp-ff-facts-page-vs-fu.log`).
- Without facts, the 87 cases that differ in file order equal the usual run's reversed order, native and prediction alike. The other 7 are consecutive cases in one reversed part.
- Over ten runs of that part, the 74 cases' native observations fall into exactly two groups. Usual and page-measurer runs land in both groups.
- So these are Firefox's two font states of a process, not the measurer.
- Statuses: one `widths` pass gained (c-6403c221b98778d6) and one lost (c-bd4a89130a560c90).
- I could not show whether keeping contexts alive makes one state more likely.

**What tier 2 does not reach.** Its documents stay under Chrome's cache bound. The busiest canvas of any Chrome document is asked 5,437 distinct strings (offline count, `F/doc-canvas-load-all.log`). Two checks cover a canvas past the bound:
- The bench's counting pass, where one canvas is asked about 100,000 distinct strings. It finds every line range of 1,000 messages at four widths equal in both forms, in both sets, in three browsers and three runs. The 10,000-message line totals are equal too.
- A probe in pinned Chrome (`F/canvas-cache-drop-chrome-probes.json`):
  - 0 of 120,000 strings come back with other bits when asked again on a canvas past its bound.
  - 0 of a sample of 3,244 differ on fresh canvases.
  - This holds for one-byte strings and for strings that are two-byte by a character.

### 5. Is sharing contexts across paragraphs safe in Chrome?

**Yes.**
- A context's settings hold everything Chrome's shaping reads but the string's storage.
- `partition` already names the storage for every paragraph:
  - An unsegmented paragraph uses `8bit` contexts. They hold one-byte strings, and two-byte strings that hold a unit above U+00FF and that Canvas cuts no words from.
  - A segmented paragraph sends its two-byte strings to `16bit` contexts and its one-byte strings to `8bit` (`shape.ts` `contextsOf`).
  - So no canvas sees the same characters in both storages, page-wide.
- Word spacing is always `0px` on Blink's contexts and is added in JS.
- No other hazard showed: no case changed any width.

**The cost.**
- A page's canvas is asked far more than Chrome keeps. Under the stand-in Canvas (`F/per-context.log`):
  - 1,000 latin messages ask one canvas 100,461 distinct strings at one width and 113,331 at four widths;
  - 10,000 messages ask it 841,435;
  - on the mix the busiest two canvases are asked 74,732 and 30,733.
- So a kept paragraph's strings are gone when it is laid out again, where its own canvas still holds them.
- Chrome probe (`F/canvas-cache-cap-chrome-probes.json`, exclusive lock, load 2.5, 100,000 strings, 3 rounds taking turns), µs a string:

| | first ask | asked again |
|---|---|---|
| one shared canvas | 0.43–0.59 | 0.56–1.06 |
| 1,000 canvases of 100 strings each | 0.80–1.14, canvas included | 0.30–0.34 |

  The difference in the first ask comes to about 36–56 µs per canvas made.
- In the bench's timed rows, latin, per layout, three runs:

| | before to after | ratio |
|---|---|---|
| at a width met before | 48.6→61.6 µs, 75.5→99.6 µs, 100→133 µs | ×1.27–1.33 |
| at a new width | — | ×1.08–1.16 |

  The mix does not move (×0.94–1.08). I did not find out why.

**Options.**
- (a) Accept it until item 2 cuts the 113–137 asks per layout.
- (b) Blink alone keeps the engine's contexts per paragraph (one line in `index.ts`). From scratch this gives ×0.44–0.62 on the mix instead of ×0.29–0.38 (timed rows). It gives up the kept-paragraph gain below.
- (c) A fresh context per N strings cannot help. A page asks more than 32,768 distinct strings between two layouts of the same paragraph whatever N is.

### 6. The numbers

Three runs of `rebuild/bench/chat-night.sh`. Each browser ran under the exclusive lock, on AC power, in a background window. Both forms and main take turns in one document. The order is forward on even passes and reverse on odd ones, so each run holds three alternating pairs.

1-minute load at each browser's start:

| | night-1 | night-2 | night-3 |
|---|---|---|---|
| Chrome | 1.75 | 1.69 | 2.83, then rose to 46 during the run (fixed arithmetic 28→61 ms) |
| Firefox | 3.34 | 3.52 | 7.44 |
| webkit-host | 2.47 | 7.43 | 4.31 |

- Night-3's Chrome times are not usable as absolutes. Its ratios agree with the other two runs.
- Library per run: night-1 e73e889, night-2 33a5af1, night-3 e0c7f23 (the head's code).
- Sources: `B/night-N/<browser>-bench.json`, read with `F/bench.py`, `rows.py`, `phases.py` and `ratios.py`.

**From scratch, 10,000 messages.** Passes before → passes after, then the ratio of medians.

| | night-1 | night-2 | night-3 |
|---|---|---|---|
| Chrome mix | 6.30, 4.79, 4.67 → 3.80, 4.04, 3.82 s (×0.80) | 7.95, 5.08, 4.65 → 4.08, 4.43, 3.83 s (×0.80) | 9.57 → 7.83 s medians (×0.82), loaded |
| Chrome latin | 4.25, 4.11, 4.11 → 3.49, 3.54, 3.49 s (×0.85) | 4.34, 4.13, 4.09 → 3.52, 3.58, 3.50 s (×0.85) | 8.53 → 7.38 s (×0.87), loaded |
| Firefox mix | 2.63, 2.57, 2.63 → 2.41, 2.41, 2.40 s (×0.92) | 2.66, 2.67, 2.64 → 2.47, 2.50, 2.47 s (×0.93) | 3.06, 2.63, 2.61 → 2.75, 2.58, 2.40 s (×0.98) |
| Firefox latin | 782, 583, 624 → 447, 463, 446 ms (×0.72) | 596, 606, 588 → 469, 448, 469 ms (×0.79) | 581, 576, 620 → 437, 471, 438 ms (×0.75) |
| webkit-host mix | 296, 248, 248 → 140, 142, 138 ms (×0.56) | 297, 242, 238 → 143, 140, 138 ms (×0.58) | 328, 265, 276 → 146, 153, 148 ms (×0.53) |
| webkit-host latin | 192, 194, 193 → 100, 101, 99 ms (×0.52) | 196, 200, 200 → 100, 105, 104 ms (×0.52) | 202, 200, 201 → 104, 108, 104 ms (×0.52) |

Main, cold, medians of the three runs:

| | mix | latin |
|---|---|---|
| Chrome | 340, 390, 692 ms | 202, 198, 414 ms |
| Firefox | 302, 312, 336 ms | 203, 202, 197 ms |
| webkit-host | 312, 330, 354 ms | 180, 192, 188 ms |

After the change Chrome is about ×11 main's cold prepare on the mix, Firefox ×8, and webkit-host ×0.45.

**Kept, then laid out at 3 new widths** (10,000 kept messages, one measurement a run, not alternating). Before→after for the three runs:

| | mix | latin |
|---|---|---|
| Chrome | 2.95→2.90 s, 7.08→3.22 s, 6.04→5.99 s | 2.43→2.64 s, 2.45→2.82 s, 9.29→5.44 s |
| Firefox | 660→875 ms, 780→809 ms, 729→708 ms | 597→587 ms, 604→617 ms, 603→580 ms |
| webkit-host | 100→94 ms, 102→94 ms, 100→93 ms | 74→75 ms, 86→73 ms, 84→73 ms |

- Main takes 8–14 ms.
- The spread in Chrome's "before" is the collection of about 110,000 canvases.
- The timed rows are the steadier answer (§5). They show no gain. The layout itself still asks 136.8 calls in Chrome, as the guide said.

**Preparing and keeping all 10,000**, before→after:
- Chrome mix: 11.07→3.93 s, 14.68→4.23 s, 22.8→8.0 s.
- Chrome latin: 17.72→4.02 s (night-2) and 47.4→7.6 s (night-3).
  - Night-1's latin "after" of 10.28 s ran right after the other form's canvases in an older order that commit 2a83e0d fixed.
- webkit-host: 257→148 ms.
- Firefox: 2.60→2.49 s.
- A kept paragraph no longer keeps about 4.7 canvases of its own alive. That was 47,000 for 10,000 messages. It is 24 for the page now.

**Calls and contexts per message** (counts, equal in all three runs):

| | calls | contexts |
|---|---|---|
| Chrome mix | 322.13 → 311.38 | 11.07 → 0.024 |
| Chrome latin | 281.86 → 271.87 | 10 → 0.01 |
| Firefox mix | 120.45 → 120.45 | 3.56 → 0.013 |
| Firefox latin | 78.35 → 78.35 | 2.94 → 0.003 |
| webkit-host mix | 39.78 → 30.28 | 5.38 → 0.011 |
| webkit-host latin | 30 → 21 | 5 → 0.005 |

Calls per layout at a new width are unchanged: 136.8 and 112.9 in Chrome, 28.1 and 29.6 in Firefox, 0.12 and 0 in webkit-host.

### 7. Against the guide's expectations

**Chrome** was expected at about half on the mix (9.6→5 s) and a fifth off on ASCII (4.2→3.3 s).
- Measured: a fifth off on the mix (×0.80) and ×0.85 on ASCII.
- The guide's arithmetic came from a loaded run. On a quiet machine "before" is 4.8–5.1 s, not 9.59 s.
- The share of time making contexts is not steady. It was 12%, 36% and 26% of the mix in the three phase passes, where the guide had 43%.

**webkit-host** was expected at 11.7 s to 3–4 s.
- The 11.7 s did not come back. Today it is 0.25 s before and 0.14 s after.
- Main ran 0.31 s in the same documents where that morning run had 1.53 s. Main's code did not change, so the cause is outside the library.
- A `measureText` call cost about 28 µs that morning. It costs 0.17 µs today. The cause is unknown. One unchecked guess is that WebKit was dropping its font caches under memory pressure.
- The ratio the guide hoped for holds: ×0.52–0.58.

**Firefox** was expected at 5% at most.
- Measured: 7–8% on the mix in the two quiet runs, and 21–28% on ASCII.
- On ASCII, making contexts weighed 17%, and a call in a kept context costs 0.25 µs against 0.30 µs.

### 8. Where the rest of the time is (one measurer, phase pass, quiet runs)

| | font checks / engine prepare / fill | inside `measureText` / making contexts / outside Canvas | calls a message |
|---|---|---|---|
| Chrome mix | 1% / 74% / 25% | 68% / 0% / 32% | 311 (164 prepare, 147 fill) at 0.82–0.90 µs |
| Chrome latin | 1% / 76% / 23% | 68–69% / 0% / 31–32% | 272 |
| Firefox mix | 0% / 9% / 90% | 60–62% / 0% / 37–40% | 120 |
| Firefox latin | 1–2% / 35% / 64% | 44–46% / 0% / 54–56% | 78 |
| webkit-host mix | 11% / 68–71% / 17–20% | 33–36% / 0–1% / 64–67% | 30, at 14 µs a message |

- Before the change, Chrome's mix was 17–31% / 55–61% / 14–23%, and webkit-host's was 40–41% / 46–49% / 11–12%.
- **Next by number.** Chrome's calls:
  - About 109 of 361 calls a message are distinct strings (stand-in count, `P/report-tools/distinct-questions.log`), about 10 characters each, mostly unique to a message. So a page canvas's cache cannot answer them across messages.
  - Main asks 6.7 short calls a message, and they repeat.
  - That points at item 2 (positions asked again, and the whole relayout cost) and at item 6's Blink recipes (−5% and −12% of calls).
- Then Firefox's fill on CJK and Arabic (item 3).
- webkit-host needs nothing.

### 9. Does a smaller form pay as much?

**No.** Timed rows, ratio to a measurer a message, three runs. The smaller forms were not in the headline. These rows run while the page holds kept paragraphs' canvases, so read them as relative.

| | both | checks alone | contexts alone |
|---|---|---|---|
| Chrome mix | 0.38, 0.29, 0.30 | 0.62, 0.45, 0.44 | 1.90, 1.43, 1.25 |
| Chrome latin | 0.37, 0.54, 0.49 | 0.63, 1.21, 0.99 | 0.95, 1.05, 1.02 |
| Firefox mix | 0.94, 0.94, 0.96 | 1.00, 1.00, 1.03 | 0.95, 0.95, 0.96 |
| Firefox latin | 0.76, 0.73, 0.75 | 1.01, 1.00, 1.01 | 0.76, 0.77, 0.76 |
| webkit-host mix | 0.59, 0.60, 0.58 | 0.74, 0.68, 0.69 | 0.88, 0.90, 0.92 |
| webkit-host latin | 0.48, 0.51, 0.50 | 0.60, 0.60, 0.59 | 0.87, 0.88, 0.87 |

- "Checks alone" is most of webkit-host's gain and much of Chrome's. "Contexts alone" is all of Firefox's.
- In code they are the same size: the engine sites are one line each.
- "Contexts alone" being slower than "before" on Chrome's mix is unexplained.

### 10. Lines added and removed per file (8058f06..8f8262d, +562 −174)

**Library**
- font-checks.ts +44 −17
- index.ts +9 −6
- canvas.ts +9 −4 (comments)
- blink/index.ts +1 −2
- blink/types.ts +3 −3
- gecko/prepare.ts +1 −2
- gecko/types.ts +4 −3
- webkit/content.ts +3 −3
- webkit/types.ts +3 −2

**Library tests**
- font-checks.test.ts +34 −8
- blink/lines.test.ts +8 −8
- blink/pair-window.test.ts +1 −1
- gecko/gecko.test.ts +12 −12
- gecko/lazy-scan.test.ts +1 −1
- webkit/breaks.test.ts +3 −3
- webkit/lines.test.ts +6 −6

**Lab and tools**
- predictor-core.ts +18 −10
- page-measurer-predictor.ts +13
- page-measurer-facts-predictor.ts +6
- page-measurer-plain-predictor.ts +8
- browser-sets.ts +8 −4
- twin-scan.ts +27 −13
- probes/measurer-font-load.ts +71
- probes/font-checks.ts +1 −1

**Bench**
- page.ts +118 −35
- protocol.ts +13 −1
- report.ts +29 −2
- run.ts +4 −4
- README.md +16 −6

**Docs**
- DESIGN.md +80 −17
- lab/README.md +8

### 11. What the second agent added

- Three full gates runs. The middle one failed by the gates runner's own socket under load, as §4 says.
- A re-run of every comparison.
- The Firefox controls and the ten-run grouping.
- Two Chrome probes of about a minute each. The timed one ran under the exclusive lock at load 2.5.
- Three offline counts.
- One commit (8f8262d). It puts the Firefox classing and the cause of Chrome's relayout cost into DESIGN.md, where the text had said "Nobody has found why".
- No new tier 2 chain and no new bench run.

