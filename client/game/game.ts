// client/game/game.ts
import { MapView } from '../shared/mapview';
import {
    fromJSON,
    ordersToJSON,
    type GameState,
    type Order,
} from '../../shared/game';
import type { SseEvent, WhoamiResponse } from '../../shared/protocol';

const CODE = new URLSearchParams(location.search).get('code')
    || sessionStorage.getItem('lobbyCode');

if (!CODE) {
    location.href = '../index.html';
    throw new Error('no lobby code');
}

function requireEl<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Элемент #${id} не найден`);
    return el as T;
}

// ==================== DOM ====================
const viewport        = requireEl<HTMLDivElement>('viewport');
const mapStatus       = requireEl<HTMLDivElement>('map-status');
const turnNumberEl    = requireEl<HTMLSpanElement>('turn-number');
const countryNameEl   = requireEl<HTMLDivElement>('country-name');
const countryTreasEl  = requireEl<HTMLDivElement>('country-treasury');
const countryTilesEl  = requireEl<HTMLDivElement>('country-tiles');
const countEl         = requireEl<HTMLSpanElement>('participants-count');
const listEl          = requireEl<HTMLUListElement>('participants-list');
const afkBtn          = requireEl<HTMLButtonElement>('afk-toggle');

const ordersPanel     = requireEl<HTMLDivElement>('orders-panel');
const ordersListEl    = requireEl<HTMLUListElement>('orders-list');
const readyBtn        = requireEl<HTMLButtonElement>('ready-btn');

const order6Modal     = requireEl<HTMLDivElement>('order6-modal');
const order6TitleEl   = requireEl<HTMLDivElement>('order6-title');
const order6MaxEl     = requireEl<HTMLDivElement>('order6-max');
const order6InfEl     = requireEl<HTMLInputElement>('order6-inf');
const order6CanEl     = requireEl<HTMLInputElement>('order6-can');
const order6OkEl      = requireEl<HTMLButtonElement>('order6-ok');
const order6CancelEl  = requireEl<HTMLButtonElement>('order6-cancel');
const order6OverlayEl = requireEl<HTMLDivElement>('order6-overlay');

const orderBuyBtn       = requireEl<HTMLButtonElement>('order-buy-btn');
const orderBuyModal     = requireEl<HTMLDivElement>('order-buy-modal');
const orderBuyOverlay   = requireEl<HTMLDivElement>('order-buy-overlay');
const orderBuyBudgetEl  = requireEl<HTMLDivElement>('order-buy-budget');
const orderBuyInfEl     = requireEl<HTMLInputElement>('order-buy-inf');
const orderBuyCanEl     = requireEl<HTMLInputElement>('order-buy-can');
const orderBuyCostEl    = requireEl<HTMLDivElement>('order-buy-cost');
const orderBuyOkEl      = requireEl<HTMLButtonElement>('order-buy-ok');
const orderBuyCancelEl  = requireEl<HTMLButtonElement>('order-buy-cancel');




const mapView = new MapView(viewport);
mapView.onStatus(text => { mapStatus.textContent = text; });
mapView.setSelectionMode('tile');

// ==================== Состояние ====================
let myUsername: string | null = null;
let youAreHost = false;
let yourCountryIdx: number | null = null;

let currentState: GameState | null = null;
let lastParticipants: string[] = [];
let lastHost: string | null = null;
let lastMapVersion = -1;
let isAfk = false;
let lastAfk: Set<string> = new Set();

let pendingOrders: Order[] = [];
let myReady = false;
let order6From: number | null = null;
let order6Pending: { from: number; to: number } | null = null;

// ==================== Рендер ====================

function renderOwners(): void {
    if (!currentState) return;
    const list = currentState.countries
        .filter(c => c.capital != null)
        .map(c => ({ tileId: c.capital!.id }));
    mapView.setCountries(list);
}

function renderArmies(): void {
    if (!currentState) return;
    const byTileId = new Map<number, { inf: number; can: number }>();
    for (const tile of currentState.tiles) {
        const inf = tile.defenders.army.infantry;
        const can = tile.defenders.army.cannons;
        if (inf !== 0 || can !== 0) {
            byTileId.set(tile.id, { inf, can });
        }
    }
    mapView.setArmies(byTileId);
}

function renderTurnInfo(): void {
    turnNumberEl.textContent = currentState ? String(currentState.turn) : '—';
}

function renderCountryInfo(): void {
    if (!currentState || yourCountryIdx == null) {
        countryNameEl.textContent = '—';
        countryTreasEl.textContent = 'Казна: —';
        countryTilesEl.textContent = 'Провинций: —';
        return;
    }
    const c = currentState.countries[yourCountryIdx];
    if (!c) {
        countryNameEl.textContent = '—';
        countryTreasEl.textContent = 'Казна: —';
        countryTilesEl.textContent = 'Провинций: —';
        return;
    }
    countryNameEl.textContent = `Страна #${c.id}`;
    countryTreasEl.textContent = `Казна: ${c.treasury}`;
    countryTilesEl.textContent = `Провинций: ${c.tiles.length}`;
}

function renderParticipants(): void {
    countEl.textContent = String(lastParticipants.length);
    listEl.innerHTML = '';
    for (const name of lastParticipants) {
        const li = document.createElement('li');
        li.textContent = name;
        if (name === myUsername) li.style.fontWeight = 'bold';
        if (name === lastHost) li.textContent += ' (хост)';
        if (lastAfk.has(name)) {
            li.textContent += ' (АФК)';
            li.classList.add('afk');
        }
        listEl.appendChild(li);
    }
}

function renderAfk(): void {
    afkBtn.classList.toggle('active', isAfk);
    afkBtn.textContent = isAfk ? 'Вернуться' : 'АФК';
}

function describeOrder(o: Order): string {
    switch (o.type) {
        case 1: return `Инвестиции ${o.investments} → тайлы [${o.tiles.map(t => t.id).join(',')}]`;
        case 3: return `Подарок ${o.gift} стране #${o.recipient.id}`;
        case 4: return `Покупка: ${o.infantry} пех., ${o.cannons} пуш.`;
        case 5: return `Отступление: ${o.tile.id} → ${o.retreat_province.id}`;
        case 6: return `Движение: ${o.from.id} → ${o.to.id} (${o.infantry} пех., ${o.cannons} пуш.)`;
        case 7: return `Поддержка: ${o.from.id} ⇒ ${o.target_from.id}→${o.target_to.id}`;
        case 8: return `Защита: ${o.from.id} → ${o.target.id}`;
    }
}

function renderOrders(): void {
    ordersListEl.innerHTML = '';
    if (pendingOrders.length === 0) {
        const li = document.createElement('li');
        li.className = 'orders-empty';
        li.textContent = 'Нет приказов';
        ordersListEl.appendChild(li);
    } else {
        pendingOrders.forEach((o, i) => {
            const li = document.createElement('li');
            const span = document.createElement('span');
            span.textContent = describeOrder(o);
            li.appendChild(span);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = '×';
            btn.title = 'Удалить';
            btn.addEventListener('click', () => removeOrder(i));
            li.appendChild(btn);
            ordersListEl.appendChild(li);
        });
    }
    ordersPanel.classList.toggle('locked', myReady);
}

function renderReadyBar(): void {
    readyBtn.disabled = myReady;
    readyBtn.textContent = myReady ? 'Готов ✓' : 'Готов';
    orderBuyBtn.disabled = myReady;
    ordersPanel.classList.toggle('locked', myReady);
    // Пока «Готов» — тайлы не кликаются.
    mapView.setSelectionMode(myReady ? 'none' : 'tile');
}

function renderAll(): void {
    renderOwners();
    renderArmies();
    renderTurnInfo();
    renderCountryInfo();
    renderParticipants();
    renderAfk();
    renderOrders();
    renderReadyBar();
}

function removeOrder(index: number): void {
    if (myReady) return;
    if (index < 0 || index >= pendingOrders.length) return;
    pendingOrders.splice(index, 1);
    renderOrders();
}

// ==================== Order 6 helpers ====================

/** Сколько inf/can уже «занято» приказами из этого тайла. */
function claimedFrom(tileId: number): { inf: number; can: number } {
    if (!currentState) return { inf: 0, can: 0 };
    const tile = currentState.tiles[tileId];
    if (!tile) return { inf: 0, can: 0 };
    let inf = 0, can = 0;
    for (const o of pendingOrders) {
        if (o.type === 6 || o.type === 7 || o.type === 8) {
            if (o.from === tile) {
                inf += o.infantry;
                can += o.cannons;
            }
        }
    }
    return { inf, can };
}

/** Сколько inf/can доступно в тайле с учётом уже добавленных приказов. */
function availableInTile(tileId: number): { inf: number; can: number } {
    if (!currentState) return { inf: 0, can: 0 };
    const tile = currentState.tiles[tileId];
    if (!tile) return { inf: 0, can: 0 };
    const c = claimedFrom(tileId);
    return {
        inf: Math.max(0, tile.defenders.army.infantry - c.inf),
        can: Math.max(0, tile.defenders.army.cannons - c.can),
    };
}

function isNeighbour(fromId: number, toId: number): boolean {
    if (!currentState) return false;
    const from = currentState.tiles[fromId];
    if (!from) return false;
    return from.neighbours.some(n => n.id === toId);
}

// ==================== Бюджет ====================
//
// Order 1/3/4 тратят казну. applyTurn отменяет ВСЕ экономические приказы
// страны, если суммарные траты превышают казну — поэтому клиент тоже
// обязан следить за бюджетом и не давать ввести лишнего.

const INF_COST = 1;
const CAN_COST = 3;

function spentTreasury(): number {
    let s = 0;
    for (const o of pendingOrders) {
        if (o.type === 1) s += o.investments;
        else if (o.type === 3) s += o.gift;
        else if (o.type === 4) s += o.infantry * INF_COST + o.cannons * CAN_COST;
    }
    return s;
}

function availableTreasury(): number {
    if (!currentState || yourCountryIdx == null) return 0;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return 0;
    return Math.max(0, Math.round((me.treasury - spentTreasury()) * 1000) / 1000);
}

// ==================== Order 4 modal ====================

/**
 * Чистит содержимое numeric-инпута: оставляет только цифры.
 * Пустая строка допустима (означает 0). Возвращает получившееся число.
 *
 * Используется и в Order 4, и в Order 6. `type="text"` + ручная чистка
 * выбраны вместо `type="number"` из-за нестабильного поведения number-
 * инпутов с ведущим нулём в некоторых браузерах.
 */
function sanitizeNumericInput(el: HTMLInputElement): number {
    const cleaned = el.value.replace(/\D+/g, '');
    if (cleaned !== el.value) {
        el.value = cleaned;
    }
    if (cleaned === '') return 0;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : 0;
}

function renderOrderBuyCost(): void {
    const inf = sanitizeNumericInput(orderBuyInfEl);
    const can = sanitizeNumericInput(orderBuyCanEl);
    const cost = inf * INF_COST + can * CAN_COST;
    orderBuyCostEl.textContent = `Итого: ${cost} ед.`;
    orderBuyOkEl.disabled = cost <= 0 || cost > availableTreasury();
}

function openOrderBuyModal(): void {
    if (!currentState || yourCountryIdx == null) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;

    const avail = availableTreasury();
    orderBuyBudgetEl.textContent = `Доступно из казны: ${avail} ед.`;
    orderBuyInfEl.value = '0';
    orderBuyCanEl.value = '0';
    renderOrderBuyCost();

    orderBuyModal.hidden = false;
    orderBuyInfEl.focus();
    orderBuyInfEl.select();
}

orderBuyInfEl.addEventListener('input', () => sanitizeNumericInput(orderBuyInfEl));
orderBuyCanEl.addEventListener('input', () => sanitizeNumericInput(orderBuyCanEl));
order6InfEl.addEventListener('input', () => sanitizeNumericInput(order6InfEl));
order6CanEl.addEventListener('input', () => sanitizeNumericInput(order6CanEl));

function closeOrderBuyModal(): void {
    orderBuyModal.hidden = true;
}

orderBuyBtn.addEventListener('click', () => {
    if (myReady) return;
    openOrderBuyModal();
});

orderBuyOverlay.addEventListener('click', closeOrderBuyModal);
orderBuyCancelEl.addEventListener('click', closeOrderBuyModal);
orderBuyInfEl.addEventListener('input', renderOrderBuyCost);
orderBuyCanEl.addEventListener('input', renderOrderBuyCost);

orderBuyOkEl.addEventListener('click', () => {
    if (!currentState || yourCountryIdx == null) { closeOrderBuyModal(); return; }
    const me = currentState.countries[yourCountryIdx];
    if (!me) { closeOrderBuyModal(); return; }

    let inf = sanitizeNumericInput(orderBuyInfEl);
    let can = sanitizeNumericInput(orderBuyCanEl);
    const avail = availableTreasury();
    let cost = inf * INF_COST + can * CAN_COST;

    // Если превышает — пропорционально урезаем пушки, потом пехоту.
    if (cost > avail) {
        can = Math.min(can, Math.floor(avail / CAN_COST));
        cost = can * CAN_COST;
        inf = Math.min(inf, Math.floor((avail - cost) / INF_COST));
        cost = inf * INF_COST + can * CAN_COST;
    }

    if (inf === 0 && can === 0) { closeOrderBuyModal(); return; }

    const order: Order = {
        type: 4,
        owner: me,
        infantry: inf,
        cannons: can,
    };
    pendingOrders.push(order);
    renderOrders();
    renderOrderBuyCost();  // обновит доступный бюджет на случай повторного открытия
    closeOrderBuyModal();
});

// ==================== Order 6 modal ====================

function openOrder6Modal(fromId: number, toId: number): void {
    const avail = availableInTile(fromId);
    order6Pending = { from: fromId, to: toId };

    order6TitleEl.textContent = `Движение: ${fromId} → ${toId}`;
    order6MaxEl.textContent = `Доступно: ${avail.inf} inf, ${avail.can} can`;
    order6InfEl.max = String(avail.inf);
    order6CanEl.max = String(avail.can);
    order6InfEl.value = '0';
    order6CanEl.value = '0';

    // Возвращаем подсветку на исходный тайл (клик по цели мог её сместить).
    mapView.selectTile(fromId);

    order6Modal.hidden = false;
    order6InfEl.focus();
    order6InfEl.select();
}

function closeOrder6Modal(): void {
    order6Pending = null;
    order6Modal.hidden = true;
}

order6OkEl.addEventListener('click', () => {
    if (!order6Pending || !currentState || yourCountryIdx == null) {
        closeOrder6Modal();
        return;
    }
    const me = currentState.countries[yourCountryIdx];
    if (!me) { closeOrder6Modal(); return; }

    const fromTile = currentState.tiles[order6Pending.from];
    const toTile   = currentState.tiles[order6Pending.to];
    if (!fromTile || !toTile) { closeOrder6Modal(); return; }

    const avail = availableInTile(order6Pending.from);
    let inf = Math.min(sanitizeNumericInput(order6InfEl), avail.inf);
    let can = Math.min(sanitizeNumericInput(order6CanEl), avail.can);

    if (inf === 0 && can === 0) {
        closeOrder6Modal();
        order6From = null;
        mapView.clearSelection();
        return;
    }

    const order: Order = {
        type: 6,
        owner: me,
        from: fromTile,
        to: toTile,
        infantry: inf,
        cannons: can,
    };
    pendingOrders.push(order);
    renderOrders();

    closeOrder6Modal();
    order6From = null;
    mapView.clearSelection();
});

order6CancelEl.addEventListener('click', () => {
    // Возвращаемся к выбору цели — исходный тайл остаётся подсвеченным.
    closeOrder6Modal();
    if (order6From != null) mapView.selectTile(order6From);
});

order6OverlayEl.addEventListener('click', () => {
    order6CancelEl.click();
});

// ==================== Order 6 builder: clicks on map ====================

mapView.onTileClick((tileId) => {
    if (myReady) return;
    if (!currentState || yourCountryIdx == null) return;

    // Клик по «пустоте» / повторный клик по выделенному — снять выбор.
    if (tileId == null) {
        order6From = null;
        return;
    }
    const tile = currentState.tiles[tileId];
    if (!tile) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;

    // Никто не выбран — начинаем с своего тайла, если там есть армия.
    if (order6From == null) {
        if (tile.owner !== me) return;
        const avail = availableInTile(tileId);
        if (avail.inf + avail.can === 0) return;
        order6From = tileId;
        mapView.selectTile(tileId);
        return;
    }

    // Повторный клик по исходному тайлу — снять выбор.
    if (tileId === order6From) {
        order6From = null;
        mapView.clearSelection();
        return;
    }

    // Клик по соседу — открыть модалку.
    if (isNeighbour(order6From, tileId)) {
        openOrder6Modal(order6From, tileId);
        return;
    }

    // Иначе: если это мой тайл с армией — переключить источник, иначе сброс.
    if (tile.owner === me) {
        const avail = availableInTile(tileId);
        if (avail.inf + avail.can > 0) {
            order6From = tileId;
            mapView.selectTile(tileId);
            return;
        }
    }
    order6From = null;
    mapView.clearSelection();
});

// ==================== Ready button ====================

readyBtn.addEventListener('click', async () => {
    if (myReady) return;

    readyBtn.disabled = true;
    readyBtn.textContent = 'Отправка...';

    try {
        const r = await fetch(`/lobby/${encodeURIComponent(CODE!)}/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orders: ordersToJSON(pendingOrders), ready: true }),
        });
        if (!r.ok) {
            let msg = `Ошибка ${r.status}`;
            try {
                const j = await r.json() as { error?: string };
                if (j && j.error) msg = j.error;
            } catch { /* нет тела */ }
            mapStatus.textContent = msg;
            readyBtn.disabled = false;
            readyBtn.textContent = 'Готов';
            return;
        }
        myReady = true;
        order6From = null;
        closeOrder6Modal();
        closeOrderBuyModal();
        mapView.clearSelection();
        renderReadyBar();
        renderOrders();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        mapStatus.textContent = 'Ошибка сети: ' + msg;
        readyBtn.disabled = false;
        readyBtn.textContent = 'Готов';
    }
});

// ==================== AFK ====================

afkBtn.addEventListener('click', async () => {
    const next = !isAfk;
    try {
        const r = await fetch(`/lobby/${encodeURIComponent(CODE!)}/afk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ afk: next }),
        });
        if (r.ok) {
            isAfk = next;
            renderAfk();
        } else {
            let msg = `Ошибка ${r.status}`;
            try {
                const j = await r.json() as { error?: string };
                if (j && j.error) msg = j.error;
            } catch { /* нет тела */ }
            mapStatus.textContent = msg;
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        mapStatus.textContent = 'Ошибка сети: ' + msg;
    }
});

// ==================== Сеть ====================

async function fetchMe(): Promise<string | null> {
    try {
        const r = await fetch('/me');
        if (!r.ok) return null;
        const j = await r.json() as { user?: { username?: string } };
        return j.user?.username ?? null;
    } catch {
        return null;
    }
}

async function fetchWhoami(): Promise<WhoamiResponse | null> {
    try {
        const r = await fetch(`/lobby/${encodeURIComponent(CODE!)}/whoami`);
        if (!r.ok) return null;
        return await r.json() as WhoamiResponse;
    } catch {
        return null;
    }
}

async function fetchState(): Promise<GameState | null> {
    try {
        const r = await fetch(`/lobby/${encodeURIComponent(CODE!)}/state`);
        if (!r.ok) {
            mapStatus.textContent = `Не удалось получить состояние: ${r.status}`;
            return null;
        }
        const j = await r.json();
        // Сервер сейчас возвращает SerializedGameState напрямую
        // (history[length-1]); оставляем совместимость на случай обёртки.
        const serialized = (j && typeof j === 'object' && 'state' in j) ? j.state : j;
        return fromJSON(serialized);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        mapStatus.textContent = 'Ошибка получения состояния: ' + msg;
        return null;
    }
}

async function fetchMap(version: number): Promise<void> {
    try {
        const url = `/lobby/${encodeURIComponent(CODE!)}/map?v=${version}`;
        const r = await fetch(url);
        if (!r.ok) {
            mapStatus.textContent = `Не удалось скачать карту: ${r.status}`;
            return;
        }
        const blob = await r.blob();
        await mapView.loadFromBlob(blob);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        mapStatus.textContent = 'Ошибка скачивания карты: ' + msg;
    }
}

// ==================== SSE ====================

let eventSource: EventSource | null = null;

async function bootstrap(): Promise<void> {
    myUsername = await fetchMe();
    if (!myUsername) { location.href = '../index.html'; return; }

    const who = await fetchWhoami();
    if (!who) { location.href = '../index.html'; return; }
    youAreHost = who.youAreHost;
    yourCountryIdx = who.yourCountryIdx;

    currentState = await fetchState();
    renderAll();

    eventSource = new EventSource(`/lobby/${encodeURIComponent(CODE!)}/events`);
    eventSource.onmessage = (e: MessageEvent<string>) => {
        let data: SseEvent;
        try {
            data = JSON.parse(e.data) as SseEvent;
        } catch (err) {
            console.error('Не удалось разобрать SSE:', err);
            return;
        }

        switch (data.type) {
            case 'participants':
                lastParticipants = data.participants;
                lastHost = data.host;
                lastAfk = new Set(data.afk ?? []);
                isAfk = myUsername != null && lastAfk.has(myUsername);
                renderParticipants();
                renderAfk();
                break;

            case 'mapVersion':
                if (data.version !== lastMapVersion) {
                    lastMapVersion = data.version;
                    if (data.version > 0) {
                        void (async () => {
                            await fetchMap(data.version);
                            renderAll();
                        })();
                    }
                }
                break;

            case 'countries':
                // Лобби-выбор стран; в игре источник истины — currentState.
                break;

            case 'gameStart':
                void (async () => {
                    const w = await fetchWhoami();
                    if (w) {
                        youAreHost = w.youAreHost;
                        yourCountryIdx = w.yourCountryIdx;
                        renderAll();
                    }
                })();
                break;

            case 'hostChanged':
                lastHost = data.host;
                void (async () => {
                    const w = await fetchWhoami();
                    if (w) {
                        youAreHost = w.youAreHost;
                        renderAll();
                    }
                })();
                break;

            case 'turnStarted':
                // Новый раунд: сбрасываем готовность и черновики.
                myReady = false;
                pendingOrders = [];
                order6From = null;
                closeOrder6Modal();
                closeOrderBuyModal();
                mapView.clearSelection();
                renderOrders();
                renderReadyBar();
                break;

            case 'ordersBatch':
                // 7.2: логируем для отладки. Хост соберёт приказы в 7.3.
                console.log('[SSE] ordersBatch from', data.from,
                            'ready=', data.ready,
                            'orders=', data.orders);
                break;

            case 'allReady':
                // 7.2: логируем. В 7.3 хост здесь вызовет resolveTurn().
                console.log('[SSE] allReady turn=', data.turn);
                break;

            case 'turnResult':
                // 7.3: применит новое состояние.
                console.log('[SSE] turnResult turn=', data.turn);
                break;

            case 'historyInfo':
                // Этап 8.
                break;

            default: {
                const _exhaustive: never = data;
                console.warn('Неизвестное SSE-событие:', _exhaustive);
            }
        }
    };
    eventSource.onerror = () => {
        console.warn('SSE: соединение потеряно, переподключение...');
    };
    window.addEventListener('beforeunload', () => {
        if (eventSource) eventSource.close();
    });
}

void bootstrap();