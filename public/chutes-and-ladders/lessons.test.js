// Every step of Chutes and Ladders' tutorial is a spin that rules.js plays
// with the step's fixed number, and each lesson shows what its title says.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play } from "./tutorial.js";
import { LADDERS, CHUTES, LAST, SPINNER } from "./rules.js";

test("Chutes and Ladders has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    assert.notEqual(steps[0].position, undefined, `${title} starts from a position`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every spin in Chutes and Ladders' lessons is legal with the step's fixed number", () => {
  for (const { title, steps } of lessons) {
    let state = null;
    steps.forEach((step, k) => {
      const where = `${title}, step ${k + 1}`;
      if (step.position !== undefined) state = load(step.position);
      assert.ok(Number.isInteger(step.spin) && step.spin >= 1 && step.spin <= SPINNER, `${where}: a spin of 1 to ${SPINNER}`);
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat()]) assert.ok(c === "spin" || (c >= 1 && c <= LAST), `${where}: ${c} is a square or the Spin button`);
      assert.equal(state.turn, 0, `${where}: your spin`);
      play(state, step.expect, step);
      assert.equal(state.last.spin, step.spin, `${where}: the spinner stops on the step's number`);
    });
  }
});

test("the lessons climb a ladder, slide down a chute, stay put on too big a spin and win on the exact one", () => {
  const run = (title) => {
    const { steps } = lessons.find((l) => l.title === title);
    const state = load(steps[0].position);
    return steps.map((step) => (play(state, step.expect, step), { ...state.last }));
  };
  const [climb] = run("Climbing a ladder");
  assert.equal(climb.jump?.kind, "ladder");
  assert.equal(climb.to, LADDERS[climb.landed]);
  const [slide] = run("Sliding down a chute");
  assert.equal(slide.jump?.kind, "chute");
  assert.equal(slide.to, CHUTES[slide.landed]);
  const [stay, win] = run("The exact spin to finish");
  assert.ok(stay.stay && stay.to === stay.from, "too big a spin stays put");
  assert.ok(win.win && win.to === LAST, "the exact spin wins");
});
