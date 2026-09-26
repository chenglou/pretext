// The environment a prediction is for: the engine, the build the caller runs, and the page, device and browser-process
// facts that engine's layout reads (DESIGN.md §1.4). The library reads only page facts itself (rebuild/CHARTER.md,
// "Boundaries"): the engine from the user agent, devicePixelRatio, <html lang>, which segmenters the running browser has,
// and whether its Canvas has what the engine's measuring recipes assume. Everything else is given, and a fact given as
// null is laid out with its documented default and reported as a gap.
// Tests, and predictions for another runtime, build an Environment directly.
import { blinkCanvasNeeds } from './engines/blink/checks.js'
import { geckoCanvasNeeds } from './engines/gecko/checks.js'
import { webkitCanvasNeeds } from './engines/webkit/checks.js'
import { missingCanvasSupport, type CanvasNeeds } from './measure/canvas-checks.js'

export type EngineName = 'blink' | 'webkit' | 'gecko'

// The builds the ports are pinned to, as the app bundles report them: Chrome's and Firefox's CFBundleShortVersionString,
// and WebKit.framework's CFBundleVersion, which Safari 27.0 and webkit-host share (source tag WebKit-7625.1.29.11.27).
// A layout for another build, or for an unknown one, reports the engine-build gap.
export const PINNED_BUILDS = { blink: '153.0.8010.48', webkit: '22625.1.29.11.27', gecko: '156.0' } as const satisfies Record<EngineName, string>

// Builds accepted as the pinned one, each with its evidence. They report no engine-build gap.
// Chrome 153.0.8010.50 (installed since 2026-09-17): in the Chromium checkout, `git diff --name-only 153.0.8010.48
// 153.0.8010.50` lists chrome/VERSION alone and DEPS is unchanged, so Blink, V8, HarfBuzz, ICU and Skia are the pinned
// revisions; the lab's native views are equal on all 76,029 cases both builds observed (REPORT.md §2).
// Chrome 154.0.8037.57 (the lab's pin since 2026-09-25): from 153.0.8010.50 the Blink files the port reads change in
// refactors and in what it doesn't model (line-clamp's ellipsis, text-box-trim on inline boxes, shrink-to-fit content
// sizes, a vertical canvas element's font orientation); the HarfBuzz roll (dfdc088c to 886fc1e6) saturates positions
// that would overflow; every ICU entry of data/blink is byte-identical in its icudtl.dat; V8 and Skia rolled. Recorded
// again under it, the tier sets ask the same Canvas questions, get the same answers and predict the same: every case
// without facts in both orders, and a stratified tenth of the cases with them (TAKEOVER.md).
// Firefox 156.0.1 (the lab's pin since 2026-09-25): from FIREFOX_156_0_RELEASE nothing under gfx/ or intl/ changes, and
// under layout/ only AbsoluteContainingBlock.cpp (an anchor-positioning fallback, bug 2070171); recorded again, the tier
// sets ask the same Canvas questions, get the same answers and predict the same in both configurations and both orders,
// and every probe fact of 156.0 holds (facts/gecko/156.0.1.ndjson).
export const ACCEPTED_BUILDS: Record<EngineName, readonly string[]> = { blink: ['153.0.8010.50', '154.0.8037.57'], webkit: [], gecko: ['156.0.1'] }

// The languages a browser process uses for content without a usable lang, per engine (DESIGN.md §1.4). No page API shows
// them, and the library never reads them from the OS, so they are given facts; the lab sets or reads them when it
// launches a browser (lab/types.ts ProcessLanguages). A null value is laid out with the root locale and reports
// ui-language wherever it decides a result.
export type BlinkProcessLanguages = {
  // DefaultLanguage(): the canonicalized Platform::DefaultLocale(), Chrome's application locale, taken once per renderer
  // (InitializePlatformLanguage and DefaultLanguage, language.cc:62-99). It opens the break table for content with no
  // locale, is the retry locale of ko@lb=strict, and picks generic families and the HarfBuzz language
  // (specs/blink-canvas.md §2.3; probes blink-canvas H22, H23).
  uiLanguage: string | null
}

export type WebKitProcessLanguages = {
  // WTF::userPreferredLanguages() of the WebContent process: the override languages the UI process sends in the bootstrap
  // message when it sets them (XPCServiceMain.mm:62-78, 181-192; WebProcessPool.cpp:990; OverrideLanguages.cpp:38), else
  // the system's preferred languages. A Han lang becomes the first entry starting with zh- (specs/webkit-canvas.md §1.3).
  preferredLanguages: readonly string[] | null
  // uloc_getDefault() of the WebContent process: en_US_POSIX unless launchd passes LANG or LC_* (specs/webkit-gaps.md
  // §8.2). The quote overrides of a locale ICU has no data for fall back through it (§8.3).
  icuDefaultLocale: string | null
}

export type GeckoProcessLanguages = {
  // The first OSPreferences::GetRegionalPrefsLocales entry, lowercased (nsLanguageAtomService::GetLocaleLanguage,
  // nsLanguageAtomService.cpp:107-138). On macOS that is the OS's system locales (OSPreferences.cpp:445-458,
  // mac/OSPreferences_mac.cpp:59-63), whatever intl.locale.requested says: the style language of content without lang in
  // a UTF-8 document, which decides the ja/zh segment-break rule and the shaping language (specs/gecko-text.md §2.4; probe
  // gecko-text H15). Firefox's navigator.language comes from accept-languages instead.
  regionalPrefsLocale: string | null
}

export type ProcessLanguages =
  | ({ engine: 'blink' } & BlinkProcessLanguages)
  | ({ engine: 'webkit' } & WebKitProcessLanguages)
  | ({ engine: 'gecko' } & GeckoProcessLanguages)

export type BlinkEnvironment = BlinkProcessLanguages & {
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
  // Intl.v8BreakIterator runs the same ICU 78.2 and icudtl.dat as layout (specs/blink-canvas.md §2.6).
  dictionaryBreaks: { kind: 'v8-break-iterator' } | { kind: 'unavailable' }
}

export type WebKitEnvironment = WebKitProcessLanguages & {
  engine: 'webkit'
  build: string | null
  // The backing scale factor; no line-breaking code reads it (specs/webkit-lines.md §1.6).
  devicePixelRatio: number
  // Safari's page zoom, which multiplies lengths and font sizes and no page API shows (specs/webkit-gaps.md §1). null:
  // laid out at 1, with the page-zoom gap.
  pageZoom: number | null
  pageLang: string
  contentLanguage: string | null
  // JSC's Intl.Segmenter word granularity over libicucore's dictionaries (specs/webkit-text.md §5.5).
  dictionaryBreaks: { kind: 'intl-segmenter-word' } | { kind: 'unavailable' }
}

export type GeckoEnvironment = GeckoProcessLanguages & {
  engine: 'gecko'
  build: string | null
  // 60 / app units per device pixel, browser zoom included (specs/gecko-lines.md §2.1).
  devicePixelRatio: number
  pageLang: string
  contentLanguage: string | null
  // Firefox's Intl.Segmenter word granularity runs ICU4X's word segmenter with layout's LSTM models (specs/gecko-text.md §10).
  dictionaryBreaks: { kind: 'intl-segmenter-word' } | { kind: 'unavailable' }
}

export type Environment = BlinkEnvironment | WebKitEnvironment | GeckoEnvironment

// What the caller knows about the browser it runs and the document, for that engine.
export type GivenFacts =
  | (BlinkProcessLanguages & { engine: 'blink'; build: string | null; contentLanguage: string | null })
  | (WebKitProcessLanguages & { engine: 'webkit'; build: string | null; contentLanguage: string | null; pageZoom: number | null })
  | (GeckoProcessLanguages & { engine: 'gecko'; build: string | null; contentLanguage: string | null })

export type DetectedEngine =
  | { kind: 'supported'; engine: EngineName }
  | { kind: 'unsupported'; userAgent: string; reason: string }

export type DetectedEnvironment =
  | { kind: 'supported'; env: Environment }
  | { kind: 'unsupported'; userAgent: string; reason: string }

// The engine from a user agent: the engine that lays the page out, whatever the browser is called. Every Chromium
// browser says `Chrome/` and runs Blink (Edge, Opera, Samsung Internet, an Android WebView). Every browser on iOS runs
// WebKit and says `AppleWebKit/` without `Chrome/` (Chrome there is `CriOS/`, Firefox `FxiOS/`, Edge `EdgiOS/`), as does a
// WKWebView, which has no `Version/… Safari/`. Chrome's own user agent holds `AppleWebKit/` and `Safari/` too, so it is
// asked first. Only Chrome, Firefox and Safari on one Mac are pinned and tested; the others ride on their engine. The
// build isn't read here: Chrome's reduced user agent shows only the major version.
export function engineOfUserAgent(ua: string): DetectedEngine {
  if (/\bFirefox\//.test(ua)) return { kind: 'supported', engine: 'gecko' }
  if (/\bChrome\//.test(ua)) return { kind: 'supported', engine: 'blink' }
  if (/\bAppleWebKit\//.test(ua)) return { kind: 'supported', engine: 'webkit' }
  return { kind: 'unsupported', userAgent: ua, reason: 'unknown browser' }
}

function engineFromUserAgent(): DetectedEngine {
  return engineOfUserAgent(navigator.userAgent)
}

// What each port's measuring recipes assume of Canvas, as the port lists it (engines/<engine>/checks.ts).
function canvasNeedsOf(engine: EngineName): CanvasNeeds {
  switch (engine) {
    case 'blink': return blinkCanvasNeeds
    case 'webkit': return webkitCanvasNeeds
    case 'gecko': return geckoCanvasNeeds
  }
}

// What can't change while the page lives, so a page asks once: the engine, and whether this browser's Canvas is one the
// engine's measuring recipes can read (measure/canvas-checks.ts: two contexts and two measureText calls). A page learns
// the engine here before it can give that engine's facts to detectEnvironment.
export function detectEngine(): DetectedEngine {
  const detected = engineFromUserAgent()
  if (detected.kind === 'unsupported') return detected
  const missing = missingCanvasSupport(canvasNeedsOf(detected.engine))
  if (missing.length === 0) return detected
  return { kind: 'unsupported', userAgent: navigator.userAgent, reason: `this browser's Canvas lacks what the ${detected.engine} port measures with: ${missing.join('; ')}` }
}

// What can change while the page lives (devicePixelRatio with zoom, <html lang>), with the given facts. It asks Canvas
// nothing, so a page can call it again whenever those change.
export function detectEnvironment(given: GivenFacts): DetectedEnvironment {
  const detected = engineFromUserAgent()
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
