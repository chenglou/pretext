// Audit knockouts together (research/REQUIREMENTS-AUDIT.md): the count predictor with these switches on.
import { paint, predict } from '../count-predictor.ts'
;(globalThis as { __auditKO?: Record<string, boolean> }).__auditKO = { 'B-cut-words-nopair': true, 'B-no-B3': true, 'B-no-B4': true, 'B-no-B12': true, 'B-no-S5': true, 'S-no-S1': true, }
export { paint, predict }
