# Rich content in the idempotent layout call: where the lookup's cost comes from, and what fixes it (2026-09-20)

research/IDEMPOTENT-API.md (2026-09-18) explored one API shape: `layout(content, style, width)` on a long-lived page
object over an invisible store, no handles for the application. It found plain text nearly free to look up and rich
content (several styled runs) costing one to two times the whole line loop. The maintainer asked for "reasons and
hypotheses around idempotent api's rich content costs" and for "good engineering (first) or algorithms" to solve it. One
agent studied it (no repository change; its code is under `.artifacts/api-explore-rich-20260920/`), a second attacked
the micro-benchmarks and ran the real chat demo's distribution. The attacker's review comes first. Every number is
nanoseconds per message (or per block) over the bare line loop, in the pinned Chrome unless said; the machine was loaded
all night, so ratios inside one process are what to read.

## What came back, and the orchestrator's reading

- **The reason is lookup latency, not hashing, allocation or the JIT.** The 09-18 trie does one `Map.get` per run, each in
  its own small Map (17,480 Maps for 10,000 messages), and a lookup in front of the line loop costs its latency, because
  the loop can't start before it ends: a lookup that costs 11 ns alone costs 23 to 50 ns there.
- **The engineering fix:** one `Map.get` on the first run's text, then `===` on the other runs (a pointer comparison when
  the application hands the same string objects, which an immediate-mode application does even though it rebuilds its
  arrays every frame), and an inner node only where two messages really share a run (5,000 messages that start with the
  same bold sender name cost one more lookup, not a walk). 51 lines, 596 Maps instead of 17,480, no allocation per call,
  nothing that can go stale. On the study's workload (2.9 runs a message): +63 to +70 where the old trie cost +119 to
  +143 and plain text +23 (the attacker: +43 to +74, +92 to +99, +24). One code path serves plain and rich text: a plain
  block as one run costs +12 to +21 over a dedicated string Map.
- **On the maintainer's real chat the gain is small, and that is fine.** The Markdown chat demo's own 10,000 messages
  make 18,613 blocks, 87% of them one run: the old trie costs +60 to +84, the fix +44 to +60, a Map on plain strings +32
  to +38. The fix saves 54 to 74 ns on a rich block and 8 to 26 on an average one. So rich keys were never the problem
  for chat; they matter for content that is mostly rich.
- **What stays expensive is the application's:** strings rebuilt every frame cost +150 (Chrome), +185 (Firefox), +120
  (WebKit), because every fresh key string has to be made canonical (about 40 ns in V8) before a Map can find it; keep
  the run strings and rebuild only the wrappers. For scale: `marked.lexer` costs about 6,000 ns a message, 40 times what
  rebuilt strings cost in keys.
- **No algorithm beat the engineering fix:** JavaScript can't read the engine's cached string hash, so a rolling hash
  reads characters (+143 to +784); interning each run is the trie's cost again (+106 to +200); a fingerprint of lengths
  collapses on plain messages of equal length (+325); a per-run store is unsound without its neighbours in the key.
- **New, from the attacker:** looking every entry up first and then running the line loops costs +20 to +54 where
  one-by-one costs +38 to +98: a batch call would halve the lookup's cost. Firefox pays 44 to 48 ns per lookup even for
  short keys and the same string object, and 30 to 50 ns more when the description was built right before the call.
- **What the API would have to say for the cheap path to be the common one, without hints:** content as runs of
  `{ text, style }` whose `style` is a handle the application makes once (it must cover the break mode and extra width
  too, the key needs a block style, and the handle must copy its spec so a later mutation can't change a key), texts
  never joined by the library, and nothing about what changed.

## Second look at the rich-key study (2026-09-20)

Nothing merges. Nothing under `rebuild/`, the 2026-09-18 folder or the study's own files changed. I only ran the study's built bundle. My work is in `~/github/pretext-rebuild/.artifacts/api-explore-rich-20260920/attack/`.

### The three sentences I would tell the maintainer

1. The fix is right and safe. It is one Map lookup on the first run's text, pointer-equal checks on the other runs, and inner nodes only where messages share a run. A separate harness reproduced its Chrome numbers, and I could not make two contents share an entry or make an inserted content miss.
2. Its headline workload (2.9 runs per message) is not your chat. On the demo's own 10,000 messages (18,613 blocks, 87% one run) the old trie already cost only +60 to +84 ns in Chrome. The fix brings +44 to +60, against +32 to +38 for a Map on plain strings. It is worth 54 to 74 ns on a rich block in Chrome (25 to 49 in Firefox and WebKit), 8 to 26 on the average block in Chrome, and nothing at 93,000 blocks.
3. What stays expensive is any lookup that sits in front of the line loop. Strings rebuilt every frame also stay expensive, and that is the application's to fix. Two engine surprises the study missed remain: Firefox charges 30 to 50 ns more when the description is built right before the call, and the sketch file has one object too many for WebKit.

### How I measured

**Labels**
- **Loop:** the 2026-09-18 line loop over an array of kept entries, with no lookup. Every cost is "+N": ns per block over a base, as the median over rounds of the per-round difference, with quartiles in brackets.
- **Plain floor:** one Map on the block's whole text, kept by the application. It ignores styles, so it slightly favours plain text.
- **09-18 trie:** one Map lookup per run.
- **Grown trie:** the study's `rich-store-sketch.ts`, used unchanged.
- **Leaf holds tables:** the same store, with the Map's value holding the entry's tables directly. That is what the study's `bench.ts` measured.
- **Shapes:**
  - (a) kept run objects.
  - (b) run objects built per block inside the timed loop, right before the call. The base builds the same objects and then takes the kept entry.
  - (c) strings sliced from the message source, plus the objects, inside the loop. The base does the same slicing and building.
- **Pair mode:** each job alternates with its own base, so the store stays warm.
- **Rotate mode:** all jobs run every round, in a fresh random order, so the store is colder.

**Workloads**
- **Study's:** `texts2(777)` cut by `rng(4711)`: 10,000 messages, 2.86 runs each.
- **Chat:** the Markdown chat demo's generator (`createMarkdownChatSpecs`), lexed by marked and cut into blocks the way the demo's model does.
  - 10,000 messages give 18,613 blocks, 16,634 of them distinct.
  - 1.35 runs per block, 86.9% one run, 85 characters, 9 styles.
  - 2,432 rich blocks of 3.7 runs each; 9.5% of them share their first run with another block.
  - 50,000 messages give 93,214 blocks.
- **Entries:** the 2026-09-18 packed tables over a stand-in Canvas. 753 chat blocks that the prototype's tables could not take got a Latin stand-in text of the same length for the entry. The key is always the real text.
- Every job must return the loop's line total, or the run throws.

**Engines and load**
- Browsers: pinned Chrome 153.0.8010.50 (V8 15.3), pinned Firefox 156.0 (SpiderMonkey), webkit-host on WebKit 22625.1.29.11.27 (JavaScriptCore).
- Three exclusive browser stretches:
  - a1: 06:14:38 to 06:16:13, load 55 to 56.
  - a2: 06:22:57 to 06:23:30, load 36 to 38.
  - a3: 06:39:54 to 06:42:00, load 34 to 36.
- Each browser run: 21 to 41 rounds of 1 repetition after 5 to 8 warm-up runs per job, cross-origin isolated. The timer step is 5 µs in Chrome and 20 µs in the other two.
- Command line under `nice -n 10`: node 26.9.0 (V8 14.6) and node 23.10 (V8 12.9), 31 to 81 rounds after 6 to 10 warm-up runs, load 35 to 69.
- bun 1.4.0 was unusable. Its loop median was 4,544 ns against a minimum of 359. Only its `===` and Map minima are quoted.

### Verdict per claim

| Claim | Verdict |
|---|---|
| The 09-18 trie costs +119 to +143 in Chrome (warm, 10,000 messages); plain +23 | **Stands with a correction.** Plain: +24 [24..25] here. Trie: +92 to +99 here, which is the study's own "+79 to +100 in two other groups". Say +80 to +140 by page. It holds for 2.86 runs per message; on the chat corpus the trie costs +60 to +69 warm and +76 to +84 cold. |
| The grown trie costs +63 to +70 for (a) and (b) | **Stands.** Chrome pair: (a) +57.5 [52..60] and +73 [70..78]; (b) +43 [42..46] and +73.5 [67..79]. node 26 pair: +64 and +67. |
| Firefox +71 to +80, WebKit +38 to +48 | **Doesn't stand for Firefox (b).** Kept objects (a) cost +54 to +80. Objects built right before the call (b) cost +100 to +134. **WebKit stands only for the measured layout:** the sketch file as written costs +76 to +78, and with the tables in the leaf +35 to +38 on the chat. |
| The reason is lookups in front of the loop and the cold objects they walk; a lookup costs its latency | **Stands.** Looking every entry up first and then running the loop costs +20 to +54 in Chrome, where one pass costs +38 to +98. Firefox and WebKit show the same. |
| One `Map.get` on the first run, `===` on the rest, inner nodes only where shared; 596 Maps against 17,480; nothing stale | **Stands, with caveats.** I count the same 17,480 and 596 Maps (chat: 6,509 against 154). "Nothing stale" holds for the key only; see the correctness section. |
| A plain message as one run costs 5 to 10 ns over a string call, so one code path | **Stands with a correction.** Chrome, 16,181 one-run blocks: +38 to +45 against +22 to +23.5 for the floor, so +12 to +21. WebKit: +2.5 to +16. Firefox: +5 kept, +9 to +41 built in the loop. The study's +5 to +10 reproduces in its own harness (node 26: +21 and +30) only because its wrappers are built in a batch before the timer. One path is still the right call. |
| (a) and (b) cost the same | **Stands in Chrome and WebKit. Doesn't stand in Firefox**, where (b) is 19 to 58 ns above (a) at 18,613 blocks and 58 to 68 at 93,214. node 26: (b) is +10 to +16 above (a). |
| (c) stays about +150 (Chrome), +185 (Firefox), +120 (WebKit); V8 makes fresh keys canonical through a runtime call; the application's to fix | **Stands, and the reason is confirmed in source.** See "Strings rebuilt every frame" below. With slicing inside the loop, Firefox (c) is +205 to +336 and Chrome's is +97 to +274. |
| No algorithm beat the fix | **Stands as far as it goes.** I did not re-measure rolling hashes, fingerprints or run ids. The one thing that beat it is not a key scheme: the two-pass lookup above. |
| Per-run store is unsound | **Stands.** I spot-checked DESIGN.md §3's table for the facts it cites: one `text_content` per block, WebKit's break iterator seeded from the previous box, Gecko's line-breaker words running across frames. |
| API: runs of `{ text, style }`, handles made once, texts never joined, no hints | **Stands with two additions.** See the fit section. |
| Small effects: parallel arrays 13 ns, inline key 8 to 10, hidden classes 12 to 18, `string` or runs at one call site 6 to 18 | **Not settled.** Object placement alone moved my numbers by 20 to 40 ns. The study's choices (don't bother) are unaffected. |

### 1. The central table again

Study's workload, ns per message over its base. Rows list (a) / (b) / (c).

| | plain floor | 09-18 trie | grown trie |
|---|---|---|---|
| Chrome 153, pair (a1, 31 rounds, load 55) | +24 | +92.5 / +99 / +224 | +57.5 / +43 / +154.5 |
| Chrome 153, rotate (a3, 41 rounds, load 35) | +32.5 | +107.5 / +126 / +421 | +54.5 / +73.5 / +274 |
| node 26 (V8 14.6), pair (61 rounds, load 58) | +25 | +155 / +173 / +317 | +64 / +67 / +183 |
| Firefox 156, pair (a1) | +26 | +142 / +268 / +574 | +80 / +134 / +302 |
| Firefox 156, rotate (a3) | +74 | +110 / +224 / +556 | +66 / +132 / +336 |
| WebKit, pair (a2, 41 rounds, load 37; grown trie only) | | | +78 / +76 |

- The first rerun of the study's bundle, under load 60 to 70, was starved: the node 23 loop ran at 636 ns.
- Its usable half, in node 26, gave the grown trie 1.73 times the loop for (a), 1.81 for (b) and 2.61 for (c). The study's Chrome ratios are 1.76 to 1.79 for (a) and (b), and 2.68 for (c).
- WebKit's other runs on this workload were too noisy to quote (loop quartiles 188 to 381).

### 2. The ways micro-benchmarks lie, and what is left of the gain

**Already handled by the study**
- Results are used: every job checks its line total.
- Keys come from arrays, so nothing is constant-folded.
- Fresh strings are rebuilt before every timed run, so no hash is left cached from an earlier variant.

**Harness faults found**
- The study's rotate mode is a cyclic rotation, so each job always runs after the same other job, and that job decides what is warm. My first harness had the same fault. With a random order per round the magnitudes stayed similar.
- The study builds shapes (b) and (c) in a batch before the timer, so allocation and collections fall outside the timed region. With the building inside the loop, Chrome and WebKit agree with the study. Firefox does not.
- Pair mode did not slow the base next to heavy jobs. I checked the base's 10th percentile for every pairing in the browsers.

**The real distribution** (chat corpus, 18,613 blocks). Rows list (a) / (b).

| | plain floor | 09-18 trie | grown trie | leaf holds tables | grown (c) | two passes (a) |
|---|---|---|---|---|---|---|
| Chrome, pair (a1, a3) | +38, +32 | +60 / +60 and +69 / +60 | +46 / +51 and +59 / +50.5 | +52 / +43 | +101, +97 | +29.5, +37.6 |
| Chrome, rotate (a1, a3) | +32, +34 | +84 / +82.5 and +76 / +77 | +58 / +66 and +60 / +69 | +59 / +60 | +153, +129 | +35, +36.5 |
| Firefox, pair (a1, a3) | +35.5, +38 | +76 / +103 and +68 / +98 | +52 / +70 and +49 / +68 | +36.5 / +55 | +211, +205 | +33 |
| WebKit, pair (a1, a3) | +43, +42 | +71 / +73 and +70 / +69 | +67 / +65.5 and +58 / +63 | +35.5 / +37.6 | +136.5, +110 | +47, +32 |

**What is left of the gain**
- Rich blocks only (2,432 blocks; Chrome a2, pair; (a) / (b)): floor +21; 09-18 trie +101 / +109; grown trie +47 / +35.
  - Firefox: trie +66 / +123; grown trie +41 / +74.
  - WebKit: trie +74 / +90; grown trie +41 / +41.
  - Firefox's and WebKit's 20 µs timer means 8 ns steps at this size.
- The average block in Chrome gains 8 to 26 ns, in Firefox 19 to 33, in WebKit 4 to 12.
- At 93,214 blocks in Chrome there is no gain:
  - Rotate (a1): trie +71 / +88, grown trie +69.5 / +83, floor +40.
  - Pair (a3): trie +88 / +83, grown trie +98 / +95.5, floor +40.
- At 93,214 blocks in Firefox, pair: trie +90 / +270 against grown trie +78 / +136.
- At 93,214 blocks in WebKit, pair: grown trie +141 / +134, leaf holds tables +78.5 / +68, floor +80.5.
- A pass in another order than first sight (Chrome a1, rotate) moves everything together: loop 158, floor +134, trie +238, grown trie +232, (c) +277, two passes +66. A turnover re-inserts in pass order, so the Maps heal, but the objects stay where they were allocated.

### 3. Correctness of the key

`check-sketch.ts` ran 60,000 random keys over 20 trials. The keys include empty texts, shared prefixes, a key that is a prefix of another, equal texts under other styles, other cut points, NUL, and precomposed against decomposed spellings. Every key was probed with its own and with freshly built string objects, and the store was rebuilt in a second insertion order.

- **Results:** 0 wrong finds, 0 wrong hits or misses, 0 answers that depend on insertion order.
- **Two contents on one entry: not possible.**
  - Keys are compared by value with `===`, and strings are immutable.
  - After the application mutated the array and a run it had passed, the old content still finds its entry and the mutated content misses, because `insert` copies the key.
  - Style ids of NaN, -1, 1.5, `undefined` and the string "1" never cross-hit. -0 is style 0.
- **A content that misses for ever: not possible.** No object identity is in the key. The study was right to reject the WeakMap on the runs array.
- **Caveats outside the key**
  - The 2026-09-18 prototype's `style(spec)` keeps the caller's object by reference, so a spec mutated in place would make entries stale. `style()` must copy.
  - A style id of 5,000,000 makes the sketch fill 5,000,001 array slots, so ids must be the library's own small integers.
  - An empty runs array throws a TypeError.
  - Loaded fonts, zoom and page language are outside the key, as before.
- **Memory when content never repeats** (a streaming block):
  - Every frame is a miss that leaves a dead entry.
  - The prototype's turnover counts entries (twice S), not bytes.
  - So a 10,000-message chat keeps up to about 10,000 dead entries of a growing block before a turnover.
  - This comes from reading `idem.ts`; I did not measure it. The study's in-place extension, or a rule that counts bytes, would stop it.

### 4. Does the shape fit an immediate-mode Markdown chat?

Yes, without asking for retention the chat doesn't already have.

- The demo parses at startup and keeps pieces `{ text, style, breakMode, extraWidth, href }`. `style` is already one interned object per variant and marks (`resolveTextStyle`).
- Parsed runs are "parse early" data in the engineering guide's sense, and the painter needs them anyway. An immediate-mode rewrite hands the kept pieces (shape a) or rebuilds `{ text, style }` wrappers around them (shape b).
- `marked.lexer` alone costs 5.9 µs per message (bun, 5 passes over 2,000 messages, range 5.4 to 10.5). That is about 40 times the key cost of shape (c), and 59 ms per pass at 10,000 messages. No application at that scale can re-lex every frame anyway.

Two additions the study's API page lacks:
1. A run is more than text and font. The demo's pieces carry `break: 'never'` and `extraWidth`, and the style handle has to cover them. The key also needs a block style: the chat uses `pre-wrap` code blocks and a direction per paragraph. That costs one more integer comparison.
2. Handles made once are handles the application keeps. They are constants beside its font strings, which is fine, but say so. Styles made on the fly, such as an animated font size, grow a table nobody evicts.

One tension remains. The engineering guide's String section recommends views, sliced at measure time, and that is shape (c). A run given as a view (source, start, end) could be keyed without slicing, but it would key on source instead of on what is prepared. Markdown text isn't a view of its source anyway, because of escapes and merged pieces. I did not explore this.

### 5. Which conclusions hold in all three engines

**All three**
- Lookups in front of the loop cost their latency.
- The fix gains 25 to 74 ns per rich block.
- Shape (c) costs the most.
- The two-pass lookup gains.
- The key is correct.

**V8 only**
- Fresh keys pay a runtime call that barely grows with length, and `===` on a slice pays a fixed fee.

**Firefox only**
- Fresh keys cost by length, at about 0.8 ns per character.
- A stored key of 8 or 16 characters costs 44 to 48 ns per `Map.get` every time, even as the same string object. Keys of 48 and 128 characters cost 10.
- In the chat corpus, 42% of rich first runs and 17% of plain blocks are under 24 characters.
- The penalty for shape (b) is Firefox's alone.

**WebKit**
- Strings are cheap everywhere. Objects between the Map and the tables are what cost.

#### Strings rebuilt every frame

- **V8 15.3 source.** `TryLookupOrderedHashTableIndex` calls `Runtime::kInternalizeString` for any string key that is neither canonical nor thin, then compares pointers. `===` unwraps only thin strings and flat cons strings; a sliced operand goes to `Runtime::kStringEqual`. The study's `===` rows used flat copies only, so they missed the slice fee.

ns per string, for strings of 16 / 48 / 128 characters. Browser rows are a2, 31 rounds after 8 warm-up runs, load 36 to 38.

| | `Map.get`, known key | `Map.get`, fresh flat copy | `Map.get`, fresh slice | `===`, flat copy | `===`, slice |
|---|---|---|---|---|---|
| Chrome 153 | about 8 | 30 / 34.5 / 41.5 | 39 / 43 / 49.5 | 3 / 4 / 7.5 | 9.5 / 10 / 12 |
| Firefox 156 | 48 / 10 / 10 | 52 / 78 / 138 | 48 / 78 / 134 | 4 / 4 / 6 | 4 / 6 / 8 |
| WebKit | 4 to 6 | 10 / 14 / 18 | 18 / 22 / 26 | 2 / 4 / 6 | 4 / 4 / 8 |
| node 26 (41 rounds, load 30) | about 10 | 46 / 52 / 63.5 | 58 / 65 / 73.5 | 2.7 / 3.5 / 5.4 | 10.8 / 11.6 / 12.8 |

#### Firefox and descriptions built in the loop

- Owner workload, a2: (a) +54, (b) +100, and (a) with unrelated garbage allocated per block +58.
- So allocation and collections alone do not explain the extra cost. It is not explained.

### Limits

- Load was 34 to 58 for every number; other jobs shared the machine.
- Entries are plain-text tables over a stand-in Canvas, as in the study.
- I did not re-measure the hash and fingerprint variants, streaming, or the 1,000-message rows.
- The grown trie still has not run through the two-generation store.
- Firefox's engine sources under `js/src/vm` are not on this machine.
  - So its slow short keys are observed, not explained.
  - Its slow long keys when cold reproduce here, also without an explanation: floor +35 to +38 warm, +67 to +72 in rotate mode, +94 to +100 at 93,214 blocks.
- I killed no process. Every pid I started is in the log.

## Rich keys for the idempotent call: reasons, fixes, and what the API would have to say (2026-09-20)

This is a speculative study. Nothing merges. Nothing under `rebuild/` changed, and the 2026-09-18 folder is untouched. Everything is in `~/github/pretext-rebuild/.artifacts/api-explore-rich-20260920/`.

### Short answer

- **The reason.** The rich cost is not hashing, not allocation and not the JIT. It is how many Map lookups sit in front of the line loop, and how many cold objects each one walks.
  - The 09-18 trie does one `Map.get` per run, each in its own small Map: 17,480 Maps for 10,000 messages.
  - A lookup in front of the loop costs its latency, not its throughput, because the loop can't start before it ends. In Chrome a lookup that costs 11 ns alone costs 23 to 50 ns in front of the loop.
- **The engineering fix, called the grown trie below.**
  - One `Map.get` on the first run's text, then verify the other runs with `===`. `===` on the same string object is a pointer comparison, and an immediate-mode application hands the same string objects every frame.
  - Only where two messages really share a run is the Map's value an inner node with a Map on the next run. So 5,000 messages that start with the same bold sender name cost one more `Map.get`, not a walk over 5,000 entries.
  - 596 Maps instead of 17,480, 51 lines, no per-call allocation, nothing that can go stale.
- **Numbers, pinned Chrome 153, 10,000 messages, warm store, ns per message over the loop.**
  - Plain +23; 09-18 trie +119 to +143; grown trie +63 to +70 for shapes (a) and (b). A plain message passed as one run through the same path: +28.
  - At 1,000 messages: plain +10 to +14, trie +48 to +55, grown trie +30.
  - WebKit: grown trie +38 to +48 against plain +37 to +43. Firefox: +71 to +80 against +37 to +41.
- **Shape (c), strings rebuilt every frame, stays expensive in every variant.** It costs +149 to +158 in Chrome, and the application pays 38 to 55 ns more to slice. Modern V8 turns every fresh key string into a canonical copy through a runtime call, about 40 ns each. That is the application's to fix: keep the run strings, rebuild only the wrappers.
- **Algorithms.** None beat the engineering fix.
  - JavaScript can't read the engine's cached string hash. A rolling hash must read characters (+143 to +784) or intern each run through a Map (+106 to +200, the trie's cost again).
  - A fingerprint of lengths collapses on plain messages of equal length (+325).
  - A per-run store is unsound without the neighbours in its key, and it saves nothing per call.

### How it was measured

- **Workload.** The 09-18 per-call study's workload: `texts2(777)`, 10,000 chat messages of 126 characters. Each is cut into 1 to 5 runs at word boundaries by `rng(4711)` (2.86 runs on average), with three style ids of one font.
  - Entries are the 09-18 packed tables. They are built over the stand-in Canvas of the 09-18 offline smoke in every engine, so every engine looks up the same entries.
  - The stand-in gives 3.70 lines per message where Chrome's widths gave 2.75.
  - As on 09-18, a rich entry is the joined text laid out as one plain run. The key is a real rich key; the lines are not rich lines.
- **The loop.** The 09-18 line loop over an array of kept entries, with no lookup. Every cost below is "+N": nanoseconds per message over the loop, measured in the same process. Every job that ends in the loop must find the loop's line total, or the run throws.
- **Shapes.**
  - (a) the same arrays and run objects every pass.
  - (b) new arrays and run objects every pass around the same string objects: immediate mode over the application's own data.
  - (c) strings re-sliced from the message text every pass.
- **Two modes.**
  - Rotate mode is 09-18's. All jobs of a group alternate, and the order rotates every round. Between two runs of one job every other job runs, so every store starts cold.
  - Pair mode: each job alternates with the loop alone for all its rounds. Only the loop's and that job's data are touched, so the store is warm, as in a resize drag.
  - I report the median over rounds of the per-round difference; quartiles are in the result files. All jobs of a round use the same width.
- **Engines.**
  - Browsers: pinned Chrome 153.0.8010.50 (V8 15.3), pinned Firefox 156.0 (SpiderMonkey), and webkit-host on the system WebKit 22625.1.29.11.27 (JavaScriptCore). Three runs under the exclusive browser lock at 05:22, 05:29 and 05:38. Each job ran 21 rounds of 2 repetitions after 8 warm-up runs, cross-origin isolated. The timer step is 5 µs in Chrome and 20 µs in the other two.
  - Command line, under `nice -n 10`: node 23.10.0 (V8 12.9), node 26.9.0 (V8 14.6, fetched with npx to get a V8 near Chrome's) and bun 1.4.0 (JavaScriptCore). 41 to 81 rounds after 5 to 10 warm-up runs.
- **Load.** Apple M5 Max, 18 cores.
  - Load was 4 to 25 until 04:00 and 35 to 75 afterwards, the browser runs included (47 to 67). Other jobs' offline workers don't take the browser lock.
  - Pair-mode quartiles stayed within a few ns under that load. Rotate-mode medians and everything in bun did not.
  - bun's loop ran between 148 and 10,000 ns per message depending on the minute. So JavaScriptCore numbers are webkit-host's plus one calm early bun run (the reproduction table).

### 1. Reasons

#### The 09-18 rows again (rotate mode, cold stores; + over the loop)

| | Chrome 09-18 | Chrome today | Firefox | WebKit | node 23 (V8 12.9), load 4 | bun, load 5 to 8 |
|---|---|---|---|---|---|---|
| loop | 136 | 132 | 119 | 143 | 126 | 255 |
| plain, same string objects | +7 to +13 | +50 | +151 | +54 | +49 | +93 |
| plain, strings rebuilt (JSON.parse / a + b / slices) | +45 / +66 / +61 | +115 / +139 / +120 | +201 / +224 / +205 | +153 / +144 / +116 | +204 / +269 / +232 | +172 / +205 / +117 |
| composite key string | +97 | +215 | +258 | +214 | +313 | +263 |
| rich, trie, same objects / re-sliced | +123 / +248 | +124 / +256 | +112 / +321 | +169 / +207 | +241 / +316 | +259 / +302 |
| rich, joined key string | +280 | +299 | +394 | +300 | +502 | +436 |
| rich, Map on the longest run (09-18's), same / re-sliced | +121 / +193 | +136 / +257 | +72 / +259 | +83 / +182 | +123 / +273 | +166 / +285 |
| Map on the runs array object | +1 to +7 | +46 | +39 | +41 | +41 | +69 |

- In the same Chrome the trie and joined-key rows agree with 09-18 within 20 ns. The longest-run rows are +15 and +64 above it.
- The plain and identity rows don't agree: +46 to +50 here against +1 to +13. I couldn't explain that.
  - It isn't the strings' representation: flat or rope-built strings cost the same in V8 14.6.
  - It isn't sharing entry objects with the loop: a store with its own entry objects costs the same, +21.5 against +22.7 warm.

#### What one lookup costs alone (no line loop after it; ns per message)

| | Chrome 153 | Firefox 156 | WebKit | node 23 |
|---|---|---|---|---|
| `Map.get`, a string the engine has seen as a key (the message text) | +11 | +87 (not explained; 48 to 512-character keys: +7) | +6 | +14 |
| `Map.get`, number key / object identity / `WeakMap.get` | +7 / +8 / +5 | +6 / +11 / +6 | +0 / +1 / +0 | +10 / +9 / +8.5 |
| `Map.get`, equal string built fresh, 126 characters, first use | +56 | +124 | +92 | +193 |
| the same fresh string object, second use | +9.5 | +9 | +22 | +32 |
| fresh string by length 16 / 48 / 128 / 512 | +42 / +47 / +60 / +146 | +49 / +75 / +129 / +468 | +12 / +21 / +54 / +251 | +39 / +81 / +207 / +763 |
| `===`, equal content, different objects, 16 / 48 / 128 / 512 | 2.5 / 7 / 14.5 / 66.5 | 3 / 5 / 7 / 96 | 2 / 5 / 16 / 152 | 0 / 1 / 5 / 38 |
| `===`, the same object | under 1 | under 1 | under 1 | under 1 |
| walk the runs: read `style` / read `text.length` | +5 / +6 | +4 / +4 | +1 / +5 | +5 / +21 |
| trie lookups alone (2.86 `Map.get`) / first run then verify | +37 / +33 | +43 / +70 | +66 / +28 | +118 / +52 |
| joined key: build only / build and `Map.get` | +88 / +170 | +44 / +295 | +19 / +244 | +53 / +531 |
| styles per message: integer ids / Map on a font string per run / compare 3 fields | +5 / +12.5 / +8.5 | +5 / +16 / +9 | +2 / +6 / +8 | +4.5 / +13 / +8 |

#### Hypotheses, predictions, verdicts

1. **"It is the number of Map lookups."** Half right.
   - Prediction: rich costs about 2.86 times plain. Chrome, warm: plain is +23, so +66 predicted; measured +119 to +143.
   - One lookup per message (the fix) costs +63 to +70.
   - Each further trie level adds 30 to 40 ns, more than a first lookup. It is a separate small Map reached through a node and an array, and it can't start before the level above it returns.
2. **"A lookup costs what it costs alone."** Dead, and the largest named part.
   - Chrome: plain is +11 alone, +23 to +38 in front of the loop with a warm store, +50 cold. The trie is +37 alone, +79 to +143 warm, +124 cold.
   - Lookups alone overlap across messages in the processor. In front of the loop each is a chain of dependent loads that the loop waits for.
   - node 23 at 500 messages, all in cache: plain +6 alone and +20 in front of the loop; trie +52 and +93.
3. **"Cold or warm matters."** Confirmed.
   - node 23, trie (a): +347 in rotate mode, +139 to +212 in pair mode. First run then verify: +130 and +58 to +80. Plain: +51 and +24 to +31.
   - The 09-18 rows were measured cold.
   - At 1,000 messages everything is cheaper. Chrome: trie +48 to +55, grown trie +30, plain +10 to +14.
4. **"The key kind matters when the hash is cached."** Mostly dead.
   - In front of the loop in node 23 a string key and an object key cost the same (+24 and +23). Chrome: +23 to +36 against +20.
   - JavaScriptCore alone: a string +6, a number or an object +0 to +1.
5. **"Fresh strings: hashing is the cost, comparing is cheap."** True in V8 12.9 only.
   - V8 12.9: about 1.4 ns per character to hash (an old byte-at-a-time hash), 0.07 to compare.
   - In the pinned Chrome the cost is nearly flat: about 38 ns plus 0.2 ns per character.
   - The reason is in the V8 15.3 source (`builtins-collections-gen.cc`, `TryLookupOrderedHashTableIndex`; `string-hasher-inl.h` uses rapidhash). A string key that isn't canonical yet goes through `Runtime::kInternalizeString`. The string object then becomes a forwarding pointer to the canonical copy.
   - Seen with `%DebugPrint` in node 26 (V8 14.6): the key is a `THIN_ONE_BYTE_STRING` after `Map.set` or `Map.get`. In node 23 it stays as it was.
   - It fits Chrome's timing: a fresh string's second use costs what a known key costs (+9.5 against +11).
   - SpiderMonkey atomizes every string key too (`MapObject.cpp:55`). In JavaScriptCore comparing is the slow part: 0.3 ns per character.
   - Is a fresh slice's hash computed lazily and kept on that short-lived object? Yes in all four engines: first use +56 to +193, second use +9 to +32.
   - Is slicing itself the cost? About a third of it. Slicing 2.86 runs and building the objects costs the application 38 to 55 ns per message (node 23: 40 to 53). Building the objects alone costs 15 to 34.
6. **"Walking the description (property reads, shape checks)."** Small.
   - Run objects built with the same key order share one hidden class, even from two places in the source (`%HaveSameMap`). Another key order gives another class.
   - Reading 2.86 hot run objects: +1 to +5.
   - Built with 5 shapes: +14 in Chrome, +18 in Firefox, +12 in node 23, 0 in WebKit.
7. **"Comparing styles."** Small.
   - Interned integers cost nothing.
   - Style objects rebuilt each pass and interned per run through a Map on a font string: +0 to +4 in Chrome and Firefox, +12 in WebKit, +19 in node 23.
8. **"Allocation per call and the collections it causes."** Dead for the trie: it allocates nothing.
   - For the joined key the cost is flattening and hashing a fresh 140-character string on every call, not collection. node 23 `--trace-gc` counts 16 more young collections over 510,000 calls.
   - A lookup written with `for...of` over `entries()` and destructuring: +21 in node 23. Copying the description into tuples per call: +18.
9. **"The JIT, when plain and rich share a function."** Dead.
   - One entry point for `string | runs` with a `typeof` test costs 0 to +5 for a string and -6 to +12 for runs.
   - node 23 `--trace-deopt` over the whole group: 67 bailouts, all in setup code or on-stack replacement, none in a lookup.
   - But handing a string for one-run messages and runs for the others at one call site costs +6 to +18 more than handing runs for all.

#### The trie's +120 in Chrome (warm, 10,000 messages), named

- **+23:** one `Map.get` in front of the loop, the plain call.
- **+5:** reaching the key through the description (array, run object, string) and a leaf of its own. Measured: a plain message passed as one run through the grown trie costs +28.
- **+42:** what a several-run message adds in the grown trie (+70 against +28).
  - A second `Map.get` for the 11% of messages that share their first run with another.
  - Run strings that are slices.
  - Verification against the entry's two cold key arrays. Verification alone is +9 to +16 (ablation: the same lookup without it). A key kept inline in the entry saves 8 to 10.
- **+56 to +72:** the trie's 1.86 further levels (the trie less the grown trie, run by run).

### 2. Engineering

All rows are pair mode (warm), 10,000 messages, + over the loop. Ranges are over the browser runs. node 23's medians come from its calmest process (loop 100).

| | Chrome 153 | Firefox 156 | WebKit | node 23 |
|---|---|---|---|---|
| loop | 88 to 103 | 117 to 121 | 145 to 155 | 100 |
| plain text call | +23 | +37 to +41 | +37 to +43 | +25 |
| plain text as one run, grown trie (b) | +28 | +48 | +27 | not run |
| 09-18 trie (a) / (b) / (c) | +111 to +131 / +119 to +143 (+79 to +100 in two other groups of the same pages) / +209 to +286 | +114 to +129 / +172 to +178 / +312 to +339 | +106 to +117 / +103 to +119 / +196 to +210 | +158 / +138 / +274 |
| first run, chain, verify, flat entry (a) / (b) / (c) | +63 to +81 / +66 to +108 / +163 to +249 | +89 to +96 / +72 to +91 / +173 to +186 | +41 to +45 / +41 to +44 / +115 to +121 | +59 / +55 / +162 |
| the same, key inline in the entry (b) | +58 to +86 | +66 to +77 | +33 to +40 | +48 |
| longest run, chain, verify (b) / (c) | +60 to +90 / +150 to +223 | +52 to +60 / +184 to +203 | +24 to +32 / +127 to +142 | +59 / +207 |
| grown trie (a) / (b) / (c) | +60 to +69 / +63 to +70 / +149 to +158 | +82 to +90 / +71 to +80 / +166 to +192 | +34 to +40 / +38 to +48 / +113 to +122 | +59 / +59 / +166 |
| grown trie, longest run looked up first (b) / (c) | +61 to +62 / +157 to +183 | +60 / +198 to +201 | +37 to +38 / +132 to +136 | +80 / +244 (loop 137) |
| immediate mode as it runs: build the run objects, then call, per message (b) | +82 to +89, of which the application's building 18 to 34 | +84 to +101, of which 20 to 32 | +50 to +62, of which 14 to 31 | +67, of which 15 |
| the same with strings re-sliced (c) | +188 to +259, of which 38 to 55 | +212 to +226, of which 40 to 56 | +160 to +172, of which 36 to 41 | +249, of which 40 to 53 |

- **One code path.** A plain message as one run costs 5 to 10 ns over a dedicated string call. No separate structure for plain text is needed.
- **Keys from what the engine already keeps.** The store never builds a string. Style ids pick the Map. `===` does the pointer test and falls back to characters by itself, so there is no second comparison path to write.
- **Entry layout.** I tried two flat key arrays, the run objects kept as they came, and fields inline in the entry. They are within 15 ns of each other. Inline is fastest and needs an overflow path past 5 runs. I would not take it.
- **Which run to look up first.**
  - The first run is cheapest to reach.
  - The longest is the most distinctive: 33 Maps against 596 here. It is 13 to 20 ns faster in Firefox and equal in Chrome and WebKit. It hashes more characters in shape (c).
  - The grown trie makes either choice safe.
  - With plain chains instead, the shared-sender workload (every message starts with one of four bold names) costs the first-run store **+6,791** in node 23. On that workload the grown trie costs +74 in Chrome, +88 in Firefox and +47 in WebKit. The 09-18 trie costs +100, +425 and +115.
- **The three shapes.** (a) and (b) cost the same once the store verifies by pointer. (c) costs 75 to 110 more in every store and every engine.
- **A chat where 80% of messages are one run** (10,000 messages, warm; plain / 09-18 trie / grown trie / shape (c)).
  - Chrome: +29, +58, +52, +70.
  - Firefox: +29, +67, +60, +89.
  - WebKit: +37, +58, +20, +39.
- **1,000 messages** (all in cache; loop, plain, trie (b), grown trie (b), grown trie (c)).
  - Chrome: 50 to 57, +10 to +14, +48 to +55, +30, +81 to +85.
  - Firefox: 67, +12, +56 to +64, +30, +80.
  - WebKit: 66, +15, +49 to +56, +21, +62 to +67.
  - Built and called per message, less the application's own building, shape (b) costs the library +16 to +23 in all three.

### 3. Algorithms

| | gain measured (pair mode; Chrome / Firefox / WebKit / node 23) | code | state added | what can go stale |
|---|---|---|---|---|
| Reference: first run then verify, parallel arrays | (b) +74 / +74 / +42 / +58; (c) +172 / +189 / +116 / +167 | | | |
| Rolling hash over every character, in JS | (b) +225 / +211 / +143 / +784. A loss everywhere. JS can't read the engine's cached hash of a string, so the hash has to read the characters | 8 lines | none | nothing |
| The same hash over per-run ids (each run interned by one `Map.get`) | (b) +168 / +200 / +106 / +143: the trie's cost, since it is one lookup per run again | 15 lines | a Map of every run text, which needs its own eviction | ids of evicted runs |
| Two-level key: a number from lengths and styles, then `===` on a hit | (b) +94 / +83 / +62 / +100: a loss. (c) +206 / +159 / +110 / +170: a gain in Firefox only. In the 80% plain chat: **+325** in node 23, because plain messages of equal length collide (chains of about 30) | 12 lines | a `Map<number>` with chains | nothing |
| The same with three characters per run | (b) +97 / +72 / +34 / +100; (c) +170 / +138 / +99 / +167: for shape (c) up to 50 better in Firefox and 17 in WebKit, nothing in Chrome | 14 lines | the same | nothing |
| Per-run store | no per-call gain (the row above), and unsound as stated | | | |
| Prefix sharing for the streaming message | no key gain to be had; detection costs 0.2 to 0.6 µs per frame | about 15 lines | one reference to the last missed entry | that reference, at a turnover: clear it there |

- **Collision check.** For every number key it is the same `===` verification, 9 to 16 ns. It was never the problem.
- **Per-run store: is it sound?** No, from DESIGN.md §3 and the ports' types.
  - What a run owns alone: grapheme starts, break opportunities and piece widths strictly inside it, under its own style.
  - What belongs to a boundary:
    - White-space collapsing. Blink builds one `text_content` for the block, so a space that starts run 2 disappears after a space that ends run 1. That changes run 2's own content.
    - The break opportunity between the last unit of one run and the first of the next.
    - Shaping across the boundary when both sides have the same font. A `BlinkGroup` is "one Shape call over consecutive text items". Gecko's text runs continue across frames with equal font, and its line breaker's current word runs across spans.
    - WebKit's `BreakablePositions` reading the two code units before its start, and its edges "decided with the next box's style".
    - A Common character taking the script of the run before it.
  - What belongs to the paragraph: whether bidi is on, Blink's `is8Bit` and `segmented` (they change how every range is spelled to Canvas), and the list of contexts.
  - So a per-run entry must carry its neighbours' edges and the paragraph's flags in its key, which is the message key again.
  - The fast loop also needs one table per message, with positions as sums over the whole paragraph. So the combine step rebuilds the message entry. It can only save first-sight time, never per-call time.
- **Why item reuse measured 0.98 to 1.05 times on main, and whether that transfers.**
  - A chat paragraph has about 3 items, so what reuse saves per item is what matching the items costs.
  - It transfers, and more so. The rebuild's boundary facts make reuse conditional, and only 12% of the runs in this workload occur twice.
- **Prefix sharing.**
  - A growing message is a miss every frame, and no key scheme changes that. The gain is in prepare, which is not this part.
  - What the store needs is to find the entry it may extend, without hints. When the first run is unchanged, the grown trie leads to it.
  - For a plain growing message the first run is the one that grew. So keep one reference to the last missed entry and test `startsWith`.
  - That test costs 0.6 µs in node 23 and 0.2 µs in bun for 2,000 characters. A first sight of that block costs about 640 µs at the prototype's speed. Hashing the fresh 2,000-character key costs 2.3 µs in node 23 and 0.2 µs in bun.
  - Extending in place also stops each token from leaving a dead 2,000-character entry behind until the next turnover.

### 4. What the API would have to say

For the cheap path to be the common one, without hints:

1. **Content is an array of runs, `{ text, style }`, and a plain message is one run.**
   - One call, `layout(content, width)`, one store, one code path. It costs 5 to 10 ns over a dedicated string call.
   - Handing a string for some messages and runs for others at the same call site is slower than runs for all (+6 to +18).
2. **`style` is a handle the page gives out once.**
   - `const bold = page.style({ font, lang, ... })` returns a small integer the application keeps beside its font constants.
   - The handle picks the Map and makes style equality an integer comparison. It spares the library from defining when two style objects are equal.
   - Style objects per run would cost 0 to 19 ns.
3. **The texts are the application's own strings, and the library never joins them.**
   - A joined key costs +170 to +530 alone.
   - The documentation says one thing: pass the strings you keep.
   - Rebuilding the arrays and run objects every frame is fine. It is the application's own 15 to 34 ns per message.
   - Rebuilding the strings costs the application 38 to 55 ns to slice, and the library 75 to 110 more to recognize them.
4. **Build runs with one shape**, `{ text, style }` in that key order everywhere. Five shapes cost 12 to 18 ns in Chrome, Firefox and node 23. A helper isn't needed; a sentence is.
5. **Not parallel arrays.** `texts[]` beside `styles[]` is 13 ns faster in Chrome and equal in Firefox, WebKit and node 23. It costs the same to build. That is not worth a less natural shape. One flat `[text, style, ...]` array measures the same.
6. **No handles, no hints, no identity cache.**
   - A `WeakMap` on the runs array would save a retained application 25 to 30 ns. It serves shape (a) only, needs the verification anyway because arrays are mutable, and adds a second path.
   - Streaming needs nothing in the API (section 3).

**The three shapes beside the loop's 136 and main's 228** (Chrome 153, 10,000 messages, warm store). This study's loop is 88 to 103 because its tables differ, so the last column adds this study's overhead to 09-18's 136.

| per message | over the loop | on 09-18's scale |
|---|---|---|
| line loop over kept handles | 0 | 136 |
| plain text call | +23 | about 160 |
| rich (a), retained | +60 to +69 | about 200 |
| rich (b), immediate mode over the application's strings | +63 to +70 | about 200, plus the application's 18 to 34 for building its objects |
| rich (c), strings rebuilt every frame | +149 to +158 | about 290, plus the application's 38 to 55 for slicing |
| 09-18 trie, (a) / (b) / (c) | +111 to +131 / +119 to +143 / +209 to +286 | 250 to 270 / 255 to 280 / 345 to 420 |
| main's `layout()` over stored handles (09-18) | | 228 |

Cold-store numbers for the grown trie were not taken in the browsers. In node 23, rotate mode, first run then verify (b) costs +81 to +92 where the trie is +233 to +265 and plain +46 to +51.

**What stays expensive.**

- Shape (c): +150 in Chrome, +185 in Firefox, +120 in WebKit, in every store I tried. In modern V8 and in SpiderMonkey every fresh key string pays for being made canonical, and the other runs are compared by characters.
- It is the application's problem. A description parsed from Markdown every frame has already cost far more in the parser than the key costs here. The fix is the application's own data: parse when a message changes, keep the run strings, rebuild only the wrappers each frame.
- The library's part is to make (b) cheap and to say so.
  - At 10,000 messages in Chrome and Firefox, (b) still costs 30 to 50 ns more than plain. Most of that is cache misses on the entry's key and a second lookup for the messages that share a first run.
  - In WebKit it is within 10 ns of plain. At 1,000 messages it is 6 to 20 ns above plain in all three.

### Limits

- The machine ran at load 35 to 75 for most of the night, the browser runs included. Pair-mode differences were stable (quartiles within a few ns). Absolute loop times moved by 30% between processes. bun was unusable after 04:00.
- My plain and identity rows in Chrome are 20 to 40 ns above 09-18's, and the longest-run re-sliced row is 64 above; the trie and joined-key rows agree. Not explained.
- Firefox's plain lookup costs +87 alone and +151 in rotate mode, yet +37 to +41 warm. Keys of 48 to 512 characters cost +7 alone. Not explained; only `MapObject.cpp` of Firefox's engine is in the local checkout.
- The V8 facts come from the 15.3 source and from `%DebugPrint` in V8 14.6 and 12.9, not from the pinned Chrome itself. Chrome's timing agrees with them.
- Entries are plain-text tables over a stand-in Canvas. Rich keys were timed in front of the joined text's lines, as on 09-18.
- The grown trie was not run through the two-generation store. A generation would own its trie, and promotion is an insert.
- One exclusive browser slot (04:07) was wasted by a word-splitting bug in my job script. No browser was launched in it.

### Files

- `bench.ts`: every store and job, including `zFind`, `zInsert` and `zlFind`.
- `rich-store-sketch.ts` with `rich-store-sketch.check.ts`: the recommended store alone, 51 lines, checked on random keys.
- Harness: `cli.ts`, `page.ts`, `run.ts`, `build.ts`, `explore.sh`, `browser-job2.sh`, `summarize.py`.
- Engine inspection: `inspect-v8.js`, `inspect-v8-keys.js`.
- Results: `results/summary-browsers.txt`, `results/summary-node-bun.txt`, and `results/*.json` and `*.txt` (raw runs with their load).
- `.progress-rich-keys.txt`: the log.
