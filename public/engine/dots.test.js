import test from "node:test";
import assert from "node:assert/strict";
import { dotsClock, seatDots, SHOW, WORDS, HELP, DONE } from "./dots.js";

// A clock on fake timers, with every state it rendered.
function clock(t, options) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const seen = [];
  const c = dotsClock((s) => seen.push({ ...s, on: [...s.on] }), options);
  return { c, seen, at: () => seen.at(-1) };
}

test("nothing shows for 300 ms, then the dots, the words at 2 s and the help line at 10 s", (t) => {
  const { at } = clock(t, { help: true });
  assert.equal(at().stage, "none");
  t.mock.timers.tick(SHOW - 1);
  assert.equal(at().stage, "none", "nothing before 300 ms");
  t.mock.timers.tick(1);
  assert.equal(at().stage, "dots");
  t.mock.timers.tick(WORDS - SHOW - 1);
  assert.equal(at().stage, "dots");
  t.mock.timers.tick(1);
  assert.equal(at().stage, "words");
  t.mock.timers.tick(HELP - WORDS - 1);
  assert.equal(at().stage, "words");
  t.mock.timers.tick(1);
  assert.equal(at().stage, "help");
});

test("without a help line the words stay; shown starts with the dots; stop() freezes the clock", (t) => {
  const { c, at } = clock(t, { shown: true });
  assert.equal(at().stage, "dots");
  t.mock.timers.tick(HELP * 2);
  assert.equal(at().stage, "words", "no help line");
  const other = dotsClock(() => {}, { help: true });
  other.stop();
  t.mock.timers.tick(HELP);
  assert.equal(other.state.stage, "none");
  c.stop();
});

test("the lit dots follow the steps, and done lights all four", async (t) => {
  const { c, at } = clock(t);
  assert.deepEqual(at().on, [false, false, false, false]);
  c.lit(1);
  assert.deepEqual(at().on, [true, false, false, false]);
  c.lit(3);
  assert.deepEqual(at().on, [true, true, true, false]);
  c.lit([0, 2]);
  assert.deepEqual(at().on, [true, false, true, false]);
  await c.done();
  assert.deepEqual(at(), { stage: "none", on: [true, true, true, true], done: true }, "done before 300 ms resolves at once");
  c.lit(2);
  assert.equal(at().done, false, "a step back undoes the logo");
});

test("done waits for the burst once the dots have shown", async (t) => {
  const { c } = clock(t);
  t.mock.timers.tick(SHOW);
  let resolved = false;
  const burst = c.done().then(() => (resolved = true));
  t.mock.timers.tick(DONE - 1);
  await Promise.resolve();
  assert.equal(resolved, false);
  t.mock.timers.tick(1);
  await burst;
  assert.equal(resolved, true);
});

test("seats bring their dots home: two each for two, one each for four, the host's two at three", () => {
  assert.deepEqual(seatDots([true, false]), [0, 2]);
  assert.deepEqual(seatDots([true, true]), [0, 2, 1, 3]);
  assert.deepEqual(seatDots([true, false, false, false]), [0]);
  assert.deepEqual(seatDots([true, false, true, true]), [0, 2, 3]);
  assert.deepEqual(seatDots([true, false, false]), [0, 2]);
  assert.deepEqual(seatDots([true, true, true]), [0, 2, 1, 3]);
});
