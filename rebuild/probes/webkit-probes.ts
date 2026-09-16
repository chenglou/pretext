// Probes for the WebKit hypotheses in rebuild/specs/webkit-lines.md §12, webkit-text.md §14, webkit-canvas.md (f), the
// WebKit items of CRITIC.md §6, and six cross-cutting probes. Every probe is one `script` observation built from a real
// function below (stringified, so it must not reference anything outside itself except `L`, `host` and browser
// globals). `L` is the helper library `lib()`, stringified into the same script. Each script returns `ok` (true, false or
// null when the source gives no decisive expectation), `expected` in words, and the raw measurements. Thresholds are
// computed in the page from OffscreenCanvas measurements, as the specs define them.
import type { ObservationSpec, Probe } from './types.ts'

function lib(host: HTMLElement) {
  const f = Math.fround
  // LayoutUnit truncation of a CSS length: the float32 value times 64, truncated.
  const T = (x: number): number => Math.trunc(f(x) * 64) / 64
  const C64 = (x: number): number => Math.ceil(x * 64) / 64
  const approx = (a: number, b: number): boolean => Math.abs(a - b) <= 1 / 64 + 1e-9
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
  const contexts = new Map<string, OffscreenCanvasRenderingContext2D>()
  // OffscreenCanvas measureText width, one cached context per font and letter spacing.
  const M = (font: string, text: string, letterSpacing?: string): number => {
    const key = `${font}|${letterSpacing ?? ''}`
    let ctx = contexts.get(key)
    if (ctx === undefined) {
      const created = new OffscreenCanvas(1, 1).getContext('2d')
      if (created === null) throw new Error('No OffscreenCanvas 2d context')
      created.font = font
      if (letterSpacing !== undefined) created.letterSpacing = letterSpacing
      contexts.set(key, created)
      ctx = created
    }
    return ctx.measureText(text).width
  }
  const put = (html: string): HTMLElement => {
    host.innerHTML = html
    const el = host.firstElementChild
    if (!(el instanceof HTMLElement)) throw new Error('put: markup has no element')
    return el
  }
  const texts = (root: Node): Text[] => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const out: Text[] = []
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) out.push(n as Text)
    return out
  }
  const rel = (r: DOMRect): { x: number; y: number; w: number; h: number } => {
    const o = host.getBoundingClientRect()
    return { x: r.x - o.x, y: r.y - o.y, w: r.width, h: r.height }
  }
  // Lines from per-code-point Range rects: a code point's first rect with positive height joins the line whose vertical
  // centre is within half the taller rect's height, else starts a line. Code points with no such rect are skipped. Line
  // texts run from a line's first code point to the next line's first code point.
  const lines = (el: Element) => {
    const range = document.createRange()
    const nodes = texts(el)
    const found: Array<{ y: number; h: number; start: number }> = []
    const multi: number[] = []
    const content = el.textContent ?? ''
    let base = 0
    for (let n = 0; n < nodes.length; n++) {
      const node = nodes[n]!
      const data = node.data
      for (let i = 0; i < data.length;) {
        const len = data.codePointAt(i)! > 0xffff ? 2 : 1
        range.setStart(node, i)
        range.setEnd(node, i + len)
        const rects = range.getClientRects()
        let assigned: { y: number; h: number; start: number } | undefined
        for (let r = 0; r < rects.length; r++) {
          const q = rects[r]!
          if (!(q.height > 0)) continue
          const y = q.y + q.height / 2
          if (assigned !== undefined) {
            if (Math.abs(assigned.y - y) >= Math.max(assigned.h, q.height) / 2 && !multi.includes(base + i)) multi.push(base + i)
            continue
          }
          assigned = found.find(l => Math.abs(l.y - y) < Math.max(l.h, q.height) / 2)
          if (assigned === undefined) {
            assigned = { y, h: q.height, start: base + i }
            found.push(assigned)
          } else {
            assigned.start = Math.min(assigned.start, base + i)
          }
        }
        i += len
      }
      base += data.length
    }
    found.sort((a, b) => a.y - b.y)
    const starts = found.map(l => l.start)
    return {
      count: starts.length,
      starts,
      texts: starts.map((s, k) => content.slice(s, k + 1 < starts.length ? starts[k + 1] : content.length)),
      height: el.getBoundingClientRect().height,
      multi,
    }
  }
  // Client rects of a Range over each text node (one rect per display box).
  const nodeRects = (el: Element) => texts(el).map(node => {
    const r = document.createRange()
    r.selectNodeContents(node)
    return Array.from(r.getClientRects(), rel)
  })
  // Horizontal extent of the positive rects of a Range over a node's contents.
  const extent = (node: Node): number => {
    const r = document.createRange()
    r.selectNodeContents(node)
    const rects = r.getClientRects()
    let left = Infinity
    let right = -Infinity
    for (let i = 0; i < rects.length; i++) {
      const q = rects[i]!
      if (!(q.width > 0 && q.height > 0)) continue
      left = Math.min(left, q.left)
      right = Math.max(right, q.right)
    }
    return right > left ? right - left : 0
  }
  const width = (el: Element): number => el.getBoundingClientRect().width
  const codePointRects = (node: Node, offset: number, length = 1) => {
    const r = document.createRange()
    r.setStart(node, offset)
    r.setEnd(node, offset + length)
    return Array.from(r.getClientRects(), rel)
  }
  type Case = { name: string; html: string; text?: string; expect?: { count?: number; starts?: number[]; firstText?: string }; raw?: number[] }
  // Runs line cases: markup, optional textContent, expected count / starts / first line text.
  const cases = (list: Case[]) => {
    const out: unknown[] = []
    let ok: boolean | null = null
    for (let i = 0; i < list.length; i++) {
      const c = list[i]!
      const el = put(c.html)
      if (c.text !== undefined) el.textContent = c.text
      const measured = lines(el)
      let pass: boolean | null = null
      if (c.expect !== undefined) {
        pass = (c.expect.count === undefined || c.expect.count === measured.count)
          && (c.expect.starts === undefined || same(c.expect.starts, measured.starts))
          && (c.expect.firstText === undefined || c.expect.firstText === measured.texts[0])
        ok = (ok ?? true) && pass
      }
      const raw = c.raw === undefined ? undefined : c.raw.map(offset => ({ offset, rects: codePointRects(texts(el)[0]!, offset) }))
      out.push({ name: c.name, text: el.textContent, measured, expected: c.expect ?? null, pass, ...(raw === undefined ? {} : { raw }) })
    }
    return { ok, cases: out }
  }
  return { f, T, C64, approx, same, M, put, texts, lines, nodeRects, extent, width, codePointRects, cases, rel }
}

type Lib = ReturnType<typeof lib>

function script(fn: (L: Lib, host: HTMLElement) => unknown): ObservationSpec {
  return { kind: 'script', source: `const L = (${lib.toString()})(host);\nreturn await (${fn.toString()})(L, host);` }
}

const probes: Probe[] = []

function add(spec: string, suffix: string, pageLang: string | null, fn: (L: Lib, host: HTMLElement) => unknown, note?: string): void {
  probes.push({
    id: suffix === '' ? spec : `${spec} ${suffix}`,
    spec,
    pageLang,
    observe: [script(fn)],
    browsers: ['safari'],
    ...(note === undefined ? {} : { note }),
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// webkit-lines §12. Common setup: <html lang="en">, a div with font 16px Arial, line-height 20px.

add('webkit-lines H1', '', 'en', L => {
  const font = '16px Arial'
  const el = L.put('<div style="font:16px/20px Arial">ab cd</div>')
  const sp = L.M(font, ' ')
  const s = L.f(L.f(L.M(font, 'ab ') - sp) + sp)
  const cd = L.M(font, 'cd')
  const w = L.f(s + cd)
  const count = (px: number): number => { el.style.width = `${px}px`; return Math.round(el.getBoundingClientRect().height / 20) }
  const atT = count(L.T(w))
  const atC = count(L.C64(w) - 2 / 64)
  const k0 = Math.round(L.T(w) * 64)
  const scan: number[][] = []
  let scanOk = true
  for (let k = k0 - 4; k <= k0 + 4; k++) {
    const predicted = cd <= L.f(L.f(k / 64 + 1 / 64) - s) ? 1 : 2
    const got = count(k / 64)
    scan.push([k, got, predicted])
    if (got !== predicted) scanOk = false
  }
  return { ok: atT === 1 && atC === 2 && scanOk, expected: '1 line at width T(w); 2 lines at ceil64(w) - 2/64; scan [k/64, lines, source prediction] agrees', w, T: L.T(w), atT, atC, scan }
})

add('webkit-lines H2', '', 'en', L => {
  const font = '16px Arial'
  const el = L.put('<div style="font:16px/20px Arial">ab cd</div>')
  const sp = L.M(font, ' ')
  const w = L.f(L.f(L.f(L.M(font, 'ab ') - sp) + sp) + L.M(font, 'cd'))
  const count = (px: number): number => { el.style.width = `${px}px`; return Math.round(el.getBoundingClientRect().height / 20) }
  const k0 = Math.round(L.T(w) * 64)
  const rows: number[][] = []
  let ok = true
  for (let k = k0 - 6; k <= k0 + 6; k++) {
    const a = count(k / 64)
    const b = count(k / 64 + 0.01)
    rows.push([k, a, b])
    if (a !== b) ok = false
  }
  return { ok, expected: 'lines at k/64 + 0.01 px equal lines at k/64 px for every k; rows [k, lines(k/64), lines(k/64+0.01)]', rows }
})

add('webkit-lines H3', '', 'en', L => {
  const font = '16px Georgia'
  const el = L.put('<div style="font:16px/20px Georgia">AV AV</div>')
  const sp = L.M(font, ' ')
  const ext = L.f(L.M(font, 'AV ') - sp)
  const plain = L.M(font, 'AV')
  const W = L.T(L.f(L.f(ext) + sp + ext))
  const count = (px: number): number => { el.style.width = `${px}px`; return Math.round(el.getBoundingClientRect().height / 20) }
  const atW = count(W)
  const node = el.firstChild!
  const firstBox = L.codePointRects(node, 0, 2)
  const lineRects = L.nodeRects(el)
  const k0 = Math.round(W * 64)
  let minOne: number | null = null
  for (let k = k0 - 12; k <= k0 + 12; k++) if (count(k / 64) === 1) { minOne = k; break }
  // Source: the first AV is followed by a space in the same node (extended), the second ends the node (plain).
  let predictSource: number | null = null
  let predictFresh: number | null = null
  for (let k = k0 - 12; k <= k0 + 12; k++) {
    if (predictSource === null && plain <= L.f(L.f(k / 64 + 1 / 64) - L.f(ext + sp))) predictSource = k
    if (predictFresh === null && plain <= L.f(L.f(k / 64 + 1 / 64) - L.f(plain + sp))) predictFresh = k
  }
  return {
    ok: atW === 1 && minOne === predictSource,
    expected: '1 line at W; first text box width M("AV ") - M(" "); minimal one-line width equals the extended-measure prediction',
    distinguishes: ext !== plain, ext, plain, sp, W, atW, firstBox, lineRects, minOne, predictSource, predictFresh,
    sourceLineWidth: L.f(L.f(ext + sp) + plain),
  }
})

add('webkit-lines H4', '', 'en', L => {
  const el = L.put(`<div style="font:16px/20px Arial;overflow-wrap:anywhere">${'AV'.repeat(17)}</div>`)
  const rows: unknown[] = []
  let ok = true
  for (const w of [112.75, 113.5, 114.75]) {
    el.style.width = `${w}px`
    const m = L.lines(el)
    rows.push({ width: w, starts: m.starts })
    if (!L.same(m.starts, [0, 11, 22])) ok = false
  }
  return { ok, expected: 'starts [0, 11, 22] at 112.75, 113.5 and 114.75px (carry); a fresh measurement gives [0, 11, 22, 33]', rows }
})

add('webkit-lines H5', '', 'en', L => {
  const font = '16px Arial'
  const sp = L.M(font, ' ')
  const wxA = L.f(L.M(font, 'x ') - sp)
  const wxB = L.M(font, 'x')
  const wf = L.M(font, 'foo­')
  const wi = L.M(font, 'i')
  const H = L.M(font, '‐')
  const hyphenMinus = L.M(font, '-')
  const LA = L.f(L.f(L.f(wxA + sp) + wf) + wi)
  const LhB = L.f(L.f(L.f(wxB + sp) + wf) + H)
  const W = L.C64(LA - 1 / 64)
  const predictA = (lw: number): number => {
    let right = L.f(wxA + sp)
    if (!(wf <= L.f(L.f(lw + 1 / 64) - right))) return 2
    right = L.f(right + wf)
    return wi <= L.f(L.f(lw + 1 / 64) - right) ? 1 : 2
  }
  const predictB = (lw: number, h: number): number => (L.f(wf + h) <= L.f(L.f(lw + 1 / 64) - L.f(wxB + sp)) ? 1 : 2)
  const A = L.put('<div style="font:16px/20px Arial">x foo&shy;i</div>')
  A.style.width = `${W}px`
  const la = L.lines(A)
  const B = L.put('<div style="font:16px/20px Arial"><span>x</span> foo&shy;i</div>')
  B.style.width = `${W}px`
  const lb = L.lines(B)
  // The collapsed space after </span> may report its Range rect on line 2; the words decide the lines.
  const spaceRects = L.codePointRects(B.childNodes[1]!, 0)
  return {
    spaceRects,
    ok: la.count === 1 && lb.count === 2 && lb.texts[0] === 'x' && lb.texts[1]!.trim() === 'foo­i',
    expected: 'A (TextOnlySimpleLineBuilder) 1 line "x fooi"; B (LineBuilder) 2 lines "x" / "fooi"',
    W, H, hyphenMinus, wi, LA, LhB,
    conditions: { hyphenWiderThanI: H > wi, fitsA: LA <= W + 1 / 64, hyphenOverflowsB: LhB > W + 1 / 64 },
    predictions: { A: predictA(W), B: predictB(W, H), BWithHyphenMinus: predictB(W, hyphenMinus) },
    A: la, B: lb,
  }
})

add('webkit-lines H6', '', 'en', L => {
  const font = '16px Arial'
  const waa = L.M(font, 'aa­')
  const wbb = L.M(font, 'bb­')
  const wcc = L.M(font, 'cc­')
  const wdd = L.M(font, 'dd')
  const H = L.M(font, '‐')
  const aabb = L.f(waa + wbb)
  const aabbcc = L.f(aabb + wcc)
  const W = L.C64(aabb + H - 1 / 64)
  const conditions = {
    ddOverflowsAfterAabbcc: L.f(aabbcc + wdd) > W + 1 / 64,
    ccFitsWithoutHyphen: aabbcc <= W + 1 / 64,
    hyphenOverflowsAfterCc: H > W + 1 / 64 - aabbcc,
    hyphenOverflowsWithoutEpsilon: W - aabb < H,
    hyphenFitsWithEpsilon: H <= W + 1 / 64 - aabb,
  }
  const A = L.put('<div style="font:16px/20px Arial">aa&shy;bb&shy;cc&shy;dd</div>')
  A.style.width = `${W}px`
  const la = L.lines(A)
  const ra = L.nodeRects(A)
  const B = L.put('<div style="font:16px/20px Arial"><span>a</span>a&shy;bb&shy;cc&shy;dd</div>')
  B.style.width = `${W}px`
  const lb = L.lines(B)
  const rb = L.nodeRects(B)
  return {
    ok: la.starts[1] === 6 && lb.starts[1] === 3,
    expected: 'A line 1 "aabb‐" (next line starts at 6); B line 1 "aa‐" (next line starts at 3)',
    W, H, aabb, aabbcc, conditions, A: la, rectsA: ra, B: lb, rectsB: rb,
  }
})

add('webkit-lines H7', '', 'en', L => {
  const font = '16px Arial'
  const a = L.f(L.M(font, 'abc ', '4px') - L.M(font, ' ', '4px'))
  const el = L.put('<div style="font:16px/20px Arial;letter-spacing:4px">abc abc</div>')
  el.style.width = `${L.T(a)}px`
  const l1 = L.lines(el)
  const r1 = L.nodeRects(el)[0]!
  const W2 = L.T(a) - 1 / 64 - 0.01
  el.style.width = `${W2}px`
  const l2 = L.lines(el)
  const r2 = L.nodeRects(el)[0]!
  const firstBox1 = r1[0]?.w ?? null
  const firstBox2 = r2[0]?.w ?? null
  const ok1 = l1.count === 2 && firstBox1 !== null && L.approx(firstBox1, a)
  const ok2 = l2.count === 3 || (l2.count === 2 && firstBox2 !== null && firstBox2 > W2)
  return {
    ok: ok1 && ok2,
    expected: 'at W = T(a): 2 lines, first box a wide (includes 4px after "c"); at T(a) - 1/64 - 0.01: 3 lines, or "abc" overflowing its own first line',
    a, withoutTrailing: a - 4, W1: L.T(a), W2, lines1: l1, rects1: r1, lines2: l2, rects2: r2, exactFirstBox: firstBox1 === a,
  }
})

add('webkit-lines H8', '', 'en', L => {
  const font = '16px Arial'
  const text = `aa ${'b'.repeat(20)}`
  const W = L.T(L.M(font, 'aa bbbb'))
  const A = L.put(`<div style="font:16px/20px Arial;overflow-wrap:anywhere">${text}</div>`)
  A.style.width = `${W}px`
  const la = L.lines(A)
  const B = L.put(`<div style="font:16px/20px Arial;word-break:break-all">${text}</div>`)
  B.style.width = `${W}px`
  const lb = L.lines(B)
  const sp = L.M(font, ' ')
  const right = L.f(L.f(L.M(font, 'aa ') - sp) + sp)
  const avail = L.f(L.f(W + 1 / 64) - right)
  let k = 0
  while (k < 20 && L.M(font, 'b'.repeat(k + 1)) <= avail) k++
  return {
    ok: la.starts[1] === 3 && lb.starts[1] === 3 + k,
    expected: `overflow-wrap:anywhere: line 1 "aa", line 2 starts with "b" (start 3); break-all: line 1 "aa " plus ${k} b's (next start ${3 + k})`,
    W, predictedBs: k, anywhere: la, breakAll: lb,
  }
})

add('webkit-lines H9', '', 'en', L => L.cases([
  { name: 'A 8-bit', html: '<div style="font:16px/20px Arial;width:1px;overflow-wrap:anywhere">W)))iiii</div>', expect: { firstText: 'W' } },
  { name: 'B 16-bit', html: '<div style="font:16px/20px Arial;width:1px;overflow-wrap:anywhere">W)))iiii一</div>', expect: { firstText: 'W)))' } },
]))

add('webkit-lines H10', '', 'en', L => {
  const W = L.T(L.M('16px Arial', 'aaaa'))
  const r = L.cases([
    { name: 'line-break:auto', html: `<div style="font:16px/20px Arial;word-break:break-all;width:${W}px">aaaa‐bbbb</div>`, expect: { firstText: 'aaa' } },
    { name: 'line-break:loose', html: `<div style="font:16px/20px Arial;word-break:break-all;line-break:loose;width:${W}px">aaaa‐bbbb</div>`, expect: { firstText: 'aaaa' } },
  ])
  return { ...r, expected: 'auto: line 1 "aaa" (no split before U+2010); loose: line 1 "aaaa"', W }
})

add('webkit-lines H11', '', 'en', L => {
  const font = '16px Arial'
  const W = L.T(L.M(font, 'abc') + L.M(font, ' '))
  const rows: unknown[] = []
  const expectations: Record<string, number[]> = { 'pre-wrap': [0, 9], 'break-spaces': [0, 4, 9], nowrap: [0], pre: [0] }
  let ok = true
  for (const mode of ['pre-wrap', 'break-spaces', 'nowrap', 'pre']) {
    const el = L.put(`<div style="font:16px/20px Arial;white-space:${mode};width:${W}px"></div>`)
    el.textContent = 'abc      def'
    const m = L.lines(el)
    const pass = L.same(m.starts, expectations[mode])
    if (!pass) ok = false
    rows.push({ mode, starts: m.starts, texts: m.texts, height: m.height, rects: L.nodeRects(el), expected: expectations[mode], pass })
  }
  return { ok, expected: 'pre-wrap [0, 9] ("abc      " / "def"); break-spaces per source [0, 4, 9]; nowrap and pre 1 line', W, rows }
})

add('webkit-lines H12', '', 'en', L => {
  const font = '16px Arial'
  const ext = L.f(L.M(font, 'abc ') - L.M(font, ' '))
  const W = L.T(L.M(font, 'abc ') - L.M(font, ' ') + L.M(font, ' ')) + 1 / 64
  const el = L.put(`<div style="font:16px/20px Arial;text-align:right;width:${W}px">abc def</div>`)
  const m = L.lines(el)
  const rects = L.nodeRects(el)[0]!
  const expectedOffset = L.T(W) - ext
  const x = rects[0]?.x ?? null
  return {
    ok: m.count === 2 && x !== null && L.approx(x, expectedOffset),
    expected: '2 lines; line 1 right-aligned at offset W - w(abc) (trailing space trimmed)',
    W, ext, expectedOffset, x, exact: x === expectedOffset, lines: m, rects,
  }
})

add('webkit-lines H13', '', 'en', L => {
  const el = L.put('<div style="font:16px/20px Arial"></div>')
  const heights: Record<string, number> = {}
  const list: Array<[string, string]> = [['empty', ''], ['CR', '\r'], ['SP TAB LF FF', ' \t\n\f'], ['VT', '\v'], ['x', 'x']]
  for (const [name, text] of list) {
    el.textContent = text
    heights[name] = el.getBoundingClientRect().height
  }
  const parsed = L.put('<div style="font:16px/20px Arial">\r</div>')
  const parsedData = Array.from(parsed.textContent ?? '', ch => ch.charCodeAt(0))
  return {
    ok: heights['CR'] === 0 && heights['SP TAB LF FF'] === 0 && heights['empty'] === 20,
    expected: 'textContent "\\r" and " \\t\\n\\f" give height 0; an empty div gives one line (20px)',
    heights, parsedCRBecomes: parsedData, parsedHeight: parsed.getBoundingClientRect().height,
  }
})

add('webkit-lines H14', '', 'en', L => {
  const font = '16px Arial'
  const span = L.put('<span style="white-space:pre;font:16px Arial"></span>')
  const dom = (t: string) => { span.textContent = t; return { rect: L.width(span), extent: L.extent(span) } }
  const vt = dom('ab')
  const c01 = dom('ab')
  const cr = dom('a\rb')
  const ab = dom('ab')
  const aSpaceB = dom('a b')
  const canvas = { a01b: L.M(font, 'ab'), aSpaceB: L.M(font, 'a b'), ab: L.M(font, 'ab'), notdef: L.f(L.M(font, 'ab') - L.M(font, 'ab')) }
  return {
    ok: L.approx(vt.rect, canvas.a01b) && !L.approx(vt.rect, canvas.aSpaceB) && !L.approx(cr.rect, canvas.aSpaceB),
    expected: 'DOM "a\\vb" = M(a) + .notdef + M(b) (Canvas "a\\u0001b"), not M("a b"); DOM "a\\rb" differs from M("a b")',
    dom: { vt, c01, cr, ab, aSpaceB }, canvas,
  }
})

add('webkit-lines H15', '', 'en', L => {
  const font = '16px Arial'
  const sp = L.M(font, ' ')
  const wb = L.M(font, 'b')
  const el = L.put('<div style="font:16px/20px Arial;white-space:pre;tab-size:4"></div>')
  const measure = (text: string, tabSize: string) => {
    el.style.tabSize = tabSize
    el.textContent = text
    const node = el.firstChild!
    return { extent: L.extent(node), rects: L.nodeRects(el)[0], bRects: L.codePointRects(node, text.length - 1) }
  }
  const tabWidth = (position: number, base: number): number => {
    let r = L.f(L.f(position) % base)
    if (r < 0) r = L.f(r + base)
    let tab = L.f(base - r)
    if (tab < sp / 2) tab = L.f(tab + base)
    return tab
  }
  const wa = L.M(font, 'a')
  const tab4 = tabWidth(wa, L.f(4 * sp))
  const four = measure('a\tb', '4')
  const expected4 = L.f(L.f(wa + tab4) + wb)
  let chosen: string | null = null
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  for (let i = 0; i < 26 && chosen === null; i++) {
    for (let j = 0; j < 26; j++) {
      const s = letters[i]! + letters[j]!
      if (L.f(L.M(font, s)) % sp > sp / 2) { chosen = s; break }
    }
  }
  let one: unknown = null
  let ok1: boolean | null = null
  if (chosen !== null) {
    const ws = L.M(font, chosen)
    const r = L.f(ws % sp)
    const noJump = L.f(sp - r)
    const tab1 = tabWidth(ws, sp)
    const m = measure(`${chosen}\tb`, '1')
    const withJump = L.f(L.f(ws + tab1) + wb)
    const withoutJump = L.f(L.f(ws + noJump) + wb)
    ok1 = L.approx(m.extent, withJump) && !L.approx(m.extent, withoutJump)
    one = { text: chosen, width: ws, remainder: r, tab: tab1, measured: m, withJump, withoutJump }
  }
  return {
    ok: L.approx(four.extent, expected4) && ok1 !== false,
    expected: 'tab-size 4 "a\\tb": width M(a) + tab + M(b) with the fmodf rule; tab-size 1: a tab narrower than half a space jumps a whole extra space',
    sp, wa, tab4, expected4, four, one,
  }
})

add('webkit-lines H16', '', 'en', L => {
  const el = L.put('<div style="border-left:0.7px solid black;width:100px;font:16px/20px Arial">x</div>')
  const w = L.width(el)
  const dpr = devicePixelRatio
  return {
    ok: dpr === 2 ? w === 100.5 : null,
    expected: 'DPR-1 comparison not run (one Retina display); at DPR 2 a 0.7px border becomes 0.5px, so the box is 100.5px wide',
    dpr, width: w, clientLeft: el.clientLeft,
  }
}, 'Only the border exception is measurable here; breaks at DPR 1 need a non-Retina display.')

add('webkit-lines H18', '', 'en', L => {
  const W = L.T(L.M('16px Arial', 'foo')) + 1 / 64
  const r = L.cases([
    { name: 'normal', html: `<div style="font:16px/20px Arial;width:${W}px">foo<b>bar</b> baz</div>`, expect: { starts: [0, 7] } },
    { name: 'overflow-wrap:anywhere', html: `<div style="font:16px/20px Arial;overflow-wrap:anywhere;width:${W}px">foo<b>bar</b> baz</div>` },
  ])
  const normal = (r.cases[0] as { measured: { count: number; texts: string[] } }).measured
  const anywhere = (r.cases[1] as { measured: { starts: number[] } }).measured
  const split = anywhere.starts[1] !== undefined && anywhere.starts[1] > 0 && anywhere.starts[1] < 6
  // The collapsed space after </b> may report its Range rect on line 2; the words decide the lines.
  const el = L.put(`<div style="font:16px/20px Arial;width:${W}px">foo<b>bar</b> baz</div>`)
  const spaceRects = L.codePointRects(el.childNodes[2]!, 0)
  const wordsOk = normal.count === 2 && normal.texts[0] === 'foobar' && normal.texts[1]!.trim() === 'baz'
  return { ...r, ok: wordsOk && split, expected: 'normal: "foobar " / "baz"; anywhere: the split lands inside "foobar"', W, spaceRects }
})

add('webkit-lines H19', '', 'en', L => {
  const font = '16px Arial'
  const W = L.T(L.M(font, 'STRASSE'))
  const el = L.put(`<div style="font:16px/20px Arial;text-transform:uppercase;width:${W}px">straße straße</div>`)
  const m = L.lines(el)
  const rects = L.nodeRects(el)[0]!
  const ext = L.f(L.M(font, 'STRASSE ') - L.M(font, ' '))
  const plain = L.M(font, 'STRASSE')
  const got = rects.map(r => r.w)
  // A Range addresses DOM offsets, but the text box holds the transformed text (2 units longer), so also read the
  // per-line rects of a span wrapping the whole text (RangeBasedLineBuilder runs the same simple builder).
  const wrapped = L.put(`<div style="font:16px/20px Arial;text-transform:uppercase;width:${W}px"><span>straße straße</span></div>`)
  const spanLines = Array.from(wrapped.firstElementChild!.getClientRects(), q => q.width)
  return {
    ok: m.count === 2 && spanLines.length === 2 && L.approx(spanLines[0]!, ext) && L.approx(spanLines[1]!, plain),
    expected: '2 lines; box widths [M("STRASSE ") - M(" "), M("STRASSE")]',
    W, lines: m, boxWidths: got, spanLines, predicted: [ext, plain], exact: spanLines[0] === ext && spanLines[1] === plain,
  }
})

add('webkit-lines H20', '', 'en', L => {
  const wW = L.M('16px Arial', 'W')
  const A = L.put('<div style="width:0;font:16px/20px Arial">W</div>')
  const a = { height: A.getBoundingClientRect().height, rects: L.nodeRects(A)[0] }
  const B = L.put('<div style="width:0;font:16px/20px Arial"><span>W</span></div>')
  const b = { height: B.getBoundingClientRect().height, span: L.width(B.firstElementChild!) }
  const aw = a.rects?.[0]?.w ?? -1
  return {
    ok: a.height === 20 && L.approx(aw, wW) && b.height === 20 && L.approx(b.span, wW),
    expected: '1 line, box width M("W"), with and without a span',
    wW, A: a, B: b,
  }
})

add('webkit-lines H21', '', 'en', L => {
  const font = '16px Arial'
  const sp = L.M(font, ' ')
  const ext = L.f(L.M(font, 'abc ') - sp)
  const sum = L.f(ext + L.M(font, '   '))
  const el = L.put('<div style="font:16px/20px Arial;white-space:pre-wrap;text-align:right"></div>')
  el.textContent = 'abc   '
  const at = (W: number, expectedX: number) => {
    el.style.width = `${W}px`
    const rects = L.nodeRects(el)[0]!
    const x = rects[0]?.x ?? null
    return { W, rects, x, expectedX, pass: x !== null && L.approx(x, expectedX), height: el.getBoundingClientRect().height }
  }
  const W1 = L.C64(sum) + 1
  const fits = at(W1, L.T(W1) - sum)
  const W2 = L.C64(L.f(ext + sp))
  const clamps = at(W2, 0)
  return { ok: fits.pass && clamps.pass, expected: 'content fits: offset W - (w(abc) + 3 spaces); otherwise offset 0', ext, sum, fits, clamps }
})

add('webkit-lines H22', '', 'en', (L, host) => {
  const run = (css: string) => {
    host.innerHTML = `<style>#fl::first-line{${css}}</style><div id="fl" style="font:16px/20px Arial;overflow-wrap:anywhere">${'AV'.repeat(17)}</div>`
    const el = host.querySelector('#fl')!
    return [112.75, 113.5, 114.75].map(w => { (el as HTMLElement).style.width = `${w}px`; return { width: w, starts: L.lines(el).starts } })
  }
  const equalFont = run('font-size:16px')
  const spaced = run('letter-spacing:1px')
  return {
    ok: equalFont.every(r => L.same(r.starts, [0, 11, 22])),
    expected: '::first-line with an equal font keeps the carry ([0, 11, 22] as in H4); with letter-spacing the rest is measured fresh (recorded, no decisive expectation)',
    equalFont, spaced,
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// webkit-text §14. A <p> with margin 0, white-space normal and the stated font and width.

add('webkit-text H1', '', 'en', L => L.cases([
  { name: 'bold edge', html: '<p style="margin:0;font:16px/20px Arial;width:1px"><b>foo</b>bar</p>', expect: { count: 1 } },
  { name: 'control with space', html: '<p style="margin:0;font:16px/20px Arial;width:1px"><b>foo</b> bar</p>', expect: { count: 2 } },
]))

add('webkit-text H2', '', 'en', L => L.cases([
  { name: 'hyphen at edge', html: '<p style="margin:0;font:16px/20px Arial;width:1px"><b>ex-</b>ample</p>', expect: { starts: [0, 3] } },
]))

add('webkit-text H3', '', 'en', L => L.cases([
  { name: 'one-character box', html: '<p style="margin:0;font:16px/20px Arial;width:1px">x<b>-</b>1</p>', expect: { count: 1 } },
  { name: 'single node', html: '<p style="margin:0;font:16px/20px Arial;width:1px">x-1</p>', expect: { starts: [0, 2] } },
]))

add('webkit-text H4', '', 'ja', L => L.cases([
  { name: 'curly quotes near ideographs, lang ja', html: '<p style="margin:0;font:20px/30px \'Hiragino Mincho ProN\';width:25px">中文“abc”中文</p>', expect: { starts: [0, 1, 2, 7, 8] } },
]))

add('webkit-text H5', '', 'en', L => L.cases([
  { name: 'guillemets near ideographs', html: '<p style="margin:0;font:20px/30px \'Hiragino Mincho ProN\';width:25px">中«abc»中</p>', expect: { starts: [0, 1, 6] } },
]))

add('webkit-text H6', 'element lang', 'en', L => {
  const html = (lang: string) => `<p lang="${lang}" style="margin:0;font:16px/20px Arial;width:1px">----““aabb</p>`
  return L.cases([
    { name: 'en', html: html('en'), expect: { starts: [0, 1, 2, 3, 4] } },
    { name: 'ja', html: html('ja'), expect: { starts: [0, 1, 2, 3] } },
    { name: 'fr', html: html('fr'), expect: { starts: [0, 1, 2, 3] } },
    { name: 'de', html: html('de'), expect: { starts: [0, 1, 2, 3] } },
    { name: 'he', html: html('he'), expect: { starts: [0, 1, 2, 3] } },
    { name: 'ar', html: html('ar'), expect: { starts: [0, 1, 2, 3] } },
  ])
})

add('webkit-text H6', 'no lang', null, L => L.cases([
  { name: 'no lang anywhere', html: '<p style="margin:0;font:16px/20px Arial;width:1px">----““aabb</p>', expect: { starts: [0, 1, 2, 3, 4] } },
]), 'About a missing lang. The quote overrides for the empty locale come from the process ICU default locale.')

add('webkit-text H7', 'page ja', 'ja', L => L.cases([
  { name: 'span lang en on page ja', html: '<p style="margin:0;font:16px/20px Arial;width:1px"><span lang="en">----““aabb</span></p>', expect: { starts: [0, 1, 2, 3, 4] } },
  { name: 'p lang="" on page ja', html: '<p lang="" style="margin:0;font:16px/20px Arial;width:1px">----““aabb</p>', expect: { starts: [0, 1, 2, 3, 4] } },
]))

add('webkit-text H7', 'page en', 'en', L => L.cases([
  { name: 'span lang ja on page en', html: '<p style="margin:0;font:16px/20px Arial;width:1px"><span lang="ja">----““aabb</span></p>', expect: { starts: [0, 1, 2, 3] } },
]))

add('webkit-text H8', '', 'en', L => {
  const r = L.cases([
    { name: 'und', html: '<p lang="und" style="margin:0;font:16px/20px Arial;width:1px">----““aabb</p>' },
    { name: 'xx', html: '<p lang="xx" style="margin:0;font:16px/20px Arial;width:1px">----““aabb</p>' },
  ])
  return { ...r, expected: '5 lines: the process ICU default has en-like quote overrides; 4 lines: it has none. The source does not decide.' }
})

add('webkit-text H9', '', 'en', L => {
  const html = '<p style="margin:0;font:16px/20px Arial;width:1px"></p>'
  return L.cases([
    { name: '中.abc(d', html, text: '中.abc(d', expect: { starts: [0, 5] } },
    { name: 'x.abc(d', html, text: 'x.abc(d', expect: { count: 1 } },
    { name: '中,abc[d', html, text: '中,abc[d', expect: { starts: [0, 5] } },
    { name: '中.abc<d', html, text: '中.abc<d', expect: { count: 2 } },
  ])
})

add('webkit-text H10', '', 'en', L => {
  const html = '<p style="margin:0;font:16px/20px Arial;width:1px"></p>'
  const strict = '<p style="margin:0;font:16px/20px Arial;width:1px;line-break:strict"></p>'
  return L.cases([
    { name: 'a\\rb', html, text: 'a\rb', expect: { count: 1 } },
    { name: 'a\\rb strict', html: strict, text: 'a\rb', expect: { starts: [0, 2] } },
    { name: '中\\r中', html, text: '中\r中', expect: { starts: [0, 2] } },
    { name: '中\\f中', html, text: '中\f中', expect: { starts: [0, 2] } },
    { name: '中\\v中', html, text: '中\v中', expect: { starts: [0, 2] } },
  ])
})

add('webkit-text H11', '', 'en', L => {
  const span = L.put('<span style="font:16px Arial"></span>')
  span.textContent = 'a\rb'
  const cr = L.width(span)
  span.textContent = 'a b'
  const space = L.width(span)
  const mCR = L.M('16px Arial', 'a\rb')
  const mSpace = L.M('16px Arial', 'a b')
  return { ok: cr !== space && mCR === mSpace, expected: 'DOM widths of "a\\rb" and "a b" differ; measureText("a\\rb") === measureText("a b")', dom: { cr, space }, canvas: { cr: mCR, space: mSpace } }
})

add('webkit-text H12', '', 'en', L => {
  const build = (parts: Array<string | { span: string }>) => {
    const wrapper = L.put('<div style="display:inline-block;font:16px Arial"></div>')
    for (const part of parts) {
      if (typeof part === 'string') wrapper.append(part)
      else { const s = document.createElement('span'); s.textContent = part.span; wrapper.append(s) }
    }
    const nodes = Array.from(wrapper.childNodes, node => node.nodeType === Node.TEXT_NODE
      ? { kind: 'text', data: Array.from((node as Text).data, ch => ch.charCodeAt(0)), rects: (() => { const r = document.createRange(); r.selectNodeContents(node); return Array.from(r.getClientRects(), L.rel) })() }
      : { kind: 'span', text: node.textContent, width: L.width(node as Element) })
    return { wrapperWidth: L.width(wrapper), nodes }
  }
  const notdef = L.f(L.M('16px Arial', 'ab') - L.M('16px Arial', 'ab'))
  const ff = build([{ span: 'a' }, '\f', { span: 'b' }])
  const lone = build(['\f', { span: 'b' }])
  const vt = build(['\v', { span: 'b' }])
  const textWidth = (r: { nodes: Array<{ kind: string; rects?: Array<{ w: number }> }> }) => { const t = r.nodes.find(n => n.kind === 'text'); return t?.rects?.[0]?.w ?? 0 }
  return {
    ok: textWidth(ff) > 0 && textWidth(lone) === 0 && textWidth(vt) > 0,
    expected: 'a / FF / b: .notdef between a and b; FF alone before a span: no renderer (no rect); VT alone before a span: .notdef',
    notdefCanvas: notdef, ff, lone, vt,
  }
})

add('webkit-text H13', '', 'en', L => {
  const html = '<p style="margin:0;font:16px/20px Arial;width:1000px"></p>'
  return L.cases([
    { name: 'U+2028', html, text: 'a b', expect: { starts: [0, 2] } },
    { name: 'U+2029', html, text: 'a b', expect: { starts: [0, 2] } },
  ])
})

add('webkit-text H14', '', 'en', L => L.cases([
  { name: 'hyphens:manual', html: '<p style="margin:0;font:16px/20px Arial;width:1px;hyphens:manual">co­op</p>', expect: { starts: [0, 3] } },
  { name: 'hyphens:none', html: '<p style="margin:0;font:16px/20px Arial;width:1px;hyphens:none">co­op</p>', expect: { count: 1 } },
]))

add('webkit-text H15', '', 'en', L => L.cases([
  { name: '16-bit', html: '<p style="margin:0;font:16px/20px Arial;width:1px;word-break:keep-all">abc,def(ghi中</p>', expect: { starts: [0, 4, 8] } },
  { name: '8-bit', html: '<p style="margin:0;font:16px/20px Arial;width:1px;word-break:keep-all">abc,def(ghi</p>', expect: { count: 1 } },
]))

add('webkit-text H16', '', 'en', L => L.cases([
  { name: 'span edge', html: '<p style="margin:0;font:20px/30px \'Hiragino Mincho ProN\';width:1px;word-break:keep-all"><span>中文，</span><span>中文</span></p>', expect: { count: 1 } },
  { name: 'single node', html: '<p style="margin:0;font:20px/30px \'Hiragino Mincho ProN\';width:1px;word-break:keep-all">中文，中文</p>', expect: { starts: [0, 3] } },
]))

add('webkit-text H17', '', 'en', L => L.cases([
  { name: 'keep-all soft hyphen', html: '<p style="margin:0;font:16px/20px Arial;width:1px;word-break:keep-all">co­op</p>', expect: { count: 1 } },
]))

add('webkit-text H18', '', 'en', L => L.cases([
  { name: 'normal', html: '<p style="margin:0;font:16px/20px Arial;width:1px">a​b</p>', expect: { starts: [0, 2] }, raw: [1] },
  { name: 'keep-all', html: '<p style="margin:0;font:16px/20px Arial;width:1px;word-break:keep-all">a​b</p>', expect: { starts: [0, 1] }, raw: [1] },
]))

add('webkit-text H19', '', 'en', L => {
  const r = L.cases([
    { name: 'break-all Menlo', html: '<p style="margin:0;font:16px/20px Menlo;width:48.2px;word-break:break-all">aaaa,,,,bbbb</p>', expect: { starts: [0, 3, 8] } },
  ])
  return { ...r, menloA: L.M('16px Menlo', 'a') }
})

add('webkit-text H20', '', 'en', L => L.cases([
  { name: 'line-start prohibition', html: '<p style="margin:0;font:20px/30px \'Hiragino Mincho ProN\';width:1px;overflow-wrap:anywhere">中、、文</p>', expect: { starts: [0, 3] } },
]))

add('webkit-text H21', 'lang', 'en', L => {
  const p = (attrs: string, lb: string) => `<p ${attrs} style="margin:0;font:20px/30px 'Hiragino Mincho ProN';width:25px;line-break:${lb}">日本ァア</p>`
  return L.cases([
    { name: 'lang=en line-break:normal', html: p('lang="en"', 'normal'), expect: { count: 4 } },
    { name: 'lang=ja', html: p('lang="ja"', 'auto'), expect: { count: 4 } },
    { name: 'lang=ja line-break:strict', html: p('lang="ja"', 'strict'), expect: { count: 3 } },
  ])
})

add('webkit-text H21', 'no lang', null, L => L.cases([
  { name: 'no lang line-break:normal', html: '<p style="margin:0;font:20px/30px \'Hiragino Mincho ProN\';width:25px;line-break:normal">日本ァア</p>', expect: { starts: [0, 1, 3] } },
]), 'About a missing lang: no lang and no Content-Language.')

add('webkit-text H22', '', 'th', L => L.cases([
  { name: 'Thai dictionary', html: '<p style="margin:0;font:16px/24px Thonburi;width:1px">ความสวยงามของธรรมชาติ</p>', expect: { starts: [0, 4, 10, 13] } },
]))

add('webkit-text H23', '', 'en', L => L.cases([
  { name: 'hyphen-minus', html: '<p style="margin:0;font:16px/20px Arial;width:1px">ab-12 -12 a -12 12-34</p>', expect: { starts: [0, 3, 6, 10, 12, 16, 19] } },
  { name: 'question mark', html: '<p style="margin:0;font:16px/20px Arial;width:1px">x?-b x?$b x!(b</p>', expect: { starts: [0, 2, 3, 5, 7, 10, 12] } },
]))

add('webkit-text H24', '', 'en', L => L.cases([
  { name: 'NBSP between ideographs', html: '<p style="margin:0;font:20px/30px \'Hiragino Mincho ProN\';width:25px"></p>', text: '中 中', expect: { count: 1 } },
]))

add('webkit-text H25', '', 'en', L => {
  const measure = (html: string) => { const el = L.put(html); return L.extent(el) }
  const preWrapFirst = measure('<div style="font:16px Arial;white-space:nowrap"><span style="white-space:pre-wrap">a </span><span> b</span></div>')
  const normalBoth = measure('<div style="font:16px Arial;white-space:nowrap"><span>a </span><span> b</span></div>')
  const twoSpaces = measure('<div style="font:16px Arial;white-space:pre-wrap">a  b</div>')
  const oneSpace = measure('<div style="font:16px Arial;white-space:pre-wrap">a b</div>')
  const sp = L.M('16px Arial', ' ')
  return {
    ok: L.approx(preWrapFirst - normalBoth, sp) && L.approx(preWrapFirst, twoSpaces) && L.approx(normalBoth, oneSpace),
    expected: 'pre-wrap first span renders two spaces (width of "a  b"); two normal spans render one (width of "a b")',
    preWrapFirst, normalBoth, twoSpaces, oneSpace, sp,
  }
})

add('webkit-text H26', '', 'en', L => {
  const font = "24px 'Times New Roman'"
  const spans = L.put(`<div style="font:${font};white-space:nowrap"><span>A</span><span>V</span></div>`)
  const a = L.width(spans.children[0]!)
  const v = L.width(spans.children[1]!)
  const spanExtent = L.extent(spans)
  const single = L.put(`<div style="font:${font};white-space:nowrap">AV</div>`)
  const singleExtent = L.extent(single)
  const m = { A: L.M(font, 'A'), V: L.M(font, 'V'), AV: L.M(font, 'AV') }
  return {
    ok: L.approx(spanExtent, a + v) && spanExtent > singleExtent && L.approx(spanExtent - singleExtent, m.A + m.V - m.AV),
    expected: 'span A + span V is wider than a single node AV by the kern amount and equals the sum of the two span widths',
    spanA: a, spanV: v, spanExtent, singleExtent, canvas: m,
  }
})

add('webkit-text H27', '', 'en', L => {
  const lf = L.put('<div style="font:20px \'Hiragino Mincho ProN\';white-space:nowrap"></div>')
  lf.textContent = '中\n文'
  const wLF = L.extent(lf)
  const sp = L.put('<div style="font:20px \'Hiragino Mincho ProN\';white-space:nowrap">中 文</div>')
  const wSP = L.extent(sp)
  return { ok: wLF === wSP, expected: 'width of 中\\n文 equals 中 文 (no segment-break removal)', wLF, wSP }
})

add('webkit-text H28', '', 'en', L => L.cases([
  { name: 'bidi split', html: '<p style="margin:0;font:16px/20px Arial;width:1px">xyzשלום</p>', expect: { count: 1 } },
]))

add('webkit-text H29', '', 'en', L => {
  const font = "20px 'Hiragino Mincho ProN'"
  const single = L.put(`<div style="font:${font};white-space:nowrap">中a</div>`)
  const wSingle = L.extent(single)
  const spans = L.put(`<div style="font:${font};white-space:nowrap"><span>中</span><span>a</span></div>`)
  const wSpans = L.extent(spans)
  return { ok: L.approx(wSingle, wSpans), expected: 'width of 中a equals <span>中</span><span>a</span>: no ideograph-alpha gap', wSingle, wSpans, exact: wSingle === wSpans, canvas: { single: L.M(font, '中a'), sum: L.M(font, '中') + L.M(font, 'a') } }
})

add('webkit-text H30', '', 'en', L => {
  const strings = [['中文“abc”中文', '25px'], ['日本ァア', '25px'], ['中〜中', '25px'], ['----““aabb', '1px']] as const
  const langs = ['zh', 'zh-Hans', 'zh-Hant-TW', 'zh-CN']
  const rows: unknown[] = []
  let ok = true
  for (const [text, w] of strings) {
    const byLang: Record<string, number[]> = {}
    for (const lang of langs) {
      const el = L.put(`<p lang="${lang}" style="margin:0;font:20px/30px 'Hiragino Mincho ProN';width:${w}"></p>`)
      el.textContent = text
      byLang[lang] = L.lines(el).starts
    }
    const allSame = langs.every(lang => L.same(byLang[lang], byLang['zh']))
    if (!allSame) ok = false
    rows.push({ text, width: w, byLang, allSame })
  }
  return { ok, expected: 'no visible difference between lang zh, zh-Hans, zh-Hant-TW and zh-CN for these strings', rows }
}, 'The Han locale swap uses the process preferred languages.')

// ---------------------------------------------------------------------------------------------------------------------
// webkit-canvas (f). O = OffscreenCanvas, E = a connected <canvas>.

add('webkit-canvas H1', '', 'en', L => {
  const font = "16px 'Helvetica Neue'"
  const base = L.M(font, 'a b')
  const controls: Record<string, number> = { VT: L.M(font, 'ab'), FF: L.M(font, 'a\fb'), CR: L.M(font, 'a\rb'), LF: L.M(font, 'a\nb'), TAB: L.M(font, 'a\tb') }
  const span = L.put(`<span style="white-space:pre;font:${font}"></span>`)
  span.textContent = 'ab'
  const domVT = L.width(span)
  span.textContent = 'ab'
  const domAB = L.width(span)
  const diff = domVT - domAB
  return {
    ok: Object.values(controls).every(w => w === base) && Math.abs(diff - 8) < 0.05,
    expected: 'O: "a\\vb", "a\\fb", "a\\rb", "a\\nb", "a\\tb" all equal "a b"; DOM pre "a\\vb" minus "ab" ≈ 8 (.notdef), not 4.448',
    base, controls, domVT, domAB, diff,
  }
})

add('webkit-canvas H2', '', 'en', L => {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!
  ctx.font = "condensed 16px 'Helvetica Neue'"
  const condensed = ctx.measureText('Hello').width
  const condensedReadback = ctx.font
  const plain = L.M("16px 'Helvetica Neue'", 'Hello')
  return { ok: condensed === plain, expected: 'O: "condensed 16px Helvetica Neue" measures "Hello" the same as "16px Helvetica Neue"', condensed, plain, condensedReadback }
})

add('webkit-canvas H3', '', 'en', L => {
  const font = "16px 'Hoefler Text'"
  const canvas = L.M(font, 'fifl', '10px')
  const span = L.put(`<span style="font:${font};letter-spacing:10px">fifl</span>`)
  const dom = L.width(span)
  return {
    ok: Math.abs(canvas - 38.704) < 0.01 && Math.abs(dom - 59.344) < 0.01,
    expected: 'O letterSpacing 10px "fifl" ≈ 18.704 + 2×10 = 38.704 (ligatures kept); DOM letter-spacing 10px ≈ 19.344 + 4×10 = 59.344',
    canvas, dom, noSpacing: L.M(font, 'fifl'), perChar: L.M(font, 'f') + L.M(font, 'i') + L.M(font, 'f') + L.M(font, 'l'),
  }
})

add('webkit-canvas H4', '', 'en', (L, host) => {
  const font = "16px 'Hoefler Text'"
  const span = L.put(`<span style="font:${font};letter-spacing:10px">fifl</span>`)
  const dom = L.width(span)
  const element = (style: string) => {
    host.replaceChildren()
    const canvas = document.createElement('canvas')
    canvas.setAttribute('style', style)
    host.append(canvas)
    const ctx = canvas.getContext('2d')!
    ctx.font = font
    ctx.letterSpacing = '10px'
    return ctx.measureText('fifl').width
  }
  const noCommon = element('font-variant-ligatures: no-common-ligatures')
  const none = element('font-variant-ligatures: none')
  return { ok: L.approx(noCommon, dom), expected: 'E with font-variant-ligatures:no-common-ligatures and letterSpacing 10px equals the DOM span width from H3', dom, noCommon, none, exact: noCommon === dom }
})

add('webkit-canvas H5', '', 'en', L => {
  const fonts = ['16px Arial', "16px 'Helvetica Neue'", "13.33px 'Times New Roman'", '17px Menlo', "20px 'Hiragino Mincho ProN'", "15px 'Geeza Pro'"]
  const strings = ['Hello world', 'AV', 'fifl', '中文“abc”', 'مرحبا', 'ab', '👨‍👩‍👧', 'x'.repeat(70)]
  const bad: unknown[] = []
  let n = 0
  for (const font of fonts) for (const text of strings) {
    const w = L.M(font, text)
    n++
    if (Math.fround(w) !== w) bad.push({ font, text, w })
  }
  return { ok: bad.length === 0, expected: 'Math.fround(w) === w for every measured width', measured: n, bad }
})

add('webkit-canvas H6', '', 'en', () => {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!
  ctx.font = "16px 'Geeza Pro'"
  ctx.direction = 'ltr'
  const ltr = ctx.measureText('مرحبا بالعالم').width
  ctx.direction = 'rtl'
  const rtl = ctx.measureText('مرحبا بالعالم').width
  return { ok: ltr === rtl, expected: 'O complex path: width with direction ltr equals rtl', ltr, rtl }
})

add('webkit-canvas H7', '', 'ja', (L, host) => {
  const font = '16px sans-serif'
  const text = '直角 骨'
  const span = L.put(`<span style="font:${font}">${text}</span>`)
  const dom = L.width(span)
  host.replaceChildren()
  const canvas = document.createElement('canvas')
  canvas.setAttribute('lang', 'ja')
  host.append(canvas)
  const ectx = canvas.getContext('2d')!
  ectx.font = font
  const element = ectx.measureText(text)
  const octx = new OffscreenCanvas(1, 1).getContext('2d')!
  octx.font = font
  const offscreen = octx.measureText(text)
  return {
    ok: L.approx(element.width, dom),
    expected: 'E with lang=ja equals the DOM span; O may differ (difference ≥ 0.05px only when glyphs differ)',
    dom, element: { width: element.width, left: element.actualBoundingBoxLeft, right: element.actualBoundingBoxRight },
    offscreen: { width: offscreen.width, left: offscreen.actualBoundingBoxLeft, right: offscreen.actualBoundingBoxRight },
  }
}, 'Generic sans-serif resolves through the WebKit default-font preferences of the host app.')

add('webkit-canvas H8', '', 'en', L => {
  const font = '16px Menlo'
  const nul = L.M(font, 'a b')
  const shy = L.M(font, 'a­b')
  const ab = L.M(font, 'ab')
  return { ok: nul === shy && shy === ab && ab === 19.265625, expected: 'O Menlo: "a\\0b" === "a\\u00ADb" === "ab" === 19.265625', nul, shy, ab }
})

add('webkit-canvas H10', '', 'en', L => {
  const font = "16px 'Helvetica Neue'"
  const canvasDiff = L.M(font, 'ab') - L.M(font, 'ab')
  const span = L.put(`<span style="white-space:pre;font:${font}"></span>`)
  span.textContent = 'ab'
  const d1 = L.width(span)
  span.textContent = 'ab'
  const d0 = L.width(span)
  return { ok: L.approx(canvasDiff, d1 - d0), expected: 'O "a\\u0001b" − "ab" equals DOM pre span "a\\u0001b" − "ab" (.notdef advance)', canvasDiff, domDiff: d1 - d0, dom: [d1, d0], exact: canvasDiff === d1 - d0 }
})

add('webkit-canvas H11', 'element lang', 'en', L => {
  const div = (lang: string) => `<div lang="${lang}" style="font:16px/20px Menlo;width:50px">abcd.“efg”</div>`
  const two = ['en', 'es', 'it', 'el', 'ko', 'zh', 'zh-Hant', 'xx']
  const one = ['sv', 'fi', 'da', 'he', 'ar', 'ja', 'de', 'fr', 'ru', 'hu', 'nl', 'fa']
  return L.cases([
    ...two.map(lang => ({ name: lang, html: div(lang), expect: { starts: [0, 5] } })),
    ...one.map(lang => ({ name: lang, html: div(lang), expect: { count: 1 } })),
  ])
}, 'xx falls back through the process ICU default locale.')

add('webkit-canvas H11', 'no lang', null, L => L.cases([
  { name: 'no lang', html: '<div style="font:16px/20px Menlo;width:50px">abcd.“efg”</div>', expect: { starts: [0, 5] } },
]), 'About a missing lang; the empty locale uses the process ICU default locale for quote overrides.')

add('webkit-canvas H12', '', 'en', L => L.cases([
  { name: 'sv then en', html: '<div style="font:16px/20px Menlo;width:50px"><span lang="sv">abcd.</span><span lang="en">“efg”</span></div>', expect: { count: 2 } },
  { name: 'en then sv', html: '<div style="font:16px/20px Menlo;width:50px"><span lang="en">abcd.</span><span lang="sv">“efg”</span></div>', expect: { count: 1 } },
]))

add('webkit-canvas H13', '', 'en', L => L.cases([
  { name: 'LB19a lang sv', html: '<div lang="sv" style="font:16px/24px \'Hiragino Sans\';width:16px">中“文”中</div>', expect: { starts: [0, 1, 4] } },
]))

add('webkit-canvas H14', '', 'en', L => L.cases([
  { name: '16-bit', html: '<div style="font:16px/20px Menlo;width:50px;word-break:keep-all">abcd,efgh中</div>', expect: { starts: [0, 5] } },
  { name: '8-bit', html: '<div style="font:16px/20px Menlo;width:50px;word-break:keep-all">abcd,efghé</div>', expect: { count: 1 } },
]))

add('webkit-canvas H15', '', 'en', L => {
  const font = "16px 'Times New Roman'"
  const span = L.put(`<span style="font:${font}">AV</span>`)
  const av = L.width(span)
  span.textContent = 'Hello world'
  const hello = L.width(span)
  const m = { AV: L.M(font, 'AV'), hello: L.M(font, 'Hello world') }
  return { ok: av === m.AV && hello === m.hello, expected: 'DOM span getBoundingClientRect width === O measureText for "AV" and "Hello world"', dom: { AV: av, hello }, canvas: m }
})

add('webkit-canvas H16', '', 'en', L => {
  const font = "16px 'Times New Roman'"
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!
  ctx.font = font
  const span = L.put(`<span style="font:${font}">Te st</span>`)
  const o = new Set<number>()
  const d = new Set<number>()
  for (let i = 0; i < 100; i++) {
    o.add(ctx.measureText('Te st').width)
    span.textContent = i % 2 === 0 ? 'Te st' : 'Te st '
    span.textContent = 'Te st'
    d.add(L.width(span))
  }
  return { ok: o.size === 1, expected: 'every O result identical while DOM and Canvas alternate', offscreen: [...o], dom: [...d] }
})

add('webkit-canvas H17', '', null, L => L.cases([
  { name: 'line-break:auto', html: '<div style="font:16px/20px Menlo;width:25px">a-1234</div>', expect: { starts: [0, 2] } },
  { name: 'line-break:strict', html: '<div style="font:16px/20px Menlo;width:25px;line-break:strict">a-1234</div>', expect: { count: 1 } },
]), 'About a missing lang.')

add('webkit-canvas H18', '', 'en', () => {
  const text = '\u{1F468}‍\u{1F469}‍\u{1F467} \u{1F1EF}\u{1F1F5}\u{1F1EF}\u{1F1F5}'
  const Seg = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment: (s: string) => Iterable<{ index: number }> } }).Segmenter
  if (Seg === undefined) return { ok: null, expected: 'Intl.Segmenter grapheme starts [0, 8, 9, 13]', error: 'no Intl.Segmenter' }
  const starts = Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(text), s => s.index)
  return { ok: JSON.stringify(starts) === JSON.stringify([0, 8, 9, 13]), expected: 'Intl.Segmenter grapheme starts [0, 8, 9, 13]', starts }
})

add('webkit-canvas H19', '', 'en', L => L.cases([
  { name: 'U+2028', html: '<div style="font:16px/20px Menlo;width:500px">ab cd</div>', expect: { starts: [0, 3] } },
]))

// ---------------------------------------------------------------------------------------------------------------------
// CRITIC.md §6 items that concern WebKit, plus W7 and the §7 font-size precision question.

add('CRITIC C11', '', 'en', L => {
  const r = L.cases([{ name: 'lang und', html: '<div lang="und" style="font:16px/20px Menlo;width:50px">abcd.“efg”</div>' }])
  return { ...r, expected: '2 lines: the process default has en-like quote overrides; 1 line: ja-like' }
})

add('CRITIC C12', '', 'en', L => {
  const font = '16px Arial'
  const space = L.M(font, 'a b')
  const controls = { FF: L.M(font, 'a\fb'), VT: L.M(font, 'a\vb'), CR: L.M(font, 'a\rb') }
  return { ok: Object.values(controls).every(w => w === space), expected: 'O: "a\\fb", "a\\vb" and "a\\rb" measure equal to "a b"', space, controls }
})

add('CRITIC C13', '', 'en', L => {
  const font = "40px 'Hoefler Text'"
  const spaced = L.M(font, 'fi', '1px')
  const ligature = L.M(font, 'fi')
  const separate = L.M(font, 'f') + L.M(font, 'i')
  return { ok: L.approx(spaced, ligature + 1), expected: 'Safari: O letterSpacing 1px "fi" = ligature width + 1 (Chrome/Firefox: W(f) + W(i) + 2)', spaced, ligaturePlusOne: ligature + 1, separatePlusTwo: separate + 2, exact: spaced === Math.fround(ligature + 1) }
})

add('CRITIC C14', '', 'en', L => L.cases([
  { name: 'full-width ab', html: '<div style="width:1px;text-transform:full-width;font:16px/24px \'Hiragino Sans\'">ab</div>', expect: { count: 2 } },
]))

add('CRITIC W7', '', 'en', L => {
  const el = L.put('<div id="a" style="font:16px/20px Arial"></div>')
  const empty = el.getBoundingClientRect().height
  el.textContent = '\r'
  const cr = el.getBoundingClientRect().height
  el.textContent = '\v'
  const vt = el.getBoundingClientRect().height
  return { ok: empty === 0 && cr === 0 && vt === 20, expected: 'empty div height 0; textContent "\\r" height 0; "\\v" one line', empty, cr, vt }
})

add('CRITIC §7 font-size', '', 'en', L => {
  const rows: unknown[] = []
  let ok = true
  for (const size of ['13.33px', '13.337px', '11.1111px', '17.49px']) {
    const font = `${size} Arial`
    const span = L.put(`<span style="font:${font}">Hello world</span>`)
    const dom = L.width(span)
    const canvas = L.M(font, 'Hello world')
    if (dom !== canvas) ok = false
    // NBSP turns off the DOM's simplified measuring, so the DOM sums like Canvas; single glyphs have no summing order.
    const nbspDom = L.width(L.put(`<span style="font:${font}">Hello world</span>`))
    const glyphDom = L.width(L.put(`<span style="font:${font}">H</span>`))
    rows.push({ size, dom, canvas, nbspDom, nbspCanvas: L.M(font, 'Hello world'), glyphDom, glyphCanvas: L.M(font, 'H'), glyphAt16Scaled: L.M('16px Arial', 'H') * Number.parseFloat(size) / 16 })
  }
  return { ok, expected: 'WebKit quantizes neither Canvas nor DOM font sizes: DOM span width === O width at fractional sizes', rows }
})

// ---------------------------------------------------------------------------------------------------------------------
// Cross-cutting probes.

add('cross-cutting 1', 'emoji', 'en', L => {
  const dpr = devicePixelRatio
  const texts = { grinning: '\u{1F600}', family: '\u{1F468}‍\u{1F469}‍\u{1F467}' }
  const rows: unknown[] = []
  for (const [name, text] of Object.entries(texts)) {
    for (const size of [8, 10, 12, 14, 16, 20, 24, 32]) {
      const font = `${size}px 'Apple Color Emoji'`
      const span = L.put(`<span style="font:${font};white-space:nowrap">${text}</span>`)
      const dom = L.width(span)
      const domExtent = L.extent(span)
      const atSize = L.M(font, text)
      const atDevice = L.M(`${size * dpr}px 'Apple Color Emoji'`, text) / dpr
      rows.push({ name, size, dom, domExtent, canvasAtSize: atSize, canvasAtSizeTimesDprOverDpr: atDevice, domEqualsAtSize: dom === atSize, domEqualsAtDevice: dom === atDevice })
    }
  }
  return { ok: null, expected: 'which Canvas recipe (size, or size×DPR/DPR) equals the DOM width per size', dpr, rows }
})

add('cross-cutting 2', 'controls', 'en', L => {
  const font = '16px Arial'
  const rows: unknown[] = []
  for (const [name, text] of [['CR', 'a\rb'], ['FF', 'a\fb'], ['VT', 'a\vb'], ['TAB', 'a\tb'], ['ab', 'ab'], ['a b', 'a b']] as const) {
    const out: Record<string, unknown> = { name, canvas: L.M(font, text) }
    for (const mode of ['normal', 'pre']) {
      const span = L.put(`<span style="font:${font};white-space:${mode}"></span>`)
      span.textContent = text
      out[mode] = { rect: L.width(span), extent: L.extent(span) }
    }
    rows.push(out)
  }
  return { ok: null, expected: 'DOM widths of a\\rb, a\\fb, a\\vb, a\\tb in white-space normal and pre versus Canvas', rows }
})

add('cross-cutting 3', 'ligatures', 'en', L => {
  const text = 'ffi fl'
  const rows: unknown[] = []
  for (const family of ["'Hoefler Text'", "'Helvetica Neue'"]) {
    const font = `32px ${family}`
    const dom: Record<string, number> = {}
    for (const ls of ['0', '0.001px', '1px']) {
      const span = L.put(`<span style="font:${font};letter-spacing:${ls};white-space:nowrap">${text}</span>`)
      dom[`letterSpacing ${ls}`] = L.width(span)
    }
    for (const tr of ['auto', 'optimizeSpeed', 'optimizeLegibility', 'geometricPrecision']) {
      const span = L.put(`<span style="font:${font};text-rendering:${tr};white-space:nowrap">${text}</span>`)
      dom[`textRendering ${tr}`] = L.width(span)
    }
    const canvas: Record<string, unknown> = {}
    for (const ls of ['0px', '0.001px', '1px']) canvas[`letterSpacing ${ls}`] = L.M(font, text, ls)
    for (const tr of ['optimizeSpeed', 'optimizeLegibility', 'geometricPrecision']) {
      const ctx = new OffscreenCanvas(1, 1).getContext('2d')!
      ctx.font = font
      ;(ctx as unknown as Record<string, unknown>)['textRendering'] = tr
      canvas[`textRendering ${tr}`] = { width: ctx.measureText(text).width, readback: (ctx as unknown as Record<string, unknown>)['textRendering'], native: 'textRendering' in OffscreenCanvasRenderingContext2D.prototype }
    }
    const perChar = L.M(font, 'f') * 3 + L.M(font, 'i') + L.M(font, ' ') + L.M(font, 'l')
    rows.push({ font, dom, canvas, perCharSum: perChar })
  }
  return { ok: null, expected: 'which DOM letter-spacing / text-rendering variants keep ligatures, and which Canvas variants match them', rows }
})

for (const lang of ['ja', 'zh-Hans', 'ko', 'en']) {
  add('cross-cutting 4', `lang ${lang}`, lang, (L, host) => {
    const font = '32px sans-serif'
    const text = '永骨'
    const span = L.put(`<span style="font:${font}">${text}</span>`)
    const dom = L.width(span)
    const draw = (ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
      ctx.font = font
      ctx.textBaseline = 'top'
      ctx.fillText(text, 0, 0)
      const data = ctx.getImageData(0, 0, 80, 40).data
      let hash = 0
      for (let i = 3; i < data.length; i += 4) hash = (hash * 31 + data[i]!) >>> 0
      const m = ctx.measureText(text)
      return { width: m.width, left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, inkHash: hash }
    }
    const octx = new OffscreenCanvas(80, 40).getContext('2d')!
    const offscreen = draw(octx)
    host.replaceChildren()
    const canvas = document.createElement('canvas')
    canvas.width = 80
    canvas.height = 40
    host.append(canvas)
    const element = draw(canvas.getContext('2d')!)
    return { ok: null, expected: 'OffscreenCanvas versus DOM (and a connected canvas inheriting the page lang) for 永骨 in sans-serif', pageLang: document.documentElement.lang, dom, offscreen, element, sameInk: offscreen.inkHash === element.inkHash }
  }, 'Generic sans-serif resolves through the WebKit default-font preferences of the host app.')
}

add('cross-cutting 5', 'system-ui', 'en', L => {
  const rows: unknown[] = []
  for (const family of ['system-ui', '-apple-system']) {
    for (const size of [13, 14, 16, 20]) {
      const font = `${size}px ${family}`
      for (const text of ['Hello world', 'The quick brown fox 0123']) {
        const span = L.put(`<span style="font:${font};white-space:nowrap">${text}</span>`)
        const dom = L.width(span)
        const canvas = L.M(font, text)
        rows.push({ family, size, text, dom, canvas, equal: dom === canvas })
      }
    }
  }
  return { ok: null, expected: 'Canvas versus DOM widths for system-ui and -apple-system', rows }
})

add('cross-cutting 6', 'environment', 'en', L => {
  const font = '16px Arial'
  const el = L.put('<div style="font:16px/20px Arial">nnnnn nnnnn</div>')
  const sp = L.M(font, ' ')
  const s = L.f(L.f(L.M(font, 'nnnnn ') - sp) + sp)
  const w = L.f(s + L.M(font, 'nnnnn'))
  const count = (px: number): number => { el.style.width = `${px}px`; return Math.round(el.getBoundingClientRect().height / 20) }
  const k0 = Math.round(L.T(w) * 128)
  const scan: number[][] = []
  let minOne128: number | null = null
  for (let k = k0 - 8; k <= k0 + 8; k++) {
    const c = count(k / 128)
    scan.push([k, c])
    if (minOne128 === null && c === 1) minOne128 = k
  }
  // 1/64 CSS px grid: the smallest one-line width is an even k; widths (2j+1)/128 give the same lines as 2j/128.
  let oddMatchesEven = true
  for (let i = 1; i < scan.length; i++) if (scan[i]![0]! % 2 !== 0 && scan[i]![1] !== scan[i - 1]![1]) oddMatchesEven = false
  const predictedMin64 = (() => { for (let k = Math.floor(k0 / 2) - 8; ; k++) if (L.M(font, 'nnnnn') <= L.f(L.f(k / 64 + 1 / 64) - s)) return k * 2 })()
  return {
    ok: minOne128 !== null && minOne128 % 2 === 0 && oddMatchesEven && minOne128 === predictedMin64,
    expected: 'line breaking at DPR 2 follows the 1/64 CSS px grid, not 1/64 of a device pixel: odd k/128 widths behave like the even width below them',
    devicePixelRatio, visualViewportScale: window.visualViewport?.scale ?? null, userAgent: navigator.userAgent,
    w, minOne128, predictedMin128: predictedMin64, oddMatchesEven, scan,
  }
})

probes.push({ id: 'cross-cutting 6 env', spec: 'cross-cutting 6', pageLang: 'en', browsers: ['safari'], observe: [{ kind: 'env', families: ['Arial', 'Helvetica Neue', 'Hoefler Text', 'Georgia', 'Menlo', 'Times New Roman', 'Hiragino Mincho ProN', 'Hiragino Sans', 'Thonburi', 'Geeza Pro', 'Apple Color Emoji'] }] })

export default probes
