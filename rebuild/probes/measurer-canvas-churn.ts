// What a page's well-filled canvases cost a page that still makes short-lived ones (a review's check of
// research/PROFILING-START.md item 1). The bench's 'page keeps contexts' form (bench/page.ts prepareKeeping: the engine's
// contexts are the page's, the font checks make their own for every message) ran slower than a measurer a message on the
// chat mix in Chrome, which makes more contexts: 1.59 s against 1.09 s for 1,000 messages, where keeping both took 0.31 s
// (.artifacts/bench/perf-lifetime-review-20260919/run-1). The guess this probe tests: a canvas that has answered tens of
// thousands of distinct strings holds them (Chrome: up to 32,768 strings and 32,768 words a canvas,
// frame_shape_cache.cc:12-16), a page that makes canvases for every message collects garbage often, and every collection
// walks what the kept canvases hold.
// - C1: the time to make 2,000 canvases, assign a font and measure ten strings on each, with 0, 1, 2, 4 and 8 filled
//   canvases alive (each has answered 40,000 distinct strings), twice at every step. The steps only go up: a dropped
//   canvas can't be collected on demand.
// - C2, the control: the same with 8 more canvases alive that have answered nothing, which says whether it is the canvases
//   or what they hold.
// One script observation; raw milliseconds, in a background window: read the ratios, not the times.
//
// Verdict, 2026-09-19, pinned Chrome 153.0.8010.50, alone on the machine at load 3.5 (.artifacts/probes/measurer/
// canvas-churn): the guess doesn't hold. 2,000 short-lived canvases take 35 and 34 ms with no filled canvas alive, 66 and
// 34 with one, 31 and 40 with two, 28 and 28 with four, 38 and 36 with eight, and 37 and 42 with eight empty ones beside
// them. So the bench form's slowness is still unexplained; it is a form no caller of prepare() can reach, since prepare
// hands one measurer to the checks and the engine alike.
//
// Run alone on the machine (from the worktree):
//   python3 .artifacts/session/with-browser-lock.py measurer-canvas-churn --browser=all --exclusive -- bun rebuild/probes/runner.ts \
//     --browser=chrome --probes=rebuild/probes/measurer-canvas-churn.ts --out=.artifacts/probes/measurer/canvas-churn
import type { Probe } from './types.ts'

const SOURCE = `
  const font = '16px "Helvetica Neue"'
  const make = () => {
    const c = new OffscreenCanvas(1, 1).getContext('2d')
    c.font = font
    return c
  }
  let sink = 0
  let serial = 0
  const churn = () => {
    const from = performance.now()
    for (let i = 0; i < 2000; i++) {
      const c = make()
      serial++
      for (let k = 0; k < 10; k++) sink += c.measureText('short lived ' + serial + ' ' + k).width
    }
    return performance.now() - from
  }
  const wait = () => new Promise(done => { const channel = new MessageChannel(); channel.port1.onmessage = () => done(null); channel.port2.postMessage(null) })
  const kept = []
  const empty = []
  const out = { steps: [], control: null }
  churn()
  const steps = [0, 1, 2, 4, 8]
  for (let s = 0; s < steps.length; s++) {
    while (kept.length < steps[s]) {
      const c = make()
      for (let i = 0; i < 40000; i++) sink += c.measureText('kept ' + kept.length + ' string ' + i).width
      kept.push(c)
    }
    await wait()
    const first = churn()
    await wait()
    const second = churn()
    out.steps.push({ filledCanvasesAlive: kept.length, churnMs: [first, second] })
  }
  for (let i = 0; i < 8; i++) empty.push(make())
  await wait()
  out.control = { filledCanvasesAlive: kept.length, emptyCanvasesAlive: empty.length, churnMs: [churn(), churn()] }
  for (let i = 0; i < kept.length; i++) sink += kept[i].measureText('still here').width
  for (let i = 0; i < empty.length; i++) sink += empty[i].measureText('still here').width
  out.sink = sink
  return out
`

const probes: Probe[] = [{
  id: 'measurer-canvas-churn',
  spec: 'PROFILING-START item 1: a page measurer beside canvases made per message',
  pageLang: 'en',
  browsers: ['chrome'],
  html: '<div id="t"></div>',
  observe: [{ kind: 'script', source: SOURCE }],
  note: 'Milliseconds to make 2,000 short-lived OffscreenCanvas contexts and measure ten strings on each, by how many canvases that answered 40,000 distinct strings are alive.',
}]

export default probes
