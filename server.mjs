// Static file server for the Vite build (dist/) plus the online-play socket.
// Railway runs this via `npm start`; it listens on $PORT.

import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const { RoomManager } = require("./dist/server/server/room-manager.js");

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

const rooms = new RoomManager();
const webSockets = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    webSockets.emit("connection", webSocket);
  });
});

webSockets.on("connection", (webSocket) => {
  let token = null;
  const connection = {
    send(message) {
      if (webSocket.readyState === webSocket.OPEN) {
        webSocket.send(JSON.stringify(message));
      }
    },
  };

  webSocket.on("message", (payload) => {
    const message = parseClientMessage(payload.toString());
    if (!message) {
      connection.send({ type: "error", code: "invalid_message", message: "That message is not part of the Beast Battler protocol." });
      return;
    }
    if (!token) {
      if (message.type !== "hello") {
        connection.send({ type: "error", code: "hello_required", message: "Send hello before other messages." });
        return;
      }
      token = rooms.connect(connection, message) || null;
      return;
    }
    if (message.type === "hello") {
      connection.send({ type: "error", code: "already_connected", message: "This socket is already connected." });
      return;
    }
    rooms.receive(token, message);
  });

  webSocket.on("close", () => {
    if (token) rooms.disconnect(token, connection);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`beast-battler serving dist/ on :${PORT}`);
});

function parseClientMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!message || typeof message !== "object" || typeof message.type !== "string") return null;
  switch (message.type) {
    case "hello":
      return message.version === 1 && optionalString(message.displayName) && optionalString(message.reconnectToken)
        ? message
        : null;
    case "lobby.list":
    case "match.rematch":
    case "match.leave":
      return message;
    case "lobby.create":
      return typeof message.name === "string" && typeof message.archetype === "string" ? message : null;
    case "lobby.join":
      return typeof message.matchId === "string" && typeof message.archetype === "string" ? message : null;
    case "match.intent":
      return isIntent(message.intent) ? message : null;
    default:
      return null;
  }
}

function optionalString(value) {
  return value === undefined || typeof value === "string";
}

function isIntent(intent) {
  if (!intent || typeof intent !== "object" || typeof intent.kind !== "string") return false;
  switch (intent.kind) {
    case "keep-hand":
    case "mulligan":
    case "advance-phase":
    case "pass-response":
    case "hold-attack":
      return true;
    case "play-land":
    case "summon":
      return typeof intent.cardId === "string";
    case "cast-spell":
      return typeof intent.cardId === "string" && typeof intent.payWith === "string" && isTarget(intent.target);
    case "counterspell":
      return typeof intent.cardId === "string" && typeof intent.targetStackId === "string" && typeof intent.payWith === "string";
    case "fuse":
      return Array.isArray(intent.parentIds) && intent.parentIds.length === 2 && intent.parentIds.every((id) => typeof id === "string");
    case "upgrade-fusion":
      return typeof intent.fusionCardId === "string" && typeof intent.baseMonsterCardId === "string";
    case "declare-attackers":
    case "discard":
      return Array.isArray(intent.attackerIds ?? intent.cardIds) && (intent.attackerIds ?? intent.cardIds).every((id) => typeof id === "string");
    case "assign-blockers":
      return Array.isArray(intent.blocks) && intent.blocks.every((block) => block && typeof block.attackerId === "string" && typeof block.blockerId === "string");
    default:
      return false;
  }
}

function isTarget(target) {
  return target === null || (target && typeof target === "object" && (
    (target.kind === "player" && typeof target.playerId === "string") ||
    (target.kind === "monster" && typeof target.playerId === "string" && typeof target.monsterId === "string")
  ));
}
