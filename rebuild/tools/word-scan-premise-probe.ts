// The word scan's premise (src/engines/gecko/lines.ts wordScan: no tail of a shaped word has a negative advance) in the
// real Firefox, at the one width where it decides, over every installed font family. Sentences at fixed widths seldom
// put a line's first word within an au of the line's end. Here each word is a paragraph of its own under
// overflow-wrap: break-word, so every cluster start inside it is a break candidate, and its width is searched:
// - T is the smallest width, in au, where the tree's library gives the word one line. Below T the word's end doesn't
//   fit and the word scan leaves the scan to the engine's loop, so T is the word's own advance, and at T the word scan
//   passes over every inner candidate on the premise alone.
// - The `loop` copy (tools/word-scan-variants.ts) lays the same word out at T. The engine's loop tests every prefix, so
//   it gives one line only where no prefix is wider than the word: more lines there is the premise failing in the
//   port's own numbers for that font and word, whatever recipe gave the number (advance.ts inWordAdvance).
// A word whose two libraries differ is laid out again from fresh paragraphs; where that doesn't repeat, it is counted
// as unstable (Canvas doesn't always answer a fallback font's characters the same way twice in one document).
// Words: a letter before every ordered pair of 33 characters that fonts kern hardest (quotes, points, hyphens,
// slashes, capitals with overhangs), where a pair's adjustment can exceed a narrow glyph; words with combining marks;
// Arabic with and without marks and Hebrew with points, since the installed faces whose glyphs HarfBuzz gives negative
// advances are Arabic ones and two Latin ones at quotes and points (research/SPEC-WORD-SUM.md).
//
// WORD_SCAN_PREMISE_CONTROL=1 is the probe's own control: the page takes 20px off Canvas's answer for every `q`, in
// Arial alone, over `xq`, `axqi` and `hello`. The first two must come back as failures and the third must not, or the
// probe can't see what it looks for.
//
//   WORD_SCAN_FAMILIES=<a JSON list of family names, a generic keyword written with a leading !> \
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=firefox -- \
//     bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/tools/word-scan-premise-probe.ts --out=<dir> --probe-timeout-ms=1800000 --stall-ms=1800000
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { wordScanVariant } from './word-scan-variants.ts'

// tools/word-scan-probe-entry.ts bundled against one library's source folder, left in globalThis.wordScanProbe.
async function bundleOf(src: string): Promise<string> {
  const entry = join(mkdtempSync(join(tmpdir(), 'pretext-word-scan-probe-')), 'entry.ts')
  writeFileSync(entry, readFileSync(join(import.meta.dir, 'word-scan-probe-entry.ts'), 'utf8').replaceAll("'../src/", `'${src}/`))
  const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling ${src} failed: ${built.logs.join('\n')}`)
  return await built.outputs[0]!.text()
}

const c = (...codes: number[]): string => String.fromCodePoint(...codes)
const PAIR_CHARACTERS = `'".,-:;!?()/\\*AVWTYLPFJrfyvwaoe17`
const pairs: string[] = []
for (let a = 0; a < PAIR_CHARACTERS.length; a++) for (let b = 0; b < PAIR_CHARACTERS.length; b++) pairs.push(`n${PAIR_CHARACTERS[a]!}${PAIR_CHARACTERS[b]!}`)
const LATIN = [
  'Tyler', 'AVATAR', 'WAVE', "We're", "you'll", 'Wm.', 'fifty-five', 'waffles', 'officially', 'difficult', 'shuffle', "11.1''", 'il1|!.,:;', '///\\\\\\', '()[]{}', 'fj', 'Tj', 'LT', 'Yo.',
  'http://example.com/a/b?c=d&e=f#frag', 'user@example.org', '1,000,000.00', `e${c(0x301)}te${c(0x301)}`, `nai${c(0x308)}ve`, `a${c(0x30a)}ngstro${c(0x308)}m`, `i${c(0x301)}`, `ri${c(0x303, 0x301)}`,
  `T${c(0x323)}.`, `f${c(0x301)}'`, 'internationalization',
]
const FATHA = c(0x64e)
const SHADDA = c(0x651)
const SUKUN = c(0x652)
const KASRA = c(0x650)
const ARABIC = [
  c(0x645, 0x631, 0x62d, 0x628, 0x627), c(0x627, 0x644, 0x644, 0x647), c(0x631, 0x64a, 0x627, 0x644), c(0x644, 0x627, 0x644, 0x627), c(0x643, 0x640, 0x640, 0x62a, 0x627, 0x628),
  `${c(0x628)}${KASRA}${c(0x633)}${SUKUN}${c(0x645)}${KASRA}`, `${c(0x627, 0x644, 0x644)}${SHADDA}${FATHA}${c(0x647)}${KASRA}`, `${c(0x627, 0x644, 0x631)}${SHADDA}${FATHA}${c(0x62d)}${SUKUN}${c(0x645)}${FATHA}${c(0x646)}${KASRA}`,
  `${c(0x645)}${FATHA}${c(0x631)}${SUKUN}${c(0x62d)}${FATHA}${c(0x628)}${c(0x64b)}${c(0x627)}`, `${c(0x631)}${FATHA}${SHADDA}`, `${c(0x644)}${SUKUN}${c(0x645)}${c(0x64f)}`, c(0x646, 0x633, 0x62a, 0x639, 0x644, 0x6cc, 0x642),
  c(0x627, 0x64f, 0x631, 0x62f, 0x64f, 0x648), c(0x6f1, 0x6f2, 0x6f3), c(0x648, 0x627, 0x644, 0x645, 0x633, 0x62a, 0x634, 0x641, 0x64a, 0x627, 0x62a),
]
const HEBREW = [c(0x5e9, 0x5dc, 0x5d5, 0x5dd), c(0x5d1, 0x5bc, 0x5b0, 0x5e8, 0x5b5, 0x5d0, 0x5e9, 0x5c1, 0x5b4, 0x5d9, 0x5ea), c(0x5d4, 0x5b7, 0x5e9, 0x5bc, 0x5c1, 0x5b8, 0x5de, 0x5b7, 0x5d9, 0x5b4, 0x5dd), c(0x5d5, 0x5b0, 0x5d0, 0x5b5, 0x5ea)]

const PAGE = String.raw`
const [loop, word] = [LIBS[0].lib, LIBS[1].lib];
const envs = [loop.environment(), word.environment()];
const HIGH = 60 * 4000;
const out = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, families: [], failures: [], unstable: [], errors: [] };
let calls = 0;
const proto = OffscreenCanvasRenderingContext2D.prototype;
const measureText = proto.measureText;
proto.measureText = function (text) {
  calls++;
  const metrics = measureText.call(this, text);
  if (!CONTROL) return metrics;
  // The control: every q takes 20px back, an advance Canvas doesn't give it, so a word that ends in q is narrower than its prefix.
  const back = 20 * (text.split('q').length - 1);
  return { width: metrics.width - back, actualBoundingBoxLeft: metrics.actualBoundingBoxLeft, actualBoundingBoxRight: metrics.actualBoundingBoxRight - back };
};
// The smallest width in au, from 1, where the library gives the paragraph one line; null where it never does. A word of
// one cluster has one line at every width, and so has a word whose advance isn't positive, which the loop must agree to.
const oneLineFrom = (lib, env, paragraph) => {
  const kept = lib.prepareAll([paragraph], env, HIGH / 60);
  if (lib.relayout(kept, [HIGH / 60]) !== 1) return null;
  if (lib.relayout(kept, [1 / 60]) === 1) return 1;
  let low = 1;
  let high = HIGH;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (lib.relayout(kept, [mid / 60]) === 1) high = mid;
    else low = mid;
  }
  return high;
};
for (let f = 0; f < FAMILIES.length; f++) {
  const family = FAMILIES[f][0] === '!' ? FAMILIES[f].slice(1) : '"' + FAMILIES[f] + '"';
  const counts = { words: 0, searched: 0, failures: 0, unstable: 0, calls: 0 };
  try {
    for (let g = 0; g < GROUPS.length; g++) {
      const group = GROUPS[g];
      for (let s = 0; s < group.sizes.length; s++) {
        for (let w = 0; w < group.words.length; w++) {
          counts.words++;
          const paragraph = () => word.fontParagraph(family, group.sizes[s], group.words[w], group.lang, group.direction);
          const T = oneLineFrom(word, envs[1], paragraph());
          if (T === null) continue;
          counts.searched++;
          const kept = loop.prepareAll([paragraph()], envs[0], T / 60);
          if (loop.relayout(kept, [T / 60]) === 1) continue;
          // Again from fresh paragraphs, the loop twice.
          const again = [loop.ranges(paragraph(), envs[0], [T / 60])[0], word.ranges(paragraph(), envs[1], [T / 60])[0], loop.ranges(paragraph(), envs[0], [T / 60])[0], oneLineFrom(word, envs[1], paragraph())];
          const record = { family, size: group.sizes[s], text: group.words[w], codePoints: Array.from(group.words[w]).map((ch) => ch.codePointAt(0).toString(16)).join(' '), T, loop: again[0], tree: again[1], loopAgain: again[2], TAgain: again[3] };
          if (again[0] === again[2] && again[0] !== again[1] && again[3] === T) { counts.failures++; if (out.failures.length < 300) out.failures.push(record); }
          else { counts.unstable++; if (out.unstable.length < 100) out.unstable.push(record); }
        }
      }
    }
  } catch (error) {
    out.errors.push({ family, error: String(error && error.message || error) });
  }
  counts.calls = calls; calls = 0;
  out.families.push({ family, installed: document.fonts.check('16px ' + family), ...counts });
  await new Promise(resolve => setTimeout(resolve, 0));
}
proto.measureText = measureText;
return out;
`

export default async function wordScanPremiseProbes(): Promise<Probe[]> {
  const control = process.env['WORD_SCAN_PREMISE_CONTROL'] === '1'
  const list = process.env['WORD_SCAN_FAMILIES']
  if (list === undefined && !control) throw new Error('WORD_SCAN_FAMILIES=<a JSON list of family names>')
  const families = control ? ['Arial'] : JSON.parse(readFileSync(resolve(list!), 'utf8')) as string[]
  const groups = control ? [{ words: ['xq', 'axqi', 'hello'], sizes: [16], lang: 'en', direction: 'ltr' }] : [
    { words: pairs, sizes: [16], lang: 'en', direction: 'ltr' },
    { words: LATIN, sizes: [16, 23], lang: 'en', direction: 'ltr' },
    { words: ARABIC, sizes: [16, 23], lang: 'ar', direction: 'rtl' },
    { words: HEBREW, sizes: [16, 23], lang: 'he', direction: 'rtl' },
  ]
  const libs = `const LIBS = [];\n${await bundleOf(wordScanVariant('loop'))}\nLIBS.push({ lib: globalThis.wordScanProbe });\n${await bundleOf(resolve(import.meta.dir, '../src'))}\nLIBS.push({ lib: globalThis.wordScanProbe });\n`
  return [{
    id: 'word-scan P1', spec: 'Gecko\'s word scan: each word at the width of its own advance, the tree\'s library against the engine\'s loop, over installed font families', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${libs}const CONTROL = ${control};\nconst FAMILIES = ${JSON.stringify(families)};\nconst GROUPS = ${JSON.stringify(groups)};\n${PAGE}` }], browsers: ['firefox'],
  }]
}
