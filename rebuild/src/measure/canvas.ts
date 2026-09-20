// Canvas contexts for measurement. Every engine measures with an OffscreenCanvas: a connected <canvas> inherits the
// element's font properties in Blink and WebKit and sits on a 1/apd grid with size/DPR font sizes in Gecko
// (specs/blink-canvas.md §1.2, specs/webkit-canvas.md §1.3, specs/gecko-canvas.md §1.10), and it needs style updates.
//
// A context is identified by its settings. The identity matters: Chrome caches shaped words per canvas and the first
// shaping of a word wins (specs/blink-canvas.md §1.7), so engines keep texts that could shape differently apart with
// `partition`, and a context is never reused across settings.
//
// The list of contexts is the caller's: one prepare's alone, or a page's, which every prepare of the page adds to and finds
// its contexts in (index.ts prepare has the lifetime). A prepared paragraph keeps the list it was made with, and the
// records that measure hold their contexts by reference. With a page's list a canvas has shaped what the page's earlier
// paragraphs asked of it, and not only this paragraph's strings. That changes no answer while equal settings mean equal
// shaping and `partition` keeps apart the strings that Chrome would shape differently on one canvas.
//
// PROTOTYPE (x-perf-store, not for merging): a context keeps the answers Canvas gave it, by the measured string, and
// `width` and `bounds` ask Canvas only what the context has not answered. Lifetime: the context's, which is its list's
// (index.ts prepare). Nothing but the string is in the key, because every other setting is what found the context.
// Invalidated with the list, and by nothing else: a kept answer does not follow a font that loads later, where a kept
// context in Chrome and Firefox does. Bounded by MAX_ANSWERS a context: a context that holds as many forgets them all.
//
// The string an engine hands to measureText reaches Canvas as the engine built it: a string whose storage a keyed use
// would change is never the key (`key` below).
// V8 internalizes a string used as a Map, Set or property key, stores an internalized string in one byte whenever its
// units fit, and turns the looked-up string into a reference to it (builtins-collections-gen.cc:2590-2604,
// string-table.cc:398-427, factory.cc:1239-1257 and 1293-1300, string.cc:164-166 at Chrome 153's V8 6b96683d). Blink
// takes a one-byte string as an 8-bit one (to_blink_string.cc:216-227) and Canvas shapes an 8-bit string as one Latin
// segment, so a lookup of the text itself turned the two-byte string the Blink port slices (engines/blink/shape.ts
// canvasString) into a one-byte one before Canvas saw it (probe blink-storage S1: Amiri's 13 brackets at 48px measure
// 285.79px as the two-byte slice, 159.12px after any keyed use of it, and 285.79px after lookups of other strings that
// hold its characters; S5 asks through this file).

export type CanvasSettings = {
  // ctx.font, a CSS font shorthand from measure/font.ts.
  font: string
  // ctx.lang: an explicit language, never 'inherit'. WebKit's context has no lang attribute; assigning it is harmless.
  lang: string
  letterSpacing: string
  wordSpacing: string
  fontKerning: CanvasFontKerning
  textRendering: CanvasTextRendering
  direction: CanvasDirection
  // Keeps otherwise equal settings on separate canvases, e.g. Blink's 8-bit and 16-bit words.
  partition: string
}

// Chrome and Firefox implement CanvasTextDrawingStyles.lang; the DOM lib types don't declare it yet.
type ContextWithLang = OffscreenCanvasRenderingContext2D & { lang: string }

export type InkBox = { width: number; left: number; right: number }

export type Context = { settings: CanvasSettings; ctx: ContextWithLang; widths: Map<string, number>; inkBoxes: Map<string, InkBox> }

// About twice what Chrome's own canvas keeps (frame_shape_cache.cc:12-16: 32,768 strings).
export const MAX_ANSWERS = 65536

function sameSettings(a: CanvasSettings, b: CanvasSettings): boolean {
  return a.font === b.font && a.lang === b.lang && a.letterSpacing === b.letterSpacing && a.wordSpacing === b.wordSpacing &&
    a.fontKerning === b.fontKerning && a.textRendering === b.textRendering && a.direction === b.direction && a.partition === b.partition
}

// The context of `settings` in `contexts`, made at the end when none has them. A paragraph has a few contexts and a page a
// few per font declaration, so this compares them one by one.
export function contextFor(contexts: Context[], settings: CanvasSettings): Context {
  for (let i = 0; i < contexts.length; i++) if (sameSettings(contexts[i]!.settings, settings)) return contexts[i]!
  const ctx = new OffscreenCanvas(1, 1).getContext('2d') as ContextWithLang | null
  if (ctx === null) throw new Error('OffscreenCanvas has no 2d context')
  // lang first: Blink resolves the font under the context's language when the font string is set (base_rendering_context_2d.cc:1201-1215).
  ctx.lang = settings.lang
  ctx.font = settings.font
  ctx.letterSpacing = settings.letterSpacing
  ctx.wordSpacing = settings.wordSpacing
  ctx.fontKerning = settings.fontKerning
  ctx.textRendering = settings.textRendering
  ctx.direction = settings.direction
  const context = { settings, ctx, widths: new Map<string, number>(), inkBoxes: new Map<string, InkBox>() }
  contexts.push(context)
  return context
}

// `key` names the question in the context's store: the text itself, or, for a text whose storage V8 would change when it is
// used as a key (the header above), another string object of the same characters (engines/blink/shape.ts canvasString).
// rule blink/measure/string-reaches-canvas-as-built
export function width(context: Context, text: string, key: string = text): number {
  const stored = context.widths.get(key)
  if (stored !== undefined) return stored
  if (context.widths.size >= MAX_ANSWERS) context.widths.clear()
  const w = context.ctx.measureText(text).width
  context.widths.set(key, w)
  return w
}

// measureText with the glyph ink extent: actualBoundingBoxLeft and actualBoundingBoxRight, as distances left and right of
// the text origin. No caller's text has a storage to keep, so the text is the key.
export function bounds(context: Context, text: string): InkBox {
  const stored = context.inkBoxes.get(text)
  if (stored !== undefined) return stored
  if (context.inkBoxes.size >= MAX_ANSWERS) context.inkBoxes.clear()
  const metrics = context.ctx.measureText(text)
  const box = { width: metrics.width, left: metrics.actualBoundingBoxLeft, right: metrics.actualBoundingBoxRight }
  context.inkBoxes.set(text, box)
  return box
}
