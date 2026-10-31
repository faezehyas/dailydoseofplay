import test from "node:test";
import assert from "node:assert/strict";
import { KnownDeck, settleAll } from "../../test/fixtures/known-deck.js";
import { rngFromSeed } from "../engine/rng.js";
import { HEXES, CORNERS, EDGES, WOOD, BRICK, WOOL, GRAIN, ORE, DESERT, ANY } from "./board.js";
import {
  makeRules,
  normalizeConfig,
  DEFAULT_CONFIG,
  COSTS,
  resourceOf,
  devKind,
  counts,
  payment,
  legalCorners,
  legalEdges,
  legalCities,
  robberHexes,
  victims,
  tradeRate,
  points,
  discardCount,
  roadLength,
  legalMoves,
  forcedMove,
  movers,
} from "./rules.js";

const throwsRule = (f, re) => assert.throws(f, (err) => err.name === "RuleError" && (!re || re.test(err.message)));
const has = (k) => (m) => Object.hasOwn(m, k);
// Dice that roll a and b.
const dice = (a, b) => {
  const vs = [(a - 0.5) / 6, (b - 0.5) / 6];
  return () => vs.shift();
};

// A game on a deck in face order, dealt and sorted, in setup.
function game({ players = 3, first = 0, config = {}, seed = "deck" } = {}) {
  const deck = new KnownDeck([...Array(120).keys()], seed);
  const rules = makeRules(config, players);
  const st = rules.newState(first, players, deck, rngFromSeed(seed));
  settleAll(rules, st, deck);
  const face = (s) => deck.slots[s].face;
  // A move as CardMatch makes it: the cards it shows open first.
  const move = (p, m, rng) => {
    for (const id of rules.reveals(st, p, m)) deck.slots[id].open = true;
    const events = rules.applyMove(st, p, m, deck, rng);
    settleAll(rules, st, deck);
    return events;
  };
  const give = (p, ...rs) =>
    rs.map((r) => {
      const s = st.bank[r].pop();
      deck.deal(s, p);
      st.hands[p].push(s);
      return s;
    });
  const cards = (p, r) => st.hands[p].filter((s) => resourceOf(face(s)) === r);
  // A development card of this kind from the pile to p, bought on an earlier turn.
  const dev = (p, kind) => {
    const s = st.devPile.find((x) => devKind(face(x)) === kind);
    st.devPile.splice(st.devPile.indexOf(s), 1);
    deck.deal(s, p);
    st.devs[p].push(s);
    return s;
  };
  // p's whole hand hidden again, as after a steal.
  const hide = (p) => {
    const fresh = deck.shuffle(st.hands[p]);
    for (const s of fresh) deck.deal(s, p);
    st.hands[p] = fresh;
  };
  return { st, deck, rules, move, face, give, cards, dev, hide };
}

// Past setup: p's turn, rolled, in the main phase.
function main(g, p = 0) {
  Object.assign(g.st, { phase: "main", turn: p, rolled: true });
  g.st.setup.i = g.st.setup.order.length;
  return g;
}
const place = (g, p, corner, city = false) => {
  g.st.buildings[corner] = { p, city };
  g.st.pieces[p][city ? "cities" : "settlements"]--;
};
const lay = (g, p, edges) =>
  edges.forEach((e) => {
    g.st.roads[e] = p;
    g.st.pieces[p].roads--;
  });
const edgeBetween = (a, b) => CORNERS[a].edges.find((e) => EDGES[e].a === b || EDGES[e].b === b);

// A simple path of k edges from corner `from`, avoiding `avoid` corners: { corners, edges }.
function path(from, k, avoid = new Set()) {
  const corners = [from];
  const walk = () => {
    if (corners.length === k + 1) return true;
    for (const c of CORNERS[corners.at(-1)].corners) {
      if (corners.includes(c) || avoid.has(c)) continue;
      corners.push(c);
      if (walk()) return true;
      corners.pop();
    }
    return false;
  };
  assert.ok(walk(), `no path of ${k} from ${from}`);
  return { corners, edges: corners.slice(1).map((c, i) => edgeBetween(corners[i], c)) };
}

test("the deal: every card opened, the resources sorted into the bank, the development cards hidden again", () => {
  const g = game({ players: 4, first: 2 });
  const { st, deck } = g;
  assert.deepEqual(st.bank.map((b) => b.length), [19, 19, 19, 19, 19]);
  st.bank.forEach((b, r) => b.forEach((s) => assert.equal(resourceOf(g.face(s)), r)));
  assert.equal(st.devPile.length, 25);
  for (const s of st.devPile) assert.ok(s >= 120 && !deck.slots[s].open, "a new, hidden slot");
  assert.deepEqual(st.devPile.map((s) => devKind(g.face(s))).sort(), [...Array(14).fill("knight"), ...Array(2).fill("monopoly"), ...Array(2).fill("plenty"), ...Array(2).fill("road"), ...Array(5).fill("vp")].sort());
  assert.deepEqual([st.phase, st.turn, st.setup.order], ["setup", 2, [2, 3, 0, 1, 1, 0, 3, 2]]);
  assert.equal(st.board.terrain[st.robber], DESERT);
  assert.deepEqual(movers(st), []);
  // The board comes from the rng newState gets.
  assert.deepEqual(game({ players: 4, first: 2 }).st.board, st.board);
  assert.notDeepEqual(game({ seed: "other" }).st.board, st.board);
  throwsRule(() => makeRules({}, 3).newState(0, 4, new KnownDeck([...Array(120).keys()]), rngFromSeed("x")), /3 players/);
});

test("faces, costs and payments", () => {
  assert.deepEqual([0, 18, 19, 94, 95, 120, -1, null].map(resourceOf), [0, 0, 1, 4, -1, -1, -1, -1]);
  assert.deepEqual([95, 108, 109, 113, 114, 116, 118, 119, 94, 120].map(devKind), ["knight", "knight", "vp", "vp", "road", "plenty", "monopoly", "monopoly", null, null]);
  const face = (s) => s; // slot = face here
  assert.deepEqual(counts([0, 1, 19, 95, 76], face), [2, 1, 0, 0, 1]);
  assert.deepEqual(payment([0, 1, 19, 38, 57], face, COSTS.settlement), [0, 19, 38, 57]);
  assert.equal(payment([0, 1, 19], face, COSTS.settlement), null);
  assert.equal(payment([], (s) => null, COSTS.road), null);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ target: 9, moveSeconds: 5, level: "x" }), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ target: 8, moveSeconds: 30, level: "hard" }), { target: 8, moveSeconds: 30, level: "hard" });
});

test("setup: snake order, the distance rule, a road at the new settlement, and the second settlement's cards", () => {
  const g = game({ players: 3, first: 1 });
  const { st, move } = g;
  assert.deepEqual(st.setup.order, [1, 2, 0, 0, 2, 1]);
  throwsRule(() => move(0, { settle: 20 }), /not your turn/);
  throwsRule(() => move(1, { road: CORNERS[20].edges[0] }), /settlement first/);
  const ev = move(1, { settle: 20 });
  assert.deepEqual(ev, [{ type: "build", p: 1, kind: "settlement", at: 20, free: true, pay: [] }]);
  assert.deepEqual(st.hands[1], [], "the first settlement collects nothing");
  throwsRule(() => move(1, { settle: 30 }), /place a road/);
  const far = EDGES.find((e) => e.a !== 20 && e.b !== 20).id;
  throwsRule(() => move(1, { road: far }), /next to the settlement/);
  move(1, { road: CORNERS[20].edges[0] });
  assert.equal(st.turn, 2);
  throwsRule(() => move(2, { settle: CORNERS[20].corners[0] }), /free corner/);
  throwsRule(() => move(2, { settle: 20 }), /free corner/);
  assert.ok(!legalCorners(st, 2).includes(CORNERS[20].corners[1]));
  assert.deepEqual(legalCorners(st, 0), [], "not seat 0's turn");
  // Two picks each, in snake order; seat 1's second collects a card per hex.
  for (const p of [2, 0, 0, 2]) {
    move(p, { settle: legalCorners(st, p).at(-1) });
    move(p, { road: legalEdges(st, p)[0] });
  }
  const last = legalCorners(st, 1).find((c) => CORNERS[c].hexes.length === 3 && CORNERS[c].hexes.every((h) => st.board.terrain[h] !== DESERT));
  const before = st.bank.map((b) => b.length);
  const events = move(1, { settle: last });
  const gain = events.find((e) => e.type === "gain");
  assert.equal(gain.slots.length, 3);
  assert.deepEqual(counts(gain.slots, g.face), counts(CORNERS[last].hexes.map((h) => st.board.terrain[h] * 19), (f) => f));
  assert.equal(st.bank.flat().length, before.reduce((a, b) => a + b) - 3);
  assert.deepEqual(st.hands[1], gain.slots);
  const done = move(1, { road: legalEdges(st, 1)[0] });
  assert.deepEqual(done.at(-1), { type: "turn", p: 1 });
  assert.deepEqual([st.phase, st.turn, st.rolled], ["roll", 1, false]);
  assert.deepEqual(st.pieces[1], { roads: 13, settlements: 3, cities: 4 });
});

test("roads join your roads or buildings, but not through someone else's settlement", () => {
  const g = main(game());
  const { st, move } = g;
  const { corners, edges } = path(20, 3);
  place(g, 0, corners[0]);
  lay(g, 0, [edges[0]]);
  g.give(0, WOOD, BRICK, WOOD, BRICK);
  const far = EDGES.find((e) => ![e.a, e.b].some((c) => corners.includes(c) || CORNERS[c].corners.some((o) => corners.includes(o)))).id;
  throwsRule(() => move(0, { road: far, pay: [...g.cards(0, WOOD).slice(0, 1), ...g.cards(0, BRICK).slice(0, 1)] }), /joined to your roads/);
  // Seat 1 settles at the end of seat 0's road: seat 0 can't build on through it.
  place(g, 1, corners[1]);
  assert.ok(!legalEdges(st, 0).includes(edges[1]));
  throwsRule(() => move(0, { road: edges[1], pay: [g.cards(0, WOOD)[0], g.cards(0, BRICK)[0]] }), /joined to your roads/);
  st.buildings[corners[1]] = null;
  const pay = [g.cards(0, WOOD)[0], g.cards(0, BRICK)[0]];
  throwsRule(() => move(0, { road: edges[1], pay: pay.slice(0, 1) }), /pay for a road/);
  throwsRule(() => move(0, { road: edges[1], pay: [pay[0], g.cards(0, WOOD)[1]] }), /don't pay for a road/);
  throwsRule(() => move(0, { road: edges[1], pay: [pay[0], st.bank[BRICK][0]] }), /from your hand/);
  const ev = move(0, { road: edges[1], pay });
  assert.deepEqual(ev[0], { type: "build", p: 0, kind: "road", at: edges[1], free: false, pay });
  assert.ok(st.bank[WOOD].includes(pay[0]) && st.bank[BRICK].includes(pay[1]), "spent cards go back to the bank");
  assert.equal(st.hands[0].length, 2);
  throwsRule(() => move(0, { road: edges[1], pay: [g.cards(0, WOOD)[0], g.cards(0, BRICK)[0]] }), /free edge/);
});

test("settlements and cities: on your road, two roads apart, and a city on your own settlement", () => {
  const g = main(game());
  const { st, move } = g;
  const { corners, edges } = path(20, 2);
  place(g, 0, corners[0]);
  lay(g, 0, edges);
  g.give(0, WOOD, BRICK, WOOL, GRAIN, GRAIN, GRAIN, ORE, ORE, ORE);
  const pay = payment(st.hands[0], g.face, COSTS.settlement);
  throwsRule(() => move(0, { settle: corners[1], pay }), /free corner/);
  throwsRule(() => move(0, { settle: 0, pay }), /on your road/);
  assert.deepEqual(legalCorners(st, 0), [corners[2]]);
  move(0, { settle: corners[2], pay });
  assert.equal(points(st, 0), 2);
  const city = payment(st.hands[0], g.face, COSTS.city);
  throwsRule(() => move(0, { city: corners[1], pay: city }), /one of your settlements/);
  place(g, 1, 0);
  throwsRule(() => move(0, { city: 0, pay: city }), /one of your settlements/);
  const ev = move(0, { city: corners[2], pay: city });
  assert.equal(ev[0].kind, "city");
  assert.deepEqual(st.buildings[corners[2]], { p: 0, city: true });
  assert.deepEqual(st.pieces[0], { roads: 13, settlements: 4, cities: 3 }, "the settlement goes back to the supply");
  assert.equal(points(st, 0), 3);
  assert.deepEqual(legalCities(st, 0), [corners[0]]);
  st.pieces[0].cities = 0;
  assert.deepEqual(legalCities(st, 0), []);
});

// Seats 0 and 1 on a hex rolling 6 (3 and 3); seat 1 has a city.
function producing() {
  const g = main(game());
  const { st } = g;
  const h = 9;
  st.board.numbers = st.board.numbers.map((_, i) => (i === h ? 6 : 0));
  st.board.terrain[h] = WOOD;
  st.robber = 0;
  place(g, 0, HEXES[h].corners[0]);
  place(g, 1, HEXES[h].corners[3], true);
  Object.assign(st, { phase: "roll", rolled: false });
  return { ...g, h };
}

test("production: a settlement 1 and a city 2 of the hex's resource, none under the robber", () => {
  const g = producing();
  const ev = g.move(0, { roll: true }, dice(3, 3));
  const prod = ev.find((e) => e.type === "produce");
  assert.deepEqual(ev[0], { type: "roll", p: 0, dice: [3, 3] });
  assert.equal(prod.roll, 6);
  assert.deepEqual(prod.gains.map((x) => x.length), [1, 2, 0]);
  assert.deepEqual(prod.short, []);
  assert.deepEqual(g.cards(1, WOOD), prod.gains[1]);
  assert.equal(g.st.bank[WOOD].length, 16);
  assert.deepEqual([g.st.phase, g.st.dice], ["main", [3, 3]]);
  const r = producing();
  r.st.robber = r.h;
  assert.deepEqual(r.move(0, { roll: true }, dice(3, 3)).find((e) => e.type === "produce").gains, [[], [], []]);
});

test("a bank short of a resource pays nobody, unless only one player wanted it", () => {
  const g = producing();
  g.give(2, ...Array(17).fill(WOOD)); // two left; three wanted
  const prod = g.move(0, { roll: true }, dice(3, 3)).find((e) => e.type === "produce");
  assert.deepEqual(prod.gains, [[], [], []]);
  assert.deepEqual(prod.short, [WOOD]);
  assert.equal(g.st.bank[WOOD].length, 2);
  const one = producing();
  one.st.buildings[HEXES[one.h].corners[0]] = null;
  one.give(2, ...Array(18).fill(WOOD)); // one left; the city wants two
  const solo = one.move(0, { roll: true }, dice(3, 3)).find((e) => e.type === "produce");
  assert.deepEqual(solo.gains.map((x) => x.length), [0, 1, 0]);
  assert.deepEqual(solo.short, [WOOD]);
  assert.equal(one.st.bank[WOOD].length, 0);
});

test("a 7: everyone over 7 cards discards half at once, then the robber moves and steals", () => {
  const g = producing();
  const { st, move } = g;
  g.give(0, ...Array(8).fill(GRAIN));
  g.give(1, ...Array(7).fill(GRAIN));
  g.give(2, WOOD, WOOD, WOOD, BRICK, BRICK, BRICK, WOOL, WOOL, WOOL);
  assert.deepEqual([0, 1, 2].map((p) => discardCount(st, p)), [4, 0, 4]);
  const ev = move(0, { roll: true }, dice(3, 4));
  assert.ok(!ev.some((e) => e.type === "produce"));
  assert.deepEqual([st.phase, st.discards], ["discard", [4, 0, 4]]);
  assert.deepEqual(movers(st), [0, 2]);
  throwsRule(() => move(1, { discard: [] }), /not your turn/);
  throwsRule(() => move(0, { discard: st.hands[0].slice(0, 3) }), /discard 4/);
  throwsRule(() => move(0, { discard: [st.hands[0][0], st.hands[0][0], st.hands[0][1], st.hands[0][2]] }), /distinct cards/);
  throwsRule(() => move(0, { discard: [...st.hands[0].slice(0, 3), st.hands[1][0]] }), /from your hand/);
  throwsRule(() => move(0, { robber: 3, steal: -1 }), /doesn't fit/);
  // Discarding is free whatever the other chose: seat 2 first.
  const two = st.hands[2].slice(0, 4);
  assert.deepEqual(move(2, { discard: two }), [{ type: "discard", p: 2, slots: two }]);
  assert.equal(st.phase, "discard");
  move(0, { discard: st.hands[0].slice(0, 4) });
  assert.deepEqual([st.phase, st.hands.map((h) => h.length)], ["robber", [4, 7, 5]]);
  assert.equal(st.bank[GRAIN].length, 19 - 15 + 4);
  // The robber: another hex, and a victim there with a card.
  throwsRule(() => move(0, { robber: st.robber, steal: -1 }), /another hex/);
  assert.equal(robberHexes(st).length, 18);
  assert.deepEqual(victims(st, g.h, 0), [1]);
  throwsRule(() => move(0, { robber: g.h, steal: -1 }), /steal from a player/);
  throwsRule(() => move(0, { robber: g.h, steal: 2 }), /steal from a player/);
  throwsRule(() => move(0, { robber: g.h, steal: 0 }), /steal from a player/);
  const empty = HEXES.find((h) => h.id !== st.robber && !victims(st, h.id, 0).length).id;
  throwsRule(() => move(0, { robber: empty, steal: 1 }), /nobody to steal/);
  const old = st.hands[1].slice();
  const ops = g.deck.ops.length;
  const steal = move(0, { robber: g.h, steal: 1 });
  const { slot } = steal.find((e) => e.type === "steal");
  assert.deepEqual(steal[0], { type: "robber", p: 0, hex: g.h });
  assert.deepEqual(g.deck.ops[ops], { type: "shuffle", ids: old }, "the victim's hand is shuffled by everyone");
  assert.equal(st.hands[1].length, 6);
  assert.equal(st.hands[0].at(-1), slot);
  assert.ok(![slot, ...st.hands[1]].some((s) => old.includes(s)), "every card of the victim's is in a new slot");
  assert.ok(![slot, ...st.hands[1]].some((s) => g.deck.slots[s].open), "and hidden");
  assert.equal(g.deck.owner(slot), 0);
  assert.equal(resourceOf(g.face(slot)), GRAIN);
  assert.deepEqual([st.robber, st.phase], [g.h, "main"]);
  // Nobody to rob: steal -1.
  Object.assign(st, { phase: "robber" });
  st.hands[1] = [];
  assert.deepEqual(victims(st, 0, 0), []);
  move(0, { robber: 0, steal: -1 });
  assert.equal(st.phase, "main");
});

test("a 7 with nobody over 7 cards goes straight to the robber", () => {
  const g = producing();
  g.give(1, ...Array(7).fill(GRAIN));
  g.move(0, { roll: true }, dice(6, 1));
  assert.deepEqual([g.st.phase, g.st.discards], ["robber", [0, 0, 0]]);
});

test("a knight before rolling, one development card a turn, none the turn it was bought", () => {
  const g = main(game());
  const { st, move } = g;
  Object.assign(st, { phase: "roll", rolled: false });
  const knight = g.dev(0, "knight");
  const road = g.dev(0, "road");
  const vp = g.dev(0, "vp");
  throwsRule(() => move(0, { play: road }), /only a knight/);
  throwsRule(() => move(0, { play: vp }), /claim/);
  throwsRule(() => move(0, { play: st.bank[0][0] }), /from your hand/);
  const ev = move(0, { play: knight });
  assert.deepEqual(ev[0], { type: "play", p: 0, kind: "knight", slot: knight });
  assert.deepEqual([st.phase, st.knights[0], st.devPlayed, st.shown[0]], ["robber", 1, true, [g.face(knight)]]);
  move(0, { robber: 3, steal: -1 });
  assert.equal(st.phase, "roll", "back to the roll");
  move(0, { roll: true }, dice(1, 1));
  assert.equal(st.phase, "main");
  throwsRule(() => move(0, { play: road }), /one development card a turn/);
  move(0, { end: true });
  move(1, { roll: true }, dice(1, 1));
  move(1, { end: true });
  move(2, { roll: true }, dice(1, 1));
  move(2, { end: true });
  move(0, { roll: true }, dice(1, 1));
  // Bought this turn: not before the next.
  g.give(0, WOOL, GRAIN, ORE);
  const bought = move(0, { buy: true, pay: st.hands[0].slice() });
  const slot = bought[0].slot;
  assert.deepEqual(bought[0], { type: "buy", p: 0, slot, pay: bought[0].pay });
  assert.ok(st.devs[0].includes(slot) && st.bought.includes(slot));
  assert.equal(g.deck.owner(slot), 0);
  assert.equal(st.devPile.length, 21);
  throwsRule(() => move(0, { play: slot }), /bought this turn|claim/);
  throwsRule(() => move(0, { play: road }), /nowhere to build/);
});

test("road building: two free roads, nothing else until they're down, fewer if the pieces run out", () => {
  const g = main(game());
  const { st, move } = g;
  const card = g.dev(0, "road");
  throwsRule(() => move(0, { play: card }), /nowhere to build/);
  place(g, 0, 20);
  move(0, { play: card });
  assert.equal(st.freeRoads, 2);
  throwsRule(() => move(0, { end: true }), /free roads first/);
  const [a, b] = legalEdges(st, 0);
  throwsRule(() => move(0, { road: a, pay: [st.bank[0][0]] }), /free/);
  assert.deepEqual(legalMoves(st, 0, g.face), legalEdges(st, 0).map((e) => ({ road: e })));
  const ev = move(0, { road: a });
  assert.deepEqual(ev[0], { type: "build", p: 0, kind: "road", at: a, free: true, pay: [] });
  move(0, { road: legalEdges(st, 0).find((e) => e !== a) ?? b, pay: [] });
  assert.deepEqual([st.freeRoads, st.pieces[0].roads], [0, 13]);
  move(0, { end: true });
  // One road piece left: one free road.
  const h = main(game());
  place(h, 0, 20);
  lay(h, 0, [CORNERS[20].edges[0]]);
  h.st.pieces[0].roads = 1;
  h.move(0, { play: h.dev(0, "road") });
  assert.equal(h.st.freeRoads, 1);
  h.move(0, { road: legalEdges(h.st, 0)[0] });
  assert.equal(h.st.freeRoads, 0);
  assert.deepEqual(legalEdges(h.st, 0), []);
});

test("year of plenty takes two cards the bank has", () => {
  const g = main(game());
  const card = g.dev(0, "plenty");
  throwsRule(() => g.move(0, { play: card, take: [1] }), /two resources/);
  throwsRule(() => g.move(0, { play: card, take: [1, 5] }), /two resources/);
  g.give(1, ...Array(18).fill(ORE));
  throwsRule(() => g.move(0, { play: card, take: [ORE, ORE] }), /bank hasn't got/);
  const ev = g.move(0, { play: card, take: [ORE, WOOL] });
  const plenty = ev.find((e) => e.type === "plenty");
  assert.deepEqual(counts(plenty.slots, g.face), [0, 0, 1, 0, 1]);
  assert.deepEqual(g.st.hands[0], plenty.slots);
});

test("monopoly: everyone shows every card of the resource at once, and they go to the player", () => {
  const g = main(game());
  const { st, move } = g;
  g.give(1, WOOL, BRICK, WOOL);
  const card = g.dev(0, "monopoly");
  throwsRule(() => move(0, { play: card, resource: 5 }), /name a resource/);
  move(0, { play: card, resource: WOOL });
  assert.deepEqual([st.phase, movers(st)], ["monopoly", [1]], "seat 2 has no cards to give");
  const wool = g.cards(1, WOOL);
  assert.deepEqual(forcedMove(st, 1, g.face), { give: wool });
  assert.deepEqual(legalMoves(st, 1, g.face), [{ give: wool }]);
  throwsRule(() => move(1, { give: [wool[0]] }), /kept back/);
  throwsRule(() => move(1, { give: [...wool, g.cards(1, BRICK)[0]] }), /only cards of the resource/);
  const ev = move(1, { give: wool });
  assert.deepEqual(ev, [{ type: "monopoly", p: 0, resource: WOOL, given: [[], wool, []] }]);
  assert.deepEqual([st.phase, st.monopoly, st.hands[0], st.hands[1].length], ["main", null, wool, 1]);
  for (const s of wool) assert.equal(g.deck.owner(s), 0);
});

test("a card kept back from Monopoly passes while hidden, and is caught once every face is known", () => {
  const lie = (blind) => {
    const g = main(game());
    g.give(1, WOOL, WOOL, BRICK);
    g.hide(1);
    g.deck.blind = blind;
    g.move(0, { play: g.dev(0, "monopoly"), resource: WOOL });
    return () => g.move(1, { give: [] });
  };
  lie(true)();
  throwsRule(lie(false), /kept back/);
});

test("nobody holding a card makes Monopoly end at once", () => {
  const g = main(game());
  const ev = g.move(0, { play: g.dev(0, "monopoly"), resource: ORE });
  assert.deepEqual(ev.at(-1), { type: "monopoly", p: 0, resource: ORE, given: [[], [], []] });
  assert.equal(g.st.phase, "main");
});

test("harbours: 4:1, 3:1 at a 3:1 harbour, 2:1 at a resource's own", () => {
  const g = main(game());
  const { st, move } = g;
  st.board.harbours[0].kind = ANY;
  st.board.harbours[1].kind = WOOL;
  const at = (i) => EDGES[st.board.harbours[i].edge].a;
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => tradeRate(st, 0, r)), [4, 4, 4, 4, 4]);
  place(g, 0, at(0));
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => tradeRate(st, 0, r)), [3, 3, 3, 3, 3]);
  place(g, 0, EDGES[st.board.harbours[1].edge].b);
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => tradeRate(st, 0, r)), [3, 3, 2, 3, 3]);
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => tradeRate(st, 1, r)), [4, 4, 4, 4, 4]);
  g.give(0, WOOL, WOOL, BRICK, BRICK, BRICK, ORE);
  const wool = g.cards(0, WOOL);
  throwsRule(() => move(0, { bank: wool, take: WOOL }), /different resource/);
  throwsRule(() => move(0, { bank: [wool[0]], take: ORE }), /takes 2/);
  throwsRule(() => move(0, { bank: [wool[0], g.cards(0, BRICK)[0]], take: ORE }), /one resource/);
  throwsRule(() => move(0, { bank: wool, take: 7 }), /take: a resource/);
  const ev = move(0, { bank: wool, take: ORE });
  assert.deepEqual(ev[0], { type: "bank", p: 0, gave: wool, got: ev[0].got });
  assert.equal(resourceOf(g.face(ev[0].got)), ORE);
  assert.deepEqual(counts(st.hands[0], g.face), [0, 3, 0, 0, 2]);
  g.give(2, ...st.bank[GRAIN].map(() => GRAIN));
  throwsRule(() => move(0, { bank: g.cards(0, BRICK), take: GRAIN }), /has none/);
  move(0, { bank: g.cards(0, BRICK), take: WOOD });
});

test("trading: an offer, answered by everyone at once, and a partner picked from those who accepted", () => {
  const g = main(game({ players: 4 }));
  const { st, move } = g;
  g.give(0, WOOD, WOOD);
  g.give(1, ORE, ORE);
  g.give(2, ORE, BRICK);
  g.give(3, ORE);
  const wood = g.cards(0, WOOD);
  const want = [0, 0, 0, 0, 2];
  throwsRule(() => move(0, { offer: wood, want: [1, 0, 0, 0, 0] }), /what you give/);
  throwsRule(() => move(0, { offer: wood, want: [0, 0, 0, 0, 0] }), /at least one/);
  throwsRule(() => move(0, { offer: wood, want: [0, 0, 0, 0] }), /5 counts/);
  throwsRule(() => move(0, { offer: [], want }), /at least one card/);
  const ev = move(0, { offer: wood, want });
  assert.deepEqual(ev, [{ type: "offer", p: 0, give: wood, want }]);
  assert.deepEqual([st.phase, st.trade.answers], ["answer", [false, null, null, false]], "seat 3 has too few cards to accept");
  assert.deepEqual(movers(st), [1, 2]);
  assert.deepEqual(forcedMove(st, 2, g.face), { decline: true }, "seat 2 can't pay");
  assert.deepEqual(legalMoves(st, 1, g.face), [{ accept: g.cards(1, ORE) }, { decline: true }]);
  throwsRule(() => move(2, { accept: st.hands[2].slice() }), /exactly the cards wanted/);
  throwsRule(() => move(0, { decline: true }), /not your turn/);
  move(2, { decline: true });
  const ore = g.cards(1, ORE);
  assert.deepEqual(move(1, { accept: ore }), [{ type: "answer", p: 1, accept: ore }]);
  assert.equal(st.phase, "partner");
  assert.deepEqual(legalMoves(st, 0, g.face), [{ partner: 1 }, { partner: -1 }]);
  throwsRule(() => move(0, { partner: 2 }), /who accepted/);
  throwsRule(() => move(0, { partner: 0 }), /who accepted/);
  const done = move(0, { partner: 1 });
  assert.deepEqual(done, [{ type: "trade", from: 0, to: 1, gave: wood, got: ore }]);
  assert.deepEqual([st.hands[0], st.hands[1], st.phase, st.trade], [ore, wood, "main", null]);
  for (const s of ore) assert.equal(g.deck.owner(s), 0);
  // Nobody accepts, or the offerer calls it off: no deal.
  move(0, { offer: [ore[0]], want: [0, 0, 1, 0, 0] });
  for (const p of movers(st)) move(p, { decline: true });
  assert.deepEqual([st.phase, st.trade], ["main", null]);
  move(0, { offer: [ore[0]], want: [1, 0, 0, 0, 0] });
  move(2, { decline: true });
  move(3, { decline: true });
  move(1, { accept: [wood[0]] });
  assert.deepEqual(move(0, { partner: -1 }), [{ type: "nodeal", p: 0 }]);
  assert.deepEqual(st.hands[0], ore);
  // Nobody able to accept: over at once.
  const ask = move(0, { offer: [ore[0]], want: [0, 0, 0, 3, 0] });
  assert.deepEqual(ask.at(-1), { type: "nodeal", p: 0 });
});

test("longest road: 5 or more, a tie keeps it, a longer road takes it", () => {
  const g = main(game());
  const { st, move } = g;
  const a = path(0, 6);
  const b = path(53, 6, new Set(a.corners.flatMap((c) => [c, ...CORNERS[c].corners])));
  place(g, 0, a.corners[0]);
  place(g, 1, b.corners[0]);
  lay(g, 0, a.edges.slice(0, 3));
  g.give(0, ...Array(3).fill([WOOD, BRICK]).flat());
  const road = () => [g.cards(0, WOOD)[0], g.cards(0, BRICK)[0]];
  assert.equal(roadLength(st, 0), 3);
  assert.deepEqual(move(0, { road: a.edges[3], pay: road() }).filter((e) => e.type === "longest"), []);
  const ev = move(0, { road: a.edges[4], pay: road() });
  assert.deepEqual(ev.find((e) => e.type === "longest"), { type: "longest", p: 0, size: 5 });
  assert.equal(points(st, 0), 3);
  lay(g, 1, b.edges.slice(0, 5));
  main(g, 1);
  g.give(1, WOOD, BRICK, WOOD, BRICK);
  // Seat 1 ties at 5 by a road elsewhere: seat 0 keeps it.
  st.roads[b.edges[4]] = -1;
  move(1, { road: b.edges[4], pay: [g.cards(1, WOOD)[0], g.cards(1, BRICK)[0]] });
  assert.deepEqual(st.longest, { p: 0, size: 5 });
  const take = move(1, { road: b.edges[5], pay: [g.cards(1, WOOD)[0], g.cards(1, BRICK)[0]] });
  assert.deepEqual(take.find((e) => e.type === "longest"), { type: "longest", p: 1, size: 6 });
  assert.deepEqual([points(st, 0), points(st, 1)], [1, 3]);
});

test("road length: branches count their longest trail, a loop counts every edge, another's settlement cuts it", () => {
  const g = main(game());
  const { st } = g;
  lay(g, 0, HEXES[9].edges);
  assert.equal(roadLength(st, 0), 6);
  const spur = CORNERS[HEXES[9].corners[0]].edges.find((e) => !HEXES[9].edges.includes(e));
  lay(g, 0, [spur]);
  assert.equal(roadLength(st, 0), 7);
  place(g, 1, HEXES[9].corners[3]);
  assert.equal(roadLength(st, 0), 6, "a trail may start and end at the settlement, not pass it");
  place(g, 1, HEXES[9].corners[0]);
  assert.equal(roadLength(st, 0), 3);
  assert.equal(roadLength(st, 1), 0);
});

// Seat 1 holds longest road with `length`; seat 2 can settle on it, among
// corners `at`; seat 0's road is `zero` long, seat 2's `two`.
function cutting(zero, { two = 0, length = 6, at = [2, 5] } = {}) {
  const g = main(game(), 2);
  const { st } = g;
  const b = path(26, length);
  const avoid = new Set(b.corners.flatMap((c) => [c, ...CORNERS[c].corners]));
  const a = path(0, Math.max(zero, 1), avoid);
  lay(g, 1, b.edges);
  if (zero) lay(g, 0, a.edges.slice(0, zero));
  for (const c of a.corners) avoid.add(c);
  if (two) lay(g, 2, path(53, two, avoid).edges);
  st.longest = { p: 1, size: length };
  // Seat 2's road up to seat 1's.
  const mid = b.corners.slice(...at).find((c) => CORNERS[c].edges.length === 3);
  lay(g, 2, [CORNERS[mid].edges.find((e) => !b.edges.includes(e))]);
  g.give(2, WOOD, BRICK, WOOL, GRAIN);
  const settle = () => g.move(2, { settle: mid, pay: g.st.hands[2].slice() });
  return { ...g, settle };
}

test("longest road cut by a settlement: to a single longest road, to nobody on a tie, to nobody under 5", () => {
  const one = cutting(5);
  const ev = one.settle();
  assert.deepEqual(ev.find((e) => e.type === "longest"), { type: "longest", p: 0, size: 5 });
  assert.ok(roadLength(one.st, 1) < 5);
  const tie = cutting(5, { two: 5 });
  assert.deepEqual(tie.settle().find((e) => e.type === "longest"), { type: "longest", p: -1, size: 0 });
  const none = cutting(4);
  assert.deepEqual(none.settle().find((e) => e.type === "longest"), { type: "longest", p: -1, size: 0 });
  assert.deepEqual(none.st.longest, { p: -1, size: 0 });
  // Still the longest after the cut, or tied: seat 1 keeps it.
  const keep = cutting(5, { length: 7, at: [5, 7] });
  assert.ok(!keep.settle().some((e) => e.type === "longest"));
  assert.ok(roadLength(keep.st, 1) >= 5 && roadLength(keep.st, 1) < 7);
  assert.deepEqual(keep.st.longest, { p: 1, size: roadLength(keep.st, 1) });
});

test("largest army: 3 knights, a tie keeps it, more takes it", () => {
  const g = main(game());
  const { st, move } = g;
  const knight = (p) => {
    main(g, p);
    st.devPlayed = false;
    const ev = move(p, { play: g.dev(p, "knight") });
    move(p, { robber: robberHexes(st)[0], steal: -1 });
    return ev.filter((e) => e.type === "army");
  };
  knight(0);
  assert.deepEqual(knight(0), []);
  assert.deepEqual(knight(0), [{ type: "army", p: 0, size: 3 }]);
  assert.equal(points(st, 0), 2);
  knight(1);
  knight(1);
  assert.deepEqual(knight(1), [], "a tie keeps it");
  assert.deepEqual(knight(1), [{ type: "army", p: 1, size: 4 }]);
  knight(1);
  assert.deepEqual(st.army, { p: 1, size: 5 });
  assert.deepEqual([points(st, 0), points(st, 1)], [0, 2]);
});

test("a win on your own turn at the target: at once from the board, with victory point cards shown by claim", () => {
  const g = main(game({ config: { target: 8 } }));
  const { st, move } = g;
  const spots = [0, 4, 9, 20, 27, 40];
  spots.slice(0, 3).forEach((c) => place(g, 0, c, true));
  assert.equal(points(st, 0), 6);
  const vp = [g.dev(0, "vp"), g.dev(0, "vp")];
  throwsRule(() => move(0, { claim: [vp[0]] }), /2 needed/);
  throwsRule(() => move(0, { claim: [vp[0], g.dev(0, "knight")] }), /only victory point/);
  throwsRule(() => move(0, { claim: [vp[0], vp[0]] }), /victory point cards from your hand/);
  assert.deepEqual(legalMoves(st, 0, g.face).filter(has("claim")), [{ claim: vp }]);
  const ev = move(0, { claim: vp });
  assert.deepEqual(ev, [{ type: "claim", p: 0, slots: vp }, { type: "over", winner: 0, points: [8, 0, 0] }]);
  assert.deepEqual([st.phase, st.winner], ["over", 0]);
  throwsRule(() => move(0, { end: true }), /over/);
  assert.deepEqual(legalMoves(st, 0, g.face), []);
  // From the board: at once.
  const b = main(game());
  [0, 4, 9, 20].forEach((c) => place(b, 0, c, true));
  const [r] = path(40, 1).edges;
  place(b, 0, 40);
  lay(b, 0, [r]);
  const end = EDGES[r].a === 40 ? EDGES[r].b : EDGES[r].a;
  const next = CORNERS[end].corners.find((c) => c !== 40);
  lay(b, 0, [edgeBetween(end, next)]);
  b.give(0, WOOD, BRICK, WOOL, GRAIN);
  assert.equal(points(b.st, 0), 9);
  const won = b.move(0, { settle: next, pay: b.st.hands[0].slice() });
  assert.deepEqual(won.at(-1), { type: "over", winner: 0, points: [10, 0, 0] });
});

test("points reached on someone else's turn win at the start of your own", () => {
  const g = main(game());
  const { st, move } = g;
  [0, 4, 9, 20].forEach((c) => place(g, 1, c, true));
  st.longest = { p: 1, size: 5 };
  assert.equal(points(st, 1), 10);
  const ev = move(0, { end: true });
  assert.deepEqual(ev, [{ type: "turn", p: 1 }, { type: "over", winner: 1, points: [0, 10, 0] }]);
});

test("reveals, needsRandom and movers", () => {
  const g = main(game());
  const { st, rules } = g;
  assert.deepEqual(rules.reveals(st, 0, { road: 3, pay: [5, 6] }), [5, 6]);
  assert.deepEqual(rules.reveals(st, 0, { play: 7, take: [1, 2] }), [7]);
  assert.deepEqual(rules.reveals(st, 0, { bank: [1, 2, 3, 4], take: 0 }), [1, 2, 3, 4]);
  assert.deepEqual(rules.reveals(st, 0, { offer: [1], want: [0, 1, 0, 0, 0] }), [1]);
  assert.deepEqual(rules.reveals(st, 0, { end: true }), []);
  for (const bad of [null, undefined, "x", [], 7, { pay: [1] }, { road: 3, pay: "x" }]) assert.deepEqual(rules.reveals(st, 0, bad), []);
  assert.equal(rules.needsRandom(st, { roll: true }), false, "not in the main phase");
  st.phase = "roll";
  assert.equal(rules.needsRandom(st, { roll: true }), true);
  assert.equal(rules.needsRandom(st, { roll: 1 }), false);
  assert.equal(rules.needsRandom(st, { play: 3 }), false);
  assert.deepEqual(rules.reveals(st, 0, { road: 3, pay: [5, 6] }), [], "no building before the roll");
  assert.equal(rules.draws, 1024);
  assert.equal(rules.deckSize, 120);
});

// What arrives when a peer sends anything at all, as in test/rules-fuzz.test.js.
const garbage = (legal) => [null, undefined, {}, [], "x", NaN, -1, 1e9, 1.5, JSON.parse(`{"__proto__":${JSON.stringify(legal ?? {})}}`), "x".repeat(100_000)];

test("garbage moves and fields are refused with a RuleError and change nothing", () => {
  const g = producing();
  const { st, deck, rules } = g;
  const check = (p, move) => {
    for (const whole of garbage(move)) {
      const before = structuredClone(st);
      throwsRule(() => rules.applyMove(st, p, whole, deck, dice(1, 1)));
      assert.deepEqual(st, before);
    }
    for (const key of Object.keys(move)) {
      for (const v of garbage(move)) {
        const before = structuredClone(st);
        throwsRule(() => rules.applyMove(st, p, { ...move, [key]: v }, deck, dice(1, 1)), new RegExp(""));
        assert.deepEqual(st, before, `${key}: ${String(JSON.stringify(v)).slice(0, 40)}`);
      }
    }
  };
  check(0, { roll: true });
  g.move(0, { roll: true }, dice(3, 3));
  g.give(0, WOOD, BRICK, WOOL, GRAIN, ORE, ORE, ORE, GRAIN);
  const [edge] = path(HEXES[9].corners[0], 1).edges;
  lay(g, 0, [edge]);
  const pay = payment(st.hands[0], g.face, COSTS.road);
  for (const m of [{ road: legalEdges(st, 0)[0], pay }, { buy: true, pay: payment(st.hands[0], g.face, COSTS.dev) }, { city: HEXES[9].corners[0], pay: payment(st.hands[0], g.face, COSTS.city) }, { offer: [st.hands[0][0]], want: [0, 1, 0, 0, 0] }, { end: true }]) {
    for (const id of rules.reveals(st, 0, m)) deck.slots[id].open = true;
    check(0, m);
  }
  st.phase = "robber";
  check(0, { robber: g.h, steal: 1 });
});

// Plays a whole game with random legal moves on a known deck; each(state) after every move.
function playOut({ players, seed, blind = false, each = () => {} }) {
  const deck = new KnownDeck(shuffledDeck(seed), seed);
  deck.blind = blind;
  const rules = makeRules({}, players);
  const st = rules.newState(0, players, deck, rngFromSeed(seed));
  settleAll(rules, st, deck);
  const rng = rngFromSeed(`${seed} moves`);
  const roll = rngFromSeed(`${seed} dice`);
  for (let n = 0; st.winner === -1; n++) {
    if (n > 20_000) throw new Error("the game didn't finish");
    const seats = movers(st).length ? movers(st) : [st.turn];
    const moves = seats.map((p) => [p, choose(st, p, rng, deck.view(p))]);
    for (const [p, move] of moves) {
      each(st, p, deck, rules, n);
      for (const id of rules.reveals(st, p, move)) deck.slots[id].open = true;
      rules.applyMove(st, p, move, deck, rules.needsRandom(st, move) ? roll : undefined);
    }
    settleAll(rules, st, deck);
  }
  return st;
}

function shuffledDeck(seed) {
  const rng = rngFromSeed(seed);
  const faces = [...Array(120).keys()];
  for (let i = faces.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [faces[i], faces[j]] = [faces[j], faces[i]];
  }
  return faces;
}

// Random legal moves, leaning towards building so a game ends.
function choose(state, me, rng, face) {
  const forced = forcedMove(state, me, face);
  if (forced) return forced;
  const moves = legalMoves(state, me, face);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const of = (k) => moves.filter(has(k));
  if (state.phase === "discard") return { discard: state.hands[me].filter(() => rng() < 0.5).concat(state.hands[me]).filter((s, i, a) => a.indexOf(s) === i).slice(0, state.discards[me]) };
  if (state.phase === "roll") return of("claim")[0] ?? (of("play").length && rng() < 0.3 ? pick(of("play")) : { roll: true });
  if (state.phase === "answer") return of("accept").length && rng() < 0.5 ? of("accept")[0] : { decline: true };
  if (state.phase === "main" && !state.freeRoads) {
    for (const [k, p] of [["claim", 1], ["city", 1], ["settle", 1], ["buy", 0.8], ["play", 0.6], ["road", 0.6], ["bank", 0.6], ["offer", 0.1]]) {
      if (of(k).length && rng() < p) return pick(of(k));
    }
    return { end: true };
  }
  return pick(moves);
}

// A copy of a known deck, to try moves on.
function copyDeck(deck) {
  const copy = new KnownDeck([]);
  Object.assign(copy, { slots: structuredClone(deck.slots), cards: deck.cards.slice(), rng: rngFromSeed("copy"), blind: deck.blind });
  return copy;
}

test("whole games: every listed move is legal, no card is lost, and the state never depends on a hidden face", () => {
  const seen = new Set();
  for (const [players, seed] of [[3, "a"], [4, "b"], [3, "c"], [4, "d"]]) {
    const states = [];
    const st = playOut({
      players,
      seed,
      each: (s, p, deck, rules, n) => {
        states.push(JSON.stringify(s));
        assert.equal(new Set([...s.bank.flat(), ...s.hands.flat()]).size, 95, "every resource card once, in the bank or a hand");
        assert.equal(s.devPile.length + s.devs.flat().length + s.shown.flat().length, 25);
        if (n % 5) return;
        const face = deck.view(p);
        for (const move of legalMoves(s, p, face)) {
          seen.add(Object.keys(move)[0]);
          const copy = copyDeck(deck);
          for (const id of rules.reveals(s, p, move)) copy.slots[id].open = true;
          rules.applyMove(structuredClone(s), p, move, copy, rngFromSeed("try"));
        }
      },
    });
    assert.ok(st.winner >= 0);
    // The same game with hidden faces unknown, as in play, plays out the same.
    const blind = [];
    playOut({ players, seed, blind: true, each: (s) => blind.push(JSON.stringify(s)) });
    assert.deepEqual(blind, states);
  }
  for (const k of ["settle", "road", "roll", "discard", "robber", "city", "buy", "play", "bank", "offer", "accept", "decline", "partner", "give", "end"]) assert.ok(seen.has(k), `${k} was listed`);
});
