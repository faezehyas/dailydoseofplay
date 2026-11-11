// The storehouse's facts without a DOM: shelves for every wonder and the
// choice producers, what neighbours may buy, cost matching that agrees with
// the rules' purchases, the badges and the words under a match.
import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { CARDS, WONDERS, WOOD, STONE, CLAY, ORE, GLASS, CLOTH, PAPYRUS } from "./cards.js";
import { production, purchases, canBuild, canStage, covers, unitPrice, leftOf, rightOf } from "./rules.js";
import { pickOptions } from "./art.js";
import { shelfOf, saleOf, shelfWords, matchCost, highlightOf, matchWords, badgeOf } from "./store.js";

const W = (key) => WONDERS.findIndex((w) => w.key === key);
const ID = (key, age) => CARDS.find((c) => c.key === key && (age === undefined || c.age === age)).id;
// 7 counts from { resource: n }.
const res = (o = {}) => [WOOD, STONE, CLAY, ORE, GLASS, CLOTH, PAPYRUS].map((r) => o[r] ?? 0);
const names = { left: "Robot 1", right: "Robot 3" };

// A table as the rules read it: wonders as [key, side] by seat, cities by
// card key (or id), stages built, coins.
function table({ wonders = [["giza"], ["rhodes"], ["olympia"]], cities, stages, coins, age = 2 } = {}) {
  const n = wonders.length;
  return {
    players: n,
    age,
    round: 1,
    phase: "pick",
    wonders: wonders.map(([key, side = "A"]) => ({ w: W(key), side })),
    hands: Array.from({ length: n }, () => []),
    city: (cities ?? Array.from({ length: n }, () => [])).map((keys) => keys.map((k, i) => ({ slot: 100 + i, id: typeof k === "number" ? k : ID(k) }))),
    stages: (stages ?? Array(n).fill(0)).map((k) => Array.from({ length: k }, (_, i) => 200 + i)),
    coins: coins ?? Array(n).fill(3),
    tokens: Array.from({ length: n }, () => []),
    discard: [],
    freeAge: Array(n).fill(0),
    digger: -1,
    lastSeat: -1,
    picks: Array(n).fill(null),
  };
}
const options = (st, p, key) => ({ ...pickOptions(st, p, ID(key)), id: ID(key), card: CARDS[ID(key)] });

test("a shelf counts what each wonder makes and names it", () => {
  for (const [w, wonder] of WONDERS.entries()) {
    const st = table({ wonders: [0, 1, 2].map((i) => [WONDERS[(w + i) % WONDERS.length].key]) });
    const shelf = shelfOf(st, 0);
    assert.equal(shelf.wonder, wonder.produce);
    assert.equal(shelf.fixed.reduce((a, b) => a + b), 1);
    assert.equal(shelf.fixed[wonder.produce], 1);
    assert.deepEqual(shelf.sources[wonder.produce], ["your wonder"]);
    assert.deepEqual(shelf.either, []);
    assert.equal(saleOf(st, 0).fixed[wonder.produce], 1, "neighbours may buy the wonder's own resource");
    assert.deepEqual(shelfOf(st, 0, 1).sources[wonder.produce], [wonder.name], "another seat sees the wonder's name");
  }
});

test("a typical city: counts add up, sources are named once, doubles count twice", () => {
  const st = table({ cities: [["woodcutters-camp", "timber-mill", "stone-cut", "glass-kiln", "dig-site", "palisade"], [], []] });
  const shelf = shelfOf(st, 0);
  assert.deepEqual(shelf.fixed, res({ [WOOD]: 3, [STONE]: 2, [GLASS]: 1 }));
  assert.deepEqual(shelf.sources[WOOD], ["Woodcutter's Camp", "Timber Mill"]);
  assert.deepEqual(shelf.sources[STONE], ["your wonder", "Stone Cut"]);
  assert.deepEqual(shelf.sources[CLAY], []);
  assert.deepEqual(shelf.either, [{ options: [STONE, CLAY], source: "Dig Site", sale: true }]);
  assert.equal(shelfWords(shelf), "3 wood (Woodcutter's Camp and Timber Mill), 2 stone (your wonder and Stone Cut), 1 glass (Glass Kiln) and stone or clay (Dig Site)");
  assert.equal(shelfWords(shelfOf(table(), 1), { sources: false }), "1 ore");
});

test("every choice producer becomes an either token, and only brown ones are for sale", () => {
  const brown = ["riverside-grove", "dig-site", "red-hollow", "hillside-clearing", "forest-mine", "rock-shaft"];
  const st = table({ cities: [[...brown, "agora", "caravan-yard"], [], []] });
  const shelf = shelfOf(st, 0);
  assert.equal(shelf.either.length, 8);
  for (const [i, key] of brown.entries()) {
    assert.deepEqual(shelf.either[i].options, CARDS[ID(key)].produce[0]);
    assert.equal(shelf.either[i].sale, true);
  }
  assert.deepEqual(shelf.either[6], { options: [GLASS, CLOTH, PAPYRUS], source: "Agora", sale: false });
  assert.deepEqual(shelf.either[7], { options: [WOOD, STONE, CLAY, ORE], source: "Caravan Yard", sale: false });
  const sale = saleOf(st, 0);
  assert.equal(sale.either.length, 6);
  assert.ok(sale.either.every((e) => e.sale));
});

test("wonder stages that make resources sit on the shelf but are never for sale", () => {
  const a = table({ wonders: [["alexandria", "A"], ["rhodes"], ["giza"]], stages: [2, 0, 0] });
  assert.deepEqual(shelfOf(a, 0).either, [{ options: [WOOD, STONE, CLAY, ORE], source: "wonder stage II", sale: false }]);
  assert.deepEqual(saleOf(a, 0).either, []);
  const b = table({ wonders: [["alexandria", "B"], ["rhodes"], ["giza"]], stages: [2, 0, 0] });
  assert.deepEqual(
    shelfOf(b, 0).either.map((e) => [e.options, e.source]),
    [
      [[WOOD, STONE, CLAY, ORE], "wonder stage I"],
      [[GLASS, CLOTH, PAPYRUS], "wonder stage II"],
    ],
  );
  assert.equal(shelfOf(b, 0, 2).either[0].source, "Lighthouse of Alexandria stage I");
});

// A random position: random wonders and sides, cities of unique cards with
// plenty of producers, some stages, some coins.
function randomTable(rng, players) {
  const pick = (xs) => xs[Math.floor(rng() * xs.length)];
  const order = [...WONDERS.keys()].sort(() => rng() - 0.5).slice(0, players);
  const st = table({ wonders: order.map((w) => [WONDERS[w].key, rng() < 0.5 ? "A" : "B"]) });
  const makers = CARDS.filter((c) => c.produce);
  st.city = st.city.map(() => {
    const keys = new Set();
    const out = [];
    const n = Math.floor(rng() * 9);
    for (let i = 0; i < n; i++) {
      const c = rng() < 0.75 ? pick(makers) : pick(CARDS);
      if (keys.has(c.key)) continue;
      keys.add(c.key);
      out.push({ slot: out.length, id: c.id });
    }
    return out;
  });
  st.stages = st.wonders.map(({ w, side }) => Array.from({ length: Math.floor(rng() * (WONDERS[w].sides[side].length + 1)) }, (_, i) => i));
  st.coins = st.coins.map(() => Math.floor(rng() * 12));
  return st;
}
const randomCost = (rng) => {
  if (rng() < 0.6) return CARDS[Math.floor(rng() * CARDS.length)].cost.res;
  return res().map(() => (rng() < 0.35 ? Math.floor(rng() * 3) : 0));
};

test("a shelf holds exactly the units the rules count, own and for sale", () => {
  const rng = rngFromSeed("shelf");
  const flat = (shelf) => [...shelf.fixed.flatMap((n, r) => Array(n).fill(String(r))), ...shelf.either.map((e) => e.options.join("/"))].sort();
  for (let i = 0; i < 200; i++) {
    const st = randomTable(rng, 3 + (i % 2));
    for (let p = 0; p < st.players; p++) {
      const { own, sale } = production(st, p);
      assert.deepEqual(flat(shelfOf(st, p)), own.map((u) => u.join("/")).sort());
      assert.deepEqual(flat(saleOf(st, p)), sale.map((u) => u.join("/")).sort());
    }
  }
});

// Each own unit of the shelf is used at most once, and on a resource it makes.
function checkAssignment(st, p, units) {
  const shelf = shelfOf(st, p);
  const per = res();
  const used = new Set();
  for (const u of units) {
    if (u.how === "own") {
      per[u.r]++;
      assert.ok(shelf.sources[u.r].includes(u.source));
    }
    if (u.how === "either") {
      assert.ok(!used.has(u.either), "an either token is used once");
      used.add(u.either);
      assert.ok(shelf.either[u.either].options.includes(u.r));
      assert.equal(shelf.either[u.either].source, u.source);
    }
  }
  per.forEach((n, r) => assert.ok(n <= shelf.fixed[r]));
}

test("matchCost agrees with purchases(): a working purchase leaves nothing missing", () => {
  const rng = rngFromSeed("match");
  let checked = 0;
  let partial = 0;
  for (let i = 0; i < 400; i++) {
    const st = randomTable(rng, 3 + (i % 2));
    const p = Math.floor(rng() * st.players);
    const cost = randomCost(rng);
    const all = purchases(st, p, cost);
    for (const buy of all) {
      const units = matchCost(st, p, cost, buy);
      assert.equal(units.length, cost.reduce((a, b) => a + b));
      assert.ok(!units.some((u) => u.how === "missing"), `missing with a working purchase`);
      for (const side of ["left", "right"]) {
        const got = res();
        for (const u of units.filter((x) => x.how === "buy" && x.side === side)) {
          got[u.r]++;
          assert.equal(u.coins, unitPrice(st, p, u.r, side));
        }
        assert.deepEqual(got, buy[side]);
      }
      assert.equal(units.filter((u) => u.how === "buy").reduce((a, u) => a + u.coins, 0), buy.coins);
      checkAssignment(st, p, units);
      checked++;
    }
    // Without a purchase: the shelf covers the most it can.
    const units = matchCost(st, p, cost, null);
    checkAssignment(st, p, units);
    const mine = units.filter((u) => u.how === "own" || u.how === "either").length;
    const own = production(st, p).own;
    if (all.length) {
      assert.ok(units.filter((u) => u.how === "missing").every((u) => u.side), "a buyable cost names a seller for every missing unit");
      assert.equal(units.filter((u) => u.how === "missing").length, all[0].left.concat(all[0].right).reduce((a, b) => a + b), "as many missing as the cheapest purchase buys");
    }
    if (covers(own, cost)) assert.equal(mine, units.length);
    else partial++;
    // Missing units with a seller never ask a neighbour for more than they make.
    for (const side of ["left", "right"]) {
      const asked = res();
      for (const u of units.filter((x) => x.side === side)) asked[u.r]++;
      assert.ok(covers(production(st, side === "left" ? leftOf(st, p) : rightOf(st, p)).sale, asked));
    }
  }
  assert.ok(checked > 200, `checked ${checked} purchases`);
  assert.ok(partial > 50);
});

test("matchCost: the mock-up's Water Channel and Infirmary", () => {
  // Giza with Dig Site; Robot 3 (right) sells stone, Robot 1 (left) sells one ore.
  const st = table({ wonders: [["giza"], ["rhodes"], ["olympia"]], cities: [["woodcutters-camp", "dig-site", "shrine"], [], ["stone-cut"]] });
  const cost = CARDS[ID("water-channel")].cost;
  const buy = purchases(st, 0, cost)[0];
  const units = matchCost(st, 0, cost, buy);
  assert.deepEqual(units, [
    { r: STONE, how: "own", source: "your wonder" },
    { r: STONE, how: "either", source: "Dig Site", either: 0, options: [STONE, CLAY] },
    { r: STONE, how: "buy", side: "right", coins: 2 },
  ]);
  assert.deepEqual(highlightOf(units), { use: [STONE, "e0"], buy: [STONE], need: [] });
  assert.equal(matchWords(units, names), "You make 2 of the 3 stone. Robot 3 sells the third for 2 coins.");

  const inf = matchCost(st, 0, CARDS[ID("infirmary")].cost, null);
  assert.deepEqual(inf, [
    { r: ORE, how: "missing", side: "left", coins: 2 },
    { r: ORE, how: "missing" },
    { r: GLASS, how: "missing" },
  ]);
  assert.deepEqual(highlightOf(inf), { use: [], buy: [], need: [ORE, GLASS] });
  assert.equal(matchWords(inf, names), "You make no ore or glass. Robot 1 sells one ore for 2 coins. Nobody near you sells a second ore or glass.");
});

test("matchCost: an either token goes where nobody sells, so what stays missing can be bought", () => {
  // Own: Dig Site (stone or clay). Cost: stone and clay. Only the left neighbour sells clay.
  const st = table({ wonders: [["rhodes"], ["babylon"], ["olympia"]], cities: [["dig-site"], [], []] });
  const units = matchCost(st, 0, res({ [STONE]: 1, [CLAY]: 1 }), null);
  assert.deepEqual(units, [
    { r: STONE, how: "either", source: "Dig Site", either: 0, options: [STONE, CLAY] },
    { r: CLAY, how: "missing", side: "left", coins: 2 },
  ]);
  // With West Road the left price is 1.
  const road = table({ wonders: [["rhodes"], ["babylon"], ["olympia"]], cities: [["dig-site", "west-road"], [], []] });
  assert.equal(matchCost(road, 0, res({ [CLAY]: 2 }), null)[1].coins, 1);
});

test("badges: make, free, chain, wonder, pay and can't", () => {
  const st = table({
    wonders: [["olympia", "A"], ["rhodes"], ["giza"]],
    cities: [["woodcutters-camp", "shrine", "stone-cut"], [], []],
    stages: [2, 0, 0],
    coins: [4, 3, 3],
  });
  assert.deepEqual(badgeOf(options(st, 0, "palisade")), { id: ID("palisade"), kind: "make", coins: 0, label: "You make it" });
  assert.deepEqual(badgeOf(options(st, 0, "town-well")), { id: ID("town-well"), kind: "free", coins: 0, label: "Free" });
  assert.deepEqual(badgeOf(options(st, 0, "sanctuary")), { id: ID("sanctuary"), kind: "chain", coins: 0, label: "Chain · free" });
  assert.deepEqual(badgeOf(options(st, 0, "guard-post")), { id: ID("guard-post"), kind: "pay", coins: 2, label: "2 coins" }, "ore from Rhodes");
  assert.deepEqual(badgeOf(options(st, 0, "riverside-grove")), { id: ID("riverside-grove"), kind: "pay", coins: 1, label: "1 coin" }, "bank coins count");
  assert.equal(badgeOf(options(st, 0, "shrine")).kind, "no");
  assert.equal(badgeOf(options(st, 0, "shrine")).label, "Already built");
  // Glass nobody sells: only the free build (Olympia A stage II) can build it.
  assert.deepEqual(badgeOf(options(st, 0, "tinkers-shed")), { id: ID("tinkers-shed"), kind: "wonder", coins: 0, label: "Wonder · free" });
  const used = { ...st, freeAge: [2, 0, 0] };
  assert.deepEqual(badgeOf(options(used, 0, "tinkers-shed")), { id: ID("tinkers-shed"), kind: "no", coins: 0, label: "Can't build", why: "resources", reason: "You and your neighbours can't make what it needs." });
  const poor = { ...used, coins: [1, 3, 3] };
  assert.equal(badgeOf(options(poor, 0, "guard-post")).why, "coins");
  assert.equal(badgeOf({ build: canBuild(poor, 0, ID("guard-post")), id: ID("guard-post") }).label, "Can't build", "works from an id too");
});

test("pay badges show the cheapest purchase, bank coins added", () => {
  const rng = rngFromSeed("badges");
  for (let i = 0; i < 300; i++) {
    const st = randomTable(rng, 3);
    const id = Math.floor(rng() * CARDS.length);
    const o = { ...pickOptions(st, 0, id), id, card: CARDS[id] };
    const b = badgeOf(o);
    const can = canBuild(st, 0, id);
    if (b.kind === "pay") assert.equal(b.coins, Math.min(...can.purchases.map((x) => x.coins)) + CARDS[id].cost.coins);
    if (b.kind === "no") assert.ok(!can.ok);
    if (["make", "free", "chain", "pay"].includes(b.kind)) assert.ok(can.ok);
    if (b.kind === "wonder") assert.ok(can.free && !can.purchases.length && !can.chain);
  }
});

test("a stage cost matches against the shelf like a card's", () => {
  const st = table({ wonders: [["giza", "A"], ["rhodes"], ["olympia"]], cities: [["stone-cut"], [], []] });
  const s = canStage(st, 0);
  const units = matchCost(st, 0, WONDERS[W("giza")].sides.A[0].cost, s.purchases[0]);
  assert.deepEqual(units.map((u) => u.how), ["own", "own"]);
  assert.equal(matchWords(units, names), "You make everything it needs.");
});

test("match words", () => {
  const own = (r, source = "your wonder") => ({ r, how: "own", source });
  const buy = (r, side, coins = 2) => ({ r, how: "buy", side, coins });
  assert.equal(matchWords([own(STONE)], names), "You make everything it needs.");
  assert.equal(matchWords([buy(ORE, "left")], names), "You make no ore. Robot 1 sells ore for 2 coins.");
  assert.equal(matchWords([buy(ORE, "left", 1), buy(ORE, "left", 1)], names), "You make no ore. Robot 1 sells 2 ore for 2 coins.");
  assert.equal(matchWords([own(STONE), buy(STONE, "left"), buy(STONE, "right", 1)], names), "You make 1 of the 3 stone. Robot 1 sells the second for 2 coins. Robot 3 sells the third for 1 coin.");
  assert.equal(matchWords([own(STONE), buy(STONE, "left"), buy(STONE, "left")], names), "You make 1 of the 3 stone. Robot 1 sells the other 2 for 4 coins.");
  assert.equal(matchWords([own(WOOD), buy(CLAY, "right"), buy(GLASS, "right")], names), "You make the wood. You make no clay or glass. Robot 3 sells 1 clay and 1 glass for 4 coins.");
  assert.equal(matchWords([buy(ORE, "left"), buy(ORE, "right")], names), "You make no ore. Robot 1 sells one ore for 2 coins. Robot 3 sells the second for 2 coins.");
  assert.equal(matchWords([{ r: GLASS, how: "missing" }], names), "You make no glass. Nobody near you sells glass.");
  assert.equal(matchWords([], names, { bank: 1 }), "It costs 1 coin, paid to the bank.");
  assert.equal(matchWords([], names), "");
});
