import {
  clearCache,
  layout,
  layoutNextLine,
  layoutWithLines,
  prepare,
  prepareWithSegments,
  profilePrepare,
  setLocale,
  walkLineRanges,
  type LayoutCursor,
  type LayoutLine,
  type LayoutLineRange,
  type LayoutLinesResult,
  type LayoutResult,
  type PrepareOptions,
  type PrepareProfile,
  type PreparedText,
  type PreparedTextWithSegments,
} from './layout.js'
import { withMeasurementHost, type MeasurementHost } from './measurement.js'

export type PretextHostConfig = {
  measurement: MeasurementHost
}

export type PretextHostApi = {
  profilePrepare(text: string, font: string, options?: PrepareOptions): PrepareProfile
  prepare(text: string, font: string, options?: PrepareOptions): PreparedText
  prepareWithSegments(text: string, font: string, options?: PrepareOptions): PreparedTextWithSegments
  layout(prepared: PreparedText, maxWidth: number, lineHeight: number): LayoutResult
  walkLineRanges(
    prepared: PreparedTextWithSegments,
    maxWidth: number,
    onLine?: (line: LayoutLineRange) => void,
  ): number
  layoutNextLine(
    prepared: PreparedTextWithSegments,
    start: LayoutCursor,
    maxWidth: number,
  ): LayoutLine | null
  layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): LayoutLinesResult
  clearCache(): void
  setLocale(locale?: string): void
}

export { type MeasurementHost } from './measurement.js'

export function createPretext(config: PretextHostConfig): PretextHostApi {
  const bind = <Args extends unknown[], Result>(
    fn: (...args: Args) => Result,
  ): ((...args: Args) => Result) => {
    return (...args: Args) => withMeasurementHost(config.measurement, () => fn(...args))
  }

  return {
    profilePrepare: bind(profilePrepare),
    prepare: bind(prepare),
    prepareWithSegments: bind(prepareWithSegments),
    layout: bind(layout),
    walkLineRanges: bind(walkLineRanges),
    layoutNextLine: bind(layoutNextLine),
    layoutWithLines: bind(layoutWithLines),
    clearCache: bind(clearCache),
    setLocale,
  }
}
