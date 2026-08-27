// Zero-dependency static file server for the Vite build (dist/).
// Railway runs this via `npm start`; it listens on $PORT.
// The future online-lobby WebSocket backend is expected to attach to this
// same HTTP server, so keep it dependency-free and boring.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve("dist");
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".map": "application/json",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let path = normalize(decodeURIComponent(url.pathname));
    if (path === "/" || path === ".") path = "/index.html";

    // Path traversal guard: resolved path must stay inside dist/.
    let file = resolve(join(ROOT, path));
    if (!file.startsWith(ROOT + "/")) {
      return send(res, 403, "Forbidden", { "Content-Type": "text/plain" });
    }

    // SPA fallback: unknown paths serve the app shell.
    try {
      const info = await stat(file);
      if (info.isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(ROOT, "index.html");
    }

    const body = await readFile(file);
    const ext = extname(file).toLowerCase();
    // Vite fingerprints everything under assets/, so it can cache forever.
    const cache = file.includes("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache";
    send(res, 200, body, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": cache,
    });
  } catch (err) {
    send(res, 500, "Internal Server Error", { "Content-Type": "text/plain" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`beast-battler serving dist/ on :${PORT}`);
});
