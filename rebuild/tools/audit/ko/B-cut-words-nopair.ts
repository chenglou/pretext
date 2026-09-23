// Audit knockout B-cut-words-nopair (research/REQUIREMENTS-AUDIT.md): the count predictor with the switch on.
import { paint, predict } from '../count-predictor.ts'
;(globalThis as { __auditKO?: Record<string, boolean> }).__auditKO = { 'B-cut-words-nopair': true }
export { paint, predict }
