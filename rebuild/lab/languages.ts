// The languages a browser process uses for content without a usable lang (DESIGN.md §1.4): what the lab driver launches
// each browser with, and the given facts it derives for the library. The driver is research tooling, so it may set them at
// launch, read the OS settings a browser takes them from, or read what the browser shows (CHARTER.md, "Boundaries"); the
// library reads none of these.
//
// - Chrome: Blink's DefaultLanguage() is the renderer's --lang switch (renderer_blink_platform_impl.cc:414-416,
//   render_thread_impl.cc:711-718), which the browser appends from its application locale
//   (render_process_host_impl.cc:3771-3775). On macOS that locale is the outer bundle's first preferred localization over
//   the process's AppleLanguages, and a --lang launch switch is ignored (l10n_util_mac.mm:41-66, l10n_util.cc:296-310,
//   chrome_main_delegate.cc:1726; read in Chromium 152, since the pinned 153 checkout lacks ui/base/l10n). So Chrome
//   launches with a Cocoa -AppleLanguages argument, which --no-startup-window keeps from being opened as a URL
//   (startup_browser_creator.cc:1136-1141), and the driver reads the renderers' --lang back from their command lines.
// - Firefox: layout's language for content without lang is the first OS regional-prefs locale, lowercased
//   (nsLanguageAtomService.cpp:107-138). On macOS those are CFLocaleCopyPreferredLanguages() through
//   unic_langid_canonicalize (OSPreferences_mac.cpp:31-63, OSPreferences.cpp:445-459, LocaleService.h:108-123;
//   FIREFOX_156_0_RELEASE). No pref reaches it: the prefs set here decide the app locale, navigator.languages and the Intl
//   formatters only (LocaleService.cpp:494-535, all.js:1485-1492). So the given fact comes from the OS setting.
// - Safari and webkit-host: Safari takes its languages from the OS and can't take others per launch, and webkit-host stands
//   in for Safari, so neither launches with languages. FontDescription replaces a Han lang with the first entry of the
//   WebContent process's userPreferredLanguages() starting with zh- (FontDescription.cpp:75-104), and a page shows the
//   first entry of that list as navigator.languages (NavigatorBase.cpp:148-152); the driver takes it at the first step
//   (webkitPreferredLanguages). The WebContent ICU default locale comes from launchd's LC_ALL, LC_MESSAGES or LANG, else
//   en_US_POSIX (specs/webkit-gaps.md §8.2 [I]).
import { execFileSync } from 'node:child_process'
import type { BrowserKind, ProcessLanguages } from './types.ts'

// This Mac's AppleLanguages on 2026-09-17. Chrome launches with them, so its application locale stays the zh-CN every
// earlier Chrome run had, without drifting with the OS settings.
export const CHROME_APPLE_LANGUAGES: readonly string[] = ['zh-Hans-US', 'en-US']
// Chrome's default for a zh-CN application locale, set explicitly: navigator.languages and Blink's Han locale for text
// without lang come from it (LayoutLocale::AcceptLanguagesChanged), which the library doesn't model yet.
export const CHROME_ACCEPT_LANGUAGES = 'zh-CN,zh'
// Firefox ships en-US only; these are its defaults for an en-US app locale, set explicitly.
export const FIREFOX_LANGUAGE_PREFS: ReadonlyArray<[string, string | boolean]> = [
  ['intl.locale.requested', 'en-US'], ['intl.accept_languages', 'en-US, en'], ['intl.regional_prefs.use_os_locales', false],
]

// Runs a command and returns its trimmed output, or null when it fails.
export type CommandReader = (command: string, commandArgs: string[]) => string | null

export const readCommand: CommandReader = (command, commandArgs) => {
  try {
    return execFileSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).trim()
  } catch {
    return null
  }
}

// An old-style plist array as `defaults read` prints it: ( "zh-Hans-US", "en-US" ). null for anything else.
export function parsePlistArray(text: string): string[] | null {
  const match = /^\(\s*([\s\S]*?)\s*\)$/.exec(text.trim())
  if (match === null) return null
  const items: string[] = []
  const parts = match[1]!.split(',')
  for (let i = 0; i < parts.length; i++) {
    const value = parts[i]!.trim().replace(/^"(.*)"$/s, '$1')
    if (value !== '') items.push(value)
  }
  return items
}

// uprv_getDefaultLocaleID (AppleICU putil.cpp, specs/webkit-gaps.md §8.2): a process that never calls setlocale has "C"
// for LC_MESSAGES, so the first of LC_ALL, LC_MESSAGES and LANG that isn't empty, C or POSIX, without its codeset and
// modifier; with none, en_US_POSIX.
export function icuDefaultLocale(environment: Readonly<Record<string, string>>): string {
  const names = ['LC_ALL', 'LC_MESSAGES', 'LANG']
  for (let i = 0; i < names.length; i++) {
    const value = environment[names[i]!]
    if (value === undefined || value === '' || value === 'C' || value === 'POSIX') continue
    return value.split('.')[0]!.split('@')[0]!
  }
  return 'en_US_POSIX'
}

// unic_langid_canonicalize (LocaleService.h:108-123): '_' becomes '-', a POSIX codeset postfix is cut, and language, script
// and region take their canonical case. null where the tag doesn't parse; ReadSystemLocales skips such entries.
export function canonicalizeLanguageId(tag: string): string | null {
  const parts = tag.split('.')[0]!.replace(/_/g, '-').split('-')
  const language = parts[0]!
  if (!/^(?:[A-Za-z]{2,3}|[A-Za-z]{5,8})$/.test(language)) return null
  const out = [language.toLowerCase()]
  let i = 1
  if (i < parts.length && /^[A-Za-z]{4}$/.test(parts[i]!)) {
    out.push(parts[i]![0]!.toUpperCase() + parts[i]!.slice(1).toLowerCase())
    i++
  }
  if (i < parts.length && /^(?:[A-Za-z]{2}|[0-9]{3})$/.test(parts[i]!)) {
    out.push(parts[i]!.toUpperCase())
    i++
  }
  for (; i < parts.length; i++) {
    if (!/^(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3})$/.test(parts[i]!)) return null
    out.push(parts[i]!.toLowerCase())
  }
  return out.join('-')
}

export function readOsLanguages(read: CommandReader): ProcessLanguages['os'] {
  const languages = read('defaults', ['read', '-g', 'AppleLanguages'])
  const launchdEnvironment: Record<string, string> = {}
  const names = ['LC_ALL', 'LC_MESSAGES', 'LANG']
  for (let i = 0; i < names.length; i++) {
    const value = read('launchctl', ['getenv', names[i]!])
    if (value !== null && value !== '') launchdEnvironment[names[i]!] = value
  }
  return { appleLanguages: languages === null ? null : parsePlistArray(languages), appleLocale: read('defaults', ['read', '-g', 'AppleLocale']), launchdEnvironment }
}

// What Chrome launches with: the process's AppleLanguages, which decide its application locale, and the accept languages.
// A run may give others (run.ts --chrome-apple-languages and --chrome-accept-languages) to observe unlabeled content under a
// second controlled locale.
export type ChromeLanguages = { appleLanguages: readonly string[]; acceptLanguages: string }
export const CHROME_LANGUAGES: ChromeLanguages = { appleLanguages: CHROME_APPLE_LANGUAGES, acceptLanguages: CHROME_ACCEPT_LANGUAGES }

function launchLanguages(kind: BrowserKind, chrome: ChromeLanguages): ProcessLanguages['launch'] {
  switch (kind) {
    case 'chrome': {
      const list = `(${chrome.appleLanguages.map(language => JSON.stringify(language)).join(', ')})`
      return { arguments: ['-AppleLanguages', list], prefs: { 'intl.accept_languages': chrome.acceptLanguages, 'intl.selected_languages': chrome.acceptLanguages } }
    }
    case 'firefox': return { arguments: [], prefs: Object.fromEntries(FIREFOX_LANGUAGE_PREFS.map(([name, value]) => [name, String(value)])) }
    case 'safari':
    case 'webkit-host': return null
  }
}

// The languages a run launches with and the given facts derived before launch. Chrome's uiLanguage and WebKit's
// preferredLanguages stay null until the first page runs (rendererLanguage, webkitPreferredLanguages).
export function derivedLanguages(kind: BrowserKind, read: CommandReader = readCommand, chrome: ChromeLanguages = CHROME_LANGUAGES): ProcessLanguages {
  const os = readOsLanguages(read)
  const launch = launchLanguages(kind, chrome)
  switch (kind) {
    case 'chrome':
      return { launch, os, given: { engine: 'blink', uiLanguage: null }, derivation: [`uiLanguage: the renderers' --lang switch, read from their command lines once the page loads; Chrome launched with ${launch!.arguments.join(' ')}`] }
    case 'firefox': {
      // An app's own AppleLanguages, which NSUserDefaults puts before the global domain; not ported for
      // CFLocaleCopyPreferredLanguages, so a Firefox domain with its own list leaves the fact unknown.
      const own = read('defaults', ['read', 'org.mozilla.firefox', 'AppleLanguages'])
      const domain = own === null ? null : parsePlistArray(own)
      let locale: string | null = null
      const list = os.appleLanguages ?? []
      for (let i = 0; i < list.length && locale === null; i++) locale = canonicalizeLanguageId(list[i]!)
      return {
        launch, os, given: { engine: 'gecko', regionalPrefsLocale: domain === null && locale !== null ? locale.toLowerCase() : null },
        derivation: [domain === null
          ? `regionalPrefsLocale: the first canonicalizable global AppleLanguages entry, lowercased (${os.appleLanguages === null ? 'AppleLanguages unreadable' : JSON.stringify(os.appleLanguages)})`
          : `regionalPrefsLocale: unknown; org.mozilla.firefox has its own AppleLanguages ${JSON.stringify(domain)}, and CFLocaleCopyPreferredLanguages' domain precedence isn't ported`],
      }
    }
    case 'safari':
    case 'webkit-host':
      return {
        launch, os, given: { engine: 'webkit', preferredLanguages: null, icuDefaultLocale: icuDefaultLocale(os.launchdEnvironment) },
        derivation: [
          'preferredLanguages: the first entry navigator.languages shows once the page loads (webkitPreferredLanguages)',
          `icuDefaultLocale: launchd environment ${JSON.stringify(os.launchdEnvironment)} through uprv_getDefaultLocaleID [I: the WebContent process environment isn't readable]`,
        ],
      }
  }
}

// WebKit's preferredLanguages as far as a page shows them. navigator.languages is { defaultLanguage() }, the first entry of
// the WebContent process's userPreferredLanguages() (NavigatorBase.cpp:148-152, Language.cpp:92-102), and FontDescription
// replaces a Han lang with the first entry of that same list starting with zh-, else zh-hans (FontDescription.cpp:75-104).
// So a first entry starting with zh- decides the rule, and the list [that entry] gives the same result. Any other first
// entry leaves the later entries unknown, which report ui-language. Whether WebContent holds the UI process's raw
// AppleLanguages or the platform's minimized list isn't settled: webkit-host on this Mac reports zh-CN where the global
// AppleLanguages start with zh-Hans-US.
export function webkitPreferredLanguages(navigatorLanguages: readonly string[]): string[] | null {
  const first = navigatorLanguages[0]
  return first !== undefined && first.slice(0, 3).toLowerCase() === 'zh-' ? [first] : null
}

// Chrome's application locale as its renderers received it: the --lang switch of every renderer process descending from
// the browser process, in a `ps -axo pid=,ppid=,command=` table. Throws when there's none, or when renderers disagree.
export function rendererLanguage(table: ReadonlyArray<{ pid: number; ppid: number; command: string }>, browserPid: number): { value: string; renderers: number } {
  const descendants = new Set([browserPid])
  for (let grew = true; grew;) {
    grew = false
    for (let i = 0; i < table.length; i++) {
      if (descendants.has(table[i]!.ppid) && !descendants.has(table[i]!.pid)) {
        descendants.add(table[i]!.pid)
        grew = true
      }
    }
  }
  const values = new Set<string>()
  let renderers = 0
  for (let i = 0; i < table.length; i++) {
    const entry = table[i]!
    if (!descendants.has(entry.pid) || !/(?:^| )--type=renderer(?: |$)/.test(entry.command)) continue
    renderers++
    const match = /(?:^| )--lang=(\S+)/.exec(entry.command)
    values.add(match === null ? '' : match[1]!)
  }
  if (renderers === 0) throw new Error(`No renderer process under Chrome ${browserPid}`)
  if (values.size !== 1 || values.has('')) throw new Error(`Chrome's renderers carry --lang values ${JSON.stringify([...values])}`)
  return { value: [...values][0]!, renderers }
}

// The given facts in one line, for environment keys (score.ts environmentKey).
export function describeGiven(given: ProcessLanguages['given']): string {
  switch (given.engine) {
    case 'blink': return `uiLanguage ${given.uiLanguage ?? 'unknown'}`
    case 'webkit': return `preferredLanguages ${given.preferredLanguages === null ? 'unknown' : given.preferredLanguages.join(',')}, icuDefaultLocale ${given.icuDefaultLocale ?? 'unknown'}`
    case 'gecko': return `regionalPrefsLocale ${given.regionalPrefsLocale ?? 'unknown'}`
  }
}
