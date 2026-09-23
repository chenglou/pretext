// Audit knockout G-no-G9 (research/REQUIREMENTS-AUDIT.md): the count predictor with the switch on.
import { paint, predict } from '../count-predictor.ts'
;(globalThis as { __auditKO?: Record<string, boolean> }).__auditKO = { 'G-no-G9': true }
export { paint, predict }
