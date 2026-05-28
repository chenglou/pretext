# Corpora

ブラウザレイアウト実験向けの長文ストレスコーパス初期セット。

これらのファイルは、現行の 7680 ケースのブラウザスイープを超えて言語や句読法を調査する際に安定したカナリアを持てるよう、リポジトリにチェックインしてある。メインのコーパス群は `/corpus` と `/benchmark` の長文行に組み込まれており、ステータスページが現在の結果に関する簡潔な真実の源となる。

現在のバンドル:

- `mixed-app-text.txt`
  - 言語: 混在 / アプリ風
  - ソース: リポジトリ内に保持する合成コーパス
  - 取得方法: URL、引用クラスタ、RTL/LTR の混在ラン、絵文字 ZWJ、ハードスペース、ワードジョイナ、ゼロ幅ブレイク、ソフトハイフンを網羅する手作業キュレーションのストレステキスト

- `en-gatsby-opening.txt`
  - 言語: 英語
  - ソース: F. Scott Fitzgerald, `The Great Gatsby` 冒頭
  - URL: <https://www.gutenberg.org/ebooks/64317>
  - 取得方法: 長文 Gatsby カナリアテキストのチェックイン済みコピー。現在は共通コーパスツール経由でルーティング

- `ja-rashomon.txt`
  - 言語: 日本語
  - ソース: 芥川龍之介, `羅生門`
  - URL: <https://ja.wikisource.org/wiki/%E7%BE%85%E7%94%9F%E9%96%80>
  - 取得方法: Wikisource `parse` API。ルビ表記とページ/ライセンスの足場を除去し、本文部分にトリミング

- `ja-kumo-no-ito.txt`
  - 言語: 日本語
  - ソース: 芥川龍之介, `蜘蛛の糸`
  - URL: <https://ja.wikisource.org/wiki/%E8%9C%98%E8%9B%9B%E3%81%AE%E7%B3%B8>
  - 取得方法: Wikisource `parse` API。ルビの残骸と PD/ライセンスの足場を除去し、本文部分にトリミング

- `ko-unsu-joh-eun-nal.txt`
  - 言語: 韓国語
  - ソース: Hyun Jin-geon, `운수 좋은 날`
  - URL: <https://ko.wikisource.org/wiki/%EC%9A%B4%EC%88%98_%EC%A2%8B%EC%9D%80_%EB%82%A0>
  - 取得方法: Wikisource `extracts` API、軽くクリーンアップ

- `ko-sonagi.txt`
  - 言語: 韓国語
  - ソース: Hwang Sun-won, `소나기`
  - URL: <https://ko.wikisource.org/wiki/%EC%86%8C%EB%82%98%EA%B8%B0>
  - 取得方法: Wikisource `extracts` API。固定幅のソース折り返しを除くよう再整形

- `zh-zhufu.txt`
  - 言語: 中国語
  - ソース: 魯迅, `祝福`
  - URL: <https://zh.wikisource.org/zh-hant/%E7%A5%9D%E7%A6%8F>
  - 取得方法: Wikisource の生テキスト。ヘッダテンプレートを除去後、本文部分にトリミング

- `zh-guxiang.txt`
  - 言語: 中国語
  - ソース: 魯迅, `故鄉`
  - URL: <https://zh.wikisource.org/wiki/%E6%95%85%E9%84%89>
  - 取得方法: Wikisource `parse` の出力。ページ番号の足場とヘッダテーブルを取り除き、散文段落のみ保持

- `th-nithan-vetal-story-1.txt`
  - 言語: タイ語
  - ソース: `นิทานเวตาล/เรื่องที่ 1`
  - URL: <https://th.wikisource.org/wiki/%E0%B8%99%E0%B8%B4%E0%B8%97%E0%B8%B2%E0%B8%99%E0%B9%80%E0%B8%A7%E0%B8%95%E0%B8%B2%E0%B8%A5/%E0%B9%80%E0%B8%A3%E0%B8%B7%E0%B9%88%E0%B8%AD%E0%B8%87%E0%B8%97%E0%B8%B5%E0%B9%88_1>
  - 取得方法: Wikisource `parse` API。ヘッダナビゲーションと末尾の脚注を除去し、本文部分にトリミング

- `th-nithan-vetal-story-7.txt`
  - 言語: タイ語
  - ソース: `นิทานเวตาล เรื่องที่ ๗`
  - URL: <https://th.wikisource.org/wiki/%E0%B8%99%E0%B8%B4%E0%B8%97%E0%B8%B2%E0%B8%99%E0%B9%80%E0%B8%A7%E0%B8%95%E0%B8%B2%E0%B8%A5_%E0%B9%80%E0%B8%A3%E0%B8%B7%E0%B9%88%E0%B8%AD%E0%B8%87%E0%B8%97%E0%B8%B5%E0%B9%88_%E0%B9%97>
  - 取得方法: Wikisource `parse` API。ナビゲーションとヘッダの足場を除去し、本文部分にトリミング

- `my-cunning-heron-teacher.txt`
  - 言語: ミャンマー語
  - ソース: `စဉ်းလဲသော ဗျိုင်း (ဆရာ)`
  - URL: <https://my.wikisource.org/wiki/%E1%80%85%E1%80%89%E1%80%BA%E1%80%B8%E1%80%9C%E1%80%B2%E1%80%9E%E1%80%B1%E1%80%AC_%E1%80%97%E1%80%BB%E1%80%AD%E1%80%AF%E1%80%84%E1%80%BA%E1%80%B8_(%E1%80%86%E1%80%9B%E1%80%AC)>
  - 取得方法: Wikisource `parse` API。本文部分のみにトリミングし、教則ガイドの足場を除外

- `my-bad-deeds-return-to-you-teacher.txt`
  - 言語: ミャンマー語
  - ソース: `မကောင်းမှုဒဏ် ကိုယ့်ထံပြန် (ဆရာ)`
  - URL: <https://my.wikisource.org/wiki/%E1%80%99%E1%80%80%E1%80%B1%E1%80%AC%E1%80%84%E1%80%BA%E1%80%B8%E1%80%99%E1%80%BE%E1%80%AF%E1%80%92%E1%80%8F%E1%80%BA_%E1%80%80%E1%80%AD%E1%80%AF%E1%80%9A%E1%80%B7%E1%80%BA%E1%80%91%E1%80%B6%E1%80%95%E1%80%BC%E1%80%94%E1%80%BA_(%E1%80%86%E1%80%9B%E1%80%AC)>
  - 取得方法: Wikisource の生ページ。本文部分のみにトリミングし、教師ガイドの足場・参考文献・問題を除外

- `km-prachum-reuang-preng-khmer-volume-7-stories-1-10.txt`
  - 言語: クメール語
  - ソース: `ប្រជុំរឿងព្រេងខ្មែរ/ភាគទី៧`
  - URL: <https://wikisource.org/wiki/%E1%9E%94%E1%9F%92%E1%9E%9A%E1%9E%87%E1%9E%BB%E1%9F%86%E1%9E%9A%E1%9E%BF%E1%9E%84%E1%9E%96%E1%9F%92%E1%9E%9A%E1%9F%81%E1%9E%84%E1%9E%81%E1%9F%92%E1%9E%98%E1%9F%82%E1%9E%9A/%E1%9E%97%E1%9E%B6%E1%9E%82%E1%9E%91%E1%9E%B8%E1%9F%A7>
  - 取得方法: レンダリング済みページ HTML のクリーンアップ。ナビゲーション/ヘッダの足場を除去後、第 1 話から第 10 話までを結合

- `ar-risalat-al-ghufran-part-1.txt`
  - 言語: アラビア語
  - ソース: Al-Ma'arri, `رسالة الغفران/الجزء الأول`
  - URL: <https://ar.wikisource.org/wiki/%D8%B1%D8%B3%D8%A7%D9%84%D8%A9_%D8%A7%D9%84%D8%BA%D9%81%D8%B1%D8%A7%D9%86/%D8%A7%D9%84%D8%AC%D8%B2%D8%A1_%D8%A7%D9%84%D8%A3%D9%88%D9%84>
  - 取得方法: Wikisource `extracts` API

- `ar-al-bukhala.txt`
  - 言語: アラビア語
  - ソース: Al-Jahiz, `البخلاء`
  - URL: <https://ar.wikisource.org/wiki/%D8%A7%D9%84%D8%A8%D8%AE%D9%84%D8%A7%D8%A1>
  - 取得方法: Wikisource `parse` API。目次以降の実散文部分にトリミング

- `hi-eidgah.txt`
  - 言語: ヒンディー語
  - ソース: Premchand, `प्रेमचंद की सर्वश्रेष्ठ कहानियां/ईदगाह`
  - URL: <https://hi.wikisource.org/wiki/%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A5%87%E0%A4%AE%E0%A4%9A%E0%A4%82%E0%A4%A6_%E0%A4%95%E0%A5%80_%E0%A4%B8%E0%A4%B0%E0%A5%8D%E0%A4%B5%E0%A4%B6%E0%A5%8D%E0%A4%B0%E0%A5%87%E0%A4%B7%E0%A5%8D%E0%A4%A0_%E0%A4%95%E0%A4%B9%E0%A4%BE%E0%A4%A8%E0%A4%BF%E0%A4%AF%E0%A4%BE%E0%A4%82/%E0%A4%88%E0%A4%A6%E0%A4%97%E0%A4%BE%E0%A4%B9>
  - 取得方法: Wikisource `parse` API。シンプルな HTML→テキスト変換でクリーンアップ

- `he-masaot-binyamin-metudela.txt`
  - 言語: ヘブライ語
  - ソース: `מסעות בנימין מטודלה`
  - URL: <https://he.wikisource.org/wiki/%D7%9E%D7%A1%D7%A2%D7%95%D7%AA_%D7%91%D7%A0%D7%99%D7%9E%D7%99%D7%9F_%D7%9E%D7%98%D7%95%D7%93%D7%9C%D7%94>
  - 取得方法: Wikisource `parse` API。完全に翻刻された部分にトリミングし、編集者の角括弧注を除去

- `ur-chughd.txt`
  - 言語: ウルドゥー語
  - ソース: سعادت حسن منٹو, `چغد`
  - URL: <https://wikisource.org/wiki/%DA%86%D8%BA%D8%AF_(%D8%A7%D9%81%D8%B3%D8%A7%D9%86%DB%81)>
  - 取得方法: Wikisource `parse` API。散文段落のみを抽出し、ヘッダの足場と番号付きセクションマーカーを除去

機械可読のメタデータは `sources.json` にある。

現在のスイープ状況は `STATUS.md` にある。
機械可読のコーパスステータスは `dashboard.json` にあり、その主要スナップショットの入力は `chrome-step10.json` と `safari-step10.json`。
ミスマッチの分類体系と方向付け用語彙は `TAXONOMY.md` にある。

便利なコマンド:

- `bun run corpus-check --id=ko-unsu-joh-eun-nal 300 600 800`
- `bun run corpus-check --id=ko-sonagi 300 600 800`
- `bun run corpus-check --id=ar-risalat-al-ghufran-part-1 --diagnose 300`
- `bun run corpus-sweep --id=hi-eidgah --start=300 --end=900 --step=10`
- `bun run corpus-sweep --id=ar-al-bukhala --start=300 --end=900 --step=10`
- `bun run corpus-sweep --all --start=300 --end=900 --step=10`

コーパスページはローカルでも `/corpus?id=<corpus-id>` で利用できる。
