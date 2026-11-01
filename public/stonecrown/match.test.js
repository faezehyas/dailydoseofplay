// Stonecrown over the real card engine: a robot in each seat of a
// localRoom(), each running its own CardMatch. Every age is shuffled and
// dealt from face-up cards, picks are steps, hands pass in secret, and the
// game is audited at the end. Every seat ends on the same state, the audit
// passes, no seat ever knows a card it never held (another hand, a tucked
// card, the discard pile unless it digs, the guilds left out), and a pick
// that breaks the rules is caught and names its player.
import test from "node:test";
import assert from "node:assert/strict";
import { localRoom } from "../engine/room.js";
import { startCardRobot } from "../engine/card-match.js";
import { commit } from "../engine/fair.js";
import { rngFromSeed } from "../engine/rng.js";
import { WONDERS, GUILDS, guildCount } from "./cards.js";
import { makeRules, legalMoves, forcedMove } from "./rules.js";
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

// Random legal moves, leaning towards building and wonder stages so cities
// fill and the stage effects come up.
function chooseRandom(state, me, rng, face) {
  const forced = forcedMove(state, me, face);
  if (forced) return forced;
  const moves = legalMoves(state, me, face);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const of = (k) => moves.filter((m) => Object.hasOwn(m, k) && m[k] !== -1);
  for (const [k, p] of [["dig", 0.9], ["stage", 0.35], ["build", 0.85]]) if (of(k).length && rng() < p) return pick(of(k));
  return pick(moves);
}

// Every face a seat knows is open to all, or a card it holds or held.
function assertNoLeaks(match, held) {
  for (const [id, s] of match.slots.entries()) if (s.owner === match.me) held.add(id);
  for (const [id, s] of match.slots.entries()) {
    if (s.face !== null && !s.gone) assert.ok(s.open || held.has(id), `seat ${match.me} knows hidden slot ${id}`);
  }
  const st = match.state;
  // The guilds start face up, in face order; those left out in age III stay unseen.
  if (!st || match.verdict || st.age < 3) return;
  for (const s of st.pool) assert.equal(match.face(s), null, `seat ${match.me} knows a guild left out`);
}

// Rules whose deal gives these wonders, by seat.
function withWonders(rules, wonders) {
  return {
    ...rules,
    newState(...args) {
      const st = rules.newState(...args);
      st.wonders = wonders.map(([key, side]) => ({ w: WONDERS.findIndex((w) => w.key === key), side }));
      return st;
    },
  };
}

// tap(i, session, match) may change what a seat sends.
async function play({ players, config = {}, rules = makeRules(config, players), choose = () => null, tap = () => {}, seed = "" }) {
  const sessions = localRoom({ game: "stonecrown", names: Array.from({ length: players }, (_, i) => `P${i}`), mode: "friend" });
  const robots = [];
  const t0 = Date.now();
  for (const [i, s] of sessions.entries()) {
    const match = () => robots[i].match;
    tap(i, s, match);
    robots.push(startCardRobot(s, { rules, choose: choose(i, match) ?? chooseRandom, delay: 0, rng: rngFromSeed(`seat ${i} ${seed}`) }));
  }
  const matches = robots.map((r) => r.match);
  let checks = 0;
  for (const m of matches) {
    const held = new Set();
    m.on("update", () => {
      assertNoLeaks(m, held);
      checks++;
    });
  }
  const events = [];
  const timing = { setup: 0, game: 0 };
  matches[0].on("start", () => (timing.setup = Date.now() - t0));
  matches[0].on("events", (e) => events.push(...e.events));
  try {
    await until(() => matches.every(done));
  } finally {
    for (const r of robots) r.destroy();
  }
  timing.game = Date.now() - t0;
  return { matches, checks, timing, events };
}

async function fullGame(t, { players, seed, config, wonders }) {
  let rules = makeRules(config, players);
  if (wonders) rules = withWonders(rules, wonders);
  const { matches, checks, timing, events } = await play({ players, rules, seed });
  for (const m of matches) {
    assert.equal(m.phase, "over", m.abortReason);
    assert.deepEqual(m.verdict, { ok: true });
    assert.deepEqual(m.state, matches[0].state);
  }
  const st = matches[0].state;
  assert.equal(st.phase, "over");
  assert.ok(st.winner >= 0 || (st.winner === -2 && st.winners.length > 1));
  assert.ok(checks >= players * st.moves);
  const count = (type) => events.filter((e) => e.type === type).length;
  assert.equal(count("age"), 3);
  assert.equal(count("war"), 3);
  assert.equal(count("pass"), 15);
  // Every card ends built, tucked, discarded or among the guilds never dealt, and once the audit has passed every seat can read it.
  const all = [...st.city.flat().map((c) => c.slot), ...st.stages.flat(), ...st.discard, ...st.pool];
  assert.equal(new Set(all).size, rules.deckSize);
  assert.equal(st.pool.length, GUILDS.length - guildCount(players));
  for (const m of matches) assert.ok(all.every((s) => m.face(s) !== null));
  t.diagnostic(`${players} seats: setup ${timing.setup} ms; ${st.moves} picks; ${count("dig")} digs, ${count("last")} last cards; game and audit ${timing.game} ms`);
  return { st, events, timing };
}

test("three seats: the same state everywhere, a passing audit, nobody sees a card they never held", { timeout: 600_000 }, (t) =>
  withSeededRandom("stonecrown 3", () => fullGame(t, { players: 3, seed: "three", config: { side: "random" } })),
);

test("four seats: the same state everywhere, a passing audit, nobody sees a card they never held", { timeout: 600_000 }, (t) =>
  withSeededRandom("stonecrown 4", () => fullGame(t, { players: 4, seed: "four" })),
);

test("Halicarnassus digs the discards and Babylon B plays its seventh card, over the real engine", { timeout: 600_000 }, (t) =>
  withSeededRandom("stonecrown wonders", async () => {
    const wonders = [["halicarnassus", "B"], ["babylon", "B"], ["olympia", "A"]];
    const { st, events } = await fullGame(t, { players: 3, seed: "wonders", config: { side: "B" }, wonders });
    assert.ok(events.some((e) => e.type === "dig"), "someone dug");
    assert.ok(events.some((e) => e.type === "build" && e.how === "dig"), "a dug card was built");
    assert.ok(events.some((e) => e.type === "last"), "Babylon played its last card");
    assert.equal(st.stages[1].length >= 2, true);
  }),
);

// Seat CHEAT's first build goes out with a purchase its neighbour can't make,
// committed to and shown as if it were its real pick; every other seat stops, naming it.
test("a pick with a purchase the neighbour can't make stops the match, naming the buyer", { timeout: 300_000 }, () =>
  withSeededRandom("stonecrown forged", async () => {
    const CHEAT = 2;
    let chosen = null;
    let sent = false;
    const choose = (i) =>
      i === CHEAT
        ? (st, me, rng, face) => {
            const move = chooseRandom(st, me, rng, face);
            chosen = Object.hasOwn(move, "build") ? move : null;
            return move;
          }
        : null;
    const tap = (i, session, match) => {
      if (i !== CHEAT) return;
      const send = session.send.bind(session);
      let ready = null;
      let opened = false;
      session.send = (msg) => {
        if (!sent && msg.t === "commit" && chosen) {
          sent = true;
          const move = { build: chosen.build, buy: { left: [7, 7, 7, 7, 7, 7, 7], right: [0, 0, 0, 0, 0, 0, 0] } };
          ready = commit({ m: match().m, seat: CHEAT, move }).then(({ commitment, salt }) => {
            send({ ...msg, c: commitment });
            return { move, salt };
          });
          return true;
        }
        if (msg.t === "open" && ready && !opened) {
          opened = true;
          ready.then((f) => send({ ...msg, move: f.move, salt: f.salt }));
          return true;
        }
        return send(msg);
      };
    };
    const { matches } = await play({ players: 3, seed: "forged", choose, tap });
    assert.ok(sent, "the cheat got a chance");
    for (const m of matches.filter((m) => m.me !== CHEAT)) {
      assert.equal(m.phase, "aborted");
      assert.ok(m.abortSeat === CHEAT || m.abortAbout === CHEAT, `seat ${m.me} names seat ${m.abortSeat}`);
      assert.match(m.abortReason, /broke the rules/);
    }
  }),
);
