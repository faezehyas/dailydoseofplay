// Every step of Checkers' tutorial asks for a move that rules.js allows in
// its position, and the teacher's replies are legal too, so a lesson can't
// teach a wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells } from "./tutorial.js";
import { legalMoves, isDark, isKing, EMPTY } from "./rules.js";

test("Checkers has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    assert.ok(steps[0].position, `${title} starts from a position`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every expected move and reply in Checkers' lessons is legal in its position", () => {
  for (const { title, steps } of lessons) {
    let state = null;
    steps.forEach((step, k) => {
      const where = `${title}, step ${k + 1}`;
      if (step.position) {
        assert.equal(step.position.replace(/\s/g, "").length, 64, `${where}: 8 rows of 8`);
        state = load(step.position);
        state.board.forEach((p, sq) => p !== EMPTY && assert.ok(isDark(sq), `${where}: pieces stand on dark squares`));
      }
      const expect = [].concat(step.expect);
      for (const move of expect) assert.doesNotThrow(() => play(structuredClone(state), move), where);
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...expect.flatMap(cells)]) assert.ok(isDark(c), `${where}: square ${c} is a dark square`);
      play(state, expect[0]);
      if (step.reply) {
        assert.equal(state.turn, 1, `${where}: the reply is the other side's`);
        assert.doesNotThrow(() => play(state, step.reply), `${where}: the reply`);
      } else if (k + 1 < steps.length) assert.ok(steps[k + 1].position, `${where}: the next step goes on from here, so it needs a reply`);
    });
  }
});

test("the forced capture is the only legal move, the multi-jump takes both men, and crowning makes a king", () => {
  const [forced, multi] = lessons.find((l) => l.title === "Forced captures and multi-jumps").steps;
  const state = load(forced.position);
  assert.ok(state.board.some((p, sq) => p === 0 && !forced.expect.path.includes(sq)), "another man could step if captures weren't forced");
  assert.deepEqual(legalMoves(state.board, 0), [forced.expect.path]);
  const jumps = load(multi.position);
  play(jumps, multi.expect);
  assert.equal(jumps.board.filter((p) => p === 1).length, 0, "both teal men are taken");
  const crown = lessons.find((l) => l.title === "Crowning a king").steps[0];
  const crowned = load(crown.position);
  play(crowned, crown.expect);
  assert.ok(isKing(crowned.board[crown.expect.path.at(-1)]));
});
