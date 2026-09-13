// Incremental preparation for handles prepared with { editable: true }.
// prepareEdit() finds the changed source range itself, re-analyzes and
// re-measures only a window between two clean separators, and splices the
// previous handle's parallel arrays around it. A clean separator is a space or
// a pre-wrap hard break that no analysis or measurement rule reads across, so
// the window's analysis equals the whole text's analysis restricted to it. The
// result equals prepare()/prepareWithSegments() of the new text against the
// same caches; whatever a window cannot reproduce prepares the whole text.

import {
  analyzeText,
  getBreakLanguage,
  getSharedGraphemeSegmenter,
  type SegmentBreakKind,
  type TextAnalysis,
  type WhiteSpaceMode,
  type WordBreakMode,
} from './analysis.js'
import { classifyCodePoint, computeSegmentLevels } from './bidi.js'
import { getLineBreakClass, LineBreakClass } from './generated/line-break-data.js'
import { getDocumentLanguage, getEngineProfile, getMeasurementGeneration, type EngineProfile } from './measurement.js'

// What measurement reads outside a window: the whole new normalized text and
// the window's offset in it (WebKit's direction scan and the emoji gate), the
// separator after the window and the first source code unit of its run
// (WebKit's following-space kerning), and whether the whole text holds an
// explicit bidi control. Full preparation passes null.
export type MeasureWindowContext = {
  text: string
  offset: number
  followingKind: SegmentBreakKind | null
  followingSourceCode: number
  hasExplicitBidiControls: boolean
}

export type MeasureAnalysis = (
  analysis: TextAnalysis,
  font: string,
  includeSegments: boolean,
  wordBreak: WordBreakMode,
  letterSpacing: number,
  engineProfile: EngineProfile,
  documentLanguage: string | null,
  context: MeasureWindowContext | null,
  startsOut: number[] | null,
) => object

type Chunk = { startSegmentIndex: number, endSegmentIndex: number, consumedEndSegmentIndex: number }

// The fields of a prepared handle, in measureAnalysis()'s key order.
type Handle = {
  widths: number[]
  kinds: SegmentBreakKind[]
  simpleLineWalkFastPath: boolean
  segLevels: Int8Array | null
  breakableFitAdvances: (number[] | null)[]
  breakablePreferredBreaks: (number[] | null)[]
  entryGeometry: (object | null)[] | null
  letterSpacing: number
  spacingGraphemeCounts: number[]
  discretionaryHyphenWidth: number
  discretionaryHyphenContexts: boolean[] | null
  tabStopAdvance: number
  chunks: Chunk[]
  segments?: string[]
}

type EditOptions = {
  whiteSpace?: WhiteSpaceMode | undefined
  wordBreak?: WordBreakMode | undefined
  letterSpacing?: number | undefined
}

export type EditState = {
  font: string
  whiteSpace: WhiteSpaceMode
  wordBreak: WordBreakMode
  letterSpacing: number
  includeSegments: boolean
  // Break rules and the measurement context follow the page language, and
  // every cache clear starts a new generation. Never splice across either.
  documentLanguage: string | null
  generation: number
  source: string
  normalized: string
  starts: number[] // normalized start of each segment
  sourceStarts: number[] // source start of each segment
  // Counts behind the handle-wide facts.
  nonSimpleKinds: number
  entries: number
  softHyphens: number
  explicitBidiControls: number
  strongRtl: number
}

const editStates = new WeakMap<object, EditState>()

// Test hooks for scripts/edit-differential.ts: how the last edit was prepared
// ('splice', 'same', or the reason for a full prepare), its window size and
// guard widenings, and the retained states.
export const editHooks = { reason: '', window: 0, widenings: 0, states: editStates }

export function prepareEditable(
  text: string,
  font: string,
  includeSegments: boolean,
  options: EditOptions,
  measure: MeasureAnalysis,
): object {
  const whiteSpace = options.whiteSpace ?? 'normal'
  const wordBreak = options.wordBreak ?? 'normal'
  const letterSpacing = options.letterSpacing ?? 0
  const documentLanguage = getDocumentLanguage()
  const profile = getEngineProfile(getBreakLanguage(documentLanguage))
  const analysis = analyzeText(text, profile, whiteSpace, wordBreak)
  const starts: number[] = []
  const handle = measure(analysis, font, includeSegments, wordBreak, letterSpacing, profile, documentLanguage, null, starts) as Handle
  const [nonSimpleKinds, entries, softHyphens] = countSegments(handle, 0, handle.widths.length)
  const [explicitBidiControls, strongRtl] = countCodePoints(analysis.normalized, 0, analysis.normalized.length)
  editStates.set(handle, {
    font,
    whiteSpace,
    wordBreak,
    letterSpacing,
    includeSegments,
    documentLanguage,
    // Read after measuring: a page-language change clears the caches there.
    generation: getMeasurementGeneration(),
    source: text,
    normalized: analysis.normalized,
    starts,
    sourceStarts: mapSourceStarts(text, analysis.normalized, whiteSpace, starts),
    nonSimpleKinds,
    entries,
    softHyphens,
    explicitBidiControls,
    strongRtl,
  })
  return handle
}

function isCollapsibleWhitespaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c
}

// Source start of each segment. Normalization only removes, collapses or
// rewrites whitespace, so every other normalized code unit maps to the next
// source code unit. In normal white space a collapsed space maps to its run's
// start and a removed or trimmed run maps to nothing; pre-wrap turns CR LF, CR
// and FF into LF.
function mapSourceStarts(source: string, normalized: string, whiteSpace: WhiteSpaceMode, starts: readonly number[]): number[] {
  const out: number[] = []
  let s = 0
  let j = 0
  for (let k = 0; k < starts.length; k++) {
    for (; j < starts[k]!; j++) {
      if (whiteSpace === 'pre-wrap') {
        s += normalized.charCodeAt(j) === 0x0a && source.charCodeAt(s) === 0x0d && source.charCodeAt(s + 1) === 0x0a ? 2 : 1
        continue
      }
      const collapsed = normalized.charCodeAt(j) === 0x20 && isCollapsibleWhitespaceCode(source.charCodeAt(s))
      while (s < source.length && isCollapsibleWhitespaceCode(source.charCodeAt(s))) s++
      if (!collapsed) s++
    }
    if (whiteSpace === 'normal' && normalized.charCodeAt(j) !== 0x20) {
      while (s < source.length && isCollapsibleWhitespaceCode(source.charCodeAt(s))) s++
    }
    out.push(s)
  }
  return out
}

// Non-simple kinds, entry geometries and soft hyphens in [from, to).
function countSegments(handle: Handle, from: number, to: number): [number, number, number] {
  let nonSimpleKinds = 0
  let entries = 0
  let softHyphens = 0
  for (let i = from; i < to; i++) {
    const kind = handle.kinds[i]!
    if (kind !== 'text' && kind !== 'space' && kind !== 'zero-width-break') nonSimpleKinds++
    if (kind === 'soft-hyphen') softHyphens++
    if (handle.entryGeometry !== null && handle.entryGeometry[i] !== null) entries++
  }
  return [nonSimpleKinds, entries, softHyphens]
}

// Explicit bidi controls, and code points of class R, AL or AN, which decide
// whether segLevels is null.
function countCodePoints(text: string, from: number, to: number): [number, number] {
  let controls = 0
  let strongRtl = 0
  for (let i = from; i < to;) {
    const codePoint = text.codePointAt(i)!
    if ((codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069)) controls++
    const type = classifyCodePoint(codePoint)
    if (type === 'R' || type === 'AL' || type === 'AN') strongRtl++
    i += codePoint > 0xffff ? 2 : 1
  }
  return [controls, strongRtl]
}

// --- Separators ---

const excludedSpaceNeighborRe = /[\p{Cc}\p{Cf}\p{Cs}\p{Zs}\p{M}]/u
const markRe = /\p{M}/u

function previousCodePointStart(text: string, end: number): number {
  const low = text.charCodeAt(end - 1)
  if (end >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = text.charCodeAt(end - 2)
    if (high >= 0xd800 && high <= 0xdbff) return end - 2
  }
  return end - 1
}

function isMarkLike(codePoint: number): boolean {
  return getLineBreakClass(codePoint) === LineBreakClass.CM || markRe.test(String.fromCodePoint(codePoint))
}

function isGraphemeBoundary(text: string, boundary: number): boolean {
  const start = previousCodePointStart(text, boundary)
  const pair = text.slice(start, boundary + (text.codePointAt(boundary)! > 0xffff ? 2 : 1))
  return getSharedGraphemeSegmenter().segment(pair).containing(0)!.segment.length === boundary - start
}

function isStrongOrNumber(codePoint: number): boolean {
  const type = classifyCodePoint(codePoint)
  return type === 'L' || type === 'R' || type === 'AL' || type === 'EN' || type === 'AN'
}

// Whether analysis on either side of segment k never reads across it. The
// window analysis sees the text start or end in its place.
function isCleanSeparator(state: EditState, kinds: readonly SegmentBreakKind[], profile: EngineProfile, k: number): boolean {
  const kind = kinds[k]!
  if (kind !== 'space' && kind !== 'preserved-space' && kind !== 'hard-break') return false
  const { normalized, starts } = state
  const start = starts[k]!
  const end = starts[k + 1] ?? normalized.length
  if (start === 0 || end >= normalized.length) return false
  // Scans back through marks from the text after any separator would cross it.
  const after = normalized.codePointAt(end)!
  if (isMarkLike(after)) return false
  if (kind === 'hard-break') return true
  // Segmenters attach format characters, extenders and spaces to a space;
  // segment-break removal, ZWJ and NEL rules read one neighbor.
  const before = normalized.codePointAt(previousCodePointStart(normalized, start))!
  if (excludedSpaceNeighborRe.test(String.fromCodePoint(before)) || isMarkLike(before) ||
    excludedSpaceNeighborRe.test(String.fromCodePoint(after)) || classifyCodePoint(before) === 'BN') {
    return false
  }
  // Measuring a word with its following space, which WebKit does without letter
  // spacing, scans past the space for the first character that decides its
  // direction. A strong or numeric character right after the separator stops
  // every such scan from earlier words there.
  if (profile.measureTextWithFollowingSpace && state.letterSpacing === 0 && !isStrongOrNumber(after)) return false
  if (!isGraphemeBoundary(normalized, start) || !isGraphemeBoundary(normalized, end)) return false
  // WebKit reads a collapsed TAB before a hyphen from the source.
  return !(kind === 'space' && profile.breakHyphenAfterCollapsedTab && state.source.charCodeAt(state.sourceStarts[k + 1]! - 1) === 0x09)
}

function upperBound(values: readonly number[], x: number): number {
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (values[mid]! <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}

// The nearest clean separators on one side of the edit, nearest first. Two
// code units lie between each separator's run and the edit, so the run and the
// code points on both sides of it are unchanged.
function findSeparators(state: EditState, kinds: readonly SegmentBreakKind[], profile: EngineProfile, edge: number, left: boolean, count: number): number[] {
  const { sourceStarts } = state
  const found: number[] = []
  const step = left ? -1 : 1
  for (let k = upperBound(sourceStarts, edge) - (left ? 1 : 0); k >= 0 && k < sourceStarts.length && found.length < count; k += step) {
    const clear = left ? sourceStarts[k + 1]! + 2 <= edge : sourceStarts[k]! - 2 >= edge
    if (clear && isCleanSeparator(state, kinds, profile, k)) found.push(k)
  }
  return found
}

// --- Changed range ---

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  for (let block = 4096; block >= 16 && i < n;) {
    if (i + block <= n && a.slice(i, i + block) === b.slice(i, i + block)) i += block
    else block >>= 2
  }
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

function commonSuffixLength(a: string, b: string, prefix: number): number {
  const n = Math.min(a.length, b.length) - prefix
  let i = 0
  for (let block = 4096; block >= 16 && i < n;) {
    if (i + block <= n && a.slice(a.length - i - block, a.length - i) === b.slice(b.length - i - block, b.length - i)) i += block
    else block >>= 2
  }
  while (i < n && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++
  return i
}

// --- Splicing ---

function splice<T>(old: readonly T[], from: number, to: number, inserted: readonly T[]): T[] {
  return old.slice(0, from).concat(inserted, old.slice(to))
}

// Splices arrays that are null while they would hold only `fill`.
function spliceFilled<T>(old: readonly T[] | null, n: number, from: number, to: number, inserted: readonly T[] | null, m: number, fill: T): T[] {
  return splice(old ?? Array.from({ length: n }, () => fill), from, to, inserted ?? Array.from({ length: m }, () => fill))
}

function spliceShifted(old: readonly number[], from: number, to: number, inserted: readonly number[], insertedShift: number, tailShift: number): number[] {
  const out = old.slice(0, from)
  for (let i = 0; i < inserted.length; i++) out.push(inserted[i]! + insertedShift)
  for (let i = to; i < old.length; i++) out.push(old[i]! + tailShift)
  return out
}

// Chunks end at hard breaks; the rest of the text after the last one is a chunk.
function spliceChunks(old: Handle, from: number, to: number, measured: Handle, length: number): Chunk[] {
  const breaks: number[] = []
  const shift = measured.widths.length - (to - from)
  for (let i = 0; i < old.chunks.length; i++) {
    const end = old.chunks[i]!.endSegmentIndex
    if (end < from && old.kinds[end] === 'hard-break') breaks.push(end)
  }
  for (let i = 0; i < measured.widths.length; i++) if (measured.kinds[i] === 'hard-break') breaks.push(from + i)
  for (let i = 0; i < old.chunks.length; i++) {
    const end = old.chunks[i]!.endSegmentIndex
    if (end >= to && old.kinds[end] === 'hard-break') breaks.push(end + shift)
  }
  const chunks: Chunk[] = []
  let start = 0
  for (let i = 0; i < breaks.length; i++) {
    chunks.push({ startSegmentIndex: start, endSegmentIndex: breaks[i]!, consumedEndSegmentIndex: breaks[i]! + 1 })
    start = breaks[i]! + 1
  }
  if (start < length) chunks.push({ startSegmentIndex: start, endSegmentIndex: length, consumedEndSegmentIndex: length })
  return chunks
}

// Whether `count` window segments from windowFrom reproduce the old segments
// from oldFrom: kinds, starts, and whether fit advances are null.
function sameSegments(old: Handle, oldStarts: readonly number[], oldFrom: number, window: Handle, windowStarts: readonly number[], windowFrom: number, count: number, shift: number): boolean {
  if (windowFrom < 0 || windowFrom + count > window.widths.length) return false
  for (let i = 0; i < count; i++) {
    const o = oldFrom + i
    const w = windowFrom + i
    if (old.kinds[o] !== window.kinds[w] || oldStarts[o] !== windowStarts[w]! + shift ||
      (old.breakableFitAdvances[o] === null) !== (window.breakableFitAdvances[w] === null)) {
      return false
    }
  }
  return true
}

// --- Edit ---

export function editPrepared(previous: object, text: string, measure: MeasureAnalysis): object {
  const state = editStates.get(previous)
  if (state === undefined) throw new TypeError('prepareEdit() needs a state prepared with { editable: true }')
  const { font, whiteSpace, wordBreak, letterSpacing, includeSegments, source, starts, sourceStarts } = state
  editHooks.window = 0
  editHooks.widenings = 0
  const full = (reason: string): object => {
    editHooks.reason = reason
    return prepareEditable(text, font, includeSegments, state, measure)
  }
  // Nothing from `previous`, not even the whole handle, is reused under another
  // page language or cache generation.
  if (getDocumentLanguage() !== state.documentLanguage) return full('language')
  if (getMeasurementGeneration() !== state.generation) return full('generation')
  if (text === source) {
    editHooks.reason = 'same'
    return previous
  }
  const old = previous as Handle
  const n = old.widths.length
  if (n === 0) return full('empty')

  const profile = getEngineProfile(getBreakLanguage(state.documentLanguage))
  const followsSpaceKerning = profile.measureTextWithFollowingSpace && letterSpacing === 0
  const editStart = commonPrefixLength(source, text)
  const editEnd = source.length - commonSuffixLength(source, text, editStart)
  const delta = text.length - source.length
  // One guard block on each side: re-analyzed and compared, never changed.
  let leftGuards = 1
  let rightGuards = leftGuards
  for (;;) {
    const lefts = findSeparators(state, old.kinds, profile, editStart, true, leftGuards + 1)
    const rights = findSeparators(state, old.kinds, profile, editEnd, false, rightGuards + 1)
    const outerLeft = lefts[leftGuards] ?? -1
    const outerRight = rights[rightGuards] ?? n
    if (outerLeft < 0 && outerRight === n) return full('bounds')
    const kStart = outerLeft + 1
    const normStart = outerLeft < 0 ? 0 : starts[kStart]!
    const normEnd = outerRight === n ? state.normalized.length : starts[outerRight]!
    const srcStart = outerLeft < 0 ? 0 : sourceStarts[kStart]!
    const srcEnd = outerRight === n ? text.length : sourceStarts[outerRight]! + delta
    editHooks.window = srcEnd - srcStart
    if ((srcEnd - srcStart) * 2 > text.length) return full('half')

    const windowSource = text.slice(srcStart, srcEnd)
    const analysis = analyzeText(windowSource, profile, whiteSpace, wordBreak)
    const normalized = state.normalized.slice(0, normStart) + analysis.normalized + state.normalized.slice(normEnd)
    const normDelta = normalized.length - state.normalized.length
    const [removedControls, removedRtl] = countCodePoints(state.normalized, normStart, normEnd)
    const [addedControls, addedRtl] = countCodePoints(analysis.normalized, 0, analysis.normalized.length)
    const explicitBidiControls = state.explicitBidiControls - removedControls + addedControls
    // Words outside the window were measured under the old text-wide answer.
    if (followsSpaceKerning && (explicitBidiControls > 0) !== (state.explicitBidiControls > 0)) return full('bidi')
    const context: MeasureWindowContext = {
      text: normalized,
      offset: normStart,
      followingKind: outerRight < n ? old.kinds[outerRight]! : null,
      followingSourceCode: outerRight < n ? source.charCodeAt(sourceStarts[outerRight]!) : 0,
      hasExplicitBidiControls: explicitBidiControls > 0,
    }
    const windowStarts: number[] = []
    const measured = measure(analysis, font, includeSegments, wordBreak, letterSpacing, profile, state.documentLanguage, context, windowStarts) as Handle
    const m = measured.widths.length

    // Each guard block, through its separator, must reproduce the old segments.
    const leftCount = lefts.length > 0 ? lefts[0]! - kStart + 1 : 0
    const rightCount = rights.length > 0 ? outerRight - rights[0]! : 0
    const leftConverged = sameSegments(old, starts, kStart, measured, windowStarts, 0, leftCount, normStart)
    const rightConverged = sameSegments(old, starts, outerRight - rightCount, measured, windowStarts, m - rightCount, rightCount, normStart - normDelta)
    if (!leftConverged || !rightConverged) {
      if (++editHooks.widenings > 4) return full('converge')
      if (!leftConverged) leftGuards++
      if (!rightConverged) rightGuards++
      continue
    }

    editHooks.reason = 'splice'
    const [oldNonSimple, oldEntries, oldSoftHyphens] = countSegments(old, kStart, outerRight)
    const [newNonSimple, newEntries, newSoftHyphens] = countSegments(measured, 0, m)
    const nonSimpleKinds = state.nonSimpleKinds - oldNonSimple + newNonSimple
    const entries = state.entries - oldEntries + newEntries
    const softHyphens = state.softHyphens - oldSoftHyphens + newSoftHyphens
    const strongRtl = state.strongRtl - removedRtl + addedRtl
    const newStarts = spliceShifted(starts, kStart, outerRight, windowStarts, normStart, normDelta)
    const windowSourceStarts = mapSourceStarts(windowSource, analysis.normalized, whiteSpace, windowStarts)
    const length = n - (outerRight - kStart) + m
    const segLevels = includeSegments && strongRtl > 0 ? computeSegmentLevels(normalized, newStarts) : null
    const simpleLineWalkFastPath = letterSpacing === 0 && nonSimpleKinds === 0 && entries === 0
    const core: Handle = {
      widths: splice(old.widths, kStart, outerRight, measured.widths),
      kinds: splice(old.kinds, kStart, outerRight, measured.kinds),
      simpleLineWalkFastPath,
      segLevels,
      breakableFitAdvances: splice(old.breakableFitAdvances, kStart, outerRight, measured.breakableFitAdvances),
      breakablePreferredBreaks: splice(old.breakablePreferredBreaks, kStart, outerRight, measured.breakablePreferredBreaks),
      entryGeometry: entries === 0 ? null : spliceFilled(old.entryGeometry, n, kStart, outerRight, measured.entryGeometry, m, null),
      letterSpacing,
      spacingGraphemeCounts: splice(old.spacingGraphemeCounts, kStart, outerRight, measured.spacingGraphemeCounts),
      discretionaryHyphenWidth: old.discretionaryHyphenWidth,
      discretionaryHyphenContexts: profile.unfitHyphenRetreat !== 'none' && softHyphens > 0
        ? spliceFilled(old.discretionaryHyphenContexts, n, kStart, outerRight, measured.discretionaryHyphenContexts, m, false)
        : null,
      tabStopAdvance: old.tabStopAdvance,
      chunks: spliceChunks(old, kStart, outerRight, measured, length),
    }
    const handle = includeSegments ? { ...core, segments: splice(old.segments!, kStart, outerRight, measured.segments!) } : core
    editStates.set(handle, {
      ...state,
      source: text,
      normalized,
      starts: newStarts,
      sourceStarts: spliceShifted(sourceStarts, kStart, outerRight, windowSourceStarts, srcStart, delta),
      nonSimpleKinds,
      entries,
      softHyphens,
      explicitBidiControls,
      strongRtl,
    })
    return handle
  }
}
