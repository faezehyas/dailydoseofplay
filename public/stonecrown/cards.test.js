import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, WONDERS, GUILDS, COLORS, RESOURCES, SYMBOLS, MIN_PLAYERS, MAX_PLAYERS, HAND, ageCards, deckFor, deckRanges, guildCount } from "./cards.js";

const players = [...Array(MAX_PLAYERS - MIN_PLAYERS + 1)].map((_, i) => MIN_PLAYERS + i);

test("each age deals seven cards a player, age III counting players + 2 guilds", () => {
  for (const n of players) {
    assert.equal(ageCards(1, n).length, HAND * n);
    assert.equal(ageCards(2, n).length, HAND * n);
    assert.equal(ageCards(3, n).length + guildCount(n), HAND * n);
  }
  assert.equal(GUILDS.length, 10);
});

test("the deck fits the engine and its ranges cover it", () => {
  for (const n of players) {
    const deck = deckFor(n);
    assert.ok(deck.length <= 200);
    const { ages, guilds } = deckRanges(n);
    assert.equal(ages[0][0], 0);
    assert.equal(ages[1][0], ages[0][1]);
    assert.equal(ages[2][0], ages[1][1]);
    assert.equal(guilds[0], ages[2][1]);
    assert.equal(guilds[1], deck.length);
    ages.forEach(([a, b], i) => deck.slice(a, b).forEach((id) => assert.equal(CARDS[id].age, i + 1)));
    deck.slice(...guilds).forEach((id) => assert.equal(CARDS[id].color, "purple"));
  }
  assert.equal(deckFor(7).length, 148);
});

test("a player count adds seven cards to each age", () => {
  for (const n of players.slice(1)) for (const age of [1, 2, 3]) assert.equal(ageCards(age, n).length - ageCards(age, n - 1).length, age === 3 ? HAND - 1 : HAND);
});

test("every card is well formed, with one effect kind and free builds from an earlier age", () => {
  const byKey = new Map();
  for (const c of CARDS) {
    assert.ok(COLORS.includes(c.color));
    assert.ok(c.name && /^[a-z-]+$/.test(c.key));
    assert.equal(c.cost.res.length, RESOURCES.length);
    assert.ok(c.cost.res.every((n) => Number.isInteger(n) && n >= 0));
    const kinds = ["produce", "points", "shields", "science", "gold", "trade", "income", "score"].filter((k) => k in c);
    assert.ok(kinds.length === 1 || (c.color === "yellow" && kinds.join() === "income,score"), c.name);
    if (c.science !== undefined) assert.ok(c.science === "any" || (c.science >= 0 && c.science < SYMBOLS.length));
    if (c.produce) assert.ok(c.produce.every((u) => u.length && u.every((r) => RESOURCES.includes(r))));
    for (const k of c.from) {
      const earlier = CARDS.filter((o) => o.key === k);
      assert.ok(earlier.length && earlier.every((o) => o.age < c.age), `${c.name} from ${k}`);
    }
    if (byKey.has(c.key)) {
      const o = byKey.get(c.key);
      assert.equal(o.name, c.name);
      assert.equal(o.color, "grey");
    }
    byKey.set(c.key, c);
  }
  assert.equal(new Set(CARDS.map((c) => c.name)).size, byKey.size);
});

test("seven wonders, each with a side A of three stages and a side B", () => {
  assert.equal(WONDERS.length, 7);
  assert.equal(new Set(WONDERS.map((w) => w.produce)).size, 7);
  for (const w of WONDERS) {
    assert.equal(w.sides.A.length, 3);
    assert.ok(w.sides.B.length >= 2 && w.sides.B.length <= 4);
    for (const s of [...w.sides.A, ...w.sides.B]) assert.ok(s.cost.res.some((n) => n > 0));
  }
});
