// Cores for child processes when several checks run at once (gates.ts). Every check that replays shards starts a child
// process per group, --jobs at a time. Run alone, that is the only limit and nothing here does anything. Under gates.ts
// every check starts at once with --jobs at the number of cores, and asks for a core before it starts a child, over the
// Unix socket gates.ts names in PRETEXT_GATES_CORES: it says who asks, waits for the line that grants the core, and says
// so when the child has ended. gates.ts grants in the order of its table, so the first rows' results come first and a
// check's last groups run beside the next check's first; a quarter of the cores go to groups of long paragraphs first,
// whichever check asks, since the longest groups bound the wall time.
//
// A check has one connection, and its requests share it, each under a number: `<n> long|short <holder>` asks,
// `<n> done` gives the core back, and gates.ts answers `<n>` when it grants. gates.ts gives back every core of a
// connection that closes, so a check that dies gives its cores back by dying.
//
// Why one connection: macOS keeps at most 128 connections that a listener hasn't accepted yet (kern.ipc.somaxconn) and
// refuses the next at once (ECONNREFUSED; listen(2) says so). With a connection a request, as it was at first, a full
// run's 31 such checks ask for 16 cores each as they start, 496 connections, while gates.ts is still starting gates
// and accepts none: at a load average of 60 two checks died 0.2 s into a run on 2026-09-19 (exit 2). With that start
// and a listener that accepts nothing until every check runs, 24 of 31 checks failed to connect, and 15 of 31 with a
// listener that does nothing else, at a load average of 57. A connection a check is 31 at once whatever the load and
// --jobs, and none fails (cores.test.ts).
import type { Socket } from 'bun'

const SOCKET = process.env['PRETEXT_GATES_CORES']
// The place of this check in gates.ts's table.
const HOLDER = process.env['PRETEXT_GATES_HOLDER']

// The requests that wait for their core, each under its number: --jobs at most. A check writes two short lines a
// request, far under a socket's buffer, so no write is ever short.
type Ask = { n: number; granted: () => void; failed: (error: Error) => void }
const asks: Ask[] = []
let lastAsk = 0
// The requests that wait for a core or hold one. The connection keeps the process alive only while there is one, so a
// check whose work is done ends without closing anything.
let open = 0
let connection: Promise<Socket> | null = null

function connect(path: string): Promise<Socket> {
  let partial = ''
  return new Promise<Socket>((resolve, reject) => {
    Bun.connect({
      unix: path,
      socket: {
        open(socket) { resolve(socket) },
        // Lines can come several to a chunk, and a chunk can end inside one.
        data(_socket, bytes) {
          const lines = (partial + bytes.toString()).split('\n')
          partial = lines.pop()!
          for (let i = 0; i < lines.length; i++) asks.splice(asks.findIndex(ask => ask.n === Number(lines[i]!)), 1)[0]!.granted()
        },
        close() {
          for (let i = 0; i < asks.length; i++) asks[i]!.failed(new Error('gates.ts closed the cores socket before it granted a core'))
          asks.length = 0
        },
      },
    }).catch(reject)
  })
}

export async function withCore<T>(long: boolean, work: () => Promise<T>): Promise<T> {
  if (SOCKET === undefined) return await work()
  connection ??= connect(SOCKET)
  const socket = await connection
  const n = ++lastAsk
  if (open++ === 0) socket.ref()
  try {
    await new Promise<void>((granted, failed) => {
      asks.push({ n, granted, failed })
      socket.write(`${n} ${long ? 'long' : 'short'} ${HOLDER}\n`)
    })
    return await work()
  } finally {
    socket.write(`${n} done\n`)
    if (--open === 0) socket.unref()
  }
}
