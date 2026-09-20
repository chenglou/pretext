// The library with Gecko's word scan checked (tools/word-scan-variants.ts): every scan the word scan decides is decided by
// the engine's loop too, and a difference throws, which a check reports as the case's failure.
//   bun rebuild/tests/function-set.ts plain|sweep --browser=firefox --library=rebuild/tools/word-scan-checked-library.ts
import { wordScanLibrary } from './word-scan-variants.ts'

const library = await wordScanLibrary('checked')
export const prepare = library.prepare
export const firstLine = library.firstLine
export const fillLine = library.fillLine
export const linePieces = library.linePieces
export const inspectLine = library.inspectLine
