// Audit knockouts together (research/REQUIREMENTS-AUDIT.md): the count predictor with these switches on.
import { paint, predict } from '../count-predictor.ts'
;(globalThis as { __auditKO?: Record<string, boolean> }).__auditKO = { 'W-no-W1a': true, 'W-no-W1b': true, 'W-no-S3': true, 'S-no-S1': true, }
export { paint, predict }
