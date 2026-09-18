// Font facts the library asks Canvas for itself. A FontFacts field the caller left null is answered here where a Canvas
// check is sound for the engine, and stays null otherwise, which is the engine's documented default and its named gap
// (model.ts FontFacts). A supplied fact is never checked or replaced. rebuild/probes/font-checks.ts runs these checks in
// the browsers over the lab's families, beside the DOM and the lab's font table.
//
// Every check is a rule read from pinned source, with the cases it can't see. An answer is given only where the rule
// holds; a check that can't tell answers null. The checks, and the engines that read each fact:
//
// 1. primaryFamily (all engines): the first listed family that draws U+0020, by the two-fallback test below. The engines
//    define their primary font by the space: Gecko's GetFirstValidFont(0x20) takes the first font of the group that has
//    the character (gfxTextRun.cpp:2277-2345); WebKit's primaryFont is the font of the index-0 ranges' glyph for space
//    (FontCascadeFonts.h:225-254), and index 0 is the first family that gives a font (realizeNextFallback,
//    FontCascadeFonts.cpp:165-188); Blink takes the first font data of the list that isn't loading
//    (DeterminePrimarySimpleFontDataCore, font_fallback_list.cc:88-147). Can't see: a family whose font has no space
//    glyph counts as missing here and is Blink's and WebKit's primary font all the same (none of the lab table's 198
//    faces); WebKit's similarFont gives a list in which nothing realizes Geeza Pro when a name holds "Arabic"
//    (FontCascadeFonts.cpp:189-195), and the answer is null there.
//
// 2. mapsHyphen (Blink, WebKit; Gecko doesn't read it): the same test on U+2010 with the primary family. Both engines
//    choose the soft hyphen's string by asking the primary font for a glyph (Blink HyphenString, computed_style.cc:1804-1820,
//    through SimpleFontData::GlyphForCharacter, which asks HarfBuzz's character-to-glyph mapping "so that it matches the
//    coverage we use through HarfBuzz during shaping", simple_font_data.cc:250-262, harfbuzz_face.cc:397-402 and :210-231 for
//    the hyphens Core Text synthesizes; WebKit hyphenString, StyleComputedStyle.cpp:419-435, through Font::glyphForCharacter),
//    and both draw a character with the first listed font that has its glyph, which is the same question.
//
// 3. monospace (WebKit only): whether `i`, `M`, `.` and the space have one advance in the primary family. A HEURISTIC, the
//    only one here: WebKit reads Core Text's kCTFontMonoSpaceTrait, kCTFontFixedAdvanceAttribute and three font names
//    (Font::determinePitch, FontCoreText.cpp:753-785), none of which changes a Canvas width, since measureText never takes
//    the fixed-pitch shortcut (TextUtil::width, TextUtil.cpp:81-86). Wrong for a font whose trait and advances disagree:
//    determinePitch itself names MS-PGothic and MonotypeCorsiva, proportional fonts it treats as fixed pitch.
//
// 4. opticalSizeAxis (Blink only, and only `false`): at a layout zoom other than 1, whether the primary family's advances
//    at the zoomed size are the CSS-size advances scaled. Blink's DOM shapes at the zoomed size with opsz and HarfBuzz's
//    ptem at the specified size (font_platform_data_mac.mm:170-178, harfbuzz_face.cc:639-648), and Canvas has both sizes
//    equal, so a font that scales linearly between the two sizes measures the same either way, and `false` (measure at the
//    zoomed size) is exact. A font that doesn't is left null: an opsz axis or `trak` tracking asks for the CSS size, a
//    bitmap strike (Apple Color Emoji) for the zoomed size, and Canvas can't tell which (specs/blink-canvas.md §1.8).
//    Gecko's OffscreenCanvas leaves opsz at its default (specs/gecko-canvas.md §1.2 C1a), so nothing shows there, and WebKit
//    doesn't read the fact. Can't see: an axis that moves no advance of the probe string between the two sizes.
//
// 5. joining (Blink only): whether the font that draws U+0628 reads the text around a shaping call. Canvas cuts a string
//    into bidi runs and words and shapes each item alone (plain_text_node.cc:285-318, :377-453), but inside an item
//    HarfBuzzShaper makes one HarfBuzz call per script run and fills each call's buffer from the whole item, so up to 5 code
//    points on each side are context (harfbuzz_shaper.cc:1005-1007, case_mapping_harfbuzz_buffer_filler.cc:32-43,
//    hb-buffer.hh:109-110). U+07FA NKO LAJANYALAN is another script than U+0628, is bidi class R like it, so both stay in
//    one bidi run and one word, and has Joining_Type C. HarfBuzz reads context in arabic_joining alone
//    (hb-ot-shaper-arabic.cc:305-372; the other reader, the dotted circle, needs a buffer flag Blink never sets,
//    hb-ot-shape.cc:548-558), and a face with a `morx` table gets a shaper with no setup_masks, so nothing reads it
//    (hb-ot-shape.cc:58-66, :98-102; hb-ot-shaper-default.cc:55-71). So beh next to U+07FA measuring otherwise than the two
//    alone says the font took a joined form from context: 'opentype'. 'aat' is answered where context changes nothing and
//    two behs in one call do measure otherwise than two alone, so the font has joined forms of another width and didn't use
//    them. Can't see: a font whose joined forms are as wide as the isolated ones (the fixed-pitch fonts), answered null;
//    letters another font than U+0628's draws. Firefox's and WebKit's Canvas show no context, and they lose nothing to the
//    fact (research/FACTS-FREE.md).
//
// The two-fallback test: a string measured under `F, monospace` and under `F, serif`. All three engines skip a listed
// family that gives no font and draw each character with the first listed font that has its glyph (Blink
// FontFallbackIterator::Next, font_fallback_iterator.cc:121-229, with clusters that shaped to .notdef going to the next
// font, harfbuzz_shaper.cc:880-1058; WebKit glyphDataForVariant, FontCascadeFonts.cpp:426-439; Gecko
// gfxFontGroup::BuildFontList and FindFontForChar, gfxTextRun.cpp:1943-1990, :3178). So where the two generics alone give the
// string different widths, equal widths under the two lists say F drew all of it. Can't see: a string F doesn't draw that
// two different fallback fonts give the same width, which the test on the generics alone rules out only while both
// generics hold the glyphs themselves; Blink's system fallback after the list starts from the primary font
// (font_fallback_iterator.cc:258-281).
//
// pairKerning, coverage, ligatures, spacingInputs and scriptLookups aren't asked: Canvas totals don't show which glyph
// carries a pair adjustment, and the others are whole sets where a check answers one string at a time
// (research/FACTS-FREE.md).
//
// Answers are kept for the measurer's life, per check, declaration and language, in a bounded map. The checks measure at
// 16px whatever the declaration's size, except the two sizes of check 4: font matching doesn't read the size, the answers
// are shared between sizes, and Blink's totals are exact 16.16 values below 256 px (specs/blink-canvas.md §1.5). Their
// contexts are their own (`partition`), so no engine measurement shares a Blink word cache with them.
//
// A cost the library can't avoid: in Blink a platform font Canvas creates at size X is the one the DOM then uses for text
// of that family at X px after zoom, whatever its specified size (the font cache key holds the effective size alone,
// specs/blink-canvas.md §1.8), which changes DOM widths for fonts with an opsz axis. Check 4 therefore never measures the
// system UI font at the zoomed size, where the engine doesn't measure it either.
import type { EngineName, Environment } from '../env.js'
import type { FontDecl, FontFacts, InlineNode, Paragraph } from '../model.js'
import { measureContext, measureText, type Measurer } from './canvas.js'
import { canvasFont } from './font.js'

const PROBE_SIZE = 16
const SPACE = ' '
const HYPHEN = '\u2010'
const BEH = '\u0628'
const LAJANYALAN = '\u07fa'
const FIXED_PITCH_SAMPLE = 'iM.'
const LINEAR_SAMPLE = 'Hamburgefonstiv'

// CSS Fonts 4 generic family keywords, which name a family only unquoted.
const GENERIC_KEYWORDS = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong']

type Answer = string | boolean | null

const STORE_LIMIT = 256
const stores = new WeakMap<Measurer, Map<string, Answer>>()

// The answer kept under `key`, or compute's, kept from now on. The oldest answer leaves a full store.
function kept<T extends Answer>(m: Measurer, key: string, compute: () => T): T {
  let store = stores.get(m)
  if (store === undefined) {
    store = new Map()
    stores.set(m, store)
  }
  const known = store.get(key)
  if (known !== undefined) return known as T
  const value = compute()
  if (store.size >= STORE_LIMIT) store.delete(store.keys().next().value!)
  store.set(key, value)
  return value
}

type Family = { css: string; name: string; quoted: boolean }

// The families of a CSS font-family list: split at commas outside quotes, names without their quotes and escapes.
function familiesOf(list: string): Family[] {
  const out: Family[] = []
  let start = 0
  let quote = ''
  for (let i = 0; i <= list.length; i++) {
    const ch = i < list.length ? list[i]! : ','
    if (quote !== '') {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    if (ch !== ',') continue
    const css = list.slice(start, i).trim()
    start = i + 1
    if (css === '') continue
    const quoted = css[0] === '"' || css[0] === "'"
    out.push({ css, name: quoted ? css.slice(1, -1).replace(/\\(.)/g, '$1') : css.split(/\s+/).join(' '), quoted })
  }
  return out
}

// A family name as CSS writes it; a generic keyword stands for itself, as in FontFacts.primaryFamily.
function cssFamily(name: string): string {
  return GENERIC_KEYWORDS.includes(name.toLowerCase()) ? name : JSON.stringify(name)
}

type Probe = { m: Measurer; font: FontDecl; lang: string }

function width(p: Probe, family: string, size: number, text: string): number {
  const context = measureContext(p.m, {
    font: canvasFont({ ...p.font, family }, size), lang: p.lang, letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto',
    textRendering: 'auto', direction: 'ltr', partition: 'font-checks',
  })
  return measureText(p.m, context, text)
}

// The two-fallback test: true when `family` draws all of `text`, false when it doesn't, null when the two generics alone
// give `text` one width, so the test can't tell.
function draws(p: Probe, family: string, text: string): boolean | null {
  if (width(p, 'monospace', PROBE_SIZE, text) === width(p, 'serif', PROBE_SIZE, text)) return null
  return width(p, `${family}, monospace`, PROBE_SIZE, text) === width(p, `${family}, serif`, PROBE_SIZE, text)
}

// Check 1. The name is the list's own; null where no listed family draws the space, where the test can't tell for a
// family before the first that does, or where a quoted name reads as a generic keyword, which primaryFamily can't say.
function primaryFamily(p: Probe): string | null {
  const families = familiesOf(p.font.family)
  for (let i = 0; i < families.length; i++) {
    const family = families[i]!
    const drawsSpace = draws(p, family.css, SPACE)
    if (drawsSpace === null) return null
    if (drawsSpace) return family.quoted && GENERIC_KEYWORDS.includes(family.name.toLowerCase()) ? null : family.name
  }
  return null
}

// Check 3.
function fixedPitch(p: Probe, primary: string): boolean | null {
  if (draws(p, primary, FIXED_PITCH_SAMPLE) !== true) return null
  const list = `${primary}, serif`
  const space = width(p, list, PROBE_SIZE, SPACE)
  for (let i = 0; i < FIXED_PITCH_SAMPLE.length; i++) if (width(p, list, PROBE_SIZE, FIXED_PITCH_SAMPLE[i]!) !== space) return false
  return true
}

const f32 = Math.fround

// Blink's platform font size: floorf(size * 100) / 100 (FontDescription::EffectiveFontSize, font_description.cc:271-282).
function effectiveSize(size: number): number {
  return f32(Math.floor(f32(size * 100)) / 100)
}

// The families Blink gives the macOS system UI font, which it measures at the CSS size (model.ts opticalSizeAxis;
// font_cache_mac.mm:289-292, :408).
function isBlinkSystemFont(primary: string): boolean {
  const name = primary.toLowerCase()
  return name === 'system-ui' || name === 'blinkmacsystemfont'
}

// Check 4: false where the sample's total at the zoomed size is its CSS-size total scaled, within what Blink's integers
// allow: each glyph's advance is truncated to 1/65536 px at its own size (SkiaScalarToHarfBuzzPosition,
// skia_text_metrics.cc:207-211), so it differs from the scaled one by less than 1 + ratio units, HarfBuzz rounds each
// position adjustment to a unit at each size, and a float32 total or advance is within 2^-23 of its value.
function scalesLinearly(p: Probe, primary: string, zoom: number): false | null {
  if (isBlinkSystemFont(primary) || draws(p, cssFamily(primary), LINEAR_SAMPLE) !== true) return null
  const cssSize = f32(p.font.size)
  const zoomedSize = f32(cssSize * f32(zoom))
  const ratio = effectiveSize(zoomedSize) / effectiveSize(cssSize)
  const atCss = width(p, p.font.family, cssSize, LINEAR_SAMPLE) * 65536
  const atZoomed = width(p, p.font.family, zoomedSize, LINEAR_SAMPLE) * 65536
  const bound = 2 * LINEAR_SAMPLE.length * (1 + ratio) + atZoomed * 2 ** -22
  return Math.abs(atZoomed - ratio * atCss) <= bound ? false : null
}

// Check 5, in exact 16.16 units.
function joining(p: Probe): FontFacts['joining'] {
  const units = (text: string): number => Math.round(width(p, p.font.family, PROBE_SIZE, text) * 65536)
  const beh = units(BEH)
  const lajanyalan = units(LAJANYALAN)
  // U+07FA's own font may read context too: its joined forms must measure as the isolated one for the sums below to be beh's.
  if (units(LAJANYALAN + LAJANYALAN) !== 2 * lajanyalan) return null
  if (units(BEH + LAJANYALAN) !== beh + lajanyalan || units(LAJANYALAN + BEH) !== beh + lajanyalan) return 'opentype'
  return units(BEH + BEH) !== 2 * beh ? 'aat' : null
}

// What the paragraph's text can ask of its fonts: a soft hyphen draws a hyphen, and joining letters meet shaping call
// edges. Joining scripts sit in the right-to-left blocks, but for Mongolian and Phags-pa.
type TextNeeds = { hyphen: boolean; joining: boolean }

function addTextNeeds(nodes: readonly InlineNode[], needs: TextNeeds): void {
  for (let n = 0; n < nodes.length; n++) {
    const node = nodes[n]!
    if (node.kind === 'span') addTextNeeds(node.children, needs)
    if (node.kind !== 'text') continue
    for (let i = 0; i < node.text.length; i++) {
      const c = node.text.charCodeAt(i)
      if (c === 0xad) needs.hyphen = true
      else if ((c >= 0x0590 && c <= 0x08ff) || (c >= 0x1800 && c <= 0x18af) || (c >= 0xa840 && c <= 0xa87f) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) needs.joining = true
      // U+10800..U+10FFF and U+1E800..U+1EFFF, by their lead surrogates.
      else if (c === 0xd802 || c === 0xd803 || c === 0xd83a || c === 0xd83b) needs.joining = true
    }
  }
}

// The facts of one declaration as the engine gets them: each supplied fact, else the check's answer where this engine
// reads the fact and the paragraph's text can ask for it.
function learnedFacts(m: Measurer, engine: EngineName, zoom: number, font: FontDecl, lang: string, needs: TextNeeds): FontFacts {
  const given = font.facts
  const p: Probe = { m, font, lang }
  const key = (check: string, ...more: number[]): string => JSON.stringify([check, font.family, font.weight, font.style, lang, ...more])
  const primary = given.primaryFamily ?? kept(m, key('primaryFamily'), () => primaryFamily(p))
  let mapsHyphen = given.mapsHyphen
  let monospace = given.monospace
  let opticalSizeAxis = given.opticalSizeAxis
  let joiningFact = given.joining
  if (primary !== null) {
    if (mapsHyphen === null && needs.hyphen && engine !== 'gecko') mapsHyphen = kept(m, key('mapsHyphen'), () => draws(p, cssFamily(primary), HYPHEN))
    if (monospace === null && engine === 'webkit') monospace = kept(m, key('monospace'), () => fixedPitch(p, cssFamily(primary)))
    if (opticalSizeAxis === null && engine === 'blink' && zoom !== 1) opticalSizeAxis = kept(m, key('opticalSizeAxis', font.size, zoom), () => scalesLinearly(p, primary, zoom))
  }
  if (joiningFact === null && needs.joining && engine === 'blink') joiningFact = kept(m, key('joining'), () => joining(p))
  return { ...given, primaryFamily: primary, mapsHyphen, monospace, opticalSizeAxis, joining: joiningFact }
}

function withLearnedFactsIn(nodes: readonly InlineNode[], lang: string, learn: (font: FontDecl, lang: string) => FontDecl): InlineNode[] {
  const out: InlineNode[] = []
  for (let n = 0; n < nodes.length; n++) {
    const node = nodes[n]!
    if (node.kind !== 'span') {
      out.push(node)
      continue
    }
    const own = node.lang ?? lang
    out.push({ ...node, font: learn(node.font, own), children: withLearnedFactsIn(node.children, own, learn) })
  }
  return out
}

// The paragraph with every font declaration's null facts asked of Canvas. Blink and Gecko resolve a Canvas font under the
// context's language, the element's here as in their engines' own contexts; WebKit's context has none.
export function withLearnedFontFacts(paragraph: Paragraph, env: Environment, m: Measurer): Paragraph {
  const needs: TextNeeds = { hyphen: false, joining: false }
  addTextNeeds(paragraph.content, needs)
  const zoom = env.engine === 'blink' ? env.devicePixelRatio : 1
  const learn = (font: FontDecl, lang: string): FontDecl => ({ ...font, facts: learnedFacts(m, env.engine, zoom, font, env.engine === 'webkit' ? '' : lang, needs) })
  return { ...paragraph, font: learn(paragraph.font, paragraph.lang), content: withLearnedFactsIn(paragraph.content, paragraph.lang, learn) }
}
