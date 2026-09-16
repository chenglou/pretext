// Probes for the numbered hypotheses at the end of rebuild/specs/blink-lines.md (§21), blink-text.md (§6) and
// blink-canvas.md (f), the Blink items of CRITIC.md §6, and six cross-cutting Chrome checks. Ids keep the spec's
// numbering ('blink-lines H7'); a suffix in parentheses marks a second probe for the same hypothesis.
//
// Every probe is one script observation. The script measures in the page, returns raw values, and lists checks
// { name, ok, expected, measured, dpr }: the hypothesis's expected outcome next to what was measured. A check with dpr 1
// or 2 applies only to runs at that devicePixelRatio. Threshold widths are computed in the page from Canvas or DOM
// measurements. blink-verdicts.ts reads the output files and prints the per-hypothesis summary behind
// rebuild/specs/probes-chrome.md.
//
// Runs, each under the browser lock (from ~/github/pretext-rebuild):
//   native DPR 2: bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/probes/blink-probes.ts \
//                   --out=.artifacts/probes/blink/dpr2 --probe-timeout-ms=60000
//   forced DPR 1: the same with --out=.artifacts/probes/blink/dpr1 --chrome-args=--force-device-scale-factor=1
//   zoom subset:  --probes=rebuild/probes/blink-probes-zoom.ts with --chrome-args=--force-device-scale-factor=3.5, and
//                 with --chrome-args=--force-device-scale-factor=1 --chrome-emulate-dsf=2
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ObservationSpec, Probe } from './types.ts'

type Check = { name: string; ok: boolean; expected: unknown; measured: unknown; dpr: number | null }
type LineCase = { label: string; inner?: string; style?: string; attrs?: string; data?: string; expected: number }

// In-page helpers. Self-contained: the function is stringified into every script.
function lib(host: HTMLElement) {
  const f32 = Math.fround
  const Z = window.devicePixelRatio
  const checks: Check[] = []
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
  function check(name: string, ok: boolean, expected: unknown, measured: unknown, dpr: number | null = null): boolean {
    checks.push({ name, ok, expected, measured, dpr })
    return ok
  }
  function eq(name: string, expected: unknown, measured: unknown, dpr: number | null = null): boolean {
    return check(name, same(expected, measured), expected, measured, dpr)
  }
  function ctx(font: string, props?: Record<string, string>): OffscreenCanvasRenderingContext2D {
    const c = new OffscreenCanvas(1, 1).getContext('2d')
    if (c === null) throw new Error('No OffscreenCanvas 2d context')
    c.font = font
    if (props !== undefined) {
      const keys = Object.keys(props)
      for (let i = 0; i < keys.length; i++) (c as unknown as Record<string, string>)[keys[i]!] = props[keys[i]!]!
    }
    return c
  }
  function W(font: string, text: string, props?: Record<string, string>): number {
    return ctx(font, props).measureText(text).width
  }
  // LayoutUnit::FromFloatCeil: raw layout units (1/64 of a zoomed px) of a float32 width.
  function ceil64(v: number): number {
    return Math.ceil(f32(f32(v) * 64))
  }
  function put(html: string): HTMLElement {
    host.innerHTML = html
    host.getBoundingClientRect()
    return host.firstElementChild as HTMLElement
  }
  function bw(el: Element): number {
    return el.getBoundingClientRect().width
  }
  // Horizontal extent of a Range over the node's contents (rects with positive area), relative to the host.
  function extent(node: Node): { width: number; left: number; right: number; rects: number[][] } {
    const range = document.createRange()
    range.selectNodeContents(node)
    const origin = host.getBoundingClientRect()
    let left = Infinity
    let right = -Infinity
    const rects: number[][] = []
    const list = range.getClientRects()
    for (let i = 0; i < list.length; i++) {
      const q = list[i]!
      rects.push([q.left - origin.left, q.top - origin.top, q.width, q.height])
      if (q.width > 0 && q.height > 0) {
        left = Math.min(left, q.left - origin.left)
        right = Math.max(right, q.right - origin.left)
      }
    }
    return { width: right > left ? right - left : 0, left, right, rects }
  }
  // Lines from per-code-point Range rects. A code point joins a line by its last positive rect (Chrome gives a letter
  // after a soft-hyphen break a rect on both lines; the later one is the letter).
  function lines(el: Element): { count: number; texts: string[]; starts: number[]; lefts: number[]; rights: number[]; heightLines: number | null } {
    const origin = host.getBoundingClientRect()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    const lh = Number.parseFloat(getComputedStyle(el).lineHeight)
    let content = ''
    const found: Array<{ cy: number; start: number; end: number; left: number; right: number }> = []
    for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
      const data = node.data
      const base = content.length
      content += data
      for (let i = 0; i < data.length;) {
        const length = data.codePointAt(i)! > 0xffff ? 2 : 1
        range.setStart(node, i)
        range.setEnd(node, i + length)
        const list = range.getClientRects()
        let q: DOMRect | null = null
        for (let k = 0; k < list.length; k++) if (list[k]!.width > 0 && list[k]!.height > 0) q = list[k]!
        if (q !== null) {
          const cy = (q.top + q.bottom) / 2 - origin.top
          const threshold = Number.isFinite(lh) ? lh / 2 : q.height / 2
          let line = found.find(candidate => Math.abs(candidate.cy - cy) < threshold)
          if (line === undefined) {
            line = { cy, start: base + i, end: base + i + length, left: q.left - origin.left, right: q.right - origin.left }
            found.push(line)
          }
          line.start = Math.min(line.start, base + i)
          line.end = Math.max(line.end, base + i + length)
          line.left = Math.min(line.left, q.left - origin.left)
          line.right = Math.max(line.right, q.right - origin.left)
        }
        i += length
      }
    }
    found.sort((a, b) => a.cy - b.cy)
    return {
      count: found.length,
      texts: found.map(line => content.slice(line.start, line.end)),
      starts: found.map(line => line.start),
      lefts: found.map(line => line.left),
      rights: found.map(line => line.right),
      heightLines: Number.isFinite(lh) ? Math.round(el.getBoundingClientRect().height / lh) : null,
    }
  }
  function heightLines(el: Element, lineHeight = 20): number {
    return Math.round(el.getBoundingClientRect().height / lineHeight)
  }
  // Smallest k in [lo, hi] for which pred() holds with the element `k / denom` px wide. Binary search, then the
  // neighbours are tested again so a non-monotone threshold shows.
  function minWidth(el: HTMLElement, lo: number, hi: number, denom: number, pred: () => boolean): { k: number | null; width: number | null; monotoneAround: boolean } {
    const test = (k: number): boolean => {
      el.style.width = `${k / denom}px`
      host.getBoundingClientRect()
      return pred()
    }
    if (!test(hi)) return { k: null, width: null, monotoneAround: false }
    if (test(lo)) return { k: lo, width: lo / denom, monotoneAround: false }
    let a = lo
    let b = hi
    while (b - a > 1) {
      const mid = Math.floor((a + b) / 2)
      if (test(mid)) b = mid
      else a = mid
    }
    const monotoneAround = !test(b - 1) && test(b) && test(b + 1)
    return { k: b, width: b / denom, monotoneAround }
  }
  function frame(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Animation frame timed out')), 3000)
      requestAnimationFrame(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  // blink-text harness: #t with font 16px/20px Helvetica Neue and width 0; lines = height / 20.
  function t(inner: string, style = '', setup?: (el: HTMLElement) => void, attrs = ''): { lines: number; texts: string[]; starts: number[]; lefts: number[] } {
    const el = put(`<div id="t" ${attrs} style="font:16px/20px 'Helvetica Neue';width:0;${style}">${inner}</div>`)
    if (setup !== undefined) setup(el)
    host.getBoundingClientRect()
    const info = lines(el)
    return { lines: heightLines(el), texts: info.texts, starts: info.starts, lefts: info.lefts }
  }
  function lineCases(cases: LineCase[]): unknown[] {
    const out: unknown[] = []
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]!
      const data = c.data
      const r = t(c.inner ?? '', c.style ?? '', data === undefined ? undefined : el => { el.textContent = data }, c.attrs ?? '')
      out.push({ label: c.label, ...r })
      eq(`${c.label}: ${c.expected} line${c.expected === 1 ? '' : 's'}`, c.expected, r.lines)
    }
    return out
  }
  // Width of an inline span in an unconstrained div (blink-text harness).
  function sw(inner: string, style = '', setup?: (span: HTMLElement) => void, divStyle = ''): number {
    const el = put(`<div style="font:16px/20px 'Helvetica Neue';${divStyle}"><span style="${style}">${inner}</span></div>`)
    const span = el.firstElementChild as HTMLElement
    if (setup !== undefined) setup(span)
    return bw(span)
  }
  return { f32, Z, checks, check, eq, same, ctx, W, ceil64, put, bw, extent, lines, heightLines, minWidth, frame, t, lineCases, sw }
}

type Lib = ReturnType<typeof lib>
type Fn = (host: HTMLElement, L: Lib) => unknown
// Script prelude constants (declared here for the type checker; defined in the generated source).
declare const LS: number
declare const LBT: { cases: string[]; expected: string[]; dictionary: boolean[] }

function script(fn: Fn, prelude = ''): ObservationSpec {
  return {
    kind: 'script',
    source: `${prelude}\nconst L = (${lib.toString()})(host);\nconst value = await (${fn.toString()})(host, L);\n`
      + 'return { dpr: window.devicePixelRatio, visualViewportScale: window.visualViewport === null ? null : window.visualViewport.scale, checks: L.checks, value };',
  }
}

type Extra = { pageLang?: string | null; fontFixtures?: string[]; document?: string; note?: string; prelude?: string; observe?: ObservationSpec[] }

function probe(id: string, fn: Fn, extra: Extra = {}): Probe {
  const p: Probe = { id, spec: id.replace(/ \(.*\)$/, ''), pageLang: extra.pageLang === undefined ? 'en' : extra.pageLang, observe: [script(fn, extra.prelude ?? ''), ...(extra.observe ?? [])] }
  if (extra.fontFixtures !== undefined) p.fontFixtures = extra.fontFixtures
  if (extra.document !== undefined) p.document = extra.document
  if (extra.note !== undefined) p.note = extra.note
  return p
}

// ---- blink-lines §21 ----

const linesH1: Fn = (_host, L) => {
  const text = 'nnnnn nnnnn'
  const W16 = L.W('16px Arial', text)
  const C64 = L.ceil64(W16)
  const Wz = L.W(`${16 * L.Z}px Arial`, text)
  const Cz = L.ceil64(Wz)
  const el = L.put(`<div style="font:16px/20px Arial;padding:0;width:1000px">${text}</div>`)
  const count = (w: number): number => {
    el.style.width = `${w}px`
    return L.heightLines(el)
  }
  const widths = [(C64 - 1) / 64, (C64 - 2) / 64, (C64 - 1) / 64 + 1 / 128]
  const counts = widths.map(count)
  L.eq('width (C64 - 1)/64: 1 line', 1, counts[0], 1)
  L.eq('width (C64 - 2)/64: 2 lines', 2, counts[1], 1)
  L.eq('width (C64 - 1)/64 + 1/128: 1 line', 1, counts[2], 1)
  const zoomModel = (w: number): number => (Math.trunc(w * 64 * L.Z) + 1 >= Cz ? 1 : 2)
  L.eq('all three widths follow trunc(w * 64z) + 1 >= ceil64(W at z * 16px)', widths.map(zoomModel), counts)
  const threshold = L.minWidth(el, Math.floor(W16 * 512) - 256, Math.ceil(W16 * 512) + 256, 512, () => L.heightLines(el) === 1)
  L.eq('1-line threshold scanned in 1/512 px steps = (ceil64(W at z * 16px) - 1) / (64z)', (Cz - 1) / (64 * L.Z), threshold.width)
  el.style.width = '1000px'
  el.style.whiteSpace = 'nowrap'
  const dom = L.extent(el).width
  return { W16, C64, Wz, Cz, widths, counts, threshold, domNowrapWidth: dom, domRaw: dom * 64 * L.Z }
}

// Also CRITIC W8.
const linesH2: Fn = (_host, L) => {
  const text = 'nnnnn nnnnn'
  const W16 = L.W('16px Arial', text)
  const C64 = L.ceil64(W16)
  const W32 = L.W('32px Arial', text)
  const C128 = L.ceil64(W32)
  const el = L.put(`<div style="font:16px/20px Arial;padding:0;width:1000px">${text}</div>`)
  const count = (w: number): number => {
    el.style.width = `${w}px`
    return L.heightLines(el)
  }
  const c1 = count((C128 - 1) / 128)
  const c2 = count((C128 - 2) / 128)
  L.eq('width (C128 - 1)/128: 1 line', 1, c1, 2)
  L.eq('width (C128 - 2)/128: 2 lines (a +1/64 CSS px bound would keep 1 line)', 2, c2, 2)
  const rows: Array<{ k128: number; width: number; z1: number; z2: number; actual: number }> = []
  for (let k = 2 * C64 - 8; k <= 2 * C64 + 2; k++) {
    const w = k / 128
    rows.push({ k128: k, width: w, z1: Math.trunc(w * 64) + 1 >= C64 ? 1 : 2, z2: Math.trunc(w * 128) + 1 >= C128 ? 1 : 2, actual: count(w) })
  }
  const inRange = rows.filter(row => row.width >= C64 / 64 - 1 / 32 && row.width <= C64 / 64)
  L.check('nnnnn nnnnn: a width in [C64/64 - 1/32, C64/64] where the DPR 1 and DPR 2 formulas differ', inRange.some(row => row.z1 !== row.z2), true, inRange.map(row => `${row.k128}/128 z1=${row.z1} z2=${row.z2}`))
  L.eq('every scanned width follows the DPR 2 formula', rows.map(row => row.z2), rows.map(row => row.actual), 2)
  L.eq('every scanned width follows the DPR 1 formula', rows.map(row => row.z1), rows.map(row => row.actual), 1)
  // Supplementary strings whose two formulas give different thresholds, so the DPR 1 and DPR 2 runs can differ.
  const extra: Array<{ text: string; C64: number; C128: number; rows: Array<{ k128: number; z1: number; z2: number; actual: number }> }> = []
  const candidates = ['nnnn nnnn', 'Hello world', 'mmmmm mmmmm', 'abc def ghi', 'The quick brown', 'aaaa aaaa', 'xxxx xxxx', 'Lorem ipsum', 'nnn nnn', 'wwww wwww']
  for (let i = 0; i < candidates.length && extra.length < 3; i++) {
    const s = candidates[i]!
    const c64 = L.ceil64(L.W('16px Arial', s))
    const c128 = L.ceil64(L.W('32px Arial', s))
    if (c128 === 2 * c64 - 1) continue
    const other = L.put(`<div style="font:16px/20px Arial;padding:0;width:1000px">${s}</div>`)
    const sRows: Array<{ k128: number; z1: number; z2: number; actual: number }> = []
    for (let k = 2 * c64 - 4; k <= 2 * c64 + 1; k++) {
      other.style.width = `${k / 128}px`
      sRows.push({ k128: k, z1: Math.trunc((k / 128) * 64) + 1 >= c64 ? 1 : 2, z2: k + 1 >= c128 ? 1 : 2, actual: L.heightLines(other) })
    }
    extra.push({ text: s, C64: c64, C128: c128, rows: sRows })
  }
  L.eq('supplementary: strings where the formulas differ follow the DPR 2 formula', extra.map(e => e.rows.map(r => r.z2)), extra.map(e => e.rows.map(r => r.actual)), 2)
  L.eq('supplementary: strings where the formulas differ follow the DPR 1 formula', extra.map(e => e.rows.map(r => r.z1)), extra.map(e => e.rows.map(r => r.actual)), 1)
  return { W16, C64, W32, C128, c1, c2, rows, extra }
}

// Meaningful only in the run with --chrome-args=--force-device-scale-factor=1 --chrome-emulate-dsf=2.
const linesH3: Fn = (_host, L) => {
  const text = 'nnnnn nnnnn'
  const C64 = L.ceil64(L.W('16px Arial', text))
  const C128 = L.ceil64(L.W('32px Arial', text))
  const el = L.put(`<div style="font:16px/20px Arial;padding:0;width:1000px">${text}</div>`)
  const rows: Array<{ k128: number; z1: number; z2: number; actual: number }> = []
  for (let k = 2 * C64 - 8; k <= 2 * C64 + 2; k++) {
    el.style.width = `${k / 128}px`
    rows.push({ k128: k, z1: Math.trunc((k / 128) * 64) + 1 >= C64 ? 1 : 2, z2: Math.trunc(k) + 1 >= C128 ? 1 : 2, actual: L.heightLines(el) })
  }
  L.eq('devicePixelRatio reports 2', 2, L.Z)
  L.eq('line counts follow the layout-zoom-1 formula (probe 1 thresholds)', rows.map(row => row.z1), rows.map(row => row.actual))
  L.check('the DPR 2 formula differs somewhere in the scan (the probe can tell them apart)', rows.some(row => row.z1 !== row.z2), true, rows.map(row => `${row.k128}:${row.z1}/${row.z2}`))
  return { C64, C128, rows, matchMedia2dppx: matchMedia('(resolution: 2dppx)').matches }
}

const linesH4: Fn = (_host, L) => {
  const m = 'm'.repeat(20)
  const sizes = [17.29, 17.3, 17.31]
  const dom: number[] = []
  const canvas: number[] = []
  const canvasZ: number[] = []
  const readback: string[] = []
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i]!
    const el = L.put(`<div style="font:${s}px Arial;white-space:nowrap"><span>${m}</span></div>`)
    dom.push(L.bw(el.firstElementChild!))
    const c = L.ctx(`${s}px Arial`)
    canvas.push(c.measureText(m).width)
    readback.push(c.font)
    canvasZ.push(L.W(`${s * L.Z}px Arial`, m) / L.Z)
  }
  L.eq('DOM width at 17.3px equals 17.29px', dom[0], dom[1], 1)
  L.check('DOM width at 17.3px differs from 17.31px', dom[1] !== dom[2], `not ${dom[1]}`, dom[2], 1)
  L.eq('Canvas width at 17.3px equals 17.29px', canvas[0], canvas[1])
  return { sizes, dom, canvas, canvasZ, readback }
}

const linesH5: Fn = (_host, L) => {
  const cases: Array<[string, number]> = [['<b>foo</b>bar', 1], ['<b>foo </b>bar', 2], ['<b>foo</b> bar', 2], ['foo<span lang="ja">bar</span>', 1]]
  const out: unknown[] = []
  for (let i = 0; i < cases.length; i++) {
    const [html, expected] = cases[i]!
    const el = L.put(`<div style="width:1px;font:16px/20px Arial">${html}</div>`)
    const n = L.heightLines(el)
    out.push({ html, lines: n, texts: L.lines(el).texts })
    L.eq(`${html}: ${expected} line${expected === 1 ? '' : 's'}`, expected, n)
  }
  return out
}

const linesH6: Fn = (_host, L) => {
  const Z = L.Z
  const text = 'AAAA AAAA AAAA'
  const variants: Array<[string, string, string]> = [
    ['Arial', 'left', 'none'], ['Arial', 'right', 'none'], ['Arial', 'left', 'underline'],
    ["'Courier New'", 'left', 'none'], ["'Courier New'", 'right', 'none'], ["'Courier New'", 'left', 'underline'],
  ]
  const thresholds: Record<string, number | null> = {}
  const scans: unknown[] = []
  for (let i = 0; i < variants.length; i++) {
    const [family, align, decoration] = variants[i]!
    const whole = L.W(`16px ${family}`, text)
    const el = L.put(`<div style="font:16px/20px ${family};text-align:${align};text-decoration:${decoration}">${text}</div>`)
    const scan = L.minWidth(el, Math.floor(whole * 0.5 * 512), Math.ceil((whole + 4) * 512), 512, () => {
      const info = L.lines(el)
      return info.count === 1 || info.starts[1]! >= 10
    })
    thresholds[`${family} ${align} ${decoration}`] = scan.width
    scans.push({ family, align, decoration, scan, rawAtZ: scan.width === null ? null : scan.width * 64 * Z })
  }
  const kern = {
    legibility: L.W('16px Arial', 'A ', { textRendering: 'optimizeLegibility' }) - L.W('16px Arial', 'A') - L.W('16px Arial', ' '),
    kerningNormal: L.W('16px Arial', 'A ', { fontKerning: 'normal' }) - L.W('16px Arial', 'A') - L.W('16px Arial', ' '),
    legibilityZ: (L.W(`${16 * Z}px Arial`, 'A ', { textRendering: 'optimizeLegibility' }) - L.W(`${16 * Z}px Arial`, 'A') - L.W(`${16 * Z}px Arial`, ' ')) / Z,
    domAspace: L.sw('A ', 'white-space:pre', undefined, 'font:16px/20px Arial'),
    domA: L.sw('A', 'white-space:pre', undefined, 'font:16px/20px Arial'),
    domSpace: L.sw(' ', 'white-space:pre', undefined, 'font:16px/20px Arial'),
  }
  const arialLeft = thresholds['Arial left none']!
  const arialRight = thresholds['Arial right none']!
  const arialUnder = thresholds['Arial left underline']!
  const k = kern.legibilityZ
  L.check('Arial: right-aligned threshold exceeds left by the (A, space) kerning (within one layout unit)', Math.abs((arialRight - arialLeft) - (-k)) <= 1 / (64 * Z), -k, arialRight - arialLeft)
  L.eq('Arial: underline threshold equals the right-aligned one', arialRight, arialUnder)
  L.eq('Courier New: the three thresholds are equal', [thresholds["'Courier New' left none"], thresholds["'Courier New' left none"]], [thresholds["'Courier New' right none"], thresholds["'Courier New' left underline"]])
  return { thresholds, scans, kern }
}

// H7 (LS = 0) and H8 (LS = 3).
const linesHyphen: Fn = (_host, L) => {
  const Z = L.Z
  const fz = `${16 * Z}px Arial`
  const spacing = LS === 0 ? undefined : { letterSpacing: `${LS * Z}px` }
  const u2010 = L.ceil64(L.W(fz, '‐', { letterSpacing: '0px' }))
  const minus = L.ceil64(L.W(fz, '-', { letterSpacing: '0px' }))
  // If Arial lacked U+2010, the next family in the list would take it and the two widths would differ.
  const arialHasU2010 = L.W('16px Arial, monospace', '‐') === L.W('16px Arial, serif', '‐')
  const H = arialHasU2010 ? u2010 : minus
  const A = L.ceil64(L.W(fz, 'cc aaaa', spacing))
  const el = L.put(`<div style="font:16px/20px Arial;letter-spacing:${LS}px">cc aaaa&shy;bbbb</div>`)
  const at = (raw: number): { raw: number; width: number; starts: number[]; texts: string[]; rights: number[] } => {
    el.style.width = `${raw / (64 * Z)}px`
    const info = L.lines(el)
    return { raw, width: raw / (64 * Z), starts: info.starts, texts: info.texts, rights: info.rights }
  }
  const w1 = at(A + H - 1)
  const w2 = at(A + H - 2)
  L.eq('width A + H - 1 layout unit: lines "cc aaaa-" / "bbbb" (starts 0, 8)', [0, 8], w1.starts)
  L.eq('width A + H - 2 layout units: lines "cc" / "aaaa-" / "bbbb" (starts 0, 3, 8)', [0, 3, 8], w2.starts)
  const other = arialHasU2010 ? minus : u2010
  const alt = { H: other, w1: at(A + other - 1), w2: at(A + other - 2) }
  const threshold = L.minWidth(el, A - 64 * Z, A + H + 4 * 64 * Z, 1, () => {
    const info = L.lines(el)
    return info.starts.length >= 2 && info.starts[1]! >= 8
  })
  const scanRaw = L.minWidth(el, (A - 64 * Z) * 1, (A + H + 4 * 64 * Z), 64 * Z, () => {
    const info = L.lines(el)
    return info.starts.length >= 2 && info.starts[1]! >= 8
  })
  L.eq('smallest width keeping "cc aaaa-" on line 1 = A + H - 1 layout unit', A + H - 1, scanRaw.k)
  return { LS, Z, u2010, minus, arialHasU2010, A, H, w1, w2, alt, thresholdCssPx: threshold, scanRaw }
}

const linesH9: Fn = (_host, L) => {
  const Z = L.Z
  const C = L.ceil64(L.W(`${16 * Z}px Arial`, 'nnnn nnnn', { letterSpacing: `${3 * Z}px` }))
  const el = L.put('<div style="font:16px/20px Arial;letter-spacing:3px">nnnn nnnn</div>')
  const count = (raw: number): number => {
    el.style.width = `${raw / (64 * Z)}px`
    return L.heightLines(el)
  }
  L.eq('width C - 1 layout unit: 1 line', 1, count(C - 1))
  L.eq('width C - 2 layout units: 2 lines', 2, count(C - 2))
  L.eq('width C - 3px - 1 layout unit (where a trimmed trailing spacing would fit): 2 lines', 2, count(C - 3 * 64 * Z - 1))
  const scan = L.minWidth(el, C - 8 * 64 * Z, C + 64 * Z, 64 * Z, () => L.heightLines(el) === 1)
  L.eq('scanned 1-line threshold = C - 1 layout unit', C - 1, scan.k)
  return { Z, C, scan, C16: L.ceil64(L.W('16px Arial', 'nnnn nnnn', { letterSpacing: '3px' })) }
}

const linesH10: Fn = (host, L) => {
  const Z = L.Z
  const fz = `${16 * Z}px 'Courier New'`
  const S = L.W("16px 'Courier New'", ' ')
  const Sz = L.W(fz, ' ')
  const cases: Array<[string, number]> = [['aaaaaaaa\tb', 0], ['aaaaaaa\tb', 0], ['aaaaaaaa\tb', 2]]
  const out: Array<{ text: string; ls: number; bLeft: number; spec: number; model: number; posRaw: number; d: number }> = []
  for (let i = 0; i < cases.length; i++) {
    const [text, ls] = cases[i]!
    const el = L.put(`<div style="white-space:pre;tab-size:8;font:16px/20px 'Courier New';letter-spacing:${ls}px"></div>`)
    el.textContent = text
    const node = el.firstChild as Text
    const range = document.createRange()
    range.setStart(node, text.length - 1)
    range.setEnd(node, text.length)
    const list = range.getClientRects()
    const bLeft = list[list.length - 1]!.left - host.getBoundingClientRect().left
    const prefix = text.slice(0, text.indexOf('\t'))
    const posRaw = L.ceil64(L.W(fz, prefix, ls === 0 ? undefined : { letterSpacing: `${ls * Z}px` }))
    const base = L.f32(8 * L.f32(Sz + ls * Z))
    let d = L.f32(base - ((posRaw / 64) % base))
    if (d < Sz / 2) d = L.f32(d + base)
    out.push({ text, ls, bLeft, spec: (posRaw / 64 + d) / Z, model: (posRaw + L.ceil64(Math.round(d * 65536) / 65536)) / (64 * Z), posRaw, d })
  }
  const unit = 1 / (64 * Z)
  const [eight, seven, spaced] = out as [typeof out[0], typeof out[0], typeof out[0]]
  L.check('aaaaaaaa\\tb: b left = ceil64(8S)/64 + d (within one layout unit)', Math.abs(eight.bLeft - eight.spec) <= unit, eight.spec, eight.bLeft)
  if (Number.isInteger(8 * Sz * 64)) L.check('8S is on the 1/64 grid, so b sits at 16S (within one layout unit)', Math.abs(eight.bLeft - 16 * S) <= unit, 16 * S, eight.bLeft)
  const sevenCondition = 8 * Sz - L.ceil64(7 * Sz) / 64 >= Sz / 2
  if (sevenCondition) L.check('aaaaaaa\\tb: b at 8S (within one layout unit)', Math.abs(seven.bLeft - 8 * S) <= unit, 8 * S, seven.bLeft)
  L.check('letter-spacing 2px: the stop is 8 x (S + 2), so b at 16 x (S + 2) (within one layout unit)', Math.abs(spaced.bLeft - 16 * (S + 2)) <= unit, 16 * (S + 2), spaced.bLeft)
  return { S, Sz, out, sevenCondition }
}

const linesH11: Fn = (_host, L) => {
  const Z = L.Z
  const width = L.ceil64(L.W(`${16 * Z}px Arial`, 'nnnn')) / (64 * Z) + 1
  const text = 'nnnn      nnnn'
  const pw = L.put(`<div style="font:16px/20px Arial;white-space:pre-wrap;width:${width}px">${text}</div>`)
  const pwInfo = L.lines(pw)
  const pwLines = L.heightLines(pw)
  L.eq('pre-wrap: 2 lines', 2, pwLines)
  L.check('pre-wrap: the first line extends past the div (spaces hang)', pwInfo.rights[0]! > width, `> ${width}`, pwInfo.rights[0])
  const bs = L.put(`<div style="font:16px/20px Arial;white-space:break-spaces;width:${width}px">${text}</div>`)
  const bsInfo = L.lines(bs)
  L.eq('break-spaces: 3 lines', 3, L.heightLines(bs))
  L.eq('break-spaces: "nnnn ", 5 spaces, "nnnn"', ['nnnn ', '     ', 'nnnn'], bsInfo.texts)
  return { width, pwLines, pwInfo, bsInfo }
}

const linesH12: Fn = (_host, L) => {
  const Z = L.Z
  const fz = `${16 * Z}px 'Times New Roman'`
  const model = (L.ceil64(L.W(fz, 'A')) + L.ceil64(L.W(fz, 'V'))) / (64 * Z)
  const dom: Record<string, number> = {}
  const controls: Array<[string, string]> = [['FF', '\f'], ['CR', '\r']]
  for (let i = 0; i < controls.length; i++) {
    const [name, ch] = controls[i]!
    const el = L.put("<div style=\"white-space:pre-wrap;font:16px/20px 'Times New Roman'\"><span></span></div>")
    const span = el.firstElementChild as HTMLElement
    span.textContent = `A${ch}V`
    dom[name] = L.bw(span)
  }
  const domAV = L.sw('AV', '', undefined, "font:16px/20px 'Times New Roman'")
  const canvasFF = L.W("16px 'Times New Roman'", 'A\fV')
  const canvasSpace = L.W("16px 'Times New Roman'", 'A V')
  L.eq('pre-wrap span A\\fV: width = ceil64(W(A))/64 + ceil64(W(V))/64 (no kerning)', model, dom['FF'])
  L.eq('Canvas measureText("A\\fV") = measureText("A V")', canvasSpace, canvasFF)
  return { model, dom, domAV, canvasFF, canvasSpace, canvasCR: L.W("16px 'Times New Roman'", 'A\rV') }
}

const linesH13: Fn = (_host, L) => {
  const Z = L.Z
  const el = L.put('<div style="width:60px;font:16px/20px Arial">aaaaaaaaaaaaaaaa<span style="overflow-wrap:anywhere">bbbbbbbb</span></div>')
  const info = L.lines(el)
  L.eq('line 1 = the unbreakable prefix plus exactly one b', 'a'.repeat(16) + 'b', info.texts[0])
  const avail = Math.trunc(60 * 64 * Z) + 1
  const expected = ['a'.repeat(16) + 'b']
  let left = 7
  while (left > 0) {
    let n = 1
    while (n < left && L.ceil64(L.W(`${16 * Z}px Arial`, 'b'.repeat(n + 1))) <= avail) n++
    expected.push('b'.repeat(n))
    left -= n
  }
  L.eq('the remaining b\'s fill by grapheme (greedy over Canvas widths at the zoomed size)', expected, info.texts)
  return { info, expected }
}

const linesH14: Fn = (_host, L) => {
  const Z = L.Z
  const fz = `${16 * Z}px Arial`
  const el = L.put('<div style="font:16px/20px Arial">aaaa&shy;<span>bbbb</span></div>')
  const n = L.heightLines(el)
  const lineWidth = L.extent(el).width
  const model = (L.ceil64(L.W(fz, 'aaaa­')) + L.ceil64(L.W(fz, 'bbbb'))) / (64 * Z)
  const withShy = L.bw(L.put('<div style="font:16px/20px Arial;width:max-content">aaaa&shy;<span>bbbb</span></div>'))
  const withoutShy = L.bw(L.put('<div style="font:16px/20px Arial;width:max-content">aaaa<span>bbbb</span></div>'))
  L.eq('1 line', 1, n)
  L.eq('line width = ceil64(W("aaaa­")) + ceil64(W("bbbb")) in layout units', model, lineWidth)
  L.eq('no hyphen: max-content width equals the markup without the soft hyphen', withoutShy, withShy)
  return { n, lineWidth, model, withShy, withoutShy }
}

const linesH15: Fn = (_host, L) => {
  const Z = L.Z
  const text = 'あああ」いいい'
  const out: Record<string, unknown> = {}
  const families = ["'Hiragino Sans'", "'Courier New'"]
  const firstLines: Record<string, { at4: string; at9: string }> = {}
  for (let i = 0; i < families.length; i++) {
    const family = families[i]!
    const F = L.ceil64(L.W(`${16 * Z}px ${family}`, 'あああ」')) / (64 * Z)
    const el = L.put(`<div style="font:16px/20px ${family}">${text}</div>`)
    const at = (w: number): string[] => {
      el.style.width = `${w}px`
      return L.lines(el).texts
    }
    const at4 = at(F - 4)
    const at9 = at(F - 9)
    const scan = L.minWidth(el, Math.floor((F - 16) * 64 * Z), Math.ceil((F + 1) * 64 * Z), 64 * Z, () => {
      const info = L.lines(el)
      return info.count === 1 || info.starts[1]! >= 4
    })
    firstLines[family] = { at4: at4[0] ?? '', at9: at9[0] ?? '' }
    out[family] = {
      F, at4, at9, scan, scanCss: scan.width, untrimmedMinusScan: scan.width === null ? null : F - scan.width,
      bracketCanvas: L.W(`16px ${family}`, '」'), bracketDom: L.sw('」', 'white-space:nowrap', undefined, `font:16px/20px ${family}`),
    }
  }
  L.eq('Hiragino Sans, width F - 4: line 1 is "あああ」"', 'あああ」', firstLines["'Hiragino Sans'"]!.at4)
  L.check('Hiragino Sans, width F - 9: line 1 no longer ends with 」', !firstLines["'Hiragino Sans'"]!.at9.endsWith('」'), 'not ending in 」', firstLines["'Hiragino Sans'"]!.at9)
  L.check('Courier New with fallback, width F - 4: 」 stays off line 1', !firstLines["'Courier New'"]!.at4.endsWith('」'), 'not ending in 」', firstLines["'Courier New'"]!.at4)
  return out
}

const linesH16: Fn = (_host, L) => {
  const Z = L.Z
  const text = 'nnn nnnn nnnn nnnn'
  const sizes = [16, 16.1, 16.3, 17.7, 13.37, 15.55]
  const out: unknown[] = []
  const summary: string[] = []
  for (let s = 0; s < sizes.length; s++) {
    const size = sizes[s]!
    const fz = `${size * Z}px 'Times New Roman'`
    const P: number[] = []
    for (let k = 0; k <= text.length; k++) P.push(k === 0 ? 0 : L.W(fz, text.slice(0, k)))
    const pos = P.map(L.ceil64)
    const posDiff = pos[18]! - pos[9]!
    const widthRaw = L.ceil64(P[18]! - P[9]!)
    const el = L.put(`<div style="font:${size}px/30px 'Times New Roman'">${text}</div>`)
    const rows: Array<{ raw: number; starts: number[]; line1Ok: boolean; positionModel: number[]; widthModel: number[] }> = []
    for (let raw = Math.min(posDiff, widthRaw) - 3; raw <= Math.max(posDiff, widthRaw) + 3; raw++) {
      el.style.width = `${raw / (64 * Z)}px`
      const starts = L.lines(el).starts
      const fit = raw + 1
      rows.push({ raw, starts, line1Ok: pos[8]! <= fit && pos[13]! > fit, positionModel: posDiff <= fit ? [0, 9] : [0, 9, 14], widthModel: widthRaw <= fit ? [0, 9] : [0, 9, 14] })
    }
    const mismatch = rows.filter(row => row.line1Ok && !L.same(row.positionModel, row.widthModel))
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
      if (!row.line1Ok) continue
      const disagree = !L.same(row.positionModel, row.widthModel)
      L.eq(`${size}px, available ${row.raw} layout units${disagree ? ' (models disagree)' : ''}: line starts follow ceil64(P(b) - P(start))`, row.widthModel, row.starts)
    }
    summary.push(`${size}px: ${mismatch.map(row => row.raw).join('|') || 'none'}`)
    out.push({ size, P, pos, posDiff, widthRaw, rows, mismatchRaws: mismatch.map(row => row.raw) })
  }
  L.check('some width scan shows a 1-unit position/width mismatch', summary.some(line => !line.endsWith('none')), true, summary)
  return out
}

// ---- blink-text §6 ----

const textH1: Fn = (_host, L) => L.lineCases([
  { label: 'foo<b>bar</b>', inner: 'foo<b>bar</b>', expected: 1 },
  { label: 'foo <b>bar</b>', inner: 'foo <b>bar</b>', expected: 2 },
  { label: 'foo<span lang=zh>bar</span>', inner: 'foo<span lang="zh">bar</span>', expected: 1 },
])

const textH2: Fn = (_host, L) => {
  const div = "font:48px/60px 'Helvetica Neue'"
  const w = (inner: string, style = ''): number => L.sw(inner, style, undefined, div)
  const redV = w('<span>A</span><span style="color:red">V</span>')
  const av = w('<span>AV</span>')
  const lsPair = w('<span>A</span><span style="letter-spacing:0.01px">V</span>')
  const a = w('A')
  const v = w('V')
  const vls = w('V', 'letter-spacing:0.01px')
  const padded = w('A<span style="padding-left:0.001px">V</span>')
  L.eq('A and red V in one group: width equals <span>AV</span>', av, redV)
  L.eq('V with letter-spacing 0.01px: width = width(A) + width(V with spacing), no kern', a + vls, lsPair)
  L.check('V with padding-left 0.001px: width >= width(A) + width(V)', padded >= a + v, `>= ${a + v}`, padded)
  return { redV, av, lsPair, a, v, vls, padded, kern: av - (a + v) }
}

const textH3: Fn = (_host, L) => {
  const div = "font:40px/60px 'Geeza Pro'"
  const w = (inner: string): number => L.sw(inner, '', undefined, div)
  const joined = w('ب<b>ب</b>')
  const initial = w('ب‍')
  const boldFinal = w('<b>‍ب</b>')
  const isolated = w('ب')
  const boldIsolated = w('<b>ب</b>')
  const parts = L.put(`<div style="${div}"><span id="a">ب</span><b id="b">ب</b></div>`)
  const first = L.bw(parts.querySelector('#a')!)
  const second = L.bw(parts.querySelector('#b')!)
  L.eq('width = width(initial ب) + width(bold final ب)', initial + boldFinal, joined)
  L.check('width differs from width(ب) + width(bold ب) in separate paragraphs', joined !== isolated + boldIsolated, `not ${isolated + boldIsolated}`, joined)
  const sameFont = w('\u0628<span style="color:red">\u0628</span>')
  const final = w('\u200D\u0628')
  L.check('supplementary: Geeza Pro (AAT morx, no GSUB) joins inside one shaping group: ب + red ب differs from two isolated forms', sameFont !== 2 * isolated, `not ${2 * isolated}`, sameFont)
  const naskhDiv = "font:40px/80px 'Noto Naskh Arabic'"
  const n = (inner: string): number => L.sw(inner, '', undefined, naskhDiv)
  const naskh = {
    joined: n('\u0628<b>\u0628</b>'), initial: n('\u0628\u200D'), boldFinal: n('<b>\u200D\u0628</b>'), isolated: n('\u0628'),
    boldIsolated: n('<b>\u0628</b>'), sameFont: n('\u0628<span style="color:red">\u0628</span>'), final: n('\u200D\u0628'),
  }
  L.eq('supplementary: Noto Naskh Arabic (OpenType GSUB): width = initial ب + bold final ب', naskh.initial + naskh.boldFinal, naskh.joined)
  L.check('supplementary: Noto Naskh Arabic: width differs from isolated + bold isolated', naskh.joined !== naskh.isolated + naskh.boldIsolated, `not ${naskh.isolated + naskh.boldIsolated}`, naskh.joined)
  return { joined, initial, boldFinal, isolated, boldIsolated, first, second, sameFont, final, naskh }
}

const textH4: Fn = (_host, L) => {
  const set = (el: HTMLElement): void => { el.textContent = 'a\rb' }
  const normal = L.t('', '', set)
  const preLine = L.t('', 'white-space:pre-line', set)
  const preWrap = L.t('', 'white-space:pre-wrap', set)
  L.eq('normal "a\\rb": 2 lines', 2, normal.lines)
  L.eq('pre-line: 2 lines', 2, preLine.lines)
  L.eq('pre-wrap: 1 line', 1, preWrap.lines)
  const spanNormal = L.sw('', '', set)
  const spanSpace = L.sw('a b')
  const spanPreWrap = L.sw('', 'white-space:pre-wrap', set)
  const spanAb = L.sw('ab')
  L.eq('normal span width = width("a b")', spanSpace, spanNormal)
  L.eq('pre-wrap span width = width("ab")', spanAb, spanPreWrap)
  return { normal, preLine, preWrap, spanNormal, spanSpace, spanPreWrap, spanAb }
}

const textH5: Fn = (_host, L) => {
  const set = (el: HTMLElement): void => { el.textContent = 'a\fb' }
  const normal = L.t('', '', set)
  const preWrap = L.t('', 'white-space:pre-wrap', set)
  const spanNormal = L.sw('', '', set)
  const spanPreWrap = L.sw('', 'white-space:pre-wrap', set)
  const spanSpace = L.sw('a b')
  const spanAb = L.sw('ab')
  L.eq('normal "a\\fb": 1 line', 1, normal.lines)
  L.check('normal width differs from width("a b")', spanNormal !== spanSpace, `not ${spanSpace}`, spanNormal)
  L.check('normal width >= width("ab")', spanNormal >= spanAb, `>= ${spanAb}`, spanNormal)
  L.eq('pre-wrap: 1 line', 1, preWrap.lines)
  L.eq('pre-wrap width = width("ab")', spanAb, spanPreWrap)
  return { normal, preWrap, spanNormal, spanPreWrap, spanSpace, spanAb }
}

const textH6: Fn = (_host, L) => {
  const set = (el: HTMLElement): void => { el.textContent = 'a\vb' }
  const normal = L.t('', '', set)
  const preWrap = L.t('', 'white-space:pre-wrap', set)
  const spanNormal = L.sw('', '', set)
  const spanPreWrap = L.sw('', 'white-space:pre-wrap', set)
  const spanAb = L.sw('ab')
  L.eq('normal "a\\vb": 1 line', 1, normal.lines)
  L.eq('pre-wrap: 1 line', 1, preWrap.lines)
  L.check('pre-wrap width differs from width("ab")', spanPreWrap !== spanAb, `not ${spanAb}`, spanPreWrap)
  return { normal, preWrap, spanNormal, spanPreWrap, spanAb, spanSpace: L.sw('a b') }
}

const textH7: Fn = (_host, L) => {
  const span = (text: string): HTMLElement => Object.assign(document.createElement('span'), { textContent: text })
  const ff = L.t('', '', el => el.append('a\f', '\n', span('b')))
  const control = L.t('', '', el => el.append('a', '\n', span('b')))
  L.eq('append("a\\f", "\\n", <span>b</span>): 1 line', 1, ff.lines)
  L.eq('control append("a", "\\n", <span>b</span>): 2 lines', 2, control.lines)
  return { ff, control }
}

const textH8: Fn = (_host, L) => {
  const span = (text: string): HTMLElement => Object.assign(document.createElement('span'), { textContent: text })
  const vt = L.t('', '', el => el.append('a\v', '\n', span('b')))
  const control = L.t('', '', el => el.append(span('a\f'), '\n', span('b')))
  L.eq('append("a\\v", "\\n", <span>b</span>): 1 line', 1, vt.lines)
  L.eq('control append(<span>a\\f</span>, "\\n", <span>b</span>): 2 lines', 2, control.lines)
  return { vt, control }
}

const textH9: Fn = (_host, L) => {
  const zwspNewline = L.sw('a&#x200B;\nb')
  const zwsp = L.sw('a​b')
  const ab = L.sw('ab')
  const newline = L.sw('a\nb')
  const space = L.sw('a b')
  L.eq('<span>a&#x200B;\\nb</span> = width("a​b")', zwsp, zwspNewline)
  L.eq('<span>a&#x200B;\\nb</span> = width("ab")', ab, zwspNewline)
  L.eq('<span>a\\nb</span> = width("a b")', space, newline)
  return { zwspNewline, zwsp, ab, newline, space }
}

const textH10: Fn = (_host, L) => L.lineCases([{ label: 'a )', inner: 'a )', expected: 2 }])

const textH11: Fn = (_host, L) => L.lineCases([
  { label: 'x!é', inner: 'x!é', expected: 2 },
  { label: 'x!a', inner: 'x!a', expected: 1 },
  { label: 'x/é', inner: 'x/é', expected: 2 },
  { label: 'x/a', inner: 'x/a', expected: 1 },
])

const textH12: Fn = (_host, L) => L.lineCases([
  { label: 'a NEL b in #t', data: 'ab', expected: 2 },
  { label: 'a NEL b at width 1000px', data: 'ab', style: 'width:1000px', expected: 1 },
])

const textH13: Fn = (_host, L) => {
  const out = L.lineCases([
    { label: 'a U+2028 b at width 1000px', data: 'a b', style: 'width:1000px', expected: 1 },
    { label: 'a U+2028 b in #t', data: 'a b', expected: 2 },
  ])
  const span = L.sw('', '', el => { el.textContent = 'a b' })
  const space = L.sw('a b')
  L.eq('unconstrained span width = width("a b")', space, span)
  return { out, span, space }
}

const textH14: Fn = (_host, L) => L.lineCases([
  { label: 'lang=en', attrs: 'lang="en"', inner: 'a”b', expected: 1 },
  { label: 'lang=zh', attrs: 'lang="zh"', inner: 'a”b', expected: 2 },
  { label: 'lang=zh-TW', attrs: 'lang="zh-TW"', inner: 'a”b', expected: 2 },
  { label: 'lang=zh-HK', attrs: 'lang="zh-HK"', inner: 'a”b', expected: 2 },
  { label: 'lang=ja', attrs: 'lang="ja"', inner: 'a”b', expected: 1 },
  { label: 'lang=ja line-break:normal', attrs: 'lang="ja"', style: 'line-break:normal', inner: 'a”b', expected: 2 },
  { label: 'lang=cmn', attrs: 'lang="cmn"', inner: 'a”b', expected: 1 },
])

// No-lang document.
const textH15: Fn = (_host, L) => {
  const chinese = navigator.language.toLowerCase().startsWith('zh')
  const out = L.lineCases([{ label: `no lang anywhere, UI language ${navigator.language}`, inner: 'a”b', expected: chinese ? 2 : 1 }])
  return { navigatorLanguage: navigator.language, hasLang: document.documentElement.hasAttribute('lang'), out }
}

const textH16: Fn = (_host, L) => L.lineCases([{ label: '<html lang=en>, line-break:strict', inner: 'あぁ', style: 'line-break:strict', expected: 1 }])

// No-lang document.
const textH16NoLang: Fn = (_host, L) => ({
  hasLang: document.documentElement.hasAttribute('lang'),
  out: L.lineCases([{ label: 'no lang anywhere, line-break:strict', inner: 'あぁ', style: 'line-break:strict', expected: 2 }]),
})

const textH17: Fn = (_host, L) => L.lineCases([
  { label: 'lang=ko line-break:strict', attrs: 'lang="ko"', style: 'line-break:strict', inner: 'あぁ', expected: 2 },
  { label: 'lang=ja line-break:strict', attrs: 'lang="ja"', style: 'line-break:strict', inner: 'あぁ', expected: 1 },
])

const textH18: Fn = (_host, L) => L.lineCases([
  { label: 'あ々 loose', style: 'line-break:loose', inner: 'あ々', expected: 2 },
  { label: 'あ々 auto', style: 'line-break:auto', inner: 'あ々', expected: 1 },
  { label: '一‥‥ loose', style: 'line-break:loose', inner: '一‥‥', expected: 2 },
  { label: '一‥‥ auto', style: 'line-break:auto', inner: '一‥‥', expected: 1 },
])

const textH19: Fn = (_host, L) => L.lineCases([
  { label: '一一 keep-all', style: 'word-break:keep-all', inner: '一一', expected: 1 },
  { label: 'U+20000 x2 keep-all', style: 'word-break:keep-all', inner: '\u{20000}\u{20000}', expected: 2 },
  { label: '한국어 keep-all', style: 'word-break:keep-all', inner: '한국어', expected: 1 },
  { label: 'ภาษาไทย keep-all', style: 'word-break:keep-all', inner: 'ภาษาไทย', expected: 2 },
])

const textH20: Fn = (_host, L) => {
  const out = L.lineCases([
    { label: 'a‐b break-all loose', style: 'word-break:break-all;line-break:loose', inner: 'a‐b', expected: 3 },
    { label: 'a‐b break-all', style: 'word-break:break-all', inner: 'a‐b', expected: 2 },
  ])
  // Supplementary: a line that starts with the hyphen, the loose rule alone, U+2013, and ICU's own boundaries.
  const variants: unknown[] = []
  const cases: Array<[string, string, string]> = [
    ['‐b break-all loose', 'word-break:break-all;line-break:loose', '‐b'],
    ['‐b break-all', 'word-break:break-all', '‐b'],
    ['a‐b loose', 'line-break:loose', 'a‐b'],
    ['a\u2013b break-all loose (U+2013)', 'word-break:break-all;line-break:loose', 'a\u2013b'],
    ['1‐b break-all loose', 'word-break:break-all;line-break:loose', '1‐b'],
    ['xya‐b break-all loose', 'word-break:break-all;line-break:loose', 'xya‐b'],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [label, style, inner] = cases[i]!
    variants.push({ label, ...L.t(inner, style) })
  }
  type Bi = { adoptText(t: string): void; first(): number; next(): number }
  const Ctor = (Intl as unknown as { v8BreakIterator: new (locales: string[], options: { type: string }) => Bi }).v8BreakIterator
  const v8 = (text: string): number[] => {
    const bi = new Ctor(['en'], { type: 'line' })
    bi.adoptText(text)
    const b = [bi.first()]
    for (let p = bi.next(); p !== -1; p = bi.next()) b.push(p)
    return b
  }
  const icu = { 'a‐b': v8('a‐b'), '‐b': v8('‐b'), aEnDashB: v8('a\u2013b'), enDashB: v8('\u2013b') }
  L.check('supplementary: ‐b break-all loose at width 0 gives 2 lines (break-all table BA -> AL at a line start)', (variants[0] as { lines: number }).lines === 2, 2, (variants[0] as { lines: number }).lines)
  return { out, variants, icu }
}

const textH21: Fn = (_host, L) => L.lineCases([
  { label: '$% break-all', style: 'word-break:break-all', inner: '$%', expected: 2 },
  { label: '$% normal', style: 'word-break:normal', inner: '$%', expected: 1 },
])

const textH22: Fn = (_host, L) => L.lineCases([{ label: 'nowrap foo<wbr>bar', style: 'white-space:nowrap', inner: 'foo<wbr>bar', expected: 2 }])

const textH23: Fn = (_host, L) => {
  const r = L.t('<span style="white-space:nowrap">foo </span> bar')
  L.eq('2 lines', 2, r.lines)
  L.eq('line 2 starts with "bar" at left 0', ['bar', 0], [r.texts[1], r.lefts[1]])
  return r
}

const textH24: Fn = (_host, L) => {
  const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  return L.lineCases([
    { label: 'abc<img>def (no src)', inner: 'abc<img style="width:10px;height:10px">def', expected: 3 },
    { label: 'abc&nbsp;<img> (no src)', inner: 'abc&nbsp;<img style="width:10px;height:10px">', expected: 2 },
    { label: 'abc<img src=gif>def', inner: `abc<img src="${gif}" style="width:10px;height:10px">def`, expected: 3 },
    { label: 'abc&nbsp;<img src=gif>', inner: `abc&nbsp;<img src="${gif}" style="width:10px;height:10px">`, expected: 2 },
    { label: 'abc<inline-block>def', inner: 'abc<span style="display:inline-block;width:10px;height:10px"></span>def', expected: 3 },
    { label: 'abc&nbsp;<inline-block>', inner: 'abc&nbsp;<span style="display:inline-block;width:10px;height:10px"></span>', expected: 2 },
  ])
}

const textH25: Fn = (_host, L) => L.lineCases([
  { label: 'super&shy;cali', inner: 'super&shy;cali', expected: 2 },
  { label: 'super&shy;cali hyphens:none', style: 'hyphens:none', inner: 'super&shy;cali', expected: 1 },
])

const textH26: Fn = (_host, L) => {
  const tech = '\u{1F469}‍\u{1F4BB}\u{1F469}‍\u{1F4BB}'
  return L.lineCases([
    { label: '👩‍💻👩‍💻', inner: tech, expected: 2 },
    { label: '👩‍💻👩‍💻 break-all', style: 'word-break:break-all', inner: tech, expected: 2 },
    { label: '👩‍💻👩‍💻 keep-all', style: 'word-break:keep-all', inner: tech, expected: 2 },
    { label: 'x🇯🇵🇺🇸', inner: 'x\u{1F1EF}\u{1F1F5}\u{1F1FA}\u{1F1F8}', expected: 3 },
  ])
}

const textH27: Fn = (_host, L) => {
  const div = 'font:48px/60px Times'
  const fiSpaced = L.sw('fi', 'letter-spacing:0.001px', undefined, div)
  const f = L.sw('f', '', undefined, div)
  const i = L.sw('i', '', undefined, div)
  const fi = L.sw('fi', '', undefined, div)
  const cSpaced = L.W('48px Times', 'fi', { letterSpacing: '0.001px' })
  const cf = L.W('48px Times', 'f')
  const ci = L.W('48px Times', 'i')
  const cfi = L.W('48px Times', 'fi')
  const ligature = Math.abs(cfi - (cf + ci)) > 1 / 64
  L.check('DOM fi with letter-spacing 0.001px = width(f) + width(i) + 0.002 (+-1/64)', Math.abs(fiSpaced - (f + i + 0.002)) <= 1 / 64, f + i + 0.002, fiSpaced)
  L.check('Canvas letterSpacing 0.001px: W(fi) = W(f) + W(i) + 0.002 (+-1/64)', Math.abs(cSpaced - (cf + ci + 0.002)) <= 1 / 64, cf + ci + 0.002, cSpaced)
  L.check('Times has an fi ligature (the probe can tell)', ligature, true, { cfi, sum: cf + ci })
  if (ligature) L.check('Canvas letterSpacing 0.001px: not the ligature width', Math.abs(cSpaced - cfi) > 1 / 64, `not ${cfi}`, cSpaced)
  return { fiSpaced, f, i, fi, cSpaced, cf, ci, cfi }
}

const textH28: Fn = (_host, L) => {
  const out: Record<string, number> = {}
  const fonts = ["16px 'Helvetica Neue'", '16px Arial']
  for (let k = 0; k < fonts.length; k++) {
    const font = fonts[k]!
    const space = L.W(font, 'a b')
    const controls: Array<[string, string]> = [['FF', '\f'], ['VT', '\v'], ['CR', '\r']]
    for (let i = 0; i < controls.length; i++) {
      const [name, ch] = controls[i]!
      const w = L.W(font, `a${ch}b`)
      out[`${font} ${name}`] = w
      L.eq(`${font}: measureText("a\\${name === 'FF' ? 'f' : name === 'VT' ? 'v' : 'r'}b") = measureText("a b")`, space, w)
    }
    L.eq(`${font}: measureText("a­b") = measureText("ab")`, L.W(font, 'ab'), L.W(font, 'a­b'))
    out[`${font} space`] = space
  }
  return out
}

const textH29: Fn = (_host, L) => {
  const Z = L.Z
  const canvas = L.W("40px 'Geeza Pro'", 'ب‍')
  const canvasZ = L.W(`${40 * Z}px 'Geeza Pro'`, 'ب‍')
  const el = L.put("<div style=\"font:40px/60px 'Geeza Pro'\"><span>ب</span><b>ب</b></div>")
  const dom = L.bw(el.firstElementChild!)
  L.check('measureText("ب‍") = DOM width of the first ب (within one layout unit at DPR 1)', Math.abs(canvas - dom) <= 1 / 64, canvas, dom, 1)
  L.eq('DOM width of the first ب = ceil64(W("ب‍") at the zoomed size)', L.ceil64(canvasZ) / (64 * Z), dom)
  const naskhCanvas = L.W("40px 'Noto Naskh Arabic'", '\u0628\u200D')
  const naskhCanvasZ = L.W(`${40 * Z}px 'Noto Naskh Arabic'`, '\u0628\u200D')
  const naskhIsolatedZ = L.W(`${40 * Z}px 'Noto Naskh Arabic'`, '\u0628')
  const naskhEl = L.put("<div style=\"font:40px/80px 'Noto Naskh Arabic'\"><span>\u0628</span><b>\u0628</b></div>")
  const naskhDom = L.bw(naskhEl.firstElementChild!)
  L.eq('supplementary: Noto Naskh Arabic: DOM width of the first ب = ceil64(W("ب\u200D") at the zoomed size)', L.ceil64(naskhCanvasZ) / (64 * Z), naskhDom)
  L.check('supplementary: Noto Naskh Arabic: the initial form is not the isolated width (the probe can tell)', naskhCanvasZ !== naskhIsolatedZ, `not ${naskhIsolatedZ}`, naskhCanvasZ)
  return { canvas, canvasZ, dom, naskhCanvas, naskhCanvasZ, naskhIsolatedZ, naskhDom }
}

const textH30: Fn = (host, L) => {
  const aLeft = (el: HTMLElement): number => {
    const node = el.querySelector('span')!.firstChild as Text
    const range = document.createRange()
    range.setStart(node, 1)
    range.setEnd(node, 2)
    const list = range.getClientRects()
    return list[list.length - 1]!.left - host.getBoundingClientRect().left
  }
  const space = L.sw(' ', 'white-space:pre')
  const pre = aLeft(L.put("<div style=\"white-space:pre-wrap;font:16px/20px 'Helvetica Neue'\"><span style=\"word-spacing:10px\"> a</span></div>"))
  const normal = aLeft(L.put("<div style=\"white-space:normal;font:16px/20px 'Helvetica Neue'\"><span style=\"white-space:pre-wrap;word-spacing:10px\"> a</span></div>"))
  L.eq('pre-wrap block: a left = width(" ") + 10', space + 10, pre)
  L.eq('normal block, pre-wrap span: a left = width(" ")', space, normal)
  return { space, pre, normal }
}

const textH31: Fn = (_host, L) => {
  const upper = L.sw('ß', 'text-transform:uppercase')
  const ss = L.sw('SS')
  L.eq('<span uppercase>ß</span> = width("SS")', ss, upper)
  const lines = L.lineCases([{ label: 'ßß uppercase in #t', style: 'text-transform:uppercase', inner: 'ßß', expected: 1 }])
  return { upper, ss, lines }
}

const textH32: Fn = (_host, L) => {
  const full = L.sw('a  b', 'text-transform:full-width')
  const ref = L.sw('ａ　ｂ')
  L.eq('<span full-width>a  b</span> = width("ａ　ｂ")', ref, full)
  const lines = L.lineCases([{ label: 'a  b full-width in #t', style: 'text-transform:full-width', inner: 'a  b', expected: 2 }])
  const el = L.put('<div><span style="text-transform:full-width">a  b</span></div>')
  const computed = getComputedStyle(el.firstElementChild!).textTransform
  const supports = CSS.supports('text-transform', 'full-width')
  L.check('supplementary: text-transform: full-width parses (CSS.supports)', supports, true, { supports, computed })
  return { full, ref, lines, supports, computed }
}

const textH33: Fn = (_host, L) => {
  const spaces = L.t('a  b', 'white-space:break-spaces')
  L.eq('a  b break-spaces: 3 lines', 3, spaces.lines)
  L.eq('a  b break-spaces: "a ", " ", "b"', ['a ', ' ', 'b'], spaces.texts)
  const ideographic = L.lineCases([{ label: 'a U+3000 b break-spaces', style: 'white-space:break-spaces', inner: 'a　b', expected: 2 }])
  return { spaces, ideographic }
}

const textH34: Fn = (_host, L) => {
  const text = 'การทดสอบ'
  const w = (s: string): number => L.sw(s, 'white-space:nowrap', undefined, "font:16px/30px 'Thonburi'")
  const w3 = w(text.slice(0, 3))
  const w4 = w(text.slice(0, 4))
  const width = (w3 + w4) / 2
  const el = L.put(`<div lang="en" style="font:16px/30px 'Thonburi';width:${width}px">${text}</div>`)
  const info = L.lines(el)
  L.eq('lines "การ" / "ทดสอบ" (no break inside ทดสอบ)', [text.slice(0, 3), text.slice(3)], info.texts)
  const v8 = (s: string): number[] => {
    const bi = new (Intl as unknown as { v8BreakIterator: new (locales: string[], options: { type: string }) => { adoptText(t: string): void; first(): number; next(): number } }).v8BreakIterator(['en'], { type: 'line' })
    bi.adoptText(s)
    const out = [bi.first()]
    for (let p = bi.next(); p !== -1; p = bi.next()) out.push(p)
    return out
  }
  return { w3, w4, width, info, v8Whole: v8(text), v8Rest: v8(text.slice(3)) }
}

const textH35: Fn = (_host, L) => {
  const r = L.t('', 'white-space:pre-wrap', el => { el.textContent = 'a \rb' })
  L.eq('pre-wrap "a \\rb": 2 lines', 2, r.lines)
  const withCr = L.sw('', 'white-space:pre-wrap', el => { el.textContent = '\rb' })
  const plain = L.sw('b', 'white-space:pre-wrap')
  L.eq('the CR adds zero width', plain, withCr)
  return { r, withCr, plain }
}

const textH36: Fn = (_host, L) => {
  const r = L.t('<span>foo</span> bar', 'white-space:pre-wrap')
  L.eq('2 lines', 2, r.lines)
  L.eq('line 1 is "foo "', 'foo ', r.texts[0])
  return r
}

const textH37: Fn = (_host, L) => {
  const zhSpan = L.t('a<span lang="zh">”b</span>', '', undefined, 'lang="en"')
  const enSpan = L.t('a<span lang="en">”b</span>', '', undefined, 'lang="zh"')
  L.eq('lang=en div, zh span: 2 lines', 2, zhSpan.lines)
  L.eq('lines "a”" and "b"', ['a”', 'b'], zhSpan.texts)
  L.eq('lang=zh div, en span: 1 line', 1, enSpan.lines)
  return { zhSpan, enSpan }
}

// ---- blink-canvas (f) ----

const canvasH1: Fn = (_host, L) => {
  const font = '16px Arial'
  const whole = L.W(font, 'Hello brave new world')
  const words = ['Hello', ' ', 'brave', ' ', 'new', ' ', 'world']
  let sum = 0
  for (let i = 0; i < words.length; i++) sum = L.f32(sum + L.W(font, words[i]!))
  L.eq('W(s) = float32 chain of the word widths', sum, whole)
  L.check('W(s) * 65536 is an integer', Number.isInteger(whole * 65536), true, whole * 65536)
  return { whole, sum }
}

const canvasH2: Fn = (_host, L) => {
  const space = L.W('16px Arial', 'a b')
  const controls: Array<[string, string]> = [['\\r', '\r'], ['\\f', '\f'], ['\\v', '\v'], ['\\t', '\t'], ['\\n', '\n']]
  const out: Record<string, number> = { space }
  for (let i = 0; i < controls.length; i++) {
    const [name, ch] = controls[i]!
    out[name] = L.W('16px Arial', `a${ch}b`)
    L.eq(`W("a${name}b") = W("a b")`, space, out[name])
  }
  return out
}

const canvasH3: Fn = (_host, L) => {
  const split = L.f32(L.W('16px Arial', 'ab') + L.W('16px Arial', 'cd'))
  const shy = L.W('16px Arial', 'ab­cd')
  const zwsp = L.W('16px Arial', '​')
  const lre = L.W('16px Arial', 'ab‪cd')
  L.eq('W("ab­cd") = fround(W("ab") + W("cd"))', split, shy)
  L.eq('W(ZWSP) = 0', 0, zwsp)
  L.eq('W("ab‪cd") = fround(W("ab") + W("cd"))', split, lre)
  return { split, shy, zwsp, lre, whole: L.W('16px Arial', 'abcd') }
}

const canvasH4: Fn = (_host, L) => {
  const out: Record<string, unknown> = {}
  const families = ["'Shantell Sans'", "'Hoefler Text'"]
  for (let i = 0; i < families.length; i++) {
    const font = `40px ${families[i]}`
    const spaced = L.W(font, 'ffi', { letterSpacing: '1px' })
    const speed = L.W(font, 'ffi', { letterSpacing: '0px', textRendering: 'optimizeSpeed' })
    const plain = L.W(font, 'ffi')
    const letters = L.f32(L.f32(L.W(font, 'f') + L.W(font, 'f')) + L.W(font, 'i'))
    L.eq(`${families[i]}: W("ffi", letterSpacing 1px) - 3 = W("ffi", 0px, optimizeSpeed)`, speed, spaced - 3)
    out[families[i]!] = { spaced, speed, plain, letters, fontsCheck: document.fonts.check(font) }
  }
  return out
}

const canvasH5: Fn = (_host, L) => {
  const auto = L.W('40px Arial', 'AV')
  const speed = L.W('40px Arial', 'AV', { textRendering: 'optimizeSpeed' })
  const none = L.W('40px Arial', 'AV', { fontKerning: 'none' })
  const speedNormal = L.W('40px Arial', 'AV', { textRendering: 'optimizeSpeed', fontKerning: 'normal' })
  L.eq('W("AV") under optimizeSpeed = auto', auto, speed)
  L.check('Arial kerns AV, and fontKerning none differs', none !== auto, `not ${auto}`, none)
  L.eq('optimizeSpeed + fontKerning normal = auto', auto, speedNormal)
  return { auto, speed, none, speedNormal }
}

const canvasH6: Fn = (_host, L) => {
  const Z = L.Z
  const out: Record<string, unknown> = {}
  const families = ['Arial', "'Times New Roman'"]
  for (let i = 0; i < families.length; i++) {
    const family = families[i]!
    const font = `40px ${family}`
    const s = 'AV AV'
    const def = L.W(font, s)
    const split = L.f32(L.f32(L.W(font, 'AV') + L.W(font, ' ')) + L.W(font, 'AV'))
    const legibility = L.W(font, s, { textRendering: 'optimizeLegibility' })
    const legibilityZ = L.W(`${40 * Z}px ${family}`, s, { textRendering: 'optimizeLegibility' })
    const dom = L.sw(s, 'white-space:pre', undefined, `font:40px/50px ${family}`)
    L.eq(`${family}: default W("AV AV") = fround(fround(W("AV") + W(" ")) + W("AV"))`, split, def)
    L.check(`${family}: optimizeLegibility gives the split sum or the DOM whole-run width`, legibility === split || Math.abs(legibilityZ / Z - dom) <= 1 / (64 * Z), { split, dom }, legibility)
    out[family] = { def, split, legibility, legibilityZ, dom, domRaw: dom * 64 * Z, ceilLegibilityZ: L.ceil64(legibilityZ) }
  }
  return out
}

const canvasH7: Fn = (_host, L) => {
  const A = L.ctx('16px Arial', { wordSpacing: '10px' })
  const A1 = A.measureText(' x').width
  const A2 = A.measureText('x y').width
  const B = L.ctx('16px Arial', { wordSpacing: '10px' })
  const B1 = B.measureText('x y').width
  const B2 = B.measureText(' x').width
  const spaceX = L.W('16px Arial', ' x')
  const xSpaceY = L.W('16px Arial', 'x y')
  L.eq('A1 = W0(" x")', spaceX, A1)
  L.eq('A2 = W0("x y"), no +10', xSpaceY, A2)
  L.eq('B1 = W0("x y") + 10', xSpaceY + 10, B1)
  L.eq('B2 = W0(" x") + 10', spaceX + 10, B2)
  return { A1, A2, B1, B2, spaceX, xSpaceY }
}

const canvasH8: Fn = (_host, L) => {
  const fresh = L.W('16px Amiri', ')')
  const c = L.ctx('16px Amiri')
  const tabParen = c.measureText('\t)').width
  const second = c.measureText(')').width
  const space = L.W('16px Amiri', ' ')
  L.check('fresh context: W(")") = 4.080', Math.abs(fresh - 4.08) < 0.001, 4.08, fresh)
  L.check('after W("\\t)"), W(")") = 7.328 (Common script form)', Math.abs(second - 7.328) < 0.001, 7.328, second)
  L.eq('W("\\t)") = fround(W(" ") + that width)', L.f32(space + second), tabParen)
  return { fresh, tabParen, second, space, fontsCheck: document.fonts.check('16px Amiri') }
}

const canvasH9: Fn = async (host, L) => {
  const canvas = document.createElement('canvas')
  canvas.width = 10
  canvas.height = 10
  host.append(canvas)
  const c = canvas.getContext('2d')!
  c.font = '16px Amiri'
  const first = c.measureText('(ب⁠ب)').width
  for (let i = 0; i < 3; i++) {
    await L.frame()
    c.fillRect(0, 0, 1, 1)
  }
  const paren = c.measureText(')').width
  const fresh = L.W('16px Amiri', ')')
  L.check('connected canvas: W(")") after W("(ب⁠ب)") and 3 frames = 7.328, not 4.080', Math.abs(paren - 7.328) < 0.001, 7.328, paren)
  return { first, paren, fresh }
}

const canvasH10: Fn = (_host, L) => ({ width: L.W("16px 'Helvetica Neue'", 'Hello world'), dpr: L.Z })

const canvasH11: Fn = (_host, L) => {
  const a = L.ctx('13.337px Arial')
  const b = L.ctx('13.33px Arial')
  const c = L.ctx('13.34px Arial')
  const wa = a.measureText('Hello world').width
  const wb = b.measureText('Hello world').width
  const wc = c.measureText('Hello world').width
  L.eq('W at 13.337px = W at 13.33px', wb, wa)
  L.check('W at 13.34px differs', wc !== wa, `not ${wa}`, wc)
  L.eq('ctx.font reads back 13.337px Arial', '13.337px Arial', a.font)
  return { wa, wb, wc, readback: a.font }
}

const canvasH12: Fn = (host, L) => {
  const make = (style: string): CanvasRenderingContext2D => {
    const canvas = document.createElement('canvas')
    canvas.width = 10
    canvas.height = 10
    canvas.setAttribute('style', style)
    host.append(canvas)
    return canvas.getContext('2d')!
  }
  const off = L.W('40px Arial', 'abc')
  const e = make('letter-spacing:5px')
  e.font = '40px Arial'
  const never = e.measureText('abc').width
  e.letterSpacing = '0px'
  const zeroPx = e.measureText('abc').width
  e.letterSpacing = '0em'
  const zeroEm = e.measureText('abc').width
  L.eq('connected canvas, letter-spacing:5px, ctx.letterSpacing never set: W = offscreen + 15', off + 15, never, 1)
  L.check('at DPR 2: + 15 or + 30', never === off + 15 || never === off + 30, 'off + 15 or off + 30', never - off, 2)
  L.eq('after ctx.letterSpacing = "0px": unchanged', never, zeroPx)
  L.eq('after ctx.letterSpacing = "0em": + 0', off, zeroEm)
  const lig = make("font-feature-settings:'liga' 0")
  lig.font = "40px 'Hoefler Text'"
  const ligFfi = lig.measureText('ffi').width
  const ligFi = lig.measureText('fi').width
  const offFfi = L.W("40px 'Hoefler Text'", 'ffi')
  const offFi = L.W("40px 'Hoefler Text'", 'fi')
  L.check("element font-feature-settings 'liga' 0: W(\"ffi\") differs from OffscreenCanvas", ligFfi !== offFfi, `not ${offFfi}`, ligFfi)
  return { off, never, zeroPx, zeroEm, ligFfi, ligFi, offFfi, offFi }
}

const canvasH13: Fn = (_host, L) => {
  const text = 'Hello, world'
  const root = document.documentElement
  const O = L.ctx('32px serif')
  const o1 = O.measureText(text).width
  root.setAttribute('lang', 'ja')
  O.font = '32px serif'
  const o2 = O.measureText(text).width
  O.font = '32px  serif'
  const o3 = O.measureText(text).width
  const jaFresh = L.W('32px serif', text)
  root.setAttribute('lang', 'en')
  const Q = L.ctx('32px serif')
  const q1 = Q.measureText(text).width
  ;(Q as unknown as { lang: string }).lang = 'ja'
  const q2 = Q.measureText(text).width
  L.eq('same font string again after lang=ja: W unchanged', o1, o2)
  L.check('font "32px  serif" (two spaces): W changes to the Japanese serif width', o3 !== o1 && o3 === jaFresh, jaFresh, o3)
  L.check('ctx.lang = "ja" also changes it', q2 !== q1 && q2 === jaFresh, jaFresh, q2)
  return { o1, o2, o3, jaFresh, q1, q2 }
}

const canvasH14: Fn = (host, L) => {
  const text = 'Hello, world'
  const canvas = document.createElement('canvas')
  host.append(canvas)
  const c = canvas.getContext('2d')!
  c.font = '32px serif'
  const w1 = c.measureText(text).width
  document.documentElement.setAttribute('lang', 'ja')
  const w2 = c.measureText(text).width
  const jaFresh = L.W('32px serif', text)
  L.check('connected canvas without lang: W changes right after <html lang=ja>, to the Japanese width', w2 !== w1 && w2 === jaFresh, jaFresh, w2)
  return { w1, w2, jaFresh, readbackLang: (c as unknown as { lang: string }).lang }
}

const canvasH15: Fn = async (host, L) => {
  const text = 'Hello, world'
  const source = 'onmessage = e => { const d = e.data; const c = (d.canvas || new OffscreenCanvas(1, 1)).getContext("2d"); c.font = d.font; postMessage(c.measureText(d.text).width) }'
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  const worker = new Worker(url)
  const ask = (message: Record<string, unknown>, transfer: Transferable[] = []): Promise<number> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker timed out')), 5000)
    worker.onmessage = event => {
      clearTimeout(timer)
      resolve(event.data as number)
    }
    worker.postMessage(message, transfer)
  })
  const canvas = document.createElement('canvas')
  canvas.setAttribute('lang', 'ja')
  host.append(canvas)
  const offscreen = canvas.transferControlToOffscreen()
  const transferred = await ask({ canvas: offscreen, font: '32px serif', text }, [offscreen])
  const own = await ask({ font: '32px serif', text })
  worker.terminate()
  URL.revokeObjectURL(url)
  const refs: Record<string, number> = {}
  const langs = ['en', 'ja', 'zh-CN', 'zh-Hans', navigator.language]
  for (let i = 0; i < langs.length; i++) {
    document.documentElement.setAttribute('lang', langs[i]!)
    refs[langs[i]!] = L.W('32px serif', text)
  }
  document.documentElement.setAttribute('lang', 'en')
  L.eq('<canvas lang=ja> transferred to a worker: W = the Japanese result', refs['ja'], transferred)
  L.eq(`worker's own OffscreenCanvas: W = the UI language (${navigator.language}) result`, refs[navigator.language], own)
  return { transferred, own, refs, navigatorLanguage: navigator.language }
}

const canvasH16: Fn = (_host, L) => {
  const Z = L.Z
  const text = 'Hello world'
  const rows: Array<{ size: number; dom: number; w: number; wz: number; domMinusW: number; domMinusWz: number }> = []
  for (let size = 10; size <= 28; size++) {
    const el = L.put(`<div style="font:${size}px system-ui;white-space:nowrap"><span>${text}</span></div>`)
    const dom = L.extent(el.firstElementChild!).width
    const w = L.W(`${size}px system-ui`, text)
    const wz = L.W(`${size * Z}px system-ui`, text) / Z
    rows.push({ size, dom, w, wz, domMinusW: dom - w, domMinusWz: dom - wz })
  }
  const unit = 1 / (64 * Z)
  const both = rows.filter(row => Math.abs(row.domMinusW) > unit && Math.abs(row.domMinusWz) > unit)
  L.check('DPR 2: some size in 10-28px where DOM differs from W(size) and from W(size x 2)/2 (by more than 1/128 px)', both.length > 0, 'at least one size', both.map(row => row.size), 2)
  const r13 = rows.find(row => row.size === 13)!
  L.check('DPR 1: DOM = W(13px) within 1/64 px', Math.abs(r13.domMinusW) <= 1 / 64, r13.w, r13.dom, 1)
  return rows
}

const canvasH17: Fn = (_host, L) => {
  const el = L.put("<div style=\"font:12px 'Helvetica Neue';white-space:nowrap\"><span>\u{1F600}</span></div>")
  const dom = L.extent(el.firstElementChild!).width
  const w12 = L.W("12px 'Helvetica Neue'", '\u{1F600}')
  const w24 = L.W("24px 'Helvetica Neue'", '\u{1F600}')
  L.check('DPR 2: DOM = W(24px)/2 within 1/128 px', Math.abs(dom - w24 / 2) <= 1 / 128, w24 / 2, dom, 2)
  L.check('DPR 2: DOM differs from W(12px)', Math.abs(dom - w12) > 1 / 128, `not ${w12}`, dom, 2)
  L.check('DPR 1: DOM = W(12px) (within 1/64 px)', Math.abs(dom - w12) <= 1 / 64, w12, dom, 1)
  return { dom, w12, w24 }
}

const canvasH18: Fn = (_host, L) => {
  const w = L.W('16px Arial', 'ab', { letterSpacing: '-20px' })
  L.check('W("ab") with letterSpacing -20px < 0', w < 0, '< 0', w)
  return { w }
}

const canvasH19: Fn = (_host, L) => {
  const base = L.W('16px Arial', 'ab')
  const c1 = L.ctx('16px Arial', { letterSpacing: '2px' })
  c1.letterSpacing = '3'
  const w3 = c1.measureText('ab').width
  const c2 = L.ctx('16px Arial', { letterSpacing: '2px' })
  c2.letterSpacing = '10%'
  const w10 = c2.measureText('ab').width
  L.eq('letterSpacing "3" after "2px": W still includes +4', base + 4, w3)
  L.eq('letterSpacing "10%" after "2px": W still includes +4', base + 4, w10)
  return { base, w3, w10, readback3: c1.letterSpacing, readback10: c2.letterSpacing }
}

const canvasH20: Fn = (_host, L) => {
  type Bi = { adoptText(t: string): void; first(): number; next(): number; resolvedOptions(): { locale: string } }
  const Ctor = (Intl as unknown as { v8BreakIterator: new (locales: string[], options: { type: string }) => Bi }).v8BreakIterator
  const run = (locale: string, text: string): { boundaries: number[]; locale: string } => {
    const bi = new Ctor([locale], { type: 'line' })
    bi.adoptText(text)
    const boundaries = [bi.first()]
    for (let p = bi.next(); p !== -1; p = bi.next()) boundaries.push(p)
    return { boundaries, locale: bi.resolvedOptions().locale }
  }
  const zh = run('zh', '中〜文')
  const en = run('en', '中〜文')
  const ja = run('ja-u-lb-normal', '中〜文')
  const iter = run('en', 'ゝゞ々ぁァ')
  L.eq('zh "中〜文": [0,1,2,3]', [0, 1, 2, 3], zh.boundaries)
  L.eq('en "中〜文": [0,2,3]', [0, 2, 3], en.boundaries)
  L.eq('ja-u-lb-normal "中〜文": [0,2,3] with resolved locale ja', [[0, 2, 3], 'ja'], [ja.boundaries, ja.locale])
  L.eq('en "ゝゞ々ぁァ": [0,3,4,5]', [0, 3, 4, 5], iter.boundaries)
  const bi = new Ctor(['en'], { type: 'line' })
  let differing = 0
  let differingWithDictionary = 0
  const examples: string[] = []
  for (let i = 0; i < LBT.cases.length; i++) {
    bi.adoptText(LBT.cases[i]!)
    const got = [bi.first()]
    for (let p = bi.next(); p !== -1; p = bi.next()) got.push(p)
    if (got.join(',') !== LBT.expected[i]) {
      differing++
      if (LBT.dictionary[i]) differingWithDictionary++
      if (examples.length < 25) examples.push(`case ${i} ${[...LBT.cases[i]!].map(ch => ch.codePointAt(0)!.toString(16)).join(' ')}: v8 ${got.join(',')} rbbi ${LBT.expected[i]}${LBT.dictionary[i] ? ' (dictionary)' : ''}`)
    }
  }
  L.eq(`LineBreakTest.txt (${LBT.cases.length} cases) with en: 0 differences from rbbi.ts over line_normal.brk`, 0, differing)
  return { zh, en, ja, iter, cases: LBT.cases.length, differing, differingWithDictionary, examples }
}

const canvasH21: Fn = (_host, L) => {
  const cases: Array<[string, string, number]> = [['zh', 'auto', 3], ['en', 'auto', 2], ['ja', 'auto', 2], ['ja', 'normal', 3], ['ja', 'strict', 2], ['ko', 'loose', 3], ['en', 'loose', 2], ['zh-TW', 'auto', 3]]
  const out: unknown[] = []
  for (let i = 0; i < cases.length; i++) {
    const [lang, lb, expected] = cases[i]!
    const el = L.put(`<div lang="${lang}" style="font:16px/20px 'PingFang SC';width:1px;line-break:${lb}">中〜文</div>`)
    const info = L.lines(el)
    out.push({ lang, lb, count: info.count, texts: info.texts })
    L.eq(`lang=${lang} line-break:${lb}: ${expected} lines`, expected, info.count)
  }
  return out
}

const canvasH22: Fn = (_host, L) => {
  const chinese = navigator.language.toLowerCase().startsWith('zh')
  const el = L.put("<div lang=\"ko\" style=\"font:16px/20px 'PingFang SC';width:1px;line-break:strict\">中〜文</div>")
  const info = L.lines(el)
  L.eq(`lang=ko line-break:strict: ${chinese ? 3 : 2} lines (UI language ${navigator.language})`, chinese ? 3 : 2, info.count)
  return { navigatorLanguage: navigator.language, info }
}

// No-lang document.
const canvasH23: Fn = (_host, L) => {
  const chinese = navigator.language.toLowerCase().startsWith('zh')
  const plain = L.lines(L.put('<div style="width:1px">中〜文</div>'))
  const pingfang = L.lines(L.put("<div style=\"width:1px;font:16px/20px 'PingFang SC'\">中〜文</div>"))
  L.eq(`no lang, no Content-Language: ${chinese ? 3 : 2} lines (UI language ${navigator.language})`, chinese ? 3 : 2, plain.count)
  L.eq('same with PingFang SC', chinese ? 3 : 2, pingfang.count)
  return { navigatorLanguage: navigator.language, hasLang: document.documentElement.hasAttribute('lang'), plain, pingfang }
}

const canvasH24: Fn = (_host, L) => {
  const sc = { fontVariantCaps: 'small-caps' }
  const upperSc = L.W('32px Arial', 'HELLO', sc)
  const upper = L.W('32px Arial', 'HELLO')
  const lowerSc = L.W('32px Arial', 'hello', sc)
  const lower = L.W('32px Arial', 'hello')
  L.eq('small-caps W("HELLO") = normal W("HELLO")', upper, upperSc)
  L.check('small-caps W("hello") < normal W("HELLO")', lowerSc < upper, `< ${upper}`, lowerSc)
  L.check('small-caps W("hello") differs from normal W("hello")', lowerSc !== lower, `not ${lower}`, lowerSc)
  return { upperSc, upper, lowerSc, lower }
}

const canvasH25: Fn = (_host, L) => {
  const ltr = L.W('16px Arial', 'abc def')
  const rtl = L.W('16px Arial', 'abc def', { direction: 'rtl' })
  L.eq('direction rtl: W("abc def") = LTR width', ltr, rtl)
  return { ltr, rtl }
}

// ---- CRITIC §6 (Blink items) ----

const criticC7: Fn = (_host, L) => {
  const arial = L.put('<div style="font:16px Arial;white-space:nowrap"><span>Hello world</span></div>')
  const domArial = L.extent(arial.firstElementChild!).width
  const half32 = L.W('32px Arial', 'Hello world') / 2
  const sys = L.put('<div style="font:13px system-ui;white-space:nowrap"><span>Hello world</span></div>')
  const domSys = L.extent(sys.firstElementChild!).width
  const w13 = L.W('13px system-ui', 'Hello world')
  const half26 = L.W('26px system-ui', 'Hello world') / 2
  L.check('16px Arial: DOM width = W(32px)/2 within 1/128 px', Math.abs(domArial - half32) <= 1 / 128, half32, domArial, 2)
  L.check('13px system-ui: DOM differs from W(13px) and from W(26px)/2', Math.abs(domSys - w13) > 1 / 128 && Math.abs(domSys - half26) > 1 / 128, { w13, half26 }, domSys, 2)
  return { domArial, half32, domSys, w13, half26 }
}

const criticC12: Fn = (_host, L) => {
  const space = L.W('16px Arial', 'a b')
  const ff = L.W('16px Arial', 'a\fb')
  const vt = L.W('16px Arial', 'a\vb')
  const cr = L.W('16px Arial', 'a\rb')
  L.eq('fresh OffscreenCanvas: measureText("a\\fb") = measureText("a b")', space, ff)
  L.eq('measureText("a\\vb") = measureText("a b")', space, vt)
  L.eq('measureText("a\\rb") = measureText("a b")', space, cr)
  return { space, ff, vt, cr }
}

const criticC13: Fn = (_host, L) => {
  const font = "40px 'Hoefler Text'"
  const spaced = L.W(font, 'fi', { letterSpacing: '1px' })
  const f = L.W(font, 'f')
  const i = L.W(font, 'i')
  const lig = L.W(font, 'fi')
  L.eq('Chrome: W("fi", letterSpacing 1px) = W("f") + W("i") + 2', f + i + 2, spaced)
  return { spaced, f, i, lig, ligatureWidthPlus1: lig + 1 }
}

const criticC14: Fn = (_host, L) => {
  const el = L.put("<div style=\"width:1px;text-transform:full-width;font:16px/20px 'Hiragino Sans'\">ab</div>")
  const info = L.lines(el)
  L.eq('Chrome: 2 lines (breaks the transformed ａｂ)', 2, L.heightLines(el))
  const computed = getComputedStyle(el).textTransform
  const supports = CSS.supports('text-transform', 'full-width')
  L.check('supplementary: text-transform: full-width parses (CSS.supports)', supports, true, { supports, computed })
  return { info, supports, computed }
}

const criticW1: Fn = (_host, L) => {
  const el = L.put('<div style="white-space:break-spaces;width:1px;font:16px/20px Arial">a b</div>')
  L.eq('a U+202F b with break-spaces: 1 line', 1, L.heightLines(el))
  return L.lines(el)
}

// ---- Cross-cutting ----

const crossEmoji: Fn = (_host, L) => {
  const Z = L.Z
  const strings: Array<[string, string]> = [['U+1F600', '\u{1F600}'], ['family ZWJ', '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}']]
  const sizes = [8, 10, 12, 14, 16, 20, 24, 32]
  const rows: unknown[] = []
  for (let s = 0; s < sizes.length; s++) {
    for (let k = 0; k < strings.length; k++) {
      const size = sizes[s]!
      const [label, text] = strings[k]!
      const el = L.put(`<div style="font:${size}px 'Apple Color Emoji';white-space:nowrap"><span>${text}</span></div>`)
      const span = el.firstElementChild!
      const dom = L.extent(span).width
      const box = L.bw(span)
      const w = L.W(`${size}px 'Apple Color Emoji'`, text)
      const wzRaw = L.W(`${size * Z}px 'Apple Color Emoji'`, text)
      const grid = L.ceil64(wzRaw) / (64 * Z)
      rows.push({ size, label, dom, box, w, wz: wzRaw / Z, grid, domMinusW: dom - w, domMinusWz: dom - wzRaw / Z })
      L.eq(`${label} at ${size}px: DOM = ceil64(W(size x DPR)) / (64 x DPR)`, grid, dom)
    }
  }
  return rows
}

const crossControls: Fn = (_host, L) => {
  const Z = L.Z
  const fonts = ['16px Arial', "16px 'Helvetica Neue'"]
  const controls: Array<[string, string]> = [['CR', '\r'], ['FF', '\f'], ['VT', '\v'], ['TAB', '\t']]
  const rows: unknown[] = []
  for (let f = 0; f < fonts.length; f++) {
    const font = fonts[f]!
    const family = font.slice(5)
    const fz = `${16 * Z}px ${family}`
    const gridSum = (L.ceil64(L.W(fz, 'a')) + L.ceil64(L.W(fz, 'b'))) / (64 * Z)
    const whiteSpaces = ['normal', 'pre']
    for (let w = 0; w < whiteSpaces.length; w++) {
      const ws = whiteSpaces[w]!
      const domSpace = L.sw('a b', `white-space:${ws}`, undefined, `font:${font}`)
      const domAb = L.sw('ab', `white-space:${ws}`, undefined, `font:${font}`)
      for (let c = 0; c < controls.length; c++) {
        const [name, ch] = controls[c]!
        const dom = L.sw('', `white-space:${ws}`, span => { span.textContent = `a${ch}b` }, `font:${font}`)
        const canvas = L.W(font, `a${ch}b`)
        rows.push({ font, ws, name, dom, canvas, domSpace, domAb, gridSum, canvasSpace: L.W(font, 'a b'), canvasAb: L.W(font, 'ab') })
      }
    }
  }
  return rows
}

const crossLigatures: Fn = (_host, L) => {
  const Z = L.Z
  const text = 'ffi fl'
  const rows: unknown[] = []
  const families = ["'Hoefler Text'", "'Helvetica Neue'"]
  const sizes = [16, 40]
  for (let f = 0; f < families.length; f++) {
    for (let s = 0; s < sizes.length; s++) {
      const family = families[f]!
      const size = sizes[s]!
      const dom: Record<string, number> = {}
      const spacings = ['0px', '0.001px', '1px']
      const domRenderings = ['auto', 'optimizeSpeed']
      for (let i = 0; i < spacings.length; i++) {
        for (let r = 0; r < domRenderings.length; r++) {
          dom[`${spacings[i]} ${domRenderings[r]}`] = L.sw(text, `white-space:pre;letter-spacing:${spacings[i]};text-rendering:${domRenderings[r]}`, undefined, `font:${size}px/${size * 1.5}px ${family}`)
        }
      }
      const canvas: Record<string, { w: number; wz: number }> = {}
      const renderings = ['auto', 'optimizeSpeed', 'optimizeLegibility', 'geometricPrecision']
      for (let i = 0; i < spacings.length; i++) {
        for (let r = 0; r < renderings.length; r++) {
          const ls = Number.parseFloat(spacings[i]!)
          canvas[`${spacings[i]} ${renderings[r]}`] = {
            w: L.W(`${size}px ${family}`, text, { letterSpacing: spacings[i]!, textRendering: renderings[r]! }),
            wz: L.W(`${size * Z}px ${family}`, text, { letterSpacing: `${ls * Z}px`, textRendering: renderings[r]! }) / Z,
          }
        }
      }
      let letters = 0
      const chars = [...text]
      for (let i = 0; i < chars.length; i++) letters = L.f32(letters + L.W(`${size}px ${family}`, chars[i]!))
      rows.push({ family, size, dom, canvas, lettersSum: letters })
    }
  }
  return rows
}

// Runs in four documents with <html lang> ja, zh-Hans, ko and en.
const crossLangSans: Fn = (_host, L) => {
  const Z = L.Z
  const lang = document.documentElement.getAttribute('lang')
  const strings = ['永骨', 'Hello永骨', 'Hello']
  const rows: unknown[] = []
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i]!
    const el = L.put(`<div style="font:16px sans-serif;white-space:nowrap"><span>${s}</span></div>`)
    const dom = L.extent(el.firstElementChild!).width
    const m = L.ctx('16px sans-serif').measureText(s)
    const wz = L.W(`${16 * Z}px sans-serif`, s)
    const grid = L.ceil64(wz) / (64 * Z)
    rows.push({ s, dom, w: m.width, bboxLeft: m.actualBoundingBoxLeft, bboxRight: m.actualBoundingBoxRight, wz: wz / Z, grid })
    L.eq(`lang=${lang} "${s}": DOM = ceil64(OffscreenCanvas W at 16 x DPR px) / (64 x DPR)`, grid, dom)
  }
  return { lang, rows }
}

const crossSystemUi: Fn = (_host, L) => {
  const Z = L.Z
  const families = ['system-ui', '-apple-system']
  const sizes = [13, 14, 16, 20]
  const rows: unknown[] = []
  for (let f = 0; f < families.length; f++) {
    for (let s = 0; s < sizes.length; s++) {
      const family = families[f]!
      const size = sizes[s]!
      const el = L.put(`<div style="font:${size}px ${family};white-space:nowrap"><span>Hello world</span></div>`)
      const dom = L.extent(el.firstElementChild!).width
      const w = L.W(`${size}px ${family}`, 'Hello world')
      const wzRaw = L.W(`${size * Z}px ${family}`, 'Hello world')
      const grid = L.ceil64(wzRaw) / (64 * Z)
      rows.push({ family, size, dom, w, wz: wzRaw / Z, grid, domMinusW: dom - w, domMinusGrid: dom - grid })
      L.eq(`${family} ${size}px: DOM = ceil64(W(size x DPR)) / (64 x DPR)`, grid, dom)
    }
  }
  return rows
}

const crossEnv: Fn = (_host, L) => {
  const Z = L.Z
  const env = {
    devicePixelRatio: window.devicePixelRatio, visualViewportScale: window.visualViewport === null ? null : window.visualViewport.scale,
    innerWidth: window.innerWidth, outerWidth: window.outerWidth, screenWidth: screen.width, matches2dppx: matchMedia('(resolution: 2dppx)').matches,
    navigatorLanguage: navigator.language, userAgent: navigator.userAgent,
  }
  const cases: Array<[string, string]> = [['nnnnn nnnnn', '16px Arial'], ['Hello world', "13px 'Helvetica Neue'"], ['The quick brown fox', '17px Georgia'], ['Lorem ipsum dolor', "15.5px 'Times New Roman'"]]
  const rows: unknown[] = []
  let css64Distinguished = false
  for (let i = 0; i < cases.length; i++) {
    const [text, font] = cases[i]!
    const el = L.put(`<div style="font:${font};line-height:30px;white-space:nowrap">${text}</div>`)
    const domWidth = L.extent(el).width
    el.style.whiteSpace = 'normal'
    const threshold = L.minWidth(el, Math.floor((domWidth - 2) * 512), Math.ceil((domWidth + 1) * 512), 512, () => L.heightLines(el, 30) === 1)
    const domRaw = domWidth * 64 * Z
    const device = (Math.round(domRaw) - 1) / (64 * Z)
    const css = (Math.ceil(domWidth * 64) - 1) / 64
    if (device !== css) css64Distinguished = true
    rows.push({ text, font, domWidth, domRaw, threshold, device, css })
    L.check(`"${text}" ${font}: DOM text width is a whole number of 1/(64 x DPR) px`, Number.isInteger(domRaw), 'integer', domRaw)
    L.eq(`"${text}" ${font}: 1-line threshold = DOM width - 1/(64 x DPR) px`, device, threshold.width)
  }
  L.check('at least one case where the device-pixel grid and a 1/64 CSS px grid predict different thresholds', css64Distinguished, true, css64Distinguished, 2)
  return { env, rows }
}

// Chrome's FontCache keys platform fonts by effective (zoomed) size, while opsz and HarfBuzz ptem come from the specified
// size. So a Canvas at S px may reuse the platform font that DOM text at CSS S/DPR px created. Run first in a fresh
// browser: all Canvas widths are taken before any system-ui DOM text exists, then after.
const crossSystemUiOrder: Fn = (_host, L) => {
  const Z = L.Z
  const text = 'Hello world'
  const canvasSizes = [10, 11, 12, 13, 14, 16, 20, 22, 24, 26, 28, 32, 40]
  const domSizes = [10, 11, 12, 13, 14, 16, 20]
  const measureAll = (): Record<string, number> => {
    const out: Record<string, number> = {}
    for (let i = 0; i < canvasSizes.length; i++) out[String(canvasSizes[i])] = L.W(`${canvasSizes[i]}px system-ui`, text)
    return out
  }
  const before = measureAll()
  const identify: Record<string, number> = {}
  const idFonts = ['13px system-ui', '13px -apple-system', '13px BlinkMacSystemFont', '13px Helvetica', "13px 'Helvetica Neue'", '13px Times', '13px sans-serif']
  for (let i = 0; i < idFonts.length; i++) identify[idFonts[i]!] = L.W(idFonts[i]!, text)
  const dom: Record<string, number> = {}
  for (let i = 0; i < domSizes.length; i++) {
    const el = L.put(`<div style="font:${domSizes[i]}px system-ui;white-space:nowrap"><span>${text}</span></div>`)
    dom[String(domSizes[i])] = L.extent(el.firstElementChild!).width
  }
  const after = measureAll()
  const changed = canvasSizes.filter(size => before[String(size)] !== after[String(size)])
  L.check('Canvas system-ui widths at some size change after DOM system-ui text was laid out', changed.length > 0, 'at least one size', changed)
  for (let i = 0; i < domSizes.length; i++) {
    const size = domSizes[i]!
    L.eq(`DOM ${size}px system-ui = ceil64(clean Canvas W(${size}px) x DPR) / (64 x DPR)`, L.ceil64(before[String(size)]! * Z) / (64 * Z), dom[String(size)])
  }
  return { before, after, changed, dom, identify }
}

// ---- LineBreakTest data for blink-canvas H20 ----

type RbbiModule = {
  parseBreakRules: (bytes: Uint8Array) => unknown
  RuleBreakIterator: new (rules: unknown) => { setText(text: string): number; next(): number; dictionaryCharCount: number }
  DONE: number
}

async function lineBreakTestData(): Promise<{ cases: string[]; expected: string[]; dictionary: boolean[] }> {
  const home = homedir()
  const testFile = join(home, 'github/browser-engines/chromium-152/src/third_party/icu/source/test/testdata/LineBreakTest.txt')
  const rbbi = await import(join(home, 'github/browser-engines/pretext-emulation-20260915/runtime/rbbi.ts')) as RbbiModule
  const rules = rbbi.parseBreakRules(new Uint8Array(readFileSync(join(import.meta.dir, '../data/blink/line_normal.brk'))))
  const iterator = new rbbi.RuleBreakIterator(rules)
  const cases: string[] = []
  const expected: string[] = []
  const dictionary: boolean[] = []
  const lines = readFileSync(testFile, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const body = lines[i]!.split('#')[0]!.trim()
    if (body === '') continue
    let text = ''
    const tokens = body.split(/\s+/)
    for (let k = 0; k < tokens.length; k++) if (tokens[k] !== '÷' && tokens[k] !== '×') text += String.fromCodePoint(Number.parseInt(tokens[k]!, 16))
    iterator.setText(text)
    iterator.dictionaryCharCount = 0
    const boundaries = [0]
    for (let p = iterator.next(); p !== rbbi.DONE; p = iterator.next()) boundaries.push(p)
    cases.push(text)
    expected.push(boundaries.join(','))
    dictionary.push(iterator.dictionaryCharCount > 0)
  }
  return { cases, expected, dictionary }
}

// Probes the zoom runs (forced DPR 1 and 3.5, emulated DPR 2) re-run; see blink-probes-zoom.ts.
// Probes the fresh-browser system-ui run repeats, the cache-order probe first; see blink-probes-sysui.ts.
export const SYSUI_PROBE_IDS = ['cross X5 (system-ui cache order)', 'blink-canvas H16', 'CRITIC C7', 'cross X5 system-ui and -apple-system']
export const ZOOM_PROBE_IDS = ['blink-lines H1', 'blink-lines H2', 'blink-lines H3', 'blink-lines H4', 'blink-canvas H10', 'CRITIC C7', 'cross X6 env and line-breaking grid']

const FAMILIES = ['Arial', 'Helvetica Neue', 'Times', 'Times New Roman', 'Courier New', 'Georgia', 'Hoefler Text', 'Geeza Pro', 'Thonburi', 'PingFang SC', 'Hiragino Sans', 'Apple Color Emoji']

export default async function probes(): Promise<Probe[]> {
  const lbt = await lineBreakTestData()
  return [
    probe('cross X5 (system-ui cache order)', crossSystemUiOrder, { note: 'First probe of the run, so the Canvas widths before any DOM system-ui text are clean.' }),
    probe('blink-lines H1', linesH1, { note: 'DPR 1 checks apply to the forced DPR 1 run; the generalized checks apply at any DPR.' }),
    probe('blink-lines H2', linesH2),
    probe('blink-lines H3', linesH3, { note: 'Meaningful only under --chrome-args=--force-device-scale-factor=1 --chrome-emulate-dsf=2.' }),
    probe('blink-lines H4', linesH4),
    probe('blink-lines H5', linesH5),
    probe('blink-lines H6', linesH6),
    probe('blink-lines H7', linesHyphen, { prelude: 'const LS = 0;' }),
    probe('blink-lines H8', linesHyphen, { prelude: 'const LS = 3;' }),
    probe('blink-lines H9', linesH9),
    probe('blink-lines H10', linesH10),
    probe('blink-lines H11', linesH11),
    probe('blink-lines H12', linesH12),
    probe('blink-lines H13', linesH13),
    probe('blink-lines H14', linesH14),
    probe('blink-lines H15', linesH15),
    probe('blink-lines H16', linesH16),

    probe('blink-text H1', textH1),
    probe('blink-text H2', textH2),
    probe('blink-text H3', textH3, { fontFixtures: ['Noto Naskh Arabic'] }),
    probe('blink-text H4', textH4),
    probe('blink-text H5', textH5),
    probe('blink-text H6', textH6),
    probe('blink-text H7', textH7),
    probe('blink-text H8', textH8),
    probe('blink-text H9', textH9),
    probe('blink-text H10', textH10),
    probe('blink-text H11', textH11),
    probe('blink-text H12', textH12),
    probe('blink-text H13', textH13),
    probe('blink-text H14', textH14),
    probe('blink-text H15', textH15, { pageLang: null, document: 'blink-no-lang' }),
    probe('blink-text H16', textH16),
    probe('blink-text H16 (no lang)', textH16NoLang, { pageLang: null, document: 'blink-no-lang' }),
    probe('blink-text H17', textH17),
    probe('blink-text H18', textH18),
    probe('blink-text H19', textH19),
    probe('blink-text H20', textH20),
    probe('blink-text H21', textH21),
    probe('blink-text H22', textH22),
    probe('blink-text H23', textH23),
    probe('blink-text H24', textH24),
    probe('blink-text H25', textH25),
    probe('blink-text H26', textH26),
    probe('blink-text H27', textH27),
    probe('blink-text H28', textH28),
    probe('blink-text H29', textH29, { fontFixtures: ['Noto Naskh Arabic'] }),
    probe('blink-text H30', textH30),
    probe('blink-text H31', textH31),
    probe('blink-text H32', textH32),
    probe('blink-text H33', textH33),
    probe('blink-text H34', textH34),
    probe('blink-text H35', textH35),
    probe('blink-text H36', textH36),
    probe('blink-text H37', textH37),

    probe('blink-canvas H1', canvasH1),
    probe('blink-canvas H2', canvasH2),
    probe('blink-canvas H3', canvasH3),
    probe('blink-canvas H4', canvasH4, { fontFixtures: ['Shantell Sans'] }),
    probe('blink-canvas H5', canvasH5),
    probe('blink-canvas H6', canvasH6),
    probe('blink-canvas H7', canvasH7),
    probe('blink-canvas H8', canvasH8, { fontFixtures: ['Amiri'] }),
    probe('blink-canvas H9', canvasH9, { fontFixtures: ['Amiri'] }),
    probe('blink-canvas H10', canvasH10, { note: 'Compared across the DPR 2, forced DPR 1 and forced DPR 3.5 runs.' }),
    probe('blink-canvas H11', canvasH11),
    probe('blink-canvas H12', canvasH12),
    probe('blink-canvas H13', canvasH13),
    probe('blink-canvas H14', canvasH14),
    probe('blink-canvas H15', canvasH15),
    probe('blink-canvas H16', canvasH16),
    probe('blink-canvas H17', canvasH17),
    probe('blink-canvas H18', canvasH18),
    probe('blink-canvas H19', canvasH19),
    probe('blink-canvas H20', canvasH20, { prelude: `const LBT = ${JSON.stringify(lbt)};` }),
    probe('blink-canvas H21', canvasH21),
    probe('blink-canvas H22', canvasH22),
    probe('blink-canvas H23', canvasH23, { pageLang: null, document: 'blink-no-lang' }),
    probe('blink-canvas H24', canvasH24),
    probe('blink-canvas H25', canvasH25),

    probe('CRITIC C7', criticC7),
    probe('CRITIC C12', criticC12),
    probe('CRITIC C13', criticC13),
    probe('CRITIC C14', criticC14),
    probe('CRITIC W1', criticW1),
    probe('CRITIC W8', linesH2),

    probe('cross X1 emoji at font size x DPR', crossEmoji),
    probe('cross X2 control characters DOM vs Canvas', crossControls),
    probe('cross X3 ligatures under letter spacing', crossLigatures),
    probe('cross X4 generic sans-serif (lang=ja)', crossLangSans, { pageLang: 'ja' }),
    probe('cross X4 generic sans-serif (lang=zh-Hans)', crossLangSans, { pageLang: 'zh-Hans' }),
    probe('cross X4 generic sans-serif (lang=ko)', crossLangSans, { pageLang: 'ko' }),
    probe('cross X4 generic sans-serif (lang=en)', crossLangSans, { pageLang: 'en' }),
    probe('cross X5 system-ui and -apple-system', crossSystemUi),
    probe('cross X6 env and line-breaking grid', crossEnv, { observe: [{ kind: 'env', families: FAMILIES }] }),
  ]
}
