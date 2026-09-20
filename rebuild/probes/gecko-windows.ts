// Gecko probes for windows inside long shaping units (research/PROFILING-START.md item 3), pinned Firefox 156.0 at
// DPR 2. Measurement only, by the in-word probe's method (gecko-port F15): the DOM's per code point advances in au (Range
// rects x 60) beside measureText sums from a main-thread OffscreenCanvas at the CSS size, which is how the port measures.
// Gecko shapes a word of any length in one call (gfxFont.cpp:3804-3808, :3564-3617), so no cut inside a unit is exact by
// construction, and the port's cut rule is Canvas's own answer (engines/gecko/advance.ts windowsOf). The probe runs that
// rule on long strings without spaces and holds every cut it accepts against the DOM.
// - W1, per sample (a script class in the lab's named fonts, with and without letter spacing, a font fallback edge
//   inside the unit, Latin with kerning inside CJK, a long Latin word): the string is one unit. For each of 16 grid
//   phases, so that every cluster boundary is tried as a cut once: cuts at every 16th cluster start, each held against
//   the cells on its two sides: the rule by text (a mark that starts a cluster, letters that join across), the two
//   cells alone adding up to the two together, the ink box of the pair of clusters around the cut with and without
//   ligatures, and the ligature groups of the two cells apart and together (W at 2px of letter spacing less W at
//   0.001px). A cut that fails leaves its cells in one window, measured whole. At every accepted cut: the windows' sum
//   before it, the DOM's advance before it, and the long recipe's W(unit) - W(suffix) with what crosses it there. Tallied
//   per sample, with the first examples of every accepted cut that isn't the DOM's advance.
// - W2, inside the windows of phase 0, which is the port's own grid: at every cluster boundary t of a window [p, q) the
//   window's recipe, advance(p) + W(p..q) - W(t..q), where the cluster before t and the rest of the window add up, beside
//   the DOM's advance and the long recipe's.
//
// Run: python3 .artifacts/session/with-browser-lock.py probes-gecko-windows --browser=firefox -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-windows.ts --out=<out>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Probe } from './types.ts'

const corpus = (name: string, from: number, units: number, keepSpaces = false): string => {
  const text = readFileSync(join(import.meta.dir, '..', '..', 'corpora', `${name}.txt`), 'utf8')
  let out = ''
  for (const ch of text.slice(from)) {
    if (out.length >= units) break
    // U+0020 and U+00A0 are shaping unit boundaries, and the other white space and controls are invalid characters.
    if (/\p{White_Space}|\p{Cc}|\p{Cf}/u.test(ch) && !(keepSpaces && ch === ' ')) continue
    out += ch
  }
  return out
}

// Latin words with kerned pairs and ligatures put into a run of Han, one every seven characters.
const withLatin = (han: string): string => {
  const words = ['AVATAR', 'To', 'Wave', 'office', 'Ty', 'firstname', 'LT', 'Yo']
  let out = ''
  let k = 0
  for (let i = 0; i < han.length; i += 7) out += han.slice(i, i + 7) + words[k++ % words.length]!
  return out
}

type Sample = { id: string; font: string; lang: string; direction: 'ltr' | 'rtl'; letterSpacing: number; text: string }

function samples(): Sample[] {
  const out: Sample[] = []
  const add = (id: string, fonts: string[], lang: string, direction: 'ltr' | 'rtl', text: string, spaced: boolean): void => {
    for (let f = 0; f < fonts.length; f++) {
      out.push({ id: `${id} ${fonts[f]!}`, font: fonts[f]!, lang, direction, letterSpacing: 0, text })
      if (spaced && f === 0) out.push({ id: `${id} ${fonts[f]!} letter-spacing 2px`, font: fonts[f]!, lang, direction, letterSpacing: 2, text })
    }
  }
  const BENCH = '16px "Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif'
  const han = corpus('zh-zhufu', 0, 400)
  add('han', ['16px "PingFang TC"', '18px "PingFang SC"', '20px "Songti SC"', BENCH, '17px serif'], 'zh-Hant', 'ltr', han, true)
  add('kana', ['16px "Hiragino Sans"', '20px "Hiragino Mincho ProN"', '16px "PingFang SC"'], 'ja', 'ltr', corpus('ja-rashomon', 0, 400), true)
  add('hangul', ['16px "Apple SD Gothic Neo"', '18px "Apple SD Gothic Neo"', BENCH], 'ko', 'ltr', corpus('ko-sonagi', 0, 400), true)
  add('arabic', ['16px "Geeza Pro"', '24px Amiri', '16px "Noto Naskh Arabic"', '16px Arial', '20px "Noto Nastaliq Urdu"', BENCH], 'ar', 'rtl', corpus('ar-risalat-al-ghufran-part-1', 0, 300), false)
  add('thai', ['20px Thonburi', '16px Thonburi', '16px Arial', BENCH], 'th', 'ltr', corpus('th-nithan-vetal-story-1', 0, 400), true)
  add('khmer', ['20px "Khmer MN"', '16px "Khmer Sangam MN"', '16px Arial'], 'km', 'ltr', corpus('km-prachum-reuang-preng-khmer-volume-7-stories-1-10', 0, 400), true)
  add('burmese', ['20px "Myanmar MN"', '16px "Myanmar Sangam MN"', '16px Arial'], 'my', 'ltr', corpus('my-cunning-heron-teacher', 0, 400), true)
  add('devanagari', ['16px "Kohinoor Devanagari"', '20px "Kohinoor Devanagari"', '16px Arial'], 'hi', 'ltr', corpus('hi-eidgah', 0, 400), true)
  // A font fallback edge inside the unit, and Latin with kerning inside CJK.
  add('han-latin', ['18px "Times New Roman", "Songti SC"', BENCH, '16px Verdana, "PingFang SC"', '14px "Helvetica Neue", "Hiragino Sans"'], 'zh-Hans', 'ltr', withLatin(han.slice(0, 240)), true)
  add('han-thai-emoji', [BENCH, '16px Arial'], 'en', 'ltr', han.slice(0, 60) + corpus('th-nithan-vetal-story-1', 0, 60) + String.fromCodePoint(0x1f600, 0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467) + han.slice(60, 120) + corpus('ko-sonagi', 0, 60), false)
  // A long Latin word: kerning and ligatures cross many cuts, which must then fail.
  const latin = corpus('en-gatsby-opening', 0, 300)
  add('latin', ['16px "Helvetica Neue"', '18px "Times New Roman"', '16px Verdana', '16px Georgia', '14px "Helvetica Neue"', '24px Amiri', '16px "Hoefler Text"'], 'en', 'ltr', latin, true)
  add('url', ['16px "Helvetica Neue"', '14px Menlo'], 'en', 'ltr', 'https://example.com/reports/2026/AVATAR/To/Wave/office/firstname?query=Typography&filter=LT,Yo;flow=affluent#waffles-and-fjords', false)
  return out
}

const HELPERS = String.raw`
const dpr = window.devicePixelRatio;
const ctxOf = (font, lang, direction, letterSpacing) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = lang; c.font = font; c.letterSpacing = letterSpacing; c.direction = direction;
  return c;
};
// The DOM's advance before every code unit offset, in au, letter spacing included.
const domBefore = (s) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; white-space: pre; direction: ' + s.direction;
  div.lang = s.lang;
  const span = document.createElement('span'); span.style.font = s.font; span.style.letterSpacing = s.letterSpacing + 'px';
  const node = document.createTextNode(s.text); span.append(node); div.append(span);
  host.append(div);
  const range = document.createRange();
  const before = new Array(node.data.length + 1).fill(0);
  let sum = 0;
  for (let i = 0; i < node.data.length;) {
    const len = node.data.codePointAt(i) > 0xffff ? 2 : 1;
    range.setStart(node, i); range.setEnd(node, i + len);
    sum += [...range.getClientRects()].reduce((a, r) => a + r.width, 0) * 60;
    for (let k = 1; k <= len; k++) before[i + k] = sum;
    i += len;
  }
  div.remove();
  return before;
};
// Rect widths are floats: a sum of them is a whole number of au to within their rounding.
const isDom = (au, domAu) => Math.abs(au - domAu) < 0.01;
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
const boundariesOf = (text) => { const b = []; for (const g of seg.segment(text)) b.push(g.index); b.push(text.length); return b; };
// Joining_Type, as far as the samples need it: Arabic letters that join to the next letter, and those that join to the
// one before.
const RIGHT_JOINING = [[0x622, 0x625], [0x627, 0x627], [0x629, 0x629], [0x62f, 0x632], [0x648, 0x648], [0x671, 0x673], [0x675, 0x677], [0x688, 0x699], [0x6c0, 0x6c0], [0x6c3, 0x6cb], [0x6cd, 0x6cd], [0x6cf, 0x6cf], [0x6d2, 0x6d3], [0x6d5, 0x6d5]];
const isRightJoining = (ch) => RIGHT_JOINING.some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b);
const isArabicLetter = (ch) => /\p{Script=Arabic}/u.test(ch) && /\p{L}/u.test(ch) && ch.codePointAt(0) !== 0x621;
const joinsAcross = (text, t) => {
  let a = t - 1; while (a > 0 && /\p{Mn}/u.test(text[a])) a--;
  let b = t; while (b + 1 < text.length && /\p{Mn}/u.test(text[b])) b++;
  return isArabicLetter(text[a]) && !isRightJoining(text[a]) && isArabicLetter(text[b]);
};
`

const W1 = String.raw`
const CELL = 16;
const out = { dpr, samples: [] };
for (const s of SAMPLES) {
  const own = ctxOf(s.font, s.lang, s.direction, s.letterSpacing !== 0 ? '0.001px' : '0px');
  const off = ctxOf(s.font, s.lang, s.direction, '0.001px');
  const spaced = ctxOf(s.font, s.lang, s.direction, '2px');
  const au = (c, a, b) => Math.round(c.measureText(s.text.slice(a, b)).width * 60);
  const groups = (a, b) => (au(spaced, a, b) - au(off, a, b)) / 120;
  const ink = (c, a, b) => { const m = c.measureText(s.text.slice(a, b)); return [m.width, m.actualBoundingBoxLeft, m.actualBoundingBoxRight]; };
  const B = boundariesOf(s.text);
  const n = B.length - 1;
  const dom = domBefore(s);
  const spacingAu = Math.round(s.letterSpacing * 60);
  const unit = au(own, 0, s.text.length);
  const tally = { id: s.id, units: s.text.length, clusters: n, unit, domWhole: +dom[s.text.length].toFixed(3), tried: 0, ruledOut: 0, sumFails: 0, inkFails: 0, groupFails: 0, held: 0,
    heldIsDom: 0, heldIsLong: 0, longIsDom: 0, longCrossesNothing: 0, heldJoined: 0, heldJoinedIsDom: 0, sumsToUnit: 0, phases: 0, notDom: [], inside: null };
  for (let phase = 0; phase < CELL; phase++) {
    const grid = [0];
    for (let i = CELL + phase; n - i >= CELL; i += CELL) grid.push(B[i]);
    grid.push(s.text.length);
    if (grid.length < 3) continue;
    tally.phases++;
    const windows = [];
    let start = 0, before = 0, width = au(own, grid[0], grid[1]);
    for (let i = 1; i + 1 < grid.length; i++) {
      const g = grid[i];
      const index = B.indexOf(g);
      tally.tried++;
      const left = au(own, grid[i - 1], g), right = au(own, g, grid[i + 1]), both = au(own, grid[i - 1], grid[i + 1]);
      const joined = joinsAcross(s.text, g);
      const ruled = /^\p{M}/u.test(s.text.slice(g)) || joined;
      const sums = left + right === both;
      const a = B[index - 1], b = B[index + 1];
      const on = ink(own, a, b), without = ink(off, a, b);
      const inkSame = s.letterSpacing !== 0 || (on[0] === without[0] && on[1] === without[1] && on[2] === without[2]);
      const groupsSame = groups(grid[i - 1], g) + groups(g, grid[i + 1]) === groups(grid[i - 1], grid[i + 1]);
      if (ruled) tally.ruledOut++;
      else if (!sums) tally.sumFails++;
      else if (!inkSame) tally.inkFails++;
      else if (!groupsSame) tally.groupFails++;
      // What the text rule alone keeps out: a joined cut whose sums and groups hold all the same.
      if (joined && sums && inkSame && groupsSame) {
        tally.heldJoined++;
        if (isDom(before + au(own, start, g), dom[g] - index * spacingAu)) tally.heldJoinedIsDom++;
      }
      if (!ruled && sums && inkSame && groupsSame) {
        windows.push([start, g, width]);
        before += width; start = g; width = right;
        tally.held++;
        const domAu = dom[g] - index * spacingAu;
        const long = unit - au(own, g, s.text.length);
        const crosses = au(own, a, s.text.length) - au(own, g, s.text.length) - au(own, a, g);
        if (isDom(before, domAu)) tally.heldIsDom++;
        else if (tally.notDom.length < 12) tally.notDom.push({ phase, at: g, windows: before, dom: +domAu.toFixed(3), long, crosses, around: s.text.slice(a, b) });
        if (before === long) tally.heldIsLong++;
        if (isDom(long, domAu)) tally.longIsDom++;
        if (crosses === 0) tally.longCrossesNothing++;
      } else {
        width = start === grid[i - 1] ? both : au(own, start, grid[i + 1]);
      }
    }
    windows.push([start, s.text.length, width]);
    if (before + width === unit) tally.sumsToUnit++;
    if (phase !== 0) continue;
    // W2: inside the windows of the port's own grid.
    const inside = { windows: windows.length, offsets: 0, addUp: 0, windowIsDom: 0, windowIsLong: 0, longAddsUp: 0, longIsDom: 0, notDom: [] };
    let advance = 0;
    for (const [p, q, w] of windows) {
      for (let index = B.indexOf(p) + 1; B[index] < q; index++) {
        const t = B[index], a = B[index - 1];
        inside.offsets++;
        if (/^\p{M}/u.test(s.text.slice(t)) || joinsAcross(s.text, t)) continue;
        const crossesLong = au(own, a, s.text.length) - au(own, t, s.text.length) - au(own, a, t);
        const long = unit - au(own, t, s.text.length);
        const domAu = dom[t] - index * spacingAu;
        if (crossesLong === 0) { inside.longAddsUp++; if (isDom(long, domAu)) inside.longIsDom++; }
        const crosses = (a === p ? w : au(own, a, q)) - au(own, t, q) - au(own, a, t);
        if (crosses !== 0) continue;
        inside.addUp++;
        const value = advance + w - au(own, t, q);
        if (value === long) inside.windowIsLong++;
        if (isDom(value, domAu)) inside.windowIsDom++;
        else if (inside.notDom.length < 12) inside.notDom.push({ at: t, window: value, dom: +domAu.toFixed(3), long, crossesLong, around: s.text.slice(a, B[index + 1]) });
      }
      advance += w;
    }
    tally.inside = inside;
  }
  out.samples.push(tally);
}
return out;
`

export default function probes(): Probe[] {
  return [{
    id: 'gecko-windows W1 W2',
    spec: 'gecko-windows W1, W2: cuts inside long shaping units that Canvas sums accept, against the DOM advances and the long recipe',
    pageLang: 'en',
    observe: [{ kind: 'script', source: `${HELPERS}const SAMPLES = ${JSON.stringify(samples())};${W1}` }],
    browsers: ['firefox'],
    fontFixtures: ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu'],
    note: 'Measurement only.',
  }]
}
