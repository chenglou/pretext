// Streams a text file line by line with bounded memory. Generators and tests use it for the big Unicode and
// oracle files (BidiCharacterTest.txt is 6.9 MB, ppucd.txt 2.9 MB).

export async function forEachLine(path: string, visit: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of Bun.file(path).stream()) {
    pending += decoder.decode(chunk, { stream: true })
    let start = 0
    for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n', start)) {
      visit(pending.slice(start, newline))
      start = newline + 1
    }
    pending = pending.slice(start)
  }
  pending += decoder.decode()
  if (pending.length > 0) visit(pending)
}
