# Focused Gecko dictionary pair

This helper compares two frozen checkout paths with direct native Canvas and Intl answers. It proves complete ordered
questions, segmentation answers and inspected/plain output before timing. No instrumentation or replay remains in
timing cells. Current results and limitations are in [TAKEOVER.md](../TAKEOVER.md).

```sh
GECKO_PAIR_FOREGROUND=1 \
GECKO_BASE_TREE=/absolute/path/to/frozen-base \
GECKO_HEAD_TREE=/absolute/path/to/frozen-head \
bun rebuild/tools/gecko-dictionary-pair-run.ts /absolute/path/to/new-output
```

The wrapper uses pinned Firefox, explicit nonempty page language, screen DPR, `--foreground`, `--require-clean` and
its supplied timer prefs while holding all three maintained browser locks. Activate its dedicated window and page
content during the bounded focus acquisition. The launch flag does not prove focus. Failed acquisition, endpoint focus
loss, incomplete cells or observation errors produce no accepted foreground result. Before/after checks do not prove
continuous focus inside a synchronous cell.

The input corpus/styles and runner build come from the invoking checkout. The checkout paths choose only the two
engine bundles. The output records full equality evidence, source and bundle hashes, observed power/focus and paired
samples. Whole-message preparation/filling and long-range boundary-only work are different measurements.

Optional `GECKO_PAIR_ROUNDS`, `GECKO_PAIR_REPEATS`, `GECKO_CHAT_MESSAGES`, `GECKO_LANGUAGE_MESSAGES`,
`GECKO_LONG_REPEAT` default to 12/4/218/2400/512. Without `GECKO_PAIR_FOREGROUND=1`, recorded focus permits no foreground
claim. `gecko-dictionary-pair-check.ts` rejects incomplete or failed run/probe data and can summarize an existing raw
runner artifact. Synthetic smoke timings are not browser evidence.
