# Neighbouring browser builds: a light drift check (2026-09-18)

Near neighbours are fine, but Firefox 140 ESR is catastrophic: line-count pass rate falls from 99.8% to 89.2% and breaks from 99.6% to 84.8%. The cause is Canvas behaviour in that build, not native layout, which is 98.3% identical to 156. All 5 builds ran all 50 jobs with no crashes, hangs, prompts or prediction errors. WebKit was out of scope: Safari Technology Preview needs an admin installer.

**Builds tested** (official downloads; Firefox dmgs match Mozilla's SHA256SUMS)

| Build | Why |
|---|---|
| Chrome for Testing 152.0.7977.82 | one major older |
| Chrome for Testing 155.0.8048.0 | Dev channel, the newest dev/beta (Beta is 154.0.8037.0) |
| Firefox 157.0b2 | newest beta |
| Firefox 153.3.0esr | next ESR (extra, it was cheap) |
| Firefox 140.16.0esr | current ESR |

Each build ran smoke, runs, ws, policy, the four development suite sample parts, and the round 3 rule and feature families. That is 49,662 Chrome cases and 47,216 Firefox cases, forward order, with the same job cuts as evaluate-r3. The library bundle hash matches round 3's.

**Native drift against the pinned build** (scorer's view: line count, rect lines, x and width)

| Build | Drifted cases | line count | breaks | widths only |
|---|---|---|---|---|
| Chrome 152 | 13 | 3 | 0 | 10 |
| Chrome 155 | 12 | 0 | 0 | 12 |
| Firefox 157.0b2 | 0 | 0 | 0 | 0 |
| Firefox 153.3esr | 262 | 35 | 45 | 182 |
| Firefox 140.16esr | 825 | 199 | 111 | 515 |

None of the drifted cases is history-dependent in the pinned build.

**Prediction pass rates, other build / pinned** (same cases, every case counted)

| Build | lineCount | breaks | widths | Status changes outside drifted cases |
|---|---|---|---|---|
| Chrome 152 | 99.571 / 99.577 | 99.474 / 99.480 | 99.433 / 99.454 | 0 |
| Chrome 155 | equal | equal | equal | 0 |
| Firefox 157.0b2 | equal | equal | equal | 0 |
| Firefox 153.3esr | 99.873 / 99.833 | 99.670 / 99.606 | 98.141 / 98.205 | 0 |
| Firefox 140.16esr | 89.235 / 99.833 | 84.787 / 99.606 | 84.648 / 98.205 | 11,825 cases |

**Top drift classes, with guesses**
1. **Chrome 152 to 153:** a full-width CJK closing mark (」』）】) that doesn't fit at a line end. 153 sets it at half width on the line; 152 leaves it full width, so it overflows or wraps.
   - Guess: a line breaker change (line-end punctuation trimming).
   - Examples: c-f13a88b01c60eb8d (】 20px in 152, 10px in 153), c-716e8068ecda451e (4 lines in 152, 3 in 153), c-9b6b78b8cc269a5c.
   - Families: runs/lang-spans, policy/overflow-wrap, line-break, zh-lang. All 13 now fail a metric.
2. **Chrome 153 to 155:** one Amiri paragraph with a soft hyphen and a kasra, in rule/joining, 1/128 px on the mark (c-21a72526bd402af9, c-302c831c93653fab). Guess: shaping or rounding. All 12 still pass.
3. **Firefox 153 to 156:** every case at 16.8px and 17.3px drifts, and none at 13, 13.33, 16, 17 or 20.5px.
   - That is 256 cases in rule/fit-bound and rule/system-fonts-and-sizes.
   - Native widths differ by 0.1 to 0.2px, which flips lines at the fit bound (c-05677855ecb0fe13, c-0cdb79b1af1c1673, c-013d7f74434b0edf).
   - Guess: font-size arithmetic, not break data.
   - Six emoji sequence widths also moved by 0.38px (c-2ee96aa377b5c3a3).
   - 56 cases gain a pass and 24 lose one.
4. **Firefox 140 to 156:** class 3 plus 563 more.
   - Letter-spacing in Arabic: rule/joining has 464 cases, all with 1px spacing (c-051553446429b808, c-001409f000df8482); runs/letter-spacing-spans has 21 (c-2eb90aa2648b07b7). Guess: text layout around letter-spacing in joined scripts.
   - The rest: Myanmar shaping (U+1039, 10.4px) and a lone surrogate after a soft hyphen.

I saw no ICU break-data drift in any of these sets.

**Catastrophic: Firefox 140 ESR predictions.** I recorded the Canvas calls on smoke in 140 and in 156.
- Firefox 140 has no `ctx.lang`.
- Under the port's 0.001px letter-spacing probe context, 140 keeps the spacing as a fraction (whole text 760.033 against 760, ink edge +0.001). 153 and later snap it to 0. The Gecko port reads that and measures down other paths.
- Of 106 lost smoke cases, 36 differ only by that tiny spacing and 11 by language-dependent widths (Geeza Pro, serif Korean). The other 57 agree on every shared call but make other calls; the one I opened, c-a0ce2a2d1ff61ee3, differs only in the 0.001px ink edge.
- Two rule families fall below 50% on breaks: rule/in-word-breaks at 41% and rule/monospace at 47%.
- The environment check never refused to predict, and every row carries the engine-build gap. The scorer leaves 1,776 of the 5,083 line-count failures without a covering gap.

**What the library should do with an unknown build.** Predicting with the nearest data and saying so is right for neighbouring builds: losses were exactly the drifted cases, at most 0.02 points. The build number is the wrong guard, though. I'd add a cheap one-time Canvas check and report its own gap, or treat such a build as unsupported:
- does `ctx.lang` exist;
- does 0.001px spacing leave width and ink edges unchanged.

**Windows, Android, iOS later.** The page drives itself over HTTP, but the driver's launch, process and version code is macOS-only, so each platform needs a small launcher with a fresh profile (adb for Android Chrome and Firefox; a device or simulator for iOS, where every browser is WebKit and webkit-host doesn't port). The font facts and any case naming a Mac font need per-OS versions. Start with the web-font fixture cases plus smoke and the rule families.

**Files**
- Apps and downloads: `~/github/browser-engines/apps/drift/`
- Runs: `~/github/pretext-rebuild/.artifacts/lab/drift/<build>/<set>-forward/` (rows compressed to .zst, per-case scores, `*-native-drift.ndjson`)
- Summary and logs: `analysis.json`, `native-drift.log` and `score-all.log` in that folder
- Canvas recordings: `probe-ff140-measurements/`
- Tools: `tools/` (run-jobs.py, score-all.sh, native-drift.ts, analyze.py)
- Lab tweak: commit 22d17b4 on r4-drift (Chrome for Testing's executable name, Firefox user agent checked by major version, README note); `LAB_CHROME_APP` and `LAB_FIREFOX_APP` already existed.

I compressed the rows with compress-rows.sh's steps but sent the originals to the Trash, because that script removes them with rm.
