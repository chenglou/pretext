import { RuleBreakIterator, ruleBoundaries } from '../../src/breaks/rbbi.js'
import { lineRules, webkitGraphemeRules } from '../../src/engines/webkit/data.js'
import { graphemeBoundaries } from '../../src/unicode/grapheme.js'
import { prepareBidi, visualRuns, type PreparedBidi } from './bidi.js'

export type OwnedItem =
  | { kind: 'text'; text: string; font: string; letterSpacing?: number; extraWidth?: number; atomic?: boolean }
  | { kind: 'atomic'; width: number; height: number; label: string }
export type Measure = (text: string, font: string, direction: 'ltr' | 'rtl', letterSpacing: number) => number
export type OwnedOptions = { direction?: 'ltr' | 'rtl' | 'auto'; lang?: string; boundaryPolicy?: 'strict' | 'independent' }
export type OwnedUnit = {
  start: number; end: number; itemIndex: number; text: string; font: string; letterSpacing: number
  direction: 'ltr' | 'rtl'; width: number; height: number; kind: 'text' | 'atomic'; space: boolean; breakAfter: boolean
}
export type PreparedOwned = { text: string; items: readonly OwnedItem[]; units: OwnedUnit[]; bidi: PreparedBidi; lang: string; boundaries: number[] }
export type OwnedFragment = Omit<OwnedUnit, 'space' | 'breakAfter'> & { x: number }
export type OwnedLine = { start: number; end: number; width: number; separator: string; fragments: OwnedFragment[] }

// Retain joiners and selectors. Formatting controls affect paragraph bidi, but
// must not independently reorder an already resolved fragment.
export const stripBidiControls = (text: string): string => text.replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
export const overrideText = (text: string, direction: 'ltr' | 'rtl'): string => (direction === 'rtl' ? '\u202e' : '\u202d') + text + '\u202c'

// These scripts have ordinary nonjoining letter layouts. Other scripts keep
// whole word segments; this is a conservative prototype boundary, not a claim
// that grapheme boundaries describe all font shaping.
const SIMPLE_LETTER = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const LETTER = /\p{Letter}/u
function needsWholeWord(text: string): boolean {
  for (const c of text) if (LETTER.test(c) && !SIMPLE_LETTER.test(c)) return true
  return false
}
function validateWidth(value: number): void {
  if (!Number.isFinite(value)) throw new Error('Owned rendering requires finite widths')
}
function lowerUnit(units: readonly OwnedUnit[], offset: number): number {
  let lo = 0, hi = units.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (units[mid]!.start < offset) lo = mid + 1; else hi = mid }
  return lo
}

export function prepare(items: readonly OwnedItem[], options: OwnedOptions, measure: Measure): PreparedOwned {
  const lang = options.lang ?? 'en'
  // Validate developer boundaries before whitespace normalization changes offsets.
  let raw = ''
  const rawEdges: number[] = []
  for (let i = 0; i < items.length; i++) { const item = items[i]!; raw += item.kind === 'text' ? item.text : '\ufffc'; rawEdges.push(raw.length) }
  const rawBoundaries = graphemeBoundaries(raw, webkitGraphemeRules)
  let boundaryIndex = 0
  for (const edge of rawEdges) {
    while (rawBoundaries[boundaryIndex]! < edge) boundaryIndex++
    if (rawBoundaries[boundaryIndex] !== edge) throw new Error('A rich item boundary splits a grapheme cluster')
  }
  const normalized: OwnedItem[] = []
  const itemStarts: number[] = [], itemEnds: number[] = []
  let text = '', previousSpace = false
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    itemStarts.push(text.length)
    if (item.kind === 'atomic') { normalized.push(item); text += '\ufffc'; previousSpace = false }
    else {
      let value = item.text.replace(/[\t\r\n\f ]+/g, ' ')
      if (previousSpace && value.startsWith(' ')) value = value.slice(1)
      normalized.push({ ...item, text: value })
      text += value
      if (value.length !== 0) previousSpace = value.endsWith(' ')
    }
    itemEnds.push(text.length)
  }
  const boundaries = graphemeBoundaries(text, webkitGraphemeRules)
  let bidiText = ''
  for (const item of normalized) bidiText += item.kind === 'text'
    ? item.atomic === true ? '\ufffc'.repeat(item.text.length) : item.text
    : '\ufffc'
  const bidi = prepareBidi(bidiText, options.direction ?? 'auto', boundaries)
  const rules = lineRules(lang, 'Default', 'en_US_POSIX')
  const breaks = new Uint8Array(text.length + 1)
  for (const b of ruleBoundaries(new RuleBreakIterator(rules.rules, rules.overrides), text)) breaks[b.offset] = 1
  const words = new Intl.Segmenter(lang, { granularity: 'word' })
  const protectedOffsets = new Uint8Array(text.length + 1)
  for (const word of words.segment(text)) {
    if (!word.isWordLike || !needsWholeWord(word.segment)) continue
    const end = word.index + word.segment.length
    for (let p = word.index + 1; p < end; p++) { protectedOffsets[p] = 1; breaks[p] = 0 }
    // ICU's rule iterator delegates these scripts to a dictionary. The prototype
    // uses the host's word segmenter, rather than a browser layout engine.
    breaks[end] = 1
  }
  if (options.boundaryPolicy !== 'independent') {
    for (let i = 0; i + 1 < normalized.length; i++) {
      const edge = itemEnds[i]!
      if (normalized[i]!.kind === 'atomic' || normalized[i + 1]!.kind === 'atomic'
        || (normalized[i] as { atomic?: boolean }).atomic === true || (normalized[i + 1] as { atomic?: boolean }).atomic === true) continue
      if (protectedOffsets[edge] === 1) throw new Error('A rich item boundary splits a contextual shaping word')
    }
  }
  const units: OwnedUnit[] = []
  let gi = 0
  for (let itemIndex = 0; itemIndex < normalized.length; itemIndex++) {
    const item = normalized[itemIndex]!, start = itemStarts[itemIndex]!, end = itemEnds[itemIndex]!
    if (start === end) continue
    if (item.kind === 'atomic') {
      validateWidth(item.width)
      if (item.width < 0 || !Number.isFinite(item.height) || item.height < 0) throw new Error('Invalid atomic item size')
      const direction = (bidi.levels[start]! & 1) === 0 ? 'ltr' : 'rtl'
      units.push({ start, end, itemIndex, text: item.label, font: '16px Arial', letterSpacing: 0, direction, width: item.width, height: item.height, kind: 'atomic', space: false, breakAfter: true })
      if (units.length > 1) units[units.length - 2]!.breakAfter = true
      continue
    }
    const spacing = item.letterSpacing ?? 0, extraWidth = item.extraWidth ?? 0
    validateWidth(spacing); validateWidth(extraWidth)
    let begin = start
    while (gi < boundaries.length && boundaries[gi]! <= start) gi++
    for (let p = gi; p < boundaries.length && boundaries[p]! <= end; p++) {
      const at = boundaries[p]!
      const isEnd = at === end
      const beforeSpace = text.slice(boundaries[p - 1]!, at) === ' '
      const afterSpace = !isEnd && text.slice(at, boundaries[p + 1]!) === ' '
      const levelChanges = !isEnd && bidi.levels[at] !== bidi.levels[begin]
      if (item.atomic !== true && !isEnd && breaks[at] !== 1 && !beforeSpace && !afterSpace && !levelChanges) continue
      if (item.atomic === true && !isEnd) continue
      const value = stripBidiControls(text.slice(begin, at))
      const direction = (bidi.levels[begin]! & 1) === 0 ? 'ltr' : 'rtl'
      const innerDirection = item.atomic === true ? (prepareBidi(value, 'auto').baseLevel & 1) === 0 ? 'ltr' : 'rtl' : direction
      const measuredText = item.atomic === true ? value : overrideText(value, direction)
      const width = (value.length === 0 ? 0 : measure(measuredText, item.font, innerDirection, spacing)) + (item.atomic === true ? extraWidth : 0)
      validateWidth(width)
      units.push({ start: begin, end: at, itemIndex, text: value, font: item.font, letterSpacing: spacing, direction, width, height: 0, kind: 'text', space: value === ' ', breakAfter: item.atomic === true || breaks[at] === 1 })
      begin = at
    }
    if (item.atomic === true && units.length > 1) units[units.length - 2]!.breakAfter = true
  }
  return { text, items: normalized, units, bidi, lang, boundaries }
}

type Emit = (from: number, to: number, width: number) => void
// One shared numeric walk drives counts and materialized positioned lines.
function walk(prepared: PreparedOwned, maxWidth: number, emit?: Emit): number {
  validateWidth(maxWidth)
  if (maxWidth < 0) throw new Error('Layout width must be nonnegative')
  const units = prepared.units
  let lines = 0
  for (let begin = 0; begin < units.length;) {
    while (begin < units.length && units[begin]!.space) begin++
    if (begin === units.length) break
    let total = 0, trimmed = 0, lastBreak = -1, lastWidth = 0, end = units.length, width = 0
    for (let i = begin; i < units.length; i++) {
      const unit = units[i]!
      total += unit.width
      if (!unit.space) trimmed = total
      if (trimmed > maxWidth && lastBreak > begin) { end = lastBreak; width = lastWidth; break }
      if (unit.breakAfter) {
        lastBreak = i + 1; lastWidth = trimmed
        if (trimmed > maxWidth) { end = i + 1; width = trimmed; break }
      }
      width = trimmed
    }
    let visibleEnd = end
    while (visibleEnd > begin && units[visibleEnd - 1]!.space) visibleEnd--
    if (visibleEnd > begin) { lines++; emit?.(begin, visibleEnd, width) }
    begin = end
  }
  return lines
}
export function count(prepared: PreparedOwned, maxWidth: number): number { return walk(prepared, maxWidth) }

export function layout(prepared: PreparedOwned, maxWidth: number): OwnedLine[] {
  const lines: OwnedLine[] = []
  walk(prepared, maxWidth, (begin, end, width) => {
    const first = prepared.units[begin]!, last = prepared.units[end - 1]!
    const runs = visualRuns(prepared.bidi, first.start, last.end)
    let lo = 0, hi = prepared.bidi.paragraphs.length
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (prepared.bidi.paragraphs[mid]!.start <= first.start) lo = mid; else hi = mid }
    const paragraph = prepared.bidi.paragraphs[lo]!
    let x = (paragraph.level & 1) === 0 ? 0 : maxWidth - width
    const fragments: OwnedFragment[] = []
    for (const run of runs) {
      const from = Math.max(begin, lowerUnit(prepared.units, run.start))
      const to = Math.min(end, lowerUnit(prepared.units, run.end))
      for (let j = 0; j < to - from; j++) {
        const unit = prepared.units[run.direction === 'ltr' ? from + j : to - 1 - j]!
        if (unit.text.length === 0) continue
        const { space: _space, breakAfter: _breakAfter, ...fragment } = unit
        fragments.push({ ...fragment, direction: run.direction, x })
        x += unit.width
      }
    }
    lines.push({ start: first.start, end: last.end, width, separator: prepared.units[end]?.space === true ? ' ' : '', fragments })
  })
  return lines
}
