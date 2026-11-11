// The war scene's facts and words, without a DOM: who stands at each of your
// borders with how many shields and from which cards, what each border is
// worth, your tokens this age and so far, and how the other borders went.
import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, VICTORY } from "./cards.js";
import { shields, leftOf, rightOf } from "./rules.js";
import { warFacts, warSummary, elsewhereWords, sumWords, shieldSources } from "./war.js";

const idOf = (key) => CARDS.find((c) => c.key === key).id;
const names = ["Ana", "Ben", "Cal", "Dee"];
const nameOf = (p) => names[p];

// A table: wonders by index (all side A), cities by card key, stages built, tokens from earlier ages.
function table({ wonders = [6, 0, 4], cities = null, stages = null, tokens = null } = {}) {
  const n = wonders.length;
  const seats = () => Array.from({ length: n }, () => []);
  return {
    players: n,
    age: 1,
    wonders: wonders.map((w) => ({ w, side: "A" })),
    city: (cities ?? seats()).map((keys) => keys.map((k, i) => ({ slot: 100 + i, id: idOf(k) }))),
    stages: stages ?? seats(),
    tokens: tokens ?? seats(),
    coins: Array(n).fill(3),
  };
}

// The rules' war: each seat against its left and right neighbour, tokens added.
function fight(state, age) {
  const s = state.wonders.map((_, p) => shields(state, p));
  const results = s.map((v, p) => [Math.sign(v - s[leftOf(state, p)]), Math.sign(v - s[rightOf(state, p)])]);
  results.forEach((rs, p) => rs.forEach((r) => r && state.tokens[p].push(r > 0 ? VICTORY[age - 1] : -1)));
  return results;
}

test("three players: a loss and a win in age II, sources named", () => {
  // Seat 0 (Rhodes, stage II built: 2 shields) has a Watchtower; Ana's left is Ben (1), right Cal (2).
  const st = table({
    wonders: [0, 6, 4],
    cities: [["watchtower"], ["ramparts", "horse-paddock"], []],
    stages: [[200, 201], [], []],
    tokens: [[1], [-1], [1]],
  });
  const results = fight(st, 2);
  const f = warFacts(st, results, 0, 2);
  assert.equal(f.age, 2);
  assert.deepEqual(f.stakes, { win: 3, loss: -1 });
  assert.deepEqual(f.mine, { p: 0, shields: 3, from: ["Watchtower", "Wonder stage II"], parts: [{ name: "Watchtower", shields: 1 }, { name: "Wonder stage II", shields: 2 }] });
  assert.equal(f.left.p, 1);
  assert.equal(f.left.shields, 4);
  assert.deepEqual(f.left.from, ["Ramparts", "Horse Paddock"]);
  assert.equal(f.left.result, -1);
  assert.equal(f.right.p, 2);
  assert.equal(f.right.shields, 0);
  assert.deepEqual(f.right.from, []);
  assert.equal(f.right.result, 1);
  assert.deepEqual(f.gained, [-1, 3]);
  assert.deepEqual(f.total, { tokens: [1, -1, 3], points: 3 });
  // With three players the only other border is between your two neighbours.
  assert.deepEqual(f.elsewhere, [[1, 2, 1]]);
  assert.equal(warSummary(f, nameOf), "War: you lost to Ben (−1) and beat Cal (+3)");
  assert.equal(elsewhereWords(f.elsewhere, nameOf), "Ben beat Cal");
});

test("each age's win is worth its token: +1, +3, +5", () => {
  for (const age of [1, 2, 3]) {
    const st = table({ cities: [["guard-post"], [], []] });
    const f = warFacts(st, fight(st, age), 0, age);
    assert.equal(f.stakes.win, VICTORY[age - 1]);
    assert.deepEqual(f.gained, [VICTORY[age - 1], VICTORY[age - 1]]);
    assert.deepEqual(f.total, { tokens: [VICTORY[age - 1], VICTORY[age - 1]], points: 2 * VICTORY[age - 1] });
    assert.equal(warSummary(f, nameOf), `War: you beat Ben and Cal (+${VICTORY[age - 1]} each)`);
    // Ben and Cal both have none: their border is a draw.
    assert.deepEqual(f.elsewhere, [[1, 2, 0]]);
    assert.equal(elsewhereWords(f.elsewhere, nameOf), "Ben and Cal drew");
  }
});

test("draws give no token and losses −1 in every age", () => {
  for (const age of [1, 2, 3]) {
    const st = table();
    const f = warFacts(st, fight(st, age), 0, age);
    assert.deepEqual([f.left.result, f.right.result], [0, 0]);
    assert.deepEqual(f.gained, []);
    assert.deepEqual(f.total, { tokens: [], points: 0 });
    assert.equal(warSummary(f, nameOf), "War: you drew with Ben and Cal");

    const lost = table({ cities: [[], ["palisade"], ["watchtower"]] });
    const g = warFacts(lost, fight(lost, age), 0, age);
    assert.deepEqual(g.gained, [-1, -1]);
    assert.equal(g.total.points, -2);
    assert.equal(warSummary(g, nameOf), "War: you lost to Ben and Cal (−1 each)");
  }
});

test("four players: across is elsewhere, both other borders listed", () => {
  // You (0) 2 shields, Ben (1, left) 3, Cal (2, across) 5, Dee (3, right) 2.
  const st = table({
    wonders: [6, 4, 2, 5],
    cities: [["ramparts"], ["ramparts", "palisade"], ["bastions", "drill-field"], ["bow-yard"]],
    tokens: [[1], [], [], []],
  });
  const results = fight(st, 3);
  const f = warFacts(st, results, 0, 3);
  assert.deepEqual([f.left.p, f.left.shields, f.left.result], [1, 3, -1]);
  assert.deepEqual([f.right.p, f.right.shields, f.right.result], [3, 2, 0]);
  assert.deepEqual(f.mine.from, ["Ramparts"]);
  assert.deepEqual(f.gained, [-1]);
  assert.deepEqual(f.total, { tokens: [1, -1], points: 0 });
  assert.deepEqual(f.elsewhere, [[1, 2, -1], [2, 3, 1]]);
  assert.equal(warSummary(f, nameOf), "War: you lost to Ben (−1) and drew with Dee");
  assert.equal(elsewhereWords(f.elsewhere, nameOf), "Cal beat Ben and Dee");
  // From Cal's seat (2): left is Dee, right Ben.
  const c = warFacts(st, results, 2, 3);
  assert.deepEqual([c.left.p, c.right.p], [3, 1]);
  assert.deepEqual(c.gained, [5, 5]);
  assert.deepEqual(c.total, { tokens: [5, 5], points: 10 });
  assert.deepEqual(c.elsewhere, [[0, 1, -1], [3, 0, 0]]);
  assert.equal(elsewhereWords(c.elsewhere, nameOf), "Ben beat Ana; Dee and Ana drew");
});

test("the total counts every token so far, the age's own from the results", () => {
  const st = table({ cities: [["watchtower"], ["palisade", "guard-post"], []], tokens: [[1, -1], [1], [-1, -1]] });
  const f = warFacts(st, fight(st, 2), 0, 2);
  assert.deepEqual(f.gained, [-1, 3]);
  assert.deepEqual(f.total.tokens, [1, -1, -1, 3]);
  assert.equal(f.total.points, 2);
});

test("shields from cards and wonder stages, in that order", () => {
  // Rhodes side B: both stages give a shield.
  const st = table({ wonders: [0, 6, 4], cities: [["siege-yard", "palisade"], [], []], stages: [[1, 2], [], []] });
  st.wonders[0].side = "B";
  assert.deepEqual(shieldSources(st, 0), [
    { name: "Siege Yard", shields: 3 },
    { name: "Palisade", shields: 1 },
    { name: "Wonder stage I", shields: 1 },
    { name: "Wonder stage II", shields: 1 },
  ]);
  assert.equal(warFacts(st, fight(st, 3), 0, 3).mine.shields, 6);
});

test("words for the sums and the other borders", () => {
  assert.equal(sumWords([]), "no tokens");
  assert.equal(sumWords([3]), "+3 points");
  assert.equal(sumWords([-1]), "−1 point");
  assert.equal(sumWords([-1, 3]), "−1 + 3 = +2 points");
  assert.equal(sumWords([1, 1, -1, 3]), "1 + 1 − 1 + 3 = +4 points");
  assert.equal(sumWords([-1, -1]), "−1 − 1 = −2 points");
  assert.equal(elsewhereWords([], nameOf), "");
  assert.equal(elsewhereWords([[1, 2, 1], [2, 3, -1], [3, 0, 0]], nameOf), "Ben beat Cal; Dee beat Cal; Dee and Ana drew");
  assert.equal(elsewhereWords([[1, 2, -1], [2, 3, 1]], nameOf), "Cal beat Ben and Dee");
});
