// Every step of Hearts' tutorial asks for a move that rules.js allows with
// the step's fixed hands, and the robots' replies are legal too, so a lesson
// can't teach a wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells } from "./tutorial.js";
import { DECK } from "../engine/cards/faces.js";
import { card } from "../engine/cards/lesson-deck.js";

test("Hearts has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
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
        const all = [...state.hands.flat(), ...state.trick.map((x) => x.slot), ...state.won.flat()];
        assert.equal(all.length, DECK, `${where}: 52 cards`);
        assert.equal(new Set(all).size, DECK, `${where}: each card once`);
        const size = 13 - state.tricks;
        state.hands.forEach((h, p) => assert.equal(h.length + (state.trick.some((x) => x.p === p) ? 1 : 0), size, `${where}: seat ${p} has ${size} cards`));
      }
      assert.equal(state.turn, 0, `${where}: your turn`);
      const expect = [].concat(step.expect);
      for (const move of expect) {
        const after = structuredClone(state);
        assert.doesNotThrow(() => play(after, move), where);
        if (step.reply) assert.doesNotThrow(() => play(after, step.reply), `${where}: the reply after ${JSON.stringify(move)}`);
      }
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...expect.flatMap(cells)]) {
        assert.ok(c === "trick" || c === "pass" || state.hands[0].includes(c), `${where}: ${c} is in your hand, the trick or the Pass button`);
      }
      play(state, expect[0]);
      if (step.reply) play(state, step.reply);
      if (k + 1 < steps.length) assert.equal(state.turn, 0, `${where}: the turn is back with you`);
    });
  }
});

test("the lessons' rules: follow suit, the pass, no hearts led before they break, the queen's 13 and the moon", () => {
  const first = (title) => lessons.find((l) => l.title === title).steps;
  const [follow] = first("Following suit");
  assert.throws(() => play(load(follow.position), { play: card("9C") }), /^RuleError: Follow suit: play a diamond$/);
  const [passing, two] = first("Passing three cards");
  const passed = load(passing.position);
  play(passed, passing.expect);
  play(passed, passing.reply);
  assert.ok(passing.expect.pass.every((c) => passed.hands[1].includes(c)), "your three went left to Teal");
  assert.ok(passing.reply[2].pass.every((c) => passed.hands[0].includes(c)), "Amber's three came to you");
  assert.throws(() => play(structuredClone(passed), { play: card("KD") }), /The 2 of clubs leads the first trick/);
  play(passed, two.expect);
  const [queen] = first("Hearts and the queen");
  const points = load(queen.position);
  play(points, queen.expect);
  assert.equal(points.points[2], 13, "Violet took the queen: 13");
  const [lead, again] = first("Breaking hearts");
  const breaking = load(lead.position);
  assert.throws(() => play(structuredClone(breaking), { play: card("2H") }), /Hearts aren't broken yet: lead another suit/);
  play(breaking, lead.expect);
  play(breaking, lead.reply);
  assert.ok(breaking.broken, "Amber's heart broke them");
  assert.doesNotThrow(() => play(breaking, again.expect[0]));
  const [king, ace] = first("Shooting the moon");
  const moon = load(king.position);
  for (const step of [king, ace]) {
    play(moon, step.expect);
    play(moon, step.reply);
  }
  assert.equal(moon.phase, "result", "the hand is over, and the next isn't dealt");
  assert.equal(moon.result.moon, 0, "you shot the moon");
  assert.deepEqual(moon.scores, [0, 26, 26, 26]);
});
