// An attack on words first and the cut predictor in Blink's port (shape.ts addWordPieces, windowAdjust16), on real fonts
// in real Chrome, scored by Chrome itself: the base and the head lay the same paragraphs out in one page, and wherever
// their lines differ the page lays the paragraph out natively and reads which code point sits on which line, so a line
// the head gets wrong where the base's is right shows as a loss there and then. tools/words2-sum-probe.ts holds the head
// against the base only; this one adds the browser's own lines, font weights and styles, many sizes, and the inspected
// paragraph's reports of the three premises' gaps.
//
//   BWF_TREE_A=<base checkout> BWF_TREE_B=<head checkout> BWF_FONTS=<families.json> [BWF_VARIANTS=400:normal,700:italic]
//     [BWF_SIZES=16,28] [BWF_SHORT_SIZES=11,16] [BWF_ROTATE=0] [BWF_SHORT_ROTATE=0] [BWF_PARTS=long,short,inspect]
//     [BWF_STYLES=yes] [BWF_INSPECT_STYLES=yes] [BWF_INSPECT_SIZES=all|first|<sizes>] [BWF_CALIBRATE=<every n-th equal layout>]
//     [BWF_ROTATE_FIRST=no] [BWF_STYLE_SET=words2|spacing] [BWF_STYLE_SIZES=first|all] [BWF_TEXTS=<names>] bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/bwf-fonts-probe.ts \
//     --out=<dir> --probe-timeout-ms=20000000 --stall-ms=20000000 [--chrome-args=--force-device-scale-factor=1]
//     (a Chrome slot of the browser lock; counts, no times)
//
// Per family that resolves and per font variant (weight and style) whose widths differ from every earlier variant's (a
// variant Chrome maps to a face already asked is skipped):
// - `long`: every text at its sizes (all of BWF_SIZES, or BWF_ROTATE of them turning with the variant and text), each
//   paragraph with a list of contexts of its own, laid out at 61.7, 143, 250.5 and 411 px (scaled with the size above 20
//   px) and at the own widths of the first six lines at the second and third width, one LayoutUnit to either side. The
//   first variant also lays the styled texts out under the words2 probe's nine styles at the first size.
// - `short`: every text cut into paragraphs of 2, 3, 5 and 8 words, one list of contexts a family and tree, at 40.3 and 88
//   px and the own widths of the first two lines; and per group the head's total against Canvas's exact total.
// - `inspect`: the head's inspected paragraph of every long plain paragraph at the ordinary widths: its lines against the
//   plain paragraph's, and every report of context-past-a-word, positions-run-backwards and nested-window-wider.
// Scored per differing layout: each code point that has a rect, on the native line against each tree's line, and the
// line count. A loss is a layout the base lays out as Chrome does and the head doesn't.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { TEXTS as WORDS2_TEXTS } from './words2-sum-probe.ts'

export const ENTRY = (tree: string, name: string): string => `
import { createContextPool, detectEnvironment, fillLine, firstLine, prepare, inspectLine, paragraphGaps } from '${tree}/rebuild/src/index.ts'
import { UNKNOWN_FONT_FACTS } from '${tree}/rebuild/src/model.ts'
import * as shape from '${tree}/rebuild/src/engines/blink/shape.ts'

function environment() {
  const detected = detectEnvironment({ engine: 'blink', build: null, contentLanguage: null, uiLanguage: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

function paragraphOf(family, size, weight, fontStyle, text, lang, rtl, style) {
  const font = { family, size, weight, style: fontStyle, facts: UNKNOWN_FONT_FACTS }
  const inherited = { letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing, whiteSpace: style.whiteSpace, wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, font }
  let content = [{ kind: 'text', text }]
  if (style.spanEvery > 0) {
    content = []
    const edge = { margin: 0, border: 0, padding: style.spanPadding }
    const words = text.split(' ')
    let plain = ''
    let spans = 0
    for (let w = 0; w < words.length; w++) {
      const lead = w === 0 ? '' : ' '
      if (w % style.spanEvery !== style.spanEvery - 1 || words[w].length === 0) { plain += lead + words[w]; continue }
      const inside = spans++ % 2 === 1
      if (!inside) plain += lead
      if (plain.length > 0) content.push({ kind: 'text', text: plain })
      plain = ''
      content.push({ ...inherited, kind: 'span', lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: (inside ? lead : '') + words[w] }] })
    }
    if (plain.length > 0) content.push({ kind: 'text', text: plain })
  }
  return { ...inherited, content, lineHeight: size * 2, direction: rtl !== style.flip ? 'rtl' : 'ltr', lang, textIndent: style.textIndent, textAlign: style.textAlign }
}

function lines(prepared, width) {
  const out = []
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'line') out.push([filled.start, filled.end, filled.hasLineBox, filled.line.info.width, filled.line.info.hasOverflow])
    start = filled.next
  }
  return out
}

// The lines of an inspected paragraph and the names of the premises' gaps it reports, with where.
const PREMISES = ['context-past-a-word', 'positions-run-backwards', 'nested-window-wider']
function inspectedLines(prepared, width, found) {
  const out = []
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'line') {
      out.push([filled.start, filled.end, filled.hasLineBox, filled.line.info.width, filled.line.info.hasOverflow])
      const gaps = inspectLine(prepared, filled.line).gaps ?? []
      for (let i = 0; i < gaps.length; i++) if (PREMISES.includes(gaps[i].gap)) found.push({ gap: gaps[i].gap, at: gaps[i].at ?? null, detail: gaps[i].detail, width })
    }
    start = filled.next
  }
  return out
}
function premiseGaps(prepared) {
  const out = []
  const gaps = paragraphGaps(prepared)
  for (let i = 0; i < gaps.length; i++) if (PREMISES.includes(gaps[i].gap)) out.push({ gap: gaps[i].gap, at: gaps[i].at ?? null, detail: gaps[i].detail, width: null })
  return out
}

function groupsOf(prepared) {
  const p = prepared.state
  const groups = []
  for (let g = 0; g < p.groups.length; g++) groups.push({ start: p.groups[g].start, end: p.groups[g].end, cuts: p.groups[g].cuts, prefix: p.groups[g].prefixAtCut })
  return { text: p.text, groups }
}

const shaper = prepared => ({ p: prepared.state, gaps: null })

globalThis.${name} = {
  environment, paragraphOf, lines, inspectedLines, premiseGaps, groupsOf, createContextPool,
  prepare: (paragraph, env, contexts) => prepare(paragraph, env, false, contexts),
  prepareInspected: (paragraph, env, contexts) => prepare(paragraph, env, true, contexts),
  measure16: (prepared, g, from, to) => shape.measure16(shaper(prepared), g, from, to, prepared.state.groups[g].start, prepared.state.groups[g].end),
  position16: (prepared, g, k) => shape.groupPrefix16(shaper(prepared), g, k),
  pair16: (prepared, g, k) => shape.pairAdjust16(shaper(prepared), g, k, prepared.state.groups[g].start, prepared.state.groups[g].end),
  wide16: (prepared, g, k) => shape.adjust16(shaper(prepared), g, k, prepared.state.groups[g].start, prepared.state.groups[g].end),
}
`

// The native layout of a paragraph in the page, and a tree's lines scored against it (shared with tools/bwf-detail-probe.ts).
export const NATIVE = String.raw`
// ---- The native layout ----
const host = document.createElement('div');
host.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px;overflow:visible;';
document.body.append(host);
const range = document.createRange();

// Per code point with a rect of its own, its native line (by the rect's middle over the line height), and the count.
function nativeLayout(paragraph, width) {
  const element = document.createElement('div');
  const s = element.style;
  s.position = 'absolute'; s.left = '0'; s.top = '0'; s.margin = '0'; s.padding = '0'; s.border = '0'; s.boxSizing = 'content-box';
  s.width = width + 'px';
  const f = paragraph.font;
  s.fontFamily = f.family; s.fontSize = f.size + 'px'; s.fontWeight = String(f.weight); s.fontStyle = f.style;
  s.letterSpacing = paragraph.letterSpacing + 'px'; s.wordSpacing = paragraph.wordSpacing + 'px'; s.lineHeight = paragraph.lineHeight + 'px';
  s.textAlign = paragraph.textAlign; s.textIndent = paragraph.textIndent + 'px'; s.textTransform = 'none'; s.hyphens = 'manual';
  s.setProperty('white-space', paragraph.whiteSpace); s.setProperty('word-break', paragraph.wordBreak); s.setProperty('overflow-wrap', paragraph.overflowWrap);
  s.setProperty('line-break', paragraph.lineBreak); s.setProperty('tab-size', String(paragraph.tabSize)); s.setProperty('direction', paragraph.direction);
  element.lang = paragraph.lang;
  const nodes = [];
  const append = (parent, list) => {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      if (node.kind === 'text') { const t = document.createTextNode(node.text); nodes.push(t); parent.append(t); continue; }
      const span = document.createElement('span');
      const ss = span.style;
      ss.fontFamily = node.font.family; ss.fontSize = node.font.size + 'px'; ss.fontWeight = String(node.font.weight); ss.fontStyle = node.font.style;
      ss.letterSpacing = node.letterSpacing + 'px'; ss.wordSpacing = node.wordSpacing + 'px';
      ss.paddingInlineStart = node.inlineStart.padding + 'px'; ss.paddingInlineEnd = node.inlineEnd.padding + 'px';
      append(span, node.children);
      parent.append(span);
    }
  };
  append(element, paragraph.content);
  host.append(element);
  try {
    const origin = element.getBoundingClientRect();
    const lineOf = [];
    let base = 0;
    for (let n = 0; n < nodes.length; n++) {
      const text = nodes[n].data;
      for (let i = 0; i < text.length;) {
        const length = text.codePointAt(i) > 0xffff ? 2 : 1;
        range.setStart(nodes[n], i); range.setEnd(nodes[n], i + length);
        const rects = range.getClientRects();
        let line = -1;
        // The last rect with an area: a range that starts a wrapped line also reports an empty rect at the previous line's
        // end, and the character after a soft hyphen taken as a break also reports the hyphen's rect there; a character
        // without a rect of its own (a mark, an ignorable, a collapsed space) says nothing of a break.
        for (let r = rects.length - 1; r >= 0; r--) {
          const rect = rects[r];
          if (rect.height <= 0 || rect.width <= 0) continue;
          line = Math.floor((rect.top - origin.top + rect.height / 2) / paragraph.lineHeight);
          break;
        }
        lineOf.push([base + i, line, text.slice(i, i + length)]);
        i += length;
      }
      base += text.length;
    }
    return { lineOf, count: Math.round(origin.height / paragraph.lineHeight) };
  } finally {
    element.remove();
  }
}

// Whether a tree's lines put every code point that has a rect on its native line, and give the native count.
function scoreLines(treeLines, native) {
  const starts = [], index = [];
  let boxes = 0;
  for (let l = 0; l < treeLines.length; l++) { starts.push(treeLines[l][0]); index.push(boxes); if (treeLines[l][2]) boxes++; }
  let wrong = null;
  for (let c = 0, l = 0; c < native.lineOf.length; c++) {
    const [offset, line, text] = native.lineOf[c];
    if (line < 0) continue;
    while (l + 1 < treeLines.length && treeLines[l + 1][0] <= offset) l++;
    if (index[l] !== line) { wrong = { offset, text, native: line, tree: index[l] }; break; }
  }
  return { breaks: wrong === null, count: boxes === native.count, boxes, first: wrong };
}

`

const BODY = String.raw`
const A = globalThis.bwfA, B = globalThis.bwfB;
const envA = A.environment(), envB = B.environment();
const zoom = window.devicePixelRatio;
const EXACT16 = 0x1000000;
const probeContext = new OffscreenCanvas(1, 1).getContext('2d');
const measured = (font, text) => { probeContext.font = font; return probeContext.measureText(text).width; };
const SAMPLE = 'mmmmmmmmmmlliWAVA fi 123';
const resolves = (family) => measured('72px ' + family + ', monospace', SAMPLE) !== measured('72px monospace', SAMPLE) || measured('72px ' + family + ', serif', SAMPLE) !== measured('72px serif', SAMPLE);
// What tells two faces apart: widths of every text's opening, so a variant that maps to a face already asked is skipped.
const FINGERPRINT = TEXTS.map(given => given.text.slice(0, 60)).concat([SAMPLE, 'AVAWAY To Ty ff fi fl ffi 0123456789']);
const fingerprint = (css) => FINGERPRINT.map(text => measured(css, text)).join(',');
const PLAIN = { name: 'plain', letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', textAlign: 'start', textIndent: 0, flip: false, spanEvery: 0, spanPadding: 0 };
const STYLES = [
  { ...PLAIN, name: 'letter-spacing', letterSpacing: 1.5 },
  { ...PLAIN, name: 'word-spacing', wordSpacing: 4 },
  { ...PLAIN, name: 'negative-word-spacing', wordSpacing: -2 },
  { ...PLAIN, name: 'pre-wrap', whiteSpace: 'pre-wrap' },
  { ...PLAIN, name: 'break-spaces', whiteSpace: 'break-spaces' },
  { ...PLAIN, name: 'justify-indent', textAlign: 'justify', textIndent: 17.5 },
  { ...PLAIN, name: 'other-direction', flip: true },
  { ...PLAIN, name: 'spans', spanEvery: 3 },
  { ...PLAIN, name: 'padded-spans', spanEvery: 2, spanPadding: 3 },
];
// BWF_STYLE_SET=spacing: letter and word spacing of both signs and a few sizes each, where the windows' 256 zoomed px bound
// moves with the spacing JS adds to Canvas's totals.
const SPACING = [];
const LETTER = [-1, -0.5, 0.25, 0.5, 1, 2, 3], WORD = [-3, -1, -0.5, 0.5, 1, 2, 8];
for (let i = 0; i < LETTER.length; i++) SPACING.push({ ...PLAIN, name: 'ls' + LETTER[i], letterSpacing: LETTER[i] });
for (let i = 0; i < WORD.length; i++) SPACING.push({ ...PLAIN, name: 'ws' + WORD[i], wordSpacing: WORD[i] });
SPACING.push({ ...PLAIN, name: 'ls1ws-2', letterSpacing: 1, wordSpacing: -2 }, { ...PLAIN, name: 'ls-0.5ws3', letterSpacing: -0.5, wordSpacing: 3 });
const STYLE_LIST = STYLE_SET === 'spacing' ? SPACING : STYLES;
const ORDINARY = [61.7, 143, 250.5, 411];
const SHORT_WIDTHS = [40.3, 88];
const CHUNKS = [2, 3, 5, 8];
const out = [];
const bump = (tally, key, by) => { tally[key] = (tally[key] ?? 0) + by; };
let calibrateTurn = 0;

${NATIVE}
for (let f = 0; f < FONTS.length; f++) {
  const family = FONTS[f].startsWith('!') ? FONTS[f].slice(1) : '"' + FONTS[f] + '"';
  if (!resolves(family)) { out.push({ family: FONTS[f], resolves: false }); continue; }
  const row = {
    family: FONTS[f], resolves: true, variants: [], skippedVariants: [],
    long: { paragraphs: 0, layouts: 0, lines: 0, differ: 0, errors: 0 },
    short: { paragraphs: 0, groups: 0, exactGroups: 0, headOffCanvas: 0, baseOffCanvas: 0, layouts: 0, lines: 0, differ: 0, errors: 0 },
    inspect: { paragraphs: 0, layouts: 0, plainDiffers: 0, errors: 0, gaps: {}, gapParagraphs: {} },
    scored: { layouts: 0, breaksLoss: 0, breaksGain: 0, breaksBothWrong: 0, breaksBothRight: 0, countLoss: 0, countGain: 0, countBothWrong: 0 },
    calibrate: { layouts: 0, breaks: 0, count: 0 }, calibrateMisses: [],
    byKey: {}, losses: [], gains: [], examples: [], gapExamples: [],
  };
  const kept = {};
  const example = (kind, e) => { kept[kind] = (kept[kind] ?? 0) + 1; if (kept[kind] <= 4) row.examples.push({ kind, ...e }); };
  const error = (part, e) => { part.errors++; example('error', e); };

  const judge = (paragraph, width, la, lb, where) => {
    let native;
    try { native = nativeLayout(paragraph, width); } catch (e) { example('native-error', { ...where, width, error: String(e).slice(0, 240) }); return; }
    const sa = scoreLines(la, native), sb = scoreLines(lb, native);
    const t = row.scored;
    t.layouts++;
    const key = where.part + '/' + where.text + '/' + where.style + '/' + where.variant;
    if (sa.breaks && !sb.breaks) { t.breaksLoss++; bump(row.byKey, 'loss:' + key, 1); if (row.losses.length < 60) row.losses.push({ ...where, width, native: native.count, base: sa, head: sb, headLines: lb.slice(0, 40), baseLines: la.slice(0, 40) }); }
    else if (!sa.breaks && sb.breaks) { t.breaksGain++; bump(row.byKey, 'gain:' + key, 1); if (row.gains.length < 12) row.gains.push({ ...where, width, native: native.count, base: sa, head: sb }); }
    else if (!sa.breaks) t.breaksBothWrong++;
    else t.breaksBothRight++;
    if (sa.count && !sb.count) t.countLoss++;
    else if (!sa.count && sb.count) t.countGain++;
    else if (!sa.count) t.countBothWrong++;
  };

  const compareLines = (part, paragraphA, a, b, widths, from, own, where) => {
    const seen = new Set(widths);
    for (let w = 0; w < widths.length; w++) {
      const width = widths[w];
      let la, lb;
      try { la = A.lines(a, width); lb = B.lines(b, width); } catch (e) { error(part, { ...where, width, error: String(e).slice(0, 240) }); continue; }
      part.layouts++;
      part.lines += lb.length;
      if (JSON.stringify(la) !== JSON.stringify(lb)) {
        part.differ++;
        bump(row.byKey, 'differ:' + where.part + '/' + where.text + '/' + where.style + '/' + where.variant, 1);
        judge(paragraphA, width, la, lb, where);
      } else if (CALIBRATE > 0 && (calibrateTurn++ % CALIBRATE) === 0) {
        // The oracle on layouts the trees agree on: how often both match Chrome.
        try {
          const sc = scoreLines(la, nativeLayout(paragraphA, width));
          row.calibrate.layouts++;
          if (sc.breaks) row.calibrate.breaks++;
          if (sc.count) row.calibrate.count++;
          if ((!sc.breaks || !sc.count) && row.calibrateMisses.length < 8) row.calibrateMisses.push({ ...where, width, score: sc });
        } catch (e) { example('native-error', { ...where, width, error: String(e).slice(0, 240) }); }
      }
      if (from.includes(w)) for (let l = 0; l < lb.length && l < own; l++) for (let d = -1; d <= 1; d++) {
        const at = (lb[l][3] + d) / 64 / zoom;
        if (at > 0 && !seen.has(at)) { seen.add(at); widths.push(at); }
      }
    }
  };

  // The variants Chrome maps to faces of their own.
  const prints = new Map();
  const variants = [];
  for (let v = 0; v < VARIANTS.length; v++) {
    const [weight, fontStyle] = VARIANTS[v];
    const print = fingerprint(fontStyle + ' ' + weight + ' 72px ' + family);
    if (prints.has(print)) { row.skippedVariants.push(weight + ':' + fontStyle + '=' + prints.get(print)); continue; }
    prints.set(print, weight + ':' + fontStyle);
    variants.push([weight, fontStyle, v]);
    row.variants.push(weight + ':' + fontStyle);
  }
  const pick = (list, count, turn) => { if (count <= 0 || count >= list.length) return list; const got = []; for (let i = 0; i < count; i++) got.push(list[(turn + i * Math.max(1, Math.floor(list.length / count))) % list.length]); return Array.from(new Set(got)); };

  for (let vi = 0; vi < variants.length; vi++) {
    const [weight, fontStyle, vIndex] = variants[vi];
    const variant = weight + ':' + fontStyle;
    // ---- long ----
    for (let t = 0; t < TEXTS.length && PARTS.includes('long'); t++) {
      const given = TEXTS[t];
      const sizes = vi === 0 && ROTATE_FIRST_ALL ? SIZES : pick(SIZES, ROTATE, vIndex * 7 + given.index);
      const styles = [PLAIN];
      if (STYLED && vi === 0 && (given.styled || STYLE_SET === 'spacing')) for (let s = 0; s < STYLE_LIST.length; s++) styles.push(STYLE_LIST[s]);
      for (let s = 0; s < styles.length; s++) for (let z = 0; z < sizes.length; z++) {
        if (s > 0 && z > 0 && !STYLE_ALL_SIZES) continue;
        const size = sizes[z], style = styles[s];
        const where = { part: 'long', text: given.name, style: style.name, size, variant };
        let a, b, paragraphA;
        try {
          paragraphA = A.paragraphOf(family, size, weight, fontStyle, given.text, given.lang, given.rtl, style);
          a = A.prepare(paragraphA, envA, A.createContextPool());
          b = B.prepare(B.paragraphOf(family, size, weight, fontStyle, given.text, given.lang, given.rtl, style), envB, B.createContextPool());
        } catch (e) { error(row.long, { ...where, error: String(e).slice(0, 240) }); continue; }
        row.long.paragraphs++;
        const scale = size > 20 ? size / 16 : 1;
        const ordinary = ORDINARY.map(w => w * scale);
        compareLines(row.long, paragraphA, a, b, ordinary.slice(), [1, 2], 6, where);
        if (PARTS.includes('inspect') && (s === 0 || INSPECT_STYLES) && (INSPECT_SIZES === null || (INSPECT_SIZES === 'first' ? z === 0 : INSPECT_SIZES.includes(size)))) {
          try {
            const bi = B.prepareInspected(B.paragraphOf(family, size, weight, fontStyle, given.text, given.lang, given.rtl, style), envB, B.createContextPool());
            row.inspect.paragraphs++;
            const found = B.premiseGaps(bi);
            for (let w = 0; w < ordinary.length; w++) {
              const li = B.inspectedLines(bi, ordinary[w], found);
              row.inspect.layouts++;
              if (JSON.stringify(li) !== JSON.stringify(B.lines(b, ordinary[w]))) { row.inspect.plainDiffers++; example('inspected-differs', { ...where, width: ordinary[w] }); }
            }
            const names = new Set();
            for (let i = 0; i < found.length; i++) {
              names.add(found[i].gap);
              bump(row.inspect.gaps, found[i].gap, 1);
              if (row.gapExamples.length < 40) {
                const at = found[i].at;
                row.gapExamples.push({ ...where, gap: found[i].gap, width: found[i].width, at, around: at === null ? null : given.text.slice(Math.max(0, at.start - 16), at.end + 16) });
              }
            }
            for (const name of names) bump(row.inspect.gapParagraphs, name + ':' + given.name + '/' + style.name + '/' + variant, 1);
          } catch (e) { error(row.inspect, { ...where, error: String(e).slice(0, 240) }); }
        }
      }
    }
    // ---- short ----
    if (PARTS.includes('short')) {
      const sharedA = A.createContextPool(), sharedB = B.createContextPool();
      const made = new Set();
      for (let t = 0; t < TEXTS.length; t++) {
        const given = TEXTS[t];
        const sizes = vi === 0 && ROTATE_FIRST_ALL ? SHORT_SIZES : pick(SHORT_SIZES, SHORT_ROTATE, vIndex * 5 + given.index);
        const words = given.text.split(' ').filter(word => word.length > 0);
        for (let z = 0; z < sizes.length; z++) for (let c = 0; c < CHUNKS.length; c++) for (let from = 0; from + 2 <= words.length; from += CHUNKS[c]) {
          const size = sizes[z];
          const text = words.slice(from, from + CHUNKS[c]).join(' ');
          const key = size + ' ' + given.lang + ' ' + text;
          if (made.has(key)) continue;
          made.add(key);
          const where = { part: 'short', text: given.name, style: 'plain', size, variant, paragraph: text };
          let a, b, paragraphA;
          try {
            paragraphA = A.paragraphOf(family, size, weight, fontStyle, text, given.lang, given.rtl, PLAIN);
            a = A.prepare(paragraphA, envA, sharedA);
            b = B.prepare(B.paragraphOf(family, size, weight, fontStyle, text, given.lang, given.rtl, PLAIN), envB, sharedB);
          } catch (e) { error(row.short, { ...where, error: String(e).slice(0, 240) }); continue; }
          row.short.paragraphs++;
          const ga = A.groupsOf(a), gb = B.groupsOf(b);
          for (let g = 0; g < gb.groups.length; g++) {
            const group = gb.groups[g];
            row.short.groups++;
            const head = group.prefix[group.cuts.length - 1], base = ga.groups[g].prefix[ga.groups[g].cuts.length - 1];
            const whole = B.measure16(b, g, group.start, group.end);
            if (whole >= EXACT16) continue;
            row.short.exactGroups++;
            if (base !== whole) row.short.baseOffCanvas++;
            if (head !== whole) {
              row.short.headOffCanvas++;
              bump(row.byKey, 'short-total:' + given.name + '/' + variant, 1);
              example('short-total', { ...where, group: g, groupText: gb.text.slice(group.start, group.end), whole16: whole, head16: head, base16: base, headCuts: group.cuts });
            }
          }
          compareLines(row.short, paragraphA, a, b, SHORT_WIDTHS.slice(), [1], 2, where);
        }
      }
    }
  }
  out.push(row);
  if (f % 2 === 1) await new Promise(resolve => setTimeout(resolve, 0));
}
host.remove();
return { userAgent: navigator.userAgent, devicePixelRatio: zoom, parts: PARTS, styled: STYLED, texts: TEXTS.map(given => given.name), sizes: SIZES, shortSizes: SHORT_SIZES, variants: VARIANTS, rotate: ROTATE, shortRotate: SHORT_ROTATE, fonts: out };
`

const ch = (...codes: number[]): string => String.fromCodePoint(...codes)
const ZWJ_FAMILY = ch(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466)
const RAINBOW = ch(0x1f3f3, 0xfe0f, 0x200d, 0x1f308)

// Texts of this attack beside the words2 probe's: long runs without spaces (CJK, Myanmar with its marks, ZWJ emoji mixed
// with letters, whose share of a range by UTF-16 length is far from its share by width, which the cut predictor's
// estimates rest on), Korean with spaces, and a chat line heavy with emoji words.
const OWN_TEXTS: Array<{ name: string; lang: string; rtl: boolean; styled: boolean; text: string }> = [
  { name: 'zh-long', lang: 'zh-CN', rtl: false, styled: false, text: '这是一个用于测试的中文段落，其中没有空格。浏览器会在汉字之间断行，标点符号遵循避头尾的规则，例如句号和逗号不能出现在行首。我们希望预测的每一行都与浏览器自己的结果一致，包括全角标点、数字１２３和English单词混排的情况，以及“引号”、（括号）和《书名号》旁边的断行位置。段落足够长，让每个分组都超过两百五十六个缩放像素，这样切分搜索和预测都会被用到。' },
  { name: 'ja-long', lang: 'ja', rtl: false, styled: false, text: '日本語の文章は単語の間に空白を入れません。そのため、ブラウザは文字と文字の間で改行します。句読点や括弧の扱いにも規則があり、「かぎ括弧」の直後や行頭の「。」は避けられます。カタカナ語のコンピューターやひらがなが混ざった長い段落でも、正しく折り返されるかどうかを確かめるための文章です。' },
  { name: 'ko', lang: 'ko', rtl: false, styled: true, text: '한국어 문장은 단어 사이에 공백을 넣습니다. 브라우저는 공백에서 줄을 바꾸고, 아주 긴 단어는 글자 사이에서 나눌 수도 있습니다. 이 문단은 여러 줄에 걸쳐 표시되도록 충분히 길게 작성되었고, 숫자 2026년과 English 단어, 그리고 (괄호)와 "따옴표"도 섞여 있습니다.' },
  { name: 'myanmar', lang: 'my', rtl: false, styled: false, text: 'မြန်မာစာသည်စကားလုံးများကြားတွင်နေရာလွတ်မထည့်ဘဲရေးသားလေ့ရှိသည်။ ဤစာပိုဒ်သည်ဘရောက်ဇာ၏စာကြောင်းခွဲပုံကိုစမ်းသပ်ရန်အတွက်ဖြစ်ပြီးအက္ခရာနှင့်သင်္ကေတများစွာပါဝင်သည်။ ကွန်ပျူတာစနစ်များတွင်မြန်မာဘာသာကိုမှန်ကန်စွာပြသနိုင်ရန်အရေးကြီးသည်။' },
  { name: 'emoji-run', lang: 'en', rtl: false, styled: false, text: `${ZWJ_FAMILY}${ZWJ_FAMILY}${ZWJ_FAMILY}${ZWJ_FAMILY}abcdefghijklmnopqrstuvwxyzabcdefghij${RAINBOW}${RAINBOW}${RAINBOW}klmnopqrstu ${ZWJ_FAMILY}${ZWJ_FAMILY}${ZWJ_FAMILY}${ZWJ_FAMILY}${ZWJ_FAMILY}${ZWJ_FAMILY}${ZWJ_FAMILY}${ZWJ_FAMILY} ok ${ch(0x1f44d, 0x1f3fd)}${ch(0x1f44d, 0x1f3fd)}${ch(0x1f44d, 0x1f3fd)}${ch(0x1f44d, 0x1f3fd)}superlongwordwithoutanyspacesatallthatkeepsgoing${ZWJ_FAMILY}end fin` },
  { name: 'emoji-chat', lang: 'en', rtl: false, styled: true, text: `omg ${ch(0x1f602)}${ch(0x1f602)} that's hilarious ${ch(0x1f923)} did u see ${ZWJ_FAMILY} pics? ${ch(0x2764, 0xfe0f)} so cute!! ${ch(0x1f60d)} anyway ${ch(0x1f44b, 0x1f3fb)} gotta go ${ch(0x1f3c3, 0x200d, 0x2640, 0xfe0f)} ttyl ${ch(0x270c, 0xfe0f)} ${RAINBOW} pride ${ch(0x1f1fa, 0x1f1f8)} ${ch(0x1f1ec, 0x1f1e7)} flags ${ch(0x1f525)}${ch(0x1f525)}${ch(0x1f525)} lit` },
]

export const TEXTS = [...WORDS2_TEXTS, ...OWN_TEXTS]

const numbers = (raw: string | undefined, fallback: number[]): number[] => raw === undefined ? fallback : raw.split(',').map(Number)

export default async function bwfFontsProbes(): Promise<Probe[]> {
  const treeA = process.env['BWF_TREE_A']
  const treeB = process.env['BWF_TREE_B']
  const fontsPath = process.env['BWF_FONTS']
  if (treeA === undefined || treeB === undefined || fontsPath === undefined) throw new Error('BWF_TREE_A, BWF_TREE_B and BWF_FONTS name the two checkouts and the families file')
  const parts = (process.env['BWF_PARTS'] ?? 'long,short,inspect').split(',')
  const variants = (process.env['BWF_VARIANTS'] ?? '400:normal').split(',').map(v => { const [w, s] = v.split(':'); return [Number(w), s ?? 'normal'] })
  const names = process.env['BWF_TEXTS']?.split(',') ?? null
  // Each text keeps its index in the whole list, which turns the sizes a rotating run gives it, so a run of some texts
  // lays out what the whole run lays out for them.
  const texts = TEXTS.map((given, index) => ({ ...given, index })).filter(given => names === null || names.includes(given.name))
  const dir = mkdtempSync(join(tmpdir(), 'bwf-fonts-probe-'))
  const bundles: string[] = []
  const sides: Array<[string, string]> = [[resolve(treeA), 'bwfA'], [resolve(treeB), 'bwfB']]
  for (let i = 0; i < sides.length; i++) {
    const entry = join(dir, `${sides[i]![1]}.ts`)
    writeFileSync(entry, ENTRY(sides[i]![0], sides[i]![1]))
    const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
    bundles.push(await built.outputs[0]!.text())
  }
  const constants = [
    `const FONTS = ${readFileSync(resolve(fontsPath), 'utf8')};`,
    `const TEXTS = ${JSON.stringify(texts)};`,
    `const SIZES = ${JSON.stringify(numbers(process.env['BWF_SIZES'], [16, 28]))};`,
    `const SHORT_SIZES = ${JSON.stringify(numbers(process.env['BWF_SHORT_SIZES'], [11, 16]))};`,
    `const VARIANTS = ${JSON.stringify(variants)};`,
    `const ROTATE = ${Number(process.env['BWF_ROTATE'] ?? 0)};`,
    `const SHORT_ROTATE = ${Number(process.env['BWF_SHORT_ROTATE'] ?? 0)};`,
    `const ROTATE_FIRST_ALL = ${process.env['BWF_ROTATE_FIRST'] !== 'yes'};`,
    `const PARTS = ${JSON.stringify(parts)};`,
    `const STYLED = ${process.env['BWF_STYLES'] !== 'no'};`,
    `const INSPECT_STYLES = ${process.env['BWF_INSPECT_STYLES'] !== 'no'};`,
    `const CALIBRATE = ${Number(process.env['BWF_CALIBRATE'] ?? 0)};`,
    `const INSPECT_SIZES = ${JSON.stringify(process.env['BWF_INSPECT_SIZES'] === undefined || process.env['BWF_INSPECT_SIZES'] === 'all' ? null : process.env['BWF_INSPECT_SIZES'] === 'first' ? 'first' : numbers(process.env['BWF_INSPECT_SIZES'], []))};`,
    `const STYLE_SET = ${JSON.stringify(process.env['BWF_STYLE_SET'] ?? 'words2')};`,
    `const STYLE_ALL_SIZES = ${process.env['BWF_STYLE_SIZES'] === 'all'};`,
  ].join('\n')
  return [{
    id: 'bwf-fonts F1', spec: 'words first and the cut predictor in Blink\'s port against the base on the machine\'s font families, weights, styles and sizes, with Chrome\'s own lines where the two differ', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundles[0]!}\n${bundles[1]!}\n${constants}\n${BODY}` }],
  }]
}
