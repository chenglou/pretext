# Engine Follow-ups

Open engine work: decisions for the maintainer, known gaps and harness debt.

## Decisions

- Decide on other Canvas font settings (#107), including whether a kerning-enabled Canvas is viable: Chromium layout kerns across spaces, ZWSP and soft hyphens, but default Canvas doesn't report that kerning. README says Pretext assumes default font kerning; #199 and #216 stay open in case Safari's OffscreenCanvas ever follows `fontKerning`.
- Decide whether `prepareRichInline()` supports `whiteSpace: 'pre-wrap'` (#173, #193). Accepting it needs a native styled-inline pre-wrap oracle.
- Revisit what rich-text editing needs from Pretext: source offsets through whitespace normalization (#90) and caret positions (#198), and whether bidi selection and copy/paste behavior stay outside this package. Do a pass over the open demo and showcase issues (#94, #99, #150, #167).

- Decide whether deleting the simple line walker holds up: every handle now takes the complex walker, which moves a collapsible space after overflowing line-start content to the start of the next line, where the simple walker kept it on that line. This waits for `pages/benchmark.ts` in Chrome and Safari and for the wrapping gate.
- Check in Safari that an explicit bidi control in another paragraph leaves a word's kerning with a following space (`maintained/pieces`). If Safari reads controls across paragraphs, revert the paragraph scope, and the pre-wrap pieces guarantee excludes Safari texts with explicit controls.

## Line breaking

- Follow the page language in the remaining line-break rules (approved). Preparation reads `<html lang>` once and resolves it to `ja`, `ko`, `zh` or root, with no `prepare()` option; only Safari's small-kana and `ー` rule uses it so far. Remaining layers: Safari's quote rules on `ja` pages, and Chrome's quote, `〜` and `゠` rules on `zh` pages (RESEARCH.md). Build them on the generated line-break class table, keep `setLocale()` segmenter-only, and rerun the family in each installed browser before each layer.
- On every page, Chrome breaks after a closing curly quote before CJK text (`他说“你好”` / `然后走了`), while Pretext's closing-quote carry keeps the CJK attached. No browser treats curly single quotes around Latin text as brackets, and Firefox doesn't treat double quotes as brackets, but Pretext does. Narrow the closing-quote carry and the boundary before opening quotes to UAX #14 LB19 and LB19a.
- At the start of a word, Firefox breaks after each observed hyphen dash, but Pretext still keeps U+05BE, U+1400, U+2E17 and U+058A with the next letter there. No installed browser was observed on U+2E40, U+2E5D, U+10D6E or U+10EAD.
- Safari keeps `-` after U+2007 with the following letter but breaks after `-` following NBSP. Chrome and Safari keep U+2010 after either glue. Model both with the glue context rules.
- A dash before no-break glue should break after the dash (LB12a). Pretext breaks before it, for NBSP and U+2007 alike.
- Soft hyphens, CJK and joined Arabic next to no-break glue still lose line text outside the suite. Record installed observations before modeling them.
- Chromium keeps no-break glue on a soft hyphen's line, where WebKit breaks before the glue. Trace Blink before modeling it.
- Under keep-all, Pretext adds a break after NBSP before CJK that installed Safari doesn't paint. Fix the NBSP boundary and add U+2007 in the same change.
- Confirm U+2007's line-break class in ICU4X's data; the Firefox figure-space mechanism is known from source only.
- URL query units should keep the browser's break after a hyphen: a query starting with `?-a` breaks after `-` natively.
- Unmodeled pair-table contexts: exclamation marks before punctuation such as `※` or `†` (`x!※b`), LB20a before symbols and after openers or quotes, Chrome keeping `-` with a following Latin-1 letter, and Yi or Cham followers.
- After a space, browsers break between the space and a following extender cluster, such as a skin-tone modifier plus ZWJ. Pretext folds the extender into the space.
- Split numeric runs after en and em dashes (`10–20`, `1990—2000`), as it already does for `-`, so lines can break after the dash.
- Safari and Firefox keep `n2-1o(r)` together where Pretext breaks after the hyphen. Trace their rules for a hyphen between a digit and a letter before deciding whether real text needs a rule; realistic items such as `v2` followed by `-1 or later` already match.
- After Latin letters, Pretext still allows a break before closing punctuation (CL, CP, EX, IS) and NS such as `，`, `」` or `：`, which UAX #14 forbids (LB13, LB21). Numeric runs already keep it. #245 tried attaching them: it creates kinsoku units that get no emergency breaks, so it lost 42 Chrome, 52 Safari and 52 Firefox LTR rows, mostly shapes like `739x「value」! end`. Land it after emergency breaks inside kinsoku clusters.
- A time inside brackets such as `(10:30)，b` still allows a break before the full-width comma, because the bracketed run doesn't count as a numeric run.
- Firefox keeps a date such as `2025-08-01` whole, where Chrome and Safari break after its hyphens. Pretext splits it for every engine, so #225's first reproduction is only observed in Firefox.
- Treat U+2000-U+200A and U+205F as break-after spaces that count their width: break after the last one in a run, never before (LB21). Narrow widths need the emergency permission below first.
- An opening bracket after emoji or digits should attach to the text that follows it. Chrome and Safari never end an emergency line with `(`; Firefox does.
- On a line that starts mid-word, Blink offers no dictionary break before the first ordinary opportunity, so soft-hyphen retreat must not target one there.
- If benchmarks show a cost, add a fast path for a joiner right after a space, which the grapheme rules make unconditional.
- Hang U+3000 at a line end as Blink and Gecko do, only where a break follows the run, and keep it on the fast path. Removing Chrome's closing-bracket carry exposes this after closing brackets.
- Allow emergency breaks inside kinsoku clusters that don't fit, such as `漢。字` in narrow boxes, together with a forward carry that keeps combining marks with their base. All three engines break inside them under `overflow-wrap: break-word`. Stacked on the closing-punctuation attachment above, it fixed 624 Chrome, 1,197 Safari and 993 Firefox LTR metrics and lost 510, 108 and 200. Chrome's losses are mostly raw-context rows with controls before openers, U+3000 hang rows and mark rows, which main passes only while those errors cancel out. Firefox, and Safari on pages other than `ja` and `ko`, still split `本ーー` in an emergency, where Pretext keeps a kinsoku unit whole.
- Opener runs create false CJK unit boundaries (`「「|tail`).
- CJK unit construction and emergency breaks must never split a grapheme, such as a Prepend character before U+3000 or a space plus a joiner.
- After a digit or Latin letter, as in `約3ヶ月` or `日本abcァア`, installed Firefox keeps small kana and `ー` with the character before them on every page, and Safari does on pages other than `ja` and `ko` (the `cj/digit-*` and `cj/latin-*` rows of `maintained/content-language`, RESEARCH.md). The profiles that resolve CJ to NS (Safari on those pages, Firefox and unrecognized engines) still let them start a line there, because only CJK text takes a following piece that starts with CJ. Attach that piece after any text, not only CJK text.
- Complete the kinsoku sets with East Asian no-break-before characters outside Pretext's CJK ranges: vertical and small form variants, U+232A, and U+16FE0-U+16FE3.
- Decide kinsoku membership by a grapheme's base character, so an extender after a closing bracket doesn't cause a break before the bracket.
- Under keep-all, confirm that the Gecko profile ends the run after `」〵` before a Latin letter too; `src/layout.test.ts` covers only an ideograph follower.
- Keep-all still differs for numeric prefixes and suffixes (`中文$100中文`), for Po symbols such as `@` and `/` in Chrome, for Blink's one-mark lookback, and for symbol and dash classes in Firefox.
- Under keep-all, a run still ends after a Hebrew letter followed by `-`, U+2010, U+2013, U+0964, U+0965, U+104A or U+104B, where both engines keep the next character (LB21a).
- Chrome 153 changed native results for four RTL full-width bracket rows, which main now fails. Find the mechanism, or record it as browser drift.
- Model Chrome's `text-spacing-trim` on full-width punctuation, which fits on one line text that Pretext puts on two. This waits on kinsoku emergency breaks and the U+3000 hang. Before rerunning the CJK line-start and trim candidate, read three review findings nobody swept: untrusted Firefox rows counted as passes, trimmed paint ignoring terminal letter spacing, and one allocation per stepper call.
- When a soft hyphen's hyphen doesn't fit, retreat to an earlier fitting break in WebKit and Gecko too, once letter spacing on invisible characters and marks after a soft hyphen land (RESEARCH.md).
- A combining mark after a soft hyphen moves the break and suppresses the hyphen, and a word joiner removes the break. Land this with generated attachment tables and without splitting CJK units.
- Chrome breaks before a soft hyphen that follows an overflowing letter, and never consumes a soft hyphen at a line start. Build one line-start rule shared by soft hyphens and ZWSP.
- For a chosen soft hyphen, Chromium paints U+2010 where Pretext measures `-`, and Firefox's hyphen line is one letter-spacing gap narrower. Measure across the fixture fonts before changing widths.
- Give zero-advance characters (word joiners, glued ZWSP, lone marks) no letter-spacing gap, per engine: Blink per shaping cluster, WebKit only on glyphs with an advance. Several planned rules lose rows until this exists.
- A leading ZWNJ, joiner, bidi mark or bare combining mark before a long word over-counts lines. A paragraph of only soft hyphens has 1 line in Chrome and Safari but none in Pretext.
- A ZWSP right after a forced break inside a word gets its own line in all three browsers. Copying that loses hundreds of rows until joined Arabic widths, the U+3000 hang and letter spacing on invisibles land.
- A leading ZWSP before some closing quotes (locale-dependent) can still wrap differently; U+201D locale tailoring remains unmodeled.
- If demand for Persian appears, observe how browsers render soft hyphens typed in place of ZWNJ before weighing any Arabic-script soft-hyphen policy.
- In pre-wrap, Chrome hangs preserved spaces and tabs after an overflowing letter, including a space after a tab. WebKit also hangs whole white-space runs.
- For tab stops with letter spacing, WebKit hangs whole tab runs, and Firefox grows a tab by nine times the letter spacing.
- In pre-wrap, Safari hangs a whole trailing tab run at a line end, while Pretext ends the line after the first tab that overflows. #240 loses one suite row per direction to this.
- Under keep-all, Safari offers no break on either side of NEL and fills an overflowing space-delimited word by graphemes. Outside CJK runs Pretext still breaks after NEL, as it still breaks after `-` in Latin keep-all text.
- Model lone CR, FF and VT in pre-wrap per engine instead of as hard breaks. Firefox and Safari also add a line for CRLF, or for a lone CR, at very narrow widths; trace their line builders first. This needs the harness contract change.
- Firefox removes a newline next to East Asian punctuation on ja and zh pages, and between wide characters. This needs a re-observed Firefox corpus.
- Model Gecko's word segmentation, then enable joined-text rich-inline breaks in Firefox (#177) with an installed re-gate.
- In Chrome, line-break context crosses rich-inline items after a word-initial hyphen, as in items `foo` and U+2010 `bar baz`.

## Widths, shaping and emergency breaks

- Blink's shaping-cluster overflow units change no suite rows and help only letter-spaced complex scripts. A result-identical plain-text screen exists, but V8 builds 172 script regexes on first use, adding about 26-66ms to the first complex-script preparations on a page. Fix that cold start, then land it with the letter-spacing work that uses it.
- Allow emergency breaks in non-word runs, as all three browsers do at narrow widths: glued text, emoji and symbols, digits that Safari marks non-word, and a letter plus word joiner that Firefox's segmenter marks non-word inside spaced text. Derive permission from Pretext's own grapheme data.
- Measure emergency fits in context, per engine: Chrome by right-context positions, Safari by line-start prefixes, Firefox by shaped advances (#195).
- In narrow boxes, Safari keeps two joined Arabic graphemes on a line where Pretext splits them. Trace WebKit's complex-path emergency search.
- Chrome keeps kerning when it breaks an overflowing word (`'AV'.repeat(116)` at 109px gives 22 lines, not 24). Legacy split kerning isn't observable from Canvas.
- Safari carries an overflowing word's remaining width, so the last letter overflows (`'AV'.repeat(17)` gives 3 lines, not 4). Modeling it needs a Safari fit model that loses nothing.
- Measure brackets and other neutral characters with their neighbouring script: Chrome's `(` is 6.12px alone but 11px inside an Arabic run.
- Neutral characters at soft-hyphen, space and ZWSP boundaries resolve against the paragraph direction instead of their strong neighbour.
- In Chrome, text is measured under the page direction (`<html dir>`) from when Pretext first measured, or last saw `<html lang>` change. Text whose direction differs from the page, like an Arabic paragraph on an LTR page, can wrap slightly differently around brackets and other neutral characters.
- Fit Chrome lines on its 1/64px LayoutUnit grid, keeping the epsilon when `devicePixelRatio` is unavailable. Round bidi runs, controls and rich items separately.
- Letter-spaced Shantell widths are 0.016px wider than Canvas with `letterSpacing` set, likely because ligatures turn off. Probe before changing measurement.
- Safari's Canvas gives isolated and fallback-font combining marks an advance they don't have in context.
- Chrome's Canvas gives VS16 about 4.9px that the DOM doesn't, and one Safari Myanmar corpus row diverges at a cluster boundary.
- Headless WebKit sweeps lose a few native line counts in italic 18px Times New Roman, 17px Hoefler Text and italic 16px Gill Sans; those have not been diagnosed.
- Skip letter spacing inside cursive scripts, per engine. Chrome versions before 149 lack the rule or apply it differently, so choose between a README limitation and a version gate.
- Arabic letters joined across a soft hyphen are measured at isolated widths; the Chrome widths are recoverable for joining fonts. Prototype the gated per-grapheme ZWJ recipe for the Gecko profile (FONT_DIAGNOSTICS.md), together with the Firefox halves of the planned rules that wait on it.
- Chrome and Firefox shape and kern across rich-inline item boundaries, so per-item widths miss by about 1px there; Safari doesn't. Consider a prepare-time boundary correction for Blink and Gecko.

## Per-browser gaps

- Installed Firefox confirms its cluster rules around invisible characters: ZWSP plus extenders form one unit, emergency units are clusters, and bidi levels separate marks. Implement them with resolved bidi levels, and fix the cap that misfires on kerned pairs.
- Firefox keeps a Myanmar spacing mark such as U+102C with the previous cluster where Unicode graphemes split it. Record Firefox's `Intl.Segmenter` output, then model Gecko cluster starts, which rich-inline boundaries need too.
- Firefox charges no hyphen for a soft hyphen at an ordinary break opportunity.
- Firefox fits lines at app-unit rounding of the width, fits negative letter spacing before preserved spaces differently, and paints hidden controls at zero advance plus letter spacing.
- Firefox trims U+1680 at line edges in normal white-space.
- Trace Firefox's hang and trim rules for spaces, CR, FF and tabs at line end before encoding any rule for controls.
- Find a witness for whether `direction: rtl` alone enables Firefox document bidi.
- Record `Intl.Segmenter` word-likeness for emoji, U+2605 and digit strings in installed Safari and Firefox.
- The iOS profile patch has no device evidence: iOS fonts, older iOS ICU without the Hebrew LB20a rule, EU alternative engines, and Edge's iPad desktop user agent.
- On each new Safari, recheck WebKit changes that haven't shipped yet: first-glyph kinsoku and the 0.5ch tab minimum.
- No canvas follows an element's own `lang`, a Worker's context, or a runtime Content-Language change. Add a short README note.
- Safari page-language attribution left two things open: why Amiri `il` at a line start measures 2.544px or 7.416px, and 1,117 Japanese width-only differences. Revisit with the content-language decision.

## Harness and tooling

- Run an installed full-suite Firefox sweep before enabling any Gecko rule; Chromium with a Gecko user agent can't see thousands of rows.
- Record installed observations for the planned engine rules, whose numbers are still headless. Rules that change the harness contract need their own harnesses.
- Several documented research recipes never ran in installed browsers: glue next to dashes, soft hyphens and CJK, CJK bracket followers, and older named research sections. Their losses rest on headless evidence.
- Rich-inline research lacks several loss shapes, such as an emoji modifier split across items and bold items. Its Latin rows were never compared against the maintained witnesses' page type.
- Compare Arabic corpus line placement near 320-780px in installed browsers with a Range-based diagnostic; the gate scores counts, not placement.
- Observe hyphen placement beyond the tiny discretionary protocol, so a wrong hyphen with the right line count fails.
- Correct INVENTORY: three rows it lists as API failures now pass, although their native misses remain.
- Add benchmark cases for U+3000 indentation, VS16 emoji paragraphs, long invisible tails and letter-spaced CJK, and numeric recipes for soft-hyphen, mark and control shapes.
- Settle shared representations once before combining engine rules: one per-grapheme letter-spacing unit and lazily allocated per-segment arrays.
- The Blink and WebKit rules that hide each other's errors (soft hyphens, U+3000, Arabic widths, controls, kinsoku, letter spacing, line fit) can only gate together. Build them in layers, with a replay after each layer. The public output changes they need are approved: segment kinds for controls (landed for NEL in the WebKit profile) and for U+3000, raw CR, FF and VT kept in `line.text`, and U+00AD stripped from `line.text` when an unhyphenated soft hyphen stays inside text.
- Name the origin set behind VALIDATION's 3,635 LTR recipe rows, which include 51 issue #212 and #214 rows.
- Cite the HTML spec for the OffscreenCanvas language snapshot in PLATFORM_BUGS.
- Accepted losses live only in VALIDATION prose and go silent once the pin advances. If they become frequent, consider a gated `changedFailures` report.
- Checker logs print harmless osascript -1728 errors when restoring the frontmost app; resolve the app by bundle id. Record screen and viewport per leg in the run manifest, since some Safari legs ran on the portrait screen.

## External actions

- Rerun the Retina emoji and `system-ui` repros headed at DPR 2. The trackers were rechecked on September 12.
- Compare the gallery's local Pretext 0.0.8 patch, which changes overflow fit, overflow-word kerning, continuation widths, tabs and caret ranges, with upstream.
