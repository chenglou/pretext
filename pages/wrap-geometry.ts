export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type Interval = {
  left: number
  right: number
}

export type Point = {
  x: number
  y: number
}

export type WrapHullMode = 'mean' | 'envelope'

export type WrapHullOptions = {
  smoothRadius: number
  mode: WrapHullMode
  convexify?: boolean
}

const wrapHullByKey = new Map<string, Promise<Point[]>>()

export function getWrapHull(src: string, options: WrapHullOptions): Promise<Point[]> {
  const key = `${src}::${options.mode}::${options.smoothRadius}::${options.convexify ? 'convex' : 'raw'}`
  const cached = wrapHullByKey.get(key)
  if (cached !== undefined) return cached
  const promise = makeWrapHull(src, options)
  wrapHullByKey.set(key, promise)
  return promise
}

export function transformWrapPoints(points: Point[], rect: Rect, angle: number): Point[] {
  if (angle === 0) {
    return points.map(point => ({
        x: rect.x + point.x * rect.width,
        y: rect.y + point.y * rect.height,
    }))
  }

  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  return points.map(point => {
    const localX = (point.x - 0.5) * rect.width
    const localY = (point.y - 0.5) * rect.height
    return {
      x: centerX + localX * cos - localY * sin,
      y: centerY + localX * sin + localY * cos,
    }
  })
}

export function isPointInPolygon(points: Point[], x: number, y: number): boolean {
  let inside = false
  for (let index = 0, prev = points.length - 1; index < points.length; prev = index++) {
    const a = points[index]!
    const b = points[prev]!
    const intersects =
      ((a.y > y) !== (b.y > y)) &&
      (x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)
    if (intersects) inside = !inside
  }
  return inside
}

export function getPolygonIntervalForBand(
  points: Point[],
  bandTop: number,
  bandBottom: number,
  horizontalPadding: number,
  verticalPadding: number,
): Interval | null {
  const sampleTop = bandTop - verticalPadding
  const sampleBottom = bandBottom + verticalPadding
  const startY = Math.floor(sampleTop)
  const endY = Math.ceil(sampleBottom)

  let left = Infinity
  let right = -Infinity

  for (let y = startY; y <= endY; y++) {
    const xs = getPolygonXsAtY(points, y + 0.5)
    for (let index = 0; index + 1 < xs.length; index += 2) {
      const runLeft = xs[index]!
      const runRight = xs[index + 1]!
      if (runLeft < left) left = runLeft
      if (runRight > right) right = runRight
    }
  }

  if (!Number.isFinite(left) || !Number.isFinite(right)) return null
  return { left: left - horizontalPadding, right: right + horizontalPadding }
}

export function getRectIntervalsForBand(
  rects: Rect[],
  bandTop: number,
  bandBottom: number,
  horizontalPadding: number,
  verticalPadding: number,
): Interval[] {
  const intervals: Interval[] = []
  for (let index = 0; index < rects.length; index++) {
    const rect = rects[index]!
    if (bandBottom <= rect.y - verticalPadding || bandTop >= rect.y + rect.height + verticalPadding) continue
    intervals.push({
      left: rect.x - horizontalPadding,
      right: rect.x + rect.width + horizontalPadding,
    })
  }
  return intervals
}

// Given one allowed horizontal interval and a set of blocked intervals,
// carve out the remaining usable text slots for one text line band.
//
// Example:
// - base:    80..420
// - blocked: 200..310
// - result:  80..200, 310..420
//
// On the dynamic-layout page, the base interval is one full column row,
// the blocked intervals come from the title/logo shapes at that band,
// and the returned intervals are the candidate text slots for that row.
//
// This helper is intentionally page-oriented, not pure geometry:
// it also discards absurdly narrow leftover slivers that we would never
// want to hand to text layout.
export function carveTextLineSlots(base: Interval, blocked: Interval[]): Interval[] {
  let slots: Interval[] = [base]

  for (let blockedIndex = 0; blockedIndex < blocked.length; blockedIndex++) {
    const interval = blocked[blockedIndex]!
    const next: Interval[] = []
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex]!
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left })
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right })
    }
    slots = next
  }

  return slots.filter(slot => slot.right - slot.left >= 24)
}

async function makeWrapHull(src: string, options: WrapHullOptions): Promise<Point[]> {
  const image = new Image()
  image.src = src
  await image.decode()

  const maxDimension = 320
  const aspect = image.naturalWidth / image.naturalHeight
  const width = aspect >= 1
    ? maxDimension
    : Math.max(64, Math.round(maxDimension * aspect))
  const height = aspect >= 1
    ? Math.max(64, Math.round(maxDimension / aspect))
    : maxDimension

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('2d context unavailable')

  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)

  const { data } = ctx.getImageData(0, 0, width, height)
  const lefts: Array<number | null> = new Array(height).fill(null)
  const rights: Array<number | null> = new Array(height).fill(null)
  const alphaThreshold = 12

  for (let y = 0; y < height; y++) {
    let left = -1
    let right = -1
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]!
      if (alpha < alphaThreshold) continue
      if (left === -1) left = x
      right = x
    }
    if (left !== -1 && right !== -1) {
      lefts[y] = left
      rights[y] = right + 1
    }
  }

  const validRows: number[] = []
  for (let y = 0; y < height; y++) {
    if (lefts[y] !== null && rights[y] !== null) validRows.push(y)
  }
  if (validRows.length === 0) throw new Error(`No opaque pixels found in ${src}`)

  let boundLeft = Infinity
  let boundRight = -Infinity
  const boundTop = validRows[0]!
  const boundBottom = validRows[validRows.length - 1]!
  for (let index = 0; index < validRows.length; index++) {
    const y = validRows[index]!
    const left = lefts[y]!
    const right = rights[y]!
    if (left < boundLeft) boundLeft = left
    if (right > boundRight) boundRight = right
  }
  const boundWidth = Math.max(1, boundRight - boundLeft)
  const boundHeight = Math.max(1, boundBottom - boundTop)

  const smoothedLefts: number[] = new Array(height).fill(0)
  const smoothedRights: number[] = new Array(height).fill(0)

  for (let index = 0; index < validRows.length; index++) {
    const y = validRows[index]!
    let leftSum = 0
    let rightSum = 0
    let count = 0
    let leftEdge = Infinity
    let rightEdge = -Infinity
    for (let offset = -options.smoothRadius; offset <= options.smoothRadius; offset++) {
      const sampleIndex = y + offset
      if (sampleIndex < 0 || sampleIndex >= height) continue
      const left = lefts[sampleIndex]
      const right = rights[sampleIndex]
      if (left == null || right == null) continue
      leftSum += left
      rightSum += right
      if (left < leftEdge) leftEdge = left
      if (right > rightEdge) rightEdge = right
      count++
    }

    if (count === 0) {
      smoothedLefts[y] = 0
      smoothedRights[y] = width
      continue
    }

    switch (options.mode) {
      case 'envelope':
        smoothedLefts[y] = leftEdge
        smoothedRights[y] = rightEdge
        break
      case 'mean':
        smoothedLefts[y] = leftSum / count
        smoothedRights[y] = rightSum / count
        break
    }
  }

  const step = Math.max(1, Math.floor(validRows.length / 52))
  const sampledRows: number[] = []
  for (let index = 0; index < validRows.length; index += step) sampledRows.push(validRows[index]!)
  const lastRow = validRows[validRows.length - 1]!
  if (sampledRows[sampledRows.length - 1] !== lastRow) sampledRows.push(lastRow)

  const points: Point[] = []
  for (let index = 0; index < sampledRows.length; index++) {
    const y = sampledRows[index]!
    points.push({
      x: (smoothedLefts[y]! - boundLeft) / boundWidth,
      y: ((y + 0.5) - boundTop) / boundHeight,
    })
  }
  for (let index = sampledRows.length - 1; index >= 0; index--) {
    const y = sampledRows[index]!
    points.push({
      x: (smoothedRights[y]! - boundLeft) / boundWidth,
      y: ((y + 0.5) - boundTop) / boundHeight,
    })
  }

  if (!options.convexify) return points
  return makeConvexHull(points)
}

function getPolygonXsAtY(points: Point[], y: number): number[] {
  const xs: number[] = []

  for (let index = 0; index < points.length; index++) {
    const start = points[index]!
    const end = points[(index + 1) % points.length]!
    if (start.y === end.y) continue

    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    if (y < minY || y >= maxY) continue

    const t = (y - start.y) / (end.y - start.y)
    xs.push(start.x + (end.x - start.x) * t)
  }

  return xs.sort((a, b) => a - b)
}

function cross(origin: Point, a: Point, b: Point): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
}

function makeConvexHull(points: Point[]): Point[] {
  if (points.length <= 3) return points
  const sorted = [...points].sort((a, b) => (a.x - b.x) || (a.y - b.y))
  const lower: Point[] = []
  for (let index = 0; index < sorted.length; index++) {
    const point = sorted[index]!
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }
  const upper: Point[] = []
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}
