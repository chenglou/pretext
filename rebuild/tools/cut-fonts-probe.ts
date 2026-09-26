// A probe for the cut of a wide shaping group in Blink's port (shape.ts addPieces), on real fonts: two checkouts of the
// library, the base and the head, lay the same paragraphs out in one page of the real browser, in every font family of a
// list, and their cuts, positions and lines are compared. The lab's cases hold a few dozen font strings; this asks the
// machine's. Brought over from the words study's probe (branch x-spec-words-blink, tools/words-fonts-probe.ts).
//
//   CUT_TREE_A=<base checkout> CUT_TREE_B=<head checkout> CUT_FONTS=<families.json> [CUT_DETAIL=<families.json>] \
//     [CUT_CONTEXTS=shared] bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/cut-fonts-probe.ts \
//     --out=<dir> --probe-timeout-ms=3000000 --stall-ms=3000000 [--chrome-args=--force-device-scale-factor=1]
//     (under a Chrome slot of the browser lock; counts, no times)
//
// families.json: an array of family names (one that starts with `!` is a generic keyword, written without quotes). Per
// family that resolves (a string at 72 px measures otherwise than in both generic fallbacks), every text at every size is
// prepared plain by each tree. A group is cut only where it is 256 zoomed px or wider, so the texts are long. Compared
// per paragraph: every group's cuts, its total, and the positions (groupPrefix16) at every inner cut of either tree and
// at the space before it, since a tree that cuts words first has other cuts than one that doesn't (shape.ts
// addWordPieces), and a position is what must not move. Then both trees fill the paragraph at a few
// ordinary widths, at the decided lines' own widths and one LayoutUnit to either side, and at widths that put the first
// line's end beside a cut of the head: for up to twelve cuts a paragraph, the smallest width where the first line ends at or
// after the cut and the smallest where it ends after it, each with one LayoutUnit to either side. Those widths are found
// on a third paragraph, the head's, so the two compared paragraphs are asked the same things. Compared per line: its
// range, whether it has a line box, its width and whether it overflows (the decided line's LineInfo). Reported per family:
// paragraphs, groups, cuts, layouts, lines, the layouts with a line end within one grapheme of a cut, what differs, and a
// few examples. A family of CUT_DETAIL and a family that differs also list the widths found, for tools/cut-fonts-cases.ts.
// CUT_CONTEXTS=shared gives each tree one list of contexts a family (a page's way) where the default is a list a paragraph.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'

export const ENTRY = (tree: string, name: string): string => `
import { createContextPool, detectEnvironment, fillLine, firstLine, prepare } from '${tree}/rebuild/src/index.ts'
import { UNKNOWN_FONT_FACTS } from '${tree}/rebuild/src/model.ts'
import { groupPrefix16, measure16, pairAdjust16, adjust16, isClusterBoundary } from '${tree}/rebuild/src/engines/blink/shape.ts'

function environment() {
  const detected = detectEnvironment({ engine: 'blink', build: null, contentLanguage: null, uiLanguage: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

function paragraphOf(family, size, text, lang, rtl) {
  const font = { family, size, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  return { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, font, content: [{ kind: 'text', text }], lineHeight: size * 2, direction: rtl ? 'rtl' : 'ltr', lang, textIndent: 0, textAlign: 'start' }
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

// Where the first line ends at a width, in one fill.
function firstEnd(prepared, width) {
  const filled = fillLine(prepared, firstLine(prepared), { width, left: 0, right: 0 })
  return filled.kind === 'line' ? filled.end : -1
}

function groupsOf(prepared) {
  const p = prepared.state
  const groups = []
  for (let g = 0; g < p.groups.length; g++) groups.push({ start: p.groups[g].start, end: p.groups[g].end, cuts: p.groups[g].cuts, prefix: p.groups[g].prefixAtCut })
  return { text: p.text, groups }
}

const shaper = prepared => ({ p: prepared.state, gaps: null })

globalThis.${name} = {
  environment, paragraphOf, lines, firstEnd, groupsOf, createContextPool,
  prepare: (paragraph, env, contexts) => prepare(paragraph, env, false, contexts),
  position16: (prepared, g, k) => groupPrefix16(shaper(prepared), g, k),
  measure16: (prepared, g, from, to) => measure16(shaper(prepared), g, from, to, prepared.state.groups[g].start, prepared.state.groups[g].end),
  pair16: (prepared, g, k) => pairAdjust16(shaper(prepared), g, k, prepared.state.groups[g].start, prepared.state.groups[g].end),
  wide16: (prepared, g, k) => adjust16(shaper(prepared), g, k, prepared.state.groups[g].start, prepared.state.groups[g].end),
  isClusterBoundary: (prepared, k) => isClusterBoundary(prepared.state, k),
}
`

const BODY = String.raw`
const A = globalThis.cutTreeA, B = globalThis.cutTreeB;
const envA = A.environment(), envB = B.environment();
const zoom = window.devicePixelRatio;
const probeContext = new OffscreenCanvas(1, 1).getContext('2d');
const measured = (font) => { probeContext.font = font; return probeContext.measureText('mmmmmmmmmmlliWAVA fi 123').width; };
const resolves = (family) => measured('72px ' + family + ', monospace') !== measured('72px monospace') || measured('72px ' + family + ', serif') !== measured('72px serif');
const ORDINARY = [97.3, 200, 320, 560];
const LIMIT = 64 * zoom * 8000;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
// The grapheme each offset of a text is in.
const graphemeOf = [];
for (let t = 0; t < TEXTS.length; t++) {
  const index = new Int32Array(TEXTS[t].text.length + 1);
  let n = 0;
  for (const s of segmenter.segment(TEXTS[t].text)) { for (let i = s.index; i < s.index + s.segment.length; i++) index[i] = n; n++; }
  index[TEXTS[t].text.length] = n;
  graphemeOf.push(index);
}
const out = [];
for (let f = 0; f < FONTS.length; f++) {
  const family = FONTS[f].startsWith('!') ? FONTS[f].slice(1) : '"' + FONTS[f] + '"';
  if (!resolves(family)) { out.push({ family: FONTS[f], resolves: false }); continue; }
  const row = { family: FONTS[f], resolves: true, paragraphs: 0, otherText: 0, groups: 0, cutGroups: 0, cuts: 0, wordCuts: 0, wordEdges: 0, wordEdgesDiffer: 0, cutsDiffer: 0, positionsDiffer: 0, layouts: 0, lines: 0, nearCut: 0, targeted: 0, targetedNearCut: 0, differ: 0, differNearCut: 0, searchFills: 0, errors: 0, examples: [], targets: [] };
  const shared = SHARED ? [A.createContextPool(), B.createContextPool(), B.createContextPool()] : null;
  for (let t = 0; t < TEXTS.length; t++) for (let z = 0; z < SIZES.length; z++) {
    const text = TEXTS[t].text, size = SIZES[z];
    let a, b, c;
    try {
      a = A.prepare(A.paragraphOf(family, size, text, TEXTS[t].lang, TEXTS[t].rtl), envA, shared === null ? A.createContextPool() : shared[0]);
      b = B.prepare(B.paragraphOf(family, size, text, TEXTS[t].lang, TEXTS[t].rtl), envB, shared === null ? B.createContextPool() : shared[1]);
      c = B.prepare(B.paragraphOf(family, size, text, TEXTS[t].lang, TEXTS[t].rtl), envB, shared === null ? B.createContextPool() : shared[2]);
    } catch (error) { row.errors++; if (row.examples.length < 4) row.examples.push({ text: TEXTS[t].name, size, error: String(error).slice(0, 200) }); continue; }
    row.paragraphs++;
    const ga = A.groupsOf(a), gb = B.groupsOf(b);
    const sameText = gb.text === text;
    if (!sameText) row.otherText++;
    const near = new Uint8Array(text.length + 1);
    const index = graphemeOf[t];
    const inner = [];
    let before16 = 0;
    for (let g = 0; g < gb.groups.length; g++) {
      const group = gb.groups[g];
      row.groups++;
      if (group.cuts.length > 2) row.cutGroups++;
      // A tree that cuts words first (shape.ts addWordPieces) and one that doesn't have other cuts where words are shorter
      // than 256 zoomed px. What must not differ is a position: at every inner cut of either tree, and at the space before
      // it, the advance sum each tree gives (groupPrefix16), and the group's total.
      const baseCuts = ga.groups[g].cuts;
      if (JSON.stringify(baseCuts) !== JSON.stringify(group.cuts)) row.cutsDiffer++;
      if (ga.groups[g].prefix[baseCuts.length - 1] !== group.prefix[group.cuts.length - 1]) { row.positionsDiffer++; if (row.examples.length < 4) row.examples.push({ text: TEXTS[t].name, size, group: g, baseTotal: ga.groups[g].prefix[baseCuts.length - 1], headTotal: group.prefix[group.cuts.length - 1] }); }
      const edges = new Set();
      for (let i = 1; i + 1 < baseCuts.length; i++) edges.add(baseCuts[i]);
      for (let i = 1; i + 1 < group.cuts.length; i++) { edges.add(group.cuts[i]); if (!baseCuts.includes(group.cuts[i])) row.wordCuts++; }
      for (const k of Array.from(edges)) if (text.charCodeAt(k - 1) === 0x20) edges.add(k - 1);
      for (const k of edges) {
        const pa = A.position16(a, g, k), pb = B.position16(b, g, k);
        row.wordEdges++;
        if (pa !== pb) { row.wordEdgesDiffer++; if (row.examples.length < 6) row.examples.push({ text: TEXTS[t].name, size, group: g, edge: k, around: text.slice(Math.max(0, k - 12), k + 12), base16: pa, head16: pb }); }
      }
      for (let i = 1; i + 1 < group.cuts.length; i++) {
        const k = group.cuts[i];
        row.cuts++;
        inner.push([g, k, before16]);
        if (sameText) for (let o = 0; o <= text.length; o++) if (Math.abs(index[o] - index[k]) <= 1) near[o] = 1;
      }
      before16 += group.prefix[group.prefix.length - 1];
    }
    // Widths that put the first line's end beside a cut, found on the third paragraph.
    const ends = new Map();
    const endAt = (n) => { let e = ends.get(n); if (e === undefined) { e = B.firstEnd(c, n / 64 / zoom); ends.set(n, e); row.searchFills++; } return e; };
    // The smallest n, in LayoutUnits of the zoomed width, where the first line ends at or after target.
    const threshold = (target, guess) => {
      let hi = Math.max(1, Math.min(LIMIT, guess)), lo = hi - 1, step = 1;
      while (endAt(hi) < target) { lo = hi; hi += step; step *= 2; if (hi > LIMIT) return -1; }
      step = 1;
      while (lo > 0 && endAt(lo) >= target) { hi = lo; lo = Math.max(0, lo - step); step *= 2; }
      while (hi - lo > 1) { const mid = lo + ((hi - lo) >> 1); if (endAt(mid) >= target) hi = mid; else lo = mid; }
      return hi;
    };
    const targeted = new Set();
    if (sameText) {
      const picks = Math.min(12, inner.length);
      for (let i = 0; i < picks; i++) {
        const cut = inner[Math.floor((i + 0.5) * inner.length / picks)];
        const g = cut[0], k = cut[1];
        const wordEnd = text.charCodeAt(k - 1) === 0x20 ? k - 1 : k;
        const first = threshold(k, Math.ceil((cut[2] + B.position16(c, g, wordEnd)) / 1024));
        if (first < 0) continue;
        let second = first;
        if (endAt(first) === k) {
          let next = text.indexOf(' ', k + 1);
          if (next < 0 || next > gb.groups[g].end) next = Math.min(gb.groups[g].end, k + 2);
          second = threshold(k + 1, Math.ceil((cut[2] + B.position16(c, g, next)) / 1024));
        }
        for (let d = -1; d <= 1; d++) { if (first + d > 0) targeted.add((first + d) / 64 / zoom); if (second > 0 && second + d > 0) targeted.add((second + d) / 64 / zoom); }
      }
    }
    const widths = ORDINARY.slice();
    const seen = new Set(widths);
    const found = Array.from(targeted);
    for (let i = 0; i < found.length; i++) if (!seen.has(found[i])) { seen.add(found[i]); widths.push(found[i]); }
    const lastTargeted = widths.length;
    const used = [];
    for (let w = 0; w < widths.length; w++) {
      const width = widths[w];
      let la, lb;
      try { la = A.lines(a, width); lb = B.lines(b, width); } catch (error) { row.errors++; if (row.examples.length < 4) row.examples.push({ text: TEXTS[t].name, size, width, error: String(error).slice(0, 200) }); continue; }
      row.layouts++;
      row.lines += lb.length;
      let isNear = false;
      for (let l = 0; l + 1 < lb.length; l++) if (near[lb[l][1]] === 1) isNear = true;
      if (isNear) row.nearCut++;
      const isTargeted = w >= ORDINARY.length && w < lastTargeted;
      if (isTargeted) { row.targeted++; used.push(width); if (isNear) row.targetedNearCut++; }
      const ja = JSON.stringify(la), jb = JSON.stringify(lb);
      if (ja !== jb) {
        row.differ++;
        if (isNear) row.differNearCut++;
        if (row.examples.length < 6) {
          let l = 0;
          while (l < la.length && l < lb.length && JSON.stringify(la[l]) === JSON.stringify(lb[l])) l++;
          row.examples.push({ text: TEXTS[t].name, size, width, line: l, base: la[l], head: lb[l], lineText: text.slice(lb[l] ? lb[l][0] : 0, lb[l] ? lb[l][1] : 0) });
        }
      }
      if (w === 1 || w === 2) {
        for (let l = 0; l < lb.length && l < 3; l++) for (let d = -1; d <= 1; d++) {
          const at = (lb[l][3] + d) / 64 / zoom;
          if (at > 0 && !seen.has(at)) { seen.add(at); widths.push(at); }
        }
      }
    }
    row.targets.push({ text: t, size, widths: used });
  }
  if (!DETAIL.includes(FONTS[f]) && row.differ === 0 && row.positionsDiffer === 0 && row.wordEdgesDiffer === 0) row.targets = [];
  out.push(row);
  if (f % 2 === 1) await new Promise(resolve => setTimeout(resolve, 0));
}
return { userAgent: navigator.userAgent, devicePixelRatio: zoom, texts: TEXTS.length, sizes: SIZES, contexts: SHARED ? 'one list a family and tree' : 'a list a paragraph', fonts: out };
`

const ch = (...codes: number[]): string => String.fromCodePoint(...codes)

export const SIZES = [16, 28]

// Paragraphs whose shaping groups are several cuts long at both sizes: ligature-prone Latin, kerning beside punctuation,
// prose, Arabic, Urdu, CJK with Latin, soft hyphens and no-break spaces, a run without spaces, accents and combining marks,
// Devanagari, Thai, Greek with Cyrillic, many scripts in one line, pointed Hebrew, and digits with a URL.
export const TEXTS: Array<{ name: string; lang: string; rtl: boolean; text: string }> = [
  { name: 'ligatures', lang: 'en', rtl: false, text: 'The office staff of the affluent fjord village called Zapfino offered waffles, coffee and truffles to five efficient officials, who filed the final affidavit baffled by the difficult shuffle of traffic off the cliff.' },
  { name: 'kerning', lang: 'en', rtl: false, text: 'AVATAR Wave Yo. Ty fly office affix fjord Tr r. P. L T V A W. Y, F. T, r, y. "Quoted" (paren) [bracket] it\'s don\'t rock\'n\'roll WAVE AWAY To Tomorrow. Yes, Your Truly, V. A. Wyatt first fifth office waffle fjord ffl fi fl ff Th ct st The Thin fin flat after offer Tfi fT f T f f i f l T h' },
  { name: 'prose', lang: 'en', rtl: false, text: 'To be, or not to be: that is the question. Whether \'tis nobler in the mind to suffer the slings and arrows of outrageous fortune, or to take arms against a sea of troubles.' },
  { name: 'unbroken', lang: 'en', rtl: false, text: 'officeaffluentfjordZapfinowafflecoffeetrufflefiveefficientofficialsfiledthefinalaffidavitbaffledbythedifficultshuffleoftrafficoffthecliff' },
  { name: 'digits-url', lang: 'en', rtl: false, text: 'ok so I tried the new layout thing at 320 px - it works, mostly... but 3.14 of the 1,000 rows (about 0.3%) overflow? see http://example.com/a/b?c=d&e=f or ping me @ 12:30 -- thanks! 1 2 3 11 17 71 1,000 3.14 7/8 10:45 2026-09-20 $5 100% #1 No. 7 A1 B2 (1) [2] {3} 4th 1st' },
  { name: 'arabic', lang: 'ar', rtl: true, text: `${ch(0x645, 0x631, 0x62d, 0x628, 0x627)} ${ch(0x628, 0x627, 0x644, 0x639, 0x627, 0x644, 0x645, 0x60c)} ${ch(0x647, 0x630, 0x627)} ${ch(0x646, 0x635)} ${ch(0x639, 0x631, 0x628, 0x64a)} ${ch(0x644, 0x627, 0x62e, 0x62a, 0x628, 0x627, 0x631)} ${ch(0x627, 0x644, 0x62a, 0x62e, 0x637, 0x64a, 0x637)}. ${ch(0x627, 0x644, 0x644, 0x63a, 0x629)} ${ch(0x627, 0x644, 0x639, 0x631, 0x628, 0x64a, 0x629)} ${ch(0x62c, 0x645, 0x64a, 0x644, 0x629)} ${ch(0x62c, 0x62f, 0x627, 0x60c)} ${ch(0x648, 0x641, 0x64a)} ${ch(0x627, 0x644, 0x628, 0x62f, 0x627, 0x64a, 0x629)} ${ch(0x643, 0x627, 0x646)} ${ch(0x627, 0x644, 0x62e, 0x637)} ${ch(0x627, 0x644, 0x639, 0x631, 0x628, 0x64a)} ${ch(0x64a, 0x643, 0x62a, 0x628)} ${ch(0x628, 0x644, 0x627)} ${ch(0x646, 0x642, 0x627, 0x637)} ${ch(0x62b, 0x645)} ${ch(0x62a, 0x637, 0x648, 0x631)} ${ch(0x639, 0x628, 0x631)} ${ch(0x627, 0x644, 0x642, 0x631, 0x648, 0x646)} ${ch(0x641, 0x64a)} ${ch(0x643, 0x644)} ${ch(0x627, 0x644, 0x628, 0x644, 0x627, 0x62f)}.` },
  { name: 'urdu', lang: 'ur', rtl: true, text: `${ch(0x6cc, 0x6c1)} ${ch(0x627, 0x631, 0x62f, 0x648)} ${ch(0x645, 0x6cc, 0x6ba)} ${ch(0x627, 0x6cc, 0x6a9)} ${ch(0x622, 0x632, 0x645, 0x627, 0x626, 0x634, 0x6cc)} ${ch(0x645, 0x62a, 0x646)} ${ch(0x6c1, 0x6d2)} ${ch(0x62c, 0x633)} ${ch(0x645, 0x6cc, 0x6ba)} ${ch(0x622, 0x6af)} ${ch(0x627, 0x648, 0x631)} ${ch(0x628, 0x6c1, 0x62a)} ${ch(0x633, 0x6d2)} ${ch(0x627, 0x644, 0x641, 0x627, 0x638)} ${ch(0x6c1, 0x6cc, 0x6ba, 0x6d4)} ${ch(0x67e, 0x627, 0x6a9, 0x633, 0x62a, 0x627, 0x646)} ${ch(0x6a9, 0x6cc)} ${ch(0x642, 0x648, 0x645, 0x6cc)} ${ch(0x632, 0x628, 0x627, 0x646)} ${ch(0x627, 0x631, 0x62f, 0x648)} ${ch(0x6c1, 0x6d2)} ${ch(0x627, 0x648, 0x631)} ${ch(0x6cc, 0x6c1)} ${ch(0x646, 0x633, 0x62a, 0x639, 0x644, 0x6cc, 0x642)} ${ch(0x62e, 0x637)} ${ch(0x645, 0x6cc, 0x6ba)} ${ch(0x644, 0x6a9, 0x6be, 0x6cc)} ${ch(0x62c, 0x627, 0x62a, 0x6cc)} ${ch(0x6c1, 0x6d2, 0x6d4)}` },
  { name: 'cjk-latin', lang: 'ja', rtl: false, text: `${ch(0x65e5, 0x672c, 0x8a9e, 0x306e, 0x6587, 0x7ae0, 0x3068)} English words ${ch(0x304c, 0x6df7, 0x3056, 0x3063, 0x305f, 0x6bb5, 0x843d, 0x3067, 0x3059, 0x3002)}The office ${ch(0x5728, 0x6771, 0x4eac, 0xff0c)}affluent ${ch(0x5ba2, 0x6236)} fjord ${ch(0x65c5, 0x884c, 0xff0c)}Zapfino ${ch(0x5b57, 0x4f53)} waffle ${ch(0x5496, 0x5561, 0x5e97, 0x3002, 0x4e2d, 0x6587, 0x548c)} Latin ${ch(0x6df7, 0x6392)} test ${ch(0x6587, 0x672c, 0xff0c, 0x7b2c)} 12 ${ch(0x884c)} final ${ch(0x7d50, 0x675f, 0x3002)}` },
  { name: 'shy-nbsp', lang: 'en', rtl: false, text: `The of${ch(0xad)}fice staff of Dr.${ch(0xa0)}Wyatt in the af${ch(0xad)}flu${ch(0xad)}ent fjord vil${ch(0xad)}lage of${ch(0xad)}fered 1${ch(0xa0)}000 waf${ch(0xad)}fles, cof${ch(0xad)}fee and truf${ch(0xad)}fles to 5${ch(0xa0)}ef${ch(0xad)}fi${ch(0xad)}cient of${ch(0xad)}fi${ch(0xad)}cials on p.${ch(0xa0)}12, baf${ch(0xad)}fled by the dif${ch(0xad)}fi${ch(0xad)}cult shuf${ch(0xad)}fle of traf${ch(0xad)}fic off the${ch(0xa0)}cliff.` },
  { name: 'accents', lang: 'en', rtl: false, text: `Na${ch(0x131)}ve caf${ch(0xe9)} r${ch(0xe9)}sum${ch(0xe9)} co${ch(0xf6)}perate ${ch(0xc5)}ngstr${ch(0xf6)}m sm${ch(0xf8)}rrebr${ch(0xf8)}d e${ch(0x301)}tude cafe${ch(0x301)} Vi${ch(0x1ec7)}t Nam ph${ch(0x1edf)} T${ch(0xfc)}r ${ch(0xd8)}y cr${ch(0xe8)}me br${ch(0xfb)}l${ch(0xe9)}e fa${ch(0xe7)}ade jalape${ch(0xf1)}o S${ch(0xe3)}o Tom${ch(0xe9)} Z${ch(0xfc)}rich Krak${ch(0xf3)}w Dvo${ch(0x159, 0xe1)}k ${ch(0x141, 0xf3)}d${ch(0x17a)} cafe${ch(0x301)} Vie${ch(0x323, 0x302)}t an${ch(0x303)}o u${ch(0x308)}ber` },
  { name: 'hindi', lang: 'hi', rtl: false, text: `${ch(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947)} ${ch(0x926, 0x941, 0x928, 0x93f, 0x92f, 0x93e)}, ${ch(0x92f, 0x939)} ${ch(0x939, 0x93f, 0x928, 0x94d, 0x926, 0x940)} ${ch(0x92e, 0x947, 0x902)} ${ch(0x90f, 0x915)} ${ch(0x92a, 0x930, 0x940, 0x915, 0x94d, 0x937, 0x923)} ${ch(0x92a, 0x93e, 0x920)} ${ch(0x939, 0x948)} ${ch(0x915, 0x94d, 0x937, 0x924, 0x94d, 0x930, 0x93f, 0x92f)} ${ch(0x936, 0x94d, 0x930, 0x940, 0x964)} ${ch(0x92d, 0x93e, 0x930, 0x924)} ${ch(0x915, 0x940)} ${ch(0x930, 0x93e, 0x91c, 0x92d, 0x93e, 0x937, 0x93e)} ${ch(0x939, 0x93f, 0x928, 0x94d, 0x926, 0x940)} ${ch(0x939, 0x948)} ${ch(0x914, 0x930)} ${ch(0x92f, 0x939)} ${ch(0x926, 0x947, 0x935, 0x928, 0x93e, 0x917, 0x930, 0x940)} ${ch(0x932, 0x93f, 0x92a, 0x93f)} ${ch(0x92e, 0x947, 0x902)} ${ch(0x932, 0x93f, 0x916, 0x940)} ${ch(0x91c, 0x93e, 0x924, 0x940)} ${ch(0x939, 0x948, 0x964)}` },
  { name: 'thai', lang: 'th', rtl: false, text: `${ch(0xe2a, 0xe27, 0xe31, 0xe2a, 0xe14, 0xe35)} ${ch(0xe0a, 0xe32, 0xe27, 0xe42, 0xe25, 0xe01)} ${ch(0xe19, 0xe35, 0xe48)} ${ch(0xe04, 0xe37, 0xe2d)} ${ch(0xe02, 0xe49, 0xe2d, 0xe04, 0xe27, 0xe32, 0xe21)} ${ch(0xe17, 0xe14, 0xe2a, 0xe2d, 0xe1a)} ${ch(0xe20, 0xe32, 0xe29, 0xe32, 0xe44, 0xe17, 0xe22)} ${ch(0xe17, 0xe35, 0xe48)} ${ch(0xe21, 0xe35)} ${ch(0xe0a, 0xe48, 0xe2d, 0xe07, 0xe27, 0xe48, 0xe32, 0xe07)} ${ch(0xe41, 0xe25, 0xe30)} ${ch(0xe1b, 0xe23, 0xe30, 0xe42, 0xe22, 0xe04)} ${ch(0xe22, 0xe32, 0xe27)} ${ch(0xe1e, 0xe2d)} ${ch(0xe2a, 0xe33, 0xe2b, 0xe23, 0xe31, 0xe1a)} ${ch(0xe01, 0xe32, 0xe23)} ${ch(0xe15, 0xe31, 0xe14)} ${ch(0xe1a, 0xe23, 0xe23, 0xe17, 0xe31, 0xe14)} ${ch(0xe2b, 0xe25, 0xe32, 0xe22)} ${ch(0xe04, 0xe23, 0xe31, 0xe49, 0xe07)} ${ch(0xe43, 0xe19)} ${ch(0xe2b, 0xe19, 0xe36, 0xe48, 0xe07)} ${ch(0xe22, 0xe48, 0xe2d, 0xe2b, 0xe19, 0xe49, 0xe32)}` },
  { name: 'greek-cyrillic', lang: 'el', rtl: false, text: `${ch(0x39a, 0x3b1, 0x3bb, 0x3b7, 0x3bc, 0x3ad, 0x3c1, 0x3b1)} ${ch(0x3ba, 0x3cc, 0x3c3, 0x3bc, 0x3b5)}, ${ch(0x3b1, 0x3c5, 0x3c4, 0x3cc)} ${ch(0x3b5, 0x3af, 0x3bd, 0x3b1, 0x3b9)} ${ch(0x3ad, 0x3bd, 0x3b1)} ${ch(0x3ba, 0x3b5, 0x3af, 0x3bc, 0x3b5, 0x3bd, 0x3bf)}. ${ch(0x3a4, 0x3b1)} ${ch(0x3a5, 0x3b3, 0x3b5, 0x3af, 0x3b1)} ${ch(0x3a4, 0x3c5, 0x3c0, 0x3bf, 0x3b3, 0x3c1, 0x3b1, 0x3c6, 0x3af, 0x3b1)} ${ch(0x41f, 0x440, 0x438, 0x432, 0x435, 0x442)}, ${ch(0x43c, 0x438, 0x440)}! ${ch(0x413, 0x423, 0x422, 0x410)} ${ch(0x422, 0x443, 0x442)} ${ch(0x423, 0x434, 0x430, 0x447, 0x430)}. ${ch(0x420, 0x430, 0x441, 0x447, 0x451, 0x442)} ${ch(0x441, 0x442, 0x440, 0x43e, 0x43a)} ${ch(0x431, 0x435, 0x437)} ${ch(0x431, 0x440, 0x430, 0x443, 0x437, 0x435, 0x440, 0x430)} ${ch(0x434, 0x43b, 0x44f)} ${ch(0x434, 0x43b, 0x438, 0x43d, 0x43d, 0x43e, 0x433, 0x43e)} ${ch(0x430, 0x431, 0x437, 0x430, 0x446, 0x430)} ${ch(0x442, 0x435, 0x43a, 0x441, 0x442, 0x430)}.` },
  { name: 'mixed-scripts', lang: 'en', rtl: false, text: `mixed ${ch(0x645, 0x631, 0x62d, 0x628, 0x627)} Latin ${ch(0x5e9, 0x5dc, 0x5d5, 0x5dd)} and ${ch(0x65e5, 0x672c, 0x8a9e)} words ${ch(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947)} in one ${ch(0x3ba, 0x3cc, 0x3c3, 0x3bc, 0x3b5)} line ${ch(0x43c, 0x438, 0x440)} of text ${ch(0xd55c, 0xad6d, 0xc5b4)} here, then more office ${ch(0x645, 0x631, 0x62d, 0x628, 0x627)} ${ch(0x628, 0x627, 0x644, 0x639, 0x627, 0x644, 0x645)} affluent ${ch(0x5e9, 0x5dc, 0x5d5, 0x5dd)} ${ch(0x5e2, 0x5d5, 0x5dc, 0x5dd)} fjord ${ch(0x6771, 0x4eac)} waffle` },
  { name: 'hebrew', lang: 'he', rtl: true, text: `${ch(0x5e9, 0x5dc, 0x5d5, 0x5dd)} ${ch(0x5e2, 0x5d5, 0x5dc, 0x5dd)}, ${ch(0x5d6, 0x5d4, 0x5d5)} ${ch(0x5d8, 0x5e7, 0x5e1, 0x5d8)} ${ch(0x5d1, 0x5e2, 0x5d1, 0x5e8, 0x5d9, 0x5ea)} ${ch(0x5dc, 0x5d1, 0x5d3, 0x5d9, 0x5e7, 0x5ea)} ${ch(0x5d4, 0x5e4, 0x5e8, 0x5d9, 0x5e1, 0x5d4)}. ${ch(0x5d5, 0x5b0, 0x5d0, 0x5b8, 0x5d4, 0x5b7, 0x5d1, 0x5b0, 0x5ea, 0x5b8, 0x5bc)} ${ch(0x5dc, 0x5b0, 0x5e8, 0x5b5, 0x5e2, 0x5b2, 0x5da, 0x5b8)} ${ch(0x5db, 0x5b8, 0x5bc, 0x5de, 0x5d5, 0x5b9, 0x5da, 0x5b8)} ${ch(0x5d1, 0x5b0, 0x5bc, 0x5e8, 0x5b5, 0x5d0, 0x5e9, 0x5b4, 0x5c1, 0x5d9, 0x5ea)} ${ch(0x5d1, 0x5b8, 0x5bc, 0x5e8, 0x5b8, 0x5d0)} ${ch(0x5d0, 0x5b1, 0x5dc, 0x5b9, 0x5d4, 0x5b4, 0x5d9, 0x5dd)} ${ch(0x5d0, 0x5b5, 0x5ea)} ${ch(0x5d4, 0x5b7, 0x5e9, 0x5b8, 0x5bc, 0x5c1, 0x5de, 0x5b7, 0x5d9, 0x5b4, 0x5dd)} ${ch(0x5d5, 0x5b0, 0x5d0, 0x5b5, 0x5ea)} ${ch(0x5d4, 0x5b8, 0x5d0, 0x5b8, 0x5e8, 0x5b6, 0x5e5)}` },
]

export default async function cutFontsProbes(): Promise<Probe[]> {
  const treeA = process.env['CUT_TREE_A']
  const treeB = process.env['CUT_TREE_B']
  const fontsPath = process.env['CUT_FONTS']
  if (treeA === undefined || treeB === undefined || fontsPath === undefined) throw new Error('CUT_TREE_A, CUT_TREE_B and CUT_FONTS name the two checkouts and the families file')
  const detailPath = process.env['CUT_DETAIL']
  const dir = mkdtempSync(join(tmpdir(), 'cut-fonts-probe-'))
  const bundles: string[] = []
  const sides: Array<[string, string]> = [[resolve(treeA), 'cutTreeA'], [resolve(treeB), 'cutTreeB']]
  for (let i = 0; i < sides.length; i++) {
    const entry = join(dir, `${sides[i]![1]}.ts`)
    writeFileSync(entry, ENTRY(sides[i]![0], sides[i]![1]))
    const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
    bundles.push(await built.outputs[0]!.text())
  }
  const constants = `const FONTS = ${readFileSync(resolve(fontsPath), 'utf8')};\nconst DETAIL = ${detailPath === undefined ? '[]' : readFileSync(resolve(detailPath), 'utf8')};\nconst TEXTS = ${JSON.stringify(TEXTS)};\nconst SIZES = ${JSON.stringify(SIZES)};\nconst SHARED = ${process.env['CUT_CONTEXTS'] === 'shared'};`
  return [{
    id: 'cut-fonts F1', spec: 'the cut of a wide group: the base and the head of Blink\'s port on the machine\'s font families', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundles[0]!}\n${bundles[1]!}\n${constants}\n${BODY}` }],
  }]
}
