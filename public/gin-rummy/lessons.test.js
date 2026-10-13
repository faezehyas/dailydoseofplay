// Every step of Gin Rummy's tutorial asks for a move that rules.js allows
// with the step's fixed hands, and teal's replies are legal too, so a lesson
// can't teach a wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells } from "./tutorial.js";
import { forcedMove } from "./rules.js";
import { DECK } from "../engine/cards/faces.js";
import { bestMelds } from "../engine/cards/melds.js";
import { card } from "../engine/cards/lesson-deck.js";

const SPOTS = ["stock", "pile", "knock", "deadwood"];
const face = (slot) => slot;

test("Gin Rummy has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
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
        const all = [...state.hands.flat(), ...state.discard, ...state.stock];
        assert.equal(all.length, DECK, `${where}: 52 cards`);
        assert.equal(new Set(all).size, DECK, `${where}: 52 different cards`);
        assert.deepEqual(state.hands.map((h) => h.length), [10, 10], `${where}: ten cards each`);
      }
      assert.equal(state.turn, 0, `${where}: your turn`);
      const expect = [].concat(step.expect);
      for (const move of expect) assert.doesNotThrow(() => play(structuredClone(state), move), where);
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...expect.flatMap(cells)]) {
        assert.ok(SPOTS.includes(c) || state.hands[0].includes(c), `${where}: ${c} is in your hand or a spot on the table`);
      }
      play(state, expect[0]);
      if (step.reply) {
        // Teal defends as the game would, the best way.
        if (state.phase === "defend") assert.deepEqual(step.reply, forcedMove(state, 1, face), `${where}: teal's best defence`);
        assert.doesNotThrow(() => play(state, step.reply), `${where}: the reply`);
      }
    });
  }
});

test("the lessons' rules: the taken card can't go back, deadwood counts, a knock scores the difference and gin 25 plus", () => {
  const first = (title) => lessons.find((l) => l.title === title).steps;
  const [take] = first("Sets and runs");
  const taken = load(take.position);
  play(taken, take.expect);
  assert.throws(() => play(structuredClone(taken), { discard: card("7D") }), /^RuleError: You can't throw back the card you just took from the pile$/);
  assert.throws(() => play(structuredClone(taken), { discard: card("KD"), knock: true }), /You need 10 points of deadwood or less to knock/);

  const [count] = first("Deadwood");
  assert.equal(bestMelds(load(count.position).hands[0]).points, 26, "K♥ Q♠ 4♦ 2♠");
  assert.throws(() => play(load(count.position), { discard: card("KH") }), /Draw a card first/);

  const [draw, knock] = first("Knocking");
  const knocked = load(draw.position);
  play(knocked, draw.expect);
  const events = play(knocked, knock.expect);
  assert.deepEqual(events.map((e) => e.type), ["discard", "knock", "lay"], "your hand is laid down for you");
  play(knocked, knock.reply);
  assert.deepEqual(knocked.result, { kind: "knock", winner: 0, points: 27 - 2 });

  const [pick, gin] = first("Gin");
  const out = load(pick.position);
  play(out, pick.expect);
  play(out, gin.expect);
  play(out, gin.reply);
  assert.deepEqual(out.result, { kind: "gin", winner: 0, points: 25 + 21 });
});
