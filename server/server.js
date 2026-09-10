// server.js — Bun + HTTP/3
import { file, write } from "bun";
import { readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";

const isCompiled = (import.meta.dir || "").includes("$bunfs");
// ======================= Конфигурация =======================

function getAppDir() {
  if (isCompiled) return dirname(process.execPath);
  return resolve(import.meta.dir || process.cwd(), "..");
}

const SCRIPT_DIR = isCompiled
  ? dirname(process.execPath)
  : (import.meta.dir || process.cwd());

const APP_DIR = process.env.APP_ROOT
  ? resolve(process.env.APP_ROOT)
  : getAppDir();

const CLIENT_DIR = join(APP_DIR, "client");
const DATA_DIR = join(APP_DIR, "data");

const USERS_FILE = process.env.USERS_FILE
  ? resolve(process.env.USERS_FILE)
  : join(DATA_DIR, "users.json");

// Значения по умолчанию зависят от того, собран ли бинарник.
// Их всегда можно переопределить через переменные окружения.
const DEFAULTS = isCompiled
  ? {
      // prod: слушаем всё, привилегированные порты, сертификаты Let's Encrypt
      PORT: 443,
      HTTP_PORT: 80,
      HOST: "0.0.0.0",
      TLS_KEY: "/etc/letsencrypt/live/spiel.crabdance.com/privkey.pem",
      TLS_CERT: "/etc/letsencrypt/live/spiel.crabdance.com/fullchain.pem",
    }
  : {
      // dev: только локально, непривилегированные порты, самоподписанные
      PORT: 8443,
      HTTP_PORT: 8080,
      HOST: "localhost",
      TLS_KEY: join(SCRIPT_DIR, "localhost-key.pem"),
      TLS_CERT: join(SCRIPT_DIR, "localhost.pem"),
    };

const PORT = Number(process.env.PORT || DEFAULTS.PORT);
const HTTP_PORT = Number(process.env.HTTP_PORT || DEFAULTS.HTTP_PORT);
const HOST = process.env.HOST || DEFAULTS.HOST;

const TLS_KEY_PATH = process.env.TLS_KEY || DEFAULTS.TLS_KEY;
const TLS_CERT_PATH = process.env.TLS_CERT || DEFAULTS.TLS_CERT;

// ======================= Пользователи =======================

function loadUsers() {
  try {
    if (!existsSync(USERS_FILE)) return {};
    const data = readFileSync(USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveUsers(users) {
  write(USERS_FILE, JSON.stringify(users, null, 2));
}

// ======================= Лобби =======================

const lobbies = new Map();

const LOBBY_CODE_RE = /^[A-Z]{6}$/;
const EMPTY_LOBBY_TTL_MS = 5 * 60 * 1000;

function getLobbyNames(lobby) {
  return Array.from(lobby.participants.keys());
}

function broadcastLobby(lobby) {
  const payload = `data: ${JSON.stringify({ participants: getLobbyNames(lobby) })}\n\n`;
  for (const conns of lobby.participants.values()) {
    for (const controller of conns) {
      try {
        controller.enqueue(payload);
      } catch {
        // клиент уже отвалился — очистка произойдёт в cancel()
      }
    }
  }
}

function destroyLobby(code) {
  const lobby = lobbies.get(code);
  if (!lobby) return;
  if (lobby.reaper) clearTimeout(lobby.reaper);
  lobbies.delete(code);
}

// ======================= Сессии =======================

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 24 * 60 * 60; // секунды

// Простое подписание cookie через HMAC (встроено в Bun через crypto)
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-please";

async function signSession(data) {
  const json = JSON.stringify(data);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(json));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${btoa(json)}.${sigB64}`;
}

async function verifySession(token) {
  if (!token) return null;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;

  const json = atob(payloadB64);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sig = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sig,
    new TextEncoder().encode(json)
  );
  if (!valid) return null;
  return JSON.parse(json);
}

function getSession(req) {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  return verifySession(decodeURIComponent(match[1]));
}

async function sessionCookie(user, maxAge = SESSION_MAX_AGE) {
  const token = await signSession(user);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

// ======================= HTTP/3 + TLS =======================

const tls = {
  key: file(TLS_KEY_PATH),
  cert: file(TLS_CERT_PATH),
};

// ======================= Хелперы =======================

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

async function parseBody(req) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { return await req.json(); } catch { return {}; }
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    const obj = {};
    for (const [k, v] of params) obj[k] = v;
    return obj;
  }
  return {};
}

async function requireAuth(req) {
  const session = await getSession(req);
  if (!session || !session.user) return null;
  return session;
}

// ======================= Роутер =======================

async function handleRequest(req) {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  // ---------- Отдача статики из client/ ----------
  // Всё, что не начинается с /auth, /me, /logout, /lobby — статика
  const isApi =
	  pathname === "/auth" ||
	  pathname === "/me" ||
	  pathname === "/logout" ||
	  pathname === "/lobby" ||
	  /^\/lobby\/[A-Za-z0-9]+\/(join|events)$/.test(pathname);

  if (!isApi) {
    // Специальные маршруты для видео
    if (pathname === "/video.webm") {
      const f = file(join(DATA_DIR, "video.webm"));
      if (f.size === 0) return new Response("Not Found", { status: 404 });
      return new Response(f);
    }
    if (pathname === "/climbing.webm") {
      const f = file(join(DATA_DIR, "climbing.webm"));
      if (f.size === 0) return new Response("Not Found", { status: 404 });
      return new Response(f);
    }

    // Статика из client/
    const filePath = join(CLIENT_DIR, pathname === "/" ? "index.html" : pathname);
    const f = file(filePath);
    if (await f.exists()) {
      return new Response(f);
    }
    return new Response("Not Found", { status: 404 });
  }

  // ---------- POST /auth ----------
  if (method === "POST" && pathname === "/auth") {
    const body = await parseBody(req);
    const { username, password } = body;

    if (!username || !password) {
      return json({ error: "Заполните все поля" }, 400);
    }

    const users = loadUsers();

    if (users[username]) {
      const hash = users[username].passwordHash;
      const match = await Bun.password.verify(password, hash);
      if (match) {
        const sessionData = { user: { username } };
        return json(
          { success: true, user: { username } },
          200,
          { "Set-Cookie": await sessionCookie(sessionData) }
        );
      } else {
        return json({ error: "Неверный пароль" }, 401);
      }
    } else {
      const passwordHash = await Bun.password.hash(password, {
        algorithm: "bcrypt",
        cost: 10,
      });
      users[username] = { passwordHash };
      saveUsers(users);
      const sessionData = { user: { username } };
      return json(
        { success: true, user: { username } },
        200,
        { "Set-Cookie": await sessionCookie(sessionData) }
      );
    }
  }

  // ---------- GET /me ----------
  if (method === "GET" && pathname === "/me") {
    const session = await requireAuth(req);
    if (!session) return json({ error: "Не авторизован" }, 401);
    return json({ user: session.user });
  }

  // ---------- POST /logout ----------
  if (method === "POST" && pathname === "/logout") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": await sessionCookie(null, 0),
      },
    });
  }

  // ---------- POST /lobby ----------
  if (method === "POST" && pathname === "/lobby") {
    const session = await requireAuth(req);
    if (!session) return json({ error: "Не авторизован" }, 401);

    const body = await parseBody(req);
    const code = String(body.code || "").toUpperCase();

    if (!LOBBY_CODE_RE.test(code)) {
      return json(
        { error: "Код должен состоять из 6 заглавных латинских букв" },
        400
      );
    }
    if (lobbies.has(code)) {
      return json({ error: "Лобби с таким кодом уже существует" }, 409);
    }

    const lobby = {
      code,
      participants: new Map(),
      reaper: null,
    };

    lobby.reaper = setTimeout(() => {
      const l = lobbies.get(code);
      if (l && l.participants.size === 0) destroyLobby(code);
    }, EMPTY_LOBBY_TTL_MS);
    if (lobby.reaper.unref) lobby.reaper.unref();

    lobbies.set(code, lobby);
    return json({ success: true, code });
  }

  // ---------- POST /lobby/:code/join ----------
  const joinMatch = pathname.match(/^\/lobby\/([A-Za-z0-9]+)\/join$/);
  if (method === "POST" && joinMatch) {
    const session = await requireAuth(req);
    if (!session) return json({ error: "Не авторизован" }, 401);

    const code = joinMatch[1].toUpperCase();
    if (!LOBBY_CODE_RE.test(code)) {
      return json({ error: "Некорректный код лобби" }, 400);
    }
    if (!lobbies.has(code)) {
      return json({ error: "Лобби с таким кодом не найдено" }, 404);
    }
    return json({ success: true, code });
  }

  // ---------- GET /lobby/:code/events (SSE) ----------
  const eventsMatch = pathname.match(/^\/lobby\/([A-Za-z0-9]+)\/events$/);
  if (method === "GET" && eventsMatch) {
    const session = await requireAuth(req);
    if (!session) return json({ error: "Не авторизован" }, 401);

    const code = eventsMatch[1].toUpperCase();
    const lobby = lobbies.get(code);
    if (!lobby) {
      return json({ error: "Лобби не найдено" }, 404);
    }

    const username = session.user.username;

    // Отключаем idle-таймаут для этого запроса
    // (в Bun.serve это делается через server.timeout в routes,
    //  но мы используем fetch — см. примечание ниже)
    // В fetch-режиме Bun автоматически не рвёт долгие соединения,
    // если поток данных не пустует. Heartbeat раз в 25 с решает проблему.

    let controllerRef = null;

    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;

        // Регистрируем соединение
        let conns = lobby.participants.get(username);
        if (!conns) {
          conns = new Set();
          lobby.participants.set(username, conns);
        }
        conns.add(controller);

        // Снимаем reaper, если лобби было пустым
        if (lobby.reaper) {
          clearTimeout(lobby.reaper);
          lobby.reaper = null;
        }

        // Первое сообщение — текущий список
        broadcastLobby(lobby);

        // Heartbeat
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(": ping\n\n");
          } catch {
            clearInterval(heartbeat);
          }
        }, 25000);
        if (heartbeat.unref) heartbeat.unref();

        // Сохраняем heartbeat для очистки в cancel
        this._heartbeat = heartbeat;
      },

      cancel() {
        if (this._heartbeat) clearInterval(this._heartbeat);

        const set = lobby.participants.get(username);
        if (!set) return;
        set.delete(controllerRef);
        if (set.size === 0) lobby.participants.delete(username);

        if (lobby.participants.size === 0) {
          destroyLobby(code);
        } else {
          broadcastLobby(lobby);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ---------- 404 ----------
  return json({ error: "Not Found" }, 404);
}

// ======================= Запуск серверов =======================

// HTTPS + HTTP/3
const httpsServer = Bun.serve({
  port: PORT,
  hostname: HOST,
  tls,
  http3: true,    // включаем HTTP/3 (QUIC) на том же порту
  http2: true,
  http1: true,    // оставляем HTTP/1.1 для совместимости
  idleTimeout: 0,
  // http2 не поддерживается в Bun.serve (см. PR #30583)
  async fetch(req) {
    try {
      return await handleRequest(req);
    } catch (err) {
      console.error("Request error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
  error(err) {
    console.error("Server error:", err);
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log(`HTTPS/HTTP/3 сервер запущен на https://localhost:${PORT}`);
console.log(`HTTP/3 (QUIC) слушает UDP/${PORT}`);

// HTTP → HTTPS редирект
Bun.serve({
  port: HTTP_PORT,
  hostname: HOST,
  fetch(req) {
    const url = new URL(req.url);
    const host = (req.headers.get("host") || "").replace(/:\d+$/, "");
    const location = `https://${host}:${PORT}${url.pathname}${url.search}`;
    return new Response(null, {
      status: 301,
      headers: { Location: location },
    });
  },
});

console.log(`HTTP-редирект запущен на http://localhost:${HTTP_PORT}`);