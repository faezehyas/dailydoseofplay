// Hexlands robots: the public state (the board, every building and road,
// points, the bank, the cards each hand collected or was shown face up) and
// their own face(), nothing else. Easy settles on a random good-enough corner,
// builds whatever it can, accepts fair trades and rarely offers one. Medium
// settles by production and variety, with an eye on harbours, keeps a plan
// (a road toward a target corner, a settlement, a city, development cards),
// discards and trades toward it, robs the leader and answers offers by
// whether they help it without feeding the leader. Hard also reads what each
// opponent holds face up, buys development cards whenever it can, races for
// longest road and largest army, times its development cards, offers trades
// to those who hold what it lacks (only while legalMoves() lists offers: the
// rules cap them a turn) and claims the win the moment it can.
// Monopoly's give and a decline it can't avoid are forcedMove(). See
// "Hexlands in depth" in ARCHITECTURE.md.
import { startPacedRobot } from "../engine/cards/paced-robot.js";
import { CORNERS, EDGES, HEXES, DESERT, ANY, RESOURCES, pips } from "./board.js";
import {
  COSTS,
  ARMY_MIN,
  LONGEST_MIN,
  counts,
  legalCorners,
  legalCities,
  tradeRate,
  points,
  roadLength,
  legalMoves,
  forcedMove,
  devKind,
  resourceOf,
} from "./rules.js";

// offer: the chance of offering a trade that would complete a build, each time one would.
export const LEVELS = {
  easy: { offer: 0.05 },
  medium: { offer: 0.3 },
  hard: { offer: 0.8 },
};

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const has = (k) => (m) => Object.hasOwn(m, k);
const pickRandom = (list, rng) => list[Math.floor(rng() * list.length)];
const seatsOf = (state) => [...Array(state.players).keys()];
const other = (e, c) => (EDGES[e].a === c ? EDGES[e].b : EDGES[e].a);
// The first of list with the highest score.
function best(list, score) {
  let top;
  let high = -Infinity;
  for (const x of list) {
    const v = score(x);
    if (v > high) [top, high] = [x, v];
  }
  return top;
}
const missing = (hand, cost) => sum(cost.map((n, r) => Math.max(0, n - hand[r])));
const isFree = (state, c) => !state.buildings[c] && CORNERS[c].corners.every((o) => !state.buildings[o]);

// ---------- the island ----------
// Pips a corner collects each roll, by resource; the hex `skip` collects nothing.
export function cornerYield(board, c, skip = -1) {
  const out = [0, 0, 0, 0, 0];
  for (const h of CORNERS[c].hexes) {
    const r = board.terrain[h];
    if (r !== DESERT && h !== skip) out[r] += pips(board.numbers[h]);
  }
  return out;
}

// What p's buildings collect each roll, by resource, the robber's hex aside.
export function income(state, p) {
  const out = [0, 0, 0, 0, 0];
  state.buildings.forEach((b, c) => {
    if (b?.p !== p) return;
    cornerYield(state.board, c, state.robber).forEach((n, r) => (out[r] += n * (b.city ? 2 : 1)));
  });
  return out;
}

// A resource the island makes little of is worth more.
function scarcity(board) {
  const total = [0, 0, 0, 0, 0];
  HEXES.forEach((h) => board.terrain[h.id] !== DESERT && (total[board.terrain[h.id]] += pips(board.numbers[h.id])));
  const mean = sum(total) / 5;
  return total.map((t) => Math.min(1.5, Math.max(0.7, mean / Math.max(t, 1))));
}

const harbourAt = (state, c) => state.board.harbours.find(({ edge }) => EDGES[edge].a === c || EDGES[edge].b === c)?.kind ?? null;

// How good a corner is for p: production weighted by scarcity, new resources
// and new numbers, and a harbour that suits what p makes.
export function cornerValue(ctx, c) {
  const { state, inc, weights, level } = ctx;
  const y = cornerYield(state.board, c);
  let v = 0;
  for (const r of RESOURCES) {
    if (!y[r]) continue;
    v += y[r] * weights[r];
    if (!inc[r]) v += 1.5;
  }
  if (level === "hard") {
    // Numbers p already collects on add less than new ones.
    const mine = new Set(ctx.numbers);
    for (const h of CORNERS[c].hexes) if (mine.has(state.board.numbers[h])) v -= 0.6;
  }
  const kind = harbourAt(state, c);
  if (kind === ANY) v += 1.2;
  else if (kind !== null) v += Math.min(3, (inc[kind] + y[kind]) * 0.35);
  return v;
}

// The corners p's next road can reach, up to 3 roads away: the best free one, and the road to build first.
export function roadTarget(ctx) {
  const { state, me } = ctx;
  if (!state.pieces[me].roads || !state.pieces[me].settlements) return null;
  const reach = new Map();
  const queue = [];
  CORNERS.forEach((c) => {
    const b = state.buildings[c.id];
    if (b ? b.p === me : c.edges.some((e) => state.roads[e] === me)) {
      reach.set(c.id, { dist: 0, first: -1 });
      queue.push(c.id);
    }
  });
  const limit = Math.min(3, state.pieces[me].roads);
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    const { dist, first } = reach.get(c);
    if (dist >= limit) continue;
    for (const e of CORNERS[c].edges) {
      if (state.roads[e] !== -1) continue;
      const d = other(e, c);
      if (reach.has(d) || (state.buildings[d] && state.buildings[d].p !== me)) continue;
      reach.set(d, { dist: dist + 1, first: dist === 0 ? e : first });
      queue.push(d);
    }
  }
  const spots = [...reach].filter(([c, { dist }]) => dist > 0 && isFree(state, c));
  const top = best(spots, ([c, { dist }]) => cornerValue(ctx, c) / (1 + 0.45 * dist));
  return top ? { corner: top[0], edge: top[1].first, dist: top[1].dist } : null;
}

// p's road length with one more road on edge e.
function lengthWith(state, p, e) {
  const roads = state.roads.slice();
  roads[e] = p;
  return roadLength({ ...state, roads }, p);
}

// ---------- what a seat knows ----------
// The cards `me` can see in q's hand, by resource, and how many are hidden (stolen ones).
export function seenHand(state, q, face) {
  const known = [0, 0, 0, 0, 0];
  let hidden = 0;
  for (const s of state.hands[q]) {
    const r = resourceOf(face(s));
    if (r >= 0) known[r]++;
    else hidden++;
  }
  return { known, hidden };
}

// The opponent most likely to win: public points, and for Hard the development cards that may hide points.
function leaderOf(ctx) {
  const { state, me, level } = ctx;
  const others = seatsOf(state).filter((q) => q !== me);
  return best(others, (q) => points(state, q) + (level === "hard" ? state.devs[q].length * 0.3 + state.knights[q] * 0.05 : 0) + state.hands[q].length * 0.01);
}

function context(state, me, face, rng, level) {
  const ctx = { state, me, face, rng, level, hand: counts(state.hands[me], face), inc: income(state, me), weights: scarcity(state.board) };
  ctx.numbers = state.buildings.flatMap((b, c) => (b?.p === me ? CORNERS[c].hexes.map((h) => state.board.numbers[h]).filter(Boolean) : []));
  return ctx;
}

// ---------- the plan ----------
// What to build next, nearest first: a settlement or city (whichever is closer),
// a road toward a target corner when there's nowhere to settle, then development cards.
function planOf(ctx) {
  if (ctx.plan) return ctx.plan;
  const { state, me, hand } = ctx;
  const builds = [];
  const corners = legalCorners(state, me);
  if (corners.length) builds.push({ kind: "settlement", cost: COSTS.settlement, at: best(corners, (c) => cornerValue(ctx, c)) });
  const cities = legalCities(state, me);
  if (cities.length) builds.push({ kind: "city", cost: COSTS.city, at: best(cities, (c) => sum(cornerYield(state.board, c, state.robber))) });
  if (!corners.length) {
    const target = roadTarget(ctx);
    if (target) builds.push({ kind: "road", cost: COSTS.road, at: target.edge, target });
  }
  builds.sort((a, b) => missing(hand, a.cost) - missing(hand, b.cost));
  if (state.devPile.length) builds.push({ kind: "dev", cost: COSTS.dev });
  return (ctx.plan = builds);
}

// How far a hand is from the plan: the nearest goal counts most. Higher is better.
function progress(ctx, hand) {
  const plan = planOf(ctx);
  return plan.reduce((v, g, i) => v - missing(hand, g.cost) / (1 + i), 0) + sum(hand) * 0.05;
}

// A bank trade toward goal: surplus cards (beyond the goal) at p's rates for a missing one.
// complete: only when trades can cover everything missing now.
function bankStep(ctx, goal, complete = true) {
  const { state, me, hand } = ctx;
  const need = goal.cost;
  const short = RESOURCES.filter((r) => need[r] > hand[r] && state.bank[r].length);
  if (!short.length || short.length < RESOURCES.filter((r) => need[r] > hand[r]).length) return null;
  const rate = RESOURCES.map((r) => tradeRate(state, me, r));
  const spare = RESOURCES.filter((r) => hand[r] - need[r] >= rate[r]);
  if (!spare.length) return null;
  if (complete && sum(spare.map((r) => Math.floor((hand[r] - need[r]) / rate[r]))) < missing(hand, need)) return null;
  const give = best(spare, (r) => hand[r] - need[r] - rate[r] * 1.5);
  return { give, take: best(short, (r) => need[r] - hand[r]) };
}

const bankMove = (legal, face, step) => step && legal.find((m) => m.bank && resourceOf(face(m.bank[0])) === step.give && m.take === step.take);

// Buying a development card leaves what the nearest goal needs.
function devIsSafe(ctx) {
  const goal = planOf(ctx)[0];
  if (!goal || goal.kind === "dev") return true;
  return RESOURCES.every((r) => ctx.hand[r] - COSTS.dev[r] >= Math.min(ctx.hand[r], goal.cost[r]));
}

// ---------- setup ----------
function setupMove(ctx, legal) {
  const { state, rng, level } = ctx;
  if (state.setup.corner === -1) {
    const corners = legal.map((m) => m.settle);
    if (level === "easy") {
      const pipsOf = (c) => sum(cornerYield(state.board, c));
      const ranked = corners.slice().sort((a, b) => pipsOf(b) - pipsOf(a));
      return { settle: pickRandom(ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 3))), rng) };
    }
    return { settle: best(corners, (c) => cornerValue(ctx, c)) };
  }
  if (level === "easy") return pickRandom(legal, rng);
  // Toward the best free corner two roads away.
  const from = state.setup.corner;
  const ahead = (e) => {
    const d = other(e, from);
    const spots = CORNERS[d].corners.filter((c) => c !== from && isFree(state, c));
    return Math.max(0, ...spots.map((c) => cornerValue(ctx, c)));
  };
  return best(legal, (m) => ahead(m.road));
}

// ---------- the robber ----------
function robberMove(ctx, legal) {
  const { state, me, rng, level, face } = ctx;
  const mine = (hex) => HEXES[hex].corners.some((c) => state.buildings[c]?.p === me);
  const fair = legal.filter((m) => !mine(m.robber));
  const pool = fair.length ? fair : legal;
  if (level === "easy") return pickRandom(pool, rng);
  const lead = leaderOf(ctx);
  const plan = planOf(ctx);
  const want = plan.length ? plan[0].cost.map((n, r) => Math.max(0, n - ctx.hand[r])) : [0, 0, 0, 0, 0];
  const block = (hex) =>
    HEXES[hex].corners.reduce((v, c) => {
      const b = state.buildings[c];
      if (!b || b.p === me) return v;
      return v + pips(state.board.numbers[hex]) * (b.city ? 2 : 1) * (b.p === lead ? 2 : 1) * (1 + points(state, b.p) * 0.05);
    }, 0);
  const victimValue = (q) => {
    if (q === -1) return 0;
    let v = 1 + (q === lead ? 1.5 : 0) + state.hands[q].length * 0.15;
    if (level === "hard") {
      const { known, hidden } = seenHand(state, q, face);
      const n = sum(known) + hidden;
      v += (n ? sum(known.map((k, r) => k * want[r])) / n : 0) * 3;
    }
    return v;
  };
  return best(pool, (m) => block(m.robber) + victimValue(m.steal));
}

// ---------- discards ----------
// Keep what the plan needs, nearest goal first; give up the most plentiful of the rest.
function discardMove(ctx) {
  const { state, me, face, rng, level } = ctx;
  const hand = state.hands[me];
  const n = state.discards[me];
  if (level === "easy") {
    const left = hand.slice();
    return { discard: Array.from({ length: n }, () => left.splice(Math.floor(rng() * left.length), 1)[0]) };
  }
  const keep = new Map();
  const left = hand.slice();
  planOf(ctx).forEach((g, i) => {
    for (const r of RESOURCES) {
      for (let k = 0; k < g.cost[r]; k++) {
        const at = left.findIndex((s) => resourceOf(face(s)) === r);
        if (at < 0) break;
        keep.set(left[at], 100 - i * 10);
        left.splice(at, 1);
      }
    }
  });
  const plenty = counts(hand, face);
  const value = (s) => keep.get(s) ?? -plenty[resourceOf(face(s))] + ctx.weights[resourceOf(face(s))] * 0.1;
  return { discard: hand.slice().sort((a, b) => value(a) - value(b)).slice(0, n) };
}

// ---------- trades ----------
function answerMove(ctx) {
  const { state, me, face, rng, level } = ctx;
  const t = state.trade;
  const gets = counts(t.give, face);
  const pay = legalMoves(state, me, face).find(has("accept"));
  if (!pay) return { decline: true };
  if (level === "easy") return t.give.length >= sum(t.want) && rng() < 0.7 ? pay : { decline: true };
  // Never feed a player close to winning.
  const near = level === "hard" ? 3 : 2;
  if (points(state, t.from) >= state.target - near) return { decline: true };
  if (level === "hard" && t.from === leaderOf(ctx) && points(state, t.from) >= points(state, me) + 2) return { decline: true };
  const after = ctx.hand.map((n, r) => n - t.want[r] + gets[r]);
  return progress(ctx, after) > progress(ctx, ctx.hand) + 0.01 ? pay : { decline: true };
}

function partnerMove(ctx, legal) {
  const { state, level } = ctx;
  const takers = legal.filter((m) => m.partner !== -1);
  if (level === "easy") return takers[0] ?? { partner: -1 };
  const safe = level === "hard" ? takers.filter((m) => points(state, m.partner) < state.target - 2) : takers;
  return best(safe, (m) => -points(state, m.partner) - state.hands[m.partner].length * 0.01) ?? { partner: -1 };
}

// One card the plan can spare for one the nearest goal lacks, when that would complete it.
function offerMove(ctx, legal) {
  const { state, me, face, rng, level } = ctx;
  if (!legal.some(has("offer")) || rng() >= LEVELS[level].offer) return null;
  const goal = planOf(ctx).find((g) => g.kind !== "dev") ?? planOf(ctx)[0];
  if (!goal || missing(ctx.hand, goal.cost) !== 1) return null;
  const need = RESOURCES.find((r) => goal.cost[r] > ctx.hand[r]);
  const spare = RESOURCES.filter((r) => ctx.hand[r] > goal.cost[r] && r !== need);
  if (!spare.length) return null;
  if (level === "hard") {
    // Only when someone who may take it holds the card, face up or hidden.
    const holds = (q) => {
      const { known, hidden } = seenHand(state, q, face);
      return known[need] > 0 || hidden > 0;
    };
    if (!seatsOf(state).some((q) => q !== me && points(state, q) < state.target - 2 && holds(q))) return null;
  }
  const give = best(spare, (r) => ctx.hand[r] - goal.cost[r]);
  const slot = state.hands[me].find((s) => resourceOf(face(s)) === give);
  return { offer: [slot], want: RESOURCES.map((r) => (r === need ? 1 : 0)) };
}

// ---------- development cards ----------
function devPlay(ctx, legal) {
  const { state, me, face, level, rng } = ctx;
  const plays = legal.filter(has("play"));
  if (!plays.length) return null;
  const kind = (m) => devKind(face(m.play));
  const of = (k) => plays.filter((m) => kind(m) === k);
  if (level === "easy") return rng() < 0.3 ? pickRandom(plays, rng) : null;

  const robbed = HEXES[state.robber].corners.some((c) => state.buildings[c]?.p === me) && state.board.numbers[state.robber] > 0;
  const k = state.knights[me];
  const army = state.army.p !== me && k + 1 >= ARMY_MIN && k + 1 > state.army.size;
  const race = level === "hard" && state.army.p !== me && k + 1 >= state.army.size;
  if (of("knight").length && (robbed || army || race)) return of("knight")[0];
  if (state.phase !== "main") return null;

  const plan = planOf(ctx);
  // Year of plenty: the cards that complete a goal.
  for (const g of plan) {
    const short = RESOURCES.flatMap((r) => Array(Math.max(0, g.cost[r] - ctx.hand[r])).fill(r));
    if (!short.length || short.length > 2) continue;
    const take = short.length === 2 ? short : [short[0], best(RESOURCES, (r) => (plan[1]?.cost[r] ?? 0) - ctx.hand[r] * 0.1)];
    take.sort((a, b) => a - b);
    const m = of("plenty").find((x) => x.take[0] === take[0] && x.take[1] === take[1]);
    if (m) return m;
  }
  // Road building toward the target corner, or (Hard) into the longest road race.
  if (of("road").length && (plan.some((g) => g.kind === "road") || (level === "hard" && roadRace(ctx)))) return of("road")[0];
  // Monopoly: Hard names what the others hold most of, face up; Medium what it lacks.
  if (of("monopoly").length) {
    const others = seatsOf(state).filter((q) => q !== me);
    if (level === "hard") {
      const held = RESOURCES.map((r) => sum(others.map((q) => seenHand(state, q, face).known[r])));
      const r = best(RESOURCES, (x) => held[x] + (plan[0] && plan[0].cost[x] > ctx.hand[x] ? 0.5 : 0));
      if (held[r] >= 3) return of("monopoly").find((m) => m.resource === r);
    } else if (plan[0] && sum(others.map((q) => state.hands[q].length)) >= 8) {
      const r = best(RESOURCES, (x) => plan[0].cost[x] - ctx.hand[x]);
      if (plan[0].cost[r] > ctx.hand[r]) return of("monopoly").find((m) => m.resource === r);
    }
  }
  return null;
}

// Hard: a road that takes or keeps longest road against someone close.
function roadRace(ctx) {
  const { state, me } = ctx;
  const mine = roadLength(state, me);
  const rival = Math.max(...seatsOf(state).filter((q) => q !== me).map((q) => roadLength(state, q)));
  if (mine < LONGEST_MIN - 2) return false;
  return state.longest.p === me ? rival >= mine - 1 : mine + 2 > state.longest.size;
}

// The road that lengthens p's longest road most.
function longestRoad(ctx, edges) {
  const { state, me } = ctx;
  return best(edges, (e) => lengthWith(state, me, e));
}

// ---------- a turn ----------
function rollMove(ctx, legal) {
  const claim = legal.find(has("claim"));
  if (claim) return claim;
  return devPlay(ctx, legal) ?? { roll: true };
}

function freeRoad(ctx, legal) {
  const target = planOf(ctx).find((g) => g.kind === "road");
  const edges = legal.map((m) => m.road);
  if (target && edges.includes(target.at)) return { road: target.at };
  return { road: longestRoad(ctx, edges) };
}

function easyMain(ctx, legal) {
  const { rng } = ctx;
  const of = (k) => legal.filter(has(k));
  for (const k of ["city", "settle"]) if (of(k).length) return pickRandom(of(k), rng);
  // Roads toward somewhere to settle, now and then anywhere.
  const target = planOf(ctx).find((g) => g.kind === "road");
  const road = target && of("road").find((m) => m.road === target.at);
  if (road && rng() < 0.7) return road;
  if (of("road").length && rng() < 0.15) return pickRandom(of("road"), rng);
  if (of("buy").length && rng() < 0.5) return of("buy")[0];
  const dev = devPlay(ctx, legal);
  if (dev) return dev;
  // A bank trade only toward a build it can then make.
  for (const g of planOf(ctx).filter((x) => x.kind !== "dev")) {
    const m = bankMove(legal, ctx.face, bankStep(ctx, g));
    if (m && rng() < 0.6) return m;
  }
  return offerMove(ctx, legal) ?? { end: true };
}

function mainMove(ctx, legal) {
  const { state, me, level } = ctx;
  const claim = legal.find(has("claim"));
  if (claim) return claim;
  if (state.freeRoads) return freeRoad(ctx, legal);
  if (level === "easy") return easyMain(ctx, legal);

  const dev = devPlay(ctx, legal);
  if (dev) return dev;
  const plan = planOf(ctx);
  const goal = (kind) => plan.find((g) => g.kind === kind);
  const city = legal.filter(has("city"));
  if (city.length) return city.find((m) => m.city === goal("city")?.at) ?? city[0];
  const settle = legal.filter(has("settle"));
  if (settle.length) return settle.find((m) => m.settle === goal("settlement")?.at) ?? settle[0];
  const road = legal.filter(has("road"));
  if (road.length) {
    const target = goal("road");
    const m = target && road.find((x) => x.road === target.at);
    if (m) return m;
    if (level === "hard" && roadRace(ctx)) {
      const e = longestRoad(ctx, road.map((x) => x.road));
      if (lengthWith(state, me, e) > roadLength(state, me)) return road.find((x) => x.road === e);
    }
  }
  const buy = legal.find(has("buy"));
  if (buy && (level === "hard" || devIsSafe(ctx))) return buy;
  // Bank trades that complete a goal now, nearest first.
  for (const g of plan) {
    const m = bankMove(legal, ctx.face, bankStep(ctx, g));
    if (m) return m;
  }
  // Hard: over 7 cards, trade toward the plan rather than lose half on a 7.
  if (level === "hard" && sum(ctx.hand) > 7 && plan.length) {
    const m = bankMove(legal, ctx.face, bankStep(ctx, plan[0], false));
    if (m) return m;
  }
  return offerMove(ctx, legal) ?? { end: true };
}

// The choice for `me` at a level; null when it isn't a choice. face: the engine's.
export function chooseChoice(state, me, rng, face, level = "easy") {
  if (!LEVELS[level]) level = "easy";
  const legal = legalMoves(state, me, face);
  if (!legal.length) return null;
  const ctx = context(state, me, face, rng, level);
  switch (state.phase) {
    case "setup":
      return setupMove(ctx, legal);
    case "roll":
      return rollMove(ctx, legal);
    case "discard":
      return discardMove(ctx);
    case "robber":
      return robberMove(ctx, legal);
    case "main":
      return mainMove(ctx, legal);
    case "answer":
      return answerMove(ctx);
    case "partner":
      return partnerMove(ctx, legal);
  }
  return legal[0];
}

// Returns a legal move for `me`: the forced one, else a choice. face is the engine's face().
export function chooseMove(state, me, rng, face, { level = "easy" } = {}) {
  return forcedMove(state, me, face) ?? chooseChoice(state, me, rng, face, level);
}

// The move a player's clock makes for them, and a robot's when its own is
// refused: claim a win, roll, end the turn, decline an offer; elsewhere what Hard would do.
export function timeoutMove(state, me, face) {
  const forced = forcedMove(state, me, face);
  if (forced) return forced;
  const legal = legalMoves(state, me, face);
  const claim = legal.find(has("claim"));
  if (claim) return claim;
  if (state.phase === "roll") return { roll: true };
  if (state.phase === "main" && !state.freeRoads) return { end: true };
  if (state.phase === "answer") return { decline: true };
  return chooseChoice(state, me, () => 0.99, face, "hard");
}

// A robot seat that pauses as the view asks: delay() returns ms, or -1 to wait for the screen.
export function startRobot(session, { rules, choose, delay, rng }) {
  return startPacedRobot(session, { rules, choose, delay, rng, key: (st) => `${st.moves}`, fallback: timeoutMove });
}
