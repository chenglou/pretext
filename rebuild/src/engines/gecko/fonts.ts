// Font declarations as Gecko reads them (Firefox 156.0): the parsed family list, the equality text runs continue on, and
// the facts about realized fonts the port reads (DESIGN.md §1.2).
import { listedFamilies } from '../../font-family.js'
import type { FontDecl, ListedFontFacts } from '../../model.js'
import { findRecord, insertRecord, orderedRecords, type OrderedLinks, type OrderedRecords } from '../../ordered-records.js'

export type FontFamilyEntry =
  | { kind: 'generic'; name: 'serif' | 'sans-serif' | 'monospace' | 'cursive' | 'fantasy' | 'math' | 'system-ui' }
  | { kind: 'named'; name: string; syntax: 'quoted' | 'identifiers' }

// GenericFontFamily's keywords (servo/components/style/values/computed/font.rs:670-691), matched ignoring ASCII case;
// -moz-fixed is monospace. math and system-ui are behind prefs that are on in Firefox 156
// (StaticPrefList.yaml:10857, :12072).
function genericFamily(ident: string): Extract<FontFamilyEntry, { kind: 'generic' }>['name'] | null {
  switch (ident.toLowerCase()) {
    case 'serif': return 'serif'
    case 'sans-serif': return 'sans-serif'
    case 'monospace': case '-moz-fixed': return 'monospace'
    case 'cursive': return 'cursive'
    case 'fantasy': return 'fantasy'
    case 'math': return 'math'
    case 'system-ui': return 'system-ui'
    default: return null
  }
}

// FontFamilyList as parsed by SingleFontFamily::parse (font.rs:707-768), over the families the list names, whose syntax
// is read once for every engine (font-family.ts): a quoted string is a quoted family name; an identifier that is a generic
// keyword is that generic; other identifiers join with single spaces into one name, quoted syntax only when an escaped
// identifier holds a space.
export function parseFamilyList(list: string): FontFamilyEntry[] {
  const listed = listedFamilies(list)
  const out: FontFamilyEntry[] = []
  for (let i = 0; i < listed.length; i++) {
    const family = listed[i]!
    if (family.quoted) {
      out.push({ kind: 'named', name: family.name, syntax: 'quoted' })
      continue
    }
    const generic = family.identifiers.length === 1 ? genericFamily(family.identifiers[0]!) : null
    if (generic !== null) {
      out.push({ kind: 'generic', name: generic })
      continue
    }
    let spaced = false
    for (let k = 0; k < family.identifiers.length; k++) spaced ||= family.identifiers[k]!.includes(' ')
    out.push({ kind: 'named', name: family.name, syntax: spaced ? 'quoted' : 'identifiers' })
  }
  return out
}

type FamilyRecord = OrderedLinks & { families: FontFamilyEntry[] }
// Source declarations and their canonical parsed family lists, needed only while preparing text runs and diagnostics.
type PairKerningScripts = { readonly greek: boolean; readonly cyrillic: boolean }
type FontEntry = { index: number; facts: ListedFontFacts }
type CoverageSource = { index: number; ranges: readonly number[] }
type CoverageCell = OrderedLinks & { start: number; end: number; index: number | null }
type FontCoverage =
  | { kind: 'single'; index: number; ranges: readonly number[]; miss: -1 | null }
  | { kind: 'partition'; ranges: { start: number; end: number; index: number }[]; miss: -1 | null }
type DemandCoverage = {
  kind: 'demand'; sources: CoverageSource[]; miss: -1 | null; cells: OrderedRecords<CoverageCell>; work: number; limit: number
}
export type FontTable = { coverage: { kind: 'source'; entries: FontEntry[] } | FontCoverage | DemandCoverage; pairKerning: PairKerningScripts }
const NO_FONT_TABLE: FontTable = { coverage: { kind: 'partition', ranges: [], miss: null }, pairKerning: { greek: false, cyrillic: false } }
export type FontDeclarations = {
  byFont: Map<FontDecl, FamilyRecord>; families: OrderedRecords<FamilyRecord>
  // Source font tables may be shared by distinct declarations. Compile the actual table source once.
  tables: Map<readonly ListedFontFacts[], FontTable>
}
export function createFontDeclarations(): FontDeclarations {
  return { byFont: new Map(), families: orderedRecords(), tables: new Map() }
}

function compareFamilies(a: FontFamilyEntry[], b: FontFamilyEntry[]): number {
  if (a === b) return 0
  if (a.length !== b.length) return a.length - b.length
  for (let k = 0; k < a.length; k++) {
    const x = a[k]!, y = b[k]!
    if (x.kind !== y.kind) return x.kind < y.kind ? -1 : 1
    if (x.name !== y.name) return x.name < y.name ? -1 : 1
    if (x.kind === 'named' && y.kind === 'named' && x.syntax !== y.syntax) return x.syntax < y.syntax ? -1 : 1
  }
  return 0
}
const compareFamilyKey = (key: FontFamilyEntry[], record: FamilyRecord): number => compareFamilies(key, record.families)
const compareFamilyRecords = (a: FamilyRecord, b: FamilyRecord): number => compareFamilies(a.families, b.families)

function familiesFor(font: FontDecl, declarations: FontDeclarations | undefined): FontFamilyEntry[] {
  if (declarations === undefined) return parseFamilyList(font.family)
  const found = declarations.byFont.get(font)
  if (found !== undefined) return found.families
  // Demand preserves parser validation: no raw-string or declaration-identity equality skips the first parse.
  const families = parseFamilyList(font.family)
  const canonical = findRecord(declarations.families, families, compareFamilyKey) ?? insertRecord(declarations.families,
    { families, left: -1, right: -1, height: 1 }, compareFamilyRecords)
  declarations.byFont.set(font, canonical)
  return canonical.families
}

// One record per actual source fact table. Known-unavailable families cannot draw any character; retaining only the
// other entries preserves their original indices and every unknown realization/coverage barrier in FindFontForChar.
export function fontTableOf(font: FontDecl, declarations: FontDeclarations): FontTable {
  const fonts = font.facts.fonts
  if (fonts === undefined) return NO_FONT_TABLE
  const found = declarations.tables.get(fonts)
  if (found !== undefined) return found
  const entries: FontEntry[] = []
  for (let i = 0; i < fonts.length; i++) if (fonts[i]!.realizes !== false) entries.push({ index: i, facts: fonts[i]! })
  const lookups = entries.length === 0 || entries[0]!.facts.realizes !== true ? null : entries[0]!.facts.scriptLookups
  let greek = -1, cyrillic = -1, latin = -1
  if (lookups !== null) for (let g = 0; g < lookups.length; g++) {
    if (lookups[g]!.includes('Grek')) greek = g
    if (lookups[g]!.includes('Cyrl')) cyrillic = g
    if (lookups[g]!.includes('Latn')) latin = g
  }
  const table: FontTable = { coverage: { kind: 'source', entries }, pairKerning: { greek: lookups !== null && greek === latin, cyrillic: lookups !== null && cyrillic === latin } }
  declarations.tables.set(fonts, table)
  return table
}

// Servo quantize_font_size, 10 significant bits (servo/components/style/values/specified/font.rs:993-1022).
export function quantize10(size: number): number {
  const d = Math.fround(size * 16385)
  const t = Math.fround(d - size)
  return Math.fround(d - t)
}

// The part of nsFont::CalcDifference the model can vary (gfx/src/nsFont.cpp:36-60): style, weight as FontWeight's
// FixedPoint<u16, 6> (font.rs:92-96, :155), the quantized computed size and the parsed family list, whose FamilyName
// equality includes the syntax (font.rs:512-533), so Arial and "Arial" differ. ContinueTextRunAcrossFrames compares
// these (nsTextFrame.cpp:2168).
export function sameFontForTextRun(a: FontDecl, b: FontDecl, declarations?: FontDeclarations): boolean {
  return a.style === b.style && Math.round(Math.fround(a.weight) * 64) === Math.round(Math.fround(b.weight) * 64) &&
    quantize10(a.size) === quantize10(b.size) && compareFamilies(familiesFor(a, declarations), familiesFor(b, declarations)) === 0
}

// FontFacts.opticalSizeAxis with its documented default: true for Gecko's system-font keywords, which resolve to the
// macOS system font, whose opsz axis is a recorded browser fact (probes cross-cutting 5, specs/gecko-canvas.md §1.2 C1a).
// Only the unquoted keyword is the generic: a quoted "system-ui" parses as a named family (SingleFontFamily::parse,
// font.rs:707-768), so the default reads the parsed entry, not its name. A given primaryFamily names a family as the
// browser realizes it, so the keywords there stand for themselves.
export function opticalSizeAxisOf(font: FontDecl, declarations?: FontDeclarations): boolean {
  if (font.facts.opticalSizeAxis !== null) return font.facts.opticalSizeAxis
  if (font.facts.primaryFamily !== null) return font.facts.primaryFamily === 'system-ui' || font.facts.primaryFamily === '-apple-system'
  const first = familiesFor(font, declarations)[0]!
  return (first.kind === 'generic' && first.name === 'system-ui') || (first.kind === 'named' && first.syntax === 'identifiers' && first.name === '-apple-system')
}

// Which family of the list draws a code point, by the optional coverage facts (FontFacts.fonts): the index of the first
// family that realizes and maps it, -1 where every family is known and none maps it (the engine's fallback draws it, with a
// font the facts don't name), or null where the facts don't say. gfxFontGroup::FindFontForChar takes the first font of the
// group that has the character (gfxTextRun.cpp:3276-3300, :3394-3500), and for U+2010 and U+2011 one that has U+002D
// (:3228-3232). It doesn't hold for the characters font matching places by their neighbours: cluster extenders, join
// controls and variation selectors, a character after U+200D, U+202F, and characters with an emoji presentation.
export function listedFontOf(table: FontTable, cp: number): number | null {
  const mapped = sourceFontAt(table, cp)
  if (cp !== 0x2010 && cp !== 0x2011) return mapped
  const hyphen = sourceFontAt(table, 0x2d)
  return hyphen !== null && hyphen >= 0 && (mapped === null || mapped < 0 || hyphen < mapped) ? hyphen : mapped
}

// Publish a source view only on demand. Unknown barriers stop which ordered source cmaps can settle a character; empty
// sets cannot map any character. A single effective cmap keeps its binary lookup without walking its whole source.
function compileCoverage(entries: FontEntry[]): FontCoverage | DemandCoverage {
  const sources: CoverageSource[] = []
  const seen = new Set<readonly number[]>()
  let rangeCount = 0
  let miss: -1 | null = -1
  for (let i = 0; i < entries.length; i++) {
    const f = entries[i]!.facts
    if (f.realizes === null) { miss = null; break }
    const ranges = f.coverage
    if (ranges === null) { miss = null; break }
    // An identical immutable cmap source has identical character membership; its later family cannot win this scalar
    // search. The neighbour-font extender route below still reads the actual previous family's cmap separately.
    if (ranges.length > 0 && !seen.has(ranges)) {
      seen.add(ranges)
      sources.push({ index: entries[i]!.index, ranges })
      rangeCount += ranges.length / 2
    }
  }
  if (sources.length === 1) return { kind: 'single', ...sources[0]!, miss }
  if (sources.length === 0) return { kind: 'partition', ranges: [], miss }
  return { kind: 'demand', sources, miss, cells: orderedRecords(), work: 0,
    limit: (sources.length + rangeCount) * Math.ceil(Math.log2(sources.length + 1)) }
}

function sourceFontAt(table: FontTable, cp: number): number | null {
  const coverage = table.coverage.kind === 'source' ? table.coverage = compileCoverage(table.coverage.entries) : table.coverage
  if (coverage.kind !== 'demand') return fontAt(coverage, cp)
  if (cp < 0 || cp > 0x10ffff) return coverage.miss
  // Source cells are disjoint. The same search bounds the unpublished interval around this point, so insertion needs
  // no deletion or parallel index. Their edges come only from cmap intervals/gaps, never from a text or Canvas question.
  const tree = coverage.cells
  let node = tree.root, start = 0, end = 0x10ffff, steps = 0
  while (node >= 0) {
    steps++
    const cell = tree.records[node]!
    if (cp < cell.start) { end = Math.min(end, cell.start - 1); node = cell.left }
    else if (cp > cell.end) { start = Math.max(start, cell.end + 1); node = cell.right }
    else return cell.index
  }
  coverage.work += steps + 1
  // Decoding a bounded amount of consulted source protects small demand against huge unused cmaps. Once that work
  // reaches the complete-source merge bound, replace the partial cells with the full partition and discard them.
  if (coverage.work >= coverage.limit) return fontAt(table.coverage = partitionCoverage(coverage.sources, coverage.miss), cp)
  let index: number | null = coverage.miss
  for (const source of coverage.sources) {
    coverage.work++
    const ranges = source.ranges
    let lo = 0, hi = ranges.length / 2 - 1, found = false
    while (lo <= hi) {
      coverage.work++
      const mid = (lo + hi) >>> 1, a = ranges[2 * mid]!, b = ranges[2 * mid + 1]!
      if (cp < a) hi = mid - 1
      else if (cp > b) lo = mid + 1
      else { start = Math.max(start, a); end = Math.min(end, b); index = source.index; found = true; break }
    }
    if (found) break
    if (hi >= 0) start = Math.max(start, ranges[2 * hi + 1]! + 1)
    if (lo < ranges.length / 2) end = Math.min(end, ranges[2 * lo]! - 1)
  }
  coverage.work += tree.root < 0 ? 1 : tree.records[tree.root]!.height
  insertRecord(tree, { start, end, index, left: -1, right: -1, height: 1 }, (a, b) => a.start - b.start)
  return index
}

// The first covering source family is constant between cmap endpoints. Merge the already ordered cmap streams once,
// retaining the earliest active original family. Both heaps hold the same ephemeral font walkers: O(F) merge space.
function partitionCoverage(sources: CoverageSource[], miss: -1 | null): FontCoverage {
  type Walker = { index: number; ranges: readonly number[]; next: number; at: number; end: number; add: boolean; active: boolean; queued: boolean }
  const nextRange = (walker: Walker): boolean => {
    if (walker.next === walker.ranges.length) return false
    walker.at = walker.ranges[walker.next]!
    walker.end = walker.ranges[walker.next + 1]!
    walker.next += 2
    // Touching source ranges are one active interval. This also makes every font's endpoint stream strictly ordered.
    while (walker.next < walker.ranges.length && walker.ranges[walker.next]! <= walker.end + 1) {
      walker.end = Math.max(walker.end, walker.ranges[walker.next + 1]!)
      walker.next += 2
    }
    walker.add = true
    return true
  }
  const events: Walker[] = sources.map(source => {
    const walker: Walker = { ...source, next: 0, at: 0, end: 0, add: true, active: false, queued: false }
    nextRange(walker)
    return walker
  })
  const eventDown = (parent: number): void => {
    const walker = events[parent]!
    while (2 * parent + 1 < events.length) {
      let child = 2 * parent + 1
      if (child + 1 < events.length && events[child + 1]!.at < events[child]!.at) child++
      if (walker.at <= events[child]!.at) break
      events[parent] = events[child]!
      parent = child
    }
    events[parent] = walker
  }
  for (let i = (events.length >>> 1) - 1; i >= 0; i--) eventDown(i)
  const heap: Walker[] = []
  const push = (walker: Walker): void => {
    walker.queued = true
    let child = heap.length
    heap.push(walker)
    while (child > 0) {
      const parent = (child - 1) >>> 1
      if (heap[parent]!.index <= walker.index) break
      heap[child] = heap[parent]!
      child = parent
    }
    heap[child] = walker
  }
  const pop = (): void => {
    heap[0]!.queued = false
    const last = heap.pop()!
    if (heap.length === 0) return
    let parent = 0
    while (2 * parent + 1 < heap.length) {
      let child = 2 * parent + 1
      if (child + 1 < heap.length && heap[child + 1]!.index < heap[child]!.index) child++
      if (last.index <= heap[child]!.index) break
      heap[parent] = heap[child]!
      parent = child
    }
    heap[parent] = last
  }
  const ranges: Extract<FontCoverage, { kind: 'partition' }>['ranges'] = []
  while (events.length > 0) {
    const at = events[0]!.at
    do {
      const event = events[0]!
      if (event.add) {
        event.active = true
        if (!event.queued) push(event)
        event.at = event.end + 1
        event.add = false
      } else {
        event.active = false
        if (!nextRange(event)) {
          const last = events.pop()!
          if (events.length > 0) events[0] = last
        }
      }
      if (events.length > 0) eventDown(0)
    } while (events.length > 0 && events[0]!.at === at)
    while (heap.length > 0 && !heap[0]!.active) pop()
    if (events.length === 0 || heap.length === 0) continue
    const index = heap[0]!.index, end = events[0]!.at - 1
    const previous = ranges[ranges.length - 1]
    if (previous !== undefined && previous.index === index && previous.end + 1 === at) previous.end = end
    else ranges.push({ start: at, end, index })
  }
  return { kind: 'partition', ranges, miss }
}

function fontAt(coverage: FontCoverage, cp: number): number | null {
  if (coverage.kind === 'single') return covers(coverage.ranges, cp) ? coverage.index : coverage.miss
  const ranges = coverage.ranges
  let lo = 0, hi = ranges.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (ranges[mid]!.end < cp) lo = mid + 1
    else hi = mid
  }
  return lo < ranges.length && ranges[lo]!.start <= cp ? ranges[lo]!.index : coverage.miss
}

// The family that draws a cluster extender after a character family `base` draws: the same one where it maps the extender
// (FindFontForChar takes the previous character's font for a cluster extender it has, gfxTextRun.cpp:3181-3194), else the
// extender's own (listedFontOf). `base` is a listedFontOf result.
export function extenderFontOf(font: FontDecl, table: FontTable, base: number | null, cp: number): number | null {
  if (base === null) return null
  if (base >= 0 && covers(font.facts.fonts![base]!.coverage!, cp)) return base
  return listedFontOf(table, cp)
}

// Sorted inclusive ranges, flat.
function covers(ranges: readonly number[], cp: number): boolean {
  let lo = 0
  let hi = ranges.length / 2 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cp < ranges[2 * mid]!) hi = mid - 1
    else if (cp > ranges[2 * mid + 1]!) lo = mid + 1
    else return true
  }
  return false
}

// The color emoji font Core Text draws emoji with on macOS 27, a recorded browser fact of the pinned build (probe
// gecko-port F3, rebuild/probes/gecko-emoji-font.ts; data/gecko/apple-color-emoji-advances-macos27.tsv). Its advances come
// from Core Text at the device size (gfxMacFont.cpp:437-463).
export const COLOR_EMOJI_FAMILY = '"Apple Color Emoji"'
