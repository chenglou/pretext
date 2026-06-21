# Pretext MCP Server

[MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes Pretext's text measurement and layout as tools for AI coding assistants like Claude Code, Cursor, or any MCP-compatible client.

This gives AI assistants the ability to **measure text layout** without a browser — verifying that labels fit in buttons, computing paragraph heights for virtualization, and validating UI text at development time.

## Tools

| Tool | Description |
|---|---|
| `measure_text` | Measure paragraph height and line count at a given width |
| `layout_lines` | Get individual line text/width for rendering or debugging |
| `find_optimal_width` | Binary search for minimum width fitting N lines (shrink-wrap) |
| `validate_text_fit` | Batch check that multiple texts fit within constraints |
| `clear_cache` | Clear internal measurement caches |

## Setup

### With Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "pretext": {
      "command": "node",
      "args": ["/path/to/pretext/mcp-server/dist/index.js"]
    }
  }
}
```

### With any MCP client

```bash
cd mcp-server
npm install
npm run build
node dist/index.js  # Communicates via stdio
```

## Requirements

- Node.js >= 18
- System fonts (the server loads fonts from your OS font directory automatically)

## How it works

Pretext normally runs in a browser where `OffscreenCanvas` or `<canvas>` provides text measurement via `measureText()`. This server polyfills `OffscreenCanvas` using `@napi-rs/canvas` (Skia-based, no native dependencies to install), allowing Pretext to run headlessly in Node.js.

System fonts are loaded automatically:
- **Windows**: `C:\Windows\Fonts`
- **macOS**: `/System/Library/Fonts`, `/Library/Fonts`
- **Linux**: `/usr/share/fonts`, `/usr/local/share/fonts`

You can also place `.ttf`/`.otf` files in the `fonts/` directory next to the server.

## Example usage from Claude Code

Once configured, Claude Code can call these tools directly:

```
> measure_text("Submit Order", "14px Arial", maxWidth=120, lineHeight=18)
→ { lineCount: 1, height: 18 }

> validate_text_fit([
    { id: "btn", text: "Submit", font: "14px Arial", maxWidth: 80, lineHeight: 18 },
    { id: "label", text: "Very long label text...", font: "14px Arial", maxWidth: 80, lineHeight: 18 }
  ])
→ { summary: "HAS_FAILURES", passed: 1, failed: 1 }
```

## Caveats

- Font metrics from `@napi-rs/canvas` (Skia) may differ slightly from browser measurements. Results are close but not pixel-perfect compared to Chrome/Safari/Firefox.
- `system-ui` font is unreliable — use named fonts like `"16px Arial"` or `"16px Inter"`.
