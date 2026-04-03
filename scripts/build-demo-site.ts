import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const outdir = path.join(root, 'site')
const entrypoints = [
  'pages/demos/index.html',
  'pages/demos/accordion.html',
  'pages/demos/bubbles.html',
  'pages/demos/dynamic-layout.html',
  'pages/demos/editorial-engine.html',
  'pages/demos/justification-comparison.html',
  'pages/demos/markdown-chat.html',
  'pages/demos/masonry/index.html',
  'pages/demos/rich-note.html',
  'pages/demos/variable-typographic-ascii.html',
]

const result = Bun.spawnSync(
  ['bun', 'build', ...entrypoints, '--outdir', outdir],
  {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  },
)

if (result.exitCode !== 0) {
  process.exit(result.exitCode)
}

const targets = [
  { source: 'index.html', target: 'index.html' },
  { source: 'accordion.html', target: 'accordion/index.html' },
  { source: 'bubbles.html', target: 'bubbles/index.html' },
  { source: 'dynamic-layout.html', target: 'dynamic-layout/index.html' },
  { source: 'editorial-engine.html', target: 'editorial-engine/index.html' },
  { source: 'justification-comparison.html', target: 'justification-comparison/index.html' },
  { source: 'markdown-chat.html', target: 'markdown-chat/index.html' },
  { source: 'masonry/index.html', target: 'masonry/index.html' },
  { source: 'rich-note.html', target: 'rich-note/index.html' },
  { source: 'variable-typographic-ascii.html', target: 'variable-typographic-ascii/index.html' },
]

for (let index = 0; index < targets.length; index++) {
  const entry = targets[index]!
  await moveBuiltHtml(entry.source, entry.target)
}

await rm(path.join(outdir, 'pages'), { recursive: true, force: true })

async function resolveBuiltHtmlPath(relativePath: string): Promise<string> {
  const candidates = [
    path.join(outdir, relativePath),
    path.join(outdir, 'pages', 'demos', relativePath),
  ]
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!
    if (await Bun.file(candidate).exists()) return candidate
  }
  throw new Error(`Built HTML not found for ${relativePath}`)
}

async function moveBuiltHtml(sourceRelativePath: string, targetRelativePath: string): Promise<void> {
  const sourcePath = await resolveBuiltHtmlPath(sourceRelativePath)
  const targetPath = path.join(outdir, targetRelativePath)
  let html = await readFile(sourcePath, 'utf8')
  html = rebaseRelativeAssetUrls(html, sourcePath, targetPath)
  html = rewriteDemoLinksForStaticRoot(html, targetRelativePath)

  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, html)
  if (sourcePath !== targetPath) await rm(sourcePath)
}

function rebaseRelativeAssetUrls(html: string, sourcePath: string, targetPath: string): string {
  return html.replace(/\b(src|href)="([^"]+)"/g, (_match, attr: string, value: string) => {
    if (!value.startsWith('.')) return `${attr}="${value}"`

    const absoluteAssetPath = path.resolve(path.dirname(sourcePath), value)
    let relativeAssetPath = path.relative(path.dirname(targetPath), absoluteAssetPath)
    relativeAssetPath = relativeAssetPath.split(path.sep).join('/')
    if (!relativeAssetPath.startsWith('.')) relativeAssetPath = `./${relativeAssetPath}`
    return `${attr}="${relativeAssetPath}"`
  })
}

function rewriteDemoLinksForStaticRoot(html: string, targetRelativePath: string): string {
  if (targetRelativePath !== 'index.html') return html
  return html.replace(/\bhref="\/demos\/([^"/]+)"/g, (_match, slug: string) => `href="./${slug}"`)
}
