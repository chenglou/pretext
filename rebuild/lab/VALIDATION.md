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

## Remaining caveats

All browsers:

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
  rects with a whole-px edge, and the width is unobserved.

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
