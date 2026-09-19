// The Latin-1 pair table Blink and WebKit both generate, in the form the two share (tools/gen-shared.ts parsePairBitmap):
// a row of 28 bytes per character before the position and a bit per character after it, both in U+0021..U+00FF. Each
// engine decodes its own table (engines/blink/data.ts, engines/webkit/data.ts).
export function pairCanBreak(pairs: Uint8Array, before: number, after: number): boolean {
  const x = after - 0x21
  return (pairs[(before - 0x21) * 28 + (x >> 3)]! & (1 << (x & 7))) !== 0
}
