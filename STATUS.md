# 現在のステータス

このファイルは「今どこを見ればいいか」を簡潔に示すマップである。

数値が動いた理由や試したことについては [RESEARCH.md](RESEARCH.md) を参照。
長文コーパスのカナリアについては [corpora/STATUS.md](corpora/STATUS.md) を参照。

## メインダッシュボード

- [status/dashboard.json](status/dashboard.json) — 現在のブラウザ精度・ベンチマーク・コーパス入力をまとめた機械可読サマリ

## ブラウザ精度

- [accuracy/chrome.json](accuracy/chrome.json)
- [accuracy/safari.json](accuracy/safari.json)
- [accuracy/firefox.json](accuracy/firefox.json)
- [accuracy/letter-spacing.json](accuracy/letter-spacing.json)

メモ:
- これはチェックイン済みの `4 fonts x 8 sizes x 8 widths x 30 texts` ブラウザスイープである。
- 公開精度ページは現状ほぼリグレッションゲートであり、メインの指針メトリクスではない。
- letter-spacing スナップショットは Chrome + Safari の簡易オラクルで、フルスイープ行列の一部ではない。

## ベンチマークスナップショット

- [benchmarks/chrome.json](benchmarks/chrome.json)
- [benchmarks/safari.json](benchmarks/safari.json)

メモ:
- Chrome は引き続きメインで維持しているパフォーマンスベースラインである。
- Safari の数値も有用だが、ノイズが大きくウォームアップも予測しづらい。
- チェックイン済み JSON スナップショットはコールド状態でのチェッカー 3 回のメディアンである。アドホックなページ計測値はウォームアップ後で異なることがある。
- ベンチマーク手法やホットパス (`src/analysis.ts`, `src/measurement.ts`, `src/line-break.ts`, `src/layout.ts`, `src/bidi.ts`, `pages/benchmark.ts`) が変わった際にはこれらを再生成すること。

## 長文コーパスのステータス

- [corpora/STATUS.md](corpora/STATUS.md)
- [corpora/dashboard.json](corpora/dashboard.json)
- [corpora/chrome-step10.json](corpora/chrome-step10.json)
- [corpora/safari-step10.json](corpora/safari-step10.json)

## 履歴ログ

- [RESEARCH.md](RESEARCH.md)
