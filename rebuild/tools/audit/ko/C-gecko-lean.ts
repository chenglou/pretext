// Audit knockouts together (research/REQUIREMENTS-AUDIT.md): the count predictor with these switches on.
import { paint, predict } from '../count-predictor.ts'
;(globalThis as { __auditKO?: Record<string, boolean> }).__auditKO = { 'G-no-G1b': true, 'G-no-G2': true, 'G-no-G3': true, 'G-no-G4': true, 'G-no-G9': true, }
export { paint, predict }
