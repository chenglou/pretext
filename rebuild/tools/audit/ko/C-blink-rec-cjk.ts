// Audit knockouts together (research/REQUIREMENTS-AUDIT.md): the count predictor with these switches on.
import { paint, predict } from '../count-predictor.ts'
;(globalThis as { __auditKO?: Record<string, boolean> }).__auditKO = { 'B-cut-cjk': true, 'B-cut-pair-only': true, 'B-B3-pair-only': true, }
export { paint, predict }
