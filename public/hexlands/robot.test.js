import test from "node:test";
import assert from "node:assert/strict";
import { KnownDeck } from "../../test/fixtures/known-deck.js";
import { withSeededRandom, skipUnderCoverage } from "../../test/helpers.js";
import { rngFromSeed } from "../engine/rng.js";
import { localRoom } from "../engine/room.js";
import { HEXES, CORNERS, EDGES, WOOD, BRICK, WOOL, GRAIN, ORE, DESERT } from "./board.js";
import { makeRules, legalMoves, movers, resourceOf, devKind, points, discardCount, MAX_OFFERS, MAX_SHOWN } from "./rules.js";
import { chooseMove, timeoutMove, startRobot, LEVELS, cornerYield, roadTarget, seenHand } from "./robot.js";

const LEVEL_NAMES = Object.keys(LEVELS);
const has = (k) => (m) => Object.hasOwn(m, k);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// The deck as CardMatch gives it (openFaces): the resources open in face order, then the development cards shuffled.
function openDeck(seed) {
  const rng = rngFromSeed(seed);
  const devs = Array.from({ length: 25 }, (_, i) => 95 + i);
  for (let i = devs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [devs[i], devs[j]] = [devs[j], devs[i]];
  }
  const deck = new KnownDeck([...Array(95).keys(), ...devs], seed);
  for (let s = 0; s < 95; s++) deck.slots[s].open = true;
  return deck;
}

// A seeded game straight on the rules, each robot seeing only what its seat may.
function play(levels, seed, { config = {}, onChoice = () => {} } = {}) {
  const n = levels.length;
  const deck = openDeck(`deck ${seed}`);
  const rules = makeRules(config, n);
  const rng = rngFromSeed(`robots ${seed}`);
  const dice = rngFromSeed(`dice ${seed}`);
  const state = rules.newState(Math.floor(rng() * n), n, deck, rngFromSeed(`board ${seed}`));
  let worst = 0;
  let rolls = 0;
  while (state.winner === -1) {
    assert.ok(state.moves < 3000, `${seed}: the game ends`);
    const seats = movers(state).length ? movers(state) : [state.turn];
    // A step's movers all choose on the same state, as their commitments do.
    const moves = seats.map((p) => {
      const t0 = performance.now();
      const m = chooseMove(state, p, rng, deck.view(p), { level: levels[p] });
      worst = Math.max(worst, performance.now() - t0);
      onChoice(state, p, m, deck);
      return [p, m];
    });
    for (const [p, m] of moves) {
      if (m.roll) rolls++;
      for (const id of rules.reveals(state, p, m)) deck.slots[id].open = true;
      rules.applyMove(state, p, m, deck, rules.needsRandom(state, m) ? dice : undefined);
    }
  }
  return { state, worst, rolls };
}

// A hand-built position: 3 seats, past setup, every hex rolling 2 unless set.
function position({ players = 3, target = 10 } = {}) {
  const deck = openDeck("position");
  const rules = makeRules({ target }, players);
  const st = rules.newState(0, players, deck, rngFromSeed("position"));
  Object.assign(st, { phase: "main", turn: 0, rolled: true });
  st.setup.i = st.setup.order.length;
  st.board.terrain = HEXES.map((h) => (h.id === st.board.desert ? DESERT : WOOL));
  st.board.numbers = HEXES.map((h) => (h.id === st.board.desert ? 0 : 2));
  st.board.harbours = [];
  const face = (s) => deck.slots[s].face;
  const hex = (h, terrain, number) => {
    st.board.terrain[h] = terrain;
    st.board.numbers[h] = number;
  };
  const give = (p, ...rs) =>
    rs.map((r) => {
      const s = st.bank[r].pop();
      deck.deal(s, p);
      st.hands[p].push(s);
      return s;
    });
  const dev = (p, kind) => {
    const s = st.devPile.find((x) => devKind(face(x)) === kind);
    st.devPile.splice(st.devPile.indexOf(s), 1);
    deck.deal(s, p);
    st.devs[p].push(s);
    return s;
  };
  const place = (p, corner, city = false) => {
    st.buildings[corner] = { p, city };
    st.pieces[p][city ? "cities" : "settlements"]--;
  };
  const lay = (p, ...edges) =>
    edges.forEach((e) => {
      st.roads[e] = p;
      st.pieces[p].roads--;
    });
  const move = (p, m, rng) => {
    for (const id of rules.reveals(st, p, m)) deck.slots[id].open = true;
    return rules.applyMove(st, p, m, deck, rng);
  };
  const choose = (level, p = st.turn, seed = "pos") => chooseMove(st, p, rngFromSeed(seed), deck.view(p), { level });
  const resources = (slots) => slots.map((s) => resourceOf(face(s)));
  return { st, deck, rules, face, hex, give, dev, place, lay, move, choose, resources };
}

const land = (st, h) => st.board.terrain[h] !== DESERT;
const otherEnd = (e, c) => (EDGES[e].a === c ? EDGES[e].b : EDGES[e].a);

test("setup: Medium and Hard settle where production is high and varied, Easy somewhere good enough", () => {
  const g = position();
  const { st } = g;
  Object.assign(st, { phase: "setup", turn: 0 });
  st.setup.i = 0;
  const three = CORNERS.filter((c) => c.hexes.length === 3 && c.hexes.every((h) => land(st, h)));
  const a = three.find((c) => c.hexes.includes(9) || c.hexes.includes(8));
  const b = three.find((c) => c.hexes.every((h) => !a.hexes.includes(h) && !HEXES[h].neighbors.some((o) => a.hexes.includes(o))));
  // The same 14 pips: wood, brick and grain at a, only ore at b.
  [WOOD, BRICK, GRAIN].forEach((r, i) => g.hex(a.hexes[i], r, [6, 8, 5][i]));
  b.hexes.forEach((h, i) => g.hex(h, ORE, [6, 8, 5][i]));
  for (const level of ["medium", "hard"]) assert.equal(g.choose(level).settle, a.id, level);
  // Easy: a random corner among the best third by pips.
  const pipsOf = (c) => sum(cornerYield(st.board, c));
  const ranked = CORNERS.map((c) => pipsOf(c.id)).sort((x, y) => y - x);
  const bar = ranked[Math.ceil(ranked.length / 3) - 1];
  const picks = new Set();
  for (let i = 0; i < 30; i++) {
    const c = g.choose("easy", 0, `easy ${i}`).settle;
    assert.ok(pipsOf(c) >= bar, `easy settled on ${pipsOf(c)} pips`);
    picks.add(c);
  }
  assert.ok(picks.size > 1, "easy varies");

  // The road heads for the best corner two roads away.
  g.move(0, { settle: a.id });
  const best = (e) => {
    const d = otherEnd(e, a.id);
    return Math.max(0, ...CORNERS[d].corners.filter((c) => c !== a.id).map(pipsOf));
  };
  const road = g.choose("medium").road;
  assert.ok(CORNERS[a.id].edges.includes(road));
  assert.equal(best(road), Math.max(...CORNERS[a.id].edges.map(best)));
});

test("the robber: never on the robot's own hexes, on the leader's best hex, stealing from the leader", () => {
  const g = position();
  const { st } = g;
  const [x, y, z] = [4, 9, 14];
  g.hex(x, ORE, 6);
  g.hex(y, GRAIN, 8);
  g.hex(z, GRAIN, 8);
  // The leader has a city on x, where the robot has a settlement too, and one on y; seat 2 a settlement on z.
  const corner = (h, i) => HEXES[h].corners[i];
  g.place(0, corner(x, 0));
  g.place(1, corner(x, 3), true);
  g.place(1, corner(y, 1), true);
  g.place(2, corner(z, 4));
  g.give(1, WOOD, GRAIN);
  g.give(2, BRICK, BRICK, ORE);
  st.robber = st.board.desert;
  st.phase = "robber";
  assert.ok(points(st, 1) > points(st, 2));
  for (const level of ["medium", "hard"]) assert.deepEqual(g.choose(level), { robber: y, steal: 1 }, level);
  for (let i = 0; i < 40; i++) {
    const m = g.choose("easy", 0, `easy ${i}`);
    assert.ok(!HEXES[m.robber].corners.some((c) => st.buildings[c]?.p === 0), `easy robbed itself on ${m.robber}`);
  }
});

test("discards keep the plan: the city's ore and grain stay", () => {
  const g = position();
  const { st } = g;
  g.place(0, HEXES[9].corners[0]);
  g.give(0, ORE, ORE, ORE, GRAIN, GRAIN, WOOL, WOOL, WOOL, WOOL, WOOD);
  st.discards = [discardCount(st, 0), 0, 0];
  st.phase = "discard";
  assert.equal(st.discards[0], 5);
  for (const level of ["medium", "hard"]) {
    const m = g.choose(level, 0);
    assert.equal(m.discard.length, 5);
    assert.deepEqual(g.resources(m.discard).sort(), [WOOD, WOOL, WOOL, WOOL, WOOL], level);
  }
  const easy = g.choose("easy", 0);
  assert.equal(new Set(easy.discard).size, 5);
  assert.ok(easy.discard.every((s) => st.hands[0].includes(s)));
});

test("every level claims the win the moment hidden victory points reach the target", () => {
  const g = position();
  const { st } = g;
  for (const i of [0, 3]) g.place(0, HEXES[9].corners[i], true);
  for (const i of [0, 3]) g.place(0, HEXES[2].corners[i], true);
  const vps = [g.dev(0, "vp"), g.dev(0, "vp")];
  assert.equal(points(st, 0), 8);
  for (const level of LEVEL_NAMES) assert.deepEqual(g.choose(level), { claim: vps }, level);
  st.phase = "roll";
  st.rolled = false;
  for (const level of LEVEL_NAMES) assert.deepEqual(g.choose(level), { claim: vps }, level);
  assert.deepEqual(timeoutMove(st, 0, g.deck.view(0)), { claim: vps });
  g.move(0, { claim: vps });
  assert.equal(st.winner, 0);
});

test("answers: Medium and Hard take a trade that completes their plan, refuse one that costs it, and never feed a player about to win", () => {
  const g = position();
  const { st } = g;
  g.place(1, HEXES[9].corners[0]);
  g.give(1, ORE, ORE, ORE, GRAIN, WOOL, WOOL);
  const offer = (give, want, from = 0) => {
    const slot = g.give(from, give)[0];
    st.turn = from;
    st.phase = "main";
    st.offers = 0;
    g.move(from, { offer: [slot], want: [0, 1, 2, 3, 4].map((r) => (r === want ? 1 : 0)) });
    assert.equal(st.phase, "answer");
  };
  // Grain for wool: the city is complete.
  offer(GRAIN, WOOL);
  for (const level of ["medium", "hard"]) assert.ok(has("accept")(g.choose(level, 1)), level);
  // Wool for ore: the city slips away.
  offer(WOOL, ORE);
  for (const level of ["medium", "hard"]) assert.deepEqual(g.choose(level, 1), { decline: true }, level);
  // Easy takes a fair trade now and then, never 1 card for 2.
  offer(BRICK, WOOL);
  const easy = Array.from({ length: 20 }, (_, i) => has("accept")(g.choose("easy", 1, `easy ${i}`)));
  assert.ok(easy.some(Boolean) && !easy.every(Boolean));
  st.trade.want = [0, 0, 2, 0, 0];
  for (let i = 0; i < 10; i++) assert.deepEqual(g.choose("easy", 1, `unfair ${i}`), { decline: true });
  // Seat 2 is two points from winning: no grain for it.
  for (const i of [0, 3]) g.place(2, HEXES[2].corners[i], true);
  for (const i of [0, 3]) g.place(2, HEXES[16].corners[i], true);
  offer(GRAIN, WOOL, 2);
  for (const level of ["medium", "hard"]) assert.deepEqual(g.choose(level, 1), { decline: true }, level);
  // Nothing to pay with: declined, whatever the level.
  st.trade.want = [3, 0, 0, 0, 0];
  for (const level of LEVEL_NAMES) assert.deepEqual(g.choose(level, 1), { decline: true }, level);
});

test("trades and builds: the bank's 4:1 toward a settlement, then the settlement", () => {
  const g = position();
  const { st } = g;
  const home = HEXES[9].corners[0];
  g.place(0, home);
  // A road two edges out reaches a free corner.
  const e1 = CORNERS[home].edges[0];
  const mid = otherEnd(e1, home);
  const e2 = CORNERS[mid].edges.find((e) => e !== e1);
  g.lay(0, e1, e2);
  const spot = otherEnd(e2, mid);
  g.give(0, WOOD, BRICK, GRAIN, ORE, ORE, ORE, ORE);
  for (const level of ["medium", "hard"]) {
    const m = g.choose(level);
    assert.deepEqual([g.resources(m.bank), m.take], [[ORE, ORE, ORE, ORE], WOOL], level);
  }
  g.move(0, g.choose("medium"));
  assert.equal(g.choose("medium").settle, spot);
});

test("with nowhere to settle, a road toward the best corner in reach", () => {
  const g = position();
  const { st } = g;
  const home = HEXES[9].corners[0];
  g.place(0, home);
  // Two rich hexes at a corner two roads out, away from the home's own hexes.
  const pipsOf = (c) => sum(cornerYield(st.board, c));
  const away = (c) => CORNERS[c].hexes.filter((h) => land(st, h) && !CORNERS[home].hexes.includes(h));
  const ahead = CORNERS[home].edges.flatMap((e) => CORNERS[otherEnd(e, home)].corners.filter((c) => c !== home).map((c) => [e, c]));
  const [edge, target] = ahead.find(([, c]) => away(c).length >= 2);
  away(target).forEach((h, i) => g.hex(h, [WOOD, BRICK][i], [6, 8][i]));
  g.give(0, WOOD, BRICK);
  assert.ok(pipsOf(target) >= 10);
  for (const level of ["medium", "hard"]) {
    const m = g.choose(level);
    assert.equal(m.road, edge, level);
  }
  const ctx = { state: st, me: 0, inc: [0, 0, 0, 0, 0], weights: [1, 1, 1, 1, 1], numbers: [], level: "medium" };
  assert.equal(roadTarget(ctx).corner, target);
});

test("development cards: a knight off the robot's hex before rolling, monopoly on what the others show", () => {
  const g = position();
  const { st } = g;
  const home = HEXES[9].corners[0];
  g.place(0, home);
  g.hex(9, ORE, 6);
  st.robber = 9;
  const knight = g.dev(0, "knight");
  Object.assign(st, { phase: "roll", rolled: false });
  for (const level of ["medium", "hard"]) assert.deepEqual(g.choose(level), { play: knight }, level);
  assert.deepEqual(timeoutMove(st, 0, g.deck.view(0)), { roll: true });

  // Hard sees the others holding grain face up.
  const h = position();
  h.place(0, HEXES[9].corners[0]);
  h.give(1, GRAIN, GRAIN, WOOD);
  h.give(2, GRAIN, GRAIN);
  const mono = h.dev(0, "monopoly");
  assert.deepEqual(seenHand(h.st, 1, h.deck.view(0)), { known: [1, 0, 0, 2, 0], hidden: 0 });
  assert.deepEqual(h.choose("hard"), { play: mono, resource: GRAIN });
  h.move(0, { play: mono, resource: GRAIN });
  for (const p of [1, 2]) assert.deepEqual(h.resources(chooseMove(h.st, p, Math.random, h.deck.view(p)).give), [GRAIN, GRAIN]);
});

test("offers: Hard asks for its last card from someone who holds it, and never past the cap", () => {
  const g = position();
  const { st } = g;
  g.place(0, HEXES[9].corners[0]);
  g.give(0, ORE, ORE, ORE, GRAIN, WOOD, WOOD);
  g.give(1, GRAIN, BRICK);
  const m = g.choose("hard", 0, "offer");
  assert.deepEqual([g.resources(m.offer), m.want], [[WOOD], [0, 0, 0, 1, 0]]);
  st.offers = MAX_OFFERS;
  assert.ok(!legalMoves(st, 0, g.deck.view(0)).some(has("offer")));
  for (let i = 0; i < 20; i++) assert.ok(!has("offer")(g.choose("hard", 0, `capped ${i}`)));
});

test("the timer's move: roll, end the turn rather than spend, decline; elsewhere a legal choice", () => {
  const g = position();
  const { st } = g;
  const view = g.deck.view(0);
  g.place(0, HEXES[9].corners[0]);
  g.give(0, WOOD, BRICK, WOOL, GRAIN, ORE, ORE, ORE, GRAIN);
  assert.deepEqual(timeoutMove(st, 0, view), { end: true });
  const grain = g.give(0, GRAIN);
  g.give(1, ORE);
  g.move(0, { offer: grain, want: [0, 0, 0, 0, 1] });
  assert.deepEqual(timeoutMove(st, 1, g.deck.view(1)), { decline: true });
  st.trade = null;
  Object.assign(st, { phase: "roll", rolled: false });
  assert.deepEqual(timeoutMove(st, 0, view), { roll: true });
  st.phase = "discard";
  st.discards = [4, 0, 0];
  const d = timeoutMove(st, 0, view);
  assert.equal(d.discard.length, 4);
  st.phase = "robber";
  st.discards = [0, 0, 0];
  const r = timeoutMove(st, 0, view);
  assert.ok(legalMoves(st, 0, view).some((m) => m.robber === r.robber && m.steal === r.steal));
});

test("a discard or Monopoly give of more than 16 cards goes 16 at a time, and free roads before the roll come first", () => {
  const g = position();
  const { st } = g;
  g.place(0, HEXES[9].corners[0]);
  const hand = g.give(1, ...Array(18).fill(WOOL), ...Array(16).fill(GRAIN));
  const view = g.deck.view(1);
  st.phase = "discard";
  st.discards = [0, 17, 0];
  for (const level of LEVEL_NAMES) {
    const m = g.choose(level, 1, `discard ${level}`);
    assert.equal(new Set(m.discard).size, MAX_SHOWN, level);
    assert.ok(m.discard.every((s) => hand.includes(s)), level);
  }
  assert.equal(timeoutMove(st, 1, view).discard.length, MAX_SHOWN);
  st.discards = [0, 1, 0];
  assert.equal(timeoutMove(st, 1, view).discard.length, 1);
  // Monopoly on wool: 16, then the other 2.
  Object.assign(st, { phase: "main", discards: [0, 0, 0] });
  g.move(0, { play: g.dev(0, "monopoly"), resource: WOOL });
  const first = chooseMove(st, 1, Math.random, view);
  assert.deepEqual(timeoutMove(st, 1, view), first);
  assert.deepEqual(g.resources(first.give), Array(MAX_SHOWN).fill(WOOL));
  g.move(1, first);
  assert.equal(first.more, true);
  const rest = chooseMove(st, 1, Math.random, view);
  assert.deepEqual([g.resources(rest.give), rest.more], [[WOOL, WOOL], undefined]);
  g.move(1, rest);
  assert.equal(st.phase, "main");
  // Road building before the roll: the robot and the timer place the free roads, then roll.
  Object.assign(st, { phase: "roll", rolled: false, devPlayed: false });
  g.move(0, { play: g.dev(0, "road") });
  for (const level of LEVEL_NAMES) assert.ok(has("road")(g.choose(level)), level);
  const road = timeoutMove(st, 0, g.deck.view(0));
  assert.ok(legalMoves(st, 0, g.deck.view(0)).some((m) => m.road === road.road));
  g.move(0, road);
  g.move(0, timeoutMove(st, 0, g.deck.view(0)));
  assert.deepEqual([st.freeRoads, timeoutMove(st, 0, g.deck.view(0))], [0, { roll: true }]);
});

test("whole games at every level, 3 and 4 seats: always a legal move in a few ms, and a winner", { skip: skipUnderCoverage }, (t) => {
  let worst = 0;
  const lengths = [];
  for (const levels of [
    ["easy", "medium", "hard"],
    ["hard", "hard", "hard"],
    ["easy", "easy", "easy"],
    ["medium", "easy", "hard", "medium"],
    ["hard", "hard", "hard", "hard"],
    ["easy", "easy", "easy", "easy"],
  ]) {
    for (let s = 0; s < 4; s++) {
      for (const config of [{}, { target: 8 }]) {
        const r = play(levels, `${levels}-${s}-${config.target}`, { config });
        assert.ok(r.state.winner >= 0);
        assert.ok(points(r.state, r.state.winner) >= r.state.target);
        worst = Math.max(worst, r.worst);
        lengths.push(r.state.moves);
      }
    }
  }
  t.diagnostic(`slowest choice ${worst.toFixed(1)} ms; ${Math.min(...lengths)} to ${Math.max(...lengths)} moves a game`);
  assert.ok(worst < 40, `slowest choice took ${worst.toFixed(1)} ms`);
});

test("Hard beats Easy clearly, Medium beats Easy, and Hard beats Medium more often than its share", (t) => {
  const rate = (a, b, n, players) => {
    let wins = 0;
    let moves = 0;
    let rolls = 0;
    for (let i = 0; i < n; i++) {
      const seat = i % players;
      const r = play(Array.from({ length: players }, (_, p) => (p === seat ? a : b)), `${a} v ${b} ${players} ${i}`);
      if (r.state.winner === seat) wins++;
      moves += r.state.moves;
      rolls += r.rolls;
    }
    t.diagnostic(`${a} against ${players - 1} ${b}: won ${Math.round((wins / n) * 100)}% (a fair share ${Math.round(100 / players)}%), ${Math.round(moves / n)} moves and ${Math.round(rolls / n)} rolls a game`);
    return wins / n;
  };
  // About 96%, 92% and 45% over 400 games.
  for (const players of [3, 4]) {
    assert.ok(rate("hard", "easy", 60, players) > 0.75);
    assert.ok(rate("medium", "easy", 60, players) > 0.6);
    assert.ok(rate("hard", "medium", 120, players) > 1 / players + 0.05);
  }
});

test("a robot never reads another hand: changing the cards hidden from it leaves every choice the same", () => {
  let compared = 0;
  for (const level of LEVEL_NAMES) {
    for (let s = 0; s < 2; s++) {
      play([level, "medium", level, "hard"], `swap ${level} ${s}`, {
        onChoice(state, p, m, deck) {
          if (compared % 3) return void compared++;
          // Another deck where every card p can't see is somewhere else among those same hidden places.
          const hidden = deck.slots.flatMap((x, id) => (!x.gone && !x.open && x.owner !== p ? [id] : []));
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
  assert.ok(compared > 1000, `${compared} choices`);
});

// ---------- over the card engine ----------
const tick = () => new Promise((r) => setTimeout(r, 1));

async function engineGame(levels, seed) {
  const players = levels.length;
  const sessions = localRoom({ game: "hexlands", names: levels.map((_, i) => `P${i}`), mode: "friend" });
  const rules = makeRules({}, players);
  const robots = sessions.map((s, i) =>
    startRobot(s, { rules, choose: (st, me, rng, face) => chooseMove(st, me, rng, face, { level: levels[i] }), delay: () => 0, rng: rngFromSeed(`${seed} ${i}`) }),
  );
  const matches = robots.map((r) => r.match);
  let refused = 0;
  for (const m of matches) m.on("invalid", () => refused++);
  const t0 = Date.now();
  try {
    while (!matches.every((m) => m.verdict || m.phase === "aborted")) {
      if (Date.now() - t0 > 240_000) throw new Error("timeout");
      await tick();
    }
  } finally {
    for (const r of robots) r.destroy();
  }
  return { matches, refused, ms: Date.now() - t0 };
}

for (const levels of [
  ["easy", "medium", "hard"],
  ["hard", "easy", "medium", "hard"],
]) {
  test(`over the card engine, ${levels.join(", ")}: a winner, the same state everywhere, a passing audit`, { timeout: 300_000 }, (t) =>
    withSeededRandom(`hexlands robots ${levels.length}`, async () => {
      const { matches, refused, ms } = await engineGame(levels, `engine ${levels.length}`);
      for (const m of matches) {
        assert.equal(m.phase, "over", m.abortReason);
        assert.deepEqual(m.verdict, { ok: true });
        assert.deepEqual(m.state, matches[0].state);
      }
      assert.equal(refused, 0, "every robot move was legal");
      const st = matches[0].state;
      assert.ok(st.winner >= 0);
      t.diagnostic(`${levels[st.winner]} (seat ${st.winner}) won in ${st.moves} moves, ${ms} ms with the audit`);
    }),
  );
}
