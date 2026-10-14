// Every game in games.json, played at random, by its robots and with garbage
// moves, against what all games share: a game ends, a robot's move is always
// legal, a match's shared draws stay within the rules' budget, and a
// malformed move is a RuleError that leaves the state as it was. A game is
// covered as soon as it is listed; see step 7 in CONTRIBUTING.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rngFromSeed, randInt } from "../public/engine/rng.js";
import { localRoom } from "../public/engine/room.js";
import { startCardRobot } from "../public/engine/card-match.js";

const { games } = JSON.parse(readFileSync(new URL("../public/games.json", import.meta.url), "utf8"));

const RANDOM_GAMES = 50;
const ROBOT_GAMES = 20;
const MAX_MOVES = 5000;
const DRAWS = 256; // SharedRandom's default budget

// What arrives when a peer sends anything at all; `legal` hides behind an own
// __proto__ key, as JSON.parse makes it.
const garbage = (legal) => [null, undefined, {}, [], "x", NaN, -1, 1e9, 1.5, JSON.parse(`{"__proto__":${JSON.stringify(legal ?? {})}}`), "x".repeat(100_000)];

// The move itself as garbage, then the move with one field changed to each.
function garbled(move) {
  const out = garbage(move).map((bad) => ({ bad, whole: true }));
  for (const key of Object.keys(move)) for (const v of garbage(move)) out.push({ bad: { ...move, [key]: v }, whole: false });
  return out;
}

// One option at a time at each value normalizeConfig keeps, the others at
// their defaults. Candidates: the values in the rules' exported lists,
// booleans and small numbers.
function configs(mod) {
  const pool = new Set([true, false, ...Array(11).keys()]);
  for (const v of Object.values(mod)) if (Array.isArray(v)) for (const x of v) if (typeof x !== "object") pool.add(x);
  const base = mod.normalizeConfig({});
  const out = [base];
  for (const key of Object.keys(base)) {
    for (const v of pool) if (v !== base[key] && mod.normalizeConfig({ ...base, [key]: v })[key] === v) out.push({ ...base, [key]: v });
  }
  return out;
}

// The robot levels to play at: the config's own, else the robot's presets.
function levels(variants, robot) {
  const set = [...new Set(variants.map((c) => c.level).filter((l) => l !== undefined))];
  if (set.length) return set;
  const presets = Object.keys(robot.LEVELS ?? robot.LEVEL ?? {});
  return presets.length ? presets : [undefined];
}

// Pick from list in a random order, the first that ok() takes.
function firstOk(rng, list, ok) {
  const a = list.slice();
  for (let i = 0; i < a.length; i++) {
    const j = i + randInt(rng, a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
    if (ok(a[i])) return a[i];
  }
  return null;
}

const isRuleError = (err) => err?.name === "RuleError";

// Moves 0, 1, 2, 4, 8, 16…: a few from every stage of a game, however long.
const sparse = (n) => (n & (n - 1)) === 0;

// Runs fn, naming the game, config, seed and move in any failure.
function at(where, n, fn) {
  try {
    return fn();
  } catch (err) {
    throw new Error(`${where}, move ${n}: ${err.message}`, { cause: err });
  }
}

// ---------- turn games ----------

const noRandom = () => {
  throw new Error("used randomness on a move needsRandom() said needs none");
};

// Legal moves where a move has more than one free field. Every other game's
// candidates are its robot's move with each integer field set to 0..255.
const LEGAL = {
  chess: (mod, st) => mod.listMoves(st),
  checkers: (mod, st, p) => mod.legalMoves(st.board, p).map((path) => ({ path })),
  backgammon: (mod, st, p) => (st.rolled ? mod.legalPlays(st.pos, p, st.dice).map(({ steps }) => ({ type: "play", steps })) : [{ type: "roll" }]),
  ludo: (mod, st, p) => (st.rolled ? mod.legalMoves(st, p).map(({ token }) => ({ type: "move", token })) : [{ type: "roll" }]),
};

function candidates(slug, mod, st, p, choose) {
  if (LEGAL[slug]) return LEGAL[slug](mod, st, p);
  const move = choose();
  const out = [move];
  for (const [key, v] of Object.entries(move)) if (Number.isInteger(v)) for (let i = 0; i < 256; i++) out.push({ ...move, [key]: i });
  return out;
}

// Garbage in place of the move about to be played: refused with a RuleError
// and the state untouched, or (a field the move doesn't need) played like
// the move. apply(state, move) plays it on a copy.
function checkGarbage(st, move, apply, list = garbled(move)) {
  const played = structuredClone(st);
  const out = apply(played, move);
  for (const { bad, whole } of list) {
    const what = String(JSON.stringify(bad)).slice(0, 80);
    const s = structuredClone(st);
    let result;
    try {
      result = apply(s, bad);
    } catch (err) {
      assert.ok(isRuleError(err), `${what} threw ${err}, not a RuleError`);
      assert.deepEqual(s, st, `${what} changed the state before it was refused`);
      continue;
    }
    assert.ok(!whole, `${what} was played`);
    assert.deepEqual([s, result], [played, out], `${what} played differently from the move`);
  }
}

// One game: seats[p] is seat p's robot level, or null for uniform random
// legal play. Returns the shared draws it used.
function playTurnGame({ slug, mod, robot, config, players, seed, seats, withGarbage, budget }) {
  const where = `${slug}, ${players} players, ${JSON.stringify(config)}, seed "${seed}"`;
  const rng = rngFromSeed(seed);
  const dice = rngFromSeed(`${seed} dice`);
  const rules = mod.makeRules(config, players);
  const st = rules.newState(randInt(rng, players), players);
  let draws = 1; // who starts
  for (let n = 0; st.winner === -1; n++) {
    assert.ok(n < MAX_MOVES, `${where}: no winner after ${MAX_MOVES} moves`);
    at(where, n, () => {
      const p = st.turn;
      const ms = randInt(rng, 100);
      const choose = () => robot.chooseMove(st, p, rng, { level: seats[p] ?? config.level });
      const tryMove = (m) => {
        try {
          rules.applyMove(structuredClone(st), p, { ...m, ms }, rules.needsRandom?.(st, m) ? rngFromSeed("try") : noRandom);
          return true;
        } catch (err) {
          if (isRuleError(err)) return false;
          throw err;
        }
      };
      const picked = seats[p] !== null ? choose() : firstOk(rng, candidates(slug, mod, st, p, choose), LEGAL[slug] ? () => true : tryMove);
      assert.ok(picked, "no legal move");
      const move = { ...picked, ms };
      if (withGarbage && sparse(n)) checkGarbage(st, move, (s, m) => void rules.applyMove(s, p, m, rules.needsRandom?.(s, m) ? rngFromSeed("garbage") : noRandom));
      const random = !!rules.needsRandom?.(st, move);
      if (random) draws++;
      try {
        rules.applyMove(st, p, move, random ? dice : noRandom);
      } catch (err) {
        err.message = `${seats[p] !== null ? "the robot's" : "a legal"} move ${JSON.stringify(move)} was refused: ${err.message}`;
        throw err;
      }
    });
  }
  assert.ok(draws <= budget, `${where}: used ${draws} shared draws, over its ${budget}`);
  return draws;
}

// Random games cycle through the configs, with garbage in each config's first
// at the smallest table; robot games too, one seat playing at random and the
// others at robot levels in turn, so every level plays.
function fuzzTurnGame(t, { slug, maxPlayers }, mod, robot) {
  const budget = mod.makeRules(mod.normalizeConfig({})).draws ?? DRAWS;
  const variants = configs(mod);
  const robotLevels = levels(variants, robot);
  let most = 0;
  const fewest = mod.MIN_PLAYERS ?? 2;
  for (let players = fewest; players <= maxPlayers; players++) {
    for (let g = 0; g < RANDOM_GAMES; g++) {
      const seats = Array(players).fill(null);
      const draws = playTurnGame({ slug, mod, robot, config: variants[g % variants.length], players, seed: `random ${g}`, seats, withGarbage: players === fewest && g < variants.length, budget });
      most = Math.max(most, draws);
    }
    for (let g = 0; g < ROBOT_GAMES; g++) {
      const seats = Array.from({ length: players }, (_, p) => (p === g % players ? null : robotLevels[(g + p) % robotLevels.length]));
      const draws = playTurnGame({ slug, mod, robot, config: variants[g % variants.length], players, seed: `robot ${g}`, seats, withGarbage: false, budget });
      most = Math.max(most, draws);
    }
  }
  t.diagnostic(`${slug}: at most ${most} of ${budget} shared draws`);
}

// ---------- Sea Battle: hidden fleets, each shot answered by its defender ----------

// A fleet that isn't legal is refused, never a crash.
function checkFleetGarbage(mod, fleet) {
  const refused = (f) => assert.equal(mod.validateFleet(f).ok, false, `fleet ${String(JSON.stringify(f)).slice(0, 80)} was accepted`);
  for (const bad of garbage(fleet)) refused(bad);
  for (const [i, ship] of fleet.entries()) {
    for (const bad of garbage(ship)) refused(fleet.with(i, bad));
    for (const key of Object.keys(ship)) for (const bad of garbage(ship)) refused(fleet.with(i, { ...ship, [key]: bad }));
  }
}

// Every shot the shooter's weapons could aim.
function shots(mod, st, p) {
  const out = [];
  for (const weapon of Object.keys(mod.WEAPONS).filter((w) => mod.weaponAvailable(st, p, w))) {
    if (weapon === "rain") out.push({ weapon });
    else for (let target = 0; target < mod.CELLS; target++) for (const dir of weapon === "carpet" ? mod.DIRS : [undefined]) out.push({ weapon, target, dir });
  }
  return out;
}

// One game, played the way match.js plays it (String(w) as it reads a fire
// message). Returns the shared draws it used.
function playSeaBattle({ mod, robot, config, seed, robots, withGarbage }) {
  const where = `sea-battle, ${JSON.stringify(config)}, seed "${seed}"`;
  const rng = rngFromSeed(seed);
  const dice = rngFromSeed(`${seed} dice`);
  const fleets = [mod.randomFleet(rng), mod.randomFleet(rng)];
  for (const fleet of fleets) assert.deepEqual(mod.validateFleet(fleet), { ok: true }, where);
  if (withGarbage) checkFleetGarbage(mod, fleets[0]);
  const st = mod.newMatchState(randInt(rng, 2), mod.normalizeConfig(config));
  let draws = 1; // who starts
  for (let n = 0; st.winner === -1; n++) {
    assert.ok(n < MAX_MOVES, `${where}: no winner after ${MAX_MOVES} shots`);
    at(where, n, () => {
      const p = st.turn;
      const ms = randInt(rng, 100);
      const check = (s, f) => mod.checkFire(s, p, String(f?.weapon), f?.target, f?.ms, f?.dir);
      const legal = (f) => {
        try {
          check(st, { ...f, ms });
          return true;
        } catch (err) {
          if (isRuleError(err)) return false;
          throw err;
        }
      };
      const picked = robots ? robot.chooseMove(st, p, rng) : firstOk(rng, shots(mod, st, p), legal);
      assert.ok(picked, "no legal shot");
      const fire = { ...picked, ms };
      if (withGarbage && sparse(n)) checkGarbage(st, fire, check);
      let cells = check(st, fire);
      if (cells === null) {
        cells = mod.rainCells(st.boards[1 - p], dice);
        draws++;
      }
      const answer = mod.answerShots(fleets[1 - p], st.boards[1 - p], cells);
      const resolve = (s, a) => mod.applyFire(s, p, fire.weapon, cells, a?.hits, a?.sunk, { ms, target: fire.target });
      // An empty sunk list is a well-formed answer (a lie the audit catches), not garbage.
      if (withGarbage && sparse(n)) checkGarbage(st, answer, resolve, garbled(answer).filter(({ bad }) => !(Array.isArray(bad?.sunk) && bad.sunk !== answer.sunk && !bad.sunk.length)));
      resolve(st, answer);
      if (mod.giftsDue(st)) {
        mod.spawnGifts(st, dice);
        draws++;
      }
    });
  }
  assert.ok(draws <= DRAWS, `${where}: used ${draws} shared draws, over its ${DRAWS}`);
  return draws;
}

function fuzzSeaBattle(t, mod, robot) {
  const variants = configs(mod);
  let most = 0;
  for (let g = 0; g < RANDOM_GAMES; g++) most = Math.max(most, playSeaBattle({ mod, robot, config: variants[g % variants.length], seed: `random ${g}`, robots: false, withGarbage: g < variants.length }));
  for (let g = 0; g < ROBOT_GAMES; g++) most = Math.max(most, playSeaBattle({ mod, robot, config: variants[g % variants.length], seed: `robot ${g}`, robots: true, withGarbage: false }));
  t.diagnostic(`sea-battle: at most ${most} of ${DRAWS} shared draws`);
}

// ---------- card games: CardMatch over a localRoom, a robot in every seat ----------

const tick = () => new Promise((r) => setTimeout(r, 1));

// One match; seat 0 tries garbage on its first turn, before its real move.
async function playCardGame({ slug, mod, robot, config, players, seed, seats }) {
  const where = `${slug}, ${players} players, ${JSON.stringify(config)}, seed "${seed}"`;
  const rules = mod.makeRules(config, players);
  const sessions = localRoom({ game: slug, names: Array.from({ length: players }, (_, i) => `P${i}`) });
  let tries = null;
  const played = [];
  const bots = sessions.map((s, i) =>
    startCardRobot(s, {
      rules,
      delay: 0,
      rng: rngFromSeed(`${seed} seat ${i}`),
      choose: (st, me, rng, face) => {
        const move = robot.chooseMove(st, me, rng, face, { level: seats[i] });
        if (i === 0) tries ??= garbled(move);
        const next = i === 0 ? tries.shift() : undefined;
        if (next) played.push(next);
        return next ? next.bad : move;
      },
    }),
  );
  const refused = [];
  bots[0].match.on("invalid", () => refused.push(played.at(-1)));
  try {
    while (!bots.every((b) => b.match.verdict || b.match.phase === "aborted")) await tick();
  } finally {
    for (const b of bots) b.destroy();
  }
  for (const b of bots) assert.deepEqual(b.match.verdict, { ok: true }, `${where}: seat ${b.match.me}: ${b.match.abortReason ?? JSON.stringify(b.match.verdict)}`);
  for (const p of played) if (p.whole) assert.ok(refused.includes(p), `${where}: ${String(JSON.stringify(p.bad)).slice(0, 80)} was played`);
}

// One match at the smallest table: a match takes one to several seconds, so
// larger tables are left to each game's match.test.js. A game with a target
// plays one hand (target 0).
async function fuzzCardGame({ slug }, mod, robot) {
  const base = mod.normalizeConfig({});
  const config = mod.normalizeConfig({ target: 0 }).target === 0 ? { ...base, target: 0 } : base;
  const players = mod.MIN_PLAYERS ?? 2;
  const robotLevels = levels(configs(mod), robot);
  const seats = Array.from({ length: players }, (_, p) => robotLevels[p % robotLevels.length]);
  await playCardGame({ slug, mod, robot, config, players, seed: "cards", seats });
}

for (const game of games) {
  test(`${game.name}: random, robot and garbage moves`, async (t) => {
    const mod = await import(`../public/${game.slug}/rules.js`);
    const robot = await import(`../public/${game.slug}/robot.js`);
    if (mod.validateFleet) fuzzSeaBattle(t, mod, robot);
    else if (mod.makeRules(mod.normalizeConfig({}), mod.MIN_PLAYERS ?? 2).deckSize) await fuzzCardGame(game, mod, robot);
    else fuzzTurnGame(t, game, mod, robot);
  });
}
