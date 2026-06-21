/**
 * OffscreenCanvas polyfill for Node.js using @napi-rs/canvas.
 *
 * Must be imported BEFORE any @chenglou/pretext import so that
 * pretext's getMeasureContext() finds globalThis.OffscreenCanvas.
 */

import { Canvas, GlobalFonts } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'

function loadSystemFonts(): void {
  const os = platform()
  const dirs: string[] = []

  if (os === 'win32') {
    dirs.push('C:\\Windows\\Fonts')
  } else if (os === 'darwin') {
    dirs.push('/System/Library/Fonts')
    dirs.push('/Library/Fonts')
  } else {
    dirs.push('/usr/share/fonts')
    dirs.push('/usr/local/share/fonts')
  }

  // Also check for bundled fonts next to the package
  const bundledDir = join(import.meta.dirname ?? '.', '..', 'fonts')
  if (existsSync(bundledDir)) {
    dirs.push(bundledDir)
  }

  for (const dir of dirs) {
    if (existsSync(dir)) {
      try {
        GlobalFonts.loadFontsFromDir(dir)
      } catch {
        // Silently skip inaccessible font directories
      }
    }
  }
}

class OffscreenCanvasPolyfill {
  private _canvas: Canvas

  constructor(width: number, height: number) {
    this._canvas = new Canvas(width, height)
  }

  getContext(type: string) {
    if (type !== '2d') return null
    return this._canvas.getContext('2d')
  }

  get width(): number {
    return this._canvas.width
  }

  get height(): number {
    return this._canvas.height
  }
}

export function installPolyfill(): void {
  if (typeof globalThis.OffscreenCanvas !== 'undefined') return

  loadSystemFonts()

  ;(globalThis as Record<string, unknown>).OffscreenCanvas = OffscreenCanvasPolyfill
}

// Self-install on import
installPolyfill()
