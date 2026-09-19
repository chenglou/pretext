// What a line painted alone needs in Gecko (Firefox 156.0) that the painter's shared forms don't give (paint.ts
// PaintRules; DESIGN.md §7): a text run that doesn't end with the line where the paragraph's went on, and Gecko's limits.
// Gecko's rules read nothing of a line beside its pieces (GeckoPaintFacts).
import type { LineEdges, PaintLine, PaintRules, PaintedContent, PainterLimit } from '../../paint.js'
import { geckoBidiData, geckoGraphemeRules } from './data.js'
import type { GeckoPaintFacts } from './pieces.js'

// Gecko's limits (paint.ts PainterLimitName has each condition's source reading).
function limits(_content: PaintedContent, line: PaintLine<GeckoPaintFacts>, edges: LineEdges): PainterLimit[] {
  const { last, endInLeaf, startInWord, endInWord, softEnd, leadingScript } = edges
  const out: PainterLimit[] = []
  // Gecko keeps the glyphs of the word it shaped whole, so any pair adjustment across the cut counts.
  if (startInWord || endInWord) {
    out.push({ limit: 'edge-inside-shaped-text', detail: `the line ${startInWord ? (endInWord ? 'starts and ends' : 'starts') : 'ends'} between two characters of one leaf that aren't white space` })
  }
  if (leadingScript !== null) {
    out.push({ limit: 'script-at-line-start', detail: `characters of the line continued a script run of the text before it (${leadingScript})` })
  }
  if (edges.spacingAtRunEnd) out.push({ limit: 'spacing-at-run-end', detail: "the line's last character is its text run's last when painted and takes letter spacing" })
  if (last.kind === 'trimmed' && endInLeaf && softEnd && (line.pieces.align === 'justify' || /\u3000/.test(last.painted))) {
    out.push({ limit: 'frame-ended-at-break', detail: line.pieces.align === 'justify' ? 'the trimmed space was a justification opportunity of the paragraph' : 'U+3000 is trimmed only where the text frame breaks inside itself' })
  }
  return out
}

export const geckoPaintRules: PaintRules<GeckoPaintFacts> = {
  bidi: geckoBidiData,
  graphemes: geckoGraphemeRules,
  // Gecko draws the hyphen from its own text run (nsTextFrame.cpp:7963-7984); an isolate ends the text run
  // (nsTextFrame.cpp:2091-2096).
  hyphenSpan: 'isolated',
  textNodesKeepLeafStorage: false,
  // Gecko builds its own text from the node's, where a collapsible tab or newline is a space already.
  paintsSourceWhiteSpace: false,
  resolvesTrailingSpaceDirection: false,
  // Gecko's trailing white space has no line-end rule for its level, so a trimmed space the paragraph kept at another
  // level than the base level is reset like any other character.
  trimmedSpaceAtEnd: { takesBox: 'where-reset' },
  noBreakBeforeBoxAfter: null,
  lineEndWrapping: 'block',
  // Hanging white space stays in the node of the text before it, as one text frame.
  hangingForm: () => 'same-node',
  // CanAddSpacingAfter (nsTextFrame.cpp:3860-3873; paint.ts planLine's continuation).
  spacingAfterRunEnd: true,
  // The painter reads the Script property of the line's first characters itself, for the limit alone: U+061C changes no
  // width in Firefox, where Gecko's cursive exemption reads each character's own script (nsTextFrame.cpp:4209-4213).
  lineStartScript: { form: 'limit-only' },
  trimsAtLineEnd: null,
  controlsBetweenPieces: null,
  limits,
}
