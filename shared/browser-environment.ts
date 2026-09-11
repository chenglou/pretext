export type BrowserEnvironmentSnapshot = {
  dpr: number
  visualViewportScale: number | null
  innerWidth: number
  innerHeight: number
  outerWidth: number
  outerHeight: number
  screenX: number
  screenY: number
  screenWidth: number
  screenHeight: number
  screenAvailWidth: number
  screenAvailHeight: number
  visibility: DocumentVisibilityState
  focused: boolean
  language: string
  direction: string
}

type EnvironmentField = keyof BrowserEnvironmentSnapshot
type EnvironmentChange = {
  field: EnvironmentField
  value: BrowserEnvironmentSnapshot[EnvironmentField]
  evidence: 'snapshot' | 'resolution-query'
}

export type BrowserEnvironmentReport = {
  userAgent: string
  start: BrowserEnvironmentSnapshot
  end: BrowserEnvironmentSnapshot
  // Retain the first change per field, including changes that later revert.
  changes: EnvironmentChange[]
}

export type MeasurementMode = 'correctness' | 'benchmark'

const fields: EnvironmentField[] = [
  'dpr', 'visualViewportScale', 'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
  'screenX', 'screenY', 'screenWidth', 'screenHeight', 'screenAvailWidth', 'screenAvailHeight',
  'visibility', 'focused', 'language', 'direction',
]

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Missing ${label}`)
  return value as Record<string, unknown>
}

function isField(value: unknown): value is EnvironmentField {
  return fields.some(field => field === value)
}

function isFieldValue<K extends EnvironmentField>(field: K, value: unknown): value is BrowserEnvironmentSnapshot[K] {
  switch (field) {
    case 'dpr': return typeof value === 'number' && Number.isFinite(value) && value > 0
    case 'visualViewportScale': return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0)
    case 'screenX': case 'screenY': return typeof value === 'number' && Number.isFinite(value)
    case 'innerWidth': case 'innerHeight': case 'outerWidth': case 'outerHeight':
    case 'screenWidth': case 'screenHeight': case 'screenAvailWidth': case 'screenAvailHeight':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
    case 'visibility': return value === 'visible' || value === 'hidden'
    case 'focused': return typeof value === 'boolean'
    case 'language': return typeof value === 'string'
    case 'direction': return value === '' || value === 'ltr' || value === 'rtl' || value === 'auto'
  }
}

function assertSnapshot(value: unknown, label: string): asserts value is BrowserEnvironmentSnapshot {
  const snapshot = object(value, label)
  for (const field of fields) {
    if (!isFieldValue(field, snapshot[field])) throw new Error(`Invalid ${label}.${field}`)
  }
}

// Browser messages cross a JSON boundary. Preserve their measurement evidence,
// but establish its complete shape before environment policy or aggregation.
export function parseBrowserEnvironmentReport(value: unknown): BrowserEnvironmentReport {
  const report = object(value, 'browser environment')
  const userAgent = report['userAgent'], start = report['start'], end = report['end']
  if (typeof userAgent !== 'string' || userAgent.length === 0) throw new Error('Invalid browser environment.userAgent')
  assertSnapshot(start, 'browser environment.start')
  assertSnapshot(end, 'browser environment.end')
  const rawChanges = report['changes']
  if (!Array.isArray(rawChanges)) throw new Error('Missing browser environment.changes')
  const changes: EnvironmentChange[] = []
  for (const value of rawChanges) {
    const change = object(value, 'browser environment change')
    const field = change['field'], observed = change['value'], evidence = change['evidence']
    if (!isField(field) || !isFieldValue(field, observed)) throw new Error('Invalid browser environment change field/value')
    if (evidence !== 'snapshot' && evidence !== 'resolution-query') throw new Error('Invalid browser environment change evidence')
    if (evidence === 'resolution-query' && field !== 'dpr') throw new Error('Invalid browser environment change: resolution-query must describe DPR')
    if (changes.some(change => change.field === field)) throw new Error(`Repeated browser environment change: ${field}`)
    changes.push({ field, value: observed, evidence })
  }
  return { userAgent, start, end, changes }
}

function invalidatingField(field: EnvironmentField, mode: MeasurementMode): boolean {
  return mode === 'benchmark' || field === 'dpr' || field === 'visualViewportScale' ||
    field === 'language' || field === 'direction'
}

export function environmentFailure(report: BrowserEnvironmentReport, mode: MeasurementMode): string | null {
  for (const snapshot of [report.start, report.end]) {
    if (!Number.isFinite(snapshot.dpr) || snapshot.dpr <= 0) return 'Device pixel ratio is unavailable.'
    if (snapshot.visualViewportScale !== null && (!Number.isFinite(snapshot.visualViewportScale) || snapshot.visualViewportScale <= 0)) {
      return 'Visual viewport scale is unavailable.'
    }
    if (mode === 'benchmark' && (snapshot.visibility !== 'visible' || !snapshot.focused)) {
      return 'Benchmark requires a visible, focused page.'
    }
  }
  for (const change of report.changes) {
    if (invalidatingField(change.field, mode)) return `Measurement environment changed: ${change.field}.`
  }
  for (const field of fields) {
    if (report.start[field] !== report.end[field] && invalidatingField(field, mode)) {
      return `Measurement environment changed: ${field}.`
    }
  }
  return null
}

export function captureBrowserEnvironment(): BrowserEnvironmentSnapshot {
  return {
    dpr: window.devicePixelRatio, visualViewportScale: window.visualViewport?.scale ?? null,
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    outerWidth: window.outerWidth, outerHeight: window.outerHeight,
    screenX: window.screenX, screenY: window.screenY,
    screenWidth: window.screen.width, screenHeight: window.screen.height,
    screenAvailWidth: window.screen.availWidth, screenAvailHeight: window.screen.availHeight,
    visibility: document.visibilityState, focused: document.hasFocus(),
    language: document.documentElement.lang, direction: document.documentElement.dir,
  }
}

export function createBrowserEnvironmentGuard(mode: MeasurementMode) {
  const start = captureBrowserEnvironment()
  const userAgent = navigator.userAgent
  const changes: EnvironmentChange[] = []
  function record(field: EnvironmentField, value: EnvironmentChange['value'], evidence: EnvironmentChange['evidence']): void {
    if (!changes.some(change => change.field === field)) changes.push({ field, value, evidence })
  }
  function sample(): BrowserEnvironmentSnapshot {
    const current = captureBrowserEnvironment()
    for (const field of fields) {
      if (current[field] !== start[field]) record(field, current[field], 'snapshot')
    }
    return current
  }
  function report(): BrowserEnvironmentReport {
    const end = sample()
    return { userAgent, start, end, changes: [...changes] }
  }
  function assertStable(): void {
    const failure = environmentFailure(report(), mode)
    if (failure !== null) throw new Error(failure)
  }
  const resolution = window.matchMedia(`(resolution: ${start.dpr}dppx)`)
  const onResolution = (): void => {
    // This query stays fixed at the initial DPR. Even a change back to a match
    // proves an intervening mismatch when the earlier event was coalesced.
    record('dpr', window.devicePixelRatio, 'resolution-query')
    sample()
  }
  const onChange = (): void => { sample() }
  const onBlur = (): void => {
    record('focused', false, 'snapshot')
    sample()
  }
  window.addEventListener('resize', onChange)
  window.addEventListener('focus', onChange)
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', onChange)
  window.visualViewport?.addEventListener('resize', onChange)
  resolution.addEventListener('change', onResolution)
  return {
    assertStable,
    report,
    dispose(): void {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('focus', onChange)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onChange)
      window.visualViewport?.removeEventListener('resize', onChange)
      resolution.removeEventListener('change', onResolution)
    },
  }
}
