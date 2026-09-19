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
