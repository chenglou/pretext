# Engine Follow-ups

Open engine work deferred from the #210 series: decisions for the maintainer, known gaps and harness debt. Gate each change against pinned main in all three installed browsers, and treat headless replays as hypotheses. When an item lands or is dropped, remove it here in the same change.

## Decisions

- Decide the public output changes the combined engine rules need: segment kinds for controls and for U+3000, raw CR, FF and VT kept in `line.text`, and U+00AD stripped from `line.text` when an unhyphenated soft hyphen stays inside text.
- Decide whether Safari cursors may land inside a grapheme. WebKit's emergency breaks step by code point on its simple font path and by ICU cluster on its complex path, while the API promises grapheme boundaries.
- Decide between a dedicated no-DOM study of Firefox's joined Arabic advances and documenting them as a limitation. Several Firefox halves of planned rules wait on it.
- Decide on a feature-detected `fontKerning` prepare option (#199, #216), which would be a no-op on Safari's OffscreenCanvas, and on other Canvas font settings (#107).
- Decide whether `prepareRichInline()` supports `whiteSpace: 'pre-wrap'` (#173, #193). Accepting it needs a native styled-inline pre-wrap oracle.
- Triage the community backlog of translations, demos, docs and feature requests.

## Line breaking

- Take a content language for line breaking (approved). Chrome's Chinese quote rules, Safari's Japanese small-kana and quote rules and Firefox's East Asian newline removal depend on it. Build it on the generated line-break class table once keep-all settles, keep `setLocale()` segmenter-only, and add no expensive browser work to `prepare()` or `layout()`.
- Land keep-all boundaries that follow each engine's pair rule: Blink keeps a pair only when both sides are letters or numbers (with a one-mark lookback), Firefox uses ICU4X's class keep set, and Safari breaks only at spaces. A first version lost rows on VS16 emoji, Thai-type digits, quote-like symbols and iOS browsers.
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
- #225: keep digits together across `:` (LB25), and attach a full-width comma to preceding digits (`00:00:00，`).
- Treat U+2000-U+200A and U+205F as break-after spaces that count their width: break after the last one in a run, never before (LB21). Narrow widths need the emergency permission below first.
- An opening bracket after emoji or digits should attach to the text that follows it. Chrome and Safari never end an emergency line with `(`; Firefox does.
- On a line that starts mid-word, Blink offers no dictionary break before the first ordinary opportunity, so soft-hyphen retreat must not target one there.
- If benchmarks show a cost, add a fast path for a joiner right after a space, which the grapheme rules make unconditional.
- Hang U+3000 at a line end as Blink and Gecko do, only where a break follows the run, and keep it on the fast path. Removing Chrome's closing-bracket carry exposes this after closing brackets.
- Allow emergency breaks inside kinsoku clusters that don't fit, such as `漢。字` in narrow boxes, together with a forward carry that keeps combining marks with their base.
- Attribute the extra Chrome losses when kinsoku emergency breaks are stacked on #234, after `〞 〟 ］ ｝`.
- Opener runs create false CJK unit boundaries (`「「|tail`).
- CJK unit construction and emergency breaks must never split a grapheme, such as a Prepend character before U+3000 or a space plus a joiner.
- Chrome breaks before `ー` (CJ), while Safari keeps it on pages without a language. Apply the attach rule to the WebKit profile once conditional Japanese starters are per engine.
- Complete the kinsoku sets with East Asian no-break-before characters outside Pretext's CJK ranges: vertical and small form variants, U+232A, and U+16FE0-U+16FE3.
- Decide kinsoku membership by a grapheme's base character, so an extender after a closing bracket doesn't cause a break before the bracket.
- Narrow the closing-quote carry and the boundary before opening quotes to UAX #14 LB19 and LB19a. Chrome breaks before `“` between East Asian characters under keep-all.
- Under keep-all, Firefox breaks after `」〵` before a letter because the mark takes the bracket's class. Pretext continues the run.
- Keep-all still differs for numeric prefixes and suffixes (`中文$100中文`), for Po symbols such as `@` and `/` in Chrome, for Blink's one-mark lookback, and for symbol and dash classes in Firefox.
- Chrome 153 changed native results for four RTL full-width bracket rows, which main now fails. Find the mechanism, or record it as browser drift.
- Model Chrome's `text-spacing-trim` on full-width punctuation, which fits on one line text that Pretext puts on two. This waits on kinsoku emergency breaks and the U+3000 hang.
- Before rerunning the CJK line-start and trim candidate, read three review findings nobody swept: untrusted Firefox rows counted as passes, trimmed paint ignoring terminal letter spacing, and one allocation per stepper call.
- When a soft hyphen's hyphen doesn't fit, retreat to an earlier fitting break, as browsers do. Installed Chrome still loses research rows to letter spacing on word joiners, soft hyphens followed by marks, and kerning across spaces, so enable it per engine only after those land.
- A combining mark after a soft hyphen moves the break and suppresses the hyphen, and a word joiner removes the break. Land this with generated attachment tables and without splitting CJK units.
- Chrome breaks before a soft hyphen that follows an overflowing letter, and never consumes a soft hyphen at a line start. Build one line-start rule shared by soft hyphens and ZWSP.
- For a chosen soft hyphen, Chromium paints U+2010 where Pretext measures `-`, and Firefox's hyphen line is one letter-spacing gap narrower. Measure across the fixture fonts before changing widths.
- Add a README caveat that Pretext assumes `hyphens: manual`.
- Give zero-advance characters (word joiners, glued ZWSP, lone marks) no letter-spacing gap, per engine: Blink per shaping cluster, WebKit only on glyphs with an advance. Several planned rules lose rows until this exists.
- A leading ZWNJ, joiner, bidi mark or bare combining mark before a long word over-counts lines. A paragraph of only soft hyphens has 1 line in Chrome and Safari but none in Pretext.
- A ZWSP right after a forced break inside a word gets its own line in all three browsers. Copying that loses hundreds of rows until joined Arabic widths, the U+3000 hang and letter spacing on invisibles land.
- If demand for Persian appears, observe how browsers render soft hyphens typed in place of ZWNJ before weighing any Arabic-script soft-hyphen policy.
- Firefox and Safari add a line for CRLF, or for a lone CR, at very narrow widths. Trace their line builders before modeling it.
- In pre-wrap, Chrome hangs preserved spaces and tabs after an overflowing letter, including a space after a tab. WebKit also hangs whole white-space runs.
- For tab stops with letter spacing, WebKit hangs whole tab runs, and Firefox grows a tab by nine times the letter spacing.
- In pre-wrap, Safari hangs a whole trailing tab run at a line end, while Pretext ends the line after the first tab that overflows. #240 loses one suite row per direction to this.
- Under keep-all, Safari offers no break on either side of NEL and fills an overflowing space-delimited word by graphemes. Outside CJK runs Pretext still breaks after NEL, as it still breaks after `-` in Latin keep-all text.
- Model lone CR, FF and VT in pre-wrap per engine instead of as hard breaks. This needs the harness contract and `line.text` decisions.
- Firefox removes a newline next to East Asian punctuation on ja and zh pages, and between wide characters. This needs the content-language decision and a re-observed Firefox corpus.
- Rich-inline items should break only where the joined text breaks (#177). WebKit breaks inside each item on its own, Chromium and Gecko follow the joined text, and Firefox shows a Myanmar alignment defect at item boundaries.
- In Chrome, line-break context crosses rich-inline items after a word-initial hyphen, as in items `foo` and U+2010 `bar baz`.

## Widths, shaping and emergency breaks

- Blink's shaping-cluster overflow units change no suite rows and help only letter-spaced complex scripts. A result-identical plain-text screen exists, but V8 builds 172 script regexes on first use, adding about 26-66ms to the first complex-script preparations on a page. Fix that cold start, then land it with the letter-spacing work that uses it.
- Allow emergency breaks in non-word runs, as all three browsers do at narrow widths: glued text, emoji and symbols, and digits that Safari marks non-word.
- Measure emergency fits in context, per engine: Chrome by right-context positions, Safari by line-start prefixes, Firefox by shaped advances (#195).
- In narrow boxes, Safari keeps two joined Arabic graphemes on a line where Pretext splits them. Trace WebKit's complex-path emergency search.
- Chrome keeps kerning when it breaks an overflowing word (`'AV'.repeat(116)` at 109px gives 22 lines, not 24). Legacy split kerning isn't observable from Canvas.
- Safari carries an overflowing word's remaining width, so the last letter overflows (`'AV'.repeat(17)` gives 3 lines, not 4). Modeling it needs a Safari fit model that loses nothing.
- Measure brackets and other neutral characters with their neighbouring script: Chrome's `(` is 6.12px alone but 11px inside an Arabic run.
- Neutral characters at soft-hyphen, space and ZWSP boundaries resolve against the paragraph direction instead of their strong neighbour.
- Chromium layout kerns across spaces, ZWSP and soft hyphens, but default Canvas doesn't report that kerning. Decide whether a kerning-enabled Canvas is viable.
- Canvas reports only kerned sums, so how much kerning falls on each side of an emergency break is unknown; legacy kern tables split it.
- Fit Chrome lines on its 1/64px LayoutUnit grid, keeping the epsilon when `devicePixelRatio` is unavailable. Round bidi runs, controls and rich items separately.
- Letter-spaced Shantell widths are 0.016px wider than Canvas with `letterSpacing` set, likely because ligatures turn off. Probe before changing measurement.
- Safari's Canvas gives isolated and fallback-font combining marks an advance they don't have in context.
- Chrome's Canvas gives VS16 about 4.9px that the DOM doesn't, and one Safari Myanmar corpus row diverges at a cluster boundary.
- Skip letter spacing inside cursive scripts, per engine. Chrome versions before 149 lack the rule or apply it differently, so choose between a README limitation and a version gate.
- Arabic letters joined across a soft hyphen are measured at isolated widths. The Chrome widths are recoverable for joining fonts; Firefox's have not been recovered from Canvas.
- Chrome and Firefox shape and kern across rich-inline item boundaries, so per-item widths miss by about 1px there; Safari doesn't. Choose between a prepare-time boundary correction for Blink and Gecko and a README limitation.

## Per-browser gaps

- Installed Firefox confirms its cluster rules around invisible characters: ZWSP plus extenders form one unit, emergency units are clusters, and bidi levels separate marks. Implement them with resolved bidi levels, and fix the cap that misfires on kerned pairs.
- Firefox keeps a Myanmar spacing mark such as U+102C with the previous cluster where Unicode graphemes split it. Record Firefox's `Intl.Segmenter` output, then model Gecko cluster starts, which rich-inline boundaries need too.
- Firefox charges no hyphen for a soft hyphen at an ordinary break opportunity.
- Firefox fits lines at app-unit rounding of the width, fits negative letter spacing before preserved spaces differently, and paints hidden controls at zero advance plus letter spacing.
- Firefox trims U+1680 at line edges in normal white-space.
- Trace Firefox's hang and trim rules for spaces, CR, FF and tabs at line end before encoding any rule for controls.
- Firefox's segmenter marks a letter plus word joiner non-word inside spaced text, so the run gets no emergency breaks. Derive permission from Pretext's own grapheme data.
- Find a witness for whether `direction: rtl` alone enables Firefox document bidi.
- The Firefox halves of the planned rules stay on main's behaviour until installed Firefox evidence exists for each.
- Record `Intl.Segmenter` word-likeness for emoji, U+2605 and digit strings in installed Safari and Firefox.
- The iOS profile patch has no device evidence: iOS fonts, older iOS ICU without the Hebrew LB20a rule, EU alternative engines, and Edge's iPad desktop user agent.
- On each new Safari, recheck WebKit changes that haven't shipped yet: keep-all punctuation breaks, first-glyph kinsoku and the 0.5ch tab minimum.
- Say in README that Safari's OffscreenCanvas doesn't follow the page language, while a connected canvas does (WebKit bug 285993). Also correct FONT_DIAGNOSTICS' Safari number, which came from a detached canvas.
- No canvas follows an element's own `lang`, a Worker's context, or a runtime Content-Language change. Add a short README note.
- Safari page-language attribution left two things open: why Amiri `il` at a line start measures 2.544px or 7.416px, and 1,117 Japanese width-only differences. Revisit with the content-language decision.

## Harness and tooling

- Differences found only outside the suite, in headless probes or research families, don't block a change that loses nothing in the installed gate. Name them in the PR and VALIDATION.md, and list the ones worth fixing here.
- A candidate that changes the harness normalization contract gates from its own harness and also runs once from main's harness, so contract-masked losses stay visible. For newline removal next to ZWSP, its own harness shows +20 metrics per Chrome and Firefox direction, and main's shows the same 12 rows per direction as losses.
- A generated UAX #14 line-break class table (a two-stage ASCII string, about 2.6KB min+gz) could replace hand-maintained class sets, but today it would add about 1.7KB gz to every bundle while fixing only U+09FA. Land it with the first change whose class sets would cost more as range arrays, never ahead of one. Meanwhile, a hand-run script could check each hand set against `LineBreak.txt` without shipping data.
- Read `<html lang>` once per `prepare()` in the next measurement change; it reads twice today. Record the measured cost in RESEARCH.md: about 3-16ns per read in headless WebKit and Chromium, with no style or layout work.
- Run an installed full-suite Firefox sweep before enabling any Gecko rule; Chromium with a Gecko user agent can't see thousands of rows.
- Record installed observations for the planned engine rules, whose numbers are still headless. Rules that change the harness contract need their own harnesses.
- Several documented research recipes never ran in installed browsers: glue next to dashes, soft hyphens and CJK, CJK bracket followers, and older named research sections. Their losses rest on headless evidence.
- Rich-inline research lacks several loss shapes, such as an emoji modifier split across items and bold items. Its Latin rows were never compared against the maintained witnesses' page type.
- Compare Arabic corpus line placement near 320-780px in installed browsers with a Range-based diagnostic; the gate scores counts, not placement.
- Observe hyphen placement beyond the tiny discretionary protocol, so a wrong hyphen with the right line count fails.
- Correct INVENTORY: three rows it lists as API failures now pass, although their native misses remain.
- Before refreshing benchmark snapshots, add benchmark cases for U+3000 indentation, VS16 emoji paragraphs, long invisible tails and letter-spaced CJK, and numeric recipes for soft-hyphen, mark and control shapes.
- Settle shared representations once before combining engine rules: the unspaced Chromium hyphen, one per-grapheme letter-spacing unit, and lazily allocated per-segment arrays.
- The Blink and WebKit rules that hide each other's errors (soft hyphens, U+3000, Arabic widths, controls, kinsoku, letter spacing, line fit) can only gate together. Build them in layers, with a replay after each layer.
- Name the origin set behind VALIDATION's 3,635 LTR recipe rows, which include 51 issue #212 and #214 rows.
- Add `(#230)` to its CHANGELOG line.
- Cite the HTML spec for the OffscreenCanvas language snapshot in PLATFORM_BUGS, and fix VALIDATION's sentence about the older cohorts' document language.
- Treat headless replay numbers as advisory: headless Chromium ships an older ICU than installed Chrome, and there is no headless Firefox.
- Accepted losses live only in VALIDATION prose and go silent once the pin advances. If they become frequent, consider a gated `changedFailures` report.
- Assign Range points to lines with the harness `pointLine()` rule, never `rects[0]`: Safari gives a line-initial character a zero-width rect at the end of the previous line. Consider a sentence next to the Safari extractor caveats in DEVELOPMENT.md.
- Checker logs print harmless osascript -1728 errors when restoring the frontmost app; resolve the app by bundle id. Record screen and viewport per leg in the run manifest, since some Safari legs ran on the portrait screen.
- If the research harness is promoted, document that `--family=r0912/` needs the trailing slash, and drop the `hlg` candidate, which duplicates `current`.

## External actions

- Rerun the Retina emoji and `system-ui` repros headed at DPR 2. The trackers were rechecked on September 12.
- Compare the gallery's local Pretext 0.0.8 patch, which changes overflow fit, overflow-word kerning, continuation widths, tabs and caret ranges, with upstream.
- Review and merge #226, which fixes broken preload links in the published bubbles demo.
- Close the superseded draft PRs #218 and #112.
