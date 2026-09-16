// The environment a prediction is for: the engine and its pinned version, and the page, device and system facts the
// engines' layout reads. detectEnvironment() reads them from the running browser. Anything else (tests, predicting one
// engine from another runtime) builds an Environment object directly.

export type EngineName = 'blink' | 'webkit' | 'gecko'

export type Engine =
  | { name: 'blink'; browser: 'Chrome'; version: '153.0.8010.48'; icu: '78.2' }
  | { name: 'webkit'; browser: 'Safari'; version: '27.0'; webkit: '7625.1.29.11.27'; icu: 'libicucore 78.1' }
  | { name: 'gecko'; browser: 'Firefox'; version: '156.0'; segmenter: 'icu_segmenter 2.1.2' }

export const BLINK: Engine = { name: 'blink', browser: 'Chrome', version: '153.0.8010.48', icu: '78.2' }
export const WEBKIT: Engine = { name: 'webkit', browser: 'Safari', version: '27.0', webkit: '7625.1.29.11.27', icu: 'libicucore 78.1' }
export const GECKO: Engine = { name: 'gecko', browser: 'Firefox', version: '156.0', segmenter: 'icu_segmenter 2.1.2' }

// Where boundaries inside runs of Thai, Lao, Khmer and Myanmar text come from (DESIGN.md §6). Only the running
// browser's own segmenter is backed by the engine's dictionary or model data, so an Environment built for another
// runtime has 'unavailable', and predictions with such text name that gap.
export type DictionaryBreaks =
  // Chrome: Intl.v8BreakIterator runs the same ICU 78.2 and icudtl.dat as layout (specs/blink-canvas.md §2.6).
  | { kind: 'v8-break-iterator' }
  // Safari: JSC's Intl.Segmenter word granularity over libicucore; Firefox: ICU4X's word segmenter with the LSTM
  // models layout uses (specs/webkit-text.md §5.5, specs/gecko-text.md §10).
  | { kind: 'intl-segmenter-word' }
  | { kind: 'unavailable' }

export type Environment = {
  engine: Engine
  // window.devicePixelRatio. Blink: its layout zoom, device scale factor times browser zoom (specs/blink-lines.md §2.1).
  // Gecko: 60 / app units per device pixel, browser zoom included (specs/gecko-lines.md §2.1). WebKit: the backing scale
  // factor; no line-breaking code reads it (specs/webkit-lines.md §1.6).
  devicePixelRatio: number
  // Safari's page zoom, which neither devicePixelRatio nor any page API exposes. 1 for Blink and Gecko, whose browser
  // zoom is inside devicePixelRatio.
  pageZoom: number
  // document.documentElement.lang when the paragraph is laid out, '' when absent. Blink's OffscreenCanvas and Gecko's
  // disconnected canvas read it (specs/blink-canvas.md §1.2, specs/gecko-canvas.md §1.2 C3).
  pageLang: string
  // The document's Content-Language (HTTP header or <meta http-equiv>), or null. It is the root locale when no element
  // has lang (specs/blink-text.md §2.F.3, specs/webkit-text.md §4.1, specs/gecko-text.md §2.4). Pages can't read the
  // header, so detection reports null.
  contentLanguage: string | null
  // navigator.language. What each engine reads for unlabeled content, and whether navigator.language equals it, is in
  // DESIGN.md §1: Chrome's UI language, Safari's preferred languages, Firefox's regional-prefs locale.
  uiLanguage: string
  // navigator.languages. WebKit's specialized Chinese locale is the first entry starting with zh- (specs/webkit-canvas.md §1.3).
  preferredLanguages: readonly string[]
  dictionaryBreaks: DictionaryBreaks
}

export type DetectedEnvironment =
  | { kind: 'supported'; env: Environment }
  | { kind: 'unsupported'; userAgent: string; reason: string }

// Chrome's reduced user agent shows only the major version (Chrome/153.0.0.0); the full build needs the asynchronous
// userAgentData.getHighEntropyValues, so detection pins the major version and the lab records the full user agent.
function engineFromUserAgent(ua: string): Engine | string {
  if (/\bFirefox\//.test(ua)) return /\bFirefox\/156\.0\b/.test(ua) ? GECKO : 'Firefox other than 156.0'
  if (/\bEdg\//.test(ua) || /\bOPR\//.test(ua)) return 'Chromium browsers other than Chrome are not modeled'
  if (/\bChrome\//.test(ua)) return /\bChrome\/153\./.test(ua) ? BLINK : 'Chrome other than 153'
  if (/\bVersion\/[\d.]+ .*Safari\//.test(ua)) return /\bVersion\/27\.0\b/.test(ua) ? WEBKIT : 'Safari other than 27.0'
  return 'unknown browser'
}

export function detectEnvironment(): DetectedEnvironment {
  const ua = navigator.userAgent
  const engine = engineFromUserAgent(ua)
  if (typeof engine === 'string') return { kind: 'unsupported', userAgent: ua, reason: engine }
  let dictionaryBreaks: DictionaryBreaks
  switch (engine.name) {
    case 'blink':
      dictionaryBreaks = 'v8BreakIterator' in Intl ? { kind: 'v8-break-iterator' } : { kind: 'unavailable' }
      break
    case 'webkit':
    case 'gecko':
      dictionaryBreaks = typeof Intl.Segmenter === 'function' ? { kind: 'intl-segmenter-word' } : { kind: 'unavailable' }
      break
  }
  return {
    kind: 'supported',
    env: {
      engine,
      devicePixelRatio: window.devicePixelRatio,
      pageZoom: 1,
      pageLang: document.documentElement.lang,
      contentLanguage: null,
      uiLanguage: navigator.language,
      preferredLanguages: navigator.languages,
      dictionaryBreaks,
    },
  }
}
