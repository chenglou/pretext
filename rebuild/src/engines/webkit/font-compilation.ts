// Pure font source analysis owned by one preparation. No Canvas answer or context is retained here.
import type { FontDecl } from '../../model.js'
import { SpacingSource } from './spacing-source.js'
import { canvasFont } from '../../measure/font.js'
import { computedLocale, isHanLocale } from './data.js'
import { makeLocaleSource, type LocaleSource } from './locale-source.js'
import { familyNames, genericFamilyInRow, genericFamilyRow, namedFamily, standardFamilyOf, type FamilyName } from './fonts.js'

const CJK_SCRIPTS = ['HAN', 'SIMPLIFIED_HAN', 'TRADITIONAL_HAN', 'KATAKANA_OR_HIRAGANA', 'HANGUL']
const SYSTEM_DESIGN_FAMILIES = ['system-ui', '-apple-system', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded']
const GENERIC_FAMILY_KEYWORDS = ['serif', 'sans-serif', 'cursive', 'fantasy', 'monospace', 'system-ui', 'emoji', 'math', 'fangsong', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', '-apple-system', '-webkit-standard', '-webkit-body', '-webkit-pictograph']

export type LanguageSource = { locale: LocaleSource; han: boolean }

type SpacingFacts = SpacingSource | null
export type CompiledFont = {
  declared: FontDecl
  families: readonly FamilyName[]
  firstNamedGeneric: number | null
  cjk: boolean
  size: number
  family: string
  canvasFont: string
  lastResortFont: string
  listLastResortFont: string
  primaryFamily: string
  primaryLastResortFont: string
  spacingFacts: SpacingFacts | undefined
  inspection: { unknownFamily: boolean; namedGeneric: boolean; namedLastResortFont: string | null } | null
}
export type FontChoice = { standardFamily: string | null; cjk: boolean; base: CompiledFont; appended: CompiledFont | null }
type SourceFont = { families: readonly FamilyName[]; size: number; lastResortFont: string; variants: Map<readonly number[] | null, FontChoice[]> }

function compile(declared: FontDecl, source: SourceFont, families: readonly FamilyName[], firstNamedGeneric: number | null, cjk: boolean): CompiledFont {
  const family = families.map(value => value.css).join(', ')
  const primaryFamily = declared.facts.primaryFamily === null ? families[0]!.name : declared.facts.primaryFamily.toLowerCase()
  const primaryCss = declared.facts.primaryFamily === null ? families[0]!.css
    : GENERIC_FAMILY_KEYWORDS.includes(declared.facts.primaryFamily.toLowerCase()) ? declared.facts.primaryFamily : JSON.stringify(declared.facts.primaryFamily)
  return {
    declared, families, firstNamedGeneric, cjk, size: source.size, family,
    canvasFont: canvasFont({ ...declared, family }, source.size), lastResortFont: source.lastResortFont,
    listLastResortFont: canvasFont({ ...declared, family: `${family}, LastResort` }, source.size), primaryFamily,
    primaryLastResortFont: canvasFont({ ...declared, family: `${primaryCss}, LastResort` }, source.size),
    spacingFacts: undefined, inspection: null,
  }
}

// The registry is discarded when prepareWebKit returns. A FontDecl is parsed at its first rendered leaf; each generated
// generic-family row / standard-family / CJK combination owns one resolved list. Raw locale aliases cannot multiply lists.
export class FontCompilation {
  private readonly sources = new Map<FontDecl, SourceFont>()
  private readonly rawLocales = new Map<string, LanguageSource>()
  private readonly locales = new Map<string, LocaleSource>()
  private hanLocale: string | undefined
  private hanStandard: string | null | undefined
  constructor(private readonly zoom: number, private readonly preferredLanguages: readonly string[] | null, private readonly icuDefaultLocale = 'en_US_POSIX') {}

  // Every Han input chooses the same specialized locale from this preparation's preferred-language source.
  // Keep the choice at first demand: non-Han/empty languages never read the list.
  localeOf(lang: string): LanguageSource {
    let source = this.rawLocales.get(lang)
    if (source !== undefined) return source
    const han = lang !== '' && isHanLocale(lang)
    const locale = han ? this.hanLocale ??= computedLocale(lang, this.preferredLanguages) : lang
    source = { locale: this.localeSource(locale), han }
    this.rawLocales.set(lang, source)
    return source
  }

  // A specialized Han locale and all raw languages selecting it share one source profile. The font row is demanded only
  // after declaration parsing, preserving first-demand validation; Common and empty locales never demand a row.
  private localeSource(locale: string): LocaleSource {
    let source = this.locales.get(locale)
    if (source === undefined) {
      source = makeLocaleSource(locale, this.icuDefaultLocale)
      this.locales.set(locale, source)
    }
    return source
  }

  resolve(declared: FontDecl, locale: string, script: string): FontChoice {
    let source = this.sources.get(declared)
    if (source === undefined) {
      const size = Math.fround(Math.fround(declared.size) * Math.fround(this.zoom))
      source = { families: familyNames(declared.family), size, lastResortFont: canvasFont({ ...declared, family: 'LastResort' }, size), variants: new Map() }
      this.sources.set(declared, source)
    }
    const localeSource = locale === '' || script === 'COMMON' ? null : this.localeSource(locale)
    const row = localeSource === null ? null : localeSource.row ??= genericFamilyRow(localeSource.name, script)!
    let standardFamily: string | null = null
    if (locale !== '') {
      if (script === 'HAN') {
        if (this.hanStandard === undefined) this.hanStandard = standardFamilyOf(script, this.preferredLanguages)
        standardFamily = this.hanStandard
      } else standardFamily = standardFamilyOf(script, this.preferredLanguages)
    }
    const cjk = CJK_SCRIPTS.includes(script)
    let variants = source.variants.get(row)
    if (variants === undefined) { variants = []; source.variants.set(row, variants) }
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i]!
      if (variant.standardFamily === standardFamily && variant.cjk === cjk) return variant
    }
    let families: readonly FamilyName[] = source.families
    let resolved: FamilyName[] | null = null, firstNamedGeneric: number | null = null
    for (let i = 0; i < families.length; i++) {
      const input = families[i]!
      const named = input.quoted || locale === '' ? null : input.name === '-webkit-standard' ? standardFamily : genericFamilyInRow(input.name, row)
      if (named === null) continue
      resolved ??= source.families.slice()
      resolved[i] = namedFamily(named)
      firstNamedGeneric ??= i
    }
    if (resolved !== null) families = resolved
    const choice = { standardFamily, cjk, base: compile(declared, source, families, firstNamedGeneric, cjk), appended: null }
    variants.push(choice)
    return choice
  }

  // Pure alternate source home. The caller still performs both old fallback Canvas questions for every box before choosing.
  withStandardFamily(choice: FontChoice): CompiledFont {
    if (choice.appended !== null) return choice.appended
    if (choice.standardFamily === null) throw new Error('font choice has no standard family')
    const source = this.sources.get(choice.base.declared)!
    const families = [...choice.base.families, namedFamily(choice.standardFamily)]
    return choice.appended = compile(choice.base.declared, source, families, choice.base.firstNamedGeneric ?? choice.base.families.length, choice.cjk)
  }
}

export function compiledSpacingFacts(font: CompiledFont): SpacingFacts {
  if (font.spacingFacts !== undefined) return font.spacingFacts
  const facts = font.declared.facts
  let out: Array<{ coverage: readonly number[]; inputs: readonly number[] }> | null = null
  if (facts.fonts !== undefined && facts.fonts.length === font.families.length) {
    out = []
    for (let i = 0; i < facts.fonts.length; i++) {
      const listed = facts.fonts[i]!
      if (listed.realizes === false) continue
      if (listed.realizes === null || listed.coverage === null || listed.spacingInputs === undefined || listed.spacingInputs === null) { out = null; break }
      out.push({ coverage: listed.coverage, inputs: listed.spacingInputs })
    }
  }
  return font.spacingFacts = out === null ? null : new SpacingSource(out)
}

export function compiledInspection(font: CompiledFont): NonNullable<CompiledFont['inspection']> {
  if (font.inspection !== null) return font.inspection
  let firstUnknown = font.families.length
  for (let i = 0; i < font.families.length; i++) {
    const family = font.families[i]!
    if (!family.quoted && ((family.name === '-webkit-standard' && font.cjk) || SYSTEM_DESIGN_FAMILIES.includes(family.name))) { firstUnknown = i; break }
  }
  const end = Math.min(firstUnknown, font.firstNamedGeneric ?? font.families.length)
  const named = font.families.slice(0, end).map(value => value.css)
  return font.inspection = {
    unknownFamily: firstUnknown < font.families.length, namedGeneric: font.firstNamedGeneric !== null,
    namedLastResortFont: named.length === 0 ? null : canvasFont({ ...font.declared, family: named.concat(['LastResort']).join(', ') }, font.size),
  }
}
