# Font context diagnostics

Findings from the optional font-probe tool
(`bun run font-probe --browser=chrome|safari|firefox` at 6fadbe5, a commit
from before its removal): why whole-word, individual-letter and line-prefix
measurements differ. It is development tooling, not part of the library's
layout path. General measurement pitfalls belong in
[RESEARCH.md](RESEARCH.md#reading-browser-output).

The tool uses the Google Fonts request from [#195](https://github.com/chenglou/pretext/issues/195)
and fails if the requested face is absent. That live URL does not pin a font
revision; a fallback font is not valid evidence.

Repeated-letter controls sample 48 nearby wrap thresholds.

## Shantell Sans

On September 3, 2026, `bold 15px "Shantell Sans"`, 56 `x` characters, a 140px
content width and `pre-wrap` produced native lines of 15/15/15/11 characters versus
Pretext's 16/16/16/8 in Chrome 152 and Firefox 152. Firefox's whole-run DOM and
Canvas widths both measured 501.75px; isolated characters summed to 480.66665px.
Agreement on the whole word did not establish its internal widths.

Enabling the existing prefix model fixed that width, but matched only 16/48
nearby thresholds for each Shantell face in Chrome. It was rejected. Chrome's
first bold `x` measured about 8.586px alone, 8.969px inside the whole DOM run, and
8.961px in Canvas when the following character was retained. That extra context
mattered, but the browsers did not use it alike:

| Diagnostic model | Chrome | Safari 26.5.2 |
| --- | --- | --- |
| Retain one following grapheme for fitting | 48/48 for both Shantell faces and Arial | 16/48 for each Shantell face; 48/48 for Arial |
| Reshape each line prefix | Insufficient for Shantell | 42/48 for each Shantell face |

These results support a contextual fit model for the tested inputs, not arbitrary
shaping, exact painted widths, or an unconditional browser policy.

## Language context

For `foo-bar日本語` in `18px serif`, the September 3 probe set `lang=ja` on its
test element in a `lang=en` page. Firefox's DOM measured 114.867px versus
106.983px in the offscreen canvas, which follows `<html lang>`, not the element.
An HTML canvas with `lang=ja` restored 114.867px. Chrome showed the same kind of
difference; named Times New Roman controls agreed in both browsers. With
`lang=ja` on `<html>`, installed Chrome 153 and Firefox 155 later measured this
text at 114.86px in both OffscreenCanvas and DOM.

Safari's language-matched canvas, which the probe never attaches to the page,
still measured 106.972px against the DOM's 114.859px; its named-font control
agreed. Safari measures a detached `<canvas lang>` with no language
([PLATFORM_BUGS.md](PLATFORM_BUGS.md)), and Pretext's OffscreenCanvas never
follows the page language there, so matching `lang` alone is not a
cross-browser solution.

On September 24, a probe measured 14 texts (Korean, Japanese, both Chinese
scripts, Latin, Hebrew, Arabic, Thai and Devanagari) at 40px in the five generic
families, `system-ui` and named controls on 12 page languages, in installed
Safari 27 on macOS 27, in WebKit 26.0.1 in the iOS 26 simulator and in Safari 27
on an iPhone on iOS 27. Under a page language whose WebKit script isn't Common,
the page drew each generic family in the family Core Text names for that
language: `sans-serif` in Apple SD Gothic Neo under `ko`, Hiragino Sans under
`ja`, PingFang under `zh`, Geeza Pro under `ar` and Thonburi under `th`, and
`monospace` in Menlo under every such language but `he`, `en` included, where
Canvas takes Courier; `fantasy` under `en` was Zapfino, where Canvas takes
Papyrus. OffscreenCanvas and a detached `<canvas>`, with or without `lang`,
measured identical widths throughout, and a connected `<canvas>` matched the DOM
on every text. The iPhone drew the simulator's family everywhere. The two systems
differ in `serif`, `cursive` and `fantasy` under `ko` and `zh`, where macOS names
AppleMyungjo, Songti and Kaiti and iOS names Apple SD Gothic Neo and PingFang, in
`sans-serif` and `cursive` under `he` (Lucida Grande and Apple Chancery on macOS,
Arial Hebrew on iOS) and in `serif` under `hi` (ITF Devanagari against Kohinoor
Devanagari). Safari can't use Kaiti on macOS 27 and draws the script's standard
family, Songti, instead.

With those families named in the Canvas font, macOS's where the context has it and
iOS's otherwise, Pretext's width matched the DOM on all 14 texts in every generic
family on `ja`, `ja-JP`, `ko`, `ko-KR`, `zh`, `zh-Hans`, `zh-Hant`, `zh-CN`,
`zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant-HK`, `zh-Hans-HK`, `en`, `he`, `ar`, `th` and
`hi` pages on both systems (0 to 6 of 14 before, where the family changed), except
where the named family lacks a character and fallback follows the language:
`monospace` under `ko` (7 of 14; Menlo has no Hangul) and `sans-serif` under `ja`
on macOS (12 of 14); and `fantasy` under `he` on iOS (5 of 14), where both
systems have both families and macOS's Papyrus stands. On the iPhone, which ran
the probe before the change, those families' OffscreenCanvas widths equalled a
connected canvas's under the page language on its 11 page languages, with the same
exceptions. No text got worse on any page.
A page whose language comes from a `Content-Language` header, `system-ui` (7 of 14
under `ko`, 8 under `ja`) and named fonts missing a character, such as
`"Helvetica"` under `ko` (7 of 14), were unchanged.

The [Canvas text-style specification](https://html.spec.whatwg.org/multipage/canvas.html#text-styles)
includes language context.

In headless Chromium 147, `20px "Helvetica Neue"` measured `骨直中文` at 80px under
`<html lang=en>`. After switching to `ko`, assigning the same font string to that
OffscreenCanvas context still gave 80px; a new context and the DOM gave 69.2px.
Preparation therefore starts with a new context and empty caches after the page
language changes. Headless WebKit 26.4's OffscreenCanvas gave 80px in both
languages.

## Firefox joined Arabic advances

Pretext measures Arabic letters on each side of a soft hyphen or an emergency
break at isolated widths. Gecko fits a line from the advances of the whole shaped
word and does not reshape at a break, so a joined letter keeps the glyph the font
chose for its neighbour. A Canvas total gives one equation per string, so no
recipe can split a word for every font.

The Arabic joining probe
(`bun run probe:arabic-joining --browser=firefox --output=<dir>` at 6fadbe5, a
commit from before its removal) compares DOM `Range` advances inside the intact
word, and native soft-hyphen and emergency thresholds, with Canvas recipes. On
September 12, 2026, installed Firefox 155 at DPR 2 measured 200 words from each
Arabic and Urdu corpus plus witnesses, 1,808 rows per font setup. Widths pass
within 1/60px. A false accept is a partition the pair additivity gate admitted
whose widths did not match.

| Font setup | Isolated widths | Per-grapheme ZWJ forms | Prefix + ZWJ |
| --- | --- | --- | --- |
| `16px "Noto Naskh Arabic"` | 144 pass / 1,432 fail | 1,458 / 118, 0 false accepts | 1,098 / 50, 0 false accepts |
| `16px Arial` (system Arabic fallback) | 300 / 1,276 | 1,462 / 114, 0 false accepts | 1,104 / 44, 0 false accepts |
| `16px "Geeza Pro"` | 316 / 1,260 | 1,432 / 144, 42 false accepts | 1,095 / 53, 21 false accepts |
| `16px Georgia` (fallback) | 316 / 1,260 | 1,054 / 522, 10 false accepts | 936 / 212, 10 false accepts |
| `16px Amiri` | 82 / 1,494 | 746 / 830, 0 false accepts | 702 / 446, 20 false accepts |
| `16px "Noto Nastaliq Urdu"` | 94 / 1,482 | 438 / 1,138, 12 false accepts | 474 / 674, 66 false accepts |

The 24px setups gave the same picture. The ZWJ forms need an rtl canvas: the same
queries in an ltr canvas failed more than half the widths. Across the corpus
words, per-grapheme forms took 66 distinct Canvas queries, prefixes 147 and the
gate 243, against 45 for isolated widths.

Per-grapheme ZWJ forms recover the joined advances for Noto Naskh Arabic and for
the system Arabic font behind Latin font stacks. Amiri and Noto Nastaliq Urdu are
out of reach: most widths still fail, or the gate admits wrong partitions. A
Firefox rule therefore needs the gate and a fallback to isolated widths per font.
