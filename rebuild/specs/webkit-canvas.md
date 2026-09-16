# WebKit Canvas `measureText` and Safari's break data

Safari 27.0 on macOS 27.0 (26A428). WebKit tag `WebKit-7625.1.29.11.27` (commit `2756e8be58521b10c8e8bff8da1f13d97f2eae27`); the installed `/System/Library/Frameworks/WebKit.framework` reports `CFBundleVersion` 22625.1.29.11.27 and Safari.app reports 27.0 (read with PlistBuddy). System ICU: `/usr/lib/libicucore.A.dylib`, `u_getVersion` = **78.1**, Unicode 17.0, CLDR 48.0, data file `/usr/share/icu/icudt78l.dat`.

Source reading plus offline C programs against the system libicucore. No browser was launched.

## 0. Conventions and terms

Path prefixes, all inside `~/github/browser-engines/webkit-7625.1.29.11.27`:

| Prefix | Path |
| --- | --- |
| `C/` | `Source/WebCore/html/canvas/` |
| `G/` | `Source/WebCore/platform/graphics/` |
| `L/` | `Source/WebCore/layout/formattingContexts/inline/` |
| `R/` | `Source/WebCore/rendering/` |
| `T/` | `Source/WTF/wtf/text/` |
| `S/` | `Source/WebCore/style/` |

These files are outside the sparse checkout and were read at the same tag with `git show HEAD:<path>`: `Source/WebCore/html/TextMetrics.h`, `Source/WebCore/html/HTMLElement.cpp`, `Source/WebCore/dom/StyledElement.cpp`, `Source/WebCore/css/CSSProperties.json`, `Source/WebCore/css/parser/CSSPropertyParserConsumer+Font.h`, `Source/WTF/wtf/Language.cpp`, `Source/WTF/wtf/cocoa/LanguageCocoa.mm`, `Source/WTF/wtf/cf/LanguageCF.cpp`, `Source/WTF/wtf/PlatformUse.h`, `Source/WTF/wtf/PlatformHave.h` and `Source/WTF/wtf/unicode/icu/ICUHelpers.h`.

Apple does not publish the ICU source for macOS 27. Apple-specific ICU behaviour is read from the latest published Apple ICU, `ICU-76142.5.1.200` (`github.com/apple-oss-distributions/ICU`, files `icu/icu4c/source/common/{brkiter,rbbi,ubrk}.cpp`, cited as `AppleICU76/…`). Every Apple-specific rule used below was then checked against the installed 78.1 library by a probe (§2.6).

Terms:
- **code unit**: one UTF-16 unit. WebKit offsets and lengths count code units.
- **8-bit string**: a WTF `String` stored as Latin-1, so every code unit is at most U+00FF. Some break rules differ between 8-bit and 16-bit storage (§2.3).
- **float32**: IEEE single precision. `Math.fround` reproduces a float32 operation in JS.
- **item**: a run of text that inline layout measures as one unit. Items are built by `L/InlineItemsBuilder.cpp`.
- **prior context**: up to two code units taken from the previous text node, given to the break iterator so it can decide a break at position 0 of the next node (`T/TextBreakIterator.h:239-294`).
- **RBBI table**: ICU's compiled rule-based break iterator data, as returned by `ubrk_getBinaryRules`.
- **category override**: Apple ICU's per-locale reassignment of quote characters to another line-break class (§2.6).
- **fast path**: WebKit's own break decision in `BreakablePositions`, made without asking ICU.

---

# Part 1. Canvas `measureText`

## 1.1 Attributes and defaults

- The 2D context text attributes are `font`, `textAlign`, `textBaseline`, `direction`, `letterSpacing` and `wordSpacing` (`C/CanvasTextDrawingStyles.idl:27-35`). There is **no** `fontKerning`, `fontStretch`, `fontVariantCaps`, `textRendering` or `lang` attribute, so assigning those names creates plain JS properties with no effect.
- The default font is `10px sans-serif` (`C/CanvasRenderingContext2DBase.cpp:111-112`). `direction` defaults to `Inherit`, and `letterSpacing` and `wordSpacing` default to `"0px"` (`C/CanvasRenderingContext2DBase.h:377-382`).

## 1.2 `measureText` step by step

```
function measureText(ctx, text):
  // 1. Replace U+0009, U+000A, U+000B, U+000C and U+000D with U+0020. Nothing else is changed:
  //    no collapsing, and NBSP, U+2028, U+0085 and U+00AD are kept.
  s = normalizeSpaces(text)                          // C/CanvasRenderingContext2DBase.cpp:2847-2875
  // 2. Direction and override
  if ctx is OffscreenCanvasRenderingContext2D:       // C/OffscreenCanvasRenderingContext2D.cpp:182-185
     dir = (ctx.direction == "rtl") ? RTL : LTR; override = false     // C/CanvasRenderingContext2DBase.cpp:3064-3070
  else (HTMLCanvasElement context):                  // C/CanvasRenderingContext2D.cpp:302-320
     document.updateStyleIfNeeded()
     style = canvas.existingComputedStyle()
     dir = ctx.direction == "inherit" ? (style ? style.writingMode.computedTextDirection : LTR)
         : ctx.direction == "rtl" ? RTL : LTR        // C/CanvasRenderingContext2D.cpp:267-282
     override = style && isOverride(style.unicodeBidi)                    // :317
  run = TextRun(s, xpos=0, expansion=0, ExpansionBehavior::allowRightOnly(), dir, override,
                characterScanForCodePath=true)       // :318; C/CanvasRenderingContext2DBase.cpp:3068
  // 3. Measure
  if !fontProxy.realized(): return TextMetrics with width 0                 // :3077-3078
  glyphOverflow.computeBounds = true
  w = FontCascade::width(run, fallbackFonts=null, &glyphOverflow)          // :3083-3086, :519-522
  return TextMetrics{ width = double(w) }            // Source/WebCore/html/TextMetrics.h:37-38
```

`width` is a float32 value widened to double, so `Math.fround(m.width) === m.width` always holds.

`fillText` and `strokeText` build the same `TextRun` (`C/OffscreenCanvasRenderingContext2D.cpp:80-89`; `C/CanvasRenderingContext2D.cpp:335-354`). `drawTextUnchecked` takes the width from a shaped-text cache when the run is LTR with no strongly directional characters (`C/CanvasRenderingContext2DBase.cpp:2877-2888, 2892-2903`). `maxWidth` scales horizontally when it is smaller than the width (`:2905-2906, :3037-3041`). Painting uses `drawBidiText` or the cached glyph buffer (`:2943-2964`).

## 1.3 Font resolution

### OffscreenCanvas (`C/OffscreenCanvasRenderingContext2D.cpp:93-130`)

```
setFont(str):
  if str empty, or (str == state.unparsedFont && font realized): return        // :97-101
  u = parseUnresolvedFont(str)            // CSS font shorthand; "inherit" and "initial" are rejected (:103-107)
  if !u: return
  desc = new FontCascadeDescription; desc.family = "sans-serif"; specifiedSize = computedSize = 10   // :116-119
  cascade = Style::resolveForUnresolvedFont(u, desc)                          // :121
  state.font = cascade
  re-apply state.letterSpacing and state.wordSpacing strings                  // :125-128 (em units re-resolve)
```

`resolveForUnresolvedFont` (`S/StyleResolveForFont.cpp:352-407`) sets only: families (`:370-374`), style slope and axis (`:384-386`), `font-variant-caps` (`:388-389`), weight (`:391-392`) and size (`:394-399`).
- `UnresolvedFont` also has a `width` field for `font-stretch` (`Source/WebCore/css/parser/CSSPropertyParserConsumer+Font.h:91-99`), but the resolver never reads it, so **`font-stretch` keywords in `ctx.font` have no effect**.
- Length sizes go through `computeUnzoomedNonCalcLengthDouble`, so they are **unzoomed** CSS px (`S/StyleResolveForFont.cpp:265-280`).
- The resulting `FontCascade(FontCascadeDescription&&)` constructor forces `shouldDisableLigaturesForSpacing = false` (`G/FontCascade.cpp:74-82`, reset at `:81`).
- No locale is set, so `computedLocale()` is null (`G/FontDescription.h:63`).
- `textRendering` stays `Auto` (`G/FontDescription.cpp:47`). Kerning stays `Auto`, and `enableKerning()` and `requiresShaping()` are both true (`G/FontCascade.h:294-311`).

### HTMLCanvasElement (`C/CanvasRenderingContext2D.cpp:204-265`)

- `setFont` updates style first (`:204-210`).
- If the canvas has a computed style, the description **starts from the canvas element's own computed `fontDescription()`** (`:236-238`). That brings along its locale (from `lang`), `text-rendering`, `font-kerning`, feature settings, `font-variant-*` (including ligatures), `font-stretch`, optical sizing and `text-autospace`.
- Otherwise it starts from the 10px `sans-serif` default (`:239-244`).
- The same resolver then overwrites families, style, variant-caps, weight and size (`:248`), and spacing is re-applied (`:260-264`).
- A `lang` attribute reaches the style as a `-webkit-locale` presentational hint (`Source/WebCore/html/HTMLElement.cpp:278-285` → `Source/WebCore/dom/StyledElement.cpp:388-397`).

### Locale substitution for Han

`FontDescription::setSpecifiedLocale` (`G/FontDescription.cpp:107-112`):
- computes `script = localeToScriptCode(locale)` (`Source/WebCore/platform/text/LocaleToScriptMapping.cpp:160-378`);
- if the script is `USCRIPT_HAN`, the used locale becomes `specializedChineseLocale()`, which is the first user-preferred language starting with `zh-`, or `"zh-hans"` if there is none (`G/FontDescription.cpp:74-104`).

Examples of the script lookup:
- `zh`, `zh-CN`, `zh-SG` and `zh-US` are Han: `zh_cn` is not in the map, `cn` is not a script, and `zh` maps to HAN.
- `zh-Hans` gives SIMPLIFIED_HAN, and `zh-TW`/`zh-HK` give TRADITIONAL_HAN. None of these is swapped.

`userPreferredLanguages()` uses `ShouldMinimizeLanguages::Yes` (`Source/WTF/wtf/Language.cpp:106-127`). On macOS 27, `NSLocale` does not respond to `minimizedLanguagesFromLanguages:`, so `canMinimizeLanguages()` is false (`Source/WTF/wtf/cocoa/LanguageCocoa.mm:68-72`). Each language then goes through `CFBundleGetLocalizationInfoForLocalization` and `CFBundleCopyLocalizationForLocalizationInfo` (`Source/WTF/wtf/cf/LanguageCF.cpp:47-76`).

On this Mac (AppleLanguages `zh-Hans-US, en-US`), `tools/zh_locale_probe.m` computes **`zh-CN`**.

### letterSpacing and wordSpacing (`C/CanvasRenderingContext2DBase.cpp:3271-3325`)

- The value is a CSS `<length>`. Allowed units are px, cm, mm, Q, in, pt, pc, em, quirky em, ex, cap, ch, ic, rcap, rch, rem, rex and ric (`:3208-3269`).
- `calc()` and percentages are rejected: `raw()` returns null (`:3286-3288`).
- The length is converted to a double with `computeUnzoomedNonCalcLengthDouble` against the current font (`:3293`, `:3321`) and stored in `FontCascade::m_spacing` as a **float** (`G/FontCascade.h:141-144`). The double is rounded to the nearest float32.
- Canvas never sets the description's `shouldDisableLigaturesForSpacing`. The DOM does, when `letter-spacing` is non-zero (`S/computed/StyleComputedStyleBase.cpp:318-333`), which turns off `liga`, `clig`, `dlig` and `hlig` but not `calt` (`G/cocoa/UnrealizedCoreTextFont.cpp:258-264`).

## 1.4 `FontCascade::width` (shared by Canvas and DOM)

```
width(run, fallbackFonts, glyphOverflow):          // G/FontCascade.cpp:304-353
  if run.length == 0: return 0
  path = codePath(run)                             // :708-731
  cacheEntry = fonts.glyphGeometryCache.add(run, TextShapingContext(this))       // :319
  if cacheEntry has width and (no fallback fonts were used, or the run is LTR and the caller needs no fallback list):
      return cached width (and cached glyphOverflow when computeBounds matches) // :323-335
  w = path == Complex ? ComplexTextController(this, run, mayUseNaturalWritingDirection=true).totalAdvance.width   // :357-366
                      : WidthIterator(this, run).advance(len); finalize; runWidthSoFar                            // :368-378
  store w in cacheEntry if allowed                 // :344-351
  return w
```

**Code path** (`G/FontCascade.cpp:708-731`):
1. `canHandleRunAsSimpleText` is true for a whole run (`:673-677`).
2. The rule "length > 1 with kerning or shaping gives Complex" is compiled only `#if !USE(FONT_VARIANT_VIA_FEATURES) && !USE(FREETYPE)` (`:718-721`). Cocoa defines `USE_FONT_VARIANT_VIA_FEATURES 1` (`Source/WTF/wtf/PlatformUse.h:293-295`), so the rule is off.
3. `characterScanForCodePath` is true for Canvas, so an 8-bit string gives **Simple** (`:726-727`).
4. A 16-bit string goes to `characterRangeCodePath` (`:733-940+`). It returns Complex for U+02E5–02E9, U+0300–036F, U+0591–05CF except U+05BE, U+0600–109F, U+1100–11FF, U+135D–135F, U+1700–18AF, U+1900–194F, U+1980–19DF, U+1A00–1CFF, U+1DC0–1DFF, U+20D0–20FF, U+26F9, U+2CEF–2CF1, U+302A–302F, U+3099–309C, U+A67C–A67D, U+A6F0–A6F1, U+A800–ABFF and U+D7B0–D7FF; for the supplementary ranges Kharoshthi through Adlam, regional indicators U+1F1E6–1F1FF and Fitzpatrick modifiers (`:874-940`); and for ZWJ after an emoji-group candidate (`:745-746`). U+1E00–U+2000 set `SimpleWithGlyphOverflow` (`:810-813`).

**Glyph geometry cache** (`G/TextMeasurementCache.h:135-175`):
- keyed by text only, per `FontCascadeFonts`;
- skipped without kerning or shaping, with non-zero letter or word spacing, with allowed tabs present, or for text longer than 64 code units (`:53-58`, `:146-147`, `:163-170`);
- sampled with a countdown (`:149-152`).

It stores values the same function computed, so it does not change results for one font and path. Two possible interactions are hypotheses H15 and H16.

### Simple path: `WidthIterator` (float32 throughout)

```
runWidth: float32 = 0
for each character c (8-bit: one byte; 16-bit: surrogate-pair aware) in string order:     // G/WidthIterator.cpp:405-489
   gd = fontCascade.glyphDataForCharacter(c)        // per-character font fallback (:443)
   start a new font range if the font changes; committing a range shapes it (:452-454, :294-316)
   if run is RTL: c = u_charMirror(c)               // HAVE_CORE_TEXT_BIDI_MIRRORING is 0 (PlatformHave.h:1913-1915; FontCascadeInlines.h:130-138)
   if no glyph and c is default-ignorable: commitIgnorable; continue          // :463-468
   adv = font.widthForGlyph(glyph, SyntheticBoldInclusion::Exclude)          // :470; CTFontGetAdvancesForGlyphs, G/coretext/FontCoreText.cpp:605-615
   if treatAsSpace(c) (U+0020, U+0009, U+000A, U+00A0; FontCascadeInlines.h:140-143):
       remember original advance = (c == TAB ? adv : font.spaceWidth(Exclude)) // :473-474
   runWidth += adv                                   // :485
commit last range:                                    // :487-488
   before = float32 sum of the range's advances       // :92-94
   CTFontShapeGlyphs(ctFont, glyphs, advances, …, options, locale)           // G/coretext/FontCoreText.cpp:617-735
       options = ClusterComposition | (enableKerning && n ? Kerning : 0) | (RTL ? RightToLeft : 0)   // :649-651
       locale = computedLocale null ? null : LocaleCocoa::canonicalLanguageIdentifierFromString(locale) // :646
   restore each treat-as-space glyph's remembered advance                     // :107-116
   after = float32 sum; runWidth += after - before                            // :119-123, :307
if letterSpacing or wordSpacing non-zero, or allowed tabs are present:        // :181-184, :875-876
   for each character index k with glyphs:                                    // :654-692
      if c == TAB && run.allowTabs: right += tabWidth(position) - currentAdvance              // :500-506
      if sum of the character's glyph advances != 0: right += letterSpacing                   // :512-516
      if treatAsSpace(c) && (c != TAB || !allowTabs) && (k > 0 || c == NBSP) && wordSpacing: right += wordSpacing   // :518-519
      runWidth += left; runWidth += right                                                     // :563-564
applyCSSVisibilityRules, per glyph:                                           // :744-827
   LF, CR: glyph becomes the space glyph, advance unchanged; + synthetic bold                  // :792-800
   NBSP: + synthetic bold; TAB: invisible + synthetic bold                                     // :801-807
   TAB/LF/CR/NUL/default-ignorable/invisible replacement: delete glyph, runWidth -= advance    // :812-815; FontCascadeInlines.h:145-158
   other Cc control characters: advance = widthForGlyph(0) (.notdef)                           // :817-823
   otherwise, if the advance is non-zero: runWidth += syntheticBoldOffset                      // :750-759, :825
finalize: runWidth += leftover initial advance                                // :829-838
```

- For Canvas, TAB, LF, CR, VT and FF were already replaced by spaces, so the LF, CR and TAB branches never run.
- Measured in webkit-host (system WebKit 22625.1.29.11.27; installed Safari 27.0 not run) on 2026-09-16, with the source re-read: the "TAB/LF/CR/NUL/default-ignorable ...: delete glyph" line is wrong for LF and CR. `case newlineCharacter / carriageReturn` swaps in the space glyph and `continue`s before the delete check at `:812` (`G/WidthIterator.cpp:792-800`), so LF and CR keep their own glyph's advance, as webkit-lines §3.3 says. TAB is made invisible (`:804-806`); only NUL and default-ignorables reach the delete. In Arial the CR advance is 0: DOM `a\rb` = `ab` = 17.796875 in normal and pre.
- U+0000 is deleted (width 0). U+0001–0008, U+000E–001F and U+007F–009F take the `.notdef` advance of the font chosen for them.
- U+00AD (soft hyphen) and other default-ignorables contribute 0 once their glyph is deleted, but their glyphs were present during shaping.

### Complex path: `ComplexTextController`

- Text is split into font ranges by grapheme cluster, using a CF composed-character iterator with the font's locale (`G/ComplexTextController.cpp:351+`, `:387`).
- Each range becomes a CTLine. The attributes are the font, `kCTLanguageAttributeName` when the locale is non-empty, composition language none, and kern 0 when kerning is off (`G/coretext/SimpleFontDataCoreText.cpp:58-94`).
- `FontCascade::width` passes `mayUseNaturalWritingDirection = true`. Unless the run has a directional override, CoreText uses **natural bidi** (`CTLineCreateWithUniCharProvider`, `G/coretext/ComplexTextControllerCoreText.mm:216-235`). **So `ctx.direction` does not change complex-path widths.** An element canvas whose computed `unicode-bidi` is an override forces an embedding level instead (`:216-228`).

`adjustGlyphsAndAdvances` (`G/ComplexTextController.cpp:698-864`), per glyph in glyph order:
- advance = `font.spaceWidth(Exclude)` for treat-as-space characters, else the base advance (CGSize to FloatSize, float) (`:722, :745`);
- TAB with `allowTabs` takes the tab width (`:747-754`);
- ZWNJ gives 0 and a deleted glyph (`:755-761`);
- other zero-width characters (below U+0020, U+007F–U+009F, SHY, ZWSP, LRM/RLM, LRE–RLO, U+FEFF, invisible replacement; `G/FontCascadeInlines.h:160-175`) give 0 (`:762-768`);
- Cc characters other than LF, CR, NBSP, TAB and NUL take the `.notdef` advance (`:773-780`);
- the first glyph adds the run's initial advance minus its origin (`:782-786`);
- a non-zero advance adds synthetic bold (`:789-790`), and, with extra spacing, letter spacing (`:795-796`);
- word spacing goes on treat-as-space characters that are not the run's first character, or are NBSP (`:841-842`);
- `m_totalAdvance += advance`, as a float32 `FloatSize` (`:864`).

Synthetic bold is `size / 36.0f` per glyph (`G/coretext/FontCoreText.cpp:120-121`). Glyph advances are CoreText's unhinted fractional values, not rounded (`:605-615`).

## 1.5 How Canvas differs from the DOM for the same string

DOM text width comes from `TextUtil::width` (`L/text/TextUtil.cpp:62-104`):

```
domWidth(box, from, to):
  extended = useTrailingWhitespaceOptimization && (enableKerning || requiresShaping) && text[to] == U+0020      // :76-78
  if extended: to++
  if box.canUseSimplifiedContentMeasuring:                                   // :80-86
     w = canTakeFixedPitchFastContentMeasuring ? widthForSimpleTextWithFixedPitch(sub, collapseWhiteSpace)
                                               : widthForTextUsingSimplifiedMeasuring(sub)
  else:
     run = TextRun(sub, xpos=contentLogicalLeft, …, dir = override ? bidiDirection : LTR, override)          // :89-90
     if !collapseWhiteSpace && tabSize != 0: run.setTabSize(true, tabSize)   // :91-92
     w = fontCascade.width(run, {}, glyphOverflow)                           // :95
  if extended: w -= (singleSpaceWidth + wordSpacing)                         // :98-99; singleSpaceWidth :54-60
  NaN -> 0, inf -> max; return max(0, w)                                     // :101-103
```

| Aspect | DOM | Canvas | Source |
| --- | --- | --- | --- |
| TAB, LF, VT, FF, CR | Kept when preserved. TAB uses tab stops (`tabWidth`). LF and CR draw the space glyph but keep their own glyph's advance. VT and FF take the `.notdef` advance. | All become U+0020 | `G/WidthIterator.cpp:792-823`; `C/CanvasRenderingContext2DBase.cpp:2847-2875` |
| Direction | LTR unless `unicode-bidi` is an override, even for RTL bidi levels | `ctx.direction` (element canvas: `inherit` gives the element's direction) | `L/text/TextUtil.cpp:89-90`; `C/CanvasRenderingContext2D.cpp:267-282` |
| Measuring function | May use simplified measuring (primary font only, no spacing, no synthetic bold, Simple path, every character below U+3041 and not a control, format character, NBSP or SHY). That path either multiplies `length × spaceWidth` (fixed pitch with collapsing white space) or shapes once and sums advances **without restoring space advances**, in a different float32 order. | Always the full `WidthIterator` or `ComplexTextController` | `L/text/TextUtil.cpp:716-745`; `G/WidthIterator.cpp:694-742`; `G/FontCascade.cpp:381-442` |
| Trailing space | Measures `item + " "`, then subtracts `spaceWidth + wordSpacing` | Measures what you pass | `L/text/TextUtil.cpp:76-99` |
| Locale | The style's used locale (lang, Han swap) | OffscreenCanvas: null. Element canvas: the canvas element's locale | §1.3 |
| Letter spacing | Disables `liga`, `clig`, `dlig`, `hlig` | Ligatures stay on | `S/computed/StyleComputedStyleBase.cpp:318-333`; `G/FontCascade.cpp:81` |
| Other font properties | From CSS | OffscreenCanvas: family, style, caps, weight, size only. Element canvas: copied from the canvas element | `S/StyleResolveForFont.cpp:352-407` |
| `text-autospace` | Initial `no-autospace` | Same (element canvas copies it) | `Source/WebCore/css/CSSProperties.json:1551-1555` |
| Font size under zoom | The computed size includes effective zoom (not read at this tag; hypothesis H9) | Unzoomed | `S/StyleResolveForFont.cpp:278` |
| Hyphen | `hyphenString`: U+2010 if the primary font has that glyph, else U+002D; width through `FontCascade::width` | Can measure either string | `S/computed/StyleComputedStyle.cpp:419-435`; `L/text/TextUtil.cpp:621-624` |

## 1.6 Arithmetic (units, types, rounding)

- **Units**: CSS px in the canvas coordinate space. CoreText advances are independent of device pixel ratio, and WebKit on Cocoa does not round advances to device pixels (`G/coretext/FontCoreText.cpp:605-615`).
- **Glyph advance**: `CGSize.width` (double) converted to `float` by rounding to the nearest float32 (`:614`).
- **Accumulation**:
  - `WidthIterator::m_runWidthSoFar` is float. The addition order is:
    1. per-character pre-shaping advances in string order (`G/WidthIterator.cpp:485`);
    2. at each font-range commit, `afterWidth − beforeWidth`, each a left-to-right float32 sum over that range (`:92-94, :119-123, :307`);
    3. initial advance or leftover (`:155-176`);
    4. spacing, left then right per character (`:563-564`);
    5. visibility rules per glyph: bold `+=`, clobber `+= new − old`, delete `−=` (`:757, :772, :777`);
    6. the final leftover (`:834`).
  - `ComplexTextController` sums `FloatSize` (float) per glyph in glyph order (`G/ComplexTextController.cpp:864`).
  - A port must apply `Math.fround` after every addition and subtraction in this order.
- **Spacing values**: double to float (`G/FontCascade.h:141-144`). Synthetic bold `size / 36.0f` (float). Tab: `fmodf` in float (`G/FontCascadeInlines.h:76-94`). Fixed pitch: `unsigned × float` (`G/FontCascade.cpp:421`).
- **Result**: float32 returned as double (`Source/WebCore/html/TextMetrics.h:37-38`). There is no rounding and no epsilon. Canvas makes no comparison against any width. Fitting belongs to the layout spec.

## 1.7 Runtime settings that change Canvas widths

- `USE_FONT_VARIANT_VIA_FEATURES 1` on Cocoa (`Source/WTF/wtf/PlatformUse.h:293-295`): kerning does not force the complex path.
- `HAVE_CORE_TEXT_BIDI_MIRRORING 0` (`Source/WTF/wtf/PlatformHave.h:1913-1915`): the simple path mirrors RTL characters with `u_charMirror` before glyph lookup.
- User language preferences: they choose the Han swap locale (`zh-CN` here), which reaches shaping and fallback only for DOM text or an element canvas with `lang`.
- Script-tracking privacy noise applies to `getImageData`, not `measureText` (`C/CanvasRenderingContext2DBase.cpp:2640-2641`). `webAPIStatisticsEnabled` only logs (`C/CanvasRenderingContext2D.cpp:309-312`).

---

# Part 2. Safari's break data

## 2.1 Where break opportunities are asked for

1. **Per text node**, `InlineItemsBuilder` builds one `CachedLineBreakIteratorFactory`, with locale `Style::toPlatform(style.computedLocale())`, mode `lineBreakIteratorMode(line-break)`, content analysis `contentAnalysis(word-break)`, and **empty prior context** (`L/InlineItemsBuilder.cpp:950`).
2. **Non-whitespace items** end at the next breakable position (`moveToNextBreakablePosition`, `L/InlineItemsBuilder.cpp:75-87`):
   ```
   p = start
   while p < len:
     nb = findNextBreakablePosition(factory, p, style)
     if nb != start: return nb - start        // compares with start, not p
     p++
   return len - start
   ```
   - With `hyphens: none`, items that end in U+00AD are merged with the next one (`:1016-1021`).
   - Otherwise an item ending in U+00AD is flagged `hasTrailingSoftHyphen` (`:1023-1025`).
   - NBSP with `-webkit-nbsp-mode: space` becomes single-character items (`:993-1011`).
   - U+2028 and U+2029 are always forced breaks, and U+000A is one when newlines are preserved (`:954-960`).
3. **Inside one node**:
   - two adjacent non-whitespace items of the same node and the same bidi level are a wrap opportunity (`L/InlineFormattingUtils.cpp:344-346`; `L/TextOnlySimpleLineBuilder.cpp:215`);
   - with different bidi levels the position is re-queried with a new factory (`L/InlineFormattingUtils.cpp:347-352`);
   - the position after a whitespace item is always an opportunity (`:340-341`).
4. **Across text nodes**, `TextUtil::mayBreakInBetween` (`L/text/TextUtil.cpp:374-396`):
   ```
   if previous content is 16-bit: convert next content to 16-bit                       // :379-383
   factory = CachedLineBreakIteratorFactory(nextContent, next.locale, next.lineBreakMode, next.wordBreak analysis)   // :384
   last = previous[-1]; if last == U+00AD && previous.hyphens == none: return false     // :387-389
   factory.priorContext = { previous[-2] or 0, last }                                 // :390-391
   return findNextBreakablePosition(factory, 0, nextStyle) == 0                       // :395
   ```
   The **next** node's style decides: locale, `line-break`, `word-break` and `-webkit-nbsp-mode`.
   - `line-break: anywhere` on either side gives an opportunity (`L/InlineFormattingUtils.cpp:422-425`).
   - Preserved white space followed by `break-spaces` or `line-break: after-white-space` does not (`:418-420`).
5. `word-break: break-all`, `break-word`, `line-break: anywhere` and `overflow-wrap` **do not change the scan**. They are applied only to overflowing content in `InlineContentBreaker::wordBreakBehavior` (`L/InlineContentBreaker.cpp:877-912`).

## 2.2 Mode selection (`L/text/TextUtil.cpp:398-480`)

```
lineBreakIteratorMode(line-break): auto, after-white-space, anywhere -> Default; loose -> Loose; normal -> Normal; strict -> Strict   // :450-466
contentAnalysis(word-break): auto-phrase -> Linguistic; everything else -> Mechanical                                           // :468-480

findNextBreakablePosition(factory, start, style):
  nbsp = (style.textWrapMode != nowrap && style.nbspMode == space) ? Break : Normal                     // :401
  if style.wordBreak == keep-all:     return next(Special, KeepAll, nbsp)                               // :403-407
  if style.wordBreak == auto-phrase:  return next(Special, AutoPhrase, Normal)                          // :409-410
  if factory.mode == Default:         return next(Normal, Normal, nbsp)                                 // :412-416
  return next(Special, Normal, nbsp)                                                                    // :418-421
```

`WordBreakBehavior::BreakAll` exists (`R/BreakablePositions.h:38-43`), but no caller passes it at this tag.

## 2.3 `BreakablePositions` (verbatim port rules, `R/BreakablePositions.h`)

```
isBreakableSpace(ch, nbsp): ch in {U+0020, U+000A, U+0009, U+2028, U+2029} || (ch == U+00A0 && nbsp == Break)   // :124-139

next(rules, words, nbsp, factory, start):                                   // :287-300
  s = factory.string
  if s is 8-bit: return words == KeepAll ? nextBreakableSpace(s, start, nbsp, punctuation=false) : nextBreakablePosition(...)
  if words == KeepAll: return nextBreakableSpace(s, start, nbsp, punctuation=true)
  return nextBreakablePosition(...)

nextBreakableSpace(s, start, nbsp, punctuation):                           // :257-274
  for i in start ..< s.length:
    if isBreakableSpace(s[i], nbsp): return i
    if s[i] == U+200B: return i
    if s[i] == U+3000: return i + 1
    if punctuation && generalCategory(code unit s[i]) in {Ps, Pe, Pi, Pf, Po} && i + 1 < s.length: return i + 1
  return s.length
  // Surrogates have category Cs, so supplementary punctuation never matches.
  // The 600 BMP code units that match on libicucore 78.1 are in data/webkit/breakable-positions/keepall-punctuation-bmp.tsv.

nextBreakablePosition(factory, s, start, rules, words, nbsp):              // :141-255
  prior = factory.priorContext          // two code units; length = number of trailing non-zero units
  if start == 0 && prior.length == 0:
     if s.length <= 1: return s.length
     start = 1
  bb = { ch: start > 1 ? s[start-2] : prior.secondToLast, type: 0 }
  b  = { ch: start > 0 ? s[start-1] : prior.last,         type: 0 }
  a  = { ch: 0, type: 0 }
  nextBreak = none
  i = start
  while i < s.length:
    a = { ch: s[i], type: 0 }
    body:
      if isBreakableSpace(a.ch, nbsp): return i
      if rules == Normal:
        if b.ch == '-' && isASCIIDigit(a.ch):
           if isASCIIAlphanumeric(bb.ch): return i
           goto step
        if b.ch <= 0xFF && a.ch <= 0xFF:
           if b.ch >= 0x21 && a.ch >= 0x21 && PAIR_TABLE[b.ch - 0x21][a.ch - 0x21]: return i
           goto step
      if words != AutoPhrase:
        if b.type == 0: b.type = classify(b.ch, nbsp)
        a.type = classify(a.ch, nbsp)
        pair = b.type | a.type
        if (pair & ~(SP|AL|QU|Pi|Pf)) == 0: goto step
        if (pair | AL) == (ID | AL): return i          // ID next to ID or AL (the keep-all branch is unreachable)
        if (pair & (GL|QU)) && !(pair & Weird):
           if (pair & ID) && (pair & QU) && ((a.type & Pi) || (b.type & Pf)): return i
           goto step
        if a.type == CM: a.type = b.type; goto step
        if rules == Normal && !(pair & Weird) && (pair & (CL|CP|OP)):
           if a.type == CL || a.type == CP || b.type == OP: goto step
           if pair & ID: return i
      // ICU (slow)
      if nextBreak is none || nextBreak < i: nextBreak = factory.icu.following(i - 1)    // none on UBRK_DONE
      if nextBreak is some && i < nextBreak:
         max = min(nextBreak, s.length - 1)
         while i < max:
            la = s[i + 1]
            if (la <= 0xFF && !isASCIIAlpha(la)) || (nbsp == Break && la == U+00A0): break
            bb = b; b = a; i++          // a is NOT refreshed here: b, bb and a stay stale on purpose
      if i == nextBreak && !isBreakableSpace(b.ch, nbsp): return i
    step:
      bb = b; b = a; i++
  return s.length
```

Port notes:
- `following(i - 1)` with `i == 0`, which happens only when there is prior context, wraps in unsigned arithmetic and effectively means "first boundary ≥ 0 in (prior context + text) coordinates". Use "smallest ICU boundary ≥ i".
- The ICU text is the prior context followed by the node text, and offsets are shifted back (`T/icu/TextBreakIteratorICU.h:99-147`).
- `goto step` is C++ `continue`, so the loop's `bb = b, b = a, ++i` runs.

**Pair table** (`R/BreakablePositions.cpp:39-267`):
- 223 rows × 28 bytes for U+0021..U+00FF; bit `(a − 0x21) % 8` of byte `(a − 0x21) / 8` in row `b − 0x21` (`R/BreakablePositions.h:104-119`);
- 1,547 breakable (before, after) pairs;
- copied verbatim to `data/webkit/breakable-positions/linebreak_table.inc`, expanded in `linebreak-table-pairs.tsv`.

**`classify`** (`R/BreakablePositions.h:329-539`): run over every code unit into `data/webkit/breakable-positions/classify.tsv`. The class bits are AL=1, ID=2, CM=4, OP=8, CP=16, CL=32, GL=64, QU=128, SP=256, Pi=512, Pf=1024, Weird=32768 (`:80-102`). Key facts:
- `"` and `'` are QU;
- U+00AB and U+2018/U+201C are QU|Pi; U+00BB and U+2019/U+201D are QU|Pf;
- NBSP is GL, or SP with `nbsp == Break`;
- U+0000–U+001F are Weird or CM (U+0010–001F are CM);
- U+3000–303F are mixed; U+3040–30FF are Weird;
- U+2E80–A4CF are mostly ID, as are Hangul syllables and U+F900–FAFF;
- U+0600–U+19FF are Weird.

The Normal/Special template argument does not change `classify`: both sets are identical in the data.

**`isBreakable`** (`:303-327`) is the legacy renderer entry. `line-break: anywhere` there uses `NonSharedCharacterBreakIterator` (`:276-285, :308-309`).

## 2.4 Opening the ICU iterator

```
TextBreakIterator(string, priorContext, LineMode{behavior}, contentAnalysis, locale):     // T/cocoa/TextBreakIteratorInternalICUCocoa.cpp:34-47
  if contentAnalysis == Linguistic && behavior == Default: use CFStringTokenizer (LineBreak mode)      // word-break: auto-phrase
  else TextBreakIteratorICU:
     loc = makeLocaleWithBreakKeyword(locale, behavior)                     // T/icu/TextBreakIteratorICU.h:150-193
        if behavior == Default or UTF-8(locale) is empty: loc = locale      // :152-158
        else loc = uloc_setKeywordValue("lb", "loose" | "normal" | "strict") into a buffer of length(locale) + 11,
             growing on U_BUFFER_OVERFLOW_ERROR                             // :159-192; ICUHelpers.h:36
     it = ubrk_open(UBRK_LINE, utf8(loc)); if it fails: it = ubrk_open(UBRK_LINE, "")                     // :62-69
     ubrk_setUText(it, UText(priorContext + string))                        // :99-124
  following(k) = ubrk_following(it, k + priorLen) - priorLen; UBRK_DONE -> none                            // :136-142
```

- The locale string is the used locale **as written in the `lang` attribute** (for example `zh-Hant`, `en-US`, `ja-JP`), or the Han swap result. `@lb=` is appended to it.
- A page without `lang` (or with `lang=""`) passes the empty locale. **`line-break: loose/normal/strict` without `lang` therefore still opens the root table.** Its only effect is to turn off the fast-path shortcuts (§2.2).
- Iterators are cached, 2 unused per mode+locale (`T/TextBreakIterator.h:140-181`). This does not change results.
- `NonSharedCharacterBreakIterator` is `ubrk_open(UBRK_CHARACTER, currentTextBreakLocaleID())` (`T/TextBreakIterator.cpp:65-71, 135-158`). That locale is the `AppleTextBreakLocale` preference, else the first preferred language: `zh-Hans-US` on this Mac (`T/cocoa/TextBreakIteratorInternalICUCocoa.cpp:57-101`).
  - It is used for emergency breaks on the complex font path (`L/text/TextUtil.cpp:354-364`), for `firstUserPerceivedCharacterLength` on the complex path (`:578-598`) and by `BreakablePositions::nextCharacter`.
  - The complex text controller's own grapheme walk uses CF composed-character clusters (`T/cocoa/TextBreakIteratorInternalICUCocoa.cpp:44-45`; `G/ComplexTextController.cpp:387`).

## 2.5 libicucore 78.1 line tables (what `ubrk_open` loads)

Dumped by `data/webkit/tools/icu_brk_dump.c`, which reproduces WebKit's open sequence, into `data/webkit/icu-macos27-libicucore/`. The manifest has 212 configurations: 52 locales × 4 behaviours, plus two character configurations, one word and one sentence. There are 9 distinct binary files.

| sha256 (first 16) | size | Rule file (identified from rule source: `$CJ` in `$NS` means strict, `$CJ` in `$ID` means normal, `$NS-$NSX` means loose) | Opened by |
| --- | --- | --- | --- |
| `ac36fb0a8ca06abd` | 73,440 | `line` (strict; CJ behaves as NS) | `""` in every behaviour; every non-ja/ko/zh locale with default or `@lb=strict` (en, fr, de, he, ar, th, yue, und, xx, …) |
| `e4895a01adfb9408` | 75,600 | `line_loose` | non-CJK locale `@lb=loose` |
| `65a4db3a86fbb9d3` | 73,336 | `line_normal` (CJ behaves as ID) | non-CJK locale `@lb=normal`; `ja`, `ja-JP`, `ko`, `ko-KR` default |
| `93b2373cd26cf6d8` | 80,264 | `line_loose_cj` | ja, ko, zh, zh_Hant `@lb=loose` |
| `9734e512ac7503d7` | 74,432 | `line_normal_cj` | ja, ko, zh, zh_Hant `@lb=normal` |
| `7ef71178db96ab1f` | 73,472 | `line_cj` (strict) | ja, ko `@lb=strict`; zh, zh-hans, zh-Hans, zh-Hans-US, zh-CN, zh-SG, zh-Hant, zh-hant, zh-TW, zh-HK, zh-MO default and `@lb=strict` |
| `fe6dbecf6da020b1` | 13,984 | character | `UBRK_CHARACTER` with `zh-Hans-US` or `""` |
| `1426161e4122a3b2` | 22,984 | word (Apple removes `:` U+FE55 U+FF1A from MidLetter) | `UBRK_WORD` |
| `1fd346e03766afb6` | 19,712 | sentence | `UBRK_SENTENCE` |

Verified facts about these tables:
- **Rule source text** embedded in each line, character and sentence table is identical to Homebrew upstream ICU 78.3 (`sections.tsv`; rule text in `rules/<sha>.txt`).
- **Break function**: the compiled tables differ byte-wise from 78.3, and on random strings the break results differ only where Apple's libicucore assigns properties to Apple private-use characters U+F7F0–U+F8FF (upstream: Line_Break XX). With that range left out, there are 0 differences in 300,000 random strings for each line table and for the character table (`table-equivalence-vs-upstream78.3.txt`, `unicode-properties-vs-upstream78.3.diff`).
- **Default-locale independence**: the dumps with no `LANG` (ICU default `en_US_POSIX`) and with `LANG=zh_CN.UTF-8` (default `zh_CN`) have identical hashes and identical probe boundaries for every configuration (`icu-comparison/macos27-libicucore-LANG-zh_CN.manifest.tsv`).
- **Round trip**: `ubrk_openBinaryRules` over the dumped bytes reproduces `ubrk_open` on the samples **except where Apple's quote overrides apply** (§2.6). The `roundTrip` column flags those.
- Dictionary and LSTM data for Thai, Lao, Khmer and Myanmar are not part of these binaries. libicucore loads them itself. On the one Thai sample, the boundaries equal upstream 78.3 (`probes.tsv`).

## 2.6 Apple ICU quote category overrides (the page language changes quote breaks)

When it creates a line iterator, Apple's ICU calls `setCategoryOverrides(requestedLocale)` (`AppleICU76/brkiter.cpp:458-472`; `AppleICU76/rbbi.cpp:397-486`):

```
setCategoryOverrides(loc):                         // loc = the locale string ubrk_open received, including @lb
  if language(loc) == "da": no overrides           // rbbi.cpp:411-414
  data = ulocdata_open(loc)                        // CLDR delimiters, with ICU resource fallback (default locale, then root)
  overrides = []
  for (open, close) in [(quotationStart, quotationEnd), (alternateQuotationStart, alternateQuotationEnd)]:   // :418-421
     o = the delimiter if it is exactly 1 UTF-16 unit, else 0
     c = likewise; if c == U+201C: c = U+201D; if c == U+2018: c = 0                                         // :433-460
     if o != c:
        if LineBreak(o) == QU && o != U+2019: overrides += (o -> category of U+007B, i.e. OP)                // :466-469
        if LineBreak(c) == QU && c != U+2019: overrides += (c -> category of U+007D, i.e. CL)                // :470-473
  // handleNext: a code point equal to an override uses that category instead of the trie value (rbbi.cpp:1065-1080)
```

Resulting overrides on macOS 27 (`data/webkit/icu-macos27-libicucore/quote-probe.tsv` header lines; delimiters in `delimiters.tsv`):

| Locale (any `@lb`) | Overrides |
| --- | --- |
| `""` (no lang), en, en-US, en-GB, es, pt, pt-BR, tr, hi, th, vi, id, ko, zh, zh-CN, zh-Hans, zh-Hans-US, und, xx | U+201C→OP, U+201D→CL, U+2018→OP |
| fr, fr-CA | U+00AB→OP, U+00BB→CL |
| it, el | U+00AB→OP, U+00BB→CL, U+201C→OP, U+201D→CL |
| ru, uk, pl, ro | U+00AB→OP, U+00BB→CL, U+201D→CL |
| de, de-CH, cs, is | U+201D→CL |
| hu | U+201D→CL, U+00BB→OP, U+00AB→CL |
| nb | U+00AB→OP, U+00BB→CL, U+2018→OP |
| nl | U+2018→OP |
| fa | U+00AB→OP, U+00BB→CL, U+2039→OP, U+203A→CL |
| sv, fi, da, he, ar, ur, ja, ja-JP, zh-Hant, zh-TW, zh-HK, yue | none |

Verification on the installed libicucore 78.1 (`tools/icu_quote_probe.c`):
- Every BMP Line_Break=QU character (36 of them) was placed in contexts from 16 classes (left and right, including start and end of text), for 47 locales × 4 behaviours, with no `@lb` on the empty locale: 1,704,960 probes.
- 41,714 probes differ from the rules alone.
- **0 differ from the emulation above**, where each overridden character is replaced by U+007B or U+007D and run through the same binary rules.
- `ubrk_following(k)` agrees with forward iteration in 3,635,280 checks under overrides (`tools/following_check`, run in scratch).

Consequences:
- For an unknown `lang` and for no `lang`, `ulocdata_open` falls back to the ICU default locale of the process. On this Mac both candidate defaults give the en overrides. What Safari's WebContent process uses is an open question.
- WebKit reaches ICU for quotes only when the fast path does not decide (§2.3). A quote next to a Latin letter, a digit or another quote never reaches ICU, and neither does a quote next to an ID character, which the fast path's LB19a rule decides.
- The Han swap (§1.3) does not change break data on this Mac: `zh-CN` and `zh-Hans-US` open the same table and give the same overrides.

## 2.7 Break data: settings and flags

- ICU default locale of the WebContent process (`uloc_getDefault`): quote overrides for `""` and unknown locales.
- `AppleTextBreakLocale` and AppleLanguages: the grapheme iterator locale, and the Han swap.
- `-webkit-nbsp-mode: space`: NBSP becomes breakable (`L/text/TextUtil.cpp:401`).
- 8-bit versus 16-bit string storage: keep-all punctuation breaks happen only on 16-bit text, and `mayBreakInBetween` converts the next node to 16-bit when the previous node is 16-bit (`L/text/TextUtil.cpp:379-383`).

---

# (e) What Canvas can supply

"Exact" means bit-identical float32. O = OffscreenCanvas; E = connected HTMLCanvasElement context.

| Width fact | Exact from Canvas? | Recipe / reason |
| --- | --- | --- |
| DOM non-simplified item width `w(item)` with extended measuring | **Yes**, under the conditions in the next row | `fround(max(0, fround(W(item + " ") − fround(W(" ") + ws))))`, where `W` is `measureText(...).width` with `ctx.wordSpacing = ws`, `ctx.letterSpacing = ls` and `direction = "ltr"`. Same `FontCascade::width` (`L/text/TextUtil.cpp:95-99`; `G/FontCascade.cpp:304`). `W(" ")` equals `primaryFont().spaceWidth()` whenever the space glyph comes from the primary font. |
| Conditions for the row above | — | The string has no TAB, LF, CR, VT or FF. Locale equal (O: page without lang, or text whose font selection is not language-sensitive; E: `<canvas lang=…>`). `ls == 0`, or the text forms no ligatures. Kerning, text-rendering, features and stretch at their defaults (O), or copied through CSS on the canvas element (E). No `unicode-bidi` override on DOM text. No tab-size. |
| DOM simplified measuring (8-bit or below-U+3041 text, primary font only, no spacing) | Usually, not provably | The DOM shapes once and sums without restoring space advances, in a different float32 order (`G/FontCascade.cpp:381-412`). It equals Canvas when shaping leaves space advances untouched and the sums round the same way. See H15. |
| Fixed-pitch fast path | Space width yes; rule no | The DOM returns `fround(len × spaceWidth)` with no shaping (`G/FontCascade.cpp:414-421`). Canvas shapes, so compute the product yourself. Eligibility (monospace, not user-installed, not Courier New, one font range; `G/coretext/FontCoreText.cpp:776-781`; `G/FontCascadeInlines.h:63-69`) cannot be observed from JS. |
| Letter-spaced width (DOM disables ligatures) | O: no. E: probably | O keeps `liga`/`clig` (`G/FontCascade.cpp:81`). E with `font-variant-ligatures: no-common-ligatures no-discretionary-ligatures no-historical-ligatures` on the canvas element turns the same features off (H4). |
| Tab width | Inputs yes, rule static | `tabWidth` from `spaceWidth`, tab-size and `position = xpos + widthSoFar` (`G/FontCascadeInlines.h:76-94`; `G/WidthIterator.cpp:500-506`). Canvas turns TAB into space, so kerning around the tab glyph cannot be probed. |
| LF/CR advance kept from the glyph; VT/FF `.notdef` advance | No | normalizeSpaces turns them into spaces (`C/CanvasRenderingContext2DBase.cpp:2847-2875`). A `.notdef` width may be obtainable with another Cc character such as U+0001 (H10). |
| U+00AD, U+200B, other default-ignorables | Yes | Both Canvas and DOM delete the glyph, and the width contributes 0 (`G/WidthIterator.cpp:812-815`). |
| Hyphen string width | Yes, once the string is known | `measureText("‐")` or `"-"`. Whether the primary font has U+2010 is not directly observable. |
| Synthetic bold, font fallback, emoji, system-ui | Yes | Same `FontCascade` path. PLATFORM_BUGS.md records Safari's canvas and DOM agreeing for emoji and system-ui. |
| RTL simple-path shaping | Yes with `direction = "rtl"`, but the DOM measures LTR | DOM items use LTR (`L/text/TextUtil.cpp:90`). Set O's direction to `"ltr"`. Complex-path widths do not depend on direction. |
| Widths under page zoom or CSS zoom | Not directly | Canvas sizes are unzoomed (`S/StyleResolveForFont.cpp:278`). Use a zoomed px size (H9). |
| Break opportunities, pair table, ICU tables, quote overrides, bidi levels, grapheme boundaries | No | Static data in `data/webkit/`. `Intl.Segmenter` grapheme in Safari uses the same libicucore (H18). |

Measured in webkit-host (system WebKit 22625.1.29.11.27; installed Safari 27.0 not run) on 2026-09-16:
- Simplified measuring row: not bit-exact. Text with NBSP, which takes the full path, equals Canvas at 13.33, 13.337, 11.1111 and 17.49px. Plain Latin text on the shortcut path differs by one float32 step at 11.1111px (`Hello world` 54.958710 vs 54.958717) and 17.49px (86.510597 vs 86.510605), and for 20px `system-ui` `The quick brown fox 0123` (225.220261 vs 225.220245). The shortcut shapes once and sums advances in one loop (`G/FontCascade.cpp:381-412`, sum at `:405-407`), while WidthIterator sums pre-shaping advances and adds `after − before` per range (`G/WidthIterator.cpp:92-123`). A fit test at an exact threshold can flip. Port the shortcut summing order, which needs per-glyph advances, or name the loss. H15's `AV` and `Hello world` at 16px Times New Roman were equal.
- Emoji row: DOM = O at the CSS size, bit-exact at 8–32px. Measuring at `size × DPR` and dividing is wrong for WebKit below 32px.
- Letter-spaced row: E with `font-variant-ligatures: no-common-ligatures` equals the DOM (59.344002). Locale: under `<html lang="ko">` O gives 64 for `永骨` where the DOM gives 55.36; an E without its own `lang` inherits the page lang (53.328 = DOM under ja).

---

# (f) Hypotheses to probe in installed Safari 27.0

Fonts are macOS 27 system fonts. CoreText offline numbers at 16px, from a local CoreText probe:
- Menlo: every glyph, including `.notdef`, advances 9.6328125.
- Helvetica Neue: `f` 4.736, `i` 3.552, `l` 3.552, space 4.448, `.notdef` 8.
- Hoefler Text `fifl`: 18.704 with ligatures (2 glyphs), 19.344 without (4 glyphs).

1. **normalizeSpaces.** O, `font = "16px 'Helvetica Neue'"`: `measureText("ab").width === measureText("a b").width`, and likewise for ``, `\r`, `\n` and `\t`. DOM `<span style="white-space:pre;font:16px 'Helvetica Neue'">a&#x0B;b</span>` width minus DOM `ab` ≈ the `.notdef` advance of the font WebKit picks for U+000B (8 if the primary font), not 4.448.
2. **font-stretch ignored.** O: `measureText("Hello")` is identical for `font = "condensed 16px 'Helvetica Neue'"` and `"16px 'Helvetica Neue'"`.
3. **letterSpacing keeps ligatures.** O, `font = "16px 'Hoefler Text'"`, `letterSpacing = "10px"`: `measureText("fifl").width` ≈ 18.704 + 2×10 = 38.704. DOM span with `letter-spacing: 10px` ≈ 19.344 + 4×10 = 59.344 (trailing spacing included).
4. **Element canvas ligature off.** A connected `<canvas style="font-variant-ligatures: no-common-ligatures">` with the same font and `letterSpacing = "10px"`: `measureText("fifl").width` equals the DOM span width from H3.
5. **Canvas widths are float32.** For any string, `Math.fround(w) === w`.
6. **Complex path ignores `ctx.direction`.** O, `font = "16px 'Geeza Pro'"`, text `"مرحبا بالعالم"`: the width with `direction = "ltr"` equals the width with `direction = "rtl"`.
7. **Element canvas copies lang.** On `<html lang="ja">`, `font = "16px sans-serif"`, text `"直角 骨"`: a connected `<canvas lang="ja">` equals the DOM span. O may differ (#285993 is already in PLATFORM_BUGS.md), with a difference ≥ 0.05px expected only when the glyph selection differs.
8. **NUL and SHY contribute 0.** O, `font = "16px Menlo"`: `measureText("a b").width === measureText("a­b").width === measureText("ab").width === 19.265625`.
9. **Zoom.** At Safari page zoom 150%, O `measureText("Hello")` with `font = "16px 'Times New Roman'"` returns the same value as at 100%.
10. **Control characters.** O, `font = "16px 'Helvetica Neue'"`: `measureText("ab").width − measureText("ab").width` equals DOM `white-space:pre` span `a&#x01;b` minus span `ab`. Both use the `.notdef` advance.
11. **Quote overrides follow the page language.** `<div lang=L style="font:16px Menlo;width:50px">abcd.“efg”</div>`:
    - L ∈ {en, es, it, el, ko, zh, zh-Hant, no lang, `xx`}: 2 lines, the second starting at code unit 5.
    - L ∈ {sv, fi, da, he, ar, ja, de, fr, ru, hu, nl, fa}: 1 line (overflow).
    - Why: `"abcd."` = 48.1640625 ≤ 50; `.`+`“` is Weird+QU, so the fast path asks ICU.
    - en-like locales remap U+201C to OP. zh-Hant has no override, but its `line_cj` table allows the break by itself.
    - Checked offline: `ubrk_following(4)` on the system libicucore returns 5 for the first set and 10 for the second.
12. **The next node's lang decides at a node boundary.** `<div style="font:16px Menlo;width:50px"><span lang=sv>abcd.</span><span lang=en>“efg”</span></div>` gives 2 lines. Swapping the two `lang` values gives 1 line.
13. **WebKit's LB19a rule (new at 7625) ignores lang.** `<div lang=sv style="font:16px 'Hiragino Sans';width:16px">中“文”中</div>` has line starts [0, 1, 4]: a break before U+201C and after U+201D, and none between U+201C and 文. The fast path decides all four positions without ICU (`R/BreakablePositions.h:214-220`). In 7624, U+201C and U+201D were Weird and went to ICU; for this string the outcome may be the same, so this probe checks the rule, not a difference.
14. **keep-all punctuation only on 16-bit text.** `word-break:keep-all;font:16px Menlo;width:50px`: `abcd,efgh中` gives 2 lines (the second starting at 5); `abcd,efghé` gives 1 line. The expectation assumes the second node is stored 8-bit.
    - Measured in webkit-host (system WebKit 22625.1.29.11.27; installed Safari 27.0 not run) on 2026-09-16: confirmed when the text node is stored 8-bit (markup built from JS literals). The same markup stored 16-bit, because the document's JSON payload contained CJK text, gives 2 lines for `abcd,efghé` (webkit-text §13 note).
15. **Simplified DOM path equals Canvas in practice.** `<span style="font:16px 'Times New Roman'">AV</span>` `getBoundingClientRect().width === ` O `measureText("AV").width`; and for `"Hello world"` likewise.
16. **Cache interaction.** In one document, O and a DOM span with the same font measure `"Te st"` in alternating order 100 times. The expected per source is that every O result is identical. A difference would mean the shared glyph geometry cache returned the DOM's simplified-path value.
17. **line-break without lang disables the table shortcuts.** `font:16px Menlo;width:25px`, text `a-1234`: `line-break:auto` gives 2 lines (`a-` | `1234`); `line-break:strict` (no lang) gives 1 line.
18. **Intl.Segmenter grapheme matches libicucore.** For `"👨‍👩‍👧 🇯🇵🇯🇵"` (U+1F468 U+200D U+1F469 U+200D U+1F467, space, two JP flags), Safari's `Intl.Segmenter(undefined, {granularity: "grapheme"})` segment starts are [0, 8, 9, 13]. That matches libicucore's UBRK_CHARACTER boundaries [0, 8, 9, 13, 17] in `data/webkit/icu-macos27-libicucore/probes.tsv`, row `character|zh-Hans-US|default`, sample 14.
19. **U+2028 is a forced break.** `<div style="font:16px Menlo;width:500px">ab&#x2028;cd</div>` gives 2 lines under `white-space: normal` (`L/InlineItemsBuilder.cpp:954-960`).

---

# (g) Differences from the groundwork (verified)

The groundwork was `pretext-emulation-20260915/research/webkit-source.md`, SAFARI = safari-7624.2.5.11-branch `7c696f5732`.

1. **`BreakablePositions.h` changed at 7625** (full diff in scratch; the classify diff is in the data): 
   - `kPi`/`kPf` subclasses, so U+00AB/U+2018/U+201C are QU|Pi and U+00BB/U+2019/U+201D are QU|Pf (`:93-94, :393-396, :475-478`);
   - a local LB19a rule, break before Pi or after Pf next to ID (`:214-220`);
   - U+2028 and U+2029 as breakable spaces (`:131-132`);
   - keep-all breaks after Ps/Pe/Pi/Pf/Po on 16-bit text (`:268-271, :297-298`).
   
   The groundwork listed all four as MAIN-only. U+201C and U+201D were Weird in SAFARI; the other classes are unchanged.
2. **Pair table unchanged.** 1,547 breakable pairs; rows byte-identical to `oracle/webkit/linebreak_table.inc`. `BreakablePositions.cpp` is identical to SAFARI.
3. **Apple libicucore overrides quote categories per locale in code** (§2.6). The groundwork's §1.7 said there was no Apple quote patch. That holds for the rule text, which equals upstream, but not for behaviour. The groundwork's runtime data mentions "quote remaps" (NOTES.md:289). The mechanism is now tied to `AppleICU76/rbbi.cpp:397-486` and matched 1,704,960 probes on 78.1.
4. **macOS 27 libicucore** is 78.1, Unicode 17.0, CLDR 48.0. The groundwork's compiled probes (`oracle/webkit/build/defaultprobe`) produce byte-identical output on macOS 27 for all four default locales (`data/webkit/icu-comparison/groundwork-probes-rerun-macos27/`).
5. **Apple's line tables equal upstream 78.3 except Apple PUA properties** (U+F7F0–U+F8FF), and so does the character table. The word table differs (colon removed from MidLetter).
6. **The glyph geometry cache replaced the width cache for `FontCascade::width`** (`G/FontCascade.cpp:319-352`). The groundwork said Canvas bypasses the cache because it passes a `GlyphOverflow`; now the cache stores `glyphOverflow` too. The maximum text length is 64 (`G/TextMeasurementCache.h:57`), not 16.
7. **`TextUtil::width` for preserved single spaces** now tests `to - from == 1` (`L/text/TextUtil.cpp:118`). The SAFARI `from - to` bug is gone.
8. **ZWNJ on the complex path** is deleted with 0 width (`G/ComplexTextController.cpp:755-761`).
9. **New line numbers**:
   - `measureTextInternal` `C/CanvasRenderingContext2DBase.cpp:3064-3106` (was 3004-3042);
   - `normalizeSpaces` `:2847-2875` (was 2830-2852);
   - spacing setters `:3271-3325` (was 3207-3261);
   - OffscreenCanvas `setFont` `:93-130`;
   - element canvas description copy `C/CanvasRenderingContext2D.cpp:236-244` (was 205-212);
   - `FontCascade` constructor ligature reset `G/FontCascade.cpp:81` (was :74);
   - `computeEnableKerning` `G/FontCascade.h:294-311`.
10. **Han swap locale on this Mac is `zh-CN`**, because `CFBundle` localization mapping runs when languages can't be minimized. The groundwork oracle defaulted to `zh-Hans-US`. It does not change break data, but it is the shaping and fallback locale for DOM text under `lang=zh`.
11. **`LocaleToScriptMapping.cpp`** tables are identical to the groundwork's copy (only `std::to_array` became `WTF::toArray`). `TextBreakIterator*.h/.cpp` differ from SAFARI only by annotations (`LIFETIME_BOUND`, `NODELETE`, `FillWith`).
12. **`resolveForUnresolvedFont`** at 7625 still ignores `font-stretch` (`UnresolvedFont::width`). The groundwork's description (family, style, caps, weight, size only) was correct.

# Data directory (`~/github/pretext-rebuild/rebuild/data/webkit/`)

- `tools/build.sh`: builds everything and reruns the dumps; the products go to scratch.
- `tools/icu_brk_dump.c`: the WebKit-exact `ubrk_open` sequence plus `ubrk_getBinaryRules` and the manifest.
- `tools/gen_break_tables.py`: a harness built from verbatim `classify` and the pair table.
- `tools/rbbi_sections.py`: splits RBBI data and extracts rule source.
- `tools/icu_quote_probe.c`: the override emulation check.
- `tools/icu_delimiters.c`: CLDR delimiters.
- `tools/icu_table_equivalence.c`: fuzz equivalence of two tables.
- `tools/zh_locale_probe.m`: the Han swap locale.
- `icu-macos27-libicucore/`:
  - `manifest.json` and `manifest.tsv` (config, opened locale, fallback, status, actual/valid locale, size, sha256, round trip, WebKit call site);
  - `brk/<sha256>.brk` (9 files);
  - `probes.tsv`, `rules/<sha256>.txt`, `sections.tsv`;
  - `delimiters.tsv`, `quote-probe.tsv`;
  - `unicode-properties-vs-upstream78.3.diff`, `table-equivalence-vs-upstream78.3.txt`.
- `breakable-positions/`: `classify.tsv`, `linebreak-table-pairs.tsv`, `linebreak_table.inc`, `keepall-punctuation-bmp.tsv`.
- `icu-comparison/`: Homebrew icu4c 76.1, 77.1 and 78.3 manifests; the `LANG=zh_CN` manifest; groundwork probe reruns.
- `FILES.tsv`: path, size and sha256 for every data file.

# Open questions

- The ICU default locale (`uloc_getDefault`) inside Safari's WebContent process. It decides the quote overrides and resource fallback for pages without `lang` and for unknown languages. On this Mac both candidates give the same results.
- Whether HTML-parser text nodes whose characters are all Latin-1 are stored 8-bit. This decides the keep-all punctuation breaks (H14).
- Whether `USE(CLUSTER_AWARE_WIDTH_ITERATOR)` is on for Cocoa. It is not defined in `PlatformUse.h` or `PlatformHave.h`, and other headers were not checked.
- The DOM computed font size under page zoom and CSS `zoom` was not read at this tag (H9).
- Dictionary/LSTM line breaking for Thai, Lao, Khmer and Myanmar inside libicucore: its data version and parity with upstream 78.3 beyond one sample.
- Whether the shared glyph geometry cache can hand a DOM simplified-path width to Canvas (H16).
