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
    type Tile,
} from '../../shared/game';
import type {
    SseEvent,
    WhoamiResponse,
    HistoryResponse,
} from '../../shared/protocol';
import {
    clearArrows,
    drawArrow,
    drawRetreat,
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

const investStatusEl  = requireEl<HTMLDivElement>('invest-status');
const investAmountEl  = requireEl<HTMLInputElement>('invest-amount');
const investCountEl   = requireEl<HTMLSpanElement>('invest-count');
const investClearEl   = requireEl<HTMLButtonElement>('invest-clear');

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
const ordersResetBtn  = requireEl<HTMLButtonElement>('orders-reset-btn');
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

/**
 * Persistent-выбор тайлов для инвестиций. Хранится параллельно с
 * `pendingOrders`: в последнем всегда есть ровно один Order 1,
 * отражающий текущее состояние `investmentTiles` + `#invest-amount`.
 * Значения переживают ходы; сбрасываются только кнопкой «Очистить»
 * или «Сбросить все приказы».
 */
let investmentTiles: Set<number> = new Set();

/** Цвета подсветки тайлов для пошаговых режимов. */
const HL_GREEN     = '#22c55e';   // источник / from
const HL_ORANGE    = '#f59e0b';   // промежуточная цель (target_from)
const HL_RED       = '#ef4444';   // конечная цель (target_to / to)
const HL_INVEST    = '#ffffff';   // выбранные тайлы для инвестиций (persistent)
const HL_CANDIDATE = '#ffffff';   // «сюда можно кликнуть следующим шагом»

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

interface ArmyBadge {
    inf: number;
    can: number;
    color?: string;
}

function renderArmies(state: GameState | null): void {
    if (!state) return;
    const info = mapView.loadedMapData?.info;
    const live = !isViewingHistory();
    const byTileId = new Map<number, Array<{ inf: number; can: number; color?: string }>>();

    const colorOf = (
        owner: { capital: Tile | null } | null | undefined,
    ): string | undefined => {
        if (!owner || !owner.capital || !info) return undefined;
        const col = info.colors[owner.capital.id];
        if (col == null) return undefined;
        return '#' + (col >>> 0).toString(16).padStart(6, '0');
    };

    // ── Превью покупок в live-режиме ──
    // pending Order 4 ещё не применён. Если своя столица — прибавляем
    // к defenders; если оккупированная — показываем отдельным
    // phantom-бейджем ниже defenders (как это будет после applyTurn).
    let myBuyInf = 0, myBuyCan = 0;
    let myCapitalId: number | null = null;
    let myCapitalOwned = false;
    if (live && yourCountryIdx != null) {
        const me = state.countries[yourCountryIdx];
        const cap = me?.capital ?? null;
        if (cap) {
            myCapitalId = cap.id;
            myCapitalOwned = cap.owner != null && cap.owner.id === yourCountryIdx;
        }
        for (const o of pendingOrders) {
            if (o.type === 4) {
                myBuyInf += o.infantry;
                myBuyCan += o.cannons;
            }
        }
    }

    for (const tile of state.tiles) {
        const badges: Array<{ inf: number; can: number; color?: string }> = [];

        // 1. Garrison (defenders). В live — за вычетом pending
        // приказов из этого тайла (Order 6/7/8), плюс pending покупки
        // в свою столицу.
        let inf = tile.defenders.army.infantry;
        let can = tile.defenders.army.cannons;
        if (live) {
            const claimed = claimedFrom(tile.id);
            inf = Math.max(0, inf - claimed.inf);
            can = Math.max(0, can - claimed.can);
        }
        if (myCapitalOwned && myCapitalId === tile.id) {
            inf += myBuyInf;
            can += myBuyCan;
        }
        if (inf > 0 || can > 0) {
            badges.push({ inf, can, color: colorOf(tile.owner) });
        }

        // 2. Phantom arrivals (Order 4 в оккупированной столице) —
        // из уже применённого состояния (movement-снимок или история).
        // В финале хода arrived пуст, поэтому «живых» фантомов тут нет.
        for (let i = 0; i < tile.neighbours.length; i++) {
            const g = tile.arrived[i];
            if (!g || !g.phantomOwner) continue;
            if (g.army.infantry === 0 && g.army.cannons === 0) continue;
            badges.push({
                inf: g.army.infantry,
                can: g.army.cannons,
                color: colorOf(g.phantomOwner),
            });
        }

        // 3. Live-превью фантома: pending Order 4 в оккупированной
        // столице, до применения хода.
        if (
            live
            && !myCapitalOwned
            && myCapitalId === tile.id
            && (myBuyInf > 0 || myBuyCan > 0)
            && yourCountryIdx != null
        ) {
            const me = state.countries[yourCountryIdx];
            badges.push({ inf: myBuyInf, can: myBuyCan, color: colorOf(me) });
        }

        if (badges.length > 0) byTileId.set(tile.id, badges);
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

        if (o.type === 5) {
            const a = getP(o.tile), b = getP(o.retreat_province);
            if (!a || !b) return;
            drawRetreat(d.arrowOverlay, a.x, a.y, b.x, b.y, color);
        } else if (o.type === 6) {
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
    //
    // Order 5 персистентен: точка отступления хранится в состоянии и
    // переживает ходы. Поэтому сначала собираем сохранённые точки
    // отступления своей страны из currentState, затем накладываем
    // черновики — они перекрывают сохранённое значение по тайлу-источнику.
    if (!isViewingHistory()) {
        const retreatByTile = new Map<number, SerializedOrder>();
        const state = getDisplayState();
        if (state && yourCountryIdx != null) {
            for (const t of state.tiles) {
                const rp = t.retreat_province[yourCountryIdx];
                if (rp) {
                    retreatByTile.set(t.id, {
                        type: 5,
                        owner: yourCountryIdx,
                        tile: t.id,
                        retreat_province: rp.id,
                    });
                }
            }
        }

        const nonRetreatPending: SerializedOrder[] = [];
        for (const o of pendingOrders) {
            const so = orderToJSON(o);
            if (so.type === 5 && so.tile != null) {
                retreatByTile.set(so.tile, so);
            } else {
                nonRetreatPending.push(so);
            }
        }

        for (const so of retreatByTile.values()) drawOne(so);
        for (const so of nonRetreatPending) drawOne(so);
        return;
    }

    // История: стрелки применённых приказов в фазе движения.
    if (displayPhaseFor(viewingIndex) !== 'movement') return;

    // Сначала — точки отступления из состояния этого хода: они
    // персистентны, и в entry.orders их может не быть для ходов, где
    // новый Order 5 не выдавался.
    const histState = getDisplayState();
    if (histState) {
        for (const t of histState.tiles) {
            for (let ci = 0; ci < t.retreat_province.length; ci++) {
                const rp = t.retreat_province[ci];
                if (!rp) continue;
                drawOne({
                    type: 5,
                    owner: ci,
                    tile: t.id,
                    retreat_province: rp.id,
                });
            }
        }
    }

    // Затем — все прочие применённые приказы этого хода (Order 5 пропускаем,
    // чтобы не дублировать уже нарисованное из состояния).
    const entry = turns[viewingIndex];
    if (!entry || !entry.orders || entry.orders.length === 0) return;
    for (const so of entry.orders) {
        if (so.type === 5) continue;
        drawOne(so);
    }
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
    const income = Math.round(c.tiles.reduce((s, t) => s + t.economy, 0) * 1000) / 1000;

    // На живом ходу показываем остаток после pending-приказов, чтобы
    // поле реагировало на изменения инвестиций, покупок и подарков.
    // В истории (или в просмотре чужого хода) — «сырое» значение снапшота.
    let treasury = c.treasury;
    if (!isViewingHistory()) {
        treasury = Math.round((c.treasury - spentTreasury()) * 1000) / 1000;
    }

    countryTreasEl.textContent = `Казна: ${treasury}/${income} ₵`;
    countryNameEl.textContent = `Страна #${c.id}`;
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
        case 1: {
            if (o.tiles.length === 0 && o.investments === 0) return 'Инвестиции: не заданы';
            return `Инвестиции ${o.investments} ₵ × ${o.tiles.length} тайл(ов)`;
        }
        case 3: return `Подарок ${o.gift} ₵ стране #${o.recipient.id}`;
        case 4: return `Покупка: ${o.infantry} пех., ${o.cannons} пуш.`;
        case 5: return `Отступление: ${o.tile.id} → ${o.retreat_province.id}`;
        case 6: return `Движение: ${o.from.id} → ${o.to.id} (${o.infantry} пех., ${o.cannons} пуш.)`;
        case 7: return `Поддержка: ${o.from.id} ⇒ ${o.target_from.id}→${o.target_to.id} (${o.infantry} пех., ${o.cannons} пуш.)`;
        case 8: return `Защита: ${o.from.id} → ${o.target.id} (${o.infantry} пех., ${o.cannons} пуш.)`;
    }
}

function renderInvestStatus(): void {
    investStatusEl.hidden = false;
    investCountEl.textContent = `${investmentTiles.size} тайл(ов)`;
    const blocked = isOrderingBlocked();
    investAmountEl.disabled = blocked;
    investClearEl.disabled = blocked;
}

function renderOrders(): void {
    const blocked = isOrderingBlocked();

    // Подрезаем invest-сумму, если бюджет съеден другими приказами.
    // Делаем это ДО рендера списка, чтобы описание Order 1 было свежим.
    reconcileInvestBudget();

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
            // Invest-черновик редактируется через #invest-status,
            // отдельной кнопки × у него нет.
            if (o.type !== 1) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = '×';
                btn.title = 'Удалить';
                btn.addEventListener('click', () => removeOrder(i));
                li.appendChild(btn);
            }
            ordersListEl.appendChild(li);
        });
    }

    ordersPanel.classList.toggle('locked', blocked);

    if (isViewingHistory()) {
        ordersHintEl.textContent =
            'Просмотр истории ходов — приказы недоступны. Нажимайте «Вперёд ▶», чтобы вернуться к текущему ходу.';
    } else if (myReady) {
        ordersHintEl.textContent = 'Ожидание других игроков…';
    } else {
        ordersHintEl.textContent = hintForMode(activeMode, modeSelection.tiles);
    }

    ordersResetBtn.disabled = blocked;

    renderCountryInfo();

    renderInvestStatus();
    applyModeHighlight();
    renderArrows();
    renderArmies(getDisplayState());
}



function hintForMode(mode: OrderMode, sel: number[]): string {
    switch (mode) {
        case 'move':
            if (sel.length === 0) return 'Перемещение · шаг 1/2 — кликните свой тайл-источник.';
            return 'Перемещение · шаг 2/2 — кликните соседний тайл-назначение.';
        case 'supportAttack':
            if (sel.length === 0) return 'Поддержка атаки · шаг 1/3 — выберите свой тайл-источник.';
            if (sel.length === 1) return 'Поддержка атаки · шаг 2/3 — выберите тайл атаки (target_from). Можно тот же, что и источник.';
            return 'Поддержка атаки · шаг 3/3 — выберите тайл-цель атаки (target_to).';
        case 'supportDefense':
            if (sel.length === 0) return 'Поддержка обороны · шаг 1/2 — выберите свой тайл-источник.';
            return 'Поддержка обороны · шаг 2/2 — выберите соседний защищаемый тайл.';
        case 'invest':
            return 'Инвестиции: кликайте тайлы (в том числе чужие), задайте сумму в поле сверху. Приказ уйдёт при нажатии «Готов».';
        case 'gift':
            return 'Кликните столицу другой страны — откроется ввод суммы.';
        case 'retreat':
            if (sel.length === 0) return 'Отступление · шаг 1/2 — выберите тайл-источник (любой, не обязательно свой).';
            return 'Отступление · шаг 2/2 — выберите соседний тайл, куда отступать.';
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
    ordersResetBtn.disabled = blocked || pendingOrders.length === 0;
}

function updateMapInteraction(): void {
    const blocked = isOrderingBlocked();
    if (blocked || activeMode === 'none') {
        mapView.setSelectionMode('none');
        mapView.setExternalSelectionMode(false);
        return;
    }
    // Во всех режимах подсветку тайлов ведёт game.ts (цветные слои),
    // MapView не должен рисовать собственную белую заливку.
    mapView.setSelectionMode('tile');
    mapView.setExternalSelectionMode(true);
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
    const o = pendingOrders[index]!;
    if (o.type === 1) {
        // Инвестиции всегда в списке; «удалить» = очистить их.
        clearInvest();
        return;
    }
    pendingOrders.splice(index, 1);
    renderOrders();
}

function undoLastOrder(): void {
    if (isOrderingBlocked()) return;
    if (pendingOrders.length === 0) return;
    pendingOrders.pop();
    renderOrders();
}

/**
 * Каскадная отмена по Esc / правому клику:
 *   1. открыта модалка → закрыть её;
 *   2. есть незавершённый шаг выбора → сбросить выделение;
 *   3. активен режим → выйти в `none`.
 * Возвращает true, если что-то реально отменили.
 */
function cancelCurrentStep(): boolean {
    if (anyModalOpen()) { closeAllOrderModals(); applyModeHighlight(); return true; }
    if (modeSelection.tiles.length > 0) {
        modeSelection.tiles = [];
        mapView.clearSelection();
        applyModeHighlight();
        return true;
    }
    if (!isOrderingBlocked() && activeMode !== 'none') {
        exitMode();
        return true;
    }
    return false;
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

/**
 * Кандидаты на роль `target_from` для Order 7 (после выбора `from`).
 * Валидный target_from — такой тайл t, что у него с `from` есть общий
 * сосед (этот сосед станет target_to), либо t === from (спец-случай,
 * уже отображён зелёным, поэтому в белый список не попадает).
 */
function attackTargetFromCandidates(fromId: number): number[] {
    if (!currentState) return [];
    const from = currentState.tiles[fromId];
    if (!from) return [];
    const fromNbrs = new Set(from.neighbours.map(n => n.id));
    const result = new Set<number>();
    for (const n of from.neighbours) {
        for (const m of n.neighbours) {
            if (m.id === fromId) continue;
            if (result.has(m.id)) continue;
            if (m.neighbours.some(x => fromNbrs.has(x.id))) {
                result.add(m.id);
            }
        }
    }
    return [...result];
}

/**
 * Кандидаты на роль `target_to` для Order 7 (после выбора from и target_from).
 * target_to должен быть соседом и from, и target_from, и не совпадать
 * ни с одним из них.
 */
function attackTargetToCandidates(fromId: number, targetFromId: number): number[] {
    if (!currentState) return [];
    const from = currentState.tiles[fromId];
    if (!from) return [];
    if (fromId === targetFromId) {
        return from.neighbours.map(n => n.id);
    }
    const targetFrom = currentState.tiles[targetFromId];
    if (!targetFrom) return [];
    const tfNbrs = new Set(targetFrom.neighbours.map(n => n.id));
    return from.neighbours
        .map(n => n.id)
        .filter(id => tfNbrs.has(id) && id !== fromId && id !== targetFromId);
}

function computeCandidates(mode: OrderMode, sel: number[]): number[] {
    if (!currentState) return [];
    switch (mode) {
        case 'move':
        case 'supportDefense':
        case 'retreat': {
            if (sel.length !== 1) return [];
            const from = currentState.tiles[sel[0]!];
            if (!from) return [];
            return from.neighbours.map(n => n.id);
        }
        case 'supportAttack': {
            if (sel.length === 1) return attackTargetFromCandidates(sel[0]!);
            if (sel.length === 2) return attackTargetToCandidates(sel[0]!, sel[1]!);
            return [];
        }
        default:
            return [];
    }
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
        // Повторный клик/хоткей по активной кнопке — выход в 'none'.
        // investmentTiles при этом сохраняются.
        activeMode = 'none';
    } else {
        activeMode = mode;
    }

    modeSelection.tiles = [];
    mapView.clearSelection();
    applyModeHighlight();
    closeAllOrderModals();
    renderModeBar();
    renderOrders();
    updateMapInteraction();
}

function exitMode(): void {
    activeMode = 'none';
    modeSelection.tiles = [];
    mapView.clearSelection();
    applyModeHighlight();
    renderModeBar();
    renderOrders();
    updateMapInteraction();
}

/**
 * Перерисовать цветную подсветку тайлов по текущему состоянию
 * `activeMode` + `modeSelection.tiles`. Вызывается после любого
 * изменения выделения или закрытия модалки.
 */
function applyModeHighlight(): void {
    const layers: Array<{ tiles: number[]; color: string }> = [];

    // Инвестиционные тайлы — persistent, показываем их всегда, когда
    // мы не в заблокированном состоянии (история/ready).
    if (!isOrderingBlocked() && investmentTiles.size > 0) {
        layers.push({ tiles: [...investmentTiles], color: HL_INVEST });
    }

    // Подсветка шага текущего режима.
    if (!isOrderingBlocked() && activeMode !== 'none') {
        const sel = modeSelection.tiles;
        if (activeMode === 'supportAttack') {
            if (sel.length >= 1) layers.push({ tiles: [sel[0]!], color: HL_GREEN });
            if (sel.length >= 2) layers.push({ tiles: [sel[1]!], color: HL_ORANGE });
        } else if (activeMode !== 'invest') {
            if (sel.length >= 1) layers.push({ tiles: sel, color: HL_GREEN });
        }
        // Для invest дополнительный слой не нужен — уже покрыт выше.

        const candidates = computeCandidates(activeMode, sel);
        if (candidates.length > 0) {
            layers.push({ tiles: candidates, color: HL_CANDIDATE });
        }
    }

    if (layers.length === 0) {
        mapView.clearHighlight();
    } else {
        mapView.setHighlightLayers(layers);
    }
}

ordersButtonsEl.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('button[data-mode]') as HTMLButtonElement | null;
    if (!target) return;
    const mode = target.dataset.mode as OrderMode;
    setMode(mode);
});

// ==================== Хоткеи ====================

window.addEventListener('keydown', (e) => {
    // Esc обрабатываем первым — независимо от блокировок и фокуса,
    // чтобы игрок мог закрыть модалку/отменить шаг в любой момент.
    if (e.code === 'Escape') {
        const t = document.activeElement;
        if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
            t.blur();
            e.preventDefault();
            return;
        }
        if (cancelCurrentStep()) e.preventDefault();
        return;
    }

    if (isOrderingBlocked()) return;
    if (anyModalOpen()) return;

    const t = document.activeElement;
    const inAnyInput =
        t instanceof HTMLInputElement
        || t instanceof HTMLTextAreaElement
        || t instanceof HTMLSelectElement
        || (t instanceof HTMLElement && t.isContentEditable);
    // «Числовые» поля — только цифры (sanitizeNumericInput), буквенные
    // хоткеи там не мешают вводу. Настоящие текстовые поля (rename) —
    // блокируют хоткеи полностью.
    const inNumericInput =
        t instanceof HTMLInputElement
        && (t.inputMode === 'numeric' || t.type === 'number');
    const inTextField = inAnyInput && !inNumericInput;

    // Ctrl+Z / Cmd+Z — откат последнего приказа, но не в полях ввода
    // (там браузерный undo важнее).
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        if (inAnyInput) return;
        e.preventDefault();
        undoLastOrder();
        return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (inTextField) return;

    switch (e.code) {
        case 'KeyA': e.preventDefault(); setMode('move'); break;
        case 'KeyS': e.preventDefault(); setMode('supportAttack'); break;
        case 'KeyD': e.preventDefault(); setMode('supportDefense'); break;
        case 'KeyE': e.preventDefault(); setMode('invest'); break;
        case 'KeyG': e.preventDefault(); setMode('gift'); break;
        case 'KeyR': e.preventDefault(); setMode('retreat'); break;
        case 'KeyN': e.preventDefault(); setMode('rename'); break;
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

/** Максимум, который можно вложить сейчас (за вычетом не-invest приказов). */
function maxInvestAmount(): number {
    if (!currentState || yourCountryIdx == null) return 0;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return 0;
    let spent = 0;
    for (const o of pendingOrders) {
        if (o.type === 1) continue;
        else if (o.type === 3) spent += o.gift;
        else if (o.type === 4) spent += o.infantry * INF_COST + o.cannons * CAN_COST;
    }
    return Math.max(0, Math.floor(me.treasury - spent));
}

/**
 * Синхронизирует Order 1 в `pendingOrders` с текущим состоянием
 * `investmentTiles` + `#invest-amount`. В списке всегда ровно один
 * invest-черновик — даже если он тривиален (0 тайлов, 0 ₵).
 * Вызывается после любого изменения invest-состояния и при смене хода.
 */
function syncInvestOrder(): void {
    for (let i = pendingOrders.length - 1; i >= 0; i--) {
        if (pendingOrders[i]!.type === 1) pendingOrders.splice(i, 1);
    }
    if (!currentState || yourCountryIdx == null) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;

    const max = maxInvestAmount();
    let amount = parseInt(investAmountEl.value, 10) || 0;
    if (amount > max) {
        amount = max;
        investAmountEl.value = String(max);
    }
    const tiles: Tile[] = [];
    for (const id of investmentTiles) {
        const t = currentState.tiles[id];
        if (t) tiles.push(t);
    }
    pendingOrders.push({ type: 1, owner: me, investments: amount, tiles });
}

/** Очистить invest-черновик: тайлы + сумма. */
function clearInvest(): void {
    investmentTiles.clear();
    investAmountEl.value = '0';
    syncInvestOrder();
    applyModeHighlight();
    renderOrders();
}

/**
 * Приказы, уходящие на сервер. Тривиальный invest-черновик отбрасывается:
 * `applyTurn` списывает `investments` из казны даже при пустом `tiles`,
 * то есть пустой invest = сжигание денег.
 */
function ordersForSend(): Order[] {
    return pendingOrders.filter(o => {
        if (o.type === 1) return o.investments > 0 && o.tiles.length > 0;
        return true;
    });
}

/**
 * Защитная подрезка invest-суммы, если бюджет уменьшился из-за других
 * приказов (покупка войск, подарок). Вызывается из renderOrders перед
 * рендером списка.
 */
function reconcileInvestBudget(): void {
    if (isOrderingBlocked()) return;
    const max = maxInvestAmount();
    const raw = parseInt(investAmountEl.value, 10) || 0;
    if (raw > max) {
        investAmountEl.value = String(max);
        for (let i = 0; i < pendingOrders.length; i++) {
            const o = pendingOrders[i]!;
            if (o.type === 1) {
                pendingOrders[i] = { ...o, investments: max };
                break;
            }
        }
    }
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

ordersResetBtn.addEventListener('click', () => {
    if (isOrderingBlocked()) return;
    openConfirmModal({
        title: 'Сбросить все приказы?',
        body: 'Будут удалены все приказы, включая инвестиции. Действие необратимо.',
        onConfirm: () => {
            pendingOrders = [];
            investmentTiles.clear();
            investAmountEl.value = '0';
            syncInvestOrder();
            modeSelection.tiles = [];
            mapView.clearSelection();
            mapView.clearHighlight();
            renderOrders();
            renderModeBar();
        },
    });
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

investAmountEl.addEventListener('input', () => {
    sanitizeNumericInput(investAmountEl);
    syncInvestOrder();
    renderOrders();
});

investClearEl.addEventListener('click', clearInvest);


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
    if (!troopModalConfig) { closeTroopModal(); applyModeHighlight(); return; }
    const inf = Math.min(sanitizeNumericInput(troopInfEl), troopModalConfig.maxInf);
    const can = Math.min(sanitizeNumericInput(troopCanEl), troopModalConfig.maxCan);
    if (inf === 0 && can === 0) { closeTroopModal(); applyModeHighlight(); return; }
    const cb = troopModalConfig.onSubmit;
    closeTroopModal();
    cb(inf, can);
    // onSubmit выставил sel = [] и вызвал renderOrders;
    // здесь — просто снять preview-подсветку.
    applyModeHighlight();
});

troopCancelEl.addEventListener('click', () => { closeTroopModal(); applyModeHighlight(); });
troopOverlayEl.addEventListener('click', () => { closeTroopModal(); applyModeHighlight(); });

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
    applyModeHighlight();
});
confirmCancelEl.addEventListener('click', () => { closeConfirmModal(); applyModeHighlight(); });
confirmOverlay.addEventListener('click', () => { closeConfirmModal(); applyModeHighlight(); });

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
        applyModeHighlight();
        return;
    }

    const fromId = sel[0]!;
    if (tileId === fromId) {
        sel.length = 0;
        applyModeHighlight();
        return;
    }

    if (isNeighbour(fromId, tileId)) {
        const avail = availableInTile(fromId);
        // Пока открыта модалка — [from] зелёным + [to] оранжевым.
        mapView.setHighlightLayers([
            { tiles: [fromId], color: HL_GREEN },
            { tiles: [tileId], color: HL_ORANGE },
        ]);
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
            applyModeHighlight();
            return;
        }
    }
    sel.length = 0;
    applyModeHighlight();
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
        applyModeHighlight();
        return;
    }

    const fromId = sel[0]!;
    if (tileId === fromId) { sel.length = 0; applyModeHighlight(); return; }
    if (!isNeighbour(fromId, tileId)) return;

    const avail = availableInTile(fromId);
    mapView.setHighlightLayers([
        { tiles: [fromId], color: HL_GREEN },
        { tiles: [tileId], color: HL_ORANGE },
    ]);
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
        applyModeHighlight();
        return;
    }

    if (sel.length === 1) {
        // шаг 2: выбор target_from. Разрешено tileId === from (см. §validateOrders).
        // Отмена шага — правый клик или Esc.
        const fromId = sel[0]!;
        sel.push(tileId);
        applyModeHighlight();
        return;
    }

    const [fromId, targetFromId] = sel as [number, number];
    // target_to должен быть соседом и from, и target_from.
    // Совпадение с from/target_from запрещено (иначе это вырожденный случай).
    if (tileId === fromId || tileId === targetFromId) {
        sel.length = 0;
        applyModeHighlight();
        return;
    }
    if (!isNeighbour(targetFromId, tileId)) return;
    if (!isNeighbour(fromId, tileId)) return;

    const avail = availableInTile(fromId);
    // Preview-подсветка [from(green), target_from(orange), target_to(red)].
    // При from === target_from — тот же тайл: orange перекрывает green,
    // но red отдельный, поэтому визуально читается как «источник = цель атаки».
    const preview = new Map<number, string>();
    preview.set(fromId, HL_GREEN);
    preview.set(targetFromId, HL_ORANGE);
    preview.set(tileId, HL_RED);
    mapView.setHighlightLayers(
        [...preview.entries()].map(([id, color]) => ({ tiles: [id], color })),
    );
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
            renderOrders();
        },
    });
}

// --- Order 1: инвестиции ---
function handleInvestClick(tileId: number): void {
    if (!currentState) return;
    const tile = currentState.tiles[tileId];
    if (!tile) return;

    if (investmentTiles.has(tileId)) investmentTiles.delete(tileId);
    else investmentTiles.add(tileId);
    syncInvestOrder();
    renderOrders();
}

/**
 * Превращает текущий persistent-выбор invest в Order 1 и добавляет его
 * к pendingOrders. Вызывается в момент «Готов», до отправки на сервер.
 * Если тайлов нет или сумма = 0 — ничего не делает.
 */
function commitInvestDraft(): void {
    if (investmentTiles.size === 0) return;
    const amount = parseInt(investAmountEl.value, 10) || 0;
    if (amount <= 0) return;
    if (!currentState || yourCountryIdx == null) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;

    pendingOrders.push({
        type: 1, owner: me,
        investments: amount,
        tiles: [...investmentTiles].map(id => currentState!.tiles[id]!),
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
// --- Order 5: отступление ---
function handleRetreatClick(tileId: number): void {
    if (!currentState || yourCountryIdx == null) return;
    const me = currentState.countries[yourCountryIdx];
    if (!me) return;
    const tile = currentState.tiles[tileId];
    if (!tile) return;

    const sel = modeSelection.tiles;

    if (sel.length === 0) {
        // Order 5 допустим для любого тайла: retreat_province индексируется
        // по стране, и он релевантен не только для обороны своих тайлов,
        // но и для атаки на чужие — при провале атаки отступающие уходят
        // в retreat_province[своя страна] именно атакованного тайла.
        sel.push(tileId);
        applyModeHighlight();
        return;
    }

    const fromId = sel[0]!;
    if (tileId === fromId) { sel.length = 0; applyModeHighlight(); return; }
    if (!isNeighbour(fromId, tileId)) return;

    mapView.setHighlightLayers([
        { tiles: [fromId], color: HL_GREEN },
        { tiles: [tileId], color: HL_ORANGE },
    ]);
    openConfirmModal({
        title: `Отступление: ${fromId} → ${tileId}`,
        body: 'Назначить этот тайл как точку отступления для своих войск из указанного тайла?',
        onConfirm: () => {
            const fromTile = currentState!.tiles[fromId]!;
            for (let i = pendingOrders.length - 1; i >= 0; i--) {
                const o = pendingOrders[i]!;
                if (o.type === 5 && o.tile === fromTile) pendingOrders.splice(i, 1);
            }
            pendingOrders.push({
                type: 5, owner: me,
                tile: fromTile,
                retreat_province: currentState!.tiles[tileId]!,
            });
            sel.length = 0;
            renderOrders();
        },
    });
}

// --- Rename ---
function handleRenameClick(tileId: number): void {
    openRenameModal(tileId);
}

// ==================== Dispatcher кликов по карте ====================

mapView.onCancelStep(() => {
    cancelCurrentStep();
});

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
            body: JSON.stringify({ orders: ordersToJSON(ordersForSend()), ready: true }),
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
    syncInvestOrder();
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
                        syncInvestOrder();
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
                // Invest-черновик персистентен: сохраняем его, сбрасываем всё остальное.
                pendingOrders = pendingOrders.filter(o => o.type === 1);
                syncInvestOrder();
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
                // Invest-черновик персистентен: сохраняем, пересинхронизируем
                // owner-ссылки (currentState уже заменён выше).
                pendingOrders = pendingOrders.filter(o => o.type === 1);
                syncInvestOrder();
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