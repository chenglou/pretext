## 開発環境のセットアップ

初回のみ実行する。

```sh
bun install
```

### 日常的に使うコマンド

- `bun start` — <http://localhost:3000> で動作する安定したローカルページサーバー
- `bun run start:windows` — 自動ポートクリーンアップを行わない Windows 向けフォールバック
- `bun run check` — 型チェック、lint、デッドコードスキャン (`knip`)
- `bun test` — 小さく耐久性のある不変条件スイート

### パッケージングとリリース時の確認

- `bun run build:package` — 公開 ESM パッケージ用に `dist/` を出力する
- `bun run package-smoke-test` — tarball をパックし、一時的な JS および TS コンシューマで検証する
- `bun run site:build` — 静的デモサイトを `site/` にビルドする
- `bun run generate:bidi-data` — チェックイン済みの簡略化された Unicode bidi 範囲データを更新する

`prepack` はプレーンな `tsc` を通じて `dist/` を再ビルドするため、ソースインポートでは実行時の `.js` 指定子を正確に保つこと。

### ブラウザ精度とベンチマーク

- `bun run accuracy-check` — Chrome ブラウザスイープ
- `bun run accuracy-check:safari`
- `bun run accuracy-check:firefox`
- `bun run accuracy-snapshot` — `accuracy/chrome.json` を更新する
- `bun run accuracy-snapshot:safari`
- `bun run accuracy-snapshot:firefox`
- `bun run benchmark-check` — Chrome ベンチマークスナップショット。デフォルトはフルページ実行 3 回の中央値で、ローカルでの素早い確認には `--runs=1` を使用する
- `bun run benchmark-check:safari`
- `bun run pre-wrap-check` — `{ whiteSpace: 'pre-wrap' }` 用のコンパクトなバッチ済みブラウザオラクル
- `bun run keep-all-check` — `{ wordBreak: 'keep-all' }` 用のコンパクトなバッチ済みブラウザオラクル。スペースなしの混在スクリプトカナリアを含む
- `bun run symbol-check` — 長い単語内のスペースなしシンボル列に対する Chrome + Safari のコンパクトなバッチ済みオラクル
- `bun run letter-spacing-check` — `{ letterSpacing }` 用のコンパクトなバッチ済みブラウザオラクル。ブラウザごとに 1 つのポスト済みレポートプローブを使い、狭い折り返し、結合マーク、bidi、CJK、絵文字、数字、RTL 句読点、`pre-wrap`、ソフトハイフンをカバーする
- `bun run letter-spacing-snapshot` — Chrome + Safari のコンパクトな `{ letterSpacing }` オラクルから `accuracy/letter-spacing.json` を更新する
- `bun run probe-check` — より小さなブラウザプローブ / 診断用エントリポイント
- `bun run probe-check:safari`
  初回のブレーク不一致時に、プローブ出力には小さなブレークトレースが含まれるようになった。
  `sN:gM` はセグメント / 書記素位置を、`unit` はそのユニットの幅を、`fit` は現在の行頭からの累積フィット幅を表し、`[ours]` / `[browser]` は競合するブレーク境界を示す。
  Safari の URL/クエリ不一致や他のエクストラクタに敏感なケースでは、エンジンを変更する前に `--method=span` で相互チェックすること。

### コーパスツール

- `bun run corpus-check` — 1 つまたは少数の幅で 1 つのコーパスを診断する
- `bun run corpus-check:safari`
- `bun run corpus-sweep` — メンテナンス対象の Chrome `step=10` コーパス幅スイープ
- `bun run corpus-sweep:safari` — メンテナンス対象の Safari `step=10` コーパス幅スイープ
- `bun run corpus-font-matrix` — 同じコーパスを別フォントで実行する
- `bun run corpus-font-matrix:safari`
- `bun run corpus-taxonomy` — 不一致フィールドをステアリングバケットに分類する
- `bun run corpus-status` — `corpora/dashboard.json` を再構築する
- `bun run corpus-status:refresh` — Chrome と Safari の `step=10` スイープを更新し、その後コーパスダッシュボードを更新する

### ステータスダッシュボード

- `bun run status-dashboard` — `status/dashboard.json` を再構築する

## 便利なページ

筋肉記憶に入れておく価値のあるもの。

- `/demos/index`
- `/demos/bubbles`
- `/demos/dynamic-layout`
- `/demos/editorial-engine`
- `/demos/justification-comparison`
- `/demos/markdown-chat`
- `/demos/rich-note`
- `/accuracy`
- `/benchmark`
- `/corpus`

## 現在のソースオブトゥルース

現在チェックイン済みの状況把握には以下を使う。

- [STATUS.md](STATUS.md) — メインのブラウザ精度 + ベンチマークスナップショットへの短いポインタドキュメント
- [status/dashboard.json](status/dashboard.json) — 機械可読なメインダッシュボード
- [accuracy/chrome.json](accuracy/chrome.json), [accuracy/safari.json](accuracy/safari.json), [accuracy/firefox.json](accuracy/firefox.json) — 生のブラウザ精度行
- [accuracy/letter-spacing.json](accuracy/letter-spacing.json) — Chrome + Safari のコンパクトな `{ letterSpacing }` オラクルスナップショット
- [benchmarks/chrome.json](benchmarks/chrome.json), [benchmarks/safari.json](benchmarks/safari.json) — 生のベンチマークスナップショット
- [corpora/STATUS.md](corpora/STATUS.md) — 長文コーパスへの短いポインタドキュメント
- [corpora/dashboard.json](corpora/dashboard.json) — 機械可読なコーパスダッシュボード
- [corpora/chrome-step10.json](corpora/chrome-step10.json), [corpora/safari-step10.json](corpora/safari-step10.json) — チェックイン済みのブラウザ `step=10` コーパススイープスナップショット
- [RESEARCH.md](RESEARCH.md) — 探索ログと、現行モデルの背後にある耐久性のある結論

## ディーププロファイリング

単発のパフォーマンスおよびメモリ調査では、まず実ブラウザから始める。

推奨ループ。

1. `bun start` で通常のページサーバーを起動する。
2. 以下のオプションで隔離された Chrome を起動する。
   - `--remote-debugging-port=9222`
   - 使い捨ての `--user-data-dir`
   - 実行がインタラクティブなら、バックグラウンドスロットリングを無効化する
3. Chrome DevTools または CDP 経由で接続する。
4. ベンチマークページ全体をプロファイリングする前に、小さな専用の再現ページを使う。
5. 以下の順番で質問する。
   - これはベンチマークのリグレッションか?
   - CPU 時間はどこで消費されているか?
   - これはアロケーションのチャーンか?
   - GC 後に保持され続けているものはあるか?

各質問には適切なツールを使う。

- スループット / リグレッション:
  - [pages/benchmark.ts](pages/benchmark.ts)
  - もしくは、問題がベンチマークハーネス全体より狭い場合は、小さな専用ストレステストページ
- CPU ホットスポット:
  - Chrome CPU プロファイラまたはパフォーマンストレース
- アロケーションのチャーン:
  - ワークロード中の Chrome ヒープサンプリング
- 保持メモリ:
  - GC を強制し、ワークロード前のヒープスナップショットを取得、ワークロードを実行し、再度 GC を強制してワークロード後のヒープスナップショットを取得、残存するものを diff する

純粋な Bun/Node のマイクロベンチマークは、安価な仮説検証には依然として有用だが、ブラウザの挙動が問われている場面では最終的な答えにはならない。
