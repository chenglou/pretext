// Gecko's word scan (src/engines/gecko/lines.ts wordScan) in the real Firefox, several libraries inside ONE document
// (tools/word-scan-probe-entry.ts bundled once per library): the tree's own, a checkout or export of another commit, or
// an edited copy (tools/word-scan-variants.ts). WORD_SCAN_PROBE picks the probe:
// - `timed`: the chat benchmark's messages (bench/cases.ts), every library in turn and the order turned every round, so
//   a round is an alternating pair: from scratch at 320px (a list of contexts a message), then the same messages kept
//   and laid out at 260, 380 and 440px. After the timing a counting pass wraps measureText: calls and characters a
//   message from scratch and a layout at a new width, and a hash of every line's range at the four widths, which must
//   be the same in every library. The page's fixed arithmetic is timed at both ends, as the bench's `spinMs`.
// - `fonts`: the word scan's premise (no suffix of a shaped word has a negative advance) is a belief about fonts, and
//   the recorded answers hold the lab's fonts alone. For every family and every text, one plain paragraph under
//   overflow-wrap: break-word at two sizes and fourteen widths, by the `loop` copy, the tree's library and the `loop`
//   copy again. A layout whose line ranges differ is a premise that failed on real Canvas answers, or a condition that
//   is wrong; one where the two loops disagree is counted as unstable instead (Canvas doesn't always answer a fallback
//   font's characters the same way twice in one document). The families are macOS's text, display and script faces,
//   among them the ones whose glyphs HarfBuzz gives negative advances; one the machine lacks falls back, which is one
//   more font tried.
//
//   WORD_SCAN_PROBE=timed WORD_SCAN_LIBS="base=<folder of a rebuild/src>,words=tree" [WORD_SCAN_ROUNDS=8] [WORD_SCAN_SETS=mix,latin,real]
//   [WORD_SCAN_WRAP=break-word|normal] [WORD_SCAN_MESSAGES=10000] \
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=all --exclusive -- \
//     bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/tools/word-scan-probe.ts --out=<dir> --probe-timeout-ms=900000 --stall-ms=900000
//   WORD_SCAN_PROBE=fonts ... with-browser-lock.py <job> --browser=firefox -- (the same; counts only, no timing)
//
// A library is `tree`, `loop`, `proven`, `checked`, or the folder of a rebuild/src.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CHAT_RESIZE_WIDTHS, CHAT_WIDTH, buildChat } from '../bench/cases.ts'
import type { ChatSetId } from '../bench/protocol.ts'
import type { Probe } from '../probes/types.ts'
import { wordScanVariant } from './word-scan-variants.ts'

// The entry bundled against one library's source folder, as a script that leaves it in globalThis.wordScanProbe.
async function bundleOf(library: string): Promise<string> {
  const src = library === 'tree' ? resolve(import.meta.dir, '../src') : library === 'loop' || library === 'proven' || library === 'checked' ? wordScanVariant(library) : resolve(library)
  const entry = join(mkdtempSync(join(tmpdir(), 'pretext-word-scan-probe-')), 'entry.ts')
  writeFileSync(entry, readFileSync(join(import.meta.dir, 'word-scan-probe-entry.ts'), 'utf8').replaceAll("'../src/", `'${src}/`))
  const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling ${library} failed: ${built.logs.join('\n')}`)
  return await built.outputs[0]!.text()
}

async function libraries(spec: string): Promise<string> {
  const entries = spec.split(',').filter(entry => entry !== '')
  let script = 'const LIBS = [];\n'
  for (let i = 0; i < entries.length; i++) {
    const at = entries[i]!.indexOf('=')
    script += `${await bundleOf(entries[i]!.slice(at + 1))}\nLIBS.push({ label: ${JSON.stringify(entries[i]!.slice(0, at))}, lib: globalThis.wordScanProbe });\n`
  }
  return script
}

const TIMED = String.raw`
const sets = Object.keys(SETS);
const spin = () => { const t0 = performance.now(); let x = 1; for (let i = 0; i < 30000000; i++) x = (Math.imul(x, 1103515245) + 12345) | 0; return { ms: performance.now() - t0, x }; };
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
for (const entry of LIBS) {
  entry.env = entry.lib.environment();
  entry.paragraphs = {};
  for (const set of sets) entry.paragraphs[set] = SETS[set].map((message) => entry.lib.chatParagraph(message.parts, WRAP));
}
// Once untimed over the first 1,000 of each set, for compiled code.
for (const entry of LIBS) for (const set of sets) entry.lib.relayout(entry.lib.prepareAll(entry.paragraphs[set].slice(0, 1000), entry.env, WIDTH), RESIZE);
const out = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, overflowWrap: WRAP, messages: SETS[sets[0]].length, spinBefore: spin().ms, rounds: [], counts: [] };
for (let round = 0; round < ROUNDS; round++) {
  const row = [];
  for (let k = 0; k < LIBS.length; k++) {
    const entry = LIBS[(k + round) % LIBS.length];
    for (const set of sets) {
      await pause();
      let t0 = performance.now();
      const lines = entry.lib.scratch(entry.paragraphs[set], entry.env, WIDTH);
      const scratchMs = performance.now() - t0;
      await pause();
      t0 = performance.now();
      const kept = entry.lib.prepareAll(entry.paragraphs[set], entry.env, WIDTH);
      const keepMs = performance.now() - t0;
      await pause();
      t0 = performance.now();
      const relaidLines = entry.lib.relayout(kept, RESIZE);
      row.push({ label: entry.label, set, scratchMs, keepMs, relayoutMs: performance.now() - t0, lines, relaidLines });
    }
  }
  out.rounds.push(row);
}
out.spinAfter = spin().ms;
// The counting pass.
let calls = 0;
let characters = 0;
const proto = OffscreenCanvasRenderingContext2D.prototype;
const measureText = proto.measureText;
proto.measureText = function (text) { calls++; characters += text.length; return measureText.call(this, text); };
for (const entry of LIBS) {
  for (const set of sets) {
    await pause();
    calls = 0; characters = 0;
    const kept = entry.lib.prepareAll(entry.paragraphs[set], entry.env, WIDTH);
    const scratch = { calls, characters };
    calls = 0; characters = 0;
    entry.lib.relayout(kept, RESIZE);
    const relayout = { calls, characters };
    calls = 0; characters = 0;
    entry.lib.relayout(kept, RESIZE);
    out.counts.push({ label: entry.label, set, messages: kept.length, scratch, relayout, relayoutAgain: { calls, characters }, rangesHash: entry.lib.rangesHash(kept, [WIDTH].concat(RESIZE)) });
  }
}
proto.measureText = measureText;
return out;
`

const c = (...codes: number[]): string => String.fromCodePoint(...codes)

const LATIN_FAMILIES = ['Marker Felt', 'Superclarendon', 'Zapfino', 'Apple Chancery', 'Snell Roundhand', 'Brush Script MT', 'Noteworthy', 'Chalkduster', 'Papyrus', 'SignPainter',
  'Savoye LET', 'Trattatello', 'Party LET', 'Bradley Hand', 'Herculanum', 'Luminari', 'Phosphate', 'Rockwell', 'Hoefler Text', 'Didot', 'Baskerville', 'Big Caslon', 'Bodoni 72',
  'Bodoni 72 Oldstyle', 'Bodoni 72 Smallcaps', 'Cochin', 'Copperplate', 'Futura', 'Gill Sans', 'Optima', 'Palatino', 'Avenir', 'Avenir Next', 'Avenir Next Condensed',
  'American Typewriter', 'Andale Mono', 'Courier', 'Courier New', 'Menlo', 'Monaco', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times', 'Times New Roman', 'Arial',
  'Arial Narrow', 'Arial Black', 'Arial Rounded MT Bold', 'Impact', 'Comic Sans MS', 'Skia', 'Seravek', 'Charter', 'Iowan Old Style', 'Athelas', 'Marion', 'PT Sans', 'PT Serif',
  'PT Mono', 'Chalkboard', 'Chalkboard SE', 'Helvetica', 'Helvetica Neue', 'Lucida Grande', 'Geneva', 'system-ui', 'DIN Alternate', 'DIN Condensed', 'Kefa', 'Galvji', 'Mishafi',
  'STIX Two Text', 'Apple Braille', 'Apple Symbols', 'Webdings', 'Wingdings', 'Silom', 'Ayuthaya', 'Krungthep', 'Thonburi', 'Shree Devanagari 714', 'Kohinoor Devanagari',
  'Hiragino Sans', 'Hiragino Mincho ProN', 'PingFang SC', 'Songti SC', 'Apple SD Gothic Neo', 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy']
const ARABIC_FAMILIES = ['Geeza Pro', 'Noto Nastaliq Urdu', 'DecoType Nastaleeq Urdu UI', 'Diwan Thuluth', 'Farisi', 'Mishafi', 'Mishafi Gold', 'Waseem', 'Al Bayan', 'Al Nile',
  'Al Tarikh', 'Baghdad', 'Beirut', 'Damascus', 'DecoType Naskh', 'Diwan Kufi', 'Farah', 'KufiStandardGK', 'Muna', 'Nadeem', 'Sana', 'Arial', 'Times New Roman', 'Courier New',
  'Tahoma', 'Amiri', 'Noto Naskh Arabic', 'SF Arabic', 'serif']
const HEBREW_FAMILIES = ['Arial Hebrew', 'Corsiva Hebrew', 'New Peninim MT', 'Raanana', 'Arial', 'Times New Roman', 'Lucida Grande', 'serif']

// Pairs the fonts kern hardest, quotes and points at word ends, ligatures, and plain sentences.
const LATIN_TEXTS = [
  `"To," 'Tis "Yo." AV, P. F. T. V. W. Y. L' L" r, y. f' ff fi ffl i'l (f) [j] 'A' "A" ,". .' '- ,- ." ," '/ 'J ,\\ AVATAR WAVE Type Tyler Yves Wm. We're you'll`,
  `The quick brown fox jumps over the lazy dog's back, and "fifty-five" waffles: officially difficult; affluent offline shuffle. Try AWAY, LOVELY, 11.1'' and 7' 1".`,
  `il1|!.,:;' ''' ,,, ... --- ___ ///\\\\\\ ()[]{} <<>> ** ^^ ~~ rn m nn vv w Wj fj gj yj Tj Pj Fj LT LY LV TA VA WA YA Ta Te To Tr Tu Ty Va Ve Vo Wa We Wo Ya Ye Yo`,
  `internationalization counterrevolutionaries http://example.com/a/b?c=d&e=f#frag user@example.org 1,000,000.00 3.14159 e${c(0x301)}te${c(0x301)} nai${c(0x308)}ve co${c(0x302)}te a${c(0x30a)}ngstro${c(0x308)}m`,
]
const ARABIC_TEXTS = [
  `بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ مَرْحَبًا بِالْعَالَمِ كِتَابٌ لَا إِلَهَ إِلَّا اللَّهُ`,
  `مرحبا بالعالم اللغة العربية جميلة ريال سلام لا الإسلام كتاب مكتبة المدرسة الجامعة الاستقلال والمستشفيات`,
  `كـــتاب سـلام لالالا للله الله محمد ﷺ ۱۲۳۴۵ 12345 اُردُو نستعلیق میں لکھی جاتی ہے`,
]
const HEBREW_TEXTS = [
  `בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ שָׁלוֹם עוֹלָם עִבְרִית`,
  `שלום עולם עברית ירושלים תל אביב האוניברסיטה והמשפחות`,
]

const FONTS = String.raw`
const [loop, word] = [LIBS[0].lib, LIBS[1].lib];
const envs = [loop.environment(), word.environment()];
const WIDTHS = [30, 44, 58, 72, 86, 100, 123, 146, 169, 192, 238, 284, 330, 422];
const SIZES = [16, 23];
const out = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, families: [], differences: [], errors: [] };
let calls = 0;
const proto = OffscreenCanvasRenderingContext2D.prototype;
const measureText = proto.measureText;
proto.measureText = function (text) { calls++; return measureText.call(this, text); };
for (let g = 0; g < GROUPS.length; g++) {
  const group = GROUPS[g];
  for (let f = 0; f < group.families.length; f++) {
    const family = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(group.families[f]) ? group.families[f] : '"' + group.families[f] + '"';
    const counts = { layouts: 0, unstable: 0, lines: 0, loopCalls: 0, wordCalls: 0 };
    const before = out.differences.length;
    try {
      for (let s = 0; s < SIZES.length; s++) {
        for (let t = 0; t < group.texts.length; t++) {
          const exact = loop.ranges(loop.fontParagraph(family, SIZES[s], group.texts[t], group.lang, group.direction), envs[0], WIDTHS);
          counts.loopCalls += calls; calls = 0;
          const byWord = word.ranges(word.fontParagraph(family, SIZES[s], group.texts[t], group.lang, group.direction), envs[1], WIDTHS);
          counts.wordCalls += calls; calls = 0;
          const again = loop.ranges(loop.fontParagraph(family, SIZES[s], group.texts[t], group.lang, group.direction), envs[0], WIDTHS);
          calls = 0;
          for (let w = 0; w < WIDTHS.length; w++) {
            counts.layouts++;
            counts.lines += exact[w].split(' ').length - 1;
            if (exact[w] !== again[w]) counts.unstable++;
            else if (exact[w] !== byWord[w] && out.differences.length < 200) out.differences.push({ family, size: SIZES[s], text: group.texts[t], width: WIDTHS[w], loop: exact[w], word: byWord[w] });
          }
        }
      }
    } catch (error) {
      out.errors.push({ family, error: String(error && error.message || error) });
    }
    out.families.push({ family, installed: document.fonts.check('16px ' + family), ...counts, differing: out.differences.length - before });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
proto.measureText = measureText;
return out;
`

export default async function wordScanProbes(): Promise<Probe[]> {
  const which = process.env['WORD_SCAN_PROBE'] ?? 'timed'
  switch (which) {
    case 'timed': {
      const libs = await libraries(process.env['WORD_SCAN_LIBS'] ?? 'loop=loop,words=tree')
      const names = (process.env['WORD_SCAN_SETS'] ?? 'mix,latin,real').split(',') as ChatSetId[]
      const messages = Number(process.env['WORD_SCAN_MESSAGES'] ?? '10000')
      const sets: Record<string, unknown> = {}
      for (let i = 0; i < names.length; i++) sets[names[i]!] = buildChat(names[i]!, messages)
      const constants = `const SETS = ${JSON.stringify(sets)};\nconst ROUNDS = ${Number(process.env['WORD_SCAN_ROUNDS'] ?? '8')};\nconst WRAP = ${JSON.stringify(process.env['WORD_SCAN_WRAP'] ?? 'break-word')};\nconst WIDTH = ${CHAT_WIDTH};\nconst RESIZE = ${JSON.stringify(CHAT_RESIZE_WIDTHS)};\n`
      return [{
        id: 'word-scan T1', spec: 'Gecko\'s word scan: the chat messages from scratch and at new widths, several libraries in one document, alternating', pageLang: 'en', html: '<div></div>',
        observe: [{ kind: 'script', source: `${libs}${constants}${TIMED}` }], browsers: ['firefox'],
      }]
    }
    case 'fonts': {
      const libs = await libraries('loop=loop,words=tree')
      const groups = [
        { families: LATIN_FAMILIES, texts: LATIN_TEXTS, lang: 'en', direction: 'ltr' },
        { families: ARABIC_FAMILIES, texts: ARABIC_TEXTS, lang: 'ar', direction: 'rtl' },
        { families: HEBREW_FAMILIES, texts: HEBREW_TEXTS, lang: 'he', direction: 'rtl' },
      ]
      return [{
        id: 'word-scan F1', spec: 'Gecko\'s word scan against the engine\'s loop over installed font families', pageLang: 'en', html: '<div></div>',
        observe: [{ kind: 'script', source: `${libs}const GROUPS = ${JSON.stringify(groups)};\n${FONTS}` }], browsers: ['firefox'],
      }]
    }
    default: throw new Error(`WORD_SCAN_PROBE is timed or fonts, not ${which}`)
  }
}
