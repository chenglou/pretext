// Where each browser's line fit changes, from recorded browser facts (rebuild/specs/PROBES.md and probes-*.md), never
// from rebuild/src. derive.ts uses these only to choose which widths to observe; the expected lines are observations.
import type { BrowserKind } from '../lab/types.ts'

// Units per CSS px of the grid a browser's available width lives on.
// - Chrome: a LayoutUnit is 1/64 of a zoomed px, so 1/(64 × DPR) CSS px (probe cross X6: 1/128 at DPR 2, 1/224 at forced
//   DPR 3.5).
// - Safari and webkit-host: 1/64 CSS px at any DPR (probes-safari, "Line-fit grid").
// - Firefox: app units, 1/60 CSS px (probes-firefox, "Line-fit grid": round(width × 60) at apd 30, 60, 40, 27 and 23).
export function widthGrid(browser: BrowserKind, dpr: number): number {
  switch (browser) {
    case 'chrome': return 64 * dpr
    case 'safari':
    case 'webkit-host': return 64
    case 'firefox': return 60
  }
}

// The smallest width, in grid units, at which content whose observed extent is `extent` CSS px fits on a line.
// - Chrome: content C LayoutUnits fits when C ≤ trunc(width × 64 × DPR) + 1 (line_breaker.h:307-317, AddEpsilon). Probe
//   blink-lines H2 at DPR 2: C128 = 11959 keeps 1 line at 93.421875 (11958/128) and gives 2 at 93.4140625. So C − 1.
// - Safari: the first one-line width is ceil(64 × E) − 1 LayoutUnits (probes-safari "Item widths", 8 strings;
//   webkit-lines H3: 2985/64 for a 46.65625px line).
// - Firefox: integer app units against round(width × 60) (gecko-lines H1: 5184 au fits at 86.4px and not at 86.38px). So
//   the extent's app units.
export function fitThreshold(browser: BrowserKind, dpr: number, extent: number): number {
  switch (browser) {
    case 'chrome': return Math.round(extent * 64 * dpr) - 1
    case 'safari':
    case 'webkit-host': return Math.ceil(extent * 64) - 1
    case 'firefox': return Math.round(extent * 60)
  }
}

// A width on the grid as the CSS px value the case carries.
export function gridWidth(units: number, grid: number): number {
  return units / grid
}
