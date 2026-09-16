// The paragraph's styles as WebKit reads them, and the white-space predicates of TextUtil.cpp:424-448.
import type { Paragraph } from '../../model.js'
import type { LineBreakMode, WebKitStyle, WhiteSpaceCollapse } from './types.js'

export function webkitStyle(p: Paragraph): WebKitStyle {
  let collapse: WhiteSpaceCollapse
  let wrap: boolean
  switch (p.whiteSpace) {
    case 'normal': collapse = 'collapse'; wrap = true; break
    case 'nowrap': collapse = 'collapse'; wrap = false; break
    case 'pre': collapse = 'preserve'; wrap = false; break
    case 'pre-wrap': collapse = 'preserve'; wrap = true; break
    case 'pre-line': collapse = 'preserve-breaks'; wrap = true; break
    case 'break-spaces': collapse = 'break-spaces'; wrap = true; break
  }
  let lineBreakMode: LineBreakMode
  switch (p.lineBreak) {
    case 'auto':
    case 'anywhere': lineBreakMode = 'Default'; break
    case 'loose': lineBreakMode = 'Loose'; break
    case 'normal': lineBreakMode = 'Normal'; break
    case 'strict': lineBreakMode = 'Strict'; break
  }
  return {
    collapse, wrap, wordBreak: p.wordBreak, overflowWrap: p.overflowWrap, lineBreak: p.lineBreak, lineBreakMode,
    tabSize: p.tabSize, rtl: p.direction === 'rtl',
  }
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
