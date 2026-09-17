# Ceiling round 1 evaluation: verdict and open bugs

Paths are relative to `~/github/pretext-rebuild`. The tables are in REPORT.md §2 to §7, and the evaluation outputs are under `.artifacts/ceiling-20260917/evaluate/`.

## Plain verdict

**The practical correctness ceiling isn't reached yet.**

What holds:
- **Features are ported.** Every input of the stage 5 tree model predicts in all three engines, and no row raised `UnportedFeature`.
- **Chrome has no prediction failure without a gap** on the development, held-out 09-16, rule-family, feature-family or sealed sets.
- **The sealed set generalizes.** It scores like the development sets.

What remains, by the brief's rule:
- **20 prediction failures without a gap in Firefox**, in 19 cases, none of them on the sealed set.
- **8 in webkit-host**, 6 of them on the sealed set.
- **Feature families are partly unobserved.**
  - Element rects and slot rows aren't scored.
  - About 2,100 feature line counts are unobserved: Chrome 719, Firefox 670, webkit-host 705.
- **Several gaps fire far wider than their failures.** Their lift is below 2, so a report doesn't locate a failure.
  - WebKit `page-history`: 5,367 development reports.
  - Blink `script-context` and `in-word-prefix`: lift about 1.1.
  - The source doesn't contradict these gaps, but they don't show where failures are.

Most open items belong to the lab or to naming, not to engine rules:
- 11 are a broken slot protocol.
- 9 need a Gecko gap name or probe.
- 6 are sealed WebKit cases that can only be counted.

## Remaining open bugs by engine

Counts are prediction failures (lineCount, breaks or widths) whose layout reports no gap, from forward runs outside history dependence.

### Blink (Chrome 153)
- **Without a gap:** 0 on every set.
- **Gap to verify at the failing edge:**
  - `c-01763358db8471a3` (held-out 09-16, `suite/space`, `a\tب\xadِب`, Shantell Sans, pre-wrap): 3 lines predicted, 4 native.
  - It newly reports `glyph-clusters` at the chosen edge, and no probe settles that edge.
  - It is a pass lost against the charter evaluation.
- **Painter-only without a gap:** rule families 42, feature families 108 (`box-edges` 72), development 14, held-out 09-16 12, sealed 22.

### Gecko (Firefox 156)
**Feature families: 9 slot-protocol rows** (`rule/line-slots`)
- **Ids:** `c-0011200bf7ddcc7c`, `c-2c6803d9cbcda5b2`, `c-467eed32265be1fc`, `c-58a71c38160c6bcc`, `c-68ab6ca019458ae8`, `c-728762d7d388e5d1`, `c-e2c34906071b2178`, `c-edcf7f94dd9ac9be`, `c-f168de2a9b06fbe6`.
- **What happens:** row 0's two insets plus the 10px indent are wider than the block. Firefox puts row 0's right float one row lower.
- **Where the fix goes:** derivation or the scorer, not the engine.

**1 au widths with no gap name** (specs/gecko-canvas.md §3 N7, inferred)
- **Development:** `c-13c64a6ce641374d`, `c-8f9cd18c645671da`, `c-fcbb3bc755b5a5e8`, `c-268ee59b15a407a8` (in smoke and runs).
- **Held-out 09-16:** `c-02e7d131f09e05b9`, `c-d575ffd182517ddc`, `c-e05daec9b21bfc36`.

**Other widths with no gap on the layout**
- `c-daf9c7047097f77b`: a Helvetica Neue ligature whose width equals its parts, 249 au against 217.
- `c-9d23fb8693d45e81` and `c-f716dcbf1c7bbf6f` (`runs/span-at-space`): 69 au. The observation port marks the value limited by `in-word-prefix`, but the layout reports no gap.

**Sealed:** 0.

**Painter-only without a gap:** feature families 233 (`text-align` 100, `box-edges` 73), development 179, held-out 09-16 111, sealed 125.

### WebKit (webkit-host on WebKit 22625.1.29.11.27)
- **Feature families, 2 slot-protocol rows:** `c-303d850e42b725dd`, `c-32a0d43aea9861a7`. Same float drop as in Firefox.
- **Sealed, 6:** 4 line counts and 2 breaks in the sealed suite sample. Counts only; naming them would burn the set.
- **Painter-only without a gap:** rule families 39, development 376, held-out 09-16 375, sealed 343.

## Numbers behind the verdict

Suite-sample line counts, development / held-out 09-16 / sealed:

| Browser | Development | Held-out 09-16 | Sealed |
|---|---:|---:|---:|
| Chrome | 99.55% | 98.98% | 99.12% |
| Firefox | 99.68% | 99.50% | 99.74% |
| webkit-host | 99.92% | 99.68% | 99.84% |

Predicted observation values agree:

| Browser | Rule families | Feature families | Development | Held-out 09-16 | Sealed |
|---|---:|---:|---:|---:|---:|
| Chrome | 99.087% | 99.559% | 99.851% | 99.751% | 99.775% |
| Firefox | 95.397% | 99.809% | 99.964% | 99.985% | 99.993% |
| webkit-host | 98.940% | 99.905% | 99.709% | 99.734% | 99.714% |

History-dependent cases:
- **Chrome:** 0 everywhere.
- **Firefox:** development 123, held-out 09-16 190, sealed runs 66, sealed suite 128.
- **webkit-host:** rule families 6; development 82; held-out 09-16 134; sealed 121.

Against the charter evaluation, lost / gained:

| Browser | lineCount | breaks | widths | painter | Where the losses are |
|---|---|---|---|---|---|
| Chrome | 1 / 61 | 3 / 146 | 0 / 136 | 99 / 79 | All under gaps; 93 painter losses are on cases whose prediction now passes (fix-r12) |
| Firefox | 0 / 0 | 0 / 1 | 0 / 4 | 0 / 1 | None |
| webkit-host | 22 / 33 | 22 / 34 | 1 / 40 | 7 / 58 | `rule/joining` under `rtl-shaping-across-inline-boxes` |

Against main, line counts on the development suite sample:

| Browser | Main | Rebuild | Main-only passes |
|---|---:|---:|---:|
| Chrome | 15,400 | 19,905 | 20 |
| Firefox | 17,734 | 19,697 | 29 |
| webkit-host | 15,625 | 19,843 | 5 |

Every main-only pass reports a gap.

## What would close the gap to the ceiling
1. **Scorer: check native floats against `lineSlots`** per row, and have derivation avoid rows whose insets and indent exceed the width. Clears 11.
2. **Scorer: compare `Element.getClientRects()`.** Observes about 2,100 feature line counts.
3. **Architect: a probe and gap names** for Gecko's 1 au class and the ligature class, and a decision on the 69 au span edges. Clears 9.
4. **Blink owner: probe `glyph-clusters`** at the `c-01763358db8471a3` edge.
5. **Narrow the broad gaps.** WebKit `page-history` fires on 5,367 development cases where the charter reported 75, with lift below 1.
6. **Rerun installed Safari** on the combined files, including families and sealed, once the stalled hidden page is understood.
