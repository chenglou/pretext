// Font facts the library asks Canvas for itself. A FontFacts field the caller left null is answered here where a Canvas
// check is sound for the engine, and stays null otherwise, which is the engine's documented default and its named gap
// (model.ts FontFacts). A supplied fact is never checked or replaced. rebuild/probes/font-checks.ts runs these checks in
// the browsers over the lab's families, beside the DOM and the lab's font table.
//
// Every check is a rule read from pinned source, with the cases it can't see. An answer is given only where the rule
// holds; a check that can't tell answers null. The checks, and the engines that read each fact:
//
// 1. primaryFamily (WebKit, and Blink where check 2 or 4 runs; see learnedFacts): the first listed family that draws
//    U+0020, by the two-fallback test below. The engines define their primary font by the space: Gecko's GetFirstValidFont(0x20) takes the first font of the group that has
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
// One call resolves one paragraph, and everything it keeps is local to the call (Resolution below): each distinct
// declaration under its language is resolved once, and a question is asked of Canvas once, since checks share questions
// (the two generics alone, a family's list at the probe size). The checks measure at 16px whatever the declaration's size,
// except the two sizes of check 4: font matching doesn't read the size, so declarations of several sizes share their
// questions, and Blink's totals are exact 16.16 values below 256 px (specs/blink-canvas.md §1.5). Their contexts are their
// own (`partition`), so no engine measurement shares a Blink word cache with them.
//
// The checks measure in the engine's own kind of context (FontChecks.textRendering): in Blink `textRendering =
// 'optimizeLegibility'`, as engines/blink/shape.ts styleContexts does. Blink's font cache keys a platform font by the
// family, the effective (zoomed) size floored to 1/100 px and FontDescription's options, among them text-rendering, and not
// by the specified size (FontDescription::CacheKey, font_description.cc:308-331), while opsz is set from the specified size
// of whichever text made the font, for any font with the axis ("Do not use font size here, but specified size in order to
// account for zoom", font_platform_data_mac.mm:170-178). A context at text-rendering auto and S × zoom px has the key of the
// page's own text of that family at S px. After the DOM, check 4 would measure the DOM's font there, find it linear and
// answer `false` for a font with the axis, and the engine would measure at the zoomed size with another optical size,
// without a gap; before the DOM, the page's text would take the check's font (probes/measure-first.ts M1 "font-check-word":
// 16px system UI text 71.24px instead of 81.125px). Under optimizeLegibility a check shares a key with the engine's contexts,
// which are Canvas fonts like its own (specified size = computed size, so whoever makes the font makes the same one), and
// with the text of a page that sets text-rendering: optimizeLegibility itself, where the engine's contexts share it too (M1
// "library": no DOM width moves at text-rendering auto; "library-page-legibility": it does). Check 4 therefore still never
// measures the system UI font at the zoomed size, where the engine doesn't measure it either.
//
// WebKit needs no such care: its key holds the computed size, the text rendering mode and optical sizing
// (FontDescriptionKey, FontCascadeCache.h:113-154), a font is made at that size (FontCacheCoreText.cpp:716) and opsz is set
// from the font's own size (UnrealizedCoreTextFont.cpp:303-315), so the font a check makes is the font the page makes under
// that key; a width its glyph geometry cache keeps is the computed value (FontCascade.cpp:319-352). Its Canvas has no
// textRendering attribute, and the checks assign the default as the port's recipes do. Gecko is asked nothing.
import type { FontDecl, FontFacts, InlineNode, Paragraph } from '../model.js'
import { contextFor, width as canvasWidth, type Context } from './canvas.js'
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

// What one call keeps while it resolves a paragraph's declarations, all of it few enough to compare one by one: the
// checks' contexts, the questions asked so far with Canvas's answers, and the declarations resolved so far, each under the
// language its checks measured in.
type Resolution = {
  contexts: Context[]
  asked: { context: Context; text: string; width: number }[]
  resolved: { font: FontDecl; lang: string; learned: FontDecl }[]
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

// What differs between the engines, as each port gives it (engines/<engine>/checks.ts): the facts it reads among those a
// check answers, and the kind of context its recipes measure in.
export type FontChecks = {
  // Check 1 where the engine reads the primary family itself; false: asked only where another check of the engine's needs it.
  primaryFamily: boolean
  // Check 2, for a paragraph that holds a soft hyphen.
  mapsHyphen: boolean
  // Check 3.
  monospace: boolean
  // Check 4, asked at a layout zoom other than 1: the zoom the engine's DOM shapes at, and the families, lowercased, that
  // the engine measures at the CSS size whatever Canvas shows. null where the engine doesn't read the fact off Canvas.
  opticalSizeAxis: { zoom: number; cssSizeFamilies: readonly string[] } | null
  // Check 5, for a paragraph with letters of a joining script.
  joining: boolean
  // Whether the engine's Canvas resolves a font under the context's language, the element's here as in the engine's own
  // contexts; a context that has none gets ''.
  contextTakesLang: boolean
  // The text rendering of the engine's own measuring contexts. In Blink it is part of the font cache key, which the
  // header's last section reads.
  textRendering: CanvasTextRendering
}

type Probe = { resolution: Resolution; textRendering: CanvasTextRendering; font: FontDecl; lang: string }

function width(p: Probe, family: string, size: number, text: string): number {
  const context = contextFor(p.resolution.contexts, {
    font: canvasFont({ ...p.font, family }, size), lang: p.lang, letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto',
    textRendering: p.textRendering, direction: 'ltr', partition: 'font-checks',
  })
  const asked = p.resolution.asked
  for (let i = 0; i < asked.length; i++) if (asked[i]!.context === context && asked[i]!.text === text) return asked[i]!.width
  const measured = canvasWidth(context, text)
  asked.push({ context, text, width: measured })
  return measured
}

// The two-fallback test: false when the two lists give `text` different widths, so a generic drew some of it; true when
// they agree and the two generics alone don't; null when the generics alone agree too, so the test can't tell.
function draws(p: Probe, family: string, text: string): boolean | null {
  if (width(p, `${family}, monospace`, PROBE_SIZE, text) !== width(p, `${family}, serif`, PROBE_SIZE, text)) return false
  return width(p, 'monospace', PROBE_SIZE, text) === width(p, 'serif', PROBE_SIZE, text) ? null : true
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

// Check 4: false where the sample's total at the zoomed size is its CSS-size total scaled, within what Blink's integers
// allow: each glyph's advance is truncated to 1/65536 px at its own size (SkiaScalarToHarfBuzzPosition,
// skia_text_metrics.cc:207-211), so it differs from the scaled one by less than 1 + ratio units, HarfBuzz rounds each
// position adjustment to a unit at each size, and a float32 total or advance is within 2^-23 of its value.
function scalesLinearly(p: Probe, primary: string, zoom: number, cssSizeFamilies: readonly string[]): false | null {
  if (cssSizeFamilies.includes(primary.toLowerCase()) || draws(p, cssFamily(primary), LINEAR_SAMPLE) !== true) return null
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
// edges. The blocks that hold every script with Joining_Type letters (ArabicShaping.txt): Arabic to Arabic Extended-A with
// Syriac, N'Ko and Mandaic between them, Mongolian, Phags-pa, the Arabic presentation forms, and the right-to-left planes
// U+10800..U+10FFF and U+1E800..U+1EFFF (Manichaean to Old Uyghur, Adlam), by their lead surrogates. More text than
// joins only costs the check; U+200D, which joins too, asks nothing on its own.
type TextNeeds = { hyphen: boolean; joining: boolean }

function addTextNeeds(nodes: readonly InlineNode[], needs: TextNeeds): void {
  for (let n = 0; n < nodes.length; n++) {
    const node = nodes[n]!
    if (node.kind === 'span') addTextNeeds(node.children, needs)
    if (node.kind !== 'text') continue
    for (let i = 0; i < node.text.length; i++) {
      const c = node.text.charCodeAt(i)
      if (c === 0xad) needs.hyphen = true
      else if ((c >= 0x0600 && c <= 0x08ff) || (c >= 0x1800 && c <= 0x18af) || (c >= 0xa840 && c <= 0xa87f) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) needs.joining = true
      else if (c === 0xd802 || c === 0xd803 || c === 0xd83a || c === 0xd83b) needs.joining = true
    }
  }
}

// The facts of one declaration as the engine gets them: each supplied fact, else the check's answer where this engine
// reads the fact and the paragraph's text can ask for it (FontChecks; each port says why it reads what it reads).
function learnedFacts(resolution: Resolution, checks: FontChecks, font: FontDecl, lang: string, needs: TextNeeds): FontFacts {
  const given = font.facts
  const p: Probe = { resolution, textRendering: checks.textRendering, font, lang }
  const scaling = checks.opticalSizeAxis
  const asksHyphen = given.mapsHyphen === null && checks.mapsHyphen && needs.hyphen
  const asksPitch = given.monospace === null && checks.monospace
  const asksScaling = given.opticalSizeAxis === null && scaling !== null && scaling.zoom !== 1
  let primary = given.primaryFamily
  if (primary === null && (checks.primaryFamily || asksHyphen || asksPitch || asksScaling)) primary = primaryFamily(p)
  let mapsHyphen = given.mapsHyphen
  let monospace = given.monospace
  let opticalSizeAxis = given.opticalSizeAxis
  let joiningFact = given.joining
  if (primary !== null) {
    if (asksHyphen) mapsHyphen = draws(p, cssFamily(primary), HYPHEN)
    if (asksPitch) monospace = fixedPitch(p, cssFamily(primary))
    if (asksScaling) opticalSizeAxis = scalesLinearly(p, primary, scaling.zoom, scaling.cssSizeFamilies)
  }
  if (joiningFact === null && checks.joining && needs.joining) joiningFact = joining(p)
  return { ...given, primaryFamily: primary, mapsHyphen, monospace, opticalSizeAxis, joining: joiningFact }
}

function sameDeclaration(a: FontDecl, b: FontDecl): boolean {
  const fa = a.facts
  const fb = b.facts
  return a.family === b.family && a.size === b.size && a.weight === b.weight && a.style === b.style &&
    fa.primaryFamily === fb.primaryFamily && fa.mapsHyphen === fb.mapsHyphen && fa.monospace === fb.monospace && fa.opticalSizeAxis === fb.opticalSizeAxis &&
    fa.joining === fb.joining && fa.pairKerning === fb.pairKerning && fa.fonts === fb.fonts
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

// The paragraph with every font declaration's null facts asked of Canvas, as the engine's port asks for them.
export function withLearnedFontFacts(paragraph: Paragraph, checks: FontChecks): Paragraph {
  const needs: TextNeeds = { hyphen: false, joining: false }
  addTextNeeds(paragraph.content, needs)
  const resolution: Resolution = { contexts: [], asked: [], resolved: [] }
  const learn = (font: FontDecl, elementLang: string): FontDecl => {
    const lang = checks.contextTakesLang ? elementLang : ''
    const resolved = resolution.resolved
    for (let i = 0; i < resolved.length; i++) if (resolved[i]!.lang === lang && sameDeclaration(resolved[i]!.font, font)) return resolved[i]!.learned
    const learned = { ...font, facts: learnedFacts(resolution, checks, font, lang, needs) }
    resolved.push({ font, lang, learned })
    return learned
  }
  return { ...paragraph, font: learn(paragraph.font, paragraph.lang), content: withLearnedFactsIn(paragraph.content, paragraph.lang, learn) }
}
