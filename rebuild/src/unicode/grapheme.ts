// Extended grapheme cluster boundaries with each engine's own data: ICU's rule-based iterator over a char.brk table (Blink,
// WebKit), or ICU4X's rule data (Gecko). Each engine builds its own GraphemeRules (engines/<engine>/data.ts, which says
// what its browser opens).
import { icu4xRuleBoundaries, type Icu4xRuleData } from '../breaks/icu4x.js'
import { NO_OVERRIDES, RuleBreakIterator, ruleBoundaries, type BreakRules } from '../breaks/rbbi.js'

export type GraphemeRules =
  | { kind: 'icu-rbbi'; rules: BreakRules }
  | { kind: 'icu4x'; data: Icu4xRuleData }

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
