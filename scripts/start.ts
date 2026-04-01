import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/* ---------------- args ---------------- */

type ParsedArgs = {
  host?: string | undefined;
  port?: string | undefined;
  watch: boolean;
  noClearScreen: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { watch: false, noClearScreen: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--watch") out.watch = true;
    else if (a === "--no-clear-screen") out.noClearScreen = true;
    else if (a === "--host") out.host = argv[++i];
    else if (a === "--port") out.port = argv[++i];
  }
  return out;
}

/* ---------------- platform ---------------- */

const isWindows = () => process.platform === "win32";

function killPortWindows(port: number) {
  const r = spawnSync("cmd.exe", ["/c", `netstat -ano | findstr :${port}`], { encoding: "utf8" });
  const pids = new Set<string>();

  (r.stdout || "").split(/\r?\n/).forEach(line => {
    const pid = line.trim().split(/\s+/).at(-1);
    if (pid && /^\d+$/.test(pid)) pids.add(pid);
  });

  pids.forEach(pid => {
    spawnSync("taskkill", ["/PID", pid, "/T", "/F"]);
  });
}

function killPortUnix(port: number) {
  const r = spawnSync("sh", ["-lc", `lsof -tiTCP:${port} -sTCP:LISTEN`], { encoding: "utf8" });
  const pids = r.stdout.trim().split(/\s+/).filter(Boolean);
  if (!pids.length) return;
  spawnSync("sh", ["-lc", `kill ${pids.join(" ")}`]);
}

/* ---------------- fs utils ---------------- */

const safeExists = (p: string) => {
  try { return fs.existsSync(p); } catch { return false; }
};

const isFile = (p: string) => safeExists(p) && fs.statSync(p).isFile();
const isDir = (p: string) => safeExists(p) && fs.statSync(p).isDirectory();

/* ---------------- transpile ---------------- */

const transpilerTs = new Bun.Transpiler({ loader: "ts", target: "browser" });
const transpilerTsx = new Bun.Transpiler({ loader: "tsx", target: "browser" });

function transformTs(filePath: string) {
  const ext = path.extname(filePath);
  const source = fs.readFileSync(filePath, "utf8");

  const rewritten = source.replace(
    /import\s+([a-zA-Z_$][\w$]*)\s+from\s+(['"])([^'"]+\.(svg|png|jpg|jpeg|gif|webp))\2/g,
    (_, name, q, p) => {
      if (p.startsWith("./") || p.startsWith("../")) {
        return `const ${name} = new URL(${q}${p}${q}, import.meta.url).href`;
      }
      return _;
    }
  );

  const t = ext === ".tsx" ? transpilerTsx : transpilerTs;
  return t.transformSync(rewritten);
}

/* ---------------- asset loaders ---------------- */
const assetLoaders: Record<string, (c: string) => { body: string; type: string }> = {
  ".json": c => ({
    body: `export default ${c};`,
    type: "text/javascript"
  }),
  ".txt": (c: string) => ({
    body: `export default ${JSON.stringify(c)};`,
    type: "text/javascript"
  }),
  ".md": (c: string) => ({
    body: `export default ${JSON.stringify(c)};`,
    type: "text/javascript"
  }),
};

/* ---------------- response ---------------- */
function createResponse(filePath: string): Response {
  const ext = path.extname(filePath).toLowerCase();

  if ([".ts", ".tsx", ".mts", ".cts"].includes(ext)) {
    return new Response(transformTs(filePath), {
      headers: { "content-type": "text/javascript" }
    });
  }

  if (assetLoaders[ext]) {
    const content = fs.readFileSync(filePath, "utf8");
    const { body, type } = assetLoaders[ext](content);
    return new Response(body, {
      headers: { "content-type": type }
    });
  }

  return new Response(Bun.file(filePath));
}

/* ---------------- resolver ---------------- */

// Support access to directory
const PUBLIC_DIRS = [
  "src",
  "shared",
  "status",
  "research-data",
  "corpora",
  "benchmarks",
  "accuracy"
];

// Unified handling of non-pages folders
function resolvePublicDirs(pathname: string) {
  for (const dir of PUBLIC_DIRS) {
    if (pathname.startsWith(`/${dir}/`)) {
      let abs = path.join(process.cwd(), pathname.slice(1));
      if (abs.endsWith(".js") && !isFile(abs)) {
        const ts = abs.replace(/\.js$/, ".ts");
        if (isFile(ts)) abs = ts;
      }
      return isFile(abs) ? abs : null;
    }
  }
  return null;
}

function resolvePages(pagesDir: string, pathname: string) {
  const clean = pathname.replace(/^\/+/, "");

  const tryPaths = [
    clean,
    clean + ".html",
    path.join(clean, "index.html")
  ];

  for (const p of tryPaths) {
    const abs = path.join(pagesDir, p);
    if (isFile(abs)) return abs;
  }

  return null;
}

function resolveFile(pagesDir: string, pathname: string) {
  return (
    resolvePublicDirs(pathname) ||
    resolvePages(pagesDir, pathname)
  );
}

/* ---------------- routes print ---------------- */
type Entry = { route: string; fileAbs: string };

function fileToRouteEntries(rootPagesDirAbs: string) {
  const entries: Entry[] = [];

  const readDirSafe = (dir: string) =>
    safeExists(dir) ? fs.readdirSync(dir) : [];

  const stripHtml = (name: string) =>
    name.slice(0, -".html".length);

  for (const name of readDirSafe(rootPagesDirAbs)) {
    if (!name.endsWith(".html")) continue;
    const abs = path.join(rootPagesDirAbs, name);
    if (!isFile(abs)) continue;

    entries.push({ route: `/${stripHtml(name)}`, fileAbs: abs });
  }

  const demosDir = path.join(rootPagesDirAbs, "demos");
  if (!isDir(demosDir)) return entries;

  for (const name of readDirSafe(demosDir)) {
    const abs = path.join(demosDir, name);

    if (name === "index.html" && isFile(abs)) {
      entries.push({ route: `/demos/`, fileAbs: abs });
      continue;
    }

    if (name.endsWith(".html") && isFile(abs)) {
      entries.push({
        route: `/demos/${stripHtml(name)}`,
        fileAbs: abs
      });
      continue;
    }

    if (isDir(abs)) {
      const idx = path.join(abs, "index.html");
      if (isFile(idx)) {
        entries.push({
          route: `/demos/${name}/`,
          fileAbs: idx
        });
      }
    }
  }

  return entries.sort((a, b) => a.route.localeCompare(b.route));
}

function printRoutes(routeEntries: { route: string; fileAbs: string }[]) {
  if (!routeEntries.length) return;

  const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;
  const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

  console.log(bold("Routes:"));

  routeEntries.forEach((e, i) => {
    const relFile = path.relative(process.cwd(), e.fileAbs).split(path.sep).join("\\");
    const prefix = i === routeEntries.length - 1 ? "└── " : "├── ";

    console.log(`  ${prefix}${blue(e.route)} ${gray("→ " + relFile)}`);
  });

  console.log();
}

function getrediRectRoute(pathname: string, routeEntries: Entry[]) {
  const redirectPath = `${pathname}/`; 
  return routeEntries.find((e) => e.route === redirectPath); 
}

/* ---------------- start ---------------- */

const args = parseArgs(process.argv.slice(2));
const host = args.host ?? "127.0.0.1";
const port = Number(args.port ?? 3000);

if (!Number.isFinite(port)) process.exit(1);

try {
  isWindows() ? killPortWindows(port) : killPortUnix(port);
} catch {}

if (!process.versions?.bun) {
  console.error("Please run using bun");
  process.exit(1);
}

const pagesDir = path.join(process.cwd(), "pages");
if (!safeExists(pagesDir)) {
  console.error("Missing pages directory");
  process.exit(1);
}

const routeEntries = fileToRouteEntries(pagesDir)
printRoutes(routeEntries);

const server = Bun.serve({
  hostname: host,
  port,
  fetch(req) {
    const pathname = new URL(req.url).pathname;
    const redirectRoute = getrediRectRoute(pathname, routeEntries)
    // Redirect demos -> demos/ | demos/masonry -> demos/masonry/ 
    if (redirectRoute) { return Response.redirect(redirectRoute.route, 301); }
    const filePath = resolveFile(pagesDir, pathname);
    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }

    return createResponse(filePath);
  },
});

console.log(`http://${server.hostname}:${server.port}/accuracy`);