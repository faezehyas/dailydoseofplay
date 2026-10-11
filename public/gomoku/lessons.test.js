// Every step of Gomoku's tutorial asks for a move that rules.js allows in its
// position, and the teacher's replies are legal too, so a lesson can't teach
// a wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells } from "./tutorial.js";
import { EMPTY, SIZE } from "./rules.js";

test("Gomoku has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    assert.ok(steps[0].position, `${title} starts from a position`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every expected move and reply in Gomoku's lessons is legal in its position", () => {
  for (const { title, steps } of lessons) {
    let state = null;
    steps.forEach((step, k) => {
      const where = `${title}, step ${k + 1}`;
      if (step.position) {
        state = load(step.position);
        const stones = state.board.filter((p) => p !== EMPTY);
        assert.equal(stones.filter((p) => p === 0).length, stones.filter((p) => p === 1).length, `${where}: the solid stones move next, so both have as many`);
        assert.equal(stones.length, (step.position.x ?? []).length + (step.position.o ?? []).length, `${where}: no point holds two stones`);
      }
      const expect = [].concat(step.expect);
      for (const move of expect) assert.doesNotThrow(() => play(structuredClone(state), move), where);
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...expect.flatMap(cells)]) assert.ok(c >= 0 && c < SIZE * SIZE, `${where}: point ${c}`);
      play(state, expect[0]);
      if (step.reply) assert.doesNotThrow(() => play(state, step.reply), `${where}: the reply`);
      else if (k + 1 < steps.length) assert.ok(steps[k + 1].position, `${where}: the next step goes on from here, so it needs a reply`);
    });
  }
});

// The points where `player` would make five right now.
const wins = (state, player) =>
  state.board.flatMap((p, cell) => {
    if (p !== EMPTY) return [];
    const s = structuredClone(state);
    s.turn = player;
    play(s, { cell });
    return s.winner === player ? [cell] : [];
  });

test("the five-in-a-row steps win, the blocks stop real threats, and an open four can't be stopped", () => {
  for (const step of lessons.find((l) => l.title === "Five in a row").steps) {
    for (const move of step.expect) {
      const state = load(step.position);
      play(state, move);
      assert.equal(state.winner, 0, step.text);
    }
  }
  const [four, three] = lessons.find((l) => l.title === "Blocking").steps;
  assert.deepEqual(wins(load(four.position), 1), [four.expect.cell], "the ringed stones would win where X blocks");
  assert.deepEqual(wins(load(four.position), 0), [], "the solid stones have no win of their own, so blocking is the move");
  for (const { cell } of three.expect) {
    const state = load(three.position);
    state.turn = 1;
    play(state, { cell });
    assert.equal(wins(state, 1).length, 2, "left alone, the three becomes an open four");
  }

  const [make, finish] = lessons.find((l) => l.title === "Making an open four").steps;
  const state = load(make.position);
  play(state, make.expect);
  assert.equal(wins(state, 0).length, 2, "an open four wins at both ends");
  assert.ok(wins(state, 0).includes(make.reply.cell), "the reply blocks one of them");
  play(state, make.reply);
  assert.deepEqual(wins(state, 0), [finish.expect.cell]);
});
