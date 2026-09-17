// The computed styles as WebKit reads them, the white-space predicates of TextUtil.cpp:424-448, and inline box geometry.
import type { BoxEdge, Paragraph, TextStyle } from '../../model.js'
import type { LineBreakMode, WebKitBoxEdges, WebKitStyle, WhiteSpaceCollapse } from './types.js'

const f32 = Math.fround

// A box's style from the model's computed text style; direction, text-align and text-indent are the block's, which every
// inline box inherits in the model.
export function webkitStyle(s: TextStyle, block: Paragraph, zoom: number): WebKitStyle {
  let collapse: WhiteSpaceCollapse
  let wrap: boolean
  switch (s.whiteSpace) {
    case 'normal': collapse = 'collapse'; wrap = true; break
    case 'nowrap': collapse = 'collapse'; wrap = false; break
    case 'pre': collapse = 'preserve'; wrap = false; break
    case 'pre-wrap': collapse = 'preserve'; wrap = true; break
    case 'pre-line': collapse = 'preserve-breaks'; wrap = true; break
    case 'break-spaces': collapse = 'break-spaces'; wrap = true; break
  }
  let lineBreakMode: LineBreakMode
  switch (s.lineBreak) {
    case 'auto':
    case 'anywhere': lineBreakMode = 'Default'; break
    case 'loose': lineBreakMode = 'Loose'; break
    case 'normal': lineBreakMode = 'Normal'; break
    case 'strict': lineBreakMode = 'Strict'; break
  }
  return {
    collapse, wrap, wordBreak: s.wordBreak, overflowWrap: s.overflowWrap, lineBreak: s.lineBreak, lineBreakMode,
    tabSize: s.tabSize, rtl: block.direction === 'rtl', wordSpacing: f32(f32(s.wordSpacing) * f32(zoom)),
    textAlign: block.textAlign, textIndent: block.textIndent,
  }
}

// LayoutUnit(float) (platform/LayoutUnit.h:76-78): the value times 64 in float, truncated. In px.
export function layoutUnit(px: number): number {
  return Math.trunc(f32(f32(px) * 64)) / 64
}

// snapLengthAsBorderWidth (StyleLineWidth.cpp:46-61) then LayoutUnit (:128-132). The model's border is a solid border of the
// declared width (a border-style of none would give 0, which the model doesn't offer).
function borderWidth(px: number, deviceScaleFactor: number): number {
  const length = f32(px)
  const dsf = f32(deviceScaleFactor)
  const singleDevicePixel = f32(1 / dsf)
  const snapped = length > 0 && length < singleDevicePixel ? singleDevicePixel : f32(Math.floor(f32(length * dsf)) / dsf)
  return layoutUnit(snapped)
}

// BoxGeometryUpdater::horizontalLogicalMargin, logicalBorder and logicalPadding (LayoutIntegrationBoxGeometryUpdater.cpp:231-306)
// for a span whose writing mode is horizontal: inline start and end in the paragraph's direction, at page zoom.
export function boxEdges(start: BoxEdge, end: BoxEdge, zoom: number, deviceScaleFactor: number): WebKitBoxEdges {
  const z = f32(zoom)
  return {
    marginStart: layoutUnit(f32(f32(start.margin) * z)), borderStart: borderWidth(f32(f32(start.border) * z), deviceScaleFactor), paddingStart: layoutUnit(f32(f32(start.padding) * z)),
    marginEnd: layoutUnit(f32(f32(end.margin) * z)), borderEnd: borderWidth(f32(f32(end.border) * z), deviceScaleFactor), paddingEnd: layoutUnit(f32(f32(end.padding) * z)),
  }
}

// BoxGeometry::marginBorderAndPaddingStart and End: LayoutUnit sums, as a float px value (InlineFormattingUtils.cpp:320-324).
export function startEdgeWidth(e: WebKitBoxEdges): number {
  return f32(e.marginStart + e.borderStart + e.paddingStart)
}

export function endEdgeWidth(e: WebKitBoxEdges): number {
  return f32(e.marginEnd + e.borderEnd + e.paddingEnd)
}

// TextUtil::shouldPreserveSpacesAndTabs
export function preservesSpacesAndTabs(s: WebKitStyle): boolean {
  return s.collapse === 'preserve' || s.collapse === 'break-spaces'
}

// TextUtil::shouldPreserveNewline
export function preservesNewline(s: WebKitStyle): boolean {
  return s.collapse !== 'collapse'
}

// ComputedStyle::collapseWhiteSpace (StyleComputedStyle+GettersInlines.h:266-269)
export function collapsesWhiteSpace(s: WebKitStyle): boolean {
  return s.collapse === 'collapse' || s.collapse === 'preserve-breaks'
}

// TextUtil::shouldTrailingWhitespaceHang: pre-wrap only.
export function trailingWhitespaceHangs(s: WebKitStyle): boolean {
  return s.collapse === 'preserve' && s.wrap
}

// TextRun::setTabSize(!collapseWhiteSpace && tabSize != 0) (TextUtil.cpp:91-92).
export function tabsAllowed(s: WebKitStyle): boolean {
  return !collapsesWhiteSpace(s) && s.tabSize !== 0
}
