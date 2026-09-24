# Wrapping suite validation

This branch implements the boundary-policy fixes for #206/#208, #212/#213 and
#214/#215, plus the separate rich-inline source-identity and signed-space fix.
The later leading-ZWSP change fixes the exact flat #210/#211 reproduction; its
deliberate losses are listed in the next section. The twelve native rich-inline
height witnesses are required, as are two exact-fit admission opposites
discovered during review.
[README.md](README.md) explains the runner; [INVENTORY.md](INVENTORY.md) records
coverage, provenance and research protocols outside its scope.

The September 9 SHY observer correction passed the ordinary three-browser run:
33,632 inputs, nine numeric profiles, no lost successes, required failures or
execution errors. The default-language Safari quote control passes its explicit
marker/width contract; keep-all's unwanted marker and width remain known failures.
All accuracy, letter-spacing and corpus result payloads are unchanged; refreshed
snapshots change only provenance and environment records. Runtime sources and
the baseline pin are unchanged, so no runtime benchmark was needed.

## `layout()` counts lines with a count-only walker

This runtime change starts from main `c22181c` (#337). `layout()` counted lines
with the simple walker that the range APIs share, which also tracks each line's
ends, the pending break and its paint width, and calls a visitor. On text that
takes the simple path, `countPreparedLines()` now keeps only the line width and
whether the line has content, in the same order as that walker. Other text still
counts through the full walker, and preparation doesn't change.

The installed full gate ran this change in the background against pinned
`7c2ec51`, whose runtime sources match main: Chrome 153 through the Playwright transport,
Safari 27.0 and Firefox 156 natively, both directions, at DPR 2. That is 161,739
LTR and 73,671 RTL rows in Chrome, 162,489 and 73,680 in Safari, and 162,136 and
73,716 in Firefox. On every row main and this branch return the same predictions
and assessments, so no leg fixes or loses a metric, and there are no required
failures, execution errors, or new API or rich failures. The numeric API checks
find no new failures in any of the five profiles.

The ordinary snapshots were regenerated from this branch in Chrome 153, Safari 27.0
and Firefox 156. No result moved: accuracy stays 7,680 of 7,680 in each browser,
letter spacing 28 of 28, and the corpus sweeps 1,076, 1,090 and 984 of 1,098 in
Chrome, Safari and Firefox, with the same mismatches. Only provenance and
environment records change, including the hashes of `layout.ts` and
`line-break.ts`.

Outside the browsers, the counter, the old walker on this branch and on main,
and both `layout()` entry points agree at every width of 63,009 inputs: the
ordinary and full suite inputs for each browser, each corpus whole and by
paragraph under normal and keep-all, the benchmark texts at three sizes, and
25,000 random strings built from zero-width spaces, hyphens, dashes, URLs, CJK,
Thai, Arabic, emoji, combining marks, soft hyphens, tabs and newlines. They ran
in the Chrome, Safari, Firefox, iOS, Android and unrecognized profiles, each
with three fake Canvases: the unit tests' widths, irregular fractional widths
with pair kerning, and the same rounded to 1/64 px, which makes exact ties
common. The widths include negative, 0, NaN, Infinity, a sweep across the
natural width, and exact fits at segment and grapheme ends from real line
starts, each also moved by the fit epsilon and by a hair either side: 371
million comparisons, 274 million of them on the simple path. Every sequence of
up to five of 11 short tokens also agrees at every exact-fit and tie width under
the Safari profile's fit epsilon, 88.4 million more. Preparation returns the
same data as main, and `layout()` makes no Canvas calls.

`bun test` and `bun run check` pass. A unit test compares the counter with the
walker at every half pixel up to 400px and around each segment end, including
the width where the text up to there fits with nothing to spare, for texts with
leading and resumed zero-width spaces, a space after a zero-width space,
preferred cuts in URLs and CJK. It fails when the leading zero-width space rule,
the skipped space at a line start, the return to a preferred cut or the fit
epsilon is removed, or when a line that fits exactly is counted as overflowing.
Five more pin leading and resumed zero-width spaces at emergency widths, the
return to a preferred cut in a URL, a shaped whole that fits where its isolated
letters don't (it fails when the whole-segment admission is removed), a negative
width laid out as 0 over text that measures 0, and the complex path's letter
spacing, tabs, hard breaks and soft hyphens, each without Canvas calls during
layout.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome 153 on the
2560x1440 screen and Safari 27.0 on the 1440x2560 screen. Main `c22181c` ran
three runs in each browser in the same session. Every run but this branch's
Safari runs waited for the machine to go quiet; those started while another
job kept two CPU cores busy. Hot `layout()` reads 0.029 ms in Chrome (0.087 on
main, 0.088 in main's snapshot) and 0.030 ms in Safari (0.100). Long-form corpus
`layout()` totals read 0.35 ms in Chrome (0.81) and 0.26 ms in Safari (0.97).
`prepare()` reads 9.15 ms in Chrome (9.05) and 10.5 ms in Safari (10.5). The
line-range and rich-inline rows don't change beyond timer resolution, and
neither do the shape rows that take the full walker, `soft-hyphens` and the
letter-spaced `cjk-indent-spaced`. Main's Safari snapshot came from Safari
26.5.2, so eight Safari shape and corpus rows change their segment or Canvas
call counts here, such as `dashes` going from 2,294 to 2,911 Canvas calls; main
in Safari 27.0 gives the same counts as this branch on every row.

## Safari 27

This test-only change starts from main `2e5e2bd` (#333). macOS 27 brought Safari
27.0, and its first installed full gate broke lines differently from the Safari
26.5.2 rows of September 14 on 6,230 LTR and 3,599 RTL suite rows, 5,660 and 2,883
of them with a different line count; the two #210 rows changed only in height.
WebKit 27 changed four break rules: punctuation after an overflowing first
character, curly quotes and guillemets, keep-all after punctuation, and
U+2028/U+2029 ending lines. It also keeps fractional line boxes. ICU didn't
change. Main failed two required Safari rows.

`reported/#210-#211` at 20.96px keeps Safari 26's lines, but Safari 27 truncates
the block and the strut to 1/64px, so the observer read 3.000746 lines. For
fractional CSS line heights, a block within 1/64px per line of k strut advances
now counts as k lines. Safari 27's heights for one to six lines at 17.3, 20.5,
20.96 and 32px all read whole, and Safari 26's 60px over a 20px strut still reads 3.
The height check still compares the block with the predicted lines' strut advances,
which holds for the #210 rows' one and three lines; ENGINE_FOLLOWUPS records where
taller fractional blocks would outgrow it.

The Safari keep-all case `foo。bar日本語` read per-character spans. Safari 27 breaks
after `。` (WebKit #312099) only inside one text node, so spans kept Safari 26's four
lines where the paragraph has five. The case now reads the text node with Range
rects, so `wrap-06c1e0111950efed` becomes `wrap-8bb19504eadc995e` with the same
origin, and requires nothing until the WebKit profile models the fix.

The WebKit profile will follow Safari 27 only. Safari 26, still on macOS 26 and iOS
26, becomes a known gap, and the profile won't detect the version from the user agent.
Safari 27's break rules reach main with break opportunities taken from WebKit's own
data (#321), not as new hand-written rules; that change makes the keep-all case
required again.

Only the two #210 rows have a fractional line height, so the whole-count rule can't
reach any other row. The full installed gate ran in the background on September 23
against the pin `7c2ec51`: Chrome 153 through the Playwright transport, Safari 27.0
and Firefox 156 natively, both directions, at DPR 2, once from this branch's harness
and once from main's with this branch as the candidate. That is 161,739 LTR and
73,671 RTL rows in Chrome, 162,489 and 73,680 in Safari, and 162,136 and 73,716 in
Firefox. From this branch no leg fixes or loses a metric, and none has required
failures or execution errors. From main's harness only Safari's LTR leg fails, on the
two required rows above. Row by row, main's assessments differ between the two
harnesses only in Safari LTR: `wrap-4faaad4b08f18c01`'s line count, which now passes,
and the keep-all case. With spans main passed line count and breaks and failed
height, source and widths; from the text node it also fails line count and breaks.
In all six legs, the only native count that differs between the harnesses is
`wrap-4faaad4b08f18c01`'s. `bun test` and `bun run check` pass, and the pin stays.

The ordinary snapshots were regenerated from this branch in Chrome 153, Safari 27.0
and Firefox 156. No result moved: accuracy stays 7,680 of 7,680 in each browser,
letter spacing 28 of 28, and the corpus sweeps 1,076, 1,090 and 984 of 1,098 in
Chrome, Safari and Firefox, with the same mismatches. None of these rows is among
those Safari 27 moved, and all use whole-pixel line heights, which the harness
change leaves alone. Only provenance and environment records change, including
Safari's user agent, from 26.5.2 to 27.0. Runtime sources are unchanged, so no
runtime benchmark was needed.

## Rich inline keeps a line at an unfit soft hyphen as plain text does

This runtime change starts from main `491c7f1` (#324). In `prepareRichInline()`,
when an item follows other content on the line and its text fits only up to a soft
hyphen whose hyphen doesn't fit, the walker's check for a unit forced onto the line
broke before the item, although the joined text has no break there (#323). So `T` +
`po`, U+00AD, `d` in 16px Test Sans gave `T` / `pod` at 28.8px where plain `Tpo`,
U+00AD, `d` gives `Tpo-` / `d`, and with `T` at 12px it gave `T` / `po-` / `d`, one
line more than at 0.1px narrower. The check now walks the item again up to the soft
hyphen at the same width and breaks before the item only when that text doesn't fit
either, or when the Chromium profile would return to the break before the item as
the plain walker does. `canReturnFromUnfitHyphen()` is shared with the plain walker
for that decision.

A seeded search over 400 rich flows per configuration, in the Chrome, Safari,
Firefox and unrecognized profiles with and without letter spacing, `break: 'never'`
and `extraWidth`, sampled every 0.05px from 1 to 150px, counts flows whose layout
moves backward as the width grows: from 43 to 60 per configuration on main to 7 to
14 on this branch, and no flow without a soft hyphen changes. The leftover cases
have other causes, which ENGINE_FOLLOWUPS records: an item that starts with a soft
hyphen after other content, an item that ends with one, and Chromium's return to a
soft hyphen inside an earlier item.

The installed gate ran this change on `7c2ec51` against pinned `acba4c5`: Chrome 153
through the Playwright transport, Safari 26.5.2 and Firefox 155 natively, both
directions, at DPR 2. No leg fixes or loses a metric, and there are no required
failures, execution errors, or new API or rich failures. The 3,620 Chrome rows with
a soft hyphen all hold the hyphen as its own item, so no suite row has the shape
this change fixes; the unit tests pin it.

`bun test` and `bun run check` pass. Two unit tests pin `T` + `po`, U+00AD, `d` in
one font and in two, under both `unfitHyphenRetreat` modes, with a forced letter
(`T` + `p`, U+00AD, `d` at 12px) still wrapping before the item. Canvas calls per
cold `prepare()` don't change in any profile, since the change is in line breaking
and reads only cached advances. The baseline advances to `7c2ec51`, and the ordinary
snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen. Chrome reads `prepare()` at 9.15 ms
(8.95 on the parent branch) and hot `layout()` at 0.0885 ms (0.0895); Safari reads
11.5 ms (11.0) and 0.105 ms (0.102). Long-form corpus totals read 125.4 ms in
Chrome (122.5) and 349 ms in Safari (348).

## Emoji correction counts U+FE0F only after an emoji character

This runtime change starts from main `5810820` (#311). Chrome and Firefox on macOS
measure Apple Color Emoji wider on Canvas than they draw it at small sizes, so
`prepare()` subtracts a per-font correction for each emoji grapheme. It counted
every grapheme holding U+FE0F, so `a` + U+FE0F, a lone U+FE0F, a space + U+FE0F and
U+3000 + U+FE0F each lost the correction although Canvas never added it: 4px in
Chrome and 5px in Firefox at 16px. A grapheme now counts when it holds an
emoji-presentation character or an emoji character followed by U+FE0F, which is
Unicode's emoji presentation sequence. A digit, `#` or `*` followed by U+FE0F still
counts without U+20E3.

Headed at DPR 2 on the Retina display, on a `lang="en"` page, Chrome 153, Firefox
155 and Safari 26.5.2 laid out 31 sequences in 16px and 24px Helvetica Neue and
Arial. Chrome and Firefox draw `1`, `#`, `*`, `©` and `✔` followed by U+FE0F from
the emoji font, with the full Canvas and DOM gap even where no pixel is colored, and
draw U+FE0F after a letter, a space or U+3000 from the text font with no gap.
Predicted widths now match the DOM within 0.008px in Chrome and exactly in Firefox,
where the old rule missed 8 rows by up to 4px in Chrome and 16 rows by up to 5px in
Firefox. Safari's correction is 0. Its OffscreenCanvas gives a space followed by
U+FE0F the emoji width while the DOM draws a space, a separate gap ENGINE_FOLLOWUPS
records.

The installed gate ran this change on `2bdf62f` against pinned `fcd9b4e`: Chrome 153
through the Playwright transport, Safari 26.5.2 and Firefox 155 natively, both
directions, at DPR 2. Chrome fixes 282 LTR metrics on 144 rows and 4 RTL, and
Firefox 379 LTR metrics on 211 rows and 24 RTL, in the measurement,
chromium-script-spacing, cluster-v2-new and ideographic-source-edge families. Safari
doesn't change. No leg has required failures, execution errors, or new API or rich
failures, and every changed row holds one of the graphemes the two rules count
differently.

Chrome loses 22 metrics on 8 LTR rows and Firefox 10 on 4, each a pass main got by
accident, where subtracting a width Canvas never added cancelled another gap. `a`,
U+FE0F, U+00AD, U+0301, `b` and `a`, U+00AD, U+FE0F, `b` in 16px Arial with letter
spacing 1 at width 20 paint one 19.8px line in both browsers; this branch measures
20.8px and breaks at the soft hyphen, because Canvas adds letter spacing that the
browsers don't draw around the soft hyphen and on a lone U+FE0F. In Chrome, `a`,
U+00AD, U+FE0F, `b` in 16px Times New Roman with letter spacing 1 at width 9 paints
no hyphen, where main and this branch take the soft-hyphen break whose hyphen
overflows. In Chrome, `a`, space, U+FE0F, `b` in pre-wrap with letter spacing −2 at
width 1 in 16px Arial and Georgia now splits U+FE0F and `b` as Chrome does, which
exposes the line holding only the space after the overflowing `a`. ENGINE_FOLLOWUPS
records these gaps.

`bun test` and `bun run check` pass. A unit test stubs a 4px correction and checks
that `a` + U+FE0F + `b`, a space + U+FE0F, U+3000 + U+FE0F and `1` + U+20E3 lose no
width, while U+2764 + U+FE0F, U+1F44B, `1` and `#` with U+FE0F and U+20E3, and `1`
and `#` with U+FE0F lose one correction each. Canvas calls per cold `prepare()`
don't change in any profile, since the rule only decides how many corrections a
measured segment subtracts. The baseline advances to `acba4c5`, and the ordinary
snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen. Chrome reads `prepare()` at 8.95 ms
(8.95 on the parent branch) and hot `layout()` at 0.0895 ms (0.0885); Safari reads
11.0 ms (11.0) and 0.102 ms (0.105). Long-form corpus totals read 122.5 ms in
Chrome (115.0) and 348 ms in Safari (351).

## Safari kerning without the bidi class table

This runtime change starts from main `1262b4f` (#310). The Safari profile keeps a
word's kerning with a following space across format characters such as a word joiner
only when the space resolves to the word's direction. That check read bidi classes
from the generated table in `src/generated/bidi-data.ts`, and nothing else did. It
now reads Unicode letter properties and the right-to-left blocks: format characters
stand for class BN, except LRM, RLM and ALM, which count as letters of their
direction. Across format characters, a word keeps its kerning when its last letter
or direction mark, with no soft hyphen after it, has the direction of the first
letter or direction mark after the space, past spaces and format characters, or when
an ASCII digit follows, which resolves the space to the word's direction either way
(UAX #9 W7 and N1). An explicit bidi control in the space's paragraph still leaves
the direction unknown. The table, `src/bidi.ts`, the generator, both Unicode source
files and `generate:bidi-data` are removed, and the minified `layout` bundle goes
from 95,701 to 79,647 bytes, 26,261 to 20,973 gzipped.

Before the browsers, a fake canvas that kerns every glyph with a following space,
also across zero-width characters, ran all 239,063 full-schedule Safari suite inputs
through main and this branch, and no prepared handle, line or rich-inline line
changes. The table also kept the kerning before other digits, after symbols such as
`!` or modifier letters, and across punctuation, other spaces or combining marks
after the space. No suite row shows those shapes, and ENGINE_FOLLOWUPS records them.
The fake-canvas screen's 1,380 keys over the corpora, the accuracy grid, hyphen and
slash shapes, analysis, preferred breaks and rich-inline cases are identical in all
four profiles.

An installed probe in Safari 26.5.2 at DPR 2, on a `lang="en"` page with main and
this branch bundled into it, laid out three shapes and six controls in 18px Times
New Roman and 16px Arial, with `A` and with `a`, which doesn't kern with a space, in
LTR and RTL paragraphs, normal and pre-wrap, at every 0.1px width up to the natural
width plus 4px. Main and this branch give the same lines at every width. Safari
paints `A`, LRM, space / `א` on 2 lines at 12-12.9px in Times New Roman, between the
letter's kerned and unkerned widths, as both predict, and so it paints `A`, WJ,
space / WJ, `b` and `A`, WJ, space / `1`. An earlier table-free rule, which took
only a letter before the format characters and only spaces and a letter after them,
passed every suite row but predicted 3 lines there: on the same page the LRM and
double word joiner shapes failed at 20 Times New Roman and 17-18 Arial widths per
sweep, and without the digit rule this branch failed `A`, WJ, space, `1` at 80 of
1,200 Times New Roman widths and 68 of 1,120 Arial widths. The controls `A` + space
+ `B`, `A` + WJ + space + `B`, `A` + LRM + space + `b`, `A` + space + Hebrew and `A`
+ RLM + WJ + space + `B` match native at every width on both builds, and `A` + WJ +
space + Hebrew in an LTR paragraph fails on both at the same 20 Times New Roman and
18 Arial widths per sweep, where Safari keeps a kerning whose direction preparation
can't know. Results are in
`scratchpad/library-fixes/bidi-table-narrowed-probe/results/`.

The installed gate ran this change on `c2dfd08` against pinned `4672c58`, whose
runtime source equals main: Chrome 153 through the Playwright transport, Safari
26.5.2 and Firefox 155 natively, both directions, at DPR 2. No leg fixes or loses a
metric or has required failures, execution errors, or new API or rich failures, and
five numeric profiles have no new failures. Only the WebKit profiles run this check,
so no Chrome or Firefox prediction changes. In Safari 12 rows in each direction
change predicted widths by at most 0.0000005px, all where a lone NUL or DEL comes
before a space, which is now measured together with the space, and no metric's
status changes. The 17 LTR and 16 RTL Safari rows that dropping the kerning across
format characters lost, `maintained/space-kerning` among them, pass height, line
count and source on main and on this branch. Suite hash
`03b5cdfc772b52c1519882e3bbd963434087f3e3f6f65af1e0a3edd932885fa5`; rows are in
`/private/tmp/pretext-eng-20260912/gate-bidi-table-narrowed-{chrome,safari,firefox}`.

No row is lost, so there is nothing to attribute.

`bun test` and `bun run check` pass. A unit test pins `AA`, LRM, space, Hebrew,
`AA`, WJ, space, WJ, `B` and `AA`, WJ, space, `1`, which keep the kerning here and
on main but not under the earlier rule. Under a counting fake canvas, Canvas calls
per cold `prepare()` don't change in any profile: the 18 corpora take 53,093 calls
in the Chrome profile, 116,306 in the Safari profile and 53,108 in the Firefox
profile, 57,041, 135,791 and 57,071 under `keep-all`, and 53,101, 116,314 and 53,116
under `pre-wrap`, and the accuracy grid takes 9,136, 13,984 and 9,160. The 25,675
distinct Safari suite preparations take 382,948 calls on main and on this branch; in
18 of them a lone NUL or DEL before a space, a control character but not a format
character, is measured together with the space instead of alone. In Bun, cold
`prepare()` under a fake canvas in the Safari profile stays within 2% of main over
the corpora in normal and pre-wrap white space, over two alternating runs of 15
rounds. One text of 20,000 words that each end in a word joiner before a space is
9-10% slower, and 4-5% when each word also ends in LRM and the next starts with a
word joiner, since the check matches regular expressions where main walked the
table. A word joiner run of 20,000 before one space, 20,000 spaces after one, and
5,000 paragraphs with an explicit bidi control stay within 8% of main, faster on
some and slower on others. The baseline advances to `fcd9b4e`, and the ordinary
snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen (the parent branch's runs used the
1440x2560 screen). Chrome reads `prepare()` at 8.95 ms (9.15 on the parent branch)
and hot `layout()` at 0.0885 ms (0.0868); Safari reads 11.0 ms (11.0) and 0.105 ms
(0.100). Long-form corpus totals read 115.0 ms in Chrome (124.1) and 351 ms in
Safari (347).

## Rich-inline gaps name the item whose space they measure

This runtime change starts from main `aaea18c` (#309). Rich-inline fragments and
fragment ranges now carry `gapItemIndex`, the index of the item whose collapsed
whitespace made `gapBefore`, or -1 when no space precedes the fragment on its line.
`prepareRichInline()` takes it from the order that already picks the gap's width:
the previous item's trailing whitespace, else the first whitespace-only item after
that item, else the item's own leading whitespace. A zero or negative gap keeps its
item, where `gapBefore` alone reads 0 both for such a gap and for no gap. The
Markdown chat and rich-note now paint each collapsed space inside the element of
that item, at the start of the fragment's own element, at the end of the previous
fragment's, or in a span in the style of an item holding only whitespace, instead of
as a text node in the row's paragraph style (#295). Their rows also take
`white-space: nowrap` instead of `pre`, so a line that wraps inside an item no
longer paints the space it ends on under a link's underline, a strike-through or a
code pill's fill.

An installed probe in Chrome 153, Safari 26.5.2 and Firefox 155 at DPR 2 loaded the
Markdown chat, built from main and from this branch, with #295's four messages, a
heading and an Arabic paragraph whose code spans hold their own space, `**bold**
**more**`, links with a boundary space, and an English and an Arabic message whose
link, strike-through and code span wrap, at chat widths 640 and 360. Next to each
message it laid out the same pieces natively, in a `white-space: normal` paragraph
with the demo's classes and fonts. Measured with every word in its own span, main's
user lines end 3.30-3.33px short of the bubble's content edge in Chrome and Firefox
and 3.51-3.52px in Safari, 2.28-2.54px for the heading, and its words sit up to
3.34px off native, 3.53px in Safari. On this branch every user line ends within
0.05px of the edge, and every word sits where native puts it, within 0.01px. With
the rows' old `white-space: pre`, a line that wraps inside an item ends with its
element one space past the last word, 3.88-5.47px for body text and 7.22-8.31px for
a code span. With `nowrap` that element ends at its last word within 0.02px, as
native line boxes do, and no word or other element edge moves in any browser, in the
chat or in rich-note's default note at body widths 516 and 260, whose words paint
where main paints them. Safari's Range rectangles snap some word edges to whole
pixels, so there Ranges alone showed moves of up to 1.52px that spans don't. Results
are in
`scratchpad/browser-probes/results/{chrome,safari,firefox}-i295-2026-09-15T20-3*`;
the `T20-37` runs load this branch's committed rows, and the earlier ones inject
`nowrap` into its first commit.

Before the browsers, the fake-canvas screen compared this branch with main over the
corpora, the accuracy grid, hyphen and slash shapes, analysis, preferred breaks and
rich-inline cases in all four profiles, and all 1,380 keys are identical in each.
Over the chat's 10,000 messages at chat widths 640 and 360, main and this branch
paint the same fragments with a space before the same ones in all four profiles. At
640 in the Chrome profile 4,470 fragments have a gap: the fragment's own item holds
the space for 1,304, the previous fragment's item for 3,155, and an item holding
only whitespace for 11. None of those items has a style other than the paragraph's,
so the #295 shape needs typed Markdown. At that width 23 link lines and 14
strike-through lines wrap inside the item, where `pre` painted the space.

The installed gate ran this change on `7b8ade9` against pinned `1691168`, whose
runtime source equals main: Chrome 153 through the Playwright transport, Safari
26.5.2 and Firefox 155 natively, both directions, at DPR 2 on the 2560x1440 screen.
No leg fixes or loses a metric or has required failures, execution errors, or new
API or rich failures, and the numeric companion finds no new failures in five
profiles. The suite doesn't read `gapItemIndex` or paint the demos, so its rich
rows, the `rich`, `rich-more`, `maintained/rich-boundaries` and signed-spacing rich
families, 210 left to right and 90 right to left in each browser, pass and fail as
on main. Suite hash
`a72c647e17140b0585d31016c8e4fa71f0d8f33561e922d5f75a389312c399b3`; rows are in
`/private/tmp/pretext-eng-20260912/gate-rich-gap-owner-{chrome,safari,firefox}`.

No row is lost, so there is nothing to attribute.

`bun test` and `bun run check` pass. Under a counting fake canvas, Canvas calls per
cold `prepare()` don't change in any profile, since no corpus or accuracy-grid
segment changes: the 18 corpora take 53,093 calls in the Chrome profile, 116,306 in
the Safari profile and 53,108 in the Firefox profile, 57,041, 135,791 and 57,071
under `keep-all`, and 53,101, 116,314 and 53,116 under `pre-wrap`, and the accuracy
grid takes 9,136, 13,984 and 9,160. Preparing the chat's 10,000 messages takes
25,370, 98,530 and 25,386 calls on main and on this branch, since naming the gap's
item measures nothing. In Bun under a fake canvas, over seven alternating runs,
preparing those messages and streaming, measuring and materializing their lines at
chat widths 640 and 360 stay within 4% of main in the Chrome and Safari profiles,
faster on some rows and slower on others. The baseline advances to `4672c58`, and
the ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen (the parent branch's runs used the
2560x1440 screen). Chrome reads `prepare()` at 9.15 ms (8.80 on the parent branch)
and hot `layout()` at 0.0868 ms (0.0887); Safari reads 11.0 ms (11.0) and 0.100 ms
(0.105). Long-form corpus totals read 124.1 ms in Chrome (125.0) and 347 ms in
Safari (352).

## Marks after CJK text follow each engine

This runtime change starts from main `8a26c56` (#308). After CJK text, punctuation
whose UAX #14 class forbids a break before it now attaches to the CJK text, in the
first merge pass and in the CJK unit builder, where main attached only a
hand-written list plus CL, EX and NS inside CJK blocks: `'`, `/`, `|`, `‼`, `％` and
`°` no longer start a line after `丙` (LB13, LB19, LB21, LB23a). Opening curly quotes
and U+3000 and the other space separators still don't attach, and `-` keeps its own
rules. The text after such a mark follows each engine (#293). One boundary rule,
`pairBoundary()`, now answers the exclamation-mark rows, the Gecko rows and these
rows, and every merge and the unit builder ask it. After an ASCII mark before an
ASCII letter or digit, the Chromium profile keeps the pair from Blink's pair table,
except after `?`. The WebKit profile keeps it before a digit, and before a letter
follows UAX #14, since WebKit's scan reaches ICU at the CJK character and skips
ahead over ASCII letters, unless the mark follows a code unit up to U+00FF or is CL
or CP after an ideograph or Hangul syllable, where WebKit reads its table. The Gecko
profile follows UAX #14. A new profile field, `icuDecidesLetterAfterCJKMark`, is
true for WebKit. The URL query unit no longer asks about the boundary right after
`?`, which it never joins.

An installed probe on an `en` page in 16px Arial, Chrome 153, Safari 26.5.2 and
Firefox 155 at DPR 2, reran #274's rows with longer followers: `甲乙丙`, `あいう` or `가나다`
before 32 ASCII marks and `first_week`, `FirstWeek`, `1234` or `αβγδεζη`, at the
width where the CJK text and the mark fit and the follower doesn't. Chrome keeps
`!`, `}`, `/`, `|` and `'` with the letters and digits and breaks after all but `'`
before the Greek. Safari breaks after `!`, `/` and `|` before a letter, after `}`
before a letter only after kana, and keeps digits. Firefox breaks after `!`, `}` and
`|` and after `/` before a letter. No browser breaks before any of those marks. A
second probe checked the context rule: Safari, like Chrome, keeps `丙a}first`,
`丙a!first`, `丙!!first`, `丙.!first` and `丙.}first` whole, so its table decides a pair
unless the mark directly follows the character that reached ICU, and Firefox breaks
after the mark in all of them. A third put `}`, `|`, `!`, `/` and `'` after `xy abc`
before `1234` or `first`, with ` 丙`, `丙` or nothing after the word: Firefox breaks
after `}`, `|` and `!` before either and after `/` before `first`, whatever follows
the word, since ICU4X decides each word alone, and Chrome and Safari keep every word
whole. Over the 1,296 probe rows at the width that splits the mark from what
follows, this branch's analysis matches Chrome and Safari on every row, where main
is wrong on 48 and 52, and misses 12 Firefox rows, where main misses 24. The 12 are
`丙a}`, `丙a|` and their kana and Hangul copies before `first_week` or `1234`, where a
letter comes between the CJK text and the mark: every Gecko profile, before and
after this change, keeps `a}first` and `a|1234` whole, as it does after Latin text
(ENGINE_FOLLOWUPS.md). Results are in
`scratchpad/browser-probes/results/{chrome,safari,firefox}-i293-2026-09-15T19-01-*`,
and the rerun with both bundles in `…-i293-2026-09-15T19-3*`.

Before the browsers, the fake-canvas screen compared this branch with main over the
corpora, the accuracy grid, hyphen and slash shapes, analysis, preferred breaks and
rich-inline cases in all four profiles. Only `/` after CJK text changes: `see 漢/abc
now`, `see 漢字/abc now`, `see かな/abc now`, `see 漢/1 now` and `see 中文/中文 now` in
normal, pre-wrap and letter-spaced modes and in analysis, and the rich-inline split
`see 漢` + `/abc now`, 21 keys in each profile. Main broke before `/` in every
profile. Now the Chromium and unrecognized profiles keep `漢/abc`, the WebKit and
Gecko profiles give `漢/ | abc`, and every profile keeps `漢/1` and breaks `文/ | 中`.

The installed gate ran this change on `e7fb206` against pinned `11c440b`, whose
runtime source equals main: Chrome 153 through the Playwright transport, Safari
26.5.2 and Firefox 155 natively, both directions, at DPR 2 on the 2560x1440 screen.
No leg loses a metric or has required failures, execution errors, or new API or rich
failures, and five numeric profiles have no new failures. Chrome fixes 82 LTR and 46
RTL metrics, Safari 85 and 46, and Firefox 82 and 46, all in supported scope and all
on straight single quotes after CJK text: `中文中文''tail`, `あいあい''tail` and
`가나가나''tail`, with letter spacing 0, −1 or 1.5, in normal white space and pre-wrap,
where main started a line with `''` and each browser keeps the quotes and `tail`
with the character before them. Chrome paints `中文中 / 文''tail` at 67.15px, as this
branch gives, where main gave `中文中文 / ''tail`, and Safari also fixes both
`policy/straight-single` rows, `가나가 / 나''tail` at 58.51px. Over the full suite's
`maintained/closing-punctuation` rows, 4,528 left to right and 1,600 right to left
in each browser, and `reported/#274`'s 6 rows, main and this branch predict the same
lines. Suite hash
`b1d38173d4d4a84d70164b0537c3d578296b1a26a39dd9906d32c35d6310c766`; rows are in
`/private/tmp/pretext-eng-20260912/gate-cjk-mark-pairs-by-engine-{chrome,safari,firefox}`.

No row is lost, so there is nothing to attribute. Rerun with main's and this
branch's bundles side by side, the installed probe gives this branch's lines on all
1,038 Safari rows, where main matches 862. Chrome matches this branch on 1,036 rows
and main on 845, and Firefox on 973 and 907, and no row that main matches differs on
this branch. Chrome's other 2 rows are fits main misses too: at 45.08px Chrome
paints `가나 / 다'Firs / tWeek / 户` and this branch `가나 / 다'Firs / tWee / k户`, and at
47.70px Chrome fits `δεζη户` on one line where both give `δεζη / 户`. Of Firefox's
other 65, 64 put `}` or `|` after a letter, as in `xy abc}1234` or
`甲乙丙a|first_week户`, where Firefox breaks after the mark and the Gecko profile keeps
the word whole on main and this branch. In the last, `가나다|FirstWeek户` at 46.15px,
this branch now breaks after `|` as Firefox does, but Firefox fills `FirstW / eek户`
where this branch gives `First / Week / 户`.

`bun test` and `bun run check` pass. Under a counting fake canvas, Canvas calls per
cold `prepare()` don't change in any profile, since no corpus or accuracy-grid
segment changes: the 18 corpora take 53,093 calls in the Chrome profile, 116,306 in
the Safari profile and 53,108 in the Firefox profile, 57,041, 135,791 and 57,071
under `keep-all`, and 53,101, 116,314 and 53,116 under `pre-wrap`, and the accuracy
grid takes 9,136, 13,984 and 9,160. In Bun, cold `prepare()` under a fake canvas
stays within 3% of main over the corpora in each profile, is 16-18% faster on 500
CJK lines with marks, whose marks join fewer segments, and is 4-12% slower on one
text of 20,000 marks after CJK text, which stays linear. The baseline advances to
`1691168`, and the ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen. Chrome reads `prepare()` at 8.80 ms
(9.10 on the parent branch) and hot `layout()` at 0.0887 ms (0.0883); Safari reads
11.0 ms (12.0) and 0.105 ms (0.105). Long-form corpus totals read 125.0 ms in
Chrome (115.2) and 352 ms in Safari (358).

## Pre-wrap spaces and tabs that hang

This runtime change starts from main `0c12ece` (#307). In `pre-wrap`, a run of
preserved spaces and tabs at the end of a line hangs past it, as CSS Text 3 asks
(§4.1.2, §8.2). A line that wraps after such a run now reports the width before the
run, with the letter-spacing gap after the glyph before it, and the run fits
wherever the text before it fits, so the whole run stays on that line. Before a
newline or at the end of the text the run counts only as far as it fits, between the
width before it and the width with it, so `measureNaturalWidth()` still counts it.
Main counted every preserved space and each tab's full advance, fit a tab by its own
advance and later white space by the width after the earlier part of the run, so
`foo \t bar` laid out again at its 28.8px widest line gave `foo ` / `\t` / ` ` /
`bar` where 60px gave `foo \t ` / `bar`. The Markdown chat drops
`measureCodeLineStats()`, which subtracted the last space's width (#267) and
couldn't see tabs (#294), and sizes code boxes with `measureLineStats()`. Firefox
doesn't hang tabs, so the Gecko profile keeps main's tab rule through a new profile
field, `hangTabs`, and only preserved spaces hang there.

Before the browsers, the test fake canvas compared this branch with main over 20,000
random pre-wrap texts in each engine profile. Batch, streaming, walker, stats and
`layout()` agree in every profile. Widths change only on lines that end in preserved
spaces or, outside the Gecko profile, tabs. Where such a line wraps its width equals
the natural width of its text without them, and before a newline or at the end of
the text it lies between that and the width with them. Laid out again at its widest
line, a text that fits keeps its lines except with a zero-width space or a soft
hyphen under negative letter spacing, or at the Chromium profile's return from an
unfit hyphen: 165 texts in the Chrome profile and 70 in the Safari profile fail,
where main fails on 379 and 70, and normal mode on main fails in the same ways. The
Gecko profile fails on 427 texts, where main fails on 332, all with negative letter
spacing, since its tabs keep main's fit. The screen's 1,380 keys over the corpora,
the accuracy grid, hyphen and slash shapes, analysis, preferred breaks and
rich-inline cases are byte-identical in all four profiles; the screen records line
text but not widths.

The installed gate ran this change on `bc72c6d` against pinned `ebc3414`, whose
runtime source equals main: Chrome 153 through the Playwright transport, Safari
26.5.2 and Firefox 155 natively, both directions, at DPR 2. In supported scope
Chrome fixes 2,611 LTR and 883 RTL metrics and loses 97 and 25, Safari fixes 1,988
and 670 and loses 125 and 51, and Firefox fixes 438 and 248 and loses 69 and 31. No
leg has required failures, execution errors or new API or rich failures, and five
numeric profiles have no new failures. Most fixes are in the discretionary, tab,
terminal-spacing and negative-spacing families, where the browsers hang a whole run
of spaces and tabs, or a space by the negative gap after the letter before it:
Chrome paints `abc\tdef` at 20px in 16px Arial with letter spacing −2 as `abc\t` /
`def`, where main gave `abc` / `\t` / `def`. The two pre-wrap rows ENGINE_FOLLOWUPS
kept as losses from earlier changes now pass: `})x「value」! end` at 34.77px with
letter spacing −1 in Chrome and Firefox, where the space after `ue」!` hangs, and
`a\u05D0\u05D1aabb((\u0628\u0628\u0628\u0628\t\tword` at 64px in Safari, where both
tabs hang (#240). Suite hash
`cdaf225961c92a952d86c4c4f244e359241e11dd97d8699893e361e881413317`; rows are in
`/private/tmp/pretext-eng-20260912/gate-prewrap-hanging-width-{chrome,safari,firefox}`.

A first gate on `e162b31`, before the Gecko profile kept main's tab rule, gave the
same Chrome and Safari rows, but Firefox lost 1,119 LTR and 367 RTL metrics in 332
and 100 rows. Of those rows 307 and 90 contain a tab, and on 219 and 80 of them
main's lines equal Firefox's: Firefox gives a tab that doesn't fit a line of its
own, and paints `abc\tdef` above as `abc` / `\t` / `def`. Every Firefox row lost on
`bc72c6d` was lost there too.

Chrome loses 50 rows, Safari 67 and Firefox 35, all with negative letter spacing or
Arabic and Amiri emergency breaks. In 40 of Chrome's, 64 of Safari's and 30 of
Firefox's, main passed only while a line it gave to a space or tab cancelled another
error. That error was an emergency break Pretext places differently in Amiri (10
Chrome and 6 Safari rows, such as `بِبِ((tail \tword` at 24px, where Chrome paints
`((` / `tai` / `l \t` and this branch `((t` / `ail \t`), a lam-alef or bracket split
in Arabic with letter spacing −1 (15 Chrome, 9 Safari and 7 Firefox rows), or a line
the browser gives a raw CR or form feed (2 Firefox and 2 Safari rows). With letter
spacing −6 the browsers don't fit the next word after a hanging space (6 Chrome, 38
Safari and 12 Firefox rows): Chrome paints ` A B` at 6.5px as `A` / `B` and Safari
as ` A ` / `B`, where this branch keeps one line and main started the second line
with the space. With letter spacing −4 they give a space after a word joiner and
combining mark, or after U+FEFF, a line of its own, where this branch charges the
invisible character a negative gap and hangs the space, where main matched only
while it fit the space without that gap (9 rows in each browser). Chrome ends `a`,
U+00AD, space, `b` before the space at 7-10px with letter spacing −1 to −6 (10
rows), where main chose the hyphen. The remaining 13 rows are true losses, where
main's lines equal the native ones apart from a painted hyphen: 5 of those Chrome
soft hyphen rows; in Safari `a`, U+007F, space, `b` in 24px Amiri in both directions
and `a لا ب` at 1px in 32px Arial; and in Firefox that Arabic row and `To To` and
`AV AV` with letter spacing −1 in both directions, where Firefox gives the space a
line of its own. ENGINE_FOLLOWUPS records these shapes.

`bun test` and `bun run check` pass. Under a counting fake canvas, Canvas calls per
cold `prepare()` don't change in any profile, since only the line walker changes:
the 18 corpora take 53,093 calls in the Chrome profile, 116,306 in the Safari
profile and 53,108 in the Firefox profile, 57,041, 135,791 and 57,071 under
`keep-all`, and 53,101, 116,314 and 53,116 under `pre-wrap`. The baseline advances
to `11c440b`, and the ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen. Chrome reads `prepare()` at 9.10 ms
(9.05 on the parent branch) and hot `layout()` at 0.0883 ms (0.0887); Safari reads
12.0 ms (11.5) and 0.105 ms (0.105). Long-form corpus totals read 115.2 ms in
Chrome (115.0) and 358 ms in Safari (368).

## Rich-inline item-boundary mode removed

This change starts from main after #300 and removes rich-inline's `'item-boundary'`
mode. No installed browser has used it since #287: the Blink and Gecko profiles use
`'joined-text'`, and the WebKit profile `'item-text'`. It still ran in engines
Pretext doesn't recognize, including Bun, Node and jsdom, and where there is no
`navigator`. There every item boundary allowed a break, the joined text around a
boundary was never analyzed, and a trailing ZWSP or NEL marked a break before the
next item. Those engines now use `'joined-text'`, as Blink and Gecko do, and
`prepareRichInline()` loses the mode's branches and its `breakAfterPreviousItem`
state, 15 runtime lines. This fixes the wrong result ENGINE_FOLLOWUPS recorded,
where items `漢` and `丙.first` gave `漢丙.fir` / `st` though `丙.first` fits the next
line. The rich-inline unit tests that set no profile run under Bun's user agent, so
they now test the mode Chrome and Firefox use; they pass unchanged, and the test
that pinned both modes keeps its `'joined-text'` half.

The installed gate ran this change on `a36ce1b` against pinned `b69f72e`, whose
runtime source equals main: Chrome 153 through the Playwright transport, Safari
26.5.2 and Firefox 155 natively, both directions, at DPR 2 on the 2560x1440 screen.
No leg fixes or loses a metric or changes a failure, and every leg's metric totals
equal main's, as expected, since no installed profile used the mode. None has
required failures, execution errors, or new API or rich failures, and five numeric
profiles have no new failures. Suite hash
`8dff524da9a6cd7c95c956aa4c617781e062358a846fc3858547c07e716887b4`; rows are in
`/private/tmp/pretext-eng-20260912/gate-ablate-rich-item-boundary-{chrome,safari,firefox}`.

Before the browsers, a counting fake canvas compared this branch with main. Under
the Chrome, Safari and Firefox user agents, 1,380 keys covering the corpora, the
accuracy grid, hyphen and slash shapes, analysis, preferred breaks and 26
rich-inline cases are byte-identical, and so are 46 more rich-inline shapes and 18
corpus prefixes split into 5-character items. Under an unrecognized user agent 23 of
the 1,380 keys change, all of them rich-inline cases, at 450 of 2,262 widths, and
every flat output stays the same; the extra rich shapes change 28 shapes and all 18
prefixes, at 748 of 5,648 widths, with the same results when there is no
`navigator`. No native browser observes that profile, so its lines were compared
with the three major profiles at the same widths. Of the 748 widths, the branch
matches at least one of them where main matched none at 697, and all three at 510;
at no width does main match one of them while the branch matches none. At the other
51, main matched one engine by accident and the branch matches the other two: main
broke Thai, Lao and Myanmar split words at the item boundary as Safari does (15
widths), before small kana and `ー` as Chrome does (25), and after `/` in a URL or
path as Firefox does (11).

`bun test` and `bun run check` pass. Under a counting fake canvas, Canvas calls per
cold `prepare()` don't change in any profile: the 18 corpora take 53,093 calls in
the Chrome profile, 116,306 in the Safari profile and 53,108 in the Firefox profile,
and 57,041, 135,791 and 57,071 under `keep-all`. Canvas calls per cold
`prepareRichInline()` over the 64 rich screen inputs don't change either: 4,136 in
the Chrome profile, 4,944 in the Safari profile, 4,147 in the Firefox profile and
4,144 under an unrecognized user agent or with no `navigator`. The baseline advances
to `ebc3414`, and the ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen. Chrome reads `prepare()` at 9.05 ms
(8.95 on the parent branch) and hot `layout()` at 0.0887 ms (0.0882); Safari reads
11.5 ms (12.0) and 0.105 ms (0.105). Long-form corpus totals read 115.0 ms in
Chrome (114.9) and 368 ms in Safari (350).

## Closing punctuation joins the text before it

This runtime change starts from published main `52cc87c` (#290). A text segment that
starts with closing punctuation or a nonstarter, such as `，`, `」`, `：`, `。` or `！`,
now joins the text segment before it, whatever that text is (UAX #14 LB13, LB21), as
Chromium, WebKit in Safari 26.5.2 and Gecko keep the mark with a word, a number, an
emoji or a symbol whenever the two fit an empty line. Small kana and `ー` follow the
profile there, as after CJK text. The join runs after the URL, numeric and no-space
merges, so `(10:30)，` and `foo@bar.com，` stay whole, and before the forward carry,
which then moves `「` from `739x「` onto `value」!`. In the Gecko profile a run of two
or more complex-script code points keeps its break: ICU4X reports the end of such a
run as a break, and Firefox paints `a ខ្មែរ / ，b`. The new research family
`maintained/closing-punctuation` puts twelve marks after ten kinds of text and
sweeps two bracket shapes and three shapes with an opener after text.

The installed gate ran this change against pinned `1269f5e`, whose runtime source
equals `52cc87c`: Chrome 153 through the Playwright transport, Safari 26.5.2 and
Firefox 155 natively, both directions, at DPR 2. In supported scope Chrome fixes 486
LTR and 221 RTL metrics and loses 1 and 1; Safari fixes 518 and 227 and loses none;
Firefox fixes 490 and 221 and loses 1 and 1. In research scope Chrome fixes 4,293
and 1,098 metrics and loses 697 and 58, Safari fixes 4,850 and 1,316 and loses none,
and Firefox fixes 5,160 and 955 and loses 660 and 36. No leg has required failures,
execution errors or new API or rich failures, and five numeric profiles have no new
failures. Safari moves 156 LTR and 12 RTL source metrics from failing to unobserved,
132 of them in the new family, and Firefox 24 and 12, and metrics that still fail
change detail in Chrome (294 and 196), Firefox (36 and 28) and Safari (1 and 1).
#225's reproductions still pass in all three browsers. In
`maintained/content-language`, Firefox now matches small kana and `ー` after a digit
or a Latin letter on every page (15 rows), and Safari on `en`, `zh` and `zh-Hant`
pages (9 rows); Chrome's rows and Safari's `ja` and `ko` rows don't change. Suite
hash `c0f0b1148e3f1cabc02b3234e22580a969c0ab841b87d9356f04fc7258288877`; rows are in
`/private/tmp/pretext-eng-20260912/gate-cl-b-{chrome,safari,firefox}`, and the
family's own runs in
`/private/tmp/pretext-eng-20260912/cl-closing-punctuation-{chrome,safari,firefox}`.

Chrome loses 296 LTR and 28 RTL rows: 116 and 8 to joined Arabic emergency widths,
87 and 16 to text-spacing-trim, 81 LTR to emergency fits without context, 8 LTR to
Chrome's `zh` rule for `〜` and `゠`, 3 and 3 to letter spacing inside Arabic, and 1
and 1 to a pre-wrap space hang. Firefox loses 273 LTR and 21 RTL rows: 160 and 16 to
joined Arabic emergency widths, 108 LTR to emergency fits, 4 and 4 to letter spacing
inside Arabic, and 1 and 1 to the space hang. For example, Chrome paints `a عربي，b`
at 30.55px as `a / عربي / ，b`, as main gives, and this branch gives `a / عرب / ي， /
b`. On 258 and 16 of Chrome's rows and 268 and 16 of Firefox's, main's lines equal
the native lines; on the others main passed only while two errors cancelled. In the
joined Arabic, emergency-fit and trim rows, a boundary this branch adds that the
native lines don't have is an emergency break inside a unit that no longer fits:
Pretext charges isolated grapheme advances where Chrome and Firefox join Arabic
letters or kern Latin letters, or where Chrome trims `」。`. In the other rows this
branch takes a break main already allows: before U+202F, once `（ابب）` is charged
letter spacing that Chrome and Firefox skip, and after `a ` on `zh` pages, where
Chrome breaks before `〜` and `゠` instead. No lost row uses a break main doesn't
allow. The supported row lost per direction in Chrome and Firefox is `})x「value」!
end` at 34.77px in pre-wrap with letter spacing −1: this branch's lines equal the
native `})x / 「val / ue」! / end`, but the natives hang the space after `ue」!` where
this branch starts the fourth line with it, and main passed with `})x「 / value / 」!
/ end`.

In `maintained/closing-punctuation`, this branch is wrong on 790 of 6,128 Firefox
rows, where main is wrong on 2,400, on 870 Safari rows (main 2,684) and on 984
Chrome rows (main 2,380). Safari loses no row, and Firefox's 252 and Chrome's 221
lost rows are the Arabic, `foo@bar.com`, trim and `zh` rows above. A mark after
Latin letters, digits, a time in parentheses, an emoji, `★`, a Khmer word, a quoted
word or a URL matches Firefox and Safari at every width, and Chrome except at
trimmed widths and before `〜` and `゠` on `zh` pages, with two exceptions that main
shares: Safari still breaks `a (10: / 30)，b` inside the bracketed time (276 rows),
and after a closing curly quote Chrome on `en` and `ja` pages and Safari on `ja`
pages keep `ー`, `ァ` and `ヶ` with the quote, where Pretext breaks before them (24 and
12 rows). `739x「value」! end` and `한글x（value）! end` match Firefox and Safari at every
width from 1px to 160px in both directions, and Chrome except at 68 trimmed widths
each. In `x「hello world」`, `x「value` and `go xyzx「hello world」!`, all three browsers
end a line with `「` only at 1-26px, where the opener and the letter after it don't
fit together, while Pretext ends a line with it at up to 57-114px, before and after
this change. In `maintained/kinsoku-units`, `abc」。d` now matches Safari and Firefox
at every width, where main is wrong on 120 of 446 Safari rows and 114 of 441 Firefox
rows; at 26px both paint `ab / c」 / 。 / d`. Chrome stays wrong on 118 of 401 rows
(main 162), all at widths where it trims `」` or `。`.

`bun test` and `bun run check` pass. Under a counting fake canvas, Canvas calls per
cold `prepare()` change only on zh-zhufu in the Chrome and Firefox profiles, from
1,699 to 1,700, and on zh-guxiang in the Safari profile, from 1,424 to 1,426, where
`——` before `」` and a digit before `）` now join the mark after them. All 18 corpora
go from 53,092 to 53,093 calls in the Chrome profile, from 116,304 to 116,306 in the
Safari profile and from 53,107 to 53,108 in the Firefox profile. Under `keep-all`
zh-zhufu adds one call in the Chrome and Firefox profiles, and mixed-app-text and
the accuracy grid don't change. The baseline advances to `b69f72e`, and the ordinary
snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen. Chrome reads `prepare()` at 8.95 ms
(8.80 on the parent branch) and hot `layout()` at 0.0882 ms (0.0882); Safari reads
12.0 ms (11.0) and 0.105 ms (0.100). Long-form corpus totals read 114.9 ms in
Chrome (117.2) and 350 ms in Safari (346).

## Firefox breaks after a slash before a letter

This runtime change starts from published main `3f6bf0c` (#289). Installed Firefox
155 breaks after `/` wherever ICU4X's UAX #14 rules allow a break: before a letter
of any script, an opener or a symbol such as `#`, but not before a number, a Hebrew
letter or punctuation that no break precedes. It paints `https:// | example.com`,
`example.com/ | docs` and `and/ | or`, where Chrome and Safari keep the unit whole,
never breaks before `/`, and when such a unit doesn't fit a line it fills graphemes
but still ends the line after `/`. The Gecko profile now breaks there in every
merge, so a URL run stops after `https://` and after each `/` before a letter. The
Chromium and WebKit profiles don't change.

The installed gate ran this change against pinned `108c98a`, whose runtime source
equals `3f6bf0c`: Chrome 153 through the Playwright transport, Safari 26.5.2 and
Firefox 155 natively, both directions, at DPR 2 on the 2560x1440 screen. Chrome and
Safari change nothing in either direction: no fixed or lost metric, no changed
failure and identical metric totals. Firefox LTR fixes 969 metrics on 410 rows and
loses 5 on 5, and Firefox RTL fixes 93 on 39 and loses 1, so the Firefox leg exits 1
only because of those losses. Left to right, it fixes 282 `measurement` rows of
`©︎/©️`, where Firefox breaks after `/`, and 12 `mixed-app-text` corpus widths from
230 to 490px, including the 330, 340 and 350px rows #289 lost. It also fixes source
placement, widths or heights on 21 URL seam rows (`https://ex.com foo` with a tab,
ZWSP, NBSP, soft hyphen or newline, and `https://ex.com?x=1 foo` with a tab or soft
hyphen), 14 `hanging-tab` rows, 4 `url-shy-barrier` rows, and 77 seam rows of
`\/x<value>!`, `go \/x“value”!`, `go \/x‘value’!` and `////<<aabb`, 40 plain and 37
letter-spaced. Right to left it fixes the letter-spaced copies of those seam rows
and 2 `url-shy-barrier` rows. The 6 lost rows lose only whitespace. In
`https://ex.com\tfoo` in pre-wrap at 101px, twice left to right and once right to
left, Firefox paints `https:// | ex.com\tfoo` and this branch hangs the tab
(`https://ex.com\t | foo`). In `https://ex.com?x=1\tfoo` at 12px, three times left
to right, Firefox gives the tab a line of its own and this branch hangs it after
`1`. Main matched those rows only while its URL run took the tab into its text:
Firefox doesn't hang a tab that doesn't fit (ENGINE_FOLLOWUPS.md:99), and URL runs
still take a tab or soft hyphen into their text in every profile (:23). Firefox LTR
also changes the detail of 23 failures that still fail, on `hanging-tab` and URL
seam rows, and 216 `©︎/©️` source metrics move from failing to unobserved, since
Firefox gives each `©` a zero-width rectangle. No leg has required failures,
execution errors or new API or rich failures, and five numeric profiles have no new
failures. Suite hash
`dde51ce1d9e3b9651a1d40f7074b175079e9ee6f1e549619889710e585587c5e`; rows are in
`/private/tmp/pretext-eng-20260912/gate-ff-slash-{chrome,safari,firefox}`.

Before the gate, a headless replay of the #289 gate's rows that hold `/`, 1,183
left-to-right and 86 right-to-left in Firefox, predicted the same 6 lost rows, all
410 left-to-right fixed rows (362 with the same fixed metrics) and all 39
right-to-left ones, and no change in Chrome or Safari. It also predicted one more
corpus fix at 310px and two `©︎/©️` losses at 24px in 12px Courier New with letter
spacing -1.5, which installed Firefox doesn't show: there Firefox's Canvas measures
the text at 22.4px, and headless Chromium's at 24.9px.

An installed probe on an `en` page in 16px Arial swept 115 shapes at widths that
force a break before and after each `/`, `?`, `#`, `&` and `=`, in Firefox 155.0.1,
Chrome 153 and Safari 26.5.2, with main and this branch side by side. Chrome and
Safari give the same lines for both. Over the 6,686 Firefox rows of slash positions,
followers, right-to-left paragraphs, text after CJK text, URLs, overflowing units,
`keep-all`, `pre-wrap` and letter-spaced variants, rich-inline splits and the chat
block, lines fix 3,044 and lose none, and line counts fix 1,595 and lose 3. The 3
lost rows are right-to-left Arabic at 21-26px, where Firefox fills joined Arabic
graphemes (`عرب | ي/`) and Pretext isolated ones (`عر | ب | ي`); main matched their
counts only by keeping `/` with the Arabic after it (ENGINE_FOLLOWUPS.md:74). The
Markdown chat probe's `https://` link block (m02 b0), rebuilt in right-to-left 14px
Helvetica at the chat's content widths and swept from 120 to 540px, matches
Firefox's lines on 216 of 216 rows (102 on main), so its two Firefox membership
failures are fixed. The mixed-app-text corpus on its `mul` page matches Firefox's
line counts at 25 of 25 widths from 300 to 420px (10 on main): Firefox breaks its
URL after `https://example.com/` or `…/reports/`, as this branch does. Rerunning the
September 14 installed probe of 68 rich-inline cases with main and this branch
changes no Chrome row. In Firefox, over its 2,361 rows, lines fix 345 and lose none,
and line counts fix 194 and lose 5, all on a padded Menlo code item split across
lines, whose padding Pretext charges on both pieces. Of the rows #287 accepted where
Firefox breaks after `/`, all 54 lost lines and 168 of 171 lost line counts now
match Firefox; the other 3 are that code item.

`bun test` and `bun run check` pass. Under a counting fake canvas, Canvas calls per
cold `prepare()` don't change in the Chrome or Safari profile: over the 18 corpora
the Chrome profile makes 53,092 on main and this branch and the Safari profile
116,304 (57,040 and 135,791 under `keep-all`), and over the accuracy grid 9,136 and
13,984. The Firefox profile makes 53,104 on main and 53,107 on this branch (57,067
and 57,070 under `keep-all`), the three extra calls measuring the new pieces of the
mixed-app-text URL, and 9,160 over the accuracy grid on both. Only the Firefox
profile's segments change, in that one corpus, where
`https://example.com/reports/q3?` becomes `https://`, `example.com/`, `reports/` and
`q3?`. The baseline advances to `1269f5e`, and the ordinary snapshots were
regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen. Chrome reads `prepare()` at 8.80 ms
(8.75 on the parent branch) and hot `layout()` at 0.0882 ms (0.0880); Safari reads
11.0 ms (11.0) and 0.100 ms (0.100). Long-form corpus totals read 117.2 ms in
Chrome (110.6) and 346 ms in Safari (344).

## Firefox hyphens before digits

This runtime change starts from published main `f4ac038` (#288). Installed Firefox
155 offers no break between a hyphen-minus and a following number, as ICU4X keeps HY
with NU (UAX #14 LB25), ASCII or not. It moves `log-2026` or `2025-08-01` to the
next line whole and breaks `crash-log-2026-09-12.txt` only after `crash-`, where
Chrome and Safari break after each hyphen, and when such a word doesn't fit a line
it fills graphemes. The Gecko profile now keeps the pair in every merge, keeps
numeric runs such as `8:30-4:30` whole, and no longer prefers that break in an
overflowing word. The Chromium and WebKit profiles don't change.

The installed gate ran this change against pinned `01daf37`, whose runtime source
equals `f4ac038`: Chrome 153 through the Playwright transport, Safari 26.5.2 and
Firefox 155 natively, both directions, at DPR 2. Chrome, Safari and Firefox RTL
change nothing: no fixed or lost metric, no changed failure and identical metric
totals. Firefox LTR fixes 10 metrics on 5 rows and loses 6 on 3, so that leg exits 1
only because of those losses. It fixes source placement on #225's first reproduction
in both white-space modes, and widths in normal white space, where Firefox paints
`2025-08-01 / 00:00:00， / 2025-08-01 00:00:00` and main broke after `2025-08-`. It
fixes source placement on `$-73` in both modes and widths in normal white space, and
height, line count, source placement and widths on #212's `x-100`, where Firefox
fills graphemes past the hyphen (`$-7 / 3`, `x-1 / 00`) and main broke after it. The
3 lost rows are `mixed-app-text` corpus heights and line counts at 330, 340 and
350px, where this branch takes one line more than Firefox. Main matched them only by
breaking after `8:30-`, where Firefox doesn't break. In installed Firefox that
corpus keeps `8:30-4:30` whole, as this branch does, and then breaks the URL after a
`/` before a letter, before `reports/` at 330 and 340px and before `q3?` at 350px,
where Pretext moves the URL to the next line (ENGINE_FOLLOWUPS.md:34). Four
`en-gatsby-opening` corpus widths that already failed move one line closer to
Firefox. No leg has required failures, execution errors or new API or rich failures,
and five numeric profiles have no new failures. #225's Firefox row stays observed,
since its width sits about 1px inside Firefox's three-line band. Suite hash
`0b90b0740c1c261a4d082ed05c83d88b4038831f8118a8d8d8ffcda2eba8f76c`; rows are in
`/private/tmp/pretext-eng-20260912/gate-ff-hyphen-{chrome,safari,firefox}`.

An installed probe on an `en` page in 16px Arial swept 75 shapes at widths that
force each break, in Firefox 155.0.1, Chrome 153 and Safari 26.5.2, with main and
this branch side by side. Chrome and Safari give the same lines for both. Over the
2,358 Firefox rows of hyphen shapes, `keep-all`, `pre-wrap`, letter-spaced and
rich-inline variants and the chat block, lines fix 928 and lose 13, and line counts
fix 487 and lose 6. The 18 lost rows are ones main matched only by breaking after a
hyphen where Firefox doesn't break: 8 `x--1` rows, where the overflowing word now
prefers the break after its first hyphen (ENGINE_FOLLOWUPS.md:33), 4 `a-́1` rows,
where Pretext breaks before a hyphen that carries a mark (:32), and 6 `keep-all`
rows of `crash-log-2026-09-12.txt`, where Firefox keeps `crash-log` too (:46).
U+2010, U+2012 and U+2013 before a digit, fullwidth digits, and `/`, which Firefox
breaks after before a letter (:34), change nothing. The Markdown chat probe's
`crash-log-2026-09-12.txt` block (m07 b1), rebuilt in right-to-left 14px Helvetica
at the chat's content widths and swept from 120 to 420px, matches Firefox's lines on
151 of 151 rows (89 on main), so its two Firefox membership failures are fixed. Its
`https://` blocks wait on the `/` rule.

Before the gate, a headless replay of the #288 gate's rows that hold `-` before a
number, 186 left-to-right and 64 right-to-left in Firefox, predicted exactly these
fixed and lost rows, and no change in Chrome or Safari.

`bun test` and `bun run check` pass. Under a counting fake canvas, Canvas calls per
cold `prepare()` don't change in any engine profile: over the 18 corpora the Chrome
profile makes 53,092 on main and this branch, the Safari profile 116,304 and the
Firefox profile 53,104 (57,040, 135,791 and 57,067 under `keep-all`), and over the
accuracy grid 9,136, 13,984 and 9,160. Only the Firefox profile's segments change,
in three corpora, where time ranges such as `8:30-4:30` and `ה-16` stay whole. The
baseline advances to `108c98a`, and the ordinary snapshots were regenerated against
it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen. Chrome reads `prepare()` at 8.75 ms
(8.85 on the parent branch) and hot `layout()` at 0.0880 ms (0.0885); Safari reads
11.0 ms (11.0) and 0.100 ms (0.105). Long-form corpus totals read 110.6 ms in
Chrome (111.6) and 344 ms in Safari (346).

## Emergency breaks inside kinsoku units

This runtime change starts from published main `cc8619a` (#287). A CJK unit that
kinsoku keeps together, such as `漢。` or `「漢`, and a `keep-all` group now break
between graphemes when they don't fit a line, as Chromium, WebKit in Safari 26.5.2
and Gecko do under `overflow-wrap: break-word`. That includes a `keep-all` run of
plain letters that `Intl.Segmenter` doesn't mark as a word, as Firefox's segmenter
doesn't for the second `漢字` in `漢字」。漢字`. The forward carry keeps combining marks
with their base, and a run of openers stays with the text after it (UAX #14 LB14,
LB28). The new research family `maintained/kinsoku-units` sweeps these shapes from
1px until they fit one line.

The installed gate ran this change against pinned `3bd7496`, whose runtime source
equals `cc8619a`: Chrome 153 through the Playwright transport, Safari 26.5.2 and
Firefox 155 natively, both directions, at DPR 2. Chrome fixes 1,271 LTR and 987 RTL
metrics and loses 210 and 158; Safari fixes 2,138 and 1,369 and loses 22 and 22;
Firefox fixes 1,234 and 771 and loses 80 and 44. No leg has required failures,
execution errors or new API or rich failures, and five numeric profiles have no new
failures. Every lost row is one main passed only while two errors cancelled. Chrome
loses 77 LTR and 57 RTL rows: 37 and 29 to text-spacing-trim, where Chrome paints
the second opener in `「「tail` at 8px and Pretext charges 16px when it breaks inside
the unit, 22 and 18 to the U+3000 hang, 16 and 8 to joined Arabic emergency widths
and 2 and 2 to raw VT. Safari loses 11 per direction: 6 to its joined Arabic
graphemes and 5 to raw CR and FF. Firefox loses 33 LTR and 21 RTL rows: 6 and 2 to
the U+3000 hang, 12 and 4 to joined Arabic emergency widths, 7 and 7 to raw VT, CR
and FF, 4 per direction where Firefox paints U+0000 at zero advance, and 4 per
direction where, under `keep-all`, Firefox keeps `”` with the ideograph after it. On
most of these rows main broke where UAX #14 forbids a break, such as `「「|tail`, and
the browser's emergency break fell at the same place. Suite hash
`adfc9cfd00420d56870040b83e723844ae5dc7b14e273b7ccc55ce0828ee70db`; rows are in
`/private/tmp/pretext-eng-20260912/gate-cl-a-{chrome,safari,firefox}`.

In the recipes, `漢。字`, `1234。b`, `日本ーー` and `日本！ーー` match all three browsers at
every width, so Firefox's emergency split of `本ーー` is now modeled. Under `keep-all`,
`漢字」。漢字` matches Firefox at every width, where main is wrong on 189 of 291 rows.
Outside Chrome's trimmed widths, only `abc」。d` still differs among the cluster,
`keep-all` and sub-glyph sweeps (133 Firefox and 140 Safari rows), because Pretext
breaks before `」` after Latin letters.

`bun test` and `bun run check` pass. Under a counting fake canvas, Canvas calls per
cold `prepare()` rise only on the Chinese, Japanese, Korean and mixed corpora,
because their kinsoku units now take emergency breaks. zh-zhufu goes from 1,597 to
1,699 calls in the Chrome and Firefox profiles and from 1,601 to 1,760 in the Safari
profile, and all 18 corpora from 52,811 to 53,092 in the Chrome profile, from
115,855 to 116,304 in the Safari profile and from 52,817 to 53,104 in the Firefox
profile. Under `keep-all` the totals don't change. The baseline advances to
`01daf37`, and the ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen. Chrome reads `prepare()` at 8.85 ms
(8.75 on the parent branch) and hot `layout()` at 0.0885 ms (0.0890); Safari reads
11.0 ms (11.0) and 0.105 ms (0.105). Long-form corpus totals read 111.6 ms in
Chrome (119.9) and 346 ms in Safari (345).

## Rich-inline boundaries in Firefox

This change starts from main after #281. `prepareRichInline()` still let every item
boundary break in Firefox, while Gecko keeps collecting a word across text frames
until a space and breaks it once with ICU4X's line segmenter. The Gecko profile's
`inlineItemBreaks` is now `'joined-text'`, as in Blink, so its own break rules apply
across item boundaries. Engines Pretext doesn't recognize keep `'item-boundary'`. The
`parenthesized-item` and `split-word` rich-boundary rows now require rich height in
Firefox too.

The installed gate ran this change on `e690b1c` against pinned `63600ad`: Chrome 153
through the Playwright transport, Safari 26.5.2 and Firefox 155 natively, both
directions. Chrome, Safari and Firefox RTL change nothing. Firefox LTR fixes 6 rich
heights in `maintained/rich-boundaries`, including both newly required rows, and
loses one, so 23 of 24 rich heights pass (18 on main). The lost row is
`myanmar-split-word` at 88px, where the rich prediction now has 5 lines and native
Firefox 4. Its second item starts with U+102C, which shapes with the consonant before
it: in 16px Myanmar Sangam MN `ဘာသ` and `ာသည်` measure 91.80px separately and 82.03px
joined, so the joined rule adds a line. Main matched the line count only by breaking
at the item boundary, where Firefox never starts a line, and the flat prediction
still gives Firefox's lines. That loss is accepted as main's accidental pass, so the
Firefox leg exits with an error. No leg has required failures, execution errors or
new API or rich failures, the 14 `issue/#210-#211` rich rows pass in every browser,
and five numeric profiles have no new failures.

An installed Firefox 155 replay of the 13,038 left-to-right `r0912/rib/` research
rows, with main `01937de` and this branch as candidates, gains 768 rich heights
(11,840 to 12,515 pass) and loses 93, all accidents. 40 are Myanmar split-word rows
with the same cluster split; their flat line count matches native on all 40. 36
follow a flat prediction that already fails: 33 numeric-sign fuzz rows where Firefox
keeps a hyphen with the digit after it, as in `n2-1`, and 3 fit thresholds of
`our community,` and `see (docs)`. 17 are `our community,` rows between 108.21 and
109.38px, where Arial kerns across items: the line measures 108.2167px as one string
in Canvas and the DOM, but its items sum to 109.40px. Main broke before `,`, where
Firefox never breaks. Two of those rows fit as one string only within the 0.005px
fit epsilon.

Rerunning the September 14 installed probe of 68 cases against the same two builds
changes no Chrome row. In Firefox, over 2,018 rows (same-font copies left out, Myanmar
counted once), lines fix 624 and lose 29, and line counts fix 297 and lose 117. Every
lost row has a checked cause. Firefox breaks after `/` before a letter, as in
`example.com/|docs`, `src/|layout.ts` and `and/|or`, where Pretext keeps the unit
whole (178 rows, same-font copies included). The Myanmar cluster split accounts for
40 rows on two pages. A padded code item split across lines, whose padding Pretext
charges on both pieces, accounts for 2. Main matched the `/` rows by analyzing each
item alone, so Firefox heights of text split across items next to `/`, such as links
and paths, are accepted as main's accidental passes too.

The change adds no Canvas calls: preparing the Markdown chat demo's 17,685 rich-inline
blocks in installed Firefox makes 18,197 calls on both builds, with the same strings
in the same order. In the foreground on AC power, over 10 page loads per build in
ABBA order, `prepareRichInline()` reads 347.5 ms per cold pass (342.0 on main),
298.5 ms for 15,926 fresh-text calls (293.0) and 373.5 ms for the first pass (370.5).
Only the fresh-text slowdown, 1.7%, holds in every adjacent pair.

`bun test` and `bun run check` pass. Merging main afterwards brought in only demo
and docs changes, which touch no file under `src/` or `tests/`. The baseline
advances to `3bd7496`, and the ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen. Chrome reads `prepare()` at 8.75 ms
(8.60 on the parent branch) and hot `layout()` at 0.0890 ms (0.0885); Safari reads
11.0 ms (12.0) and 0.105 ms (0.105). Long-form corpus totals read 119.9 ms in
Chrome (111.9) and 345 ms in Safari (362).

## Rich-inline items within the line fit epsilon

This change starts from main after #276. Rich-inline layout could take one more line at a
width than at a slightly narrower width. The walk over the next item takes a longer part of
it when that part fits within the line walker's fit epsilon (0.005px, or 1/64px in Safari),
but the check after that walk compared raw widths and moved the whole item to the next line.
Every rich-inline fit check now allows the epsilon, as the line walker and the carry checks
already did; the allowance applies once per line. Blink's and WebKit's line builders also add
their epsilon once to the available width for every kind of content. Under the Blink, WebKit
and Gecko profiles, the widths where a line count goes up in every width range of 28 flows
fall from 136, 98 and 142 to 0. No suite row has content that fits only within the
allowance, so the installed gate changed no metric.

The installed gate ran against the previous pin `6f22449`: Chrome 153 through the
Playwright transport, Safari 26.5.2 and Firefox 155 natively, both directions.
No leg fixes a metric. No leg loses a metric, and none has required failures, execution errors,
or new API or rich failures.

`bun test` and `bun run check` pass. The baseline advances to `63600ad`, and the
ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen. Chrome reads `prepare()` at 8.60 ms
(8.50 on the parent branch) and hot `layout()` at 0.0885 ms (0.0877); Safari reads
12.0 ms (11.0) and 0.105 ms (0.105). Long-form corpus totals read 111.9 ms in
Chrome (116.8) and 362 ms in Safari (362).

## Text after a mark that ends CJK text

This change starts from main after #275. After CJK text, Pretext attached punctuation that
can't start a line, such as the `.` in `丙.`, to the CJK text, but then started the next word
as its own break unit, so lines could break between `丙.` and `first_week_voltage}` (#274).
Chrome, Safari and Firefox keep them together wherever UAX #14 keeps the pair: IS, CP and PO
before a letter or number, and straight quotes before anything. The first merge pass and the
CJK unit builder now take the text after such punctuation, and the joined unit still takes
grapheme breaks when it doesn't fit an empty line. Letters inside a CJK unit don't join, and
neither does text after a closing curly quote, where Chrome breaks; the first installed gate
lost rows on both. Where engines disagree, as for `!`, `}`, `/` and `|` before a letter,
Pretext keeps main's behavior, and ENGINE_FOLLOWUPS.md records what each engine does.

The installed gate ran against the previous pin `b569d86`: Chrome 153 through the
Playwright transport, Safari 26.5.2 and Firefox 155 natively, both directions.
Chrome fixes 79 LTR and 37 RTL metrics (42 in `signed-spacing/straight-double`, 32 in `script-prefix-heldout`, 24 in `reported/#274`, 18 in `straight-double`); Safari fixes 80 LTR and 38 RTL metrics (42 in `signed-spacing/straight-double`, 34 in `script-prefix-heldout`, 24 in `reported/#274`, 18 in `straight-double`); Firefox fixes 79 LTR and 37 RTL metrics (42 in `signed-spacing/straight-double`, 32 in `script-prefix-heldout`, 24 in `reported/#274`, 18 in `straight-double`). No leg loses a metric, and none has required failures, execution errors,
or new API or rich failures.

`bun test` and `bun run check` pass. The baseline advances to `6f22449`, and the
ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen (the parent branch's runs used the
1440x2560 screen). Chrome reads `prepare()` at 8.50 ms (8.50 on the parent branch)
and hot `layout()` at 0.0877 ms (0.0885); Safari reads 11.0 ms (11.0) and 0.105 ms
(0.103). Long-form corpus totals read 116.8 ms in Chrome (113.7) and 362 ms in
Safari (346).

## A space after an overflowing first word

This change starts from main after #271. Pretext walks lines with a fast loop for plain text
and a general loop when the text anywhere contains soft hyphens, letter spacing, glue or
similar. When a line's first word was wider than the line and a space or zero-width space
followed, the fast loop kept the space on that line and the general loop moved it to the next,
so adding a soft hyphen elsewhere changed line text and line-end cursors. The general loop now
follows the fast one. Browsers draw that space at zero width, so no native observation decides
which line owns it, and plain-text line counts and widths don't change. A negative width now
lays out like 0 in every fit limit, so both loops agree there too. With `letterSpacing`,
rich-inline layout can take fewer lines where invisible characters such as a zero-width space
took a line of their own.

The installed gate ran against the previous pin `8ab3383`: Chrome 153 through the
Playwright transport, Safari 26.5.2 and Firefox 155 natively, both directions.
No leg fixes a metric. No leg loses a metric, and none has required failures, execution errors,
or new API or rich failures.

`bun test` and `bun run check` pass. The baseline advances to `b569d86`, and the
ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen (the parent branch's runs used the
2560x1440 screen). Chrome reads `prepare()` at 8.50 ms (8.65 on the parent branch)
and hot `layout()` at 0.0885 ms (0.0885); Safari reads 11.0 ms (12.0) and 0.103 ms
(0.105). Long-form corpus totals read 113.7 ms in Chrome (118.7) and 346 ms in
Safari (348).

## Safari kerning across paragraphs

This change starts from main after #270. In the Safari profile, a word ending in an invisible
format character such as a word joiner is measured together with a following space, so the
pair keeps its kerning. That was skipped when an explicit bidi control such as U+202A appeared
anywhere in the text, even in another paragraph. The check now scans only the space's own bidi
paragraph, since UAX #9 X8 ends embeddings at a paragraph separator. The maintained
`space-kerning` case `AA⁠ B`, a newline and `‪x` in pre-wrap at about 20.9px is 3 lines in
installed Safari; main predicted 4.

The installed gate ran against the previous pin `4833f8e`: Chrome 153 through the
Playwright transport, Safari 26.5.2 and Firefox 155 natively, both directions.
Safari fixes 3 LTR and 0 RTL metrics (3 in `maintained/space-kerning`). No leg loses a metric, and none has required failures, execution errors,
or new API or rich failures.

`bun test` and `bun run check` pass. The baseline advances to `8ab3383`, and the
ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen. Chrome reads `prepare()` at 8.65 ms
(8.45 on the parent branch) and hot `layout()` at 0.0885 ms (0.0887); Safari reads
12.0 ms (11.0) and 0.105 ms (0.103). Long-form corpus totals read 118.7 ms in
Chrome (117.9) and 348 ms in Safari (347).

## Firefox marks after a line break or space

This change starts from main after #269. In the Firefox profile, the numeric affix check
looked back past combining marks for the character before `$`, `%`, `+` or `\`, and after a
line break or a space it took the break or space as the mark's base. So `x`, a newline and
`ً$` split differently from `ً$` at the start of the text. Following UAX #14 LB9 and LB10,
a mark with no base now counts as a letter. At narrow widths such text can take one line
fewer: after `어`, a space and U+3099, `$"` no longer breaks between `$` and `"`. A
counting fake canvas over `src/test-data.ts` and whole corpora found no other change.

The installed gate ran against the previous pin `ee5607e`: Chrome 153 through the
Playwright transport, Safari 26.5.2 and Firefox 155 natively, both directions.
No leg fixes a metric. No leg loses a metric, and none has required failures, execution errors,
or new API or rich failures.

`bun test` and `bun run check` pass. The baseline advances to `4833f8e`, and the
ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen (the parent branch's runs used the
1440x2560 screen). Chrome reads `prepare()` at 8.45 ms (8.55 on the parent branch)
and hot `layout()` at 0.0887 ms (0.0880); Safari reads 11.0 ms (11.0) and 0.103 ms
(0.105). Long-form corpus totals read 117.9 ms in Chrome (117.2) and 347 ms in
Safari (345).

## Keep-all URL query text

This change starts from main after #268. `mergeUrlRuns` gave a URL's query segment the start of an inner
`www.` or scheme segment instead of the position after the whole URL run. With
`word-break: keep-all` in the Chrome and Firefox profiles, `アwww.¿www.?־` prepared as
`["アwww.¿", "־"]` and lost `www.?`, and an inner `https://` lost text the same way. The
fix removes that override. In Chrome and Safari, rich-inline layout no longer breaks such a
URL where its text has no break opportunity, as before the second `www.` in items `字` and
`www.a/www.b?q=1`. A counting fake canvas over `src/test-data.ts` and whole corpora under
desktop Chrome, Safari, Firefox and Android user agents found no other change.

The installed gate ran against the previous pin `b510ce1`: Chrome 153 through the
Playwright transport, Safari 26.5.2 and Firefox 155 natively, both directions.
No leg fixes a metric. No leg loses a metric, and none has required failures, execution errors,
or new API or rich failures.

`bun test` and `bun run check` pass. The baseline advances to `ee5607e`, and the
ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Chrome reads `prepare()` at 8.55 ms
(8.40 on the parent branch) and hot `layout()` at 0.0880 ms (0.0870); Safari reads
11.0 ms (11.0) and 0.105 ms (0.105). Long-form corpus totals read 117.2 ms in
Chrome (117.5) and 345 ms in Safari (345).

## Removing segLevels

This change starts from main after #256. `prepareWithSegments()` no longer
returns `segLevels`, and `src/bidi.ts` keeps only the class lookup and bracket
check that Safari's following-space kerning guard reads. Nothing in the library,
rich-inline or the demos read the levels, and one level per segment couldn't
produce visual order. The published `PreparedTextWithSegments` type loses the
field; nothing else in the emitted declarations changes.

Before the browsers, a counting fake canvas under desktop Chrome, Safari, Firefox
and Android user agents compared the branch with main on 24,404 cases per user
agent: every corpus text, `src/test-data.ts` and every retained wrapping input.
Handles, layout and rich-inline outputs, and Canvas calls and submitted strings
matched, apart from the missing field. A review probe on 4,915 new bidi-heavy
cases under six profiles matched as well. Interleaved V8 timings of the removed
pass on main read `prepareWithSegments()` 2.9% faster on Latin corpora, 8.5% on
Arabic, Hebrew and Urdu corpora and 16.3% on 500 short Arabic texts, and
`prepareRichInline()` 15.2% faster with 300 Arabic items. The gzipped layout entry
shrinks from 26,099 to 25,441 B.

The installed gate ran against #255's pin `cc2328b`: Chrome 153 through the
Playwright transport, Safari 26.5.2 and Firefox 155 natively, both directions.
No leg fixes or loses a metric, and none has required failures, execution errors,
or new API or rich failures.

`bun test` and `bun run check` pass. The baseline advances to `b510ce1`, and the
ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused. A first Chrome run read the
long-form corpus total 11% above #255's snapshot, almost all of it in Arabic
measurement, so Chrome was measured again back to back with main 477510e on the
2560x1440 screen. This branch reads `prepare()` at 8.40 ms (8.45 on main), hot
`layout()` at 0.0870 ms (0.0868) and a corpus total of 117.5 ms (115.9), so the
earlier gap was environment drift, not this branch. Safari on the 1440x2560 screen
(#255's runs used the 2560x1440 screen) reads 11.0 ms (11.5 on #255), 0.105 ms
(0.105) and 345 ms (347). The benchmark page times `prepare()`, which never
computed the levels.

## Smaller prepare state

This change starts from main after #254 and leaves output unchanged. The
`letterSpaceNextLine` profile field was false wherever it was read and is gone.
The soft-hyphen shaping map and `clearLineTextCaches` duplicated caches that
already exist. Prepared handles no longer keep per-segment `lineEndFitAdvances`
and `lineEndPaintAdvances`: the complex line walker derives them from the width,
kind and letter-spacing count each handle already holds. Those arrays were
undocumented fields on the published `prepareWithSegments()` type. The hyphen,
mandatory-break and CJK line-start sets now read the generated line-break class
table, and `layoutNextLine()`, `layoutNextLineRange()` and the rich-inline item
step share their duplicated advances. The library loses 110 lines net, and the
core bundle about 316 B gzipped.

Before the browsers, the Blink, WebKit, Gecko and Android profiles produced no
output differences across 163 texts, about 1,956 handles and 11,736 rows each,
with identical Canvas call counts. The derived advances matched the stored arrays
in about 1.5 million checks per profile, and the numeric companion is unchanged.

The installed gate ran against #250's pin `b4d9fd7`: Chrome 153 through the
Playwright transport, Safari 26.5.2 and Firefox 155 natively, both directions.
No leg fixes or loses a metric, and none has required failures, execution errors,
or new API or rich failures.

Interleaved V8 timings (Node 23, a fake canvas with a Chrome user agent, 31
rounds, head against base) read cold `prepare()` over the long-form corpus 2.5%
faster and warm 1.6% faster. `layout()` is 15% faster for pre-wrap, 7% faster
with letter spacing and flat (+0.5%) on the simple path. Soft-hyphen-heavy text
prepares 1.9% slower cold (10.0 ms against 9.85), because each soft hyphen now
looks up its joined text in the segment metrics cache instead of the removed map,
and flat warm.

`bun test` and `bun run check` pass. The baseline advances to `cc2328b`, and the
ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 2560x1440 screen (the parent branch's Safari runs used
the 1440x2560 screen). Chrome reads `prepare()` at 8.50 ms (9.15 on the parent
branch) and hot `layout()` at 0.0883 ms (0.0885); Safari reads 11.5 ms (11.0) and
0.105 ms (0.105). Long-form corpus totals read 107.9 ms in Chrome (115.0) and 347
ms in Safari (359).

## Small kana and ー in Chrome and Firefox

This runtime change starts from main after #249. Chrome and Firefox now resolve
small kana and `ー` through the class-table predicate that Safari already uses.
Chromium's ICU data classifies these conditional Japanese starters as ideographic
for every page language. So in Chrome they may start a line after CJK text,
including after `？` and `！`. Gecko's `line-break: auto` is strict, so in Firefox,
and in engines Pretext doesn't recognize, small kana stay with the CJK text before
them. The `conditionalJapaneseStarterModel` profile field lost its last use and is
removed.

The installed gate ran against #249's pin `8a54d4c`: Chrome 153 through the
Playwright transport, Safari 26.5.2 and Firefox 155 natively, both directions.
Chrome fixes 25 LTR and 0 RTL metrics (25 in `maintained/content-language`). Firefox
fixes 98 and 0 (80 in `maintained/content-language`, 18 in `maintained/corpus`). Safari changes nothing. No leg
loses a metric or has required failures, execution errors, or new API or rich
failures.

After a digit or a Latin letter, Firefox keeps small kana and `ー` attached, but
Pretext still lets them start a line there. Firefox's emergency split of `本ーー`
is still unmodeled.

`bun test` and `bun run check` pass. The baseline advances to `b4d9fd7`, and the
ordinary snapshots were regenerated against it. Firefox's step-10 corpus sweep now
matches `ja-kumo-no-ito` at all 61 widths, up from 52; no other snapshot payload
changes.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Chrome reads `prepare()` at 9.15 ms
(8.80 on the parent branch) and hot `layout()` at 0.0885 ms (0.0900); Safari reads
11.0 ms (11.0) and 0.105 ms (0.105). Long-form corpus totals read 115.0 ms in
Chrome (119.7) and 359 ms in Safari (351). Under a counting fake canvas in Bun, Canvas
calls per cold `prepare()` are unchanged for the Chrome profile. The Firefox profile
adds 22 calls on `ja-kumo-no-ito` (336 to 358) for its new two-grapheme units.

## Safari small kana and ー by page language

This runtime change starts from main after #248. Preparation reads `<html lang>`
once and resolves a line-break language from its primary subtag: `ja`, `ko`,
`zh` or the root rules. In Safari, small kana and `ー` after CJK text may start a
line on Japanese and Korean pages. Elsewhere they stay with the text before them,
as the content-language observations show. One predicate now decides where CJ
characters can start a line, from the generated class table and the profile's CJ
resolution. It replaces a hand-kept set that listed `ー` but no small kana. Chrome
and Firefox keep their previous rules.

The installed gate ran against #248's pin `96f4673`: Chrome 153 through the
Playwright transport, Safari 26.5.2 and Firefox 155 natively, both directions.
Safari fixes 68 LTR metrics (68 in `maintained/content-language`) and loses none. Chrome and Firefox
change nothing, and no leg has required failures, execution errors or new API or
rich failures.

Preparation now reads `<html lang>` once per call instead of twice. A handle
prepared before a language change keeps its line-break rules as well as its
widths, as README says. After Latin letters or digits, Safari's profile still lets
small kana and `ー` start a line on other pages.

`bun test` and `bun run check` pass. The baseline advances to `8a54d4c`, and the
ordinary snapshots were regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Chrome reads `prepare()` at 8.80 ms
(8.75 on the parent branch) and hot `layout()` at 0.0900 ms (0.0895); Safari reads
11.0 ms (11.0) and 0.105 ms (0.105). Long-form corpus totals read 119.7 ms in
Chrome (122.0) and 351 ms in Safari (353).

## One separator check per text

This runtime change starts from main after #245. #245 tested every segment with a
regex for a digit, a full-width separator and another digit, so words like
`00，2025` split after the separator. In V8 that regex cost about 1.5% of a cold
`prepare()` over the long-form corpus texts. Preparation now checks the whole
text once for the six separators, and scans segments with a character loop only
when one is present. Line breaks don't change.

An interleaved Node 23 run of cold `prepare()` over the 18 corpus texts, with a
fake canvas, read 252.0 ms before #245, 255.5 ms with #245 and 252.3 ms with this
change. The installed gate ran against #245's pin `9270621`: Chrome 153 through
the Playwright transport, Safari 26.5.2 and Firefox 155 natively, both
directions. No leg fixes or loses a metric, and none has required failures,
execution errors or new API or rich failures. `bun test` and `bun run check`
pass. The baseline advances to `96f4673`, and the ordinary snapshots were
regenerated against it.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Chrome reads `prepare()` at 8.75 ms
(9.15 on the parent branch) and hot `layout()` at 0.0895 ms (0.0895); Safari reads
11.0 ms (11.5) and 0.105 ms (0.105). Long-form corpus totals read 122.0 ms in
Chrome (121.4) and 353 ms in Safari (351).

## Numeric runs with a closing full-width comma

This runtime change starts from main after #243. A numeric run now keeps the
closing punctuation that follows it (UAX #14 LB25, with classes from the
generated line-break table), so `00:00:00，` stays whole instead of breaking
after `:` or before the comma. `Intl.Segmenter` keeps a full-width comma, stop
or semicolon between digits inside one word (`00，2025`), and Safari marks such
words non-word. Those words now split after the punctuation, where UAX #14
allows a break, so the time before them merges as one run.

#225's reproductions are reported rows with the reporter's font in `normal` and
`pre-wrap`: both reproductions, the control, a bare `xxxx，b`, a time at a width
that fits only part of it, and a comma between digits. They are required in
Chrome and Safari. Firefox keeps a date such as `2025-08-01` whole, where Chrome
and Safari break after its hyphens, so the first reproduction only observes
Firefox.

The installed gate ran this branch against #243's pin `7652cad`: Chrome 153
through the Playwright transport, and Safari 26.5.2 and Firefox 155 natively, in
both directions. Chrome fixes 11 LTR and 0 RTL metrics, Safari 10 and 0, and Firefox
8 and 0. No leg loses a metric or has required failures, execution errors, or new
API or rich failures.

Two broader rules ran through the same gate and were reverted. Attaching closing
punctuation after any Latin text (LB13) creates kinsoku units without emergency
breaks. It lost 42 Chrome, 52 Safari and 52 Firefox LTR rows, mostly shapes like
`739x「value」! end`. Adding emergency breaks inside kinsoku clusters on top of it
fixed 624 Chrome, 1,197 Safari and 993 Firefox LTR metrics, but lost 510, 108 and
200. Chrome's losses are rows that main passes only while unmodeled U+3000
hanging and controls cancel out. ENGINE_FOLLOWUPS.md keeps both.

`bun test` and `bun run check` pass. The baseline advances to `9270621`, and the
ordinary snapshots were regenerated against it; only provenance and environment
records change.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. The Chrome snapshot came from a run that
needed focus retries while the Mac was in use, and its measurement totals moved
as much as its analysis totals. A rerun on an idle Mac read `prepare()` at 9.15 ms
(8.75 on the parent branch), hot `layout()` at 0.0895 ms (0.0885) and corpus
totals at 121.4 ms (119.4), with analysis 3.4 ms slower; #248 removes that cost.
Safari reads 11.5 ms (11.0) and 0.105 ms (0.105), and its corpus total reads
351 ms (351). Under a counting fake canvas, Canvas calls
per cold `prepare()` are unchanged on the 18 long-form corpus texts, and a #225
sample drops from 40 to 31.

## Keep-all runs from generated line-break classes

This runtime change starts from the rich-inline boundaries branch. Keep-all runs
now end where each engine's pair rule and the ordinary line-break rules allow a
break, decided from a generated UAX #14 line-break class table (Unicode 17,
refreshed with `bun run generate:line-break-data`) instead of hand-maintained
class sets. Chrome keeps a pair when both sides are letters or numbers, with a
one-mark lookback. Firefox keeps ICU4X's keep-all class pairs, including LB21a
after a Hebrew letter and HY or BA. Safari still breaks only at spaces. The table
ships as one string literal, and plain keep-all letters skip grapheme
segmentation.

The installed gate ran this branch, merged onto #241, against #241's pin
`8e01c01`: Chrome 153 through the Playwright transport, Safari 26.5.2 and Firefox
155 natively, both directions. Chrome fixes 1090 LTR and 514 RTL metrics and loses
28 and 28 in 8 and 8 curly closing-quote keep-all rows at letter spacing 1.5.
After an emergency break just before the quote, Chrome restarts its ICU context
and doesn't break after the quote; the parent matched only because it lacked the
LB19a rule, so these are accidents. Safari changes nothing. Firefox fixes 617 LTR
and 257 RTL metrics and loses none. No leg has required failures, execution errors
or new API or rich failures.

Headless Chromium 147 sweeps over 270 keep-all texts cut wrong widths from 20,037
to 2,337. Headless Chromium runs ICU 77.1 while installed Chrome 153 runs ICU
78.2, so the HH, LB21a and LB20a families rest on the installed gate and ICU
source. The table adds about 3.1 KB gzip; warm `prepare()` in headless V8 is even
or faster on the chat datasets after the plain-letter fast path.

`bun test` and `bun run check` pass. The baseline advances to `7652cad`, and the
ordinary snapshots were regenerated against it; only provenance and environment
records change.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Chrome reads `prepare()` at 8.75 ms
(9.10 on the parent branch) and hot `layout()` at 0.0885 ms (0.0893); Safari reads
11.0 ms (11.0) and 0.105 ms (0.105). Long-form corpus totals read 119.4 ms in
Chrome (121.2) and 351 ms in Safari (346).

## Rich-inline boundaries in Chrome and Safari

This runtime change starts from the Safari next-line branch pin `1771ab8`.
`prepareRichInline()` treated every item boundary as a break opportunity, while
browsers find breaks in the text their items join. Blink runs one line-break
iterator over the whole inline formatting context. WebKit decides a boundary
from the previous box's last two characters followed by the next box's text, and
finds breaks inside a box from that box's own text. The engine profile's
`inlineItemBreaks` is `'joined-text'` for Blink, `'item-text'` for WebKit and
`'item-boundary'` for Gecko or when no engine is named, which keeps main's
behavior. The line walker can stop at an end cursor as if the text were cut
there, so a carried run measures up to its first joined break. The joined
analysis never puts a break before a NEL control segment (LB6). Ten
`maintained/rich-boundaries` witnesses join the suite. The two exact-fit
witnesses are required in Chrome and Safari and observed in Firefox, where main
fails them.

The installed gate ran this change on `daf13ac` against pinned `e5e66be`, and
again from this branch against pinned `5ba3247`: Chrome 153 through the
Playwright transport, Safari 26.5.2 and Firefox 155 natively, both directions.
Both runs agree. Chrome fixes 7 LTR metrics and Safari 6, all witness rich
heights. RTL and Firefox change nothing. No leg loses a metric or has a new
required, API or rich failure, and nine numeric profiles have no new failures.

Headless replays of installed rich-inline research observations (13,038 LTR rows
per browser) gain 757 Chrome rows and 905 Safari rows. They lose 74 and 31, all
accidents. Chrome shapes a word and its comma across spans (38 rows). On
Hiragino kinsoku rows (32) and at thresholds (4), the flat prediction already
differs from native. In Safari, main's boundary break and emergency split
coincided with WebKit's on numeric signs (27) and quote splits (4). Installed
Firefox measured the joined rule at +768 and -93 rows, including 40 Myanmar
split-word rows lost to Gecko's segmentation, so Firefox keeps main's behavior.

Merging onto #239 also made this branch's end-limited walks return from an unfit
soft hyphen in Chrome, as the continuing text does. When an item boundary cuts a
line right after a chosen soft hyphen, or an overflowing partial unit follows one,
the line now ends at the earlier opportunity instead of painting an overflowing
hyphen. A fuzz over 2,574 rich-inline item splits moved 697 widths, all of them
to match flat text.

`bun test` and `bun run check` pass. After #240 landed, this branch was merged
onto it and gated again in installed browsers against #240's pin `53e16ff`.
Chrome fixes 7 LTR and 0 RTL metrics, Safari 6 and 0, and Firefox 0 and 0.
No leg loses a metric or has required failures, execution errors or new API or
rich failures. The baseline advances to `8e01c01`, and the ordinary snapshots were
regenerated against it; only provenance and environment records change.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Chrome reads `prepare()` at 9.10 ms
(9.05 on the parent branch) and hot `layout()` at 0.0893 ms (0.0887); Safari reads
11.0 ms (11.0) and 0.105 ms (0.105). Long-form corpus totals read 121.2 ms in
Chrome (118.3) and 346 ms in Safari (349); Chrome's total moves mostly with the
Arabic prose row (43.8 ms against 41.2), which varies between runs.

## Safari next-line and tab stops

This runtime change starts from the segment-break removal branch head `daf13ac`.
NEL (U+0085) is UAX #14 class NL: a break follows it and no ordinary break
precedes it. In the WebKit profile, analysis gives each NEL its own control
segment, the walker offers a break after it, and a NEL that overflows right after
text or glue ends the line before that content. WebKit's simple text path gives
NEL no letter spacing, so NEL takes spacing only next to complex text or before a
combining mark. Safari also moves a `pre-wrap` tab to the following stop when
less than half a space would remain before the next one. The profile fields
`breakOnlyAfterNextLine` and `skipNarrowTabStops` key on the layout engine;
Chrome and Firefox keep NEL as ordinary text and the previous tab rule.

The installed gate ran this change on `daf13ac` against pinned `e5e66be`: Chrome
153 through the Playwright transport, Safari 26.5.2 and Firefox 155 natively,
both directions. Safari fixes 627 metrics in 235 LTR rows and 442 in 170 RTL
rows, in the hidden-control spacing, NEL, discretionary and tab families. Chrome
and Firefox change nothing. Each Safari direction loses one row, 3 metrics:
`a\u05D0\u05D1aabb((\u0628\u0628\u0628\u0628\t\tword` in 16px Arial, pre-wrap,
at width 64. Safari moves the first tab to the next stop and hangs both tabs.
Pretext now reaches the same stop but hangs only the first overflowing tab, and
main matched only because its tab stayed at the nearer stop. Three rows per
direction that fail either way change widths only. No leg has required failures,
execution errors or new API or rich failures, and nine numeric profiles have no
new failures. Every leg still exits with an error, because the numeric companion
fails when an unverified profile's tab sizing changes: the iOS Chrome, Edge and
Firefox profiles and iPad desktop mode follow the same WebKit threshold, which
installed Safari verifies.

Headless replays in WebKit 26.4 with the Safari 26.5.2 user agent reproduce the
suite result. On installed research NEL observations they gain 310 LTR and 116
RTL rows and lose 8 LTR rows of `aa\u0085\u2060bb` at 1px, where Safari gives the
word joiner no letter spacing.

`bun test` and `bun run check` pass. After #239 landed, this branch was merged
onto it and gated again in installed browsers against #239's pin `81c0c6a`.
Safari fixes 627 LTR and 442 RTL metrics and loses the same trailing tab-run row per
direction, Chrome and Firefox change nothing, and no leg has required failures,
execution errors or new API or rich failures. The baseline advances to `53e16ff`,
and the ordinary snapshots were regenerated against it; only provenance and
environment records change.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Chrome reads `prepare()` at 9.05 ms
(8.90 on the parent branch) and hot `layout()` at 0.0887 ms (0.0887); Safari reads
11.0 ms (11.0) and 0.105 ms (0.105). Long-form corpus totals read 118.3 ms in
Chrome (120.7) and 349 ms in Safari (348); Chrome's total moves mostly with the
Arabic prose row (41.2 ms against 43.4), which varies between runs.

## Soft-hyphen retreat in Blink

This runtime change starts from the segment-break removal branch head `daf13ac`.
When a selected discretionary hyphen does not fit, Blink retries the text item
against the available width minus the hyphen, so the line ends at the latest
earlier opportunity that leaves room for it. The engine profile's
`unfitHyphenRetreat` is `'reduced-width'` for Blink and `'none'` for WebKit,
Gecko or when no engine is named. `letterSpaceDiscretionaryHyphen` is false only
for Blink, which paints the visible hyphen without letter spacing. For Blink,
`prepare()` records per soft hyphen whether Canvas measures its neighbors
narrower joined than apart, and the walker keeps the overflowing hyphen on a line
with such a soft hyphen. The walker records the latest opportunity that leaves
room for the hyphen when that opportunity is created, and never returns past
text joined to text or a dash inside a segment.

The installed gate ran from this branch against pinned `e5e66be`: Chrome 153
through the Playwright transport, Safari 26.5.2 and Firefox 155 natively, both
directions. Chrome fixes 35 metrics per direction, in 16 rows (10 lineCount, 10
height and 15 source), and loses none: `​a­b` in pre-wrap in four
fonts, `  a­b` and `  ­a­b` in Courier New and Noto Nastaliq
Urdu, and Arabic soft-hyphen rows in Courier New. Safari and Firefox change
nothing. No leg has required failures, execution errors or new API or rich
failures, and nine numeric profiles have no new failures. Predictions also
change on 38 Chrome LTR rows and 3 RTL rows that fail either way. 36 LTR rows
and 1 RTL row move further from native, all with soft hyphens followed by marks
or word joiners: Chrome gives word joiners no letter spacing, and breaks after a
mark that follows a soft hyphen without painting a hyphen.

Headless replays in Chromium 147 and WebKit 26.4 of installed soft-hyphen
research observations gain 802 Chrome LTR rows and 136 RTL rows and lose 79 LTR
rows. 24 are true losses owned by other gaps: letter spacing on U+2060, which
Chrome does not apply (20), and Blink kerning across a space (4). 55 are
accidents, where the base matched the line count by charging a hyphen that Chrome
does not paint: a combining mark after a soft hyphen (43) and a soft hyphen
between word joiners (12). Enabled in WebKit and Gecko, the same rule lost 340
Safari and 80 Firefox research rows, so those engines keep the overflowing
hyphen.

`bun test` and `bun run check` pass. The baseline advances to runtime commit
`81c0c6a`, and the ordinary snapshots were regenerated against it with unchanged
results; only provenance and environment records change.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Against the segment-break removal
branch, Chrome reads `prepare()` at 8.90 ms (9.00) and hot `layout()` at
0.0887 ms (0.0877), and Safari reads 11.0 ms (11.0) and 0.105 ms (0.105). Chrome's
long-form corpus rows are unchanged beyond run spread, and its total moves only with
the Arabic prose row, which read 43.4, 36.0 and 44.7 ms across the three runs.
Safari's total is unchanged. The benchmark
corpora contain no soft hyphens, so these rows don't exercise the retreat itself.

## Newlines next to zero-width spaces

This runtime and harness change starts from the WebKit engine routing branch
head `04293b9`. In `white-space: normal`, Blink and Gecko remove a collapsible
whitespace run containing an LF when a ZWSP immediately precedes or follows the
run; WebKit turns the run into one space. The engine profile's
`segmentBreakRemovalRun` keys on the layout engine: `'blink'` for Blink,
`'gecko'` for Gecko, and `'none'` for WebKit or when no engine is named. Each
engine checks adjacency on its own run. Blink's holds SPACE, TAB, LF and CR.
Gecko's holds SPACE, TAB and LF, continues through SHY and bidi controls without
ending on one, and leaves out a last SPACE before a combining mark. FF is in
neither. `prepare()` removes such a run before the ordinary collapse, and the
rich-inline helper applies the rule within each item's own text.

The harness normalization contract changes in the same commit.
`normalizeSource()` now takes the observed browser and removes the same runs for
Chrome and Firefox, coded independently of the library, so the API
`source-normalization` contract, source placement, the line-extraction text and
normalized native paragraphs follow the observed engine. The previous documented
form turned every such newline into a space, which is WebKit's transformation.
It copied the library's old rule, so in Chrome and Firefox a wrong prediction
and a wrong oracle agreed. Either half alone loses the rows below.

The installed evidence ran this change on the CJK closing-bracket stack
`d1e12b8`, natively in Chrome 153, Safari 26.5.2 and Firefox 155, both
directions. Through its own harness, the full gate against pinned `59bd256`
fixed 20 metrics in each Chrome and Firefox direction, 12 api and 8 source, and
lost none. All of them are `hanging-ZWSP` rows of `a\u200B\nword` in 16px Arial
and 24px Amiri at widths 8, 24 and 40, now normalized as `a\u200Bword` instead
of `a\u200B word`, with unchanged line counts. Safari changed nothing, no leg had
required failures, execution errors or new API or rich failures, and nine
numeric profiles had no new failures. The same candidate judged by that stack's
own harness read 20 lost successes and 12 new `source-normalization` failures in
each Chrome and Firefox direction, and nothing in Safari. Both runs name the
identical rows and metrics. Pinned main passed them only because the old
documented form copied its newline rule, so those losses are a defect in the old
contract, not a regression. In both runs the four width-8 rows per direction
still fail source, now on line placement instead of normalization.

Headless replays in Chromium 147 and WebKit 26.4 with the recorded user agents
and locales ran every row of the WebKit engine routing gate, whose natives were
recorded against `2f15d72`: 656,407 rows over six legs, with the Firefox legs
through a Gecko user agent in Chromium. Pinned `2f15d72` and this change each
ran through this change's harness and through the previous one, and changed rows
were judged against the recorded natives. Only the same 12 `hanging-ZWSP` rows
per Chrome and Firefox direction change. Through this change's harness they fix
12 api and 8 source metrics per direction, with no lost metric or new API
failure; through the previous harness they read as 20 lost successes and 12 new
`source-normalization` failures. Safari changes no prediction, no row errors,
and in every context the two profiles differ only in `segmentBreakRemovalRun`:
`'blink'` in the Chrome legs, `'gecko'` in the Firefox legs and `'none'` in
Safari. Through the previous harness, headless `2f15d72` reproduces all 218,993
recorded Safari predictions and every changed Chrome row. Chromium does not
reproduce Firefox's widths, so the Firefox legs only show which rows change.

`bun test` and `bun run check` pass. Gecko's East Asian newline rules, the
widths of a CR or FF that survives, and context across rich-inline items are not
modeled. The installed gate ran from this branch against pinned `2f15d72`: Chrome through
the Playwright transport, Safari and Firefox natively, both directions. Through
this change's harness, Chrome and Firefox fix 20 metrics per direction (12 api and
8 source), Safari changes nothing, and no leg loses a metric or has a new
required, API or rich failure; nine numeric profiles have no new failures. The
same run from the previous harness with this change as a candidate reads the
identical 12 rows and metrics per Chrome and Firefox direction as 20 lost
successes and 12 new API failures, because that harness normalizes the removed
newline to a space. The baseline advances to runtime commit `e5e66be`, and the
ordinary snapshots were regenerated against it with unchanged results; only
provenance and environment records change.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Against the WebKit engine routing
branch, Chrome reads `prepare()` at 9.00 ms (8.85) and hot `layout()` at
0.0877 ms (0.0887), and Safari reads 11.0 ms (11.0) and 0.105 ms (0.100). Chrome's
long-form corpus rows are unchanged beyond run spread, and its total moves only with
the Arabic prose row, which varies between runs. Safari's total moves by -0.3%.

## WebKit engine routing

This runtime change starts from the line-edge kerning branch head `9535bc6`.
Engine profiles now follow the layout engine the user agent names instead of a
browser brand: `Firefox/` names Gecko, `AppleWebKit/537.36` names Blink only
beside `Chrome/` or `Chromium/`, and any other `AppleWebKit/` version names
WebKit. `navigator.vendor` is no longer read, since workers don't have it. Every
profile field keys on that engine, including the following-space kerning, so
Chrome, Firefox and Edge on iPhone and iPad and in-app web views take the Safari
profile, and a page and its workers take the same profile. Before, Safari's
workers and app web views took the default profile, and the three iOS brands
took it with WebKit's hyphen rule after a collapsed tab and, for Chrome, Blink's
CJK carry.

Headless replays in WebKit 26.4 and Chromium 147 with the recorded user agents
and locales compare `8b1f538` with this change on every row of the line-edge
kerning gate: 147,714 Chrome LTR, 71,008 Chrome RTL, 148,019 Safari LTR, 70,974
Safari RTL, 147,680 Firefox LTR and 71,012 Firefox RTL rows, 656,407 in all,
with the Firefox legs through a Gecko user agent in Chromium. No prediction
changes and no row errors, both sources give the same in-page profile in every
context, and in the Safari legs headless `8db5483` reproduces all 218,993
recorded installed predictions. The same replay over the CJK closing-bracket
stack, before the kerning change, changed no prediction either.

In headless WebKit 26.4 over the CJK closing-bracket stack, user agents for
Chrome, Firefox and Edge on iPhone, Chrome on iPad in desktop mode, and app web
views on iPhone and Mac give the desktop Safari profile on every field; on this
branch, iOS Safari and Chrome and Firefox on iPhone equal desktop Safari on all
12 fields. Over that stack and judged against the Safari 26.5.2 natives, an
iPhone Chrome user agent changed 28,564 of the 218,993 Safari rows: 8,055 rows
gain a check and 1,427 lose one. An iPhone Firefox user agent changed 28,783,
with 8,114 gains and the same 1,427 losses. Every candidate prediction under
both user agents equals the desktop Safari user agent's, so each loss is a row
the Safari profile already fails in Safari. The crios, crios-desktop, fxios and
edgios numeric profiles now equal safari's, and `tabSizing` is unchanged in all
nine.

A probe outside the suite ran each user agent in a window and in classic blob,
classic URL and module dedicated workers: 51 user agents over the CJK
closing-bracket stack, and on this branch desktop Safari, iOS Safari, Chrome and
Firefox on iPhone, desktop Chrome and the Firefox user agent. In every row the
workers give the window's engine, profile and lines, and no worker exposes
`navigator.vendor`. With `8b1f538`, Safari's and iOS Safari's workers differed
from their windows on 6 fields, and `A\u2060 B` in 18px Times New Roman at width
12 took three lines in a Safari worker and two on the page.

Desktop Safari's natives stand in for iOS, and nothing ran on a device, so iOS
fonts, older iOS ICU and iOS WebKit builds are unverified. Blink emulating an
iOS user agent, as in developer tools, now takes WebKit's profile on the page
and in its workers while Chromium lays out the text. Samsung's Tizen 3.0 TV web
view runs Chromium 47 but sends `AppleWebKit/538.1`, so it takes WebKit's
profile; it predates `Intl.Segmenter`. Shared and service workers were not
probed.

`bun test` and `bun run check` pass. The installed gate ran from this branch against pinned `8b1f538`: Chrome through
the Playwright transport, Safari and Firefox natively, both directions. Every leg
has zero fixed or lost metrics, required failures, execution errors or new
API/rich failures, and nine numeric profiles have no new failures. The baseline
advances to runtime commit `2f15d72`, and the ordinary snapshots were
regenerated against it with unchanged results; only provenance and environment
records change.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Against the following-space kerning
branch nothing moves beyond run spread: Chrome reads `prepare()` at 8.85 ms (8.85)
and hot `layout()` at 0.0887 ms (0.0885), and Safari reads 11.0 ms and 0.100 ms.
The long-form corpus totals move by -1.2% in Chrome and +2.0% in Safari.

## Kerning measured with the following space

This runtime change starts from the line-edge kerning head `9535bc6`, where
each distinct word before a space was measured again together with that space.
The Safari profile now measures such a word together with the space in place of
the word alone, and takes the word's width as that measurement minus a space
alone; the breakable fit advances use it as the last prefix. A word is still
measured alone where Safari's prefix fit widths need it inside a longer word,
where it also occurs before other text, in numeric runs and runs above 96
graphemes, whose fit advances come from pairs, or with a zero-width break before
the space. The widths are unchanged, and the Chrome and Firefox profiles are
untouched. None of the checks below ran in installed browsers, and the baseline
pin and snapshots were not rerun for this change.

In headless WebKit 26.4 with a Safari user agent, one cold `prepare()` makes
1,347 more Canvas calls than `bf93e2e` on `ar-risalat-al-ghufran-part-1`, where
`9535bc6` makes 8,825 more, 2,669 on `en-gatsby-opening` (8,439), 278 on
`hi-eidgah` (1,593), 207 on `ur-chughd` (1,008), 251 on
`he-masaot-binyamin-metudela` (1,694) and 209 on `ko-unsu-joh-eun-nal` (342).
That removes 84.7% of `9535bc6`'s extra calls on the Arabic corpus, 68.4% on
`en-gatsby-opening` and 82.5% on `hi-eidgah`. The numeric API checks make 858
Safari-profile Canvas calls instead of 861 at `9535bc6` and 850 at `8db5483`,
with no failures; the Chrome profile makes 777 in all three.

Segment widths and breakable fit advances equal `9535bc6`'s exactly on 2,646,919
segments of 89 corpus and font rows in headless WebKit, including fonts that
kern with a space. In 17 further font strings, with bold, italic, other weights
and odd sizes, in normal and pre-wrap text, the widths, line-end advances and
fit advances of 6,175,437 segments are bit-identical, 78,476 of them kerned, and
a Bun fuzz with a context-dependent fake canvas finds no difference in 3,000
random texts. A headless replay against the installed natives of the #236
gate, through that gate's harness, with the Safari legs in WebKit 26.4 and the
Chrome and Firefox legs in Chromium 147 with their user agents, predicts exactly
as `9535bc6` on every row of all six legs: 148,019 and 70,974 Safari rows,
147,714 and 71,008 Chrome rows, and 147,680 and 71,012 Firefox rows. Against
`8db5483` the change fixes the same 433 LTR and 402 RTL Safari rows as the
installed gate and loses none.

Native line counts in headless WebKit with a Safari user agent, on LTR and RTL
pages at every width step, cover the corpus rows in their fonts, the benchmark
font, 14 rows in fonts that kern with a space, the Arabic corpus in Waseem, the
Urdu corpus in Noto Nastaliq Urdu and short kerned texts: 62,298 points. The
change gives the same line count as `9535bc6` at every point. Against `bf93e2e`
both match native at 4,816 more points and 35 fewer: the Arabic corpus in 20px
system-ui matches at 601 of 601 widths instead of 507, `hi-eidgah` at 601
instead of 526, and `en-gatsby-opening` in 16px PT Sans at 580 instead of none.
The 35 are short texts in 16px Fira Code and a few widths in Arial, Times New
Roman, Avenir Next, PT Sans and system-ui. Sweeps from 300 to 900px in steps of
3, in fonts outside those rows, again match `9535bc6` at every point and show
the same kind of loss: `en-gatsby-opening` in italic 18px Times New Roman matches
native at 195 of 201 widths instead of 166 but loses 369 and 474px, in 17px
Hoefler Text at 192 instead of 177 but loses 300 and 318px, and `mixed-app-text`
in italic 16px Gill Sans at 200 instead of 188 but loses 462px. At 0.25px steps,
`A B` loses 3 widths and `L B` 2 in both Fira Code and Monaspace Neon.

Timings in headless WebKit with a Safari user agent run `bf93e2e`, `9535bc6`
and this change in five rounds, each in a fresh context with the order rotated,
at load averages 4.5 to 7.6. The first cold `prepare()` of the benchmark's
Arabic corpus takes 158ms, where `bf93e2e` takes 138ms and `9535bc6` 196ms;
`en-gatsby-opening` takes 96ms (95 and 98), `hi-eidgah` 29ms (26 and 38) and
`he-masaot-binyamin-metudela` 17ms (17 and 20). Preparing every paragraph of a
corpus once in a fresh page, as virtualization does, takes 163ms for the Arabic
corpus (148 and 207), 88ms for `en-gatsby-opening` (86 and 99) and 29ms for
`hi-eidgah` (26 and 37): 15, 2 and 3ms more than `bf93e2e`, where `9535bc6` adds
59, 13 and 11ms. Repeated `clearCache()` and `prepare()` of the same text in one
page take more prepares to become cheap, but it is not a lasting cost. At load
averages 1.1 to 3.1, `hi-eidgah` takes 23ms at prepares 16 to 20 and 7ms at 36
to 40, where `bf93e2e` takes about 6ms, and `he-masaot-binyamin-metudela` takes
14ms, then 6ms. WebKit's per-font width cache samples its input after a run of
misses, so it admits this change's strings later. After five prepares,
measuring each distinct string 25 times on preparation's own context, with no
Pretext JavaScript running, brings the next prepares to 6 to 7ms and 5 to 6ms,
and in converged prepares the time inside `measureText` is 0 to 3ms for
`bf93e2e`, `9535bc6` and this change alike. Headless Chromium 147 does not
change.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Chrome is unchanged against the CJK
closing-bracket branch: `prepare()` reads 8.85 ms (8.90), hot `layout()` 0.0885
ms, and the corpus totals move by -0.2%. Safari's hot `layout()` stays at 0.100
ms and `prepare()` reads 11.0 ms (10.0). Its long-form corpus measurement grows by
11.4% and its prepare totals by 8.2% (316 to 342 ms), from the remaining
word-plus-space measurements: Arabic prose 120 to 133 ms, Hindi 21 to 25 ms, Urdu
30 to 34 ms and Thai 21 to 23 ms.

## Kerning with a following space

This runtime change starts from the CJK closing-bracket branch head `bf93e2e`.
WebKit measures a text item together with a directly following U+0020 and
subtracts one unshaped space, so the item keeps its kerning with that space
whether the space continues the line or hangs. The Safari profile now measures
each word before a space the same way at letter spacing 0 and caches the
kerning with the word's metrics; zero-width breaks before the space belong to
the word. Format characters between the word and the space resolve with the
space, so the kerning crosses them only when the text has no explicit bidi
controls and the neutral characters after the space lead to a character of the
word's direction, with no paired bracket among them. The generated bidi data
now lists the paired brackets from `BidiBrackets-17.0.0.txt`. A soft hyphen
before the space takes no kerning. The Chrome and Firefox profiles are
unchanged.

The full native comparison ran this change with the #234 harness in installed
Chrome 153.0.8010.36, Safari 26.5.2 and Firefox 155.0.1, both directions, at
DPR 2: 656,407 browser/input observations, with pinned `8db5483` as the
reference. Every leg has zero lost successes, failed required checks, execution
errors and new API/rich failures, and 45 numeric source/profile runs have no
new failures. The Safari numeric profile makes 861 Canvas calls instead of 850;
the other profiles are unchanged. The change fixes 493 Safari LTR metrics on
433 inputs and 454 RTL metrics on 402 inputs, and none in Chrome or Firefox:
line count, height and source on 28 LTR and 24 RTL inputs, and widths on 409
and 382. LTR gains 336 metrics in `following-space-scope`, 71 in
`following-space-context`, 41 in `space-context`, 27 widths in `spacing-tail`
and 18 in `negative-space`; RTL gains 336, 71 and 47 in the first three. Every
gain is in 16px Arial or 16px or 18px Times New Roman at letter spacing 0. For
example, `A\u2060 B` in 18px Times New Roman at width 12 now takes Safari's
two lines instead of three, `\u05D0\u05D1 A \u0628` in 16px Arial at width 48
one line instead of two, and pre-wrap ` A B` in 16px Arial at width 10 three
lines instead of four. Twelve LTR and 13 RTL width failures change only in
detail: two keep-all `A \u4E2D\u6587\u6D4B\u8BD5` inputs in 18px serif go from
0.777px wider than native to 0.207px narrower, and the rest move by less than
0.00001px.

Reported line widths are clamped at 0, while line breaking keeps the signed
advance. For example, `A\u2060 B` in 18px Times New Roman at width 11.5 puts `A`
alone on the first line, and the second line, the word joiner and the space,
has an advance of -0.993: the kerned word minus the isolated `A`. WebKit leaves
that remainder unclamped; in the suite's Safari rows at widths 1 and 8 the
prediction has the same line, and native Safari draws it 0.993px outside the
line's start edge. Strongly negative letter spacing clamps the same way.

The `rich-boundary-space` contract compared a collapsed gap with the width of a
line holding one space; it now compares both clamped at 0, and a unit test
checks the signed gap against the measured space. A headless replay in WebKit
26.4 and Chromium 147 against the gate's natives, with the unclamped change as
the base, covers every row whose text has a word followed by a space and every
row with a negative predicted width: 37,801 Safari LTR, 21,232 Safari RTL,
37,899 Chrome LTR and 21,210 Chrome RTL rows. Only the negative widths change,
on 2,983, 373, 3,008 and 285 rows; no line count, height, widths or other
metric changes. Under the gate's harness the only rich contract that changes is
`rich-boundary-space` at letter spacing -6 and -10, which the updated contract
accepts, and the nine numeric profiles give identical results.

Headless Chromium 147 and WebKit 26.4 probes outside the suite show what
remains. Without the paragraph direction, the Safari profile drops the kerning
across a soft hyphen, and across format characters before right-to-left text or
a bracket pair, where Safari on an LTR page keeps it. With letter spacing,
WebKit's measurement also moves the space's gap onto the word and clamps the
word at zero, which the per-grapheme gap model does not represent, so
letter-spaced text keeps the unkerned widths. A trailing collapsible space, a
rich-inline item that ends in a space, and CR or CRLF after a word miss the
kerning. Chromium kerns across spaces, ZWSP, SHY and same-font spans, which its
default Canvas does not report, and after an emergency break Gecko keeps a share
of a pair adjustment that Canvas sums cannot attribute.

The baseline advances to runtime commit `8b1f538`, and the ordinary snapshots
were regenerated against it: all six legs pass with zero new regressions,
required failures or execution errors, and nine numeric profiles have no new
failures. Snapshot results are unchanged; only provenance and environment
records change. Suite hash
`7681f371b59384fb346e2b15c5d469da2a30ce9673f5c05ef2cf9a64a3894d3d`; rows are in
`/private/tmp/pretext-eng-20260912/gate-g1b`.

## CJK closing brackets and nonstarters

This runtime change starts from the pair-table branch head `f030304`. Fullwidth
closing brackets such as U+300D and U+FF09 are UAX #14 CL, and Chrome breaks
between them and a following ideograph, kana or Hangul syllable. The Chromium
profile carried CJK text after those brackets as it does after closing quotes; it
now carries only after quotes (QU). That carry had also hidden CJK line-start
prohibitions missing from `kinsokuStart`. The set now holds every code point in
Pretext's CJK ranges whose class forbids a break before it (CL, EX, NS and the
non-extending CM U+3035), 17 more than before, and a piece whose first code point
is in the set attaches to the preceding CJK text even when `Intl.Segmenter` joins
it with the kana after it. Under `keep-all`, a listed letter such as U+3005 or
U+30FC no longer ends a run in the Chromium profile, as in Blink, while the
Firefox profile still breaks after NS letters, as ICU4X does.

The same full native comparison ran this change alone and stacked on the two
previous changes, in installed Chrome 153.0.8010.36, Safari 26.5.2 and Firefox
155.0.1, both directions, at DPR 2: 656,407 browser/input observations, with
pinned `14d92ca` as the reference. There are zero lost metrics, failed required
checks, execution errors and new API/rich failures, and nine numeric profiles
have no new failures. Over the pair-table stack it gains 56 Chrome LTR metrics:
line count and height of 28 `maintained/corpus` cases, whose line counts now
match Chrome's. They are `zh-zhufu` at widths 220, 230, 240, 250, 260, 270, 280,
340, 370, 380, 390, 430, 470, 580, 680, 690, 770 and 790, `zh-guxiang` at 220,
250, 280, 370, 430, 590 and 620, `ja-rashomon` at 240 and 290, and
`ja-kumo-no-ito` at 230. No other leg changes, and the three-change stack's fixed
metrics are exactly the union of each change's own.

Headless Chromium 147 and WebKit 26.4 sweeps outside the suite show what remains.
Chromium hangs U+3000 at a line end; the old carry matched that after a bracket
only by measuring `\u300D\u3000` as one unit, so those widths need a hanging model
for U+3000. Below a kinsoku cluster's width, browsers break inside the cluster,
while Pretext keeps it whole, as main already does for `\u6F22\u3002\u5B57`.
Chromium's rules for Chinese pages allow a break before U+301C and U+30A0, and
Pretext does not read the page language for line breaking. Under `keep-all`, Blink
breaks between a listed letter and a following opening bracket
(`\u4E2D\u6587|\u3005|\u300C\u4E2D|\u6587`), while Pretext decides a keep-all boundary
only from the text before it and keeps them together. U+30FC keeps the
whole-piece rule, because Chromium breaks before it and WebKit does not.

The baseline advances to runtime commit `8db5483`, and the ordinary snapshots
were regenerated against it: all six legs pass with zero new regressions,
required failures or execution errors, and nine numeric profiles have no new
failures. Accuracy results are unchanged. Chrome's step-10 corpus sweep now
matches 28 more widths: `zh-zhufu` 43 to 61, `zh-guxiang` 54 to 61,
`ja-rashomon` 55 to 57 and `ja-kumo-no-ito` 56 to 57. Suite hash
`48fb18fba603a2ae669a5a18af334503009a3c0555c4a07201f05ee84cfae9d1`; rows are in
`/private/tmp/pretext-eng-20260912/stage1b-full`.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Against the pair-table branch, Chrome
reads `prepare()` at 8.90 ms (8.70) and hot `layout()` at 0.0885 ms (0.0893), and
Safari reads 10.0 ms (11.0) and 0.100 ms. The long-form corpus totals move by
-1.2% in Chrome and +0.3% in Safari. The Japanese and Chinese corpora gain
segments from the new CJK units, such as zh-zhufu from 7,944 to 7,992, with
unchanged line counts.

## Exclamation followers, joiners and word-initial hyphens

This runtime change starts from the figure-space branch head `b55311e`. Chrome
and Safari look up characters up to U+00FF in a pair table that follows ICU except
for printable ASCII, where `?` breaks before everything except
`! " ' ) , . / : ; ? ] }`, and `!` breaks only before `(`, `<`, `[` and `{`. Every
merge that could join across that boundary now asks the same rule, so `x?|$b`,
`x?|-|b` and `x!|\u00A9b` break as in Chrome and Safari, while Firefox keeps
`x?-|b`. Above U+00FF the follower's line-break class decides, CJ such as U+30FC
breaks after EX only in Chrome, and U+061B ARABIC SEMICOLON now breaks before a
word as EX. No break follows a ZWJ at the text start or after a ZWSP, TAB or hard
break (LB8a). In Chrome and Safari, a hyphen after a space, ZWSP, hard break or
the text start keeps a following alphabetic or Hebrew letter (LB20a), and the
other Unicode 17 HH dashes such as U+2012 and U+2013 do the same as U+2010.
Without a navigator, the default profile keeps the same letters. Analysis no
longer calls `Intl.Segmenter` `containing()`, which JavaScriptCore gets wrong at
an index just before a surrogate pair.

The same full native comparison ran this change alone and stacked on figure space
glue, in installed Chrome 153.0.8010.36, Safari 26.5.2 and Firefox 155.0.1, both
directions, at DPR 2: 656,407 browser/input observations, with pinned `14d92ca` as
the reference. There are zero lost metrics, failed required checks, execution
errors and new API/rich failures, and nine numeric profiles have no new failures.
Over figure space glue, the stack gains 21 metrics in Chrome LTR and 9 in RTL, 24
and 12 in Safari, and none in Firefox. Its fixed metrics are exactly the union of
each change's own, so the two do not interact. The gains are `!!!!<<aabb`, where
`!` now breaks before `<`, in four LTR `ascii-matrix` cases and three
`signed-spacing/ascii-matrix` cases per direction, and pre-wrap
`\u200D\u0628\u00AD\u0628` in `U+200D/start`: 16px Amiri at width 14.75 in both
directions, plus 16px Noto Naskh Arabic at width 12.42 in Safari. The installed
full gate was rerun on the revision that keeps Hebrew letters in Chrome and the
other HH dashes in both engines, against pinned `fd54445`: the same 21/9, 24/12
and 0 metrics are fixed, with zero lost metrics and no numeric failures. On the
installed research rows for these shapes, the revision fixes 964 LTR and 430 RTL
rows in Chrome and 432 and 160 in Safari over the previous revision, and loses
only the two Chrome pre-wrap rows described below, which the previous revision
matched by breaking in the wrong place.

Headless Chromium 147 and WebKit 26.4 sweeps outside the suite lose shapes that
main matched only through a second error. In `https://x.com/p?-a`, browsers break
after both `?` and `-`; the new break after `?` starts the URL query unit there,
and the unit keeps `-a` (45 of 159 widths per mode). In pre-wrap `a\t -\u0430b` at
widths 10 to 14, browsers hang the preserved space after the TAB, while Pretext
now gives it its own line. Chromium also breaks after the hyphen of a rich item
`\u2010bar baz` after `foo`, because its ICU context crosses items. Headless
Chromium 147 runs ICU 77 and breaks after a word-initial hyphen before a Hebrew
letter, but installed Chrome 153 keeps Hebrew letters and each HH dash observed,
as Safari 26.5.2 does: U+2010, U+2012, U+2013, U+058A, U+05BE, U+1400 and
U+2E17. No installed browser was observed on U+2E40, U+2E5D, U+10D6E or
U+10EAD; for those Pretext rests on ICU 78 data and headless WebKit. In the
installed research rows of `a \u2012b`, `a \u2013b`,
`a \u058A\u0561b`, `a -\u05D1b`, `a \u2010\u05D1b` and `a \u2013\u05D1b`, both
browsers keep the dash with the letter wherever the two fit, while the previous
revision broke after it in 1,165 Chrome rows and 538 Safari rows. Firefox breaks
after each of those dashes.

A headless replay of this revision against the recorded installed natives, with
the previous revision as the base, covers every suite row with U+002D or an HH
dash: 1,034 Chrome, 1,034 Safari and 1,028 Firefox rows, in Chromium 147, WebKit
26.4 and Chromium with a Firefox user agent. No prediction changes there. On the
research rows it fixes all 1,165 Chrome and 538 Safari band rows and changes
nothing on U+2E17, U+1400 or U+05BE. It loses two Chrome rows, pre-wrap
`a \u2010\u05D1b` at letter spacing -1 and widths 8 and 8.5: browsers hang the
preserved space after `a`, and Pretext now gives it its own line, as it already
does in Safari.

The baseline advances to runtime commit `09c7f20`, and the ordinary snapshots
were regenerated against it: all six legs pass with zero new regressions,
required failures or execution errors, and nine numeric profiles have no new
failures. Snapshot results are unchanged; only provenance and environment records
change. The stacked gate's suite hash is
`48fb18fba603a2ae669a5a18af334503009a3c0555c4a07201f05ee84cfae9d1`, with rows in
`/private/tmp/pretext-eng-20260912/stage1b-full`; the revision gate's is
`31db9695b8a03843670809f12a13c9af6cb5b632147f05191e3441dacaece5a3`, with rows in
`/private/tmp/pretext-eng-20260912/gate-233rev`.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Against the figure-space glue branch,
Chrome reads `prepare()` at 8.70 ms (8.80) and hot `layout()` at 0.0893 ms
(0.0878), inside its run spread, and Safari reads 11.0 ms and 0.100 ms, unchanged.
The long-form corpus totals move by +1.3% in Chrome and +1.0% in Safari. The
Arabic prose row reads 120 ms in installed Safari (118 before), so the warm split
seen in Playwright's WebKit build doesn't appear there.

## Figure space glue

This runtime change starts from the attached-generator-canvas branch head
`6b8929d`. U+2007 FIGURE SPACE is UAX #14 class GL, like NBSP and NNBSP, and
every engine keeps the text on both sides of it together. Pretext classified it
as plain text, so `Intl.Segmenter`'s word boundaries around it became break
opportunities. It now joins adjacent text as glue.

The full shared inventory ran with that harness in installed Chrome
153.0.8010.36, Safari 26.5.2 and Firefox 155.0.1, both directions, at DPR 2:
656,407 browser/input observations, with pinned `14d92ca` as the reference.
There are zero lost metrics, failed required checks, execution errors and new
API/rich failures, and nine numeric profiles have no new failures. The candidate
gains 190 metrics in Chrome LTR and 150 in RTL, 210 and 170 in Safari, and 210
and 164 in Firefox. Every gain is a `hanging-FIGURE` case (40 per direction in
Chrome, 44 in Safari and Firefox) or one of 12 LTR `unicode-space` cases, on
`a\u2007\u2007b`, `a\u2007?b`, `foo\u2007bar`, `a\u2007\u2018b` and
`\u05D0\u05D1((tail\u2007word`. For that last text at 24px Amiri and width 40,
Chrome in both directions and Firefox RTL gain line count and height in four
modes while the line text still differs. The bidi-opener carry owns that
difference, so a later fix there could read as a loss against a pin that
includes this change.

Out of suite, headless Chromium 147 and WebKit 26.4 probes show the NBSP glue
model's existing gaps next to U+2007: a dash or soft hyphen before glue, CJK
beside glue, and glued emoji, symbol or non-word digit runs that get no emergency
breaks. RESEARCH.md records them.

The baseline advances to runtime commit `fd54445`, and the ordinary snapshots
were regenerated against it: all six legs pass with zero new regressions,
required failures or execution errors, and nine numeric profiles have no new
failures. Snapshot results are unchanged; only provenance and environment
records change. Suite hash
`48fb18fba603a2ae669a5a18af334503009a3c0555c4a07201f05ee84cfae9d1`; rows are in
`/private/tmp/pretext-eng-20260912/stage1b-full`.

Chrome and Safari benchmark snapshots were refreshed from this branch: three
foreground runs each at DPR 2, visible and focused, with Chrome on the 2560x1440
screen and Safari on the 1440x2560 screen. Hot `layout()` reads 0.0878 ms in
Chrome and 0.100 ms in Safari, as on main. `prepare()` reads 8.80 ms in Chrome
(8.55 on main) and 11.0 ms in Safari (10.0), inside Chrome's run spread and
Safari's 0.5 ms timer steps, and the long-form corpus totals move by +4.1% in
Chrome and +0.3% in Safari.

## Attached generator canvas

This test-only change starts from published main `20ad703`. The case generator
measured width recipes with a detached canvas, which ignores `<html lang>` in all
three browsers: Chrome and Firefox measure in the machine language, and Safari
passes no language, so its fallback follows the machine's preferred languages. It
now measures with a hidden canvas attached to the fixture page, so recipe
thresholds use the page language that paragraphs without their own `lang`
inherit. Explicit-language recipes still reuse those widths. Runtime sources and
the baseline pin are unchanged.

The recorded no-language, `en`, `ja`, `zh-Hans` and `ko` fixture runs generated
identical IDs. Selected by origin, each browser has 3,635 LTR recipe rows, 3,322
of them with measured widths, and 144 RTL recipe rows, all measured. Comparing
their natives on pages without a language and under `en` shows which thresholds
the old canvas missed:

- Firefox paints `Ⅷ` at 27.53px under `en`, but at 16px without a language and
  under `ja` or `zh-Hans`, and the detached canvas measured 16px. The 55%, 80%
  and natural-width-plus-one `Ⅷ%` thresholds (16.63, 24.19 and 31.23px) therefore
  described a `zh-Hans` paragraph; under `en` even the natural-width-plus-one
  paragraph wraps to two lines. As a methodology correction, the change replaced
  six LTR observations that main passed, each with two native lines:
  `wrap-eadf3c82cdbb9ece`, `wrap-74fcdac0799992cc` and `wrap-9181306059a20016` in
  normal whitespace, and `wrap-6639f89b6eb01e63`, `wrap-179b7d018231d861` and
  `wrap-176497a1d936cb3b` in `pre-wrap`. Main and candidates share the generated
  inventory, so the comparison cannot report them as lost. Installed Firefox 155's
  attached canvas returns about 41.77px for `Ⅷ%` under `en`, so the replacements
  use about 22.97, 33.41 and 42.77px: `wrap-b7ffe298cc61c6f0`,
  `wrap-5a0227e23cc7c1b2` and `wrap-5a08270ecc4ea094` in normal whitespace, and
  `wrap-70e339a94111979d`, `wrap-36cf587b7f499adf` and `wrap-8691b11fca22d5b9` in
  `pre-wrap`. Their native paragraphs have two, two and one lines, as the
  recorded `en` painted widths predicted, and main passes every observed metric
  on all six.
- In Chrome, 205 measured LTR rows and 17 measured RTL rows paint differently
  under `en` than under the Chinese app language, and 64 and 9 of them change
  line count. All of them contain curly quotes, and no painted glyph width
  changes, so their thresholds and IDs did not move. Safari paints every recipe
  row the same under both. Headless Chromium 147 resolves `Ⅷ` under `en` to a
  wider fallback and moves the corresponding six `Ⅷ%` rows, but installed Chrome
  paints no such difference.

Empty element language remains a reset input. In the recorded runs, Chrome
resolves `lang=""` to its Chinese app language: in the 15 groups where `en` and
`zh` differ, it matches `zh`, and four of those differ in line count.

The full shared inventory ran with this harness in installed Chrome
153.0.8010.36, Safari 26.5.2 and Firefox 155.0.1, both directions, at DPR 2:
656,407 browser/input observations, with pinned `14d92ca` as the reference.
Relative to the previous full comparison, case IDs are identical in Chrome,
Safari and both RTL legs, and Firefox LTR replaces exactly the six observations
above. The runtime at `20ad703` fixes and loses no metric. There are zero failed
required checks, execution errors and new API/rich failures, and nine numeric
profiles have no new failures. Suite hash
`48fb18fba603a2ae669a5a18af334503009a3c0555c4a07201f05ee84cfae9d1`; rows are in
`/private/tmp/pretext-eng-20260912/stage1b-full`.

The ordinary snapshots were regenerated from this commit: all six legs pass with
zero new regressions, required failures or execution errors, and nine numeric
profiles have no new failures. Snapshot results are unchanged; only provenance
and environment records change.

## Page-language measurement context

This runtime change starts from published main `efa958a`. Chrome's OffscreenCanvas
re-resolves a font under the page language only when the font string changes, so
after `<html lang>` changed, a reused measurement context and its cached widths
kept the previous language even after `clearCache()`. Preparation now replaces the
context and clears width caches when the document language differs from the one
the context was created under.

Suite pages never change language, so the full native comparison against pinned
`14d92ca` changes nothing: installed Chrome, Safari and Firefox, both directions,
DPR 2, 656,407 observations, zero fixed or lost metrics, required failures,
execution errors and new API/rich failures, and nine numeric profiles have no new
failures. That run used the candidate before a null guard for documents without a
root element was added; suite pages never reach that guard. Headless Chromium 147
reproduces the fix on a language switch (`<html lang>` en → ko with an unchanged
font string: 3 → 2 lines, matching the DOM), and headless WebKit is unchanged. The
pin stays at `14d92ca` because no suite result changes. Suite hash
`edf54ed053d7e1c0ef387ffcade551a22dfb6508440215746abb388d29245c30`; rows are in
`/private/tmp/pretext-gallery-fixes-20260911/staleness-full`.

The ordinary snapshots were regenerated from this commit: all six legs pass with
zero new regressions, required failures or execution errors, and nine numeric
profiles have no new failures. Snapshot results are unchanged; only provenance
and environment records change.

Chrome and Safari benchmark snapshots were refreshed from this checkout: three
foreground runs each, with matching environments at DPR 2 on the 2560×1440 screen,
visible and focused. Hot `layout()` reads 0.0875 ms in Chrome (0.0878 before) and
0.105 ms in Safari (0.1025); preparation and rich rows stay within noise.

## English fixture pages

This test-only change starts from published main `a4f17ed`. Fixture pages had no
document language, so Chrome and Firefox followed the macOS preferred language
while Safari used root rules. They now use `en`. Runtime sources and the baseline
pin are unchanged, so no runtime benchmark was needed.

Full native comparisons ran with fixture pages in no language, `en`, `ja`,
`zh-Hans` and `ko`, on a Mac whose preferred languages are Chinese then English:
installed Chrome, Safari and Firefox, both directions, DPR 2. Case IDs were
identical in every run, and installed-context pages did not change. Relative to
no language:

- Chrome equals `zh-Hans` exactly. `en` changes 428 results, all curly-quote
  breaks. Pretext's Canvas widths do not change; it now matches 319 of those
  results and misses 109 it previously matched.
- Safari equals `en` exactly.
- Firefox is close to `zh-Hans`. `en` changes 779 results through
  missing-glyph fallback widths.

`ja`, `zh-Hans` and `ko` also change fallback widths, and Safari breaks around
curly quotes differently under `ja`. Safari's OffscreenCanvas never follows the
page language. Two paths still follow the machine language: Chrome treats an
element's `lang=""` like no language, and the case generator's detached canvas
ignores `<html lang>` in Chrome and Firefox.

The final harness passes all six legs with zero regressions, required failures or
execution errors, and nine numeric profiles have no new failures. Its 656,407 rows
are identical to the `en` comparison run. Regenerated snapshots change only
provenance and environment records. Suite hash
`edf54ed053d7e1c0ef387ffcade551a22dfb6508440215746abb388d29245c30`; rows are in
`/private/tmp/pretext-locale-20260911`.

## Exclamation breaks and leading ZWSP marks

Runtime commit `14d92ca` starts from the leading-ZWSP branch head `fdb7f01`.
UAX #14 breaks after EX punctuation such as `?`, `!`, U+061F and U+06D4 before a
following letter or number. Every engine keeps that break, except where the
Chromium and WebKit Latin-1 pair tables keep `!` with a following printable ASCII
character. The forward carry and the no-space join now keep it for punctuation
with no text before it. Safari also keeps a basic combining mark with a ZWSP that
starts its text node or follows a mandatory break. Rich-inline items prepare their
own text, so a collapsed leading SPACE remains break context.

The full shared inventory ran in installed Chrome, Safari and Firefox, both
directions, at DPR 2: 656,407 browser/input observations, with pinned `6ad8409`
as the reference. There are zero lost metrics, failed required checks, execution
errors and new API/rich failures, and nine numeric profiles have no new failures.
The candidate gains 78 metrics in Chrome, 60 in Safari and 100 in Firefox. The
suite hash is `5bb6eadf9109541475c5d6fb8004a7595756e21ddb070226215ec23e267fef07`;
rows are in `/private/tmp/pretext-210-followers-20260911/full-v4-vs-step1`.

A separate research family of 4,923 inputs per browser checked the engine rules
directly (`probe-followers4` in the same directory): non-ASCII followers after `!`,
ASCII symbols after `?`, Arabic question marks and full stops, Firefox mid-word
`!`, Safari marks after a leading SPACE, TAB, LF or CR, rich items, U+201D under
zh-Hans, ja and en, and letter spacing. Relative to `6ad8409` it fixes 356 Chrome,
462 Firefox and 566 Safari line counts, with no new API failures. It loses 20
research rows:

- Safari `\u200B\u0301ab` at letter spacing 2, widths 27–28.5: the glued ZWSP owns a
  spacing gap the browser does not add.
- Safari pre-wrap `x\u000D\u200B\u0301ab` at widths 3–7.5: the mark stays with the
  ZWSP natively, but the raw CR's separate native line is the existing raw-CR
  limitation.
- One RTL width each of `\u0623\u0645\u0648\u0646!!\u0648\u0644\u0642\u062F` in Chrome and Safari: the new break is native,
  but isolated emergency widths of joined Arabic letters exceed the box.

Excluding default-ignorable characters from letter spacing matched native gap
counts more often, but it lost 73 supported cases in the full comparison,
including a required Firefox control case, so it is not part of this change.
Firefox's ZWSP-plus-cluster-extender grouping and U+201D locale tailoring remain
unmodeled.

After reviewing these per-case changes, the baseline advances to `14d92ca`.

The ordinary snapshots were regenerated against that pin. All six legs pass with
zero new regressions, required failures or execution errors, and nine numeric
profiles have no new failures. Accuracy and letter-spacing results are unchanged.
In the step-10 corpus sweep, the Urdu `ur-chughd` text now matches at all 61 widths
in every browser (57 before), and the Arabic `ar-risalat-al-ghufran-part-1` text at
all 61 widths in Chrome and Safari (60 before): `!` now breaks before the following
word. Refreshed files otherwise change only provenance and environment records.
The ordinary suite hash is
`f50daaa280c974e44db39a778092d8185fd1e7b1af4d29216edeb056924e3307`.

Chrome and Safari benchmark snapshots were refreshed from this checkout: three
foreground runs each, with matching environments at DPR 2 on the 2560×1440 screen,
visible and focused. Hot `layout()` reads 0.088 ms in Chrome (0.086 before) and
0.103 ms in Safari (unchanged); rich statistics, range and streaming rows stay
within timer granularity. Chrome preparation rows read 2–5% higher, for example
Arabic prose 35.5 → 37.1 ms, from the added boundary checks during analysis. Safari
reports whole milliseconds and shows no clear change.

## Leading zero-width spaces

Runtime commit `6ad8409` starts from published main `5443392`. A ZWSP that starts
a paragraph or follows a hard break now establishes its line without owning a
letter-spacing gap; later line starts keep the existing behavior. The flat
#210/#211 reproduction and its ZWSP-only companion now require native height,
line count and API agreement, and the visible text also requires source placement.

The full shared inventory ran in installed Chrome, Safari and Firefox, both
directions, at DPR 2: 656,407 browser/input observations. The candidate was
compared with pinned main `2b73992` and published main `5443392`:

| Browser | Full LTR / RTL | Gained metrics vs pin / published main | Lost metrics per reference |
| --- | ---: | ---: | ---: |
| Chrome | 147,714 / 71,008 | 1,687 / 1,224 | 90 |
| Safari | 148,019 / 70,974 | 1,210 / 1,202 | 60 |
| Firefox | 147,680 / 71,012 | 2,437 / 2,045 | 80 |

Gains and losses count separate metric events, not fully correct cases. Both
references lose the same 40 case IDs, 106 browser/direction observations. There
are zero failed required checks, execution errors and new API/rich failures;
nine numeric environment profiles have no new failures or changed TAB behavior.
The comparison exits 1 only because of the losses below. Each was a success that
dropping the leading ZWSP line had produced by cancelling another error:

- Raw CR before ZWSP in pre-wrap (`\u000D\u200B`, 16px Arial, widths 0, 8, 20,
  30 and 48, letter spacing −1, 0 and 1; Chrome and Safari in every row, Firefox
  except width 0 at spacing 1). The native paragraph occupies one line.
  Normalization turns the CR into a hard break, and main's dropped ZWSP line had
  hidden that extra line. LTR: `wrap-595c31eda7a6c15f`, `wrap-13adec9552de2657`, `wrap-71ae7b15dafd960d`, `wrap-6a4d93c6e3dd464c`, `wrap-dd95abdf59599b03`, `wrap-78994ecb2fb65013`, `wrap-57453093d8be2a1b`, `wrap-bd7578135a3da781`, `wrap-5502ed3295ac0ca0`, `wrap-517ebfc10bd5784f`, `wrap-0167b66269f55b72`, `wrap-dbacb16a12fd357a`, `wrap-41dcf8ea521b4fe0`, `wrap-599f859b5064c041`, `wrap-783698080ebb61ae`. RTL: `wrap-9f5cce0510fe1b5f`, `wrap-8b26138d7daf3c57`, `wrap-e926a20d0f36010d`, `wrap-fc7af6c61815b14c`, `wrap-9f46ce17a060b003`, `wrap-81a2f793fb7de513`, `wrap-fb133c5be30c031b`, `wrap-614383db311fee81`, `wrap-3b1c1fb22c54b2a0`, `wrap-54b74c89f06c524f`, `wrap-ba903ee235bcf072`, `wrap-f3fd33ea1d4b0e7a`, `wrap-5a2d7b6a28fd96e0`, `wrap-b7714be3e70d6641`, `wrap-dee603c8f3523bae`.
- Arabic beh joined across SHY after a leading ZWSP (`\u200B\u0628\u00AD\u0628`,
  pre-wrap; Amiri at 9.8 and 14.75, Noto Naskh Arabic at 10.48 and 12.32, Arial at
  11.35, widths rounded; Chrome in every row, Firefox except Amiri 9.8). Chrome and
  Firefox shape the first letter in context and give two lines. Pretext's isolated
  letter width needs a separate line after the retained ZWSP.
  LTR: `wrap-32c73ec5b7c084af`, `wrap-143ad6ae5b0e509a`, `wrap-3ecde897bf2b5e8b`, `wrap-2b6f9266db70279a`, `wrap-d1ad3222978a7fbc`. RTL: `wrap-6f04fe7d9c575eaf`, `wrap-9001042ea595ca9a`, `wrap-f1fbf02f44b8b78b`, `wrap-30fb0e6625f7a19a`, `wrap-8ad5baa21049c9bc`.

After reviewing these per-case changes, the baseline advances to runtime commit
`6ad8409`. Later changes must preserve its gains, including those of `934141a`,
`a28b542` and #223 made since the previous pin.

The ordinary snapshots were regenerated against that pin. All six legs pass with
zero new regressions, required failures or execution errors, and nine numeric
profiles have no new failures. Accuracy, letter-spacing and corpus result payloads
are unchanged; the refreshed files change only provenance and environment
records. The ordinary suite hash is
`5bb6eadf9109541475c5d6fb8004a7595756e21ddb070226215ec23e267fef07`.

Chrome and Safari benchmark snapshots were refreshed from `1ce3996`, whose runtime
source equals the pinned commit: three foreground runs each, with matching
environments at DPR 2 on the 2560×1440 screen, visible and focused. Hot `layout()`
reads 0.086 ms in Chrome (previous snapshot 0.089) and 0.103 ms in Safari (0.105);
rich statistics, range and streaming rows stay within timer granularity. Safari's
cold `prepare()` row reads 13 ms against 10 ms although preparation source is
unchanged; that runner reports whole milliseconds.

Suite hash: `24ed06aa2d941776605cd68142ec305e60602143061111150d59dccc9fde3657`.
Raw rows, frozen sources and the per-case loss table `lost.tsv` are in
`/private/tmp/pretext-210-landing-20260911/full-vs-2b73992`.

## Retained recipe reduction

The retained JSON shrank from 4,261,040 to 1,635,525 bytes. The original 4,758
profiles repeated 41,449 source records.

The migration compared the complete expanded set with `a56d0f9`: 209,138 inputs
before and after, zero additions, omissions, origin changes or family changes.
Both sorted semantic sets have SHA-256
`b6849c304ca383dbef03202952bb19878ed9217525ca687a9093feab3611e5fa`. This is an
input-preservation audit, not a browser correctness claim. The separate
maintained-oracle corrections described in [INVENTORY.md](INVENTORY.md)
intentionally restore their original protocol and are not relabeled as unchanged
inputs.
