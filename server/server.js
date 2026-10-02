// server.js — Bun + HTTP/3

/** @typedef {import('../shared/protocol').SseEvent} SseEvent */
/** @typedef {import('../shared/protocol').OrdersRequest} OrdersRequest */

import { file, write } from "bun";
import { readFileSync, existsSync, writeFileSync } from "fs";
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

const DEFAULTS = isCompiled
  ? {
      PORT: 443,
      HTTP_PORT: 80,
      HOST: "0.0.0.0",
      TLS_KEY: "/etc/letsencrypt/live/spiel.crabdance.com/privkey.pem",
      TLS_CERT: "/etc/letsencrypt/live/spiel.crabdance.com/fullchain.pem",
    }
  : {
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
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ======================= Лобби =======================

const lobbies = new Map();

const LOBBY_CODE_RE = /^[A-Z]{6}$/;
const EMPTY_LOBBY_TTL_MS = 5 * 60 * 1000;

function getLobbyNames(lobby) {
  return Array.from(lobby.participants.keys());
}

// -------- SSE helpers (типизированные события) -------- // ← НОВОЕ

/** Сериализует одно SseEvent в формат SSE. */
function sseFormat(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Является ли username членом лобби: либо открытый SSE, либо (после старта)
 *  закреплённая за ним страна. */
function isLobbyMember(lobby, username) {
  if (lobby.participants.has(username)) return true;
  if (lobby.started) {
    for (const u of lobby.playersByCountryIdx.values()) {
      if (u === username) return true;
    }
  }
  return false;
}

/** Шлёт событие всем участникам лобби. */
function sendEvent(lobby, event) {
  const payload = sseFormat(event);
  for (const conns of lobby.participants.values()) {
    for (const controller of conns) {
      try { controller.enqueue(payload); } catch { /* клиент уже отвалился */ }
    }
  }
}

/** Шлёт событие одному пользователю (всем его соединениям). */
function sendEventToUser(lobby, username, event) {
  const conns = lobby.participants.get(username);
  if (!conns) return;
  const payload = sseFormat(event);
  for (const controller of conns) {
    try { controller.enqueue(payload); } catch { /* клиент уже отвалился */ }
  }
}

/** Персонализированная рассылка: eventFactory(username) → SseEvent. */
function sendPersonalized(lobby, eventFactory) {
  for (const [username, conns] of lobby.participants) {
    const payload = sseFormat(eventFactory(username));
    for (const controller of conns) {
      try { controller.enqueue(payload); } catch { /* клиент уже отвалился */ }
    }
  }
}

/** Обновление состава участников + текущей версии карты. */
function broadcastLobby(lobby) {
  sendEvent(lobby, {
    type: 'participants',
    participants: getLobbyNames(lobby),
    host: lobby.host,
    afk: [...lobby.afk],
  });
  sendEvent(lobby, {
    type: 'mapVersion',
    version: lobby.mapVersion,
  });
  sendEvent(lobby, {
    type: 'countries',
    countries: Array.from(lobby.countriesByUser),   // ← было Object.fromEntries
  });
}

function broadcastCountries(lobby) {
  sendEvent(lobby, {
    type: 'countries',
    countries: Array.from(lobby.countriesByUser),   // ← было Object.fromEntries
  });
}

/** Центральная проверка «все готовы». AFK-игроки не блокируют. */
function checkAllReady(lobby) {
  if (!lobby.started || lobby.resolving || lobby.gameOver) return;
  if (lobby.participants.size === 0) return;
  for (const username of lobby.participants.keys()) {
    if (lobby.afk.has(username)) continue;
    if (lobby.ready.has(username)) continue;
    return;
  }
  lobby.resolving = true;
  const allReadyEvent = { type: 'allReady', turn: lobby.currentTurn + 1 };
  if (lobby.host) {
    sendEventToUser(lobby, lobby.host, allReadyEvent);
  } else {
    sendEvent(lobby, allReadyEvent);
  }
}

function destroyLobby(code) {
  const lobby = lobbies.get(code);
  if (!lobby) return;
  if (lobby.reaper) clearTimeout(lobby.reaper);
  lobbies.delete(code);
}

// -------- Валидация SerializedGameState (этап 4.4) -------- // ← НОВОЕ

function looksLikeState(s) {
  return s && typeof s.turn === 'number'
    && Array.isArray(s.tiles) && Array.isArray(s.countries)
    && s.tiles.length === s.tilescount
    && s.countries.length === s.countriescount;
}

// ======================= Сессии =======================

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 365 * 24 * 60 * 60;

const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-please";

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

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
  return `${b64encode(json)}.${sigB64}`;
}

async function verifySession(token) {
  if (!token) return null;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;

  const json = b64decode(payloadB64);
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

async function getSession(req) {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  return verifySession(decodeURIComponent(match[1]));
}

const SECURE_COOKIE = isCompiled || process.env.NODE_ENV === "production";

async function sessionCookie(user, maxAge = SESSION_MAX_AGE) {
  const secure = SECURE_COOKIE ? "; Secure" : "";
  if (user === null) {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  }
  const token = await signSession(user);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
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
  const isApi =
	  pathname === "/auth" ||
	  pathname === "/me" ||
	  pathname === "/logout" ||
	  pathname === "/lobby" ||
	  /^\/lobby\/[A-Za-z0-9]+\/(join|events|map|start|state|orders|country|whoami|afk)$/.test(pathname);
	  
  if (!isApi) {
    if (pathname === "/video.webm") {
	  const f = file(join(DATA_DIR, "video.webm"));
	  if (!(await f.exists())) return new Response("Not Found", { status: 404 });
	  return new Response(f, {
		headers: { "Cache-Control": "public, max-age=31536000, immutable" },
	  });
	}
	if (pathname === "/climbing.webm") {
	  const f = file(join(DATA_DIR, "climbing.webm"));
	  if (!(await f.exists())) return new Response("Not Found", { status: 404 });
	  return new Response(f, {
		headers: { "Cache-Control": "public, max-age=31536000, immutable" },
	  });
	}

    const filePath = resolve(CLIENT_DIR, pathname === "/" ? "index.html" : "." + pathname);
	if (!filePath.startsWith(CLIENT_DIR + "/") && filePath !== join(CLIENT_DIR, "index.html")) {
	  return new Response("Not Found", { status: 404 });
	}
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
		  return json(
			{ success: true, user: { username } },
			200,
			{ "Set-Cookie": await sessionCookie({ user: { username } }) }
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
	return json(
	  { success: true, user: { username } },
	  200,
	  { "Set-Cookie": await sessionCookie({ user: { username } }) }
	);
    }
  }

  // ---------- GET /me ----------
if (method === "GET" && pathname === "/me") {
	const session = await requireAuth(req);
	if (!session) 
		return json({ error: "Не авторизован" }, 401);
	return json(
		{ user: session.user },
		200,
		{ "Set-Cookie": await sessionCookie(session) }
	);
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
	  mapBuffer: null,
	  mapVersion: 0,

	  host: null,
	  started: false,
	  history: [],
	  currentTurn: 0,
	  ordersByUser: new Map(),
	  ready: new Set(),
	  resolving: false,
	  gameOver: false,

	  countriesByUser: new Map(),
	  playersByCountryIdx: new Map(),
	  afk: new Set(),
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

// ---------- POST /lobby/:code/map — загрузка карты ----------
const mapMatch = pathname.match(/^\/lobby\/([A-Za-z0-9]+)\/map$/);
if (method === "POST" && mapMatch) {
  const session = await requireAuth(req);
  if (!session) return json({ error: "Не авторизован" }, 401);

  const code = mapMatch[1].toUpperCase();
  if (!LOBBY_CODE_RE.test(code)) {
    return json({ error: "Некорректный код лобби" }, 400);
  }
  const lobby = lobbies.get(code);
  if (!lobby) return json({ error: "Лобби не найдено" }, 404);

  const MAX_MAP_BYTES = 20 * 1024 * 1024;
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared && declared > MAX_MAP_BYTES) {
    return json({ error: "Файл слишком большой" }, 413);
  }

  let buf;
  try {
    buf = new Uint8Array(await req.arrayBuffer());
  } catch {
    return json({ error: "Не удалось прочитать тело запроса" }, 400);
  }
  if (buf.byteLength === 0) {
    return json({ error: "Пустой файл" }, 400);
  }
  if (buf.byteLength > MAX_MAP_BYTES) {
    return json({ error: "Файл слишком большой" }, 413);
  }

  lobby.mapBuffer = buf;
  lobby.mapVersion += 1;
  broadcastLobby(lobby);

  return json({ success: true, version: lobby.mapVersion });
}

// ---------- GET /lobby/:code/map — скачивание карты ----------
if (method === "GET" && mapMatch) {
  const session = await requireAuth(req);
  if (!session) return json({ error: "Не авторизован" }, 401);

  const code = mapMatch[1].toUpperCase();
  const lobby = lobbies.get(code);
  if (!lobby) return json({ error: "Лобби не найдено" }, 404);
  if (!lobby.mapBuffer) {
    return json({ error: "Карта ещё не загружена" }, 404);
  }

  return new Response(lobby.mapBuffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(lobby.mapBuffer.byteLength),
      "Cache-Control": "private, max-age=86400",
      "X-Map-Version": String(lobby.mapVersion),
    },
  });
}

// ---------- POST /lobby/:code/country — выбор страны ---------- // ← НОВОЕ
const countryMatch = pathname.match(/^\/lobby\/([A-Za-z0-9]+)\/country$/);
if (method === "POST" && countryMatch) {
  const session = await requireAuth(req);
  if (!session) return json({ error: "Не авторизован" }, 401);

  const code = countryMatch[1].toUpperCase();
  const lobby = lobbies.get(code);
  if (!lobby) return json({ error: "Лобби не найдено" }, 404);

  const username = session.user.username;
  if (!lobby.participants.has(username)) {
    return json({ error: "Вы не участник этого лобби" }, 403);
  }
  if (lobby.started) return json({ error: "Игра уже началась" }, 409);
  if (lobby.gameOver) return json({ error: "Игра завершена" }, 409);

  const body = await parseBody(req);
  const raw = body.tileId;

  // tileId === null / undefined → снять выбор
  if (raw === null || raw === undefined) {
    lobby.countriesByUser.delete(username);
    broadcastCountries(lobby);
    return json({ success: true, tileId: null });
  }

  const tileId = Number(raw);
  if (!Number.isInteger(tileId) || tileId < 0) {
    return json({ error: "Некорректный tileId" }, 400);
  }

  // Проверка уникальности (сервер не знает info.colors.length — клиент
  // может прислать out-of-range tileId; это отсеют другие клиенты при
  // рендере. Валидацию диапазона сервер не делает — карта ему не парсится).
  for (const [u, t] of lobby.countriesByUser) {
    if (u !== username && t === tileId) {
      return json({ error: "Эта страна уже выбрана другим игроком" }, 409);
    }
  }

  lobby.countriesByUser.set(username, tileId);
  broadcastCountries(lobby);
  return json({ success: true, tileId });
}


// ---------- POST /lobby/:code/start — старт игры ---------- // ← НОВОЕ
// ---------- POST /lobby/:code/start ----------
const startMatch = pathname.match(/^\/lobby\/([A-Za-z0-9]+)\/start$/);
if (method === "POST" && startMatch) {
  const session = await requireAuth(req);
  if (!session) return json({ error: "Не авторизован" }, 401);

  const code = startMatch[1].toUpperCase();
  const lobby = lobbies.get(code);
  if (!lobby) return json({ error: "Лобби не найдено" }, 404);

  const username = session.user.username;
  if (!lobby.participants.has(username)) {
    return json({ error: "Вы не участник этого лобби" }, 403);
  }
  if (lobby.host !== username) {
    return json({ error: "Только хост может начать игру" }, 403);
  }
  if (lobby.started) return json({ error: "Игра уже началась" }, 409);
  if (lobby.gameOver) return json({ error: "Игра завершена" }, 409);
  if (!lobby.mapBuffer) {
    return json({ error: "Карта ещё не загружена" }, 409);
  }

  const body = await parseBody(req);
  const state = body.state;
  if (!looksLikeState(state) || typeof state.turn !== "number") {
    return json({ error: "Некорректное начальное состояние" }, 400);
  }
  if (state.turn !== 0) {
    return json({ error: "Начальное состояние должно иметь turn=0" }, 400);
  }

  // Детерминированный порядок стран: сортировка по username.
  // Тот же порядок клиент-хост использует при построении capitals[].
  const selected = [...lobby.countriesByUser.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([u]) => u);

  if (selected.length !== state.countries.length) {
    return json({
      error: `Выбрано стран ${selected.length}, а в состоянии ${state.countries.length}`,
    }, 400);
  }

  lobby.playersByCountryIdx.clear();
  for (let i = 0; i < selected.length; i++) {
    lobby.playersByCountryIdx.set(i, selected[i]);
  }

  lobby.started = true;
  lobby.history = [state];
  lobby.currentTurn = 0;
  lobby.ordersByUser.clear();
  lobby.ready.clear();
  lobby.resolving = false;

  // Персональная рассылка gameStart
  for (const [uname, conns] of lobby.participants) {
    const event = {
      type: "gameStart",
      turn: 0,
      youAreHost: uname === lobby.host,
    };
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of conns) {
      try { c.enqueue(payload); } catch { /* отвалился */ }
    }
  }

  return json({ success: true, turn: 0 });
}

// ---------- /lobby/:code/state — GET/POST состояния ----------
const stateMatch = pathname.match(/^\/lobby\/([A-Za-z0-9]+)\/state$/);

if (method === "GET" && stateMatch) {
  const session = await requireAuth(req);
  if (!session) return json({ error: "Не авторизован" }, 401);

  const code = stateMatch[1].toUpperCase();
  const lobby = lobbies.get(code);
  if (!lobby) return json({ error: "Лобби не найдено" }, 404);

  const username = session.user.username;
  if (!isLobbyMember(lobby, username)) {
    return json({ error: "Вы не участник этого лобби" }, 403);
  }

  const turnParam = url.searchParams.get("turn");
  if (turnParam !== null) {
    const n = Number(turnParam);
    if (!Number.isInteger(n) || n < 1) {
      return json({ error: "Некорректный параметр turn" }, 400);
    }
    const s = lobby.history[n - 1];
    if (!s) return json({ error: "Состояние не найдено" }, 404);
    return json(s);
  }

  const latest = lobby.history[lobby.history.length - 1];
  if (!latest) return json({ error: "Состояние недоступно" }, 404);
  return json(latest);
}

if (method === "POST" && stateMatch) {
  const session = await requireAuth(req);
  if (!session) return json({ error: "Не авторизован" }, 401);

  const code = stateMatch[1].toUpperCase();
  const lobby = lobbies.get(code);
  if (!lobby) return json({ error: "Лобби не найдено" }, 404);

  const username = session.user.username;
  if (lobby.host !== username) {
    return json({ error: "Только хост может отправлять состояние" }, 403);
  }
  if (!lobby.started) {
    return json({ error: "Игра ещё не началась" }, 409);
  }
  if (lobby.gameOver) {
    return json({ error: "Игра завершена" }, 409);
  }

  const MAX_STATE_BYTES = 50 * 1024 * 1024;
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared && declared > MAX_STATE_BYTES) {
    return json({ error: "Состояние слишком большое" }, 413);
  }

  const body = await parseBody(req);
  const state = body.state;
  if (!looksLikeState(state)) {
    return json({ error: "Некорректное состояние" }, 400);
  }
  if (state.turn !== lobby.currentTurn + 1) {
    return json({
      error: `Ожидался turn=${lobby.currentTurn + 1}, получен ${state.turn}`,
    }, 409);
  }

  lobby.history.push(state);
  lobby.currentTurn = lobby.history.length;
  lobby.ordersByUser.clear();
  lobby.ready.clear();
  lobby.resolving = false;
  if (body.gameOver === true) lobby.gameOver = true;

  sendEvent(lobby, {
    type: 'turnResult',
    turn: lobby.currentTurn,
    state,
  });
  sendEvent(lobby, {
    type: 'turnStarted',
    turn: lobby.currentTurn,
  });

  return json({ success: true, turn: lobby.currentTurn });
}

// ---------- POST /lobby/:code/orders — приказы игрока ---------- // ← НОВОЕ
const ordersMatch = pathname.match(/^\/lobby\/([A-Za-z0-9]+)\/orders$/);
if (method === "POST" && ordersMatch) {
  const session = await requireAuth(req);
  if (!session) return json({ error: "Не авторизован" }, 401);

  const code = ordersMatch[1].toUpperCase();
  const lobby = lobbies.get(code);
  if (!lobby) return json({ error: "Лобби не найдено" }, 404);

  const username = session.user.username;
  if (!isLobbyMember(lobby, username)) {
    return json({ error: "Вы не участник этого лобби" }, 403);
  }
  if (!lobby.started) {
    return json({ error: "Игра ещё не началась" }, 409);
  }
  if (lobby.gameOver) {
    return json({ error: "Игра завершена" }, 409);
  }
  if (lobby.resolving) {
    return json({ error: "Ход уже разрешается" }, 409);
  }

  const body = await parseBody(req);
  const orders = Array.isArray(body.orders) ? body.orders : [];
  const ready = body.ready === true;

  lobby.ordersByUser.set(username, orders);
  if (ready) lobby.ready.add(username);
  else lobby.ready.delete(username);

  sendEvent(lobby, {
    type: 'ordersBatch',
    from: username,
    orders,
    ready,
  });

  checkAllReady(lobby);

  return json({ success: true, ready: lobby.ready.size });
}

// ---------- POST /lobby/:code/afk — переключение AFK ---------- // ← НОВОЕ (7.1)
const afkMatch = pathname.match(/^\/lobby\/([A-Za-z0-9]+)\/afk$/);
if (method === "POST" && afkMatch) {
  const session = await requireAuth(req);
  if (!session) return json({ error: "Не авторизован" }, 401);

  const code = afkMatch[1].toUpperCase();
  const lobby = lobbies.get(code);
  if (!lobby) return json({ error: "Лобби не найдено" }, 404);

  const username = session.user.username;
  if (!lobby.participants.has(username)) {
    return json({ error: "Вы не участник этого лобби" }, 403);
  }
  if (!lobby.started) {
    return json({ error: "Игра ещё не началась" }, 409);
  }
  if (lobby.resolving) {
    return json({ error: "Ход уже разрешается" }, 409);
  }
  if (lobby.gameOver) {
    return json({ error: "Игра завершена" }, 409);
  }

  const body = await parseBody(req);
  const wantAfk = body.afk === true;
  if (wantAfk) lobby.afk.add(username);
  else         lobby.afk.delete(username);

  broadcastLobby(lobby);
  checkAllReady(lobby);

  return json({ success: true, afk: wantAfk });
}

// ---------- GET /lobby/:code/whoami ----------
const whoamiMatch = pathname.match(/^\/lobby\/([A-Za-z0-9]+)\/whoami$/);
if (method === "GET" && whoamiMatch) {
  const session = await requireAuth(req);
  if (!session) return json({ error: "Не авторизован" }, 401);

  const code = whoamiMatch[1].toUpperCase();
  const lobby = lobbies.get(code);
  if (!lobby) return json({ error: "Лобби не найдено" }, 404);

  const username = session.user.username;
  if (!isLobbyMember(lobby, username)) {
    return json({ error: "Вы не участник этого лобби" }, 403);
  }

  let yourCountryIdx = null;
  for (const [idx, u] of lobby.playersByCountryIdx) {
    if (u === username) { yourCountryIdx = idx; break; }
  }

  return json({
    youAreHost: lobby.host === username,
    yourCountryIdx,
  });
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

    let controllerRef = null;

    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;

        let conns = lobby.participants.get(username);
        if (!conns) {
          conns = new Set();
          lobby.participants.set(username, conns);
        }
        conns.add(controller);

        // ← НОВОЕ: первый подключившийся становится хостом
        if (!lobby.host) {
          lobby.host = username;
        }

        if (lobby.reaper) {
          clearTimeout(lobby.reaper);
          lobby.reaper = null;
        }

        broadcastLobby(lobby);
		checkAllReady(lobby);

        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(": ping\n\n");
          } catch {
            clearInterval(heartbeat);
          }
        }, 25000);
        if (heartbeat.unref) heartbeat.unref();

        this._heartbeat = heartbeat;
      },

      cancel() {
        if (this._heartbeat) clearInterval(this._heartbeat);

        const set = lobby.participants.get(username);
        if (!set) return;
        set.delete(controllerRef);

        // Пока у пользователя есть другие открытые соединения — он ещё в лобби.
        if (set.size > 0) return;
        lobby.participants.delete(username);

        // ← НОВОЕ: освобождаем страну ушедшего игрока, чтобы её мог
        // выбрать кто-то другой (до старта игры).
        lobby.countriesByUser.delete(username);

        // ← hostChanged: отдельное событие, не только через participants
        if (lobby.host === username && !lobby.gameOver && !lobby.started) {
		  const remaining = [...lobby.participants.keys()];
		  lobby.host = remaining[0] ?? null;
		  sendEvent(lobby, { type: 'hostChanged', host: lobby.host });
		}

        if (lobby.participants.size === 0) {
          // Игра началась — не убиваем лобби сразу,
          // даём TTL на переподключение.
          if (lobby.started && !lobby.gameOver) {
            if (!lobby.reaper) {
              lobby.reaper = setTimeout(() => {
                const l = lobbies.get(code);
                if (l && l.participants.size === 0) destroyLobby(code);
              }, EMPTY_LOBBY_TTL_MS);
              if (lobby.reaper.unref) lobby.reaper.unref();
            }
          } else {
            destroyLobby(code);
          }
          return;
        }

        // broadcastLobby включает `countries` — клиент увидит,
        // что страна освободилась.
        broadcastLobby(lobby);
		checkAllReady(lobby);
      },
	  
	  
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ---------- 404 ----------
  return json({ error: "Not Found" }, 404);
}

// ======================= Запуск серверов =======================

const httpsServer = Bun.serve({
  port: PORT,
  hostname: HOST,
  tls,
  http3: true,
  http2: true,
  http1: true,
  idleTimeout: 0,
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