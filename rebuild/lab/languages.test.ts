import { describe, expect, test } from 'bun:test'
import { canonicalizeLanguageId, derivedLanguages, describeGiven, icuDefaultLocale, parsePlistArray, readWebContentLanguages, rendererLanguage, WEBKIT_HOST_EXECUTABLE, webkitLanguageCheck, type CommandReader } from './languages.ts'

// A command reader over fixed outputs, keyed by the command line.
function reader(outputs: Record<string, string>): CommandReader {
  return (command, commandArgs) => outputs[[command, ...commandArgs].join(' ')] ?? null
}

const THIS_MAC = { 'defaults read -g AppleLanguages': '(\n    "zh-Hans-US",\n    "en-US"\n)', 'defaults read -g AppleLocale': 'zh_Hans_US' }
// What `webkit-host --print-languages` printed on this Mac on 2026-09-17.
const HOST_LANGUAGES = '{"cfPreferredLanguages":["zh-Hans-US","en-US"],"minimized":["zh-CN","zh-Hans"],"minimizes":true,"overrideLanguages":["zh-Hans-US","en-US"],"preferredLanguages":["zh-CN","zh-Hans"]}'
const WITH_HOST = { ...THIS_MAC, [`${WEBKIT_HOST_EXECUTABLE} --print-languages`]: HOST_LANGUAGES }

describe('OS settings as research tooling reads them', () => {
  test('defaults prints an old-style plist array', () => {
    expect(parsePlistArray('(\n    "zh-Hans-US",\n    "en-US"\n)')).toEqual(['zh-Hans-US', 'en-US'])
    expect(parsePlistArray('(\n)')).toEqual([])
    expect(parsePlistArray('zh_Hans_US')).toBeNull()
  })

  test('the WebContent ICU default locale follows LC_ALL, LC_MESSAGES and LANG, else en_US_POSIX', () => {
    expect(icuDefaultLocale({})).toBe('en_US_POSIX')
    expect(icuDefaultLocale({ LANG: 'ja_JP.UTF-8' })).toBe('ja_JP')
    expect(icuDefaultLocale({ LANG: 'C', LC_MESSAGES: 'POSIX' })).toBe('en_US_POSIX')
    expect(icuDefaultLocale({ LC_ALL: 'de_DE@euro', LANG: 'ja_JP.UTF-8' })).toBe('de_DE')
  })

  test('language tags canonicalize the way unic_langid_canonicalize does', () => {
    expect(canonicalizeLanguageId('zh-Hans-US')).toBe('zh-Hans-US')
    expect(canonicalizeLanguageId('ZH_hans_us')).toBe('zh-Hans-US')
    expect(canonicalizeLanguageId('en-US.utf8')).toBe('en-US')
    expect(canonicalizeLanguageId('sr-Latn-RS')).toBe('sr-Latn-RS')
    expect(canonicalizeLanguageId('x')).toBeNull()
  })
})

describe('given facts per browser', () => {
  test('Chrome launches with -AppleLanguages and takes its uiLanguage from its renderers', () => {
    const languages = derivedLanguages('chrome', reader(THIS_MAC))
    expect(languages.launch).toEqual({ arguments: ['-AppleLanguages', '("zh-Hans-US", "en-US")'], prefs: { 'intl.accept_languages': 'zh-CN,zh', 'intl.selected_languages': 'zh-CN,zh' } })
    expect(languages.given).toEqual({ engine: 'blink', uiLanguage: null })
    expect(languages.os).toEqual({ appleLanguages: ['zh-Hans-US', 'en-US'], appleLocale: 'zh_Hans_US', launchdEnvironment: {} })
  })

  test('Firefox takes the first canonicalizable global AppleLanguages entry, lowercased', () => {
    const languages = derivedLanguages('firefox', reader(THIS_MAC))
    expect(languages.given).toEqual({ engine: 'gecko', regionalPrefsLocale: 'zh-hans-us' })
    expect(languages.launch).toEqual({ arguments: [], prefs: { 'intl.locale.requested': 'en-US', 'intl.accept_languages': 'en-US, en', 'intl.regional_prefs.use_os_locales': 'false' } })
    const own = derivedLanguages('firefox', reader({ ...THIS_MAC, 'defaults read org.mozilla.firefox AppleLanguages': '(\n    "ja-JP"\n)' }))
    expect(own.given).toEqual({ engine: 'gecko', regionalPrefsLocale: null })
  })

  test('Safari and webkit-host take the WebContent process\'s languages from webkit-host --print-languages before launch', () => {
    const host = derivedLanguages('webkit-host', reader(WITH_HOST))
    expect(host.given).toEqual({ engine: 'webkit', preferredLanguages: ['zh-CN', 'zh-Hans'], icuDefaultLocale: 'en_US_POSIX' })
    expect(host.webContent).toEqual(JSON.parse(HOST_LANGUAGES))
    expect(host.launch).toBeNull()
    const safari = derivedLanguages('safari', reader({ ...WITH_HOST, 'launchctl getenv LANG': 'ja_JP.UTF-8' }))
    expect(safari.given).toEqual({ engine: 'webkit', preferredLanguages: ['zh-CN', 'zh-Hans'], icuDefaultLocale: 'ja_JP' })
    // Without the helper, or with an app domain of its own, the list is unknown.
    expect(derivedLanguages('webkit-host', reader(THIS_MAC)).given).toEqual({ engine: 'webkit', preferredLanguages: null, icuDefaultLocale: 'en_US_POSIX' })
    expect(derivedLanguages('safari', reader({ ...WITH_HOST, 'defaults read com.apple.Safari AppleLanguages': '(\n    "ja-JP"\n)' })).given).toEqual({ engine: 'webkit', preferredLanguages: null, icuDefaultLocale: 'en_US_POSIX' })
  })

  test('the helper\'s output is read strictly', () => {
    expect(readWebContentLanguages(reader(WITH_HOST))).toEqual(JSON.parse(HOST_LANGUAGES))
    expect(readWebContentLanguages(reader({ [`${WEBKIT_HOST_EXECUTABLE} --print-languages`]: '{"preferredLanguages":["zh-CN"]}' }))).toBeNull()
    expect(readWebContentLanguages(reader({}))).toBeNull()
  })

  test('the page only checks the derived list: navigator.languages shows its first entry', () => {
    expect(webkitLanguageCheck(['zh-CN', 'zh-Hans'], ['zh-CN'])).toBeNull()
    expect(webkitLanguageCheck(['zh-CN', 'zh-Hans'], ['en-US'])).toBe('the page shows navigator.languages ["en-US"], but the WebContent process\'s derived preferred languages are ["zh-CN","zh-Hans"]')
    expect(webkitLanguageCheck(null, ['zh-CN'])).toBeNull()
  })

  test('Chrome\'s renderers under the launched browser carry its application locale', () => {
    const table = [
      { pid: 100, ppid: 1, command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/p' },
      { pid: 101, ppid: 100, command: 'Google Chrome Helper --type=gpu-process --lang=zh-CN' },
      { pid: 102, ppid: 100, command: 'Google Chrome Helper (Renderer) --type=renderer --lang=zh-CN --renderer-client-id=5' },
      { pid: 300, ppid: 1, command: 'Google Chrome Helper (Renderer) --type=renderer --lang=en-US' },
    ]
    expect(rendererLanguage(table, 100)).toEqual({ value: 'zh-CN', renderers: 1 })
    expect(() => rendererLanguage([...table, { pid: 103, ppid: 102, command: 'Helper --type=renderer --lang=en-US' }], 100)).toThrow('--lang values')
    expect(() => rendererLanguage(table.slice(0, 2), 100)).toThrow('No renderer process')
  })

  test('environment keys name the given facts', () => {
    expect(describeGiven({ engine: 'blink', uiLanguage: 'zh-CN' })).toBe('uiLanguage zh-CN')
    expect(describeGiven({ engine: 'webkit', preferredLanguages: ['zh-Hans-US', 'en-US'], icuDefaultLocale: 'en_US_POSIX' })).toBe('preferredLanguages zh-Hans-US,en-US, icuDefaultLocale en_US_POSIX')
    expect(describeGiven({ engine: 'gecko', regionalPrefsLocale: null })).toBe('regionalPrefsLocale unknown')
  })
})
