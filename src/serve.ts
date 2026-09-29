import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

// Deliberately only serves generated artifacts, never source files or .env.
const { values } = parseArgs({ options: { port: { type: "string", default: "3000" }, dir: { type: "string", default: "reports" } } });
const root = resolve(values.dir);
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid --port");
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8" };
const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    if (pathname.split("/").some((part) => part.startsWith("."))) throw new Error("Hidden path");
    let path = resolve(root, `.${pathname}`);
    if (path !== root && !path.startsWith(root + sep)) throw new Error("Outside report directory");
    if ((await stat(path)).isDirectory()) {
      if (!pathname.endsWith("/")) {
        response.writeHead(301, { Location: pathname.replace(/^\/+/, "/") + "/" }).end();
        return;
      }
      path = join(path, "index.html");
    }
    const [canonicalRoot, canonicalPath] = await Promise.all([realpath(root), realpath(path)]);
    if (!canonicalPath.startsWith(canonicalRoot + sep) || !mime[extname(path)]) throw new Error("Not a report");
    const content = await readFile(canonicalPath);
    response.writeHead(200, { "Content-Type": mime[extname(path)]!, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : "Report not found. Run npm run experiment -- maze first.\n");
  }
});
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.log(`Notebook: http://127.0.0.1:${port}`));
