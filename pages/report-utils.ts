import {
  buildNavigationPhaseHash,
  buildNavigationReportHash,
  type NavigationPhase,
} from '../shared/navigation-state.ts'

function replaceNavigationHash(hash: string): void {
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`)
}

export function clearNavigationReport(): void {
  replaceNavigationHash('')
}

export function publishNavigationPhase(phase: NavigationPhase, requestId?: string): void {
  replaceNavigationHash(buildNavigationPhaseHash(phase, requestId))
}

export function publishNavigationReport(report: unknown): void {
  replaceNavigationHash(buildNavigationReportHash(report))
}
