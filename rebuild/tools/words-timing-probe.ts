// Alternating timed pairs of two checkouts of the library in one page of the real browser, on the bench's chat messages
// (bench/cases.ts buildChat): the base and the head take turns inside one document, so a pair shares the browser, the
// machine's load and its heat. For the second words study of Blink's port (shape.ts addWords, line-breaker.ts
// wordCandidate). Not a test, and no replacement for the bench's headline: it times fewer messages, more often.
//
//   TIME_TREE_A=<base checkout> TIME_TREE_B=<head checkout> [TIME_MESSAGES=2000] [TIME_PAIRS=10] [TIME_SETS=mix,latin,real] \
//     bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/words-timing-probe.ts --out=<dir> \
//     --probe-timeout-ms=3000000 --stall-ms=3000000 [--chrome-args=--force-device-scale-factor=1]
//     (a timed run: under the exclusive browser lock)
//
// Per set and pair, each tree in turn (the base first on even pairs, the head first on odd ones), in ms:
// - `scratch`: every message prepared plain from scratch with a list of contexts of its own and filled at 320 px, nothing kept;
// - `scratchOneList`: the same with one list of contexts for the pass, every prepared paragraph kept;
// - `newWidths`: the kept paragraphs filled at 260, 380 and 440 px, which they haven't met;
// - `metWidths`: the same fills once more.
// The first pair warms the page up and is left out of the medians. After the pairs, one counting pass a tree with
// measureText wrapped: calls, UTF-16 units sent and strings new to the page (by font string and text) for each step, and
// the lines of every step, which must be equal in both trees.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CHAT_CODE_FONT, CHAT_CODE_PADDING, CHAT_RESIZE_WIDTHS, CHAT_STYLE, CHAT_WIDTH, buildChat } from '../bench/cases.ts'
import type { Probe } from '../probes/types.ts'

const ENTRY = (tree: string, name: string): string => `
import { detectEnvironment, fillLine, firstLine, prepare } from '${tree}/rebuild/src/index.ts'
import { UNKNOWN_FONT_FACTS } from '${tree}/rebuild/src/model.ts'
import { LineBreaker } from '${tree}/rebuild/src/engines/blink/line-breaker.ts'

function environment() {
  const detected = detectEnvironment({ engine: 'blink', build: null, contentLanguage: null, uiLanguage: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

function fill(prepared, width) {
  let lines = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'line' && filled.hasLineBox) lines++
    start = filled.next
  }
  return lines
}

// How each line found its candidate, where the tree has LineBreaker.wordCandidate: from the cuts' positions, without a
// search (no position was read), or by the search, with the negative number that says why.
const outcomes = []
const fromCuts = LineBreaker.prototype.wordCandidate
function tallyLines(prepared, width, tally) {
  if (fromCuts === undefined) return
  LineBreaker.prototype.wordCandidate = function (...args) { const found = fromCuts.apply(this, args); outcomes.push(found); return found }
  for (let start = firstLine(prepared); start !== null;) {
    outcomes.length = 0
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    let reason = 0, found = false
    for (let i = 0; i < outcomes.length; i++) { if (outcomes[i] >= 0) found = true; else if (outcomes[i] < -1 && reason === 0) reason = outcomes[i] }
    tally.lines++
    if (reason !== 0) { tally.searched++; tally.reasons[reason] = (tally.reasons[reason] ?? 0) + 1 } else if (found) tally.cuts++; else tally.noSearch++
    start = filled.next
  }
  LineBreaker.prototype.wordCandidate = fromCuts
}

globalThis.${name} = { environment, fill, tallyLines, facts: UNKNOWN_FONT_FACTS, prepare: (paragraph, env, contexts) => prepare(paragraph, env, false, contexts) }
`

const BODY = String.raw`
const TREES = [globalThis.timeTreeA, globalThis.timeTreeB];
const envs = [TREES[0].environment(), TREES[1].environment()];
const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 };
const edge = { margin: 0, border: 0, padding: CODE_PADDING };
function paragraphsOf(tree, messages) {
  const font = { ...STYLE.font, facts: tree.facts }, codeFont = { ...CODE_FONT, facts: tree.facts };
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const content = [];
    for (let k = 0; k < messages[i].length; k++) {
      const part = messages[i][k];
      if (part.code) content.push({ ...text, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] });
      else content.push({ kind: 'text', text: part.text });
    }
    out.push({ ...text, font, content, lineHeight: STYLE.lineHeight, direction: STYLE.direction, lang: STYLE.lang, textIndent: 0, textAlign: 'start' });
  }
  return out;
}
// One tree's four steps over a set's paragraphs: times in ms and lines.
function steps(t, paragraphs) {
  const tree = TREES[t], env = envs[t];
  const out = { ms: [0, 0, 0, 0], lines: [0, 0, 0, 0] };
  let start = performance.now();
  for (let i = 0; i < paragraphs.length; i++) out.lines[0] += tree.fill(tree.prepare(paragraphs[i], env, []), WIDTH);
  out.ms[0] = performance.now() - start;
  const page = [], kept = [];
  start = performance.now();
  for (let i = 0; i < paragraphs.length; i++) { kept.push(tree.prepare(paragraphs[i], env, page)); out.lines[1] += tree.fill(kept[i], WIDTH); }
  out.ms[1] = performance.now() - start;
  for (let step = 2; step < 4; step++) {
    start = performance.now();
    for (let w = 0; w < RESIZE.length; w++) for (let i = 0; i < kept.length; i++) out.lines[step] += tree.fill(kept[i], RESIZE[w]);
    out.ms[step] = performance.now() - start;
  }
  return out;
}
const spin = () => { const start = performance.now(); let x = 0; for (let i = 0; i < 20000000; i++) x = (x + i * i) % 1000003; return performance.now() - start; };
const report = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, messages: MESSAGES, pairs: PAIRS, spinMs: [spin()], sets: [] };
for (let s = 0; s < SETS.length; s++) {
  const paragraphs = [paragraphsOf(TREES[0], SETS[s].messages), paragraphsOf(TREES[1], SETS[s].messages)];
  const set = { set: SETS[s].id, pairs: [], counts: [], lineTallies: [], lines: [] };
  for (let pair = 0; pair < PAIRS; pair++) {
    const row = [null, null];
    for (let turn = 0; turn < 2; turn++) {
      const t = pair % 2 === 0 ? turn : 1 - turn;
      row[t] = steps(t, paragraphs[t]);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    set.pairs.push({ base: row[0].ms, head: row[1].ms });
    if (pair === 0) set.lines = [row[0].lines, row[1].lines];
  }
  // The counting pass: measureText wrapped, one tree at a time.
  const proto = OffscreenCanvasRenderingContext2D.prototype, original = proto.measureText;
  for (let t = 0; t < 2; t++) {
    const met = new Set();
    const tally = { calls: 0, units: 0, newCalls: 0, newUnits: 0 };
    proto.measureText = function (string) {
      tally.calls++; tally.units += string.length;
      const key = this.font + '|' + this.letterSpacing + '|' + this.fontKerning + '|' + this.textRendering + '|' + this.direction + '|' + string;
      if (!met.has(key)) { met.add(key); tally.newCalls++; tally.newUnits += string.length; }
      return original.call(this, string);
    };
    const tree = TREES[t], env = envs[t], page = [], kept = [], marks = [];
    for (let i = 0; i < paragraphs[t].length; i++) { kept.push(tree.prepare(paragraphs[t][i], env, page)); tree.fill(kept[i], WIDTH); }
    marks.push({ ...tally });
    for (let step = 0; step < 2; step++) {
      for (let w = 0; w < RESIZE.length; w++) for (let i = 0; i < kept.length; i++) tree.fill(kept[i], RESIZE[w]);
      marks.push({ ...tally });
    }
    proto.measureText = original;
    set.counts.push(marks);
    const tally = { lines: 0, cuts: 0, noSearch: 0, searched: 0, reasons: {} };
    for (let w = 0; w < RESIZE.length + 1; w++) for (let i = 0; i < kept.length; i++) tree.tallyLines(kept[i], w === 0 ? WIDTH : RESIZE[w - 1], tally);
    set.lineTallies.push(tally);
  }
  report.sets.push(set);
  report.spinMs.push(spin());
}
return report;
`

export default async function wordsTimingProbes(): Promise<Probe[]> {
  const treeA = process.env['TIME_TREE_A']
  const treeB = process.env['TIME_TREE_B']
  if (treeA === undefined || treeB === undefined) throw new Error('TIME_TREE_A and TIME_TREE_B name the two checkouts')
  const count = Number(process.env['TIME_MESSAGES'] ?? 2000)
  const ids = (process.env['TIME_SETS'] ?? 'mix,latin,real').split(',') as Parameters<typeof buildChat>[0][]
  const sets: Array<{ id: string; messages: Array<Array<{ text: string; code: boolean }>> }> = []
  for (let i = 0; i < ids.length; i++) sets.push({ id: ids[i]!, messages: buildChat(ids[i]!, count).map(message => message.parts.map(part => ({ text: part.text, code: part.code }))) })
  const dir = mkdtempSync(join(tmpdir(), 'words-timing-probe-'))
  const bundles: string[] = []
  const sides: Array<[string, string]> = [[resolve(treeA), 'timeTreeA'], [resolve(treeB), 'timeTreeB']]
  for (let i = 0; i < sides.length; i++) {
    const entry = join(dir, `${sides[i]![1]}.ts`)
    writeFileSync(entry, ENTRY(sides[i]![0], sides[i]![1]))
    const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
    bundles.push(await built.outputs[0]!.text())
  }
  const constants = `const SETS = ${JSON.stringify(sets)};\nconst MESSAGES = ${count};\nconst PAIRS = ${Number(process.env['TIME_PAIRS'] ?? 10)};\nconst STYLE = ${JSON.stringify({ font: CHAT_STYLE.font, lineHeight: CHAT_STYLE.lineHeight, direction: CHAT_STYLE.direction, lang: CHAT_STYLE.lang })};\nconst CODE_FONT = ${JSON.stringify(CHAT_CODE_FONT)};\nconst CODE_PADDING = ${CHAT_CODE_PADDING};\nconst WIDTH = ${CHAT_WIDTH};\nconst RESIZE = ${JSON.stringify(CHAT_RESIZE_WIDTHS)};`
  return [{
    id: 'words-timing T1', spec: 'alternating timed pairs of two checkouts of Blink\'s port on the bench\'s chat messages', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundles[0]!}\n${bundles[1]!}\n${constants}\n${BODY}` }],
  }]
}
