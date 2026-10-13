// Every step of Backgammon's tutorial asks for a play that rules.js allows
// in its position with the step's fixed roll, so a lesson can't teach a
// wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells } from "./tutorial.js";
import { legalPlays, CHECKERS, BAR, OFF } from "./rules.js";

test("Backgammon has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every expected play in Backgammon's lessons is legal with the step's fixed roll", () => {
  for (const { title, steps } of lessons) {
    steps.forEach((step, k) => {
      const where = `${title}, step ${k + 1}`;
      // Each step sets up its own position and roll: the dice come before the learner's choice.
      assert.ok(step.position, `${where}: a position`);
      assert.equal(step.reply, undefined, `${where}: no reply`);
      const state = load(step.position);
      for (const p of [0, 1]) assert.ok(state.pos[p].reduce((a, b) => a + b, 0) <= CHECKERS, `${where}: at most fifteen checkers each`);
      assert.deepEqual(state.roll, step.position.roll, `${where}: the step's roll`);
      assert.equal(state.turn, 0, `${where}: the roll can be played`);
      for (const move of [].concat(step.expect)) {
        const after = structuredClone(state);
        assert.doesNotThrow(() => play(after, move), where);
        assert.equal(after.last.player, 0, `${where}: the whole roll is played`);
        // The tutorial's board sends a play with its steps from the farthest point in.
        assert.deepEqual(move.steps, move.steps.toSorted((a, b) => b[0] - a[0] || b[1] - a[1]), `${where}: steps in order`);
      }
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...[].concat(step.expect).flatMap(cells)]) {
        assert.ok(Number.isInteger(c) && c >= OFF && c <= BAR, `${where}: ${c} is a point, the bar or the tray`);
      }
    });
  }
});

test("the lessons' special plays: blocked 19, a double's four moves, a hit, the bar first, bearing off", () => {
  const step = (title, k = 0) => lessons.find((l) => l.title === title).steps[k];
  const run = step("Moving by the dice", 1);
  assert.ok(!legalPlays(load(run.position).pos, 0, [6, 5]).some((p) => p.steps.some(([from, die]) => from === 24 && die === 5)), "24 can't stop on 19");
  const double = load(step("Doubles").position);
  assert.equal(double.dice.length, 4);
  const hit = load(step("Hitting a blot").position);
  play(hit, step("Hitting a blot").expect);
  assert.equal(hit.pos[1][BAR], 1, "the blot is on teal's bar");
  const bar = step("Entering from the bar");
  for (const p of legalPlays(load(bar.position).pos, 0, [6, 2])) assert.deepEqual(p.steps[0], [BAR, 2], "the bar checker enters first, with the 2");
  assert.equal(legalPlays(load(bar.position).pos, 0, [6, 2]).length, bar.expect.length, "every way to play the 6 is accepted");
  const off = load(step("Bearing off", 1).position);
  play(off, step("Bearing off", 1).expect[0]);
  assert.equal(off.pos[0][OFF], 2);
});
