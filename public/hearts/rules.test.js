import test from "node:test";
import assert from "node:assert/strict";
import { KnownDeck, shuffled } from "../../test/fixtures/known-deck.js";
import { rngFromSeed } from "../engine/rng.js";
import { suitOf } from "../engine/cards/faces.js";
import { makeRules, normalizeConfig, legalPlays, forcedMove, trickWinner, cardFace, deckSize, passTo, DEFAULT_CONFIG, TWO_CLUBS, QUEEN_SPADES, JACK_DIAMONDS, TWO_DIAMONDS, HEARTS, CLUBS, SPADES, DIAMONDS } from "./rules.js";
import { chooseMove } from "./robot.js";

// "QS" is the queen of spades; "10H", "AC".
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const c = (name) => "SHDC".indexOf(name.at(-1)) * 13 + RANKS.indexOf(name.slice(0, -1));
const cards = (names) => names.split(" ").map(c);
const suit = (s) => Array.from({ length: 13 }, (_, r) => s * 13 + ((r + 1) % 13)); // 2 up to the ace
const throwsRule = (f, re) => assert.throws(f, (err) => err.name === "RuleError" && (!re || re.test(err.message)));

// A deck that deals these hands (the opener first), and a game on it.
function dealt(hands, config = {}, { first = 0 } = {}) {
  const n = hands.length;
  const faces = [];
  for (let r = 0; r < hands[0].length; r++) for (let k = 0; k < n; k++) faces.push(hands[(first + k) % n][r]);
  const deck = new KnownDeck(faces.map((f) => (n === 3 && f > TWO_DIAMONDS ? f - 1 : f)));
  const rules = makeRules(config, n);
  const st = rules.newState(first, n, deck);
  const faceOf = (s) => cardFace(n, deck.slots[s].face);
  const slotOf = (p, name) => st.hands[p].find((s) => faceOf(s) === (typeof name === "number" ? name : c(name)));
  // A move as CardMatch makes it: the cards it shows open first.
  const move = (p, m) => {
    for (const id of rules.reveals(st, p, m)) deck.slots[id].open = true;
    return rules.applyMove(st, p, m, deck);
  };
  return { st, deck, rules, move, faceOf, slotOf, play: (p, name) => move(p, { play: slotOf(p, name) }) };
}

// Each seat one suit: 0 clubs, 1 hearts, 2 spades, 3 diamonds. Seat 0 leads every trick and takes it.
const SUITED = [CLUBS, HEARTS, SPADES, DIAMONDS].map(suit);

// Plays SUITED out: seat 2 throws the queen on the second trick, seat 3 the jack on the third.
function suitedHand(g) {
  const plays = SUITED.map((h) => h.slice());
  plays[2].splice(1, 0, ...plays[2].splice(plays[2].indexOf(QUEEN_SPADES), 1));
  plays[3].splice(2, 0, ...plays[3].splice(plays[3].indexOf(JACK_DIAMONDS), 1));
  const events = [];
  for (let t = 0; t < 13; t++) for (let p = 0; p < 4; p++) events.push(...g.play(p, plays[p][t]));
  return events;
}

// Plays robots to the end of the game; each(state) runs after every move.
function playOut(st, rules, deck, { levels, seed, each = () => {} }) {
  const rng = rngFromSeed(seed);
  for (let moves = 0; st.winner === -1; moves++) {
    if (moves > 20_000) throw new Error("the game didn't finish");
    const p = st.turn;
    const move = chooseMove(st, p, rng, deck.view(p), { level: levels[p] });
    for (const id of rules.reveals(st, p, move)) deck.slots[id].open = true;
    rules.applyMove(st, p, move, deck);
    each(st);
  }
}

test("the deal: 13 cards each from one full deck, then a pass to the left, the opener first", () => {
  const deck = new KnownDeck(shuffled("deal"));
  const st = makeRules({}, 4).newState(2, 4, deck);
  assert.deepEqual(st.hands.map((h) => h.length), [13, 13, 13, 13]);
  assert.equal(new Set(st.hands.flat()).size, 52);
  for (const [p, h] of st.hands.entries()) for (const s of h) assert.equal(deck.owner(s), p);
  assert.deepEqual([st.phase, st.dir, st.turn, st.opener], ["pass", "left", 2, 2]);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ target: 7, moon: "x", robots: 1, jack: "yes" }), DEFAULT_CONFIG);
});

test("the pass: everyone picks before anyone receives; left, right, across, none, round again", () => {
  const rules = makeRules({}, 4);
  const deck = new KnownDeck(shuffled("cycle"), "cycle");
  const st = rules.newState(0, 4, deck);
  const before = st.hands.map((h) => h.slice());
  for (let p = 0; p < 3; p++) rules.applyMove(st, p, { pass: st.hands[p].slice(0, 3) }, deck);
  assert.deepEqual(st.hands, before, "nobody has received yet");
  assert.deepEqual(st.received, [[], [], [], []]);
  const last = st.hands[3].slice(0, 3);
  rules.applyMove(st, 3, { pass: last }, deck);
  assert.deepEqual(st.received[0], last, "seat 3's cards go to its left, seat 0");
  for (let p = 0; p < 4; p++) {
    assert.equal(st.hands[p].length, 13);
    for (const s of st.received[p]) assert.equal(deck.owner(s), p);
    for (const s of st.picks[p]) assert.ok(!st.hands[p].includes(s));
  }
  assert.deepEqual([st.phase, st.turn], ["find", 0]);
  const dirs = [st.dir];
  playOut(st, rules, deck, {
    levels: ["easy", "easy", "easy", "easy"],
    seed: "cycle",
    each: (s) => {
      if (s.hand === dirs.length + 1) {
        dirs.push(s.dir);
        assert.equal(s.opener, (s.hand - 1) % 4, "the opener moves on a seat each hand");
        assert.equal(s.phase, s.dir === "none" ? "find" : "pass");
      }
    },
  });
  assert.deepEqual(dirs.slice(0, 5), ["left", "right", "across", "none", "left"]);
  assert.deepEqual([0, 1, 2, 3].map((p) => passTo({ dir: "across", players: 4 }, p)), [2, 3, 0, 1]);
  assert.deepEqual([0, 1, 2, 3].map((p) => passTo({ dir: "right", players: 4 }, p)), [3, 0, 1, 2]);
});

test("passing off: no pass, straight to the 2 of clubs", () => {
  const st = makeRules({ passing: false }, 4).newState(1, 4, new KnownDeck(shuffled("off")));
  assert.deepEqual([st.dir, st.phase, st.turn], ["none", "find", 1]);
});

test("a pass must be three different cards of your own, in turn", () => {
  const g = dealt(SUITED);
  const mine = g.st.hands[0];
  throwsRule(() => g.move(0, { pass: mine.slice(0, 2) }), /pass 3 cards/);
  throwsRule(() => g.move(0, { pass: [mine[0], mine[0], mine[1]] }), /pass 3 cards/);
  throwsRule(() => g.move(0, { pass: [mine[0], mine[1], g.st.hands[1][0]] }), /pass 3 cards/);
  throwsRule(() => g.move(1, { pass: g.st.hands[1].slice(0, 3) }), /not your turn/);
  throwsRule(() => g.move(0, { play: mine[0] }), /doesn't fit now/);
  throwsRule(() => g.move(0, null), /bad move/);
});

test("the 2 of clubs leads: whoever holds it plays it, and the others say they haven't got it", () => {
  const g = dealt([SUITED[1], SUITED[2], SUITED[0], SUITED[3]], { passing: false });
  assert.deepEqual(forcedMove(g.st, 0, g.faceOf), { none: true });
  g.move(0, { none: true });
  g.move(1, { none: true });
  throwsRule(() => g.move(2, { none: true }), /didn't have the 2 of clubs/);
  throwsRule(() => g.play(2, "3C"), /the 2 of clubs leads/);
  assert.deepEqual(forcedMove(g.st, 2, g.faceOf), { play: g.slotOf(2, "2C") });
  g.play(2, "2C");
  assert.deepEqual([g.st.phase, g.st.turn, g.st.trick.length], ["play", 3, 1]);
});

test("everyone saying they haven't got the 2 of clubs ends the game, and the audit names the liar", () => {
  const g = dealt(SUITED, { passing: false });
  g.deck.blind = true; // in play, seat 0's lie can't be seen
  for (let p = 0; p < 4; p++) g.move(p, { none: true });
  assert.deepEqual([g.st.phase, g.st.winner, g.st.winners], ["over", -2, []]);
  throwsRule(() => dealt(SUITED, { passing: false }).move(0, { none: true }), /didn't have the 2 of clubs/);
});

// Seat 0 clubs and low hearts, seat 1 one club, spades and high hearts, seat 2 no clubs, seat 3 the rest.
const MIXED = [
  cards("2C 3C 4C 2H 3H 4H 5H 6H 7H 8H 2D 3D 4D"),
  cards("5C 2S 3S 4S 5S 6S 9H 10H JH QH KH AH 5D"),
  cards("QS KS AS 7S 8S 9S 10S JS 6D 7D 8D 9D 10D"),
  cards("6C 7C 8C 9C 10C JC QC KC AC JD QD KD AD"),
];

test("following suit: another suit, with the suit led in hand, is refused once the faces are known", () => {
  const g = dealt(MIXED, { passing: false });
  g.play(0, "2C");
  throwsRule(() => g.play(1, "2S"), /didn't follow suit/);
  assert.deepEqual(legalPlays(g.st, 1, g.faceOf), [g.slotOf(1, "5C")]);
  assert.deepEqual(forcedMove(g.st, 1, g.faceOf), { play: g.slotOf(1, "5C") }, "an only legal card is played for you");
  // In play the rest of the hand is hidden, so it goes through: only the audit can tell.
  const live = dealt(MIXED, { passing: false });
  live.play(0, "2C");
  live.deck.blind = true;
  live.play(1, "2S");
  assert.equal(live.st.trick.length, 2);
});

test("the first trick: no heart or queen of spades unless there's nothing else", () => {
  const g = dealt(MIXED, { passing: false });
  g.play(0, "2C");
  g.play(1, "5C");
  throwsRule(() => g.play(2, "QS"), /point card on the first trick/);
  const legal = legalPlays(g.st, 2, g.faceOf).map(g.faceOf);
  assert.equal(legal.length, 12);
  assert.ok(!legal.includes(QUEEN_SPADES));
  g.play(2, "AS");
  g.play(3, "AC");
  assert.equal(g.st.turn, 3, "the ace of clubs took it: aces are high, and the ace of spades was off suit");
  assert.equal(g.st.broken, false);
  // A hand of nothing but hearts may play one on the first trick.
  const h = dealt([suit(CLUBS), suit(HEARTS), suit(SPADES), suit(DIAMONDS)], { passing: false });
  h.play(0, "2C");
  assert.equal(legalPlays(h.st, 1, h.faceOf).length, 13);
  h.play(1, "AH");
  assert.equal(h.st.broken, true);
});

// Seat 1 takes the first trick with the ace of clubs: with D_LEAD it still holds clubs, with D_HEARTS only hearts.
const D_LEAD = [cards("2C 2H 3H 4H 5H 6H 7H 2D 3D 4D 5D 6D 7D"), cards("3C 4C 5C 6C 7C 8C 9C 10C JC QC KC AC 8H"), suit(SPADES), cards("8D 9D 10D JD QD KD AD 9H 10H JH QH KH AH")];
const D_HEARTS = [cards("2C 3C 4C 5C 6C 7C 8C 9C 10C JC QC KC AH"), cards("AC 2H 3H 4H 5H 6H 7H 8H 9H 10H JH QH KH"), suit(SPADES), suit(DIAMONDS)];

test("hearts can't be led before they're broken (by a heart or the queen), unless your hand is all hearts", () => {
  const g = dealt(D_LEAD, { passing: false });
  for (const [p, name] of [[0, "2C"], [1, "AC"], [2, "2S"], [3, "8D"]]) g.play(p, name);
  assert.equal(g.st.turn, 1);
  throwsRule(() => g.play(1, "8H"), /before hearts were broken/);
  assert.deepEqual(legalPlays(g.st, 1, g.faceOf).map(g.faceOf).filter((f) => suitOf(f) === HEARTS), []);
  assert.equal(g.st.broken, false, "clubs, a spade and a diamond don't break them");
  g.play(1, "3C");
  assert.deepEqual(g.play(2, "QS").find((e) => e.type === "broken"), { type: "broken", p: 2, face: QUEEN_SPADES });
  g.play(3, "9D");
  g.play(0, "2D");
  assert.deepEqual([g.st.turn, g.st.points[1]], [1, 13], "seat 1 took the queen");
  g.play(1, "8H");
  assert.equal(g.st.trick.length, 1, "the queen broke them: a heart may be led");
  // All hearts: lead one.
  const h = dealt(D_HEARTS, { passing: false });
  for (const [p, name] of [[0, "2C"], [1, "AC"], [2, "2S"], [3, "2D"]]) h.play(p, name);
  assert.equal(legalPlays(h.st, 1, h.faceOf).length, 12);
  h.play(1, "2H");
  assert.equal(h.st.broken, true);
});

test("the trick goes to the highest card of the suit led, aces high", () => {
  assert.equal(trickWinner([{ p: 0, face: c("2C") }, { p: 1, face: c("AH") }, { p: 2, face: c("3C") }, { p: 3, face: c("KS") }]), 2);
  assert.equal(trickWinner([{ p: 1, face: c("KC") }, { p: 2, face: c("AC") }, { p: 3, face: c("QC") }]), 2);
  assert.equal(trickWinner([{ p: 3, face: c("2D") }, { p: 0, face: c("AS") }]), 3);
});

test("shooting the moon: the others take 26 each (classic), or the shooter loses 26", () => {
  const g = dealt(SUITED, { passing: false });
  const events = suitedHand(g);
  const score = events.find((e) => e.type === "score");
  assert.deepEqual([score.raw, score.moon, score.add, g.st.scores], [[26, 0, 0, 0], 0, [0, 26, 26, 26], [0, 26, 26, 26]]);
  assert.equal(events.filter((e) => e.type === "trick").length, 13);
  assert.ok(events.filter((e) => e.type === "trick").every((e) => e.winner === 0));
  const m = dealt(SUITED, { passing: false, moon: "minus" });
  suitedHand(m);
  assert.deepEqual(m.st.scores, [-26, 0, 0, 0]);
});

test("the jack of diamonds, when on, is worth -10 to whoever takes it", () => {
  const g = dealt(SUITED, { passing: false, jack: true });
  suitedHand(g);
  assert.deepEqual(g.st.result.add, [-10, 26, 26, 26]);
  assert.equal(g.st.result.jack, 0);
});

test("the game ends when someone reaches the target: the lowest score wins; a tie at the bottom plays on", () => {
  const g = dealt(SUITED, { passing: false });
  g.st.scores = [60, 80, 90, 85];
  const events = suitedHand(g);
  assert.deepEqual([g.st.phase, g.st.winner, g.st.winners, g.st.scores], ["over", 0, [0], [60, 106, 116, 111]]);
  assert.deepEqual(events.at(-1), { type: "over", winners: [0], scores: [60, 106, 116, 111] });
  throwsRule(() => g.move(0, { next: true }), /the game is over/);
  const tie = dealt(SUITED, { passing: false });
  tie.st.scores = [80, 54, 90, 85];
  suitedHand(tie);
  assert.deepEqual([tie.st.phase, tie.st.winner, tie.st.scores], ["result", -1, [80, 80, 116, 111]], "two at 80: another hand");
  assert.deepEqual(forcedMove(tie.st, tie.st.turn, tie.faceOf), { next: true });
  const events2 = tie.move(tie.st.turn, { next: true });
  assert.deepEqual(events2.map((e) => e.type), ["gather", "deal"]);
  assert.deepEqual([tie.st.hand, tie.st.opener, tie.st.dir, tie.st.phase], [2, 1, "none", "find"]);
  const fifty = dealt(SUITED, { passing: false, target: 50 });
  fifty.st.scores = [10, 30, 20, 40];
  suitedHand(fifty);
  assert.deepEqual([fifty.st.winner, fifty.st.scores], [0, [10, 56, 46, 66]]);
});

test("one hand a game: it ends after the hand, and players level at the bottom share the win", () => {
  const g = dealt(SUITED, { passing: false, target: 0 });
  suitedHand(g);
  assert.deepEqual([g.st.phase, g.st.winner, g.st.winners], ["over", 0, [0]]);
  const shared = dealt(SUITED, { passing: false, target: 0 });
  shared.st.scores = [26, 0, 0, 0];
  suitedHand(shared);
  assert.deepEqual([shared.st.winner, shared.st.winners, shared.st.scores], [-2, [0, 1, 2, 3], [26, 26, 26, 26]]);
});

test("three players: 17 cards each from 51 (the 2 of diamonds left out), passing left then right", () => {
  assert.equal(deckSize(3), 51);
  assert.equal(makeRules({}, 3).deckSize, 51);
  const deck = new KnownDeck(shuffled("three").filter((f) => f < 51), "three");
  const rules = makeRules({}, 3);
  const st = rules.newState(0, 3, deck);
  assert.deepEqual(st.hands.map((h) => h.length), [17, 17, 17]);
  const faces = st.hands.flat().map((s) => cardFace(3, deck.slots[s].face));
  assert.equal(new Set(faces).size, 51);
  assert.ok(!faces.includes(TWO_DIAMONDS));
  assert.ok(faces.includes(c("3D")) && faces.includes(c("AC")) && faces.includes(TWO_CLUBS));
  const dirs = [st.dir];
  playOut(st, rules, deck, { levels: ["hard", "medium", "easy"], seed: "three", each: (s) => s.hand === dirs.length + 1 && dirs.push(s.dir) });
  assert.deepEqual(dirs.slice(0, 3), ["left", "right", "left"]);
  for (const h of st.history) assert.equal(h.raw.reduce((a, b) => a + b, 0), 26);
  assert.throws(() => makeRules({}, 3).newState(0, 4, new KnownDeck(shuffled("x"))), /for 3 players/);
});

test("a played card must be in your hand, and every move needs its phase and your turn", () => {
  const g = dealt(MIXED, { passing: false });
  throwsRule(() => g.move(0, { play: g.slotOf(1, "5C") }), /the 2 of clubs leads|play a card from your hand/);
  g.play(0, "2C");
  throwsRule(() => g.move(1, { play: g.slotOf(2, "AS") }), /play a card from your hand/);
  throwsRule(() => g.move(2, { play: g.slotOf(2, "AS") }), /not your turn/);
  throwsRule(() => g.move(1, { none: true }), /doesn't fit now/);
  throwsRule(() => g.move(1, { next: true }), /doesn't fit now/);
});

for (const [name, players, config, levels] of [
  ["four easy robots, classic", 4, {}, ["easy", "easy", "easy", "easy"]],
  ["every level, to 50, the shooter -26 and the jack", 4, { target: 50, moon: "minus", jack: true }, ["hard", "medium", "easy", "hard"]],
  ["no passing, one hand", 4, { passing: false, target: 0 }, ["medium", "hard", "medium", "easy"]],
  ["three players", 3, {}, ["hard", "easy", "medium"]],
]) {
  test(`seeded full games always finish: ${name}`, () => {
    for (let i = 0; i < 6; i++) {
      const rules = makeRules(config, players);
      const deck = new KnownDeck(shuffled(`${name} ${i}`).filter((f) => f < rules.deckSize), `${name} ${i}`);
      const st = rules.newState(i % players, players, deck);
      playOut(st, rules, deck, { levels, seed: `${name} ${i}` });
      assert.ok(st.winners.length >= 1);
      const totals = st.history.reduce((t, h) => t.map((x, p) => x + h.add[p]), Array(players).fill(0));
      assert.deepEqual(totals, st.scores);
      for (const h of st.history) assert.equal(h.raw.reduce((a, b) => a + b, 0), 26, "every hand gives out 26 points");
      for (const p of st.winners) assert.equal(st.scores[p], Math.min(...st.scores));
      if (config.target !== 0) assert.ok(Math.max(...st.scores) >= (config.target ?? 100));
      else assert.equal(st.history.length, 1);
    }
  });
}

test("the moves for you: none in a pass or a real choice", () => {
  const g = dealt(MIXED);
  assert.equal(forcedMove(g.st, 0, g.faceOf), null, "the pass is a choice");
  const p = dealt(MIXED, { passing: false });
  p.play(0, "2C");
  p.play(1, "5C");
  assert.equal(forcedMove(p.st, 2, p.faceOf), null, "twelve legal cards");
  assert.equal(forcedMove(p.st, 3, p.faceOf), null, "not seat 3's turn");
  assert.equal(forcedMove(p.st, 2, () => null), null, "faces still arriving");
  assert.equal(legalPlays(p.st, 2, () => null).length, 0);
});
