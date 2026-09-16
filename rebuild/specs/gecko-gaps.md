# Gecko gaps (Firefox 156.0): readings for CRITIC §5 items 5, 8, 10 and 14, plus four extra topics

Topic: the Gecko readings that `CRITIC.md` §5 lists as missing, read from the pinned source. Covered:

- item 5, DOM glyph X rounding;
- item 8 (Gecko parts): `SpaceMayParticipateInShaping` and U+2010 coverage;
- item 10: the `BuildTextRuns` partial rescan, and `trak`+`STAT` tracking;
- item 14 (Gecko part): whitespace-only frames and 8-bit text storage;
- extra: the order of `text-transform` and break detection, the language Firefox uses without `lang` on macOS, and how
  CSS lengths and font sizes become app units.

No browser was launched. §10 lists probes to run in installed Firefox.

## 0. Sources, labels, terms

- Source: `~/github/browser-engines/firefox-156.0`, tag `FIREFOX_156_0_RELEASE`, commit `3bf8f468`. Every
  `path:line` below is at that commit.
  - Files outside the sparse checkout were read with `git show FIREFOX_156_0_RELEASE:<path>`, so their line numbers
    are the tag's: `intl/locale/*`, `parser/html/nsHtml5TreeOperation.cpp`, `xpcom/ds/nsMathUtils.h`,
    `third_party/rust/app_units/src/app_unit.rs`, `gfx/harfbuzz/src/*`.
- Labels:
  - **[V]**: read in the source at the tag.
  - **[I]**: inferred from code that was read, without running it.
  - **[P]**: computed offline from the macOS 27 font files with the Gecko formulas.
    - Scripts (stdlib Python, scratch):
      `/private/tmp/claude-501/-Users-chenglou-github-pretext/7e07dee5-fc27-4046-b679-3f61a43f7436/scratchpad/{fontfacts,spacepairs,kernAA,trak,units}.py`.
- Terms:
  - **au**: app unit, 1/60 CSS px.
  - **apd**: app units per device pixel: 60 at DPR 1, 30 at DPR 2.
  - **text run**: one shaped string, possibly covering several text frames.
  - **word cache**: Gecko shapes a run word by word, splitting at U+0020 and NBSP. Spaces then get a fixed glyph
    width and are not shaped with their neighbors.
  - **kRoundX**: the shaper flag that rounds inline advances to whole device pixels.
  - **explicit language**: the `lang` or `xml:lang` attribute set on the element or an ancestor
    (`nsStyleFont::mExplicitLanguage`).

## 1. Answers in one table

| Question | Answer | Where |
|---|---|---|
| Does DOM text get `kRoundX` on macOS? | No. Every layout text run is built against a Skia draw target, which has no Cairo context, so only `kRoundY` is set. Advances are `floor(apd/65536 × advance16.16 + 0.5)` au and don't snap to device pixels at DPR 2. [V] | §2 |
| Which macOS fonts make spaces take part in shaping? | Only fonts with GSUB/GPOS lookups that touch the space glyph. With `font-kerning: auto` (the default) Latin text in Georgia, Arial, Times New Roman, Verdana, Helvetica and similar is still shaped word by word. `font-kerning: normal`, any `font-feature-settings`, Hebrew runs in Arial/Times New Roman/Courier New, and some CJK fonts switch to whole-run shaping. [V rule, P fonts] | §3.1-§3.4 |
| Can Canvas tell? | Canvas runs the same decision. A whole-string `measureText` already includes cross-space kerning; a per-word sum doesn't. | §3.5 |
| U+2010 coverage | Doesn't need to be observed. `measureText("‐")` gives exactly the DOM hyphen advance whether or not the primary font has U+2010. [V] | §3.6 |
| Break detection vs `text-transform` | Gecko finds breaks on the white-space-processed text **before** `text-transform`, then copies each flag to the transformed characters. Extra characters (ß→SS) get no break. [V] | §4 |
| Language without `lang` on macOS | On a UTF-8 page with no `lang` and no Content-Language, the style language is the first macOS preferred language, lowercased (`zh-hans-us` on this Mac). That language reaches the ja/zh newline-removal rule, font lists and HarfBuzz `locl`. It does not reach the ICU4X line breaker, casing or hyphenation, which use only explicit `lang`. [V] | §5 |
| Whitespace-only frame suppression and 8-bit storage | Text from the parser or `textContent` that is only white space is always stored 8-bit, so suppression works. A whitespace-only node ends up 16-bit only if it is flagged as frequently modified, or if a node with RTL text was partially edited down to white space. [V] | §6 |
| CSS lengths to au | `NS_lroundf(f32(px) × 60f)` (round half away from zero in float32). Percentages truncate `f32(basis_au × pct)`. Border widths floor to device pixels. Font size is on the same 1/60 px grid. [V] | §7 |
| Partial rescan | Initial layout scans the whole inline run of a block [I]. A later rescan starts a fresh line breaker, which drops a **sticky** Chinese/Japanese flag that unlabeled words inherit from earlier `lang=zh/ja` words. [V] | §8.1 |
| `trak` + `STAT` | Both apply. HarfBuzz adds tracking at a fixed 12pt, and Gecko adds its own at the CSS size. Canvas totals include both. SF's 12pt value is 0; New York's is +12/2048 em. [V, P] | §8.2 |

---

## 2. CRITIC item 5: DOM glyph X rounding (settles C8)

### 2.1 Which draw target layout text runs use [V]

1. **Reflow.**
   - `PresShell::DoReflow` creates `rcx = CreateReferenceRenderingContext()` and gives it to the root `ReflowInput`
     (`layout/base/PresShell.cpp:10763`, `:10791`).
   - The line layout passes `psd->mReflowInput->mRenderingContext->GetDrawTarget()` into `nsTextFrame::ReflowText`
     (`layout/generic/nsLineLayout.cpp:866-868`).
   - `ReflowText` passes it to `EnsureTextRun` (`layout/generic/nsTextFrame.cpp:10974`, `:11033`, `:11045`).
2. **Every other caller** passes no target and gets `CreateReferenceDrawTarget` (`nsTextFrame.cpp:2321-2327`,
   `:3209-3218`). The hyphen text run and the property provider use the same helper (`:2329-2335`, `:3534-3537`).
3. **The reference context.**
   - For a screen pres context it is a `gfxContext` over `gfxPlatform::ScreenReferenceDrawTarget()`
     (`PresShell.cpp:3178-3182`).
   - Printing uses the print target's reference draw target instead (`:3184-3188`; `gfx/src/nsDeviceContext.cpp:127-158`,
     which also sets `sDisablePixelSnapping` at `:158`). Printing is out of scope.
4. **That draw target** is created once at startup with `CreateOffscreenContentDrawTarget(1×1)`
   (`gfx/thebes/gfxPlatform.cpp:1006-1008`; getter `:2338-2344`), using `mContentBackend` (`:1736-1740`).
5. **On macOS the content backend is Skia only.**
   - `gfxPlatformMac::GetBackendPrefs` sets the content bitmask and default to `SKIA` (`gfx/thebes/gfxPlatformMac.cpp:118-125`).
   - `InitBackendPrefs` keeps only backends in that bitmask (`gfxPlatform.cpp:1947-1955`, `:1989-2006`), and the pref
     is `gfx.content.azure.backends = "skia"` (`modules/libpref/init/all.js:399`).
   - Workers: `gfxPlatformWorker::ScreenReferenceDrawTarget` creates a Skia target
     (`gfx/thebes/gfxPlatformWorker.cpp:64-69`; `gfxPlatform.cpp:2346-2359`).

### 2.2 What `GetRoundOffsetsToPixels` returns on that target [V]

```ts
// gfx/thebes/gfxFont.cpp:1070-1107, specialized to macOS content
function roundOffsetsToPixels(dt): Flags {
  if (dt.transform.hasNonTranslation() || !font.shouldHintMetrics()) return 0; // :1076-1078; gfxMacFont keeps the
                                                                              // default true (gfxFont.h:1666)
  const cr = dt.getNativeSurface(CAIRO_CONTEXT);  // DrawTargetSkia returns nullptr (gfx/2d/DrawTargetSkia.cpp:2093-2095)
  // cr is null, so the cairo hint-metrics switch (:1084-1100) is skipped
  return gfxMacFont.shouldRoundXOffset(cr)        // `aCairo && ...` is false for null (gfxMacFont.cpp:566-569)
       ? kRoundX | kRoundY : kRoundY;             // -> kRoundY (:1102-1106)
}
```

- The flags are read once per font run (`gfxFont.cpp:3719`) and for space glyphs (`gfx/thebes/gfxTextRun.cpp:1573-1574`).
- In the HarfBuzz shaper, horizontal text rounds inline positions only if `kRoundX` is set
  (`gfxHarfBuzzShaper.cpp:1546-1552`). Without it:
  `advance = floor(hb2appUnits × i_advance + 0.5)`, `hb2appUnits = apd / 65536` (`:1559`, `:1700-1702`, `:1766-1769`).
- `kRoundY` rounds only block-direction offsets (`:1725-1737`), so it doesn't change widths.
- If the shared target ever had a scaling transform while a run was built, the flags would be 0 (`:1076-1077`). That
  still gives no X rounding.
- **Verdict [V]:** DOM text and Canvas text on macOS never snap glyph advances to device pixels. This settles CRITIC
  C8, and the untraced "main-thread `mScreenReferenceDrawTarget` backend" in gecko-canvas §1.6.

### 2.3 Worked examples, and what snapping would have looked like

Georgia, upem 2048: `a` = 1032 units, `b` = 1147, U+0020 = 494 [P].

`font: 16px Georgia`, DPR 2 (apd 30):

1. Font size: `NS_lroundf(16f × 60f) = 960 au`, so `960 / 30 = 32` device px (`gfx/src/nsFontMetrics.cpp:133-134`).
2. `mFUnitsConvFactor = f32(32 / 2048) = 0.015625`.
3. hmtx callback: `FloatToFixed(0.015625 × 1147) = 65536 × 17.921875 = 1,174,528` in 16.16 device px
   (`gfxHarfBuzzShaper.cpp:26`, `:378-379`).
4. Stored advance: `floor(30/65536 × 1,174,528 + 0.5) = floor(537.656 + 0.5) = 538 au`.
5. Counterfactual with `kRoundX`: `apd × FixedToIntRound(1,174,528) = 30 × 18 = 540 au` (`:31-32`, `:1693-1699`).
   A snapped advance is always a multiple of apd: 30 au (0.5 CSS px) at DPR 2, 60 au at DPR 1.

DPR 1 (apd 60): device size 16, `8.9609375 × 60 = 537.66`, so 538 au. The value doesn't depend on DPR.

| `bbb` in Georgia | per `b`, apd 60 and 30 | total | snapped, apd 30 | snapped, apd 60 |
|---|---|---|---|---|
| 13px | 437 | 1311 au = 21.85px | 1350 = 22.5px | 1260 = 21px |
| 15px | 504 | 1512 = 25.2px | 1530 = 25.5px | 1440 = 24px |
| 16px | 538 | 1614 = 26.9px | 1620 = 27px | 1620 = 27px |
| 17px | 571 | 1713 = 28.55px | 1710 = 28.5px | 1800 = 30px |
| 24px | 806 | 2418 = 40.3px | 2430 = 40.5px | 2340 = 39px |

- More totals [P]:
  - Georgia `aaaa bbbb` at 16px: 4320 au (72px) at both apd.
  - Arial `Hello world` at 16px: 4748 au (79.1333px) at both apd.
- **Correction to CRITIC §6 probe 2:** snapping would give multiples of 1/2 CSS px at DPR 2 (27px for `bbb`), not
  "multiples of 1/30 px". Per source, the probe should read 26.9px.

### 2.4 Things that do snap to device pixels in DOM layout

- A Unicode space character that no font covers gets `apd × floor(width + 0.5)` (`gfxTextRun.cpp:3032-3035`) [V].
- Border widths round down to whole device pixels, with a minimum of 1 device px (§7.4) [V].
- Apple Color Emoji advances are whole pixels, but Core Text produces that at the device size, not Gecko rounding
  (gecko-canvas §1.9).
- Tracking and synthetic bold add `NS_round(value × apd)` au: whole au, not device pixels (`gfxFont.cpp:901-905`) [V].

---

## 3. CRITIC item 8, Gecko: `SpaceMayParticipateInShaping` and U+2010

### 3.1 What the flag changes [V]

- `SplitAndInitTextRun` asks `SpaceMayParticipateInShaping(runScript)`. If true, and the font run is longer than 32
  characters or contains U+0020, the whole run is shaped without the word cache (`gfxFont.cpp:3747-3763`).
  - `ShapeTextWithoutWordCache` splits only at invalid characters such as controls, TAB and LF (`:3633-3680`).
  - Spaces are then shaped together with their neighbors, so lookups that involve the space glyph apply: kerning
    pairs, contextual substitutions and marks.
- Otherwise words split at U+0020 and NBSP, and each U+0020 gets a simple glyph of `NS_lroundf(spaceWidth × apd)`
  (`gfxTextRun.cpp:1602-1603`).
- **[P]** For Arial and Georgia at 10-40px in 0.25px steps (apd 60 and 30), the shaped space advance equals the simple
  glyph advance. The flag's visible effect is the lookups, not a different space rounding.

### 3.2 The decision, port target [V]

```ts
// gfx/thebes/gfxFont.cpp:1550-1596
function spaceMayParticipateInShaping(font, runScript): boolean {
  const e = font.entry;
  if (e.skipDefaultFeatureSpaceCheck &&              // :1553; set only by the FreeType font list
      !font.kerningSet &&                            // (gfxFT2FontList.cpp:1446, :1726), so never on macOS
      font.style.featureSettings.length === 0 && e.featureSettings.length === 0) return false;
  if (graphiteEnabled && font.canSupportGraphite) return e.hasGraphiteSpaceContextuals;   // :1560-1565
  const f = e.spaceFeatures ?? checkForFeaturesInvolvingSpace(font);                      // :1571-1575
  if (!f.hasFeatures) return false;
  if (hasSubstitutionRulesWithSpaceLookups(font, runScript) || f.nonKerning) return true; // :1584-1587
  if (font.kerningSet && f.kerning) return font.kerningEnabled;                           // :1591-1593
  return false;
}
// :1521-1548
function hasSubstitutionRulesWithSpaceLookups(font, s) {
  const e = font.entry;
  if (e.defaultSub.has(COMMON) || e.defaultSub.has(s)) return true;
  return (e.nonDefaultSub.has(COMMON) || e.nonDefaultSub.has(s)) &&
         (font.style.featureSettings.length > 0 || e.featureSettings.length > 0);
}
```

- **`checkForFeaturesInvolvingSpace`** (`gfxFont.cpp:1371-1519`):
  - For every GSUB script, collect the lookups of every language system (default, each language, required feature) and
    split them into "default features" and the rest. The default list is `abvf abvs akhn blwf blws calt ccmp cfar
    cjct clig fin2 fin3 fina half haln init isol liga ljmo locl ltra ltrm med2 medi mset nukt pref pres pstf psts
    rclt rlig rkrf rphf rtla rtlm tjmo vatu vert vjmo` (`:1349-1369`).
  - If the space glyph is in any collected lookup's glyph set, the script's default or non-default bit is set
    (`:1447-1466`, via `hb_ot_layout_lookup_collect_glyphs` in `HasLookupRuleWithGlyphByScript` from `:1223`).
  - If the DFLT script's default features touch the space, GPOS is skipped (`:1472-1478`).
  - Otherwise, the space in `kern` lookups sets `Kerning`, and in any other GPOS feature sets `NonKerning` (`:1481-1492`).
- **`kerningSet`** means the font style has a `kern` feature setting (`gfxFont.cpp:1032`, `:1754`).
  - `font-kerning: normal` appends `kern=1`, `none` appends `kern=0`, `auto` appends nothing (`gfx/src/nsFont.cpp:149-165`).
  - Canvas `fontKerning` does the same (gecko-canvas §1.2).
  - Consequence: `font-kerning: normal/none`, any `font-feature-settings` and `font-variant-*` features all make the
    feature list non-empty. That also switches on the non-default-substitution branch.

### 3.3 Installed macOS fonts [P]

My reader approximates `hb_ot_layout_lookup_collect_glyphs`: coverage tables, class definitions with a nonzero class,
and nested lookups. It can over-report for class-based context lookups.

| Font (file) | GSUB lookups touching the space | GPOS lookups touching the space | Latin text, `font-kerning: auto` | Latin text, `font-kerning: normal` | U+2010 |
|---|---|---|---|---|---|
| Georgia | none | none | word cache | word cache | missing |
| Arial | Hebrew default `ccmp` | `kern` (latn, grek, cyrl) | word cache | **whole run** | missing |
| Times New Roman | Hebrew default `ccmp` | none | word cache | word cache | missing |
| Courier New | Hebrew default `ccmp` | none | word cache | word cache | missing |
| Verdana, Trebuchet MS | none | none | word cache | word cache | Trebuchet: same glyph as `-` |
| Avenir Next (face 0) | none | `kern` (latn) | word cache | **whole run** | missing |
| SF (`SFNS.ttf`, `system-ui`) | non-default feature (tag read as `appl`) in DFLT/latn/grek/cyrl | none | word cache | **whole run** (feature list non-empty) | same glyph as `-` |
| New York (`NewYork.ttf`) | none | `kern` (DFLT, latn) | word cache | **whole run** | same glyph as `-` |
| Hiragino Sans GB | non-default `aalt fwid hwid vrt2` | none | word cache | **whole run** | own glyph, advance 1000/1000 em; `-` is 358/1000 |
| Helvetica, Helvetica Neue, Menlo, Monaco, Lucida Grande, Palatino, Optima | no GSUB/GPOS (`morx` fonts) | none | word cache | word cache | Helvetica, Helvetica Neue, Menlo, Monaco, Lucida Grande: own glyph, same advance as `-`; Palatino, Optima: missing |

- Hebrew runs in Arial, Times New Roman and Courier New are always shaped as a whole run, because a default feature
  touches the space for that script.
- `morx`-only fonts never switch. Gecko doesn't examine their `kern`/`kerx`/`morx` tables here.

### 3.4 Arial cross-space kerning, worked [P]

Arial GPOS `kern` pairs with the space, in units of 1/2048 em:

| Pair | Value |
|---|---|
| space+A, A+space | −113 |
| space+T, T+space, space+Y, Y+space, P+space | −37 |
| L+space, ’+space | −76 |

HarfBuzz scales a pair value with `(v × mult + 32768) >> 16`, `mult = (scale << 16) / upem`
(`gfx/harfbuzz/src/hb-font.hh:1148`, `:1164-1165`). It adds the value to the **first** glyph of the pair.

`A A` at 16px (A = 1366 units = 640 au, space = 569 units = 267 au). The same integers come out at apd 60 and 30:

| `font-kerning` | Shaping | Width |
|---|---|---|
| `auto` or `none` | word cache: 640 + 267 + 640 | 1547 au = 25.7833px |
| `normal` | whole run: A' = 587, space' = 214, A = 640 | 1441 au = 24.0167px (−106 au) |

At 24px: 2320 au vs 2162 au.

### 3.5 What Canvas can supply, and port options

- **[V]** Canvas `measureText` goes through the same `SplitAndInitTextRun`, the same flag and the same word cache
  (gecko-canvas §1.5). A total for a whole string already includes cross-space effects, for the same font, script and
  `fontKerning`.
- **Detection [I]:** `W("A A") − 2·W("A") − W(" ")` ≠ 0 shows active cross-space lookups for that font and settings.
  Zero for one sample doesn't prove the flag is off. `W(" ")` is the single-space run, which always uses the simple
  glyph (`gfxTextRun.cpp:2498-2500`).
- **Where DOM lines differ from per-word sums when the flag is on [I]:**
  1. Inside a line, the word+space and space+word pair adjustments.
  2. At a line end. The pair value sits on the left glyph, so the last glyph of line 1 keeps its A+space adjustment
     even though the trailing space is trimmed. The trimmed space's own advance includes the space+next-word pair.
     Example: `…A` + space + `A…` broken after the space. Line 1 is 113/2048 em narrower than `W("…A")`.
- **Port options [I]** (for the design agents to choose):
  1. **Pair kerning** (the Arial/New York/Avenir `font-kerning: normal` case): take a word's contribution as
     `W(word + " ") − W(" ")`, and the space's as `W(" " + nextFirstCluster) − W(nextFirstCluster)`.
  2. **Contextual substitutions** (Hebrew `ccmp` touching the space): per-segment totals can't rebuild those; measure
     whole runs, or accept the loss.
  3. Keep the default (`font-kerning: auto`, no feature settings) on the per-word path. None of the listed Latin fonts
     switch there.

### 3.6 U+2010: the DOM hyphen width equals `measureText("‐")` [V]

- **DOM:** with `hyphenate-character: auto`, a soft-hyphen or `hyphens: auto` break draws
  `gfxFontGroup::MakeHyphenTextRun` (`nsTextFrame.cpp:2351-2352`; width cached at `gfxTextRun.cpp:2476-2488`).
  - It asks `GetFirstValidFont(U+2010)`. That walks the family list for the first font whose cmap has U+2010
    (`gfxTextRun.cpp:2277-2360`).
  - If that font has the character, it builds a normal text run of U+2010; otherwise a text run of `-` (`:2458-2474`).
- **Font matching for U+2010** (DOM hyphen run and Canvas alike): `FindFontForChar` keeps the first font if it has
  U+2010 **or** `-` (`gfxTextRun.cpp:3227-3229`, `:3278-3284`). HarfBuzz maps a missing U+2010 or U+2011 to the `-`
  glyph (`gfxHarfBuzzShaper.cpp:119-125`).
- **Result:** `measureText("‐")` gives the primary font's U+2010 advance if it has one, else its `-` advance.
  That is the DOM hyphen advance in both cases. Add letter spacing per gecko-lines §4.6. No coverage test is needed.
  - Exceptions [I]: a primary font with neither U+2010 nor `-`, or a family list where a later font has U+2010 and
    the first lacks `-`.
- **[P] Where U+2010 differs from `-`:** Hiragino Sans GB, U+2010 = 1000/1000 em vs `-` = 358/1000.
  - A `16px 'Hiragino Sans GB'` hyphen is 16px (960 au), not 5.73px. Measuring `-` would be wrong for this font in
    Firefox.
  - Georgia: `-` = 766 units, so the hyphen is 359 au = 5.9833px at 16px.

---

## 4. `text-transform` and break detection (CRITIC C14) [V]

### 4.1 Pipeline

1. **White space first.** `BuildTextRunForFrames` transforms each mapped flow's white space into `textPtr`
   (`nsTextFrame.cpp:2495-2550`).
2. **Transformed run from untransformed text.** With any `text-transform`, it creates an `nsCaseTransformTextRunFactory`
   (`:2624-2636`). The text run is built from the white-space-processed, **not** case-transformed text
   (`:2723-2745`), and the `nsTransformedTextRun` keeps that string.
3. **Line breaker on the same text.** `SetupBreakSinksForTextRun(textRun, textPtr)` (`:2758`) feeds that same text to
   `nsLineBreaker::AppendText` (`:2982-2992`).
4. **Flags land on the untransformed run.** `BreakSink::SetBreaks` stores the flags on the transformed run
   (`:1227-1235`). That marks it for rebuild (`nsTextRunTransformations.cpp:74-80`). `BreakSink::Finish` then runs
   `FinishSettingProperties` → `RebuildTextRun` (`nsTextFrame.cpp:1249-1255`; `nsTextRunTransformations.h:169-174`).
5. **Rebuild copies flags forward.** `RebuildTextRun` (`nsTextRunTransformations.cpp:900-967`) calls
   `TransformString`:
   - Each output character copies its source character's break flag (`:852-855`).
   - Extra characters from an expansion (ß → SS) get `FLAG_BREAK_TYPE_NONE` (`:880-886`).
   - After a deleted Irish-casing hyphen, the next break is inhibited (`:648-651`).
   - The child run receives the array (`:943-946`).
   - Glyph data is copied back with the **destination's** break flags kept (`gfxTextRun.cpp:1482-1500`).
6. **Emergency-wrap after hyphen** (`nsTransformedTextRun::SetEmergencyWrapPositions`) also runs on the pre-transform
   string (`nsTextRunTransformations.cpp:83-100`, called from the constructor at `nsTextRunTransformations.h:206`).

```ts
// port target
const ws = whiteSpaceTransform(node.text, style);         // per mapped flow
const breaks = lineBreaker(ws, style);                    // ICU4X classes of the PRE-transform characters
const { text: shown, srcIndex, isExtra } = applyTextTransform(ws, style);  // uppercase, full-width, full-size-kana, ...
const flags = shown.map((_, j) => isExtra[j] ? NONE : breaks[srcIndex[j]]);
const widths = shape(shown);                              // widths come from the transformed glyphs
```

### 4.2 Examples

1. **`text-transform: full-width`, text `ab`, width 1px.**
   - Gecko breaks `ab` (AL AL: no break) and stays on 1 line, painting `ａｂ` at full-width advances.
   - An engine that breaks the transformed text sees `ａｂ` (ID ID) and can break.
2. **`text-transform: full-size-kana`, text `あぁ`.**
   - Gecko classifies `ぁ` U+3041 as CJ. `line-break: auto` maps to Strict (gecko-canvas §4.3), so there is no break
     before it.
   - The painted text is `ああ`, which breaks as ID ID elsewhere.
3. **`text-transform: uppercase`, text `straße`.** Painted as `STRASSE`; the added `S` never gets a break flag.

---

## 5. The language Firefox uses without `lang` on macOS [V unless marked]

### 5.1 Where it comes from

1. **Initial style language.** `nsStyleFont.mLanguage = Document::GetLanguageForStyle()`
   (`layout/style/nsStyleStruct.cpp:226`). That is the Content-Language (HTTP header or `<meta http-equiv>`, a single
   tag only), else `mLanguageFromCharset` (`dom/base/Document.cpp:20819-20835`).
2. **From the encoding.** `mLanguageFromCharset = EncodingToLang::Lookup(document encoding)`
   (`Document.cpp:20847-20855`, called at `:1650`, `:7521`).
   - UTF-8, UTF-16 and x-user-defined map to `nullptr` (`intl/locale/EncodingsByFrequency.inc:5-6`, `:11`).
     `EncodingToLang::Initialize` replaces `nullptr` with `GetLocaleLanguage()` (`intl/locale/EncodingToLang.cpp:52-61`).
   - windows-1252 → `x-western`, Shift_JIS → `ja`, GBK → `zh-CN`.
3. **The locale language.** `nsLanguageAtomService::GetLocaleLanguage()` takes the first regional-prefs locale,
   lowercased, as an atom (`intl/locale/nsLanguageAtomService.cpp:107-138`).
   - On macOS, regional prefs are the system locales (`intl/locale/mac/OSPreferences_mac.cpp:59-63`), read from
     `CFLocaleCopyPreferredLanguages` and canonicalized (`:31-57`; `intl/locale/OSPreferences.cpp:412-428`, `:445-459`).
     If that fails the fallback is `en-US` (`OSPreferences.cpp:423-427`).
   - This Mac: `defaults read -g AppleLanguages` = `("zh-Hans-US", "en-US")`, so the atom is `zh-hans-us` [I].
     Whether a sandboxed content process reads the same list is unverified; see the TODO at `OSPreferences.cpp:60-65`.
4. **Not explicit.** `mExplicitLanguage` stays false (`nsStyleStruct.h:175`) until `lang` sets `-x-lang`
   (`servo/components/style/properties/gecko.mako.rs:721-727`).
5. **Font metrics.** Font metrics get `styleFont->mLanguage` (`layout/base/nsLayoutUtils.cpp:3983-3984`).
   `nsFontCache` substitutes the locale language when that is empty (`gfx/src/nsFontCache.cpp:34-37`, `:64-66`).
6. **Canvas.** An OffscreenCanvas with no `ctx.lang` and no root `lang` uses the same `GetLocaleLanguage()`
   (gecko-canvas §1.2 C3).

### 5.2 Rules the no-lang language changes

1. **Newline removal in collapse modes.**
   - `langIsJapaneseOrChinese` is true when the language starts with `ja` or `zh` followed by the end or `-`
     (`layout/generic/nsTextFrameUtils.cpp:273-284`). The language comes from the frame's style
     (`nsTextFrame.cpp:2495`), including the locale fallback.
   - A newline is then removed if either neighbor is East Asian punctuation: East Asian Width F/W/H **and** general
     category P (except ₩), or U+FF5E or U+3000 (`nsTextFrameUtils.cpp:133-139`;
     `intl/unicharutil/util/nsUnicharUtils.cpp:506-523`).
   - Only for 16-bit text (`nsTextFrameUtils.cpp:98`).
   - Example, UTF-8 page, no `lang`, on this Mac: `你好。` newline `abc` becomes `你好。abc`. With `<html lang="en">` it
     is `你好。 abc`.
2. **Generic font lists and the default generic.**
   - The font group uses `mLanguage` (`gfxTextRun.cpp:1962`, `:1971-1975`). `zh-hans-us` has script Hans, so it maps to
     the zh-CN group (`nsLanguageAtomService.cpp:201-234`, `:59`).
   - macOS prefs (`all.js`, `#ifdef XP_MACOSX` from `:2337`):

     | Pref | x-western | zh-CN |
     |---|---|---|
     | serif list | `Times, Times New Roman` (`:2467`) | `Times New Roman, Songti SC, STSong, Heiti SC` (`:2473`) |
     | sans-serif list | `Helvetica, Arial` (`:2468`) | `Arial, PingFang SC, STHeiti, Heiti SC` (`:2474`) |
     | default generic | `serif` (`:2050`) | `sans-serif` (`:2055`) |

   - The initial font of a page without `font-family` comes from `GetFontPrefsForLang(mLanguageFromCharset)`
     (`nsStyleStruct.cpp:209-210`; `Document.cpp:20841-20845`).
3. **Script of Common/Inherited runs** (digits, punctuation): `ResolveScriptForLang(mLanguage)` gives Hans
   (`gfxTextRun.cpp:2581-2642`, `:2756`, `:2805`). This affects font matching and the HarfBuzz script.
4. **HarfBuzz buffer language**, which controls `locl` (`gfxHarfBuzzShaper.cpp:1470-1481`).

### 5.3 Rules only explicit `lang` changes

- **ICU4X line-break locale.** The line breaker gets `hyphenationLanguage = mExplicitLanguage ? mLanguage : null`
  (`nsTextFrame.cpp:2896-2899`). Only that sets the Chinese/Japanese flag (`dom/base/nsLineBreaker.cpp:652-690`),
  which picks the `zh` content locale (`intl/lwbrk/LineBreaker.cpp:70-76`, `:106`).
- **Language-specific casing** (tr, az, lt, el, nl, ga): `nsTextRunTransformations.cpp:358-359`.
- **Hyphenation dictionaries** (`nsLineBreaker.cpp:166-178` through the explicit language).
- **Fake small-caps language** (`gfxTextRun.cpp:2958`).

### 5.4 Consequence for the rebuild

- A page can't read the macOS preferred-language list. `navigator.languages` is Firefox's accept-language list, not
  the regional prefs [I].
- Probe pages must set `lang`. For unlabeled pages, the model needs one "no-lang language" input for newline removal
  and font lists, separate from the explicit language that the break iterator sees.

---

## 6. CRITIC item 14, Gecko: whitespace-only frames and 8-bit storage [V]

### 6.1 The suppression rule

- **No frame** when all of these hold (`layout/base/nsCSSFrameConstructor.cpp:5278-5287`):
  - the text is next to a line boundary (`AtLineBoundary`, `:5220-5256`);
  - white space isn't significant;
  - `item.IsWhitespace()`.
- `IsWhitespace` calls `TextIsOnlyWhitespace` (`:11195-11205`).
  - `ThreadSafeTextIsOnlyWhitespace` returns **false for any 16-bit buffer** (`dom/base/CharacterData.cpp:498-509`).
  - Otherwise every character must be SP, TAB, LF, CR or FF (`:539-573`; `dom/base/nsINode.h:75-81`). VT and NBSP don't
    count.

### 6.2 When text is stored 8-bit (`dom/base/CharacterDataBuffer.cpp`)

**`SetTo(text, force2b)`:**

| Input | Storage | Lines |
|---|---|---|
| one character < U+0100 | shared 8-bit string | `:235-242` |
| up to 1 + a few newlines + a few spaces or tabs | shared 8-bit string | `:247-282` |
| otherwise | 16-bit iff any character ≥ U+0100, or `force2b` | `:286-312` |

**`Append(text, force2b)`:**

| Current buffer | Result | Lines |
|---|---|---|
| empty | same as `SetTo` | `:358-361` |
| 16-bit | stays 16-bit | `:371-404` |
| 8-bit | becomes 16-bit iff the new text has a character ≥ U+0100 | `:413-436` |

### 6.3 Callers

- **HTML parser.**
  - First chunk: `text->SetText` → `SetTextInternal`, whole-replace branch →
    `SetTo(..., force2b = NS_MAYBE_MODIFIED_FREQUENTLY)` (`parser/html/nsHtml5TreeOperation.cpp:256-274`;
    `CharacterData.cpp:250-255`).
  - Later chunks: `AppendText` → `Append` (`nsHtml5TreeOperation.cpp:238-254`; `CharacterData.cpp:256-260`).
- **`textContent`:** `nsContentUtils::SetNodeTextContent` → `SetText(value, true)` → `SetTo`
  (`dom/base/nsContentUtils.cpp:7400`, `:7429`).
- **`insertData`/`deleteData`/`replaceData`** that don't replace everything:
  `SetTo(merged, false, use2b = NS_MAYBE_MODIFIED_FREQUENTLY || bidi)`. `bidi` is the old buffer's flag or RTL
  characters in the inserted text (`CharacterData.cpp:261-293`).

### 6.4 Answer

- A whitespace-only node built by the parser or `textContent` is always 8-bit, because all its characters are below
  U+0100. Suppression therefore depends only on the ASCII-whitespace test.
- The 16-bit exits:
  1. Nodes with `NS_MAYBE_MODIFIED_FREQUENTLY`. The comment says only anonymous nodes (`CharacterData.cpp:504-507`).
  2. A node whose buffer had the bidi flag and was then partially edited to white space. Example:
     `t.data = "א "; t.deleteData(0, 1)` leaves `" "` stored 16-bit. If a frame exists it stays: character data
     changes re-check whitespace with the same function [I].
- **Width effect [I]:** usually none. A collapsible space next to a line boundary is trimmed or collapses to zero width.
  The frame's existence can still change text-run continuation and range rectangles.

---

## 7. CSS lengths and font sizes to app units [V]

### 7.1 Lengths

- Servo keeps a length as float32 CSS px, multiplied by the `zoom` property at computed time
  (`servo/components/style/values/specified/length.rs:948`; `values/computed/length.rs:127`; `values/computed/box.rs:248`).
- `StyleCSSPixelLength::ToAppUnits` = `NSToIntRound(f32(px) × 60f)` with clamping
  (`layout/style/ServoStyleConstsInlines.h:584-603`). `NSToIntRound(float)` is `NS_lroundf` = `int32(x + 0.5f)` for
  x ≥ 0 (`gfx/src/nsCoord.h:296`; `xpcom/ds/nsMathUtils.h:31-33`).
- A plain length in `width` resolves through `LengthPercentage::ToLength()` (`ServoStyleConstsInlines.h:725-728`,
  `:802-805`).

```ts
const auFromPx = (px) => { const l = Math.fround(Math.fround(px) * 60); return Math.trunc(Math.fround(l + 0.5)); };
```

| CSS value | f32(px) × 60 in float32 | au | px shown by `getBoundingClientRect` [I] |
|---|---|---|---|
| `57.3px` | 3438.0 | 3438 | 57.3 |
| `86.38px` | 5182.7998 | 5183 | 86.383333 |
| `100.025px` | 6001.5 | 6002 | 100.033333 |
| `33.325px` | 1999.5 | 2000 | 33.333333 |
| `16.0083333px` | 960.5 (double math gives 960.499998) | **961** | 16.016667 |

### 7.2 Percentages and `calc()`

- **Percentage:** `NSToCoordTruncClamped(f32(basis_au × pct))` truncates (`ServoStyleConstsInlines.h:580-582`, `:802-806`;
  `nsCoord.h:267-276`). Used for `width` by `nsIFrame::ComputeISizeValue` (`layout/generic/nsIFrame.cpp:7727-7742`)
  and for padding by `nsLayoutUtils::ComputeCBDependentValue` (`layout/base/nsLayoutUtils.h:1637-1644`).
  - 50% of 3001 au → 1500.5 → 1500 au.
  - 33.3% of 36000 au (600px) → 11988 au.
- **`calc()` with a percentage:** float32 CSS px `pct × f32(basis/60) + px`, then ×60 and truncate
  (`ServoStyleConstsInlines.h:767-772`). `calc(50% - 0.5px)` of 3000 au → 24.5px → 1470 au.
- **`box-sizing: border-box`** subtracts padding + border in au (`nsIFrame.cpp:7738-7741`).

### 7.3 Font size

- DOM: `size.ToAppUnits() / apd` device px (`gfx/src/nsFontMetrics.cpp:133-134`), so the size sits on the 1/60 px grid:

  | `font-size` | au | device px at DPR 2 |
  |---|---|---|
  | `13.33px` | 800 | 26.667 |
  | `13.375px` | 803 | 26.767 |
  | `14.4px` | 864 | — |
  | `16.8px` | 1008 | — |

- An OffscreenCanvas keeps 7 significant bits instead (gecko-canvas §1.2 C2). `13.375px` stays 13.375.
  - Georgia `bbbbbbbbbb`: DOM 4500 au = 75px; Canvas 4490 au = 74.8333px [P].

### 7.4 Border widths

- Rounded **down** to whole device pixels, with any non-zero value at least 1 device px
  (`servo/components/style/values/specified/border.rs:234-246`; same rule in `layout/style/nsStyleStruct.h:548-549`).

  | `border-width` | DPR 2 | DPR 1 |
  |---|---|---|
  | `1.3px` | 60 au = 1px | 60 au = 1px |
  | `0.3px` | 30 au = 0.5px | 60 au = 1px |
  | `2.9px` | 150 au = 2.5px | 120 au = 2px |

---

## 8. CRITIC item 10: the `BuildTextRuns` partial rescan, and `trak` + `STAT`

### 8.1 Partial rescan, sticky Chinese/Japanese flag, carried white-space bit

1. **Initial layout [I].**
   - When frames are constructed, a block puts consecutive inline frames into one line box
     (`layout/generic/nsBlockFrame.cpp:6895-6917`).
   - The first `EnsureTextRun` finds no earlier line (`nsTextFrame.cpp:1655-1658`), so it scans every frame of that
     line: the block's whole inline content.
2. **Later rescans** happen when a line's text runs are invalidated.
   - Gecko walks back to the last line where a text-run boundary follows line-breaker white space
     (`nsTextFrame.cpp:1633-1690`; `FindBoundaries` `:1433-1533`).
   - It rebuilds from there with a **new scanner and a new `nsLineBreaker`**.
   - Runs up to the first one containing line-breaker white space are built but not assigned, and their break sink is
     null (`:2771-2781`, `:2984`).
3. **Carried white-space bit [V code, I equivalence].** It is recomputed at every flush from the built run's trailing
   white space, including discarded runs (`nsTextFrame.cpp:1800-1807`). By the first kept run it matches a full scan.
4. **Sticky Chinese/Japanese flag [V].** `mScriptIsChineseOrJapanese`:
   - starts false for each `nsLineBreaker` (`nsLineBreaker.h:284`);
   - is set only for words with an explicit language, whose script resolves to Hans/Hant/Jpan/Hrkt
     (`nsLineBreaker.cpp:659-690`);
   - is reset only when a word mixes languages (`:652-656`), and `FlushCurrentWord` doesn't reset it (`:134-142`);
   - is updated only for words that continue across an `AppendText` call or reach the end of one (`:253`, `:385`). A
     word entirely inside one call uses the current value (`:345`, `:607`).

   So an unlabeled word after a `lang="zh"` word, in the same block scan, breaks with the `zh` ICU4X content locale.
   A partial rescan that starts later begins with false.
5. **What the `zh` locale changes in ICU4X** (`third_party/rust/icu_segmenter/src/line.rs`):
   - `line-break: normal` allows a break before U+301C 〜 and U+30A0 ゠ (`:1124-1127`).
   - `line-break: loose` also allows breaks before ・ ： ； ･ ‼ ⁇ ⁈ ⁉ ！ ？, before wide PO and after wide PR (`:720-778`).
   - `auto`/`strict` with `word-break: normal` don't use it (gecko-canvas §4.3).
6. **Example**, page without `lang`, `line-break: normal`, width 1px: `<span lang="zh">中</span> あ〜い`.
   - Full scan: `あ〜い` inherits the flag, so the lines are `中 | あ | 〜 | い`.
   - With `<span lang="en">`: `中 | あ〜 | い`.
7. **Port [I].**
   - The model needs a per-block, stateful `cj` flag that follows words with explicit `lang` and persists across
     unlabeled words. It is updated only at `AppendText` boundaries.
   - Dynamic edits may give different breaks than a fresh page (layout-history dependence). Probes must use fresh
     documents.

### 8.2 `trak` + `STAT`: both HarfBuzz and Gecko apply tracking [V]

- **HarfBuzz** sets `apply_trak` when the face has `trak` and `STAT` (`gfx/harfbuzz/src/hb-ot-shape.cc:216-221`) and
  applies it while positioning (`:288-291`).
  - Firefox's build doesn't disable this: `moz.build:124-133` defines no `HB_NO_STYLE`/`HB_NO_AAT`/`HB_LEAN`, and
    `hb-config.hh` defines `HB_NO_STYLE` only under `HB_LEAN` (`:58-93`).
  - Gecko sets only `ppem` and scale, never `ptem` (`gfxHarfBuzzShaper.cpp:1261-1263`). HarfBuzz therefore uses 12pt
    (`hb-aat-layout.hh:36`; `hb-aat-layout-trak-table.hh:194-203`, `:217-240`).
  - It adds `em_scalef(value of the normal track at 12)` to the first glyph of each grapheme.
- **Gecko** then adds its own tracking to each cluster: `TrackingForCSSPx(adjustedSize × apd/60) × factor`, stored as
  `NS_round(× apd)` au (`gfxFont.cpp:3516-3543`, `:901-905`; `gfxFontEntry.cpp:1073-1105`, linear interpolation by
  CSS px).
- **[P] Sizes:**
  - SF (`SFNS.ttf`): normal track at 12 = 0, so HarfBuzz adds nothing. `system-ui` isn't double-tracked.
  - New York (`NewYork.ttf`, sizes 4/6/8/12/20/36/…): normal track at 12 = **+12** units.
    - At 16px Gecko interpolates between 12→+12 and 20→−20 and gets −4 units. Net +8 units per cluster instead of −4.
    - At 20px: HarfBuzz +12, Gecko −20, net −8.
- **Canvas [V from same code path].** An OffscreenCanvas and DOM text use the same tracking size (s) and the same
  shaper, so Canvas totals include both trackings. No loss. A connected `<canvas>` at DPR 2 differs (gecko-canvas §1.10).

---

## 9. Corrections to earlier documents

| Document | Statement | Source says |
|---|---|---|
| CRITIC §6 probe 2 | snapped widths are "multiples of 1/30 px, e.g. 26.8667 or 26.9333" | snapping would give multiples of 30 au (0.5px) at DPR 2, e.g. 27px; source shows no snapping, so 26.9px (§2.3) |
| CRITIC C8; gecko-lines §2.5; gecko-canvas §1.6 | DOM X rounding inferred or untraced | no `kRoundX` on macOS, traced to the Skia content backend (§2) |
| gecko-lines §12 | "Which installed fonts use whole-run shaping?" | §3.3 |
| gecko-lines §2.6 / §12; gecko-canvas §7 item 2 | `trak`+`STAT` double tracking open | both apply (§8.2) |
| gecko-lines §12 | partial rescan effect not established | fresh layout scans the whole inline run [I]; rescans can drop the sticky `cj` flag (§8.1) |
| CRITIC §7 | no-lang `mLanguage` and the ja/zh newline rule unknown | UTF-8 pages use the OS preferred language for newline removal and fonts, but not for ICU4X (§5) |
| gecko-lines §3.3 | newline removal "for `ja`/`zh` language" | true, but "language" includes the OS-locale fallback on UTF-8 pages without `lang` (§5.2) |
| groundwork `results-gaps-both-answer.md:85-92` (Pretext measures `-`) | hyphen width = `W("-")` | in Firefox use `W("‐")`; differs for Hiragino Sans GB (§3.6) |

---

## 10. Probes for installed Firefox 156.0

Setup, unless a probe says otherwise:

- macOS 27, headed, Retina DPR 2, 100% zoom, a fresh tab per page.
- Page: `<!doctype html><meta charset="utf-8"><html lang="en">`.
- DOM widths: `getBoundingClientRect().width` of an inline `<span style="white-space:nowrap">`.
- Line counts: use `line-height: 20px` and read the block's height.

1. **No X rounding, DPR 2.** `font: 16px Georgia`, span `bbb`: width **26.9px** (1614 au). 27px would mean
   device-pixel snapping.
2. **No X rounding, other sizes.** Same span:
   - at 13px: **21.85px** (snapped would be 22.5px);
   - at 17px: **28.55px** (snapped 28.5px);
   - at 24px: **40.3px** (snapped 40.5px).
3. **DPR independence.** Move the window to a DPR 1 display and repeat probe 1: **26.9px**. `font: 16px Arial`, span
   `Hello world`: **79.133333px** at DPR 1 and DPR 2.
4. **Canvas agrees.** OffscreenCanvas, `ctx.font = '16px Georgia'`: `measureText("bbb").width` = **26.899999618530273**
   (float32 of 1614/60).
5. **Space participation, DOM.** `font: 16px Arial`, span `A A`:
   - `font-kerning: auto` → **25.783333px**;
   - `none` → **25.783333px**;
   - `normal` → **24.016667px**.
   - At 24px: 38.666667 / 38.666667 / **36.033333**.
6. **Space participation, Canvas.** OffscreenCanvas `16px Arial`, `measureText("A A").width`:
   - `fontKerning = 'auto'` → **25.783333**;
   - `'normal'` → **24.016666**.
   - `measureText("A").width` stays 10.666667 in both.
7. **No participation.** `font: 16px Georgia`, span `aaaa bbbb`: **72px** with `font-kerning` `auto`, `none` and
   `normal`.
8. **Hyphen width.** `<div style="width:60px;font:16px 'Hiragino Sans GB'"><span id=s>abcd&shy;efgh</span></div>`:
   `s.getClientRects()[0].width − (OffscreenCanvas '16px "Hiragino Sans GB"' measureText("abcd").width)` = **16px**
   (±1/60). `measureText("‐").width` = **16**.
   - Same page with `font: 16px Georgia`: difference **5.983333px**; `measureText("‐")` = `measureText("-")` =
     5.983333.
9. **Breaks before full-width transform.** `<div style="width:1px;line-height:20px;font:16px 'Hiragino Sans GB';text-transform:full-width">ab</div>`:
   height **20px** (1 line). Without the transform, with text `ａｂ`: **40px**.
10. **Breaks before full-size-kana transform.**
    `<div style="width:1px;line-height:20px;font:16px 'Hiragino Sans GB';text-transform:full-size-kana">あぁ</div>`:
    **20px**. Literal `ああ` without the transform: **40px**.
11. **No-lang newline rule (this Mac, preferred language zh-Hans-US).** Page **without** `lang` and without
    Content-Language: `<p style="font:16px 'Hiragino Sans GB'"><span id=s>你好。` newline `abc</span></p>`.
    - `s` width = OffscreenCanvas `measureText("你好。abc").width` (no space).
    - With `<html lang="en">`: width = `measureText("你好。 abc").width`.
    - After making English the primary macOS language and relaunching Firefox, the no-lang page shows the space.
12. **Encoding decides the no-lang language.** Same as probe 11, served with `<meta charset="windows-1252">` and the Han
    characters written as `&#20320;&#22909;&#12290;`: width includes the space (language `x-western`).
13. **The OS locale doesn't reach ICU4X.** Page without `lang`,
    `<div style="line-break:normal;width:1px;line-height:20px;font:16px 'Hiragino Sans GB'">あ〜い</div>`:
    **40px** (`あ〜 | い`). Add `lang="zh"` to the div: **60px** (`あ | 〜 | い`).
14. **Sticky Chinese/Japanese flag.** Page without `lang`, same div style, content
    `<span lang="zh">中</span> あ〜い`: **80px** (4 lines). With `<span lang="en">`: **60px** (3 lines).
15. **Words inside one text node keep the old flag [I, lower confidence].** Page without `lang`, same div style,
    content `<span lang="zh">中</span><span lang="en"> あ〜い x</span>`: **100px** (`中 | あ | 〜 | い | x`).
    With `lang="en"` on both spans: **80px**.
16. **Whitespace-only 16-bit node [I on rect semantics].** `<div id=d style="font:16px Georgia"><span>x</span></div>`.
    1. `t = document.createTextNode("א "); d.insertBefore(t, d.firstChild); t.deleteData(0, 1)`. Then
       `r = document.createRange(); r.selectNodeContents(t); r.getClientRects().length` → **1** (a frame exists).
    2. Repeat with `createTextNode("a ")` → **0**.
    3. `x`'s left edge is the same in both.
17. **Float32 rounding of lengths.** `<div id=o style="width:16.0083333px"><div id=i style="width:100%;height:1px"></div></div>`:
    `i.getBoundingClientRect().width` = **16.016667** (961 au), not 16.
    - `width:86.38px` → **86.383333**.
18. **Percentages truncate.** `<div style="width:50.01666px"><div id=c style="width:50%;height:1px"></div></div>`:
    `c` width **25px** (1500 au), not 25.008333.
19. **Border snapping.** `getComputedStyle(el).borderLeftWidth` for `border-left: 1.3px solid`:
    - **"1px"** at DPR 2 and DPR 1;
    - for `0.3px`: **"0.5px"** at DPR 2, **"1px"** at DPR 1.
20. **Font-size grid vs Canvas.** DOM `font: 13.375px Georgia`, span `bbbbbbbbbb`: **75px** (4500 au). OffscreenCanvas
    `'13.375px Georgia'`: `measureText` = **74.83333587646484** (4490 au).
21. **Double tracking [I on reaching the font].** If `font-family: ui-serif` resolves to New York in Firefox 156, take
    OffscreenCanvas `measureText("iiiiiiiiii")` minus `10 × hmtx(i) × s / 2048` (from `/System/Library/Fonts/NewYork.ttf`).
    - At s = 12px: **+0.1406px per `i`** (+24 units). Only one tracking would give +0.0703.
    - At s = 20px: **−0.078px per `i`** (−8 units). Only Gecko's would give −0.195.
22. **No-lang generic font list [I on the exact fonts].** Page without `lang` on this Mac: span `Hello world` in
    `font: 16px serif` has the same width as `<span lang="zh-CN" style="font:16px serif">` and a different width from
    `<span lang="en" style="font:16px serif">`. The zh-CN list starts with Times New Roman; x-western starts with Times.

## 11. Open questions

- Does a sandboxed macOS content process get the same `CFLocaleCopyPreferredLanguages` list as the parent (§5.1)?
  Probe 11 answers it for this Mac.
- My GSUB/GPOS glyph collection approximates HarfBuzz's. §3.3 is a prediction for fonts that use class-based context
  lookups (SF, Hiragino Sans GB).
- `ui-serif` and other `ui-*` generics on macOS were not traced. Probe 21 depends on them.
- Printing (`PrintTargetCG`/`PrintTargetSkPDF` reference targets, `sDisablePixelSnapping`) is out of scope.
- The Canvas-only detection of cross-space lookups (§3.5) covers pair kerning. There is no recipe yet for contextual
  substitutions that touch the space (Hebrew `ccmp` in Arial, Times New Roman and Courier New).
