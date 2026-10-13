// Every step of Crazy Eights' tutorial asks for a move that rules.js allows
// with the step's fixed hands, and teal's replies are legal too, so a lesson
// can't teach a wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells } from "./tutorial.js";
import { DECK } from "../engine/cards/faces.js";
import { card } from "../engine/cards/lesson-deck.js";

test("Crazy Eights has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    assert.ok(steps[0].position, `${title} starts from a position`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every position deals each card once, and every expected move and reply is legal", () => {
  for (const { title, steps } of lessons) {
    let state = null;
    steps.forEach((step, k) => {
      const where = `${title}, step ${k + 1}`;
      if (step.position) {
        state = load(step.position);
        const all = [...state.hands.flat(), ...state.discard, ...state.stock];
        assert.equal(new Set(all).size, DECK, `${where}: 52 different cards`);
      }
      assert.equal(state.turn, 0, `${where}: your turn`);
      const expect = [].concat(step.expect);
      for (const move of expect) assert.doesNotThrow(() => play(structuredClone(state), move), where);
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...expect.flatMap(cells)]) {
        assert.ok(c === "stock" || c === "pile" || state.hands[0].includes(c), `${where}: ${c} is in your hand, the stock or the pile`);
      }
      play(state, expect[0]);
      if (step.reply) assert.doesNotThrow(() => play(state, step.reply), `${where}: the reply`);
    });
  }
});

test("the lessons' rules: a card that doesn't match is refused, an 8 names the suit, drawing waits until nothing plays, and the last card wins", () => {
  const first = (title) => lessons.find((l) => l.title === title).steps;
  const [suit] = first("Matching suit or rank");
  assert.throws(() => play(load(suit.position), { play: card("KS") }), /Play a ♥, a 9 or an 8$/);
  const [eight] = first("Eights are wild");
  const named = load(eight.position);
  play(named, eight.expect);
  assert.deepEqual([named.suit, named.named], [eight.expect.suit, true]);
  const [once, again, drawn] = first("Drawing when you can't play");
  const drawing = load(once.position);
  play(drawing, once.expect);
  play(drawing, again.expect);
  assert.throws(() => play(drawing, { draw: true }), /You have a card that plays/);
  play(drawing, drawn.expect);
  const [two, last] = first("Going out");
  const out = load(two.position);
  play(out, two.expect);
  play(out, two.reply);
  play(out, last.expect);
  assert.equal(out.winner, 0);
});
