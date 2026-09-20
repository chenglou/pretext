# Chat benchmark: ready to run, smoke-tested in three browsers

The benchmark is ready and the gate passes. No real timings exist yet. Only 200-message smokes ran, on a machine whose load average was between 40 and 80, so the times in the smoke reports must not be used as results. The counts and line totals below do not depend on load and were identical in every smoke run.

## The command for tonight

From `~/github/pretext-rebuild-wt/bench`, on branch `x-bench-prep`:

```sh
rebuild/bench/chat-night.sh .artifacts/bench/night-20260919
```

The script runs Chrome, Firefox and webkit-host one after the other, each alone under the exclusive lock, then writes the summary. The output is `<browser>-bench.json`, `<browser>-bench.md`, `<browser>.log` and `summary.md` in `~/github/pretext-rebuild/.artifacts/bench/night-20260919/`, beside the `smoke*` folders.

The script is these four commands, and any of them can be run alone:

```sh
python3 .artifacts/session/with-browser-lock.py bench-chat-chrome --browser=all --exclusive -- bun rebuild/bench/run.ts --browser=chrome --scenarios=chat --headline=10000 --quiet-load=8 --out=.artifacts/bench/night-20260919
python3 .artifacts/session/with-browser-lock.py bench-chat-firefox --browser=all --exclusive -- bun rebuild/bench/run.ts --browser=firefox --scenarios=chat --headline=10000 --quiet-load=8 --out=.artifacts/bench/night-20260919
python3 .artifacts/session/with-browser-lock.py bench-chat-webkit-host --browser=all --exclusive -- bun rebuild/bench/run.ts --browser=webkit-host --scenarios=chat --headline=10000 --quiet-load=8 --out=.artifacts/bench/night-20260919
bun rebuild/bench/report.ts .artifacts/bench/night-20260919/{chrome,firefox,webkit-host}-bench.json > .artifacts/bench/night-20260919/summary.md
```

- **Duration.** Expect about 8 minutes in Chrome, 3 in Firefox and 1 in webkit-host, plus the waits for the lock and for a quiet machine. This is extrapolated from the smokes.
- **`--quiet-load=8`.** Each run holds the lock and waits up to 15 minutes for the 1-minute load average to drop under 8. It then runs whatever the load is. The report says how long it waited, whether the load got there, and the load at both ends.
- **New options.** `--headline=N`, `--headline-passes=N` (default 3), `--phase-passes=N` (default 3), `--quiet-load=N`, `--quiet-wait-min=N`. The README lists them.
- **The `chat` scenario.** `--scenarios` now knows `chat`, and the default run includes it without the headline pass.

## What each row means

There is one page context, with `<html lang="en">`. Every message uses one declaration: 16px `"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif`, line height 20, `white-space: normal`, `overflow-wrap: break-word`. No font facts are supplied. Messages are laid out at 320px, and the resize case uses 260, 380 and 440px. A "layout" means one message at one width.

There are two rows, `chat/mix` and `chat/latin`, each with 1,000 timed messages. The report gives, per variant, the median for the whole set, the time per layout, and measureText calls, contexts made and lines per layout.

| Question | Variant | One repetition |
|---|---|---|
| A. From scratch | `rebuild scratch, count` | For every message, a plain `prepare()` with its font checks and new contexts, then `fillLine` over every line. Nothing is kept across messages. |
| | `rebuild scratch, pieces`, `rebuild scratch, inspect` | The same in the other two modes. `inspect` is the lab's path, which prepares the paragraph for inspection and inspects every line. |
| B. Resize | `rebuild first resize×3, count` | Paragraphs are prepared and filled at 320px before each repetition, outside the timing. The repetition then fills them at three widths they have not met. |
| | `rebuild resize×3 again, count` | The same on paragraphs that have already been filled at those widths. |
| C. Main | `main cold` | `clearCache()` once per batch, then `prepare()` and `layout()` per message, as `pages/benchmark.ts` does. |
| | `main resize×3` | `layout()` at the three widths on handles prepared outside the timing. |
| D. Font checks | `rebuild scratch, count, checks lifted` | The same as A, but the font checks ran outside the timing, so only the engine's `prepare()` and the fill are timed. The difference from A is what the per-paragraph font checks cost, with no instrument in the timed code. |

Three further parts complete the picture:

- **Phases.** One instrumented pass over the 1,000 messages, taken as the median of 3 passes. It times the font checks, the engine's prepare and the fill separately. Within each it records the time inside measureText and the time making contexts, which covers the OffscreenCanvas constructor, `getContext` and every text-attribute assignment. It also sums everything by message kind. Wrappers surround every Canvas call in this pass, so read its shares and take totals from the timed rows.
- **Headline** (`--headline=10000`). Three passes over the first 10,000 messages of each set. The rebuild runs from scratch in count mode and main runs its cold batch, taking turns, and every pass's time is recorded. This is the number to hold against "10k messages relaid from scratch in about 2 s". Afterwards, once per set, all 10,000 paragraphs are prepared, kept, and refilled at the three other widths.
- **Fixed arithmetic.** A fixed integer loop timed before and after each context. It shows whether a background page ran slowly.

The counting pass also checks that the three modes give identical line ranges at all four widths, and that `prepare()` run as its two halves matches them. It flags a row where they differ.

## Corpus mix

The messages come from a seeded generator, `cases.ts` `buildChat`. The first 1,000 are the first 1,000 of the 10,000. Each message is a slice of a corpus that starts and ends at a boundary and holds no newline.

- **By kind, as a share of the mix:**
  - plain ASCII Latin 55%
  - Latin with the source's curly quotes and dashes 8% (16-bit text in Blink)
  - Latin with an emoji 8%
  - Latin with a URL 5%
  - Latin with one inline code span 7%
  - Chinese 7%
  - Arabic 5%
  - slices of `corpora/mixed-app-text.txt` 5%
- **By length.** 25% short (5–19 UTF-16 units), 50% medium (20–100), 22% long (101–400), 3% very long (401–1,500). The length is uniform inside its class. Over the first 1,000 the mean is 111 units, the median 59 and the longest 1,464.
- **What the first 1,000 hold.** 73% are printable ASCII only, 7% have an emoji, 9% CJK, 7% Arabic or Hebrew, 6% a URL, 6% a code span and 0.2% a soft hyphen.
- **The Latin set.** `chat/latin` is plain ASCII only, with the same length classes, from its own stream. It shows the common case beside the mix.
- **The code span.** It is 14px Menlo with 6px of padding on each inline side. The rebuild takes it as a span in the paragraph tree.

Main's and the rebuild's inputs are the same text, and they differ in these places:

- Main's `prepare()` has no inline boxes. A message with a code span goes through main's rich-inline helper, `prepareRichInline` plus `measureRichInlineStats`, with the span as an item with `extraWidth`. The helper charges the full padding on every line a wrapped span touches, where the engines put start padding on the first line and end padding on the last.
- Main has no input for direction or language.
- Main takes no font facts.

In the smokes, main and the rebuild gave the same line totals at 320px in all three browsers. For mix and latin respectively, that was 654 and 639 in Chrome, 651 and 639 in Firefox, and 654 and 639 in webkit-host. At the resize widths the totals were within two lines over 600 layouts.

## Smoke counts per message

These are from 200 messages per set. They were identical in all three smoke runs, including the run under the exclusive lock.

| | Chrome 153 | Firefox 156 | webkit-host 22625 |
|---|---:|---:|---:|
| mix, rebuild plain: measureText calls, contexts | 312.8, 10.9 | 110.7, 3.4 | 38.2, 5.4 |
| mix, rebuild inspected: calls, contexts | 2,614.1, 10.9 | 352.5, 3.5 | 52.4, 5.4 |
| mix, main cold: calls, contexts | 11.9, 0 | 11.9, 0 | 32.4, 0 |
| mix, of plain, the font checks alone: calls, contexts | 10.7, 6.4 | 0, 0 | 9.5, 4.2 |
| mix, a layout at a new width / at a width met before: calls | 138.6 / 138.6 | 28.2 / 0 | 0.1 / 0.1 |
| latin, rebuild plain: calls, contexts | 317.7, 10 | 82.1, 2.9 | 31.4, 5 |
| latin, rebuild inspected: calls | 2,724.4 | 354.6 | 39.4 |
| latin, main cold: calls | 8.4 | 8.4 | 27.9 |
| latin, a layout at a new width: calls | 133.3 | 31.9 | 0 |

Main makes no context in a batch, because it keeps one for the page. Every page had a device pixel ratio of 2. That is why Blink's font checks run at all for text with no soft hyphen and no joining letters: the optical-size check asks whether the primary family scales linearly to the zoomed size.

## Expectation

These are expectations from reading the code, checked against the smokes' counts and shares. They are not results.

- **Chrome.** Measuring should dominate.
  - A message asks about 310 questions, against 12 in main, and makes about 11 contexts.
  - The engine's prepare should be the biggest phase. The smoke phase pass gave roughly 60% prepare, 20–30% fill and 14–18% font checks, with over half of all time inside measureText.
  - The font checks are only 10 of the 310 calls, but 6 of the 11 contexts. The A-against-D pair said lifting them out saved 20–34% in the smokes. So lifting them to once per declaration is worth doing first, because it is simple and cannot change a result.
  - The larger Chrome lever is the number of calls since X2. The fill asks about 140 questions per message per width, and again at every new width. So keeping prepared paragraphs does not make a resize cheap in Blink.
  - From the loaded smokes' 0.5–1 ms per message, I expect 10,000 messages from scratch to take several seconds in Chrome today, not 2 s. A resize of 10,000 kept paragraphs should cost about a second per width.
- **WebKit.** The font checks and context making dominate: 9.5 of 38 calls and 4.2 of 5.4 contexts. The `checks lifted` variant ran at about 0.55× of from-scratch in the smokes, and making contexts was about a third of all time. The per-declaration lift is clearly the first thing to do here. The rebuild was already faster than main in the WebKit smokes, and the fill asks Canvas almost nothing.
- **Firefox.** Gecko's checks ask nothing, so there is nothing to lift.
  - The fill dominates at 60–75%, because Gecko asks Canvas for positions inside the word that crosses each line's end.
  - CJK is the hot spot. In the smoke's by-kind table a CJK message cost about 14 times a Latin one: 312 calls for 80 units, nearly all in the fill. Both times are from the same page, so the ratio should hold.
- **One resolver per font declaration** that outlives a paragraph would serve both the checks and, later, the contexts. Sharing engine contexts across paragraphs in Chrome needs care, because Chrome's per-canvas word cache makes the first shaping of a word win.

## Problems

1. **`--exclusive` alone is not honoured.** `with-browser-lock.py` reads `--browser=` from the command and takes a single slot when `--exclusive` is passed alone. The lock only becomes exclusive with `--browser=all --exclusive`. The script and the README use that form. The wrapper is outside my worktree and I left it alone.
2. **The exclusive lock does not mean a quiet machine.** The load average was 70–80 while my run held it. `--quiet-load=8` waits up to 15 minutes per browser with the lock held, which blocks other browser jobs during the wait, and then runs anyway and says so. The orchestrator still has to pick the moment or pause heavy jobs.
3. **Background windows only.** Absolute times may exceed a foreground run's. The report records the fixed arithmetic so the two can be compared. There is no quiet baseline for it yet; it was 49–61 ms under load.
4. **The 10,000 kept paragraphs are untried.** That is about 45,000 live contexts in Chrome. The part runs last in the page, after everything else has posted, so a failure there loses only that number. The driver would then fail after `--stall-ms`, which is 20 minutes.
5. **The phase pass and the A-against-D pair disagree in Chrome** on the font checks' share: 14–18% against 20–34%. Trust A against D, which has no instrument in the timed code.
6. **Firefox's `checks lifted` variant wandered by about ±10%** around the plain one in the smokes, although Gecko's checks ask nothing. I put this down to smoke noise. If the real run does not put it at 1.0, something else differs and is worth a look.
7. **The default run is longer.** The default scenarios now include the chat rows without the headline pass, so the older "real run" commands take a few minutes more.
8. **`report.ts` held two literal NUL bytes** that were meant as `\0` escapes. They are the escapes now, and behaviour is unchanged.
9. **Docs outside `rebuild/bench/` were left alone.** They are being edited in other worktrees. DESIGN.md's one-line description of the bench is still true.

## Gate

- `bunx tsc --noEmit -p rebuild/bench/tsconfig.json` is clean.
- `bun test rebuild` gives 814 pass and 0 fail. The bench's own tests are 8, including the chat generator's prefix property, shares and the ASCII-only set.
- Smokes ran in Chrome, Firefox and webkit-host, twice through a browser slot and once through `chat-night.sh` under the exclusive lock, plus one Chrome smoke of the older cold, sweep and many rows. Every run passed on its first attempt, the counts were identical across runs, and the modes' line ranges agreed in every row.
- `rebuild/src` was not touched.

## Limits

- with-browser-lock.py does not honour --exclusive alone when the command names a browser: it takes one of that browser's slots. Only --browser=all --exclusive is exclusive. chat-night.sh and the README use that form. The wrapper was left alone because it is outside my worktree.
- The exclusive lock does not make the machine quiet: the load average was 70-80 while my exclusive smoke held it, from other agents' non-browser work. --quiet-load=8 waits up to 15 minutes per browser with the lock held (blocking other browser jobs meanwhile), then runs anyway and records that. The orchestrator still has to pick a quiet moment or pause heavy jobs.
- Runs are in background windows only, by the night's rules, so absolute times can exceed a foreground run's. The report records a fixed arithmetic loop (spinMs) for comparison; there is no quiet-machine baseline for it yet (49-61 ms under load).
- The 10,000-message pass was not run, as instructed. Its last part holds 10,000 prepared paragraphs at once (about 45,000 live contexts in Chrome), which no smoke has tried. It runs last in the page, so a failure loses only that number, and the driver then fails after --stall-ms (20 minutes).
- The smoke times came from a machine at load 40-80 and are not results. Only calls, contexts and lines per message are load-independent. The phase shares and the A-against-D ratios quoted as expectation came from those loaded smokes.
- In Chrome the instrumented phase pass puts the font checks at 14-18% of from-scratch time, while the uninstrumented A-against-D pair puts them at 20-34%. Trust A against D.
- In Firefox the 'checks lifted' variant wandered about +/-10% around the plain one in the smokes, although Gecko's font checks ask nothing. This is likely smoke noise (2-3 samples under load). If the real run does not give 1.0, something else differs.
- In the Firefox smoke a CJK message cost about 14 times a Latin one (312 measureText calls for 80 units, nearly all in the fill). This looks like Gecko's hot spot for the mix and is worth checking in the real run's by-kind table.
- The default scenarios now include the chat rows (without the headline pass), so the older 'real run' commands take a few minutes longer.
- report.ts held two literal NUL bytes that were meant as \0 escapes. They are now the escapes; behaviour is unchanged and the file is NUL-free.
- Docs outside rebuild/bench (DESIGN.md's one-line bench description, the lab README) were not edited, because other worktrees are changing them. They are still accurate.

## The real pass (2026-09-19, 07:03 to 07:37 PDT, library b3421fc, the X3 merge)

One run of `rebuild/bench/chat-night.sh`, background windows, no supplied font facts, on AC power. Chrome started after its 15-minute wait for a quiet machine ran out, at a load average of 48 that fell to 5 during its run (the page's fixed arithmetic took 60.7 ms before and 29.1 ms after, so its early rows ran about twice as slow as its late ones; the three headline passes came late and agree: 9.02 s, 9.90 s, 9.59 s). Firefox and webkit-host ran on a quiet machine (load 5 and 3). Treat Chrome's timed rows as upper bounds until the quiet rerun; the counts don't depend on load.

**Note of 2026-09-20: this pass's times don't stand for Chrome and webkit-host, main's rows included.** Quiet reruns the same evening gave Chrome 4.6 s and 4.0 s and webkit-host 0.235 s and 0.195 s from scratch, and main's cold prepare at 0.31 s in webkit-host; main's cold prepare in Chrome is 0.31 to 0.34 s in over 25 later reports, not 0.72 s (research/PROFILING-START.md has both corrections). The tables below are this run's record and are left as they were; the counts stand.

**Against the maintainer's bar** ("if 10k messages relaid from scratch is about 2 s after the perf work, drop the ideal that we can be stateless"), before any perf work, 10,000 chat messages from scratch:

| | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| the mix (27% of messages hold emoji, CJK, Arabic, a URL or a code span) | 9.59 s | 2.63 s | 11.7 s |
| plain ASCII messages only | 4.16 s | 0.61 s | 8.83 s |
| main, cold prepare, the mix | 0.72 s | 0.30 s | 1.53 s |
| the same 10,000 kept and laid out at 3 new widths (the mix) | 4.04 s | 0.70 s | 0.21 s |
| main, layout at 3 new widths | 0.008 s | 0.014 s | 0.014 s |

**Where the time goes from scratch (the mix):**
- Chrome: 31% the runtime font checks, 56% the engine's prepare, 13% the fill; 39% inside measureText, 43% MAKING CANVAS CONTEXTS (11 a message), 18% outside Canvas. 322 measureText calls a message against main's 7.
- webkit-host: 26% the font checks, 74% prepare, under 1% the fill; 98% inside measureText at only 41 calls a message (main: 17 calls, 153 µs a message; the rebuild: 1.17 ms), so each call is about three times as dear as main's: the rebuild makes 5.4 new contexts a message, and a context's first measure pays for resolving its font.
- Firefox: the fill is 88%; nothing to lift from the font checks (Gecko's ask nothing); CJK and Arabic messages carry the mix (plain ASCII is 0.61 s).

**What this says for the profiling phase, in order of expected payoff:** (1) the measurer's lifetime: contexts and font-check answers made once per font declaration per page instead of per paragraph (Chrome's 43% + 31%, WebKit's 26% and most of its per-call cost); (2) Chrome's repeated questions inside one fill and at a new width (137 calls per relayout where Firefox asks 28 and WebKit 0.1): positions kept per fill, and widths kept on the prepared paragraph; (3) Firefox's CJK and Arabic fill; (4) the recipes `RECIPE-COSTS.md` found to buy nothing. Relayout in WebKit (7 µs a layout) and Firefox (23 µs at a new width, 6 µs at a width met before) is already in a usable range; Chrome's (135 µs) is not.

### mix

| | chrome | firefox | webkit-host |
|---|---:|---:|---:|
| A. rebuild from scratch, count mode, per message (1,000 messages) | 1.21 ms (whole set 1.21 s) | 279 µs (whole set 279 ms) | 1.12 ms (whole set 1.12 s) |
| A. measureText calls per message | 322.13 | 120.44 | 41.15 |
| A. contexts made per message | 11.07 | 3.56 | 5.38 |
| A. headline: 10,000 messages from scratch, median of 3 passes | 9.59 s (959 µs per message; passes 9.02 s, 9.90 s, 9.59 s) | 2.63 s (263 µs per message; passes 2.70 s, 2.63 s, 2.61 s) | 11.7 s (1.17 ms per message; passes 11.5 s, 11.7 s, 11.8 s) |
| A. the same with the pieces read | 1.34 ms (whole set 1.34 s) | 280 µs (whole set 280 ms) | 1.13 ms (whole set 1.13 s) |
| A. measureText calls per message, pieces | 322.13 | 120.44 | 41.15 |
| A. the same prepared for inspection and inspected | 4.30 ms (whole set 4.30 s) | 409 µs (whole set 409 ms) | 1.50 ms (whole set 1.50 s) |
| A. measureText calls per message, inspected | 1,712.51 | 363.7 | 54.15 |
| A. contexts made per message, inspected | 11.14 | 3.65 | 5.44 |
| B. rebuild, first layout at a new width, per layout | 211 µs (whole set 632 ms) | 20.8 µs (whole set 62.3 ms) | 6.96 µs (whole set 20.9 ms) |
| B. measureText calls per layout, new width | 136.8 | 28.09 | 0.12 |
| B. rebuild, layout at a width met before, per layout | 116 µs (whole set 349 ms) | 5.67 µs (whole set 17.0 ms) | 6.70 µs (whole set 20.1 ms) |
| B. measureText calls per layout, width met before | 136.79 | 0 | 0.12 |
| B. headline: 10,000 kept paragraphs at 3 new widths, once | 4.04 s (135 µs per layout); main 8.31 ms (0.277 µs) | 703 ms (23.4 µs per layout); main 13.6 ms (0.455 µs) | 212 ms (7.05 µs per layout); main 13.5 ms (0.449 µs) |
| C. main cold, per message | 86.5 µs (whole set 86.5 ms) | 34.5 µs (whole set 34.5 ms) | 502 µs (whole set 502 ms) |
| C. main measureText calls per message | 6.71 | 6.69 | 17.14 |
| C. headline: main cold, 10,000 messages | 724 ms (72.4 µs per message; passes 724 ms, 713 ms, 725 ms) | 301 ms (30.1 µs per message; passes 292 ms, 301 ms, 324 ms) | 1.53 s (153 µs per message; passes 1.59 s, 1.53 s, 1.53 s) |
| C. main layout at another width, per layout | 0.528 µs (whole set 1.58 ms) | 0.347 µs (whole set 1.04 ms) | 0.290 µs (whole set 869 µs) |
| A against C: rebuild from scratch over main cold | ×13.9 | ×8.10 | ×2.24 |
| B against C: rebuild at a new width over main layout | ×399 | ×59.8 | ×24.0 |
| D. from scratch with the font checks lifted out, per message | 838 µs (whole set 838 ms) | 277 µs (whole set 277 ms) | 858 µs (whole set 858 ms) |
| D. share of from scratch: font checks / engine prepare / fill | 31.3% / 56.0% / 12.7% | 0.3% / 11.3% / 88.4% | 25.6% / 74.0% / 0.5% |
| D. share of from scratch: inside measureText / making contexts / outside Canvas | 39.4% / 42.7% / 18.0% | 58.4% / 4.8% / 36.8% | 97.7% / 1.0% / 1.3% |
| D. font checks: measureText calls and contexts per message | 10.78 and 6.38 | 0 and 0 | 9.51 and 4.25 |
| Fixed arithmetic in the page, before and after | 60.7 ms, 29.1 ms | 31.8 ms, 27.2 ms | 27.6 ms, 27.4 ms |

### latin

| | chrome | firefox | webkit-host |
|---|---:|---:|---:|
| A. rebuild from scratch, count mode, per message (1,000 messages) | 1.02 ms (whole set 1.02 s) | 59.1 µs (whole set 59.1 ms) | 819 µs (whole set 819 ms) |
| A. measureText calls per message | 281.86 | 78.35 | 30 |
| A. contexts made per message | 10 | 2.94 | 5 |
| A. headline: 10,000 messages from scratch, median of 3 passes | 4.16 s (416 µs per message; passes 7.59 s, 4.16 s, 4.04 s) | 610 ms (61.0 µs per message; passes 610 ms, 629 ms, 599 ms) | 8.83 s (883 µs per message; passes 8.80 s, 8.89 s, 8.83 s) |
| A. the same with the pieces read | 785 µs (whole set 785 ms) | 62.5 µs (whole set 62.5 ms) | 828 µs (whole set 828 ms) |
| A. measureText calls per message, pieces | 281.86 | 78.35 | 30 |
| A. the same prepared for inspection and inspected | 2.17 ms (whole set 2.17 s) | 177 µs (whole set 177 ms) | 1.06 ms (whole set 1.06 s) |
| A. measureText calls per message, inspected | 1,576.52 | 333.59 | 38.31 |
| A. contexts made per message, inspected | 10 | 3 | 5 |
| B. rebuild, first layout at a new width, per layout | 78.7 µs (whole set 236 ms) | 18.8 µs (whole set 56.5 ms) | 2.36 µs (whole set 7.08 ms) |
| B. measureText calls per layout, new width | 112.92 | 29.55 | 0 |
| B. rebuild, layout at a width met before, per layout | 68.1 µs (whole set 204 ms) | 4.74 µs (whole set 14.2 ms) | 2.15 µs (whole set 6.44 ms) |
| B. measureText calls per layout, width met before | 112.91 | 0 | 0 |
| B. headline: 10,000 kept paragraphs at 3 new widths, once | 3.26 s (109 µs per layout); main 6.82 ms (0.227 µs) | 645 ms (21.5 µs per layout); main 16.2 ms (0.541 µs) | 88.5 ms (2.95 µs per layout); main 11.6 ms (0.385 µs) |
| C. main cold, per message | 36.1 µs (whole set 36.1 ms) | 21.7 µs (whole set 21.7 ms) | 417 µs (whole set 417 ms) |
| C. main measureText calls per message | 4.57 | 4.57 | 14.42 |
| C. headline: main cold, 10,000 messages | 201 ms (20.1 µs per message; passes 207 ms, 201 ms, 199 ms) | 195 ms (19.5 µs per message; passes 195 ms, 194 ms, 195 ms) | 1.00 s (100 µs per message; passes 1.00 s, 1.00 s, 1.01 s) |
| C. main layout at another width, per layout | 0.321 µs (whole set 963 µs) | 0.292 µs (whole set 877 µs) | 0.247 µs (whole set 741 µs) |
| A against C: rebuild from scratch over main cold | ×28.2 | ×2.73 | ×1.96 |
| B against C: rebuild at a new width over main layout | ×245 | ×64.4 | ×9.55 |
| D. from scratch with the font checks lifted out, per message | 625 µs (whole set 625 ms) | 59.5 µs (whole set 59.5 ms) | 571 µs (whole set 571 ms) |
| D. share of from scratch: font checks / engine prepare / fill | 15.9% / 63.6% / 20.5% | 1.1% / 33.6% / 65.3% | 28.8% / 70.9% / 0.3% |
| D. share of from scratch: inside measureText / making contexts / outside Canvas | 56.3% / 12.1% / 31.6% | 37.5% / 17.2% / 45.3% | 97.5% / 1.2% / 1.3% |
| D. font checks: measureText calls and contexts per message | 10 and 6 | 0 and 0 | 9 and 4 |
| Fixed arithmetic in the page, before and after | 60.7 ms, 29.1 ms | 31.8 ms, 27.2 ms | 27.6 ms, 27.4 ms |
