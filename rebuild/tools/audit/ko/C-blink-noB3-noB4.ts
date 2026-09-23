// Audit knockouts together (research/REQUIREMENTS-AUDIT.md): the count predictor with these switches on.
import { paint, predict } from '../count-predictor.ts'
;(globalThis as { __auditKO?: Record<string, boolean> }).__auditKO = { 'B-no-B3': true, 'B-no-B4': true, }
export { paint, predict }
