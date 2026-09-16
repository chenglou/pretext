# Research Log

Durable findings and rejected approaches from building this library. Keep the
reasoning that code and commit messages do not make obvious; current behavior and
limitations belong in [README.md](README.md), and validation commands and current
results in [DEVELOPMENT.md](DEVELOPMENT.md). Browser bugs and workarounds live in
[PLATFORM_BUGS.md](PLATFORM_BUGS.md); detailed font measurements live in
[FONT_DIAGNOSTICS.md](FONT_DIAGNOSTICS.md).

## Measurement Model

Measuring whole candidate lines during layout, hidden DOM text, and SVG text were
tried; none earned the extra work or the loss of the `prepare()`/`layout()`
separation.

Adding measured segment widths is an approximation: adjacent glyphs can affect
each other's shape and spacing. Keeping punctuation with its word and allowing
trailing collapsible spaces to hang improved results. Uniform scaling and generic
pair corrections did not recover the missing context reliably. Agreement on a
whole word also does not establish the widths of its possible line prefixes.

Engine profiles describe the layout engine, not the browser brand;
`getLayoutEngine()` in `src/measurement.ts` explains how the user agent names it.

## Breaks And Source Positions

Storage segments, measurement spans, ordinary break opportunities and emergency
grapheme breaks are different things. `Intl.Segmenter`'s `isWordLike` is a useful
hint, not permission to break: an overlong symbol run may need emergency breaks
too. Emoji, control-bearing fragments and standalone marks cannot inherit that
rule merely because they are not words. Attached marks stay with their base.

Preserve neighboring source characters until break policy has used them. Merging
punctuation, URLs or numeric expressions too early erases context that later
passes cannot recover. In particular, an ASCII hyphen after CJK attaches left,
while a numeric sign stays with its suffix. Keeping an ordinary unit together
does not forbid emergency grapheme progress when it is overlong. Kinsoku clusters
such as `漢。` or `「漢`, and keep-all groups, are no exception: under
`overflow-wrap: break-word`, Chromium retries an overflowing line with grapheme
breaks, WebKit in Safari 26.5.2 breaks at an arbitrary position once the line has
no earlier wrap opportunity, and Firefox admits a word-wrap break at every cluster
start, all ignoring line-break classes. WebKit trunk keeps `漢。` together when not
even `漢` fits (`firstCharacterBreakRespectingLineStartProhibitions`), which Safari
26.5.2 doesn't have. Several narrow rows passed only while this
missing break cancelled another error, such as a combining mark detached from its
base by the forward carry, U+3000 not hanging, joined Arabic widths, raw controls
or Chrome's text-spacing-trim. Firefox can
segment Hangul plus Latin as one word where other runtimes separate it; policy
must not depend on those incidental storage differences.
Extending Firefox's ASCII opener/numeric rules to wider Unicode cases exposed
trailing-space fit failures, so the accepted rules remain narrow.

Question and exclamation marks are UAX #14 class EX. ICU and ICU4X break after
EX unless the next character's class forbids a break before it (LB31), and
Firefox sends every word containing EX to ICU4X: its ASCII shortcut covers only
AL, IS, NU and QU words. Chrome and Safari first consult a pair table for
characters up to U+00FF. It follows ICU except for printable ASCII, where `?`
breaks before everything except `! " ' ) , . / : ; ? ] }`, and `!` breaks only
before `(`, `<`, `[` and `{`. Every merge that could join across that boundary
asks the same rule: the punctuation, hyphen and numeric-affix appends, the
forward carry, symbol chains, URL and numeric runs and keep-all run ends. So
`x?|$b`, `x?|-|b` and `x!|©b` break as in Chrome and Safari, while Firefox keeps
`x?-|b`. A URL query unit joins the text after `?` up to the next break this
rule allows, such as a second `?` before a letter, so in `https://x.com/p?-a` it
keeps `-a`, while browsers also break after that hyphen. Above U+00FF Pretext
reads the LineBreak.txt class of a following letter, number or symbol, so an
iteration mark such as `々` (NS) stays after `！`, while numeric affixes and
opening punctuation break; other punctuation keeps its existing attachment.
Small kana and `ー` (CJ) after EX follow the engine and page language; see
Content Language. Safari's keep-all still breaks only at spaces. U+061B ARABIC
SEMICOLON is EX too, while `:`, `.` and U+060C are IS and keep a following
Arabic word (LB29). Firefox also breaks after BA such as `|` and CL such as `}`
before a letter or digit, which symbol chains do not model: installed Firefox
155 paints `xy abc} / 1234`, and ` 丙` after the word doesn't change it, since
ICU4X decides each word alone.

After CJK text, no engine breaks before punctuation that UAX #14 keeps with the
text before it, such as `'`, `/` or `|` (LB13, LB19, LB21), so Pretext attaches
punctuation to CJK text by its class. Opening curly quotes don't attach, since
they can start a line next to East Asian text (LB19a), and neither do U+3000 and
the other space separators, which hang or trim at a line end. The text after
such a mark is decided differently by each engine (#274, #293). Blink reads its
pair table for any two code units up to U+00FF, whatever comes before them, so
`丙!a` keeps `!` with `a`, as `x!a` does. WebKit reaches ICU at the CJK
character, takes ICU's next break, and skips ahead over ASCII letters without
reading its table (`BreakablePositions.h`). So ICU's rules decide before a
letter and the table before a number: `丙!|a` breaks and `丙!1` doesn't. The skip
reaches only the pair right after the character that reached ICU, so the table
keeps `丙!!first` and `丙.!first`, and a letter between the CJK text and the mark,
as in `丙a}first`, puts the pair back on the table. WebKit skips ICU entirely
when CL or CP follows an ideograph or Hangul syllable, so `}` keeps a letter
after Han and Hangul, but not after kana. Firefox sends those words to ICU4X.
The September 15 installed probe (Chrome 153, Safari 26.5.2, Firefox 155; `甲乙丙`,
`あいう` or `가나다` before 32 ASCII marks and `first_week`, `FirstWeek`, `1234` or
`αβγδεζη`) matched each rule: Chrome keeps `!`, `}`, `/`, `|` and `'` with an
ASCII letter or digit and breaks after all but `'` before Greek, Safari breaks
after `!`, `/` and `|` before a letter and after `}` only after kana, and
Firefox follows UAX #14. The boundary rule that answers the exclamation and
Gecko pairs answers these too, for Chrome and Safari only before an ASCII letter
or digit: Pretext doesn't model their tables before ASCII symbols. Where UAX #14
keeps the pair, as IS, CP, PO and straight quotes do before a letter or number,
all three engines keep it, and Pretext joins that text to the CJK text's last
unit, which still takes grapheme breaks when it doesn't fit. Only punctuation
joins, never a letter inside a CJK unit such as the Arabic in `中（ابب）`, and a
closing curly quote doesn't: LB19 no longer keeps the text after it, and Chrome
breaks before `tail` in `中文中文””tail`.

No break precedes closing punctuation or a nonstarter, whatever comes before it
(LB13, LB21). For these marks above U+00FF all three engines reach ICU or ICU4X, and
installed Chrome, Safari and Firefox keep `，」：。）！？、` and `」。` after `xxxx` or
`1234` whenever the text plus the mark fits an empty line, breaking before the mark
only in an emergency. So Pretext joins a text segment whose first code point passes
its kinsoku test to the text segment before it, whatever that text is. Small kana
and `ー` follow the profile there as after CJK text: Chrome breaks before them after
letters and digits on every page, Safari only on `ja` and `ko` pages, and Firefox
never. The join runs after the URL, numeric and no-space merges, which skip text
that contains CJK: joining in the first pass left `(10:|30)，`, `foo@|bar.com，`
and `x“|value”，`. It runs before the forward carry, which then moves `「` from
`739x「` onto `value」!`. The first pass keeps its own join after CJK text, since
it also keeps ASCII punctuation there: without it, `丙|.first` and `中文|.b` break.
A space, zero-width space or other segment kind still separates a mark from the
text before it; no installed run has observed `a ，b`. Firefox breaks before the
mark after a run of complex-script code points: ICU4X hands a run of two or more
SA code points to its dictionary or LSTM segmenter, which reports the end of the
run as a break whatever follows, even for an SA script with no model, so Firefox
paints `a ខ្មែរ / ，b`, and the Gecko profile keeps that break.

No break follows ZWJ (LB8a), so a ZWJ at the start of the text or after a ZWSP,
tab or hard break stays with the next word. A ZWJ right after a space belongs to
that space's grapheme cluster. Browsers break between them, but a line that
starts there splits the cluster, so Pretext keeps its earlier boundaries. CJK
units still break after a ZWJ. A unit that joins graphemes still takes emergency
grapheme breaks, as browsers split `日！々` at narrow widths, but after U+3000 the
break following the ZWJ also stands in for the break after the ideographic space,
and Pretext keeps an ordinary break before U+3000 that UAX #14 forbids (LB21), so
both need a U+3000 model first.

A hyphen after a space, ZWSP, hard break or the text start keeps a following
alphabetic (AL) or Hebrew (HL) letter (LB20a) in Chrome and Safari: always for
U+2010 and the other Unicode 17 HH dashes such as U+2013 and U+05BE, and for `-`
before a letter above U+00FF. Letters of other classes, such as Bopomofo, Hangul
jamo, Yi or Balinese, still break. ICU 77 counts only U+2010 as HH and keeps
only AL letters, so a headless Chromium build on ICU 77 breaks after the dash
before a Hebrew letter. ICU 78 adds HL and the other HH dashes. Installed Chrome
153 keeps each one observed, before Hebrew letters too, as Safari 26.5.2 does:
U+2010, U+2012, U+2013, U+058A, U+05BE, U+1400 and U+2E17. Such a word no longer prefers
the break after its hyphen when it overflows; browsers fill graphemes there.
Their pair tables break `-` before an ASCII letter, and Safari's also before most
Latin-1 letters, such as `é` but not `ª`. Chrome sends a non-ASCII follower of
`-` to ICU instead, which keeps those letters; Pretext does not model that.
Combining marks between `-` and a Latin-1 letter, as in `a -\u0301\u00E9b`,
hide the letter from the pair tables, so ICU keeps it, while Pretext still
breaks there. ICU 78's LB20a letters ($ALPlus) also include AL and AI symbols
such as `#`, U+00A9 and U+221E, so Chrome and Safari keep `a \u2010\u00A9b`
and `a -\u221Eb` together, while Pretext keeps only `\p{L}` letters. A TAB
before the hyphen is UAX #14 BA, not a space. Safari's scan reads it even when
normal white space collapses it and breaks after the hyphen, while Chrome breaks
the collapsed text and keeps the letter; Pretext follows each for `-`, U+2010,
U+2012 and U+2013. Headless WebKit also breaks after a TAB before the other
eight HH dashes, but Pretext joins each of them to the next text in every
browser. Chrome also restarts its ICU context
at each line start, so after a pre-wrap TAB the result
can depend on where the line began. A rich-inline item is analyzed as
its own text, so an item that starts with a hyphen keeps its letter as at a text
start. That matches Safari's per-node scan, but Chrome's context crosses items.
Firefox's ICU4X 2.1 rules follow Unicode 15.0, before LB20a.

ICU4X keeps a hyphen-minus (HY) with a following number (NU), ASCII or not
(LB25), so installed Firefox 155 moves `log-2026` or `2025-08-01` to the next
line whole and breaks `crash-log-2026-09-12.txt` only after `crash-`. Chrome and
Safari break `-` before an ASCII digit from their pair tables. Gecko also marks
the position after a hyphen between alphanumerics as an emergency wrap
(`gfxShapedText::SetupClusterBoundaries`), taken only when nothing else fits: under
`overflow-wrap: normal` Firefox paints `log- | 2026` once the word can't fit a
line, while under `break-word` every cluster start is such a wrap and it fills
graphemes (`log-2 | 026`). A probe that reads only `overflow-wrap: normal` lines
sees a break there. Fullwidth digits are ID, and U+2010, U+2012 and U+2013 are
BA in ICU4X's data, so Firefox still breaks after them before a digit. The Gecko
profile answers the pair in the ASCII model's boundary rule, which every merge
asks, keeps the pieces of a numeric run such as `8:30-4:30` together, and doesn't
prefer that break in an overflowing word. Before Arabic-Indic, Devanagari or
mathematical digits Chrome keeps the hyphen too, and so does Safari except before
Arabic-Indic digits; Pretext breaks there in both profiles.

`/` isn't in Gecko's table of ASCII characters that never break
(`kNonBreakableASCII` in `nsLineBreaker.cpp`), so Firefox sends every word
containing it to ICU4X, which breaks after `/` (SY) wherever UAX #14 allows it.
The SY row of ICU4X 2.1.1's line table breaks before AL, ID, OP, PR, PO, B2, SA
and emoji, and keeps `/` before BA, CJ, CL, CP, EX, GL, HY, IN, IS, NS, QU and SY
(LB13 and others), HL (LB21b) and NU (LB25). So installed Firefox 155 paints
`https:// | example.com`, `example.com/ | docs`, `and/ | or`, `a/ | (b)`,
`a/ | #b` and `see / | docs`, keeps `1/2`, `example.com/2026`, `a/"b"`, `a/.b`
and `a/עברית`, breaks after a combining mark on `/` rather than before it, and
never breaks before `/`, after CJK text either. Keep-all, pre-wrap, letter
spacing, right-to-left paragraphs and rich-inline items split next to `/` give the
same breaks, and a unit that doesn't fit fills graphemes but still ends its line
at that break (`ryname/ | anotherl`). Chrome and Safari keep `/` with a following
ASCII letter or symbol from their pair tables, and break before Latin-1, Cyrillic,
Arabic, Thai and CJK letters as ICU does. The Gecko profile answers the pair in
the same boundary rule as the hyphen pair, from the generated class table, so
every merge breaks there. A URL run stops after `https://` or at the first `/`
before a letter, and a URL query unit forms only when no such break comes before
`?`; without one, `-` and `/` before a letter break inside the query too, as in
Firefox.

U+2007 FIGURE SPACE is UAX #14 class GL, like NBSP and NNBSP, even though it is
a space separator. Chrome and Safari treat only SPACE, TAB and LF (Safari also
LS/PS) as breakable spaces, and their pair tables stop at U+00FF, so U+2007 goes
to ICU's GL rules. Firefox's line breaker splits words only at SPACE, TAB and
CR, so U+2007, like the rest of U+2000..U+200B, stays inside the word it sends
to ICU4X, which applies the same GL rules. Treating it as plain text let
`Intl.Segmenter`'s word boundaries around it become break opportunities.

Chromium breaks between a fullwidth closing bracket such as `」` or `）` (UAX #14
CL) and a following ideograph. The Chromium profile carries CJK text after
closing quotes (QU) only. Outside
keep-all it is still broader than UAX #14 LB19a, which allows a break after a quote between East Asian
characters (`文”|文`), though not after `.”` before Hangul. Chromium's ICU rules for
Chinese pages treat `”` as CL and break there too (`다.”|라|고`).

`Intl.Segmenter` joins some nonstarters, such as `゛` or `ヽ`, with the kana after
them, so a piece's first code point decides whether it attaches to the preceding
text.

Under `word-break: keep-all`, Blink keeps a pair only when both sides are letters
or numbers by general category and neither is SA. It tests UTF-16 code units and
looks past one combining mark before the boundary, so it never keeps a symbol or a
supplementary character, and it leaves every other pair to ICU's ordinary rules.
So a letter that cannot start a line, such as `々`, `ゝ`, `〼`, `〵` or `ー`, does not
end a run in the Chromium profile, while punctuation such as `」`, `・` or `゛` does.
Gecko's ICU4X keeps pairs by line-break class instead (AI, AL, ID, NU, HY, the
Hangul classes and CJ), where a mark takes its base's class. It keeps `ー`, symbols
such as `★`, supplementary ideographs and, after an ideograph, `〵` or an
ideographic variation selector, but breaks after NS letters such as `々` or `〼`,
and after `〵` following a closing bracket. `keepAllPairModel` picks Blink's rule,
ICU4X's, or WebKit's, whose keep-all breaks only at spaces; newer WebKit source
also breaks after opening, closing and other punctuation there, but not after
letters.

Where the engine does not keep a pair, Pretext ends a keep-all run where UAX #14
allows a break between the two line-break classes. The classes come from a table
generated from LineBreak.txt. A mark takes its base's class (LB9), and the check
keeps every pair that some Unicode 17 rule keeps in some context, such as the
numeric pairs of LB25. So a run ends before an opening bracket after an ideograph (`文|「文`,
`文|¡文`), after a closing bracket before an ideograph (`❩|文`), between CJK text and
Thai letters, emoji or symbols (`文|★|文`, `🎉|🎉`), after punctuation whose class
breaks after it (`😊/|文`, `😊‼|文`, `★||文`), after a keycap, between two flags, and
between a letter or number and an East Asian opener, which LB30 does not keep
(`a|「`). It does not end before a closing bracket, after an opening bracket, after
BB such as `´`, or between AL symbols such as `©` and `→`. Older rules keep more.
ICU4X's Unicode 15.0 rules keep any character after a Hebrew letter and HY or BA
(LB21a), so the Firefox profile keeps `א|文` in one run. ICU 78 keeps a
following character other than CB or a Hebrew letter only after HY or HH, so the
Chromium profile ends the run after `א|`.
ICU4X still breaks between an ideograph and a Hebrew letter under keep-all, since
it keeps only pairs of AI, AL, ID, NU, HY, Hangul and CJ classes. So `文א|文` ends
a run before `א` in Firefox and after `|` in Chrome. Chromium and WebKit decide
pairs of code units up to U+00FF from their own tables, and Gecko decides ASCII
pairs from its own model, so Pretext's punctuation rules keep deciding those.
U+3000 is BA, but engines hang or trim it at a line edge, so a run does not end next
to it until U+3000 has a line-edge model: splitting there lost installed Chrome and
Firefox rows where a line starts with U+3000, and headless Chromium widths where
Chrome trims `「` after it. These run ends split a keep-all group, the text between
spaces, glue, listed punctuation and dashes. Every run of a group with CJK text
stays merged, as `❨😊❩` does between ideographs, and keeps its group's emergency
grapheme breaks, which a group takes when any of its pieces is a word.

ICU 77 and 78 break before an opening quotation mark and after a closing one between
East Asian characters (LB19a). Gecko's ICU4X rules follow Unicode 15.0 and keep both;
`breakAroundEastAsianQuotes` records the difference. Pretext's CJK ranges and
emoji-presentation characters stand in for East Asian Width there. Under keep-all,
the Chromium profile's CJK units no longer carry CJK text after a closing quote
where LB19a breaks, so `文|“漢字”|文` ends both runs. Chrome restarts its ICU context
at each line start, so when an emergency break lands just before a closing quote,
Chrome no longer sees the East Asian character before the quote and keeps the quote
with the next ideograph, while Pretext breaks after it. That loses 16 installed
Chrome 153 rows, 8 per direction: `signed-spacing/keep-all/curly-double-close` and
`curly-single-close` at letter spacing 1.5, where Chrome gives `中文中文|”漢字kan|a`
and Pretext `中文中文|”|漢字kan|a`.
An emoji and a following opening quote form one piece, so the break between them
stays hidden.

Headless Chromium 147, which most headless keep-all evidence comes from, runs ICU
77.1 with Unicode 16 data, while installed Chrome 153 runs ICU 78.2 with Unicode 17
data, which the generated table follows. The headless build cannot check the HH,
LB21a and LB20a differences described above. The two versions' LB19a rules are
identical, so the quotation mark evidence carries over.

WebKit's pair scan never breaks before a basic combining mark. It reports the
break between ZWSP and that mark (LB8) only from an ICU lookup that started
before the ZWSP. Every text node starts its own scan without prior context, so a
ZWSP at the start of a node, or after LF, CR, FF or another mandatory break, keeps
the mark, while a leading SPACE or TAB is context. This holds per node, not per
paragraph: a rich inline item that begins with ZWSP and a mark keeps it too.
`prepareRichInline()` prepares each item's own text, so a collapsed leading SPACE
still reaches analysis and fragment cursors index `prepareWithSegments(item.text)`.
Safari keeps the mark after a raw CR as well; the separate line that CR can take
in pre-wrap is the raw CR limitation below. Firefox keeps ZWSP with any following
cluster extender in every position, because shaped words end at ZWSP and a
word-initial extender is not a cluster start. Pretext does not model that
granularity. Gluing them everywhere lost native successes, because Firefox also
applies letter spacing and emergency breaks per cluster.

The CSS segment break transformation differs per engine. In normal white space,
Blink and Gecko remove a collapsible run containing a newline when a ZWSP
immediately precedes or follows the run; WebKit turns the run into a space like
any other. A word joiner between the newline and the ZWSP keeps the space.
Each engine checks adjacency on its own collapsible run. Blink's run is SPACE,
TAB, LF and CR, so a form feed between the newline and the ZWSP keeps the space.
Gecko's run is SPACE, TAB and LF: a carriage return breaks adjacency, the run
continues through soft hyphens and bidi controls without ending on one, and a
last space before a combining mark stays outside the run and survives. Deciding
adjacency on Pretext's own collapse set instead lost headless Chromium widths on
form-feed shapes and predicted Firefox losses on CR, SHY and combining-mark
shapes. Blink
checks the previous character across element boundaries, while Gecko sees one
text node at a time, so the rich-inline helper applies the rule only inside an
item. Blink compiles out its East Asian width rule. Gecko also removes a newline
between two full-, half- or wide-width non-Hangul characters, skipping default
ignorables, and, for `ja` or `zh` content, next to such punctuation. Pretext does
not model those Gecko rules: the ja/zh corpora contain such newlines, and their
native paragraphs are observed from space-normalized text.

NEL (U+0085) is UAX #14 class NL: a break follows it, and no ordinary break
precedes it (LB5, LB6). Chrome and Safari break that way, and so do Firefox's
ICU4X rules, but only the Safari profile models it. Each NEL is its own segment. When one overflows
right after text or glue, the line ends before that content instead, so the
content moves to the next line with the NEL; when the content started the line,
overflow still breaks right before the NEL, as browsers do. Joining NEL to the
content before it instead split overlong words at Canvas grapheme widths where
browsers break before the NEL. A ZWSP or soft hyphen right before NEL still
offers its break in Pretext, and so does any spurious boundary before the NEL,
such as the ordinary break before U+3000 that LB21 forbids. Pretext keeps NEL
inside CJK keep-all runs, as it kept NEL text,
and elsewhere keeps NEL as its own segment with its break after it, the way it
still breaks after a hyphen in Latin keep-all text. Merging NEL with the text on
both sides lost emergency breaks in emoji runs, which the overflow rule above
withholds from control-bearing fragments, and Canvas prefix widths across NEL
gave a following combining mark a 12px advance in 16px Arial, so the mark took
its own line. Starting a new keep-all run at NEL after glue also put a break
before the NEL. In normal white space, `漢<NBSP><NEL>字 漢字` at -1px loses a few
headless widths where Safari fills the overlong unit by graphemes: Pretext breaks
between the ideograph and the NBSP, which LB12a forbids.

Safari's simple text path replaces a control character's advance after applying
letter spacing, so NEL takes none, at either sign. In Safari 26.5.2 `a<NEL><NEL>b`
grows by 2px per pixel of spacing from -1px to 1px, a line holding only NEL
keeps its width, and `<NEL><NEL>` fits 24px at 1px and 2px. Per-character Range
rects split those 24px as 13 and 11 at 1px and as 14 and 10 at 2px, so only the
total is an advance.
Pretext still places the gap of the grapheme before a NEL and adds none after
it. Safari's complex path spaces NEL like other characters. A combining mark
directly after NEL puts NEL on that path on either page direction. Text before
NEL shares its item only when its direction matches the page's: Arabic on a
right-to-left page, Devanagari, Thai or a marked letter on a left-to-right one.
Preparation cannot see the page direction, so a NEL next to text in WebKit's
complex ranges keeps its spacing. Safari's unspaced NEL after Arabic on a
left-to-right page, or after Devanagari on a right-to-left page, is not modeled.
Inside a CJK keep-all run, NEL keeps per-grapheme spacing, as NEL text did.

Safari moves a `pre-wrap` tab to the following stop when less than half a space
would remain before the next one. Stops are eight spaces apart. The spaced NEL hid
that: in `ab<NEL>\tcd ef` at 2px in 16px Arial, the pen stands 1.77px before the
first stop with NEL unspaced, and Safari's tab reaches the second stop. Headless
WebKit 26.4 jumps 1.77px before a stop but not 2.28px before one. Replaying
Safari 26.5.2's suite rows with this threshold fixes 70 left-to-right and 8
right-to-left tab rows. WebKit trunk's threshold, half the advance of `0`, loses
10 and 6 more rows. Headless probes lose a few widths to one overflowing tab
at negative spacing, such as `ab cd\tef gh\tij` at -1px in 16px Arial: Safari
moves the tab to the second stop and hangs it, and Pretext breaks before it. Only
the Safari profile models the threshold.

In pre-wrap, a run of preserved spaces and tabs at the end of a line hangs (CSS
Text 3 §4.1.2, §8.2): it takes no room when fitting and doesn't count in the
line's width. Before a hard break or the end of the text, only the part past the
available width hangs. Fitting and the reported width have to use the same width,
the one before the run with the gap after the glyph before it, or a text laid out
again at its widest line wraps differently. While the walker counted the space
before fitting the tab after it, `foo \t bar` laid out again at its 28.8px widest
line gave `foo ` / `\t` / ` ` / `bar`. Subtracting the last space's width in the
Markdown chat (#267) couldn't cover tabs, whose advance depends on the pen
position, runs of several segments or letter spacing (#294). Firefox doesn't hang
tabs: hanging them in every profile lost 332 left-to-right and 100 right-to-left
installed Firefox rows where main matched, such as `abc\tdef` at 20px in 16px Arial
with letter spacing −2, which Firefox paints as `abc` / `\t` / `def`. The Gecko
profile keeps main's tab rule, so a tab counts in the fit and the width there.

Chrome and Firefox keep NEL as ordinary text. In Chrome the same rule lost rows
that main matched only because two errors cancelled: Chrome joins Arabic across
a soft hyphen that Pretext measures as separate segments, hangs preserved spaces
at emergency widths, and gives a word joiner no letter spacing, while Pretext
spaces it. That last gap also costs Safari `aa<NEL>\u2060bb` at 1px, where main
kept the joiner on the NEL's line. Release Firefox also breaks after NEL, but
draws control characters with no advance while its Canvas measures NEL as a
space.

The shared complex walker fixed batch/streaming disagreement after a soft hyphen
([#222](https://github.com/chenglou/pretext/pull/222)). A later usable break could
win in one path while another rewound to the hyphen. This needed one decision
algorithm, not more width measurements.

Do not assume every remaining walker can be collapsed the same way. The simple
walker kept a SPACE or ZWSP after forced overflow on the overflowing line, while
the complex walker moved it to the next one, so a soft hyphen anywhere in the text
changed public cursors. The complex walker now keeps it too, and every walker lays
out a negative width as 0, where the two also disagreed. Routing simple handles
through the complex walker still made `layout()` about twice as slow on
simple-path documents in a Node microbenchmark. Reusing batch traversal for
statistics preserved output but made long-form statistics materially slower.

A selected discretionary hyphen must fit. Chromium retries a text item whose
hyphen does not fit against the available width minus the hyphen, WebKit reverts
to the last wrap opportunity where the hyphen fits, and Gecko records a
soft-hyphen break only when its text plus the hyphen fits. Installed Chrome 153,
Safari 26.5.2 and Firefox 155 all end `ab cd\u00adefgh` (Arial 16) at the space
from 39.25px to 44.25px. In Blink the walker returns to the latest earlier
opportunity whose line leaves room for the hyphen. The target is updated whenever
a later opportunity replaces the pending one, so an earlier soft hyphen can win:
installed Chrome ends `a b\u00adc\u200bi\u00adjki` (Arial 16) at the first soft
hyphen from 34px to 35.5px, where the zero-width space leaves no room for the
hyphen. Blink's retry stays inside one text item and rewinds earlier items at the
full width. The prepared handle has no Blink item boundaries, so the reduced width
applies to every earlier opportunity, which can miss a return to an earlier item.
Chromium also paints the hyphen without letter spacing; WebKit and Gecko space it.

Returning needs an overflow that isolated widths can show, and a target that is
really the latest opportunity. Blink shapes the text on both sides of a soft
hyphen together, so Arabic letters joined across it, a mark after it and a kerning
pair around it measure narrower in context. When Canvas measures the neighbors of
any soft hyphen on the line narrower joined than apart, the overflowing hyphen
stays; contextual widths during preparation would replace that check. Segment
kinds do not mark every opportunity: text joined to text, such as after `-` in
`ab-cd` or between ideographs, and a dash inside one segment, such as `10–20`, can
hold one. The walker never returns past either. Returning past them lost 142
installed Chrome rows on compounds such as `x ab-cd\u00adefgh` and
`a well-known\u00adness`.

The return is enabled in Blink only. Isolated widths cannot show what WebKit and
Gecko need: letter
spacing on U+2060, which those engines do not apply, and combining marks after a
soft hyphen, where Safari breaks between the soft hyphen and the mark and Firefox
paints the hyphen. WebKit and Gecko keep the overflowing hyphen until those are
modeled. Chrome's remaining losses have the same partners. Chrome gives U+2060 no
letter spacing, so `a\u2060b cd\u00adefgh` at letter spacing 1 and 2 still fits
its hyphen line, and it kerns across the space in
`LTA To AV\u00adWAVA`. Chromium breaks after a combining mark that
follows a soft hyphen and paints no hyphen, and a soft hyphen between word joiners
is no opportunity.

Without a fitting opportunity Safari overflows with the hyphen, while Chrome and
Firefox break inside the word. Chromium re-breaks the line at grapheme boundaries
and again retries an unfit hyphen against the reduced width. Gecko keeps cluster
breaks that fit, never between a letter and its soft hyphen (installed Firefox
ends `abc\u00addef\u00adghi` at 26px as `ab` / `c-` / `de` / `f-ghi`), and
otherwise its first candidate. Prototypes of both rules lost hundreds of existing
successes in a headless replay: marks and joiners next to soft hyphens,
letter-spaced invisibles, Arabic contextual widths, and hyphen fits within
Chromium's 1/64px rounding. The overflowing line remains.

A source-coordinate prototype showed that internal storage can change without
changing public output, but only if measurement-local grapheme boundaries survive.
Segmenting the complete source into graphemes is not automatically an equivalent
partition. A word may span stored SHY/mark pieces; entering a later segment is not
the same as starting an untouched word. Finer source positions need not mean more
Canvas calls; they also do not create shaping information we never measured.
The extra compiler/adapter remains experimental and has not earned its production
cost.

Safari's emergency breaks can land inside a grapheme. WebKit steps through an
overflowing word by code point on its simple font path and by ICU cluster on its
complex path, so in a narrow box Safari can end a line partway through a
multi-code-point grapheme. Pretext keeps every public cursor on a grapheme
boundary and moves the whole grapheme instead. That mismatch is accepted: the API
promises grapheme boundaries, and the affected lines only occur where a word
doesn't fit its box.

## Widths After A Line Break

A ZWSP at a paragraph or hard-break start is real source. It establishes a line
and offers a break after it, without owning a letter-spacing gap.
Chrome and Firefox shape an Arabic letter before a selected SHY in context, so
ZWSP, beh, SHY and beh fits in boxes where Pretext's isolated letter width does
not. A raw CR before ZWSP in pre-wrap occupies one native line, while
normalization turns that CR into a hard break. Amiri ZWSP, beh, SHY, beh and
ZWSP, U+A65C, SHY, U+A65C prepare identical widths but need different native line
counts, so no rule inside `layout()` can repair the Arabic case; it needs
contextual widths during preparation. An Arabic-letter guard across SHY, deleting
raw CR and treating CR as a zero-width break each lost other native successes.

Keep the original source through analysis:
normalization can erase distinctions needed here. Chrome's normal-mode FORM FEED
followed by ZWSP occupies two lines at width 1 but one at width 100, even though
normalization reduces both inputs to ZWSP. Pre-wrap currently normalizes raw CR
and LF to the same hard boundary, although their native line existence can differ.

An executed WebKit trace separates another source rule from width measurement.
With Amiri at 16px, a 14.75px-wide LTR pre-wrap paragraph containing ZWSP, Arabic beh,
SHY and beh produces four lines: empty, beh, hyphen, beh. After forcing the first
letter onto a line, WebKit leaves the SHY unconsumed. Pretext consumes it earlier.
WebKit already includes the possible hyphen in its candidate width before
overflow; it also considers the previous SHY when wrapping the following text.
Neither a width adjustment alone nor “add the marker after wrapping” describes
this path.

In the investigated WebKit path, SHY becomes discretionary only at the end of
the actual text item.
An internal SHY still occupies source but does not own a marker. The ordinary
endpoint depends on WebKit's boundary shortcuts, Unicode properties and locale;
keep-all uses a different boundary policy. Source occupancy and painted width
must remain separate. The derived policy passed independent ICU checks, but
integrating it still lost existing browser successes around resumed geometry.

Range geometry cannot establish SHY paint in keep-all: Arial 16 `a\u00adb` at
width 10 paints `a / b`, although the hidden SHY has a positive rectangle.

Chromium retains the complete RTL-shaped item across ZWSP and SHY. The same text
fits intact at 25px. At 14.75px it selects a cut after SHY, reshapes the selected
text range with the surrounding original source still available, then adds a
separately shaped U+2010 hyphen in the paragraph's LTR direction. The remaining
letter is reshaped at the next line's start. The selected glyphs differ from
the original whole-run glyphs. Do not treat isolated-letter widths or one RTL
text-and-marker measurement as equivalent observations. Keeping source positions,
measurement context and selected line geometry separate still matters.

These traces used source-built Chromium 152 and cached Playwright WebKit 2272.
They establish those builds' executed paths,
not an execution trace of the installed binaries or general engine equivalence.

Three quantities that look like “remaining width” need different treatment:

- The width used to decide whether the remaining word fits intact.
- The width assigned to a selected prefix when breaking inside that word.
- The width of the suffix measured afresh after the break.

Subtracting an original prefix from an original whole does not generally give
the freshly shaped suffix. Keeping the whole-word remainder can be useful without
making it the right amount to advance the next line's drawing position. Likewise,
fitting a whole word and reaching its end through an emergency-break search can
have different consequences for whether the line continues.

Negative letter spacing makes this distinction especially visible. With 16px
Arial and -8px spacing, the measured prefixes of `WWi` are about 7.10, 14.20 and
9.76px. The intact word can fit 12px even though an intermediate prefix cannot.
Do not assume prefix widths increase, or replace an ordered emergency search
with “choose the farthest prefix that fits.”

Fresh starts can change intrinsic shaping as well as added spacing. Safari's
Shantell Sans probes distinguish a suffix starting at a combining acute from one
starting at the preceding word joiner (WJ). Counting Unicode characters or
“spacing owners” cannot recover this. Zero width is a measured value, not proof
that source is absent; Unicode's default-ignorable classification is not a
spacing rule. Removing controls before measuring changes the experiment.

Desktop Chromium uses the fresh remainder for intact admission; desktop Gecko
keeps original-whole-minus-consumed-prefix admission while using the fresh widths
for emergency fitting and continuing advance. Preparation resolves this choice
into numeric geometry. A new
context for each preparation repeated expensive shaping that the existing
context could reuse, even after clearing Pretext's own caches. That improvement
does not remove the cost of shaping a new, unusually large cluster. Retaining
observations with the segment metrics still matters: repeating the calls and
interval work remained costly even when Canvas reused shaping.

Using emergency-prefix differences for every admission removed one mixed-width
failure but sacrificed other Chrome successes. Choosing by the existing prefix
measurement mode also failed: the opposing Chrome and Firefox cases both use
that mode. These are bounded engine policies, not a universal shaping boundary.
Replacing all widths with Canvas's letter-spaced measurements also regressed
ligatures. Keep the interpretation tied to the actual measurements being reused.

Earlier line breaks can matter too. In 24px Times New Roman, single-text-node
Safari probes forced `AVAVbc` through `AVAV`, `AV/A/V` and `A/V/A/V` using different
first-line indents. The same remaining `bc` had three different fit thresholds;
Chrome kept one. This supports history-sensitive fitting, without proving the
browser's internal algorithm. A follow-up `AVbcidefgh` probe rejected applying
the inferred history adjustment uniformly to every partial prefix.

The current copied source cursor cannot encode those different histories. Do
not hide extra continuation state in batch layout while reconstructing it
differently in the one-line API. Exact history-sensitive flow would need an
explicit contract. Useful improvements within the existing contract remain
possible; they still have to preserve main's results.

## Kerning At Line Edges

Segments are measured alone, so kerning with whatever sits beyond a segment is
missing. The engines keep different parts of it, and Canvas can show only some.

WebKit measures a text item together with a directly following U+0020 and
subtracts one unshaped space, so the item keeps its kerning with that space
whether the space continues the line or hangs. A ZWSP or SHY before the space
ends the same item. Safari's Canvas shapes the whole measured string, so
preparation reproduces this by measuring the segment with its space. In 18px
Times New Roman, `A`, ZWSP, space, `B` puts `A` on a 12px line at 12.006px,
although the isolated letter is 12.999px. After an emergency break inside an
item, WebKit gives the rest of the item the item's width minus the prefix,
without clamping. With WJ instead of ZWSP at widths 1 and 8, the rest is WJ and
the space at -0.993px on their own line, and Safari draws them 0.993px outside
the line's start edge. Pretext keeps that signed advance for line breaking but
reports the line's width as 0. Items are split where bidi levels change before
they are measured, and format characters between a word and the space resolve
with that space. On an RTL page, emoji, space, `A`, WJ, space, Hebrew therefore
paints the unkerned letter, while an LTR page kerns it.
Without the paragraph direction, preparation keeps the kerning across format
characters only when the word's last letter and the first letter after the
space have the same direction, with only spaces and format characters between,
so the characters between the two letters resolve to that direction (UAX #9
N1). LRM, RLM and ALM are strong characters, so they count as letters of their
direction, and a word that ends in one keeps its kerning. An ASCII digit after
the space keeps it too, since it resolves the space to the word's direction
either way (UAX #9 W7 and N1). Letters in the right-to-left blocks have bidi
class R or AL, and every other letter except modifier letters has class L, so no
bidi class table is needed. A generated table also kept the kerning before other
digits, after symbols and across neutral punctuation after the space. Under a
fake Canvas that kerns every glyph with a following space, the letter rule gives
the same segments, widths and lines as the table on all 239,063 Safari suite
inputs. In the installed gate, dropping the kerning across format characters
altogether lost 33 Safari rows (17 LTR, 16 RTL), each a Latin letter, WJ, one or
two spaces and a Latin letter, which both rules keep. A rule that took only
letters before the format characters and only spaces and a letter after them
passed those rows but lost the kerning that installed Safari keeps for `A`, LRM,
space, Hebrew, for `A`, WJ, space, WJ, `b` and for `A`, WJ, space, `1`. A
closed bracket pair takes the paragraph direction when it
contains text of that direction, so on an RTL page `A`, WJ, space, then a
parenthesized Latin letter and Hebrew letter paints the unkerned letter too. On
an RTL page headless WebKit also needs about a hyphen's width more to fit a word
that ends in SHY before a space, so preparation takes no kerning across SHY.
An explicit embedding, override or isolate also leaves the direction unknown,
but only in the space's own paragraph, since explicit levels end with their
paragraph (UAX #9 X8). Installed Safari lays out `AA`, WJ, space, `B`, newline,
U+202A, `x` in pre-wrap 16px Arial at 20.9px, between the word's kerned and
unkerned widths, in 3 lines; checking the whole text for controls predicted 4.
With letter spacing the same measurement also moves the space's gap onto the
item and clamps the item at zero. The per-grapheme gap model does not represent
that; applying only the kerning lost native successes where the fit at a
hanging preserved space ignores the word's trailing gap.

Preparation measures a segment followed by such a space together with the space
instead of alone, and takes the segment's width as that measurement minus a
space alone. Safari's prefix fit widths still measure a word alone where it
begins a longer word, and occurrences before other text measure it alone too. A zero-width break
before the space ends the item, which is then measured alone as well, and so is
a numeric run or a run above 96 graphemes, whose fit widths come from pairs.

Measuring only the end of a word with the space would be cheaper, but it is not
exact. A headless WebKit census covered 8.0 million (font, word) pairs from the
corpora, the Safari suite inputs and a targeted word list, in 194 installed and
fixture families. The final grapheme cluster, with any format characters after
it, gave a different kerning in 389 pairs. In 20px Waseem, `.` after Arabic
letters, and `...`, take nothing before a space, while `.` alone takes 2.470px.
In Noto Nastaliq Urdu, gaf or keheh after alef madda takes 0.183em, while either
letter alone takes nothing. In STIX Two Math, capitals such as `V`, `Y` and Greek
Upsilon kern with the space alone, but not after Cyrillic a, and Upsilon not
after Latin a; after Greek alpha or Hebrew alef they keep the kerning. The final
two clusters matched in every pair, but nothing bounds how far a font's
contextual lookups reach. Kerning with the space is also common: PT Sans, Didot,
Gill Sans, Avenir Next and 18px system-ui each kern more than 2,000 distinct
en-gatsby words, Chalkboard 1,394 and Waseem 827, and 20px system-ui kerns
Arabic, Devanagari and Hebrew words that end in `.` or `,`. Native element
geometry agreed with the whole-word Canvas kerning on 2,440 of 2,551 sampled
pairs. In the fixed-pitch fonts Fira Code and Monaspace Neon, WebKit's layout
takes none of the kerning that Canvas reports, which preparation does not model,
and in STIX Two Math a Latin capital after Cyrillic a keeps its own kerning
natively.

Chromium's layout shapes whole items and kerns across spaces, ZWSP, SHY and
same-font spans. In its default state Chromium's Canvas splits measured strings
at spaces, tabs and ZWSP and reports none of that kerning for Arial or Times New
Roman. With `textRendering = 'optimizeLegibility'`, or with
`fontKerning = 'normal'` for Arial, headless Chromium shapes the whole string
when the font's lookups involve the space glyph and reports the kerning sums
for both fonts, but those settings turn on features for every measurement.
Chromium also reshapes the start of a wrapped line. Legacy `kern` tables, which
HarfBuzz splits between both glyphs (Times New Roman, Helvetica Neue and
Verdana on macOS), change that adjustment, while OpenType pair kerning keeps
the adjustment on the first glyph (Arial). Canvas widths add both halves and
cannot tell the attributions apart.

Gecko shapes words without their spaces and splits them at ZWSP, WJ and other
invisible controls, so ordinary kerning never reaches a space. Its line breaker
adds the original advances of the shaped word. After an emergency break inside
`AV` in 18px Times New Roman, Firefox paints `V` at 11.833px: the letter keeps
half of the adjustment with `A`. That share depends on the same attribution.

## Reading Browser Output

DOM geometry is evidence to interpret, not an exact source-to-line map. Safari
can return a zero-width rectangle on the previous line before the real next-line
rectangle. Chrome can give a letter after SHY positive rectangles on both the
hyphen's line and its own. Neither “first rectangle” nor “first positive
rectangle” reliably assigns source. Range extents are not general glyph advances,
especially with kerning, signed spacing, bidi or invisible controls.

A diagnostic must establish its own setup. Floats intended to force a particular
break history sometimes moved the word below the floats instead. Verify the
actual preceding breaks before interpreting the suffix. Compare resolved CSS
widths, not only requested widths, and prefer clear threshold brackets. Firefox
box widths followed 1/60px rounding in a narrow sweep, but copying that rounding
into line fitting regressed unrelated cases: box resolution does not establish
the browser's text-fit rule.

## Rich Inline Boundaries

Rich items retain source identity even when they measure zero. Filtering them
through the flat walker's first visible line lost standalone zero-width spaces
(ZWSP); compressing the item array also made cursor and fragment indices disagree.
Preserving source is independent of calculating natural width. The fixes in
[#220](https://github.com/chenglou/pretext/pull/220) do not establish arbitrary
shaping across styled items or solve flat ZWSP wrapping inside an item.

A collapsed space's presence and advance are separate. Its style comes from the
first whitespace at the boundary, and a zero or negative advance still provides
a break opportunity. Fragments name that whitespace's item as `gapItemIndex`,
which is -1 only where no space precedes the fragment on its line. A painter
draws the space inside that item's element, as native layout does. Painting
every space in the paragraph's style moved the text after a code span's own
space by the difference between the two space widths (#295). Margins or spacer
boxes keep the width, but leave the space out of copied text, and margins put
mixed-direction lines out of order (#273). `measureText('A A') -
measureText('AA')` includes the change in A–A kerning, so it is not a clean
space measurement. Measure the space itself. After forced overflow, preserve the
negative remaining width; clamping it to zero gives a following negative gap
room it did not have.

A whole zero-width item fits at the end of an exactly filled line. Checking
whole-item fit before reserving the item's gap and extra width admitted it, but
lost nine Safari forced-overflow matches: a negative next item could undo forced
overflow. A broader guard on prior overflow lost 62 matches where item and style
boundaries differed. Reservation therefore stays first and rejects only a reserved
width greater than the remaining width plus the line walker's fit epsilon (`>`
rather than `>=`).

An item boundary is not a break opportunity by itself. Chrome runs one line-break
iterator over the text of the whole inline formatting context, and Gecko keeps
collecting a word across text frames until whitespace. `prepareRichInline()`
analyzes the text that items join between collapsible spaces, as `prepare()`
would, and an ordinary break falls only where a joined break unit starts. In the
Chromium and Gecko profiles every break fact near a boundary comes from that
joined analysis, not only the boundary itself. Splitting a word changes each
item's own segmentation: Thai `ความสวยง` splits into `ความ/สวย/ง` alone but
`ความ/สวยงาม` joined. Joined break positions therefore map into item cursors, down
to a grapheme inside an item segment when needed. Where an item's segments hide a
joined break, or offer one inside a joined word, the walker ends at the joined
break or fills graphemes back to a preferred break, as the flat walker splits a
word.

WebKit breaks differently, and `inlineItemBreaks` records that. Its inline items
builder runs a break iterator over each inline box's own text, and a boundary
between boxes is breakable when the next box's text can break at its start with
the previous box's last two characters as prior context. Installed Safari 26.5.2
and headless WebKit spans wrapped Thai, Lao, Khmer and Myanmar words split across
items differently from one text node, and joined run extents lost the Thai and
Lao rows where they differ while Chrome gained on the same rows. In the WebKit
profile an item's last run comes from its own segments, and the boundary from
analyzing the previous item's last two characters followed by the next item's
text. The next item's first run and any break inside its first segment come from
that same analysis, which is only a proxy for WebKit's iterator over the next box
alone. It matters where Pretext's analysis of the item alone differs from that
iterator. `Intl.Segmenter` keeps the Myanmar vowel sign at the start of `ာသည်`
apart, but the forward-sticky pass joins it to the word after it, and the
resulting carry moved `သ` to the next line where Safari's spans do not. Taking the
first run from the item's own segments instead changed only such Myanmar rows and
failed all 70 of them. Keeping a leading mark apart in the analysis itself would
change `prepare()` for any text that starts with a mark, in every engine. Taking
the previous item's last run from the same context analysis lost more fuzz rows
than it fixed. The analysis still differs from WebKit's scan inside some boxes:
WebKit breaks `-"rt` after the hyphen and `-1o(r)` before the parenthesis, and
neither the item's segments nor the joined text do.

Gecko's line breaker keeps extending a word across text frames until a SPACE, TAB
or CR, computes that word's breaks once with ICU4X's line segmenter, and hands each
frame its slice. A font or style change ends the shaped text run, not the word, and
css-text ignores inline box boundaries when it decides adjacency for line breaking.
In every same-font case of a September 14, 2026 probe, installed Firefox 155 spans
wrapped like one text node. The Gecko profile therefore uses the joined analysis
too, with its own break rules across boundaries: small kana don't start a line, so
items `ちょっと待` and `ってください` keep `待って` together where the Chromium
profile breaks before `っ`. Engines Pretext doesn't recognize use the joined
analysis too, with their own break rules. They used to break at every item
boundary, which no major engine does.

An earlier prototype of the joined rule lost 40 installed Firefox Myanmar
split-word rows, which were attributed to Gecko's segmentation. But Gecko breaks
lines with ICU4X's line segmenter, not the word segmenter behind `Intl.Segmenter`,
and the flat prediction already gave Firefox's lines at 41 of 52 probed widths,
including the suite row's 88px. The extra line comes from widths. The second item
starts with U+102C, a spacing vowel sign that Unicode graphemes split from the
consonant before it and browsers shape with it. In 16px Myanmar Sangam MN, Canvas
and the DOM agree that `ဘာသ` measures 41.02px and `ာသည်` 50.78px, while the joined
text and the same two parts as spans both measure 82.03px, so measuring the items
separately overstates this boundary by 9.77px. Breaking at every item boundary
matched those line counts only by breaking where Firefox never starts a line.
Chrome has the same width gap: its rich prediction starts a line at this boundary
where its spans don't. Breaking at every item boundary also matched some Firefox
heights of links and paths split across items by accident: Firefox breaks after
`/` before a letter, as in `https://|example.com`, where the flat prediction keeps
the unit whole.

When following items continue an item's last run, the run moves to the next line
if the line already has an earlier break. The continuation's width is measured to
its cheapest break, so a soft hyphen directly before a ZWSP or SPACE adds no
hyphen, and it fits within the line walker's fit epsilon. Native Chrome and Safari
spans reserved a hyphen width for a soft hyphen before a space at some widths;
the flat walker does not, and neither does rich-inline.

A run that began the line still takes overflow breaks at item boundaries, as before.
Restricting those to units that `prepare()` would split lost the `a`/ZWSP/`hello`
witness at width 1: Chrome and Firefox break before that ZWSP even in a single text
node, while the flat walker keeps it with `a`; Safari agreed on the line count only.
Item admission fits within the line walker's fit epsilon, as the walk inside an
item does. It used to compare raw widths, and line counts then went up as the width
grew, in bands as wide as the epsilon: the item walk took a longer part of the next
item within the epsilon, and the raw check moved the whole item to the next line
instead of keeping the shorter part. No browser witness backed the raw comparison.
Atomic `break: 'never'` items allow a break on both sides. css-text requires this
for atomic inlines, and headless Chromium and WebKit inline-blocks agreed.

An item's walk can also end at a soft hyphen whose hyphen doesn't fit, where the
item has no earlier break to return to. Only the hyphen overflows there, not a
unit the walker forced onto the line. Wrapping before the item anyway broke
where the joined text has no break: items `T` and `po\u00add` gave `T` / `pod`
where `Tpo\u00add` gives `Tpo-` / `d`, and line counts went up as the width grew
(#323). Such a line now keeps its hyphen, as the flat walker does, unless the
Chromium profile returns to the break before the item with the flat walker's
checks: that break leaves room for the hyphen, no soft hyphen up to the hyphen
measures narrower joined than apart, and nothing after the break can hold a
later opportunity. Blink retries the text item against the width minus the
hyphen, then rewinds earlier items at the full width, so any break before the
item counts, including one between ideographs, where the flat walker records no
target. Whether the text before the hyphen fits comes from walking the item
again up to the soft hyphen; subtracting the hyphen's width from the line's
width left ranges under 1e-6px wide where layout still moved backward. In a
seeded search with a tabulated fake canvas, 400 flows per profile with and
without kerning and item options, flows whose lines move backward as the width
grows fell from 43-60 to 7-14 per profile, and no flow without a soft hyphen
changed. The rest have an item that starts or ends with a soft hyphen, or move
backward in plain text too, where a Blink return appears only once its target
leaves room for the hyphen.

Items are measured separately. Chromium shapes neighboring same-font spans
together, so Arial `community` + `,` natively fits about a pixel earlier than the
sum of the two measurements; Gecko frames kern there too, while WebKit spans do
not. That is a measurement topic, not a break fact. Where the flat walker and one
native text node disagree, rich-inline in the Chromium, Gecko and WebKit profiles
now follows the flat walker: Japanese dialogue in Hiragino Sans after `」`, numeric
signs that WebKit keeps with the digit, and fit thresholds. Breaking at every item
boundary matched some of those rows only by accident.

## Content Language

Some line-break rules follow the page language. The full-schedule
`maintained/content-language` family renders 31 shapes on `en`, `ja`, `ko`, `zh`
and `zh-Hant` pages, plus 5 `en` controls, with named CJK fonts. On September 12,
2026, installed Chrome 153, Safari 26.5.2 and Firefox 155 gave, under
`line-break: auto`, for the 28 shapes it had then:

| Shape | Chrome | Safari | Firefox |
| --- | --- | --- | --- |
| Small kana starting a line (`日本ァア`, `わかって`) | Every page | `ja` and `ko` only | Never |
| `ー` starting a line after an ideograph or kana | Every page | `ja` and `ko` only | Never |
| Break before `〜` or `゠` | `zh` and `zh-Hant` only | Never | Never |
| Curly double quotes around Latin or Hangul act as brackets (`中文“abc”中文`, `했다.”라고`) | `zh` and `zh-Hant` only | Every page except `ja` | Never |
| Newline next to `。`, `「` or U+3000 | Becomes a space | Becomes a space | Removed on `ja`, `zh` and `zh-Hant` |
| Newline between wide characters | Becomes a space | Becomes a space | Removed on every page |

These agree with the engine sources: Chromium's `line_normal_cj.txt` tailoring
for `zh`, Apple ICU's `ja.txt` and `ko.txt` plus its curly-quote patch, and
Gecko's newline transformation in `nsTextFrameUtils.cpp`.

Under `ja`, `zh-Hans` and `ko`, Safari and Firefox also shape some of the named
font's own punctuation differently. An element's `lang=""` marks its language as
unknown rather than inheriting the page's. Chrome resolves it to its app
language, which the report records as `locale`, so these results can differ
between machines. In their sources, Firefox maps it to its generic `x-unicode`
font group and Safari passes no language. Firefox's fallback glyphs then follow
the machine language too: on a Mac preferring `zh-Hans`, U+2167 under `lang=""`
measured 16px, as with no language, against 27.53px under `en`. Safari's matched
`en`. No recorded empty-language row contains a fallback glyph, so no recorded
result separates from `en` yet.

Every profile resolves small kana and `ー` (CJ in the
generated class table) with one field: to ID, so they may start a line, or to NS,
so they stay with CJK text before them. Only the WebKit profile varies so far: ID on `ja` and `ko` pages and NS
elsewhere. The Blink profile resolves ID on every page. Chromium's ICU data maps
`line` to `line_normal.brk` for root and `ja` and to `line_normal_cj.brk` for
`zh` and `zh_Hant`, and both put CJ in ID. So `ー` starts a line after `？` and
`！` exactly as small kana do, and between the marks in `日？ーー`, as installed
Chrome shows. The Gecko profile resolves NS, since Gecko's auto is strict, and so
do engines Pretext doesn't recognize, following ICU's root rules. Reading
`<html lang>` costs about 3-16ns in headless WebKit and Chromium, with no style or
layout work.

## Fonts And Other Measurement Engines

Whole-run Canvas/DOM agreement, isolated-letter agreement and matching line
breaks are separate claims. The Shantell Sans and language-context probes in
[FONT_DIAGNOSTICS.md](FONT_DIAGNOSTICS.md) explain why a prefix model that fixes
one width can still fail nearby thresholds.

Feature detection must precede assignment. In the tested Safari OffscreenCanvas,
`fontKerning` and `textRendering` were absent; assigning and reading them back only
created ordinary JavaScript properties, without enabling the browser feature.

Guessed `system-ui`
substitutions, size tables and scaling were unreliable. Emoji bitmap widths also
do not scale linearly with font size. Keep those platform findings and correction
details in [PLATFORM_BUGS.md](PLATFORM_BUGS.md), rather than adding font-name rules
to the line breaker.

`text-shaper` helped identify Unicode coverage gaps, but its segmentation and
paragraph breaker are not browser-compatible replacements. HarfBuzz probes were
useful references, but did not reproduce browser measurements closely enough;
isolated Arabic words also needed explicit LTR direction in that backend to
avoid misleading widths. Bringing a shaper and font loading into the runtime is
a separate project, not a required next step for Pretext. Measuring every possible
resumed substring is outside the intended bounded preparation model too.

## Bidi Levels

`prepareWithSegments()` used to return `segLevels`, one embedding level per
segment from a simplified resolver that came from pdf.js through text-layout.
`layout()` reordered lines with them at first, but that result was discarded and
the call was removed (`5ecce72`). The levels stayed as custom-rendering metadata
that nothing in the library, rich-inline or the demos read, and they could not
produce visual order. The resolver took the paragraph direction from the first
strong character, with no way to set it, and had no explicit embeddings,
overrides or isolates, no bracket pairs and no line rules. A segment reported
the level of its first code unit, although punctuation merged into a word can
resolve differently, and a line can start or end inside a segment. The published
uses checked on GitHub only read the levels to guess a paragraph's direction,
and one patched in a forced base level.

Every rich preparation still paid for the pass, including each rich-inline item.
Skipping it made `prepareWithSegments()` about 3% faster on the Latin corpora,
8.5% on the Arabic, Hebrew and Urdu corpora and 16% on short Arabic texts, and
`prepareRichInline()` 15% faster with Arabic items (Node V8 with a fake Canvas,
medians of 31 interleaved rounds). The generated bidi class table stayed for the
WebKit following-space kerning guard, until that guard came to need only letters,
direction marks and the right-to-left blocks (see Kerning At Line Edges).

A DOM element that renders the whole paragraph needs only a paragraph direction,
since the browser resolves the paragraph and reorders each line itself. A string
drawn on its own, such as one line passed to Canvas `fillText()`, is a separate
bidi paragraph and loses what was resolved across the line break. GNU FriBidi
1.0.16 orders the second line of the LTR paragraph `abc ابج 1+2 xyz`, broken
before `1+2`, as `2+1 xyz` inside the paragraph, because the digits follow
Arabic, but as `1+2 xyz` on its own. Numbers and punctuation before a line's
first letter, punctuation after its last letter, and embeddings or isolates that
span lines changed order the same way; digits after a letter on the same line
didn't. A real replacement for custom rendering needs a different shape: a
paragraph-direction option, levels per code unit rather than per segment, and
per-line whitespace reset and reordering (UAX #9 L1 and L2) so callers get runs
in visual order. A known paragraph direction would also let the kerning guard
keep the kerning where it now leaves the direction unknown.

## Corpus Lessons

Short examples catch regressions; long text reveals accumulated differences.
Current counts belong in the `corpora/*-step10.json` snapshots, not here.

- **Application text:** books miss URLs, numeric expressions, emoji sequences,
  non-breaking spaces and discretionary breaks. URL queries worked better as a unit through `?`
  followed by a query unit; treating the entire URL as one unit or splitting every
  query character both made results worse.
- **Arabic:** punctuation-plus-mark clusters such as `،ٍ` need their preceding
  text, while a space followed by combining marks needs the marks with the next
  word. Pair corrections, larger shaped
  slices and phrase rules from single examples added cost without enough accuracy.
  Clean actual source artifacts before adding rules; do not increase fit tolerance
  to disguise a shaping mismatch.
- **Thai, Lao and Khmer:** Thai exposed contextual ASCII quoting; Khmer benefited
  from retaining explicit ZWSP in clean source. A Lao sample with fixed print
  wrapping was unsuitable for testing normal flowing text.
- **Myanmar:** punctuation usually needed preceding text, and `၏` also needed its
  following word in examples such as `ကျွန်ုပ်၏လက်မ`. Broader grapheme and quote
  rules improved one browser while hurting another.
- **Japanese and Chinese:** iteration marks stay with preceding kana, but remaining
  proportional-font differences varied with browser, width and font. One improved
  corpus line does not justify another global punctuation rule.
- **Pre-wrap:** preserved spaces can hang, tabs depend on the current line's tab
  stop, and a final hard break does not create another empty line. The supported
  textarea-like subset is in [README.md](README.md).

## Keeping Work Bounded

Small operations became quadratic when repeated over growing user text. The
history audit found these traps; the commits retain the implementation details:

| Repeated work | Fixes to consult |
| --- | --- |
| Reclassifying growing punctuation/Arabic strings or rescanning cleared slots | `30854d7`, `2148b90`, `4cb8b24`, `f0a326d` |
| Rebuilding growing CJK/keep-all units | `eb3bbbe`, `f0a326d` |
| Measuring every growing Canvas prefix | `fcf9c62` |
| Searching hard-break chunks from the beginning for every streamed line | `2c52171` |
| Retrying whitespace/font-size suffix regexes; restarting preferred-hyphen searches | [#221](https://github.com/chenglou/pretext/pull/221) |

The regex failures involved *internal* whitespace followed by content and long
digit runs without `px`, not just long trailing whitespace or valid font strings.
The preferred-break failure needed one long hyphenated run producing many lines.
An arbitrary continuation must seek to its starting boundary; an already
positioned scan can carry its index. The shared complex walker's preferred-break
lookup work is O(lines × log(cuts)); the simple batch walker carries the next cut.

Count total submitted Canvas text, not just calls. Measuring every prefix or
suffix is quadratic even if each position triggers only one query. Safari's
production prefix policy caps each segment at 96 graphemes, using pair context
beyond that. A large combining cluster can still occur in up to 96 prefixes:
bounded amplification, not a bound on the native shaper's own cost. Extra context
queries must charge overlapping source too.

Cold-cache scaling probes distinguish those costs from reuse. Numeric Canvas doubles
measure algorithmic work rather than browser throughput. Shared font/segment
caches accumulating until `clearCache()` are a separate lifetime concern.

Repeating `clearCache()` and `prepare()` on one text is not a stable timing in
Playwright's WebKit build. Its per-font width cache samples one Canvas call in 21
after a run of misses, counts only strings of up to 64 UTF-16 units, and returns
to dense sampling only after a hit. A prepare submits each string once, so hits
need the sampled positions to line up again: after 21 / gcd(n, 21) prepares for
n counted strings. The Arabic corpus submitted 21,336, a multiple of 21, and its
prepare fell from about 120ms to 35ms within five repeats. Breaking after U+061B
removed four prefix measurements, and the same prepare stayed at 120ms until the
21st repeat. The first prepares cost the same, replaying the submitted strings
without library code showed the same split, and four extra Canvas calls per
prepare restored the drop. Fresh text never reaches those hits. Compare submitted
Canvas text and first cold prepares, and treat a warm-only change there as a
cache phase until installed Safari shows it.
