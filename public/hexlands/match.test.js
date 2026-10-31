// Hexlands over the real card engine: a robot in each seat of a localRoom(),
// each running its own CardMatch, opening the deck, hiding the development
// cards again, stealing through a shuffle and auditing at the end. Every seat
// ends on the same state, the audit passes, no seat ever knows a card that
// isn't open or its own, a steal is seen only by the thief and the victim,
// and a lie or a forged move is caught and names the cheat.
import test from "node:test";
import assert from "node:assert/strict";
import { localRoom } from "../engine/room.js";
import { startCardRobot } from "../engine/card-match.js";
import { rngFromSeed } from "../engine/rng.js";
import { makeRules, legalMoves, forcedMove, movers, resourceOf, victims } from "./rules.js";
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
const has = (k) => (m) => Object.hasOwn(m, k);

// Random legal moves, leaning towards building so a game ends.
function chooseRandom(state, me, rng, face) {
  const forced = forcedMove(state, me, face);
  if (forced) return forced;
  const moves = legalMoves(state, me, face);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const of = (k) => moves.filter(has(k));
  if (state.phase === "discard") {
    const hand = state.hands[me].slice();
    for (let i = hand.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [hand[i], hand[j]] = [hand[j], hand[i]];
    }
    return { discard: hand.slice(0, state.discards[me]) };
  }
  if (state.phase === "roll") return of("claim")[0] ?? (of("play").length && rng() < 0.3 ? pick(of("play")) : { roll: true });
  if (state.phase === "answer") return of("accept").length && rng() < 0.5 ? of("accept")[0] : { decline: true };
  if (state.phase === "main" && !state.freeRoads) {
    for (const [k, p] of [["claim", 1], ["city", 1], ["settle", 1], ["buy", 0.8], ["play", 0.6], ["road", 0.6], ["bank", 0.6], ["offer", 0.05]]) {
      if (of(k).length && rng() < p) return pick(of(k));
    }
    return { end: true };
  }
  return pick(moves);
}

// Every face a seat knows is open to all, or a card it holds or held.
function assertNoLeaks(match, held) {
  for (const [id, s] of match.slots.entries()) if (s.owner === match.me) held.add(id);
  for (const [id, s] of match.slots.entries()) {
    if (s.face !== null && !s.gone) assert.ok(s.open || held.has(id), `seat ${match.me} knows hidden slot ${id}`);
  }
}


// choose(i, match) gives seat i's chooser, else chooseRandom; tap(i, session,
// match) may change what a seat sends; watch(matches) runs before play.
async function play({ players, config = {}, choose = () => null, tap = () => {}, watch = () => {}, seed = "" }) {
  const sessions = localRoom({ game: "hexlands", names: Array.from({ length: players }, (_, i) => `P${i}`), mode: "friend" });
  const rules = makeRules(config, players);
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
  // Setup until play starts, and each steal until every seat is idle again.
  const timing = { setup: 0, steals: [], game: 0 };
  const steals = [];
  let stealAt = 0;
  matches[0].on("start", () => (timing.setup = Date.now() - t0));
  matches[0].on("events", ({ events }) => {
    const found = events.filter((e) => e.type === "steal");
    steals.push(...found);
    if (found.length) stealAt = Date.now();
  });
  matches[0].on("update", () => {
    if (stealAt && matches.every((m) => m.busy === null)) {
      timing.steals.push(Date.now() - stealAt);
      stealAt = 0;
    }
  });
  watch(matches);
  try {
    await until(() => matches.every(done));
  } finally {
    for (const r of robots) r.destroy();
  }
  timing.game = Date.now() - t0;
  return { matches, checks, timing, steals };
}

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function fullGame(t, players, seed) {
  const result = await play({ players, seed });
  const { matches, checks, timing, steals } = result;
  for (const m of matches) {
    assert.equal(m.phase, "over", m.abortReason);
    assert.deepEqual(m.verdict, { ok: true });
    assert.deepEqual(m.state, matches[0].state);
  }
  const st = matches[0].state;
  assert.ok(st.winner >= 0 && st.moves > 100);
  assert.ok(checks >= players * st.moves);
  // A stolen card not spent since is known to its thief alone.
  assert.ok(steals.length > 0, "someone stole");
  let hidden = 0;
  for (const { thief, slot } of steals) {
    if (matches[0].slots[slot].open) continue;
    hidden++;
    for (const m of matches) assert.equal(m.slots[slot].face !== null, m.me === thief, `seat ${m.me} and the card seat ${thief} stole`);
  }
  // Once the audit has passed, every seat can read every card.
  const all = [...st.bank.flat(), ...st.hands.flat(), ...st.devs.flat(), ...st.devPile];
  assert.equal(all.length + st.shown.flat().length, 120);
  for (const m of matches) assert.ok(all.every((s) => m.face(s) !== null));
  t.diagnostic(`${players} seats: setup ${timing.setup} ms; ${steals.length} steals (${hidden} still hidden), median ${median(timing.steals)} ms, max ${Math.max(0, ...timing.steals)} ms; ${st.moves} moves; game and audit ${timing.game} ms`);
}

test("three seats: the same state everywhere, a passing audit, steals seen only by the thief", { timeout: 600_000 }, (t) => withSeededRandom("hexlands 3", () => fullGame(t, 3, "three")));

test("four seats: the same state everywhere, a passing audit, steals seen only by the thief", { timeout: 600_000 }, (t) => withSeededRandom("hexlands 4", () => fullGame(t, 4, "four")));

// Plays a move of a kind it can, preferring `prefer(moves)`.
const leaning = (prefer) => (st, me, rng, face) => {
  const moves = movers(st).length ? [] : legalMoves(st, me, face);
  const pick = prefer(moves, st, me);
  return pick ?? chooseRandom(st, me, rng, face);
};

test("the audit names a player who kept back a card from Monopoly", { timeout: 900_000 }, () =>
  withSeededRandom("hexlands monopoly", async () => {
    const LIAR = 1;
    let lies = 0;
    let matches;
    let liarMatch;
    // A resource the liar holds hidden, peeking at its match.
    const hiddenWith = () => {
      const m = liarMatch();
      const slot = m.state.hands[LIAR].find((s) => !m.slots[s].open);
      return slot === undefined ? -1 : resourceOf(m.face(slot));
    };
    // Everyone robs the liar, so its hand is hidden, and buys and plays Monopoly when it can.
    const eager = leaning((moves) => {
      const pick = (f) => moves.find(f);
      return pick((m) => m.steal === LIAR) ?? pick((m) => m.resource === hiddenWith()) ?? pick(has("buy")) ?? null;
    });
    // It gives only the cards everyone can see.
    const liar = (match) => (st, me, rng, face) => {
      if (st.phase === "monopoly" && movers(st).includes(me)) {
        const mine = st.hands[me].filter((s) => resourceOf(face(s)) === st.monopoly.resource);
        const seen = mine.filter((s) => match().slots[s].open);
        if (seen.length < mine.length) {
          lies++;
          return { give: seen };
        }
      }
      return eager(st, me, rng, face);
    };
    for (let game = 0; game < 6 && !lies; game++) {
      const choose = (i, match) => {
        if (i !== LIAR) return eager;
        liarMatch = match;
        return liar(match);
      };
      ({ matches } = await play({ players: 3, seed: `monopoly ${game}`, choose }));
    }
    assert.ok(lies > 0, "the liar got a chance to lie");
    for (const m of matches) {
      assert.equal(m.phase, "over", m.abortReason);
      assert.equal(m.verdict.ok, false);
      assert.equal(m.verdict.seat, LIAR);
      assert.match(m.verdict.reason, /kept back a card/);
    }
  }),
);

// Changes the first message `forge(msg, match)` rewrites from seat CHEAT; every other seat stops, naming it.
async function forged(forge, seed) {
  const CHEAT = 2;
  let sent = false;
  const tap = (i, session, match) => {
    if (i !== CHEAT) return;
    const send = session.send.bind(session);
    session.send = (msg) => {
      const out = !sent && msg.t === "move" ? forge(msg, match()) : null;
      if (out) sent = true;
      return send(out ?? msg);
    };
  };
  const { matches } = await play({ players: 3, seed, tap });
  assert.ok(sent, "the cheat got a chance");
  for (const m of matches.filter((m) => m.me !== CHEAT)) {
    assert.equal(m.phase, "aborted");
    assert.ok(m.abortSeat === CHEAT || m.abortAbout === CHEAT, `seat ${m.me} names seat ${m.abortSeat}`);
    assert.match(m.abortReason, /broke the rules/);
  }
}

test("a forged steal stops the match, naming the thief", { timeout: 300_000 }, () =>
  withSeededRandom("hexlands steal", () =>
    forged((msg, match) => {
      const move = msg.move;
      if (!Object.hasOwn(move, "robber")) return null;
      // Someone who isn't there, or nobody when someone is.
      const steal = victims(match.state, move.robber, match.me).length ? -1 : (match.me + 1) % 3;
      return { ...msg, move: { ...move, steal } };
    }, "steal"),
  ),
);

test("a payment with the bank's card stops the match, naming the payer", { timeout: 300_000 }, () =>
  withSeededRandom("hexlands pay", () =>
    forged((msg, match) => {
      const move = msg.move;
      if (!Array.isArray(move.pay) || !move.pay.length || msg.sh.length) return null;
      const r = resourceOf(match.face(move.pay[0]));
      const bank = match.state.bank[r];
      if (!bank.length) return null;
      return { ...msg, move: { ...move, pay: [bank.at(-1), ...move.pay.slice(1)] } };
    }, "pay"),
  ),
);
