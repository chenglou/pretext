import { serve } from "bun";
import { stat, readdir } from "fs/promises";
import { join, extname } from "path";

const PORT = 3000;
const HOST = "127.0.0.1";
const ROOT = process.cwd();

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return mimeTypes[ext] || 'application/octet-stream';
}

const transpiler = new Bun.Transpiler({ loader: 'ts' });

async function serveStatic(req) {
  const url = new URL(req.url);
  let pathname = url.pathname;
  console.log(`[REQ] ${pathname}`);

  if (pathname === "/") {
    return Response.redirect("/pages/demos/", 302);
  }

  let fsPath = pathname;
  
  // Path rewriting
  if (pathname.startsWith('/demos/')) {
    fsPath = 'pages' + pathname;
  } else if (pathname === '/demos') {
    return Response.redirect("/pages/demos/", 302);
  } else if (pathname.startsWith('/assets/')) {
    fsPath = 'pages' + pathname;
  }

  const safePath = fsPath.replace(/\.\./g, '');
  const filePath = join(ROOT, safePath);
  console.log(`[FS] ${filePath}`);

  const hasExt = extname(pathname) !== '';
  if (!hasExt) {
    const tryHtml = filePath + '.html';
    try {
      await stat(tryHtml);
      console.log(`[FOUND] HTML: ${tryHtml}`);
      const content = await Bun.file(tryHtml).text();
      return new Response(content, { headers: { 'Content-Type': 'text/html' } });
    } catch {
      // continue
    }
  }

  // JS -> TS fallback
  const tryJsToTs = async () => {
    if (filePath.endsWith('.js')) {
      const tsPath = filePath.slice(0, -3) + '.ts';
      try {
        await stat(tsPath);
        console.log(`[JS->TS] Fallback to ${tsPath}`);
        const tsContent = await Bun.file(tsPath).text();
        const transpiled = transpiler.transformSync(tsContent);
        const final = new TextEncoder().encode(transpiled);
        return new Response(final, {
          headers: { 'Content-Type': 'application/javascript' },
        });
      } catch {
        // not found
      }
    }
    return null;
  };

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      if (!pathname.endsWith('/')) {
        console.log(`[REDIR] Add slash`);
        return Response.redirect(req.url + '/', 301);
      }
      const indexPath = join(filePath, 'index.html');
      try {
        await stat(indexPath);
        console.log(`[INDEX] ${indexPath}`);
        const content = await Bun.file(indexPath).text();
        return new Response(content, { headers: { 'Content-Type': 'text/html' } });
      } catch {
        const entries = await readdir(filePath);
        const links = entries.map(entry => {
          const entryPath = join(safePath, entry).replace(/\\/g, '/');
          const isDir = entry.indexOf('.') === -1;
          const icon = isDir ? '📁' : '📄';
          return `<li>${icon} <a href="/${entryPath}">${entry}</a></li>`;
        }).join('');
        const html = `<h2>Index of ${safePath}</h2><ul>${links}</ul>`;
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      }
    } else {
      // Handle resources imported as modules
      const secFetchDest = req.headers.get('sec-fetch-dest');
      if (secFetchDest === 'script') {
        // SVG module: return a JS module exporting the URL
        if (filePath.endsWith('.svg')) {
          const svgUrl = `/${safePath.replace(/\\/g, '/')}`;
          const jsContent = `export default "${svgUrl}";`;
          console.log(`[SVG-MODULE] ${filePath} -> JS module`);
          return new Response(jsContent, {
            headers: { 'Content-Type': 'application/javascript' },
          });
        }
        // JSON module: return a JS module exporting the JSON object
        if (filePath.endsWith('.json')) {
          const jsonContent = await Bun.file(filePath).text();
          const jsContent = `export default ${jsonContent};`;
          console.log(`[JSON-MODULE] ${filePath} -> JS module`);
          return new Response(jsContent, {
            headers: { 'Content-Type': 'application/javascript' },
          });
        }
        // Additional resource types can be extended here...
      }

      // Regular file handling
      const fileBuffer = await Bun.file(filePath).arrayBuffer();
      let finalContent = fileBuffer;
      if (filePath.endsWith('.ts')) {
        console.log(`[TS] Transpiling ${filePath}`);
        const sourceCode = new TextDecoder().decode(fileBuffer);
        const transpiled = transpiler.transformSync(sourceCode);
        finalContent = new TextEncoder().encode(transpiled);
      }
      const mime = getMimeType(filePath);
      console.log(`[OK] ${filePath} -> ${mime}`);
      return new Response(finalContent, { headers: { 'Content-Type': mime } });
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      const tsResponse = await tryJsToTs();
      if (tsResponse) return tsResponse;
      console.log(`[404] ${filePath} not found`);
      return new Response('Not Found', { status: 404 });
    }
    console.error(`[ERR]`, err);
    return new Response('Internal Server Error', { status: 500 });
  }
}

serve({
  port: PORT,
  hostname: HOST,
  fetch: serveStatic,
});

console.log(`Server: http://${HOST}:${PORT}/`);
console.log(`Root: ${ROOT}`);