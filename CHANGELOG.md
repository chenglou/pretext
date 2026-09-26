# Changelog

## Unreleased

### Added

- Rich-inline fragments now have `gapItemIndex`, the index of the item whose collapsed space `gapBefore` measures, or -1 when no space precedes the fragment on its line. A painter can draw that space inside the element of the item whose font measured it, and can tell a zero-width space apart from no space (#310).

### Changed

- `prepare()` is faster on text it hasn't seen, up to about twice as fast in Chrome and Safari and three to four times with letter spacing, and letter-spaced text it has seen is about eight times faster there, since Pretext now finds grapheme clusters with the character rules each browser ships instead of `Intl.Segmenter`. `Intl.Segmenter` is now needed only for text in Thai, Lao, Khmer, Myanmar and the other Southeast Asian scripts written without spaces. Bundles that import Pretext grow by about 4 KB gzipped (5.5 KB minified) (#344).
- Chrome, Safari and Firefox now find where lines can break with ports of each browser's own line breaker and its data, in place of Pretext's own rules, so lines break where the browser breaks them in many more cases, such as around CJK punctuation and quotes, dashes, URLs and Thai. `prepare()` and `layout()` are also faster on most text, including letter-spaced, soft-hyphenated and `white-space: pre-wrap` text. Bundles that import Pretext grow by about 30 KB gzipped (28 KB minified), mostly for that data (#340).
- Safari's line breaking follows Safari 27. Safari 26, on macOS 26 and iOS 26, breaks differently around curly quotes and guillemets, after punctuation with `word-break: keep-all`, at U+2028 and U+2029, and after a first character too wide for its line (#340).
- In Chrome, text on a page without a `lang` now breaks and measures under Chrome's UI language, as Chrome lays it out: under a Chinese UI, curly double quotes wrap as brackets (#340).
- `layout()` is two to three times faster in Chrome and Safari on text without letter spacing, preserved spaces, tabs, hard breaks, soft hyphens or invisible controls other than zero-width spaces, which covers most prose (#338).
- Bundles that import Pretext are about 5 KB smaller gzipped and 16 KB smaller minified, since Safari's check for keeping a word's kerning with a following space no longer uses a generated bidi class table (#311).
- `setLocale()` now only clears the caches, as `clearCache()` does. Line breaking follows the page language, and no locale changes the word boundaries Pretext still reads, inside Thai, Lao, Khmer and Myanmar text (#340).

### Removed

- `prepareWithSegments()` no longer returns `segLevels`. Those approximate bidi levels per segment couldn't produce visual order, and computing them slowed every `prepareWithSegments()` and rich-inline preparation, most for Arabic and Hebrew text. To draw mixed bidi text, render each paragraph as one DOM element with its direction set, and the browser orders every line. Lines drawn separately, such as with Canvas `fillText()`, are each ordered as their own paragraph, so numbers or punctuation next to a line break can come out in a different order (#258).
- The npm package no longer includes the demos (`pages/demos` and `pages/assets`). They live in the repository (#342).

### Fixed

- In Safari, on pages with a language, text in `serif`, `sans-serif`, `cursive`, `fantasy` or `monospace`, or falling back to one of them, now measures in the font Safari draws it with there, such as Apple SD Gothic Neo for `sans-serif` on a `ko` page and Menlo for `monospace` on an `en` page, instead of the font those names give a page without a language (#340).
- In Chrome, CJK punctuation next to other punctuation or at a line end now takes the narrower width Chrome's `text-spacing-trim` gives it (#340).
- In Chrome and Firefox, ideographic spaces (U+3000) at a line end now hang past it, as spaces do, instead of wrapping to the next line (#340).
- A run of no-break spaces (U+00A0, U+202F or U+2007) between other break opportunities, such as between two spaces, now breaks where it overflows its line, as browsers do, instead of staying on one line (#340).
- In Firefox, a newline between East Asian characters no longer adds a space, and on `ja` and `zh` pages neither does one next to East Asian punctuation (#340).
- In Firefox, a soft hyphen where the line could break anyway, as after a space or between an ideograph and a Latin letter, no longer draws a hyphen or needs room for one (#340).
- Narrow wrapping around invisible controls and combining marks now more closely matches desktop Chrome and Firefox.
- Paragraphs made only of zero-width spaces now occupy one line instead of disappearing (#223).
- A zero-width space at the start of a paragraph or after a hard line break no longer disappears when the following text wraps to the next line (#227).
- Lines can now break after `?`, and after `!` or other exclamation punctuation such as `؟` and `۔`, before a following word, as browsers do, including after a space or zero-width space. Chrome and Safari still keep `!` with a following ASCII letter or digit; Firefox breaks there too (#228).
- In Safari, a combining mark after a zero-width space at the start of the text, at the start of a rich-inline item, or after a line break now stays with that zero-width space (#228).
- In Chrome, text prepared after changing `<html lang>` now uses the fonts for the new language, even when the font string is unchanged (#230).
- Figure spaces (U+2007) now keep adjacent text on the same line, like no-break spaces, as browsers do (#232).
- Lines can now break after `?` before `$`, `%`, `+`, `\`, `-` or `|`, after `!` or `?` before a symbol such as `©`, `¿` or `€`, and after the Arabic semicolon `؛` before a word, as browsers do. Firefox still keeps `?` with a following `-` or `|` (#233).
- A zero-width joiner now keeps the character after it on the same line, except right after a space and in CJK text (#233).
- In Chrome and Safari, a hyphen or dash such as U+2010 HYPHEN, U+2012 FIGURE DASH or U+2013 EN DASH at the start of a word now stays with a following letter of an alphabetic script, such as Latin, Cyrillic, Arabic, Hebrew or Thai. For `-`, only letters outside Latin-1 count (#233).
- In Chrome, lines can now break between a fullwidth closing bracket such as `」` or `）` and a following ideograph, kana or Hangul syllable, as Chrome does (#234).
- Lines no longer start with CJK closing punctuation or nonstarters such as `〟`, `］`, `｡`, `､`, `｣` or `゛` (#234).
- With `word-break: keep-all`, lines no longer break after `ー` in words such as `ラーメン`. In Chrome, they also no longer break after iteration marks such as `々`, `ゝ` or `ヽ` (#234).
- In Safari, a word followed by a space now keeps its kerning with that space, so letters such as `A` in Arial or Times New Roman fit narrow lines as they do natively (#236).
- Reported line widths are now clamped at 0 instead of going negative, for example with strongly negative `letterSpacing` (#236).
- Chrome, Firefox, Edge and other browsers on iPhone and iPad, and in-app web views on iPhone, iPad and Mac, now wrap text as Safari does, since they use WebKit. Previously, some of them got rules meant for other browsers, such as breaks after punctuation with `word-break: keep-all`. In Safari, text prepared in a web worker now gets the same rules as on the page (#237).
- In Chrome and Firefox, a newline next to a zero-width space no longer adds a space in `white-space: normal`, matching the browser (#238).
- In Chrome, when the hyphen of a chosen soft hyphen does not fit, the line now ends at an earlier space, zero-width space or soft hyphen that leaves room for it, as Chrome does, instead of overflowing. With `letterSpacing`, Chrome's visible hyphen no longer gets its own letter spacing (#239).
- In Safari, a next-line character (U+0085) now stays on the same line as the text before it, and lines can still break after it. `letterSpacing` no longer adds space after U+0085, except next to text that Safari shapes as complex text, such as Arabic, Devanagari or a combining mark (#240).
- In Safari, a tab in `white-space: pre-wrap` now moves to the following tab stop when less than half a space would remain before the next one, as Safari does (#240).
- In Chrome and Safari, rich-inline layout now breaks between items only where their joined text has a break opportunity. Punctuation such as `,` or `)` at the start of an item stays with the word before it, and a word split across items wraps as one word. Items without a space between them can also break where the joined text allows it, such as between CJK characters, at Thai word boundaries or after `-`. In Safari, breaks inside each item still come from that item's own text, as Safari wraps each span, so a Thai, Lao, Khmer or Myanmar word split across items wraps like Safari's spans (#241).
- With `word-break: keep-all` in Chrome and Firefox, lines can now break before an opening bracket such as `(` or `¡` after CJK text, as in `서울(한국)에서`, before `「` or `（` after Latin letters or digits, after a closing bracket such as `❩` before CJK text, and next to Thai text. In Chrome, they can also break next to emoji and symbols such as `★` or `～`, after punctuation such as `/` or `‼` that follows an emoji, after keycaps, between flags, and before an opening quotation mark or after a closing one between CJK characters, as in `他说“你好”然后` (#243).
- A time or number followed by closing punctuation such as a full-width comma, as in `00:00:00，`, now stays whole instead of breaking after a `:` or before the comma (#245).
- In Safari, small kana and `ー` after CJK text can now start a line only on pages whose `<html lang>` is Japanese or Korean, as Safari does (#249).
- In Chrome, `ー` can now start a line after CJK text, as Chrome does (#250).
- In Firefox, and in engines Pretext doesn't recognize, small kana no longer start a line after CJK text, as Firefox does (#250).
- When a line's first word is wider than the line, a following space or zero-width space now ends that line in `layoutWithLines()`, `walkLineRanges()`, `layoutNextLine()`, `layoutNextLineRange()` and rich-inline layout. Previously, other content such as a soft hyphen or a word joiner, or `letterSpacing`, moved it to the start of the next line. Plain-text line counts and widths don't change. With `letterSpacing`, rich-inline layout can also take fewer lines or give lines different widths, for example where invisible characters such as a zero-width space took a line of their own (#272).
- A negative `maxWidth` now lays out like 0 in `layout()` and the other plain-text line APIs. Previously it could give a different line count than 0, which could also depend on whether the text contained a soft hyphen or used `letterSpacing` (#272).
- In Safari, a word that ends in an invisible format character such as a word joiner now keeps its kerning with a following space when an explicit bidi control such as U+202A appears only in another paragraph, such as another line of `white-space: pre-wrap` text (#271).
- In Firefox, a combining mark after a line break or a space now stays with a following `$`, `%`, `+` or `\`, as it does at the start of the text. At narrow widths such text can also take one line fewer: after `어`, a space and U+3099, `$"` no longer breaks between `$` and `"` (#270).
- With `word-break: keep-all` in Chrome and Firefox, a URL containing a second `www.` or scheme such as `https://` before its query, as in `x中www.a/www.b?q`, no longer loses text. In Chrome and Safari, rich-inline layout no longer breaks such a URL where its text has no break opportunity, as before the second `www.` in items `字` and `www.a/www.b?q=1` (#269).
- After CJK text, `.`, `,`, `:`, `;`, `)`, `]`, `%` or `"` now stays on the same line as a following word or number, as browsers do. In `甲乙丙.first_week_voltage}户`, lines no longer break after the period (#276).
- Rich-inline layout now keeps text, or a `break: 'never'` item, on a line when it overflows by no more than 0.005px, or 1/64px in Safari, as it already did inside one item. Previously, at some widths, layout took one more line than at a slightly narrower width (#281).
- In Firefox, rich-inline layout now breaks between items only where their joined text has a break opportunity, as in Chrome. Punctuation such as `,` or `)` at the start of an item stays with the word before it, and a word split across items wraps as one word. Items without a space between them can also break where the joined text allows it, such as between CJK characters, at Thai word boundaries or after `-` (#287).
- In engines Pretext doesn't recognize, and in runtimes such as Node, Bun or jsdom, rich-inline layout now breaks between items only where their joined text has a break opportunity, as in Chrome and Firefox, instead of at every item boundary (#301).
- CJK text that stays together on a line, such as `漢。`, `「漢` or a `word-break: keep-all` group, now breaks between characters when it doesn't fit a line, as browsers do, instead of overflowing. Lines also no longer break between a run of opening brackets and the word after it, as in `「「tail`, or inside that word, as in `「tail`, or before a combining mark that ends a word before CJK text or an opening bracket, such as U+3099 after `ト` (#288).
- In Firefox, a hyphen now stays on the same line as a number after it, as in `2025-08-01`, `log-2026` or `8:30-4:30`, as Firefox does. A word that doesn't fit a line breaks between characters there instead (#289).
- In Firefox, lines can now break after `/` before a letter or a symbol such as `#` or `@`, as in `https://example.com`, `example.com/docs` or `and/or`, as Firefox does. A number after `/` still stays on the same line, as in `1/2` (#290).
- Closing punctuation and marks that can't start a line, such as `，`, `」`, `：`, `。` or `！`, now stay on the same line as the text before them when that text isn't CJK, as in `xxxx，`, `x“value”，` or `😀。`, as browsers do. A word that doesn't fit a line with its mark breaks before the mark instead. In Firefox, and in Safari on pages that aren't Japanese or Korean, small kana and `ー` also stay with a letter or digit before them, as in `約3ヶ月` (#291).
- In `pre-wrap`, a line that wraps no longer counts the spaces it ends on in its width, and spaces before a newline or at the end of the text count only as far as they fit, so boxes sized from `measureLineStats()` or `walkLineRanges()` no longer run past the text. In Chrome and Safari the same holds for tabs, and a run of spaces and tabs at the end of a line now stays on that line whole, instead of starting the next line with a tab or a space after a tab. Firefox doesn't hang tabs, so there a tab still counts in the width (#308).
- After CJK text, lines no longer start with punctuation such as `'`, `/`, `|`, `‼` or `％`. A word or number after `!`, `}`, `/` or `|` there now stays with the mark as each browser keeps it: Chrome keeps ASCII letters and digits; Safari keeps digits, and letters only after a `}` that follows an ideograph or Hangul syllable; Firefox keeps only digits after `/` (#309).
- In Chrome and Firefox on macOS, U+FE0F after a character that isn't emoji, such as a letter, a space or U+3000, no longer makes text measure narrower than the browser draws it at small font sizes (#320).
- In rich-inline layout, an item that fits after the items before it only up to a soft hyphen whose hyphen doesn't fit now ends the line at that soft hyphen, as plain text does, instead of moving to the next line where its text has no break opportunity before it. Such paragraphs, like `the ` followed by a bold `inter` and `na\u00ADtion\u00ADal`, used to take more lines, or start their second line earlier, as the width grew. In Chrome, the line still ends before the item when a space or another break opportunity before it leaves room for the hyphen (#327).

## 0.0.9 - 2026-09-07

### Fixed

- Streaming line layouts and line statistics now agree with batch layout when a later break follows a soft hyphen. Streaming also retains later text after consecutive lines containing only invisible break controls (#222).
- Terminal soft hyphens now stay invisible and preserve terminal letter spacing across the rich line APIs.
- Rich bidi metadata now resets independently at each paragraph boundary.
- Rich-inline preparation with long internal whitespace, streaming layout of long hyphenated runs, and long font-size strings now avoid excessive repeated work (#221).
- Rich-inline cursors now retain original item indices across empty items, zero-width items can occupy a line, and boundary spaces preserve their font and signed letter spacing. Mutating a visited line no longer changes the walker's continuation (#220).
- Overlong independent symbol runs can now wrap at grapheme boundaries, with browser-specific punctuation attachment (#208).
- Numeric minus signs no longer introduce a preferred break before their number, and ASCII hyphens after CJK text stay attached to the preceding character (#213, #215).
- The Markdown chat demo now keeps ordinary text inside its bubbles in Firefox on macOS ([#202](https://github.com/chenglou/pretext/issues/202)).

## 0.0.8 - 2026-06-11

### Added

- The published package now ships declaration maps, so editor go-to-definition and programmatic TypeScript source tracing land in the shipped `.ts` source instead of the `.d.ts` files.

### Fixed

- Word-internal keyboard and Unicode symbol runs in long words now stay with surrounding text the way browsers break them, while browser-break symbols stay breakable (#169).
- Overlong hyphenated runs now prefer browser-like dash breakpoints before falling back to emergency grapheme breaks (#89).

## 0.0.7 - 2026-05-10

### Changed

- The package now declares itself side-effect-free so bundlers can tree-shake unused entrypoints (#160).
- `layoutNextLine()` and `layoutNextLineRange()` now avoid redundant chunk lookup in chunk-heavy manual layout paths (#140).

### Fixed

- `{ wordBreak: 'keep-all' }` now handles no-space mixed Latin, numeric, and CJK text more like browsers.
- No-space punctuation chains now stay together for non-ASCII word-like text too, instead of only ASCII words.
- Opening punctuation such as `¡`, `¿`, German low quotes, and `⸘` now stays with the following word instead of dangling at line end (#165).
- Numeric prefix/postfix symbols like `$`, `%`, `€`, `+`, `−`, and `°` now stay attached to adjacent text the way browser line breaking does (#105).
- Soft-hyphen breaks now stay at the soft-hyphen insertion point instead of pulling post-hyphen graphemes onto the broken line (#162).
- Line geometry now preserves browser-style terminal letter spacing, including rich-inline item boundaries and visible soft-hyphen breaks (#171).
- Rich-inline item boundaries no longer overflow the requested width after a forced-progress break (#132).
- The markdown chat demo now drops parsed link URLs unless they resolve to HTTP(S) hrefs (#168).

## 0.0.6 - 2026-04-22

### Added

- Numeric CSS-pixel `letterSpacing` support on `prepare()`, `prepareWithSegments()`, and each existing rich-inline item (#108, #156).

### Fixed

- CJK text followed by opening bracket annotations now wraps like browsers instead of leaving the opening bracket on the previous line (#148).

## 0.0.5 - 2026-04-09

### Added

- Geometry-first rich line helpers for manual layout work: `measureLineStats()`, `measureNaturalWidth()`, `layoutNextLineRange()`, and `materializeLineRange()`.
- `@chenglou/pretext/rich-inline`, a narrow helper for inline-only rich text, mentions/chips, and browser-like boundary whitespace collapse.
- `{ wordBreak: 'keep-all' }` support on `prepare()` / `prepareWithSegments()` for CJK and Hangul text.
- A virtualized markdown chat demo for rich inline text and `pre-wrap` layout.

### Changed

- Prepare-time analysis is more resilient on long mixed-script, CJK, Arabic, repeated-punctuation, and other degenerate inputs.

### Fixed

- Mixed CJK-plus-numeric runs, keep-all mixed-script boundaries, and long breakable runs now stay closer to browser behavior.
- Rich-path bidi metadata and CJK detection now handle the relevant astral Unicode ranges correctly.

## 0.0.4 - 2026-04-02

### Added

- A justification comparison demo that shows native CSS justification, greedy hyphenation, and a Knuth-Plass-style paragraph layout side by side.

### Changed

- Rich layout is faster on chunk-heavy and long-breakable text.

### Fixed

- `layout()`, `layoutWithLines()`, and `layoutNextLine()` stay aligned on narrow `ZWSP` / grapheme-breaking edge cases.
- The justification comparison demo no longer paints justified lines wider than their column.

## 0.0.3 - 2026-03-29

### Changed

- npm now publishes built ESM JavaScript from `dist/` instead of exposing raw TypeScript source as the package entrypoint.
- TypeScript consumers now pick up shipped declaration files automatically from the published package, while plain JavaScript consumers can install and import the package without relying on dependency-side TypeScript transpilation.

## 0.0.2 - 2026-03-28

### Added

- `{ whiteSpace: 'pre-wrap' }` mode for textarea-like text, preserving ordinary spaces, tabs, and hard breaks.

## 0.0.1 - 2026-03-27

### Changed

- Safari line breaking is more accurate for narrow soft-hyphen and breakable-run cases.

## 0.0.0 - 2026-03-26

Initial public npm release of `@chenglou/pretext`.

### Added

- `prepare()` and `layout()` as the core fast path for DOM-free multiline text height prediction.
- Rich layout APIs including `prepareWithSegments()`, `layoutWithLines()`, `layoutNextLine()`, and `walkLineRanges()` for custom rendering and manual layout.
