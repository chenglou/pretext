# Firefox on a canvas element: the maintainer's two conditions, checked (2026-09-19)

On 2026-09-18 the maintainer decided that Firefox measures on an OffscreenCanvas always (CHARTER.md, "Decisions of
2026-09-18", decision 2, with what it cost; research/SYSTEM-UI.md "Firefox" has what a detached `<canvas>` element at the
device font size buys: optical sizing, so `system-ui` and any font with an opsz axis, and two tiny residual classes). On
2026-09-19 they reopened it on two conditions, in their words: "if canvas is truly light and we can make things work in
workers through feature detections then yeah let's just try canvas element for firefox I guess, but only if what I
said is true." Two agents probed the pinned Firefox 156.0 and read the pinned Gecko source, one per condition, and a
second agent then tried to refute each. Nothing was built. Their four reports follow, each condition's second look
first, because it corrects the first.

## What came back, and the orchestrator's reading

Both verdicts are "true with conditions", and the conditions are the finding.

**Is it light?** In time and memory, yes: the same work costs 1.03 to 1.06 times an OffscreenCanvas's at a 1 x 1 canvas,
a call costs the same, and a live context takes less memory. A detached element never restyles or lays out the page's
elements (measured against a connected control, and guarded by `GetComposedDoc()` in the source). But it is not free of
the page:
- A kept element context makes Firefox carry out the page's pending style sheet update inside `measureText`: 0.48 ms
  with 3,000 rules, 2.6 ms with 20,000, after one `insertRule`; 200 inserts alternating with 200 measures cost 104 to
  113 ms on the element and 0.26 ms on an OffscreenCanvas. `ctx.font` pays it on both kinds, so today's contexts made per
  paragraph pay it too; once contexts are kept per font (the profiling phase's first item) the OffscreenCanvas stops
  paying and the element never does. A page that inserts style rules as it renders (CSS-in-JS) is the case it hurts.
- Every live element context is called on every painted frame (36,000 live: +0.43 ms a frame), and freeing them pauses
  the main thread for longer than linearly (56 / 116 / 392 ms at 10,000 / 20,000 / 40,000). Both go away with contexts
  kept per font declaration, which therefore is a precondition, not an option.

**Do workers keep working by feature detection?** A worker has no `document`, so it measures on an OffscreenCanvas, as
everything does today, and the port runs there unchanged (435 of 435 cases equal to the page on the same canvas kind once
every font list ends in a generic family; the 14 that differ without one differ today too, and `detectEnvironment()`
throws in a worker, which is the API phase's to fix). The detection of "this document gives the element the page's
fonts" is the weak part:
- The only test found (`ctx.letterSpacing = '1vw'` is kept only when the canvas's document has a presentation shell)
  reads a Gecko internal, not specified behaviour. It was right in every document kind tried.
- It has to be asked before every measuring call, not once: a kept context changes what it measures when its document
  loses or gains its presentation shell (3,430 au shown, 3,252.5 au hidden for one word).
- With `privacy.resistFingerprinting` the page's `devicePixelRatio` is spoofed, the test still says yes, and the element
  measures wrong on 5 of 5 rows where an OffscreenCanvas is right on 4 of 5.
- Page and worker would predict different lines for fonts with optical sizing (`system-ui`: 8,917 au against 7,761);
  the worker still reports its `optical-size` gap.

**The orchestrator's reading: what the maintainer said is not cleanly true, so the element path is not built.** It is
light in time and memory, but it makes the browser do style work for the page while measuring, which the maintainer's
standing rule forbids, and the detection rests on an unspecified Gecko internal asked at every call, which is the kind
of browser-case patch they have ruled out elsewhere. What it would buy is confined to `system-ui` and variable fonts
with an opsz axis (outside them no line count or break moved when the element was removed), and `system-ui` is
postponed (issue #336). Parked, with what would reopen it: `system-ui` accuracy in Firefox becoming a priority; Mozilla
fixing bug 2020917 (OffscreenCanvas never applies optical sizing), which removes the need; or an application-side
opt-in in the API phase (an application that knows it uses `system-ui` and doesn't insert style rules while it lays
out could hand the library a canvas of its own). The probes are on the branch under `rebuild/probes`
(`ff-element-*`), and their outputs are under `.artifacts/probes/ff-element-20260919/`.

## Condition 1, second look: is a detached canvas element "truly light" in Firefox?

### Verdict

**True, with conditions. The first report's label stands. Its text does not stand as written.**

Three things change:

1. **Its "no flush" claim is too broad.** No element restyle and no layout is forced: that part holds, and I confirmed it again under heavier work. But a canvas element's `measureText` does force the page's pending *style sheet update* (Gecko rebuilding its rule data after a style sheet changed). An OffscreenCanvas's `measureText` does not. The first report said this path "does work only when the page's `@font-face` rules changed". The source and the browser both say otherwise: any style sheet change arms it.
2. **"Prefer contexts kept per font declaration" has to become a hard condition.** With contexts per paragraph, as the port makes them today, the element costs time on every painted frame and its freeing pause grows faster than the count. At the bench's own scale (36,000 live contexts) that is +0.43 ms per frame and a 327 ms stall when they are dropped. The first report measured freeing only at 10,000 and did not find the per-frame cost.
3. **One cost cannot be conditioned away.** With kept contexts, the forced style sheet update is exactly where the element differs from OffscreenCanvas. The maintainer has to accept it or refuse it.

The conditions, complete:

1. The canvas is never connected. (First report. Control replicated: 7.0 ms inside `ctx.font`.)
2. `width = height = 1`. (First report. Replicated: x1.044 to 1.047 of OffscreenCanvas against x1.10 to 1.14 at 300 x 150.)
3. The canvas comes from a document with a pres shell (Gecko's per-document layout object). (First report. Replicated at another page scale.)
4. `devicePixelRatio` read per prepare, contexts keyed by the device-size font string. (First report. Not re-tested beyond one more scale.)
5. **New, hard: a small, bounded number of live element contexts.** Per font declaration and recipe setting, never per paragraph.
6. **New, a cost to accept: the first `measureText` after any style sheet change by the page runs that page's style sheet update.** 0.2 to 2.6 ms each on my pages. It moves work the page would do at its next flush. It multiplies when an app alternates style sheet changes and measuring.

Everything else I attacked held.

### How to read the numbers

- Browser: pinned Firefox 156.0, background windows, launched by the probe runner, DPR 2, frames at 120 per second.
- Timer: `privacy.reduceTimerPrecision: false`, 20 us steps (measured). Short calls are read as 0.00 or 0.02 ms.
- Every timing job ran under the exclusive lock, each under 3 minutes.
- **Load (1 min average, from `uptime` before each job).** First runs: r-c5 2.3, K1 3.3, K5 3.4, K3 element 3.5, K3 OffscreenCanvas 2.1, K3 control 1.6, K4 1.8, K2 1.8, K6 1.8, K1b 5.9, r-c4-mix 6.0, r-c4-latin 6.5, r-c3 6.0, r-c1 5.6, r-c9 5.5. Second runs: K1 39.6, K3 element 47.8, K4 55.1. The page's fixed arithmetic loop took 122 to 132 ms in the first runs and 213 to 218 ms in the second runs, so the second runs' pages ran about 1.7 times slower. I report them apart.
- Kinds: `offscreen` is `new OffscreenCanvas(1, 1)`. `element1` is a detached canvas with width = height = 1. `element` is the default 300 x 150. The element measures at CSS size x devicePixelRatio, the OffscreenCanvas at the CSS size.

### 1. Source check

#### Citations that hold (pinned Gecko 156.0)

I read each of these myself.

- `GetFontStyleForServo` calls `nsComputedDOMStyle::GetComputedStyle(aElement)`: `dom/canvas/CanvasRenderingContext2D.cpp:2854-2856`. `DrawOrMeasureText` calls it on the canvas: `:5120-5123`.
- The style flush is guarded by `GetComposedDoc()`: `layout/style/nsComputedDOMStyle.cpp:484-491`. A detached element gets no style: `dom/base/nsContentUtils.cpp:5359-5365`, `nsComputedDOMStyle.cpp:549-561`, then the `10px sans-serif` parent at `CanvasRenderingContext2D.cpp:2862-2870`.
- `ResolveForDeclarations`, "No need to update the stylist": `layout/style/ServoStyleSet.cpp:1370-1377`.
- `GetPresShell` is the owner document's: `:2086-2094`. Size 0 becomes 1: `:2097-2112`. The wrapper reports width x height x 4 bytes: `:2114-2120`, `:7529-7543`.
- The filter flush, the only explicit layout flush: `:3262`.
- Measuring returns at `:5330-5352`, before `EnsureTarget` at `:5365`.
- `GetAppUnitsValues`: `:7132-7155`. `ResolveFontLang` takes an explicit `ctx.lang` first: `:5423-5430`. No pres shell means the OffscreenCanvas path: `:4221-4224`.
- Font cache: 128 entries, a fingerprinting report after more than 10 family lists missed within 6 s: `gfx/src/nsFontCache.h:53-60`, `nsFontCache.cpp:58-114`, `:116-179`. `Document::RecordFontFingerprinting`: `dom/base/Document.cpp:18431-18442`.
- Observer service topics: `dom/html/HTMLCanvasElement.cpp:459-462`, `:476-479`, `:570-574`.
- App units under zoom: `gfx/src/nsDeviceContext.cpp:52-63`, `:410-415`. Text zoom: `servo/components/style/values/specified/font.rs:929-931`, `values/computed/mod.rs:537-547`.

Small slips in the first report, none changing a conclusion: the "a target won't be needed when measuring" comment is at `:5221-5223`, not `:5205-5208`. The minimum font size comment starts at `:4249`. The length parse is at `:3103-3104`.

#### Path 1 it misread: the style sheet update

- Any change to an applicable style sheet marks the document's font set dirty: `Document::ApplicableStylesChanged` calls `MarkUserFontSetDirty()`, `dom/base/Document.cpp:8072-8080`. Its callers include a sheet added or removed (`:8060-8065`, `:8101-8105`) and `RuleAdded`, `RuleRemoved`, `RuleChanged` (`:8994-9021`). `document.fonts.add` and `delete` mark it too: `layout/style/FontFaceSetImpl.cpp:281`, `:300`, `:326`.
- `Document::FlushUserFontSet` then calls `AppendFontFaceRules` (`Document.cpp:18877-18890`), which calls `UpdateStylistIfNeeded()` (`layout/style/ServoStyleSet.cpp:1335-1340`). That runs `Servo_StyleSet_FlushStyleSheets` with the root element (`:1379-1400`), which rebuilds the rule data (`servo/components/style/stylist.rs:1055-1078`).
- The element path calls `FlushUserFontSet` in `ctx.font` (`CanvasRenderingContext2D.cpp:4343`) **and in every `measureText`** (`:5161-5164`).
- The OffscreenCanvas path calls it only in `ctx.font` (`:4446-4448`). Its `measureText` has no pres shell (`:5105-5106`, `:2086-2094`), so the block at `:5161` is skipped.

#### Path 2 it did not read: the refresh driver

- `SetCanvasElement` calls `AddPostRefreshObserverIfNecessary()`: `dom/canvas/nsICanvasRenderingContextInternal.h:73-77`. That registers the context with the document's refresh driver whenever `GetPresShell()` answers, connected or not: `nsICanvasRenderingContextInternal.cpp:183-190`. `HTMLCanvasElement::CreateContext` calls it for every context: `HTMLCanvasElement.cpp:576`.
- Every refresh driver tick calls every such observer's `DidRefresh()`: `layout/base/nsRefreshDriver.cpp:2595-2598`. For a 2D context it is empty (`CanvasRenderingContext2D.cpp:1555`), but it is a virtual call on a cold object per live context per frame.
- Leaving the list is a search of an array and a removal: `nsRefreshDriver.cpp:1566-1571`.
- An OffscreenCanvas's context has no pres shell and never joins.
- These observers do not keep the refresh driver running: `HasObservers`, `:1861-1869`. The cost exists only on frames the page paints anyway.

#### Other paths I looked for and found clean

- Live contexts are skipped by the cycle collector on both kinds while script holds them: `CanvasRenderingContext2D.cpp:1068-1087`.
- `GetCompositorBackendType` reads the widget, not layout: `HTMLCanvasElement.cpp:1555-1565`.
- Both kinds register with `CanvasShutdownManager`: `:1382-1400`.
- `ctx.font` on the element has no "same string" shortcut. It has a per-context cache keyed by the font string, the language and the page's restyle generation: `:4229-4240`. It costs microseconds.
- No image or WebGL difference applies to a 2D context that only measures.

#### From today's mozilla-central, NOT the pinned checkout

The sparse checkout has no `toolkit/components` and no `xpcom`. I read the current files from the mozilla-firefox GitHub mirror instead.

- `nsRFPService::MaybeReportFontFingerprinter` logs and calls `ContentBlockingNotifier::OnEvent(..., STATE_ALLOWED_FONT_FINGERPRINTING, ...)`. It blocks nothing and changes nothing for the page. This answers the first report's open point 1, for today's tree only.
- `nsObserverList::RemoveObserver` goes through `nsMaybeWeakPtrArray::RemoveWeakElement`, a linear `RemoveElement`. That supports the first report's guess about the freeing stall, again for today's tree only.

### 2. Its probes once more, fresh Firefox, load 2.3 to 6.5

| Probe | First report | My rerun |
|---|---|---|
| C5, style dirty, offsetWidth alone | 44.7 / 43.9 ms | 43.3 ms |
| C5, detached element: ctx.font, measureText, read after | 0.04, 0.06, 43.9 | 0.02, 0.06, 41.4 |
| C5, connected control: ctx.font, read after | 7.0, 35.2 | 7.0, 35.2 |
| C5, layout dirty: alone / element after / control | 19.3 / 19.6 / 2.5 then 17.1 | 20.5 / 20.7 / 2.8 then 17.9 |
| C4 mix, median of 3 passes: offscreen, 300 x 150, 1 x 1 | 807, 885 (x1.097), 838 (x1.039) | 831, 914 (x1.100), 867 (x1.044) |
| C4 latin | 422, 479 (x1.136), 441 (x1.046) | 428, 488 (x1.142), 448 (x1.047) |
| C3 first measureText of a context, us | offscreen 3.26, element 1.04 | 1.16, 0.34 |
| C3 steady state, us a call | 1.38 to 1.51, all kinds | 0.51 to 0.56, all kinds |
| C1 making 10,000 with assignments, us each | 7.04, 9.38, 8.81 | 2.55, 3.79, 3.74 |
| C9 longest freeing pause, 10,000, two rounds | offscreen 14.6, 8.5; 1 x 1 34.0, 28.5; 300 x 150 42.4, 40.8 | 11.6, 17.7; 48.0, 46.0; 64.4, 52.6 |
| C7 at another scale | devPixelsPerPx 2.2: element 140 of 140, offscreen 114 | devPixelsPerPx 1.8 (27 becomes 33 app units per device pixel): element 140 of 140, offscreen 117, system-ui 0 of 20 |
| C7 hidden iframe's element against OffscreenCanvas, same string | equal (108.42) | equal (98.42), the page's element 103.91 |

- Every ratio replicates. My absolute microseconds are 2 to 3 times smaller because the machine was quiet.
- C1's element to OffscreenCanvas ratio is larger on a quiet machine: x1.47 against x1.25. That is +1.2 us per context.
- **Memory (M2) did not replicate, and the fault is my run's.** It ran under memory pressure: 6.9 of 8 GiB of swap in use, load 75. The content process's resident size fell while the contexts were still alive (OffscreenCanvas 291 MiB down to 214 MiB within 3 s), so the settled marks are unusable. The sample right after making 10,000 agrees with the first report: +115 MiB OffscreenCanvas (its +132 to 143), +67 MiB element 1 x 1 (its +75). I take its memory numbers as standing. One run a kind.

### 3. Attacks

Probes: `gecko-element-cost-check.ts`, K1 to K6.

#### K1, K1b: a style sheet change, then a canvas call. REFUTES "no flush" in part.

Page: 30,000 blocks and a 3,000 rule style sheet. One `insertRule` of a rule that matches nothing, then the canvas call, then an `offsetWidth` read. Medians of 7, ms, with min to max. Load 3.3.

| After the insert | First canvas call | Read after |
|---|---|---|
| no canvas call | | 0.50 (0.48-0.62) |
| kept element, `measureText` | **0.48 (0.46-0.50)** | **0.00** |
| kept OffscreenCanvas, `measureText` | 0.00 (0.00-0.02) | 0.52 (0.48-0.60) |
| kept element, `ctx.font` | 0.50 (0.48-0.54) | 0.00 |
| kept OffscreenCanvas, `ctx.font` | 0.48 (0.48-0.50) | 0.00 |

- The work moves into the element's `measureText`, and the later read gets cheaper by the same amount. That is the same signature the first report's connected-canvas control used as proof of a flush.
- A `<style>` element appended: 0.18 ms, the same pattern.
- A rule that matches every block: the canvas call takes 0.58 ms and the read after still pays the 5.2 ms restyle. So **no element restyle is forced**, only the style sheet update.
- **200 inserts, a `measureText` on a kept context after each, 3 rounds:** element 103.9, 109.1, 113.3 ms. OffscreenCanvas 0.26 ms each round. Inserts alone 0.14 ms plus one 0.56 ms read after.
- Second run at load 40: element 1.14 ms against 0.02, and 253 to 277 ms against 0.6 ms.
- **What it grows with (K1b, medians of 9, load 5.9).** The element's `measureText` after one insert:

| Blocks | 0 rules | 3,000 rules | 20,000 rules |
|---|---|---|---|
| 1,000 | 0.02 ms | 0.32 ms | 2.40 ms |
| 30,000 | 0.20 ms | 0.52 ms | 2.60 ms |

  It grows with the page's CSS and a little with the DOM. OffscreenCanvas `measureText` reads 0.00 in all six.
- Fair framing: `ctx.font` forces the same update on both kinds. Today's port sets `ctx.font` on fresh contexts in every prepare, so today's main-thread OffscreenCanvas path already does this once per prepare after a sheet change. The element is worse only against kept OffscreenCanvas contexts. Kept contexts are the design condition 5 demands, so that is the comparison that counts.
- Who meets it: any app that changes style sheets at run time and measures in between. CSS-in-JS libraries that call `insertRule` while components render are the common case.

#### K3: 36,000 live contexts. REFUTES "light" for contexts per paragraph.

36,000 is 10,000 kept messages at 3.6 contexts each. One kind per browser process. Load 1.6 to 3.5.

**What a frame costs.** Measured as the time from the end of a `requestAnimationFrame` callback that moves one small box to a message task posted from it. The task runs when the tick is over. Median of about 297 frames.

| | before | 36,000 live | after the drop |
|---|---|---|---|
| element 1 x 1 | 0.22 ms | **0.66 ms** | 0.22 ms |
| OffscreenCanvas | 0.22 | 0.22 | 0.24 |
| control, plain objects | 0.20 | 0.24 | 0.24 |

- +0.43 ms per painted frame, about 12 ns per live element context. At 120 frames a second that is 5% of the frame, paid while scrolling, for nothing. Second run at load 48: 0.24, 0.56, 0.24.
- It is linear, so 50 kept contexts cost about 1 us a frame.
- Making the 36,000: element 183 ms, OffscreenCanvas 167 ms (x1.10).
- Live contexts across collections: the longest pause over two garbage watches with everything alive was 10.1 ms on the element, 11.0 on OffscreenCanvas, 11.2 on the control. **No collector cost for live contexts. That attack failed.**
- Dropping the 36,000: element pauses of **327 ms and 147 ms** (485 ms paused in all). OffscreenCanvas 47 ms and 14 ms (80 ms in all). Control 7 ms. Second run at load 48: 732 ms and 290 ms on the element.

#### K4: the freeing pause at three counts. REFUTES "28 to 42 ms".

One process, one round a row, garbage with 32 MiB buffers as in C9. Longest pause, ms. "+" is the second longest pause where it was over 20 ms.

| Dropped | element 1 x 1, load 1.8 | OffscreenCanvas, load 1.8 | element 1 x 1, load 55 | OffscreenCanvas, load 55 |
|---|---|---|---|---|
| 10,000 | 56 | 10 | 46 | 10 |
| 20,000 | 116 + 21 | 8 | 247 + 86 | 41 |
| 40,000 | **392 + 105** | 38 | 963 + 859 | 135 |

- Control, 40,000 plain objects: 9 ms and 5 ms.
- On the quiet run, doubling the count multiplies the element's pause by 2.1, then by 3.4. It grows faster than the count.
- I did not isolate the cause. The source gives two lists an element context must leave one by one with a linear removal: the refresh driver's post-refresh list and the observer service's two topics. OffscreenCanvas is on neither.

#### K5: the bench's shape of work on a dirty page. HOLDS.

300 messages: 1,080 contexts made and dropped, 33,013 `measureText` calls, new sizes each turn so nothing is cached. 5 turns a kind, kinds taking turns. Load 3.4.

| Page | offscreen work | element work | read after: alone, offscreen, element |
|---|---|---|---|
| clean | 31.5 ms | 31.6 ms | 0, 0, 0 |
| style dirty | 28.9 | 30.1 (x1.04) | 43.7, 42.9, 42.9 |
| layout dirty | 28.9 | 29.7 (x1.03) | 19.7, 19.7, 19.8 |

The read after still pays the whole flush. A thousand contexts and 33,000 calls force no restyle and no layout on either kind.

#### K2: many font declarations taking turns. HOLDS.

8 families x 2 weights x 2 styles x 32 sizes. 8,192 fresh contexts a run, 5 runs, kinds taking turns. Each context is made, assigned and measured once. us per context, load 1.8.

| Declarations | offscreen | element 1 x 1 | element's first measure |
|---|---|---|---|
| 1 | 3.23 | 3.96 (x1.23) | 0.34 |
| 100 | 3.26 | 3.88 (x1.19) | 0.32 |
| 128 | 3.21 | 4.09 (x1.27) | 0.33 |
| 129 | 3.81 | 4.88 (x1.28) | 0.84 |
| 1,024 | 3.54 | 4.92 (x1.39) | 0.90 |

- Past 128 declarations the element overflows the page's 128-entry font cache. It loses its cheaper first measure (0.33 becomes 0.84 to 0.90 us, OffscreenCanvas's own 0.8 to 0.9). That is about +1 us per context. No cliff.
- Kept contexts, one per declaration, measured in turn: 0.24, 0.25 and 0.53 us a call at 1, 128 and 1,024 declarations, equal on both kinds.
- I kept to 8 families, under the 10 that trip the fingerprinting report, so the report itself was not exercised.

#### K6: the first measure after a web font loads. HOLDS.

1,000 kept contexts naming a `FontFace` that was not loaded. Load 1.8, one run.

- First pass while pending: OffscreenCanvas 2.34 us each, element 1.44. The load starts at that measure on both.
- First pass right after `face.loaded`: OffscreenCanvas 2.06 us, element 2.70 us.
- Later passes: 0.46 to 0.52 on both. Both took the face.

#### Not run

- A page under full zoom. The runner cannot set it and no pref does. Two other page scales, 2.2 and 1.8 device pixels per px, give the element 140 of 140 against the DOM.
- Text zoom in a browser, a truly hidden tab, a forced collection. As in the first report.

### What I could not find out

1. Which of the two lists makes the freeing pause, and whether the pinned build's observer list is the one I read from today's tree.
2. What the fingerprinting report does in the pinned 156.0 build. Today's tree only logs a content blocking event.
3. How often real apps change style sheets between measures. I measured the mechanism and its price, not its frequency.
4. The per-frame cost comes from an indirect reading (the delay of a message task after the frame callback), not from a profiler. The OffscreenCanvas and plain-object controls and the source path agree with it.
5. Memory under a quiet machine, a second time.

### What the library change would have to do because of this

- **Land kept contexts first.** One context per font declaration and recipe setting, shared across paragraphs, bounded. With contexts per paragraph the element path is not light. With dozens of contexts the per-frame cost is about a microsecond, nothing is ever freed in bulk, and the x1.2 to 1.4 cost per fresh context stops mattering.
- **Decide on the forced style sheet update before building.** On the element, the first `measureText` after any style sheet change by the page runs that page's style sheet update inside the library's call. The library cannot avoid it. A kept OffscreenCanvas context never does it. If the rule "must not force style while measuring" covers this, the element path fails it. If the rule means element restyle and layout, the element passes.
- If accepted, say so for app developers: finish style sheet changes before a batch of prepares, never alternate.
- Keep the first report's four: never connect, `width = height = 1`, a document with a pres shell (decide what to do without one), `devicePixelRatio` per prepare and contexts keyed by the device-size font string.
- A chat in one font family is one key for the fingerprinting report. A page measuring in more than 10 family lists within 6 s on the element path gets a content blocking log entry, by today's tree.

### Files

- Probes: `/Users/chenglou/github/pretext-rebuild-wt/ff-el-cost/rebuild/probes/gecko-element-cost-check.ts` (K1, K1b, K2 to K6). Entry added to `/Users/chenglou/github/pretext-rebuild-wt/ff-el-cost/rebuild/probes/README.md`.
- Outputs: `/Users/chenglou/github/pretext-rebuild/.artifacts/probes/ff-element-20260919/cost-check/`. One folder and one `.log` per run, with `uptime` before and after:
  - my probes: `k1`, `k1-b`, `k1b`, `k2`, `k3-element1`, `k3-element1-b`, `k3-offscreen`, `k3-none`, `k4`, `k4-b`, `k5`, `k6`;
  - reruns of the first agent's: `r-c1`, `r-c3`, `r-c4-mix`, `r-c4-latin`, `r-c5`, `r-c7-dpr18`, `r-c9`, `rss2-element-1x1`, `rss2-offscreen`;
  - `timed.sh`, `chain1.sh` to `chain4.sh` with their `.status` files, `read.py`, `rss2-read.py`, `prefs.json`, `prefs-dpr18.json`.

## Condition 1: is a detached canvas element "truly light" in Firefox?

### Verdict

**True, with conditions.** A detached `document.createElement('canvas')` with a 2D context never flushes the page's style or layout, costs about the same time as `new OffscreenCanvas(1, 1)` on the chat bench's shape of work, and costs less memory per live context.

The conditions:

1. **The canvas is never connected to the document.** A connected one flushes style. Proven below with a control.
2. **Set `width = height = 1` (0 behaves the same).** At the default 300 x 150 the work costs 7 to 9 points more time, and 10,000 dropped contexts keep about 65 MiB that the 1 x 1 canvas mostly gives back.
3. **The canvas comes from a document that has a pres shell** (Gecko's per-document layout object). The page's own `document` has one. A `display: none` iframe's document does not, and the element then silently measures like an OffscreenCanvas.
4. **The library keeps reading `devicePixelRatio` per prepare and keys contexts by the device-size font string.** It already does both on the x-sysui experiment.

One cost is worse on the element: freeing 10,000 dead contexts stalls the main thread once for 28 to 42 ms, against 15 ms or less for OffscreenCanvas. It exists only while contexts are made per paragraph and thrown away.

Three things I could not find out are listed at the end.

This covers condition 1 only. I did not look at workers.

### How to read the numbers

- Browser: the pinned Firefox 156.0, background windows, launched by the probe runner, DPR 2 unless said.
- Timer: `privacy.reduceTimerPrecision: false` gives `performance.now()` steps of 20 us, measured. So single calls are not timed; batches are.
- **Load.** The machine has 18 cores. Other agents' non-browser jobs ran all afternoon, and the exclusive lock cannot stop those. Load average (1 min) before each timing run: C1 57, C2 69, C3 65, C4 interleaved 31 / 26 / 23 / 19, C5 11 and 48, C8 154, C9 2.0. A fixed arithmetic loop in the page took 124 to 239 ms across runs, so a page ran up to 1.8 times slower in the busy runs.
- Because of that I rely on comparisons inside one page (kinds taking turns, or before and after), not on absolute microseconds. C9 and the first C5 run are the clean ones.
- Kinds: `offscreen` is `new OffscreenCanvas(1, 1)`. `element` is the detached canvas at its default 300 x 150. `element1` and `element0` set width = height = 1 and 0 first. The element measures at the device font size (CSS size x devicePixelRatio), the OffscreenCanvas at the CSS size, as the two paths of commit 872c0da did.

### (c) The rule that matters most: no style or layout flush

#### Source (pinned Gecko 156.0)

- `ctx.font` reaches `GetFontStyleForServo`, which calls `nsComputedDOMStyle::GetComputedStyle(aElement)` for the parent style: `dom/canvas/CanvasRenderingContext2D.cpp:2854-2856`.
- `measureText` reaches `DrawOrMeasureText`, which calls the same function on the canvas element: `:5120-5123`.
- That function flushes only for an element in a document: `if (Document* doc = aElement->GetComposedDoc()) doc->FlushPendingNotifications(FlushType::Style);` at `layout/style/nsComputedDOMStyle.cpp:484-491`. A detached element has no composed document, so nothing is flushed.
- It then returns no style at all for a detached element: `nsContentUtils::GetPresShellForContent` returns null without a composed document (`dom/base/nsContentUtils.cpp:5359-5365`), and `DoGetComputedStyleNoFlush` returns null (`nsComputedDOMStyle.cpp:549-561`). The font then resolves against a fixed `10px sans-serif` parent: `CanvasRenderingContext2D.cpp:2862-2870`.
- `ServoStyleSet::ResolveForDeclarations` says "No need to update the stylist": `layout/style/ServoStyleSet.cpp:1370-1377`.
- The pres shell is the owner document's, connected or not: `GetPresShell`, `CanvasRenderingContext2D.cpp:2086-2094`.
- Both kinds call `FlushUserFontSet` (`:4343` and `:4447`; `:5163` for the element at measure time). It does work only when the page's `@font-face` rules changed: `dom/base/Document.cpp:18877-18911`. It is not a restyle of elements, and it is common to both kinds.
- The only explicit layout flush in the file is for filters: `FlushPendingNotifications(FlushType::Frames)` at `:3262`. The port never sets `ctx.filter`.
- `letterSpacing` in px parses without a style context (`:3100-3103`). `lang`, `fontKerning`, `textRendering`, `direction` store a value.

#### Proof in the browser (probe C5)

A page of 30,000 styled blocks. Dirty the style (a class that restyles every block) or the layout (a width). Then time `ctx.font = <new string>` and `measureText(<new text>)`, then time an `offsetWidth` read. Two runs, 7 repetitions each, medians in ms (run 1 / run 2):

| Page state | Surface | ctx.font | measureText | offsetWidth read after |
|---|---|---|---|---|
| style dirty | no canvas call | | | 44.74 / 43.94 |
| style dirty | detached element | 0.04 / 0.04 | 0.06 / 0.04 | 43.88 / 42.54 |
| style dirty | detached element, 1 x 1 | 0.02 / 0.02 | 0.02 / 0.02 | 43.16 / 42.28 |
| style dirty | OffscreenCanvas | 0.02 / 0.02 | 0.02 / 0.02 | 42.82 / 43.14 |
| style dirty | **connected element (control)** | **7.00 / 6.88** | 0.06 / 0.06 | **35.24 / 35.42** |
| style dirty | detached element, all seven assignments | 0.04 / 0.04 | | 43.38 / 42.20 |
| layout dirty | no canvas call | | | 19.30 / 19.46 |
| layout dirty | detached element | 0.02 / 0.02 | 0.02 / 0.02 | 19.60 / 19.22 |
| layout dirty | OffscreenCanvas | 0.00 / 0.00 | 0.02 / 0.02 | 19.36 / 19.48 |
| layout dirty | **connected element (control)** | **2.48 / 2.72** | 0.02 / 0.02 | **17.12 / 16.94** |

The detached element's calls stay at hundredths of a millisecond and the read after them still pays the whole flush. The control shows the probe can see a flush: the connected canvas pays it inside `ctx.font` and the later read gets cheaper by the same amount.

One limit of the control: `ctx.font` ran first and had already flushed, so `measureText` had nothing left to flush. The source says both flush on a connected canvas. The probe shows the first.

#### Web fonts (probe C6, one run)

- A `FontFace` added to `document.fonts` and never loaded: on both kinds the load starts at the first `measureText` (status `unloaded` after the assignments, `loading` after the measure), not at `ctx.font`. Neither blocks: 0.20 ms (OffscreenCanvas), 0.02 ms (element). Both return the fallback's width while it loads, and both take the font on the same context once it has loaded.
- The two kinds differ when the page's font set changes later, and the element is the better one. A context whose font named a family that did not exist yet: the element's old context takes the face once it is added (262.8 where Arial gave 241.9). The OffscreenCanvas's old context stays on Arial (120.97) until `ctx.font` is set again. After `document.fonts.delete`, the element goes back to the fallback and the OffscreenCanvas keeps the deleted font.
- This matters for contexts kept per font declaration: on OffscreenCanvas they go stale when fonts change, on the element they follow the page.

### (a) Time

#### Making a canvas and a context (C1, one run; us each = median run time / N)

| | N = 1,000 (9 runs) | N = 10,000 (5 runs) | N = 10,000, min-max ms |
|---|---|---|---|
| offscreen, bare | 1.42 | 1.40 | 13.5 - 17.9 |
| element 300 x 150, bare | 3.70 | 4.03 | 27.8 - 78.1 |
| element 1 x 1, bare | 1.92 | 2.02 | 18.5 - 31.7 |
| element 0 x 0, bare | 2.02 | 2.04 | 18.1 - 22.9 |
| offscreen, with the port's seven assignments | 5.98 | 7.04 | 64.2 - 108.3 |
| element 300 x 150, with them | 9.24 | 9.38 | 90.4 - 109.7 |
| element 1 x 1, with them | 8.72 | 8.81 | 83.7 - 90.5 |

- N = 1, 10, 100 (51 runs each) read 0 to 2 us each: below the timer's step. No startup cost shows at small N.
- The element needs no size to work. 0 and 1 behave the same (Gecko turns 0 into 1: `:2097-2112`). The default size is slower and much more spread out. The likely reason is in the source: a context's wrapper reports width x height x 4 bytes to the garbage collector, 180,000 for the default and 4 for 1 x 1 (`:2114-2120`, `:7529-7543`), whether or not a buffer exists. I did not test that this is the cause.
- `willReadFrequently`: no effect beyond noise when making contexts. In the source it is read only when a drawing target is made (`:7167`), which measuring never does.

#### Each assignment (C2, 2,000 fresh contexts, 5 runs, median us each)

Only `font` differs: 4.59 (offscreen) against 6.27 / 6.63 / 6.40 (the three element kinds). `lang` 0.3, `letterSpacing` 0.4-0.5, `wordSpacing` 0.2, `fontKerning`, `textRendering` and `direction` under 0.15, on every kind. The same font string again: 0.65 against 1.0. A new size: 3.5 against 6.0-6.8.

#### First measureText and the steady state (C3)

- First `measureText` of a fresh context, the same word, 2,000 contexts, 5 runs: offscreen 3.26 us (2.70-3.91), element 1.04 (0.92-1.40), 1 x 1 0.97. The element is about three times cheaper. Source: the OffscreenCanvas path makes its own font group per context (`:4589`); the element takes shared font metrics from the page's font cache (`:4353`; 128 entries, `gfx/src/nsFontCache.h:53`, `nsFontCache.cpp:73-87`).
- Steady state, one context over the 4,828 distinct words of the chat bench's first 1,000 messages, passes 2 to 6: offscreen at 16px 1.47 us a call, element at 32px 1.51, element 1 x 1 1.46, offscreen at 32px 1.38, element at 16px 1.50. The kind and the device size change nothing.
- First pass (shaping): 4.61, 4.34, 4.14, 3.73, 3.70 us a word, in the same order. Same.

#### The bench's shape, 10,000 messages (C4)

An emulation, not the library. Per message it makes, assigns and drops 3.6 contexts (mix) or 2.9 (latin) and makes 115.8 or 85.5 `measureText` calls on strings cut from the message. Those are the counts research/BENCH-NIGHT.md gives for Firefox (120 and 82 calls). Messages come from `rebuild/bench/cases.ts buildChat`. Kinds take turns every 500 messages, so a change of load falls on all alike. Median of 3 passes, two browser runs each:

| | offscreen | element 300 x 150 | element 1 x 1 |
|---|---|---|---|
| mix, run a | 807 ms | 885 ms (x1.097) | 838 ms (x1.039) |
| mix, run b | 880 ms | 968 ms (x1.100) | 909 ms (x1.032) |
| latin, run a | 422 ms | 479 ms (x1.136) | 441 ms (x1.046) |
| latin, run b | 418 ms | 475 ms (x1.136) | 442 ms (x1.057) |

- All of the difference is in making contexts: mix run a, 105 ms (offscreen), 180 (element), 150 (1 x 1). Measuring is equal.
- Rough placement only: BENCH-NIGHT's whole Firefox bench is 2.63 s (mix) and 0.61 s (latin), because 37% of its time is outside Canvas. Against those, the 1 x 1 element adds about 30 ms (about 1%) on the mix and about 20 ms (3 to 4%) on plain ASCII. That divides today's emulation by another day's bench under another load, so it is not a measurement of the bench.
- If contexts are kept per font declaration (PROFILING-START.md item 1), a page makes a handful and this difference disappears.
- An earlier, sequential version of C4 was confounded by load falling during the run (the page's arithmetic loop went from 237 to 153 ms). Its files are kept as `c4-*-sequential`. I did not use them.

### (b) Memory

Resident size of the page's content process from `ps` (rss) every 250 ms, joined to `Date.now()` marks the page records. One kind per fresh browser process. rss leaves out compressed and swapped pages.

#### Live contexts (probe M, 3 runs a kind; M2 adds 2 more that agree)

| | 1,000 live | 10,000 live | each |
|---|---|---|---|
| OffscreenCanvas | +14.0, +14.1, +16.0 MiB | +131.7, +132.3, +137.1 MiB | 13.5 - 14.0 KiB |
| element 300 x 150 | +8.9, +10.6, +11.2 | +74.4, +74.5, +77.2 | 7.6 - 7.9 KiB |
| element 1 x 1 | +8.2, +8.3, +8.6 | +75.4, +75.6, +77.1 | 7.7 - 7.9 KiB |

- A live element context costs a bit over half of an OffscreenCanvas one.
- No backing store is ever made when only measuring. Source: `DrawOrMeasureText` returns the metrics at `:5331-5352`, before `EnsureTarget` at `:5365`, and the comment at `:5205-5208` says so. The numbers agree: 7.7 KiB each, where a 300 x 150 buffer would be 176 KiB.
- Today 10,000 kept messages hold about 36,000 contexts: about 270 MiB on the element against about 480 MiB on OffscreenCanvas, by multiplication. Both argue for contexts per declaration, whichever kind.

#### Giving memory back

- No page can ask Firefox for a collection, and the runner cannot either. It uses WebDriver BiDi with no privileged context.
- Probe M (garbage of short arrays, 15 s wait): 8 of 9 runs gave nothing back. One default-size run came back to 4.8 MiB below its start. So M cannot rank the kinds.
- Probe M2 puts 32 MiB ArrayBuffers in the garbage, which brings a collection on, and waits 40 s. 2 runs a kind, plus 1 control run that makes no canvas. MiB above the start:

| | 10,000 live | right after the garbage | 40 s later |
|---|---|---|---|
| control, no canvas (1 run) | +1.6 | +39.7 | +38.8 |
| OffscreenCanvas | +143.4, +131.8 | +44.6, +45.6 | +44.8, +45.7 |
| element 1 x 1 | +76.4, +75.5 | +51.1, +50.3 | +50.2, +50.3 |
| element 300 x 150 | +74.7, +75.0 | **+103.6, +105.6** | +102.8, +105.5 |

- The control says about 39 MiB of what stays is the garbage rounds' own footprint. As an estimate (one control run; I assume the two footprints add), 10,000 dropped contexts leave about 6 MiB on OffscreenCanvas, about 11 MiB on the 1 x 1 element, and about 65 MiB on the default-size element.
- The default-size element went up after the drop and stayed up, in both runs. **I did not find out why.** I had guessed the opposite, that the 180,000 reported bytes would make it collect sooner, and one M run seemed to agree. M2 says no, twice. I did not read the collector's source for this.

#### Freeing pauses (probes C8 and C9)

- A context and its canvas hold each other (`mCanvasElement`, `mCurrentContext`), so only the cycle collector frees them, on both kinds. A canvas element with a 2D context also joins the observer service for two topics and leaves it when freed: `dom/html/HTMLCanvasElement.cpp:459-462`, `:476-479`, `:570-574`.
- **C8 is a null result that does not mean "free".** It saw no pause of 10 ms or more in any row, the control included. It watched after its garbage, and M2 later showed the dead contexts go during garbage that holds buffers. C8 most likely saw no freeing at all. It also ran at load 154.
- C9 keeps a 5 ms timer chain running across garbage with buffers. A wait of 10 ms or more between ticks is a pause. 10,000 dropped contexts, 2 rounds a kind, load 2.0. Longest pause per round: control 9.0 ms and none; OffscreenCanvas 14.6 and 8.5 ms; element 1 x 1 34.0 and 28.5 ms; element 300 x 150 42.4 and 40.8 ms.
- So freeing 10,000 dead element contexts stalls the main thread once for 28 to 42 ms, 2 to 3 times the OffscreenCanvas's. Two rounds a kind. The cause is a guess: the observer list's code is not in the pinned checkout, which is sparse (dom, gfx, intl, js, layout, servo).

### (d) What else the element reads from the page

- **devicePixelRatio and full zoom.** The element reads the page's scale when `ctx.font` is set (`CSSToDevPixelScale`, `:4263-4264`) and its app units per device pixel (Gecko's layout unit, 60 per CSS px at scale 1) at every measure (`GetAppUnitsValues`, `:7132-7155`). Probe C7, 20 words x 7 fonts, one run each:
  - At DPR 2: the element at the device size equals the DOM's width in app units on 140 of 140; OffscreenCanvas on 119 of 140 (system-ui 0 of 20, one miss of 1 app unit elsewhere).
  - At `layout.css.devPixelsPerPx: "2.2"` (devicePixelRatio 2.2222, 27 app units per device pixel): element 140 of 140; OffscreenCanvas 114 of 140, within 1 app unit on all 120 outside system-ui.
  - From source, a 110% full zoom on a Retina screen gives the same 27: `max(1, round(30 / 1.1))`, `gfx/src/nsDeviceContext.cpp:57-63`, `:410-415`. The runner cannot set full zoom, so the zoom itself was not run.
  - A context made before a zoom change keeps its old font group. The device-size font string changes with the scale, so keying contexts by their settings already gives a new context.
- **Minimum font size.** Deliberately ignored on the element path (`:4253-4259`). Not applied on OffscreenCanvas either. Both then miss the DOM alike.
- **Text zoom (zoom text only). From source, partly, and not run.** The element's font size goes through the style system, where an absolute length is scaled by the page's text zoom: `servo/components/style/values/specified/font.rs:929-931`, `values/computed/mod.rs:537-547`. The device's `zoom_text` is not in the checkout. The OffscreenCanvas path parses the shorthand without a style context (`:4480-4491`). So the element would follow the DOM under text zoom and the OffscreenCanvas would not. One thing to check if it matters: the port's large-size recipe (the size times 2^k under 2000px) could pass gfxFont's 2000px clamp under a large text zoom.
- **Language.** An explicit `ctx.lang` wins before anything is read from the element or the document: `ResolveFontLang`, `:5425-5430`. The port always sets it.
- **Visibility.** Every run was in a background, unfocused window: `hasFocus` false, `visibilityState` "visible". The runner cannot make a hidden tab, so that was not run. From source, the pres shell is the owner document's and a background tab keeps it. A document without one takes the OffscreenCanvas path silently (`:4221-4224`). C7 confirms it: an element from a `display: none` iframe's document measures 108.42px, equal to the OffscreenCanvas at the same string, where the page's element gives 114.33px.

### What I could not find out

1. **What a font-fingerprinting report does to a page.** The element path goes through the page's font cache, where more than 10 distinct family lists missed within 6 seconds report the document as a probable font fingerprinter: `gfx/src/nsFontCache.cpp:91`, `:116-179`, `nsFontCache.h:55-60`, `Document.cpp:18431-18442`. The key is the family names, not the size, so a chat in one font is one key. DOM layout goes through the same cache, so a page with many fonts already meets it. OffscreenCanvas never touches this cache. What the report then does is in `nsRFPService`, which is not in the checkout.
2. Why the default-size element keeps about 65 MiB after a collection.
3. Text zoom and a truly hidden tab in a browser. Whether a forced collection changes the memory picture.

### What the library change would have to do because of this

- Make the canvas with the page's own `document.createElement('canvas')`, set `width = height = 1`, and never append it.
- Decide what to do when the document has no pres shell. There the element gives OffscreenCanvas numbers silently, with no optical sizing, and nothing throws.
- Keep keying contexts by the device-size font string and read `devicePixelRatio` per prepare.
- Prefer contexts kept per font declaration. That removes the making difference and the 28 to 42 ms freeing stall, and on the element kept contexts follow font changes where OffscreenCanvas ones go stale.
- Before shipping to pages that measure in many font families within a few seconds, find out what the fingerprinting report does.

### Files

- Probes: `/Users/chenglou/github/pretext-rebuild-wt/ff-el-cost/rebuild/probes/gecko-element-cost.ts` (C1 to C9, M, M2) and `/Users/chenglou/github/pretext-rebuild-wt/ff-el-cost/rebuild/probes/gecko-element-cost-rss.ts` (the ps sampler). Entry added to `/Users/chenglou/github/pretext-rebuild-wt/ff-el-cost/rebuild/probes/README.md`.
- Outputs: `/Users/chenglou/github/pretext-rebuild/.artifacts/probes/ff-element-20260919/cost/`. One folder and one `.log` per run (`c1`, `c2`, `c3`, `c4-{mix,latin}-{a,b}`, `c4-*-sequential`, `c5-a`, `c5-b`, `c6`, `c7-dpr2`, `c7-dpr22`, `c8`, `c9`, `rss-*`, `rss2-*`). `prefs.json`, `prefs-dpr22.json`, `timed.sh` (uptime before and after each timing run), `rss-read.py` and `rss2-read.py` (the memory tables, from the raw samples).

## Condition 2, second look: "we can make things work in workers through feature detections"

**Verdict: true with conditions. The first agent's verdict stands.** I tried to refute it and could not. I add six conditions and one correction. Perf-wise the detection costs next to nothing.

Words used below:
- **au**: app unit, 1/60 CSS px.
- **pres shell**: Gecko's presentation shell. A document has one only while it is displayed.
- **the test**: set `ctx.letterSpacing = '1vw'` on a detached canvas element's context and read it back. `1vw` means a pres shell, `0px` means none.
- **device size**: the CSS font size times devicePixelRatio.
- **kept context**: a context whose font was set once and is measured later without setting it again. This is how the library holds contexts in a prepared paragraph.

All runs used the pinned Firefox 156.0 in background windows under the browser lock, at DPR 2 unless said. Outputs are in `~/github/pretext-rebuild/.artifacts/probes/ff-element-20260919/workers-check/`. My probes are `rebuild/probes/ff-element-attacks.ts` (X1 to X7).

### 1. Source citations

I read every cited place in `~/github/browser-engines/firefox-156.0`. All hold:
- `GetPresShell` (CanvasRenderingContext2D.cpp:2086-2094), `ParseSpacing` (:3091-3110), `SetFontInternal` (:4219-4224), the disconnected path (:4423-4448), `GetAppUnitsValues` (:7132-7155), lang (:5436-5468), `GetCurrentFontStyle` (:5483-5523).
- nsComputedDOMStyle.cpp:484-491, ServoStyleSet.cpp:1370-1377, nsFont.cpp:276-279, gfxFont.h:134.
- gfxTextRun.cpp:1881-1891, :1969-1977, :4017-4019; nsGlobalWindowInner.cpp:3781-3806; PresShell.cpp:12003-12031.
- Commit 872c0da does test `typeof document.createElement === 'function'`, and its canvas.ts does hold a NUL byte.

**One citation is imprecise.** "FlushUserFontSet returns at once unless @font-face rules changed."
- It returns at once unless the font set is marked dirty (Document.cpp:18877-18880).
- Any applicable stylesheet change marks it dirty (`ApplicableStylesChanged`, Document.cpp:8073-8080).
- A dirty set reads the font-face rules, which updates the stylist first (Document.cpp:18885-18890, ServoStyleSet.cpp:1335-1340).
- X4 below measures this.

**Paths it didn't read:**
- **Which units need the style system is in the pinned tree.**
  - `servo/components/style/values/specified/length.rs:609-640` handles absolute units and em, ex, ch, cap and ic.
  - vw, rem, lh and cqw return Err without a style context, so the C++ side falls back to the style system.
  - The first agent knew this from the probe only.
- **Font visibility in workers.** OffscreenCanvas.cpp:707-725 inherits it from the pres context on the main thread and from the worker in a worker. The first agent listed this as unverified.
- **Other worker-thread branches in gfx/thebes.**
  - gfxTextRun.cpp:2568 and :4189, and gfxPlatformFontList.cpp:2866-2925, are housekeeping.
  - `GetDefaultGeneric` is the only worker branch that changes a width.
- **How a kept context follows its document.**
  - `GetCurrentFontStyle` drops the font group when its visibility provider (the pres context) is no longer the document's (:5497-5506).
  - It then rebuilds it on whichever path holds at that moment.
- **Every flush site needs a connected element.**
  - The three sites are :2864 (font), :5121-5123 (every measureText) and :3261-3262 (filters).
  - A detached canvas never reaches them.
- **When a subdocument gets and loses its pres shell.**
  - It gets one at viewer Init if there is a parent widget or a container frame (nsDocumentViewer.cpp:735-760), or at Show (:1716-1760).
  - It loses it at Hide (:1780-1816), when the iframe's frame goes (nsSubDocumentFrame.cpp:154, :922).
- **Cycle collection.** OffscreenCanvas is cycle collected too (OffscreenCanvas.cpp:729), so both canvas kinds take part. That cost belongs to condition 1; I did not measure it.

### 2. Its probes again, fresh Firefox

| Probe | Result | Load |
|---|---|---|
| D1 | DOM au 8917, 3118, 786, 5015, 5552; top element canvas the same; OffscreenCanvas 7761, 3119, 793, 5015, 5552; the test right in 21 of 21 rows | 2.5 to 3 |
| D2 | 5 of 5 stages as reported | same |
| D3 | detached canvas, the test and OffscreenCanvas take 0 ms and leave 5 to 6 ms pending; a connected canvas takes 6 ms and leaves 0 | same |
| D4 | the test on a kept context 0.30 to 0.35 µs over 5 rounds; with a new canvas, context and font 3.5 to 5 µs; an element context with one measure 3.5 to 4.5 µs; OffscreenCanvas 2.5 to 3 µs. Not under the exclusive lock | same |
| D5 | the frame's own scale gives the frame's DOM widths on 5 of 5 at zoom 1.5 and 0.8 | same |
| W1 | page twice 0 of 435 differ; 13,158 lines; worker without fixtures 36 differ (22 by fixture); with fixtures the same 14 ids; gap counts equal | 75 (counts only) |
| W2, W4, W5, W3 | the same 14; 909 of 41,487 calls; serif 0 and sans-serif 0 differ, page lines moved 16 and 21; localeUnknown 8 of 12 differ, localeGiven 0 of 12 | same |

Every count reproduced exactly.

### 3. Attacks

**X1, kept contexts across an iframe that goes display:none and back, then is removed (6 stages).**
- The first agent set `ctx.font` again before every measurement. The library doesn't.
- At every stage each kept context measures what a context made at that stage measures.
- The test on a kept context agrees with its widths at every stage.
- One kept 16px system-ui context gives `workers` these widths:
  - 3430 au while shown;
  - 3252.5 au while display:none;
  - 3430 au when shown again.
  - An OffscreenCanvas has 3038 au.
- So a prepared paragraph filled while its document has no pres shell gets a third set of widths. Nothing reports it.
- BENCH-NIGHT.md says 88% of Firefox's time is in the fill, which measures. So asking the test once per prepare is not enough.

**X2, hidden tab and new tab.** `window.open` works in the runner's Firefox.
- The new tab's document right after `window.open` has a pres shell. The element canvas gives the DOM's au on 5 of 5.
- The probe's own tab keeps its pres shell while `visibilityState` is hidden (asked twice, 1.5 s apart) and when visible again.
- The test agrees with the widths in 6 of 6 rows.

**X3, worker kinds.** 217 cases, 124 of them not in the first agent's sample, 5,776 lines a sweep.
- The page against a dedicated worker: 211 of 217 equal.
- A shared worker against the dedicated worker: 217 of 217 equal.
- With every list ending in serif, all three scopes are equal on 217 of 217.
- Gap counts are the same in the three scopes: optical-size 216, in-word-prefix 16, font-fallback 1.
- A shared worker has OffscreenCanvas, FontFace and `self.fonts`. `detectEnvironment()` throws there too.
- A transferred OffscreenCanvas measures like a plain one on 5 of 5, whether detached, connected or sent to the worker. The test says `0px` on it.
- So there is no third canvas kind, and no way to get the page's path in a worker.

**X4, a stylesheet change pending.** 20,000 rules, one `insertRule` before each operation, 3 rounds after a warm-up, 1 ms timer, load 3.
- With nothing done, the flush that follows takes 3 ms.
- Setting a font on a new context takes 2 ms on an OffscreenCanvas and on a detached element alike, and leaves 0 to 1 ms. Both kinds pay the pending stylist update today.
- `measureText` alone on a kept OffscreenCanvas takes 0 ms and leaves 2 ms.
- `measureText` alone on a kept element canvas takes 2 ms and leaves 1 ms. Only the element kind pays at a plain `measureText` (:5161-5165).
- The test alone takes 0 ms and leaves 2 ms.
- This is rule data being rebuilt, not an element restyle. The first agent's "no style flush" holds for restyles.

**X5, more documents.**
- SVG document: `createElement('canvas')` gives an Element in no namespace, without `getContext`. `createElementNS` with the XHTML namespace measures like the DOM, and the test says `1vw`. The first agent's probes always used `createElementNS`, which hid this.
- XHTML and text/plain documents: fine, `1vw`, like the DOM.

**X5 and X7, a document asking from its own scripts (head, body end, DOMContentLoaded, load).**
- In a display:none iframe: `0px` every time.
- In a shown iframe: `1vw` and 8917 au in 13 of 14 rows over three runs. Once it gave `0px` with 8282 au at parse time, and `1vw` at load. That row is timing; I could not make it happen again.
- In a new tab (a top-level document): `1vw`, 8917 au at all four moments.
- The test agreed with the widths every time.

**Device scales (D1 under prefs).**
- `layout.css.devPixelsPerPx` 2.2 (devicePixelRatio 60/27, as a 110% zoom here): the element gives the DOM's au on 5 of 5, and the test is right in 21 of 21 rows.
- `layout.css.devPixelsPerPx` 1.25: the same result.
- `privacy.resistFingerprinting` with 1.0:
  - devicePixelRatio says 2 where layout is at 1;
  - the element at the device size is wrong on 5 of 5 (system-ui 8282 au for 8917) while the test says `1vw`;
  - the OffscreenCanvas is right on 4 of 5.
- `privacy.fingerprintingProtection` with 1.0: devicePixelRatio says 1 and the element matches on 5 of 5. Only the non-default pref spoofs.

**X6, the test's cost over many contexts.** Two exclusive runs, 5 rounds each. The load average was 81 and then 49, because work outside the lock kept the machine busy. Absolute numbers are about 2.2 times the quiet ones. Medians, first run and second run:

| What | Run 1 | Run 2 |
|---|---|---|
| The test on one kept context | 0.75 µs | 0.75 µs |
| Over 200 kept contexts of distinct fonts | 0.80 µs | 0.80 µs |
| Without a pres shell | 0.20 µs | 0.25 µs |
| With a restyle of 30,000 spans pending (it stays pending: 12 to 18 ms after) | 0.75 µs | 0.80 µs |
| A new canvas, context and font, without the test | 9 µs | 8.5 µs |
| A new canvas, context and font, with the test | 10 µs | 10 µs |

Font variety and a busy page don't move the cost.

**In context.** BENCH-NIGHT.md has 10,000 messages from scratch in Firefox at 2.63 s (the mix) and 0.61 s (ASCII). 10,000 asks at 0.35 µs are 3.5 ms.

### 4. Does the verdict stand?

Yes, against every attack I ran.
- **(a) Workers.** The port runs in dedicated and shared workers on OffscreenCanvas. Its results equal the page's except the default-generic cases: 14 of 435 in the first sample, 6 of 217 in mine, 0 with a generic at the end.
- **(b) The test.** It agreed with the widths in every row of every document kind I could make. From source it forces no restyle, and it is cheap.
- **(c) and (d).** I checked its numbers against CHARTER decision 2, gecko-RESULTS "Ceiling round 4" and SYSTEM-UI.md. They match. Blink and WebKit read no `document` (only env.ts:155-156 does).
- **One consequence it didn't state.**
  - From CHARTER.md decision 2, with no supplied facts, the OffscreenCanvas-only port reports 6.5% of values as predicted, because `optical-size` is reported almost everywhere (216 of 217 cases in my worker runs, 433 of 435 in the first agent's). Round 3's element path reported 96.3%.
  - So page and worker would differ most visibly in gaps, not lines.

### 5. Conditions I add to its five

1. Ask the test before every call that measures, the fill included, or define what a prepared paragraph does when the answer changed. Per prepare is not enough (X1).
2. With `privacy.resistFingerprinting` the element path is silently wrong, and worse than OffscreenCanvas. No test tells, short of measuring the app-unit grid. Default Firefox is fine.
3. Use `createElementNS` with the XHTML namespace, or check `typeof getContext`. If anything fails, fall back to OffscreenCanvas (SVG documents, DOM shims in workers, a page that overrides `createElement`).
4. In an iframe, an early prepare can get the OffscreenCanvas kind and a later one the element kind for the same text (1 of 14). Callers that cache heights across that moment hold stale values. The `optical-size` gap is what tells them.
5. The element kind pays a pending stylist update at every `measureText`. Both kinds pay it at `ctx.font` today.
6. The canvas kind can't be an Environment fact, as it was in 872c0da. The Environment is posted to workers, and the answer changes over a document's life. It belongs where contexts are made.

### 6. What I could not find out

- **Service workers.** The runner serves no script over http, and a service worker can't come from a blob URL.
- **Not probed.** bfcache, print, a user's real full zoom (emulated with devPixelsPerPx), a window resize, cross-origin iframes, other operating systems.
- **The one shown iframe without a pres shell at parse time.** I could not find why: docshell is not in the pinned tree.
- **Whether resolving `1vw` marks the document as using viewport units.**
  - `servo/components/style/gecko` is missing from the pinned tree.
  - `values/computed/mod.rs:467-476` flags the throwaway style and asks the device.
  - `calc(1px + 1em)` tells the same in 21 of 21 rows and needs neither the viewport nor the root font. It is the safer string.
- **A quiet exclusive timing of X6.** Two tries ran at load 81 and 49. I stopped after two.
- **A quirks-mode document.** A srcdoc document is never in quirks mode, so that row shows nothing.

## Condition 2: "we can make things work in workers through feature detections"

**Verdict: true with conditions.** The conditions are listed at the end.

Words used below:
- **au**: app unit, 1/60 CSS px.
- **pres shell**: Gecko's presentation shell, the object that holds a document's style and layout. A document has one only while it is displayed.
- **digest**: a hash of everything the library returned for a case: line ranges, line box widths, advances, fragments and gaps, prepared plain and inspected, at the case's own width and 7 sweep widths.

All runs used the pinned Firefox 156.0 in background windows under the browser lock, at DPR 2 unless said. Outputs are in `~/github/pretext-rebuild/.artifacts/probes/ff-element-20260919/workers/`. Load average at the start of the early runs was 2.4 and 20.2. It was 3.8 before and 3.6 after the one exclusive timing run. Later waits happened while another job held the exclusive lock, with load at 85 to 178.

### (a) Does the port run in a worker today?

**What the source reads.** In `rebuild/src` outside tests:
- `detectEnvironment()` reads `window.devicePixelRatio` and `document.documentElement.lang` (env.ts:155-156). These are the only reads of globals a worker lacks.
- `navigator.userAgent` exists in workers.
- The painter takes a `doc` argument.
- Every measuring context is made in one place, `contextFor` (measure/canvas.ts:52). `canvas-checks.ts` makes its own OffscreenCanvas contexts for `detectEngine()`.
- `engines/gecko` reads no global at all, and nothing reads fonts readiness.

**What the worker scope has (probe W1).**
- `document`, `window`, `devicePixelRatio`, `matchMedia` and `HTMLCanvasElement` are undefined.
- `OffscreenCanvas`, `FontFace`, `self.fonts` and `Intl.Segmenter` exist.
- `detectEngine()` answers gecko. `detectEnvironment()` throws `ReferenceError: window is not defined`, so the page's Environment object was posted to the worker.

**Identity.** 435 lab cases, 13,158 lines a sweep, no font facts supplied. Two full runs, one before and one after the probe was restructured, gave the same numbers.
- The page run twice: 435 of 435 digests equal.
- The worker with fixture fonts added, against the page: 421 of 435 equal. The same 14 differ page-first (W1) and worker-first in a fresh document (W2).

**Why the 14 differ (W4 trace).**
- Both scopes made 41,487 of the same measureText calls, and 909 differ (2.2%).
- All 909 are characters the named families lack, in a font list that names no generic family:
  - `!` and `»` after "Geeza Pro";
  - Devanagari in Arial;
  - U+3000 and U+2009 in Georgia and Courier New;
  - everything in `BlinkMacSystemFont`.
- Source: `BuildFontList` appends the language's default generic to a list that has none (gfxTextRun.cpp:1969-1977). `GetDefaultGeneric` returns the `font.default` pref on the main thread and always sans-serif on a worker thread (:1881-1891).
- W5 raw widths: `!` in `20px "No Such Family"` is 6.67px on the page (Times) and 5.55px in the worker (Helvetica). With `, serif` both give 6.67. With `, sans-serif` both give 5.55.
- With every list ending in serif, the worker matches the page on 435 of 435. The same holds with sans-serif.
- The library cannot quietly append a generic itself. On the page it moves lines in 16 (serif) or 21 (sans-serif) of 435 cases, because per-character pref fallback also reads the list's generic (:4017-4019).
- No gap reports any of this. Gap counts are the same in both scopes: `optical-size` 433, `in-word-prefix` 29, `font-size-quantization` 5, `font-fallback` 1.
- It exists today and does not come from the canvas kind.

**Web fonts.** Without the fixtures in `self.fonts`, 22 more cases differ, and every one names a fixture family. With them added, none of those cases differ. On the main thread an OffscreenCanvas uses the document's font set (CanvasRenderingContext2D.cpp:4426-4431).

**Empty lang (W3, under `<html lang="ja">`).**
- A context with `lang = ''` takes the root element's lang on the page and the OS locale in a worker (:5446-5468).
- Raw widths differ for sans-serif, serif and monospace, and not for Arial or system-ui.
- The library's digests:
  - With `regionalPrefsLocale` given: 12 of 12 equal.
  - With it unknown: 4 of 12 equal, and both scopes report `ui-language` on all 12, so this one is not silent.

**Speed.** On a quiet machine the page took 702 ms for the first sweep and 438 ms for the second. The worker took 479 and 447 ms. The worker shows no penalty.

### (b) The detection

**What the element path needs.**
- `SetFontInternal` asks `GetPresShell()`, which is `mCanvasElement->OwnerDoc()->GetPresShell()`. Without a pres shell it takes `SetFontInternalDisconnected`, the OffscreenCanvas path (:2086-2094, :4219-4224).
- Without a pres shell, `GetAppUnitsValues` gives 60 au per px (:7132-7155).
- Optical sizing is set only through nsFont (nsFont.cpp:276-279). The hand-built font style of the disconnected path leaves it off (gfxFont.h:134).

**Document kinds (D1).** 21 rows, run at DPR 2 and again at DPR 1 (forced with `layout.css.devPixelsPerPx`).
- With a pres shell, the detached element canvas at the device font size gives the DOM's au on 5 of 5 samples:
  - system-ui: 8917 au against the OffscreenCanvas's 7761;
  - `modern` in 15px Helvetica Neue: 3118 against 3119 (the one-au rounding class);
  - the bold keycap and heart: 786 against 793 (synthetic bold).

  This holds for:
  - the top document;
  - an iframe that is shown, visibility:hidden, 0×0 or far off screen;
  - an iframe under a content-visibility:hidden parent.
- Without a pres shell, every sample is silently off: 8282, 3117.5, 785, 5016, 5553.5. This covers:
  - an iframe that is display:none or under a display:none parent;
  - a removed iframe's document;
  - `createHTMLDocument`, `DOMParser`, a template's owner document and an XML document;
  - a canvas adopted by one of those.
- At DPR 1 the element without a pres shell equals the OffscreenCanvas on 5 of 5, and only system-ui tells the two canvas kinds apart.
- `devicePixelRatio` is no test. It stays 2 in a display:none iframe, because it walks to the parent (nsGlobalWindowInner.cpp:3781-3806), and it reads 1 in a removed iframe.
- Under CSS zoom 1.5 and 0.8 (D5), the frame's own `devicePixelRatio` is 3 and 60/38. The frame's element canvas at that scale gives the frame's DOM widths on 5 of 5. At the top window's scale it is wrong on 5 of 5.

**What tells.**
- A `letterSpacing` of `1vw`, `1rem`, `1vh`, `1lh`, `1cqw` or `calc(1px + 1em)` reads back as set when there is a pres shell, and as `0px` without one.
- That was right in 21 of 21 rows at both ratios, and at all 5 stages of the toggle below.
- Source: `ParseSpacing` falls back to the style system only with a pres shell (:3091-3110).
- The font values `2em`, `larger`, `1rem`, `1vw`, `menu` and `caption` tell the same.

**Why it forces no style or layout flush.**
- For a detached element, `nsComputedDOMStyle::GetComputedStyle` flushes only when the element has a composed document (nsComputedDOMStyle.cpp:484-491).
- `ResolveForDeclarations` does not update the stylist (ServoStyleSet.cpp:1370-1377).
- `FlushUserFontSet` returns at once unless @font-face rules changed (Document.cpp:18877-18880), and the OffscreenCanvas path calls it too (:4446-4448).
- Measured in D3, 3 rounds, with a style change pending on 30,000 spans:
  - A detached element canvas, the `1vw` test on it, an OffscreenCanvas and a `devicePixelRatio` read take 0 to 1 ms and leave the 5 to 7 ms style flush pending.
  - A connected element canvas takes 6 to 7 ms and leaves 0 ms, like `getComputedStyle`. So the canvas must never be connected.

**Measured alternatives are unsound.**
- What a 0.01px letter spacing adds (the app-unit grid) is right in 21 of 21 rows at DPR 2, and tells nothing at DPR 1 (10 of 21).
- At DPR 2, system-ui differs from the OffscreenCanvas with or without a pres shell (8282 against 7761), so it is right in 11 of 21.

**It must be asked again (D2).**
- A context follows its document at every measureText (`GetCurrentFontStyle`, :5483-5501).
- After display:none and the parent's flush, all 3 contexts measure without a pres shell, including the 2 made while the iframe was shown.
- Shown again and flushed, all 5 contexts give the DOM's au.
- Between setting the style and the parent's flush, nothing changes.

**Cost (D4).** Alone on the machine, 5 rounds each, 1 ms timer:

| What | Median | Range |
|---|---|---|
| The `1vw` test on a kept context | 0.35 µs | 0.30 to 0.35 |
| The test with a new canvas, context and font | 4.5 µs | 3.5 to 5.0 |
| An element canvas and an OffscreenCanvas, one measureText each | 7.0 µs | 6.5 to 8.5 |
| An element context, font and one measureText | 4.0 µs | 3.5 to 4.5 |
| The same on an OffscreenCanvas | 3.0 µs | 2.5 to 3.0 |

### (c) What the split means for a user

**Named fonts.** No line count or break moves between the two canvas kinds. Widths lose:
- the 1 au class: 17 rows on about 40,000 cases, and 23 more on 48,290 fresh cases;
- synthetic bold: 9 rows on the fresh cases, 7 or 8 au each.

These numbers come from CHARTER decision 2 and gecko-RESULTS "Ceiling round 4".

**system-ui and other optical-size fonts.**
- In the rule family: 192 widths, 96 breaks and 32 line counts lost.
- On the 3,471-case sweep in SYSTEM-UI.md:

| | Line count | Breaks | Widths |
|---|---|---|---|
| Element canvas | 99.94% | 99.77% | 92.95% |
| OffscreenCanvas only | 88.27% | 75.54% | 50.96% |

**What the worker reports.**
- The worker path reports `optical-size` as it does today: 433 of 435 cases, the same count as the page.
- The two residual classes (the 1 au class and synthetic bold) have no gap today. They would stay silent in the worker.

**Prepared paragraphs.** One cannot cross scopes at all: `DataCloneError: OffscreenCanvasRenderingContext2D object could not be cloned`. It holds 12 contexts. Only lines can cross.

### (d) The other engines

- The Blink and WebKit ports read no `document`.
- All three engines make their contexts in `contextFor`, so the canvas kind would be a Gecko-only difference in one place.
- In Chrome the canvas kind changes nothing (SYSTEM-UI.md, 500 rows).
- WebKit's connected canvas stays rejected.

### What I could not find out

- The pinned source tree lacks the servo glue, `dom/workers` and `docshell`. So which units need the style system is known from the probe only. Worker font visibility, bfcache and print are unverified. In bfcache and print no script runs anyway.
- Not probed, because each needs a foreground window or browser-level control:
  - a popup;
  - a background tab (from source it keeps its pres shell: PresShell.cpp:12003-12031);
  - print preview;
  - browser zoom;
  - a window resize;
  - cross-origin iframes;
  - other operating systems.
- A newly inserted about:blank iframe measured like the DOM before my explicit flush of the parent, and I did not find why. After a display toggle, the pres shell came back only with the parent's flush.
- Whether the DOM agrees with the page's OffscreenCanvas on the 14 default-generic cases was not measured.

### What the library change would have to do

1. Add one more context kind in `contextFor`: `document.createElement('canvas')`, never appended to the document.
2. Decide the Gecko-only environment fact as `typeof document !== 'undefined'` plus the letterSpacing test. Commit 872c0da tested `typeof document.createElement === 'function'`, which throws in a worker and says yes in a display:none iframe.
3. Make `detectEnvironment` usable when the page builds the Environment and posts it to the worker.
4. Ask the test again at every prepare: 3.5 ms per 10,000 prepares. Also decide what a prepared paragraph does when its document is hidden before `fillLine`.
5. Read `devicePixelRatio` from the canvas's own window.
6. Restore 872c0da's arithmetic: +92/−44 lines in 5 files.
7. Separately, make workers report or require a generic family at the end of a font list.

### Conditions

1. Worker identity holds only for font lists that end in a generic family: 435 of 435 with one, 421 of 435 without.
2. The Environment, `regionalPrefsLocale` and web fonts must reach the worker from the page.
3. The detection reads a Gecko internal, not specified behaviour. It is pinned to build 156.0 like the port itself, and another build already reports the `engine-build` gap.
4. The detection must be asked again over a document's life, and the canvas must stay detached.
5. Page and worker give different lines for optical-size fonts, reported on the worker side only.
