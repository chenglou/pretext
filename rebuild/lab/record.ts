// run.ts --record-measurements, the page side: every answer a case takes from the browser while it is predicted, observed
// by its port and painted, in call order. A re-architected library is then checked offline (measurements.ts): it must ask
// Canvas the same questions or fewer and get the same lines, with no browser running.
//
// Recorded per case:
// - every measureText call on an OffscreenCanvas or <canvas> 2D context: the context's settings at that call, both as the
//   caller assigned them and as the context reports them, the string, the width and the ink box (actualBoundingBox left,
//   right, ascent, descent);
// - every dictionary segmentation the engines ask the browser for (Intl.Segmenter.segment in WebKit and Gecko,
//   Intl.v8BreakIterator in Blink): without them a layout of Thai or Khmer text can't be repeated offline.
// The other browser facts a layout reads (user agent, DPR, <html lang>) are in the row's env.
//
// The recorder wraps the prototypes' methods and passes every argument through untouched, so the browser sees the same
// string objects (Blink's Canvas results depend on V8's 8-bit or 16-bit storage, which JS can't read). It is installed only
// when the driver asks for it: timings of a recorded run aren't comparable with other runs.
// A context's drawing-state text settings as the context reports them; null where the browser's context lacks the
// attribute (WebKit has no lang, fontKerning or textRendering; a value assigned there is an ordinary property, never read).
const SETTING_KEYS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction', 'fontStretch', 'fontVariantCaps', 'textAlign', 'textBaseline'] as const
export type RecordedSettings = Record<typeof SETTING_KEYS[number], string | null>

export type RecordedContext = {
  kind: 'offscreen' | 'element'
  // The last value the caller assigned to each setting, as it spelled it ('normal 400 16px Arial' where the context reports
  // '16px Arial'); settings never assigned are absent. The offline replay finds a context by these.
  assigned: Partial<Record<typeof SETTING_KEYS[number], string>>
  settings: RecordedSettings
  // The context object's number in its document, so a context reused across cases (the WebKit port's) is recognizable. A
  // context whose assigned or reported settings change during a case gets a second entry with the same number.
  document: number
  // fontBoundingBoxAscent and Descent of the entry's first call.
  fontBox: [number, number]
}

// [index into contexts, string, width, actualBoundingBoxLeft, Right, Ascent, Descent]
export type RecordedCall = [number, string, number, number, number, number, number]

export type RecordedSegmentation =
  // Intl.Segmenter: resolved locale, granularity, the string, every segment's start index, and isWordLike per segment (word
  // granularity only).
  | { api: 'segmenter'; locale: string; granularity: string; text: string; starts: number[]; wordLike: boolean[] | null }
  // Intl.v8BreakIterator: the locales and type it was made with, the adopted string, and every value next() returned.
  | { api: 'v8-break-iterator'; locales: string[]; type: string; text: string; breaks: number[] }

export const PHASES = ['native', 'predict', 'observe', 'paint'] as const
export type Phase = typeof PHASES[number]

export type CaseMeasurements = {
  id: string
  contexts: RecordedContext[]
  calls: RecordedCall[]
  // Per phase, the half-open range of `calls` made in it. 'native' holds the lab's own font probe, never library calls.
  phases: Record<Phase, [number, number]>
  segmentations: RecordedSegmentation[]
}

type AnyContext = (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) & Partial<Record<typeof SETTING_KEYS[number], string>>
type Active = CaseMeasurements & { byContext: Map<object, { index: number; key: string }>; phase: Phase }

let installed = false
let active: Active | null = null
const documentNumbers = new WeakMap<object, number>()
let documentContexts = 0
const assignedSettings = new WeakMap<object, RecordedContext['assigned']>()

// Per context kind, whether the browser's prototype has each setting.
const hasSetting: Record<RecordedContext['kind'], boolean[]> = { offscreen: [], element: [] }

function record(ctx: AnyContext, kind: RecordedContext['kind'], text: string, metrics: TextMetrics): void {
  const current = active!
  const values: Array<string | null> = []
  for (let i = 0; i < SETTING_KEYS.length; i++) {
    const value = hasSetting[kind][i] === true ? ctx[SETTING_KEYS[i]!] : null
    values.push(typeof value === 'string' ? value : null)
  }
  const assigned = assignedSettings.get(ctx) ?? {}
  const key = `${values.join('\n')}\n${JSON.stringify(assigned)}`
  let known = current.byContext.get(ctx)
  if (known === undefined || known.key !== key) {
    let number = documentNumbers.get(ctx)
    if (number === undefined) {
      number = documentContexts++
      documentNumbers.set(ctx, number)
    }
    const settings = {} as RecordedSettings
    for (let i = 0; i < SETTING_KEYS.length; i++) settings[SETTING_KEYS[i]!] = values[i]!
    known = { index: current.contexts.length, key }
    current.contexts.push({ kind, assigned: { ...assigned }, settings, document: number, fontBox: [metrics.fontBoundingBoxAscent, metrics.fontBoundingBoxDescent] })
    current.byContext.set(ctx, known)
  }
  current.calls.push([known.index, text, metrics.width, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxRight, metrics.actualBoundingBoxAscent, metrics.actualBoundingBoxDescent])
}

function wrapMeasureText(proto: { measureText(text: string): TextMetrics }, kind: RecordedContext['kind']): void {
  // Setters first: they note what the caller assigned, whether or not a case is being recorded, since a context outlives
  // the case that made it.
  for (let i = 0; i < SETTING_KEYS.length; i++) {
    const name = SETTING_KEYS[i]!
    hasSetting[kind][i] = name in proto
    const descriptor = Object.getOwnPropertyDescriptor(proto, name)
    if (descriptor === undefined || descriptor.set === undefined) continue
    const set = descriptor.set
    Object.defineProperty(proto, name, {
      ...descriptor,
      set(this: object, value: unknown): void {
        let assigned = assignedSettings.get(this)
        if (assigned === undefined) {
          assigned = {}
          assignedSettings.set(this, assigned)
        }
        assigned[name] = String(value)
        set.call(this, value)
      },
    })
  }
  const original = proto.measureText
  proto.measureText = function (this: AnyContext, text: string): TextMetrics {
    const metrics = original.call(this, text)
    if (active !== null) record(this, kind, text, metrics)
    return metrics
  }
}

type V8BreakIterator = { adoptText(text: string): void; first(): number; next(): number; current(): number; breakType(): string; resolvedOptions(): unknown }
type V8Constructor = new (locales?: string | string[], options?: { type?: string }) => V8BreakIterator

function wrapSegmenters(): void {
  if (typeof Intl.Segmenter === 'function') {
    const original = Intl.Segmenter.prototype.segment
    Intl.Segmenter.prototype.segment = function (this: Intl.Segmenter, text: string): Intl.Segments {
      if (active !== null) {
        const options = this.resolvedOptions()
        const starts: number[] = []
        const wordLike: boolean[] = []
        for (const part of original.call(this, text)) {
          starts.push(part.index)
          wordLike.push(part.isWordLike === true)
        }
        active.segmentations.push({ api: 'segmenter', locale: options.locale, granularity: options.granularity, text, starts, wordLike: options.granularity === 'word' ? wordLike : null })
      }
      return original.call(this, text)
    }
  }
  const intl = Intl as unknown as { v8BreakIterator?: V8Constructor }
  const Original = intl.v8BreakIterator
  if (Original === undefined) return
  // A constructor that returns an object hands that object to `new`. The wrapper forwards every call.
  const Recording = function (locales?: string | string[], options?: { type?: string }): V8BreakIterator {
    const inner = new Original(locales, options)
    let entry: Extract<RecordedSegmentation, { api: 'v8-break-iterator' }> | null = null
    return {
      adoptText(text: string): void {
        entry = null
        if (active !== null) {
          entry = { api: 'v8-break-iterator', locales: locales === undefined ? [] : typeof locales === 'string' ? [locales] : [...locales], type: options?.type ?? 'word', text, breaks: [] }
          active.segmentations.push(entry)
        }
        inner.adoptText(text)
      },
      first: () => inner.first(),
      next(): number {
        const value = inner.next()
        if (entry !== null) entry.breaks.push(value)
        return value
      },
      current: () => inner.current(),
      breakType: () => inner.breakType(),
      resolvedOptions: () => inner.resolvedOptions(),
    }
  } as unknown as V8Constructor
  intl.v8BreakIterator = Recording
}

export function installRecorder(): void {
  if (installed) return
  installed = true
  wrapMeasureText(OffscreenCanvasRenderingContext2D.prototype, 'offscreen')
  wrapMeasureText(CanvasRenderingContext2D.prototype, 'element')
  wrapSegmenters()
}

export function beginCase(id: string): void {
  active = { id, contexts: [], calls: [], phases: { native: [0, 0], predict: [0, 0], observe: [0, 0], paint: [0, 0] }, segmentations: [], byContext: new Map(), phase: 'native' }
}

// Phases run in PHASES order; entering one closes the one before it.
export function beginPhase(phase: Phase): void {
  const current = active!
  current.phases[current.phase][1] = current.calls.length
  current.phase = phase
  current.phases[phase] = [current.calls.length, current.calls.length]
}

// Ends the case.
export function endCase(): CaseMeasurements {
  const current = active!
  active = null
  current.phases[current.phase][1] = current.calls.length
  const { byContext: _byContext, phase: _phase, ...result } = current
  return result
}
