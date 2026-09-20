// Gecko's word scan against the engine's loop in the real browser, over many installed font families: the word scan's
// premise (src/engines/gecko/lines.ts wordScan: no suffix of a shaped word has a negative advance) is a belief about
// fonts, and the recorded answers hold the lab's fonts alone. For every family and every text, one plain paragraph under
// overflow-wrap: break-word at two sizes and fourteen widths, in mode 'exact' and in mode 'premise'; a layout whose line
// ranges differ is a premise that failed on real Canvas answers, or a condition that is wrong; the engine's loop runs
// before and after the word scan, and a layout where those two disagree is counted as unstable instead. The families are macOS's
// text, display and script faces, among them the ones whose glyphs HarfBuzz gives negative advances (Marker Felt,
// Superclarendon, Geeza Pro, the Nastaliq faces, Diwan Thuluth, Farisi, Mishafi, Waseem). A family the machine lacks
// falls back to another font, which is one more font tried.
//
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/tools/word-scan-fonts-probe.ts --out=<dir>
//     --probe-timeout-ms=900000 --stall-ms=900000      (under the browser lock; counts only, no timing)
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'

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

const BODY = String.raw`
const lib = globalThis.wordScanFontsProbe;
const env = lib.environment();
const WIDTHS = [30, 44, 58, 72, 86, 100, 123, 146, 169, 192, 238, 284, 330, 422];
const SIZES = [16, 23];
const out = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, families: [], differences: [], errors: [] };
for (let g = 0; g < GROUPS.length; g++) {
  const group = GROUPS[g];
  for (let f = 0; f < group.families.length; f++) {
    const family = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(group.families[f]) ? group.families[f] : '"' + group.families[f] + '"';
    const counts = { layouts: 0, unstable: 0, lines: 0, premise: 0, proven: 0, refused: 0 };
    const before = out.differences.length;
    try {
      for (let s = 0; s < SIZES.length; s++) for (let t = 0; t < group.texts.length; t++) lib.compare(family, SIZES[s], group.texts[t], group.lang, group.direction, WIDTHS, env, counts, out.differences);
    } catch (error) {
      out.errors.push({ family, error: String(error && error.message || error) });
    }
    out.families.push({ family, installed: document.fonts.check('16px ' + family), ...counts, differing: out.differences.length - before });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
return out;
`

export default async function wordScanFontsProbes(): Promise<Probe[]> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'word-scan-fonts-probe-entry.ts')], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  const bundle = await built.outputs[0]!.text()
  const groups = [
    { families: LATIN_FAMILIES, texts: LATIN_TEXTS, lang: 'en', direction: 'ltr' },
    { families: ARABIC_FAMILIES, texts: ARABIC_TEXTS, lang: 'ar', direction: 'rtl' },
    { families: HEBREW_FAMILIES, texts: HEBREW_TEXTS, lang: 'he', direction: 'rtl' },
  ]
  return [{
    id: 'word-scan F1', spec: 'speculative study: Gecko\'s word scan against the engine\'s loop over installed font families', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundle}\nconst GROUPS = ${JSON.stringify(groups)};\n${BODY}` }],
  }]
}
