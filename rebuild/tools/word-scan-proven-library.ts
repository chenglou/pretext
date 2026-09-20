// The library with Gecko's word scan in mode 'proven' (src/engines/gecko/lines.ts wordScanState), for the function set's
// checks: bun rebuild/tests/function-set.ts plain --browser=firefox --library=rebuild/tools/word-scan-proven-library.ts
import { wordScanState } from '../src/engines/gecko/lines.ts'

wordScanState.mode = 'proven'
export * from '../src/index.ts'
