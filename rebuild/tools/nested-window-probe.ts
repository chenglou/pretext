// A probe of the cut predictor's premise on real fonts (src/engines/blink/shape.ts windowAdjust16, predictedWindow): a
// string is never narrower than a window nested inside it, so the totals of the windows the wide window's shrink tries
// never rise. For long runs of many scripts and fonts at several zoomed sizes and letter spacings, it takes offsets
// through the run, builds the shrink's windows around each as windowAdjust16 does (the longer side loses half its
// distance to the offset, at grapheme edges, down to the grapheme next to it), measures every window on one Canvas, and
// counts the windows wider than the one before them, and the shrinks where a window below 256 px comes before one of
// 256 px or more (where the prediction can take another window than the loop). Counts and a few examples, no times.
//
//   NESTED_FONTS=<families.json> bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/nested-window-probe.ts \
//     --out=<dir> --probe-timeout-ms=3000000 --stall-ms=3000000   (under a Chrome slot of the browser lock)
//
// families.json: an array of family names, `!` before a generic keyword. The size is the zoomed one: Canvas measures in
// the px its font string says, which is what the port asks at a zoom (CSS size times the device pixel ratio).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'

const BODY = String.raw`
const ctx = new OffscreenCanvas(1, 1).getContext('2d');
const probe = new OffscreenCanvas(1, 1).getContext('2d');
const measured = (font) => { probe.font = font; return probe.measureText('mmmmmmmmmmlliWAVA fi 123').width; };
const resolves = (family) => measured('72px ' + family + ', monospace') !== measured('72px monospace') || measured('72px ' + family + ', serif') !== measured('72px serif');
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const LIMIT = 256;
const out = [];
for (let f = 0; f < FONTS.length; f++) {
  const family = FONTS[f].startsWith('!') ? FONTS[f].slice(1) : '"' + FONTS[f] + '"';
  if (!resolves(family)) { out.push({ family: FONTS[f], resolves: false }); continue; }
  const row = { family: FONTS[f], resolves: true, shrinks: 0, windows: 0, wider: 0, widerBy: 0, crossings: 0, bySpacing: {}, examples: [] };
  for (let t = 0; t < TEXTS.length; t++) {
    const text = TEXTS[t].text;
    const edges = [];
    for (const s of segmenter.segment(text)) edges.push(s.index);
    edges.push(text.length);
    // Grapheme edge at or before k, and after k.
    const atOrBefore = (k) => { let lo = 0, hi = edges.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (edges[m] <= k) lo = m; else hi = m - 1; } return edges[lo]; };
    const after = (k) => { let lo = 0, hi = edges.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (edges[m] > k) hi = m; else lo = m + 1; } return edges[lo]; };
    for (let z = 0; z < SIZES.length; z++) for (let s = 0; s < SPACINGS.length; s++) {
      ctx.font = SIZES[z] + 'px ' + family;
      ctx.letterSpacing = SPACINGS[s];
      ctx.direction = TEXTS[t].rtl ? 'rtl' : 'ltr';
      const cache = new Map();
      const tally = row.bySpacing[SPACINGS[s]] ??= { shrinks: 0, wider: 0, widerBy: 0, crossings: 0, crossingsByText: {} };
      // Joined letters keep their forms at a window's edge through U+200D, as the port measures them (shape.ts canvasString).
      const joins = (c) => (c >= 0x620 && c <= 0x64a) || (c >= 0x66e && c <= 0x6d3) || (c >= 0x6fa && c <= 0x6ff);
      const W = (a, b) => {
        const key = a * 65536 + b;
        let w = cache.get(key);
        if (w === undefined) {
          const before = a > 0 && joins(text.charCodeAt(a - 1)) && joins(text.charCodeAt(a)) ? '\u200d' : '';
          const afterJ = b < text.length && joins(text.charCodeAt(b - 1)) && joins(text.charCodeAt(b)) ? '\u200d' : '';
          w = ctx.measureText(before + text.slice(a, b).replaceAll(' ', '\u2028') + afterJ).width;
          cache.set(key, w);
        }
        return w;
      };
      for (let q = 1; q < OFFSETS; q++) {
        const k = atOrBefore(Math.floor(q * text.length / OFFSETS));
        if (k <= 0 || k >= text.length) continue;
        const nearA = atOrBefore(k - 1), nearB = after(k);
        const as = [0], bs = [text.length];
        for (let a = 0, b = text.length; a < nearA || b > nearB;) {
          if (a < nearA && (k - a >= b - k || b <= nearB)) { let next = atOrBefore(a + ((k - a + 1) >> 1)); if (next <= a) next = after(a); a = Math.min(nearA, next); }
          else { let next = after(b - ((b - k + 1) >> 1) - 1); if (next >= b) next = atOrBefore(b - 1); b = Math.max(nearB, next); }
          as.push(a); bs.push(b);
        }
        row.shrinks++; tally.shrinks++;
        let firstBelow = -1, crossed = false;
        for (let i = 0; i < as.length; i++) {
          const w = W(as[i], bs[i]);
          row.windows++;
          if (i > 0) {
            const before = W(as[i - 1], bs[i - 1]);
            if (w > before) {
              row.wider++; tally.wider++;
              if (w - before > row.widerBy) row.widerBy = w - before;
              if (w - before > tally.widerBy) tally.widerBy = w - before;
              if (row.examples.length < 6 && (SPACINGS[s] === '0px' || SPACINGS[s] === '0.3em')) row.examples.push({ text: TEXTS[t].name, size: SIZES[z], spacing: SPACINGS[s], outer: text.slice(as[i - 1], bs[i - 1]), outerWidth: before, inner: text.slice(as[i], bs[i]), innerWidth: w });
            }
          }
          if (w < LIMIT && firstBelow < 0) firstBelow = i;
          else if (w >= LIMIT && firstBelow >= 0) crossed = true;
        }
        if (crossed) { row.crossings++; tally.crossings++; tally.crossingsByText[TEXTS[t].name] = (tally.crossingsByText[TEXTS[t].name] ?? 0) + 1; if (row.examples.length < 12 && (SPACINGS[s] === '0px' || SPACINGS[s] === '0.3em')) row.examples.push({ crossing: true, text: TEXTS[t].name, size: SIZES[z], spacing: SPACINGS[s], k, windows: as.map((a, i) => [a, bs[i], W(a, bs[i])]) }); }
      }
      if (cache.size > 20000) cache.clear();
    }
  }
  out.push(row);
  if (f % 2 === 1) await new Promise(r => setTimeout(r, 0));
}
return { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, sizes: SIZES, spacings: SPACINGS, fonts: out };
`

const ch = (...codes: number[]): string => String.fromCodePoint(...codes)
const run = (unit: string, n: number): string => { let s = ''; while (s.length < n) s += unit; return s.slice(0, n) }

// Runs with no space, of many scripts, and a few with spaces.
export const TEXTS: Array<{ name: string; rtl: boolean; text: string }> = [
  { name: 'latin', rtl: false, text: run('officeaffluentfjordZapfinowafflecoffeetrufflefiveefficientofficialsfiledthefinalaffidavit', 160) },
  { name: 'latin-mixed-widths', rtl: false, text: run('WWWWiiiiMMMMllll.,;:ffffTTTTyyyy', 160) },
  { name: 'arabic', rtl: true, text: run('مرحبابالعالمهذانصعربيطويلبدونمسافاتلاختبارالتفافالأسطرالعربيةالجميلةلاللهلالالا', 150) },
  { name: 'arabic-tanween', rtl: true, text: run('كتاباًجميلاًلاًماًسلاماًعلماًنوراًفيًّبًّ', 120) },
  { name: 'urdu', rtl: true, text: run('یہاردومیںایکلمبامتنہےجسمیںکوئیخالیجگہنہیںہےپاکستانکیقومیزبانبنےنےیے', 150) },
  { name: 'arabic-words', rtl: true, text: 'مرحبا بالعالم هذا نص عربي للاختبار اللغة العربية جميلة جدا وفي البداية كان الخط العربي يكتب بلا نقاط ثم تطور عبر القرون' },
  { name: 'devanagari', rtl: false, text: run('नमस्तेदुनियायहहिन्दीमेंएकलंबाशब्दहैजिसमेंकोईरिक्तस्थाननहींहैक्षत्रियश्रीराजभाषा', 150) },
  { name: 'myanmar', rtl: false, text: run('မြန်မာဘာသာစကားသည်မြန်မာနိုင်ငံ၏ရုံးသုံးဘာသာစကားဖြစ်သည်ကျွန်ုပ်တို့စမ်းသပ်နေသည်', 150) },
  { name: 'khmer', rtl: false, text: run('ភាសាខ្មែរគឺជាភាសាផ្លូវការរបស់ប្រទេសកម្ពុជាយើងកំពុងសាកល្បងការបំបែកបន្ទាត់', 150) },
  { name: 'thai', rtl: false, text: run('สวัสดีชาวโลกนี่คือข้อความภาษาไทยที่ยาวมากโดยไม่มีช่องว่างเพื่อทดสอบการตัดคำ', 150) },
  { name: 'han', rtl: false, text: run('日本語の文章と中文混排测试这是一个很长的段落没有空格的文本我们需要测试换行的行为', 90) },
  { name: 'emoji', rtl: false, text: run(ch(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466, 0x1f3f3, 0xfe0f, 0x200d, 0x1f308, 0x1f1ef, 0x1f1f5, 0x1f44d, 0x1f3fd, 0x2764, 0xfe0f, 0x200d, 0x1f525), 150) },
  { name: 'prose', rtl: false, text: 'To be, or not to be: that is the question. Whether tis nobler in the mind to suffer the slings and arrows of outrageous fortune, or to take arms' },
]
const SIZES = [32, 64, 128, 256]
const SPACINGS = ['0px', '-0.1em', '-0.3em', '-0.5em', '0.3em']
const OFFSETS = 12

export default function nestedWindowProbes(): Probe[] {
  const fontsPath = process.env['NESTED_FONTS']
  if (fontsPath === undefined) throw new Error('NESTED_FONTS names the families file')
  const constants = `const FONTS = ${readFileSync(resolve(fontsPath), 'utf8')};\nconst TEXTS = ${JSON.stringify(TEXTS)};\nconst SIZES = ${JSON.stringify(SIZES)};\nconst SPACINGS = ${JSON.stringify(SPACINGS)};\nconst OFFSETS = ${OFFSETS};`
  return [{
    id: 'nested-window N1', spec: 'the cut predictor\'s premise: is a string ever narrower than a window of the wide window\'s shrink nested inside it', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${constants}\n${BODY}` }],
  }]
}
