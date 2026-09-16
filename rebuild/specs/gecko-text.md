# Gecko text preparation and break opportunities (Firefox 156.0)

This spec covers what Firefox does to styled inline text *before* it fills lines: which text nodes get
frames, how bidi splits frames, which frames share one shaped string, how white space and control
characters are transformed, and where break opportunities come from. The line-fill loop itself
(`gfxTextRun::BreakAndMeasureText`, `nsLineLayout`) belongs to another spec; this one names the facts that
loop consumes and cites where it consumes them.

## 0. Revisions, conventions, terms

### 0.1 Revisions (verified)

- Firefox 156.0 = tag `FIREFOX_156_0_RELEASE`, commit `3bf8f468`, sparse checkout at
  `~/github/browser-engines/firefox-156.0`.
- ICU4X `icu_segmenter` 2.1.2 and `icu_provider` 2.1.1 (`ff:Cargo.lock:3803-3805`, `:3776-3778`).
- Firefox's own baked segmenter data `ff:intl/icu_segmenter_data/data/*.rs.data`, generated at icu4x commit
  `3579f233` (`ff:intl/icu_segmenter_data/data/ICU4X-GIT-INFO:1`) with CLDR 48.0.0 and icuexport
  release-78.1 (`ff:intl/update-icu4x.sh:17-20`). The Burmese, Khmer, Lao and Thai dictionaries are replaced
  with `empty.toml` before datagen (`ff:intl/update-icu4x.sh:58-67`).
- Bidi algorithm: Rust `unicode-bidi` 0.3.15 at git rev `ca612daf` (`ff:Cargo.lock:8441-8443`), selected at
  compile time by `#define USE_RUST_UNICODE_BIDI 1` (`ff:intl/components/src/Bidi.h:11-13`,
  `ff:intl/components/src/Bidi.cpp:22-27`). Its tables are Unicode 15.0.0
  (`ff(git):third_party/rust/unicode-bidi/src/char_data/tables.rs:8`).
- 155.0.1 → 156.0. I downloaded nine files at `FIREFOX_155_0_1_RELEASE` from raw.githubusercontent.com and
  diffed them against the checkout:
  - byte-identical: `nsTextFrame.cpp`, `nsTextFrameUtils.cpp`, `nsLineBreaker.cpp`, `LineBreaker.cpp`,
    `nsBidiPresUtils.cpp`;
  - changed, no effect on this topic: `gfxTextRun.cpp` (a 3-line hash helper at `:2588-2590`), `gfxFont.cpp`
    (37 lines inside `#if MOZ_FONTATIONS`, `InitMetricsFromSkrifa`), `nsStyleStruct.h` (defaulted
    comparison operators), `CanvasRenderingContext2D.cpp` (a font-group cache and a
    `specifiedFont`/`resolvedFont` split; the measure path only moved lines).
  - The groundwork's copies of `icu_segmenter/src/line.rs`, `icu_capi/src/segmenter_line.rs`,
    `nsTextRunTransformations.cpp`, `nsUnicodeProperties.{h,cpp}`, `UnicodeProperties.h`,
    `intl/lwbrk/Segmenter.cpp`, `js/src/builtin/intl/Segmenter.cpp`, `gfxScriptItemizer.cpp` and
    `CharacterData.cpp` are byte-identical to 156.
  - The groundwork oracle's vendored baked data (line, grapheme, LSTM, extended dictionary) is
    byte-identical to 156's (`cmp`).

### 0.2 Conventions

- `ff:path:line` is a file in the 156 checkout. `ff(git):path:line` is the same commit read with
  `git -C ~/github/browser-engines/firefox-156.0 show HEAD:path`, because that directory is not in the
  sparse checkout.
- **oracle** means the groundwork binary
  `~/github/browser-engines/pretext-emulation-20260915/runtime-parity/gecko-speed/target/oracle/release/gecko-breaks`,
  a Rust port of `nsLineBreaker` over `icu_segmenter` 2.1.2 and Firefox's baked data. I used it only to
  evaluate ICU4X's pair table on probe strings. Its results are UTF-16 offsets where a line may start. Every
  rule it applies is cited from source below.
- Strings are written with JavaScript escapes (`"ab"`).

### 0.3 Terms

- **App unit (au)**: 1/60 CSS px. CSS lengths convert with `NS_lroundf(px * 60)` computed in float32
  (`ff:layout/style/ServoStyleConstsInlines.h:584-595`, `:598-604`; `ff:gfx/src/nsCoord.h:296`).
- **Text frame**: the layout object for one piece of one DOM text node. A node split by line breaking or by
  bidi has several pieces, called **continuations**. Line breaking makes *fluid* continuations; bidi
  splitting makes *non-fluid* ones.
- **Mapped flow**: a run of consecutive fluid text frames of one text node inside one text run
  (`ff:layout/generic/nsTextFrame.cpp:1199-1217`).
- **Text run** (`gfxTextRun`): the transformed characters of one or more mapped flows, shaped as one string
  with one font group, one language and one flag set.
- **Transformed text**: text after `TransformText` (white space collapsed, soft hyphens and bidi controls
  removed). Removed characters are **skipped**; `gfxSkipChars` maps DOM offsets to text-run offsets.
- **Line-breaker run**: all text fed to one `nsLineBreaker` between two `Reset()` calls. It usually spans
  many text runs.
- **Word** (in `nsLineBreaker`): a maximal run of transformed characters without U+0020, U+0009 or U+000D.
  In 16-bit text a U+000A also ends a word.
- **Break flag before i**: the 2-bit value stored on character i of a text run: NONE 0, NORMAL 1, HYPHEN 2
  (`ff:dom/base/nsLineBreaker.h:26-31`), EMERGENCY_WRAP 3 (`ff:gfx/thebes/gfxFont.h:788`).
- **8-bit and 16-bit text**: a DOM text node is stored as Latin-1 bytes unless a code unit is ≥ U+0100
  (`ff:dom/base/CharacterDataBuffer.cpp:285-288`), it contains RTL characters, or it is flagged as
  frequently modified (`ff:dom/base/CharacterData.cpp:290-292`). A text run is 16-bit if any of its mapped
  flows is (`ff:layout/generic/nsTextFrame.cpp:1868`, `:2523-2541`, `:2735`).

## 1. Pipeline at a glance

For one block of inline text:

1. **Style predicates** (§2): each element's `white-space`, `word-break`, `overflow-wrap`, `line-break`,
   `hyphens`, `letter-spacing`, `word-spacing`, `tab-size`, `text-transform`, `direction`,
   `unicode-bidi`, `lang` become a compression mode, wrap flags, a language atom and spacing values.
2. **Frame construction** (§3) drops text nodes that contain only ASCII white space at a line boundary.
3. **Bidi resolution** (§4), only in documents where bidi is enabled, splits text frames where the embedding
   level changes and after preserved newlines.
4. **Text-run building** (§5): `BuildTextRunsScanner` walks the block's lines and groups frames into text
   runs. For each mapped flow it runs `TransformText` (§6) and then shapes the run (§7).
5. **Break opportunities** (§8-§10): the same scanner feeds every flow's transformed text into one
   `nsLineBreaker`. It accumulates words across flows and text runs and calls ICU4X once per word. Results
   reach each text run through `SetPotentialLineBreaks`, which drops breaks inside grapheme clusters.
6. **During the fill** (§11-§12): soft-hyphen opportunities are read from the DOM text, emergency flags from
   shaping are consulted, and letter-, word- and tab spacing are added per character.

What a port needs to produce, per paragraph:

- for each text run: its transformed string, the DOM↔transformed offset map, font, language, flags and
  direction;
- for each transformed character: its break flag, whether it starts a grapheme cluster, and whether it is a
  space (`CharIsSpace`), tab, newline, formatting control or zero-width invalid character;
- for each frame: letter-spacing and word-spacing in au, tab size, and the white-space predicates.

## 2. Step A: style inputs

### 2.1 `white-space` and its longhands

`white-space` is a shorthand of `text-wrap-mode` and `white-space-collapse`
(`ff:servo/components/style/properties/shorthands.toml:549-550`). The parser
(`ff:servo/components/style/properties/shorthands.rs:909-953`) maps the special keywords at `:917-922`.
Anything else is parsed as a combination of the two longhands, each defaulting to its initial value.

| `white-space` | `text-wrap-mode` | `white-space-collapse` | compression mode (§2.2) |
|---|---|---|---|
| `normal` | wrap | collapse | `COMPRESS_WHITESPACE_NEWLINE` |
| `nowrap` | nowrap | collapse | `COMPRESS_WHITESPACE_NEWLINE` |
| `pre` | nowrap | preserve | `COMPRESS_NONE` |
| `pre-wrap` | wrap | preserve | `COMPRESS_NONE` |
| `pre-line` | wrap | preserve-breaks | `COMPRESS_WHITESPACE` |
| `break-spaces` | wrap | break-spaces | `COMPRESS_NONE` |
| (longhand only) `white-space-collapse: preserve-spaces` | as given | preserve-spaces | `COMPRESS_NONE_TRANSFORM_TO_SPACE` |

Longhand keywords: `ff:servo/components/style/properties/longhands.toml:4268-4274` (`collapse`,
`preserve`, `preserve-breaks`, `break-spaces`, Gecko extra `preserve-spaces`) and `:4021-4027` (`wrap`,
`nowrap`).

Predicates (`ff:layout/style/nsStyleStruct.h:1324-1367`, `ff:layout/style/nsStyleStructInlines.h:18-34`):

```ts
WhiteSpaceIsSignificant   = collapse !== 'collapse' && collapse !== 'preserve-breaks'
NewlineIsSignificantStyle = collapse in {'preserve', 'preserve-breaks', 'break-spaces'}
NewlineIsSignificant(f)   = NewlineIsSignificantStyle && !f.ShouldSuppressLineBreak() && !textCombineUpright
WhiteSpaceCanWrap(f)      = wrapMode === 'wrap' && !inSVGText && !textCombineUpright
WhiteSpaceCanHangOrVisuallyCollapse = wrapMode === 'wrap' && collapse !== 'break-spaces'
EffectiveWordBreak        = wordBreak === 'break-word' ? 'normal' : wordBreak
EffectiveOverflowWrap     = wordBreak === 'break-word' ? 'anywhere' : overflowWrap
WordCanWrap(f)            = WhiteSpaceCanWrap && EffectiveOverflowWrap in {'break-word', 'anywhere'} && !inSVGText
```

`ShouldSuppressLineBreak` concerns ruby (`ff:layout/generic/nsTextFrame.cpp:3441-3446`) and is false for the
content in scope.

### 2.2 Compression mode

`GetCSSWhitespaceToCompressionMode` (`ff:layout/generic/nsTextFrame.cpp:1335-1354`):

```ts
switch (collapse) {
  case 'collapse':        return COMPRESS_WHITESPACE_NEWLINE
  case 'preserve-breaks': return COMPRESS_WHITESPACE
  default: /* preserve, preserve-spaces, break-spaces */
    return NewlineIsSignificant(frame) ? COMPRESS_NONE : COMPRESS_NONE_TRANSFORM_TO_SPACE
}
```

### 2.3 Other properties

- `word-break`: `normal | break-all | keep-all | break-word` (`ff:servo/components/style/values/specified/text.rs:868-878`).
  `break-word` behaves as `word-break: normal` plus `overflow-wrap: anywhere` (§2.1).
- `overflow-wrap`: `normal | break-word | anywhere` (`text.rs:986-990`). It affects only the fill loop,
  through `WordCanWrap` (`ff:layout/generic/nsTextFrame.cpp:11139`, `ff:gfx/thebes/gfxTextRun.cpp:1068-1074`),
  and min-content, where only `anywhere` breaks every cluster (`nsTextFrame.cpp:9952-9960`).
- `line-break`: `auto | loose | normal | strict | anywhere` (`text.rs:960-966`).
- `hyphens`: `manual | none | auto`; the initial value is `manual`
  (`ff:servo/components/style/properties/longhands.toml:3970-3977`).
- `tab-size`: initial `8` (a number of spaces) (`longhands.toml:2602-2608`).
- `text-autospace`: initial `no-autospace` even though its pref is on (`longhands.toml:2610-2619`;
  `ff:layout/style/nsStyleStruct.h:1244-1245`, `:1317-1322`).
- `-moz-control-character-visibility`: enabled only in chrome documents (`longhands.toml:2518-2528`). Its
  default comes from `layout.css.control-characters.visible` (`text.rs:931-940`), which is false in release
  builds (§16), so it is `hidden`.
- `letter-spacing` and `word-spacing` resolve per frame to integer au (`nsTextFrame.cpp:1949-1980`;
  §12). Percentages resolve against the font size in au.

### 2.4 Language

- `lang` on an element sets `nsStyleFont::mLanguage` and `mExplicitLanguage = true`
  (`ff:layout/style/GeckoBindings.cpp:1243-1246`).
- Without any `lang`, `mLanguage = Document::GetLanguageForStyle()`: the `Content-Language` atom, else
  `mLanguageFromCharset` (`ff:dom/base/Document.cpp:20830-20835`; `ff:layout/style/nsStyleStruct.cpp:226`).
  For UTF-8 documents that is the **browser locale language**: the encoding table maps UTF-8 to `nullptr`
  (`ff(git):intl/locale/EncodingsByFrequency.inc:6`, `:11`), and `EncodingToLang::Initialize` replaces
  `nullptr` with `GetLocaleLanguage()` (`ff(git):intl/locale/EncodingToLang.cpp:53-62`). That is the OS
  regional-prefs locale, lowercased (`ff(git):intl/locale/nsLanguageAtomService.cpp:107-127`).
- Consumers:
  - `TransformText` uses `mLanguage`, explicit or not (`nsTextFrame.cpp:2495`, `:2517-2518`).
  - `nsLineBreaker` gets only an explicit language (`nsTextFrame.cpp:2898-2899`).
  - Shaping uses the font group's language, which is `mLanguage`
    (`ff:gfx/thebes/gfxHarfBuzzShaper.cpp:1470-1481`).

## 3. Step B: which text nodes get frames

`nsCSSFrameConstructor::ConstructFramesFromItem` skips a text node when **all** of these hold
(`ff:layout/base/nsCSSFrameConstructor.cpp:5263-5290`):

1. `AtLineBoundary` (`:5220-5256`):
   - the node is first in its item list, the list has a line boundary at its start, and the node has no
     previous DOM sibling; **or** the previous item is a line boundary (a block item or a `<br>`,
     `ff:layout/base/nsCSSFrameConstructor.h:1171-1173`) and is the node's previous DOM sibling;
   - or the symmetric conditions at the end.
   - A block's children list has a line boundary at its start when there is no previous sibling frame, or
     that sibling is not inline-outside, or it is a `<br>`; symmetrically at the end
     (`nsCSSFrameConstructor.cpp:6440-6451`).
2. `!WhiteSpaceOrNewlineIsSignificant`, i.e. `white-space` is `normal` or `nowrap` (`nsStyleStruct.h:1347-1349`).
3. The parent has no Shadow DOM, the node is not generated content and not in SVG text, and the item is a line
   participant.
4. `mAlwaysCreateFramesForIgnorableWhitespace` is false. It becomes true after some script queries on such
   nodes (`nsCSSFrameConstructor.cpp:7099-7111`).
5. `TextIsOnlyWhitespace()`:
   - the node is stored as **8-bit** text, and every character is in {U+0020, U+0009, U+000A, U+000D, U+000C}
     (`ff:dom/base/CharacterData.cpp:486-515`, `:539-570`; `ff:dom/base/nsINode.h:75-82`);
   - 16-bit storage never counts as white space (`CharacterData.cpp:500-508`).

Examples in `<div>`:

- `"\n  "` before a first `<span>`: no frame.
- `" "` between two `<span>`s: a frame, because it is not at a line boundary.
- `""` alone: a frame (VT is not HTML white space).
- `"　"` alone: a frame (16-bit).

A node that keeps its frame still collapses and trims through §6 and the fill's leading-whitespace skip
(`ff:layout/generic/nsTextFrame.cpp:10935-10951`).

## 4. Step C: bidi resolution splits frames

### 4.1 When bidi runs at all

- `Document::mBidiEnabled` is set when:
  - a text node whose buffer contains RTL characters is set or bound (`ff:dom/base/CharacterData.cpp:290-303`,
    `:406-411`). "RTL characters" is `encoding_rs::mem::is_utf16_bidi`: the blocks U+0590-U+08FF,
    U+FB1D-U+FDFF, U+FE70-U+FEFE, U+10800-U+10FFF and U+1E800-U+1EFFF, plus RLM U+200F, RLE U+202B, RLO U+202E
    and RLI U+2067 (`ff:intl/unicharutil/util/nsBidiUtils.h:107-111`;
    `ff(git):third_party/rust/encoding_rs/src/mem.rs:1301-1340`);
  - a frame with `direction: rtl` initializes (`ff:layout/generic/nsIFrame.cpp:1506-1511`);
  - bidi options request RTL direction or Hindi numerals (`ff:layout/base/nsPresContext.cpp:1667-1677`).
- Blocks run `ResolveBidi` only if `NS_BLOCK_NEEDS_BIDI_RESOLUTION && PresContext()->BidiEnabled()`
  (`ff:layout/generic/nsBlockFrame.cpp:863-866`, `:940`, `:1668`).
- `nsBidiPresUtils::Resolve` (`ff:layout/base/nsBidiPresUtils.cpp:790-855`) returns early unless the block
  has `unicode-bidi: bidi-override`, a paragraph level other than LTR, or some descendant has `unicode-bidi`
  controls or a 16-bit text node with RTL characters (`:804-829`, `ChildListMayRequireBidi` `:1431-1485`,
  `mParaLevel > 0` at `:318-320`).
- Paragraph level (`BidiLevelFromStyle`, `:2518-2532`): `unicode-bidi: plaintext` → auto-detect (default
  LTR); `direction: rtl` → RTL; otherwise LTR.

### 4.2 Building the paragraph string

`TraverseFrames` (`:1169-1429`):

- **Text frame**: append the whole text node once per node (`:1256-1262`). If the frame's newline is
  significant, append only up to and including each `\n`, resolve that paragraph, split the frame after the
  newline and continue (`:1263-1379`). Each preserved line is its own bidi paragraph.
- **`<br>`**: append U+2028, then resolve the paragraph (`:1381-1384`).
- **Other leaf frame**: append U+FFFC, or U+200B for `<wbr>` and empty inline frames. A frame that is not
  inline-outside ends the paragraph (`:1385-1401`).
- **Inline containers** push control characters before their first continuation and pop them after their
  last (`:1221-1244`, `:1412-1423`):
  - `unicode-bidi: embed` → LRE or RLE; `isolate` → LRI or RLI; `isolate-override` and `plaintext` → FSI
    (`GetBidiControl`, `:110-130`);
  - `bidi-override` and `isolate-override` → LRO or RLO (`GetBidiOverride`, `:85-99`).
- Before the algorithm runs, `ReplaceSeparators` turns U+0009, U+000A, U+000B, U+000D, U+001C-U+001F, U+0085
  and U+2029 into U+0020; U+000C is kept (`:861-875`, `:882`).

### 4.3 Splitting frames

`ResolveParagraph` (`:877-1167`):

- Early exit for 1 frame, 1 run, LTR paragraph at level 0 (`:921-942`).
- Walk logical runs (maximal ranges of one embedding level) against frames. Where a run ends inside a text
  frame, `EnsureBidiContinuation` creates a non-fluid continuation at the run end (`:1039-1057`).
- Each frame stores `{embeddingLevel, baseLevel, precedingControl}` (`:948-965`). `precedingControl` is the
  lowest level among the virtual control characters just before the frame, kept only if it is lower than the
  levels on both sides (`:952-961`).

### 4.4 Effects downstream

- **Text runs**: when bidi is enabled, frames with different embedding levels, or a frame with a preceding
  control, never share a text run (`ff:layout/generic/nsTextFrame.cpp:2023-2030`). A non-fluid continuation
  of the same node never shares one either (`:2139-2148`). The run is RTL if its first frame's level is odd
  (`:2587-2589`).
- **White space**: `TransformText` runs per mapped flow (§6), so a bidi split also cuts the East Asian
  segment-break context.
- **Break opportunities**: bidi splits do *not* reset `nsLineBreaker`. `FlushFrames(false, false)` at
  `:2207-2210` keeps its state, so a word continues across a direction change. `"abcאבג"` is one word to
  ICU4X (AL followed by HL: no break).

Pseudo-code for the port (levels from UAX #9 at Unicode 15.0; see §20 for bracket-pair and line-level
details not re-read here):

```ts
function splitByBidi(block): FramePiece[] {
  if (!documentBidiEnabled || (!blockOverride && paraLevel === LTR && !anyUnicodeBidi && !anyRTLChars)) return frames
  for (const paragraph of paragraphs(block)) {        // split at <br>, blocks, preserved '\n'
    const s = paragraph.text with controls from unicode-bidi pushed/popped; ReplaceSeparators(s)
    const levels = uba15(s, paraLevel)                  // unicode-bidi 0.3.15
    for (const run of logicalRuns(levels)) splitFramesAt(run.end)  // non-fluid continuations
  }
}
```

## 5. Step D: grouping frames into text runs

### 5.1 The scanner

- `BuildTextRuns` (`ff:layout/generic/nsTextFrame.cpp:1553-1736`) runs a `BuildTextRunsScanner` over the
  block's lines in order. One scanner owns one `nsLineBreaker` (`:1267`).
- `ScanFrame` (`:2176-2276`) handles each frame:
  - **Text frame**: if a previous text frame exists and `ContinueTextRunAcrossFrames` is false, run
    `FlushFrames(false, false)`: build the pending text run but keep the line breaker (`:2207-2210`). A frame
    of the same node that continues the run just extends the flow (`:2211-2214`). Otherwise start a new mapped
    flow whose `mAncestorControllingInitialBreak` is the nearest common ancestor with the previous text frame
    (`:2218-2226`, `:1870`, `:2275`).
  - **Placeholder for an absolutely or fixed positioned box**: `FlushFrames(true, false)`, which resets the
    breaker (`:2230-2244`).
  - **Other frames**, classified by `CanTextCrossFrameBoundary` (`:1395-1431`):
    - inline containers: both the text run and the breaker cross, and children are scanned;
    - placeholders for floats: both cross;
    - everything else (`<br>`, atomic inlines, blocks): `FlushFrames(true, isBR)` before and after. This
      resets the breaker, and a `<br>` suppresses the trailing break. It also clears the incoming-white-space
      context (`:2246-2273`).

### 5.2 `ContinueTextRunAcrossFrames(f1, f2)` (`:2015-2174`)

Returns false if any of the following holds, else true:

1. Bidi is enabled and `f1.level !== f2.level || f2.precedingControl !== none` (`:2023-2030`).
2. Writing modes differ (`:2037-2040`); this includes `direction`.
3. `f1` has a significant newline and its content ends with `\n` (`:2049-2052`).
4. The parents' contents differ, and for some box between a frame and their nearest common ancestor, on the
   facing side (`:2054-2137`, `HasDefaultVerticalAlignment` `:2000-2013`):
   - margin, padding or border width is non-zero after conversion to au. `0.001px` of padding rounds to 0 au
     and does not stop shaping;
   - `alignment-baseline` is not `baseline` or `baseline-shift` is not a zero length (so any
     `vertical-align` other than `baseline`);
   - `unicode-bidi` is `isolate` or `isolate-override`;
   - there is no common ancestor within one block, or it is SVG text.
5. `f2` is a non-fluid continuation of the same node (`:2139-2148`).
6. If the two `ComputedStyle`s are the same object, return true (`:2150-2152`). Otherwise return false unless
   all of these match:
   - `text-transform`, `EffectiveWordBreak`, `line-break` (`:2154-2159`);
   - `nsFont` equality (`:2168`, `ff:gfx/src/nsFont.cpp:36-57`): style, weight, width, size, size-adjust,
     family list, kerning, optical sizing, synthesis (weight, style, small-caps, position),
     `font-feature-settings`, `font-variation-settings`, `font-language-override`, and the variant
     alternates, caps, east-asian, ligatures, numeric, position, width and emoji;
   - the `mLanguage` atom (`:2169`);
   - `GetTextRunFlagsForStyle` (`:2170-2173`, `ff:layout/base/nsLayoutUtils.cpp:6896-6925`):
     - `TEXT_DISABLE_OPTIONAL_LIGATURES` iff the resolved letter spacing is not 0 au or
       `text-justify: inter-character`;
     - `TEXT_HIDE_CONTROL_CHARACTERS` from `-moz-control-character-visibility`;
     - `TEXT_OPTIMIZE_SPEED` for `text-rendering: optimizeSpeed`, or `auto` below 20 device px;
     - the orientation flags.

Not compared: color, `word-spacing`, the magnitude of a non-zero `letter-spacing`, `white-space`,
`overflow-wrap`, `hyphens`, `tab-size`, decorations. Spacing is still applied per frame, from each frame's
own style (`nsTextFrame.cpp:3488-3489`, `:3518-3519`).

| Markup (same block) | Text runs | Shaping across the edge | Break at the edge |
|---|---|---|---|
| `foo<span style="color:red">bar</span>` | 1 | yes (kerning, ligatures, Arabic joining) | no (one word) |
| `<b>foo</b>bar` | 2 (weight differs) | no | no (one word) |
| `A<span style="letter-spacing:2px">V</span>` inside `letter-spacing:1px` | 1 (both non-zero) | yes | no |
| `A<span style="letter-spacing:0.01px">V</span>` | 2 (1 au vs 0 au) | no | no |
| `A<span style="vertical-align:1px">V</span>` | 2 | no | no |
| `A<span style="unicode-bidi:isolate">V</span>` | 2 | no | no |

### 5.3 Building one text run

`BuildTextRunForFrames` (`:2361-2787`):

- For each mapped flow, `TransformText` runs over exactly that flow's DOM range
  `[startFrame.contentOffset, GetContentEnd())`. The incoming-context byte (`mNextRunContextInfo`) passes
  from flow to flow and from text run to text run (`:2489-2554`).
- Flags:
  - `GetSpacingFlags` gives `TEXT_ENABLE_SPACING` when letter or word spacing is non-zero or autospace is on
    (`:1982-1996`, `:2432`); justification adds it too (`:2435-2437`);
  - a transformed tab (`HasTab`) → `TEXT_ENABLE_SPACING` (`:2581-2583`);
  - a removed soft hyphen (`HasShy`) → `TEXT_ENABLE_HYPHEN_BREAKS` (`:2584-2586`);
  - RTL from the first frame's level (`:2587-2589`);
  - style flags from the last flow's style (`:2596-2601`).
- `text-transform`, `-webkit-text-security` and `text-combine-upright` install
  `nsCaseTransformTextRunFactory` (`:2623-2636`; §13).
- Parameters: `AppUnitsPerDevPixel` of the pres context (`:2715-2721`); 8-bit text gets `TEXT_IS_8BIT`
  (`:2735`).
- Break sinks are set up after the run exists (`:2757-2759`).
- A text run rebuilt from cache still re-feeds its text to the breaker (`SetupLineBreakerContext`,
  `:2793-2865`). Break results never depend on caching.

## 6. Step E: `TransformText`

Source: `ff:layout/generic/nsTextFrameUtils.cpp:211-401`, helper `TransformWhiteSpaces` `:84-209`.

### 6.1 Characters removed in every mode ("discardable", `:32-49`)

- U+00AD SOFT HYPHEN (8-bit and 16-bit): removed, sets `HasShy`.
- 16-bit only: bidi controls U+202A-U+202E, U+2066-U+2069, U+200E, U+200F, U+061C
  (`ff:intl/unicharutil/util/nsBidiUtils.h:68-90`).

CR is deliberately **not** discardable (comment at `:33-35`).

### 6.2 Pseudo-code

```ts
// One call per mapped flow. `text` holds only this flow's DOM characters.
// ctx.inWhitespace carries between flows and text runs until a breaker-crossing frame clears it.
function transformText(text: number[], is16: boolean, mode: Mode, ctx: {inWhitespace: boolean},
                       lang: string | null): Out {
  const out = new Out()
  const disc = (c: number) => c === 0xAD || (is16 && isBidiControl(c))
  if (mode === NONE || mode === NONE_TO_SPACE) {                         // :222-271
    for (const c of text) {
      if (disc(c)) { out.skip(); if (c === 0xAD) out.hasShy = true; continue }
      if (c < 0x20) {
        if (mode === NONE_TO_SPACE && (c === 0x09 || c === 0x0A)) { out.keep(0x20); continue }
        if (mode === NONE) { if (c === 0x09) out.hasTab = true; if (c === 0x0A) out.hasNewline = true }
      }
      out.keep(c)
    }
    ctx.inWhitespace = false                                              // :271
    return out
  }
  const jaZh = lang !== null && lang.length >= 2 &&                      // :273-285
    ['ja', 'zh'].includes(lang.slice(0, 2).toLowerCase()) && (lang.length === 2 || lang[2] === '-')
  const docWS = (c: number) => c === 0x20 || c === 0x09 || c === 0x0A
  let inWs = ctx.inWhitespace                                             // :286
  for (let i = 0; i < text.length;) {
    const c = text[i]
    if (!docWS(c) && !disc(c)) { out.keep(c); inWs = false; i++; continue }   // :292-310 (CR, FF, VT, NBSP, U+3000 land here)
    if (docWS(c)) {                                                       // :320-368
      let j = i + 1, hasSB = c === 0x0A
      while (j < text.length && (docWS(text[j]) || disc(text[j]))) { if (text[j] === 0x0A) hasSB = true; j++ }
      let trailingDisc = 0
      while (disc(text[j - 1])) { j--; trailingDisc++ }                  // :334-336
      let keepLastSpace = false
      if (is16 && text[j - 1] === 0x20 && j < text.length && isSpaceCombiningSequenceTail(text, j)) {
        keepLastSpace = true; j--                                         // :339-345
      }
      if (j > i) inWs = transformWhiteSpaces(text, i, j, hasSB, inWs, mode, jaZh, is16, out)
      if (keepLastSpace) { out.keep(0x20); j++ }                          // :353-361 (inWs unchanged)
      for (; trailingDisc > 0; trailingDisc--) { out.skip(); j++ }
      i = j; continue
    }
    out.skip(); inWs = false; i++                                         // :369-379 a discardable outside a WS run
  }
  ctx.inWhitespace = inWs                                                 // :382-386
  return out
}

function transformWhiteSpaces(text, b, e, hasSB, inWs, mode, jaZh, is16, out): boolean {   // :84-209
  let skippable = false
  if (is16) {
    if ((b > 0 && text[b - 1] === 0x200B) || (e < text.length && text[e] === 0x200B)) skippable = true   // :99-101
    else if (b > 0 && e < text.length) {
      const before = scalarBefore(text, b, /*skip*/ isDefaultIgnorable)   // steps back while default-ignorable, :106-117
      const after = scalarAt(text, e, /*skip*/ isDefaultIgnorable)        // steps forward likewise, :119-129
      skippable = (segmentBreakSkipChar(before) && segmentBreakSkipChar(after)) ||
                  (jaZh && (eastAsianPunct(before) || eastAsianPunct(after)))                 // :135-139
    }
  }
  for (let k = b; k < e; k++) {
    const c = text[k]
    if (c === 0xAD || (is16 && isBidiControl(c))) { out.skip(); continue }
    if (c === 0x20 || c === 0x09) {
      if (hasSB || inWs) { out.skip(); continue }                         // :151-162
      out.keep(0x20); inWs = true; continue
    }
    // c === '\n'
    if (mode === COMPRESS_WHITESPACE) { out.keep(0x0A); inWs = false; continue }   // pre-line keeps LF, :169-179, :196-199
    if (skippable || inWs) { out.skip(); continue }                       // :187-190
    out.keep(0x20); skippable = true; inWs = true                         // :191-193, :200-203
  }
  return inWs
}
```

The step-back walk is a `do … while`: it always takes one scalar, then keeps stepping while that scalar is
default-ignorable and characters remain.

Helpers:

- `isSpaceCombiningSequenceTail(s, j)`: `s[j]` is a cluster extender other than ZWJ/ZWNJ, or a bidi control
  followed recursively by such a tail (`nsTextFrameUtils.cpp:24-30`;
  `ff:intl/unicharutil/util/nsUnicodeProperties.h:209-214`).
- `isDefaultIgnorable`: Default_Ignorable_Code_Point (`nsUnicodeProperties.h:115-118`).
- `segmentBreakSkipChar(u)`: East_Asian_Width is F or H, or W and not Emoji; the script is not Hangul; and `u`
  is not U+20A9 (`ff:intl/unicharutil/util/nsUnicharUtils.cpp:498-504`;
  `ff:intl/components/src/UnicodeProperties.h:205-218`).
- `eastAsianPunct(u)`: East_Asian_Width is F, H or W, and either the general category is P* (and `u` is not
  U+20A9), or `u` is U+FF5E or U+3000 (`nsUnicharUtils.cpp:506-524`; `UnicodeProperties.h:187-199`,
  `:295-308`).

The context of a segment break is **only this flow's characters**. A `\n` that is the first or last
character of a text node always becomes a space (in `normal`/`nowrap`) unless an adjacent ZWSP inside the
same node applies.

### 6.3 Examples (normal white space unless stated)

- `"a  \t b"` → `"a b"`.
- `"a \n b"` → `"a b"`: spaces and tabs next to a segment break are removed; the break becomes one space.
- `"日本\n語"` in one text node → `"日本語"`. `日本\n<span>語</span>` → `"日本 "` + `"語"`.
- `"abc\n日本"` → `"abc 日本"`. With `lang="ja"`: `"。\na"` → `"。a"`; with `lang="en"` → `"。 a"`.
- `"a​\nb"` → `"a​b"`.
- `"a \r b"` → `"a \r b"`: CR is kept and stops collapsing, so both spaces stay.
- `pre-line`: `"a  \n  b"` → `"a\nb"`; `"a\n\nb"` → `"a\n\nb"`.
- `pre`, `pre-wrap`, `break-spaces`: unchanged except removed soft hyphens and bidi controls.
- A soft hyphen at the start of a flow that follows collapsible white space resets `inWs`. So
  `"foo "` + `"­ bar"` keeps the second space (`:369-379`).

### 6.4 Per-character table

"WS_NL" = `normal`/`nowrap`; "WS" = `pre-line`; "NONE" = `pre`/`pre-wrap`/`break-spaces`. The break
column names the ICU4X class result from the oracle where it matters. The trimmable column is
`IsTrimmableSpace` (`ff:layout/generic/nsTextFrame.cpp:904-942`), used for leading-white-space skipping at a
line start and for trimmed offsets.

| Char | WS_NL | WS | NONE | `nsLineBreaker` / ICU4X | In the text run (§7) | Trimmable |
|---|---|---|---|---|---|---|
| U+0020 | collapsible → 1 space | removed next to LF, else collapsible | kept | ends a word; a break after the run of spaces | boundary space; simple glyph `lround(spaceWidth*apd)`; `CharIsSpace` | if `!WhiteSpaceIsSignificant` (not before a combining tail) |
| U+0009 | → space, collapsible | → space, collapsible | kept, `HasTab` | ends a word | invalid char, `SetIsTab`, advance from tab stops (§12.3) | if `!WhiteSpaceIsSignificant` |
| U+000A | → space or removed (§6.2) | kept | kept, `HasNewline` | 16-bit: ends a word with no break after; 8-bit: inside the word, class LF → break after | invalid char, `SetIsNewline`; the fill forces a line end (`nsTextFrame.cpp:10919-10933`, `:11470-11474`) | if `!NewlineIsSignificantStyle` and not `preserve-spaces` |
| U+000D | kept, resets collapsing | kept | kept | ends a word (segment space) | invalid char, zero advance, never a hexbox (`gfxFont.cpp:3625-3628`) | if `!WhiteSpaceIsSignificant` |
| U+000C | kept | kept | kept | inside the word; BK → break after (`"ab"` → [2]) | invalid char, zero advance (hidden controls) | if `!WhiteSpaceIsSignificant` |
| U+000B | kept | kept | kept | inside the word; BK → break after (`[2]`) | invalid char, zero advance | no |
| U+0000, other C0, U+007F, C1 | kept | kept | kept | inside the word; mostly CM → no break (`"a b"` → []); U+0085 is NL → break after | invalid char, zero advance (hidden controls) | no |
| U+00A0 | kept | kept | kept | inside the word; GL → no break (`"foo bar"` → []) | boundary space shaped alone; not `CharIsSpace`; gets word spacing | no |
| U+00AD | removed | removed | removed | never seen | not in the run; hyphen breaks come from §11 | — |
| U+200B | kept; a segment break next to it is removed | kept | kept | inside the word; ZW → break after (`[4]` for `"foo​bar"`) | invalid char, zero advance | no |
| U+2028, U+2029 | kept | kept | kept | inside the word; BK → break after | invalid char, zero advance | no |
| U+2060, U+FEFF | kept | kept | kept | inside the word; WJ → no break | invalid char, zero advance | no |
| bidi controls | removed (16-bit) | removed | removed | never seen | not in the run | — |
| U+3000 | kept, not collapsible | kept | kept | inside the word; BA → no break before, break after (`"日　本"` → [2]) | `CharIsSpace` (16-bit), so the fill counts it as trimmable advance | no |
| U+1680 | kept | kept | kept | inside the word | shaped normally | if `!WhiteSpaceIsSignificant` |

## 7. Step F: characters inside a text run

### 7.1 Invalid characters

`gfxFontGroup::IsInvalidChar` (`ff:gfx/thebes/gfxTextRun.h:971-992`):

- 8-bit: `(ch & 0x7F) < 0x20 || ch === 0x7F`. U+0080-U+009F are invalid; U+00A0 is valid.
- 16-bit: `ch <= 0x9F` except printable ASCII; U+200B, U+2028, U+2029, U+2060, U+FEFF; the bidi controls.

Invalid characters split shaping and get no glyph (`ff:gfx/thebes/gfxFont.cpp:3872-3893`):

- TAB → `SetIsTab`; LF → `SetIsNewline`;
- general category Cf → `SetIsFormattingControl`;
- other control characters except CR become hexboxes **unless** `TEXT_HIDE_CONTROL_CHARACTERS` is set, which
  it is for pages in release builds (§2.3, §16).

The same handling applies when no font matches (`ff:gfx/thebes/gfxTextRun.cpp:2995-3060`): invalid
characters stay zero width (`:3049-3052`). Unicode spaces with no glyph get a synthesized width
`apd * floor(wid + 0.5)`, where `wid` is in device px (`:3032-3047`).

### 7.2 Shaping units (why kerning and joining stop at spaces and run edges)

`gfxFont::SplitAndInitTextRun` (`ff:gfx/thebes/gfxFont.cpp:3708-3900`), per font range and script run:

- A unit ends at U+0020 or U+00A0 when the next character is not a cluster extender (`IsBoundarySpace`,
  `:3317-3330`, `:3784-3785`), and at every invalid character (`:3786`).
- A U+0020 boundary space becomes a simple glyph with `CharIsSpace`, not shaped
  (`:3834-3862`, `ff:gfx/thebes/gfxTextRun.cpp:1590-1622`). U+00A0 is shaped as a one-character word.
- Units up to 32 UTF-16 units go through the word cache; longer ones are shaped directly. The output is the
  same (`gfxFont.cpp:3737-3739`, `:3804-3811`).
- Exception: if the font's default features involve the space glyph, the whole range is shaped with its
  spaces (`:3746-3765`; `SpaceMayParticipateInShaping` `:1550-1596`).
- HarfBuzz receives exactly the unit, with no pre- or post-context: `hb_buffer_add_utf16(text, len, 0, len)`
  (`ff:gfx/thebes/gfxHarfBuzzShaper.cpp:1484-1485`).
- `TEXT_INCOMING_ARABICCHAR` and `TEXT_TRAILING_ARABICCHAR` are used only for bidi numeral substitution
  (`ff:gfx/thebes/gfxTextRun.cpp:2686-2711`), which the default pref disables (§16).
- **Consequence**: kerning, ligatures and Arabic joining cross a span edge exactly when both sides are in
  one text run (§5.2) and no space or invalid character separates them. They never cross a text-run
  boundary.
- There is no reshaping at line edges: `gfxTextRun::SetLineBreaks` does nothing
  (`ff:gfx/thebes/gfxTextRun.cpp:1292-1301`).

### 7.3 Cluster starts, spaces and emergency flags

`gfxShapedText::SetupClusterBoundaries` (`ff:gfx/thebes/gfxFont.cpp:708-769` for 16-bit, `:771-795` for
8-bit):

- **Cluster starts** come from ICU4X's grapheme cluster segmenter (`icu4x_GraphemeClusterSegmenter_create_mv1`,
  `ff:intl/lwbrk/Segmenter.cpp:150-190`). A leading cluster extender is marked as a continuation. A Bengali
  YA after a VIRAMA joins the previous cluster.
- **`CharIsSpace`** is set for U+0020 and U+3000; in 8-bit text only for U+0020.
- **Emergency wrap**: the character after a hyphen gets `FLAG_BREAK_TYPE_EMERGENCY_WRAP` when:
  - it is alphanumeric (general category L* or N*), and
  - the hyphen itself follows an alphanumeric, where the hyphens are `-`, U+2010, U+2012, U+2013 and U+058A
    (8-bit text: only `-`) (`ff:dom/base/nsContentUtils.cpp:2231-2235`, `:2246-2254`).
- `SetPotentialLineBreaks` later **overwrites** that flag with NORMAL where a natural break exists
  (`SetCanBreakBefore` replaces the 2-bit field, `ff:gfx/thebes/gfxFont.h:927-936`). `"foo-bar"` → natural
  break [4], no emergency flag; `"1-2"` → no natural break, emergency flag [2] (oracle).
- The fill uses an emergency flag only while no natural break has been recorded on the line
  (`ff:gfx/thebes/gfxTextRun.cpp:1068-1074`).

## 8. Step G: `nsLineBreaker`

### 8.1 How the scanner feeds it

`SetupBreakSinksForTextRun` (`ff:layout/generic/nsTextFrame.cpp:2889-2997`). For each mapped flow, in order:

```ts
lb.setWordBreak(EffectiveWordBreak(flow.style))        // :2910-2924
lb.setStrictness(flow.style.lineBreak)                 // :2925-2941 auto|normal|loose|strict|anywhere
let flags = 0
const ctl = flow.ancestorControllingInitialBreak ?? lineContainer
if (!WhiteSpaceCanWrap(ctl))            flags |= SUPPRESS_INITIAL     // :2953-2961
if (!WhiteSpaceCanWrap(flow.frame))     flags |= SUPPRESS_INSIDE      // :2964-2966
if (textRun.flags2 & NoBreaks)          flags |= SKIP_SETTING_NO_BREAKS
if (style.textTransform & CAPITALIZE)   flags |= NEED_CAPITALIZATION
if (style.hyphens === 'auto' && style.lineBreak !== 'anywhere') flags |= USE_AUTO_HYPHENATION
if (flowStartsWithCollapsedTrimmableWhitespace) lb.appendInvisibleWhitespace(flags)   // :2867-2887, :2978-2981
if (flow.transformedLength > 0) lb.appendText(explicitLangOrNull, flow.transformedText, flags, sink)   // :2983-2994
```

- The text fed is the transformed text **before** any `text-transform` mapping. Break results are copied
  into the transformed child run later (§13).
- The breaker is `Reset()` by `FlushLineBreaks` when a frame the breaker cannot cross is met, and at the end
  of the scan (`:1835-1856`, `:2246-2273`, `:1733-1735`). `Reset` flushes the pending word. It records
  `HasTrailingBreak` on the last text run if the text ended in breakable space (`nsLineBreaker.cpp:710-720`).

### 8.2 State and setters (`ff:dom/base/nsLineBreaker.h:169-202`, `:260-300`)

```ts
class LB {
  word: number[] = []; items: Item[] = []; wordMightBreak = false
  wordLang: Atom | null = null; mixedLang = false
  cjFlag = false               // mScriptIsChineseOrJapanese: starts false, never reset by flushWord
  afterBreakableSpace = false; breakHere = false
  wordBreak = 'normal'; lineBreak = 'auto'; wordContinuation = false

  setWordBreak(m) {
    if (m !== this.wordBreak && this.word.length) {
      this.flushWord()
      if (this.wordBreak === 'break-all') this.breakHere = true
    }
    this.wordBreak = m
  }
  setStrictness(m) {
    if (m !== this.lineBreak && this.word.length) {
      this.flushWord()
      if (this.lineBreak === 'anywhere') this.breakHere = true
    }
    this.lineBreak = m
  }
}
const isSegmentSpace = (c) => c === 0x20 || c === 0x09 || c === 0x0D     // nsLineBreaker.h:260-264
```

The ASCII fast path (`ff:dom/base/nsLineBreaker.cpp:33-56`): `nonBreakableAscii(c)` is true only for
`" # & ' * , . 0-9 : ; < = > @ A-Z ^ _ \` a-z ~`. It is false for `! $ % ( ) + - / ? [ \ ] { | }`, DEL,
code units below U+0020 and above U+007F. A word made only of true characters is "not might-break".

### 8.3 `appendText` for 16-bit text (`nsLineBreaker.cpp:235-400`)

```ts
appendText16(lang, t, flags, sink) {
  let off = 0
  if (this.word.length) {                                  // continue a word from an earlier flow, :243-270
    while (off < t.length && !isSegmentSpace(t[off])) {    // note: LF does NOT stop this loop
      this.word.push(t[off]); if (!nonBreakableAscii(t[off])) this.wordMightBreak = true
      this.updateLang(lang); off++
    }
    if (off > 0) this.items.push({sink, sinkOffset: 0, length: off, flags})
    if (off === t.length) return
    this.flushWord()
  }
  const st = new Uint8Array(t.length); const start = off
  const noBreaksNeeded = !sink || ((flags & (SUPPRESS_INITIAL | SUPPRESS_INSIDE | SKIP_SETTING_NO_BREAKS)) ===
                         (SUPPRESS_INITIAL | SUPPRESS_INSIDE | SKIP_SETTING_NO_BREAKS) && !this.breakHere && !this.afterBreakableSpace)
  if (noBreaksNeeded && !(flags & NEED_CAPITALIZATION)) {  // jump to the last word, :293-305
    off = t.length; while (off > start) { off--; if (isSegmentSpace(t[off])) break }
  }
  let wordStart = off, mightBreak = false
  for (;;) {                                               // :316-388
    const c = t[off], isSpace = isSegmentSpace(c), breakableSpace = isSpace && !(flags & SUPPRESS_INSIDE)
    if (sink && !noBreaksNeeded)
      st[off] = (this.breakHere || (this.afterBreakableSpace && !breakableSpace) ||
                 this.wordBreak === 'break-all' || this.lineBreak === 'anywhere') ? NORMAL : NONE
    this.breakHere = false; this.afterBreakableSpace = breakableSpace
    if (isSpace || c === 0x0A) {                           // :332-367
      if (off > wordStart && sink && !(flags & SUPPRESS_INSIDE)) {
        if (this.lineBreak === 'anywhere') st.fill(NORMAL, wordStart, off)
        else if (mightBreak) {
          const saved = st[wordStart]
          computeBreakPositions(t.slice(wordStart, off), this.wordBreak, this.lineBreak, this.cjFlag, st, wordStart)
          st[wordStart] = saved
        }
        // hyphens:auto dictionary points would be added here (out of scope)
      }
      // capitalization for this word (§13)
      mightBreak = false; this.wordContinuation = false
      off++; if (off >= t.length) break; wordStart = off; continue
    }
    if (!mightBreak && !nonBreakableAscii(c)) mightBreak = true
    off++
    if (off >= t.length) {                                 // save the trailing word, :373-387
      this.wordMightBreak = mightBreak; this.word.push(...t.slice(wordStart, off))
      this.items.push({sink, sinkOffset: wordStart, length: off - wordStart, flags})
      off = wordStart + 1                                  // write the break-before of the word's first char now
      this.updateLang(lang)
      break
    }
  }
  if (sink && !noBreaksNeeded) sink.setBreaks(start, st.slice(start, off))   // :390-398
}
```

- `BREAK_SUPPRESS_INITIAL` is not consulted in the per-character loop. It matters only for a word that
  continues from an earlier flow (§8.5) and for `noBreaksNeeded`. See hypothesis H28.
- `computeBreakPositions` zeroes the word's range before writing ICU4X results (`LineBreaker.cpp:153`). So
  under `break-all` a word containing a might-break character uses ICU4X's result, while an all-ASCII-letter
  word keeps the per-character NORMAL flags. Both give a break between every pair of letters.

### 8.4 `appendText` for 8-bit text (`nsLineBreaker.cpp:505-650`)

The same algorithm, with these differences:

- capitalization or auto-hyphenation defers to the 16-bit path (`:510-516`);
- `c === '\n'` does **not** end a word (`:595`), so LF goes to ICU4X inside the word (class LF, break after);
- `updateLang` is never called, so 8-bit text never sets `cjFlag`;
- ICU4X is called through `segment_latin1` (§9.4).

For Latin-1 text the only visible difference is the LF case. It occurs only when LF is preserved, where the
fill ends the line at LF anyway.

### 8.5 `flushWord` (`nsLineBreaker.cpp:134-226`)

```ts
flushWord() {
  const n = this.word.length, st = new Uint8Array(n)
  if (this.lineBreak === 'anywhere') st.fill(NORMAL)
  else if (!this.wordMightBreak && this.wordBreak !== 'break-all') st.fill(NONE)
  else computeBreakPositions(this.word, this.wordBreak, this.lineBreak, this.cjFlag, st, 0)
  // hyphens:auto (out of scope) at :166-182
  let o = 0
  this.items.forEach((it, i) => {
    if ((it.flags & SUPPRESS_INITIAL) && it.sinkOffset === 0) st[o] = NONE
    if (it.flags & SUPPRESS_INSIDE) { const ex = it.sinkOffset === 0 ? 1 : 0; st.fill(NONE, o + ex, o + it.length) }
    const skip = i === 0 ? 1 : 0          // the word's first break flag was already written by appendText
    it.sink?.setBreaks(it.sinkOffset + skip, st.slice(o + skip, o + it.length))
    // capitalization over the whole word when NEED_CAPITALIZATION and !wordContinuation, :208-219
    o += it.length
  })
  this.word = []; this.items = []; this.wordMightBreak = false; this.mixedLang = false
  this.wordLang = null; this.wordContinuation = false      // cjFlag is NOT reset, :135-142
}
```

`appendInvisibleWhitespace(flags)` (`:695-708`): `flushWord()`; if `afterBreakableSpace` and
`SUPPRESS_INSIDE` is set, set `breakHere = true`; then `afterBreakableSpace = !(flags & SUPPRESS_INSIDE)`.

### 8.6 The Chinese/Japanese flag (`nsLineBreaker.cpp:652-693`)

```ts
updateLang(lang /* explicit lang atom or null */) {
  if (this.wordLang && this.wordLang !== lang) { this.mixedLang = true; this.cjFlag = false; return }
  if (lang && !this.wordLang) {
    const loc = parseLocale(lang); if (!loc) return
    if (!loc.script && !addLikelySubtags(loc)) return
    this.cjFlag = ['Hans', 'Hant', 'Jpan', 'Hrkt'].includes(loc.script)
  }
  this.wordLang = lang
}
```

`updateLang` is called only while extending a word from an earlier flow (`:253`) and when the trailing word
of a flow is saved (`:385`). Therefore:

- words that start and end inside one flow use whatever `cjFlag` was before, which is false at the start of
  each scan;
- the flag, once set, stays for later words of the same scan;
- it matters only for `line-break: normal` and `loose` (§9.3), and it changes which segmenter is built for
  `auto` and `strict` without changing their results.

### 8.7 `computeBreakPositions` (`ff:intl/lwbrk/LineBreaker.cpp:112-194`, 8-bit `:196-239`)

```ts
function computeBreakPositions(w, wordBreak, lineBreak, cj, st, base) {
  if (w.length === 1) { st[base] = 1; return }                            // :120-127
  st.fill(0, base, base + w.length)                                       // :153
  const strictness = {auto: 'strict', strict: 'strict', loose: 'loose', normal: 'normal', anywhere: 'anywhere'}[lineBreak]   // :26-41
  const seg = (wordBreak === 'normal' && (lineBreak === 'auto' || lineBreak === 'strict') && !cj)
    ? LineSegmenter.new_auto({})                                          // shared singleton, :57-76
    : LineSegmenter.new_lstm({strictness, word_option: wordBreak, content_locale: cj ? 'zh' : null})   // :89-110
  for (const pos of seg.segment_utf16(w)) { if (pos >= w.length) break; st[base + pos] = 1 }   // :165-171
}
```

- The LRU cache at `:132-151`, `:178-193` stores identical results and has no effect on output.
- `create_auto` is `new_auto(Default)` (`ff:intl/icu_capi/src/segmenter_line.rs:80-84`), and `new_auto` is
  `new_lstm` (`ff:third_party/rust/icu_segmenter/src/line.rs:402-404`).
- `create_lstm_with_options_v2` passes the options and locale to `new_lstm` (`segmenter_line.rs:154-164`).

### 8.8 Writing into the text run

`BreakSink::SetBreaks` → `gfxTextRun::SetPotentialLineBreaks` (`ff:layout/generic/nsTextFrame.cpp:1227-1235`;
`ff:gfx/thebes/gfxTextRun.cpp:210-236`):

```ts
for (let i = range.start; i < range.end; i++) {
  let v = breakBefore[i - range.start]
  if (v && !clusterStart(i) && (i === 0 || !charIsSpace(i - 1))) v = NONE   // no break inside a cluster unless after a space
  if (v) flags[i] = v                                                         // replaces EMERGENCY_WRAP
}
```

`"éé"` under `line-break: anywhere` keeps only the break before the second `e`.
`"a ́b"` keeps the break before U+0301, because it follows a space (oracle [2]).

## 9. Step H: ICU4X 2.1.2 line segmenter as Gecko calls it

### 9.1 Options and payloads

- Resolution (`ff:third_party/rust/icu_segmenter/src/line.rs:223-250`): strictness defaults to Strict,
  word option to Normal. `ja_zh` is true iff the content locale's language is `ja` or `zh`; Gecko passes
  `zh` when `cjFlag`.
- `new_lstm` (`line.rs:445-451`) uses Firefox's baked `SINGLETON_SEGMENTER_BREAK_LINE_V1` and
  `ComplexPayloadsBorrowed::new_lstm()`: LSTM models for Burmese, Khmer, Lao and Thai, and `ja: None`, so no
  CJ dictionary (`ff:third_party/rust/icu_segmenter/src/complex/mod.rs:161-182`).
- No pref chooses a different segmenter (§16).

### 9.2 Data to port

- `ff:intl/icu_segmenter_data/data/segmenter_break_line_v1.rs.data`: `property_table` is a small-type
  `CodePointTrie` (`high_start 918016`, `null_value 52` = XX), and `break_state_table` is a
  68 × 68 `ZeroVec<BreakState>`. Scalars: `property_count 68`, `last_codepoint_property 54`,
  `sot_property 66`, `eot_property 67`, `complex_property 46`.
- Class ids 0-54 (UNKNOWN, AI, AK, AL, AL_DOTTED_CIRCLE, AP, AS, B2, BA, BB, BK, CB, CJ, CL, CM, CP, CR, EB,
  EM, EX, GL, H2, H3, HL, HY, ID, ID_CN, IN, IS, JL, JT, JV, LF, NL, NS, NU, OP_EA, OP_OP30, PO, PO_EAW, PR,
  PR_EAW, QU, QU_PF, QU_PI, RI, SA, SP, SY, VF, VI, WJ, XX, ZW, ZWJ) are at `line.rs:20-128`.
- `BreakState` byte encoding: 253 Break, 254 NoMatch, 255 Keep, `i + 120` Intermediate(i), otherwise
  Index(i) (`ff:third_party/rust/icu_segmenter/src/provider/mod.rs:244-300`).
- A port should export the trie and table from this file (for example by building a tiny Rust program
  against `icu_segmenter` 2.1.2 with this data, as the oracle does). It should not re-derive them from UAX #14.

### 9.3 Iterator (port literally)

`LineBreakIterator::next` (`line.rs:833-1080`):

```ts
next(): number | null {
  // :835 first call returns 0; at EOF returns null (check_eof :1086-1107)
  if (resultCache.length) { /* SA results: advance to the next cached offset and return it (:838-852) */ }
  let lb9Left: number | null = null, lb8aAfterLb9 = false           // :858-861
  outer: for (;;) {
    const leftCp = cur(); let left = lb9Left ?? prop(leftCp)
    const afterZwj = lb8aAfterLb9 || (lb9Left === null && left === ZWJ)
    advance(); if (eof()) return len
    const rightCp = cur(), right = prop(rightCp)
    if ((right === CM || (right === ZWJ && strictness !== 'anywhere')) &&
        ![BK, CR, LF, NL, SP, ZW].includes(left)) { lb9Left = left; lb8aAfterLb9 = right === ZWJ; continue }   // LB9
    lb9Left = null; lb8aAfterLb9 = false
    // :895-909 word option
    if (wordOption === 'break-all' && [AL, NU, SA].includes(left)) left = ID
    if (wordOption === 'keep-all' && KEEP.has(left) && KEEP.has(right)) continue   // KEEP = AI AL ID NU HY H2 H3 JL JV JT CJ
    // :911-937 strictness
    if (strictness === 'normal' && (rightCp === 0x301C || rightCp === 0x30A0) && jaZh && !afterZwj) return pos()   // :1124-1129
    if (strictness === 'loose') { const b = looseRule(rightCp, left, right, jaZh); if (b !== null) { if (b && !afterZwj) return pos(); continue } }
    if (strictness === 'anywhere') return pos()
    // :940-950 complex scripts
    if (wordOption !== 'break-all' && prop(leftCp, strict, normal) === SA && prop(rightCp, strict, normal) === SA) {
      const r = handleComplex(leftCp); if (r !== null) return r
    }
    // :953-1076 table
    const s = table[left * 68 + right]
    if (s === BREAK || s === NOMATCH) { if (afterZwj) continue; return pos() }
    if (s === KEEP) continue
    // Index/Intermediate: walk forward with look-ahead and restore on NoMatch, exactly as :961-1076
    ...
  }
}
```

- **Property lookup, UTF-16** (`line.rs:677-700`, `:1249-1262`): `table.get32(cp)`, then CJ → ID when
  `wordOption === 'break-all'` or strictness is `loose` or `normal`. Otherwise CJ keeps its strict NS-like
  behavior.
- **Loose rules** (`line.rs:721-780`) return `null` or a boolean:
  - right is BA and left is ID, for U+2010 and U+2013 → true;
  - right is NS: U+301C or U+30A0 → `jaZh`; U+3005, U+303B, U+309D, U+309E, U+30FD, U+30FE → true;
    U+30FB, U+FF1A, U+FF1B, U+FF65, U+203C, U+2047-U+2049 → `jaZh`;
  - right is IN → true;
  - right is EX, for U+FF01 and U+FF1F → `jaZh`;
  - right is PO_EAW → `jaZh`; left is PR_EAW → `jaZh`;
  - else `null`.
- Gecko discards the `0` from the first call (it restores the word start) and any position ≥ length
  (`LineBreaker.cpp:167-171`).

### 9.4 Latin-1 path

`segment_latin1` (`line.rs:634`, `:1229-1245`) uses the raw table value (no CJ remap, since CJ does not occur
in Latin-1) and never runs complex breaking. `content_locale` has no effect.

### 9.5 Oracle outputs used in this spec (normal white space, `word-break: normal`, `line-break: auto`)

| Text | Break offsets | Note |
|---|---|---|
| `"foo bar"` | [4] | after the space |
| `"( word"`, `"« word"` | [2], [2] | the space always breaks; no LB14/15 look-through |
| `"foo/bar"` | [4] | |
| `"http://ex.com/a-b?c=d"` | [7, 14, 16, 18] | |
| `"foo—bar"` | [3, 4] | B2 on both sides |
| `"日本語テキスト"` | [1, 2, 3, 4, 5, 6] | |
| `"アァア"` | [2] | ァ is CJ, treated as NS under auto |
| `"あ〜い"` (lang ja, auto) | [2] | |
| `"$100 100%"` | [5] | |
| `"1,000.5"`, `"a−1"` | [], [] | |
| `"£€"` | [1] | |
| `"한국어 텍스트"` | [1, 2, 4, 5, 6] | keep-all: [4] |
| `"a😀b"` | [1, 3] | |
| `"漢字。漢字"`, `"漢「字」漢"` | [1, 3, 4], [1, 4] | |
| `"a⁠b c"` | [4] | |

## 10. Step I: Southeast Asian scripts (class SA)

- Complex breaking runs only between two characters whose strict/normal class is SA, and only when
  `word-break` is not `break-all` (`line.rs:709-718`, `:940-950`).
- **UTF-16** (`line.rs:1263-1340`): collect the maximal SA run starting at the left character, split it
  into language slices by code-point range (Thai U+0E01-U+0E7F, Lao U+0E80-U+0EFF, Burmese U+1000-U+109F,
  U+A9E0-U+A9FF, U+AA60-U+AA7F, Khmer U+1780-U+17FF, U+19E0-U+19FF;
  `ff:third_party/rust/icu_segmenter/src/complex/language.rs:16-45`), and run the LSTM model for each slice
  (`complex/mod.rs:135-158`, `:161-182`).
- The cached boundaries **include the end of the SA run**, so a break is allowed between the last SA
  character and whatever follows, even punctuation. Oracle: `"ไทย)"` → [3], `"ไทย,"` → [3], `"ไทยabc"` → [3],
  `"(ไทย)"` → [4], `"ไทย.ไทย"` → [3].
- Gecko feeds one word at a time, so the LSTM sees at most the space-delimited word.
- Oracle: `"ภาษาไทยง่ายนิดเดียว"` → [4, 7, 11].
- Model data: `ff:intl/icu_segmenter_data/data/segmenter_lstm_auto_v1.rs.data` (874,165 bytes). The
  dictionaries are emptied (§0.1) but the line segmenter does not use them anyway.
- JavaScript side: `Intl.Segmenter` word granularity is built with
  `icu4x_WordSegmenter_create_auto_with_content_locale_mv1` (`ff:js/src/builtin/intl/Segmenter.cpp:444`);
  grapheme granularity uses `icu4x_GraphemeClusterSegmenter_create_mv1` (`:399`). The groundwork measured
  layout's per-word LSTM breaks equal to Firefox `Intl.Segmenter` word boundaries on 54,589/54,589 SA
  positions (`pretext-emulation-20260915/NOTES.md`, section "Thai/Lao/Khmer/Myanmar equivalence").

## 11. Soft hyphens (`hyphens: manual`)

- `TransformText` removes U+00AD and sets `HasShy` → `TEXT_ENABLE_HYPHEN_BREAKS` (§6.1, §5.3). The line
  breaker never sees it, and shaping sees the neighbors joined: `"f­i"` shapes as `"fi"`.
- The fill asks `GetHyphenationBreaks` (`ff:layout/generic/nsTextFrame.cpp:4409-4477`):
  - it returns nothing unless `WhiteSpaceCanWrap` and `hyphens !== none` (`:4414-4419`);
  - a Soft opportunity exists before the first kept character after a run of skipped characters whose
    **last** character is U+00AD (`:4435-4457`). A soft hyphen followed by another skipped character, such as
    a bidi control, gives nothing (`:4441-4443`);
  - there is none before the first character of a frame at line start (`:4449-4455`);
  - `hyphens: auto` adds dictionary points and explicit-hyphen marks (`:4460-4476`), which is out of scope.
- In the fill, a hyphen opportunity is used only where the character has no NORMAL break and not at the
  measured range start. The hyphen width is added when it is taken (`ff:gfx/thebes/gfxTextRun.cpp:1053-1063`,
  `:1085-1090`).
- A soft hyphen at the end of a frame offers a break after the frame (`nsTextFrame.cpp:11431-11440`).
- Min-content hyphenation uses the same rule (`nsTextFrame.cpp:9913-9918`).

## 12. Spacing facts the fill consumes

### 12.1 Letter spacing

`GetSpacingInternal` (`ff:layout/generic/nsTextFrame.cpp:4089-4295`), with pref model 0 (§16):

- `before = 0`, `after = letterSpacingAu` (`:4114-4119`).
- `after` is added at character i iff `CanAddSpacingAfter(i)` (`:3860-3873`):
  - i is the last character of the run, or character i+1 starts a cluster and a ligature group, and i is
    neither a formatting control nor a tab;
  - not at a significant newline;
  - and the cluster's base character is not in a cursive script: Arabic, Syriac, NKo, Mandaic, Mongolian,
    Phags-pa, Hanifi Rohingya (`:4202-4214`; `ff:intl/components/src/UnicodeProperties.h:350-355`).
- `letterSpacingAu = NS_lroundf(px * 60)` for lengths; percentages resolve against the font size in au
  (`nsTextFrame.cpp:1949-1963`).
- Non-zero au → `TEXT_DISABLE_OPTIONAL_LIGATURES` (§5.2).

### 12.2 Word spacing

`wordSpacingAu` is added after the cluster containing each `IsCSSWordSpacingSpace` character (`:4215-4226`):

- U+0020 and U+00A0, unless followed by a combining tail;
- U+000D and U+0009 when `!WhiteSpaceIsSignificant`;
- U+000A when `!NewlineIsSignificant` (`:880-898`).

U+3000 gets none.

### 12.3 Tabs

- Tab width in au (`ComputeTabWidthAppUnits`, `:3875-3906`):
  - `tab-size` as a length: that length in au;
  - as a number `n`: `n * (NSToCoordRound(spaceWidthDevPx * apd) + letterSpacing + wordSpacing)`, using the
    **containing block's** first font that has U+0020 and that block's spacing.
- Next stop: `ceil((x + minAdvance) / tabWidth) * tabWidth`, in doubles (`:4298-4304`). `minAdvance` is
  `0.5 * NS_round(ZeroOrAveCharWidth * apd)` (`:1931-1937`). `x` is measured from the line container's
  content edge (`:11063-11067`).
- Tab widths therefore depend on where the line starts. They are not known in preparation.

## 13. `text-transform`

- `nsCaseTransformTextRunFactory::RebuildTextRun` (`ff:layout/generic/nsTextRunTransformations.cpp:900-966`)
  shapes the **transformed** string: uppercase, lowercase, capitalize, full-width, full-size-kana, math-auto
  and masking at `:300-897`. When one character maps to several (for example `ß` → `SS`, because the
  `layout.css.text-transform.uppercase-eszett.enabled` pref is false, §16), `MergeCharactersInTextRun`
  folds the glyphs back onto the original character.
- Break flags are computed on the untransformed transformed-white-space text (§8.1) and copied into the child
  run (`nsTextRunTransformations.cpp:944-946`).
- Capitalization:
  - the whole word from §8 is used; `ShouldCapitalize` (`ff:dom/base/nsLineBreaker.cpp:64-114`) capitalizes
    the first letter or number after Zs/Zl/Zp/Pd/Pi, after Pf other than U+2019, or after Po other than `'`
    and U+00B7;
  - a word continuing across a flush keeps `wordContinuation` (`ff:layout/generic/nsTextFrame.cpp:1839-1842`).
  - So `<span style="text-transform:capitalize">foo<b>bar</b> baz</span>` renders "Foobar Baz".

## 14. Direction, language, device pixel ratio (summary)

| Input | What changes | Where |
|---|---|---|
| `direction`, `unicode-bidi` | bidi splits of frames and text runs; RTL shaping flag; isolate boundaries stop shaping | §4, §5.2 |
| any RTL char in the document | enables bidi, and with it the level check between frames | §4.1 |
| `lang` (explicit) | `cjFlag` for `line-break: normal/loose`; the hyphenation dictionary | §8.6 |
| `mLanguage` (explicit, Content-Language or UI locale) | East Asian punctuation rule in `TransformText`; shaping language | §2.4, §6.2 |
| language atom differs between spans | splits text runs (no shaping across), not words | §5.2 |
| device pixel ratio / zoom | the text run's `apd` (glyph rounding and synthesized spaces in device pixels); `TEXT_OPTIMIZE_SPEED` threshold 20 device px (no advance change) | `nsTextFrame.cpp:2715-2721`, `nsLayoutUtils.cpp:6913-6919`, `gfxTextRun.cpp:3032-3047` |

Break opportunities do not depend on the device pixel ratio.

## 15. Arithmetic in this topic

- **Types**: `nscoord` is an `int32_t` in au. Spacing values are integer au. Tab stop positions are
  `gfxFloat` doubles.
- **Rounding points**:
  - CSS length → au: `NS_lroundf(float(px) * 60f)`, halves away from zero
    (`ServoStyleConstsInlines.h:584-595`; `nsCoord.h:296`). `0.01px` → 1 au; `0.001px` → 0 au.
  - U+0020 advance: `NS_lroundf(spaceWidthDevPx * apd)` (`gfxTextRun.cpp:1590-1622`).
  - Space width inside tab width: `NSToCoordRound` = `floor(x + 0.5)` (`nsTextFrame.cpp:3901-3902`).
  - Minimum tab advance: `0.5 * NS_round(aveCharWidth * apd)` (`:1931-1937`).
  - Synthesized Unicode spaces: `apd * floor(wid + 0.5)` (`gfxTextRun.cpp:3032-3047`).
- **Where widths meet the available width**: not in this topic. The fill records a break if
  `lastBreak < 0 || width + hyphenatedAdvance - trimmableAdvance <= aWidth`
  (`ff:gfx/thebes/gfxTextRun.cpp:1091-1100`); see the Gecko line-fill spec.
- **No epsilon**: every value in this section is an integer au or a double built from integers.

## 16. Runtime settings that change results in 156.0 release

| Setting | Value in 156.0 release | Effect | Source |
|---|---|---|---|
| `layout.css.control-characters.visible` | `@IS_NOT_RELEASE_OR_BETA@` → false | `-moz-control-character-visibility: hidden` → `TEXT_HIDE_CONTROL_CHARACTERS` → no hexboxes for C0/C1 in pages | `ff:modules/libpref/init/StaticPrefList.yaml:10927-10931`; `text.rs:931-940`; `nsLayoutUtils.cpp:6905-6908` |
| `layout.css.letter-spacing.model` | 0 (Nightly 2) | spacing after each cluster | `StaticPrefList.yaml:11041-11050`; `nsTextFrame.cpp:4114-4133` |
| `layout.css.text-autospace.enabled` | true, but initial `no-autospace` | no inter-script spacing unless authored | `StaticPrefList.yaml:11330-11334`; `longhands.toml:2610-2612` |
| `layout.css.text-transform.uppercase-eszett.enabled` | false | `ß` → `SS` | `StaticPrefList.yaml:11323-11327`; `nsTextFrame.cpp:2628-2631` |
| `bidi.numeral` | 0 (nominal) | no digit substitution | `StaticPrefList.yaml:1021-1024`; `nsBidiUtils.h:141`; `gfxTextRun.cpp:2686-2711` |
| `gfx.font_rendering.wordcache.charlimit` | 32 | none on output | `StaticPrefList.yaml:7931-7935` |
| `browser.display.auto_quality_min_font_size` | 20 | `TEXT_OPTIMIZE_SPEED` below 20 device px; flag only | `StaticPrefList.yaml:1535-1538` |
| `gfx.font_rendering.graphite.enabled` | true | Graphite fonts decide space-participation through their own tables | `StaticPrefList.yaml:7925-7928`; `gfxFont.cpp:1562-1566` |
| compile-time `USE_RUST_UNICODE_BIDI` | 1 | unicode-bidi 0.3.15 (Unicode 15.0) instead of ICU `ubidi` | `Bidi.h:11-13` |
| line segmenter choice | no pref | always `create_auto` or `create_lstm_with_options_v2` | `LineBreaker.cpp:57-110` |

## 17. What Canvas can supply (for this topic)

Canvas `measureText` path at 156, main-thread `OffscreenCanvas`:

- `TextReplaceWhitespaceCharacters` turns U+0009, U+000A, U+000B, U+000C, U+000D, U+001C-U+001F, U+0085 and
  U+2029 into U+0020 (`ff:dom/canvas/CanvasRenderingContext2D.cpp:4634-4637`, `:5108-5111`).
- Run flags come from the `<canvas>` element's style if there is one, else they are empty (`:5191-5195`). A
  letter spacing other than 0.0 adds `TEXT_DISABLE_OPTIONAL_LIGATURES`, and letter or word spacing adds
  `TEXT_ENABLE_SPACING` (`:5233-5242`).
- `nsBidiPresUtils::ProcessText` splits the string into direction runs with the paragraph direction from
  `ctx.direction` (`:5126-5150`, `:5261-5266`; `ff:layout/base/nsBidiPresUtils.cpp:2160`). Each run goes to
  `gfxFontGroup::MakeTextRun`, the same shaping path as layout (`CanvasRenderingContext2D.cpp:4822-4851`).
- Spacing is added after every cluster/ligature end in all scripts, as `NSToCoordRound(ls * apd)`. Word
  spacing is added after `CharIsSpace`, which is U+0020 and U+3000 (`:4757-4790`).
- Widths: `NSToCoordRound(advance)` per direction run (`:4853-4869`); total = integer au / apd (`:5276`).
- An `OffscreenCanvas` has no pres shell (`:2086-2094`), so apd = 60 (`:7132-7154`).
- The font size is rounded to 7 significant bits (`QuantizeFontSize`, `:4207-4217`).
- Language: `ctx.lang`, else the root element's `lang`, else the OS locale (`:5423-5469`).

### 17.1 Exact from `measureText` totals

1. **Width of a shaping unit or a whole text run**, when the string passed is exactly the text run's
   transformed content (or a unit of it), the flags match, the direction is one run, and the font size
   survives `QuantizeFontSize`: `round(width * 60)` is the integer au sum. Layout and Canvas share
   `InitTextRun` → `SplitAndInitTextRun` (§7.2).
2. **Word sums**: since shaping splits at U+0020, U+00A0 and invalid characters with no context, summing
   separately measured units plus U+0020 advances is exact. Exception: fonts where
   `SpaceMayParticipateInShaping` is true.
3. **Shaping across span edges**: measure the concatenation of all flows that share one text run (§5.2).
   Measure text runs separately when §5.2 splits them.
4. **Ligature-disabled shaping without added spacing** (hypothesis H30): `ctx.letterSpacing = '0.001px'`
   sets the flag because 0.001 ≠ 0.0, while `NSToCoordRound(0.001 * 60) = 0` adds no spacing (`:5233-5242`,
   `:4757-4790`).

### 17.2 Not available or not exact

- **Break opportunities**: no Canvas API.
  - `Intl.Segmenter` grapheme granularity supplies cluster starts from the same ICU4X segmenter
    (`js/src/builtin/intl/Segmenter.cpp:399`), with the Bengali YA exception at `gfxFont.cpp:708-769`.
  - Word granularity supplies SA boundaries (`:444`; §10).
  - Line pair rules, the ASCII fast path, word splitting, `cjFlag` and cluster filtering must be ported (§8,
    §9).
- **String preparation**: Pretext must apply `TransformText` itself. It must never pass TAB, LF, VT, FF, CR,
  U+001C-U+001F, U+0085 or U+2029 to Canvas: Canvas measures them as U+0020, while layout gives a transformed
  space or zero width.
- **Control characters not in the replacement list** (for example U+0001, U+007F, U+0080): layout gives zero
  width, but an `OffscreenCanvas` draws hexboxes, because its flags lack `TEXT_HIDE_CONTROL_CHARACTERS`
  (`:5191-5195`; `gfxFont.cpp:3883-3893`). Strip them before measuring.
- **Soft hyphens and bidi controls**: layout removes them before shaping; Canvas keeps them. Strip them.
- **Letter spacing on cursive scripts**: layout skips it; Canvas adds it. Word spacing: layout adds it after
  NBSP (and after collapsible TAB/CR/LF) but not U+3000; Canvas adds it after U+0020 and U+3000. Add spacing
  in Pretext's own arithmetic rather than through `ctx.letterSpacing` / `ctx.wordSpacing`.
- **Tab advances** depend on line position (§12.3).
- **Bidi**: Canvas resolves its own levels on the string it gets. To reproduce a DOM text run, pass that
  run's characters only, with `ctx.direction` matching the run's direction. Whether neutral characters at run
  edges then get the same RTL flag is H33.
- **Language decisions** (§2.4, §8.6) come from element `lang` and the UI locale, which Canvas does not see.
- **Device pixel ratio**: layout runs at apd = 60/DPR, so synthesized spaces round to device pixels (§15);
  Canvas at 60. See the width spec for emoji.

## 18. Hypotheses to probe in installed Firefox 156.0

Harness unless stated:

- page `<html lang="en">`, UTF-8;
- element `<p style="margin:0; font:16px/20px 'Helvetica Neue'; width:W">`;
- line count = `p.getBoundingClientRect().height / 20`; line starts from per-character
  `Range.getClientRects()`;
- widths from `getBoundingClientRect().width` of an inline `<span>` wrapper.

"textContent" means set from script, so control characters survive.

1. **H1 no break at a styled span edge**: innerHTML `<b>foo</b>bar`, W = 1px → 1 line.
2. **H2 control for H1**: innerHTML `foo<b> </b>bar`, W = 1px → 2 lines.
3. **H3 kerning across a same-style span edge**: font `32px Arial`. `<span>A<span style="color:red">V</span></span>`
   has the same width as `<span>AV</span>`, which is less than `width(<span>A</span>) + width(<span>V</span>)`.
4. **H4 margin, padding and vertical-align stop shaping**: `A<span style="vertical-align:1px">V</span>`
   (32px Arial) → width = width(A) + width(V). `A<span style="padding-left:0.001px">V</span>` → width equals
   kerned `AV` (0.001px rounds to 0 au). `padding-left:0.01px` → no kerning, plus 1/60 px of padding.
5. **H5 weight splits text runs**: `A<b>V</b>` (32px Arial) → width = width(A regular) + width(V bold).
6. **H6 letter-spacing zero-ness**: in 32px Arial, `A<span style="letter-spacing:0.001px">V</span>` → width
   of kerned `AV`. `A<span style="letter-spacing:0.01px">V</span>` → width(A) + width(V) + 1/60 px.
7. **H7 NBSP and ZWSP**: textContent `"foo bar"`, W = 1px → 1 line; `"foo​bar"` → 2 lines.
8. **H8 no look-through across spaces**: `"( word"` and `"« word"`, W = 1px → 2 lines each, the first
   being `(` or `«`.
9. **H9 FF, VT, CR are opportunities, not forced breaks, and have zero width**: textContent `"ab"`,
   `"ab"`, `"ab"`. W = 1px → 2 lines each; W = 500px → 1 line with width = width of `"ab"`.
10. **H10 CR stops collapsing**: textContent `"a  b"`, W = 500px → width = width(`"a  b"` measured in
    `white-space:pre`) = width(a) + 2 × width(space) + width(b).
11. **H11 hidden controls in the DOM, hexboxes in OffscreenCanvas**: textContent `"ab"` → DOM width =
    width(`"ab"`). `new OffscreenCanvas(1,1).getContext('2d')`, same font:
    `measureText("ab").width > measureText("ab").width`. A `<canvas>` element's context: equal.
12. **H12 East Asian segment-break removal**: font `16px 'PingFang SC'`, HTML source `<span>日本` newline
    `語</span>` → width = `<span>日本語</span>`. `<span>abc` newline `日本</span>` → width =
    `<span>abc 日本</span>`.
13. **H13 context stops at the text node**: `<span>日本` newline `<span>語</span></span>` → width =
    `<span>日本 語</span>` (a space). `<span><span>日本</span>` newline `語</span>` → also a space.
14. **H14 ja/zh punctuation rule**: `<p lang="ja">` with source `。` newline `a` → width = width(`"。a"`).
    `<p lang="en">` → width(`"。 a"`).
15. **H15 UI-locale default language**: a page without any `lang`, `<p>。` newline `a</p>` → equals the H14
    `lang="ja"` result iff the Mac's regional-prefs locale starts with `zh` or `ja`. Record the locale with
    the probe.
16. **H16 small kana under `line-break: auto` = strict**: `<p lang="ja" style="width:1px; font:16px 'PingFang SC'">`,
    textContent `"アァア"` → 2 lines (`アァ`, `ア`). With `line-break: normal` → 3 lines; `loose` → 3 lines.
17. **H17 `cjFlag` stickiness under `line-break: normal`**:
    - `<p lang="ja" style="line-break:normal; width:1px">`, textContent `"あ〜い"` → 3 lines.
    - Same with `lang="en"` → 2 lines (`あ〜`, `い`).
    - `<p lang="ja" style="line-break:normal; width:1px">`, textContent `"あ〜い う"` → 3 lines
      (`あ〜`, `い`, `う`), not 4.
18. **H18 keep-all**: `word-break:keep-all`, W = 1px: `"日本語 テキスト"` → 2 lines. `"한국어 텍스트"` →
    `normal` gives 6 lines, `keep-all` gives 2.
19. **H19 break-all transitions**: W = 1px. innerHTML `<span style="word-break:break-all">abc</span>def` → 4
    lines (`a`, `b`, `c`, `def`). `abc<span style="word-break:break-all">def</span>` → 4 lines (`abc`, `d`,
    `e`, `f`).
20. **H20 `line-break: anywhere` keeps clusters**: textContent `"éé"`, `line-break:anywhere`,
    W = 1px → 2 lines.
21. **H21 soft hyphen**:
    - textContent `"co­op"`, W = 1px → 2 lines, the first ending with a visible hyphen;
      `hyphens:none` → 1 line.
    - `"f­i"` at W = 500px in a font where width(`"fi"`) < width(`"f"`) + width(`"i"`) → width =
      width(`"fi"`).
22. **H22 pre-line**: `white-space:pre-line`, textContent `"a   \n   b"`, W = 500px → 2 lines; line widths
    width(`"a"`) and width(`"b"`).
23. **H23 collapsing across different fonts**: innerHTML
    `<span style="font-family:Georgia">foo </span><span style="font-family:'Courier New'"> bar</span>` → the
    second span's width = width of Courier `"bar"`; the second space is gone.
24. **H24 Arabic joining**: font `48px 'Geeza Pro'`. `ب<span style="color:red">ب</span>` → width = width of
    `بب`. `ب<span style="vertical-align:1px">ب</span>` → width = 2 × width(`ب` alone).
25. **H25 SA run end breaks**: `<p lang="th" style="font:16px Thonburi; width:1px">`.
    - textContent `"ไทย)"` → 2 lines (`ไทย`, `)`);
    - `"(ไทย)"` → 2 lines (`(ไทย`, `)`);
    - `"ภาษาไทยง่ายนิดเดียว"` → lines start at UTF-16 offsets 0, 4, 7, 11.
26. **H26 emergency wrap after a hyphen between digits**: W = 1px: `"1-2"` → 2 lines (`1-`, `2`); `"12"` →
    1 line.
27. **H27 capitalize spans font changes**: innerHTML
    `<p style="text-transform:capitalize">foo<b>bar</b> baz</p>` renders `Foobar Baz`.
28. **H28 SUPPRESS_INITIAL gap**: innerHTML `<p style="white-space:nowrap; width:1px"><span style="white-space:normal">foo </span><span style="white-space:normal">bar baz</span></p>`
    → the source reading of `nsLineBreaker` predicts 3 lines (`foo`, `bar`, `baz`). A CSS reading (the
    nowrap common ancestor controls the boundary) gives 2 lines. Low confidence: `nsLineLayout` may veto the
    frame-boundary break.
29. **H29 Canvas whitespace substitution**: OffscreenCanvas `measureText("ab")` = `measureText("a b")`;
    DOM textContent `"ab"` = width(`"ab"`).
30. **H30 letterSpacing 0.001px disables ligatures with no spacing**: font `32px 'Times New Roman'`.
    OffscreenCanvas with `ctx.letterSpacing = '0.001px'`: `measureText("office").width + 6` equals the DOM
    width of `<span style="letter-spacing:1px">office</span>`. Six clusters with ligatures off; model 0 adds
    1px after each, including the last.
31. **H31 word spacing targets**: `word-spacing:10px`, W = 500px. textContent `"a b"` → width = width
    with `word-spacing:0` + 10px. `"a　b"` → +0px.
32. **H32 U+3000 is not trimmed at line start**: textContent `"　x"` → the `x` glyph's left edge is one
    ideographic-space advance from the content edge (16-bit node gets a frame; `IsTrimmableSpace` excludes
    U+3000).
33. **H33 bidi split ends a text run, not a word, and Canvas direction runs match**:
    - textContent `"abcאבג"`, W = 1px → 1 line.
    - For `"abc אבג"` at W = 500px, the DOM width equals OffscreenCanvas `measureText("abc ")` +
      `measureText("אבג")` with `ctx.direction = 'rtl'` for the second call.

## 19. Differences from the groundwork readings (verified)

1. **Revision**: the groundwork read 155.0.1. The core files are byte-identical at 156 (§0.1), so its line
   numbers for `nsTextFrame.cpp`, `nsTextFrameUtils.cpp`, `nsLineBreaker.cpp`, `LineBreaker.cpp` and
   `nsBidiPresUtils.cpp` still hold. Canvas line numbers moved:
   - `TextReplaceWhitespaceCharacters` 4570 → 4634;
   - bidi-processor spacing 4695-4726 → 4757-4790;
   - `SetText`/`GetWidth` 4764-4805 → 4822-4869;
   - `ResolveFontLang` 5359 → 5423;
   - `GetAppUnitsValues` 7068 → 7132;
   - `QuantizeFontSize` 4203 → 4207.
2. **Text-run sharing**: groundwork §2.2 listed font, language, flags, text-transform, word-break and
   line-break. The full condition also includes bidi level and preceding control, writing mode, a frame
   ending in a significant newline, margin, border, padding, vertical-align and isolation at the boundary, and
   non-fluid continuations (§5.2). Letter spacing counts only as zero or non-zero.
3. **Per-run white space** (NOTES "Firefox transforms white space per text run (direction run)"): the unit is
   the **mapped flow**. `TransformText` sees one text node's slice at a time even inside one text run
   (`nsTextFrame.cpp:2489-2518`), so East Asian segment-break removal never looks across a text node (H13).
4. **Chinese/Japanese flag**: groundwork said "effectively sticky". Verified more precisely:
   - it is updated only in 16-bit `AppendText` paths;
   - it starts false for each scan and is never reset by `FlushCurrentWord`;
   - only the explicit `lang` feeds it, resolved with likely subtags to Hans, Hant, Jpan or Hrkt;
   - words ending inside a flow use the previous value (§8.6, H17).
5. **Mode changes mid-word**: leaving `break-all` or `line-break: anywhere` mid-word sets `mBreakHere`
   (`nsLineBreaker.h:176-181`, `:196-199`). Not in the groundwork.
6. **One-character words** skip ICU4X (`LineBreaker.cpp:120-127`). No effect on output.
7. **OffscreenCanvas control characters**: its run flags are empty, so C0/C1 controls not in the replacement
   list are hexboxes in Canvas but hidden in layout (§17.2, H11). Missing from groundwork §5.5.
8. **Canvas word spacing** goes after `CharIsSpace`, which includes U+3000. Layout's word spacing goes after
   U+0020, NBSP and collapsible TAB/CR/LF, not U+3000 (§12.2, §17). The groundwork said "after each U+0020".
9. **Emergency flags**: the source comment says `SetPotentialLineBreaks` "won't clear" an emergency flag.
   That holds only when the new value is NONE. A NORMAL break replaces it (`gfxFont.h:927-936`).
10. **SA run end**: ICU4X's cached LSTM boundaries include the end of the SA run, so a break is allowed
    between the last SA character and following punctuation or Latin text (§10, H25). Groundwork §1.6 said
    only "complex breaking runs only when both neighbors are SA".
11. **Whitespace-only text nodes**: for Gecko the rule is 8-bit storage only, characters {SP, TAB, LF, CR,
    FF}, at a line boundary, `white-space` normal/nowrap only (§3). The groundwork recorded only Chrome's and
    WebKit's rules.
12. **Bidi engine**: Rust `unicode-bidi` 0.3.15 with Unicode 15.0.0 tables, before layout's
    `ReplaceSeparators` step (§4). The groundwork emulator used a Rust helper without naming the version or
    the separator replacement.
13. **Soft hyphen followed by another skipped character** gives no hyphen opportunity
    (`nsTextFrame.cpp:4441-4443`).
14. **`word-break: break-word`**: min-content breaks at every cluster only for
    `EffectiveOverflowWrap == anywhere`, which includes this value (`nsTextFrame.cpp:9952-9960`).
15. **Default language**: without `lang`, a UTF-8 page's `mLanguage` is the UI locale language (§2.4). That
    changes `TransformText`'s ja/zh punctuation rule (H15). Not in the groundwork.

## 20. Not covered here, or open

- The fill loop (`BreakAndMeasureText`, `nsLineLayout` placement, trailing white-space trimming, hanging
  spaces, `break-spaces`): cited only where this topic's outputs are consumed.
- Floats, atomic inlines, `<wbr>` (it creates `WBRFrame`, `ff:layout/base/nsCSSFrameConstructor.cpp:3408`),
  ruby, `::first-letter`, `::first-line`, text-combine, SVG text, justification, `hyphens: auto`.
- UAX #9 specifics in unicode-bidi 0.3.15 (bracket pairs, rule L1 for trailing white space). Levels are
  consumed only as logical runs (`nsBidiPresUtils.cpp:1015`). Their exact behavior was not re-read.
- `mAlwaysCreateFramesForIgnorableWhitespace` flips after script queries (§3). Pages that touch whitespace
  nodes from script can create frames that a static reading would drop.
- The Unicode version of the line classes: datagen read icuexport 78.1, but the rule table has no HH class.
  A port that exports the trie from the pinned data file sidesteps this.
