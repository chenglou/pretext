import type { PreparedOwned, OwnedLine } from './core.js'
export type PaintOptions = { lineHeight?: number; placement?: 'transform' | 'left' }
export function paint(prepared: PreparedOwned, lines: readonly OwnedLine[], options: PaintOptions = {}): HTMLElement {
  const lineHeight = options.lineHeight ?? 28
  const root = document.createElement('div')
  root.className = 'owned-paragraph'; root.lang = prepared.lang; root.dir = 'ltr'
  root.style.cssText = `position:relative;height:${lines.length * lineHeight}px;white-space:pre;word-spacing:0px;font:16px Arial;`
  const sourceSpace = (): HTMLElement => {
    const space = document.createElement('span')
    space.className = 'owned-source-space'; space.textContent = ' '
    space.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;white-space:pre'
    return space
  }
  if (prepared.text.startsWith(' ')) root.append(sourceSpace())
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const row = document.createElement('div')
    row.className = 'owned-line'; row.dir = 'ltr'
    row.style.cssText = `position:absolute;left:0;top:${i * lineHeight}px;height:${lineHeight}px;white-space:pre;line-height:${lineHeight}px;`
    row.dataset['start'] = String(line.start); row.dataset['end'] = String(line.end)
    // Zero-width inline boxes all start at x=0. Their transforms supply every x,
    // while inline formatting aligns baselines. Text shapes only inside each box.
    // Keep logical DOM order even though the chosen positions are visual order.
    const logical = line.fragments.slice().sort((a, b) => a.start - b.start)
    for (const fragment of logical) {
      const node = document.createElement('span')
      node.className = 'owned-fragment'; node.dir = 'ltr'
      node.dataset['item'] = String(fragment.itemIndex)
      node.dataset['start'] = String(fragment.start); node.dataset['end'] = String(fragment.end)
      node.style.cssText = 'position:relative;display:inline-block;width:0;overflow:visible;vertical-align:baseline;white-space:pre;unicode-bidi:isolate;'
      if (options.placement === 'left') node.style.left = `${fragment.x}px`
      else node.style.transform = `translateX(${fragment.x}px)`
      const ink = document.createElement('span')
      ink.className = 'owned-ink'; ink.dir = fragment.direction
      ink.style.cssText = 'display:inline-block;white-space:pre;unicode-bidi:isolate-override;word-spacing:0px;font-kerning:auto;text-rendering:auto;vertical-align:baseline;'
      ink.style.font = fragment.font; ink.style.letterSpacing = `${fragment.letterSpacing}px`
      ink.style.lineHeight = `${lineHeight}px`
      ink.style.color = fragment.itemIndex % 2 === 0 ? '#142a3b' : '#8b2455'
      ink.textContent = fragment.text
      const item = prepared.items[fragment.itemIndex]!
      if (item.kind === 'atomic') {
        ink.dir = 'auto'; ink.style.unicodeBidi = 'isolate'
        ink.style.width = `${item.width}px`; ink.style.height = `${item.height}px`
        ink.style.lineHeight = `${item.height}px`; ink.style.background = '#d3e6fa'
        ink.style.textAlign = 'center'; ink.style.overflow = 'hidden'
      } else if (item.atomic === true) {
        ink.dir = 'auto'; ink.style.unicodeBidi = 'isolate'
        ink.style.paddingInline = `${(item.extraWidth ?? 0) / 2}px`; ink.style.background = '#e8eef4'
      }
      node.append(ink); row.append(node)
    }
    if (line.separator.length !== 0) row.append(sourceSpace())
    root.append(row)
  }
  return root
}
