// Every step of Hexlands' tutorial asks for a move that rules.js allows in
// the step's position, and the other seats' replies are legal too, so a
// lesson can't teach a wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells, result } from "./tutorial.js";
import { card } from "./lessons.js";
import { HEXES, CORNERS, EDGES, RESOURCES } from "./board.js";
import { DECK_SIZE, points, roadLength, legalCorners, tradeRate, resourceOf } from "./rules.js";

const CONTROLS = new Set(["roll", "end", "trade", "road", "settlement", "city", "dev", "swap", "knight", ...RESOURCES.flatMap((r) => [`give-${r}`, `take-${r}`, `pile-${r}`])]);
function isCell(c) {
  const m = /^([ceh])(\d+)$/.exec(c);
  if (!m) return CONTROLS.has(c);
  return Number(m[2]) < { c: CORNERS, e: EDGES, h: HEXES }[m[1]].length;
}
const yourTurn = (state) => state.winner === -1 && (state.phase === "setup" ? state.setup.order[state.setup.i] === 0 : state.turn === 0);

test("Hexlands has 4 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 4 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    assert.ok(steps[0].position, `${title} starts from a position`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every position deals each card once, and every expected move and reply is legal", () => {
  for (const { title, steps } of lessons) {
    let state = null;
    steps.forEach((step, k) => {
      const where = `${title}, step ${k + 1}`;
      if (step.position) {
        state = load(step.position);
        const all = [...state.hands.flat(), ...state.devs.flat(), ...state.shown.flat(), ...state.bank.flat(), ...state.devPile];
        assert.equal(all.length, DECK_SIZE, `${where}: 120 cards`);
        assert.equal(new Set(all).size, DECK_SIZE, `${where}: each card once`);
      }
      assert.ok(yourTurn(state), `${where}: your turn`);
      const expect = [].concat(step.expect);
      for (const move of expect) {
        const after = structuredClone(state);
        assert.doesNotThrow(() => play(after, move, step), where);
        if (step.reply) assert.doesNotThrow(() => play(after, step.reply, step), `${where}: the reply after ${JSON.stringify(move)}`);
      }
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...expect.flatMap(cells)]) assert.ok(isCell(c), `${where}: ${c} is a cell`);
      const played = play(state, expect[0], step);
      if (step.reply) played.push(...play(state, step.reply, step));
      for (const c of result(state, played)) assert.ok(isCell(c), `${where}: the result ${c} is a cell`);
      if (k + 1 < steps.length) assert.ok(yourTurn(state), `${where}: the turn is back with you`);
    });
  }
});

// Plays a lesson's moves (and replies) up to step `upto`, returning the state and what the last move did.
function playTo(title, upto = Infinity) {
  const { steps } = lessons.find((l) => l.title === title);
  let state = null;
  let played = [];
  for (const step of steps.slice(0, upto)) {
    if (step.position) state = load(step.position);
    played = play(state, [].concat(step.expect)[0], step);
    if (step.reply) played.push(...play(state, step.reply, step));
  }
  return { state, played, steps };
}

test("the lessons' rules: the second settlement collects, a roll pays everyone, costs, the robber, harbours and ten points", () => {
  // Settling: your second settlement collects wood, wool and brick from its three hexes.
  const settling = playTo("Settling the island", 3);
  assert.deepEqual(settling.played.find((e) => e.type === "gain").slots.map(resourceOf).sort(), [0, 1, 2]);

  // Rolling: your 5 pays you a brick and Teal two wool; Teal's 10 and Violet's 9 pay you too.
  const first = playTo("Rolling for resources", 1);
  const five = first.played.find((e) => e.type === "produce");
  assert.equal(five.roll, 5);
  assert.deepEqual(five.gains.map((g) => g.map(resourceOf)), [[1], [2, 2], []]);
  const replies = playTo("Rolling for resources", 2).played.filter((e) => e.type === "produce");
  assert.deepEqual(replies.map((e) => [e.roll, e.gains[0].map(resourceOf)]), [[10, [1]], [9, [0]]]);

  // Building: the road and the settlement are paid from your hand.
  const built = playTo("Roads and settlements").state;
  assert.equal(built.hands[0].length, 0, "a road and a settlement spend all six cards");
  assert.equal(points(built, 0), 3);
  const city = playTo("Cities and development cards");
  assert.equal(points(city.state, 0), 4, "the city is worth 2");
  assert.deepEqual(city.state.devs[0], [card("knight1")], "you drew the knight");

  // The robber: a 7 pays nobody, you steal Teal's ore, the knight moves it again and robs Violet.
  const seven = playTo("The robber and knights", 1);
  assert.equal(seven.state.phase, "robber");
  assert.ok(!seven.played.some((e) => e.type === "produce"), "a 7 pays nobody");
  const robbed = playTo("The robber and knights", 2).played.find((e) => e.type === "steal");
  assert.equal(resourceOf(robbed.slot), 4, "Teal's ore");
  const knight = playTo("The robber and knights");
  assert.equal(knight.state.robber, 12);
  assert.equal(knight.state.knights[0], 1);
  assert.equal(knight.state.hands[2].length, 2, "Violet lost a card");

  // Trading and winning: the wool harbour trades 2:1, and the settlement makes 10.
  const start = load(lessons.at(-1).steps[0].position);
  assert.equal(points(start, 0), 9);
  assert.ok(start.longest.size >= 5 && start.longest.size === roadLength(start, 0), "your longest road holds");
  assert.equal(tradeRate(start, 0, 2), 2, "2 wool for one at the wool harbour");
  assert.ok(legalCorners(playTo("Trading and winning", 1).state, 0).includes(30));
  const won = playTo("Trading and winning");
  assert.equal(won.state.winner, 0);
  assert.deepEqual(result(won.state, won.played).sort(), ["c13", "c14", "c30", "c44", "c5", "c51"]);
});
