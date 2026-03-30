# Corpus Status

Machine-readable long-form corpus status lives in JSON.

This file is prose-only. Historical reasoning, failed experiments, and why the
numbers moved live in [RESEARCH.md](/Users/chenglou/github/pretext/RESEARCH.md).
The shared mismatch vocabulary lives in [TAXONOMY.md](/Users/chenglou/github/pretext/corpora/TAXONOMY.md).

Conventions:
- "anchors" means `300 / 600 / 800` unless noted otherwise
- "sampled" usually means `--samples=9`
- "step=10" means `300..900`
- values are the last recorded results on this machine, not a claim of universal permanence

## Machine-Readable Sources

- Corpus dashboard: [dashboard.json](/Users/chenglou/github/pretext/corpora/dashboard.json)
- Anchor rows: [representative.json](/Users/chenglou/github/pretext/corpora/representative.json)
- Chrome sampled sweep snapshot: [chrome-sampled.json](/Users/chenglou/github/pretext/corpora/chrome-sampled.json)
- Chrome coarse `step=10` sweep snapshot: [chrome-step10.json](/Users/chenglou/github/pretext/corpora/chrome-step10.json)
- Browser regression gate snapshots: [accuracy/chrome.json](/Users/chenglou/github/pretext/accuracy/chrome.json), [accuracy/safari.json](/Users/chenglou/github/pretext/accuracy/safari.json), [accuracy/firefox.json](/Users/chenglou/github/pretext/accuracy/firefox.json)

The corpus dashboard JSON carries:
- browser regression gate counts
- product-shaped canary status
- long-form corpus anchor and sweep status
- fine-sweep notes
- font-matrix notes

## Recompute

Useful commands:

```sh
bun run status-dashboard
bun run corpus-status:refresh
bun run corpus-taxonomy --id=ja-rashomon 330 450
bun run corpus-taxonomy --id=zh-zhufu 300 450
bun run corpus-taxonomy --id=ur-chughd 300 340 600
bun run corpus-check --id=ko-unsu-joh-eun-nal 300 600 800
bun run corpus-check --id=ja-kumo-no-ito 300 600 800
bun run corpus-check --id=ja-rashomon 300 600 800
bun run corpus-check --id=zh-guxiang 300 600 800
bun run corpus-check --id=zh-zhufu 300 600 800
bun run corpus-sweep --id=zh-guxiang --start=300 --end=900 --step=10
bun run corpus-sweep --id=ja-kumo-no-ito --start=300 --end=900 --step=10
bun run corpus-sweep --id=ja-rashomon --start=300 --end=900 --step=10
bun run corpus-sweep --id=zh-zhufu --start=300 --end=900 --step=10
bun run corpus-font-matrix --id=zh-guxiang --samples=5
bun run corpus-sweep --id=my-cunning-heron-teacher --start=300 --end=900 --step=10
bun run corpus-sweep --id=my-bad-deeds-return-to-you-teacher --samples=9
bun run corpus-font-matrix --id=zh-zhufu --samples=5
bun run corpus-check --id=ur-chughd 300 600 800
bun run corpus-sweep --id=ur-chughd --start=300 --end=900 --step=10
bun run corpus-font-matrix --id=my-bad-deeds-return-to-you-teacher --samples=5
bun run corpus-font-matrix --id=ur-chughd --samples=5
bun run corpus-representative
```
