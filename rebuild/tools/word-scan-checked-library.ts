// The library with Gecko's word scan checked (src/engines/gecko/lines.ts wordScanState): every scan the word scan decides
// is decided by the engine's loop too, and a difference throws. For the function set's checks:
// bun rebuild/tests/function-set.ts plain --browser=firefox --library=rebuild/tools/word-scan-checked-library.ts
import { wordScanState } from '../src/engines/gecko/lines.ts'

wordScanState.checked = true
export * from '../src/index.ts'
