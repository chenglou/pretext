// Serves every demo at /demos/<name>, from a clone or from an install:
// `bun node_modules/@chenglou/pretext/pages/demos/serve.ts` (PORT picks the port).
// The Markdown chat also needs `marked`, which the app installs next to Pretext.
const routes: Record<string, Bun.HTMLBundle> = {}
for (const file of new Bun.Glob('**/*.html').scanSync(import.meta.dir)) {
  routes[`/demos/${file.replace(/(\/index)?\.html$/, '')}`] = (await import(`./${file}`)).default
}
const server = Bun.serve({ routes })
console.log(`${server.url}demos/index`)
