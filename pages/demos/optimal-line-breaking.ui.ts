type Ctx = CanvasRenderingContext2D

export function renderFrame(
  ctx: Ctx,
  lines: import('./optimal-line-breaking.model.ts').MeasuredLine[],
  normalSpaceWidth: number,
  y: number,
  lineHeight: number,
  showBadness: boolean,
  showFitness: boolean
): number {
  ctx.font = '15px/1.6 Georgia, "Times New Roman", serif'
  ctx.fillStyle = '#2a2520'
  ctx.textBaseline = 'alphabetic'

  let maxWidth = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const isLastLine = line.ending === 'paragraph-end'

    let x = 0
    const spaceStretch = line.spaceCount > 0
      ? (line.justifiedSpace - normalSpaceWidth) / normalSpaceWidth
      : 0

    for (let j = 0; j < line.segments.length; j++) {
      const seg = line.segments[j]!
      if (seg.kind === 'text') {
        ctx.fillText(seg.text, x, y)
        x += seg.width
      } else {
        let spaceWidth = normalSpaceWidth
        if (isLastLine) {
          if (line.spaceCount < 2) {
            spaceWidth = 0
          }
        } else if (spaceStretch !== 0) {
          spaceWidth = line.justifiedSpace
        }
        x += spaceWidth
      }
    }

    const lineWidth = x

    if (showBadness && line.badness > 0 && !isLastLine) {
      const intensity = Math.min(1, line.badness / 10000)
      ctx.fillStyle = `rgba(220, ${Math.round(80 - intensity * 80)}, ${Math.round(80 - intensity * 60)}, 0.4)`
      ctx.fillRect(0, y + 2, lineWidth, 3)
    }

    if (showFitness && !isLastLine) {
      const fitnessColors: Record<string, string> = {
        tight: 'rgba(180, 60, 60, 0.5)',
        decent: 'rgba(60, 180, 100, 0.5)',
        loose: 'rgba(200, 160, 60, 0.5)',
        'very-loose': 'rgba(200, 80, 60, 0.5)'
      }
      ctx.fillStyle = fitnessColors[line.fitness] || 'transparent'
      ctx.fillRect(0, y + lineHeight - 4, lineWidth, 3)
    }

    maxWidth = Math.max(maxWidth, lineWidth)
    y += lineHeight
  }

  return y
}

export function renderMetrics(
  ctx: Ctx,
  lines: import('./optimal-line-breaking.model.ts').MeasuredLine[],
  normalSpaceWidth: number,
  x: number,
  y: number
): void {
  ctx.font = '11px/1.5 "Helvetica Neue", Helvetica, Arial, sans-serif'
  ctx.fillStyle = '#6a6055'
  ctx.textBaseline = 'top'

  let totalBadness = 0
  let tightCount = 0
  let decentCount = 0
  let looseCount = 0
  let veryLooseCount = 0
  let riverCount = 0

  for (const line of lines) {
    if (line.ending === 'paragraph-end') continue
    totalBadness += line.badness

    if (line.fitness === 'tight') tightCount++
    else if (line.fitness === 'decent') decentCount++
    else if (line.fitness === 'loose') looseCount++
    else if (line.fitness === 'very-loose') veryLooseCount++

    if (line.justifiedSpace / normalSpaceWidth > 1.5) riverCount++
  }

  const metrics = [
    { label: 'Lines', value: lines.length.toString() },
    { label: 'Total badness', value: Math.round(totalBadness).toLocaleString() },
    { label: 'Avg badness', value: (totalBadness / lines.length).toFixed(1) },
    { label: 'Tight lines', value: tightCount.toString(), color: '#b44' },
    { label: 'Decent lines', value: decentCount.toString(), color: '#2a8a4a' },
    { label: 'Loose lines', value: looseCount.toString(), color: '#b87020' },
    { label: 'Very loose', value: veryLooseCount.toString(), color: '#c44' },
    { label: 'Rivers', value: riverCount.toString(), color: riverCount > 0 ? '#c44' : undefined },
  ]

  for (const metric of metrics) {
    ctx.fillStyle = '#8a7f70'
    ctx.fillText(metric.label + ':', x, y)
    ctx.fillStyle = metric.color || '#5a4f40'
    ctx.font = '600 11px/1.5 "Helvetica Neue", Helvetica, Arial, sans-serif'
    ctx.fillText(metric.value, x + 90, y)
    ctx.font = '11px/1.5 "Helvetica Neue", Helvetica, Arial, sans-serif'
    ctx.fillStyle = '#6a6055'
    y += 16
  }
}

export function createCtx(canvas: HTMLCanvasElement): Ctx {
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('2D canvas context required')
  return ctx
}
