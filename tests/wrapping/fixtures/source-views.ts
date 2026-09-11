import type { WrappingCase } from '../types.ts'

type SourceView = Pick<WrappingCase, 'text' | 'width' | 'origins'>
  & Partial<Pick<WrappingCase, 'font' | 'whiteSpace' | 'wordBreak' | 'letterSpacing'>>
  & { behavior: string }

// Opposing source-view witnesses from the focused wrapping investigation.
// Keep observations fresh; no archived native or candidate result is an answer.
// These inputs exercise height, source placement and API agreement. The narrow
// SHY oracle may still report selection unobserved; raw rectangles are retained.
const sources: SourceView[] = [
  {"behavior": "original-item-origin", "origins": ["focused-20260905/admission-probe/source-origin-v2-detail-chrome.json"], "text": "\u200b\u00adb", "width": 1},
  {"behavior": "original-item-origin", "origins": ["focused-20260905/admission-probe/source-origin-v2-detail-chrome.json"], "text": "a\u200b\u00adb", "width": 1},
  {"behavior": "space-versus-tab-item-origin", "origins": ["focused-20260905/admission-probe/source-origin-v2-detail-chrome.json"], "text": "a \u200b\u00adb", "width": 1},
  {"behavior": "space-versus-tab-item-origin", "origins": ["focused-20260905/admission-probe/source-origin-v2-detail-chrome.json"], "text": "a\t\u200b\u00adb", "width": 1},
  {"behavior": "unselected-shy-source-end", "origins": ["focused-20260905/admission-probe/source-origin-v2-detail-chrome.json"], "text": "a\u200b\u00ad b", "width": 1},
  {"behavior": "hyphen-fit-at-resumed-source", "origins": ["focused-20260905/admission-probe/source-origin-v2-detail-chrome.json"], "text": "a\u200b\u00adb", "width": 8},
  {"behavior": "selected-cut-ownership", "origins": ["focused-20260905/arabic-probe/gecko-intact-view-v5.json#control-207"], "text": "a\u200b\u0308\u00ad\u0301b", "width": 9, "letterSpacing": 1},
  {"behavior": "detached-fit", "origins": ["focused-20260905/arabic-probe/gecko-intact-view-v5.json#control-216"], "text": "a\u200b\u0308\u00ad\u093eb", "width": 7},
  {"behavior": "repeated-selected-cut", "origins": ["focused-20260905/arabic-probe/gecko-intact-view-v5.json#control-237"], "text": "a\u200b\u0308\u00ad\u00ad\u0301b", "width": 9, "letterSpacing": 1},
  {"behavior": "intact-source-fit", "origins": ["focused-20260905/arabic-probe/gecko-intact-view-v5.json#control-572"], "text": "a\u2060\u0301\u200b\u0308\u00ad\u093eb", "width": 9, "letterSpacing": -4},
  {"behavior": "restart-source-piece", "origins": ["focused-20260905/arabic-probe/gecko-intact-view-v5.json#span-heldout-5302"], "text": "a\u200b\u0308\u00ad\u093eb\u2060cd", "width": 24},
  {"behavior": "interior-control-spacing", "origins": ["focused-20260905/arabic-probe/gecko-intact-view-v5-expanded.json#restart-heldout-5358"], "text": "a\u200b\u0308\u00ad\u093eb\u2060cdefgh", "width": 32, "letterSpacing": -4},
  {"behavior": "interior-control-spacing", "origins": ["focused-20260905/arabic-probe/gecko-intact-view-v5-expanded.json#restart-heldout-5359"], "text": "a\u200b\u0308\u00ad\u093eb\u2060cdefgh", "width": 48, "letterSpacing": -4},
  {"behavior": "overlapping-source-pieces", "origins": ["focused-20260905/arabic-probe/gecko-intact-view-v5-expanded.json#restart-heldout-5553"], "text": "a\u200b\u0308\u00ad\u093eb\u200b\u0308\u00ad\u093ec\u2060def", "width": 12, "letterSpacing": -4},
  {"behavior": "overlapping-source-pieces", "origins": ["focused-20260905/arabic-probe/gecko-intact-view-v5-expanded.json#restart-heldout-5554"], "text": "a\u200b\u0308\u00ad\u093eb\u200b\u0308\u00ad\u093ec\u2060def", "width": 16, "letterSpacing": -4},
  {"behavior": "physical-item-vs-restart", "origins": ["focused-20260905/safari-spacing-view/edge-v1-safari.json"], "text": "a\u2060\u0301\u200b\u0308b", "width": 1, "wordBreak": "keep-all", "letterSpacing": 1},
  {"behavior": "physical-item-vs-restart", "origins": ["focused-20260905/safari-spacing-view/edge-v1-safari.json"], "text": "a\u2060\u0301b", "width": 1, "wordBreak": "keep-all", "letterSpacing": 1},
  {"behavior": "font-opposition", "origins": ["focused-20260905/safari-spacing-view/edge-v1-safari.json"], "text": "a\u2060\u0301\u200b\u0308b", "font": "bold 16px ProbeShantell", "width": 1, "wordBreak": "keep-all", "letterSpacing": 1},
  {"behavior": "repeated-control-edge", "origins": ["focused-20260905/safari-spacing-view/facts-safari.json"], "text": "a\u2060\u0301b", "font": "24px Amiri", "width": 4, "wordBreak": "keep-all", "letterSpacing": -4},
  {"behavior": "repeated-control-edge", "origins": ["focused-20260905/safari-spacing-view/facts-safari.json"], "text": "a\u2060\u2060\u0301b", "font": "24px Amiri", "width": 4, "wordBreak": "keep-all", "letterSpacing": -4},
  {"behavior": "long-tail-edge-falsifier", "origins": ["focused-20260905/safari-spacing-view/edge-v1-safari.json"], "text": "a\u2060\u0301office", "font": "24px Amiri", "width": 40, "wordBreak": "keep-all", "letterSpacing": -4},
  {"behavior": "long-tail-edge-falsifier", "origins": ["focused-20260905/safari-spacing-view/edge-v1-safari.json"], "text": "a\u2060\u0301bbb", "font": "24px Amiri", "width": 40, "wordBreak": "keep-all", "letterSpacing": -4},
  {"behavior": "physical-item-vs-restart", "origins": ["focused-20260905/admission-probe/rights-view-extracted-v1-safari.json"], "text": "a\u2060\u0301\u200b\u0308b", "width": 1, "whiteSpace": "normal", "wordBreak": "keep-all", "letterSpacing": 1},
 ]

export const sourceViewCases: Omit<WrappingCase, 'id'>[] = sources.map(({ behavior, ...input }) => ({
  font: '16px Arial', lineHeight: 48, whiteSpace: 'pre-wrap', wordBreak: 'normal',
  letterSpacing: 0, direction: 'ltr', scope: 'supported',
  ...input, family: `source-views/${behavior}`,
}))
