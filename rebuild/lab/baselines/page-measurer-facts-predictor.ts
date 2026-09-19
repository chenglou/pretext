// Page measurer with the lab's font facts: predictor.ts with one measurer for every case a document lays out
// (page-measurer-predictor.ts has what that means and how its rows are compared; this one runs under --config=facts).
import { fontFactsFor } from '../font-facts.ts'
import { makePredictor } from '../predictor-core.ts'

export const { predict, paint, limits } = makePredictor(fontFactsFor, [], true)
