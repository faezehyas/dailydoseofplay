import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { suitOf } from "../engine/cards/faces.js";
import { KnownDeck, shuffled } from "../../test/fixtures/known-deck.js";
import { makeRules, cardFace, legalPlays, QUEEN_SPADES } from "./rules.js";
import { chooseMove, timeoutMove, knowledge, moonThreat, moonHand, pointsTaken } from "./robot.js";

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const c = (name) => "SHDC".indexOf(name.at(-1)) * 13 + RANKS.indexOf(name.slice(0, -1));
const cards = (names) => names.split(" ").map(c);

// A seeded game straight on the rules, each robot seeing only what its seat may.
function game(levels, seed, { config = {}, onChoice = () => {} } = {}) {
  const n = levels.length;
  const rules = makeRules(config, n);
  const deck = new KnownDeck(shuffled(`deck ${seed}`).filter((f) => f < rules.deckSize), `reshuffle ${seed}`);
  const rng = rngFromSeed(`robots ${seed}`);
  const state = rules.newState(Math.floor(rng() * n), n, deck);
  let worst = 0;
  for (let moves = 0; state.winner === -1; moves++) {
    assert.ok(moves < 20_000, "the game ends");
    const p = state.turn;
    const t0 = performance.now();
    const m = chooseMove(state, p, rng, deck.view(p), { level: levels[p] });
    worst = Math.max(worst, performance.now() - t0);
    onChoice(state, p, m, deck, rules);
    for (const slot of rules.reveals(state, p, m)) deck.open(slot);
    rules.applyMove(state, p, m, deck);
  }
  return { state, worst };
}

// A hand dealt as given (seat by seat, seat 0 first) with passing off, played up to `moves`.
function position(hands, moves = [], config = {}) {
  const faces = [];
  for (let r = 0; r < 13; r++) for (let p = 0; p < 4; p++) faces.push(hands[p][r]);
  const deck = new KnownDeck(faces);
  const rules = makeRules({ passing: false, ...config }, 4);
  const state = rules.newState(0, 4, deck);
  const slotOf = (p, name) => state.hands[p].find((s) => deck.slots[s].face === c(name));
  for (const [p, name] of moves) {
    const m = { play: slotOf(p, name) };
    for (const slot of rules.reveals(state, p, m)) deck.open(slot);
    rules.applyMove(state, p, m, deck);
  }
  const choose = (level, p = state.turn) => {
    const m = chooseMove(state, p, rngFromSeed("pos"), deck.view(p), { level });
    return m.play !== undefined ? deck.slots[m.play].face : m.pass.map((s) => deck.slots[s].face);
  };
  return { state, deck, choose };
}

test("Hard beats Easy most of the time, and Medium too", () => {
  const rate = (a, b, n) => {
    let wins = 0;
    for (let i = 0; i < n; i++) {
      const seat = i % 4;
      const { state } = game([0, 1, 2, 3].map((p) => (p === seat ? a : b)), `${a} v ${b} ${i}`);
      if (state.winners.length === 1 && state.winners[0] === seat) wins++;
    }
    return wins / n;
  };
  // One against three: a quarter of the games would be a fair share. About 95% and 40% over 400 games.
  const hard = rate("hard", "easy", 80);
  assert.ok(hard > 0.75, `Hard won ${hard * 100}% against three Easy robots`);
  const medium = rate("medium", "easy", 80);
  assert.ok(medium > 0.5, `Medium won ${medium * 100}% against three Easy robots`);
  const top = rate("hard", "medium", 80);
  assert.ok(top > 0.28, `Hard won ${top * 100}% against three Medium robots`);
});

test("robot vs robot always finishes, every level and rule, well under 100 ms a choice", () => {
  let worst = 0;
  for (const config of [{}, { target: 50, moon: "minus" }, { passing: false, jack: true }, { target: 0 }]) {
    for (const levels of [["easy", "medium", "hard", "hard"], ["hard", "hard", "hard", "hard"], ["easy", "hard", "medium"]]) {
      for (let s = 0; s < 3; s++) {
        const r = game(levels, `${levels}-${JSON.stringify(config)}-${s}`, { config });
        worst = Math.max(worst, r.worst);
        assert.equal(r.state.phase, "over");
      }
    }
  }
  assert.ok(worst < 50, `slowest choice took ${worst.toFixed(1)} ms`);
});

test("a robot asks only for faces it may see: its own cards, open ones and the cards it passed", () => {
  let asked = 0;
  for (const level of ["easy", "medium", "hard"]) {
    for (let s = 0; s < 4; s++) {
      game([level, level, level, level], `spy ${level} ${s}`, {
        onChoice(state, p, m, deck) {
          const view = deck.view(p);
          const spy = (slot) => {
            const x = deck.slots[slot];
            assert.ok(x.open || x.owner === p || x.held.includes(p), `${level} seat ${p} asked for slot ${slot}`);
            asked++;
            return view(slot);
          };
          chooseMove(state, p, rngFromSeed("spy"), spy, { level });
        },
      });
    }
  }
  assert.ok(asked > 1000);
});

test("a robot never reads another hand: changing the cards hidden from it leaves every choice the same", () => {
  let compared = 0;
  for (const level of ["easy", "medium", "hard"]) {
    for (let s = 0; s < 4; s++) {
      game([level, "easy", level, "medium"], `swap ${level} ${s}`, {
        onChoice(state, p, m, deck) {
          if (state.phase === "result") return;
          // Another deck where every card p can't see is dealt among those same hidden places at random.
          const hidden = deck.slots.flatMap((x, id) => (!x.gone && !x.open && x.owner !== p && !x.held.includes(p) && x.owner !== -1 ? [id] : []));
          const other = new KnownDeck(deck.slots.map((x) => x.face));
          other.slots.forEach((x, id) => Object.assign(x, { ...deck.slots[id], held: deck.slots[id].held.slice() }));
          const faces = hidden.map((id) => deck.slots[id].face);
          const rng = rngFromSeed(`perm ${compared}`);
          for (let i = faces.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [faces[i], faces[j]] = [faces[j], faces[i]];
          }
          hidden.forEach((id, i) => (other.slots[id].face = faces[i]));
          const again = chooseMove(structuredClone(state), p, rngFromSeed("same"), other.view(p), { level });
          assert.deepEqual(again, chooseMove(state, p, rngFromSeed("same"), deck.view(p), { level }), `${level}, move ${state.moves}`);
          compared++;
        },
      });
    }
  }
  assert.ok(compared > 1000, `${compared} choices compared`);
});

// Seat 1 holds spades and hearts high: what each level passes.
const PASSING = [
  cards("2C 3C 4C 5C 6C 7C 8C 9C 10C 2D 3D 4D 5D"),
  cards("QS KS AS 2S AH KH 6D 7D 8D 9D JC QC KC"),
  cards("3S 4S 5S 6S 7S 8S 9S 10S JS 2H 3H 4H 5H"),
  cards("6H 7H 8H 9H 10H JH QH 10D JD QD KD AD AC"),
];

test("Medium passes its highest spades and hearts; Easy any three", () => {
  // Seat 1 opens the hand, so it passes first.
  const order = [];
  for (let r = 0; r < 13; r++) for (let k = 0; k < 4; k++) order.push(PASSING[(1 + k) % 4][r]);
  const deck = new KnownDeck(order);
  const state = makeRules({}, 4).newState(1, 4, deck);
  const pass = (level) => chooseMove(state, 1, rngFromSeed("p"), deck.view(1), { level }).pass.map((s) => deck.slots[s].face).sort((a, b) => a - b);
  assert.deepEqual(pass("medium"), cards("QS KS AS").sort((a, b) => a - b));
  const easy = pass("easy");
  assert.equal(new Set(easy).size, 3);
  assert.ok(easy.every((f) => PASSING[1].includes(f)));
  const hard = pass("hard");
  assert.ok(hard.includes(c("QS")), "Hard passes an unguarded queen");
});

test("Medium ducks under the trick, and when void dumps the queen, then its highest heart", () => {
  const hands = [cards("2C 9C 2H 3H 4H 5H 6H 7H 8H 2D 3D 4D 5D"), cards("3C 8C 10C 2S 3S 4S 5S 6S 9H 10H JH 6D 7D"), cards("QS KS AS 7S 8S 9S 10S JS QH KH AH 8D 9D"), cards("4C 5C 6C 7C JC QC KC AC 10D JD QD KD AD")];
  // Trick one: the 2 of clubs; seat 3 takes it with the ace and leads the 4, seat 0 plays the 9.
  const p = position(hands, [[0, "2C"], [1, "3C"], [2, "8D"], [3, "AC"], [3, "4C"], [0, "9C"]]);
  assert.equal(p.choose("medium"), c("8C"), "ducks under the 9 with the 8");
  // Seat 2 is out of clubs: the queen goes.
  const q = position(hands, [[0, "2C"], [1, "3C"], [2, "8D"], [3, "AC"], [3, "4C"], [0, "9C"], [1, "8C"]]);
  assert.equal(q.choose("medium"), QUEEN_SPADES);
  assert.equal(q.choose("hard"), QUEEN_SPADES, "Hard dumps it too, on a player who isn't shooting the moon");
});

test("Hard sees a moon coming and takes a heart from the shooter", () => {
  // Seat 3 took the first two tricks with hearts in them; seat 0 can beat its lead.
  const state = {
    players: 4,
    phase: "play",
    turn: 0,
    winner: -1,
    tricks: 3,
    broken: true,
    dir: "none",
    picks: [null, null, null, null],
    hands: [[0, 1, 2], [], [], []],
    trick: [{ p: 3, slot: 90, face: c("5H") }],
    played: [
      ...[[3, "AC"], [0, "2C"], [1, "3H"], [2, "4H"]].map(([p, n], i) => ({ p, face: c(n), trick: 0, lead: i === 0 })),
      ...[[3, "KC"], [0, "3C"], [1, "6H"], [2, "QS"]].map(([p, n], i) => ({ p, face: c(n), trick: 1, lead: i === 0 })),
      ...[[3, "QC"], [0, "4C"], [1, "7H"], [2, "8H"]].map(([p, n], i) => ({ p, face: c(n), trick: 2, lead: i === 0 })),
      { p: 3, face: c("5H"), trick: 3, lead: true },
    ],
  };
  const faces = { 0: c("2H"), 1: c("9H"), 2: c("AD") };
  assert.deepEqual(pointsTaken(state), [0, 0, 0, 18]);
  assert.equal(moonThreat(state, 0), 3);
  assert.equal(chooseMove(state, 0, () => 0, (s) => faces[s] ?? null, { level: "hard" }).play, 1, "the 9 of hearts takes it");
  assert.equal(chooseMove(state, 0, () => 0, (s) => faces[s] ?? null, { level: "medium" }).play, 0, "Medium just ducks");
});

// Seat 0 took the first two tricks, with the queen and a heart; now seat 2 leads hearts.
function midHand(hand) {
  const plays = [
    [[0, "AC"], [1, "2C"], [2, "3C"], [3, "QS"]],
    [[0, "KC"], [1, "4C"], [2, "5C"], [3, "2H"]],
    [[2, "3H"], [3, "4H"]],
  ];
  const played = plays.flatMap((t, i) => t.map(([p, n], j) => ({ p, face: c(n), trick: i, lead: j === 0 })));
  const state = { players: 4, phase: "play", turn: 0, winner: -1, tricks: 2, broken: true, dir: "none", picks: [null, null, null, null], hands: [hand.map((_, i) => i), [], [], []], trick: played.slice(-2).map((x, i) => ({ p: x.p, slot: 90 + i, face: x.face })), played };
  return { state, face: (s) => (s < hand.length ? hand[s] : null) };
}

test("Hard shoots the moon: with every point so far and the top cards left, it takes the trick", () => {
  const { state, face } = midHand(cards("AH KH AD"));
  assert.deepEqual(pointsTaken(state), [14, 0, 0, 0]);
  assert.equal(chooseMove(state, 0, () => 0, face, { level: "hard" }).play, 0, "the ace, to take every heart");
  assert.equal(chooseMove(state, 0, () => 0, face, { level: "medium" }).play, 1, "Medium plays its lowest");
  // With a heart still out above its own, it gives up the moon and plays low.
  const low = midHand(cards("KH 9H AD"));
  assert.equal(chooseMove(low.state, 0, () => 0, low.face, { level: "hard" }).play, 1);
});

test("Hard's pass keeps a moon hand's high cards, and a hand that may shoot is spotted", () => {
  const moon = cards("AH KH QH JH 10H 9H AS KS AC KC AD 2C 3D");
  assert.ok(moonHand(moon));
  assert.ok(!moonHand(cards("2H 3H 4H AS KS QS 2C 3C 4C 5D 6D 7D 8D")));
  const rest = Array.from({ length: 52 }, (_, f) => f).filter((f) => !moon.includes(f));
  const order = [];
  for (let r = 0; r < 13; r++) order.push(moon[r], rest[r * 3], rest[r * 3 + 1], rest[r * 3 + 2]);
  const deck = new KnownDeck(order);
  const state = makeRules({}, 4).newState(0, 4, deck);
  const passed = chooseMove(state, 0, () => 0, deck.view(0), { level: "hard" }).pass.map((s) => deck.slots[s].face);
  assert.ok(passed.includes(c("2C")) && passed.includes(c("3D")), "the low cards go");
  assert.ok(!passed.some((f) => suitOf(f) === 1), "the hearts stay");
});

test("the timer's move: the forced one, else what Hard would do", () => {
  const { state, deck } = position(PASSING, [[0, "2C"]]);
  assert.deepEqual(timeoutMove(state, 1, deck.view(1)), chooseMove(state, 1, () => 0, deck.view(1), { level: "hard" }));
  const { state: mine, deck: d2 } = position(PASSING);
  assert.deepEqual(timeoutMove(mine, 0, d2.view(0)), { play: mine.hands[0].find((s) => d2.slots[s].face === c("2C")) }, "the 2 of clubs, forced");
});

test("knowledge: voids from every card played, and every card accounted for", () => {
  let checked = 0;
  game(["hard", "easy", "easy", "easy"], "know", {
    onChoice(state, p, m, deck) {
      if (p !== 0 || state.phase !== "play") return;
      const know = knowledge(state, 0, deck.view(0));
      for (const [q, voids] of know.voids.entries()) {
        for (const suit of voids) assert.ok(!state.hands[q].some((s) => suitOf(deck.slots[s].face) === suit), `seat ${q} void in ${suit}`);
      }
      assert.equal(know.out.length + know.mine.length + know.played.size, 52);
      assert.ok(legalPlays(state, 0, (s) => cardFace(4, deck.view(0)(s))).length > 0);
      checked++;
    },
  });
  assert.ok(checked > 20);
});
