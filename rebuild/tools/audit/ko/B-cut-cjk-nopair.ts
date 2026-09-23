// Audit knockout B-cut-cjk-nopair (research/REQUIREMENTS-AUDIT.md): the count predictor with the switch on.
import { paint, predict } from '../count-predictor.ts'
;(globalThis as { __auditKO?: Record<string, boolean> }).__auditKO = { 'B-cut-cjk-nopair': true }
export { paint, predict }
