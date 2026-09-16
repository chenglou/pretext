# Bidi level resolution per engine

Topic: CRITIC.md §5 item 3. This spec covers how each engine turns one block's inline content into embedding levels, in enough detail to port it:
- what text the resolver sees;
- which options each engine passes;
- how controls and separators get levels;
- how bracket pairs (UAX #9 rule N0) and trailing white space (rule L1) are handled;
- which Unicode data applies;
- where the three resolvers disagree.

Line breaking consumes levels through item splits (Blink, WebKit) and frame splits (Gecko). Visual reordering is only used here as a way to observe levels in probes.

No browser was launched. The measurements come from small local programs described in §7.

## 0. Sources and notation

| Prefix | Path | Version |
|---|---|---|
| `C153/` | `~/github/browser-engines/chromium-153.0.8010.48/third_party/blink/renderer/` | Chrome 153.0.8010.48 |
| `ICU/` | `~/github/browser-engines/chromium-icu-8cc91d9b/source/common/` | Chromium's ICU DEPS copy: `unicode/uvernum.h:135` "78.2", `unicode/uchar.h:64` Unicode "17.0" |
| `W/` | `~/github/browser-engines/webkit-7625.1.29.11.27/Source/WebCore/` | WebKit 7625.1.29.11.27 |
| `WL/` | `W/layout/formattingContexts/inline/` | same |
| `F/` | `~/github/browser-engines/firefox-156.0/` | FIREFOX_156_0_RELEASE |
| `UB/` | `F/third_party/rust/unicode-bidi/src/` | unicode-bidi 0.3.15, git rev `ca612daf` (`F/Cargo.lock:8441-8446`). Added to the sparse checkout in this session, together with `F/intl/bidi` |
| `GW/` | `~/github/browser-engines/pretext-emulation-20260915/` | groundwork |
| `AICU/` | `github.com/apple-oss-distributions/ICU`, branch `main`, `icu/icu4c/source/common/` (raw fetch) | Apple ICU 76.1 (`uvernum.h:135`) |

Blink's `html.css` is not in the sparse checkout. It was read from gitiles at tag 153.0.8010.48.

Tags: **[S]** read at the pinned source; **[M]** measured by a local program in this session; **[I]** inference.

## 1. Terms

- **Level**: a small integer per UTF-16 code unit. Even means left-to-right, odd means right-to-left. The paragraph level is 0 or 1.
- **Level run**: a maximal stretch of code units with the same level. Engines split items or frames at level-run edges.
- **Paragraph text**: the string an engine hands to the resolver. It is not the DOM text. Engines add control characters for CSS, replace or drop some characters, and add U+FFFC for objects.
- **Removed characters**: rule X9 of UAX #9 removes BN (for example SHY U+00AD, ZWSP U+200B, ZWJ U+200D, WJ U+2060) and the embedding controls LRE, RLE, LRO, RLO, PDF. The algorithm gives them no level; the conformance files mark them `x`. Engines keep them in the string, so they must pick a level anyway.
- **N0**: bracket pairs such as `(` `)` take the direction of the strong text inside them, or of the context before them.
- **L1**: white space, isolate controls and removed characters at the end of a line, or before a TAB or paragraph separator, go back to the paragraph level.
- **Unidirectional shortcut**: ICU's rule that returns the paragraph level for every character when the text has no RTL content (§5.1).

Example [M]: in an LTR paragraph, `abc אבג 123` gets levels `0 0 0 0 1 1 1 1 2 2 2`. The level runs are `abc ` (0), `אבג ` (1) and `123` (2). Blink splits a single text item into three items at offsets 4 and 8.

Why levels change line results (from other specs and the groundwork):
- **Blink**: items are split at run ends (`C153/core/layout/inline/inline_item.cc:207-253`). Each item is shaped with its own direction. The groundwork switched rules off one at a time and counted how many measured rows then gave wrong results: the bidi item split decides 1,247 rows and RTL shaping 1,298 (`GW/results-blink-bidi.txt`).
- **WebKit**: split text items lose their precomputed width. At a split that stays inside one text box but changes level, WebKit asks the break iterator whether there is an opportunity (webkit-text §6, §7).
- **Gecko**: a text frame is split per run, so each run becomes its own text run (gecko-lines §3). Without the split, 25 suite inputs and 3,615 fuzz inputs change (`GW/results-parity-gecko.txt`).

## 2. Summary

1. Blink and WebKit run upstream ICU `ubidi` with default options. Gecko runs servo/unicode-bidi 0.3.15. [S]
2. **All three use Unicode 17 Bidi_Class data.** Gecko passes ICU4X `icu_properties` 2.1.2 compiled data to the crate (`F/intl/bidi/rust/unicode-bidi-ffi/src/lib.rs:43-45`). The crate's own Unicode 15 table (`UB/char_data/tables.rs:8`) is compiled in but not used for classes. Only the crate's bracket table is Unicode 15, and BidiBrackets.txt is unchanged from 15.0.0 to 17.0.0 [M]. This corrects CRITIC §5 item 3.
3. The engines build different paragraph text (§3):
   - Gecko turns TAB, LF, VT, CR, U+001C-U+001F, NEL and U+2029 into spaces before resolving (`F/layout/base/nsBidiPresUtils.cpp:861-875, 882`).
   - Blink and WebKit keep TAB in preserved white space, and keep C0 paragraph separators literally, so ICU applies L1 before them and splits paragraphs at them.
4. ICU and the crate disagree even on identical text (§5.3, §7):
   - side of a removed character: ICU takes the next character's level, the crate the previous one's;
   - ICU's unidirectional shortcut;
   - four bracket rules.
5. ICU 78.3 (identical `ubidi` sources to Chromium's 78.2) fails 30 of the 91,707 lines of BidiCharacterTest-17.0.0. It matches BidiTest-17.0.0 except for the shortcut. The crate port matches both files fully [M].
6. Recommendation (§10): one TypeScript UAX #9 resolver with an `icu78` profile and a `unicodeBidi` profile. It is verified in plain UAX #9 mode against both conformance files, and in each profile against fixtures generated by ICU and by the crate. The per-engine paragraph builders and line-level L1 stay outside the resolver.

## 3. Paragraph text per engine

### 3.1 Blink: text_content [S]

- One call covers the whole block (`C153/core/layout/inline/inline_node.cc:1344-1347`):
  - the text is converted to 16-bit first (`:1345`);
  - `ubidi_setPara` gets paragraph level `UBIDI_LTR`/`UBIDI_RTL` from the block's `direction`, or `UBIDI_DEFAULT_LTR` (0xFE, `ICU/unicode/ubidi.h:366`) when the block has `unicode-bidi: plaintext` (`inline_node.cc:1339-1343`; `C153/platform/text/bidi_paragraph.cc:27-37`).
- The string is text_content (blink-text §2.C):
  - collapsed text;
  - U+000A for forced breaks;
  - a TAB control item in preserved modes;
  - U+FFFC for atomic inlines and block-in-inline;
  - U+200B for `<wbr>` and generated break opportunities;
  - bidi controls for CSS.
- Floats and out-of-flow boxes have no character in text_content. SegmentBidiRuns builds a second string with U+FFFC at their offsets, only for resolution (`inline_node.cc:1361-1409`).
- CSS controls (`C153/core/layout/inline/inline_items_builder.cc`):
  - **inline box** (`EnterInline` `:1536-1568`, `Exit` `:1726-1732`):

    | `unicode-bidi` | enter | exit |
    |---|---|---|
    | embed | LRE/RLE | PDF |
    | bidi-override | LRO/RLO | PDF |
    | isolate | LRI/RLI | PDI |
    | plaintext | FSI | PDI |
    | isolate-override | FSI, then LRO/RLO | PDF, then PDI |

  - **block** (`EnterBlock` `:1484-1518`):
    - `normal`, `embed` and `isolate` insert nothing. `direction: rtl` sets `has_bidi_controls_`.
    - `bidi-override` and `isolate-override` insert LRO/RLO … PDF.
    - `plaintext` inserts nothing and sets `has_bidi_controls_`.
    - `-webkit-rtl-ordering: visual` inserts LRO/RLO.
  - Ruby columns insert LRI/RLI … PDI (`:1580-1583, 1606-1610, 1652-1654`).
- **Forced break**: exit characters of every open context, then U+000A, then the enter characters again (`AppendForcedBreak` `:1162-1199`). **Only forced breaks do this.** Other paragraph separators that stay in text_content end ICU's paragraph and every embedding with it, and nothing reopens them: U+2029, U+001C-U+001E and U+0085 in every mode, and CR in preserved modes (§5.1 P1).
- UA rules and `dir`:
  - `[dir=ltr i], [dir=rtl i], [dir=auto i], bdi, output` get `unicode-bidi: isolate`;
  - `bdo, bdo[dir]` get `isolate-override`;
  - `textarea[dir=auto i], pre[dir=auto i]` get `plaintext` (`html.css:1883-1891` at the 153 tag);
  - the `dir` attribute sets `direction`, and `dir=auto` maps through `UnicodeBidiAttributeForDirAuto` (`C153/core/html/html_element.cc:304-330, 426-451`).

### 3.2 WebKit: bidi paragraph text [S]

`buildBidiParagraph` (`WL/InlineItemsBuilder.cpp:550-635`):
- **Root context** (`:553-555`, through `handleEnterExitBidiContext` `:430-476`):
  - `embed` and `isolate` on the block add nothing (`:444-447, 453-456`);
  - `override` adds LRO/RLO;
  - **`plaintext` adds FSI even on the block** (`:459-461`);
  - `isolate-override` adds FSI plus LRO/RLO;
  - visual `rtlOrdering` adds an override (`:554-555`).
- **Paragraph separators**: hard `<br>`, block items, and soft line break items other than U+2028 (`WL/InlineSoftLineBreakItem.h:40`). WebKit unwinds every context, appends U+000A, then rewinds (`:535-548, 563-574`).
- **Text in a box whose newlines are not preserved**: the whole box content is appended once. LF and TAB become U+0020, and U+2029 too in 16-bit content (`:383-415, 577-586`). **CR, VT, FF, U+001C-U+001F and NEL stay literal** (`:394-404`), so CR and U+001C-U+001E reach ICU as paragraph separators without unwinding.
- **Text in a box whose newlines are preserved**: each item's content is appended verbatim, so TAB stays class S (`:587-589`).
- **Objects**:
  - atomic inline boxes → U+FFFC (`:596-598`);
  - out-of-flow positioned boxes → U+FFFC (`:622-626`);
  - floats, `<wbr>` and other out-of-flow items have no character (`:616-621, 627-630`).
- **Inline box start and end** with logical ordering and `unicode-bidi != normal` append the same controls as Blink (`:599-615`).
- **Paragraph level** (`:666-669`): `UBIDI_DEFAULT_LTR` for root `plaintext`, else 0 or 1. With root `plaintext`, every paragraph is wrapped in FSI … PDI, and ICU's P2 skips isolate content. **The ICU paragraph level is therefore always 0**, and the FSI resolves the direction [M]:
  - `FSI a SP א PDI` → paragraph 0, levels `0 2 2 3 0`. Blink gives `a SP א` levels `0 0 1`: the same parity and run edges, 2 higher.
  - `FSI א ב SP PDI` → levels `0 1 1 0 0`, where Blink gives `1 1 1`. L1 resets the trailing space and PDI to 0.
- UA rules (`W/html/HTMLElement.cpp:161-166, 268-277`; `W/css/html.css:1548-1550, 1554-1556`):
  - `dir=ltr|rtl` sets `direction`, plus `unicode-bidi: isolate` except on `bdi`, `bdo` and `output`;
  - `dir=auto` → `isolate`, or `plaintext` on `pre` and `textarea`;
  - `bdi` and `output` → `isolate`; `bdo` → `isolate-override`.

### 3.3 Gecko: nsBidiPresUtils buffer [S]

- **When it resolves** (`Resolve` `F/layout/base/nsBidiPresUtils.cpp:790-855`):
  - the block has an override (`:799-803`);
  - or the paragraph level is above 0 (`:318-320`);
  - or `ChildListMayRequireBidi` finds something (`:1431-1485`): a descendant style with a bidi control or override; a text frame that already has bidi data; or 2-byte text where `HasRTLChars` is true (`F/intl/unicharutil/util/nsBidiUtils.h:107-111`). `HasRTLChars` covers any RTL block, the RTL controls and unpaired high surrogates (gecko-canvas §1.8).
- **Paragraph level** (`BidiLevelFromStyle` `:2520-2532`): `DefaultLTR` (0xFE, `F/intl/components/src/BidiEmbeddingLevel.h:119`) for `plaintext`, else 1 for `rtl`, else 0.
- **What goes into the buffer** (`TraverseFrames` `:1169-1429`):
  - **text**: the raw DOM text of each text node, once per node, **uncollapsed** (`:1256-1262`);
  - **newline-significant text**: cut after each `\n`, and each piece resolves as its own paragraph (`:1263-1379`, `ResolveParagraphWithinBlock` `:1487-1491`);
  - **`<br>`**: U+2028, then the paragraph ends (`:1381-1384`);
  - **other leaf frames**: U+200B for `<wbr>` and for empty inline frames, U+FFFC for everything else; a leaf that is not inline-outside ends the paragraph (`:1385-1401`);
  - **element controls** (`GetBidiControl` `:110-129`, `GetBidiOverride` `:85-98`): pushed before an element's first frame and popped after its last (`:1236-1243, 1414-1423`). Embed → LRE/RLE; isolate → LRI/RLI; plaintext and isolate-override → FSI; bidi-override and isolate-override → LRO/RLO; vertical `text-orientation: upright` → LRO.
- **At each paragraph end**, open controls are closed (`ClearBidiControls` `:475-479`), and `ResetData` re-pushes them at the start of the next chunk (`:390-399`).
- **`ReplaceSeparators`** (`:861-875`), applied before `SetPara` (`:882`), turns U+0009, U+000A, U+000B, U+000D, U+001C-U+001F, U+0085 and U+2029 into U+0020. **FF (U+000C, class WS) stays.** No B or S character ever reaches the resolver.
- **Shortcut**: a chunk with one run, one frame, LTR direction and paragraph level 0 stores nothing (`:921-942`). Otherwise every frame gets its run's level, and frames are split where a run ends mid-frame (`:1039-1057`).
- UA rules (`F/layout/style/res/html.css:16, 106, 112, 116`):
  - any `dir` attribute → `unicode-bidi: isolate`;
  - `bdi` and `output` → `isolate`; `bdo` → `isolate-override`;
  - `textarea` and `pre` with auto direction → `plaintext`.

### 3.4 Side by side

| Input | Blink → ICU | WebKit → ICU | Gecko → crate |
|---|---|---|---|
| Run of spaces, `normal` | one U+0020 | raw spaces | raw spaces |
| TAB, `normal` | U+0020 (collapsed) | U+0020 (`:399-401`) | U+0020 |
| TAB, `pre`/`pre-wrap` | U+0009, class S | U+0009, class S | U+0020, class WS |
| LF, `normal` | collapsed or removed | U+0020 | U+0020 |
| LF, preserved | U+000A B, contexts reopened | U+000A, contexts rewound | chunk ends after the LF, which becomes U+0020 |
| `<br>` | U+000A, contexts reopened | U+000A, contexts rewound | U+2028 (WS), chunk ends |
| CR, `normal` | collapsed as a space (blink-text §2.C.9) | U+000D B (`:394-404`) | U+0020 |
| VT, U+001F | literal, class S | literal, class S | U+0020 |
| U+001C-U+001E, NEL | literal B | literal B | U+0020 |
| U+2029 | literal B | `normal`: U+0020; preserved: paragraph start | U+0020 |
| FF | literal WS; a control item in `pre` | literal WS | literal WS |
| atomic inline | U+FFFC | U+FFFC | U+FFFC (chunk ends if not inline-outside) |
| float | U+FFFC, resolution only | nothing | U+FFFC placeholder [I: whether the chunk ends depends on the placeholder's display, not traced] |
| abs/fixed box | U+FFFC, resolution only | U+FFFC | U+FFFC placeholder |
| `<wbr>` | U+200B (BN) | nothing | U+200B |
| empty `<span></span>` | nothing | nothing | U+200B |
| block `plaintext` | auto level per ICU paragraph | FSI … PDI per paragraph, level auto → 0 | `DefaultLTR` per chunk |

Consequence [I, not run]: collapsing and segment-break removal can change a weak rule. `＄`, newline, `１` (fullwidth, class ET then EN) in an RTL paragraph:
- Blink removes the newline between East Asian characters, so `＄１`: ET next to EN becomes EN, and both get level 2;
- Gecko sees `＄ １`: ET becomes ON, level 1.

## 4. When resolution runs

| Engine | Resolves when | Collapses to one level when |
|---|---|---|
| Blink | `has_bidi_controls_` (RTL block, any inserted control, block `plaintext`), or text_content has a code unit ≥ U+0100 other than U+FFFC plus a code unit with `MaybeBidiRtlUtf16` (≥ U+0590, not U+200B, U+2010-U+2029, U+206A-U+D7FF, U+FF00-U+FFFF) (`inline_items_builder.cc:1744-1746`; `C153/platform/text/character.h:295-305, 324-328`) | the ICU result is not mixed and is LTR, so bidi is disabled (`inline_node.cc:1355-1359`; `bidi_paragraph.h:47-49`). An all-RTL paragraph stays enabled with every item at level 1 |
| WebKit | RTL root; a 16-bit text box containing R, AL, LRE, RLE, LRO, RLO or PDF (`WL/text/TextUtil.cpp:486-515`; `W/rendering/RenderText.cpp:508-518`); an in-flow inline box that is RTL or has `unicode-bidi != normal` (`WL/InlineItemsBuilder.cpp:127-130, 231-240`) | empty paragraph text (`:645-650`); root `plaintext` with no reordering content whose first strong character is LTR (`:651-655`). Non-mixed ICU results give every item the root level (§5.1) |
| Gecko | §3.3 | the one-run shortcut (`nsBidiPresUtils.cpp:921-942`). The crate's own pure-LTR shortcut needs level 0 and no R, AL, AN, LRE, RLE, LRO, RLO, LRI, RLI or FSI (`UB/lib.rs:1096-1098`, flags from `:304-452`) |

Trigger differences:
- Arabic-Indic digits (class AN) trigger Blink and Gecko, **not** WebKit (`TextUtil.cpp:486-515` accepts only R, AL and the five embedding controls).
- Isolate controls typed into text trigger Blink (`MaybeBidiRtlUtf16` is true for U+2066-U+2069). WebKit ignores them. Gecko's `HasRTLChars` counts only the RTL controls (gecko-canvas §1.8).
- LRE and LRO typed into text trigger resolution in Blink and WebKit, not Gecko. ICU then returns one level unless the paragraph has RTL content (§5.1).

## 5. The resolvers

### 5.1 ICU `ubidi` (Blink: ICU 78.2; WebKit: libicucore 78.1)

**Call and options [S].**
- Blink: `ubidi_open`, then `ubidi_setPara(text, length, paraLevel, nullptr)` (`bidi_paragraph.cc:23-37`).
- WebKit: the same call (`WL/InlineItemsBuilder.cpp:660-680`).
- Neither calls `ubidi_setReorderingMode`, `ubidi_setReorderingOptions`, `ubidi_orderParagraphsLTR` or `ubidi_setClassCallback`. A grep over `C153/core/layout`, `C153/platform/text`, `W/layout`, `W/rendering` and `W/platform/text` finds nothing.
- So the mode is `UBIDI_REORDER_DEFAULT`, there are no options, and classes come from ICU data.

**P1, paragraphs [S].**
- In `getDirProps` (`ICU/ubidi.cpp:568-595`), each character of class B ends a paragraph, and the B belongs to the paragraph it ends. CR directly followed by LF does not end one (`:569-570`).
- With an explicit level, every paragraph gets it (`:589`). With `UBIDI_DEFAULT_LTR`, each paragraph looks for its own first strong character (`:584-587`).
- B resets the explicit stack (`resolveExplicitLevels` `:1284-1297`).

**P2 and P3 [S].**
- The paragraph level comes from the first L, R or AL outside any isolate. Strong characters only set the level in state `SEEKING_STRONG_FOR_PARA` (`:506-538`); isolate initiators push the state and PDI restores it (`:539-567`).
- No strong character gives level 0 (`:471-473`).
- An FSI starts as LRI and becomes RLI when the first strong character before its PDI is R or AL (`:527-531, 545-547`).

**Explicit rules and control levels [S].**
- The maximum level is 125. Overflow counters follow UAX #9 (`:1158-1160, 1184-1199, 1236-1253`).
- During X processing:
  - LRE, RLE, LRO, RLO, PDF and BN take the previous level (`:1177, 1204, 1301`);
  - LRI and RLI take the enclosing level (`:1222`);
  - PDI takes the level after the pop (`:1282`);
  - an unmatched PDI or an overflowing isolate becomes class WS (`:1251, 1265, 1278`);
  - a supplementary character's lead surrogate gets class BN (`:500-503`).
- Implicit rules run as state tables over level runs (`impTabL_DEFAULT`/`impTabR_DEFAULT`, `:1586-1615`). An isolating run sequence resumes after its isolate through saved state (`:2166-2181, 2266-2275`).

**N0, bracket pairs [S].** Brackets are processed during X processing (`bracketProcessChar`, called at `:1317`):
- **Candidates**: a character whose current class is ON (`:883`). The pair comes from `u_getBidiPairedBracket` plus bracket type Open (`:920-925`). U+2329/U+232A and U+3008/U+3009 match each other (`:926-935`).
- **Level changes**: pending openings are dropped when the embedding level changes, except right after an isolate (`bracketProcessBoundary` `:704-718`; called at `:1224-1226, 1256-1259, 1306-1309`).
- **No 63-entry limit**: the openings array grows (`bracketAddOpening` `:746-768`). UAX #9 BD16 stops pairing after 63 openings.
- **Overrides**: under LRO/RLO a matched pair drops its override flag and keeps the N0 result (`:902-914`). In UAX #9, overridden brackets are strong and never pair.
- **NSM after a bracket**: after a matched closing bracket, `lastBase` is set to ON (`:898`), and a following NSM after ON is set to ON (`:982-989`). UAX #9 N0 gives that NSM the bracket's new class.
- **Context before an opening bracket**: `isoRuns[].contextDir` tracks the nearest strong character, digit or resolved bracket, and is saved across isolates (`:722-743, 899-900, 950-975`).

**L1 inside `setPara`, and removed characters [S].** `adjustWSLevels` (`:2288-2325`) runs only for mixed text (`:2812`):
- It walks backwards. Any run of WS, B, S, BN, explicit controls or isolate controls (`MASK_WS`, `ICU/ubidiimp.h:102`) at the end of the text or just before a B or S gets the paragraph level, and so does the B or S itself (`:2298-2307, 2318-2320`).
- **Elsewhere, BN and LRE/RLE/LRO/RLO/PDF take the level of the next character** (`:2311-2314`).
- Line-end L1 is not part of `setPara`; see §6.

**Unidirectional shortcut [S].**
- `directionFromFlags` (`:1007-1018`) calls the text LTR when there is no R, AL, RLE, RLO or RLI (`MASK_RTL`, `ubidiimp.h:86`), unless AN appears together with a possible neutral (ON, CS, ES, ET, WS, B, S, BN, explicit or isolate controls; `:105`). It calls the text RTL when there is no L, EN, AN, LRE, LRO or LRI (`:85`).
- The paragraph level adds its own flag (`:631-632`).
- The check runs before X processing (`:1087-1093`) and again with recomputed flags after it (`:1324-1330`).
- For non-mixed text, implicit resolution is skipped and `trailingWSStart = 0` (`:2685-2693`). `ubidi_getLevels` and `ubidi_getLogicalRun` then return the paragraph level for every index (`ICU/ubidiln.cpp:271-295, 336-345`).
- Examples [M]:
  - `f LRE i PDF` at level 0 gives ICU `0 0 0 0`; UAX #9 puts `i` at 2.
  - `abc١٢` gives ICU all 0; UAX #9 puts the digits at 2.
  - `abc ١٢` is mixed, because the space counts as a neutral next to AN, and both give `0 0 0 0 2 2`.

**Runs [S].** `ubidi_getLogicalRun(start)` returns the limit and level of the run containing `start` (`ubidiln.cpp:304-346`). Blink loops over it and splits items (`inline_node.cc:1415-1435`; `inline_item.cc:207-253`). So does WebKit (`WL/InlineItemsBuilder.cpp:689-728`); its opaque items get the range level, and inline box start and end items with content get `opaqueBidiLevel` 0xFF (`:730-774`; `WL/InlineItem.h:54`).

**Apple ICU.**
- `AICU/ubidi.cpp` (ICU 76.1) differs from upstream 76.1 only in `APPLE_ICU_CHANGES` blocks that support `ubidi_setParaWithControls` (inserted controls, `dirInsert`) [M: diff].
- `ubidi_setPara` passes no inserted controls (`AICU/ubidi.cpp:2973-2983`), and `ubidiln.cpp` is identical to upstream [M].
- Upstream `ubidi.cpp` is byte-identical between 76.1 and 78.2 [M]. Chromium's `ubidi.cpp`, `ubidiln.cpp`, `ubidiimp.h`, `ubidi_props.cpp` and `ubidi_props_data.h` are byte-identical to upstream release-78.2 and release-78.3 [M]. Chromium carries no bidi patch (`chromium-icu-8cc91d9b/patches/`).
- Source for libicucore 78.1 is unpublished, so "WebKit runs upstream `ubidi` code" is [I].

### 5.2 unicode-bidi 0.3.15 (Gecko)

**Call chain [S].**
- `BidiParagraphData::SetPara` (`nsBidiPresUtils.cpp:345-350`) → `intl::Bidi::SetParagraph` under `USE_RUST_UNICODE_BIDI` (`F/intl/components/src/Bidi.cpp:22-28`) → `bidi_new` (`F/intl/bidi/rust/unicode-bidi-ffi/src/lib.rs:36-48`).
- `Level::new(0xFE)` fails (`UB/level.rs:82-88`; the maximum is 126), so the default levels become `None`, meaning auto.
- The data source is `CodePointMapData<BidiClass>` from `icu_properties` 2.1.2 (`F/Cargo.lock:3757-3773`; ffi `Cargo.toml:9-10`).
- Its `BidiDataSource` implementation only provides `bidi_class` (`F/third_party/rust/icu_properties/src/bidi.rs:121-125`). Brackets therefore use the crate default (`UB/data_source.rs:43-45` → `UB/char_data/mod.rs:48-60` over `UB/char_data/tables.rs:519`).

**Paragraphs and P2 [S].**
- `ParagraphBidiInfo::new_with_data_source` (`UB/utf16.rs:410-446`) calls `compute_initial_info` with `split_paragraphs = None` (`UB/lib.rs:304-452`), so B does not split (and Gecko removes B beforehand).
- P2 takes the first L, R or AL outside isolates (`UB/lib.rs:394-397`); P3 gives 0.

**Removed characters [S].** RLE, LRE, RLO, LRO, PDF and BN (`UB/prepare.rs:308-310`) take **the previous character's level**, or the paragraph level at index 0 (`UB/lib.rs:1264-1270`).

**N0 [S].** Implemented in `identify_bracket_pairs` (`UB/implicit.rs:504-574`):
- Candidates are brackets whose *processing* class is ON, so overridden brackets never pair, as UAX #9 says.
- The opening stack stops at 63 (`:534`).
- Canonical equivalents come from the table's third field: U+2329 is normalized to U+3008 (`tables.rs:519-535`).
- NSMs after a changed bracket follow it (`implicit.rs:401-424`).
- **Quirk**: the search for the strong type before an opening bracket (`:355-363`) uses `iter_backwards_from` (`UB/prepare.rs:257-273`). That iterator walks the current level run backwards, but earlier level runs of the same isolating run sequence first-to-last. When nothing strong sits between the start of the bracket's run and the bracket, the crate finds the **first** strong character of the nearest earlier run that has one, not the last.
- Example [M]: RTL paragraph `a א LRI x PDI ( c )`. The crate sees `a` and gives the brackets L (level 2). ICU and UAX #9 see `א` and give level 1.

**L1 [S].**
- The ffi calls `visual_runs(0..len)` (`ffi lib.rs:51-57`) → `UB/utf16.rs:522-526` → `reorder_levels` (`UB/lib.rs:1146-1204`).
- That function resets WS, isolate controls, BN and explicit controls at the paragraph end, and before a B or S, to the paragraph level. BN and explicit controls also copy the previous level (`:1175-1181`).
- These L1-adjusted levels are what `bidi_get_levels` returns (`ffi lib.rs:110-112`) and what `Bidi::GetLogicalRun` scans for level changes (`Bidi.cpp:165-186`).

**Surrogates.** An unpaired surrogate reads as U+FFFD, class ON (`UB/utf16.rs:634-660`). ICU uses the surrogate code point itself [I: its class was not checked].

### 5.3 Rule by rule

| Rule | ICU (Blink, WebKit) | unicode-bidi (Gecko) | UAX #9 |
|---|---|---|---|
| P1 within one call | split at B; CR LF counts once | no split | split |
| P2 | first strong outside isolates, per paragraph | same, one paragraph | same |
| X1-X8 | depth 125, overflow counters | depth 125 (`UB/level.rs:42-46`) | same |
| Level of BN, LRE…PDF (not trailing) | next character's | previous character's | unspecified (`x`) |
| Text with no RTL content | every level = paragraph level | full levels | full levels |
| N0 candidates | class ON before overrides apply; matched pair drops the override | processing class ON | processing class ON |
| BD16 opening limit | none | 63 | 63 |
| N0 context before the opening bracket | nearest strong | earlier runs walked first-to-last | nearest strong |
| NSM after a changed closing bracket | stays neutral | follows the bracket | follows the bracket |
| Isolate initiator and PDI after closed embeddings under an override | one level too high in 4 conformance lines (cause not traced) | as UAX #9 | — |
| L1 within the resolver | text end, before B and S | paragraph end, before B and S | line end, before B and S |

## 6. Line-end L1, after line breaking [S]

- **Blink**: `SplitTrailingBidiPreservedSpace` (`C153/core/layout/inline/line_breaker.cc:2749-2853`).
  - It runs only when bidi is enabled, the trailing white-space state is Collapsed or Preserved, and the mode is not min-content (`:2763-2780`).
  - It walks results backwards, skipping opaque items and forced breaks.
  - A result made only of spaces gets `has_only_bidi_trailing_spaces`.
  - A text result that ends in spaces is split when the item's **level** differs from the paragraph level. Spaces here are breakable spaces, or any character of class WS (`:202-204, 2811`). The text part gets `SnappedWidth()` of its shape view, and the spaces part gets the remainder, so the total stays unchanged.
  - `BidiReorder` gives those results the base level, and trailing opaque items too (`C153/core/layout/inline/logical_line_builder.cc:726-729, 737-745`). Its comment says full L1 is unsupported (`:696-699`).
- **WebKit**: `Line::resetBidiLevelForTrailingWhitespace` (`WL/InlineLine.cpp:243-287`), called once per line (`WL/InlineLineBuilder.cpp:674-676`).
  - It walks runs from the end, and stops at an atomic box, a line break, or text without trailing white space.
  - A whitespace-only run whose level **parity** differs from the root gets the root level.
  - A mixed run with different parity has its trailing white space detached into a run at the root level (`:273-285`).
  - **Difference from Blink**: a level-2 trailing space in an LTR root stays at 2 in WebKit and goes to 0 in Blink.
- **Gecko**: no line-end handling was found in `nsBidiPresUtils.cpp`. `nsLineLayout` reorders frames with the levels stored at resolution (`F/layout/generic/nsLineLayout.cpp:3646-3652`). Only paragraph-end L1 applies [S for that file; other callers not traced].

## 7. Measurements [M]

### 7.1 Setup (reproducible; the scratchpad is not durable)

- **ICU oracle**: a C program linked against Homebrew `icu4c` 78.3. As §5.1 shows, its `ubidi` sources and bidi property data are byte-identical to Chromium's 78.2.
  - For each case: `ubidi_setPara(bidi, units, len, para == 2 ? UBIDI_DEFAULT_LTR : para, NULL, &err)`, then `ubidi_getLevels`, `ubidi_getDirection` (to tell mixed text) and `ubidi_getParaLevel`.
  - The level of a code point is the level of its last code unit.
- **Crate port**: bun importing `GW/runtime-parity/gecko/src/bidi-levels.ts`, with auto paragraph level computed as in `UB/lib.rs:394-397`.
- **Crate itself**: a copy of `GW/oracle/gecko/validation/vendor/unicode-bidi-ca612daf…`. Its `src/` is identical to `F/third_party/rust/unicode-bidi/src` (`diff -r`). The optional `flame`, `flamer` and `serde` dependencies were removed from `Cargo.toml` so that `cargo test --offline --test conformance_tests` builds.
- **BidiTest representative code points**, one per class, checked against Unicode 17 classes: L U+02B8, R U+0590, EN U+06F9, ES U+208B, ET U+20CF, AN U+0605, CS U+2044, B U+000A, S U+001F, WS U+200A, ON U+03F6, LRE U+202A, LRO U+202D, AL U+060B, RLE U+202B, RLO U+202E, PDF U+202C, NSM U+0300, BN U+2060, FSI U+2068, LRI U+2066, RLI U+2067, PDI U+2069. This is the crate's own list (`tests/conformance_tests.rs`, `gen_char_from_bidi_class`).
- **Counting**:
  - a BidiTest line counts once per set direction bit (1 auto, 2 LTR, 4 RTL);
  - levels marked `x` are ignored;
  - BidiCharacterTest also compares the resolved paragraph level.

### 7.2 Conformance

| Implementation | BidiTest-17.0.0 (770,241 runs) | BidiCharacterTest-17.0.0 (91,707 lines) | 15.0.0 files |
|---|---|---|---|
| ICU 78.3 `ubidi` | 664,456 match; 105,785 differ only by the unidirectional shortcut; 0 other | 91,676 match; 1 shortcut; **30 fail** | same counts |
| `bidi-levels.ts` (crate port, icu_properties 2.1.2 classes) | 770,241 match | 91,707 match | same |
| unicode-bidi `ca612daf` own tests (15.0.0 files, crate's Unicode 15 classes) | pass | pass | — |

ICU's own harness also accepts the shortcut. It skips a level mismatch when the expected levels and ICU's all have one parity (`icu4c/source/test/intltest/bidiconf.cpp:581-600` at release-78.2).

### 7.3 ICU's 30 BidiCharacterTest-17.0.0 failures

| Category | Lines | Example | UAX #9 | ICU |
|---|---:|---|---|---|
| Brackets paired across LRO/RLO | 16 | `LRE R ON R PDF LRO ON`, auto (`202A 05D0 0028 05D1 202C 202D 0029`) | `)` 2 | `)` 3 |
| NSM after a closing bracket | 9 | `L ON L ON NSM`, RTL (`a(b)` + mark) | NSM 2 | NSM 1 |
| More than 63 openings | 1 | `L`, 64 openings, `L`, 64 closings, RTL | closings 1 | closings 2 |
| Isolate initiator and PDI after closed embeddings under an override | 4 | `RLO L LRE L PDF LRI L PDI LRE L PDF L PDF`, auto | LRI 1, PDI 1 | 2, 2 |

### 7.4 Differential fuzz, ICU against the crate port

- 300,000 seeded strings (mulberry32, seed 20260916), 1-10 characters each, paragraph level 0 or 1.
- The 31 characters: `a b א ב ب 1 ٣ + $ , SP ! ( ) [ ]`, U+0300, U+00AD, U+200B, U+202A-U+202E, U+2066-U+2069, LRM, RLM, ALM.
- No B or S, which is all Gecko's resolver can see.

| Outcome | Strings |
|---|---:|
| Identical levels | 169,339 |
| Differ only at removed characters | 105,407 |
| Differ because ICU saw no RTL content | 25,252 |
| Other | 2 (both NSM after a closing bracket) |

7 of the 31 characters are removed characters, so real text has far fewer strings in the second row. The crate's N0 walk quirk and the BD16 limit did not occur at these lengths; D1 and D7 below trigger them directly.

### 7.5 Directed cases

| # | Text (paragraph level) | ICU levels | Crate levels | What differs |
|---|---|---|---|---|
| D1 | `a א LRI x PDI ( c )` (1) | `2 1 1 2 1 1 2 1` | `2 1 1 2 1 2 2 2` | N0 context walk |
| D2 | `RLI א ב U+001D ג ד PDI` (0), as Blink and WebKit build it | `0 1 1 0 1 1 0` | Gecko sees U+0020 instead: `0 1 1 1 1 1 0`; ICU on that text agrees | ICU paragraph split |
| D3 | `ש ל ו ם SHY a b c` (0) | `1 1 1 1 0 0 0 0` | `1 1 1 1 1 0 0 0` | removed-character side |
| D4 | `f LRE i PDF` (0) | `0 0 0 0` | `0 0 2 0` | shortcut |
| D5 | `a b c ٣ ٤` (0) | `0 0 0 0 0` | `0 0 0 2 2` | shortcut (AN without a neutral) |
| D6 | `a b c SP ٣ ٤` (0) | `0 0 0 0 2 2` | same | AN with a neutral is mixed |
| D7 | `a`, 70 × `(`, `b )` (1) | all 2 | `)` 1, the rest 2 | BD16 limit |
| D8 | `a ( b )` U+0301 (1) | `2 2 2 2 1` | `2 2 2 2 2` | NSM after a bracket |
| D9 | `LRE א ( ב PDF LRO ) PDF` (0) | `3 3 3 3 3 3 3 0` | `0 3 3 3 3 3 2 0` | bracket under override, removed-character side |
| D10 | `א TAB ב` (0) | `1 0 1` | Gecko sees `א SP ב`: `1 1 1` | L1 before S, and ReplaceSeparators |
| D11 | `1 U+FFFC + 2` (1) | `2 1 1 2` | Gecko chunks `1 U+FFFC` and `+ 2`: `2 1`, `1 2` | WebKit sees `1 + 2`: `2 2 2` |
| D12 | `RLI a b U+2029 c d PDI` (0) | `0 2 2 0 0 0 0` | — | `cd` leaves the isolate at B |
| D13 | `א U+1D6C1 ב` (0) | `1 1 1` | `1 1 1` | U+1D6C1 is ON from Unicode 16 |

## 8. Unicode data versions

### 8.1 Per engine

- **Blink**: ICU 78.2 with Unicode 17.0 (`ICU/unicode/uchar.h:64`). `ICU/ubidi_props_data.h` is identical to upstream 78.3 [M].
- **WebKit**: libicucore 78.1 (per CRITIC §1.1 and webkit-canvas). ICU 78 carries Unicode 17 [I]; see probe 10.
- **Gecko**:
  - Bidi_Class comes from `icu_properties_data` 2.1.2. Its values include the Unicode 16 and 17 changes: U+1FA89 → ON, U+1CCF0 → EN, U+1171E → L [M, through the groundwork's generated tables, which `GW/runtime-parity/gecko/tools/check-props.ts` compares with `icu_properties` on every non-surrogate code point].
  - Brackets come from the crate's Unicode 15 table (`UB/char_data/tables.rs:519`).
  - The crate's hardcoded Unicode 15 class table (`tables.rs:8`) is not used for classes.
- **Brackets**: BidiBrackets.txt data lines are identical between 15.0.0 and 17.0.0 (128 lines, empty diff) [M]. No engine difference comes from bracket data today.

### 8.2 Bidi_Class changes from 15.0.0 to 17.0.0 [M]

- The comparison uses DerivedBidiClass.txt, including its `@missing` defaults for unassigned code points: R in Hebrew-range blocks, AL in Arabic-range blocks, ET for U+20A0-U+20CF, L elsewhere.
- 921 code points differ: 779 from 15.0.0 to 16.0.0 and 142 from 16.0.0 to 17.0.0.
- **Only 6 are characters that already existed in 15.0.0**; the rest are newly assigned characters whose class differs from the unassigned default.

| Version | Change | Code points |
|---|---|---|
| 16.0 | existing, NSM → L | U+1171E AHOM CONSONANT SIGN MEDIAL RA |
| 16.0 | existing, L → ON | U+1D6C1, U+1D6FB, U+1D735, U+1D76F, U+1D7A9 (the five mathematical bold/italic NABLA) |
| 16.0 | new, R → AN | U+10D40..U+10D49 GARAY DIGIT ZERO..NINE |
| 16.0 | new, R → NSM / ON | U+10D69..U+10D6D / U+10D6E (Garay) |
| 16.0 | new, AL → NSM | U+0897 ARABIC PEPET, U+10EFC |
| 16.0 | new, L → EN | U+1CCF0..U+1CCF9 OUTLINED DIGIT ZERO..NINE |
| 16.0 | new, L → NSM (29) | U+113BB..U+113C0, U+113CE, U+113D0, U+113D2, U+113E1..U+113E2 (Tulu-Tigalari); U+11F5A; U+1611E..U+16129, U+1612D..U+1612F (Gurung Khema); U+1E5EE..U+1E5EF |
| 16.0 | new, L → ON (716) | U+2427..U+2429, U+2FFC..U+2FFF, U+31E4..U+31E5, U+31EF, U+1CC00..U+1CCD5, U+1CD00..U+1CEB3, U+1F8B2..U+1F8BB, U+1F8C0..U+1F8C1, U+1FA89, U+1FA8F, U+1FABE, U+1FAC6, U+1FADC, U+1FADF, U+1FAE9, U+1FBCB..U+1FBEF |
| 17.0 | new, L → NSM (37) | U+1ACF..U+1ADD, U+1AE0..U+1AEB, U+11B60, U+11B62..U+11B64, U+11B66, U+1E6E3, U+1E6E6, U+1E6EE..U+1E6EF, U+1E6F5 |
| 17.0 | new, AL → ON (34) | U+FBC3..U+FBD2, U+FD90..U+FD91, U+FDC8..U+FDCE, U+10ED0..U+10ED8 |
| 17.0 | new, AL → NSM | U+10EFA..U+10EFB |
| 17.0 | new, L → ON (69) | U+2B96, U+1CCFA..U+1CCFC, U+1CEBA..U+1CED0, U+1CEE0..U+1CEF0, U+1F6D8, U+1F777..U+1F77A, U+1F8D0..U+1F8D8, U+1FA54..U+1FA57, U+1FA8A, U+1FA8E, U+1FAC8, U+1FACD, U+1FAEA, U+1FAEF, U+1FBFA |

What these change:
- `א𝛁ב` in an LTR paragraph (U+1D6C1 in the middle) is one RTL run at level 1 with Unicode 16+ data [M]. With Unicode 15 data the nabla is L, giving `1 0 1` [I].
- An Arabic ligature such as U+FBC3 becomes a neutral instead of AL.
- Garay digits become AN.

A port must ship Unicode 17 classes with the `@missing` defaults. The crate's Unicode 15 table is not what Firefox uses.

## 9. What `GW/runtime-parity/gecko/src/bidi-levels.ts` covers

- **What it ports**: the levels that `ParagraphBidiInfo::new_with_data_source` plus `visual_runs(0..len)` return, for one paragraph at an explicit level 0 or 1 (`bidi-levels.ts:1-11, 61`). 467 lines, 412 code lines (`GW/results-parity-gecko.txt`).
- **Pieces**:
  - initial classes, FSI resolution and the pure-LTR flag (`:67-93`);
  - X1-X8 with depth 125 and overflow counters (`:96-170`);
  - isolating run sequences with sos/eos (`:172-223`);
  - W1-W7 (`:276-350`);
  - N0 with the crate's bracket table (`:352-441`), including the first-to-last walk (`:50-58`);
  - N1-N2 (`:443-466`); I1-I2 (`:230-236`);
  - removed characters at the previous level (`:237-238`);
  - L1 over the whole paragraph (`:245-273`);
  - surrogate decoding as `UB/utf16.rs` does it (`:20-32`).
- **Data**:
  - Bidi_Class from `icu_properties` 2.1.2 through generated ranges (`gecko-props.ts`, `tools/gen-props.ts`; 763 ranges). RegExp `\p{…}` offers no Bidi_Class, which is why a table is needed (`tools/gen-props.ts:1-3`).
  - The bracket table is copied from `tables.rs:519`.
- **Validation**:
  - Groundwork: through `gecko-breaks.ts`, it equals the bidi-aware Gecko oracle on 10,915 suite inputs and 20,000 fuzz inputs (`GW/results-parity-gecko.txt`).
  - This session [M]: it matches every line of BidiTest and BidiCharacterTest at 15.0.0 and 17.0.0. The vendored crate source equals Firefox 156's.
  - The file header says "Firefox 155"; 156 pins the same git rev.
- **Not covered**:
  - auto paragraph level (`plaintext`);
  - paragraph splitting: the caller splits `pre-wrap` text at LF only (`GW/runtime-parity/gecko/src/gecko-breaks.ts:292-301`);
  - the rest of Gecko's paragraph builder: element controls, `<br>`, U+FFFC and U+200B leaves, and text across several nodes. The caller passes one text node's raw text and the block direction (`gecko-breaks.ts:285-305`);
  - visual reordering;
  - every ICU behaviour in §5.3.

## 10. Recommended TypeScript strategy

### 10.1 One resolver, two profiles

Write one UAX #9 resolver over UTF-16 units: `resolveLevels(units, paraLevel | 'auto', profile) → Uint8Array`. Follow the rule order of UAX #9 (BD16, X1-X10, W1-W7, N0-N2, I1-I2, L1), as the crate does. Do not port ICU's state tables: ICU matches BidiTest wherever its text is mixed (0 other mismatches, §7.2), so the rule form is enough.

Start from `bidi-levels.ts`, which already passes both conformance files. Add these switches:

| Switch | `icu78` (Blink, WebKit) | `unicodeBidi` (Gecko) | UAX #9 test mode |
|---|---|---|---|
| `splitParagraphsAtB` (CR LF once; reset the stack; P2 per paragraph) | yes | no | yes |
| `unidirectionalShortcut` (§5.1 flags, before and after X processing) | yes | no | no |
| `removedCharLevel` | `next` | `previous` | any |
| `bracketCandidate` | original class ON; matched pair drops the override | processing class ON | processing class ON |
| `bracketStackLimit` | none | 63 | 63 |
| `n0ContextWalk` | nearest | earlier runs first-to-last | nearest |
| `nsmAfterClosingBracket` | stays neutral | follows the bracket | follows the bracket |
| `unpairedSurrogate` | code point class [I] | U+FFFD (ON) | — |

These stay outside the resolver, because each engine does them differently:
- building paragraph text per engine (§3);
- the enablement rules (§4);
- run extraction and item or frame splitting;
- line-end L1 (§6).

ICU's isolate-after-embeddings deviation (§7.3, 4 lines) has no switch until its cause is traced. Keep those lines as a known-mismatch fixture.

Why one resolver:
- the engines share every rule except the eight switches;
- the groundwork port is already 412 code lines;
- the maintainer's rule is to keep the codebase small and prove removals with ablations (memory: "Keep the codebase tiny").

### 10.2 Data

- Bidi_Class: a generated range table from `https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedBidiClass.txt`, with its `@missing` defaults. Alternatively, the `icu_properties` 2.1.2 dump the groundwork used; they should agree [I].
- Brackets: `https://www.unicode.org/Public/17.0.0/ucd/BidiBrackets.txt`, plus the U+2329/U+232A ≡ U+3008/U+3009 equivalence.
- Levels per code unit, like all three engines.

### 10.3 Verification

1. **UAX #9 mode must match 100%** of:
   - `https://www.unicode.org/Public/17.0.0/ucd/BidiTest.txt` (7,959,988 bytes; 770,241 runs);
   - `https://www.unicode.org/Public/17.0.0/ucd/BidiCharacterTest.txt` (6,880,771 bytes; 91,707 lines);
   - and the 15.0.0 copies at `https://www.unicode.org/Public/15.0.0/ucd/` (also vendored in the groundwork crate's `tests/data/`).

   Fetch the files in a test script instead of shipping them. File format and counting are in §7.1.
2. **`icu78` profile**: expected results are the UAX #9 results except for:
   - (a) lines where ICU's text is not mixed (all levels equal the paragraph level);
   - (b) the 30 lines of §7.3.

   Also generate a fixture with ICU 78.x `ubidi` (Homebrew `icu4c` 78.3 has byte-identical sources to Chromium's 78.2), holding **all** levels including `x` positions. Run it over both files' inputs and a seeded fuzz set like §7.4.
3. **`unicodeBidi` profile**: expected results are the UAX #9 results on both files. Add the crate's levels at `x` positions, plus D1 and D7, generated from the crate at `ca612daf` with `icu_properties` 2.1.2 data, or from `bidi-levels.ts`.
4. **Differential gate**: each profile against its own oracle on the §7.4 fuzz set, 0 differences.
5. **Browser probes (§13)** for the paragraph builders, which no conformance file tests.

### 10.4 Engine differences a port must model, most frequent first

1. **Paragraph text** (§3): S and B characters (TAB in preserved text; C0 separators and CR in WebKit collapse modes), U+FFFC or nothing for floats, U+200B for Gecko's `<wbr>` and empty spans, Gecko chunk ends at `<br>` and blocks, and WebKit's FSI wrapper for root `plaintext`.
2. **Side of removed characters**: SHY, ZWSP (including Blink's `<wbr>` and generated opportunities), ZWJ/ZWNJ, WJ, U+FEFF, and the LRE/RLE/LRO/RLO/PDF that CSS inserts. At a level edge they end up in the next item (Blink, WebKit) or the previous frame (Gecko).
3. **ICU unidirectional shortcut**: an embedded LTR span in an LTR block, Arabic-Indic digits right after letters with no neutral, and LRE/LRO in plain text. Gecko splits frames there; Blink disables bidi; WebKit keeps one level.
4. **Enablement triggers** (§4), including WebKit ignoring AN and isolates.
5. **Line-end L1** (§6): Blink compares levels, WebKit compares parity, and Gecko applies none found.
6. **Rare resolver deviations** (§7.3, D1, D7): model with the switches and fixtures.
7. **Unicode data**: all three engines use Unicode 17 today, so there is nothing to switch per engine. Update the table when an engine rolls ICU or ICU4X.

## 11. Corrections to CRITIC and other specs

- **CRITIC §1.1 row 7, §1.3 "direction", §5 item 3**: "Rust unicode-bidi 0.3.15 with Unicode 15.0 tables". Firefox's Bidi_Class data is ICU4X 2.1.2, which is Unicode 17 (`unicode-bidi-ffi/src/lib.rs:43-45`; `icu_properties/src/bidi.rs:121-125`). Only the bracket table is the crate's Unicode 15 data, and it did not change up to 17.0.
- **blink-text §2.D**: "If the result is unidirectional LTR, bidi is disabled" is correct. Add that ICU returns the paragraph level for any non-mixed text, and that Blink's inserted U+200B and bidi controls take the next character's level.
- **webkit-text §6**: the trigger list is correct. Add that AN and isolate controls don't trigger it, that root `plaintext` appends FSI, and that CR and U+001C-U+001E reach ICU literally in collapse modes.
- **`GW/runtime-parity/gecko/src/bidi-levels.ts` header**: "Firefox 155" is also accurate for 156 (same git rev).

## 12. Open questions

- The cause of ICU's 4 isolate-after-embeddings mismatches (§7.3). Is it reachable from CSS? For example `<bdo dir=rtl>` containing an embed span followed by a `dir` span.
- libicucore 78.1's `ubidi` and its Unicode data are [I] (probe 10).
- Does a Gecko float placeholder end the paragraph? Its `IsInlineOutside` was not traced; probe 7 gives the same order either way.
- Gecko line-end L1: none in `nsBidiPresUtils.cpp`, other callers not traced. A `pre-wrap` RTL paragraph with preserved spaces at a soft break would show it.
- WebKit's U+2029 soft line break offsets in collapsible boxes are not monotonic (webkit-text open item). Their levels were not traced.
- Canvas paths (blink-canvas §1.3, gecko-canvas §1.8) resolve bidi on the measured string alone. They were not re-read here.

## 13. Browser probes

Common setup:
- `<html lang="en">`, and each container sets an explicit `lang`.
- `x(node, i)` = `left` of `getBoundingClientRect()` of a `Range` over UTF-16 index `[i, i+1)` of text node `node`.
- Check that every measured rect has the same `top`; if not, the probe is invalid.
- Text containing controls is set through `textContent`.

1. **TAB is S in Blink and WebKit, a space in Gecko.**
   - Setup: `<div id=p lang="he" dir="ltr" style="font:32px Arial;white-space:pre;width:800px">`, `p.textContent = "א\tב"`, `T = p.firstChild`.
   - Chrome, Safari: `x(T,0) < x(T,2)`.
   - Firefox: `x(T,2) < x(T,0)`.
   - Control: the same with `white-space:normal` gives `x(T,2) < x(T,0)` in all three.
2. **U+001D ends ICU's paragraph inside an isolate.**
   - Setup: `<div lang="he" dir="ltr" style="font:32px Arial;width:800px"><span id=s dir="rtl"></span></div>`, `s.textContent = "אבגד"`.
   - Chrome, Safari: `x(T,0) < x(T,3)`.
   - Firefox: `x(T,3) < x(T,0)`.
3. **Crate N0 context walk.**
   - Setup: `<div lang="en" dir="rtl" style="font:32px Arial;width:800px">a&#x5D0;<span dir="ltr">x</span>(c)</div>`, `T` = the text node `(c)`.
   - Chrome, Safari: `x(T,0) > x(T,1)`.
   - Firefox: `x(T,0) < x(T,1)`.
4. **BD16 limit.**
   - Setup: `<div id=p lang="en" dir="rtl" style="font:16px Arial;white-space:nowrap">`, `p.textContent = "a" + "(".repeat(70) + "b)"`.
   - Chrome, Safari: `x(T,72) > x(T,71)`.
   - Firefox: `x(T,72) < x(T,0)`.
5. **NSM after a closing bracket.**
   - Setup: `dir="rtl"`, `font:32px Arial;width:800px`, `p.textContent = "a(b)́"`.
   - Chrome, Safari: `x(T,4) < x(T,0)`; the mark becomes a level-1 run at the left end.
   - Firefox: `x(T,4) > x(T,0)`.
6. **Brackets under `bidi-override`.**
   - Setup: `<div lang="he" dir="ltr" style="font:32px Arial;width:800px"><span style="unicode-bidi:embed;direction:ltr">א(ב</span><span style="unicode-bidi:bidi-override;direction:ltr">)</span></div>`, `T1` = `א(ב`, `T2` = `)`.
   - Chrome, Safari: `x(T2,0) < x(T1,2)`.
   - Firefox: `x(T2,0) > x(T1,0)`.
7. **A float is U+FFFC in Blink and Gecko, nothing in WebKit.**
   - Setup: `<div lang="en" dir="rtl" style="font:32px Arial;width:800px">1<span style="float:left;width:10px;height:10px"></span>+2</div>`, `T1` = `1`, `T2` = `+2`.
   - Chrome, Firefox: `x(T2,1) < x(T1,0)`.
   - Safari: `x(T1,0) < x(T2,1)`.
8. **Which side a SHY lands on.**
   - Setup: `<div lang="en" dir="ltr" style="font:32px Arial;width:800px">שלום&shy;abc</div>`.
   - Chrome, Safari: `x(T,0) <= x(T,4) <= x(T,5)`; the SHY sits between the Hebrew word and `abc`.
   - Firefox: `x(T,4) <= x(T,3)`; the SHY sits at the Hebrew word's left edge.
   - Inconclusive if Firefox returns no rect for the skipped SHY.
9. **`plaintext` resolves each paragraph at `<br>` in all three.**
   - Setup: `<div lang="he" style="unicode-bidi:plaintext;font:32px Arial;width:800px">abc<br>אבג def</div>`, `T2` = `אבג def`.
   - All three: `x(T2,4) < x(T2,0)`.
10. **Unicode 16 and 17 classes.**
    - Setup: `dir="ltr"`, `font:32px Arial;width:800px`, `p.textContent = "א𝛁ב"` (U+1D6C1, L up to Unicode 15, ON from 16).
    - All three: `x(T,3) < x(T,0)`. Unicode 15 data would give `x(T,0) < x(T,3)`.
    - Variant: `"א🪊ב"` (U+1FA8A TROMBONE, unassigned in 16, ON in 17). All three: `x(T,3) < x(T,0)`; data older than 17 gives the reverse.
11. **CR reaches ICU as B in WebKit collapse modes.**
    - Setup: `<div lang="he" dir="ltr" style="font:32px Arial;width:800px"><span id=s dir="rtl"></span></div>`, `s.textContent = "אב\rגד"`.
    - Safari: `x(T,0) < x(T,3)`.
    - Chrome (CR collapses to a space), Firefox (CR becomes a space): `x(T,3) < x(T,0)`.
