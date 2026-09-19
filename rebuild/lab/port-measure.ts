// How an observation port measures live: one OffscreenCanvas 2D context per distinct settings, set in the order the
// library's measure/canvas.ts uses (lang before font). Only the WebKit port measures (research/observe-webkit.md §7). The
// page and the offline replay (rebuild/tests/replay.ts) share this, so a replayed port asks its questions of contexts that
// were assigned the same settings, spelled the same way, as the recorded ones (record.ts RecordedContext.assigned).
import type { CanvasMeasure } from './observe/contract.ts'

type ContextWithLang = OffscreenCanvasRenderingContext2D & { lang: string }

// A measurer with its own contexts. The page keeps one for the document's life; the replay makes one per case, since a
// replayed context answers from one case's record.
export function createPortMeasure(): CanvasMeasure {
  const contexts = new Map<string, ContextWithLang>()
  return (settings, text) => {
    const key = JSON.stringify(settings)
    let ctx = contexts.get(key)
    if (ctx === undefined) {
      const created = new OffscreenCanvas(1, 1).getContext('2d') as ContextWithLang | null
      if (created === null) throw new Error('OffscreenCanvas has no 2d context')
      created.lang = settings.lang
      created.font = settings.font
      created.letterSpacing = settings.letterSpacing
      created.wordSpacing = settings.wordSpacing
      created.fontKerning = settings.fontKerning
      created.textRendering = settings.textRendering
      created.direction = settings.direction
      contexts.set(key, created)
      ctx = created
    }
    return ctx.measureText(text).width
  }
}
