import test from "node:test";
import assert from "node:assert/strict";
import { thinkingDelay, THINK_AFTER } from "./players.js";

function delayed(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const shown = [];
  return { set: thinkingDelay((seat) => shown.push(seat)), shown: () => shown };
}

test("a robot's dots show once its move has taken 300 ms", (t) => {
  const { set, shown } = delayed(t);
  assert.equal(THINK_AFTER, 300);
  set(1);
  t.mock.timers.tick(THINK_AFTER - 1);
  assert.deepEqual(shown(), []);
  t.mock.timers.tick(1);
  assert.deepEqual(shown(), [1]);
});

test("a move quicker than 300 ms shows no dots", (t) => {
  const { set, shown } = delayed(t);
  set(1);
  t.mock.timers.tick(100);
  set(-1);
  t.mock.timers.tick(1000);
  assert.deepEqual(shown(), []);
});

test("the same seat again keeps its wait; the next robot waits afresh", (t) => {
  const { set, shown } = delayed(t);
  set(1);
  t.mock.timers.tick(200);
  set(1);
  t.mock.timers.tick(100);
  assert.deepEqual(shown(), [1]);
  set(2);
  t.mock.timers.tick(THINK_AFTER - 1);
  assert.deepEqual(shown(), [1, -1], "the first robot's dots go at once");
  t.mock.timers.tick(1);
  assert.deepEqual(shown(), [1, -1, 2]);
});
