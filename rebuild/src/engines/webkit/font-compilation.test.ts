import { expect, test } from 'bun:test'
import type { WebKitEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type FontDecl, type ListedFontFacts } from '../../model.js'
import { FontCompilation, compiledInspection, compiledSpacingFacts } from './font-compilation.js'

const font = (family: string): FontDecl => ({ family, size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS })

test('one font source home serves generated-row aliases and all Common locales', () => {
  let familyReads = 0
  const declared = { ...font(''), get family(): string { familyReads++; return 'Arial, monospace, -webkit-standard' } }
  const compilation = new FontCompilation(1, ['en-US'])
  expect(familyReads).toBe(0)
  const common = compilation.resolve(declared, 'yue', 'COMMON')
  const ja = compilation.resolve(declared, 'ja', 'KATAKANA_OR_HIRAGANA')
  for (let i = 0; i < 512; i++) {
    expect(compilation.resolve(declared, `yue-x-${i.toString(36)}`, 'COMMON')).toBe(common)
    expect(compilation.resolve(declared, `ja-JP-x-${i.toString(36)}`, 'KATAKANA_OR_HIRAGANA')).toBe(ja)
  }
  expect(familyReads).toBeLessThan(16)
  expect(common.base.family).toBe('Arial, monospace, -webkit-standard')
  expect(ja.base.family).toBe('Arial, "Menlo", "Hiragino Mincho ProN"')
})

test('quoted keywords, standard-family fallback and diagnostic prefixes keep their source meanings', () => {
  const compilation = new FontCompilation(1.25, null)
  const choice = compilation.resolve(font('"serif", Arial, -webkit-standard, system-ui'), 'zh', 'HAN')
  expect(choice.base.family).toBe('"serif", Arial, -webkit-standard, system-ui')
  expect(choice.base.canvasFont).toBe('normal 400 20px "serif", Arial, -webkit-standard, system-ui')
  expect(compiledInspection(choice.base)).toEqual({ unknownFamily: true, namedGeneric: false, namedLastResortFont: 'normal 400 20px "serif", Arial, LastResort' })
  const known = new FontCompilation(1, ['zh-TW', 'zh-CN'])
  const ja = known.resolve(font('Unknown, "serif", Arial'), 'ja', 'KATAKANA_OR_HIRAGANA')
  const appended = known.withStandardFamily(ja)
  expect(appended.family).toBe('Unknown, "serif", Arial, "Hiragino Mincho ProN"')
  expect(compiledInspection(appended)).toEqual({ unknownFamily: false, namedGeneric: true, namedLastResortFont: 'normal 400 16px Unknown, "serif", Arial, LastResort' })
  expect(known.withStandardFamily(ja)).toBe(appended)
  expect(known.resolve(font('-webkit-standard'), 'zh', 'HAN').base.family).toBe('"Songti TC"')
})

test('spacing facts follow the chosen source list and fresh preparations reread the declaration', () => {
  const listed: ListedFontFacts = { family: 'Arial', realizes: true, coverage: [32, 127], ligatures: null, scriptLookups: null, spacingInputs: [102, 105] }
  const declared = { ...font('Arial'), facts: { ...UNKNOWN_FONT_FACTS, fonts: [listed] } }
  const compilation = new FontCompilation(1, ['en-US'])
  const choice = compilation.resolve(declared, 'ja', 'KATAKANA_OR_HIRAGANA')
  const facts = compiledSpacingFacts(choice.base)
  expect(facts!.canChange('a')).toBe(false)
  expect(facts!.canChange('f')).toBe(true)
  expect(facts!.canChange('中')).toBeNull()
  expect(compiledSpacingFacts(choice.base)).toBe(facts)
  expect(compiledSpacingFacts(compilation.withStandardFamily(choice))).toBeNull()
  declared.family = 'Menlo'
  expect(new FontCompilation(1, ['en-US']).resolve(declared, 'en', 'LATIN').base.family).toBe('Menlo')
  expect(() => new FontCompilation(1, ['en-US']).resolve(font('Arial,, serif'), 'en', 'LATIN')).toThrow('isn\'t a list of family names')
})

test('specialized Han locale reads one preparation language source on first demand', () => {
  let reads = 0, refuseRead = true
  const languages = new Proxy(['en-US', 'fr', 'zh-TW'], { get(target, property, receiver) {
    if (typeof property === 'string' && /^\d+$/.test(property)) {
      reads++
      if (refuseRead) throw new Error('preferred language read')
    }
    return Reflect.get(target, property, receiver)
  } })
  const compilation = new FontCompilation(1, languages)
  expect(compilation.localeOf('').locale.name).toBe('')
  expect(compilation.localeOf('en').locale.name).toBe('en')
  expect(reads).toBe(0)
  expect(() => compilation.localeOf('zh')).toThrow('preferred language read')
  refuseRead = false
  reads = 0
  for (let i = 0; i < 512; i++) expect(compilation.localeOf(`zh-unknown-${i}`).locale.name).toBe('zh-TW')
  // One source read for the prefix test and one to return the selected entry, as computedLocale has always done.
  expect(reads).toBe(4)
  expect(compilation.localeOf('zh-Hant').locale.name).toBe('zh-Hant')
  expect(reads).toBe(4)
  expect(new FontCompilation(1, ['en-US', 'zh-CN']).localeOf('zh').locale.name).toBe('zh-CN')
  expect(new FontCompilation(1, null).localeOf('zh').locale.name).toBe('zh-hans')
})


test('one consumed locale source owns its script and generated font row', () => {
  const long = 'en-x-' + Array.from({ length: 128 }, () => 'abcd').join('-')
  const compilation = new FontCompilation(1, ['zh-TW'])
  const source = compilation.localeOf(long)
  expect(source.locale.name).toBe(long)
  expect(source.locale.script).toBe('LATIN')
  expect(source.locale.row).toBeUndefined()
  const declared = font('Arial, monospace')
  const choice = compilation.resolve(declared, source.locale.name, source.locale.script)
  const row = source.locale.row
  expect(row).toBeDefined()
  for (let i = 0; i < 512; i++) {
    expect(compilation.localeOf(long)).toBe(source)
    expect(compilation.resolve(declared, source.locale.name, source.locale.script)).toBe(choice)
    expect(source.locale.row).toBe(row)
  }
  compilation.resolve(font('Arial'), 'zh', 'HAN')
  const han = compilation.localeOf('zh')
  expect(han.locale.name).toBe('zh-TW')
  expect(compilation.localeOf('zh-unknown').locale).toBe(han.locale)
  expect(compilation.localeOf('zh-TW').locale).toBe(han.locale)
  expect(new FontCompilation(1, ['zh-CN']).localeOf(long)).not.toBe(source)
})


test('font-row source is demanded after declaration validation and only once', () => {
  const long = 'en-x-' + Array.from({ length: 128 }, () => 'abcd').join('-')
  const compilation = new FontCompilation(1, ['en-US'])
  const source = compilation.localeOf(long).locale
  let reads = 0, refuseRead = true
  Object.defineProperty(source, 'name', { get: () => { reads++; if (refuseRead) throw new Error('font row source'); return long } })
  expect(() => compilation.resolve(font('Arial,, serif'), long, source.script)).toThrow("isn't a list of family names")
  expect(reads).toBe(0)
  const declared = font('Arial, monospace')
  expect(() => compilation.resolve(declared, long, source.script)).toThrow('font row source')
  refuseRead = false
  reads = 0
  const first = compilation.resolve(declared, long, source.script)
  for (let i = 0; i < 512; i++) expect(compilation.resolve(declared, long, source.script)).toBe(first)
  expect(reads).toBe(1)
})

// These budgets exercise the actual exported engine path, not the source view's representation.
// The previous family-by-character classifier must fail the high-fanout budget even though it gives the same lines.
test('exported WebKit spacing bounds source reads independently of character times family fanout', async () => {
  const { prepare, firstLine, fillLine, linePieces, inspectLine } = await import('./index.js')
  const { createContextPool } = await import('../../measure/canvas.js')
  const { PINNED_BUILDS } = await import('../../env.js')
  const savedCanvas = globalThis.OffscreenCanvas
  let reads = 0, calls = 0, units = 0
  const watched = (a: number[]): readonly number[] => new Proxy(a, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++
    return Reflect.get(target, key, receiver)
  } })
  class StandIn {
    font = ''; letterSpacing = '0px'
    measureText(text: string): { width: number } { calls++; units += text.length; return { width: Math.fround(text.length * (8 + parseFloat(this.letterSpacing))) } }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): StandIn { return new StandIn() } }
  try {
    const count = 512
    const listed: ListedFontFacts[] = Array.from({ length: count }, (_, i) => ({ family: 'Present' + i, realizes: true, coverage: watched([0x4000 + i, 0x4000 + i]), spacingInputs: [], ligatures: null, scriptLookups: null }))
    listed.push({ family: 'Winner', realizes: true, coverage: watched([0, 0x10ffff]), spacingInputs: [], ligatures: null, scriptLookups: null })
    const declared = { ...font(listed.map(value => JSON.stringify(value.family)).join(',')), facts: { ...UNKNOWN_FONT_FACTS, monospace: false, mapsHyphen: true, fonts: listed } }
    const paragraph = { font: declared, content: [{ kind: 'text' as const, text: 'a'.repeat(count) }], letterSpacing: 1, wordSpacing: 0, lineHeight: 20, whiteSpace: 'normal' as const, wordBreak: 'normal' as const, overflowWrap: 'normal' as const, lineBreak: 'auto' as const, tabSize: 8, direction: 'ltr' as const, lang: 'en', textIndent: 0, textAlign: 'start' as const }
    const env: WebKitEnvironment = { engine: 'webkit', build: PINNED_BUILDS.webkit, devicePixelRatio: 2, pageZoom: 1, pageLang: 'en', contentLanguage: null, preferredLanguages: ['en-US'], icuDefaultLocale: 'en_US_POSIX', dictionaryBreaks: { kind: 'unavailable' } }
    const prepared = prepare(paragraph, env, true, createContextPool()), start = firstLine(prepared)!
    const filled = fillLine(prepared, start, { width: 100000, left: 0, right: 0 })
    expect(filled.kind).toBe('line')
    if (filled.kind !== 'line') throw new Error('unexpected refusal')
    expect(filled.next).toBeNull()
    expect(linePieces(prepared, filled.line).fragments).toHaveLength(1)
    expect(inspectLine(prepared, filled.line).geometry!.boxes.filter(box => box.kind === 'text')).toHaveLength(1)
    expect(reads).toBeLessThan(8192)
    // The source analysis changes no measuring recipe or question count.
    expect(calls).toBe(2)
    expect(units).toBe(count + 1)
  } finally { globalThis.OffscreenCanvas = savedCanvas }
})

test('tiny exported WebKit text does not sweep giant unused later spacing sources', async () => {
  const { prepare } = await import('./index.js')
  const { createContextPool } = await import('../../measure/canvas.js')
  const { PINNED_BUILDS } = await import('../../env.js')
  const savedCanvas = globalThis.OffscreenCanvas
  let unused = 0
  const giant: number[] = []
  for (let cp = 0; cp < 65537; cp++) giant.push(cp * 2, cp * 2)
  const watched = new Proxy(giant, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) unused++
    return Reflect.get(target, key, receiver)
  } })
  class StandIn { letterSpacing = '0px'; measureText(text: string): { width: number } { return { width: text.length * (8 + parseFloat(this.letterSpacing)) } } }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): StandIn { return new StandIn() } }
  try {
    const listed: ListedFontFacts[] = [
      { family: 'First', realizes: true, coverage: [32, 127], spacingInputs: [], ligatures: null, scriptLookups: null },
      { family: 'Later', realizes: true, coverage: watched, spacingInputs: watched, ligatures: null, scriptLookups: null },
    ]
    const declared = { ...font('First, Later'), facts: { ...UNKNOWN_FONT_FACTS, monospace: false, mapsHyphen: true, fonts: listed } }
    const p = { font: declared, content: [{ kind: 'text' as const, text: 'aa' }], letterSpacing: 1, wordSpacing: 0, lineHeight: 20, whiteSpace: 'normal' as const, wordBreak: 'normal' as const, overflowWrap: 'normal' as const, lineBreak: 'auto' as const, tabSize: 8, direction: 'ltr' as const, lang: 'en', textIndent: 0, textAlign: 'start' as const }
    const env: WebKitEnvironment = { engine: 'webkit', build: PINNED_BUILDS.webkit, devicePixelRatio: 2, pageZoom: 1, pageLang: 'en', contentLanguage: null, preferredLanguages: ['en-US'], icuDefaultLocale: 'en_US_POSIX', dictionaryBreaks: { kind: 'unavailable' } }
    prepare(p, env, false, createContextPool())
    expect(unused).toBe(0)
  } finally { globalThis.OffscreenCanvas = savedCanvas }
})

test('an unknown family anywhere keeps the existing global spacing-facts barrier', () => {
  const known: ListedFontFacts = { family: 'First', realizes: true, coverage: [0, 0x10ffff], spacingInputs: [], ligatures: null, scriptLookups: null }
  for (const unknown of [
    { ...known, family: 'Later', realizes: null },
    { ...known, family: 'Later', coverage: null },
    { ...known, family: 'Later', spacingInputs: null },
    { ...known, family: 'Later', realizes: null, get coverage(): readonly number[] { throw new Error('unknown coverage source read') } },
  ]) {
    const declared = { ...font('First, Later'), facts: { ...UNKNOWN_FONT_FACTS, fonts: [known, unknown] } }
    expect(compiledSpacingFacts(new FontCompilation(1, ['en-US']).resolve(declared, 'en', 'LATIN').base)).toBeNull()
  }
})
