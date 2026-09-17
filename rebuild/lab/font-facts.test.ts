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
    // Both faces of the Osaka family are 400 upright, so the CSS search ties and the table gives no fact.
    expect(names(resolveFontFacts(font('Osaka'), 'webkit', []).primaryFaces).sort()).toEqual(['Osaka', 'Osaka-Mono'])
    expect(fontFactsFor(font('Osaka'), 'webkit', []).monospace).toBe(null)
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
    // Blink's Japanese fixed family list includes Osaka, whose tied faces disagree.
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
    const missing: string[] = []
    const declarations = labDeclarations()
    expect(declarations.length).toBeGreaterThan(100)
    for (const d of declarations) {
      for (const engine of ENGINES) {
        const facts = fontFactsFor(font(d.family, d.weight, d.style), engine, FIXTURES)
        for (const k of read[engine]) if (facts[k] === null) missing.push(`${engine} ${d.family} ${d.weight} ${d.style}: ${k}`)
      }
    }
    expect(missing).toEqual([])
  })
})
