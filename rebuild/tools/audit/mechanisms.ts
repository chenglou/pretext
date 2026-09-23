// The mechanism a Canvas question belongs to, read from the chain of rebuild/src functions on its stack, innermost first
// ("name@file"). The labels are the audit's rows (research/REQUIREMENTS-AUDIT.md); the ids in brackets are
// research/RECIPE-COSTS.md's where one exists.
export function mechanismOf(browser: string, chain: readonly string[]): string {
  const names = chain.map(n => n.split('@')[0]!)
  const has = (name: string): boolean => names.includes(name)
  const before = (inner: string, outer: string): boolean => { const a = names.indexOf(inner); const b = names.indexOf(outer); return a >= 0 && b >= 0 && a < b }
  if (has('withLearnedFontFacts') || has('withLearnedFactsIn')) {
    if (has('primaryFamily')) return 'font check: primary family (S1)'
    if (has('fixedPitch')) return 'font check: fixed pitch (S3)'
    if (has('joining')) return 'font check: joining technology (S5)'
    if (has('scalesLinearly')) return 'font check: optical size (S4)'
    return 'font check: hyphen glyph (S2)'
  }
  switch (browser) {
    case 'chrome': return blink(names, has, before)
    case 'firefox': return gecko(names, has)
    default: return webkit(names, has)
  }
}

function blink(names: readonly string[], has: (n: string) => boolean, before: (a: string, b: string) => boolean): string {
  if (has('canvasSplitsWords')) return 'probe: Canvas shapes word by word (B12)'
  if (has('measureHanKerningFontData') || has('reshapeHanKerningEnd') && has('trim16')) return 'HanKerning font data and trims (B11)'
  if (has('shapeHyphen')) return 'hyphen string (B14)'
  if (has('safeToBreak')) return 'fill: safe-to-break test (B4)'
  if (has('reshape') || has('reshapeHanKerningEnd')) return 'fill: line-edge reshape (B5)'
  if (has('groupPrefix16')) {
    const phase = has('offsetForPosition') ? 'break search' : has('floatWidthOfParts') ? 'line width float sum' : has('positionForOffset') ? 'position of a break' : 'item edges'
    if (before('windowAdjust16', 'groupPrefix16') || before('measuredAdjust16', 'groupPrefix16')) return `position: wide window before a space (B3), ${phase}`
    if (before('pairAdjust16', 'groupPrefix16')) return `position: pair adjustment (B3), ${phase}`
    return `position: prefix from the last cut (B2), ${phase}`
  }
  if (has('measureGroups')) {
    if (has('passesSafeTest')) return before('windowAdjust16', 'passesSafeTest') ? 'cut search: safe test, wide window (B1)' : 'cut search: safe test, pair window (B1)'
    if (has('addPieces')) return 'cut search: group and piece totals (B0/B1)'
    return 'cut search: adjustment at each cut (B3 at cuts)'
  }
  void names
  return 'blink: other'
}

function gecko(names: readonly string[], has: (n: string) => boolean): string {
  const inScan = has('scanOffset')
  const where = inScan ? 'candidate scan' : 'advance'
  if (has('prepareGecko')) {
    if (has('rangeAu')) return 'prep: unit width in script context (G9)'
    if (names[1] === 'auIn' || names[0] === 'bounds') return 'prep: emoji and synthesized space (G7, G8)'
    return 'prep: unit, space, tab and hyphen widths (G0)'
  }
  if (has('windowsOf')) return `in-word: windows in long units, ${where}`
  if (has('ligatureAcross')) return `in-word: ligature test by ink box (G2), ${where}`
  if (has('groupAcross') || has('groupsIn')) return `in-word: ligature groups by letter spacing (G3), ${where}`
  if (has('pairKernedShare') || has('askedPlacement') || has('sameFace') || has('largeContext')) return `in-word: pair placement by rounding (G4), ${where}`
  if (has('rangeAu')) return `in-word: script context (G9), ${where}`
  if (has('suffixAlone')) return `in-word: suffix (G1a), ${where}`
  if (has('sidesAdvance') || has('inWordAdvance')) return `in-word: crossing cluster and prefix (G1b), ${where}`
  return `gecko: other (${names.slice(1, 3).join('<')})`
}

function webkit(names: readonly string[], has: (n: string) => boolean): string {
  if (has('makeBox')) return 'box: family and coverage probes (W1a, W1b)'
  if (has('mergedGlyphs')) return 'merged glyphs under letter spacing (W2)'
  if (has('controlIsAdjusted') || has('measureDomString')) return 'VT, FF and CR (W3)'
  if (has('applyShapingOnRunRange')) return 'RTL shaping across inline boxes (W6)'
  if (has('breakWord')) return 'mid-word break probes (W7)'
  if (has('fixedPitchWidth')) return 'fixed-pitch width shortcut'
  if (has('lineHyphenWidth')) return 'hyphen width'
  if (has('handleTrailingTrimmableContent')) return 'fill: trailing trimmable content'
  if (has('computeItemWidths')) return 'items: whitespace and range widths (W0)'
  if (has('handleTextContent')) return 'items: word widths (W0)'
  return `webkit: other (${names.slice(1, 3).join('<')})`
}
