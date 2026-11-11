// Stonecrown's tutorial: its lessons (lessons.js) on the game's own table,
// the neighbours' panels, your wonder, city and hand (art.js and the art it
// draws from), moving and sounding as in the game (sounds.js), every pick
// checked by rules.js. Every card is known and each age is dealt in face
// order, so nothing is random. Everyone picks at once: a step's `others` are
// played with your pick, and the turn resolves as in the game. The adapter
// engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { RuleError } from "../engine/turn-match.js";
import { cardTable } from "../engine/cards/table.js";
import { CARDS, WONDERS, HAND, deckRanges } from "./cards.js";
import { makeRules, deckOf, movers, canBuild, canStage, ROUNDS } from "./rules.js";
import { PACE, moveFor, pickOptions, warWords, resultWords, viewOf, cityDialog, scoreDialog, explainer, seenAll, tableEl, scTable, scMotion, batches, buildPlan, stagePlan, costMatch, detailNodes, handView, handCaption, actButtons, picksList, scoreSheet } from "./art.js";
import { play as sound } from "./sounds.js";
import { PLAYERS, WONDER_KEYS, cards } from "./lessons.js";

export { lessons } from "./lessons.js";
export const flavour = "paper";

const NAMES = ["You", "Teal", "Violet"];
const SEATS = [0, 1, 2];
const rules = makeRules({ side: "A" }, PLAYERS);
const DECK = deckOf(PLAYERS);
const RANGES = deckRanges(PLAYERS);
const range = ([a, b]) => Array.from({ length: b - a }, (_, i) => a + i);
// A slot is its face, so the age a tucked card's back shows is its face's.
function ageOf(slot) {
  const i = RANGES.ages.findIndex(([a, b]) => slot >= a && slot < b);
  return i < 0 ? 3 : i + 1;
}

// The deck API with every face known: a slot is its face, and an age is dealt in face order.
const deck = { face: (slot) => slot, deal() {}, pass() {}, open() {}, shuffle: (slots) => slots.slice() };

// A position (see lessons.js): you are seat 0, and everyone is to pick.
export function load(pos) {
  const used = new Set();
  const take = (names) =>
    cards(names).map((f) => {
      if (used.has(f)) throw new Error(`card ${f} dealt twice`);
      used.add(f);
      return f;
    });
  const hands = SEATS.map((p) => take(pos.hands?.[p]));
  for (const h of hands) if (h.length !== HAND + 1 - pos.round) throw new Error(`turn ${pos.round} needs hands of ${HAND + 1 - pos.round}`);
  const city = SEATS.map((p) => take(pos.city?.[p]).map((slot) => ({ slot, id: DECK[slot] })));
  const discard = take(pos.discard);
  // A tucked card is face down: any card of the ages so far that nobody holds.
  const spare = range([0, RANGES.ages[pos.age - 1][1]]).filter((f) => !used.has(f));
  const stages = SEATS.map((p) => {
    const n = pos.stages?.[p] ?? 0;
    if (spare.length < n) throw new Error("not enough cards to tuck");
    const tucked = spare.splice(0, n);
    tucked.forEach((f) => used.add(f));
    return tucked;
  });
  return {
    players: PLAYERS,
    first: 0,
    turn: -1,
    winner: -1,
    winners: [],
    moves: 0,
    side: "A",
    wonders: WONDER_KEYS.map((key) => ({ w: WONDERS.findIndex((x) => x.key === key), side: "A" })),
    age: pos.age,
    round: pos.round,
    phase: "pick",
    hands,
    city,
    stages,
    coins: (pos.coins ?? [3, 3, 3]).slice(),
    tokens: (pos.tokens ?? [[], [], []]).map((t) => t.slice()),
    discard,
    picks: SEATS.map(() => null),
    freeAge: SEATS.map(() => 0),
    digger: -1,
    lastSeat: -1,
    piles: RANGES.ages.map((r, i) => (i + 1 > pos.age ? range(r).filter((f) => !used.has(f)) : [])),
    pool: range(RANGES.guilds).filter((f) => !used.has(f)),
  };
}

// A build or stage a lesson names without `buy` buys the cheapest way, as the board does.
function paid(state, p, move) {
  if (move.buy !== undefined || move.free) return move;
  if (move.build !== undefined && state.hands[p].includes(move.build)) {
    const can = canBuild(state, p, DECK[move.build]);
    return can.chain || !can.purchases.length ? move : moveFor("build", move.build, can.purchases[0]);
  }
  if (move.stage !== undefined && state.hands[p].includes(move.stage)) {
    const can = canStage(state, p);
    return can.purchases.length ? moveFor("stage", move.stage, can.purchases[0]) : move;
  }
  return move;
}

// Your pick, then Teal's and Violet's for the same turn, then the turn
// resolves as in the game. A refusal reads as a sentence.
export function play(state, move, step = {}) {
  try {
    rules.applyMove(state, 0, paid(state, 0, move), deck);
    (step.others ?? []).forEach((m, i) => rules.applyMove(state, i + 1, paid(state, i + 1, m), deck));
  } catch (err) {
    if (err instanceof RuleError) throw new RuleError(err.message[0].toUpperCase() + err.message.slice(1));
    throw err;
  }
  return rules.settle(state, deck);
}

export function cells(move) {
  const kind = move.build !== undefined ? "build" : move.stage !== undefined ? "stage" : "sell";
  return [`card-${move.build ?? move.stage ?? move.discard}`, kind];
}

// What your pick achieved: the card in your city, the stage on your wonder,
// the coins from a sale, the tokens a war won you, or your total once the
// game is scored.
export function result(state, played = []) {
  if (played.some((ev) => ev.type === "over")) return ["total"];
  const out = [];
  for (const ev of played) {
    if (ev.type === "build" && ev.p === 0) out.push(`chip-${ev.id}`);
    if (ev.type === "stage" && ev.p === 0) out.push("board");
    if (ev.type === "discard" && ev.p === 0 && !ev.seventh) out.push("coins");
    if (ev.type === "war" && ev.results[0].some((r) => r > 0)) out.push("tokens");
  }
  return out;
}

const names = { left: NAMES[1], right: NAMES[2] };
const nameOf = (p) => NAMES[p];
const nameIn = (p) => (p ? NAMES[p] : "you");

// The game's table, as in main.js: the top bar, your neighbours either side
// with the borders between you, your wonder, the seat ring and your city,
// your shelf and hand and what the card you tap can do. Tap a card (or the
// arrow keys and Enter), then Build, Wonder stage or Sell for 3 (or B, W,
// S; Esc lets go). Everything moves, sounds and explains itself as in the
// game, but for the first-time hints, which the lessons make unneeded.
export function board() {
  const table = cardTable({ prefix: "sc", play: sound, animate: () => {}, done: () => {} });
  const { live, fast, wait } = table;
  const wars = [];
  const art = scTable(table, { me: 0, players: PLAYERS, nameOf, ageOf, sound, wars: () => wars, onSeat: (p) => seatDialog.open(p, view), onScore: () => scoreNow.open(view) });
  const seatDialog = cityDialog({ nameOf, ageOf, me: 0, whereOf: (p) => (p === art.around.left ? "your left neighbour" : "your right neighbour") });
  const scoreNow = scoreDialog({ me: 0, nameOf });
  let state = null;
  let view = null; // the table as drawn
  let moving = false;
  let sel = null; // { slot, build: purchase index, stage: purchase index }
  let sent = null; // your last move, for what it bought
  let light = {};
  const revealing = new Set(); // the others' pick marks stay up while the picks turn over
  const leaving = new Set();
  const arriving = new Set();
  let sheet = null;
  let finalBox = null;
  let moveFn = () => {};

  const choosing = () => !moving && !!state && state.winner === -1 && movers(state).includes(0) && state.picks[0] === null;
  const idOf = (slot) => DECK[slot] ?? -1;

  // ---------- the top bar: the seat ring, Explain mode's bar, the bank, the pile, "?" ----------
  const explainSlot = el("span", { class: "sc-explain-slot" });
  const askBtn = el("button", { class: "btn sc-ask", type: "button", id: "sc-ask", "aria-pressed": "false", "aria-label": "Explain mode: tap anything to hear what it means (?)", onclick: () => explain() }, "?");
  const top = el("div", { class: "sc-top" }, art.ringBox, el("div", { class: "sc-top-mid" }, explainSlot), el("div", { class: "sc-top-side" }, art.bankBox, art.pile, askBtn));

  // ---------- your hand, the buttons and the detail strip (art.js's, as in the game) ----------
  const hand = handView({ onSelect: (slot) => select(slot) });
  const buttons = actButtons({ onAct: (kind) => act(kind) });
  const detail = el("div", { class: "sc-detail", id: "sc-detail", "aria-live": "polite" });
  const picks = picksList();
  const handArea = el(
    "section",
    { class: "sc-hand-area", "aria-label": "Your move", dataset: { tipZone: "" } },
    el("div", { class: "sc-hand-head" }, el("div", { class: "sc-hand-words" }, el("h2", { class: "sc-title" }, hand.title), hand.next), picks.node),
    art.shelf,
    el("div", { class: "sc-hand-wrap", dataset: { tip: "hand", tipOn: "hold" } }, hand.node),
    buttons.node,
    el("div", { class: "sc-side" }, detail),
  );

  const warLine = el("span", { class: "sr-only", role: "status" });
  const node = el(
    "div",
    { class: "stonecrown pc-game", dataset: { seat: 0, players: PLAYERS } },
    tableEl(),
    top,
    el("div", { class: "sc-main" }, art.panels.get(art.around.left).node, art.mine, art.panels.get(art.around.right).node, handArea),
    seatDialog.node,
    scoreNow.node,
    art.war.node,
    warLine,
    table.flyLayer,
  );
  const tips = explainer(node, { view: () => view, me: 0, nameOf, bar: explainSlot, memory: seenAll, onExplain: () => syncAsk() });
  function syncAsk() {
    askBtn.setAttribute("aria-pressed", String(tips.explaining()));
    node.classList.toggle("sc-explain-on", tips.explaining());
  }
  function explain() {
    tips.explain();
    syncAsk();
  }

  // ---------- your choices ----------
  const send = (move) => {
    sent = move;
    sound("pick");
    moveFn(move);
  };
  function select(slot) {
    if (!choosing() || sel?.slot === slot) return;
    sel = { slot, build: 0, stage: 0 };
    sound("tap");
    draw();
  }
  const optionsFor = (slot) => ({ id: idOf(slot), card: CARDS[idOf(slot)], ...pickOptions(state, 0, idOf(slot)) });
  const plans = (o) => [buildPlan(state, 0, o, sel.slot, sel.build, names), stagePlan(state, 0, o, sel.slot, sel.stage, names)];
  function act(kind) {
    if (!choosing() || !sel) return;
    if (kind === "sell") return send({ discard: sel.slot });
    const [b, s] = plans(optionsFor(sel.slot));
    const plan = kind === "build" ? b : s;
    if (!plan.ok) {
      sound("nope");
      return table.shake(buttons[kind]);
    }
    send(plan.move);
  }

  // B, W and S build, raise a stage or sell; Esc lets go of the card; ? turns Explain mode on and off.
  addEventListener("keydown", (e) => {
    if (!node.isConnected || e.target.closest?.("input, textarea, dialog, .ws") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === "?") {
      e.preventDefault();
      return explain();
    }
    if (e.key === "Escape" && sel) {
      const slot = sel.slot;
      sel = null;
      draw();
      hand.card(slot)?.focus({ preventScroll: true });
      return;
    }
    const kind = { b: "build", w: "stage", s: "sell" }[e.key.toLowerCase()];
    if (kind && sel && choosing()) {
      e.preventDefault();
      act(kind);
    }
  });

  // ---------- drawing ----------
  function drawTop() {
    node.dataset.age = String(view.age);
    art.drawPile(view);
  }

  function drawHand() {
    const slots = view.hands[0];
    const can = choosing();
    if (sel && !slots.includes(sel.slot)) sel = null;
    hand.draw({
      slots,
      age: view.age,
      idOf,
      options: (slot) => (can ? optionsFor(slot) : null),
      choosing: can,
      sel: sel?.slot ?? null,
      hidden: (slot) => leaving.has(slot) || arriving.has(slot),
      fast: fast(),
      title: state.winner !== -1 ? "Your hand" : view.round === ROUNDS && slots.length === 2 && can ? "Your hand · last turn of the age" : can ? "Your hand · pick one" : "Your hand",
      next: handCaption(view, 0, nameIn),
    });
  }

  function drawSide() {
    const can = choosing();
    light = {};
    if (!can) {
      buttons.none();
      detail.replaceChildren();
    } else if (!sel) {
      buttons.idle();
      detail.replaceChildren(el("p", { class: "sc-hint" }, "Tap a card to see what you can do with it. Its badge says what building it takes."));
    } else {
      const o = optionsFor(sel.slot);
      const [b, s] = plans(o);
      buttons.pick(o, b, s);
      light = costMatch(state, 0, o, b, s)?.light ?? {};
      detail.replaceChildren(...detailNodes(o, b, s, names, { onOther: (kind) => ((sel[kind] += 1), draw()), state, me: 0 }));
    }
    detail.hidden = !detail.childNodes.length;
    // Teal and Violet have picked already: they wait for you.
    picks.draw(can ? SEATS.map((p) => ({ p, name: nameOf(p), done: p !== 0, me: p === 0 })) : null);
  }

  function draw() {
    drawTop();
    art.drawSeats(view, { picked: (p) => (choosing() || revealing.has(p)) && p !== 0 });
    art.drawMine(view);
    art.drawRing(view);
    drawHand();
    drawSide();
    art.drawShelf(view, light);
    seatDialog.draw(view);
    scoreNow.draw(view);
  }

  // ---------- motion: the game's (art.js), for the events a lesson has ----------
  const motion = scMotion(table, art, {
    me: 0,
    seats: SEATS,
    view: () => view,
    idOf,
    handRect: (slot) => (hand.card(slot) ? table.rectIn(hand.card(slot)) : art.rectsOf(0).pick()),
    handBox: () => hand.node,
    leaving,
    arriving,
    revealing,
    draw,
    sound,
    buyOf: () => sent?.buy ?? null,
    onWar: (ev, facts, done) => {
      if (done) wars[ev.age - 1] = ev.results;
    },
    said: (kind, ev) => kind === "war" && (warLine.textContent = warWords(ev.results, 0, ev.age, nameIn)),
  });

  async function animate(ev, g) {
    if (ev.type === "picks") await motion.picks(ev, g);
    else if (ev.type === "pass") await motion.pass(ev, g);
    else if (ev.type === "sevenths") await motion.sevenths(ev, g);
    else if (ev.type === "war") await motion.war(ev, g);
    else if (ev.type === "age") await motion.deal(ev, state.hands, g);
    else if (ev.type === "over") await over(ev, g);
    await wait(PACE.between, g);
  }

  // The score sheet over the table, a row at a time; it stays up for the
  // lesson's end. The table ends just under your hand here, so it sits in
  // the middle of the screen rather than of the table.
  async function over(ev, g) {
    const order = SEATS.slice().sort((a, b) => ev.scores[b].total - ev.scores[a].total || state.coins[b] - state.coins[a] || a - b);
    sheet = scoreSheet(ev.scores, order, { me: 0, nameOf, winners: ev.winners });
    const box = el("div", { class: "sc-final", role: "presentation", style: "position: fixed; top: 50%" }, el("p", { class: "sc-final-title" }, resultWords(ev.scores, ev.winners, 0, nameOf)), sheet.node);
    finalBox = box;
    node.append(box);
    if (fast()) {
      sheet.node.querySelectorAll("tr").forEach((tr) => tr.classList.add("on"));
      sound("score", { row: 7 });
    } else {
      box.animate([{ opacity: 0, transform: "translate(-50%, -46%)" }, { opacity: 1, transform: "translate(-50%, -50%)" }], { duration: 260, fill: "both" });
      await sheet.play({ g, wait, live, fast, sound });
    }
    // A pause to read the total, with or without motion.
    await new Promise((r) => setTimeout(r, 1200));
  }

  return {
    node,
    cell(c) {
      const n = Number(c.split("-").at(-1));
      if (c.startsWith("card-")) return hand.card(n) ?? hand.node;
      if (c.startsWith("chip-")) return art.chipFor(n);
      if (c.startsWith("seat-")) return art.panels.get(n).node;
      if (c.startsWith("sells-")) return art.panels.get(n).border.node.querySelector(".sc-border-sells");
      if (c === "total") return sheet?.node.querySelector(`tfoot td:nth-child(${sheetColumn() + 2})`) ?? art.boardBox;
      return { build: buttons.build, stage: buttons.stage, sell: buttons.sell, detail, board: art.boardBox, city: art.cityBox, coins: art.mine.querySelector(".sc-me-stats .coins"), shields: art.mine.querySelector(".sc-me-stats .shields"), tokens: art.mine.querySelector(".sc-me-stats .sc-tokens"), age: art.ring.node.querySelector(".sc-ring-mid"), pass: art.ring.node, pile: art.pile, picks, shelf: art.shelf, science: art.mine.querySelector(".sc-sci") }[c];
    },
    onMove: (fn) => (moveFn = fn),
    async render(st, played) {
      if (st !== state) sel = null;
      if (!played) {
        table.reset();
        art.war.close();
        tips.hide();
        finalBox?.remove();
        sheet = finalBox = null;
        state = st;
        moving = false;
        revealing.clear();
        leaving.clear();
        arriving.clear();
        wars.length = 0;
        view = viewOf(st);
        return draw();
      }
      state = st;
      const g = table.gen;
      moving = true;
      sel = null;
      draw();
      for (const ev of batches(played)) {
        await animate(ev, g);
        if (!live(g)) return;
      }
      moving = false;
      view = viewOf(st);
      draw();
      if (choosing()) sound("turn");
    },
    // As in the game: a refusal, and the button or card shakes.
    reject(move) {
      sound("nope");
      table.shake(move.build !== undefined ? buttons.build : move.stage !== undefined ? buttons.stage : move.discard !== undefined ? buttons.sell : buttons.node);
    },
  };

  // Your column in the score sheet, which orders seats by total.
  function sheetColumn() {
    return [...sheet.node.querySelectorAll("thead th")].slice(1).findIndex((th) => th.classList.contains("mine"));
  }
}
