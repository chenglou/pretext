// WebKit port round 4 probes (webkit-host, the system WebKit Safari 27.0 runs; DPR 2). Measurement only: the Range rect of a
// text node (the text box's float32 width) against measureText widths from a main-thread OffscreenCanvas.
//
// R7, which family draws a character under a Han, kana or Hangul locale. FontCascadeFonts::glyphDataForVariant walks the
// font list and takes the first family whose font has a glyph (FontCascadeFonts.cpp:426-470); a family named by a string is
// looked up by name alone (fontWithFamily, FontCacheCoreText.cpp:624-643: only fontDescriptorWithFamilySpecialCase, the
// system-ui names, reads the locale), and its glyph page is CTFontGetGlyphsForCharacters of that font
// (GlyphPageCoreText.cpp:51-73), which takes no language. The locale enters at the CSS generics
// (FontDescriptionCocoa.cpp:77-118), the system-ui names (FontCacheCoreText.cpp:585-598) and system fallback after the
// list (lookupFallbackFont, FontCacheCoreText.cpp:775-790, :822). Hypothesis H7: a character a named family draws (in
// Canvas the family followed by LastResort gives the family's own advance and not LastResort's box) measures the same in the
// DOM under every language as in Canvas; a character no named family draws comes from system fallback and can differ under
// ja, ko and zh-*. Round 3's R3b read `"PingFang SC"` drawing kana at Apple SD Gothic Neo's advance under ko as a named
// family that doesn't settle its own characters; H7 says the family has no kana glyph in this process (the WebContent
// process resolves the name to the system's reserved PingFangUI.ttc, which has Han and no kana or U+2027, where an
// unsandboxed process finds the downloaded PingFang.ttc asset, which has both).
//
// R8, the glyph count of a long string. measure.ts counts a string's spacing-bearing glyphs as the total at 64px of letter
// spacing less the total at none, over 64. Both totals are float32 sums (WidthIterator.cpp:440-488, :654-690), so the count
// is exact while their rounding stays under 32px. Per font and length n: the residual of (W64 - W0) / 64 against n for a
// string without ligatures.
//
// R10, shares of text shaped across inline boxes. LineBuilder::applyShapingOnRunRange shapes the range's text as one run and
// gives each text run the base advances of its own characters (InlineLineBuilder.cpp:920-967,
// ComplexTextController.cpp:186-205). Canvas shows totals only. Candidates for a run's share, T the joined text, J = U+200D
// where the neighbour joins:
// - A: W(J + t + J), the run in a joining context (round 3);
// - B: suffix differences, W(J + T[k..]) - W(J + T[k+1..]): the run with the text that follows it, which assumes the text
//   before a letter reaches it through joining alone; the shares add up to W(T);
// - C: prefix differences with J appended, W(T[..k] + J) - W(T[..k-1] + J): assumes the text after a letter reaches it
//   through joining alone; the shares add up to W(T);
// - D: plain prefix differences (round 2), which reshape the letter at each cut.
// Per font, letter spacing and run texts: the DOM's text boxes in a wide RTL block against the Canvas totals each candidate
// needs.
//
// Run: python3 .artifacts/session/with-browser-lock.py probes-webkit-round4 -- \
//   bun rebuild/probes/runner.ts --browser=webkit-host --probes=rebuild/probes/webkit-round4.ts --out=.artifacts/probes/webkit/round4
import type { Probe } from './types.ts'

const HELPERS = String.raw`
const ctxOf = (font, letterSpacing) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.font = font; c.letterSpacing = letterSpacing + 'px';
  return c;
};
const boxWidth = node => {
  const range = document.createRange();
  range.selectNodeContents(node);
  return [...range.getClientRects()].reduce((a, r) => a + r.width, 0);
};
`

const R7 = String.raw`
const out = [];
for (const family of FAMILIES) {
  const plain = ctxOf(SIZE + 'px ' + family, 0);
  const named = ctxOf(SIZE + 'px ' + family + ', LastResort', 0);
  const lastResort = ctxOf(SIZE + 'px LastResort', 0);
  const rows = [];
  for (const text of TEXTS) {
    const canvas = plain.measureText(text).width;
    const canvasNamed = named.measureText(text).width;
    const canvasLastResort = lastResort.measureText(text).width;
    const dom = {};
    const domNamed = {};
    for (const lang of LANGS) {
      for (const withLastResort of [false, true]) {
        const div = document.createElement('div');
        div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; white-space: pre';
        div.style.font = SIZE + 'px ' + family + (withLastResort ? ', LastResort' : '');
        if (lang !== null) div.lang = lang;
        const node = document.createTextNode(text);
        div.append(node);
        host.append(div);
        (withLastResort ? domNamed : dom)[String(lang)] = boxWidth(node);
        div.remove();
      }
    }
    rows.push({ text, canvas, canvasNamed, canvasLastResort, dom, domNamed });
  }
  out.push({ family, rows });
}
return out;
`

const R8 = String.raw`
const out = [];
for (const font of FONTS) {
  const plain = ctxOf(font, 0);
  const big = ctxOf(font, 64);
  for (const n of LENGTHS) {
    let text = '';
    for (let i = 0; i < n; i++) text += UNIT[i % UNIT.length];
    const w0 = plain.measureText(text).width;
    const w64 = big.measureText(text).width;
    out.push({ font, n, w0, w64, count: (w64 - w0) / 64 });
  }
}
return out;
`

const R10 = String.raw`
const J = '‍';
const out = [];
for (const font of FONTS) for (const letterSpacing of SPACINGS) {
  const plain = ctxOf(font, 0);
  for (const texts of RUNS) {
    const div = document.createElement('div');
    div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 60px; white-space: pre; width: 3000px; direction: rtl';
    div.style.font = font;
    div.style.letterSpacing = letterSpacing + 'px';
    const nodes = [];
    for (const text of texts) {
      const span = document.createElement('span');
      const node = document.createTextNode(text);
      span.append(node);
      div.append(span);
      nodes.push(node);
    }
    host.append(div);
    const dom = nodes.map(boxWidth);
    div.remove();
    // One box holding the joined text: the unsplit width.
    const whole = document.createElement('div');
    whole.style.cssText = div.style.cssText;
    whole.style.font = font;
    whole.style.letterSpacing = letterSpacing + 'px';
    const wholeNode = document.createTextNode(texts.join(''));
    whole.append(wholeNode);
    host.append(whole);
    const domWhole = boxWidth(wholeNode);
    whole.remove();
    // Every Canvas total a candidate can ask for, by string: each run with and without J on either side, each suffix with and
    // without J before it, each prefix with and without J after it, each pair of neighbours; and the same strings at 64px of
    // letter spacing, which counts spacing-bearing glyphs (a ligature across an edge counts one glyph for two letters).
    const big = ctxOf(font, 64);
    const widths = {};
    const counts = {};
    const ask = s => { if (widths[s] === undefined) { widths[s] = plain.measureText(s).width; counts[s] = Math.round((big.measureText(s).width - widths[s]) / 64); } };
    const T = texts.join('');
    ask(T);
    for (let k = 0; k < texts.length; k++) {
      for (const before of ['', J]) for (const after of ['', J]) ask(before + texts[k] + after);
      for (const before of ['', J]) ask(before + texts.slice(k).join(''));
      for (const after of ['', J]) ask(texts.slice(0, k + 1).join('') + after);
      if (k + 1 < texts.length) ask(texts[k] + texts[k + 1]);
    }
    out.push({ font, letterSpacing, texts, dom, domWhole, widths, counts });
  }
}
return out;
`

const R11 = String.raw`
// Per language and CSS generic family: the DOM's box of each text, and the Canvas totals of the same text under the bare
// keyword and under each candidate family name, so the family the DOM drew with shows as an equal width.
const out = [];
for (const lang of LANGS) for (const generic of GENERICS) {
  const row = { lang, generic, texts: [] };
  for (const text of TEXTS) {
    const div = document.createElement('div');
    div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; white-space: pre';
    div.style.font = '16px ' + generic;
    if (lang !== null) div.lang = lang;
    const node = document.createTextNode(text);
    div.append(node);
    host.append(div);
    const dom = boxWidth(node);
    div.remove();
    row.texts.push({ text, dom });
  }
  out.push(row);
}
const canvas = {};
for (const family of [...GENERICS, ...CANDIDATES.map(name => '"' + name + '"')]) {
  const c = ctxOf('16px ' + family, 0);
  canvas[family] = TEXTS.map(text => c.measureText(text).width);
}
return { rows: out, canvas };
`

const R12 = String.raw`
// Named families under languages, whole strings: whether the locale reaches a named family's shaping (Font::applyTransforms and
// the complex text controller hand Core Text the computed locale, FontCoreText.cpp:646-700, ComplexTextControllerCoreText.mm:199-203).
const out = [];
for (const font of FONTS) {
  const c = ctxOf(font, 0);
  for (const text of TEXTS) {
    const canvas = c.measureText(text).width;
    const dom = {};
    for (const lang of LANGS) {
      const div = document.createElement('div');
      div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; white-space: pre';
      div.style.font = font;
      div.lang = lang;
      const node = document.createTextNode(text);
      div.append(node);
      host.append(div);
      dom[lang] = boxWidth(node);
      div.remove();
    }
    out.push({ font, text, canvas, dom });
  }
}
return out;
`

function probe(id: string, spec: string, constants: Record<string, unknown>, body: string, fixtures?: string[], timeoutNote?: string): Probe {
  let header = ''
  for (const name of Object.keys(constants)) header += `const ${name} = ${JSON.stringify(constants[name])}; `
  return {
    id, spec, pageLang: 'en', ...(fixtures === undefined ? {} : { fontFixtures: fixtures }), html: '<div id="t"></div>',
    ...(timeoutNote === undefined ? {} : { note: timeoutNote }),
    observe: [{ kind: 'script', source: `${HELPERS}\n${header}\n${body}` }],
  }
}

const LANGS = [null, 'en', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'zh-HK']
// Han (shared, Japanese and Korean forms, extension B, compatibility), kana, Hangul and jamo, CJK punctuation, fullwidth and
// halfwidth forms, Bopomofo, vertical forms, enclosed ideographs, and characters outside those blocks that CJK fonts draw.
const CJK_TEXTS = ['中', '国', '語', '說', '臺', '骨', '直', '刃', '𠀋', '﨑', 'あ', 'ア', 'ぁ', 'ー', 'ｱ', '𛀁', '한', '국', 'ᄒ', 'ㄱ', '、', '。', '「', '」', '〜', '々', '〇', 'Ａ', '１', '！', '，', '（', '）', '￥', 'ㄅ', '︰', '🈁', '‧', '—', '…', '·', '“', '’', '¥', 'a', '1']
const NAMED_CJK = ['"PingFang SC"', '"PingFang TC"', '"PingFang HK"', '"Hiragino Sans"', '"Hiragino Mincho ProN"', '"Hiragino Kaku Gothic ProN"', '"Hiragino Sans GB"', '"Apple SD Gothic Neo"', 'AppleGothic', 'AppleMyungjo']
const NAMED_CJK_2 = ['"Songti SC"', '"Songti TC"', '"Heiti SC"', '"Heiti TC"', 'STSong', 'STHeiti', '"Kaiti SC"', '"LiHei Pro"', '"LiSong Pro"', '"BIZ UDGothic"', 'Osaka']
const NAMED_OTHER = ['Arial', '"Times New Roman"', '"Helvetica Neue"', 'Helvetica', 'Georgia', 'Verdana', 'Menlo', '"Courier New"', '"Lucida Grande"', '"Geeza Pro"', 'Thonburi', '"Arial Unicode MS"']

const GENERIC_LANGS = [null, '', 'en', 'en-US', 'EN', 'fr', 'de', 'da', 'sv', 'ru', 'tr', 'el', 'vi', 'ar', 'fa', 'ur', 'he', 'th', 'hi', 'bn', 'my', 'km', 'ka', 'hy', 'ja', 'ko', 'zh', 'zh-Hans', 'zh-CN', 'zh-Hant', 'zh-TW', 'zh-HK', 'yue', 'mul', 'und', 'x-none']
const GENERIC_CANDIDATES = ['Times', 'Times New Roman', 'Helvetica', 'Courier', 'Courier New', 'Menlo', 'Monaco', 'Apple Chancery', 'Papyrus', 'Zapfino', 'Snell Roundhand', 'Geeza Pro', 'Noto Nastaliq Urdu', 'Lucida Grande', 'Arial Hebrew', 'Thonburi', 'ITF Devanagari', 'Kohinoor Devanagari', 'Kohinoor Bangla', 'Noto Serif Myanmar', 'Noto Sans Myanmar', 'Khmer MN', 'Khmer Sangam MN', 'Noto Sans Armenian', 'Hiragino Mincho ProN', 'Hiragino Sans', 'AppleMyungjo', 'Apple SD Gothic Neo', 'Songti SC', 'Songti TC', 'PingFang SC', 'PingFang TC', 'PingFang HK', 'Kaiti SC', 'Kaiti TC']
const ARABIC_RUNS = [
  ['ببب', 'ببب'], ['بب', 'ببب'], ['ب', 'ببب'], ['ببب', 'ب'], ['ب', 'ب'], ['سلا', 'م'], ['الس', 'لام'], ['لل', 'ه'], ['ل', 'ا'], ['مح', 'مد'], ['في', 'ها'], ['كت', 'اب'],
  ['در', 'س'], ['با', 'ب'], ['نستع', 'ليق'], ['بِ', 'بِ'], ['عر', 'بي'], ['خط', 'وط'], ['تح', 'ية'], ['ين', 'بغي'], ['ب', 'ب', 'ب'], ['سل', 'ا', 'م'], ['بب', 'بب', 'بب'], ['مح', 'م', 'د'],
  ['الرَّحِي', 'مِ'], ['كتا', 'بة'], ['مستش', 'فى'], ['يستخد', 'مون'], ['جم', 'يل'], ['شك', 'را'], ['لغ', 'ة'], ['مر', 'حبا'], ['تث', 'بيت'], ['بين', 'هما'], ['ال', 'له'], ['عل', 'ي', 'كم'],
]

export default async function round4Probes(): Promise<Probe[]> {
  return [
    probe('webkit-round4 R7 (named CJK families by language)', 'webkit-canvas §1.3 locale; round 4 R7', { LANGS, FAMILIES: NAMED_CJK, TEXTS: CJK_TEXTS, SIZE: 18 }, R7),
    probe('webkit-round4 R7 (more named CJK families by language)', 'webkit-canvas §1.3 locale; round 4 R7', { LANGS, FAMILIES: NAMED_CJK_2, TEXTS: CJK_TEXTS, SIZE: 18 }, R7),
    probe('webkit-round4 R7 (other named families by language)', 'webkit-canvas §1.3 locale; round 4 R7', { LANGS, FAMILIES: NAMED_OTHER, TEXTS: CJK_TEXTS, SIZE: 18 }, R7),
    probe('webkit-round4 R8 (glyph count of long strings)', 'webkit-canvas §1.3 letter spacing; round 4 R8', { FONTS: ['16px Arial', '16px "Times New Roman"', '13px Verdana', '48px Georgia', '16px Menlo'], LENGTHS: [10, 100, 1000, 2000, 5000, 10000, 20000, 50000], UNIT: 'abcdeghijk' }, R8),
    probe('webkit-round4 R12 (named families under languages, whole strings)', 'webkit-canvas §1.3 locale; round 4 R12', { LANGS: ['', 'en', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'th', 'hi', 'ar', 'tr'], FONTS: ['16px "Hiragino Mincho ProN"', '16px "Hiragino Sans"', '16px "Songti SC"', '16px "PingFang SC"', '16px AppleMyungjo', '16px "Apple SD Gothic Neo"', '16px Thonburi', '16px "Kohinoor Devanagari"', '16px "Kohinoor Bangla"', '16px "Geeza Pro"', '16px Menlo', '16px Times', '16px Helvetica', '18px Arial', '16px Georgia'], TEXTS: ['Hamburgefonstiv', '0123456789', 'AVATAR', 'To Wave,', 'office fi', 'Hamburgefonstiv 0123456789', '“‘…—·¥’”', '“quoted”', '‘a’', '「、。」（！）', '中国語說臺', 'あア、いう。', '한국어', 'สวัสดี', 'नमस्ते', 'سلام', 'fıne', 'fi'] }, R12),
    probe('webkit-round4 R11 (CSS generic families by language)', 'webkit-canvas §1.3 locale; round 4 R11', { LANGS: GENERIC_LANGS, GENERICS: ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', '-webkit-standard'], CANDIDATES: GENERIC_CANDIDATES, TEXTS: ['Hamburgefonstiv 0123456789', '“‘…—·¥’”', '→≤✓│', 'سلام', 'שלום', 'สวัสดี', 'नमस्ते', 'বাংলা', 'မြန်မာ', 'ខ្មែរ', '中国語說臺', 'あア', '한국어', '「、。」（！）'] }, R11),
    probe('webkit-round4 R10 (shares across inline boxes, installed fonts)', 'webkit-lines shaping across inline boxes; round 4 R10', { FONTS: ['16px "Geeza Pro"', '16px Arial', '16px "Times New Roman"', '16px "Courier New"', '16px "Al Bayan"', '20px "Al Nile"'], SPACINGS: [0, 1], RUNS: ARABIC_RUNS }, R10),
    probe('webkit-round4 R10 (shares across inline boxes, fixture fonts)', 'webkit-lines shaping across inline boxes; round 4 R10', { FONTS: ['24px Amiri', '16px Amiri', '16px "Noto Naskh Arabic"', '18px "Noto Nastaliq Urdu"'], SPACINGS: [0, 1], RUNS: ARABIC_RUNS }, R10, ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu']),
  ]
}
