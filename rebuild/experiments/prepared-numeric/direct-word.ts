import { indexContent } from '../../src/content.js'
import { blinkFontChecks } from '../../src/engines/blink/checks.js'
import { stylesOf } from '../../src/engines/blink/content.js'
import { raw16Of, styleContexts } from '../../src/engines/blink/contexts.js'
import { LU_MAX, LU_MIN } from '../../src/engines/blink/layout-unit.js'
import { ceilFrom16, luCeil, widthOf16 } from '../../src/engines/blink/shape.js'
import { createContextPool } from '../../src/measure/canvas.js'
import { withLearnedFontFacts } from '../../src/measure/font-checks.js'
import type { BlinkEnvironment } from '../../src/env.js'
import type { Paragraph } from '../../src/model.js'
import type { PreparedNumericWord } from './exact-count.js'

export type DirectWordDiagnostics = {
  sourceUtf16: number
  distinctLetters: number
  distinctPairs: number
  nonzeroPairs: number
  localMeasurements: number
  localSubmittedUtf16: number
  wholeResidual16: number
}
export type DirectWordResult =
  | { kind: 'numeric-word'; value: PreparedNumericWord; diagnostics: DirectWordDiagnostics }
  | { kind: 'unsupported'; reason: string; diagnostics?: DirectWordDiagnostics }

// A literal Latin word becomes an unsegmented 8-bit paragraph in redo's
// content builder. Reconstruct one-byte spelling instead of borrowing an input
// Latin-only slice that V8 might still store as a two-byte string. This matches
// buildContent's fromCharCode chunks and avoids a measured-string-key cache.
function oneByteAsciiSpelling(text: string): string {
  const codes: number[] = [], chunks: string[] = []
  for (let k = 0; k < text.length; k++) {
    codes.push(text.charCodeAt(k))
    if (codes.length === 4096) { chunks.push(String.fromCharCode(...codes)); codes.length = 0 }
  }
  if (codes.length > 0) chunks.push(String.fromCharCode(...codes))
  return chunks.join('')
}

function letterIndex(code: number): number {
  return code <= 90 ? code - 65 : code - 97 + 26
}

// Explicit empirical subset, not a safety certificate for arbitrary font
// programs. A synthetic font can keep singles, every pair and the whole width
// unchanged while changing internal contextual advances. Native cut checks are
// therefore required; no font-specific admission table is introduced here.
export function prepareDirectWord(paragraph: Paragraph, env: BlinkEnvironment): DirectWordResult {
  if (paragraph.content.length !== 1 || paragraph.content[0]!.kind !== 'text') return { kind: 'unsupported', reason: 'not a single text leaf' }
  if (paragraph.direction !== 'ltr' || paragraph.textIndent !== 0 || paragraph.textAlign !== 'start' || paragraph.whiteSpace !== 'normal' || paragraph.overflowWrap !== 'break-word' || paragraph.wordBreak !== 'normal') return { kind: 'unsupported', reason: 'policy omitted by the direct single-word control' }
  const text = paragraph.content[0]!.text
  if (!/^[A-Za-z]+$/.test(text)) return { kind: 'unsupported', reason: 'space, Unicode or control rules omitted by the direct single-word control' }
  if (paragraph.font.facts.fonts !== undefined) return { kind: 'unsupported', reason: 'declared per-font coverage and glyph-cluster facts need separate direct-path interpretation' }
  if (text.length > 0x7ffffffe) return { kind: 'unsupported', reason: 'numeric-owner offset array length exceeds its supported range' }

  const canvases = createContextPool()
  const learned = withLearnedFontFacts(paragraph, blinkFontChecks(env, false), canvases)
  // stylesOf has a private block constructor. Reuse its real one-leaf content
  // index (one leaf/event, no elements or per-unit arrays) instead of copying
  // keyword resolution, optical-size defaults or language/style construction.
  const style = stylesOf(learned, indexContent(learned), env.devicePixelRatio).styles[0]!
  const contexts = styleContexts(canvases, style, env.devicePixelRatio, '8bit')

  // The measure16 corrections are identically zero for this subset: ASCII
  // letters have no joining/script edges, word-spacing characters, default
  // ignorables, Han trim or difference in Latin letter-spacing eligibility.
  // Measurement font, effective-size scaling, language, rendering, kerning,
  // spacing and 8-bit storage still come from the original Blink producers.
  const letters16 = new Float64Array(52).fill(NaN)
  const pairSeen = new Uint8Array(Math.ceil(52 * 52 / 8))
  const positions = new Int32Array(text.length + 1)
  let prefix16 = 0, previousCode = -1, previousIndex = -1, previousWidth16 = 0
  let distinctLetters = 0, distinctPairs = 0, nonzeroPairs = 0
  for (let k = 0; k < text.length; k++) {
    const code = text.charCodeAt(k), index = letterIndex(code)
    let width16 = letters16[index]!
    if (Number.isNaN(width16)) {
      width16 = raw16Of(contexts, contexts.ltr, String.fromCharCode(code))
      letters16[index] = width16; distinctLetters++
    }
    if (k > 0) {
      const pair = previousIndex * 52 + index, byte = pair >>> 3, bit = 1 << (pair & 7)
      if ((pairSeen[byte]! & bit) === 0) {
        pairSeen[byte] = pairSeen[byte]! | bit
        const pair16 = raw16Of(contexts, contexts.ltr, String.fromCharCode(previousCode, code)) - previousWidth16 - width16
        distinctPairs++; if (pair16 !== 0) nonzeroPairs++
      }
    }
    prefix16 += width16
    positions[k + 1] = ceilFrom16(prefix16)
    previousCode = code; previousIndex = index; previousWidth16 = width16
  }
  const whole16 = raw16Of(contexts, contexts.ltr, oneByteAsciiSpelling(text))
  const diagnostics: DirectWordDiagnostics = { sourceUtf16: text.length, distinctLetters, distinctPairs, nonzeroPairs,
    localMeasurements: distinctLetters + distinctPairs, localSubmittedUtf16: distinctLetters + 2 * distinctPairs,
    wholeResidual16: whole16 - prefix16 }
  if (nonzeroPairs !== 0) return { kind: 'unsupported', reason: 'nonzero pair placement and edge behavior omitted by the direct zero-pair control', diagnostics }
  if (whole16 !== prefix16) return { kind: 'unsupported', reason: 'whole measured advance differs from local sums; contextual behavior or float arithmetic needs another representation', diagnostics }
  const totalPx = widthOf16(prefix16)
  positions[text.length] = luCeil(totalPx)
  if (!Number.isFinite(totalPx) || Math.abs(totalPx) >= LU_MAX / 64 || positions.some(value => value === LU_MIN || value === LU_MAX)) return { kind: 'unsupported', reason: 'saturated prepared positions require separate overflow validation', diagnostics }
  if (totalPx > 0 && positions.some((value, k) => k > 0 && value < positions[k - 1]!)) return { kind: 'unsupported', reason: 'non-monotone positive-width positions need another numeric search', diagnostics }
  return { kind: 'numeric-word', value: { positions, totalPx, zoom: env.devicePixelRatio }, diagnostics }
}

export { countPreparedWord } from './exact-count.js'
