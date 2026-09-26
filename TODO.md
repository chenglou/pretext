# Current Priorities

## 1. Engine Work

- Deferred engine decisions, known gaps and harness debt live in [ENGINE_FOLLOWUPS.md](ENGINE_FOLLOWUPS.md). Finish open landings depth-first before starting new discovery.
- When changing `prepare()`, read the bench's new, seen and worst rows and the `measureText` calls and submitted units `bun harness equal main` prints. Use the lines and rich rows when changing streaming APIs.
- Before changing Safari prefix-width behavior, run the bench's long breakable runs (`--rows=worst`, `long-breakable-runs`). Lower retained memory does not justify a meaningful `prepare()` regression.
- Chinese is the most useful current CJK regression case. Until broader measurements show a rule that applies beyond those cases, treat strongly font- or shaping-sensitive differences in Chinese, Myanmar, and Urdu as limits of the current design.
- Performance work for rich text and manual line layout belongs in the range and cursor APIs.

## 2. Regression Coverage

- Keep the real app text in the harness's sample as the main regression case. Add only real text patterns that the current corpus misses.
- Add corpora only from clean source text. A font joins `harness/sets/weights.json` only with a source for its usage.
- Prefer a new Southeast Asian source that broadens coverage over another wrapped legal or raw-source artifact.

## Open Design Questions

- Should server canvas become a supported measurement backend?
- Is automatic hyphenation in scope beyond caller-provided soft hyphens?
- Are more intrinsic or logical-width APIs needed beyond `measureNaturalWidth()` and fixed-width layout?
- Is a slower diagnostic verification mode useful enough to support without changing `layout()`?
