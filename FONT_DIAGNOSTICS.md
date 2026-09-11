# Font context diagnostics

Findings from the optional font-probe tool: why whole-word, individual-letter and
line-prefix measurements differ. It is development tooling, not part of the
library's layout path. General measurement pitfalls belong in
[RESEARCH.md](RESEARCH.md#reading-browser-output).

Run `bun run font-probe --browser=chrome --output=/tmp/font-probe.json`, or open
`/font-probe` after `bun start`. Safari and Firefox are also accepted. The tool
uses the Google Fonts request from [#195](https://github.com/chenglou/pretext/issues/195)
and fails if the requested face is absent. That live URL does not pin a font
revision; a fallback font is not valid evidence.

The probes compare whole-run Canvas and DOM widths, isolated graphemes, separately
measured prefixes, prefixes inside the unchanged DOM text node, and Canvas prefixes
with one following grapheme retained. A language-matched HTML canvas tests font
selection separately. Repeated-letter controls sample 48 nearby wrap thresholds.
These are diagnostic models, not alternative public line breakers.

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
shaping, exact painted widths, or an unconditional browser policy. A font-name
correction would conceal the missing measurement information.

The repeated-letter extractor ignores Safari's extra zero-width rectangle at a
wrap boundary while keeping one native text node. That rule does not generalize
to controls or combining marks. Inserting grapheme spans can itself change shaping.

## Language context

For `foo-bar日本語` in `18px serif`, `lang=ja`, Firefox's DOM measured 114.867px
versus 106.983px in the default offscreen canvas. An HTML canvas with `lang=ja`
restored 114.867px. Chrome showed the same kind of difference; named Times New
Roman controls agreed in both browsers.

Safari's language-matched canvas still measured 106.972px against the DOM's
114.859px; its named-font control agreed. Matching `lang` alone is not a
cross-browser solution.

The [Canvas text-style specification](https://html.spec.whatwg.org/multipage/canvas.html#text-styles)
includes language context. Pretext's `setLocale()` controls word segmentation,
not Canvas font language. If measurements gain language context, cached
measurements for different languages must stay separate.

These probes did not retest the Retina emoji or `system-ui` bugs in
[PLATFORM_BUGS.md](PLATFORM_BUGS.md). The September 3 Firefox capture used DPR 1;
do not use those results to judge Retina-specific bugs.
