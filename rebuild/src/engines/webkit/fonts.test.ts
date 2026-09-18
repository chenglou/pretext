// The generic family lookup of fonts.ts against rows of data/webkit/coretext-macos27/css-families.tsv, and Emoji_Presentation
// against emoji-data.txt values (Unicode 17.0).
import { describe, expect, test } from 'bun:test'
import { genericFamilyUnder, hasEmojiPresentation, standardFamilyOf } from './fonts.js'

describe('the family a generic keyword stands for under a locale', () => {
  test('a language takes its own entry, else its parent\'s, else the default; case and separators don\'t matter', () => {
    expect(genericFamilyUnder('serif', 'ja', 'KATAKANA_OR_HIRAGANA', null)).toBe('Hiragino Mincho ProN')
    expect(genericFamilyUnder('sans-serif', 'ja-JP-u-ca-japanese', 'KATAKANA_OR_HIRAGANA', null)).toBe('Hiragino Sans')
    expect(genericFamilyUnder('sans-serif', 'zh-Hant-HK', 'TRADITIONAL_HAN', null)).toBe('PingFang HK')
    expect(genericFamilyUnder('sans-serif', 'zh_TW', 'TRADITIONAL_HAN', null)).toBe('PingFang TC')
    expect(genericFamilyUnder('sans-serif', 'ZH-hans', 'SIMPLIFIED_HAN', null)).toBe('PingFang SC')
    expect(genericFamilyUnder('serif', 'pa-Arab', 'ARABIC', null)).toBe('Geeza Pro')
    expect(genericFamilyUnder('cursive', 'ru', 'CYRILLIC', null)).toBe('Snell Roundhand')
  })

  test('null where the keyword resolves as it does without a locale: the settings\' family, a reserved name, a Common script', () => {
    expect(genericFamilyUnder('serif', 'en', 'LATIN', null)).toBe(null)
    expect(genericFamilyUnder('sans-serif', 'en-US', 'LATIN', null)).toBe(null)
    expect(genericFamilyUnder('cursive', 'he', 'HEBREW', null)).toBe(null)
    expect(genericFamilyUnder('monospace', 'en', 'LATIN', null)).toBe('Menlo')
    expect(genericFamilyUnder('monospace', 'he', 'HEBREW', null)).toBe('Courier New')
    expect(genericFamilyUnder('monospace', 'yue', 'COMMON', null)).toBe(null)
    expect(genericFamilyUnder('system-ui', 'ja', 'KATAKANA_OR_HIRAGANA', null)).toBe(null)
  })

  test('-webkit-standard is the settings\' family of the script (SettingsBaseCocoa.mm:44-50)', () => {
    expect(genericFamilyUnder('-webkit-standard', 'ko', 'HANGUL', null)).toBe('AppleMyungjo')
    expect(genericFamilyUnder('-webkit-standard', 'zh', 'HAN', null)).toBe(null)
    // USCRIPT_HAN: the first of zh-tw and zh-cn among the preferred languages, Simplified without either (Language.cpp:129-138).
    expect(genericFamilyUnder('-webkit-standard', 'zh', 'HAN', ['en-US'])).toBe('Songti SC')
    expect(genericFamilyUnder('-webkit-standard', 'zh', 'HAN', ['zh-CN', 'zh-TW'])).toBe('Songti SC')
    expect(genericFamilyUnder('-webkit-standard', 'zh', 'HAN', ['en', 'zh-TW', 'zh-CN'])).toBe('Songti TC')
    expect(genericFamilyUnder('-webkit-standard', 'th', 'THAI', null)).toBe(null)
    expect(standardFamilyOf('SIMPLIFIED_HAN', null)).toBe('Songti SC')
  })
})

describe('Emoji_Presentation', () => {
  test('emoji-default characters, and text-default ones apart', () => {
    for (const cp of [0x231a, 0x26a1, 0x2b50, 0x1f600, 0x1f1e6, 0x1faf8]) expect([cp.toString(16), hasEmojiPresentation(cp)]).toEqual([cp.toString(16), true])
    for (const cp of [0x2764, 0x263a, 0xa9, 0x23, 0x41, 0x4e2d, 0x1f321]) expect([cp.toString(16), hasEmojiPresentation(cp)]).toEqual([cp.toString(16), false])
  })
})
