// Every step of Chess's tutorial asks for a move that rules.js allows in its
// position, and the teacher's replies are legal too, so a lesson can't teach
// a wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells } from "./tutorial.js";
import { toFen } from "./rules.js";

test("Chess has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    assert.ok(steps[0].position, `${title} starts from a position`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every expected move and reply in Chess's lessons is legal in its position", () => {
  for (const { title, steps } of lessons) {
    let state = null;
    steps.forEach((step, k) => {
      if (step.position) state = load(step.position);
      const where = `${title}, step ${k + 1} (${toFen(state)})`;
      const expect = [].concat(step.expect);
      for (const move of expect) assert.doesNotThrow(() => play(structuredClone(state), move), where);
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...expect.flatMap(cells)]) assert.ok(c >= 0 && c < 64, `${where}: square ${c}`);
      play(state, expect[0]);
      if (step.reply) assert.doesNotThrow(() => play(state, step.reply), `${where}: the reply`);
      else if (k + 1 < steps.length) assert.ok(steps[k + 1].position, `${where}: the next step goes on from here, so it needs a reply`);
    });
  }
});

test("the checkmate step ends the game in checkmate", () => {
  const step = lessons.find((l) => l.title === "Check and checkmate").steps.at(-1);
  const state = load(step.position);
  play(state, step.expect);
  assert.equal(state.reason, "checkmate");
});
