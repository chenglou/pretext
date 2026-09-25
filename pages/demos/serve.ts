// Serves the demos at the paths `bun start` uses, from a clone or from an install:
// `bun node_modules/@chenglou/pretext/pages/demos/serve.ts` (PORT picks the port).
// The Markdown chat also needs `marked`, which the app installs next to Pretext.
const routes: Record<string, Bun.HTMLBundle> = {}
for (const file of new Bun.Glob('**/*.html').scanSync(import.meta.dir)) {
  const slug = file.replace(/\.html$/, '').replace(/(^|\/)index$/, '')
  routes[slug === '' ? '/demos' : `/demos/${slug}`] = (await import(`./${file}`)).default
}
const server = Bun.serve({ routes })
console.log(`${server.url}demos`)
