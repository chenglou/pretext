// Every rule-targeted family. derive.ts expands them per engine; coverage.ts joins them to the registry.
import { BREAK_FAMILIES } from './breaks.ts'
import { FONT_FAMILIES } from './fonts.ts'
import { LINE_FAMILIES } from './lines.ts'
import type { RuleFamily } from './types.ts'

export const FAMILIES: readonly RuleFamily[] = [...LINE_FAMILIES, ...BREAK_FAMILIES, ...FONT_FAMILIES]
