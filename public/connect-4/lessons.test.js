// Every step of Connect 4's tutorial asks for a move that rules.js allows in
// its position, and the teacher's replies are legal too, so a lesson can't
// teach a wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells } from "./tutorial.js";
import { openColumns, EMPTY } from "./rules.js";

test("Connect 4 has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    assert.ok(steps[0].position, `${title} starts from a position`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every expected move and reply in Connect 4's lessons is legal in its position", () => {
  for (const { title, steps } of lessons) {
    let state = null;
    steps.forEach((step, k) => {
      const where = `${title}, step ${k + 1}`;
      if (step.position) {
        state = load(step.position);
        const discs = state.board.filter((p) => p !== EMPTY);
        assert.equal(discs.filter((p) => p === 0).length, discs.filter((p) => p === 1).length, `${where}: X moves next, so X and O have as many discs`);
        state.board.forEach((p, i) => i + state.cols < state.board.length && p !== EMPTY && assert.notEqual(state.board[i + state.cols], EMPTY, `${where}: no disc floats over a hole`));
      }
      const expect = [].concat(step.expect);
      for (const move of expect) assert.doesNotThrow(() => play(structuredClone(state), move), where);
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...expect.flatMap(cells)]) assert.ok(c >= 0 && c < 42, `${where}: square ${c}`);
      play(state, expect[0]);
      if (step.reply) assert.doesNotThrow(() => play(state, step.reply), `${where}: the reply`);
      else if (k + 1 < steps.length) assert.ok(steps[k + 1].position, `${where}: the next step goes on from here, so it needs a reply`);
    });
  }
});

// The columns where `player` would connect four right now.
const wins = (state, player) =>
  openColumns(state).filter((col) => {
    const s = structuredClone(state);
    s.turn = player;
    play(s, { col });
    return s.winner === player;
  });

test("the four-in-a-row steps win, the blocks stop real threats, and two threats can't both be blocked", () => {
  for (const step of lessons.find((l) => l.title === "Four in a row").steps) {
    const state = load(step.position);
    play(state, step.expect);
    assert.equal(state.winner, 0, step.text);
  }
  const blocking = lessons.find((l) => l.title === "Blocking").steps;
  const state = load(blocking[0].position);
  assert.deepEqual(wins(state, 1), [blocking[0].expect.col], "teal would win in the column X blocks");
  assert.deepEqual(wins(state, 0), [], "X has no win of its own, so blocking is the move");
  play(state, blocking[0].expect);
  play(state, blocking[0].reply);
  assert.deepEqual(wins(state, 1), [blocking[1].expect.col], "and then in the column X blocks next");
  assert.deepEqual(wins(state, 0), [], "X still has no win of its own");

  const [setUp, finish] = lessons.find((l) => l.title === "Two threats").steps;
  const threats = load(setUp.position);
  play(threats, setUp.expect);
  assert.equal(wins(threats, 0).length, 2, "two holes win");
  assert.ok(wins(threats, 0).includes(setUp.reply.col), "teal blocks one of them");
  play(threats, setUp.reply);
  assert.deepEqual(wins(threats, 0), [finish.expect.col]);
});
