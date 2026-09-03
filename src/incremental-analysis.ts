import { analyzeText, type AnalysisProfile, type TextAnalysis, type WhiteSpaceMode, type WordBreakMode } from './analysis.js'

const plainBoundary = /^[ \t\n]+$/
const baseCharacter = /^[\p{L}\p{Nd}]/u

// Restart at an unchanged base character after a plain whitespace segment.
// Keep the entire following run: URL queries, quotes, numeric glue and grapheme
// tails can have unbounded length. A mark attached to whitespace is not a seam.
export function analyzeIncrementally(
  previous: TextAnalysis | null,
  normalized: string,
  profile: AnalysisProfile,
  whiteSpace: WhiteSpaceMode,
  wordBreak: WordBreakMode,
): TextAnalysis {
  if (previous === null) return analyzeText(normalized, profile, whiteSpace, wordBreak)
  if (previous.normalized === normalized) return previous

  const limit = Math.min(previous.normalized.length, normalized.length)
  let common = 0
  while (common < limit && previous.normalized.charCodeAt(common) === normalized.charCodeAt(common)) common++

  let restartIndex = 0
  for (let i = 1; i < previous.len; i++) {
    const start = previous.starts[i]!
    if (start >= common) break
    const kind = previous.kinds[i - 1]!
    if (kind !== 'space' && kind !== 'preserved-space' && kind !== 'tab' && kind !== 'hard-break') continue
    if (!plainBoundary.test(previous.texts[i - 1]!) || !baseCharacter.test(previous.texts[i]!)) continue
    const first = previous.texts[i]!.codePointAt(0)!
    if (start + (first > 0xFFFF ? 2 : 1) <= common) restartIndex = i
  }
  if (restartIndex === 0) return analyzeText(normalized, profile, whiteSpace, wordBreak)

  const restart = previous.starts[restartIndex]!
  const tail = analyzeText(normalized.slice(restart), profile, whiteSpace, wordBreak)
  return {
    normalized,
    len: restartIndex + tail.len,
    texts: previous.texts.slice(0, restartIndex).concat(tail.texts),
    isWordLike: previous.isWordLike.slice(0, restartIndex).concat(tail.isWordLike),
    kinds: previous.kinds.slice(0, restartIndex).concat(tail.kinds),
    starts: previous.starts.slice(0, restartIndex).concat(tail.starts.map(start => start + restart)),
  }
}
