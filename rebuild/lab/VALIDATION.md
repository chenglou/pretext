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
| Safari 27, smoke | SAFARI-PENDING | | | | |
| Chrome 153, 5,000 evenly spaced suite-sample cases | 4,998 | 3.03 s | 99 MB | 1.50 GB, 9 processes | none |

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

- Range rects hold glyph positions on a 1/128px grid: 9,034 of 21,580 positive code point rect values in the smoke
  run sit off the 1/64px layout grid. Widths snap half up, so a library that snaps differently is 1 unit off on
  ties.
- A U+2028 at a line start gets a copy of the next letter's rect on the following line.

Firefox 156:

- 119 of 20,494 positive rect values sit more than 1e-3 app units off the 1/60px grid.
- Timings are whole milliseconds (reduced timer precision).

Safari 27: SAFARI-PENDING

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

The frontmost-app and memory sampler was a scratch script, not part of the lab. To repeat that check, poll
`lsappinfo info "$(lsappinfo front)"` and `ps -axo pid=,ppid=,rss=,command=` while a run is going.
