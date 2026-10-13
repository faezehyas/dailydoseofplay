// Every step of Ludo's tutorial asks for a move that rules.js allows in its
// position with the step's fixed roll, so a lesson can't teach a wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells } from "./tutorial.js";
import { legalMoves, moveFor, square, SAFE, TOKENS, YARD, HOME } from "./rules.js";

test("Ludo has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every expected move in Ludo's lessons is legal with the step's fixed roll", () => {
  const cell = /^[to][0-3]$/;
  for (const { title, steps } of lessons) {
    steps.forEach((step, k) => {
      const where = `${title}, step ${k + 1}`;
      // Each step sets up its own position and roll: the die comes before the learner's choice.
      assert.ok(step.position, `${where}: a position`);
      assert.equal(step.reply, undefined, `${where}: no reply`);
      const { mine, theirs } = step.position;
      for (const r of [...mine, ...theirs]) assert.ok(Number.isInteger(r) && r >= YARD && r <= HOME, `${where}: ${r} is a place on the path`);
      assert.equal(mine.length, TOKENS);
      const state = load(step.position);
      assert.ok(state.rolled && state.turn === 0, `${where}: the roll can be played`);
      assert.equal(state.die, step.position.die, `${where}: the step's roll`);
      for (const move of [].concat(step.expect)) assert.doesNotThrow(() => play(structuredClone(state), move), where);
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...[].concat(step.expect).flatMap(cells)]) {
        assert.ok(cell.test(c) || (Number.isInteger(c) && c >= 0 && c <= HOME), `${where}: ${c} is a token or a square`);
      }
      for (const [, to] of step.arrows ?? []) if (typeof to === "number") assert.equal(moveFor(state, 0, [].concat(step.expect)[0].token, state.die).to, to, `${where}: the arrow shows the move`);
    });
  }
});

test("the lessons' special moves: out on a 6 and roll again, a capture, a safe star, the exact roll home", () => {
  const first = (title) => lessons.find((l) => l.title === title).steps[0];
  const out = load(first("Leaving the yard").position);
  play(out, first("Leaving the yard").expect[0]);
  assert.ok(out.turn === 0 && !out.rolled, "a 6 rolls again");
  const capture = load(first("Capturing").position);
  play(capture, first("Capturing").expect);
  assert.equal(capture.tokens[1][0], YARD, "yellow goes back to its yard");
  const safe = first("Safe squares");
  const star = load(safe.position);
  assert.ok(SAFE.has(square(0, safe.position.mine[0] + 3)), "the token lands on a star");
  play(star, safe.expect);
  assert.notEqual(star.tokens[1][0], YARD, "yellow on the star stays");
  const home = first("Reaching home");
  assert.deepEqual(legalMoves(load(home.position), 0).map((mv) => mv.token), [0], "the other token would overshoot");
});
