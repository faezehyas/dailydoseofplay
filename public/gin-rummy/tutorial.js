// Gin Rummy's tutorial: its lessons (lessons.js) on the game's own table,
// hand and buttons (engine/cards/table.js, art.js, style.css), moving and
// sounding as in the game (sounds.js), every move checked by rules.js. The
// hands are fixed and every card is known (engine/cards/lesson-deck.js), so
// no shuffle runs. The adapter engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { RuleError } from "../engine/turn-match.js";
import { cardTable } from "../engine/cards/table.js";
import { DECK } from "../engine/cards/faces.js";
import { card, cards, lessonDeck, lessonMove } from "../engine/cards/lesson-deck.js";
import { makeRules, DEFAULT_CONFIG, KNOCK_LIMIT, forcedMove, bestKnock } from "./rules.js";
import { AUTO, PACE, tilt, viewOf, knockable, moveInHand, ginTable } from "./art.js";
import { play as sound } from "./sounds.js";

export { lessons } from "./lessons.js";
export const flavour = "paper";

const rules = makeRules(DEFAULT_CONFIG);
const face = (slot) => slot;

// A position is { hands, pile, stock } (see lessons.js); teal dealt, and you are player 0, to draw.
export function load({ hands, pile, stock = [] }) {
  const state = rules.newState(1, 2, lessonDeck());
  const held = new Set(cards([...hands.flat(), ...pile, ...stock]));
  Object.assign(state, {
    hands: hands.map(cards),
    discard: cards(pile),
    upcard: card(pile[0]),
    stock: [...cards(stock), ...[...Array(DECK).keys()].filter((f) => !held.has(f))],
    limit: KNOCK_LIMIT,
    phase: "draw",
    turn: 0,
  });
  return state;
}

// Refusals the game words its own way.
const WORDS = [
  [/^That move doesn't fit now \(draw\)$/, "Draw a card first: tap the stock or the pile"],
  [/^That move doesn't fit now \(discard\)$/, "You have drawn: now discard a card"],
  [/^You can't discard the card you just took from the pile$/, "You can't throw back the card you just took from the pile"],
  [/^You can knock with (\d+) points of deadwood at most.*$/, "You need $1 points of deadwood or less to knock"],
];

// A move for the side to move; your own lay-down after a knock follows by itself, as in the game.
export function play(state, move) {
  let events;
  try {
    events = lessonMove(rules, state, move);
  } catch (err) {
    if (!(err instanceof RuleError)) throw err;
    throw new RuleError(WORDS.reduce((text, [from, to]) => text.replace(from, to), err.message));
  }
  let forced;
  while (state.turn === 0 && (forced = forcedMove(state, 0, face))) events.push(...lessonMove(rules, state, forced));
  return events;
}
export const cells = (move) => (move.draw ? [move.draw] : move.knock ? ["knock", "pile"] : [move.discard, "pile"]);
// The melds the learner laid down on a knock or gin ("spread:<slot>") light
// up, as at the game's win.
export const result = (state, played = []) => played.filter((e) => e.type === "lay" && e.p === 0).flatMap((e) => e.melds.flat().map((s) => `spread:${s}`));

// As in the game: tap the stock or the pile (or Take, Draw); tap a card to
// pick it and again to discard it; Knock knocks with the best throw. D, T
// and K work too, and the hand rearranges by dragging or Shift and an arrow.
// Every card flies and sounds as it does in the game.
export function board() {
  const table = cardTable({ prefix: "gr", play: sound });
  const { fly, live, wait, rectIn, handCards } = table;
  let state = null;
  let view = null; // the table as drawn (art.js's viewOf)
  let moving = false;
  let current = null; // the event being shown
  let selected = null; // the card picked to discard
  let order = [];
  let sortMode = "rank";
  let shown = null; // the hand as grouped on screen
  let moveFn = () => {};

  const gin = ginTable(table, {
    me: 0,
    names: ["You", "Teal"],
    myName: "You",
    face,
    view: () => view,
    render: () => draw(),
    on: { draw: () => send({ draw: "stock" }), take: () => send({ draw: "pile" }), pass: () => {}, discard: () => selected !== null && send({ discard: selected }), knock: () => knock(), next: () => {}, sort: (mode) => sortBy(mode) },
  });
  const hint = el("p", { class: table.cls("hint"), id: "gr-hint" }, "Keys: D draw, T take, K knock; Shift + arrows move a card.");
  const node = el(
    "div",
    { class: "gin-rummy pc-game", dataset: { you: "a", seat: 0 } },
    table.symbolHost,
    el("div", { class: table.cls("main") }, gin.tableWrap, el("div", { class: table.cls("side") }, el("div", { class: table.cls("actions") }, hint))),
  );

  // Your real choice now: "draw", "discard" or null.
  const choice = () => (state && !moving && state.turn === 0 && ["draw", "discard"].includes(state.phase) ? state.phase : null);
  const send = (move) => choice() && moveFn(move);
  table.onPick((slot) => {
    const c = choice();
    if (!c) return;
    if (c === "draw" || slot === state.taken || slot === selected) return send({ discard: slot });
    selected = slot;
    sound("deal", { offset: -4 });
    draw();
  });
  function knock() {
    if (choice() !== "discard") return send({ knock: true });
    const kn = knockable(state, 0, face, selected);
    send({ discard: kn ? kn.slot : bestKnock(state, 0, face).discard, knock: true });
  }
  function sortBy(mode) {
    sortMode = mode;
    sound("deal", { offset: -4 });
    draw();
  }
  table.onMove((slot, to, by) => {
    order = moveInHand(shown, slot, to, by);
    sortMode = null;
    draw();
  });
  // D draws, T takes the pile, K knocks while the table has focus; Escape drops the picked card.
  node.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const key = e.key.toLowerCase();
    if (e.key === "Escape" && selected !== null) {
      selected = null;
      draw();
    } else if (key === "d") send({ draw: "stock" });
    else if (key === "t") send({ draw: "pile" });
    else if (key === "k") knock();
  });

  function draw() {
    const c = choice();
    gin.drawSeat();
    gin.drawCentre({ choice: c, knockRule: "classic" });
    if (view.laid[0]) gin.drawHand(null);
    else {
      shown = gin.handGroups(order, sortMode);
      order = shown.order;
      if (selected !== null && (c !== "discard" || !shown.slots.includes(selected) || selected === state.taken)) selected = null;
      gin.drawHand(shown, { choosing: c === "discard", taken: state.taken, selected, after: c === "discard" ? bestKnock(state, 0, face) : null, sortMode });
    }
    gin.drawActions(c, { top: state.discard.at(-1) ?? null, selected, kn: c === "discard" ? knockable(state, 0, face, selected) : null });
    const turn = current?.p ?? (moving || state.phase === "result" ? -1 : state.turn);
    gin.seat.node.classList.toggle("active", turn === 1);
    gin.meArea.classList.toggle("active", turn === 0);
    gin.tableBox.classList.toggle("laid", view.laid.some(Boolean));
  }
  new ResizeObserver(() => view && draw()).observe(gin.tableBox);

  // The game's motion for each event (main.js's animate()), without its log.
  async function animate(ev, g) {
    const k = table.pace();
    current = ev;
    if (ev.type === "take") {
      const from = gin.pileRect();
      view.discard = view.discard.filter((s) => s !== ev.slot);
      view.took.add(ev.slot);
      view.hands[ev.p].push(ev.slot);
      view.arriving.add(ev.slot);
      draw();
      sound("draw");
      await fly(face(ev.slot), from, gin.seatRect(ev.p, ev.slot), { ms: PACE.take * k, g });
      view.arriving.delete(ev.slot);
      if (!live(g)) return;
      draw();
    } else if (ev.type === "draw") {
      await gin.dealTo(ev.p, ev.slot, g, PACE.draw * k, "draw");
    } else if (ev.type === "discard") {
      const from = gin.seatRect(ev.p, ev.slot);
      const wasDown = ev.p !== 0 && gin.seat.cards.get(ev.slot)?.classList.contains("down");
      view.hands[ev.p] = view.hands[ev.p].filter((s) => s !== ev.slot);
      view.discard.push(ev.slot);
      view.arriving.add(ev.slot);
      if (ev.p === 0) selected = null;
      draw();
      sound("play");
      await fly(face(ev.slot), from, gin.pileRect(), { ms: PACE.discard * k, turn: wasDown ? "up" : null, spin: tilt(ev.slot), g });
      view.arriving.delete(ev.slot);
      if (!live(g)) return;
      draw();
    } else if (ev.type === "knock") {
      view.knock = { p: ev.p, gin: ev.gin };
      draw();
      sound("knock");
      gin.thump(g);
      gin.moment(ev.gin ? "Gin!" : "Knock!", ev.p, ev.gin ? "gin" : "knock", g);
      if (ev.gin) {
        sound("gin", {}, 0.25);
        gin.sparkle(rectIn(gin.tableBox), ev.p, g, 18);
      }
      await wait(PACE.moment * k, g);
    } else if (ev.type === "lay") {
      // Your browser lays your hand down after a short beat.
      await wait(AUTO.lay, g);
      await gin.layDown(ev.p, ev.melds, ev.deadwood, g, k);
      if (!live(g)) return;
      await gin.countUp(gin.deadNum, ev.points, g, String);
      view.tally[ev.p] = ev.points;
      draw();
    } else if (ev.type === "defend") {
      await gin.layDown(ev.p, ev.melds, [...ev.deadwood, ...ev.layoffs.map(([s]) => s)], g, k);
      if (!live(g) || !(await gin.layOffs(ev.p, ev.layoffs, g, k))) return;
      await gin.countUp(gin.oppTally, ev.points, g, (n) => `Deadwood ${n}`);
      view.tally[ev.p] = ev.points;
      draw();
    } else if (ev.type === "score") {
      if (!(await gin.scoreHand(ev, g, k, (s) => `You ${s[0]} · Teal ${s[1]} · to ${DEFAULT_CONFIG.target}`))) return;
      await wait(PACE.bubble * k, g);
    }
    current = null;
    await wait(PACE.between * k, g);
  }

  const cell = (c) => (String(c).startsWith("spread:") ? gin.mySpread.cards.get(Number(c.slice(7))) : ({ stock: gin.stockBtn, pile: gin.pile, knock: gin.knockBtn, deadwood: gin.deadChip })[c] ?? handCards.get(c) ?? gin.pile);

  return {
    node,
    cell,
    onMove: (fn) => (moveFn = fn),
    async render(st, played) {
      state = st;
      if (!played) {
        table.stop();
        moving = false;
        current = null;
        selected = null;
        view = viewOf(st);
        gin.forgetMelds();
        return draw();
      }
      const g = table.gen;
      moving = true;
      for (const ev of played) await animate(ev, g);
      if (!live(g)) return;
      moving = false;
      view = viewOf(st);
      draw();
    },
    reject(move) {
      sound("nope");
      table.shake(move.knock ? gin.deadChip : move.draw ? cell(move.draw) : handCards.get(move.discard)?.firstChild);
    },
  };
}
