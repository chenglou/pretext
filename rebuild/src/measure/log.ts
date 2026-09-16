// What a layout measured: every Canvas context it used and every measureText call it made, in order. calls.length is
// the measureText call count the lab records; memoHits counts lookups the per-layout memo answered (measure/canvas.ts).
import type { CanvasSettings } from './canvas.js'

export type MeasureCall = { context: number; text: string; width: number }

export type MeasureLog = {
  contexts: CanvasSettings[]
  calls: MeasureCall[]
  memoHits: number
}
