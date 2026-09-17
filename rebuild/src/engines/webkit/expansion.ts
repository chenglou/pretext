// text-align: justify in WebKit (Safari 27.0): expansion opportunities and their distribution over a line's runs
// (platform/graphics/FontCascade.cpp:974-1303, FontCascadeInlines.h:140-143, cocoa/FontCascadeCocoaInlines.h:34-37;
// layout/formattingContexts/inline/InlineContentAligner.cpp:150-267).

const f32 = Math.fround

export type ExpansionSide = 'allow' | 'forbid'
export type ExpansionBehavior = { left: ExpansionSide; right: ExpansionSide }

// FontCascade::treatAsSpace (FontCascadeInlines.h:140-143).
export function treatAsSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0xa0
}

// FontCascade::isCJKIdeograph (FontCascade.cpp:974-1037).
function isCJKIdeograph(c: number): boolean {
  return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x2e80 && c <= 0x2eff) || (c >= 0x2f00 && c <= 0x2fdf)
    || (c >= 0x31c0 && c <= 0x31ef) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0x20000 && c <= 0x2a6df) || (c >= 0x2a700 && c <= 0x2b73f)
    || (c >= 0x2b740 && c <= 0x2b81f) || (c >= 0x2b820 && c <= 0x2ceaf) || (c >= 0x2ceb0 && c <= 0x2ebef) || (c >= 0x2ebf0 && c <= 0x2ee5f)
    || (c >= 0x2f800 && c <= 0x2fa1f) || (c >= 0x30000 && c <= 0x3134f) || (c >= 0x31350 && c <= 0x323af)
}

const CJK_SYMBOLS = new Set([
  0x2c7, 0x2ca, 0x2cb, 0x2d9, 0x2ea, 0x2eb,
  0x2020, 0x2021, 0x2030, 0x203b, 0x203c, 0x2042, 0x2047, 0x2048, 0x2049, 0x2051, 0x20dd, 0x20de, 0x2100, 0x2103, 0x2105,
  0x2109, 0x210a, 0x2113, 0x2116, 0x2121, 0x212b, 0x213b, 0x2150, 0x2151, 0x2152,
  0x217f, 0x2189, 0x2307, 0x2312, 0x23be, 0x23bf, 0x23ce, 0x2423,
  0x25a0, 0x25a1, 0x25a2, 0x25aa, 0x25ab, 0x25b1, 0x25b2, 0x25b3, 0x25b6, 0x25b7, 0x25bc, 0x25bd,
  0x25c0, 0x25c1, 0x25c6, 0x25c7, 0x25c9, 0x25cb, 0x25cc, 0x25ef,
  0x2605, 0x2606, 0x260e, 0x2616, 0x2617, 0x2640, 0x2642,
  0x26a0, 0x26bd, 0x26be, 0x2713, 0x271a, 0x273f, 0x2740, 0x2756, 0x2b1a,
  0xfe10, 0xfe11, 0xfe12, 0xfe19, 0x1f100,
])

// FontCascade::isCJKIdeographOrSymbol (FontCascade.cpp:1039-1196), in the source's order.
export function isCJKIdeographOrSymbol(c: number): boolean {
  if (CJK_SYMBOLS.has(c)) return true
  if ((c >= 0x2156 && c <= 0x215a) || (c >= 0x2160 && c <= 0x216b) || (c >= 0x2170 && c <= 0x217b) || (c >= 0x23c0 && c <= 0x23cc)) return true
  if ((c >= 0x2460 && c <= 0x2492) || (c >= 0x249c && c <= 0x24ff) || (c >= 0x25ce && c <= 0x25d3) || (c >= 0x25e2 && c <= 0x25e6)) return true
  if ((c >= 0x2600 && c <= 0x2603) || (c >= 0x2660 && c <= 0x266f) || (c >= 0x2672 && c <= 0x267d) || (c >= 0x2776 && c <= 0x277f)) return true
  if (c >= 0x2ff0 && c <= 0x2fff) return true
  if ((c >= 0x3000 && c < 0x3030) || (c > 0x3030 && c <= 0x303f)) return true
  if ((c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff) || (c >= 0x3100 && c <= 0x312f) || (c >= 0x3190 && c <= 0x319f) || (c >= 0x31a0 && c <= 0x31bf)) return true
  if ((c >= 0x3200 && c <= 0x32ff) || (c >= 0x3300 && c <= 0x33ff) || (c >= 0xf860 && c <= 0xf862) || (c >= 0xfe30 && c <= 0xfe4f)) return true
  if (c === 0xff0d || c === 0xff1b || c === 0xff1c || c === 0xff1e) return false
  if (c >= 0xff00 && c <= 0xffef) return true
  if ((c >= 0x1f110 && c <= 0x1f129) || (c >= 0x1f130 && c <= 0x1f149) || (c >= 0x1f150 && c <= 0x1f169) || (c >= 0x1f170 && c <= 0x1f189) || (c >= 0x1f200 && c <= 0x1f6c5)) return true
  return isCJKIdeograph(c)
}

// FontCascade::expansionOpportunityCountInternal (FontCascade.cpp:1198-1292) with canExpandAroundIdeographsInComplexText
// true on Cocoa (cocoa/FontCascadeCocoaInlines.h:34-37). 8-bit text holds no ideograph, so one loop over code points covers
// both overloads. Returns the count and whether the text ends after an expansion.
export function expansionOpportunityCount(text: string, rtl: boolean, behavior: ExpansionBehavior): { count: number; isAfterExpansion: boolean } {
  let count = 0
  let isAfterExpansion = behavior.left === 'forbid'
  const codePoints: number[] = []
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!
    if (cp > 0xffff) i++
    codePoints.push(cp)
  }
  if (rtl) codePoints.reverse()
  for (let k = 0; k < codePoints.length; k++) {
    const c = codePoints[k]!
    if (treatAsSpace(c)) {
      count++
      isAfterExpansion = true
      continue
    }
    if (isCJKIdeographOrSymbol(c)) {
      if (!isAfterExpansion) count++
      count++
      isAfterExpansion = true
      continue
    }
    isAfterExpansion = false
  }
  if (isAfterExpansion && behavior.right === 'forbid' && count > 0) {
    count--
    isAfterExpansion = false
  }
  return { count, isAfterExpansion }
}

// The run shape the aligner reads.
export type ExpandableRun = {
  kind: string
  text: string
  rtl: boolean
  left: number
  width: number
  expansion: number
  expansionBehavior: ExpansionBehavior
}

// InlineContentAligner::applyTextAlignJustify with computedExpansions and applyExpansionOnRange
// (InlineContentAligner.cpp:150-267), without ruby: returns the width the content grew by. `text` of the last text run
// already leaves out hanging trailing white space, which counts no opportunity.
export function applyTextAlignJustify(runs: ExpandableRun[], spaceToDistribute: number): number {
  if (runs.length === 0 || spaceToDistribute <= 0) return 0
  const opportunities: number[] = []
  let opportunityCount = 0
  let lastExpansionIndexWithContent: number | null = null
  // Line start behaves as if we had an expansion here.
  let runIsAfterExpansion = true
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index]!
    let behavior: ExpansionBehavior = { left: 'allow', right: 'allow' }
    let inRun = 0
    if (run.kind === 'text') {
      behavior = { left: runIsAfterExpansion ? 'forbid' : 'allow', right: 'allow' }
      const counted = expansionOpportunityCount(run.text, run.rtl, behavior)
      inRun = counted.count
      runIsAfterExpansion = counted.isAfterExpansion
    } else if (run.kind === 'atomic') {
      runIsAfterExpansion = false
    }
    run.expansionBehavior = behavior
    opportunities.push(inRun)
    opportunityCount += inRun
    if (run.kind === 'text' || run.kind === 'atomic') lastExpansionIndexWithContent = index
  }
  // Forbid right expansion in the last run to prevent trailing expansion at the end of the line.
  if (lastExpansionIndexWithContent !== null && opportunities[lastExpansionIndexWithContent]! > 0) {
    runs[lastExpansionIndexWithContent]!.expansionBehavior.right = 'forbid'
    if (runIsAfterExpansion) {
      opportunityCount--
      opportunities[lastExpansionIndexWithContent]!--
    }
  }
  if (opportunityCount === 0) return 0
  const expansionToDistribute = f32(spaceToDistribute / opportunityCount)
  let accumulatedExpansion = 0
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index]!
    run.left = f32(run.left + accumulatedExpansion)
    const computedExpansion = f32(expansionToDistribute * opportunities[index]!)
    run.expansion = computedExpansion
    run.width = f32(run.width + computedExpansion)
    accumulatedExpansion = f32(accumulatedExpansion + computedExpansion)
  }
  return accumulatedExpansion
}

// How ComplexTextController::adjustGlyphsAndAdvances hands a run's expansion to its glyphs (ComplexTextController.cpp:698-845
// with expansionLocation :673-696), assuming one glyph per code point in string order: per UTF-16 offset of `text`, how many
// expansion opportunities that code point's advance holds. Glyphs are visited in visual order; an expansion on the left
// grows the glyph visited before, and the run's first glyph grows its own advance.
export function expansionShares(text: string, rtl: boolean, behavior: ExpansionBehavior): number[] {
  const shares: number[] = new Array<number>(text.length).fill(0)
  const starts: number[] = []
  for (let i = 0; i < text.length; i++) {
    starts.push(i)
    if (text.codePointAt(i)! > 0xffff) i++
  }
  const order = rtl ? [...starts].reverse() : starts
  let afterExpansion = behavior.left === 'forbid'
  let previous: number | null = null
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!
    const c = text.codePointAt(i)!
    const isFirstCharacter = i === 0
    const isLastCharacter = i + (c > 0xffff ? 2 : 1) === text.length
    const forbidLeft = behavior.left === 'forbid' && (rtl ? isLastCharacter : isFirstCharacter)
    const forbidRight = behavior.right === 'forbid' && (rtl ? isFirstCharacter : isLastCharacter)
    const space = treatAsSpace(c)
    const ideograph = isCJKIdeographOrSymbol(c)
    if (space || ideograph) {
      let expandLeft = ideograph
      let expandRight = ideograph
      if (space) {
        if (rtl) expandLeft = true
        else expandRight = true
      }
      if (afterExpansion) expandLeft = false
      if (forbidLeft) expandLeft = false
      if (forbidRight) expandRight = false
      if (expandLeft) shares[previous ?? i]!++
      if (expandRight) {
        shares[i]!++
        afterExpansion = true
      }
    } else {
      afterExpansion = false
    }
    previous = i
  }
  return shares
}
