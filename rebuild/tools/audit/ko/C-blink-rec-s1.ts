// Audit knockouts together (research/REQUIREMENTS-AUDIT.md): the count predictor with these switches on.
import { paint, predict } from '../count-predictor.ts'
;(globalThis as { __auditKO?: Record<string, boolean> }).__auditKO = { 'B-cut-words': true, 'B-cut-pair-only': true, 'B-B3-pair-only': true, 'S-no-S1': true, 'B-no-floatsum': true, }
export { paint, predict }
