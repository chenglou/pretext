// The prediction hook. page.ts imports this file and nothing else from the library side, so the rebuilt library plugs in
// through predictor-core.ts only (run.ts --predictor=<file> swaps this file for experiments).
//
// This predictor declares the lab's font facts, the way an app that knows its fonts would: font-facts.ts gives the facts
// each engine reads for a declaration on this Mac, from a table generated offline from the installed fonts and the fixtures
// the case loads (DESIGN.md §1.2). baselines/no-facts-predictor.ts is the same predictor with no supplied facts.
import { fontFactsFor } from './font-facts.ts'
import { makePredictor } from './predictor-core.ts'

export const { predict, paint, limits } = makePredictor(fontFactsFor)
