// Every step of Dots and Boxes' tutorial asks for a move that rules.js
// allows in its position, and the teacher's replies are legal too, so a
// lesson can't teach a wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells } from "./tutorial.js";
import { freeLines, geometry, sidesOf } from "./rules.js";

const geo = geometry(3);

test("Dots and Boxes has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    assert.ok(steps[0].position, `${title} starts from a position`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every expected move and reply in Dots and Boxes' lessons is legal in its position", () => {
  for (const { title, steps } of lessons) {
    let state = null;
    steps.forEach((step, k) => {
      const where = `${title}, step ${k + 1}`;
      if (step.position) {
        assert.deepEqual(step.position.map((row) => row.length), Array(7).fill(7), `${where}: 7 rows of 7`);
        state = load(step.position);
        state.boxes.forEach((p, b) => assert.equal(p !== -1, sidesOf(state, b) === 4, `${where}: box ${b} is claimed only when closed`));
      }
      const expect = [].concat(step.expect);
      for (const move of expect) assert.doesNotThrow(() => play(structuredClone(state), move), where);
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...expect.flatMap(cells)]) assert.ok(Number.isInteger(c) && c >= 0 && c < geo.lines, `${where}: line ${c}`);
      play(state, expect[0]);
      if (step.reply) {
        assert.equal(state.turn, 1, `${where}: the reply is teal's`);
        assert.doesNotThrow(() => play(state, step.reply), `${where}: the reply`);
      }
      if (k + 1 < steps.length && !steps[k + 1].position) assert.equal(state.turn, 0, `${where}: the next step goes on from here, so the learner draws next`);
    });
  }
});

test("closing a box gives another turn, the safe lines are exactly those, and the short chain wins", () => {
  const [close, again, safe] = lessons.find((l) => l.title === "Closing a box").steps;
  const state = load(close.position);
  for (const step of [close, again]) {
    play(state, step.expect);
    assert.equal(state.last.boxes.length, 1, "the line closes a box");
  }
  const unsafe = (l) => geo.lineBoxes[l].some((b) => sidesOf(state, b) === 2);
  assert.deepEqual(safe.expect.map((m) => m.line).sort((a, b) => a - b), freeLines(state).filter((l) => !unsafe(l)));

  const [give, ...take] = lessons.find((l) => l.title === "Long chains").steps;
  const before = load(give.position);
  for (const l of freeLines(before)) {
    const s = structuredClone(before);
    play(s, { line: l });
    assert.equal(s.turn, 1, "every line left hands boxes over");
  }
  const chain = load(take[0].position);
  for (const step of take) play(chain, step.expect);
  assert.equal(chain.winner, 0, "taking the chain wins");
  assert.deepEqual(chain.score, [5, 4]);
});
