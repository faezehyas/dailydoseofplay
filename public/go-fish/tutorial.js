// Go Fish's tutorial: its lessons (lessons.js) on the game's own table, pond,
// books and ask (engine/cards/table.js, art.js, style.css), moving and
// sounding as in the game (sounds.js), every move checked by rules.js. The
// hands are fixed and every card is known (engine/cards/lesson-deck.js), so
// no shuffle runs. The adapter engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { RuleError } from "../engine/turn-match.js";
import { cardTable } from "../engine/cards/table.js";
import { DECK } from "../engine/cards/faces.js";
import { card, cards, lessonDeck, lessonMove } from "../engine/cards/lesson-deck.js";
import { makeRules, DEFAULT_CONFIG, forcedMove, askable, ranksIn, rankOf, rankWords, totalBooks } from "./rules.js";
import { ROBOT_PACE, AUTO, PACE, giveWords, fishWords, cardsOf, askSeat, drawSeat, drawBooks, drawHand, drawAsk, tableMotion } from "./art.js";
import { play as sound } from "./sounds.js";

export { lessons } from "./lessons.js";
export const flavour = "water";

const rules = makeRules(DEFAULT_CONFIG);
const known = (slot) => slot;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A position is { hands, books, stock } (see lessons.js); you are player 0, to ask.
export function load({ hands, books = [[], []], stock = [] }) {
  const state = rules.newState(0, hands.length, lessonDeck());
  const laid = books.map((ranks) => ranks.map((r) => ({ rank: rankOf(card(`${r}S`)), slots: cards([..."SHDC"].map((s) => r + s)) })));
  const held = new Set([...cards(hands.flat()), ...laid.flat().flatMap((b) => b.slots), ...cards(stock)]);
  Object.assign(state, {
    hands: hands.map(cards),
    books: laid,
    stock: [...cards(stock), ...[...Array(DECK).keys()].filter((f) => !held.has(f))],
    phase: "ask",
    opened: hands.length,
  });
  return state;
}

// Plays a move, or a reply's list of Teal's moves, then every move nobody
// chooses, as each browser does in the game, up to the next ask or Teal's answer.
export function play(state, move) {
  const events = [];
  for (const m of [].concat(move)) {
    if (m.ask === null) throw new RuleError("Pick a card first: you ask for its rank");
    events.push(...lessonMove(rules, state, m));
    for (let f; (f = forcedMove(state, state.turn, known)) && !(state.phase === "answer" && state.turn === 1); ) events.push(...lessonMove(rules, state, f));
  }
  return events;
}
export const cells = (move) => ["ask", rankWords(move.ask)];
// A book the learner laid ("book:<slot>") lights up, as at the game's win.
export const result = (state, played = []) => played.filter((e) => e.type === "book" && e.p === 0).map((e) => `book:${e.slots[0]}`);

// The pause before a move nobody taps: Teal's as the robot's, yours as your browser's.
const beat = (ev) => (ev.p === 0 ? { give: AUTO.answer, fish: AUTO.answer, book: AUTO.book, lucky: AUTO.show, pass: AUTO.done } : { ask: ROBOT_PACE.ask, give: ROBOT_PACE.answer, fish: ROBOT_PACE.answer, book: ROBOT_PACE.book, pass: ROBOT_PACE.done })[ev.type] ?? 0;

// As in the game: tap a card to pick its rank (Teal is the only one to ask),
// then Ask; the arrow keys and Enter, A and Escape work too. Every card flies
// and sounds as it does in the game.
export function board() {
  const table = cardTable({ prefix: "gf", play: sound });
  const { wait, rectIn, hand, handCards } = table;
  let state = null;
  let view = null; // the table as drawn: { hands, stock, books, arriving }
  let moving = false;
  let current = null; // the event being played out
  let shownAsk = null; // the ask on screen, until it is answered
  let selRank = null;
  let turns = 0; // the turns already cued with the turn sound
  let moveFn = () => {};

  const teal = askSeat(table, { p: 1, name: "Teal", pos: "top", onPick: pickSeat });
  const pondCount = el("span", { class: "gf-pond-label" }, "The pond");
  const stock = table.makeStock({ label: (left) => (left ? `The pond: ${plural(left, "card")} to fish from` : "The pond is empty") });
  const ripples = el("span", { class: "gf-ripples", "aria-hidden": "true" }, el("span"), el("span"));
  const pond = el("div", { class: "gf-pond", id: "gf-pond" }, ripples, el("div", { class: table.cls("stack") }, stock, table.riffle), pondCount);
  const myBooks = el("div", { class: "gf-books mine", "aria-hidden": "true" });
  const askBtn = el("button", { class: "btn primary gf-ask", type: "button", id: "gf-ask", disabled: true, onclick: () => askNow() }, "Ask");
  const askBar = el("div", { class: "gf-ask-bar" }, askBtn);
  const myCount = el("span", { class: "count mono" }, "0");
  const myBooksCount = el("span", { class: "gf-book-count mono" });
  const handHint = el("p", { class: table.cls("hand-hint"), id: "gf-hand-hint" });
  const meArea = el("div", { class: table.cls("me", "p-0") }, myBooks, askBar, hand, el("span", { class: "pill" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "name" }, "You"), myCount, myBooksCount), handHint);
  const tableBox = el("div", { class: table.cls("table"), id: "gf-table" }, el("div", { class: table.cls("opps") }, teal.node), el("div", { class: "gf-centre" }, pond), meArea);
  const hint = el("p", { class: table.cls("hint"), id: "gf-hint" });
  const node = el(
    "div",
    { class: "go-fish pc-game", dataset: { you: "a", seat: 0 } },
    table.symbolHost,
    el("div", { class: table.cls("main") }, el("div", { class: table.cls("table-wrap") }, tableBox, table.flyLayer), el("div", { class: table.cls("side") }, el("div", { class: table.cls("actions") }, hint))),
  );

  const seatRect = (p, slot) => (p === 1 ? teal.rect(slot) : handCards.get(slot) ? rectIn(handCards.get(slot).firstChild) : rectIn(hand));
  const booksBox = (p) => (p === 0 ? myBooks : teal.books);
  const sayHost = (p) => (p === 0 ? askBar : teal.node);
  const { say, splash, dealTo, handOver, layBook, showLucky } = tableMotion({ table, view: () => view, render: () => draw(), face: known, me: 0, seats: [0, 1], seatRect, booksBox, sayHost, tableBox, pond, stock, total: () => totalBooks(state) });

  const mine = () => !!state && !moving && state.turn === 0 && state.phase === "ask" && state.winner === -1 && !forcedMove(state, 0, known);
  table.onPick((slot) => {
    if (!mine()) return;
    selRank = selRank === rankOf(slot) ? null : rankOf(slot);
    sound("deal", { offset: -4 });
    draw();
  });
  function pickSeat() {
    if (!mine()) return;
    if (selRank === null) hand.querySelector(".gf-hcard[tabindex='0']")?.focus({ preventScroll: true });
    else askBtn.focus({ preventScroll: true });
  }
  function askNow() {
    if (!mine()) return;
    const move = { ask: selRank, from: askable(state, 0)[0] };
    selRank = null;
    moveFn(move);
  }
  // A asks and Escape clears while the table has focus.
  node.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape" && selRank !== null) {
      selRank = null;
      draw();
    } else if (e.key === "a" || e.key === "A") askNow();
  });

  function draw() {
    const asking = mine();
    if (!asking || !ranksIn(state.hands[0], known).includes(selRank)) selRank = null;
    const options = asking ? askable(state, 0) : [];
    table.renderStock(view.stock);
    pondCount.textContent = view.stock ? "The pond" : "The pond is empty";
    const out = view.hands[1].length === 0 && state.out[1];
    drawSeat(table, teal, { name: "Teal", hand: view.hands[1], books: view.books[1], face: known, arriving: view.arriving, out, can: options.includes(1), chosen: true, asked: shownAsk?.to === 1, rank: selRank, unit: "book" });
    drawBooks(table, myBooks, view.books[0], { face: known, arriving: view.arriving });
    meArea.classList.toggle("asked", shownAsk?.to === 0);
    drawHand(table, view.hands[0], { face: known, arriving: view.arriving, rank: selRank, asking });
    myCount.textContent = String(view.hands[0].length);
    myBooksCount.textContent = view.books[0].length ? `· ${plural(view.books[0].length, "book")}` : "";
    const turn = current?.p ?? (state.winner === -1 ? state.turn : -1);
    meArea.classList.toggle("active", turn === 0);
    teal.node.classList.toggle("active", turn === 1);
    drawAsk({ askBtn, handHint, hint, tableBox }, { asking, playing: state.winner === -1, rank: selRank, to: options.length === 1 ? options[0] : null, many: options.length > 1, nameOf: () => "Teal" });
  }

  // The game's motion for each event (main.js's animate()), after the beat its move waits for.
  async function animate(ev, g) {
    await wait(beat(ev), g);
    if (!table.live(g)) return;
    current = ev;
    if (ev.type === "ask") {
      shownAsk = { p: ev.p, to: ev.to, rank: ev.rank };
      draw();
      sound("ask");
      say(ev.p, `Got any ${rankWords(ev.rank)}?`, g, "ask");
      await wait(PACE.bubble, g);
    } else if (ev.type === "give") {
      say(ev.p, giveWords(ev.slots.length), g, "give");
      shownAsk = null;
      await handOver(ev, g, 1);
      await wait(PACE.between, g);
    } else if (ev.type === "fish") {
      say(ev.p, fishWords(), g, "fish");
      shownAsk = null;
      draw();
      sound("fish");
      splash(g);
      await wait(PACE.bubble * 0.85, g);
    } else if (ev.type === "draw") {
      await dealTo(ev.p, ev.slot, g, PACE.draw, "draw");
    } else if (ev.type === "lucky") {
      say(ev.p, `Lucky catch: ${cardsOf(1, ev.rank)}!`, g, "lucky");
      sound("lucky");
      await showLucky(ev, g, 1);
    } else if (ev.type === "book") {
      await layBook(ev, g, 1);
      await wait(PACE.between * 1.5, g);
    } else if (ev.type === "out") {
      say(ev.p, "Out of cards", g, "out");
      sound("out");
      await wait(PACE.bubble * 0.6, g);
    }
    current = null;
    await wait(PACE.between, g);
  }

  const fromState = (st) => ({ hands: st.hands.map((h) => h.slice()), stock: st.stock.length, books: st.books.map((b) => b.map((x) => ({ rank: x.rank, slots: x.slots.slice() }))), arriving: new Set() });
  // The first card of a rank in your hand, as drawn.
  const rankCard = (words) => [...hand.querySelectorAll(".gf-hcard")].find((b) => rankWords(rankOf(Number(b.dataset.slot))) === words);
  const spots = { ask: askBtn, pond: stock, teal: teal.node, books: myBooks, "teal-books": teal.books };

  return {
    node,
    cell: (c) => (typeof c === "number" ? handCards.get(c) : c.startsWith("book:") ? myBooks.querySelector(`[data-book="${c.slice(5)}"]`) : (spots[c] ?? rankCard(c))) ?? hand,
    onMove: (fn) => (moveFn = fn),
    async render(st, played) {
      state = st;
      if (!played) {
        table.stop();
        moving = false;
        current = null;
        shownAsk = st.phase === "answer" ? { p: st.ask.from, to: st.ask.to, rank: st.ask.rank } : null;
        view = fromState(st);
        turns = st.turns;
        return draw();
      }
      const g = table.gen;
      moving = true;
      for (const ev of played) if (table.live(g)) await animate(ev, g);
      if (!table.live(g)) return;
      moving = false;
      view = fromState(st);
      draw();
      if (st.turns !== turns && mine()) sound("turn");
      turns = st.turns;
    },
    // The cards of a rank asked for wrongly shake, with the game's refusal.
    reject(move) {
      sound("nope");
      for (const btn of hand.querySelectorAll(".gf-hcard")) if (rankOf(Number(btn.dataset.slot)) === move.ask) table.shake(btn.firstChild);
    },
  };
}
