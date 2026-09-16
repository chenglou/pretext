# Gecko port audit (Firefox 156.0)

An adversarial pass over `rebuild/src/engines/gecko`, `tools/gen-gecko-data.ts` and `specs/gecko-RESULTS.md`, 2026-09-16.
No engine code was edited. Three short jobs ran in installed Firefox under the shared lock (`gecko-audit-debug`, two lab
runs with the owner's debug predictor; `gecko-audit-probe`, one Canvas probe). Outputs are under
`.artifacts/lab/gecko/audit/`:

- `<set>-r8/`: the owner's round 8 rows scored again with `rebuild/lab/score.ts` sha256 `509de39a…` (10:08);
  `<set>-r8-now/`: scored with `e0a7b4be…` (10:10). The lab owner was still editing the scorer during the audit.
- `debug-sample/`: 35 sampled cases with the debug predictor (gaps, every `measureText` call, fragments), fresh order.
- `debug-fe0e/`: `c-29638bb1a4343fad` (`😀😀︎`) followed by four emoji cases, to see Canvas in the state F2 describes.
- `probe-a1a2/`: Canvas widths behind the suffix recipes (`audit-probes.ts`).
- `gap-census.ndjson`: the gap names `prepareGecko` reports for all 25,390 cases, with a stand-in Canvas, joined with
  the scores. The in-word, emoji, optical-size, quantization and `ui-language` conditions don't depend on widths, so
  they're exact there; `space-in-shaping` and the apd rounding branch of `bitmap-emoji-size` can't fire with the stand-in.

Scratch tools (outside the repo, in the session scratchpad): `audit-dump.ts` prints a row's styles, native lines by the
scorer's own derivation, predicted lines, gaps, calls and per-line rects in au; `audit-gaps.ts` is the census.

"au" is 1/60 CSS px. The page is DPR 2, 30 au per device pixel.

## 1. Blocking findings

### B1. The largest suite class, 117 lineCount failures under `font-fallback`, is two other things

RESULTS attributes 117 of the suite's 159 lineCount failures to "every later OffscreenCanvas measurement of U+1F600
returns the text glyph" (probe F2). Classifying those 117 rows by the native U+1F600 advance:

**(a) 81 rows: the DOM is pinned too, and the port's own correction breaks an exact Canvas total.**

- Native U+1F600 is 1020 au at 16px Arial in 76 rows, and 1020 au plus the row's letter spacing in 5 (660, 960,
  1110). A fresh document gives 960 au (probes-firefox cross-cutting 1). So the native layout also draws the pinned text
  glyph, and native results depend on page history, not only predictions.
- `debug-fe0e`, `c-0e9eee22e9d69e02` after `😀😀︎`: Canvas gives `😀` 1020 au at 16px and 1020 au at the device size
  32px; the unit `😀😀😀😀((aabb` measures 6856 au, which equals the native line total 4080 + 2776. The port applies the
  Apple Color Emoji device-size correction (`prepare.ts:840-866`): `floor(1020 × 30/60 + 0.5)` = 510 au per emoji, so it
  predicts 4816 au and one line. Without the correction the Canvas total is the native width.
- `debug-sample`, the same case in a fresh document: native 960 au, Canvas 1920 au at 32px, predicted 960; all four
  metrics pass.
- The correction runs whenever `isEmojiCluster` says so (`prepare.ts:532-541`). That rule is inferred from code point
  properties, not ported. Gecko's `gfxFontGroup::FindFontForChar` (`gfx/thebes/gfxTextRun.cpp:3242-3380`) decides the
  presentation from `GetEmojiPresentation`, VS15, VS16, skin tone modifiers and flag tags, and prefers a monochrome font
  for text presentation. The port corrects `😀︎` (VS15, TextExplicit) and a keycap without VS16; `suite/measurement`
  has 5 widths failures with `😀︎`, for example `c-29638bb1a4343fad` (native 870 au per cluster, predicted 420).
- The gap detail says an earlier Canvas measurement pins the character. The rows show Canvas and DOM agree in the pinned
  state; what differs is the port's detection of which font draws the cluster.

**(b) 36 rows are a port bug at soft hyphens inside grapheme clusters, not font fallback.**

- Families `suite/skin-modifier/shy`, `suite/woman-before-zwj/shy` and `suite/woman-after-zwj/shy`, 12 each. They fail
  in a fresh document as well.
- `c-27e5b02212b7324f`, `a👩‍­🚀b` in 12px Arial at 6.72px. Gecko breaks at the soft hyphen before `🚀`
  (`GetHyphenationBreaks` doesn't require a cluster start). HarfBuzz ligates `👩‍🚀`, and Gecko attaches a ligature clump's
  glyphs to its first character (`gfxHarfBuzzShaper.cpp:1582-1660`). Native line 1 holds the whole cluster, 750 au plus
  the 240 au hyphen, and `🚀` has a zero-width rect.
- The port measures a suffix that starts inside the cluster. It measures `🚀b` alone (1360 au) and subtracts that from
  the unit (1760 au), with the −210 au emoji correction. That gives `[👩‍]` −210 au, so the frame is 30 au and `🚀` goes
  to a line of its own: 4 lines instead of 3.
- RESULTS already names this mechanism for smoke `c-40ecb4f7950b571e` ("partial ligature shares"), but it counts the
  suite's 36 rows and their painter failures under `font-fallback`.

What to change: move (b) to `in-word-prefix` in RESULTS, and treat a candidate that isn't a cluster start as an unmeasurable
suffix instead of measuring it alone. For (a), the device-size correction needs the font-matching rule ported, or the
gap condition has to say that the correction itself is where the prediction goes wrong. Both depend on page history.
The lab maintainer's runs in two orders should flag these rows.

### B2. `in-word-prefix` is reported for almost every paragraph, so "every failure has a named gap" says little

From `gap-census.ndjson`, per case set:

| Set | Cases | Report `in-word-prefix` | All-pass cases reporting it | Failing cases with no gap |
|---|---|---|---|---|
| smoke | 297 | 264 | 233 of 266 | 0 of 12 |
| runs | 2,580 | 2,421 | 2,267 of 2,424 | 2 of 77 |
| ws | 1,019 | 663 | 612 of 966 | 0 of 15 |
| policy | 1,606 | 1,493 | 1,471 of 1,584 | 0 of 22 |
| suite sample | 19,888 | 18,610 | 13,768 of 15,000 | 9 of 1,360 |

- The condition is prepare-time: any break flag or, under `overflow-wrap`, any cluster start inside a shaping unit
  (`prepare.ts:873-876`). It ignores the font and whether a chosen line actually ends inside a word. DESIGN §5 says
  "breaks inside words ... in fonts with kerning, ligatures or contextual forms".
- So the gap covers every recipe error behind an in-word break, the port bugs of B1(b), B3 and N7 rows included. This is
  the same pattern as blink-AUDIT B1.
- `font-fallback` fires on 2,592 all-pass suite cases, for any emoji-presentation character.

### B3. Suffixes are measured without the script context the port applies to units

- `c-09a7775ba6eea10d` (`suite/original-vs-reshaped-admission`), `aلا((tail` in 24px Amiri RTL at 15px (900 au). The
  frame `لا((` measures 2245 au, exactly the native 435 + 490 + 660 + 660. Native parentheses are 660 au each, because
  the itemizer gives them the Arabic run's script.
- `glyphBefore` measures the suffixes `((` (734 au) and `(` (367 au) alone (`lines.ts:29-30`), because `unit.scriptContext`
  is `''` for a unit that starts with Arabic. The port predicts `((` on one line at 734 au; natively they're two lines.
- Probe A1 in Firefox: W(`ا (`) − W(`ا `) = 1392 − 732 = 660 au, and W(`ا ((`) − W(`ا `) = 1320 au. The port's own
  script-context recipe (`prepare.ts:465-489`), applied to the suffix, gives the native widths.
- RESULTS files this under `in-word-prefix` ("Amiri parentheses after Arabic"): suite 23 lineCount and 27 breaks in that
  family, 4 and 6 in `suite/partial-source-context`. I traced 2 cases, so the share of those rows this explains is an
  inference.
- The script-context recipe itself is in no Gecko spec and reports no gap (DESIGN names `script-context` for Blink only).
  Where it applies, it's exact on the traced Korean rows (§4).

### B4. `width` copies the scorer's Range-geometry rules, and two of them disagree with rows

`buildLine` derives `width` from the lab's "Visible code points" rules (`lines.ts:578-677`). DESIGN §2.1 asks for the
observed extent, but the copy has no source for these rules and has drifted:

- **"A space whose advance isn't positive has no positive rect"** (`lines.ts:595-598`). This is the "open, cause not
  traced" class in RESULTS.
  - `c-79e5272a2644d9b8` line 2: run 3's leading space is 210 − 60 − 240 = −90 au.
  - Gecko's `TrimTrailingWhiteSpace` floors the −90 au delta and subtracts it with no clamp
    (`nsTextFrame.cpp:11605`, `nsLineLayout.cpp:2939, :2953`), so the frame grows by 90 au. The native rect of that space
    is 90 au wide.
  - The lab therefore takes code point extents (1234 au). The port drops the space, finds no hanging ink and returns the
    line box, 1324 au. `engineWidth` (1324) follows the source; `width` doesn't.
- **Controls other than TAB, LF and CR.** The current scorer counts them as visible; `lines.ts:611` doesn't.
  - `c-92b6963ae4344985`: a lone VT with 1px letter spacing is natively 60 au, predicted 0. `CanAddSpacingAfter` skips
    only formatting controls and tabs, and the port adds the 60 au to `engineWidth`.
  - `c-fc59a73aa616baff`: NUL, the same 60 au.
  - Both passed under the 10:06 scorer, fail now and report no gap.

## 2. Re-scored numbers (task 1)

Round 8 rows, pass / fail / unobserved / not-applicable:

| Set | Metric | RESULTS (10:06 scorer) | Audit, 10:08 scorer | Audit, 10:10 scorer |
|---|---|---|---|---|
| smoke | lineCount, breaks, widths, painter | 296/1/0, 292/0/5, 272/4/16, 281/12/4 | same | same |
| runs | lineCount, breaks | 2,576/0/4, 2,568/8/4 | same | 2,576/0/4, **2,573/3/4** |
| runs | widths, painter | 2,466/45/57, 2,438/71/71 | same | **2,471/45/57**, 2,438/71/71 |
| ws | all | 1,018/1/0, 1,017/2/0, 966/11/40, 973/15/31 | same | same |
| policy | all | 1,605/1/0, 1,605/1/0, 1,594/11/0, 1,585/21/0 | same | same |
| suite | lineCount, breaks | 19,726/159/3, 18,978/142/768 | same | same |
| suite | widths, painter | 15,108/494/3,376, 18,370/1,357/161 | **15,106/496**/3,376, **18,368/1,359**/161 | same as 10:08 |

- Suite: the 10:08 scorer turned `c-fc59a73aa616baff` and `c-92b6963ae4344985` from pass to fail (B4).
- Runs: the 10:10 scorer no longer calls a predicted start inside the lab's grapheme a split where Firefox starts the
  line there. 5 breaks failures pass, confirming that class as an observation: `c-a560dabf8d17cd2c`,
  `c-4f0c9d3cd9d60735`, `c-a11286faf2988d0e`, `c-9d14b569442bf320` and `c-d4c7c9fddc93a8ae` (lab ISSUES.md, resolved).
- measureText stats recomputed from the round 8 rows equal the RESULTS table (labelled round 6). Means differ by 0.1 in
  smoke and suite; the suite maximum is 7,987.
- `gecko.test.ts` has 23 tests, not 24, counted by reading the file. At the end of the audit, `bun test
  rebuild/src/engines/gecko` doesn't load: `index.ts` imports the Blink engine, whose `props.ts` was mid-edit by its owner
  (`Export named 'scriptKind' not found`). Nothing in Gecko causes it. "The Firefox probe verdicts H1-H24" overstates them: gecko-lines H3, H6, H7 and
  H17-H21 aren't tested, and the stand-in makes every code point 576 au. So no test covers in-word prefixes, the emoji
  correction, script context or the width derivation.

## 3. Rules that aren't ported (task 2)

Nothing in the engine reads the DOM. There's no float epsilon or tolerance. Every rounding cites its source or the
DESIGN §4.4 recipe. `Intl.Segmenter` is used only for SA words (DESIGN §6.3).

| Where | What | Effect |
|---|---|---|
| `prepare.ts:532-550` | `isEmojiCluster` and `hasEmojiPresentation` from code point properties instead of `FindFontForChar` | changes widths (B1) |
| `prepare.ts:465-489`, `:828-830` | script-context recipe `W(ctx + ' ' + unit) − W(ctx + ' ')`; not in any Gecko spec, no gap | changes widths; exact on traced rows; not applied to suffixes (B3) |
| `lines.ts:24-30` | U+200D before a suffix between joining letters; the comment claims U+200D keeps the joined form | changes widths; see below |
| `lines.ts:578-677` | the scorer's visibility and trailing-run rules | changes `width` (B4) |
| `prepare.ts:528` | `OPTICAL_SIZE_FAMILIES`, a family-name regex (SF Pro, SF Compact, New York, `ui-*`) | gap only; no lab case uses those families |
| `prepare.ts:832` | `/Apple Color Emoji/i` test on the family string | gap only |
| `linebreak.ts:346-358` | an approximation of ICU `AddLikelySubtags` (explicit script, or zh or ja) | no lab case uses yue, wuu or similar |
| `lines.ts:430-435` | an all-collapsed pass joins the next line, without a citation | tiling only |

The U+200D recipe, measured in probe A2: W(U+200D) is 0 au in Arial and Geeza Pro, but the joined forms it's meant to
keep don't come out.

- Geeza Pro: W(`‍له.`) = W(`له.`) = 814 au, and W(`‍ه.`) = 590 au where the native final ه + `.` is 504 au. This is
  `c-5ba3b0da55cb63ad`, which RESULTS notes became worse in round 8.
- Mongolian in Arial falls back to another font, and the same strings measured differently in two documents: 2821 and
  2265 au in `debug-sample`, 2896 and 2340 au in the probe.
- W(`‍ᠡᠢ(x) `) = W(`‍ᠢ(x) `), so `c-ddb7b0c21bf3d492` predicts `ᠠᠡ` as 556 au, less than native `ᠠ` alone (755).

## 4. Traced cases (task 3)

Traced from the rows, the debug calls and the source. All ids are in `sample-ids.json`.

Failing (15):

| Case | Family | What the trace shows | Verdict |
|---|---|---|---|
| `c-0e9eee22e9d69e02` | suite/non-ascii-control | native and Canvas pinned at 1020 au; the correction gives 510 | B1(a) |
| `c-27e5b02212b7324f` | suite/woman-after-zwj/shy | suffix measured inside the cluster; prefix −210 au | B1(b) |
| `c-09a7775ba6eea10d` | suite/original-vs-reshaped-admission | suffix `(` without Arabic context, 367 vs 660 au | B3 |
| `c-8b93d57e539164e4` | suite/word | Amiri `ffi`: while scanning, Gecko gives the whole 763 au ligature to the first `f` and breaks after `o`; the port's prefix `of` = 742 fits | named gap right |
| `c-ddb7b0c21bf3d492` | suite/chromium-script-spacing | Mongolian contextual forms; the U+200D suffix gives 556 au | named gap right, recipe worse (§3) |
| `c-1c7520b02b5b5942` | ws/trailing-space-edge | Verdana legacy `kern` split in halves: `hy` −8/+8 au, `y.` −78/+78 au | named gap right |
| `c-63ccab1fe0df0cea` | ws/text-nodes | Times New Roman `’s`: native `s` 260, suffix 280; `s Oh, ` 1674 ≤ 1680 natively, 1694 predicted | named gap right |
| `c-12c0b70f8e3d11dc` | runs/split-word | bold flags: Canvas 2209 au at 36px, DOM 1104 au; synthetic bold added after rounding | named gap right |
| `c-268ee59b15a407a8` | runs/mixed-fonts-sizes | Geeza Pro 10px `ووفقك`: native glyphs 1173 au, Canvas 1172 | model limit N7, as RESULTS says |
| `c-79e5272a2644d9b8` | runs/word-spacing-spans | the −90 au space gets a 90 au rect | B4, not "open" |
| `c-5ba3b0da55cb63ad` | policy/word-break | Geeza Pro, U+200D suffix `‍ه.` 590 vs native 504 | named gap right |
| `c-a560dabf8d17cd2c` | runs/split-word | same starts as native; passes with the 10:10 scorer | observation right |
| `c-ed263bd4b6656704` | suite/maintained/accuracy | Helvetica Neue 24px, 150px: the port's prefix `Superlongwor` = 8989 au ≤ 9000, native breaks one letter earlier, so the DOM prefix is at least 9001 au; which pair carries the difference wasn't traced | named gap plausible |
| `c-dd0665732322b000` | runs/bidi-runs | Geeza Pro `اللَّهِ`: U+200D suffix gives lam 12 au, native 241 | named gap right, recipe worse |
| `c-4fb42027da798ae2` | policy/url-number | Verdana `ve`, `ny` legacy `kern` split, −3 and −4 au | named gap right |

Passing (15). None passes for the wrong reason.

| Case | Family | Rule path checked |
|---|---|---|
| `c-c7b155133ab043e4` | runs/bidi-runs | RTL frames; breaks only at spaces; no gaps |
| `c-0cbf06adce26dd9d` | runs/lang-spans | loose zh-Hant; ja span in its own text run |
| `c-82d61efb6c98ffbe` | runs/letter-spacing-spans | 3px and 2px letter spacing, none after cursive bases |
| `c-46838bf62f7e34ca` | runs/word-spacing-spans | pre-wrap, +480 au word spacing on one span's space; in-word Hangul break |
| `c-f98e572a561533c6` | runs/span-at-space | break-spaces over five fonts |
| `c-36b7a58acd085d4f` | runs/split-word | one line, mark in its own span |
| `c-930636a4afe1e654` | runs/mixed-fonts-sizes | `overflow-wrap: anywhere` inside a run of Helvetica Neue hyphens |
| `c-d0840b740198cf4d` | policy/korean | script context: `로 175` − `로 ` = 1615 au, native `175 (세종로)` 5805 |
| `c-5ec9609bc79f521a` | policy/thai | SA breaks through `Intl.Segmenter` |
| `c-f9f41d2ab90cd0c4` | policy/zh-lang | zh span, `line-break: normal`, page lang zh |
| `c-aff6324f428f0456` | policy/line-break | loose, fullwidth punctuation |
| `c-c1bd610ca1bf9496` | policy/emoji | `line-break: anywhere`; breaks at non-cluster starts dropped (`SetPotentialLineBreaks`); correction 1920 → 960 au |
| `c-f76efdf175d67968` | ws/controls | pre-line turns tabs into spaces |
| `c-bf6d7e74c5d976ea` | ws/trailing-space-edge | tab stop: 8 × 267 au space; min advance 0.5 × 946; x 1440 → tab 696 au, native 20496 au line |
| `c-a6511f8b91a2372c` | suite/maintained/accuracy | Arabic digits, ₪, Common units with context |

Two caveats:

- The emoji passes depend on document order. `c-0e9eee22e9d69e02` passes in a fresh document and fails after `😀︎`.
- The CJK, Hangul and in-word passes traced here use fonts with uniform advances (1080, 830, 1200 au) or no kerning at
  the chosen break. They don't test W(unit) − W(suffix).

## 5. Attribution checks (task 4)

| Case | RESULTS class | Verified? |
|---|---|---|
| `c-0e9eee22e9d69e02` | font-fallback, Canvas pinned | mechanism wrong: DOM pinned too, and the port's correction fails (B1a) |
| `c-27e5b02212b7324f` and families (suite counts) | font-fallback | wrong: soft hyphen inside a ligated cluster (B1b) |
| `c-40ecb4f7950b571e` | partial ligature shares | right, same mechanism as B1b |
| `c-09a7775ba6eea10d` | in-word-prefix | the gap applies, but the cause is fixable in the port (B3) |
| `c-1c7520b02b5b5942` | kerning split as HarfBuzz splits legacy `kern` | right (−8/+8, −78/+78 au) |
| `c-12c0b70f8e3d11dc` | bitmap-emoji-size | right; the gap is reported |
| `c-268ee59b15a407a8` | model limit N7 | plausible, 1 au in one word; only the broad `in-word-prefix` gap is reported |
| `c-a560dabf8d17cd2c` | observation, grapheme split | right; the 10:10 scorer passes it |
| `c-7c1bb30f6445a88a` | observation, VS16 or joiner carrying the advance | right in kind, but it's a new variant: U+3000 + VS16. The VS16 carries 960 au and the grapheme has no ink, so the scorer derives 0. `carriesInk` covers only inked graphemes; this belongs in ISSUES.md |
| `c-a1cc790386f04a1a` | painter, combining marks alone | right: painted alone, `a` becomes a cluster end and gets 60 au of letter spacing |
| `c-27d5d232618787d5` | painter L7 | right: native and predicted 2368 au; painted `7:00-` 2329 au |
| `c-79e5272a2644d9b8` | open | traced (B4) |

## 6. Gap reporting (task 5)

- **Reported as designed:** `in-word-prefix`, `font-fallback`, `ui-language` (9 suite cases with `lang=""`),
  `bitmap-emoji-size`, `space-in-shaping` (whole stretch against the unit sum) and `dictionary-breaks-unavailable`.
- **Never fire in the lab:**
  - `font-size-quantization`: every lab size is an integer, 10-32px.
  - `optical-size`: no lab case uses system-ui, SF or New York.
  - The device-size grid branch of `bitmap-emoji-size`.
  - The lab can't validate these conditions.
- **Narrower than DESIGN §5:**
  - `font-fallback` fires only for emoji presentation. Probe A2 shows Canvas fallback for Mongolian in Arial varies by
    document too, and Hebrew in Amiri reports nothing.
  - `bitmap-emoji-size` fires only on rounding ambiguity. DESIGN also names sizes and sequences that weren't probed.
- **Too broad:** `in-word-prefix` (B2).
- **Failures with no gap:**
  - runs `c-01cfe05b2ffd874b` and `c-74a40685d8d340c6` (bidi painter);
  - suite `suite/hanging-tab-control` 4, `restart-next-word`, `space-context` 2, `tab-sizing`, `hidden-control-spacing`;
  - two of those are width failures from B4.
- `hyphen-glyph`, `string-storage` and `control-character-width` are never reported. That's consistent with
  probes-firefox correction 5, Gecko's content-based 8-bit storage and stripping controls.

## 7. Other findings, not blocking

- **Tests DESIGN §6.1 and §8.2 require, still missing:**
  - the equality test of `generated/props.ts` (ICU 78.2 ppucd) against the groundwork's `icu_properties` dump;
  - the Rust oracle replay of break scans.
- **`buildLine`'s `joinsNextLine`** reads `joiningType` of code units with no unit bounds (`lines.ts:542-551`). It's
  wrong for supplementary joining scripts; painter only.
- **`scriptIsChineseOrJapanese`** matches the source on parse failure: it returns without setting the word language, as
  `nsLineBreaker.cpp:678-683` does.
- **Frame rule:** "no line boundary inside a span" matches `nsCSSFrameConstructor.cpp:6440-6451`, where only a block
  parent's list gets boundaries.
- **The `paint.ts` hyphen span change** is in the gecko branch only, and SHARED-CHANGES.md logs it.
- **RESULTS "Scores come from score.ts as of 09:41"** is stale: the round 8 summaries came from the 10:06 scorer. The
  scorer changed at 10:08 and 10:10 (§2).
- **Two lab entries added to `rebuild/lab/ISSUES.md`:**
  - U+3000 + VS16 derived as 0px (`c-7c1bb30f6445a88a`);
  - emoji rows whose native layout depends on earlier text-presentation cases in the same document
    (`c-0e9eee22e9d69e02` and about 80 more).

## 8. Resolution (Gecko owner, 2026-09-16)

Rounds 9-11 are under `.artifacts/lab/gecko/<set>-r<n>/`, with `gaps-predictor.ts` (the lab predictor plus gaps and
engine widths) and score.ts `e0a7b4be…`. Comparisons are with `audit/<set>-r8-now/`. Numbers and classes are in
specs/gecko-RESULTS.md.

### B1a: resolved by identifying the font from Canvas

- `isEmojiCluster` and `hasEmojiPresentation` are gone. For a cluster whose first character has an emoji presentation
  other than TextOnly (`GetEmojiPresentation`, nsUnicodeProperties.h:127-165), the port compares the run's context with
  a `"Apple Color Emoji"` context at the CSS size and at the device size. Only a cluster equal at both gets the sbix
  device-size advance.
- Probe gecko-port F3 (`rebuild/probes/gecko-emoji-font.ts`) supports the rule in both states. Fresh 16px Arial U+1F600
  is 1260 and 1920 au in both fonts, DOM 960 au. After `😀😀︎`, Arial gives 1020 au at both sizes, Apple Color Emoji
  still 1260 and 1920 au, DOM 1020 au. `😀︎`, `❤` and `#⃣` without VS16 differ from Apple Color Emoji, and the DOM
  equals Canvas at the CSS size.
- `font-fallback` fires only where `FindFontForChar` asks for a color glyph and Canvas shows another font drew the
  cluster: 122 suite cases, all in the pinned state.
- Round 11: `suite/non-ascii-control`, `numeric-ideograph-direction`, `pair` and `policy/pair` pass every metric. Of the
  130 suite rows whose native layout depends on the order (forward and reverse runs, `--native-compare`), 127 have no
  failure in either order; round 8 failed 118 of them.

### B1b: resolved

- `glyphBefore` at an offset inside a grapheme cluster returns the advance before the cluster's end. HarfBuzz attaches
  a clump's glyphs to its first character (gfxHarfBuzzShaper.cpp:1705-1786), and `ComputeLigatureData` gives a partial
  ligature its width per started cluster (gfxTextRun.cpp:238-322).
- The 36 lineCount failures of `skin-modifier/shy`, `woman-before-zwj/shy` and `woman-after-zwj/shy` pass, and smoke
  `c-40ecb4f7950b571e` passes lineCount. Their painter failures (84 each) are a painter loss: painted alone, the rest
  of a ligated sequence draws as its own emoji.
- There `in-word-prefix` fires only where the rest of the cluster has an advance of its own in Canvas.

### B2: resolved

- The prepare-time count is gone. `nextLine` reports `in-word-prefix` at the first in-word offset the layout consults
  where Canvas can't confirm the recipe: W(prefix) + W(suffix) ≠ W(unit) in the unit's script context, letters joining
  across the offset, or the cluster case above. The prepared paragraph lives for one layout, so the gap describes the
  chosen lines.
- Suite: 5,260 cases report it (was 18,610), 2,715 of the 15,124 all-pass cases (was 13,768 of 15,000). Runs 604, ws 91,
  policy 106, smoke 46.
- Where it can't see: a ligature whose width equals its parts (`c-daf9c7047097f77b`, Helvetica Neue `fi`, natively 217
  and 218 au by cluster share) fails widths with no gap. The other suite failures with no gap are painter losses and
  per-glyph rounding (N7).

### B3: resolved

- One recipe, `rangeAu` (prepare.ts), measures units, suffixes and the check's prefixes in the script the paragraph
  gives the piece. `c-09a7775ba6eea10d`: suffix `((` 1320 au, `(` 660 au. lineCount and breaks pass; widths still fail
  at the lam|alef offset, which reports the gap.
- Suite `original-vs-reshaped-admission` went from 23 lineCount and 27 breaks failures to 11 and 11, and
  `partial-source-context` breaks pass.
- The recipe now cites `gfxScriptItemizer` and `gfxHarfBuzzShaper.cpp:1405-1438`. I didn't add a gap for it. The U+0020
  between the context and the piece is a shaping boundary, and `space-in-shaping` reports fonts whose space glyph takes
  part in shaping.

### B4: resolved, with one correction to the finding

- `width` comes from cluster geometry. Range rects cover clusters; a piece whose advance isn't positive has no rect;
  white space a frame removed at the line end spans to the frame's edge; hidden controls with letter spacing count.
  `c-79e5272a2644d9b8`, `c-92b6963ae4344985` and `c-fc59a73aa616baff` pass widths and painter.
- Correction: "a space whose advance isn't positive has no rect" does hold inside a line and at a pre-wrap line end.
  `c-4aafc349e1c161fd` and `c-3b2e9519e5b651d4` have −270 and −218 au spaces that observe 0 wide. Round 9 gave them rects
  and lost 6 runs widths. The 90 au rect of `c-79e5272a2644d9b8` comes from `TrimTrailingWhiteSpace` growing the frame,
  which the port models now.
- The visibility categories still follow lab/README.md, as DESIGN §2.1 asks; the geometry is Gecko's.

### Other items

- §7 props test: `props.test.ts` checks the generated props against icu_properties 2.1.2 for every code point. It found
  210,383 code points ppucd covers only with block lines (CJK Ext A-J, private use, surrogates) that the generator had
  left at Cn, N and Zzzz. `gen-gecko-data.ts` now fills block values first through the additive `forEachPpucdBlock`
  (SHARED-CHANGES.md). Emoji_Presentation, Emoji_Modifier and Joining_Type aren't in the dump.
- §7 Rust oracle replay of break scans: still not done.
- §7 `joinsNextLine` uses the unit-bounded joining scan.
- §6 no-gap failures `hidden-control-spacing` and `space-context` pass. The runs no-gap width failures were synthesized
  Unicode spaces: U+2009 at 18px is 240 au in Canvas and 210 au in the DOM (gfxTextRun.cpp:3032-3043). The port
  corrects them where Canvas measures the synthesized value at both sizes. U+2007 and U+2008, which take font metrics,
  aren't corrected.
- §3 table:
  - `/Apple Color Emoji/i` is removed.
  - `OPTICAL_SIZE_FAMILIES` and the `AddLikelySubtags` approximation stay; no lab case exercises them.
  - The empty-line join cites `nsLineLayout::VerticalAlignLine`.
  - The U+200D suffix recipe stays, and `in-word-prefix` names every offset that uses it.
- §6 `font-fallback` stays narrower than DESIGN §5: the port reports only the emoji state Canvas can show. The document
  differences for Mongolian in Arial aren't reported.
- §2 the stale scorer note and test count in RESULTS are updated.
