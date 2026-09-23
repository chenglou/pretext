// Audit knockout W-no-S3 (research/REQUIREMENTS-AUDIT.md): the count predictor with the switch on.
import { paint, predict } from '../count-predictor.ts'
;(globalThis as { __auditKO?: Record<string, boolean> }).__auditKO = { 'W-no-S3': true }
export { paint, predict }
