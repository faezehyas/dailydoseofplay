import test from "node:test";
import assert from "node:assert/strict";
import { KnownDeck, settleAll } from "../../test/fixtures/known-deck.js";
import { rngFromSeed } from "../engine/rng.js";
import { CARDS, WONDERS, GUILDS, WOOD, STONE, CLAY, ORE, GLASS, CLOTH, PAPYRUS, HAND, isGuild, guildCount } from "./cards.js";
import {
  makeRules,
  normalizeConfig,
  DEFAULT_CONFIG,
  MIN_PLAYERS,
  MAX_PLAYERS,
  SIDES_SETTING,
  ROUNDS,
  covers,
  purchases,
  canBuild,
  canStage,
  production,
  unitPrice,
  sciencePoints,
  score,
  shields,
  legalMoves,
  forcedMove,
  movers,
  reveals,
  designOf,
  deckOf,
  leftOf,
  rightOf,
} from "./rules.js";

const throwsRule = (f, re) => assert.throws(f, (err) => err.name === "RuleError" && (!re || re.test(err.message)), re && `expected ${re}`);
const W = (key) => WONDERS.findIndex((w) => w.key === key);
const ID = (key, age) => {
  const c = CARDS.find((x) => x.key === key && (age === undefined || x.age === age));
  assert.ok(c, `no card ${key}`);
  return c.id;
};
// 7 counts from { resource: n }.
const res = (o = {}) => [WOOD, STONE, CLAY, ORE, GLASS, CLOTH, PAPYRUS].map((r) => o[r] ?? 0);
const none = res();

// A table as CardMatch leaves it after the deal: every face known to the
// test. wonders: [[key, side], ...] by seat. hand/city/stages replace a
// seat's cards with fresh slots of the named designs (keys, or ids).
function table({ players = 3, side = "A", wonders, seed = "deck" } = {}) {
  const rules = makeRules({ side }, players);
  const deck = new KnownDeck([...Array(rules.deckSize).keys()], seed);
  for (const s of deck.slots) s.open = true;
  const st = rules.newState(0, players, deck, rngFromSeed(seed));
  const dealt = settleAll(rules, st, deck);
  if (wonders) st.wonders = wonders.map(([key, s = "A"]) => ({ w: W(key), side: s }));
  const slot = (k, owner, open) => {
    const id = typeof k === "number" ? k : ID(k);
    const face = deckOf(players).indexOf(id);
    assert.ok(face >= 0, `${CARDS[id].key} isn't in a ${players}-player deck`);
    return deck.slots.push({ face, owner, open, gone: false, held: [] }) - 1;
  };
  const t = {
    rules,
    deck,
    st,
    dealt,
    slot,
    hand: (p, ...keys) => (st.hands[p] = keys.map((k) => slot(k, p, false))),
    city: (p, ...keys) => (st.city[p] = keys.map((k) => ({ slot: slot(k, p, true), id: typeof k === "number" ? k : ID(k) }))),
    stages: (p, n) => (st.stages[p] = Array.from({ length: n }, () => slot(CARDS[deckOf(players)[0]].id, p, false))),
    // A move as CardMatch makes it: the cards it shows open first.
    move: (p, m) => {
      for (const id of rules.reveals(st, p, m)) deck.slots[id].open = true;
      return rules.applyMove(st, p, m, deck);
    },
    legal: (p) => legalMoves(st, p, deck.view(p)),
    // Every seat's pick (a seat left out sells its first card), then settle.
    turn: (picks = {}) => {
      for (const p of movers(st)) t.move(p, picks[p] ?? { discard: st.hands[p][0] });
      return settleAll(rules, st, deck);
    },
  };
  return t;
}
const of = (events, type) => events.filter((e) => e.type === type);

// ---------- config and setup ----------

test("config: the wonder side, clock and level, with defaults for anything else", () => {
  assert.deepEqual(normalizeConfig({}), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ side: "B", moveSeconds: 60, level: "hard" }), { side: "B", moveSeconds: 60, level: "hard" });
  assert.equal(normalizeConfig({ side: "C" }).side, "A");
  assert.deepEqual(SIDES_SETTING, ["A", "B", "random"]);
  assert.deepEqual([MIN_PLAYERS, MAX_PLAYERS], [3, 4]);
  assert.throws(() => makeRules({}, 2));
  assert.throws(() => makeRules({}, 8));
  for (const n of [3, 4, 5, 6, 7]) {
    const rules = makeRules({}, n);
    assert.equal(rules.deckSize, deckOf(n).length);
    assert.equal(rules.openFaces, rules.deckSize);
  }
});

test("the deal: a wonder each at random, 3 coins, and age I shuffled into seven hidden cards a seat", () => {
  for (const players of [3, 4, 7]) {
    const { st, deck, dealt } = table({ players });
    assert.equal(new Set(st.wonders.map((w) => w.w)).size, players);
    assert.ok(st.wonders.every((w) => w.side === "A"));
    assert.deepEqual(st.coins, Array(players).fill(3));
    assert.deepEqual([st.age, st.round, st.phase, st.turn, st.winner], [1, 1, "pick", -1, -1]);
    assert.deepEqual(of(dealt, "age"), [{ type: "age", age: 1 }]);
    for (const [p, hand] of st.hands.entries()) {
      assert.equal(hand.length, HAND);
      for (const s of hand) {
        assert.equal(deck.owner(s), p);
        assert.equal(deck.slots[s].open, false);
        assert.equal(CARDS[designOf(players, deck.slots[s].face)].age, 1);
      }
    }
    assert.deepEqual(movers(st), [...Array(players).keys()]);
  }
});

test("side settings: all A, all B, or each seat its own at random", () => {
  assert.ok(table({ side: "B" }).st.wonders.every((w) => w.side === "B"));
  assert.equal(table({ side: "B" }).st.side, "B");
  const sides = new Set();
  for (let i = 0; i < 12; i++) for (const w of table({ side: "random", seed: `side ${i}` }).st.wonders) sides.add(w.side);
  assert.deepEqual([...sides].sort(), ["A", "B"]);
  const wonders = new Set();
  for (let i = 0; i < 12; i++) for (const w of table({ seed: `wonder ${i}` }).st.wonders) wonders.add(w.w);
  assert.equal(wonders.size, WONDERS.length);
});

// ---------- production and purchases ----------

test("covers: each unit makes one resource, a choice unit counting once", () => {
  assert.ok(covers([[STONE], [STONE, CLAY]], res({ [STONE]: 1, [CLAY]: 1 })));
  assert.ok(!covers([[STONE, CLAY]], res({ [STONE]: 1, [CLAY]: 1 })));
  // The first choice tried for stone has to move over for clay.
  assert.ok(covers([[STONE, CLAY], [STONE, WOOD]], res({ [STONE]: 1, [CLAY]: 1 })));
  assert.ok(!covers([[STONE, CLAY], [STONE, CLAY]], res({ [STONE]: 1, [CLAY]: 1, [WOOD]: 1 })));
  assert.ok(covers([], none));
});

test("production: the wonder's resource, brown and grey cards, choice yellows and stages; neighbours buy only brown, grey and the wonder's", () => {
  const t = table({ wonders: [["alexandria"], ["giza"], ["rhodes"]] });
  t.city(0, "red-hollow", "glass-kiln", "caravan-yard", "palisade");
  t.stages(0, 2);
  const { own, sale } = production(t.st, 0);
  assert.deepEqual(sale, [[GLASS], [CLAY, ORE], [GLASS]]);
  assert.deepEqual(own, [[GLASS], [CLAY, ORE], [GLASS], [WOOD, STONE, CLAY, ORE], [WOOD, STONE, CLAY, ORE]]);
});

test("purchases: every minimal way to buy what's missing, with trade discounts, cheapest first", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  // Rhodes A's first stage costs two wood; nobody makes any.
  assert.deepEqual(purchases(t.st, 0, WONDERS[W("rhodes")].sides.A[0].cost), []);
  assert.equal(canStage(t.st, 0).why, "resources");
  t.city(1, "woodcutters-camp");
  t.city(2, "timber-mill");
  const W2 = res({ [WOOD]: 2 });
  assert.deepEqual(purchases(t.st, 0, W2), [
    { left: none, right: W2, coins: 4 },
    { left: res({ [WOOD]: 1 }), right: res({ [WOOD]: 1 }), coins: 4 },
  ]);
  t.city(0, "west-road");
  assert.equal(unitPrice(t.st, 0, WOOD, "left"), 1);
  assert.equal(unitPrice(t.st, 0, WOOD, "right"), 2);
  assert.equal(unitPrice(t.st, 0, GLASS, "left"), 2);
  assert.deepEqual(purchases(t.st, 0, W2), [
    { left: res({ [WOOD]: 1 }), right: res({ [WOOD]: 1 }), coins: 3 },
    { left: none, right: W2, coins: 4 },
  ]);
  t.city(0, "east-road");
  assert.equal(unitPrice(t.st, 0, ORE, "right"), 1);
  assert.equal(unitPrice(t.st, 0, ORE, "left"), 2);
  t.city(0, "artisans-row");
  assert.ok([GLASS, CLOTH, PAPYRUS].every((r) => unitPrice(t.st, 0, r, "left") === 1 && unitPrice(t.st, 0, r, "right") === 1));
  assert.equal(unitPrice(t.st, 0, WOOD, "left"), 2);
  // What you make yourself needs no purchase.
  t.city(0, "woodcutters-camp", "timber-mill");
  assert.deepEqual(purchases(t.st, 0, W2), [{ left: none, right: none, coins: 0 }]);
});

test("Olympia B's first stage buys raw materials from both neighbours at 1", () => {
  const t = table({ wonders: [["olympia", "B"], ["giza"], ["babylon"]] });
  assert.equal(unitPrice(t.st, 0, STONE, "left"), 2);
  t.stages(0, 1);
  assert.ok([WOOD, STONE, CLAY, ORE].every((r) => unitPrice(t.st, 0, r, "left") === 1 && unitPrice(t.st, 0, r, "right") === 1));
  assert.equal(unitPrice(t.st, 0, GLASS, "left"), 2);
});

test("a purchase must be one the neighbour makes at once, cover the cost with your own and be minimal", () => {
  // Siege Yard costs three clay and a wood; Olympia makes the wood.
  const t = table({ wonders: [["olympia"], ["babylon"], ["giza"]] });
  t.city(1, "red-hollow"); // the left: clay from Babylon, and clay or ore from one card
  t.city(2, "clay-bank");
  const [yard] = t.hand(0, "siege-yard");
  t.st.coins[0] = 10;
  t.deck.slots[yard].open = true;
  const C = (n, more = {}) => res({ [CLAY]: n, ...more });
  const legal = (buy) => t.rules.applyMove(structuredClone(t.st), 0, { build: yard, buy }, t.deck);
  throwsRule(() => legal({ left: C(3), right: none }), /left neighbour can't/);
  throwsRule(() => legal({ left: C(2, { [ORE]: 1 }), right: C(1) }), /left neighbour can't/);
  throwsRule(() => legal({ left: C(2), right: none }), /can't make the rest/);
  throwsRule(() => legal({ left: C(2), right: C(2) }), /right neighbour can't/);
  legal({ left: C(2), right: C(1) });
  throwsRule(() => legal({ left: C(2), right: C(1, { [STONE]: 1 }) }), /buy only what you need/);
  // The wood is Olympia's own: buying it too is more than needed.
  t.city(2, "clay-bank", "woodcutters-camp");
  throwsRule(() => legal({ left: C(2), right: C(1, { [WOOD]: 1 }) }), /buy only what you need/);
  assert.deepEqual(purchases(t.st, 0, CARDS[ID("siege-yard")].cost), [{ left: C(2), right: C(1), coins: 6 }]);
  assert.deepEqual(t.legal(0).filter((m) => m.build === yard), [{ build: yard, buy: { left: C(2), right: C(1) } }]);
});

test("a minimal purchase with choices on your side: either missing resource may be bought", () => {
  // Horse Paddock costs ore, clay and wood; Red Hollow makes clay or ore.
  const t = table({ wonders: [["alexandria"], ["olympia"], ["babylon"]] });
  t.city(0, "red-hollow");
  t.city(1, "ore-seam");
  const list = purchases(t.st, 0, CARDS[ID("horse-paddock")].cost);
  assert.deepEqual(list, [
    { left: res({ [WOOD]: 1, [ORE]: 1 }), right: none, coins: 4 },
    { left: res({ [WOOD]: 1 }), right: res({ [CLAY]: 1 }), coins: 4 },
  ]);
});
test("coins: a purchase and a card's coin cost must be paid from the coins at the start of the turn", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  const [springs, grove] = t.hand(0, "hot-springs", "red-hollow");
  t.st.coins[0] = 1;
  t.deck.slots[springs].open = t.deck.slots[grove].open = true;
  const S = { left: res({ [STONE]: 1 }), right: none };
  throwsRule(() => t.rules.applyMove(structuredClone(t.st), 0, { build: springs, buy: S }, t.deck), /coins/);
  t.rules.applyMove(structuredClone(t.st), 0, { build: grove }, t.deck);
  t.st.coins[0] = 0;
  throwsRule(() => t.rules.applyMove(structuredClone(t.st), 0, { build: grove }, t.deck), /coins/);
  assert.equal(canBuild(t.st, 0, ID("red-hollow")).why, "coins");
  t.st.coins[0] = 2;
  const ev = t.turn({ 0: { build: springs, buy: S } });
  assert.deepEqual(of(ev, "build")[0], { type: "build", p: 0, slot: springs, id: ID("hot-springs"), how: "paid", coins: 0, bought: { left: 2, right: 0 } });
  assert.deepEqual(of(ev, "gain").find((e) => e.why === "trade"), { type: "gain", p: 1, coins: 2, why: "trade", from: 0 });
});

test("both neighbours may buy the same unit from a seat, and coins received arrive only after everyone has paid", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  // Seat 1 is seat 0's left and seat 2's right; both buy its stone.
  t.city(0, "woodcutters-camp");
  const [a] = t.hand(0, "hot-springs");
  const [palisade, shrine] = t.hand(1, "palisade", "shrine");
  const [c] = t.hand(2, "hot-springs");
  t.st.coins = [2, 0, 2];
  // Seat 1 can't spend the coins it is about to receive.
  t.deck.slots[palisade].open = true;
  throwsRule(() => t.rules.applyMove(structuredClone(t.st), 1, { build: palisade, buy: { left: none, right: res({ [WOOD]: 1 }) } }, t.deck), /coins/);
  const S = res({ [STONE]: 1 });
  const ev = t.turn({ 0: { build: a, buy: { left: S, right: none } }, 1: { discard: shrine }, 2: { build: c, buy: { left: none, right: S } } });
  assert.deepEqual(t.st.coins, [0, 3 + 2 + 2, 0]);
  const types = ev.map((e) => e.type);
  assert.ok(types.lastIndexOf("build") < types.indexOf("gain"), "gains come after every build");
});

test("chains: a card is free with no purchase when the city holds a card it builds from", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  t.city(0, "hot-springs");
  const [channel] = t.hand(0, "water-channel");
  t.st.coins[0] = 0;
  assert.deepEqual(canBuild(t.st, 0, ID("water-channel")), { ok: true, why: null, chain: true, free: false, purchases: [] });
  assert.deepEqual(t.legal(0).filter((m) => m.build === channel), [{ build: channel }]);
  t.deck.slots[channel].open = true;
  throwsRule(() => t.rules.applyMove(structuredClone(t.st), 0, { build: channel, buy: { left: res({ [STONE]: 1 }), right: none } }, t.deck), /chain/);
  const ev = t.turn({ 0: { build: channel } });
  assert.equal(of(ev, "build")[0].how, "chain");
  assert.equal(t.st.coins[0], 0);
  assert.deepEqual(t.st.city[0].map((c) => c.id), [ID("hot-springs"), ID("water-channel")]);
});

test("a city holds one card of a key: the same grey card from another age is refused", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  t.city(0, ID("glass-kiln", 1));
  const [kiln] = t.hand(0, ID("glass-kiln", 2));
  t.deck.slots[kiln].open = true;
  throwsRule(() => t.move(0, { build: kiln }), /already have/);
  assert.equal(canBuild(t.st, 0, ID("glass-kiln", 2)).why, "duplicate");
  assert.ok(!t.legal(0).some((m) => m.build === kiln));
  assert.ok(t.legal(0).some((m) => m.discard === kiln));
});

// ---------- wonder stages ----------

test("stages: in order, each tucking its card face down, none past the last", () => {
  const t = table({ wonders: [["giza"], ["rhodes"], ["babylon"]] });
  t.city(0, "stone-cut");
  const hand = t.hand(0, "palisade", "shrine");
  const ev = t.turn({ 0: { stage: hand[0] } });
  assert.deepEqual(of(ev, "stage"), [{ type: "stage", p: 0, slot: hand[0], n: 0, bought: { left: 0, right: 0 } }]);
  assert.deepEqual(t.st.stages[0], [hand[0]]);
  assert.equal(t.deck.slots[hand[0]].open, false, "a tucked card stays hidden");
  assert.deepEqual(t.st.city[0].map((c) => c.id), [ID("stone-cut")]);
  // Giza A's second stage costs three wood.
  t.hand(0, "palisade");
  assert.equal(canStage(t.st, 0).n, 1);
  t.stages(0, 3);
  const [last] = t.hand(0, "palisade");
  throwsRule(() => t.move(0, { stage: last }), /finished/);
  assert.equal(canStage(t.st, 0).why, "built");
  assert.ok(!t.legal(0).some((m) => "stage" in m));
});

test("stage effects: points, shields and coins once built, coins arriving after payments", () => {
  const t = table({ wonders: [["rhodes", "B"], ["ephesus", "A"], ["giza", "B"]] });
  t.city(0, "stone-cut", "great-quarry");
  t.city(1, "timber-mill");
  t.stages(1, 1);
  t.stages(2, 3);
  const [r] = t.hand(0, "shrine");
  const [e] = t.hand(1, "shrine");
  t.st.coins = [0, 0, 0];
  const ev = t.turn({ 0: { stage: r }, 1: { stage: e } });
  assert.deepEqual(t.st.coins, [3, 9, 3]);
  assert.deepEqual(of(ev, "gain").map((g) => [g.p, g.coins, g.why]), [[0, 3, "stage"], [1, 9, "stage"], [2, 3, "sale"]]);
  assert.equal(shields(t.st, 0), 1);
  assert.equal(score(t.st, 0).wonder, 3);
  assert.equal(score(t.st, 2).wonder, 3 + 5 + 5);
  assert.equal(score(t.st, 1).wonder, 3);
});

test("Alexandria's stages make a resource of a kind for itself only", () => {
  const t = table({ wonders: [["alexandria", "B"], ["giza"], ["babylon"]] });
  t.stages(0, 2);
  // Glass from the wonder, one raw and one good from the stages: Sanctuary needs wood, clay and glass.
  assert.deepEqual(purchases(t.st, 0, CARDS[ID("sanctuary")].cost), [{ left: none, right: res({ [CLAY]: 1 }), coins: 2 }]);
  assert.deepEqual(production(t.st, 0).sale, [[GLASS]]);
  // Giza buying wood from Alexandria (its right) can't: the stages aren't for sale.
  assert.deepEqual(purchases(t.st, 1, res({ [WOOD]: 1 })), []);
  // Hot Springs needs a stone: from its own raw choice.
  assert.deepEqual(purchases(t.st, 0, CARDS[ID("hot-springs")].cost), [{ left: none, right: none, coins: 0 }]);
});

test("Babylon B plays the seventh card once its second stage is built, even in the sixth turn", () => {
  const t = table({ wonders: [["babylon", "B"], ["giza"], ["rhodes"]] });
  t.st.round = ROUNDS;
  t.stages(0, 1);
  t.city(0, "glass-kiln", "timber-mill");
  const [stageCard, seventh] = t.hand(0, "shrine", "amphitheatre");
  const others = [t.hand(1, "shrine", "palisade"), t.hand(2, "shrine", "palisade")];
  let ev = t.turn({ 0: { stage: stageCard } });
  assert.deepEqual(of(ev, "last"), [{ type: "last", p: 0 }]);
  assert.deepEqual([t.st.phase, t.st.lastSeat, t.st.age], ["last", 0, 1]);
  assert.deepEqual(movers(t.st), [0]);
  assert.deepEqual(t.st.hands[0], [seventh]);
  assert.ok(t.legal(1).length === 0);
  throwsRule(() => t.move(1, { discard: others[0][1] }), /not your move/);
  ev = t.turn({ 0: { build: seventh } });
  assert.deepEqual(t.st.city[0].at(-1).id, ID("amphitheatre"));
  // The others' seventh cards are discarded, hidden; then the war and age II.
  assert.deepEqual(of(ev, "discard").map((e) => e.slot), [others[0][1], others[1][1]]);
  assert.ok([others[0][1], others[1][1]].every((s) => t.st.discard.includes(s) && !t.deck.slots[s].open));
  assert.deepEqual([t.st.phase, t.st.lastSeat, t.st.age, t.st.round], ["pick", -1, 2, 1]);
  assert.ok(of(ev, "war").length && of(ev, "age").length);
});

test("the seventh card of each hand is discarded, hidden, without a Babylon B second stage", () => {
  const t = table({ wonders: [["babylon", "A"], ["giza"], ["rhodes"]] });
  t.st.round = ROUNDS;
  t.stages(0, 2);
  const hands = [0, 1, 2].map((p) => t.hand(p, "shrine", "palisade"));
  const ev = t.turn();
  assert.ok(!of(ev, "last").length);
  assert.deepEqual(new Set(t.st.discard), new Set(hands.flat()));
  assert.ok(hands.flat().every((s) => !t.deck.slots[s].open));
  assert.deepEqual(t.st.coins, [6, 6, 6]); // the sales pay, the seventh cards don't
  assert.equal(t.st.age, 2);
  assert.ok(t.st.hands.every((h) => h.length === HAND));
});

test("Olympia A builds a card free once an age", () => {
  const t = table({ wonders: [["olympia", "A"], ["giza"], ["rhodes"]] });
  const [citadel] = t.hand(0, "crown-hall");
  t.deck.slots[citadel].open = true;
  throwsRule(() => t.rules.applyMove(structuredClone(t.st), 0, { build: citadel, free: true }, t.deck), /no free build/);
  t.stages(0, 2);
  assert.ok(canBuild(t.st, 0, ID("crown-hall")).free);
  assert.ok(t.legal(0).some((m) => m.build === citadel && m.free === true));
  throwsRule(() => t.rules.applyMove(structuredClone(t.st), 0, { build: citadel, free: true, buy: { left: res({ [STONE]: 1 }), right: none } }, t.deck), /buys nothing/);
  throwsRule(() => t.rules.applyMove(structuredClone(t.st), 0, { discard: citadel, free: true }, t.deck), /free/);
  const ev = t.turn({ 0: { build: citadel, free: true } });
  assert.deepEqual(of(ev, "build")[0].how, "free");
  assert.equal(t.st.coins[0], 3);
  assert.equal(t.st.freeAge[0], 1);
  const [again] = t.hand(0, "council-house");
  t.deck.slots[again].open = true;
  throwsRule(() => t.move(0, { build: again, free: true }), /no free build/);
  t.st.age = 2;
  t.rules.applyMove(structuredClone(t.st), 0, { build: again, free: true }, t.deck);
});

test("Halicarnassus digs the discard pile at the end of the turn, building one card free", () => {
  const t = table({ wonders: [["halicarnassus", "A"], ["giza"], ["rhodes"]] });
  t.stages(0, 1);
  t.city(0, "ore-seam", "smeltery");
  const pile = [t.slot("crown-hall", 1, false), t.slot("ore-seam", 2, false), t.slot("palisade", 1, false)];
  t.st.discard = pile.slice();
  const [tuck] = t.hand(0, "shrine");
  let ev = t.turn({ 0: { stage: tuck } });
  assert.deepEqual(of(ev, "dig"), [{ type: "dig", p: 0 }]);
  assert.deepEqual([t.st.phase, t.st.digger, movers(t.st)], ["dig", 0, [0]]);
  // Every discard passes to the digger, unseen by the others.
  const sold = t.st.discard.filter((s) => !pile.includes(s));
  assert.ok(t.st.discard.every((s) => t.deck.owner(s) === 0 && !t.deck.slots[s].open));
  const legal = t.legal(0);
  assert.ok(legal.some((m) => m.dig === -1));
  assert.ok(legal.some((m) => m.dig === pile[0]));
  assert.ok(!legal.some((m) => m.dig === pile[1]), "it holds an Ore Seam already");
  assert.ok(sold.length === 2);
  throwsRule(() => t.move(0, { dig: pile[1] }), /already have/);
  throwsRule(() => t.move(0, { build: tuck }), /dig/);
  throwsRule(() => t.move(1, { dig: -1 }), /not your move/);
  ev = t.turn({ 0: { dig: pile[0] } });
  assert.deepEqual(of(ev, "build"), [{ type: "build", p: 0, slot: pile[0], id: ID("crown-hall"), how: "dig", coins: 0, bought: { left: 0, right: 0 } }]);
  assert.ok(t.deck.slots[pile[0]].open);
  assert.ok(!t.st.discard.includes(pile[0]));
  assert.deepEqual([t.st.phase, t.st.digger, t.st.round], ["pick", -1, 2]);
  assert.ok(of(ev, "pass").length);
});

test("a dig with an empty pile is skipped; with nothing to build, the only move is -1", () => {
  const t = table({ wonders: [["halicarnassus", "B"], ["giza"], ["rhodes"]] });
  t.city(0, "ore-seam", "smeltery", "shrine");
  t.st.coins = [0, 0, 0];
  const [tuck] = t.hand(0, "palisade");
  const [a] = t.hand(1, "shrine");
  const [b] = t.hand(2, "shrine");
  let ev = t.turn({ 0: { stage: tuck }, 1: { build: a }, 2: { build: b } });
  assert.ok(!of(ev, "dig").length);
  assert.equal(t.st.phase, "pick");
  // Now one card in the pile, a Shrine, which it holds.
  t.st.discard = [t.slot("shrine", 1, false)];
  t.city(0, "ore-seam", "smeltery", "clay-bank", "brickworks", "shrine");
  const [tuck2] = t.hand(0, "palisade");
  const [a2] = t.hand(1, "amphitheatre");
  const [b2] = t.hand(2, "amphitheatre");
  ev = t.turn({ 0: { stage: tuck2 }, 1: { build: a2 }, 2: { build: b2 } });
  assert.equal(t.st.phase, "dig");
  assert.deepEqual(forcedMove(t.st, 0, t.deck.view(0)), { dig: -1 });
  assert.equal(forcedMove(t.st, 1, t.deck.view(1)), null);
  t.turn({ 0: { dig: -1 } });
  assert.equal(t.st.phase, "pick");
});

test("a dig in the sixth turn sees that age's seventh cards", () => {
  const t = table({ wonders: [["halicarnassus", "A"], ["giza"], ["rhodes"]] });
  t.st.round = ROUNDS;
  t.stages(0, 1);
  t.city(0, "ore-seam", "smeltery");
  const [tuck] = t.hand(0, "shrine", "palisade");
  const sevenths = [t.st.hands[0][1], t.hand(1, "shrine", "hot-springs")[1], t.hand(2, "shrine", "watchtower")[1]];
  t.turn({ 0: { stage: tuck } });
  assert.equal(t.st.phase, "dig");
  assert.ok(sevenths.every((s) => t.st.discard.includes(s)));
  const ev = t.turn({ 0: { dig: sevenths[1] } });
  assert.equal(t.st.city[0].at(-1).id, ID("hot-springs"));
  assert.equal(t.st.age, 2);
  assert.ok(of(ev, "war").length);
});

test("wild science: Babylon's stage and the Scholars' Guild take the symbol that scores best", () => {
  assert.equal(sciencePoints([1, 1, 1]), 10);
  assert.equal(sciencePoints([2, 1, 0]), 5);
  assert.equal(sciencePoints([3, 2, 1], 1), 31);
  assert.equal(sciencePoints([1, 1, 0], 1), 10);
  assert.equal(sciencePoints([0, 0, 0], 2), 4);
  const t = table({ wonders: [["babylon", "A"], ["giza"], ["rhodes"]] });
  t.city(0, "herbalist", "tinkers-shed");
  assert.equal(score(t.st, 0).science, 2);
  t.stages(0, 2);
  assert.equal(score(t.st, 0).science, 10);
  t.city(0, "herbalist", "tinkers-shed", "scholars-guild");
  assert.equal(score(t.st, 0).science, sciencePoints([1, 1, 0], 2));
});

test("Olympia B copies the neighbour's guild that scores best, a copied Scholars' Guild a wild symbol", () => {
  const t = table({ wonders: [["olympia", "B"], ["giza"], ["rhodes"]] });
  t.city(1, "judges-guild", "shrine", "amphitheatre");
  t.city(2, "sages-guild", "herbalist");
  t.stages(0, 2);
  assert.equal(score(t.st, 0).copied, -1);
  t.stages(0, 3);
  // Judges': blue in the neighbours (2); Sages': green in the neighbours (1).
  let s = score(t.st, 0);
  assert.deepEqual([s.copied, s.guilds], [ID("judges-guild"), 2]);
  t.city(0, "herbalist", "tinkers-shed");
  t.city(2, "scholars-guild");
  s = score(t.st, 0);
  assert.deepEqual([s.copied, s.guilds, s.science], [ID("scholars-guild"), 0, 10]);
  assert.equal(score(t.st, 2).science, 1);
});

// ---------- yellow cards, military, guilds, scoring ----------

test("yellow income counts the cities after every build of the turn, and arrives after payments", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["alexandria"]] });
  t.city(0, "stone-cut");
  t.city(2, "clay-bank", "ore-seam", "east-road");
  t.st.coins = [0, 0, 1];
  const [press] = t.hand(0, "olive-press");
  const [camp] = t.hand(1, "woodcutters-camp");
  const [house] = t.hand(2, "counting-house");
  // Counting House needs stone and glass: the stone bought from the right (Giza) at 1.
  const ev = t.turn({ 0: { build: press }, 1: { build: camp }, 2: { build: house, buy: { left: none, right: res({ [STONE]: 1 }) } } });
  const income = (p) => of(ev, "gain").find((g) => g.p === p && g.why === "card").coins;
  // Olive Press: brown in its city and both neighbours, Woodcutter's Camp of this turn included.
  assert.equal(income(0), 1 + 1 + 2);
  // Counting House: yellow in its own city, itself included.
  assert.equal(income(2), 2);
  assert.deepEqual(t.st.coins, [4, 1, 2]);
  assert.equal(score(t.st, 2).commerce, 2);
});

test("Wayside Inn pays 5 coins when built", () => {
  const t = table({ players: 4, wonders: [["rhodes"], ["giza"], ["babylon"], ["olympia"]] });
  const [inn] = t.hand(0, "wayside-inn");
  t.st.coins = [0, 0, 0, 0];
  const ev = t.turn({ 0: { build: inn } });
  assert.deepEqual(of(ev, "gain").filter((g) => g.why === "card"), [{ type: "gain", p: 0, coins: 5, why: "card" }]);
  assert.equal(t.st.coins[0], 5);
});

test("Hippodrome pays 3 coins a stage built and scores a point a stage", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  t.stages(1, 2);
  t.city(1, "great-quarry", "ore-seam");
  const [hip] = t.hand(1, "hippodrome");
  t.st.coins = [0, 0, 0];
  const ev = t.turn({ 1: { build: hip } });
  assert.deepEqual(of(ev, "gain").filter((g) => g.why === "card").map((g) => [g.p, g.coins]), [[1, 6]]);
  assert.equal(score(t.st, 1).commerce, 2);
});


test("military: at the end of each age, more shields than a neighbour wins 1, 3 or 5, fewer loses 1, a tie nothing", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  t.city(0, "palisade");
  t.city(2, "ramparts");
  for (const age of [1, 2, 3]) {
    t.st.age = age;
    t.st.round = ROUNDS;
    for (const p of [0, 1, 2]) t.hand(p, "shrine", "shrine");
    const ev = t.turn();
    assert.deepEqual(of(ev, "war"), [{ type: "war", age, results: [[1, -1], [-1, -1], [1, 1]] }]);
  }
  assert.deepEqual(t.st.tokens, [[1, -1, 3, -1, 5, -1], [-1, -1, -1, -1, -1, -1], [1, 1, 3, 3, 5, 5]]);
  assert.equal(score(t.st, 0).military, 6);
  // A tie takes nothing.
  const u = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  u.st.round = ROUNDS;
  for (const p of [0, 1, 2]) u.hand(p, "shrine", "shrine");
  assert.deepEqual(of(u.turn(), "war")[0].results, [[0, 0], [0, 0], [0, 0]]);
  assert.deepEqual(u.st.tokens, [[], [], []]);
});

test("each guild scores what it counts in the cities it looks at", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  // Seat 0's neighbours are 1 (left) and 2 (right).
  t.city(1, "stone-cut", "glass-kiln", "east-road", "herbalist", "palisade", "shrine");
  t.city(2, "clay-bank", "ore-seam", "weavers-hall", "agora", "tinkers-shed", "guard-post", "watchtower", "amphitheatre");
  t.st.tokens = [[], [-1, 1, -1], [-1]];
  t.stages(0, 1);
  t.stages(1, 2);
  t.stages(2, 3);
  const guild = (key, ...rest) => {
    t.city(0, key, ...rest);
    return score(t.st, 0).guilds;
  };
  assert.equal(guild("delvers-guild"), 3);
  assert.equal(guild("makers-guild"), 2 * 2);
  assert.equal(guild("hawkers-guild"), 2);
  assert.equal(guild("sages-guild"), 2);
  assert.equal(guild("whisperers-guild"), 3);
  assert.equal(guild("tacticians-guild"), 3);
  // Sailors': brown, grey and purple in its own city, itself included; with the Makers' Guild's 4.
  assert.equal(guild("sailors-guild", "stone-cut", "glass-kiln", "makers-guild"), 1 + 1 + 2 + 4);
  assert.equal(guild("judges-guild"), 2);
  assert.equal(guild("masons-guild"), 1 + 2 + 3);
  assert.equal(guild("scholars-guild"), 0);
  assert.equal(score(t.st, 0).science, 1);
});

test("the score sheet: coins a point per 3, civic, commerce and the total", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
  t.city(0, "shrine", "water-channel", "harbour", "stone-cut", "ore-seam", "palisade");
  t.st.coins[0] = 11;
  t.st.tokens[0] = [1, -1];
  t.stages(0, 2);
  assert.deepEqual(score(t.st, 0), { military: 0, coins: 3, wonder: 3, civic: 7, commerce: 2, guilds: 0, science: 0, total: 15, copied: -1 });
});

test("the end: the highest total wins, a tie goes to the most coins, a tie on both is shared", () => {
  const end = (coins) => {
    const t = table({ wonders: [["rhodes"], ["giza"], ["babylon"]] });
    t.st.age = 3;
    t.st.round = ROUNDS;
    t.st.coins = coins;
    for (const p of [0, 1, 2]) t.hand(p, "shrine", "shrine");
    const ev = t.turn();
    return { st: t.st, over: of(ev, "over")[0] };
  };
  let { st, over } = end([3, 3, 3]);
  assert.deepEqual([st.phase, st.winner, st.winners], ["over", -2, [0, 1, 2]]);
  assert.deepEqual(over.winners, [0, 1, 2]);
  assert.equal(over.scores[0].total, 2);
  ({ st } = end([3, 5, 3]));
  assert.deepEqual([st.winner, st.winners], [1, [1]]);
  ({ st, over } = end([6, 5, 3]));
  assert.deepEqual([st.winner, st.winners], [0, [0]]);
  assert.deepEqual(over.scores.map((s) => s.total), [3, 2, 2]);
  assert.deepEqual(movers(st), []);
});

// ---------- turns ----------

test("hands pass left (to seat p + 1) in ages I and III and right in age II", () => {
  const t = table();
  const before = t.st.hands.map((h) => h.slice());
  const picks = [0, 1, 2].map((p) => before[p][0]);
  let ev = t.turn();
  assert.deepEqual(of(ev, "pass"), [{ type: "pass", dir: 1 }]);
  for (const p of [0, 1, 2]) {
    assert.deepEqual(t.st.hands[leftOf(t.st, p)], before[p].filter((s) => s !== picks[p]));
    for (const s of t.st.hands[leftOf(t.st, p)]) assert.equal(t.deck.owner(s), leftOf(t.st, p));
  }
  assert.equal(t.st.round, 2);
  t.st.age = 2;
  const mid = t.st.hands.map((h) => h.slice());
  ev = t.turn();
  assert.deepEqual(of(ev, "pass"), [{ type: "pass", dir: -1 }]);
  for (const p of [0, 1, 2]) assert.deepEqual(t.st.hands[rightOf(t.st, p)], mid[p].slice(1));
});

test("age III deals players + 2 guilds, unseen, the rest never dealt", () => {
  for (const players of [3, 4, 5, 6, 7]) {
    const t = table({ players, seed: `guilds ${players}` });
    const rng = rngFromSeed(`guilds ${players}`);
    while (t.st.age < 3) {
      for (const p of movers(t.st)) {
        const moves = t.legal(p);
        t.move(p, moves[Math.floor(rng() * moves.length)]);
      }
      settleAll(t.rules, t.st, t.deck);
    }
    const designs = (slots) => slots.map((s) => CARDS[designOf(players, t.deck.slots[s].face)]);
    const dealt = designs(t.st.hands.flat());
    assert.equal(dealt.length, HAND * players);
    assert.ok(dealt.every((c) => c.age === 3));
    assert.equal(dealt.filter(isGuild).length, guildCount(players));
    assert.equal(t.st.pool.length, GUILDS.length - guildCount(players));
    assert.ok(t.st.pool.every((s) => !t.deck.slots[s].open && t.deck.owner(s) === -1));
    assert.deepEqual([...designs(t.st.pool), ...dealt.filter(isGuild)].map((c) => c.id).sort((a, b) => a - b), GUILDS.slice().sort((a, b) => a - b));
    assert.ok(t.st.piles.every((p) => p.length === 0));
  }
});

test("a pick only records; a pick's legality never depends on another seat's pick", () => {
  const t = table({ seed: "independent" });
  t.st.coins = [5, 5, 5];
  const legal = [0, 1, 2].map((p) => t.legal(p));
  const rng = rngFromSeed("independent");
  for (let i = 0; i < 40; i++) {
    const st = structuredClone(t.st);
    const order = [0, 1, 2].sort(() => rng() - 0.5);
    for (const p of order) {
      const m = legal[p][Math.floor(rng() * legal[p].length)];
      for (const id of reveals(st, p, m)) t.deck.slots[id].open = true;
      const before = JSON.stringify({ ...st, picks: null, moves: 0 });
      assert.deepEqual(t.rules.applyMove(st, p, m, t.deck), []);
      assert.equal(JSON.stringify({ ...st, picks: null, moves: 0 }), before);
      assert.ok(st.picks[p]);
    }
    assert.equal(st.moves, 3);
  }
  // A seat chooses once.
  t.move(0, { discard: t.st.hands[0][0] });
  throwsRule(() => t.move(0, { discard: t.st.hands[0][1] }), /chosen already/);
  assert.deepEqual(legalMoves(t.st, 0, t.deck.view(0)), []);
});

test("garbage moves are RuleErrors that leave the state alone", () => {
  const t = table({ wonders: [["giza"], ["rhodes"], ["babylon"]] });
  t.city(0, "stone-cut");
  const [a, b] = t.st.hands[0];
  t.deck.slots[a].open = true;
  const bad = [
    null,
    undefined,
    7,
    "build",
    [],
    {},
    { build: a, stage: a },
    { build: b + 1000 },
    { build: -1 },
    { build: "1" },
    { build: 1.5 },
    { stage: t.st.hands[1][0] },
    { discard: null },
    { build: a, buy: null },
    { build: a, buy: {} },
    { build: a, buy: { left: [1], right: none } },
    { build: a, buy: { left: none.map(() => -1), right: none } },
    { build: a, buy: { left: none.map(() => 1.5), right: none } },
    { build: a, buy: { left: "x".repeat(10), right: none } },
    { build: a, free: "yes" },
    { build: a, free: false },
    { discard: a, buy: { left: none, right: none } },
    { dig: a },
    JSON.parse(`{"__proto__":{"discard":${a}}}`),
  ];
  for (const m of bad) {
    const st = structuredClone(t.st);
    throwsRule(() => t.rules.applyMove(st, 0, m, t.deck));
    assert.deepEqual(st, t.st, JSON.stringify(m));
  }
  throwsRule(() => t.rules.applyMove(structuredClone(t.st), 5, { discard: a }, t.deck), /not your move/);
  // A field a move doesn't use is ignored; an empty purchase is no purchase.
  t.rules.applyMove(structuredClone(t.st), 0, { discard: a, note: 1 }, t.deck);
  const st = structuredClone(t.st);
  t.rules.applyMove(st, 0, { stage: a, buy: { left: none, right: none } }, t.deck);
  assert.deepEqual(st.picks[0], { stage: a });
  assert.deepEqual(reveals(t.st, 0, null), []);
  assert.deepEqual(reveals(t.st, 0, { stage: a }), []);
  assert.deepEqual(reveals(t.st, 0, { build: a }), [a]);
});

test("random games at 3 to 7 seats: every listed move is legal, and every game ends", () => {
  for (const players of [3, 4, 5, 6, 7]) {
    for (const side of SIDES_SETTING) {
      const t = table({ players, side, seed: `random ${players} ${side}` });
      const rng = rngFromSeed(`random ${players} ${side}`);
      let steps = 0;
      let over = null;
      while (t.st.winner === -1) {
        assert.ok(++steps < 100);
        for (const p of movers(t.st)) {
          const moves = t.legal(p);
          assert.ok(moves.length > 0);
          for (const m of moves.filter((_, i) => i % 5 === 0)) {
            for (const id of reveals(t.st, p, m)) t.deck.slots[id].open = true;
            t.rules.applyMove(structuredClone(t.st), p, m, t.deck);
          }
          const build = moves.filter((m) => !("discard" in m));
          const list = build.length && rng() < 0.8 ? build : moves;
          t.move(p, list[Math.floor(rng() * list.length)]);
        }
        over = of(settleAll(t.rules, t.st, t.deck), "over")[0] ?? over;
      }
      assert.equal(t.st.phase, "over");
      assert.deepEqual(over.scores, t.st.city.map((_, p) => score(t.st, p)));
      assert.ok(t.st.winners.length >= 1);
      const all = [...t.st.city.flat().map((c) => c.slot), ...t.st.stages.flat(), ...t.st.discard, ...t.st.pool];
      // Every card ends built, tucked, discarded or among the guilds never dealt.
      assert.equal(new Set(all).size, all.length);
      assert.equal(all.length, t.rules.deckSize);
    }
  }
});
