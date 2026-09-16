# Lab validation, 2026-09-16

End-to-end check of the lab (`run.ts`, `page.ts`, `score.ts`) on the maintainer's Retina Mac under macOS 27, with
the stand-in predictor. Every browser run held the shared browser lock, one at a time. A sampler
(`lsappinfo front` plus `ps`, every 0.15 to 0.5 s) recorded the frontmost app and the memory of the driver and the
lab browser during each run. Results are under `.artifacts/lab/validate-20260916/`.

## What ran

| Run | Cases | Wall time | Driver peak RSS | Browser peak RSS | Frontmost-app changes |
|---|---|---|---|---|---|
| Chrome 153, smoke, startup window (before the fix) | 299 | 2.17 s | 51 MB | 1.40 GB, 9 processes | lab Chrome frontmost for about 0.5 s |
| Chrome 153, smoke, background window | 299 | 2.09 s | 52 MB | 1.35 GB, 9 processes | none |
| Firefox 156, smoke | 297 | 2.71 s | 53 MB | 1.40 GB, 8 processes | none |
| Safari 27, smoke | 300 | 2.81 s | not sampled | not sampled | not sampled |
| Chrome 153, 5,000 evenly spaced suite-sample cases | 4,998 | 3.03 s | 99 MB | 1.50 GB, 9 processes | none |
| webkit-host, the same file with `--order=reverse` (second pass) | 4,983 | 5.92 s | not sampled | not sampled | not sampled |

Smoke is `.artifacts/lab/cases/smoke.ndjson` (300 cases: 102 policy, 87 runs, 75 suite, 36 ws; 11 page contexts
including five fixture web fonts). Cases scoped to other browsers are skipped, so Chrome runs 299 and Firefox 297.
The 5,000-case file takes every fourth line of `suite-sample.ndjson` (14 page contexts). It is
`.artifacts/lab/cases/suite-sample-5000.ndjson`.

Throughput. Launching and loading the page take about 1 to 1.5 s, which dominates a 300-case run. The 5,000-case
Chrome run took 0.61 s per 1,000 cases including the launch. The page spends 0.14 s (suite sample) to 0.5 s (smoke,
longer and multi-run paragraphs) per 1,000 cases observing, and Firefox 0.76 s on the smoke. `run.json` now records
`launchMs` and `casesMs` separately.

Memory. Browser RSS is summed over the lab browser's process tree, which counts shared framework pages once per
process, so the real footprint is lower. The scorer peaked at 151 MB of RSS scoring the 25 MB rows file of the
5,000-case run in 0.18 s.

## Checks

- Background: after the Chrome fix, no run changed the frontmost app, and every row reports
  `document.hasFocus()` false. No run left processes, profiles or tabs behind.
- Environment: every row reports DPR 2, visual-viewport scale 1 and `visibilityState` visible.
- Fonts: `document.fonts.status` is `loaded` before and after `document.fonts.ready` in every row. Every named family
  in the smoke cases resolves in Chrome and Firefox. In the suite sample, 9 rows name families this Mac lacks:
  SimSun (5), Noto Serif CJK SC (3) and DecoType Nastaleeq Urdu UI (1). Those rows observe fallback fonts.
- Determinism: the two Chrome smoke runs, one with a startup window and one with a background window, recorded
  identical native observations (height, width, every code point rect and every whole-node rect) for all 299 cases.
- Partition: a visible code point belongs to exactly one derived line by construction. The scorer now also checks
  that derived lines follow source order, including white space and controls. This fired on 3 of 4,998 suite
  cases (a U+2028 at a line start) and on none of the smoke cases.
- Line counts: with the fixes below, no paragraph's height disagrees with its derived lines in any run, and no line
  count is unobserved.

Unobserved native derivations, whatever the predictor:

| Reason | Chrome smoke | Firefox smoke | Chrome suite sample |
|---|---|---|---|
| Rows with breaks unobserved | 6 / 299 | 5 / 297 | 58 / 4,998 |
| … a grapheme with ink has no positive rect | 6 | 5 | 54 |
| … derived lines overlap in source order | 0 | 0 | 3 |
| … a visible code point has positive rects on several lines | 0 | 0 | 1 |
| Lines with widths unobserved: positive soft hyphen rect at line end | 18 / 1,343 | 15 / 1,326 | 882 / 15,960 |
| Lines with widths unobserved: other space separator at line end | 5 | 3 | 45 |

The no-positive-rect graphemes are combining marks isolated by a control or soft hyphen (`a⁠́b`,
`office­́office`). The browser draws them with no advance, so rects can't place them. The one multi-line
code point is a bidi case, `ב(ب­ب)ב`. The soft hyphen and other-space line counts are high
in the suite sample because many old-suite families put a soft hyphen at every width.

## Problems fixed

1. **Empty `lang` refused.** `run.ts` rejected any case with `paragraph.lang` empty, so `smoke.ndjson` (1 case) and
   `suite-sample.ndjson` (9 cases) wouldn't load. `lang=""` marks a paragraph's language as unknown instead of
   inheriting `<html lang>`, which is what the old observer applied, so the driver now accepts it.
2. **Chrome took focus.** Started with `open -n -g`, Chrome still activated itself when it showed its startup window
   (Chromium's `NativeWidgetNSWindowBridge` calls `activateIgnoringOtherApps` for a normally shown window). The
   sampler caught the lab Chrome frontmost for about half a second. Chrome now starts with `--no-startup-window
   --remote-debugging-port=0`, and the driver opens its one window with `Target.createTarget { newWindow: true,
   background: true }`. Chrome shows that window inactive (`kShowWindowInactive` in
   `chrome/browser/devtools/protocol/target_handler.cc`). The DevTools protocol is used for nothing else.
3. **Safari over the user's windows.** A new document in a frontmost Safari opens over the user's windows and takes
   keyboard focus there, and handing focus back to another app doesn't undo that. The driver now waits, for at most
   10 minutes, until Safari isn't the frontmost app before creating its window. The maintainer was using Safari
   during this validation; the first Safari job waited out those 10 minutes and exited without launching anything.
4. **Missing fonts were invisible.** Nothing recorded whether a named family resolved. The page now probes each
   named family once per document: it measures a probe string in Canvas with the family ahead of two generic
   fallbacks. Rows carry `native.missingFonts`, `run.json` counts them per family and the scorer summarizes them.
5. **Chrome's duplicate hyphen box.** When Chrome selects a soft hyphen, the letter after it (before it in RTL) gets
   an extra rect that exactly copies the hyphen's rect. The scorer treated that letter as spanning two lines, which
   made breaks unobserved on 879 of the 4,998 suite cases and dropped lines. A rect that exactly copies a positive
   soft hyphen rect now places nothing else.
6. **Lines with only zero-width content.** A ZWSP, joiner, soft hyphen or emoji fragment alone on a line has only
   zero-area rects, so the line was missing. That made 464 of 4,998 suite line counts unobserved through the height
   check. Zero-area rects of code points other than LF now establish a line where they sit half a line height or more
   from every positive rect. In every one of the 464 cases, the height agreed once those lines counted.
7. **Lines lost with their only code point.** A line whose only code point also had rects on another line was
   dropped. Lines now take their source range from every code point with a rect on them. Breaks stay unobserved in
   such cases; the line count doesn't.
8. **Height check and span languages.** The height check assumed that same-family, same-size runs give lines of
   exactly one line height. A span with its own `lang` can resolve a generic family to another primary font. In
   Chrome, 16px serif paragraphs at line height 32 were 195px for 6 lines (ja with a ko span) and 98px for 3 lines
   (zh-Hant with ko and zh-Hans spans), which marked 2 smoke cases unobserved. The check now also requires the same
   language.
9. **No predictor-independent diagnostics.** With the stand-in predictor nearly every case fails its breaks, so
   width and derivation problems stayed hidden behind "breaks differ". The summary now has a `native` block: line
   count histogram, width sources and unobserved reasons for line counts, breaks and line widths, counted for every
   row.
10. **No typecheck for the lab.** Only the case generators had a tsconfig. `rebuild/lab/tsconfig.json` covers the
    driver, page, scorer and generators with the repo's strict settings.

Before and after, same rows:

| | Chrome smoke | Firefox smoke | Chrome suite sample |
|---|---|---|---|
| Line counts unobserved | 25 → 0 | 11 → 0 | 464 → 0 |
| Breaks unobserved | 31 → 6 | 15 → 5 | 1,108 → 58 |

The hand-checked 25-case rows in `.artifacts/lab/smoke-20260916-r2` derive the same lines (79, 79 and 80) and the
same issues with the new scorer.

## Second pass: grid, painter extent, page history, observer quirks

Later the same day the scorer, page and driver changed again. Apart from one reverse-order webkit-host run, this pass
re-scored the rows above. Summaries before and after are in `.artifacts/lab/validate-20260916/second-pass/`.

11. **Grid per engine and DPR.** Chrome widths were snapped to 1/64px. Blink lays out in LayoutUnits of zoomed px,
    and at DPR 2 client rects are LayoutUnits divided by 128 exactly (`specs/blink-gaps.md` §6.4). So Chrome's grid is
    now 1/(64 × DPR) px, from each row's `env.devicePixelRatio`. Safari and webkit-host keep 1/64px at any DPR, and
    Firefox keeps 1/60px. The off-grid checks allow two float32 steps for rect values and four for widths.
12. **Painter extent.** The painter paints trimmed and hanging white space, and the painted extent included it. The page
    now records each painted line's text and code point rects, and the scorer takes the painted extent with the same
    code as native widths.
13. **Page history.** `run.ts --order=reverse|shuffle:<seed>` and `score.ts --native-compare=<rows>` find cases whose
    native lines depend on the cases before them in the page. The scorer counts those apart and leaves them out of the
    metric counts (README "Page-history dependence").
14. **Module exports.** `score.ts` exports `deriveNative` and what a comparer needs, and runs its CLI only as the entry
    point. `compare-rows.ts` and `compare-old-suite.ts` import it instead of slicing its source.
15. **Collapsed white space and zero-area lines.** WebKit reports the collapsed space after an inline box end as a
    zero-width rect on the next line (`specs/probes-safari.md`). Zero-area rects no longer establish a line for SPACE,
    TAB or a code point that a positive rect places.
16. **White space before a control.** Firefox keeps the space of `aaaa ` + VT in the line's width
    (`specs/probes-firefox.md`, CRITIC W3). A line's trailing run now stops at a control other than TAB, LF and CR.

The other observer caveats in the probe reports were already handled: Firefox's zero-width base letter before a
combining mark (breaks compare grapheme starts), `document.fonts.check` answering true for any family (the page probes
families through Canvas), Chrome's duplicate soft hyphen box and its U+2028 rect copy, and Safari's partial-rect
snapping. A length-changing `text-transform` shifts Safari's Range offsets; the page sets `text-transform: none`.

Before and after, same rows (pass/fail/unobserved/not applicable):

| Rows | Metric | Before | After |
|---|---|---|---|
| Chrome smoke | widths | 7/21/0/271 | 9/19/0/271 |
| Chrome suite sample | widths | 273/389/3/4,333 | 285/377/3/4,333 |

No other metric count changed in the Chrome, Firefox, Safari and webkit-host smoke rows, the Chrome suite sample or
the host's suite sample.

- **Widths.** The stand-in predictor sums Canvas widths, which sit on no layout grid. 5 smoke and 50 suite cases now
  pass: their observed width was an odd number of 1/128px, a tie on the 1/64px grid that rounded up, away from the
  prediction. 3 smoke and 38 suite cases now fail: the observed and predicted widths differ by a 1/128px unit that the
  1/64px grid hid. The width histograms are now in 1/128px units.
- **Grid checks.** Off-grid code point rect values: Chrome 9,034 of 21,580 → 0 in the smoke rows and 165,449 of
  373,328 → 0 in the suite sample, all odd 1/128px values; Firefox 119 → 0, all float32 steps; Safari and webkit-host
  unchanged at 629 of 21,526. Observed line widths off the grid: Chrome 0 of 1,304 and 0 of 14,503, Firefox 0 of 1,295,
  Safari 892 of 1,314 (890 from whole-node rects), and 10,838 of 14,703 in the host's suite sample. WebKit's inline
  layout positions are float32 px (`specs/webkit-lines.md` §1.1, §9.2), so its widths don't land on the 1/64px grid.
- **Derivation.** Native lines were compared line by line with the previous scorer over these rows plus the host's
  `runs` and `ws` rows (2,580 and 1,019 cases). 20 lines hold only zero-width content, and a collapsed space's
  zero-area rect used to widen their source range. The range now starts at the zero-width code point: `a`, space,
  ZWSP, `b` gives [2, 3) instead of [1, 3), and the empty line of a pre-line ` \n wife` gives [3, 3) instead of [0, 3).
  That's 1 Chrome smoke case, 11 Chrome suite cases, 6 host suite cases and 2 host ws cases. No line count, first
  visible code point, width or unobserved reason changed. In 3 host ws cases (`extraordinary \f internationalization`
  under normal and pre-wrap, the VT variant under pre-line) the space before the control is now visible. Those widths
  stay unobserved, because Safari snapped the partial rects.
- **Painter.** No validation run paints yet: the stand-in returns null, and the WebKit engine doesn't predict yet. As a
  check of the rule, each one-line native paragraph was scored as its own painted line (its text, code point rects and
  whole-node rects) against its own derived width. All 1,087 one-line cases in the Chrome, Firefox and Safari smoke
  rows, the Chrome suite sample and the host's `ws` and `runs` rows pass. With whole-node rects alone, as before, 14
  fail and 59 are unobserved. The first version of the rule kept LF in the painted line's code points, where native
  lines drop it, and failed 8 `nowrap` ws cases whose LF collapses to a space. The 25-case painter-probe rows
  (`smoke-20260916-r2/painter-probe`, painted by a scratch predictor before the page recorded code points) now have the
  painter metric unobserved where a line ends in white space: 18 of 25 cases in Chrome and Firefox, 7 in Safari.
- **Page history.** Scoring the host's reversed suite-sample run (`webkit-host-20260916/suite5000-reversed`) against
  its forward run finds 11 of 4,983 cases history-dependent. `WEBKIT-HOST.md` counted 16 sets of derived lines that
  differ. The other 5 differ only by float32 noise in a line edge (12.28799819946289 against 12.288000106811523), which
  changes no line and no width as scored; they count as `geometryOnly`. Comparing the two Chrome smoke runs finds 0 of
  299, and comparing files with no case in common exits with an error. The fresh `--order=reverse` run
  (`.artifacts/lab/order-20260916/webkit-host-reverse`, 4,983 cases in 5.9 s) finds the same 11 history-dependent
  cases and the same 5 geometry-only ones against the forward run. Against the earlier reversed-file run it has the
  same row order and identical native observations for every case, so in one order the host replays exactly.

## Third pass: owner issues

The engine owners filed problems in `ISSUES.md` while iterating against the lab. Two came from the derivation and are
fixed in `score.ts`. Each fix was scored on the owners' latest rows as of 09:27 and on the validation rows, 62,587 rows
in all: under `.artifacts/lab/`, `blink/{smoke-r4,policy-r4,runs-r3,ws-r5,suite-r1/00-07}`,
`gecko/{smoke-r4,policy-r4,runs-r4,ws-r4,suite-sample-r4}` and `webkit/{smoke-r3,policy-r1,runs-r1,ws-r3}`, and the Chrome
smoke and suite-sample, Firefox, Safari and webkit-host smoke rows above. The scorer versions, per-row metrics and
comparisons are in `.artifacts/lab/validate-20260916/third-pass/`. `score.test.ts` covers both rules with hand-made rows.

17. **A grapheme's ink on another code point.** Firefox puts an emoji + VS16 cluster's advance on the VS16, and a letter
    + ZWNJ's or ZWJ's on the joiner, with a zero-width base. VS16 and the joiners are default-ignorable, so such a
    cluster had no visible code point: a line ending `❤️❤️` observed its extent only up to the space before the hearts
    (110.0667px of 151.0667px), and a line holding only a joiner's advance observed 0px. A code point other than white
    space now carries ink when its grapheme has an inked code point. With a positive rect it is visible, ends the line's
    trailing white space and counts for line membership and extents, in native and painted lines.
18. **Safari box edges.** Two derivations gave edges that no float32 prediction can equal. A whole-node rect's right edge
    was the float64 sum of its x and width (102.40376663208008, where WebKit's float32 sum is 102.40376281738281). And
    when hanging white space forced code point rects, a right edge came from a code point rect that Safari floors at a
    box end (448.59375 for a box ending at 448.5999755859375). In Safari and webkit-host a box's right edge is now the
    float32 sum, and each code point extent edge other than a line start at the content edge comes from the one
    whole-node rect on the line whose edge equals it or, for a right edge off the whole px, floors to it at 1/64px. A
    whole-px edge that no box edge equals stays unobserved with the old reason. An edge off the whole px that no box
    gives is unobserved as 'Safari floors a text box end in Range rects to 1/64px'; no current row has one. Over the
    owners' four WebKit files, the Safari smoke rows and the host's 5,000-case rows, code point extent end edges were
    142 box ends floored to 1/64px, 48 box ends off the whole px, 27 whole-px box ends and 541 whole px with no box edge.

Before and after, same rows (pass/fail/unobserved/not applicable). Counts not listed didn't change:

| Fix | Rows | Metric | Before | After |
|---|---|---|---|---|
| 17 | Firefox, owners' latest (25,390) | widths | 19,794/1,941/2,684/971 | 20,374/1,028/3,017/971 |
| 17 | Firefox, owners' latest | painter | 22,663/2,461/266/0 | 23,402/1,722/266/0 |
| 18 | webkit-host, owners' latest (5,505) | widths | 4,431/566/392/116 | 4,684/291/414/116 |
| 18 | webkit-host, owners' latest | painter | 4,287/856/362/0 | 4,530/591/384/0 |

The owners' Chrome rows (25,498) and every validation count stayed the same under both fixes. The stand-in predictor
fails breaks on nearly every validation row, so derivation changes there don't reach the metrics.

- **17, Firefox.** 580 width and 739 painter failures pass, including all six listed cases in `gecko/smoke-r1` and
  `smoke-r4`. 333 width failures became unobserved: once the failing line passed, another line ending at a positive soft
  hyphen decided the metric (`a­b‌`). One painter failure moved to a later line that wraps. In `gecko/suite-r1`, width
  failures went 299 → 126 in `suite/U+200C/*`, 277 → 118 in `suite/U+200D/*` and 96 → 0 in `suite/woman-after-zwj/*`.
  The rest are Arabic joining widths (`ب­ب‌`: native 12.35px, predicted 14.8167px).
- **17, derivation.** 1,433 of the 25,390 owner Firefox rows derive differently. 1,090 lines that held only a joiner or
  VS16 advance gain a visible code point. The others gain one at a cluster, which moves the last visible code point and,
  where the space before the cluster had counted as trailing, the width source from code points to whole-node rects.
  Chrome and Safari give every code point of a cluster a copy of its rect, so there only the last visible code point
  moves: 839 owner Chrome rows, 83 webkit-host rows, and 196 Chrome, 7 Safari and 7 webkit-host validation rows, with no
  other difference. In webkit-host `c-45a96fe1087eb491` and `c-d93198729f8adfce` (`a❤️­b`), breaks still fail, now as
  'predicted line splits a grapheme': the port starts a line at the VS16.
- **18, webkit-host.** 242 width and 233 painter failures pass, five of the six listed cases among them. 11 width and 10
  painter results that were unobserved on a whole-px edge equal to a box edge now pass. 32 width failures became
  unobserved as another line's whole-px edge decided the metric, and 2 on a soft hyphen or other space separator. One
  unobserved width now fails: `c-26935623971a96b9` (`\ftoday.\f“We’ll\f`) starts at the box after an FF, which Safari draws
  with a .notdef advance the scorer doesn't count (the controls issue in `ISSUES.md`). No Chrome or Firefox row derives
  differently. 89 webkit-host owner rows do: 68 lines by their width in grid units, where a floored code point edge gave
  way to the box edge (49.609375px → 49.625px in `c-5baefdc0f8b3f441`), and 21 newly observed lines. The float32 sums
  change no width as snapped to the grid, only the float32 edge test.
- **18, what still fails at 0 grid units.** `c-b178d5d519151ab5` ends at the box of an Arabic span that comes logically
  before its neighbour, and that box's x + width (147.4470977783203) is one float32 step from the predicted end
  (147.44711303710938). 78 LTR lines end one or two float32 steps from the prediction like that. 82 are RTL lines. In
  53 of them the first box's x + width sits one or two steps from the content edge where the line starts
  (336.0000305175781 for 336), and the prediction matches from the content edge. Equality on observed edges stays the
  rule.

## Fourth pass: owner issues, second round

The owners filed seven more problems in `ISSUES.md`. Two came from the derivation and are fixed in `score.ts`, and one
needed the page to record more. Each fix was scored on the owners' latest rows as of 09:57 and on the validation rows,
82,520 rows in all: under `.artifacts/lab/`, `blink/{smoke-r4,policy-r4,runs-r3,ws-r5,suite-r1/00-07}` (25,498),
`gecko/{smoke-r6,policy-r6,runs-r6,ws-r6,suite-sample-r6}` (25,390) and
`webkit/{smoke-r3,policy-r1,runs-r1,ws-r3,suite-r1-part0-3}` (25,438), and the five validation rows files above. The
scorer versions, per-row metrics, comparisons and census scripts are in `.artifacts/lab/validate-20260916/fourth-pass/`.
`score.test.ts` covers both rules with hand-made rows.

19. **Controls with an advance.** The scorer treated every control as invisible. CSS renders a control other than TAB,
    LF and CR as a visible glyph, and the engines give most such controls an advance inside the text node's box:
    Safari the font's `.notdef` (U+001C 12px in 16px Arial), Chrome 1,185 of 1,429 controls in its rows (U+009D 16px,
    VT 5.328125px), Firefox 4 of 1,186 (U+0000 1px). A line holding only such a control observed 0px, and a trailing FF
    with an advance counted as hanging white space. A control other than TAB, LF and CR with a positive rect is now
    visible, in native and painted lines. One with zero-width rects stays out of every line, as before.
20. **Graphemes that native layout splits.** Breaks compared line starts at grapheme starts from `Intl.Segmenter` over
    the whole paragraph, and failed any predicted line that started inside a grapheme. The engines segment less. WebKit
    and Firefox never form a cluster across a text node edge, and Blink's break-all table breaks between two Thai
    characters in one grapheme. So native lines started inside the lab's graphemes, and a prediction that started at
    the same offset failed. Breaks now compare cluster starts: a grapheme is split where native layout put its code
    points with positive rects on different lines (`Derived.clusterStart`; `graphemeStart` is unchanged).
21. **In-document history per row.** Rows now record `env.documentCaseIndex`, how many cases the document observed
    before the case, and `env.previousCaseId`, the last of them.

Before and after, same rows (pass/fail/unobserved/not applicable). Counts not listed didn't change:

| Fix | Rows | Metric | Before | After |
|---|---|---|---|---|
| 19 | webkit-host, owners' latest | widths | 18,780/837/5,102/719 | 18,852/357/5,510/719 |
| 19 | webkit-host, owners' latest | painter | 21,449/3,199/790/0 | 21,705/2,990/743/0 |
| 19 | Chrome, owners' latest | widths | 19,828/1,735/2,948/987 | 19,775/2,045/2,691/987 |
| 19 | Chrome, owners' latest | painter | 20,431/4,783/284/0 | 20,364/4,850/284/0 |
| 19 | Firefox, owners' latest | widths | 20,382/1,020/3,017/971 | 20,380/1,022/3,017/971 |
| 19 | Firefox, owners' latest | painter | 23,407/1,717/266/0 | 23,405/1,719/266/0 |
| 19 | Chrome, validation (5,297) | widths | 294/396/3/4,604 | 295/395/3/4,604 |
| 20 | Chrome, owners' latest | breaks | 24,511/745/242/0 | 24,518/738/242/0 |
| 20 | Chrome, owners' latest | widths | 19,775/2,045/2,691/987 | 19,778/2,045/2,695/980 |
| 20 | Firefox, owners' latest | breaks | 24,419/194/777/0 | 24,424/189/777/0 |
| 20 | Firefox, owners' latest | widths | 20,380/1,022/3,017/971 | 20,385/1,022/3,017/966 |
| 20 | webkit-host, owners' latest | breaks | 24,719/508/211/0 | 24,730/497/211/0 |
| 20 | webkit-host, owners' latest | widths | 18,852/357/5,510/719 | 18,859/358/5,513/708 |

- **19, webkit-host.** 32 width and 208 painter failures pass, and 40 widths and 48 painter results that were
  unobserved on a whole-px edge pass, among them `c-de31834f9896a7cc` (FF text nodes between spans) and `ws/controls`.
  447 width failures became unobserved: once the control line passed, another line ending at a positive soft hyphen
  decided the metric (eight of the nine listed cases). 16 painter failures moved to a later painted line that wraps.
- **19, Chrome and Firefox.** Every result that became a failure fails on a line holding a control with an advance the
  port doesn't predict (`newfails.ts`): Chrome 310 widths (257 were unobserved, 53 passed) and 70 painter results,
  Firefox 2 widths and 2 painter results (`c-fc59a73aa616baff`, `a  b`: 9.1px observed, 8.1px predicted). 3 Chrome
  painter failures pass.
- **19, derivation.** 620 owner Chrome rows, 4 Firefox and 763 webkit-host derive differently, and 142 Chrome, 15
  Safari and 15 webkit-host validation rows. 403, 2 and 470 owner lines that held only a control gain a visible code
  point, and 50, 1 and 61 lines take their width from whole-node rects instead of code point rects, where a control
  with an advance had counted as hanging white space. The rest move a first or last visible code point.
- **20.** 7 Chrome breaks failures pass (the three Thai break-all cases in `policy-r4` and 4 suite rows), 5 Firefox and
  11 webkit-host, the listed cases among them. Their widths pass or are unobserved, except webkit-host
  `c-4f0c9d3cd9d60735`, whose line 3 box ends one float32 step from the prediction (30.719999313354492 against
  30.720001220703125). Only these rows derive differently (7 Chrome, 5 Firefox, 13 webkit-host owner rows and 1 Chrome
  validation row), each by a first visible code point that moves to the native line's start. No 'predicted line splits
  a grapheme' failure is left in Chrome or Firefox. In webkit-host 398 are left, where native layout keeps the cluster
  on one line: 386 in `suite/heart-vs16/*` and `suite/before-heart` (in `c-45a96fe1087eb491` the port starts a line at
  the VS16), 6 Thai `runs/split-word` and 6 `suite/measurement` (emoji + VS15).
- **Latin-1 storage, no scorer change.** Commit 8df70c6 (09:10) made `run.ts` serve chunk replies as ASCII-only JSON.
  Scored with `--native-compare`, `webkit/smoke-r3` against `smoke-r1` (from before that commit) derives differently on
  exactly the three listed cases of 300: `c-42086912543bce9f` 48 → 53 lines, `c-c551e7ed97f564ff` 4 → 1 and
  `c-c62182c46f2a130d` 3 → 2. All three pass lineCount, breaks and widths in `smoke-r2` and `smoke-r3`.
- **Soft hyphen lines, no change.** In the owners' WebKit rows, a line holding only a soft hyphen without a positive
  rect holds a hyphen that wasn't chosen: a trailing SHY at the paragraph end or a SHY before a collapsible space, which
  0px describes. A chosen hyphen gets a positive rect, and that line's width is unobserved. The reported 0px failures
  were control lines (19).
- **21, page history.** `c-17af0e41879fc51f` (`aبِبِ((tail`, 24px Amiri, RTL) alone in a webkit-host run gives 6 lines,
  as a standalone document does. After `c-15392ecfc5a69b77`, the same text LTR at the same width, it gives the 7 lines
  of the suite rows (`.artifacts/lab/history-20260916/`). A rerun of the pair with the new fields reports
  `documentCaseIndex` 1 and `previousCaseId` `c-15392ecfc5a69b77` on the 7-line row. This is WebKit's page history
  (WEBKIT-HOST.md "Order within a page").

## Remaining caveats

All browsers:

- Line starts are compared at cluster starts, which split a grapheme only where its code points with positive rects
  sit on different lines. Which line a zero-width code point of a split grapheme sits on isn't observed.

- The stand-in predictor predicts one line, so widths were compared only on one-line paragraphs, and `paint`
  returned null, so the painter path wasn't exercised in this validation.
- A line box's rects are grouped by vertical centres half a line height apart. Very different font sizes on one line
  with a small line height could split a line. The height check can't catch it for mixed fonts or span languages,
  but visible code points interleaving between lines would mark breaks unobserved.
- Zero-area lines were corroborated by heights only in single-font paragraphs. In a mixed-font paragraph a zero-area
  rect at a position no line occupies would add a line unchecked. None of the checked paragraphs had one.
- Widths are unobserved on a line ending at a positive soft hyphen rect and at another space separator.
- The font probe can't tell a family from a fallback it measures identically to in both probes, and it probes at
  weight 400.
- The sampler polls every 0.15 to 0.5 s, so an activation shorter than that could be missed. The fixed Chrome launch
  never shows a window the normal way, which is what activated it.

Chrome 153:

- At DPR 2, rects are LayoutUnits divided by 128. The scorer first used a 1/64px grid, where 9,034 of 21,580
  positive code point rect values in the smoke run sat off the grid and widths on an odd 1/128 unit rounded half up.
  With the 1/128px grid (second pass below), no rect value or observed width is off the grid.
- A U+2028 at a line start gets a copy of the next letter's rect on the following line.

Firefox 156:

- 119 of 20,494 positive rect values sit more than 1e-3 app units off the 1/60px grid, but each within two float32
  steps of it (285.83331298828125 for 17150 au). The grid checks now allow two steps, and none is off.
- Timings are whole milliseconds (reduced timer precision).

Safari 27 (the smoke run waited for Safari to leave the front, as in problem 3, then ran with no sampler):

- Inline layout positions are float32 px, not LayoutUnits. 629 of 21,526 positive code point rect values and 892 of
  1,314 observed line widths sit off the 1/64px grid, 890 of them from whole-node rects. Scoring snaps both sides
  half up, so a prediction within float32 noise of the observed width can still land in the neighbouring unit.
- Code point Range edges inside a text box snap to whole px. On 1 smoke case, hanging white space forced code point
  rects with a whole-px edge, and the width is unobserved. The right edge of a code point that ends a box is floored,
  mostly to 1/64px; since the third pass the scorer takes such edges from the box's whole-node rect.
- A line's end edge from a box can sit one or two float32 steps from a prediction, and in RTL the first box's x + width
  can sit one or two steps from the content edge where the line starts (third pass). Widths still pass only on equality.

## Commands

Typecheck and case generation (no browser):

```sh
bunx tsc -p rebuild/lab/tsconfig.json --noEmit
bun rebuild/lab/cases/generate.ts all
```

The 5,000-case file, every fourth line of the suite sample (split only on LF; JSON strings can hold U+2028):

```sh
python3 -c "
lines=[l for l in open('.artifacts/lab/cases/suite-sample.ndjson', newline='').read().split('\n') if l.strip()]
k=len(lines)/5000
open('.artifacts/lab/cases/suite-sample-5000.ndjson','w', newline='').write('\n'.join(lines[int(i*k)] for i in range(5000))+'\n')"
```

Browser runs, one at a time:

```sh
python3 .artifacts/session/with-browser-lock.py lab-validate-chrome-bg -- \
  bun rebuild/lab/run.ts --browser=chrome --cases=.artifacts/lab/cases/smoke.ndjson --out=.artifacts/lab/validate-20260916/chrome-bg
python3 .artifacts/session/with-browser-lock.py lab-validate-firefox -- \
  bun rebuild/lab/run.ts --browser=firefox --cases=.artifacts/lab/cases/smoke.ndjson --out=.artifacts/lab/validate-20260916
python3 .artifacts/session/with-browser-lock.py lab-validate-safari-retry -- \
  bun rebuild/lab/run.ts --browser=safari --cases=.artifacts/lab/cases/smoke.ndjson --out=.artifacts/lab/validate-20260916/safari
python3 .artifacts/session/with-browser-lock.py lab-validate-chrome-suite5000 -- \
  bun rebuild/lab/run.ts --browser=chrome --cases=.artifacts/lab/cases/suite-sample-5000.ndjson --out=.artifacts/lab/validate-20260916/suite5000
```

Scoring (no browser):

```sh
V=.artifacts/lab/validate-20260916
bun rebuild/lab/score.ts --rows=$V/chrome-bg/chrome-rows.ndjson --cases=.artifacts/lab/cases/smoke.ndjson \
  --out=$V/chrome-bg/chrome-summary.json --examples=20 --per-case=$V/chrome-bg/chrome-per-case.ndjson
bun rebuild/lab/score.ts --rows=$V/firefox-rows.ndjson --cases=.artifacts/lab/cases/smoke.ndjson \
  --out=$V/firefox-summary.json --examples=20 --per-case=$V/firefox-per-case.ndjson
bun rebuild/lab/score.ts --rows=$V/safari/safari-rows.ndjson --cases=.artifacts/lab/cases/smoke.ndjson \
  --out=$V/safari/safari-summary.json --examples=20 --per-case=$V/safari/safari-per-case.ndjson
bun rebuild/lab/score.ts --rows=$V/suite5000/chrome-rows.ndjson --cases=.artifacts/lab/cases/suite-sample-5000.ndjson \
  --out=$V/suite5000/chrome-summary.json --examples=20 --per-case=$V/suite5000/chrome-per-case.ndjson
```

Second pass, comparing runs (the reverse run under the lock):

```sh
V=.artifacts/lab/validate-20260916
W=.artifacts/lab/webkit-host-20260916
bun rebuild/lab/score.ts --rows=$V/chrome-bg/chrome-rows.ndjson --cases=.artifacts/lab/cases/smoke.ndjson \
  --out=$V/second-pass/chrome-bg-vs-startup-window.json --native-compare=$V/chrome-rows.ndjson
bun rebuild/lab/score.ts --rows=$W/suite5000-reversed/webkit-host-rows.ndjson \
  --out=$V/second-pass/host-suite5000-reversed.json --native-compare=$W/suite5000/webkit-host-rows.ndjson
python3 .artifacts/session/with-browser-lock.py lab-order-webkit-host-reverse -- \
  bun rebuild/lab/run.ts --browser=webkit-host --cases=.artifacts/lab/cases/suite-sample-5000.ndjson \
  --out=.artifacts/lab/order-20260916/webkit-host-reverse --order=reverse
bun rebuild/lab/score.ts --rows=.artifacts/lab/order-20260916/webkit-host-reverse/webkit-host-rows.ndjson \
  --cases=.artifacts/lab/cases/suite-sample-5000.ndjson --out=.artifacts/lab/order-20260916/webkit-host-reverse/webkit-host-summary.json \
  --per-case=.artifacts/lab/order-20260916/webkit-host-reverse/webkit-host-per-case.ndjson \
  --native-compare=$W/suite5000/webkit-host-rows.ndjson
```

The frontmost-app and memory sampler was a scratch script, not part of the lab. To repeat that check, poll
`lsappinfo info "$(lsappinfo front)"` and `ps -axo pid=,ppid=,rss=,command=` while a run is going.

Third pass, no browser (the scorer module paths must be absolute):

```sh
T=$PWD/.artifacts/lab/validate-20260916/third-pass
bun $T/score-all.ts $T/score-before.ts $T/before.ndjson
bun $T/score-all.ts $T/score-fix1.ts $T/fix1.ndjson
bun $T/score-all.ts $T/score-fix2.ts $T/fix2.ndjson
bun $T/compare.ts $T/before.ndjson $T/fix1.ndjson
bun $T/compare.ts $T/fix1.ndjson $T/fix2.ndjson
bun $T/derive-diff.ts $T/score-before.ts $T/score-fix1.ts
bun $T/derive-diff-masked.ts $T/score-before.ts $T/score-fix1.ts
bun $T/derive-diff.ts $T/score-fix1.ts $T/score-fix2.ts
bun $T/steps.ts .artifacts/lab/webkit/{smoke-r3,policy-r1,runs-r1,ws-r3}/webkit-host-rows.ndjson
bun test rebuild/lab/score.test.ts
bunx tsc -p rebuild/lab/tsconfig.json --noEmit
```

Fourth pass (the three host runs under the lock, with the payload-check stand-in predictor):

```sh
F=$PWD/.artifacts/lab/validate-20260916/fourth-pass
bun $F/score-all.ts $F/score-before.ts $F/before.ndjson
bun $F/score-all.ts $F/score-controls.ts $F/controls.ndjson
bun $F/score-all.ts $F/score-clusters.ts $F/clusters.ndjson
bun $F/compare.ts $F/before.ndjson $F/controls.ndjson
bun $F/compare.ts $F/controls.ndjson $F/clusters.ndjson
bun $F/derive-diff.ts $F/score-before.ts $F/score-controls.ts
bun $F/derive-diff.ts $F/score-controls.ts $F/score-clusters.ts
bun $F/census.ts
bun $F/newfails.ts
bun rebuild/lab/score.ts --rows=.artifacts/lab/webkit/smoke-r3/webkit-host-rows.ndjson --cases=.artifacts/lab/cases/smoke.ndjson \
  --out=$F/latin1-smoke-r3-vs-r1.json --native-compare=.artifacts/lab/webkit/smoke-r1/webkit-host-rows.ndjson
H=.artifacts/lab/history-20260916
P=.artifacts/lab/verify-8bit/predictor.ts
python3 .artifacts/session/with-browser-lock.py lab-history-amiri-alone -- \
  bun rebuild/lab/run.ts --browser=webkit-host --cases=$H/alone.ndjson --out=$H/alone --predictor=$P
python3 .artifacts/session/with-browser-lock.py lab-history-amiri-after-ltr -- \
  bun rebuild/lab/run.ts --browser=webkit-host --cases=$H/after-ltr.ndjson --out=$H/after-ltr --predictor=$P
python3 .artifacts/session/with-browser-lock.py lab-history-amiri-provenance -- \
  bun rebuild/lab/run.ts --browser=webkit-host --cases=$H/after-ltr.ndjson --out=$H/after-ltr-provenance --predictor=$P
```
