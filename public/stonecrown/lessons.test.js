// Every step of Stonecrown's tutorial asks for a pick that rules.js allows
// in the step's position, and Teal's and Violet's picks that turn are legal
// too, whichever of the accepted picks you make, so a lesson can't teach a
// wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells, result } from "./tutorial.js";
import { card, PLAYERS } from "./lessons.js";
import { CARDS } from "./cards.js";
import { deckOf, movers, canBuild, canStage, score, shields, purchases } from "./rules.js";

const NAMED = new Set(["build", "stage", "sell", "detail", "board", "city", "coins", "shields", "tokens", "age", "pass", "shelf", "science", "pile", "picks", "total"]);
// A cell the board has in this state: a card in your hand, a card in your city, a neighbour, or one of the named parts.
function isCell(state, c) {
  const m = /^(card|chip|seat|sells)-(\d+)$/.exec(c);
  if (!m) return NAMED.has(c);
  const n = Number(m[2]);
  if (m[1] === "card") return state.hands[0].includes(n);
  if (m[1] === "chip") return state.city[0].some((x) => x.id === n);
  return n === 1 || n === 2;
}
const yourPick = (state) => state.winner === -1 && movers(state).includes(0) && state.picks[0] === null;
const design = (slot) => CARDS[deckOf(PLAYERS)[slot]];

test("Stonecrown has 3 to 6 lessons of 1 to 4 steps, each with text, and every step's others pick for Teal and Violet", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    assert.ok(steps[0].position, `${title} starts from a position`);
    for (const step of steps) {
      assert.ok(step.text && step.text.split(" ").length <= 40, `${title}: every step has a short text`);
      assert.equal(step.others?.length, 2, `${title}: Teal and Violet pick too`);
    }
  }
});

test("every position deals each card once, and every expected pick and the others' picks are legal", () => {
  for (const { title, steps } of lessons) {
    let state = null;
    steps.forEach((step, k) => {
      const where = `${title}, step ${k + 1}`;
      if (step.position) {
        state = load(step.position);
        const all = [...state.hands.flat(), ...state.city.flat().map((x) => x.slot), ...state.stages.flat(), ...state.discard, ...state.piles.flat(), ...state.pool];
        assert.equal(new Set(all).size, all.length, `${where}: each card once`);
        for (const p of [0, 1, 2]) assert.equal(new Set(state.city[p].map((x) => CARDS[x.id].key)).size, state.city[p].length, `${where}: no city holds two of a card`);
      }
      assert.ok(yourPick(state), `${where}: your pick`);
      const expect = [].concat(step.expect);
      for (const move of expect) {
        const after = structuredClone(state);
        assert.doesNotThrow(() => play(after, move, step), `${where}: ${JSON.stringify(move)}`);
      }
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...expect.flatMap(cells)]) assert.ok(isCell(state, c), `${where}: ${c} is a cell`);
      const played = play(state, expect[0], step);
      for (const c of result(state, played)) assert.ok(isCell(state, c), `${where}: the result ${c} is a cell`);
      if (k + 1 < steps.length) assert.ok(yourPick(state), `${where}: your pick again`);
    });
  }
});

// Plays a lesson's picks up to step `upto`, returning the state and what the last turn did.
function playTo(title, upto = Infinity) {
  const { steps } = lessons.find((l) => l.title === title);
  let state = null;
  let played = [];
  for (const step of steps.slice(0, upto)) {
    if (step.position) state = load(step.position);
    played = play(state, [].concat(step.expect)[0], step);
  }
  return { state, played, steps };
}
const atStep = (title, k) => {
  const { steps } = lessons.find((l) => l.title === title);
  return k === 0 || steps[k].position ? load(steps[k].position) : playTo(title, k).state;
};
const mine = (played, type) => played.find((e) => e.type === type && e.p === 0);

test("the lessons' rules: own resources, coins, buying the cheapest way, chains, stages, sales, the seventh card, war, science and the score", () => {
  // Picking and building: your wonder's stone, a card for a coin, and wood from it the turn after.
  let s = atStep("Picking and building", 0);
  assert.equal(purchases(s, 0, CARDS[deckOf(PLAYERS)[card("hot-springs")]].cost)[0].coins, 0, "your wonder makes the stone");
  const first = playTo("Picking and building", 2);
  assert.equal(mine(first.played, "build").coins, 1);
  assert.equal(first.state.coins[0], 2);
  const built = playTo("Picking and building");
  assert.deepEqual(built.state.city[0].map((x) => CARDS[x.id].key), ["hot-springs", "hillside-clearing", "palisade"]);
  assert.equal(shields(built.state, 0), 1);

  // Buying: clay from Teal for 1 with West Road, though Violet sells it too; Teal gets the coin.
  s = atStep("Buying and chains", 0);
  const ways = canBuild(s, 0, deckOf(PLAYERS)[card("watchtower")]).purchases;
  assert.ok(ways.length >= 2, "both neighbours sell clay");
  assert.equal(ways[0].coins, 1);
  assert.equal(ways[0].left[2], 1, "the cheapest is Teal's");
  const bought = playTo("Buying and chains", 1);
  assert.deepEqual(mine(bought.played, "build").bought, { left: 1, right: 0 });
  assert.ok(bought.played.some((e) => e.type === "gain" && e.p === 1 && e.why === "trade" && e.from === 0));
  // Chains: Water Channel free through Hot Springs.
  s = atStep("Buying and chains", 1);
  assert.equal(canBuild(s, 0, deckOf(PLAYERS)[card("water-channel")]).chain, true);
  assert.equal(mine(playTo("Buying and chains").played, "build").how, "chain");

  // Wonder stages with any card, and sales for 3 coins.
  s = atStep("Wonder stages and selling", 0);
  assert.equal(canStage(s, 0).ok, true);
  const staged = playTo("Wonder stages and selling", 1);
  assert.equal(staged.state.stages[0].length, 1);
  const sold = playTo("Wonder stages and selling");
  assert.equal(sold.state.coins[0], 4, "1 coin and 3 from the sale");

  // Passing: Violet's hand comes to you in age I; the sixth turn discards the seventh card, then war.
  const passed = playTo("Passing hands and war", 1);
  assert.ok(passed.played.some((e) => e.type === "pass" && e.dir === 1));
  assert.ok(passed.state.hands[0].includes(card("palisade")), "Violet's palisade came to you");
  const war = playTo("Passing hands and war");
  assert.equal(war.played.filter((e) => e.type === "discard" && e.seventh).length, 3, "each seventh card is discarded");
  assert.deepEqual(war.played.find((e) => e.type === "war").results[0], [1, 1], "you beat both");
  assert.deepEqual(war.state.tokens[0], [1, 1]);
  assert.equal(war.state.age, 2, "age II is dealt");

  // Science: a star, a cog and two quills; the last turn scores the game, and you win.
  const set = playTo("Science and the final score", 1);
  assert.equal(score(set.state, 0).science, 1 + 1 + 4 + 7);
  const end = playTo("Science and the final score");
  const over = end.played.find((e) => e.type === "over");
  assert.ok(over, "the game is scored");
  assert.deepEqual(over.winners, [0], "you win");
  assert.equal(design(mine(end.played, "build").slot).key, "rose-gardens");
  assert.equal(mine(end.played, "build").how, "chain");
  assert.deepEqual(result(end.state, end.played), ["total"]);
});
