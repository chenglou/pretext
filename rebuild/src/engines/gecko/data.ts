// Gecko's data as its text code opens it: Firefox 156's baked ICU4X segmenter data, and the bidi properties unicode-bidi
// reads. Parsed when the module loads and kept for the life of the page: a parsed table depends only on its generated module.
import { parseIcu4xRuleData, type Icu4xRuleData } from '../../breaks/icu4x.js'
import { unicode17BidiClasses, type BidiData } from '../../unicode/bidi.js'
import { unicodeBidi15BracketPairs } from '../../unicode/generated/bidi-data.js'
import type { GraphemeRules } from '../../unicode/grapheme.js'
import { geckoGraphemeData, geckoLineBreakData } from './generated/break-data.js'

// Firefox 156 segmenter_break_line_v1.
export const geckoLineRules: Icu4xRuleData = parseIcu4xRuleData(geckoLineBreakData)

// Extended grapheme cluster boundaries: ICU4X GraphemeClusterSegmenter with Firefox's baked data, Firefox 156
// segmenter_break_grapheme_cluster_v1 (specs/gecko-text.md §7.3).
export const geckoGraphemeRules: GraphemeRules = { kind: 'icu4x', data: parseIcu4xRuleData(geckoGraphemeData) }

// Bidi_Class from icu_properties 2.1.2 through unicode-bidi-ffi's CodePointMapData adapter, which equals ICU 78.2's for
// every code point, and the crate's own Unicode 15 bracket table for N0 (data_source.rs:44-46, char_data/tables.rs:519),
// which holds the same 64 pairs as Unicode 17's; for unicode/unicode-bidi.ts.
export const geckoBidiData: BidiData = { classes: unicode17BidiClasses, brackets: unicodeBidi15BracketPairs }
