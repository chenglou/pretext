// The second check of the words-first recipe of Blink's port (shape.ts addWordPieces), on real fonts: is a sum of words
// what Canvas itself measures, where Canvas's total is exact? The owner's probe (tools/cut-fonts-probe.ts) holds the head
// against the base. Where a group is below 256 zoomed px the base measures it whole, so there the base is Canvas's own
// exact total and the head is a sum of many words: a difference is the head's alone. This probe asks that, and the same
// of every run of consecutive pieces inside a long group, with texts and widths of its own.
//
//   SUM_TREE_A=<base checkout> SUM_TREE_B=<head checkout> SUM_FONTS=<families.json> [SUM_PARTS=long,short,windows] \
//     [SUM_STYLES=no] bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/words2-sum-probe.ts \
//     --out=<dir> --probe-timeout-ms=6000000 --stall-ms=6000000 [--chrome-args=--force-device-scale-factor=1]
//     (a Chrome slot of the browser lock; counts, no times)
//
// Three parts, per family that resolves.
// - `short`: every text cut into paragraphs of 2, 3, 5 and 8 words, at 11 and 16 px, prepared by both trees with one list
//   of contexts a family and tree (a page's way). Per group: the head's last position and the base's against W(group)
//   asked once more, counted where that total is exact (below 256 zoomed px); then both trees' lines at two widths and at
//   the first lines' own widths and one LayoutUnit to either side.
// - `windows`: in every paragraph of the long texts, for the head alone: W(cuts[i], cuts[j]) against the pieces between
//   the two cuts plus the adjustments at the cuts inside (what the positions say the range measures), for every two
//   pieces, every three, and the widest run of four or more that stays exact. Two pieces is the recipe's own test, so it
//   is the control; three and more is what the recipe doesn't ask. A window whose first or last piece holds no script of
//   its own is tallied apart, since measured alone its edge resolves otherwise than in the paragraph (script-context).
// - `long`: both trees' cuts, the positions at every inner cut of either tree and at the space before it, and lines at
//   61.7, 143, 250.5 and 411 px and at the own widths of the first six lines at 143 and 250.5 px with one LayoutUnit to
//   either side. With SUM_STYLES (the default) eight of the texts are also laid out under letter spacing, word spacing of
//   both signs, pre-wrap, break-spaces, justification with a text indent, the other direction, and with words in spans
//   that start at or before a space, with and without padding.
// Every family also lists up to 400 of its differing layouts (`differing`: part, text, style, size, width and, for a short
// paragraph, its text), which tools/words2-sum-cases.ts turns into lab cases for the browser to judge.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { TEXTS as CUT_TEXTS } from './cut-fonts-probe.ts'

const ENTRY = (tree: string, name: string): string => `
import { createContextPool, detectEnvironment, fillLine, firstLine, prepare } from '${tree}/rebuild/src/index.ts'
import { UNKNOWN_FONT_FACTS } from '${tree}/rebuild/src/model.ts'
import * as shape from '${tree}/rebuild/src/engines/blink/shape.ts'

function environment() {
  const detected = detectEnvironment({ engine: 'blink', build: null, contentLanguage: null, uiLanguage: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

// style: { letterSpacing, wordSpacing, whiteSpace, textAlign, textIndent, flip, spanEvery, spanPadding }. With spanEvery n
// every n-th word is a span of the same font; every other span takes the space before its word inside.
function paragraphOf(family, size, text, lang, rtl, style) {
  const font = { family, size, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
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

function groupsOf(prepared) {
  const p = prepared.state
  const groups = []
  for (let g = 0; g < p.groups.length; g++) groups.push({ start: p.groups[g].start, end: p.groups[g].end, cuts: p.groups[g].cuts, prefix: p.groups[g].prefixAtCut })
  return { text: p.text, groups }
}

const shaper = prepared => ({ p: prepared.state, gaps: null })

globalThis.${name} = {
  environment, paragraphOf, lines, groupsOf, createContextPool,
  prepare: (paragraph, env, contexts) => prepare(paragraph, env, false, contexts),
  position16: (prepared, g, k) => shape.groupPrefix16(shaper(prepared), g, k),
  measure16: (prepared, g, from, to) => shape.measure16(shaper(prepared), g, from, to, prepared.state.groups[g].start, prepared.state.groups[g].end),
}
`

const BODY = String.raw`
const A = globalThis.sumTreeA, B = globalThis.sumTreeB;
const envA = A.environment(), envB = B.environment();
const zoom = window.devicePixelRatio;
const EXACT16 = 0x1000000;
const probeContext = new OffscreenCanvas(1, 1).getContext('2d');
const measured = (font) => { probeContext.font = font; return probeContext.measureText('mmmmmmmmmmlliWAVA fi 123').width; };
const resolves = (family) => measured('72px ' + family + ', monospace') !== measured('72px monospace') || measured('72px ' + family + ', serif') !== measured('72px serif');
const neutral = /^[\p{Script=Common}\p{Script=Inherited}]*$/u;
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
const ORDINARY = [61.7, 143, 250.5, 411];
const SHORT_WIDTHS = [40.3, 88];
const CHUNKS = [2, 3, 5, 8];
const SHORT_SIZES = [11, 16];
const out = [];
const bump = (tally, key, by) => { tally[key] = (tally[key] ?? 0) + by; };
const TEXT_OF = (where, line) => line === undefined ? '' : (where.paragraph ?? TEXTS.find(given => given.name === where.text).text).slice(line[0], line[1]);

for (let f = 0; f < FONTS.length; f++) {
  const family = FONTS[f].startsWith('!') ? FONTS[f].slice(1) : '"' + FONTS[f] + '"';
  if (!resolves(family)) { out.push({ family: FONTS[f], resolves: false }); continue; }
  const row = {
    family: FONTS[f], resolves: true,
    long: { paragraphs: 0, groups: 0, headCuts: 0, baseCuts: 0, edges: 0, edgesDiffer: 0, totalsDiffer: 0, layouts: 0, lines: 0, differ: 0, errors: 0 },
    short: { paragraphs: 0, groups: 0, exactGroups: 0, headCuts: 0, headOffCanvas: 0, baseOffCanvas: 0, headOffBase: 0, largest16: 0, layouts: 0, lines: 0, differ: 0, errors: 0 },
    windows: { pairs: 0, pairsOff: 0, triples: 0, triplesOff: 0, wide: 0, wideOff: 0, offNeutralEdge: 0, largest16: 0, mostPieces: 0 },
    differByText: {}, examples: [], differing: [],
  };
  // A few examples of each kind.
  const kept = {};
  const example = (kind, e) => { kept[kind] = (kept[kind] ?? 0) + 1; if (kept[kind] <= 4) row.examples.push({ kind, ...e }); };
  const error = (part, e) => { part.errors++; example('error', e); };

  // Both trees' lines at a list of widths that grows with the own widths of the first few lines (own) at some of them (from).
  const compareLines = (part, a, b, widths, from, own, where) => {
    const seen = new Set(widths);
    for (let w = 0; w < widths.length; w++) {
      const width = widths[w];
      let la, lb;
      try { la = A.lines(a, width); lb = B.lines(b, width); } catch (e) { error(part, { ...where, width, error: String(e).slice(0, 240) }); continue; }
      part.layouts++;
      part.lines += lb.length;
      const ja = JSON.stringify(la), jb = JSON.stringify(lb);
      if (ja !== jb) {
        part.differ++;
        bump(row.differByText, where.text + '/' + where.style, 1);
        if (row.differing.length < 400) row.differing.push({ ...where, width });
        let l = 0;
        while (l < la.length && l < lb.length && JSON.stringify(la[l]) === JSON.stringify(lb[l])) l++;
        example('layout-' + where.part, { ...where, width, line: l, base: la[l], head: lb[l], lineText: TEXT_OF(where, lb[l]) });
      }
      if (from.includes(w)) for (let l = 0; l < lb.length && l < own; l++) for (let d = -1; d <= 1; d++) {
        const at = (lb[l][3] + d) / 64 / zoom;
        if (at > 0 && !seen.has(at)) { seen.add(at); widths.push(at); }
      }
    }
  };

  // ---- long ----
  for (let t = 0; t < TEXTS.length && (PARTS.includes('long') || PARTS.includes('windows')); t++) {
    const given = TEXTS[t];
    const styles = [PLAIN];
    if (STYLED && given.styled) for (let s = 0; s < STYLES.length; s++) styles.push(STYLES[s]);
    for (let s = 0; s < styles.length; s++) for (let z = 0; z < SIZES.length; z++) {
      if (s > 0 && z > 0) continue;
      const size = SIZES[z], style = styles[s];
      const where = { part: 'long', text: given.name, style: style.name, size };
      let a, b;
      try {
        a = A.prepare(A.paragraphOf(family, size, given.text, given.lang, given.rtl, style), envA, A.createContextPool());
        b = B.prepare(B.paragraphOf(family, size, given.text, given.lang, given.rtl, style), envB, B.createContextPool());
      } catch (e) { error(row.long, { ...where, error: String(e).slice(0, 240) }); continue; }
      row.long.paragraphs++;
      const ga = A.groupsOf(a), gb = B.groupsOf(b);
      if (PARTS.includes('long')) {
        for (let g = 0; g < gb.groups.length; g++) {
          const group = gb.groups[g], baseCuts = ga.groups[g].cuts;
          row.long.groups++;
          row.long.headCuts += group.cuts.length - 2;
          row.long.baseCuts += baseCuts.length - 2;
          if (ga.groups[g].prefix[baseCuts.length - 1] !== group.prefix[group.cuts.length - 1]) { row.long.totalsDiffer++; bump(row.differByText, 'total:' + given.name + '/' + style.name, 1); example('total', { ...where, group: g, baseTotal: ga.groups[g].prefix[baseCuts.length - 1], headTotal: group.prefix[group.cuts.length - 1] }); }
          const edges = new Set();
          for (let i = 1; i + 1 < baseCuts.length; i++) edges.add(baseCuts[i]);
          for (let i = 1; i + 1 < group.cuts.length; i++) edges.add(group.cuts[i]);
          for (const k of Array.from(edges)) if (gb.text.charCodeAt(k - 1) === 0x20) edges.add(k - 1);
          for (const k of edges) {
            let pa, pb;
            try { pa = A.position16(a, g, k); pb = B.position16(b, g, k); } catch (e) { error(row.long, { ...where, group: g, edge: k, error: String(e).slice(0, 240) }); continue; }
            row.long.edges++;
            if (pa !== pb) { row.long.edgesDiffer++; bump(row.differByText, 'edge:' + given.name + '/' + style.name, 1); example(Math.abs(pa - pb) < 64 ? 'edge-under-64-units' : 'edge', { ...where, group: g, edge: k, around: gb.text.slice(Math.max(0, k - 12), k) + '|' + gb.text.slice(k, k + 12), base16: pa, head16: pb }); }
          }
        }
        compareLines(row.long, a, b, ORDINARY.slice(), [1, 2], 6, where);
      }
      if (PARTS.includes('windows') && s === 0) {
        const tally = row.windows;
        for (let g = 0; g < gb.groups.length; g++) {
          const group = gb.groups[g], cuts = group.cuts, prefix = group.prefix, n = cuts.length - 1;
          if (n < 2) continue;
          const total = [], d = [0];
          for (let m = 0; m < n; m++) total.push(B.measure16(b, g, cuts[m], cuts[m + 1]));
          for (let m = 1; m < n; m++) d.push(prefix[m] - prefix[m - 1] - total[m - 1]);
          const expected = (i, j) => { let sum = 0; for (let m = i; m < j; m++) sum += total[m]; for (let m = i + 1; m < j; m++) sum += d[m]; return sum; };
          // Whether the window was exact, and so held.
          const hold = (i, j, kind) => {
            const sum = expected(i, j);
            if (sum >= EXACT16) return false;
            const whole = B.measure16(b, g, cuts[i], cuts[j]);
            if (whole >= EXACT16) return false;
            tally[kind]++;
            if (j - i > tally.mostPieces) tally.mostPieces = j - i;
            if (whole !== sum) {
              const neutralEdge = neutral.test(gb.text.slice(cuts[i], cuts[i + 1]).trim()) || neutral.test(gb.text.slice(cuts[j - 1], cuts[j]).trim());
              if (neutralEdge) tally.offNeutralEdge++; else tally[kind + 'Off']++;
              if (!neutralEdge && Math.abs(whole - sum) > tally.largest16) tally.largest16 = Math.abs(whole - sum);
              if (!neutralEdge) { bump(row.differByText, 'window:' + given.name, 1); example('window-' + kind, { part: 'windows', text: given.name, size, group: g, window: gb.text.slice(cuts[i], cuts[j]), pieces: j - i, whole16: whole, sum16: sum }); }
            }
            return true;
          };
          for (let i = 0; i + 2 <= n; i++) hold(i, i + 2, 'pairs');
          for (let i = 0; i + 3 <= n; i++) hold(i, i + 3, 'triples');
          for (let i = 0; i + 4 <= n; i += 2) {
            let j = i + 4;
            while (j < n && expected(i, j + 1) < EXACT16) j++;
            while (j >= i + 4 && !hold(i, j, 'wide')) j--;
          }
        }
      }
    }
  }

  // ---- short ----
  if (PARTS.includes('short')) {
    const sharedA = A.createContextPool(), sharedB = B.createContextPool();
    const made = new Set();
    for (let t = 0; t < TEXTS.length; t++) for (let z = 0; z < SHORT_SIZES.length; z++) {
      const given = TEXTS[t], size = SHORT_SIZES[z];
      const words = given.text.split(' ').filter(word => word.length > 0);
      for (let c = 0; c < CHUNKS.length; c++) for (let from = 0; from + 2 <= words.length; from += CHUNKS[c]) {
        const text = words.slice(from, from + CHUNKS[c]).join(' ');
        const key = size + ' ' + given.lang + ' ' + text;
        if (made.has(key)) continue;
        made.add(key);
        const where = { part: 'short', text: given.name, style: 'plain', size, paragraph: text };
        let a, b;
        try {
          a = A.prepare(A.paragraphOf(family, size, text, given.lang, given.rtl, PLAIN), envA, sharedA);
          b = B.prepare(B.paragraphOf(family, size, text, given.lang, given.rtl, PLAIN), envB, sharedB);
        } catch (e) { error(row.short, { ...where, error: String(e).slice(0, 240) }); continue; }
        row.short.paragraphs++;
        const ga = A.groupsOf(a), gb = B.groupsOf(b);
        for (let g = 0; g < gb.groups.length; g++) {
          const group = gb.groups[g];
          row.short.groups++;
          const head = group.prefix[group.cuts.length - 1], base = ga.groups[g].prefix[ga.groups[g].cuts.length - 1];
          if (head !== base) row.short.headOffBase++;
          const whole = B.measure16(b, g, group.start, group.end);
          if (whole >= EXACT16) continue;
          row.short.exactGroups++;
          row.short.headCuts += group.cuts.length - 2;
          if (base !== whole) row.short.baseOffCanvas++;
          if (head !== whole) {
            row.short.headOffCanvas++;
            if (Math.abs(head - whole) > row.short.largest16) row.short.largest16 = Math.abs(head - whole);
            bump(row.differByText, 'short-total:' + given.name, 1);
            // What the recipe asked and what it didn't: every piece, every two and every three next to each other.
            const asked = [];
            for (let n = 1; n <= 3; n++) for (let i = 0; i + n < group.cuts.length; i++) asked.push([gb.text.slice(group.cuts[i], group.cuts[i + n]), B.measure16(b, g, group.cuts[i], group.cuts[i + n])]);
            example('short-total', { ...where, group: g, groupText: gb.text.slice(group.start, group.end), whole16: whole, head16: head, base16: base, headCuts: group.cuts, headPrefix: group.prefix, asked });
          }
        }
        compareLines(row.short, a, b, SHORT_WIDTHS.slice(), [1], 2, where);
      }
    }
  }
  out.push(row);
  if (f % 2 === 1) await new Promise(resolve => setTimeout(resolve, 0));
}
return { userAgent: navigator.userAgent, devicePixelRatio: zoom, parts: PARTS, styled: STYLED, texts: TEXTS.length, sizes: SIZES, fonts: out };
`

const ch = (...codes: number[]): string => String.fromCodePoint(...codes)
const NBSP = ch(0xa0)
const IDEOGRAPHIC = ch(0x3000)
const ZWSP = ch(0x200b)
const WJ = ch(0x2060)

const SIZES = [16, 28]

// The second check's own texts, for what sits beside a space and what a test of two words can't see: words without a
// script of their own between words that have one, words of one letter, pairs that kern across a space, a chat message,
// emoji as words, marks and default-ignorable characters at a word's start and end, no-break and other spaces, preserved
// runs of spaces, Arabic, Hebrew, Urdu and Hindi around digits and punctuation, mixed direction, long words beside short
// ones, and the words a script font gives forms of their own.
const OWN_TEXTS: Array<{ name: string; lang: string; rtl: boolean; styled: boolean; text: string }> = [
  { name: 'neutral-words', lang: 'en', rtl: false, styled: true, text: `yes - no -- maybe ${ch(0x2014)} ok ${ch(0xb7)} fine ${ch(0x2022)} item | pipe / slash & and + plus = equals 1 2 3 4 5 6 7 8 9 10 11 12 ( a ) [ b ] { c } ${ch(0xab)} d ${ch(0xbb)} ${ch(0x201c)} e ${ch(0x201d)} ... !!! ??? :-) ;-) <3 -> => :: // ## ** ~~ __ a - b ${ch(0x2014)} c ${ch(0x2013)} d 3 x 4 = 12 , then . and ; or : so ! yes ? no` },
  { name: 'one-letter', lang: 'en', rtl: false, styled: false, text: 'a b c d e f g h i j k l m n o p q r s t u v w x y z A V A T o Y o W e T a P . F , L \' T V W Y a e o u I I I l l l f f i f l T T T A A A V V V o o o . . . , , , f i f l f f' },
  { name: 'kern-across-space', lang: 'en', rtl: false, styled: true, text: 'T a T o T e V a V o W a W o Y a Y o L T L V L W L Y A T A V A W A Y r a r o f a f o P a P o F a F o To a Ty o We a Va o AV AT Ta Te r. y, P. F, of T at V by W my Y if A' },
  { name: 'chat', lang: 'en', rtl: false, styled: true, text: `lol ok brb, gonna grab coffee ${ch(0x2615)} then I'll push the fix ${ch(0x1f44d)} ${ch(0x2014)} tbh it's like 3 lines... can u review PR #1423 when u get a sec? thx!! ${ch(0x1f64f, 0x1f64f)} also the CI is red again (flaky test?) idk, maybe rerun it & see if main's ok; ping @sam if not` },
  { name: 'emoji-words', lang: 'en', rtl: false, styled: false, text: `ok ${ch(0x1f44d)} yes ${ch(0x1f389)} no ${ch(0x1f645, 0x200d, 0x2640, 0xfe0f)} wait ${ch(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466)} what ${ch(0x1f1ef, 0x1f1f5)} flag ${ch(0x1f3f3, 0xfe0f, 0x200d, 0x1f308)} done ${ch(0x2705)} hmm ${ch(0x1f914, 0x1f914)} x ${ch(0x2764, 0xfe0f)} y ${ch(0x263a, 0xfe0e)} z ${ch(0x31, 0xfe0f, 0x20e3)} one ${ch(0x23, 0xfe0f, 0x20e3)} hash ${ch(0x1f44d, 0x1f3fd)} tone` },
  { name: 'marks-ignorables', lang: 'en', rtl: false, styled: true, text: `foo ${ch(0x301)}bar baz${ZWSP} qux ${ZWSP}quux ${WJ}word ${ch(0x34f)}cgj ${ch(0x200e)}lrm end${ch(0x200d)} ${ch(0x200d)}zwj ${ch(0x200c)}zwnj fi${ch(0x200c)}sh a${ch(0x308)} ${ch(0x308)}b T${ZWSP} ${ZWSP}o V${WJ} ${WJ}a W${ch(0xad)} ${ch(0xad)}e of${ch(0xad)}fice T${ch(0xfeff)} ${ch(0xfeff)}a last${ch(0x301)} ${ch(0x327)}c done` },
  { name: 'other-spaces', lang: 'en', rtl: false, styled: true, text: `a${NBSP}b c${NBSP} d ${NBSP}e f${NBSP}${NBSP}g 10${NBSP}km T${NBSP}o V${NBSP}a x${IDEOGRAPHIC}y z ${IDEOGRAPHIC}w q${IDEOGRAPHIC} r ${ch(0x2009)}thin${ch(0x2009)} s${ch(0x202f)}t 5${ch(0x202f)}% en${ch(0x2002)}space em${ch(0x2003)}space fig${ch(0x2007)}ure T${ch(0x2009)}o T ${NBSP} o end` },
  { name: 'space-runs', lang: 'en', rtl: false, styled: true, text: 'a  b   c    d  e f   g T  o V   a  To   be,  or  not   to be:    that  is the  question.   ' },
  { name: 'arabic-neutral', lang: 'ar', rtl: true, styled: true, text: `${ch(0x643, 0x644, 0x645, 0x629)} - ${ch(0x646, 0x635)} 123 ${ch(0x639, 0x631, 0x628, 0x64a)} ${ch(0x60c)} ${ch(0x62c, 0x645, 0x64a, 0x644)} ( ${ch(0x62e, 0x637)} ) ${ch(0x643, 0x62a, 0x628)} 2026 ${ch(0x642, 0x631, 0x646)} ! ${ch(0x628, 0x644, 0x62f)} ... ${ch(0x644, 0x63a, 0x629)} ${ch(0xab)} ${ch(0x646, 0x642, 0x637)} ${ch(0xbb)} ${ch(0x62a, 0x637, 0x648, 0x631)} 3.14 ${ch(0x639, 0x628, 0x631)} ${ch(0x2014)} ${ch(0x643, 0x644)} : ${ch(0x628, 0x644, 0x627)} 7 ${ch(0x62b, 0x645)} / ${ch(0x641, 0x64a)} ${ch(0x61f)} ${ch(0x647, 0x630, 0x627)}` },
  { name: 'hebrew-latin', lang: 'he', rtl: true, styled: true, text: `${ch(0x5e9, 0x5dc, 0x5d5, 0x5dd)} hello ${ch(0x5e2, 0x5d5, 0x5dc, 0x5dd)} world 123 ${ch(0x5d6, 0x5d4, 0x5d5)} test ${ch(0x5d8, 0x5e7, 0x5e1, 0x5d8)} - mixed , ${ch(0x5db, 0x5d9, 0x5d5, 0x5d5, 0x5df)} ( dir ) ${ch(0x5e1, 0x5d5, 0x5e3)} end 4 ${ch(0x5d5)} 5 ${ch(0x5d0, 0x5d5)} a ${ch(0x5d1)} b ${ch(0x5d2)} ! ${ch(0x5d3)} ? ${ch(0x5d4)} . ${ch(0x5d1, 0x5e2, 0x5d1, 0x5e8, 0x5d9, 0x5ea)} ABC ${ch(0x5dc, 0x5d1, 0x5d3, 0x5d9, 0x5e7, 0x5ea)}` },
  { name: 'urdu-neutral', lang: 'ur', rtl: true, styled: false, text: `${ch(0x6cc, 0x6c1)} - ${ch(0x627, 0x631, 0x62f, 0x648)} 12 ${ch(0x645, 0x6cc, 0x6ba)} ${ch(0x60c)} ${ch(0x627, 0x6cc, 0x6a9)} ( ${ch(0x645, 0x62a, 0x646)} ) ${ch(0x6c1, 0x6d2)} ${ch(0x6d4)} ${ch(0x62c, 0x633)} ! ${ch(0x622, 0x6af)} 2026 ${ch(0x627, 0x648, 0x631)} ${ch(0x2014)} ${ch(0x628, 0x6c1, 0x62a)} ... ${ch(0x633, 0x6d2)} : ${ch(0x642, 0x648, 0x645, 0x6cc)} ${ch(0x61f)} ${ch(0x632, 0x628, 0x627, 0x646)}` },
  { name: 'hindi-neutral', lang: 'hi', rtl: false, styled: false, text: `${ch(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947)} - ${ch(0x92f, 0x939)} 12 ${ch(0x939, 0x93f, 0x928, 0x94d, 0x926, 0x940)} , ${ch(0x92e, 0x947, 0x902)} ( ${ch(0x90f, 0x915)} ) ${ch(0x92a, 0x93e, 0x920)} ${ch(0x964)} ${ch(0x939, 0x948)} ! ${ch(0x936, 0x94d, 0x930, 0x940)} 2026 ${ch(0x92d, 0x93e, 0x930, 0x924)} ${ch(0x2014)} ${ch(0x915, 0x940)} ... ${ch(0x932, 0x93f, 0x92a, 0x93f)} : ${ch(0x91c, 0x93e, 0x924, 0x940)} ? ${ch(0x939, 0x948, 0x964)}` },
  { name: 'long-and-short', lang: 'en', rtl: false, styled: false, text: 'INTERNATIONALIZATION a counterrevolutionaries b pneumonoultramicroscopicsilicovolcanoconiosis c d supercalifragilisticexpialidocious x y antidisestablishmentarianism of the WWWWWWWWWWWWWWWWWWWWWWWW i i i MMMMMMMMMMMMMMMMMMMM l' },
  { name: 'word-forms', lang: 'en', rtl: false, styled: false, text: 'of the and the in the to the for the with the at the by the on the is the The the THE then them they there these of of and and the the a the an the if the as the or the be the do the go the it the' },
]

export const TEXTS = [...CUT_TEXTS.map(given => ({ ...given, styled: given.name === 'prose' })), ...OWN_TEXTS]

export default async function words2SumProbes(): Promise<Probe[]> {
  const treeA = process.env['SUM_TREE_A']
  const treeB = process.env['SUM_TREE_B']
  const fontsPath = process.env['SUM_FONTS']
  if (treeA === undefined || treeB === undefined || fontsPath === undefined) throw new Error('SUM_TREE_A, SUM_TREE_B and SUM_FONTS name the two checkouts and the families file')
  const parts = (process.env['SUM_PARTS'] ?? 'long,short,windows').split(',')
  const dir = mkdtempSync(join(tmpdir(), 'words2-sum-probe-'))
  const bundles: string[] = []
  const sides: Array<[string, string]> = [[resolve(treeA), 'sumTreeA'], [resolve(treeB), 'sumTreeB']]
  for (let i = 0; i < sides.length; i++) {
    const entry = join(dir, `${sides[i]![1]}.ts`)
    writeFileSync(entry, ENTRY(sides[i]![0], sides[i]![1]))
    const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
    bundles.push(await built.outputs[0]!.text())
  }
  const constants = `const FONTS = ${readFileSync(resolve(fontsPath), 'utf8')};\nconst TEXTS = ${JSON.stringify(TEXTS)};\nconst SIZES = ${JSON.stringify(SIZES)};\nconst PARTS = ${JSON.stringify(parts)};\nconst STYLED = ${process.env['SUM_STYLES'] !== 'no'};`
  return [{
    id: 'words2-sum S1', spec: 'words first in Blink\'s port: a sum of words against Canvas\'s own exact totals, and the base against the head on the second check\'s texts and widths, on the machine\'s font families', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundles[0]!}\n${bundles[1]!}\n${constants}\n${BODY}` }],
  }]
}
