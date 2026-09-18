// The family a generic font-family keyword stands for under a box's locale, which OffscreenCanvas doesn't have
// (specs/webkit-canvas.md §1.3): a Canvas font list with those families named measures what the DOM draws.
// rule webkit/measure/generic-family-by-locale
//
// - serif, sans-serif, cursive, fantasy and monospace: where the locale's script isn't Common, the DOM asks Core Text for the
//   language's family (FontDescription::platformResolveGenericFamily, FontDescriptionCocoa.cpp:77-118, called first by
//   CSSFontSelector::resolveGenericFamily, CSSFontSelector.cpp:334-353; SystemFontDatabaseCoreText.cpp:320-365) and looks that
//   family up by name (CSSFontSelector::fontRangesForFamily, CSSFontSelector.cpp:431-492). Core Text is closed, so its
//   answers are data: generated/fonts.ts holds them for every locale identifier of macOS 27.0 (probe webkit-round4 R11: of
//   216 language and keyword pairs the DOM's boxes of 14 strings equal Canvas totals under the list the port builds on 200,
//   `monospace` under en as Menlo among them, where Canvas resolves the keyword to Courier; the other 16 fall under the
//   port's other rules: a family the process doesn't have, the preferred languages, system fallback by language).
// - -webkit-standard: the settings' standard family of the locale's script (FontGenericFamilies.cpp:50-66), which WebKit sets
//   for Han, kana and Hangul (SettingsBase::initializeDefaultFontFamilies, SettingsBaseCocoa.mm:44-50). USCRIPT_HAN takes the
//   Simplified or the Traditional one by the preferred languages: the first of zh-tw and zh-cn among them decides, Simplified
//   without either (userPrefersSimplifiedChinese, WTF/wtf/Language.cpp:129-138). Preferred languages that aren't given leave
//   it unnamed.
// A family named this way isn't a generic family to Canvas, and the DOM skips a generic family's outline glyph for a character
// with default emoji presentation (FontCascadeFonts::glyphDataForVariant, FontCascadeFonts.cpp:440-447;
// FontCascade::resolveEmojiPolicy, FontCascadeCoreText.cpp:473-523), so such a character still reports canvas-language
// (lines.ts).
import { webkitEmojiPresentationRanges, webkitGenericFamilies, webkitGenericFamilyNames } from './generated/fonts.js'

const CORE_TEXT_GENERICS = ['serif', 'sans-serif', 'cursive', 'fantasy', 'monospace']
const STANDARD_FAMILY_BY_SCRIPT: Readonly<Record<string, string>> = {
  TRADITIONAL_HAN: 'Songti TC', SIMPLIFIED_HAN: 'Songti SC', KATAKANA_OR_HIRAGANA: 'Hiragino Mincho ProN', HANGUL: 'AppleMyungjo',
}

// The settings' standard family of a script, or null where the source doesn't name one apart from the Common script's, or
// the preferred languages that choose it aren't given.
export function standardFamilyOf(script: string, preferredLanguages: readonly string[] | null): string | null {
  if (script !== 'HAN') return STANDARD_FAMILY_BY_SCRIPT[script] ?? null
  if (preferredLanguages === null) return null
  for (let i = 0; i < preferredLanguages.length; i++) {
    const language = preferredLanguages[i]!.toLowerCase()
    if (language === 'zh-tw') return STANDARD_FAMILY_BY_SCRIPT['TRADITIONAL_HAN']!
    if (language === 'zh-cn') break
  }
  return STANDARD_FAMILY_BY_SCRIPT['SIMPLIFIED_HAN']!
}

// The family a generic keyword stands for under the locale, or null where it resolves as it does without one. `script` is
// localeToScriptCode of the locale (data.ts localeScript); `preferredLanguages` are the environment's.
export function genericFamilyUnder(keyword: string, locale: string, script: string, preferredLanguages: readonly string[] | null): string | null {
  if (keyword === '-webkit-standard') return standardFamilyOf(script, preferredLanguages)
  const index = CORE_TEXT_GENERICS.indexOf(keyword)
  if (index < 0 || script === 'COMMON') return null
  let language = locale.toLowerCase().replaceAll('_', '-')
  while (language !== '' && webkitGenericFamilies[language] === undefined) {
    const cut = language.lastIndexOf('-')
    language = cut < 0 ? '' : language.slice(0, cut)
  }
  const name = webkitGenericFamilyNames[webkitGenericFamilies[language]![index]!]!
  return name === '' ? null : name
}

export function hasEmojiPresentation(cp: number): boolean {
  const ranges = webkitEmojiPresentationRanges
  let low = 0
  let high = ranges.length / 2 - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (cp < ranges[2 * middle]!) high = middle - 1
    else if (cp > ranges[2 * middle + 1]!) low = middle + 1
    else return true
  }
  return false
}
