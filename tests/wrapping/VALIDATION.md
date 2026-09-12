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

`bun test` and `bun run check` pass. The baseline advances to runtime commit
`06c850f`, and the ordinary snapshots were regenerated against it with unchanged
results; only provenance and environment records change.

## Safari next-line and tab stops

This runtime change starts from the segment-break removal branch head `daf13ac`.
NEL (U+0085) is UAX #14 class NL: a break follows it and no ordinary break
precedes it. In the WebKit profile, analysis gives each NEL its own control
segment, the walker offers a break after it, and a NEL that overflows right after
text or glue ends the line before that content. WebKit's simple text path gives
NEL no letter spacing, so NEL takes spacing only next to complex text or before a
combining mark. Safari also moves a `pre-wrap` tab to the following stop when
less than half a space would remain before the next one. The profile fields
`breakOnlyAfterNextLine`, `letterSpaceNextLine` and `skipNarrowTabStops` key on
the layout engine; Chrome and Firefox keep NEL as ordinary text and the previous
tab rule.

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

`bun test` and `bun run check` pass. The baseline advances to runtime commit
`5ba3247`, and the ordinary snapshots were regenerated against it with unchanged
results; only provenance and environment records change.

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

## Browser environment and ownership

The September 6 harness cleanup leaves library sources, cases, assertions,
tolerances and the baseline pin unchanged. The final ordinary capture passes all
maintained/preservation gates: 33,622 inputs, nine numeric profiles, zero new
regressions, required failures or execution errors. All 44 document contexts have
matching requested/observed URLs, DPR 2 and no recorded environment changes.
The seven accuracy/corpus snapshot result payloads are unchanged; only capture
provenance/environment metadata changes. This is not a full-schedule rerun.

The first guarded capture also exactly reproduces the previous investigation's
11,240 Chrome and 11,172 Safari inputs, complete native observations and main
predictions. No tolerance or geometry stripping was used in that comparison.
This supports retaining those observations; it cannot certify every older run.

The browser guard covers preparation through final event delivery. Native Chrome
fault checks reject a DPR round trip and a blur/focus round trip even when the
ending state matches the start, while steady background correctness is accepted.
Chrome's injected resolution transition delivered only the return-to-match event;
the fixed initial-resolution query retains that evidence. Safari ownership tests
reject extra tabs or navigation elsewhere and preserve replacement/user-added
content during cleanup. Transport tests reject stale IDs, duplicate/out-of-order
batches, wrong URLs, incomplete reports and nonfinite measurement evidence.

Both benchmark snapshots now retain three complete native foreground runs with
matching environments and no observed changes. Chrome used the 2560×1440 CSS
screen and Safari the 1440×2560 CSS screen, both at DPR 2. Hardware inspection
reported 120 Hz and 60 Hz respectively. These are refreshed reference captures,
not proof of a library performance change relative to older environment-free
snapshots. Native and portable correctness, corpus and probe smoke checks remain
separate from the foreground benchmark protocol.

The local evidence is under `.artifacts/harness-audit/`; `wrapping-final` has suite
hash `a1e246d1efef63a1499310f51d1c61744a3c6a8e2938ed896c6993c1ced92b66`.
The audit retained the historical evidence ledgers and valid regression cohorts;
no case pruning was justified. The interrupted #210/#211 experiments resume with
new captures using this guard, without rewriting their frozen earlier evidence.

Publication was separately validated on `f37d482`, excluding the older local
library/demo/README edits. All 204 tests (1,211 assertions), TypeScript/lint/Knip
and the demo-site build pass. A fresh ordinary capture again passes all gates
across 33,622 inputs and nine numeric profiles, with the same suite hash above.
Its refreshed accuracy/corpus snapshots identify `f37d482` and its exact source
files. Chrome and Safari benchmarks were also refreshed from this publication
checkout: three foreground runs each, with matching environments and no recorded
changes. Both stayed at DPR 2 on the same respective screen sizes listed above.
The publication capture is under
`/private/tmp/pretext-harness-publication-wrapping-20260907`; it does not replace
the earlier local audit evidence.

A separate native Chrome probe exercised the built-in 1512×982 screen and both
external screens (2560×1440 and 1440×2560), all at DPR 2. Stable correctness and
benchmark guards accepted each display. The three Latin/Arabic/emoji Canvas and
DOM witnesses were identical across displays. Moving the owned window from the
horizontal external screen to the built-in screen was observed and rejected by
benchmark mode, while same-scale correctness remained valid. This is a bounded
physical-display smoke check, not a full corpus run on each monitor. Evidence is
under `/private/tmp/pretext-harness-publication-displays-20260907`.

## Extraction-stage observation

This follow-up changes test instrumentation only; all library sources are
identical to the shared-walker foundation. Observer version 2 records the
selected extraction's exact source and geometry separately from the original
paragraph. Its measured height establishes line count even when rectangles do
not establish exact source ownership. Known scalar mismatches remain failures;
ambiguous boundaries remain unobserved. Preserved LF topology and corroborated
literal SPACE/TAB span fragments recover established whitespace boundaries.
No case, required metric, tolerance or baseline revision changes.

The final fresh ordinary run passes the maintained and baseline-preservation
gates in all three browsers: 33,622 inputs and nine numeric environment profiles.
Every prediction and original paragraph observation is identical to the final
foundation run. All previously passing boundary assessments are preserved.
Five Safari boundary failures were caused by the old extraction and now pass.
The `trans\u00adatlantic transit` boundary is unobserved in Chrome and Safari:
its control rectangles do not establish the exact source endpoint. This corrects
two formerly asserted failures, without changing their other assessments or
claiming a library fix.

The initial version-2 native full run covers 656,402 inputs and passes the same
gates. Its core predictions and original native observations match the earlier
full foundation run throughout. Five inputs per browser carry additional
provenance and proposed assertions in the experimental reference harness; the
audit records those metadata differences separately. No physical input differs.
The final LF/SPAN refinement changes only boundary assessment, so its full-run
validation reuses the saved native observations; the final ordinary run freshly
observes all selected extraction cases. All 84 selected full-run inputs and
extraction records (42 Chrome, 42 Safari) exactly match that fresh ordinary run.
Reassessment restores 17 previously uncertain boundaries in each browser and
changes no other metric status or required success. This is not a second fresh
full sweep.

Unit tests pass (181 tests, 1,119 assertions), as do strict TypeScript/lint/Knip,
the static site build and diff checks. Independent offline probes check 2,585
candidate source partitions and seven SPAN corroboration controls, with no false
passes or failures. Accuracy, spacing and corpus snapshots and both dashboards
were refreshed from the final ordinary run. Library benchmarks and package
checks remain those of the unchanged foundation.

The final ordinary suite hash is
`0f51943935e2ee005c52dfb58236dc42e0ce23b303c631c9cec6535e70a42d51`.
Artifacts under `/private/tmp/pretext-production-20260905` are
`observer-v2-final-ordinary`, `observer-v2-full-{chrome,safari,firefox}`,
`observer-version-final-audit.json`, `observer-version-full-audit.json` and
`observer-boundary-coverage-audit`. The initial full observer hash is
`e879a5ac5755832d3f409b17f99138af18f201021f4d3a63b606bfd024b5623f`.
These are observation corrections; flat #210/#211 and the rejected source-model
candidates remain separate.

## Shared complex line walker

The production foundation starts at published main `cdc34f1`. Complex batch,
streaming, ranges and statistics now share one decision loop, retaining the
simple fast path. A later fitting boundary has the same priority over an earlier
SHY in every API. Line-start normalization also crosses consecutive consumed-only
chunks without dropping later text or suppressing real empty lines. Preparation,
measurements, prepared fields and the public API are unchanged.

The full shared inventory comparison covers 656,402 native inputs in Chrome,
Safari and Firefox, both directions. It removes API disagreement on 19,054 rows
(6,252 Chrome, 6,214 Safari, 6,588 Firefox), with no lost native accuracy successes
and identical batch text, widths and cursors. Seven source-conservation diagnostics
change with corrected streaming; API agreement and exact source partition remain
separate claims. The normalizer correction preserves every full-run prediction;
its previously missing counterexample is covered by one small regression test.
The final cleanup removes only independently proven unreachable code. A further
4,380 producer-created comparisons preserve batch output and contracts, including
mutated callbacks, reentrant calls and copied continuations.

All 33,622 ordinary observations pass the final baseline-preservation and maintained
absolute gates. Nine numeric environment profiles pass too. The final ordinary
suite hash is `c3f9748217abee9c8b2c72c79c5c8ff7a7bc77c84b6cfae5b7508864b5d346fa`.
After reviewing the per-case changes, the baseline advances to runtime commit
`2b73992`, protecting its newly gained API successes. The ordinary snapshots
were regenerated against that pin; all gates pass again. The exploratory full run uses additional proposed source obligations already
failed by published main; those failures remain recorded and are not waived or
promoted as passing. This foundation does not resolve flat #210/#211. The broader
source-boundary candidates still have main regressions and remain separate.

Unit tests (174 tests, 1,070 assertions), strict checks, the static site build and
packed JS/TypeScript consumer checks pass. Three focused regressions protect
complete returned-line metadata, later hanging boundaries after SHY, and progress
across consecutive consumed-only chunks. Accuracy, spacing, corpus, benchmark
snapshots and dashboards were refreshed.

Foreground benchmark snapshots use medians of three page runs against a fresh
published-source reference. Ordinary layout and the long Arabic rich workload
stay close to baseline. Pre-wrap stats improve from 0.180 to 0.135 ms in Chrome
and 0.250 to 0.150 ms in Safari; range walking rises from 0.125 to 0.145 ms and
0.150 to 0.200 ms respectively. Chrome pre-wrap streaming rises from 0.525 to
0.570 ms, while Safari remains 0.500 ms. These small absolute stress-case costs
are retained; the refactor is not a universal speedup. Counted work finds no
quadratic traversal, but complex preferred-cut searches now cost
O(lines × log(cuts)), as documented in [RESEARCH.md](../../RESEARCH.md).

Artifacts under `/private/tmp/pretext-production-20260905`: full native rows and
pair audits in `published-shared-walker-v4-full-{chrome,safari,firefox}`, final
ordinary observations in `production-foundation/.artifacts/wrapping/2026-09-06T10-13-29.944Z-9c7aae7d`,
producer proof in `review-foundation-v3/semantics-v5.json`, and benchmark comparison
in `foundation-v5-timing-comparison.json`. Frozen V5 source matches the final
production runtime; V4 differs only by the reviewed unreachable-code cleanup.

## Algorithmic-work audit and repairs

The history/current-code audit repaired three inherited repeated scans:
rich boundary whitespace, preferred-break lookup for streamed continuations,
and pixel font-size parsing. Production changes are +30/−15 lines, with no new
public state or caches. The cause and retained historical bounds are documented
in [RESEARCH.md](../../RESEARCH.md).

All 33,622 ordinary inputs passed fresh Chrome, Safari and Firefox comparisons
against reviewed runtime `ac6289f`, both directions. An independent raw-row audit
confirms every prediction and assessment is identical, with zero required or
execution failures and no new API/rich failures; all fourteen native rich-item
height checks pass per browser. Nine numeric environment profiles also agree.
This is an ordinary comparison, not a new full exploratory sweep. Accuracy,
spacing and corpus snapshots were regenerated from exactly these observations.
The baseline remains `ac6289f` because no native correctness result changes.

The smaller structural checks separately count work. Rich endpoint scanning
uses at most source length plus two checks. The 4,096-hyphen streaming witness
drops from 2,096,128 skipped cuts to 12,288 binary comparisons. Before/after public
comparisons cover 21,546 arbitrary cursors, 3,456 width cases, 720 rich cases and
5,664 whitespace/style range/text/stats comparisons; all agree. Font-parser
probes retain exact numeric captures on malformed/multi-dot inputs as well as
normal CSS shorthand. Permanent tests retain three compact semantic regressions;
final unit/static/package/site checks pass (171 tests, 1,026 assertions).

Foreground Chrome/Safari paired native runs freeze the same baseline/current
sources, use five balanced ABBA/BAAB rounds, and retain 380 timing samples plus
eight output-parity checks per browser at visible DPR 2. On Safari, internal
SPACE runs of 4K/8K/16K take 17.5/66/267 ms before the fix; the new preparation is
below the 1 ms timer resolution. Chrome already optimizes that regex case, so
its tiny timings do not establish a useful speedup ratio. For 4,096 URL hyphens,
copied range streaming changes from 2.41 to 0.37 ms in Chrome and 2.7 to 0.4 ms in
Safari; stats change from 2.195 to 0.228 ms and 2.525 to 0.3 ms respectively.
Batch ranges already scale linearly and the small normal preparation canary is
roughly unchanged. These samples establish the large targeted effects, not
universal speedups or zero-cost short operations. Both canonical benchmark
snapshots were refreshed as medians of three foreground runs.

Artifacts: `/private/tmp/pretext-merge-audit-20260905/linear-{chrome,safari,firefox}`,
`linear-audit.json`, `complexity-native`, `complexity-history.md`,
`complexity-prepare.md` and `complexity-walking.md`. Suite hash:
`cbf597257a39205e6591cc804762b5b61743e513bdaeb388e669feacde7dd663`. The flat #210/#211 work remains separate.

## Published-main landing validation

The isolated landing starts at published main `76b4b4e`; unrelated unpublished
local demo/Freerange commits are excluded. Runtime commit `ac6289f` matches every
frozen source hash in the landing run. It was compared with both published main
and previously validated `9b02df1` on the full shared inventory in all three
installed browsers, both directions, at DPR 2: 656,402 inputs. Every prediction
and assessment matches the validated branch. There are zero lost passing metrics
against either reference, zero required/execution failures and zero new API/rich
failures, including research observations. All fourteen native rich-item height
witnesses pass in each browser; nine numeric environment profiles preserve
contracts and TAB behavior. Flat #210/#211 remains observed and unresolved.

The ordinary baseline now points at `ac6289f`, so later changes must preserve the
newly gained successes too. The pin is a reachable source commit, not disabled
tests or a frozen list of browser answers. Accuracy, spacing and corpus snapshots
were regenerated from these same full observations. Unit/static/package/site
checks pass (168 tests, 991 assertions on this published-main base; three local
demo tests remain with their unpublished changes). Earlier paired foreground
benchmarks are recorded below; the landing did not add another engine change.

Suite hash: `a3567aaad94c409992fbd828f041c780a16162dba4779837d88a6ec6cd3b9e4d`.
Raw rows, source fingerprints and the independent equality/loss audit are in
`/private/tmp/pretext-merge-audit-20260905/landing-full` and `landing-audit.json`.

## Rich-inline implementation and review

Relative to boundary branch `9f00a4f`, only `src/rich-inline.ts` changes in
production. One source-indexed array replaces the compressed array and reverse
lookup; source extent and line presence no longer depend on positive width.
Collapsed SPACE is measured directly, keeps its first style and signed advance,
and retains its ordinary break opportunity. The visitor keeps its continuation
before calling user code. All flat engine files remain byte-identical to the
validated boundary base.

Independent review caught a whole zero-width item rejected at exact fit. Moving
whole-item fit ahead of reservation fixed it but lost nine opposing Safari
matches: a negative next item could undo forced overflow. A broader prior-overflow
guard also lost 62 matches when item/style boundaries differed. The final redo
keeps reservation first and changes its comparison from `>=` to `>`.

A 1,926-input Safari comparison covers the earlier 720 source opposites, 450
signed-space controls, 540 exact-fit cases and 216 mixed-style cases. The selected
redo gains 78 native height matches and loses none against v4, with zero API/rich
failures. It retains twelve inherited mixed-style missed fits; the trailing-SPACE
and separate-SPACE native paragraphs genuinely differ. Those observations remain
research evidence, not a claim of general styled-inline correctness. See
`/private/tmp/pretext-focused-results-20260905/rich-admission-v6-v7-probe/`.

Permanent unit tests retain the exact-fit and forced-overflow opposites. Two
same-font native witnesses were also promoted into ordinary/full. An independent
generator comparison verifies zero removed or changed old inputs, assertions or
provenance in either schedule, in every browser. The styled-item pair remains in
the research artifact because the canonical native inline protocol is same-font.

The final production source passed the full corpus at DPR 2 in Chrome, Safari
and Firefox, across both directions: 656,396 inputs, zero lost passing metrics
against main or boundary, zero required/execution failures, and zero new API/rich
failures. Every flat prediction and assessment is identical to boundary; all
global rich contracts pass. The twelve native rich witnesses pass in each browser.

| Browser | Full LTR / RTL | Gained API/rich-height metrics over boundary | Lost |
| --- | ---: | ---: | ---: |
| Chrome | 147,711 / 71,008 | 3,650 | 0 |
| Safari | 148,014 / 70,974 | 2,675 | 0 |
| Firefox | 147,677 / 71,012 | 2,798 | 0 |

These are independent metric gains, not counts of fully browser-correct cases.
The full run uses suite hash
`d8b6f632d374c1ff3fa35f94f4ece70e44f361f790ad504a0002ed6546e4f3bc`.
The subsequent two-case native promotion passed fresh in all three browsers with
the same production source, under suite hash
`02907abf1689588c5a6a5e88685d0faa137eeefbb00bf0652912cf340631d59d`.
Nine numeric profiles have no new failures or changed TAB behavior. Exact sources,
raw observations and audits are under
`/private/tmp/pretext-focused-results-20260905/rich-source-v6-full-{chrome,safari,firefox}`,
`RICH-SOURCE-V6-FULL-AUDIT.json` and `RICH-SOURCE-V6-ADMISSION-AUDIT.json`.
Accuracy, spacing and all three corpus snapshots were regenerated from those
same full-run observations, using the existing snapshot writer.

Relative to boundary, runtime source shrinks by 25 lines / 573 bytes. The main
entry bundle remains 50,596 minified bytes / 16,900 gzip; rich-inline shrinks
54,778 → 54,527 minified bytes and 18,001 → 17,924 gzip. Methods are unchanged
from the boundary measurement below; exact counts are in `rich-source-v6-size`.

Foreground paired timing uses independent baseline/current modules, two warmup
blocks and eight alternating ABBA/BAAB blocks. Both browsers stayed visible and
focused at DPR 2. Caches clear once per 200-list preparation batch; hot range and
statistics samples repeat 80/200 times. Materialization warms every width outside
timing, then repeats twenty times. The mixed-font workload includes empty items,
ZWSP and atomic pills, at zero letter spacing.

| Incremental rich operation | Chrome current/boundary | Safari current/boundary |
| --- | ---: | ---: |
| Preparation | 0.859× | 0.924× |
| Statistics | 0.940× | 1.038× |
| Range walking | 1.036× | 1.063× |
| Materialization | 1.005× | 1.000× |

These are median within-block ratios. Line totals are identical; retaining ZWSP
adds twenty fragments per 200-list pass (roughly 2–3%). The small range overhead
is not an exact zero-cost claim, and this probe does not establish signed-spacing
throughput. The source hashes, all blocks and work counts are in `rich-source-perf`.
Both canonical snapshots contain all measurement sections and are medians of
three full runs. Both dashboards were regenerated afterward.

Final checks pass 171 tests / 1,004 assertions, TypeScript, lint, dead-code
checks, emitted package JS/TS consumers and the demo site build. Benchmark
collection also now rejects missing measurement sections: a deliberately wrong
page is rejected before snapshot output, and both correct browser snapshots
must contain all sections. Flat #210/#211, arbitrary styled-inline shaping and
general SHY accuracy remain outside this accepted change.

## Boundary-policy validation

This section records the boundary-only production revision `5af1ba8` and its
subsequent test promotion `9f00a4f`; rich-inline was unchanged at that revision.

The reviewed implementation keeps ordinary boundaries and emergency permission
in analysis and preserves source neighbors through punctuation compaction.
Gecko’s additional tailoring is restricted to the observed ASCII boundary domain.
Measurement retains main’s producer model and observes each coarse analyzed run
before constructing its CJK units. The only shared-helper cleanup moves the
identical grapheme segmenters under analysis; `clearCache()` still resets
segmentation, metric and line-text caches.

The boundary revision requires independent native and API checks for the three selected
issue groups. Existing maintained requirements remain intact. #210 keeps its
observations and passing-baseline protection; that revision does not claim an
absolute #210 pass.

The final full comparison against pinned main `12097db6` passed all six
browser/direction legs at DPR 2. Each passing native metric is preserved
independently, including research metrics. There are zero lost passes, failed
required checks, execution errors, new API/rich failures or failures without an
observed baseline across 656,336 browser/input observations:

| Browser | Full LTR / RTL | Gained native metrics | Lost native metrics |
| --- | ---: | ---: | ---: |
| Chrome | 147,691 / 71,008 | 3,260 | 0 |
| Safari | 147,994 / 70,974 | 3,254 | 0 |
| Firefox | 147,657 / 71,012 | 4,836 | 0 |

Gains count separate metric events, not fully correct cases or an overall
accuracy score. Main's existing failures remain visible. The nine numeric
environment profiles also have zero new failures and unchanged TAB behavior.
Raw observations, frozen sources, manifests and `PRESERVATION-AUDIT.json` are in
`/private/tmp/pretext-focused-results-20260905/break-policy-review-full-v3/`.
Its suite hash is
`cef27c841c9655694478f896d4035ee2555174d5a0fbf535eaf4d79174143ebc`.
Accuracy, letter-spacing and all three corpus snapshots come from this run.

A fresh reported-case comparison also preserves all original and follow-up
worktree successes within the three selected issue groups, across 139 LTR inputs
per browser. The new symbol handling gains 18 metrics over original in
Chrome/Safari and 22 in Firefox, plus 16 over follow-up in Firefox. Every loss
against those worktrees belongs to unresolved #210/#211; this does not establish
overall replacement of either worktree. No RTL inputs match this family filter.
The grouped evidence is
`/private/tmp/pretext-focused-results-20260905/OLD-REPORTED-COMPARISON.json`.

Full validation rejected broader emoji overflow eligibility, Gecko box-width
quantization as a text-fit model, wider Unicode-affix tailoring, and generic
opener rules overriding the existing CJK-leading mixed-run policy. Their raw
failures remain in `break-policy-review-full` and `break-policy-review-full-v2`
under `/private/tmp/pretext-focused-results-20260905/`. The affected Firefox
brace family passes after restoring CJK precedence. Ordinary now includes the
exact emoji, ASCII-opener and CJK-prefix failures with nearby controls; full
retains every original input.

The subsequent source-view fixture promotion from test-only commit `9624e9d`
adds twenty semantic inputs and provenance for three retained inputs. Ordinary
and full share these same cases. A fresh replay of the source-view family in all
three browsers selects 25 inputs per browser after merged provenance: every
observed boundary-branch result is identical to main, with zero required, API,
rich or execution failures. This is a focused follow-up to the full run above;
it does not claim that run already contained these twenty new inputs. Reports
are in `boundary-new-source-view-controls` in the same external results directory.
The independent test-only branch also passed its complete ordinary run with
33,187 predictions/assessments identical to main. The added observations do not
establish a correct #210 implementation.

Foreground Chrome and Safari benchmark snapshots were refreshed against a fresh
`89234cd` checkout, whose production source is main's. Separate page runs showed
substantial common drift, including the unchanged DOM controls; reversing the
Chrome order reversed the preparation result. A throwaway same-page comparison
therefore interleaved independent baseline/current modules in eight ABBA/BAAB
blocks after two warmup blocks. Both sources clear their own caches before cold
preparation. The final probe repeats hot resize 200 times and Arabic rich
operations 120 times per sample to reduce timer granularity.

| Paired operation | Chrome current/base | Safari current/base |
| --- | ---: | ---: |
| Cold 500-text preparation | 1.006× | 0.958× |
| Hot 500-text resize | 1.015× | 1.012× |
| Arabic preparation | 1.012× | 1.002× |
| Arabic resize | 1.025× | 1.012× |
| Arabic rich statistics | 0.990× | 1.000× |
| Arabic rich ranges | 1.017× | 1.000× |
| Arabic rich materialization | 0.892× | 1.017× |

These are median within-block ratios, not ratios of independently chosen best
times. The first paired Chrome probe measured 1.073× cold preparation and
1.029× Arabic preparation; it used only 12 rich-operation repeats and is retained
too. The repeated samples support modest possible preparation overhead, with no
material resize or long-form regression in this check. They do not establish a
speedup or exact zero cost. The canonical snapshots remain medians of three full
page runs, not these supplemental probes. Raw reports and the probe source are
under `break-policy-paired/`; the separate page reports use the
`break-policy-benchmark-` prefix in the same external results directory.

Runtime TypeScript grows from 5,552 to 5,664 lines and 158,573 to 165,149 bytes
(nine files, excluding tests and test data). Identically minified browser ESM
bundles grow by 2,110 bytes per entry point: the main entry is 48,486 → 50,596
bytes, or 16,163 → 16,900 bytes gzip; rich-inline is 52,668 → 54,778 bytes, or
17,267 → 18,001 bytes gzip. These are separate entry bundles, not a combined
application payload. Exact commands and counts are in `break-policy-size/`.

Final verification passes 165 tests / 959 assertions, TypeScript, lint and
dead-code checks, package emit, tarball JS/TS consumer smoke tests, and the demo
site build. Both dashboards were regenerated. That production source and then-current suite files
match the full run's recorded hashes. Main's line walker and rich-inline source
remain unchanged. All changes remain on the review branch; this validation does
not establish that the entire older worktree is dominated or that #210 is fixed.

The sections below record the earlier test-consolidation validation at
`89234cd`; those counts and timings describe that test-only revision, not the
boundary-policy implementation.

## One set of inputs and assertions

Ordinary runs all maintained accuracy, corpus, whitespace, keep-all, symbol,
spacing and discretionary cases, plus explicit counterexamples and nearby
controls. Full adds the broad exploratory matrices using the same definitions
and assertions. Their shared numeric companion checks public API agreement and
prohibits Canvas calls after preparation across nine environment profiles.

The retained recipes reproduce all 209,138 historical fixed-width public inputs,
including their settings, exact width values, origins and families. An exhaustive
before/after input comparison found no additions, omissions or changed settings.
Ordinary retains all 122 nominated evidence records. Of the 270 directed
browser/candidate comparisons in the frozen earlier captures, 249 have native
losses; ordinary retains an exact witness for every one. It does not retain every
historical loss row. Input imports
from nine older experiment cohorts also do not reproduce their original document
language/font-loading protocol; see INVENTORY for that distinction.

Maintained cases preserve their original content widths, preparation route,
normalization, languages, browser scope, Range/span extractor and tolerances.
Fixture fonts and installed fonts now have explicit, separate browser contexts.
Each direction/context starts in a fresh document before Canvas preparation.
This prevents controlled fonts from overriding installed fallbacks and preserves
generic-font resolution, which can retain the document's initial language.
Native element language and preparation locale remain separate inputs.

Required maintained metrics need an absolute observed pass. Canonical accuracy
still checks height with a tolerance below 1px. Corpus still records rounded
height differences and does not require every width to match. Elsewhere, the gate
preserves observed successes against pinned main and any requested references.
Height, line count/boundaries, source placement, whitespace, widths, selected
hyphens and API contracts remain separate; improvements cannot cancel losses.
Errors from any source fail the run. Unobserved and inapplicable checks are not
passes. API agreement establishes consistency, not browser correctness.

Public contracts retain valid copied continuations, variable widths, visible and
preserved source coverage, rich item coordinates, callback ownership, atomic
pills and signed SPACE gaps. They do not invent ownership requirements for
collapsed SPACE, inactive SHY/ZWSP or pre-wrap newlines between rendering ranges.
Preserved whitespace, joiners and combining marks cannot disappear. Interrupted
contract groups discard partial passes while retaining their counterexamples.

## Migration parity and full validation

The original main checkers and the consolidated runner agree:

| Maintained observation | Chrome | Safari | Firefox |
| --- | ---: | ---: | ---: |
| Accuracy inputs and exact native/predicted heights | 7,680 / 7,680 | 7,680 / 7,680 | 7,680 / 7,680 |
| Compact cases, including their selected line diagnostics | 53 / 53 | 53 / 53 | 11 / 11 |
| Corpus width statuses | 1,098 / 1,098 | 1,098 / 1,098 | New coverage |
| Saved corpus mismatch measurements | 55 / 55 | 13 / 13 | New coverage |

Firefox accuracy was compared with an archived original checker launched headed
at DPR 2. Its earlier headless DPR 1 capture differed on 28 emoji rows, shifting
native and predicted heights together without changing pass status. Matching the
environment removes those numeric differences. Old corpus captures did not save
absolute geometry for successful widths, so that parity claim is status-only.
There was no old Firefox corpus capture to compare.

The consolidation’s ordinary and full comparisons of pinned main `12097db6`
with checkout `89234cd` completed at DPR 2, with identical results, zero new regressions, zero
failed required checks and zero execution errors. The full runs cover 656,285
browser/input observations:

| Browser | Ordinary LTR / RTL | Full LTR / RTL |
| --- | ---: | ---: |
| Chrome | 10,262 / 813 | 147,674 / 71,008 |
| Safari | 10,228 / 779 | 147,977 / 70,974 |
| Firefox | 10,228 / 817 | 147,640 / 71,012 |

This is a regression-gate pass, not universal native correctness. Main's existing
failures remain visible. For example, Firefox case `wrap-5123bf2f598e26a1`
(`a\u00adb\ufffe`, pre-wrap) disagrees across batch/statistics/streaming APIs;
`wrap-d100ee2cf3c97c9a` (`a\u3000\u2060b`, width 8) loses the final visible `b`.
Chrome case `wrap-dfa8b337a210cbe1` (`a\u00ad\tb`, Amiri, pre-wrap) retains its
API disagreement too. These remain counterexamples in ordinary.

Accuracy, spacing and all three corpus snapshots now come from those same run
rows. The writer validates completeness before emitting totals and mismatches;
it does not launch another browser sweep. Corpus mismatch widths and heights
retain the legacy outer-box padding of 80px, with `contentWidth` explicit.
Firefox's fresh corpus capture has 136 mismatching widths; the dashboard labels
its numeric results separately from historical Chrome/Safari investigation notes.

## Test cost and removed machinery

The pre-trim reference is consolidation commit `a56d0f9`. The final change removes
eight old checker scripts, the duplicate discretionary page, probe batching,
repeated contract implementations and duplicate known-main indexes. Detailed
corpus, probe and font investigations remain available. The accuracy page reads
snapshots. One runner owns scheduling, collection, comparison and snapshot output.

In the scoped maintained-check/shared-suite code, including whole retained
accuracy/corpus/probe pages and corpus-status, code falls from 8,333 to 7,040 lines
across 31 to 24 files. This excludes unchanged shared transports and detailed
investigation scripts. The same scope is 5,907 lines on original main, so the
consolidated suite adds 1,133 lines relative to main while covering the expanded
contracts and retained experiments.

Retained JSON falls from 4,261,040 to 1,635,525 bytes (61.6% smaller), with exact
finite recipes replacing repeated strings and widths. All suite data, including
the removed duplicate indexes, falls from 7,607,274 to 1,789,977 bytes (76.5%
smaller). The 1,916,477 bytes of controlled fonts/licenses remain unchanged.

Consecutive widths share a preparation only while public preparation inputs are
equal. Every width still gets its observations and public checks. Numeric
coverage is 49 preparations and 196 width trials per source/profile, down from
126 preparations and 756 trials; all nine profiles and the complete 80-row TAB
compatibility probe remain.

Measured wall times include process startup, source freezing, numeric tests and
browser collection for the suite commands. Units and checks use five repetitions;
Chrome browser commands use three; Safari/Firefox use one each. Medians are shown.
There were no competing browser checkers. Environment: macOS 26.5.2, Bun 1.4.0,
headed DPR 2 browsers; exact user agents are in each report.

| Command | Pre-trim | Final |
| --- | ---: | ---: |
| Full Chrome | 133.92s | 94.66s |
| Full Safari | 233.90s | 122.54s |
| Full Firefox | 138.80s | 84.67s |
| `bun test` | 0.842s | 1.556s |
| `bun run check` | 2.722s | 2.408s |

Full browser time decreases by 29%, 48% and 39%. Ordinary takes 41.51s in Chrome,
44.47s in Safari and 33.86s in Firefox. It is larger than the old fast selection
(~11,000 versus ~4,700 cases/browser), and slower than its 13.58/15.52/14.96s.
Ordinary now includes the complete maintained grids, not just a smoke selection.
The original main's separate Chrome maintained commands totaled about 26s, and
Safari's about 87s; neither included the expanded experiment/API contracts.
Firefox previously ran only accuracy and discretionary checks, so its old 5.81s
workflow is not comparable to the new corpus and experiment coverage.

Unit time increased because the inventory tests expand and verify retained
recipes and ordinary/full assertion identity. Final `bun test` passes 157 tests
with 898 assertions. Type/lint/unused checks, tarball JS/TS consumer checks, the
public demo build and the accuracy-page bundle all pass. Packaging used a
task-local npm cache because the sandbox cannot write the user's default cache.
These are test-tool timings, not wrapping-engine benchmarks.

## Candidate comparison

The nine retained sources were freshly compared as-is against main on ordinary
in all three browsers. This does not rebase old heads onto main or establish a
full-inventory pass. Every source completed without execution errors.

| Name | Frozen source |
| --- | --- |
| `original` | Original wrapping worktree, `5961d083`. |
| `followup` | Follow-up wrapping worktree, `8e48e1ce`. |
| `targeted` | Targeted policy v5 based on follow-up. |
| `narrow` | Main-based family integration v7: restricted whole-source observations and Safari precision. |
| `v14` | Earlier bounded composition, retained as a comparison reference. |
| `v16` | Later spacing/context composition with Gecko dictionary-boundary changes. |
| `shy` | Chrome/Safari SHY source v3 with copied-result metadata correction. |
| `gecko` | Separate Gecko SHY-selection prototype with that metadata correction. |
| `rich` | Main-based rich-inline item-coordinate, callback-ownership and SPACE-gap worktree. |

The table counts unique supported inputs losing at least one passing native
metric versus main, combining LTR and RTL. A case can lose several metrics; these
are case counts, not summed metric events or an overall accuracy score.

| Candidate | Chrome lost cases | Safari lost cases | Firefox lost cases |
| --- | ---: | ---: | ---: |
| `original` | 23 | 10 | 49 |
| `followup` | 27 | 22 | 66 |
| `targeted` | 43 | 33 | 115 |
| `narrow` | 0 | 0 | 0 |
| `v14` | 43 | 9 | 280 |
| `v16` | 75 | 46 | 108 |
| `shy` | 176 | 250 | 108 |
| `gecko` | 176 | 250 | 108 |
| `rich` | 0 | 0 | 0 |

Only `narrow` and `rich` preserve all observed main successes and pass required
and numeric checks in ordinary. Neither preserves all original/follow-up
successes, so neither replaces the old wrapping fixes. No candidate introduces
an API/global-rich failure on a check that passed on main. Existing failures and
losses against the old references remain recorded separately.

`narrow` fixes 2/2/4 supported native cases in Chrome/Safari/Firefox and two
Firefox API cases. `rich` leaves native results unchanged and reduces global rich
contract failures from 82/66/58 to 11/11/7; its source differs from main only in
`rich-inline.ts`. Both still lose 155/208/217 native passing cases relative to
follow-up. Main has 18/14/13 failing per-case API inputs in this selection;
`narrow` retains 18/14/11 and `rich` retains all of them. The four broader heads
have zero observed per-case API/global-rich failures, alongside their native
losses above. Consistency improvements do not establish native correctness.

The original head fails 10 required checks across five discretionary cases in
each browser. It lacks the later terminal-SHY fix `582fcb2`, present in main and
follow-up; these head-level losses do not show that an isolated cherry-pick onto
main would cause them. `v14` fails three required Firefox accuracy cases. Required
failures of preserved references remain recorded but do not fail the other
candidates' gate by themselves. All synthetic
API/no-Canvas contracts pass, but `v16`, `shy` and `gecko` each change retained TAB
behavior in all six unverified profiles (`crios`, `crios-desktop`, `fxios`,
`edgios`, `unknown`, `none`) relative to main and both old references.

No complete wrapping candidate is established as a mergeable replacement. The
small main-based and rich-inline candidates are useful separate leads; they still
need full coverage, implementation review and foreground runtime benchmarks
before adoption. No issue/PR closure or complete rich-Markdown claim follows from
these captures.

## Reproduction and limits

Local audit artifacts are under
`/private/tmp/pretext-trim-timing-20260905/`. Formal current-versus-main reports use
`after-{browser}-{ordinary|full}-1`; Chrome also has repetitions 2 and 3. Before and
after wall-time records are in `before.ndjson` and `after.ndjson`; only `after-`
labels belong to the final timing series. Each run freezes source files, harness,
inputs and browser environments, and preserves full raw rows.

The ordinary/full timing harness hash is
`1d5bb41e1f0fb8fbfadadf2c8e3d5a46cd894041a5855001b3a69e86c9594ca6`.
The final candidate run is `candidates-final`, hash
`8c879738438dbb23cc1a76e1b11e623afe3430a9e7b8c37a7992128b14dda330`.
The only harness differences are rejection of invalid preserve selections and
the snapshot writer's outer-box height presentation. Inputs, observers and
assertions are identical. Snapshot values were separately checked against every
formal accuracy/corpus row; invalid preserve selection was explicitly exercised.

Ambiguous rectangles and unsupported paint/width observations remain
unobserved. Verified font loading does not identify each glyph's selected
fallback face. Direction-conflict inputs remain research observations while
public API checks still apply. HarfBuzz, custom font loading in production,
exhaustive substring producers and runtime DOM measurement remain outside the
current adoption scope. The suite records evidence within these boundaries; it
does not promise universal browser equivalence.
