# Words like WebKit, compensated on top: is it viable in Blink and Gecko (speculative, 2026-09-20)

The maintainer asked: "if we break words like webkit then try to just compensate on top to satisfy chromium and ff, is
that viable, or would that return us to the same place as main's trying to do? We do have ground truth for chromium and
ff at least". The WebKit port is fast because WebKit's own rules let it measure a word once and add words up; Blink and
Gecko shape across more than a word, so their ports ask Canvas about positions inside long strings. One agent per engine
looked for where a sum of word facts provably equals the port's own answer and built a fast path on it, with the exact
port kept as the fallback and as the offline judge (a checked mode runs both and throws on any difference); a second
agent per engine attacked it. The attackers' reviews come first. Nothing here is merged. The branches
(`x-spec-words-blink`, `x-spec-words-gecko`) are local and stand on afb5a63, a scratch base that held the first form of
Blink's 256 px cut found without asking Canvas, which was later found to move lines in ligature fonts: the comparisons
are fast path against exact path on that same base, so the ratios stand, and the Blink attacker's failing fonts overlap
that flaw's class (see the reading).

## What came back, and the orchestrator's reading

- **The short answer:** it is not main's road, because nothing is fitted: no constants, no tolerances, no corrections
  found by score. But in neither engine is it exact. In both it is the exact port with one test left out on a belief
  about fonts, and both attackers say to bring it to the maintainer as a trade with a measured price.
- **Gecko: there is nothing to compensate.** Gecko shapes word by word and a boundary space is its own glyph, so the
  port already sums one Canvas question a word (66,743 of 66,745 recorded strings with spaces equal the sum of their
  parts; the 2 are a known port rule). What a fill still asks is about offsets inside each line's first word, which
  Gecko tests as break candidates under `overflow-wrap: break-word`. The "word scan" skips them where the whole word
  fits. That is exact only if no suffix of a shaped word has a negative advance (then a prefix could be wider than its
  word). The engine doesn't promise it (signed advances, no clamp); recorded answers hold 0 violations in 1,229,216
  in-word advances, HarfBuzz over 1,008 installed faces and 54,824 strings finds 16 faces with negative glyph advances
  and none with a negative suffix, and Firefox over 131 families and 13,412 layouts shows 0 differing lines.
  - **What it buys in Firefox** (10,000 messages, 4 alternating pairs, reproduced by the attacker): plain ASCII from
    scratch 0.60 to 0.25 s (0.46 to 0.19 s with one list of contexts), 30,000 relayouts 0.65 to 0.11 s; the mix 2.65 to
    2.25 s and relayouts 0.68 to 0.19 s (this base has no windows in long shaping units, which since took the mix to
    about 1.0 s, so the mix's gain has to be measured again on today's tree). Calls a message 84.9 to 23.7 and 119.6 to
    63.0.
  - **What the attacker found:** one wrong line, and not by the font premise: negative word spacing reaches U+00A0,
    which isn't trimmable, so a no-break space before U+200D or U+200C inside a word slips through a condition (10 of 84
    lab cases in Firefox: native 2 lines, predicted 1; the exact port passes all 84). One more condition closes it (0 of
    563,816 fuzz layouts differ afterwards); it isn't on the branch.
- **Blink: the word sum as the port's one recipe.** A shaping group is cut after every qualifying space into words with
  their trailing spaces, and the pair adjustment between the space and the next cluster is measured in Canvas: the
  port's own rule for a 256 px cut, made at every space. Positions at word edges are kept on the prepared paragraph and
  a plain line that ends between two words finds its break by arithmetic. There is one table read two ways, not a second
  answer beside the first.
  - **What it buys in Chrome** (10,000 messages, reproduced by the attacker's timed pair): from scratch 3.43 to 2.37 s
    on the mix and 2.91 to 1.80 s on ASCII; with one list of contexts 2.04 to 0.84 s and 1.80 to 0.51 s; 30,000
    relayouts at new widths 3.00 to 0.85 s and 2.34 to 0.44 s. `measureText` calls a message 199 to 114 and 194 to 94.
    97.7% of English chat lines never search; 81.7% of the mix; 58.0% over eleven languages.
  - **What the attacker found:** the owner's "0 of 316,645 recorded positions off" covers the lab's 48 font strings.
    Across 318 installed families in the pinned Chrome (202,244 layouts) base and prototype differ in 659 layouts of 7
    families (Euphemia UCAS, Zapfino, Diwan Thuluth, Waseem, Songti SC, Songti TC, generic serif), and scored against
    the browser's own lines it is the prototype that is wrong: breaks pass to fail 14, widths pass to fail 22, nothing
    gained. No test a program can make on the text separates these fonts. Second, a logic hole: where a cut beside a
    space starts with a default-ignorable character the candidate from words differs from the search (61 of 299,470
    layouts throw in the checked run; two get another line count); a scratch narrowing removes every throw in the
    samples rerun.
- **The reading.** (1) The two are different cases. Gecko's is the engine's own loop minus one test, on a premise about
  glyph advances with a large clean record and a small, local price when wrong (one line's break, at a width where a
  word's prefix is wider than the word). Blink's is a recipe change whose failures are whole font families, found at
  once by looking at more fonts than the lab holds. (2) The Blink failures are in the class the 256 px cut's first form
  already failed in (contextual fonts: Zapfino's ligatures, AAT and Arabic fonts), and that form is this study's base.
  The cut's rework (the wide window's adjustment at every cut, with a critic now) is the same question at fewer places:
  what must be measured at a cut so that the two sides add up. So the word sum in Blink is not a separate road: it is
  "cut at every space" and it stands or falls with the rework's cut rule. Once the rework is judged, the honest next
  experiment is that rule at every qualifying space with a measured guard (the two words together against their sum:
  about twice the strings new to a page, by the owner's count), rerun against the attacker's 318 families, which are
  now the test any cut rule has to pass. (3) Neither goes in as it is. Gecko's needs the attacker's condition and a
  decision by the maintainer on the premise; Blink's needs the rework first, the ignorable fix, the guard costed, and a
  recording in both orders (it changes 605 recorded predictions' gap lists and asks strings no record holds in 33,985
  cases).
- **Found on the way:** Firefox's Canvas measured `~~` in 16px SignPainter as 1,038 au in one prepare and 628 au in the
  next within one document (the attacker's probe), so a differential that prepares twice in one document can show a
  false difference. The Blink owner also notes that relayout of kept paragraphs stays 13 to 94 times main's because of
  the fill's own JavaScript (a line breaker, a break iterator, views a line): that is the JS profiling pass's subject.

## Second check of the words study, Blink (Chrome), 2026-09-20

This is a speculative study on branch `x-spec-words-blink`. Nothing here is merged or pushed.

**Labels.**
- "Base" is afb5a63. "Prototype" is 9e9efac.
- "Word pieces" (part A of the owner's work) is the cut of a shaping group after every qualifying space, so a position is a sum of words and pair adjustments.
- "Candidate from words" (part B) is the arithmetic that finds a line's candidate offset from the positions at word edges.
- "The search" is `offsetForPosition`, the port of Blink's binary search over every offset.
- "Checked run" is the owner's mode (`wordsCheck.on`): it holds every candidate from words against the search and throws on a difference.
- A "layout" is one paragraph at one width.
- "Stand-in" is an offline Canvas that is no font.
- "Boundary widths" are a decided line's own width and one LayoutUnit (1/64 px) to either side of it.
- R/ is `~/github/pretext-rebuild/.artifacts/tests/runs/spec-words-blink-20260920/attack/`.
- My log is `.progress-words-blink-attack.txt` at the top of the worktree.

### 1. Verdict in short

- **The owner's numbers reproduce**: the differential test, the coverage, the Canvas counts and one timed pair.
- **There is a line where the prototype and the exact port disagree, and in real Chrome it is the prototype that is wrong.**
  - Word pieces rest on a property of the font: nothing but the pair beside a space crosses it.
  - The owner called this an assumption with 0 recorded misses.
  - On this machine's system fonts it has misses in 7 of 318 families.
  - On the browser's own layout the prototype loses 14 break passes that the base has, and gains none.
  - No condition a program can test on the text separates those fonts.
- **The candidate from words is not the search's "by pure logic".**
  - The two differ where a cut beside a space starts with a default-ignorable character. There the port's own positions run backwards.
  - The checked run throws on it. In two layouts the library's plain path gives another line count than the base and than its own inspected path.
  - The owner's runs never met it.
  - A narrow condition removed every throw in the two samples I reran with it (an unbuilt scratch test).
- **Classification.** It is not main's compensation, because nothing is tuned. It is not "the WebKit shape with proofs" either. It is the WebKit shape with one provable half (B, once narrowed) and one half (A) that is a fact about each font.

### 2. What I reran

Everything runs at 9e9efac against afb5a63.

| what | result | file |
|---|---|---|
| two-trees, plain predictor both sides, **new seed** (`words-attack-1`), 19,436 random tree cases at 6 widths | 0 of 116,616 layouts differ (190 s) | R/rerun-tt-plain-tree-seed2.json |
| the same, usual predictor, gap lists left out, 3 widths (the run the owner's time ran out on) | 0 of 58,308 differ (144 s) | R/rerun-tt-usual-tree-seed2.json |
| coverage, checked runs, 4 message sets at 4 widths | The same shares as the owner's. Bench ASCII: 136,934 lines, 68.5 / 29.2 / 2.3%, 8,558 of 10,000 never searched. Mix: 145,129 lines, 54.1 / 27.6 / 18.4%, 6,492. English once: 31,438 lines, 68.0 / 29.7 / 2.3%, 1,999 of 2,336. Languages once: 82,261 lines, 26.5 / 31.5 / 42.1%, 3,355 of 6,468. All exit 0, no throw. | R/rerun-cover-*-checked.json |
| prototype's stand-in counts, bench ASCII, 10,000 messages | From scratch: 99.13 asks, 395.6 units, 2.69 new strings a message. Kept at 260 / 380 / 440: 28.0 / 14.0 / 10.9 asks. These are the owner's numbers. I did not rerun the base's stand-in counts. | R/rerun-cover-bench-latin-proto.json |
| measureText calls a message, pinned Chrome | Base: 199.2 (mix), 193.6 (ASCII). Prototype: 114.2, 93.7. Lines are the same in both trees (35,076 and 32,549). Read from the timed pair's bench reports, phases of 200 messages. | R/timed-a1-{base,proto}/chrome-bench.json |
| **one timed pair**, exclusive lock, one stretch 08:14:39 to 08:20:24 (5 min 45 s), waited 95 s, machine load 28 to 32, page arithmetic 26.6 to 28.1 ms | From scratch, mix: 3.37 / 3.26 to 2.34 / 2.36 s. From scratch, ASCII: 2.70 / 2.66 to 1.81 / 1.80 s. One list of contexts: 1.92 / 2.07 to 0.77 / 0.89 s (mix), 1.73 / 1.78 to 0.49 / 0.49 s (ASCII). 30,000 layouts at new widths: 2.73 to 0.83 s (mix), 2.30 to 0.42 s (ASCII). All within the owner's spread. | R/timed-a1.log |

A note on wording: "97.7% of lines never search" includes 29% of lines that never searched in the base either, because the rest of the item fit. The candidate itself accounts for 68.5%.

### 3. Counterexample 1: real fonts (word pieces, part A)

The first four tests below run on real browser data. They use pinned Chrome 153 at device pixel ratio 2, in background windows on Chrome slots of the lock.

**Both libraries in the page** (`tools/words-fonts-probe.ts`, R/fonts-probe/chrome-probes.json, 159 s).
- The base and the prototype are bundled into one page.
- Both lay out 19 texts, plain, in every installed family: 318 of 321 entries resolve.
- Widths are 8 fixed ones plus boundary widths. Line ranges, line widths and overflow flags are compared.
- Totals: 202,244 layouts and 2,003,829 lines.
- **659 layouts differ, in 7 families:**
  - Euphemia UCAS: 403 of 632.
  - Zapfino: 111 of 667.
  - Diwan Thuluth: 46 of 597.
  - Generic serif, Songti SC, Songti TC: 32 each.
  - Waseem: 3.
- Example: Zapfino, Hamlet text at 97.3 px, line 2. Base gives "that is ", prototype gives "that is the ".
- 50 families kern with the space glyph (2,656 of 154,193 cuts carry a pair adjustment). 49 of them agree completely. So the pair term itself works for ordinary pair kerning.
- The other 311 families include Helvetica Neue, Times New Roman, Arial, Avenir Next, Hoefler Text, system-ui, Geeza Pro, Kohinoor Devanagari, Thonburi and Noto Nastaliq Urdu. They show 0 differences.
- The checked run threw 0 times.

**The identity asked of Canvas directly** (`tools/words-identity-probe.ts`, R/identity-probe-2, 11 s).
- The identity is W(w1 s w2) = W(w1 s) + d + W(w2), with s = U+2028, in 16.16 units, wholes below 256 px, left-to-right texts.
- Two-word windows: 153,838 exact of 154,188. Three-word windows: 129,208 of 129,579.
- Off in 6 families:
  - Euphemia UCAS: 340 of 487 two-word windows, up to 13.2 zoomed px.
  - Zapfino: 6 of 471, up to 11.0 px.
  - Serif, Songti SC, Songti TC: 1 of 495 each, 0.032 px.
  - Seravek: 1 of 493, 0.48 px, beside a Han word.
- 7 three-word windows are off though both of their two-word windows are exact. All are Euphemia UCAS, and the three I read (R's report lists only three) have a middle word without a script of its own, which rule A4 already leaves out.

**Ground truth, the browser's own layout** (`tools/words-fonts-cases.ts`, then `lab/run.ts` and `lab/score.ts`; R/fonts-lab-{base,proto}/).
- 240 cases: 8 families, 5 probe texts, 6 widths.
- Usual predictors, no-facts configuration, forward order, one run each.
- The three lab runs recorded the same native observations (compare-rows: 0 differing).

| passes of 30 cases | breaks, base to prototype | line count | widths |
|---|---|---|---|
| Zapfino | 30 to 28 | 30 to 28 | 28 to 18 |
| Euphemia UCAS | 18 to 9 | 27 to 17 | 6 to 6 |
| Diwan Thuluth | 30 to 27 | 30 to 29 | 29 to 24 |
| Songti SC | 30 to 30 | 30 to 30 | 29 to 24 |
| serif | 30 to 30 | 30 to 30 | 29 to 24 |
| Waseem, Times New Roman, Hoefler Text | no change | no change | no change |

- Transitions from base to prototype: breaks pass to fail 14, fail to pass 0. Line count pass to fail 13. Widths pass to fail 22.
- In all 14, the prototype's inspected paragraph lists `unsafe-to-break`. So the owner's claim that an inspected paragraph names the gap stands.
- The base is also weak in Euphemia UCAS: it already fails 12 of 30 on breaks.

**Why, from the engine.**
- Blink's test for shaping word by word reads GPOS and GSUB coverage of the space glyph alone (`HasSpaceInLigaturesOrKerning`, harfbuzz_face.cc:341-390).
- AAT tables are state machines that carry state over any glyph, the space included.
  - `kerx` format 1: hb-aat-layout-kerx-table.hh:224-270.
  - The driver marks the whole span unsafe to break: hb-aat-layout-common.hh:1341-1370.
- I did not read the font tables. But Zapfino, Euphemia UCAS, Diwan Thuluth and Waseem are Apple fonts of that kind.
- In Euphemia UCAS the pair window measured alone is itself not the run's adjustment.
  - "To be," whole is 5,782,528 units. Pieces sum to 5,350,400.
  - The difference is 432,128 units, which is 6.6 zoomed px.
  - Word pieces add that error at every word. The base adds it once per 256 px.
- Songti is a second mechanism.
  - "cafe + U+0301, space, Vi + U+1EC7 + t" is off by 2,097 units.
  - It is exact when either fallback character is left out (R/songti-probe).
  - Blink picks a fallback font from hint characters collected over the whole shaping call (harfbuzz_shaper.cc:704-760, :937-947).
  - I offer this as the likely cause. I did not trace it.

**Offline sensitivity** (R/atk-across-small.json). Under a stand-in where a letter after a space depends on the letter before that space, base and prototype differ in 903 of 5,000 layouts.

### 4. Counterexample 2: logic (candidate from words, part B)

**Mechanism.**
- A cut beside a space can start with a default-ignorable character.
  - This happens at the port's own 256 px cuts before SHY or LRM.
  - It also happens at a word cut before U+2060, U+034F or U+2061, which rule A5 doesn't list.
- HarfBuzz skips the ignorable, so the pair window at the cut reaches over it to the next letter.
- `measureGroups` puts the adjustment into `positionAtCut`. `groupPrefix16` then adds it again one offset later.
- So position(cut + 1) is less than position(cut).
- The search can land past the cut. The words stop at the space before it.
- Rule B3 checks the cuts' positions only.
- This is a defect of the base's positions that the search tolerates. By Blink's own positions the candidate would be the words' answer.

**Counts.** All use `tools/words-attack.ts`. It loads both trees' function sets in one process. It compares:
- base plain against prototype plain, with the decided lines' widths;
- candidate against search-only;
- plain against inspected;
- the checked run's throws.

| run | layouts | checked throws | trees | candidate | plain vs inspected |
|---|---:|---:|---:|---:|---:|
| 59,894 word-rich seeded cases, usual stand-in, **fixed widths** 24, 64, 180, 320, 640 (R/atk-words-widths.json) | 299,470 | 61 | 39 | 39 | 3 (*) |
| 30,000 of them at 130 px + boundary widths (R/atk-words-boundary.json) | 447,908 | 40 | 24 | 24 | 0 |
| 6,000 of them, stand-in on the 1/65536 px grid, 97.3 px + boundary (R/atk-fine-boundary.json) | 92,167 | 26 | 26 | 26 | 6 |
| 3,000 cases whose words start with U+2060, U+034F or U+2061 (R/atk-ignorable-word-start.json) | 40,463 | 137 | 0 | 0 | 0 |
| tier dev sets (7,219 cases), own widths + boundary (R/atk-dev-boundary.json) | 74,099 | 0 | 0 | 0 | 0 |

(*) Of these 3:
- 2 are **line counts**: c-92ba44b727929557 has 94 against 95 lines, and c-011f595533629004 has 204 against 205. Both are at 24 px, under the usual stand-in, at a fixed width. The base, the search-only prototype and the inspected prototype agree with each other. The prototype's plain path differs.
- 1 is a crash of the inspected path that the base has too (section 9, side findings).

**One traced case**: c-59a3491a9c913af3 at 25.609 px, fine grid.
- In the overflow-wrap retry every grapheme boundary is a break opportunity.
- Positions: p(56) = 77102, p(57) = 77834 (the cut, SHY), p(58) = 77748. The end position x is 77749.
- The words give candidate 56. The search gives 58.
- Result: 61 lines against 60.
- Most other differences sit in the decided line only. One of them is a line width: 7381 against 7453 LayoutUnits, c-b5ff12df6a30d8e6.

**Pinned by a unit test**: `src/engines/blink/words-second-check.test.ts`.
- "a beta U+2060 Vee ggggg delta" at 63 px throws "the search finds offset 8 and the words give 6".
- It passes today and documents the behaviour.
- When the behaviour is fixed, the expectations flip.

**A narrowing exists** (scratch copy, not committed).
- Rule: leave the line to the search when the cut that ends the unit starts with a default-ignorable character or a mark.
- Throws go from 137 to 0. The 7 failing fine-grid cases go from 26 / 26 / 6 / 26 to 0 / 0 / 0 / 0.
- The root fix is in the base's position after an ignorable at a cut.

**The premise.** Under a stand-in with negative advances inside words (R/atk-backwards.json), 10,000 layouts give 24 throws and 17 plain-against-inspected range differences. The premise carries the candidate, and the checked run sees it.

**In Chrome.**
- The checked plain predictor ran over the lab's `runs` (2,580) and `policy` (1,606) sets.
- It threw 0 times. Its line ranges equal the owner's usual-predictor rows of 9e9efac (compare-rows: 0 of 4,186 differ).
- It also threw 0 times on the 240 font cases.
- This closes the owner's open item for those two sets.

### 5. Attacks that found nothing

- Fonts that kern with the space glyph: 49 of 50 families agree.
- One-byte against two-byte strings, fallback fonts inside a word, emoji, Devanagari, Thai and mixed scripts all went into the real-Chrome probe. 311 families show no difference.
- Offline, the following found nothing beyond the ignorable hole, over about 0.95 million layouts and 12.5 million lines under the usual and fine-grid stand-ins:
  - several spaces, NBSP, U+3000, thin spaces;
  - tabs, preserved trailing spaces, combining marks after a space;
  - words split across inline boxes and fonts;
  - letter and word spacing of both signs, text-indent, floats, bidi paragraphs;
  - widths of 8 to 24 px, LayoutUnit boundaries.

### 6. Conditions, code and citations

- The citations I opened say what is claimed:
  - ShapeLine: shaping_line_breaker.cc:300-347, :386-430, :481-488.
  - The binary search: shape_result.cc:2300-2318.
  - line_breaker.cc:1655-1659.
  - harfbuzz_face.cc:105-113 and :341-390.
- One wording slip. `NeedsAccurateEndPosition` for the item is box decoration, background or applied text decorations (line_breaker.cc:255-262), not "a border".
- A1 to A5 and B1 to B6 are in the code as stated. There are three gaps:
  1. B applies to any cut after U+0020, including the 256 px cuts of groups that A5 excluded.
  2. A5 lists only the ignorables the port writes in two ways.
  3. Sorted positions between a cut and the next offset are not checked.
- None of A1 to A5 can see the font property.

### 7. Can the fast path disagree silently?

Yes, in two ways.

- **Word pieces have no fallback and no runtime check.** The exact port is not a fallback for them. The base recipe is gone in every admitted group, on the plain path and the inspected path alike. Only the candidate has a fallback.
- **The checked run is narrow and mostly off.**
  - It compares candidate offsets, not lines.
  - It is on only under an environment variable, in one unit test and in one lab predictor.
  - `gates.ts` does not run it.
- **The other checks are narrower than they read.**
  - Two-trees with plain predictors compares line ranges alone, so widths on the plain path were never compared before my runs.
  - Plain against inspected ran only under replay, on the 33,095 cases whose strings the records hold.

### 8. Classification; new font, new browser version

- Nothing is fitted: there is no constant and no tolerance. The conditions are logic of the engine and of the port's Canvas recipe. They would survive a browser update as well as the base does.
- The identity itself is data about fonts. It is true for pair kerning. It is false for state-machine tables and for fallback chosen per shaping call.
- A new font can break it silently on a plain paragraph. The measured cost of that today is 14 break regressions in 90 cases of three families.
- The charter's tentpole 3 allows a fact that is asked of Canvas where a check is sound, or else a default with a named gap. Neither is built.

### 9. Verdict per claim

| claim | verdict |
|---|---|
| Viable and not main's road | Stands with a correction. It is not main's road. It is viable only as a trade, because word pieces lose accuracy in real fonts where the base has it. |
| Timed numbers, counts, characters sent | Stand. They reproduce, except the base's stand-in counts, which I did not rerun. |
| Coverage | Stands. It reproduces exactly. |
| Identity 0 of 316,645 | Stands as counted, for the lab's 48 font strings. As evidence about fonts it doesn't stand. |
| 0 of 116,670 and 0 of 169,660 layouts differ (plain) | Stands as counted, for line ranges alone. On word-rich text at narrow widths 2 of 299,470 layouts differ in line count. |
| Candidate equals the search by pure logic; checked runs clean | Doesn't stand. A narrow fix exists. |
| Tier 2: 0 transitions | Stands for the tier corpus's fonts (the owner's logs read). I did not rerun it. On other families there are 14 transitions. |
| A disagreement can't be missed | Stands with a correction (section 7). |
| Bytes (53 a word), 281 engine lines | Stand. |

**Side findings, both present in the base:**
- A pair adjustment is counted twice after an ignorable at a cut.
- The usual predictor crashes with "null is not an object (evaluating 'view.parts')" on c-d23de5956eb06461 at 180 px with its line slots. It happens at afb5a63 and at 9e9efac alike.

### 10. Should it go in front of the maintainer?

Yes, but as a trade with a measured price, not as "exact with proofs".

**What it buys:** about 1 s from scratch, and 3 to 5 times on relayout. It is identical to the base on every mainstream UI font tried in Chrome.

**What it costs:** silent wrong lines in fonts whose shaping crosses a space.

**Before it goes:**
1. Fix the double-counted adjustment in the base, or narrow B. Make random word-rich cases at boundary widths, under a fine-grid stand-in, a gate.
2. Decide the font property. There are three options.
   - **A measured guard at every cut** (one two-word question).
     - It turns the assumption into a Canvas fact.
     - It would have caught the failing windows in my sample, apart from the 7 three-word ones. Those hold a word without a script, which A4 leaves out.
     - Its cost needs measuring. The owner estimates about twice the strings new to a page.
   - **A font fact.** It would be off in the no-facts configuration, so it would not help the headline.
   - **An accepted named gap.**
3. An alternative that needs no assumption (an estimate, not built).
   - Keep the base's recipe.
   - Keep word-edge positions as they are measured, and take the candidate from them.
   - That would give the kept-paragraph gain exactly.
   - From scratch would stay near the base's cost.

### 11. Files

**Commits after 9e9efac:**
- `tools/words-attack-cases.ts`
- `tools/words-attack.ts` (two commits)
- `tools/words-fonts-probe.ts`
- `tools/words-fonts-cases.ts`
- `tools/words-identity-probe.ts`
- `src/engines/blink/words-second-check.test.ts`

**State:**
- tsc over the rebuild project is clean. The 132 Blink unit tests pass.
- Runs are under R/. Scripts are `rerun-1.sh`, `attack-1.sh`, `attack-2.sh`, `fonts-lab.sh`, `plain-checked.sh` and `timed-pair.sh`.
- Case files are in the session scratchpad (`words-blink-attack/`) and can be regenerated by seed.
- The two detached worktrees are removed. Nothing of mine runs.

## Gecko's word scan, attacked: one wrong line found, the rest holds

Second pair of eyes on branch `x-spec-words-gecko`, 2026-09-20. Worktree `~/github/pretext-rebuild-wt/spec-words-gecko`. Speculative: nothing is merged or pushed. My five commits sit on the owner's tip 2028537 and add files only; I did not edit the owner's files. My runs are under `~/github/pretext-rebuild/.artifacts/tests/runs/spec-words-gecko-20260920/attack/`, called ATTACK below. My running log is `.progress-words-gecko-attack.txt` at the top of the worktree.

Words, as the owner uses them: a **unit** is what Gecko shapes in one call (a word, a boundary space, an invalid character). A **scan** is one run of `BreakAndMeasureText`. The **engine's loop** is the port's exact scan (`lines.ts` `charScan`). The **word scan** is the prototype (`wordScan`). Modes: `exact` (word scan off), `proven` (used only where no candidate lies inside a unit), `premise` (also passes over a unit's inner candidates where the unit's end fits; the branch's default). **Checked**: both scans run and a difference throws. Mine: the **constructed Canvas** is a fake `OffscreenCanvas` in my tools that shapes like a font (kerning, ligatures, Arabic forms) and never gives a glyph a negative advance.

### 1. Short answer

1. **There is a line where the fast path and the exact port disagree, and Firefox agrees with the exact port.** Negative word spacing on a no-break space inside a word. It is a mistake in condition C6', not a failure of the font premise. Section 2.
2. **I found nothing else.** 214,000 seeded adversarial paragraphs (4.5 million layouts, 50.9 million lines) on the constructed Canvas: mode `proven` never differs from the engine's loop; mode `premise` differs only in that one shape. The owner's tests on Firefox's recorded answers reproduce to the digit. Two new kinds of real-font evidence (HarfBuzz over every installed face; real Firefox over 131 font families) find no font that breaks the premise, but do find fonts with negative glyph advances. Section 3.
3. **The owner's numbers reproduce**: counts exactly, times within the run-to-run spread, coverage to the decimal. Sections 4 and 7.
4. **Tier 2 is now done.** On a quiet machine it takes two minutes. Usual predictor, both configurations: 0 transitions, exact values not worse, gates pass. Plain predictor: line ranges equal the engine loop's wherever the native observation is equal. Section 8.
5. **Classification**: it is the engine's own loop with one test left out, on a belief about fonts. It is not main's compensation (nothing is fitted, nothing has a tolerance). It is not "with proofs" either. Section 9.
6. **Not the next big step for Gecko.** Plain ASCII from scratch was under the 2 s bar before this study (0.56 s); the mix stays at 2.2 s because of Chinese, which this doesn't touch. The real gain is relayout (6 times faster, still 7 times main). It is a contained yes or no for the maintainer about the premise. Section 11.

### 2. The counterexample

**The shape.** `aaaa`, U+00A0, U+200D, `bb cc`, with `word-spacing: -30px` and `overflow-wrap: break-word`.
- U+00A0 before U+200D is no word boundary: `IsBoundarySpace` refuses a space before a cluster extender, and U+200D is one (gfxFont.cpp:3317-3323). So `aaaa`+U+00A0+U+200D+`bb` is one shaped word.
- That U+00A0 takes word spacing: `IsCSSWordSpacingSpace` accepts U+0020 and U+00A0 unless a combining sequence tail follows, and the tail test leaves the join controls out (nsTextFrame.cpp:879-898).
- U+00A0 is not trimmable, so the glyph flag the word scan reads (`INNER_SPACE`, from `isSpace`) is not set.
- Under -30px the whole word is narrower than its prefix `aaaa`. The engine adds spacing per character inside the loop (gfxTextRun.cpp:1139-1151), so it finds that the prefix doesn't fit and breaks after `aaa`. The word scan sees that the word's end fits and passes over the word.

**In the unit test** (constructed Canvas, every glyph 600 au, so no negative advance anywhere): engine's loop `[[0,3],[3,11]]`, mode `proven` the same, mode `premise` `[[0,11]]`, checked mode throws. File `rebuild/src/engines/gecko/word-scan-attack.test.ts` (commit c4ad715). The test asserts the disagreement, so it fails once the library refuses the shape.

**In real Firefox 156** (84 lab cases: that text with U+200D or U+200C and a control text, 16px Arial and "Times New Roman", word spacing -30 and -20px, 7 widths; ATTACK/lab-nbsp): the usual predictor (inspected path, the exact port) passes 84 of 84 on line count, breaks, widths and painter. The plain predictor with the word scan fails 10 of 84, each "native 2 lines, predicted 1". Native observations are equal in both runs (compare-rows: 0 native differences, 10 predictions). So this is a wrong line against the browser, with system fonts, and the exact port is right.

**Cause.** The report's C6' says a unit is passed over when "the unit holds no trimmable space" and the frame has no letter spacing. What the argument needs is that no spacing inside the unit is negative. The engine has one more source of spacing inside a word than the condition lists: word spacing on U+00A0. The premise about fonts plays no part.

**Scope.** Only U+00A0 directly before U+200D or U+200C, in a 16-bit text run, under negative word spacing, with a candidate inside the word (`break-word`, `anywhere`, or a natural break inside). U+00A0 before a combining mark takes no word spacing. U+0020 inside a word is already refused (it keeps `isSpace`; I also tried U+0600 + space + U+200D: refused). Rare, but the brief's rule is that a condition that admits one wrong line is wrong.

**The fix is one condition**, and I showed it closes the hole in two scratch copies of the tree (never committed): (a) set `INNER_SPACE` for U+00A0 inside a word too; (b) better, because it lists no characters: in the premise branch refuse a unit whose scan spacing inside is not zero, `p.scanSpacingPrefix[unit.tEnd] !== p.scanSpacingPrefix[unit.tStart]`, one subtraction on data the scan already reads. With either, the fuzz round that had 241 differing layouts has 0 (36,000 paragraphs, 563,816 layouts; ATTACK/attack-fixcopy-seed-*.json and attack-fixcopy2-seed-*.json).

### 3. The hunt: what ran on what

| Test | Data it ran on | Size | Result | File |
|---|---|---|---|---|
| Sum of words and spaces, W(a b) = W(a) + W(space) + W(b) | **Firefox's recorded Canvas answers (real)** | 66,745 strings, 529 font strings, 50 family lists | 66,743 exact; the 2 are U+200D before a space in 18px Georgia, a rule the port has | ATTACK/rerun-space-identity-no-facts.json |
| The premise counted (owner's census library, mode exact) | **recorded answers (real)** | 127,542 paragraphs, 812,358 words, 1,229,216 advances inside words | 0 above the word's end; 46 below its start (44 Courier New, 2 Noto Nastaliq) | ATTACK/census/census.ndjson |
| Function set, plain, checked library, both configurations | **recorded answers (real)** | 63,771 cases x 2 | pass; 3,511,582 questions, mode exact's count, so both scans ran | ATTACK/rerun-plain-checked-*.log |
| Function set, plain, branch default (premise, unchecked), final library | **recorded answers (real)** | 63,771 x 2 | pass; 2,660,519 and 2,639,960 questions | ATTACK/rerun-plain-premise.log |
| Function set, sweep, checked library, no-facts | stand-in Canvas | 63,771 cases x 4 widths | pass | ATTACK/rerun-sweep-checked.log |
| My fuzzer, rounds 1 to 5 (`tools/word-scan-attack.ts`) | constructed Canvas | 214,000 paragraphs; 4,532,112 layouts; 50,889,112 lines; 12.7 million scans decided by the word scan | `proven`: 0 layouts differ. `premise`: 251 differ, all the shape of section 2; checked mode threw on every one; 0 differed without a throw. Rounds 3 to 5 leave that shape out: 0 differ in 3,177,448 layouts | ATTACK/attack*-seed-*.json |
| HarfBuzz over the installed font files (`hb-shape` 14.2.0; Firefox 156 shapes every font with HarfBuzz: `gfx.font_rendering.coretext.enabled` is false, StaticPrefList.yaml:7849-7852) | **real fonts, no browser** | 1,008 faces x 54,824 strings (every printable ASCII pair, letters with marks, Arabic and Hebrew with marks, 44,718 words of main's corpora) | 16 faces give some glyph a negative advance; 0 faces have a suffix from a cluster start that sums below zero | ATTACK/font-scan.json |
| Counterexample in the lab | **real Firefox** | 84 cases | exact port 84 pass; plain path fails 10 | ATTACK/lab-nbsp |
| Owner's probe, both modes in one document | **real Firefox** | 80,000 chat layouts | line-range hashes equal | ATTACK/probe-timed-1 |
| My fonts probe (`tools/word-scan-fonts-probe.ts`): exact, premise, exact again | **real Firefox**, 131 font families, Latin, Arabic, Hebrew texts, 2 sizes x 14 widths, break-word | 13,412 layouts, 202,017 lines, 114,986 decided with the premise | 0 differ; 1 unstable (section 12) | ATTACK/probe-fonts-2 |
| Tier 2, five runs | **real Firefox** | 63,771 rows each | section 8 | ATTACK/tier2-* |

What the fuzzer draws that the owner's sources don't: U+00A0 and U+0020 before join controls and marks, U+3000, soft hyphens, tabs, segment breaks, U+200B, U+2060, U+2009, words over 32 characters, hyphens, URLs, Arabic with marks and tatweel, Hebrew, Han, kana, Thai, emoji sequences; words split over spans with other fonts, spacing and box edges; atomic inlines, `<br>`, `<wbr>`; every white-space, overflow-wrap, word-break and line-break value; letter and word spacing in both signs and wide (-30px, 20px); text-indent; both directions; justification; widths from 1 au up, and the widths where a break moves, found by bisection in mode exact, each with the au before and after it (Gecko compares integer app units).

The 16 faces with negative glyph advances: Geeza Pro (4), Noto Nastaliq Urdu (4), DecoType Nastaleeq Urdu, Diwan Thuluth, Farisi, Mishafi, Waseem (2): Arabic marks and kerned letters. And two Latin faces: Marker Felt face 1 (22 ASCII pairs: the first glyph of a kerned pair goes below zero: the apostrophe is -12/1000 em before a hyphen, the period -21 before a double quote) and Superclarendon face 3 (apostrophe -10 before `A`). In all of them the negative glyph is followed by a wide positive one, or a base takes back what its mark gives up, so no suffix is negative. That is how these fonts happen to be built. Nothing forces it.

### 4. The owner's differential and coverage, rerun

All exit 0, 0 differing layouts, 0 errors, and every number equals the owner's (ATTACK/rerun-diff-*.log):
- chat, plain ASCII, 10,000 messages x 4 widths: 124,166 lines; premise 95.7%, proven 3.3%, engine's loop 1.0%; calls a paragraph 82.58 to 23.63; kept, per fill 31.22 to 0.67; questions asked before on the page 95.1% and 99.1% in the last 1,000.
- chat, mix: 133,751 lines; 79.6%, 2.7%, 17.7%; 118.03 to 62.96; 29.44 to 2.47; 82.0% and 88.0%.
- real English used once: 88,010 lines; 86.6% and 2.4%. Eleven languages: 230,276 lines; 74.1% and 1.8%.
- random tree cases, shard 1 of 3, 12 widths, with `--checked`: 507,695 lines.
- tier corpus, shard 0 of 6, 7 widths: 297,667 lines; premise 23.6%, proven 17.1%.
- `overflow-wrap: normal`, mode proven, 3,000 messages x 4 widths: 96.6% of 36,262 lines, calls equal.
- Not finished: tier corpus at its own widths, shard 0 of 4. I stopped it after 80 minutes at my cutoff (the owner's first run of it took about 1.5 hours and had 0 differing).

### 5. The citations and the conditions as coded

I opened every citation the report's sections 2 and 4 lean on in the pinned source (`~/github/browser-engines/firefox-156.0`). All are as cited: `BreakAndMeasureText` gfxTextRun.cpp:922-1212 (natural break 1053, word-wrap candidate 1067-1073, break-spaces 1076-1082, accept 1090-1100, abort 1104-1108, per-character advance with spacing 1139-1151); `IsBoundarySpace` gfxFont.cpp:3317-3330; the character limit and `SpaceMayParticipateInShaping` :3735-3763; the word and the space shaped apart :3804-3861; signed advances with no clamp gfxHarfBuzzShaper.cpp:1699-1719 and gfxTextRun.h:780-800; `aCanWordWrap` nsTextFrame.cpp:11136-11139; the limit of 32, StaticPrefList.yaml:7931-7934.

The code tests C0 to C6 and C6' as the report states them: inspected paragraphs never take the word scan (`consulted !== null`), break-spaces refuses, scans must start and end at unit starts, trimmed runs must start at unit starts, the walk stops at a unit a removed soft hyphen stands in or before, a scan that would break inside a passed unit refuses. The report and the code agree with each other; both miss the word spacing of section 2.

One precision on the report's section 4. It says that after the narrowing (`advancesAreSuffixes`) every advance inside a unit is "the unit less a suffix Canvas measured". For joined letters whose sides don't add up, the whole advance can be the prefix's own width (`advance.ts` sidesAdvance, `joined-prefix`). It exceeds the unit only if W(letter U+200C U+200D suffix) is less than W(letter U+200C). That is a difference of two Canvas totals, not a suffix. No data shows it (census 0, fonts probe 0). The sentence is a little too strong, no more.

A second precision. The premise is about the port's numbers, which are estimates inside a word. Under a font whose kerning HarfBuzz splits between the two glyphs, the port adds half of whatever crosses the cut. A ligature of three or more letters that Canvas can't show as a group would then push the port's prefix past the word's end while the engine has no negative advance. In that case the word scan would be right and the engine's loop wrong. My fuzzer did not exercise this: its font puts kerning on the first glyph, and the port's placement probe stays undecided on it. I built no example.

### 6. Can the fast path disagree silently?

In production, yes. A plain paragraph carries no gaps, and a line decided through the premise carries no mark. A font that breaks the premise, or a shape like section 2, gives a wrong line and nothing says so.

In tests there are two nets, and they agree with each other.
- The checked mode compares all seven fields of the scan's record, scan by scan. The unit test runs it for one text, 3 overflow-wrap values, 238 widths. The function set with the checked library was run by hand by the owner, and now by me; it is not in `gates.ts`.
- The gates' own plain check needs no flag: it holds the plain path's lines and pieces against the inspected path's on 63,771 recorded cases with real answers, and the sweep does the same at 4 widths under the stand-in. The inspected path never takes the word scan, so this is a permanent differential.
- In my fuzz all 251 differing layouts made the checked mode throw, and none differed without a throw. So the checked mode sees what the end-to-end comparison sees.

Neither net would have found section 2: no such text is in any corpus. A seeded adversarial generator found it in its first full run (36,000 paragraphs, about 3 minutes on 6 cores). If the word scan lands, that generator belongs in the gates.

### 7. Counts and one timed sitting

Pinned Firefox 156, background window, device pixel ratio 2, the lock's `--exclusive`, the owner's probe at the branch tip, 10,000 messages, 4 rounds with the order turned each round (4 alternating pairs). The page's fixed arithmetic took 30 ms at the start and 27 ms at the end. Load average 44 falling to 26, not a quiet machine. ATTACK/probe-timed-1 (08:00 to 08:02).

| medians, ms (all four rounds within 6% of the median) | base (mode exact) | word scan (premise) | owner's two sittings |
|---|---|---|---|
| plain ASCII, from scratch, a list of contexts a message | 560 | 230 | 597/615 to 244/248 |
| plain ASCII, from scratch, one list | 433 | 179 | 460/476 to 186/192 |
| plain ASCII, kept, 30,000 layouts at 3 new widths | 591 | 98 | 645/668 to 116/110 |
| mix, from scratch, a list a message | 2,530 | 2,182 | 2,651/2,742 to 2,250/2,288 |
| mix, from scratch, one list | 2,411 | 2,095 | 2,452/2,494 to 2,166/2,177 |
| mix, kept, 30,000 layouts | 648 | 176 | 677/710 to 192/196 |

Counts, equal to the owner's: plain ASCII 84.92 to 23.72 `measureText` calls a message, 252.3 to 100.0 characters, 32.33 to 0.65 calls a layout at a new width. Mix 119.63 to 62.85 (the owner's 62.96 was taken before the soft-hyphen narrowing), 2,020.6 to 1,872.4 characters, 30.28 to 2.39. Lines decided by the word scan: 123,637 of 124,921 (99.0%) and 110,281 of 134,179 (82.2%). Line-range hashes equal in both modes.

### 8. Tier 2 in Firefox, completed

The owner lost three hours to lock contention. At 08:40 the machine was quiet and one tier 2 run took 97 to 135 seconds. All runs came from a clean detached worktree at cc76bd3 (the library is 1370bcf, the owner's final one); the worktree is removed again. Forward order only, which is enough for a speculative study.

- **Usual predictor (the inspected path), no-facts**: 63,771 cases, 0 status transitions against the frozen reference ledger, differing predicted values 239 to 239, rect counts 112 to 112, gate pass (lost 0, new 0). **With facts**: 0 transitions, 742 to 742, 100 to 100, gate pass. ATTACK/tier2-usual-*.log.
- **Plain predictor, word scan in mode premise, run twice, and once with the word scan off** (a predictor file in my scratchpad that sets mode exact). Against today's usual run as line ranges (`compare-sets.ts --prediction=line-ranges`): first premise run 120 native observations and 14 predictions differ; second premise run 187 and 21; **word scan off 206 and 21**. Every differing prediction sits on a case whose native observation differs too, and all of those cases are among the 319 the ledger already marks history-dependent. So the effect belongs to the plain path, which asks Canvas less and leaves the document another history. It is there with the word scan off, and it varies from run to run (the two premise runs differ from each other in 67 native observations and 7 line ranges).
- **The comparison that isolates the word scan**, premise against word scan off over 63,516 distinct cases: run one, 7 line ranges differ, all 7 on cases whose native observation differs; run two, 0 line ranges differ. **0 line ranges differ where the native observation is equal.** The plain run's line-count failures are the usual run's 129, none new.

### 9. Classification: the WebKit shape with proofs, or main under another name?

Neither.

What is logic of the engine: the walk over unit starts, the trimmed white space, the break priorities, the refusals. It is `BreakAndMeasureText` read unit by unit, with citations that check. Mode `proven` is that and nothing more, and it is exact: 0 differences in 4.5 million adversarial layouts, in the owner's 4 million lines, and on 63,771 recorded cases. It is a refactoring with a proof. Under `break-word` it buys nothing, as the owner says (3% of lines, no call saved).

What is not logic: mode `premise` leaves out a test the engine makes. Gecko tests every cluster of the line's first word; the word scan assumes those tests pass when the word's end fits. Two things have to hold for that.
- A fact about the engine: no spacing inside the word is negative. This part can be proven from the source. The owner got it wrong in one place, which gave real wrong lines. With the one-subtraction condition of section 2 it reads the engine's own spacing data and lists no characters.
- A belief about fonts: no suffix of a shaped word has a negative advance. No source gives it and no cheap Canvas question checks it; a check costs the very questions being saved. The evidence today is wide and clean: 0 of 1,229,216 recorded advances; 0 of 1,008 installed faces over 54,824 strings; 0 of 13,412 browser layouts over 131 families. But it is data about today's fonts. Sixteen installed faces do carry negative glyph advances, two of them Latin, and they pass only because of where the negative glyph sits. A font whose last glyph is negative breaks it, silently.

Against main: main fits corrections to data and widens by tolerance; when a new font or browser moves the numbers, main must be retuned. Here nothing is fitted and there is no number to retune. A new browser version costs what it costs the exact loop (the same function is ported twice, once per character and once per unit). A new font either satisfies the premise or gives a wrong line; there is no in-between and no warning. So the failure mode is main's in kind (silent, font-dependent), but the class is one inequality, and a font can be certified offline: my `hb-shape` scan is such a check, about ten minutes for every face on the machine.

Under the charter as written (a rule is a port of the engine's logic, or a Canvas-measured fact, or a named gap) the premise is none of the three. It could become one honestly: a font fact ("suffix advances are not negative") that the facts configuration supplies for fonts scanned offline, with unknown meaning the engine's loop. That costs the speed wherever no fact is given. The owner's other route, default true plus a named gap from the inspected path, keeps the speed but keeps the silent failure on plain paragraphs. Which one, or neither, is the maintainer's call.

### 10. Verdict per claim

| Owner's claim | Verdict |
|---|---|
| In Gecko there is nothing to compensate: words are shaped alone, the space is its own glyph, the port already sums one question per word; 66,743 of 66,745 | **Stands.** Rerun on real data; citations check. None of the 50 family lists in the recordings shows a font that shapes across the space |
| Every Canvas question of a fill is about an offset inside a word; under break-word they are the first word's clusters | **Stands** (code reading; counts: 32.3 to 0.65 calls a relayout) |
| Mode proven is exact by construction; 3% of chat lines under break-word, no call saved; 96.5% under overflow-wrap normal | **Stands.** 0 differences in my 4.5 million layouts; 96.6% rerun |
| With the premise: 99.0% of plain ASCII chat lines, 82% of the mix; the coverage tables | **Stands.** Rerun equal on the six sources I reran |
| The conditions C0 to C6' admit only lines equal to the exact port's, given the premise | **Doesn't stand as written; stands with one more condition.** Section 2: wrong lines in Firefox with no negative advance anywhere |
| "What is left of the premise is one thing", the sign of a measured suffix | **Stands with a correction**: the joined-prefix path and the split-kerning estimate, section 5. No data shows either |
| 0 violations in 1,229,216 advances; the unit test holds the premise's hole | **Stands.** Rerun equal |
| Firefox numbers: 0.60 to 0.25 s, 0.65 to 0.11 s, 2.65 to 2.25 s, 0.68 to 0.19 s; calls 84.9 to 23.7 and 119.6 to 63.0 | **Stands.** My sitting: 0.56 to 0.23, 0.59 to 0.10, 2.53 to 2.18, 0.65 to 0.18; counts equal |
| Offline: 0 differing over about 4 million lines; function set plain (checked), sweep pass | **Stands.** I did not rerun pure, tier 1 or the two-trees run |
| Tier 2 not done | **Now done**, section 8: nothing against the word scan |
| The lazy plain scan could go if the word scan lands | **Not rechecked** (the owner's scratch copy is gone) |
| Verdict: WebKit shape for plain text, the gain under break-word rests on a premise, the maintainer's call | **Stands**, with the correction that reading the engine was not enough to get the conditions right: they need an adversarial generator in the gates |

### 11. Should this go to the maintainer as the next big step?

As a decision, yes. As the next big step, no.

- For Gecko the maintainer's question has a plain answer. Breaking words like WebKit and compensating on top is not needed, because Gecko is already that engine and the port already sums word facts: a string with spaces is the sum of its parts at 66,743 of 66,745 real strings, by construction of Gecko's word cache. What costs Canvas calls is not what crosses a word boundary. It is the engine's own tests inside the first word of each line under `break-word`.
- From scratch the word scan doesn't change where Firefox stands. Plain ASCII: 0.56 s before, 0.23 s after, both under the 2 s bar. Mix: 2.53 to 2.18 s, still at the bar, because a Chinese message is one unit and the word scan refuses every line inside it. The big step for Gecko from scratch is `x-perf-gecko-fill`.
- For kept paragraphs it is a real gain: 0.59 to 0.10 s per 30,000 layouts, 42 times main's 0.014 s down to 7 times. What is left is the reflow's objects around the scan, as the owner says.
- What to put in front of the maintainer: (1) the premise, yes or no, and if yes in which form (a font fact with the engine's loop as the default, or a default with a gap); (2) if yes: the one-line spacing condition first, then `tools/word-scan-attack.ts` as a gate, then one mode and no counters in `wordScanState`; (3) if no: mode `proven` alone is safe to land and is worth about 40% of a relayout under `overflow-wrap: normal` and nothing under `break-word`.

### 12. Side findings

- **Canvas answered the same string differently within one document.** 16px SignPainter, `~~`: 1,038 au for one prepare, 628 au for the next prepare and by direct `measureText` (ATTACK/probe-debug-1). The first fonts probe counted it as a difference; mode `proven` gave the same "wrong" lines, which showed it wasn't the scan. The probe now runs the engine's loop before and after the word scan and calls such a layout unstable. It looks like a fallback font's answer changing with the document's history. It concerns the whole port, not this study.
- **The plain predictor's rows can't be held against a usual run row for row on history-dependent cases**, with or without the word scan: 120 to 206 native observations differ per run, all inside the ledger's 319.
- **Tier 2 for Firefox takes two minutes on a quiet machine.** Every hour beyond that is the lock.
- The owner's `rebuild/tools/word-scan-space-identity.ts` line 69 holds a literal U+00A0 inside a regular expression (the escape caveat). It works; it can't be seen. The same caveat hit my first drafts; my committed files build invisible characters from code points.

### 13. Files

Commits on `x-spec-words-gecko`, new files only:
- c4ad715 `rebuild/src/engines/gecko/word-scan-attack.test.ts`: the counterexample as a unit test.
- 372a9f0, cc76bd3, 0581576 `rebuild/tools/word-scan-attack.ts`: the fuzzer (`--seed`, `--count`, `--no-spaced-nbsp`, `--focus`, `--all-lines`, `--out`). Exit 1 when anything differs or the checked mode throws.
- a4bfffb `rebuild/tools/word-scan-fonts-probe.ts` and `word-scan-fonts-probe-entry.ts`: exact against premise in the browser over installed font families.

`bun tsc -p rebuild/tsconfig.json` exits 0, the citation ledger check exits 0, the Gecko unit tests pass (101).

Not committed, in my scratchpad folder `words-gecko-attack`: `font-scan.py` and its word list (the HarfBuzz scan), `make-cases.ts` and `attack-cases.ndjson` (the 84 lab cases), `plain-exact-predictor.ts`, `plain-vs-plain.py`, the debug probe, and the two scratch copies `fixcopy` and `fixcopy2` with the hole closed.

## Words study, Blink (Chrome): word facts where they equal the port (2026-09-20, speculative, unmerged)

Branch `x-spec-words-blink`, base afb5a63. Every run is under `.artifacts/tests/runs/spec-words-blink-20260920/` (R/ below). "Base" is afb5a63. "Prototype" is 9e9efac (the library; its two earlier forms, 62699bf and 1897131, were narrowed by what the tests found, section 5). "Stand-in" numbers come from the offline stand-in Canvas, which is no font. "Chrome" numbers are the pinned Chrome's. A "layout" is one paragraph at one width.

### 1. The answer

The maintainer asked whether breaking words like WebKit and compensating on top is viable for Chromium, or the road back to main. **It is viable, and it isn't main's road, as long as the word sum is the port's one recipe and not a second answer beside it.**

- **The shape.** A shaping group is cut after every space into words with their trailing spaces, before anything is measured, and between two pieces the port adds the one thing that crosses a space in an engine that shapes a run whole: the pair adjustment between the space and the cluster after it, measured in Canvas. That is the port's own rule for the cut of a group of 256 zoomed px (profiling item 6, B1b), made at every space. Positions at the edges of words are then sums kept on the prepared paragraph, and a plain line that ends between two words finds its break from those sums by arithmetic, where today a binary search over every offset asks Canvas about 4 questions a probe. Every other line, and everything after the candidate on every line, runs the code it always ran.
- **Why not a fast path beside the exact one.** A sum of word facts equals the port's long prefixes only by a property of the font, which no program can test without asking the long strings. Two recipes for one position are two sources of truth. So there is one table, read two ways, and the equality of the two readings is logic that no font can break.
- **Numbers, pinned Chrome, 10,000 chat messages, three alternating pairs** (section 8): from scratch with a list of contexts a message 3.43 s to **2.37 s** on the mix and 2.91 s to **1.80 s** on plain ASCII; with the caller's one list of contexts 2.04 s to **0.84 s** and 1.80 s to **0.51 s**; kept paragraphs at three new widths (30,000 layouts) 3.00 s to **0.85 s** and 2.34 s to **0.44 s**, and at widths they have met 0.12 s (ASCII) and 0.39 s (mix) by the smoke's rows. `measureText` calls a message: 199 to 114 on the mix, 194 to 94 on ASCII. Characters sent (stand-in): 1,631 to 396 a message on ASCII, and strings new to the page 30 to 2.7.
- **Coverage** (section 6): on English chat text 97.7% of lines never search and 85.6% of messages at all four widths; on the bench's mix 81.7% and 64.9%; on eleven languages used once 58.0% and 51.9%. What stays on the search: text without spaces, right-to-left items, words without a script of their own, soft hyphens, hyphenated words that overflow, letter spacing, a first word that overflows.
- **Proof so far.** Offline: 0 of 316,645 recorded Chrome positions off for the identity without letter spacing; 0 of 116,670 random tree layouts and 0 of 169,660 tier layouts (their own widths and three others) differ between base and prototype on the plain path; checked runs over 960,000 lines threw nothing. The tests narrowed the conditions three times on the way (negative word spacing, soft hyphens, a script rule), which is the reason to keep them as gates. In Chrome: tier 2 without facts on 14 of 15 sets (47,071 cases, the form before the soft hyphen rule) shows 0 status transitions and no exact value worse against the frozen ledger; the final form has 5 sets (5,844 cases), the same. Tier 2 with facts, the largest set and the checked plain predictor's browser run did not get a slot in time (section 9).
- **The honest limit.** Nothing here proves that in a user's font nothing but the pair beside a space crosses it. The base port sees such a thing inside a line because it measures long strings; word pieces don't, and a plain paragraph doesn't look. An inspected paragraph reports it at the cut. It is an assumption about fonts with a record of 0 misses, a named gap, and a known price for checking it (one two-word question a cut, about twice the strings new to a page). Main has the same blind spot with nothing naming it. What this does not have is main's other half: constants, tolerances and corrections found by fitting.

### 2. Why a fill asks about 125 questions inside words, and what the engine needs there

Counted with `tools/store-study.ts --part=sites` over 1,000 ASCII chat messages at 320 px, stand-in (R/sites-base-latin.json; a question's class is read from the call's stack).

| base, a message | asks | what it is |
|---|---:|---|
| fill, positions: pair window | 74.9 | `pairAdjust16` under `groupPrefix16`: three strings of 1 or 2 units for the kern between the two clusters around an offset |
| fill, positions: prefix from the last cut | 25.9 | `measure16(cut, k)` under `groupPrefix16`, 5.5 units on average |
| fill, positions before a space: wide window | 23.9 | `windowAdjust16`: the piece, its part before the space and its part after it |
| fill, safe test at a wrapped line start | 15.7 | `safeToBreak`: the wide window (8.6) and the pair window (7.1) |
| fill, line-edge reshapes | 0.1 | |
| prepare: piece totals and cut adjustments | 51.7 | |
| font checks | 10.0 | |

- 124.7 of the fill's 140.7 questions are positions, and nearly all of those are probes of one binary search. `offsetForPosition` (the port of `ShapeResult::CachedOffsetForPosition`, shape_result.cc:2261-2323, the loop at :2305-2320) looks for the last offset whose position isn't past the line's end, over every offset of the item. Each probe reads one or two positions, and a position costs a prefix and a pair window, or a wide window before a space: 4 Canvas questions. The rest are the line's own two edges (`positionForOffset` for the start, `floatWidthOfParts` for the view).
- The engine shaped the item once (HarfBuzzShaper over the whole run: inline_node.cc:1636-1717, harfbuzz_shaper.cc:880-1101) and keeps a position per character. `ShapingLineBreaker::ShapeLine` reads the start's position, asks `FirstSafeOffset` for a wrapped line's first safe offset (shaping_line_breaker.cc:91, :310), finds the candidate with `CachedOffsetForPosition(end_position)` (:332-333), and from there reads text alone: whether HanKerning may trim the character at the candidate (:345-347), whether it is a breakable space, and the break opportunity before or after it (:392-425). `LineBreaker::BreakText` sets `dont_reshape_end_if_at_space_` unless the line needs an accurate end position (line_breaker.cc:1655-1659, with Blink's own comment: "kerning between trailing spaces is not visible"; :255-267 for what needs one: text-align other than start or left, or a border on the item's box). Then a break that follows a space isn't reshaped (shaping_line_breaker.cc:484-488), and the trailing space is no part of the line's width (`HandleTrailingSpaces`, line_breaker.cc:2418-2534).
- So for a line that starts at a safe offset and breaks at a space, the engine shapes nothing and reads four things: the start's position, its safe flag, a sorted array, and the position where the last word ends. The array's only use is to say which word the available width ends in. The port's 125 questions are the price of not having the array. None of them is something the engine needs there.

### 3. When a sum of word facts is the engine's answer

**What the engine says.** The run is shaped whole, so a glyph's advance may depend on any glyph of the run. HarfBuzz itself says where it doesn't: a glyph not flagged unsafe-to-break starts a stretch that shapes alone exactly as it shapes in the run (hb-buffer.hh:517-527), and Blink reshapes a line start or end only up to the nearest such offset (shaping_line_breaker.cc:310-324, 523-553). So where the offset after a space is safe, the position of the word's start is the width of everything before it shaped alone, and by induction a group whose word starts are all safe is the sum of its words, each with its space. Where a word start is unsafe only because the space glyph and the next glyph form a kerning pair, the group is that sum plus the pair's adjustment at each such boundary. That is the whole identity: **word with its trailing spaces, plus the pair adjustment between a space and the cluster after it**. A ligature can't cross a space ("f i" is two clusters with a space cluster between them), and what a word's last letter does before a space (a kern with the space glyph, a final form) is inside the piece, because the piece holds the space.

**What Canvas can and can't show of it.** The flag is invisible to Canvas. What Canvas shows is widths: the pair window `W(s c) - W(s) - W(c)` (the adjustment), and the wide window over two neighbouring pieces, `W(w1 s w2 s) - W(w1 s) - W(w2 s)`, which equals the pair's adjustment exactly when nothing else crosses the space inside those two words. The port already has both, for its cut of a group of 256 zoomed px: `measureGroups` adds the pair window at the cut, and `gaps.ts cutAdjustment` asks the wide window on an inspected paragraph and reports `unsafe-to-break` where it shows something else; a plain paragraph asks nothing for it (profiling item 6, B1b). Word pieces are that rule made at every space. Canvas's own word cache is no proof of the identity: `Font::CanShapeWordByWord` reads GPOS and GSUB lookups for the space glyph alone (harfbuzz_face.cc:322-390, font_fallback_list.cc:264-286), and the fonts that kern with the space through `kern` or `kerx` are why the port writes U+2028 for a space in the first place.

**So the identity rests on a property of the font that a plain paragraph does not check:** nothing but the pair beside a space crosses it. The base port rests on the same property at every cut and at every word start it reads (a position is a prefix measured alone plus the pair window), but it measures long prefixes, so whatever crosses a space between two words in the middle of a line is inside its strings. Word pieces give that up. What stands for it:
- The recorded Chrome answers (`tools/words-identity.ts`, R/words-identity-no-facts.json): wherever one recorded canvas holds a whole below 256 px with a space inside, both sides, the pair after the space and its two clusters, `W(L s R) = W(L s) + W(R) + d` was tried in 16.16 units. 331,485 positions in 24,416 cases. **Without letter spacing: 0 of 316,645 off**, of them 109,649 right to left and 9,903 with a side that holds no script of its own. Under letter spacing 1,502 of 14,840 are off (1,482 of them right to left), each by a whole number of spacings: Canvas gives a character its spacing by the script its own segmenter gives the string. Hence condition A1.
- An inspected paragraph asks the wide window at every word cut and reports the gap, so the lab's path, which tier 2 scores against the browser, can't hide a font that breaks the identity.
- What it would cost to check on plain paragraphs too: one two-word string a cut. On the bench's ASCII generator that is 19 to 21 more questions a message, of which 89% are new to the page in the first 100 messages, 61% up to 1,000 and 34% up to 2,500 (scratch count, not committed). It would roughly double the strings new to the page. I did not build it.

**The three conditions the text itself must meet, each from how Canvas measures a piece alone** (shape.ts `wordCuts`):
- *A script of its own on each side of the cut.* Canvas resolves a Common or Inherited character over the measured string alone: from the script before it, or from the one after it where the string starts with it (script_run_iterator.cc; plain_text_node.cc:372-425). The paragraph resolves it over the whole text. A word of brackets or digits, a quote that opens a Latin word after a Greek one, a bracket that closes after it: measured in a piece of its own it takes another script than in its run (the port's `script-context` gap; the store study's 818 of 28,774 recorded positions, Amiri's brackets). So the stretch of one script on each side of a cut must hold a character with a script of its own, and a stretch that doesn't stays in one piece with the word that gives it its script.
- *No letter spacing* (above).
- *None of the default-ignorable characters the port writes in two ways.* `canvasString` leaves SHY, ZWSP, LRM, RLM, U+202A..U+202E and U+FEFF out of a one-byte string and writes U+2060 in a two-byte one (research/BLINK-STRING-STORAGE.md; gap `soft-hyphen-shaping`). A piece with its space is two-byte (U+2028) and a word alone can be one-byte, so word cuts would change which way each word of such a group is measured. The group keeps the cuts it has without them. I did not derive this one: the random tree cases found it (section 5).

**Which Canvas context is asked what** doesn't change: every question still goes through `measure16`, which sends a two-byte string to the style's contexts and a one-byte one to the one-byte contexts of a segmented paragraph (`contextsOf`). A piece with its space is always two-byte. A Latin word alone is one-byte. A store of word facts on a context would therefore need no key beyond the context and the string, as long as it sits on the context the port already picked.

### 4. The conditions, as the code tests them

**A. Where a group is cut into words** (at prepare, from the text alone):
1. the group's style has no letter spacing;
2. the offset follows U+0020 and doesn't hold one;
3. glyph clusters part there and no letters join across it (`isClusterBoundary`, `joinsAcross`: `addPieces`'s own test);
4. on each side, the stretch of the word that the paragraph shapes under one script holds a character whose Script isn't Common or Inherited;
5. the group holds none of SHY, ZWSP, LRM, RLM, U+202A..U+202E, U+FEFF.

A word of 256 zoomed px or more is cut further by the rule the port has.

**B. Where a line's candidate comes from the words' edges** (at fill, line by line; `wordCandidate`):
1. the paragraph is prepared plain, and the item is a text item of a shaping group, left to right;
2. the line's end position lies inside the item (otherwise the search reads no position either);
3. the group's cut positions never run backwards, and its style has no negative word or letter spacing;
4. from the last cut whose position isn't past the end position (or from the line's start) there is one word, with no white space, no SHY and no character HanKerning may trim at a line end, then one U+0020, then the next cut; or the word runs to the item's end;
5. the word's end position lies between its two cuts' positions;
6. then, if the word's end isn't past the end position, the candidate is the space after it, which is the offset the search finds; else, if the word isn't the line's first and holds no break opportunity after its start, the word's start stands for the candidate: `ShapeLine` reads three things of a candidate (section 2), and they are the same for every offset of such a word.

Everything after the candidate is the code it always was: the break opportunity, the view, the trailing space, overflow and rewinds. So (b) of the brief, the line's width and every position handed out, holds by construction: the same functions read the same table.

**The premise that isn't checked:** positions inside words are sorted, which is the premise of Blink's own binary search and holds while no glyph cluster has a negative advance. What the words show of it is checked (B3, B5). The checked run holds the rest against the search on every line it is run on.

**What the conditions leave to the search** (the excluded lines, by the code's own reasons; shares in section 6): a line whose first word overflows (break-word, anywhere, break-all, text without spaces); right-to-left items; a cut that isn't after a space at either end of the unit (a long word's or a spaceless text's 256 px cuts, and every group without word cuts: letter spacing, SHY and its kin); a word that holds SHY or a HanKerning close mark; more than one word between two cuts (a word without a script of its own beside it, several spaces, a tab or U+3000); a break opportunity inside the word that overflows (hyphens, slashes, CJK); negative spacing; tab runs. Lines that need an accurate end position (text-align end, center, justify or right; a bordered span), inline box edges, atomic inlines, hyphens and bidi reordering are not excluded: the candidate is all that changed, and the rest of `ShapeLine` and `LineBreaker` runs as before.

### 5. The tests without a browser, and what they found

Three times a test showed a condition too wide. Each time the condition was narrowed, never loosened by a tolerance.

| what | result | file |
|---|---|---|
| the identity on recorded Chrome answers | 0 of 316,645 off without letter spacing; 1,502 of 14,840 off with it | R/words-identity-no-facts.json |
| base against the first form (03a1c1e), usual predictor (the inspected path, so word pieces alone), 15 tier sets at their own widths, gap lists left out | 0 of 42,415 layouts differ; with gap lists 308 of 5,505 differ on four sets, every one first in a gap list | R/tt-usual-all-own.json, R/tt-pieces-dev-own.json |
| the first checked sweep (function-set `sweep` with `PRETEXT_WORDS_CHECKED=1`, 4 sets) | **1 of 5,504 cases threw**: c-b843378637d525b1, negative word spacing, where a word's end lies past the next word's start and the search turns the other way. Narrowed: B3 and B5. Then 5,504 pass | R/sweep-checked-dev.log |
| base against 1897131, plain predictor on both sides, 19,445 seeded random tree cases at 6 widths | **10 of 116,670 layouts differ**, every one in text with soft hyphens: the port writes SHY in two ways by the string's storage, the tools' stand-in kerns across one form and not the other, and word cuts change which strings are two-byte. Narrowed: A5. The checked run did not throw on them: the candidate was right, the pieces moved the positions | R/v2-tt-plain-tree-widths.json |
| the script rule A4 in its first form (a script somewhere in each of the two words) | narrowed by reasoning, not by a failing test, to the stretch of one script beside the cut; costs under 0.1% of lines | commit 1897131 |
| base against the prototype (9e9efac), plain predictor both sides: random tree cases at 6 widths; 15 tier sets at their own widths; the same at 100, 220 and 420 px | **0 of 116,670** random tree layouts differ; **0 of 42,415** tier layouts at their own widths; **0 of 127,245** at the three other widths | R/v3-tt-plain-*.json |
| base against the prototype, usual predictor, gap lists left out: 15 tier sets; random tree cases at 3 widths | not reached at 9e9efac (it had just started when I stopped for time). At 1897131: 0 of 7,219 on six sets; at 03a1c1e: 0 of 42,415 on all 15 | R/v2-tt-usual-dev.json, R/tt-usual-all-own.json |
| checked runs of the prototype, every candidate from words held against the search: bench ASCII and mix (10,000 messages at 4 widths each), English used once (2,336), eleven languages used once (6,468) | no candidate differs: 395,762 lines, all four exit 0. The same over the 15 tier sets at their own widths (168,102 lines) and the random tree cases at 3 widths (396,769 lines): no error | R/v3-cover-*-checked.json, R/v3-coverage-*.json |
| the function set's full `sweep`, checked, all 15 sets | **67,065 pass, 0 fail, 0 skipped** (one prepared paragraph at four widths against fresh ones, plain and inspected; 537 million stand-in answers) | R/v3-fs-sweep-checked.log |
| function set `plain` and `pure` under replay (at 1897131) | 33,095 pass, 0 fail, 33,970 skipped each: the skipped cases ask strings no record holds | R/v2-fs-plain.log, R/v2-fs-pure.log |
| tier 1 replay (at 62699bf) | 23,226 of 67,065 the same; 605 predictions changed, every one first in a gap list and all 605 pass with exact values in the ledger; 9,249 ask other questions with the same prediction; 33,985 ask a string the record lacks | R/tier1-no-facts.log |
| unit tests | 129 Blink tests pass (7 new in `words.test.ts`); `bun test rebuild`: 878 pass, 6 fail, of which 5 were 5 s timeouts at a load of 45 (their 4 files pass alone, 29 tests) and 1 was mine (the checked predictor imported engine code; fixed in a620f39) | R/unit-all.log, R/unit-rerun.log |
| tsc over the six projects; citations check | clean; exit 0 | R/tsc-all.log, R/citations.log |

- The changed gap lists are the B1b kind: the same ranges are reported, by the paragraph in one tree and by a line in the other, because another function measures a range first. On 5,205 cases of three sets, 252 change their lists (scratch tally). It is still a change of what the library reports, so word pieces are a change of recipe: tier 1 can't pass before a new recording, as with B1b.
- What the stand-in can and can't show: it kerns pairs and knows no context beyond a pair, so "pieces plus pair adjustments equal the whole" holds in it by construction. The differential runs prove the logic (the cuts, the tables, the candidate, the LayoutUnit arithmetic), not the fonts. The fonts are the identity check's and the browser's business.

### 6. Coverage: what the conditions admit

A line is "from words" when its candidate came from the words' edges, "no search" when the rest of the item fit and no position was searched (mostly last lines), and "searched" when `offsetForPosition` ran. All are checked runs of the prototype (9e9efac) under the stand-in; a paragraph counts when no line of it at any of the widths was searched.

| corpus | lines | from words | no search | searched | paragraphs never searched |
|---|---:|---:|---:|---:|---:|
| bench ASCII, 10,000 messages at 4 widths | 136,934 | 68.5% | 29.2% | 2.3% | 8,558 of 10,000 (85.6%) |
| bench mix, 10,000 messages at 4 widths | 145,129 | 54.1% | 27.6% | 18.4% | 6,492 of 10,000 (64.9%) |
| English used once, 2,336 messages at 4 widths | 31,438 | 68.0% | 29.7% | 2.3% | 1,999 of 2,336 (85.6%) |
| eleven languages used once, 6,468 messages at 4 widths | 82,261 | 26.5% | 31.5% | 42.1% | 3,355 of 6,468 (51.9%) |
| tier corpus, 15 sets at their own widths | 168,102 | 9.4% | 21.8% | 68.8% | 9,387 of 42,415 (22.1%) |
| 19,445 seeded random tree cases at 24, 96 and 300 px | 396,769 | 1.8% | 31.4% | 66.8% | 27,598 of 58,335 (47.3%) |

By script at the line's start, the mix (R/v3-cover-bench-mix-checked.json): Latin 121,405 lines, 93.0% without a search; Han 17,914 lines, 16.8%; Arabic 5,108 lines, 41.3% (last lines alone). The eleven languages used once (R/v3-cover-languages-once-checked.json): Latin 31,745 lines, 93.0% without a search; Devanagari 96.5%; Hangul 38.4%; Thai 38.3%; Arabic 32.5% and Hebrew 30.1%, which are their last lines; Han 18.2%.

What the searched lines are, as shares of all lines:

| reason | bench ASCII | bench mix | languages once | tier corpus, own widths |
|---|---:|---:|---:|---:|
| more than one word between two cuts (a word without a script of its own, several spaces, a tab) | 1.4% | 1.7% | 0.1% | 1.8% |
| a break opportunity inside the word that overflows (hyphen, slash, CJK) | 0.5% | 0.7% | 3.8% | 2.8% |
| the unit ends at a cut that isn't after a space (long words, text without spaces, groups without word cuts) | 0.2% | 0.6% | 1.7% | 8.3% |
| the unit starts at such a cut | 0.2% | 12.7% | 8.4% | 11.4% |
| a right-to-left item | 0.0% | 2.1% | 25.8% | 14.3% |
| a soft hyphen or a HanKerning close mark in the word | 0.0% | 0.5% | 2.2% | 8.1% |
| the line's first word overflows | 0.0% | 0.0% | 0.0% | 17.5% |
| white space starts the unit | 0.0% | 0.0% | 0.0% | 1.1% |
| negative spacing, or cuts that run backwards | 0.0% | 0.0% | 0.0% | 3.2% |
| a tab run | 0.0% | 0.0% | 0.0% | 0.3% |

- On English chat text the conditions admit 97.7% of lines and 85.6% of messages at all four widths. What is left there is three things: a word without a script of its own beside the break ("-", "320,", 1.4%), a hyphenated word that overflows (0.5%) and words of 256 zoomed px or more (0.4%).
- Text without spaces (Chinese, Japanese, Thai) and right-to-left items get nothing from the candidate. Right-to-left could be built the same way (the search has a mirrored branch, shape_result.cc:2309-2313); I left it out to keep the proof small.
- The tier corpus is adversarial and narrow: 17.5% of its lines overflow their first word.

### 7. Counts: Canvas calls a message and characters sent

**Stand-in**, `tools/store-real-text.ts` (extended: several widths on one prepared paragraph, asks and UTF-16 units sent per layout). Every message is prepared from scratch with its font checks and filled at 320 px, then the kept paragraph is filled at 260, 380 and 440 px. "New" is a string new to the page under its context's settings, which is what a store on the context would miss. Base, then prototype (R/cover-*-base.json, R/v3-cover-*-proto.json).

| a message | from scratch: asks | units sent | new strings | new units | kept, at 260 / 380 / 440: asks |
|---|---|---|---|---|---|
| bench ASCII (10,000) | 224.0 to 99.1 | 1631 to 396 | 30.1 to 2.7 | 757 to 25 | 199.8 / 127.2 / 107.4 to 28.0 / 14.0 / 10.9 |
| bench mix (10,000) | 244.2 to 128.4 | 1624 to 511 | 33.0 to 8.0 | 756 to 93 | 221.5 / 141.4 / 118.6 to 61.9 / 35.7 / 29.0 |
| English used once (2,336) | 218.4 to 96.5 | 1584 to 388 | 41.4 to 8.5 | 862 to 77 | 194.7 / 123.1 / 104.0 to 27.7 / 13.3 / 10.7 |
| eleven languages used once (6,468) | 216.1 to 146.6 | 1504 to 550 | 41.9 to 16.8 | 817 to 159 | 188.9 / 122.5 / 104.2 to 85.3 / 53.7 / 45.9 |

- By what is asked, 1,000 ASCII messages (R/sites-base-latin.json, R/v3-sites-latin.json): the fill goes from 140.7 to 23.9 asks a message (the search's positions from 124.7 to 16.0; safe tests from 15.7 to 7.8), and prepare from 51.7 to 58.1: piece totals 18.9 asks of 29.9 units become 19.6 of 5.5 units, and the pair window at the cuts goes from 14.7 to 37.8 asks of 1.5 units. Strings new to the page: 42.5 to 9.9 a message over the first 1,000.
- The words repeat across messages. With the caller's kept contexts, a store by context and string would answer most of them: on English text used once, a message from scratch sends 8.5 strings new to the page of its 96.5 questions where the base sends 41.4 of 218.4, and 25 to 77 new units where the base sends 757 to 862. Over all four widths the share of questions already met on the page is 79.9% in the first 100 messages and 91.5% in the last 336 of 2,336 (R/v3-cover-ascii-once-proto.json). On the mix it is 8.0 new strings a message, on eleven languages used once 16.8. I counted and built no store.
- Device pixel ratio (at 62699bf, ASCII, 1,000 messages, from scratch): 165.5 to 81.5 asks a message at a ratio of 1, 224.0 to 99.1 at 2, 229.7 to 100.6 at 3 (R/dpr*.json). Word pieces don't grow with the ratio, because a word stays under 256 zoomed px.

**Pinned Chrome**, the bench's chat smoke of 200 messages, `measureText` calls a message by phase (font checks / engine prepare / fill; R/counts-chrome-base, R/counts-chrome-proto; the prototype's run is of 62699bf, before the narrowings, which don't touch these messages' cuts but for the 0.2% with a soft hyphen; the six timed runs at 9e9efac and afb5a63 count the same):

| | base | prototype |
|---|---|---|
| the mix | 10.7 / 49.8 / 138.7 = 199.2 | 10.7 / 60.5 / 43.0 = 114.2 |
| plain ASCII | 10.0 / 49.8 / 133.8 = 193.6 | 10.0 / 62.2 / 21.5 = 93.7 |

The lines are the same in both trees (1,410 and 1,240 at 320 px over 400 messages). The stand-in's counts are close to Chrome's here (92 to 99 against 93.7 for ASCII), where they ran 21 to 32% high before the cut search went. The bench doesn't count characters sent; the units above are the stand-in's.

**Bytes.** Per piece, which is per word: `cuts`, `prefixAtCut`, `positionAtCut`, `adjustAtCut`, `totals`, `positionAtWordEnd` (8 bytes each as doubles), `wordEnds` (4) and `safeAtCut` (1): 53 bytes a word, against 16 a piece before, and a group has five arrays and three typed arrays where it had two arrays. For a chat message of 20 words that is about 1.1 KB of entries and a few hundred bytes of array headers. Measured under bun (JavaScriptCore, 2,000 kept ASCII messages after one fill, heap plus array buffers): 10.9 KB a kept message in the base and 9.2 KB in the prototype, so the tables are inside the noise of what a prepared paragraph weighs already. Nothing outlives the prepared paragraph and nothing is found by string: it is data flow, and the two fields written after `prepare` (the word end's position, the safe flag) are facts of the text and the fonts that no width changes, like Gecko's per-offset records (DESIGN.md §4.6).

### 8. Time

One exclusive stretch in the pinned Chrome (background window, AC power, device pixel ratio 2), base and prototype taking turns, three pairs: `rebuild/bench/run.ts --smoke --scenarios=chat --headline=10000 --headline-passes=2` from two clean detached worktrees (R/timed-stretch.sh, R/timed-s1.log, R/timed-s1-1-base … R/timed-s1-6-proto). The 1-minute load was 34 before the first run and 24 to 26 before the others: other agents' offline work, mine was stopped for the stretch. The page's fixed arithmetic took 26.5 to 28.2 ms at both ends of all six runs, so the page ran at a quiet machine's speed. **The stretch took 18.5 minutes (06:43:26 to 07:01:52), over the 12-minute rule**: a run took 145 to 225 s where I had planned 125 s from another stretch's log and not from a smoke of my own under tonight's load. That is my mistake, and others waited for it.

Each cell: the median of a run's two passes, for the three runs of a side, then the median of the three.

| 10,000 chat messages, ms | base | prototype | ratio |
|---|---|---|---:|
| from scratch, the mix, a list of contexts a message | 3405, 3425, 5362: **3425** | 2351, 2406, 2371: **2371** | 0.69 |
| from scratch, plain ASCII, a list a message | 2742, 3144, 2912: **2912** | 1782, 1811, 1796: **1796** | 0.62 |
| from scratch, the mix, the caller's one list for the pass | 2043, 2015, 2090: **2043** | 844, 864, 835: **844** | 0.41 |
| from scratch, plain ASCII, one list for the pass | 1803, 1780, 1811: **1803** | 510, 508, 484: **508** | 0.28 |
| kept, then 3 new widths (30,000 layouts), the mix | 2834, 3038, 2997: **2997** | 849, 839, 853: **849** | 0.28 |
| kept, then 3 new widths, plain ASCII | 2100, 2335, 2483: **2335** | 449, 430, 439: **439** | 0.19 |
| the same with one list of contexts: mix / ASCII | 2914 / 2583 | 735 / 373 | 0.25 / 0.14 |
| main, cold prepare: mix / ASCII; main, 3 widths | 346 / 195; 9 | 338 / 193; 9 | |

- One base pass of the mix took 7,499 ms (run 5); its run's other pass took 3,225 ms. The medians hide it, the spread doesn't: base 3,137 to 7,499 ms, prototype 2,312 to 2,443 ms over six passes each.
- The kept rows are one measurement a run, three a side. The spread is small on the prototype's side (839 to 853, 430 to 449).
- From the smoke's rows of 200 messages (600 layouts, medians of their samples, three runs a side): at widths a kept paragraph has met before, plain ASCII goes from 29 to 35 ms to **2.2 to 2.4 ms** (3.8 µs a layout, 0.12 s per 30,000), and the mix from 31 to 32 ms to 7.3 to 8.8 ms (0.39 s per 30,000). At new widths ASCII goes from 32 to 42 ms to 7.4 to 8.2 ms and the mix from 37 to 41 ms to 12.3 to 17.0 ms.
- `measureText` calls a message are the counts run's in every run: 199.2 to 114.2 on the mix and 193.6 to 93.7 on plain ASCII. The lines are the same in both trees in every run (35,076 and 32,549 at 320 px).

### 9. The browser proof

Tonight's browser queue was the limit: other agents' exclusive timed stretches followed one another, my jobs waited 30 minutes for a slot more than once, and the prototype changed twice while they waited. What ran, in the pinned Chrome 153.0.8010.50, background windows, forward order (enough for a speculative study, as the brief says; a landing needs both orders, facts, and a new recording):

| what | commit | result | file |
|---|---|---|---|
| tier 2 without facts, usual predictor (the inspected path: word pieces, not the candidate), 14 of 15 sets: everything but `suite-sample` | 1897131 | **47,071 cases against the frozen reference ledger: 0 status transitions, 0 from a pass; exact values: 0 cases worse, differing predicted values 246 to 246, rect counts 860 to 860; limited values 92,081 to 92,081; gate: lost 0, new 0** (19,962 cases missing: the set left out) | R/chrome-no-facts-1897131-14sets.log, R/chrome-no-facts-1897131/ledger |
| the same, the 5 sets that finished before I had to stop (smoke-hand, smoke, runs, policy, rich-prewrap) | 9e9efac | 5,844 cases: 0 status transitions; exact values 0 worse (25 to 25, 17 to 17); limited 7,132 to 7,132; gate lost 0 | R/chrome-no-facts-9e9efac-5sets.log |
| the chat smoke's counts and lines, base and prototype | afb5a63, 62699bf | calls a message in section 7; the same lines in both trees | R/counts-chrome-base, R/counts-chrome-proto |
| the timed stretch, three pairs | afb5a63, 9e9efac | section 8; the same lines in both trees in all six runs (35,076 and 32,549 over 10,000 messages each) | R/timed-s1-* |

- How the first row came about: the 1897131 run ended with exit 2 because 2 of its 19 jobs (`suite-sample` parts 1 and 2) failed before any browser work: `spawnSync sw_vers ETIMEDOUT` in `lab/browser-build.ts` `readBuild`, a 15 s timeout on a machine at a load of 50 to 70. I didn't run them again: by then the soft hyphen finding had changed the library. The 14 sets whose jobs had all finished were scored afterwards with `browser-sets.ts --sets=…` on the same folder, which takes no browser. 1897131 and 9e9efac differ only in groups that hold SHY, ZWSP, LRM, RLM, U+202A..U+202E or U+FEFF, which lose their word cuts in 9e9efac and are measured as the base measures them.
- **Not run, for time:** tier 2 with facts; `suite-sample` (20,000 cases) at either commit; the rest of tier 2 at 9e9efac; and **the checked plain predictor in the browser** (`plain-checked-predictor.ts` with `compare-sets.ts --prediction=line-ranges`), which is the browser proof of the candidate from words. The candidate's equality with the search is logic over one table and no browser fact enters it, but the premise that positions inside words are sorted is a fact of real fonts, and only that run would show it on Chrome's own answers. It stays open.
- The function set's checks: `sweep` in a checked run, all 67,065 cases pass at 9e9efac; `plain` and `pure` run under replay, where 33,095 cases pass and 33,970 can't be answered from the records (section 5). They need the new recording too.

### 10. How a disagreement can't be missed

- **The checked run** (`shape.ts wordsCheck.on`): every candidate found from words is also searched over every offset, and a difference throws with the text, the offsets and the position. It is on under bun with `PRETEXT_WORDS_CHECKED=1` (the function set's sweep, `store-real-text.ts --checked=yes`, `words-coverage.ts`), and in a browser page through the lab's `plain-checked-predictor.ts`, where a throw becomes the case's row. It found the negative word spacing case on its first run.
- **Two trees**: `two-trees.ts` with the plain predictor on both sides holds the prototype's plain lines against the base's, which has no word candidate and no word cuts. It found the soft hyphen case, which the checked run can't see because there the candidate was right and the pieces had moved the positions.
- **Plain against inspected**: an inspected paragraph never takes the word candidate (it reports what the search read), so the function set's `plain` check and the plain predictor's browser run compare the two paths of one library on every case.
- The candidate is the one thing the fast path decides. It doesn't compute a width, a position or a line: those come from the same functions and the same table on both paths, so there is nothing else that could disagree.

### 11. Where Blink lands, what is left, and whether this is main's compensation again

Against the maintainer's two numbers (section 8's medians, pinned Chrome, background window, a loaded machine whose page ran at a quiet machine's speed):

| | base afb5a63 | prototype | the mark |
|---|---|---|---|
| 10,000 messages from scratch, stateless (a list of contexts a message), mix / ASCII | 3.43 / 2.91 s | 2.37 / 1.80 s | about 2 s: where a stateless API stops being viable |
| the same with the caller's one list of contexts (what `prepare` takes since item 1) | 2.04 / 1.80 s | 0.84 / 0.51 s | main's cold prepare: 0.34 / 0.19 s |
| 30,000 layouts of kept paragraphs, new widths, mix / ASCII | 3.00 / 2.34 s | 0.85 / 0.44 s | main: 0.009 s |
| 30,000 layouts at widths met before (from the 200-message rows) | 1.6 / 1.5 s | 0.39 / 0.12 s | main: 0.009 s |

- **From scratch.** With nothing kept at all the mix sits at the bar and plain ASCII under it. With the one thing the API already lets a caller keep, a list of Canvas contexts, the prototype is at 2.5 times main's cold prepare, and Blink is no longer the engine that decides the stateless question. The word questions are what makes the kept list pay: a repeat on a kept canvas costs about 0.14 µs in Chrome (the store study's measurement), and with word pieces a message of English text used once sends 8.5 strings new to the page where the base sends 41.
- **Kept paragraphs.** 3.5 to 5 times faster than the base at new widths and 4 (mix) to 13 (ASCII) times at widths met before, and still 13 times (ASCII, widths met before) to 94 times (the mix, new widths) main's 0.009 s. No Canvas is left in it for admitted lines (the unit test asks 0 questions at a width met before): what is left is the fill's own JavaScript, a `LineBreaker`, a break iterator, views and item results per line, about 3.8 µs a layout. Main's layout returns a count from flat arrays. Closing that gap is a flat loop over the same table for admitted lines, with the general path as the fallback (PROFILING-START item 9), and it would need its own checked run. I did not build it.
- **What is left, in the order I would take it.**
  1. A new recording and both orders of tier 2 with facts for word pieces, as B1b had: they change gap lists, so tier 1 can't pass before it. The plain predictor's checked browser run belongs to the same step.
  2. Prepare is now the larger half from scratch: 58 of 92 questions a message on ASCII (stand-in), 38 of them the pair window's two strings at each cut, nearly all repeats on the page. A pair fact per (space, first cluster) kept for one `prepare` call would remove most of them without outliving anything.
  3. The excluded classes, each with its own proof: right-to-left items (the search is mirrored; the identity holds on 109,649 recorded right-to-left positions), text without spaces (a different problem: there the unit is the cluster, and Blink's 256 px pieces are the cost), words without a script of their own (1.4% of English lines; measuring them as the port's `spacesStay` rule does would admit the Latin ones).
  4. The flat relayout loop.
  5. The decision on checking the font assumption on plain paragraphs (section 3): cost known, benefit a guarantee in place of a record.

**Is it "the WebKit shape with proofs", or has it slid toward main?** My hardest reading:
- *What is proven.* That the candidate from words is the search's candidate: pure logic over one table, held by checked runs on 960,633 lines of six corpora and the 67,065 cases of the full sweep and by two trees. That the word sum equals the base port's long prefixes on every recorded Chrome answer that can show it (0 of 316,645 off). That both hold in the stand-in on 116,670 random tree layouts and 169,660 tier layouts on the plain path, and 42,415 on the inspected path at the first form.
- *What is not proven, and can't be from Canvas without paying for it:* that in the user's font nothing but the pair beside a space crosses it. The base port measures long strings, so inside a line it sees whatever crosses; word pieces don't. A font with a contextual lookup across a space (the unit test's `Context` family is one, made up) would move a plain paragraph's line silently; an inspected paragraph would report `unsafe-to-break` at that cut. This is the same blind spot main has, reached from the other side: main never looks, the rebuild looks where it is asked to. The honest name for it is an assumption about fonts with a measured record of 0 misses and a named gap, not a proof. If the maintainer wants it proven per paragraph, the price is one two-word question a cut (section 3), which roughly doubles the strings new to a page.
- *What it shares with main and what it doesn't.* It shares the unit (a word with its space) and the sum. It doesn't share the corrections: there is no constant, no tolerance and nothing found by fitting. The one term added on top of the words is the pair window, which the port already had, with its engine reason (HarfBuzz positions a pair; the kern sits on the first glyph or is split, by the font's tables), and each exclusion has a reason in how Canvas measures a string alone. Two of the five conditions of A were found by tests and then explained, which is the order main's corrections were found in too. The difference is what happened next: the line class got smaller, the arithmetic didn't get a patch.
- *Where it would slide.* The pressure will be on the excluded lines: right-to-left, words without a script, soft hyphens, letter spacing. Each can be admitted honestly only by a rule with a source or a measured identity (the identity check shows letter spacing fails raw and would need the port's own correction first). Admitting them "because the numbers look fine" is main's road.
- The three narrowings in one night say the first statement of a condition here is likely to be too wide. The seeded random cases and the checked run should be gates for any step that widens it.

### 12. Files

- Library (281 lines added in `src/engines/blink`, comments and the study's tallies included): `shape.ts` (`wordCuts`, the kept values in `groupPrefix16`, `safeToBreak`, `adjust16`, `pairAdjust16`, `wordsCheck`), `line-breaker.ts` (`wordCandidate`, `wordCandidateOf`), `types.ts` (`BlinkGroup`), `index.ts` (the tally per line), `words.test.ts`.
- Lab and tools: `lab/baselines/plain-checked-predictor.ts` with `predictor-core.ts` `makePlainPredictor(…, checkedWords)`; `tools/words-identity.ts`; `tools/words-coverage.ts`; `tools/store-real-text.ts` (`--widths`, `--checked=yes`, asks and units per layout, the line tallies); `tools/two-trees.ts` (`--ignore=gaps`). `tools/two-trees-cases.ts` was copied from `x-webkit-casts` and left untracked.
- Study scaffolding that would go before any merge: `wordsCheck.log` and `wordsCheck.lines` with the tally in `fillLine`, and the `process.env` read in `shape.ts`.
- Runs: R/ holds every report named above, `exits.log` for the browser steps and the scripts that ran them. The log of the night is `.progress-words-blink.txt` at the top of the worktree `~/github/pretext-rebuild-wt/spec-words-blink` (untracked). The two temporary detached worktrees used for browser runs are removed; nothing of mine is left running.

## Word facts in Gecko (Firefox): when a sum of words is the engine's answer, and what a fast path on it buys

Speculative study, 2026-09-20. Branch `x-spec-words-gecko`, worktree `~/github/pretext-rebuild-wt/spec-words-gecko` (base afb5a63). Nothing is merged or pushed. Every run is under `~/github/pretext-rebuild/.artifacts/tests/runs/spec-words-gecko-20260920/`, called RUNS below. The running log is `~/github/pretext-rebuild-wt/spec-words-gecko/.progress-words-gecko.txt`.

Words used below:
- **Unit**: what Gecko shapes in one call. A word between boundary spaces, a boundary space by itself, or an invalid character (tab, newline, a format control). The port's `GeckoUnit`.
- **Scan**: one run of Gecko's `BreakAndMeasureText`: one text frame, on one pass over one line.
- **Candidate**: an offset where the scan tests whether the line may end.
- **Engine's loop**: the port's exact scan, character by character (`lines.ts` `charScan`, the old `breakAndMeasureText`).
- **Word scan**: the prototype. The same scan decided from the units' advances alone, unit by unit (`lines.ts` `wordScan`).
- **Modes**: `exact` (word scan off), `proven` (used only where the proof in section 3 holds), `premise` (also used where one premise is needed; the branch's default). `checked`: both scans run and a difference throws.

### 1. Short answer

1. **In Gecko there is nothing to compensate.** The engine itself shapes word by word. A boundary space is a glyph of its own and nothing is shaped across it (gfxFont.cpp:3708-3900). The port already asks Canvas one question per word at `prepare` and sums them. On Firefox's recorded answers a string with spaces equals the sum of its words and spaces at 66,743 of 66,745 strings; the other 2 are a word that ends in U+200D before a space, a rule the port already has (prepare.ts:1037-1045). So "break words like WebKit" is what Gecko does and what the port does, up to the break decision.
2. **Every Canvas question a fill asks today is about an offset inside a word**, and for text that breaks at spaces almost none of them can change a line. Under `overflow-wrap: break-word` (the chat bench's mode, main's only mode) Gecko's scan tests every cluster of the line's first word as a break candidate until the first normal break is accepted (gfxTextRun.cpp:1068-1073). The engine reads those advances from its glyph records for nothing. The port asks Canvas 4 to 5 questions a cluster for them. They matter only when a piece of the first word does not fit.
3. **What is provable buys little for chat; what buys a lot needs one premise.** Without any premise (`proven`) the word scan decides 3% of a chat message's lines under `break-word` and saves no Canvas call, because the engine's loop asks nothing on those lines either. Under `overflow-wrap: normal` it decides 96.5% of lines with no premise, and saves JavaScript only. With the premise it decides 99.0% of plain ASCII chat lines and 82% of the mix.
4. **The premise**: the advance before an offset inside a word is never more than the advance before the word's end (no suffix of a shaped word has a negative advance). No engine source gives it: a detailed glyph's advance is signed and nothing clamps it (gfxHarfBuzzShaper.cpp:1699-1719). Firefox's recorded answers hold 1,229,216 advances inside words and none breaks it. It is a belief about fonts, not a proof. A unit test on the branch holds the shape that breaks it.
5. **Numbers in Firefox 156** (10,000 chat messages, two sittings of four alternating pairs in one document, the page's fixed arithmetic at 27 to 30 ms): plain ASCII from scratch 0.60 s to 0.25 s (0.46 s to 0.19 s with one list of contexts); the 30,000 layouts of kept paragraphs at three new widths 0.65 s to 0.11 s. The mix: 2.65 s to 2.25 s, and 0.68 s to 0.19 s. `measureText` calls a message: 84.9 to 23.7 (ASCII), 119.6 to 63.0 (mix). Every line range is the same in both modes.
6. **Verdict.** For plain text this is the WebKit shape, and Firefox lands in the WebKit port's range. It is not main's compensation: no correction term, no tolerance, nothing fitted, and the exact port decides everything the word scan refuses. But it is not "with proofs" either: nearly all of the benefit under `break-word` stands on one premise about fonts. Whether that is acceptable under the charter is the maintainer's call. Section 9 says how it could land honestly.

### 2. What Gecko does, from the pinned source

- **A word, and the space.** `gfxFont::SplitAndInitTextRun` (gfxFont.cpp:3708-3900) walks a script run. U+0020 or U+00A0 is a boundary unless a cluster extender follows it (`IsBoundarySpace`, :3317-3330). A boundary ends the word. The word is shaped alone through the font's word cache (:3812-3831) and its glyph records are copied into the text run. The space is set as the font's space glyph (`SetSpaceGlyphIfSimple`, :3838; gfxTextRun.cpp:1590) or shaped alone as a word of one character (:3847). So the space is never shaped with a word, and no kerning crosses it.
- **Which words go round the cache.** A word longer than `gfx.font_rendering.wordcache.charlimit`, 32 characters (StaticPrefList.yaml:7931-7934; clamped to 255, gfxFont.cpp:3737-3739), is shaped alone straight into the run (`ShapeFragmentWithoutWordCache`, :3804-3811): the same shaping, no cache. An invalid character ends a word too and gets no glyph (:3868-3897). Text without spaces is one long word.
- **The one case where words are not shaped alone.** Where the font's lookups involve the space glyph (`SpaceMayParticipateInShaping`, :3747-3763) a run with spaces is shaped whole. The port knows it as the gap `space-in-shaping`; its plain path sums units anyway. The word scan reads the same sums, so it adds no new exposure.
- **The scan.** `gfxTextRun::BreakAndMeasureText` (gfxTextRun.cpp:922-1212) adds `GetAdvanceForGlyph` per character, integers in app units (1/60 px), with spacing (:1141-1147). A candidate is a natural break (:1053), a soft-hyphen break, a position after white space under `break-spaces` (:1080), or a word-wrap candidate: any cluster start while `aCanWordWrap` holds and no normal break was accepted yet, or the emergency break after a hyphen (:1068-1073). `aCanWordWrap` is `overflow-wrap: break-word | anywhere` (nsTextFrame.cpp:11139). A candidate is accepted if it is the first or it fits (:1091-1100); the scan aborts at the first candidate whose width does not fit (:1104-1108). Without a soft hyphen these two tests are one test.
- **So at a unit's start everything is a sum of word facts.** The running width there is the advance from the scan's start: the sum of the units between (the terms telescope), plus spacing and tabs, which the port holds as prefix sums. The port's `advanceBefore` returns the stored sum at a unit's start and asks Canvas nothing (advance.ts:54-57).
- **Canvas's 7-bit font size.** Canvas shapes at the CSS size kept to 7 significant bits; the DOM at Servo's 10-bit size on the 1/60 px grid (prepare.ts:984-1002). Where the two differ every unit's width is a stand-in under the gap `font-size-quantization`, and the misses add up along a line: n words, n misses of the same sign. Sums do not cancel them. The word scan reads the same unit widths as the engine's loop, so it changes nothing here, for better or worse.
- **The lazy plain scan and the pair-placement questions** (DESIGN.md §4.4, §4.6) are about offsets inside units only. A line whose scans the word scan decides asks none of them.

### 3. The conditions

A **line** is decided from word facts when every scan of every pass of the line is. A **scan** is, when all of these hold. A program tests them on the prepared paragraph with no Canvas question.

Always:
- C0. The paragraph is plain (not prepared for inspection). An inspected paragraph keeps the engine's loop, so the lab's path is untouched.
- C1. `white-space` is not `break-spaces`.
- C2. The scan starts at a unit's start (after the line-start skip of white space) and ends at a unit's start or the run's end. A frame that ends inside a word (a span boundary inside a word) and a line that starts inside a unit (after a break inside a word; every line but the first of text without spaces) are refused.
- C3. Every candidate the walk tests sits at a unit's start, and the run of trimmable spaces before it starts at a unit's start (a trimmable space inside a word, U+3000 or a space before a combining mark, refuses).
- C4. The walk never reaches a unit that a removed soft hyphen stands in or before. A soft hyphen after the point where the scan ends is reached by neither scan.
- C5. The scan does not end at a candidate inside a unit.

`proven` adds:
- C6. No unit the walk reaches holds an **active candidate inside**: a natural break inside it (after a hyphen, between Han characters), or, while no normal break has been accepted on the line, a cluster start inside it under `break-word | anywhere`, or an emergency break after a hyphen.

`premise` replaces C6 by:
- C6'. A unit with active candidates inside is passed over when the frame has no letter spacing, the unit holds no trimmable space, the advance from the scan's start to the unit's end fits, and the port takes the unit's inner advances from measured suffixes (not where HarfBuzz shapes the unit reversed or a mark starts a cluster: there the port's value is a prefix's own width, which a narrow ligature puts past the word's end). Then, **on the premise**, every inner candidate fits, none aborts, and the last of them is the scan's last break until a later candidate is accepted.

Why `proven` is exact: up to where the scan ends, the engine's loop tests the same candidates in the same order with the same priority, its running width at each is the same sum, and with no soft hyphen its accept test and its abort test are one. Both return the same record, and the engine's loop asks Canvas nothing on such a scan either. The word scan is then a refactoring of the loop: per unit where the loop goes per character.

Everything around the scan is unchanged and was arithmetic already: `ReflowText`, spans and their edges, atomic inlines, floats and slots, the redo pass with a forced break, text-indent, tabs, bidi reordering, justification, placement and pieces. So inline box edges, floats, tabs and bidi refuse nothing by themselves.

Data on the prepared paragraph: one byte per unit (`GeckoPrepared.unitInner`, five bits of what the unit holds inside). A plain ASCII chat message has 40.8 units (20.9 words), the mix 36.3, so about 40 bytes a message plus the array's header. Unit advances and break flags were there already. Nothing is found by a string and nothing outlives the paragraph.

**How it fits the windows of `x-perf-gecko-fill`.** That branch cuts a long unit into windows where Canvas shows that nothing crosses the cut, so advances inside a long unit cost short questions. The two are disjoint by construction: the word scan treats a unit as atomic and refuses every scan that starts, ends or breaks inside one (all of Chinese after a message's first line); those go to the engine's loop, which is where the windows work. A later step could let the word scan walk windows as it walks units and leave only the window the line ends in to the loop. Not built.

**A by-product.** With the word scan on, the lazy plain scan (the most intricate part of the Gecko port, DESIGN.md §4.6) saves almost nothing: reading every candidate whole costs 23.80 calls a plain ASCII message against 23.08, and 70.97 against 66.97 on the mix (stand-in Canvas, 2,000 messages, a scratch copy of the tree, never committed). Without the word scan it saves about 40 (120.88 against 80.57). If the word scan landed, the lazy scan could go.

### 4. The premise, and what was done to it

The premise: in the port's numbers, the advance before an offset inside a word is never more than the advance before the word's end.

- **The engine does not give it.** Gecko rounds each glyph's advance and stores it signed (gfxHarfBuzzShaper.cpp:1699-1719). A font whose positioning takes more from a glyph than its advance makes a suffix negative, and then the engine itself breaks inside a word that fits.
- **Recorded answers** (`tools/word-scan-census-library.ts` under the function set's plain check, which replays Firefox's recording; the inspected and the plain paragraph of each case are both counted, so most advances are counted twice): 812,358 words, 270,290 of them asked inside, 1,229,216 advances inside words. **0 above the word's end.** 46 below the word's start. Those 46 taught something: 14px "Courier New" draws reh yeh alef lam as one 504 au glyph, and the port's stand-in for an offset inside it is the word less a suffix that measures 1,512 au alone, so it goes negative. The mirror image would break the premise where the port's value is a prefix's own width. So the walk now refuses such units (`advance.ts` `advancesAreSuffixes`). What is left of the premise is one thing: Canvas never measures a suffix below nothing, nor narrower than the share of a kerned pair it holds.
- **The hole, written down as a test**: `word-scan.test.ts` has a font where `q` advances by -300 au. `xq i` at 300 au: the engine's loop breaks after `x`, the word scan keeps `xq`. The test asserts that the two differ and that checked mode throws.
- **The stand-in Canvas cannot test the premise** (it has no negative suffix). It tests the bookkeeping. Only the recorded answers and the browser test the premise, and they hold the lab's Mac fonts only.

### 5. What was tested, with no browser

| Check | Result | File |
|---|---|---|
| Function set, plain, mode `premise` with `checked`, Firefox's recorded answers, both configurations: every scan the word scan decides equals the engine's loop, and plain lines and pieces equal the inspected paragraph's | 63,771 of 63,771 pass in both, at three commits (the first, after each narrowing) | RUNS/plain-checked-{1,2,3}.log |
| The same without `checked`: the plain path's questions | 3,511,582 to 2,661,131 without facts (55.07 to 41.73 a paragraph), 3,490,964 to 2,640,572 with them, at 663d53a (the later soft-hyphen narrowing can only lower it); `proven` asks what `exact` asks | RUNS/plain-{exact,proven}-1.log, plain-premise-2.log |
| Function set, pure and sweep (four widths a case), both configurations; sweep again with `checked` at the final library | 63,771 pass each | RUNS/pure-premise-1.log, sweep-premise-1.log, sweep-checked-1.log |
| Tier 1 (the inspected path against the frozen reference), at 78a8787 and again at the final commit | 63,771 the same in both configurations, 0 changed, 0 other questions, 0 cases for tier 2 | RUNS/tier1-check-{1,2}.log |
| Sum of words and spaces on recorded answers (`tools/word-scan-space-identity.ts`) | 66,743 of 66,745; the 2 are U+200D before a space in 18px Georgia | RUNS/space-identity-no-facts.json |
| The premise on recorded answers | 0 of 1,229,216 | RUNS/census/, RUNS/census2/ |
| Mode `exact` against mode `premise` under the stand-in Canvas, every line's fill result and pieces as JSON (`tools/word-scan-diff.ts`) | 0 differing layouts in every run of section 6, first library and final library | RUNS/diff-*.json, diff2-*.json |
| Base afb5a63 against the branch (`tools/two-trees.ts`), 6,000 random tree cases at 6 widths | 36,000 layouts the same as rows (169.0 calls a paragraph in both trees) and 36,000 the same as plain line ranges (72.4 to 67.3 calls) | RUNS/two-trees-random-*.log |
| Unit tests | 879 pass, 0 fail with a 120 s timeout; 5 had timed out at 5 s while the load was over 60 | |
| Citation ledger | exit 0, 0 lost | |

`bun rebuild/tests/gates.ts` was not run as one command; its parts were run directly, as the rules allow.

### 6. Coverage (final library 1370bcf, stand-in Canvas, mode `premise`)

| Corpus | paragraphs; layouts; lines | lines without the premise | lines with it | no text scan | left to the engine's loop | layouts with every line by the word scan (without the premise) | differing |
|---|---|---:|---:|---:|---:|---:|---:|
| tier corpus, own widths (3 of 4 shards; the fourth was stopped at the cutoff, its first run had 0 differing) | 47,914; 47,914; 174,058 | 26.2% | 16.1% | 0.2% | 57.4% | 43.1% (28.2%) | 0 |
| tier corpus, 7 widths from 40 to 800 px | 63,886; 447,202; 1,750,104 | 17.8% | 25.3% | 0.2% | 56.7% | 52.1% (29.2%) | 0 |
| random tree cases (`tools/two-trees-cases.ts`, copied from x-webkit-casts), 12 widths from 12 to 640 px | 19,445; 233,340; 1,499,972 | 13.1% | 3.7% | 3.3% | 79.9% | 22.4% (18.8%) | 0 |
| chat bench, plain ASCII, 10,000 messages, 4 widths | 10,000; 40,000; 124,166 | 3.3% | 95.7% | 0.0% | 1.0% | 98.1% (2.6%) | 0 |
| chat bench, mix, 10,000 messages, 4 widths | 10,000; 40,000; 133,751 | 2.7% | 79.6% | 0.0% | 17.7% | 86.8% (2.2%) | 0 |
| real English used once (main's corpus, cut once), 6 widths from 60 to 440 px | 2,336; 14,016; 88,010 | 2.4% | 86.6% | 0.0% | 10.9% | 87.7% (1.4%) | 0 |
| eleven languages used once, 6 widths | 6,468; 38,808; 230,276 | 1.8% | 74.1% | 0.0% | 24.1% | 82.8% (1.7%) | 0 |

| Lines by the word scan (both modes), by the scripts of the line's text | Latin, Greek, Cyrillic | Arabic, Hebrew | Han, kana, Hangul | Indic, South-East Asian | several | no script |
|---|---:|---:|---:|---:|---:|---:|
| tier corpus, own widths | 53.3% of 99,994 | 39.0% of 19,902 | 11.4% of 22,167 | 20.2% of 8,594 | 49.4% of 8,274 | 30.5% of 15,127 |
| tier corpus, 7 widths | 59.0% of 786,956 | 56.9% of 262,532 | 7.7% of 353,140 | 18.8% of 202,449 | 60.4% of 80,674 | 46.5% of 64,353 |
| random tree cases | 12.4% of 793,192 | 17.3% of 274,132 | 7.2% of 82,664 | 15.9% of 40,975 | 20.8% of 55,392 | 52.0% of 253,617 |
| chat, plain ASCII | 99.0% of 124,149 | none | none | none | none | 100% of 17 |
| chat, mix | 94.3% of 109,705 | 100% of 4,498 | 5.5% of 17,987 | 77.8% of 90 | 66.6% of 1,267 | 100% of 204 |
| real English used once | 89.2% of 87,779 | none | none | none | none | 20.8% of 231 |
| eleven languages used once | 87.3% of 88,306 | 98.8% of 85,194 | 6.8% of 26,152 | 38.4% of 30,281 | 74.5% of 55 | 18.4% of 288 |

Under `overflow-wrap: normal` with no premise (`proven`): 96.6% of the chat's plain ASCII lines and 96.5% of real English; the other 3% are lines that reach a hyphenated word, whose natural break inside needs an advance inside the unit (RUNS/diff-normal-proven-*.json).

What the refused lines are, largest first (RUNS/coverage-detail.txt has every count):
- **starts inside a unit**: every line but the first of text without spaces (Chinese, Japanese, Thai, Khmer, Burmese), and a line after a break inside a word. 13% of the mix's lines, 16% of the eleven languages, 32% of the tier corpus.
- **the unit overflows**: a word with candidates inside that does not fit, so the break is inside it (narrow widths, URLs). 0.7% of plain chat lines at 260 to 440 px, 4% of the mix, 11 to 14% of the tier corpus.
- **soft hyphen** in or before a unit the walk reaches: 0.1% of the mix, 5 to 6% of the tier corpus, which is built to have them.
- letter spacing with candidates inside (2 to 3% of the tier corpus), `break-spaces` (2%), a frame that ends inside a word (1%), a trimmable space inside a word, a unit whose inner advances are prefix widths (0.1 to 0.3%), a scan that would end inside a unit it passed over (under 0.1%).

### 7. Counts and times

**Counts** don't depend on the machine's load. "Base" is mode `exact`, which asks what afb5a63 asks (two-trees, section 5).

| `measureText` calls a message; characters sent a message | base | word scan (`premise`) |
|---|---|---|
| Firefox 156, chat plain ASCII, 10,000 messages, from scratch | 84.92; 252.3 | 23.72; 100.0 |
| the same, per layout at a new width (kept paragraphs, 30,000 layouts) | 32.33; 79.2 | 0.65; 1.9 |
| Firefox, chat mix, from scratch | 119.63; 2,020.6 | 62.96; 1,872.7 |
| the same, per layout at a new width | 30.28; 83.0 | 2.44; 13.7 |
| Firefox, real English used once (2,336 messages): from scratch; per layout at a new width | 86.55; 257.5 and 31.52; 77.1 | 23.21; 98.5 and 0.65; 1.9 |
| Firefox, eleven languages used once (6,468 messages) | 102.18; 674.4 and 23.23; 65.9 | 54.47; 537.5 and 2.60; 12.0 |
| stand-in Canvas, chat plain ASCII; mix, from scratch | 82.58; 247.1 and 118.03; 2,014.0 | 23.63; 99.8 and 62.96; 1,869.4 |
| per layout at a width met before, anywhere | 0 | 0 |

Lines decided by the word scan in Firefox: plain ASCII 123,637 of 124,921 (99.0%; 2.9% without the premise); mix 110,109 of 134,179 (82.1%); real English 28,440 of 28,731 (99.0%); eleven languages 61,397 of 74,927 (81.9%). A hash of every line's range over the four widths is equal in both modes in every set: 80,000 chat layouts and 35,216 real-text layouts on real Canvas answers. Files: RUNS/probe-timed-1, probe-timed-2, probe-real-1 (`firefox-probes.json`).

What the mix still sends is Chinese: its messages are one unit each, their lines start inside it, and the engine's loop asks for the rest of the unit at every candidate.

**A store with the page's lifetime** (counted, not built; stand-in Canvas, one page, from scratch at 320 px; a question is a context's settings and a string; RUNS/repeats-*.log). Of the word scan's questions, asked before on the page: chat plain ASCII 95.1% over 10,000 messages and 99.1% in the last 1,000 (0.25 new a message); chat mix 82.1% and 88.0% (7.0 new a message, the Chinese suffixes); real English used once 80.6% and 87.3% (2.9 new a message); eleven languages used once 59.8% and 80.8% (4.5 new). Base for comparison: 95.3% and 98.6% on plain ASCII, of 3.5 times as many questions.

**Times.** Pinned Firefox 156, background window, device pixel ratio 2, the lock's `--exclusive`. One document holds both modes; each round runs base and word scan in turn and the order turns round every round; 4 rounds a sitting, so 4 alternating pairs. The page's fixed arithmetic (the bench's `spin`) took 29 and 27 ms, 30 and 28 ms, 29 and 28 ms: the page ran at full speed. The machine's load average was 55 to 93 the whole time, from other agents' offline jobs and mine; no timed run got a quiet machine tonight. Medians in ms, first sitting / second sitting (RUNS/probe-timed-1 05:04-05:06, probe-timed-2 05:19-05:21). Most rounds are within 8% of their median; five single rounds are 13 to 25% above it, and every round is in the JSON.

| 10,000 messages, `break-word` | base | word scan (`premise`) |
|---|---|---|
| plain ASCII, from scratch, a list of contexts a message | 597 / 615 | 244 / 248 |
| plain ASCII, from scratch, one list for the set | 460 / 476 | 186 / 192 |
| plain ASCII, kept, then 30,000 layouts at 3 new widths | 645 / 668 | 116 / 110 |
| mix, from scratch, a list a message | 2,651 / 2,742 | 2,250 / 2,288 |
| mix, from scratch, one list | 2,452 / 2,494 | 2,166 / 2,177 |
| mix, kept, then 30,000 layouts | 677 / 710 | 192 / 196 |

| 10,000 messages, `overflow-wrap: normal`, mode `proven`, no premise (RUNS/probe-timed-normal-1, one sitting, 05:17-05:18) | base | word scan |
|---|---|---|
| plain ASCII from scratch, a list a message; one list | 292; 226 | 285; 210 |
| plain ASCII, 30,000 layouts | 130 | 76 |
| mix from scratch; one list; 30,000 layouts | 2,242; 2,206; 167 | 2,223; 2,134; 118 |

The base rows agree with the bench's known Firefox rows (0.58 to 0.62 s, 0.45 s, 2.4 to 2.7 s, 0.6 to 0.7 s), so the probe measures what the bench measures. It is not the bench: `rebuild/bench/run.ts` holds one library a document, and two modes of one library had to take turns in one. The probe copies the bench's messages, paragraphs and fixed arithmetic (`tools/word-scan-probe.ts`).

Read from the second table: under `overflow-wrap: normal` the engine's loop already asks nothing, and a kept layout costs 4.3 µs; the word scan takes it to 2.5 µs, so the loop per character is about 40% of a layout that asks nothing. Of the 0.65 s to 0.11 s under `break-word`, most is the Canvas questions with the recipes' JavaScript around them.

### 8. Where Firefox lands against the maintainer's numbers

- **From scratch, the 2 s bar.** Plain ASCII: 0.25 s, or 0.19 s with one list of contexts. That is the WebKit port's range (0.19 to 0.25 s) and under main's cold prepare in Firefox (0.30 s). It was under the bar before (0.60 s). The mix: 2.25 s, 2.17 s with one list: still at the bar. What holds it there is Chinese, which this study does not touch and `x-perf-gecko-fill` does. Arabic is taken care of: all 4,498 Arabic lines of the mix are the word scan's.
- **Kept paragraphs, main's 0.008 s** (0.014 s in Firefox). 0.11 s for plain ASCII, 0.19 s for the mix: 3.7 and 6.4 µs a layout where main has 0.47 µs. Eight times main where it was 46 times. What is left is not the scan. It is the port's reflow around it, which makes about ten small objects a line (the band, the line layout, span data, the provider, the frame result, statuses). A fill that only counts lines does not need them. That is the next thing to measure for relayout, and it has nothing to do with word facts.

### 9. Has it slid toward main?

For it being the WebKit shape:
- Nothing is compensated. The word scan uses no number the engine's loop does not use, the same prefix sums through the same functions (`spacingIn`, `tabsIn`, `rangeAdvance`), in integer app units.
- It is one function that returns the loop's own record or refuses, called in one place (`breakAndMeasureText`). The exact port stays the only source of truth for what is refused, and for inspected paragraphs always.
- A disagreement can't hide in a test run: `wordScanState.checked` runs both and throws, and the function set's plain check and sweep pass with it on every recorded case.
- In mode `proven` it is a refactoring with a proof.

Against:
- **Under `break-word`, the mode a chat app uses, the proven part is worth nothing**: 3% of lines, no call saved. All of the gain is the premise's. I did not find a way to buy the gain without it: whether every piece of a word fits is information about the font that only the questions give, and every sufficient check I tried needs the same questions.
- The premise fails silently. A font that breaks it gives a wrong line and no gap. That is main's failure mode in kind, even if the class is one inequality and not an open list.
- The evidence for it is one Mac's fonts. The 46 advances below a word's start show that real fonts do give the port non-monotone numbers inside words. I closed the mirror case I could see, which is how main's list of corrections began.
- The code keeps a module-level mode and counters for the study (`wordScanState`). A landed version would have one mode and no counters.

How it could land honestly, if the maintainer wants the speed:
1. As a **font fact with a documented default**, in the charter's own terms (tentpole 3): "advances inside a word are not negative", default true, never asked of Canvas because no sound check exists; and an **inspected** paragraph, which measures every inner advance anyway, reports a named gap on a line where it sees the default fail. Then tier 2 and every lab run catch a font that breaks it. Not built: a new gap name touches the registry, DESIGN.md §5 and the coverage map.
2. Or `proven` only: no premise, exact by construction, no gain under `break-word`, a 40% faster relayout under `overflow-wrap: normal`.
3. Either way the lazy plain scan can go if `premise` lands (section 3).

### 10. Tier 2 in Firefox, and what is left

**Tier 2 did not complete.** Other agents' exclusive timing jobs held the browser lock for most of three hours, and the load average was 30 to 120. Forward order only, as the brief allows. What ran, each from a clean detached worktree that is removed again:
- Usual predictor, without facts, at 51619e0 (the inspected path is the same code at every commit of the branch): 11 of 17 jobs finished, 27,779 rows. Every row (native observation, prediction, painted lines) equals the Gecko owner's complete usual run of 2026-09-19 (`.artifacts/tests/runs/fu-gecko/firefox-no-facts`), so no status can have moved on them (RUNS/compare-no-facts-partial.log). 6 jobs failed from load: 4 timed out reading the app's build before any browser time, 2 stalled for 120 s. `browser-sets.ts` stops before scoring when a job failed, so no ledger was built and no transitions were printed. The one rerun I queued never got its turn.
- Plain predictor at the final library 1370bcf: 7 jobs finished, 16,817 rows: 0 line ranges and 0 native observations differ from that usual run (RUNS/compare-plain-final-partial.log). 1 job failed to launch Firefox (`open` timed out), 9 never got the lock before I stopped at 07:40.
- With facts: never ran.
- The more pointed browser evidence for this change is section 7's: in real Firefox the word scan and the engine's loop give the same line ranges on 115,216 layouts.

What is left:
- The maintainer's call on the premise (section 9).
- Tier 2 in full on a quieter machine: both configurations and the plain predictor's run, at 1370bcf or later.
- Chinese, Japanese, Thai: the windows of `x-perf-gecko-fill`, and then the word scan walking windows.
- Relayout's remaining 3.7 µs a layout: the reflow's objects, not the scan.
- Small refusals that the same method could narrow: letter spacing with candidates inside (the inner tests need spacing that is not negative), `break-spaces` (its candidates all sit at unit starts), a soft hyphen at a unit's start.
- The study's scaffolding: `wordScanState`'s mode and counters; `unitInner` could be computed per visited unit instead of stored (not ablated).

### 11. Files

Library (about 215 added lines with comments): `rebuild/src/engines/gecko/lines.ts` (`wordScan`, `wordScanState`, the dispatcher; `charScan` is the old loop unchanged), `advance.ts` (`advancesAreSuffixes`), `prepare.ts` and `types.ts` (`unitInner`), `word-scan.test.ts`. DESIGN.md §4.6 has a paragraph on it.
Tools, all under `rebuild/tools/`: `word-scan-diff.ts` (the differential, coverage, counts, questions new to the page), `word-scan-{exact,proven,checked}-library.ts` and `word-scan-census-library.ts` (for `function-set.ts --library=`), `word-scan-space-identity.ts`, `word-scan-probe.ts` with `word-scan-probe-entry.ts` (the browser probe), `two-trees-cases.ts` (copied from x-webkit-casts).
Runs: RUNS as above; `coverage-table.txt` and `coverage-detail.txt` there hold section 6's numbers.
