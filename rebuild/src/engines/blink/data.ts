// Blink's data as its text code opens it: Chrome 153's break tables and pair table, and ICU 78.2's bidi properties. Parsed
// when the module loads and kept for the life of the page: a parsed table depends only on its generated module.
import { decodeBase64 } from '../../breaks/icu4x.js'
import { parseBreakRules, type BreakRules } from '../../breaks/rbbi.js'
import { unicode17BidiClasses, type BidiData } from '../../unicode/bidi.js'
import { unicode17BracketPairs } from '../../unicode/generated/bidi-data.js'
import type { GraphemeRules } from '../../unicode/grapheme.js'
import { blinkBreakTableBase64, blinkLinePairsBase64, type BlinkBreakTable } from './generated/break-tables.js'

function parsed(table: BlinkBreakTable): BreakRules {
  return parseBreakRules(decodeBase64(blinkBreakTableBase64[table]))
}

// Chrome 153 icudtl.dat tables (ICU 78.2).
export const blinkBreakRules: Record<BlinkBreakTable, BreakRules> = {
  line: parsed('line'), line_normal: parsed('line_normal'), line_normal_cj: parsed('line_normal_cj'), line_loose: parsed('line_loose'),
  line_loose_cj: parsed('line_loose_cj'), char: parsed('char'),
}

// Blink's kFastLineBreakTable: can break between `last` and `current`, both in U+0021..U+00FF (breaks/pair-table.ts).
export const blinkLinePairs: Uint8Array = decodeBase64(blinkLinePairsBase64)

// Extended grapheme cluster boundaries: ICU 78.2 char.brk from Chrome 153's icudtl.dat, which CharacterBreakIterator opens
// for 16-bit text (specs/blink-text.md §2.F.5 nextGraphemeBoundary). 8-bit text uses Blink's own rule instead: every code
// unit is a boundary except LF after CR (character_break_iterator.cc:106-154); the callers apply that.
export const blinkGraphemeRules: GraphemeRules = { kind: 'icu-rbbi', rules: blinkBreakRules.char }

// ICU 78.2's Bidi_Class and Bidi_Paired_Bracket, Unicode 17, for unicode/ubidi.ts.
export const blinkBidiData: BidiData = { classes: unicode17BidiClasses, brackets: unicode17BracketPairs }
