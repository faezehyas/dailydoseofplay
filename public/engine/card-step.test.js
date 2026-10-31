// Steps (rules.movers): several seats choose at once, each committing to its
// move unseen before any is shown, and the moves apply in seat order.
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

// Each seat is dealt `hand` cards. A round: everyone picks a card at once and
// shows it (seat 0 sits round `sitOut` out), every hand passes in secret to
// the next seat, as in a draft, then the highest card's player claims the
// round on a turn of their own. After `hand` rounds the most claims win.
function pickRules({ deckSize = 12, hand = 3, sitOut = 1 } = {}) {
  const movers = (state) => Array.from({ length: state.players }, (_, s) => s).filter((s) => s !== 0 || state.round !== sitOut);
  return {
    deckSize,
    newState(first, players, deck) {
      const draw = deck.cards.slice();
      const hands = Array.from({ length: players }, (_, p) => draw.splice(0, hand).map((slot) => (deck.deal(slot, p), slot)));
      return { turn: first, winner: -1, players, hands, round: 0, phase: "pick", picks: Array(players).fill(null), points: Array(players).fill(0), order: [], passing: false };
    },
    movers: (state) => (state.phase === "pick" ? movers(state) : null),
    reveals: (state, player, move) => (Number.isInteger(move?.pick) ? [move.pick] : []),
    settle(state, deck) {
      if (!state.passing) return [];
      state.passing = false;
      const n = state.players;
      state.hands.forEach((hand, s) => hand.forEach((slot) => deck.pass(slot, (s + 1) % n)));
      state.hands = state.hands.map((_, s) => state.hands[(s + n - 1) % n]);
      return [];
    },
    applyMove(state, player, move, deck) {
      if (state.phase === "pick") {
        if (!movers(state).includes(player) || state.picks[player] !== null) throw new RuleError("not your pick");
        const hand = state.hands[player];
        if (!hand.includes(move?.pick)) throw new RuleError("not in your hand");
        hand.splice(hand.indexOf(move.pick), 1);
        state.picks[player] = deck.face(move.pick);
        state.order.push(player);
        if (movers(state).every((s) => state.picks[s] !== null)) {
          state.turn = state.picks.indexOf(Math.max(...state.picks));
          state.picks.fill(null);
          state.phase = "claim";
          state.passing = true;
        }
      } else {
        if (player !== state.turn || !move?.claim) throw new RuleError("not your claim");
        state.points[player]++;
        state.phase = "pick";
        if (++state.round === hand) state.winner = state.points.indexOf(Math.max(...state.points));
      }
      return [];
    },
  };
}

const choosePick = (state, me, rng) => (state.phase === "claim" ? { claim: true } : { pick: state.hands[me][Math.floor(rng() * state.hands[me].length)] });

async function play({ players = 3, rules = pickRules(), delays = [], before = () => {} } = {}) {
  const sessions = localRoom({ game: "toy", names: Array.from({ length: players }, (_, i) => `P${i}`) });
  const ref = {};
  before(sessions, ref);
  const robots = sessions.map((s, i) => startCardRobot(s, { rules, choose: choosePick, delay: delays[i] ?? 0, rng: rngFromSeed(`seat${i}`) }));
  ref.matches = robots.map((r) => r.match);
  await until(() => robots.every((r) => done(r.match)));
  return robots.map((r) => r.match);
}

function seated(players, rules) {
  const sessions = localRoom({ game: "toy", names: Array.from({ length: players }, (_, i) => `P${i}`) });
  const matches = sessions.map((s) => new CardMatch({ send: (msg) => s.send(msg), me: s.index, players, rules }));
  sessions.forEach((s, i) => s.onMessage((msg, from) => matches[i].receive(msg, from)));
  return { sessions, matches };
}

test("three players: each round's picks are made at once and apply in seat order, then the hands pass on, the same everywhere, with a passing audit and no leaks", () => withSeededRandom("card-step 1", async () => {
  const held = [new Set(), new Set(), new Set()]; // by seat: every slot it has held
  const matches = await play({ before: (_, ref) => queueMicrotask(() => ref.matches.forEach((m) => m.on("update", () => m.state?.hands[m.me].forEach((slot) => held[m.me].add(slot))))) });
  for (const m of matches) {
    assert.deepEqual(m.verdict, { ok: true });
    assert.deepEqual(m.state, matches[0].state);
    for (const [id, s] of m.slots.entries()) if (s.face !== null) assert.ok(s.open || held[m.me].has(id), `seat ${m.me} knows hidden slot ${id}`);
  }
  const { order, hands, points } = matches[0].state;
  assert.deepEqual(order, [0, 1, 2, 1, 2, 0, 1, 2], "seat 0 sat round 1 out");
  assert.deepEqual(hands.map((h) => h.length), [0, 0, 1], "seat 0's spare card went round");
  assert.equal(points.reduce((a, b) => a + b), 3);
  for (const m of matches) assert.ok(held[m.me].size > 3, `seat ${m.me} was passed cards`);
}));

test("moves apply in seat order whatever order the choices arrive in", () => withSeededRandom("card-step 2", async () => {
  const commits = [];
  const matches = await play({ delays: [160, 80, 0], before: (sessions) => sessions.forEach((s) => tap(s, (msg) => void (msg.t === "commit" && commits.push(s.index)))) });
  assert.equal(commits[0], 2);
  assert.deepEqual(matches[0].verdict, { ok: true });
  assert.deepEqual(matches[0].state.order.slice(0, 3), [0, 1, 2]);
}));

test("no choice is on the wire until every seat that owes one has committed", () => withSeededRandom("card-step 3", async () => {
  const wire = [];
  await play({ before: (sessions) => sessions.forEach((s) => tap(s, (msg) => void wire.push([s.index, msg]))) });
  const steps = [];
  let commits = new Set();
  let opens = new Set();
  for (const [seat, msg] of wire) {
    if (msg.t === "commit") {
      assert.deepEqual(Object.keys(msg).sort(), ["c", "m", "t"], "a commit carries no move");
      if (opens.size) {
        assert.equal(opens.size, commits.size, "a commit came after the step's first choice was shown");
        steps.push(commits.size);
        commits = new Set();
        opens = new Set();
      }
      commits.add(seat);
    } else if (msg.t === "open") opens.add(seat);
  }
  steps.push(commits.size);
  assert.equal(opens.size, commits.size);
  assert.deepEqual(steps, [3, 2, 3]);
}));

test("a choice shown that isn't the one committed to stops the match and names its sender", () => withSeededRandom("card-step 4", async () => {
  let swapped = false;
  const matches = await play({
    before: (sessions, ref) =>
      tap(sessions[1], (msg) => {
        if (msg.t !== "open" || swapped) return;
        swapped = true;
        return { ...msg, move: { pick: ref.matches[1].state.hands[1].find((slot) => slot !== msg.move.pick) } };
      }),
  });
  for (const m of matches.filter((m) => m.me !== 1)) {
    assert.equal(m.phase, "aborted");
    assert.ok(m.abortSeat === 1 || m.abortAbout === 1);
    assert.match(m.abortReason, /showed a choice other than the one it committed to/);
  }
}));

test("a step's messages out of order stop the match and name their sender", () => withSeededRandom("card-step 5", async () => {
  // Seat 0 sits the first round out.
  const c = "ab".repeat(32);
  const cases = [
    { seat: 0, msgs: [{ t: "commit", c }], reason: /moved out of turn/ },
    { seat: 1, msgs: [{ t: "move", move: { pick: 0 }, sh: [] }], reason: /moved out of turn/ },
    { seat: 1, msgs: [{ t: "commit", c: "nope" }], reason: /sent a malformed commit/ },
    { seat: 1, msgs: [{ t: "commit", c }, { t: "commit", c }], reason: /chose twice/ },
    { seat: 1, msgs: [{ t: "commit", c }, { t: "open", move: { pick: 0 }, salt: "00", sh: [] }], reason: /showed its choice before everyone chose/ },
  ];
  for (const { seat, msgs, reason } of cases) {
    const { sessions, matches } = seated(3, pickRules({ sitOut: 0 }));
    await until(() => matches.every((m) => m.phase === "playing"));
    for (const msg of msgs) sessions[seat].send({ ...msg, m: 1 });
    const others = matches.filter((m) => m.me !== seat);
    await until(() => others.every((m) => m.phase === "aborted"));
    for (const m of others) {
      assert.equal(m.abortSeat, seat, `${reason}: seat ${m.me} blames ${m.abortSeat}`);
      assert.match(m.abortReason, reason);
    }
  }
}));

test("my choice is checked in my browser: an illegal one is refused and never sent, and once I've chosen I can't choose again", () => withSeededRandom("card-step 6", async () => {
  const { sessions, matches } = seated(3, pickRules());
  const sent = [];
  tap(sessions[1], (msg) => void sent.push(msg.t));
  await until(() => matches.every((m) => m.phase === "playing"));
  const me = matches[1];
  const invalid = [];
  me.on("invalid", (why) => invalid.push(why));
  assert.ok(me.canMove());
  await me.play({ pick: me.state.hands[2][0] });
  assert.deepEqual(invalid, ["a move can only show cards from your own hand"]);
  assert.ok(!sent.includes("commit"));
  await me.play({ pick: me.state.hands[1][0] });
  assert.equal(me.canMove(), false);
  await me.play({ pick: me.state.hands[1][1] });
  assert.deepEqual(invalid, ["a move can only show cards from your own hand", "not your turn"]);
  assert.deepEqual(sent.filter((t) => t === "commit" || t === "open"), ["commit"]);
  // The others see that seat 1 has chosen, and nothing has applied yet.
  await until(() => matches.every((m) => m.step.commits[1]));
  for (const m of matches) assert.deepEqual(m.state.order, []);
  assert.ok(matches[0].canMove() && matches[2].canMove());
}));
