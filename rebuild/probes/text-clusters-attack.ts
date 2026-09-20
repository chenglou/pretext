// A second look at TextMetrics.getTextClusters (Chrome behind the runtime flag ExtendedTextMetrics; text-clusters.ts is the
// first): the strings most likely to break the claim that a cluster's x is the DOM's own position. Speculative study of
// 2026-09-20; nothing here is for a shipped library. Every probe returns raw values; `checks` only say the flag was on.
//
// - `attack/presence` (X0): the method is on TextMetrics.prototype in this launch, and the user agent.
// - `attack/dom` (X1): per sample, the DOM's Range rect of every cluster Canvas reports (one line, white-space: pre),
//   beside the cluster's left edge and advance from Canvas, for the string as an application holds it (U+0020, a context
//   with default settings) and as the Blink port sends it (U+2028 for U+0020, textRendering optimizeLegibility). Samples:
//   kerning across a space, a ligature across an inline box edge, a string cut somewhere else than the DOM's shaping run,
//   RTL and mixed direction, letter spacing (positive, negative, in a cursive script), a font fallback edge, emoji
//   sequences, a combining mark on a space, CJK with punctuation, default-ignorable characters.
// - `attack/dom-fixtures` (X1 again, over the web font fixtures the lab uses: Amiri, Noto Naskh Arabic, Shantell Sans).
// - `attack/storage` (X2): the same Latin-1 text held as a one-byte and as a two-byte string, each on a canvas of its own
//   and then both on one canvas in both orders: totals and clusters.
// - `attack/one-byte-glyphs` (X3): over installed fonts, every Latin-1 character in a one-byte string (walked glyph by
//   glyph, shape_result.cc:925-929): clusters that share a start or are empty, which a caller of the API would meet.
// - `attack/float` (X4): strings past 256 px and past 4096 px: whether an x is a float32, whether right less left is a
//   multiple of 1/65536, whether the advances add up to the total, and the DOM's Range rects at the far end.
// - `attack/no-advance` (X5): which characters the prototype takes to have no advance (controls, default-ignorables,
//   U+FFFC) Canvas reports as clusters, in a one-byte and a two-byte string, by font.
// - `attack/long-item` (X7): one Canvas item of 60,000 and of 70,000 units: the starts Canvas reports past offset 65,535.
// - `attack/chat-cost` (X6): what measureText with one and with two getTextClusters calls costs on strings like a chat
//   message's shaping group (16px, about 110 units, past 256 px), beside measureText alone. The machine's load shows in it.
//
// Run under the browser lock, from the worktree, in the pinned Chrome with the flag:
//   python3 ~/github/pretext-rebuild/.artifacts/session/with-browser-lock.py spec-clusters-attack --browser=chrome -- \
//     bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/probes/text-clusters-attack.ts --out=<dir> \
//     --probe-timeout-ms=600000 --chrome-args=--enable-blink-features=ExtendedTextMetrics
import type { Probe } from './types.ts'

const spec = 'text-clusters-attack 2026-09-20'

// Strings are built from code points so the file stays ASCII.
const cps = (...list: number[]): string => String.fromCodePoint(...list)

// `html` is the block's content where it isn't one text node: the text's units in document order must equal `text`.
// `canvasFont` with `canvasScale`: the font the Canvas context gets where it isn't the DOM's (the Blink port measures at
// the zoomed size), and the factor from the DOM's CSS px to its px.
type Sample = { id: string; font: string; text: string; html?: string; direction?: string; letterSpacing?: string; wordSpacing?: string; lang?: string; canvasFont?: string; canvasScale?: number }

const ARABIC = cps(0x627, 0x644, 0x633, 0x644, 0x627, 0x645, 0x20, 0x639, 0x644, 0x64a, 0x643, 0x645, 0x20, 0x644, 0x644, 0x647)
const HEBREW = cps(0x5e9, 0x5dc, 0x5d5, 0x5dd, 0x20, 0x5e2, 0x5d5, 0x5dc, 0x5dd)
const FAMILY = cps(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466)

const INSTALLED: Sample[] = [
  { id: 'kern-across-space/times', font: '32px "Times New Roman"', text: 'AV To We. V, A Y o' },
  { id: 'kern-across-space/helvetica-neue', font: '32px "Helvetica Neue"', text: 'AV To We. V, A Y o' },
  { id: 'kern-across-space/avenir-next', font: '32px "Avenir Next"', text: 'AV To We. V, A Y o' },
  { id: 'kern-across-space/georgia', font: '32px Georgia', text: 'AV To We. V, A Y o' },
  { id: 'kern-across-space/hoefler', font: '32px "Hoefler Text"', text: 'AV To We. V, A Y o' },
  { id: 'kern-across-space/futura', font: '32px Futura', text: 'AV To We. V, A Y o' },
  { id: 'ligature/whole', font: '32px "Hoefler Text"', text: 'office affine fly' },
  { id: 'ligature/inline-box-edge', font: '32px "Hoefler Text"', text: 'office affine fly', html: 'of<span>fi</span>ce af<b style="font-weight:inherit">f</b>ine f<i style="font-style:inherit">l</i>y' },
  { id: 'ligature/inline-box-edge-padded', font: '32px "Hoefler Text"', text: 'office affine fly', html: 'of<span style="padding-left:3px">fi</span>ce af<span style="border-left:2px solid">f</span>ine f<span style="margin-left:1px">l</span>y' },
  { id: 'ligature/other-font-size-inside', font: '32px "Hoefler Text"', text: 'office', html: 'of<span style="font-size:31px">fi</span>ce' },
  { id: 'ligature/letter-spaced', font: '32px "Hoefler Text"', text: 'office affine fly', letterSpacing: '1.5px' },
  { id: 'letter-spacing/negative', font: '32px "Times New Roman"', text: 'AVAVA To We', letterSpacing: '-2.25px' },
  { id: 'letter-spacing/arabic', font: '32px "Geeza Pro"', text: ARABIC, direction: 'rtl', lang: 'ar', letterSpacing: '3px' },
  { id: 'word-spacing/latin', font: '32px "Times New Roman"', text: 'AV To We', wordSpacing: '7.3px' },
  { id: 'rtl/arabic-geeza', font: '32px "Geeza Pro"', text: ARABIC, direction: 'rtl', lang: 'ar' },
  { id: 'rtl/arabic-geeza-in-ltr', font: '32px "Geeza Pro"', text: ARABIC, lang: 'ar' },
  { id: 'rtl/arabic-sf', font: '32px "SF Arabic", "Geeza Pro"', text: ARABIC, direction: 'rtl', lang: 'ar' },
  { id: 'rtl/hebrew', font: '32px "Arial Hebrew"', text: HEBREW, direction: 'rtl', lang: 'he' },
  { id: 'mixed/latin-hebrew', font: '32px "Times New Roman"', text: 'abc ' + HEBREW + ' def 12 ' + cps(0x5d0, 0x5d1) + '34.' },
  { id: 'mixed/arabic-latin-rtl', font: '32px "Geeza Pro"', text: ARABIC + ' AV To (12) ' + cps(0x645, 0x631, 0x62d, 0x628, 0x627) + '!', direction: 'rtl', lang: 'ar' },
  { id: 'mixed/brackets-rtl', font: '32px "Times New Roman"', text: '(' + cps(0x5d0, 0x5d1) + ') [a] ' + cps(0x5d2) + '.', direction: 'rtl', lang: 'he' },
  { id: 'fallback/latin-cjk', font: '32px "Helvetica Neue"', text: 'abc' + cps(0x4e2d, 0x6587) + 'def' + cps(0x3042, 0x3001) + 'g' },
  { id: 'fallback/mark-not-in-font', font: '32px "Times New Roman"', text: 'a' + cps(0x361) + 'b to' + cps(0x1dc4) + ' x' + cps(0x20dd) + 'y' },
  { id: 'fallback/arabic-in-latin-font', font: '32px "Times New Roman"', text: 'ab ' + cps(0x644, 0x627, 0x645) + ' cd' },
  { id: 'fallback/symbol', font: '32px "Helvetica Neue"', text: 'a' + cps(0x2192) + 'b' + cps(0x2713) + 'c' + cps(0x222b) + 'd' },
  { id: 'emoji/sequences', font: '32px "Helvetica Neue"', text: 'a' + FAMILY + cps(0x1f1eb, 0x1f1f7, 0x1f44d, 0x1f3fd, 0x2764, 0xfe0f, 0x31, 0xfe0f, 0x20e3) + 'b' },
  { id: 'emoji/text-presentation', font: '32px "Helvetica Neue"', text: 'a' + cps(0x2764, 0xfe0e, 0x2764, 0x263a, 0xfe0f, 0x263a) + 'b' },
  { id: 'emoji/broken-zwj', font: '32px "Helvetica Neue"', text: cps(0x1f468, 0x200d) + 'a' + cps(0x200d, 0x1f469, 0x1f3fd, 0x1f3fd) + 'b' },
  { id: 'emoji/small-size', font: '13px "Helvetica Neue"', text: 'a' + FAMILY + cps(0x1f600, 0x1f1fa, 0x1f1f8) + 'b' },
  { id: 'emoji/small-size-asked-at-the-zoomed-size', font: '13px "Helvetica Neue"', canvasFont: '26px "Helvetica Neue"', canvasScale: 2, text: 'a' + FAMILY + cps(0x1f600, 0x1f1fa, 0x1f1f8) + 'b' },
  { id: 'kern-across-space/times-asked-at-the-zoomed-size', font: '16px "Times New Roman"', canvasFont: '32px "Times New Roman"', canvasScale: 2, text: 'AV To We. V, A Y o' },
  { id: 'mark-on-space/space', font: '32px "Times New Roman"', text: 'a ' + cps(0x301) + 'b ' + cps(0x308, 0x304) + 'c' },
  { id: 'mark-on-space/nbsp', font: '32px "Times New Roman"', text: 'a' + cps(0xa0, 0x301) + 'b' },
  { id: 'mark-on-space/leading', font: '32px "Times New Roman"', text: cps(0x301) + 'ab' },
  { id: 'mark-on-space/arabic', font: '32px "Geeza Pro"', text: cps(0x628, 0x20, 0x64e, 0x628), direction: 'rtl', lang: 'ar' },
  { id: 'cjk/punctuation', font: '32px "Hiragino Sans"', text: cps(0x300c, 0x65e5, 0x672c, 0x8a9e, 0x300d, 0x3001, 0xff08, 0x6587, 0xff09, 0x3002, 0x300c, 0x3042, 0x300d), lang: 'ja' },
  { id: 'cjk/punctuation-yu', font: '32px "YuGothic", "Hiragino Sans"', text: cps(0x300c, 0x65e5, 0x672c, 0x8a9e, 0x300d, 0x3001, 0xff08, 0x6587, 0xff09, 0x3002, 0x300c, 0x3042, 0x300d), lang: 'ja' },
  { id: 'cjk/pingfang', font: '32px "PingFang SC"', text: cps(0x4e2d, 0x6587, 0xff0c, 0x201c, 0x6d4b, 0x8bd5, 0x201d, 0x3002, 0xff08, 0x62ec, 0xff09), lang: 'zh' },
  { id: 'thai/marks', font: '32px Thonburi', text: cps(0xe01, 0xe33, 0xe25, 0xe31, 0xe07, 0xe17, 0xe35, 0xe48, 0xe19, 0xe49, 0xe33, 0x20, 0xe1b, 0xe39, 0xe48), lang: 'th' },
  { id: 'devanagari/conjuncts', font: '32px "Kohinoor Devanagari"', text: cps(0x915, 0x94d, 0x937, 0x924, 0x94d, 0x930, 0x93f, 0x92f, 0x20, 0x939, 0x93f, 0x928, 0x94d, 0x926, 0x940, 0x20, 0x930, 0x94d, 0x915), lang: 'hi' },
  { id: 'ignorable/soft-hyphen', font: '32px "Hoefler Text"', text: 'of' + cps(0xad) + 'fice af' + cps(0xad) + 'fine' },
  { id: 'ignorable/zwsp-wj-zwnj', font: '32px "Hoefler Text"', text: 'f' + cps(0x200b) + 'i f' + cps(0x2060) + 'i f' + cps(0x200c) + 'i ' + cps(0x200c) + 'x' },
  { id: 'ignorable/arabic-zwnj-zwj', font: '32px "Geeza Pro"', text: cps(0x628, 0x200c, 0x628, 0x20, 0x628, 0x200d, 0x20, 0x200d, 0x628), direction: 'rtl', lang: 'ar' },
  { id: 'tab-and-controls', font: '32px "Times New Roman"', text: 'a' + cps(0x9) + 'b' + cps(0x1) + 'c' + cps(0x85) + 'd' + cps(0xfffc) + 'e' },
  { id: 'system-ui', font: '17px system-ui', text: 'AV To We office fi 1/2 -> ' + cps(0x4e2d) },
  { id: 'small-size', font: '9.5px "Times New Roman"', text: 'AV To We office' },
]

const FIXTURES: Sample[] = [
  { id: 'amiri/rtl', font: '32px Amiri', text: ARABIC, direction: 'rtl', lang: 'ar' },
  { id: 'amiri/marks', font: '32px Amiri', text: cps(0x628, 0x650, 0x633, 0x652, 0x645, 0x650, 0x20, 0x627, 0x644, 0x644, 0x651, 0x647), direction: 'rtl', lang: 'ar' },
  { id: 'amiri/brackets', font: '32px Amiri', text: '(' + cps(0x645, 0x631) + ') [12] ' + cps(0x645) + '.', direction: 'rtl', lang: 'ar' },
  { id: 'amiri/letter-spaced', font: '32px Amiri', text: ARABIC, direction: 'rtl', lang: 'ar', letterSpacing: '2px' },
  { id: 'noto-naskh/rtl', font: '32px "Noto Naskh Arabic"', text: ARABIC, direction: 'rtl', lang: 'ar' },
  { id: 'nastaliq/rtl', font: '32px "Noto Nastaliq Urdu"', text: cps(0x627, 0x631, 0x62f, 0x648, 0x20, 0x632, 0x628, 0x627, 0x646, 0x20, 0x6a9, 0x6cc), direction: 'rtl', lang: 'ur' },
  { id: 'shantell/ligatures', font: '32px "Shantell Sans"', text: 'office fi ffl of' + cps(0xad) + 'fice f' + cps(0xad) + 'fi' },
  { id: 'shantell/kerning', font: '32px "Shantell Sans"', text: 'AV To We. V, A Y o' },
]

const DOM = String.raw`
  const LS = String.fromCharCode(0x2028);
  const clustersOf = (sample, text, port) => {
    const ctx = new OffscreenCanvas(1, 1).getContext('2d');
    ctx.lang = sample.lang || 'en';
    ctx.font = sample.canvasFont || sample.font;
    if (port) ctx.textRendering = 'optimizeLegibility';
    if (sample.direction) ctx.direction = sample.direction;
    if (sample.letterSpacing) ctx.letterSpacing = sample.letterSpacing;
    if (sample.wordSpacing && !port) ctx.wordSpacing = sample.wordSpacing;
    const m = ctx.measureText(text);
    const left = m.getTextClusters({ align: 'left' });
    const right = m.getTextClusters({ align: 'right' });
    // An x counts from the alignment point: the string's right end in an RTL context with the default textAlign.
    const shift = sample.direction === 'rtl' ? m.width : 0;
    const scale = sample.canvasScale || 1;
    return { width: m.width / scale, clusters: left.map((c, i) => ({ start: c.start, end: c.end, left: (c.x + shift) / scale, advance: (right[i].x - c.x) / scale })) };
  };
  const out = [];
  for (const sample of SAMPLES) {
    const div = document.createElement('div');
    div.lang = sample.lang || 'en';
    div.setAttribute('style', 'position:absolute;left:0;top:0;white-space:pre;font:' + sample.font + ';direction:' + (sample.direction || 'ltr') +
      ';letter-spacing:' + (sample.letterSpacing || 'normal') + ';word-spacing:' + (sample.wordSpacing || 'normal'));
    if (sample.html) div.innerHTML = sample.html; else div.textContent = sample.text;
    host.appendChild(div);
    // Every text node with the offset of its first unit in the block's text.
    const nodes = [];
    const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    let at = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push({ node: n, start: at }); at += n.data.length; }
    const domText = nodes.map(n => n.node.data).join('');
    const point = offset => {
      for (let i = nodes.length - 1; i >= 0; i--) if (offset >= nodes[i].start && (offset > nodes[i].start || i === 0)) return [nodes[i].node, offset - nodes[i].start];
      return [nodes[0].node, 0];
    };
    const box = div.getBoundingClientRect();
    const rectOf = (a, b) => {
      const range = document.createRange();
      // A start at a node's end belongs to the next node's start, so a rect doesn't take the box edge between them in.
      let s = point(a);
      for (let i = 0; i < nodes.length; i++) if (nodes[i].start === a) s = [nodes[i].node, 0];
      const e = point(b);
      range.setStart(s[0], s[1]);
      range.setEnd(e[0], e[1]);
      const rects = [...range.getClientRects()].map(r => [r.left - box.left, r.width]);
      return rects;
    };
    const forms = {};
    for (const [name, text, port] of [['plain', sample.text, false], ['port', sample.text.replaceAll(' ', LS), true]]) {
      const got = clustersOf(sample, text, port);
      forms[name] = { width: got.width, clusters: got.clusters.map(c => ({ ...c, dom: rectOf(c.start, c.end) })) };
    }
    // The DOM's own caret stops, per unit, for the units Canvas reports nothing of.
    const units = [];
    for (let i = 0; i < sample.text.length; i++) units.push(rectOf(i, i + 1));
    out.push({ id: sample.id, font: sample.font, settings: { direction: sample.direction || 'ltr', letterSpacing: sample.letterSpacing || null, wordSpacing: sample.wordSpacing || null }, textMatches: domText === sample.text,
      codePoints: [...sample.text].map(ch => ch.codePointAt(0).toString(16)), length: sample.text.length, domWidth: box.width, dpr: devicePixelRatio, forms, units });
    div.remove();
  }
  return { has: 'getTextClusters' in TextMetrics.prototype, samples: out, checks: [{ name: 'getTextClusters is on TextMetrics.prototype in this launch', expected: true, measured: 'getTextClusters' in TextMetrics.prototype }] };
`

const STORAGE = String.raw`
  // A one-byte string: single characters joined. A two-byte string: a split part of a string that holds a wide character
  // (13 units or more stay two-byte; blink-storage.ts S1).
  const oneByte = text => { let s = ''; for (const ch of text) s += ch; return s; };
  const twoByte = text => (text + String.fromCharCode(0x4e2d)).split(String.fromCharCode(0x4e2d))[0];
  const ask = (ctx, text) => {
    const m = ctx.measureText(text);
    const left = m.getTextClusters({ align: 'left' });
    const right = m.getTextClusters({ align: 'right' });
    return { width: m.width, clusters: left.map((c, i) => [c.start, c.end, c.x, right[i].x - c.x]) };
  };
  const fresh = sample => { const ctx = new OffscreenCanvas(1, 1).getContext('2d'); ctx.lang = 'en'; ctx.font = sample.font; ctx.textRendering = 'optimizeLegibility'; return ctx; };
  const out = [];
  for (const sample of SAMPLES) {
    const a = oneByte(sample.text), b = twoByte(sample.text);
    const alone = { oneByte: ask(fresh(sample), a), twoByte: ask(fresh(sample), b) };
    const c1 = fresh(sample);
    const oneFirst = { oneByte: ask(c1, a), twoByte: ask(c1, b) };
    const c2 = fresh(sample);
    const twoFirst = { twoByte: ask(c2, b), oneByte: ask(c2, a) };
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    out.push({ id: sample.id, font: sample.font, length: sample.text.length, alone, oneFirst, twoFirst,
      widthsDiffer: alone.oneByte.width !== alone.twoByte.width, clustersDiffer: !same(alone.oneByte.clusters, alone.twoByte.clusters),
      clusterCounts: [alone.oneByte.clusters.length, alone.twoByte.clusters.length],
      firstShapingAnswersBoth: same(oneFirst.twoByte, oneFirst.oneByte) && same(twoFirst.oneByte, twoFirst.twoByte) });
  }
  return { has: 'getTextClusters' in TextMetrics.prototype, samples: out };
`

const STORAGE_SAMPLES: Array<{ id: string; font: string; text: string }> = [
  { id: 'brackets', font: '48px Amiri', text: ')))))))))))))))' },
  { id: 'square-brackets', font: '48px Amiri', text: '[[[[[[[[[[[[[[' },
  { id: 'guillemets', font: '48px Amiri', text: cps(0xab, 0xbb, 0xab, 0xbb, 0xab, 0xbb, 0xab, 0xbb, 0xab, 0xbb, 0xab, 0xbb, 0xab, 0xbb, 0xab, 0xbb) },
  { id: 'mixed-brackets', font: '48px Amiri', text: '(12)[34]{56}789' },
  { id: 'latin-kerning', font: '32px "Times New Roman"', text: 'AVAVA To We. V, A' },
  { id: 'latin-ligatures', font: '32px "Hoefler Text"', text: 'office affine fly' },
  { id: 'latin-1-letters', font: '32px "Times New Roman"', text: 'na' + cps(0xef) + 've caf' + cps(0xe9) + ' T' + cps(0xfc) + 'r ' + cps(0xbd) + cps(0xb2) },
  { id: 'control-inside', font: '32px "Times New Roman"', text: 'abcdefg' + cps(0x1) + 'hijklmn' + cps(0x85) + 'op' },
  { id: 'digits-slash', font: '32px "Helvetica Neue"', text: '1/2 3/4 (12) 5-6 7:8' },
  { id: 'noto-naskh-brackets', font: '48px "Noto Naskh Arabic"', text: '(12)[34]{56}789' },
]

const ONE_BYTE_GLYPHS = String.raw`
  const oneByte = text => { let s = ''; for (const ch of text) s += ch; return s; };
  const out = [];
  for (const family of FAMILIES) {
    const ctx = new OffscreenCanvas(1, 1).getContext('2d');
    ctx.lang = 'en';
    ctx.font = '32px ' + family;
    ctx.textRendering = 'optimizeLegibility';
    const odd = [];
    let asked = 0;
    for (let cp = 0x21; cp <= 0xff; cp++) {
      if (cp >= 0x7f && cp <= 0xa0 || cp === 0xad) continue;
      const text = oneByte('n' + String.fromCharCode(cp) + 'n');
      const list = ctx.measureText(text).getTextClusters({ align: 'left' });
      asked++;
      let strange = list.length !== 3;
      for (let i = 0; i < list.length; i++) if (list[i].end <= list[i].start || (i > 0 && list[i].start === list[i - 1].start)) strange = true;
      if (strange) odd.push({ cp: cp.toString(16), clusters: list.map(c => [c.start, c.end, c.x]) });
    }
    // Pairs that ligate or decompose: a one-byte string is walked glyph by glyph, so a ligature is one entry.
    const pairs = [];
    for (const text of ['fi', 'ffl', 'fj', 'Th', 'ct', 'st', '1/2', '--', '->', '...', '!=']) {
      const list = ctx.measureText(oneByte('n' + text + 'n')).getTextClusters({ align: 'left' });
      if (list.length !== text.length + 2) pairs.push({ text, clusters: list.map(c => [c.start, c.end, c.x]) });
    }
    out.push({ family, asked, odd, pairs });
  }
  return { has: 'getTextClusters' in TextMetrics.prototype, families: out };
`

const FAMILIES = ['"Times New Roman"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'Georgia', '"Hoefler Text"', 'Futura', '"Avenir Next"', 'Optima', 'Palatino', 'Baskerville', 'Didot', 'Menlo', 'Monaco', '"Courier New"',
  'Verdana', '"Trebuchet MS"', '"Gill Sans"', 'Zapfino', '"Snell Roundhand"', '"Apple Chancery"', 'Papyrus', '"Marker Felt"', '"Chalkboard SE"', '"American Typewriter"', 'Copperplate', '"SF Pro Text"', 'system-ui',
  '"Geeza Pro"', '"PingFang SC"', '"Hiragino Sans"', 'Thonburi', '"Kohinoor Devanagari"', '"Shantell Sans"', 'Amiri']

const FLOAT = String.raw`
  const LS = String.fromCharCode(0x2028);
  const out = [];
  for (const sample of SAMPLES) {
    const ctx = new OffscreenCanvas(1, 1).getContext('2d');
    ctx.lang = 'en';
    ctx.font = sample.font;
    ctx.textRendering = 'optimizeLegibility';
    if (sample.textAlign) ctx.textAlign = sample.textAlign;
    const text = sample.text.replaceAll(' ', LS);
    const m = ctx.measureText(text);
    const left = m.getTextClusters({ align: 'left' });
    const right = m.getTextClusters({ align: 'right' });
    const origin = left[0].x;
    let notFloat32 = 0, advanceNot16 = 0, leftNot16 = 0, sum16 = 0, sumsDiffer = 0, firstSumDiffers = -1;
    for (let i = 0; i < left.length; i++) {
      if (Math.fround(left[i].x - 0) !== left[i].x && !sample.textAlign) notFloat32++;
      const advance16 = (right[i].x - left[i].x) * 65536;
      if (advance16 !== Math.round(advance16)) advanceNot16++;
      const left16 = (left[i].x - origin) * 65536;
      if (left16 !== Math.round(left16)) leftNot16++;
      // The exact sum of the advances before the cluster beside the x Canvas gives (a float32 past 256 px).
      if (sum16 !== left16) { sumsDiffer++; if (firstSumDiffers < 0) firstSumDiffers = i; }
      sum16 += Math.round(advance16);
    }
    // The DOM's Range rects at the same clusters, on one line, with U+0020.
    const div = document.createElement('div');
    div.lang = 'en';
    div.setAttribute('style', 'position:absolute;left:0;top:0;white-space:pre;font:' + sample.font);
    div.textContent = sample.text;
    host.appendChild(div);
    const node = div.firstChild;
    const box = div.getBoundingClientRect();
    let domAgreesWithSum = 0, domAgreesWithX = 0, compared = 0;
    const worst = [];
    let run16 = 0;
    const STEP = 1 / (64 * devicePixelRatio);
    for (let i = 0; i < left.length; i++) {
      const range = document.createRange();
      range.setStart(node, left[i].start);
      range.setEnd(node, left[i].end);
      const dom = range.getBoundingClientRect().left - box.left;
      const fromSum = Math.floor(run16 / 65536 / STEP) * STEP;
      const fromX = Math.floor((left[i].x - origin) / STEP) * STEP;
      compared++;
      if (dom === fromSum) domAgreesWithSum++;
      if (dom === fromX) domAgreesWithX++;
      if (dom !== fromSum && worst.length < 8) worst.push({ i, start: left[i].start, dom, fromSum, fromX });
      run16 += Math.round((right[i].x - left[i].x) * 65536);
    }
    div.remove();
    out.push({ id: sample.id, font: sample.font, length: text.length, width: m.width, clusters: left.length, notFloat32, advanceNot16, leftNot16, sumsDiffer, firstSumDiffers, total16: sum16, widthTimes65536: m.width * 65536,
      dom: { compared, agreesWithTheAdvanceSum: domAgreesWithSum, agreesWithX: domAgreesWithX, domWidth: box.width, worst } });
  }
  return { has: 'getTextClusters' in TextMetrics.prototype, dpr: devicePixelRatio, samples: out };
`

const SENTENCE = 'The quick brown fox jumps over the lazy dog, AV To We. office affine fly; '
const FLOAT_SAMPLES: Array<{ id: string; font: string; text: string; textAlign?: string }> = [
  { id: 'below-256', font: '16px "Times New Roman"', text: SENTENCE.slice(0, 30) },
  { id: 'past-256', font: '16px "Times New Roman"', text: SENTENCE.repeat(2) },
  { id: 'past-1024', font: '16px "Times New Roman"', text: SENTENCE.repeat(4) },
  { id: 'past-4096', font: '16px "Times New Roman"', text: SENTENCE.repeat(12) },
  { id: 'past-16384', font: '16px "Helvetica Neue"', text: SENTENCE.repeat(40) },
  { id: 'past-4096-centered', font: '16px "Times New Roman"', text: SENTENCE.repeat(12), textAlign: 'center' },
  { id: 'fractional-size', font: '13.37px Georgia', text: SENTENCE.repeat(6) },
]

const NO_ADVANCE = String.raw`
  const oneByte = text => { let s = ''; for (const ch of text) s += ch; return s; };
  const twoByte = text => (text + String.fromCharCode(0x4e2d)).split(String.fromCharCode(0x4e2d))[0];
  const out = [];
  for (const family of FAMILIES) {
    // A canvas per storage: a canvas's first shaping of a text answers both storages (attack/storage).
    const contexts = {};
    for (const form of ['one-byte', 'two-byte']) {
      const ctx = new OffscreenCanvas(1, 1).getContext('2d');
      ctx.lang = 'en';
      ctx.font = '32px ' + family;
      ctx.textRendering = 'optimizeLegibility';
      contexts[form] = ctx;
    }
    const rows = [];
    for (const cp of CODE_POINTS) {
      const ch = String.fromCodePoint(cp);
      const body = 'abcdef' + ch + 'ghijklm';
      const forms = cp <= 0xff ? [['one-byte', oneByte(body)], ['two-byte', twoByte(body)]] : [['two-byte', body]];
      for (const [form, text] of forms) {
        const m = contexts[form].measureText(text);
        const list = m.getTextClusters({ align: 'left' });
        const right = m.getTextClusters({ align: 'right' });
        const at = list.findIndex(c => c.start === 6);
        rows.push({ cp: cp.toString(16), form, reported: at >= 0, advance: at >= 0 ? right[at].x - list[at].x : null, clusters: list.length, units: text.length });
      }
    }
    out.push({ family, rows });
  }
  return { has: 'getTextClusters' in TextMetrics.prototype, families: out };
`

const NO_ADVANCE_CODE_POINTS = [0x0, 0x1, 0x8, 0x9, 0xa, 0xb, 0xc, 0xd, 0x1b, 0x1f, 0x7f, 0x80, 0x85, 0x9f, 0xad, 0x34f, 0x61c, 0x115f, 0x17b4, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x2028, 0x2029, 0x202a, 0x202e, 0x2060, 0x2061,
  0x2066, 0x2069, 0x3164, 0xfe00, 0xfe0f, 0xfeff, 0xffa0, 0xfff9, 0xfffc, 0xfffd, 0x1d173, 0xe0001, 0xe0020, 0xe0100]

// What the prototype's table costs on a string like a chat message's one shaping group: 16px Helvetica Neue, about 110
// units, U+2028 for U+0020, past 256 px, so getTextClusters is called twice (left and right). Distinct strings, first asks.
const CHAT_COST = String.raw`
  const WORDS = 'the of and to in that was his he it with is for as had you not be her on at by which have or from this him but all she they were my are me one their so an said them we who would been will no when there if more out up into do any your what has man could other than our some very time upon about may its only now like little then can should made did us such a great before must two these see know over much down after first good men own never most old shall day where those came come himself way work life without go make well through being long say might how am too even again many back here think every people went same last thought away under take found hand eye still place while just also young yet though against things get ever part nothing'.split(' ');
  const LS = String.fromCharCode(0x2028);
  const N = 3000;
  let serial = 0;
  const strings = () => { const list = []; for (let i = 0; i < N; i++) { let s = 'w' + (serial++).toString(36); for (let w = i; s.length < 110; w++) s += LS + WORDS[(w * 7 + i) % WORDS.length]; list.push(s.slice(0, 110)); } return list; };
  const fresh = () => { const ctx = new OffscreenCanvas(1, 1).getContext('2d'); ctx.lang = 'en'; ctx.font = '16px "Helvetica Neue"'; ctx.textRendering = 'optimizeLegibility'; return ctx; };
  const time = run => { const start = performance.now(); const sink = run(); return { ms: performance.now() - start, sink }; };
  const rounds = [];
  for (let round = 0; round < 5; round++) {
    const a = strings(), b = strings(), c = strings(), d = strings();
    const ctxA = fresh(), ctxB = fresh(), ctxC = fresh(), ctxD = fresh();
    const width = time(() => { let sum = 0; for (let i = 0; i < N; i++) sum += ctxA.measureText(a[i]).width; return sum; });
    const one = time(() => { let sum = 0; for (let i = 0; i < N; i++) { const m = ctxB.measureText(b[i]); const list = m.getTextClusters({ align: 'left' }); for (let j = 0; j < list.length; j++) sum += list[j].start + list[j].x; } return sum; });
    const two = time(() => { let sum = 0; for (let i = 0; i < N; i++) { const m = ctxC.measureText(c[i]); const list = m.getTextClusters({ align: 'left' }); const other = m.getTextClusters({ align: 'right' }); for (let j = 0; j < list.length; j++) sum += list[j].start + list[j].x + other[j].x; } return sum; });
    const unread = time(() => { let sum = 0; for (let i = 0; i < N; i++) { const m = ctxD.measureText(d[i]); sum += m.getTextClusters({ align: 'left' }).length + m.getTextClusters({ align: 'right' }).length; } return sum; });
    const clusters = ctxB.measureText(b[0]).getTextClusters().length;
    rounds.push({ usPerString: { measureTextAlone: width.ms * 1000 / N, withOneCallRead: one.ms * 1000 / N, withTwoCallsRead: two.ms * 1000 / N, withTwoCallsUnread: unread.ms * 1000 / N }, clustersInFirstString: clusters, widthOfFirst: ctxB.measureText(b[0]).width });
  }
  return { has: 'getTextClusters' in TextMetrics.prototype, n: N, crossOriginIsolated, rounds };
`

// A Canvas item longer than 65,535 units: ForEachGraphemeClusters keeps character indices in a uint16_t
// (shape_result.cc:895-903), so what a caller gets for the clusters past that offset.
const LONG_ITEM = String.raw`
  const out = [];
  for (const [form, unit] of [['one-byte', 'a'], ['two-byte', String.fromCharCode(0x3b1)]]) {
    for (const length of [60000, 70000]) {
      const ctx = new OffscreenCanvas(1, 1).getContext('2d');
      ctx.lang = 'en';
      ctx.font = '4px "Times New Roman"';
      const text = unit.repeat(length);
      const list = ctx.measureText(text).getTextClusters({ align: 'left' });
      let maxStart = 0, maxEnd = 0, notIdentity = 0, firstNotIdentity = -1, decreasingX = 0;
      for (let i = 0; i < list.length; i++) {
        if (list[i].start > maxStart) maxStart = list[i].start;
        if (list[i].end > maxEnd) maxEnd = list[i].end;
        if (list[i].start !== i) { notIdentity++; if (firstNotIdentity < 0) firstNotIdentity = i; }
        if (i > 0 && list[i].x < list[i - 1].x) decreasingX++;
      }
      out.push({ form, length, clusters: list.length, maxStart, maxEnd, notIdentity, firstNotIdentity, decreasingX, around: firstNotIdentity < 0 ? [] : list.slice(Math.max(0, firstNotIdentity - 1), firstNotIdentity + 3).map(c => [c.start, c.end, c.x]) });
    }
  }
  return { has: 'getTextClusters' in TextMetrics.prototype, rows: out };
`

const PRESENCE = String.raw`
  const has = typeof TextMetrics !== 'undefined' && 'getTextClusters' in TextMetrics.prototype;
  return { userAgent: navigator.userAgent, has, dpr: devicePixelRatio, checks: [{ name: 'getTextClusters is on TextMetrics.prototype in this launch', expected: true, measured: has }] };
`

export default [
  { id: 'text-clusters-attack/presence', spec, pageLang: 'en', html: '<div></div>', observe: [{ kind: 'env' }, { kind: 'script', source: PRESENCE }] },
  { id: 'text-clusters-attack/dom', spec, pageLang: 'en', html: '<div></div>', hostWidth: 40000, observe: [{ kind: 'script', source: `const SAMPLES = ${JSON.stringify(INSTALLED)};\n${DOM}` }] },
  { id: 'text-clusters-attack/dom-fixtures', spec, pageLang: 'en', html: '<div></div>', hostWidth: 40000, fontFixtures: ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'Shantell Sans'], observe: [{ kind: 'script', source: `const SAMPLES = ${JSON.stringify(FIXTURES)};\n${DOM}` }] },
  { id: 'text-clusters-attack/storage', spec, pageLang: 'en', html: '<div></div>', fontFixtures: ['Amiri', 'Noto Naskh Arabic'], observe: [{ kind: 'script', source: `const SAMPLES = ${JSON.stringify(STORAGE_SAMPLES)};\n${STORAGE}` }] },
  { id: 'text-clusters-attack/one-byte-glyphs', spec, pageLang: 'en', html: '<div></div>', fontFixtures: ['Amiri', 'Shantell Sans'], observe: [{ kind: 'script', source: `const FAMILIES = ${JSON.stringify(FAMILIES)};\n${ONE_BYTE_GLYPHS}` }] },
  { id: 'text-clusters-attack/float', spec, pageLang: 'en', html: '<div></div>', hostWidth: 40000, observe: [{ kind: 'script', source: `const SAMPLES = ${JSON.stringify(FLOAT_SAMPLES)};\n${FLOAT}` }] },
  { id: 'text-clusters-attack/no-advance', spec, pageLang: 'en', html: '<div></div>', fontFixtures: ['Amiri', 'Shantell Sans'], observe: [{ kind: 'script', source: `const FAMILIES = ${JSON.stringify(FAMILIES.slice(0, 8).concat(['"Geeza Pro"', '"PingFang SC"', 'Menlo', 'Amiri', '"Shantell Sans"']))};\nconst CODE_POINTS = ${JSON.stringify(NO_ADVANCE_CODE_POINTS)};\n${NO_ADVANCE}` }] },
  { id: 'text-clusters-attack/chat-cost', spec, pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: CHAT_COST }] },
  { id: 'text-clusters-attack/long-item', spec, pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: LONG_ITEM }] },
] satisfies Probe[]
