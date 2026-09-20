# What main does right, measured for the rebuild: a width store, a fill that asks nothing, short questions (2026-09-19)

The maintainer's steer for the profiling phase: if main is faster at something while catering to the same things, main
did something right that the rebuild should take back, unless it is incompatible with its architecture. Three things
were named: one store of measured widths with the page's lifetime, a layout step that asks Canvas nothing, and short
questions that repeat. One agent studied what each would buy, engine by engine, with no library change (branch
`x-perf-store-study`: tools and checks only); a second agent attacked the study (its first two starts were lost to a
dropped network connection; their checks are on the branch and the third used them). The attacker's review comes first.

## What came back, and the orchestrator's reading

- **The smallest change nobody had ranked:** research/PROFILING-START.md item 6's B1b, the safe test of Blink's 256 px
  cut, a two-line deletion. In real Chrome a chat message's calls go from 282 to 178 (322 to 212 on the mix) with the
  same lines. With item 1 (research/PERF-LIFETIME.md) the study's method sums to about 1.8 to 2.0 s for 10,000 ASCII
  messages and 2.0 to 2.4 s for the mix in Chrome: at the maintainer's bar before any store. It is a recipe change, not
  a refactoring: 3,124 tier cases change their gap lists, so it needs a new Chrome recording and a field-by-field proof
  that no line moves.
- **A page-lifetime store would hit often, but its key is not simple.** On text used once the hit rates are Blink 73%,
  Gecko 92%, WebKit 92% (the study's 81 / 99 / 99 were on the bench's generator, which repeats itself more). No key has
  two answers inside one Canvas context. But Firefox gives one key two answers inside one page (an emoji measured 21,
  17 and 21 px within a second while the process loaded its fallback fonts), so a page store can go stale there; WebKit's
  key needs the page language and Chrome's the string's storage partition. Chrome's own canvas keeps only its newest
  15,000 to 20,000 strings, so it is not a page store by itself, and its memory stays bounded under item 1.
- **Short questions are exact where it matters most.** A word measured with its space equals the recorded position at
  379,714 of 379,714 positions where both sides of the space have a script; 818 of 28,774 miss where a side has none
  (Amiri's brackets, up to 136 px), which is 1.2 to 1.7% of chat words. Firefox's cluster sums are exact for Han, kana
  and Hangul (267,740 of 267,740) and not for Thai, Khmer, Burmese and the Indic scripts.
- **"A fill that asks nothing falls out of short questions" does not stand:** about 120 of a Blink fill's 157
  questions are inside words. A fill that asks nothing needs its own work (PROFILING-START item 2).
- Blink's questions grow with the device pixel ratio (239, 357 and 466 a message at ratios 1, 2 and 3 under the stand-in
  Canvas); the bench has only run at 2.
- Expected after all four steps, Chrome, the mix: 0.9 to 1.4 s per 10,000 messages (the attacker's correction).
- **The order the orchestrator takes from it:** item 1 in its smaller form; B1b; then Blink's questions inside words at
  fill time (item 2) and Firefox's fill on CJK and Arabic (item 3); a page store only after those, if the bar still
  asks for it, because it is the one step with an invalidation problem the library can't see.

## Second pair of eyes on the store study (2026-09-19)

The store study (branch `x-perf-store-study`, report `.artifacts/session/perf-store-study-report.json`) asked what main's three accelerations would buy the rebuild: one store of measured widths, a layout step that asks Canvas nothing, and short questions that repeat. I reran its central numbers, attacked its weakest claims, and give a verdict per claim. Nothing under `rebuild/src` changed. My checks are new tool files and commits on the same branch. The branch's diff against 8058f06 touches `rebuild/tools/store-*.ts` (13 files) and 8 added lines of `rebuild/DESIGN.md` only.

**About the handoff.** The brief said an earlier attacker left two untracked tools and nothing else. The worktree held more: seven commits made between 17:45 and 18:03 (four checks and their DESIGN.md lines), a results folder (`.artifacts/probes/perf-store-study-attack/`) and the log of a full 39-gate run. I read the four tools, re-read or reran their outputs, and use them below. Each number says whose run it is: "first agent", "earlier attacker" or "mine".

**The machine.** On AC power for every timed run (the scripts print `pmset` at start and end). My runs were on the laptop's built-in display, the afternoon's on the external displays; the same Mac (uptime 3 days throughout), device pixel ratio 2 both times. Other agents loaded it heavily between my quiet stretches (1-minute load 30 to 84). My exclusive stretches: 2.4, 0.4, 11.5 (loaded, cut short), 4.5 and 3.5 minutes.

### 1. Verdicts

| # | The study's claim | Verdict | Correction or note |
|---|---|---|---|
| 1 | A Canvas call is cheap everywhere: 0.2 to 0.9 µs up to 8 units, even the first time | stands | Mine: Chrome 0.73 to 0.83, Firefox 0.17 to 0.33, webkit-host 0.42 to 0.83 µs (section 2) |
| 2 | In Chrome a repeat on a kept canvas costs 0.14 µs, so with shared contexts Chrome's canvas already is the store | stands with a correction | One canvas keeps only the newest 15,000 to 20,000 strings it met. That covers repeats inside a message and the last 150 to 200 messages, not the page's life. It also means Chrome's own memory stays bounded under item 1 (section 3.4) |
| 3 | The floor is the library's own JavaScript: 0.89 / 1.14 s (Chrome), 0.29 / 1.08 s (Firefox), 0.08 / 0.12 s (webkit-host) per 10,000 messages | stands | Mine: 0.89 / 1.06, 0.27 / 1.07, 0.08 / 0.12 s. The study's two probes add up to the item 1 bench row within about 12%, which supports the method (section 2) |
| 4 | webkit-host is not slow; PROFILING-START's 11.7 s and 28 µs a call don't reproduce | stands | Three bench runs by the item 1 agent (two quiet, one loaded) have 0.242 to 0.276 s. In the slow morning run the page's fixed arithmetic took 27.6 ms, the same as in the quiet run (27.8 ms): the process wasn't throttled, the time was inside `measureText`. Cause still unknown (section 3.9) |
| 5 | In Chrome a run measured whole equals its words measured with their neighbouring spaces, less inner spaces (11,837 of 11,837 runs, 10 fonts) | stands with a correction | Chrome's recorded answers agree at 379,714 of 379,714 positions where both sides hold a character with a script of its own, over 641 font strings. They disagree at 818 of 28,774 positions where one side has none (brackets), all in Amiri, by up to 136 px: measured out of its run such a word gets another script. About 1.2 to 1.7% of chat words have no script of their own (section 3.5) |
| 6 | In Firefox clusters alone equal the long suffix recipe for Chinese (13,353 of 13,353) | stands, and more widely than shown | Firefox's recorded answers: 267,740 of 267,740 for Han, kana and Hangul over 220 font strings. It does not carry to the other scripts written without spaces: Thai, Khmer, Burmese and Indic text is exact at 98.6% alone and at 232,864 of 232,884 with pairs (section 3.5) |
| 7 | Arabic does not decompose | stands | Records: 58% alone, 88% with pairs |
| 8 | A page-lifetime store of today's questions buys about 0 to 0.5 s of 3.5 s in Chrome, and Blink's store grows by 86 strings and 2,300 units a message | stands with a correction | On text used once the store hits less: Blink 73% (study: 81%), Gecko 92% (99%), WebKit 92% (99%), and it grows by about 100 strings a message in Blink. The conclusion (a store last or never) gets stronger. A store can also go stale in Firefox, which the study didn't say (row 9, section 3.3) |
| 9 | The key (a context's settings and the string; the parent string where storage is forced) decides the answer | stands with a correction | No key has two answers inside one recorded context, in any browser. Across contexts: Chrome needs the storage partition in the key (27 keys, the known twins). Firefox: 91 keys hold an emoji or a lone surrogate and have two answers under the same page facts, from the process's font fallback state, which changes during a page's life (DESIGN.md `page-history`, TAKE-BACK 5.5). I showed it inside one page: 21 px, 17 px, 21 px within a second. webkit-host: the page language is part of the key (2 keys) and lone surrogates vary (4 keys) (section 3.3) |
| 10 | The question classes are read from call sites | stands | The rules name the functions that really make the calls; no call fell into "other"; the tail calls JavaScriptCore drops aren't frames the rules read. One Gecko class ("cluster before a candidate" against "prefix or suffix with a joiner") is split by string length, not by site: an Arabic letter plus U+200D lands in the first. Small (section 3.1) |
| 11 | "A fill that asks nothing falls out of short questions for ordinary text" | doesn't stand as written | Blink's break search reads positions inside the word at the line's end. Word-with-space facts don't hold those; today they are about 120 of a fill's 157 questions (pair windows and prefixes). They would have to be asked ahead per word, or stay Canvas repeats in the fill. Asking ahead as the questions are today costs what the study says: mine, over 61 widths, +130 to +143 distinct questions a message in Blink and +151 to +197 in Gecko, about +0.6 to +0.8 s per 10,000 messages in Chrome, +0.3 s (ASCII) to +0.5 to 1 s (mix) in Firefox (section 3.6) |
| 12 | The expected times | stand with corrections | (i) is another agent's measurement; a second quiet run of theirs agrees (3.52 / 4.08 s against 3.49 / 3.82 s). (ii) follows from the replay. (iv): Chrome ASCII 0.4 to 1.0 s follows, and I would narrow it to 0.55 to 0.95 s (the fill's 28 µs stays). For the mix the low end is too low: CJK and URL messages are 12% of the messages and 21% of Blink's questions and stay on today's path, so 0.9 to 1.4 s, not 0.6 to 1.3 s. All under the bar (section 3.8) |
| 13 | The order: item 1, short questions in Blink, cluster sums in Gecko, relayout, a store last or never | stands with a correction | The study didn't weigh a change the phase already lists (PROFILING-START item 6, RECIPE-COSTS' B1b): the safe test of the 256 px cut search is the largest class of long strings, and taking it out is a two-line deletion. In real Chrome it takes the calls from 282 to 178 a message with the same lines, the library's own JavaScript from 0.89 to 0.52 s per 10,000 messages, and Canvas work under shared contexts from 298 to 149 µs a message. With item 1 that sums to about 1.8 to 2.0 s (ASCII) and 2.0 to 2.4 s (mix): at the bar before step (iv). It changes gap lists in 3,124 tier cases, so it needs a new recording and freeze (section 3.7) |
| 14 | The offline gates exit 0 on the branch | stands | Full form, 39 gates, exit 0 at c68879f (earlier attacker, 975 s). Quick form, 25 gates, exit 0 at ba77ba5, 4f7e7de and my last commit 30955c4 (mine, 135.8 s) |
| 15 | (not claimed) The numbers hold at a device pixel ratio of 2 only | new | Blink cuts a group into pieces below 256 zoomed px, so its questions grow with the ratio: 239, 357 and 466 a message at ratios 1, 2 and 3 (stand-in, ASCII). Gecko and WebKit don't move. Most phones are at 3 (section 3.7) |

### 2. The reruns

**Offline counts (no browser).** The six `--part=store` reports (10,000 messages, three engines, both sets) came out byte for byte the same as the first agent's files (earlier attacker's rerun), and so did the two `--part=short` reports (mine). The width unions were rerun on another list of 16 widths (160 to 760 px in steps of 40, 1,000 messages) and gave the same picture: Blink 158 and 174 distinct fill questions a message, Gecko 142 and 178, against the study's 160, 177, 143 and 179.

**Timed, under the rule.** One exclusive stretch of 2.4 minutes (18:36:39 to 18:39:03), AC power, 1-minute load 6.7 at the start and 3.1 to 4.9 after. Each probe alternates its own variants inside one page (5 or 10 rounds in rotating order), which is how the before and after share the stretch. Medians, with the range of the rounds in brackets. `run3` and `lib3` are the earlier attacker's runs at load 9 to 17 and are left out of the table; they agree in shape and are slower, by up to 2.7 times in places.

| µs | first agent | mine |
|---|---|---|
| Chrome, one call, first time, U+2028, 8 / 32 / 128 units | 0.85 / 1.78 / 5.39 | 0.83 / 1.76 / 5.52 |
| Chrome, again on the same canvas, 8 / 128 units | 0.11 / 0.14 | 0.13 / 0.13 |
| Chrome, the same string on another canvas, 8 / 128 units | 0.68 / 5.15 | 0.74 / 5.29 |
| Firefox, first time, 8 / 32 / 128 units | 0.33 / 0.50 / 2.50 | 0.25 / 0.58 / 2.75 |
| webkit-host, first time, 8 / 32 / 128 units | 0.75 / 2.42 / 10.9 | 0.83 / 1.83 / 10.3 |
| Chrome, an ASCII message's 269 short calls: on new contexts / on kept contexts | 130 / 31 | 128 / 32 |
| Map read of a string joined unit by unit, 8 / 32 units: Chrome | 0.08 / 0.20 | 0.08 / 0.20 |
| the same in webkit-host | 0.17 / 0.63 | 0.08 / 0.21 |
| replay, Chrome ASCII, a message: today / shared contexts / plus a store / short questions | 312 / 303 / 221 / 10.8 | 324 [304 to 486] / 262 [233 to 316] / 214 [195 to 274] / 10.9 |
| replay, Chrome mix | 378 / 329 / 245 / 18.8 | 354 / 334 [261 to 453] / 226 / 17.4 |
| replay, Firefox ASCII; mix | 28 / 18.5 / 7 / 5; 163 / 152 / 135 / 9 | 28 / 19 / 7 / 5.5; 158.5 / 147 / 129.5 / 9 |
| replay, webkit-host ASCII; mix | 15.5 / 4 / 2 / 8.5; 20.5 / 7.5 / 4 / 15.5 | 13.5 / 4 / 2 / 8; 17 / 7 / 3 / 16 |
| library, Chrome ASCII, a message from scratch: real / remembered / plain | 482 / 341 / 89 | 455 [411 to 738] / 320 [196 to 604] / 88.6 [83 to 90] |
| library, Chrome mix | 529 / 283 / 114 | 498 [448 to 1,143] / 355 / 105.6 [105 to 110] |
| library, Firefox ASCII; mix | 54 / 40 / 29; 265 / 127 / 108 | 54 / 38 / 27; 265 / 124 / 107 |
| library, webkit-host ASCII; mix | 17 / 16 / 8; 23 / 21 / 12 | 17 / 16 / 8; 22 / 20 / 12 |
| library, a kept paragraph at another width, Chrome: real / remembered / plain (ASCII; mix) | 58 / 28.5 / 28.2; 72 / 39 / 37 | 55.4 / 27.0 / 27.6; 69.7 / 35.7 / 34.4 |
| the same, Firefox; webkit-host (ASCII) | 18 / 11 / 12; 1.7 / 1.7 / 1.7 | 18.7 / 12.3 / 10.7; 1.7 / 1.7 / 1.7 |

- Everything timed reproduces. The one row that moved is webkit-host's Map read (half to a third of the study's). It matters for one sentence only: the study says a Map read of a rebuilt word costs what WebKit's `measureText` of it costs, and that this is why `remembered` is as slow as `real` there. By my run the read is 7 to 10 times cheaper than the call. `remembered` is slow because the probe's stub concatenates a key for every question. The replay is the better measure: a store takes webkit-host's Canvas work from 4 to 2 µs a message, 0.02 s per 10,000 messages. The conclusion (a store buys WebKit next to nothing) holds in absolute terms.
- A check of the method the study didn't make: its two probes should add up to the item 1 bench row. Replay with shared contexts plus the library's `plain` mode is 262 + 89 = 351 µs against the bench's 349 µs (ASCII), and 334 + 106 = 440 against 382 µs (mix). Scaled for the stand-in's extra calls (326 against 272, 361 against 311) they are 308 and 393 µs. Within about 12% either way.
- **Counts that need a browser.** The exactness probe gave the same result arrays as the first agent's run in all three browsers, entry for entry (mine, through browser slots; counts don't depend on load).
- **Not mine.** The whole-bench rows are the item 1 agent's. It ran the bench three times; the study quotes the first. The second (quiet, 1-minute load 1.7 to 7.4) has Chrome 5.08 / 4.13 s from scratch (mix / ASCII), Firefox 2.66 / 0.60 s, webkit-host 0.242 / 0.200 s, and row E 4.08 / 3.52 s, 2.47 / 0.47 s, 0.140 / 0.104 s. The third ran loaded (up to 46): Chrome doubled, webkit-host stayed at 0.276 s.

### 3. The attacks

#### 3.1 Do the question classes match the call sites?

Yes. `store-study.ts` `purposeOf` reads a call's class from the library functions on its stack. I read the three engines' measuring code against it.
- Blink (`engines/blink/shape.ts`): every question goes through `measure16`. The cut search is `addPieces` > `passesSafeTest` > `windowAdjust16` (the wide window, which shrinks by measuring again while its total is 256 px or more) and `pairAdjust16` (three strings). Positions are `groupPrefix16` > `positionAdjust16`, which takes the wide window before white space and the pair window elsewhere. The line breaker's safe test is `safeToBreak`. The rules name these functions, in an order that lets the inner one win.
- JavaScriptCore drops the frame of a function that ends in a call (`adjust16` returning `windowAdjust16`, `positionAdjust16` returning either, `prefix16` returning `groupPrefix16`). None of the rules needs a dropped frame: each tests the callee or a caller that stays.
- Gecko (`advance.ts`): `suffixAlone`, `ligatureAcross`, `groupAcross`, `pairKernedShare`, `askedPlacement` and `sameFace` are the sites. One rule is by string, not by site: under `inWordAdvance` a string of 1 or 2 units is "the cluster before a candidate" and a longer one "a prefix or suffix with a joiner". An Arabic letter with U+200D is 2 units and lands in the first class. It moves a fraction of Arabic messages' questions between two short classes.
- WebKit: `boxWidth`, `makeBox`, `breakWord`, `fixedPitchWidth`, `lineHyphenWidth` are the sites.
- No call was classed "other" in any of the six reports.
- The tier pass reads its phase from three line numbers of `lab/predictor-core.ts` (272, 277, 284). They are right at this commit, and the tool throws on a call outside them.

#### 3.2 Do the hit rates hold on text that isn't the generator's?

Partly. The generator's 10,000 messages are slices of a few texts, and the ASCII set covers its source about 4 times. `tools/store-real-text.ts` (earlier attacker) cuts the checked-in long-form corpora once from start to end, with the bench's message lengths, under the stand-in Canvas: `ascii-once` is the bench's English source (2,336 messages), `languages-once` the other corpora dealt in turn (Arabic, Hebrew, Hindi, Japanese, Khmer, Korean, Burmese, Thai, Urdu, Chinese, English with curly quotes; 6,468 messages).

| a store by settings and string, last block of messages | study, last 1,000 of 10,000 | text used once |
|---|---|---|
| Blink, ASCII: hit rate; new to the page a message | 81%; 80 | 73%; 103 |
| Gecko, ASCII | 99%; 1.3 | 92%; 6.9 |
| WebKit, ASCII | 99%; 0.3 | 92%; 2.7 |
| mixed languages, messages 501 to 2,500 (all eleven texts still running) | | Blink 68 to 69%, Gecko 58 to 65%, WebKit 82 to 84% |

- At the same number of messages the generator and the once-used text are close (Blink 74.7% against 73.1% at about 2,500 messages). The study's higher figures come from the later messages, when the generator has wrapped around its source.
- By string length, on English used once: strings of 1 or 2 units hit 100%, 3 to 16 units 61%, over 16 units 21%, and the last number does not rise with the page (22% in the first 100 messages, 21% in the last 336). In Gecko's mixed-language run strings over 16 units hit 0%.
- The short recipe's word facts (`tools/store-word-facts.ts`, mine; a fact is a word with the spaces beside it as it stands): on English used once 9.8 facts a message are new in the first 100 messages, 5.8 up to 1,000 and 3.6 after that, where the study has 9.9, 4.7 and 1.1. With all four forms of a word (alone, a space before, after, both) 36, 20 and 11.7 against the study's 35, 15 and 2.2. On the mixed languages 5 to 8 and 17 to 30, plus about one long word a message (30 to 69 units) while the scripts written without spaces are running. At 0.8 µs a first ask that is 3 to 25 µs a message, 0.03 to 0.25 s per 10,000. It doesn't overturn step (iv).

The study said its hit rates were flattered. These are the sizes. They push the same way as its conclusion.

#### 3.3 Does the key decide the answer?

`tools/store-key-check.ts` (earlier attacker; I reran it with every example kept) reads every recorded Canvas call of every tier case, held-out sets and twins included: 49.4 million calls and 928,786 keys in Chrome, 7.7 million and 618,187 in Firefox, 5.5 million and 150,239 in webkit-host (no supplied facts; the facts configuration is alike). A key is the seven settings the library assigns and the string.

- **Inside one recorded context no key has two answers, in any browser.**
- **Chrome: 29 keys with two widths.** 27 are the known string storage hazard: Latin-1-only strings of 13 units or more, all Amiri, all in the `twins` set. 18 of them differ between two contexts of one case with equal settings, which are the port's two storage partitions. So the key needs the partition. The study's "a Map per context of item 1's object" covers it only if that object keeps a context per partition, which PROFILING-START item 1 says it must. The other 2 are `Hamburgefonstiv` in `16px serif`, 114.40 against 111.70 px, between the run under the zh-CN process language and the one under en-US: a process fact, fixed for a page.
- **Firefox: 91 keys with two widths under the same page facts.** 83 hold an emoji and 8 a lone surrogate. One case recorded in two sets (`c-0c212a2aabd774b1`) has U+1F600 in `16px Arial` at 21 px in one recording and 17 px in the other. This is the process's font fallback state, which DESIGN.md lists as `page-history` and TAKE-BACK 5.5 describes: after a text-presentation emoji is shaped once, a plain emoji measures as a missing-glyph box until the character-map loader finishes, about 3 seconds, "and a Canvas width taken in between stays wrong". Today such a width lives as long as one prepared paragraph. In a page-lifetime store it would answer every later message with that emoji. `tools/store-stale-answer-probe.ts` (mine) shows it inside one page in Firefox: U+1F600 under `16px Arial` measures 21 px at the start, 17 px right after U+1F600 U+FE0E is measured once (32 ms and 540 ms later, on a context kept from the start and on a new one alike), and 21 px again from 1,050 ms on. Chrome (20 px) and webkit-host (21 px) give one answer throughout. So in Firefox a store by string can go stale unless strings with emoji and lone surrogates stay out of it. Main's store has the same exposure today.
- **webkit-host: 6 keys.** 4 are a lone surrogate (16 px against 5.8 to 12 px, fallback again). 2 are `iM.` under a list that ends in a generic family, with the page language `en` against `ur`: WebKit's Canvas has no language of its own, so the page language belongs in the key, and a change of `<html lang>` invalidates. Main does this already.

#### 3.4 Is Chrome's canvas really the store?

Only for recent strings. `tools/store-canvas-bound-probe.ts` (mine; one exclusive stretch of 24 seconds at load 1.7 to 1.9) measures N distinct strings once on one canvas, then again in chunks of 5,000 from the newest back.

| Chrome, µs a call | first time | again: the newest three chunks | the chunks after them | the newest chunk once more after the pass |
|---|---|---|---|---|
| 20,000 words of 8 units | 1.32 | 0.32 to 0.46 (all four chunks) | | 0.30 |
| 100,000 | 1.14 | 0.26, 0.32, 0.32 | 0.50, 0.68, 0.74 ... 1.18 | 0.80 |
| 1,000,000 | 1.06 | 0.24, 0.26, 0.26 | 0.46, 0.62, 0.60 ... 1.34 | 0.58 |
| 1,000,000 strings of 24 units around U+2028 | 1.73 | 0.24, 0.24, 0.26 | 0.82, 1.20, 1.14 ... 1.92 | 1.10 |

- A canvas keeps about the newest 15,000 to 20,000 strings. Older ones cost a first ask again, and asking them pushes the newest out.
- With one context for the page and 86 to 100 new strings a message, that is the last 150 to 200 messages. Repeats inside a message, which are most of Blink's repeats (372 asks for 170 distinct), stay cheap. "The page's store" it is not.
- Good news for item 1: Chrome's own memory per canvas is bounded, so shared contexts don't grow Chrome without limit.
- For step (iv) it matters a little: the word facts of 10,000 messages are 11,000 to 40,000 strings (section 3.2), about the size of the bound. A rare word pays 0.8 µs again when it comes back. No need for a JavaScript store follows from that.
- Firefox answers a repeat in about 0.4 µs against 0.6 to 0.85 µs at any N (1 ms timer, so coarse). webkit-host shows no gain from a repeat at all (0.6 µs both), as the study says.

#### 3.5 Exactness of the short questions

**Across spaces, Chrome.** `tools/store-space-identity.ts` (earlier attacker; I added the split by script and reran it) tries `W(L s R) = W(L s) + W(s R) - W(s)` in 16.16 units wherever a recorded context holds all four strings: 423,244 positions in 35,918 cases over 641 font strings.

| without letter spacing | tried | off |
|---|---|---|
| a character with a script of its own on both sides (Latin-1 left to right 171,036; right to left 138,266; other left to right 70,409) | 379,714 | 0 |
| one side holds none (brackets, digits, punctuation, spaces) | 28,774 | 818, all in Amiri at 32 and 48 px, every example from `twins`, by up to 136 px |
| main's sum (words alone plus the space), Latin-1 on both sides | 62,545 | 2,172, by up to 2.4 zoomed px |

- The 818 are the mechanism BLINK-STRING-STORAGE.md describes: a two-byte string of brackets measured alone is shaped under another script than the same brackets inside their run (its probe has `)` x 15 at 183.60 px one-byte and 329.76 px two-byte in Amiri 48px). The port handles it today by measuring such a range as a one-byte string with U+0020 (`spacesStay`).
- So a word fact has to be measured under its run's script. For a word without a script of its own that means a one-byte string where the paragraph is 8-bit, and a neighbour in the question elsewhere, which repeats less. In the bench's messages 1.19% of words (ASCII) and 1.67% (mix) are such words, in 15.6% and 21.4% of the messages: `-`, `"`, `...`, emoji, `320,`, `7:00-9:00`.
- The study's guard ("measure the first few groups of a font both ways, once per page") would see Amiri's case only if those groups held such a word. A guard by sampling can't prove a font safe. What can: a rule by the word's characters (no script of its own: keep today's path), which needs no runtime check.
- With letter spacing the identity is off at 2,823 of 3,305 right-to-left positions and 8 of 11,451 left-to-right ones, in every example by a whole number of spacings. That is the correction the port already makes in JavaScript (`letterSpacingDifference16`), so facts would hold corrected values.
- One citation is thinner than it reads: the "8.0 million (font, word) pairs" census in main's RESEARCH.md ran in WebKit, and the study uses it for a Blink claim.

**Inside a word or a run without spaces, Firefox.** `tools/store-cluster-sums.ts` (earlier attacker) tries `au(S) - au(S less its first cluster) = au(cluster)` on the recorded answers: 1,732,511 positions in 63,516 cases over 827 font strings.

| script at the cut | clusters alone | with the pair's own adjustment |
|---|---|---|
| Han, kana or Hangul | 267,740 of 267,740, over 220 font strings (6,175 of 6,175 with letter spacing) | the same |
| Han, kana or Hangul before punctuation or digits | 20,245 of 20,270 (up to 17 au) | 6,125 of 6,128 |
| Latin, Greek or Cyrillic | 893,300 of 959,624 | 958,697 of 959,537; 715 of the 840 misses are in the 60 font rows the report lists and are 1 au (2 au in one probe font): Times New Roman 16px 544 of 26,862, Verdana, Helvetica Neue; the largest of the rest is 20 au |
| Indic or South-East Asian | 230,698 of 233,939 | 232,864 of 232,884; the 20 are in Myanmar MN, by up to 649 au |
| Arabic or Syriac | 16,311 of 27,915 | 15,965 of 18,197 |

- The CJK claim holds far beyond the one font list the study sampled.
- The small misses in Latin mean cluster-and-pair sums alone aren't the engine's number at up to 2% of offsets in a common font. The port's pair-placement recipe exists for exactly that. Gecko's ASCII questions are short already, so this step is for CJK.
- Thai, Khmer, Burmese and Indic text is one long unit too and has the same cost growth as CJK, and there the sums are not exact. The windows of PROFILING-START item 3 stay the candidate for those scripts.

#### 3.6 Is "fill asks nothing" affordable in the worst engine?

Not as the questions are today, which is what the study says. It is affordable after short questions, at a price the study doesn't name.
- Over 61 widths (160 to 760 px in steps of 10, 300 messages, earlier attacker) the union of the fills' distinct questions is 186 (ASCII) and 209 (mix) a message in Blink and 154 and 200 in Gecko; after 16, 32 and 61 widths it is 176, 183 and 186, so it does flatten. Not asked by prepare: 130 and 143 in Blink (mean 5.6 and 5.3 units), 151 and 197 in Gecko (3.0 and 24 units: the mix's are suffixes).
- One fill asks 42 to 49 distinct in Blink and 38 to 91 in Gecko. Asking the union ahead is about 90 more first asks a message in Blink, 0.6 to 0.8 s more per 10,000 messages from scratch at 0.75 µs each before any JavaScript. In Firefox about 0.3 s more for ASCII and 0.5 to 1 s more for the mix. Against a 2 s bar, with Chrome at 3.5 s after item 1, that is not affordable.
- After step (iv): the fill's questions are pair windows and prefixes inside the word at the line's end (about 120 of 157 a fill today). Word-with-space facts don't hold them, so "falls out" is too strong. They would be keyed by word and repeat across the page, so asked ahead they are mostly Canvas repeats in Chrome: about 130 asks at 0.13 to 0.3 µs, 0.2 to 0.4 s per 10,000 messages plus the JavaScript that derives them. That buys main's kind of resize (arithmetic) where the study's table has 0.85 to 1.2 s per 30,000 layouts. Whether that trade is wanted is the maintainer's call; it can't be sized without building.

#### 3.7 A smaller change the study didn't weigh, and the device pixel ratio

The study's own table says where Blink's long strings come from: the safe test of the 256 px cut search (`addPieces` > `passesSafeTest`) is 148 of 372 questions an ASCII message (100 wide windows of 22.5 units on average and 48 pair windows), 59% of all units asked, and 61 of the 84 strings new to the page. The study goes from there to step (iv), a second measuring path of 150 to 300 lines. The phase already lists a two-line deletion for the same class: PROFILING-START item 6, RECIPE-COSTS' B1b, "the cut's safe test itself: -12.1% of Chrome's calls, nothing lost". On the tier corpus it is 12%. On chat messages at a device pixel ratio of 2 it is much more, because the texts are longer and every message is cut.

I applied B1b's change in a scratch tree (never committed; `passesSafeTest` stops asking Canvas) and counted under the stand-in Canvas, first 2,000 messages:

| Blink, a message | as it is | the cut's safe test taken out |
|---|---|---|
| questions, ASCII / mix | 356.5 / 378.6 | 213.7 / 236.8 (-40% / -37%) |
| units asked | 3,702 / 3,591 | 1,549 / 1,541 (-58% / -57%) |
| strings new to the page | 101 / 103 | 41.8 / 45.2 |
| questions at a device pixel ratio of 1 / 2 / 3, ASCII | 239 / 357 / 466 | 175 / 214 / 243 |

- Tier 1 on the scratch tree (Chrome, no supplied facts): 38,310 cases the same, 24,659 ask other questions with the same prediction, 972 ask a question the record lacks, and 3,124 predictions change. Every one of the 3,124 differs first in a gap list (the paragraph's or a line's), none first in a line's start, end, width or geometry, and all 3,124 cases pass line count, breaks and widths with exact values in the ledger. That is RECIPE-COSTS-BROWSER's finding again at today's commit (its browser run of the same 972 cases moved no status and no exact value). Gap lists are part of what the library reports, so it is a change of recipe with a new recording and a new freeze, not a refactoring.
- **The device pixel ratio.** `store-real-text.ts --device-pixel-ratio` (mine): Blink measures at the zoomed size, so 256 zoomed px is about 45 characters of 16 px text at a ratio of 1, 22 at 2 and 15 at 3. Its questions a message go 239, 357, 466. Gecko (80.6 ASCII, 119 mix) and WebKit (31, 37) don't move. The bench and the study ran at 2. Most phones are at 3, where Chrome's from-scratch cost will be higher than any number in either report. Without the cut's safe test the growth is 175, 214, 243.
- **In real Chrome (mine).** The library probe, the tree as it is (a) and the scratch tree (b), alternating. Counts first, which don't depend on load: `measureText` calls a message 281.9 to 177.9 (ASCII, -37%) and 322.1 to 211.9 (mix, -34%); the line totals of the 1,000 messages at 320 px are the same in both trees (3,043 and 3,420).
- **Timed (mine), three sittings.**
  - The replay probe over both trees' Canvas calls (traces of the first 1,000 messages; the trace of the tree as it is equals the first agent's byte for byte): three alternating pairs in one exclusive stretch of 3.5 minutes at load 4.2 to 5.4. Canvas work a message, the median of each of the three runs:

    | µs a message | as it is (a) | the cut's safe test out (b) |
    |---|---|---|
    | ASCII, the message's own contexts (today) | 366, 325, 326 | 202, 196, 207 |
    | ASCII, shared contexts (item 1) | 277, 320, 298 | 142, 160, 149 |
    | mix, today | 372, 376, 375 | 227, 243, 230 |
    | mix, shared contexts | 350, 344, 348 | 174, 134, 188 |

  - The library probe, two alternating pairs in an exclusive stretch of 4.5 minutes at load 2.5 to 3.8. The library's own JavaScript (`plain`: every answer from memory, plain-object contexts), a message from scratch: 90.0 and 86.3 µs against 51.0 and 53.5 µs (ASCII, rounds within 84.6 to 93.3 and 50.6 to 54.7), and 109.5 and 106.2 against 67.8 and 70.6 µs (mix). 104 fewer questions take 36 µs of JavaScript with them, 0.35 µs a question. That is the study's expectation for step (iv) ("the cost follows the number of questions") measured for the first time. As it is (`real`): 444 and 512 µs against 415 and 363 µs (ASCII), 507 and 609 against 390 and 406 µs (mix). Chrome's `real` rounds spread too widely for two pairs to pin it (419 to 1,667 µs and 256 to 645 µs), as the study saw; the replay is the better instrument for the Canvas part. A kept paragraph at another width doesn't move (27.4 and 27.1 µs `plain`): the cut search is prepare's.
  - An earlier sitting of the same library probe ran loaded, because the machine didn't get quiet within the 40-minute wait (1-minute load 30 to 84): pair 1 at 32 to 36, pair 2 as the load fell. I stopped it after two pairs to keep the exclusive stretch at 11.5 minutes. It is a contrast only; its `plain` ratios are the same (0.55 to 0.58 ASCII, 0.62 mix) and (b) is below (a) in every pair.
- **Put together by the study's own method** (replay plus the `plain` floor; for item 1 alone that sum is 351 µs by my first replay sitting and 298 + 88 = 386 µs by this one, where the bench measured 349 µs):
  - B1b alone: 202 + 52 = 254 µs an ASCII message against 326 + 88 = 414 µs (the bench has 411 µs): about 2.5 s per 10,000 messages where today is 4.1 s. Mix: 230 + 69 = 299 against 375 + 108 = 483 µs: about 3.0 s where today is 4.8 s.
  - Item 1 and B1b: 149 + 52 = 201 µs against 386 µs, a ratio of 0.52; on the bench's 3.49 s that is 1.8 s, and 2.0 s unscaled. Mix: 174 + 69 = 243 against 456 µs, 0.53; on 3.82 s that is 2.0 s, and 2.4 s unscaled. **About 1.8 to 2.0 s (ASCII) and 2.0 to 2.4 s (mix) per 10,000 messages in Chrome: at the bar, from a two-line deletion on top of item 1.** It is a sum of two probes, not a bench run. What would settle it: the bench's rows A and E on a tree with item 1 and B1b, quiet, in alternating pairs.
- What it means for the order: B1b is not a rival of step (iv), which removes the cut search from ordinary text altogether. It is a first step that costs two lines, and it tests the study's largest unknown for (iv) directly: whether Blink's own JavaScript falls when its questions do.

#### 3.8 Do the expected times follow from the study's numbers?

Mostly.
- **(i) item 1.** Measured by its own branch, not by the study. The item 1 agent's second quiet bench run agrees with the first: row E 3.52 / 4.08 s (ASCII / mix) in Chrome against 3.49 / 3.82 s, 0.47 / 2.47 s in Firefox, 0.104 / 0.140 s in webkit-host. My replay has sharing worth 62 µs an ASCII message in Chrome in the first sitting (324 to 262) and 28 µs in the second (326 to 298; the `shared` variant's rounds spread from 233 to 932 µs). The bench has 62 µs (411 to 349).
- **(ii) plus a store.** Follows: the replay's 303 to 221 µs (first agent) and 262 to 214 µs (mine) less about 35 µs of hashing rebuilt strings. On text used once the store misses about 100 strings a message in place of 80, so expect the high end of the study's range (3.4 s ASCII). The study's call counts for this row are its stand-in counts scaled by about 0.78 to real Chrome's; it doesn't say so.
- **(iv) plus short questions, Chrome ASCII 0.4 to 1.0 s.** Follows. The library's `plain` floor is 89 µs a message, of which a fill is about 28 µs (the `plain` relayout row). The fill's position reads stay under (iv), so I would narrow the range to 0.55 to 0.95 s: 43 to 58 µs of JavaScript and 11 to 35 µs of Canvas (the replay's 10.9 µs plus the word facts new on real text).
- **(iv), Chrome mix 0.6 to 1.3 s.** The low end doesn't follow. CJK and URL messages are 12.2% of the mix's messages and 21% of Blink's questions (712 and 599 questions a message against 357 for plain Latin; stand-in, 3,000 messages, earlier attacker's scratch count), and the study leaves them on today's path. A fifth of item 1's 382 µs stays, about 80 µs, before anything else: 0.9 to 1.4 s.
- **(iv), Firefox mix 0.6 to 1.2 s.** Follows for the bench's mix, where the long units are Chinese. Real multilingual chat with Thai, Khmer, Burmese or Indic text keeps the suffix recipe (section 3.5).
- **Relayout.** Follows: 27.0 to 27.6 µs (ASCII) and 34.4 to 35.7 µs (mix) a layout with every answer from memory in my run, 0.81 to 1.07 s per 30,000 layouts.
- Every one of these is at a device pixel ratio of 2.

#### 3.9 The morning's webkit-host numbers

The study is right that they don't reproduce, and I can add one fact. The bench page times a fixed piece of arithmetic at the start and the end of a run. In the slow morning run it took 27.6 and 27.4 ms; in the quiet afternoon run 27.8 and 27.1 ms. So the page's JavaScript ran at full speed that morning, and the time really was inside `measureText`, for main too (1.53 s against 0.31 s). Something on the system side made text measuring, or a new context's first use of its font, about 50 times slower in that process. I did not find what. Two consequences: PROFILING-START's webkit-host rows and the reasoning built on them should be replaced by the quiet rows; and if that state can occur on a user's machine, the number of contexts and calls matters there again, which item 1 answers for the contexts.

#### 3.10 Against the engineering guide

- Step (iv) as the study draws it is a second measuring path beside the whole-group one, picked per font by a runtime guard, with the whole-group path kept for long words and guarded fonts. The guide asks for one source of truth, for a difference in behaviour to be modelled in one place, and for uniform cost over branches that hide cost. Two ways to get a group's width, chosen by a sampled check, is what it warns about. A rule by the text alone (a word with a script of its own and under 256 zoomed px takes the word path; everything else the group path) keeps one decision in one place and needs no guard. Section 3.5 is the evidence that the text is what decides.
- Facts on the prepared paragraph are a structure local to the paragraph, which the guide and the maintainer's caching rule allow. Step (ii) is the only cache in the guide's sense, and it fails two of the guide's three conditions as the questions are today: real reuse (21% for strings over 16 units) and bounded size (100 new strings a message). After (iv) it would pass both, and by then it buys little.
- B1b removes code and state. It is the one step here that the guide's "remove first" order favours outright.

### 4. What is not settled, and what would settle it

- **Blink's own JavaScript after short questions.** The study's largest unknown. The B1b before and after in section 3.7 is a first direct measurement (0.35 µs a question), on the cut search's questions only.
- **What item 1 and B1b give together in Chrome.** My 1.8 to 2.0 s (ASCII) and 2.0 to 2.4 s (mix) are sums of two probes. Settled by the bench on a tree with both, quiet.
- **Whether four facts a word can serve every read of Blink's line breaker** (safe-to-break flags, line-edge reshapes, HanKerning trims). Neither of us checked. Settled by a build that measures both ways on every tier case and counts disagreements, as the study proposes; section 3.5 says to split that count by whether a side has a script of its own.
- **Gecko's lazy-scan bound under cluster sums.** Not checked by either of us.
- **What evicts strings from Chrome's canvas** (least recently used, oldest first, or all at once). The probe shows a bound, not the rule. It matters only if someone wants to rely on the canvas beyond one message.
- **The morning's slow `measureText` in webkit-host.** Unknown.
- **The lifetime prototype** (shared contexts in Chrome in other orders, a late web font, zoom, many declarations) is the other track's. I touched it only where the store study leans on it: the canvas bound (section 3.4) and the partition in the key (section 3.3).

### 5. Files

- My commits on `x-perf-store-study`: 98dba3b (the space identity tallied apart where a side has no script of its own), ba77ba5 (`tools/store-word-facts.ts`), 52f1a88 (`store-real-text.ts --device-pixel-ratio`), 4f7e7de (`tools/store-canvas-bound-probe.ts`), 30955c4 (`tools/store-stale-answer-probe.ts`). The earlier attacker's: ebba5b3, 50981a5, 5fcc7fe, 6ae131e and three DESIGN.md lines.
- My results: `.artifacts/probes/perf-store-study-attack/second/` (`lib5`, `replay2`, `run4` with `run.log`; `bound1` with `bound.log`; `stale1`; `exact2`; `keys`; `identity`; `word-facts`; `by-ratio`; `b1b` with the scratch tree's counts, its tier 1 log, its timed library pairs (`timed2` quiet, `timed` loaded) and its replay pairs (`replay`); `gates-quick.log`, `gates-quick-final.log` and `gates-quick-30955c4.log`). The earlier attacker's: the same folder one level up (`keys`, `real-text`, `identity`, `offline`, `lib3`, `lib4`, `run3`, `gates-full.log`).
- The scratch tree with B1b was a detached worktree under `<scratch>`. It is removed; its patch is `b1b/b1b.patch` and its tier 1 report `b1b/tier1-check-report.json` in my results folder. Nothing of it is committed.


## What main's three accelerations would buy the rebuild (store study, 2026-09-19)

A study, no library change. Branch `x-perf-store-study` adds measuring tools only (`rebuild/tools/store-study.ts` and four probes). Nothing under `rebuild/src` moved. `bun rebuild/tests/gates.ts --quick` exits 0 on the branch (25 gates), and so does the citations gate run alone.

The maintainer's question: main has one store of measured widths for the page, a layout step that asks Canvas nothing, and short questions that repeat. What would each buy the rebuild, engine by engine, and does it fit the architecture?

### 1. Short answer

1. **Short questions are what main does right. The store is the smallest of the three.** Measured in the three browsers, a `measureText` call is cheap: 0.2 to 0.9 µs for a string of up to 8 units, in every browser, even the first time. A Map read of a string built again for the lookup costs 0.04 to 0.2 µs. In Chrome a repeated question on a kept canvas costs 0.10 to 0.16 µs, because Chrome's canvas keeps what it shaped: once contexts are shared (item 1), Chrome's canvas already is the store. What costs is (a) a new set of contexts per message in Chrome, (b) about 70 to 100 long strings per message in Chrome that never repeat, (c) the library's own JavaScript around every question.
2. **The library's own JavaScript is the floor, and it is near the bar in Chrome.** With every Canvas answer served from memory and the contexts replaced by plain objects, 10,000 messages from scratch still take 0.89 s (ASCII) and 1.14 s (mix) in Chrome, 0.29 s and 1.08 s in Firefox, 0.08 s and 0.12 s in webkit-host (quiet machine, medians of 5 alternating rounds). No store and no context sharing can go under that with the questions as they are. Only fewer questions can.
3. **webkit-host is not slow.** The 11.7 s and "28 µs a call" in PROFILING-START.md do not reproduce. Three measurements this afternoon agree: the item 1 branch's quiet bench has 10,000 mix messages from scratch in 0.248 s (main: 0.312 s), my replay of the same Canvas calls costs 12 to 20 µs a message, and my timing probe has 0.3 to 0.8 µs a call. The WebKit port is already what main is: word questions and a fill that asks nothing. It is the existence proof that an engine port of that shape runs 10,000 messages in 0.2 s with no store at all.
4. **Exactness does not need the long strings for ordinary text.** In Chrome, a run of words measured whole (spaces as U+2028, as the Blink port asks today) equals the sum of its words each measured with the spaces beside it, less each inner space once, bit for bit in 16.16 units, in 11,837 of 11,837 sampled runs over 10 fonts. Main's plain sum of words alone is exact in only 4 of those fonts and misses 784 runs in the other 6 (by up to 5 CSS px in Gill Sans). So main would not be much slower if it supported kerning across spaces: it would ask up to 4 questions a word where it asks 1, all of them short and repeating. Inside words, clusters alone plus neighbouring pairs equal the long `W(whole) - W(suffix)` recipe in 98.1 to 100% of offsets by font in Latin text in Chrome and Firefox (the misses are 1 or 2 units of rounding and the `fl` ligature), and clusters alone equal it at 13,353 of 13,353 offsets of Chinese text in Firefox, where the suffixes average 163 units. Arabic does not decompose this way (19 to 44%) and keeps its joiner recipe.
5. **Order I would take:** item 1 (already built and measured by its own branch: Chrome 4.1 s to 3.5 s ASCII), then short questions in Blink (expected 0.4 to 1.0 s, the step that gets Chrome under the bar), then cluster sums for Gecko's in-word advances (Firefox mix 2.6 s to about 0.6 to 1.2 s). A fill that asks nothing falls out of short questions for ordinary text. A page-lifetime store of widths comes last or never: it buys about 0 to 0.5 s of 3.5 s in Chrome, 0.1 s in Firefox ASCII and nothing in webkit-host, and it needs a bound.

### 2. What was measured, and how

Offline, no browser (`bun rebuild/tools/store-study.ts`, stand-in Canvas of `tools/stand-in-canvas.ts`, every question logged where it reaches Canvas, its purpose read from the call's stack):
- `--part=store`: 10,000 chat messages per set (the bench's `buildChat`: `mix` and `latin`, which is plain ASCII), prepared from scratch and filled at 320 px, per engine. A question is a context's assigned settings and a string.
- `--part=widths`: 1,000 messages at 16 widths (160 to 760 px), each from a fresh prepared paragraph.
- `--part=short`: main's own segments as words, and the two clusters around each boundary.
- `--part=tier`: the recorded tier cases without facts (51,489 Chrome, 48,575 Firefox, 48,791 webkit-host cases; held-out sets and twins left out) on the plain path, answered from the browsers' recorded answers. No case asked a question its record lacks.
- The stand-in is no font. Its counts are close to the browsers' for Gecko and WebKit (118 and 83 calls a message against the bench's 120 and 78 in Firefox; 40 and 32 against 41 and 30 in webkit-host) and 21 to 32% high for Blink (389 and 372 against 322 and 282), so Blink's shares are approximate. The chat sets are 10,000 slices of a few texts (the ASCII source is 279 KB and the set is 1.1 M units), so strings repeat across messages more than real chat would. That flatters every hit rate below, and long strings most.

In the pinned browsers, background windows, through `probes/runner.ts` (results under `.artifacts/probes/perf-store-study-timing/`):
- `store-timing-probe.ts` (run2, loads 2.5, 2.3, 2.2, 5 rounds that take every measurement in turn).
- `store-replay-probe.ts` (replay1, loads 2.5 to 3.7, 10 rounds, 5 variants in rotating order): the browser makes the Canvas calls of the first 1,000 messages from an offline trace. Only Canvas work and Map reads are timed.
- `store-library-probe.ts` (lib2, loads 5.7, 3.4, 3.0 after a 10-minute wait inside the lock, 5 rounds of 3 modes in rotating order; lib1 ran at load 20 to 29 and is kept only as a contrast): the bundled library itself over the first 1,000 messages.
- `store-exactness-probe.ts` (exact1): counts, so load does not matter.
- Firefox and webkit-host timers step by 1 ms, so every number is a loop of tens of milliseconds and small ones carry about ±0.1 µs.
- For whole-benchmark numbers I quote the item 1 branch's quiet run of `chat-night.sh` this afternoon (`.artifacts/bench/perf-lifetime-20260919/night-1`, loads 1.8 to 3.3). It is another agent's run, not mine. Its row A is the library as it is, its row E is one measurer for the set (item 1).

### 3. The numbers we start from have moved

| 10,000 chat messages, quiet machine, 15:11 | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| from scratch, mix (PROFILING-START said 9.59 / 2.63 / 11.7 s) | 4.79 s | 2.63 s | 0.248 s |
| from scratch, ASCII (4.16 / 0.61 / 8.83 s) | 4.11 s | 0.62 s | 0.193 s |
| main, cold prepare, mix (0.72 / 0.30 / 1.53 s) | 0.34 s | 0.30 s | 0.31 s |
| kept, 3 new widths, mix (4.04 / 0.70 / 0.21 s) | 2.95 s | 0.66 s | 0.100 s |
| item 1 (row E), from scratch, mix / ASCII | 3.82 / 3.49 s | 2.41 / 0.447 s | 0.140 / 0.100 s |

- The morning's webkit-host rows were about 50 times too slow for both libraries, and its "98% inside measureText at 28 µs a call" was the same state. I did not find the cause. Everything in PROFILING-START.md that rests on it (webkit-host "matters most", "each call costs three times main's") should be dropped.
- The rebuild is faster than main in webkit-host from scratch (×0.79 on the mix), and item 1 makes it ×0.45.

### 4. What one call costs (timing probe, µs a call, medians; 16px list of the bench, 32px in Chrome)

| string length, units | 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Chrome, first time on the canvas, spaces as U+2028 | 1.71 | 0.78 | 0.71 | 0.85 | 1.12 | 1.78 | 2.75 | 5.39 |
| Chrome, first time, spaces as U+0020 (Canvas cuts words) | 1.66 | 0.80 | 0.69 | 0.82 | 1.57 | 2.80 | 5.33 | 9.94 |
| Chrome, again on the same canvas (U+2028) | 0.16 | 0.17 | 0.14 | 0.11 | 0.16 | 0.14 | 0.13 | 0.14 |
| Chrome, met by another canvas of the same font, not this one | 0.60 | 0.59 | 0.60 | 0.68 | 1.05 | 1.58 | 2.68 | 5.15 |
| Firefox, first time | 0.25 | 0.17 | 0.25 | 0.33 | 0.42 | 0.50 | 2.00 | 2.50 |
| Firefox, again, or on another context | 0.17 | 0.25 | 0.08 | 0.17 | 0.42 | 0.67 | 0.83 | 2.33 |
| webkit-host, first time | 0.50 | 0.33 | 0.50 | 0.75 | 1.00 | 2.42 | 4.67 | 10.9 |
| webkit-host, again, or on another context | 0.42 | 0.33 | 0.42 | 0.58 | 1.25 | 2.00 | 4.75 | 10.7 |
| Map read, the key's own string object (store of 200,000) | 0.01 | 0.01 | 0.01 | 0.01 | 0.01 | 0.01 | 0.02 | 0.01 |
| Map read, a fresh slice of the text (Chrome; the others are alike) | 0.01 | 0.05 | 0.05 | 0.05 | 0.06 | 0.06 | 0.07 | 0.05 |
| Map read, a string joined unit by unit as the ports build theirs (Chrome) | 0.01 | 0.05 | 0.06 | 0.08 | 0.14 | 0.20 | 0.33 | 0.56 |
| the same in Firefox | 0.01 | 0.03 | 0.05 | 0.07 | 0.10 | 0.17 | 0.33 | 0.63 |
| the same in webkit-host | 0.03 | 0.06 | 0.10 | 0.17 | 0.32 | 0.63 | 1.08 | 2.25 |

(The 1-unit row mixes scripts, so Chrome's first-time cost there holds font fallback.)

- Chrome keeps shaped strings per canvas. A repeat on the same canvas is flat at about 0.14 µs whatever the length. The same string on another canvas pays again. That is the known rule (BLINK-STRING-STORAGE.md), now with a price.
- Firefox and WebKit show no per-canvas effect. WebKit shows no gain from a repeat at all: about 0.08 µs a unit, first time or not.
- Per character, long strings are cheaper than short ones the first time (Chrome: 0.10 µs a unit at 8 units, 0.04 at 128). Short questions win because they repeat and because there are few distinct ones, not because a short call is cheap per character.
- A store hit against a Canvas call: in Chrome with kept contexts it saves nothing on repeats (0.05 to 0.2 µs against 0.14 µs). In Firefox it saves 0.1 to 0.5 µs a call. In WebKit 0.3 to 0.5 µs a call for a word.
- A new context whose font string others have had: 3.0 µs to make and set in Chrome and about 3 µs in the other two. Its first call costs 2.7 µs more in Chrome. A new font size costs 30 to 45 µs in Chrome. The contexts the library makes for one ASCII message, made and set with no call: 53 µs in Chrome (10 contexts), 7 µs in Firefox (3), 7 µs in webkit-host (5). With 269 short calls on them Chrome takes 130 µs a message, against 31 µs for the same calls on kept contexts.

### 5. (a) What a page-lifetime store would answer (questions as they are today)

New to the page means a store found by settings and string misses. Per message, stand-in counts.

| | asks | distinct in the message | new to the page: first 100 / 101 to 1,000 / 1,001 to 10,000 / last 1,000 | hit rate, last 1,000 | stored after 10,000: strings, units |
|---|---:|---:|---|---:|---|
| Blink, mix | 389 | 175 | 119 / 106 / 84 / 71 | 82% | 860 k, 22.6 M |
| Blink, ASCII | 372 | 170 | 112 / 99 / 82 / 80 | 81% | 841 k, 24.1 M |
| Gecko, mix | 118 | 97 | 63 / 33 / 12.6 / 8.6 | 92% | 149 k, 16.7 M |
| Gecko, ASCII | 83 | 65 | 26 / 11 / 2.9 / 1.3 | 99% | 39 k, 0.25 M |
| WebKit, mix | 40 | 35 | 14 / 5.9 / 1.3 / 0.5 | 99% | 19 k, 0.12 M |
| WebKit, ASCII | 32 | 29 | 9.6 / 4.4 / 0.8 / 0.3 | 99% | 12 k, 0.09 M |

- Blink's 82% is mostly repeats inside one message (372 asks for 170 distinct). Across messages the store only answers the short questions: pairs and single clusters hit 99.9 to 100%, the windows and prefixes of the cut search 48%, and that 48% is this corpus repeating its own slices.
- As a bound on memory: Blink's store as the questions are grows by 86 strings and 2,300 units a message (about 45 MB of string data after 10,000 messages, before Map overhead). That fails "doesn't leak" unless long strings are kept out, and then it answers only what Chrome's canvas already answers. Gecko's mix grows by the Chinese suffixes (mean 223 units a miss). WebKit's and Gecko's ASCII stores stay under 0.3 M units.
- The short recipe's store (section 8) holds 24 k strings and 110 k units after 10,000 mix messages, 9.7 k and 66 k for ASCII.

### 6. (b) Questions by what they are (per message, stand-in, 10,000 messages)

Classed by call site: the functions a call was made under (`store-study.ts` `purposeOf`), then grouped. "New" is new to the page, average over the 10,000 and in the last 1,000.

**Blink** (`shape.ts`: every question goes through `measure16`; `contexts.ts` `raw16Of`). There is no "word alone" class: Blink never measures a word.

| class (purposes) | asks, share | units, share | mean units | at prepare / fill | new: avg, last 1,000 |
|---|---|---|---:|---|---|
| part of a run: windows of the cut search (`addPieces` > `passesSafeTest` > `windowAdjust16`), the wide window before a space and in safe tests (`adjust16`), a position's prefix from the last cut (`groupPrefix16`), line-edge reshapes | ASCII 183, 49%; mix 182, 47% | 2,980, 76%; 2,800, 74% | 16 | 118 / 65; 115 / 67 | 71, 68; 71, 60 |
| pair or boundary: the pair window's three strings, two clusters and each alone (`pairAdjust16`) | 157, 42%; 173, 44% | 209, 5%; 234, 6% | 1.3 | 65 / 92; 68 / 105 | 0.1, 0.01; 1.1, 0.15 |
| whole run: a group's or a piece's total (`addPieces`) | 20.7, 6%; 22.4, 6% | 635, 16%; 626, 17% | 31; 28 | all prepare | 13, 12; 14, 11 |
| font checks | 10, 3%; 10.6, 3% | 94; 99 | 9.4 | prepare | 0 |
| probe strings (word split, HanKerning) | 0.8; 1.1 | 2; 3 | 3 | prepare | 0 |

- The cut of a group over 256 zoomed px is the largest thing Blink asks: 169 of 372 asks an ASCII message and 75% of all units (wide windows 100, pair windows 48, totals 21). At a device pixel ratio of 2 and 16 px, 256 zoomed px is about 22 characters, so nearly every message is cut, and every candidate cut is tested with two windows. On the tier cases (real Chrome answers, shorter texts) it is 38 of 194 asks a case and 42% of units.
- Positions are the other half: 174 asks an ASCII message, 139 of them in the fill. On the tier cases positions and safe tests are 72% of all asks, nearly all of them in the fill, which is 69% of all asks there; pair windows alone are 49%.

**Gecko** (`prepare.ts`, `measure.ts` `rangeAu`, `advance.ts`).

| class | asks, share (ASCII; mix) | units, share | mean units | phase | new: avg, last 1,000 |
|---|---|---|---:|---|---|
| pair or boundary: the ligature test's pair in two contexts (`ligatureAcross`), the cluster before a candidate alone (`inWordAdvance`), pair placement | 39.6, 48%; 65.7, 56% | 68, 27%; 114, 6% | 1.7 | fill | 0.2, 0.01; 2.2, 0.09 |
| word: a shaping unit (`prepareGecko` > `rangeAu`) | 21.8, 26%; 20.0, 17% | 96, 39%; 99, 5% | 4.4; 5.0 | prepare | 0.9, 0.07; 1.4, 0.40 |
| part of a run: the suffix from a break candidate (`suffixAlone`), sides with a joiner | 13.9, 17%; 24.6, 21% | 48, 19%; 1,743, 87% | 3.5; 71 | fill | 1.5, 0.6; 9.6, 7.2 |
| recipe strings: a word and its sides at 2 px of letter spacing (`groupAcross`) | 6.4, 8%; 6.2, 5% | 35; 56 | 5.4; 9.0 | fill | 1.3, 0.6; 1.6, 0.8 |
| space alone; emoji recipe | 0.9; 1.6 | 1; 2 | 1 | prepare | 0 |

- In ASCII every class is short and repeats. In the mix 87% of the units are suffixes of text without spaces: a Chinese message is one unit and each candidate asks for the rest of it (item 3). On the tier cases suffixes are 19% of asks and 90% of units (mean 115 units).

**WebKit** (`measure.ts` `boxWidth`, `content.ts` `makeBox`, `items.ts`).

| class | asks, share (ASCII; mix) | units, share | mean | phase | new: avg, last 1,000 |
|---|---|---|---:|---|---|
| word: an item with its trailing space (`handleTextContent` > `boxWidth`) | 21.7, 68%; 26.7, 67% | 116, 87%; 114, 82% | 5.3; 4.3 | prepare | 1.2, 0.26; 1.9, 0.52 |
| font checks | 9.0, 28%; 9.6, 24% | 17; 18 | 1.9 | prepare | 0 |
| probe strings: coverage per code point of a fixed-pitch box | 0; 2.3 | 0; 2 | 1 | prepare | 0 |
| space or hyphen alone | 1.0; 1.5 | 1; 2 | 1 | prepare | 0 |
| part of a run: `breakWord` prefixes | 0; 0.1 | 0; 4 | 43 | fill | 0 |

### 7. (c) Prepare or fill, why the fill asks, and what asking ahead would cost

| per message (1,000 messages, 16 widths from 160 to 760 px, fresh paragraph per width) | Blink ASCII / mix | Gecko ASCII / mix | WebKit ASCII / mix |
|---|---|---|---|
| prepare asks | 196 / 206 | 21 / 20 | 30 / 40 |
| one fill asks, of them distinct | 129 / 153, 44 / 50 | 52 / 94, 41 / 78 | 0 / 0.09 |
| union of the fills' distinct questions over the 16 widths | 160 / 177 | 143 / 179 | 0 / 1.07 |
| of the union, not asked by prepare (mean units) | 108 / 120 (5.6 / 5.3) | 140 / 177 (3.0 / 13.6) | 0 / 1.06 (34) |
| union after 1, 2, 4, 8, 16 widths (mix) | 55, 107, 144, 166, 177 | 82, 125, 158, 173, 179 | 0.1, 0.3, 0.6, 1.0, 1.1 |
| kept paragraph, per layout at a new width / at a width met before (bench, real browsers) | 137 / 137 | 28 / 0 | 0.1 / 0.1 |

Why the fill asks, by engine:
- **Blink.** The engine has every character's position after shaping. The port gets a position from Canvas when a fill reads it: the break search's binary search over offsets (`offsetForPosition`), the safe-to-break tests around the candidate, the line-edge reshapes and the view's part edges. Each costs a prefix and a pair window, or a wide window before a space. What the fill needs that prepare could not know is which offsets the width selects. Nothing is kept, so the same offsets are asked again at every width (item 2).
- **Gecko.** `overflow-wrap: break-word` makes every cluster of each line's first word a break candidate, and the port reads the advance before each (`breakAndMeasureText`). The engine reads them from its glyph records for nothing. Which word starts a line depends on the width. What was found stays on the unit, so a width met before asks nothing.
- **WebKit.** Only `breakWord` prefixes when a word is wider than the line, and the hyphen.

Asking it all at prepare, as the questions are today, makes from scratch dearer: Blink would ask 108 to 120 more distinct questions a message than one fill's 44 to 50, and still more as widths are added (the union has not flattened at 16 widths). Gecko would ask 140 to 177 where one fill asks 41 to 78. So "fill asks nothing" is bought either by tables by offset on the prepared paragraph, filled on first read (item 2b; Gecko has this shape), or by short questions (section 8), where the union is mostly answered already.

Even then the fill's own code remains. With every answer served from memory, a layout at another width costs 28 µs (ASCII) and 39 µs (mix) in Chrome against 58 and 72 µs as it is, 11 to 14 µs in Firefox against 18 to 20, and 1.7 to 2.7 µs in webkit-host either way (lib2). For 10,000 kept messages at 3 widths that is 0.85 to 1.2 s in Chrome, 0.33 to 0.42 s in Firefox and 0.05 to 0.08 s in webkit-host, against main's 0.008 to 0.014 s. Part of Chrome's 28 µs is my stub (a string concatenation and a Map read for each of about 113 questions), so tables by offset would do better. How much, I can't tell without building.

### 8. (d) Can the long strings come from short ones, exactly?

Exactness probe (`store-exactness-probe.ts`, exact1): real chat text, each engine's own unit (Blink round(W x 65536) at the zoomed size, Gecko round(W x 60), WebKit float32), 10 fonts: the bench's list ("Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif), Times New Roman, Arial, Georgia, Verdana, system-ui, Avenir Next, Gill Sans, Didot, Menlo.

**Across spaces.** Runs of 2 to 6 words, under 256 zoomed px in Chrome.

| | runs | words alone plus spaces alone (main's sum) exact | each word with the spaces beside it, less each inner space once, exact |
|---|---:|---:|---:|
| Chrome (spaces as U+2028) | 11,837 | 11,053; all in 4 fonts (the bench's list, Georgia, Verdana, Menlo); 23 to 200 runs off in each of the other 6, by up to 10.4 zoomed px | 11,837 |
| Firefox | 22,824 | 22,824 | 22,824 |
| webkit-host | 22,824 | off by up to 6.4 px in Times New Roman (5 runs), Arial (9) and Gill Sans (545): the kerning with the space, which main already measures there | exact in the 7 fonts whose float32 sums are exact; in the other 3 both sums differ from the whole in the last bits (under 0.0001 px) |

- Blink shapes a shaping group whole, one HarfBuzz call per script segment and font (the port's citations: inline_node.cc:1636-1717, harfbuzz_shaper.cc:880-1101), so a letter and the space beside it can kern. Canvas cuts words at U+0020 unless the font's kerning or ligature lookups hold the space glyph (plain_text_node.cc:84-155, font_fallback_list.cc:264-286), which is why the port writes U+2028. What crosses the boundary is between a word and its neighbouring space, and a word measured with its space holds it. Main's own research says the same from the other side: over 8.0 million (font, word) pairs the last cluster alone gave another kerning with the space in 389, the last two clusters never, and "nothing bounds how far a font's contextual lookups reach" (main RESEARCH.md, "Kerning At Line Edges"). The rebuild's Nastaliq case (probe blink-round3 R1, a word-final letter that widens before a space after some letters) is inside the word with its space too.
- What this does not cover: a lookup that reads from one word across the space into the next. No sampled font does it. Canvas can't rule it out without the whole group. A guard is cheap: measure the first few groups of a font both ways, once per page, and keep today's path for a font that differs.
- Gecko shapes word by word itself ("U+0020 is a shaping word boundary that nothing kerns across", gfxFont.cpp:3781-3866, the port's `rangeAu` comment; the shaped-word cache, gfxFont.cpp:3569-3577). Its unit is already a word.
- WebKit lays a line out as the sum of its items' widths and measures an item with its trailing space (TextUtil.cpp:62-104). The port asks exactly that. It has no long class.

**Inside a word, or a run without spaces.** The advance before every cluster as `W(whole) - W(suffix)`, against clusters alone plus what each neighbouring pair measures beyond its two clusters (`W(ab) - W(a) - W(b)`).

| | offsets | clusters alone exact | with pairs exact |
|---|---:|---:|---:|
| Chrome, Latin, 10 fonts | 77,564 | 63% to 100% by font | 77,548; 12 off by 1/65536 px in the bench's list, 4 in Gill Sans at the `fl` of "chiefly" |
| Firefox, Latin, 10 fonts | 77,840 | 63% to 100% | 77,589; off in Verdana (97, by 1 au), Didot (150, by up to 2 au), Gill Sans (4, the ligature) |
| Firefox, Chinese, the bench's list | 13,353 (suffixes of 163 units on average) | 13,353 | 13,353 |
| Chrome, Chinese | 61 (few runs are under 256 px) | 61 | 61 |
| Arabic, all three | 3,767 | 8 to 10% | 19 to 44% |

- Firefox's Chinese result is item 3's answer in another form: Gecko shapes CJK runs without kerning (gfxHarfBuzzShaper.cpp:1405-1438, the port's `scriptContextFor` comment), so the advance before a cluster is the sum of the clusters before it. One short question per distinct character replaces one question per offset over the rest of the run. About 2.2 million units of suffix questions in this sample become a few thousand single characters.
- The 1 and 2 au misses in Verdana and Didot are the rounding of a pair adjustment's two halves, which the port's pair-placement recipe already handles. Ligatures need the port's ligature test, which asks pairs already.
- Arabic joins, so neither sum holds. Its recipe with U+200D on the cut side stays. Its strings are parts of words (3 units on average here), so they repeat.

Cost in questions of the short recipe, with a store for the page (`--part=short` and a count of words with their spaces, 10,000 messages):

| per message | lookups | new to the page: first 100 / to 1,000 / to 10,000 |
|---|---:|---|
| main's segments, plus the boundary pair and its two clusters (mix) | 173 | 23 / 9.8 / 1.5 |
| the same, ASCII | 153 | 10 / 4.0 / 0.6 |
| Blink's fact: a word with the spaces beside it, as it stands in the text (ASCII) | 20 | 9.9 / 4.7 / 1.1 |
| the same with every line-edge variant of every word (alone, space before, after, both): an upper bound | 20 to 80 | 35 / 15 / 2.2 |

### 9. The same Canvas calls, five ways (replay1, µs a message, Canvas work and Map reads only)

Medians and ranges of 10 rounds. Each round has a font size of its own and the variants rotate, so every variant goes first twice, where it meets fonts no context has had: the high ends are those rounds.

| | Canvas calls | Chrome ASCII | Chrome mix | Firefox ASCII | Firefox mix | webkit-host ASCII | webkit-host mix |
|---|---|---:|---:|---:|---:|---:|---:|
| today: the message's contexts, then its calls | 336 / 372, 77 / 119, 30 / 40 | 312 (311 to 390) | 378 (362 to 469) | 28 (27 to 45) | 163 (158 to 221) | 15.5 (12 to 16) | 20.5 (13 to 44) |
| the contexts alone, made and set | 0 | 73 (60 to 156) | 82 (72 to 183) | 8 (7 to 9) | 9.5 (8 to 10) | 7 (7 to 8) | 8 (7 to 8) |
| shared contexts, font checks once | 326 / 361, 77 / 119, 21 / 30 | 303 (253 to 323) | 329 (288 to 380) | 18.5 (17 to 24) | 152 (150 to 158) | 4 (3 to 8) | 7.5 (6 to 23) |
| plus a store of today's questions | 100 / 108, 12.6 / 36, 4.9 / 6.8 | 221 (208 to 374) | 245 (235 to 330) | 7 (6 to 12) | 135 (131 to 147) | 2 (1 to 6) | 4 (2 to 19) |
| short questions with the store | 4.7 / 11 | 10.8 (9.8 to 13.9) | 18.8 (17 to 27) | 5 (4 to 7) | 9 (8 to 10) | 8.5 (8 to 10) | 15.5 (14 to 26) |

- In Chrome the store takes 303 to 221: the 226 repeats a message were already cheap, and the 100 long first-time strings (about 2 µs each) stay. A real store would also hash strings built again for each lookup, about 35 µs a message by section 4, which the replay leaves out. Net: about 50 µs of 350, and as little as nothing.
- In Firefox's mix the Chinese suffixes stay (135 µs). Short questions remove them (9 µs).
- In webkit-host the short recipe is slower than the store of today's questions, because WebKit's questions are already words and the recipe looks up 5 times as many facts.

### 10. The library with Canvas answered from memory (lib2, quiet, µs a message from scratch; medians and ranges of 5 rounds)

`real`: as it is. `remembered`: real contexts, every `measureText` answered from a Map filled in a pass before (one string concatenation and one Map read per question). `plain`: the contexts are plain objects too.

| | Chrome ASCII | Chrome mix | Firefox ASCII | Firefox mix | webkit-host ASCII | webkit-host mix |
|---|---:|---:|---:|---:|---:|---:|
| real | 482 (426 to 764) | 529 (469 to 1,866) | 54 (52 to 61) | 265 (265 to 271) | 17 (17 to 19) | 23 (22 to 28) |
| remembered | 341 (206 to 420) | 283 (259 to 540) | 40 (37 to 47) | 127 (118 to 137) | 16 (16 to 19) | 21 (20 to 23) |
| plain | 89 (88 to 90) | 114 (113 to 118) | 29 (28 to 36) | 108 (107 to 110) | 8 (8 to 9) | 12 (12 to 13) |
| kept, another width, per layout: real / remembered / plain | 58 / 28.5 / 28.2 | 72 / 39 / 37 | 18 / 11 / 12 | 20 / 14 / 13 | 1.7 / 1.7 / 1.7 | 2.7 / 2.7 / 2.3 |

- `plain` is what no store and no context sharing can beat with the code as it is: 0.89 and 1.14 s per 10,000 messages in Chrome, 0.29 and 1.08 s in Firefox, 0.08 and 0.12 s in webkit-host. The bench's instrumented pass put "outside Canvas" at 30% of Chrome's ASCII time, about 120 µs of 411; measured directly it is 89.
- The Blink port spends about 90 µs an ASCII message outside Canvas for about 280 questions, where the WebKit port spends 8 µs for 30. Both do the same kind of work around a question (build the string, convert the answer), so the cost follows the number of questions. That is the ground for expecting Blink's own JavaScript to fall with short questions, and it is an expectation, not a measurement.
- In webkit-host `remembered` is as slow as `real`: a Map read of a rebuilt word costs what WebKit's `measureText` of it costs. A store buys WebKit nothing. Its contexts are half of what is left (16 to 8).
- Chrome's `real` and `remembered` spread widely between rounds (canvases being collected). `plain` does not.

### 11. What main's store and Canvas-free layout rest on (one page)

How main does it (`src/measurement.ts`, `src/layout.ts`, `src/line-break.ts`):
- One measuring context for the page (`getMeasureContext`). `prepare` assigns its font string. It is replaced only when `<html lang>` changes.
- One store: `Map<font string, Map<segment text, metrics>>` (`segmentMetricCaches`), a second one for WebKit's "item with its following space", and an emoji correction per font. Lifetime: the page. Invalidation: `clearCache()` by the application, `setLocale`, a language change. Nothing on a font load. Bound: none, it grows with the vocabulary.
- The key is the font string and the text. Direction, language, kerning and letter spacing are not in it (letter-spaced measurements go around the store).
- Questions are segments: words, spaces, punctuation glue, CJK graphemes. A breakable segment gets per-grapheme fit advances at prepare, by sums, by prefixes (WebKit, up to 96 graphemes) or by pair context.
- `layout()` is arithmetic: a line's width is the sum of its segments' widths, held against `maxWidth + lineFitEpsilon` (0.005 px, 1/64 px in WebKit). No Canvas, no strings.

Which of these the rebuild's exactness breaks:
1. *A line's width is the sum of its words.* False in Blink wherever a font kerns a letter with a space: 784 of 11,837 sampled runs in 6 of 10 fonts, by up to 5 CSS px. True in Gecko by the engine's own design. In WebKit the engine sums items, and main already measures an item with its space there.
2. *A tolerance stands in for the engine's arithmetic.* The rebuild computes in the engine's units (LayoutUnits from 16.16 sums, float32, app units). That is arithmetic and costs no question.
3. *One font per text, no inline boxes, no bidi levels.* The rebuild's paragraphs have them. It is structure, not measuring cost, but it is part of the JavaScript floor.
4. *The key is font and text.* The rebuild's measurements also depend on language, direction, letter spacing, the no-ligature contexts and, in Chrome, the string's storage. They are context settings, so a store sits per context. In Chrome a Map lookup of the measured string itself turns a two-byte Latin-1 string into a one-byte one, so the key must be another string or the store must keep to strings whose storage their characters decide. The key I would propose: per context of item 1's object, a Map from the measured string to its width, and for the one kind of string whose storage is forced (`shape.ts` `canvasString`, a Latin-1-only slice of 13 units or more) the parent string the port already builds, which is two-byte by its first character. No key is built by concatenation.
5. *Nothing invalidates on a font load.* Item 1's object has the same contract. It is a contract, not a defect.

How the rebuild can keep the shape anyway: word facts plus boundary facts, both repeating.
- **Blink.** Per word of a shaping group up to four facts: the word alone, with the space before, with the space after, with both (spaces as U+2028). A group's total is the sum of its words with their spaces less the inner spaces. The position of a break at a space is a prefix sum. What a line edge needs (the reshape of `[start, first safe)`, the kerned end of the last word) is a difference of two facts of the same word. Words over 256 zoomed px (URLs), text without spaces and fonts that fail the guard keep today's path. The 256 px cut search, 45% of Blink's questions, runs only for those.
- **Gecko.** Already words. In-word advances from clusters and pairs for non-joining scripts, clusters alone in CJK runs. Arabic keeps its joiner recipe.
- **WebKit.** Already there.
- Where the facts live: on the prepared paragraph. With item 1's shared contexts a repeat costs 0.14 µs in Chrome and 0.2 to 0.6 µs in the other two, so no page-lifetime store of widths is needed for the shape to pay.

### 12. Conclusion: expected calls and times per step

Canvas calls per message, and seconds per 10,000 messages from scratch. "Today" and step (i) are the quiet bench's measured rows A and E. The others are my estimates: the measured floor (`plain`, section 10) plus the Canvas-side cost of what is still asked (replay, section 9).

| | Chrome ASCII | Chrome mix | Firefox ASCII | Firefox mix | webkit-host ASCII | webkit-host mix |
|---|---|---|---|---|---|---|
| today: calls; s | 282; 4.1 | 322; 4.8 | 78; 0.62 | 120; 2.6 | 30; 0.19 | 40; 0.25 |
| (i) item 1 alone (measured by its branch) | 272; 3.5 | 311; 3.8 | 78; 0.45 | 120; 2.4 | 21; 0.10 | 30; 0.14 |
| (ii) plus a page-lifetime store, questions as today | about 62 (81 in the first 1,000); 3.0 to 3.4 | about 69 (90 in the first 1,000); 3.3 to 3.7 | 1.3 to 3.9; 0.30 to 0.35 | 9 to 15 (36 in the first 1,000); 1.4 to 2.4 | 0.3 to 1.2; 0.09 to 0.10 | 0.5 to 1.9; 0.13 to 0.14 |
| (iii) plus fill asking nothing | the same from scratch, or more calls if asked ahead (+108) | the same (+120) | the same (+140) | the same (+177) | the same | the same |
| (iv) plus short repeating questions | 1.5 to 3.7 (5 to 15 in the first 1,000); 0.4 to 1.0 | 2 to 6 plus URLs and CJK; 0.6 to 1.3 | about 1; 0.25 to 0.31 | about 2.4; 0.6 to 1.2 | unchanged | unchanged |
| floor with today's code (`plain`) | 0.89 | 1.14 | 0.29 | 1.08 | 0.08 | 0.12 |

Relayout of 10,000 kept messages at 3 widths (seconds):

| | Chrome | Firefox | webkit-host |
|---|---|---|---|
| today (bench, ASCII / mix) | 2.4 / 2.95 | 0.60 / 0.66 | 0.07 / 0.10 |
| (i) | 2.6 / 2.9 (no gain: the fill still asks 113 to 137 a layout) | 0.59 / 0.88 | 0.075 / 0.094 |
| (ii) or (iii): every answer from memory, today's fill code (lib2) | 0.85 / 1.2 | 0.33 / 0.42 | 0.05 / 0.08 |
| (iii) as tables by offset, or (iv) with an arithmetic fill | can't tell without building; Firefox's 6 µs a layout at a width met before (0.17 s) and WebKit's 2 to 3 µs are what engine fills cost when they build no string | | |
| main | 0.008 | 0.014 | 0.014 |

Uncertainty, and what would falsify each:
- (i) is measured, not mine. My replay agrees in direction (Chrome ASCII 312 to 303 µs of Canvas work as a median, 253 at best; the replay's strings are all met before by the font, so it understates what kept canvases save). Risk is the one PROFILING-START names: Chrome canvases with a page's history, which needs tier 2 in several orders.
- (ii) ±0.3 s in Chrome. It is wrong if hashing a rebuilt string costs much less than section 4 says or if real chat repeats long strings, which it won't. For Firefox's mix the low end needs the corpus's repeated Chinese slices, so expect the high end on real text. Falsifier: the library probe's `remembered` mode with shared contexts, which needs item 1's branch.
- (iv) rests on two things. Exactness: tier 2 with a build that measures every group both ways and counts disagreements over the 67,065 Chrome cases; I expect none outside fonts whose lookups read across a space, and one disagreement in a font the guard passes falsifies the design. Time: the range's low end assumes Blink's own JavaScript falls with its questions (section 10). If the fill's JavaScript dominates instead, Chrome stays near 1.0 s and the mix near 1.3 s. Both ends are under the bar.
- The stand-in's Blink counts are 21 to 32% high, and the chat corpus repeats itself. Both push (ii) to look better than it is and leave (iv) about right (words do repeat in real chat).

What each step costs:

| step | lines | state, lifetime | invalidated by | bound |
|---|---|---|---|---|
| (i) contexts and font-check answers per page | its branch knows; PROFILING-START says four sites and an object | one object the caller makes, the page's | the caller, when fonts load or change | distinct settings; letter spacing needs a cap |
| (ii) store of widths per context | about 20 in `measure/canvas.ts`, plus a key rule for Chrome's storage | on (i)'s contexts, the page's | with (i)'s object | none by itself: needs a cap on entries or on string length. With a cap at about 16 units it keeps only what Chrome's canvas already keeps |
| (iii) tables by offset (item 2b) | 40 to 80 in Blink's `shape.ts` | the prepared paragraph's | never | the paragraph's length |
| (iv) Blink word facts | a second measuring path beside the whole-group one, which stays for long words and guarded fonts: my guess is 150 to 300 lines, and the fill's position reads turn into sums. I can't tell without building | the prepared paragraph's (or none: re-asked through (i)'s contexts) | never | the paragraph's words |
| (iv) Gecko cluster sums | replaces the suffix recipe for non-joining scripts: about -20 +40 | the unit's record, as today | never | the unit's length |
| the guard for (iv) | about 15, a font check like `canvasSplitsWords` | per font per page, on (i)'s object | with (i)'s object | fonts on the page |

Order: (i) first, it is built and it is the precondition for repeats being cheap in Chrome. Then (iv) in Blink, the only step that moves Chrome under the bar, and it removes the 256 px cut search from ordinary text. Then (iv) in Gecko for CJK, which is item 3 done with sums. Then look at relayout again: (iv) should have made ordinary fills arithmetic, and item 2b's tables cover what is left. (ii) last, and only if Firefox's 0.1 s matters. WebKit needs nothing after (i).

Compatible with the architecture? (i) is the one new lifetime and it is already allowed (fixed data with a page's lifetime). (iv) adds no state that outlives a paragraph and no store found by string. It changes recipes, so it asks new questions: new recordings and tier 2, as PROFILING-START says for any such change. (ii) is the only one that is a cache in the engineering guide's sense, and the numbers don't ask for it.

### 13. Where I can't tell without building

- Blink's JavaScript after (iv): the 0.4 to 1.0 s range.
- Whether Blink's line-edge rules (safe-to-break, reshapes, `NeedsAccurateEndPosition`, HanKerning trims) can all be read from four facts a word. I checked totals and in-word positions, not the line breaker's every read.
- Gecko: whether the break scan can take cluster sums everywhere the lazy scan takes suffixes today (the lazy scan's bound argument would change).
- A font whose lookups cross a space. None sampled. The guard is a design, not code.
- Why webkit-host was 50 times slower this morning.

### 14. Files

- Tools (committed on `x-perf-store-study`): `rebuild/tools/store-study.ts`, `store-timing-probe.ts`, `store-replay-probe.ts`, `store-exactness-probe.ts`, `store-library-probe.ts` with `store-library-probe-entry.ts`. Each file's header has its command.
- Results: `.artifacts/probes/perf-store-study-timing/` (`run2` timing, `replay1`, `exact1`, `lib2` quiet and `lib1` loaded library runs, `offline/` the offline reports and the summary scripts, `STORE-STUDY.txt` this report as text).
- Quoted, not mine: `.artifacts/bench/perf-lifetime-20260919/night-1/summary.md`.

