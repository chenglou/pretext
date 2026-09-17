# webkit-host and installed Safari

`webkit-host` (`rebuild/tools/webkit-host`) runs the lab page in a background WKWebView on the system WebKit.framework,
build 22625.1.29.11.27, the build installed Safari 27.0 runs on this Mac. It exists so WebKit work can continue while
Safari runs are blocked. This file records how its rows compare with installed Safari's (measured 2026-09-16) and when
they may stand in for Safari. Comparison scripts and reports are in `.artifacts/webkit-host/compare-20260916/`, and the
host's rows are in `.artifacts/lab/webkit-host-20260916/`. The comparison over the final sets is in
`.artifacts/lab/final-20260916/safari-vs-host/`, with its tools in `tools/` beside it.

## Rule

Host rows may stand in for installed Safari while iterating on WebKit breaks and widths: developing the engine,
triaging failures, bisecting. A reported number (docs, READMEs, PRs, accuracy snapshots) comes from an installed Safari
run, or names webkit-host as its source. Installed Safari 27.0 agreed with the host on every case of the final sets
that isn't history-dependent ("Combined runs of the final sets" below). Whether host numbers may stand in for Safari
without a Safari run is REPORT §7 item 1. Host rows count only when:

- the host logs WebKit 22625.1.29.11.27 and installed Safari is 27.0. Any Safari or macOS update voids this until the
  comparison below runs again;
- the run reports DPR 2, visual-viewport scale 1 and `visibilityState` visible on every row;
- a host row and a Safari row are only compared when both came from the same case file in the same order. A few
  WebKit cases depend on the cases observed before them in the same page (see "Order within a page"). In Safari that's
  true too;
- the case isn't history-dependent in a two-order run. With the same document history, installed Safari and the host
  still differed on 28 held-out observations of such cases;
- the claim is about Range geometry (native lines, heights, widths) or the library's predictions. Predictions come from
  OffscreenCanvas `measureText` and were equal on every case. Other Canvas values are covered only by the WebKit probes,
  which also agreed.

## What matches

Exact equality everywhere below: the case, paragraph height and width, every code point rect, the whole-node rects,
`document.fonts.status`, rejected styles, missing fonts, and the native lines and unobserved reasons from `score.ts`'s
own `deriveNative` (scorer version 1, before the observation ports replaced its visibility rules).

| Host rows | Installed Safari 27.0 rows | Cases | Result |
|---|---|---|---|
| smoke, same order | `validate-20260916/safari` (07:06) | 300 | all exact, 1,355 derived lines |
| `smoke-cases.ndjson`, same order | `smoke-20260916-r2` (06:28) | 25 | geometry and lines exact; those Safari rows predate `missingFonts` |
| `smoke-cases.ndjson`, same order | `smoke-20260916` (06:20) | 25 | heights and code point rects exact; no whole-node rects in those rows |
| `runs.ndjson` (2,580 cases) | smoke's runs cases, other earlier cases | 87 | all exact |
| `ws.ndjson` (1,019 cases) | smoke's ws cases, other earlier cases | 36 | all exact |
| `suite-sample-5000.ndjson` | old wrapping suite, `rows-20260916/safari` (05:52) | 2,986 | 2,973 exact; the 13 others depend on page order |
| old suite order replayed, 20,000 inputs | same | 16,592 | 16,590 exact |

The old suite's observer builds the same paragraph as `page.ts`: an absolutely positioned div with the same styles, one
unmodified text node, and a Range per code point relative to the div. As a check of the method, the lab's Chrome
suite-sample rows equal the old suite's Chrome rows on 2,920 of 2,920 cases, in a different case order.

The runs and ws files have no Safari rows apart from the cases smoke shares with them. The host ran them cleanly: no
native errors, rejected styles or missing fonts, a constant environment, and 2,580 cases in 1.9 s plus a 0.24 s
launch. In the suite sample, the host and the lab's Chrome run report the same missing families: Noto Serif CJK SC (3)
and DecoType Nastaleeq Urdu UI (1). Chrome also misses SimSun on 5 Chrome-only cases.

### Combined runs of the final sets

After the maintainer approved Safari runs, installed Safari 27.0 ran the final development and held-out sets as two
combined case files, each in file order and in reverse (REPORT §2.2), from 16:22 to 16:34. webkit-host ran the same
files in the same orders from 16:34 to 16:44. Every row had the same document history in both (`documentCaseIndex` and
`previousCaseId`), and every run had no errors, DPR 2, scale 1 and every row visible. `tools/compare-safari-host.ts`
compares the native derivation (`score.ts`'s `nativeView` and `nativeDifference`) and the raw geometry, and
`tools/compare-predictions.ts` compares predictions.

| Case file, order | Installed Safari rows | Cases | Derivations equal | Differ |
|---|---|---:|---|---:|
| `dev-all`, file order | `final-20260916/safari/dev-all-forward` (16:22) | 25,180 | all, raw geometry too | 0 |
| `dev-all`, reverse | `dev-all-reverse` (16:23) | 25,180 | all, raw geometry too | 0 |
| `heldout-all`, file order | `heldout-all-forward` (16:24) | 15,205 | 15,202; 1 of them has float32 noise in the raw geometry | 3 |
| `heldout-all`, reverse | `heldout-all-reverse` (16:29) | 15,205 | 15,180 | 25 |

- Each of the 28 differences is history-dependent in exactly one browser: installed Safari 10, webkit-host 18. They
  are brackets and quotes at line edges (bracket 7, guillemet 6, fullwidth-paren 3, cjk-bracket 2, curly-single-open 2,
  brace 1), Hebrew before `((` (3) and a soft hyphen next to a control (4). The document history matched, so these
  layouts also depend on something outside the document, such as process state or timing.
- The two-order runs mark the same 73 development cases history-dependent in both browsers. Held-out, installed
  Safari marks 124 and the host 132.
- Predictions, measure counts and gap reports are equal on every case of all four runs. The library's 350,162
  measureText calls per development run and 306,620 per held-out run gave the same widths in both.
- Among cases neither browser marks history-dependent, two metric statuses differ, both held-out:
  `c-2abe3876793e1120`, whose painted line wraps only in the host, and `c-05621e0684c86d33`, the float32-noise case,
  whose widths fail in installed Safari and are unobserved in the host.
- Probes: all 89 `webkit-probes.ts` observations are equal, and 133 of 140 cross-check probes. The other 7 ran after
  other documents in one Safari invocation, but in a fresh process in the host (specs/probes-safari.md "Installed
  Safari 27.0").

## What differs

### Environment

- User agent: the host appends `webkit-host/22625.1.29.11.27` after `Version/27.0 Safari/605.1.15`.
- Window: the host is 1440 x 900 and reports `outerWidth` and `outerHeight` as 0. The Safari smoke run was 2560 x 1225.
  Lab paragraphs have explicit widths, so this changes no geometry.
- Focus: `document.hasFocus()` is false in the host. That Safari smoke run had a focused window; the old suite's
  Safari run didn't. Neither changed any geometry.
- Screen: the host window sits on the menu-bar display, and the old suite's Safari window was on the second display.
  Both are DPR 2.
- `navigator.languages` is `zh-CN` in the host and in installed Safari, and so are `navigator.language` and the Intl
  locale (probe cross-cutting 6 env). No lang, `lang=""`, `und` and `xx` break like `en` in both
  (specs/probes-safari.md "Installed Safari 27.0").

### Order within a page

In WebKit a few cases lay out differently depending on which cases ran before them in the same page. This is the
engine, not the host. The host's own suite-sample run in reverse order changed 16 of 4,983 cases (1 height, 16 sets of
derived lines), while Chrome showed no such effect in a different order. Scored with `score.ts --native-compare` (lab
README "Page-history dependence"), 11 of the 16 are history-dependent. The other 5 differ only by float32 noise in a
line edge, which changes no line and no width as scored. A fresh run with `run.ts --order=reverse` repeated the
reversed run's native observations exactly and found the same 11. The cases are the same kinds every time:
Amiri or Noto Naskh Arabic web fonts with `((` or a soft hyphen next to a control, 12px-wide URLs, and brackets or
quotes at a line edge (`(12.5)%`, `!!!!““aabb`, `££££{{aabb`).

Where the host's suite-sample run differed from the old suite's Safari rows (fonts are 400 weight; "fresh page" means
the 13 cases alone in a new page):

| Case | Text, font, width | Old Safari | Host, after earlier cases | Fresh page |
|---|---|---|---|---|
| `c-f5aac01b156bf226` | `!!!!““aabb`, 16px Arial, 46.37 | `!!!!` \| `““aabb` | `!!!!““` \| `aabb` | matches |
| `c-5ba64e3874ad5090` | `aאב((tail`, 24px Amiri, 40, pre-wrap | `aאב` \| `((tai` \| `l` | `aאב` \| `((` \| `tail` | matches |
| `c-b42a2dce856ac987` | `aلا((tail`, 24px Amiri, 14.5, pre-wrap | same lines, last 12.28799819946289px | last 12.288000106811523px | matches |
| `c-2ad5b0126a288f11` | `aلا((tail`, 24px Amiri, 20, pre-wrap | `a` \| `لا` \| `((t` \| `ai` \| `l` | `a` \| `لا` \| `((` \| `ta` \| `il` | matches |
| `c-6ae3b8ddd7dc0fd0` | `a\u00ADb\u001Cb`, 16px Noto Naskh Arabic, 32.25 | `a\u00AD` \| `b\u001Cb` | `a\u00ADb\u001C` \| `b` | matches |
| `c-f6c8d44a6fa0bab8` | `aبِبِ((tail`, 24px Amiri, 16.1, RTL pre-wrap | 288px, 6 lines | 336px, 7 lines (`بِ((` split) | matches |
| `c-6d48cb1c75037106` | `aببب((tail`, 24px Amiri, 15, RTL pre-wrap | `(` alone on a line | `((` on a line | matches |
| `c-ba3fc5afb2e87ab8` | `aببب((tail`, 24px Amiri, 16.1, RTL pre-wrap | second `ب` at x -6.13 | second `ب` at x 5.68 | matches |
| `c-7a886659fff3a5fb` | `aببب((tail`, 24px Amiri, 20, RTL pre-wrap | `(t` \| `ai` \| `l` | `((t` \| `ai` \| `l` | matches |
| `c-b52e18f58d0c2974` | `ب\u00ADب\u001Eب`, 16px Amiri, 35.85, RTL pre-wrap | `ب\u00AD` \| `ب\u001Eب` | `ب\u00ADب\u001E` \| `ب` | matches |
| `c-d4f2cb2c5388de84` | `ب\u00ADب\u001Eب`, 16px Noto Naskh Arabic, 1, RTL pre-wrap | same lines, last `ب` x -11.351999282836914 | x -11.35200023651123 | matches |
| `c-f6efeb13760e9807` | `https://ex.com?x=1\u00ADfoo`, 16px Arial, 12 | 380px, `m` \| `?` | 360px, `m?` | still 360px |
| `c-1d2a15e1eb282a0d` | same, pre-wrap | 380px | 360px | still 360px |

Repeating the fresh-page run, and reversing it, gave the same rows. The two URL cases then matched the old Safari rows
once the host replayed the 2,000 old-suite inputs that ran before them, in the old order (1,540 of 1,542 exact).
Replaying 20,000 inputs left the same two differences: `https://ex.com\u00A0foo` at 16px Arial, width 12, `normal` and
`pre-wrap`. Old Safari breaks `m` | `\u00A0f`; the host breaks `m\u00A0` | `f`. The old run had observed about 119,000 more rows in
that page context before them, including web-font rows the lab loads in other pages, so no replay can reproduce that
history.
In the combined runs of the final sets, installed Safari and the host both break these two as old Safari did, `m` |
`\u00A0f` (`c-2fa3fe5c1fdfdc44`, `c-a0a77ec55b210450`), in both orders. There they follow other cases in the same
document, so a fresh page is still not run. The table's two URL cases give 380px in both browsers there too.

A likely source is WebKit's text measurement cache (`Source/WebCore/platform/graphics/TextMeasurementCache.h`). It only
stores a result when a countdown of recent lookups says caching pays, so whether a piece of text reuses a stored width
or is measured again depends on what the page measured before. That fits the float-sized noise above
(-11.351999282836914 vs -11.35200023651123) and break choices that flip exactly at a fitting edge. It hasn't been
confirmed. WebKit's break-position cache is a confirmed page-history input, in installed Safari too
(specs/probes-safari.md "Installed Safari 27.0").

### Not compared

- Canvas values other than what the library measures and the WebKit probes. The library's predictions were equal on
  every case of the combined runs, and every `webkit-probes.ts` observation was equal (specs/probes-safari.md).
- A fresh WebContent process in installed Safari. The runner opens its window in the user's Safari, so the
  fresh-process probe follow-ups have host results only.

## Hosting differences checked in WebKit's source

From the WebKit 7625.1.29.11.27 checkout (`~/github/browser-engines/webkit-7625.1.29.11.27`):

- SDK-gated behaviours. `computeSDKAlignedBehaviors` (`Source/WTF/wtf/cocoa/RuntimeApplicationChecksCocoa.mm`) turns
  on every behaviour for Safari and clears those an app linked before. `build.sh` records Safari's SDK version, so every
  behaviour that open source gates by version is on. Apple-internal additions to that function can't be checked.
- Code that checks for Safari on macOS: the default for mutation events (off in both), implicit rubber-band scrolling,
  a storage-access quirk on clicks, opener info for new windows, and Lockdown Mode, which WebKit applies only to Safari
  and MiniBrowser. None of them lays out text. Lockdown Mode in Safari would block web fonts; the fixture-font rows
  agree, so it's off.
- User-installed fonts. Safari hides them, and the host turns them off with `_setShouldAllowUserInstalledFonts:NO`.
  Both then take the same path in `FontCacheCoreText.cpp`: descriptors marked not user-installed, system-only fallback.
- Font sizes. WebKit's defaults are a minimum font size of 0, a minimum logical font size of 9 (only for sizes relative
  to the default, not px) and a default size of 16. Safari's "Never use font sizes smaller than" setting is a hard
  minimum that applies to px sizes too (`computedFontSizeFromSpecifiedSize`), and text zoom scales font sizes. The host
  has neither. Smoke cases go down to 10px and matched, so Safari had no minimum above 10px and no text zoom
  on 127.0.0.1 when those rows ran. Changing either in Safari would break the match.
- Text autosizing is iOS-only, and `-webkit-text-size-adjust` does nothing on macOS.
- Fingerprinting protections. Safari's advanced privacy protections add noise to Canvas pixel readback
  (`Document::noiseInjectionPolicies`) and change screen values (`Page::shouldApplyScreenFingerprintingProtections`).
  They don't touch `measureText` or layout. Script tracking limits apply to scripts from known tracker domains, not to a
  page on 127.0.0.1.
- Visibility. WebKit hides a page whose window is occluded (`PageClientImpl::isViewVisible`), so the host's window
  reports itself visible. It may still count as visually idle when the window server sees no window changes
  (`PageClientImpl::isVisuallyIdle`). That only throttles DOM timers. The lab and probe loops run on fetch, and no run
  was slow.
- Site quirks and content blockers act on real sites' domains and subresources. The lab page is served from 127.0.0.1
  and loads only its script and the fixture fonts.

## Re-checking

After a Safari or macOS update, or before relying on the host for a new kind of case, run the same case file in both
under the browser lock and compare. `--allow-safari-frontmost` lets installed Safari run while it's the frontmost app
(approved by the maintainer on 2026-09-16). The combined runs of the final sets used:

```sh
F=.artifacts/lab/final-20260916
bash $F/tools/run-safari-combined.sh     # installed Safari: dev-all and heldout-all, both orders
bash $F/tools/run-host-combined.sh       # webkit-host: the same files, orders and round-trip sizes
bash $F/tools/score-combined.sh safari safari
bash $F/tools/score-combined.sh webkit-host-combined webkit-host
bun $F/tools/compare-safari-host.ts --safari=<safari rows> --host=<host rows> \
  --safari-per-case=<safari forward per-case> --host-per-case=<host forward per-case> --out=<report.json>
bun $F/tools/compare-predictions.ts --safari=<safari rows> --host=<host rows> --out=<report.json>
```

A single file:

```sh
python3 .artifacts/session/with-browser-lock.py lab-webkit-host -- \
  bun rebuild/lab/run.ts --browser=webkit-host --cases=.artifacts/lab/cases/smoke.ndjson --out=<dir>
bun .artifacts/webkit-host/compare-20260916/compare-rows.ts --a=<dir>/safari-rows.ndjson --b=<dir>/webkit-host-rows.ndjson --out=<report.json>
```

`compare-rows.ts` imports `deriveNative` from scorer version 1; with the current `score.ts`, compare `nativeView` and
`nativeDifference` instead. The match is expected to be exact. To find cases that depend
on page history rather than on the host, score a reverse-order run with `--native-compare` (README "Page-history
dependence").
