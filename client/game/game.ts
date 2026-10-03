// client/game/game.ts
import { MapView } from '../shared/mapview';
import {
    applyTurn,
    fromJSON,
    orderToJSON,
    ordersFromJSON,
    ordersToJSON,
    toJSON,
    validateOrders,
    type GameState,
    type Order,
    type SerializedGameState,
    type SerializedOrder,
} from '../../shared/game';
import type {
    SseEvent,
    WhoamiResponse,
    HistoryResponse,
} from '../../shared/protocol';
import {
    clearArrows,
    drawArrow,
    drawSupportAttack,
    drawSupportDefense,
} from './arrow';

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

const ordersButtonsEl = requireEl<HTMLDivElement>('orders-buttons');

const troopModal      = requireEl<HTMLDivElement>('troop-modal');
const troopOverlayEl  = requireEl<HTMLDivElement>('troop-overlay');
const troopTitleEl    = requireEl<HTMLDivElement>('troop-title');
const troopMaxEl      = requireEl<HTMLDivElement>('troop-max');
const troopInfEl      = requireEl<HTMLInputElement>('troop-inf');
const troopCanEl      = requireEl<HTMLInputElement>('troop-can');
const troopOkEl       = requireEl<HTMLButtonElement>('troop-ok');
const troopCancelEl   = requireEl<HTMLButtonElement>('troop-cancel');

const moneyModal      = requireEl<HTMLDivElement>('money-modal');
const moneyOverlayEl  = requireEl<HTMLDivElement>('money-overlay');
const moneyTitleEl    = requireEl<HTMLDivElement>('money-title');
const moneyMaxEl      = requireEl<HTMLDivElement>('money-max');
const moneyLabelEl    = requireEl<HTMLSpanElement>('money-label');
const moneyInputEl    = requireEl<HTMLInputElement>('money-input');
const moneyOkEl       = requireEl<HTMLButtonElement>('money-ok');
const moneyCancelEl   = requireEl<HTMLButtonElement>('money-cancel');

const confirmModal    = requireEl<HTMLDivElement>('confirm-modal');
const confirmOverlay  = requireEl<HTMLDivElement>('confirm-overlay');
const confirmTitleEl  = requireEl<HTMLDivElement>('confirm-title');
const confirmBodyEl   = requireEl<HTMLDivElement>('confirm-body');
const confirmOkEl     = requireEl<HTMLButtonElement>('confirm-ok');
const confirmCancelEl = requireEl<HTMLButtonElement>('confirm-cancel');

const renameModal     = requireEl<HTMLDivElement>('rename-modal');
const renameOverlay   = requireEl<HTMLDivElement>('rename-overlay');
const renameInputEl   = requireEl<HTMLInputElement>('rename-input');
const renameOkEl      = requireEl<HTMLButtonElement>('rename-ok');
const renameCancelEl  = requireEl<HTMLButtonElement>('rename-cancel');

const turnViewBar     = requireEl<HTMLDivElement>('turn-view-bar');
const forwardBtn      = requireEl<HTMLButtonElement>('forward-btn');
const backBtn         = requireEl<HTMLButtonElement>('back-btn');
const ordersHintEl    = requireEl<HTMLDivElement>('orders-hint');

const orderBuyBtn     = requireEl<HTMLButtonElement>('order-buy-btn');
const orderBuyModal   = requireEl<HTMLDivElement>('order-buy-modal');
const orderBuyOverlay = requireEl<HTMLDivElement>('order-buy-overlay');
const orderBuyBudgetEl= requireEl<HTMLDivElement>('order-buy-budget');
const orderBuyInfEl   = requireEl<HTMLInputElement>('order-buy-inf');
const orderBuyCanEl   = requireEl<HTMLInputElement>('order-buy-can');
const orderBuyCostEl  = requireEl<HTMLDivElement>('order-buy-cost');
const orderBuyOkEl    = requireEl<HTMLButtonElement>('order-buy-ok');
const orderBuyCancelEl= requireEl<HTMLButtonElement>('order-buy-cancel');

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

type OrderMode =
    | 'move'
    | 'supportAttack'
    | 'supportDefense'
    | 'invest'
    | 'gift'
    | 'retreat'
    | 'rename'
    | 'none';

let activeMode: OrderMode = 'move';

interface ModeSelection { tiles: number[]; }
let modeSelection: ModeSelection = { tiles: [] };

/** Имена провинций: tileId → name. Обновляется по SSE `renames`. */
let tileNames = new Map<number, string>();

/** Накопленные приказы из SSE `ordersBatch`. Хост применяет их в resolveTurn. */
let accumulatedOrders: SerializedOrder[] = [];

// ==================== Лента ходов ====================

interface TurnEntry {
    turn: number;
    movement: SerializedGameState | null;
    final: SerializedGameState;
    orders: SerializedOrder[];
}

let turns: TurnEntry[] = [];
let viewingIndex = 0;
const parsedCache = new Map<string, GameState>();

function isViewingHistory(): boolean {
    return turns.length > 0 && viewingIndex < turns.length - 1;
}

function displayPhaseFor(i: number): 'movement' | 'final' {
    if (i === turns.length - 1) return 'final';
    const e = turns[i];
    return e && e.movement ? 'movement' : 'final';
}

function getDisplayState(): GameState | null {
    if (turns.length === 0) return null;
    const i = viewingIndex;
    const e = turns[i];
    if (!e) return null;
    const phase = displayPhaseFor(i);
    if (i === turns.length - 1 && phase === 'final') return currentState;
    const key = `${i}-${phase}`;
    const cached = parsedCache.get(key);
    if (cached) return cached;
    const src = phase === 'movement' && e.movement ? e.movement : e.final;
    const parsed = fromJSON(src);
    parsedCache.set(key, parsed);
    return parsed;
}

// ==================== Рендер ====================

function renderOwners(state: GameState | null): void {
    if (!state) return;
    const info = mapView.loadedMapData?.info;
    if (!info) return;
    const list: Array<{ tileId: number; color?: number }> = [];
    for (const c of state.countries) {
        if (c.capital == null) continue;
        const capitalColor = info.colors[c.capital.id];
        for (const t of c.tiles) {
            list.push({ tileId: t.id, color: capitalColor });
        }
    }
    mapView.setCountries(list);
}

function renderArmies(state: GameState | null): void {
    if (!state) return;
    const info = mapView.loadedMapData?.info;
    const live = !isViewingHistory();
    const byTileId = new Map<number, { inf: number; can: number; color?: string }>();

    for (const tile of state.tiles) {
        let inf = tile.defenders.army.infantry;
        let can = tile.defenders.army.cannons;

        // На живом ходу показываем остаток после pending-приказов,
        // чтобы игрок сразу видел, сколько войск останется в тайле.
        if (live) {
            const claimed = claimedFrom(tile.id);
            inf = Math.max(0, inf - claimed.inf);
            can = Math.max(0, can - claimed.can);
        }

        if (inf === 0 && can === 0) continue;

        let color: string | undefined;
        if (tile.owner && info && tile.owner.capital) {
            const col = info.colors[tile.owner.capital.id];
            if (col != null) {
                color = '#' + (col >>> 0).toString(16).padStart(6, '0');
            }
        }

        byTileId.set(tile.id, { inf, can, color });
    }
    mapView.setArmies(byTileId);
}

function renderLabels(): void {
    mapView.setTileLabels(tileNames);
}

function ownerColor(ownerIdx: number | undefined): string {
    if (ownerIdx == null) return '#e11d48';
    const info = mapView.loadedMapData?.info;
    if (!info || !currentState) return '#e11d48';
    const c = currentState.countries[ownerIdx];
    if (!c || c.capital == null) return '#e11d48';
    const col = info.colors[c.capital.id];
    if (col == null) return '#e11d48';
    return '#' + (col >>> 0).toString(16).padStart(6, '0');
}

function renderArrows(): void {
    const d = mapView.loadedMapData;
    if (!d) return;
    clearArrows(d.arrowOverlay);
    if (turns.length === 0) return;

    const pts = d.info.points;
    if (!pts) return;

    const getP = (id: number | undefined): { x: number; y: number } | null => {
        if (id == null) return null;
        const p = pts[id];
        return p ? { x: p.x, y: p.y } : null;
    };

    const drawOne = (o: SerializedOrder): void => {
        const color = ownerColor(o.owner);
        const inf = o.infantry ?? 0;
        const can = o.cannons ?? 0;

        if (o.type === 6) {
            if (inf === 0 && can === 0) return;
            const a = getP(o.from), b = getP(o.to);
            if (!a || !b) return;
            drawArrow(d.arrowOverlay, a.x, a.y, b.x, b.y, inf, can, color);
        } else if (o.type === 7) {
            if (inf === 0 && can === 0) return;
            const a = getP(o.from), b = getP(o.target_from), c = getP(o.target_to);
            if (!a || !b || !c) return;
            drawSupportAttack(d.arrowOverlay, a.x, a.y, b.x, b.y, c.x, c.y, inf, can, color);
        } else if (o.type === 8) {
            if (inf === 0 && can === 0) return;
            const a = getP(o.from), b = getP(o.target);
            if (!a || !b) return;
            drawSupportDefense(d.arrowOverlay, a.x, a.y, b.x, b.y, inf, can, color);
        }
    };

    // Живой ход (не история): рисуем стрелки текущих черновиков игрока.
    // Сюда же попадает случай, когда игрок нажал «Готов» — черновики
    // остаются видны до прихода turnResult.
    if (!isViewingHistory()) {
        for (const o of pendingOrders) drawOne(orderToJSON(o));
        return;
    }

    // История: стрелки применённых приказов в фазе движения.
    if (displayPhaseFor(viewingIndex) !== 'movement') return;
    const entry = turns[viewingIndex];
    if (!entry || !entry.orders || entry.orders.length === 0) return;
    for (const so of entry.orders) drawOne(so);
}

function renderTurnInfo(): void {
    if (turns.length === 0) { turnNumberEl.textContent = '—'; return; }
    const e = turns[viewingIndex];
    if (!e) { turnNumberEl.textContent = '—'; return; }
    let text = String(e.turn);
    if (displayPhaseFor(viewingIndex) === 'movement') text += ' (движение)';
    if (isViewingHistory()) text += ' · история';
    turnNumberEl.textContent = text;
}

function renderCountryInfo(): void {
    const state = getDisplayState();
    if (!state || yourCountryIdx == null) {
        countryNameEl.textContent = '—';
        countryTreasEl.textContent = 'Казна: —';
        countryTilesEl.textContent = 'Провинций: —';
        return;
    }
    const c = state.countries[yourCountryIdx];
    if (!c) {
        countryNameEl.textContent = '—';
        countryTreasEl.textContent = 'Казна: —';
        countryTilesEl.textContent = 'Провинций: —';
        return;
    }
    countryNameEl.textContent = `Страна #${c.id}`;
    countryTreasEl.textContent = `Казна: ${c.treasury} ₵`;
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

function isOrderingBlocked(): boolean {
    return myReady || turns.length === 0 || isViewingHistory();
}

function updateViewButtons(): void {
    const hasTurns = turns.length > 0;
    const hasBack = hasTurns && viewingIndex > 0;
    const hasForward = hasTurns && viewingIndex < turns.length - 1;
    const pendingTurns = hasTurns ? (turns.length - 1 - viewingIndex) : 0;
    backBtn.hidden = !hasBack;
    forwardBtn.hidden = !hasForward;
    forwardBtn.textContent = pendingTurns > 1
        ? `Вперёд ▶ (+${pendingTurns})`
        : 'Вперёд ▶';
    turnViewBar.hidden = !hasTurns || (!hasBack && !hasForward);
}

function describeOrder(o: Order): string {
    switch (o.type) {
        case 1: return `Инвестиции ${o.investments} ₵ → тайлы [${o.tiles.map(t => t.id).join(',')}]`;
        case 3: return `Подарок ${o.gift} ₵ стране #${o.recipient.id}`;
        case 4: return `Покупка: ${o.infantry} пех., ${o.cannons} пуш.`;
        case 5: return `Отступление: ${o.tile.id} → ${o.retreat_province.id}`;
        case 6: return `Движение: ${o.from.id} → ${o.to.id} (${o.infantry} пех., ${o.cannons} пуш.)`;
        case 7: return `Поддержка: ${o.from.id} ⇒ ${o.target_from.id}→${o.target_to.id} (${o.infantry} пех., ${o.cannons} пуш.)`;
        case 8: return `Защита: ${o.from.id} → ${o.target.id} (${o.infantry} пех., ${o.cannons} пуш.)`;
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

    const blocked = isOrderingBlocked();
    ordersPanel.classList.toggle('locked', blocked);

    if (isViewingHistory()) {
        ordersHintEl.textContent =
            'Просмотр истории ходов — приказы недоступны. Нажимайте «Вперёд ▶», чтобы вернуться к текущему ходу.';
    } else if (myReady) {
        ordersHintEl.textContent = 'Ожидание других игроков…';
    } else {
        ordersHintEl.textContent = hintForMode(activeMode);
    }

    // Стрелки и армии зависят от pendingOrders — перерисовываем каждый
    // раз, когда меняется список приказов (создание, удаление, очистка).
    renderArrows();
    renderArmies(getDisplayState());
}



function hintForMode(mode: OrderMode): string {
    switch (mode) {
        case 'move':
            return 'Кликните свой тайл, затем соседний — чтобы добавить движение.';
        case 'supportAttack':
            return 'Поддержка атаки: свой тайл → тайл атаки → тайл-цель.';
        case 'supportDefense':
            return 'Поддержка обороны: свой тайл → соседний защищаемый тайл.';
        case 'invest':
            return 'Кликайте тайлы для инвестиций (в том числе чужие), затем нажмите «Инвестиции (E)» ещё раз.';
        case 'gift':
            return 'Кликните столицу другой страны — откроется ввод суммы.';
        case 'retreat':
            return 'Отступление: свой тайл → соседний тайл (куда отступать).';
        case 'rename':
            return 'Кликните свою провинцию — откроется ввод нового имени.';
        case 'none':
            return 'Режим без взаимодействия — карта только панорамируется.';
    }
}

function renderModeBar(): void {
    const blocked = isOrderingBlocked();
    const btns = ordersButtonsEl.querySelectorAll<HTMLButtonElement>('button[data-mode]');
    btns.forEach(btn => {
        const mode = btn.dataset.mode as OrderMode;
        btn.disabled = blocked;
        btn.classList.toggle('active', !blocked && mode === activeMode);
    });
    orderBuyBtn.disabled = blocked;
}

function updateMapInteraction(): void {
    const blocked = isOrderingBlocked();
    if (blocked || activeMode === 'none') {
        mapView.setSelectionMode('none');
        mapView.setExternalSelectionMode(false);
        return;
    }
    mapView.setSelectionMode('tile');
    mapView.setExternalSelectionMode(activeMode === 'invest');
}

function renderReadyBar(): void {
    if (isViewingHistory()) {
        readyBtn.disabled = true;
        readyBtn.textContent = 'Просмотр истории';
    } else if (myReady) {
        readyBtn.disabled = true;
        readyBtn.textContent = 'Готов ✓';
    } else {
        readyBtn.disabled = false;
        readyBtn.textContent = 'Готов';
    }

    updateMapInteraction();
}

function renderFromView(): void {
    const state = getDisplayState();
    renderOwners(state);
    renderLabels();
    renderTurnInfo();
    renderCountryInfo();
    updateViewButtons();
}

function renderAll(): void {
    renderFromView();
    renderParticipants();
    renderAfk();
    renderOrders();
    renderReadyBar();
    renderModeBar();
}

function removeOrder(index: number): void {
    if (isOrderingBlocked()) return;
    if (index < 0 || index >= pendingOrders.length) return;
    pendingOrders.splice(index, 1);
    renderOrders();
}

// ==================== Общие helper'ы ====================

function claimedFrom(tileId: number): { inf: number; can: number } {
    if (!currentState) return { inf: 0, can: 0 };
    const tile = currentState.tiles[tileId];
    if (!tile) return { inf: 0, can: 0 };
    let inf = 0, can = 0;
    for (const o of pendingOrders) {
        if (o.type === 6 || o.type === 7 || o.type === 8) {
            if (o.from === tile) { inf += o.infantry; can += o.cannons; }
        }
    }
    return { inf, can };
}

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

function sanitizeNumericInput(el: HTMLInputElement): number {
    const cleaned = el.value.replace(/\D+/g, '');
    if (cleaned !== el.value) el.value = cleaned;
    if (cleaned === '') return 0;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : 0;
}

// ==================== Модалки: общие ====================

function anyModalOpen(): boolean {
    return !troopModal.hidden
        || !orderBuyModal.hidden
        || !moneyModal.hidden
        || !confirmModal.hidden
        || !renameModal.hidden;
}

function closeAllOrderModals(): void {
    closeTroopModal();
    closeOrderBuyModal();
    closeMoneyModal();
    closeConfirmModal();
    closeRenameModal();
}

// ==================== Режимы ====================

function setMode(mode: OrderMode): void {
    if (isOrderingBlocked()) return;

    if (mode === activeMode) {
        if (mode === 'invest' && modeSelection.tiles.length > 0) {
            commitInvest();
            return;
        }
        activeMode = 'none';
    } else {
        activeMode = mode;
    }

    modeSelection.tiles = [];
    mapView.clearSelection();
    mapView.clearHighlight();
    closeAllOrderModals();
    renderModeBar();
    renderOrders();
    updateMapInteraction();
}

function exitMode(): void {
    activeMode = 'none';
    modeSelection.tiles = [];
    mapView.clearSelection();
    mapView.clearHighlight();
    renderModeBar();
    renderOrders();
    updateMapInteraction();
}

ordersButtonsEl.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('button[data-mode]') as HTMLButtonElement | null;
    if (!target) return;
    const mode = target.dataset.mode as OrderMode;
    setMode(mode);
});

// ==================== Хоткеи ====================

window.addEventListener('keydown', (e) => {
    if (isOrderingBlocked()) return;
    if (anyModalOpen()) return;
    const t = document.activeElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (t instanceof HTMLElement && t.isContentEditable) return;

    switch (e.code) {
        case 'KeyA': setMode('move'); break;
        case 'KeyS': setMode('supportAttack'); break;
        case 'KeyD': setMode('supportDefense'); break;
        case 'KeyE': setMode('invest'); break;
        case 'KeyG': setMode('gift'); break;
        case 'KeyR': setMode('retreat'); break;
        case 'KeyN': setMode('rename'); break;
    }
});

// ==================== Навигация по ходам ====================

function navigateBy(delta: number): void {
    const next = viewingIndex + delta;
    if (next < 0 || next >= turns.length) return;
    viewingIndex = next;
    modeSelection.tiles = [];
    closeAllOrderModals();
    mapView.clearSelection();
    mapView.clearHighlight();
    renderAll();
}

forwardBtn.addEventListener('click', () => navigateBy(+1));
backBtn.addEventListener('click', () => navigateBy(-1));

// ==================== Бюджет ====================

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

function renderOrderBuyCost(): void {
    const inf = sanitizeNumericInput(orderBuyInfEl);
    const can = sanitizeNumericInput(orderBuyCanEl);
    const cost = inf * INF_COST + can * CAN_COST;
    orderBuyCostEl.textContent = `Итого: ${cost} ₵`;
    orderBuyOkEl.disabled = cost <= 0 || cost > availableTreasury();
}

function openOrderBuyModal(): void {
    if (!currentState || yourCountryIdx == null) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;

    const avail = availableTreasury();
    orderBuyBudgetEl.textContent = `Доступно из казны: ${avail} ₵`;
    orderBuyInfEl.value = '0';
    orderBuyCanEl.value = '0';
    renderOrderBuyCost();
    orderBuyModal.hidden = false;
    orderBuyInfEl.focus();
    orderBuyInfEl.select();
}

function closeOrderBuyModal(): void { orderBuyModal.hidden = true; }

orderBuyInfEl.addEventListener('input', () => { sanitizeNumericInput(orderBuyInfEl); renderOrderBuyCost(); });
orderBuyCanEl.addEventListener('input', () => { sanitizeNumericInput(orderBuyCanEl); renderOrderBuyCost(); });

orderBuyBtn.addEventListener('click', () => {
    if (isOrderingBlocked()) return;
    openOrderBuyModal();
});
orderBuyOverlay.addEventListener('click', closeOrderBuyModal);
orderBuyCancelEl.addEventListener('click', closeOrderBuyModal);

orderBuyOkEl.addEventListener('click', () => {
    if (!currentState || yourCountryIdx == null) { closeOrderBuyModal(); return; }
    const me = currentState.countries[yourCountryIdx];
    if (!me) { closeOrderBuyModal(); return; }

    let inf = sanitizeNumericInput(orderBuyInfEl);
    let can = sanitizeNumericInput(orderBuyCanEl);
    const avail = availableTreasury();
    let cost = inf * INF_COST + can * CAN_COST;

    if (cost > avail) {
        can = Math.min(can, Math.floor(avail / CAN_COST));
        cost = can * CAN_COST;
        inf = Math.min(inf, Math.floor((avail - cost) / INF_COST));
        cost = inf * INF_COST + can * CAN_COST;
    }
    if (inf === 0 && can === 0) { closeOrderBuyModal(); return; }

    pendingOrders.push({ type: 4, owner: me, infantry: inf, cannons: can });
    renderOrders();
    closeOrderBuyModal();
});

// ==================== Troop modal (Orders 6/7/8) ====================

interface TroopModalConfig {
    title: string;
    subtitle: string;
    maxInf: number;
    maxCan: number;
    defaultInf?: number;
    defaultCan?: number;
    onSubmit: (inf: number, can: number) => void;
}

let troopModalConfig: TroopModalConfig | null = null;

function openTroopModal(cfg: TroopModalConfig): void {
    troopModalConfig = cfg;
    troopTitleEl.textContent = cfg.title;
    troopMaxEl.textContent = cfg.subtitle;
    troopInfEl.value = String(cfg.defaultInf ?? 0);
    troopCanEl.value = String(cfg.defaultCan ?? 0);
    troopModal.hidden = false;
    troopInfEl.focus();
    troopInfEl.select();
}

function closeTroopModal(): void {
    troopModalConfig = null;
    troopModal.hidden = true;
}

troopInfEl.addEventListener('input', () => sanitizeNumericInput(troopInfEl));
troopCanEl.addEventListener('input', () => sanitizeNumericInput(troopCanEl));

troopOkEl.addEventListener('click', () => {
    if (!troopModalConfig) { closeTroopModal(); return; }
    const inf = Math.min(sanitizeNumericInput(troopInfEl), troopModalConfig.maxInf);
    const can = Math.min(sanitizeNumericInput(troopCanEl), troopModalConfig.maxCan);
    if (inf === 0 && can === 0) { closeTroopModal(); return; }
    const cb = troopModalConfig.onSubmit;
    closeTroopModal();
    cb(inf, can);
});

troopCancelEl.addEventListener('click', closeTroopModal);
troopOverlayEl.addEventListener('click', closeTroopModal);

// ==================== Money modal (Orders 1, 3) ====================

interface MoneyModalConfig {
    title: string;
    subtitle: string;
    max: number;
    label?: string;
    onSubmit: (value: number) => void;
}

let moneyModalConfig: MoneyModalConfig | null = null;

function openMoneyModal(cfg: MoneyModalConfig): void {
    moneyModalConfig = cfg;
    moneyTitleEl.textContent = cfg.title;
    moneyMaxEl.textContent = cfg.subtitle;
    moneyLabelEl.textContent = cfg.label ?? 'Сумма, ₵:';
    moneyInputEl.value = '0';
    moneyModal.hidden = false;
    moneyInputEl.focus();
    moneyInputEl.select();
}

function closeMoneyModal(): void {
    moneyModalConfig = null;
    moneyModal.hidden = true;
}

moneyInputEl.addEventListener('input', () => sanitizeNumericInput(moneyInputEl));

moneyOkEl.addEventListener('click', () => {
    if (!moneyModalConfig) { closeMoneyModal(); return; }
    const v = Math.min(sanitizeNumericInput(moneyInputEl), moneyModalConfig.max);
    if (v <= 0) { closeMoneyModal(); return; }
    const cb = moneyModalConfig.onSubmit;
    closeMoneyModal();
    cb(v);
});

moneyCancelEl.addEventListener('click', closeMoneyModal);
moneyOverlayEl.addEventListener('click', closeMoneyModal);

// ==================== Confirm modal ====================

interface ConfirmModalConfig {
    title: string;
    body: string;
    onConfirm: () => void;
}

let confirmModalConfig: ConfirmModalConfig | null = null;

function openConfirmModal(cfg: ConfirmModalConfig): void {
    confirmModalConfig = cfg;
    confirmTitleEl.textContent = cfg.title;
    confirmBodyEl.textContent = cfg.body;
    confirmModal.hidden = false;
}

function closeConfirmModal(): void {
    confirmModalConfig = null;
    confirmModal.hidden = true;
}

confirmOkEl.addEventListener('click', () => {
    const cfg = confirmModalConfig;
    closeConfirmModal();
    if (cfg) cfg.onConfirm();
});
confirmCancelEl.addEventListener('click', closeConfirmModal);
confirmOverlay.addEventListener('click', closeConfirmModal);

// ==================== Rename modal ====================

let renameTileId: number | null = null;

function openRenameModal(tileId: number): void {
    if (!currentState || yourCountryIdx == null) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;
    const tile = currentState.tiles[tileId];
    if (!tile || tile.owner !== me) return;

    renameTileId = tileId;
    renameInputEl.value = tileNames.get(tileId) ?? '';
    renameModal.hidden = false;
    renameInputEl.focus();
    renameInputEl.select();
}

function closeRenameModal(): void {
    renameTileId = null;
    renameModal.hidden = true;
}

renameOkEl.addEventListener('click', async () => {
    if (renameTileId == null) { closeRenameModal(); return; }
    const tileId = renameTileId;
    const name = renameInputEl.value.trim();
    closeRenameModal();
    try {
        const r = await fetch(`/lobby/${encodeURIComponent(CODE!)}/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tileId, name }),
        });
        if (!r.ok) {
            let msg = `Ошибка ${r.status}`;
            try { const j = await r.json() as { error?: string }; if (j.error) msg = j.error; } catch { /* */ }
            mapStatus.textContent = msg;
        }
    } catch (err) {
        mapStatus.textContent = 'Ошибка сети: ' + (err instanceof Error ? err.message : String(err));
    }
});

renameCancelEl.addEventListener('click', closeRenameModal);
renameOverlay.addEventListener('click', closeRenameModal);

// ==================== Handlers по режимам ====================

// --- Order 6: движение ---
function handleMoveClick(tileId: number): void {
    if (!currentState || yourCountryIdx == null) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;
    const tile = currentState.tiles[tileId];
    if (!tile) return;

    const sel = modeSelection.tiles;

    if (sel.length === 0) {
        if (tile.owner !== me) return;
        const avail = availableInTile(tileId);
        if (avail.inf + avail.can === 0) return;
        sel.push(tileId);
        mapView.selectTile(tileId);
        return;
    }

    const fromId = sel[0]!;
    if (tileId === fromId) {
        sel.length = 0;
        mapView.clearSelection();
        return;
    }

    if (isNeighbour(fromId, tileId)) {
        const avail = availableInTile(fromId);
        openTroopModal({
            title: `Движение: ${fromId} → ${tileId}`,
            subtitle: `Доступно: ${avail.inf} пех., ${avail.can} пуш.`,
            maxInf: avail.inf,
            maxCan: avail.can,
            onSubmit: (inf, can) => {
                pendingOrders.push({
                    type: 6, owner: me,
                    from: currentState!.tiles[fromId]!,
                    to: currentState!.tiles[tileId]!,
                    infantry: inf, cannons: can,
                });
                sel.length = 0;
                mapView.clearSelection();
                renderOrders();
            },
        });
        return;
    }

    if (tile.owner === me) {
        const avail = availableInTile(tileId);
        if (avail.inf + avail.can > 0) {
            sel.length = 0;
            sel.push(tileId);
            mapView.selectTile(tileId);
            return;
        }
    }
    sel.length = 0;
    mapView.clearSelection();
}

// --- Order 8: поддержка обороны ---
function handleSupportDefenseClick(tileId: number): void {
    if (!currentState || yourCountryIdx == null) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;
    const tile = currentState.tiles[tileId];
    if (!tile) return;

    const sel = modeSelection.tiles;

    if (sel.length === 0) {
        if (tile.owner !== me) return;
        const avail = availableInTile(tileId);
        if (avail.inf + avail.can === 0) return;
        sel.push(tileId);
        mapView.selectTile(tileId);
        return;
    }

    const fromId = sel[0]!;
    if (tileId === fromId) { sel.length = 0; mapView.clearSelection(); return; }
    if (!isNeighbour(fromId, tileId)) return;

    const avail = availableInTile(fromId);
    openTroopModal({
        title: `Поддержка обороны: ${fromId} → ${tileId}`,
        subtitle: `Доступно: ${avail.inf} пех., ${avail.can} пуш.`,
        maxInf: avail.inf,
        maxCan: avail.can,
        onSubmit: (inf, can) => {
            pendingOrders.push({
                type: 8, owner: me,
                from: currentState!.tiles[fromId]!,
                target: currentState!.tiles[tileId]!,
                infantry: inf, cannons: can,
            });
            sel.length = 0;
            mapView.clearSelection();
            renderOrders();
        },
    });
}

// --- Order 7: поддержка атаки ---
function handleSupportAttackClick(tileId: number): void {
    if (!currentState || yourCountryIdx == null) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;
    const tile = currentState.tiles[tileId];
    if (!tile) return;

    const sel = modeSelection.tiles;

    if (sel.length === 0) {
        if (tile.owner !== me) return;
        const avail = availableInTile(tileId);
        if (avail.inf + avail.can === 0) return;
        sel.push(tileId);
        mapView.selectTile(tileId);
        return;
    }

    if (sel.length === 1) {
        const fromId = sel[0]!;
        if (tileId === fromId) { sel.length = 0; mapView.clearSelection(); return; }
        sel.push(tileId);
        mapView.selectTile(tileId);
        return;
    }

    const [fromId, targetFromId] = sel as [number, number];
    if (tileId === fromId || tileId === targetFromId) {
        sel.length = 0;
        mapView.clearSelection();
        return;
    }
    if (!isNeighbour(targetFromId, tileId)) return;
    if (!isNeighbour(fromId, tileId)) return;

    const avail = availableInTile(fromId);
    openTroopModal({
        title: `Поддержка атаки: ${fromId} → ${targetFromId} ⇒ ${tileId}`,
        subtitle: `Доступно: ${avail.inf} пех., ${avail.can} пуш.`,
        maxInf: avail.inf,
        maxCan: avail.can,
        onSubmit: (inf, can) => {
            pendingOrders.push({
                type: 7, owner: me,
                from: currentState!.tiles[fromId]!,
                target_from: currentState!.tiles[targetFromId]!,
                target_to: currentState!.tiles[tileId]!,
                infantry: inf, cannons: can,
            });
            sel.length = 0;
            mapView.clearSelection();
            renderOrders();
        },
    });
}

// --- Order 1: инвестиции ---
function handleInvestClick(tileId: number): void {
    if (!currentState) return;
    const tile = currentState.tiles[tileId];
    if (!tile) return;

    const idx = modeSelection.tiles.indexOf(tileId);
    if (idx >= 0) modeSelection.tiles.splice(idx, 1);
    else modeSelection.tiles.push(tileId);
    mapView.setHighlight(modeSelection.tiles);
}

function commitInvest(): void {
    if (activeMode !== 'invest') return;
    if (modeSelection.tiles.length === 0) return;
    if (!currentState || yourCountryIdx == null) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;

    const avail = availableTreasury();
    if (avail <= 0) return;
    const tilesSnapshot = modeSelection.tiles.slice();

    openMoneyModal({
        title: `Инвестиции в ${tilesSnapshot.length} тайл(ов)`,
        subtitle: `Доступно: ${avail} ₵`,
        max: avail,
        onSubmit: (investments) => {
            if (investments <= 0) return;
            pendingOrders.push({
                type: 1, owner: me,
                investments,
                tiles: tilesSnapshot.map(id => currentState!.tiles[id]!),
            });
            renderOrders();
            exitMode();
        },
    });
}

// --- Order 3: подарок ---
function handleGiftClick(tileId: number): void {
    if (!currentState || yourCountryIdx == null) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;

    const recipient = currentState.countries.find(
        c => c.capital != null && c.capital.id === tileId,
    );
    if (!recipient || recipient.id === me.id) return;

    const avail = availableTreasury();
    if (avail <= 0) return;

    openMoneyModal({
        title: `Подарок стране #${recipient.id}`,
        subtitle: `Доступно: ${avail} ₵`,
        max: avail,
        onSubmit: (gift) => {
            if (gift <= 0) return;
            pendingOrders.push({ type: 3, owner: me, recipient, gift });
            renderOrders();
            exitMode();
        },
    });
}

// --- Order 5: отступление ---
function handleRetreatClick(tileId: number): void {
    if (!currentState || yourCountryIdx == null) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;
    const tile = currentState.tiles[tileId];
    if (!tile) return;

    const sel = modeSelection.tiles;

    if (sel.length === 0) {
        if (tile.owner !== me) return;
        sel.push(tileId);
        mapView.selectTile(tileId);
        return;
    }

    const fromId = sel[0]!;
    if (tileId === fromId) { sel.length = 0; mapView.clearSelection(); return; }
    if (!isNeighbour(fromId, tileId)) return;

    openConfirmModal({
        title: `Отступление: ${fromId} → ${tileId}`,
        body: 'Назначить этот тайл как точку отступления для своих войск из указанного тайла?',
        onConfirm: () => {
            pendingOrders.push({
                type: 5, owner: me,
                tile: currentState!.tiles[fromId]!,
                retreat_province: currentState!.tiles[tileId]!,
            });
            sel.length = 0;
            mapView.clearSelection();
            renderOrders();
        },
    });
}

// --- Rename ---
function handleRenameClick(tileId: number): void {
    openRenameModal(tileId);
}

// ==================== Dispatcher кликов по карте ====================

mapView.onTileClick((tileId) => {
    if (isOrderingBlocked()) return;

    if (tileId == null) {
        modeSelection.tiles = [];
        mapView.clearSelection();
        mapView.clearHighlight();
        return;
    }

    if (activeMode === 'none') return;

    switch (activeMode) {
        case 'move': handleMoveClick(tileId); break;
        case 'supportAttack': handleSupportAttackClick(tileId); break;
        case 'supportDefense': handleSupportDefenseClick(tileId); break;
        case 'invest': handleInvestClick(tileId); break;
        case 'gift': handleGiftClick(tileId); break;
        case 'retreat': handleRetreatClick(tileId); break;
        case 'rename': handleRenameClick(tileId); break;
    }
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
            try { const j = await r.json() as { error?: string }; if (j.error) msg = j.error; } catch { /* */ }
            mapStatus.textContent = msg;
            readyBtn.disabled = false;
            readyBtn.textContent = 'Готов';
            return;
        }
        myReady = true;
        modeSelection.tiles = [];
        closeAllOrderModals();
        mapView.clearSelection();
        mapView.clearHighlight();
        renderReadyBar();
        renderOrders();
        renderModeBar();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        mapStatus.textContent = 'Ошибка сети: ' + msg;
        readyBtn.disabled = false;
        readyBtn.textContent = 'Готов';
    }
});

// ==================== Хост: разрешение хода ====================

async function resolveTurn(): Promise<void> {
    if (!currentState) return;

    const rawOrders = accumulatedOrders.slice();

    let allOrders: Order[];
    try {
        allOrders = ordersFromJSON(rawOrders, currentState);
    } catch (err) {
        console.error('[host] resolveTurn: не удалось разобрать приказы', err);
        return;
    }

    // Провалидированный набор — именно он уйдёт в applyTurn и его же
    // мы отправим как `appliedOrders` (для стрелок в истории).
    const validOrders = validateOrders(currentState, allOrders);
    const appliedSerialized = ordersToJSON(validOrders);

    let movementSnapshot: SerializedGameState | null = null;
    const next = applyTurn(currentState, allOrders, {
        onMovementPhase: (s) => {
            movementSnapshot = toJSON(structuredClone(s));
        },
    });
    const finalState = toJSON(next);

    try {
        const r = await fetch(`/lobby/${encodeURIComponent(CODE!)}/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                state: finalState,
                movementState: movementSnapshot,
                appliedOrders: appliedSerialized,
            }),
        });
        if (!r.ok) {
            console.warn('[host] resolveTurn: POST /state →', r.status);
            const recovered = await fetchStateRaw();
            if (recovered) {
                currentState = fromJSON(recovered);
                const last = turns[turns.length - 1];
                if (last && last.turn === recovered.turn) {
                    last.final = recovered;
                    parsedCache.clear();
                }
            }
            renderAll();
            return;
        }
    } catch (err) {
        console.error('[host] resolveTurn: network error', err);
    }
}

// ==================== AFK ====================

afkBtn.addEventListener('click', async () => {
    const next = !isAfk;
    try {
        const r = await fetch(`/lobby/${encodeURIComponent(CODE!)}/afk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ afk: next }),
        });
        if (r.ok) { isAfk = next; renderAfk(); }
        else {
            let msg = `Ошибка ${r.status}`;
            try { const j = await r.json() as { error?: string }; if (j.error) msg = j.error; } catch { /* */ }
            mapStatus.textContent = msg;
        }
    } catch (err) {
        mapStatus.textContent = 'Ошибка сети: ' + (err instanceof Error ? err.message : String(err));
    }
});

// ==================== Сеть ====================

async function fetchMe(): Promise<string | null> {
    try {
        const r = await fetch('/me');
        if (!r.ok) return null;
        const j = await r.json() as { user?: { username?: string } };
        return j.user?.username ?? null;
    } catch { return null; }
}

async function fetchWhoami(): Promise<WhoamiResponse | null> {
    try {
        const r = await fetch(`/lobby/${encodeURIComponent(CODE!)}/whoami`);
        if (!r.ok) return null;
        return await r.json() as WhoamiResponse;
    } catch { return null; }
}

async function fetchStateRaw(): Promise<SerializedGameState | null> {
    try {
        const r = await fetch(`/lobby/${encodeURIComponent(CODE!)}/state`);
        if (!r.ok) { mapStatus.textContent = `Не удалось получить состояние: ${r.status}`; return null; }
        const j = await r.json();
        const serialized = (j && typeof j === 'object' && 'state' in j) ? j.state : j;
        return serialized as SerializedGameState;
    } catch (err) {
        mapStatus.textContent = 'Ошибка получения состояния: ' + (err instanceof Error ? err.message : String(err));
        return null;
    }
}

async function fetchHistory(): Promise<HistoryResponse | null> {
    try {
        const r = await fetch(`/lobby/${encodeURIComponent(CODE!)}/history`);
        if (!r.ok) return null;
        return await r.json() as HistoryResponse;
    } catch { return null; }
}

async function fetchMap(version: number): Promise<void> {
    try {
        const url = `/lobby/${encodeURIComponent(CODE!)}/map?v=${version}`;
        const r = await fetch(url);
        if (!r.ok) { mapStatus.textContent = `Не удалось скачать карту: ${r.status}`; return; }
        const blob = await r.blob();
        await mapView.loadFromBlob(blob);
    } catch (err) {
        mapStatus.textContent = 'Ошибка скачивания карты: ' + (err instanceof Error ? err.message : String(err));
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

    const hist = await fetchHistory();
    if (hist && Array.isArray(hist.entries) && hist.entries.length > 0) {
        turns = hist.entries.map(e => ({
            turn: e.turn,
            movement: e.movement,
            final: e.final,
            orders: e.orders,
        }));
        viewingIndex = turns.length - 1;
        const last = turns[turns.length - 1]!;
        currentState = fromJSON(last.final);
    } else {
        const initialSerialized = await fetchStateRaw();
        if (initialSerialized) {
            currentState = fromJSON(initialSerialized);
            turns = [{
                turn: initialSerialized.turn,
                movement: null,
                final: initialSerialized,
                orders: [],
            }];
            viewingIndex = 0;
        }
    }
    renderAll();

    eventSource = new EventSource(`/lobby/${encodeURIComponent(CODE!)}/events`);
    eventSource.onmessage = (e: MessageEvent<string>) => {
        let data: SseEvent;
        try { data = JSON.parse(e.data) as SseEvent; }
        catch (err) { console.error('Не удалось разобрать SSE:', err); return; }

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
                    if (w) { youAreHost = w.youAreHost; renderAll(); }
                })();
                break;

            case 'turnStarted':
                myReady = false;
                pendingOrders = [];
                modeSelection.tiles = [];
                closeAllOrderModals();
                mapView.clearSelection();
                mapView.clearHighlight();
                renderOrders();
                renderReadyBar();
                renderModeBar();
                break;

            case 'ordersBatch':
                accumulatedOrders = accumulatedOrders.concat(data.orders);
                break;

            case 'allReady':
                if (youAreHost) void resolveTurn();
                break;

            case 'turnResult': {
                const wasAtEnd = viewingIndex === turns.length - 1;

                turns.push({
                    turn: data.turn,
                    movement: data.movementState,
                    final: data.state,
                    orders: data.orders ?? [],
                });

                currentState = fromJSON(data.state);
                parsedCache.clear();

                if (wasAtEnd) viewingIndex = turns.length - 1;

                accumulatedOrders = [];
                pendingOrders = [];
                myReady = false;
                modeSelection.tiles = [];
                closeAllOrderModals();
                mapView.clearSelection();
                mapView.clearHighlight();

                renderAll();
                break;
            }

            case 'historyInfo':
                break;

            case 'renames':
                tileNames = new Map(data.renames);
                renderLabels();
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