// The library with Gecko's word scan off (tools/word-scan-variants.ts): every plain scan is the engine's loop, which is
// the library before the word scan. For the questions a check counts without it.
//   bun rebuild/tests/function-set.ts plain --browser=firefox --library=rebuild/tools/word-scan-loop-library.ts
import { wordScanLibrary } from './word-scan-variants.ts'

const library = await wordScanLibrary('loop')
export const prepare = library.prepare
export const firstLine = library.firstLine
export const fillLine = library.fillLine
export const linePieces = library.linePieces
export const inspectLine = library.inspectLine
