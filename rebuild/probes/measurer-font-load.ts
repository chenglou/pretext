// A web font that finishes loading after a Canvas context was made (research/PROFILING-START.md, item 1, "Staleness"). A
// measurer that outlives paragraphs (src/measure/font-checks.ts Measurer) keeps contexts and font-check answers, both
// facts of the fonts a page has. What this probe asks of each browser's OffscreenCanvas:
// - L1: whether a context whose font was assigned before the family existed measures with the family once it has loaded
//   (the font string is never assigned again, as in measure/canvas.ts contextFor);
// - L2: whether that holds for a string the context measured before the load too, or whether the context answers it from
//   what it shaped then (Chrome keeps shaped words per canvas, specs/blink-canvas.md §1.7);
// - L3: what a context made after the load measures, which is what a new measurer's contexts measure.
// One script observation; raw widths only, and the verdicts are written by hand.
//
// Verdicts, 2026-09-19 (.artifacts/probes/measurer/font-load): see the probe's output and research notes of the
// profiling phase's item 1; the library's contract doesn't depend on them (a caller makes a new measurer where it
// prepares its paragraphs again after its fonts change).
//
// Run under the browser lock (from the worktree):
//   python3 .artifacts/session/with-browser-lock.py measurer-font-load -- bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/probes/measurer-font-load.ts --out=.artifacts/probes/measurer/font-load
import type { Probe } from './types.ts'

const SOURCE = `
  const font = 'normal 400 48px "Late Amiri", monospace'
  const context = () => {
    const c = new OffscreenCanvas(1, 1).getContext('2d')
    c.font = font
    return c
  }
  const seen = 'Hamburgefonstiv'
  const unseen = 'Hamburgefonstiv again'
  const old = context()
  const out = { before: { seen: old.measureText(seen).width, monospaceAlone: 0, amiriAlone: 0 }, after: {} }
  const mono = new OffscreenCanvas(1, 1).getContext('2d')
  mono.font = 'normal 400 48px monospace'
  out.before.monospaceAlone = mono.measureText(seen).width
  const face = new FontFace('Late Amiri', await (await fetch('/fonts/amiri.ttf')).arrayBuffer())
  await face.load()
  document.fonts.add(face)
  await document.fonts.ready
  const wait = () => new Promise(done => { const channel = new MessageChannel(); channel.port1.onmessage = () => done(null); channel.port2.postMessage(null) })
  await wait()
  out.after.oldContextSeen = old.measureText(seen).width
  out.after.oldContextUnseen = old.measureText(unseen).width
  const fresh = context()
  out.after.freshContextSeen = fresh.measureText(seen).width
  out.after.freshContextUnseen = fresh.measureText(unseen).width
  out.after.oldContextSeenAgain = old.measureText(seen).width
  old.font = font
  out.after.oldContextSeenAfterAssigningTheSameFont = old.measureText(seen).width
  old.font = 'normal 400 47px "Late Amiri", monospace'
  old.font = font
  out.after.oldContextSeenAfterAssigningAnotherFontAndBack = old.measureText(seen).width
  document.fonts.delete(face)
  return out
`

const probes: Probe[] = [{
  id: 'measurer-font-load',
  spec: 'PROFILING-START item 1, staleness',
  pageLang: 'en',
  browsers: ['chrome', 'safari', 'firefox'],
  html: '<div id="t"></div>',
  observe: [{ kind: 'script', source: SOURCE }],
  note: 'Widths at 48px of one string on an OffscreenCanvas context made before a FontFace of its first family loaded, and on one made after.',
}]

export default probes
