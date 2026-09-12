#!/usr/bin/env node

/**
 * Pretext MCP Server
 *
 * Exposes @chenglou/pretext text measurement and layout as MCP tools
 * for AI coding assistants (Claude Code, Cursor, etc.).
 *
 * Tools:
 *   - measure_text: Measure paragraph height and line count at a given width
 *   - layout_lines: Get individual line text/width for rendering
 *   - find_optimal_width: Binary search for minimum width fitting N lines
 *   - validate_text_fit: Batch check that texts fit within constraints
 */

// Polyfill MUST be first — before any pretext import
import './canvas-polyfill.js'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  prepare,
  prepareWithSegments,
  layout,
  layoutWithLines,
  walkLineRanges,
  clearCache,
} from '@chenglou/pretext'

const server = new McpServer({
  name: 'pretext',
  version: '0.1.0',
})

// --- Tool: measure_text ---

server.tool(
  'measure_text',
  'Measure a paragraph of text to get its height and line count at a given max width. ' +
    'Uses the same line-breaking algorithm as CSS white-space:normal + overflow-wrap:break-word. ' +
    'Supports all languages including CJK, Arabic, Thai, mixed bidi, and emoji.',
  {
    text: z.string().describe('The text content to measure'),
    font: z.string().describe('CSS font shorthand, e.g. "16px Inter", "bold 14px Arial"'),
    maxWidth: z.number().positive().describe('Maximum line width in pixels'),
    lineHeight: z.number().positive().describe('Line height in pixels (matches CSS line-height)'),
    whiteSpace: z
      .enum(['normal', 'pre-wrap'])
      .optional()
      .describe('White-space mode. "pre-wrap" preserves spaces, tabs, and newlines'),
  },
  async ({ text, font, maxWidth, lineHeight, whiteSpace }) => {
    const options = whiteSpace ? { whiteSpace } : undefined
    const prepared = prepare(text, font, options)
    const result = layout(prepared, maxWidth, lineHeight)
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            lineCount: result.lineCount,
            height: result.height,
            maxWidth,
            lineHeight,
            font,
          }),
        },
      ],
    }
  },
)

// --- Tool: layout_lines ---

server.tool(
  'layout_lines',
  'Lay out text and return individual lines with their text content and measured width. ' +
    'Useful for canvas/SVG rendering, debugging layout, or verifying line breaks.',
  {
    text: z.string().describe('The text content to lay out'),
    font: z.string().describe('CSS font shorthand, e.g. "16px Inter"'),
    maxWidth: z.number().positive().describe('Maximum line width in pixels'),
    lineHeight: z.number().positive().describe('Line height in pixels'),
    whiteSpace: z
      .enum(['normal', 'pre-wrap'])
      .optional()
      .describe('White-space mode'),
  },
  async ({ text, font, maxWidth, lineHeight, whiteSpace }) => {
    const options = whiteSpace ? { whiteSpace } : undefined
    const prepared = prepareWithSegments(text, font, options)
    const result = layoutWithLines(prepared, maxWidth, lineHeight)
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            lineCount: result.lineCount,
            height: result.height,
            lines: result.lines.map((line) => ({
              text: line.text,
              width: Math.round(line.width * 100) / 100,
            })),
          }),
        },
      ],
    }
  },
)

// --- Tool: find_optimal_width ---

server.tool(
  'find_optimal_width',
  'Find the minimum container width so that text fits within a target number of lines. ' +
    'Uses binary search over walkLineRanges. Useful for shrink-wrapping text containers.',
  {
    text: z.string().describe('The text content'),
    font: z.string().describe('CSS font shorthand, e.g. "16px Inter"'),
    lineHeight: z.number().positive().describe('Line height in pixels'),
    maxLines: z.number().int().positive().describe('Target maximum number of lines'),
    whiteSpace: z
      .enum(['normal', 'pre-wrap'])
      .optional()
      .describe('White-space mode'),
  },
  async ({ text, font, lineHeight, maxLines, whiteSpace }) => {
    const options = whiteSpace ? { whiteSpace } : undefined
    const prepared = prepareWithSegments(text, font, options)

    // Find the widest single line to use as upper bound
    let totalWidth = 0
    walkLineRanges(prepared, Infinity, (line) => {
      totalWidth += line.width
    })

    if (totalWidth === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ minWidth: 0, lineCount: 0, height: 0 }) }],
      }
    }

    // Binary search for minimum width
    let lo = 0
    let hi = totalWidth + 1
    const tolerance = 0.5 // sub-pixel precision

    while (hi - lo > tolerance) {
      const mid = (lo + hi) / 2
      let lineCount = 0
      walkLineRanges(prepared, mid, () => { lineCount++ })
      if (lineCount <= maxLines) {
        hi = mid
      } else {
        lo = mid
      }
    }

    const minWidth = Math.ceil(hi * 100) / 100
    const finalResult = layout(prepared, minWidth, lineHeight)

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            minWidth,
            lineCount: finalResult.lineCount,
            height: finalResult.height,
            targetMaxLines: maxLines,
          }),
        },
      ],
    }
  },
)

// --- Tool: validate_text_fit ---

server.tool(
  'validate_text_fit',
  'Batch-validate that multiple texts fit within given constraints (max width, max lines, max height). ' +
    'Returns PASS/FAIL per item. Useful for checking all labels/buttons on a page at once.',
  {
    items: z
      .array(
        z.object({
          id: z.string().describe('Identifier for this item (e.g. "submit-button", "header-title")'),
          text: z.string().describe('Text content to validate'),
          font: z.string().describe('CSS font shorthand'),
          maxWidth: z.number().positive().describe('Container width in pixels'),
          lineHeight: z.number().positive().describe('Line height in pixels'),
          maxLines: z.number().int().positive().optional().describe('Max allowed lines (default: 1)'),
          maxHeight: z.number().positive().optional().describe('Max allowed height in pixels'),
        }),
      )
      .describe('Array of text items to validate'),
  },
  async ({ items }) => {
    const results = items.map((item) => {
      const prepared = prepare(item.text, item.font)
      const result = layout(prepared, item.maxWidth, item.lineHeight)
      const maxLines = item.maxLines ?? 1
      const maxHeight = item.maxHeight ?? maxLines * item.lineHeight

      const linesOk = result.lineCount <= maxLines
      const heightOk = result.height <= maxHeight + 0.01
      const pass = linesOk && heightOk

      return {
        id: item.id,
        pass,
        lineCount: result.lineCount,
        height: result.height,
        ...(pass
          ? {}
          : {
              reason: !linesOk
                ? `${result.lineCount} lines exceeds max ${maxLines}`
                : `height ${result.height}px exceeds max ${maxHeight}px`,
            }),
      }
    })

    const allPass = results.every((r) => r.pass)

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            summary: allPass ? 'ALL_PASS' : 'HAS_FAILURES',
            passed: results.filter((r) => r.pass).length,
            failed: results.filter((r) => !r.pass).length,
            total: results.length,
            results,
          }),
        },
      ],
    }
  },
)

// --- Tool: clear_cache ---

server.tool(
  'clear_cache',
  'Clear Pretext internal caches. Useful if you switch fonts or want fresh measurements.',
  {},
  async () => {
    clearCache()
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ cleared: true }) }],
    }
  },
)

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('Pretext MCP server failed to start:', err)
  process.exit(1)
})
