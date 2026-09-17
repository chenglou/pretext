# Critique: the charter branch against rebuild/CHARTER.md (2026-09-17)

Adversarial pass over `rebuild-charter` at 49ab636 plus the uncommitted CHARTER.md/REPORT.md edits. Offline only: no browser ran, nothing edited. Paths are relative to `~/github/pretext-rebuild-charter`; scratch scripts are in the session scratchpad.

## 1. What I checked

| Check | Result |
|---|---|
| Grep of `rebuild/src` for `navigator.`, `document.`, `window.`, computed style, rect reads | Only `env.ts:90-104`: the user agent, `devicePixelRatio`, `<html lang>`. `paint.ts` builds DOM, as the painter should |
| Grep for `fillText`, `getImageData`, `FontFace`, `document.fonts`, `fetch(` | None. `blink/script.ts:115` `fetch()` is an iterator method |
| Grep for tolerance words, epsilons, `Math.abs`, thresholds | No tolerances in src. The `1/64` in `webkit/lines.ts:792,1259` is TOS:481-486 |
| Grep for font and character name lists | Keyword checks cite source: `blink/content.ts:85-87`, `webkit/content.ts:178-181,252`, `gecko/fonts.ts:9-23`. `lab/font-facts.ts:159` (Osaka-Mono, MS-PGothic, MonotypeCorsiva) is WebKit's own `Font::determinePitch` list. Exceptions in §3 |
| Re-score smoke forward against reverse, per browser (`score.ts --native-compare`) | Summary `browsers` and per-case files byte-identical to the recorded ones: Chrome 299, Firefox 297, webkit-host 300 |
| Recompute Blink and Gecko expected observations offline from recorded layouts (`observeBlink`, `observeGecko`, facts from `lab/font-facts.ts`) | Equal to the recorded observation on every row: Chrome smoke 299 and ws 1,019; Firefox smoke 297 and ws 1,019. The WebKit port measures with Canvas and can't be recomputed offline |
| Vertical-centre grouping, checked independently on smoke, ws, runs and policy in all three browsers (16,511 rows) | No gap between sorted rect centres reaches 1.5 line heights, so no native line lacks a rect with positive height. No group spans half a line height. `height / lineHeight` isn't an integer on 84 of about 300 smoke rows (taller fallback line boxes), so height can't stand in for the grouping |
| `bun test rebuild/src rebuild/lab rebuild/tests` | 370 pass, 0 fail |

## 2. Triage: 15 cases traced in raw rows

Rows come from `.artifacts/charter-20260916/triage/runs/<browser>/charter-file/`. Three cases per browser were picked at random, with seed 20260917, from outcomes other than the document's own examples.

| Case | Record says | What the rects and geometry show | Verdict |
|---|---|---|---|
| Chrome `c-00520dd17f45f4f9` | fact, ligature-cluster | ب+ِ is 7.81px. ل and ا are 9.61px each on native line 2: a lam-alef glyph split in halves. The charter's line 0 is [0,3), 1848 LU = 14.44px, cutting the ligature. **No gap on any line** | correct; a gap hole |
| Chrome `c-5fb03e7d0d0d46ec` (random) | fact, ligature-cluster | Native lines break between the لأ, لا, لإ and لآ pairs; the charter breaks inside them | correct |
| Chrome `c-9c5a66597ebf5aef` (required) | fact, zero-width line, charter only | Native has 3 lines: U+2060 and U+0301 share the middle line at width 0. The charter has 4, with separate items for U+2060 and U+0301, and U+0301's cluster advance is −524288 (−4px), a line of its own with a line box. UAX #29 breaks after U+2060 (Control), but HarfBuzz marks every Mn a continuation, so the engine's cluster is [1,3). Trace the break-anywhere offsets against the port's clusters | correct |
| Chrome `c-1267fee582f30f2c` | accidental, right count, wrong breaks | Native lines start at 0, 3, 4; main's at 0, 2, 4 | correct |
| Chrome `c-08ead50c71a1abcf` | accidental, zero-width elsewhere | Main puts SHY on line 0; native reports it on the middle line | correct by its rule (provisional) |
| Chrome `c-0ee9c6f260c7db47` | fact, `common-script-in-rtl-context` | Greek and Latin only. Native α, β, γ are 8.83 + 8.29 + 7.70 = 24.80px, which fits 26.5px. The charter's γ cluster is 1433403/65536 zoomed = 10.94px and its "(" 3.08px, against native 7.70 and 6.33: Canvas prefix differences moved 3.25px from "(" into γ. `script-context` and `in-word-prefix` are reported | outcome correct; **cause label wrong** |
| Chrome `c-ab42aa1d1701a85d` | fact, ui-language | Break before “ under Chrome's zh-CN table; `ui-language` reported. The document files it under "opinion dropped" | **record and document disagree** |
| Firefox `c-36ea31d4291b5fa8` | fact, zero-width line, native only | Native ب before SHY is 3.95px, plus the hyphen at 5.90px, = 9.85px > 8px, so the ZWSP stands alone. The charter's frame [1,3) is 443 au (7.38px) with ب at 89 au, where native is 237 au. That's the in-word advance, and the line reports `in-word-prefix` | outcome correct; **§3.2's "no gap names them" is wrong** |
| Firefox `c-082d325a50f8ca53` | fact, joined-arabic-width | `in-word-prefix` and `glyph-clusters` reported; native breaks at SHY, the charter doesn't | correct |
| Firefox `c-5dcc98f7ced15c60` (random) | fact, ligature-cluster | ل and ا on one native line; the charter splits them | correct |
| Firefox `c-0602eea230414116` (random) | accidental, right count, wrong breaks | Main starts line 2 at `i`; native at `f` | correct |
| webkit-host `c-0033f34a9d6b3f85` | fact, letter-spacing-ligatures | Native affini / ty; charter aff / init / y; gap reported | correct |
| webkit-host `c-7b043aadf7fa5d65` (random) | fact, letter-spacing-ligatures | Native ffif / flff / i; charter 2 lines; gap reported | correct |
| webkit-host `c-0774ff114d939edf` | fact, zero-width line, charter only | Native A / B; the charter makes a CR TAB line | correct by its rule |
| webkit-host `c-29e0ecea806e4608` (random) | accidental, right count, wrong breaks | Main's line 2 starts at 13; native at 11 | correct |

Problems in the method, from population files and tools:

1. **§3.2's gap claim is false.** Of the §3.2 facts:
   - Firefox: 82 charter-only cases and 66 native-only cases, all 148 reporting `in-word-prefix`;
   - Chrome: 74 charter-only cases (all `script-context`, 73 `in-word-prefix`) and 54 native-only cases (all `script-context`, 52 `unsafe-to-break`).

   The traced Firefox case is gecko audit D1, not a port bug. File Firefox's §3.2 under §3.8, and rule the named gaps out before calling any of these port bugs.
2. **"Facts to learn" mixes two kinds.** Most of these cases already report a named gap. Those that report none are the real holes:
   - Chrome 117: ligature-cluster 113, joined-arabic-width 2, joined-letters-edge 2;
   - Firefox 4: U+202F;
   - webkit-host 11: punctuation after another script.
3. **Causes are ordered text-shape checks** (`triage/tools/classify.py:40-80`). Of the named gaps, only `ui-language` and `letter-spacing-ligatures` decide a cause. The `common-script-in-rtl-context` branch fires on Greek or Devanagari with Latin punctuation.
4. **Records lack the "opinion dropped" outcome.** `analysis/chrome-triage.json` still records the two quote cases as "main right on count and visible breaks".

## 3. Deviations remaining, with file:line

**Tentpole 3: rules from source, facts as inputs with gaps**

1. `rebuild/src/engines/webkit/content.ts:233-249`: per-character coverage of the primary font is inferred from Canvas, `"P, LastResort"` against the plain context. The comment names the loss (a fallback glyph as wide as LastResort's box), but no gap is reported. Glyph coverage is one of the charter's examples of an explicit input. Only reached when `monospace` is true.
2. `rebuild/src/engines/gecko/prepare.ts:852-866`: which cluster Apple Color Emoji draws is inferred from width equality at two sizes. A text font with equal widths gives the wrong answer silently; `bitmap-emoji-size` (:903, :913) covers only the size grid.
3. `rebuild/src/measure/font.ts:4`: WebKit shapes at the CSS size times page zoom, "unverified: CRITIC.md W5". A rule with neither source nor verdict; the lab only runs at zoom 1.
4. Citations at Chromium 152 while the pin is 153:
   - `rebuild/src/engines/blink/shape.ts:191` (V8 4323497a);
   - `rebuild/src/engines/blink/content.ts:39` (element.cc);
   - `rebuild/src/breaks/rbbi.ts:5` (ICU vendored in 152);
   - the HarfBuzz cluster rules (Blink report, triage §3.1);
   - `lab/font-facts.json` generics (locale_settings_mac.grd).

   `~/github/browser-engines/chromium-153.0.8010.48` exists, but its v8 checkout lacks `string-slice.tq` and it has no `third_party/harfbuzz-ng`.
5. `rebuild/src/engines/blink/shape.ts:227`: `codes.length - substituted.length > 2`, fitted to probed strings. Registry heuristic `blink/measure/ignorables-left-out-if-8bit`.
6. `rebuild/src/engines/blink/shape.ts:330-364`: `wide-group-halved`, cut location invented (registry).
7. `rebuild/src/env.ts:91-94`: engine from user-agent patterns (registry `shared/env/engine-from-user-agent`).
8. `rebuild/src/engines/gecko/fonts.ts:133-137`: the `opticalSizeAxis` default compares the first family's name whatever its kind, so a quoted `"system-ui"` takes the keyword default. `fonts.ts:5-7` parses it as a named family, and Blink distinguishes quoting (`blink/content.ts:85-87`).
9. `rebuild/src/engines/webkit/content.ts:183-187, 523-531`: `familyNames` strips quotes, so a quoted `"system-ui"` or `"-webkit-standard"` counts as the keyword for `canvas-language`, against the file's own rule at :179-180.

**Tentpole 6: environment explicit**

10. `contentLanguage` (`rebuild/src/env.ts:25`, :43, :62) and `regionalPrefsLocale` (`env.ts:67`) are given facts that no engine reads: nothing in `rebuild/src` outside `env.ts` references them. DESIGN §1.4 says Content-Language is the root locale in all three engines. A caller that gives them gets no effect and no gap.
11. `rebuild/src/engines/gecko/prepare.ts:593`: `ui-language` is reported for every `lang=""` run even when the caller gives `regionalPrefsLocale`.
12. `rebuild/lab/predictor.ts:31-33`: the browser-process languages are given as null (already in CHARTER.md; costs Chrome 3 line counts and 9 breaks).

**Tentpole 2: observation ported, compared exactly**

13. `rebuild/lab/observe/gecko.ts:40` and :103-107: shaping-unit boundaries use a `\p{M}` stand-in for `IsClusterExtender`, and every frame's x on a line is marked limited once any frame there has a limited width. These states come from a conservative stand-in, not a ported rule, and they move values out of the predicted tally.
14. `rebuild/lab/score.ts:31-63` (centre grouping; my check found no counter-example) and `score.ts:111, 474-478, 495-499` (WebKit `contentWidth` unobserved, 503 cases). Both are in CHARTER.md.

**Tentpole 7: painter**

15. `rebuild/src/paint.ts:32, :164`: Blink's ASCII white-space set is used for all three engines. The registry's own note says WebKit excludes VT and Gecko has its own rule.
16. `rebuild/src/paint.ts:163` (`nowrap` on hyphen and joined lines, no source) and `paint.ts:209, :211` (U+200D, a choice by score that Firefox rows contradict). Both in the registry. The painter is scored by extents and wraps only (in CHARTER.md).

**Tentpoles 4 and 5: tests and gate**

17. `rebuild/lab/baselines/gate-{chrome-153.0.8010.48,firefox-156.0,webkit-22625.1.29.11.27}.json` are seeded from `suite-sample`, `heldout-suite-sample` (main-derived) and the burned held-out sets. `lab/gate.ts` blocks on any lost pair; `tests/gate.ts` makes main's corpus report-only. CHARTER.md lines 91-92 name these baselines without saying they block on main-derived cases.
18. `rebuild/tests/coverage.json`: 0 of 415 rules annotated in source; 110 current rules uncovered (Blink 35, WebKit 40, Gecko 20, shared 15), against tentpole 4's "every library rule has at least one family". CHARTER.md mentions the missing annotations and the provisional ids, not the uncovered count.
19. `rebuild/lab/cases/obligations.ts` still reads main's required lists. No sealed held-out set exists. Both in CHARTER.md.

**Documents**

20. REPORT.md §7 item 3 says Chrome loses "3 line counts and 7 breaks". §2.4 and the evaluation give 14 breaks, 9 of them under `ui-language`.
21. `rebuild/src/engines/blink/props.ts:2-3` still says "the classes the painted extent reads", although the no-ink bit was removed.
22. `rebuild/research/MAIN-TRIAGE.md` doesn't exist, but CHARTER.md:87 and REPORT.md cite it. Its text is only in the triage owner's return.
