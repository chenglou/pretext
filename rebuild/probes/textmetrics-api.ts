// Which TextMetrics APIs a page can use without flags: the long-shipped box metrics, and the newer per-character
// methods (getSelectionRects, getActualBoundingBox, getIndexFromOffset, getTextClusters) that would give glyph positions
// inside one shaped string. Records presence on the prototype and whether a call on an OffscreenCanvas context works.
import type { Probe } from './types.ts'

const spec = 'textmetrics-api 2026-09-17'

const source = `
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')
  ctx.font = '32px Arial'
  const m = ctx.measureText('fi AVA office')
  const proto = Object.getPrototypeOf(m)
  const names = ['actualBoundingBoxLeft', 'actualBoundingBoxRight', 'fontBoundingBoxAscent', 'emHeightAscent', 'hangingBaseline',
    'getSelectionRects', 'getActualBoundingBox', 'getIndexFromOffset', 'getTextClusters', 'advances']
  const present = {}
  for (const name of names) present[name] = name in m || name in proto
  const calls = {}
  const attempt = (name, run) => {
    try { calls[name] = run() } catch (error) { calls[name] = 'threw: ' + String(error && error.message || error) }
  }
  if (typeof m.getSelectionRects === 'function') attempt('getSelectionRects', () => m.getSelectionRects(0, 5).map(r => [r.x, r.width]))
  if (typeof m.getActualBoundingBox === 'function') attempt('getActualBoundingBox', () => { const r = m.getActualBoundingBox(0, 5); return [r.x, r.width] })
  if (typeof m.getIndexFromOffset === 'function') attempt('getIndexFromOffset', () => [10, 40, 80].map(x => m.getIndexFromOffset(x)))
  if (typeof m.getTextClusters === 'function') attempt('getTextClusters', () => m.getTextClusters().slice(0, 6).map(c => [c.start, c.end, c.x]))
  if (Array.isArray(m.advances)) calls.advances = m.advances.slice(0, 6)
  return { userAgent: navigator.userAgent, width: m.width, present, calls }
`

export default [
  { id: 'textmetrics-api/presence', spec, pageLang: 'en', observe: [{ kind: 'script', source }] },
] satisfies Probe[]
