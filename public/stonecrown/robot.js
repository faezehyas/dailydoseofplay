// Stonecrown robots: the public state (every city, wonder stage count, coins
// and military token) and their own face(), which shows their hand, the
// cards they held before passing them on and, while digging, the discards;
// nothing else. Easy builds what it can afford cheaply, by a simple worth with
// some chance, builds a stage when it's free and sells when stuck. Medium
// weighs each outcome by the points it makes now, the resources its wonder and
// the next age need, chains, science sets, military parity this age and
// coins. Hard estimates the final score of each outcome: science sets still
// to come, guilds counting what neighbours will build, every war still to
// fight against each neighbour, resources for whatever is still to come,
// chains, stage effects and the free build kept for a card worth it; it
// tucks or sells the card the next seat clearly wants, and pays the weaker
// neighbour when a purchase can go either way. A dig with nothing to build
// is forcedMove(). See "Stonecrown in depth" in ARCHITECTURE.md.
import { startPacedRobot } from "../engine/cards/paced-robot.js";
import { CARDS, RESOURCES, AGES, VICTORY, DEFEAT, DISCARD_COINS, ageCards, GUILDS, guildCount } from "./cards.js";
import {
  ROUNDS,
  legalMoves,
  forcedMove,
  production,
  unitPrice,
  sideCoins,
  score,
  tally,
  scienceSymbols,
  sciencePoints,
  shields,
  leftOf,
  rightOf,
  passDir,
  designOf,
  cardsOf,
  chained,
  canBuild,
  canUseFree,
  stagesOf,
  builtStages,
  holdsKey,
} from "./rules.js";

// noise: Easy's chance in points. sci: how many more science symbols a seat
// expects a pick left, per symbol it holds. wars: ages of war ahead it counts.
// stageW/cardW: how much the resources for its next stages and for the cards
// still to come (this age and `ahead` ages more) weigh. chain: a later card
// free through a chain, as a share of its worth. deny: a point the next seat
// loses, as one of its own. guilds: counting what neighbours will still
// build. tip: points a coin paid to a neighbour who's ahead costs beyond itself.
export const LEVELS = {
  easy: { noise: 2.2 },
  medium: { sci: [0.02, 0.025], wars: 1, stageW: [1.2, 0.8, 0.5, 0.3], cardW: 3.5, ahead: 1, chain: 0.25, deny: 0, guilds: false, tip: 0 },
  hard: { sci: [0.025, 0.03], wars: 3, stageW: [1.2, 1, 0.8, 0.6], cardW: 3.5, ahead: 2, chain: 0.35, deny: 0.35, guilds: true, tip: 0.12 },
};

const has = (k) => (m) => Object.hasOwn(m, k);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
// The first of list with the highest score.
function best(list, value) {
  let top;
  let high = -Infinity;
  for (const x of list) {
    const v = value(x);
    if (v > high) [top, high] = [x, v];
  }
  return top;
}
const logistic = (x) => 1 / (1 + Math.exp(-1.7 * x));
// Coins a unit no neighbour sells is worth avoiding, as if it cost this much.
const UNBUYABLE = 6;

// ---------- what is still to come ----------
// Each age's designs with their copies, for a player count; the guilds as the share of them dealt.
const AGE_DECKS = new Map();
function ageDecks(players) {
  if (!AGE_DECKS.has(players)) {
    const decks = [1, 2, 3].map((a) => {
      const copies = new Map();
      for (const id of ageCards(a, players)) copies.set(id, (copies.get(id) ?? 0) + 1);
      if (a === AGES) for (const id of GUILDS) copies.set(id, guildCount(players) / GUILDS.length);
      const total = sum([...copies.values()]);
      const share = {};
      for (const [id, n] of copies) share[CARDS[id].color] = (share[CARDS[id].color] ?? 0) + n / total;
      return { copies: [...copies], total, share };
    });
    AGE_DECKS.set(players, decks);
  }
  return AGE_DECKS.get(players);
}

// Picks each seat still makes after this one, this age and in all.
function picksLeft(state) {
  const age = state.phase === "pick" ? ROUNDS - state.round : 0;
  return { age, game: age + ROUNDS * (AGES - state.age) };
}

// A rough worth of a card in points, for chains and Easy.
function worth(card) {
  if (card.points) return card.points;
  if (card.shields) return card.shields * 1.5;
  if (card.science !== undefined) return 2.5;
  if (card.color === "purple") return 4;
  if (card.color === "yellow") return 2;
  return 1.5;
}

// ---------- p's state after its own pick ----------
// The state as p's pick alone leaves it: a card built (id), a stage, coins
// paid or received; the others' picks of the same turn are unknown.
function after(state, p, { id, stage = false, pay = 0, gain = 0, free = false }) {
  const st = { ...state, city: state.city.slice(), stages: state.stages.slice(), coins: state.coins.slice(), freeAge: state.freeAge.slice() };
  st.coins[p] += gain - pay;
  if (id !== undefined) {
    st.city[p] = [...state.city[p], { slot: -1, id }];
    const c = CARDS[id];
    st.coins[p] += (c.gold ?? 0) + (c.income ? tally(st, p, c.income, c.income.coins) : 0);
  }
  if (stage) {
    st.coins[p] += stagesOf(state, p)[state.stages[p].length].gold ?? 0;
    st.stages[p] = [...state.stages[p], -1];
  }
  if (free) st.freeAge[p] = state.age;
  return st;
}

// ---------- the estimate ----------
// The most k more science symbols can add, best placed.
function scienceWith(counts, wilds, k) {
  let top = 0;
  for (let a = 0; a <= k; a++) for (let b = 0; a + b <= k; b++) top = Math.max(top, sciencePoints([counts[0] + a, counts[1] + b, counts[2] + k - a - b], wilds));
  return top;
}
// Science points with the symbols p may still expect, more the more it already has.
function scienceAhead(ctx, state, p) {
  const { counts, wilds } = scienceSymbols(state, p);
  const now = sciencePoints(counts, wilds);
  const [base, per] = ctx.lv.sci;
  const x = Math.min(4, ctx.left.game * (base + per * (sum(counts) + wilds)));
  const k = Math.floor(x);
  const lo = k ? scienceWith(counts, wilds, k) : now;
  const hi = scienceWith(counts, wilds, k + 1);
  return lo + (hi - lo) * (x - k) - now;
}

// Expected military points from every war still to fight, from shield counts now.
function militaryAhead(ctx, state, p) {
  const mine = shields(state, p);
  let v = 0;
  for (const q of [leftOf(state, p), rightOf(state, p)]) {
    const d = mine - (ctx.shields[q] ?? shields(state, q));
    for (let a = state.age; a <= Math.min(AGES, state.age + ctx.lv.wars - 1); a++) {
      const turns = ctx.left.age + ROUNDS * (a - state.age);
      const sd = 0.45 + 0.35 * turns;
      const win = logistic((d - 0.5) / sd);
      const lose = logistic((-d - 0.5) / sd);
      v += win * VICTORY[a - 1] - lose * -DEFEAT;
    }
  }
  return v;
}

// What the neighbours sell: whether each resource can be bought on each side.
function sellers(state, p) {
  const side = (q) => {
    const can = Array(RESOURCES.length).fill(false);
    for (const u of production(state, q).sale) for (const r of u) can[r] = true;
    return can;
  };
  return { left: side(leftOf(state, p)), right: side(rightOf(state, p)) };
}

// Coins to buy what own units can't make of need; a resource nobody sells counts UNBUYABLE.
function buyCost(own, need, price) {
  const left = need.slice();
  const choice = [];
  for (const u of own) {
    if (u.length !== 1) choice.push(u);
    else if (left[u[0]] > 0) left[u[0]]--;
  }
  const want = left.flatMap((n, r) => Array(Math.max(0, n)).fill(r));
  if (!want.length) return 0;
  // The dearest wants are matched to choice units first, so what stays unmatched is the cheapest to buy.
  want.sort((a, b) => price[b] - price[a]);
  const owner = Array(choice.length).fill(-1);
  const assign = (t, seen) => {
    for (let u = 0; u < choice.length; u++) {
      if (seen[u] || !choice[u].includes(want[t])) continue;
      seen[u] = true;
      if (owner[u] === -1 || assign(owner[u], seen)) {
        owner[u] = t;
        return true;
      }
    }
    return false;
  };
  let coins = 0;
  for (let t = 0; t < want.length; t++) if (!assign(t, Array(choice.length).fill(false))) coins += price[want[t]];
  return coins;
}

// What p would pay, in points, to buy the resources of its next stages and of the cards still to come.
function resourcesAhead(ctx, state, p) {
  const { lv, left } = ctx;
  const own = production(state, p).own;
  const price = RESOURCES.map((r) => {
    const l = ctx.sell.left[r] ? unitPrice(state, p, r, "left") : UNBUYABLE;
    const rr = ctx.sell.right[r] ? unitPrice(state, p, r, "right") : UNBUYABLE;
    return Math.min(l, rr);
  });
  let coins = 0;
  const stages = stagesOf(state, p).slice(state.stages[p].length);
  stages.forEach((s, i) => (coins += (lv.stageW[i] ?? 0) * Math.min(1, left.game / (2 + 2 * i)) * buyCost(own, s.cost.res, price)));
  const decks = ageDecks(state.players);
  for (let a = state.age; a <= Math.min(AGES, state.age + lv.ahead); a++) {
    const weight = lv.cardW * (a === state.age ? left.age / ROUNDS : 1);
    const { copies, total } = decks[a - 1];
    for (const [id, n] of copies) {
      const c = CARDS[id];
      if (!sum(c.cost.res) || holdsKey(state, p, c.key) || chained(state, p, c)) continue;
      coins += ((weight * n) / total) * buyCost(own, c.cost.res, price);
    }
  }
  return -coins * ctx.coin;
}

// Later cards p could build free through a chain, as a share of their worth.
function chainsAhead(ctx, state, p) {
  const decks = ageDecks(state.players);
  let v = 0;
  for (let a = state.age + 1; a <= AGES; a++) {
    for (const [id, n] of decks[a - 1].copies) {
      const c = CARDS[id];
      if (c.from.length && !holdsKey(state, p, c.key) && chained(state, p, c)) v += Math.min(1, n * 0.5) * worth(c);
    }
  }
  return v * ctx.lv.chain;
}

// Guild points from what neighbours (and p) will build in the picks left.
function guildsAhead(ctx, state, p) {
  if (!ctx.lv.guilds) return 0;
  const share = ageDecks(state.players)[state.age - 1].share;
  let v = 0;
  for (const c of cardsOf(state, p)) {
    if (c.color !== "purple" || !c.score) continue;
    const { per, from, points } = c.score;
    const each = per === "stage" ? 0.15 : per === "defeat" ? 0 : sum((Array.isArray(per) ? per : [per]).map((k) => share[k] ?? 0));
    v += points * from.length * each * ctx.left.game * 0.8;
  }
  return v;
}

// The stages p has built that pay off later: a free build each age, a seventh card played each age, a guild copied.
function stagesAhead(ctx, state, p) {
  let v = 0;
  for (const s of builtStages(state, p)) {
    if (s.free) v += 3 * (AGES - state.age) + (canUseFree(state, p) ? Math.min(3, ctx.left.age * 0.75) : 0);
    if (s.playLast) v += 1.5 * (AGES - state.age + (state.phase === "pick" ? 1 : 0));
    if (s.copyGuild && score(state, p).copied === -1) v += state.age < AGES ? 4 : Math.min(3, ctx.left.game * 0.6);
  }
  return v;
}

// A stage's worth in points, effects included.
const EFFECT_WORTH = { produce: 2, dig: 3, free: 4, science: 3, playLast: 3, copyGuild: 5, trade: 2 };
function stageWorth(s) {
  return (s.points ?? 0) + (s.shields ?? 0) * 1.5 + (s.gold ?? 0) / 3 + sum(Object.keys(EFFECT_WORTH).map((k) => (s[k] ? EFFECT_WORTH[k] : 0)));
}
// The stages still to build, each a share of its worth: more for the next one, less with fewer picks left.
function wonderAhead(ctx, state, p) {
  const rest = stagesOf(state, p).slice(state.stages[p].length);
  return sum(rest.map((s, k) => stageWorth(s) * [0.3, 0.15, 0.08, 0.04][k] * Math.min(1, ctx.left.game / (3 * (k + 1)))));
}

// p's final score as the level sees it, from a state.
function estimate(ctx, state, p) {
  const sc = score(state, p);
  return (
    sc.wonder +
    sc.civic +
    sc.commerce +
    sc.guilds +
    sc.science +
    sum(state.tokens[p]) +
    state.coins[p] * ctx.coin +
    scienceAhead(ctx, state, p) +
    militaryAhead(ctx, state, p) +
    resourcesAhead(ctx, state, p) +
    chainsAhead(ctx, state, p) +
    guildsAhead(ctx, state, p) +
    stagesAhead(ctx, state, p) +
    wonderAhead(ctx, state, p)
  );
}

// A simpler estimate for another seat: points, science, military and coins.
function theirEstimate(ctx, state, q) {
  const sc = score(state, q);
  return sc.civic + sc.commerce + sc.guilds + sc.science + state.coins[q] * ctx.coin + scienceAhead(ctx, state, q) + militaryAhead(ctx, state, q) + guildsAhead(ctx, state, q);
}

function context(state, me, face, rng, level) {
  const lv = LEVELS[level];
  const left = picksLeft(state);
  // A coin buys resources while the game lasts; at the end it's a third of a point.
  const coin = 1 / 3 + 0.2 * Math.min(1, left.game / 12);
  const ctx = { state, me, face, rng, level, lv, left, coin, shields: {} };
  for (const q of [leftOf(state, me), rightOf(state, me)]) ctx.shields[q] = shields(state, q);
  ctx.sell = sellers(state, me);
  return ctx;
}

// ---------- Easy ----------
function easyWorth(state, me, card) {
  if (card.produce && (card.color === "brown" || card.color === "grey")) {
    const fresh = card.produce.some((u) => u.some((r) => !production(state, me).own.some((o) => o.length === 1 && o[0] === r)));
    return (state.age === 1 ? 2.2 : state.age === 2 ? 1.6 : 0.2) + (fresh ? 0.8 : 0);
  }
  return worth(card);
}

function easyMove(ctx, legal) {
  const { state, me, face, rng, lv } = ctx;
  if (state.phase === "dig") return best(legal, (m) => (m.dig === -1 ? 0 : easyWorth(state, me, CARDS[designOf(state.players, face(m.dig))])));
  const value = (m) => {
    if (has("build")(m)) {
      const c = CARDS[designOf(state.players, face(m.build))];
      return easyWorth(state, me, c) - 0.3 * paid(state, me, m, c) - (m.free ? 0.5 : 0);
    }
    if (has("stage")(m)) return 2.4 - 0.3 * paid(state, me, m);
    return state.coins[me] < 2 ? 1.4 : 0.6;
  };
  return best(legal, (m) => value(m) + rng() * lv.noise);
}

// ---------- Medium and Hard ----------
// The seat that gets the hand this robot passes on, or -1 when nothing passes on.
const receiver = (state, me) => (state.phase === "pick" && state.round < ROUNDS ? (me + passDir(state.age) + state.players) % state.players : -1);

// How much the next seat would gain from each card of the hand, and what
// taking each one denies it: the gap to its next best, for the card it wants most.
function denials(ctx, ids) {
  const { state, me, lv } = ctx;
  const q = receiver(state, me);
  const out = ids.map(() => 0);
  if (!lv.deny || q === -1 || ids.length < 2) return out;
  const shieldsBefore = ctx.shields;
  ctx.shields = { [leftOf(state, q)]: shields(state, leftOf(state, q)), [rightOf(state, q)]: shields(state, rightOf(state, q)) };
  const base = theirEstimate(ctx, state, q);
  const gains = ids.map((id) => {
    const can = canBuild(state, q, id);
    if (!can.ok) return 0;
    const pay = can.chain || can.purchases.length === 0 ? 0 : can.purchases[0].coins + CARDS[id].cost.coins;
    return theirEstimate(ctx, after(state, q, { id, pay }), q) - base;
  });
  ctx.shields = shieldsBefore;
  const order = gains.map((g, i) => i).sort((a, b) => gains[b] - gains[a]);
  const [top, next] = order;
  // A point taken from one opponent helps every other opponent too.
  out[top] = Math.max(0, gains[top] - Math.max(0, gains[next])) * lv.deny * (3 / state.players);
  return out;
}

// What a purchase costs beyond its coins: coins handed to a neighbour help it, more so one who's ahead.
function purchaseCost(ctx, m) {
  const { state, me, lv } = ctx;
  if (!m.buy) return 0;
  const to = sideCoins(state, me, m.buy);
  const tip = (q) => (ctx.totals[q] >= ctx.totals[me] ? lv.tip : lv.tip / 3) + 1e-3;
  return to.left * tip(leftOf(state, me)) + to.right * tip(rightOf(state, me));
}

// The coins a build or stage move pays from p's purse.
function paid(state, me, m, card) {
  const to = m.buy ? sideCoins(state, me, m.buy) : { left: 0, right: 0 };
  return to.left + to.right + (card && !m.free ? card.cost.coins : 0);
}

// A dig stage builds a discarded card free at the end of the turn: worth more the fuller the pile.
function digWorth(ctx) {
  const { state } = ctx;
  const sevenths = state.phase === "pick" && state.round === ROUNDS;
  return state.discard.length || sevenths ? 2.5 + Math.min(2, (state.discard.length + (sevenths ? state.players : 0)) * 0.2) : 0.3;
}

function thinkingMove(ctx, legal) {
  const { state, me, face } = ctx;
  ctx.totals = Object.fromEntries([...Array(state.players).keys()].map((q) => [q, score(state, q).total]));
  const idOf = (slot) => designOf(state.players, face(slot));
  const now = () => (ctx.base ??= estimate(ctx, state, me));

  if (state.phase === "dig") {
    return best(legal, (m) => (m.dig === -1 ? now() : estimate(ctx, after(state, me, { id: idOf(m.dig) }), me)));
  }

  const hand = state.hands[me];
  const ids = hand.map(idOf);
  const deny = denials(ctx, ids);
  const denyOf = (slot) => deny[hand.indexOf(slot)];
  // The card to tuck or sell: the one the next seat wants most, else the one worth least to this robot.
  const mine = new Map();
  const ownWorth = (slot) => {
    if (!mine.has(slot)) mine.set(slot, canBuild(state, me, idOf(slot)).ok ? worth(CARDS[idOf(slot)]) : 0);
    return mine.get(slot);
  };
  const giveUp = best(hand, (slot) => denyOf(slot) * 10 - ownWorth(slot));

  const options = [];
  const builds = new Map();
  for (const m of legal) {
    if (!has("build")(m)) continue;
    const c = CARDS[idOf(m.build)];
    const key = `${m.build}:${m.free ? "free" : "paid"}`;
    const cost = paid(state, me, m, c);
    const prev = builds.get(key);
    const extra = purchaseCost(ctx, m);
    if (!prev || cost + extra / ctx.coin < prev.cost + prev.extra / ctx.coin) builds.set(key, { m, c, cost, extra });
  }
  for (const { m, c, cost, extra } of builds.values()) {
    const v = estimate(ctx, after(state, me, { id: c.id, pay: cost, free: !!m.free }), me) - extra + denyOf(m.build);
    options.push([m, v]);
  }
  const stages = legal.filter((m) => has("stage")(m) && m.stage === giveUp);
  if (stages.length) {
    const m = best(stages, (x) => -(paid(state, me, x) + purchaseCost(ctx, x) / ctx.coin));
    const n = state.stages[me].length;
    const st = after(state, me, { stage: true, pay: paid(state, me, m) });
    options.push([m, estimate(ctx, st, me) - purchaseCost(ctx, m) + (stagesOf(state, me)[n].dig ? digWorth(ctx) : 0) + denyOf(giveUp)]);
  }
  const sale = legal.find((m) => m.discard === giveUp);
  if (sale) options.push([sale, estimate(ctx, after(state, me, { gain: DISCARD_COINS }), me) + denyOf(giveUp)]);
  return best(options, ([, v]) => v)[0];
}

// A free build only where it saves coins or makes possible what couldn't be paid for.
function wasted(state, me, face, m) {
  if (!m.free) return false;
  const can = canBuild(state, me, designOf(state.players, face(m.build)));
  return can.chain || (can.purchases[0]?.coins === 0 && CARDS[designOf(state.players, face(m.build))].cost.coins === 0);
}

// The choice for `me` at a level; null when it isn't a choice. face: the engine's.
export function chooseChoice(state, me, rng, face, level = "easy") {
  if (!LEVELS[level]) level = "easy";
  const legal = legalMoves(state, me, face).filter((m) => !wasted(state, me, face, m));
  if (!legal.length) return null;
  const ctx = context(state, me, face, rng, level);
  return level === "easy" ? easyMove(ctx, legal) : thinkingMove(ctx, legal);
}

// Returns a legal move for `me`: the forced one, else a choice. face is the engine's face().
export function chooseMove(state, me, rng, face, { level = "easy" } = {}) {
  return forcedMove(state, me, face) ?? chooseChoice(state, me, rng, face, level);
}

// The move a player's clock makes for them, and a robot's when its own is refused: what Medium would pick.
export function timeoutMove(state, me, face) {
  return chooseMove(state, me, () => 0.5, face, { level: "medium" });
}

// A robot seat that pauses as the view asks: delay() returns ms, or -1 to wait for the screen.
export function startRobot(session, { rules, choose, delay, rng }) {
  return startPacedRobot(session, { rules, choose, delay, rng, key: (st) => `${st.moves}`, fallback: timeoutMove });
}
