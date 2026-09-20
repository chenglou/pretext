// The device scale factor changing under kept Canvas contexts in Chrome (research/PROFILING-START.md, item 1,
// "Staleness"; research/PERF-LIFETIME.md, the review's section 6). A page's list keeps a context for the page's life
// (src/index.ts prepare), and a window that moves to another display, or a browser zoom, changes devicePixelRatio under
// it. Blink's port measures a named family at the CSS size times the ratio, so a new ratio asks for another font string
// and gets new contexts. The contexts whose font string stays are the ones measured at the CSS size whatever the ratio:
// the system font's, which has an optical size axis (engines/blink/checks.ts SYSTEM_FONT_FAMILIES), and the font checks'
// at 16px. Chrome answers from what a canvas shaped before, so what this probe asks of an OffscreenCanvas context:
// - D1: whether a context made and asked at one device scale factor measures as before once the factor has changed, for
//   strings it had measured and strings it hadn't;
// - D2: whether a context made after the change with the same font string measures what the kept one does. A difference
//   is a width a page's list gets and a list a call doesn't;
// - D3: the same once the factor is back.
// For a named family ("Helvetica Neue" at 16px and 32px) and for system-ui at 13px, 16px and 32px (its optical size
// moves below 20pt). The driver changes the factor through the DevTools protocol, Emulation.setDeviceMetricsOverride
// (runner.ts, /api/chrome-dsf). One script observation; raw widths and the page's devicePixelRatio at each step; the
// verdicts are written by hand.
//
// Verdicts, 2026-09-19, pinned Chrome 153.0.8010.50, the factor from 2 to 1 to 3 and back to 2, the page's
// devicePixelRatio following it at every step (.artifacts/tests/runs/contexts-20260919/probes/device-scale):
// - D1, D2, D3: at every step every kept context measures what a context made at that step measures (0 of 135 pairs
//   differ, five font strings by 27 asks), and what it measured the first time (0 of the 90 widths asked again moved).
// - More than was asked: a font string measures the same at every factor (`Hamburgefonstiv` in 16px system-ui 124.8125px
//   at factors 1, 2 and 3, where 32px system-ui gives 235.953125px and not twice that, so the optical size is live in
//   these contexts). An OffscreenCanvas context doesn't read the device scale factor, so a change of devicePixelRatio
//   can't make a kept context stale; the environment the caller hands prepare carries the new ratio, and the port asks
//   for other font strings where it measures at the zoomed size.
// Not probed: a real move between displays, and the browser's own zoom (Cmd +), which DevTools emulation stands in for.
//
// Run under the browser lock (from the worktree):
//   python3 .artifacts/session/with-browser-lock.py contexts-device-scale -- bun rebuild/probes/runner.ts --browser=chrome \
//     --chrome-emulate-dsf=2 --probes=rebuild/probes/contexts-device-scale.ts --out=<dir>
import type { Probe } from './types.ts'

const SOURCE = `
  const runId = new URLSearchParams(location.search).get('run')
  const scale = async deviceScaleFactor => {
    const response = await fetch('/api/chrome-dsf', { method: 'POST', body: JSON.stringify({ runId, deviceScaleFactor }) })
    if (!response.ok) throw new Error('device scale factor ' + deviceScaleFactor + ': HTTP ' + response.status)
    await new Promise(done => setTimeout(() => done(null), 300))
  }
  const fonts = ['normal 400 16px "Helvetica Neue"', 'normal 400 32px "Helvetica Neue"', 'normal 400 13px system-ui', 'normal 400 16px system-ui', 'normal 400 32px system-ui']
  const seen = ['Hamburgefonstiv', 'AVATAR To Ty.', 'The quick brown fox']
  const unseen = ['Hamburgefonstiv again', 'WAVE Yo, Te.', 'jumps over the lazy dog']
  const later = ['Hamburgefonstiv once more', 'LT AV Wa P.', 'and then it does so again']
  const context = font => {
    const c = new OffscreenCanvas(1, 1).getContext('2d')
    c.lang = 'en'
    c.font = font
    c.textRendering = 'optimizeLegibility'
    return c
  }
  const widths = (c, texts) => texts.map(text => c.measureText(text).width)
  const kept = fonts.map(context)
  const out = { fonts, seen, unseen, later, steps: [] }
  const step = (name, texts) => out.steps.push({
    name, devicePixelRatio: window.devicePixelRatio, texts,
    kept: kept.map(c => widths(c, texts)), fresh: fonts.map(font => widths(context(font), texts)),
  })
  step('at the run\\'s factor, the kept contexts\\' first strings', seen)
  await scale(1)
  step('at factor 1, strings the kept contexts had measured', seen)
  step('at factor 1, strings new to them', unseen)
  await scale(3)
  step('at factor 3, strings the kept contexts had measured', seen)
  step('at factor 3, strings measured at factor 1', unseen)
  step('at factor 3, strings new to them', later)
  await scale(2)
  step('back at factor 2, every string', seen.concat(unseen, later))
  return out
`

const probes: Probe[] = [{
  id: 'contexts-device-scale',
  spec: 'PROFILING-START item 1, staleness: the device scale factor',
  pageLang: 'en',
  browsers: ['chrome'],
  html: '<div id="t"></div>',
  observe: [{ kind: 'script', source: SOURCE }],
  note: 'Widths on OffscreenCanvas contexts made before the DevTools device scale factor changed and on contexts made after, for a named family and for system-ui.',
}]

export default probes
