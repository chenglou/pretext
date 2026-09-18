// WebKit port round 3 probes (webkit-host, the system WebKit Safari 27.0 runs; DPR 2). Measurement only: the Range rect of a
// text node (the text box's float32 width) against measureText widths from a main-thread OffscreenCanvas.
//
// R1, letter spacing and ligatures. The DOM turns off liga, clig, dlig and hlig where letter-spacing isn't 0
// (StyleComputedStyleBase.cpp:324-331, UnrealizedCoreTextFont.cpp:258-264); an OffscreenCanvas context keeps them, because
// setLetterSpacing changes the FontCascade's spacing and not its description (CanvasRenderingContext2DBase.cpp:3271-3296,
// FontCascade.cpp:81). WidthIterator adds letter spacing once per character that still has glyphs of non-zero width after
// shaping (applyExtraSpacingAfterShaping, WidthIterator.cpp:654-690; calculateAdditionalWidth :491-517), and the complex text
// controller once per glyph with an advance, so a ligature takes one spacing where its letters take one each. Hypotheses:
// - H1: W at letter spacing S minus W at 0 is S times the number of spacing-bearing glyphs, so Canvas shows where a ligature
//   merged glyphs: a pair whose count is lower than its two letters' counts;
// - H2: a string without such a pair measures the same in Canvas as in the letter-spaced DOM;
// - H3: with U+200C between the letters of each such pair, Canvas measures what the letter-spaced DOM lays out (the glyph
//   between them keeps the lookup from matching; WidthIterator commits a default-ignorable without a glyph as a deleted
//   glyph of width 0, WidthIterator.cpp:300-325, :462-468).
//
// R2, simplified measuring and a following space. A box that allows simplified measuring sums the shaped advances of the
// primary font's glyphs in one float32 loop (FontCascade::widthForSimpleTextSlow, FontCascade.cpp:381-412). Canvas runs
// WidthIterator: the unshaped sum plus (shaped sum less unshaped sum), after it puts every character treated as a space back
// to its unshaped advance (applyFontTransforms, WidthIterator.cpp:84-120). The shaped and unshaped sums are within a factor
// of two of each other, so their float32 difference is exact (Sterbenz) and the WidthIterator total is the shaped sum: the two
// paths agree unless shaping changed a space's own advance. A text item is measured with the U+0020 that follows it
// (TextUtil.cpp:72-89), so the space is the last glyph, and a pair adjustment between the last letter and the space moves it
// only if it sits on the pair's second glyph. Hypothesis H4: for every ASCII character x, the pre box `x` U+0020 is as wide as
// f32(f32(W(`x` U+0020) - W(U+0020)) + W(U+0020)), also where Canvas shows a pair adjustment (W(`x` U+0020) isn't the float32
// sum of W(`x`) and W(U+0020)). H5, the reverse: a box measuring U+0020 before a letter in one string (a preserved run
// `x` U+0020 U+0020 `y` has none; only U+0020 U+0020 runs do) isn't probed here.
//
// R3, the locale and system fallback. The DOM passes a box's locale to system fallback (FontCache::systemFallbackForCharacterCluster,
// FontCacheCoreText.cpp:822, through lookupFallbackFont's CTFontCreateForCharactersWithLanguageAndOption); an OffscreenCanvas
// has none (specs/webkit-canvas.md §1.3). Core Text is closed, so which languages change its choice for Han, kana, Hangul, CJK
// punctuation and fullwidth forms is a browser fact. Hypothesis H6: under a language whose script isn't Han, kana or Hangul
// the DOM's fallback glyphs have the advances Canvas gives without a locale; under ja, ko and zh-* they can differ. Per
// language, primary font and string: the DOM box of a `lang` span against the Canvas total.
//
// R5, controls between kerned letters (SUPERSET-webkit §3.4; rule/controls). Canvas turns U+0009-U+000D into spaces
// (CanvasRenderingContext2DBase.cpp:2847-2875), so the port measures VT and FF as U+0001 and CR as U+0000
// (engines/webkit/measure.ts canvasString). Per font, control C and letter pair: the DOM's pre box of `A` C `V` against Canvas
// totals of candidate strings, to find what the DOM's glyph for C does to the advances around it.
//
// Run: python3 .artifacts/session/with-browser-lock.py probes-webkit-round3 -- \
//   bun rebuild/probes/runner.ts --browser=webkit-host --probes=rebuild/probes/webkit-round3.ts --out=.artifacts/probes/webkit/round3
import type { Probe } from './types.ts'

const HELPERS = String.raw`
const ctxOf = (font, letterSpacing) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.font = font; c.letterSpacing = letterSpacing + 'px';
  return c;
};
const dom = (font, letterSpacing, direction, text) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; white-space: pre; direction: ' + direction;
  div.style.font = font;
  div.style.letterSpacing = letterSpacing + 'px';
  const node = document.createTextNode(text);
  div.append(node);
  host.append(div);
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = [...range.getClientRects()];
  const width = rects.reduce((a, r) => a + r.width, 0);
  div.remove();
  return { width, rects: rects.length };
};
const codePoints = text => { const out = []; for (const ch of text) out.push(ch); return out; };
`

const R1 = String.raw`
const BIG = 64;
const unit = (font, letterSpacing, direction, text) => {
  const spaced = ctxOf(font, letterSpacing);
  const plain = ctxOf(font, 0);
  const big = ctxOf(font, BIG);
  const count = s => Math.round((big.measureText(s).width - plain.measureText(s).width) / BIG);
  const cps = codePoints(text);
  const singles = cps.map(count);
  const merged = [];
  for (let i = 0; i + 1 < cps.length; i++) if (count(cps[i] + cps[i + 1]) < singles[i] + singles[i + 1]) merged.push(i);
  let separated = '';
  for (let i = 0; i < cps.length; i++) separated += cps[i] + (merged.includes(i) ? '‌' : '');
  let chain = 0;
  for (let i = 0; i < cps.length; i++) chain = Math.fround(chain + spaced.measureText(cps[i]).width);
  const d = dom(font, letterSpacing, direction, text);
  const d0 = dom(font, 0, direction, text);
  return {
    font, letterSpacing, text, dom: d.width, domRects: d.rects, domAtZero: d0.width,
    canvas: spaced.measureText(text).width, canvasAtZero: plain.measureText(text).width,
    glyphs: count(text), singles: singles.reduce((a, b) => a + b, 0), mergedPairs: merged,
    separated: spaced.measureText(separated).width, singlesChain: chain,
    equal: { canvas: spaced.measureText(text).width === d.width, separated: spaced.measureText(separated).width === d.width, singlesChain: chain === d.width },
  };
};
const out = [];
for (const font of FONTS) for (const letterSpacing of SPACINGS) for (const text of TEXTS) out.push(unit(font, letterSpacing, DIRECTION, text));
return out;
`

const R2 = String.raw`
const out = [];
for (const font of FONTS) {
  const c = ctxOf(font, 0);
  const space = c.measureText(' ').width;
  let pairs = 0, adjusted = 0, equal = 0, adjustedEqual = 0;
  const misses = [];
  for (let code = 0x21; code <= 0x7e; code++) {
    const x = String.fromCharCode(code);
    const withSpace = c.measureText(x + ' ').width;
    const isAdjusted = withSpace !== Math.fround(c.measureText(x).width + space);
    const expected = Math.fround(Math.fround(withSpace - space) + space);
    const d = dom(font, 0, 'ltr', x + ' ').width;
    pairs++;
    if (isAdjusted) adjusted++;
    if (d === expected) { equal++; if (isAdjusted) adjustedEqual++; }
    else if (misses.length < 12) misses.push({ x, dom: d, expected, withSpace, alone: c.measureText(x).width, space });
  }
  out.push({ font, pairs, adjusted, equal, adjustedEqual, misses });
}
return out;
`

const R3 = String.raw`
const out = [];
for (const lang of LANGS) {
  let strings = 0, equal = 0;
  const misses = [];
  for (const font of FONTS) {
    const c = ctxOf(font, 0);
    for (const text of TEXTS) {
      const div = document.createElement('div');
      div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; white-space: pre';
      div.style.font = font;
      if (lang !== null) div.lang = lang;
      const node = document.createTextNode(text);
      div.append(node);
      host.append(div);
      const range = document.createRange();
      range.selectNodeContents(node);
      const d = [...range.getClientRects()].reduce((a, r) => a + r.width, 0);
      div.remove();
      const w = c.measureText(text).width;
      strings++;
      if (d === w) equal++;
      else if (misses.length < 8) misses.push({ font, text, dom: d, canvas: w });
      if (LANGS.length <= 4) misses.push({ font, text, dom: d, canvas: w, all: true });
    }
  }
  out.push({ lang, strings, equal, misses });
}
return out;
`

// Controls are built from code points in the page, so no control character sits in this file or in the probe's source.
const R5 = String.raw`
const out = [];
const ch = code => String.fromCharCode(code);
for (const font of FONTS) {
  const c = ctxOf(font, 0);
  const w = s => c.measureText(s).width;
  for (const code of CONTROLS) {
    for (const [a, b] of PAIRS) {
      const text = a + ch(code) + b;
      const d = dom(font, 0, 'ltr', text).width;
      const candidates = {
        asU0001: w(a + ch(1) + b), asU0000: w(a + ch(0) + b), itself: w(text),
        partsU0001: Math.fround(Math.fround(w(a) + w(ch(1))) + w(b)), partsNothing: Math.fround(w(a) + w(b)), kerned: w(a + b),
        zwnjU0001: w(a + ch(0x200c) + ch(1) + ch(0x200c) + b), zwnjOnly: w(a + ch(0x200c) + b),
        spaceSwap: Math.fround(Math.fround(w(a + ' ' + b) - w(' ')) + w(ch(1))),
        beforeSpaceSwap: Math.fround(Math.fround(Math.fround(w(a + ' ') - w(' ')) + w(ch(1))) + w(b)),
        nbspSwap: Math.fround(Math.fround(w(a + ch(0xa0) + b) - w(ch(0xa0))) + w(ch(1))),
        spaceGone: Math.fround(w(a + ' ' + b) - w(' ')),
        beforeSpaceGone: Math.fround(Math.fround(w(a + ' ') - w(' ')) + w(b)),
      };
      const equal = Object.keys(candidates).filter(k => candidates[k] === d);
      out.push({ font, control: code.toString(16), pair: a + b, dom: d, candidates, equal });
    }
  }
}
return out;
`

function r5(id: string, fonts: string[], controls: number[], pairs: Array<[string, string]>): Probe {
  return {
    id, spec: 'webkit-text §5.3 controls; round 3 R5', pageLang: 'en', html: '<div id="t"></div>',
    observe: [{ kind: 'script', source: `${HELPERS}\nconst FONTS = ${JSON.stringify(fonts)}; const CONTROLS = ${JSON.stringify(controls)}; const PAIRS = ${JSON.stringify(pairs)};\n${R5}` }],
  }
}

function r3(id: string, langs: Array<string | null>, fonts: string[], texts: string[]): Probe {
  return {
    id, spec: 'webkit-canvas §1.3 locale and system fallback; round 3 R3', pageLang: 'en', html: '<div id="t"></div>',
    observe: [{ kind: 'script', source: `${HELPERS}\nconst LANGS = ${JSON.stringify(langs)}; const FONTS = ${JSON.stringify(fonts)}; const TEXTS = ${JSON.stringify(texts)};\n${R3}` }],
  }
}

function r2(id: string, fonts: string[], fixtures: string[] | undefined): Probe {
  return {
    id, spec: 'webkit-gaps §2 simplified measuring; round 3 R2', pageLang: 'en', ...(fixtures === undefined ? {} : { fontFixtures: fixtures }),
    html: '<div id="t"></div>',
    observe: [{ kind: 'script', source: `${HELPERS}\nconst FONTS = ${JSON.stringify(fonts)};\n${R2}` }],
  }
}

function r1(id: string, fonts: string[], spacings: number[], texts: string[], fixtures: string[] | undefined, direction = 'ltr'): Probe {
  return {
    id, spec: 'webkit-canvas §1.3 letter spacing and ligatures; round 3 R1', pageLang: 'en', ...(fixtures === undefined ? {} : { fontFixtures: fixtures }),
    html: '<div id="t"></div>',
    observe: [{ kind: 'script', source: `${HELPERS}\nconst FONTS = ${JSON.stringify(fonts)}; const SPACINGS = ${JSON.stringify(spacings)}; const TEXTS = ${JSON.stringify(texts)}; const DIRECTION = ${JSON.stringify(direction)};\n${R1}` }],
  }
}

const LATIN = ['office', 'ffiffl', 'waffles', 'efficient', 'fleeting', 'stiff', 'fi', 'AVATAR', 'To Wave', 'Type', 'hello world', 'officeoffice']

export default async function round3Probes(): Promise<Probe[]> {
  return [
    r1('webkit-round3 R1 (fixture fonts, Latin)', ['700 16px ProbeShantell', '16px "Shantell Sans"', '16px Amiri', '24px Amiri'], [1, -1, -4, 0.5], LATIN, ['ProbeShantell', 'Shantell Sans', 'Amiri']),
    r1('webkit-round3 R1 (installed fonts, Latin)', ['16px "Helvetica Neue"', '16px "Times New Roman"', '16px Georgia', '16px Arial', '18px Verdana', '16px "Hoefler Text"', '16px Menlo', '15px Futura'], [1, -1, 0.5], LATIN, undefined),
    r1('webkit-round3 R1 (Arabic)', ['16px "Times New Roman"', '16px "Geeza Pro"', '16px "Courier New"', '16px Arial'], [1, -1], ['صلىالله', 'لالِا', 'الله', 'لا', 'سلام', 'بِبِ', 'كل'], undefined, 'rtl'),
    r2('webkit-round3 R2 (installed fonts)', ['16px Arial', '16px "Times New Roman"', '16px Georgia', '16px Verdana', '16px "Helvetica Neue"', '13px "Helvetica Neue"', '16px Helvetica', '16px "Hoefler Text"', '15px Futura', '16px "Hiragino Sans"', '16px "PingFang SC"', '16px Thonburi', '18.5px Georgia', 'italic 16px "Times New Roman"', '700 16px Arial', '16px Optima', '16px Baskerville', '16px Palatino', '16px "Gill Sans"', '16px Didot'], undefined),
    r2('webkit-round3 R2 (fixture fonts)', ['16px "Shantell Sans"', '700 16px ProbeShantell', '16px Amiri', '24px Amiri', '16px "Noto Naskh Arabic"'], ['Shantell Sans', 'ProbeShantell', 'Amiri', 'Noto Naskh Arabic']),
    r3('webkit-round3 R3 (system fallback by language)', [null, '', 'en', 'en-US', 'fr', 'de', 'ru', 'el', 'ar', 'he', 'fa', 'ur', 'th', 'hi', 'bn', 'vi', 'tr', 'und', 'ja', 'ko', 'zh', 'zh-Hans', 'zh-CN', 'zh-Hant', 'zh-TW', 'zh-HK'],
      ['16px Arial', '16px "Times New Roman"', '16px "Helvetica Neue"', '16px Georgia', '16px Menlo', '16px "Courier New"', '18px Verdana', '16px "Geeza Pro"', '16px Thonburi'],
      ['中国語', '国', '說', 'あア', 'ぁ', '한국어', '「、。」', '，', 'Ａ１！', '中a中', '〜', '々', '한a']),
    r3('webkit-round3 R3b (named CJK fonts by language)', [null, 'en', 'fr', 'ru', 'ar', 'th', 'hi', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'zh-HK'],
      ['16px "PingFang SC"', '16px "PingFang TC"', '16px "Hiragino Sans"', '16px "Hiragino Mincho ProN"', '16px "Apple SD Gothic Neo"', '16px "Songti SC"', '18px "Hiragino Sans", "PingFang SC", "Apple SD Gothic Neo", Arial, sans-serif', '16px Arial, "Hiragino Sans", sans-serif', '16px serif', '16px sans-serif'],
      ['中国語', '說', 'あア', 'ぁ', '한국어', '「、。」', '，', 'Ａ１！', '‧', '——', '¥', '“”', '‘’', '…', '·', 'abc', '12,800', '（含税）']),
    r3('webkit-round3 R3c (one character through a list)', ['en', 'hi', 'zh-Hant', 'ko'],
      ['18px "Hiragino Sans"', '18px "PingFang SC"', '18px "Apple SD Gothic Neo"', '18px Arial', '18px sans-serif', '18px "Hiragino Sans", "PingFang SC", "Apple SD Gothic Neo", Arial, sans-serif', '18px "Hiragino Sans", "PingFang SC", "Apple SD Gothic Neo", Arial, LastResort', '18px "Hiragino Sans", "PingFang SC", "Apple SD Gothic Neo", Arial', '18px LastResort', '18px "Hiragino Sans", LastResort', '18px Arial, LastResort'],
      ['‧', '—', '臺', 'あ']),
    r5('webkit-round3 R5 (controls between letters)', ['16px Arial', '16px "Helvetica Neue"', '16px "Times New Roman"', '16px Georgia', '16px Menlo', '13px Verdana'],
      [0x0b, 0x0c, 0x0d, 0x01, 0x1c, 0x1f, 0x7f, 0x85, 0x9f], [['A', 'V'], ['T', 'o'], ['a', 'b'], ['V', 'A']]),
    r1('webkit-round3 R1 (Arabic, fixture fonts)', ['16px Amiri', '16px "Noto Naskh Arabic"'], [1, -1], ['صلىالله', 'لالِا', 'الله', 'لا', 'سلام', 'بِبِ', 'كل'], ['Amiri', 'Noto Naskh Arabic'], 'rtl'),
  ]
}
