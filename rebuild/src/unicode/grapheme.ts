// Extended grapheme cluster boundaries with each engine's own data:
// - Blink: ICU 78.2 char.brk from Chrome 153's icudtl.dat, which CharacterBreakIterator opens for 16-bit text
//   (specs/blink-text.md §2.F.5 nextGraphemeBoundary). 8-bit text uses Blink's own rule instead: every code unit is a
//   boundary except LF after CR (character_break_iterator.cc:106-154); engines/blink applies that.
// - WebKit: libicucore 78.1 char.brk, opened by NonSharedCharacterBreakIterator (specs/webkit-canvas.md §2.4). Its
//   locale (the user's text-break locale) doesn't change the table on macOS 27 (both configurations load fe6dbecf).
// - Gecko: ICU4X GraphemeClusterSegmenter with Firefox's baked data (specs/gecko-text.md §7.3).
import type { EngineName } from '../env.js'
import { icu4xRuleBoundaries, type Icu4xRuleData } from '../breaks/icu4x.js'
import { NO_OVERRIDES, RuleBreakIterator, ruleBoundaries, type BreakRules } from '../breaks/rbbi.js'
import { blinkBreakRules, geckoGraphemeRules, webkitBreakRules } from '../breaks/tables.js'

export type GraphemeRules =
  | { kind: 'icu-rbbi'; rules: BreakRules }
  | { kind: 'icu4x'; data: Icu4xRuleData }

export function graphemeRulesFor(engine: EngineName): GraphemeRules {
  switch (engine) {
    case 'blink': return { kind: 'icu-rbbi', rules: blinkBreakRules('char') }
    case 'webkit': return { kind: 'icu-rbbi', rules: webkitBreakRules('char') }
    case 'gecko': return { kind: 'icu4x', data: geckoGraphemeRules() }
  }
}

// Boundaries in ascending order, including 0 and text.length ([0] for empty text).
export function graphemeBoundaries(text: string, rules: GraphemeRules): number[] {
  switch (rules.kind) {
    case 'icu-rbbi': {
      const boundaries = ruleBoundaries(new RuleBreakIterator(rules.rules, NO_OVERRIDES), text)
      const out = [0]
      for (let i = 0; i < boundaries.length; i++) out.push(boundaries[i]!.offset)
      return out
    }
    case 'icu4x':
      return icu4xRuleBoundaries(rules.data, text)
  }
}
