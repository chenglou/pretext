// Seeded pseudo-random numbers for reproducible case generation: sfc32 seeded from a string hash.
// Every generator family derives its own stream from the run seed and the family name, so adding or
// changing one family never shifts another family's output.

export type Rng = {
  // Uniform in [0, 1).
  next(): number
  // Uniform integer in [0, n).
  int(n: number): number
  pick<T>(items: readonly T[]): T
  chance(probability: number): boolean
  // `count` distinct items (all of them when there are fewer), in random order.
  sample<T>(items: readonly T[], count: number): T[]
}

function xmur3(text: string): () => number {
  let h = 1779033703 ^ text.length
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

// A 32-bit string hash, used to order items reproducibly (for example when sampling).
export function hash32(text: string): number {
  return xmur3(text)()
}

export function createRng(seed: string): Rng {
  const hash = xmur3(seed)
  let a = hash()
  let b = hash()
  let c = hash()
  let d = hash()
  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
  for (let i = 0; i < 15; i++) next()
  const int = (n: number): number => {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`Rng.int needs a positive integer, got ${n}`)
    return Math.floor(next() * n)
  }
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('Rng.pick from an empty list')
      return items[int(items.length)]!
    },
    chance(probability: number): boolean {
      return next() < probability
    },
    sample<T>(items: readonly T[], count: number): T[] {
      const copy = items.slice()
      const n = Math.min(count, copy.length)
      for (let i = 0; i < n; i++) {
        const j = i + int(copy.length - i)
        const swap = copy[i]!
        copy[i] = copy[j]!
        copy[j] = swap
      }
      return copy.slice(0, n)
    },
  }
}
