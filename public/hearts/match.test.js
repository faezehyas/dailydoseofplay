// Hearts over the real card engine: a robot in each of four seats of a
// localRoom(), each running its own CardMatch, shuffling with proofs (again
// before every hand), passing cards sealed to their seat and auditing at the
// end. Every seat ends on the same state, the audit passes, no seat ever
// knows a card that isn't open, its own or one it passed, and every lie only
// the audit can see is caught and names the liar.
import test from "node:test";
import assert from "node:assert/strict";
import { localRoom } from "../engine/room.js";
import { CardMatch } from "../engine/card-match.js";
import { matchRouter } from "../engine/session.js";
import { rngFromSeed } from "../engine/rng.js";
import { suitOf } from "../engine/cards/faces.js";
import { makeRules, cardsOf, isPoint, TWO_CLUBS, HEARTS } from "./rules.js";
import { chooseMove, startRobot } from "./robot.js";
import { withSeededRandom } from "../../test/helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 280_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}
const done = (m) => m.verdict || m.phase === "aborted";

// Every face a seat knows is open to all, or a card it holds or held (one it passed on).
function assertNoLeaks(match, held) {
  for (const [id, s] of match.slots.entries()) if (s.owner === match.me) held.add(id);
  for (const [id, s] of match.slots.entries()) {
    if (s.face !== null && !s.gone) assert.ok(s.open || held.has(id), `seat ${match.me} knows hidden slot ${id}`);
  }
}

// choose(i, match) gives seat i's chooser; the rest play Hard.
async function play({ players = 4, config = {}, choose = () => null, seed = "" }) {
  const sessions = localRoom({ game: "hearts", names: Array.from({ length: players }, (_, i) => `P${i}`), mode: "friend" });
  const rules = makeRules(config, players);
  const robots = [];
  for (const [i, s] of sessions.entries()) {
    const own = choose(i, () => robots[i].match);
    robots.push(startRobot(s, { rules, choose: own ?? ((st, me, rng, face) => chooseMove(st, me, rng, face, { level: "hard" })), delay: () => 0, rng: rngFromSeed(`seat ${i} ${seed}`) }));
  }
  let checks = 0;
  for (const r of robots) {
    const held = new Set();
    r.match.on("update", () => {
      assertNoLeaks(r.match, held);
      checks++;
    });
  }
  try {
    await until(() => robots.every((r) => done(r.match)));
  } finally {
    for (const r of robots) r.destroy();
  }
  return { matches: robots.map((r) => r.match), checks };
}

test("four seats, a game to 50: the same state everywhere, every pass sealed, a passing audit and no seat knowing another's card", { timeout: 300_000 }, () => withSeededRandom("hearts 1", async () => {
  const { matches, checks } = await play({ config: { target: 50 }, seed: "full" });
  for (const m of matches) {
    assert.equal(m.phase, "over", m.abortReason);
    assert.deepEqual(m.verdict, { ok: true });
    assert.deepEqual(m.state, matches[0].state);
  }
  const st = matches[0].state;
  assert.ok(checks >= 4 * st.moves);
  assert.ok(st.history.length >= 2, "several hands, each shuffled again");
  assert.ok(Math.max(...st.scores) >= 50);
  // Three cards from each seat on every hand that passed.
  const passing = st.history.filter((h) => h.dir !== "none").length;
  assert.equal(matches[0].sealed.length, 12 * passing);
  // Once the audit has passed, every seat can read the last hand's cards: one full deck.
  for (const m of matches) assert.deepEqual(st.cards.map((s) => cardsOf(4, (x) => m.face(x))(s)).sort((a, b) => a - b), [...Array(52).keys()]);
}));

test("three seats: 17 cards each from 51, a pass left, and a passing audit", { timeout: 300_000 }, () => withSeededRandom("hearts 2", async () => {
  const { matches } = await play({ players: 3, config: { target: 0 }, seed: "three" });
  for (const m of matches) {
    assert.deepEqual(m.verdict, { ok: true });
    assert.deepEqual(m.state, matches[0].state);
  }
  assert.equal(matches[0].sealed.length, 9);
  assert.equal(matches[0].rules.deckSize, 51);
}));

test("a seat out of turn can't move: refused at home, and stops the match if sent anyway", { timeout: 60_000 }, () => withSeededRandom("hearts 3", async () => {
  const sessions = localRoom({ game: "hearts", names: ["A", "B", "C", "D"], mode: "friend" });
  const rules = makeRules({}, 4);
  const matches = sessions.map((s) => {
    const m = new CardMatch({ send: (msg) => s.send(msg), me: s.index, players: 4, rules });
    matchRouter(s).start(m);
    return m;
  });
  await until(() => matches.every((m) => m.phase === "playing"));
  const idle = matches.find((m) => !m.canMove() && m.state.turn !== m.me);
  const invalid = [];
  idle.on("invalid", (why) => invalid.push(why));
  await idle.play({ pass: idle.state.hands[idle.me].slice(0, 3) });
  assert.deepEqual(invalid, ["not your turn"]);
  sessions[idle.me].send({ t: "move", m: 1, move: { pass: idle.state.hands[idle.me].slice(0, 3) }, sh: [] });
  const others = matches.filter((m) => m !== idle);
  await until(() => others.every((m) => m.phase === "aborted"));
  for (const m of others) {
    assert.ok(m.abortSeat === idle.me || m.abortAbout === idle.me);
    assert.match(m.abortReason, /moved out of turn/);
  }
}));

// A seat that lies when it can: lie(state, me, face) returns an illegal move or null;
// prep(state, me, face), a legal move that sets one up.
function liar(lie, prep = () => null) {
  let lies = 0;
  let who = -1;
  const choose = (st, me, rng, face) => {
    const cards = cardsOf(st.players, face);
    const move = st.winner === -1 && st.turn === me ? lie(st, me, cards) : null;
    if (move && !lies++) who = me;
    return move ?? prep(st, me, cards) ?? chooseMove(st, me, rng, face, { level: "hard" });
  };
  return { choose, lies: () => lies, who: () => who };
}

// Plays one-hand games until a liar (seat 1, or any of `seats`) has lied, then checks every seat's verdict names it.
async function caught(lie, reason, prep, seats = [1]) {
  let cheat, matches;
  for (let game = 0; game < 8 && !cheat?.lies(); game++) {
    cheat = liar(lie, prep);
    ({ matches } = await play({ config: { target: 0 }, choose: (i) => (seats.includes(i) ? cheat.choose : null), seed: `${reason} ${game}` }));
  }
  assert.ok(cheat.lies() > 0, "the liar got a chance to lie");
  for (const m of matches) {
    assert.equal(m.phase, "over", m.abortReason);
    assert.equal(m.verdict.ok, false);
    assert.equal(m.verdict.seat, cheat.who(), `seat ${m.me} names seat ${m.verdict.seat}`);
    assert.match(m.verdict.reason, reason);
  }
}

const hand = (st, me, face) => st.hands[me].map((s) => [s, face(s)]);

test("the audit names a player who didn't follow suit while holding it", { timeout: 300_000 }, () => withSeededRandom("hearts 4", async () => {
  await caught((st, me, face) => {
    if (st.phase !== "play" || !st.trick.length) return null;
    const lead = suitOf(st.trick[0].face);
    const mine = hand(st, me, face);
    const off = mine.find(([, f]) => suitOf(f) !== lead && !(st.tricks === 0 && isPoint(f)));
    return mine.some(([, f]) => suitOf(f) === lead) && off ? { play: off[0] } : null;
  }, /didn't follow suit/);
}));

test("the audit names a player who led a heart before hearts were broken", { timeout: 300_000 }, () => withSeededRandom("hearts 5", async () => {
  await caught((st, me, face) => {
    if (st.phase !== "play" || st.trick.length || st.broken) return null;
    const mine = hand(st, me, face);
    const heart = mine.find(([, f]) => suitOf(f) === HEARTS);
    return heart && mine.some(([, f]) => suitOf(f) !== HEARTS) ? { play: heart[0] } : null;
  }, /led a heart before hearts were broken/, undefined, [0, 1, 2, 3]);
}));

test("the audit names a player who threw a point card on the first trick while holding something else", { timeout: 300_000 }, () => withSeededRandom("hearts 6", async () => {
  // It passes its clubs when it has three or fewer, to be out of them on the first trick.
  const passClubs = (st, me, face) => {
    if (st.phase !== "pass") return null;
    const mine = hand(st, me, face).sort(([, a], [, b]) => (suitOf(b) === 3) - (suitOf(a) === 3));
    return mine.filter(([, f]) => suitOf(f) === 3).length <= 3 ? { pass: mine.slice(0, 3).map(([s]) => s) } : null;
  };
  await caught((st, me, face) => {
    if (st.phase !== "play" || st.tricks !== 0 || !st.trick.length) return null;
    const mine = hand(st, me, face);
    if (mine.some(([, f]) => suitOf(f) === suitOf(st.trick[0].face))) return null;
    const point = mine.find(([, f]) => isPoint(f));
    return point && mine.some(([, f]) => !isPoint(f)) ? { play: point[0] } : null;
  }, /point card on the first trick/, passClubs, [0, 1, 2, 3]);
}));

test("the audit names a player who said they hadn't got the 2 of clubs", { timeout: 300_000 }, () => withSeededRandom("hearts 7", async () => {
  // Whoever holds it lies, so every game has the lie; the game stops when nobody plays it.
  const lie = (st, me, face) => (st.phase === "find" && st.hands[me].some((s) => face(s) === TWO_CLUBS) ? { none: true } : null);
  await caught(lie, /didn't have the 2 of clubs/, undefined, [0, 1, 2, 3]);
}));
