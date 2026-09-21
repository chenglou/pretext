// Pure locale source analysis. Records are canonical within one preparation; they contain no text or Canvas answers.
import { hasDelimiterData, lineRules, localeScript, type LineRules } from './data.js'
import type { LineBreakMode } from './types.js'

export type LocaleSource = {
  name: string
  script: string
  row: readonly number[] | undefined
  language: string | undefined
  delimiterData: boolean | undefined
  rules: Partial<Record<LineBreakMode, LineRules>>
  icuDefaultLocale: string
}
export function makeLocaleSource(name: string, icuDefaultLocale: string): LocaleSource {
  return { name, script: localeScript(name), row: undefined, language: undefined, delimiterData: undefined, rules: {}, icuDefaultLocale }
}
export function primaryLanguageOf(source: LocaleSource): string {
  return source.language ??= source.name.toLowerCase().split(/[-_]/)[0]!
}
export function hasDelimiterDataOf(source: LocaleSource): boolean {
  return source.delimiterData ??= hasDelimiterData(source.name)
}
export function lineRulesOf(source: LocaleSource, mode: LineBreakMode): LineRules {
  return source.rules[mode] ??= lineRules(source.name, mode, source.icuDefaultLocale)
}
