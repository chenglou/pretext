# Pretext rebuild: design

Status, 2026-09-16: the input and output types, the environment, the measurement layer, the painter, the lab wiring
and the shared Unicode and break-data pieces exist and are tested, and the review's two blocking issues are resolved
(DESIGN-REVIEW.md). The three engine bodies are skeletons whose TODOs name the spec sections to port.

The library takes a styled paragraph and the environment it will be drawn in, and predicts the lines the installed
browser's own layout produces: where each line breaks, how many lines there are and how wide each line is. It measures
only with Canvas `measureText`. It reads nothing from the DOM for widths and loads no font files. A painter then turns
the predicted lines into DOM elements the browser draws without wrapping them again.

**Correct** means equal to the installed browser:

- Chrome 153.0.8010.48 (Blink, ICU 78.2 from Chrome's `icudtl.dat`);
- Safari 27.0 (WebKit 7625.1.29.11.27, macOS 27 `libicucore` 78.1);
- Firefox 156.0 (Gecko, ICU4X `icu_segmenter` 2.1.2 with Firefox's baked data).

The rules come from each engine's source and data at those versions (`specs/*.md`), never from UAX #14 defaults or
float tolerances. Where Canvas can't supply what the DOM uses, the design either handles it with a recipe or reports a
named gap with the paragraph (§5). Correctness comes first; performance is recovered later, and every layout records
what it measured (§4.6).

Terms used throughout:

- **Source offset**: a UTF-16 offset into the concatenation of all run texts. Every offset in the output is one.
- **Engine**: `blink`, `webkit` or `gecko`.
- **Text content**: the string an engine lays out after white-space processing: Blink's `text_content`, WebKit's text
  box content, Gecko's transformed text. Engines map its offsets back to source offsets.
- **Break opportunity**: an offset in the text content where a line may end.
- **Engine units**: what a layout engine stores widths in. Blink: `LayoutUnit`, an int32 counting 1/64 of a zoomed px,
  built from 16.16 glyph advances and float32 shape widths. WebKit: float32 CSS px. Gecko: app units, integers counting
  1/60 CSS px.
- **Gap**: a known case where Canvas can't give what the DOM uses, so a prediction may be wrong (§5).
- `specs/<engine>-<topic>.md §n` cites the engine specs. `H<n>` is a hypothesis listed at the end of a spec. `CRITIC.md`
  settles some spec contradictions from source.

Installed-browser verdicts override spec claims. The probe runner in `rebuild/probes/` runs the spec hypotheses in the
installed browsers, but no verdicts are recorded yet (there is no `specs/PROBES.md`). Where this design depends on a
hypothesis, it names it, and a contradicting verdict means the section here changes.

## 1. Input

### 1.1 Paragraph and runs

The types are in `src/model.ts`; `lab/types.ts` re-exports `FontDecl`, `TextRun` and `Paragraph`.

```ts
type FontDecl = { family: string; size: number; weight: number; style: 'normal' | 'italic' }
type TextRun = { text: string; node: 'span' | 'text'; font: FontDecl; letterSpacing: number; wordSpacing: number; lang: string | null }
type Paragraph = {
  runs: TextRun[]; font: FontDecl; letterSpacing: number; wordSpacing: number
  width: number; lineHeight: number
  whiteSpace: 'normal' | 'pre' | 'pre-wrap' | 'pre-line' | 'nowrap' | 'break-spaces'
  wordBreak: 'normal' | 'break-all' | 'keep-all' | 'break-word'
  overflowWrap: 'normal' | 'break-word' | 'anywhere'
  lineBreak: 'auto' | 'loose' | 'normal' | 'strict' | 'anywhere'
  tabSize: number; direction: 'ltr' | 'rtl'; lang: string
}
```

Example, the lab smoke case `smoke/spans-mixed-fonts` (fonts abbreviated):

```json
{ "runs": [
    { "text": "Hello ", "node": "span", "font": { "family": "Georgia", "size": 16, "weight": 400, "style": "normal" }, "letterSpacing": 0, "wordSpacing": 0, "lang": null },
    { "text": "world", "node": "span", "font": { "family": "Arial", "size": 16, "weight": 700, "style": "italic" }, "letterSpacing": 0, "wordSpacing": 0, "lang": null },
    { "text": " and ", "node": "text", "font": { "family": "Times New Roman", "size": 16, "weight": 400, "style": "normal" }, "letterSpacing": 0, "wordSpacing": 0, "lang": null },
    { "text": "more text that has to wrap around", "node": "span", "font": { "family": "Verdana", "size": 14, "weight": 400, "style": "normal" }, "letterSpacing": 0, "wordSpacing": 0, "lang": null }
  ],
  "font": { "family": "Times New Roman", "size": 16, "weight": 400, "style": "normal" },
  "letterSpacing": 0, "wordSpacing": 0, "width": 150, "lineHeight": 22,
  "whiteSpace": "normal", "wordBreak": "normal", "overflowWrap": "normal", "lineBreak": "auto", "tabSize": 8, "direction": "ltr", "lang": "en" }
```

It stands for `<div lang="en" style="…">` holding `<span>Hello </span><span>world</span> and <span>more text…</span>`.
Source offsets: run 0 is [0, 6), run 1 [6, 11), run 2 [11, 16) and run 3 [16, 49).

**Why spans and bare text nodes are different inputs.** The engines treat an element edge and a text node edge
differently, in three places that decide lines:

- Which white-space-only text nodes exist. Blink keeps `" "` after a span, because the previous in-flow object is the
  span's `LayoutInline` (specs/blink-text.md §2.A). WebKit drops such a node only when it's the first inline content of
  the block (specs/webkit-text.md §2). Gecko drops an 8-bit white-space-only node at a line boundary under `normal` or
  `nowrap` (specs/gecko-text.md §3).
- Whether a break is allowed at the edge. Blink asks one iterator over the whole paragraph (specs/blink-lines.md §7).
  WebKit builds an iterator over the next box with the next box's style, seeded with the previous box's last two code
  units (specs/webkit-text.md §7.4). Gecko's `nsLineBreaker` grows one word across frames (specs/gecko-text.md §8).
  In all three, bold `foo` followed by `bar` has no break between them.
- What is shaped together. Blink joins items with equal fonts, including locale and spacing (specs/blink-text.md
  §2.E). WebKit never measures across a text box (specs/webkit-text.md §7.5). Gecko shapes across frames with equal
  font, language and flags and plain box edges (specs/gecko-text.md §5.2).

A bare text node carries the paragraph's styles, so it adds a text node edge without an element edge.

**Language.** `run.lang` null inherits `paragraph.lang`. `paragraph.lang` `''` is `lang=""`: the language is unknown
and does not inherit `<html lang>` (lab/VALIDATION.md, fix 1). `<html lang>` is `env.pageLang`.

**Fixed styles.** The lab sets every other property to its initial value: `text-align: start`, `text-indent: 0`,
`text-transform: none`, `hyphens: manual`, `unicode-bidi: normal`, `font-kerning: auto`, `text-rendering: auto`,
`font-variant-ligatures: normal`, `font-optical-sizing: auto`, no margin, border or padding on spans, `vertical-align:
baseline`, and no `<br>`, `<wbr>`, floats or atomic inlines. Engines treat these as values, not as features that don't
exist. For example, `text-align: start` makes Blink's `needsAccurateEndPosition` false, which decides that a line ending
at a space isn't reshaped (specs/blink-lines.md §5.2).

**Planned fields.** Each is a field on `Paragraph` or `TextRun` whose initial value is what the lab fixes today:
`textTransform` (Blink and WebKit break the transformed text; Gecko computes break flags before the transform,
specs/gecko-text.md §13, CRITIC.md C14), `hyphens`, `textIndent`, `textAlign`, span margins, borders, padding and
`vertical-align` (all three stop shaping at such edges), `unicodeBidi` and `dir`, `fontKerning`, feature and variation
settings, `fontOpticalSizing`, `<br>` and `<wbr>`. The lab's generators and page must set a new field, so the architect
adds it to `model.ts` together with the lab owner.

### 1.2 Environment

`src/env.ts`:

```ts
type Environment = {
  engine: Engine            // { name: 'blink', browser: 'Chrome', version: '153.0.8010.48', icu: '78.2' } | …
  devicePixelRatio: number
  pageZoom: number
  pageLang: string
  contentLanguage: string | null
  uiLanguage: string
  preferredLanguages: readonly string[]
  dictionaryBreaks: { kind: 'v8-break-iterator' } | { kind: 'intl-segmenter-word' } | { kind: 'unavailable' }
}
```

`detectEnvironment()` reads the running browser. Anything else (tests, or predicting one engine from another runtime)
builds the object directly.

| Field | Detected from | What reads it |
|---|---|---|
| `engine` | `navigator.userAgent`: `Firefox/156.0`, `Chrome/153.` (the reduced user agent hides the build; the lab records the full user agent), `Version/27.0 … Safari/` | the one switch (§3) |
| `devicePixelRatio` | `window.devicePixelRatio` | Blink: the layout zoom, device scale factor times browser zoom (specs/blink-lines.md §2.1; an emulated DPR lays out at zoom 1). Gecko: app units per device pixel = max(1, round(60 / dpr)) (specs/gecko-lines.md §2.1). WebKit: nothing on the line-breaking path (specs/webkit-lines.md §1.6). |
| `pageZoom` | always 1 when detected | WebKit only: Safari's page zoom multiplies lengths and font sizes and no page API shows it (gap `page-zoom`). Blink and Gecko include browser zoom in the DPR. |
| `pageLang` | `document.documentElement.lang` | Blink's and Gecko's OffscreenCanvas language when `ctx.lang` isn't set; the lab checks it against `case.pageLang` |
| `contentLanguage` | null: pages can't read the header | the root locale when no element has `lang`, in all three engines |
| `uiLanguage`, `preferredLanguages` | `navigator.language(s)` | below |
| `dictionaryBreaks` | the running browser's `Intl` | §6.3 |

Engines derive their own units from these facts (Blink's layout zoom, Gecko's app units per device pixel) inside the
engine module. They aren't stored in the environment.

**UI and system languages**, where the specs say they matter:

- Blink: `DefaultLanguage()`, Chrome's application locale, opens the break table for content with no locale and drops
  the `line-break` keywords. A Chinese UI gives unlabeled text `line_normal_cj`, so `a”b` breaks after `”`
  (specs/blink-text.md §2.F.3). It also picks generic families and the HarfBuzz language, and it's the retry locale when
  `ko@lb=strict` fails to open. Whether `navigator.language` equals it is to be verified (blink-canvas H22, H23;
  blink-text H15).
- WebKit: a `lang` of Han script (`zh`, `zh-CN`, `zh-SG`) is replaced with the first preferred language starting with
  `zh-` (`zh-CN` on this Mac, specs/webkit-canvas.md §1.3). The ICU default locale of the WebContent process decides the
  quote overrides for no `lang` and unknown languages; it isn't known (CRITIC.md C11, webkit-canvas H11).
- Gecko: without `lang`, the style language is the OS regional-preferences locale (specs/gecko-text.md §2.4). It decides
  the ja/zh rule for removing segment breaks next to East Asian punctuation. Firefox's `navigator.language` comes from
  the accept-languages list instead, so such paragraphs report `ui-language`.

## 2. Output

```ts
type ParagraphLayout = { engine: EngineName; lines: Line[]; measure: MeasureLog; gaps: Gap[] }
```

### 2.1 Lines and widths

```ts
type LineOf<Start> = {
  start: number; end: number     // source offsets
  width: number                  // CSS px, painted extent, hanging white space excluded
  engineWidth: EngineWidth
  fragments: Fragment[]          // logical order
  joinsNextLine: boolean         // the paragraph's shaping joined letters across this line's end (§7)
  next: Start | null             // null after the last line
}
type EngineWidth =
  | { unit: 'blink-layout-unit'; raw: number; layoutZoom: number }
  | { unit: 'webkit-float32-px'; value: number }
  | { unit: 'gecko-app-unit'; au: number }
```

- `[start, end)` of consecutive lines tile the source text: every unit belongs to exactly one line, collapsed white
  space and forced breaks included.
- `width` is the extent the lab observes (lab/README.md, "widths"). `engineWidth` is the same width in the engine's
  unit: Blink's `LineInfo` width (specs/blink-lines.md §17) minus hanging spaces, WebKit's `Line::close()` content width
  (specs/webkit-lines.md §9.2), Gecko's line box width (specs/gecko-lines.md §4.8).
- Examples: raw 19239 at layout zoom 2 is 19239 / 64 / 2 = 150.3046875 CSS px; 4320 au is 72 px.
- Engines compute in their own unit and convert once, at output. The lab snaps observed and predicted widths to the
  browser's grid (1/64 px for Chrome and Safari, 1/60 px for Firefox), so a conversion mistake shows up as an offset in
  its width histogram.

### 2.2 Fragments

```ts
type Fragment =
  | { kind: 'text'; run: number; start: number; end: number; painted: string; width: number; level: number }
  | { kind: 'trimmed'; run: number; start: number; end: number; painted: string; level: number }
  | { kind: 'collapsed'; run: number; start: number; end: number }
  | { kind: 'hanging'; run: number; start: number; end: number; painted: string; width: number; level: number }
  | { kind: 'hyphen'; run: number; at: number; painted: string; letterSpacing: number; width: number; level: number }
  | { kind: 'forced-break'; run: number; start: number; end: number }
```

`painted` is the text the engine lays out for that source range: a collapsed run of spaces is one space, a newline in
`normal` is a space, a removed segment break is nothing. Soft hyphens and control characters stay in `painted` when the
engine keeps them in its text. Widths are CSS px. The kinds differ in what the painter does with them (§7):

- `text` and `hanging` are painted as laid out. Hanging white space doesn't count against the available width.
- `trimmed` is collapsible white space the engine removed at the line end after choosing the break. It has no width but
  is painted, so the browser trims it again and shapes the text before it as the paragraph did.
- `collapsed` is source text the engine never lays out: white space collapsed into earlier white space, a removed
  segment break, leading white space at a line start. `forced-break` is the newline that ended the line. Neither is
  painted.

`level` is the bidi embedding level the engine reorders the piece with, after its own line-end rule for trailing white
space (specs/bidi.md §6: Blink compares levels, WebKit compares parity, Gecko has no such rule). Engines split fragments
where the level changes, as they split items and frames before filling lines, so one level per fragment is exact.

Example 1, Blink, `white-space: normal`, width 60px, where `Hello world` doesn't fit. Runs: `"Hello  "` (span), `" "`
(bare text node), `"world"` (span).

| Line | Fragments | start, end |
|---|---|---|
| 1 | `text` run 0 [0, 5) `"Hello"`; `trimmed` run 0 [5, 6) `" "` (removed at the line end, specs/blink-lines.md §8.3); `collapsed` run 0 [6, 7) (the second space collapses while text_content is built); `collapsed` run 1 [7, 8) (the bare space collapses into the previous one, specs/blink-text.md §2.C.4); all levels 0 | 0, 8 |
| 2 | `text` run 2 [8, 13) `"world"` | 8, 13 |

Example 2, `white-space: pre-wrap`, `abc      def` (6 spaces) at the width of `abc` plus one space: line 1 is `text`
[0, 3) `"abc"` and `hanging` [3, 9) with the six spaces' width; line 2 is `text` [9, 12) `"def"`.

Example 3, Blink, `super&shy;cali` narrow enough to break at the soft hyphen: line 1 is `text` [0, 6) `"super­"`
and `hyphen` at 6, `"‐"`, letter spacing 0, because Blink shapes the hyphen alone without spacing
(specs/blink-lines.md §11); line 2 is `text` [6, 10) `"cali"`.

Example 4, Blink, LTR, `font: 24px Arial`, `שלום (עולם ab) cd` breaking after `(עולם `. The pair `(`…`)` holds R and L,
so N0 gives both brackets the embedding direction L (specs/painter.md §4.3). Line 1 is `text` [0, 4) `"שלום"` level 1,
`text` [4, 6) `" ("` level 0, `text` [6, 10) `"עולם"` level 1 and `trimmed` [10, 11) `" "` level 0.

### 2.3 The state the next line starts from

`LineStart = BlinkLineStart | WebKitLineStart | GeckoLineStart`, defined in `src/engines/<engine>/types.ts`. Each holds
exactly what that engine carries from one line to the next.

- **Blink**: `{ engine: 'blink', itemIndex, textOffset, styleRun, afterForcedBreak }`, the break token
  (specs/blink-lines.md §4.1). No width carries over. The next line's start is reshaped when it falls inside a shape
  result at an offset HarfBuzz marked unsafe to break: `ShapeLine` shapes [start, first safe offset) alone and moves the
  available width by the difference between the old and new `ceil64` widths (specs/blink-lines.md §6, step 2). That
  measurement happens while the next line is filled, from the offset in the state. After a forced break the line start
  isn't a wrapped start, so nothing is reshaped.
- **WebKit**: `{ engine: 'webkit', itemIndex, offset, carriedWidth, endsWithLineBreak, isFirstFormattedLine }`.
  `carriedWidth` is the float32 width the rest of a split word keeps without being measured again: when `breakWord`
  keeps a prefix of an item of width W, the rest gets `f32(W − prefix width)` (specs/webkit-lines.md §8.2). Remainders
  compound. From the groundwork: `'AV'.repeat(17)` in 16px Arial with `overflow-wrap: anywhere` at 113.5px starts lines
  at [0, 11, 22] with the carry, and would start them at [0, 11, 22, 33] if the rest were measured fresh.
- **Gecko**: `{ engine: 'gecko', contentOffset }`, where the continuation frame starts. Gecko's redo lives inside one
  line: when a frame overflows after an earlier break position was recorded, the block lays the whole line out again,
  once, with that break forced (specs/gecko-lines.md §4.1, §4.7). `aa b<span style="color:red">bbbbb</span>` in 16px
  Courier New at 57.6px places `aa b` and overflows on `bbbbb`; the redo breaks before `b`, giving `aa` / `bbbbbb`.
  `nextLine` returns only the final pass.

### 2.4 Gaps and the measure log

`gaps` lists `{ gap, run, detail }` for each §5 condition the paragraph meets. The prediction is still returned; a gap
says where it may be wrong. `measure` is the call log (§4.6).

## 3. Pipeline per engine

| Stage | Blink | WebKit | Gecko |
|---|---|---|---|
| Text nodes with layout objects | `TextLayoutObjectIsNeeded` (blink-text §2.A) | `textRendererIsNeeded`; VT isn't ASCII white space (webkit-text §2) | 8-bit white-space-only nodes at a line boundary get no frame (gecko-text §3) |
| Content building | one `text_content` for the block; CR collapses as a space, FF and VT stay literal; a newline is removed only next to ZWSP; the paragraph's trailing space is removed (blink-text §2.C) | per text box: white-space items and word pieces; CR, FF and VT are word content; no segment-break removal; U+2028 and U+2029 force breaks (webkit-text §5) | `TransformText` per mapped flow with one carried in-white-space bit; CR is kept and stops collapsing; East Asian segment-break removal inside one text node; SHY and bidi controls are discarded (gecko-text §6) |
| Bidi | ICU `ubidi` over text_content; off when the result isn't mixed and is LTR; items split at level changes (blink-text §2.D, bidi.md §4) | ICU `ubidi` over paragraph text with LF and TAB as spaces; items split (webkit-text §6, bidi.md §3.2) | `unicode-bidi` over `ReplaceSeparators` text per paragraph; frames split (gecko-text §4) |
| Shaping units | shaping groups: equal `Font` (family, locale, letter and word spacing), direction and script run, no control item or decorated tag between (blink-text §2.E) | one item of one text box at a time, measured with its following space (webkit-lines §3.3) | text runs across frames with equal font, language and flags; shaping words between U+0020, U+00A0 and invalid characters (gecko-text §5.2, §7.2) |
| Break opportunities | `LazyLineBreakIterator`: the space rule, the Latin-1 pair table, break-all and keep-all, ICU restarted at every line start (blink-text §2.F) | `BreakablePositions`: fast classes, the pair table and a stale fast-forward state, then libicucore with prior context and Apple's quote overrides; edges decided with the next box's style (webkit-text §5.4-§7.4) | `nsLineBreaker` words across frames, ICU4X per word, the ASCII shortcut, cluster filtering, after-hyphen emergency flags (gecko-text §7.3-§10) |
| Widths known before filling | shaping group widths in 16.16 at the zoomed size | stored item widths | integer au per shaping unit |
| Line filling | item loop with `ShapeLine`; overflow walk-back re-breaking at `inline_size − 1px`; whole-line retries for break-anywhere and phrase (blink-lines §4-§10) | three builders; candidate content between wrap opportunities; `InlineContentBreaker`, `breakWord`, the carried remainder (webkit-lines §2-§8) | frame by frame `BreakAndMeasureText` with a line-wide break priority and at most one redo (gecko-lines §4, §6) |
| Measured while filling | line-start and line-end reshapes, tabs, the hyphen | `breakWord` prefixes, tabs, deferred widths | tab stops, the hyphen run |
| Line end | the trailing collapsible space is removed after the line is decided; preserved spaces hang (blink-lines §8) | trimmable content removed; `pre-wrap` hangs, conditionally on the last line (webkit-lines §9.1) | `TrimTrailingWhiteSpace`; `pre-wrap` hangs only the overflowing part (gecko-lines §4.4, §4.8) |
| Units and fit test | LU sums, `position <= available + 1 raw` | float32, `width <= lineWidth + 1/64 − contentRight` | integers, `width + advance − trimmable <= available` |

Every row differs, so there is no shared content model and no shared line loop. Each engine module owns its whole
pipeline from `Paragraph` to lines. **The engine choice is one switch**, `layoutParagraph()` in `src/index.ts`. Where the
engines differ only in data, the shared module has one switch that picks the data: `bidiDataFor(engine)` and
`graphemeRulesFor(engine)`. Where their browsers run different algorithms, each algorithm is its own shared module, and
each engine imports the one its browser runs: `breaks/rbbi.ts` or `breaks/icu4x.ts`, `unicode/ubidi.ts` or
`unicode/unicode-bidi.ts`.

Shared, working and tested (§8.2):

- `src/breaks/rbbi.ts`: the ICU rule-based break iterator over `.brk` data, with Apple's category overrides and a
  dictionary-segment flag. Blink and WebKit use it for line and grapheme tables.
- `src/breaks/icu4x.ts`: ICU4X's small code point trie and the rule iterator for Firefox's baked data. Gecko's line
  iterator adds LB9, word options, strictness and SA handling on top; that port belongs to the Gecko owner.
- `src/breaks/tables.ts`: loads each generated table once.
- `src/unicode/ubidi.ts`: ICU's `ubidi_setPara` with default options, ported from ICU 78.2's `ubidi.cpp`, for Blink and
  WebKit. It returns what they read: the direction (text that isn't mixed gets the paragraph level everywhere, and Blink
  then turns bidi off), the paragraphs, which end after every class-B character with CR LF counted once, and one level
  per code unit, from which `ubidi_getLogicalRun`'s runs follow. Removed characters take the next character's level,
  brackets pair under overrides with no 63-opening limit, and an NSM after a changed closing bracket stays neutral
  (specs/bidi.md §5.1, §5.3). Its test runs ICU itself, linked from Homebrew icu4c 78.3 and from the system libicucore
  (§8.2).
- `src/unicode/unicode-bidi.ts`: the groundwork's port of `unicode-bidi` 0.3.15, for Gecko: one paragraph with no split
  at class B, full levels for text with no RTL content, removed characters at the previous character's level, and the
  crate's quirk that `iter_backwards_from` walks earlier level runs forwards.
- `src/unicode/bidi.ts`: the Bidi_Class tables and bracket pairs per engine, `bidiDataFor(engine)`.
- `src/unicode/grapheme.ts`: extended grapheme clusters with Chrome's `char.brk`, libicucore's `char.brk` or Firefox's
  ICU4X data.
- `src/measure/`: contexts, font strings, the call log (§4).
- `src/paint.ts` (§7).

The bidi data is almost the same for all three: the Unicode 17 bracket table and the crate's Unicode 15 table hold the
same 64 pairs, and Firefox's `icu_properties` Bidi_Class equals ICU 78.2's. macOS 27's libicucore gives the private-use
characters U+F7F0..U+F8FF Apple's own classes (ON, NSM, AL, R, ET, EN) where upstream gives L, so WebKit has its own
class table. The groundwork's Gecko bracket table missed 3 of the 64 pairs (U+0F3A, U+2045, U+2308): its generator's
pattern didn't match entries that wrap across lines in `tables.rs`.

What the resolver sees also differs per engine, and engines build that string themselves (specs/bidi.md §3). Blink adds
U+FFFC for floats and isolate controls for `dir` (blink-text §2.C.8, §2.D), and keeps U+2029, U+001C-U+001E and NEL
literally in every mode and CR in preserve modes, which end ICU paragraphs. WebKit replaces LF and TAB with spaces in
collapsing boxes but keeps CR and U+001C-U+001E, inserts LF at forced breaks, and wraps a root `plaintext` paragraph in
FSI … PDI (webkit-text §6). Gecko replaces TAB, LF, VT, CR, U+001C-U+001F, U+0085 and U+2029 with spaces and starts a
paragraph after each preserved newline (gecko-text §4.2).

## 4. Measurement

### 4.1 Which Canvas

All three engines measure with a main-thread `OffscreenCanvas`:

- Blink: a connected `<canvas>` keeps the element's CSS letter and word spacing, feature settings and optical sizing in
  its font description (specs/blink-canvas.md §1.2), and a worker canvas uses the UI language.
- WebKit: a connected `<canvas>` copies the element's font description (specs/webkit-canvas.md §1.3). It would supply a
  locale, but it needs style updates, and the rest of the description leaks in.
- Gecko: a connected `<canvas>` quantizes `size / DPR`, measures on a 1/apd grid and sets opsz and `trak` at `size / DPR`
  (specs/gecko-canvas.md §1.10).

### 4.2 Context settings

A context is identified by its settings (`CanvasSettings` in `src/measure/canvas.ts`), and `measureContext()` creates
one OffscreenCanvas per distinct settings. Identity matters because Chrome caches shaped words per canvas.

| Setting | Blink | WebKit | Gecko |
|---|---|---|---|
| `font` | size `f32(size × layoutZoom)` (§4.3) | size × `pageZoom` | size behind the quantization gate; Apple Color Emoji at size × DPR |
| `lang` | the run's locale, explicit | `''`: OffscreenCanvas has no locale | the run's language, explicit, so Gecko's `explicitLang` is true |
| `letterSpacing` | the run's px: Canvas truncates to 16.16 and turns off liga, clig and calt like the DOM (blink-text H27) | the run's px: the same `WidthIterator` rule | `'0.001px'` when the resolved spacing isn't 0 au (ligatures off, no spacing added), else `'0px'`; spacing added in JS |
| `wordSpacing` | `'0px'`; JS adds `trunc(ws × 65536)` per space except text_content index 0 (blink-text §2.E) | `'0px'`; JS adds the offsets of specs/webkit-lines.md §6.2 | `'0px'`; JS adds au after U+0020 and NBSP (gecko-text §12.2) |
| `textRendering` | `'optimizeLegibility'`: Canvas then shapes whole items exactly for fonts whose GPOS or GSUB lookups contain the space glyph (blink-canvas §1.3, H6) | `'auto'` (no such attribute) | `'auto'` (no width effect) |
| `direction` | the item's direction | `'ltr'`: DOM items measure LTR unless `unicode-bidi` overrides | the bidi run's direction |
| `partition` | `'8bit'` or `'16bit'` | `''` | `''` |

Blink's partition: a word cut from an 8-bit string is shaped as Latin, and the same word from a 16-bit string goes
through `RunSegmenter`. Both share Chrome's per-canvas cache key (word, direction), so whichever is measured first wins
(specs/blink-canvas.md §1.7). Separate canvases keep each storage class's own result. Setting word spacing in JS avoids
the other order effect, where a cached `" "` keeps its first offset-0 decision.

### 4.3 Font strings and sizes

`canvasFont(font, size)` in `src/measure/font.ts` writes `style weight <size>px family`. `String(size)` is the shortest
decimal that parses back to the same double, so a float32 size reaches the CSS parser unchanged.

- **Blink**: the DOM shapes at the computed size `f32(f32(specified) × f32(layout zoom))`, and both the DOM and Canvas
  floor `f32(size × 100) / 100` (specs/blink-lines.md §2.3). `17.3px` at DPR 2 is `34.599998474121094px`, shaped at
  34.59px in both. Canvas widths are then zoomed px, which is what LayoutUnits count. This doesn't reproduce fonts with
  an opsz axis or `trak` and `STAT`, or `system-ui`, where the DOM gives opsz and HarfBuzz's ptem the unzoomed size
  (gap `optical-size`).
- **WebKit**: the CSS size times page zoom. That zoom applies before truncation is unverified (CRITIC.md W5, C10).
- **Gecko**: the DOM size is `NSToIntRound(f32(px) × 60) / 60`, and Canvas quantizes to 7 significant bits
  (specs/gecko-canvas.md §1.2 C2). An engine measures only when the two agree: 16px, 12.5px and 13.5px agree; 13.33px
  becomes 13.375px in Canvas and 800/60 = 13.3333px in the DOM, so it reports `font-size-quantization`. For Apple Color
  Emoji at DPR d the DOM asks Core Text at the device size: measure at that size and scale, `au = round(W × 60) × apd /
  60` (specs/gecko-canvas.md §2 A12). 12px at DPR 2: Canvas at 24px gives 25px, so the DOM width is 12.5px.

### 4.4 Recipes

Exact arithmetic, no epsilons. `W(s)` is `measureText(s).width` in the engine's context.

Blink (specs/blink-lines.md §1, §2; specs/blink-canvas.md §1.5):

```
raw16(word)  = Math.round(W(word) × 65536)                    exact while W < 256 zoomed px
run width    = f32(Σ raw16 over the run's words / 65536)      shape_result.cc:1576
item width   = f32 sum of run widths                          :1609
inline size  = Math.ceil(f32(f32(item width) × 64))           LayoutUnit::FromFloatCeil, raw LU
available    = Math.trunc(f32(f32(width × layoutZoom) × 64))  LayoutUnit(float), raw LU
fits         = position + inline size <= available + 1        line_breaker.h:307-317
CSS px       = raw / 64 / layoutZoom
```

Example, zoom 1: `width: 150.3px` gives 9619 raw and the fit bound 9620. A word whose float32 width is 150.3046875 has
ceil64 9620 and fits. At zoom 1.5 the bound is 14429 raw and the word needs 14430, so it doesn't
(specs/blink-lines.md §2.4).

WebKit (specs/webkit-lines.md §1.4, §3.3; specs/webkit-canvas.md §(e)):

```
w(item)   = text[end] === ' ' ? f32(max(0, f32(W(item + ' ') − f32(W(' ') + wordSpacing)))) : max(0, W(item))
a run     = { left: f32(previous right + word spacing if a separator), width }; merging adds f32(width + w)
available = f32(f32(lineWidthLU / 64 + 1/64) − content right)
```

Example: `width: 100.3px` truncates to 6419 LU = 100.296875px; an empty line's available width is 100.3125. Content of
float32 width 100.3125 fits; 100.31251 doesn't.

Gecko (specs/gecko-lines.md §2; specs/gecko-canvas.md §2, §3):

```
au(unit)     = Math.round(W(unit) × 60)        per shaping unit; exact below 2^23 au
space        = Math.round(W(' ') × 60)
letter space = NS_lroundf(f32(px) × 60) after each cluster end whose base isn't in a cursive script
fits         = width + advance − trimmable <= available   integers
frame width  = ceil(advance)
```

Example: in 16px Courier New every ASCII glyph is 576 au, so `aaaa bbbb` is 5184 au. At `width: 86.4px` (5184 au) it
is 1 line; at 86.38px (5183 au) it is 2 (gecko-lines H1).

### 4.5 When measurement happens

Engines measure when the engine does, because Chrome's cache makes order visible and because measuring what the engine
never measures wastes calls.

| | before filling (`prepare`) | while filling (`nextLine`) |
|---|---|---|
| Blink | every shaping group's words | [start, first safe) at a wrapped line start; [last safe, break) at a line end that isn't at a space; tab widths at their position; the hyphen, once per result |
| WebKit | stored widths of word pieces and single spaces | `breakWord` prefixes from the item start (a bisection over O(log n) prefixes); widths deferred by bidi splits; preserved white space containing TAB; the hyphen string |
| Gecko | every shaping unit's advance; the space | tab stops from the containing block's space width; the hyphen run |

### 4.6 Call log and memo

`MeasureLog = { contexts, calls, memoHits }`: every context's settings, every `measureText` call (context, text,
width) in order, and how many lookups the memo answered. The lab records `calls.length` as `measureLog`.

The memo is an acceleration structure for one layout. Key: (context index, text); value: the width. Measuring the same
text in the same context again returns the same bits in all three engines (Blink returns its cached node for the whole
string; WebKit and Gecko shape the same way), so the memo can't change a result. It lives as long as the `Measurer`,
which `layoutParagraph()` creates per call.

## 5. Canvas versus DOM gaps

"Handled" means the recipe gives the DOM's value. A named gap is reported in `ParagraphLayout.gaps` under the stated
condition.

| Gap | Engines | What differs | Handling | Predictions can be wrong when |
|---|---|---|---|---|
| CR, FF, VT and other controls (`control-character-width`) | all | Every Canvas turns U+0009-U+000D into spaces; Gecko's also turns U+001C-U+001F, U+0085 and U+2029 into spaces (CRITIC.md C12). DOM: Blink collapses CR as a space in collapse modes and keeps FF and VT as characters of unknown width; in preserve modes CR and FF are zero-width control items that end a shaping group (blink-text §2.C.9, H5, H6). WebKit keeps U+000D's glyph advance on the simple path and 0 on the complex path; FF, VT and other Cc take the `.notdef` advance (webkit-text §5.3). Gecko: CR, FF, VT and hidden C0/C1 controls are zero width. | Never pass them to Canvas. Blink: CR in collapse modes is a space in text_content; CR and FF in preserve modes measure 0 and split the group. WebKit: measure FF, VT and other Cc as U+0001 in the same string, which also takes `.notdef` (webkit-canvas H10). Gecko: strip them. | Blink: FF, VT or other C0 in `normal`, `nowrap` or `pre-line`, or VT in any mode. WebKit: CR on the simple path; a control whose `.notdef` comes from another font. |
| Soft hyphen shaping (`soft-hyphen-shaping`) | Blink | Blink's Canvas turns SHY into ZWSP, which splits a 16-bit Canvas word; the DOM shapes SHY inside the item as a hidden glyph. WebKit's Canvas and DOM both keep SHY during shaping. Gecko's DOM discards SHY before shaping. | Blink: measure the word without the SHY. WebKit: keep it. Gecko: strip it. | Blink: a kerning or ligature pair across a soft hyphen. |
| Hyphen glyph (`hyphen-glyph`) | all | The hyphen is U+2010 if the primary font maps it, else `-`. Canvas can't show whether the primary font maps U+2010, because fallback supplies it. | Measure U+2010. Blink synthesizes U+2010 through Core Text for fonts that lack it (blink-text §2.E); the groundwork found Arial, Times New Roman, Georgia and Courier New map it to the hyphen-minus glyph. | WebKit and Gecko: a primary font without U+2010 whose `-` differs from the fallback's U+2010. The lab leaves line widths at soft hyphens unobserved. |
| Letter spacing and ligatures (`letter-spacing-ligatures`) | WebKit | The DOM turns off liga, clig, dlig and hlig when letter spacing isn't 0; OffscreenCanvas keeps them (webkit-canvas §1.3, H3). Blink's Canvas and DOM agree (H27). Gecko's DOM decides on the rounded au value, Canvas on the float. | Blink: `ctx.letterSpacing`. Gecko: `'0.001px'` plus JS spacing. WebKit: none. | WebKit: letter spacing with a font that forms those ligatures in the text. |
| Canvas language (`canvas-language`) | WebKit | Blink's OffscreenCanvas resolves `<html lang>` when the font string is set and keeps it until the string changes (blink-canvas H13); Gecko's resolves per call; WebKit's has no locale. The DOM uses the element's language for generic families, CJK fallback and `locl`. | Blink and Gecko: an explicit `ctx.lang` per context. WebKit: none. | WebKit: text whose font choice depends on language: generic families, Han characters under zh, ja or ko fallback, `locl` forms. |
| Optical size (`optical-size`) | Blink at zoom ≠ 1, Gecko | Blink's DOM shapes at the zoomed Core Text size with opsz and ptem at the CSS size; no Canvas size gives that pair (blink-canvas §1.8, H16). Gecko's OffscreenCanvas never sets auto optical sizing (gecko-canvas §1.2 C1a). WebKit shares the DOM path. | none | Blink: `system-ui` or fonts with an opsz axis or `trak`+`STAT` at layout zoom ≠ 1. Gecko: those fonts under `font-optical-sizing: auto`. |
| Gecko size quantization (`font-size-quantization`) | Gecko | Canvas keeps 7 significant bits; the DOM uses a 1/60 px grid. | The gate in §4.3. | Sizes such as 13.33px, 14.4px or odd eighths. |
| Bitmap emoji (`bitmap-emoji-size`) | Blink, Gecko at DPR ≠ 1 | The DOM asks Core Text for the sbix advance at the device size. | Measure at size × DPR and divide. | Gecko: sizes and sequences not probed (whole-pixel advances verified for U+1F600, 8-40px). Blink: until H17 is verified. |
| Chrome's per-canvas shape cache | Blink | The first shaping of a word per canvas wins: script context, word spacing at offset 0 (blink-canvas §1.7). | Handled: partitions, JS word spacing, a fresh measurer per layout. | — |
| Unsafe-to-break offsets (`unsafe-to-break`) | Blink | Line-start and line-end reshapes happen at HarfBuzz's unsafe-to-break offsets, which Canvas doesn't expose (CRITIC.md §5 item 6). | The port's first candidate: treat an offset as safe when `raw16(prefix) + raw16(suffix)` equals the item's 16.16 total. A hypothesis to probe. | Kerning, ligatures or contextual forms across a break offset, Arabic joining. |
| Script context (`script-context`) | Blink | The DOM shapes an 8-bit paragraph as one Latin segment and merges Common punctuation into the surrounding script in 16-bit paragraphs; Canvas segments each word alone (blink-canvas §1.4). | Measure a Common-only word in the context whose storage class matches the paragraph. | Common-only words in fonts whose Latin and DFLT lookups differ (Amiri, Noto Naskh Arabic). |
| Spaces in shaping (`space-in-shaping`) | Blink, Gecko | The DOM kerns across spaces when the font's lookups involve the space glyph. Blink's word-by-word check ignores legacy `kern`, `kerx` and `morx`; Gecko shapes whole ranges when `SpaceMayParticipateInShaping` (gecko-text §7.2). | Blink: `optimizeLegibility` contexts. Gecko: measure the whole range when `au(a + ' ' + b) ≠ au(a) + au(' ') + au(b)`, a hypothesis to probe. | Blink: cross-space legacy kerning. Gecko: until the detection is verified. |
| In-word prefixes (`in-word-prefix`) | Gecko, Blink | Gecko's DOM uses per-glyph advances from one shaping of the unit, with integer shares of ligatures; Blink uses `ceil64` of prefix positions. Canvas measures a prefix alone. | Gecko: `W(unit) − W(suffix)` where the suffix doesn't depend on what precedes it (gecko-lines §9). | Breaks inside words (overflow-wrap, break-all, CJK, soft hyphens) in fonts with kerning, ligatures or contextual forms. |
| WebKit measuring paths (`simplified-measuring`, `fixed-pitch-path`) | WebKit | The DOM's simplified path doesn't restore space advances and sums in another order; the fixed-pitch path returns `length × spaceWidth` for eligible fonts. | The full-path recipe; the groundwork found 0 differing items. | Fonts whose shaping changes space advances; system monospace fonts eligible for the fixed-pitch path. |
| RTL shaping across inline boxes (`rtl-shaping-across-inline-boxes`) | WebKit | `LineBuilder` reshapes complex RTL text joined across decoration-free boxes as one run (webkit-lines §9.3). | none | RTL complex-script text split over same-font spans. |
| Page zoom (`page-zoom`) | WebKit | No page API shows Safari's page zoom. | `env.pageZoom`, explicit. | Page zoom other than 100%. |
| Font fallback (`font-fallback`) | all | Which font draws a cluster; hexbox and `.notdef` widths; Gecko's synthesized widths for Unicode spaces no font covers, rounded to device pixels. | Canvas totals include fallback. | Text no listed family covers, where Canvas and DOM fall back differently (Blink falls back per cluster over the whole item; Gecko's fallback can arrive later). |
| Float32 precision (`float32-precision`) | Blink | 16.16 values are exact in float32 only below 256 px. | Measure per Canvas word. | One Canvas item of 256 zoomed px or more. |
| String storage (`string-storage`) | all | Blink's single Latin segment, WebKit's keep-all punctuation breaks and 1-unit emergency breaks, and Gecko's white-space-only frames depend on whether a text node is stored 8-bit (CRITIC.md §5 item 14). The page can't see storage. | Treat text whose code units are all ≤ U+00FF as 8-bit, what JS-created nodes get. | Parser-created or edited nodes stored 16-bit. |
| Dictionary breaks (`dictionary-breaks-unavailable`) | all | Thai, Lao, Khmer and Myanmar need dictionary or LSTM data (§6.3). | The running browser's own segmenter. | `env.dictionaryBreaks` is `unavailable`: SA runs get no interior opportunities. |
| UI language (`ui-language`) | all | §1.2 | `env.uiLanguage` | No `lang` anywhere, or `lang=""`. |

## 6. Break data

### 6.1 Generated modules

Generators read pinned engine data, check every input's sha256 against a recorded value, and write one module each:

| Command | Source | Module | Size |
|---|---|---|---|
| `bun rebuild/tools/gen-blink-data.ts` | `data/blink`, checked against `manifest.json`: `line`, `line_normal`, `line_normal_cj`, `line_loose`, `line_loose_cj` and `char` from Chrome 153's `icudtl.dat`, and the generated `kFastLineBreakTable` | `src/breaks/generated/blink-break-tables.ts` | 531 KB |
| `bun rebuild/tools/gen-webkit-data.ts` | `data/webkit`, checked against `FILES.tsv`: the six line tables and `char` libicucore loads, and `BreakablePositions.cpp`'s pair table | `src/breaks/generated/webkit-break-tables.ts` | 629 KB |
| `bun rebuild/tools/gen-gecko-data.ts` | `firefox-156.0/intl/icu_segmenter_data/data`, checked against `data/gecko/segmenter-data-sha256.json`: line and grapheme rule data | `src/breaks/generated/gecko-break-data.ts` | 41 KB |
| `bun rebuild/tools/gen-unicode-data.ts` | ICU 78.2 `ppucd.txt` (Chromium ICU pin, sha256 recorded in `tools/ppucd.ts`), libicucore's private-use classes (recorded in the generator, checked by `bidi.test.ts`) and `unicode-bidi` 0.3.15's `tables.rs` | `src/unicode/generated/bidi-data.ts` | 14 KB |

Tables are base64 in the module, decoded and parsed once per table on first use (`src/breaks/tables.ts`). Not shipped:
the phrase tables and `jaml` model (the input model has no `word-break: auto-phrase`), ICU's dictionaries (`cjdict` is
2 MB) and Firefox's LSTM models (874 KB), because §6.3 takes SA breaks from the running browser. Compacting tables
(dropping the reverse table and rule source, which `rbbi.ts` never reads) is later performance work.

Each engine owner extends only their own generator. Unicode properties the scans need beyond bidi (Line_Break and
General_Category for Blink's break-all and keep-all, General_Category for WebKit's keep-all punctuation and
`canBreakBefore`, East_Asian_Width and scripts for Gecko) come from engine data: `tools/ppucd.ts` reads ICU 78.2's
`ppucd.txt` for Blink; WebKit uses the same plus Apple's private-use differences
(`data/webkit/icu-macos27-libicucore/unicode-properties-vs-upstream78.3.diff`); Gecko uses ppucd with an equality test
against the groundwork's `icu_properties` dump, like `src/unicode/bidi.test.ts` does for Bidi_Class. JavaScript's
`\p{…}` escapes use the JS engine's own Unicode tables, not layout's, so the library doesn't use them for engine
decisions.

### 6.2 What loads what

- Blink: the rule file per locale and `line-break` follows specs/blink-canvas.md §2.3's table, including `ja` and `ko`
  with `line-break: normal` opening `line_normal_cj`, `ko@lb=strict` failing to open and retrying the UI language, and
  no locale dropping the keywords.
- WebKit: `line` (strict) for "" and every non-CJK locale by default, `line_normal` for ja and ko, `line_cj` for zh,
  and `@lb` variants (specs/webkit-canvas.md §2.5), plus quote overrides per locale (§2.6).
- Gecko: one line segmenter; the `zh` content locale only under `normal` or `loose` (specs/gecko-canvas.md §4.3).

### 6.3 Dictionary breaks for Thai, Lao, Khmer and Myanmar

No engine gets these from rules: ICU hands such segments to dictionary engines, and Firefox runs LSTM models. Porting
those engines is large, so the first ports use the running browser's own segmenter where a spec shows it is backed by
the same data, and `env.dictionaryBreaks` says which is available.

- **Blink**: `Intl.v8BreakIterator({ type: 'line' })`. V8 runs the same in-process ICU 78.2 and `icudtl.dat` as layout
  (specs/blink-canvas.md §2.6). It drops locale keywords, which doesn't matter inside SA runs, since the dictionary
  engines don't depend on locale. Use it only for boundaries strictly inside SA runs, with `adoptText(text_content from
  the line start)` because Blink restarts ICU at every line start. To verify: H20 (V8's tables are Chrome 153's), and
  that DOM lines inside SA runs equal it after a line start (blink-text H34).
- **WebKit**: Safari exposes no line segmenter. JSC's `Intl.Segmenter` word granularity runs libicucore's word iterator
  with the same dictionaries. The groundwork measured Chrome's ICU line and word iterators agreeing at 0.999 of SA
  boundaries, exactly once runs starting with a combining mark were set aside (runtime-parity/sa). To verify: the same
  comparison on libicucore (the groundwork's `results/raw/icu-apple.jsonl`), the combining-mark case, and Safari lines
  (webkit-text H22).
- **Gecko**: Firefox's `Intl.Segmenter` word granularity uses ICU4X's word segmenter, and layout's per-word LSTM breaks
  equaled it on 54,589 of 54,589 SA positions (specs/gecko-text.md §10). Gecko feeds one space-delimited word at a time,
  split by language. To verify: installed Firefox 156 (gecko-text H25).

Predicting an engine from another runtime (tests, another browser) leaves `unavailable`: SA runs get no interior break
opportunities and the paragraph reports `dictionary-breaks-unavailable`.

## 7. Painter

`paintLines(paragraph, layout, document)` in `src/paint.ts` returns one `div` per line, in form A-wrap
(specs/painter.md §1, §6):

- **The line block** has the paragraph's content width, font, spacing, `lang`, `direction`, `white-space`, `word-break`,
  `overflow-wrap`, `line-break`, `tab-size` and fixed line height, and the fixed styles of §1.1. The browser then runs
  its own line-end rules on the painted line as it did in the paragraph. Blink trims CJK punctuation at a line end in
  `ShapeLine`, which only runs while wrapping (`あいうえお。` is 88px natively and 96px under `pre`), and Gecko counts only
  the non-overflowing part of hanging `pre-wrap` spaces (painter.md §3.1 e, §3.3 f). A line wider than predicted wraps,
  and the lab reports "painted line wraps". Tab stops count from the line start in both.
- **Slices.** The painted fragments of one run on a line become one node: a span with the run's styles, or a bare text
  node for a bare text node run. Slices of different runs are never merged, since WebKit never measures across a text
  box and Blink rounds up each item's width, and a slice is split only where its level changes.
- **White space.** `text` and `hanging` fragments are painted as laid out. A `trimmed` fragment stays in its slice, so
  the browser trims it again and shapes the text before it the same way. Blink keeps Arial's A+space adjustment on the
  last `A` of `AAAA `, because a line ending at a space isn't reshaped: 2676 raw units at 60px, where a painted `AAAA`
  measures 2732. WebKit measures a word together with its following space (painter.md §3.1 c, §3.2 a). `collapsed` and
  `forced-break` fragments aren't painted.
- **The hyphen** is its own span with the letter spacing the engine gives it, styled in the painter's one engine switch:
  `vertical-align: 0px` in Blink, which ends the shaping group, so `‐` doesn't kern with the `r` of `super`;
  `unicode-bidi: isolate` in Gecko, which ends the text run; nothing in WebKit, whose layout measures the hyphen alone
  while paint shapes it with the word (painter.md R6).
- **Joining at a line edge.** Where `joinsNextLine` is true, U+200D goes after line n's text and before line n+1's, so
  joining scripts keep their joined forms (R7; painter.md probe 5 verifies it). Engines set it only where their shaping
  joined letters across the break, so the painter needs no engine switch for it.
- **Bidi.** A line with a fragment at a level other than the base level gets `unicode-bidi: bidi-override` on the line
  block, and inside each slice one nested `bidi-override` span per level step, alternating direction. Every code unit is
  forced to its level, so the browser reorders the line with the paragraph's levels (R8, painter.md §4.4). Painted
  alone, `שלום (עולם` would resolve the unpaired `(` by N1 and reverse the whole line; with levels `1 1 1 1 0 0 1 1 1 1`
  it draws `שלום` at the left, as the paragraph does (painter.md §4.3, probe 7). Lines whose fragments all sit at the
  base level get no override. The base level is `paragraph.direction` while the model has no `unicode-bidi: plaintext`;
  that planned field adds a base level per line.
- Nothing sets a text width, so the painted extent is an independent check of the predicted width.

What painting a line alone still changes (specs/painter.md §7):

- Gecko: at a break inside a word, kerning across the edge, integer ligature shares and contextual forms (L1); fonts
  whose default lookups involve the space glyph, at line edges (L4).
- Blink and Gecko: contextual lookups other than joining across a mid-word edge (L2), and the script that Common
  characters inherit at a line start (L7).
- Blink: override spans insert bidi control items, which end shaping groups at same-parity level changes (0 to 2) that
  the paragraph shaped together (L9).
- WebKit: when the font kerns a letter with the hyphen, the painted line matches the layout width or the ink, not both
  (L3); RTL shaping across inline boxes on candidates cut by a line edge (L5).

The lab (lab/README.md, "Page protocol" step 5 and "Scoring") appends the elements to a host of the paragraph's width
and scores the `painter` metric: each painted line's rects form one line and its extent equals the predicted width on
the browser's grid. When `widths` passes and `painter` fails, the painting form is wrong, not the prediction. Under
A-wrap the painted text holds hanging and trimmed white space, so the painter extent has to leave out hanging white
space the way the `widths` derivation does ("Visible code points") instead of taking every positive rect of each text
node; that change belongs to the lab owner. Positioning line blocks absolutely (form C) gives the same shaping and
stays the fallback if a case class needs it.

`lab/predictor.ts` calls `layoutParagraph()` in `predict()` and again in `paint()`, which only receives the lab's
`Prediction`. A fresh measurer gives the same Canvas results; `paintMs` includes the second layout.

## 8. Modules, tests and order

### 8.1 Layout and owners

```
rebuild/
  DESIGN.md
  tsconfig.json                   bunx tsc --noEmit -p rebuild/tsconfig.json
  specs/ data/ probes/ lab/       other owners (lab: types.ts re-exports and predictor.ts are wired here)
  tools/
    gen-shared.ts lines.ts ppucd.ts          generator helpers                         architect
    gen-unicode-data.ts                      → src/unicode/generated/bidi-data.ts       architect
    icu-bidi-oracle.c icu-bidi-oracle.ts     ICU's own ubidi, for the bidi tests        architect
    gen-blink-data.ts                        → src/breaks/generated/blink-break-tables.ts   Blink owner
    gen-webkit-data.ts                       → src/breaks/generated/webkit-break-tables.ts  WebKit owner
    gen-gecko-data.ts                        → src/breaks/generated/gecko-break-data.ts     Gecko owner
  src/
    index.ts        layoutParagraph(): the one switch over engines                          architect
    model.ts        input and output types                                                   architect
    env.ts          Environment, detectEnvironment()                                        architect
    paint.ts        paintLines()                                                             architect
    measure/        canvas.ts (contexts, memo), font.ts (font strings), log.ts              architect
    unicode/        bidi.ts, ubidi.ts, unicode-bidi.ts, grapheme.ts, tests, generated/       architect
    breaks/         rbbi.ts, icu4x.ts, tables.ts, rbbi.test.ts, generated/                   architect
    engines/
      engine.ts     EngineImplementation<Prepared, Start>                                    architect
      blink/        index.ts, types.ts; the port adds files and tests here                  Blink owner
      webkit/       index.ts, types.ts                                                       WebKit owner
      gecko/        index.ts, types.ts                                                       Gecko owner
```

An engine owner edits only their engine directory, their generator and its generated module. A change a port needs in
a shared file (a model field, a new gap name, a shared helper fix) goes in the owner's report, and the architect makes
it.

### 8.2 Tests

`bun test rebuild/src` runs in about 7 s. The bidi tests build `tools/icu-bidi-oracle.c` with clang against Homebrew
`icu4c@78` and the system libicucore:

- `src/breaks/rbbi.test.ts`: 1,658 libicucore probes from `data/webkit/icu-macos27-libicucore/probes.tsv` over the
  dumped tables with Apple's quote overrides derived from `delimiters.tsv`, 0 failures (592 samples skipped because ICU
  would run a dictionary engine, 900 rows for locales `delimiters.tsv` lacks); the ICU C probe results over Chrome 153's
  tables from specs/blink-text.md Appendix B and specs/blink-canvas.md §2.3; the generated modules decode to the pinned
  bytes.
- `src/unicode/grapheme.test.ts`: `GraphemeBreakTest-17.0.0.txt` with each engine's data, 0 failures.
- `src/unicode/bidi.test.ts`: for every code point, Blink's Bidi_Class equals Homebrew icu4c 78.3's (Chrome's ICU 78.2
  bidi data) and WebKit's equals the system libicucore's, with the same 64 bracket pairs; Firefox's Bidi_Class equals
  ICU 78.2's, and the crate's bracket pairs equal Unicode 17's.
- `src/unicode/ubidi.test.ts`: direction, paragraphs, every level and the logical runs from ICU equal the port's, with
  either ICU, over 770,241 BidiTest-17.0.0 runs, 183,379 BidiCharacterTest lines (ICU's 6.3.0 file and the crate's
  15.0.0 file), 405,000 fuzz strings (class-B and class-S characters, CR LF, supplementary characters, unpaired
  surrogates, Apple's private-use classes), 3,378 cases nested past the explicit-level and bracket limits, and 51
  directed cases: 0 differences.
- `src/unicode/unicode-bidi.test.ts`: the crate port with Gecko's data over BidiTest-17.0.0 (770,241 runs) and the crate's
  BidiCharacterTest-15.0.0 (91,709 cases), 0 failures, and the crate-side levels of specs/bidi.md §7.5.

Engine ports add bun tests in their directory against the groundwork's recorded outputs, streamed line by line
(`tools/lines.ts`):

- Blink scan: `runtime-parity/blink-webkit/work/blink-requests.jsonl` and `blink-answers.jsonl`, 13,108 requests
  answered by the C++ Blink oracle over Chrome 153's ICU data (line starts per line).
- WebKit scan: `webkit-requests.jsonl` and `webkit-answers.jsonl`, 19,393 requests from the oracle at Safari 7624.
  WebKit 7625 changed `BreakablePositions` (specs/webkit-text.md §15), so rows those changes touch need the patched
  rules or are excluded.
- Gecko scan: `runtime-parity/gecko/tools/unit.ts`'s cases, and the Rust oracle rebuilt against Firefox 156's data
  (specs/gecko-canvas.md §4.4).
- SA sources: `runtime-parity/sa/results/raw/*.jsonl`.

Lines are tested in the installed browsers with the lab, one browser at a time under the shared lock (lab/README.md):
smoke cases first, then the suite sample. The probe runner settles the hypotheses behind §4 and §5.

### 8.3 Implementation order

1. **Done: groundwork for everyone.** This document, the types, the environment, the measurement layer, the painter,
   the shared break and Unicode pieces with their generators and tests, and the lab wiring. The lab runs the rebuilt
   predictor now; every prediction returns a TODO error until an engine lands.
2. **In parallel, one owner per engine**, without touching shared files:
   1. Shape `types.ts`, then content building and items, with bun tests on the spec's worked examples.
   2. Break opportunities over the generated data, tested against the groundwork's answers.
   3. Measurement recipes and prepare-time widths, then line filling, fragments and gaps.
   4. A lab smoke run in that engine's browser, then the suite sample. Attribute each failure to a true loss, the
      painter, or the oracle before changing code.
   Blink and WebKit share `rbbi.ts` and `ubidi.ts`. Gecko shares the measurement layer, the grapheme module and the
   bidi data switch, and has `icu4x.ts` and `unicode-bidi.ts` to itself.
3. **Probes** for the hypotheses §4 and §5 rely on (blink-canvas H6, H13, H16, H17, H27; webkit-canvas H3, H10, H11;
   gecko-canvas H4-H9; CRITIC.md §6). Update this document where a verdict disagrees.
4. **Performance**, from the measure log: calls per paragraph, memo hits, table compaction, and a split between
   preparing a paragraph once and filling lines at many widths.
