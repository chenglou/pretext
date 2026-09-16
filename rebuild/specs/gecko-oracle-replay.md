# Gecko break scan against the Rust oracle (Firefox 156.0)

DESIGN.md §8.2 names the Gecko scan's offline replay as missing: the port in `rebuild/src/engines/gecko/` was tested in
installed Firefox with the lab, but its break opportunities were never compared against the groundwork's Rust oracle.
This replays every lab paragraph and 100,000 fuzz paragraphs through both. Outputs, tools and the oracle build are in
`.artifacts/gecko-oracle-replay/`.

Result: the port and the oracle agree on every position of every lab paragraph. The fuzz corpus shows two difference
classes: a port bug in how a language tag turns into the Chinese/Japanese flag (400 positions, only for tags such as
`yue`, `wuu` and `und-TW`, which no lab case uses), and one position where a supplementary SA character moves a
Thai boundary out of the excluded run. That position shows bun's segmenter differing from Firefox's models, not a port
bug.

## 1. The oracle

- Built as specs/gecko-canvas.md §4.4 says: `pretext-emulation-20260915/oracle/gecko/{src,Cargo.toml,Cargo.lock}` copied
  to `.artifacts/gecko-oracle-replay/oracle156`, `[patch.crates-io] icu_segmenter_data` pointed at
  `firefox-156.0/intl/icu_segmenter_data`, `nice -n 10 cargo build --release --offline`: 5.6 s, no source change. The
  smoke outputs equal `data/gecko/oracle-build-156.json` (`hello world foo-bar` → `[6,12,16]`), and `--dump-tables`
  hashes to `0935cdebb84b67a3…`.
- `third_party/rust/icu_segmenter/src/line.rs` and `complex/mod.rs` in firefox-156.0 are byte-identical to the crate
  the oracle builds.
- The groundwork's `analyze` covers one text node with `line-break: auto`, `white-space: normal | pre-wrap` and a single
  `nsLineBreaker::AppendText` call. The lab needs more, so the copy adds `src/flows.rs` and the `gecko-flows` binary,
  ported from firefox-156.0 C++ with citations. The groundwork's files are unchanged.
  - A block of mapped flows: `TransformText` per flow with the carried `INCOMING_WHITESPACE`, `COMPRESS_WHITESPACE` for
    `pre-line`, `COMPRESS_NONE` for `pre` and `break-spaces` (nsTextFrameUtils.cpp:211-401, nsTextFrame.cpp:1335-1354).
  - `HasCompressedLeadingWhitespace` over the node's buffer (nsTextFrame.cpp:2867-2887, :921-942).
  - Glyph flags per text run with the groundwork's `build_text_run_glyphs`.
  - `nsLineBreaker` in full: 16-bit and 8-bit `AppendText` with words that continue across flows, `FlushCurrentWord`
    with `BREAK_SUPPRESS_INITIAL` and `BREAK_SUPPRESS_INSIDE`, `BREAK_SKIP_SETTING_NO_BREAKS` and the text run's
    `NoBreaks` flag, `SetWordBreak` and `SetStrictness`, `line-break: anywhere` without ICU4X, `Reset`'s trailing break
    (nsLineBreaker.cpp:134-720, nsLineBreaker.h:169-203, nsTextFrame.cpp:1219-1235, :2889-2997).
  - `LineBreaker::ComputeBreakPositions` for every strictness, with the `zh` content locale for Chinese or Japanese
    (LineBreaker.cpp:26-194).
  - A `segment` mode: `LineSegmenter::new_auto(options).segment_utf16` with a given strictness, word option and `jaZh`.
- Text travels as UTF-16 code units, so lone surrogates reach both sides unchanged.
- Checks of the oracle itself:
  - `tools/self-check.ts`: `gecko-flows` with one flow equals `analyze` on 18,910 well-formed fuzz strings (white-space
    normal or pre-wrap, every word-break, line-break auto), 0 mismatches (`self-check.json`).
  - `tools/tables-check.ts`: the port's generated segmenter data decodes to what the oracle was built with. Line
    classes for every code point, grapheme classes, the 4,624 line break states, property count, sot, eot and complex
    property: 0 differences (`tables-check.json`).

## 2. What was compared

Inputs: every paragraph of `.artifacts/lab/cases/{smoke,runs,ws,policy,suite-sample}.ndjson` (300, 2,580, 1,019, 1,606
and 20,000 cases; the suite sample includes 112 Chrome- and Safari-only rows), plus 100,000 fuzz paragraphs
(`tools/fuzz.ts`, seed 20260916).

- Each fuzz paragraph is 1-30 tokens: ASCII words and numbers, spaces, tabs, LF, CR, FF, VT, ASCII and Unicode
  punctuation, Han (Ext B too), kana with small kana and iteration marks, halfwidth kana, CJK and fullwidth punctuation,
  Hangul syllables and jamo, Arabic with marks, Hebrew with niqqud and maqaf, emoji sequences (ZWJ, skin tones, flags,
  keycaps, tags, VS15, VS16, lone RI), C0, C1 and format controls, bidi controls, NBSP, SHY, Unicode spaces, combining
  marks, Thai, Lao, Khmer, Myanmar, Tai Tham, Tai Viet, New Tai Lue, Ahom, Latin-1, Greek, Cyrillic, random BMP
  characters and lone surrogates.
- Half the fuzz paragraphs are split into 2-4 runs (span or bare text node, a span sometimes with its own `lang`).
- The styles are random: every `white-space`, `word-break` (including `break-word`) and `line-break` value, `direction`,
  and `lang` from `en ja zh zh-Hant zh-TW ko ar he th yue und ja-Latn zh-Latn wuu und-TW km my lo ""`.

Two layers, run by `tools/gen.ts` (port) and `gecko-flows` (oracle), compared by `tools/compare.ts`:

- **segment**: the paragraph's concatenated text through `icu4xLineBoundaries` (linebreak.ts:88-271) against ICU4X's
  `LineSegmenter` with the same options.
  - Lab paragraphs pass their styles: strictness from `line-break` (`auto` → strict), the word option from `word-break`
    (`break-word` → normal), `jaZh` when `lang` starts with `ja` or `zh`.
  - Fuzz paragraphs draw all three at random.
  - Positions: every UTF-16 offset from 0 to the length that starts a code point, or where either side reports a
    boundary.
- **scan**: `prepareGecko`'s break flags against the oracle's block scan.
  - The oracle takes the port's frames as its flows (`start`, `end`, node range, the run's `lang`, and whether the frame
    starts a new text run). Frame construction, bidi splits and text-run joining are the port's, not checked here.
    Everything inside and between the flows is checked: transform, glyph flags, `nsLineBreaker`, ICU4X.
  - Positions: every transformed character after the block's first, keyed by source offset. The class is `N`
    (`FLAG_BREAK_TYPE_NORMAL`), `E` (`FLAG_BREAK_TYPE_EMERGENCY_WRAP` on a cluster start) or none. The kept source
    offsets and the trailing break are compared too.
- The port runs in bun with a stand-in OffscreenCanvas (widths don't reach break flags), `devicePixelRatio` 1 and
  `dictionaryBreaks: 'intl-segmenter-word'`.
- Offsets strictly inside a run of SA characters of one language (Thai, Lao, Myanmar or Khmer per complex/language.rs)
  are counted apart wherever ICU4X runs its complex breaker (word option not break-all, strictness not anywhere). There
  the port takes boundaries from the running browser's `Intl.Segmenter` (linebreak.ts:35-60), which in bun is
  JavaScriptCore's ICU dictionaries, not Firefox's LSTM models.

## 3. Counts

Positions agreeing / differing, and SA-run interior positions agreeing / differing:

| Set | Paragraphs | segment | segment SA interior | scan | scan SA interior |
|---|---|---|---|---|---|
| smoke | 300 | 10,825 / 0 | 566 / 51 | 10,337 / 0 | 566 / 51 |
| runs | 2,580 | 138,285 / 0 | 4,656 / 369 | 134,223 / 0 | 4,656 / 369 |
| ws | 1,019 | 33,593 / 0 | 0 / 0 | 31,126 / 0 | 0 / 0 |
| policy | 1,606 | 52,206 / 0 | 6,606 / 427 | 50,587 / 0 | 6,606 / 427 |
| suite sample | 20,000 | 749,274 / 0 | 92,063 / 4,792 | 708,105 / 0 | 92,063 / 4,792 |
| fuzz | 100,000 | 4,293,832 / 1 | 139,944 / 47,873 | 4,125,681 / 401 | 202,648 / 47,392 |
| total | 125,505 | 5,278,015 / 1 | 243,835 / 53,512 | 5,060,059 / 401 | 306,539 / 53,031 |

- No errors on either side. The kept source offsets are equal for all 125,505 paragraphs. Trailing breaks agree for
  all 124,907 paragraphs that have a text run.
- The scan's 401 differing positions are in 348 fuzz paragraphs.
- With a stand-in segmenter that answers each SA slice from the oracle's own complex breaker (§5), every SA interior
  position agrees (segment 297,347, scan 359,570), the segment layer has no difference, and the scan layer keeps only
  the 400 positions of §4.1.

## 4. Difference classes

### 4.1 Chinese/Japanese from likely subtags (port bug)

400 scan positions in 347 fuzz paragraphs, 0 in the lab. In every one the port has no break and the oracle has a normal
break, under `line-break: loose` (351) or `normal` (49). Every paragraph has a flow whose language is `wuu`, `yue` or
`und-TW`.

- Gecko: `nsLineBreaker::UpdateCurrentWordLanguage` parses the tag and, without a script subtag, adds likely subtags
  (nsLineBreaker.cpp:674-686). `mozilla::intl::Locale::AddLikelySubtags` calls ICU4C's `uloc_addLikelySubtags`
  (intl/components/src/Locale.cpp:907-930). The word is Chinese or Japanese when the script is Hans, Hant, Jpan or Hrkt,
  and `LineBreaker::ComputeBreakPositions` then passes the `zh` content locale (LineBreaker.cpp:99-109), which sets
  ICU4X's `ja_zh` (line.rs:240-246).
- Port: `scriptIsChineseOrJapanese` (linebreak.ts:344-358) returns true only for primary subtags `zh` and `ja` or an
  explicit Hans/Hant/Jpan/Hrkt subtag.
- ICU 78.3 (`.artifacts/gecko-oracle-replay/likely/likely.c`) gives `yue` → Hant, `wuu` → Hans, `und-TW` → zh_Hant_TW,
  and also `cmn`, `hak`, `nan`, `gan` → Hans, `lzh` → Hant, `und-HK` → Hant, `und-JP` → Jpan. The oracle expands with
  ICU4X's `LocaleExpander`, which agrees on the three fuzz tags. For `ja-Latn`, `zh-Latn` and every tag in the lab
  cases (`en ko ja ar he th zh-Hans zh-Hant zh hi "" my zh-CN ur km mul`) ICU4C agrees with the port.
- The rules the flag switches on:
  - `line-break: normal`: break before U+301C and U+30A0 (line.rs:913-917, :1124-1129).
  - `line-break: loose`: before the NS characters U+301C, U+30A0, U+30FB, U+FF1A, U+FF1B, U+FF65, U+203C and
    U+2047-U+2049, before U+FF01 and U+FF1F, before PO_EAW, and after PR_EAW (line.rs:721-780, :918-929).

Minimal examples, one run each unless noted, white-space normal where it doesn't matter (`tools/minimize.ts`,
`minimal.ndjson`). Firefox allows the break at `|`; the port doesn't:

| Text | lang | Other styles | Rule |
|---|---|---|---|
| `ぉ\|゠` (U+3049 U+30A0) | und-TW | line-break normal | normal, U+30A0 |
| `あ\|；` (U+3042 U+FF1B) | yue | line-break loose | loose NS |
| `e\|′` (U+0065 U+2032) | wuu | line-break loose, word-break break-word | loose PO_EAW |
| `¤\|م` (U+00A4 U+0645) | yue | line-break loose, word-break break-all | loose after PR_EAW |
| `W\|？` (U+0057 U+FF1F) | wuu | line-break loose, word-break keep-all | loose EX |
| `4\|・` (U+0034 U+30FB) in `<span lang="yue">` | paragraph en | line-break loose, white-space break-spaces | loose NS, per-span language |

The fix belongs in the port's language step: the likely script of the tag as ICU4C's likely subtags give it, not the
primary subtag.

### 4.2 A supplementary SA character shifts the complex breaker's boundaries (not a port bug)

1 segment position and 1 scan position, both in `fuzz:87164`. Minimal: `ณ𑜉ᦃฆๆ` (U+0E13 U+11709 U+1983 U+0E06
U+0E46). The oracle breaks between U+1983 and U+0E06 (offset 4), the port doesn't.

- `line_handle_complex_language` for UTF-16 pushes one `as u16` unit per code point (line.rs:1263-1316), so its
  cached boundaries count code points. The cache loop in `next` advances by the UTF-16 length (line.rs:841-852). After
  the Ahom letter U+11709 every cached boundary lands one unit early.
- The port copies both steps (linebreak.ts:182-184 truncates, :132 advances by 2 for a supplementary character), so it
  shifts the same way.
- The run splits into Thai `ณ`, the non-model slice `U+1709 U+1983`, and Thai `ฆๆ`. ICU4X's LSTM breaks `ฆ|ๆ`
  (offset 4 of the complex string), which the shift moves to between U+1983 and U+0E06. That is a slice edge, so the
  replay compares it. bun's `Intl.Segmenter` gives no break inside `ฆๆ`, so the port has nothing to shift.
- The class is the running-browser segmenter dependence of §2 showing through the shift. In installed Firefox the port's
  `Intl.Segmenter` runs Firefox's models (specs/gecko-text.md §10); the stand-in run of §5 removes this difference.
- No lab case contains a supplementary SA character.

## 5. SA runs

The SA interior counts in §3 compare bun's `Intl.Segmenter` with Firefox's LSTM models, so they say nothing about the
port. The stand-in run (`gen.ts --segmenter=record`, `gecko-flows` over the recorded slices, `gen.ts
--segmenter=oracle`, `compare.ts --out=standin --oracle-dir=.`) answers every slice the port hands `Intl.Segmenter`
with the oracle's `LineSegmenter` on that slice alone (89,538 distinct slices). Every SA interior position then agrees, 0
differing: smoke 617, runs 5,025, policy 7,033 and suite sample 96,855 in both layers, fuzz 187,817 (segment) and
250,040 (scan). So the port's handling around the segmenter matches ICU4X's: slicing the run by language, the cached
boundaries, and truncating supplementary characters. This replay doesn't test whether Firefox's word-granularity
`Intl.Segmenter` returns the same boundaries as the line segmenter's LSTM on these slices; specs/gecko-text.md §10
assumes it does.

## 6. Against the lab failure lists

- Round 11 of specs/gecko-RESULTS.md fails `breaks` or `lineCount` in 35 cases: runs 3, ws 2, policy 1, suite sample 29.
  All 35 are in the replayed case files, and the scan and segment layers agree on every position of their paragraphs.
- Neither difference class can occur in lab rows: no lab language is affected by §4.1, and no lab text has a
  supplementary SA character (§4.2).
- The failure classes gecko-RESULTS.md attributes (joining and kerning at in-word breaks, device-size emoji rounding,
  painter losses) are width and painting classes. This replay finds no break-opportunity class behind them.

## 7. Limits of this replay

- The flows come from the port. A wrong frame split, bidi level run or text-run join would feed both sides the same
  input.
- The oracle's multi-flow paths (TransformText carry, `pre-line`, suppression flags, strictness, words across flows) are
  a second port of the same C++, checked against `analyze` only for one flow. Agreement with the port is evidence, but a
  misreading both ports share would not show.
- Not modelled on either side, and absent from the lab page: auto hyphenation and capitalization (`hyphens: manual`, no
  `text-transform`), `<br>` and placeholders that flush the line breaker (nsTextFrame.cpp:2232-2272), languages that
  aren't explicit (`mExplicitLanguage`), and SVG text.
- `LineBreakCache` (LineBreaker.cpp:129-151, :178-193) returns what the segmenter returned for the same key and isn't
  modelled.

## 8. Reproduce

```sh
cd .artifacts/gecko-oracle-replay/oracle156 && nice -n 10 cargo build --release --offline
cd ../tools
bun tables-check.ts && bun self-check.ts --count=20000
bun gen.ts --fuzz=100000
../oracle156/target/release/gecko-flows < ../segment-requests.ndjson > ../segment-oracle.ndjson
../oracle156/target/release/gecko-flows < ../scan-requests.ndjson > ../scan-oracle.ndjson
bun compare.ts            # summary.json, differences-{segment,scan}.ndjson
bun minimize.ts ../targets.json > ../minimal.ndjson
mkdir -p ../standin && bun gen.ts --out=standin --segmenter=record
../oracle156/target/release/gecko-flows < ../standin/sa-slices.ndjson > ../standin/sa-slices-oracle.ndjson
bun gen.ts --out=standin --segmenter=oracle && bun compare.ts --out=standin --oracle-dir=.
```

Timings on the 125,505 paragraphs: port 5 s, oracle 3.6 s, compare 1.2 s.
