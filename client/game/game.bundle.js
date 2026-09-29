// client/game/game.ts
var INFANTRY_COST = 1;
var CANNON_COST = 3;
var TREASURY_RETENTION = 0.8;
var EPS = 1e-9;
function round3(x) {
  return Math.round(x * 1e3) / 1e3;
}
function warn(msg) {
  console.warn(msg);
}
function createArmy(loc) {
  return {
    infantry: 0,
    cannons: 0,
    locationmovement: loc,
    losedinfantry: 0,
    losedcannons: 0,
    infantrywithoutbonus: 0,
    usedcannons: 0
  };
}
function createArmyGroup(target) {
  const dummy = createArmy(target);
  return {
    army: createArmy(target),
    support: target.neighbours.map(() => ({ infantry: 0, cannons: 0, sourceArmy: dummy }))
  };
}
function isGroupEmpty(g) {
  if (g.army.infantry > 0 || g.army.cannons > 0) return false;
  for (const s of g.support) {
    if (s.infantry > 0 || s.cannons > 0) return false;
  }
  return true;
}
function supportInfantryTotal(g) {
  let t = 0;
  for (const s of g.support) t += s.infantry;
  return t;
}
function supportCannonsTotal(g) {
  let t = 0;
  for (const s of g.support) t += s.cannons;
  return t;
}
function validateOrders(state, orders) {
  const tileSet = new Set(state.tiles);
  const countrySet = new Set(state.countries);
  const structurallyValid = [];
  for (const o of orders) {
    if (!countrySet.has(o.owner)) continue;
    switch (o.type) {
      case 1: {
        if (o.investments < 0) break;
        if (o.tiles.some((t) => !tileSet.has(t))) break;
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
        if (o.from === o.target_from) break;
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
  const demandByTile = /* @__PURE__ */ new Map();
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
  const rejected = /* @__PURE__ */ new Set();
  for (const [tile, bucket] of demandByTile) {
    const availInf = tile.defenders.army.infantry;
    const availCan = tile.defenders.army.cannons;
    if (bucket.infantry > availInf + EPS || bucket.cannons > availCan + EPS) {
      for (const o of bucket.orders) rejected.add(o);
    }
  }
  return structurallyValid.filter((o) => !rejected.has(o));
}
function applyTurn(state, orders) {
  const validOrders = validateOrders(state, orders);
  for (const tile of state.tiles) {
    tile.ownerprevmove = tile.owner;
    tile.investments = 0;
    tile.incoming = tile.neighbours.map(() => null);
    tile.arrived = tile.neighbours.map(() => null);
    tile.defenders.support = tile.neighbours.map(() => ({
      infantry: 0,
      cannons: 0,
      sourceArmy: tile.defenders.army
    }));
    tile.defenders.army.losedinfantry = 0;
    tile.defenders.army.losedcannons = 0;
  }
  for (const c of state.countries) c.gifts = 0;
  const order5 = validOrders.filter((o) => o.type === 5);
  for (const o of order5) {
    o.tile.retreat_province[o.owner.id] = o.retreat_province;
  }
  const order6 = validOrders.filter((o) => o.type === 6);
  const order7 = validOrders.filter((o) => o.type === 7);
  const order8 = validOrders.filter((o) => o.type === 8);
  for (const o of order6) {
    const from = o.from, to = o.to;
    const j = to.neighbours.indexOf(from);
    if (j < 0) {
      warn(`Order6: ${from.id} not a neighbour of ${to.id}`);
      continue;
    }
    if (!to.incoming[j]) to.incoming[j] = createArmyGroup(to);
    const g = to.incoming[j];
    g.army.infantry += o.infantry;
    g.army.cannons += o.cannons;
    g.army.locationmovement = from;
    from.defenders.army.infantry -= o.infantry;
    from.defenders.army.cannons -= o.cannons;
  }
  for (const o of order7) {
    const supportFrom = o.from, targetFrom = o.target_from, targetTo = o.target_to;
    const jMain = targetTo.neighbours.indexOf(targetFrom);
    const jSupport = targetTo.neighbours.indexOf(supportFrom);
    if (jMain < 0) {
      warn(`Order7: target_from not neighbour of target_to`);
      continue;
    }
    if (jSupport < 0) {
      warn(`Order7: from not neighbour of target_to`);
      continue;
    }
    if (!targetTo.incoming[jMain]) targetTo.incoming[jMain] = createArmyGroup(targetTo);
    const g = targetTo.incoming[jMain];
    supportFrom.defenders.army.infantry -= o.infantry;
    supportFrom.defenders.army.cannons -= o.cannons;
    supportFrom.defenders.army.infantrywithoutbonus += o.infantry;
    supportFrom.defenders.army.usedcannons += o.cannons;
    const s = g.support[jSupport];
    s.infantry += o.infantry;
    s.cannons += o.cannons;
    s.sourceArmy = supportFrom.defenders.army;
  }
  for (const o of order8) {
    const supportFrom = o.from, target = o.target;
    const j = target.neighbours.indexOf(supportFrom);
    if (j < 0) {
      warn(`Order8: from not neighbour of target`);
      continue;
    }
    supportFrom.defenders.army.infantry -= o.infantry;
    supportFrom.defenders.army.cannons -= o.cannons;
    supportFrom.defenders.army.infantrywithoutbonus += o.infantry;
    supportFrom.defenders.army.usedcannons += o.cannons;
    const s = target.defenders.support[j];
    s.infantry += o.infantry;
    s.cannons += o.cannons;
    s.sourceArmy = supportFrom.defenders.army;
  }
  const order1 = validOrders.filter((o) => o.type === 1);
  const order3 = validOrders.filter((o) => o.type === 3);
  const order4 = validOrders.filter((o) => o.type === 4);
  const spent = /* @__PURE__ */ new Map();
  for (const c of state.countries) spent.set(c, 0);
  for (const o of order1) spent.set(o.owner, (spent.get(o.owner) ?? 0) + o.investments);
  for (const o of order3) spent.set(o.owner, (spent.get(o.owner) ?? 0) + o.gift);
  for (const o of order4) spent.set(o.owner, (spent.get(o.owner) ?? 0) + o.infantry * INFANTRY_COST + o.cannons * CANNON_COST);
  const affordable = /* @__PURE__ */ new Map();
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
  for (const o of order4) {
    if (!affordable.get(o.owner)) continue;
    const cap = o.owner.capital;
    if (cap) {
      cap.defenders.army.infantry += o.infantry;
      cap.defenders.army.cannons += o.cannons;
    }
    o.owner.treasury -= o.infantry * INFANTRY_COST + o.cannons * CANNON_COST;
  }
  const halfTiles = state.tilescount / 2;
  for (const tile of state.tiles) {
    if (Math.abs(tile.economy) < EPS) continue;
    const denom = halfTiles * tile.economy;
    tile.economy = tile.economy * (2 - 1 / (1 + tile.investments / denom));
    tile.economy = round3(tile.economy);
  }
  resolveMovementPhase(state);
  const pendingRetreats = [];
  resolveMainBattlePhase(state, pendingRetreats);
  resolveRetreatPhase(state, pendingRetreats);
  postprocess(state);
  for (const c of state.countries) c.tiles = [];
  for (const tile of state.tiles) if (tile.owner) tile.owner.tiles.push(tile);
  for (const c of state.countries) {
    let income = 0;
    for (const t of c.tiles) income += t.economy;
    c.treasury = c.treasury * TREASURY_RETENTION + c.gifts + income;
    c.treasury = round3(c.treasury);
  }
  for (const c of state.countries) c.gifts = 0;
  for (const tile of state.tiles) {
    tile.investments = 0;
    tile.incoming = tile.neighbours.map(() => null);
    tile.arrived = tile.neighbours.map(() => null);
    resetEphemeralsOnArmy(tile.defenders.army);
    for (const s of tile.defenders.support) {
      s.infantry = 0;
      s.cannons = 0;
      s.sourceArmy = tile.defenders.army;
    }
  }
  state.turn += 1;
  return state;
}
function resetEphemeralsOnArmy(a) {
  a.losedinfantry = 0;
  a.losedcannons = 0;
  a.infantrywithoutbonus = 0;
  a.usedcannons = 0;
}
function movementPhaseScalar(infantry1, cannons1, supportInf1, supportCan1, infantry2, cannons2, supportInf2, supportCan2) {
  const startSInf1 = supportInf1;
  const startSInf2 = supportInf2;
  let remainingDamage1 = cannons1 + supportCan1;
  let remainingDamage2 = cannons2 + supportCan2;
  let fired1 = 0, fired2 = 0;
  if (infantry2 >= remainingDamage1) {
    infantry2 -= remainingDamage1;
    fired1 += remainingDamage1;
    remainingDamage1 = 0;
  } else {
    fired1 += infantry2;
    remainingDamage1 -= infantry2;
    infantry2 = 0;
  }
  if (supportInf2 >= remainingDamage1) {
    supportInf2 -= remainingDamage1;
    fired1 += remainingDamage1;
    remainingDamage1 = 0;
  } else {
    fired1 += supportInf2;
    remainingDamage1 -= supportInf2;
    supportInf2 = 0;
  }
  if (cannons2 >= remainingDamage1) {
    cannons2 -= remainingDamage1;
    fired1 += remainingDamage1;
    remainingDamage1 = 0;
  } else {
    fired1 += cannons2;
    remainingDamage1 -= cannons2;
    cannons2 = 0;
  }
  if (infantry1 >= remainingDamage2) {
    infantry1 -= remainingDamage2;
    fired2 += remainingDamage2;
    remainingDamage2 = 0;
  } else {
    fired2 += infantry1;
    remainingDamage2 -= infantry1;
    infantry1 = 0;
  }
  if (supportInf1 >= remainingDamage2) {
    supportInf1 -= remainingDamage2;
    fired2 += remainingDamage2;
    remainingDamage2 = 0;
  } else {
    fired2 += supportInf1;
    remainingDamage2 -= supportInf1;
    supportInf1 = 0;
  }
  if (cannons1 >= remainingDamage2) {
    cannons1 -= remainingDamage2;
    fired2 += remainingDamage2;
    remainingDamage2 = 0;
  } else {
    fired2 += cannons1;
    remainingDamage2 -= cannons1;
    cannons1 = 0;
  }
  const killedSInf1 = startSInf1 - supportInf1;
  const killedSInf2 = startSInf2 - supportInf2;
  const afterBarrageSInf1 = supportInf1;
  const afterBarrageSInf2 = supportInf2;
  let mainFired1 = 0, mainFired2 = 0;
  if (supportCan1 >= fired1) {
    supportCan1 -= fired1;
    fired1 = 0;
  } else {
    fired1 -= supportCan1;
    supportCan1 = 0;
  }
  if (cannons1 >= fired1) {
    mainFired1 = fired1;
    cannons1 -= fired1;
    fired1 = 0;
  } else {
    mainFired1 = cannons1;
    cannons1 = 0;
    fired1 = 0;
  }
  if (supportCan2 >= fired2) {
    supportCan2 -= fired2;
    fired2 = 0;
  } else {
    fired2 -= supportCan2;
    supportCan2 = 0;
  }
  if (cannons2 >= fired2) {
    mainFired2 = fired2;
    cannons2 -= fired2;
    fired2 = 0;
  } else {
    mainFired2 = cannons2;
    cannons2 = 0;
    fired2 = 0;
  }
  let power1 = infantry1 + supportInf1;
  let power2 = infantry2 + supportInf2;
  const preClashInf1 = infantry1;
  const preClashInf2 = infantry2;
  if (supportInf1 >= power2) {
    supportInf1 -= power2;
    power2 = 0;
  } else {
    power2 -= supportInf1;
    supportInf1 = 0;
  }
  if (infantry1 >= power2) {
    infantry1 -= power2;
    power2 = 0;
  } else {
    power2 -= infantry1;
    infantry1 = 0;
  }
  if (supportInf2 >= power1) {
    supportInf2 -= power1;
    power1 = 0;
  } else {
    power1 -= supportInf2;
    supportInf2 = 0;
  }
  if (infantry2 >= power1) {
    infantry2 -= power1;
    power1 = 0;
  } else {
    power1 -= infantry2;
    infantry2 = 0;
  }
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
    activeCan1 = cannons1;
    activeCan2 = cannons2;
    passiveCan1 = mainFired1;
    passiveCan2 = mainFired2;
  } else if (!side1HasInf) {
    activeCan2 = cannons2 + mainFired1;
    passiveCan2 = mainFired2;
  } else {
    activeCan1 = cannons1 + mainFired2;
    passiveCan1 = mainFired1;
  }
  return {
    a1: {
      ai: activeInf1,
      ac: activeCan1,
      pi: passiveInf1,
      pc: passiveCan1,
      si: supportInf1,
      sc: supportCan1,
      sik: killedSInf1,
      sip: pushedSInf1
    },
    a2: {
      ai: activeInf2,
      ac: activeCan2,
      pi: passiveInf2,
      pc: passiveCan2,
      si: supportInf2,
      sc: supportCan2,
      sik: killedSInf2,
      sip: pushedSInf2
    }
  };
}
function resolveMovementPhase(state) {
  const done = /* @__PURE__ */ new Set();
  for (const A of state.tiles) {
    for (let iB = 0; iB < A.neighbours.length; iB++) {
      const B = A.neighbours[iB];
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
        resolveEdgeClash(A, B, groupFromA, groupFromB, jA, iB);
      } else {
        if (groupFromA) B.arrived[jA] = groupFromA;
        if (groupFromB) A.arrived[iB] = groupFromB;
      }
    }
  }
}
function resolveEdgeClash(tileA, tileB, groupFromA, groupFromB, jA, iB) {
  const inf1 = groupFromA.army.infantry, can1 = groupFromA.army.cannons;
  const sInf1 = supportInfantryTotal(groupFromA), sCan1 = supportCannonsTotal(groupFromA);
  const inf2 = groupFromB.army.infantry, can2 = groupFromB.army.cannons;
  const sInf2 = supportInfantryTotal(groupFromB), sCan2 = supportCannonsTotal(groupFromB);
  const snapA = groupFromA.support.map((s) => s.infantry);
  const snapB = groupFromB.support.map((s) => s.infantry);
  const r = movementPhaseScalar(inf1, can1, sInf1, sCan1, inf2, can2, sInf2, sCan2);
  applySupportInfantryKilled(groupFromA, r.a1.sik, snapA);
  applySupportInfantryKilled(groupFromB, r.a2.sik, snapB);
  applySupportInfantryPushed(groupFromA, r.a1.sip, snapA);
  applySupportInfantryPushed(groupFromB, r.a2.sip, snapB);
  removeFiredSupportCannons(groupFromA, sCan1 - r.a1.sc);
  removeFiredSupportCannons(groupFromB, sCan2 - r.a2.sc);
  const side1HasInf = r.a1.ai > 0 || r.a1.si > 0;
  const side2HasInf = r.a2.ai > 0 || r.a2.si > 0;
  let winner;
  if (side1HasInf && !side2HasInf) winner = 1;
  else if (!side1HasInf && side2HasInf) winner = 2;
  else winner = 0;
  const applySide = (group, res, isWinner, targetTile, targetIdx, sourceTile) => {
    const srcArmy = sourceTile.defenders.army;
    if (isWinner) {
      const newGroup = createArmyGroup(targetTile);
      newGroup.army.locationmovement = sourceTile;
      newGroup.army.infantry = res.ai;
      newGroup.army.cannons = res.ac;
      newGroup.army.usedcannons = res.pc;
      for (let j = 0; j < group.support.length && j < newGroup.support.length; j++) {
        newGroup.support[j].infantry = group.support[j].infantry;
        newGroup.support[j].cannons = group.support[j].cannons;
        newGroup.support[j].sourceArmy = group.support[j].sourceArmy;
      }
      srcArmy.infantrywithoutbonus += res.pi;
      targetTile.arrived[targetIdx] = newGroup;
    } else {
      srcArmy.infantrywithoutbonus += res.pi + res.ai;
      srcArmy.usedcannons += res.pc + res.ac;
    }
  };
  if (winner === 1) {
    applySide(groupFromA, r.a1, true, tileB, jA, tileA);
    applySide(groupFromB, r.a2, false, tileA, iB, tileB);
  } else if (winner === 2) {
    applySide(groupFromB, r.a2, true, tileA, iB, tileB);
    applySide(groupFromA, r.a1, false, tileB, jA, tileA);
  } else {
    applySide(groupFromA, r.a1, false, tileB, jA, tileA);
    applySide(groupFromB, r.a2, false, tileA, iB, tileB);
  }
  tileA.incoming[iB] = null;
  tileB.incoming[jA] = null;
}
function applySupportInfantryKilled(group, killedTotal, snapshot) {
  if (killedTotal <= 0) return;
  let total = 0;
  for (const v of snapshot) total += v;
  if (total <= 0) return;
  for (let i = 0; i < group.support.length; i++) {
    const s = group.support[i];
    const alloc = Math.ceil(killedTotal * (snapshot[i] ?? 0) / total - EPS);
    const removed = Math.min(alloc, s.infantry);
    s.infantry -= removed;
    s.sourceArmy.losedinfantry += removed;
  }
}
function applySupportInfantryPushed(group, pushedTotal, snapshot) {
  if (pushedTotal <= 0) return;
  let total = 0;
  for (const v of snapshot) total += v;
  if (total <= 0) return;
  for (let i = 0; i < group.support.length; i++) {
    const s = group.support[i];
    const alloc = Math.ceil(pushedTotal * (snapshot[i] ?? 0) / total - EPS);
    const removed = Math.min(alloc, s.infantry);
    s.infantry -= removed;
  }
}
function removeFiredSupportCannons(group, firedCan) {
  if (firedCan <= 0) return;
  let totalCan = 0;
  for (const s of group.support) totalCan += s.cannons;
  if (totalCan <= 0) return;
  for (const s of group.support) {
    const lc = Math.ceil(firedCan * s.cannons / totalCan - EPS);
    if (lc > 0) s.cannons = Math.max(0, s.cannons - lc);
  }
}
function resolveMainBattlePhase(state, pendingRetreats) {
  const plans = [];
  for (const tile of state.tiles) {
    const plan = computeBattlePlan(tile, state);
    if (plan) plans.push(plan);
  }
  for (const plan of plans) {
    applyBattlePlan(plan, state, pendingRetreats);
  }
}
function computeBattlePlan(tile, state) {
  const defenderCountry = tile.ownerprevmove;
  const mergedAttackerIdx = /* @__PURE__ */ new Set();
  for (let i = 0; i < tile.neighbours.length; i++) {
    const g = tile.arrived[i];
    if (!g) continue;
    const nbr = tile.neighbours[i];
    if (nbr.ownerprevmove === defenderCountry && defenderCountry !== null) {
      tile.defenders.army.infantrywithoutbonus += g.army.infantry;
      tile.defenders.army.cannons += g.army.cannons;
      tile.defenders.army.usedcannons += g.army.usedcannons;
      for (let j = 0; j < tile.neighbours.length; j++) {
        const s = g.support[j];
        if (s.infantry > 0 || s.cannons > 0) {
          const ds = tile.defenders.support[j];
          ds.infantry += s.infantry;
          ds.cannons += s.cannons;
          ds.sourceArmy = s.sourceArmy;
        }
      }
      mergedAttackerIdx.add(i);
    }
  }
  const attackerIndices = tile.neighbours.map((_, i) => i).filter((i) => !mergedAttackerIdx.has(i) && tile.arrived[i] != null);
  const hasAttackers = attackerIndices.some((i) => {
    const g = tile.arrived[i];
    return g.army.infantry > 0 || g.army.cannons > 0 || supportInfantryTotal(g) > 0 || supportCannonsTotal(g) > 0;
  });
  if (!hasAttackers) return null;
  const parties = [];
  {
    const p = emptyParty(
      defenderCountry ? state.countries.indexOf(defenderCountry) : -1,
      defenderCountry,
      true,
      tile
    );
    addGroupToParty(p, tile.defenders, tile);
    parties.push(p);
  }
  const byCountry = /* @__PURE__ */ new Map();
  for (const i of attackerIndices) {
    const g = tile.arrived[i];
    const nbr = tile.neighbours[i];
    const country = nbr.ownerprevmove;
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
    p.power = p.isDefender ? 2 * p.infantry + p.infantrywithoutbonus + p.supportinfantry : p.infantry + p.supportinfantry;
    p.damage = p.cannons + p.supportcannons;
    p.perceivedPower = p.power + p.damage;
  }
  for (let i = 0; i < parties.length; i++) {
    const p = parties[i];
    p.attacks = parties.map(() => ({ power: 0, damage: 0 }));
    let den = 0;
    for (let k = 0; k < parties.length; k++) {
      if (k !== i) den += parties[k].perceivedPower;
    }
    if (den <= EPS) continue;
    for (let k = 0; k < parties.length; k++) {
      if (k === i) continue;
      const ratio = parties[k].perceivedPower / den;
      p.attacks[k].power = ratio * p.power;
      p.attacks[k].damage = ratio * p.damage;
    }
  }
  const incomingPower = parties.map(() => 0);
  const incomingDamage = parties.map(() => 0);
  for (let k = 0; k < parties.length; k++) {
    for (let i = 0; i < parties.length; i++) {
      if (i === k) continue;
      const pi = parties[i];
      incomingPower[k] = (incomingPower[k] ?? 0) + (pi.attacks[k]?.power ?? 0);
      incomingDamage[k] = (incomingDamage[k] ?? 0) + (pi.attacks[k]?.damage ?? 0);
    }
  }
  for (let i = 0; i < parties.length; i++) {
    const p = parties[i];
    const res = p.isDefender ? defend1vall(
      p.infantry,
      p.cannons,
      p.infantrywithoutbonus,
      p.supportinfantry,
      p.supportcannons,
      incomingPower[i],
      incomingDamage[i]
    ) : attack1vall(
      p.infantry,
      p.cannons,
      p.supportinfantry,
      p.supportcannons,
      incomingPower[i],
      incomingDamage[i]
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
        const slot = e.group.support[e.j];
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
      const slot = e.group.support[e.j];
      slot.infantry = Math.max(0, slot.infantry - dr);
    }
  }
  const isWinner = parties.map((p) => p.activeInfantry > 0 || p.activeSupportInfantry > 0);
  const winnerCount = isWinner.filter(Boolean).length;
  let winnerIdx = null;
  if (winnerCount === 1) winnerIdx = isWinner.indexOf(true);
  else if (winnerCount === 0) {
    const hasCan = parties.map((p) => p.newCannons > 0.5);
    const canCount = hasCan.filter(Boolean).length;
    if (canCount === 1) winnerIdx = hasCan.indexOf(true);
  }
  return {
    tile,
    parties,
    winnerIdx,
    retreating: parties.map((_, i) => winnerIdx !== i)
  };
}
function emptyParty(countryIdx, country, isDefender, tile) {
  return {
    countryIdx,
    country,
    isDefender,
    groups: [],
    infantry: 0,
    infantrywithoutbonus: 0,
    cannons: 0,
    usedcannons: 0,
    supportinfantry: 0,
    supportcannons: 0,
    supportStart: [],
    power: 0,
    damage: 0,
    perceivedPower: 0,
    attacks: [],
    activeInfantry: 0,
    passiveInfantry: 0,
    newCannons: 0,
    activeSupportInfantry: 0,
    passiveSupportInfantry: 0,
    supportLostFromDamage: 0
  };
}
function addGroupToParty(p, g, tile) {
  p.groups.push(g);
  p.infantry += g.army.infantry;
  p.infantrywithoutbonus += g.army.infantrywithoutbonus;
  p.cannons += g.army.cannons;
  p.usedcannons += g.army.usedcannons;
  for (let j = 0; j < tile.neighbours.length; j++) {
    const s = g.support[j];
    if (s.infantry > 0 || s.cannons > 0) {
      p.supportinfantry += s.infantry;
      p.supportcannons += s.cannons;
      p.supportStart.push({
        group: g,
        j,
        startInf: s.infantry,
        startCan: s.cannons,
        sourceArmy: s.sourceArmy
      });
    }
  }
}
function attack1vall(infantry, cannons, supportinfantry, supportcannons, Power, Damage) {
  if (infantry >= Damage) {
    infantry -= Damage;
    Damage = 0;
  } else {
    Damage -= infantry;
    infantry = 0;
  }
  if (supportinfantry >= Damage) {
    supportinfantry -= Damage;
    Damage = 0;
  } else {
    Damage -= supportinfantry;
    supportinfantry = 0;
  }
  if (cannons >= Damage) {
    cannons -= Damage;
    Damage = 0;
  } else {
    Damage -= cannons;
    cannons = 0;
  }
  Power -= cannons + supportcannons;
  if (Power < 0) Power = 0;
  let activesupportinfantry, passivesupportinfantry;
  if (supportinfantry >= Power) {
    activesupportinfantry = supportinfantry - Power;
    passivesupportinfantry = Power;
    Power = 0;
  } else {
    activesupportinfantry = 0;
    passivesupportinfantry = supportinfantry;
    Power -= supportinfantry;
  }
  let newinfantry, retreat;
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
    passivesupportinfantry
  };
}
function defend1vall(infantry, cannons, infantrywithoutbonus, supportinfantry, supportcannons, Power, Damage) {
  if (infantry >= Damage) {
    infantry -= Damage;
    Damage = 0;
  } else {
    Damage -= infantry;
    infantry = 0;
  }
  if (infantrywithoutbonus >= Damage) {
    infantrywithoutbonus -= Damage;
    Damage = 0;
  } else {
    Damage -= infantrywithoutbonus;
    infantrywithoutbonus = 0;
  }
  if (supportinfantry >= Damage) {
    supportinfantry -= Damage;
    Damage = 0;
  } else {
    Damage -= supportinfantry;
    supportinfantry = 0;
  }
  if (cannons >= Damage) {
    cannons -= Damage;
    Damage = 0;
  } else {
    Damage -= cannons;
    cannons = 0;
  }
  Power -= cannons + supportcannons;
  if (Power < 0) Power = 0;
  Power -= infantry;
  if (Power < 0) Power = 0;
  infantry += infantrywithoutbonus;
  let activesupportinfantry, passivesupportinfantry;
  if (supportinfantry >= Power) {
    activesupportinfantry = supportinfantry - Power;
    passivesupportinfantry = Power;
    Power = 0;
  } else {
    activesupportinfantry = 0;
    passivesupportinfantry = supportinfantry;
    Power -= supportinfantry;
  }
  let newinfantry, retreat;
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
    passivesupportinfantry
  };
}
function applyBattlePlan(plan, state, pendingRetreats) {
  const tile = plan.tile;
  const { parties, winnerIdx } = plan;
  if (winnerIdx === null) {
    for (const p of parties) {
      if (p.countryIdx < 0 || !p.country) continue;
      pendingRetreats.push({
        tile,
        countryIdx: p.countryIdx,
        country: p.country,
        infantry: p.activeInfantry + p.passiveInfantry,
        cannons: p.newCannons + p.usedcannons
      });
    }
    tile.defenders.army = createArmy(tile);
    tile.defenders.support = tile.neighbours.map(() => ({
      infantry: 0,
      cannons: 0,
      sourceArmy: tile.defenders.army
    }));
    for (let i = 0; i < tile.neighbours.length; i++) tile.arrived[i] = null;
    return;
  }
  const winner = parties[winnerIdx];
  if (winner.country) tile.owner = winner.country;
  const newArmy = createArmy(tile);
  newArmy.infantry = winner.activeInfantry;
  newArmy.cannons = winner.newCannons + winner.usedcannons;
  for (let i = 0; i < parties.length; i++) {
    if (i === winnerIdx) continue;
    const p = parties[i];
    newArmy.cannons += p.newCannons + p.usedcannons;
  }
  tile.defenders.army = newArmy;
  tile.defenders.support = tile.neighbours.map(() => ({
    infantry: 0,
    cannons: 0,
    sourceArmy: newArmy
  }));
  if (winner.passiveInfantry > 0 && winner.countryIdx >= 0 && winner.country) {
    pendingRetreats.push({
      tile,
      countryIdx: winner.countryIdx,
      country: winner.country,
      infantry: winner.passiveInfantry,
      cannons: 0
    });
  }
  for (let i = 0; i < parties.length; i++) {
    if (i === winnerIdx) continue;
    const p = parties[i];
    if (p.countryIdx < 0 || !p.country) continue;
    pendingRetreats.push({
      tile,
      countryIdx: p.countryIdx,
      country: p.country,
      infantry: p.activeInfantry + p.passiveInfantry,
      cannons: 0
    });
  }
  for (let i = 0; i < tile.neighbours.length; i++) tile.arrived[i] = null;
}
function resolveRetreatPhase(state, pendingRetreats) {
  const byTarget = /* @__PURE__ */ new Map();
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
    const byCountry = /* @__PURE__ */ new Map();
    for (const r of retreats) {
      if (!r.country) continue;
      const cur = byCountry.get(r.countryIdx);
      if (cur) {
        cur.infantry += r.infantry;
        cur.cannons += r.cannons;
      } else byCountry.set(r.countryIdx, {
        country: r.country,
        infantry: r.infantry,
        cannons: r.cannons
      });
    }
    const hasUnits = target.defenders.army.infantry > 0 || target.defenders.army.cannons > 0;
    if (hasUnits) {
      const occupant = target.owner;
      if (occupant) {
        const cur = byCountry.get(occupant.id);
        if (cur) {
          target.defenders.army.infantry += cur.infantry;
          target.defenders.army.cannons += cur.cannons;
        }
      }
    } else {
      if (byCountry.size === 1) {
        const only = [...byCountry.values()][0];
        if (target.owner !== only.country) target.owner = only.country;
        target.defenders.army.infantry += only.infantry;
        target.defenders.army.cannons += only.cannons;
      }
    }
  }
  pendingRetreats.length = 0;
}
function postprocess(state) {
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
function armyToJSON(a) {
  return {
    infantry: a.infantry,
    cannons: a.cannons,
    locationmovement: a.locationmovement.id,
    losedinfantry: a.losedinfantry,
    losedcannons: a.losedcannons,
    infantrywithoutbonus: a.infantrywithoutbonus,
    usedcannons: a.usedcannons
  };
}
function armyGroupToJSON(g) {
  return {
    army: armyToJSON(g.army),
    support: g.support.map((s) => ({
      infantry: s.infantry,
      cannons: s.cannons,
      sourceArmy: s.sourceArmy.locationmovement.id
    }))
  };
}
function toJSON(state) {
  return {
    turn: state.turn,
    countriescount: state.countriescount,
    tilescount: state.tilescount,
    tiles: state.tiles.map((t) => ({
      id: t.id,
      owner: t.owner ? t.owner.id : null,
      ownerprevmove: t.ownerprevmove ? t.ownerprevmove.id : null,
      neighbours: t.neighbours.map((n) => n.id),
      economy: t.economy,
      retreat_province: t.retreat_province.map((r) => r ? r.id : null),
      investments: t.investments,
      defenders: armyGroupToJSON(t.defenders),
      incoming: t.incoming.map((g) => g ? armyGroupToJSON(g) : null),
      arrived: t.arrived.map((g) => g ? armyGroupToJSON(g) : null)
    })),
    countries: state.countries.map((c) => ({
      id: c.id,
      capital: c.capital ? c.capital.id : null,
      treasury: c.treasury,
      tiles: c.tiles.map((t) => t.id),
      gifts: c.gifts
    }))
  };
}
function armyFromJSON(sa, tiles) {
  const loc = tiles[sa.locationmovement];
  if (!loc) throw new Error(`fromJSON: army has bad locationmovement ${sa.locationmovement}`);
  return {
    infantry: sa.infantry,
    cannons: sa.cannons,
    locationmovement: loc,
    losedinfantry: sa.losedinfantry,
    losedcannons: sa.losedcannons,
    infantrywithoutbonus: sa.infantrywithoutbonus,
    usedcannons: sa.usedcannons
  };
}
function supportFromJSON(ss, tiles) {
  const src = tiles[ss.sourceArmy];
  if (!src) throw new Error(`fromJSON: support has bad sourceArmy ${ss.sourceArmy}`);
  return {
    infantry: ss.infantry,
    cannons: ss.cannons,
    sourceArmy: src.defenders.army
  };
}
function armyGroupFromJSON(sg, tiles) {
  return {
    army: armyFromJSON(sg.army, tiles),
    support: sg.support.map((ss) => supportFromJSON(ss, tiles))
  };
}
function fromJSON(json) {
  const tiles = json.tiles.map((st) => ({
    id: st.id,
    owner: null,
    ownerprevmove: null,
    neighbours: [],
    economy: st.economy,
    retreat_province: [],
    investments: st.investments,
    defenders: null,
    // filled in pass 5
    incoming: [],
    arrived: []
  }));
  const countries = json.countries.map((sc) => ({
    id: sc.id,
    capital: null,
    treasury: sc.treasury,
    tiles: [],
    gifts: sc.gifts
  }));
  for (let i = 0; i < json.tiles.length; i++) {
    const st = json.tiles[i];
    const t = tiles[i];
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
    t.neighbours = st.neighbours.map((nid) => {
      const n = tiles[nid];
      if (!n) throw new Error(`fromJSON: tile ${st.id} has bad neighbour ${nid}`);
      return n;
    });
    t.retreat_province = st.retreat_province.map((rid) => {
      if (rid === null) return null;
      const r = tiles[rid];
      if (!r) throw new Error(`fromJSON: tile ${st.id} has bad retreat_province ${rid}`);
      return r;
    });
  }
  for (let i = 0; i < json.countries.length; i++) {
    const sc = json.countries[i];
    const c = countries[i];
    if (sc.capital !== null) {
      const cap = tiles[sc.capital];
      if (!cap) throw new Error(`fromJSON: country ${sc.id} has bad capital ${sc.capital}`);
      c.capital = cap;
    }
    c.tiles = sc.tiles.map((tid) => {
      const t = tiles[tid];
      if (!t) throw new Error(`fromJSON: country ${sc.id} has bad tile ${tid}`);
      return t;
    });
  }
  for (let i = 0; i < json.tiles.length; i++) {
    const st = json.tiles[i];
    const t = tiles[i];
    const defendersArmy = armyFromJSON(st.defenders.army, tiles);
    t.defenders = {
      army: defendersArmy,
      support: st.defenders.support.map(() => ({
        infantry: 0,
        cannons: 0,
        sourceArmy: defendersArmy
      }))
    };
  }
  for (let i = 0; i < json.tiles.length; i++) {
    const st = json.tiles[i];
    const t = tiles[i];
    for (let j = 0; j < st.defenders.support.length; j++) {
      t.defenders.support[j] = supportFromJSON(st.defenders.support[j], tiles);
    }
  }
  for (let i = 0; i < json.tiles.length; i++) {
    const st = json.tiles[i];
    const t = tiles[i];
    t.incoming = st.incoming.map((sg) => sg ? armyGroupFromJSON(sg, tiles) : null);
    t.arrived = st.arrived.map((sg) => sg ? armyGroupFromJSON(sg, tiles) : null);
  }
  return {
    turn: json.turn,
    countriescount: json.countriescount,
    tilescount: json.tilescount,
    tiles,
    countries
  };
}
function checkWinCondition(state) {
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
export {
  applyTurn,
  attack1vall,
  checkWinCondition,
  createArmy,
  createArmyGroup,
  defend1vall,
  fromJSON,
  movementPhaseScalar,
  toJSON,
  validateOrders
};
//# sourceMappingURL=game.bundle.js.map
