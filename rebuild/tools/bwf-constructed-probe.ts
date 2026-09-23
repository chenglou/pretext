// A probe of Blink's words first and cut predictor on constructed paragraphs (tools/bwf-constructed-cases.ts) in the real
// browser: two checkouts of the library, the base and the head, lay every case out plain in one page, at the case's
// width, a few ordinary widths, and each of the head's first lines' own widths with one LayoutUnit to either side, and
// their lines are compared (range, line box, width, overflow: the decided line's LineInfo). The head also lays each case
// out inspected at three of those widths, and every gap of a premise it reports is counted (words first's
// context-past-a-word and positions-run-backwards, the cut predictor's nested-window-wider), with whether the inspected
// lines equal the plain ones. Differing layouts are listed for tools/bwf-constructed-verdict.ts, which makes lab cases
// of them for the browser's own layout to judge. Counts, no times.
//
//   CON_TREE_A=<base checkout> CON_TREE_B=<head checkout> CON_CASES=<cases.ndjson> [CON_LIMIT=N] \
//     bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/bwf-constructed-probe.ts --out=<dir> \
//     --probe-timeout-ms=6000000 --stall-ms=6000000 [--chrome-args=--force-device-scale-factor=N]
//     (under a Chrome slot of the browser lock)
//
// One probe per page language of the cases, since the library reads <html lang>.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'

export const ENTRY = (tree: string, name: string): string => `
import { createContextPool, detectEnvironment, fillLine, firstLine, inspectLine, paragraphGaps, prepare } from '${tree}/rebuild/src/index.ts'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS } from '${tree}/rebuild/src/model.ts'

function environment() {
  const detected = detectEnvironment({ engine: 'blink', build: null, contentLanguage: null, uiLanguage: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

const facts = font => ({ ...font, facts: UNKNOWN_FONT_FACTS })
function tree(nodes) {
  const out = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.kind === 'span') out.push({ ...node, font: facts(node.font), children: tree(node.children) })
    else out.push(node)
  }
  return out
}

// The paragraph the library takes for a lab case (lab/predictor-core.ts layoutInput), with no font facts.
function paragraphOf(c) {
  const p = c.paragraph
  const style = (font, letterSpacing, wordSpacing) => ({ font: facts(font), letterSpacing, wordSpacing, whiteSpace: p.whiteSpace, wordBreak: p.wordBreak, overflowWrap: p.overflowWrap, lineBreak: p.lineBreak, tabSize: p.tabSize })
  if (c.inline !== undefined) return { ...style(p.font, p.letterSpacing, p.wordSpacing), content: tree(c.inline.content), lang: p.lang, direction: p.direction, lineHeight: p.lineHeight, textIndent: c.inline.textIndent, textAlign: c.inline.textAlign }
  const content = []
  for (let r = 0; r < p.runs.length; r++) {
    const run = p.runs[r]
    if (run.node === 'text') content.push({ kind: 'text', text: run.text })
    else content.push({ ...style(run.font, run.letterSpacing, run.wordSpacing), kind: 'span', lang: run.lang, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text: run.text }] })
  }
  return { ...style(p.font, p.letterSpacing, p.wordSpacing), content, lang: p.lang, direction: p.direction, lineHeight: p.lineHeight, textIndent: 0, textAlign: 'start' }
}

// Every decided line at a width, with the slots' insets; with gaps, the names of every gap the paragraph and its lines
// report (with details, each gap once as JSON, when \`details\` is a set too).
function lines(prepared, width, slots, gaps, details = null) {
  const out = []
  const note = gap => { gaps.add(gap.gap); if (details !== null && details.size < 50) details.add(JSON.stringify(gap)) }
  if (gaps !== null) for (const gap of paragraphGaps(prepared)) note(gap)
  let row = 0
  for (let start = firstLine(prepared); start !== null;) {
    const inset = row < slots.length ? slots[row] : { left: 0, right: 0 }
    const filled = fillLine(prepared, start, { width, left: inset.left, right: inset.right })
    if (filled.kind === 'line') {
      out.push([filled.start, filled.end, filled.hasLineBox, filled.line.info.width, filled.line.info.hasOverflow])
      if (gaps !== null) for (const gap of inspectLine(prepared, filled.line).gaps) note(gap)
      if (filled.hasLineBox) row++
    } else {
      out.push(['below-floats'])
      row++
    }
    start = filled.next
    if (out.length > 4000) throw new Error('more than 4000 lines')
  }
  return out
}

globalThis.${name} = { environment, paragraphOf, lines, createContextPool, prepare }
`

const BODY = String.raw`
const A = globalThis.conTreeA, B = globalThis.conTreeB;
const envA = A.environment(), envB = B.environment();
const zoom = window.devicePixelRatio;
const ORDINARY = [61.7, 143, 250.5, 411, 900];
const PREMISES = ['context-past-a-word', 'positions-run-backwards', 'nested-window-wider'];
const tally = { cases: 0, layouts: 0, lines: 0, differ: 0, inspectedLayouts: 0, inspectedDiffer: 0, errors: 0, premiseLayouts: {}, premiseDifferLayouts: 0 };
const byFamily = {};
const differing = [], premised = [], errors = [];
const bump = (t, k, n) => { t[k] = (t[k] ?? 0) + n; };
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  const family = c.family;
  const f = byFamily[family] ??= { cases: 0, layouts: 0, differ: 0, premise: 0, errors: 0 };
  f.cases++; tally.cases++;
  const slots = c.inline?.lineSlots ?? [];
  let pa, pb, qa, qb;
  try {
    pa = A.paragraphOf(c); pb = B.paragraphOf(c);
    qa = A.prepare(pa, envA, false, A.createContextPool());
    qb = B.prepare(pb, envB, false, B.createContextPool());
  } catch (e) { tally.errors++; f.errors++; if (errors.length < 40) errors.push({ id: c.id, family, error: String(e).slice(0, 300) }); continue; }
  const widths = [c.paragraph.width, ...ORDINARY];
  const seen = new Set(widths);
  const inspectAt = new Set([c.paragraph.width, 143, 411]);
  let caseDiffers = false;
  for (let w = 0; w < widths.length; w++) {
    const width = widths[w];
    let la, lb;
    try { la = A.lines(qa, width, slots, null); lb = B.lines(qb, width, slots, null); }
    catch (e) { tally.errors++; f.errors++; if (errors.length < 40) errors.push({ id: c.id, family, width, error: String(e).slice(0, 300) }); continue; }
    tally.layouts++; f.layouts++; tally.lines += lb.length;
    const ja = JSON.stringify(la), jb = JSON.stringify(lb);
    let gaps = null;
    if (inspectAt.has(width)) {
      gaps = new Set();
      try {
        const qi = B.prepare(pb, envB, true, B.createContextPool());
        const li = B.lines(qi, width, slots, gaps);
        tally.inspectedLayouts++;
        if (JSON.stringify(li) !== jb) { tally.inspectedDiffer++; if (errors.length < 40) errors.push({ id: c.id, family, width, inspectedDiffers: true }); }
      } catch (e) { tally.errors++; f.errors++; if (errors.length < 40) errors.push({ id: c.id, family, width, inspected: true, error: String(e).slice(0, 300) }); gaps = null; }
    }
    const found = gaps === null ? [] : PREMISES.filter(name => gaps.has(name));
    for (const name of found) bump(tally.premiseLayouts, name, 1);
    if (found.length > 0) { f.premise++; if (premised.length < 400) premised.push({ id: c.id, family, width, gaps: found }); }
    if (ja !== jb) {
      tally.differ++; f.differ++; caseDiffers = true;
      if (found.length > 0) tally.premiseDifferLayouts++;
      let l = 0;
      while (l < la.length && l < lb.length && JSON.stringify(la[l]) === JSON.stringify(lb[l])) l++;
      if (differing.length < 1500) differing.push({ id: c.id, family, width, line: l, base: la[l] ?? null, head: lb[l] ?? null, baseLines: la.length, headLines: lb.length, gaps: found });
    }
    if (w >= 1 && w <= 5) for (let l = 0; l < lb.length && l < 8; l++) for (let d = -1; d <= 1; d++) {
      if (lb[l].length < 4) continue;
      const at = (lb[l][3] + d) / 64 / zoom;
      if (at > 0 && !seen.has(at)) { seen.add(at); widths.push(at); }
    }
  }
  if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
}
return { userAgent: navigator.userAgent, devicePixelRatio: zoom, lang: document.documentElement.lang, tally, byFamily, differing, premised, errors };
`

export default async function bwfConstructedProbes(): Promise<Probe[]> {
  const treeA = process.env['CON_TREE_A']
  const treeB = process.env['CON_TREE_B']
  const casesPath = process.env['CON_CASES']
  if (treeA === undefined || treeB === undefined || casesPath === undefined) throw new Error('CON_TREE_A, CON_TREE_B and CON_CASES name the two checkouts and the cases file')
  const limit = Number(process.env['CON_LIMIT'] ?? Infinity)
  const dir = mkdtempSync(join(tmpdir(), 'bwf-constructed-probe-'))
  const bundles: string[] = []
  const sides: Array<[string, string]> = [[resolve(treeA), 'conTreeA'], [resolve(treeB), 'conTreeB']]
  for (let i = 0; i < sides.length; i++) {
    const entry = join(dir, `${sides[i]![1]}.ts`)
    writeFileSync(entry, ENTRY(sides[i]![0], sides[i]![1]))
    const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
    bundles.push(await built.outputs[0]!.text())
  }
  const byLang = new Map<string, unknown[]>()
  let n = 0
  for (const line of readFileSync(resolve(casesPath), 'utf8').split('\n')) {
    if (line === '' || n >= limit) continue
    const c = JSON.parse(line) as { pageLang: string }
    let list = byLang.get(c.pageLang)
    if (list === undefined) byLang.set(c.pageLang, list = [])
    list.push(c)
    n++
  }
  const probes: Probe[] = []
  for (const [lang, cases] of byLang) {
    probes.push({
      id: `bwf-constructed ${lang}`, spec: 'constructed paragraphs: the base and the head of Blink\'s port, plain lines compared, and the premises\' gaps the head\'s inspected paragraph reports', pageLang: lang, html: '<div></div>',
      observe: [{ kind: 'script', source: `${bundles[0]!}\n${bundles[1]!}\nconst CASES = ${JSON.stringify(cases)};\n${BODY}` }],
    })
  }
  return probes
}
