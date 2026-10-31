// Hexlands rules for CardMatch (engine/card-match.js): three or four players
// settle an island, the first to `target` points on their own turn winning.
// Every resource and development card is a card of the 120-card deck. The
// resources start face up (openFaces), sorted into the bank, and only the
// development cards are shuffled, into a hidden pile. Cards paid out are
// dealt face up; cards spent are shown (reveals()) and go back to the bank; a
// steal shuffles the victim's hand and deals one card to the thief. Discards
// on a 7, answers to a trade and Monopoly are steps (movers()). See "Hexlands
// in depth" in ARCHITECTURE.md.
import { RuleError } from "../engine/turn-match.js";
import { HEXES, CORNERS, EDGES, DESERT, ANY, RESOURCES, layoutBoard } from "./board.js";

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 4;
export const TARGETS = [10, 8];
export const MOVE_SECONDS = [0, 30, 60, 120];
export const LEVELS = ["easy", "medium", "hard"];
// level is per device; the rules ignore it.
export const DEFAULT_CONFIG = { target: 10, moveSeconds: 0, level: "easy" };
// Shared random draws per match: who starts and the board, then one per roll.
export const DRAWS = 1024;

export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  return {
    target: pick(c.target, TARGETS, DEFAULT_CONFIG.target),
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    level: pick(c.level, LEVELS, DEFAULT_CONFIG.level),
  };
}

export const DECK_SIZE = 120;
export const PER_RESOURCE = 19;
export const FIRST_DEV = 95;
export const DEV_KINDS = ["knight", "vp", "road", "plenty", "monopoly"];
const DEV_COUNTS = [14, 5, 2, 2, 2];
const KIND_OF = DEV_KINDS.flatMap((k, i) => Array(DEV_COUNTS[i]).fill(k));

// A face's resource, 0 to 4, or -1 for a development card (or no face).
export const resourceOf = (f) => (Number.isInteger(f) && f >= 0 && f < FIRST_DEV ? Math.floor(f / PER_RESOURCE) : -1);
export const devKind = (f) => (Number.isInteger(f) && f >= FIRST_DEV && f < DECK_SIZE ? KIND_OF[f - FIRST_DEV] : null);

// By resource: wood, brick, wool, grain, ore.
export const COSTS = {
  road: [1, 1, 0, 0, 0],
  settlement: [1, 1, 1, 1, 0],
  city: [0, 0, 0, 2, 3],
  dev: [0, 0, 1, 1, 1],
};
export const PIECES = { roads: 15, settlements: 5, cities: 4 };
export const HAND_LIMIT = 7;
export const MAX_OFFERS = 3; // trade offers a turn
export const LONGEST_MIN = 5;
export const ARMY_MIN = 3;
// CardMatch shows at most 16 hidden cards a move, so a discard or a Monopoly
// give may also be paid in parts of at least this many, over several steps.
export const MAX_SHOWN = 16;

export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const isIndex = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
const isSlots = (v) => Array.isArray(v) && v.length <= DECK_SIZE && v.every(Number.isInteger) && new Set(v).size === v.length;
const isCounts = (v) => Array.isArray(v) && v.length === RESOURCES.length && v.every((x) => isIndex(x, PER_RESOURCE + 1));
export const seatsOf = (state) => [...Array(state.players).keys()];
// The far end of edge e from corner c.
export const otherEnd = (e, c) => (EDGES[e].a === c ? EDGES[e].b : EDGES[e].a);

// The 5 counts of the known resource faces among slots.
export function counts(slots, face) {
  const out = [0, 0, 0, 0, 0];
  for (const s of slots) {
    const r = resourceOf(face(s));
    if (r >= 0) out[r]++;
  }
  return out;
}

// Slots from `slots` that pay exactly `cost`, or null.
export function payment(slots, face, cost) {
  const need = cost.slice();
  const out = [];
  for (const s of slots) {
    const r = resourceOf(face(s));
    if (r >= 0 && need[r] > 0) {
      need[r]--;
      out.push(s);
    }
  }
  return need.every((x) => x === 0) ? out : null;
}

// The distance rule: a free corner with no building next to it.
export const isFree = (state, c) => !state.buildings[c] && CORNERS[c].corners.every((o) => !state.buildings[o]);
const touchesRoad = (state, p, c) => CORNERS[c].edges.some((e) => state.roads[e] === p);
// A new road joins a building of p's, or a road of p's at a corner without someone else's building.
function joins(state, p, e) {
  return [EDGES[e].a, EDGES[e].b].some((c) => {
    const b = state.buildings[c];
    if (b) return b.p === p;
    return CORNERS[c].edges.some((o) => o !== e && state.roads[o] === p);
  });
}

export const setupSeat = (state) => (state.phase === "setup" ? state.setup.order[state.setup.i] : -1);

// Where p may settle: in setup any corner the distance rule allows, else one on p's roads too.
export function legalCorners(state, p) {
  const free = CORNERS.filter((c) => isFree(state, c.id)).map((c) => c.id);
  if (state.phase === "setup") return setupSeat(state) === p && state.setup.corner === -1 ? free : [];
  if (!state.pieces[p].settlements) return [];
  return free.filter((c) => touchesRoad(state, p, c));
}

// Where p may build a road: in setup next to the settlement just placed.
export function legalEdges(state, p) {
  if (state.phase === "setup") {
    const c = state.setup.corner;
    return setupSeat(state) === p && c !== -1 ? CORNERS[c].edges.filter((e) => state.roads[e] === -1) : [];
  }
  if (!state.pieces[p].roads) return [];
  return EDGES.filter((e) => state.roads[e.id] === -1 && joins(state, p, e.id)).map((e) => e.id);
}

export function legalCities(state, p) {
  if (!state.pieces[p].cities) return [];
  return CORNERS.filter((c) => state.buildings[c.id]?.p === p && !state.buildings[c.id].city).map((c) => c.id);
}

export const robberHexes = (state) => HEXES.map((h) => h.id).filter((h) => h !== state.robber);

// Who p can steal from on hex: another seat with a building there and a card.
export function victims(state, hex, p) {
  return seatsOf(state).filter((q) => q !== p && state.hands[q].length > 0 && HEXES[hex].corners.some((c) => state.buildings[c]?.p === q));
}

// How many cards of r p gives the bank for one: 4, 3 at a 3:1 harbour, 2 at r's own.
export function tradeRate(state, p, r) {
  let rate = 4;
  for (const { edge, kind } of state.board.harbours) {
    if (![EDGES[edge].a, EDGES[edge].b].some((c) => state.buildings[c]?.p === p)) continue;
    if (kind === r) return 2;
    if (kind === ANY) rate = 3;
  }
  return rate;
}

// The longest trail of p's roads, which can't pass through someone else's building.
export function roadLength(state, p) {
  const used = new Set();
  let best = 0;
  const walk = (c, len) => {
    best = Math.max(best, len);
    if (len > 0 && state.buildings[c] && state.buildings[c].p !== p) return;
    for (const e of CORNERS[c].edges) {
      if (state.roads[e] !== p || used.has(e)) continue;
      used.add(e);
      walk(otherEnd(e, c), len + 1);
      used.delete(e);
    }
  };
  for (const c of CORNERS) if (touchesRoad(state, p, c.id)) walk(c.id, 0);
  return best;
}

// Public points: buildings, longest road, largest army and victory point cards shown.
export function points(state, p) {
  let n = 0;
  for (const b of state.buildings) if (b?.p === p) n += b.city ? 2 : 1;
  if (state.longest.p === p) n += 2;
  if (state.army.p === p) n += 2;
  return n + state.shown[p].filter((f) => devKind(f) === "vp").length;
}

const owedOnSeven = (state, p) => (state.hands[p].length > HAND_LIMIT ? Math.floor(state.hands[p].length / 2) : 0);
// The cards p must give up on a 7 (while discarding, the cards it still owes).
export const discardCount = (state, p) => (state.phase === "discard" ? state.discards[p] : owedOnSeven(state, p));
// A discard size that fits any hand: all it owes, or a first part of MAX_SHOWN.
export const discardPart = (state, p) => Math.min(discardCount(state, p), MAX_SHOWN);

// The development cards p may play now, before or after rolling (victory points are shown with claim instead).
export function playable(state, p, face) {
  if (state.devPlayed || state.turn !== p || (state.phase !== "main" && state.phase !== "roll") || state.freeRoads) return [];
  return state.devs[p].filter((s) => {
    const kind = devKind(face(s));
    return kind && kind !== "vp" && !state.bought.includes(s);
  });
}

// The seats that each owe a move at once.
export function movers(state) {
  if (state.winner !== -1) return [];
  if (state.phase === "discard") return seatsOf(state).filter((p) => state.discards[p] > 0);
  if (state.phase === "answer") return seatsOf(state).filter((p) => state.trade.answers[p] === null);
  if (state.phase === "monopoly") return seatsOf(state).filter((p) => state.monopoly.owes[p]);
  return [];
}

// The move kinds each phase takes; a move is the first of these keys it has.
const KINDS = {
  setup: ["settle", "road"],
  roll: ["roll", "play", "road", "claim"],
  discard: ["discard"],
  robber: ["robber"],
  main: ["road", "settle", "city", "buy", "play", "bank", "offer", "claim", "end"],
  answer: ["accept", "decline"],
  partner: ["partner"],
  monopoly: ["give"],
};
function kindOf(state, move) {
  if (!move || typeof move !== "object" || Array.isArray(move)) return null;
  return KINDS[state.phase]?.find((k) => Object.hasOwn(move, k)) ?? null;
}

export function reveals(state, player, move) {
  const kind = kindOf(state, move);
  const list = (v) => (Array.isArray(v) ? v.slice() : []);
  if (state.phase === "main" && ["road", "settle", "city", "buy"].includes(kind)) return list(move.pay);
  if (kind === "play") return Number.isInteger(move.play) ? [move.play] : [];
  if (["discard", "bank", "offer", "claim", "accept", "give"].includes(kind)) return list(move[kind]);
  return [];
}

export const needsRandom = (state, move) => state.phase === "roll" && kindOf(state, move) === "roll" && move.roll === true;

// Every kind of legal move for me now, one sensible payment each; [] when it isn't my move.
export function legalMoves(state, me, face) {
  if (state.winner !== -1) return [];
  const step = movers(state);
  const hand = state.hands[me];
  if (step.length) {
    if (!step.includes(me)) return [];
    if (state.phase === "discard") return [{ discard: hand.slice(0, discardPart(state, me)) }];
    if (state.phase === "monopoly") return [forcedMove(state, me, face)].filter(Boolean);
    const pay = payment(hand, face, state.trade.want);
    return pay ? [{ accept: pay }, { decline: true }] : [{ decline: true }];
  }
  if (state.turn !== me) return [];
  const claim = claimable(state, me, face);
  switch (state.phase) {
    case "setup":
      return state.setup.corner === -1 ? legalCorners(state, me).map((c) => ({ settle: c })) : legalEdges(state, me).map((e) => ({ road: e }));
    case "roll":
      if (state.freeRoads) return [...legalEdges(state, me).map((e) => ({ road: e })), ...claim];
      return [{ roll: true }, ...devPlays(state, me, face), ...claim];
    case "robber":
      return robberHexes(state).flatMap((hex) => {
        const vs = victims(state, hex, me);
        return vs.length ? vs.map((steal) => ({ robber: hex, steal })) : [{ robber: hex, steal: -1 }];
      });
    case "partner":
      return [...seatsOf(state).filter((q) => Array.isArray(state.trade.answers[q])).map((q) => ({ partner: q })), { partner: -1 }];
    case "main":
      if (state.freeRoads) return [...legalEdges(state, me).map((e) => ({ road: e })), ...claim];
      return [...builds(state, me, face), ...devPlays(state, me, face), ...trades(state, me, face), ...claim, { end: true }];
  }
  return [];
}

function builds(state, me, face) {
  const out = [];
  const hand = state.hands[me];
  const pay = (cost) => payment(hand, face, cost);
  const road = pay(COSTS.road);
  if (road) for (const e of legalEdges(state, me)) out.push({ road: e, pay: road });
  const settlement = pay(COSTS.settlement);
  if (settlement) for (const c of legalCorners(state, me)) out.push({ settle: c, pay: settlement });
  const city = pay(COSTS.city);
  if (city) for (const c of legalCities(state, me)) out.push({ city: c, pay: city });
  const dev = pay(COSTS.dev);
  if (dev && state.devPile.length) out.push({ buy: true, pay: dev });
  return out;
}

function devPlays(state, me, face) {
  const out = [];
  const seen = new Set();
  for (const slot of playable(state, me, face)) {
    const kind = devKind(face(slot));
    if (seen.has(kind)) continue;
    seen.add(kind);
    if (kind === "knight") out.push({ play: slot });
    if (kind === "road" && legalEdges(state, me).length) out.push({ play: slot });
    if (kind === "monopoly") for (const r of RESOURCES) out.push({ play: slot, resource: r });
    if (kind === "plenty") {
      for (const a of RESOURCES) for (const b of RESOURCES) if (a <= b && state.bank[a].length >= (a === b ? 2 : 1) && state.bank[b].length) out.push({ play: slot, take: [a, b] });
    }
  }
  return out;
}

function trades(state, me, face) {
  const out = [];
  const hand = state.hands[me];
  const offers = state.offers < MAX_OFFERS;
  for (const r of RESOURCES) {
    const mine = hand.filter((s) => resourceOf(face(s)) === r);
    if (!mine.length) continue;
    const rate = tradeRate(state, me, r);
    for (const take of RESOURCES) {
      if (take === r) continue;
      if (mine.length >= rate && state.bank[take].length) out.push({ bank: mine.slice(0, rate), take });
      if (offers) out.push({ offer: [mine[0]], want: RESOURCES.map((x) => (x === take ? 1 : 0)) });
    }
  }
  return out;
}

function claimable(state, me, face) {
  const need = state.target - points(state, me);
  const vps = state.devs[me].filter((s) => devKind(face(s)) === "vp");
  return need > 0 && vps.length >= need ? [{ claim: vps.slice(0, need) }] : [];
}

// The move nobody chooses: Monopoly's give (every card of the resource, more
// than MAX_SHOWN in parts), or declining an offer you can't pay. null for a real choice.
export function forcedMove(state, me, face) {
  if (!movers(state).includes(me)) return null;
  const hand = state.hands[me];
  if (state.phase === "monopoly") {
    if (hand.some((s) => face(s) === null)) return null;
    const give = hand.filter((s) => resourceOf(face(s)) === state.monopoly.resource);
    return give.length > MAX_SHOWN ? { give: give.slice(0, MAX_SHOWN), more: true } : { give };
  }
  if (state.phase === "answer" && !payment(hand, face, state.trade.want)) return { decline: true };
  return null;
}

export function makeRules(config = DEFAULT_CONFIG, players = 4) {
  const c = normalizeConfig(config);
  const n = players;

  // A shown card's face; every card a move names is shown, so null means a bad move.
  function shownFace(deck, s) {
    const f = deck.face(s);
    if (f === null) throw new RuleError("show the cards you name");
    return f;
  }

  function checkPay(state, p, slots, cost, what, deck) {
    const hand = new Set(state.hands[p]);
    if (!isSlots(slots) || slots.length !== sum(cost) || !slots.every((s) => hand.has(s))) throw new RuleError(`pay for ${what} with ${sum(cost)} cards from your hand`);
    const got = counts(slots, (s) => shownFace(deck, s));
    if (got.some((x, r) => x !== cost[r])) throw new RuleError(`those cards don't pay for ${what}`);
    return slots;
  }

  function checkHand(state, p, slots, what) {
    const hand = new Set(state.hands[p]);
    if (!isSlots(slots) || !slots.every((s) => hand.has(s))) throw new RuleError(`${what}: name distinct cards from your hand`);
  }

  function spend(state, p, slots, deck) {
    const set = new Set(slots);
    state.hands[p] = state.hands[p].filter((s) => !set.has(s));
    for (const s of slots) state.bank[resourceOf(shownFace(deck, s))].push(s);
  }

  function payOut(state, p, r, deck) {
    const s = state.bank[r].pop();
    deck.deal(s, p);
    state.hands[p].push(s);
    return s;
  }

  function updateLongest(state, events) {
    const lens = seatsOf(state).map((p) => roadLength(state, p));
    const holder = state.longest.p;
    const max = Math.max(...lens);
    let next = -1;
    // The holder keeps it on a tie; a tie for a lost road leaves it with nobody.
    if (holder !== -1 && lens[holder] >= LONGEST_MIN && lens[holder] === max) next = holder;
    else if (max >= LONGEST_MIN && lens.filter((l) => l === max).length === 1) next = lens.indexOf(max);
    state.longest = { p: next, size: next === -1 ? 0 : lens[next] };
    if (next !== holder) events.push({ type: "longest", ...state.longest });
  }

  function updateArmy(state, p, events) {
    const k = state.knights[p];
    if (state.army.p === p) state.army.size = k;
    else if (k >= ARMY_MIN && k > state.army.size) {
      state.army = { p, size: k };
      events.push({ type: "army", ...state.army });
    }
  }

  function checkWin(state, events) {
    const p = state.turn;
    if (points(state, p) < state.target) return;
    state.winner = p;
    state.phase = "over";
    events.push({ type: "over", winner: p, points: seatsOf(state).map((q) => points(state, q)) });
  }

  function setupSettle(state, p, move, deck, events) {
    const corner = move.settle;
    if (state.setup.corner !== -1) throw new RuleError("place a road next to your settlement");
    if (!isIndex(corner, CORNERS.length) || !isFree(state, corner)) throw new RuleError("settle on a free corner with no building next to it");
    state.buildings[corner] = { p, city: false };
    state.pieces[p].settlements--;
    state.setup.corner = corner;
    events.push({ type: "build", p, kind: "settlement", at: corner, free: true, pay: [] });
    if (state.setup.i < n) return;
    // The second settlement collects a card for each hex it touches.
    const slots = [];
    for (const h of CORNERS[corner].hexes) {
      const r = state.board.terrain[h];
      if (r !== DESERT && state.bank[r].length) slots.push(payOut(state, p, r, deck));
    }
    events.push({ type: "gain", p, slots });
  }

  function setupRoad(state, p, move, events) {
    const corner = state.setup.corner;
    if (corner === -1) throw new RuleError("place a settlement first");
    if (!legalEdges(state, p).includes(move.road)) throw new RuleError("build your road next to the settlement you just placed");
    state.roads[move.road] = p;
    state.pieces[p].roads--;
    events.push({ type: "build", p, kind: "road", at: move.road, free: true, pay: [] });
    state.setup.corner = -1;
    state.setup.i++;
    if (state.setup.i < state.setup.order.length) {
      state.turn = state.setup.order[state.setup.i];
      return;
    }
    state.phase = "roll";
    state.turn = state.first;
    events.push({ type: "turn", p: state.turn });
  }

  function roll(state, p, move, deck, rng, events) {
    if (move.roll !== true) throw new RuleError("roll: true");
    const dice = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
    state.dice = dice;
    state.rolled = true;
    events.push({ type: "roll", p, dice: dice.slice() });
    const total = dice[0] + dice[1];
    if (total === 7) {
      state.discards = seatsOf(state).map((q) => owedOnSeven(state, q));
      state.phase = state.discards.some((x) => x > 0) ? "discard" : "robber";
      return;
    }
    produce(state, total, deck, events);
    state.phase = "main";
  }

  // Each settlement 1 and city 2 of its hexes' terrain; a resource the bank
  // can't pay in full goes to nobody (short), unless only one seat wanted it:
  // that seat gets what's left (partial).
  function produce(state, total, deck, events) {
    const want = seatsOf(state).map(() => [0, 0, 0, 0, 0]);
    for (const h of HEXES) {
      if (state.board.numbers[h.id] !== total || state.robber === h.id) continue;
      const r = state.board.terrain[h.id];
      for (const corner of h.corners) {
        const b = state.buildings[corner];
        if (b) want[b.p][r] += b.city ? 2 : 1;
      }
    }
    const gains = seatsOf(state).map(() => []);
    const short = [];
    const partial = [];
    for (const r of RESOURCES) {
      const takers = seatsOf(state).filter((q) => want[q][r] > 0);
      if (!takers.length) continue;
      const left = state.bank[r].length;
      if (sum(takers.map((q) => want[q][r])) > left) {
        if (takers.length > 1 || !left) {
          short.push(r);
          continue;
        }
        partial.push(r);
        want[takers[0]][r] = left;
      }
      for (const q of takers) for (let k = 0; k < want[q][r]; k++) gains[q].push(payOut(state, q, r, deck));
    }
    events.push({ type: "produce", roll: total, gains, short, partial });
  }

  function discard(state, p, move, deck, events) {
    const slots = move.discard;
    checkHand(state, p, slots, "discard");
    const owe = state.discards[p];
    if (slots.length !== owe && (owe <= MAX_SHOWN || slots.length < MAX_SHOWN || slots.length > owe)) throw new RuleError(`discard ${owe} cards${owe > MAX_SHOWN ? `, or at least ${MAX_SHOWN} of them now and the rest next` : ""}`);
    slots.forEach((s) => shownFace(deck, s));
    spend(state, p, slots, deck);
    state.discards[p] -= slots.length;
    events.push({ type: "discard", p, slots: slots.slice() });
    if (!movers(state).length) state.phase = "robber";
  }

  function robber(state, p, move, deck, events) {
    const { robber: hex, steal } = move;
    if (!isIndex(hex, HEXES.length) || hex === state.robber) throw new RuleError("move the robber to another hex");
    const vs = victims(state, hex, p);
    if (vs.length ? !vs.includes(steal) : steal !== -1) throw new RuleError(vs.length ? "steal from a player with a building on that hex and a card" : "nobody to steal from there: steal -1");
    state.robber = hex;
    events.push({ type: "robber", p, hex });
    if (steal !== -1) {
      // Nobody chooses the card: the victim's hand is shuffled by everyone, and the thief gets the first.
      const [slot, ...rest] = deck.shuffle(state.hands[steal]);
      deck.deal(slot, p);
      for (const s of rest) deck.deal(s, steal);
      state.hands[p].push(slot);
      state.hands[steal] = rest;
      events.push({ type: "steal", thief: p, victim: steal, slot });
    }
    state.phase = state.rolled ? "main" : "roll";
  }

  function road(state, p, move, deck, events) {
    const e = move.road;
    if (!isIndex(e, EDGES.length) || !legalEdges(state, p).includes(e)) throw new RuleError("build a road on a free edge joined to your roads or buildings");
    const free = state.freeRoads > 0;
    if (free && move.pay !== undefined && !(Array.isArray(move.pay) && !move.pay.length)) throw new RuleError("this road is free");
    const pay = free ? [] : checkPay(state, p, move.pay, COSTS.road, "a road", deck);
    spend(state, p, pay, deck);
    state.roads[e] = p;
    state.pieces[p].roads--;
    events.push({ type: "build", p, kind: "road", at: e, free, pay: pay.slice() });
    if (free && --state.freeRoads && !legalEdges(state, p).length) state.freeRoads = 0;
    updateLongest(state, events);
  }

  function settle(state, p, move, deck, events) {
    const corner = move.settle;
    if (!isIndex(corner, CORNERS.length) || !legalCorners(state, p).includes(corner)) throw new RuleError("settle on a free corner on your road, with no building next to it");
    const pay = checkPay(state, p, move.pay, COSTS.settlement, "a settlement", deck);
    spend(state, p, pay, deck);
    state.buildings[corner] = { p, city: false };
    state.pieces[p].settlements--;
    events.push({ type: "build", p, kind: "settlement", at: corner, free: false, pay: pay.slice() });
    updateLongest(state, events); // it may cut someone's road
  }

  function city(state, p, move, deck, events) {
    const corner = move.city;
    if (!isIndex(corner, CORNERS.length) || !legalCities(state, p).includes(corner)) throw new RuleError("build a city on one of your settlements");
    const pay = checkPay(state, p, move.pay, COSTS.city, "a city", deck);
    spend(state, p, pay, deck);
    state.buildings[corner].city = true;
    state.pieces[p].cities--;
    state.pieces[p].settlements++;
    events.push({ type: "build", p, kind: "city", at: corner, free: false, pay: pay.slice() });
  }

  function buy(state, p, move, deck, events) {
    if (move.buy !== true) throw new RuleError("buy: true");
    if (!state.devPile.length) throw new RuleError("no development cards left");
    const pay = checkPay(state, p, move.pay, COSTS.dev, "a development card", deck);
    spend(state, p, pay, deck);
    const slot = state.devPile.shift();
    deck.deal(slot, p);
    state.devs[p].push(slot);
    state.bought.push(slot);
    events.push({ type: "buy", p, slot, pay: pay.slice() });
  }

  function play(state, p, move, deck, events) {
    const slot = move.play;
    if (!state.devs[p].includes(slot)) throw new RuleError("play a development card from your hand");
    if (state.devPlayed) throw new RuleError("one development card a turn");
    if (state.bought.includes(slot)) throw new RuleError("a card bought this turn can be played from the next");
    const face = shownFace(deck, slot);
    const kind = devKind(face);
    if (kind === "vp") throw new RuleError("victory point cards are shown with claim, to win");
    const take = move.take;
    if (kind === "road" && !legalEdges(state, p).length) throw new RuleError("nowhere to build a road");
    if (kind === "plenty") {
      if (!Array.isArray(take) || take.length !== 2 || !take.every((r) => isIndex(r, RESOURCES.length))) throw new RuleError("take: two resources");
      if (RESOURCES.some((r) => take.filter((x) => x === r).length > state.bank[r].length)) throw new RuleError("the bank hasn't got those");
    }
    if (kind === "monopoly" && !isIndex(move.resource, RESOURCES.length)) throw new RuleError("name a resource");
    state.devs[p] = state.devs[p].filter((s) => s !== slot);
    state.shown[p].push(face);
    state.devPlayed = true;
    events.push({ type: "play", p, kind, slot });
    if (kind === "knight") {
      state.knights[p]++;
      updateArmy(state, p, events);
      state.phase = "robber";
    } else if (kind === "road") {
      state.freeRoads = Math.min(2, state.pieces[p].roads);
    } else if (kind === "plenty") {
      events.push({ type: "plenty", p, slots: take.map((r) => payOut(state, p, r, deck)) });
    } else {
      // Seats without a card have nothing to give.
      state.monopoly = { p, resource: move.resource, given: seatsOf(state).map(() => []), owes: seatsOf(state).map((q) => q !== p && state.hands[q].length > 0) };
      state.phase = "monopoly";
      if (!movers(state).length) endMonopoly(state, events);
    }
  }

  function give(state, p, move, deck, events) {
    const { resource, p: to } = state.monopoly;
    const slots = move.give;
    checkHand(state, p, slots, "give");
    const last = move.more === undefined;
    if (!last && (move.more !== true || slots.length < MAX_SHOWN)) throw new RuleError(`more: true, after at least ${MAX_SHOWN} cards`);
    if (!slots.every((s) => resourceOf(shownFace(deck, s)) === resource)) throw new RuleError("give only cards of the resource named");
    const set = new Set(slots);
    // The rest of the hand is hidden during play: this throws in the audit.
    if (last && state.hands[p].some((s) => !set.has(s) && resourceOf(deck.face(s)) === resource)) throw new RuleError("kept back a card of the resource named by Monopoly");
    state.hands[p] = state.hands[p].filter((s) => !set.has(s));
    for (const s of slots) {
      deck.deal(s, to);
      state.hands[to].push(s);
    }
    state.monopoly.given[p].push(...slots);
    state.monopoly.owes[p] = !last;
    if (!movers(state).length) endMonopoly(state, events);
  }

  function endMonopoly(state, events) {
    const { p, resource, given } = state.monopoly;
    events.push({ type: "monopoly", p, resource, given: given.map((g) => g.slice()) });
    state.monopoly = null;
    state.phase = state.rolled ? "main" : "roll";
  }

  function bank(state, p, move, deck, events) {
    const { bank: slots, take } = move;
    checkHand(state, p, slots, "trade with the bank");
    if (!isIndex(take, RESOURCES.length)) throw new RuleError("take: a resource");
    const r = slots.length ? resourceOf(shownFace(deck, slots[0])) : -1;
    if (r === -1 || !slots.every((s) => resourceOf(shownFace(deck, s)) === r)) throw new RuleError("give the bank cards of one resource");
    if (slots.length !== tradeRate(state, p, r)) throw new RuleError(`the bank takes ${tradeRate(state, p, r)} of those for one`);
    if (r === take) throw new RuleError("take a different resource");
    if (!state.bank[take].length) throw new RuleError("the bank has none of those");
    spend(state, p, slots, deck);
    const got = payOut(state, p, take, deck);
    events.push({ type: "bank", p, gave: slots.slice(), got });
  }

  function offer(state, p, move, deck, events) {
    const { offer: give, want } = move;
    if (state.offers >= MAX_OFFERS) throw new RuleError(`at most ${MAX_OFFERS} trade offers a turn`);
    checkHand(state, p, give, "offer");
    if (!give.length) throw new RuleError("offer at least one card");
    if (!isCounts(want) || !sum(want)) throw new RuleError("want: 5 counts, at least one card");
    const has = counts(give, (s) => shownFace(deck, s));
    if (RESOURCES.some((r) => has[r] && want[r])) throw new RuleError("don't ask for what you give");
    const asked = sum(want);
    // A seat without enough cards can't accept.
    state.trade = { from: p, give: give.slice(), want: want.slice(), answers: seatsOf(state).map((q) => (q === p || state.hands[q].length < asked ? false : null)) };
    state.offers++;
    state.phase = "answer";
    events.push({ type: "offer", p, give: give.slice(), want: want.slice() });
    if (!movers(state).length) endAnswers(state, events);
  }

  function accept(state, p, move, deck, events) {
    const slots = move.accept;
    checkHand(state, p, slots, "accept");
    const got = counts(slots, (s) => shownFace(deck, s));
    if (slots.length !== sum(state.trade.want) || got.some((x, r) => x !== state.trade.want[r])) throw new RuleError("accept with exactly the cards wanted");
    state.trade.answers[p] = slots.slice();
    events.push({ type: "answer", p, accept: slots.slice() });
    if (!movers(state).length) endAnswers(state, events);
  }

  function decline(state, p, move, events) {
    if (move.decline !== true) throw new RuleError("decline: true");
    state.trade.answers[p] = false;
    events.push({ type: "answer", p, accept: false });
    if (!movers(state).length) endAnswers(state, events);
  }

  function endAnswers(state, events) {
    if (state.trade.answers.some(Array.isArray)) {
      state.phase = "partner";
      return;
    }
    events.push({ type: "nodeal", p: state.trade.from });
    state.trade = null;
    state.phase = "main";
  }

  function partner(state, p, move, deck, events) {
    const q = move.partner;
    const t = state.trade;
    if (q !== -1 && !(isIndex(q, n) && Array.isArray(t.answers[q]))) throw new RuleError("trade with a player who accepted, or -1 to call it off");
    if (q === -1) {
      events.push({ type: "nodeal", p });
    } else {
      const got = t.answers[q];
      const gave = new Set(t.give);
      const taken = new Set(got);
      state.hands[p] = state.hands[p].filter((s) => !gave.has(s));
      state.hands[q] = state.hands[q].filter((s) => !taken.has(s));
      for (const s of t.give) deck.deal(s, q);
      for (const s of got) deck.deal(s, p);
      state.hands[q].push(...t.give);
      state.hands[p].push(...got);
      events.push({ type: "trade", from: p, to: q, gave: t.give.slice(), got: got.slice() });
    }
    state.trade = null;
    state.phase = "main";
  }

  function claim(state, p, move, deck, events) {
    const slots = move.claim;
    const devs = new Set(state.devs[p]);
    if (!isSlots(slots) || !slots.length || !slots.every((s) => devs.has(s))) throw new RuleError("claim: victory point cards from your hand");
    if (!slots.every((s) => devKind(shownFace(deck, s)) === "vp")) throw new RuleError("only victory point cards can be claimed");
    const need = state.target - points(state, p);
    if (slots.length < need) throw new RuleError(`victory point cards are shown to win: ${need} needed`);
    const set = new Set(slots);
    state.devs[p] = state.devs[p].filter((s) => !set.has(s));
    state.bought = state.bought.filter((s) => !set.has(s));
    state.shown[p].push(...slots.map((s) => deck.face(s)));
    events.push({ type: "claim", p, slots: slots.slice() });
  }

  function end(state, p, move, events) {
    if (move.end !== true) throw new RuleError("end: true");
    state.turn = (p + 1) % n;
    state.rolled = false;
    state.devPlayed = false;
    state.bought = [];
    state.offers = 0;
    state.phase = "roll";
    events.push({ type: "turn", p: state.turn });
  }

  return {
    deckSize: DECK_SIZE,
    openFaces: FIRST_DEV, // the resources: the bank is face up
    draws: DRAWS,

    newState(first, players, deck, rng) {
      if (players !== n) throw new RuleError(`these rules are for ${n} players`);
      const board = layoutBoard(rng);
      const bank = RESOURCES.map(() => []);
      for (const s of deck.cards.slice(0, FIRST_DEV)) bank[resourceOf(deck.face(s))].push(s);
      const order = seatsOf({ players: n }).map((k) => (first + k) % n);
      const seats = () => Array.from({ length: n }, () => []);
      return {
        players: n,
        first,
        turn: first,
        winner: -1,
        moves: 0,
        target: c.target,
        board,
        robber: board.desert,
        phase: "setup",
        setup: { order: [...order, ...order.slice().reverse()], i: 0, corner: -1 },
        buildings: Array(CORNERS.length).fill(null),
        roads: Array(EDGES.length).fill(-1),
        pieces: Array.from({ length: n }, () => ({ ...PIECES })),
        hands: seats(),
        devs: seats(),
        bought: [],
        offers: 0,
        devPlayed: false,
        rolled: false,
        knights: Array(n).fill(0),
        shown: seats(),
        bank,
        devPile: deck.cards.slice(FIRST_DEV),
        dice: null,
        discards: Array(n).fill(0),
        trade: null,
        monopoly: null,
        freeRoads: 0,
        longest: { p: -1, size: 0 },
        army: { p: -1, size: 0 },
      };
    },

    reveals,
    needsRandom,
    movers,

    applyMove(state, player, move, deck, rng) {
      if (state.winner !== -1) throw new RuleError("the game is over");
      const step = movers(state);
      if (step.length ? !step.includes(player) : state.turn !== player) throw new RuleError("not your turn");
      const kind = kindOf(state, move);
      if (!kind) throw new RuleError(`that move doesn't fit now (${state.phase})`);
      if (state.freeRoads && kind !== "road" && kind !== "claim") throw new RuleError("build your free roads first");
      if (state.phase === "roll" && kind === "road" && !state.freeRoads) throw new RuleError("roll before you build");
      const events = [];
      if (state.phase === "setup") {
        if (kind === "settle") setupSettle(state, player, move, deck, events);
        else setupRoad(state, player, move, events);
      } else {
        const p = player;
        ({
          roll: () => roll(state, p, move, deck, rng, events),
          discard: () => discard(state, p, move, deck, events),
          robber: () => robber(state, p, move, deck, events),
          road: () => road(state, p, move, deck, events),
          settle: () => settle(state, p, move, deck, events),
          city: () => city(state, p, move, deck, events),
          buy: () => buy(state, p, move, deck, events),
          play: () => play(state, p, move, deck, events),
          bank: () => bank(state, p, move, deck, events),
          offer: () => offer(state, p, move, deck, events),
          claim: () => claim(state, p, move, deck, events),
          end: () => end(state, p, move, events),
          accept: () => accept(state, p, move, deck, events),
          decline: () => decline(state, p, move, events),
          partner: () => partner(state, p, move, deck, events),
          give: () => give(state, p, move, deck, events),
        })[kind]();
        checkWin(state, events);
      }
      state.moves++;
      return events;
    },
  };
}
