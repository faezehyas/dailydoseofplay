// What the view shares with the tutorial, without a DOM: the words a screen
// reader hears for cards, costs, purchases, wars and results, the choices a
// card in your hand offers, and the table's layout helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, WONDERS, DISCARD_COINS } from "./cards.js";
import { sideCoins } from "./rules.js";
import { readFileSync } from "node:fs";
import { costWords, effectWords, cardWords, chainsFrom, chainsTo, stageWords, payWords, buyWords, moveFor, pickOptions, warWords, warPairs, pairWords, resultWords, viewOf, seatsAround, cityColumns, sells, turnWords, seatWords, recapWords, handCaption, tokensAfter, scienceWords, CITY_COLORS, kit } from "./art.js";
import { TIP_KINDS, tipWords } from "./tips.js";

const idOf = (key) => CARDS.find((c) => c.key === key).id;
const zero = () => [0, 0, 0, 0, 0, 0, 0];
const counts = (pairs) => pairs.reduce((c, [r, n]) => ((c[r] = n), c), zero());

// A small table: wonders by index (all side A), cities by card key, coins.
function table({ wonders = [6, 0, 4], cities = [[], [], []], coins = [3, 3, 3], stages = null, age = 1 } = {}) {
  const n = wonders.length;
  return {
    players: n,
    age,
    round: 1,
    phase: "pick",
    wonders: wonders.map((w) => ({ w, side: "A" })),
    hands: Array.from({ length: n }, () => []),
    city: cities.map((keys) => keys.map((k, i) => ({ slot: 100 + i, id: idOf(k) }))),
    stages: stages ?? Array.from({ length: n }, () => []),
    coins: coins.slice(),
    tokens: Array.from({ length: n }, () => []),
    discard: [],
    freeAge: Array(n).fill(0),
    digger: -1,
    lastSeat: -1,
    picks: Array(n).fill(null),
  };
}

test("costs and effects read as plain words", () => {
  assert.equal(costWords(CARDS[idOf("timber-mill")].cost), "1 coin");
  assert.equal(costWords(CARDS[idOf("water-channel")].cost), "3 stone");
  assert.equal(costWords(CARDS[idOf("stone-cut")].cost), "free");
  assert.equal(effectWords(CARDS[idOf("timber-mill")]), "makes 2 wood");
  assert.equal(effectWords(CARDS[idOf("riverside-grove")]), "makes wood or clay, one a turn");
  assert.equal(effectWords(CARDS[idOf("east-road")]), "buy raw materials from your right neighbour for 1 coin a unit");
  assert.equal(effectWords(CARDS[idOf("artisans-row")]), "buy goods from either neighbour for 1 coin a unit");
  assert.equal(effectWords(CARDS[idOf("olive-press")]), "1 coin now for each brown card in your city and your neighbours'");
  assert.equal(effectWords(CARDS[idOf("harbour")]), "1 coin now and 1 point at the end for each brown card in your city");
  assert.equal(effectWords(CARDS[idOf("hippodrome")]), "3 coins now and 1 point at the end for each stage of your wonder");
  assert.equal(effectWords(CARDS[idOf("delvers-guild")]), "1 point at the end for each brown card in your neighbours' cities");
  assert.equal(effectWords(CARDS[idOf("tacticians-guild")]), "1 point at the end for each defeat token in your neighbours' cities");
  assert.equal(effectWords(CARDS[idOf("scholars-guild")]), "any science symbol, whichever scores best");
  assert.equal(effectWords(CARDS[idOf("herbalist")]), "a star");
  // Wonder stages: a resource choice nobody can buy, a dig, several effects at once.
  const alexandria = WONDERS.find((w) => w.key === "alexandria").sides.A;
  assert.equal(effectWords(alexandria[1]), "makes wood, stone, clay or ore (not for sale)");
  assert.equal(effectWords(WONDERS.find((w) => w.key === "rhodes").sides.B[0]), "3 points, 1 shield and 3 coins at once");
  assert.equal(effectWords(WONDERS.find((w) => w.key === "halicarnassus").sides.A[1]), "build one card from the discards free");
});

test("a card's words, and the chains the detail strip names both ways", () => {
  assert.match(cardWords(idOf("sanctuary")), /^Sanctuary/);
  assert.equal(cardWords(-1), "a card");
  assert.deepEqual(chainsFrom(CARDS[idOf("agora")]), ["East Road", "West Road"]);
  assert.deepEqual(chainsTo(CARDS[idOf("shrine")]), ["Sanctuary"]);
  assert.deepEqual(chainsTo(CARDS[idOf("weavers-hall")]), [], "the grey cards chain to nothing");
  assert.equal(stageWords(WONDERS[0].sides.A[1], 1), "Stage II: 2 shields. Costs 3 clay.");
});

test("payments and purchases name who gets the coins", () => {
  const names = { left: "Ana", right: "Ben" };
  assert.equal(payWords({ left: 2, right: 1 }, names), "Pay 2 to Ana, 1 to Ben");
  assert.equal(payWords({ bank: 1, right: 2 }, names), "Pay 1 to the bank, 2 to Ben");
  assert.equal(payWords({}, names), "");
  assert.equal(buyWords({ left: counts([[1, 2]]), right: zero() }, names), "Buy 2 stone from Ana");
  assert.equal(buyWords({ left: counts([[0, 1]]), right: counts([[2, 1], [3, 1]]) }, names), "Buy 1 wood from Ana and 1 clay and 1 ore from Ben");
  assert.equal(buyWords({ left: zero(), right: zero() }, names), "");
});

test("a move carries a purchase only when something is bought", () => {
  assert.deepEqual(moveFor("build", 4, { left: zero(), right: zero() }), { build: 4 });
  assert.deepEqual(moveFor("stage", 4, { left: counts([[1, 1]]), right: zero() }), { stage: 4, buy: { left: counts([[1, 1]]), right: zero() } });
  assert.deepEqual(moveFor("build", 4, null, true), { build: 4, free: true });
  assert.deepEqual(moveFor("discard", 9), { discard: 9 });
});

test("a road makes a neighbour's raw materials cost 1 a unit on its side", () => {
  // Seat 0 holds East Road (right side); seat 2 (its right) and seat 1 (its left) sell stone.
  const st = table({ cities: [["east-road"], ["stone-cut"], ["stone-cut"]] });
  const buy = { left: counts([[1, 1]]), right: counts([[1, 1]]) };
  assert.deepEqual(sideCoins(st, 0, buy), { left: 2, right: 1 });
});

test("what a card offers: build paid or by a chain, the next stage, selling", () => {
  // Giza (stone) A: stage I costs 2 stone. Seat 0 holds a Shrine, so a Sanctuary chains.
  const st = table({ wonders: [6, 0, 4], cities: [["shrine", "stone-cut"], ["clay-bank"], ["ore-seam"]], coins: [3, 3, 3] });
  const chain = pickOptions(st, 0, idOf("sanctuary"));
  assert.equal(chain.build.ok, true);
  assert.equal(chain.build.chain, true);
  assert.equal(chain.free, false);
  assert.equal(chain.stage.ok, true, "the wonder's own stone and the Stone Cut make stage I");
  assert.equal(chain.stage.n, 0);
  assert.equal(chain.sell, DISCARD_COINS);
  // Water Channel costs 3 stone: it makes 2, and neither neighbour sells stone.
  const short = pickOptions(st, 0, idOf("water-channel"));
  assert.equal(short.build.ok, false);
  assert.equal(short.build.why, "resources");
  // Already built.
  assert.equal(pickOptions(st, 0, idOf("shrine")).build.why, "duplicate");
  // Timber Mill costs a coin: with none, it can't be afforded.
  const poor = table({ wonders: [6, 0, 4], coins: [0, 3, 3] });
  assert.equal(pickOptions(poor, 0, idOf("timber-mill")).build.why, "coins");
  assert.equal(pickOptions(poor, 0, idOf("timber-mill")).build.coins, 1);
});

test("Olympia's free build is offered for a card that would cost something", () => {
  const olympia = WONDERS.findIndex((w) => w.key === "olympia");
  const st = table({ wonders: [olympia, 0, 4], stages: [[1, 2], [], []], coins: [0, 3, 3] });
  const o = pickOptions(st, 0, idOf("water-channel"));
  assert.equal(o.build.ok, true, "the free build makes it buildable");
  assert.equal(o.free, true);
  st.freeAge[0] = 1;
  assert.equal(pickOptions(st, 0, idOf("water-channel")).free, false, "used this age");
});

test("the war in words, from your seat and for each pair", () => {
  // Three seats: 0 beats 1 (its left), loses to 2 (its right); 1 and 2 draw.
  const results = [[1, -1], [0, -1], [1, 0]];
  const name = (p) => ["you", "Ana", "Ben"][p];
  assert.equal(warWords(results, 0, 2, name), "War: you beat Ana (+3) and lost to Ben (−1)");
  assert.equal(warWords([[1, 1], [-1, 0], [0, -1]], 0, 3, name), "War: you beat Ana and Ben (+5 each)");
  assert.equal(warWords([[0, 0], [0, 0], [0, 0]], 0, 1, name), "War: you drew with Ana and Ben");
  assert.deepEqual(warPairs(results), [[0, 1, 1], [1, 2, 0], [2, 0, 1]]);
  const Name = (p) => ["You", "Ana", "Ben"][p];
  assert.equal(pairWords([0, 1, 1], 1, Name), "You beat Ana (+1)");
  assert.equal(pairWords([1, 2, 0], 3, Name), "Ana and Ben draw");
  assert.equal(pairWords([2, 0, 1], 3, Name), "Ben beats you (+5)");
});

test("the result: a win, a win on coins, a shared win", () => {
  const name = (p) => ["You", "Ana", "Ben"][p];
  const sheet = (...totals) => totals.map((total) => ({ total }));
  assert.equal(resultWords(sheet(50, 44, 42), [0], 0, name), "You win!");
  assert.equal(resultWords(sheet(40, 44, 42), [1], 0, name), "Ana wins");
  assert.equal(resultWords(sheet(44, 44, 42), [1], 0, name), "Ana wins on coins");
  assert.equal(resultWords(sheet(44, 44, 42), [0, 1], 0, name), "Shared win: you and Ana");
});

test("the table as drawn is a copy the screen can change", () => {
  const st = table({ cities: [["shrine"], [], []] });
  const view = viewOf(st);
  view.city[0].push({ slot: 1, id: 0 });
  view.coins[0] = 9;
  view.hands[1].push(5);
  assert.equal(st.city[0].length, 1);
  assert.equal(st.coins[0], 3);
  assert.equal(st.hands[1].length, 0);
});

test("seats round you, cities by colour, what a seat sells", () => {
  assert.deepEqual(seatsAround(3, 0), { left: 1, right: 2, across: -1 });
  assert.deepEqual(seatsAround(4, 1), { left: 2, right: 0, across: 3 });
  assert.deepEqual(seatsAround(4, 3), { left: 0, right: 2, across: 1 });
  const cols = cityColumns([idOf("shrine"), idOf("stone-cut"), idOf("palisade"), idOf("ore-seam")]);
  assert.equal(cols.length, 7);
  assert.deepEqual(cols[0], [idOf("stone-cut"), idOf("ore-seam")], "brown first, in the order built");
  assert.deepEqual(cols[2], [idOf("shrine")]);
  assert.deepEqual(cols[4], [idOf("palisade")]);
  // Giza's own stone, two Stone Cuts' worth counted together, a choice card, and a yellow card that isn't for sale.
  const st = table({ wonders: [6, 0, 4], cities: [["stone-cut", "riverside-grove", "caravan-yard"], [], []] });
  assert.deepEqual(sells(viewOf(st), 0).map(({ key, n }) => [key, n]), [["1", 2], ["0/2", 1]]);
});

test("the turn line and a seat's facts", () => {
  assert.equal(turnWords(2, 3), "Age II · Turn 3 of 6");
  assert.equal(turnWords(0, 0), "");
  const st = table({ cities: [["palisade", "shrine"], [], []], coins: [5, 3, 3] });
  st.tokens[0] = [1, -1];
  assert.equal(seatWords(viewOf(st), 0), "5 coins, 1 shield, war tokens +1 −1, wonder 0 of 3 stages, 2 cards built");
});

test("what a neighbour's pick means for you, in a line", () => {
  // Seat 0's left is seat 1, its right seat 2.
  const st = viewOf(table());
  const build = (p, key, bought = { left: 0, right: 0 }) => ({ type: "build", p, id: idOf(key), bought });
  assert.equal(recapWords(st, 0, build(1, "palisade")), "+1 shield on your left border");
  assert.equal(recapWords(st, 0, build(2, "ore-seam")), "now sells ore");
  assert.equal(recapWords(st, 0, build(1, "riverside-grove")), "now sells wood or clay");
  assert.equal(recapWords(st, 0, build(2, "herbalist")), "a star for their science");
  // Seat 1 buys from its left (seat 2) and its right (seat 0, you): it paid you 2.
  assert.equal(recapWords(st, 0, build(1, "town-well", { left: 0, right: 2 })), "3 points for them at the end · pays you 2 coins");
  // A road toward you, and one the other way.
  assert.equal(recapWords(st, 0, build(1, "east-road")), "buys your raw materials for 1 coin now");
  assert.equal(recapWords(st, 0, build(2, "east-road")), "buys raw materials cheaper on its other side");
  assert.equal(recapWords(st, 0, { type: "stage", p: 1, n: 0 }), "", "a stage hides its card");
  const four = viewOf(table({ wonders: [6, 0, 4, 1], cities: [[], [], [], []] }));
  assert.equal(recapWords(four, 0, build(2, "palisade")), "", "across the table: nothing to say");
});

test("your hand's caption says whose cards they are and where they go", () => {
  const st = table();
  st.age = 1;
  st.hands = [[1, 2, 3, 4, 5, 6, 7], [], []];
  const nameIn = (p) => ["you", "Ana", "Ben"][p];
  assert.equal(handCaption(st, 0, nameIn), "the 7 cards dealt to you · then to Ana ◂");
  st.round = 3;
  st.hands[0] = [1, 2, 3, 4, 5];
  assert.equal(handCaption(st, 0, nameIn), "the 5 cards Ben did not pick · then to Ana ◂");
  st.age = 2;
  assert.equal(handCaption(st, 0, nameIn), "the 5 cards Ana did not pick · then to Ben ▸");
  st.round = 6;
  st.hands[0] = [1, 2];
  assert.equal(handCaption(st, 0, nameIn), "the 2 cards Ana did not pick · the last is discarded");
});

test("war tokens after a war: each seat's left result, then its right", () => {
  assert.deepEqual(tokensAfter([[], [1], []], [[1, -1], [0, -1], [1, 0]], 2), [[3, -1], [1, -1], [3]]);
});

test("the science tracker's line: piles, points now and what the next symbol adds", () => {
  // A star and a quill: 2 points; any next symbol adds 3, and the cog completes a set (3 + 7).
  const st = table({ cities: [["herbalist", "scroll-hall"], [], []] });
  const s = scienceWords(st, 0);
  assert.deepEqual([s.counts, s.wilds, s.now], [[1, 0, 1], 0, 2]);
  assert.equal(s.line, "2 points now, the next cog adds 8");
});

test("city chips leave the brown and grey cards to the shelf; the kit the view modules take", () => {
  assert.deepEqual(CITY_COLORS, ["blue", "yellow", "red", "green", "purple"]);
  for (const k of ["resEl", "sciEl", "coinEl", "shieldEl", "pointsEl", "tokenEl", "seatMark", "cardEl", "chipEl", "boardEl"]) assert.equal(typeof kit[k], "function", k);
});

// Every data-tip the views write (its kind and its data-tip-* arguments)
// is one tips.js explains, with arguments it reads, and has words.
test("every tip the views write has words, with the arguments tipWords reads", () => {
  const files = ["art.js", "main.js", "tutorial.js", "store.js", "border.js", "war.js", "ring.js"];
  const kinds = new Set();
  const args = new Map();
  const note = (arg, file) => args.set(arg, [...(args.get(arg) ?? []), file]);
  for (const file of files) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/"data-tip": "(\w+)"|data-tip="(\w+)"|\btip: "(\w+)"|\btip\("(\w+)"/g)) kinds.add(m[1] ?? m[2] ?? m[3] ?? m[4]);
    for (const m of src.matchAll(/"?data-tip-([a-z]+)"?[:=]/g)) note(m[1], file);
    for (const m of src.matchAll(/\btip([A-Z][a-z]+)\b(?=\s*[:=])/g)) note(m[1].toLowerCase(), file);
    for (const m of src.matchAll(/\btip\("\w+", \{([^}]*)\}/g)) for (const part of m[1].split(",")) if (/^\s*\w+\s*(:|$)/.test(part)) note(part.split(":")[0].trim(), file);
  }
  for (const kind of kinds) assert.ok(TIP_KINDS.includes(kind), `${kind} is a tip kind`);
  const READ = ["seat", "id", "where", "res", "stage", "age", "count", "side", "results", "kind", "source", "bank"];
  // Written for the ring's own drawing, and read by no tip.
  const CONTEXT = ["round", "dir"];
  for (const [arg, where] of args) assert.ok(READ.includes(arg) || CONTEXT.includes(arg), `data-tip-${arg} (${[...new Set(where)].join(", ")}) is an argument tipWords reads`);
  // Each kind, with the arguments the views give it, has words.
  const st = viewOf(table({ cities: [["stone-cut", "riverside-grove", "palisade", "herbalist"], ["ore-seam"], ["clay-bank"]] }));
  st.round = 2;
  st.hands = [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], [13, 14, 15, 16, 17, 18]];
  const ctx = { state: st, me: 0, nameOf: (p) => ["You", "Ana", "Ben"][p] };
  const samples = {
    coins: [{ seat: "1" }, { seat: "0" }],
    shields: [{ seat: "2" }],
    tokens: [{ seat: "0" }, {}],
    stages: [{ seat: "1" }],
    counts: [{ seat: "1" }],
    sells: [{ side: "left" }, { side: "right" }],
    card: [{ id: String(idOf("palisade")), seat: "0" }, { id: String(idOf("shrine")), where: "hand" }, { id: String(idOf("shrine")), where: "dig" }],
    back: [{ seat: "1", where: "stack", count: "6" }, { seat: "2", where: "pick" }],
    slot: [{ seat: "0", stage: "0" }],
    make: [{ res: "0" }, { res: "1", seat: "0" }, { res: "3", seat: "1" }],
    either: [{ seat: "0", res: "0,2", source: "Riverside Grove" }, { res: "0,2", source: "Riverside Grove" }],
    price: [{ res: "3", side: "left" }, { side: "right" }],
    crossing: [{ side: "left" }],
    flags: [{ side: "left", results: "1,-1," }, { side: "right", results: ",," }],
    warn: [{ side: "right" }],
    wall: [{ side: "left", bank: "theirs" }, { side: "left", bank: "mine" }],
    seat: [{ seat: "0" }, { seat: "1" }],
    direction: [{ age: "2", dir: "-1" }],
    turn: [{ age: "1", round: "2" }],
    bank: [{}],
    discard: [{}],
    badge: [{ id: String(idOf("shrine")), kind: "free" }, { kind: "pay" }],
    science: [{ seat: "0" }],
    score: [{ seat: "0" }, { seat: "2" }],
    hand: [{}, { count: "6" }],
  };
  for (const kind of TIP_KINDS) assert.ok(samples[kind], `a sample for ${kind}`);
  for (const [kind, list] of Object.entries(samples)) {
    for (const a of list) {
      const w = tipWords(kind, a, ctx);
      assert.ok(w?.title && w?.body, `${kind} ${JSON.stringify(a)} has words`);
    }
  }
  // The wall on your own bank is yours; theirs is the neighbour's. A border's sells are the neighbour's.
  assert.match(tipWords("wall", { side: "left", bank: "mine" }, ctx).body, /^1 shield/);
  assert.match(tipWords("wall", { side: "left", bank: "theirs" }, ctx).body, /no shields/);
  assert.match(tipWords("sells", { side: "right" }, ctx).body, /clay: what Ben's/);
});
