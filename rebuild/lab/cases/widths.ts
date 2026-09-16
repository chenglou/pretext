// Width selection without Canvas. A crude per-character advance estimate places a paragraph's natural
// width within a factor of about two; widths come from a fixed grid inside [natural / 8, natural], so
// most cases wrap to 1-8 lines, plus occasional very narrow widths that force emergency breaks. The
// estimate only spreads widths; nothing downstream relies on it.

import type { FontDecl, Paragraph, TextRun } from '../types.ts'
import type { Rng } from './prng.ts'

const MONOSPACE = /Courier|Menlo|monospace/i
const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u
const ZERO = /[\p{M}\p{Cf}\p{Cc}]/u
const NARROW_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}]/u
const MEDIUM_SCRIPT = /[\p{Script=Thai}\p{Script=Devanagari}\p{Script=Myanmar}\p{Script=Khmer}]/u

function advanceEm(char: string, monospace: boolean): number {
  if (char === '\t') return 2
  if (char === ' ' || char === ' ') return 0.28
  if (ZERO.test(char)) return 0
  if (WIDE.test(char)) return 1
  if (PICTOGRAPH.test(char)) return 1.2
  if (monospace) return 0.6
  if (NARROW_SCRIPT.test(char)) return 0.45
  if (MEDIUM_SCRIPT.test(char)) return 0.55
  if (/\p{Lu}/u.test(char)) return 0.68
  if (/\p{N}/u.test(char)) return 0.56
  if (/\p{L}/u.test(char)) return 0.5
  return 0.33
}

export function estimateTextWidth(value: string, runFont: FontDecl, letterSpacing = 0, wordSpacing = 0): number {
  const monospace = MONOSPACE.test(runFont.family)
  const scale = /Verdana/i.test(runFont.family) ? 1.15 : 1
  let width = 0
  for (const char of value) {
    const em = advanceEm(char, monospace)
    width += em * runFont.size * scale
    if (em > 0) width += letterSpacing
    if (char === ' ' || char === ' ') width += wordSpacing
  }
  return Math.max(0, width)
}

export function estimateRunsWidth(runs: readonly TextRun[]): number {
  let width = 0
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    width += estimateTextWidth(run.text, run.font, run.letterSpacing, run.wordSpacing)
  }
  return width
}

export function estimateParagraphWidth(paragraph: Paragraph): number {
  return estimateRunsWidth(paragraph.runs)
}

const GRID: number[] = []
for (let width = 20; width <= 480; width += 4) GRID.push(width)
const NARROW = [1, 2, 5, 8, 12]

export type WidthOptions = { narrowChance?: number; maxLines?: number; fractionChance?: number }

function stratifiedPicks(rng: Rng, candidates: readonly number[], count: number): number[] {
  const picks: number[] = []
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * candidates.length) / count)
    const to = Math.max(from + 1, Math.floor(((i + 1) * candidates.length) / count))
    picks.push(candidates[from + rng.int(to - from)]!)
  }
  return picks
}

function finish(rng: Rng, picks: number[], options: WidthOptions): number[] {
  if (rng.chance(options.narrowChance ?? 0.1)) picks[rng.int(picks.length)] = rng.pick(NARROW)
  return [...new Set(picks)]
}

// Integer grid widths (occasionally with a quarter-pixel fraction) for paragraphs of any script.
export function pickWidths(rng: Rng, natural: number, count: number, options: WidthOptions = {}): number[] {
  const maxLines = options.maxLines ?? 8
  let candidates = GRID.filter(width => width >= natural / maxLines && width <= natural * 1.05)
  if (candidates.length === 0) candidates = natural < 20 ? [20, 40, 80] : GRID.slice(-8)
  const picks = stratifiedPicks(rng, candidates, count).map(width => (rng.chance(options.fractionChance ?? 0.15) ? width + rng.pick([0.25, 0.5, 0.75]) : width))
  return finish(rng, picks, options)
}

// Widths near multiples of the font size, so fullwidth CJK paragraphs end lines at specific characters
// (exactly, half a glyph past, or just short of the next glyph).
export function pickCjkWidths(rng: Rng, natural: number, size: number, count: number, options: WidthOptions = {}): number[] {
  const maxLines = options.maxLines ?? 8
  const low = Math.max(1, Math.ceil(natural / maxLines / size))
  const high = Math.max(low, Math.min(Math.floor(natural / size), Math.floor(GRID[GRID.length - 1]! / size)))
  const multiples: number[] = []
  for (let k = low; k <= high; k++) multiples.push(k)
  const picks = stratifiedPicks(rng, multiples, count).map(k => k * size + rng.pick([0, 0, 0.5, size / 2, size - 0.5]))
  return finish(rng, picks, options)
}

// Widths around a threshold estimate, stratified across [low, high] times the estimate.
export function sweepWidths(rng: Rng, estimate: number, count: number, low = 0.8, high = 1.25): number[] {
  const picks: number[] = []
  for (let i = 0; i < count; i++) {
    const factor = low + ((i + rng.next()) / count) * (high - low)
    picks.push(Math.max(1, Math.round(estimate * factor * 4) / 4))
  }
  return [...new Set(picks)]
}
