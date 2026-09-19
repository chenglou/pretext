// Cores for child processes when several checks run at once (gates.ts). Every check that replays shards starts a child
// process per group, --jobs at a time. Run alone, that is the only limit and nothing here does anything. Under gates.ts
// every check starts at once with --jobs at the number of cores, and asks for a core before it starts a child: it
// connects to the Unix socket gates.ts names in PRETEXT_GATES_CORES, says who asks, waits for the one byte that grants
// the core, and closes the connection when the child has ended. A connection is a core, so a check that dies gives its
// cores back by dying. gates.ts grants in the order of its table, so the first rows' results come first and a check's
// last groups run beside the next check's first; a quarter of the cores go to groups of long paragraphs first, whichever
// check asks, since the longest groups bound the wall time.
import type { Socket } from 'bun'

const SOCKET = process.env['PRETEXT_GATES_CORES']
// The place of this check in gates.ts's table.
const HOLDER = process.env['PRETEXT_GATES_HOLDER']

export async function withCore<T>(long: boolean, work: () => Promise<T>): Promise<T> {
  if (SOCKET === undefined) return await work()
  const core = await new Promise<Socket>((resolve, reject) => {
    Bun.connect({
      unix: SOCKET,
      socket: {
        open(socket) { socket.write(`${long ? 'long' : 'short'} ${HOLDER}\n`) },
        data(socket) { resolve(socket) },
        close() { reject(new Error('gates.ts closed the cores socket before it granted a core')) },
      },
    }).catch(reject)
  })
  try {
    return await work()
  } finally {
    core.end()
  }
}
