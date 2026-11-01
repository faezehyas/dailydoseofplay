import test from "node:test";
import assert from "node:assert/strict";
import { KnownDeck, settleAll } from "../../test/fixtures/known-deck.js";
import { withSeededRandom, skipUnderCoverage } from "../../test/helpers.js";
import { rngFromSeed } from "../engine/rng.js";
import { localRoom } from "../engine/room.js";
import { CARDS, WONDERS } from "./cards.js";
import { makeRules, legalMoves, movers, canBuild, designOf, deckOf, score } from "./rules.js";
import { chooseMove, timeoutMove, startRobot, LEVELS } from "./robot.js";

const LEVEL_NAMES = Object.keys(LEVELS);
const has = (k) => (m) => Object.hasOwn(m, k);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const W = (key) => WONDERS.findIndex((w) => w.key === key);
const ID = (key, age) => {
  const c = CARDS.find((x) => x.key === key && (age === undefined || x.age === age));
  assert.ok(c, `no card ${key}`);
  return c.id;
};
const isLegal = (state, p, face, m) => legalMoves(state, p, face).some((x) => JSON.stringify(x) === JSON.stringify(m));

// A seeded game straight on the rules (no cryptography), each robot seeing only what its seat may.
function play(levels, seed, { config = { side: "random" }, onChoice = () => {} } = {}) {
  const n = levels.length;
  const rules = makeRules(config, n);
  const deck = new KnownDeck([...Array(rules.deckSize).keys()], `deck ${seed}`);
  for (const s of deck.slots) s.open = true;
  const rng = rngFromSeed(`robots ${seed}`);
  const state = rules.newState(0, n, deck, rngFromSeed(`table ${seed}`));
  settleAll(rules, state, deck);
  let worst = 0;
  while (state.winner === -1) {
    // A step's movers all choose on the same state, as their commitments do.
    const moves = movers(state).map((p) => {
      const t0 = performance.now();
      const m = chooseMove(state, p, rng, deck.view(p), { level: levels[p] });
      worst = Math.max(worst, performance.now() - t0);
      onChoice(state, p, m, deck);
      return [p, m];
    });
    for (const [p, m] of moves) {
      for (const id of rules.reveals(state, p, m)) deck.slots[id].open = true;
      rules.applyMove(state, p, m, deck);
    }
    settleAll(rules, state, deck);
  }
  return { state, worst };
}

// A table after the deal with every face known to the test. hand/city replace
// a seat's cards with fresh slots of the named designs (keys, or ids).
function table({ players = 3, wonders, age = 1, round = 1 } = {}) {
  const rules = makeRules({ side: "A" }, players);
  const deck = new KnownDeck([...Array(rules.deckSize).keys()], "position");
  for (const s of deck.slots) s.open = true;
  const st = rules.newState(0, players, deck, rngFromSeed("position"));
  settleAll(rules, st, deck);
  if (wonders) st.wonders = wonders.map(([key, side = "A"]) => ({ w: W(key), side }));
  Object.assign(st, { age, round });
  const slot = (k, owner, open) => {
    const id = typeof k === "number" ? k : ID(k);
    const face = deckOf(players).indexOf(id);
    assert.ok(face >= 0, `${CARDS[id].key} isn't in a ${players}-player deck`);
    return deck.slots.push({ face, owner, open, gone: false, held: [] }) - 1;
  };
  const t = {
    rules,
    deck,
    st,
    slot,
    hand: (p, ...keys) => (st.hands[p] = keys.map((k) => slot(k, p, false))),
    city: (p, ...keys) => (st.city[p] = keys.map((k) => ({ slot: slot(k, p, true), id: typeof k === "number" ? k : ID(k) }))),
    stages: (p, n) => (st.stages[p] = Array.from({ length: n }, () => slot(CARDS[deckOf(players)[0]].id, p, false))),
    choose: (level, p = 0, seed = "pos") => chooseMove(st, p, rngFromSeed(seed), deck.view(p), { level }),
    name: (slot) => CARDS[designOf(players, deck.slots[slot].face)].key,
  };
  return t;
}

test("science: a third different symbol beats a five-point blue card", () => {
  const t = table({ wonders: [["giza"], ["rhodes"], ["ephesus"]], age: 2, round: 2 });
  t.city(0, "herbalist", "tinkers-shed", "woodcutters-camp", "reed-press", ID("great-quarry"));
  const [tutors] = t.hand(0, "tutors-court", "water-channel", ID("smeltery"));
  for (const level of ["medium", "hard"]) assert.deepEqual(t.choose(level), { build: tutors }, level);
});

test("military: the last pick of the game takes the shields that beat both neighbours over six points", () => {
  const t = table({ wonders: [["rhodes"], ["giza"], ["ephesus"]], age: 3, round: 6 });
  t.city(0, ID("timber-mill"), ID("smeltery"), ID("weavers-hall", 2), ID("great-quarry"), ID("glass-kiln", 2), "palisade", "guard-post");
  t.city(1, "ramparts", "palisade");
  t.city(2, "bow-yard", "watchtower");
  const [armoury] = t.hand(0, "armoury", "council-house");
  for (const level of ["medium", "hard"]) assert.deepEqual(t.choose(level), { build: armoury }, level);
  // A war already lost by more than three shields leaves the points.
  t.city(1, "ramparts", "palisade", "bastions", "siege-yard");
  t.city(2, "bow-yard", "watchtower", "horse-paddock", "siege-yard", "guard-post");
  for (const level of ["medium", "hard"]) assert.equal(t.name(t.choose(level).build), "council-house", level);
});

test("hate drafting: with nothing to build, Hard sells the card the next seat needs for its science", () => {
  // Age II passes right: seat 0's hand goes to seat 2.
  const t = table({ wonders: [["giza"], ["rhodes"], ["olympia"]], age: 2, round: 2 });
  t.st.coins[0] = 0;
  t.city(0, ID("timber-mill"));
  t.city(2, "herbalist", "tinkers-shed", "infirmary", "inventors-hall", ID("reed-press", 1));
  const [, , tutors] = t.hand(0, ID("timber-mill"), "brickworks", "tutors-court");
  assert.ok(canBuild(t.st, 2, ID("tutors-court")).ok);
  assert.ok(!canBuild(t.st, 0, ID("tutors-court")).ok);
  assert.deepEqual(t.choose("hard"), { discard: tutors });
});

test("Olympia's free build: never on a card free anyway, on the dearest card before the age ends", () => {
  const t = table({ wonders: [["olympia"], ["rhodes"], ["giza"]], age: 2, round: 6 });
  t.stages(0, 2);
  t.st.coins[0] = 0;
  t.city(0, "shrine");
  const [bronze] = t.hand(0, "bronze-figure", "olive-press");
  assert.ok(!canBuild(t.st, 0, ID("bronze-figure")).purchases.length);
  for (const level of ["medium", "hard"]) assert.deepEqual(t.choose(level), { build: bronze, free: true }, level);
  // Early in the age the chain card is built through its chain, never with the free build.
  t.st.round = 2;
  const [sanctuary] = t.hand(0, "sanctuary", "ore-seam");
  assert.ok(legalMoves(t.st, 0, t.deck.view(0)).some((m) => m.build === sanctuary && m.free));
  for (const level of LEVEL_NAMES) {
    for (let i = 0; i < 10; i++) {
      const m = t.choose(level, 0, `free ${i}`);
      assert.ok(!(m.free && t.name(m.build) === "sanctuary"), level);
    }
  }
});

test("a dig builds the best discarded card; Babylon's last card is built when it's worth it", () => {
  const t = table({ wonders: [["halicarnassus"], ["babylon", "B"], ["giza"]], age: 3, round: 3 });
  const pile = [t.slot("stone-cut", 0, false), t.slot("crown-hall", 0, false), t.slot("palisade", 0, false)];
  Object.assign(t.st, { phase: "dig", digger: 0, discard: pile });
  for (const level of LEVEL_NAMES) assert.deepEqual(t.choose(level), { dig: pile[1] }, level);

  Object.assign(t.st, { phase: "last", digger: -1, lastSeat: 1, discard: [], round: 6 });
  t.stages(1, 2);
  t.city(1, ID("great-quarry"), "ore-seam", ID("glass-kiln", 1));
  const [council] = t.hand(1, "council-house");
  for (const level of ["medium", "hard"]) assert.deepEqual(t.choose(level, 1), { build: council }, level);
});

test("purchases: Hard pays the neighbour who's behind when either side sells at the same price", () => {
  const t = table({ wonders: [["ephesus"], ["giza"], ["rhodes"]] });
  t.city(1, "shrine", "amphitheatre");
  t.city(2, "stone-cut");
  const [springs] = t.hand(0, "hot-springs", "ore-seam");
  const buys = legalMoves(t.st, 0, t.deck.view(0)).filter((m) => m.build === springs);
  assert.equal(buys.length, 2);
  assert.ok(score(t.st, 1).total > score(t.st, 2).total);
  const m = t.choose("hard");
  assert.deepEqual(m.build === springs && m.buy.right, [0, 1, 0, 0, 0, 0, 0]);
});

test("Easy plays gently: it builds what it affords, varies, and sells only when stuck", () => {
  const t = table({ wonders: [["giza"], ["rhodes"], ["ephesus"]] });
  t.hand(0, "stone-cut", "hot-springs", "shrine", "palisade", "herbalist", "east-road", "clay-bank");
  const picks = new Set();
  for (let i = 0; i < 30; i++) {
    const m = t.choose("easy", 0, `easy ${i}`);
    assert.ok(has("build")(m), `easy ${i}: ${JSON.stringify(m)}`);
    picks.add(t.name(m.build));
  }
  assert.ok(picks.size >= 3, `easy picked ${[...picks]}`);
  // Nothing it can build or stage: it sells.
  t.st.coins[0] = 0;
  t.stages(0, 3);
  t.city(0, "stone-cut");
  t.hand(0, "stone-cut", "red-hollow");
  assert.ok(has("discard")(t.choose("easy")));
});

test("the timer's move: what Medium picks, the same every time, and the only dig when there's nothing to build", () => {
  const t = table({ wonders: [["giza"], ["rhodes"], ["ephesus"]], age: 2, round: 3 });
  t.city(0, "herbalist", "tinkers-shed", "woodcutters-camp", "reed-press");
  t.hand(0, "tutors-court", "water-channel", ID("smeltery"), "olive-press", "bow-yard");
  const view = t.deck.view(0);
  const m = timeoutMove(t.st, 0, view);
  assert.ok(isLegal(t.st, 0, view, m));
  assert.deepEqual(m, t.choose("medium"));
  assert.deepEqual(timeoutMove(t.st, 0, view), m);
  Object.assign(t.st, { phase: "dig", digger: 0, discard: [t.slot("herbalist", 0, false)] });
  assert.deepEqual(timeoutMove(t.st, 0, view), { dig: -1 });
  for (const level of LEVEL_NAMES) assert.deepEqual(t.choose(level), { dig: -1 }, level);
});

test("whole games at every level, 3 and 4 seats: always a legal move, well under 50 ms, never a wasted free build", { skip: skipUnderCoverage }, (t) => {
  let worst = 0;
  let choices = 0;
  for (const levels of [
    ["easy", "medium", "hard"],
    ["hard", "hard", "hard"],
    ["easy", "easy", "easy"],
    ["medium", "easy", "hard", "medium"],
    ["hard", "hard", "hard", "hard"],
  ]) {
    for (let s = 0; s < 3; s++) {
      for (const side of ["A", "B", "random"]) {
        const r = play(levels, `${levels}-${s}-${side}`, {
          config: { side },
          onChoice(state, p, m, deck) {
            choices++;
            const face = deck.view(p);
            assert.ok(isLegal(state, p, face, m), `${levels[p]}: ${JSON.stringify(m)}`);
            if (!m.free) return;
            const can = canBuild(state, p, designOf(state.players, face(m.build)));
            assert.ok(!can.chain && !(can.purchases[0]?.coins === 0 && CARDS[designOf(state.players, face(m.build))].cost.coins === 0), "a free build on a card free anyway");
          },
        });
        assert.equal(r.state.phase, "over");
        worst = Math.max(worst, r.worst);
      }
    }
  }
  t.diagnostic(`${choices} choices, the slowest ${worst.toFixed(1)} ms`);
  assert.ok(worst < 50, `slowest choice took ${worst.toFixed(1)} ms`);
});

test("Hard beats Easy clearly, and Medium beats Easy", (t) => {
  const rate = (a, b, n, players) => {
    let wins = 0;
    let mine = 0;
    let theirs = 0;
    for (let i = 0; i < n; i++) {
      const seat = i % players;
      const r = play(Array.from({ length: players }, (_, p) => (p === seat ? a : b)), `${a} v ${b} ${players} ${i}`);
      if (r.state.winners.includes(seat)) wins += 1 / r.state.winners.length;
      const totals = [...Array(players).keys()].map((p) => score(r.state, p).total);
      mine += totals[seat];
      theirs += (sum(totals) - totals[seat]) / (players - 1);
    }
    t.diagnostic(`${a} against ${players - 1} ${b}: won ${Math.round((wins / n) * 100)}% (a fair share ${Math.round(100 / players)}%), ${(mine / n).toFixed(1)} points to ${(theirs / n).toFixed(1)}`);
    return wins / n;
  };
  // Over 600 games: Hard 89% at 3 seats and 84% at 4, Medium 79% and 64%.
  for (const players of [3, 4]) {
    assert.ok(rate("hard", "easy", 24, players) > 0.6);
    assert.ok(rate("medium", "easy", 24, players) > 1 / players + 0.1);
  }
});

test("a robot never reads a hidden card: reshuffling every card it hasn't seen leaves every choice the same", () => {
  let compared = 0;
  // Once every hand has been round the table, the robot has held every card left in the other hands.
  for (const levels of LEVEL_NAMES.flatMap((l) => [[l, "medium", l, "hard"], [l, "hard", l]])) {
    play(levels, `hidden ${levels}`, {
      config: { side: "B" },
      onChoice(state, p, m, deck) {
        // Every slot p can't see (other hands, tucked cards, discards it never held, the guilds left out), with its faces shuffled among them.
        const hidden = deck.slots.flatMap((x, id) => (!x.gone && !x.open && x.owner !== p && !x.held.includes(p) ? [id] : []));
        if (hidden.length < 2) return;
        const other = new KnownDeck(deck.slots.map((x) => x.face));
        other.slots.forEach((x, id) => Object.assign(x, { ...deck.slots[id], held: deck.slots[id].held.slice() }));
        const faces = hidden.map((id) => deck.slots[id].face);
        const rng = rngFromSeed(`perm ${compared}`);
        for (let i = faces.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [faces[i], faces[j]] = [faces[j], faces[i]];
        }
        hidden.forEach((id, i) => (other.slots[id].face = faces[i]));
        if (hidden.every((id, i) => deck.slots[id].face === faces[i])) return;
        const again = chooseMove(structuredClone(state), p, rngFromSeed("same"), other.view(p), { level: levels[p] });
        assert.deepEqual(again, chooseMove(state, p, rngFromSeed("same"), deck.view(p), { level: levels[p] }), `${levels}: seat ${p}, move ${state.moves}`);
        compared++;
      },
    });
  }
  assert.ok(compared > 200, `${compared} choices`);
});

// ---------- over the card engine ----------
const tick = () => new Promise((r) => setTimeout(r, 1));

test("over the card engine, three Hard robots: a winner, the same state everywhere, a passing audit, every move legal", { timeout: 300_000 }, (t) =>
  withSeededRandom("stonecrown robots", async () => {
    const levels = ["hard", "hard", "hard"];
    const sessions = localRoom({ game: "stonecrown", names: levels.map((_, i) => `P${i}`), mode: "friend" });
    const rules = makeRules({ side: "random" }, levels.length);
    const robots = sessions.map((s, i) =>
      startRobot(s, { rules, choose: (st, me, rng, face) => chooseMove(st, me, rng, face, { level: levels[i] }), delay: () => 0, rng: rngFromSeed(`engine ${i}`) }),
    );
    const matches = robots.map((r) => r.match);
    let refused = 0;
    for (const m of matches) m.on("invalid", () => refused++);
    const t0 = Date.now();
    try {
      while (!matches.every((m) => m.verdict || m.phase === "aborted")) {
        if (Date.now() - t0 > 280_000) throw new Error("timeout");
        await tick();
      }
    } finally {
      for (const r of robots) r.destroy();
    }
    for (const m of matches) {
      assert.equal(m.phase, "over", m.abortReason);
      assert.deepEqual(m.verdict, { ok: true });
      assert.deepEqual(m.state, matches[0].state);
    }
    assert.equal(refused, 0, "every robot move was legal");
    const st = matches[0].state;
    assert.ok(st.winner >= 0 || st.winners.length > 1);
    t.diagnostic(`seats ${st.winners} won with ${st.winners.map((p) => score(st, p).total)} points in ${st.moves} picks, ${Date.now() - t0} ms with the audit`);
  }),
);
