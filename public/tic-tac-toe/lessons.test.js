// Every step of Tic Tac Toe's tutorial asks for a move that rules.js allows
// in its position, and the teacher's replies are legal too, so a lesson
// can't teach a wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play } from "./tutorial.js";

test("Tic Tac Toe has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    assert.ok(steps[0].position, `${title} starts from a position`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every expected move and reply in Tic Tac Toe's lessons is legal in its position", () => {
  for (const { title, steps } of lessons) {
    let state = null;
    steps.forEach((step, k) => {
      if (step.position) {
        state = load(step.position);
        const marks = state.board.filter((p) => p !== -1);
        assert.equal(marks.filter((p) => p === 0).length, marks.filter((p) => p === 1).length, `${title}, step ${k + 1}: X moves next, so X and O have as many marks`);
      }
      const where = `${title}, step ${k + 1}`;
      const expect = [].concat(step.expect);
      for (const move of expect) assert.doesNotThrow(() => play(structuredClone(state), move), where);
      play(state, expect[0]);
      if (step.reply) assert.doesNotThrow(() => play(state, step.reply), `${where}: the reply`);
      else if (k + 1 < steps.length) assert.ok(steps[k + 1].position, `${where}: the next step goes on from here, so it needs a reply`);
    });
  }
});

test("the three-in-a-row steps win, and the block stops a real threat", () => {
  for (const step of lessons.find((l) => l.title === "Three in a row").steps) {
    const state = load(step.position);
    play(state, step.expect);
    assert.equal(state.winner, 0, step.text);
  }
  const [block] = lessons.find((l) => l.title === "Blocking").steps;
  const threat = load(block.position);
  threat.turn = 1;
  play(threat, block.expect);
  assert.equal(threat.winner, 1, "O would win on the square X blocks");
});
