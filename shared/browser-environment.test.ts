import { expect, test } from 'bun:test'
import { createBrowserEnvironmentGuard, environmentFailure, parseBrowserEnvironmentReport, type BrowserEnvironmentReport, type BrowserEnvironmentSnapshot } from './browser-environment.ts'

const start: BrowserEnvironmentSnapshot = {
  dpr: 2, visualViewportScale: 1, innerWidth: 1200, innerHeight: 800, outerWidth: 1200, outerHeight: 900,
  screenX: 0, screenY: 0, screenWidth: 2560, screenHeight: 1440, screenAvailWidth: 2560, screenAvailHeight: 1400,
  visibility: 'visible', focused: true, language: 'en', direction: 'ltr',
}

test('a returned display scale does not erase an invalid measurement interval', () => {
  const report: BrowserEnvironmentReport = { userAgent: 'test', start, end: { ...start },
    changes: [{ field: 'dpr', value: 1, evidence: 'snapshot' }] }
  expect(environmentFailure(report, 'correctness')).toContain('dpr')
  expect(environmentFailure({ ...report, changes: [], end: { ...start, visualViewportScale: 1.5 } }, 'correctness')).toContain('visualViewportScale')
})

test('background correctness and foreground timing have different validity requirements', () => {
  const report: BrowserEnvironmentReport = { userAgent: 'test', start, end: { ...start, focused: false, visibility: 'hidden' },
    changes: [{ field: 'focused', value: false, evidence: 'snapshot' }] }
  expect(environmentFailure(report, 'correctness')).toBeNull()
  expect(environmentFailure(report, 'benchmark')).not.toBeNull()
  expect(environmentFailure({ ...report, end: { ...start } }, 'benchmark')).not.toBeNull()
})

test('same-DPR display movement is recorded without invalidating fixed-width correctness', () => {
  const report: BrowserEnvironmentReport = { userAgent: 'test', start, end: { ...start, screenX: 2560, screenWidth: 1440, screenHeight: 2560 }, changes: [] }
  expect(environmentFailure(report, 'correctness')).toBeNull()
  expect(environmentFailure(report, 'benchmark')).not.toBeNull()
  expect(environmentFailure({ ...report, end: { ...start, language: 'ja' } }, 'correctness')).toContain('language')
})

test('environment messages require complete finite geometry and document identity', () => {
  const report = { userAgent: 'test', start, end: start, changes: [] }
  for (const field of ['screenX', 'screenWidth', 'language', 'direction'] as const) {
    expect(() => parseBrowserEnvironmentReport({ ...report, start: { ...start, [field]: undefined } })).toThrow(`start.${field}`)
  }
  for (const field of ['screenY', 'innerWidth'] as const) {
    expect(() => parseBrowserEnvironmentReport({ ...report, end: { ...start, [field]: NaN } })).toThrow(`end.${field}`)
  }
  expect(() => parseBrowserEnvironmentReport({ ...report, userAgent: undefined })).toThrow('userAgent')
  expect(() => parseBrowserEnvironmentReport({ ...report, start: { ...start, visibility: 'unknown' } })).toThrow('visibility')
  expect(() => parseBrowserEnvironmentReport({ ...report, end: { ...start, direction: 'sideways' } })).toThrow('direction')
})

test('change evidence preserves valid returns and rejects malformed field/value pairs', () => {
  const snapshot = { ...start, screenX: -1200, language: '', direction: '', visualViewportScale: null }
  const report = { userAgent: 'test', start: snapshot, end: snapshot,
    changes: [{ field: 'dpr', value: 2, evidence: 'resolution-query' }] } satisfies BrowserEnvironmentReport
  expect(parseBrowserEnvironmentReport(report)).toEqual(report)
  for (const change of [
    { field: 'missing', value: 2, evidence: 'snapshot' },
    { field: 'dpr', value: '2', evidence: 'snapshot' },
    { field: 'focused', value: 1, evidence: 'snapshot' },
    { field: 'dpr', value: 1, evidence: 'unknown' },
    { field: 'screenX', value: 1, evidence: 'resolution-query' },
  ]) expect(() => parseBrowserEnvironmentReport({ ...report, changes: [change] })).toThrow('environment')
})

test('the live guard retains queued blur and observed scale transitions', () => {
  const viewport = Object.assign(new EventTarget(), { scale: 1 })
  const resolution = new EventTarget()
  const fakeWindow = Object.assign(new EventTarget(), {
    devicePixelRatio: 2, visualViewport: viewport,
    innerWidth: 1200, innerHeight: 800, outerWidth: 1200, outerHeight: 900,
    screenX: 0, screenY: 0,
    screen: { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400 },
    matchMedia: () => resolution,
  })
  const fakeDocument = Object.assign(new EventTarget(), {
    visibilityState: 'visible', hasFocus: () => true,
    documentElement: { lang: 'en', dir: 'ltr' },
  })
  const originals = ['window', 'document', 'navigator'].map(name => ({ name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name) }))
  let guard: ReturnType<typeof createBrowserEnvironmentGuard> | undefined
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
    Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test' } })
    guard = createBrowserEnvironmentGuard('correctness')
    // Focus has already returned when the queued blur callback is delivered.
    fakeWindow.dispatchEvent(new Event('blur'))
    expect(guard.report().end.focused).toBe(true)
    expect(environmentFailure(guard.report(), 'benchmark')).toContain('focused')
    expect(environmentFailure(guard.report(), 'correctness')).toBeNull()
    viewport.scale = 1.5
    viewport.dispatchEvent(new Event('resize'))
    viewport.scale = 1
    expect(environmentFailure(guard.report(), 'correctness')).toContain('visualViewportScale')
    // Chrome can coalesce the excursion and deliver only the return-to-match event.
    resolution.dispatchEvent(Object.assign(new Event('change'), { matches: true }))
    expect(guard.report().changes).toContainEqual({ field: 'dpr', value: 2, evidence: 'resolution-query' })
  } finally {
    guard?.dispose()
    for (const { name, descriptor } of originals) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name)
      else Object.defineProperty(globalThis, name, descriptor)
    }
  }
})
