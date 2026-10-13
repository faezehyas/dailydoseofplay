// Crazy Eights' tutorial: its lessons (lessons.js) on the game's own table,
// cards and suit picker (engine/cards/table.js, art.js, style.css), moving
// and sounding as in the game (sounds.js), every move checked by rules.js.
// The hands are fixed and every card is known (engine/cards/lesson-deck.js),
// so no shuffle runs. The adapter engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { RuleError } from "../engine/turn-match.js";
import { cardTable } from "../engine/cards/table.js";
import { DECK, SUIT_NAMES, cardWords } from "../engine/cards/faces.js";
import { card, cards, lessonDeck, lessonMove } from "../engine/cards/lesson-deck.js";
import { makeRules, DEFAULT_CONFIG, SUIT_SIGNS, suitOf, isEight, canPass, playable } from "./rules.js";
import { PACE, handOrder, tilt, drawPile, drawSuit, suitBurst, nudge, showPicker } from "./art.js";
import { play as sound } from "./sounds.js";

export { lessons } from "./lessons.js";
export const flavour = "paper";

const rules = makeRules(DEFAULT_CONFIG);
const known = (slot) => slot;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A position is { hands, pile, stock } (see lessons.js); you are player 0, to move.
export function load({ hands, pile, stock = [] }) {
  const state = rules.newState(0, hands.length, lessonDeck());
  const top = card(pile.at(-1));
  const held = new Set(cards([...hands.flat(), ...pile, ...stock]));
  Object.assign(state, {
    hands: hands.map(cards),
    discard: cards(pile),
    stock: [...cards(stock), ...[...Array(DECK).keys()].filter((f) => !held.has(f))],
    top,
    suit: suitOf(top),
    starter: false,
  });
  return state;
}

// Drawing while a card plays is refused in the game's words.
export function play(state, move) {
  if (move.draw && playable(state, state.turn, known).length) throw new RuleError("You have a card that plays");
  return lessonMove(rules, state, move);
}
export const cells = (move) => (move.draw ? ["stock"] : [move.play, "pile"]);

// As in the game: tap a glowing card to play it (an 8 opens the suit
// picker), tap the stock or Draw to draw; the arrow keys and Enter, D and P
// work too. Every card flies and sounds as it does in the game.
export function board() {
  const table = cardTable({ prefix: "ce", play: sound });
  const { fly, wait, rectIn, hand, handCards } = table;
  let state = null;
  let view = null; // the table as drawn: { hands, stock, discard, suit, named, arriving }
  let moving = false;
  let picking = null;
  let moveFn = () => {};

  const teal = table.makeSeat({ p: 1, name: "Teal", pos: "top" });
  const stockBtn = table.makeStock({ onClick: () => send({ draw: true }), label: (left) => (left ? `Draw a card (${plural(left, "card")} in the stock)` : "The stock is empty") });
  const pile = el("div", { class: "ce-pile", id: "ce-pile", role: "img", "aria-label": "Discard pile" });
  const suitBadge = el("div", { class: "ce-suit-badge", id: "ce-suit", hidden: true, "aria-live": "polite" });
  const centre = el(
    "div",
    { class: "ce-centre" },
    el("div", { class: table.cls("stack") }, stockBtn),
    el("div", { class: table.cls("stack") }, pile),
    el("span", { class: "ce-stock-label" }, "Stock"),
    el("span", { class: "ce-pile-label" }, "Discard"),
    suitBadge,
  );
  const myCount = el("span", { class: "count mono" }, "0");
  const meArea = el("div", { class: table.cls("me", "p-0") }, hand, el("span", { class: "pill" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "name" }, "You"), myCount));
  const tableBox = el("div", { class: table.cls("table"), id: "ce-table" }, el("div", { class: table.cls("opps") }, teal.node), centre, meArea);
  const picker = el("div", { class: "ce-picker", id: "ce-picker", hidden: true, role: "dialog", "aria-modal": "true", "aria-labelledby": "ce-picker-title" });
  const drawBtn = el("button", { class: "btn primary", type: "button", id: "ce-draw", onclick: () => send({ draw: true }) }, "Draw");
  const passBtn = el("button", { class: "btn", type: "button", id: "ce-pass", onclick: () => send({ pass: true }) }, "Pass");
  const hint = el("p", { class: table.cls("hint"), id: "ce-hint" });
  const node = el(
    "div",
    { class: "crazy-eights pc-game", dataset: { you: "a", seat: 0 } },
    table.symbolHost,
    el("div", { class: table.cls("main") }, el("div", { class: table.cls("table-wrap") }, tableBox, table.flyLayer, picker), el("div", { class: table.cls("side") }, el("div", { class: table.cls("actions") }, el("div", { class: "ce-buttons" }, drawBtn, passBtn), hint))),
  );

  const mine = () => !!state && !moving && picking === null && state.turn === 0 && state.winner === -1;
  const send = (move) => mine() && moveFn(move);
  table.onPick((slot) => {
    if (!mine()) return;
    if (isEight(slot) && playable(state, 0, known).includes(slot)) return openPicker(slot);
    send({ play: slot });
  });
  // D draws and P passes while the table has focus.
  node.addEventListener("keydown", (e) => {
    if (picking !== null || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "d" || e.key === "D") send({ draw: true });
    else if (e.key === "p" || e.key === "P") send({ pass: true });
  });

  function openPicker(slot) {
    picking = slot;
    showPicker(picker, { face: slot, rest: view.hands[0].filter((s) => s !== slot), pick: (suit) => closePicker(suit), cancel: () => closePicker() });
    draw();
  }
  function closePicker(suit) {
    const slot = picking;
    picking = null;
    picker.hidden = true;
    picker.replaceChildren();
    draw();
    if (suit === undefined) handCards.get(slot)?.focus({ preventScroll: true });
    else send({ play: slot, suit });
  }

  function draw() {
    const plays = new Set(mine() ? playable(state, 0, known) : []);
    table.renderStock(view.stock);
    drawPile(table, pile, view.discard, { face: known, arriving: view.arriving });
    drawSuit(suitBadge, view.suit, view.named);
    teal.render(view.hands[1], view.arriving, `Teal: ${plural(view.hands[1].length, "card")}`);
    table.renderHand(
      view.hands[0].slice().sort((a, b) => handOrder(a, a) - handOrder(b, b)),
      {
        face: known,
        arriving: view.arriving,
        first: [...plays][0],
        look: (slot) => ({ lift: plays.has(slot), classes: { playable: plays.has(slot), dim: mine() && !plays.has(slot) }, label: `${cardWords(slot)}${plays.has(slot) ? ", plays" : ""}` }),
      },
    );
    myCount.textContent = String(view.hands[0].length);
    const turn = moving ? -1 : state.turn;
    meArea.classList.toggle("active", turn === 0);
    teal.node.classList.toggle("active", turn === 1);
    const canAct = mine();
    drawBtn.disabled = !canAct || plays.size > 0;
    passBtn.hidden = !canAct || !canPass(state);
    stockBtn.disabled = !canAct;
    stockBtn.classList.toggle("armed", canAct && !plays.size);
    hint.textContent = canAct && plays.size ? "Tap a glowing card. Keys: arrows, Enter; D draws, P passes." : "";
  }

  const seatRect = (p, slot) => (p === 0 ? (handCards.get(slot) ? rectIn(handCards.get(slot).firstChild) : rectIn(hand)) : teal.rect(slot));
  const bubble = (p, text, g, ms = PACE.bubble) => table.bubble(p === 0 ? meArea : teal.node, p, text, g, ms);

  // The game's motion for each event (main.js's animate()): a card flies to the pile or from the stock.
  async function animate(ev, g) {
    const p = ev.player;
    if (ev.type === "play") {
      const from = seatRect(p, ev.slot);
      view.hands[p] = view.hands[p].filter((s) => s !== ev.slot);
      view.discard.push(ev.slot);
      view.arriving.add(ev.slot);
      draw();
      await fly(ev.face, from, rectIn(pile), { ms: p === 0 ? PACE.mine : PACE.fly, turn: p === 0 ? null : "up", spin: tilt(ev.slot), g });
      view.arriving.delete(ev.slot);
      view.suit = ev.suit;
      view.named = ev.eight;
      draw();
      sound("play");
      if (ev.eight) {
        sound("eight", { suit: ev.suit }, 0.05);
        suitBurst(table, rectIn(pile), ev.suit, g);
        bubble(p, `${SUIT_SIGNS[ev.suit]} ${SUIT_NAMES[ev.suit]}!`, g);
        await wait(380, g);
      }
      if (view.hands[p].length === 1) {
        sound("last", {}, 0.15);
        bubble(p, "Last card!", g, 900);
      }
    } else if (ev.type === "draw") {
      const from = table.stockRect();
      view.stock -= 1;
      view.hands[p].push(ev.slot);
      view.arriving.add(ev.slot);
      draw();
      sound("draw");
      await fly(p === 0 ? ev.slot : null, from, seatRect(p, ev.slot), { ms: PACE.draw, turn: p === 0 ? "up" : null, g });
      view.arriving.delete(ev.slot);
    } else if (ev.type === "pass") {
      sound("pass");
      bubble(p, "Pass", g);
      await wait(PACE.bubble * 0.6, g);
    }
    await wait(PACE.between, g);
  }

  const fromState = (st) => ({ hands: st.hands.map((h) => h.slice()), stock: st.stock.length, discard: st.discard.slice(), suit: st.suit, named: st.named, arriving: new Set() });

  return {
    node,
    cell: (c) => (c === "stock" ? stockBtn : c === "pile" ? pile : (handCards.get(c) ?? pile)),
    onMove: (fn) => (moveFn = fn),
    async render(st, played) {
      state = st;
      if (!played) {
        table.stop();
        moving = false;
        view = fromState(st);
        return draw();
      }
      const g = table.gen;
      moving = true;
      for (const ev of played) await animate(ev, g);
      if (!table.live(g)) return;
      moving = false;
      view = fromState(st);
      draw();
      if (st.winner === 0) {
        sound("win");
        table.confetti(rectIn(hand), 0, [0, 1], g);
      } else if (played[0]?.player === 1 && st.turn === 0) sound("turn");
    },
    // A card that doesn't play shakes, with the game's refusal.
    reject(move) {
      sound("nope");
      if (move.play !== undefined) nudge(table, handCards.get(move.play));
    },
  };
}
