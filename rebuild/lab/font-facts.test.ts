import { describe, expect, test } from 'bun:test'
import type { EngineName } from '../src/env.ts'
import { UNKNOWN_FONT_FACTS, type CssFont, type FontFacts } from '../src/model.ts'
import { fontFactsFor, labDeclarations, parseFamilyList, resolveFontFacts } from './font-facts.ts'
import table from './font-facts.json' with { type: 'json' }

const ENGINES: EngineName[] = ['blink', 'webkit', 'gecko']
const FIXTURES = ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'ProbeShantell', 'Shantell Sans']
const faces = (table as unknown as { faces: Record<string, { postScriptName: string; cmapU2010: boolean; coreTextGlyphU2010: number; monoSpaceTrait: boolean; morx: boolean; gsub: boolean }> }).faces
const families = (table as unknown as { families: Record<string, { faces: string[] }> }).families

function font(family: string, weight = 400, style: CssFont['style'] = 'normal'): CssFont {
  return { family, size: 16, weight, style }
}

function names(ids: string[]): string[] {
  return ids.map(id => faces[id]!.postScriptName)
}

function face(postScriptName: string) {
  return Object.values(faces).find(f => f.postScriptName === postScriptName)!
}

describe('parseFamilyList', () => {
  test('quoted and unquoted names; generic keywords only unquoted', () => {
    expect(parseFamilyList('"Helvetica Neue", Helvetica,  Arial ,sans-serif')).toEqual([
      { name: 'Helvetica Neue', generic: false }, { name: 'Helvetica', generic: false }, { name: 'Arial', generic: false }, { name: 'sans-serif', generic: true },
    ])
    expect(parseFamilyList("Times   New Roman, 'serif'")).toEqual([{ name: 'Times New Roman', generic: false }, { name: 'serif', generic: false }])
  })
})

describe('recorded verdicts', () => {
  test('Geeza Pro shapes through morx, with no GSUB (probes-chrome correction 3)', () => {
    const r = resolveFontFacts(font('"Geeza Pro"'), 'blink', [])
    expect(names(r.primaryFaces)).toEqual(['GeezaPro'])
    expect(face('GeezaPro').morx).toBe(true)
    expect(face('GeezaPro').gsub).toBe(false)
    expect(r.facts.joining).toBe('aat')
  })

  test('Noto Naskh Arabic joins through GSUB (probes-chrome blink-text H3, H29)', () => {
    expect(fontFactsFor(font('"Noto Naskh Arabic"'), 'blink', FIXTURES).joining).toBe('opentype')
  })

  test('Amiri is OpenType; without the fixture loaded it realizes nothing and every fact is unknown', () => {
    expect(fontFactsFor(font('Amiri'), 'blink', FIXTURES).joining).toBe('opentype')
    expect(fontFactsFor(font('Amiri'), 'blink', [])).toEqual(UNKNOWN_FONT_FACTS)
  })

  test('no cmap U+2010 in Arial, Times, Times New Roman, Courier New, Georgia, Verdana, but a Core Text glyph; Helvetica 581, Helvetica Neue 619 (blink-gaps §5.5)', () => {
    for (const ps of ['ArialMT', 'Times-Roman', 'TimesNewRomanPSMT', 'CourierNewPSMT', 'Georgia', 'Verdana']) {
      expect([ps, face(ps).cmapU2010, face(ps).coreTextGlyphU2010]).toEqual([ps, false, 16])
    }
    expect(face('Helvetica').coreTextGlyphU2010).toBe(581)
    expect(face('HelveticaNeue').coreTextGlyphU2010).toBe(619)
    expect(fontFactsFor(font('Arial'), 'blink', []).mapsHyphen).toBe(true)
  })

  test('the monospace trait on Menlo, Courier New and Courier, not on Osaka without -Mono (webkit-gaps §2.4)', () => {
    for (const family of ['Menlo', '"Courier New"', 'Courier']) expect([family, fontFactsFor(font(family), 'webkit', []).monospace]).toEqual([family, true])
    expect(fontFactsFor(font('Arial'), 'webkit', []).monospace).toBe(false)
    expect(face('Osaka').monoSpaceTrait).toBe(false)
    expect(face('Osaka-Mono').monoSpaceTrait).toBe(true)
  })

  test('equally good faces: WebKit and Blink take the first in their order, Gecko keeps both (rules.tiedFaces)', () => {
    // Both faces of the Osaka family are 400 upright, so the CSS search ties. `16px Osaka` measures a hyphen 6.0625 wide
    // in Safari, the proportional face (webkit-gaps §3.2).
    expect(names(resolveFontFacts(font('Osaka'), 'webkit', []).primaryFaces)).toEqual(['Osaka'])
    expect(fontFactsFor(font('Osaka'), 'webkit', []).monospace).toBe(false)
    expect(names(resolveFontFacts(font('Osaka'), 'blink', []).primaryFaces)).toEqual(['Osaka'])
    expect(names(resolveFontFacts(font('Osaka'), 'gecko', []).primaryFaces).sort()).toEqual(['Osaka', 'Osaka-Mono'])
    expect(fontFactsFor(font('Osaka'), 'gecko', []).monospace).toBe(null)
    // Hoefler Text's family holds its Ornaments face at the same weight and slope.
    expect(names(resolveFontFacts(font('"Hoefler Text"'), 'blink', []).primaryFaces)).toEqual(['HoeflerText-Regular'])
    expect(names(resolveFontFacts(font('"Hoefler Text"'), 'gecko', []).primaryFaces)).toEqual(['HoeflerText-Regular', 'HoeflerText-Ornaments'])
  })

  test('Osaka and Apple SD Gothic Neo map U+2010 (webkit-gaps §3.2)', () => {
    expect(fontFactsFor(font('Osaka'), 'webkit', []).mapsHyphen).toBe(true)
    expect(fontFactsFor(font('"Apple SD Gothic Neo"'), 'webkit', []).mapsHyphen).toBe(true)
  })
})

describe('resolution', () => {
  test('upright Arial has Arabic through GSUB; italic Arial has none, so Geeza Pro draws it', () => {
    expect(fontFactsFor(font('Arial'), 'blink', []).joining).toBe('opentype')
    const italic = resolveFontFacts(font('Arial', 700, 'italic'), 'blink', [])
    expect(names(italic.primaryFaces)).toEqual(['Arial-BoldItalicMT'])
    expect(names(italic.joiningFaces)).toEqual(['GeezaPro-Bold'])
    expect(italic.facts.joining).toBe('aat')
  })

  test('weights search the CSS way: 300 and 500 take Regular, 700 Bold', () => {
    expect(names(resolveFontFacts(font('Arial', 300), 'blink', []).primaryFaces)).toEqual(['ArialMT'])
    expect(names(resolveFontFacts(font('Arial', 500), 'blink', []).primaryFaces)).toEqual(['ArialMT'])
    expect(names(resolveFontFacts(font('Arial', 700), 'blink', []).primaryFaces)).toEqual(['Arial-BoldMT'])
    expect(names(resolveFontFacts(font('"Helvetica Neue"', 700), 'webkit', []).primaryFaces)).toEqual(['HelveticaNeue-Bold'])
  })

  test('a later family draws Arabic when the primary has none', () => {
    const r = resolveFontFacts(font('"Helvetica Neue", Helvetica, Arial, sans-serif'), 'blink', [])
    expect(r.facts.primaryFamily).toBe('Helvetica Neue')
    expect(names(r.joiningFaces)).toEqual(['ArialMT'])
    expect(r.facts.joining).toBe('opentype')
  })

  test('a generic keyword stands for itself, with the facts all its candidates agree on', () => {
    for (const engine of ENGINES) {
      const f = fontFactsFor(font('serif'), engine, [])
      expect([engine, f.primaryFamily, f.opticalSizeAxis, f.monospace]).toEqual([engine, 'serif', false, false])
    }
    expect(fontFactsFor(font('serif'), 'blink', []).mapsHyphen).toBe(true)
    expect(fontFactsFor(font('serif'), 'webkit', []).mapsHyphen).toBe(true)
    expect(fontFactsFor(font('serif'), 'blink', []).joining).toBe('aat')
    // Gecko's serif candidates for zh-CN and he include Times New Roman, which has no cmap U+2010, and Al Bayan, which does.
    expect(fontFactsFor(font('serif'), 'gecko', []).mapsHyphen).toBe(null)
    // Blink's Japanese fixed family is Osaka, whose first face isn't fixed pitch, beside Menlo, which is.
    expect(fontFactsFor(font('monospace'), 'blink', []).monospace).toBe(null)
  })

  test('a quoted generic name is a family name the table never probed', () => {
    expect(fontFactsFor(font('"serif"'), 'blink', [])).toEqual(UNKNOWN_FONT_FACTS)
  })

  test('an unprobed family before the primary makes every fact unknown; after it, only the Arabic font is unknown', () => {
    expect(fontFactsFor(font('"Unprobed Family", Arial'), 'blink', [])).toEqual(UNKNOWN_FONT_FACTS)
    const after = fontFactsFor(font('Helvetica, "Unprobed Family", Arial'), 'blink', [])
    expect([after.primaryFamily, after.mapsHyphen, after.joining]).toEqual(['Helvetica', true, null])
  })

  test("each engine's notion of U+2010: Gecko reads the cmap alone", () => {
    expect(ENGINES.map(engine => fontFactsFor(font('Arial'), engine, []).mapsHyphen)).toEqual([true, true, false])
    expect(ENGINES.map(engine => fontFactsFor(font('"Geeza Pro"'), engine, []).mapsHyphen)).toEqual([false, false, false])
  })

  test('the table only names probed families and faces', () => {
    for (const [name, family] of Object.entries(families)) for (const id of family.faces) expect([name, faces[id] !== undefined]).toEqual([name, true])
  })
})

describe('lab declarations', () => {
  test('every declaration the lab cases name gives each engine every fact that engine reads', () => {
    const read: Record<EngineName, Array<keyof FontFacts>> = {
      blink: ['primaryFamily', 'mapsHyphen', 'opticalSizeAxis', 'joining'],
      webkit: ['primaryFamily', 'mapsHyphen', 'monospace'],
      gecko: ['primaryFamily', 'opticalSizeAxis'],
    }
    // A platform UI font name another engine owns is an ordinary family name that matches nothing there, so the engine falls
    // to its standard family, which the table doesn't resolve (rules.systemUI).
    const unrealized: Record<EngineName, string[]> = { blink: ['-apple-system'], webkit: ['BlinkMacSystemFont'], gecko: ['BlinkMacSystemFont'] }
    const missing: string[] = []
    const declarations = labDeclarations()
    expect(declarations.length).toBeGreaterThan(100)
    for (const d of declarations) {
      for (const engine of ENGINES) {
        const facts = fontFactsFor(font(d.family, d.weight, d.style), engine, FIXTURES)
        if (unrealized[engine].includes(d.family)) { expect([engine, d.family, facts]).toEqual([engine, d.family, UNKNOWN_FONT_FACTS]); continue }
        for (const k of read[engine]) if (facts[k] === null) missing.push(`${engine} ${d.family} ${d.weight} ${d.style}: ${k}`)
      }
    }
    expect(missing).toEqual([])
  })
})

// Whether sorted inclusive ranges hold a code point.
function covers(ranges: readonly number[] | null | undefined, cp: number): boolean | null {
  if (ranges === null || ranges === undefined) return null
  for (let i = 0; i < ranges.length; i += 2) if (ranges[i]! <= cp && cp <= ranges[i + 1]!) return true
  return false
}

// A pattern's strings, for small patterns.
function strings(positions: readonly (readonly string[])[]): string[] {
  let out = ['']
  for (const alts of positions) out = out.flatMap(prefix => alts.map(alt => prefix + alt))
  return out
}

function listed(family: string, engine: EngineName, weight = 400, style: CssFont['style'] = 'normal') {
  return fontFactsFor(font(family, weight, style), engine, FIXTURES).fonts!
}

describe('the families the rule cases added', () => {
  test('Hoefler Text, Kohinoor Bangla and Monaco have every fact their engines read', () => {
    expect(fontFactsFor(font('"Hoefler Text"'), 'blink', [])).toMatchObject({ primaryFamily: 'Hoefler Text', mapsHyphen: true, opticalSizeAxis: false, pairKerning: 'split' })
    expect(fontFactsFor(font('"Kohinoor Bangla"'), 'blink', [])).toMatchObject({ primaryFamily: 'Kohinoor Bangla', mapsHyphen: true, opticalSizeAxis: false, pairKerning: 'first-advance' })
    expect(fontFactsFor(font('Monaco'), 'webkit', [])).toMatchObject({ primaryFamily: 'Monaco', mapsHyphen: true, monospace: true })
    expect(face('Monaco').morx).toBe(true)
  })

  test('the platform UI font: system-ui in all three, BlinkMacSystemFont in Blink, -apple-system in WebKit and Gecko', () => {
    for (const [family, engines] of [['system-ui', ENGINES], ['BlinkMacSystemFont', ['blink']], ['-apple-system', ['webkit', 'gecko']]] as Array<[string, EngineName[]]>) {
      for (const engine of ENGINES) {
        const r = resolveFontFacts(font(family), engine, [])
        if (!engines.includes(engine)) { expect([family, engine, r.facts]).toEqual([family, engine, UNKNOWN_FONT_FACTS]); continue }
        expect([family, engine, names(r.primaryFaces)]).toEqual([family, engine, ['.SFNS-Regular']])
        expect(r.facts).toMatchObject({ primaryFamily: family, opticalSizeAxis: true, monospace: false, mapsHyphen: true, pairKerning: 'first-advance' })
      }
    }
    // Every weight is an instance of the same variable font file; italic is the other file.
    expect(names(resolveFontFacts(font('system-ui', 700), 'blink', []).primaryFaces)).toEqual(['.SFNS-Regular'])
    expect(names(resolveFontFacts(font('system-ui', 400, 'italic'), 'blink', []).primaryFaces)).toEqual(['.SFNS-RegularItalic'])
    // Quoted, system-ui is a family name nobody probed, and Gecko's -apple-system counts as an identifier only.
    expect(fontFactsFor(font('"system-ui"'), 'webkit', [])).toEqual(UNKNOWN_FONT_FACTS)
    expect(fontFactsFor(font('"-apple-system"'), 'gecko', [])).toEqual(UNKNOWN_FONT_FACTS)
    expect(fontFactsFor(font('"-apple-system"'), 'webkit', []).primaryFamily).toBe('-apple-system')
    // Its Arabic comes from SF Arabic, which joins through GSUB.
    expect(names(resolveFontFacts(font('system-ui'), 'blink', []).joiningFaces)).toEqual(['.SFArabic-Regular'])
    expect(fontFactsFor(font('system-ui'), 'blink', []).joining).toBe('opentype')
  })
})

describe('fonts: one entry per listed family', () => {
  test('in list order, with whether each realizes', () => {
    const fonts = listed('"Helvetica Neue", "Malgun Gothic", Arial, sans-serif', 'webkit')
    expect(fonts.map(f => [f.family, f.realizes])).toEqual([['Helvetica Neue', true], ['Malgun Gothic', false], ['Arial', true], ['sans-serif', true]])
    expect(fonts[1]).toEqual({ family: 'Malgun Gothic', realizes: false, coverage: null, ligatures: null, spacingInputs: null, scriptLookups: null })
    // An unprobed family: nothing is known about it, and the entries after it still describe their own fonts.
    const after = listed('Helvetica, "Unprobed Family", Arial', 'blink')
    expect(after.map(f => f.realizes)).toEqual([true, null, true])
    expect(covers(after[2]!.coverage, 0x628)).toBe(true)
    // No family realizes: every fact is unknown, the list included.
    expect(fontFactsFor(font('"Unprobed Family"'), 'blink', []).fonts).toBe(undefined)
  })

  test("a generic keyword gives facts where its candidates are one font: WebKit's, not Blink's or Gecko's", () => {
    expect(covers(listed('serif', 'webkit')[0]!.coverage, 0x41)).toBe(true)
    expect(listed('serif', 'blink')[0]).toMatchObject({ realizes: true, coverage: null, ligatures: null })
    expect(listed('sans-serif', 'gecko')[0]).toMatchObject({ realizes: true, coverage: null })
  })
})

describe('coverage, as each engine asks the font', () => {
  test('ranges are sorted, apart and inclusive', () => {
    for (const engine of ENGINES) {
      const ranges = listed('"PingFang SC"', engine)[0]!.coverage!
      expect(ranges.length).toBeGreaterThan(1000)
      for (let i = 0; i < ranges.length; i += 2) {
        expect(ranges[i]! <= ranges[i + 1]!).toBe(true)
        if (i > 0) expect(ranges[i]! > ranges[i - 1]! + 1).toBe(true)
      }
    }
  })

  test('Arial has no cmap U+2010: Blink and WebKit get Core Text\'s glyph, Gecko none; NBSP is in the cmap', () => {
    expect(ENGINES.map(engine => covers(listed('Arial', engine)[0]!.coverage, 0x2010))).toEqual([true, true, false])
    expect(ENGINES.map(engine => covers(listed('Arial', engine)[0]!.coverage, 0xa0))).toEqual([true, true, true])
    // Core Text also gives LF a glyph; only WebKit asks it for every character.
    expect(ENGINES.map(engine => covers(listed('Arial', engine)[0]!.coverage, 0x0a))).toEqual([false, true, false])
    for (const engine of ENGINES) expect([engine, covers(listed('Arial', engine)[0]!.coverage, 0x628), covers(listed('Arial', engine)[0]!.coverage, 0x4e00)]).toEqual([engine, true, false])
  })

  test('Geeza Pro covers Arabic and no Latin letters; Arial italic has no Arabic', () => {
    for (const engine of ENGINES) {
      const geeza = listed('"Geeza Pro"', engine)[0]!.coverage
      expect([engine, covers(geeza, 0x628), covers(geeza, 0x41)]).toEqual([engine, true, false])
      expect([engine, covers(listed('Arial', engine, 400, 'italic')[0]!.coverage, 0x628)]).toEqual([engine, false])
    }
  })

  test("Gecko clears a complex script range an installed font can't shape: Hiragino Sans maps U+0FD6 in the Tibetan block and has no GSUB script for it", () => {
    expect(ENGINES.map(engine => covers(listed('"Hiragino Sans"', engine)[0]!.coverage, 0x0fd6))).toEqual([true, true, false])
    expect(covers(listed('"Hiragino Sans"', 'gecko')[0]!.coverage, 0x3042)).toBe(true)
    // Kohinoor Devanagari names dev2 in GSUB, so its Devanagari stays; a web font's map is never cleared.
    expect(covers(listed('"Kohinoor Devanagari"', 'gecko')[0]!.coverage, 0x915)).toBe(true)
    expect(covers(listed('Amiri', 'gecko')[0]!.coverage, 0x628)).toBe(true)
  })

  test('Core Text withholds [ ] and double quotation marks of the platform UI font on this Mac; the cmap has them', () => {
    const at = (engine: EngineName, cp: number) => covers(listed('system-ui', engine)[0]!.coverage, cp)
    expect([at('webkit', 0x5b), at('webkit', 0x201c), at('webkit', 0x41)]).toEqual([false, false, true])
    expect([at('blink', 0x5b), at('gecko', 0x201c)]).toEqual([true, true])
  })
})

describe('ligatures', () => {
  const patternsOf = (family: string, engine: EngineName) => listed(family, engine)[0]!.ligatures!
  const has = (family: string, engine: EngineName, text: string) => patternsOf(family, engine).patterns.find(p => strings(p.positions).includes(text))

  test('Georgia and Verdana have none, and the list is complete', () => {
    for (const family of ['Georgia', 'Verdana']) for (const engine of ENGINES) expect([family, engine, patternsOf(family, engine)]).toMatchObject([family, engine, { patterns: [], complete: true }])
  })

  test("Arial ligates no Latin: its fi glyph has no lookup; Helvetica Neue's morx makes fi, fl, ff, ffi, ffl under common ligatures", () => {
    for (const engine of ENGINES) {
      expect([engine, has('Arial', engine, 'fi')]).toEqual([engine, undefined])
      for (const text of ['fi', 'fl', 'ff', 'ffi', 'ffl']) expect([engine, text, has('"Helvetica Neue"', engine, text)]).toMatchObject([engine, text, { exact: true, spaced: false }])
      expect(patternsOf('"Helvetica Neue"', engine).complete).toBe(true)
    }
  })

  test('lam-alef: a required ligature in Arial and Geeza Pro that letter-spacing keeps; two glyphs in Amiri and Noto Naskh Arabic', () => {
    for (const engine of ENGINES) {
      // HarfBuzz keeps it with a mark after the lam; Core Text, which shapes for WebKit, wasn't asked about marks.
      expect([engine, has('Arial', engine, 'لا')]).toMatchObject([engine, { spaced: true, everyContext: true, acrossMark: engine === 'webkit' ? null : true }])
      expect([engine, has('"Geeza Pro"', engine, 'لا')]).toMatchObject([engine, { spaced: true, everyContext: true }])
      expect([engine, has('Amiri', engine, 'لا'), has('"Noto Naskh Arabic"', engine, 'لا')]).toEqual([engine, undefined, undefined])
      expect([engine, patternsOf('Amiri', engine).complete, patternsOf('"Noto Naskh Arabic"', engine).complete]).toEqual([engine, true, true])
    }
  })

  test("Arial's liga makes the Allah ligature, which letter-spacing turns off; Geeza Pro's lam-lam-heh stays", () => {
    for (const engine of ENGINES) {
      expect([engine, has('Arial', engine, 'الله')]).toMatchObject([engine, { spaced: false }])
      expect([engine, has('"Geeza Pro"', engine, 'لله')]).toMatchObject([engine, { spaced: true, everyContext: false }])
    }
  })

  test("Noto Naskh Arabic's only ligature needs its marks: alef lam lam shadda superscript-alef heh (U+FDF2)", () => {
    const p = patternsOf('"Noto Naskh Arabic"', 'blink').patterns
    expect(p.length).toBe(2)
    expect(p[0]!.positions.length).toBe(5)
    expect(p[0]!.positions[3]).toContain('\u0651\u0670')
    expect(p[0]).toMatchObject({ exact: false, spaced: false })
  })

  test("Thonburi: not known where Core Text shapes. The offline Core Text run rejected its morx table and ligated nothing, and Firefox and webkit-host ligate fi (probe-letter-spacing)", () => {
    expect(has('Thonburi', 'blink', 'fi')).toMatchObject({ spaced: false })
    expect(listed('Thonburi', 'webkit')[0]!.ligatures).toBe(null)
    expect(listed('Thonburi', 'gecko')[0]!.ligatures).toBe(null)
    // What letter-spacing can act on comes from the tables, and still names f, i and l.
    expect(listed('Thonburi', 'webkit')[0]!.spacingInputs).toEqual([0x66, 0x66, 0x69, 0x69, 0x6c, 0x6c])
  })

  test('where the two shapers disagree on a string, the list can confirm a ligature for a Core Text engine but not rule one out', () => {
    // Arial: three strings with presentation-form code points.
    expect([patternsOf('Arial', 'blink').complete, patternsOf('Arial', 'gecko').complete, patternsOf('Arial', 'webkit').complete]).toEqual([true, true, false])
    expect(has('Arial', 'webkit', 'لا')).toMatchObject({ spaced: true })
  })

  test('a conjunct-forming font is incomplete: half forms need neighbours the program never tried', () => {
    for (const engine of ENGINES) expect([engine, patternsOf('"Kohinoor Devanagari"', engine).complete]).toEqual([engine, false])
  })

  test('language systems that change lookups are named', () => {
    expect(patternsOf('Amiri', 'blink').languageSystems).toContain('GSUB/latn/TRK ')
    expect(patternsOf('"Helvetica Neue"', 'blink').languageSystems).toEqual([])
  })
})

describe('spacingInputs: what the features letter-spacing turns off can act on', () => {
  const inputs = (family: string, engine: EngineName) => listed(family, engine)[0]!.spacingInputs

  test('nothing in Georgia, Verdana and Geeza Pro; f, i and l in Helvetica Neue', () => {
    for (const engine of ENGINES) {
      for (const family of ['Georgia', 'Verdana', '"Geeza Pro"']) expect([family, engine, inputs(family, engine)]).toEqual([family, engine, []])
      expect([engine, inputs('"Helvetica Neue"', engine)]).toEqual([engine, [0x66, 0x66, 0x69, 0x69, 0x6c, 0x6c]])
    }
  })

  test("Arial: only alef, reh and lam start a liga lookup, so Latin text can't change", () => {
    for (const engine of ENGINES) {
      const arial = inputs('Arial', engine)
      expect([engine, covers(arial, 0x627), covers(arial, 0x631), covers(arial, 0x644), covers(arial, 0x628), covers(arial, 0x66), covers(arial, 0x41)]).toEqual([engine, true, true, true, false, false, false])
    }
  })

  test("Blink also turns calt off: Shantell Sans's calt acts on U+0457", () => {
    expect(ENGINES.map(engine => covers(inputs('"Shantell Sans"', engine), 0x457))).toEqual([true, false, false])
    expect(ENGINES.map(engine => covers(inputs('"Shantell Sans"', engine), 0x66))).toEqual([true, true, true])
  })
})

describe('scriptLookups: scripts whose GSUB and GPOS lookups differ from the fallback records', () => {
  const groups = (family: string, engine: EngineName) => listed(family, engine)[0]!.scriptLookups

  test("Arial has no DFLT script, so Common text falls to latn: Latin isn't listed, Arabic, Cyrillic, Greek and Hebrew are", () => {
    expect(groups('Arial', 'blink')).toEqual([['Arab'], ['Cyrl'], ['Grek'], ['Hebr']])
    expect(groups('Arial', 'gecko')).toEqual([['Arab'], ['Cyrl'], ['Grek'], ['Hebr']])
  })

  test('Amiri has DFLT, and both latn and arab differ from it', () => {
    expect(groups('Amiri', 'blink')).toEqual([['Arab'], ['Latn']])
  })

  test('one set of lookups for every script: Georgia, Verdana, Hiragino Sans; and morx fonts, where HarfBuzz reads no GSUB', () => {
    for (const family of ['Georgia', 'Verdana', '"Hiragino Sans"', '"Helvetica Neue"', '"Geeza Pro"', 'Menlo']) expect([family, groups(family, 'blink')]).toEqual([family, []])
  })

  test("PingFang SC's GPOS names DFLT only; its GSUB gives Latin, Greek, Cyrillic, Han and kana one other set", () => {
    expect(groups('"PingFang SC"', 'blink')).toEqual([['Cyrl', 'Grek', 'Hani', 'Hira', 'Hrkt', 'Kana', 'Latn']])
  })

  test("not given where Core Text shapes: WebKit always, Gecko for a font it shapes through Core Text", () => {
    expect(groups('Arial', 'webkit')).toBe(null)
    expect(groups('"Helvetica Neue"', 'gecko')).toBe(null)
    expect(groups('"Geeza Pro"', 'gecko')).toBe(null)
  })
})
