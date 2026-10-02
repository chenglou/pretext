# Changelog

## Unreleased

### Added

- Rich inline takes boxes, `{ width }` (`RichInlineBox`), for an image, a custom emoji, a formula or a badge inside a line, in place of a character with `break: 'never'` and an `extraWidth` that made up the rest of the object's width. A line can break before and after a box, as at an `<img>`, whatever text touches it, and its fragment has the box's width and no text. Heights stay yours: give each box `vertical-align: top`, and each line is as tall as the paragraph's line height or its tallest box, whichever is taller. `prepareRichInline()` now takes `Array<RichInlineItem | RichInlineBox>`, so code typed from its parameter checks an item's `text` before reading its text or font, and `RichInlineItem` has `width?: never` (#387).
- `prepareRichInline()` takes `{ whiteSpace: 'pre-wrap' }`, for CSS `white-space: pre-wrap` on the paragraph, as `prepare()` does: every item but an atomic one keeps its spaces, tabs and newlines, spaces at a line's end hang past it across a change of style, tab stops count from the line's start, and a newline ends its line, so an editor's paragraph split into styled runs takes the lines the browser gives it. White space after an atomic item wider than the line stays on that item's line, whatever items it spans; in Firefox, such white space that runs into a tab moves to the next line with the tab (#381, #386).
- `prepareRichInline()` takes an options argument, `{ wordBreak: 'keep-all' }`, for CSS `word-break: keep-all` on the paragraph, as `prepare()` does, so Korean, Chinese and Japanese messages with mentions, bold runs or code spans break where the browser breaks them under keep-all (#379).
- Rich-inline fragments now have `gapItemIndex`, the index of the item whose collapsed space `gapBefore` measures, or -1 when no space precedes the fragment on its line. A painter can draw that space inside the element of the item whose font measured it, and can tell a zero-width space apart from no space (#310).

### Changed

- Bundles that import Pretext are larger than with 0.0.9, in all: the main entry is about 56 KB gzipped (115 KB minified), up from 16 KB (48 KB), and `@chenglou/pretext/rich-inline` about 61 KB (129 KB), up from 16 KB (49 KB). About 34 KB gzipped of the growth is each browser's line-break and grapheme data with the code that reads it (#340, #344); the rest came with the fixes below.
- `measureRichInlineStats()`, `walkRichInlineLineRanges()` and `layoutNextRichInlineLineRange()` now lay out a paragraph of one item without `extraWidth` or `break: 'never'`, such as a message in one style, with the line walkers of `measureLineStats()` and `walkLineRanges()`, giving the same lines, fragments and cursors as before. The Markdown chat demo's height pass, where 86% of paragraphs are one item, is about 25% faster in Chrome, 23% in Firefox and 17-22% in Safari (#383).
- `measureRichInlineStats()` is about 25% faster in Chrome and Firefox and 14% in Safari, and `walkRichInlineLineRanges()` and `layoutNextRichInlineLineRange()` 13-16% faster in Chrome and Firefox, on chat messages with inline code, since a line that can't take the start of the next item now ends before it without laying that item out (#375).
- A rich-inline atomic item's (`break: 'never'`) own leading or trailing white space no longer gives a gap before or after it, as browsers trim that white space inside the item's box: where only that white space stood, `gapBefore` is now 0 and `gapItemIndex` -1, where they measured a space in the atomic item's font and named that item (#369).
- `prepare()` is faster on text it hasn't measured before, up to about twice as fast in Chrome and Safari and three to four times with letter spacing, and letter-spaced text it has measured before is about eight times faster there, since Pretext now finds grapheme clusters with the character rules each browser ships instead of `Intl.Segmenter`. `Intl.Segmenter` is now needed only for text in Thai, Lao, Khmer, Myanmar and the other Southeast Asian scripts written without spaces. Of the bundle growth above, about 4 KB gzipped (5.5 KB minified) is this change (#344).
- Chrome, Safari and Firefox now find where lines can break with ports of each browser's own line breaker and its data, in place of Pretext's own rules, so lines break where the browser breaks them in many more cases, such as around CJK punctuation and quotes, dashes, URLs and Thai. `prepare()` and `layout()` are also faster on most text, including letter-spaced, soft-hyphenated and `white-space: pre-wrap` text. Of the bundle growth above, about 30 KB gzipped (28 KB minified) is this change, mostly that data (#340, #351, #365).
- A prepared handle no longer survives a JSON round trip: the line APIs don't return on `JSON.parse(JSON.stringify(prepared))`, nor does `layout()` for some text, where 0.0.9 laid such a copy out. `structuredClone()` and `postMessage()` copies work, and cursors and line ranges are still plain JSON (#340).
- Safari's line breaking follows Safari 27. Safari 26, on macOS 26 and iOS 26, breaks differently around curly quotes and guillemets, after punctuation with `word-break: keep-all`, at U+2028 and U+2029, and after a first character too wide for its line (#340).
- In Chrome, text on a page without a `lang` now breaks and measures under Chrome's UI language, as Chrome lays it out: under a Chinese UI, curly double quotes follow the line-break rules of CJK brackets, so a line doesn't end with “ or start with ” (#340).
- `layout()` is two to three times faster in Chrome and Safari on text without letter spacing, preserved spaces, tabs, hard breaks, soft hyphens or invisible controls other than zero-width spaces, which covers most prose (#338).
- The Unicode bidi-class table that 0.0.9 bundled, for `segLevels`, is gone, about 5 KB gzipped (16 KB minified), counted in the bundle sizes above (#258, #311).
- Bundles that import Pretext are about 2.6 KB smaller gzipped and 6 KB smaller minified, from tighter packing of the browsers' line-break and grapheme tables (#392).
- `setLocale(locale)` now sets the language that later `prepare()`, `prepareWithSegments()` and `prepareRichInline()` calls break lines and measure under, in place of the page's `<html lang>`, which a worker doesn't have; `setLocale()` without a locale goes back to `<html lang>`. It no longer passes the locale to `Intl.Segmenter`, whose word boundaries Pretext now reads only inside Thai, Lao, Khmer and Myanmar text, where no locale changes them (#340, #356).
- `prepare()`, `prepareWithSegments()` and `prepareRichInline()` now throw a `RangeError` for a `letterSpacing` that isn't finite, such as `NaN` or `Infinity`, which gave lines of width `NaN`, or a line per grapheme (#356).

### Removed

- `prepareWithSegments()` no longer returns `segLevels`. Those approximate bidi levels per segment couldn't produce visual order, and computing them slowed every `prepareWithSegments()` and rich-inline preparation, most for Arabic and Hebrew text. To draw mixed bidi text, render each paragraph as one DOM element with its direction set, and the browser orders every line. Lines drawn separately, such as with Canvas `fillText()`, are each ordered as their own paragraph, so numbers or punctuation next to a line break can come out in a different order (#258).
- The npm package no longer includes the demos (`pages/demos` and `pages/assets`). They live in the repository (#342).

### Fixed

- In Chrome, lines no longer come out wider than Chrome lays them out in fonts that kern letters against the space, such as Arial, Helvetica, Times New Roman, Trebuchet MS, Roboto, Avenir Next and Gill Sans. Chrome tightens a space before a capital such as `A`, `T` or `Y`, and in some fonts the space after many words, which Chrome's Canvas doesn't report for words measured apart, so a line with several such words was up to a few pixels too wide: a paragraph of card-length text took a line more than Chrome gave it at about one width in 600 in Arial, and one in 75 in Gill Sans, and a bubble sized to its widest line was that much too wide. Pretext now reads that kerning from Canvas. For the first text with a space in a font, `prepare()` measures one 189-character string twice to learn whether the font kerns the space, and a font that doesn't, as most don't, costs nothing more. In a font that does, it asks Canvas up to three more questions for each distinct first or last character of the font's words: a paragraph of English prepared alone in a new font makes about half as many `measureText` calls again, the first ten in a font about a quarter more, the first hundred about 9% more and two thousand about 1% more. Hindi and Thai paragraphs alone make 14 to 21% more, and Chinese, Japanese and Korean ones next to none, since ideographs, kana and Hangul syllables aren't asked about. A font that kerns only characters outside ASCII against the space, as Tamil MN and Malayalam MN do, the space after a closing bracket or a middle dot, and text that holds right-to-left letters or bidi controls, measure as before (#TBD).
- In Safari, a rich-inline item that starts with a line or paragraph separator, U+2028 or U+2029, no longer takes a line of its own after a chip wider than the line, or where the item's padding doesn't fit after the text before it, since Safari gives no break before the separator; such a paragraph no longer comes out a line taller than Safari lays it out (#381).
- Under negative letter spacing, a rich-inline line that starts inside an item no longer starts its first fragment's text with a space. Where the last word of the line before just fit, as happens at the letter spacing apps give body text, such as −0.08px, the next line's first fragment started at the space after that word: text such as ` cd`, which Canvas `fillText()` or `white-space: pre` painted one space to the right. It now starts after the space, as the browsers start that line and as `layoutWithLines()` does. At any letter spacing, a rich line's first fragment now starts after the spaces and soft hyphens a line start skips, where its `start` cursor used to sit before them (#380).
- In Firefox, a rich-inline fragment's text no longer holds the soft hyphen (U+00AD) that ends its item where that soft hyphen starts the paragraph or follows white space and the next item starts with a bidi control such as LRI; it now leaves the soft hyphen out, as a fragment's text does elsewhere (#373).
- In Firefox, rich-inline items no longer give two spaces where Firefox collapses white space and invisible direction marks such as LRM into one run: an item holding only white space and such marks between words, and white space around a mark after a soft hyphen at an item's end, now take the room of one space (#372).
- Rich-inline lines break where the same text in one element does in many more cases, now that each item continues the line before it instead of being laid out as if it started a line. A soft hyphen that starts an item after other text is now a break there, where the line used to end inside the word after it; in Firefox that holds before a combining mark too, after an ideograph or emoji such a break needs no room for a hyphen, as Firefox draws none there, and a bidi control such as U+202A after a space breaks as in one element. In Safari, an item holding a line or paragraph separator (U+2028 or U+2029) that ends a line now ends its line there, where the item went on the line whole, and a collapsed space before an item that starts with one takes no room. Where a line ends at a soft hyphen, the fragment's text now shows the hyphen that the line's width counts, and in Firefox two soft hyphens that start an item, or one right after a space, break as in one element, with no hyphen. An item holding only a soft hyphen now keeps the break before it, so a line that can't take the item after it ends there, and the collapsed space before it, which its fragment names in `gapItemIndex`, and which a line that ends after the item leaves out of its width where the browser ends the line at that space; an item that starts with a soft hyphen and a space keeps that space after other text on the line. White space between the soft hyphens of such an item now takes room after other text in Chrome and Safari, as in one element, and a line too narrow for anything ends at its first soft hyphen. In Firefox, white space collapses across soft hyphens and bidi controls from one item into the next, as Firefox collapses one run of them whichever element holds it, and a soft hyphen or bidi control that starts an item ends that run, as does a right-to-left mark such as U+200F after the white space and a soft hyphen in left-to-right text; an item that starts with white space and soft hyphens no longer gives an empty line before a word that doesn't fit, while a zero-width space after them still holds one. In Chrome, a newline next to a zero-width space in the item before or after it now goes, as in one element, instead of leaving a space (#369).
- In Firefox, lines break around bidi controls, invisible direction characters such as LRM, RLM and LRI, as Firefox breaks them, as if they weren't there: a control no longer takes a line of its own in a narrow box or separates an accent after it from the letter before it, a line that wraps after a space and a control no longer counts the space in its width, the spaces on both sides of a control take the room of one, and a control inside a word no longer takes letter spacing (#368).
- In Chrome, a CJK closing mark such as `」` or `）` before a newline in `white-space: pre-wrap`, or before a space, now fits at the end of a line with the narrower width Chrome's `text-spacing-trim` gives it there, where nothing earlier on the line can wrap, as in a narrow box, instead of moving to the next line (#366).
- Rich-inline lines break where the same text in one element does in more cases. In Chrome and Firefox, where items split a word, as when part of a Thai or Myanmar word is styled, lines end at that word's own breaks instead of splitting it between letters or ending before the part of it that fits. In Chrome and Firefox, and in Safari where the word holds a character Safari doesn't break at, such as a control character or a zero-width space followed by a combining mark, an item whose first word doesn't fit after a line break now moves to the next line instead of splitting that word (#359).
- Browsers whose layout engine Pretext doesn't recognize, such as Samsung TV web views, now follow Chrome's rules throughout. Before, a soft hyphen's hyphen also took letter spacing of its own there, a line whose hyphen didn't fit kept it overflowing instead of ending at an earlier break with room for it, and on desktop systems a line starting inside a word that holds an invisible character, such as a word joiner, didn't measure the rest of the word on its own as Chrome does (#356).
- `materializeLineRange()` and `materializeRichInlineLineRange()`, given a range that ends past its text, such as one kept from a longer text that was since prepared again, now build the text up to its end. Before, each missing segment added `undefined` to the line's text, and a range ending at segment `Infinity` ran until memory ran out (#353).
- In `white-space: pre-wrap`, a line holding only soft hyphens before a newline, at the start of the text or after another newline, now counts as a line, as browsers draw it, instead of disappearing. In Safari, in normal white space too, so does a line holding only soft hyphens or spaces between two line or paragraph separators, U+2028 or U+2029 (#349).
- In Safari, on pages with a language, text in `serif`, `sans-serif`, `cursive`, `fantasy` or `monospace`, or falling back to one of them, now measures in the font Safari draws it with there, such as Apple SD Gothic Neo for `sans-serif` on a `ko` page and Menlo for `monospace` on an `en` page, instead of the font those names give a page without a language (#340).
- In Chrome, CJK punctuation next to other punctuation or at a line end now takes the narrower width Chrome's `text-spacing-trim` gives it (#340).
- In Chrome and Firefox, ideographic spaces (U+3000) at a line end now hang past it, as spaces do, instead of wrapping to the next line (#340).
- A run of no-break spaces (U+00A0, U+202F or U+2007) between other break opportunities, such as between two spaces, now breaks where it overflows its line, as browsers do, instead of staying on one line (#340).
- In Firefox, a newline between East Asian characters no longer adds a space, and on `ja` and `zh` pages neither does one next to East Asian punctuation (#340).
- In Firefox, a soft hyphen where the line could break anyway, as after a space or between an ideograph and a Latin letter, no longer draws a hyphen or needs room for one (#340).
- In desktop Chrome and Firefox, where a word holding an invisible control, such as a word joiner, breaks across lines, the part that starts the next line is now measured together with the text before it in the word, as the browser shapes it, so narrow text around such controls wraps more as those browsers wrap it ([a28b5428](https://github.com/chenglou/pretext/commit/a28b5428)).
- Paragraphs made only of zero-width spaces now occupy one line instead of disappearing (#223).
- A zero-width space at the start of a paragraph or after a hard line break no longer disappears when the following text wraps to the next line (#227).
- Lines can now break after `?`, and after `!` or other exclamation punctuation such as `؟` and `۔`, before a following word, as browsers do, including after a space or zero-width space. Chrome and Safari still keep `!` with a following ASCII letter or digit; Firefox breaks there too (#228).
- In Safari, a combining mark after a zero-width space at the start of the text, at the start of a rich-inline item, or after a line break now stays with that zero-width space (#228).
- In Chrome, text prepared after changing `<html lang>` now uses the fonts for the new language, even when the font string is unchanged (#230).
- Figure spaces (U+2007) now keep adjacent text on the same line, like no-break spaces, as browsers do (#232).
- Lines can now break after `?` before `$`, `%`, `+`, `\`, `-` or `|`, after `!` or `?` before a symbol such as `©`, `¿` or `€`, and after the Arabic semicolon `؛` before a word, as browsers do. Firefox still keeps `?` with a following `-` or `|` (#233).
- A zero-width joiner now keeps the character after it on the same line (#233, #340).
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
- In Firefox, small kana no longer start a line after CJK text, as Firefox does (#250).
- When a line's first word is wider than the line, a following space or zero-width space now ends that line in `layoutWithLines()`, `walkLineRanges()`, `layoutNextLine()`, `layoutNextLineRange()` and rich-inline layout. Previously, other content such as a soft hyphen or a word joiner, or `letterSpacing`, moved it to the start of the next line. Plain-text line counts and widths don't change. With `letterSpacing`, rich-inline layout can also take fewer lines or give lines different widths, for example where invisible characters such as a zero-width space took a line of their own (#272).
- A negative `maxWidth` now lays out like 0 in `layout()` and the other plain-text line APIs. Previously it could give a different line count than 0, which could also depend on whether the text contained a soft hyphen or used `letterSpacing` (#272).
- In Safari, a word that ends in an invisible format character such as a word joiner now keeps its kerning with a following space when an explicit bidi control such as U+202A appears only in another paragraph, such as another line of `white-space: pre-wrap` text (#271).
- In Firefox, a combining mark after a line break or a space now stays with a following `$`, `%`, `+` or `\`, as it does at the start of the text. At narrow widths such text can also take one line fewer (#270).
- With `word-break: keep-all` in Chrome and Firefox, a URL containing a second `www.` or scheme such as `https://` before its query, as in `x中www.a/www.b?q`, no longer loses text. In Chrome and Safari, rich-inline layout no longer breaks such a URL where its text has no break opportunity, such as before its second `www.` (#269).
- After CJK text, `.`, `,`, `:`, `;`, `)`, `]`, `%` or `"` now stays on the same line as a following word or number, as browsers do (#276).
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
