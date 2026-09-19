// text-align: justify in WebKit (Safari 27.0): expansion opportunities and their distribution over a line's runs
// (platform/graphics/FontCascade.cpp:974-1303, FontCascadeInlines.h:140-143, cocoa/FontCascadeCocoaInlines.h:34-37;
// layout/formattingContexts/inline/InlineContentAligner.cpp:150-267).

import type { ExpansionBehavior, LineRun, WebKitBox } from './types.js'

const f32 = Math.fround

// FontCascade::treatAsSpace (FontCascadeInlines.h:140-143).
function treatAsSpace(c: number): boolean {
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
function isCJKIdeographOrSymbol(c: number): boolean {
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
function expansionOpportunityCount(text: string, rtl: boolean, behavior: ExpansionBehavior): { count: number; isAfterExpansion: boolean } {
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

// InlineContentAligner::applyTextAlignJustify with computedExpansions and applyExpansionOnRange
// (InlineContentAligner.cpp:150-267), without ruby, over the line's runs: returns the width the content grew by. The last
// text run's hanging trailing white space, `hangingLength` units, counts no opportunity.
export function applyTextAlignJustify(boxes: readonly WebKitBox[], runs: LineRun[], hangingLength: number, spaceToDistribute: number): number {
  if (runs.length === 0 || spaceToDistribute <= 0) return 0
  let lastTextRun = -1
  for (let i = 0; i < runs.length; i++) if (runs[i]!.kind === 'text') lastTextRun = i
  const opportunities: number[] = []
  let opportunityCount = 0
  let lastExpansionIndexWithContent: number | null = null
  // Line start behaves as if we had an expansion here.
  let runIsAfterExpansion = true
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index]!
    let inRun = 0
    switch (run.kind) {
      case 'text': {
        const length = index === lastTextRun ? Math.max(0, run.textLength - hangingLength) : run.textLength
        run.expansionBehavior = { left: runIsAfterExpansion ? 'forbid' : 'allow', right: 'allow' }
        const counted = expansionOpportunityCount(boxes[run.box]!.text.slice(run.textStart, run.textStart + length), run.level % 2 === 1 && run.level <= 125, run.expansionBehavior)
        inRun = counted.count
        runIsAfterExpansion = counted.isAfterExpansion
        lastExpansionIndexWithContent = index
        break
      }
      case 'atomic':
        runIsAfterExpansion = false
        lastExpansionIndexWithContent = index
        break
      case 'soft-line-break':
      case 'hard-line-break':
      case 'word-break-opportunity':
      case 'inline-box-start':
      case 'inline-box-end':
      case 'spanning-inline-box-start':
        break
    }
    opportunities.push(inRun)
    opportunityCount += inRun
  }
  // Forbid right expansion in the last run to prevent trailing expansion at the end of the line.
  if (lastExpansionIndexWithContent !== null) {
    const last = runs[lastExpansionIndexWithContent]!
    if (last.kind === 'text' && opportunities[lastExpansionIndexWithContent]! > 0) {
      last.expansionBehavior.right = 'forbid'
      if (runIsAfterExpansion) {
        opportunityCount--
        opportunities[lastExpansionIndexWithContent]!--
      }
    }
  }
  if (opportunityCount === 0) return 0
  const expansionToDistribute = f32(spaceToDistribute / opportunityCount)
  let accumulatedExpansion = 0
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index]!
    run.left = f32(run.left + accumulatedExpansion)
    const computedExpansion = f32(expansionToDistribute * opportunities[index]!)
    if (run.kind === 'text') run.expansion = computedExpansion
    run.width = f32(run.width + computedExpansion)
    accumulatedExpansion = f32(accumulatedExpansion + computedExpansion)
  }
  return accumulatedExpansion
}
