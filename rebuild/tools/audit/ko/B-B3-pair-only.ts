// Audit knockout B-B3-pair-only (research/REQUIREMENTS-AUDIT.md): the count predictor with the switch on.
import { paint, predict } from '../count-predictor.ts'
;(globalThis as { __auditKO?: Record<string, boolean> }).__auditKO = { 'B-B3-pair-only': true }
export { paint, predict }
