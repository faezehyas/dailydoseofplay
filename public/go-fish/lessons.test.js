// Every step of Go Fish's tutorial asks for a move that rules.js allows with
// the step's fixed hands, and Teal's replies are legal too, so a lesson can't
// teach a wrong rule.
import test from "node:test";
import assert from "node:assert/strict";
import { lessons, load, play, cells } from "./tutorial.js";
import { DECK } from "../engine/cards/faces.js";
import { card } from "../engine/cards/lesson-deck.js";
import { rankOf, rankWords } from "./rules.js";

test("Go Fish has 3 to 6 lessons of 1 to 4 steps, each with text", () => {
  assert.ok(lessons.length >= 3 && lessons.length <= 6, `${lessons.length} lessons`);
  for (const { title, steps } of lessons) {
    assert.ok(title, "a title");
    assert.ok(steps.length >= 1 && steps.length <= 4, `${title}: ${steps.length} steps`);
    assert.ok(steps[0].position, `${title} starts from a position`);
    for (const step of steps) assert.ok(step.text, `${title}: every step has text`);
  }
});

test("every position deals each card once, and every expected move and reply is legal", () => {
  const spots = ["ask", "pond", "teal", "books", "teal-books"];
  for (const { title, steps } of lessons) {
    let state = null;
    steps.forEach((step, k) => {
      const where = `${title}, step ${k + 1}`;
      if (step.position) {
        state = load(step.position);
        const all = [...state.hands.flat(), ...state.books.flat().flatMap((b) => b.slots), ...state.stock];
        assert.equal(new Set(all).size, DECK, `${where}: 52 different cards`);
        assert.equal(all.length, DECK, `${where}: no card twice`);
      }
      assert.deepEqual([state.turn, state.phase], [0, "ask"], `${where}: your ask`);
      const expect = [].concat(step.expect);
      for (const move of expect) assert.doesNotThrow(() => play(structuredClone(state), move), where);
      const ranks = state.hands[0].map((f) => rankWords(rankOf(f)));
      for (const c of [...(step.highlight ?? []), ...(step.arrows ?? []).flat(), ...expect.flatMap(cells)]) {
        assert.ok(spots.includes(c) || state.hands[0].includes(c) || ranks.includes(c), `${where}: ${c} is in your hand or on the table`);
      }
      play(state, expect[0]);
      assert.equal(state.turn, 1, `${where}: Teal answers`);
      if (step.reply) assert.doesNotThrow(() => play(state, step.reply), `${where}: the reply`);
      if (k < steps.length - 1) assert.equal(state.turn, 0, `${where}: back to you`);
    });
  }
});

test("the lessons' rules: Teal hands over every card asked for, Go fish draws from the pond, a lucky catch goes again, four make a book, and the most books wins", () => {
  const first = (title) => lessons.find((l) => l.title === title).steps;
  const [sevens, kings] = first("Asking for a rank");
  const asking = load(sevens.position);
  assert.throws(() => play(structuredClone(asking), { ask: null, from: 1 }), /^RuleError: Pick a card first/);
  play(asking, sevens.expect);
  play(asking, sevens.reply);
  play(asking, kings.expect);
  assert.throws(() => play(structuredClone(asking), { give: [card("KS")] }), /Handed over only some Kings/);
  play(asking, kings.reply);
  assert.deepEqual(asking.hands[1].map((f) => rankWords(rankOf(f))).sort(), ["3s", "5s", "8s", "Queens"]);

  const [fives, nines] = first("Go fish!");
  const fishing = load(fives.position);
  play(fishing, fives.expect);
  assert.throws(() => play(structuredClone(fishing), { give: [card("JC")] }), /Hand over only 5s/);
  play(fishing, fives.reply);
  assert.ok(fishing.hands[0].includes(card("2C")), "you drew the pond's top card");
  assert.equal(fishing.turns, 2, "your turn ended, then Teal's");
  play(fishing, nines.expect);
  const caught = play(fishing, nines.reply);
  assert.ok(caught.some((ev) => ev.type === "lucky" && ev.p === 0), "a lucky catch");
  assert.equal(fishing.turn, 0, "you go again");

  const [queens] = first("Making a book");
  const booking = load(queens.position);
  play(booking, queens.expect);
  play(booking, queens.reply);
  assert.deepEqual(booking.books[0].map((b) => rankWords(b.rank)), ["Queens"]);

  const [level, last] = first("The most books wins");
  const ending = load(level.position);
  for (const step of [level, last]) {
    play(ending, step.expect);
    play(ending, step.reply);
  }
  assert.deepEqual(ending.books.map((b) => b.length), [7, 6]);
  assert.deepEqual([ending.winner, ending.winners, ending.phase], [0, [0], "over"]);
});
