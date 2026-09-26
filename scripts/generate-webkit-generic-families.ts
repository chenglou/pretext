// Generates src/generated/webkit-generic-families.ts, what Safari's page resolves the generic
// families serif, sans-serif, cursive, fantasy and monospace to under a page language, which its
// Canvas can't be told (getWebKitGenericFamilies in src/measurement.ts), from the files in
// scripts/engine-data/safari-27.0/. `--check` compares instead of writing.
//
// - LocaleToScriptMapping.cpp: WebKit's localeToScriptCode (Source/WebCore/platform/text/ of
//   WebKit 7625.1.29.11.27, Safari 27.0). The page asks Core Text only under a language whose
//   script isn't Common (FontDescriptionCocoa.cpp:77-118).
// - css-families-macos.tsv, css-families-ios.tsv: Core Text's answers. For every
//   NSLocale.availableLocaleIdentifiers entry, with '-' separators, and und, mul, zh-CN, zh-HK,
//   zh-MO, zh-SG and zh-TW, the family of CTFontDescriptorCreateForCSSFamily(key, language) for the
//   five kCTFontCSSFamily keys, the call SystemFontDatabaseCoreText.cpp:320-365 makes. Dumped on
//   macOS 27.0 (26A428) and in the iOS 26.0 simulator; an iPhone on iOS 27 drew the same
//   families on the 11 page languages the safari-generic probe covers.
// - missing-families.json: the families of those tables that Safari 27 on macOS 27 and Safari in
//   the iOS 26.0 simulator can't use. A family counts as usable when some text in 28 scripts
//   measures differently in OffscreenCanvas with it listed before Courier or Times than with
//   those alone; the page's spans agreed.
//
// WebKit's rules on Core Text's answer: a name with a leading '.' isn't used and the settings'
// family stands (FontDescriptionCocoa.cpp:98-115), Monaco becomes Courier (SystemFontDatabaseCoreText.cpp:
// 352-365). The settings' families are UnifiedWebPreferences.yaml's defaults, the ones Canvas
// resolves the keywords to. A family Safari can't use leaves the page with the standard family of
// the language's script (FontCascadeFonts.cpp:214-215, SettingsBaseCocoa.mm:44-50): on macOS only
// Kaiti SC and Kaiti TC, which Songti SC and Songti TC stand for.
//
// Each keyword gets a family, or where the systems differ macOS's and iOS's, for preparation to
// take macOS's when Canvas has it: iOS's Safari lacks it in every such case but two, where both
// systems have both families and macOS's stands alone. A keyword whose family is the settings'
// one on both systems keeps resolving in Canvas.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const dataDir = join(scriptsDir, 'engine-data', 'safari-27.0')
const outputPath = join(scriptsDir, '..', 'src', 'generated', 'webkit-generic-families.ts')
const readText = (path: string) => readFileSync(join(dataDir, path), 'utf8')

const KEYWORDS = ['serif', 'sans-serif', 'cursive', 'fantasy', 'monospace']
const SETTINGS = {
  macos: ['Times', 'Helvetica', 'Apple Chancery', 'Papyrus', 'Courier'],
  ios: ['Times', 'Helvetica', 'Snell Roundhand', 'Papyrus', 'Courier'],
}
const STANDARD_FOR_MISSING: Record<string, string> = { 'Kaiti SC': 'Songti SC', 'Kaiti TC': 'Songti TC' }
type System = keyof typeof SETTINGS

// localeToScriptCode's two maps: language (lower case, '_' as '-') and ISO 15924 subtag to the
// script's name without USCRIPT_.
const mappingSource = readText('LocaleToScriptMapping.cpp')
function readMap(start: string, end: string): Map<string, string> {
  const from = mappingSource.indexOf(start)
  const to = mappingSource.indexOf(end, from)
  if (from < 0 || to < 0) throw new Error(`LocaleToScriptMapping.cpp: no ${start}`)
  const map = new Map<string, string>()
  for (const match of mappingSource.slice(from, to).matchAll(/\{ "([a-z_]+)"_s, USCRIPT_([A-Z_]+) \}/g)) map.set(match[1]!.replace('_', '-'), match[2]!)
  if (map.size === 0) throw new Error(`LocaleToScriptMapping.cpp: empty map after ${start}`)
  return map
}
const scriptNames = readMap('UScriptCode scriptNameToCode', 'return map.get')
const languageScripts = readMap('UScriptCode localeToScriptCode', 'String canonicalLocaleString')
for (const [language, script] of languageScripts) {
  if (script === 'COMMON' || script === 'UNKNOWN') throw new Error(`${language} maps to ${script}`)
  if ((script === 'HAN') !== (language === 'zh')) throw new Error(`${language} maps to ${script}`)
}
const scriptSubtags: string[] = []
for (const [subtag, script] of scriptNames) {
  if (subtag.length !== 4) throw new Error(`script name ${subtag}`)
  if (script === 'COMMON' ? subtag !== 'zyyy' : script === 'UNKNOWN' ? subtag !== 'zzzz' : (script === 'HAN') !== (subtag === 'hani')) throw new Error(`${subtag} maps to ${script}`)
  if (script !== 'COMMON' && script !== 'UNKNOWN') scriptSubtags.push(subtag)
}

const missing = JSON.parse(readText('missing-families.json')) as Record<System, string[]>
for (const name of missing.macos) if (STANDARD_FOR_MISSING[name] === undefined) throw new Error(`no standard family for ${name}, which macOS Safari lacks`)

// Language (lower case) -> the five families the page draws on one system.
function readFamilies(system: System): Map<string, string[]> {
  const rows = readText(system === 'macos' ? 'css-families-macos.tsv' : 'css-families-ios.tsv').trim().split('\n')
  if (rows[0] !== `language\t${KEYWORDS.join('\t')}`) throw new Error(`unexpected header in the ${system} table`)
  const answers = new Map<string, string[]>()
  for (let i = 1; i < rows.length; i++) {
    const fields = rows[i]!.split('\t')
    const families: string[] = []
    for (let k = 0; k < KEYWORDS.length; k++) {
      let family = fields[k + 1] ?? ''
      if (k === 4 && family.toLowerCase() === 'monaco') family = 'Courier'
      if (family === '' || family.startsWith('.')) family = SETTINGS[system][k]!
      if (missing[system].includes(family)) family = STANDARD_FOR_MISSING[family] ?? SETTINGS[system][k]!
      families.push(family)
    }
    answers.set(fields[0]!.toLowerCase(), families)
  }
  return answers
}
const macos = readFamilies('macos')
const ios = readFamilies('ios')

// Language -> the five Canvas family lists, '' where the keyword stands.
const conflicts = new Map<string, string[]>()
const pairHeads = new Set<string>()
const lists = new Map<string, string[]>()
for (const [language, mac] of macos) {
  const phone = ios.get(language) ?? mac
  const row: string[] = []
  for (let k = 0; k < KEYWORDS.length; k++) {
    const a = mac[k]!
    const b = phone[k]!
    if (a === SETTINGS.macos[k] && b === SETTINGS.ios[k]) row.push('')
    else if (a === b) row.push(a)
    else if (missing.ios.includes(a)) {
      row.push(`${a}|${b}`)
      pairHeads.add(a)
    } else {
      const key = `${KEYWORDS[k]} ${a} / ${b}`
      conflicts.set(key, [...(conflicts.get(key) ?? []), language])
      row.push(a === SETTINGS.macos[k] ? '' : a)
    }
  }
  lists.set(language, row)
}

// Keep a language only where its lists differ from its parent's, the identifier less its last
// subtag; und's are the root's, what Core Text answers for a language it doesn't list.
function parentOf(language: string): string {
  const cut = language.lastIndexOf('-')
  return cut < 0 ? '' : language.slice(0, cut)
}
const root = lists.get('und')
if (root === undefined) throw new Error('no und row')
const kept = new Map<string, string[]>([['', root]])
function resolved(language: string): string[] {
  for (let at = language; ; at = parentOf(at)) {
    const found = kept.get(at)
    if (found !== undefined) return found
  }
}
const languages = [...lists.keys()].sort((a, b) => a.split('-').length - b.split('-').length || (a < b ? -1 : 1))
for (let i = 0; i < languages.length; i++) {
  const language = languages[i]!
  if (language !== 'und' && resolved(parentOf(language)).join('\t') !== lists.get(language)!.join('\t')) kept.set(language, lists.get(language)!)
}
for (const [language, row] of lists) if (resolved(language).join('\t') !== row.join('\t')) throw new Error(`the kept languages don't give ${language} its lists`)

const names: string[] = ['']
const indexOf = (name: string): number => {
  const index = names.indexOf(name)
  return index < 0 ? names.push(name) - 1 : index
}
const rowLines: string[] = []
for (const [language, row] of kept) rowLines.push(`  '${language}': [${row.map(indexOf).join(', ')}],`)

function wrapComment(text: string): string {
  const lines: string[] = []
  let line = '//'
  for (const word of text.split(' ')) {
    if (line.length + word.length + 1 > 100) {
      lines.push(line)
      line = '//'
    }
    line += ` ${word}`
  }
  return [...lines, line].join('\n')
}

const nextSource = `// Generated by scripts/generate-webkit-generic-families.ts from scripts/engine-data/safari-27.0/.
// Do not edit by hand. Regenerate with \`bun run generate:webkit-generic-families\`.

// The languages and ISO 15924 subtags WebKit gives a script other than Common, zh and hani being
// plain Han (localeToScriptCode, LocaleToScriptMapping.cpp), lower case with '-', between spaces.
export const webkitScriptLanguages = ' ${[...languageScripts.keys()].join(' ')} '
export const webkitScriptSubtags = ' ${scriptSubtags.join(' ')} '

// Per language, lower case, the family of serif, sans-serif, cursive, fantasy and monospace as
// indices into webkitGenericFamilyNames: a family, or macOS's and iOS's joined by '|', macOS's
// being one iOS's Safari lacks; 0 where the keyword resolves as in Canvas. A language without an
// entry takes its parent's, the identifier less its last subtag, and '' at the end. macOS's
// families of the pairs:
${wrapComment([...pairHeads].sort().join(', '))}
export const webkitGenericFamilyNames: readonly string[] = [${names.map(name => `'${name}'`).join(', ')}]
export const webkitGenericFamilies: Readonly<Record<string, readonly number[]>> = {
${rowLines.join('\n')}
}
`

const summary = [
  `${languageScripts.size} languages and ${scriptSubtags.length} script subtags`,
  `${macos.size} Core Text languages kept as ${kept.size} rows of ${names.length - 1} families and pairs`,
  `macOS's family kept where iOS has it too: ${[...conflicts].map(([key, where]) => `${key} (${where.length}, e.g. ${where.slice(0, 3).join(' ')})`).join('; ')}`,
  `module ${nextSource.length} B, ${gzipSync(Buffer.from(nextSource), { level: 9 }).length} B gzipped`,
].join('; ')

if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== nextSource) throw new Error(`Generated WebKit generic families are stale: ${outputPath}`)
  console.log(`Generated WebKit generic families are up to date: ${summary}.`)
} else {
  await Bun.write(outputPath, nextSource)
  console.log(`Wrote ${outputPath}: ${summary}.`)
}
