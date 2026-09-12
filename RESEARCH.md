# Research Log

Durable findings and rejected approaches from building this library. Keep the
reasoning that code and commit messages do not make obvious; current behavior and
limitations belong in [README.md](README.md), and validation commands and current
results in [DEVELOPMENT.md](DEVELOPMENT.md). Browser bugs and workarounds live in
[PLATFORM_BUGS.md](PLATFORM_BUGS.md); detailed font measurements live in
[FONT_DIAGNOSTICS.md](FONT_DIAGNOSTICS.md).

## Measurement Model

Independent UI components interleaving DOM reads and writes can force repeated
document layout. Pretext moves text analysis and Canvas measurement into
`prepare()`, then lets `layout()` walk cached widths using arithmetic. Measuring
whole candidate lines during layout, hidden DOM text, and SVG text were tried;
none earned the extra work or the loss of that separation.

Adding measured segment widths is an approximation: adjacent glyphs can affect
each other's shape and spacing. Keeping punctuation with its word and allowing
trailing collapsible spaces to hang improved results. Uniform scaling and generic
pair corrections did not recover the missing context reliably. Agreement on a
whole word also does not establish the widths of its possible line prefixes.

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
does not forbid emergency grapheme progress when it is overlong. Firefox can
segment Hangul plus Latin as one word where other runtimes separate it; policy
must not depend on those incidental storage differences.
Extending Firefox's ASCII opener/numeric rules to wider Unicode cases exposed
trailing-space fit failures, so the accepted rules remain narrow.

Question and exclamation marks are UAX #14 class EX. ICU and ICU4X break after EX
before a following letter or number (LB31), and Firefox sends every word
containing EX to ICU4X: its ASCII shortcut covers only AL, IS, NU and QU words.
Chrome and Safari first consult a pair table for characters up to U+00FF. It
follows ICU except for printable ASCII, where `?` breaks before a letter, digit or
symbol but `!` does not. Punctuation with no text before it, such as `?` after a
space or ZWSP, is otherwise carried onto the next word, so the forward carry and
the no-space join apply the same rule. Safari's keep-all still breaks only at
spaces. Earlier passes keep two table quirks unmodeled: `?` before `$`, `-` or
`|`, and `!` before a non-letter symbol such as `©` or `¿`. The first-pass Arabic
no-space rule also keeps U+061B with a following word.

U+2007 FIGURE SPACE is UAX #14 class GL, like NBSP and NNBSP, even though it is
a space separator. Chrome and Safari treat only SPACE, TAB and LF (Safari also
LS/PS) as breakable spaces, and their pair tables stop at U+00FF, so U+2007 goes
to ICU's GL rules. Firefox's line breaker splits words only at SPACE, TAB and
CR, so U+2007, like the rest of U+2000..U+200B, stays inside the word it sends
to ICU4X, which applies the same GL rules. Treating it as plain text let
`Intl.Segmenter`'s word boundaries around it become break opportunities. As glue
it inherits the NBSP glue model's remaining gaps, and Safari adds one that is
specific to U+2007: Safari 26.5.2 keeps `-` with the following letter after a
figure space (`foo\u2007-bar`, `x ab\u2007-cd`) but breaks after it following
NBSP, while Pretext breaks after the hyphen in both, as Chromium does; main
misses the same widths. Other gaps: some breaks around a dash, soft hyphen or
CJK character next to glue differ from browsers, and a glued run that
`Intl.Segmenter` does not mark word-like gets no emergency breaks: emoji and
symbols, or digits where the segmenter marks them non-word, as Safari 26.5.2 and
Playwright WebKit 2272 do.

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

The shared complex walker fixed batch/streaming disagreement after a soft hyphen
([#222](https://github.com/chenglou/pretext/pull/222)). A later usable break could
win in one path while another rewound to the hyphen. This needed one decision
algorithm, not more width measurements. Counting, ranges and materialized lines
must agree even when browser matching remains approximate.

Do not assume every remaining walker can be collapsed the same way. The simple
continuation path consumes following SPACE/ZWSP differently after forced overflow;
routing it through the complex path changed public cursors. Reusing batch traversal
for statistics preserved output but made long-form statistics materially slower.

Consuming source is separate from painting it. A terminal soft hyphen (SHY) stays
invisible, and consuming it must not discard the preceding letter spacing. When
a discretionary hyphen is actually selected, later source cannot be packed onto
that line. Skipping invisible controls at line start must also continue past
every consecutive consumed-only chunk; a real empty hard-break line is different.

A source-coordinate prototype showed that internal storage can change without
changing public output, but only if measurement-local grapheme boundaries survive.
Segmenting the complete source into graphemes is not automatically an equivalent
partition. A word may span stored SHY/mark pieces; entering a later segment is not
the same as starting an untouched word. Finer source positions need not mean more
Canvas calls; they also do not create shaping information we never measured.
The extra compiler/adapter remains experimental and has not earned its production
cost.

## Widths After A Line Break

These are findings from the September 2026 wrapping experiments around
[#210](https://github.com/chenglou/pretext/issues/210) and
[#211](https://github.com/chenglou/pretext/pull/211). The bounded entry measurements
below improve some cases; the line-start rule described next resolves the
leading-ZWSP visible-text reproduction.

A ZWSP at a paragraph or hard-break start is real source. It establishes a line
and offers a break after it, without owning a letter-spacing gap. After a forced
break inside overflowing text, all three engines also give a following ZWSP its
own line; the line-start rule still consumes that ZWSP, as before. Keeping the
leading ZWSP exposed two older mismatches that dropping its line had cancelled.
Chrome and Firefox shape an Arabic letter before a selected SHY in context, so
ZWSP, beh, SHY and beh fits in boxes where Pretext's isolated letter width does
not. A raw CR before ZWSP in pre-wrap occupies one native line, while
normalization turns that CR into a hard break. Amiri ZWSP, beh, SHY, beh and
ZWSP, U+A65C, SHY, U+A65C prepare identical widths but need different native line
counts, so no rule inside `layout()` can repair the Arabic case; it needs
contextual widths during preparation. An Arabic-letter guard across SHY, deleting
raw CR and treating CR as a zero-width break each lost other native successes.

A complete original paragraph containing only ZWSP now uses the
existing empty-line chunk representation, retaining its consumed source range.
This does not change break selection before visible text, SHY-only paragraphs,
or ZWSP-only chunks beside hard breaks. Keep the original source through analysis:
normalization can erase distinctions needed here. Chrome's normal-mode FORM FEED
followed by ZWSP occupies two lines at width 1 but one at width 100, even though
normalization reduces both inputs to ZWSP. Pre-wrap currently normalizes raw CR
and LF to the same hard boundary, although their native line existence can differ.
The standalone fix does not broaden normalization or resolve the visible-text
reproduction in #210.

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
The maintained observer retains an explicit known-failure contract for this
case and a required default-language opening-quote marker control. Temporary measurement
views preserved source addressing in later experiments, but did not establish
correct resumed widths. Do not promote those experiments or their large tables
merely because the source-boundary rule is understood.

Chromium retains the complete RTL-shaped item across ZWSP and SHY. The same text
fits intact at 25px. At 14.75px it selects a cut after SHY, reshapes the selected
text range with the surrounding original source still available, then adds a
separately shaped U+2010 hyphen in the paragraph's LTR direction. The remaining
letter is reshaped at the next line's start. The selected glyphs differ from
the original whole-run glyphs. Do not treat isolated-letter widths or one RTL
text-and-marker measurement as equivalent observations. Keeping source positions,
measurement context and selected line geometry separate still matters.

These traces used source-built Chromium 152 and cached Playwright WebKit 2272.
The Chromium controls matched installed Chrome's complete native rectangles;
WebKit matched installed Safari's line counts and horizontal geometry, but its
vertical glyph metrics differed. They establish those builds' executed paths,
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

For covered starts inside a control-affected interval, preparation measures the
original source through the first complete following grapheme, then reuses later
prepared prefix differences. The following grapheme supplies context; its own
starting position does not inherit a correction. Removing controls only helps
locate affected source intervals: measuring that altered text would be wrong.
Clipped context and long runs retain the existing measurement path.

Desktop Chromium uses the fresh remainder for intact admission; desktop Gecko
keeps original-whole-minus-consumed-prefix admission while using the fresh widths
for emergency fitting and continuing advance. Preparation resolves this choice
into numeric geometry. Safari, mobile and unrecognized environments retain the
existing path, including avoiding the extra observations. The Canvas context
must expose letter spacing before assignment: reading back an expando
is not feature support. Measurements borrow the existing context synchronously,
restore its spacing immediately, and bypass the unspaced segment cache. A new
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

## Reading Browser Output

DOM geometry is evidence to interpret, not an exact source-to-line map. Safari
can return a zero-width rectangle on the previous line before the real next-line
rectangle. Chrome can give a letter after SHY positive rectangles on both the
hyphen's line and its own. Neither “first rectangle” nor “first positive
rectangle” reliably assigns source. Range extents are not general glyph advances,
especially with kerning, signed spacing, bidi or invisible controls.

Inserting a span per grapheme can change shaping and wrapping. Normalizing the
source can change line counts too. Keep the original paragraph, normalized
paragraph and span experiment separate, each with its own height and source.
Ambiguous source placement is unknown, not a pass; an independently observed
height or visible mismatch remains useful evidence. These DOM experiments are
test tooling, not work performed during `layout()`.

A diagnostic must establish its own setup. Floats intended to force a particular
break history sometimes moved the word below the floats instead. Verify the
actual preceding breaks before interpreting the suffix. Compare resolved CSS
widths, not only requested widths, and prefer clear threshold brackets. Firefox
box widths followed 1/60px rounding in a narrow sweep, but copying that rounding
into line fitting regressed unrelated cases: box resolution does not establish
the browser's text-fit rule.

A plausible report may also belong to the wrong tab or run. Matching start/end
display settings can hide an intervening change. The harness records ownership
and environment changes; [DEVELOPMENT.md](DEVELOPMENT.md) explains the checks and
why moving between same-scale displays is acceptable for fixed-width correctness
but not for benchmarks. Per-case preservation and unknown observations are
defined in [the wrapping suite](tests/wrapping/README.md); totals alone cannot
establish an improvement.

## Rich Inline Boundaries

Rich items retain source identity even when they measure zero. Filtering them
through the flat walker's first visible line lost standalone zero-width spaces
(ZWSP); compressing the item array also made cursor and fragment indices disagree.
Preserving source is independent of calculating natural width. The fixes in
[#220](https://github.com/chenglou/pretext/pull/220) do not establish arbitrary
shaping across styled items or solve flat ZWSP wrapping inside an item.

A collapsed space's presence and advance are separate. Its style comes from the
first whitespace at the boundary, and a zero or negative advance still provides
a break opportunity. `measureText('A A') - measureText('AA')` includes the change
in A–A kerning, so it is not a clean space measurement. Measure the space itself.
After forced overflow, preserve the negative remaining width; clamping it to zero
gives a following negative gap room it did not have.

## Fonts And Other Measurement Engines

Whole-run Canvas/DOM agreement, isolated-letter agreement and matching line
breaks are separate claims. The Shantell Sans and language-context probes in
[FONT_DIAGNOSTICS.md](FONT_DIAGNOSTICS.md) explain why a prefix model that fixes
one width can still fail nearby thresholds. A matching canvas `lang` helped
Chrome and Firefox generic-font measurements, but did not fix Safari. `setLocale()`
currently controls segmentation, not Canvas font language.

Chrome's OffscreenCanvas takes the page language when it resolves a font, and
assigning an unchanged font string keeps the resolved font. After `<html lang>`
changed, a reused context kept the first language even after `clearCache()`, so
preparation now replaces the context and its caches when that language changes.
Replacing the context on every `clearCache()` also fixed it, but was rejected:
Chrome caches shaped text per canvas, so earlier measurements change later ones.
A fresh context for each suite preparation moved unrelated Amiri results in both
directions. See [FONT_DIAGNOSTICS.md](FONT_DIAGNOSTICS.md).

Feature detection must precede assignment. In the tested Safari OffscreenCanvas,
`fontKerning` and `textRendering` were absent; assigning and reading them back only
created ordinary JavaScript properties, without enabling the browser feature.

Named fonts and verified loading matter. Neither a fallback font nor a DPR 1
headless run can disprove the recorded Retina font bugs. Guessed `system-ui`
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

## Corpus Lessons

Short examples catch regressions; long text reveals accumulated differences.
Current counts belong in [corpora/dashboard.json](corpora/dashboard.json), not
here. Compare fonts after a specific text pattern exposes a problem, rather than
running every corpus under every installed font.

- **Application text:** books miss URLs, numeric expressions, emoji sequences,
  non-breaking spaces and discretionary breaks. Keep the mixed-app corpus as a
  check on those interactions. URL queries worked better as a unit through `?`
  followed by a query unit; treating the entire URL as one unit or splitting every
  query character both made results worse.
- **Arabic:** punctuation-plus-mark clusters such as `،ٍ` need their preceding
  text, while a space followed by combining marks needs the marks with the next
  word. Diagnose normalized slices in the exact corpus font using RTL Ranges,
  not offsets reconstructed from rendered text. Pair corrections, larger shaped
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
  textarea-like subset is in [README.md](README.md); a broad one-off investigation
  does not require retaining its entire brute-force matrix permanently.

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

Cold-cache scaling probes distinguish those costs from reuse. Lower retained
memory alone does not establish faster preparation, and numeric Canvas doubles
measure algorithmic work rather than browser throughput. Shared font/segment
caches accumulating until `clearCache()` are a separate lifetime concern.
