// Hearts rules for CardMatch (engine/card-match.js): four players and 13 cards
// each, or three with 17 (the 2 of diamonds left out). One match is a whole
// game: hand after hand until someone reaches the target, the deck shuffled
// again by every browser between hands. Each step is a move by whoever makes
// it, in phases pass (three cards, sealed to their seat with deck.pass()),
// find (the holder of the 2 of clubs leads it; the others say they haven't
// got it), play (one card to the trick) and result. A played card is shown,
// so the trick, the points and the moon are checked live; following suit and
// leading hearts are checked in the audit. See "Hearts in depth" in
// ARCHITECTURE.md.
import { RuleError } from "../engine/turn-match.js";
import { DECK, suitOf, rankOf } from "../engine/cards/faces.js";

export const SPADES = 0;
export const HEARTS = 1;
export const DIAMONDS = 2;
export const CLUBS = 3;
export const TWO_CLUBS = CLUBS * 13 + 1;
export const QUEEN_SPADES = SPADES * 13 + 11;
export const JACK_DIAMONDS = DIAMONDS * 13 + 10;
export const TWO_DIAMONDS = DIAMONDS * 13 + 1; // left out with three players
export const MOON = 26;
export const JACK_BONUS = -10;
export const PASS_COUNT = 3;

// Aces are high.
export const power = (f) => (rankOf(f) === 0 ? 13 : rankOf(f));
export const isPoint = (f) => suitOf(f) === HEARTS || f === QUEEN_SPADES;

export const TARGETS = [100, 50, 0]; // 0: one hand a game, the scores adding up across rematches
export const MOONS = ["others", "minus"];
export const MOVE_SECONDS = [0, 15, 30, 60];
export const LEVELS = ["easy", "medium", "hard"];
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 4;
// level and fourColor are per device; the rules ignore them.
export const DEFAULT_CONFIG = { target: 100, passing: true, moon: "others", jack: false, moveSeconds: 0, level: "easy", fourColor: false };

export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  return {
    target: pick(c.target, TARGETS, DEFAULT_CONFIG.target),
    passing: pick(c.passing, [true, false], DEFAULT_CONFIG.passing),
    moon: pick(c.moon, MOONS, DEFAULT_CONFIG.moon),
    jack: pick(c.jack, [true, false], DEFAULT_CONFIG.jack),
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    level: pick(c.level, LEVELS, DEFAULT_CONFIG.level),
    fourColor: pick(c.fourColor, [true, false], DEFAULT_CONFIG.fourColor),
  };
}

// The deck's faces: 52 with four players; with three, 51, the 2 of diamonds left out.
export const deckSize = (players) => (players === 3 ? DECK - 1 : DECK);
// A deck face as a card of the standard deck (engine/cards/faces.js).
export const cardFace = (players, f) => (f === null || players !== 3 || f < TWO_DIAMONDS ? f : f + 1);
// face(slot) as cards: what rules, views and robots read.
export const cardsOf = (players, face) => (slot) => cardFace(players, face(slot));

// The pass each hand, in turn: an offset round the table (left is the next seat).
export const PASS_CYCLE = { 4: ["left", "right", "across", "none"], 3: ["left", "right"] };
export const passOffset = (dir, players) => ({ left: 1, right: players - 1, across: 2, none: 0 })[dir];
export const passTo = (state, p) => (p + passOffset(state.dir, state.players)) % state.players;
export const handSize = (players) => (players === 3 ? 17 : 13);

// The legal cards for p now, from its own faces (face: cards, null if unknown).
export function legalPlays(state, p, face) {
  const hand = state.hands[p];
  if (state.phase === "find") return hand.filter((s) => face(s) === TWO_CLUBS);
  if (state.phase !== "play") return [];
  const faces = new Map(hand.map((s) => [s, face(s)]));
  if ([...faces.values()].some((f) => f === null)) return [];
  if (!state.trick.length) {
    const safe = hand.filter((s) => suitOf(faces.get(s)) !== HEARTS);
    return state.broken || !safe.length ? hand.slice() : safe;
  }
  const lead = suitOf(state.trick[0].face);
  const follow = hand.filter((s) => suitOf(faces.get(s)) === lead);
  if (follow.length) return follow;
  if (state.tricks === 0) {
    const clean = hand.filter((s) => !isPoint(faces.get(s)));
    if (clean.length) return clean;
  }
  return hand.slice();
}

// The move nobody chooses: the 2 of clubs lead (or saying you haven't got it),
// your only legal card, and the next hand. null for a real choice.
export function forcedMove(state, me, face) {
  if (state.winner !== -1 || state.turn !== me) return null;
  if (state.phase === "result") return { next: true };
  if (state.phase === "find") {
    if (state.hands[me].some((s) => face(s) === null)) return null;
    const two = legalPlays(state, me, face);
    return two.length ? { play: two[0] } : { none: true };
  }
  if (state.phase === "play") {
    const legal = legalPlays(state, me, face);
    return legal.length === 1 ? { play: legal[0] } : null;
  }
  return null;
}

// Who takes a trick: the highest card of the suit led.
export function trickWinner(trick) {
  const lead = suitOf(trick[0].face);
  return trick.reduce((best, x) => (suitOf(x.face) === lead && power(x.face) > power(best.face) ? x : best)).p;
}

// A trick's points: a heart 1, the queen of spades 13, the jack of diamonds -10 if on.
export const cardPoints = (f, jack) => (suitOf(f) === HEARTS ? 1 : f === QUEEN_SPADES ? 13 : jack && f === JACK_DIAMONDS ? JACK_BONUS : 0);

// The seats with the lowest score.
export const lowest = (scores) => scores.flatMap((s, p) => (s === Math.min(...scores) ? [p] : []));

export function makeRules(config = DEFAULT_CONFIG, players = 4) {
  const c = normalizeConfig(config);
  const n = players;
  const card = (deck, slot) => cardFace(n, deck.face(slot));
  const isSlots = (v, count) => Array.isArray(v) && v.length === count && v.every(Number.isInteger) && new Set(v).size === count;

  // Deals `slots` round the table from the opener, one card at a time.
  function deal(state, deck, slots) {
    state.cards = slots.slice();
    state.hands = Array.from({ length: n }, () => []);
    const size = handSize(n);
    for (let r = 0; r < size; r++) {
      for (let k = 0; k < n; k++) {
        const p = (state.opener + k) % n;
        const slot = slots[r * n + k];
        deck.deal(slot, p);
        state.hands[p].push(slot);
      }
    }
    const cycle = PASS_CYCLE[n];
    state.dir = c.passing ? cycle[(state.hand - 1) % cycle.length] : "none";
    Object.assign(state, { picks: Array(n).fill(null), received: Array.from({ length: n }, () => []), asked: [], trick: [], tricks: 0, won: Array.from({ length: n }, () => []), points: Array(n).fill(0), broken: false, played: [], result: null });
    state.phase = state.dir === "none" ? "find" : "pass";
    state.turn = state.opener;
  }

  function pass(state, p, move, deck, events) {
    const hand = state.hands[p];
    if (!isSlots(move.pass, PASS_COUNT) || !move.pass.every((s) => hand.includes(s))) throw new RuleError(`pass ${PASS_COUNT} cards from your hand`);
    state.picks[p] = move.pass.slice();
    events.push({ type: "pick", p, slots: move.pass.slice() });
    if (state.picks.some((x) => x === null)) {
      state.turn = (p + 1) % n;
      return;
    }
    // Everyone has picked: the cards change hands, sealed to their new holder.
    for (let q = 0; q < n; q++) {
      const to = passTo(state, q);
      for (const slot of state.picks[q]) deck.pass(slot, to);
      state.received[to] = state.picks[q].slice();
    }
    state.hands = state.hands.map((h, q) => [...h.filter((s) => !state.picks[q].includes(s)), ...state.received[q]]);
    events.push({ type: "passed", dir: state.dir, picks: state.picks.map((x) => x.slice()) });
    state.phase = "find";
    state.turn = state.opener;
  }

  // The first trick: the 2 of clubs, from whoever holds it.
  function find(state, p, move, deck, events) {
    if (move.none === true) {
      // Hidden during play, checked in the audit.
      if (state.hands[p].some((s) => card(deck, s) === TWO_CLUBS)) throw new RuleError("said they didn't have the 2 of clubs");
      state.asked.push(p);
      events.push({ type: "none", p });
      if (state.asked.length === n) {
        // Someone lied: the game stops here, and the audit names them.
        state.phase = "over";
        state.winner = -2;
        state.winners = [];
        events.push({ type: "lost" });
        return;
      }
      state.turn = (p + 1) % n;
      return;
    }
    if (card(deck, move.play) !== TWO_CLUBS) throw new RuleError("the 2 of clubs leads the first trick");
    state.phase = "play";
    play(state, p, move, deck, events);
  }

  function play(state, p, move, deck, events) {
    const hand = state.hands[p];
    const slot = move.play;
    if (!hand.includes(slot)) throw new RuleError("play a card from your hand");
    const f = card(deck, slot);
    // The rest of the hand is hidden during play: these throw only in the audit.
    const rest = hand.filter((s) => s !== slot).map((s) => card(deck, s)).filter((x) => x !== null);
    if (!state.trick.length) {
      if (suitOf(f) === HEARTS && !state.broken && rest.some((x) => suitOf(x) !== HEARTS)) throw new RuleError("led a heart before hearts were broken");
    } else {
      const lead = suitOf(state.trick[0].face);
      if (suitOf(f) !== lead && rest.some((x) => suitOf(x) === lead)) throw new RuleError("didn't follow suit");
      if (state.tricks === 0 && isPoint(f) && rest.some((x) => !isPoint(x))) throw new RuleError("played a point card on the first trick");
    }
    state.hands[p] = hand.filter((s) => s !== slot);
    state.received[p] = state.received[p].filter((s) => s !== slot);
    state.trick.push({ p, slot, face: f });
    state.played.push({ p, face: f, trick: state.tricks, lead: state.trick.length === 1 });
    events.push({ type: "play", p, slot, face: f, lead: state.trick.length === 1 });
    if (!state.broken && isPoint(f)) {
      state.broken = true;
      events.push({ type: "broken", p, face: f });
    }
    if (state.trick.length < n) {
      state.turn = (p + 1) % n;
      return;
    }
    const winner = trickWinner(state.trick);
    const pts = state.trick.reduce((sum, x) => sum + cardPoints(x.face, c.jack), 0);
    state.won[winner].push(...state.trick.map((x) => x.slot));
    state.points[winner] += pts;
    events.push({ type: "trick", winner, plays: state.trick.map((x) => ({ ...x })), points: pts, n: state.tricks + 1 });
    state.trick = [];
    state.tricks++;
    state.turn = winner;
    if (state.hands.every((h) => !h.length)) endHand(state, deck, events);
  }

  function endHand(state, deck, events) {
    // Every point card was played face up, so this is all known.
    const taken = state.won.map((slots) => slots.map((s) => card(deck, s)));
    const raw = taken.map((fs) => fs.filter((f) => suitOf(f) === HEARTS).length + (fs.includes(QUEEN_SPADES) ? 13 : 0));
    const moon = raw.indexOf(MOON);
    let add = raw.slice();
    if (moon >= 0) add = raw.map((_, p) => (c.moon === "others" ? (p === moon ? 0 : MOON) : p === moon ? -MOON : 0));
    const jackBy = c.jack ? taken.findIndex((fs) => fs.includes(JACK_DIAMONDS)) : -1;
    if (jackBy >= 0) add[jackBy] += JACK_BONUS;
    state.scores = state.scores.map((s, p) => s + add[p]);
    state.result = { raw, add, moon, jack: jackBy };
    state.history.push({ hand: state.hand, dir: state.dir, raw, add, moon, jack: jackBy });
    events.push({ type: "score", hand: state.hand, raw, add, moon, jack: jackBy, scores: state.scores.slice() });
    const low = lowest(state.scores);
    // A game to a target ends when someone reaches it, unless the lowest is a tie: then play on.
    if (c.target === 0 || (Math.max(...state.scores) >= c.target && low.length === 1)) {
      state.phase = "over";
      state.winners = low;
      state.winner = low.length === 1 ? low[0] : -2;
      events.push({ type: "over", winners: low, scores: state.scores.slice() });
      return;
    }
    state.phase = "result";
  }

  function next(state, deck, events) {
    const slots = deck.shuffle(state.cards);
    state.hand++;
    state.opener = (state.opener + 1) % n;
    events.push({ type: "gather", hand: state.hand });
    deal(state, deck, slots);
    events.push({ type: "deal", hand: state.hand, dir: state.dir, opener: state.opener, hands: state.hands.map((h) => h.slice()) });
  }

  return {
    deckSize: deckSize(n),

    newState(first, players, deck) {
      if (players !== n) throw new RuleError(`these rules are for ${n} players`);
      const state = {
        turn: first,
        winner: -1, // a seat, or -2: a shared win (winners) or a lost 2 of clubs
        winners: [],
        players: n,
        target: c.target,
        moonRule: c.moon,
        jack: c.jack,
        passing: c.passing,
        first,
        hand: 1,
        opener: first, // passes first and is asked first for the 2 of clubs; moves on a seat each hand
        phase: "pass",
        dir: "left",
        cards: [], // this hand's slots
        hands: [],
        picks: [], // each seat's three cards to pass, once picked (slots are public, faces aren't)
        received: [], // the cards passed to each seat this hand, still in its hand
        asked: [], // who said they haven't got the 2 of clubs
        trick: [], // [{ p, slot, face }] in order
        tricks: 0, // tricks done this hand
        won: [], // the cards each seat took this hand
        points: [], // this hand's points by seat, as the tricks are taken
        broken: false, // a heart or the queen of spades has been played
        played: [], // public: [{ p, face, trick, lead }] this hand, for the robots
        result: null, // { raw, add, moon, jack } once a hand ends
        scores: Array(n).fill(0),
        history: [], // a row a hand: { hand, dir, raw, add, moon, jack }
        moves: 0,
      };
      deal(state, deck, deck.cards);
      return state;
    },

    reveals: (state, player, move) => (Number.isInteger(move?.play) && move.none !== true && (state.phase === "play" || state.phase === "find") ? [move.play] : []),

    applyMove(state, player, move, deck) {
      if (state.winner !== -1) throw new RuleError("the game is over");
      if (state.turn !== player) throw new RuleError("not your turn");
      if (!move || typeof move !== "object") throw new RuleError("bad move");
      const events = [];
      const ph = state.phase;
      if (ph === "pass" && move.pass !== undefined) pass(state, player, move, deck, events);
      else if (ph === "find" && (move.none === true || Number.isInteger(move.play))) find(state, player, move, deck, events);
      else if (ph === "play" && Number.isInteger(move.play)) play(state, player, move, deck, events);
      else if (ph === "result" && move.next === true) next(state, deck, events);
      else throw new RuleError(`that move doesn't fit now (${ph})`);
      state.moves++;
      return events;
    },
  };
}
