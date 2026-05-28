# Corpus Status

このファイルは、チェックイン済みの長文カナリアに対する散文ポインタマップである。

過去の経緯や失敗した実験は [RESEARCH.md](../RESEARCH.md) に置く。
不一致用の共通語彙は [TAXONOMY.md](TAXONOMY.md) に置く。

規約:
- "anchors" は特記がない限り `300 / 600 / 800` を指す
- "step=10" は `300..900` を指す
- 値はこのマシン上で最後に記録した結果であり、普遍的恒久性の保証ではない

## 機械可読ソース

- [dashboard.json](dashboard.json) — ブラウザリグレッションゲートのカウント、製品形カナリア、anchor/sweep ステータス、fine-sweep ノート、font-matrix ノート
- [chrome-step10.json](chrome-step10.json) — Chrome `step=10` sweep スナップショット
- [safari-step10.json](safari-step10.json) — Safari `step=10` sweep スナップショット
- [../accuracy/chrome.json](../accuracy/chrome.json), [../accuracy/safari.json](../accuracy/safari.json), [../accuracy/firefox.json](../accuracy/firefox.json) — ブラウザリグレッションゲートのスナップショット

## 再計算

便利なコマンド:

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
