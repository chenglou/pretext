// WebKit content building (Safari 27.0): which runs get a text renderer, per-box locale, storage, code path, font facts and
// measuring facts, the items (items.ts) and the builder choice (specs/webkit-text.md §2-§6, specs/webkit-lines.md §2-§3); on
// an inspected paragraph, what gaps.ts and history.ts keep of it. Cited at WebKit-7625.1.29.11.27 under Source/WebCore/:
// IIB = layout/formattingContexts/inline/InlineItemsBuilder.cpp.
import type { WebKitEnvironment } from '../../env.js'
import { contextFor, width as canvasWidth, type ContextPool } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import { familyNames, genericFamilyUnder, namedFamily, standardFamilyOf, type FamilyName } from './fonts.js'
import { indexContent, styleUnder } from '../../content.js'
import type { Paragraph, TextStyle } from '../../model.js'
import { AL, LRE, LRO, PDF, R, RLE, RLO, bidiClassOf } from '../../unicode/bidi.js'
import { computedLocale, localeScript, webkitBidiData, webkitGraphemeRules } from './data.js'
import { boxMade, coveredLikeLastResort, newInspection, unverifiedCoverage, type UnverifiedCoverage } from './gaps.js'
import { collectHistoryWorlds } from './history.js'
import { buildItems } from './items.js'
import { isComplexCodePath } from './measure.js'
import { graphemeBoundaries } from '../../unicode/grapheme.js'
import { boxEdges, layoutUnit, preservesNewline, webkitStyle } from './style.js'
import type { WebKitBox, WebKitOwnPrepared, WebKitStyle } from './types.js'

const f32 = Math.fround
const NO_TAB_POSITIONS: readonly number[] = []

// uprv_getDefaultLocaleID without LANG, LC_ALL or LC_MESSAGES (AppleICU76 putil.cpp:1727-1874; specs/webkit-gaps.md §8.2).
const ICU_DEFAULT_LOCALE_WITHOUT_ENVIRONMENT = 'en_US_POSIX'

// isASCIIWhitespace: SPACE, LF, TAB, CR, FF; VT isn't one (WTF/ASCIICType.h:154-157).
function containsOnlyASCIIWhitespace(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c !== 0x20 && c !== 0x0a && c !== 0x09 && c !== 0x0d && c !== 0x0c) return false
  }
  return true
}

// RenderTreeUpdater::textRendererIsNeeded (RenderTreeUpdater.cpp:536-595) over the model's tree, which has only blocks, inline
// spans, atomic inline-blocks, <br> and <wbr>. `previous` is the rendering parent's previous child renderer, and whether it
// exists is hasPrecedingInFlowChild. A block's first child renderer finds childrenInline() true, so the "first inline content"
// test (:575-591) never answers yes, and the node gets a renderer exactly when an earlier in-flow child renderer exists.
type PreviousRenderer = 'none' | 'text' | 'inline' | 'br'

function textRendererIsNeeded(text: string, previous: PreviousRenderer, parentStyle: WebKitStyle, parentIsInline: boolean): boolean {
  if (text.length === 0) return false
  if (!containsOnlyASCIIWhitespace(text)) return true
  if (previous === 'text') return true
  // pre, pre-wrap and pre-line always make renderers (:557-558).
  if (preservesNewline(parentStyle)) return true
  // <span><br/> <br/></span> (:560-562).
  if (previous === 'br') return false
  // A RenderInline parent keeps the node unless the previous renderer is a block (:564-570).
  if (parentIsInline) return true
  return previous !== 'none'
}

// WidthIterator::characterCanUseSimplifiedTextMeasuring (WidthIterator.cpp:694-742).
function characterCanUseSimplifiedTextMeasuring(c: number, whitespaceIsCollapsed: boolean): boolean {
  switch (c) {
    case 0x0a:
    case 0x0d:
      return true
    case 0x09:
      if (!whitespaceIsCollapsed) return false
      break
    case 0x00a0: case 0x00ad: case 0x200e: case 0x200f: case 0x202a: case 0x202b: case 0x202d: case 0x202e:
    case 0x2066: case 0x2067: case 0x202c: case 0x2069: case 0x2068: case 0xfffc: case 0xfeff: case 0x200c:
    case 0x200d: case 0x2060: case 0x200b: case 0x2061: case 0x2062: case 0x2063: case 0x206a: case 0x206b:
    case 0x206c: case 0x206d: case 0x206e: case 0x206f: case 0x2592:
      return false
  }
  return !(c >= 0x3041 || c <= 0x1f || (c >= 0x7f && c <= 0x9f))
}

// CSS <generic-family> keywords (CSS Fonts 4 §4.2) and WebKit's -apple-system and -webkit- aliases: written unquoted in a
// font-family list, since a quoted keyword names a family of that name.
const GENERIC_FAMILY_KEYWORDS = ['serif', 'sans-serif', 'cursive', 'fantasy', 'monospace', 'system-ui', 'emoji', 'math', 'fangsong', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', '-apple-system', '-webkit-standard', '-webkit-body', '-webkit-pictograph']

function cssFamilyName(name: string): string {
  return GENERIC_FAMILY_KEYWORDS.includes(name.toLowerCase()) ? name : JSON.stringify(name)
}

// InlineTextBox::hasStrongDirectionalityContent (TextUtil.cpp:486-576): TextUtil::isStrongDirectionalityCharacter
// (TextUtil.cpp:486-515) over the code points of 16-bit content.
function hasStrongDirectionality(text: string, is8Bit: boolean): boolean {
  if (is8Bit) return false
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!
    if (cp > 0xffff) i++
    if (cp < 0x0590 || (cp >= 0x2010 && cp <= 0x2029) || (cp >= 0x206a && cp <= 0xd7ff) || (cp >= 0xff00 && cp <= 0xffff)) continue
    const c = bidiClassOf(webkitBidiData, cp)
    if (c === R || c === AL || c === RLE || c === RLO || c === LRE || c === LRO || c === PDF) return true
  }
  return false
}

// One text leaf: its computed style, font, spacing and language as the tree gives them, and whether it gets a renderer
// (textRendererIsNeeded), which makes it a box.
type LeafInput = { run: number; parent: number; text: string; textStyle: TextStyle; style: WebKitStyle; lang: string; rendered: boolean }

function familyList(families: readonly FamilyName[]): string {
  return families.map(family => family.css).join(', ')
}

function makeBox(p: WebKitOwnPrepared, leaf: LeafInput, sourceStart: number): WebKitBox {
  const declared = leaf.textStyle.font
  const facts = declared.facts
  const locale = computedLocale(leaf.lang, p.env.preferredLanguages)
  // The list Canvas measures with (fonts.ts): each unquoted generic keyword the locale resolves to a family of its own is
  // named, and the script's standard family appended where no listed family resolves (below). Only unquoted names are
  // keywords. `firstNamedGeneric` is the index of the first family named either way, which gaps.ts reads.
  const script = localeScript(locale)
  const families = familyNames(declared.family)
  let firstNamedGeneric: number | null = null
  for (let i = 0; i < families.length; i++) {
    const named = families[i]!.quoted || locale === '' ? null : genericFamilyUnder(families[i]!.name, locale, script, p.env.preferredLanguages)
    if (named === null) continue
    families[i] = namedFamily(named)
    firstNamedGeneric ??= i
  }
  const zoom = f32(p.zoom)
  const size = f32(f32(declared.size) * zoom)
  const letterSpacing = f32(f32(leaf.textStyle.letterSpacing) * zoom)
  const wordSpacing = leaf.style.wordSpacing
  const text = leaf.text
  let is8Bit = true
  let tabPositions: number[] | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c > 0xff) is8Bit = false
    if (c === 0x09) (tabPositions ??= []).push(i)
  }
  const simpleFontCodePath = !isComplexCodePath(text)
  const characterAnalysis = simpleFontCodePath
    ? { simpleFontCodePath: true as const, characterBoundaries: null }
    : { simpleFontCodePath: false as const, characterBoundaries: graphemeBoundaries(text, webkitGraphemeRules) }
  let simplifiedMeasuring = simpleFontCodePath && letterSpacing === 0 && wordSpacing === 0
  const collapsed = leaf.style.collapse === 'collapse' || leaf.style.collapse === 'preserve-breaks'
  for (let i = 0; simplifiedMeasuring && i < text.length; i++) {
    const cp = text.codePointAt(i)!
    if (cp > 0xffff) i++
    simplifiedMeasuring = characterCanUseSimplifiedTextMeasuring(cp, collapsed)
  }
  // The index-0 family (FontCascadeFonts.cpp:200-218): the given fact, else the first family listed.
  const primaryFamily = facts.primaryFamily === null ? families[0]!.name : facts.primaryFamily.toLowerCase()
  const primaryFamilyCss = facts.primaryFamily === null ? families[0]!.css : cssFamilyName(facts.primaryFamily)
  const fixedPitch = facts.monospace === true
  // No family of the list resolves where the list followed by LastResort measures a space as LastResort alone does. The
  // settings' standard family then draws (FontCascadeFonts::realizeFallbackRangesAt, FontCascadeFonts.cpp:210-217), which the
  // locale's script chooses (fonts.ts standardFamilyOf; probe webkit-round4 R7: `a` in `STHeiti`, which the WebContent process
  // doesn't have, is 7.99px under en and 9.81px under ja at 18px; R11: `cursive` under zh names Kaiti SC, which it doesn't
  // have either): it is named at the end of the list.
  const standardFamily = locale === '' ? null : standardFamilyOf(script, p.env.preferredLanguages)
  if (standardFamily !== null) {
    const plain = { lang: '', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'auto' as const, direction: 'ltr' as const, partition: '' }
    const listThenLastResort = contextFor(p.contexts, { ...plain, font: canvasFont({ ...declared, family: `${familyList(families)}, LastResort` }, size) })
    const lastResort = contextFor(p.contexts, { ...plain, font: canvasFont({ ...declared, family: 'LastResort' }, size) })
    if (canvasWidth(listThenLastResort, ' ') === canvasWidth(lastResort, ' ')) {
      firstNamedGeneric ??= families.length
      families.push(namedFamily(standardFamily))
    }
  }
  const font = { ...declared, family: familyList(families) }
  const settings = { font: canvasFont(font, size), lang: '', letterSpacing: `${letterSpacing}px`, wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'auto' as const, direction: 'ltr' as const, partition: '' }
  const context = contextFor(p.contexts, settings)
  const plainContext = contextFor(p.contexts, { ...settings, letterSpacing: '0px' })
  const spacedContext = wordSpacing === 0 ? context : contextFor(p.contexts, { ...settings, wordSpacing: `${wordSpacing}px` })
  const countContext = letterSpacing === 0 ? plainContext : contextFor(p.contexts, { ...settings, letterSpacing: '64px' })
  // Simplified measuring also needs a glyph from the primary font for every character
  // (FontCascade::canUseSimplifiedTextMeasuring, FontCascade.cpp:486-510). Fallback follows the family list before
  // system fallback (FontCascadeFonts.cpp:426-439, specs/webkit-gaps.md §3.3), so a family after the primary one that
  // draws a glyph no other font would shows coverage: if the primary family maps the code point, "P, LastResort" draws
  // the paragraph's glyph; otherwise LastResort's box, 17.6015625px at 16px in webkit-host (rebuild/probes/webkit-followups.ts
  // B5: Courier maps Ω, Menlo doesn't map U+3000). Only fixed-pitch boxes read the result, in the width and breakWord
  // shortcuts; the 17.6015625px advance matching a fallback glyph's is the recipe's loss. What the recipe can't vouch for
  // goes to gaps.ts (unverifiedCoverage).
  let unverified: UnverifiedCoverage | null = null
  if (simplifiedMeasuring && fixedPitch) {
    const coverageContext = contextFor(p.contexts, { ...settings, font: canvasFont({ ...font, family: `${primaryFamilyCss}, LastResort` }, size), letterSpacing: '0px' })
    unverified = unverifiedCoverage(p, { ...settings, font: canvasFont({ ...font, family: 'LastResort' }, size), letterSpacing: '0px' })
    // Each code point of the text is tested once, where it first stands.
    const tested = new Set<number>()
    for (let i = 0; simplifiedMeasuring && i < text.length; i++) {
      const cp = text.codePointAt(i)!
      if (cp > 0xffff) i++
      if (cp < 0x20 || tested.has(cp)) continue
      tested.add(cp)
      const s = String.fromCodePoint(cp)
      const covered = canvasWidth(coverageContext, s)
      simplifiedMeasuring = covered === canvasWidth(plainContext, s)
      if (simplifiedMeasuring) coveredLikeLastResort(unverified, cp, s, covered)
    }
  }
  let spacingFacts: Array<{ coverage: readonly number[]; inputs: readonly number[] }> | null = null
  if (letterSpacing !== 0 && facts.fonts !== undefined && facts.fonts.length === families.length) {
    spacingFacts = []
    for (let i = 0; i < facts.fonts.length && spacingFacts !== null; i++) {
      const listed = facts.fonts[i]!
      if (listed.realizes === false) continue
      if (listed.realizes === null || listed.coverage === null || listed.spacingInputs === undefined || listed.spacingInputs === null) spacingFacts = null
      else spacingFacts.push({ coverage: listed.coverage, inputs: listed.spacingInputs })
    }
  }
  const box: WebKitBox = {
    run: leaf.run, parent: leaf.parent, style: leaf.style, sourceStart, text, is8Bit, tabPositions: tabPositions ?? NO_TAB_POSITIONS, ...characterAnalysis, simplifiedMeasuring, fixedPitch,
    fixedPitchFastMeasuring: fixedPitch && primaryFamily !== 'courier new',
    primaryFamily,
    hyphen: facts.mapsHyphen === false ? '-' : '‐',
    locale, canvasFamily: font.family,
    context, plainContext, spaceWidth: canvasWidth(context, ' '), spacedContext, countContext, letterSpacing, cssLetterSpacing: leaf.textStyle.letterSpacing,
    spacingFacts,
  }
  boxMade(p, box, declared, size, leaf.lang, families, firstNamedGeneric, unverified)
  return box
}

// TextOnlySimpleLineBuilder::isEligibleForSimplifiedInlineLayoutByStyle (TextOnlySimpleLineBuilder.cpp:499-528) over the
// properties the model has; the others sit at eligible initial values (word-break auto-phrase, box-decoration-break clone,
// hanging-punctuation, hyphenate-limit-lines, text-wrap-style, line-align, line-snap, ::first-line).
function isEligibleForSimplifiedInlineLayoutByStyle(s: WebKitStyle): boolean {
  return s.wordSpacing === 0 && !s.rtl && s.textIndent === 0 && s.textAlign !== 'justify'
}

// `inspect` says whether inspectLine and paragraphGaps answer on this paragraph (index.ts): an inspected paragraph keeps what
// gaps.ts and history.ts read, and a plain one measures what deciding its lines takes and nothing else.
export function prepareWebKit(paragraph: Paragraph, env: WebKitEnvironment, inspect: boolean, contexts: ContextPool): WebKitOwnPrepared {
  const zoom = env.pageZoom ?? 1
  const style = webkitStyle(paragraph, paragraph, zoom)
  const index = indexContent(paragraph)
  const p: WebKitOwnPrepared = {
    env, zoom, icuDefaultLocale: env.icuDefaultLocale ?? ICU_DEFAULT_LOCALE_WITHOUT_ENVIRONMENT, style, elements: [],
    builder: 'line-builder', boxes: [], runStarts: [], items: [], contexts, inspect: inspect ? newInspection(env) : null,
  }
  const styleOf = (parent: number): WebKitStyle => {
    if (parent < 0) return style
    const e = p.elements[parent]!
    if (e.kind !== 'span') throw new Error(`element ${parent} holds content but is ${e.kind}`)
    return e.style
  }
  for (let e = 0; e < index.elements.length; e++) {
    const indexed = index.elements[e]!
    const node = indexed.node
    const depth = indexed.parent < 0 ? 1 : p.elements[indexed.parent]!.depth + 1
    switch (node.kind) {
      case 'span':
        p.elements.push({ kind: 'span', parent: indexed.parent, depth, style: webkitStyle(node, paragraph, zoom), edges: boxEdges(node.inlineStart, node.inlineEnd, zoom, env.devicePixelRatio), letterSpacing: f32(f32(node.letterSpacing) * f32(zoom)) })
        break
      case 'atomic': {
        // BoxGeometry of an inline-block with box-sizing: border-box (LayoutIntegrationBoxGeometryUpdater.cpp:670-706):
        // LayoutUnit margins and border box; the margin box is their LayoutUnit sum.
        const marginStart = layoutUnit(f32(f32(node.marginInlineStart) * f32(zoom)))
        const marginEnd = layoutUnit(f32(f32(node.marginInlineEnd) * f32(zoom)))
        const borderBoxWidth = layoutUnit(f32(f32(node.width) * f32(zoom)))
        p.elements.push({ kind: 'atomic', parent: indexed.parent, depth, node, marginStart, marginEnd, borderBoxWidth, marginBoxWidth: f32(marginStart + borderBoxWidth + marginEnd) })
        break
      }
      case 'br':
        p.elements.push({ kind: 'br', parent: indexed.parent, depth })
        break
      case 'wbr':
        p.elements.push({ kind: 'wbr', parent: indexed.parent, depth })
        break
    }
  }
  // Leaves in document order, with the renderer decision of each rendering parent's children.
  const leaves: LeafInput[] = []
  const frames: { parent: number; previous: PreviousRenderer; lang: string }[] = [{ parent: -1, previous: 'none', lang: paragraph.lang }]
  for (let ev = 0; ev < index.events.length; ev++) {
    const event = index.events[ev]!
    const frame = frames[frames.length - 1]!
    switch (event.kind) {
      case 'open': {
        frame.previous = 'inline'
        const span = index.elements[event.element]!.node
        if (span.kind !== 'span') throw new Error(`open event ${event.element} is ${span.kind}`)
        frames.push({ parent: event.element, previous: 'none', lang: span.lang === null ? frame.lang : span.lang })
        break
      }
      case 'close':
        frames.pop()
        break
      case 'atomic':
      case 'wbr':
        frame.previous = 'inline'
        break
      case 'br':
        frame.previous = 'br'
        break
      case 'text': {
        const leaf = index.leaves[event.run]!
        const parentStyle = styleOf(leaf.parent)
        const textStyle = styleUnder(paragraph, index, leaf.parent)
        const rendered = textRendererIsNeeded(leaf.text, frame.previous, parentStyle, leaf.parent >= 0)
        leaves.push({ run: event.run, parent: leaf.parent, text: leaf.text, textStyle, style: parentStyle, lang: frame.lang, rendered })
        if (rendered) frame.previous = 'text'
        break
      }
    }
  }
  // m_contentRequiresVisualReordering (IIB:231-240): a 16-bit box with strong RTL content, or an RTL inline box.
  let reordering = false
  let inlineBoxes = 0
  let textAndLineBreakOnly = true
  for (let e = 0; e < p.elements.length; e++) {
    const element = p.elements[e]!
    if (element.kind === 'span') {
      inlineBoxes++
      reordering ||= element.style.rtl
    }
    // isTextOrLineBreak and isInlineBoxWithInlineContent (IIB:89-92, :242-245): atomic inlines and <wbr> aren't.
    if (element.kind === 'atomic' || element.kind === 'wbr') textAndLineBreakOnly = false
  }
  // The box of each run, or null for a text node without a renderer.
  const boxOfRun: (number | null)[] = []
  for (let r = 0; r < leaves.length; r++) {
    p.runStarts.push(index.leaves[r]!.start)
    if (!leaves[r]!.rendered) {
      boxOfRun.push(null)
      continue
    }
    const box = makeBox(p, leaves[r]!, index.leaves[r]!.start)
    reordering ||= hasStrongDirectionality(box.text, box.is8Bit)
    boxOfRun.push(p.boxes.length)
    p.boxes.push(box)
  }
  p.runStarts.push(index.text.length)
  buildItems(p, index, boxOfRun, reordering)
  if (p.items.length > 0 && textAndLineBreakOnly && inlineBoxes === 0 && !reordering && isEligibleForSimplifiedInlineLayoutByStyle(style)) {
    p.builder = 'text-only-simple'
  } else {
    p.builder = rangeInlineLayout(p, inlineBoxes, textAndLineBreakOnly, reordering) ?? 'line-builder'
  }
  collectHistoryWorlds(p)
  return p
}

// RangeBasedLineBuilder::isEligibleForRangeInlineLayout (RangeBasedLineBuilder.cpp:36-39, :131-184) without floats: every
// item is an inline box start or end, or one span without box edges around content the simple builder takes. Returns which of
// the two the content is, or null where it isn't eligible.
function rangeInlineLayout(p: WebKitOwnPrepared, inlineBoxes: number, textAndLineBreakOnly: boolean, reordering: boolean): 'inline-boxes-only' | 'range-based' | null {
  const items = p.items
  if (items.length === 0) return null
  const first = items[0]!
  const last = items[items.length - 1]!
  // Content of either kind starts with an inline box start: inline boxes alone do, as the tree is walked.
  if (first.kind !== 'inline-box-start') return null
  const isEmptyContent = items.length % 2 === 0 && inlineBoxes === items.length / 2
  const isFullyNestedContent = inlineBoxes === 1 && last.kind === 'inline-box-end' && items.length > 2
  if (!isEmptyContent && !isFullyNestedContent) return null
  // hasDecorationOrBreak (:147-160): the leading inline box starts' margin, border and padding.
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.kind !== 'inline-box-start') break
    const element = p.elements[item.element]!
    if (element.kind !== 'span') break
    const e = element.edges
    if (e.marginStart + e.borderStart + e.paddingStart + e.marginEnd + e.borderEnd + e.paddingEnd !== 0 || e.marginStart < 0 || e.marginEnd < 0) return null
  }
  if (isEmptyContent) return 'inline-boxes-only'
  if (!textAndLineBreakOnly || reordering) return null
  const span = p.elements[first.element]!
  if (span.kind !== 'span') return null
  if (span.style.textAlign !== p.style.textAlign) return null
  return isEligibleForSimplifiedInlineLayoutByStyle(p.style) && isEligibleForSimplifiedInlineLayoutByStyle(span.style) ? 'range-based' : null
}
