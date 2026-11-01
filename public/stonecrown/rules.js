// Stonecrown rules for CardMatch (engine/card-match.js): three ages of six
// turns in which every seat picks a card from its hand at once (a step),
// then the hands pass on. Every card of the game is a card of the deck, face
// up in face order until its age is shuffled and dealt. A build shows its
// card (reveals()); a wonder stage or a sale keeps it hidden in its holder's
// hand, so the state never depends on its face. applyMove() only records a
// pick; settle() resolves the turn. See "Stonecrown in depth" in
// ARCHITECTURE.md.
import { RuleError } from "../engine/turn-match.js";
import {
  CARDS,
  WONDERS,
  RESOURCES,
  HAND,
  AGES,
  START_COINS,
  DISCARD_COINS,
  TRADE_COST,
  TRADE_DISCOUNT,
  VICTORY,
  DEFEAT,
  SIDES,
  MAX_PLAYERS as MOST_PLAYERS,
  deckFor,
  deckRanges,
  guildCount,
} from "./cards.js";

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 4;
export const SIDES_SETTING = ["A", "B", "random"];
export const MOVE_SECONDS = [0, 30, 60, 120];
export const LEVELS = ["easy", "medium", "hard"];
// level is per device; the rules ignore it.
export const DEFAULT_CONFIG = { side: "A", moveSeconds: 0, level: "easy" };
export const ROUNDS = HAND - 1;

export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  return {
    side: pick(c.side, SIDES_SETTING, DEFAULT_CONFIG.side),
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    level: pick(c.level, LEVELS, DEFAULT_CONFIG.level),
  };
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const zero = () => [0, 0, 0, 0, 0, 0, 0];
const isCounts = (v) => Array.isArray(v) && v.length === RESOURCES.length && v.every((x) => Number.isInteger(x) && x >= 0 && x <= HAND);
const isMove = (m) => !!m && typeof m === "object" && !Array.isArray(m);
export const seatsOf = (state) => [...Array(state.players).keys()];
// Left is seat p + 1, right is seat p − 1.
export const leftOf = (state, p) => (p + 1) % state.players;
export const rightOf = (state, p) => (p + state.players - 1) % state.players;
const seatOn = (state, p, side) => (side === "left" ? leftOf(state, p) : side === "right" ? rightOf(state, p) : p);
// Hands go left in ages I and III, right in age II.
export const passDir = (age) => (age === 2 ? -1 : 1);

const DECKS = new Map();
// Face → design id for a player count (deckFor, cached).
export function deckOf(players) {
  if (!DECKS.has(players)) DECKS.set(players, deckFor(players));
  return DECKS.get(players);
}
// The design id of a face, or -1 for no face.
export const designOf = (players, face) => (Number.isInteger(face) ? (deckOf(players)[face] ?? -1) : -1);

export const wonderOf = (state, p) => WONDERS[state.wonders[p].w];
// Every stage of p's wonder side, and the ones built.
export const stagesOf = (state, p) => wonderOf(state, p).sides[state.wonders[p].side];
export const builtStages = (state, p) => stagesOf(state, p).slice(0, state.stages[p].length);
export const cardsOf = (state, p) => state.city[p].map((c) => CARDS[c.id]);
export const holdsKey = (state, p, key) => state.city[p].some((c) => CARDS[c.id].key === key);
const stageHas = (state, p, effect) => builtStages(state, p).some((s) => s[effect]);
// A card built free through a chain: the city holds a card whose key is in its `from`.
export const chained = (state, p, card) => card.from.some((k) => holdsKey(state, p, k));
export const canUseFree = (state, p) => stageHas(state, p, "free") && state.freeAge[p] !== state.age;

// Resource units, each a list of the resources it may be: everything p may
// use, or (sale) what neighbours may buy: brown and grey cards and the wonder's own.
function units(state, p, sale) {
  const out = [[wonderOf(state, p).produce]];
  for (const c of cardsOf(state, p)) if (c.produce && (!sale || c.color === "brown" || c.color === "grey")) out.push(...c.produce);
  if (!sale) for (const s of builtStages(state, p)) if (s.produce) out.push(...s.produce);
  return out;
}
export const production = (state, p) => ({ own: units(state, p, false), sale: units(state, p, true) });

// Whether units, each used once, can make every resource count in need.
export function covers(list, need) {
  const left = need.slice();
  const choice = [];
  // A single-resource unit is always best spent on its own resource.
  for (const u of list) {
    if (u.length !== 1) choice.push(u);
    else if (left[u[0]] > 0) left[u[0]]--;
  }
  const want = left.flatMap((n, r) => Array(Math.max(0, n)).fill(r));
  if (want.length > choice.length) return false;
  // Matching wanted units to choice units, with augmenting paths.
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
  return want.every((_, t) => assign(t, Array(choice.length).fill(false)));
}

// What one unit of r costs p from the neighbour on `side`.
export function unitPrice(state, p, r, side) {
  const trades = [...cardsOf(state, p), ...builtStages(state, p)].filter((x) => x.trade);
  return trades.some((x) => x.trade.kinds.includes(r) && x.trade.sides.includes(side)) ? TRADE_DISCOUNT : TRADE_COST;
}

const price = (state, p, left, right) => sum(RESOURCES.map((r) => left[r] * unitPrice(state, p, r, "left") + right[r] * unitPrice(state, p, r, "right")));
const lessOne = (res, t, r) => res.map((n, k) => Math.max(0, n - t[k] + (k === r ? 1 : 0)));

// Why buying left and right from the neighbours doesn't pay for res, or null.
function purchaseFault(state, p, res, left, right) {
  if (!covers(units(state, leftOf(state, p), true), left)) return "your left neighbour can't make all of that";
  if (!covers(units(state, rightOf(state, p), true), right)) return "your right neighbour can't make all of that";
  const own = units(state, p, false);
  const t = left.map((n, r) => n + right[r]);
  if (!covers(own, lessOne(res, t, -1))) return "you can't make the rest of the cost";
  if (RESOURCES.some((r) => t[r] > 0 && covers(own, lessOne(res, t, r)))) return "buy only what you need";
  return null;
}

// Every minimal way for p to buy what its own production lacks for a cost
// ({ res } or 7 counts): { left, right, coins }, cheapest first. [{ zeros,
// coins: 0 }] when p makes it all; [] when the neighbours can't help.
export function purchases(state, p, cost) {
  const res = Array.isArray(cost) ? cost : cost.res;
  const own = units(state, p, false);
  if (covers(own, res)) return [{ left: zero(), right: zero(), coins: 0 }];
  const saleL = units(state, leftOf(state, p), true);
  const saleR = units(state, rightOf(state, p), true);
  const most = (sale, r) => Math.min(res[r], sale.filter((u) => u.includes(r)).length);
  const maxL = RESOURCES.map((r) => most(saleL, r));
  const maxR = RESOURCES.map((r) => most(saleR, r));
  const out = [];
  const t = zero();
  const splits = (r, a) => {
    if (r === RESOURCES.length) {
      const b = t.map((n, k) => n - a[k]);
      if (covers(saleL, a) && covers(saleR, b)) out.push({ left: a.slice(), right: b, coins: price(state, p, a, b) });
      return;
    }
    for (let k = Math.max(0, t[r] - maxR[r]); k <= Math.min(t[r], maxL[r]); k++) {
      a[r] = k;
      splits(r + 1, a);
    }
    a[r] = 0;
  };
  const totals = (r) => {
    if (r === RESOURCES.length) {
      if (!covers(own, lessOne(res, t, -1))) return;
      if (RESOURCES.some((k) => t[k] > 0 && covers(own, lessOne(res, t, k)))) return;
      splits(0, zero());
      return;
    }
    for (let k = 0; k <= Math.min(res[r], maxL[r] + maxR[r]); k++) {
      t[r] = k;
      totals(r + 1);
    }
    t[r] = 0;
  };
  totals(0);
  return out.sort((x, y) => x.coins - y.coins);
}

// Can p build design `id` now? { ok, why, chain, free, purchases }: purchases
// are the affordable minimal ones; free: the Olympia stage could build it.
export function canBuild(state, p, id) {
  const card = CARDS[id];
  const free = canUseFree(state, p);
  if (!card) return { ok: false, why: "unknown", chain: false, free: false, purchases: [] };
  if (holdsKey(state, p, card.key)) return { ok: false, why: "duplicate", chain: false, free: false, purchases: [] };
  if (chained(state, p, card)) return { ok: true, why: null, chain: true, free, purchases: [] };
  const all = purchases(state, p, card.cost);
  const ok = all.filter((b) => b.coins + card.cost.coins <= state.coins[p]);
  const why = ok.length ? null : all.length ? "coins" : "resources";
  return { ok: ok.length > 0 || free, why: ok.length || free ? null : why, chain: false, free, purchases: ok };
}

// Can p build its next wonder stage now? { ok, why, n, purchases }.
export function canStage(state, p) {
  const n = state.stages[p].length;
  const stage = stagesOf(state, p)[n];
  if (!stage) return { ok: false, why: "built", n, purchases: [] };
  const all = purchases(state, p, stage.cost);
  const ok = all.filter((b) => b.coins <= state.coins[p]);
  return { ok: ok.length > 0, why: ok.length ? null : all.length ? "coins" : "resources", n, purchases: ok };
}

// ---------- scoring ----------

const matches = (card, per) => (Array.isArray(per) ? per.includes(card.color) : card.color === per);
function countPer(state, q, per) {
  if (per === "stage") return state.stages[q].length;
  if (per === "defeat") return state.tokens[q].filter((t) => t === DEFEAT).length;
  return cardsOf(state, q).filter((c) => matches(c, per)).length;
}
// income or score, { per, from, coins | points }, as if the card were p's.
const tally = (state, p, { per, from }, each) => each * sum(from.map((side) => countPer(state, seatOn(state, p, side), per)));

// Points for science symbol counts [star, cog, quill] plus wild symbols, each set to what scores best.
export function sciencePoints(counts, wilds = 0) {
  if (wilds > 0) return Math.max(...[0, 1, 2].map((i) => sciencePoints(counts.with(i, counts[i] + 1), wilds - 1)));
  return sum(counts.map((n) => n * n)) + 7 * Math.min(...counts);
}

// p's score sheet: { military, coins, wonder, civic, commerce, guilds, science, total, copied }.
// copied: the neighbour's guild Olympia B copies (the one scoring best), or -1.
export function score(state, p) {
  const cards = cardsOf(state, p);
  const stages = builtStages(state, p);
  const counts = [0, 0, 0];
  let wilds = 0;
  for (const x of [...cards, ...stages]) {
    if (x.science === "any") wilds++;
    else if (x.science !== undefined) counts[x.science]++;
  }
  const guildPoints = (c) => (c.score ? tally(state, p, c.score, c.score.points) : 0);
  let guilds = sum(cards.filter((c) => c.color === "purple").map(guildPoints));
  let science = sciencePoints(counts, wilds);
  let copied = -1;
  if (stages.some((s) => s.copyGuild)) {
    const theirs = [leftOf(state, p), rightOf(state, p)].flatMap((q) => cardsOf(state, q).filter((c) => c.color === "purple"));
    let best = science;
    for (const g of theirs) {
      const value = guildPoints(g) + sciencePoints(counts, wilds + (g.science === "any" ? 1 : 0));
      if (value > best) [best, copied] = [value, g.id];
    }
    if (copied !== -1) {
      const g = CARDS[copied];
      guilds += guildPoints(g);
      science = sciencePoints(counts, wilds + (g.science === "any" ? 1 : 0));
    }
  }
  const row = {
    military: sum(state.tokens[p]),
    coins: Math.floor(state.coins[p] / 3),
    wonder: sum(stages.map((s) => s.points ?? 0)),
    civic: sum(cards.map((c) => (c.color === "blue" ? c.points : 0))),
    commerce: sum(cards.filter((c) => c.color === "yellow" && c.score).map((c) => tally(state, p, c.score, c.score.points))),
    guilds,
    science,
  };
  return { ...row, total: sum(Object.values(row)), copied };
}

export const shields = (state, p) => sum([...cardsOf(state, p), ...builtStages(state, p)].map((x) => x.shields ?? 0));

// ---------- moves ----------

// The seats that each owe a move at once.
export function movers(state) {
  if (state.winner !== -1 || state.age === 0) return [];
  if (state.phase === "pick") return seatsOf(state);
  if (state.phase === "last") return [state.lastSeat];
  if (state.phase === "dig") return [state.digger];
  return [];
}

const PICKS = ["build", "stage", "discard"];
function kindOf(state, move) {
  if (!isMove(move)) return null;
  const kinds = (state.phase === "dig" ? ["dig"] : PICKS).filter((k) => Object.hasOwn(move, k));
  return kinds.length === 1 ? kinds[0] : null;
}

export function reveals(state, player, move) {
  const kind = kindOf(state, move);
  if (kind === "build" && Number.isInteger(move.build)) return [move.build];
  if (kind === "dig" && Number.isInteger(move.dig) && move.dig >= 0) return [move.dig];
  return [];
}

const card = (players, deck, slot) => {
  const f = deck.face(slot);
  if (f === null) throw new RuleError("show the card you build");
  return CARDS[designOf(players, f)];
};

// A pick checked against the state at the start of the turn: what it does,
// in full. Throws RuleError if it's illegal.
function plan(state, p, move, deck) {
  const kind = kindOf(state, move);
  if (!kind) throw new RuleError(state.phase === "dig" ? "dig: a discarded card, or -1" : "build, stage or discard one card");
  const slot = move[kind];
  if (kind === "dig") {
    if (slot === -1) return { kind, slot };
    if (!state.discard.includes(slot)) throw new RuleError("dig: a card from the discard pile, or -1");
    const c = card(state.players, deck, slot);
    if (holdsKey(state, p, c.key)) throw new RuleError(`you already have ${c.name}`);
    return { kind, slot, id: c.id, how: "dig", coins: 0, left: zero(), right: zero(), bought: { left: 0, right: 0 } };
  }
  if (!Number.isInteger(slot) || !state.hands[p].includes(slot)) throw new RuleError(`${kind}: a card from your hand`);
  const hasBuy = Object.hasOwn(move, "buy") && move.buy !== undefined;
  const hasFree = Object.hasOwn(move, "free") && move.free !== undefined;
  if (hasFree && (move.free !== true || kind !== "build")) throw new RuleError("free: true, only to build a card");
  let left = zero();
  let right = zero();
  if (hasBuy) {
    const b = move.buy;
    if (kind === "discard" || !isMove(b) || !isCounts(b.left) || !isCounts(b.right)) throw new RuleError("buy: { left: [7 counts], right: [7 counts] }, to build");
    [left, right] = [b.left.slice(), b.right.slice()];
  }
  const buying = sum(left) + sum(right) > 0;
  if (kind === "discard") return { kind, slot };
  const pay = (res, coins) => {
    const fault = purchaseFault(state, p, res, left, right);
    if (fault) throw new RuleError(fault);
    const bought = { left: price(state, p, left, zero()), right: price(state, p, zero(), right) };
    if (coins + bought.left + bought.right > state.coins[p]) throw new RuleError("you haven't the coins for that");
    return bought;
  };
  if (kind === "stage") {
    const n = state.stages[p].length;
    const stage = stagesOf(state, p)[n];
    if (!stage) throw new RuleError("your wonder is finished");
    const bought = pay(stage.cost.res, 0);
    return { kind, slot, n, coins: 0, left, right, bought };
  }
  const c = card(state.players, deck, slot);
  if (holdsKey(state, p, c.key)) throw new RuleError(`you already have ${c.name}`);
  const none = { left: 0, right: 0 };
  if (hasFree) {
    if (!canUseFree(state, p)) throw new RuleError("you have no free build this age");
    if (buying) throw new RuleError("a free build buys nothing");
    return { kind, slot, id: c.id, how: "free", coins: 0, left, right, bought: none };
  }
  if (chained(state, p, c)) {
    if (buying) throw new RuleError(`${c.name} is free through a chain: buy nothing`);
    return { kind, slot, id: c.id, how: "chain", coins: 0, left, right, bought: none };
  }
  const bought = pay(c.cost.res, c.cost.coins);
  return { kind, slot, id: c.id, how: "paid", coins: c.cost.coins, left, right, bought };
}

const asMove = (kind, slot, b) => {
  const m = { [kind]: slot };
  if (b && sum(b.left) + sum(b.right) > 0) m.buy = { left: b.left, right: b.right };
  return m;
};

// Every legal move for me now, with each affordable minimal purchase; []
// when I don't owe one. face(slot) is what I know.
export function legalMoves(state, me, face) {
  if (!movers(state).includes(me) || state.picks[me] !== null) return [];
  if (state.phase === "dig") {
    const out = [{ dig: -1 }];
    for (const slot of state.discard) {
      const c = CARDS[designOf(state.players, face(slot))];
      if (c && !holdsKey(state, me, c.key)) out.push({ dig: slot });
    }
    return out;
  }
  const out = [];
  const stage = canStage(state, me);
  for (const slot of state.hands[me]) {
    const id = designOf(state.players, face(slot));
    const can = id === -1 ? null : canBuild(state, me, id);
    if (can?.chain) out.push({ build: slot });
    else if (can) for (const b of can.purchases) out.push(asMove("build", slot, b));
    if (can?.free) out.push({ build: slot, free: true });
    for (const b of stage.purchases) out.push(asMove("stage", slot, b));
    out.push({ discard: slot });
  }
  return out;
}

// The move nobody chooses: a dig with nothing to build. null for a real choice.
export function forcedMove(state, me, face) {
  if (state.phase !== "dig" || state.digger !== me || state.picks[me] !== null) return null;
  const moves = legalMoves(state, me, face);
  return moves.length === 1 ? moves[0] : null;
}

export function makeRules(config = DEFAULT_CONFIG, players = MAX_PLAYERS) {
  const c = normalizeConfig(config);
  const n = players;
  if (!(Number.isInteger(n) && n >= MIN_PLAYERS && n <= MOST_PLAYERS)) throw new Error(`Stonecrown is for ${MIN_PLAYERS} to ${MOST_PLAYERS} players`);
  const deckSize = deckOf(n).length;

  // Shuffles an age's face-up cards (with players + 2 of the guilds in age III) and deals 7 to each seat.
  function deal(state, deck, events) {
    const age = ++state.age;
    let cards = state.piles[age - 1];
    if (age === AGES) {
      const guilds = deck.shuffle(state.pool);
      const k = guildCount(n);
      state.pool = guilds.slice(k);
      cards = [...cards, ...guilds.slice(0, k)];
    }
    const slots = deck.shuffle(cards);
    state.piles[age - 1] = [];
    state.hands = seatsOf(state).map((p) => slots.slice(p * HAND, (p + 1) * HAND));
    state.hands.forEach((hand, p) => hand.forEach((s) => deck.deal(s, p)));
    state.round = 1;
    state.phase = "pick";
    events.push({ type: "age", age });
  }

  // Every pick of this step, planned from the state at the start of the turn,
  // then carried out in seat order; coins received arrive after all payments.
  function resolve(state, seats, deck, events) {
    const plans = seats.map((p) => [p, plan(state, p, state.picks[p], deck)]);
    const gains = [];
    const built = [];
    const gain = (p, coins, why, from) => coins > 0 && gains.push({ type: "gain", p, coins, why, ...(from === undefined ? {} : { from }) });
    for (const [p, x] of plans) {
      if (x.kind !== "dig") state.hands[p] = state.hands[p].filter((s) => s !== x.slot);
      if (x.kind === "discard") {
        state.discard.push(x.slot);
        events.push({ type: "discard", p, slot: x.slot });
        gain(p, DISCARD_COINS, "sale");
        continue;
      }
      if (x.kind === "dig" && x.slot === -1) continue;
      state.coins[p] -= x.coins + x.bought.left + x.bought.right;
      gain(leftOf(state, p), x.bought.left, "trade", p);
      gain(rightOf(state, p), x.bought.right, "trade", p);
      if (x.kind === "stage") {
        state.stages[p].push(x.slot);
        const stage = stagesOf(state, p)[x.n];
        events.push({ type: "stage", p, slot: x.slot, n: x.n, bought: x.bought });
        gain(p, stage.gold ?? 0, "stage");
        if (stage.dig) state.digger = p;
        continue;
      }
      if (x.kind === "dig") state.discard = state.discard.filter((s) => s !== x.slot);
      if (x.how === "free") state.freeAge[p] = state.age;
      state.city[p].push({ slot: x.slot, id: x.id });
      events.push({ type: "build", p, slot: x.slot, id: x.id, how: x.how, coins: x.coins, bought: x.bought });
      built.push([p, CARDS[x.id]]);
    }
    // Income counts the cities after every build of the turn.
    for (const [p, cd] of built) gain(p, (cd.gold ?? 0) + (cd.income ? tally(state, p, cd.income, cd.income.coins) : 0), "card");
    for (const g of gains) state.coins[g.p] += g.coins;
    events.push(...gains);
    for (const p of seats) state.picks[p] = null;
  }

  function war(state, events) {
    const s = seatsOf(state).map((p) => shields(state, p));
    const cmp = (a, b) => Math.sign(a - b);
    const results = seatsOf(state).map((p) => [cmp(s[p], s[leftOf(state, p)]), cmp(s[p], s[rightOf(state, p)])]);
    results.forEach((rs, p) => rs.forEach((r) => r && state.tokens[p].push(r > 0 ? VICTORY[state.age - 1] : DEFEAT)));
    events.push({ type: "war", age: state.age, results });
  }

  function finish(state, events) {
    const scores = seatsOf(state).map((p) => score(state, p));
    const best = Math.max(...scores.map((s) => s.total));
    const top = seatsOf(state).filter((p) => scores[p].total === best);
    const rich = Math.max(...top.map((p) => state.coins[p]));
    const winners = top.filter((p) => state.coins[p] === rich);
    state.winners = winners;
    state.winner = winners.length === 1 ? winners[0] : -2;
    state.phase = "over";
    events.push({ type: "over", winners: winners.slice(), scores });
  }

  // After a step is resolved: the last card, the seventh cards, a dig, then
  // the hands pass or the age ends.
  function next(state, deck, from, events) {
    const lastTurn = state.round === ROUNDS;
    if (from === "pick" && lastTurn) {
      const q = seatsOf(state).find((p) => stageHas(state, p, "playLast") && state.hands[p].length === 1);
      if (q !== undefined) {
        state.phase = "last";
        state.lastSeat = q;
        events.push({ type: "last", p: q });
        return;
      }
    }
    if (from !== "dig" && lastTurn) {
      state.lastSeat = -1;
      state.hands.forEach((hand, p) => hand.forEach((slot) => events.push({ type: "discard", p, slot })));
      state.discard.push(...state.hands.flat());
      state.hands = state.hands.map(() => []);
    }
    if (from !== "dig" && state.digger !== -1 && state.discard.length) {
      state.phase = "dig";
      for (const s of state.discard) deck.pass(s, state.digger);
      events.push({ type: "dig", p: state.digger });
      return;
    }
    state.digger = -1;
    state.phase = "pick";
    if (!lastTurn) {
      const dir = passDir(state.age);
      for (const [p, hand] of state.hands.entries()) for (const s of hand) deck.pass(s, (p + dir + n) % n);
      state.hands = seatsOf(state).map((p) => state.hands[(p - dir + n) % n]);
      state.round++;
      events.push({ type: "pass", dir });
      return;
    }
    war(state, events);
    if (state.age < AGES) deal(state, deck, events);
    else finish(state, events);
  }

  function pickSide(rng) {
    if (c.side !== "random") return c.side;
    return SIDES[Math.floor(rng() * SIDES.length)];
  }

  return {
    deckSize,
    openFaces: deckSize, // in face order, which shows nothing; each age is shuffled when dealt

    newState(first, players, deck, rng) {
      if (players !== n) throw new RuleError(`these rules are for ${n} players`);
      const order = [...WONDERS.keys()];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const wonders = order.slice(0, n).map((w) => ({ w, side: pickSide(rng) }));
      const { ages, guilds } = deckRanges(n);
      const cards = deck.cards.slice(0, deckSize);
      const seats = () => Array.from({ length: n }, () => []);
      return {
        players: n,
        first,
        turn: -1,
        winner: -1,
        winners: [],
        moves: 0,
        side: c.side,
        wonders,
        age: 0,
        round: 0,
        phase: "pick",
        hands: seats(),
        city: seats(),
        stages: seats(),
        coins: Array(n).fill(START_COINS),
        tokens: seats(),
        discard: [],
        picks: Array(n).fill(null),
        freeAge: Array(n).fill(0),
        digger: -1,
        lastSeat: -1,
        // The face-up cards of each age not dealt yet, and the guilds.
        piles: ages.map(([a, b]) => cards.slice(a, b)),
        pool: cards.slice(...guilds),
      };
    },

    reveals,
    movers,

    applyMove(state, player, move, deck) {
      if (state.winner !== -1) throw new RuleError("the game is over");
      if (!movers(state).includes(player)) throw new RuleError("not your move");
      if (state.picks[player] !== null) throw new RuleError("you have chosen already");
      const x = plan(state, player, move, deck);
      const pick = { [x.kind]: x.slot };
      if (x.kind === "build" && x.how === "free") pick.free = true;
      if (x.left && sum(x.left) + sum(x.right) > 0) pick.buy = { left: x.left, right: x.right };
      state.picks[player] = pick;
      state.moves++;
      return [];
    },

    settle(state, deck) {
      const events = [];
      if (state.winner !== -1) return events;
      if (state.age === 0) {
        deal(state, deck, events);
        return events;
      }
      const seats = movers(state);
      if (!seats.length || seats.some((p) => state.picks[p] === null)) return events;
      const from = state.phase;
      resolve(state, seats, deck, events);
      next(state, deck, from, events);
      return events;
    },
  };
}
