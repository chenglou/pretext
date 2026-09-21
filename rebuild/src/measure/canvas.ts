// Canvas contexts for measurement. Every engine measures with an OffscreenCanvas: a connected <canvas> inherits the
// element's font properties in Blink and WebKit and sits on a 1/apd grid with size/DPR font sizes in Gecko
// (specs/blink-canvas.md §1.2, specs/webkit-canvas.md §1.3, specs/gecko-canvas.md §1.10), and it needs style updates.
//
// A context is identified by its settings. The identity matters: Chrome caches shaped words per canvas and the first
// shaping of a word wins (specs/blink-canvas.md §1.7), so engines keep texts that could shape differently apart with
// `partition`, and a context is never reused across settings.
//
// The pool of contexts is the caller's: one prepare's alone, or in Blink and WebKit a page's, which every prepare of the
// page adds to and finds its contexts in (index.ts prepare has the lifetime, and why Gecko's pool is always one
// prepare's). A prepared paragraph keeps the pool it was made with, and the records that measure hold their contexts by
// reference. With a page's pool a canvas has shaped what the page's earlier paragraphs asked of it, and not only this
// paragraph's strings. That changes no answer while equal settings mean equal shaping and `partition` keeps apart the
// strings that Chrome would shape differently on one canvas.
//
// `width` and `bounds` always ask Canvas: nothing here stores an answer, counts a call or logs one. Within a context,
// measuring the same text again returns the same bits in all three engines (Blink returns the cached node for the whole
// text; WebKit and Gecko run the same shaping), so asking again can't change a result, only cost a call.
//
// The string an engine hands to measureText reaches Canvas as the engine built it: nothing here uses it as a key.
// V8 internalizes a string used as a Map, Set or property key, stores an internalized string in one byte whenever its
// units fit, and turns the looked-up string into a reference to it (builtins-collections-gen.cc:2590-2604,
// string-table.cc:398-427, factory.cc:1239-1257 and 1293-1300, string.cc:164-166 at Chrome 153's V8 6b96683d). Blink
// takes a one-byte string as an 8-bit one (to_blink_string.cc:216-227) and Canvas shapes an 8-bit string as one Latin
// segment, so a lookup of the text itself turned the two-byte string the Blink port slices (engines/blink/shape.ts
// canvasString) into a one-byte one before Canvas saw it (probe blink-storage S1: Amiri's 13 brackets at 48px measure
// 285.79px as the two-byte slice, 159.12px after any keyed use of it, and 285.79px after lookups of other strings that
// hold its characters; S5 asks through this file).

import { findRecord, insertRecord, orderedRecords, type OrderedLinks } from '../ordered-records.js'

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

export type Context = { readonly settings: Readonly<CanvasSettings>; readonly ctx: ContextWithLang }

function compareSettings(a: CanvasSettings, b: CanvasSettings): number {
  if (a.font !== b.font) return a.font < b.font ? -1 : 1
  if (a.lang !== b.lang) return a.lang < b.lang ? -1 : 1
  if (a.letterSpacing !== b.letterSpacing) return a.letterSpacing < b.letterSpacing ? -1 : 1
  if (a.wordSpacing !== b.wordSpacing) return a.wordSpacing < b.wordSpacing ? -1 : 1
  if (a.fontKerning !== b.fontKerning) return a.fontKerning < b.fontKerning ? -1 : 1
  if (a.textRendering !== b.textRendering) return a.textRendering < b.textRendering ? -1 : 1
  if (a.direction !== b.direction) return a.direction < b.direction ? -1 : 1
  return a.partition === b.partition ? 0 : a.partition < b.partition ? -1 : 1
}

type StoredContext = Context & OrderedLinks
const compareRequest = (settings: CanvasSettings, context: StoredContext): number => compareSettings(settings, context.settings)
const compareContexts = (a: StoredContext, b: StoredContext): number => compareSettings(a.settings, b.settings)

// Own the lookup and creation order together. A single preparation can contain arbitrarily many
// distinct declarations; the between-preparation size cap cannot bound a linear search inside it.
export class ContextPool {
  private readonly tree = orderedRecords<StoredContext>()

  get size(): number { return this.tree.records.length }
  get entries(): readonly Context[] { return this.tree.records }

  clear(): void {
    this.tree.records.length = 0
    this.tree.root = -1
  }

  context(settings: CanvasSettings): Context {
    const found = findRecord(this.tree, settings, compareRequest)
    if (found !== null) return found
    const owned = { ...settings }
    const ctx = new OffscreenCanvas(1, 1).getContext('2d') as ContextWithLang | null
    if (ctx === null) throw new Error('OffscreenCanvas has no 2d context')
    // lang first: Blink resolves the font under the context's language when the font string is set.
    ctx.lang = settings.lang
    ctx.font = settings.font
    ctx.letterSpacing = settings.letterSpacing
    ctx.wordSpacing = settings.wordSpacing
    ctx.fontKerning = settings.fontKerning
    ctx.textRendering = settings.textRendering
    ctx.direction = settings.direction
    return insertRecord(this.tree, { settings: owned, ctx, left: -1, right: -1, height: 1 }, compareContexts)
  }
}

export function createContextPool(): ContextPool { return new ContextPool() }

export function contextFor(contexts: ContextPool, settings: CanvasSettings): Context {
  return contexts.context(settings)
}

// rule blink/measure/string-reaches-canvas-as-built
export function width(context: Context, text: string): number {
  return context.ctx.measureText(text).width
}

// measureText with the glyph ink extent: actualBoundingBoxLeft and actualBoundingBoxRight, as distances left and right of
// the text origin.
export function bounds(context: Context, text: string): { width: number; left: number; right: number } {
  const metrics = context.ctx.measureText(text)
  return { width: metrics.width, left: metrics.actualBoundingBoxLeft, right: metrics.actualBoundingBoxRight }
}
