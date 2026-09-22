# Independently positioned text: shaping boundaries

**Status:** the fixed-word prototype below is [rejected as a general replacement](README.md). Preserving whole words by routine overflow and rejecting valid style changes are prototype omissions, not agreed API limitations. These notes preserve the initial hypotheses and shaping evidence; they are not an implementation queue.

This prototype may choose different lines and positions from a native paragraph. It still has to draw readable text, and each independently painted fragment must use the same text, font, direction, language and spacing as its Canvas measurement. The cases in `shaping-cases.ts` distinguish inputs which can be independent, inputs needing a larger shaping group, and invalid splits inside graphemes. Group cases are deliberate tests of the boundary; they are not claims that the current prototype supports grouping.

## Smallest safe first version

Keep flat text and atomic items. Validate supplied text-item boundaries against grapheme boundaries of the **combined logical paragraph**, before measuring; validating each item alone misses split marks and flags. Reuse the existing detector. Treat atomic items as U+FFFC for paragraph bidi and as a hard shaping boundary.

Inside an item, preserve complete words for joining and complex scripts. An overlong such word may overflow its line. This is an explicit owned-layout choice which keeps resize layout numeric; splitting it into readable, freshly shaped line fragments requires additional work. For Latin and CJK, the chosen break opportunities can be narrower, but measuring a word by summing isolated grapheme widths would change its kerning and ligatures.

At a supplied boundary between Arabic or other joining letters, use the existing `joinsAcross` query (it skips transparent marks) to detect that isolation would break joining. Same-font/same-spacing items differing only in color, links or decoration can be merged into one independently positioned shaping group with ordinary inline children. Measure the group as one string, and let the browser place those children inside the group. This loses independent x positions for the group's children but removes the need to infer glyph or ligature shares. If the simpler API promises independent x for every supplied item, reject such boundaries instead; silently disconnecting letters is not a sufficient implementation.

A font/weight/spacing change within a required joining sequence cannot use that single Canvas measurement. The conservative first version requires the caller to move the style boundary to a complete word. Contextual joiners could support some font changes later, but do not solve required lam-alef ligatures or all contextual forms, and must not be presented as a universal replacement.

A conservative general predicate keeps a whole word when any strong letter has a script outside Latin, Greek, Cyrillic, Hebrew, Han, Hiragana, Katakana, Hangul, Bopomofo, Armenian or Georgian. Unknown scripts keep the word too. Common/Inherited marks, joiners and controls stay with their surrounding group, rather than being accepted as simple on their own. This is a prototype boundary, not a proof about arbitrary font substitutions. The same whole-word rule covers complex-script boundaries whose full syllable detector is not yet part of the core. Dictionary-based safe opportunities may narrow the groups later. This is preferable to an incomplete test for a handful of virama codepoints. It is a general script policy, not a per-font correction table.

## Evidence beyond simple combining marks

A local read-only check using the existing Blink, WebKit and Gecko grapheme data produced identical boundaries for these strings:

| Text | UTF-16 boundaries | Consequence |
| --- | --- | --- |
| क्षि, श्री | `[0,4]` | Current Unicode-17 conjunct rules already reject many naive consonant splits. |
| ក្រ | `[0,3]` | Khmer coeng-plus-consonant remains one cluster. |
| ကျော် | `[0,3,5]` | The boundary after U+1031 is within one Myanmar shaping syllable; post-base vowel U+102C and asat U+103A must stay with the base/medial/pre-base vowel. |
| ක්‍ර | `[0,3,4]` | Sinhala ka + virama + ZWJ and following ra can be separate graphemes while requiring the same shaping group. |
| เริ่ม | `[0,1,4,5]` | A Thai pre-base vowel can be a separate grapheme; a line break between it and the following consonant is not justified by grapheme validity alone. |

All 32 cases were checked against each of the three current grapheme datasets: only the five `reject-grapheme` cases fail supplied-boundary validation. Each named primary font’s recorded face file exists on this machine. These are segmentation and file-presence observations, not new browser-painting results. The installed-font cases include the Myanmar and Thai counterexamples, ordinary complete words in Devanagari/Bangla/Khmer, Arabic joining with marks, required lam-alef, intact and split emoji, negative letter spacing, mixed bidi, controls, atomic items, fallback and baselines. Sinhala is listed above as another boundary finding; no Sinhala-primary painting case is claimed because the installed-font inventory used here does not list a Sinhala family.

The [Unicode-17 grapheme rules](https://www.unicode.org/reports/tr29/tr29-47.html#Grapheme_Cluster_Boundary_Rules) prevent some conjunct splits without defining all shaping syllables. [CSS Text](https://www.w3.org/TR/css-text-3/#boundary-shaping) discusses shaping across decoration-only boundaries and the distinction between graphemes and typographic units. The [Myanmar shaping description](https://learn.microsoft.com/en-us/typography/script-development/myanmar#well-formed-clusters) identifies complete syllables, including post-base vowels and asat. The [Unicode Arabic chapter](https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-9/) distinguishes required lam-alef ligatures from optional ones. These sources support larger groups; they do not establish exact Canvas/DOM equality in every browser.

## What this simplifies, and what remains

Complete fixed groups can be measured once. Width fitting, per-line bidi order and final x positions can then use numeric widths; no glyph-share recovery between items is needed. Color-only child placement stays inside the browser's one group, without querying its child widths. No nested paragraph tree is required for the flat input.

If a new width introduces a cut **inside** a word, a fresh fragment can shape differently. Either retain the overflow rule, deliberately make smaller independently shaped units (a visible typography change), or measure the selected complete fragments. Independent graphemes are not generally a readability-preserving option for joining and complex scripts. Precomputing every possible substring would be an expensive preparation strategy rather than a cheap general solution.

Isolation also does not cure differences inside one fragment. Safari Canvas keeps optional ligatures under some letter spacing where CSS disables them; that existing gap remains relevant to `negative-spacing-and-ligatures`. Fallback, language, mixed-font baseline placement, whitespace, ink overhang and bidi control handling must still be checked against the actual new painter. The native-flow plaintext predictor is unchanged by any of these proposed boundaries.
