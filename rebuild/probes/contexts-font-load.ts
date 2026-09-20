// A web font that finishes loading after a Canvas context was made (research/PROFILING-START.md, item 1, "Staleness"). A
// page's list of contexts outlives paragraphs (src/index.ts prepare), and a context's fonts are a fact of the fonts the
// page has. What this probe asks of each browser's OffscreenCanvas:
// - L1: whether a context whose font was assigned before the family existed measures with the family once it has loaded
//   (the font string is never assigned again, as in measure/canvas.ts contextFor);
// - L2: whether that holds for a string the context measured before the load too, or whether the context answers it from
//   what it shaped then (Chrome keeps shaped words per canvas, specs/blink-canvas.md §1.7);
// - L3: what a context made after the load measures, which is what a new list's contexts measure.
// One script observation; raw widths only, and the verdicts are written by hand.
//
// Verdicts, 2026-09-19, pinned Chrome 153.0.8010.50, pinned Firefox 156.0 and webkit-host 22625.1.29.11.27
// (.artifacts/probes/measurer/font-load), `Hamburgefonstiv` at 48px, 433.48px in monospace and 327.79px in Amiri:
// - L1, L2: Chrome and Firefox measure with the loaded family on the old context, the string it had measured before
//   included (327.79 where it answered 433.48 before the load; Firefox 327.80 and 433.5). webkit-host's old context keeps
//   the fallback for both strings (432.07 before and after, 604.90 for the unseen string), and still does after the same
//   font string is assigned again; assigning another font string and then the first one again makes it 327.79.
// - L3: a context made after the load measures with the family in all three.
// So in WebKit a kept context is stale after a font loads, and in every engine a prepared paragraph's widths are: a page
// prepares its paragraphs again after its fonts change, and in WebKit it starts a new list of contexts for them. The font
// checks keep nothing across calls, so in Chrome and Firefox the next prepare on the old list sees the loaded font.
// Since then (2026-09-20): this probe's route, a FontFace made from bytes, loaded, then added to a font set that holds no
// face, is the one route WebKit's kept contexts miss (probes/contexts-start-up.ts W1 to W10 has the others), and Gecko's
// prepare makes its contexts anew whatever list it is handed, for family names Firefox learns late (src/index.ts prepare).
//
// Run under the browser lock (from the worktree):
//   python3 .artifacts/session/with-browser-lock.py contexts-font-load -- bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/probes/contexts-font-load.ts --out=<dir>
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
  id: 'contexts-font-load',
  spec: 'PROFILING-START item 1, staleness',
  pageLang: 'en',
  browsers: ['chrome', 'safari', 'firefox'],
  html: '<div id="t"></div>',
  observe: [{ kind: 'script', source: SOURCE }],
  note: 'Widths at 48px of one string on an OffscreenCanvas context made before a FontFace of its first family loaded, and on one made after.',
}]

export default probes
