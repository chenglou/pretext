# WebKit text preparation and break opportunities

Pinned engine: WebKit tag `WebKit-7625.1.29.11.27` (Safari 27.0, WebKit 22625.1.29.11.27, macOS 27.0 26A428). Checkout `~/github/browser-engines/webkit-7625.1.29.11.27`, HEAD `2756e8be` ("Cherry-pick 86e957015e02. rdar://186477323").

Topic: everything between "a DOM tree of styled text" and "a list of pieces with the positions where a line may end": which text nodes get a renderer, what text each renderer holds, which locale it uses, how that text is cut into items, how break opportunities are found (WebKit's own table and classes, then Apple's libicucore), how bidi splits items, and how opportunities are decided across span edges. Widths, fitting and the line loop are other specs; this one points to them where they touch.

Source reading only. No browser was launched. Two local builds were run against the system ICU: a line-break probe (`scratchpad/icuprobe/probe.cpp`) and the groundwork break oracle patched to 7625 (`scratchpad/oracle7625/`, see section 15).

## 0. Notation and terms

Paths:
- `L/` = `Source/WebCore/layout/formattingContexts/inline/`
- `R/` = `Source/WebCore/rendering/`
- `G/` = `Source/WebCore/platform/graphics/`
- `S/` = `Source/WebCore/style/`
- `WTF/` = `Source/WTF/wtf/`
- `(show)` marks a file outside the sparse checkout, read with `git -C webkit-7625.1.29.11.27 show HEAD:<path>` (same commit).

Every line number is at 7625.

Terms used below:
- **text box**: WebKit's `InlineTextBox`, one per rendered DOM `Text` node. Its **content** is the node's data after `text-transform` (section 3).
- **item**: an `InlineTextItem` or `InlineSoftLineBreakItem`, a slice `[start, end)` of one text box's content. Kinds:
  - **word piece** (`NonWhitespace`): text between two break opportunities.
  - **white-space item** (`Whitespace`): a run of SPACE/TAB (and LF when newlines collapse).
  - **soft line break item**: one forced-break character (preserved LF, U+2028, U+2029). WebKit calls it "soft" but it ends the line unconditionally.
- **opportunity**: an offset where a line may end.
- **scan**: `BreakablePositions::nextBreakablePosition`, WebKit's loop that returns the first opportunity at or after an offset.
- **table**: WebKit's 223 × 223 bit table for character pairs in U+0021..U+00FF.
- **fast class**: WebKit's own coarse line-break class (`kAL`, `kID`, ...) from `classify()`.
- **prior context**: up to 2 UTF-16 code units from before the scanned string, given to the scan and to ICU.
- **8-bit string**: a WTF string stored as Latin-1 bytes. Every code unit is ≤ U+00FF. A JS string whose code units are all ≤ U+00FF is usually stored 8-bit, but that is not guaranteed [I].
- **ICU**: Apple's `libicucore` on this Mac. `u_getVersion` reports 78.1, and the data file is `/usr/share/icu/icudt78l.dat` (36,103,568 bytes, dated 2026-09-03). Probe output is in section 4.3.

Offsets are UTF-16 code units.

## 1. Pipeline

1. Decide which `Text` nodes get a renderer (section 2).
2. Compute each renderer's text: `text-transform`, text security, yen sign (section 3).
3. Compute each text box's locale string (section 4).
4. Cut each text box into items, finding opportunities with the scan and ICU (section 5).
5. If the paragraph needs bidi, resolve levels over the whole paragraph and split items at level edges (section 6).
6. Measure item widths per text box. This is the width spec. The one rule that matters here: no measurement crosses a text box edge (section 7.5).
7. While building lines, decide opportunities between adjacent items, which is where span edges are decided (section 7). Collapse white space across boxes and trim or hang it at line ends (section 8).
8. Only when content overflows, add in-word break positions from `word-break`, `overflow-wrap` and `line-break: anywhere` (section 9).

Which line builder runs (`L/InlineFormattingContext.cpp:170-183`):
- `TextOnlySimpleLineBuilder` needs all of these:
  - content is text and forced breaks only, with no inline boxes, no bidi reordering and no text-autospace (`L/TextOnlySimpleLineBuilder.cpp:488-497`);
  - style has zero word-spacing, is not RTL, and has no `auto-phrase`, text-indent, justify, `box-decoration-break: clone`, hanging-punctuation, `hyphenate-limit-lines`, `text-wrap-style` balance/pretty or line-grid (`:499-528`).
- `RangeBasedLineBuilder` handles the same content wrapped in exactly one inline box that has no margin, border or padding (`L/RangeBasedLineBuilder.cpp:131-185`).
- `LineBuilder` handles everything else.

Any styled span (`<b>`, `<span style>`) is an inline box. So real styled runs go through `LineBuilder` and its cross-edge rule (section 7.3).

## 2. Which text nodes get a renderer

`RenderTreeUpdater::textRendererIsNeeded` (`R/updating/RenderTreeUpdater.cpp:536-595`):

```ts
function textRendererIsNeeded(node: Text, parent: Renderer, previousSibling: Renderer | null, hasPrecedingInFlowChild: boolean): boolean {
  if (!parent.canHaveChildren) return false;                               // :540-541
  if (parent.element && !parent.element.childShouldCreateRenderer(node)) return false; // :542-543
  if (node.isEditingText) return true;                                     // :544-545
  if (node.length === 0) return false;                                     // :546-547
  if (!containsOnlyASCIIWhitespace(node.data)) return true;               // :548-549
  if (previousSibling is RenderText) return true;                          // :550-551
  if (parent is table, table row, table section, table col, frameset, grid, or flexbox that isn't a button) return false; // :553-554
  if (parent.style.preserveNewline) return true;                           // :555-556  pre, pre-wrap, pre-line, break-spaces
  if (previousSibling && previousSibling.isBR) return false;               // :558-560
  if (parent is RenderInline) {                                            // :562-568
    if (previousSibling && !previousSibling.isInline && !previousSibling.isOutOfFlowPositioned) return false;
    return true;
  }
  if (wouldBeFirstInlineContentInsideBlock(parent, previousSibling)) return false; // :570-592
  return hasPrecedingInFlowChild;                                          // :594
}
```

- `containsOnlyASCIIWhitespace` is `m_data.containsOnly<isASCIIWhitespace>()` (`Source/WebCore/dom/CharacterDataInlines.h:254-263` (show)).
- `isASCIIWhitespace(c)` is `c == ' ' || c == '\n' || c == '\t' || c == '\r' || c == '\f'` (`WTF/ASCIICType.h:154-157` (show)).
- **VT (U+000B) is not in that set.** Only `isUnicodeCompatibleASCIIWhitespace` adds it (`:174-177`).

Examples, all in a block with `white-space: normal`:
- `<div> <span>a</span></div>`: the leading `" "` node gets no renderer (first inline content inside the block).
- `<div><span>a</span> <span>b</span></div>`: the `" "` node gets a renderer (it has a preceding in-flow child).
- `<div><span> </span></div>`: the node's parent is the span, a `RenderInline`, so it gets a renderer.
- `<div>\f<span>b</span></div>`: a text node of only FF (or only CR) is ASCII white space, so it gets no renderer.
- `<div>\v<span>b</span></div>`: a text node of only VT gets a renderer. It is word content and paints a `.notdef` glyph (section 5.3).
- In a `pre-wrap` parent every non-empty white-space-only node gets a renderer.

Line endings from the HTML parser differ from DOM APIs:
- The HTML parser turns CR and CRLF into LF (`Source/WebCore/html/parser/InputStreamPreprocessor.h:89-93` (show)).
- Text set through `textContent` or `createTextNode` keeps CR, and CR then follows section 5.3.

## 3. Text content of a text box

- The text box content is `RenderText::text()`. With `-webkit-text-security` it is the secured string; for combined text it is the original text (`Source/WebCore/layout/integration/LayoutIntegrationBoxTreeUpdater.cpp:250-291`).
- `RenderText::setRenderedText` (`R/RenderText.cpp:1791-1830`) applies, in order:
  1. Backslash → U+00A5, only when the primary font cascade says so, or the author gave no non-generic font and the document encoding maps backslash to a currency sign (`:466-478`).
  2. `applyTextTransform(style, text, previousCharacter())` (`:1763-1789`):
     - `capitalize` wins over `uppercase`, which wins over `lowercase`.
     - Then `full-width`, then `full-size-kana`, then `math-auto`.
  3. Text security replaces every character with a bullet.
- **uppercase/lowercase**: `String::convertToUppercaseWithLocale(computedLocale)`.
  - Only Turkish/Azeri (and, for lowercase, Lithuanian) change behavior. Every other locale uses locale-free ICU full case mapping (`WTF/text/StringImpl.cpp:599-650`).
  - Lengths can change. `"ß"` uppercases to `"SS"`, so all later offsets are into the transformed text.
- **capitalize** (`R/RenderText.cpp:297-345`):
  - The string is prefixed with the previous character. That is the last code point of the previous in-flow `RenderText` in pre-order (skipping inline boxes and empty text), else `' '` (`:1639-1656`).
  - NBSP is turned into a space for word finding (`:174-177`).
  - Word boundaries come from WebKit's static ICU **word** iterator. It is opened with the system text-break locale (`AppleTextBreakLocale`, else the top preferred language), not the page language (`WTF/text/TextBreakIterator.cpp:65-71, 112-119`; `WTF/text/cocoa/TextBreakIteratorInternalICUCocoa.cpp:57-101`).
  - The first letter of each word gets `u_totitle`, or `u_strToTitle` with locale `""` (`:179-232`). Dutch `ij` gets locale-aware titlecasing (`:237-290`).
  - Example: `<span>foo</span><span style="text-transform:capitalize">bar</span>` gives `"bar"`, because the previous character `o` is inside the same ICU word as `b`.
- `text-transform` changes measured text only through these content changes. `font-variant` small caps is a width matter.

## 4. Locale of a text box

### 4.1 From `lang` to `computedLocale`

```ts
// Presentational hint: StyledElement::mapLanguageAttributeToLocale (Source/WebCore/dom/StyledElement.cpp:388-397 (show)),
// called for xml:lang, or for lang when there is no xml:lang (Source/WebCore/html/HTMLElement.cpp:278-285 (show)).
function webkitLocaleHint(value: string): string | null {
  return value === "" ? null /* -webkit-locale: auto = null atom, S/values/non-standard/StyleWebKitLocale.h:41 */ : value;
}
// -webkit-locale is inherited. The initial style's locale is document.contentLanguage
// (S/StyleResolveForDocument.cpp:91; Source/WebCore/dom/Document.cpp:11470 (show)),
// set from the Content-Language HTTP header or <meta http-equiv="content-language"> (Document.cpp:5344-5345 (show)).
function setSpecifiedLocale(specified: string | null): string | null {        // G/FontDescription.cpp:107-113
  const script = localeToScriptCode(specified);                                 // Source/WebCore/platform/text/LocaleToScriptMapping.cpp:160-377
  return script === USCRIPT_HAN ? specializedChineseLocale() : specified;       // computedLocale
}
```

- `localeToScriptCode`:
  1. Replace `-` with `_` (`:365`).
  2. Try an exact table entry: `zh` → Han (`:360`), `zh_hk`/`zh_tw` → Traditional Han (`:361-362`), `ja` → Katakana-or-Hiragana (`:237`), `ko` → Hangul (`:248`).
  3. Otherwise read the last `_` part as a script name, then shorten the locale and repeat (`:366-376`). No match gives Common (`:377`).
- So `zh`, `zh-CN` and `zh-SG` become Han and are replaced. `zh-TW`, `zh-Hant` and `zh-Hans` stay as written.
- `specializedChineseLocale()` is the first entry of the user's preferred languages that starts with `zh-`, else `"zh-hans"` (`G/FontDescription.cpp:75-83`).
- `computedLocale` is what layout reads: `style.computedLocale()` = `fontDescription().computedLocale()` (`S/computed/StyleComputedStyleBase+GettersInlines.h:342-345`; `G/FontDescription.h:63`).

### 4.2 From `computedLocale` to the ICU locale string

`TextBreakIteratorICU::makeLocaleWithBreakKeyword` (`WTF/text/icu/TextBreakIteratorICU.h:150-193`):

```ts
function icuLocale(computedLocale: string | null, lineBreak: CSSLineBreak): string {
  const behavior = lineBreakIteratorMode(lineBreak);   // L/text/TextUtil.cpp:450-466: auto, after-white-space, anywhere -> Default; loose/normal/strict -> same name
  const locale = computedLocale ?? "";                  // a null AtomString gives "" (WTF/text/WTFString.cpp:440-443)
  if (behavior === "Default" || locale === "") return locale;   // :152-158
  return uloc_setKeywordValue("lb", behavior.toLowerCase(), locale); // :180, e.g. "ja-JP@lb=strict"
}
// ubrk_open(UBRK_LINE, icuLocale); on failure ubrk_open(UBRK_LINE, "") (TextBreakIteratorICU.h:63-67).
```

Consequences:
- **No `lang` anywhere means the ICU root rules**, and `line-break: loose/normal/strict` does not reach ICU. It only switches the scan from Normal to Special rules (section 5.4).
- ICU falls back through the **process default locale** for locale names its data doesn't know:
  - The groundwork probe `oracle/webkit/build/probe-ja.txt` ran with default `ja_JP`: `"und"` and `"mul"` behaved like `ja`, while `""` stayed root.
  - Safari's WebContent default locale is not visible in WebKit source; see hypothesis H8.
- Which style's locale is used (element-level, not page-level):
  - Inside a text box: that box's own style (`L/InlineItemsBuilder.cpp:950`).
  - At a text box edge: the **next** box's style (`L/text/TextUtil.cpp:384`).
  - After a bidi split inside one box: that box's style (`L/InlineFormattingUtils.cpp:349-350`).
  - So `<p lang="ja"><span lang="en">...</span></p>` uses `en` for the span's text. "Safari follows the page language" holds only because most pages set `lang` on `<html>` and it is inherited.

### 4.3 What Apple ICU 78.1 answers (probe on this Mac)

`scratchpad/icuprobe/probe.cpp` uses `ubrk_open(UBRK_LINE, locale)` over the whole string. Listed are the interior boundaries. `““` is U+201C twice, `ァ` is U+30A1, `〜` is U+301C.

| ICU locale | `----““aabb` | `中文“abc”中文` | `日本ァア` | `中〜中` |
| --- | --- | --- | --- | --- |
| `""`, `en`, `zh-hans`, `zh-Hant`, `und`, `xx` (default `zh_CN`) | 4 | 1 2 7 8 | 1 3 | 2 |
| `ko` | 4 | 1 2 7 8 | 1 2 3 | 2 |
| `ja` | none | 1 8 | 1 2 3 | 2 |
| `ja@lb=strict` | 4 | 1 2 7 8 | 1 3 | 2 |
| `ja@lb=normal`, `ja@lb=loose`, `zh-hans@lb=loose` | 4 | 1 2 7 8 | 1 2 3 | 1 2 |
| `he`, `ar`, `fr` | none | 1 8 | 1 3 | 2 |
| `de` | none | 1 7 8 | 1 3 | 2 |

- Same probe, every locale above: `a “b” c` → 2 6; Thai `ความสวยงาม` → 4; `a\rb`, `a\fb`, `a\vb` → 2 (a mandatory break after CR/FF/VT); `100€` and `£100` → none.
- Apple's data therefore carries locale-specific quotation mark rules (ja, he, ar, fr, de).
- WebKit asks ICU only in some cases (section 5.4). For `中文“abc”中文`, WebKit 7625 decides offsets 2 and 7 itself before ICU is asked, so `ja` gives 1 2 7 8 in Safari 27, not 1 8.

## 5. Items per text box

### 5.1 White-space longhands and predicates

WebKit stores the `white-space` shorthand as two longhands:

| `white-space` | `WhiteSpaceCollapse` | `TextWrapMode` |
| --- | --- | --- |
| normal | Collapse | Wrap |
| nowrap | Collapse | NoWrap |
| pre | Preserve | NoWrap |
| pre-wrap | Preserve | Wrap |
| pre-line | PreserveBreaks | Wrap |
| break-spaces | BreakSpaces | Wrap |

Predicates:
- `preserveSpacesAndTabs = collapse ∈ {Preserve, BreakSpaces}` (`L/text/TextUtil.cpp:424-429`)
- `preserveNewline = collapse ∈ {Preserve, PreserveBreaks, BreakSpaces}` (`:431-436`)
- `wrappingAllowed = textWrapMode != NoWrap` (`:438-442`)
- `trailingWhitespaceHangs = collapse == Preserve && wrap` (`:444-448`), i.e. pre-wrap only
- `ComputedStyle::collapseWhiteSpace() = collapse ∈ {Collapse, PreserveBreaks}` (`S/computed/StyleComputedStyle+GettersInlines.h:266-269`). It gates tab-size (section 10).

### 5.2 Building items: port of `InlineItemsBuilder::handleTextContent` (`L/InlineItemsBuilder.cpp:924-1051`)

```ts
function buildItems(box: TextBox): Item[] {
  const t = box.content, n = t.length, st = box.style;
  if (n === 0) return [emptyItem(box)];                                        // :928-929
  // (combined text, text-combine-upright: one item; not covered)            :933-934
  const preserveSpacesTabs = preserveSpacesAndTabs(st), preserveNL = preserveNewline(st);
  const f = new LineBreakIteratorFactory(t, icuLocaleInputs(st));             // :950, no prior context
  const items: Item[] = [];
  let p = 0;
  while (p < n) {
    const c = t[p];
    // 1. Forced breaks, :954-962
    if (c === 0x2028 || c === 0x2029 || (c === 0x0A && preserveNL)) { items.push(softLineBreak(box, p)); p += 1; continue; }
    // 2. White space, :963-992
    const ws = scanWhitespace(t, p, preserveNL, preserveSpacesTabs, preserveSpacesTabs && st.wordSpacing !== 0);
    if (ws) {
      if (st.whiteSpaceCollapse === "BreakSpaces")
        for (let k = 0; k < ws.length; k++) items.push(whitespaceItem(box, p + k, 1, ws.isWordSeparator)); // :972-978
      else items.push(whitespaceItem(box, p, ws.length, ws.isWordSeparator));                              // :979-988
      p += ws.length; continue;
    }
    // 3. -webkit-nbsp-mode: space (not the default), :993-1011
    if (st.nbspMode === "Space" && c === 0xA0) { while (p < n && t[p] === 0xA0) items.push(wordPiece(box, p++, 1, false)); continue; }
    // 4. Word piece, :1012-1038
    let end = p, trailingSHY = false;
    if (st.hyphens === "None") {
      do { end += moveToNextBreakablePosition(end, f, st); } while (end < n && t[end - 1] === 0xAD);   // :1016-1021, merge across SHY
    } else {
      end += moveToNextBreakablePosition(p, f, st);                                                      // :1023
      trailingSHY = t[end - 1] === 0xAD;                                                                 // :1025
    }
    items.push(wordPiece(box, p, end - p, trailingSHY));
    p = end;
  }
  return items;
}

// :54-73. Note the asymmetry: " \t" stops before the TAB, "\t " does not.
function scanWhitespace(t, start, preserveNL, preserveTab, stopAtWordSeparatorBoundary) {
  let has = false, isSep = false, q = start;
  const isWs = (c: number) => {
    const asSpace = c === 0x20 || (c === 0x0A && !preserveNL) || (c === 0x09 && !preserveTab);
    isSep = asSpace; has = has || asSpace;
    return asSpace || c === 0x09;
  };
  while (q < t.length && isWs(t[q])) {
    if (stopAtWordSeparatorBoundary && has && !isSep) break;
    q++;
  }
  return q === start ? null : { length: q - start, isWordSeparator: has };
}

// :75-87. An answer equal to the scan's own start is accepted when it is past the item start.
function moveToNextBreakablePosition(itemStart: number, f, st): number {
  const len = f.text.length;
  for (let s = itemStart; s < len; s++) {
    const pos = findNextBreakablePosition(f, s, st);
    if (pos !== itemStart) return pos - itemStart;
  }
  return len - itemStart;
}
```

Things to keep:
- **One ICU iterator per text box**, over that box's whole content, with no prior context. Every item's scan in the box shares it. At offset 0 the scan never breaks (section 5.4 step 1). A text box always starts a new item, and whether the edge is an opportunity is decided later (section 7).
- **U+2028 and U+2029 are forced breaks in every white-space mode**, including `normal` (`:954-962`). LF is forced only when newlines are preserved.
- `isWordSeparator` on a white-space item means the run contains a SPACE, or LF/TAB treated as a space. It drives word-spacing offsets (section 10).
- Precomputed widths:
  - Word-piece widths are measured at build time with the following-space trick (`:1030-1035`). Collapsible white-space items get one space width (`:980-984`).
  - Widths are deferred when bidi reordering or text-autospace is present, or when first-line style changes the font (`:1150-1154`, `:777-787`).
  - Preserved white space in a box that contains a TAB is never cached, because its width depends on position (`:784-786`).
- **Break position cache** (`TextBreakingPositionCache`): after layout, the item ends of text boxes with ≥ 5 code units and ≥ 3 items are stored. The key is (content, white-space collapse group, overflow-wrap, line-break, word-break, nbsp-mode, locale, security origin) (`L/text/TextBreakingPositionContext.h:43-86`; `L/text/TextBreakingPositionCache.h:41-48`; `L/InlineItemsBuilder.cpp:1082-1148`).
  - On later builds items are rebuilt from those ends (`:858-922`). The positions are the same.
  - One difference: `isWordSeparator` of a white-space item comes from its **first** character only (`:899`). A pre-wrap run `"\t "` is a word separator on a fresh build but not from the cache. It matters only with word-spacing.

### 5.3 Per-character handling

"Word content" means the character is not white space to WebKit. It lands inside word pieces, and the scan (section 5.4) decides breaks around it.

| Character | normal / nowrap (Collapse) | pre-line (PreserveBreaks) | pre / pre-wrap (Preserve) | break-spaces |
| --- | --- | --- | --- | --- |
| U+0020 SPACE | collapsible white-space run, word separator | same | preserved run, word separator | one item per space |
| U+0009 TAB | like SPACE (word separator, collapsible) | like SPACE | preserved run, **not** a word separator, width from tab stops | one item per tab |
| U+000A LF | like SPACE (no CJK segment-break removal) | forced break | forced break | forced break |
| U+000D CR | word content | word content | word content | word content |
| U+000C FF, U+000B VT, other Cc | word content | same | same | same |
| U+00A0 NBSP | word content (nbsp-mode normal) | same | same | same |
| U+200B ZWSP | word content; break after it through ICU; keep-all breaks before it | same | same | same |
| U+00AD SHY | `hyphens: manual`: pieces end after SHY; `none`: merged; keep-all: no break | same | same | same |
| U+2028 LS, U+2029 PS | forced break; PS also starts a bidi paragraph | same | same | same |
| U+3000 | word content; keep-all breaks after it | same | same | same |

Citations:
- White-space classes: `L/InlineItemsBuilder.cpp:59-64`.
- Forced breaks: `:954-962`.
- SHY merge: `:1016-1021`.
- LS is not a bidi paragraph start: `L/InlineSoftLineBreakItem.h:40`.

How the DOM measures these characters (the width spec owns the arithmetic; this is only what gets drawn):
- **CR and LF** inside measured text: the glyph is replaced by the font's space glyph, but the advance stays the one looked up for the character (`G/WidthIterator.cpp:790-799`).
- **FF, VT and other Cc**: drawn as `.notdef` with `.notdef`'s advance. The simple path is `G/WidthIterator.cpp:817-823`, the complex path `G/ComplexTextController.cpp:773-780`.
- **U+0000, TAB, LF, CR and default-ignorables** (ZWSP, ZWJ, ...) are deleted for rendering (`G/FontCascadeInlines.h:145-158`). The TAB glyph becomes invisible but its advance is the tab-stop width (`G/WidthIterator.cpp:803-806`, `:500-506`).
- **NBSP, SPACE, TAB, LF** get the primary font's space advance restored after shaping (`G/WidthIterator.cpp:473-474`; `G/FontCascadeInlines.h:140-143`).
- An item that is exactly one ZWSP is never measured (`L/InlineTextItem.cpp:84-88`; `L/InlineItemsBuilder.cpp:822`) and always starts a new run (`L/InlineLine.cpp:390-391`).

### 5.4 The scan: port verbatim

Mode selection, `TextUtil::findNextBreakablePosition` (`L/text/TextUtil.cpp:398-422`):

```ts
function findNextBreakablePosition(f: Factory, start: number, st: Style): number {
  const nbspBreaks = st.textWrapMode !== "NoWrap" && st.nbspMode === "Space";                    // :401
  if (st.wordBreak === "KeepAll") return nextBreakableSpace(f.text, start, nbspBreaks, !is8Bit(f.text)); // :403-407 via next(), BreakablePositions.h:292-299
  if (st.wordBreak === "AutoPhrase") return nextBreakablePosition(f, start, "Special", "AutoPhrase", false); // :409-410, disabled by pref (section 12)
  const rules = f.mode === "Default" ? "Normal" : "Special";                                         // :412-421
  return nextBreakablePosition(f, start, rules, "Normal", nbspBreaks);
}
```

- `word-break: break-all` and `break-word` use the Normal words branch. The scan's `BreakAll` template (`R/BreakablePositions.h:200-203`) is never instantiated by layout. **`break-all` adds no opportunities at item build time**; it acts only in overflow (section 9).
- `line-break: anywhere` also scans with Normal rules. It creates opportunities in the line builder instead (sections 7.3 and 9).

The scan, `R/BreakablePositions.h:141-255`. Copy by value wherever C++ copies `CharacterInfo`:

```ts
const kAL = 1, kID = 2, kCM = 4, kOP = 8, kCP = 16, kCL = 32, kGL = 64, kQU = 128, kSP = 256, kPi = 512, kPf = 1024, kWeird = 32768; // :80-102

function isBreakableSpace(c: number, nbspBreaks: boolean) {                                        // :124-139
  return c === 0x20 || c === 0x0A || c === 0x09 || c === 0x2028 || c === 0x2029 || (c === 0xA0 && nbspBreaks);
}

function nextBreakablePosition(f: Factory, start: number, rules: "Normal" | "Special", words: "Normal" | "AutoPhrase", nbspBreaks: boolean): number {
  const s = f.text, ctx = f.priorContext;                  // ctx = [secondToLast, last], 0 means empty
  if (start === 0 && ctx.length === 0) {                   // :149-155: no break at the start without context
    if (s.length <= 1) return s.length;
    start = 1;
  }
  let bb = { ch: start > 1 ? s[start - 2] : ctx.secondToLast, type: 0 };  // :157
  let b  = { ch: start > 0 ? s[start - 1] : ctx.last,         type: 0 };  // :158
  let a  = { ch: 0, type: 0 };
  let nextBreak: number | undefined;
  for (let i = start; i < s.length; bb = { ...b }, b = { ...a }, i++) {
    a = { ch: s[i], type: 0 };
    if (isBreakableSpace(a.ch, nbspBreaks)) return i;                                  // :165-167: break BEFORE the space
    if (rules === "Normal") {                                                          // :170-188
      if (b.ch === 0x2D && isASCIIDigit(a.ch)) { if (isASCIIAlphanumeric(bb.ch)) return i; continue; }
      if (b.ch <= 0xFF && a.ch <= 0xFF) {
        if (b.ch >= 0x21 && a.ch >= 0x21 && TABLE(b.ch, a.ch)) return i;
        continue;                                                                      // a control character or U+0020 on either side: no break
      }
    }
    if (words !== "AutoPhrase") {                                                      // :191-236
      if (!b.type) b.type = classify(b.ch, nbspBreaks);
      a.type = classify(a.ch, nbspBreaks);
      const pair = b.type | a.type;
      if (!(pair & ~(kSP | kAL | kQU | kPi | kPf))) continue;                           // :199-205 letters, quotes, space
      if ((pair | kAL) === (kID | kAL)) return i;                                       // :206-210 ID next to ID or AL: break
      if ((pair & (kGL | kQU)) && !(pair & kWeird)) {                                   // :214-220
        if ((pair & kID) && (pair & kQU) && ((a.type & kPi) || (b.type & kPf))) return i; // local LB19a: before an opening quote / after a closing quote next to ID
        continue;
      }
      if (a.type === kCM) { a.type = b.type; continue; }                                 // :221-224
      if (rules === "Normal" && !(pair & kWeird) && (pair & (kCL | kCP | kOP))) {        // :225-235
        if (a.type === kCL || a.type === kCP || b.type === kOP) continue;
        if (pair & kID) return i;
      }
    }
    if (nextBreak === undefined || nextBreak < i) nextBreak = f.following(i - 1);       // :239-240 (undefined = UBRK_DONE)
    if (nextBreak !== undefined && i < nextBreak) {                                     // :242-249 fast-forward
      const max = Math.min(nextBreak, s.length - 1);
      for (; i < max; bb = { ...b }, b = { ...a }, i++) {                               // `a` is NOT reassigned in this loop
        const la = s[i + 1];
        if ((la <= 0xFF && !isASCIIAlpha(la)) || (nbspBreaks && la === 0xA0)) break;
      }
    }
    if (i === nextBreak && !isBreakableSpace(b.ch, nbspBreaks)) return i;               // :250-251
  }
  return s.length;                                                                       // :254
}
```

**Stale state after a fast-forward.** Inside the fast-forward loop, `b` and `bb` are set to the character where ICU was asked, not to `s[i-1]`.
- When the fast-forward stops early, the outer loop continues with that stale `b` (character and class).
- The next table lookup or class pair is then (character where ICU was asked, current character).
- Example: in `中.abc(d`, WebKit breaks before `(`. ICU was asked at `.` and fast-forwarded to `c`, so the table is read at (`.`, `(`), which is 1. The real pair (`c`, `(`) is 0 in the table and in ICU. `x.abc(d` never asks ICU and has no break. See H9.
- A port must keep this state machine, not a pure pair function.

`classify` (`R/BreakablePositions.h:329-539`). The class depends only on the code unit and on NBSP behavior; the `rules` template argument is unused. Copy it verbatim. In summary:
- **U+0000–U+000F**: Weird. **U+0010–U+001F**: CM.
- **ASCII punctuation and letters**:
  - U+0020 SP; `"` and `'` QU; `(` OP; `)` CP; the rest of U+0021–U+002F Weird.
  - `0–9` NU (= AL); U+003A–U+003F Weird.
  - U+0040–U+005A AL (includes `@`); `[` OP; `]` CP; U+005C, U+005E, U+005F Weird.
  - U+0060–U+007A AL (includes `` ` ``); `{` OP; `}` CL; U+007C, U+007E, U+007F Weird.
- **U+0080–U+00FF**:
  - NBSP is GL, or SP when NBSP breaks.
  - U+00C1–U+00FF AL (including `×` U+00D7 and `÷` U+00F7).
  - `¡` and `¿` OP; `«` QU|Pi; `»` QU|Pf.
  - Everything else Weird, including SHY and U+00C0.
- **Greek through Armenian and Hebrew**:
  - U+0100–U+027F AL; U+0280–U+02FF AL except U+02C8, U+02CC, U+02DF (Weird).
  - U+0300–U+036F CM except U+034F and U+035C–U+0362 (GL); U+0370–U+037F AL except U+037E (Weird).
  - U+0380–U+047F AL; U+0480–U+04FF AL except U+0483–U+0489 (CM); U+0500–U+057F AL.
  - U+0580–U+05FF: AL at or below U+0588 or at or above U+05C8. CM for U+0591–U+05BD and U+05BF, U+05C1, U+05C2, U+05C4, U+05C5, U+05C7. Weird for the rest.
- **Weird blocks**: U+0600–U+09FF and U+1000–U+19FF.
- **U+2000–U+207F**: U+2018 and U+201C QU|Pi; U+2019 and U+201D QU|Pf; the rest Weird.
- **CJK, U+2E80–U+A4CF**:
  - For U+3000–U+303F the class comes from `c & 0x1F`: low bits 01, 02, 09, 0B, 0D, 0F, 11, 15, 17, 19, 1B, 1E, 1F give CL; 08, 0A, 0C, 0E, 10, 14, 16, 18, 1A, 1D give OP; the rest Weird (includes U+3000, U+3005, U+301C). U+3021 is CL because its low bits are 01.
  - U+3040–U+30FF Weird (kana decided by ICU); U+31F0–U+31FF Weird; U+3248–U+324F AL; U+4DC0–U+4DFF AL; U+A015 Weird.
  - Everything else in the range is ID.
- **Hangul and compatibility ideographs**: U+AC00–U+D7AF ID; U+F900–U+FAFF ID.
- **Everything else Weird**. That includes Thai/Lao/Khmer/Myanmar (SA), U+FF00–U+FFEF and surrogate halves. Only ICU breaks around emoji and other supplementary characters.

The table (`R/BreakablePositions.cpp:42-267`, generated from JSC's `$vm.dumpLineBreakData()`, `:34`):
- `TABLE(before, after) = breakTable[before-0x21][(after-0x21) >> 3] & (1 << ((after-0x21) & 7))` (`R/BreakablePositions.h:111-116`). Copy all 223 rows × 28 bytes verbatim.
- Decoded examples (1 = break before `after`):

| Pair | Value | Pair | Value |
| --- | --- | --- | --- |
| `-`,`a` | 1 | `a`,`-` | 0 |
| `?`,`a` | 1 | `!`,`a` | 0 |
| `.`,`a` | 0 | `/`,`a` | 0 |
| `)`,`a` | 0 | `a`,`(` | 0 |
| `$`,`1` | 0 | U+00AD,`a` | 1 |
| `a`,U+00AD | 0 | `.`,`(` | 1 |
| `,`,`[` | 1 | `.`,`<` | 1 |
| `"`,`(` | 1 | `'`,`(` | 0 |

Keep-all, `R/BreakablePositions.h:257-274`, reached through `next()` (`:287-300`):

```ts
function nextBreakableSpace(s: Uint16Array, start: number, nbspBreaks: boolean, punctuationBreaks: boolean /* 16-bit string */): number {
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (isBreakableSpace(c, nbspBreaks)) return i;          // :261-262
    if (c === 0x200B) return i;                              // :264-265 before ZWSP
    if (c === 0x3000) return i + 1;                          // :266-267 after U+3000
    if (punctuationBreaks && (gcMask(c) & (Ps | Pe | Pi | Pf | Po)) && i + 1 < s.length) return i + 1; // :268-271, 16-bit only (:297-298)
  }
  return s.length;
}
```

- There is no "not at position 0" rule and no ICU call.
- In a 16-bit text box, keep-all breaks after **any** Ps/Pe/Pi/Pf/Po code unit, ASCII included: `abc,def(ghi中` → pieces `abc,` | `def(` | `ghi中`. An 8-bit box `abc,def(ghi` has no break.
- SHY, hyphens and ideograph pairs never break under keep-all.

### 5.5 ICU queries and prior context

`CachedLineBreakIteratorFactory` (`WTF/text/TextBreakIterator.h:236-351`):
- It holds the string, the computed locale, the mode (Default/Loose/Normal/Strict) and a 2-unit prior context.
- The ICU iterator is created on first use (`:310-321`). It is recreated when the prior-context span changes, which only happens in `mayBreakInBetween`.
- `PriorContext::length()` counts trailing non-zero units (`:277-283`): `[0, 'x']` has length 1, `[x, 0]` has length 0.

`TextBreakIteratorICU` (`WTF/text/icu/TextBreakIteratorICU.h:48-147`):
- `setText` gives ICU a UText whose native indices put the prior context before the string (`:99-124`; `WTF/text/icu/UTextProvider.h:51-60`; the UTF-16 provider's native length is `a + b`, `WTF/text/icu/UTextProviderUTF16.cpp:120-123`).
- `following(loc) = ubrk_following(it, (loc + priorLen) mod 2^32) - priorLen` (`:136-142`). At `i = 0` with context, `following(i - 1)` asks for the first boundary after context unit `priorLen - 1`.
- A faithful port needs an ICU-78.1-equivalent line iterator:
  - It must run over `priorContext + boxContent` with Apple's data for the locale string of section 4.2.
  - It must include the dictionary breaks for Thai, Lao, Khmer and Myanmar.
- The iterator cache (2 unused iterators, `WTF/text/TextBreakIterator.h:140-181`) does not change answers.

Groundwork measurement, not re-run here: inside SA runs, JSC's `Intl.Segmenter` word granularity matched Apple's line iterator on 53,929 of 53,983 positions, and was exact outside runs that start with a combining mark (`results-sa-equivalence.txt`).

## 6. Bidi

When (`L/InlineItemsBuilder.cpp:127-130`): the root is RTL, or `contentRequiresVisualReordering`. The latter becomes true when either holds:
- A text box has **strong directionality content** (`R/RenderText.cpp:516-520`; `L/text/TextUtil.cpp:486-515`):
  - its content is 16-bit, and
  - it has a code point with bidi class R, AL, RLE, LRE, RLO, LRO or PDF.
  - Isolates (U+2066–U+2069) don't count. RLM (U+200F, class R) and ALM (U+061C, class AL) do.
- An in-flow inline box is RTL, or has `unicode-bidi != normal` with logical ordering (`:231-240`, `:1053-1059`).
  - HTML `dir=ltr` or `dir=rtl` on a span maps to `direction` plus `unicode-bidi: isolate` (`Source/WebCore/html/HTMLElement.cpp:270-277` (show)). So even `dir="ltr"` turns bidi processing on.

Paragraph text, `buildBidiParagraph` (`:550-635`):
1. Open the root context (`:553-555`): `unicode-bidi: override` appends LRO/RLO; `plaintext` appends FSI; `isolate-override` appends FSI plus LRO/RLO. `normal`, `embed` and `isolate` on the block append nothing (`:430-476`).
2. Walk items in order:
   - A hard `<br>`, a block, or a soft line break item whose character is not U+2028: close every open context, append U+000A, reopen the contexts (`:563-574`, `:535-548`).
   - A text item in a box whose newlines are not preserved:
     - on the box's first item, append the **whole box content** with LF and TAB (and U+2029 in 16-bit content) replaced by U+0020 (`:383-415`);
     - the item's offset is `boxOffset + item.start` (`:577-586`).
   - A text item in a box whose newlines are preserved: append the item content. A soft U+2028 appends its character (`:587-594`).
   - Inline box start/end with logical ordering and `unicode-bidi != normal`: append LRE/RLE/PDF (embed), LRO/RLO/PDF (override), LRI/RLI/PDI (isolate), FSI/PDI (plaintext), or FSI+LRO|RLO / PDF+PDI (isolate-override) (`:599-615`). Other inline box items, `<wbr>` and floats are opaque (no offset).
3. If the paragraph is empty, stop. With root `unicode-bidi: plaintext`, no reordering content, and a first strong direction that is LTR, also stop (`:645-655`).
4. `ubidi_setPara(text, paraLevel)`, where `paraLevel` is `UBIDI_DEFAULT_LTR` for plaintext, else 0 for LTR and 1 for RTL (`:666-680`).
5. For each `ubidi_getLogicalRun`, give the covered items that level. **Split any text item that crosses the run end** (`:689-728`; `L/InlineTextItem.cpp:73-82`):
   - the right part becomes a new item;
   - the left part loses its precomputed width but keeps `hasTrailingSoftHyphen`.
6. Opaque items take the level of the range they sit in. Afterwards inline box start/end items that have content get the opaque level (`:730-774`).

Widths of all text items are measured after the splits (`L/InlineItemsBuilder.cpp:132-133`, `:804-856`). Measurement runs are LTR unless `unicode-bidi` is an override (`L/text/TextUtil.cpp:89-90`).

Example: LTR paragraph, text node `xyzשלום`.
- The scan gives one word piece: `z` is AL and `ש` (U+05E9 ≥ U+05C8) is AL, so there is no break.
- ubidi gives level 0 for `[0,3)` and level 1 for `[3,7)`, so the piece is split at 3.
- At the split, `endsWithSoftWrapOpportunity` rescans from 3 over the same box and gets no opportunity (`L/InlineFormattingUtils.cpp:344-353`).
- Result: two items with separate widths, and no opportunity between them.

## 7. Opportunities between items (styled runs)

### 7.1 Inside one text box at one bidi level

Items were cut at the scan's opportunities, so every item edge inside a box is an opportunity (`L/InlineFormattingUtils.cpp:344-346`; `L/TextOnlySimpleLineBuilder.cpp:215`).

### 7.2 `TextOnlySimpleLineBuilder` (no inline boxes)

`isAtSoftWrapOpportunityOrContentEnd(item)` (`L/TextOnlySimpleLineBuilder.cpp:207-216`):
1. The item is white space → yes.
2. It is the last item, or the next item is a forced break → yes.
3. The next item is white space → yes, unless the root has `white-space: break-spaces` or `line-break: after-white-space` (`:200`).
4. The next item is in the same text box → yes.
5. Otherwise → `mayBreakInBetween(item, next)`.

This rule matters only when the root holds several adjacent `Text` nodes with no element between them.

### 7.3 `LineBuilder`: `isAtSoftWrapOpportunity` (`L/InlineFormattingUtils.cpp:385-454`)

```ts
function isAtSoftWrapOpportunity(prev: Item, next: Item): boolean {   // prev/next: text or atomic items, possibly separated by inline box start/end
  const mayWrapPrev = wraps(prev.box.parent.style), mayWrapNext = wraps(next.box.parent.style);
  if (prev.box.parent === next.box.parent && !mayWrapPrev && !mayWrapNext) return false;               // :400-403
  if (isText(prev) && isText(next)) {
    if (prev.isWhitespace || next.isWhitespace) {                                                        // :408-421
      if (prev.isWhitespace) return mayWrapPrev;         // the box holding the space decides
      if (!mayWrapNext) return false;
      return next.style.whiteSpaceCollapse !== "BreakSpaces" && next.style.lineBreak !== "AfterWhiteSpace";
    }
    if (prev.style.lineBreak === "Anywhere" || next.style.lineBreak === "Anywhere") return true;         // :422-426
    if (prev.box.parent === next.box.parent && !wraps(prev.style)) return false;                          // :430-432
    if (!endsWithSoftWrapOpportunity(prev, next)) return false;                                           // :434-435
    return wraps(nearestCommonAncestor(prev.box, next.box).style);                                        // :436, :357-383
  }
  // list markers :438-445; atomic inline on either side -> true :446-450
  return true;
}

function endsWithSoftWrapOpportunity(prev: TextItem, next: TextItem): boolean {                           // :336-355
  if (prev.isWhitespace) return true;
  if (prev.box === next.box) {
    if (prev.bidiLevel === next.bidiLevel) return true;
    const f = new Factory(prev.box.content, icuLocaleInputs(prev.style));                                  // no prior context
    return findNextBreakablePosition(f, next.start, prev.style) === next.start;
  }
  return mayBreakInBetween(prev.box.content, prev.style, next.box.content, next.style);
}
```

`nextWrapOpportunity` (`L/InlineFormattingUtils.cpp:456-544`) walks items to find where the opportunity sits:
- It skips inline box start/end and out-of-flow items.
- It always stops after `<br>` and `<wbr>`, including any inline box ends that directly follow (`:469-475`).
- For an opportunity between `prev` and `current` that are separated by inline box items:
  - the opportunity index is the **first inline box start** between them that is still open at `current`;
  - otherwise it is `current` (`:523-541`).
  - `ex-<span>ample` wraps after `ex-`; `ex-</span></span>ample` wraps after the closing boxes.

### 7.4 `mayBreakInBetween`: the span-edge decision (`L/text/TextUtil.cpp:374-396`)

```ts
function mayBreakInBetween(prevContent: string, prevStyle: Style, nextContent: string, nextStyle: Style): boolean {
  // :379-383: if prevContent is 16-bit, nextContent is converted to 16-bit (only the keep-all punctuation rule can notice)
  const f = new Factory(nextContent, icuLocaleInputs(nextStyle));                     // :384, next box's locale and line-break
  const last = prevContent.length ? prevContent[prevContent.length - 1] : 0;          // :387
  if (last === 0xAD && prevStyle.hyphens === "None") return false;                     // :388-389
  const secondToLast = prevContent.length > 1 ? prevContent[prevContent.length - 2] : 0; // :390
  f.priorContext = [secondToLast, last];                                                // :391
  return findNextBreakablePosition(f, 0, nextStyle) === 0;                              // :395, next box's word-break/nbsp-mode rules
}
```

- The context is the last two code units of the previous text box's **whole content**, not of the item and not across more than one box.
- The next box's style picks the scan (Normal/Special, keep-all) and the ICU locale.

Worked examples from the patched oracle and the table:
- `<b>foo</b>bar`: context `oo`, then `b`. The table (`o`,`b`) is 0, so there is **no opportunity**.
- `<b>ex-</b>ample`: context `x-`, then `a`. The table (`-`,`a`) is 1, so there is an opportunity.
- `<span>中</span><span>文</span>`: ID next to ID, so there is an opportunity.
- `x<b>-</b>1`:
  - At `x`|`-`: the scan returns 1, not 0, so no.
  - At `-`|`1`: the context `[0,'-']` has length 1, so `bb = 0` and the minus-digit rule gives no break.
  - Result: one unbreakable piece. The single text node `x-1` breaks after `-`.
- keep-all `<span>中文，</span><span>中文</span>`: `nextBreakableSpace(next, 0)` never returns 0 unless the next box starts with a breakable space or ZWSP. So there is **no opportunity**, while one node `中文，中文` breaks after `，`.
- `<span style="hyphens:none">co&shy;</span><span>op</span>`: no opportunity (`:388-389`).

### 7.5 Measurement never crosses a text box edge

- `TextUtil::width` measures a substring of one box. It appends the following SPACE only when `text[to]` in **the same box** is U+0020 (`L/text/TextUtil.cpp:72-78`).
- Runs are per box (`L/InlineLine.cpp:379-380`).
- So `<span>A</span><span>V</span>` gets no kerning between A and V, `<b>f</b>i` gets no ligature, and Arabic letters on either side of a span edge don't join.
- The painter must paint each span's text as its own run. It must not merge adjacent same-style text nodes if it wants to keep these widths.

## 8. White space at line time

These rules decide widths and trimming, not opportunities. The line builder spec owns placement.

- **Collapse across boxes**, `Line::appendText` (`L/InlineLine.cpp:346-373`). A collapsible white-space item adds nothing when any of these holds:
  - the item is empty;
  - the nearest earlier text run has collapsible trailing white space (inline box start/end, `<wbr>` and out-of-flow runs are skipped; an atomic inline stops the search);
  - there is no earlier run, i.e. the item is leading white space at the line start.
  - Preserved white space never collapses.
- `TextOnlySimpleLineBuilder` uses the short form: collapse iff the line is empty or the last run has collapsible trailing white space (`:483-495`).
  - Example: `<span>a </span><span> b</span>` renders one space.
  - `<span style="white-space:pre-wrap">a </span><span> b</span>` renders two, because the first run's trailing space is preserved, not collapsible (`L/InlineLine.h:202-203`).
- A collapsible run is one space wide however long it is (`L/text/TextUtil.cpp:116-120`).
- There is no CJK segment-break removal: `中\n文` in `normal` renders a space.
- **Trailing white space**:
  - Fully trimmable content (collapsible white space) is removed at line end (`L/InlineLine.cpp:112-126`; `L/TextOnlySimpleLineBuilder.cpp:423-435`), unless `line-break: after-white-space` preserves it.
  - pre-wrap trailing white space hangs (`L/InlineLine.cpp:461-464`; `L/InlineContentBreaker.cpp:954-957`).
  - break-spaces white space doesn't hang.
- `-webkit-nbsp-mode: space` quirk: a trailing NBSP may be trimmed on overflow (`L/InlineQuirks.cpp:45-51`).

## 9. In-word break positions, only when content overflows

`InlineContentBreaker::wordBreakBehavior` (`L/InlineContentBreaker.cpp:877-915`):

```ts
function wordBreakRules(st: Style, hasWrapOpportunityAtPreviousPosition: boolean, minContent: boolean) {
  if (st.lineBreak === "Anywhere") return ["AtArbitraryPosition"];                                   // :882-883
  if (st.wordBreak === "BreakAll") return ["AtArbitraryPositionWithinWords"];                       // :886-887
  const hyph = !hyphenationDisabled && st.hyphens === "Auto" && canHyphenate(computedLocale);        // :890
  const plus = (r?: string) => (hyph ? (r ? [r, "AtHyphenationOpportunities"] : ["AtHyphenationOpportunities"]) : (r ? [r] : []));
  if (st.wordBreak === "BreakWord" && !hasWrapOpportunityAtPreviousPosition) return plus("AtArbitraryPosition"); // :903-904
  if (((!minContent && st.overflowWrap === "BreakWord") || st.overflowWrap === "Anywhere") && !hasWrapOpportunityAtPreviousPosition)
    return plus("AtArbitraryPosition");                                                             // :908-910
  if (st.wordBreak === "KeepAll") return [];                                                        // :912-913
  return plus();
}
```

- `hasWrapOpportunityAtPreviousPosition` means the line already holds a committed opportunity (`L/TextOnlySimpleLineBuilder.cpp:350`). `overflow-wrap: anywhere` breaks inside a word only when nothing earlier on the line could break.
- **break-all** (`AtArbitraryPositionWithinWords`), in the overflowing run with room left:
  1. `TextUtil::breakWord` picks the longest prefix that fits.
  2. Walk left until `canBreakBefore(text[pos])`. With no such position, no break (`:405-430`).
  - For a non-overflowing earlier run: break at its end if the next run can start a line, else at the last `canBreakBefore` position inside it (`:364-403`, `:565-574`).
  - White-space items are never split.
- **Arbitrary position**, the overflowing run: the `breakWord` prefix, with no punctuation check (`:629-634`).
- **`canBreakBefore(c, lineBreak)`** (`:124-137`) is true unless one of these holds:
  - `line-break` isn't `loose` and `c` is U+2010 or U+2013;
  - `c` is NBSP;
  - `c` has general category Ps/Pe/Pi/Pf/Po, except `\` (U+005C), which can always start a line.
- **Nothing fits on an empty line**, with breaking allowed (`:214-251`):
  1. Keep the first user-perceived character.
  2. For 16-bit text (new at 7625), also keep every following character that `canBreakBefore` rejects (`:139-158`).
  3. If that swallows the whole item, keep the item whole.
  - First character (`L/text/TextUtil.cpp:578-598`): 1 code unit for 8-bit text; one code point on the simple font path; one ICU grapheme on the complex path.
  - The grapheme iterator is opened with the system text-break locale, not the page's (`WTF/text/TextBreakIterator.cpp:65-71, 135-152`).
- **Soft hyphen**:
  - A candidate ending in SHY adds the hyphen width to the fit test (`L/InlineLineBuilder.cpp:1154-1165`).
  - A wrap after SHY becomes `WrapWithHyphen`, or reverts when the hyphen doesn't fit (`L/InlineContentBreaker.cpp:105-122`).
  - The hyphen string is U+2010 if the primary font has the glyph, else `-` (`S/computed/StyleComputedStyle.cpp:419-435`).

## 10. letter-spacing, word-spacing, tab-size, text-autospace

These are the text-level effects. Widths are the width spec.

- **letter-spacing ≠ 0**:
  - The font is created with `liga`, `clig`, `dlig` and `hlig` set to 0; `calt` stays (`S/computed/StyleComputedStyleBase.cpp:324-332, 348-356`; `G/cocoa/UnrealizedCoreTextFont.cpp:221, 258-264`).
  - It also disables simplified measuring (`L/text/TextUtil.cpp:720-721`; `R/RenderText.cpp:498`).
  - Spacing goes after every character whose glyphs have a non-zero advance (`G/WidthIterator.cpp:511-516`; `G/ComplexTextController.cpp:796`).
- **word-spacing**, which has four effects:
  1. In a measured string it is added to SPACE, TAB (when tabs are not allowed), LF and NBSP, except at index 0 unless the character is NBSP (`G/WidthIterator.cpp:518-519`; `G/ComplexTextController.cpp:841-842`).
  2. The following-space trick subtracts `spaceWidth + wordSpacing` (`L/text/TextUtil.cpp:98-99`).
  3. In candidate content a word separator adds `usedWordSpacing` as an offset before the next item (`L/InlineContentBreaker.cpp:968`; `L/InlineLineBuilder.cpp:1083`; `L/InlineLine.cpp:411`).
  4. In preserve modes it splits white-space runs where a TAB follows spaces (`L/InlineItemsBuilder.cpp:964`, `:54-73`).
  - Non-zero word-spacing also rules out `TextOnlySimpleLineBuilder` (`L/TextOnlySimpleLineBuilder.cpp:502`).
- **tab-size**:
  - Applies only when `collapseWhiteSpace()` is false (pre, pre-wrap, break-spaces) and tab-size isn't 0 (`L/text/TextUtil.cpp:91-92`).
  - `baseTabWidth` is `tabSize × spaceWidth` for a number, or the length itself (`G/TabSize.h:52-55`). The primary font's space advance includes no spacing.
  - Tab width (`G/FontCascadeInlines.h:76-94`):
    ```ts
    rem = fmodf(position, baseTabWidth); if (rem < 0) rem += baseTabWidth;
    w = baseTabWidth - rem; if (w < spaceWidth / 2) w += baseTabWidth;
    // base 0 -> w = letterSpacing
    ```
  - The position is the line's content right edge plus the candidate width so far (`L/TextOnlySimpleLineBuilder.cpp:239-243`).
- **text-autospace**: initial `no-autospace` (`Source/WebCore/css/CSSProperties.json:1554-1555` (show)). `中a` gets no extra gap by default.
- **text-spacing-trim**: its pref is off (section 12).

## 11. Arithmetic in this topic

- Offsets are unsigned 32-bit UTF-16 indices (`L/InlineTextItem.h:44-46`). ICU native indices are `int32`.
- The prior-context offset uses unsigned wraparound: `following(i - 1)` at `i = 0` asks ICU at `priorLen - 1` (`WTF/text/icu/TextBreakIteratorICU.h:136-142`).
- Bidi levels are `UBiDiLevel` (uint8). Items built without bidi carry 254 (`UBIDI_DEFAULT_LTR`) as a placeholder (`L/InlineItemsBuilder.cpp:907, 977, 987, 1007, 1031`).
  - `endsWithSoftWrapOpportunity` compares levels with `==` (`L/InlineFormattingUtils.cpp:345`).
- The scan, the table and `nextBreakableSpace` do no arithmetic on widths.
- The only float32 (`InlineLayoutUnit`) comparisons this topic touches, all owned by the width and line specs:

| Comparison | Where |
| --- | --- |
| overflowing run: `nonOverflowingWidth + runWidth > availableWidth` | `L/InlineContentBreaker.cpp:829` |
| `trailingSoftHyphenWidth > availableWidth` | `:117` |
| `lineHasRoomForContent = availableWidth > 0` | `:508` |
| `availableWidthExcludingHyphen > 0` | `:587` |
| available width = `(lineWidth + 1/64) − contentRight` | `L/TextOnlySimpleLineBuilder.cpp:481-486`; `L/InlineLineBuilder.cpp:1172-1181` |

- Tab stops use float32 `fmodf` and a strict `<` against half a space (`G/FontCascadeInlines.h:83-88`).
- No function cited here reads device pixel ratio or zoom. Zoom reaches this topic only through font size and so widths.

## 12. Runtime settings, prefs and system state at 7625

| Setting | Value | Effect |
| --- | --- | --- |
| `CSSWordBreakAutoPhraseEnabled` | default false (`Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml:1659-1672` (show)) | `word-break: auto-phrase` and the CFStringTokenizer route (`WTF/text/cocoa/TextBreakIteratorInternalICUCocoa.cpp:37-38`) are off |
| `CSSTextSpacingTrimEnabled` | default false (`:1529-1541`) | no half-width punctuation trimming |
| `CSSTextWrapPrettyEnabled` | default true (`:1558-1570`) | `text-wrap-style: pretty` picks `LineBuilder`; opportunities are unchanged |
| `text-autospace` initial | `no-autospace` (`CSSProperties.json:1554`) | no autospace items or widths unless an author sets it |
| user preferred languages | system | `lang="zh"` / `zh-CN` become the first `zh-*` preferred language (section 4.1) |
| `AppleTextBreakLocale` or top preferred language | system | grapheme iterator for emergency units; word iterator for `capitalize` (section 3) |
| ICU process default locale | unknown in WebContent | fallback for locale names the data doesn't know (section 4.2, H8) |
| `-webkit-nbsp-mode` initial | `normal` (`Source/WebCore/css/CSSProperties.json:11469` (show)) | NBSP is glue; `handleNonBreakingSpace` and the NBSP quirk stay off |
| `hyphens: auto` availability | `canHyphenate(locale)` (`L/InlineContentBreaker.cpp:890`) | out of scope (manual only) |

## 13. What Canvas can supply

| Fact | From `measureText` totals? | Notes |
| --- | --- | --- |
| Which `Text` nodes get renderers | No | Static DOM rule (section 2). The painter controls it. |
| `text-transform` output | No | Uppercase/lowercase equal ICU root mapping except tr/az/lt (`WTF/text/StringImpl.cpp:599-650`). JS `toUpperCase`/`toLocaleUpperCase('tr')` should match [I]. `capitalize` uses the system-locale word iterator. |
| Locale string per box | No | Static rule over `lang`, Content-Language and system preferred languages (section 4). OffscreenCanvas has no locale at all (PLATFORM_BUGS.md, WebKit #285993). |
| Break opportunities | No | Needs the scan, the table, the fast classes and an ICU 78.1 line iterator with Apple's data and locale tailorings. Safari exposes no JS line segmenter. Inside SA runs, `Intl.Segmenter` word granularity is a close stand-in (groundwork: 99.9%). |
| Keep-all and `canBreakBefore` punctuation | No | General category tables. JS `\p{Po}` regexes use JSC's Unicode tables, whose version may differ from libicucore's [I]. |
| Bidi levels and split points | No | Needs a UAX #9 resolver matching ICU `ubidi`, over the paragraph text of section 6. |
| Grapheme units for emergency breaks | Partly | `Intl.Segmenter('...', {granularity:'grapheme'})` in JSC uses ICU. Grapheme rules are locale-independent in root [I]. The code-point unit on the simple path and the 1-unit rule for 8-bit text are static. |
| Item widths within a text box | Yes | `measureText(piece + " ") − measureText(" ")` when the next unit in the same box is U+0020, else `measureText(piece)`. Apply float32 and clamp at 0. Groundwork: bit-exact on 2,620,573 of 2,620,590 items. Never concatenate across a span edge (section 7.5). |
| Widths of pieces containing CR, FF or VT | No | Canvas replaces U+0009–U+000D with U+0020 before measuring (`Source/WebCore/html/canvas/CanvasRenderingContext2DBase.cpp:2847-2875, 3066`). DOM draws CR with the space glyph but CR's own advance, and FF/VT as `.notdef`. |
| Widths with letter-spacing | Only for fonts without `liga`/`clig`/`dlig`/`hlig` | Canvas `letterSpacing` keeps ligatures the DOM turns off (groundwork `research/webkit-source.md` §5). |
| Widths that depend on the page language (generic families, fallback) | No | OffscreenCanvas passes no language. |
| Hyphen string choice (U+2010 or `-`) | Not directly | Needs "does the primary font have a U+2010 glyph". |
| Whether a string is 8-bit | No | Approximate with "every unit ≤ U+00FF" [I]. |

## 14. Hypotheses to probe in installed Safari 27.0

Unless noted, each probe is a `<p>` with `margin:0` and the stated font, width and `white-space: normal`. The text is set with `textContent`, or given as markup for span cases. "Pieces" means the lines expected at that width: every soft wrap opportunity starts a new line, and pieces that don't fit stay whole. The expected outcome is what the source gives.

1. **H1 no break across a bold edge.** `<p style="font:16px Arial;width:1px"><b>foo</b>bar</p>` → 1 line. Control `<b>foo</b> bar` → 2 lines.
2. **H2 break after a hyphen at an edge.** `<b>ex-</b>ample`, 16px Arial, width 1px → 2 lines `ex-` | `ample`.
3. **H3 one-character previous box loses context.** `x<b>-</b>1`, 16px Arial, width 1px → 1 line. Single text node `x-1` → 2 lines `x-` | `1`.
4. **H4 local LB19a rule overrides `ja` ICU (new at 7625).**
   - Text `中文“abc”中文` (U+201C/U+201D), `<html lang="ja">`, `font:20px "Hiragino Mincho ProN"`, width 25px.
   - Expected: 5 lines `中` | `文` | `“abc”` | `中` | `文`. WebKit 7624 or plain `ja` ICU would give 3 (`中` | `文“abc”中` | `文`).
5. **H5 guillemets next to ideographs (new at 7625).** `中«abc»中`, lang en, 20px Hiragino Mincho ProN, width 25px → 3 lines `中` | `«abc»` | `中`. 7624: 1 line.
6. **H6 locale tailoring of quotes in Apple ICU.** `----““aabb` (two U+201C), 16px Arial, width 1px.
   - `lang="en"`, or no lang → 5 lines (`-` ×4 | `““aabb`).
   - `lang` = `ja`, `fr`, `de`, `he` or `ar` → 4 lines (`-` ×3 | `-““aabb`).
7. **H7 element lang wins over page lang.**
   - `<html lang="ja">`, `<p><span lang="en">----““aabb</span></p>` → 5 lines.
   - `<html lang="en">`, `<span lang="ja">` → 4 lines.
   - `<html lang="ja">`, `<p lang="">` → 5 lines (empty lang = root).
8. **H8 ICU default locale in WebContent.** Probe H6 with `lang="und"` and `lang="xx"`. 5 lines means Safari's ICU default has no quote tailoring (like `en`); 4 lines means it does. The source doesn't decide.
9. **H9 stale scan state.**
   - `中.abc(d`, 16px Arial, width 1px → 2 lines `中.abc` | `(d`.
   - Controls: `x.abc(d` → 1 line. `中,abc[d` → 2 lines `中,abc` | `[d`. `中.abc<d` → 2 lines.
10. **H10 CR is word content; ICU decides breaks around it.**
    - `a\rb` (via `textContent`), 16px Arial, width 1px → 1 line.
    - Same with `line-break: strict` → 2 lines `a\r` | `b`.
    - `中\r中` → 2 lines `中\r` | `中`; the same for `\f` and `\v`.
11. **H11 CR width is not a space width in the DOM.**
    - `<span>a\rb</span>` and `<span>a b</span>`, 16px Arial, compared with `getBoundingClientRect().width`: they differ.
    - `measureText("a\rb") === measureText("a b")`.
    - Groundwork measured `a\rb` at 17.797px DOM versus 22.242px Canvas in Playwright WebKit.
12. **H12 white-space-only text nodes.** 16px Arial, in an inline-block wrapper:
    - `<div><span>a</span>\f<span>b</span></div>` has a `.notdef` between `a` and `b`.
    - `<div>\f<span>b</span></div>` has none (no renderer).
    - `<div>\v<span>b</span></div>` has a `.notdef` before `b`.
13. **H13 U+2028/U+2029 force breaks in normal white space.** `a b` and `a b`, width 1000px → 2 lines each.
14. **H14 `hyphens: none` merges soft hyphens.** `co­op`, 16px Arial, width 1px.
    - `hyphens: manual` → 2 lines `co‐` | `op`.
    - `hyphens: none` → 1 line `coop`.
15. **H15 keep-all punctuation rule only in 16-bit text boxes (new at 7625).** `word-break: keep-all`, 16px Arial, width 1px.
    - `abc,def(ghi中` → 3 lines `abc,` | `def(` | `ghi中`.
    - `abc,def(ghi` → 1 line.
16. **H16 keep-all never breaks at a span edge.** `word-break:keep-all`, 20px Hiragino Mincho ProN, width 1px.
    - `<span>中文，</span><span>中文</span>` → 1 line.
    - Single node `中文，中文` → 2 lines `中文，` | `中文`.
17. **H17 keep-all ignores soft hyphens.** `co­op`, keep-all, width 1px → 1 line, no hyphen.
18. **H18 ZWSP position depends on keep-all.** `a​b`, width 1px.
    - `normal` → 2 lines `a​` | `b`.
    - `keep-all` → 2 lines `a` | `​b`.
19. **H19 break-all walks back before punctuation.** `word-break: break-all`, `font:16px Menlo` (about 9.63px per character, so 5 characters fit), width 48.2px, text `aaaa,,,,bbbb` → 3 lines `aaa` | `a,,,,` | `bbbb`.
20. **H20 line-start prohibition when nothing fits (new at 7625).** `overflow-wrap: anywhere`, text `中、、文`, 20px Hiragino Mincho ProN, width 1px → 2 lines `中、、` | `文`. The groundwork's Safari 26.5 source reading predicts 4 lines (`中` | `、` | `、` | `文`).
21. **H21 kana rules need a lang for `line-break: normal`.** `日本ァア` (U+30A1 U+30A2), 20px Hiragino Mincho ProN, width 25px:

    | Setting | Lines |
    | --- | --- |
    | `lang=en; line-break:normal` | 4 |
    | no lang, no Content-Language; `line-break:normal` | 3 (`日` \| `本ァ` \| `ア`) |
    | `lang=ja` | 4 |
    | `lang=ja; line-break:strict` | 3 |

22. **H22 Thai through dictionaries.** `ความสวยงามของธรรมชาติ`, `lang=th`, 16px Thonburi, width 1px → 4 lines starting at offsets 0, 4, 10, 13.
23. **H23 hyphen-minus and `?`.** 16px Arial, width 1px.
    - `ab-12 -12 a -12 12-34` → 7 lines `ab-` | `12` | `-12` | `a` | `-12` | `12-` | `34`.
    - `x?-b x?$b x!(b` → 7 lines `x?` | `-` | `b` | `x?` | `$b` | `x!` | `(b`.
24. **H24 NBSP glue between ideographs.** `中 中`, 20px Hiragino Mincho ProN, width 25px → 1 line.
25. **H25 collapse across spans follows the previous run's white-space mode.**
    - `<span style="white-space:pre-wrap">a </span><span> b</span>` renders two spaces.
    - `<span>a </span><span> b</span>` renders one.
    - Compare the line width with `a  b` and `a b` in one pre-wrap node.
26. **H26 no kerning across a span edge.** `<span>A</span><span>V</span>` in 24px "Times New Roman" is wider than a single node `AV` by the AV kern amount. It equals the sum of the two spans' widths.
27. **H27 LF in normal white space between CJK stays a space.** Width of `中\n文` equals width of `中 文` (20px Hiragino Mincho ProN).
28. **H28 bidi split adds no opportunity.** `xyzשלום`, LTR, 16px Arial, width 1px → 1 line.
29. **H29 text-autospace is off by default.** Width of `中a` equals the width of `<span>中</span><span>a</span>`, with no ideograph-alpha gap.
30. **H30 `lang="zh"` uses the user's `zh-*` preferred language.** On a Mac whose preferred languages include `zh-Hant-TW`, ICU `zh-Hant-TW` and `zh-Hans` gave the same boundaries for every probe string above. Expect no visible difference for these strings; look for one only with strings whose ICU rules differ between Hans and Hant (none found yet).

## 15. Differences from the groundwork's earlier readings (verified at 7625)

The groundwork read `safari-7624.2.5.11` (Safari 26.5.2). `research/webkit-safari` was diffed against this checkout. The groundwork oracle was patched with the first four changes (`scratchpad/oracle7625/webkit_breaks.cpp`) and both builds were run on the H-probe strings.

1. **U+2028 and U+2029 are breakable spaces** in the scan (`R/BreakablePositions.h:131-132`). Groundwork: MAIN only.
2. **`kPi`/`kPf` and the local LB19a rule are shipped** (`R/BreakablePositions.h:93-94, 199, 214-220, 393-396, 475-478`). Groundwork: U+201C/U+201D were Weird and ICU decided them. Oracle outputs:
   - `中文“abc”中文` with `lang=ja`: 7624 {1, 8}, 7625 {1, 2, 7, 8}.
   - `中«abc»中`: 7624 {}, 7625 {1, 6}.
3. **Keep-all breaks after Ps/Pe/Pi/Pf/Po in 16-bit strings** (`R/BreakablePositions.h:268-271, 297-298`). This is WebKit 311090@main, which PLATFORM_BUGS.md says Safari had not shipped as of 26.5.
   - `中文，中文` keep-all: 7624 {}, 7625 {3}.
   - `abc,def(ghi中`: 7625 {4, 8}.
4. **U+2028/U+2029 are forced-break items in every white-space mode** (`L/InlineItemsBuilder.cpp:954-962`; cache path `:891-895`). Groundwork: only preserved LF. `a b`: 7624 opportunity at 2, 7625 forced break at 2.
5. **Line-start prohibitions when nothing fits** exist (`L/InlineContentBreaker.cpp:139-158, 228-232`). Groundwork: MAIN only.
6. **The white-space width test is fixed**: `to - from == 1 && content[from] == space` (`L/text/TextUtil.cpp:118`). Groundwork: SAFARI declared `from - to`.
7. **White-space item widths are computed while building items** (`L/InlineItemsBuilder.cpp:975-988`, `:900-906`). Groundwork: deferred.
8. **Bidi paragraph text replaces U+2029 with a space for 16-bit content** (`:399`). Soft U+2028 is not a paragraph start (`:563-574`; `L/InlineSoftLineBreakItem.h:40`).
9. **`InlineTextItem::split` keeps `hasTrailingSoftHyphen` on the left part** (`L/InlineTextItem.cpp:73-82`). The groundwork oracle cleared it (`oracle/webkit/webkit_breaks.cpp:955`).
10. **Line numbers moved**, so don't reuse groundwork citations:
    - `findNextBreakablePosition` is `L/text/TextUtil.cpp:398-422` (groundwork :403-427).
    - `mayBreakInBetween` is `:374-396`.
    - `handleTextContent` is `L/InlineItemsBuilder.cpp:924-1051` (groundwork :871-978).
    - `textRendererIsNeeded` is `R/updating/RenderTreeUpdater.cpp:536-595`.
11. **text-autospace initial is `no-autospace`**, and three prefs are pinned (section 12). The groundwork didn't cover these.
12. **Apple ICU 78.1 answers depend on the locale for curly quotes** (section 4.3). The groundwork's own probes (`oracle/webkit/build/probe-*.txt`) show the same tailoring. Its prose said it found no Apple quote patch in root `line.txt`; that can still be true, since the tailoring sits in locale data.
13. **The ICU library on macOS 27 26A428 is still 78.1** (`/usr/share/icu/icudt78l.dat`, 2026-09-03). Groundwork: 78.1 on macOS 26.5.2.

Unchanged since 7624 and verified:
- the pair table (0 diff lines in `BreakablePositions.cpp`);
- `classify` apart from the quote subclasses;
- the stale fast-forward state;
- `makeLocaleWithBreakKeyword`, the prior-context arithmetic and `textRendererIsNeeded` logic.

## 16. Open questions

- The ICU default locale inside Safari's WebContent process (H8).
- Whether DOM text built by JS with only Latin-1 units is always stored 8-bit. That decides the keep-all punctuation rule (H15) and the 1-unit emergency rule.
- The advance WebKit uses for CR. The source keeps the glyph advance looked up for U+000D (`G/WidthIterator.cpp:790-799`), and which font supplies it is the width spec's question.
- Bidi offsets for U+2029 in a collapsing box are not monotonic: the soft break item's offset is appended after the whole box content (`L/InlineItemsBuilder.cpp:563-586`). The resulting levels were not traced.
- Whether JSC's regex Unicode tables and `Intl.Segmenter` grapheme rules match libicucore 78.1 exactly. That matters for a Canvas-only runtime (section 13).
