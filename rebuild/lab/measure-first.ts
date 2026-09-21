// run.ts records contiguous document populations; page.ts records each row's prediction position in that document.
// Fresh application checks validate these together. Single-row native-first scoring does not use this protocol.
export type MeasureFirstDocument = { firstRow: number; rows: number }

export function measureFirstDocuments(value: unknown, rows: number): readonly MeasureFirstDocument[] {
  if (!Number.isSafeInteger(rows) || rows < 1 || value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('measure-first document population unavailable')
  const documents = (value as { documents?: unknown }).documents
  if (!Array.isArray(documents)) throw new Error('measure-first document population unavailable')
  let covered = 0
  for (const document of documents) {
    if (document === null || typeof document !== 'object' || Array.isArray(document) || document.firstRow !== covered
      || !Number.isSafeInteger(document.rows) || document.rows < 1 || document.rows > rows - covered) throw new Error('measure-first document population incomplete')
    covered += document.rows
  }
  if (covered !== rows) throw new Error('measure-first document population incomplete')
  return documents as MeasureFirstDocument[]
}

export function measureFirstRowProblem(value: unknown, row: number, documents: readonly MeasureFirstDocument[]): string | null {
  // Raw row order is the observation order, including reverse jobs and each document's reset to predictionIndex 0.
  let low = 0, high = documents.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (documents[middle]!.firstRow <= row) low = middle + 1
    else high = middle
  }
  const document = documents[low - 1]
  if (document === undefined || row >= document.firstRow + document.rows) return `measure-first row ${row} is outside the document population`
  const index = row - document.firstRow
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (value as { predictionIndex?: unknown }).predictionIndex !== index
    || (value as { documentPredictions?: unknown }).documentPredictions !== document.rows) return `measure-first row ${row} must record predictionIndex ${index} and documentPredictions ${document.rows}`
  return null
}
