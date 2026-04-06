# Corpus Status

This file is the prose pointer map for the checked-in long-form canaries.

Historical reasoning and failed experiments live in [RESEARCH.md](../RESEARCH.md).
Shared mismatch vocabulary lives in [TAXONOMY.md](TAXONOMY.md).

Conventions:
- "anchors" means `300 / 600 / 800` unless noted otherwise
- "step=10" means `300..900`
- values are the last recorded results on this machine, not a promise of universal permanence

## Machine-Readable Sources

- [dashboard.json](dashboard.json) — browser regression gate counts, product-shaped canaries, anchor/sweep status, fine-sweep notes, and font-matrix notes
- [chrome-step10.json](chrome-step10.json) — Chrome `step=10` sweep snapshot
- [safari-step10.json](safari-step10.json) — Safari `step=10` sweep snapshot
- [../accuracy/chrome.json](../accuracy/chrome.json), [../accuracy/safari.json](../accuracy/safari.json), [../accuracy/firefox.json](../accuracy/firefox.json) — browser regression gate snapshots

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
bun run corpus-sweep --id=my-bad-deeds-return-to-you-teacher --start=300 --end=900 --step=10
bun run corpus-font-matrix --id=zh-zhufu --samples=5
bun run corpus-check --id=ur-chughd 300 600 800
bun run corpus-sweep --id=ur-chughd --start=300 --end=900 --step=10
bun run corpus-font-matrix --id=my-bad-deeds-return-to-you-teacher --samples=5
bun run corpus-font-matrix --id=ur-chughd --samples=5
bun run corpus-sweep --browser=safari --all --start=300 --end=900 --step=10 --output=corpora/safari-step10.json
```
