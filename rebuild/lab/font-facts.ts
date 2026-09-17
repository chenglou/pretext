// The lab's font facts: the FontFacts each engine reads for a CSS font declaration on this Mac (DESIGN.md §1.2), from
// font-facts.json. Offline research programs generate that table from the installed fonts and the web font fixtures, with
// the program, file and hash behind every column (.artifacts/charter-20260916/font-facts/tools/build-facts.ts). The lab
// declares facts the way an app that knows its fonts would; the library never reads font files or this table (CHARTER.md,
// Boundaries).
//
// A declaration resolves in list order. A family realizes when it's a loaded fixture web font or an installed family; a
// generic keyword realizes the engine's default families for the text's script, and since the table doesn't know the
// script, it takes every candidate and gives a fact only where all realized candidates agree. Faces are matched by the CSS
// font matching the three engines implement. A family the table has never probed makes every fact that could depend on it
// null, so the engines report the gap instead of a guess. font-facts.json `rules` cites the engine source for each fact.
import type { EngineName } from '../src/env.ts'
import { UNKNOWN_FONT_FACTS, type CssFont, type FontFacts } from '../src/model.ts'
import table from './font-facts.json' with { type: 'json' }

type Face = {
  postScriptName: string
  fullName: string
  cssWeight: number
  italic: boolean
  condensed: boolean
  expanded: boolean
  spaceGlyph: boolean
  coreTextGlyphU2010: number
  cmapU2010: boolean
  monoSpaceTrait: boolean
  fixedAdvanceAttribute: string | null
  postIsFixedPitch: number | null
  opsz: boolean
  morx: boolean
  gsub: boolean
  gsubArabFeatures: string[] | null
  cmapU0628: boolean
  substituteForU0628: string
}

type GenericKeyword = 'serif' | 'sans-serif' | 'monospace'

type Table = {
  families: Record<string, { faces: string[] }>
  notInstalled: string[]
  fixtures: Record<string, Array<{ weight: number; face: string }>>
  faces: Record<string, Face>
  generics: Record<EngineName, Record<GenericKeyword, string[]>>
  labDeclarations: Array<{ family: string; weight: number; style: CssFont['style']; cases: number }>
}

const data = table as unknown as Table

// CSS Fonts 4 generic keywords, valid only unquoted.
const GENERIC_KEYWORDS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'])

// Family names match ASCII case-insensitively, for installed families and @font-face names alike.
const installedByKey = new Map<string, string[]>()
for (const name of Object.keys(data.families)) installedByKey.set(name.toLowerCase(), data.families[name]!.faces)
const notInstalledKeys = new Set(data.notInstalled.map(name => name.toLowerCase()))
const fixturesByKey = new Map<string, Array<{ weight: number; face: string }>>()
for (const name of Object.keys(data.fixtures)) fixturesByKey.set(name.toLowerCase(), data.fixtures[name]!)

type Family = { name: string; generic: boolean }

// A CSS font-family list: comma-separated quoted strings or runs of identifiers joined by single spaces.
export function parseFamilyList(list: string): Family[] {
  const out: Family[] = []
  const parts = list.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+/g) ?? []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.trim()
    if (part === '') continue
    const quote = part[0]
    if (quote === '"' || quote === "'") {
      out.push({ name: part.slice(1, -1).replace(/\\(.)/g, '$1'), generic: false })
    } else {
      const name = part.split(/\s+/).join(' ')
      out.push({ name, generic: GENERIC_KEYWORDS.has(name.toLowerCase()) })
    }
  }
  return out
}

// CSS Fonts 4 §5.2 weight search, as Blink's BetterWeightMatch (font_matcher_mac.mm), WebKit's FontSelectionAlgorithm and
// Gecko's WeightDistance implement it.
function pickWeight(desired: number, available: number[]): number {
  const sorted = available.slice().sort((a, b) => a - b)
  if (sorted.includes(desired)) return desired
  const lighter = sorted.filter(w => w < desired).reverse()
  const heavier = sorted.filter(w => w > desired)
  if (desired >= 400 && desired <= 500) {
    const upTo500 = heavier.filter(w => w <= 500)
    if (upTo500.length > 0) return upTo500[0]!
    if (lighter.length > 0) return lighter[0]!
    return heavier[0]!
  }
  if (desired < 400) return lighter.length > 0 ? lighter[0]! : heavier[0]!
  return heavier.length > 0 ? heavier[0]! : lighter[0]!
}

// The faces a declaration selects from a family's faces: normal width first, then the desired slope (synthesized when the
// family has none), then the weight search. Equally good faces are all kept; a fact is given only where they agree.
function matchFaces(ids: string[], font: CssFont): string[] {
  const normalWidth = ids.filter(id => !data.faces[id]!.condensed && !data.faces[id]!.expanded)
  const pool = normalWidth.length > 0 ? normalWidth : ids
  const wantItalic = font.style === 'italic'
  const sloped = pool.filter(id => data.faces[id]!.italic === wantItalic)
  const styled = sloped.length > 0 ? sloped : pool
  const weight = pickWeight(font.weight, styled.map(id => data.faces[id]!.cssWeight))
  return styled.filter(id => data.faces[id]!.cssWeight === weight)
}

type Realized = { kind: 'realized'; faces: string[] } | { kind: 'none' } | { kind: 'unknown' }

function realizeNamed(name: string, font: CssFont, fixtures: ReadonlySet<string>): Realized {
  const key = name.toLowerCase()
  const fixture = fixturesByKey.get(key)
  if (fixture !== undefined && fixtures.has(key)) {
    // A fixture family's faces are its fonts.json entries, registered by weight with the normal style (page.ts
    // loadFontFixtures), so only the weight search applies.
    const weight = pickWeight(font.weight, fixture.map(f => f.weight))
    const faces: string[] = []
    for (let i = 0; i < fixture.length; i++) if (fixture[i]!.weight === weight && !faces.includes(fixture[i]!.face)) faces.push(fixture[i]!.face)
    return { kind: 'realized', faces }
  }
  const installed = installedByKey.get(key)
  if (installed !== undefined) return { kind: 'realized', faces: matchFaces(installed, font) }
  if (notInstalledKeys.has(key) || fixture !== undefined) return { kind: 'none' }
  return { kind: 'unknown' }
}

function realize(family: Family, font: CssFont, engine: EngineName, fixtures: ReadonlySet<string>): Realized {
  if (!family.generic) return realizeNamed(family.name, font, fixtures)
  const keyword = family.name.toLowerCase()
  if (keyword !== 'serif' && keyword !== 'sans-serif' && keyword !== 'monospace') return { kind: 'unknown' }
  const candidates = data.generics[engine][keyword]
  const faces: string[] = []
  for (let i = 0; i < candidates.length; i++) {
    const r = realizeNamed(candidates[i]!, font, fixtures)
    if (r.kind === 'unknown') return r
    if (r.kind === 'realized') faces.push(...r.faces)
  }
  return faces.length === 0 ? { kind: 'none' } : { kind: 'realized', faces }
}

function agree<T>(values: T[]): T | null {
  if (values.length === 0) return null
  for (let i = 1; i < values.length; i++) if (values[i] !== values[0]) return null
  return values[0]!
}

function mapsHyphen(face: Face, engine: EngineName): boolean {
  switch (engine) {
    case 'blink': return face.cmapU2010 || face.coreTextGlyphU2010 !== 0
    case 'webkit': return face.coreTextGlyphU2010 !== 0
    case 'gecko': return face.cmapU2010
  }
}

function fixedPitch(face: Face): boolean {
  const fixedAdvance = face.fixedAdvanceAttribute !== null && Number(face.fixedAdvanceAttribute) !== 0
  const name = face.fullName.toLowerCase()
  return face.monoSpaceTrait || fixedAdvance || name === 'osaka-mono' || name === 'ms-pgothic' || name === 'monotypecorsiva'
}

function joiningOf(face: Face): FontFacts['joining'] {
  if (!face.cmapU0628) return null
  if (face.morx) return 'aat'
  const features = face.gsubArabFeatures
  if (face.gsub && features !== null && features.includes('init') && features.includes('medi') && features.includes('fina')) return 'opentype'
  return null
}

export type FontFactsResolution = {
  facts: FontFacts
  // Face ids (font-facts.json `faces`) of the primary family as matched, and of the fonts that draw U+0628.
  primaryFaces: string[]
  joiningFaces: string[]
}

const cache = new Map<string, FontFactsResolution>()

// fixtures: the fixture web font families the page loaded (Case.fontFixtures).
export function resolveFontFacts(font: CssFont, engine: EngineName, fixtures: readonly string[]): FontFactsResolution {
  const loaded = new Set(fixtures.map(name => name.toLowerCase()))
  const key = [engine, font.family, font.weight, font.style, [...loaded].sort().join('|')].join('')
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const result = resolve(font, engine, loaded)
  cache.set(key, result)
  return result
}

export function fontFactsFor(font: CssFont, engine: EngineName, fixtures: readonly string[]): FontFacts {
  return resolveFontFacts(font, engine, fixtures).facts
}

function resolve(font: CssFont, engine: EngineName, fixtures: ReadonlySet<string>): FontFactsResolution {
  const families = parseFamilyList(font.family)
  const unknown: FontFactsResolution = { facts: UNKNOWN_FONT_FACTS, primaryFaces: [], joiningFaces: [] }
  let primary: { family: Family; faces: string[] } | null = null
  let joiningFaces: string[] | null = null
  let joiningUnknown = false
  for (let i = 0; i < families.length; i++) {
    const family = families[i]!
    const r = realize(family, font, engine, fixtures)
    if (r.kind === 'unknown') {
      // Whether this family realizes isn't known: the primary family, if not found yet, and the font drawing U+0628 are.
      if (primary === null) return unknown
      if (joiningFaces === null) joiningUnknown = true
      break
    }
    if (r.kind === 'none') continue
    if (primary === null) primary = { family, faces: r.faces }
    if (joiningFaces === null) {
      const covering = r.faces.filter(id => data.faces[id]!.cmapU0628)
      if (covering.length === r.faces.length) joiningFaces = r.faces
      else if (covering.length > 0) { joiningUnknown = true; break }
    }
  }
  // No family realizes: the engines fall back to their standard families, which the table doesn't resolve.
  if (primary === null) return unknown
  const faces = primary.faces.map(id => data.faces[id]!)
  // After the list, Blink's system fallback substitutes from the primary font (font_fallback_iterator.cc:232-236, 279-281;
  // font_cache_mac.mm:127-150).
  if (joiningFaces === null && !joiningUnknown) joiningFaces = primary.faces.map(id => data.faces[id]!.substituteForU0628)
  const joining = joiningUnknown || joiningFaces === null ? null : agree(joiningFaces.map(id => joiningOf(data.faces[id]!)))
  return {
    facts: {
      primaryFamily: primary.family.name,
      mapsHyphen: agree(faces.map(face => mapsHyphen(face, engine))),
      monospace: agree(faces.map(fixedPitch)),
      opticalSizeAxis: agree(faces.map(face => face.opsz)),
      joining,
    },
    primaryFaces: primary.faces,
    joiningFaces: joiningFaces ?? [],
  }
}

// The declarations the lab's case files name, with case counts (font-facts.json `labDeclarations`).
export function labDeclarations(): Table['labDeclarations'] {
  return data.labDeclarations
}
