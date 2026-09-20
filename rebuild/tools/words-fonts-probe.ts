// A probe for the word pieces study of Blink's port, on real fonts: two checkouts of the library, the base and the
// prototype, lay the same paragraphs out in one page of the real browser, in every font family of a list, and their
// lines are compared. The stand-in Canvas kerns pairs and knows nothing else, so under it a run is the sum of its words
// and the pair adjustments by construction; whether a font's shaping crosses a space in some other way (a contextual
// lookup, a kern that reads past the space, a word-initial form the first cluster alone doesn't show) only a real font
// can say. The recorded answers hold the lab's few fonts; this asks the machine's.
//
//   WORDS_TREE_A=<base checkout> WORDS_TREE_B=<prototype checkout> WORDS_FONTS=<families.json> \
//     bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/words-fonts-probe.ts --out=<dir> \
//     --probe-timeout-ms=1500000 --stall-ms=1500000        (under a Chrome slot of the browser lock; counts, no times)
//
// families.json: an array of family names (one that starts with `!` is a generic keyword, written without quotes). Per
// family that resolves (a string at 72 px measures otherwise than in both generic fallbacks): every text is prepared plain once by each tree and filled at a list of widths, then at each
// decided line's own width and one LayoutUnit to either side of it. Compared per line: its range, whether it has a line
// box, its width and whether it overflows (the decided line's LineInfo). The prototype fills a third time with its
// checked run on (shape.ts wordsCheck), where a candidate from words that differs from the search throws. Reported per
// family: layouts, lines, layouts that differ, layouts that throw, the prototype's word cuts and how many of them carry
// a pair adjustment (a font that kerns with the space glyph), and a few examples.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'

const ENTRY = (tree: string, name: string, checked: boolean): string => `
import { detectEnvironment, fillLine, firstLine, prepare } from '${tree}/rebuild/src/index.ts'
import { UNKNOWN_FONT_FACTS } from '${tree}/rebuild/src/model.ts'
${checked ? `import { wordsCheck } from '${tree}/rebuild/src/engines/blink/shape.ts'` : 'const wordsCheck = { on: false }'}

function environment() {
  const detected = detectEnvironment({ engine: 'blink', build: null, contentLanguage: null, uiLanguage: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

function paragraphOf(family, text, lang) {
  const font = { family, size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  return { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, font, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr', lang, textIndent: 0, textAlign: 'start' }
}

function lines(prepared, width, checked) {
  wordsCheck.on = checked
  const out = []
  try {
    for (let start = firstLine(prepared); start !== null;) {
      const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
      if (filled.kind === 'line') out.push([filled.start, filled.end, filled.hasLineBox, filled.line.info.width, filled.line.info.hasOverflow])
      start = filled.next
    }
  } finally {
    wordsCheck.on = false
  }
  return out
}

// The prepared paragraph's word cuts and the ones with an adjustment, where the tree keeps them.
function cutsOf(prepared) {
  let cuts = 0
  let adjusted = 0
  const p = Object.values(prepared).find(v => v !== null && typeof v === 'object' && 'groups' in v)
  if (p === undefined) return { cuts, adjusted }
  for (let g = 0; g < p.groups.length; g++) {
    const at = p.groups[g].adjustAtCut
    if (at === undefined) continue
    for (let i = 1; i < at.length; i++) {
      cuts++
      if (at[i] !== 0) adjusted++
    }
  }
  return { cuts, adjusted }
}

globalThis.${name} = { environment, paragraphOf, prepare: (paragraph, env) => prepare(paragraph, env, false), lines, cutsOf }
`

const BODY = String.raw`
const A = globalThis.wordsTreeA, B = globalThis.wordsTreeB;
const envA = A.environment(), envB = B.environment();
const zoom = window.devicePixelRatio;
const probeContext = new OffscreenCanvas(1, 1).getContext('2d');
const measured = (font) => { probeContext.font = font; return probeContext.measureText('mmmmmmmmmmlliWAVA fi 123').width; };
const resolves = (family) => measured('72px ' + family + ', monospace') !== measured('72px monospace') || measured('72px ' + family + ', serif') !== measured('72px serif');
const WIDTHS = [60, 97.3, 140, 200, 260, 320, 411, 560];
const out = [];
let sink = 0;
for (let f = 0; f < FONTS.length; f++) {
  const family = FONTS[f].startsWith('!') ? FONTS[f].slice(1) : '"' + FONTS[f] + '"';
  if (!resolves(family)) { out.push({ family: FONTS[f], resolves: false }); continue; }
  const row = { family: FONTS[f], resolves: true, layouts: 0, lines: 0, differ: 0, throws: 0, cuts: 0, adjustedCuts: 0, errors: 0, examples: [] };
  for (let t = 0; t < TEXTS.length; t++) {
    const text = TEXTS[t].text;
    let a, b, c;
    try {
      a = A.prepare(A.paragraphOf(family, text, TEXTS[t].lang), envA);
      b = B.prepare(B.paragraphOf(family, text, TEXTS[t].lang), envB);
      c = B.prepare(B.paragraphOf(family, text, TEXTS[t].lang), envB);
    } catch (error) { row.errors++; if (row.examples.length < 4) row.examples.push({ text: t, error: String(error).slice(0, 200) }); continue; }
    const counted = B.cutsOf(b);
    row.cuts += counted.cuts;
    row.adjustedCuts += counted.adjusted;
    const widths = WIDTHS.slice();
    const seen = new Set(widths);
    for (let w = 0; w < widths.length; w++) {
      const width = widths[w];
      let la, lb, thrown = null;
      try { la = A.lines(a, width, false); lb = B.lines(b, width, false); } catch (error) { row.errors++; continue; }
      try { sink += B.lines(c, width, true).length; } catch (error) { thrown = String(error).slice(0, 240); }
      row.layouts++;
      row.lines += lb.length;
      const ja = JSON.stringify(la), jb = JSON.stringify(lb);
      if (ja !== jb) {
        row.differ++;
        if (row.examples.length < 4) {
          let l = 0;
          while (l < la.length && l < lb.length && JSON.stringify(la[l]) === JSON.stringify(lb[l])) l++;
          row.examples.push({ text: t, width, line: l, base: la[l], prototype: lb[l], lineText: text.slice(lb[l] ? lb[l][0] : 0, lb[l] ? lb[l][1] : 0) });
        }
      }
      if (thrown !== null) { row.throws++; if (row.examples.length < 4) row.examples.push({ text: t, width, thrown }); }
      if (w < WIDTHS.length && w % 3 === 1) {
        for (let l = 0; l < lb.length && l < 4; l++) for (let d = -1; d <= 1; d++) {
          const at = (lb[l][3] + d) / 64 / zoom;
          if (at > 0 && !seen.has(at)) { seen.add(at); widths.push(at); }
        }
      }
    }
  }
  out.push(row);
  if (f % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
}
return { userAgent: navigator.userAgent, devicePixelRatio: zoom, texts: TEXTS.length, sink, fonts: out };
`

const ch = (...codes: number[]): string => String.fromCodePoint(...codes)

// Words whose edges kern in many fonts, in every order of an ending and a start.
function edgePairs(): string {
  const ends = ['f', 'r', 'y', 'T', 'V', 'W', 'A', 'L', 'P', 'F', 'r.', 'y,', 'f\'', 'T"', 'o)', 'K', 'ff', 'fi']
  const starts = ['T', 'V', 'W', 'A', 'Y', 'J', 'o', 'a', 'j', '.', ',', '(', '"', '\'', 'fi', 'ffl', 'Av', 'To']
  let text = ''
  for (let i = 0; i < ends.length; i++) for (let j = 0; j < starts.length; j += 3) text += `${text === '' ? '' : ' '}xo${ends[i]!} ${starts[(i + j) % starts.length]!}ox`
  return text
}

export const TEXTS: Array<{ lang: string; text: string }> = [
  { lang: 'en', text: 'To be, or not to be: that is the question. Whether \'tis nobler in the mind to suffer the slings and arrows of outrageous fortune, or to take arms against a sea of troubles.' },
  { lang: 'en', text: edgePairs() },
  { lang: 'en', text: 'AVATAR Wave Yo. Ty fly office affix fjord Tr r. P. L T V A W. Y, F. T, r, y. "Quoted" (paren) [bracket] it\'s don\'t rock\'n\'roll WAVE AWAY To Tomorrow. Yes, Your Truly, V. A. Wyatt' },
  { lang: 'en', text: 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. Sphinx of black quartz, judge my vow. How vexingly quick daft zebras jump!' },
  { lang: 'en', text: 'ok so I tried the new layout thing at 320 px - it works, mostly... but 3.14 of the 1,000 rows (about 0.3%) overflow? see http://example.com/a/b?c=d&e=f or ping me @ 12:30 -- thanks!' },
  { lang: 'en', text: 'first fifth office waffle fjord ffl fi fl ff Th ct st The Thin fin flat after offer Tfi fT f T f f i f l T h' },
  { lang: 'en', text: `Na${ch(0x131)}ve caf${ch(0xe9)} r${ch(0xe9)}sum${ch(0xe9)} co${ch(0xf6)}perate ${ch(0xc5)}ngstr${ch(0xf6)}m sm${ch(0xf8)}rrebr${ch(0xf8)}d e${ch(0x301)}tude cafe${ch(0x301)} Vi${ch(0x1ec7)}t Nam ph${ch(0x1edf)} T${ch(0xfc)}r ${ch(0xd8)}y` },
  { lang: 'en', text: '1 2 3 11 17 71 1,000 3.14 7/8 10:45 2026-09-20 $5 100% #1 No. 7 A1 B2 (1) [2] {3} 4th 1st 2nd 3rd 0.5 -1 +1 1e9' },
  { lang: 'en', text: `word ${ch(0x2014)} dash ${ch(0x2013)} en ${ch(0x201c)}curly${ch(0x201d)} ${ch(0x2018)}single${ch(0x2019)} ${ch(0xab)}guillemets${ch(0xbb)} ellipsis${ch(0x2026)} bullet ${ch(0x2022)} item ${ch(0xa9)} 2026 ${ch(0x2122)} mark ${ch(0xb0)}C` },
  { lang: 'en', text: `emoji ${ch(0x1f44d, 0x1f3fd)} in ${ch(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)} text ${ch(0x1f1ef, 0x1f1f5)} and ${ch(0x2764, 0xfe0f)} too ${ch(0x1f600)}${ch(0x1f600)} ok${ch(0x1f44d)} done` },
  { lang: 'el', text: `${ch(0x39a, 0x3b1, 0x3bb, 0x3b7, 0x3bc, 0x3ad, 0x3c1, 0x3b1)} ${ch(0x3ba, 0x3cc, 0x3c3, 0x3bc, 0x3b5)}, ${ch(0x3b1, 0x3c5, 0x3c4, 0x3cc)} ${ch(0x3b5, 0x3af, 0x3bd, 0x3b1, 0x3b9)} ${ch(0x3ad, 0x3bd, 0x3b1)} ${ch(0x3ba, 0x3b5, 0x3af, 0x3bc, 0x3b5, 0x3bd, 0x3bf)}. ${ch(0x3a4, 0x3b1)} ${ch(0x3a5, 0x3b3, 0x3b5, 0x3af, 0x3b1)} ${ch(0x3a4, 0x3c5, 0x3c0, 0x3bf, 0x3b3, 0x3c1, 0x3b1, 0x3c6, 0x3af, 0x3b1)}` },
  { lang: 'ru', text: `${ch(0x41f, 0x440, 0x438, 0x432, 0x435, 0x442)}, ${ch(0x43c, 0x438, 0x440)}! ${ch(0x413, 0x423, 0x422, 0x410)} ${ch(0x422, 0x443, 0x442)} ${ch(0x423, 0x434, 0x430, 0x447, 0x430)}. ${ch(0x420, 0x430, 0x441, 0x447, 0x451, 0x442)} ${ch(0x441, 0x442, 0x440, 0x43e, 0x43a)} ${ch(0x431, 0x435, 0x437)} ${ch(0x431, 0x440, 0x430, 0x443, 0x437, 0x435, 0x440, 0x430)}` },
  { lang: 'ar', text: `${ch(0x645, 0x631, 0x62d, 0x628, 0x627)} ${ch(0x628, 0x627, 0x644, 0x639, 0x627, 0x644, 0x645)}${ch(0x60c)} ${ch(0x647, 0x630, 0x627)} ${ch(0x646, 0x635)} ${ch(0x639, 0x631, 0x628, 0x64a)} ${ch(0x644, 0x627, 0x62e, 0x62a, 0x628, 0x627, 0x631)} ${ch(0x627, 0x644, 0x62a, 0x62e, 0x637, 0x64a, 0x637)}. ${ch(0x627, 0x644, 0x644, 0x63a, 0x629)} ${ch(0x627, 0x644, 0x639, 0x631, 0x628, 0x64a, 0x629)} ${ch(0x62c, 0x645, 0x64a, 0x644, 0x629)} ${ch(0x62c, 0x62f, 0x627)}` },
  { lang: 'ur', text: `${ch(0x6cc, 0x6c1)} ${ch(0x627, 0x631, 0x62f, 0x648)} ${ch(0x645, 0x6cc, 0x6ba)} ${ch(0x627, 0x6cc, 0x6a9)} ${ch(0x622, 0x632, 0x645, 0x627, 0x626, 0x634, 0x6cc)} ${ch(0x645, 0x62a, 0x646)} ${ch(0x6c1, 0x6d2)} ${ch(0x62c, 0x633)} ${ch(0x645, 0x6cc, 0x6ba)} ${ch(0x622, 0x6af)} ${ch(0x627, 0x648, 0x631)} ${ch(0x628, 0x6c1, 0x62a)} ${ch(0x633, 0x6d2)} ${ch(0x627, 0x644, 0x641, 0x627, 0x638)} ${ch(0x6c1, 0x6cc, 0x6ba)}` },
  { lang: 'he', text: `${ch(0x5e9, 0x5dc, 0x5d5, 0x5dd)} ${ch(0x5e2, 0x5d5, 0x5dc, 0x5dd)}, ${ch(0x5d6, 0x5d4, 0x5d5)} ${ch(0x5d8, 0x5e7, 0x5e1, 0x5d8)} ${ch(0x5d1, 0x5e2, 0x5d1, 0x5e8, 0x5d9, 0x5ea)} ${ch(0x5dc, 0x5d1, 0x5d3, 0x5d9, 0x5e7, 0x5ea)} ${ch(0x5d4, 0x5e4, 0x5e8, 0x5d9, 0x5e1, 0x5d4)}. ${ch(0x5d5, 0x5b0, 0x5d0, 0x5b8, 0x5d4, 0x5b7, 0x5d1, 0x5b0, 0x5ea, 0x5bc, 0x5b8)}` },
  { lang: 'hi', text: `${ch(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947)} ${ch(0x926, 0x941, 0x928, 0x93f, 0x92f, 0x93e)}, ${ch(0x92f, 0x939)} ${ch(0x939, 0x93f, 0x928, 0x94d, 0x926, 0x940)} ${ch(0x92e, 0x947, 0x902)} ${ch(0x90f, 0x915)} ${ch(0x92a, 0x930, 0x940, 0x915, 0x94d, 0x937, 0x923)} ${ch(0x92a, 0x93e, 0x920)} ${ch(0x939, 0x948)} ${ch(0x915, 0x94d, 0x937, 0x924, 0x94d, 0x930, 0x93f, 0x92f)} ${ch(0x936, 0x94d, 0x930, 0x940)}` },
  { lang: 'th', text: `${ch(0xe2a, 0xe27, 0xe31, 0xe2a, 0xe14, 0xe35)} ${ch(0xe0a, 0xe32, 0xe27, 0xe42, 0xe25, 0xe01)} ${ch(0xe19, 0xe35, 0xe48)} ${ch(0xe04, 0xe37, 0xe2d)} ${ch(0xe02, 0xe49, 0xe2d, 0xe04, 0xe27, 0xe32, 0xe21)} ${ch(0xe17, 0xe14, 0xe2a, 0xe2d, 0xe1a)} ${ch(0xe20, 0xe32, 0xe29, 0xe32, 0xe44, 0xe17, 0xe22)} ${ch(0xe17, 0xe35, 0xe48)} ${ch(0xe21, 0xe35)} ${ch(0xe0a, 0xe48, 0xe2d, 0xe07, 0xe27, 0xe48, 0xe32, 0xe07)}` },
  { lang: 'en', text: `mixed ${ch(0x645, 0x631, 0x62d, 0x628, 0x627)} Latin ${ch(0x5e9, 0x5dc, 0x5d5, 0x5dd)} and ${ch(0x65e5, 0x672c, 0x8a9e)} words ${ch(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947)} in one ${ch(0x3ba, 0x3cc, 0x3c3, 0x3bc, 0x3b5)} line ${ch(0x43c, 0x438, 0x440)} of text ${ch(0xd55c, 0xad6d, 0xc5b4)} here` },
  { lang: 'ko', text: `${ch(0xc548, 0xb155, 0xd558, 0xc138, 0xc694)} ${ch(0xc138, 0xacc4)} ${ch(0xc774, 0xac83, 0xc740)} ${ch(0xd55c, 0xad6d, 0xc5b4)} ${ch(0xd14d, 0xc2a4, 0xd2b8)} ${ch(0xc785, 0xb2c8, 0xb2e4)} ${ch(0xc904, 0xbc14, 0xafc8)} ${ch(0xc2dc, 0xd5d8, 0xc744)} ${ch(0xc704, 0xd55c)} ${ch(0xbb38, 0xc7a5)}` },
]

export default async function wordsFontsProbes(): Promise<Probe[]> {
  const treeA = process.env['WORDS_TREE_A']
  const treeB = process.env['WORDS_TREE_B']
  const fontsPath = process.env['WORDS_FONTS']
  if (treeA === undefined || treeB === undefined || fontsPath === undefined) throw new Error('WORDS_TREE_A, WORDS_TREE_B and WORDS_FONTS name the two checkouts and the families file')
  const dir = mkdtempSync(join(tmpdir(), 'words-fonts-probe-'))
  const bundles: string[] = []
  const sides: Array<[string, string, boolean]> = [[resolve(treeA), 'wordsTreeA', false], [resolve(treeB), 'wordsTreeB', true]]
  for (let i = 0; i < sides.length; i++) {
    const entry = join(dir, `${sides[i]![1]}.ts`)
    writeFileSync(entry, ENTRY(sides[i]![0], sides[i]![1], sides[i]![2]))
    const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
    bundles.push(await built.outputs[0]!.text())
  }
  return [{
    id: 'words-fonts F1', spec: 'word pieces study: the base and the prototype of Blink\'s port on the machine\'s font families', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundles[0]!}\n${bundles[1]!}\nconst FONTS = ${readFileSync(resolve(fontsPath), 'utf8')};\nconst TEXTS = ${JSON.stringify(TEXTS)};\n${BODY}` }],
  }]
}
