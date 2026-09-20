# Kept Canvas contexts that answer otherwise than new ones, per engine, and the rule that came of it (2026-09-20)

The profiling phase's first merge lets a page hand one list of Canvas contexts to every `prepare`, so a context is made
once per settings instead of once per paragraph (research/PERF-LIFETIME.md). The documents then said "only webkit-host
needs a contract: start a new list after the page's fonts change". The attacker of another study
(research/PERF-CONTEXT-STORE.md, section 3.7) found that wrong: in a Firefox that has just started, a kept context made
in the first second stays on the fallback font for a family named by its localized name. One agent mapped every way a
kept context can answer otherwise than a new one in the three engines, from probes and the pinned sources, weighed the
rules and built one; a second agent attacked it. The attacker's review comes first.

## What came back, and the orchestrator's reading

- **Firefox: a kept context can be stale for ever, nothing a page can assign heals it, and no page can know when.** A
  Canvas context resolves its family names once, at its first measurement. Firefox reads the fonts' localized names
  and the legacy family names of single faces (`Avenir Next Condensed Heavy`) after start-up: about 8 s in (60 s on
  Windows by its preference), or about a second after the first lookup of a name it doesn't know. Their arrival moves
  no generation a font group checks and is told to the DOM alone, as a reflow. The same font string assigned again,
  another string and back, `letterSpacing`, `fontKerning` or `lang` changed and back: none makes a kept context look
  again (a change of `fontKerning` or `lang` works once per context; only a spelling of the font string the context has
  never seen rebuilds it, which would be a hack). 9 of 22 family names pages really write are late names here.
- **The rule that was built, and merges: Gecko's contexts are one call's, whatever list the caller keeps** (+4 −1 lines
  in `rebuild/src/index.ts`). It follows from what a Firefox context is, it detects nothing, and it is one case in the
  one engine switch. It gives back what the list bought Firefox: ×0.92 on the chat mix and ×0.75 to ×0.80 on plain
  ASCII (about 1.00 to 1.09 s and 0.46 to 0.58 s per 10,000 messages). Tier 1 shows 0 predictions and 0 questions
  changed (the lab passes no list).
- **What the rule does not mend (the attacker):** it is exact for `prepare()` alone. A Gecko prepared paragraph holds
  its contexts, and its fills ask them and make more. A paragraph prepared before the late names arrived stays at the
  fallback's lines (6 where the DOM and a paragraph prepared now have 3), and one first filled afterwards measures with
  two fonts and can break a word after its first character. No library rule can fix that without the DOM. It is the
  web-font case (prepare again when the fonts change) with nobody telling the page. What a page can do: name families
  by their canonical English names, which never moved in any run. It belongs in the platform ledger, and whether to
  report it to Mozilla is the maintainer's call.
- **WebKit: the stale case is much narrower than the documents said, and its cause is in the source.** A kept context
  misses only a FontFace that has already loaded being added to a `document.fonts` that holds no face (the font cache
  leaves the page's font set out of its key while the set is empty, and the set tells a context's font about a new face
  before the face is in it). A face added before it loads, an `@font-face` rule, a face added to a set that holds one:
  all reach a kept context by themselves. The page does this itself, so it can keep the contract: start a new list
  after adding loaded faces. Making a kept WebKit context look again costs 85% of a new one, so the library doesn't.
- **Chrome: nothing stale,** by source (a canvas font asks the page's font selector again once its fallback list was
  marked invalid, and shares that list with the DOM) and in a Chrome that has just started.
- **The late characters in Firefox** (U+20BF, 13 px then 9.92 px about a second after a content process first asks)
  move a kept context, a new one and the DOM at the same reading, so the list doesn't matter to them.
- **Counted on the way:** rich messages make 8.9 contexts a message in Gecko, 21 in WebKit and 40 in Blink (a stand-in
  count; nobody timed a rich message in a browser yet), which is what the list saves where it is kept.

## Second reading of the kept-contexts study and its rule (x-contexts-heal), 2026-09-20

I reran the owner's central probes in browsers that had just started. I checked every source citation in the pinned trees and read the paths it didn't. I attacked the rule with new probes and new counts. My checks are seven commits of new files on the same branch. I edited none of the owner's files and no library code. Nothing merges and nothing was pushed. This text is also saved as `~/github/pretext-rebuild/.artifacts/tests/runs/contexts-heal-20260920/attack/REPORT-heal-attack.txt`.

Paths:
- `P` = `~/github/pretext-rebuild/.artifacts/probes/contexts-heal` (the owner's probe runs). `P/attack` is mine: one folder a run, named `<browser>-<probe>-<k>`, each with the runner's `<browser>-probes.json`, `run.log` and `exit`. My scripts are in `P/attack/tools` (`multi.sh` runs several probes inside one slot, each a fresh browser launch; `summary.py` prints a run).
- `T` = `~/github/pretext-rebuild/.artifacts/tests/runs/contexts-heal-20260920` (the owner's). `T/attack` is mine: the two offline counts and the bench smoke.
- Source: `F/` = `~/github/browser-engines/firefox-156.0/`, `W/` = `webkit-7625.1.29.11.27/Source/WebCore/`, `B/` = `chromium-153.0.8010.48/third_party/blink/renderer/`.
- My log: `.progress-heal-attack.txt` in the worktree.

Words used:
- **Kept context**: a Canvas context made once and used again later. **New context**: one made at the moment of the question, same settings. **Stale**: a kept context answers otherwise than a new one for the same string.
- **The list**: the `Context[]` a page hands to every `prepare`. **The rule**, or **[D]**: the owner's commit 566b329, where Gecko's `prepare` ignores the caller's list and makes its own.
- **Prepared paragraph**: what `prepare` returns. A page keeps it and fills lines from it at any width later.
- **Late names**: family names Firefox reads from the fonts' name tables after start-up: localized names and legacy family names of single faces.
- **The window**: from a Firefox's start until the late names are in. A context first measured inside it is stale for a late name for as long as it lives.
- **A browser that has just started**: a fresh launch of the pinned browser by the probe runner. Every run here is one.

### 0. Outcome

- **The study holds.** Every probe I reran says what the owner says. Every source citation is right. Its counts reproduce to the digit. The unit test fails without the rule.
- **The rule is the right one for `prepare`, and it is not a browser patch (section 4). Merge it, after a change of wording.**
- **What is wrong is what the rule is said to give.** "Exact by construction" is true of `prepare` alone. A Gecko prepared paragraph holds its contexts, its fills ask them again, and its fills make more. So a prepared paragraph IS a kept list, and the rule doesn't reach it.
  - Probe K1, on the head with the rule in, 2 of 2 runs: a paragraph prepared at the start and kept stays at 6 lines for all eight seconds, at a width that is new at every reading. The DOM and a paragraph prepared now have 3 lines from 1,360 and 701 ms on.
  - Probe K3, 2 of 2: a paragraph prepared at the start and first filled 3.1 s in breaks one long word at offsets 1, 9, 17, 25, 33, 41, 49, 53. That is 8 lines, the first of one character. The fallback font gives 7 lines (8, 16, ... 53) and the family gives the DOM's 6 (8, 19, 32, 43, 51, 53). Its first context is on the fallback and the two contexts its fill made are on the family. One paragraph measures with two fonts and gives lines neither font gives.
  - What a user sees first in a restored session is paragraphs prepared inside the window (my reasoning, not measured). So the rule keeps the damage to those paragraphs, instead of every later one, and doesn't mend them. Nothing tells the page when to prepare them again. The owner's ledger entry says so in one sentence. Its summary, its comment in `index.ts` and its DESIGN.md text don't.
- **Late names are names pages really write.** Probe H1: of 22 names from common CSS font lists, 9 are late names on this Mac, `"ヒラギノ角ゴ ProN W3"` and `"ヒラギノ角ゴ Pro W3"` among them, which many Japanese font lists start with. A list shows the problem only where the late name is that family's only name in it: the classic Japanese lists name the family in English right after, which resolves at once to the same font.
- **The rule costs more on rich text than the owner's count says.** A chat message with bold, italic and a code span makes 8.9 contexts in Gecko, where a plain one makes 3.95 (stand-in count). That is about 34 µs a message at the owner's 3.8 µs a context, 0.34 s per 10,000, against its 0.12 to 0.25 s. Still small.
- **WebKit's narrow case is a little wider than worded.** It is "a loaded FontFace added to a font set that holds no face", not "no face yet": add, delete, add again is stale too (probe H4).
- **One guess of mine was wrong**, and is kept on record: a page whose font set used a `src: local()` rule does not heal by itself (probe H2).
- **Four small mismatches between documents and code** (section 5), with diffs.

### 1. What I reran, and what I confirm

Every run is a fresh launch of the pinned browser, exit 0. No job failed.

| The owner's claim | My run | Verdict |
|---|---|---|
| Firefox S1: four late names; the kept context and every way of assigning stay on the fallback; `fontKerning` or `lang` changed late heals once; a never-seen spelling heals with a new context; a context first measured late is right; U+20BF moves kept, new and DOM together; English names, generics and a missing family never move | `P/attack/firefox-S1-r1`: new context 385.33 to 369.25 px at 1,232 ms, DOM at 1,488 ms, kept 385.33 px for ten seconds; the late toggles heal at 5,107 ms; U+20BF 263.38 to 268.92 px at 1,488 ms in all three | **confirmed**, 3 of 3 with its two |
| Chrome S1: nothing moves | `P/attack/chrome-S1-r1`: no answer of 11 declarations changed in ten seconds | **confirmed** |
| webkit-host W8: a FontFace loaded, then added: kept stale; another string and back heals | `P/attack/webkit-host-W8-r1`: kept 384.06 px, new 295.97 px at 2,267 ms | **confirmed** |
| webkit-host W9: the same into a set that holds a face heals | `P/attack/webkit-host-W9-r1`: every way 295.97 px at 2,266 ms | **confirmed** |
| L1 on the head: the kept list follows a new list and the DOM; it holds 0 contexts | `P/attack/firefox-L1-head-r1`: all three 6 to 3 lines at 766 ms; 0 contexts | **confirmed**, 3 of 3 |
| T1: WebKit's healing re-look costs 85% of a new context | `P/attack/webkit-host-T1-r1` (a normal slot, so ratios only): 1.44 of 1.75 µs and 1.35 of 1.64 µs, 82% both | **confirmed** |
| Stand-in count: Gecko 4.02 and 3.58 contexts a message whatever the font list; Blink 10.5 and 10, 14.5 and 14 with two missing families first; WebKit 5 and 9 | its script again: `T/attack/stack-count-rerun.json` equals `T/stack-count.json` | **confirmed** to the digit |
| The unit test fails without the rule | scratch worktree of the head, the Gecko case handed the caller's list: 23 pass, 1 fail (expected 1 line, got 2); on the head 24 pass | **confirmed** |
| Quick gates exit 0, tier 1 at 0 predictions and 0 questions changed | read from `T/gates-quick-0fdb6a3.log`, not rerun: my commits add probe files only | **stands** |
| In Firefox the bench's one-list row measures what a list a message measures | bench chat smoke on the head (`T/attack/bench-smoke-firefox/firefox-bench.md`): 3.73 and 3.22 contexts a message with no list, 3.73 and 3.22 with "page keeps both" | **confirmed**, with a hole (section 5) |

Not rerun: the base tree's L1 (the owner has 2 of 2, and raw S1 shows the same thing), S2, S3, W1 to W7, W10, L2, the exclusive T1 stretch, the gates. I read their files; they say what the report says.

### 2. The source citations, and the paths it didn't read

All of these are as the owner says, line ranges included:
- Gecko: `FontIsUnchanged` and the context's own cache of font groups with its key (`F/dom/canvas/CanvasRenderingContext2D.cpp:4409-4478`), `GetCurrentFontStyle` (`:5480-5523`), `EnsureFontList` and its generation check (`F/gfx/thebes/gfxTextRun.cpp:1917-1990`), `UpdateUserFonts` (`:3946-3965`), which names start the loader (`F/gfx/thebes/gfxPlatformFontList.cpp:1752-1781`), `InitOtherFamilyNames` (`:930-967`), `StartLoader(0)` (`:3063-3085`), `SetAliases` and then the global reflow (`:3135-3162`), `SetAliases` itself (`F/gfx/thebes/SharedFontList.cpp:1057-1116`) with the generation written once (`:726`), PresShell as the observer (`F/layout/base/PresShell.cpp:878`, `:11042-11047`), `ForceReflowForFontInfoUpdate` (`F/layout/base/nsPresContext.cpp:190-232`), and the delay of 8,000 and 60,000 ms (`F/modules/libpref/init/StaticPrefList.yaml:7831-7838`). In the pinned tree `font-info-updated` appears in `gfxPlatform.cpp` and `PresShell.cpp` only. `dom/ipc` is not pinned, as the owner says.
- WebKit: the cache key without the font selector (`W/platform/graphics/FontCascadeCache.cpp:104-115`), `isSimpleFontSelectorForDescription` (`W/css/CSSFontSelector.cpp:526-539`; `faceCount` counts `@font-face` rules' faces too, so a page with any rule in effect is never in the narrow case), observers told before the insert (`W/css/CSSFontFaceSet.cpp:203-209`), `FontProxy::fontsNeedUpdate` (`W/html/canvas/CanvasRenderingContext2DBase.cpp:478-506`).
- Blink: `B/platform/fonts/font.cc:71-77`, `font_fallback_map.cc:29-67`, `canvas_rendering_context_2d_state.cc:252-263`, `plain_text_painter.cc:266-270`.

Paths it didn't read:
1. **`reset()` and a resize in Gecko.** `reset()` is `SetDimensions`, then `ClearTarget`, then `SetInitialState` (`CanvasRenderingContext2D.h:124-128`, `.cpp:1871`, `:2130`). None of them touches the context's cache of font groups, which is read at `:4457-4466` and written at `:4606-4608` only. So the font assigned again after a reset finds the old font group. Probe H5 agrees: both ways stay on the fallback for all four late names (`P/attack/firefox-H5-1`). This closes the last legitimate "look again" call. Also at `:4586-4588`: on a cache miss the current group is still reused when the resolved font string is equal, which is why a never-seen spelling alone doesn't heal and the owner's trick needed the `fontKerning` change first.
2. **A font set that used a `src: local()` rule.** When the late names arrive the parent process rebuilds the font sets that used a local rule (`gfxPlatformFontList.cpp:2864-2942`, `gfxUserFontSet.cpp:1087-1092`), and a rebuilt font set makes a font group look its families up again. I guessed a page with such a rule would heal by itself. It doesn't (`P/attack/firefox-H2-1`: kept, same string, another string and back all stale). A page's own process only forgets its local faces (`nsPresContext.cpp:209-213`), which moves no rebuild generation. The owner's "for as long as it lives, until the page's font set changes" stands.
3. **WebKit's `remove` also tells its observers before it removes** (`CSSFontFaceSet.cpp:256-264`). After add, delete, add-loaded the second add meets an empty set again and the kept context asks under the key without the font set. Probe H4 (`P/attack/webkit-host-H4-1`): kept 384.06 px, new context and DOM 295.97 px at 2,268 ms. So the wording is "holds no face", not "holds no face yet".
4. **Blink's map marks fewer lists invalid than the comment suggests**: only lists with a loading fallback when a face finishes loading, only lists with a custom font when one is deleted, all lists otherwise (`font_fallback_map.cc:47-63`). It doesn't matter: DOM text of the same description holds the same list object, so Canvas and DOM can't part. Probe H3 in Chrome: an installed family taken over by a loaded FontFace of the same name reaches the kept context with the DOM (2,275 ms).
5. **The mechanism of the late characters (1c)**, which the owner left uncited: the global fallback skips families whose character maps aren't loaded and starts loading them all (`gfxPlatformFontList.cpp:1480-1486`, `LoadCmapsRunnable` at `:1575-1651`); the state is the platform font list's, not a font group's, so kept, new and DOM move together by source too.

### 3. Attacks on the rule

#### 3.1 A prepared paragraph is a kept list (new probes K1, K2, K3): the rule's real limit

`GeckoPrepared` keeps its list (`engines/gecko/prepare.ts:1186`). A fill at a new width asks the run's first context again (28 to 35 calls a layout in Firefox, the bench's counts), and makes contexts of its own where a recipe first needs one (`advance.ts:498`, `measure.ts:33-38`). The rule changes none of that: it was so before the list landed.

| Firefox that has just started, on the head | DOM | the paragraph kept from the start | a paragraph prepared now |
|---|---|---|---|
| K1 run 1, Japanese name and legacy name, widths 371 to 379 px | 6, then 3 lines at 1,360 ms | 6 lines for all eight seconds | 6, then 3 at 1,360 ms |
| K1 run 2 | 3 at 701 ms | 6 for all eight seconds | 3 at 701 ms |
| K3 runs 1 and 2, one long word, `overflow-wrap: anywhere`, 171 px | 7, then 6 lines (5 for the legacy name) at 1,325 and 751 ms | filled at once: breaks at 8 16 24 32 40 48 53 (the fallback's 7 lines). First filled 3.1 s in: 1 9 17 25 33 41 49 53, 8 lines, the first of one character; its contexts go from 1 to 3 at that fill | 8 19 32 43 51 53 (9 22 34 46 53 for the legacy name), the DOM's count |

Under the family's English name all columns agree in every run. K2 is K1 with the long word: stale the same way (6 lines at the end where the DOM has 5); its first fill, 9 ms in, had already made all three contexts, so it shows no mixing, which is why K3 exists. Files: `P/attack/firefox-K1-1`, `-K1-2`, `-K2-1`, `-K3-1`, `-K3-2`.

What it means:
- The brief's case "a page that makes its list before any font is ready and never prepares again for a minute" is this one, and the rule doesn't cover it. No library rule can without reading the DOM: a prepared paragraph is a snapshot by design.
- The rule's true sentence is: "in Firefox a late name's damage ends with the paragraphs prepared before it arrived". Without the rule it lasts as long as the page's list. That is worth +4 −1 lines. It is not "a kept context always answers what a fresh one would".
- What a page can do is its own business, and two things work without any event: name families by their canonical English names (`"Hiragino Sans"`, not `"ヒラギノ角ゴシック"`; S1 and H1 never saw one move), or prepare its first paragraphs again once. The documents should say the first.
- Main has the same hole, wider (one kept context and a cache of widths), as the owner's ledger text says.

#### 3.2 The other cases of the brief

- **A family that draws at first through another font of the same name and later through a web font** (new probe H3, a FontFace named `Helvetica Neue`, loaded, then added at 2 s): Chrome's and Firefox's kept contexts follow with the DOM (324.54 to 295.97 px at 2,275 ms; 324.58 to 295.92 px at 2,310 ms). webkit-host's stays on the installed font (324.54 px) while the DOM has 295.97 px: it is the contract's case, and the page did the adding. Under the rule Firefox never holds a list, so nothing to attack there.
- **A localized name that resolves only after the rule stopped looking**: the rule never stops looking. Every `prepare` makes its contexts. The paragraphs already prepared are 3.1.
- **A context shared between two declarations**: can't happen. A context is found by its whole font string and seven more settings (`measure/canvas.ts` `sameSettings`), and nothing assigns a context's font twice.
- **A list handed to a worker**: can't happen either. A `Context` holds an `OffscreenCanvasRenderingContext2D`, which can't be cloned, and an OffscreenCanvas that has a context can't be transferred (the HTML standard's transfer steps). A worker makes its own list, and in Firefox the rule applies there as on the main thread. Not run in a worker.
- **How common the late names are** (new probe H1, `P/attack/firefox-H1-1`): 22 names from common CSS font lists. 9 are late names here, each with the kept context stale and a new context and the DOM right at 764 ms: `Avenir Next Demi Bold`, `Avenir Heavy`, `ヒラギノ角ゴ ProN W3`, `ヒラギノ角ゴ Pro W3`, `ヒラギノ角ゴ ProN`, `ヒラギノ明朝 ProN`, `游ゴシック体`, `华文黑体`, `黑体-简`. 6 resolve from the start (`Hiragino Kaku Gothic ProN`, `YuGothic`, `Arial Narrow` ...). 7 name nothing on this Mac. Chrome: no answer changed (`P/attack/chrome-H1-1`). One caution on "common": a font list that also names the family by its English name (`"ヒラギノ角ゴ ProN W3", "Hiragino Kaku Gothic ProN", ...`, the classic form) finds the same font through the English name at once, so a kept context is right there by luck (from the source's lookup order, not probed). The lists that show it name the family by a late name alone.

#### 3.3 Where the rule costs more than it says

- **Font lists whose first families never draw: no extra cost.** Gecko asks the font checks nothing, so the count is 4.02 and 3.58 contexts a message whatever the list (rerun, equal). The owner's T1 timed a list with two missing families beside the bench's: 3.95 against 3.82 µs a context.
- **Many declarations: about 2.3 times the owner's count.** New offline count `T/attack/tools/rich-count.ts` (stand-in Canvas, 1,000 bench messages, the same words as plain text and as five parts: regular, bold, regular, italic, a code span in `Menlo` at 14px; every line at 320 px; `T/attack/rich-count.json`):

| contexts a message, no list | plain, mix / ASCII | rich, mix / ASCII |
|---|---|---|
| Gecko | 3.95 / 3.56 | 8.87 / 8.35 |
| WebKit | 5.0 / 5.0 | 20.8 / 21.0 |
| Blink | 10.5 / 10.0 | 41.1 / 40.0 |

  With one list every cell is under 0.06. At the owner's quiet 3.8 µs a Firefox context a rich message gives back about 34 µs, 0.34 s per 10,000. Nobody has timed a rich message in Firefox, so I can't give it as a ratio.
  The same table says what the list is worth where it stays: a rich message without it makes 40 contexts in Chrome, at the owner's 21 to 26 µs each about 1 ms a message. And it says dropping WebKit's list too would cost about 32 µs a rich message (21 contexts at 1.5 µs), three times the owner's plain figure.
- **Not measured by anyone: memory.** Under the rule every kept Firefox paragraph holds its own 3.6 to 8.9 contexts again, 36,000 to 89,000 for 10,000 kept messages, as before the list. The lifetime review timed preparing and keeping 10,000 messages in Firefox at 2.60 s without a list and 2.44 s with one, so the time is known and the bytes are not.

#### 3.4 Candidates the owner didn't weigh

- **A list that lives one synchronous job** (a page contract "in Firefox, start a new list for every batch", or a microtask in the library that empties Gecko's list). The DOM can't reflow inside a job, so such a list is as right as the DOM for the whole job, and it would get back the gain on bulk loads, which is where the ×0.92 and ×0.75 were measured. Against it: it isn't exact by the brief's meaning, since the names do become visible in the middle of a job (the owner's L1 run 1 shows it between two calls of one reading); the contract would put engine knowledge into the page; the microtask would put async state into `prepare` and has to live with paragraphs that still fill into the emptied array. A chat that prepares one message a job gains nothing from it. I would not build it. I name it so the maintainer knows a cheap near-exact form exists if Firefox's bulk load ever matters.
- **One new context a `prepare` as a witness** (compare its answer with the kept context's for a string the paragraph measures anyway; remake the list when they differ): a third of the cost given back, but equal widths of one string don't prove equal fonts. A heuristic. No.

### 4. Is it a browser-oddity patch?

No, by the maintainer's meaning.
- Nothing is detected at run time and no answer is corrected. The rule is one case in the one switch where the engines already part (`index.ts` `prepare`), which is where the engineering guide wants a difference by browser: "model that difference explicitly in one place".
- It follows from what a Gecko context is, read in source: a snapshot of family-name resolution taken at the first measurement, which no event the page can see refreshes and no call can refresh. The maintainer's own rule ("kept only if it can't go stale; every kept thing names what invalidates it") then says it can't be kept. The rule is that sentence applied, and it restores for Gecko exactly what every engine did before the list landed.
- The one smell: a public parameter that one engine silently ignores. The comment says so at the parameter, which is enough. `if (contexts.length > MAX_CONTEXTS) contexts.length = 0` still runs on a list Gecko never fills; harmless, and moving it costs lines.
- The narrow WebKit contract is not a patch either, but it leans on the key of a private cache. I would word what a page is ASKED as the broad thing it must do anyway ("after the page adds faces, it prepares its paragraphs again, with a new list") and keep the narrow cause as the explanation. A page prepares again after a font change in every engine, so the contract costs it nothing.

### 5. The engineering guide on the diff, and the documents against the code

The diff follows the guide: one place, no new type, no defensive code, no state added (it removes kept state), a unit test that fails without it. The comment on `prepare` is now about 40 lines, 12 of them Gecko's mechanism. That matches the file's style (the bound's paragraph is as dense) and the citation ledger reads comments, so I would not move it.

Mismatches:
1. **`index.ts`, "Gecko's contexts are one call's".** They are one prepared paragraph's: they live as long as it does and its fills ask them. And the comment doesn't say what 3.1 shows. "The first lookup of a name it doesn't know" should say which names start the loader: `Roboto` on a Mac doesn't. Diff below.
2. **`probes/contexts-start-up.ts:36`** points at a section of research/PERF-LIFETIME.md ("Kept contexts in a browser that has just started") that the owner's texts don't create. Diff below.
3. **`bench/page.ts` `chatPhases`** (`:893-917`) with one list calls the two halves itself with the page's list, so in Firefox it still shares: the smoke's phases table shows 0.6% and 0.4% of the time making contexts "with one list of contexts a pass", where `prepare` with a list makes 3.73 and 3.22 contexts a message. Its comment says "prepare() handed a page's". The owner's comment fix covers `prepareKeeping` only. Diff below, and one more sentence for the bench README.
4. **Texts the owner's list leaves out**: TESTS.md ("Since the profiling phase's item 1": the page predictors in Firefox are usual runs now, the new unit test, the new probes), DESIGN.md §4.6 "What bounds it" (13 contexts in Firefox: none is held now) and "What it buys" (Firefox's 2.76 to 2.51 s and 0.58 to 0.46 s: given back on 2026-09-20).

The three diffs apply on the head (`git apply --check`). I did not commit them: they edit the owner's files.

**Diff 1, `rebuild/src/index.ts` (on the head):**

```diff
--- a/rebuild/src/index.ts
+++ b/rebuild/src/index.ts
@@ -74,20 +74,26 @@
 // Lifetime: the caller's, in Blink and WebKit. A call that is given none gets an empty list, and then nothing outlives its
 // prepared paragraph. A page that hands one list to every call pays for a context once per settings instead of once per
 // paragraph.
-// Gecko's contexts are one call's, whatever list the caller keeps, because a kept Firefox context can answer otherwise than
-// a context made now and no page can know when. A context resolves its family names once, at its first measurement
-// (gfxFontGroup::EnsureFontList, gfxTextRun.cpp:1917-1990). Firefox reads the fonts' localized and legacy family names
-// after start-up: 8 s in (60 s on Windows, gfx.font_loader.delay), or from the first lookup of a name it doesn't know,
-// which takes about a second here (gfxPlatformFontList.cpp:1752-1781, :3063-3085). Their arrival moves no generation a font
-// group checks and is told to the DOM alone, as a reflow (SharedFontList.cpp:1057-1116, gfxPlatformFontList.cpp:3135-3165,
-// PresShell.cpp:11042-11047). So a context first used before it stays on the fallback for a family named by its Japanese
-// name, or by a legacy name like `Avenir Next Condensed Heavy`, while the DOM and a new context find the family. Nothing a
-// page can assign makes it look again: the same font string returns early, another string and back finds the old font group
-// in the context's own cache, and fontKerning or lang changed and back makes a new group once and finds that one ever after
-// (CanvasRenderingContext2D.cpp:4409-4478, :5480-5523; probes/contexts-start-up.ts S1, S2). That gives back what the list
-// bought Firefox: ×0.92 on the chat mix and ×0.75 on plain ASCII (research/PERF-LIFETIME.md).
+// Gecko's contexts are one prepared paragraph's, whatever list the caller keeps, because a kept Firefox context can answer
+// otherwise than a context made now and no page can know when. A context resolves its family names once, at its first
+// measurement (gfxFontGroup::EnsureFontList, gfxTextRun.cpp:1917-1990). Firefox reads the fonts' localized and legacy
+// family names after start-up: 8 s in (60 s on Windows, gfx.font_loader.delay), or from the first lookup of a name that
+// isn't ASCII, or of an ASCII name with a space whose front part is a family, which takes about a second here
+// (gfxPlatformFontList.cpp:1752-1781, :3063-3085). Their arrival moves no generation a font group checks and is told to
+// the DOM alone, as a reflow (SharedFontList.cpp:1057-1116, gfxPlatformFontList.cpp:3135-3165, PresShell.cpp:11042-11047).
+// So a context first used before it stays on the fallback for a family named by its Japanese name, or by a legacy name
+// like `Avenir Next Condensed Heavy`, while the DOM and a new context find the family. Nothing a page can assign makes it
+// look again: the same font string returns early, another string and back finds the old font group in the context's own
+// cache, which reset() leaves alone, and fontKerning or lang changed and back makes a new group once and finds that one
+// ever after (CanvasRenderingContext2D.cpp:4409-4478, :5480-5523; probes/contexts-start-up.ts S1, S2,
+// probes/contexts-heal-attack.ts H5). That gives back what the list bought Firefox: ×0.92 on the chat mix and ×0.75 on
+// plain ASCII (research/PERF-LIFETIME.md). It keeps the damage to the paragraphs prepared before the names arrived and
+// doesn't mend those: a prepared paragraph holds its contexts and its fills ask them again, so such a paragraph lays out
+// with the fallback until the page prepares it again, as after any font change, and one first filled after the names
+// arrived measures with two fonts, since the contexts its fill makes find the family. Here nothing tells the page when
+// (tools/contexts-heal-attack-probe.ts K1, K3).
 // Invalidated in WebKit alone, by one thing a page does itself: adding a FontFace that has already loaded (load() first
-// and add() after, or a FontFace made from bytes) to a document.fonts that holds no face yet. WebKit's font cache leaves
+// and add() after, or a FontFace made from bytes) to a document.fonts that holds no face. WebKit's font cache leaves
 // the page's font set out of its key while the set is empty, and the set tells a context's font about a new face before
 // the face is in it, so the kept context asks again and gets the fonts it had (FontCascadeCache.cpp:104-115,
 // CSSFontSelector.cpp:526-539, CSSFontFaceSet.cpp:203-209). It stays on the fallback until the set changes again, so a
```

**Diff 2, `rebuild/probes/contexts-start-up.ts`:**

```diff
--- a/rebuild/probes/contexts-start-up.ts
+++ b/rebuild/probes/contexts-start-up.ts
@@ -33,7 +33,7 @@
 //   a machine whose load changed during the run.
 //
 // Per declaration and way: every change of the answer with the time of the reading that first showed it. A list of one
-// entry never changed. The verdicts are in research/PERF-LIFETIME.md ("Kept contexts in a browser that has just started").
+// entry never changed. The verdicts are in research/PERF-LIFETIME.md ("What landed", "Gecko keeps no list").
 //
 // Run under the browser lock, from the worktree (S2 waits, so give it a longer probe timeout):
 //   python3 .artifacts/session/with-browser-lock.py contexts-start-up --browser=firefox -- bun rebuild/probes/runner.ts \
```

**Diff 3, `rebuild/bench/page.ts`:**

```diff
--- a/rebuild/bench/page.ts
+++ b/rebuild/bench/page.ts
@@ -890,7 +890,9 @@
 
 type KindTotals = ChatPhases['byKind'][number]
 
-// `keeping`: every pass starts one list of contexts for its messages (prepare() handed a page's); otherwise every message its own.
+// `keeping`: every pass starts one list of contexts for its messages and hands it to both halves, which is prepare() handed a
+// page's list in Blink and WebKit; in Firefox prepare() never shares (src/index.ts prepare), so there this table shows what a
+// shared list would cost, not what a page gets. Otherwise every message its own.
 function chatPhases(c: Context, chat: ChatPlan, setIndex: number, keeping: boolean): ChatPhases {
   const inputs = chatInputs(c, chat.sets[setIndex]!.id, chat.timed)
   const env = c.env
```

**Texts to add to the owner's (I can't write `.md` files either):**

- DESIGN.md §4.6, *Lifetime*: read "Gecko's contexts are one prepared paragraph's whatever the caller hands over".
- DESIGN.md §4.6, *What invalidates it*, after "That is why Gecko has no page's list. It gives back ×0.92 on the chat mix and ×0.75 on plain ASCII.": "It keeps the damage to the paragraphs prepared before the names arrived and doesn't mend those. A prepared paragraph holds its contexts and its fills ask them again, so such a paragraph lays out with the fallback until the page prepares it again (`tools/contexts-heal-attack-probe.ts` K1: 6 lines where the DOM has 3), and one first filled after the names arrived measures with two fonts, since the contexts its fill makes find the family (K3: a word broken after its first character). Nothing tells a page when. A page that names its families by their canonical English names never meets this: of 22 names from common font lists, 9 are late names on the lab's Mac, `"ヒラギノ角ゴ ProN W3"` among them (`probes/contexts-heal-attack.ts` H1)." And in the WebKit sentence read "a `document.fonts` that holds no face" (H4: add, delete, add again is stale too), and add: "an installed family that a loaded FontFace of the same name takes over is the same case (H3)."
- DESIGN.md §2 table, "Lives as long as": "the page, in Blink and in WebKit until the page adds a loaded FontFace; one prepared paragraph in Gecko, and wherever none is handed over".
- DESIGN.md §4.6, *What bounds it*: "13 in Firefox" becomes "and Firefox holds none (its 13 were the page's before 2026-09-20)". *What it buys*: after Firefox's numbers, "which Gecko gave back on 2026-09-20 (above)".
- TESTS.md, after the item 1 paragraph: "**Since 2026-09-20** Gecko's `prepare` makes its contexts anew whatever list it is handed (DESIGN.md §4.6), so in Firefox a page predictor's run is a usual run. The quick gates exit 0 with tier 1 at 0 predictions and 0 questions changed on the six references. New unit test in `src/measure/font-checks.test.ts`: a family that contexts learn only at their first use shows in Gecko's next call though the caller keeps one list. New probes: `probes/contexts-start-up.ts`, `probes/contexts-heal-attack.ts`, `tools/contexts-start-up-probe.ts`, `tools/contexts-heal-attack-probe.ts`."
- rebuild/bench/README.md, with the owner's sentence: "The phases pass with one list hands the list to the two halves itself, so in Firefox its table still shows a shared list, which no page gets."
- rebuild/probes/README.md, two more entries: "`contexts-heal-attack.ts` (H1 to H5, 2026-09-20): the second reading of `contexts-start-up.ts`. Which names pages write are late names in Firefox (9 of 22), that a used `local()` rule, `reset()` and a resize don't bring a kept Firefox context back, an installed family taken over by a loaded FontFace, and WebKit's case after the font set was emptied." and "`../tools/contexts-heal-attack-probe.ts` (K1 to K3): a paragraph prepared at the start of a Firefox that has just started and kept. It stays on the fallback, and first filled after the names arrived it measures with two fonts."
- LEDGER.md entry 15, add to **Actual**: "`reset()` and a resize, each followed by the settings again, don't heal it either, nor does a font set that used a `src: local()` rule. Of 22 family names from common CSS font lists 9 behave so on this Mac, `"ヒラギノ角ゴ ProN W3"` among them." Add to **Source**: "`reset()` reaches `SetInitialState` (`CanvasRenderingContext2D.h:124-128`, `.cpp:1871`) and leaves the context's cache of font groups alone (`:4457-4466`, `:4606-4608`)." Add to **Pretext**: "The rule ends the damage with the paragraphs prepared inside the window. Those stay wrong until the page prepares them again, and one first filled after the names arrived measures with two fonts (`tools/contexts-heal-attack-probe.ts` K1, K3)."
- LEDGER.md entry 16, title and steps: "a font set that holds no face" instead of "a page's first FontFace"; add to **Actual**: "The same after the set was emptied again (add, delete, add a loaded face: 384.06 against 295.97 px), and for an installed family that a loaded FontFace of the same name takes over (324.54 against 295.97 px)."

### 6. Verdict per commit

| Commit | Verdict |
|---|---|
| 566b329 the rule, its comment, `canvas.ts`'s header, the unit test | **merge**; its comment's wording is changed by diff 1, as one commit on top |
| 05b230c probe S1 to S3, W1 to W8, T1 | **merge after diff 2** |
| 09a3a54 library probe L1, L2 | **merge** |
| f1ff779 W9, W10 | **merge** |
| 2be9c0e WebKit wording in `prepare`'s comment | **merge**; "no face yet" is changed by diff 1 |
| ffa5d49 lab and bench comments | **merge after diff 3** |
| 3e3606b, 7e3e12f, 0fdb6a3 rewrap and wording | **merge**. Five of the nine commits edit one comment; squashing them into 566b329 would read better, and is the orchestrator's call |
| The documents' texts | **not mergeable as they are**: the code must not land before DESIGN.md and PERF-LIFETIME.md stop saying "only webkit-host needs a contract". Paste the owner's texts with the additions above, in the same merge |
| Mine: 537f8ee, 85098f1, a7696f0, ab7f68e, 89cde07, 7ec4407, f7530b1 | probe files only; merge them if the orchestrator wants the evidence beside the owner's. K1 and K3 are what the new DESIGN sentence cites |

### 7. The three sentences for the maintainer

1. The study is right and the rule should merge: in Firefox a Canvas context fixes its family names at its first measurement, names that Japanese and Chinese font lists use (`"ヒラギノ角ゴ ProN W3"`, `"黑体-简"`) arrive about a second after a new browser first asks, no event and no call (not `reset()`, not the same font again) makes a kept context look again, so Gecko can't keep a page's list, and giving it up costs 0.12 to 0.25 s per 10,000 plain messages and about 0.34 s per 10,000 rich ones.
2. But the rule doesn't make a Firefox page right: a prepared paragraph holds its contexts too, so everything prepared before the names arrive (the first screen of a restored session) stays on the fallback font, and a paragraph first filled afterwards even measures with two fonts and broke a word after its first character in my probe, until the page prepares it again, which nothing tells it to do; the documents must say this, and tell pages the one thing that avoids it, which is to name families by their canonical English names.
3. Keep WebKit's list and its contract, worded as what a page does anyway (after it adds faces it prepares its paragraphs again, with a new list), because the narrow cause depends on a private cache key (I found it holds whenever the font set is empty, not only before its first face), and because a rich message makes 21 contexts in WebKit and 40 in Chrome, so the list is worth more there than the plain bench shows.

### 8. Needs the maintainer

1. **Accept Gecko without a list**, knowing what it does and doesn't give (sentences 1 and 2). I agree with the owner.
2. **Where to tell pages about canonical family names.** The rebuild has no user document yet. DESIGN.md §4.6 for now; the API phase's README later. Main's README could say it today, since main is stale the same way.
3. **WebKit: the broad wording or the narrow one** for what a page is asked. I would ask the broad one and explain with the narrow one.
4. **The two bug candidates** still need a reduced page and a tracker search each (the owner's item). H5 and K3 give entry 15 two more steps a report can use: `reset()` doesn't help, and one paragraph ends up on two fonts.
5. Nobody has measured the memory of 36,000 to 89,000 live contexts in Firefox for 10,000 kept messages, which the rule brings back.

### 9. Runs, commits, what I didn't do

- Browser runs, all exit 0, each a fresh launch: Firefox S1, H1, H2, H3, H5, K1 ×2, K2, K3 ×2, the owner's L1; webkit-host H3, H4, the owner's W8, W9, T1; Chrome the owner's S1, H1, H3; one bench chat smoke in Firefox. 19 run folders under `P/attack`, one under `T/attack`.
- Offline: the owner's stand-in count again (16 minutes under a load of 40), my rich count, the unit tests, the mutation check in a scratch worktree made and removed through `git worktree`.
- The machine was never quiet: other owners' exclusive timed jobs followed each other all morning. My slot jobs waited 52 minutes for their first slot and starved a second time, so I stopped my own waiting jobs (process ids I had written down, none holding a slot) and ran each browser's probes inside one slot, one fresh launch after another. I timed nothing of my own; T1's rerun is ratios only.
- Not done: the gates again (same library code as the owner's second run), tier 2 (a caller without a list can't see the change), a base-tree rerun of L1, Windows and Linux (the 60 s delay and which names are late there are from source only), a worker run, memory.
- My first log times ran a few minutes ahead of the clock; the log has a correction note. Wall clock used: about 2 hours of the 4.

## Kept Canvas contexts that answer otherwise than new ones: the map per engine, the rule, and what was built (2026-09-20)

Branch `x-contexts-heal` (worktree `~/github/pretext-rebuild-wt/contexts-heal`, base 081fc77), local only. Nothing merges. This text is also saved as `~/github/pretext-rebuild/.artifacts/tests/runs/contexts-heal-20260920/REPORT-contexts-heal.txt`.

Paths:
- `P` = `~/github/pretext-rebuild/.artifacts/probes/contexts-heal`. One folder a probe run, named `<browser>-<probe>-<k>`, each with the runner's `<browser>-probes.json`, `run.log` and `exit`. My scripts are in `P/tools` (`probe.sh`, `chain.sh`, `lib-chain.sh`, `timed.sh`, `summary.py`).
- `T` = `~/github/pretext-rebuild/.artifacts/tests/runs/contexts-heal-20260920`: the gates' logs, the offline count and this text.
- Source paths: `F/` = `~/github/browser-engines/firefox-156.0/`, `W/` = `webkit-7625.1.29.11.27/Source/WebCore/`, `B/` = `chromium-153.0.8010.48/third_party/blink/renderer/`.

Words used:
- **Kept context**: a Canvas context made once and used again later, as a page's list of contexts holds it.
- **New context**: a context made at the moment of the question, with the same settings.
- **Stale**: a kept context answers otherwise than a new one for the same string.
- **The list**: the `Context[]` a page hands to every `prepare` (`rebuild/src/index.ts`).
- **A browser that has just started**: a fresh launch of the pinned browser by the probe runner, which every run here is.
- **Late names**: the family names Firefox reads from the fonts' name tables after start-up: localized names ("ヒラギノ角ゴシック") and legacy family names of single faces ("Avenir Next Condensed Heavy").
- **A loaded FontFace being added**: `await face.load()` first and `document.fonts.add(face)` after, or a FontFace made from bytes. It is how most pages that load fonts by script do it.

### 0. Outcome

- **Firefox: a kept context can be stale for ever, no assignment makes it look again, and no page can know when.** So no rule is both exact and cheap there. I built [D]: Gecko's contexts are one call's, whatever list the caller keeps. Library code +4 −1 lines in one file. It gives back what the list bought Firefox: ×0.92 on the chat mix (2.51 to 2.76 s per 10,000 messages) and ×0.75 to ×0.80 on plain ASCII (0.46 to 0.58 s), both far under or near the 2 s bar for reasons the list never touched.
- **WebKit: the stale case is much narrower than the documents say, and I found its cause in source.** A kept context misses only a loaded FontFace added to a `document.fonts` that holds no face yet. A FontFace added before it loads, an `@font-face` rule, a face added to a set that already holds one, and a second face added after the first all reach a kept context by themselves (probes W1 to W10). The page does this itself, so it can keep the contract. The contract stays, with exact wording.
- **Chrome: nothing of the kind.** By source a canvas font asks the page's font selector again whenever its fallback list was marked invalid, and shares that list with the DOM. In a Chrome that has just started: 0 stale ways in S1, S3, W1 to W8, L1, L2.
- **The late characters in Firefox (U+20BF) move a kept context, a new one and the DOM at the same reading** (4 of 4 runs here, 3 of 3 of the earlier A5). The list doesn't matter to them.
- **Proof of the build:** a unit test that fails without the rule (checked in a scratch copy); quick offline gates exit 0 with tier 1 at 0 predictions and 0 questions changed in all six references; in a Firefox that has just started the library with a kept list follows a new list and the DOM (2 of 2), where the base tree's kept list stays at 6 lines against the DOM's 3 (2 of 2).

### 1. The map

#### 1a. Firefox: late names

What the probes show. `rebuild/probes/contexts-start-up.ts` S1: 11 font declarations, each with 11 contexts made before anything is measured, one per way of touching it, read every 250 ms for ten seconds beside a new context and a DOM span. Runs `P/firefox-S1-1`, `P/firefox-S1-2`; the first form of the probe, which also added web fonts four seconds in, is `P/firefox-S3-firstform-1`.
- The four late-name declarations (Japanese, Chinese and Korean names, and the English legacy name `Avenir Next Condensed Heavy`) start on the monospace fallback, 385.33 px. A new context finds the family at 1,766 and 1,796 ms (369.25 px for Hiragino Sans), the DOM one reading later, at 2,025 and 2,089 ms.
- The kept context stays at 385.33 px for the whole ten seconds. So do: the same font string assigned again; another font string and back, from the start or only from five seconds in; `letterSpacing` changed and back; `fontKerning` or `lang` changed and back at every reading from the start.
- `fontKerning` or `lang` changed and back for the first time AFTER the names arrived does heal (5,100 and 5,186 ms). So such a change works once per context.
- `fontKerning` changed and back, then a spelling of the same font string the context has never seen (one more trailing space each time), heals at the same reading as a new context.
- A context whose font was assigned at the start and that was first measured five seconds in is right. The names are resolved at the first measurement, not at the assignment.
- English canonical names, a family that doesn't exist, `sans-serif` under `ja`, `serif` under `zh-CN` and `system-ui` under `ja` never moved in any run.
- S2 (`P/firefox-S2-1`): the same page after twelve idle seconds. Every name resolves from the first reading. So the names come by themselves.
- S3: when the page's own FontFaces were added at four seconds, EVERY stale context healed at the next reading (4,383 ms). A change of the page's font set makes Firefox's font groups resolve their lists again.

The mechanism, from the pinned source.
- A Canvas context holds a `gfxFontGroup`. It resolves its family list once, lazily, in `EnsureFontList`, and again only when the platform font list's generation moves or the page's user font set was rebuilt (`F/gfx/thebes/gfxTextRun.cpp:1917-1990`, `UpdateUserFonts` at `:3946-3965`). That second check is why web fonts heal, and why S3's added FontFaces healed everything.
- A lookup of a name the shared font list doesn't hold asks the parent process to load the other names, deferred (`F/gfx/thebes/gfxPlatformFontList.cpp:1752-1781`, `:930-967`). The parent starts its font info loader at once (`:3063-3085`); without any ask the loader starts `gfx.font_loader.delay` after start-up, 8,000 ms on macOS and 60,000 ms on Windows (`F/modules/libpref/init/StaticPrefList.yaml:7831-7838`). A lookup triggers the load only for a name that isn't ASCII, or an ASCII name with a space whose front part is a known family.
- When the names are in, the parent writes the alias table into the shared list (`FontList::SetAliases`, `F/gfx/thebes/SharedFontList.cpp:1057-1116`). That moves NO generation (the generation is written once, at `:726`). Then it forces a global reflow (`gfxPlatformFontList.cpp:3135-3162`), which is the observer topic `font-info-updated`, and the only listener is `PresShell` (`F/layout/base/PresShell.cpp:878`, `:11042-11047`, then `nsPresContext::ForceReflowForFontInfoUpdate`, `F/layout/base/nsPresContext.cpp:190-232`, which flushes the font cache). A Canvas context is never told. `dom/ipc` is not in the pinned tree, so the content process's side of the broadcast is from memory.
- Why no assignment helps: `SetFontInternalDisconnected` returns early when the font string is the current one (`FontIsUnchanged`, `F/dom/canvas/CanvasRenderingContext2D.cpp:4409-4421`). Otherwise it looks in a cache the context owns, keyed by font string, language, stretch, caps, kerning and the user font set's rebuild generation, and hands back the OLD font group (`:4456-4478`). Nothing ever clears that cache. A changed `fontKerning` or `lang` drops the group, and the next measurement builds one under the RESOLVED font string's key (`:5480-5523`); that key is new the first time and hit ever after. This is exactly the once-only healing the probe shows.

How long the window lasts here. It opens at the browser's start. It closes when the loader is done: 0.6 to 1.8 s after the first ask on this machine (new contexts changed at 585, 811, 1,125 and 792 ms in the earlier A3 and A8 runs; at 1,259, 1,766, 1,796, 1,745, 1,733, 1,808 and 1,508 ms in mine, on a busier machine), or about 8 s after start-up with no ask. It depends on the number of installed families, the load, and on Windows a 60 s delay. The STALENESS has no end: a context first measured inside the window stays on the fallback until the page's font set changes.

Who is affected. Localized names (19 of 22 in the earlier A3) and English legacy family names (`Avenir Next Condensed Heavy`; on Windows the same class holds names like `Segoe UI Light`). Not English canonical names, not generic keywords here, not web fonts (W1 to W8 in Firefox: 0 stale ways).

#### 1b. Late web fonts

- Firefox and Chrome: a kept context follows by itself on all four routes, with and without DOM text in the family (`P/firefox-W-1`, `-W7-1`, `-W8-1`, the same for chrome: 0 stale ways).
- webkit-host (`P/webkit-host-W-1`, `-W7-1` to `-W10-1`):

| Route, two seconds in | Kept context |
|---|---|
| W1, W4: a FontFace made from bytes, loaded, then added | stale for the six seconds left |
| W7, W8: a FontFace with a URL, loaded, then added | stale |
| W2, W5: a FontFace with a URL, added, then loaded | heals at the reading a new context does |
| W3, W6: an `@font-face` rule | heals |
| W9: W8 in a page whose font set already holds another face | heals |
| W10: two faces of two families, each loaded then added, one after the other | both heal |

  With a span in the family or without any DOM text in it makes no difference. Where it is stale: the same string assigned again, `fontKerning`, `lang` and `letterSpacing` changed and back don't heal; another font string and back does, from the start or late. A context first measured after the add is stale too.
- The cause, from source, and W9 and W10 were written to test it:
  - `OffscreenCanvasRenderingContext2D::setFont` returns early for the current string (`W/html/canvas/OffscreenCanvasRenderingContext2D.cpp:101-102`), and any other string makes a new `FontCascade`. That is the probe's "same string no, another string and back yes".
  - The context's font does listen to the page's font selector (`FontProxy::fontsNeedUpdate`, `W/html/canvas/CanvasRenderingContext2DBase.cpp:478-506`) and asks the font cache for its fonts again. That is why the URL and rule routes heal.
  - The font cache leaves the page's font set out of its key while the set holds no face (`makeFontCascadeCacheKey`, `W/platform/graphics/FontCascadeCache.cpp:104-115`; `isSimpleFontSelectorForDescription`, `W/css/CSSFontSelector.cpp:526-539`). And the set tells its listeners about a new face BEFORE the face is in it (`CSSFontFaceSet::add`, `W/css/CSSFontFaceSet.cpp:203-209`). So when the page's first face is added already loaded, the kept context asks again under the old key and gets the fonts it had, realized with the fallback; nothing tells it again. A new context is keyed with the set and finds the face. A load that finishes later, or any further change of the set, tells the listeners again under the full key, and the kept context heals.
- So WebKit's contract is: a page that adds loaded faces starts a new list after it. The page does the adding itself, so it can keep this.

#### 1c. Firefox: characters found only by the global fallback

`the bench list with U+20BF` in S1, S2 and S3: the kept context, every way of touching it, a new context and the DOM span all change at the SAME reading (263.38 to 268.92 px at 2,025 and 2,089 ms in S1, 331 ms in S2 and 1,774 ms in S3). The earlier A5 files show the same for kept and new (1,093, 1,070, 798 ms). The state is the content process's, so a list neither causes nor hides it. S2 shows it is not the late names: there the names were in from the start and the character still moved at 331 ms.

#### 1d. Chrome

- Source: a `Font` checks its fallback list at every use and gets a new one when the list was marked invalid (`B/platform/fonts/font.cc:71-77`). The lists live in the font selector's map, shared by Canvas and DOM, which marks them invalid when fonts need an update and when the system font cache is invalidated (`B/platform/fonts/font_fallback_map.cc:29-67`). The canvas state doesn't even reset its font (`B/modules/canvas/canvas2d/canvas_rendering_context_2d_state.cc:252-263`). The per-canvas text cache is keyed by that list (`B/platform/fonts/plain_text_painter.cc:266-270`), so a string measured before is shaped again.
- Probes in a Chrome that has just started: localized and legacy names resolve from the first reading; 0 of 11 declarations have a stale way in `P/chrome-S1-1`, 0 of 14 in `P/chrome-S3-firstform-1`, 0 in W1 to W8, and the library's kept list equals a new list and the DOM in `P/chrome-L1-head-1` and `-L2-head-1`.

### 2. The candidates, weighed

What a context costs, and what each way of touching one costs (probe T1, µs an operation, the median of five rounds with the ways taking turns; first number from one exclusive stretch, `P/<browser>-T1-exclusive-1`, in brackets a normal slot on a loaded machine, `P/<browser>-T1-1`; two font lists, which agree):

| | Chrome | Firefox | webkit-host |
|---|---|---|---|
| a new context, measured once | 21 to 26 (26 to 36) | 3.8 to 3.9 (9.7 to 10.8) | 1.5 to 1.6 (3.4) |
| the kept context, measured | 0.12 to 0.19 (0.23) | 0.37 to 0.39 (0.83 to 0.95) | 0.11 to 0.12 (0.21 to 0.24) |
| the same string again | 0.12 to 0.20 (0.25) | 0.53 to 0.54 (1.2 to 1.3) | 0.11 to 0.14 (0.23 to 0.26) |
| another string and back | 0.40 to 0.57 (0.89) | 0.72 to 0.77 (1.6 to 1.7) | 1.30 to 1.35 (2.9) |
| `fontKerning` and back, then a new spelling | 0.49 to 0.60 (1.1) | 1.5 to 1.7 (3.7 to 4.8) | 0.91 to 0.93 (1.9 to 2.0) |

Contexts a chat message makes with no list: Chrome 11.07 on the mix and 10 on ASCII, Firefox 3.56 and 2.94, webkit-host 5.38 and 5 (browser counts, research/PERF-LIFETIME.md). Offline under the stand-in Canvas (2,000 messages, prepare and every line at 320 px, `T/stack-count.json`, script `T/tools/stack-count.ts`): Gecko 4.02 and 3.58 whatever the font list; Blink 10.5 and 10.0, and 14.5 and 14.0 when two missing families come first, because the checks walk them; WebKit 5.0, and 9.0. With one list all are under 0.01.

| | Exact? | Cost a prepare | Code | Reads anything forbidden? |
|---|---|---|---|---|
| [A] contract only | Firefox: no. The page would have to remake its list when Firefox has read the late names. No event says so, `document.fonts` doesn't change, and on Windows it can be a minute in. WebKit: yes, the page adds its faces itself. | 0 | 0 | no |
| [B] the library makes a kept context look again | WebKit: yes, by another font string and back. Firefox: only by the never-seen spelling, which leans on the keys of a private cache and needs a font string that grows for ever: a detect-and-patch trick, rejected. | WebKit: 1.30 of the 1.54 µs a new context costs, so the list would keep a sixth of its gain; and it needs a mark of "looked at in this prepare" on each context. Firefox's trick: 1.5 of 3.8 µs. | about 10 lines and a field | no |
| [B'] only while a listed family doesn't draw | no: the font checks' own contexts are kept and go stale the same way, and Gecko asks the checks nothing. Telling needs a new context, which is the cost being avoided. | | | |
| [C] a context whose families don't all draw is not kept | yes, if the test runs on new contexts and counts "can't tell" as "doesn't draw" | a page whose list names one missing family gets nothing from the list, for ever: Gecko 4.0 and 3.6 contexts a message, WebKit 5 to 9, plus two new contexts per listed family for the test. `-apple-system, "Segoe UI", Roboto, sans-serif` on a Mac is such a list. | 20 to 30 lines in the measuring path | no |
| [D] Gecko keeps no list | yes, by construction: every prepare measures with contexts made in it, as before the list | gives back ×0.92 and ×0.75 to ×0.80: 25 µs a message on the mix and 12 µs on ASCII (2.76 against 2.51 s and 0.58 against 0.46 s per 10,000, the review's quiet passes in research/PERF-LIFETIME.md §3) | +4 −1 | no |
| [E] read `document.fonts` or watch a sentinel element | would tell WebKit's case and, after the fact, Firefox's | | | yes: DOM reads. Rejected up front. |

Why [D] and not [C] for Firefox: [C] keeps the gain only for pages whose every listed family exists on the machine, costs most pages what [D] costs, and adds a test with its own blind spots to the measuring path. What [D] gives up is 0.12 s per 10,000 ASCII messages and 0.25 s on the mix, in the engine whose remaining time is the CJK and Arabic fill.

Why the contract stays for WebKit: it asks the page for something it does itself. Dropping the list there too would remove the last contract for 0.10 s per 10,000 messages (0.131 to 0.235 s on the mix, 0.10 to 0.195 s on ASCII). That is the maintainer's call (section 5).

### 3. What was built

Nine commits on 081fc77, head 0fdb6a3:
- 566b329 the rule. `rebuild/src/index.ts` `prepare`: the Gecko case makes a list of its own for the checks and the port. The comment on the list is rewritten; `measure/canvas.ts`'s header follows. Unit test in `measure/font-checks.test.ts`: a stand-in context that keeps the families it found at its first measurement; a family that arrives between two calls shows in Gecko's second call though the caller keeps one list, the caller's list stays empty, and the control (WebKit with a kept list) stays on the fallback while a new list finds the family. In a scratch copy with the rule undone the test fails (23 pass, 1 fail).
- 05b230c, f1ff779 `rebuild/probes/contexts-start-up.ts`: S1 to S3, W1 to W10, T1.
- 09a3a54 `rebuild/tools/contexts-start-up-probe.ts` with its entry: the library with one kept list beside the DOM (L1, L2).
- 2be9c0e, 7e3e12f, 0fdb6a3, 3e3606b comment wording and wrapping. ffa5d49 the lab's page predictor and the bench say what a list does in Firefox now.

Proof:
- Quick offline gates on 05b230c: exit 0, 25 gates in 573 s (`T/gates-quick-05b230c.log`). Tier 1: 0 predictions changed and 0 questions changed in all six references. Chrome's exit 3 is the standing storage rule with the standing 65,764 and 5,105 cases, the numbers the base already had. After that commit `rebuild/src` changed in comments only; a second quick run on the head 0fdb6a3 says the same: exit 0, 25 gates in 709 s, tier 1 at 0 and 0 in all six (`T/gates-quick-0fdb6a3.log`).
- `tsc` clean for `rebuild` and `rebuild/probes`; the citation ledger's check reports 0 lost.
- L1 in a Firefox that has just started, three words and three numbers at 32px in 380 px, six lines in monospace and three in the family:

| | DOM | kept list | new list | contexts in the kept list |
|---|---|---|---|---|
| head, run 1 (`P/firefox-L1-head-1`) | 6, then 3 at 2,020 ms | 6, then 3 at 1,745 and 2,020 ms | 6, then 3 at 1,745 ms | 0 |
| head, run 2 (`-head-2`) | 3 at 1,808 ms | 3 at 1,808 ms | 3 at 1,808 ms | 0 |
| base 081fc77, run 1 (`-base-1`) | 3 at 1,733 ms | 6 for all eight seconds | 3 at 1,733 ms | 1 |
| base, run 2 (`-base-2`) | 3 at 1,508 ms | 6 for all eight seconds | 3 at 1,508 ms | 1 |

  In run 1 the names arrived in the middle of a reading, between two calls: a new context sees them the moment the parent process writes them, up to a reading before the DOM reflows.
- L2, a loaded FontFace added two seconds in: Chrome and Firefox follow with every list; webkit-host's kept list stays at 6 lines, and a list the page starts anew right after its own `add()` gives 3 with the DOM at 2,282 ms (`P/webkit-host-L2-head-1`). That is the contract at work.

Not run: tier 2. The change can't be seen by a caller that passes no list, which is every lab predictor but the page ones, and in Firefox the page predictor now is the usual one. The bench was not rerun: in Firefox its one-list rows now measure what its list-a-message rows measure.

### 4. The documents' texts

`rebuild/src/index.ts`'s comment is in the commits. The rest, to paste:

**DESIGN.md §4.6, "A page's list of contexts", the two bullets.**

- *Lifetime.* The caller's, in Blink and WebKit: a page's, or one call's. A call that is given none starts an empty list, and then nothing outlives a prepared paragraph, which is what the lab's usual predictors do, so a recorded case stays what one paragraph asks and tier 1 stays sound per case. A page keeps one array and hands it to every `prepare`. Gecko's contexts are one call's whatever the caller hands over (`index.ts` `prepare`): a kept Firefox context can answer otherwise than a new one, and no page can know when.
- *What invalidates it.* In Chrome nothing: a canvas font asks the page's font selector for its fallback list again once the list was marked invalid, and the DOM uses the same list. In WebKit one thing a page does itself: adding a FontFace that has already loaded to a `document.fonts` that holds no face yet. WebKit's font cache leaves the page's font set out of its key while the set is empty, and the set tells a context's font about a new face before the face is in it, so the kept context asks again and gets the fonts it had; it stays on the fallback until the set changes again. A page that adds loaded faces starts a new list after it, where it prepares its paragraphs again, which main's cache asks of its caller too. A FontFace added before it loads, an `@font-face` rule, and a face added to a set that holds one reach a kept WebKit context by themselves (probe `contexts-start-up` W1 to W10, 2026-09-20; `contexts-font-load` is the first of these routes). In Firefox a context resolves its family names at its first measurement, and Firefox reads the fonts' localized and legacy family names after start-up (8 s in, 60 s on Windows, or from the first ask, about a second's work on the lab's machine). Their arrival moves no generation a font group checks and reaches the DOM alone, as a reflow. A context first used before it stays on the fallback for `"ヒラギノ角ゴシック"` or `"Avenir Next Condensed Heavy"` for as long as it lives, and nothing a page can assign makes it look again (probe `contexts-start-up` S1, S2; `tools/contexts-start-up-probe.ts` L1 shows the base tree's kept list at 6 lines beside the DOM's 3). That is why Gecko has no page's list. It gives back ×0.92 on the chat mix and ×0.75 on plain ASCII. Paragraphs prepared before a font change are stale in every engine, as they always were. What doesn't invalidate it: (the two sub-bullets stay)

**DESIGN.md §2 table, the row "List of contexts", column "Lives as long as":** the page, in Blink and in WebKit until the page adds a loaded FontFace; one `prepare` call in Gecko, and wherever none is handed over.

**research/PERF-LIFETIME.md, "What landed", the first bullet replaced, and one added:**

- **Lifetime, invalidation, bound:** the list is the caller's in Blink and WebKit (a page's, or one call's when nothing is passed). Chrome's kept contexts follow every font change by themselves. webkit-host's miss one: a loaded FontFace added to a font set that holds no face yet, after which the page makes a new list. `prepare` empties a list longer than 512 contexts (the rest of the bullet stays).
- **Gecko keeps no list (2026-09-20).** In a Firefox that has just started, a context first measured before Firefox has read the fonts' localized and legacy family names stays on the fallback font for as long as it lives, while the DOM and a new context find the family about a second later. The same font string, another string and back, and a changed `fontKerning` or `lang` don't make it look again (a per-context cache hands the old font group back), and no event tells a page. So `prepare` makes Gecko's contexts anew at every call. That gives back the ×0.92 and ×0.75 below. What would get it back: Firefox telling Canvas font groups about `font-info-updated`. Probes `probes/contexts-start-up.ts` and `tools/contexts-start-up-probe.ts`; runs under `.artifacts/probes/contexts-heal`.

**research/PERF-CONTEXT-STORE.md, the orchestrator's reading, the sentence "It is being studied separately; until then the contract reads ...":** It was studied (2026-09-20): Gecko keeps no list, and WebKit's contract is narrower than "the page's fonts change" (research/PERF-LIFETIME.md, "What landed").

**rebuild/probes/README.md, two entries:**

- `contexts-start-up.ts` (S1 to S3, W1 to W10, T1; 2026-09-20): every way a kept Canvas context can answer otherwise than a context made now, raw Canvas beside the DOM, one probe a browser launch. S1 to S3 read 11 to 14 font declarations for ten seconds in a browser that has just started, each with a context per way of touching it. W1 to W10 bring one web font in by four routes, with and without DOM text in the family, into an empty font set and into one that holds a face. T1 times each way beside making a context. Verdicts: Firefox's kept contexts stay on the fallback for family names it learns after start-up and nothing assigned heals them; webkit-host's miss only a loaded FontFace added to an empty font set; Chrome's follow everything. Runs under `.artifacts/probes/contexts-heal`.
- `../tools/contexts-start-up-probe.ts` (L1, L2): the library with one kept list beside the DOM and a new list, for the late names in a browser that has just started and across a loaded FontFace being added.

**rebuild/bench/README.md, one sentence where the one-list rows are described:** In Firefox `prepare` makes its contexts anew whatever list it is handed, so row E and the one-list headline measure there what a list a message measures.

**rebuild/platform-bugs/LEDGER.md, two candidates in the file's form** (no page was reduced and `pages/index.json` is untouched; the probe is the evidence until someone reduces one).

### 15. Firefox: a canvas context first used before the late family names arrive stays on the fallback font

- **Browser:** Firefox 156.0, a browser that has just started. macOS 27.0.
- **Steps:** in a new browser, make an OffscreenCanvas context with `font = '32px "ヒラギノ角ゴシック", monospace'` and measure `Hamburgefonstiv 0123` at once; three seconds later measure again on the same context and on a new one, beside a DOM span in the same font. `rebuild/probes/contexts-start-up.ts` S1 does this for four such names and eleven ways of touching the context.
- **Expected:** the kept context measures what the DOM and a new context measure.
- **Actual:** 385.33 px (monospace) everywhere at the start. After 0.6 to 1.8 s a new context and the DOM span measure 369.25 px (Hiragino Sans). The first context stays at 385.33 px for as long as it lives. Assigning the same font, another font and back, `letterSpacing`, and `fontKerning` or `lang` changed and back from the start don't heal it. The same for the Chinese name of PingFang SC, the Korean name of Apple SD Gothic Neo and the English legacy family name `Avenir Next Condensed Heavy`. A change of the page's FontFaceSet heals every such context. A page that waits twelve seconds first shows nothing.
- **Source:** the font group resolves its list once (`F/gfx/thebes/gfxTextRun.cpp:1917-1990`); the late names arrive by `FontList::SetAliases`, which moves no generation (`F/gfx/thebes/SharedFontList.cpp:1057-1116`), and by `font-info-updated`, which only `PresShell` observes (`F/layout/base/PresShell.cpp:11042-11047`); the context's own font group cache hands the old group back (`F/dom/canvas/CanvasRenderingContext2D.cpp:4409-4478`).
- **How sure:** high on the behaviour (2 of 2 S1 runs, the first form's run, 4 of 4 of the earlier A3 and A8 runs). High on the cause: the once-only healing by `fontKerning` and the healing by a never-seen spelling are what the cache's keys predict.
- **Tracker:** not searched.
- **Pretext:** why Gecko's contexts are one call's (`rebuild/src/index.ts` `prepare`). Main keeps one context and assigns it each font string in turn (`src/measurement.ts:127-176`), which is S1's "another string and back", so main's context is stale the same way, on top of the widths its cache holds. A paragraph prepared inside the window is wrong until it is prepared again, in the rebuild and in main.

### 16. WebKit: a kept canvas font misses a page's first FontFace when the face had loaded before it was added

- **Browser:** WebKit 22625.1.29.11.27 in the lab's WKWebView host. macOS 27.0.
- **Steps:** with no `@font-face` rule and an empty `document.fonts`, make an OffscreenCanvas context with `font = '32px "Late", monospace'` and measure; then `const f = new FontFace('Late', 'url(...)'); await f.load(); document.fonts.add(f)`; measure again on the same context and on a new one. Probe W7 and W8; W1 and W4 with a FontFace made from bytes.
- **Expected:** both measure with the loaded face.
- **Actual:** the new context measures 295.97 px, the kept one stays at 384.06 px. The same font string assigned again doesn't heal it; another font string and back does. It heals by itself when the face was added before it loaded (W2, W5), when it came by an `@font-face` rule (W3, W6), when the set already held another face (W9), and when a second face is added after it (W10).
- **Source:** `W/platform/graphics/FontCascadeCache.cpp:104-115` leaves the font selector out of the key while `isSimpleFontSelectorForDescription` holds, which is while the set has no face (`W/css/CSSFontSelector.cpp:526-539`), and `CSSFontFaceSet::add` tells its observers before it inserts the face (`W/css/CSSFontFaceSet.cpp:203-209`).
- **How sure:** high on the behaviour (one run a probe, ten probes that agree with each other and with the 2026-09-19 `contexts-font-load` run). High on the cause: W9 and W10 were written from it and came out as it says.
- **Tracker:** not searched.
- **Pretext:** WebKit's contract for a page's list of contexts.

### 5. Needs the maintainer

1. **Gecko keeps no list: accept giving back ×0.92 and ×0.75?** I found no exact rule that keeps any of it cheaply. [C] would keep it only for pages whose every listed family exists.
2. **WebKit: keep the contract, or drop the list there too?** The contract is now narrow and the page can keep it. Dropping it costs 0.10 s per 10,000 messages and removes the last contract; it is one more case like Gecko's in `prepare`.
3. **Two bug candidates** (entries 15 and 16 above) need a reduced page each and a tracker search before anyone files them. Firefox fixing 15 is what would give Gecko its list back.
4. The documents' texts above are not in the tree: this agent can't write `.md` files.

### 6. Runs

All exit 0; no job failed. Browser jobs: 34 run folders under `P`, each with exit 0. S1 ×2, the first form (S3) ×1 and S2 ×1 in Firefox; S1 and S3 once each in Chrome and webkit-host; W1 to W6 in three browsers, W7 and W8 in three, W9 and W10 in webkit-host; T1 twice in three browsers (one exclusive stretch of under two minutes, lock acquired after 0 s); L1 on the head ×2 and on the base ×2 in Firefox, once in Chrome and webkit-host; L2 once in three browsers. Offline: two quick gates runs, the citation check, the stand-in count. The scratch worktree of the base is removed through `git worktree remove`. Progress log: `.progress-heal.txt` in the worktree.
