// Hearts' tutorial: its lessons (lessons.js) on the game's own table, seats,
// trick and pass (engine/cards/table.js, art.js, style.css), moving and
// sounding as in the game (sounds.js), every move checked by rules.js. The
// hands are fixed and every card is known (engine/cards/lesson-deck.js), so
// no shuffle runs. The adapter engine/tutorial.js asks for.
import { el, toast } from "../engine/shell.js";
import { RuleError } from "../engine/turn-match.js";
import { cardTable } from "../engine/cards/table.js";
import { DECK } from "../engine/cards/faces.js";
import { card, cards, lessonDeck, lessonMove } from "../engine/cards/lesson-deck.js";
import { makeRules, DEFAULT_CONFIG, forcedMove, legalPlays, passTo, isPoint, cardPoints, QUEEN_SPADES, PASS_COUNT } from "./rules.js";
import { PACE, handOrder, tableView, whyNot, heartsTable } from "./art.js";
import { play as sound } from "./sounds.js";

export { lessons } from "./lessons.js";
export const flavour = "bell";

const NAMES = ["You", "Teal", "Violet", "Amber"];
const rules = makeRules(DEFAULT_CONFIG, NAMES.length);
const known = (slot) => slot;
const nameOf = (p) => NAMES[p];
const byHand = (a, b) => handOrder(a, a) - handOrder(b, b);

// A position (see lessons.js): you are seat 0, and it's your move.
export function load({ pass, hands, lead = 0, trick = [], tricks = [0, 0, 0, 0], taken = [[], [], [], []] }) {
  const state = rules.newState(0, NAMES.length, lessonDeck());
  state.hands = hands.map(cards);
  if (pass) return Object.assign(state, { dir: pass });
  // The tricks won so far: their point cards, and the cards nobody holds for the rest.
  const placed = new Set(cards([...hands.flat(), ...taken.flat()]));
  const spare = [...Array(DECK).keys()].filter((f) => !placed.has(f) && !isPoint(f));
  const won = taken.map((names, p) => [...cards(names), ...spare.splice(0, 4 * tricks[p] - names.length)]);
  Object.assign(state, {
    phase: "play",
    turn: lead,
    tricks: tricks.reduce((a, b) => a + b),
    won,
    points: won.map((w) => w.reduce((n, f) => n + cardPoints(f, false), 0)),
    broken: won.flat().some(isPoint),
  });
  for (const name of trick) lessonMove(rules, state, { play: card(name) });
  return state;
}

// A reply is a list of moves, each for whoever is to move then. A card that
// can't be played is refused in the game's words.
export function play(state, move) {
  if (Array.isArray(move)) return move.flatMap((m) => play(state, m));
  const p = state.turn;
  if (state.phase === "play" && state.hands[p].includes(move.play) && !legalPlays(state, p, known).includes(move.play)) throw new RuleError(whyNot(state, p, move.play, known));
  return lessonMove(rules, state, move);
}
export const cells = (move) => (move.pass ? [...move.pass, "pass"] : [move.play, "trick"]);
// A trick the learner took lights their pile of won tricks, as at the game's win.
export const result = (state, played = []) => (played.some((e) => e.type === "trick" && e.winner === 0) ? ["won"] : []);

// As in the game: tap three cards and Pass (or P; Esc puts them back), tap a
// card to play it, or the arrow keys and Enter. Every card flies and sounds
// as it does in the game.
export function board() {
  const table = cardTable({ prefix: "hr", play: sound });
  const { live, wait, handCards } = table;
  const parts = heartsTable(table, { me: 0, names: NAMES, myName: "You", onPass: () => passNow() });
  const node = el("div", { class: "hearts pc-game", dataset: { you: "a", seat: 0 } }, table.symbolHost, el("div", { class: table.cls("main") }, parts.tableWrap));
  let state = null;
  let view = null; // the table as drawn (art.js's tableView)
  let moving = false; // a move is being played out
  let current = null; // the event being played out
  let picked = []; // the cards you picked to pass
  let moveFn = () => {};

  const picking = () => !moving && state.phase === "pass" && !state.picks[0];
  const mine = () => !moving && state.turn === 0 && state.winner === -1;
  table.onPick((slot) => {
    if (picking()) return togglePick(slot);
    if (mine()) moveFn({ play: slot });
  });

  function togglePick(slot) {
    if (picked.includes(slot)) picked = picked.filter((s) => s !== slot);
    else if (picked.length < PASS_COUNT) picked = [...picked, slot];
    else {
      sound("nope");
      return toast("You've picked three: tap one to put it back");
    }
    sound("deal", { offset: -4 });
    draw();
  }
  function passNow() {
    if (picking() && picked.length === PASS_COUNT) moveFn({ pass: picked.slice().sort(byHand) });
  }
  // P passes the three you picked; Escape puts them back.
  node.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === "Escape" && picking() && picked.length) {
      picked = [];
      draw();
    } else if (e.key.toLowerCase() === "p") passNow();
  });

  const face = (slot) => (view.arriving.has(slot) || view.flipping.has(slot) ? null : slot);
  function draw() {
    const choice = mine() && state.phase === "play" && !forcedMove(state, 0, known) ? "play" : null;
    const legal = new Set(choice ? legalPlays(state, 0, known) : []);
    const slots = view.hands[0].slice().sort((a, b) => handOrder(a, face(a)) - handOrder(b, face(b)));
    const pass = picking();
    parts.drawHand(slots, { face, arriving: view.arriving, choice, legal, pass, sent: new Set(state.picks[0] ?? []), picked, received: new Set(view.received) });
    parts.drawSeats(view, state.phase === "pass");
    parts.drawCentre(view, { face, nameOf, to: state.phase === "pass" ? passTo(state, 0) : null });
    const note = picked.length === PASS_COUNT ? `to ${nameOf(passTo(state, 0))}` : `${picked.length} of 3 picked`;
    parts.drawActions({ dir: pass ? state.dir : null, note, ready: picked.length === PASS_COUNT, choice, received: view.received.length });
    const shownTurn = current?.p ?? (state.phase !== "pass" ? state.turn : undefined);
    for (const o of parts.opps) o.node.classList.toggle("active", shownTurn === o.p);
    parts.meArea.classList.toggle("active", shownTurn === 0 || pass);
  }

  // The game's motion for each event (main.js's animate()).
  async function animate(ev, g) {
    const k = table.pace();
    current = ev;
    if (ev.type === "pick") {
      view.picks[ev.p] = true;
      if (ev.p !== 0) parts.say(ev.p, "Picked", g);
      draw();
    } else if (ev.type === "passed") {
      const to = (q) => passTo({ dir: ev.dir, players: NAMES.length }, q);
      picked = [];
      await parts.passCards(view, ev, { to, from: parts.around.find((q) => to(q) === 0), face: known, g, k, render: draw });
    } else if (ev.type === "play") {
      await parts.cardToTrick(view, ev, { g, k, render: draw });
      if (ev.face === QUEEN_SPADES) await wait(PACE.look * k, g);
    } else if (ev.type === "broken") {
      view.broken = true;
      draw();
      parts.heartsBreak(g);
    } else if (ev.type === "trick") {
      await parts.takeTrick(view, ev, { face: known, g, k, render: draw });
    } else if (ev.type === "score") {
      await parts.tallyUp(view, ev, { nameOf, scoreOf: (p) => view.scores[p], seats: parts.around, g, k, render: draw });
      await wait(PACE.bubble * k, g);
    }
    current = null;
    await wait(PACE.between * k, g);
  }

  return {
    node,
    cell: (c) => (c === "trick" ? parts.trick.spots.get(0) : c === "won" ? parts.myWon.node : c === "pass" ? (parts.passBtn.hidden ? parts.actionBar : parts.passBtn) : (handCards.get(c) ?? table.hand)),
    onMove: (fn) => (moveFn = fn),
    async render(st, played) {
      if (st !== state) picked = [];
      state = st;
      if (!played) {
        table.stop();
        moving = false;
        current = null;
        parts.tally.hidden = true;
        view = tableView(st, 0, known);
        return draw();
      }
      const g = table.gen;
      moving = true;
      for (const ev of played) await animate(ev, g);
      if (!live(g)) return;
      moving = false;
      view = tableView(st, 0, known);
      draw();
      if (mine() && st.phase === "play" && !forcedMove(st, 0, known)) sound("turn");
    },
    // As in the game, with the refused cards shaking.
    reject(move) {
      sound("nope");
      for (const slot of move.pass ?? [move.play]) table.shake(handCards.get(slot)?.firstChild);
    },
  };
}
