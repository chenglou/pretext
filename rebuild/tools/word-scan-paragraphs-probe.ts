// Gecko's word scan (src/engines/gecko/lines.ts wordScan) against the engine's loop and against Firefox itself, on
// paragraphs of main's corpora (Thai, Khmer, Myanmar with their dictionary breaks, Devanagari, Urdu, Arabic, Hebrew,
// Korean, Japanese, Chinese, English, the mixed app text) and the Lao, Tibetan and Mongolian samples, in fonts that draw
// them, under overflow-wrap normal, break-word and anywhere. Each paragraph is laid out at drawn widths and, for each,
// at the smallest width where the first line keeps its end: there the line's last word only just fits, and where it
// holds break candidates of its own (a Thai phrase, a line's first word under break-word) the word scan passes over them
// on its premise alone. At every width:
// - the tree's plain lines, the `loop` copy's plain lines (tools/word-scan-variants.ts: the library before the word
//   scan) and the tree's inspected paragraph's negative-word-tail gaps, each prepared once a paragraph and filled at
//   every width;
// - Firefox's own lines: the line of each code point's first positive rect in a div of the same style and width.
// The report counts, per group: layouts, tree lines other than the loop's, gaps, and against native line starts the
// layouts where both, only the loop, only the tree or neither agree. A tree that differs from native where the loop
// agrees is a line the word scan lost.
//
// WORD_SCAN_PARAGRAPHS_GROUPS=<comma list> keeps some groups; WORD_SCAN_PARAGRAPHS_LIMIT=<n> keeps n paragraphs a group.
//
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=firefox -- \
//     bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/tools/word-scan-paragraphs-probe.ts --out=<dir> \
//       --probe-timeout-ms=7200000 --stall-ms=7200000
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { UNKNOWN_FONT_FACTS } from '../src/model.ts'
import type { Probe } from '../probes/types.ts'
import { SCRIPT_INFO } from '../lab/cases/texts.ts'
import { wordScanVariant } from './word-scan-variants.ts'

const CORPORA = resolve(import.meta.dir, '../../corpora')

async function bundleOf(src: string): Promise<string> {
  const entry = join(mkdtempSync(join(tmpdir(), 'pretext-word-scan-paragraphs-')), 'entry.ts')
  writeFileSync(entry, readFileSync(join(import.meta.dir, 'word-scan-scripts-probe-entry.ts'), 'utf8').replaceAll("'../src/", `'${src}/`))
  const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling ${src} failed: ${built.logs.join('\n')}`)
  return await built.outputs[0]!.text()
}

// The corpus file's paragraphs (split at line feeds), each cut to at most `longest` UTF-16 units at a U+0020 or, in
// text without spaces, at a grapheme boundary; every `step`-th paragraph up to `cap`.
function paragraphs(file: string, cap: number, longest: number, step = 1): string[] {
  const text = readFileSync(join(CORPORA, `${file}.txt`), 'utf8')
  const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })
  const out: string[] = []
  const parts = text.split(/\n+/).map(p => p.trim()).filter(p => p.length > 20)
  for (let i = 0; i < parts.length && out.length < cap; i += step) {
    let p = parts[i]!.replaceAll(String.fromCharCode(0xad), '')
    if (p.length > longest) {
      const space = p.lastIndexOf(' ', longest)
      if (space > longest / 2) p = p.slice(0, space)
      else {
        let cut = ''
        for (const g of graphemes.segment(p)) { if (cut.length + g.segment.length > longest) break; cut += g.segment }
        p = cut
      }
    }
    out.push(p)
  }
  return out
}

type Group = { name: string; texts: string[]; families: string[]; size: number; lang: string; direction: 'ltr' | 'rtl'; widths: number[] }

const NNBSP = String.fromCharCode(0x202f)
const MVS = String.fromCharCode(0x180e)
const W = [67, 97, 131, 173, 229, 307, 401]
const WIDE = [131, 229, 307, 401, 557]

function groups(): Group[] {
  const all: Group[] = [
    { name: 'thai', texts: [...paragraphs('th-nithan-vetal-story-1', 20, 700), ...paragraphs('th-nithan-vetal-story-7', 20, 700)], families: ['Thonburi', 'Sukhumvit Set', 'Ayuthaya', '!sans-serif'], size: 16, lang: 'th', direction: 'ltr', widths: W },
    { name: 'khmer', texts: paragraphs('km-prachum-reuang-preng-khmer-volume-7-stories-1-10', 30, 700), families: ['Khmer MN', 'Khmer Sangam MN', '!sans-serif'], size: 16, lang: 'km', direction: 'ltr', widths: W },
    { name: 'myanmar', texts: [...paragraphs('my-cunning-heron-teacher', 20, 700), ...paragraphs('my-bad-deeds-return-to-you-teacher', 20, 700)], families: ['Myanmar MN', 'Noto Sans Myanmar', '!sans-serif'], size: 16, lang: 'my', direction: 'ltr', widths: W },
    {
      name: 'lao', texts: ['ສະບາຍດີ ພາສາລາວເປັນພາສາທາງການຂອງປະເທດລາວ ຂ້ອຍຮັກເຈົ້າຫຼາຍໆ ປະເທດລາວມີນະຄອນຫຼວງວຽງຈັນ ແລະ ຫຼວງພະບາງ ແມ່ນ້ຳຂອງໄຫຼຜ່ານປະເທດລາວ ຄົນລາວມັກກິນເຂົ້າໜຽວ ຂອບໃຈຫຼາຍໆ',
        'ສາທາລະນະລັດປະຊາທິປະໄຕປະຊາຊົນລາວ ຂອບໃຈຫຼາຍໆສຳລັບການຊ່ວຍເຫຼືອ'], families: ['Lao MN', 'Lao Sangam MN', '!sans-serif'], size: 16, lang: 'lo', direction: 'ltr', widths: [...W, 59, 83, 113],
    },
    { name: 'tibetan', texts: ['བོད་ཡིག་ནི་བོད་པའི་ཡི་གེ་ཡིན། ང་བོད་པ་ཡིན། བཀྲ་ཤིས་བདེ་ལེགས། སྐད་ཡིག་དང་རྒྱ་མཚོ། སྤྱི་ཚོགས་ཀྱི་བསྒྲུབས་པ། ཨོཾ་མ་ཎི་པདྨེ་ཧཱུྃ།'], families: ['Kokonor', 'Kailasa', '!sans-serif'], size: 16, lang: 'bo', direction: 'ltr', widths: [...W, 59, 83, 113] },
    { name: 'mongolian', texts: [`ᠮᠣᠩᠭᠣᠯ ᠪᠢᠴᠢᠭ ᠮᠣᠩᠭᠣᠯ${NNBSP}ᠤᠨ ᠤᠯᠤᠰ ᠬᠠᠷᠠ${MVS}ᠠ ᠬᠡᠯᠡ ᠨᠣᠮ${NNBSP}ᠢ ᠰᠠᠢᠨ ᠪᠠᠢᠨ${MVS}ᠠ ᠮᠣᠩᠭᠣᠯ ᠬᠡᠯᠡ`], families: ['Noto Sans Mongolian', '!sans-serif'], size: 16, lang: 'mn', direction: 'ltr', widths: [...W, 59, 83, 113] },
    { name: 'hindi', texts: paragraphs('hi-eidgah', 30, 600, 2), families: ['Kohinoor Devanagari', 'Devanagari Sangam MN', '!sans-serif'], size: 16, lang: 'hi', direction: 'ltr', widths: W },
    { name: 'urdu', texts: paragraphs('ur-chughd', 25, 600), families: ['Noto Nastaliq Urdu', 'Geeza Pro', '!sans-serif'], size: 16, lang: 'ur', direction: 'rtl', widths: W },
    { name: 'arabic', texts: paragraphs('ar-al-bukhala', 25, 600, 7), families: ['Geeza Pro', 'Noto Nastaliq Urdu', 'Diwan Thuluth', '!serif'], size: 16, lang: 'ar', direction: 'rtl', widths: W },
    { name: 'hebrew', texts: paragraphs('he-masaot-binyamin-metudela', 25, 600, 3), families: ['Arial Hebrew', 'Times New Roman', '!serif'], size: 16, lang: 'he', direction: 'rtl', widths: W },
    { name: 'korean', texts: paragraphs('ko-sonagi', 25, 600, 2), families: ['Apple SD Gothic Neo', 'AppleMyungjo', '!sans-serif'], size: 16, lang: 'ko', direction: 'ltr', widths: W },
    { name: 'japanese', texts: [...paragraphs('ja-rashomon', 15, 500), ...paragraphs('ja-kumo-no-ito', 10, 500)], families: ['Hiragino Mincho ProN', 'Hiragino Sans', '!serif'], size: 16, lang: 'ja', direction: 'ltr', widths: W },
    { name: 'chinese', texts: [...paragraphs('zh-zhufu', 15, 500), ...paragraphs('zh-guxiang', 10, 500)], families: ['Songti SC', 'PingFang SC', '!sans-serif'], size: 16, lang: 'zh', direction: 'ltr', widths: W },
    { name: 'english', texts: paragraphs('en-gatsby-opening', 30, 600, 5), families: ['Times New Roman', 'Helvetica Neue', 'Hoefler Text', 'Apple Chancery', 'Georgia', 'Zapfino', '!serif'], size: 16, lang: 'en', direction: 'ltr', widths: WIDE },
    { name: 'mixed', texts: paragraphs('mixed-app-text', 20, 700), families: ['Helvetica Neue', 'Times New Roman', '!sans-serif'], size: 16, lang: 'en', direction: 'ltr', widths: W },
  ]
  // The lab's own snippets (lab/cases/texts.ts SCRIPT_INFO), each script's in its fonts.
  const scripts = Object.entries(SCRIPT_INFO)
  for (let i = 0; i < scripts.length; i++) {
    const [script, info] = scripts[i]!
    all.push({ name: `snippets-${script}`, texts: [...info.snippets], families: info.fonts.map(f => f.startsWith('"') ? f.slice(1, -1) : f), size: 16, lang: info.lang, direction: info.direction, widths: [...W, 59, 83, 113] })
  }
  const keep = process.env['WORD_SCAN_PARAGRAPHS_GROUPS']?.split(',') ?? null
  const limit = Number(process.env['WORD_SCAN_PARAGRAPHS_LIMIT'] ?? Number.POSITIVE_INFINITY)
  return all.filter(group => keep === null || keep.includes(group.name)).map(group => ({ ...group, texts: group.texts.slice(0, limit) }))
}

const PAGE = String.raw`
const [loop, tree] = [LIBS[0], LIBS[1]];
const env = tree.environment();
const out = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, groups: [], treeNotLoop: [], losses: [], gaps: [], neither: [], errors: [] };
const nativeStarts = (s, widthAu) => {
  const div = document.createElement('div');
  div.lang = s.lang;
  div.dir = s.direction;
  div.style.cssText = 'margin:0;padding:0;border:0;font-kerning:auto;text-rendering:auto;tab-size:8;'
    + 'white-space:' + (s.whiteSpace || 'normal') + ';line-break:' + (s.lineBreak || 'auto') + ';letter-spacing:' + (s.letterSpacing || 0) + 'px;word-spacing:' + (s.wordSpacing || 0) + 'px;'
    + 'font-family:' + s.family + ';font-size:' + s.size + 'px;font-weight:' + s.weight + ';font-style:' + s.style + ';line-height:' + (2 * s.size) + 'px;'
    + 'overflow-wrap:' + s.overflowWrap + ';word-break:' + s.wordBreak + ';width:' + (widthAu / 60) + 'px';
  div.textContent = s.text;
  host.appendChild(div);
  const box = div.getBoundingClientRect();
  const node = div.firstChild;
  const range = document.createRange();
  const lineOf = new Map();
  // Grapheme clusters, each on the line of its code points' first positive rect: Firefox gives a cluster's base alone an
  // empty rect where a mark follows it (Thai กุ), so a code point's own rect would start the line one unit late.
  const clusters = [...new Intl.Segmenter(s.lang, { granularity: 'grapheme' }).segment(node.data)];
  for (let c = 0; c < clusters.length; c++) {
    const from = clusters[c].index, to = from + clusters[c].segment.length;
    let line = null;
    for (let i = from; i < to && line === null;) {
      const length = node.data.codePointAt(i) > 0xffff ? 2 : 1;
      range.setStart(node, i);
      range.setEnd(node, i + length);
      const rects = range.getClientRects();
      for (let r = 0; r < rects.length; r++) {
        if (rects[r].width <= 0 || rects[r].height <= 0) continue;
        line = Math.floor((rects[r].top + rects[r].height / 2 - box.top) / (2 * s.size));
        break;
      }
      i += length;
    }
    if (line !== null && (!lineOf.has(line) || lineOf.get(line) > from)) lineOf.set(line, from);
  }
  const lines = Math.round(box.height / (2 * s.size));
  host.removeChild(div);
  const starts = [...lineOf.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
  return { lines, starts };
};
// A library line start moved past white space, as native's first visible code point is.
const visible = (text, starts) => starts.map(st => { let i = st; while (i < text.length && /\s/.test(text[i])) i++; return i; });
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
for (let g = 0; g < GROUPS.length; g++) {
  const group = GROUPS[g];
  for (let f = 0; f < group.families.length; f++) {
    const name = group.families[f];
    const family = name[0] === '!' ? name.slice(1) : '"' + name + '"';
    for (let o = 0; o < STYLES.length; o++) {
      const style = STYLES[o];
      const counts = { group: group.name, family: name, overflowWrap: style.name, layouts: 0, justFits: 0, treeNotLoop: 0, gaps: 0, bothNative: 0, onlyLoopNative: 0, onlyTreeNative: 0, neitherNative: 0, lines: 0 };
      try {
        for (let p = 0; p < group.texts.length; p++) {
          const text = style.text === 'shy' ? group.texts[p].replace(/([^\s\u00ad]{3})(?=[^\s\u00ad]{3})/gu, '$1\u00ad') : style.text === 'tabs' ? group.texts[p].replace(/ /g, (m, i) => i % 3 === 0 ? '\t' : ' ') : group.texts[p];
          const spec = { family, size: group.size, weight: 400, style: 'normal', facts: UNKNOWN, text, lang: group.lang, direction: group.direction, overflowWrap: style.overflowWrap, wordBreak: style.wordBreak,
            letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing, whiteSpace: style.whiteSpace, lineBreak: style.lineBreak };
          const pt = tree.prepareSpec(env, spec, false);
          const pl = loop.prepareSpec(env, spec, false);
          const pi = tree.prepareSpec(env, spec, true);
          const widths = [];
          for (let w = 0; w < group.widths.length; w++) {
            const base = group.widths[w] * 60;
            widths.push(base);
            // The smallest width that keeps the first line's end: the line's last word only just fits.
            const firstEnd = (au) => tree.lay(pt, au).ranges.split(' ')[0];
            const want = firstEnd(base);
            let lo = Math.max(1, base - 60 * 60), hi = base;
            if (firstEnd(lo) !== want) {
              while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (firstEnd(mid) === want) hi = mid; else lo = mid; }
              widths.push(hi, hi - 1);
              counts.justFits++;
            }
          }
          for (let w = 0; w < widths.length; w++) {
            const au = widths[w];
            const t = tree.lay(pt, au);
            const l = loop.lay(pl, au);
            const inspected = tree.lay(pi, au);
            const native = nativeStarts(spec, au);
            counts.layouts++;
            counts.lines += t.starts.length;
            if (t.ranges !== l.ranges) { counts.treeNotLoop++; if (out.treeNotLoop.length < 200) out.treeNotLoop.push({ group: group.name, family: name, overflowWrap: style.name, p, au, tree: t.ranges, loop: l.ranges, gaps: inspected.gaps, native: native.starts.join(' ') }); }
            if (inspected.gaps.length > 0) { counts.gaps++; if (out.gaps.length < 200) out.gaps.push({ group: group.name, family: name, overflowWrap: style.name, p, au, gaps: inspected.gaps, tree: t.ranges, loop: l.ranges, native: native.starts.join(' ') }); }
            const tn = same(visible(spec.text, t.starts), native.starts);
            const ln = same(visible(spec.text, l.starts), native.starts);
            if (tn && ln) counts.bothNative++;
            else if (ln) { counts.onlyLoopNative++; if (out.losses.length < 200) out.losses.push({ group: group.name, family: name, overflowWrap: style.name, p, au, tree: t.ranges, loop: l.ranges, native: native.starts.join(' ') }); }
            else if (tn) counts.onlyTreeNative++;
            else { counts.neitherNative++; if (out.neither.length < 300) out.neither.push({ group: group.name, family: name, overflowWrap: style.name, p, au, tree: t.ranges, visible: visible(spec.text, t.starts).join(' '), native: native.starts.join(' '), nativeLines: native.lines }); }
          }
        }
      } catch (error) {
        out.errors.push({ group: group.name, family: name, error: String(error && error.stack || error) });
      }
      out.groups.push(counts);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}
return out;
`

// The styles each paragraph is laid out in: the three overflow-wrap values, and under WORD_SCAN_PARAGRAPHS_STYLES=1
// spacing in both signs, white-space pre-wrap with tabs, soft hyphens every three letters, keep-all, break-all and
// line-break: anywhere, each under break-word (where the line's first word's clusters are candidates) and normal.
type Style = { name: string; overflowWrap: string; wordBreak: string; letterSpacing: number; wordSpacing: number; whiteSpace: string; lineBreak: string; text: 'plain' | 'shy' | 'tabs' }
function styles(): Style[] {
  const base: Style = { name: '', overflowWrap: 'normal', wordBreak: 'normal', letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', lineBreak: 'auto', text: 'plain' }
  const wraps = ['normal', 'break-word', 'anywhere']
  if (process.env['WORD_SCAN_PARAGRAPHS_STYLES'] !== '1') return wraps.map(w => ({ ...base, name: w, overflowWrap: w }))
  const out: Style[] = []
  const variants: Array<Partial<Style> & { name: string }> = [
    { name: 'ls-1', letterSpacing: -1 }, { name: 'ls0.5', letterSpacing: 0.5 }, { name: 'ls3', letterSpacing: 3 },
    { name: 'ws-8', wordSpacing: -8 }, { name: 'ws5', wordSpacing: 5 }, { name: 'ws-3', wordSpacing: -3 },
    { name: 'pre-wrap-tabs', whiteSpace: 'pre-wrap', text: 'tabs' }, { name: 'pre-wrap', whiteSpace: 'pre-wrap' }, { name: 'break-spaces', whiteSpace: 'break-spaces' },
    { name: 'shy', text: 'shy' }, { name: 'keep-all', wordBreak: 'keep-all' }, { name: 'break-all', wordBreak: 'break-all' }, { name: 'lb-anywhere', lineBreak: 'anywhere' },
    { name: 'lb-strict', lineBreak: 'strict' }, { name: 'lb-loose', lineBreak: 'loose' },
  ]
  for (let v = 0; v < variants.length; v++) for (const w of ['normal', 'break-word']) out.push({ ...base, ...variants[v]!, name: `${variants[v]!.name}/${w}`, overflowWrap: w })
  return out
}

export default async function wordScanParagraphsProbes(): Promise<Probe[]> {
  const list = groups()
  const libs = `const LIBS = [];\n${await bundleOf(wordScanVariant('loop'))}\nLIBS.push(globalThis.wordScanScriptsProbe);\n${await bundleOf(resolve(import.meta.dir, '../src'))}\nLIBS.push(globalThis.wordScanScriptsProbe);\n`
  return [{
    id: 'word-scan P3', spec: "Gecko's word scan against the engine's loop and native Firefox on corpus paragraphs, at drawn widths and where a line's last word only just fits", pageLang: 'en', html: '<div></div>',
    fontFixtures: ['Noto Nastaliq Urdu'],
    observe: [{ kind: 'script', source: `${libs}const UNKNOWN = ${JSON.stringify(UNKNOWN_FONT_FACTS)};\nconst STYLES = ${JSON.stringify(styles())};\nconst GROUPS = ${JSON.stringify(list)};\n${PAGE}` }], browsers: ['firefox'],
  }]
}
