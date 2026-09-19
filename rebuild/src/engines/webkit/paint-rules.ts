// What a line painted alone needs in WebKit (Safari 27.0) that the painter's shared forms don't give (paint.ts
// PaintRules; DESIGN.md §7): text nodes that keep what WebKit's layout reads of the paragraph's nodes, and WebKit's
// limits. The painter hands a line's WebKitPaintFacts back to these rules unread.
import type { ContentIndex } from '../../content.js'
import type { FontDecl, Paragraph } from '../../model.js'
import type { LineEdges, PaintLine, PaintRules, PainterLimit } from '../../paint.js'
import { webkitBidiData, webkitGraphemeRules } from './data.js'
import type { WebKitPaintFacts } from './output.js'

// WebKit's limits (paint.ts PainterLimitName has each condition's source reading).
function limits(content: { paragraph: Paragraph; index: ContentIndex<FontDecl> }, line: PaintLine<WebKitPaintFacts>, edges: LineEdges): PainterLimit[] {
  const { last, startInWord, endInWord } = edges
  const { carriedWidth, shapedAcrossBoxes } = line.pieces.facts
  const out: PainterLimit[] = []
  // A line that starts inside an item (InlineItemPosition's offset) took the width the breaker carried. A whole item
  // that wrapped carries its width too, which is the width the painted line measures again (output.ts linePieces).
  if (carriedWidth !== null) out.push({ limit: 'carried-width', detail: `the line's first text keeps the carried width ${carriedWidth}` })
  // Apart from a carried width, WebKit measures a part of an item as the painted box measures its text: the range
  // alone (TextUtil::width over a substring). The exception is an RTL run it shaped across inline boxes.
  if (shapedAcrossBoxes && (startInWord || endInWord)) {
    out.push({ limit: 'edge-inside-shaped-text', detail: 'the line cuts an RTL run that WebKit shaped across inline boxes' })
  }
  const leaf = content.index.leaves[last.run]!
  if (last.kind === 'text' && !/\s$/u.test(last.painted) && last.end < leaf.start + leaf.text.length && content.index.text.charCodeAt(last.end) === 0x20) {
    out.push({ limit: 'word-measured-with-next-space', detail: 'the space after the last word is not on the line' })
  }
  return out
}

export const webkitPaintRules: PaintRules<WebKitPaintFacts> = {
  bidi: webkitBidiData,
  graphemes: webkitGraphemeRules,
  // Layout measures the hyphen alone and paint shapes it with the word before it, so the width matches and the ink
  // keeps any kerning (specs/painter.md L3).
  hyphenSpan: 'plain',
  // WebKit's layout reads a text node's string storage, 8-bit or 16-bit (the port's is8Bit; paint.ts textNode).
  textNodesKeepLeafStorage: true,
  // A word is measured together with the character after it only where that is U+0020 (TextUtil::width's
  // extendedMeasuring, TextUtil.cpp:76-81; paint.ts lineTokens' paintedText).
  paintsSourceWhiteSpace: true,
  resolvesTrailingSpaceDirection: false,
  // A space reset to the base level becomes a run of its own, which the line's end removes whole with its plain width,
  // where the paragraph took the space's width inside its run (in an RTL box the width of the word with the space less the
  // word's, Line::Run::removeTrailingWhitespace, InlineLine.cpp:963-987; c-27daf54faef90b34).
  trimmedSpaceAtEnd: { takesBox: 'where-reset' },
  // WebKit breaks between any text and an atomic inline (isAtSoftWrapOpportunity, InlineFormattingUtils.cpp:385-437).
  noBreakBeforeBoxAfter: null,
  // The box holding the line's last character moved the fit decision of a line at its threshold (c-a98e884c6f665a5d,
  // not traced), so the block's own white-space decides.
  lineEndWrapping: 'block',
  // Hanging white space stays in the node of the text before it, which WebKit measures with it.
  hangingForm: () => 'same-node',
  spacingAfterRunEnd: false,
  lineStartScript: { form: 'none' },
  trimsAtLineEnd: null,
  controlsBetweenPieces: null,
  limits,
}
