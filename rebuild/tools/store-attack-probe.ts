// The second reading's probes on the x-perf-store prototype (src/measure/canvas.ts keeps a context's answers). The store
// is sound only if ONE context gives one string one answer for as long as it lives. tools/store-stale-answer-probe.ts
// showed one way that fails in Firefox (22 strings, the text-presentation trigger). These look for others, in a browser
// that has just started, where a page's first layout happens:
//
// - A1: a sweep of about 190 strings, one or two characters of a Unicode block each (scripts a system font draws by
//   fallback, symbols, emoji and their sequences, private-use and unassigned characters), under `16px Arial` and under the
//   bench's list. Each string has a context of its own, made before anything is measured and never touched again, read
//   every 250 ms for ten seconds, and a new context beside it each time. Nothing else happens: the sweep itself is what
//   a page with mixed text does. No string holds U+FE0E.
// - A2: the same sweep with ten strings that hold U+FE0E (the text presentation of a character that has an emoji one)
//   read first, as a page whose text holds one would.
// - A3: families named by a localized or a face name (`"ヒラギノ角ゴシック"`, `"Helvetica Neue Light"`), which Gecko
//   finds through names it reads after start-up, each before `monospace` so a name that doesn't resolve shows.
// - A4: the library itself with one kept list under a changing <html lang>, for content whose own language is '' (Gecko's
//   port then assigns a context the language '' while it isn't told the process's languages, and Firefox reads such a
//   context's language from the document at every call, probes/contexts-page-lang.ts) and for content in `en`, beside
//   the DOM's own line count for an element with that lang attribute.
//
// - A5: A1 with three strings alone, so nothing else in the page can be what changes the state: the bitcoin sign, a
//   sentence that holds it and a plain word, under the bench's list.
// - A6: A2 in a new content process of a browser that has been up for a while, which is what a new tab is. The probe's
//   page waits 15 seconds and sends its tab to the runner's same document under the host name `localhost`, another site
//   than 127.0.0.1, so Firefox and Chrome load it in another process; the runner sends a restarted page its probes again
//   (runner.ts step), and there the sweep runs. `host` in the result says which page answered.
//
// Per string: every change of the kept context's answer and of the new contexts', with the time of the reading that first
// showed it. A row of one entry never changed. Counts, not times (one browser slot); a newly started browser a probe:
//
//   bun rebuild/probes/runner.ts --browser=firefox|chrome|webkit-host --probes=rebuild/tools/store-attack-probe.ts --only="A1" --out=<dir>
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'

const SAMPLES = String.raw`
const cp = (...codes) => String.fromCodePoint(...codes);
const ARIAL = 'normal 400 16px Arial';
const LIST = 'normal 400 16px "Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif';
const BLOCKS = [
  ['Latin Extended-A', [0x100, 0x17f]], ['Latin Extended-B', [0x180, 0x1c4]], ['IPA', [0x250, 0x2a4]], ['spacing modifiers', [0x2b0, 0x2e5]],
  ['a letter with a combining mark', [0x61, 0x301]], ['Greek', [0x3a9, 0x3b1]], ['Cyrillic', [0x416, 0x44f]], ['Armenian', [0x531, 0x561]],
  ['Hebrew', [0x5d0, 0x5e9]], ['Arabic', [0x627, 0x644]], ['Syriac', [0x710, 0x712]], ['Thaana', [0x780, 0x7a6]], ['NKo', [0x7ca, 0x7cb]],
  ['Devanagari', [0x915, 0x94d, 0x937]], ['Bengali', [0x995, 0x9be]], ['Gurmukhi', [0xa15, 0xa3e]], ['Gujarati', [0xa95, 0xabe]], ['Oriya', [0xb15, 0xb3e]],
  ['Tamil', [0xb95, 0xbbe]], ['Telugu', [0xc15, 0xc3e]], ['Kannada', [0xc95, 0xcbe]], ['Malayalam', [0xd15, 0xd3e]], ['Sinhala', [0xd85, 0xd9a]],
  ['Thai', [0xe01, 0xe34]], ['Lao', [0xe81, 0xeb4]], ['Tibetan', [0xf40, 0xf72]], ['Myanmar', [0x1000, 0x102c]], ['Georgian', [0x10d0, 0x10d1]],
  ['Hangul Jamo', [0x1100, 0x1161]], ['Ethiopic', [0x1200, 0x1201]], ['Cherokee', [0x13a0, 0x13a1]], ['Canadian syllabics', [0x1401, 0x1402]],
  ['Ogham', [0x1681, 0x1682]], ['Runic', [0x16a0, 0x16a1]], ['Khmer', [0x1780, 0x17b6]], ['Mongolian', [0x1820, 0x1821]],
  ['Latin Extended Additional', [0x1e00, 0x1ef9]], ['Greek Extended', [0x1f00, 0x1f01]],
  ['dagger and ellipsis', [0x2020, 0x2026]], ['per mille and reference mark', [0x2030, 0x203b]], ['superscripts', [0x2070, 0x2074]],
  ['euro and rupee', [0x20ac, 0x20b9]], ['bitcoin sign', [0x20bf]], ['trade mark and numero', [0x2122, 0x2116]], ['degree Celsius', [0x2103]],
  ['fraction and Roman numeral', [0x2153, 0x2160]], ['arrows', [0x2190, 0x21d2]], ['left right arrow', [0x2194]], ['math operators', [0x2200, 0x2260]],
  ['sum, integral, root', [0x2211, 0x222b, 0x221a]], ['place of interest and keyboard', [0x2318, 0x2328]], ['watch', [0x231a]], ['control pictures', [0x2400]],
  ['circled digits', [0x2460, 0x2461]], ['box drawing', [0x2500, 0x253c]], ['block elements', [0x2588, 0x2591]], ['geometric shapes', [0x25a0, 0x25cf]],
  ['play button', [0x25b6]], ['sun and star', [0x2600, 0x2605]], ['snowman', [0x2603]], ['telephone', [0x260e]], ['umbrella with rain', [0x2614]],
  ['frowning and smiling face', [0x2639, 0x263a]], ['heart suit and note', [0x2665, 0x266a]], ['recycling and warning', [0x267b, 0x26a0]], ['soccer ball', [0x26bd]],
  ['scissors and airplane', [0x2702, 0x2708]], ['check marks', [0x2713, 0x2714]], ['sparkles', [0x2728]], ['heavy heart', [0x2764]], ['right arrow dingbat', [0x27a1]],
  ['Braille', [0x2800, 0x28ff]], ['supplemental arrows', [0x2900]], ['miscellaneous math', [0x29c9]], ['star and black square', [0x2b50, 0x2b1b]],
  ['Glagolitic', [0x2c00]], ['Coptic', [0x2c80]], ['CJK radicals', [0x2e80]], ['Kangxi radicals', [0x2f00]], ['CJK punctuation', [0x3001, 0x3010]],
  ['part alternation mark', [0x303d]], ['Hiragana', [0x3042, 0x3044]], ['Katakana', [0x30a2, 0x30a4]], ['Bopomofo', [0x3105, 0x3106]],
  ['enclosed CJK', [0x3220]], ['circled congratulation', [0x3297]], ['CJK compatibility', [0x3300]], ['CJK Extension A', [0x3400, 0x4dbf]],
  ['Han', [0x4e00, 0x9fa5]], ['Han, Japanese words', [0x6f22, 0x5b57, 0x3068, 0x304b, 0x306a]], ['Yi', [0xa000]], ['Lisu', [0xa4d0]], ['Vai', [0xa500]],
  ['Hangul', [0xac00, 0xd55c]], ['private use', [0xe000]], ['CJK compatibility ideographs', [0xf900]], ['fi ligature', [0xfb01]],
  ['Arabic presentation forms', [0xfb50, 0xfe8d]], ['fullwidth and halfwidth', [0xff21, 0xff71]], ['replacement character', [0xfffd]],
  ['Linear B', [0x10000]], ['Gothic', [0x10330]], ['Deseret', [0x10400]], ['Phoenician', [0x10900]], ['cuneiform', [0x12000]], ['Egyptian hieroglyphs', [0x13000]],
  ['musical symbols', [0x1d11e]], ['math alphanumerics', [0x1d400, 0x1d4d0]], ['mahjong red dragon', [0x1f004]], ['domino', [0x1f030]],
  ['playing cards', [0x1f0a1]], ['joker', [0x1f0cf]], ['A button', [0x1f170]], ['Japanese here button', [0x1f201]], ['cyclone', [0x1f300]],
  ['thumbs up', [0x1f44d]], ['fire', [0x1f525]], ['grinning face', [0x1f600]], ['tears of joy', [0x1f602]], ['ornamental dingbats', [0x1f650]],
  ['rocket', [0x1f680]], ['alchemical', [0x1f700]], ['orange circle', [0x1f7e0]], ['supplemental arrows C', [0x1f800]], ['white heart', [0x1f90d]],
  ['smiling face with hearts', [0x1f970]], ['chess', [0x1fa00]], ['ballet shoes', [0x1fa70]], ['melting face', [0x1fae0]], ['legacy computing', [0x1fb00]],
  ['CJK Extension B', [0x20000, 0x2a6d6]], ['CJK Extension G', [0x30000]], ['unassigned', [0x378]], ['a letter and a lone surrogate', [0x61, 0xd83d]],
  ['heart with U+FE0F', [0x2764, 0xfe0f]], ['keycap', [0x31, 0xfe0f, 0x20e3]], ['flag', [0x1f1ef, 0x1f1f5]], ['thumbs up with a skin tone', [0x1f44d, 0x1f3fd]],
  ['woman technologist', [0x1f469, 0x200d, 0x1f4bb]], ['family', [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467]], ['a word and an emoji', [0x6f, 0x6b, 0x20, 0x1f600]],
  ['a word and a check mark', [0x6f, 0x6b, 0x20, 0x2713]],
];
const TEXT_PRESENTATION = [
  ['smiling face with U+FE0E', [0x263a, 0xfe0e]], ['heavy heart with U+FE0E', [0x2764, 0xfe0e]], ['grinning face with U+FE0E', [0x1f600, 0xfe0e]],
  ['snowman with U+FE0E', [0x2603, 0xfe0e]], ['watch with U+FE0E', [0x231a, 0xfe0e]], ['star with U+FE0E', [0x2b50, 0xfe0e]],
  ['thumbs up with U+FE0E', [0x1f44d, 0xfe0e]], ['copyright with U+FE0E', [0xa9, 0xfe0e]], ['trade mark with U+FE0E', [0x2122, 0xfe0e]],
  ['left right arrow with U+FE0E', [0x2194, 0xfe0e]],
];
const rowsOf = blocks => {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    out.push([blocks[i][0] + ', Arial', ARIAL, cp(...blocks[i][1])]);
    out.push([blocks[i][0] + ', the bench list', LIST, cp(...blocks[i][1])]);
  }
  return out;
};
`

const NAMES = String.raw`
const NAMED = [
  ['Hiragino Sans', 'Hiragino Sans'], ['Hiragino Sans, Japanese name', 'ヒラギノ角ゴシック'], ['Hiragino Mincho ProN, Japanese name', 'ヒラギノ明朝 ProN'],
  ['Hiragino Kaku Gothic ProN, Japanese name', 'ヒラギノ角ゴ ProN'], ['Hiragino Maru Gothic ProN, Japanese name', 'ヒラギノ丸ゴ ProN'],
  ['PingFang SC', 'PingFang SC'], ['PingFang SC, Chinese name', '苹方-简'], ['PingFang TC, Chinese name', '蘋方-繁'], ['PingFang HK, Chinese name', '蘋方-港'],
  ['Songti SC, Chinese name', '宋体-简'], ['Songti TC, Chinese name', '宋體-繁'], ['Heiti SC, Chinese name', '黑体-简'], ['Heiti TC, Chinese name', '黑體-繁'],
  ['STHeiti, Chinese name', '华文黑体'], ['STSong, Chinese name', '华文宋体'], ['Kaiti SC, Chinese name', '楷体-简'],
  ['Apple SD Gothic Neo', 'Apple SD Gothic Neo'], ['Apple SD Gothic Neo, Korean name', 'Apple SD 산돌고딕 Neo'], ['AppleGothic, Korean name', '애플고딕'], ['AppleMyungjo, Korean name', '애플명조'],
  ['YuGothic, Japanese name', '游ゴシック体'], ['YuMincho, Japanese name', '游明朝体'], ['Al Bayan, Arabic name', 'البيان'], ['Baghdad, Arabic name', 'بغداد'],
  ['Thonburi, Thai name', 'ธนบุรี'], ['Helvetica Neue', 'Helvetica Neue'], ['Helvetica Neue Light, a face name', 'Helvetica Neue Light'],
  ['HelveticaNeue-Light, a PostScript name', 'HelveticaNeue-Light'], ['Arial Bold, a face name', 'Arial Bold'], ['Arial-BoldMT, a PostScript name', 'Arial-BoldMT'],
  ['Avenir Next Condensed Heavy, a face name', 'Avenir Next Condensed Heavy'], ['Times New Roman Bold Italic, a face name', 'Times New Roman Bold Italic'],
  ['a family that does not exist', 'No Such Family Zq'],
];
const rowsOfNames = () => NAMED.map(row => [row[0], 'normal 400 32px "' + row[1] + '", monospace', 'Hamburgefonstiv 0123']);
`

const HOP = String.raw`
if (location.hostname !== 'localhost') {
  await new Promise(resolve => setTimeout(resolve, 15000));
  location.replace('http://localhost:' + location.port + location.pathname + location.search);
  await new Promise(() => {});
}
`

const OVER_TIME = String.raw`
const make = (font) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = 'en'; c.font = font; return c; };
const t0 = performance.now();
const kept = ROWS.map(row => make(row[1]));
const seen = ROWS.map(() => ({ kept: [], fresh: [] }));
const note = (list, width, ms) => { if (list.length === 0 || list[list.length - 1].width !== width) list.push({ width, fromMs: ms }); };
const readAll = () => {
  const ms = Math.round(performance.now() - t0);
  for (let i = 0; i < ROWS.length; i++) {
    note(seen[i].kept, kept[i].measureText(ROWS[i][2]).width, ms);
    note(seen[i].fresh, make(ROWS[i][1]).measureText(ROWS[i][2]).width, ms);
  }
};
readAll();
const firstPassMs = Math.round(performance.now() - t0);
for (let i = 0; i < 40; i++) {
  await new Promise(resolve => setTimeout(resolve, 250));
  readAll();
}
const rows = ROWS.map((row, i) => ({ what: row[0], font: row[1], text: row[2], codePoints: Array.from(row[2]).map(ch => ch.codePointAt(0).toString(16)), kept: seen[i].kept, fresh: seen[i].fresh }));
return {
  userAgent: navigator.userAgent, host: location.host, msSinceNavigationStart: Math.round(t0), strings: ROWS.length, firstPassMs, tookMs: Math.round(performance.now() - t0),
  keptContextsThatChanged: rows.filter(row => row.kept.length > 1),
  freshContextsThatChanged: rows.filter(row => row.fresh.length > 1).map(row => row.what),
  rows,
};
`

const PAGE_LANG = String.raw`
const lib = globalThis.storeAttack;
const TEXT = 'Hello, world Hello, world Hello, world Hello, world';
const WIDTHS = [300, 340, 360, 380, 400, 440];
const box = document.createElement('div');
document.body.append(box);
const domLines = (lang, width) => {
  box.setAttribute('lang', lang);
  box.style.cssText = 'font: 400 32px/60px serif; width: ' + width + 'px; white-space: normal; overflow-wrap: normal; position: absolute; left: 0; top: 0';
  box.textContent = TEXT;
  return Math.round(box.getBoundingClientRect().height / 60);
};
const rawKept = { '': null, en: null };
for (const lang of ['', 'en']) { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = lang; c.font = 'normal 400 32px serif'; rawKept[lang] = c; }
const keptLists = { '': [], en: [] };
const steps = [];
const step = async (pageLang) => {
  document.documentElement.lang = pageLang;
  await new Promise(done => requestAnimationFrame(() => done(null)));
  const row = { pageLang, byContentLang: {} };
  for (const lang of ['', 'en']) {
    const at = { rawKeptContext: rawKept[lang].measureText('Hello, world').width, widths: {} };
    for (let i = 0; i < WIDTHS.length; i++) {
      const width = WIDTHS[i];
      const keptList = lib.lines(TEXT, 'serif', 32, lang, width, keptLists[lang]).length;
      const newList = lib.lines(TEXT, 'serif', 32, lang, width, []).length;
      at.widths[width] = { dom: domLines(lang, width), keptList, newList };
    }
    row.byContentLang[lang === '' ? 'lang=""' : lang] = at;
  }
  steps.push(row);
};
await step('en');
await step('ja');
await step('zh-CN');
await step('en');
box.remove();
const differing = [];
for (let s = 0; s < steps.length; s++) for (const lang in steps[s].byContentLang) for (const width in steps[s].byContentLang[lang].widths) {
  const at = steps[s].byContentLang[lang].widths[width];
  if (at.keptList !== at.newList) differing.push({ pageLang: steps[s].pageLang, contentLang: lang, width: Number(width), dom: at.dom, keptList: at.keptList, newList: at.newList });
}
return { userAgent: navigator.userAgent, keptListAgainstNewList: differing, storedAnswers: Object.values(keptLists).map(list => list.map(context => context.widths === undefined ? null : context.widths.size)), steps };
`

export default async function storeAttackProbes(): Promise<Probe[]> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'store-attack-probe-entry.ts')], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  const bundle = await built.outputs[0]!.text()
  return [{
    id: 'store-attack A1', spec: 'store prototype: one kept context a string over ten seconds in a browser that has just started, a sweep of Unicode blocks', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${SAMPLES}\nconst ROWS = rowsOf(BLOCKS);\n${OVER_TIME}` }],
  }, {
    id: 'store-attack A2', spec: 'store prototype: the same sweep after ten strings that hold U+FE0E', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${SAMPLES}\nconst ROWS = rowsOf(TEXT_PRESENTATION.concat(BLOCKS));\n${OVER_TIME}` }],
  }, {
    id: 'store-attack A3', spec: 'store prototype: one kept context of a family named by a localized or a face name, over ten seconds', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${NAMES}\nconst ROWS = rowsOfNames();\n${OVER_TIME}` }],
  }, {
    id: 'store-attack A5', spec: 'store prototype: one kept context a string over ten seconds in a browser that has just started, the bitcoin sign alone', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${SAMPLES}\nconst ROWS = [['bitcoin sign, the bench list', LIST, cp(0x20bf)], ['a sentence with the bitcoin sign, the bench list', LIST, 'that is 5 ' + cp(0x20bf) + ' a month'], ['a plain word, the bench list', LIST, 'Hamburgefonstiv']];\n${OVER_TIME}` }],
  }, {
    id: 'store-attack A6', spec: 'store prototype: the sweep after strings that hold U+FE0E, in a new content process of a browser that has been up 15 seconds', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${SAMPLES}\n${HOP}\nconst ROWS = rowsOf(TEXT_PRESENTATION.concat(BLOCKS));\n${OVER_TIME}` }],
  }, {
    id: 'store-attack A4', spec: 'store prototype: the library with one kept list under a changing <html lang>, beside the DOM', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundle}\n${PAGE_LANG}` }],
  }]
}
