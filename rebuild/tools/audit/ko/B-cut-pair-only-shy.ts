// Audit knockout B-cut-pair-only-shy (research/REQUIREMENTS-AUDIT.md): the count predictor with the switch on.
import { paint, predict } from '../count-predictor.ts'
;(globalThis as { __auditKO?: Record<string, boolean> }).__auditKO = { 'B-cut-pair-only-shy': true }
export { paint, predict }
