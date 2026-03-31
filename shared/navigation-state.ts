export type NavigationPhase = 'loading' | 'measuring' | 'posting'

type NavigationPhaseState = {
  phase: NavigationPhase
  requestId?: string
}

function getHashParams(urlOrHash: string): URLSearchParams {
  const hashStart = urlOrHash.indexOf('#')
  const hash = hashStart === -1 ? urlOrHash : urlOrHash.slice(hashStart + 1)
  return new URLSearchParams(hash)
}

export function buildNavigationPhaseHash(phase: NavigationPhase, requestId?: string): string {
  const params = new URLSearchParams()
  params.set('phase', phase)
  if (requestId !== undefined) {
    params.set('requestId', requestId)
  }
  return `#${params.toString()}`
}

export function buildNavigationReportHash(report: unknown): string {
  const params = new URLSearchParams()
  params.set('report', JSON.stringify(report))
  return `#${params.toString()}`
}

export function readNavigationReportText(urlOrHash: string): string {
  return getHashParams(urlOrHash).get('report') ?? ''
}

export function readNavigationPhaseState(urlOrHash: string): NavigationPhaseState | null {
  const params = getHashParams(urlOrHash)
  const phase = params.get('phase')
  if (phase !== 'loading' && phase !== 'measuring' && phase !== 'posting') {
    return null
  }

  const requestId = params.get('requestId') ?? undefined
  return requestId === undefined ? { phase } : { phase, requestId }
}
