// The lab's font facts: the FontFacts each engine reads for a CSS font declaration on this Mac (DESIGN.md §1.2), from
// font-facts.json. Offline research programs generate that table from the installed fonts and the web font fixtures, with
// the program, file and hash behind every column (.artifacts/charter-20260916/font-facts/tools/build-facts.ts). The lab
// declares facts the way an app that knows its fonts would; the library never reads font files or this table (CHARTER.md,
// Boundaries).
//
// A declaration resolves in list order. A family realizes when it's a loaded fixture web font, an installed family or a
// name the engine gives the platform UI font; a generic keyword realizes the engine's default families for the text's
// script, and since the table doesn't know the script, it takes every candidate and gives a fact only where all realized
// candidates agree. Faces are matched by the CSS font matching the three engines implement, and equally good faces by each
// engine's own order where source gives one. A family the table has never probed makes every fact that could depend on it
// null, so the engines report the gap instead of a guess. font-facts.json `rules` cites the engine source for each fact.
//
// `fonts` (optional in FontFacts) holds one entry per listed family: whether it realizes and, for the face it realizes, the
// coverage, ligatures, letter-spacing inputs and script lookups as that engine sees the font.
import type { EngineName } from '../src/env.ts'
import { UNKNOWN_FONT_FACTS, type CssFont, type FontFacts, type LigatureFacts, type LigaturePattern, type ListedFontFacts } from '../src/model.ts'
import table from './font-facts.json' with { type: 'json' }

type Share = 'all' | 'some' | 'none'

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
  pairKerning: FontFacts['pairKerning']
  cmapCoverage: string
  coreTextAdded: number[]
  coreTextWithheld: number[]
  geckoRequiresAat: boolean
  geckoClearedRanges: Array<[number, number]>
  scriptLookups: { groups: string[][] }
  ligatures: string | null
  spacingInputs: Record<'ligatures' | 'calt', { codePoints: string; unmapped: number }> | null
}

type LigatureSet = {
  complete: boolean
  coreText: { rejectedTable: boolean; shapersDisagree: number }
  languageSystems: string[]
  patterns: Array<{
    positions: string[][]; exact: boolean; feature: string | null; everyContext: boolean; acrossMark: boolean | null
    harfBuzz: { spacedBlink: boolean; spacedGecko: boolean }
    coreText: { default: Share; spacedWebKit: Share; spacedGecko: Share; everyContext: boolean }
  }>
  coreTextOnly: Array<{ text: string; spacedWebKit: boolean; spacedGecko: boolean }>
}

type GenericKeyword = 'serif' | 'sans-serif' | 'monospace'

type Table = {
  families: Record<string, { faces: string[]; appKitMembers: string[] }>
  notInstalled: string[]
  fixtures: Record<string, Array<{ weight: number; face: string }>>
  faces: Record<string, Face>
  generics: Record<EngineName, Record<GenericKeyword, string[]>>
  rules: { systemUI: { faces: string[] } & Record<EngineName, { names: string[] }> }
  sets: { coverage: Record<string, string>; ligatures: Record<string, LigatureSet> }
  labDeclarations: Array<{ family: string; weight: number; style: CssFont['style']; cases: number }>
}

const data = table as unknown as Table

// CSS Fonts 4 generic keywords, valid only unquoted.
const GENERIC_KEYWORDS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'])
// Names the engines give the platform UI font besides the system-ui keyword (font-facts.json rules.systemUI). Each is an
// ordinary family name in the other engines, where it matches no installed family.
const SYSTEM_UI_NAMES = ['-apple-system', 'blinkmacsystemfont']

// Family names match ASCII case-insensitively, for installed families and @font-face names alike.
const installedByKey = new Map<string, { name: string; faces: string[] }>()
for (const name of Object.keys(data.families)) installedByKey.set(name.toLowerCase(), { name, faces: data.families[name]!.faces })
const notInstalledKeys = new Set(data.notInstalled.map(name => name.toLowerCase()))
const fixturesByKey = new Map<string, Array<{ weight: number; face: string }>>()
for (const name of Object.keys(data.fixtures)) fixturesByKey.set(name.toLowerCase(), data.fixtures[name]!)

type Family = { name: string; generic: boolean; quoted: boolean }

// A CSS font-family list: comma-separated quoted strings or runs of identifiers joined by single spaces.
export function parseFamilyList(list: string): Array<{ name: string; generic: boolean }> {
  return parseFamilies(list).map(f => ({ name: f.name, generic: f.generic }))
}

function parseFamilies(list: string): Family[] {
  const out: Family[] = []
  const parts = list.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+/g) ?? []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.trim()
    if (part === '') continue
    const quote = part[0]
    if (quote === '"' || quote === "'") {
      out.push({ name: part.slice(1, -1).replace(/\\(.)/g, '$1'), generic: false, quoted: true })
    } else {
      const name = part.split(/\s+/).join(' ')
      out.push({ name, generic: GENERIC_KEYWORDS.has(name.toLowerCase()), quoted: false })
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

// Equally good faces (font-facts.json rules.tiedFaces): Blink takes the first in AppKit's member order, WebKit the first in
// Core Text's matching order, and Gecko keeps them all, so its facts are the ones they agree on.
function breakTie(tied: string[], order: string[], engine: EngineName): string[] {
  if (tied.length < 2 || engine === 'gecko') return tied
  for (let i = 0; i < order.length; i++) if (tied.includes(order[i]!)) return [order[i]!]
  return tied
}

// The faces a declaration selects from a family's faces: normal width first, then the desired slope (synthesized when the
// family has none), then the weight search, then the engine's order among equally good faces.
function matchFaces(family: { faces: string[]; appKitMembers: string[] }, font: CssFont, engine: EngineName): string[] {
  const ids = family.faces
  const normalWidth = ids.filter(id => !data.faces[id]!.condensed && !data.faces[id]!.expanded)
  const pool = normalWidth.length > 0 ? normalWidth : ids
  const wantItalic = font.style === 'italic'
  const sloped = pool.filter(id => data.faces[id]!.italic === wantItalic)
  const styled = sloped.length > 0 ? sloped : pool
  const weight = pickWeight(font.weight, styled.map(id => data.faces[id]!.cssWeight))
  return breakTie(styled.filter(id => data.faces[id]!.cssWeight === weight), engine === 'blink' ? family.appKitMembers : family.faces, engine)
}

type Realized = { kind: 'realized'; faces: string[] } | { kind: 'none' } | { kind: 'unknown' }

// The platform UI font: every CSS weight is an instance of the upright or the italic variable font file.
function systemUI(font: CssFont): Realized {
  const wantItalic = font.style === 'italic'
  const faces = data.rules.systemUI.faces.filter(id => data.faces[id]!.italic === wantItalic)
  return { kind: 'realized', faces: faces.length > 0 ? faces : data.rules.systemUI.faces }
}

function realizeNamed(family: Family, font: CssFont, engine: EngineName, fixtures: ReadonlySet<string>): Realized {
  const key = family.name.toLowerCase()
  const fixture = fixturesByKey.get(key)
  if (fixture !== undefined && fixtures.has(key)) {
    // A fixture family's faces are its fonts.json entries, registered by weight with the normal style (page.ts
    // loadFontFixtures), so only the weight search applies.
    const weight = pickWeight(font.weight, fixture.map(f => f.weight))
    const faces: string[] = []
    for (let i = 0; i < fixture.length; i++) if (fixture[i]!.weight === weight && !faces.includes(fixture[i]!.face)) faces.push(fixture[i]!.face)
    return { kind: 'realized', faces }
  }
  if (SYSTEM_UI_NAMES.includes(key)) {
    // Gecko's -apple-system counts as an identifier only (specs/gecko-RESULTS.md, opticalSizeAxis default).
    const names = data.rules.systemUI[engine].names.map(name => name.toLowerCase())
    return names.includes(key) && !(engine === 'gecko' && family.quoted) ? systemUI(font) : { kind: 'none' }
  }
  const installed = installedByKey.get(key)
  if (installed !== undefined) return { kind: 'realized', faces: matchFaces(data.families[installed.name]!, font, engine) }
  if (notInstalledKeys.has(key) || fixture !== undefined) return { kind: 'none' }
  return { kind: 'unknown' }
}

function realize(family: Family, font: CssFont, engine: EngineName, fixtures: ReadonlySet<string>): Realized {
  if (!family.generic) return realizeNamed(family, font, engine, fixtures)
  const keyword = family.name.toLowerCase()
  if (keyword === 'system-ui') return systemUI(font)
  if (keyword !== 'serif' && keyword !== 'sans-serif' && keyword !== 'monospace') return { kind: 'unknown' }
  const candidates = data.generics[engine][keyword]
  const faces: string[] = []
  for (let i = 0; i < candidates.length; i++) {
    const r = realizeNamed({ name: candidates[i]!, generic: false, quoted: true }, font, engine, fixtures)
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

// ---- Facts per listed family (FontFacts.fonts) ----

// A coverage set of font-facts.json: gaps and lengths in base 36 (build-facts.ts encodeRanges), as flat inclusive ranges.
function decodeRanges(encoded: string): number[] {
  const out: number[] = []
  if (encoded === '') return out
  const parts = encoded.split(' ')
  let next = 0
  for (let i = 0; i < parts.length; i += 2) {
    const first = next + parseInt(parts[i]!, 36)
    const last = first + parseInt(parts[i + 1]!, 36)
    out.push(first, last)
    next = last + 1
  }
  return out
}

function addCodePoints(ranges: number[], cps: number[]): number[] {
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < ranges.length; i += 2) pairs.push([ranges[i]!, ranges[i + 1]!])
  for (let i = 0; i < cps.length; i++) pairs.push([cps[i]!, cps[i]!])
  pairs.sort((a, b) => a[0] - b[0])
  const out: number[] = []
  for (let i = 0; i < pairs.length; i++) {
    const [first, last] = pairs[i]!
    if (out.length > 0 && first <= out[out.length - 1]! + 1) out[out.length - 1] = Math.max(out[out.length - 1]!, last)
    else out.push(first, last)
  }
  return out
}

function removeRanges(ranges: number[], cleared: Array<[number, number]>): number[] {
  let current = ranges
  for (let c = 0; c < cleared.length; c++) {
    const [from, to] = cleared[c]!
    const out: number[] = []
    for (let i = 0; i < current.length; i += 2) {
      const first = current[i]!, last = current[i + 1]!
      if (last < from || first > to) { out.push(first, last); continue }
      if (first < from) out.push(first, from - 1)
      if (last > to) out.push(to + 1, last)
    }
    current = out
  }
  return current
}

// The code points the engine finds in the face (font-facts.json rules.fonts.coverage).
const coverageCache = new Map<string, readonly number[]>()
function coverageOf(id: string, engine: EngineName): readonly number[] {
  const key = `${engine} ${id}`
  const cached = coverageCache.get(key)
  if (cached !== undefined) return cached
  const face = data.faces[id]!
  const cmap = decodeRanges(data.sets.coverage[face.cmapCoverage]!)
  let out: number[]
  switch (engine) {
    case 'blink': out = addCodePoints(cmap, face.coreTextAdded.filter(cp => cp === 0x2010 || cp === 0x2011)); break
    case 'webkit': out = removeRanges(addCodePoints(cmap, face.coreTextAdded), face.coreTextWithheld.map(cp => [cp, cp])); break
    case 'gecko': out = removeRanges(cmap, face.geckoClearedRanges); break
  }
  coverageCache.set(key, out)
  return out
}

// Which shaper's verdicts hold for the face in the engine (font-facts.json rules.fonts.ligatures).
function usesCoreText(face: Face, engine: EngineName): boolean {
  return engine === 'webkit' || (engine === 'gecko' && face.geckoRequiresAat)
}

const ligatureCache = new Map<string, LigatureFacts | null>()
function ligaturesOf(id: string, engine: EngineName): LigatureFacts | null {
  const key = `${engine} ${id}`
  if (ligatureCache.has(key)) return ligatureCache.get(key)!
  const face = data.faces[id]!
  const set = face.ligatures === null ? undefined : data.sets.ligatures[face.ligatures]
  let facts: LigatureFacts | null = null
  const coreText = usesCoreText(face, engine)
  // Core Text rejected the face's morx table in the offline run, and the browsers ligate where it didn't: not known.
  if (set !== undefined && !(coreText && set.coreText.rejectedTable)) {
    const patterns: LigaturePattern[] = []
    for (let i = 0; i < set.patterns.length; i++) {
      const p = set.patterns[i]!
      if (!coreText) {
        patterns.push({ positions: p.positions, exact: p.exact, spaced: engine === 'blink' ? p.harfBuzz.spacedBlink : p.harfBuzz.spacedGecko, everyContext: p.everyContext, acrossMark: p.acrossMark })
        continue
      }
      if (p.coreText.default === 'none') continue
      const spaced = engine === 'webkit' ? p.coreText.spacedWebKit : p.coreText.spacedGecko
      // Core Text wasn't asked about marks between the components.
      patterns.push({ positions: p.positions, exact: p.exact && p.coreText.default === 'all', spaced: spaced === 'all', everyContext: p.coreText.everyContext, acrossMark: null })
    }
    if (coreText) {
      for (let i = 0; i < set.coreTextOnly.length; i++) {
        const only = set.coreTextOnly[i]!
        patterns.push({ positions: [[only.text]], exact: true, spaced: engine === 'webkit' ? only.spacedWebKit : only.spacedGecko, everyContext: false, acrossMark: null })
      }
    }
    // The candidates come from HarfBuzz's view of the font, so where the shapers disagree on any planned string the list
    // can't rule a ligature out for an engine Core Text shapes for.
    facts = { patterns, complete: set.complete && !(coreText && set.coreText.shapersDisagree > 0), languageSystems: set.languageSystems }
  }
  ligatureCache.set(key, facts)
  return facts
}

// The characters the features the engine turns off for letter-spacing can act on (font-facts.json rules.fonts.spacingInputs).
const spacingCache = new Map<string, readonly number[] | null>()
function spacingInputsOf(id: string, engine: EngineName): readonly number[] | null {
  const key = `${engine} ${id}`
  if (spacingCache.has(key)) return spacingCache.get(key)!
  const inputs = data.faces[id]!.spacingInputs
  let out: number[] | null = null
  if (inputs !== null) {
    const groups = engine === 'blink' ? [inputs.ligatures, inputs.calt] : [inputs.ligatures]
    if (groups.every(g => g.unmapped === 0)) {
      out = []
      for (let i = 0; i < groups.length; i++) {
        const ranges = decodeRanges(groups[i]!.codePoints)
        const cps: number[] = []
        for (let r = 0; r < ranges.length; r += 2) for (let cp = ranges[r]!; cp <= ranges[r + 1]!; cp++) cps.push(cp)
        out = addCodePoints(out, cps)
      }
    }
  }
  spacingCache.set(key, out)
  return out
}

function scriptLookupsOf(id: string, engine: EngineName): readonly (readonly string[])[] | null {
  const face = data.faces[id]!
  return usesCoreText(face, engine) ? null : face.scriptLookups.groups
}

// One family's entry. Facts are given for one face, or for faces that share them: Gecko's tied faces, or the candidates of
// a generic keyword, which belong to different fonts and rarely do.
function listedFacts(family: Family, r: Realized, engine: EngineName): ListedFontFacts {
  const unknown: ListedFontFacts = { family: family.name, realizes: r.kind === 'unknown' ? null : r.kind === 'realized', coverage: null, ligatures: null, spacingInputs: null, scriptLookups: null }
  if (r.kind !== 'realized' || r.faces.length === 0) return unknown
  const first = r.faces[0]!
  let sameCoverage = true, sameLigatures = true, sameSpacing = true, sameLookups = true
  for (let i = 1; i < r.faces.length; i++) {
    const a = data.faces[first]!, b = data.faces[r.faces[i]!]!
    if (JSON.stringify(coverageOf(first, engine)) !== JSON.stringify(coverageOf(r.faces[i]!, engine))) sameCoverage = false
    if (a.ligatures !== b.ligatures || usesCoreText(a, engine) !== usesCoreText(b, engine)) sameLigatures = false
    if (JSON.stringify(spacingInputsOf(first, engine)) !== JSON.stringify(spacingInputsOf(r.faces[i]!, engine))) sameSpacing = false
    if (JSON.stringify(scriptLookupsOf(first, engine)) !== JSON.stringify(scriptLookupsOf(r.faces[i]!, engine))) sameLookups = false
  }
  return {
    family: family.name, realizes: true,
    coverage: sameCoverage ? coverageOf(first, engine) : null,
    ligatures: sameLigatures ? ligaturesOf(first, engine) : null,
    spacingInputs: sameSpacing ? spacingInputsOf(first, engine) : null,
    scriptLookups: sameLookups ? scriptLookupsOf(first, engine) : null,
  }
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
  const key = [engine, font.family, font.weight, font.style, [...loaded].sort().join('|')].join('')
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
  const families = parseFamilies(font.family)
  const unknown: FontFactsResolution = { facts: UNKNOWN_FONT_FACTS, primaryFaces: [], joiningFaces: [] }
  const realized = families.map(family => realize(family, font, engine, fixtures))
  let primary: { family: Family; faces: string[] } | null = null
  let joiningFaces: string[] | null = null
  let joiningUnknown = false
  for (let i = 0; i < families.length; i++) {
    const family = families[i]!
    const r = realized[i]!
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
      // The primary faces: they draw the Latin text whose pair adjustments the fact places.
      pairKerning: agree(faces.map(face => face.pairKerning)),
      fonts: families.map((family, i) => listedFacts(family, realized[i]!, engine)),
    },
    primaryFaces: primary.faces,
    joiningFaces: joiningFaces ?? [],
  }
}

// The declarations the lab's case files name, with case counts (font-facts.json `labDeclarations`).
export function labDeclarations(): Table['labDeclarations'] {
  return data.labDeclarations
}
