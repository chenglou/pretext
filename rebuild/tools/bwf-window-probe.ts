// Where trees of Blink's port part on one paragraph, read against Chrome's own positions: each tree's cuts, its position
// at every offset of every group, the wide windows it measured on the way (a tree whose shape.ts pushes
// [g, k, from, to, a, b, window, left, right, d] into globalThis.__bwfWin, as a diagnostic copy does), what a tree's
// line breaker pushes into globalThis.__bwfLog (a diagnostic copy's ShapeLine steps), its lines at the entry's width, and
// Chrome's position of every offset on one line (the width of a Range from the group's start) and its own lines at the
// width.
//
//   BWF_TREES=<name>=<checkout>,... BWF_WIN=<entries.json> bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/tools/bwf-window-probe.ts --out=<dir> [--chrome-args=--force-device-scale-factor=1]
//
// entries.json: [{ family, size, weight?, style?, text, direction, lang?, width, letterSpacing?, wordSpacing?,
// whiteSpace? }], family as CSS writes it (quoted where it needs quotes).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'

const ENTRY = (tree: string, name: string): string => `
import { createContextPool, detectEnvironment, fillLine, firstLine, prepare } from '${tree}/rebuild/src/index.ts'
import { UNKNOWN_FONT_FACTS } from '${tree}/rebuild/src/model.ts'
import * as shape from '${tree}/rebuild/src/engines/blink/shape.ts'

function environment() {
  const detected = detectEnvironment({ engine: 'blink', build: null, contentLanguage: null, uiLanguage: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

function paragraphOf(e) {
  const font = { family: e.family, size: e.size, weight: e.weight ?? 400, style: e.style ?? 'normal', facts: UNKNOWN_FONT_FACTS }
  return { font, letterSpacing: e.letterSpacing ?? 0, wordSpacing: e.wordSpacing ?? 0, whiteSpace: e.whiteSpace ?? 'normal', wordBreak: 'normal',
    overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text: e.text }], lineHeight: e.size * 2,
    direction: e.direction, lang: e.lang ?? 'en', textIndent: 0, textAlign: 'start' }
}

function run(e) {
  const env = environment()
  const paragraph = paragraphOf(e)
  globalThis.__bwfWin = []
  globalThis.__bwfLog = []
  const prepared = prepare(paragraph, env, false, createContextPool())
  const p = prepared.state
  const sh = { p, gaps: null }
  const groups = []
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]
    const positions = []
    for (let k = group.start + 1; k < group.end; k++) positions.push([k, shape.groupPrefix16(sh, g, k)])
    groups.push({ start: group.start, end: group.end, rtl: group.rtl, cuts: group.cuts, prefix: group.prefixAtCut, positions })
  }
  const windows = globalThis.__bwfWin
  const lines = []
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width: e.width, left: 0, right: 0 })
    if (filled.kind === 'line') lines.push([filled.start, filled.end, filled.line.info.width])
    start = filled.next
  }
  const log = globalThis.__bwfLog
  delete globalThis.__bwfWin
  delete globalThis.__bwfLog
  return { zoom: p.layoutZoom, groups, windows, lines, log }
}

globalThis.${name} = { run }
`

const BODY = String.raw`
const host = document.createElement('div');
host.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px;overflow:visible;';
document.body.append(host);
const range = document.createRange();
function element(e, width, nowrap) {
  const el = document.createElement('div');
  const s = el.style;
  s.position = 'absolute'; s.left = '0'; s.top = '0'; s.margin = '0'; s.padding = '0'; s.border = '0';
  s.width = width + 'px';
  s.fontFamily = e.family; s.fontSize = e.size + 'px'; s.fontWeight = String(e.weight ?? 400); s.fontStyle = e.style ?? 'normal';
  s.letterSpacing = (e.letterSpacing ?? 0) + 'px'; s.wordSpacing = (e.wordSpacing ?? 0) + 'px'; s.lineHeight = (e.size * 2) + 'px';
  s.setProperty('white-space', nowrap ? 'nowrap' : (e.whiteSpace ?? 'normal')); s.setProperty('overflow-wrap', 'break-word');
  s.setProperty('direction', e.direction);
  el.lang = e.lang ?? 'en';
  el.append(document.createTextNode(e.text));
  host.append(el);
  return el;
}
const out = [];
for (let n = 0; n < ENTRIES.length; n++) {
  const e = ENTRIES[n];
  const trees = {};
  for (let t = 0; t < NAMES.length; t++) trees[NAMES[t]] = globalThis['bwfT' + t].run(e);
  // Chrome's widths from each group start on one line, in CSS px (a Range's box).
  const one = element(e, 100000, true);
  const node = one.firstChild;
  const nativeWidths = [];
  const groups = trees[NAMES[0]].groups;
  for (let g = 0; g < groups.length; g++) {
    const row = [];
    for (let k = groups[g].start + 1; k <= groups[g].end; k++) { range.setStart(node, groups[g].start); range.setEnd(node, k); row.push([k, range.getBoundingClientRect().width]); }
    nativeWidths.push(row);
  }
  one.remove();
  const wrapped = element(e, e.width, false);
  const origin = wrapped.getBoundingClientRect();
  const lineOf = [];
  for (let i = 0; i < e.text.length; i++) {
    range.setStart(wrapped.firstChild, i); range.setEnd(wrapped.firstChild, i + 1);
    const rects = range.getClientRects();
    let line = -1;
    for (let r = rects.length - 1; r >= 0; r--) { if (rects[r].width > 0 && rects[r].height > 0) { line = Math.floor((rects[r].top - origin.top + rects[r].height / 2) / (e.size * 2)); break; } }
    lineOf.push(line);
  }
  const nativeCount = Math.round(origin.height / (e.size * 2));
  wrapped.remove();
  out.push({ entry: e, devicePixelRatio: window.devicePixelRatio, trees, nativeWidths, lineOf, nativeCount });
}
host.remove();
return out;
`

export default async function bwfWindowProbes(): Promise<Probe[]> {
  const treesArg = process.env['BWF_TREES']
  const entriesPath = process.env['BWF_WIN']
  if (treesArg === undefined || entriesPath === undefined) throw new Error('BWF_TREES names the checkouts (name=path,...) and BWF_WIN the entries file')
  const trees = treesArg.split(',').map(pair => { const [name, path] = pair.split('='); return { name: name!, path: resolve(path!) } })
  const dir = mkdtempSync(join(tmpdir(), 'bwf-window-probe-'))
  const bundles: string[] = []
  for (let t = 0; t < trees.length; t++) {
    const entry = join(dir, `t${t}.ts`)
    writeFileSync(entry, ENTRY(trees[t]!.path, `bwfT${t}`))
    const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
    bundles.push(await built.outputs[0]!.text())
  }
  const constants = `const ENTRIES = ${readFileSync(resolve(entriesPath), 'utf8')};\nconst NAMES = ${JSON.stringify(trees.map(t => t.name))};`
  return [{
    id: 'bwf-window W1', spec: 'where trees of the port part on a paragraph: cuts, positions, wide windows and lines, beside Chrome\'s own positions and lines', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundles.join('\n')}\n${constants}\n${BODY}` }],
  }]
}
