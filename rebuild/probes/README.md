# Probes

The probe runner measures the numbered hypotheses at the end of each spec in `rebuild/specs/` in the installed
browsers. A probe is data: some markup, some Canvas measurements and a list of observations. The runner records raw
observations only. The agent who wrote the probes computes the verdicts afterwards from the output file. Probe pages
may read the DOM freely; this is research, not the library.

- `types.ts`: probe shapes and raw result shapes.
- `page.ts`: the browser page. It runs a document's probes in a fixed host and posts the results.
- `runner.ts`: the driver. It validates the probes, serves the page, opens one background browser session and writes
  `<out>/<browser>-probes.json`.
- `smoke.ts`: 16 trivial probes that exercise every runner path. They validate the runner, not a hypothesis.
- `blink-probes.ts`: the Chrome probes for the hypotheses in `blink-lines`, `blink-text`, `blink-canvas` and the Blink
  items of `CRITIC.md`, plus cross-cutting checks. Each probe is one script observation that returns raw values and
  `checks` (expected next to measured). `blink-probes-zoom.ts` and `blink-probes-sysui.ts` select the subsets that the
  forced-DPR, emulated-DPR and fresh-browser system-ui runs repeat. `blink-verdicts.ts` summarizes the output files
  under `.artifacts/probes/blink/` for `rebuild/specs/probes-chrome.md`; the commands are in the header of
  `blink-probes.ts`. `blink-probes-sysui-domfirst.ts` is the DOM-first system-ui probe alone in a fresh browser.
- `gecko-probes.ts` with `gecko-verdicts.ts`, and `webkit-probes.ts` with its independently written cross-check
  `webkit-probes-crosscheck.ts` and `webkit-verdicts-crosscheck.ts`: the same for the Firefox and WebKit hypotheses
  (`rebuild/specs/probes-firefox.md`, `probes-safari.md`). `rebuild/tests/rerun-probes.sh` reruns these sets per browser
  release and extracts their facts (rebuild/TESTS.md §7).
- The ports' follow-ups, each written up in its engine's `rebuild/specs/<engine>-RESULTS.md` under the probe labels its
  header names: `blink-followups.ts`, `blink-followups-20260917.ts`, `blink-gaps-probes.ts`, `blink-ignorables.ts`,
  `blink-round3.ts`; `gecko-followups.ts` (F1, F2), `gecko-emoji-font.ts` (F3), `gecko-font-matching.ts` (F4),
  `gecko-slot-indent.ts` (F5), `gecko-rtl-rects.ts` (F6), `gecko-round2.ts` (F7 to F9), `gecko-round2b.ts` (F10 to F12),
  `gecko-round3.ts` (F13 to F19), `gecko-round4.ts` (F20 to F27); `webkit-followups.ts`, `webkit-round3.ts`,
  `webkit-round4.ts`. The Gecko sets from round 2 on return `checks`, so they give facts.
- `gecko-windows.ts` (W1, W2; profiling item 3, 2026-09-19): the cut rule of Gecko's windows inside long shaping units
  (DESIGN.md §4.4), run by the in-word probe's method on long strings without spaces in eleven script and font-edge
  classes, every cluster boundary tried as a cut: every accepted cut and every offset inside a window against the DOM's
  advances and the long recipe's. Its header has the command; the run is under
  `.artifacts/probes/perf-gecko-fill-20260919/windows-2`.
- `../tools/windows-attack-probe.ts` (A1; the review of profiling item 3, 2026-09-20; it runs the library, so it lives
  beside `tools/fill-counts-probe.ts`): where `gecko-windows.ts` runs the cut rule as page script, this one runs the
  port of the tree it is bundled from: 531 samples, each one paragraph without
  spaces, in the classes a cut is most likely to be wrong in (fonts that kern and substitute across clusters, fallback
  edges and fonts that stick to the previous character's font, variation selectors, emoji, U+200D and U+200C, letter
  spacing, synthetic bold, sizes off Canvas's grid, Arabic with marks, tatweel and digits, direction overrides, scripts
  written without spaces, units of 2,400 units and of 2^18 px). It gives the advance before every cluster start with
  its reason's kind, the windows, the lines at widths beside window edges, plain and inspected, the DOM's advances and
  what was sent to Canvas. A run from a tree without windows and one from a tree with them are held against each other
  by `tools/windows-attack-diff.ts`; `tools/windows-attack-cases.ts` makes the same samples a lab set of 1,566 cases for
  `lab/run.ts` and `lab/compare-rows.ts --prediction=without-measure`. The runs are under
  `.artifacts/probes/perf-gecko-fill-20260919/attack` and `.artifacts/tests/runs/perf-gecko-fill-20260919/attack`.
- `../tools/cut-fonts-probe.ts` (the cut of a wide group and, since 2026-09-23, words first; two checkouts bundled into
  one page): every family of a list lays the same long paragraphs out by both trees, and their cuts, the positions at
  every inner cut of either tree and at the space before it, the group totals and the lines at ordinary widths, at the
  decided lines' own widths and beside cuts are compared (lab README, "Test tiers", has the rule it serves). For words
  first (48de7f7) against 90e0266 in pinned Chrome over 318 families: at DPR 2, 61 of 769,917 layouts differ, all
  Zapfino (67 of 483,099 positions, 1 group total), where the words' two-word test refuses a cut the cut search takes
  inside a contextual form; at DPR 1, 0 of 784,173. The runs are under
  `.artifacts/tests/runs/blink-words-first-20260923/c1/fonts-dpr{1,2}`.
- `../tools/words2-sum-probe.ts` (words2-sum S1; the second check of words first, 2026-09-20): a sum of words against
  Canvas's own exact totals, on short paragraphs (2 to 8 words, where a group below 256 zoomed px is Canvas's one total)
  and on runs of consecutive pieces inside long groups, and the base against the head on its own texts, styles and
  widths, in every installed family. For V3 at DPR 2 over 318 families it found the head off Canvas in 2 of 679,661 exact
  short groups (Euphemia UCAS, 432,128 units) and 1,492 of 1,534,773 long layouts differing; for 48de7f7, 0 of 679,661
  and 983, with 42,722 of its 42,842 differing positions under negative word spacing, where the base's windows hold
  totals of 256 zoomed px or more once JS adds the spacing. `../tools/words2-sum-cases.ts` makes the differing layouts
  lab cases, which say which tree the browser agrees with. The runs are under
  `.artifacts/tests/runs/words2-blink-20260920/attack/sum-dpr2` and `.artifacts/tests/runs/blink-words-first-20260923/c1/sum-dpr2`.
- `../tools/bwf-constructed-probe.ts` (bwf-constructed; the constructed attack on words first and the cut predictor,
  2026-09-23; two checkouts bundled into one page, one probe per page language): lab cases from
  `../tools/bwf-constructed-cases.ts` (long runs without a space that passes in many scripts, words near 256 zoomed px,
  letter and word spacing of both signs far enough to make advances negative, tabs, soft hyphens, default-ignorable and
  bidi controls at word edges, words without a script of their own, Korean, right-to-left text, lines that start inside
  a word, inline boxes inside words, very large sizes, repeated short words in fonts with contextual forms) are laid out
  plain by both trees at the case's width, ordinary widths and the head's lines' own widths with one LayoutUnit to either
  side, and the head's inspected paragraph at three widths counts every gap of a premise. `../tools/bwf-sweep-probe.ts`
  sweeps chosen cases' widths in steps of a fraction of a px, with the gaps' details. `../tools/bwf-constructed-verdict.ts`
  makes lab cases of the differing layouts (from either probe or from a `words-attack.ts` report) and compares the two
  trees' scores against the browser's own lines; `../tools/scale-cases.ts` turns a layout found at DPR 1 or 3 into its
  DPR 2 equivalent, since the lab observes at the machine's ratio and Blink breaks in zoomed px.
  `../tools/nested-window-probe.ts` (nested-window N1) tests the cut predictor's premise directly: around offsets of long
  runs it builds the wide window's shrink as `windowAdjust16` does and measures every window on Canvas, counting windows
  wider than the one around them and shrinks where a window below 256 px comes before one of 256 px or more. For
  96da4af against 90e0266 in pinned Chrome 153 (runs under `.artifacts/tests/runs/bwf-attack-constructed-20260923`): the
  premise fails in real fonts without any spacing, in Farisi, Diwan Thuluth, Mishafi, Mishafi Gold, Waseem and Noto
  Nastaliq Urdu (a window up to 117 zoomed px wider than the one around it, and crossings of 256 at a 256 px font size),
  and under negative letter spacing in every font; large Arabic in those fonts reports `nested-window-wider`, and at 384
  zoomed px Diwan Thuluth's vocalized words lose 11 line counts the base passes (lab cases scaled from DPR 3). Under
  negative word spacing both trees take a Canvas total of 256 zoomed px or more as exact once the spacing JS adds brings
  it below 256, and words first adds a path to it: a pair of words whose test failed because their total was that float
  becomes a piece with it (`addWordPieces` hands `both[i + 1]` to `addPieces`); in short paragraphs cut around such
  pieces the head loses 26 breaks and 19 line counts the base passes and gains 5 and 2. Zapfino at 72 zoomed px (prose
  of 16 words or more) loses 11 of 42 lab cases' breaks and 5 line counts the base passes, with `context-past-a-word`.
  Arabic-Indic digits, a soft hyphen and a side Canvas shapes as Common under letter spacing (`١٢٣`, a space, U+00AD,
  `[2]`, a space, U+200B and `テキスト` in Helvetica Neue) lose 20 statuses with no premise's gap, and Latin words beside
  words without a script of their own in Euphemia UCAS at 16px lose 13 breaks and 10 line counts of 67 swept widths,
  none gained, again with no premise's gap. Repeated short words in 19 fonts with contextual forms, tabs,
  soft hyphens, default-ignorable characters, Korean and right-to-left prose differ nowhere, and no run reports
  `positions-run-backwards`.
- `../tools/word-scan-premise-probe.ts` (word-scan P1; Gecko's word scan, 2026-09-20, landed 2026-09-23; it runs the
  library, twice in one document: the tree's own and the `loop` copy from `tools/word-scan-variants.ts`, both bundled
  with `tools/word-scan-probe-entry.ts`). The word scan rests on a premise about fonts, that no tail of a shaped word
  has a negative advance (DESIGN.md §4.6), and this is its test on real Canvas answers: every word of its lists
  (a letter before every ordered pair of 33 characters that fonts kern hardest, Latin words with marks and ligatures,
  Arabic and Hebrew with and without marks) is a paragraph of its own under `overflow-wrap: break-word` at the width
  of its own advance, where the premise alone decides, in every family of a list, and the tree's lines must be the
  loop's. `WORD_SCAN_PREMISE_CONTROL=1` takes 20px off Canvas's answer for every `q` in Arial and must find `xq` and
  `axqi`. A Firefox slot is enough. Its header has the commands; the runs are under
  `.artifacts/tests/runs/words2-gecko-20260920/attack2/premise-probe` (321 families, 381,027 words, 0 differing) and,
  for the landed tree, `.artifacts/tests/runs/gecko-word-scan-20260923/premise-probe` (the same, and the control's two).
- `../tools/word-scan-scripts-probe.ts` (word-scan P2; the second attack on the word scan, 2026-09-23; one library,
  bundled with `tools/word-scan-scripts-probe-entry.ts`): P1's test over the scripts and fonts P1 leaves out. Each word
  (every distinct token of main's corpora in Thai, Khmer, Myanmar, Devanagari, Urdu, Arabic, Hebrew and Korean, pieces
  of the Han and kana ones, English, Lao, Tibetan and Mongolian samples, emoji sequences, Han beside Latin, made-up words
  of the scripts the Noto faces draw) is laid out at the width of its own advance under `break-word`, and under
  `break-all` where a dictionary break would end word wrapping, in the families that draw it, at 9 to 96px, in bold and
  italic, with the lab's font facts and without them; the inspected paragraph must report no `negative-word-tail`.
  `WORD_SCAN_SCRIPTS_NATIVE=1` also holds each word to Firefox's own premise: at the word's native advance (a span's
  width) and 1 au more, Firefox must give one line. `WORD_SCAN_SCRIPTS_WEBFONTS=1` loads installed faces at the corners
  of their variation axes through the FontFace API, which Canvas measures too, and `tools/negative-tail-font.ts`, a
  made-up font whose kern table gives a point and a letter negative advances. `WORD_SCAN_SCRIPTS_CONTROL=1` is P1's
  control. The runs are under `.artifacts/tests/runs/word-scan-attack-20260923/browser`: no gap in any installed face at
  any CSS instance; Firefox itself breaks words that fit in Mishafi and Diwan Thuluth (tanween after a ligature) and in
  Skia at its lightest, narrowest corner, where the port's advances don't show it; gaps, most of them real, only on
  Skia's corner and the made-up font.
- `../tools/word-scan-paragraphs-probe.ts` (word-scan P3): corpus paragraphs and the lab's snippets in their fonts,
  at drawn widths and where the first line's last word only just fits, laid out by the tree, by the `loop` copy and
  inspected, beside Firefox's own lines (each grapheme cluster on the line of its first positive rect: Firefox gives a
  Thai base before a mark an empty rect). `WORD_SCAN_PARAGRAPHS_STYLES=1` adds spacing in both signs, `pre-wrap` with
  tabs, `break-spaces`, soft hyphens, `keep-all`, `break-all` and the `line-break` values. The tree's lines must be the
  loop's; a tree line that differs from Firefox's where the loop's doesn't is a line the word scan lost.
- `../tools/word-scan-hb-words.ts` and `../tools/word-scan-hb-tails.py`: the premise in the font files, without a
  browser. HarfBuzz (hb-shape, as Firefox shapes every font) over every face of a list of files, each word of the lists
  the first tool writes whose characters the face maps, variable faces at their axis corners and named instances; the
  tail from each grapheme start, inside a ligature cluster too, where Gecko's scan counts the ligature's whole advance.
- The library's own runtime checks in a browser, with the page running the library's bundled module: `font-checks.ts`
  (`src/measure/font-checks.ts` over every font declaration the lab's cases name, beside the DOM) and `canvas-checks.ts`
  (`detectEngine()`'s Canvas checks, `src/measure/canvas-checks.ts`: a pinned browser must answer supported; run it in
  another build with `LAB_CHROME_APP` or `LAB_FIREFOX_APP`).
- `textmetrics-api.ts`: which TextMetrics members a page can use without flags. On 2026-09-17 Chrome 153, Firefox 156 and
  webkit-host all had the ink box and none had `getSelectionRects`, `getActualBoundingBox`, `getIndexFromOffset`,
  `getTextClusters` or `advances` (`.artifacts/probes/textmetrics-api/`). Worth a rerun per release: per-glyph positions
  from Canvas would answer the font facts no check can (`pairKerning`, ligature positions).

- `blink-storage.ts` (S1 to S6, specs/blink-RESULTS.md "String storage"): which string storage reaches Blink from script
  (a keyed use turns a two-byte string into one byte, which ways of building give two bytes), one canvas keeping the first
  shaping, a text node's storage by how it was made, the library's own bundled module asking Canvas the storage it
  built, in both orders, and a Latin range of script-neutral characters with a space in the DOM beside its 8-bit string
  with U+0020 and its 16-bit one with U+2028 (S6). Every probe returns `checks`; `rebuild/tests/rerun-probes.sh` reruns it
  per Chrome release. Beside it `blink-twins.ts`, the first look at the same thing (raw widths).

- `font-family-syntax.ts`: whether each browser's own CSS parser, for an element's style and for a Canvas font, reads a
  font-family list the way the library's one parser does (`src/font-family.ts`): a comma inside a string, escapes, runs of
  white space, U+00A0 and U+3000, keyword case, an empty string, an unclosed string or a last backslash with what follows
  it, and the lists CSS rejects. It returns `checks`, and beside them `classification`: which reference a list measures
  as where that is the engine's choice of keywords and not syntax (a quoted `"system-ui"`, `BlinkMacSystemFont` in small
  letters, `-apple-system` quoted). On 2026-09-19 all 123 checks held in Chrome 153, Firefox 156 and webkit-host
  (`.artifacts/probes/font-family-syntax/`). Seven of its lists came after the fresh-eyes follow-up: the six its critic
  had probed in Chrome and Firefox alone (an escaped newline in a string, a last backslash in an unclosed string, an
  unclosed string and a backslash that take a comma and a generic after them into the name, U+3000, an empty string), and
  a last backslash after an identifier, which adds U+FFFD to the name. They hold in webkit-host too, so the parser's rule
  that a family the list leaves open at its end is its name as a closed string holds in all three: whatever is written
  after the open form joins the name. webkit-host's Canvas font drops the empty string when it is read back (`40px
  monospace` for `"", monospace`), and draws the same.

- `blink-sysui-spellings.ts`: how Chrome's DOM reads other spellings of its two system font names. One probe,
  meaningful alone in a fresh browser at DPR 2; it returns `checks`. On 2026-09-19 in the pinned Chrome (20 of 20
  checks, `.artifacts/probes/fu-blink/sysui-spellings/`): unquoted `system-ui` in any case, a quoted `"system-ui"` and
  `BlinkMacSystemFont`, quoted or not, lay out as the system font. `blinkmacsystemfont`, `BLINKMACSYSTEMFONT` and a
  quoted `"System-UI"` laid out before `system-ui` fall to the standard font. A quoted `"System-UI"` laid out after
  `system-ui` at the same size gets the system font from the platform font cache. It needs a process of its own if it
  is added to `rebuild/tests/rerun-probes.sh`.
- `ff-element-workers.ts` (W1 to W5) and `ff-element-documents.ts` (D1 to D5): what measuring on a detached `<canvas>`
  element in Firefox again would rest on (2026-09-19). The first runs the library's own bundled module over 435 lab cases
  on the page and in a module worker, both on OffscreenCanvas, and compares everything it returns. The second measures an element canvas in every kind of document a
  page can make, finds what tells a document without a presentation shell, which operations flush a pending style change,
  and what the test costs. Each header has its results; the runs are under `.artifacts/probes/ff-element-20260919/workers/`.
  `ff-element-attacks.ts` (X1 to X7) is the second look at the same question: contexts whose font is set once while the
  document's presentation shell goes and comes back, a hidden tab and a new tab, a shared worker and a transferred
  OffscreenCanvas, a pending stylesheet change, SVG and XHTML documents, a document asking from its own early scripts, and
  the test's cost over many contexts. X2 and X7 open a tab with `window.open`, in the runner's background window. Its header
  has the results, with the first set's reruns; the runs are under `.artifacts/probes/ff-element-20260919/workers-check/`.

- `measure-first.ts`: six Chrome probes of which Canvas contexts share a platform font with DOM text of the same zoomed
  size (a context with default settings, the library's measuring context, the font checks' contexts, a page at
  `text-rendering: optimizeLegibility`, and no context first). Each returns checks and is meaningful only alone in a fresh
  browser process (`--only`); its header has the loop, and rebuild/lab/README.md "Measure first" the verdicts.

- `gecko-element-cost.ts`: what a detached `<canvas>` element costs in Firefox as a measuring surface beside
  `new OffscreenCanvas(1, 1)` (the question of 2026-09-19, CHARTER.md decision 2 of 2026-09-18). Measurement only, raw
  values, no `checks`: making contexts, each assignment, the first `measureText` and the steady state on the chat bench's
  words, 10,000 chat messages' worth of contexts and calls, whether `ctx.font` or `measureText` flushes a dirty page (with a
  connected canvas as the control that does), a `FontFace` that isn't loaded, DOM widths beside each kind at another
  `layout.css.devPixelsPerPx`, and pauses while dropped contexts are freed. Its header has the commands; the timing sets
  run alone on the machine with `{ "privacy.reduceTimerPrecision": false }`, which gives `performance.now()` 20 µs steps.
  `gecko-element-cost-rss.ts` wraps one `M` probe and samples the launched Firefox's resident size with `ps` beside the
  page's marks. It names no browser on its command line, so pass `--browser=firefox` to the lock, or the lock takes the
  whole machine. No page can ask Firefox for a collection: the `M2` probes bring one on with 32 MiB buffers.
- `gecko-element-cost-check.ts`: a second look at the same question, with what the first file didn't try. A change to
  the page's style sheets before a canvas call (`K1`, `K1b`: an element's `measureText` brings the page's style sheet data
  up to date, an OffscreenCanvas's doesn't), many font declarations taking turns (`K2`), 36,000 live contexts, what a
  frame costs with them and the pauses while they are freed (`K3`, one kind per browser process), the freeing pause at
  10,000, 20,000 and 40,000 contexts (`K4`), the chat bench's shape of work on a page whose style or layout is dirty
  (`K5`), and the first `measureText` of kept contexts after their web font loads (`K6`). Same prefs, same lock rules.

- `contexts-start-up.ts` (S1 to S3, W1 to W10, T1; 2026-09-20): every way a kept Canvas context can answer otherwise
  than a context made now, raw Canvas beside the DOM, one probe a browser launch. S1 to S3 read 11 to 14 font
  declarations for ten seconds in a browser that has just started, each with a context per way of touching it. W1 to
  W10 bring one web font in by four routes, with and without DOM text in the family, into a font set that holds no face
  and into one that holds a face. T1 times each way beside making a context. Verdicts: Firefox's kept contexts stay on
  the fallback for family names it learns after start-up and nothing assigned heals them; webkit-host's miss only a
  loaded FontFace added to a font set that holds no face; Chrome's follow everything. Runs under
  `.artifacts/probes/contexts-heal`; research/CONTEXTS-HEAL.md has the study.
- `../tools/contexts-start-up-probe.ts` (L1, L2; it runs the library, so it lives beside `tools/fill-counts-probe.ts`):
  the library with one kept list beside the DOM and a new list, for the late names in a browser that has just started
  and across a loaded FontFace being added.
- `contexts-heal-attack.ts` (H1 to H5, 2026-09-20): the second reading of `contexts-start-up.ts`. Which names pages
  write are late names in Firefox (9 of 22), that a used `local()` rule, `reset()` and a resize don't bring a kept
  Firefox context back, an installed family taken over by a loaded FontFace, and WebKit's case after the font set was
  emptied. Runs under `.artifacts/probes/contexts-heal/attack`.
- `../tools/contexts-heal-attack-probe.ts` (K1 to K3): a paragraph prepared at the start of a Firefox that has just
  started and kept. It stays on the fallback, and first filled after the names arrived it measures with two fonts.

## Running

Every command that drives a browser runs under the shared browser lock, one browser per locked job. `runner.ts`
doesn't take the lock itself:

```sh
cd ~/github/pretext-rebuild
python3 .artifacts/session/with-browser-lock.py probes-chrome -- \
  bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/probes/smoke.ts --out=.artifacts/probes/smoke
```

Options:

- `--browser=chrome|safari|firefox|webkit-host` (required). `webkit-host` is installed Safari's engine in the WKWebView
  host (see Browser sessions); it takes Safari's probes and writes `webkit-host-probes.json`.
- `--probes=<file>` (required): a `.json` file holding an array of probes or `{ "probes": [...] }`, or a `.ts` module
  whose default export (or `probes` export) is an array, or a function returning one.
- `--out=<dir>`: default `.artifacts/probes/<probes file basename>`.
- `--only=<substring>`: run only probes whose id contains it.
- `--probe-timeout-ms=N`: per probe, default 20000. A probe that runs out records an error and the run continues.
- `--stall-ms=N`: fail the run after this long without page activity, default 90000.
- `--firefox-prefs=<file.json>`: Firefox only. A JSON object of extra prefs appended to the profile's `user.js`, for
  example `{ "layout.css.devPixelsPerPx": "1.0" }` to lay out at 60 app units per device pixel on a Retina screen.
- `--chrome-args=<switches>`: Chrome only. Extra command-line switches separated by spaces, for example
  `--chrome-args=--force-device-scale-factor=1` to lay out at layout zoom 1 (DPR 1) on a Retina screen.
- `--chrome-emulate-dsf=N`: Chrome only. DevTools device emulation (`Emulation.setDeviceMetricsOverride` with
  `deviceScaleFactor: N`), applied before the first navigation and kept for the whole run. For probes about emulated
  DPR, not for accuracy runs.
- `--allow-safari-frontmost`: Safari only, no value. Skips the wait for Safari to leave the front (approved by the
  maintainer on 2026-09-16); the probe window then opens over the user's windows.
- `--foreground`: pinned Chrome and Firefox, and installed Safari. Request activation of the dedicated window and tab for timing work. Chrome without emulated DPR and Firefox use normal foreground startup URLs; Firefox also receives its native `-foreground` switch
  ([Mozilla driver fix](https://bugzilla.mozilla.org/show_bug.cgi?id=1466573)). The probe
  must acquire and check actual content focus during timing; the launch flag neither proves content focus nor prevents a later focus change.
- `--isolated`: opt in to COOP/COEP response headers for cross-origin isolation and finer timing. Default accuracy
  probes keep their existing headers. Record isolation and the observed timer step; a launch flag alone does not
  establish timer resolution.
- `--require-clean`: fail the run on probe or observation errors, while retaining every raw result. Use it for
  validation and timing probes that require successful observations.
- `--dry-run`: validate the probes and print the document count without launching anything.

The runner exits nonzero when anything goes wrong at run level: invalid probes, a launch or page failure, a stall, a
missing result, or a change of user agent, DPR or visual-viewport scale during the run. Errors inside a probe (bad
markup, a throwing setup, a timeout) or inside one observation are results, not run failures. They are counted in
`totals` and kept in the result. `--require-clean` makes those errors run failures too.

## Probe format

```ts
{
  id: 'blink-canvas/H7',
  spec: 'blink-canvas H7',
  pageLang: 'en',                  // null: no lang attribute (only for probes about a missing lang); '': lang=""
  html: '<div style="font:16px/20px Arial;width:1px">foo<b>bar</b></div>',
  setup: 'element.firstChild.data = "a\\rb"',   // optional
  canvas: [
    { kind: 'offscreen', context: 'A', font: '16px Arial', wordSpacing: '10px', text: ' x' },
    { kind: 'offscreen', context: 'A', text: 'x y' },
  ],
  observe: ['lines', 'canvasWidths', { kind: 'env', families: ['Arial'] }],
  // optional: hostWidth (default 1000), fontFixtures, browsers, document, note
}
```

Unknown keys are rejected, so a typo fails validation instead of silently observing nothing.

- `html` is the markup of exactly one test element, with no text around it. It goes into the host with `innerHTML`.
  The host is `position: fixed` at (0, 0) with no margin, padding or border, `hostWidth` px wide. The HTML parser turns
  CR and CRLF into LF and NUL into U+FFFD, so set such text from `setup`.
- `setup` is the body of an async function with parameters `host` and `element`. It runs after the markup is inserted
  and before anything is observed. Use it for text the parser can't carry, several adjacent text nodes
  (`element.append('a\f', '\n', span)`) or other DOM building.
- `canvas` entries run, in order, when the `canvasWidths` observation runs.
  - `kind`:
    - `offscreen`: `new OffscreenCanvas(1, 1)` on the main thread.
    - `element`: a `<canvas>` appended to the host, so it's connected to the document.
    - `worker`: an OffscreenCanvas inside a dedicated worker created for the probe.
    - `transferred`: a connected `<canvas>` whose `transferControlToOffscreen()` result is measured in that worker.
  - `font`, `letterSpacing`, `wordSpacing`, `textRendering`, `fontKerning`, `fontVariantCaps`, `fontStretch`,
    `direction` and `lang` are assigned to the context in the order the keys appear in the entry, and only when
    present. An absent key leaves the context's value alone, so "ctx.letterSpacing never set" is an entry without
    `letterSpacing`.
  - `context`: entries with the same key share one canvas and context, in order. That covers order dependence and
    "set the same font string again". Without it, every entry gets a fresh context. The first entry of a context must
    set `font`.
  - `elementLang` and `elementStyle`: the `<canvas>` element's `lang` attribute and inline style, on the first entry of
    an `element` or `transferred` context.
  - `pageLang`: set `<html lang>` before this entry's assignments (null removes it). It stays changed until the probe
    ends, then the page restores the document's own value.
  - `frames`: on `offscreen` and `element` contexts, wait for this many animation frames before the assignments,
    drawing `fillRect(0, 0, 1, 1)` in each frame callback. A frame that doesn't arrive within 3s is an entry error.
- `fontFixtures`: web fonts from `tests/wrapping/fonts/fonts.json`, by family. The page loads them as `FontFace`
  objects before running any probe of the document. A worker loads them into its own FontFaceSet when it starts. The
  driver checks their hashes.
- `browsers`: the browsers the probe applies to; absent means all.
- `document`: probes with the same key run one after another in a single document, and must share `pageLang` and
  `fontFixtures`. Otherwise every probe gets a fresh document, loaded by reloading the page. Use a shared document for
  long width scans, and a fresh one whenever document state (caches, lang changes, script globals) could leak.

## Observations

They run in the order listed. All rects are CSS px relative to the host, which sits at the viewport origin, so a test
element without a margin starts at (0, 0). Values are raw doubles as the browser reported them.

- `lines`, or `{ kind: 'lines', selector }` (default: the test element). For every code point of the target's text
  nodes in tree order: its UTF-16 offset into `textContent`, its length, its text node and every Range client rect,
  unfiltered. Also the rects of a Range over each whole text node, the target's box and its computed `line-height`.
  - Lines: a code point is visible when it has a rect with positive width and height. Its first positive rect joins
    the line whose centre is within `groupThreshold` of the rect's centre, or starts a new line. `groupThreshold` is
    half the computed line height when that's in px, otherwise half the first positive rect's height.
  - Each line has `start`, `end`, `text`, the extent of its visible code points' positive rects, and the number of
    visible code points. `lineStarts` lists the starts in line order.
  - `multiLine` lists code points with positive rects on more than one line. Chrome gives a letter after a selected
    soft hyphen rects on both lines, and then the first rect decides. `interleaved` is true when two lines' ranges
    overlap. Regroup from `points` when either happens.
- `boxWidth`, or `{ kind: 'boxWidth', selectors }`. `getBoundingClientRect()` and `getClientRects()` of the test
  element, or of every element matching each selector inside the host.
- `rangeWidth`, or `{ kind: 'rangeWidth', selector }`. A Range over the target's contents: its client rects, its
  bounding rect and `extent`, the horizontal extent of the rects with positive area.
- `canvasWidths`: per entry, the assignments made (with the error text when a setter threw), every property read back
  right before measuring (null when the context lacks it), `measureText(text)` width and actual bounding box left and
  right, the `<html lang>` attribute at that moment, frames completed, and an error when the entry failed.
- `env`, or `{ kind: 'env', families }`. User agent, DPR, visual-viewport scale, the `<html lang>` attribute,
  `navigator.language(s)`, the Intl default locale, window and screen sizes, visibility, focus, `document.fonts.status`,
  loaded fixtures and feature flags: OffscreenCanvas, `ctx.lang`, `ctx.letterSpacing`, `transferControlToOffscreen`
  and `Intl.v8BreakIterator`. For each family it records `document.fonts.check('16px "<family>"')`, which browsers
  answer true for installed fonts and sometimes for families that don't exist, and `resolves`: a probe string at 64px
  measured differently from at least one of two generic fallbacks.
- `{ kind: 'script', source }`: the body of an async function with parameters `host` and `element`. Its return value
  goes through JSON and is recorded. For what the schema doesn't cover, such as `Intl.v8BreakIterator` boundaries or a
  sequence of DOM edits.

A failing observation is recorded as `{ kind, error }`, and the remaining observations still run.

## Output

`<out>/<browser>-probes.json`:

- `status` and `errors`: run-level problems.
- `build` and `app`: the browser build read from the app bundle before launch, and the bundle the runner launched (path,
  whether it is a pinned copy, and the copy's tree hash).
- `totals`: selected probes, documents, results, probes with probe-level errors, observation errors, reloads and
  resends.
- `envs`: each distinct user agent, DPR, visual-viewport scale, visibility and focus the page reported, with the
  number of reports.
- `results`: one entry per selected probe, in run order (documents in order of first appearance): `id`, `spec`,
  `document` (index), `probe` as served, and `result`. `result` is null when the run stopped before the probe ran.
  Otherwise it holds `fontsStatusBefore` and `fontsStatusAfter` (`document.fonts.status` right after layout and after
  awaiting `document.fonts.ready`), `observations`, `errors` and `ms`.

## Browser sessions

Sessions stay in the background by default. `--foreground` requests activation for timing; the probe must still
check actual visible/focused endpoints. The background WebKit host does not support this option. The driver launches
once and never retries.

- Chrome: the lab's pinned copy of Chrome (`rebuild/lab/browser-build.ts`, the lab README's "Pinned browsers"), headed,
  with its own `--user-data-dir` under `.artifacts/profiles/`, started with `open -n -g -a` plus `--no-startup-window
  --remote-debugging-port=0 --disable-updater-scheduler`. Headless Chrome can lay out at zoom 1 while
  reporting DPR 2. Chrome activates itself whenever it shows a window the normal way, `open -g` or not, so the driver
  opens its one window over the DevTools protocol with `Target.createTarget { newWindow: true, background: true }`,
  which Chrome shows inactive (the same technique as `rebuild/lab/run.ts`). The protocol is used for nothing else,
  except that `--chrome-emulate-dsf` attaches to that target, sets the device metrics override, navigates, and keeps
  the socket open until the run ends.
- Firefox: `open -n -g -a <the lab's pinned copy of Firefox> --args --new-instance --profile <.artifacts/profiles/...>
  --remote-debugging-port <port> about:blank`, headed, then navigated over WebDriver BiDi. Foreground timing uses the probe URL as its normal startup page, matching `bench/run.ts`, because activating
  an about:blank BiDi context left content unfocused. The probe still verifies real focus. Background sessions retain
  BiDi navigation. The BiDi session applies
  Firefox's recommended automation prefs (`remote/shared/RecommendedPreferences.sys.mjs` at 156). At 156 none of them
  touch fonts, text or layout; they cover first-run pages, telemetry, updates, focus test mode and hang timeouts.
- Safari: the repo's AppleScript session, `createBrowserSession('safari', { foreground: false })` from
  `scripts/browser-automation.ts`. It opens one single-tab window in the user's Safari (safaridriver doesn't work on
  macOS 27). The driver first waits until Safari isn't the frontmost app, because a new document in a frontmost Safari
  opens over the user's windows. `--allow-safari-frontmost` skips that wait, and then the driver makes and closes its
  window with plain AppleScript that never calls `activate` (the repo session hands focus back by activating the
  previously frontmost app). On close, the session closes its tab only if it can still identify it by URL.
- webkit-host: the WKWebView host on the system WebKit.framework, which installed Safari runs
  (`rebuild/tools/webkit-host`, built into `.artifacts/webkit-host/webkit-host`; the lab README's Browser sessions
  section describes it). The driver spawns it with the probe URL and a 1200 x 900 window. It never touches the user's
  Safari, never activates, and exits when the page's title is `probes done` or when the driver exits.

The driver closes Chrome and Firefox (SIGTERM, then SIGKILL) and removes their profiles. webkit-host gets 2 s
to exit by itself, then SIGTERM and SIGKILL. The page server takes the first free port from 3002.

## Page protocol

The server serves `/probe?run=<id>` and never changes that URL. Each load returns the current document: `<html lang>`
set in the markup (so it holds before any script measures), the host, and `#probe-doc` with the document index and its
fixture fonts. The page loads the fixtures and posts to `/api/step`. The reply carries the document's probes, `reload`
(the page calls `location.reload()` to get the next document) or `done`. The page runs the probes one by one, clearing
the host, terminating the probe's worker and restoring `<html lang>` after each, then posts the results. A page that
reloads before acknowledging gets its probes again, at most 3 sends. Only fetch promises drive the loop. Timers are
used only as guards (probe, frame and worker timeouts), so background timer throttling can't stall it.
