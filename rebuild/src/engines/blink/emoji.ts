// RunSegmenter's font fallback priority runs (run_segmenter.cc:46-72): SymbolsIterator (symbols_iterator.cc:20-77) scans
// the text with the emoji segmenter's grammar (third_party/emoji-segmenter emoji_presentation_scanner.rl at Chrome 153's
// pin; categories from emoji_segmentation_category_inline_header.h:15-77) and joins neighbouring tokens of one kind. A
// change of priority ends a segment like a change of script, and HarfBuzzShaper shapes every segment in its own call
// (harfbuzz_shaper.cc:1080-1101), so nothing reaches across it: no kern, no ligature, and no HarfBuzz continuation, which
// only merges into a cluster of its own buffer (hb_form_clusters, hb-ot-shape.cc:578-586). `👩` ZWJ SHY is an emoji token,
// then text: natively the ZWJ is a zero-width cluster of its own after the emoji (suite/woman-after-zwj).
import { isEmoji, isEmojiModifierBase, isEmojiPresentation, isExtendedPictographic, isUnassigned } from './props.js'
import type { BlinkPrepared } from './types.js'

// FontFallbackPriority values the iterator gives (font_fallback_priority.h).
export const PRIORITY_TEXT = 0
export const PRIORITY_EMOJI_TEXT_WITH_VS = 1
export const PRIORITY_EMOJI_EMOJI = 2
export const PRIORITY_EMOJI_EMOJI_WITH_VS = 3

// EmojiSegmentationCategory (emoji_segmentation_category.h).
const EMOJI = 0, EMOJI_TEXT = 1, EMOJI_EMOJI = 2, MODIFIER_BASE = 3, MODIFIER = 4, REGIONAL = 6, KEYCAP_BASE = 7, KEYCAP = 8,
  CIRCLE_BACKSLASH = 9, ZWJ = 10, VS15 = 11, VS16 = 12, TAG_BASE = 13, TAG_SEQUENCE = 14, TAG_TERM = 15, OTHER = 16

// GetEmojiSegmentationCategory (emoji_segmentation_category_inline_header.h:15-77).
function category(cp: number): number {
  if (cp <= 0x7f) return (cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a ? KEYCAP_BASE : OTHER
  if (cp === 0x20e3) return KEYCAP
  if (cp === 0x20e0) return CIRCLE_BACKSLASH
  if (cp === 0x200d) return ZWJ
  if (cp === 0xfe0e) return VS15
  if (cp === 0xfe0f) return VS16
  if (cp === 0x1f3f4) return TAG_BASE
  // Character::IsEmojiTagSequence: tag digits and tag small letters (character.cc:234-239).
  if ((cp >= 0xe0030 && cp <= 0xe0039) || (cp >= 0xe0061 && cp <= 0xe007a)) return TAG_SEQUENCE
  if (cp === 0xe007f) return TAG_TERM
  if (isEmojiModifierBase(cp)) return MODIFIER_BASE
  if (cp >= 0x1f3fb && cp <= 0x1f3ff) return MODIFIER
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return REGIONAL
  if (isEmojiPresentation(cp)) return EMOJI_EMOJI
  if (isEmoji(cp)) return EMOJI_TEXT
  // Character::IsEmojiIncludingReserved: also unassigned Extended_Pictographic code points (character_emoji.cc:337-347).
  if (isUnassigned(cp) && isExtendedPictographic(cp)) return EMOJI
  return OTHER
}

function anyEmoji(c: number): boolean {
  return c === EMOJI_TEXT || c === EMOJI_EMOJI || c === KEYCAP_BASE || c === MODIFIER_BASE || c === TAG_BASE || c === EMOJI
}

// emoji_zwj_element at i: the lengths it can take, longest first.
function zwjElements(cats: number[], i: number): number[] {
  const out: number[] = []
  if (i >= cats.length || !anyEmoji(cats[i]!)) return out
  if (cats[i + 1] === VS16 || (cats[i] === MODIFIER_BASE && cats[i + 1] === MODIFIER)) out.push(2)
  out.push(1)
  return out
}

// The longest emoji_zwj_sequence at i: an element, then ZWJ and an element at least once; 0 when none.
function zwjSequence(cats: number[], i: number): number {
  let best = 0
  const walk = (at: number, elements: number): void => {
    const options = zwjElements(cats, at)
    for (let o = 0; o < options.length; o++) {
      const end = at + options[o]!
      if (elements >= 1 && end - i > best) best = end - i
      if (cats[end] === ZWJ) walk(end + 1, elements + 1)
    }
  }
  walk(i, 0)
  return best
}

// The token at i: its length in code points and its kind. Ragel's scanner takes the longest match, and the first
// alternative listed among equals: text_emoji_run_with_vs, emoji_run_with_vs, emoji_run, text_run.
function token(cats: number[], i: number): { length: number; priority: number } {
  const c = cats[i]!
  let textVs = 0
  if (anyEmoji(c) && cats[i + 1] === VS15) textVs = c === KEYCAP_BASE && cats[i + 2] === KEYCAP ? 3 : 2
  let emojiVs = 0
  if (anyEmoji(c) && cats[i + 1] === VS16) emojiVs = c === KEYCAP_BASE && cats[i + 2] === KEYCAP ? 3 : 2
  let emoji = 0
  if (c === EMOJI_EMOJI || c === TAG_BASE || c === MODIFIER_BASE) emoji = 1
  if (emojiVs > emoji) emoji = emojiVs
  if (c === MODIFIER_BASE && cats[i + 1] === MODIFIER) emoji = Math.max(emoji, 2)
  if (c === REGIONAL && cats[i + 1] === REGIONAL) emoji = Math.max(emoji, 2)
  if (anyEmoji(c) && cats[i + 1] === CIRCLE_BACKSLASH) emoji = Math.max(emoji, 2)
  if (c === TAG_BASE && cats[i + 1] === TAG_SEQUENCE) {
    let j = i + 1
    while (cats[j] === TAG_SEQUENCE) j++
    if (cats[j] === TAG_TERM) emoji = Math.max(emoji, j + 1 - i)
  }
  emoji = Math.max(emoji, zwjSequence(cats, i))
  let length = 1
  let priority = PRIORITY_TEXT
  if (textVs >= length && textVs > 0) { length = textVs; priority = PRIORITY_EMOJI_TEXT_WITH_VS }
  if (emojiVs > length || (emojiVs === length && emojiVs > 0 && priority === PRIORITY_TEXT)) { length = emojiVs; priority = PRIORITY_EMOJI_EMOJI_WITH_VS }
  if (emoji > length || (emoji === length && emoji > 0 && priority === PRIORITY_TEXT)) { length = emoji; priority = PRIORITY_EMOJI_EMOJI }
  return { length, priority }
}

// The font fallback priority of every code unit of a 16-bit text.
export function emojiPriorities(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  let any = false
  for (let i = 0; i < text.length && !any; i++) if (text.charCodeAt(i) > 0x7f) any = true
  // Without a character above U+007F only keycap bases have a category, and no token forms without VS15, VS16 or another.
  if (!any) return out
  const cats: number[] = []
  const starts: number[] = []
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!
    cats.push(category(cp))
    starts.push(i)
    i += cp > 0xffff ? 2 : 1
  }
  starts.push(text.length)
  for (let i = 0; i < cats.length;) {
    const t = token(cats, i)
    if (t.priority !== PRIORITY_TEXT) out.fill(t.priority, starts[i]!, starts[i + t.length]!)
    i += t.length
  }
  return out
}

// Whether a RunSegmenter segment starts at text_content offset k: the script or the font fallback priority changes
// (run_segmenter.cc:46-72). HarfBuzzShaper shapes every segment in its own call (harfbuzz_shaper.cc:1080-1101).
export function isSegmentEdge(p: BlinkPrepared, k: number): boolean {
  if (!p.segmented || k <= 0 || k >= p.text.length || (p.text.charCodeAt(k) & 0xfc00) === 0xdc00) return false
  return p.scripts[k] !== p.scripts[k - 1] || p.priorities[k] !== p.priorities[k - 1]
}
