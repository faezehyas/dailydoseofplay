// Every step of Sea Battle's tutorial asks for a move that rules.js allows
// in its position, and the replies are legal too, so a lesson can't teach a
// wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells } from "./tutorial.js";
import { validateFleet, CELLS, FLEET, HIT, MISS, CLEAR } from "./rules.js";

test("Sea Battle has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    assert.ok(steps[0].position, `${title} starts from a position`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every expected move and reply in Sea Battle's lessons is legal in its position", () => {
  const square = (c) => (typeof c === "number" ? c : Number(/^m(\d+)$/.exec(c)?.[1]));
  for (const { title, steps } of lessons) {
    let state = null;
    steps.forEach((step, k) => {
      const where = `${title}, step ${k + 1}`;
      if (step.position) {
        const { fleet, enemy } = step.position;
        assert.deepEqual(validateFleet(fleet), { ok: true }, `${where}: your fleet`);
        if (enemy) assert.deepEqual(validateFleet(enemy), { ok: true }, `${where}: teal's fleet`);
        state = load(step.position);
      }
      if (state.match) assert.equal(state.match.turn, 0, `${where}: your turn`);
      const expect = [].concat(step.expect);
      for (const move of expect) if (move.target !== undefined || move.type === "place") assert.doesNotThrow(() => play(structuredClone(state), move), where);
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...expect.flatMap(cells)]) {
        assert.ok(square(c) >= 0 && square(c) < CELLS, `${where}: ${c} is a square`);
      }
      play(state, expect[0].type === "fire" && expect[0].target === undefined ? { type: "fire", target: 0 } : expect[0]);
      if (step.reply) {
        assert.equal(state.match.turn, 1, `${where}: the reply is teal's`);
        assert.doesNotThrow(() => play(state, step.reply), `${where}: the reply`);
      }
      if (k + 1 < steps.length && !steps[k + 1].position && state.match) assert.equal(state.match.turn, 0, `${where}: the next step goes on with your turn`);
    });
  }
});

test("the lessons' moves: a refused placement, a miss passes the turn, a hit fires again, a sinking clears the water and wins", () => {
  const first = (title) => lessons.find((l) => l.title === title).steps;
  const [move] = first("Placing your fleet");
  assert.throws(() => play(load(move.position), { ...move.expect, r: 0, c: 5 }), /Ships can't overlap or touch side by side/);
  const [miss] = first("Firing");
  const fired = load(miss.position);
  play(fired, miss.expect);
  assert.equal(fired.match.boards[1].cells[miss.expect.target], MISS);
  assert.equal(fired.match.turn, 1, "a miss passes the turn");
  const [hit] = first("Hits and misses");
  const again = load(hit.position);
  play(again, hit.expect);
  assert.equal(again.match.boards[1].cells[hit.expect.target], HIT);
  assert.equal(again.match.turn, 0, "a hit fires again");
  const [sink, win] = first("Sinking a ship");
  const sunk = load(sink.position);
  play(sunk, sink.expect);
  assert.equal(sunk.match.boards[1].sunk.length, 1);
  assert.ok(sunk.match.boards[1].cells.includes(CLEAR), "the water round it is cleared");
  assert.equal(sunk.match.turn, 1, "sinking ends the turn");
  const last = load(win.position);
  assert.equal(last.match.boards[1].sunk.length, FLEET.length - 1);
  play(last, win.expect);
  assert.equal(last.match.winner, 0);
});
