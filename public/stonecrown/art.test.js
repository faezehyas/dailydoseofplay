// What the view shares with the tutorial, without a DOM: the words a screen
// reader hears for cards, costs, purchases, wars and results, the choices a
// card in your hand offers, and the table's layout helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, WONDERS, DISCARD_COINS } from "./cards.js";
import { sideCoins } from "./rules.js";
import { costWords, effectWords, cardWords, chainsFrom, chainsTo, stageWords, payWords, buyWords, moveFor, pickOptions, warWords, warPairs, pairWords, resultWords, viewOf, seatsAround, cityColumns, sells, turnWords, seatWords } from "./art.js";

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
