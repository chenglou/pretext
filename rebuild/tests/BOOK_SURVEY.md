# Fresh own-main book survey

The compact original-chunk catalog excludes every full maintained book. The frozen replay reference protects imported maintained wrapping counts, but keeps only 47 short corpus cases per browser. This supplement chooses the complete text of all 18 maintained books at the narrowest and widest original step-10 widths. It reads inputs, never main or redo outcomes. Each book has its raw source and an ordinary paragraph containing the exact maintained `normalizeSource()` result: 72 cases, about 3.3 million UTF-16 units, with a longest case of 269,747 units. This is a sample of widths, not the full 1,098-point canary sweep.

Generate inputs after applying the producer, using the checkout that contains the original corpus files and the artifact root that contains the original case imports:

```sh
bun rebuild/tests/prepare-book-survey.ts --browser=chrome --repo=<checkout> --artifact-root=<shared-artifacts> --out=<new-catalog>
```

Use `firefox` and `webkit-host` for the other browsers. The producer validates complete original step-10 input populations, book text identity and shape, font, language, direction and styles before selecting the two endpoints. It seals source files, original input files, normalizer, producer and cases. `--widths=3` adds the original middle width when a larger sample is useful. Input manifest format is `pretext-book-survey-inputs/1`; its source paths are absolute and must remain readable. The catalog itself can be relocated without rewriting sealed cases or its manifest.

Run the portable workflow, which owns the browser lock, preserves child failures and invokes the checker:

```sh
bun rebuild/tests/run-book-survey.ts --browser=chrome --catalog=<catalog> --out=<new-run-directory>
```

Capture six jobs sequentially, under one canonical `acquireBrowserAutomationLock()` for the whole workflow. For each predictor, run the same cases file with `--measure-first --chunk=1` in file and reverse order:

- `rebuild/lab/baselines/book-main-predictor.ts`
- `rebuild/lab/baselines/inspected-ranges-predictor.ts`
- `rebuild/lab/baselines/plain-predictor.ts`

The focused redo adapter runs the unchanged full facts-free inspected core and projects its contentful source ranges
and core measurement-call count. It skips expected-observation generation, painting and painter limits; the full
geometry suites retain `no-facts-predictor.ts`. The checker accepts either redo adapter, requires the same one in both
orders, and retains the own-native, complete population, mode, count, source, height and stability checks.
WebKit’s expected-observation port can measure, so this lab-phase removal needs fresh inspected-range/plain opposing
fast native checks before adoption; core trace equality does not prove the native history unchanged.

The main hook sets the original default preparation locale, independently of the paragraph/document language, and captures the actual `prepareWithSegments()` / `layout()` count and height alongside walked source ranges. It prepares exactly the paragraph the same job observes natively. Completed measure-first documents must cover the entire raw row population, and each row must match its exact document index and population; reverse order and document resets are checked. Missing or malformed tags cannot certify a book. Every job needs its own native observation; predict-only rows or a native observation borrowed from another predictor cannot certify this survey. The workflow driver owns browser/process scheduling; this checker never starts a browser.

```sh
bun rebuild/tests/check-book-survey.ts --catalog=<catalog> \
  --main-forward=<main-forward/browser-rows.ndjson> --main-reverse=<main-reverse/browser-rows.ndjson> \
  --redo-forward=<redo-forward/browser-rows.ndjson> --redo-reverse=<redo-reverse/browser-rows.ndjson> \
  --plain-forward=<plain-forward/browser-rows.ndjson> --plain-reverse=<plain-reverse/browser-rows.ndjson> \
  --out=<new-check-directory>
```

`report.json` has the distinct format `pretext-fresh-own-main-book-survey/1`. Every predetermined case stays in the report, including main misses, unavailable evidence and native variation. A strong requirement needs stable actual public main count, stable source ranges, complete own-native scalar and node observations, the exact observed integer content width, passing visible source cuts, and agreeing native block-height and Range-group counts in both orders. These ordinary book paragraphs use integer requested line heights; a fractional or inconsistent line-box advance needs an independent observation and remains inconclusive here. Count and visible-source evaluation uses the shared scorer, without engine rectangle ports, painter success or gap forgiveness.

The main requirement is decided before and independently of redo outcomes. Inspected and plain redo must satisfy every required case in both orders. The checker compares the full scorer native view and physical block height between main, inspected and plain jobs; variation or mismatched environments blocks acceptance and needs review. Actual predicted source ranges and heights must agree between orders and between plain and inspected modes. Stable main failures stay non-required and visible; they are not successful certificates. An incomplete/unavailable obligation, lost required pass or required review exits nonzero. Exit 2 means invalid inputs/protocol; exit 1 means observed failure, inconclusive evidence or review.

The report also preserves the original canary's height-only criterion separately. That helper prepares raw source but paints maintained-normalized source. For each original book/font/width pair and job/order, `crossCaseHeights` compares raw predicted public/model height with the normalized paragraph's own native block height, using the literal `Math.round(difference) === 0` rule. It validates matching environments and styles, and keeps raw own-native height as separate evidence. These are different source contracts: this diagnostic does not establish source cuts, map offsets between sources, or automatically assign a raw/normalized semantic difference to redo. An original height pass may coexist with a wrong-cut main miss and no strong certificate. Fractional line-height diagnostics are unavailable without the maintained helper's independently observed used line-box advance.

The recorded Firefox endpoint result is `.artifacts/tests/book-survey-runs/takeover-20260920/firefox/survey-check/report.json`.
All 72 raw/normalized cases pass redo and plain own-source count and visible cuts in both orders, with zero native
variation, inconclusive evidence or parity/order losses. Main supplies 37 strong certificates and has 35 visible
own-source misses. The original mixed-source height diagnostic passes 29/36 book/width pairs for main, redo and
plain, but main and redo share only 22 passing pairs. Equal totals therefore conceal different passing populations.

These seven main-only height passes mask actual public raw-source count errors. Counts agree between forward and
reverse runs, raw native block and Range-group counts agree, and the requested line height is 32 px. Redo/plain
match each raw paragraph's own native count and visible cuts; main's raw public count instead matches the separate
normalized paragraph's native count:

| Book | Width | Main public raw count | Raw native / redo / plain count | Normalized native count |
|---|---:|---:|---:|---:|
| `ja-rashomon` | 220 | 519 | 517 | 519 |
| `ja-rashomon` | 820 | 139 | 138 | 139 |
| `ja-kumo-no-ito` | 820 | 71 | 70 | 71 |
| `zh-zhufu` | 220 | 854 | 848 | 854 |
| `zh-zhufu` | 820 | 228 | 226 | 228 |
| `zh-guxiang` | 220 | 514 | 507 | 514 |
| `zh-guxiang` | 820 | 136 | 135 | 136 |

The inherited [normalizer](../../tests/wrapping/contracts.ts) explicitly omits Gecko's East Asian segment-break
rules. [RESEARCH.md](../../RESEARCH.md) already records that omission and the choice to observe the Japanese/Chinese
canaries from space-normalized text. These seven legacy passes follow that source transformation; they are not
random numeric error cancellation. Main overcounts its actual raw source by 1–7 lines, while redo's seven corresponding
mixed-source height misses reflect the real difference between the raw and normalized paragraphs. The original
height comparison remains recorded, without becoming a same-source count/cut certificate or withdrawing a genuine
main requirement.

Of main's 29 legacy height passes, 14 lack strong certificates for both ordinary source variants. The seven above
have wrong raw counts; the other seven have matching raw counts but wrong visible cuts: `mixed-app-text` at 220,
`ja-kumo-no-ito` at 220, `ko-unsu-joh-eun-nal` at 220, `th-nithan-vetal-story-7` at 820,
`my-cunning-heron-teacher` at 820, and `my-bad-deeds-return-to-you-teacher` at 220 and 820. A height-only metric cannot
distinguish those cuts. This fresh survey covers all 18 maintained texts at two widths in their original font/language
contexts; it does not certify the full 1,098-point sweep, other font/style combinations or every inherited public
wrapping contract.

`required-cases.ndjson` and `required-obligations.ndjson` retain all strong main requirements even when redo fails. They are review evidence, not an old-census format-2 audited catalog: a blocked report sets each emitted certificate's `certificateAdoptable` to false. Do not adopt the successful subset while silently dropping the survey's unresolved cases. The driver seals complete runtime trees, actual served font bytes, build configuration, inputs and WebKit's executed
host binary. It verifies file populations and hashes after lock acquisition and after all jobs/checking; drift blocks
adoption while preserving child exits and diagnostics. Runs, records, input seals and acceptance sources are hashed; the checker rereads evidence hashes before finishing. It indexes row offsets, scores one case at a time and retains compact summaries, rather than holding six book-scale geometry files in memory. `peakRssBytes` and `elapsedMs` are recorded.

For the independent maintained-required membership inventory:

```sh
python3 rebuild/tests/required-suite-roster.py --artifact-root=<shared-artifacts> --out=<new-roster-directory>
```

This counts merged imported identities and original required aliases separately, and records each browser's frozen reference count states. It proves membership and stored count status only. The original height tolerances, selected Range/span extractor, preparation locale and rich public API contracts still require their maintained wrapping tests.
