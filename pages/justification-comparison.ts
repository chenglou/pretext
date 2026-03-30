import {
  prepareWithSegments, layoutWithLines, layoutNextLine, walkLineRanges,
  type PreparedTextWithSegments, type LayoutCursor, type LayoutLine,
} from '../src/layout.ts'

// ── Text content ────────────────────────────────
// Challenging mix of short and long words for justification stress testing.

const PARAGRAPHS: string[] = [
  `The relationship between typographic colour and reading comfort has been studied extensively since the early twentieth century. When lines of justified text contain excessive inter-word spacing, the eye perceives pale horizontal streaks — "rivers" — that cut vertically through the paragraph, disrupting the smooth lateral scanning motion that skilled readers depend upon. These rivers are not merely an aesthetic blemish; they constitute a measurable impediment to reading speed and comprehension.`,

  `Traditional typesetting systems addressed this problem through a combination of techniques: hyphenation dictionaries that permitted words to break at syllable boundaries, letterspacing adjustments that distributed small amounts of additional space between individual characters, and — most significantly — global optimization algorithms that evaluated thousands of possible line-break combinations to find the arrangement minimizing total spacing deviation across the entire paragraph.`,

  `The Knuth-Plass algorithm, developed by Donald Knuth and Michael Plass for the TeX typesetting system in 1981, remains the gold standard for paragraph optimization. Rather than greedily filling each line from left to right, the algorithm constructs a graph of all feasible breakpoints and finds the shortest path — the combination of breaks that produces the most uniform spacing throughout. Even a simplified implementation produces dramatically better results than the greedy approach used by web browsers and most word processors.`,

  `Modern CSS justification operates on a strictly greedy, line-by-line basis: the browser fills each line with as many words as will fit, then distributes the remaining space uniformly between words. This approach requires no lookahead and executes quickly, but it produces wildly inconsistent spacing — particularly in narrow columns where a single long word can force enormous gaps across the preceding line. The result: rivers of white space that would have horrified any compositor working with metal type.`,
]

const ALL_TEXT = PARAGRAPHS.join('\n\n')

// ── Typography ──────────────────────────────────

const FONT_FAMILY = 'Georgia, "Times New Roman", serif'
const FONT_SIZE = 15
const LINE_HEIGHT = 24
const FONT = `${FONT_SIZE}px ${FONT_FAMILY}`
const PAD = 12
const PARA_GAP = LINE_HEIGHT * 0.6

// ── Canvas helpers ──────────────────────────────

function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = devicePixelRatio || 1
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

// ── Hyphenation ─────────────────────────────────
// Simple English hyphenation using common patterns.

const HYPHEN_EXCEPTIONS: Record<string, string[]> = {
  'extensively': ['ex','ten','sive','ly'],
  'relationship': ['re','la','tion','ship'],
  'typographic': ['ty','po','graph','ic'],
  'comfortable': ['com','fort','a','ble'],
  'horizontal': ['hor','i','zon','tal'],
  'vertically': ['ver','ti','cal','ly'],
  'disrupting': ['dis','rupt','ing'],
  'comprehension': ['com','pre','hen','sion'],
  'traditional': ['tra','di','tion','al'],
  'combination': ['com','bi','na','tion'],
  'techniques': ['tech','niques'],
  'hyphenation': ['hy','phen','a','tion'],
  'dictionaries': ['dic','tion','ar','ies'],
  'permitted': ['per','mit','ted'],
  'syllable': ['syl','la','ble'],
  'boundaries': ['bound','a','ries'],
  'letterspacing': ['let','ter','spac','ing'],
  'adjustments': ['ad','just','ments'],
  'distributed': ['dis','trib','u','ted'],
  'additional': ['ad','di','tion','al'],
  'individual': ['in','di','vid','u','al'],
  'characters': ['char','ac','ters'],
  'significantly': ['sig','nif','i','cant','ly'],
  'optimization': ['op','ti','mi','za','tion'],
  'evaluated': ['e','val','u','at','ed'],
  'thousands': ['thou','sands'],
  'possible': ['pos','si','ble'],
  'arrangement': ['ar','range','ment'],
  'minimizing': ['min','i','miz','ing'],
  'deviation': ['de','vi','a','tion'],
  'paragraph': ['par','a','graph'],
  'algorithm': ['al','go','rithm'],
  'developed': ['de','vel','oped'],
  'typesetting': ['type','set','ting'],
  'constructs': ['con','structs'],
  'feasible': ['fea','si','ble'],
  'breakpoints': ['break','points'],
  'combination': ['com','bi','na','tion'],
  'produces': ['pro','du','ces'],
  'uniform': ['u','ni','form'],
  'throughout': ['through','out'],
  'simplified': ['sim','pli','fied'],
  'implementation': ['im','ple','men','ta','tion'],
  'dramatically': ['dra','mat','i','cal','ly'],
  'processors': ['proc','es','sors'],
  'justification': ['jus','ti','fi','ca','tion'],
  'operates': ['op','er','ates'],
  'strictly': ['strict','ly'],
  'distributes': ['dis','trib','utes'],
  'remaining': ['re','main','ing'],
  'uniformly': ['u','ni','form','ly'],
  'requires': ['re','quires'],
  'lookahead': ['look','a','head'],
  'executes': ['ex','e','cutes'],
  'quickly': ['quick','ly'],
  'inconsistent': ['in','con','sis','tent'],
  'particularly': ['par','tic','u','lar','ly'],
  'enormous': ['e','nor','mous'],
  'preceding': ['pre','ced','ing'],
  'compositor': ['com','pos','i','tor'],
  'twentieth': ['twen','ti','eth'],
  'century': ['cen','tu','ry'],
  'perceived': ['per','ceived'],
  'streaks': ['streaks'],
  'scanning': ['scan','ning'],
  'impediment': ['im','ped','i','ment'],
  'addressed': ['ad','dressed'],
  'combinations': ['com','bi','na','tions'],
  'measuring': ['meas','ur','ing'],
  'measurable': ['meas','ur','a','ble'],
  'reading': ['read','ing'],
  'spacing': ['spac','ing'],
  'between': ['be','tween'],
  'excessive': ['ex','ces','sive'],
  'aesthetic': ['aes','thet','ic'],
  'merely': ['mere','ly'],
  'constitute': ['con','sti','tute'],
  'lateral': ['lat','er','al'],
  'skilled': ['skilled'],
  'readers': ['read','ers'],
  'depend': ['de','pend'],
  'studying': ['stud','y','ing'],
  'studied': ['stud','ied'],
  'comfort': ['com','fort'],
  'colour': ['col','our'],
  'working': ['work','ing'],
  'horrified': ['hor','ri','fied'],
  'especially': ['es','pe','cial','ly'],
  'precisely': ['pre','cise','ly'],
  'browsers': ['brows','ers'],
  'modern': ['mod','ern'],
  'approach': ['ap','proach'],
  'wildly': ['wild','ly'],
  'columns': ['col','umns'],
  'single': ['sin','gle'],
  'standard': ['stan','dard'],
  'Michael': ['Mi','cha','el'],
  'Donald': ['Don','ald'],
  'remains': ['re','mains'],
  'system': ['sys','tem'],
  'rather': ['rath','er'],
  'greedily': ['greed','i','ly'],
  'filling': ['fill','ing'],
  'shortest': ['short','est'],
  'results': ['re','sults'],
  'greedy': ['greed','y'],
  'number': ['num','ber'],
  'completely': ['com','plete','ly'],
  'different': ['dif','fer','ent'],
  'problem': ['prob','lem'],
  'amounts': ['a','mounts'],
  'entire': ['en','tire'],
  'global': ['glob','al'],
  'metal': ['met','al'],
  'every': ['ev','ery'],
  'inter': ['in','ter'],
}

// Common prefix/suffix based fallback
const PREFIXES = ['anti','auto','be','bi','co','com','con','contra','counter','de','dis','en','em','ex','extra','fore','hyper','il','im','in','inter','intra','ir','macro','mal','micro','mid','mis','mono','multi','non','omni','out','over','para','poly','post','pre','pro','pseudo','quasi','re','retro','semi','sub','super','sur','syn','tele','trans','tri','ultra','un','under']
const SUFFIXES = ['able','ible','tion','sion','ment','ness','ous','ious','eous','ful','less','ive','ative','itive','al','ial','ical','ical','ing','ling','ed','er','est','ism','ist','ity','ety','ty','ence','ance','ly','fy','ify','ize','ise','ure','ture']

function hyphenateWord(word: string): string[] {
  const lower = word.toLowerCase().replace(/[.,;:!?"'""''—–\-]/g, '')
  if (lower.length < 5) return [word]

  const exc = HYPHEN_EXCEPTIONS[lower]
  if (exc) {
    // Reconstruct with original casing
    const parts: string[] = []
    let pos = 0
    for (const part of exc) {
      parts.push(word.slice(pos, pos + part.length))
      pos += part.length
    }
    if (pos < word.length) {
      parts[parts.length - 1] += word.slice(pos)
    }
    return parts.filter(p => p.length > 0)
  }

  // Fallback: try prefix/suffix splitting
  for (const prefix of PREFIXES) {
    if (lower.startsWith(prefix) && lower.length - prefix.length >= 3) {
      return [word.slice(0, prefix.length), word.slice(prefix.length)]
    }
  }
  for (const suffix of SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length - suffix.length >= 3) {
      const cut = word.length - suffix.length
      return [word.slice(0, cut), word.slice(cut)]
    }
  }

  return [word]
}

// ── Pretext prepare ─────────────────────────────

await document.fonts.ready

const preparedParas = PARAGRAPHS.map(p => prepareWithSegments(p, FONT))

// ── Measure normal space width ──────────────────

const measureCanvas = document.createElement('canvas')
const measureCtx = measureCanvas.getContext('2d')!
measureCtx.font = FONT
const NORMAL_SPACE_W = measureCtx.measureText(' ').width

// ── Greedy justified layout ──────────────────────

type JustifiedLine = {
  segments: Array<{ text: string; width: number; isSpace: boolean }>
  y: number
  maxWidth: number
  isLast: boolean // last line of paragraph
  lineWidth: number // natural width
}

function greedyJustifiedLayout(
  prepared: PreparedTextWithSegments,
  maxWidth: number,
): JustifiedLine[] {
  const lines: JustifiedLine[] = []
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }

  while (true) {
    const line = layoutNextLine(prepared, cursor, maxWidth)
    if (line === null) break

    const isLast = line.end.segmentIndex >= prepared.segments.length

    // Extract per-segment data, handling soft hyphens
    const segments: JustifiedLine['segments'] = []
    let endsWithHyphen = false
    for (let si = line.start.segmentIndex; si < line.end.segmentIndex; si++) {
      const text = prepared.segments[si]!
      if (text === '\u00AD') {
        // If this soft hyphen is at the end of the line, mark it
        if (si === line.end.segmentIndex - 1) endsWithHyphen = true
        continue // skip soft-hyphen markers in output
      }
      const width = prepared.widths[si]!
      const isSpace = text.trim().length === 0
      segments.push({ text, width, isSpace })
    }

    // Check if the segment AFTER the break is a soft hyphen (pretext may break before it)
    if (!endsWithHyphen && line.end.segmentIndex < prepared.segments.length) {
      const nextSeg = prepared.segments[line.end.segmentIndex]
      if (nextSeg === '\u00AD') endsWithHyphen = true
    }

    // Add visible hyphen at line break
    if (endsWithHyphen && !isLast) {
      segments.push({ text: '-', width: HYPHEN_WIDTH, isSpace: false })
    }

    // Trim trailing spaces
    while (segments.length > 0 && segments[segments.length - 1]!.isSpace) {
      segments.pop()
    }

    let lw = 0
    for (const seg of segments) lw += seg.width

    lines.push({
      segments,
      y: 0, // filled later
      maxWidth,
      isLast,
      lineWidth: lw,
    })

    cursor = line.end
  }

  return lines
}

// ── Hyphenated text (prepared once) ────────────────

const hyphenatedPrepared: PreparedTextWithSegments[] = PARAGRAPHS.map(para => {
  const words = para.split(/(\s+)/)
  const hyphenated = words.map(token => {
    if (/^\s+$/.test(token)) return token
    const parts = hyphenateWord(token)
    if (parts.length <= 1) return token
    return parts.join('\u00AD') // soft hyphen
  }).join('')
  return prepareWithSegments(hyphenated, FONT)
})

function hyphenatedGreedyLayout(maxWidth: number): JustifiedLine[][] {
  return hyphenatedPrepared.map(p => greedyJustifiedLayout(p, maxWidth))
}

// ── Knuth-Plass optimal layout ──────────────────
// Simplified Knuth-Plass: DP over all feasible break points (word boundaries
// AND soft-hyphen positions), minimizing total badness based on per-space
// stretch ratio. When combined with hyphenation, this produces dramatically
// better justification than any greedy approach.

type LineInfo = { wordWidth: number; spaceCount: number; endsWithHyphen: boolean }

// Measure hyphen width for soft-hyphen breaks
const HYPHEN_WIDTH = measureCtx.measureText('-').width

function optimalLayout(
  prepared: PreparedTextWithSegments,
  maxWidth: number,
): JustifiedLine[] {
  const segs = prepared.segments
  const widths = prepared.widths
  const n = segs.length

  if (n === 0) return []

  // Build break candidates: positions where a line can break.
  // Break after spaces (word boundaries) and at soft hyphens (syllable boundaries).
  type BreakCandidate = {
    segIndex: number     // segment index where the NEXT line starts
    isSoftHyphen: boolean // whether this break is at a soft hyphen
  }
  const breakCandidates: BreakCandidate[] = [{ segIndex: 0, isSoftHyphen: false }]

  for (let i = 0; i < n; i++) {
    const text = segs[i]!
    if (text === '\u00AD') {
      // Soft hyphen: break AFTER the soft hyphen (next line starts at i+1)
      if (i + 1 < n) {
        breakCandidates.push({ segIndex: i + 1, isSoftHyphen: true })
      }
    } else if (text.trim().length === 0 && i + 1 < n) {
      // Space: break after space
      breakCandidates.push({ segIndex: i + 1, isSoftHyphen: false })
    }
  }
  breakCandidates.push({ segIndex: n, isSoftHyphen: false }) // end of text

  const numCandidates = breakCandidates.length

  // Compute line metrics for a line from candidate i to candidate j
  function getLineInfo(fromIdx: number, toIdx: number): LineInfo {
    const from = breakCandidates[fromIdx]!.segIndex
    const to = breakCandidates[toIdx]!.segIndex
    const endsWithHyphen = breakCandidates[toIdx]!.isSoftHyphen
    let wordWidth = 0
    let spaceCount = 0

    for (let si = from; si < to; si++) {
      const text = segs[si]!
      if (text === '\u00AD') continue // soft hyphens have 0 width, skip
      if (text.trim().length === 0) {
        spaceCount++
      } else {
        wordWidth += widths[si]!
      }
    }

    // Don't count trailing space (hangs past line edge)
    if (to > from && segs[to - 1]!.trim().length === 0) {
      spaceCount--
    }

    // Add hyphen width if line ends at a soft hyphen
    if (endsWithHyphen) {
      wordWidth += HYPHEN_WIDTH
    }

    return { wordWidth, spaceCount, endsWithHyphen }
  }

  // Badness: per-space stretch ratio, cubic scaling, river demerits
  function lineBadness(info: LineInfo, isLastLine: boolean): number {
    if (isLastLine) {
      if (info.wordWidth > maxWidth) return 1e8
      return 0
    }

    if (info.spaceCount <= 0) {
      const slack = maxWidth - info.wordWidth
      if (slack < 0) return 1e8
      return slack * slack * 10
    }

    const justifiedSpace = (maxWidth - info.wordWidth) / info.spaceCount
    if (justifiedSpace < 0) return 1e8

    // Infeasible: words would look concatenated
    if (justifiedSpace < NORMAL_SPACE_W * 0.4) return 1e8

    const ratio = (justifiedSpace - NORMAL_SPACE_W) / NORMAL_SPACE_W
    const absRatio = Math.abs(ratio)
    const badness = absRatio * absRatio * absRatio * 1000

    // Steep demerits for river-creating spaces (> 1.5× normal)
    const riverExcess = justifiedSpace / NORMAL_SPACE_W - 1.5
    const riverPenalty = riverExcess > 0
      ? 5000 + riverExcess * riverExcess * 10000
      : 0

    // Demerits for tight spacing (< 0.65× normal)
    const tightThreshold = NORMAL_SPACE_W * 0.65
    const tightPenalty = justifiedSpace < tightThreshold
      ? 3000 + (tightThreshold - justifiedSpace) * (tightThreshold - justifiedSpace) * 10000
      : 0

    // Small penalty for hyphen breaks (prefer word boundaries when equal)
    const hyphenPenalty = info.endsWithHyphen ? 50 : 0

    return badness + riverPenalty + tightPenalty + hyphenPenalty
  }

  // DP: find optimal breakpoints
  const dp: number[] = new Array(numCandidates).fill(Infinity)
  const prev: number[] = new Array(numCandidates).fill(-1)
  dp[0] = 0

  for (let j = 1; j < numCandidates; j++) {
    const isLast = j === numCandidates - 1

    for (let i = j - 1; i >= 0; i--) {
      if (dp[i] === Infinity) continue
      const info = getLineInfo(i, j)
      const totalWidth = info.wordWidth + info.spaceCount * NORMAL_SPACE_W

      // If natural width far exceeds maxWidth, going further back is worse
      if (totalWidth > maxWidth * 2) break

      const bad = lineBadness(info, isLast)
      const total = dp[i]! + bad
      if (total < dp[j]!) {
        dp[j] = total
        prev[j] = i
      }
    }
  }

  // Trace back
  const breakIndices: number[] = []
  let cur = numCandidates - 1
  while (cur > 0) {
    if (prev[cur] === -1) { cur--; continue }
    breakIndices.push(cur)
    cur = prev[cur]!
  }
  breakIndices.reverse()

  // Build lines
  const lines: JustifiedLine[] = []
  let fromCandidate = 0

  for (let bi = 0; bi < breakIndices.length; bi++) {
    const toCandidate = breakIndices[bi]!
    const from = breakCandidates[fromCandidate]!.segIndex
    const to = breakCandidates[toCandidate]!.segIndex
    const endsWithHyphen = breakCandidates[toCandidate]!.isSoftHyphen
    const isLast = toCandidate === numCandidates - 1

    const segments: JustifiedLine['segments'] = []
    for (let si = from; si < to; si++) {
      const text = segs[si]!
      if (text === '\u00AD') continue // skip soft-hyphen markers
      const width = widths[si]!
      const isSpace = text.trim().length === 0
      segments.push({ text, width, isSpace })
    }

    // Add visible hyphen if line breaks at a soft hyphen
    if (endsWithHyphen) {
      segments.push({ text: '-', width: HYPHEN_WIDTH, isSpace: false })
    }

    // Trim trailing spaces
    while (segments.length > 0 && segments[segments.length - 1]!.isSpace) {
      segments.pop()
    }

    let lw = 0
    for (const seg of segments) lw += seg.width

    lines.push({
      segments,
      y: 0,
      maxWidth,
      isLast,
      lineWidth: lw,
    })

    fromCandidate = toCandidate
  }

  return lines
}

// ── River detection & quality scoring ────────────

type QualityMetrics = {
  avgDeviation: number  // average space deviation from ideal (ratio)
  maxDeviation: number  // worst-case
  riverCount: number    // spaces > 1.5× normal
  lineCount: number
  layoutMs: number
}

function computeMetrics(allLines: JustifiedLine[][]): QualityMetrics {
  let totalDev = 0
  let maxDev = 0
  let count = 0
  let rivers = 0
  let lineCount = 0

  for (const paraLines of allLines) {
    lineCount += paraLines.length
    for (const line of paraLines) {
      if (line.isLast) continue

      let wordWidth = 0
      let spaceCount = 0
      for (const seg of line.segments) {
        if (seg.isSpace) spaceCount++
        else wordWidth += seg.width
      }

      if (spaceCount <= 0) continue

      const justifiedSpace = (line.maxWidth - wordWidth) / spaceCount
      const deviation = Math.abs(justifiedSpace - NORMAL_SPACE_W) / NORMAL_SPACE_W

      totalDev += deviation
      if (deviation > maxDev) maxDev = deviation
      count++

      if (justifiedSpace > NORMAL_SPACE_W * 1.5) rivers++
    }
  }

  return {
    avgDeviation: count > 0 ? totalDev / count : 0,
    maxDeviation: maxDev,
    riverCount: rivers,
    lineCount,
    layoutMs: 0,
  }
}

// ── Render justified lines to canvas ────────────

function renderJustifiedColumn(
  canvas: HTMLCanvasElement,
  allLines: JustifiedLine[][],
  colWidth: number,
): void {
  // Assign Y positions
  let y = PAD
  for (let pi = 0; pi < allLines.length; pi++) {
    const paraLines = allLines[pi]!
    for (let li = 0; li < paraLines.length; li++) {
      paraLines[li]!.y = y
      y += LINE_HEIGHT
    }
    if (pi < allLines.length - 1) y += PARA_GAP
  }

  const totalH = y + PAD
  const ctx = setupCanvas(canvas, colWidth, totalH)

  // White background
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, colWidth, totalH)

  // Clip to prevent overflow rendering
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, colWidth, totalH)
  ctx.clip()

  ctx.font = FONT
  ctx.textBaseline = 'top'

  for (const paraLines of allLines) {
    for (const line of paraLines) {
      const shouldJustify = !line.isLast
        && line.lineWidth >= line.maxWidth * 0.6

      if (!shouldJustify) {
        // Ragged (last line or short line)
        ctx.fillStyle = '#2a2520'
        let x = PAD
        for (const seg of line.segments) {
          if (!seg.isSpace) {
            ctx.fillText(seg.text, x, line.y)
          }
          x += seg.width
        }
        continue
      }

      // Compute justified spacing
      let wordWidth = 0
      let spaceCount = 0
      for (const seg of line.segments) {
        if (seg.isSpace) spaceCount++
        else wordWidth += seg.width
      }

      if (spaceCount <= 0) {
        ctx.fillStyle = '#2a2520'
        let x = PAD
        for (const seg of line.segments) {
          if (!seg.isSpace) ctx.fillText(seg.text, x, line.y)
          x += seg.width
        }
        continue
      }

      const rawJustifiedSpace = (line.maxWidth - wordWidth) / spaceCount

      // Guard against overflow lines (wordWidth > maxWidth → negative space)
      if (rawJustifiedSpace < NORMAL_SPACE_W * 0.2) {
        ctx.fillStyle = '#2a2520'
        let x = PAD
        for (const seg of line.segments) {
          if (!seg.isSpace) ctx.fillText(seg.text, x, line.y)
          x += seg.width
        }
        continue
      }

      // Floor space width so tight lines stay readable (clip handles overflow)
      const justifiedSpace = Math.max(rawJustifiedSpace, NORMAL_SPACE_W * 0.75)

      const isRiver = justifiedSpace > NORMAL_SPACE_W * 1.5

      let x = PAD
      for (const seg of line.segments) {
        if (seg.isSpace) {
          // Highlight rivers
          if (isRiver) {
            const intensity = Math.min(1, (justifiedSpace / NORMAL_SPACE_W - 1.5) / 1.5)
            const r = Math.round(220 + intensity * 35)
            const g = Math.round(180 - intensity * 80)
            const b = Math.round(180 - intensity * 80)
            const alpha = 0.25 + intensity * 0.35
            ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
            ctx.fillRect(x + 1, line.y, justifiedSpace - 2, LINE_HEIGHT)
          }
          x += justifiedSpace
        } else {
          ctx.fillStyle = '#2a2520'
          ctx.fillText(seg.text, x, line.y)
          x += seg.width
        }
      }
    }
  }

  ctx.restore() // remove clip
}

// ── CSS column metrics (approximate) ────────────

function computeCSSMetrics(colWidth: number): QualityMetrics {
  // We approximate CSS metrics by laying out with pretext greedy
  // (same algorithm CSS uses) and computing spacing stats
  const innerWidth = colWidth - PAD * 2
  const allLines = preparedParas.map(p => greedyJustifiedLayout(p, innerWidth))
  const m = computeMetrics(allLines)
  m.layoutMs = -1 // CSS doesn't expose timing
  return m
}

// ── Render metrics panel ────────────────────────

function qualityClass(avgDev: number): string {
  if (avgDev < 0.15) return 'good'
  if (avgDev < 0.35) return 'ok'
  return 'bad'
}

function renderMetrics(el: HTMLElement, m: QualityMetrics, isCSS: boolean): void {
  const avgPct = (m.avgDeviation * 100).toFixed(1)
  const maxPct = (m.maxDeviation * 100).toFixed(1)
  const cls = qualityClass(m.avgDeviation)
  const maxCls = qualityClass(m.maxDeviation / 2)

  let html = `
    <div class="metric-row"><span class="metric-label">Lines</span><span class="metric-value">${m.lineCount}</span></div>
    <div class="metric-row"><span class="metric-label">Avg deviation</span><span class="metric-value ${cls}">${avgPct}%</span></div>
    <div class="metric-row"><span class="metric-label">Max deviation</span><span class="metric-value ${maxCls}">${maxPct}%</span></div>
    <div class="metric-row"><span class="metric-label">River spaces</span><span class="metric-value ${m.riverCount > 0 ? 'bad' : 'good'}">${m.riverCount}</span></div>
  `
  el.innerHTML = html
}

// ── CSS river highlighting ───────────────────────

function highlightCSSRivers(): void {
  const overlay = document.getElementById('cssRiverOverlay')!
  overlay.innerHTML = ''
  const colRect = cssCol.getBoundingClientRect()

  // Walk each <p> in the CSS text
  const paragraphs = cssText.querySelectorAll('p')
  for (const p of paragraphs) {
    const textNode = p.firstChild
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue

    const text = textNode.textContent!
    const range = document.createRange()

    // Find space positions
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== ' ') continue

      // Measure the space character
      range.setStart(textNode, i)
      range.setEnd(textNode, i + 1)
      const rects = range.getClientRects()
      if (rects.length !== 1) continue // skip line-break spaces

      const rect = rects[0]!
      const spaceWidth = rect.width
      if (spaceWidth < 1) continue // collapsed space

      if (spaceWidth > NORMAL_SPACE_W * 1.5) {
        const intensity = Math.min(1, (spaceWidth / NORMAL_SPACE_W - 1.5) / 1.5)
        const r = Math.round(220 + intensity * 35)
        const g = Math.round(180 - intensity * 80)
        const b = Math.round(180 - intensity * 80)
        const alpha = 0.25 + intensity * 0.35

        const mark = document.createElement('div')
        mark.style.cssText = `position:absolute;left:${rect.left - colRect.left}px;top:${rect.top - colRect.top}px;width:${spaceWidth}px;height:${LINE_HEIGHT}px;background:rgba(${r},${g},${b},${alpha});pointer-events:none;`
        overlay.appendChild(mark)
      }
    }
  }
}

// ── Main render ─────────────────────────────────

const slider = document.getElementById('widthSlider') as HTMLInputElement
const widthVal = document.getElementById('widthVal')!
const cssText = document.getElementById('cssText')!
const cssCol = document.getElementById('cssCol')!
const c2 = document.getElementById('c2') as HTMLCanvasElement
const c3 = document.getElementById('c3') as HTMLCanvasElement
const m0 = document.getElementById('metrics0')!
const m2 = document.getElementById('metrics2')!
const m3 = document.getElementById('metrics3')!

// Set CSS text content
cssText.innerHTML = PARAGRAPHS.map((p, i) =>
  `<p style="margin-bottom:${i < PARAGRAPHS.length - 1 ? PARA_GAP : 0}px">${p}</p>`
).join('')

function render(): void {
  const colWidth = parseInt(slider.value)
  widthVal.textContent = colWidth + 'px'

  const innerWidth = colWidth - PAD * 2

  // Size all columns
  const cols = document.querySelectorAll<HTMLElement>('.column')
  cols.forEach(c => { c.style.width = colWidth + 'px' })
  cssCol.style.width = colWidth + 'px'

  // ── Column 1: CSS / Greedy ──────────────────────
  // CSS handles its own rendering. We just size it.
  // River highlighting is deferred to after layout reflow (below).
  const cssMetrics = computeCSSMetrics(colWidth)
  renderMetrics(m0, cssMetrics, true)

  // ── Column 2: Pretext + Hyphenation ───────────
  let t0 = performance.now()
  const hyphenLines = hyphenatedGreedyLayout(innerWidth)
  const hyphenMs = performance.now() - t0

  renderJustifiedColumn(c2, hyphenLines, colWidth)
  const hyphenMetrics = computeMetrics(hyphenLines)
  hyphenMetrics.layoutMs = hyphenMs
  renderMetrics(m2, hyphenMetrics, false)

  // ── Column 3: Optimal (Knuth-Plass) ─────────────
  t0 = performance.now()
  const optimalLines = hyphenatedPrepared.map(p => optimalLayout(p, innerWidth))
  const optimalMs = performance.now() - t0

  renderJustifiedColumn(c3, optimalLines, colWidth)
  const optimalMetrics = computeMetrics(optimalLines)
  optimalMetrics.layoutMs = optimalMs
  renderMetrics(m3, optimalMetrics, false)

  // Highlight CSS rivers after browser reflows the text
  requestAnimationFrame(() => highlightCSSRivers())
}

// ── Events ──────────────────────────────────────

let scheduled = false
function scheduleRender(): void {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    render()
  })
}

slider.addEventListener('input', scheduleRender)
window.addEventListener('resize', scheduleRender)

render()
