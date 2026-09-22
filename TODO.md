# Current Priorities

On the redo branch, [rebuild/README.md](rebuild/README.md) sets the active goal and [rebuild/TAKEOVER.md](rebuild/TAKEOVER.md) records current decisions and validation. The items below concern the existing public engine.

The current [prepared plaintext round](rebuild/PREPARED_LAYOUT_EXPERIMENT.md) specializes public count-only layout;
the redo core matches `0bdea4d`. Next, test preparation ownership and broader numeric representations against main's
genuine native successes. Exact identity source maps are deferred behind that work. Rich painting remains paused.

## 1. Engine Work

- Deferred engine decisions, known gaps and harness debt live in [ENGINE_FOLLOWUPS.md](ENGINE_FOLLOWUPS.md). Finish open landings depth-first before starting new discovery.
- Use the separate `analyze()` and `measure()` benchmark columns when changing `prepare()`. Use the chunk-heavy rich-text rows when changing streaming APIs.
- Before changing Safari prefix-width behavior, run the synthetic long breakable text case (`synthetic-long-breakable-runs`). Lower retained memory does not justify a meaningful `prepare()` regression.
- Chinese is the most useful current CJK regression case. Until broader measurements show a rule that applies beyond those cases, treat strongly font- or shaping-sensitive differences in Chinese, Myanmar, and Urdu as limits of the current design.
- Performance work for rich text and manual line layout belongs in the range and cursor APIs.

## 2. Regression Coverage

- Keep mixed app text as the main app-like regression case. Add only real text patterns that the current corpus misses.
- Add corpora only from clean source text. Expand the font matrix only around a case with a reproducible mismatch.
- Prefer a new Southeast Asian source that broadens coverage over another wrapped legal or raw-source artifact.

## Open Design Questions

- Should server canvas become a supported measurement backend?
- Is automatic hyphenation in scope beyond caller-provided soft hyphens?
- Are more intrinsic or logical-width APIs needed beyond `measureNaturalWidth()` and fixed-width layout?
- Is a slower diagnostic verification mode useful enough to support without changing `layout()`?
