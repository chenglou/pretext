# Which exactness requirements the redo could drop for speed, and what each costs and buys (2026-09-23)

On 2026-09-23 the maintainer relaxed the correctness-first guideline: ad hoc devices go first, requirements that real
text never exercises can go, and CJK stays well supported. This audit puts a number on every exactness mechanism of the
three ports: what it costs in Canvas questions on chat messages and real paragraphs, and which cases lose their lines
when it is switched off, split into real text and adversarial cases. It changes no library code: the switches live in a
scratch copy (`tools/audit/knockouts.patch`). Gecko's word scan, which is being landed separately, is left out.

## The short answer

- **On real text almost nothing moves.** With every mechanism on, the plain path gets all 2,485 chat messages, 4,686
  real paragraphs, 86,336 width-sweep cases and 72 whole books right in all three browsers. Of 40 knockouts and
  combinations, four single mechanisms move real lines: Blink's HanKerning (CJK brackets and quotes), Blink's
  safe-to-break test in the line breaker (45 sweep cases), Blink's wide window before a space (one Urdu Nastaliq
  paragraph) and Gecko's emoji recipe. Everything else, alone, moved no real line.
- **Chrome: the cut search is the cost.** It is 54% of Chrome's calls and 84% of its characters on chat. The first
  offset it tries passes in 99.5% of searches; its wide window, which sends 49% of a chat message's characters, never
  failed a test on real text. Dropping the wide window (keeping it for groups with a soft hyphen) takes a chat message
  from 182 to 139 calls and 1,987 to 1,042 characters and moves no real line; it loses 8 of 2,159 cut attack cases, and
  at the widths the fonts probe aims beside a cut, lines in Zapfino, Diwan Thuluth and Arabic at 28px through the system
  fallback. Cutting at every space and between CJK letters (words first) takes it to 413 characters and a book from 2.29
  million to 0.20 million, again with no real line moved, but at the probe's widths it moves lines the browser doesn't
  in Euphemia UCAS, Zapfino, Diwan Thuluth and, the one body font, Songti SC on accented Latin. That trade is the
  maintainer's.
- **Firefox: the in-word tests are the cost.** 57% of a chat message's calls and 83% of a real paragraph's are about
  offsets inside a word. The ligature test by ink box (G2) is a third of the calls and moves no real line (13 of 63,516
  adversarial cases). A new CJK recipe (a unit made only of CJK characters, as the sum of its clusters, guarded by the
  unit's own total) halves a CJK paragraph's calls and characters and moved no line in 157,023 real, sweep and
  adversarial cases. Both: chat 120 → 76 calls, a real paragraph 305 → 160.
- **Safari: the font checks at every prepare are the cost.** The fixed-pitch and primary-family checks are 9.4 of 37
  calls a chat message (25%). The primary-family check and one box probe can go with nothing lost anywhere; the
  fixed-pitch check costs 4 adversarial cases (a CR in Menlo) and is better asked once a page.
- **CJK** costs the most per character in Chrome and Firefox: a 121-unit CJK paragraph takes 579 and 399 calls, a
  231-unit English one 334 and 157. The two CJK recipes above keep every CJK line measured and cut CJK's characters by
  75% in Chrome and 54% in Firefox.
- **Bundle:** one bundle per engine takes a Chrome page from 1,915K to 769K characters (gzip 430K to 155K) with no
  behaviour change; after that, the ICU line tables are near copies of each other, and a page uses one of them.

## 1. How the numbers were made

**Inputs.** All laid out at DPR 2 in the pinned Chrome 153.0.8010.50, Firefox 156.0 and webkit-host 22625.1.29.11.27
(Safari 27's engine), with no supplied font facts, through the plain path an application runs (`prepare` without
inspection, then `fillLineRange` line by line), with a fresh set of Canvas contexts per paragraph:

- **Chat**: 2,485 messages of the bench's three chat sets (`bench/cases.ts` `buildChat`: 1,000 of the mix, 500 of the
  ASCII set, 1,000 of the set read from real texts), inline code as a 14px Menlo span with 6px padding, at 320px; 112
  UTF-16 units a message on average.
- **Real paragraphs**: the census's 781 paragraphs cut from main's 18 corpora (`research/CALIBRATION.md` §7), each at
  240, 320, 400, 480, 600 and 720px: 4,686 cases, 231 units a paragraph.
- **Width sweep**: the same 781 paragraphs at every 10px from 150 to 800px and the chat messages at every 20px from 180
  to 440px: 86,336 cases, so line ends meet more of the places where a knockout's arithmetic differs.
- **Books**: the book survey's 72 cases (`tests/BOOK_SURVEY.md`): the 18 maintained texts, raw and normalized, each as
  one paragraph at the narrowest and widest canary widths; 3.3 million units and about 78,900 lines a browser.
- **Adversarial**: every tier set a browser runs (`tests/sets.ts`, all but `features-en-US`), one case file a browser:
  68,367 Chrome cases, 63,516 Firefox, 63,729 webkit-host. 52% are under 80px wide, 21% hold a control or format
  character, 20% a soft hyphen, 12% letter spacing, 14% a fixture web font, and 13% are the 120 near-copy
  control-character families.
- **Fonts**: for Blink's cut rules, `tools/cut-fonts-probe.ts` over the machine's 318 font families (§4.1).

**Right lines.** A case's lines are right when its line count equals the browser's and every visible character lands on
the browser's line (the lab scorer's line count and visible-breaks diagnostic). Widths and gap names are not scored. The
browser's layout comes from native observations: fresh ones for chat, the tier sets and the fonts cases, the census's
rows for the real paragraphs (their native views equal a fresh observation on all 781 × 3 cases checked), the book
survey's own rows for the books, and a fresh observation of every sweep case a knockout changed. With every mechanism
on, the plain path gets every chat message, real paragraph, sweep case and book right in all three browsers; on the tier
corpus it gets 1,205 of 68,367 Chrome cases wrong, 1,017 of 63,516 Firefox and 984 of 63,729 webkit-host.

**Cost.** Every `measureText` call and the characters it sends, counted on the page's Canvas prototypes
(`tools/audit/count-predictor.ts`), and the contexts made. Where a call comes from was read offline: every answer the
browsers gave on chat and on the real paragraphs at 400px was recorded, replayed in bun, and each call's stack put under
the mechanism that asked it (`replay-sites.ts`, `mechanisms.ts`). Chrome's Canvas cost for text no canvas has shaped
follows the characters sent, and on warm canvases the calls (`experiments/amdahl/README.md`), so both are given. No
browser timing was taken: the runs were the lab's background runs (headed browser windows that don't take focus, not
headless), several beside other jobs on the machine. Own code was timed in bun with the recorded answers handed back,
where a knockout asks only recorded questions (`own-time.ts`).

**Knockouts.** A switch turns one mechanism off in the scratch copy; the predictors are `tools/audit/ko/*.ts`. Each ran
predict-only in the browser over every set, and its lines were compared with the baseline's and with the browser's.
"Lost" is a case the baseline gets right and the knockout gets wrong; "gained" the reverse; "moved" wrong both ways with
other lines. The tier sets were also replayed offline from the recorded tier runs of 2026-09-20 (`tier-replay.ts`): for
Firefox the offline and browser counts agree exactly (39 lost of 40 changed for G1b and for G4); in Chrome a knockout
that asks fewer questions can move lines in the browser that the replay doesn't, since Chrome's answers depend on what a
canvas shaped before, so the browser runs are the ones quoted.

## 2. The top candidates to drop or relax

Ranked by saving against the real-text cases lost. None below loses a chat message, a real paragraph, a sweep case or a
book line, so the order is by saving, the browser furthest behind main first (Chrome about 5.5× main on new text,
Firefox 2.2 to 2.7×, Safari already faster). Savings are Canvas calls and characters a chat message, then a real
paragraph (averaged over its six widths); "adversarial" is what it loses on the tier corpus.

| # | Candidate | Kind | Chat message | Real paragraph | Real cases lost | Adversarial lost (gained) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Blink: the cut search's wide window, kept only in a group with a soft hyphen (B-cut-pair-only-shy) | the port's device | calls −24%, chars −48%; own code −19% | calls −32%, chars −52%; a book −61% chars | 0 | 8 (1), all in the cut attack set; at the fonts probe's widths 357 of 17,181 (§4.1) | **relax** |
| 2 | Blink: cut at every space and between CJK letters, words first, with the pair window at each cut (C-blink-rec2: V3 with CJK cuts and the pair window only) | the port's device | calls −8%, chars −79% | calls −23%, chars −77%; a book −91% chars | 0 | 11 (2), all in the cut attack set; at the probe's widths 1,946 of 86,577, Songti SC among them | **maintainer** |
| 3 | Gecko: the ligature test by ink box (G2) | recipe | calls −33%, chars −19% | calls −39%, chars −19% | 0 | 13, ligature words broken inside at 13 to 99px | **drop** |
| 4 | Gecko: CJK units as sums of their clusters (G-cjk-sum; a cheaper recipe, not a drop) | recipe with a sum guard | calls −12%, chars −16% | calls −25%, chars −21%; a CJK paragraph −54% both | 0 | 0 | **adopt** (maintainer: a new premise) |
| 5 | Gecko: the crossing measure and pair placement only for a word broken inside itself (G1b, G4) | heuristics | calls −24%, chars −10%; own code −12% | calls −19%, chars −12% | 0 | 39, all Latin words broken inside | **relax** (the word scan gives it) |
| 6 | WebKit: the fixed-pitch check once a page, not at every prepare (S3) | heuristic font check | calls −19%, chars −10% (the bound: never asked) | calls −5% | 0 | 4 (a CR in Menlo) | **relax** |
| 7 | Gecko: ligature groups by letter spacing only for a word broken inside itself (G3) | recipe | calls −6%, chars −12% | calls −8%, chars −14% | 0 | 21, all under 80px | **relax** |
| 8 | The primary-family check at every prepare (S1), Chrome and WebKit | font check | Chrome calls −2%, WebKit −8% | −1%, −4% | 0 | 0 in both | **relax**: the first family, or once a page |
| 9 | Gecko: contexts shared across paragraphs, a page pool | the port's rule for a Firefox start-up case | not measured here; the Amdahl floor is 1.9–2.4× main now, 1.1–1.8× with sharing | | none seen | not in the corpus | **maintainer** |
| 10 | WebKit's listed-family probe (W1a) and Blink's float32 run sum | recipe; ported rule | under 1% each | 0.8%, 3% | 0 | 0 (both) | **drop** |

Not candidates, though they looked free at six widths or in one set: Blink's position adjustment (B3: 30% of Chrome's
calls, but the kerning of every body font runs through it: off, it moves lines the browser keeps in PT Sans, Seravek,
Gill Sans and Avenir Next at the probe's widths, 225 adversarial cases, and one Urdu sweep case); Blink's wide window
before a space (B3w: the Urdu case); Blink's safe-to-break test in the line breaker (B4: 45 sweep cases, 35 of them
chat); Blink's HanKerning (71 sweep cases); Gecko's emoji recipe (93 sweep cases); Gecko's script context (G9: 59
adversarial cases, Korean with times among them); Blink's joining check (S5: 1,085 adversarial cases for 0.1% of calls).

**Each engine's candidates together:**

| Engine | Set | Chat message | Real paragraph | Books | Adversarial lost (gained) |
|---|---|---|---|---|---|
| Blink | 1 (B-cut-pair-only-shy) | 182 → 139 calls, 1,987 → 1,042 chars | 500 → 339 calls, 4,945 → 2,374 chars | 0 lines moved; 2,290,753 → 884,676 chars a book | 8 (1) |
| Blink | 2 (C-blink-rec2) | 182 → 168 calls, 1,987 → 413 chars | 500 → 387 calls, 4,945 → 1,115 chars | 0 lines moved; 2,290,753 → 202,598 chars a book | 11 (2) |
| Gecko | 3 and 4 (C-gecko-rec) | 120 → 76 calls, 426 → 300 chars | 305 → 160 calls, 1,491 → 1,005 chars | 0 lines moved; 39,326 → 24,527 calls a book | 13 (0) |
| WebKit | 8 and W1a (C-webkit-rec) | 37 → 34 calls | 89 → 85 calls | 0 lines moved | 0 (0) |

No times are quoted: in the background runs the pair-window-only rule and its soft-hyphen variant, which send the same
questions on chat, took 0.32 and 0.53 ms a chat message.

## 3. Every mechanism, one row each

Columns: what it is and its kind (a ported engine rule, a recipe that makes Canvas answer as the DOM, a registered
heuristic, a font check or fact, OS data); its cost as Canvas calls and characters a chat message, then a real paragraph
at 400px; what switching it off does to a chat message; the cases that need it, on real text and on adversarial cases
only; CJK; the verdict. "0 lost" on real text means no chat message, real paragraph, sweep case or book line changed.
Adversarial figures are my tier runs (lines only); "RCB" marks `research/RECIPE-COSTS-BROWSER.md` (2026-09-18, the
correctness line, which also scores widths).

### 3.1 Blink (Chrome): 182 calls and 1,987 characters a chat message; 502 and 4,954 a real paragraph

| Mechanism (kind) | Cost: chat msg; real paragraph | Switched off, a chat message | Real text needs it | Only adversarial cases need it | CJK | Verdict |
|---|---|---|---|---|---|---|
| **Cut search: group and piece totals** (the 256 zoomed px limit is ported and principled; the halving search is the registered heuristic `shape/wide-group-halved`) | 17.9 calls, 558 chars; 68, 1,432 | not separable: the pieces anchor every position | yes | | a Han or kana run has no space, so it is cut inside | keep the limit; the cut rule is §4 |
| **Cut search: safe test, wide window** (the port's device: the widest window under 256 zoomed px around a candidate, shrunk and measured again until it is under the limit, then its two sides) | 46.3 calls, 973 chars; 170, 2,625 | B-cut-pair-only: 139 calls, 1,041 chars; own code −19% | 0 lost, the sweep and books included; it never failed a test on real text | 10 lost, 3 gained of 68,367, all in the `wide-group-cuts` attack set; at the fonts probe's widths, soft hyphens inside ligature words and the calligraphic Zapfino and Diwan Thuluth (§4.1) | same | **relax**: only in a group with a soft hyphen (§4.1) |
| **Cut search: safe test, pair window** (the port's device: the two clusters around a candidate together and apart) | 27.2 calls, 36 chars; 77, 128 | with the wide window, B-cut-nosafe (the cut's adjustment still measured): 136 calls, 1,133 chars | 0 lost alone; fails 5% of tests in Japanese | 128 lost, 6 gained (all `wide-group-cuts`) | kana kerning in Hiragino Mincho | keep: cheap, and one of the two guards Japanese needs |
| **Cut search: adjustment at each cut** (B3 at a cut the search didn't show to be 0) | 7.4 calls, 105 chars; 18, 213 | | 0 lost | | | keep; words-first cuts measure it at each space (§4) |
| **Position inside a group: the prefix from the last cut** (B2, the port's recipe) | 17.4 calls, 102 chars; 37, 167 | no fallback that only drops questions | yes | | | keep; shorter pieces make shorter prefixes |
| **Position adjustment, pair window** (B3, heuristic `position-adjust-window`) | 43.5 calls, 59 chars; 94, 166 | B-no-B3: 128 calls, 1,761 chars | 0 lost at six widths; 1 sweep case (Urdu Nastaliq); with the cut's safe test off, 6 chat and 36 real lost (Japanese, Burmese), with the line breaker's safe-to-break test off 2 (Japanese) | 225 lost (99 in `wide-group-cuts`), 127 gained, 30 moved; at the fonts probe's widths, kerning body fonts (PT Sans, Seravek, Gill Sans, Avenir Next); RCB 421 lost, 96 gained | Japanese | **keep** for now (maintainer): 30% of Chrome's calls, but the kerning of every body font runs through it |
| **Position adjustment, wide window before a space** (B3w, the same heuristic) | 8.2 calls, 69 chars; 11, 83 | B-B3-pair-only: 175 calls, 1,824 chars | 0 at six widths; 1 sweep case lost (Urdu Nastaliq, the case it was made for) | 1 lost, 1 gained; RCB 1 (the Urdu Nastaliq corpus) | | keep (4% of calls for real Urdu) |
| **Safe-to-break test in the line breaker** (B4, the port's recipe) and **line-edge reshapes** (B5, ported) | 8.2 calls, 77 chars; 20, 131 | B-no-B4: 174 calls, 1,910 chars | 0 at six widths, but **45 sweep cases lost** (35 chat); see B3 | 268 lost (132 in `wide-group-cuts`, 64 in `rule/text-align`); RCB 1,256 | Japanese | keep |
| **Float32 sum of a line's runs** (ported: ShapeResultView's width) | 5.4 calls, 31 chars; 22, 52 | B-no-floatsum: 181 calls | 0 lost | 0 of 68,602 (offline) | | **drop**: it moved nothing anywhere; 1% of a chat message's calls, 3% of a real paragraph's |
| **HanKerning font data and trims** (B11, recipe: `halt` from 「 and 「「, character types from ink boxes) | 1.1 calls, 1 char; 1.3, 2 (3.0 a CJK paragraph) | B-no-B11: 181 calls | **5 chat, 3 real and 71 sweep cases lost** (brackets and quotes in Chinese and Japanese) | 135 lost | yes | keep |
| **Word-split probe** (B12, recipe: does Canvas shape word by word, 2 strings a style) | 0.7 calls, 2 chars; 0.1, 0 | B-no-B12: 182 calls | 0 lost | 45 lost, all in `twins` (runs of 13 or more brackets in Amiri) | | keep: it is cheap and the `twins` loss is real behaviour of those strings |
| **Font check: primary family** (S1, `F, monospace` against `F, serif` on a space) | 4.1 calls, 4 chars; 4.0, 4 | S-no-S1 (the first listed family is taken): 178 calls | 0 lost | 0 of 68,367 | | relax: once a page, or the first family (**maintainer**) |
| **Font check: joining technology** (S5: beh and U+07FA) | 0.25 calls; 1.1 | B-no-S5: 182 calls | 0 lost | 1,085 lost, mostly `rule/joining` and the near-copy control families; RCB 2,225 | Arabic | keep |
| **Font check: hyphen glyph** (S2) and **the hyphen string** (B14) | under 0.01 calls | | 0 lost | RCB 16 (Geeza Pro) | | keep |
| **Contexts: four a style made up front** (ltr, rtl, and two without ligatures), plus the checks' own | 8.7 contexts a chat message | | | | | make the two no-ligature contexts when first asked; a page pool is a lifetime choice |
| **Measuring-string recipes** (U+2028 for spaces, U+2060 for ignorables, U+0001 for VT and FF, U+200D at joined cuts, the zoomed size, an explicit `lang`, `optimizeLegibility`, one-byte and two-byte canvases, word and letter spacing in JS, a question per script segment) | own code: building the questions is most of Blink's own time (`research/PERF-JS-PROFILE.md`) | | yes: they make Canvas shape as the DOM | | | keep |
| **Dictionary breaks** (Thai, Lao, Khmer and Myanmar from `Intl.v8BreakIterator`; OS data) | a segmentation a run, no Canvas | | yes | | | keep |
| **Named gaps** (20) and inspection | nothing on the plain path | | | | | keep in the lab (§7.8) |

### 3.2 Gecko (Firefox): 120 calls and 426 characters a chat message; 305 and 1,488 a real paragraph

Most of Firefox's calls are about offsets inside a word. The word scan being landed now skips those inside a line's
first word where the word fits; after it, these rows cost far less on Latin chat, and about the same on text with no
spaces (CJK, Thai, Khmer, Burmese), where every line breaks inside a unit.

| Mechanism (kind) | Cost: chat msg; real paragraph | Switched off, a chat message | Real text needs it | Only adversarial cases need it | CJK | Verdict |
|---|---|---|---|---|---|---|
| **Unit, space, tab and hyphen widths** (G0, ported) | 19.4 calls, 93 chars; 38, 198 | | yes | | | keep |
| **In-word suffix** (G1a, recipe `in-word-advance-unit-minus-suffix`, heuristic `suffix-side-recipe`) | 18.7 calls, 101 chars; 56, 473 | no fallback that only drops questions | yes, where a line breaks inside a unit | | 79 calls, 493 chars a CJK paragraph | keep; §5 has a cheaper CJK form |
| **In-word crossing cluster and prefix** (G1b, heuristic `sides-add-up-is-exact`) | 17.6 calls, 19 chars; 49, 72 | G-no-G1b: 91 calls, 383 chars; own code −12% | 0 lost | 39 lost, all G4's (off with it) | 69 calls a CJK paragraph | keep only where G4 needs it |
| **Ligature test by ink box** (G2, recipe: a pair at no letter spacing and at 0.001px) | 39.1 calls, 79 chars; 117, 272 | G-no-G2: 80 calls, 347 chars | 0 lost | 13 lost of 63,516, all ligature words broken inside: `ffiffi…` in Hoefler Text at 20 to 99px, `officially` and `ffifflffi` in Amiri and Shantell Sans at 13 to 38px; RCB 28 | 159 calls a CJK paragraph, for ligatures CJK text doesn't form | **drop** |
| **Ligature groups by letter spacing** (G3, recipe: a unit at 2px and at 0.001px) | 7.6 calls, 51 chars; 25, 202 | G-no-G3: 112 calls, 375 chars | 0 lost | 21 lost, all under 80px (Arabic lam-alef words broken inside); RCB 50 | 36 calls, 203 chars a CJK paragraph | relax: only in a word broken inside |
| **Pair placement by rounding** (G4, recipe, with 16 probe pairs, heuristic `probe-pairs-per-context`) | 8.4 calls, 13 chars; 0.1, 0 | G-no-G4: 111 calls, 414 chars | 0 lost | 39 lost: Latin words broken inside (soft-hyphen words at 68 to 95px, the maintained `Superlongword…` at 150px) | | keep, asked only for a word broken inside (the word scan does that) |
| **Script context** (G9, recipe `range-in-script-context`) | 4.5 calls, 12 chars; 6.5, 17 | G-no-G9: 117 calls, 416 chars | 0 lost | 59 lost, 6 moved, 56 of them under 80px; also `다음 배포는 7:00-9:00 사이예요.` at 136px | 11 calls a CJK paragraph | keep |
| **Windows in long units** (the port's device against quadratic cost) | 2.9 calls, 57 chars; 12, 253 | | | | 383 chars a CJK paragraph | keep |
| **Emoji at the device size** (G7) and **synthesized spaces** (G8) | 1.4 calls; 1.1 | G-no-G7: 119 calls | **8 chat, 3 real and 93 sweep cases lost** (emoji) | 932 lost; RCB 3,941 (G7), 18 (G8) | | keep |
| **Contexts, one prepared paragraph's** (Gecko makes its contexts per call, `research/CONTEXTS-HEAL.md`) | 3.8 contexts a chat message | | a Firefox in its first second with a family named by a localized or legacy name | | | **maintainer**: it rules out a page pool, which would move the Amdahl floor from 1.9–2.4× main to 1.1–1.8× |
| **SA segmentation** (`Intl.Segmenter`), ICU4X line data, likely subtags (OS and Unicode data) | no Canvas | | yes | | | keep |
| **Named gaps** (18) | nothing on the plain path | | | | | as Blink |

The in-word tests together (C-gecko-lean: G1b, G2, G3, G4 and G9 off): 120 → 43 calls and 426 → 249 characters a chat
message, 305 → 102 and 1,491 → 824 a real paragraph; 0 real cases or book lines moved (39,326 → 16,357 calls a book);
131 of 63,516 adversarial cases lost, 105 of them under 80px. The recommended pair (C-gecko-rec: G2 off and the CJK sum
of §5): 120 → 76 calls and 426 → 300 characters a chat message, 305 → 160 and 1,491 → 1,005 a real paragraph; 0 real
cases or book lines moved; 13 adversarial cases lost (G2's).

### 3.3 WebKit (Safari): 37 calls and 136 characters a chat message; 89 and 259 a real paragraph

| Mechanism (kind) | Cost: chat msg; real paragraph | Switched off, a chat message | Real text needs it | Only adversarial cases need it | CJK | Verdict |
|---|---|---|---|---|---|---|
| **Word, space and range widths** (W0, ported `TextUtil::width`) | 24.7 calls, 111 chars; 76, 231 | | yes | | about a call a character | keep |
| **Font check: fixed pitch** (S3, heuristic `font-check-fixed-pitch`: `i`, `M`, `.` and a space) | 5.3 calls, 14 chars; 4.5, 12 | W-no-S3: 30 calls, 122 chars | 0 lost, the chat's Menlo code spans included | 4 lost of 63,729 (a CR in Menlo); RCB 21 | | relax: once a page (**maintainer**) |
| **Font check: primary family** (S1) | 4.1 calls, 4 chars; 4.0, 4 | S-no-S1: 34 calls | 0 lost | 0 lost | | **drop** (the first listed family), or once a page |
| **Box probe: a listed family resolves** (W1a, recipe) | about 1 call | W-no-W1a: 37 calls | 0 lost | 0 lost | | **drop** |
| **Box probe: primary-font coverage in fixed-pitch boxes** (W1b, recipe) | 1.8 calls | W-no-W1b: 36 calls | 0 lost | 5 lost (Menlo with U+3000 or `…`); RCB 24 | | keep |
| **Mid-word break probes** (W7, ported `breakWord`) | 0.1 calls, 5 chars; 0 | | yes (long words) | | | keep |
| **Merged glyphs under letter spacing** (W2), **VT, FF and CR** (W3), **RTL shaping across inline boxes** (W6, heuristic `shaped-run-in-joining-context`) | 0 on real text | | none (real text has no letter spacing, controls or split RTL runs) | RCB 43, 111, 214 | | keep: free on real text |
| **Core Text family table** (OS data) and **language-dependent fallback table** (heuristic; gaps only) | the bundle only | | | | | keep |
| **Page-history worlds** (W5; gaps only) | nothing on the plain path | | | | | §7.4 |

Together (C-webkit-lean: S3, S1, W1a and W1b off): 37 → 26 calls and 136 → 118 characters a chat message; 0 real cases
or book lines moved; 4 adversarial cases lost. The recommended pair (C-webkit-rec: S1 and W1a off): 37 → 34 calls; 0
lost anywhere.

### 3.4 Shared

| Mechanism (kind) | Cost | Verdict |
|---|---|---|
| **Canvas checks** (`env.ts` `detectEngine`: 2 calls and 2 contexts a page) | once a page | keep |
| **Engine from the user agent** (heuristic `engine-from-user-agent`) | none | keep |
| **Context per settings, `lang` before `font`, the font string** (recipes) | a context a distinct setting | keep |
| **Painter rules** (9 recipes, 2 heuristics, 1 choice by score) | none on layout: the DOM paints | not a layout cost |

## 4. Blink's cut search

**What it does.** Chrome's Canvas returns a float32 width, which holds every 16.16 position exactly only below 256
zoomed px (128 CSS px at DPR 2). The port cuts every shaping group that wide or wider into pieces below the limit and
adds the pieces' exact totals as integers (`engines/blink/shape.ts` `addPieces`, `measureGroups`). The limit is
principled; the search is the port's own device: measure the whole group; take the offset beside a space nearest the
middle; test it with the pair window (the clusters on both sides, together and apart: 3 strings) and then the wide
window (the widest window around the offset under the limit, found by shrinking a window from its longer side and
measuring it again until it is under the limit, then its two sides); cut there and recurse into both halves.

**What it costs.** On chat, 99 of 182 calls and 1,672 of 1,987 characters a message (54% and 84%); on real paragraphs,
334 of 502 calls and 4,398 of 4,954 characters (66% and 89%). The windows shrunk only to learn whether they are still
256 zoomed px wide carry 788 to 889 characters of a chat message (40 to 45% of all) and 2,329 of a real paragraph (47%).

**Can its questions be predicted?** Its outcome can (`tools/audit/cut-stats.ts`, recorded answers):

| Input | Paragraphs | Searches a paragraph | First offset tried passes | Cut beside a space / elsewhere | Pair window failed | Wide window failed | Shrinks a window | Characters in shrunk windows a paragraph |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| chat/latin | 497 | 7.9 | 100.0% | 3928 / 3 | 1 | 0 | 2.75 | 788 |
| chat/mix | 997 | 9.3 | 99.8% | 7172 / 2110 | 14 | 0 | 2.80 | 837 |
| chat/real | 991 | 9.3 | 99.9% | 8143 / 1113 | 6 | 0 | 2.77 | 889 |
| real/en | 60 | 17.6 | 100.0% | 1049 / 5 | 0 | 0 | 2.98 | 2096 |
| real/ar | 120 | 15.3 | 100.0% | 1832 / 0 | 0 | 0 | 2.92 | 1655 |
| real/ur | 31 | 35.6 | 100.0% | 1103 / 0 | 0 | 0 | 3.11 | 4596 |
| real/he | 60 | 22.5 | 100.0% | 1351 / 0 | 0 | 0 | 2.95 | 2532 |
| real/hi | 60 | 22.8 | 100.0% | 1365 / 2 | 0 | 0 | 3.14 | 2773 |
| real/zh | 115 | 23.9 | 100.0% | 0 / 2752 | 0 | 0 | 2.87 | 994 |
| real/ja | 42 | 42.4 | 95.3% | 4 / 1776 | 98 | 0 | 2.97 | 2086 |
| real/ko | 120 | 13.3 | 100.0% | 1596 / 6 | 0 | 0 | 2.81 | 739 |
| real/th | 120 | 33.0 | 100.0% | 1797 / 2162 | 0 | 0 | 2.86 | 3024 |
| real/km | 36 | 66.2 | 100.0% | 1341 / 1042 | 0 | 0 | 2.93 | 9065 |
| real/my | 12 | 40.6 | 95.1% | 386 / 101 | 0 | 0 | 3.06 | 3895 |

A search is one call of `addPieces` on a group or piece of 256 zoomed px or more. In Myanmar the offsets that fail first
fail the rules that ask nothing (a cluster boundary, no joining across it), not a Canvas test.

- The first offset tried passes in 99.5% of real-paragraph searches and 99.8 to 100% of chat ones, 95% in Japanese and
  Myanmar. The pair window fails where Hiragino Mincho kerns kana (98 of 1,878 Japanese tests, 5%), in 14 CJK chat
  messages and in one ASCII one, and nowhere else. The wide window, which sends most of the characters, never fails on
  any real text measured.
- So the questions confirm, almost always, what the text alone predicts: the offset beside a space nearest the middle is
  safe. What cannot be known without asking is each piece's total and whether a pair kerns across the cut. A search that
  asks only those is the pair-only rule below.

**The options, and what each moves.** Each ran predict-only in Chrome against the browser's own lines; "sweep" counts
lines changed of 86,336 and then scored. Adversarial is the tier corpus, 68,367 cases, whose cut attack set
(`wide-group-cuts`, 2,159 cases of lines that end within half a px of the fit at a cut) is where the cut rules lose.

| Option | Chat message: calls, chars | Real paragraph: calls, chars | A book: chars | Real lines moved (chat, real, sweep, books) | Adversarial lost (gained) | Fonts probe: layouts differing from today's |
|---|---|---|---|---|---|---|
| Today: halving, pair and wide window | 182, 1,987 | 500, 4,945 | 2,290,753 | | | |
| Pair window only (B-cut-pair-only) | 139, 1,041 | 339, 2,372 | 884,391 | 0, 0, 0, 0 | 10 (3) | 25,378 of 646,563, 176 families |
| Pair window only, the wide window kept in a group with a soft hyphen (B-cut-pair-only-shy) | 139, 1,042 | 339, 2,374 | 884,676 | 0, 0, 0, 0 | 8 (1) | 1,320 of 644,335, 11 families |
| No safe test; the cut's adjustment still measured (B-cut-nosafe) | 136, 1,133 | 328, 2,470 | not run | 0, 0, 0, – | 128 (6) | 42,644 of 644,459 (the count of the rejected first form, `research/PERF-B1B-REWORK.md`) |
| Words first, V3: a piece per word with its trailing space, the pair window at each space, today's search inside a word still 256 zoomed px wide (B-cut-words) | 169, 514 | 452, 1,774 | 242,241 | 0, 0, 0, 0 | 4 (2) | 23,854 of 822,687 |
| V3 without the pair window at spaces (B-cut-words-nopair) | 125, 455 | 386, 1,668 | 215,094 | 0, 0, 0, 0 | 272 (46) | 47,135 |
| V3 without the pair window, and a wide word measured whole, main's rule past 256 px (B-cut-words-whole) | 138, 959 | 712, 2,999 | 281,930 | 0, 0, 0, 0 | 272 (53) | 48,620 |
| V3 and a cut between every two CJK letters (B-cut-cjk) | 169, 425 | 407, 1,379 | 221,163 | 0, 0, 0, 0 | 4 (2) | 23,871 |
| V3, CJK cuts and the pair window only (C-blink-rec2) | 168, 413 | 387, 1,115 | 202,598 | 0, 0, 0, 0 | 11 (2) | 24,042 of 827,850, 178 families |
| V3 with the position adjustment B3 off (C-blink-words-noB3) | 73, 357 | 280, 1,419 | 158,187 | 0, 0, 1 (Urdu), 0 | 417 (127) | 57,996 |

"Real paragraph" is the average over the six widths; "a book" the average over the 72 book cases. The adversarial losses
of the rules that keep a pair window are all in the cut attack set; the two rules without it at spaces also lose
`rule/text-align` (96), `rule/controls` (48) and kerning beside spaces, and B3 off loses more. The fonts probe compares
two trees, widths included; §4.1 says which side the browser takes.

**Reading.**
- *Pair window only* is the smallest change: the questions are a subset of today's, no real line moved anywhere, own
  code falls 19% with them, and it loses 10 and gains 3 of the 2,159 attack cases (ligature words in 40px Helvetica,
  marks in Helvetica Neue, soft hyphens in Zapfino, Diwan Thuluth Arabic). Offline replay of the same questions moved
  none of those 13: the browser's difference is Chrome's shape cache, which remembers what a canvas shaped before. At
  the fonts probe's widths it loses soft-hyphen words; keeping the wide window only in a group that holds a soft hyphen
  (a test on the text) cuts that to what §4.1 lists.
- *Words first (V3)* measures each word once with its trailing space, plus the pair window at the space. It sends a
  quarter of today's characters on chat and a tenth on books, and moves no real line; it loses 4 and gains 2 attack
  cases. A word still 256 zoomed px wide (a URL, a Han or kana run) keeps the halving search. At the probe's widths it
  parts from the browser in a few fonts (§4.1).
- *Without the pair window at spaces* (main's rule at a space) it saves more calls but loses 272 adversarial cases and,
  at the probe's widths, lines in ordinary body fonts (PT Sans, Seravek, Gill Sans): fonts do kern across spaces.
- *Measuring a wide word whole* (main's behaviour past 256 px, accepting the float32 total) moves no real line, but a
  CJK run is one word, so every position inside it becomes a long prefix: a real CJK paragraph goes from 2,279 to 5,986
  characters. On real paragraphs it costs more than V3 (712 against 452 calls), and it loses what the pair window at
  spaces buys.
- *Cutting CJK letters too* (each Han, kana or Hangul letter a piece, the pair window at each cut) takes a real CJK
  paragraph from 2,279 to 566 characters and moves no real line; at the probe's widths it loses what V3 loses, and its
  losses on the probe's CJK text are V3's, all in Euphemia UCAS.
- *No safe test at all* loses 128 attack cases, and with B3 also off, 6 chat messages and 36 real paragraphs (Japanese,
  Burmese); it is the rejected first form of `research/PERF-B1B-REWORK.md` (the probe's 42,644 differing layouts match).

### 4.1 Across every installed font family

The lab's cases hold a few dozen font strings, so the lab README asks a change to Blink's cuts to pass
`tools/cut-fonts-probe.ts`: the base and the changed tree lay 15 texts out at two sizes in every family that resolves
(318), at ordinary widths and at widths that put a line end beside a cut, one LayoutUnit to either side included. The
probe compares the two trees, widths included. For every option, the 40 families with the most differing layouts were
then made into lab cases at those widths (`tools/cut-fonts-cases.ts`), observed natively, and scored against the
browser's lines (`tools/audit/fonts-cases.sh`). These are targeted widths, the hardest place for a cut rule, in display
and fallback fonts as well as body fonts; today's library gets 3 to 4% of them wrong.

| Option | Targeted cases | Lost | Gained | Where it loses |
|---|---:|---:|---:|---|
| Pair window only | 62,961 | 1,701 | 8 | soft-hyphen words in families without Latin letters, drawn by the system font (1,471); Zapfino 178, Diwan Thuluth 52 |
| Pair window only, the wide window kept with a soft hyphen | 17,181 | 357 | 2 | Zapfino 178, Diwan Thuluth 52, Arabic at 28px through the system fallback behind 8 Latin families (14 each), one unbroken Helvetica word at 28px (16) |
| No safe test | 62,400 | 3,156 | 13 | Euphemia UCAS 619, Zapfino 290, Athelas, Chalkboard, Big Caslon, Trattatello |
| Words first (V3) | 85,917 | 1,887 | 875 | Euphemia UCAS 1,060, Zapfino 319, Diwan Thuluth 242, Songti SC, Songti TC and the generic serif 66 each (Latin with combining accents), Farisi 61; gains are soft-hyphen words in fallback fonts |
| V3 and CJK cuts | 86,586 | 1,901 | 875 | as V3 |
| V3, CJK cuts and the pair window only (C-blink-rec2) | 86,577 | 1,946 | 850 | as V3, and Helvetica 45 |
| V3 without the pair window at spaces | 86,057 | 6,977 | 48 | Euphemia UCAS 645, Zapfino 319, Seravek 303, PT Sans 292, Gill Sans 237 |
| Main's rule (a wide word whole) | 82,796 | 7,134 | 111 | Euphemia UCAS 665, Seravek 313, Zapfino 311, PT Sans 300 |
| V3 with B3 off | 86,027 | 7,254 | 61 | Zapfino 347, PT Sans 317, Seravek 303, Gill Sans 276, Avenir Next |

- **The wide window buys two things:** words with a soft hyphen between ligature letters (office and affluent written
  of-fice and af-flu-ent), in the system font that draws Latin for the many families that don't have it, and the
  calligraphic fonts Zapfino and Diwan Thuluth. Kept only for groups that hold a soft hyphen, what remains at these
  targeted widths is the two calligraphic fonts, Arabic at 28px in the system fallback font, and one long unbroken word
  in Helvetica at 28px; on real text at any width measured, nothing.
- **Words first moves lines the search doesn't** in Euphemia UCAS (a syllabics font whose Latin kerns beyond a pair),
  Zapfino, Diwan Thuluth, Farisi, and Songti SC and the generic serif (which resolved to it here) on Latin with
  combining accents, largely the families the word-sum study found (`research/SPEC-WORD-SUM.md`). Songti SC is a real
  body font for Chinese pages. It gains lines back in soft-hyphen words in fallback fonts.
- **The pair window at spaces and the position adjustment (B3) are what keeps body fonts right:** without either, PT
  Sans, Seravek, Gill Sans and Avenir Next lose hundreds of these cases each. They stay.

**Recommendation.** Take the pair-window-only search with the soft-hyphen exception now: its questions are today's minus
the wide window's, no real line moves, and it halves Chrome's characters. Words first with CJK cuts (C-blink-rec2) asks
14 to 21% more calls than that but sends 53 to 60% fewer characters (a book 884,676 → 202,598); it moves no real line in
the sets here, and at the probe's widths it parts from the browser in Songti SC's accented Latin, Euphemia UCAS and a
few display fonts. Whether those widths count is the maintainer's call. Dropping the pair window at spaces, or main's
rule for a wide word, is not an option: body fonts kern across spaces.

## 5. CJK

CJK stays, so nothing below is proposed for removal; this is what CJK costs and where it could cost less.

| | Chrome | Firefox | WebKit |
|---|---|---|---|
| A real CJK paragraph (the 277 Chinese, Japanese and Korean ones, 121 units on average) | 579 calls, 2,279 chars | 399 calls, 1,606 chars | 111 calls, 141 chars |
| An English paragraph (the 65 Latin-script ones, 231 units) | 334 calls, 4,487 chars | 157 calls, 516 chars | 55 calls, 250 chars |
| Calls a CJK unit / an English unit | 4.8 / 1.4 | 3.3 / 0.7 | 0.9 / 0.2 |

Averaged over the six widths.

**Where CJK's cost is.**
- *Chrome*, at 400px: the cut search, inside runs with no space: 422 of 581 calls (236 wide-window, 110 totals, 70 pair
  window). 64% of the wide window's calls repeat a string the same canvas already measured, which Chrome's shape cache
  makes cheap. Positions (B2, B3) take 130 calls, the safe-to-break test 22, HanKerning 3.
- *Firefox*: every character is a break candidate inside one long shaping unit, so the in-word recipes run at every
  character: the ligature tests (G2 159 calls, G3 36), the suffix (G1a 79 calls, 493 chars), the crossing cluster (G1b
  69), the windows (383 chars).
- *WebKit*: about one question a character (each Han character is a word for its breaker), and cheap.

**The CJK mechanisms and what they buy.**
- HanKerning (B11, Chrome): 3 calls a CJK paragraph; without it 5 chat messages, 3 real paragraphs and 71 sweep cases
  lose lines (brackets and quotes). Keep.
- The safe test's pair window at cuts inside kana (Chrome): it fails in 5% of Japanese tests, where Hiragino Mincho
  kerns kana. Alone it moves no real line (B-cut-nosafe: the cut's own adjustment is still measured), but with the
  position adjustment (B3) also off, Japanese and Burmese paragraphs lose lines (36 real). Both stay.
- Gecko's script context (G9) keeps digits and punctuation between Han or Hangul in the paragraph's script; in the tier
  corpus its losses include `policy/korean` (`다음 배포는 7:00-9:00 사이예요.` at 136px). Keep.

**Cheaper CJK that changes no line measured.** Two new recipes, built in the scratch tree like the knockouts:
- *Firefox, G-cjk-sum*: inside a shaping unit (or window) made only of Han, kana, Hangul and CJK punctuation, whose
  clusters measured one at a time add up to the unit's own width, the advance before a cluster is the sum of the
  clusters before it, and the ligature tests are skipped. The premise is Gecko's own: it turns kerning off for CJK
  scripts unless a page asks for it (gfxHarfBuzzShaper.cpp:1405-1438), and the sum check refuses a unit whose clusters
  measured apart don't add up to it, which is what a ligature or contextual form would do. A real CJK paragraph goes
  from 399 to 185 calls and 1,606 to 733 characters; no line moved in the 7,171 real cases (1,662 of them CJK), the
  86,336 sweep cases, the 72 books or the 63,516 adversarial cases.
- *Chrome, B-cut-cjk*: cut between every two Han, kana or Hangul letters as V3 cuts at spaces, each letter a piece with
  the pair window measured at each cut. A real CJK paragraph goes from 579 to 432 calls and 2,279 to 566 characters;
  without the pair window at those cuts (`B-cut-cjk-nopair`), to 255 calls and 330 characters. No line moved in the
  7,171 real cases, the 86,336 sweep cases or the 72 books; it loses V3's 4 adversarial cases, and at the fonts probe's
  widths its losses on the probe's CJK text are V3's, all in Euphemia UCAS.

## 6. Bundle size

Measured with `bun build --minify` over entries that export what a page of one engine needs (`tools/audit/bundle.ts`;
the bundles are under `.artifacts/audit/bundle/`). Sizes are characters of minified code, then gzip and brotli bytes.

| Bundle | Minified | gzip | brotli | Base64 tables in it | All generated data in it |
|---|---:|---:|---:|---:|---:|
| Today, one bundle for every engine | 1,915K | 430K | 262K | 1,347K (70%) | 80% |
| Blink only | 769K | 155K | 105K | 580K (75%) | 84% |
| Gecko only | 372K | 142K | 114K | 139K (37%) | 73% |
| WebKit only | 788K | 136K | 75K | 628K (80%) | 81% |

- **Where the tables are.** Blink ships six ICU tables from Chrome's icudtl.dat (`line`, `line_normal`,
  `line_normal_cj`, `line_loose`, `line_loose_cj`, `char`: 391K bytes, 521K base64), WebKit seven from macOS's
  libicucore (the same six and `line_cj`: 465K bytes, 619K base64). Gecko ships its own line-break trie (ICU4X, 39K of
  base64), a likely-subtags trie (44K) and a property table (56K). Every table is decoded and parsed when its module
  loads, and today's single bundle loads all three engines' tables on every page.
- **One bundle per engine** is the largest cut that changes no behaviour: a Chrome page loads 769K instead of 1,915K
  (gzip 155K instead of 430K). An earlier measurement with a smaller export list and an earlier tree gave 749K, 363K and
  775K. It needs the entry to be chosen before loading (a page-side switch on the engine, or three published entries),
  which is a packaging question, not a correctness one.
- **Decoding when first used** keeps the size and saves only the decode and parse of tables a page never uses: in bun
  all six Blink tables decode and parse in 1.1 ms and all seven WebKit ones in 0.9 ms. The cold-page cost measured in
  the Amdahl study (10 ms in Chrome, 20 in Firefox, 14 in Safari to evaluate the bundle) is mostly reading the script
  itself, so this is worth little alone.
- **Duplicated table parts.** A line table is a character-to-class trie (27K bytes) and a state table (50K). Blink's
  `line` and `line_normal` have byte-identical state tables; WebKit's `line`, `line_normal` and `line_cj` too. The tries
  differ between tables only in a few classes. Brotli, given the `line` table first, adds only 22K for all the other
  tables together (42K for Blink's six tables compressed one by one; 50K and 22K for WebKit's seven). So the tables hold
  little information beyond one table each; storing each engine's `line` table whole and the others as differences would
  bring an engine's 521K to 619K of base64 down to roughly one table's 98K plus the differences. Not built here.
- **Only the tables a page uses.** An ordinary page uses one line table and `char`: `line-break: auto` takes
  `line_normal`, or `line_normal_cj` for Chinese (`engines/blink/breaks.ts`), and `char` gives grapheme boundaries for
  16-bit text. The other four are for `line-break: strict`, `loose` and CJK locales under them. Loading those on demand
  (a fetch, or separate lazily imported modules) would leave a Latin page in Blink with about 189K of code, 58K of
  property data and the two tables it uses (98K and 19K of base64): 364K instead of 769K.
- **Trimming tables to the scripts that differ** (keep ICU's classes only for code points where the engines' tables
  disagree with a simpler UAX #14 table) is a bigger design change and was not measured.

## 7. Test standards that hold the redo to more than real text needs

What each standard is, how large it is, and what it costs a speed change. "Real text" below is the chat, real paragraph,
sweep and book sets of §1, on which no single mechanism knocked out here moved a line but HanKerning, Gecko's emoji
recipe, Blink's safe-to-break test in the line breaker (45 sweep cases) and Blink's wide window before a space (one Urdu
sweep case).

1. **The adversarial corpus is most of what the gates protect.** Tier 1 replays about 390,000 recorded cases and tier 2
   runs the same sets in the browsers. Of the Chrome tier corpus (68,373 cases, 68,367 scored), 52% are under 80px wide,
   21% hold a control or format character, 20% a soft hyphen, 12% letter spacing, 14% a fixture web font (Amiri, Noto
   Naskh Arabic, Noto Nastaliq Urdu, ProbeShantell, Shantell Sans), 36% a white-space other than normal. Main's whole
   suite, which the census runs, is 67% under 40px and 88% under 80px (`research/CALIBRATION.md`). None of the real sets
   has a case under 150px, a control character, letter spacing or a fixture font.
2. **120 near-copy control-character families.** `suite/U+XXXX/start`, `/middle` and `/end` put one of 40 control or
   format characters beside joined letters: 30,908 census cases, 9,146 tier cases (13% of the tier corpus). Counted as
   three families instead of 120 the redo's family-mean pass rate barely moves (99.45% to 99.82% in Chrome), and main's
   moves by 11 points (CALIBRATION). They carry most of what Blink's joining check (S5) buys: 1,581 of its 2,225 losses
   in `research/RECIPE-COSTS-BROWSER.md` are these families.
3. **Every historical main pass is a certified requirement.** The main-obligations catalog certifies 500,797 of 502,373
   historical main visible passes (TAKEOVER, "Acceptance and main requirements"), most of them at the suite's narrow
   widths, and the strict workflows exit 1 on four known foundation cases that real text doesn't hold: Chrome's Arial
   `لألالإلآ` at letter spacing 1, Firefox's Amiri Arabic with a soft hyphen and a form feed, and two WebKit cases whose
   native layout moves a guillemet or a Latin letter in reverse order. A workflow that is red by design tells a speed
   change nothing.
4. **Page history.** webkit-host lays out about 5,555 suite cases differently deep inside long documents than in short
   fresh ones (CALIBRATION); the ledger's history format, the per-order obligations, the 48 Firefox native-variation
   reviews and WebKit's `page-history` gap detector (W5: 6,628 Canvas calls per 10,000 inspected cases, 2.1% of
   WebKit's, `research/RECIPE-COSTS.md`) all exist for it. My own tier runs put a browser's whole corpus in one long
   document, and webkit-host gets 984 of 63,729 cases wrong with every mechanism on; by the census's reruns most such
   cases lay out otherwise in a short fresh document. An application paragraph is laid out in a real page, not deep
   inside a lab document of 20,000 cases.
5. **Whole-pixel sweeps of one construct.** `wide-group-cuts` holds 2,159 variants of lines that end within half a px of
   the browser's fit at a 256 zoomed px cut, and the adversarial losses of every cut rule that keeps the pair window are
   in it; the fonts probe rule (lab README, "Test tiers") asks a change to Blink's cuts to agree with today's cuts in
   all 318 installed families, Zapfino's seven-letter ligature, Diwan Thuluth, Euphemia UCAS and Marker Felt included;
   `twins` holds 380 runs of 13 or more brackets in Amiri, asked as one-byte and two-byte strings. Each guards one
   mechanism at the exact place it could go wrong; each is also what a cheaper cut rule or string rule is held against
   first. (The fonts probe also finds real body fonts: PT Sans, Seravek, Gill Sans and Avenir Next for the rules without
   the pair window at spaces or without B3, and Songti SC and TC for words first. That part of it is not petty.)
6. **Byte equality of the inspected output.** Tier 1 compares a case's full inspected prediction, gap lists and stand-in
   values included, with a frozen reference, so a plain-path speed change that moves no line but renames a gap is
   "prediction changed" and needs a browser recording and a new freeze: the cut rework changed 1,093 recorded gap lists,
   all `script-context`, and was recorded and frozen again for that alone (`research/PERF-B1B-REWORK.md`). Chrome also
   answers the same question differently after other questions (its shape cache is per canvas), so any change that drops
   questions needs a browser run even when the offline replay shows nothing: dropping the cut's wide window moved 13
   attack cases in the browser and none offline. The string storage rule sends every Chrome case to a recording when a
   file that builds Chrome's strings changes. Neither is wrong for the lab; both make the line-range question, the one
   an application asks, the slowest to answer.
7. **Exact widths and claimed values.** The scorer holds widths to the browser's LayoutUnit or app unit and counts
   "exact-value" status over every value the library claims. On real text the redo's widths matter where a paragraph is
   centred or right-aligned; the line ends, which this audit checks, are what a layout needs first.
8. **Named gaps.** 28 gap names (57 registered gap rules across the ports) are reported with inspected lines. They cost
   the plain path nothing; on the inspected path the gap detectors and the per-cluster output take 44% of Chrome's
   calls, 50% of Firefox's and 15% of WebKit's (RECIPE-COSTS). They are a diagnostic promise, not a requirement of the
   lines.

## 8. Needs the maintainer

1. **Blink's cut rule** (§4). The pair window alone, with the wide window kept in a group that holds a soft hyphen,
   moves no real line and at the fonts probe's widths parts from the browser only in Zapfino, Diwan Thuluth, Arabic at
   28px in the system fallback font and one unbroken Helvetica word. Words first with CJK cuts saves another 53 to 60%
   of the characters and at those widths parts from the browser in Euphemia UCAS, the calligraphic fonts and Songti SC's
   accented Latin. The choice is whether those widths are a standard. Dropping the pair window at spaces is not a choice
   the numbers leave open: body fonts kern across spaces.
2. **Blink's position adjustment (B3).** 30% of Chrome's calls on chat, and alone it moves one real row (the Urdu sweep
   case, through its wide window before a space). But it is the second guard that keeps Japanese and Burmese right when
   the cut's safe test is gone, and at the probe's widths the kerning of PT Sans, Seravek, Gill Sans and Avenir Next
   runs through it. It stays unless those widths are petty.
3. **Font checks at every prepare.** Primary family (Chrome, WebKit) and fixed pitch (WebKit) are asked again for every
   paragraph because an answer is a fact of the page's fonts that no one can see change. Asking once a page (or once a
   declaration) is a lifetime choice: it saves 4 calls a paragraph in Chrome and 9.4 in WebKit (25% of Safari's calls),
   and it goes stale if a font loads later. The alternative for the primary family, taking the first listed family, is
   wrong where that family isn't installed.
4. **Gecko's contexts, one paragraph's.** They exist for a Firefox that has just started and a family named by a
   localized or legacy name (`research/CONTEXTS-HEAL.md`). They rule out a page pool in Firefox, which would move the
   Amdahl floor from 1.9–2.4× main to 1.1–1.8×. No real row here exercises them; whether that page matters is the
   maintainer's call.
5. **G-cjk-sum**, a new Gecko recipe on a premise: a unit made only of CJK letters and punctuation, whose clusters
   measured apart add up to the unit, is laid out as the sum of its clusters. Gecko turns kerning off for CJK scripts
   (gfxHarfBuzzShaper.cpp:1405-1438), and the sum check refuses a unit a ligature or contextual form would change. It
   halves a CJK paragraph's calls and characters in Firefox and moved no line in 7,171 real, 86,336 sweep, 72 book and
   63,516 adversarial cases. Adopting it is a new recipe, so the maintainer's yes.
6. **What blocks a speed change.** Whether the adversarial tier corpus (52% under 80px), the certified main obligations,
   byte equality of gap lists and the fonts probe's targeted widths stay blocking gates for plain-path speed work, or
   become reports read beside a real-text gate (§7).
7. **Packaging.** One entry per engine, and tables loaded when first used, change how the package is imported (§6).

## 9. Files

Tools, in `rebuild/tools/audit/` (none changes the library; the knockouts need `knockouts.patch` applied to a scratch
checkout of 62e7ec9, and the tools copied into it):

- `common.ts`, `cases.ts`, `sweep-cases.ts`, `tier-cases.ts`: page facts and the case files (chat, real paragraphs, the
  width sweep, the tier sets).
- `count-predictor.ts`: the plain path with a count of calls, characters and contexts in each row; `ko/*.ts` the same
  with knockout switches on; `knockouts.patch` the switches, G-cjk-sum, the words-first and CJK cuts, and the cut-search
  counters.
- `lock-run.sh`, `chain.sh`, `queue.sh`, `fonts-chain.sh`, `fonts-cases.sh`: the browser runs, under the rebuild's
  browser lock, one audit job a browser at a time, in the lab's background browser windows (headed, without focus).
- `replay-sites.ts` and `mechanisms.ts`: where each call comes from, over recorded answers; `sites.ts` the same on the
  stand-in Canvas; `cut-stats.ts` what the cut search does; `own-time.ts` own code with free answers; `tier-replay.ts`
  the tier sets replayed offline from recorded runs.
- `eval.ts`, `eval-all.sh`, `changed.ts`, `counts.ts`, `summary.ts`: scoring against native rows, and the tables.
- `cut-fonts-ko-probe.ts`, `fonts-summary.ts`: the cut fonts probe with a knockout in the head tree, and its families.
- `bundle.ts`: the bundle sizes.

Outputs are in the audit worktree's `.artifacts/audit/` (not committed): `runs/record-<browser>/` (the recordings),
`sites/`, `ko/`, `sweep/`, `tier/`, `tier-replay/`, `book/`, `fonts/` (each run's rows and `eval/`), `bundle/`.

## Appendix: every registered rule, and the row that carries its cost

The registry (`tests/rules.json`) holds 550 current rules. Most are ported engine logic that asks Canvas nothing; their
cost is own code, which PERF-JS-PROFILE puts at about a quarter of Chrome's time, half of Firefox's and most of
Safari's. Per engine and area, the kinds, and where §3 puts them:

| Engine / area | Rules (kinds) | Asks Canvas on the plain path? | Row in §3 |
|---|---|---|---|
| Blink measure | 15 recipes, 4 ported, 3 facts | yes: every string | measuring-string recipes; font checks; B2 |
| Blink shape | 6 ported, 3 recipes, 3 heuristics | yes | cut search; B2; B3; cluster position |
| Blink shapeline, shaping, units | 19 ported | through shape.ts | B4, B5; float32 run sum |
| Blink hankerning | 8 ported, 1 recipe | yes | B11 |
| Blink hyphen | 1 ported, 1 fact | rarely | B14; S2 |
| Blink lines, breaks, content, bidi, output, tabs, style, justify, script, grapheme, data | 102 ported, 1 recipe, 1 fact | no (breaks: ICU tables, dictionary segmentation) | own code; bundle |
| Blink gap | 20 named gaps | no (inspected path only) | named gaps |
| Observation, every engine | 17 observation rules (Blink 11, Gecko 4, WebKit 2) | no (lab) | not a library cost |
| Gecko measure | 14 recipes, 11 ported, 3 heuristics | yes | G0, G1a, G1b, G4, G9, windows, G7, G8, contexts |
| Gecko lines, output | 44 ported, 3 recipes | through advance.ts | in-word rows; G2; G3 |
| Gecko linebreaker, icu4x | 18 ported, 1 recipe | no (ICU4X data; Intl.Segmenter for SA) | own code; bundle |
| Gecko transform, textrun, glyphs, spacing, script, bidi, tabs, frames, style, units | 42 ported | no | own code |
| Gecko gap | 18 named gaps | no | named gaps |
| WebKit measure | 14 ported, 4 recipes, 1 fact, 1 heuristic | yes | W0, W2, W3, W7, fixed pitch |
| WebKit content | 18 ported, 1 fact | yes (box probes) | W1a, W1b; S3 |
| WebKit lines | 24 ported, 1 heuristic | rarely | W6; trailing content |
| WebKit breaker, breaks, ilb, builder, tos, output, bidi, style, tabs, range | 70 ported, 1 recipe | no (ICU tables, Intl.Segmenter) | own code; bundle |
| WebKit gap | 19 named gaps, 1 heuristic | no | named gaps |
| Shared measure | 5 recipes, 3 ported | yes (contexts, font string) | measuring-string recipes; font checks |
| Shared env | 1 heuristic, 1 recipe | once a page | engine from user agent; Canvas checks |
| Shared painter | 9 recipes, 2 heuristics, 1 choice by score | no (the DOM paints) | not a layout cost |
| Shared bidi, breaks, grapheme, data | 9 ported | no | own code |
| Shared lab | 5 observer assumptions | no | not a library cost |
