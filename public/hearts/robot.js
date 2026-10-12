// Hearts robots: the public state (every card played, every void shown, who
// took which points), their own face() and the cards passed to them, nothing
// else. Easy plays a random legal card and passes three at random. Medium
// ducks under the trick, dumps the queen of spades and high hearts when void,
// and passes its highest spades and hearts. Hard also counts every card,
// tracks voids, plans its pass (voids, dangerous cards, or a moon shot),
// stops an opponent shooting the moon and shoots it itself when its hand
// allows. The lead of the 2 of clubs, an only legal card and the next hand
// are forcedMove(). See "Hearts in depth" in ARCHITECTURE.md.
import { startPacedRobot } from "../engine/cards/paced-robot.js";
import { suitOf } from "../engine/cards/faces.js";
import { forcedMove, legalPlays, cardsOf, trickWinner, power, isPoint, HEARTS, SPADES, DIAMONDS, CLUBS, QUEEN_SPADES, TWO_DIAMONDS, PASS_COUNT } from "./rules.js";

const pickRandom = (list, rng) => list[Math.floor(rng() * list.length)];
const highest = (slots, face) => slots.reduce((a, b) => (power(face(b)) > power(face(a)) ? b : a));
const lowestOf = (slots, face) => slots.reduce((a, b) => (power(face(b)) < power(face(a)) ? b : a));

// What `me` knows this hand: its cards, those played, the cards still out and each seat's voids.
export function knowledge(state, me, face) {
  const mine = state.hands[me].map(face);
  const played = new Set(state.played.map((x) => x.face));
  const voids = Array.from({ length: state.players }, () => new Set());
  const leadOf = new Map(state.played.filter((x) => x.lead).map((x) => [x.trick, suitOf(x.face)]));
  for (const x of state.played) if (!x.lead && suitOf(x.face) !== leadOf.get(x.trick)) voids[x.p].add(leadOf.get(x.trick));
  const out = [];
  for (let f = 0; f < 52; f++) if (!(state.players === 3 && f === TWO_DIAMONDS) && !played.has(f) && !mine.includes(f)) out.push(f);
  return { mine, played, out, voids };
}

// Hearts and the queen each seat has taken this hand, from the public tricks.
export function pointsTaken(state) {
  const taken = Array(state.players).fill(0);
  const tricks = new Map();
  for (const x of state.played) {
    if (!tricks.has(x.trick)) tricks.set(x.trick, []);
    tricks.get(x.trick).push(x);
  }
  for (const [, plays] of tricks) {
    if (plays.length < state.players) continue;
    const w = trickWinner(plays);
    taken[w] += plays.reduce((n, x) => n + (suitOf(x.face) === HEARTS ? 1 : x.face === QUEEN_SPADES ? 13 : 0), 0);
  }
  return taken;
}

// An opponent who has taken every point so far, enough of them to be going for the moon.
export function moonThreat(state, me) {
  const taken = pointsTaken(state);
  const total = taken.reduce((a, b) => a + b, 0);
  const holder = taken.findIndex((t) => t > 0);
  if (holder < 0 || holder === me || taken[holder] !== total) return -1;
  return taken[holder] >= 7 ? holder : -1;
}

// Could this hand take every point? Five hearts or more with the ace, and plenty of queens, kings and aces.
export function moonHand(faces) {
  const hearts = faces.filter((f) => suitOf(f) === HEARTS).map(power);
  const high = faces.filter((f) => power(f) >= 11).length;
  const spades = faces.filter((f) => suitOf(f) === SPADES).map(power);
  const queenSafe = !faces.includes(QUEEN_SPADES) || spades.some((r) => r > 11) || spades.length >= 4;
  return hearts.length >= 5 && hearts.includes(13) && hearts.filter((r) => r >= 11).length >= 2 && high >= 5 && queenSafe;
}

// Going for the moon: every point so far is mine, and a moon hand, or 10 points and the top cards.
function shootingMoon(state, me, know, taken) {
  if (taken.some((t, p) => p !== me && t > 0)) return false;
  const sure = know.mine.filter((f) => !know.out.some((x) => suitOf(x) === suitOf(f) && power(x) > power(f))).length;
  if (taken[me] >= 10 && sure >= know.mine.length - 1) return true;
  return (taken[me] > 0 || state.tricks < 2) && moonHand([...know.mine, ...state.played.filter((x) => x.p === me).map((x) => x.face)]);
}

// ---------- the pass ----------
function passEasy(state, me, rng) {
  const hand = state.hands[me].slice();
  const out = [];
  while (out.length < PASS_COUNT) out.push(hand.splice(Math.floor(rng() * hand.length), 1)[0]);
  return out;
}

// The danger of keeping a card: the queen and her guards, then high hearts, then high cards.
function danger(f, faces) {
  const s = suitOf(f);
  const r = power(f);
  const spades = faces.filter((x) => suitOf(x) === SPADES).length;
  if (f === QUEEN_SPADES) return spades >= 5 ? 20 : 100;
  if (s === SPADES && r > 11) return faces.includes(QUEEN_SPADES) && spades >= 5 ? 10 : 80 + r;
  if (s === HEARTS) return 30 + r * 3;
  return r * 2;
}

function passMedium(state, me, face) {
  const faces = state.hands[me].map(face);
  return state.hands[me].slice().sort((a, b) => danger(face(b), faces) - danger(face(a), faces)).slice(0, PASS_COUNT);
}

// Hard: dump danger, but also empty a short side suit to make a void; with a moon hand, pass low cards instead.
function passHard(state, me, face) {
  const hand = state.hands[me];
  const faces = hand.map(face);
  if (moonHand(faces)) return hand.slice().sort((a, b) => power(face(a)) - power(face(b)) + (suitOf(face(a)) === HEARTS) * 20 - (suitOf(face(b)) === HEARTS) * 20).slice(0, PASS_COUNT);
  const score = new Map(hand.map((s) => [s, danger(face(s), faces)]));
  // A side suit of one or two cards (not spades, which guard the queen): passing it makes a void.
  for (const suit of [CLUBS, DIAMONDS]) {
    const cards = hand.filter((s) => suitOf(face(s)) === suit);
    if (cards.length && cards.length <= 2 && !cards.some((s) => power(face(s)) <= 3)) for (const s of cards) score.set(s, score.get(s) + 45);
  }
  // Low spades protect the queen if it stays: keep them.
  if (faces.includes(QUEEN_SPADES)) for (const s of hand) if (suitOf(face(s)) === SPADES && power(face(s)) < 11) score.set(s, score.get(s) - 20);
  return hand.slice().sort((a, b) => score.get(b) - score.get(a)).slice(0, PASS_COUNT);
}

// ---------- a card to the trick ----------
// The card now winning the trick, and whether `f` would beat it.
const winning = (state) => state.trick.find((x) => x.p === trickWinner(state.trick));
const beats = (f, state) => suitOf(f) === suitOf(state.trick[0].face) && power(f) > power(winning(state).face);

function playMedium(state, me, legal, face) {
  if (!state.trick.length) return lowestOf(legal, face);
  const lead = suitOf(state.trick[0].face);
  const last = state.trick.length === state.players - 1;
  if (suitOf(face(legal[0])) === lead) {
    const under = legal.filter((s) => !beats(face(s), state));
    if (under.length) return highest(under, face);
    // Can't duck: last to play takes it with the highest; otherwise the lowest, hoping to be overtaken.
    return last ? highest(legal, face) : lowestOf(legal, face);
  }
  // Void: the queen first, then the highest heart, then the highest card.
  const queen = legal.find((s) => face(s) === QUEEN_SPADES);
  if (queen !== undefined) return queen;
  const hearts = legal.filter((s) => suitOf(face(s)) === HEARTS);
  return highest(hearts.length ? hearts : legal, face);
}

function playHard(state, me, legal, face, rng) {
  const know = knowledge(state, me, face);
  const threat = moonThreat(state, me);
  const shooting = shootingMoon(state, me, know, pointsTaken(state));
  const trick = state.trick;
  const pts = trick.reduce((n, x) => n + (isPoint(x.face) ? (x.face === QUEEN_SPADES ? 13 : 1) : 0), 0);
  // How many unseen cards of `suit` beat `f`, and whether someone still to play is void in it.
  const above = (f) => know.out.filter((x) => suitOf(x) === suitOf(f) && power(x) > power(f)).length;
  const toPlay = Array.from({ length: state.players - 1 - trick.length }, (_, i) => (me + 1 + i) % state.players);
  const voidLater = (suit) => toPlay.some((p) => know.voids[p].has(suit));

  if (shooting) {
    // Take every trick: lead from the top, and win whatever comes.
    if (!trick.length) return highest(legal, face);
    const win = legal.filter((s) => beats(face(s), state));
    if (win.length) return highest(win, face);
    return lowestOf(legal, face);
  }

  if (!trick.length) {
    // Stop a moon: lead a high heart to take one.
    if (threat >= 0) {
      const hearts = legal.filter((s) => suitOf(face(s)) === HEARTS);
      if (hearts.length) return highest(hearts, face);
    }
    // Lead where we can't win: a low card with plenty above it, in a suit nobody is void in.
    const score = (s) => {
      const f = face(s);
      let v = above(f) * 3 - power(f);
      if (know.voids.some((vs, p) => p !== me && vs.has(suitOf(f)))) v -= 25;
      if (suitOf(f) === SPADES) {
        const queenOut = know.out.includes(QUEEN_SPADES);
        // Flush the queen with low spades, but never lead the ace or king while she is out.
        if (queenOut && power(f) > 11) v -= 60;
        else if (queenOut && power(f) < 11) v += 8;
        if (f === QUEEN_SPADES) v -= 40;
      }
      if (suitOf(f) === HEARTS) v -= 6;
      return v + rng() * 0.01;
    };
    return legal.reduce((a, b) => (score(b) > score(a) ? b : a));
  }

  const lead = suitOf(trick[0].face);
  if (suitOf(face(legal[0])) === lead) {
    const win = legal.filter((s) => beats(face(s), state));
    const under = legal.filter((s) => !beats(face(s), state));
    // Stop a moon: take a trick with points in it from the shooter.
    if (threat >= 0 && pts > 0 && trickWinner(trick) === threat && win.length) return lowestOf(win, face);
    if (under.length) {
      // Duck as high as is safe; never keep the queen for later when a higher spade is down.
      const queen = under.find((s) => face(s) === QUEEN_SPADES);
      if (queen !== undefined) return queen;
      return highest(under, face);
    }
    const last = toPlay.length === 0;
    // Must win: last to play, with no points in it, take it with the highest; else the lowest of our winners.
    if (last) {
      const nonQueen = win.filter((s) => face(s) !== QUEEN_SPADES);
      return nonQueen.length ? highest(nonQueen, face) : highest(win, face);
    }
    if (lead === SPADES) {
      const safe = win.filter((s) => face(s) !== QUEEN_SPADES);
      if (safe.length) return pts === 0 && !voidLater(SPADES) && !know.out.includes(QUEEN_SPADES) ? highest(safe, face) : lowestOf(safe, face);
    }
    return pts === 0 && !voidLater(lead) ? highest(win, face) : lowestOf(win, face);
  }

  // Void in the suit led: dump, but not onto a moon shooter (which would only help them).
  const onShooter = threat >= 0 && trickWinner(trick) === threat;
  const queen = legal.find((s) => face(s) === QUEEN_SPADES);
  if (queen !== undefined && !onShooter) return queen;
  const hiSpades = legal.filter((s) => suitOf(face(s)) === SPADES && power(face(s)) > 11);
  if (hiSpades.length && know.out.includes(QUEEN_SPADES)) return highest(hiSpades, face);
  const hearts = legal.filter((s) => suitOf(face(s)) === HEARTS);
  if (hearts.length && !onShooter) return highest(hearts, face);
  // Otherwise the most dangerous card left: the highest of the suit with the most unseen cards under it.
  const nonPoint = legal.filter((s) => !isPoint(face(s)));
  const pool = onShooter && nonPoint.length ? nonPoint : legal;
  return pool.reduce((a, b) => (power(face(b)) - above(face(b)) > power(face(a)) - above(face(a)) ? b : a));
}

const LEVELS = {
  easy: { pass: (state, me, rng) => passEasy(state, me, rng), play: (state, me, legal, face, rng) => pickRandom(legal, rng) },
  medium: { pass: (state, me, rng, face) => passMedium(state, me, face), play: (state, me, legal, face) => playMedium(state, me, legal, face) },
  hard: { pass: (state, me, rng, face) => passHard(state, me, face), play: (state, me, legal, face, rng) => playHard(state, me, legal, face, rng) },
};

// The choice for `me` at a level; null when the move isn't a choice. face: the engine's, as cards.
export function chooseChoice(state, me, rng, face, level = "easy") {
  if (state.winner !== -1 || state.turn !== me) return null;
  const play = LEVELS[level] ?? LEVELS.easy;
  if (state.phase === "pass") return { pass: play.pass(state, me, rng, face) };
  if (state.phase === "play") {
    const legal = legalPlays(state, me, face);
    return legal.length ? { play: play.play(state, me, legal, face, rng) } : null;
  }
  return null;
}

// Returns a legal move for `me`: the forced one, else a choice. face is the engine's face().
export function chooseMove(state, me, rng, face, { level = "easy" } = {}) {
  const cards = cardsOf(state.players, face);
  return forcedMove(state, me, cards) ?? chooseChoice(state, me, rng, cards, level);
}

// The move the timer makes for you, and a robot's when its own is refused: what Hard would do.
export function timeoutMove(state, me, face) {
  return chooseMove(state, me, () => 0, face, { level: "hard" });
}

// A robot seat that pauses as the view asks: delay() returns ms, or -1 to wait for the screen.
export function startRobot(session, { rules, choose, delay, rng = Math.random }) {
  return startPacedRobot(session, { rules, choose, delay, rng, key: (st) => `${st.moves}`, fallback: timeoutMove });
}
