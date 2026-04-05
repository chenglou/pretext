# Corpora

Starter long-form stress corpora for browser-layout experiments.

These files are checked in so we have stable canaries when probing languages and
punctuation systems beyond the current 7680-case browser sweep. The main corpus
set is wired into `/corpus` and the long-form rows on `/benchmark`; the status
pages are the compact source of truth for current results.

Current bundle:

- `mixed-app-text.txt`
  - Language: mixed / app-style
  - Source: synthetic corpus kept in-repo
  - Acquisition: hand-curated stress text covering URLs, quote clusters, mixed RTL/LTR runs, emoji ZWJ, hard spaces, word joiners, zero-width breaks, and soft hyphens

- `en-gatsby-opening.txt`
  - Language: English
  - Source: F. Scott Fitzgerald, `The Great Gatsby` opening
  - URL: <https://www.gutenberg.org/ebooks/64317>
  - Acquisition: checked-in copy of the long-form Gatsby canary text, now routed through the shared corpus tooling

- `ja-rashomon.txt`
  - Language: Japanese
  - Source: 芥川龍之介, `羅生門`
  - URL: <https://ja.wikisource.org/wiki/%E7%BE%85%E7%94%9F%E9%96%80>
  - Acquisition: Wikisource `parse` API, trimmed to the story body with ruby readings and page/license scaffolding removed

- `ja-kumo-no-ito.txt`
  - Language: Japanese
  - Source: 芥川龍之介, `蜘蛛の糸`
  - URL: <https://ja.wikisource.org/wiki/%E8%9C%98%E8%9B%9B%E3%81%AE%E7%B3%B8>
  - Acquisition: Wikisource `parse` API, trimmed to the story body with ruby fallout and public-domain/license scaffolding removed

- `ko-unsu-joh-eun-nal.txt`
  - Language: Korean
  - Source: Hyun Jin-geon, `운수 좋은 날`
  - URL: <https://ko.wikisource.org/wiki/%EC%9A%B4%EC%88%98_%EC%A2%8B%EC%9D%80_%EB%82%A0>
  - Acquisition: Wikisource `extracts` API, lightly cleaned

- `zh-zhufu.txt`
  - Language: Chinese
  - Source: 魯迅, `祝福`
  - URL: <https://zh.wikisource.org/zh-hant/%E7%A5%9D%E7%A6%8F>
  - Acquisition: Wikisource raw text, trimmed to the story body after removing the header template

- `zh-guxiang.txt`
  - Language: Chinese
  - Source: 魯迅, `故鄉`
  - URL: <https://zh.wikisource.org/wiki/%E6%95%85%E9%84%89>
  - Acquisition: Wikisource `parse` output, keeping only prose paragraphs after stripping page-number scaffolding and header tables

- `th-nithan-vetal-story-1.txt`
  - Language: Thai
  - Source: `นิทานเวตาล/เรื่องที่ 1`
  - URL: <https://th.wikisource.org/wiki/%E0%B8%99%E0%B8%B4%E0%B8%97%E0%B8%B2%E0%B8%99%E0%B9%80%E0%B8%A7%E0%B8%95%E0%B8%B2%E0%B8%A5/%E0%B9%80%E0%B8%A3%E0%B8%B7%E0%B9%88%E0%B8%AD%E0%B8%87%E0%B8%97%E0%B8%B5%E0%B9%88_1>
  - Acquisition: Wikisource `parse` API, trimmed to the story body with header navigation and trailing footnote removed

- `th-nithan-vetal-story-7.txt`
  - Language: Thai
  - Source: `นิทานเวตาล เรื่องที่ ๗`
  - URL: <https://th.wikisource.org/wiki/%E0%B8%99%E0%B8%B4%E0%B8%97%E0%B8%B2%E0%B8%99%E0%B9%80%E0%B8%A7%E0%B8%95%E0%B8%B2%E0%B8%A5_%E0%B9%80%E0%B8%A3%E0%B8%B7%E0%B9%88%E0%B8%AD%E0%B8%87%E0%B8%97%E0%B8%B5%E0%B9%88_%E0%B9%97>
  - Acquisition: Wikisource `parse` API, trimmed to the story body after removing navigation and header scaffolding

- `my-cunning-heron-teacher.txt`
  - Language: Myanmar
  - Source: `စဉ်းလဲသော ဗျိုင်း (ဆရာ)`
  - URL: <https://my.wikisource.org/wiki/%E1%80%85%E1%80%89%E1%80%BA%E1%80%B8%E1%80%9C%E1%80%B2%E1%80%9E%E1%80%B1%E1%80%AC_%E1%80%97%E1%80%BB%E1%80%AD%E1%80%AF%E1%80%84%E1%80%BA%E1%80%B8_(%E1%80%86%E1%80%9B%E1%80%AC)>
  - Acquisition: Wikisource `parse` API, trimmed to the story body only and excluding the teaching-guide scaffolding

- `my-bad-deeds-return-to-you-teacher.txt`
  - Language: Myanmar
  - Source: `မကောင်းမှုဒဏ် ကိုယ့်ထံပြန် (ဆရာ)`
  - URL: <https://my.wikisource.org/wiki/%E1%80%99%E1%80%80%E1%80%B1%E1%80%AC%E1%80%84%E1%80%BA%E1%80%B8%E1%80%99%E1%80%BE%E1%80%AF%E1%80%92%E1%80%8F%E1%80%BA_%E1%80%80%E1%80%AD%E1%80%AF%E1%80%9A%E1%80%B7%E1%80%BA%E1%80%91%E1%80%B6%E1%80%95%E1%80%BC%E1%80%94%E1%80%BA_(%E1%80%86%E1%80%9B%E1%80%AC)>
  - Acquisition: Wikisource raw page, trimmed to the story body only and excluding the teacher-guide scaffolding, references, and questions

- `km-prachum-reuang-preng-khmer-volume-7-stories-1-10.txt`
  - Language: Khmer
  - Source: `ប្រជុំរឿងព្រេងខ្មែរ/ភាគទី៧`
  - URL: <https://wikisource.org/wiki/%E1%9E%94%E1%9F%92%E1%9E%9A%E1%9E%87%E1%9E%BB%E1%9F%86%E1%9E%9A%E1%9E%BF%E1%9E%84%E1%9E%96%E1%9F%92%E1%9E%9A%E1%9F%81%E1%9E%84%E1%9E%81%E1%9F%92%E1%9E%98%E1%9F%82%E1%9E%9A/%E1%9E%97%E1%9E%B6%E1%9E%82%E1%9E%91%E1%9E%B8%E1%9F%A7>
  - Acquisition: rendered-page HTML cleanup, combining stories 1-10 after trimming navigation/header scaffolding

- `ar-risalat-al-ghufran-part-1.txt`
  - Language: Arabic
  - Source: Al-Ma'arri, `رسالة الغفران/الجزء الأول`
  - URL: <https://ar.wikisource.org/wiki/%D8%B1%D8%B3%D8%A7%D9%84%D8%A9_%D8%A7%D9%84%D8%BA%D9%81%D8%B1%D8%A7%D9%86/%D8%A7%D9%84%D8%AC%D8%B2%D8%A1_%D8%A7%D9%84%D8%A3%D9%88%D9%84>
  - Acquisition: Wikisource `extracts` API

- `ar-al-bukhala.txt`
  - Language: Arabic
  - Source: Al-Jahiz, `البخلاء`
  - URL: <https://ar.wikisource.org/wiki/%D8%A7%D9%84%D8%A8%D8%AE%D9%84%D8%A7%D8%A1>
  - Acquisition: Wikisource `parse` API, trimmed to the real prose after the table of contents

- `hi-eidgah.txt`
  - Language: Hindi
  - Source: Premchand, `प्रेमचंद की सर्वश्रेष्ठ कहानियां/ईदगाह`
  - URL: <https://hi.wikisource.org/wiki/%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A5%87%E0%A4%AE%E0%A4%9A%E0%A4%82%E0%A4%A6_%E0%A4%95%E0%A5%80_%E0%A4%B8%E0%A4%B0%E0%A5%8D%E0%A4%B5%E0%A4%B6%E0%A5%8D%E0%A4%B0%E0%A5%87%E0%A4%B7%E0%A5%8D%E0%A4%A0_%E0%A4%95%E0%A4%B9%E0%A4%BE%E0%A4%A8%E0%A4%BF%E0%A4%AF%E0%A4%BE%E0%A4%82/%E0%A4%88%E0%A4%A6%E0%A4%97%E0%A4%BE%E0%A4%B9>
  - Acquisition: Wikisource `parse` API with simple HTML-to-text cleanup

- `he-masaot-binyamin-metudela.txt`
  - Language: Hebrew
  - Source: `מסעות בנימין מטודלה`
  - URL: <https://he.wikisource.org/wiki/%D7%9E%D7%A1%D7%A2%D7%95%D7%AA_%D7%91%D7%A0%D7%99%D7%9E%D7%99%D7%9F_%D7%9E%D7%98%D7%95%D7%93%D7%9C%D7%94>
  - Acquisition: Wikisource `parse` API, trimmed to the fully transcribed portion with editorial bracket notes removed

- `ur-chughd.txt`
  - Language: Urdu
  - Source: سعادت حسن منٹو, `چغد`
  - URL: <https://wikisource.org/wiki/%DA%86%D8%BA%D8%AF_(%D8%A7%D9%81%D8%B3%D8%A7%D9%86%DB%81)>
  - Acquisition: Wikisource `parse` API, extracted from prose paragraphs only and stripped of header scaffolding and numbered section markers

Machine-readable metadata lives in `sources.json`.

Current sweep status lives in `STATUS.md`.
Machine-readable corpus status lives in `dashboard.json`, and its main snapshot
inputs are `representative.json`, `chrome-sampled.json`, and `chrome-step10.json`.
Mismatch taxonomy and steering vocabulary live in `TAXONOMY.md`.

Useful commands:

- `bun run corpus-check --id=ko-unsu-joh-eun-nal 300 600 800`
- `bun run corpus-check --id=ar-risalat-al-ghufran-part-1 --diagnose 300`
- `bun run corpus-sweep --id=hi-eidgah --start=300 --end=900 --step=10`
- `bun run corpus-sweep --id=ar-al-bukhala --samples=9`
- `bun run corpus-sweep --all --start=300 --end=900 --step=10`

The corpus page is also available locally at `/corpus?id=<corpus-id>`.

For very large corpora, `--samples=<n>` checks evenly spaced widths across the
requested range instead of visiting every `step`.
