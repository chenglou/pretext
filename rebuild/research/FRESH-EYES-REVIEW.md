# A fresh-eyes read of the library after the re-architecture, and its adversarial check (2026-09-19)

An independent reviewer who had not worked on the code read the whole library against the maintainer's engineering guide, ran the gates, planted one semantic change per engine to see the gates catch it, and checked the plain path on a fresh seed. It read the tree at `ra-final-shared` (1d9f2f1), before correctness round 5 merged, so line numbers under `src/engines` may have moved. What was done about each finding is recorded in the orchestrator's log and, as it lands, in `SHARED-CHANGES.md`.


I read `~/github/pretext-rebuild-wt/shared` at branch `ra-final-shared`, commit 1d9f2f1, and changed nothing there. Paths below are under `rebuild/` of that tree. The three engine folders were read as they are on this branch. The cr5 owners are editing them elsewhere, so line numbers under `src/engines` may have moved for them. Planted changes and one tool patch lived in a detached worktree of my own, which is now removed.

Verdict: the phase did what it set out to do. Correctness didn't move on anything I could run. That includes a seed nobody had used, in three real browsers and offline against the correctness line. The shared layer is small, and the ports barely touch each other. What is left falls into three groups:
- one data-modeling miss at the input boundary (font families);
- two places where "names no engine" was met by renaming the engine into flags;
- a handful of shape and size problems inside the ports.

## 1. Correctness: what I ran

| Check | Result |
|---|---|
| T0 | `bunx tsc --noEmit` exits 0 for six projects. `bun test rebuild` gives 819 pass, 0 fail, in 59 files. |
| T1, clean tree | All 389,646 cases the same: 0 predictions changed, 0 questions changed. Exit 3, by Chrome's string storage rule alone (65,764 no-facts cases routed). The orchestrator re-froze Chrome's two references at 09:25 during my run (25fbdd6). In my later T1 on the planted tree, Chrome's 67,065 cases per configuration replayed the same against that reference, with nothing routed to tier 2, so Chrome's part no longer exits 3. |
| T2 forward, clean tree | Chrome no-facts, Firefox facts and webkit-host no-facts each exit 0, with 0 status transitions and the gate lost 0. Exact values are unchanged: Chrome 266 values and 992 rect counts differing, Firefox 744 and 102, webkit-host 0 and 197, all as in the references. |
| `function-set sweep`, no-facts (not in the last stage's list) | Exit 0. Chrome 67,065, Firefox 63,771 and webkit-host 63,987 cases pass. One prepared paragraph filled at three other widths first equals a fresh prepare, plain and inspected. |
| Knip | Lists only the four test helpers. |

### A fresh seed nobody used: `critic-final-1`

6,362 cases of the kinds runs, ws, policy and rich-prewrap, under the headline configuration.

- **Real browsers, the usual predictor against the plain predictor** (`lab/compare-rows.ts --prediction=line-ranges`, three parts per browser):
  - Chrome: 6,362 of 6,362 equal in line ranges and in native observations.
  - Firefox: the same.
  - webkit-host: 0 line ranges differ, and 4 native observations differ, all in part 03 (`c-3755e07c3cb565de`, `c-4fc256158c952dab`, `c-60d8abf0f00895a3`, `c-c73a6f55f986b2fb`). That compare exits 3. I did not look at these 4 cases.
- **The usual run's scores on the fresh set** (forward only, lineCount / breaks / widths failures):
  - Chrome 2 / 8 / 8, with 1 open row: `c-d600d9b01c0ae9d7`, `rich-prewrap/normal-in-pre-wrap`, negative letter spacing, breaks ("element 0: native lines 0; expected none"). This one is for the Blink owner.
  - Firefox 0 / 2 / 63, none open.
  - webkit-host 5 / 10 / 19, none open.
- **Offline against the correctness line** (`tools/two-trees.ts --a=correctness-line` on the stand-in Canvas, with the tool's bug of item 9 below patched in my scratch tree):
  - The line's lab path against HEAD's plain path gives 0 differing line ranges. That holds on all 6,362 cases in all three engines, at the cases' own widths and at 37, 113 and 251 px (19,086 layouts per engine).
  - Full predictions of the line against HEAD:
    - Firefox: 0 of 6,362 differ.
    - WebKit: 0 of 6,362 differ.
    - Chrome: 126 differ. 106 are gap lists (`layout.lines[].gaps…`, `layout.gaps…`), which X3's canonical form accounts for. 20 are painter limits. I opened all 20: every one is a `script-at-line-start` that was added, which is X3's painter rule.
    - Nothing in lines, fragments or geometry differs in any of the three.

### One planted semantic change per engine

| Plant | T1 | Other offline check | T2 |
|---|---|---|---|
| Blink: `canFitOnLine` without its LayoutUnit on plain paragraphs only (`sh.gaps === null`) | **Blind**: 134,130 Chrome cases the same. The lab always prepares inspected, so this is by construction. | `function-set plain` exits 1: 1,545 of 67,065 cases fail in each configuration (660 "plain differs from inspected", 885 a question the record lacks). | The usual T2 can't see it. The plain predictor's Chrome run over those cases, compared with my clean usual run by `compare-sets.ts --prediction=line-ranges`, exits 1. |
| WebKit: `overflowWidthAsLeadingForNextLine` without its `f32` (`lines.ts:914`) | Exit 1: 1,508 predictions changed, first differing at `next.previousLine.carriedWidth`. | not run | On those cases: 2,452 transitions, 1,165 from pass, and 853 cases from exact to not exact. Exit 1. |
| Gecko: `consume` rounds instead of truncating (`placement.ts:182`) | Exit 1: 70 changed (`rule/text-align`, `rich-prewrap/trailing-spaces`). | not run | Facts: 164 transitions, 91 from pass, 70 from exact to not exact. No-facts: 94 transitions, 91 from pass (widths pass to fail covered by `optical-size`). Exit 1 both times. |

Four things to take from this.

1. **The application's path is guarded by two checks only.** They are `function-set plain` offline and the plain predictor's browser run at milestones. T1 and the usual T2 never run a plain paragraph. The one-command gate on `x-iteration-speed` has `plain` in its `--quick` form. It should stay there when that branch lands.
2. `check-report.needs-browser.ids` lists only cases whose questions changed. After exit 1 it is empty. To send changed predictions to T2, make the ids from `predictionChanged`, as I did.
3. Under the Gecko plant, 38 cases went from widths pass to `residual gecko/one-shaping-unit-one-app-unit (signature)`.
   - A newly introduced 1 au error matches that residual class by signature.
   - Against a reference ledger it still shows as a transition from pass.
   - On a set with no reference (fresh rounds, T3) it would be counted apart from the open failures.
4. The WebKit plant turned 323 painter rows from `fail covered by limit:carried-width` into pass. I checked one (`c-03aa275e47e0acb4`):
   - painted fresh, the rest of the word measures 9.824000358581543;
   - natively it keeps the carried float32 9.823999404907227.
   So the limit is real, not a scorer artifact. It also confirms that the native carried width is rounded to float32.

## 2. What is still off, most important first

### 1. The CSS font-family list is a string that four parsers read four ways
`CssFont.family: string` (`src/model.ts:8-15`) is parsed by:
- `src/measure/font-checks.ts:124-149`: quote-aware, with its own 13 generic keywords at `:110`.
- `src/engines/blink/content.ts:162-173`: `indexOf(',')`, so a comma inside quotes breaks it, and the keywords are compared case-sensitively.
- `src/engines/webkit/fonts.ts:62-75`: `split(',')` plus a quote regex, with `webkit/content.ts:175-181` holding a third keyword list.
- `src/engines/gecko/fonts.ts:5-100`: a full CSS parser with escapes, after Servo.

The guide's string rule names this case. Quotes, escapes and commas are CSS syntax, the same in every engine. What differs per engine is which names are generics.

It already bites. Blink's `isSystemFontKeyword` tests `name === 'system-ui'`, while `blink/checks.ts:18` and `font-checks.ts:228` lowercase. I ran `prepare` on the stand-in Canvas at DPR 2:
- `system-ui` gives `measuresAtCssSize` true and the font `16px system-ui`;
- `System-UI` and `SYSTEM-UI` give false and `32px …`;
- `BlinkMacSystemFont` gives true, and `blinkmacsystemfont` gives false.

CSS keywords and family names are ASCII case-insensitive, so Chrome treats these alike, and the port measures the system font at another optical size.

Fix: parse the list once at the boundary into `{ name, quoted }[]`. Each port classifies its own generics, and the CSS string the painter writes is derived from the list. For the Blink owner today: compare case-insensitively at `blink/content.ts:171-173`.

### 2. "Names no engine" was met by flags that only one engine sets
- **`PaintRules`** (`src/paint.ts:132-187`) has 15 fields.
  - 2 are data, and `limits` is a function, all reasonable.
  - Of the other 12, one engine alone sets a non-default value in 10: WebKit in 2 (`textNodesKeepLeafStorage`, `paintsSourceWhiteSpace`), Blink in 7, Gecko in 1 (`spacingAfterRunEnd`).
  - `hyphenSpan` and `lineStartScript` have three values, one per engine.
  - The type allows about 2^10 combinations and three exist.
  - The conditionals that read the flags are still woven through the 423-line `planLine` (`paint.ts:528-950`).
  - The engine reason for each flag is written twice, once in `paint.ts` ("In Blink…", for example `:548-554`, `:687-690`, `:715-717`, `:727-733`, `:1013-1017`) and once in the engine's `paint-rules.ts`. Two homes for one explanation will drift.
- **`FontChecks`** (`src/measure/font-checks.ts:153-171`) is the same pattern.
  - Check 3 is WebKit's and checks 4 and 5 are Blink's.
  - A Blink formula lives in shared code: `effectiveSize`, `:218-221`, copied from `blink/contexts.ts:12-16`.
  - Gecko's record says "ask nothing" (`gecko/checks.ts:15-18`). Yet `src/index.ts:73` still calls `withLearnedFontFacts` for Gecko, which scans the text and copies the inline tree to learn nothing.

Both follow the plan (§5.4, step 3). My complaint is with the plan's shape, not with the work. A useful test: would a fourth combination of flags ever be valid? If not, the record is the engine enum under other names.

Cheap steps now:
- keep each flag's engine reasoning in the engine's file only;
- don't call the font checks for Gecko;
- let each port own its checks over shared helpers (`draws`, `primaryFamily`).

If the painter is reworked for virtualized painting in the API phase, let each port compose its own line plan from shared primitives.

### 3. The inspection mode still runs through measuring
- The gap conditions did get one home per port.
- The sink did not leave:
  - Blink's `Shaper = { p, gaps }` sits in 57 function signatures (37 in `shape.ts`). `shape.ts`, `limits.ts` and `gaps.ts` import each other in a runtime cycle. WebKit and Gecko have none.
  - Gecko threads `consulted: number[] | null` through `glyphBefore`, `rangeAdvance` and `scanAdvance` (`gecko/lines.ts:26-111`), where `gaps | null` used to be.
  - WebKit carries `L.gaps`.
  - `shapeLine` lays a line out a second time for inspection (`blink/line-breaker.ts:620-638`). It is gated correctly by the null sink.
- I accept this as the price of byte-equal gap lists. It should be said plainly somewhere.
- The way out is to derive gaps from recorded raw facts, which the plan rejected for a stated reason.

### 4. The function set's result shape
- `FillResultOf` carries `kind` and its `line` carries `kind` again (`src/model.ts:313-330`; `blink/index.ts:179-181`; `webkit/types.ts:287-302`; `gecko/lines.ts:825-839`).
- WebKit's line record also repeats `start` and `end` (`webkit/lines.ts:1971-1973`).
- The prepared paragraph, every line start and every line carry an `engine` tag, only so that `src/index.ts:86-142` can throw 9 mismatch errors.
- `LineInspectionOf.geometry: Geometry | null` (`model.ts:353`) is typed nullable, although each call knows its answer. That makes both consumers throw on an impossible null (`src/test-lines.ts:52`, `lab/predictor-core.ts:203`).
- The API phase will reshape this. The cheap fix now is two functions, one returning inspection for a line and one returning gaps for a refused slot.

### 5. Measured values are kept by three different policies
- Gecko has lazy per-offset records that outlive every call (`gecko/types.ts:163-202`, `gecko/advance.ts:55-84`).
  - The plan sanctioned them, and they meet the maintainer's test: invisible, never stale, bounded.
  - Blink was refused the same kind of table until profiling, which is why Chrome asks 137 Canvas questions per relayout and Firefox asks 0.
  - It is the documented exception. It is also the largest asymmetry between the ports.
- Gecko finds its recipe contexts by settings at every ask.
  - Sites: `gecko/advance.ts:31`, `:283`, `:492-493`, `gecko/gaps.ts:195`. Blink and WebKit hold contexts by reference, as plan §5.3 says.
  - `advance.ts:278-283` re-parses the context's font string with a regex to scale its size, with a silent `return null` fallback. The run already has its `FontDecl`.
  - This is a precondition for profiling item 1. Once contexts are shared per page, each of those lookups scans the whole page's list.

### 6. Where a new reader is lost
- **`prepareGecko`** is one 774-line function (`gecko/prepare.ts:406-1180`).
  - It has seven numbered steps.
  - About 40 locals are shared between them, and closures mutate them (`current`, `lastFrame`, `commonAncestor`, `inWhitespace`, `offsetAt`).
  - The step seams are already written down. Each step could return its data.
- **WebKit** uses 36 `as WebKitTextItem`-style casts over a tagged union: 30 in `webkit/lines.ts`, 6 in `history.ts`. Gecko has 0 and Blink 1.
  - The simple builders know that every item in their range is text, and the type doesn't.
  - A wrong cast reads undefined fields silently instead of crashing.
- **Blink** has six "adjust" functions that take 5 to 7 positional integers (`shape.ts:372-594`): `pairAdjust16`, `windowAdjust16`, `adjust16`, `positionAdjust16`, `adjustBefore16`, `pairBefore16`. A short table of who calls what at the top of the file would help.
  - `prepare` passes a half-built `p` through six mutators (`blink/index.ts:145-165`).
- **`planLine`** in `src/paint.ts` is 423 lines.
  - It repeats `kind === 'text' || 'trimmed' || 'hanging'` at 8 sites, although `TextPiece` exists at `:93`.
  - Scripts are plain strings (`'other'`).

### 7. Sentinels
- `parent: -1` means "the block" in `src/content.ts:18-31`, and then in all three ports and the painter. About 19 sites special-case it.
- Blink's styles use index 0 for the block, so there are two conventions for the same thing.
- X3's "no sentinels" didn't reach this one.

### 8. Small duplications and leftovers
- `covers()` over `FontFacts` coverage ranges exists three times: `blink/ligatures.ts:52`, `gecko/fonts.ts:176`, and WebKit's `inRanges` at `webkit/data.ts:46`.
- `GapSink` is defined three times.
- A slot's insets are validated in `webkit/lines.ts:1932` and `paint.ts:1295`, clamped silently in `blink/line-breaker.ts:215-216`, and not checked in `gecko/lines.ts:585-591`. Validate once in `src/index.ts`.
- `webkit/joining.ts:9,25` decodes its table lazily. Every other table is parsed at load, and its own header says so.
- `GeckoFrame.item` is written at `gecko/prepare.ts:743` and never read (`types.ts:54-55`). It is kept for a capability that isn't built.
- The shared code has three tree walks. One uses an explicit stack "so a deep tree can't overflow" (`content.ts:46`). The other two recurse (`font-checks.ts:256-268`, `:302-314`).
- `src/test-lines.ts` and `webkit/test-paragraph.ts` are test support living under `src`.
- `tests/function-set.ts:32-33,46` still says the function set "isn't there yet".
- About 10% of the generated `.brk` bytes are never read (reverse tables, rule source).
- About 3,400 of the 23.8k library lines are inspection-only. They are statically imported through `src/index.ts`, so an application's bundle would carry them.

### 9. Harness
- **`tools/two-trees.ts:88`** maps every layout line, while a plain predictor lists only lines that have a line box (`lab/compare-rows.ts:76` filters).
  - It reported 9 Chrome, 47 Firefox and 5 WebKit false differences on my set.
  - With the filter the count is 0.
  - PROFILING-START relies on this tool, so it should be fixed before profiling uses it.

## 3. Against the plan
- Every deviation recorded in the plan's notes has a reason I accept:
  - the WebKit item hand-over;
  - Blink's reshape records;
  - Gecko's `emergencyUnconfirmed` list;
  - `history.ts` kept apart from `gaps.ts`;
  - the measurer's lifetime left out of step 4;
  - the final proof left to the orchestrator.
- Not fully done:
  - X3's "no sentinels" (item 7);
  - "tagged unions" in WebKit, where the unions are tagged but read through casts (item 6).
- Done as planned, and I question the plan: §5.4's font checks as data flags and step 3's `PaintRules` (item 2).
- A good unplanned addition: `start` and `end` on the fill result, so a line says where it breaks without its pieces. It is only duplicated on WebKit's record.
- The stage owner's finding that the plan's §5.2 promise fails is right and stays open. A plain paragraph still asks Blink's linear-size font check at DPR other than 1.

## 4. The two capabilities and the two properties
- **(b)** The seam holds in all three ports. `fillLine` builds no fragments and no geometry.
  - "Nothing new at another width" is true for WebKit.
  - It is true for Gecko once an offset has been measured.
  - It is false for Blink today: a new width breaks at other offsets, so `measure16(cut, k)` asks strings that were never asked (137 calls a layout in the benchmark).
  - It stays possible (tables filled in `prepare`, plan §10). It is not met.
- **(g)**
  - Next break opportunity: callable in all three ports (Blink's `LineBreakIterator` class, WebKit's free functions over `Builder`, Gecko's `breakFlags`).
  - "Close the line here":
    - WebKit is near, with `rangeEnd` as data.
    - Gecko has `reflowPass`'s `force`.
    - Blink has no such function. It works only by choosing a slot width, as CAPABILITY-CHECK said, and X3 didn't change that.
    - Nothing got more fused.
  - Start from a source offset: the maps are kept (`contentOffsets`, `sourceOffset`, `holderOfSource`).
- A line start is small plain data that survives JSON in all three ports.
- "Nothing handed out aliases prepared data" is true of starts and pieces. Gecko's decided line, which the caller does hold, references the prepared text runs (`root … prov.run`). That is documented. DESIGN.md's sentence omits it.
- The painter takes every line of the paragraph (`paint.ts:88-91`, `:422-463`). An application that paints a window of lines must still hand it every line. This is for the API phase.

## 5. What profiling should look at first
- First a quiet rerun of `bench/chat-night.sh`, because Chrome's numbers were taken under load.
- Then PROFILING-START item 1, the measurer's lifetime, with these preconditions from the read:
  - Gecko holds its recipe contexts by reference (item 5).
  - `contextFor`'s linear scan compares eight strings, so it needs a look once the list is the page's.
  - The font checks' `asked` list is per call and must move with the answers.
  - Blink makes five contexts per style eagerly and uses one on a plain left-to-right paragraph.
- Then Blink's positions (PROFILING-START item 2).
- Then measure these, which are in no list yet:
  - WebKit builds a break factory, and can run an ICU scan of the whole previous box, at every check between boxes (`webkit/lines.ts:1192`, `breaks.ts:389`). That could matter for span-heavy chat text.
  - Blink builds a line break iterator and slices the text per line.
  - `painterLimits` and `paintLines` each plan every line.

## 6. Run folders (rows compressed with `compress-rows.sh`)
- `~/github/pretext-rebuild/.artifacts/tests/runs/critic-final` (394 MB): the three clean T2 runs, the planted Firefox runs (facts and no-facts), the planted webkit-host run, and the planted Chrome plain-predictor run.
- `~/github/pretext-rebuild/.artifacts/lab/fresh/{chrome,firefox,webkit-host}/critic-final-1` (about 35 MB each): the fresh seed, with both the usual and the plain predictor's runs.
  - The seed's ids are now used.

## What the reviewer could not settle

- For the Blink owner, a correctness bug: `src/engines/blink/content.ts:171-173` compares the system font keywords case-sensitively. On the stand-in Canvas at DPR 2, `System-UI`, `SYSTEM-UI` and `blinkmacsystemfont` are measured at the zoomed size (font `32px ...`), where `system-ui` and `BlinkMacSystemFont` are measured at the CSS size (`16px ...`). CSS keywords and family names are ASCII case-insensitive. `blink/checks.ts:18` and `measure/font-checks.ts:228` already lowercase. The root cause is that the font-family string is parsed by four different parsers (`font-checks.ts:124-149`, `blink/content.ts:162-173`, `webkit/fonts.ts:62-75`, `gecko/fonts.ts:5-100`). Blink's and WebKit's also split a quoted name at a comma.
- The application's (plain) path is guarded only by `function-set plain` and the plain predictor's browser run. My Blink plant changed the fit rule on plain paragraphs only. Tier 1 replayed all 134,130 Chrome cases the same, and the usual tier 2 cannot see it by construction. `function-set plain` failed 1,545 cases per configuration, and the plain predictor's browser run exited 1. Keep `plain` in the one-command gate's quick form when `x-iteration-speed` lands.
- `rebuild/tools/two-trees.ts:88` compares a plain predictor's line ranges with every layout line, including lines that have no line box. It reported 9, 47 and 5 false differences on my fresh set of 6,362 cases. With the filter that `lab/compare-rows.ts:76` uses, the count is 0. PROFILING-START relies on this tool, so fix it before profiling uses it. I patched it only in my scratch worktree, which is removed.
- Capability (b) is not met in Blink today. A fill at a new width asks Canvas strings that were never asked (positions from a group cut to a new offset), not only repeats. Capability (g), 'close the line here', has no function in Blink (slot-width route only). Both stay possible, and nothing got more fused.
- An open row on the fresh seed, for the Blink owner: `c-d600d9b01c0ae9d7` (`rich-prewrap/normal-in-pre-wrap`, negative letter spacing, breaks: 'element 0: native lines 0; expected none'). Chrome, no-facts, forward only. I did not check whether it predates the re-architecture in the browser. Offline, the correctness line and HEAD give the same lines on it.
- On the fresh seed, 4 webkit-host cases differ in native observation between the usual and the plain predictor's runs (`c-3755e07c3cb565de`, `c-4fc256158c952dab`, `c-60d8abf0f00895a3`, `c-c73a6f55f986b2fb`). 0 line ranges differ. I did not look at these cases, and the runs were forward only, so they are not marked history-dependent anywhere.
- Under my Gecko plant, 38 cases moved from widths pass to `residual gecko/one-shaping-unit-one-app-unit (signature)`. A newly introduced 1 au error matches that known residual class by signature. It blocks as a transition against a reference ledger. On a set with no reference (fresh rounds, T3) it would be counted apart from the open failures.
- The orchestrator re-froze Chrome's references at 25fbdd6 (09:25) while I ran. My clean T1 exit 3 (string storage rule alone) predates that. In my later T1 on the planted tree, Chrome's 134,130 cases replayed the same against 25fbdd6 with nothing routed to tier 2. I did not rerun the clean tree's T1 after the re-freeze.
- I ran one T2 per browser, forward only and in one configuration each: Chrome no-facts, Firefox facts, webkit-host no-facts. I did not run both orders, the other configurations or T3.
- The engine folders were read as they are on `ra-final-shared`. The cr5 owners are changing them, so line numbers under `src/engines` in this critique may have moved for them.
- `function-set plain` and `pure`, the painter differential, the citation ledger and the twin scan were not rerun on the clean tree. The previous stage reported them clean. I ran tsc, the unit tests, tier 1, three tier 2 runs, the sweep and Knip, and `plain` only on the planted tree.
- The fresh seed `critic-final-1` is now used: its 6,362 ids count as used for later fresh rounds. My runs left untracked output under `rebuild/tests/.check` in the shared worktree, by the tools' design. The tracked tree is clean.
