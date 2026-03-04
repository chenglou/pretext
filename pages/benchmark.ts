import { prepare, layout, clearCache } from '../src/layout.ts'
import type { PreparedText } from '../src/layout.ts'
import { TEXTS } from '../src/test-data.ts'

const COUNT = 500
const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const FONT_SIZE = 16
const FONT = `${FONT_SIZE}px ${FONT_FAMILY}`
const LINE_HEIGHT = Math.round(FONT_SIZE * 1.2)
const WIDTH_BEFORE = 400
const WIDTH_AFTER = 300
const WARMUP = 2
const RUNS = 10

// Filter edge cases — not realistic comments
const commentTexts = TEXTS.filter(t => t.text.trim().length > 1)
const texts: string[] = []
for (let i = 0; i < COUNT; i++) {
  texts.push(commentTexts[i % commentTexts.length]!.text)
}

function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function bench(fn: () => void): number {
  for (let i = 0; i < WARMUP; i++) fn()
  const times: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now()
    fn()
    times.push(performance.now() - t0)
  }
  return median(times)
}

// Yield to let the browser paint status updates
function nextFrame(): Promise<void> {
  return new Promise(resolve => { requestAnimationFrame(() => { resolve() }) })
}

async function run() {
  const root = document.getElementById('root')!

  // Create visible DOM container
  const container = document.createElement('div')
  container.style.cssText = 'position:relative;overflow:hidden;height:1px'
  document.body.appendChild(container)

  const divs: HTMLDivElement[] = []
  for (let i = 0; i < COUNT; i++) {
    const div = document.createElement('div')
    div.style.font = FONT
    div.style.lineHeight = `${LINE_HEIGHT}px`
    div.style.width = `${WIDTH_BEFORE}px`
    div.style.position = 'relative'
    div.style.wordWrap = 'break-word'
    div.style.overflowWrap = 'break-word'
    div.textContent = texts[i]!
    container.appendChild(div)
    divs.push(div)
  }
  divs[0]!.getBoundingClientRect() // force initial layout

  // Pre-prepare for layout benchmark
  const prepared: PreparedText[] = []
  for (let i = 0; i < COUNT; i++) {
    prepared.push(prepare(texts[i]!, FONT, LINE_HEIGHT))
  }

  type Result = { label: string, ms: number, desc: string }
  const results: Result[] = []

  // --- 1. prepare() ---
  root.innerHTML = '<p>Benchmarking prepare()...</p>'
  await nextFrame()
  const tPrepare = bench(() => {
    clearCache()
    for (let i = 0; i < COUNT; i++) {
      prepare(texts[i]!, FONT, LINE_HEIGHT)
    }
  })
  results.push({ label: 'Our library: prepare()', ms: tPrepare, desc: 'Segment + measure (one-time)' })

  // --- 2. layout() ---
  root.innerHTML = '<p>Benchmarking layout()...</p>'
  await nextFrame()
  const tLayout = bench(() => {
    for (let i = 0; i < COUNT; i++) {
      layout(prepared[i]!, WIDTH_AFTER)
    }
  })
  results.push({ label: 'Our library: layout()', ms: tLayout, desc: 'Pure arithmetic (resize hot path)' })

  // --- 3. DOM batch ---
  root.innerHTML = '<p>Benchmarking DOM batch...</p>'
  await nextFrame()
  for (const div of divs) div.style.width = `${WIDTH_BEFORE}px`
  divs[0]!.getBoundingClientRect()
  const tBatch = bench(() => {
    for (let i = 0; i < COUNT; i++) divs[i]!.style.width = `${WIDTH_AFTER}px`
    for (let i = 0; i < COUNT; i++) divs[i]!.getBoundingClientRect().height
    for (let i = 0; i < COUNT; i++) divs[i]!.style.width = `${WIDTH_BEFORE}px`
    divs[0]!.getBoundingClientRect()
  })
  results.push({ label: 'DOM batch', ms: tBatch, desc: 'Write all, read all (one reflow)' })

  // --- 4. DOM interleaved ---
  root.innerHTML = '<p>Benchmarking DOM interleaved...</p>'
  await nextFrame()
  for (const div of divs) div.style.width = `${WIDTH_BEFORE}px`
  divs[0]!.getBoundingClientRect()
  const tInterleaved = bench(() => {
    for (let i = 0; i < COUNT; i++) {
      divs[i]!.style.width = `${WIDTH_AFTER}px`
      divs[i]!.getBoundingClientRect().height
    }
    for (let i = 0; i < COUNT; i++) divs[i]!.style.width = `${WIDTH_BEFORE}px`
    divs[0]!.getBoundingClientRect()
  })
  results.push({ label: 'DOM interleaved', ms: tInterleaved, desc: 'Write+read per div (N reflows)' })

  document.body.removeChild(container)

  // --- Render ---
  // Relative speed only for resize approaches (layout vs DOM). prepare() is
  // a one-time setup cost — not comparable to per-resize measurements.
  const resizeResults = results.filter(r => r.label !== 'Our library: prepare()')
  const fastest = Math.min(...resizeResults.map(r => r.ms))

  const layoutMs = tLayout || 0.01 // guard against 0 from low-res timers (Firefox/Safari)
  let html = `
    <div class="summary">
      <span class="big">${tLayout < 0.01 ? '<0.01' : tLayout.toFixed(2)}ms</span> layout (${COUNT} texts)
      <span class="sep">|</span>
      ${(tInterleaved / layoutMs).toFixed(0)}× faster than DOM interleaved
      <span class="sep">|</span>
      ${(tBatch / layoutMs).toFixed(0)}× faster than DOM batch
    </div>
    <table>
      <tr><th>Approach</th><th>Median (ms)</th><th>Relative</th><th>Description</th></tr>
  `
  const fastestResize = fastest || 0.01
  for (let ri = 0; ri < results.length; ri++) {
    const r = results[ri]!
    const isPrepare = r.label === 'Our library: prepare()'
    const rel = isPrepare ? 0 : r.ms / fastestResize
    const cls = isPrepare ? 'mid' : rel < 1.5 ? 'fast' : rel < 10 ? 'mid' : 'slow'
    const relText = isPrepare ? 'one-time' : rel < 1.01 ? 'fastest' : rel.toFixed(1) + '×'
    html += `<tr class="${cls}">
      <td>${r.label}</td>
      <td>${r.ms < 0.01 ? '<0.01' : r.ms.toFixed(2)}</td>
      <td>${relText}</td>
      <td>${r.desc}</td>
    </tr>`
  }
  html += '</table>'
  html += `<p class="note">${COUNT} texts × ${WARMUP} warmup + ${RUNS} measured runs. ${FONT}. Resize ${WIDTH_BEFORE}→${WIDTH_AFTER}px. Visible containers, position:relative.</p>`

  root.innerHTML = html

  // --- CJK vs Latin scaling test ---
  const cjkBase = "这是一段中文文本用于测试文本布局库对中日韩字符的支持每个字符之间都可以断行性能测试显示新的文本测量方法比传统方法快了将近一千五百倍"
  const latinBase = "The quick brown fox jumps over the lazy dog and then runs around the park looking for something interesting to do on a sunny afternoon "

  function makeText(base: string, n: number): string {
    let t = ''
    while (t.length < n) t += base
    return t.slice(0, n)
  }

  function med(times: number[]): number {
    const s = [...times].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]!
  }

  const charSizes = [50, 100, 200, 500, 1000]
  const cjkRows: string[] = []

  for (const n of charSizes) {
    const cjk = makeText(cjkBase, n)
    const lat = makeText(latinBase, n)

    // prepare (cold)
    const pTimes = { cjk: [] as number[], lat: [] as number[] }
    for (let r = 0; r < 15; r++) {
      clearCache(); let t0 = performance.now(); prepare(cjk, FONT, LINE_HEIGHT); pTimes.cjk.push(performance.now() - t0)
      clearCache(); t0 = performance.now(); prepare(lat, FONT, LINE_HEIGHT); pTimes.lat.push(performance.now() - t0)
    }

    // layout (1000x for resolution)
    clearCache()
    const pc = prepare(cjk, FONT, LINE_HEIGHT)
    const pl = prepare(lat, FONT, LINE_HEIGHT)
    const cSegs = pc.paraData[0]?.widths.length ?? 0
    const lSegs = pl.paraData[0]?.widths.length ?? 0
    const lTimes = { cjk: [] as number[], lat: [] as number[] }
    for (let r = 0; r < 15; r++) {
      let t0 = performance.now(); for (let j = 0; j < 1000; j++) layout(pc, WIDTH_AFTER); lTimes.cjk.push((performance.now() - t0) / 1000)
      t0 = performance.now(); for (let j = 0; j < 1000; j++) layout(pl, WIDTH_AFTER); lTimes.lat.push((performance.now() - t0) / 1000)
    }

    cjkRows.push(`<tr>
      <td>${n}</td><td>${cSegs}</td><td>${lSegs}</td>
      <td>${med(pTimes.cjk).toFixed(2)}</td><td>${med(pTimes.lat).toFixed(2)}</td>
      <td>${med(lTimes.cjk).toFixed(4)}</td><td>${med(lTimes.lat).toFixed(4)}</td>
    </tr>`)
  }

  root.innerHTML += `
    <h2 style="color:#4fc3f7;font-family:monospace;font-size:16px;margin:24px 0 8px">CJK vs Latin scaling</h2>
    <table>
      <tr><th>Chars</th><th>CJK segs</th><th>Latin segs</th><th>CJK prepare (ms)</th><th>Latin prepare (ms)</th><th>CJK layout/1k (ms)</th><th>Latin layout/1k (ms)</th></tr>
      ${cjkRows.join('')}
    </table>
  `
}

run()
