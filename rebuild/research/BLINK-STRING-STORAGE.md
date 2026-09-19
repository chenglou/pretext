# The Blink string storage fix, its independent check, and what was decided (2026-09-18)

After the correctness line, step 0 of the re-architecture found that the measuring memo's `Map` lookup made V8 hand Chrome a one-byte string, so the Blink port's forced two-byte strings never reached Canvas as two-byte. Taking the memo out later (the plan's X2) would have moved 254 of 380 predictions in a set built to show it. The accident was fixed at the root first, on branch `rx-blink-storage`, and checked independently from a scratch clone. The mechanism, the probe's facts and the full results are in `rebuild/specs/blink-RESULTS.md`, "String storage". This file keeps the check's verdict and the decisions.

## Decisions

1. **The fix is merged**, together with the owner's stacked rule for the one class the fix left (`shape.ts` `spacesStay`, below). Reason for taking the rule now: it is local to `shape.ts`, it follows the source (an 8-bit string is one item shaped as one Latin segment, plain_text_node.cc:381-385, harfbuzz_shaper.cc:1072-1077), against the fix alone no status outside the new `twins` set moves on the 66,685 frozen cases, and taking it later would mean freezing Chrome's references a second time in the middle of the re-architecture. Tripwire: Chrome's sets were recorded again at the merge commit, both orders and both configurations, and the ledgers had to equal the owner's recorded ones. They do: the entries are byte-identical in both configurations (`.artifacts/tests/runs/storage-merge-20260918`, library 880fb96).
2. **No Blink `string-storage` gap condition for now.** Without supplied font facts it would limit values the lab knows to be 8-bit. The limit is documented in CHARTER.md instead: a text node's storage is an input no script can read.
3. **Chrome's two references were frozen again with `--force --reason`.** Three already-failing `suite/U+FFFC` cases in the facts configuration hold one more differing predicted value (`c-5deba5ed817d3b59`, `c-6f6776f10f18af33`, `c-8aeaebe3fe97e39d`); they are listed in the known tail under `lab/blink-x-after-a-fallback-cluster-reported-as-predicted`. The two painter rows the rule leaves open (`c-0aaf6ad5c7daf6da`, `c-48abe81f791883d3`) are listed there too, as `blink/painter-brackets-shaped-otherwise-than-the-paragraph`: the painted line shapes its brackets differently from the paragraph, which is `paint.ts`'s to fix.

## The rule for a neutral Latin range with a space (`spacesStay`)

`shape.ts` `spacesStay`. The ranges are those the paragraph shapes as Latin, that are Latin-1-only, and that hold a space, a character other than white space, no soft hyphen and no character with a script of their own.
- In a font Canvas shapes whole (`canvasSplitsWords` false), the range is measured as an 8-bit string with U+0020 itself.
- That string is one item shaped as one Latin segment (plain_text_node.cc:381-385, harfbuzz_shaper.cc:1072-1077), which is the paragraph's own shaping.
- Fonts shaped word by word keep U+2028 and `script-context`.

Evidence:
- Probe S6: the DOM is 136.421875px, the 8-bit string with U+0020 is 136.41599, the 16-bit string with U+2028 is 233.86.
- Tier 0: 789 tests pass.
- Tier 1: 0 predictions changed, and 4,693 cases ask a new question. Without the narrowing to ranges with a character other than white space, 34,087 do.
- Tier 2, both configurations, both orders, recorded: outside twins, no status and no exact-value status differs from the fix's run in any of the 66,685 cases.
- Twins: lineCount, breaks and widths pass 380 of 380. Exact is 380 of 380, with 0 differing predicted values and 0 differing rect counts. The painter is 353 pass, 25 covered, 2 open.
- Memo off on top of it moves 0 of 380.

The 2 open painter rows are `c-0aaf6ad5c7daf6da` and `c-48abe81f791883d3` (RTL block). The prediction passes every metric. The painted line wraps without a painter limit, because the painted line shapes its brackets differently from the paragraph. This is `paint.ts`'s, not the port's.

## What stays unknowable

- A text node's storage when the application makes its own nodes from two-byte Latin-1 strings. No script can read it, and the port reports nothing for it today.
- The fix's owner left three things untouched:
  - A Blink `string-storage` condition. The GapName exists and WebKit raises it. It would fire for an unsegmented Latin-1 paragraph with no scripted character and a leaf of 13 units or more. Without facts it would limit values the lab knows to be 8-bit.
  - `paintedText(fragment).slice` of a fragment with a wide character elsewhere makes a two-byte text node from 13 units on. Blink segments it where `blinkScriptsOf` assumes Latin. No tier case reaches it.
  - Text read back from a 16-bit node (`data`, `textContent`) measures as one byte (S2). The owner couldn't explain that from source, so it is a supplementary fact.
- The library's painter builds its text from single characters, so it is one-byte whenever the units fit. That matches the port's model.

## Independent check of the fix (`rx-blink-storage` @ 69a3a47)

### Verdict

- **Chrome's two references can be frozen again on this branch's merge.** No pass is lost on the 66,685 frozen cases, and no passing case holds a wrong predicted value, twins included.
- **X2 (the memo goes) is now neutral in Chrome.** With the memo planted off, no native observation, prediction or painted line differs in pinned Chrome on any of the 67,065 cases (twins and the storage-sensitive tier cases included), in either configuration.
- Nothing must be fixed in the library first. The freeze needs three things from you; they are listed under "Before the freeze".
- I changed no repository tree. Both `~/github/pretext-rebuild-wt/blink-storage` and `~/github/pretext-rebuild` are clean.

### 1. My probe in pinned Chrome 153.0.8010.50

**Design.** It differs from the owner's S5, which reads widths from the library's call log.
- The page wraps `measureText` and the context setters on the prototype.
- It keeps every string object the library hands to Canvas as an array element, never as a key.
- After the layout it measures that same object on a virgin canvas with the same assignments, beside a one-byte twin and a two-byte twin it builds itself. The one-byte twin is single characters joined; the two-byte twin is a `split` part.
- A virgin canvas's width names the object's storage. A library answer that differs from the virgin answer is an answer that depended on the canvas's history.

**Raw Canvas (R0), Amiri 48px, my own strings.**

| String | One-byte | Two-byte |
|---|---|---|
| `)`×15 | 183.60 | 329.76 |
| `[`×14 | 169.34 | 242.59 |
| `«»`×8 | 360.96 | 318.72 |
| `(12)[34]{56}789` | 299.33 | 346.56 |
| digits, letters, 12 brackets | same | same |

- Two-byte strings made by slice, split and regex match all measure the same.
- After `new Map().get(s)` the string measures as one-byte. After `new Map().get('|' + s)` it stays two-byte.
- On one canvas the first shaping answers both storages, in both orders.
- Two canvases taking turns: the first canvas, which shaped the one-byte string first, answered the two-byte twin 183.60. The second canvas, which shaped the two-byte string first, answered the one-byte twin 329.76. So canvases share nothing.

**The library.** The lab's two predictors were bundled from each tree and run over the twins 380 plus 76 of the 91 tier cases that ask such a slice. The other 15 need another page language than the probe's.

| Library | Calls (no-facts / facts) | Answers that depended on history | Strings handed in another storage than the port means | Canvases asked both storages |
|---|---|---|---|---|
| fix | 51,668 / 48,075 | 0 / 0 | 0 / 0 | 0 / 0 |
| fix + memo off | 568,905 / 635,546 | 0 / 0 | 0 / 0 | 0 / 0 |
| fix + reversed groups | 51,668 / 48,075 | 0 / 0 | 0 / 0 | 0 / 0 |
| line 32e2a1e (control) | 52,082 / 48,726 | 0 / 0 | 762 / 846, all one-byte | 0 / 0 |
| line + memo off (control) | 569,223 / 635,920 | 201 / 403 | 440 / 758 | 75 / 135 |

- **Fix, storage reaching Canvas** (no-facts / facts):
  - Of the Latin-1 strings whose storage shows in the width, 153 / 283 sat on `8bit` contexts and all were handed one-byte.
  - 414 / 455 sat on `16bit` contexts and all were handed two-byte.
  - No Latin-1 string under 13 units sits on a `16bit` context.
- **Fix, twins in one paragraph** (no-facts / facts):
  - 91 pairs in 65 cases / 176 pairs in 125 cases asked the same characters under the same settings in both storages.
  - Both answers were right in all of them, in both natural orders: `16bit` first 91 / 156, `8bit` first 0 / 20.
- **Fix against memo off:** all 456 layouts are equal, including lines, geometry and gaps.
- **Fix against reversed groups:** 0 line ends and 0 geometry differ. Only gap order moves, in 96 / 90 cases, and the gaps as a sorted set are equal.
- **Line + memo off control:** 0 of 91 / 176 twin pairs are both right, and 274 / 280 layouts differ from the line's. This reproduces the step 0 finding and shows the probe sees the hazard.
- **Tier cases with the fix** (12,570 cases under their own page languages: all of smoke-hand, smoke, runs, ws, policy and rich-prewrap, and every tenth case of the other sets):
  - 1,470,620 / 1,333,528 answers, 0 of which depended on history.
  - Storage shows in none of their widths, which is why no frozen set moves.

### 2. Source reading

I opened every citation, at chromium 153.0.8010.48 and V8 6b96683d. All hold.

- **How Blink takes a string.** `to_blink_string.cc:224` reads `v8_string->IsOneByte()`, which is `IsOneByteRepresentation` (`api.cc:5937-5939`).
- **What flips it.** A Map key lookup calls `Runtime::kInternalizeString` (`builtins-collections-gen.cc:2589-2604`). The string table then makes a one-byte internalized copy when the units fit (`string-table.cc:398-427`).
- **Canvas's cache.**
  - It is keyed by `{text, direction}` alone, for both nodes and words (`frame_shape_cache.cc:45-65, 135-149`).
  - It lives in the `PlainTextPainter` of each canvas host (`canvas_rendering_context_host.cc:193-196`), so canvases share nothing.
- **Which Canvas path depends on storage.** An 8-bit item is one Latin segment; a 16-bit item goes through RunSegmenter (`harfbuzz_shaper.cc:1072-1101`).
- **The DOM's storage.**
  - A text node keeps the string it was given (`character_data.h:70-89`).
  - The parser makes 8-bit text when the units fit (`literal_buffer.h:306-321`, `atomic_html_token.h:236-238`).
  - `has_non_orc_16bit_ ||= !transformed.View().Is8Bit()` for text (`inline_items_builder.cc:725`). `IsNonOrc16BitCharacter` applies to appended characters only (`:216-218`, `:1258`), so U+FFFC in a text node counts and an atomic inline's doesn't.
  - One Latin segment unless 16-bit content or bidi (`inline_node.cc:1256-1266`). Equal `text_content` keeps the earlier segments (`:1231-1254`).
- **The three library changes match this reading.** I found no rule taken from lab counts. All other direct uses of `p.contexts` (HanKerning, `canvasSplitsWords`) measure strings that hold a unit above U+00FF.

### 3. Tiers

**Tier 0**
- 788 tests pass.
- Planting `key = text` fails the owner's new unit test, as the report says.

**Tier 1**
- Firefox and webkit-host: every case the same, in both configurations.
- Chrome exits 4 in both configurations:
  - 29,383 cases the same, 0 predictions changed.
  - 37,253 cases ask other questions, and the detail reported for every one is a higher context count.
  - 49 cases ask a new question, all `suite/U+FFFC/*`, all asking `a` U+2060 `b`.
  - The by-set counts equal the report's.

**Tier 2 ledgers**
- I rebuilt them from the recorded runs; the entries are byte-identical to the owner's.
- I computed the transitions with my own script against the frozen ledgers:

| Configuration | Metric transitions | Passes lost | Exact-value transitions | Differing predicted values | Differing rect counts |
|---|---|---|---|---|---|
| no-facts | 41 | 0 | 0 | 266 → 266 | 992 → 992 |
| facts | 41 | 0 | 3 | 549 → 552 | 869 → 869 |

- Every metric transition is `soft-hyphen-shaping` leaving the covering conditions in the U+FFFC cases.
- The 3 exact-value cases are as reported, and I opened the rows:
  - `c-5deba5ed817d3b59`, `c-6f6776f10f18af33` and `c-8aeaebe3fe97e39d`; lineCount already fails under `font-fallback` in all three.
  - In `c-5deba5ed817d3b59` the x of U+FFFC, 17.80, is now reported as predicted where the browser wraps it to x 0. At the line `soft-hyphen-shaping` limited that value.
  - This is an old weakness of the observation port that `soft-hyphen-shaping` happened to mask, not the fix's logic.
- No case is history-dependent, and the gate lost 0 pairs.

**Forward reruns**
- My own unrecorded forward runs of the fix reproduce the recorded forward rows exactly in the facts configuration: 0 of 67,065 rows differ.
- Their ledgers equal the owner's in both configurations.

**Bundle**
- Head's bundle hashes equal the recording's: `9921cb08…` without facts and `4264206c…` with.
- The commits after d3cdfb6 change only comments and tests under `rebuild/src`.

**Painter differential, which the owner didn't run**
- 66,636 cases painted the same, 0 differ.
- The 49 new-question cases can't be painted against the line's frozen predictor, so it exits 3.

**webkit-host and Firefox**
- The shared measurer changed for every engine, so I ran tier 2 forward in the headline configuration.
- Both show 0 transitions and 0 exact-value changes, and both gates pass.

### 4. Twins (380 cases)

Every number in the report's table holds, against the line's library and with both configurations alike.

| Metric | Line | Fix | Gains | Losses |
|---|---|---|---|---|
| lineCount | 320 | 346 | 43 | 17: rtl-block 14, spans 2, latin-first 1 |
| breaks | 278 | 335 | 66 | 9 |
| widths | 131 | 267 | 156 | 20, all rtl-block |
| painter | 133 | 259 | 146 | 20, all rtl-block |
| exact | 284 | 335 | 62 | 11 |

- Differing predicted values go 117 → 30 without facts and 445 → 32 with. No passing twins case holds a wrong predicted value.
- The twin scan finds 281 cases that ask a two-byte slice, and 0 that ask one context both storages (166 at the line).

**One sentence of the report is inexact: "Every such failure is covered by `script-context`."**
- In the ledger 8 of 34 lineCount failures, 9 of 45 breaks failures and 12 of 68 widths failures list `unsafe-to-break` and no `script-context`. Some of those add `glyph-clusters` or `float32-precision`.
- Two of the 17 lost lineCount passes are among them: `c-e1146f420f327033` and `c-a8e837e34c17fc7d`.
- In both, `script-context` fires on the failing line, and the wrong decision lies inside its reported range (`[4,23)` in the first). The scorer attributes by position, so it names `unsafe-to-break`.

**The cause is still one class.**
- The alternative's recorded ledgers pass lineCount, breaks and widths on 380 of 380 twins, all exact, and no entry outside twins differs from the fix's.
- So every loss is traced to the Latin range with a space, which `script-context`'s reading names.
- The proposed known-tail item should list `unsafe-to-break` beside `script-context`, or say this in its note.

### 5. Memo off on top of the fix

Plant: the commit 579d861, in my scratch clone only.

**In Chrome, forward, all 15 sets, 67,065 cases, both configurations**
- Against the fix's rows, none of these differs:
  - native observations;
  - layouts;
  - line ends;
  - the observation port's values;
  - painter limits;
  - painted lines.
- The ledgers are byte-identical.
- The plant did run: on twins it made 375,889 Canvas calls against 29,310, with 0 memo hits.
- Wall time is 103 s against 100 s with facts, and 92 s against 78 s without. That is inside the X2 tripwire.

**Offline, against a scratch reference**
- I froze the scratch reference from the owner's recordings with the merged tree.
- 66,459 cases are repeats only; 0 predictions changed, 0 other questions, 0 new questions. It exits 3.
- The ask ratios are 12.00 with facts and 10.60 without.

**The alternative**
- The owner's memo-off plant run on the alternative equals its own forward run on the 380 twins.
- I checked the alternative from its ledgers and rows only; I didn't run it myself.

### 6. The merge

`rebuild-20260916` has moved to c55fc77 since the branch point, with S1 and S2 landed.

I trial-merged the fix in a scratch clone:
- The merge is clean, with no conflicts.
- Tier 0 passes 788 tests, tsc is clean, the citation check loses 0 tokens, and the rule registry is current.
- Tier 1 gives the same result as the fix alone.
- The painter differential is the same: 66,636 cases painted the same, 49 not painted.

**The merged tree's bundles differ from the recording's.** They are `321a2625…` without facts and `64cbfe19…` with, where the recording holds `9921cb08…` and `4264206c…`. The behaviour is identical:
- `pack --dir=<scratch>` replays 67,065 of 67,065 cases exactly in both configurations, with 0 unfaithful.
- The merge's forward tier 2 rows equal the fix's row for row, and the ledgers are byte-identical.

### Before the freeze

1. **Which recording to pack.**
   - The owner's recordings pack faithfully at the merge commit.
   - A new both-orders recording at the merge commit gives the reference the merge's own bundle and takes 3 to 5.5 minutes a configuration.
   - I would record again.
2. **The 3 facts exact-value cases.**
   - Tier 2 in the facts configuration exits 1 until the references are replaced.
   - Freeze with `--force --reason`, and add the 3 ids to `lab/blink-x-after-a-fallback-cluster-reported-as-predicted` with the owner's note.
   - Or have the observation port limit that x first.
3. **After the freeze.**
   - Stage Chrome's seeds again with twins.
   - Re-bundle the painter differential's frozen side at the merge commit. `src/paint.ts` is untouched by this branch.
   - Until that re-bundle the differential can't paint the 49 cases, and I expect the twins to show as `frozen differs`.

**Not checked:** the giants, the owner's S1 to S5 facts (my probe covers the same ground another way), and twin-scan's "0 on every set" beyond twins. My tier 2 driver script lost the exit codes of my Chrome runs, so I read their results from the logs and ledgers.

**Paths** (scratch only; rows I no longer need are zstd-compressed and the originals are in the Trash)
- Everything is under `<scratch>/storage-check-out/`.
- Probe:
  - `probe/handed.ts` and `probe/handed-tier.ts`.
  - Outputs: `probe/out`, `probe/out2`, `probe/out-tier`.
- Tier 2 runs:
  - `t2/{fix,memo-off,merge}-{facts,no-facts}`.
  - `t2/other-{webkit-host,firefox}-no-facts`.
- Row comparison:
  - `compare-runs.ts`.
  - Its outputs: `t2/compare-{facts,no-facts}.json`.
- Ledgers and transitions:
  - `transitions.py`.
  - `ledger-fix-{no-facts,facts}`.
- Scratch references and pack logs: `replay-merge/chrome-{facts,no-facts}`.
- Painter differential reports: `painter-diff-*.json`.
- Twin scan reports: `twin-scan-twins-{fix,line}.json`.
- Scratch clones:
  - `<scratch>/storage-check`
  - `storage-check-memo-off`
  - `storage-check-reversed`
  - `storage-check-line`
  - `storage-check-line-memo-off`
  - `storage-check-merge`
  - `storage-check-merge2`
