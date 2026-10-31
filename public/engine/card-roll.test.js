// Rolls in a card game (rules.needsRandom): drawn by everyone once the move is
// sent, kept with the move and replayed by the audit.
import test from "node:test";
import assert from "node:assert/strict";
import { localRoom } from "./room.js";
import { CardMatch, startCardRobot } from "./card-match.js";
import { rngFromSeed } from "./rng.js";
import { RuleError } from "./turn-match.js";
import { withSeededRandom } from "../../test/helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 60_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}
const done = (m) => m.verdict || m.phase === "aborted";

function tap(session, change) {
  const send = session.send.bind(session);
  session.send = (msg) => {
    const out = change(msg);
    return out === null ? true : send(out ?? msg);
  };
}

// A random board is laid out and each seat is dealt `hand` cards. On your
// turn roll a die (an even roll draws a hidden card) or play a card face up.
// A sneak uses the die without saying so. After `turns` turns the most cards win.
function rollRules({ deckSize = 14, hand = 2, turns = 18, draws } = {}) {
  return {
    deckSize,
    draws,
    newState(first, players, deck, rng) {
      const board = Array.from({ length: 8 }, () => Math.floor(rng() * 6));
      const draw = deck.cards.slice();
      const hands = Array.from({ length: players }, (_, p) => draw.splice(0, hand).map((slot) => (deck.deal(slot, p), slot)));
      return { turn: first, winner: -1, players, board, draw, hands, rolls: [], played: [], turns: 0 };
    },
    needsRandom: (state, move) => move?.roll === true,
    reveals: (state, player, move) => (Number.isInteger(move?.play) ? [move.play] : []),
    applyMove(state, player, move, deck, rng) {
      if (state.turn !== player) throw new RuleError("not your turn");
      const hand = state.hands[player];
      if (move?.roll || move?.sneak) {
        const die = 1 + Math.floor(rng() * 6);
        state.rolls.push([player, die]);
        if (die % 2 === 0 && state.draw.length) {
          const slot = state.draw.shift();
          deck.deal(slot, player);
          hand.push(slot);
        }
      } else if (Number.isInteger(move?.play) && hand.includes(move.play)) {
        hand.splice(hand.indexOf(move.play), 1);
        state.played.push([player, deck.face(move.play)]);
      } else throw new RuleError("bad move");
      if (++state.turns === turns) {
        const sizes = state.hands.map((h) => h.length);
        state.winner = sizes.indexOf(Math.max(...sizes));
      } else state.turn = (player + 1) % state.players;
      return [];
    },
  };
}

const chooseRoll = (state, me, rng) => (state.hands[me].length && rng() < 0.3 ? { play: state.hands[me][0] } : { roll: true });

async function play({ players = 3, rules = rollRules(), choose = chooseRoll, before = () => {} } = {}) {
  const sessions = localRoom({ game: "toy", names: Array.from({ length: players }, (_, i) => `P${i}`) });
  before(sessions);
  const robots = sessions.map((s, i) => startCardRobot(s, { rules, choose, delay: 0, rng: rngFromSeed(`seat${i}`) }));
  await until(() => robots.every((r) => done(r.match)));
  return robots.map((r) => r.match);
}

test("three players: a random board, rolls and hidden cards in one game, the same everywhere, and the audit replays every roll", () => withSeededRandom("card-roll 1", async () => {
  const matches = await play();
  const { board, rolls, hands } = matches[0].state;
  assert.ok(new Set(board).size > 2, "the board varies");
  for (const m of matches) {
    assert.deepEqual(m.verdict, { ok: true });
    assert.deepEqual(m.state, matches[0].state);
    for (const [id, s] of m.slots.entries()) if (s.face !== null) assert.ok(s.open || s.owner === m.me, `seat ${m.me} knows hidden slot ${id}`);
  }
  assert.ok(rolls.length >= 8, `${rolls.length} rolls`);
  assert.ok(rolls.every(([, die]) => die >= 1 && die <= 6));
  assert.ok(new Set(rolls.map(([, die]) => die)).size > 2, "the dice vary");
  assert.ok(hands.some((h) => h.length > 2), "an even roll drew a card");
}));

test("a roll is drawn only once its move is sent, so the mover can't see it first", () => withSeededRandom("card-roll 2", async () => {
  const wire = [];
  await play({ before: (sessions) => sessions.forEach((s) => tap(s, (msg) => void wire.push(msg))) });
  let moves = 0;
  for (const msg of wire) {
    if (msg.t === "move" && msg.move.roll) moves++;
    // Draw 1 picks who starts; draw k is roll k - 1.
    if (msg.t === "draw" && msg.k > 1) assert.ok(msg.k - 1 <= moves, `draw ${msg.k} went out after only ${moves} rolling moves`);
  }
  assert.ok(moves >= 8);
}));

test("a move that rolls without saying so is refused in my browser, and stops the match if sent anyway", () => withSeededRandom("card-roll 3", async () => {
  const rules = rollRules();
  const sessions = localRoom({ game: "toy", names: ["A", "B"] });
  const [a, b] = sessions.map((s) => new CardMatch({ send: (msg) => s.send(msg), me: s.index, players: 2, rules }));
  sessions.forEach((s, i) => s.onMessage((msg, from) => [a, b][i].receive(msg, from)));
  await until(() => a.phase === "playing" && b.phase === "playing");
  const mover = a.state.turn === 0 ? a : b;
  const other = mover === a ? b : a;
  const invalid = [];
  mover.on("invalid", (why) => invalid.push(why));
  await mover.play({ sneak: true });
  assert.deepEqual(invalid, ["this move may not use randomness"]);
  sessions[mover.me].send({ t: "move", m: 1, move: { sneak: true }, sh: [] });
  await until(() => other.phase === "aborted");
  assert.equal(other.abortSeat, mover.me);
  assert.match(other.abortReason, /broke the rules: this move may not use randomness/);
}));

test("rolling more often than the rules' draws stops the match instead of hanging", () => withSeededRandom("card-roll 4", async () => {
  const matches = await play({ players: 2, rules: rollRules({ draws: 3 }), choose: () => ({ roll: true }) });
  for (const m of matches) {
    assert.equal(m.phase, "aborted");
    assert.match(m.abortReason, /hash chain exhausted/);
    assert.equal(m.state.rolls.length, 3);
  }
}));
