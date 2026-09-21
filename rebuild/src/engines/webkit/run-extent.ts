// LineBuilder's geometric extent while appending: only the last run can expand. This fill-local owner is discarded
// before output. Final trimming/alignment can mutate earlier runs after the last query; rebuilds reset the owner to null.
import type { LineRun } from './types.js'

type RunExtent = { rightMostBeforeLastRun: number | null }

export function appendLineRun(extent: RunExtent, runs: LineRun[], run: LineRun): void {
  if (extent.rightMostBeforeLastRun !== null) {
    const last = runs[runs.length - 1]
    extent.rightMostBeforeLastRun = Math.max(extent.rightMostBeforeLastRun, last === undefined ? 0 : Math.fround(last.left + last.width))
  }
  runs.push(run)
}

export function rightMostRun(extent: RunExtent, runs: readonly LineRun[]): number {
  if (extent.rightMostBeforeLastRun === null) {
    let right = 0
    for (let i = 0; i + 1 < runs.length; i++) right = Math.max(right, Math.fround(runs[i]!.left + runs[i]!.width))
    extent.rightMostBeforeLastRun = right
  }
  const last = runs[runs.length - 1]
  return Math.max(extent.rightMostBeforeLastRun, last === undefined ? 0 : Math.fround(last.left + last.width))
}
