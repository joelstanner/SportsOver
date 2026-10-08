import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_SPORTS, updateCatalogs } from "./team-catalog.mjs";

import providerNetwork from "../core/provider-network.js";
const fetchProvider = providerNetwork.create();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || 8080);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function refreshCatalog(request, response) {
  try {
    const { sport = "all", enabledSports } = await requestBody(request);
    if (sport !== "all" && !SUPPORTED_SPORTS.includes(sport)) return json(response, 400, { error: `Unsupported sport: ${sport}` });
    return json(response, 200, { results: await updateCatalogs(sport, root, fetchProvider,
      key => !Array.isArray(enabledSports) || enabledSports.includes(key)) });
  } catch (error) {
    return json(response, 500, { error: error.message });
  }
}

async function staticFile(request, response, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (_error) {
    response.writeHead(400).end("Bad request");
    return;
  }
  const relative = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const path = resolve(root, `.${relative}`);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": contentTypes.get(extname(path)) || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-cache",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(path).pipe(response);
  } catch (_error) {
    response.writeHead(404).end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const f1 = /^\/api\/formula-1\/results\/([1-9]\d{0,11})$/.exec(url.pathname);
  if (request.method === "GET" && f1) {
    try {
      const upstream = await fetchProvider(`https://www.espn.com/f1/results/_/id/${f1[1]}?_xhr=pageContent`);
      const retry = upstream.headers.get("Retry-After");
      response.writeHead(upstream.status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...(retry ? { "Retry-After": retry } : {}) });
      return response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (_) { return json(response, 502, { error: "Formula 1 timing unavailable" }); }
  }
  if (request.method === "POST" && url.pathname === "/api/team-catalog/refresh") return refreshCatalog(request, response);
  if (request.method === "GET" || request.method === "HEAD") return staticFile(request, response, url);
  response.writeHead(405, { Allow: "GET, HEAD, POST" }).end("Method not allowed");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Sports overlay: http://127.0.0.1:${port}`);
  console.log(`Control room: http://127.0.0.1:${port}/admin/`);
});
