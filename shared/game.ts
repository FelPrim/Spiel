// 22/10/2026
// =====================================================================
// Types
// =====================================================================

export interface Country {
  id: number;
  capital: Tile | null;
  treasury: number;
  tiles: Tile[];
  gifts: number; // ephemeral
}

export interface Army {
  infantry: number;
  cannons: number;
  locationmovement: Tile;
  losedinfantry: number; // ephemeral
  losedcannons: number;  // ephemeral
  infantrywithoutbonus: number; // ephemeral
  usedcannons: number;          // ephemeral
}

export interface Support {
  infantry: number;
  cannons: number;
  sourceArmy: Army;
}

export interface ArmyGroup {
  army: Army;
  support: Support[];
  /**
   * Если задано, страна-атакующий берётся отсюда, а не из
   * neighbours[i].ownerprevmove. Используется Order 4, когда столица
   * оккупирована: купленные юниты сражаются за покупателя.
   * Не сериализуется — фантомные атакующие живут только в пределах
   * одного хода (после шага 7 tile.arrived обнуляется).
   */
  phantomOwner?: Country | null;
}

export interface Tile {
  id: number;
  owner: Country | null;
  ownerprevmove: Country | null;
  neighbours: Tile[];
  economy: number;
  retreat_province: (Tile | null)[]; // indexed by country index
  investments: number; // ephemeral
  defenders: ArmyGroup;
  incoming: (ArmyGroup | null)[]; // indexed by neighbour index
  arrived: (ArmyGroup | null)[];  // indexed by neighbour index
}

export interface GameState {
  turn: number;
  countriescount: number;
  tilescount: number;
  tiles: Tile[];
  countries: Country[];
}

export type Order =
  | { type: 1; owner: Country; investments: number; tiles: Tile[] }
  | { type: 3; owner: Country; recipient: Country; gift: number }
  | { type: 4; owner: Country; infantry: number; cannons: number }
  | { type: 5; owner: Country; tile: Tile; retreat_province: Tile }
  | { type: 6; owner: Country; from: Tile; to: Tile; infantry: number; cannons: number }
  | { type: 7; owner: Country; from: Tile; target_from: Tile; target_to: Tile; infantry: number; cannons: number }
  | { type: 8; owner: Country; from: Tile; target: Tile; infantry: number; cannons: number };

// =====================================================================
// Constants & helpers
// =====================================================================

const INFANTRY_COST = 1;
const CANNON_COST = 3;
const TREASURY_RETENTION = 0.8;
const EPS = 1e-9;

export const INITIAL_ECONOMY = 1000;
export const INITIAL_TREASURY = 1000; 
export const INITIAL_INFANTRY = 0;
export const INITIAL_CANNONS = 0;

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function warn(msg: string): void {
  // eslint-disable-next-line no-console
  console.warn(msg);
}

export function createArmy(loc: Tile): Army {
  return {
    infantry: 0, cannons: 0,
    locationmovement: loc,
    losedinfantry: 0, losedcannons: 0,
    infantrywithoutbonus: 0, usedcannons: 0,
  };
}

export function createArmyGroup(target: Tile): ArmyGroup {
  const dummy = createArmy(target);
  return {
    army: createArmy(target),
    support: target.neighbours.map(() => ({ infantry: 0, cannons: 0, sourceArmy: dummy })),
  };
}

function isGroupEmpty(g: ArmyGroup): boolean {
  if (g.army.infantry > 0 || g.army.cannons > 0) return false;
  for (const s of g.support) {
    if (s.infantry > 0 || s.cannons > 0) return false;
  }
  return true;
}

function supportInfantryTotal(g: ArmyGroup): number {
  let t = 0;
  for (const s of g.support) t += s.infantry;
  return t;
}

function supportCannonsTotal(g: ArmyGroup): number {
  let t = 0;
  for (const s of g.support) t += s.cannons;
  return t;
}



// =====================================================================
// Initial state
// =====================================================================

export interface InitialStateParams {
  tilecount: number;
  neighbours: number[][];
  capitals: number[];
  startingEconomy: number;
  startingTreasury: number;
  initialOwnership?: Map<number, number>;
  /**
   * Опционально: tileId → economy. Если задан — используется вместо
   * startingEconomy для всех тайлов. Длина должна совпадать с tilecount,
   * значения >= 0.
   */
  tileEconomies?: number[];
}

export function createInitialState(params: InitialStateParams): GameState {
  const {
    tilecount, neighbours, capitals, startingEconomy, startingTreasury,
    tileEconomies,
  } = params;

  if (neighbours.length !== tilecount) {
    throw new Error(
      `createInitialState: neighbours.length=${neighbours.length} != tilecount=${tilecount}`,
    );
  }

  // --- валидация tileEconomies (если задан) ---
  if (tileEconomies !== undefined) {
    if (tileEconomies.length !== tilecount) {
      throw new Error(
        `createInitialState: tileEconomies.length=${tileEconomies.length} != tilecount=${tilecount}`,
      );
    }
    for (let i = 0; i < tileEconomies.length; i++) {
      const e = tileEconomies[i]!;
      if (!Number.isFinite(e) || e < 0) {
        throw new Error(`createInitialState: tileEconomies[${i}]=${e} должно быть конечным и >= 0`);
      }
    }
  }

  const K = capitals.length;
  if (K === 0) throw new Error('createInitialState: нет ни одной страны');

  for (let i = 0; i < tilecount; i++) {
    for (const j of neighbours[i]!) {
      if (j < 0 || j >= tilecount) {
        throw new Error(`createInitialState: neighbours[${i}] содержит ${j} вне диапазона`);
      }
      if (!neighbours[j]!.includes(i)) {
        throw new Error(`createInitialState: neighbours не симметричны (${i} → ${j}, но не наоборот)`);
      }
    }
  }

  const ownership = new Map<number, number>();
  if (params.initialOwnership) {
    for (const [tileId, countryIdx] of params.initialOwnership) {
      if (!Number.isInteger(tileId) || tileId < 0 || tileId >= tilecount) {
        throw new Error(`createInitialState: initialOwnership[${tileId}] вне диапазона`);
      }
      if (!Number.isInteger(countryIdx) || countryIdx < 0 || countryIdx >= K) {
        throw new Error(`createInitialState: initialOwnership value ${countryIdx} вне диапазона`);
      }
      ownership.set(tileId, countryIdx);
    }
  } else {
    for (let i = 0; i < K; i++) {
      const cap = capitals[i]!;
      if (!Number.isInteger(cap) || cap < 0 || cap >= tilecount) {
        throw new Error(`createInitialState: capitals[${i}]=${cap} вне диапазона`);
      }
      if (ownership.has(cap)) {
        throw new Error(`createInitialState: столица ${cap} назначена двум странам`);
      }
      ownership.set(cap, i);
    }
  }

  for (let i = 0; i < K; i++) {
    if (ownership.get(capitals[i]!) !== i) {
      throw new Error(
        `createInitialState: столица страны ${i} (tileId=${capitals[i]}) не принадлежит ей`,
      );
    }
  }

  const tiles: Tile[] = [];
  for (let i = 0; i < tilecount; i++) {
    tiles.push({
      id: i,
      owner: null,
      ownerprevmove: null,
      neighbours: [],
      economy: tileEconomies !== undefined ? tileEconomies[i]! : startingEconomy,
      retreat_province: new Array(K).fill(null),
      investments: 0,
      defenders: null as unknown as ArmyGroup,
      incoming: neighbours[i]!.map(() => null),
      arrived:  neighbours[i]!.map(() => null),
    });
  }
  for (let i = 0; i < tilecount; i++) {
    tiles[i]!.neighbours = neighbours[i]!.map(j => tiles[j]!);
  }

  // прим. 1: вместо ручного конструирования ArmyGroup использую
  // экспортированный createArmyGroup — семантика идентична,
  // и меньше дублирования.
  for (const tile of tiles) {
    tile.defenders = createArmyGroup(tile);
  }

  const countries: Country[] = [];
  for (let i = 0; i < K; i++) {
    countries.push({
      id: i,
      capital: tiles[capitals[i]!]!,
      treasury: startingTreasury,
      tiles: [],
      gifts: 0,
    });
  }

  for (const [tileId, countryIdx] of ownership) {
    tiles[tileId]!.owner = countries[countryIdx]!;
  }
  for (let i = 0; i < tilecount; i++) {
    const c = tiles[i]!.owner;
    if (c) c.tiles.push(tiles[i]!);
  }

  return {
    turn: 0,
    countriescount: K,
    tilescount: tilecount,
    tiles,
    countries,
  };
}






// =====================================================================
// Order validation
// =====================================================================
//
// Returns the subset of `orders` that are safe to apply. Two independent
// rejection rules:
//
//   1. Structural: an order references bad tiles, has negative amounts,
//      or violates an adjacency / self-loop constraint.
//   2. Budget: the total demand on a single tile across Orders 6/7/8
//      exceeds the tile's `defenders.army.{infantry,cannons}`. In that
//      case *all* Orders 6/7/8 from that tile are rejected, because
//      per-unit first-come-first-served would depend on the order of
//      elements in the input array.
//
// Orders 1/3/4 are NOT checked here for affordability — that is handled
// inside applyTurn (step 4) and cancels *all* economic orders of the
// country, which is a separate rule.

export function validateOrders(state: GameState, orders: Order[]): Order[] {
  const tileSet = new Set(state.tiles);
  const countrySet = new Set(state.countries);

  // --- Pass 1: structural checks. ---
  const structurallyValid: Order[] = [];
  for (const o of orders) {
    if (!countrySet.has(o.owner)) continue;

    switch (o.type) {
      case 1: {
        if (o.investments < 0) break;
        if (o.tiles.some(t => !tileSet.has(t))) break;
        structurallyValid.push(o);
        break;
      }
      case 3: {
        if (o.gift < 0) break;
        if (!countrySet.has(o.recipient)) break;
        structurallyValid.push(o);
        break;
      }
      case 4: {
        if (o.infantry < 0 || o.cannons < 0) break;
        structurallyValid.push(o);
        break;
      }
      case 5: {
        if (!tileSet.has(o.tile) || !tileSet.has(o.retreat_province)) break;
        if (o.retreat_province === o.tile) break;
        if (!o.tile.neighbours.includes(o.retreat_province)) break;
        structurallyValid.push(o);
        break;
      }
      case 6: {
        if (!tileSet.has(o.from) || !tileSet.has(o.to)) break;
        if (o.from === o.to) break;
        if (!o.from.neighbours.includes(o.to)) break;
        if (o.infantry < 0 || o.cannons < 0) break;
        structurallyValid.push(o);
        break;
      }
      case 7: {
        if (!tileSet.has(o.from) || !tileSet.has(o.target_from) || !tileSet.has(o.target_to)) break;
        // from === target_from допустимо: одна и та же армия атакует и
        // поддерживает атаку (её "поддержка" путешествует вместе с ней
        // и считается частью того же incoming-группы на target_to).
        if (!o.target_to.neighbours.includes(o.target_from)) break;
        if (!o.target_to.neighbours.includes(o.from)) break;
        if (o.infantry < 0 || o.cannons < 0) break;
        structurallyValid.push(o);
        break;
      }
      case 8: {
        if (!tileSet.has(o.from) || !tileSet.has(o.target)) break;
        if (o.from === o.target) break;
        if (!o.target.neighbours.includes(o.from)) break;
        if (o.infantry < 0 || o.cannons < 0) break;
        structurallyValid.push(o);
        break;
      }
    }
  }

  // --- Pass 2: per-tile budget for Orders 6/7/8. ---
  const demandByTile = new Map<
    Tile,
    { infantry: number; cannons: number; orders: Order[] }
  >();
  for (const o of structurallyValid) {
    if (o.type !== 6 && o.type !== 7 && o.type !== 8) continue;
    let bucket = demandByTile.get(o.from);
    if (!bucket) {
      bucket = { infantry: 0, cannons: 0, orders: [] };
      demandByTile.set(o.from, bucket);
    }
    bucket.infantry += o.infantry;
    bucket.cannons += o.cannons;
    bucket.orders.push(o);
  }

  const rejected = new Set<Order>();
  for (const [tile, bucket] of demandByTile) {
    const availInf = tile.defenders.army.infantry;
    const availCan = tile.defenders.army.cannons;
    if (bucket.infantry > availInf + EPS || bucket.cannons > availCan + EPS) {
      for (const o of bucket.orders) rejected.add(o);
    }
  }

  return structurallyValid.filter(o => !rejected.has(o));
}

// =====================================================================
// Entry point
// =====================================================================

export interface ApplyTurnOptions {
  /**
   * Вызывается между фазой движения (шаг 6) + размещением купленных
   * юнитов (шаг 6.5) и главной битвой (шаг 7). На момент вызова:
   *   - движение разрешено, `ownerprevmove` переключён;
   *   - купленные юниты уже в `defenders.army` (своя столица)
   *     или в `arrived` как phantom-группы (оккупированная);
   *   - `turn` ещё не инкрементирован, битвы не разрешены,
   *     `Country.tiles` не перестроены, income не начислен.
   */
  onMovementPhase?: (state: GameState) => void;
}

export function applyTurn(
  state: GameState,
  orders: Order[],
  options?: ApplyTurnOptions,
): GameState {
  // 0. Silently drop structurally invalid or over-budget orders.
  const validOrders = validateOrders(state, orders);

  // 1. Snapshot ownerprevmove, reset ephemerals.
  for (const tile of state.tiles) {
    tile.ownerprevmove = tile.owner;
    tile.investments = 0;
    tile.incoming = tile.neighbours.map(() => null);
    tile.arrived = tile.neighbours.map(() => null);
    tile.defenders.support = tile.neighbours.map(() => ({
      infantry: 0, cannons: 0, sourceArmy: tile.defenders.army,
    }));
    tile.defenders.army.losedinfantry = 0;
    tile.defenders.army.losedcannons = 0;
    // NOT reset here: `infantrywithoutbonus` and `usedcannons`.
    //
    // These two fields are "physical" carriers for units that have been
    // temporarily moved out of `infantry`/`cannons`:
    //   - `infantrywithoutbonus` holds support-infantry allocated by
    //     Order 7/8 (see spec §2);
    //   - `usedcannons` holds cannons that have already fired this turn
    //     (support cannons after Order 7/8, or main cannons that fired
    //     in a movement-phase edge clash).
    //
    // `postprocess` (step 9) flushes both back into `infantry`/`cannons`
    // and zeroes them, and `resetEphemeralsOnArmy` (step 12) does it once
    // more. So a well-formed state entering `applyTurn` already has them
    // at 0. Zeroing them again at the top would silently discard mid-turn
    // state that callers (tests, or a future "resume from snapshot") may
    // legitimately set up — e.g. a defender that spent its cannons as
    // support last phase and is now being attacked in its own tile.
  }
  for (const c of state.countries) c.gifts = 0;

  // 2. Order 5: retreat provinces.
  const order5 = validOrders.filter(o => o.type === 5) as Extract<Order, { type: 5 }>[];
  for (const o of order5) {
    o.tile.retreat_province[o.owner.id] = o.retreat_province;
  }

  // 3. Orders 6/7/8: carve the garrisons.
  const order6 = validOrders.filter(o => o.type === 6) as Extract<Order, { type: 6 }>[];
  const order7 = validOrders.filter(o => o.type === 7) as Extract<Order, { type: 7 }>[];
  const order8 = validOrders.filter(o => o.type === 8) as Extract<Order, { type: 8 }>[];

  // 3a. Order 6 — movement.
  for (const o of order6) {
    const from = o.from, to = o.to;
    const j = to.neighbours.indexOf(from);
    if (j < 0) { warn(`Order6: ${from.id} not a neighbour of ${to.id}`); continue; }
    if (!to.incoming[j]) to.incoming[j] = createArmyGroup(to);
    const g = to.incoming[j]!;
    g.army.infantry += o.infantry;
    g.army.cannons += o.cannons;
    g.army.locationmovement = from;
    from.defenders.army.infantry -= o.infantry;
    from.defenders.army.cannons -= o.cannons;
  }

  // 3b. Order 7 — support for a transition.
  for (const o of order7) {
    const supportFrom = o.from, targetFrom = o.target_from, targetTo = o.target_to;
    const jMain = targetTo.neighbours.indexOf(targetFrom);
    const jSupport = targetTo.neighbours.indexOf(supportFrom);
    if (jMain < 0) { warn(`Order7: target_from not neighbour of target_to`); continue; }
    if (jSupport < 0) { warn(`Order7: from not neighbour of target_to`); continue; }

    if (!targetTo.incoming[jMain]) targetTo.incoming[jMain] = createArmyGroup(targetTo);
    const g = targetTo.incoming[jMain]!;

    supportFrom.defenders.army.infantry -= o.infantry;
    supportFrom.defenders.army.cannons -= o.cannons;
    supportFrom.defenders.army.infantrywithoutbonus += o.infantry;
    supportFrom.defenders.army.usedcannons += o.cannons;

    const s = g.support[jSupport]!;
    s.infantry += o.infantry;
    s.cannons += o.cannons;
    s.sourceArmy = supportFrom.defenders.army;
  }

  // 3c. Order 8 — support for defense.
  for (const o of order8) {
    const supportFrom = o.from, target = o.target;
    const j = target.neighbours.indexOf(supportFrom);
    if (j < 0) { warn(`Order8: from not neighbour of target`); continue; }

    supportFrom.defenders.army.infantry -= o.infantry;
    supportFrom.defenders.army.cannons -= o.cannons;
    supportFrom.defenders.army.infantrywithoutbonus += o.infantry;
    supportFrom.defenders.army.usedcannons += o.cannons;

    const s = target.defenders.support[j]!;
    s.infantry += o.infantry;
    s.cannons += o.cannons;
    s.sourceArmy = supportFrom.defenders.army;
  }

  // 4. Orders 1/3/4 — economy. Per-country affordability check.
  const order1 = validOrders.filter(o => o.type === 1) as Extract<Order, { type: 1 }>[];
  const order3 = validOrders.filter(o => o.type === 3) as Extract<Order, { type: 3 }>[];
  const order4 = validOrders.filter(o => o.type === 4) as Extract<Order, { type: 4 }>[];

  const spent = new Map<Country, number>();
  for (const c of state.countries) spent.set(c, 0);
  for (const o of order1) spent.set(o.owner, (spent.get(o.owner) ?? 0) + o.investments);
  for (const o of order3) spent.set(o.owner, (spent.get(o.owner) ?? 0) + o.gift);
  for (const o of order4) spent.set(o.owner, (spent.get(o.owner) ?? 0) + o.infantry * INFANTRY_COST + o.cannons * CANNON_COST);

  const affordable = new Map<Country, boolean>();
  for (const c of state.countries) affordable.set(c, (spent.get(c) ?? 0) <= c.treasury + EPS);

  for (const o of order1) {
    if (!affordable.get(o.owner)) continue;
    for (const t of o.tiles) t.investments += o.investments;
    o.owner.treasury -= o.investments;
  }
  for (const o of order3) {
    if (!affordable.get(o.owner)) continue;
    o.recipient.gifts += o.gift;
    o.owner.treasury -= o.gift;
  }
  const affordableOrder4: Extract<Order, { type: 4 }>[] = [];
  for (const o of order4) {
    if (!affordable.get(o.owner)) continue;
    o.owner.treasury -= o.infantry * INFANTRY_COST + o.cannons * CANNON_COST;
    affordableOrder4.push(o);
  }

  // 5. Economy formula.
  const halfTiles = state.tilescount / 2;
  for (const tile of state.tiles) {
    if (Math.abs(tile.economy) < EPS) continue;
    const denom = halfTiles * tile.economy;
    tile.economy = tile.economy * (2 - 1 / (1 + tile.investments / denom));
    tile.economy = round3(tile.economy);
  }

  // 6. Movement phase.
  resolveMovementPhase(state);


  // 6.5. Order 4 — размещение купленных юнитов.
  //
  // Если столица всё ещё принадлежит покупателю (ownerprevmove === buyer),
  // юниты идут в defenders.army как обычно.
  //
  // Если столица оккупирована, юниты спавнятся как «фантомный атакующий»
  // в arrived: они принадлежат покупателю (phantomOwner) и в главной
  // битве сражаются против оккупанта, а не вливаются в его армию.
  for (const o of affordableOrder4) {
    const cap = o.owner.capital;
    if (!cap) continue;
    if (cap.ownerprevmove === o.owner) {
      cap.defenders.army.infantry += o.infantry;
      cap.defenders.army.cannons += o.cannons;
      continue;
    }
    // Ищем свободный слот в arrived (или уже существующую фантомную
    // группу этого же покупателя, если несколько Order 4 подряд).
    let idx = -1;
    for (let i = 0; i < cap.arrived.length; i++) {
      if (!cap.arrived[i]) { idx = i; break; }
    }
    if (idx < 0) {
      for (let i = 0; i < cap.arrived.length; i++) {
        const g = cap.arrived[i];
        if (g && g.phantomOwner === o.owner) { idx = i; break; }
      }
    }
    if (idx < 0) continue; // нет свободного слота — крайне редко
    if (!cap.arrived[idx]) {
      const g = createArmyGroup(cap);
      g.phantomOwner = o.owner;
      cap.arrived[idx] = g;
    }
    const g = cap.arrived[idx]!;
    g.army.infantry += o.infantry;
    g.army.cannons += o.cannons;
  }
  
  if (options?.onMovementPhase) options.onMovementPhase(state);
  
  // 7. Main battle phase.
  const pendingRetreats: RetreatPlan[] = [];
  resolveMainBattlePhase(state, pendingRetreats);

  // 8. Retreat phase.
  resolveRetreatPhase(state, pendingRetreats);

  // 9. Postprocess.
  postprocess(state);

  // 10. Update Country.tiles.
  for (const c of state.countries) c.tiles = [];
  for (const tile of state.tiles) if (tile.owner) tile.owner.tiles.push(tile);

  // 11. Income.
  for (const c of state.countries) {
    let income = 0;
    for (const t of c.tiles) income += t.economy;
    c.treasury = c.treasury * TREASURY_RETENTION + c.gifts + income;
    c.treasury = round3(c.treasury);
  }

  // 12. Reset remaining ephemerals.
  for (const c of state.countries) c.gifts = 0;
  for (const tile of state.tiles) {
    tile.investments = 0;
    tile.incoming = tile.neighbours.map(() => null);
    tile.arrived = tile.neighbours.map(() => null);
    resetEphemeralsOnArmy(tile.defenders.army);
    for (const s of tile.defenders.support) {
      s.infantry = 0; s.cannons = 0; s.sourceArmy = tile.defenders.army;
    }
  }

  state.turn += 1;
  return state;
}

function resetEphemeralsOnArmy(a: Army): void {
  a.losedinfantry = 0;
  a.losedcannons = 0;
  a.infantrywithoutbonus = 0;
  a.usedcannons = 0;
}

// =====================================================================
// Movement phase
// =====================================================================

interface MovementResult {
  a1: { ai: number; ac: number; pi: number; pc: number; si: number; sc: number; sik: number; sip: number };
  a2: { ai: number; ac: number; pi: number; pc: number; si: number; sc: number; sik: number; sip: number };
}

export function movementPhaseScalar(
  infantry1: number, cannons1: number, supportInf1: number, supportCan1: number,
  infantry2: number, cannons2: number, supportInf2: number, supportCan2: number,
): MovementResult {
  const startSInf1 = supportInf1;
  const startSInf2 = supportInf2;

  let remainingDamage1 = cannons1 + supportCan1;
  let remainingDamage2 = cannons2 + supportCan2;
  let fired1 = 0, fired2 = 0;

  // --- Barrage: infantry → support infantry → main cannons ---
  if (infantry2 >= remainingDamage1) { infantry2 -= remainingDamage1; fired1 += remainingDamage1; remainingDamage1 = 0; }
  else { fired1 += infantry2; remainingDamage1 -= infantry2; infantry2 = 0; }
  if (supportInf2 >= remainingDamage1) { supportInf2 -= remainingDamage1; fired1 += remainingDamage1; remainingDamage1 = 0; }
  else { fired1 += supportInf2; remainingDamage1 -= supportInf2; supportInf2 = 0; }
  if (cannons2 >= remainingDamage1) { cannons2 -= remainingDamage1; fired1 += remainingDamage1; remainingDamage1 = 0; }
  else { fired1 += cannons2; remainingDamage1 -= cannons2; cannons2 = 0; }

  if (infantry1 >= remainingDamage2) { infantry1 -= remainingDamage2; fired2 += remainingDamage2; remainingDamage2 = 0; }
  else { fired2 += infantry1; remainingDamage2 -= infantry1; infantry1 = 0; }
  if (supportInf1 >= remainingDamage2) { supportInf1 -= remainingDamage2; fired2 += remainingDamage2; remainingDamage2 = 0; }
  else { fired2 += supportInf1; remainingDamage2 -= supportInf1; supportInf1 = 0; }
  if (cannons1 >= remainingDamage2) { cannons1 -= remainingDamage2; fired2 += remainingDamage2; remainingDamage2 = 0; }
  else { fired2 += cannons1; remainingDamage2 -= cannons1; cannons1 = 0; }

  const killedSInf1 = startSInf1 - supportInf1;
  const killedSInf2 = startSInf2 - supportInf2;
  const afterBarrageSInf1 = supportInf1;
  const afterBarrageSInf2 = supportInf2;

  // --- Support cannons (never killed, only "used") ---
  let mainFired1 = 0, mainFired2 = 0;
  if (supportCan1 >= fired1) { supportCan1 -= fired1; fired1 = 0; }
  else { fired1 -= supportCan1; supportCan1 = 0; }
  if (cannons1 >= fired1) { mainFired1 = fired1; cannons1 -= fired1; fired1 = 0; }
  else { mainFired1 = cannons1; cannons1 = 0; fired1 = 0; }
  if (supportCan2 >= fired2) { supportCan2 -= fired2; fired2 = 0; }
  else { fired2 -= supportCan2; supportCan2 = 0; }
  if (cannons2 >= fired2) { mainFired2 = fired2; cannons2 -= fired2; fired2 = 0; }
  else { mainFired2 = cannons2; cannons2 = 0; fired2 = 0; }

  // --- Infantry clash ---
  let power1 = infantry1 + supportInf1;
  let power2 = infantry2 + supportInf2;
  const preClashInf1 = infantry1;
  const preClashInf2 = infantry2;

  if (supportInf1 >= power2) { supportInf1 -= power2; power2 = 0; }
  else { power2 -= supportInf1; supportInf1 = 0; }
  if (infantry1 >= power2) { infantry1 -= power2; power2 = 0; }
  else { power2 -= infantry1; infantry1 = 0; }

  if (supportInf2 >= power1) { supportInf2 -= power1; power1 = 0; }
  else { power1 -= supportInf2; supportInf2 = 0; }
  if (infantry2 >= power1) { infantry2 -= power1; power1 = 0; }
  else { power1 -= infantry2; infantry2 = 0; }

  const activeInf1 = infantry1, activeInf2 = infantry2;
  const passiveInf1 = preClashInf1 - infantry1;
  const passiveInf2 = preClashInf2 - infantry2;
  const pushedSInf1 = afterBarrageSInf1 - supportInf1;
  const pushedSInf2 = afterBarrageSInf2 - supportInf2;

  let activeCan1 = 0, activeCan2 = 0;
  let passiveCan1 = 0, passiveCan2 = 0;
  const side1HasInf = infantry1 > 0 || supportInf1 > 0;
  const side2HasInf = infantry2 > 0 || supportInf2 > 0;

  if (!side1HasInf && !side2HasInf) {
    activeCan1 = cannons1; activeCan2 = cannons2;
    passiveCan1 = mainFired1; passiveCan2 = mainFired2;
  } else if (!side1HasInf) {
    activeCan2 = cannons2 + mainFired1;
    passiveCan2 = mainFired2;
  } else {
    activeCan1 = cannons1 + mainFired2;
    passiveCan1 = mainFired1;
  }

  return {
    a1: { ai: activeInf1, ac: activeCan1, pi: passiveInf1, pc: passiveCan1,
          si: supportInf1, sc: supportCan1, sik: killedSInf1, sip: pushedSInf1 },
    a2: { ai: activeInf2, ac: activeCan2, pi: passiveInf2, pc: passiveCan2,
          si: supportInf2, sc: supportCan2, sik: killedSInf2, sip: pushedSInf2 },
  };
}

function resolveMovementPhase(state: GameState): void {
  const done = new Set<string>();

  for (const A of state.tiles) {
    for (let iB = 0; iB < A.neighbours.length; iB++) {
      const B = A.neighbours[iB]!;
      const key = A.id < B.id ? `${A.id}-${B.id}` : `${B.id}-${A.id}`;
      if (done.has(key)) continue;
      done.add(key);

      const jA = B.neighbours.indexOf(A);
      if (jA < 0) continue;

      const groupFromA = B.incoming[jA] ?? null;
      const groupFromB = A.incoming[iB] ?? null;

      const hasA = groupFromA != null && !isGroupEmpty(groupFromA);
      const hasB = groupFromB != null && !isGroupEmpty(groupFromB);

      if (hasA && hasB && A.ownerprevmove !== B.ownerprevmove) {
        resolveEdgeClash(A, B, groupFromA!, groupFromB!, jA, iB);
      } else {
        if (groupFromA) B.arrived[jA] = groupFromA;
        if (groupFromB) A.arrived[iB] = groupFromB;
      }
    }
  }
}

function resolveEdgeClash(
  tileA: Tile, tileB: Tile,
  groupFromA: ArmyGroup, groupFromB: ArmyGroup,
  jA: number, iB: number,
): void {
  const inf1 = groupFromA.army.infantry, can1 = groupFromA.army.cannons;
  const sInf1 = supportInfantryTotal(groupFromA), sCan1 = supportCannonsTotal(groupFromA);
  const inf2 = groupFromB.army.infantry, can2 = groupFromB.army.cannons;
  const sInf2 = supportInfantryTotal(groupFromB), sCan2 = supportCannonsTotal(groupFromB);

  // Snapshot support sizes at the start of the clash — both distributions
  // are proportional to these values.
  const snapA = groupFromA.support.map(s => s.infantry);
  const snapB = groupFromB.support.map(s => s.infantry);

  const r = movementPhaseScalar(inf1, can1, sInf1, sCan1, inf2, can2, sInf2, sCan2);

  // Killed first (priority), pushed second — see helpers.
  applySupportInfantryKilled(groupFromA, r.a1.sik, snapA);
  applySupportInfantryKilled(groupFromB, r.a2.sik, snapB);
  applySupportInfantryPushed(groupFromA, r.a1.sip, snapA);
  applySupportInfantryPushed(groupFromB, r.a2.sip, snapB);
  removeFiredSupportCannons(groupFromA, sCan1 - r.a1.sc);
  removeFiredSupportCannons(groupFromB, sCan2 - r.a2.sc);

  const side1HasInf = r.a1.ai > 0 || r.a1.si > 0;
  const side2HasInf = r.a2.ai > 0 || r.a2.si > 0;
  let winner: 1 | 2 | 0;
  if (side1HasInf && !side2HasInf) winner = 1;
  else if (!side1HasInf && side2HasInf) winner = 2;
  else winner = 0; // both with infantry → both retreat; both without → handled below

  const applySide = (
    group: ArmyGroup, res: MovementResult['a1'],
    isWinner: boolean, targetTile: Tile, targetIdx: number, sourceTile: Tile,
  ) => {
    const srcArmy = sourceTile.defenders.army;
    if (isWinner) {
      const newGroup = createArmyGroup(targetTile);
      newGroup.army.locationmovement = sourceTile;
      newGroup.army.infantry = res.ai;
      newGroup.army.cannons = res.ac;
      newGroup.army.usedcannons = res.pc;
      // Support records travel with the arrived group.
      for (let j = 0; j < group.support.length && j < newGroup.support.length; j++) {
        newGroup.support[j]!.infantry = group.support[j]!.infantry;
        newGroup.support[j]!.cannons  = group.support[j]!.cannons;
        newGroup.support[j]!.sourceArmy = group.support[j]!.sourceArmy;
      }
      // Passive infantry retreats back to locationmovement.
      srcArmy.infantrywithoutbonus += res.pi;
      targetTile.arrived[targetIdx] = newGroup;
    } else {
      // Loser: everything returns to source.
      srcArmy.infantrywithoutbonus += res.pi + res.ai;
      srcArmy.usedcannons += res.pc + res.ac;
    }
  };

  if (winner === 1) {
    applySide(groupFromA, r.a1, true,  tileB, jA, tileA);
    applySide(groupFromB, r.a2, false, tileA, iB, tileB);
  } else if (winner === 2) {
    applySide(groupFromB, r.a2, true,  tileA, iB, tileB);
    applySide(groupFromA, r.a1, false, tileB, jA, tileA);
  } else {
    applySide(groupFromA, r.a1, false, tileB, jA, tileA);
    applySide(groupFromB, r.a2, false, tileA, iB, tileB);
  }

  tileA.incoming[iB] = null;
  tileB.incoming[jA] = null;
}

// Killed by enemy cannons:
//   - subtract from sourceArmy.infantrywithoutbonus via losedinfantry
//   - remove from support[i].infantry
function applySupportInfantryKilled(
  group: ArmyGroup, killedTotal: number, snapshot: number[],
): void {
  if (killedTotal <= 0) return;
  let total = 0;
  for (const v of snapshot) total += v;
  if (total <= 0) return;
  for (let i = 0; i < group.support.length; i++) {
    const s = group.support[i]!;
    const alloc = Math.ceil(killedTotal * (snapshot[i] ?? 0) / total - EPS);
    const removed = Math.min(alloc, s.infantry);
    s.infantry -= removed;
    s.sourceArmy.losedinfantry += removed;
  }
}

// Pushed back by enemy infantry:
//   - remove from support[i].infantry only
//   - sourceArmy.infantrywithoutbonus is unchanged (unit stays home)
function applySupportInfantryPushed(
  group: ArmyGroup, pushedTotal: number, snapshot: number[],
): void {
  if (pushedTotal <= 0) return;
  let total = 0;
  for (const v of snapshot) total += v;
  if (total <= 0) return;
  for (let i = 0; i < group.support.length; i++) {
    const s = group.support[i]!;
    const alloc = Math.ceil(pushedTotal * (snapshot[i] ?? 0) / total - EPS);
    const removed = Math.min(alloc, s.infantry);
    s.infantry -= removed;
  }
}

// "Lost" здесь = "выстрелила": удаляется из support-записи, но НЕ добавляется
// в losedcannons — физически пушка остаётся в usedcannons исходной армии.
function removeFiredSupportCannons(group: ArmyGroup, firedCan: number): void {
  if (firedCan <= 0) return;
  let totalCan = 0;
  for (const s of group.support) totalCan += s.cannons;
  if (totalCan <= 0) return;
  for (const s of group.support) {
    const lc = Math.ceil(firedCan * s.cannons / totalCan - EPS);
    if (lc > 0) s.cannons = Math.max(0, s.cannons - lc);
  }
}

// =====================================================================
// Main battle phase
// =====================================================================

interface Party {
  countryIdx: number;
  country: Country | null;
  isDefender: boolean;
  groups: ArmyGroup[];
  infantry: number;
  infantrywithoutbonus: number;
  cannons: number;
  usedcannons: number;
  supportinfantry: number;
  supportcannons: number;
  supportStart: Array<{ group: ArmyGroup; j: number; startInf: number; startCan: number; sourceArmy: Army }>;
  power: number;
  damage: number;
  perceivedPower: number;
  attacks: Array<{ power: number; damage: number }>;
  activeInfantry: number;
  passiveInfantry: number;
  newCannons: number;
  activeSupportInfantry: number;
  passiveSupportInfantry: number;
  supportLostFromDamage: number;
}

interface BattlePlan {
  tile: Tile;
  parties: Party[];
  winnerIdx: number | null;
  retreating: boolean[];
}

function resolveMainBattlePhase(state: GameState, pendingRetreats: RetreatPlan[]): void {
  const plans: BattlePlan[] = [];
  for (const tile of state.tiles) {
    const plan = computeBattlePlan(tile, state);
    if (plan) plans.push(plan);
  }
  for (const plan of plans) {
    applyBattlePlan(plan, state, pendingRetreats);
  }
}

function computeBattlePlan(tile: Tile, state: GameState): BattlePlan | null {
  const defenderCountry = tile.ownerprevmove;
  const mergedAttackerIdx = new Set<number>();

  for (let i = 0; i < tile.neighbours.length; i++) {
    const g = tile.arrived[i];
    if (!g) continue;
    if (g.phantomOwner) continue; // фантом всегда атакует, не сливается
    const nbr = tile.neighbours[i]!;
    if (nbr.ownerprevmove === defenderCountry && defenderCountry !== null) {
      tile.defenders.army.infantrywithoutbonus += g.army.infantry;
      tile.defenders.army.cannons += g.army.cannons;
      tile.defenders.army.usedcannons += g.army.usedcannons;
      for (let j = 0; j < tile.neighbours.length; j++) {
        const s = g.support[j]!;
        if (s.infantry > 0 || s.cannons > 0) {
          const ds = tile.defenders.support[j]!;
          ds.infantry += s.infantry;
          ds.cannons += s.cannons;
          ds.sourceArmy = s.sourceArmy;
        }
      }
      mergedAttackerIdx.add(i);
    }
  }

  const attackerIndices = tile.neighbours
    .map((_, i) => i)
    .filter(i => !mergedAttackerIdx.has(i) && tile.arrived[i] != null);
  const hasAttackers = attackerIndices.some(i => {
    const g = tile.arrived[i]!;
    return g.army.infantry > 0 || g.army.cannons > 0
      || supportInfantryTotal(g) > 0 || supportCannonsTotal(g) > 0;
  });

  if (!hasAttackers) return null;

  const parties: Party[] = [];

  {
    const p = emptyParty(
      defenderCountry ? state.countries.indexOf(defenderCountry) : -1,
      defenderCountry, true, tile,
    );
    addGroupToParty(p, tile.defenders, tile);
    parties.push(p);
  }

  const byCountry = new Map<number, Party>();
  for (const i of attackerIndices) {
    const g = tile.arrived[i]!;
    const nbr = tile.neighbours[i]!;
    const country = g.phantomOwner ?? nbr.ownerprevmove;
    const ci = country ? state.countries.indexOf(country) : -1;
    let p = byCountry.get(ci);
    if (!p) {
      p = emptyParty(ci, country, false, tile);
      byCountry.set(ci, p);
      parties.push(p);
    }
    addGroupToParty(p, g, tile);
  }

  if (parties.length <= 1) return null;

  for (const p of parties) {
    p.power = p.isDefender
      ? 2 * p.infantry + p.infantrywithoutbonus + p.supportinfantry
      : p.infantry + p.supportinfantry;
    p.damage = p.cannons + p.supportcannons;
    p.perceivedPower = p.power + p.damage;
  }

  for (let i = 0; i < parties.length; i++) {
    const p = parties[i]!;
    p.attacks = parties.map(() => ({ power: 0, damage: 0 }));
    let den = 0;
    for (let k = 0; k < parties.length; k++) {
      if (k !== i) den += parties[k]!.perceivedPower;
    }
    if (den <= EPS) continue;
    for (let k = 0; k < parties.length; k++) {
      if (k === i) continue;
      const ratio = parties[k]!.perceivedPower / den;
      p.attacks[k]!.power = ratio * p.power;
      p.attacks[k]!.damage = ratio * p.damage;
    }
  }

  const incomingPower: number[] = parties.map(() => 0);
  const incomingDamage: number[] = parties.map(() => 0);
  for (let k = 0; k < parties.length; k++) {
    for (let i = 0; i < parties.length; i++) {
      if (i === k) continue;
      const pi = parties[i]!;
      incomingPower[k] = (incomingPower[k] ?? 0) + (pi.attacks[k]?.power ?? 0);
      incomingDamage[k] = (incomingDamage[k] ?? 0) + (pi.attacks[k]?.damage ?? 0);
    }
  }

  for (let i = 0; i < parties.length; i++) {
    const p = parties[i]!;
    const res = p.isDefender
      ? defend1vall(
          p.infantry, p.cannons, p.infantrywithoutbonus,
          p.supportinfantry, p.supportcannons,
          incomingPower[i]!, incomingDamage[i]!,
        )
      : attack1vall(
          p.infantry, p.cannons, p.supportinfantry, p.supportcannons,
          incomingPower[i]!, incomingDamage[i]!,
        );
    p.activeInfantry = res.activeinfantry;
    p.passiveInfantry = res.passiveinfantry;
    p.newCannons = res.newcannons;
    p.activeSupportInfantry = res.activesupportinfantry;
    p.passiveSupportInfantry = res.passivesupportinfantry;
    p.supportLostFromDamage = p.supportinfantry - (res.activesupportinfantry + res.passivesupportinfantry);
    if (p.supportLostFromDamage < 0) p.supportLostFromDamage = 0;
  }

  for (const p of parties) {
    if (p.supportLostFromDamage <= 0) continue;
    let totalStart = 0;
    for (const e of p.supportStart) totalStart += e.startInf;
    if (totalStart <= 0) continue;
    for (const e of p.supportStart) {
      const li = Math.ceil(p.supportLostFromDamage * e.startInf / totalStart - EPS);
      if (li > 0) {
        e.sourceArmy.losedinfantry += li;
        const slot = e.group.support[e.j]!;
        slot.infantry = Math.max(0, slot.infantry - li);
      }
    }
  }

  for (const p of parties) {
    if (p.passiveSupportInfantry <= 0) continue;
    let totalStart = 0;
    for (const e of p.supportStart) totalStart += e.startInf;
    if (totalStart <= 0) continue;
    for (const e of p.supportStart) {
      const dr = Math.ceil(p.passiveSupportInfantry * e.startInf / totalStart - EPS);
      const slot = e.group.support[e.j]!;
      slot.infantry = Math.max(0, slot.infantry - dr);
    }
  }

  const isWinner = parties.map(p => p.activeInfantry > 0 || p.activeSupportInfantry > 0);
  const winnerCount = isWinner.filter(Boolean).length;
  let winnerIdx: number | null = null;
  if (winnerCount === 1) winnerIdx = isWinner.indexOf(true);
  else if (winnerCount === 0) {
    const hasCan = parties.map(p => p.newCannons > 0.5);
    const canCount = hasCan.filter(Boolean).length;
    if (canCount === 1) winnerIdx = hasCan.indexOf(true);
  }

  return {
    tile, parties, winnerIdx,
    retreating: parties.map((_, i) => winnerIdx !== i),
  };
}

function emptyParty(countryIdx: number, country: Country | null, isDefender: boolean, tile: Tile): Party {
  return {
    countryIdx, country, isDefender, groups: [],
    infantry: 0, infantrywithoutbonus: 0, cannons: 0, usedcannons: 0,
    supportinfantry: 0, supportcannons: 0,
    supportStart: [],
    power: 0, damage: 0, perceivedPower: 0,
    attacks: [],
    activeInfantry: 0, passiveInfantry: 0, newCannons: 0,
    activeSupportInfantry: 0, passiveSupportInfantry: 0,
    supportLostFromDamage: 0,
  };
}

function addGroupToParty(p: Party, g: ArmyGroup, tile: Tile): void {
  p.groups.push(g);
  p.infantry += g.army.infantry;
  p.infantrywithoutbonus += g.army.infantrywithoutbonus;
  p.cannons += g.army.cannons;
  p.usedcannons += g.army.usedcannons;
  for (let j = 0; j < tile.neighbours.length; j++) {
    const s = g.support[j]!;
    if (s.infantry > 0 || s.cannons > 0) {
      p.supportinfantry += s.infantry;
      p.supportcannons += s.cannons;
      p.supportStart.push({
        group: g, j,
        startInf: s.infantry, startCan: s.cannons,
        sourceArmy: s.sourceArmy,
      });
    }
  }
}

// ---- attack1vall / defend1vall ----

interface Battle1vAllResult {
  activeinfantry: number;
  passiveinfantry: number;
  newcannons: number;
  activesupportinfantry: number;
  passivesupportinfantry: number;
}

export function attack1vall(
  infantry: number, cannons: number, supportinfantry: number, supportcannons: number,
  Power: number, Damage: number,
): Battle1vAllResult {
  if (infantry >= Damage) { infantry -= Damage; Damage = 0; } else { Damage -= infantry; infantry = 0; }
  if (supportinfantry >= Damage) { supportinfantry -= Damage; Damage = 0; } else { Damage -= supportinfantry; supportinfantry = 0; }
  if (cannons >= Damage) { cannons -= Damage; Damage = 0; } else { Damage -= cannons; cannons = 0; }

  Power -= cannons + supportcannons;
  if (Power < 0) Power = 0;

  let activesupportinfantry: number, passivesupportinfantry: number;
  if (supportinfantry >= Power) {
    activesupportinfantry = supportinfantry - Power;
    passivesupportinfantry = Power;
    Power = 0;
  } else {
    activesupportinfantry = 0;
    passivesupportinfantry = supportinfantry;
    Power -= supportinfantry;
  }

  let newinfantry: number, retreat: number;
  if (infantry >= Power) {
    newinfantry = infantry - Power;
    retreat = Power;
    Power = 0;
  } else {
    newinfantry = 0;
    retreat = infantry;
    Power -= infantry;
  }

  return {
    activeinfantry: newinfantry,
    passiveinfantry: retreat,
    newcannons: cannons,
    activesupportinfantry,
    passivesupportinfantry,
  };
}

export function defend1vall(
  infantry: number, cannons: number, infantrywithoutbonus: number,
  supportinfantry: number, supportcannons: number,
  Power: number, Damage: number,
): Battle1vAllResult {
  if (infantry >= Damage) { infantry -= Damage; Damage = 0; } else { Damage -= infantry; infantry = 0; }
  if (infantrywithoutbonus >= Damage) { infantrywithoutbonus -= Damage; Damage = 0; } else { Damage -= infantrywithoutbonus; infantrywithoutbonus = 0; }
  if (supportinfantry >= Damage) { supportinfantry -= Damage; Damage = 0; } else { Damage -= supportinfantry; supportinfantry = 0; }
  if (cannons >= Damage) { cannons -= Damage; Damage = 0; } else { Damage -= cannons; cannons = 0; }

  Power -= cannons + supportcannons;
  if (Power < 0) Power = 0;
  Power -= infantry;
  if (Power < 0) Power = 0;

  infantry += infantrywithoutbonus;

  let activesupportinfantry: number, passivesupportinfantry: number;
  if (supportinfantry >= Power) {
    activesupportinfantry = supportinfantry - Power;
    passivesupportinfantry = Power;
    Power = 0;
  } else {
    activesupportinfantry = 0;
    passivesupportinfantry = supportinfantry;
    Power -= supportinfantry;
  }

  let newinfantry: number, retreat: number;
  if (infantry >= Power) {
    newinfantry = infantry - Power;
    retreat = Power;
    Power = 0;
  } else {
    newinfantry = 0;
    retreat = infantry;
    Power -= infantry;
  }

  return {
    activeinfantry: newinfantry,
    passiveinfantry: retreat,
    newcannons: cannons,
    activesupportinfantry,
    passivesupportinfantry,
  };
}

// ---- Apply battle plan ----

interface RetreatPlan {
  tile: Tile;
  countryIdx: number;
  country: Country | null;
  infantry: number;
  cannons: number;
}

function applyBattlePlan(
  plan: BattlePlan, state: GameState, pendingRetreats: RetreatPlan[],
): void {
  const tile = plan.tile;
  const { parties, winnerIdx } = plan;

  if (winnerIdx === null) {
    // Ничья: все отступают, сохраняя пехоту и пушки.
    for (const p of parties) {
      if (p.countryIdx < 0 || !p.country) continue;
      pendingRetreats.push({
        tile, countryIdx: p.countryIdx, country: p.country,
        infantry: p.activeInfantry + p.passiveInfantry,
        cannons: p.newCannons + p.usedcannons,
      });
    }
    tile.defenders.army = createArmy(tile);
    tile.defenders.support = tile.neighbours.map(() => ({
      infantry: 0, cannons: 0, sourceArmy: tile.defenders.army,
    }));
    for (let i = 0; i < tile.neighbours.length; i++) tile.arrived[i] = null;
    return;
  }

  const winner = parties[winnerIdx]!;
  if (winner.country) tile.owner = winner.country;

  const newArmy = createArmy(tile);
  newArmy.infantry = winner.activeInfantry;
  newArmy.cannons  = winner.newCannons + winner.usedcannons;
  for (let i = 0; i < parties.length; i++) {
    if (i === winnerIdx) continue;
    const p = parties[i]!;
    // Все физически находящиеся в тайле пушки (активные и used) уходят победителю.
    newArmy.cannons += p.newCannons + p.usedcannons;
  }
  tile.defenders.army = newArmy;
  tile.defenders.support = tile.neighbours.map(() => ({
    infantry: 0, cannons: 0, sourceArmy: newArmy,
  }));

  // Passive infantry победителя отступает в retreat_province.
  if (winner.passiveInfantry > 0 && winner.countryIdx >= 0 && winner.country) {
    pendingRetreats.push({
      tile, countryIdx: winner.countryIdx, country: winner.country,
      infantry: winner.passiveInfantry,
      cannons: 0,
    });
  }

  // Проигравшие отступают без пушек (их захватили).
  for (let i = 0; i < parties.length; i++) {
    if (i === winnerIdx) continue;
    const p = parties[i]!;
    if (p.countryIdx < 0 || !p.country) continue;
    pendingRetreats.push({
      tile, countryIdx: p.countryIdx, country: p.country,
      infantry: p.activeInfantry + p.passiveInfantry,
      cannons: 0,
    });
  }

  for (let i = 0; i < tile.neighbours.length; i++) tile.arrived[i] = null;
}

// =====================================================================
// Retreat phase
// =====================================================================

function resolveRetreatPhase(state: GameState, pendingRetreats: RetreatPlan[]): void {
  // Group by target tile only.
  const byTarget = new Map<number, {
    tile: Tile;
    retreats: RetreatPlan[];
  }>();

  for (const r of pendingRetreats) {
    if (!r.country) continue;
    const target = r.tile.retreat_province[r.countryIdx];
    if (!target) continue;
    let bucket = byTarget.get(target.id);
    if (!bucket) {
      bucket = { tile: target, retreats: [] };
      byTarget.set(target.id, bucket);
    }
    bucket.retreats.push(r);
  }

  for (const { tile: target, retreats } of byTarget.values()) {
    // Sum by country within this target tile.
    const byCountry = new Map<number, { country: Country; infantry: number; cannons: number }>();
    for (const r of retreats) {
      if (!r.country) continue;
      const cur = byCountry.get(r.countryIdx);
      if (cur) { cur.infantry += r.infantry; cur.cannons += r.cannons; }
      else byCountry.set(r.countryIdx, {
        country: r.country,
        infantry: r.infantry, cannons: r.cannons,
      });
    }

    const hasUnits = target.defenders.army.infantry > 0 || target.defenders.army.cannons > 0;

    if (hasUnits) {
      // Only the country matching the tile's current occupant survives.
      const occupant = target.owner;
      if (occupant) {
        const cur = byCountry.get(occupant.id);
        if (cur) {
          target.defenders.army.infantry += cur.infantry;
          target.defenders.army.cannons += cur.cannons;
        }
      }
      // All other countries (and occupant-less case) are destroyed.
    } else {
      // Empty tile: survive only if exactly one country retreats here.
      if (byCountry.size === 1) {
        const only = [...byCountry.values()][0]!;
        if (target.owner !== only.country) target.owner = only.country;
        target.defenders.army.infantry += only.infantry;
        target.defenders.army.cannons += only.cannons;
      }
      // else: multiple countries → all destroyed, no owner change.
    }
  }

  pendingRetreats.length = 0;
}

// =====================================================================
// Postprocess
// =====================================================================

function postprocess(state: GameState): void {
  for (const tile of state.tiles) {
    const a = tile.defenders.army;
    const totalInf = a.infantry + a.infantrywithoutbonus;
    const totalCan = a.cannons + a.usedcannons;
    a.infantry = Math.max(0, totalInf - a.losedinfantry);
    a.cannons = Math.max(0, totalCan - a.losedcannons);
    a.infantrywithoutbonus = 0;
    a.usedcannons = 0;
    a.losedinfantry = 0;
    a.losedcannons = 0;
  }
}

// =====================================================================
// Serialization (toJSON / fromJSON)
// =====================================================================
//
// All object references in GameState (tile↔tile, country↔tile, army↔tile,
// support.sourceArmy→Army) are encoded as integer ids. The only non-obvious
// case is `sourceArmy`: it is always `someTile.defenders.army` at a turn
// boundary (see applyTurn step 12), so it is encoded by the id of its
// `locationmovement` tile. Mid-turn states that violate this invariant
// cannot be round-tripped — but turn boundaries (the only states a
// multiplayer client ever needs to save) are always fine.

export interface SerializedArmy {
  infantry: number;
  cannons: number;
  locationmovement: number; // tile id
  losedinfantry: number;
  losedcannons: number;
  infantrywithoutbonus: number;
  usedcannons: number;
}

export interface SerializedSupport {
  infantry: number;
  cannons: number;
  sourceArmy: number; // tile id (of sourceArmy.locationmovement)
}

export interface SerializedArmyGroup {
  army: SerializedArmy;
  support: SerializedSupport[];
  /**
   * Если задан — эта группа принадлежит указанной стране, а не
   * `neighbours[i].ownerprevmove`. Появляется у «фантомных восставших»
   * (Order 4 в оккупированной столице). Опционально, чтобы состояния
   * без фантомов сериализовались побайтово как раньше.
   */
  phantomOwner?: number | null;   // country id
}

export interface SerializedTile {
  id: number;
  owner: number | null;         // country id
  ownerprevmove: number | null; // country id
  neighbours: number[];         // tile ids
  economy: number;
  retreat_province: (number | null)[]; // tile ids, indexed by country id
  investments: number;
  defenders: SerializedArmyGroup;
  incoming: (SerializedArmyGroup | null)[];
  arrived: (SerializedArmyGroup | null)[];
}

export interface SerializedCountry {
  id: number;
  capital: number | null; // tile id
  treasury: number;
  tiles: number[];        // tile ids, in order
  gifts: number;
}

export interface SerializedGameState {
  turn: number;
  countriescount: number;
  tilescount: number;
  tiles: SerializedTile[];
  countries: SerializedCountry[];
}

function armyToJSON(a: Army): SerializedArmy {
  return {
    infantry: a.infantry,
    cannons: a.cannons,
    locationmovement: a.locationmovement.id,
    losedinfantry: a.losedinfantry,
    losedcannons: a.losedcannons,
    infantrywithoutbonus: a.infantrywithoutbonus,
    usedcannons: a.usedcannons,
  };
}

function armyGroupToJSON(g: ArmyGroup): SerializedArmyGroup {
  const out: SerializedArmyGroup = {
    army: armyToJSON(g.army),
    support: g.support.map(s => ({
      infantry: s.infantry,
      cannons: s.cannons,
      sourceArmy: s.sourceArmy.locationmovement.id,
    })),
  };
  if (g.phantomOwner !== undefined) {
    out.phantomOwner = g.phantomOwner ? g.phantomOwner.id : null;
  }
  return out;
}

export function toJSON(state: GameState): SerializedGameState {
  return {
    turn: state.turn,
    countriescount: state.countriescount,
    tilescount: state.tilescount,
    tiles: state.tiles.map(t => ({
      id: t.id,
      owner: t.owner ? t.owner.id : null,
      ownerprevmove: t.ownerprevmove ? t.ownerprevmove.id : null,
      neighbours: t.neighbours.map(n => n.id),
      economy: t.economy,
      retreat_province: t.retreat_province.map(r => (r ? r.id : null)),
      investments: t.investments,
      defenders: armyGroupToJSON(t.defenders),
      incoming: t.incoming.map(g => (g ? armyGroupToJSON(g) : null)),
      arrived: t.arrived.map(g => (g ? armyGroupToJSON(g) : null)),
    })),
    countries: state.countries.map(c => ({
      id: c.id,
      capital: c.capital ? c.capital.id : null,
      treasury: c.treasury,
      tiles: c.tiles.map(t => t.id),
      gifts: c.gifts,
    })),
  };
}

function armyFromJSON(sa: SerializedArmy, tiles: Tile[]): Army {
  const loc = tiles[sa.locationmovement];
  if (!loc) throw new Error(`fromJSON: army has bad locationmovement ${sa.locationmovement}`);
  return {
    infantry: sa.infantry,
    cannons: sa.cannons,
    locationmovement: loc,
    losedinfantry: sa.losedinfantry,
    losedcannons: sa.losedcannons,
    infantrywithoutbonus: sa.infantrywithoutbonus,
    usedcannons: sa.usedcannons,
  };
}

function supportFromJSON(ss: SerializedSupport, tiles: Tile[]): Support {
  const src = tiles[ss.sourceArmy];
  if (!src) throw new Error(`fromJSON: support has bad sourceArmy ${ss.sourceArmy}`);
  return {
    infantry: ss.infantry,
    cannons: ss.cannons,
    sourceArmy: src.defenders.army,
  };
}

function armyGroupFromJSON(
  sg: SerializedArmyGroup,
  tiles: Tile[],
  countries: Country[],
): ArmyGroup {
  const g: ArmyGroup = {
    army: armyFromJSON(sg.army, tiles),
    support: sg.support.map(ss => supportFromJSON(ss, tiles)),
  };
  if (sg.phantomOwner !== undefined) {
    if (sg.phantomOwner === null) {
      g.phantomOwner = null;
    } else {
      const c = countries[sg.phantomOwner];
      if (c) g.phantomOwner = c;
    }
  }
  return g;
}

export function fromJSON(json: SerializedGameState): GameState {
  // Pass 1: tile skeletons with primitive fields only.
  const tiles: Tile[] = json.tiles.map(st => ({
    id: st.id,
    owner: null,
    ownerprevmove: null,
    neighbours: [],
    economy: st.economy,
    retreat_province: [],
    investments: st.investments,
    defenders: null as unknown as ArmyGroup, // filled in pass 5
    incoming: [],
    arrived: [],
  }));

  // Pass 2: country skeletons.
  const countries: Country[] = json.countries.map(sc => ({
    id: sc.id,
    capital: null,
    treasury: sc.treasury,
    tiles: [],
    gifts: sc.gifts,
  }));

  // Pass 3: wire tile↔tile and tile→country.
  for (let i = 0; i < json.tiles.length; i++) {
    const st = json.tiles[i]!;
    const t = tiles[i]!;
    if (st.owner !== null) {
      const c = countries[st.owner];
      if (!c) throw new Error(`fromJSON: tile ${st.id} has bad owner ${st.owner}`);
      t.owner = c;
    }
    if (st.ownerprevmove !== null) {
      const c = countries[st.ownerprevmove];
      if (!c) throw new Error(`fromJSON: tile ${st.id} has bad ownerprevmove ${st.ownerprevmove}`);
      t.ownerprevmove = c;
    }
    t.neighbours = st.neighbours.map(nid => {
      const n = tiles[nid];
      if (!n) throw new Error(`fromJSON: tile ${st.id} has bad neighbour ${nid}`);
      return n;
    });
    t.retreat_province = st.retreat_province.map(rid => {
      if (rid === null) return null;
      const r = tiles[rid];
      if (!r) throw new Error(`fromJSON: tile ${st.id} has bad retreat_province ${rid}`);
      return r;
    });
  }

  // Pass 4: wire country.capital and country.tiles.
  for (let i = 0; i < json.countries.length; i++) {
    const sc = json.countries[i]!;
    const c = countries[i]!;
    if (sc.capital !== null) {
      const cap = tiles[sc.capital];
      if (!cap) throw new Error(`fromJSON: country ${sc.id} has bad capital ${sc.capital}`);
      c.capital = cap;
    }
    c.tiles = sc.tiles.map(tid => {
      const t = tiles[tid];
      if (!t) throw new Error(`fromJSON: country ${sc.id} has bad tile ${tid}`);
      return t;
    });
  }

  // Pass 5: defenders.army must exist for every tile BEFORE we resolve
  // support.sourceArmy, because the latter points to these exact objects.
  for (let i = 0; i < json.tiles.length; i++) {
    const st = json.tiles[i]!;
    const t = tiles[i]!;
    const defendersArmy = armyFromJSON(st.defenders.army, tiles);
    t.defenders = {
      army: defendersArmy,
      support: st.defenders.support.map(() => ({
        infantry: 0,
        cannons: 0,
        sourceArmy: defendersArmy,
      })),
    };
  }

  // Pass 6: fill in defenders.support[] now that all defenders.army exist.
  for (let i = 0; i < json.tiles.length; i++) {
    const st = json.tiles[i]!;
    const t = tiles[i]!;
    for (let j = 0; j < st.defenders.support.length; j++) {
      t.defenders.support[j] = supportFromJSON(st.defenders.support[j]!, tiles);
    }
  }

  // Pass 7: incoming / arrived.
  for (let i = 0; i < json.tiles.length; i++) {
    const st = json.tiles[i]!;
    const t = tiles[i]!;
    t.incoming = st.incoming.map(sg =>
      (sg ? armyGroupFromJSON(sg, tiles, countries) : null));
    t.arrived = st.arrived.map(sg =>
      (sg ? armyGroupFromJSON(sg, tiles, countries) : null));
  }

  return {
    turn: json.turn,
    countriescount: json.countriescount,
    tilescount: json.tilescount,
    tiles,
    countries,
  };
}

// =====================================================================
// Order serialization (wire format)
// =====================================================================
//
// Объекты Order ссылаются на Tile/Country, которые нельзя прогнать через
// JSON.stringify (циклы: tile.neighbours, tile.owner, country.capital,
// country.tiles …). Поэтому по сети Order ходит как набор id и
// рехидратируется на стороне получателя в ЕГО граф объектов.

export interface SerializedOrder {
  type: 1 | 3 | 4 | 5 | 6 | 7 | 8;
  owner: number;
  // type 1
  investments?: number;
  tiles?: number[];
  // type 3
  recipient?: number;
  gift?: number;
  // type 4
  infantry?: number;
  cannons?: number;
  // type 5
  tile?: number;
  retreat_province?: number;
  // type 6, 7, 8
  from?: number;
  to?: number;            // type 6
  target_from?: number;   // type 7
  target_to?: number;     // type 7
  target?: number;        // type 8
}

export function orderToJSON(o: Order): SerializedOrder {
  const so: SerializedOrder = { type: o.type, owner: o.owner.id };
  switch (o.type) {
    case 1:
      so.investments = o.investments;
      so.tiles = o.tiles.map(t => t.id);
      break;
    case 3:
      so.recipient = o.recipient.id;
      so.gift = o.gift;
      break;
    case 4:
      so.infantry = o.infantry;
      so.cannons = o.cannons;
      break;
    case 5:
      so.tile = o.tile.id;
      so.retreat_province = o.retreat_province.id;
      break;
    case 6:
      so.from = o.from.id;
      so.to = o.to.id;
      so.infantry = o.infantry;
      so.cannons = o.cannons;
      break;
    case 7:
      so.from = o.from.id;
      so.target_from = o.target_from.id;
      so.target_to = o.target_to.id;
      so.infantry = o.infantry;
      so.cannons = o.cannons;
      break;
    case 8:
      so.from = o.from.id;
      so.target = o.target.id;
      so.infantry = o.infantry;
      so.cannons = o.cannons;
      break;
  }
  return so;
}

export function ordersToJSON(orders: Order[]): SerializedOrder[] {
  return orders.map(orderToJSON);
}

export function orderFromJSON(so: SerializedOrder, state: GameState): Order | null {
  const owner = state.countries[so.owner];
  if (!owner) return null;
  const t = (id: number | undefined): Tile | null => {
    if (id == null) return null;
    return state.tiles[id] ?? null;
  };
  switch (so.type) {
    case 1: {
      const rawTiles = so.tiles ?? [];
      const tiles: Tile[] = [];
      for (const id of rawTiles) {
        const tile = state.tiles[id];
        if (!tile) return null;
        tiles.push(tile);
      }
      return { type: 1, owner, investments: so.investments ?? 0, tiles };
    }
    case 3: {
      const recipient = state.countries[so.recipient ?? -1];
      if (!recipient) return null;
      return { type: 3, owner, recipient, gift: so.gift ?? 0 };
    }
    case 4:
      return { type: 4, owner, infantry: so.infantry ?? 0, cannons: so.cannons ?? 0 };
    case 5: {
      const tile = t(so.tile);
      const retreat = t(so.retreat_province);
      if (!tile || !retreat) return null;
      return { type: 5, owner, tile, retreat_province: retreat };
    }
    case 6: {
      const from = t(so.from), to = t(so.to);
      if (!from || !to) return null;
      return { type: 6, owner, from, to,
               infantry: so.infantry ?? 0, cannons: so.cannons ?? 0 };
    }
    case 7: {
      const from = t(so.from);
      const targetFrom = t(so.target_from);
      const targetTo = t(so.target_to);
      if (!from || !targetFrom || !targetTo) return null;
      return { type: 7, owner, from, target_from: targetFrom, target_to: targetTo,
               infantry: so.infantry ?? 0, cannons: so.cannons ?? 0 };
    }
    case 8: {
      const from = t(so.from), target = t(so.target);
      if (!from || !target) return null;
      return { type: 8, owner, from, target,
               infantry: so.infantry ?? 0, cannons: so.cannons ?? 0 };
    }
    default:
      return null;
  }
}

export function ordersFromJSON(list: SerializedOrder[], state: GameState): Order[] {
  const out: Order[] = [];
  for (const so of list) {
    const o = orderFromJSON(so, state);
    if (o) out.push(o);
  }
  return out;
}

// =====================================================================
// Win condition
// =====================================================================

export function checkWinCondition(state: GameState): boolean {
  let world = 0;
  let max = 0;
  for (const c of state.countries) {
    let e = 0;
    for (const t of c.tiles) e += t.economy;
    world += e;
    if (e > max) max = e;
  }
  return max >= 0.5 * world && world > 0;
}