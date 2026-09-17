// The environment a prediction is for: the engine, the build the caller runs, and the page, device and browser-process
// facts that engine's layout reads (DESIGN.md §1.4). The library reads only page facts itself (rebuild/CHARTER.md,
// "Boundaries"): the engine from the user agent, devicePixelRatio, <html lang> and which segmenters the running browser
// has. Everything else is given, and a fact given as null is laid out with its documented default and reported as a gap.
// Tests, and predictions for another runtime, build an Environment directly.

export type EngineName = 'blink' | 'webkit' | 'gecko'

// The builds the ports are pinned to, as the app bundles report them: Chrome's and Firefox's CFBundleShortVersionString,
// and WebKit.framework's CFBundleVersion, which Safari 27.0 and webkit-host share (source tag WebKit-7625.1.29.11.27).
// A layout for another build, or for an unknown one, reports the engine-build gap.
export const PINNED_BUILDS = { blink: '153.0.8010.48', webkit: '22625.1.29.11.27', gecko: '156.0' } as const satisfies Record<EngineName, string>

export type BlinkEnvironment = {
  engine: 'blink'
  // The app bundle version the caller runs, or null.
  build: string | null
  // window.devicePixelRatio: device scale factor times browser zoom, Blink's layout zoom (specs/blink-lines.md §2.1).
  devicePixelRatio: number
  // document.documentElement.lang, '' when absent. OffscreenCanvas resolves it when the font string is set
  // (specs/blink-canvas.md §1.2).
  pageLang: string
  // The document's Content-Language (HTTP header or <meta http-equiv>), or null when it has none: the root locale when
  // no element has lang (specs/blink-text.md §2.F.3). Pages can't read the header, so it is given.
  contentLanguage: string | null
  // DefaultLanguage(), Chrome's application locale: the break table for content without a locale, the retry locale of
  // ko@lb=strict, generic families and the HarfBuzz language (specs/blink-canvas.md §2.3; probes blink-canvas H22, H23).
  // null: such content reports ui-language.
  uiLanguage: string | null
  // Intl.v8BreakIterator runs the same ICU 78.2 and icudtl.dat as layout (specs/blink-canvas.md §2.6).
  dictionaryBreaks: { kind: 'v8-break-iterator' } | { kind: 'unavailable' }
}

export type WebKitEnvironment = {
  engine: 'webkit'
  build: string | null
  // The backing scale factor; no line-breaking code reads it (specs/webkit-lines.md §1.6).
  devicePixelRatio: number
  // Safari's page zoom, which multiplies lengths and font sizes and no page API shows (specs/webkit-gaps.md §1). null:
  // laid out at 1, with the page-zoom gap.
  pageZoom: number | null
  pageLang: string
  contentLanguage: string | null
  // WTF::userPreferredLanguages() of the WebContent process, the system's preferred languages passed at launch
  // (XPCServiceMain.mm:67-78). A Han lang becomes the first entry starting with zh- (specs/webkit-canvas.md §1.3). null:
  // such content reports ui-language.
  preferredLanguages: readonly string[] | null
  // uloc_getDefault() of the WebContent process: en_US_POSIX unless launchd passes LANG or LC_* (specs/webkit-gaps.md
  // §8.2). The quote overrides of a locale ICU has no data for fall back through it (§8.3). null: such content reports
  // ui-language.
  icuDefaultLocale: string | null
  // JSC's Intl.Segmenter word granularity over libicucore's dictionaries (specs/webkit-text.md §5.5).
  dictionaryBreaks: { kind: 'intl-segmenter-word' } | { kind: 'unavailable' }
}

export type GeckoEnvironment = {
  engine: 'gecko'
  build: string | null
  // 60 / app units per device pixel, browser zoom included (specs/gecko-lines.md §2.1).
  devicePixelRatio: number
  pageLang: string
  contentLanguage: string | null
  // The OS regional-preferences locale, lowercased (nsLanguageAtomService.cpp:107-127): the style language of content
  // without lang in a UTF-8 document, which decides the ja/zh segment-break rule and the shaping language
  // (specs/gecko-text.md §2.4; probe gecko-text H15). Firefox's navigator.language comes from accept-languages instead.
  // null: such content reports ui-language.
  regionalPrefsLocale: string | null
  // Firefox's Intl.Segmenter word granularity runs ICU4X's word segmenter with layout's LSTM models (specs/gecko-text.md §10).
  dictionaryBreaks: { kind: 'intl-segmenter-word' } | { kind: 'unavailable' }
}

export type Environment = BlinkEnvironment | WebKitEnvironment | GeckoEnvironment

// What the caller knows about the browser it runs and the document, for that engine.
export type GivenFacts =
  | { engine: 'blink'; build: string | null; contentLanguage: string | null; uiLanguage: string | null }
  | { engine: 'webkit'; build: string | null; contentLanguage: string | null; pageZoom: number | null; preferredLanguages: readonly string[] | null; icuDefaultLocale: string | null }
  | { engine: 'gecko'; build: string | null; contentLanguage: string | null; regionalPrefsLocale: string | null }

export type DetectedEngine =
  | { kind: 'supported'; engine: EngineName }
  | { kind: 'unsupported'; userAgent: string; reason: string }

export type DetectedEnvironment =
  | { kind: 'supported'; env: Environment }
  | { kind: 'unsupported'; userAgent: string; reason: string }

// The engine from the user agent. The build isn't read here: Chrome's reduced user agent shows only the major version.
export function detectEngine(): DetectedEngine {
  const ua = navigator.userAgent
  if (/\bFirefox\//.test(ua)) return { kind: 'supported', engine: 'gecko' }
  if (/\bEdg\//.test(ua) || /\bOPR\//.test(ua)) return { kind: 'unsupported', userAgent: ua, reason: 'Chromium browsers other than Chrome are not modeled' }
  if (/\bChrome\//.test(ua)) return { kind: 'supported', engine: 'blink' }
  if (/\bVersion\/[\d.]+ .*Safari\//.test(ua)) return { kind: 'supported', engine: 'webkit' }
  return { kind: 'unsupported', userAgent: ua, reason: 'unknown browser' }
}

export function detectEnvironment(given: GivenFacts): DetectedEnvironment {
  const detected = detectEngine()
  if (detected.kind === 'unsupported') return detected
  const ua = navigator.userAgent
  if (detected.engine !== given.engine) return { kind: 'unsupported', userAgent: ua, reason: `the given facts are for ${given.engine}; the page runs ${detected.engine}` }
  const devicePixelRatio = window.devicePixelRatio
  const pageLang = document.documentElement.lang
  switch (given.engine) {
    case 'blink':
      return {
        kind: 'supported',
        env: {
          engine: 'blink', build: given.build, devicePixelRatio, pageLang, contentLanguage: given.contentLanguage,
          uiLanguage: given.uiLanguage,
          dictionaryBreaks: 'v8BreakIterator' in Intl ? { kind: 'v8-break-iterator' } : { kind: 'unavailable' },
        },
      }
    case 'webkit':
      return {
        kind: 'supported',
        env: {
          engine: 'webkit', build: given.build, devicePixelRatio, pageZoom: given.pageZoom, pageLang,
          contentLanguage: given.contentLanguage, preferredLanguages: given.preferredLanguages, icuDefaultLocale: given.icuDefaultLocale,
          dictionaryBreaks: typeof Intl.Segmenter === 'function' ? { kind: 'intl-segmenter-word' } : { kind: 'unavailable' },
        },
      }
    case 'gecko':
      return {
        kind: 'supported',
        env: {
          engine: 'gecko', build: given.build, devicePixelRatio, pageLang, contentLanguage: given.contentLanguage,
          regionalPrefsLocale: given.regionalPrefsLocale,
          dictionaryBreaks: typeof Intl.Segmenter === 'function' ? { kind: 'intl-segmenter-word' } : { kind: 'unavailable' },
        },
      }
  }
}
