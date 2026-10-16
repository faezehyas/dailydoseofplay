// A modified client tries every way to break the peer protocol. A tamper
// harness rewrites what one seat sends while real games play on: the honest
// seats either carry on, all on the same state, or stop with a reason. They
// never throw, never hang, and never end a game on a state that differs from
// the others'. Then one test for each refusal path the games never reach.
import test from "node:test";
import assert from "node:assert/strict";
import { localPair, MAX_MESSAGE_LENGTH, MESSAGE_TOO_BIG } from "./channel.js";
import { localRoom } from "./room.js";
import { localGroup } from "./group.js";
import { Session, admitGuest, greetHost, matchRouter } from "./session.js";
import { TurnMatch } from "./turn-match.js";
import { CardMatch } from "./card-match.js";
import { SharedRandom } from "./fair.js";
import { toBase64 } from "./base64.js";
import { HELLO_BYTES, SHARE_BYTES } from "./deck-service.js";
import { SEAL_PUBLIC_BYTES } from "./seal.js";
import { rngFromSeed } from "./rng.js";
import { makeRules as ludoRules } from "../ludo/rules.js";
import { chooseMove as ludoMove } from "../ludo/robot.js";
import { makeRules as chessRules, listMoves } from "../chess/rules.js";
import { SeaBattleMatch } from "../sea-battle/match.js";
import { randomFleet } from "../sea-battle/rules.js";
import { chooseMove as seaMove } from "../sea-battle/robot.js";
import { makeRules as heartsRules } from "../hearts/rules.js";
import { chooseMove as heartsMove } from "../hearts/robot.js";
import { makeRules as toyRules, chooseMove as toyMove } from "../../test/fixtures/toy-cards.js";
import { withSeededRandom } from "../../test/helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 10_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}

// ---------- the games ----------
// match(session) seats it; choose(match, rng) picks a legal move, play(match,
// move) makes it and wire(move) is the message that carries it: of type
// `type` ("move" if none), the move in its `field` ("move" if none).

const turnGame = (rules, choose) => ({
  match: (s) => new TurnMatch({ send: (msg) => s.send(msg), me: s.index, players: s.players.length, rules }),
  canMove: (m) => m.canMove(),
  choose: (m, rng) => choose(m.state, m.me, rng),
  play: (m, move) => m.play(move),
  wire: (move) => ({ t: "move", move }),
});

const GAMES = [
  { name: "Ludo", players: 4, ...turnGame(ludoRules({ captureBonus: true }), (st, me, rng) => ludoMove(st, me, rng, { level: "easy" })) },
  { name: "Chess", players: 2, ...turnGame(chessRules(), (st, me, rng) => listMoves(st)[Math.floor(rng() * listMoves(st).length)]) },
  {
    name: "Sea Battle",
    players: 2,
    type: "fire",
    field: "w",
    match: (s) => new SeaBattleMatch({ send: (msg) => s.send(msg), me: s.index, fleet: randomFleet(rngFromSeed(`fleet ${s.index}`)) }),
    ready: (m) => m.ready(),
    canMove: (m) => m.canFire(),
    choose: (m, rng) => seaMove(m.state, m.me, rng),
    play: (m, { weapon, target, dir }) => m.fire(weapon, target, undefined, dir),
    wire: ({ weapon, target, dir }) => ({ t: "fire", w: weapon, at: target, dir }),
  },
  {
    name: "Hearts",
    players: 3,
    match: (s) => new CardMatch({ send: (msg) => s.send(msg), me: s.index, players: s.players.length, rules: heartsRules({ target: 0 }, s.players.length) }),
    canMove: (m) => m.canMove(),
    choose: (m, rng) => heartsMove(m.state, m.me, rng, (slot) => m.face(slot)),
    play: (m, move) => m.play(move),
    wire: (move) => ({ t: "move", move, sh: [] }),
  },
];

// ---------- the harness ----------

const CHEAT = 1; // the seat whose messages are tampered with
const PLIES = 6; // moves played after the tamper

// Every number, string and flag in a value, changed.
const junk = (v) => (Array.isArray(v) ? v.map(junk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, junk(x)])) : typeof v === "number" ? -1 : typeof v === "string" ? "?" : !v);

// Each case gets every message the cheating seat sends, as out(msg), and
// puts what it likes on the wire with send(msg). It calls hit() once it has
// tampered; before(move) runs as an honest seat is about to make move.
// stops: what every honest seat stops with (its abort reason, or why its
// session ended); null when they all carry on.
const CASES = [
  {
    name: "a field of a move set to junk",
    tamper: ({ isMove, field, send, hit }) => (msg) => send(isMove(msg) && hit() ? { ...msg, [field]: junk(msg[field]) } : msg),
  },
  {
    name: "a key of a move dropped",
    tamper: ({ isMove, field, send, hit }) => (msg) => {
      if (!isMove(msg) || !hit()) return send(msg);
      const { [field]: _, ...rest } = msg;
      send(rest);
    },
  },
  {
    name: "a move sent twice",
    tamper: ({ isMove, send, hit }) => (msg) => {
      send(msg);
      if (isMove(msg) && hit()) send(msg);
    },
  },
  {
    name: "a move swapped with the message after it",
    tamper: ({ isMove, send, hit }) => {
      let held = null;
      return (msg) => {
        if (held) {
          clearTimeout(held.timer);
          send(msg);
          send(held.msg);
          held = null;
        } else if (isMove(msg) && hit()) {
          // Nothing may follow until the others answer it: then it just goes out late.
          held = { msg, timer: setTimeout(() => (send(held.msg), (held = null)), 20) };
        } else send(msg);
      };
    },
  },
  {
    name: "an old move replayed after the next one",
    tamper: ({ isMove, send, hit }) => {
      let first = null;
      return (msg) => {
        send(msg);
        if (!isMove(msg)) return;
        if (!first) first = msg;
        else if (hit()) send(first);
      };
    },
  },
  {
    name: "a move sent out of turn",
    tamper: ({ send, wire, hit }) =>
      Object.assign((msg) => send(msg), {
        // The honest seat's own move, sent first by the cheat: only the sender is wrong.
        before: (move) => hit() && send({ ...wire(move), m: 1 }),
      }),
    stops: /out of turn|not your turn|stopped the match/,
  },
  {
    name: "a wrong reveal for a shared draw",
    tamper: ({ send, hit }) => (msg) => send(msg.t === "draw" && hit() ? { ...msg, v: msg.v.replace(/^./, (c) => (c === "0" ? "1" : "0")) } : msg),
    stops: /does not match commitment|stopped the match/,
  },
  {
    name: "a message one character over the limit",
    tamper: ({ isMove, send, hit }) => (msg) => {
      if (!isMove(msg) || !hit()) return send(msg);
      const pad = MAX_MESSAGE_LENGTH + 1 - JSON.stringify({ msg: { ...msg, pad: "" } }).length;
      const big = { ...msg, pad: "x".repeat(pad) };
      assert.equal(JSON.stringify({ msg: big }).length, MAX_MESSAGE_LENGTH + 1);
      send(big);
    },
    stops: new RegExp(`^${MESSAGE_TOO_BIG}$`),
  },
  {
    name: "an unknown message type",
    tamper: ({ isMove, send, hit }) => (msg) => {
      send(msg);
      if (isMove(msg) && hit()) send({ t: "zap", m: 1 });
    },
    stops: /unknown message zap|stopped the match/,
  },
  {
    name: "an unknown engine message",
    tamper: ({ isMove, send, hit }) => (msg) => {
      send(msg);
      if (isMove(msg) && hit()) send({ t: "$zap" });
    },
    stops: null,
  },
];

// Plays `game` with the cheat's messages rewritten by `kase`. Returns each
// honest seat's stop (an abort reason or how its session ended), none if
// the game carried on.
async function play(game, kase, seed) {
  const sessions = localRoom({ game: "tamper", names: Array.from({ length: game.players }, (_, i) => `P${i}`), mode: "friend" });
  const ends = [];
  sessions.forEach((s, i) => s.on("end", (reason) => (ends[i] = reason)));
  const cheat = sessions[CHEAT];
  const send = cheat.send.bind(cheat);
  let hits = 0;
  const type = game.type ?? "move";
  const out = kase.tamper({ send, wire: game.wire, field: game.field ?? "move", isMove: (msg) => msg.t === type, hit: () => !hits && ++hits });
  cheat.send = (msg) => (out(msg), true);

  const matches = sessions.map((s) => {
    const m = game.match(s);
    matchRouter(s).start(m);
    return m;
  });
  const moves = matches.map(() => 0);
  const reasons = [];
  matches.forEach((m, i) => {
    m.on("events", () => moves[i]++);
    m.on("abort", ({ reason }) => (reasons[i] = reason));
  });
  await Promise.all(matches.map((m) => game.ready?.(m)));
  const honest = matches.filter((m) => m.me !== CHEAT);
  const stopped = () => matches.some((m, i) => ends[i] !== undefined || m.phase === "aborted" || m.phase === "over");
  const idle = () => matches.every((m, i) => moves[i] === moves[0] && !m.working && !m.pending);

  const rng = rngFromSeed(seed);
  for (let after = 0; after < PLIES && !stopped(); ) {
    await until(() => stopped() || matches.some(game.canMove));
    if (stopped()) break;
    const mover = matches.find(game.canMove);
    const next = game.choose(mover, rng);
    if (mover.me !== CHEAT && out.before) {
      out.before(next);
      await tick();
    }
    // Not awaited: a move waiting on a draw from a seat that is gone never ends.
    const made = moves[mover.me];
    game.play(mover, next);
    if (hits) after++;
    await until(() => stopped() || (moves[mover.me] > made && idle()));
  }
  assert.equal(hits, 1, "the cheat tampered");

  // Settled: stopped with a reason, or over with the audit done.
  const settled = (m) => ends[m.me] !== undefined || m.phase === "aborted" || (m.phase === "over" && (!("verdict" in m) || m.verdict));
  if (stopped()) await until(() => honest.every(settled));
  else await until(idle);
  const stops = [];
  for (const m of honest) {
    if (ends[m.me] !== undefined) stops.push(ends[m.me]);
    else if (m.phase === "aborted") {
      assert.equal(typeof reasons[m.me], "string");
      assert.ok(reasons[m.me].length > 0);
      stops.push(reasons[m.me]);
    } else {
      // Carried on, or over: on the same state as everyone, unless the audit caught the cheat.
      for (const other of honest) assert.deepEqual(other.state, m.state);
      if (m.verdict?.ok !== false) assert.deepEqual(matches[CHEAT].state, m.state);
    }
  }
  return stops;
}

for (const game of GAMES) {
  test(`${game.name}: every tamper is caught or harmless`, async (t) => {
    // An unexpected error is logged: none may come from a peer's message.
    const errors = t.mock.method(console, "error", () => {});
    for (const kase of CASES) {
      await t.test(kase.name, () =>
        withSeededRandom(`tamper ${game.name} ${kase.name}`, async () => {
          const stops = await play(game, kase, `${game.name} ${kase.name}`);
          if (kase.stops === null) assert.deepEqual(stops, []);
          else if (kase.stops) {
            assert.equal(stops.length, game.players - 1, `honest seats stopped with ${JSON.stringify(stops)}`);
            for (const stop of stops) assert.match(stop, kase.stops);
          }
          assert.equal(errors.mock.callCount(), 0);
        }),
      );
    }
  });
}

// ---------- one test for each refusal path ----------

// Seat 1 moves first; a move { boom: true } trips a bug in the rules.
const handFirst = {
  newState: () => ({ turn: 1, winner: -1 }),
  applyMove(state, player, move) {
    if (move.boom) throw new TypeError("boom");
    state.turn = 1 - player;
    return [];
  },
};

// Seat 0 plays `rules` honestly; the test speaks for seat 1 by hand.
function turnByHand(rules = handFirst) {
  const [host, hand] = localRoom({ game: "tamper", names: ["Honest", "Hand"], mode: "friend" });
  const match = new TurnMatch({ send: (msg) => host.send(msg), me: 0, rules });
  matchRouter(host).start(match);
  const stopped = new Promise((r) => match.on("abort", ({ reason }) => r(reason)));
  return { match, stopped, send: (msg) => hand.send({ m: 1, ...msg }) };
}

// The hand's chain and its reveal for the coin toss.
async function handChain(send) {
  const sr = await SharedRandom.create(4);
  send({ t: "chain", tip: sr.tip });
  send({ t: "draw", k: 1, v: sr.chain.reveal(1) });
}

test("turn match: an unknown message type stops the match; one from my own seat or no other seat is ignored", () => withSeededRandom("tamper turn 1", async () => {
  const { match, stopped, send } = turnByHand();
  for (const from of [0, 2, -1, 0.5, "1"]) match.receive({ t: "ignored", m: 1 }, from);
  send({ t: "zap" });
  assert.equal(await stopped, "Opponent broke the rules: unknown message zap");
}));

test("turn match: a chain sent twice stops the match", () => withSeededRandom("tamper turn 2", async () => {
  const { match, stopped, send } = turnByHand();
  await handChain(send);
  await until(() => match.phase === "playing");
  send({ t: "chain", tip: match.sr.tip });
  assert.equal(await stopped, "Opponent broke the rules: chain sent twice");
}));

test("turn match: a chain tip that isn't one stops the match", () => withSeededRandom("tamper turn 3", async () => {
  const { stopped, send } = turnByHand();
  send({ t: "chain", tip: "nope" });
  assert.equal(await stopped, "Opponent broke the rules: bad chain tip");
}));

test("turn match: a move before the coin toss stops the match", () => withSeededRandom("tamper turn 4", async () => {
  const { stopped, send } = turnByHand();
  send({ t: "move", move: {} });
  assert.equal(await stopped, "Opponent broke the rules: move outside play");
}));

test("turn match: rules that throw something other than a RuleError stop the match as an unexpected error", (t) => withSeededRandom("tamper turn 5", async () => {
  const errors = t.mock.method(console, "error", () => {});
  const { stopped, send } = turnByHand();
  await handChain(send);
  send({ t: "move", move: { boom: true } });
  assert.equal(await stopped, "Unexpected error: boom");
  assert.equal(errors.mock.callCount(), 1);
}));

// Seat 0 plays the toy card game; the test speaks for seat 1 by hand.
function cardsByHand() {
  const [host, hand] = localRoom({ game: "tamper", names: ["Honest", "Hand"], mode: "friend" });
  const match = new CardMatch({ send: (msg) => host.send(msg), me: 0, rules: toyRules({ deckSize: 10 }) });
  matchRouter(host).start(match);
  const stopped = new Promise((r) => match.on("abort", ({ reason, seat }) => r({ reason, seat })));
  return { stopped, send: (msg) => hand.send({ m: 1, ...msg }) };
}

// Both seats of the toy card game, playing to `maxTurns`; the test also speaks for seat 1 by hand.
async function cardsPlaying(maxTurns = 30) {
  const sessions = localRoom({ game: "tamper", names: ["Honest", "Hand"], mode: "friend" });
  const rules = toyRules({ deckSize: 10, maxTurns });
  const [a, b] = sessions.map((s) => {
    const m = new CardMatch({ send: (msg) => s.send(msg), me: s.index, rules });
    matchRouter(s).start(m);
    return m;
  });
  await until(() => a.phase === "playing" && b.phase === "playing");
  const stopped = new Promise((r) => a.on("abort", ({ reason, seat }) => r({ reason, seat })));
  // Plays the toy game until done(), each move applied on both seats.
  const rng = rngFromSeed("cards");
  async function playUntil(done) {
    while (!done()) {
      const mover = [a, b].find((m) => m.canMove());
      if (!mover) {
        await tick();
        continue;
      }
      const n = mover.log.length;
      await mover.play(toyMove(mover.state, mover.me, rng, (slot) => mover.face(slot)));
      await until(() => [a, b].every((m) => m.log.length > n && !m.working));
    }
  }
  return { a, stopped, playUntil, send: (msg) => sessions[1].send({ m: 1, ...msg }) };
}

const zeros = (n) => toBase64(new Uint8Array(n));

test("card match: a malformed hello, shuffle part, share part or sealed part stops the match and names its sender", () => withSeededRandom("tamper cards 1", async () => {
  const hello = { t: "hello", tip: "0".repeat(64), key: zeros(HELLO_BYTES), seal: zeros(SEAL_PUBLIC_BYTES) };
  const malformed = [
    ["hello", { ...hello, tip: "nope" }],
    ["hello", { ...hello, key: zeros(HELLO_BYTES - 1) }],
    ["hello", { ...hello, seal: undefined }],
    // A part's place: i in 0..n-1, n from 1 to its most parts.
    ["shuffle", { t: "shuffle", k: 1, i: 1, n: 1, d: "" }],
    ["shuffle", { t: "shuffle", k: 1, i: -1, n: 1, d: "" }],
    ["shuffle", { t: "shuffle", k: 1, i: 0, n: 0, d: "" }],
    ["shuffle", { t: "shuffle", k: 1, i: 0, n: 1000, d: "" }],
    // A part's size: 3000 characters at most.
    ["shuffle", { t: "shuffle", k: 1, i: 0, n: 1, d: "A".repeat(3001) }],
    // 16 shares a part at most, each SHARE_BYTES long.
    ["shares", { t: "shares", k: 1, i: 0, n: 1, d: Array(17).fill(zeros(SHARE_BYTES)) }],
    ["shares", { t: "shares", k: 1, i: 0, n: 1, d: [zeros(SHARE_BYTES - 1)] }],
    ["shares", { t: "shares", k: 1, i: 0, n: 1, d: "nope" }],
    ["seal", { t: "seal", k: 1, i: 0, n: 1, d: "nope" }],
  ];
  for (const [type, msg] of malformed) {
    const { stopped, send } = cardsByHand();
    send(msg);
    assert.deepEqual(await stopped, { reason: `sent a malformed ${type} message`, seat: 1 }, JSON.stringify(msg).slice(0, 80));
  }
}));

test("card match: an unknown message type stops the match", () => withSeededRandom("tamper cards 2", async () => {
  const { stopped, send } = await cardsPlaying();
  send({ t: "zap" });
  assert.deepEqual(await stopped, { reason: "sent an unknown message zap", seat: 1 });
}));

test("card match: a move whose shares don't add up stops the match", () => withSeededRandom("tamper cards 3", async () => {
  const { a, stopped, playUntil, send } = await cardsPlaying();
  await playUntil(() => a.state.turn === 1);
  // A draw shows no card, so it carries no share.
  send({ t: "move", move: { draw: true }, sh: [zeros(SHARE_BYTES)] });
  assert.deepEqual(await stopped, { reason: "sent a move without the shares for the cards it shows", seat: 1 });
}));

test("card match: a move once the game is over stops the match", () => withSeededRandom("tamper cards 4", async () => {
  const { a, stopped, playUntil, send } = await cardsPlaying(4);
  await playUntil(() => a.phase === "over");
  await until(() => a.verdict);
  send({ t: "move", move: { draw: true }, sh: [] });
  assert.deepEqual(await stopped, { reason: "moved outside play", seat: 1 });
}));

test("session: a message with no string type, or from my own seat or a seat that isn't there, is ignored", async () => {
  const [hub, spoke] = localGroup(2);
  const session = new Session({ group: spoke, mode: "friend", players: ["A", "B"], game: "tamper" });
  const got = [];
  session.onMessage((msg, from) => got.push([msg.t, from]));
  for (const frame of [{ from: 0, msg: { t: 5 } }, { from: 0, msg: {} }, { from: 0, msg: null }, { from: 1, msg: { t: "mine" } }, { from: 2, msg: { t: "nobody" } }, { from: 0, msg: { t: "ok" } }]) {
    hub.links.get(1).send(frame);
  }
  await until(() => got.length);
  await tick();
  assert.deepEqual(got, [["ok", 0]]);
});

test("session: a $start that doesn't seat the guest fails with bad_start", async () => {
  for (const start of [{ seat: 0, players: ["A", "B"] }, { seat: 2, players: ["A", "B"] }, { seat: "1", players: ["A", "B"] }, { seat: 1, players: "AB" }]) {
    const [host, guest] = localPair();
    const greeting = greetHost(guest, { name: "B", game: "tamper" });
    host.send({ t: "$start", ...start });
    await assert.rejects(greeting, { message: "bad_start" }, JSON.stringify(start));
  }
});

test("session: a link that never says hello fails with hello_timeout, on either side", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const silent = () => localPair()[0];
  const admitting = admitGuest(silent(), { game: "tamper" });
  const greeting = greetHost(silent(), { name: "B", game: "tamper" });
  t.mock.timers.tick(10_000);
  await assert.rejects(admitting, { message: "hello_timeout" });
  await assert.rejects(greeting, { message: "hello_timeout" });
});

test("group: a frame that isn't an object, has no msg, or has a from that isn't a seat number is dropped", async () => {
  const [hub, spoke] = localGroup(2);
  const atHub = [];
  const atSpoke = [];
  hub.on("message", (msg, from) => atHub.push([msg.t, from]));
  spoke.on("message", (msg, from) => atSpoke.push([msg.t, from]));
  for (const frame of ["text", null, {}, { message: { t: "x" } }, { msg: { t: "ok" } }]) spoke.link.send(frame);
  for (const frame of ["text", null, { from: 0 }, { from: "0", msg: { t: "x" } }, { from: 0.5, msg: { t: "x" } }, { from: 0, msg: { t: "ok" } }]) hub.links.get(1).send(frame);
  await until(() => atHub.length && atSpoke.length);
  await tick();
  assert.deepEqual(atHub, [["ok", 1]]);
  assert.deepEqual(atSpoke, [["ok", 0]]);
});

test("draw inbox stays bounded", { todo: true }, () => withSeededRandom("tamper draws", async () => {
  const { match, send } = turnByHand(chessRules());
  await until(() => match.sr);
  for (let k = 2; k < 100_002; k++) send({ t: "draw", k, v: "0".repeat(64) });
  await tick();
  // Draws past the end of the chain can never be used.
  assert.ok(match.sr.inbox.size <= 256, `${match.sr.inbox.size} draws held`);
}));
