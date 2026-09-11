# Wrapping test inventory

This directory is the shared source of wrapping inputs. Main, old wrapping worktrees and new experiments run the same selected inputs and the same observer. Candidate code never supplies the expected browser result. Known failures stay in the inventory; a passing total cannot conceal a newly failing case or an unobserved metric.

`cases.ts` joins maintained data, deterministic width recipes, the retained experimental input union, filed reproductions and explicit observer controls. It deduplicates **semantic inputs**, merging their origins. Text, item partition, font, width, line height, whitespace, word breaking, spacing, direction, content language and preparation locale are distinct inputs. Historical report names and candidate labels are provenance, not expected outcomes.

## What is runnable

- **Source-view controls:** `fixtures/source-views.ts` retains 23 opposing inputs from the focused wrapping investigation, included in both ordinary and full. They cover original versus resumed SHY source positions, SPACE/TAB ownership, intact versus cut mark geometry, interior-control spacing, overlapping source pieces, and font/long-tail counterexamples. Three already-retained inputs gain provenance and twenty are new. These use the shared native/API observer and passing-baseline protection. Unsupported SHY selection remains explicitly unobserved; these inputs do not declare an experimental implementation correct.

- **Maintained accuracy:** imports `TEXTS`, `SIZES`, `WIDTHS` and `ACCURACY_FONTS` from `src/test-data.ts`. The original grid has 7,680 rows per browser. Its observation scope remains height-only.
- **Maintained corpora:** imports all 18 existing corpus text files and their metadata. The complete step-10 sweep has 1,098 rows. As in the original corpus page, preparation receives raw text while the independent native paragraph uses normal-whitespace normalization. The old panel widths include 80px padding; the shared inputs use the corresponding content widths. These are height-only observations; the suite does not read every character's rectangles across whole books.
- **Maintained small oracles:** imports the existing pre-wrap, keep-all, symbol, letter-spacing and discretionary cases directly, retaining their default modes, content widths, content languages, extraction methods and browser restrictions. Pre-wrap and letter-spacing require height/count; keep-all and symbol cases also require line-break agreement. The discretionary page and shared suite use the same eight checked text/width contracts and three characterization inputs. The original height acceptance rules remain explicit: accuracy allows a difference below 1px; corpus retains its rounded-height comparison; compact checks require the exact-height tolerance. Corpus misses remain observations, not an all-green requirement.
- **Policy recipes:** `fixtures/policy.ts` preserves the complete 3,154-row source-policy generator, including its original 700 controls, and the explicit-language, seam and acceptance generators. Their fractional widths come from the current browser's Canvas and are independent of candidate code. Historical `heldout` labels are provenance only: these cases have already been inspected during development.
- **Retained exact inputs:** `fixtures/retained.ts` and `fixtures/retained.json` reproduce the same 209,138 distinct fixed-width public inputs as frozen commit `a56d0f9`. They contain no native output, prepared arrays, copied line walker or candidate prediction. Repeated sources and width lists are shared across correlated option records; endpoint sweeps substitute their explicitly listed codepoints; two following-space grammars generate their finite original combinations. Complete cohorts remain available in `full`. The original 14-family selection's **122 evidence records are all represented**, including inputs shared by multiple browser records.
- **Filed-report coverage:** PR #208 for issue #206, #210/#211, #212/#213 and #214/#215 are labeled explicitly. Five exact report inputs retain the original CSS fonts, widths, line heights and modes: #210's Calibri/sans-serif at 25px, both #212 numeric strings at their measured prefix plus 0.1px, and #214's pre-wrap CJK source at its measured prefix plus 0.1px. This boundary-policy branch requires native height, line count, visible-source placement and public API agreement for the three #212/#214 inputs. The two #210 inputs remain observed known failures, with passing baseline metrics still protected; fixing #210 is outside this branch’s scope. The observer independently measures the used native line-box advance for fractional CSS line heights, including #210’s 20.96px; API height remains checked against the explicit requested value. Calibri may use the declared sans-serif fallback; the suite observes that same installed-font stack and does not claim the face is installed. The six exact #208 mixed-symbol width/spacing cases also require height, source placement and API agreement. Historical variants and nearby controls remain separately reported. These checks do not imply that broad issue #206 is solved. Emoji-containing mixed runs retain their separate ordinary-boundary limitations; exact emoji-plus-bracket counterexamples and nearby controls are included in ordinary.
- **Native rich ZWSP height:** twelve same-font, normal-mode witnesses use actual inline spans for the original item boundaries, including empty items, preceding content, forced/partial/unbroken widths and signed-spacing controls. Their independent `richHeight` metric compares the native paragraph with the rich public walk and must pass on this branch. It does not infer rich correctness from a flat-layout or API-agreement pass. Chrome/Safari's historical 81-case matrix motivated these observations; fresh runs observe every browser directly. The flat #210 reproduction remains an observed known failure. Range line text is unreliable for some Safari witnesses, so this protocol does not claim native rich source boundaries, style changes or general rich paragraph shaping.
- **API contracts:** the same applicable source inputs feed the public API checks in `contracts.ts`. Rich-item checks preserve item/source identity and compare the rich methods with each other; concatenating text does not establish that native shaping or rich layout must equal a single flat text node.
- **Native rich admission:** two required same-font inputs retain exact-fit trailing ZWSP and a negative-advance WJ after forced overflow. The opposing mixed-style trailing-SPACE/separate-SPACE paragraphs remain research evidence; this observer does not erase their style differences to turn them into flat cases.
- **Direction conflicts:** `fixtures/direction-conflicts.json` retains the exact conflicting LTR/RTL inputs identified by the earlier input-contract investigation. Only the originating browser's exact recorded rows are marked `research`; their API invariants still apply. Other RTL cases remain supported. These cases need an input-contract decision because the public prepare/layout arguments do not include paragraph direction.
- **Observer controls:** seven small hidden/selected/repeated-SHY, leading-ZWSP and preserved-whitespace cases exercise the observation machinery itself.
- **Emergency grapheme contracts:** eight explicit single-cluster/continuous-word cases check whole-source grapheme boundaries at width 1. This does not impose a grapheme rule on unrelated natural break opportunities.

The `ordinary` schedule runs the complete maintained accuracy, corpus and applicable small-oracle suites, filed reproductions, observer and grapheme controls, the small policy acceptance recipe, direction-conflict witnesses, and the deliberate retained selection below. `full` additionally runs the broad policy/language/seam recipes and every retained investigation combination. They share one generator, observer and assertion contract. All aliases and observation requirements merge before scheduling or family filtering; an ordinary input has the same ID and assertions in full. Different native-source, extraction or height protocols have separate IDs even when their public preparation arguments coincide.

The full schedule contains roughly 221,000 cases. Ordinary contains roughly 11,000, including all 8,778 maintained accuracy/corpus rows. Exact totals depend on browser restrictions and candidate-independent Canvas width recipes. Runtime selection uses explicit behavioral selectors, not per-family quotas, hash ordering or candidate results. Family filtering is explicit and reported. Adding a case or changing a recipe changes the inventory revision; an older pass does not apply automatically.

This is not complete acceptance coverage for every issue discussed during the
investigation. The exact Shantell #195 case (56 `x` characters, bold 15px, width
140) remains in `pages/font-probe.ts`, a separate diagnostic; the shared suite
contains related Shantell controls. Issue #177 / PR #194 still needs a styled
native-inline wrapping oracle: same-font item partitions and agreement between
rich APIs do not establish it. Issue #173 / PR #193 proposes rich-inline
`pre-wrap`, which is unsupported and has no acceptance protocol here. Rich gap
geometry alone does not establish underline, selection or copied-space behavior.
Earlier fixed numeric-affix, opening-punctuation and CJK-annotation examples also
retain their exact assertions in `src/layout.test.ts`; those should not be
described as exact browser reproductions merely because related families occur
in this inventory.

## Ordinary behavioral selection

`fixtures/ordinary.ts` records the behavior, exact evidence paths, nearby controls and relevant dimensions together. Its counts below are distinct selected fixed inputs per behavior; overlapping behaviors are not summed into an accuracy score. Full investigations remain useful when changing their corresponding policy or measurement model.

| Behavior | Ordinary inputs | Why these dimensions remain |
| --- | ---: | --- |
| Original punctuation/numeric/URL policy | 86 | All 122 original evidence records, with exact captured thresholds, both whitespace modes where implicated, and explicit language/direction inputs. |
| Historical allocation regressions | 178 | The specifically identified Safari 162 and Firefox 16 inputs, preserving their fonts, spacing and widths. |
| Restart and source rights | 250 | Individually isolated lost successes for source endpoints, restart admission, signed prefixes, zero rights and canceled visible glyphs. |
| Selected hyphen origin | 403 | Opposing signed-space witnesses, exact threshold/v3 counterexamples, leading ZWSP before Arabic SHY and neighboring captured widths, and leading/resumed/repeated SHY controls with WJ, NUL, ZWSP and U+3000. |
| Language and dictionary | 70 | Five-source default/explicit preparation locale and native content-language/reset comparisons. |
| Carried versus fresh geometry | 10 | Short versus ordinary following word around the exact carried-admission threshold. |
| Negative SPACE advance | 60 | Leading/interior preserved spaces, signed/zero spacing, proportional/monospace fonts, narrow/completed-item widths. |
| Control and mark shaping | 42 | ZWSP/WJ/repeated SHY adjoining marks, ordinary/ligature controls, exact Arial/Shantell and signed spacing. |
| Partial advance thresholds | 12 | Exact Latin SHY and Safari ligature thresholds, adjacent captured widths, SHY direction and zero-spacing controls. |
| ASCII opener domain | 66 | Exact AL/QU opener losses, CJK-leading mixed-run precedence, signed/zero-spacing controls, and Unicode-affix guillemet/curly-quote sources retaining the unmodeled domain. |
| Emoji and punctuation boundaries | 60 | Exact bracket-prefix W24 losses, captured W8/W40 controls, balanced brackets and hyphens in Amiri/Times and both directions. |
| Embedded emoji controls | 38 | SHY/ZWSP inside ZWJ and modifier sequences, unbroken controls, forced/visible-prefix widths, original Arial sizes and whitespace modes. |
| Unicode-space source | 24 | Exact U+2006 punctuation-context whitespace loss, U+2002/U+3000/NBSP controls, neighboring widths and both whitespace modes. |
| TAB interval and progress | 248 | Leading/interior/repeated/terminal TAB, zero-interval spacing boundary, exact positive-spacing repeated-TAB and negative-spacing terminal-TAB regressions with neighboring controls. |
| Separator source ownership | 301 | SPACE/NBSP/U+3000, leading/terminal/repeated separators, marks, whole-grapheme versus scalar hanging, TAB+ZWSP narrow/keep-all failures with font/mode/width controls, and signed U+3000+ZWSP. |
| Directional opener context | 4 | Leading RTL mark versus unmarked opener, exact Times 24px witness and LTR/RTL controls. |
| Raw control endpoints | 143 | Every C0/C1 scalar in a fixed Latin source at forced/visible-prefix widths, plus PUA, surrogate, bidi-control and the exact noncharacter/SHY API failure. |
| Following-space context | 144 | Flat versus partitioned source, actual SPACE versus control source, Latin/Arabic/Hebrew/SHY contexts, narrow/wide controls. |
| Following-space metrics | 23 | FEFF/emoji before SPACE under negative spacing and collapsed repeated SPACE width; exact Arial/Times witnesses with zero-spacing, neighboring-width and relevant mode/direction controls. |
| Bounded source length | 8 | Original short, near-cap punctuation and long combining-cluster probes. |

The two documented main API failures, `wrap-5123bf2f598e26a1` and `wrap-d100ee2cf3c97c9a`, remain in ordinary. They are still failures. Full preserves all other captured failures and successes as independently observed inputs; curation does not turn either outcome into an expected answer.

## Faithful recipe reduction

The retained JSON shrank from 4,261,040 to 1,635,525 bytes. The original 4,758 profiles repeated 41,449 source records. The new file has 1,065 source groups with correlated settings; 234 endpoint recipe groups replace 1,672 repeated codepoint profiles, and two explicit following-space grammars regenerate 32,076 original rows. Dyadic threshold sequences use exact start/step/count spans; arbitrary fractional thresholds remain literal numbers. U+FFF0 is a fixture-only codepoint slot, replaced before any input reaches preparation or the observer.

The migration compared the complete expanded set with `a56d0f9`: 209,138 inputs before and after, zero additions, omissions, origin changes or family changes. Both sorted semantic sets have SHA-256 `b6849c304ca383dbef03202952bb19878ed9217525ca687a9093feab3611e5fa`. This is an input-preservation audit, not a browser correctness claim. The separate maintained-oracle corrections described above intentionally restore their original protocol and are not relabeled as unchanged inputs.

## Provenance and curation

`fixtures/provenance.json` records imported source files, SHA-256 hashes, complete input counts, duplicate aliases and rows that were not wrapping inputs. The source paths are relative to the original wrapping evidence directory, `01a066d4-77ab-7d90-9cbd-80bb870c71da`; they identify history and are **not read at runtime**. Every runnable input is checked in here or imported from maintained repository data.

The compact data covers all ordinary public inputs in the bounded round's 235-run index and standalone input sets, including raw-control, surrogate/PUA, endpoint, dual-direction, source-window and locale replays. It also retains the final three-browser comparison inputs, the historical Safari 7,776-row cohort, earlier tab/SHY matrices, script/spacing controls, the Firefox emoji-size matrix, cross-item cohorts and ligature/threshold inputs. Byte-identical input files are aliases; equal semantic inputs merge origins. A source file's archived native capture is not reused as a current-browser expectation.

Preparation locale is separate from native content language. The dedicated language matrices' `prepareLocale` field is retained as `locale`; ordinary bounded harnesses explicitly align locale to `lang`. Archived cross-item inputs whose manifest says `alignLocale: false` retain the runtime default. The provenance records this policy, and semantic deduplication includes locale. Empty reset values normalize to the default locale. For example, each five-source `my`, `en` and `zh-CN` language matrix retains both the default and explicitly selected preparation locale.

Document language is a third independent context: Canvas measurement inherits it before preparation. Maintained accuracy and discretionary pages use `en`, compact oracles use their original per-case/default language, and corpora use their metadata language. The runner uses fresh documents for maintained installed-font contexts; retained investigations run in the shared default-document context with controlled font fixtures. Native paragraph language and preparation locale remain explicit and independent. Context belongs to the observation identity, so restoring a maintained page's environment does not merge it with a default-document investigation or change that investigation's historical ID.

Retained imports preserve public text, settings and thresholds, rather than porting every archived harness's language and font-loading protocol. The bounded-round and policy recipe harnesses used an absent document language. Nine older imported cohorts used `<html lang="en">`: under `policy-correctness/`, these are `discretionary/chrome-tab-threshold-v1`, `discretionary/chrome-shy-threshold-v2`, `measurement/tab-shy-v2`, `measurement/emoji-context-matrix-firefox-v1`, `chromium-script-spacing/item-graphemes-v1`, `chromium-script-spacing/fresh-context-v1`, and `tabs/chrome-v4`, `tabs/safari-v4`, `tabs/firefox-v4`. Their archived `run.ts` files establish that context; `fixtures/provenance.json` identifies the imported reports. All these inputs remain runnable under the shared observer. Equivalence between absent and `en` document language has not been established for every imported input, so their current results do not certify a complete replay of those older protocols.

Some source records were never wrapping cases:

| Historical record | Disposition |
| --- | --- |
| Input manifests and report-pointer lists | Provenance only; their referenced public input arrays are imported. |
| The 54 rich gap-ownership rows | Separate rich contract/geometry checks. They have item partitions and gap owners but no wrapping width; inventing a width would change the tested question. |
| The 360 Chrome and 360 Safari max-content width observations | Measurement research reference. They compare an unwrapped width objective, not a finite wrapping width. Their negative-spacing/source families remain in the wrapping union; these original max-content assertions are not claimed as replayed here. |
| Twelve before/after emoji calibration observations | Observer-state research reference; these are Canvas/DOM measurements around calibration, not text/width layout inputs. Emoji wrapping inputs remain in the shared suite. |
| Prepared-array injections and planner-to-planner equivalence | Implementation-private research reference. Public source/cursor/width invariants belong in the current contract tests; old internal representations are not required outputs. |
| Worker/WASM allocation, ABI, native-bidi wrappers and supplied-glyph parity | Implementation-private research reference, outside the ordinary Canvas runtime. Applicable text counterexamples remain input obligations. |
| Synthetic font interventions and unavailable experimental browser APIs | Research protocols, not ordinary public-layout pass assertions. The retained evidence identifies the intervention and its limitation; it is not treated as a normal-font observation. |
| Font captures made under a different font face or polluted Safari paragraph history | Invalid as interchangeable expected results. Their source cases are retained and observed freshly with declared fonts and isolated paragraph context. |

No valid case was removed because all implementations fail it, because it belongs to a difficult script, or because a candidate does not improve it. The research references above are **not runnable protocol ports** and do not count as passed. They remain listed so that adopting their machinery later requires restoring its relevant protocol checks rather than forgetting them.

## Ledger disposition

This maps all obligations in the earlier 60-entry bounded ledger into the shared inventory or an explicit research/implementation disposition. “Imported” means the behavioral inputs are available, not that any candidate passes them. “Contracts” means the public invariant is tested through the current API surface, not through an old prototype's private fields.

| Earlier ledger entries | Disposition here |
| --- | --- |
| 1 — maintained accuracy | Generated from maintained data; height-only scope. |
| 2 — maintained mode and discretionary oracles | Shared-runner imports retain the original content widths, preparation/layout routes, independent span/Range extraction and primary paragraph heights; all eight checked discretionary text/width contracts and retained SHY inputs remain. |
| 3 — maintained corpora | Generated from all existing corpora and metadata; height-only scope. |
| 4–5 — original wrapping and rich zero-width contracts | Filed reproductions, complete inherited policy controls, retained item partitions, rich contracts. |
| 6 — 14 nominated regression families | All 122 exact inputs verified in the retained union; broad recipes provide neighboring controls. |
| 7 — 3,154 source-policy rows | Complete deterministic generator, with original control/discovery/heldout provenance. |
| 8 — content language, locale and dictionary behavior | Imported language/locale and Myanmar inputs, explicit language recipes, maintained corpora. Empty content language remains a real reset input. |
| 9 — original Firefox 16 and Safari 162 regressions | Imported historical inputs and complete corresponding Safari cohort; height and source assignment remain separate. |
| 10–12 — Safari contexts/thresholds and Arabic source context | Imported complete historical, cross-item, context, spacing and source-window input cohorts. |
| 13 — kern/GPOS/ligature allocation and safe edges | Ordinary-font wrapping/threshold inputs imported. Glyph-allocation interventions remain measurement research. |
| 14 — earlier tab/SHY, script/spacing, emoji and API stress | Complete selected public-input cohorts imported; public API contracts replace prototype-specific audits. |
| 15 — 9,462 saved and 300,000 synthetic preparations | Private planner equivalence reference; current public invariant checks do not certify equivalence to that abandoned representation. |
| 16 — Safari origin-scoped paragraph cache | Browser observer/run isolation requirement; historical polluted captures are not expected values. |
| 17–18 — explicit-font and source-to-glyph Worker production | Research producer protocols. Ordinary source inputs and controlled fonts represented here do not imply Worker parity. |
| 19 — supplied primary font versus native fallback | Maintained canonical font stacks and verified controlled-font loading. Installed faces retain ordinary CSS fallback; the report records the platform, not per-glyph selected-face identity. Supplied-glyph parity remains research. |
| 20 — native bidi wrappers and source-X9 ownership | Private backend research; maintained bidi metadata/API tests remain separate from browser wrapping. |
| 21–22 — inferred safe edges and extended platform metrics | Research protocols. A successful glyph/raster comparison is not a wrapping pass. |
| 23 — WASM lifetime/exception cleanup | Private producer ownership research. |
| 24 — paint-only rich source items and fit arithmetic | Retained item/source cases and rich contracts; style-intervention/native paint protocols remain research. |
| 25–27 — Firefox ligatures, Chromium ZWNJ, Safari whitespace/SHY | Retained source/control/spacing/SHY cohorts; source and paint observations assessed separately. |
| 28 — grapheme guarantee versus native codepoint breaks | Contract checks and detailed native source cases; native behavior does not redefine the public grapheme contract. |
| 29 — continuation/source offsets/partial-space starts | Public contract checks and retained source windows. |
| 30–31 — Safari Worker corpus and native bidi backend | Private producer research; existing canonical/corpus source inputs are generated independently. |
| 32–33 — raw/normalized sources and Firefox source/frame extents | Complete raw/control/endpoint/window public inputs imported. Private frame fields are not expected outputs. |
| 34 — from-scratch Firefox producer parity | Private producer research; the shared runner exercises the exported prepare function directly. |
| 35 — variable font instances and dictionary opportunities | Maintained and retained dictionary inputs; synthetic variable-font shaping interventions remain research protocols. |
| 36 — FF/VT, composed clusters, selected fallback and marks | Raw control and mark inputs retained; platform font-selection intervention remains research. |
| 37 — signed/carried advances and nonmonotone reflow | Retained spacing/window/threshold inputs and API invariants; unwrapped width-query research remains explicitly separate. |
| 38 — missing direction/language input | Exact conflict inputs retained with origin-browser research scope and a visible contract-decision note. |
| 39–40 — endpoint applicability, PUA/surrogates, C0/C1 and FFFC | Complete bounded standalone source/endpoint/normalization inputs imported; unavailable OffscreenCanvas observer interventions remain research. |
| 41–42 — emoji, controls, tabs, hanging spaces and negative spacing | Complete retained cohorts, named-font size cases and maintained mode tests. |
| 43–44 — all API views, variable widths and copied cursors | Public contract checks; retained source inputs do not rely on a prototype's hidden cursor history. |
| 45 — no runtime DOM or layout measurement | Public numeric-stage contract checks; diagnostic browser reads are observer work. |
| 46 — cost, cache, time, retention and footprint | Separate adoption/benchmark checks. The correctness suite does not imply acceptable performance. |
| 47 — build/type/lint/package/demo/docs | Existing repository checks plus the consolidated tooling checks; independent of native accuracy. |
| 48–49 — coherent candidate across producers/consumers | One exact candidate source per run and the same case/observer contract across browsers; no transfer of another variant's pass. |
| 50–53 — raw whitespace, consumed-source versus paint, original policies | Retained raw/window/control/policy inputs; detailed source and API observations. |
| 54–55 — supplied-font gaps and browser-pinned shaping features | Controlled font registry plus fresh named-font observers; explicit glyph/feature producer interventions remain research. |
| 56 — nested rich retries and source ownership | Rich public contract checks and retained partition inputs; native styled-item protocols remain separately identified research. |
| 57–59 — CF per-index queries, fallback selection, frame width objectives | Platform producer research. Associated ordinary source/control/spacing cases are retained; private CF/frame facts are not current API expectations. |
| 60 — identical glyph/raster observations, different allocation | Observer-sufficiency research counterexample. It remains a limitation of that observation method, not a waiver for ordinary wrapping failures. |

## Fonts and observation limits

Controlled Amiri, Noto Naskh Arabic, Noto Nastaliq Urdu and Shantell Sans faces are declared in `fonts/fonts.json`, with hashes, historical source provenance and OFL licenses. `ProbeShantell` is the retained bold face; `Shantell Sans` without `bold` is its distinct regular face. A controlled-font byte mismatch or load failure fails the run. Built-in Arial, Times, Georgia and Courier names are not replaced with web-font aliases. Named installed faces and maintained fallback stacks use ordinary CSS fallback, with the platform recorded in each report. These observations do not identify the actual selected face for every glyph or certify supplied-font fallback coverage.

Native text height, source placement, widths, discretionary paint and API consistency are separate results. Zero-width and collapsed source positions may be unobserved; they are not automatically correct or wrong. A height-only corpus row makes no source-width claim. Browser extraction that changes shaping or wrapping is an intervention, not the original paragraph's oracle. The runner must record exact candidate identity, suite revision, browser/font environment and selection with each report.
