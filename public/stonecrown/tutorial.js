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
import { makeRules, deckOf, movers, canBuild, canStage, passDir, leftOf, rightOf, stagesOf, shields, sideCoins, ROUNDS } from "./rules.js";
import { PACE, ROMAN, plural, listOf, cardWords, stageWords, effectWords, costWords, payWords, buyWords, moveFor, pickOptions, WHY, whyWords, warWords, warPairs, resultWords, viewOf, turnWords, seatWords, chainsFrom, chainsTo, turnCardEl, costEl, effectEl, coinEl, seatMark, cityEl, boardSvg, tableEl, scTable, scoreSheet } from "./art.js";
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

// The game's table, as in main.js: the top bar, your neighbours either side,
// your wonder and city, your hand and what the card you tap can do. Tap a
// card (or the arrow keys and Enter), then Build, Wonder stage or Sell for 3
// (or B, W, S; Esc lets go). Everything moves and sounds as in the game.
export function board() {
  const table = cardTable({ prefix: "sc", play: sound, animate: () => {}, done: () => {} });
  const { live, fast, wait } = table;
  const art = scTable(table, { me: 0, players: PLAYERS, nameOf, onSeat: (p) => openSeat(p) });
  let state = null;
  let view = null; // the table as drawn
  let moving = false;
  let sel = null; // { slot, build: purchase index, stage: purchase index }
  let revealing = false; // the others' pick marks stay up while the picks turn over
  let leaving = new Set();
  let arriving = new Set();
  let sheet = null;
  let finalBox = null;
  let moveFn = () => {};

  const choosing = () => !moving && !!state && state.winner === -1 && movers(state).includes(0) && state.picks[0] === null;
  const idOf = (slot) => DECK[slot] ?? -1;

  // ---------- the top bar ----------
  const ageBadge = el("span", { class: "sc-age-badge", "aria-hidden": "true" });
  const ageLine = el("b", { class: "sc-age" });
  const turnLine = el("small", { class: "sc-turn-line" });
  const ageBox = el("div", { class: "sc-top-age", role: "group" }, ageBadge, el("span", { class: "sc-top-words" }, ageLine, turnLine));
  const passLine = el("span", { class: "sc-pass" });
  const top = el("div", { class: "sc-top" }, ageBox, passLine, art.bankBox, art.pile);

  // ---------- your hand, the buttons and the detail strip ----------
  const handHead = el("span", { class: "sc-hand-title" });
  const handNext = el("span", { class: "sc-hand-next" });
  const hand = el("div", { class: "sc-hand", id: "sc-hand", role: "group", "aria-label": "Your hand" });
  const handButtons = new Map();
  let focusSlot = null;
  // Made once, so a lit button stays lit.
  function actButton(id, cls, onclick, icon = null) {
    const lbl = el("span", { class: "lbl" });
    const sub = el("small");
    const b = el("button", { class: `btn sc-act ${cls}`, type: "button", id, onclick: () => !b.disabled && onclick() }, icon, el("span", { class: "sc-act-words" }, lbl, sub));
    const set = (label, small, { disabled = false, aria = null, extra = "" } = {}) => {
      lbl.textContent = label;
      sub.textContent = small ?? "";
      sub.hidden = !small;
      b.disabled = disabled;
      b.className = `btn sc-act ${cls} ${extra}`;
      if (aria) b.setAttribute("aria-label", aria);
      else b.removeAttribute("aria-label");
    };
    return { b, set };
  }
  const buildBtn = actButton("sc-build", "primary", () => act("build"));
  const stageBtn = actButton("sc-stage", "", () => act("stage"));
  const sellBtn = actButton("sc-sell", "", () => act("sell"), coinEl(3));
  const buttons = el("div", { class: "sc-buttons", id: "sc-buttons", role: "group", "aria-label": "What to do with the card", dataset: { n: "3" } }, buildBtn.b, stageBtn.b, sellBtn.b);
  const detail = el("div", { class: "sc-detail", id: "sc-detail", "aria-live": "polite" });
  const picks = el("ul", { class: "sc-picks", id: "sc-picks", "aria-label": "Who has picked" });
  const handArea = el(
    "section",
    { class: "sc-hand-area", "aria-label": "Your move" },
    el("div", { class: "sc-hand-head" }, el("h2", { class: "sc-title" }, handHead), handNext),
    el("div", { class: "sc-hand-wrap" }, hand),
    el("div", { class: "sc-side" }, buttons, detail, picks),
  );

  const warLine = el("span", { class: "sr-only", role: "status" });
  const dialog = el("dialog", { class: "card sc-dialog", "aria-labelledby": "sc-dialog-title" });
  const node = el(
    "div",
    { class: "stonecrown pc-game", dataset: { seat: 0, players: PLAYERS } },
    tableEl(),
    top,
    el("div", { class: "sc-main" }, art.panels.get(art.around.left).node, art.mine, art.panels.get(art.around.right).node, handArea),
    dialog,
    warLine,
    table.flyLayer,
  );

  // ---------- your choices ----------
  const send = (move) => {
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

  // What the build and stage buttons would send, and their words (as main.js's).
  function buildPlan(o) {
    const b = o.build;
    if (b.chain) return { ok: true, move: moveFor("build", sel.slot), label: "Build free", sub: `Chain from ${listOf(chainsFrom(o.card))}` };
    if (!b.ok || !b.purchases.length) return { ok: false, label: WHY[b.why] ?? "Can't build", sub: b.why === "duplicate" ? "" : costWords(o.card.cost), why: whyWords(b.why, o.card) };
    const p = b.purchases[sel.build % b.purchases.length];
    const side = sideCoins(state, 0, p);
    return { ok: true, move: moveFor("build", sel.slot, p), label: "Build", sub: payWords({ bank: b.coins, ...side }, names) || "Free", buy: p, side, ways: b.purchases.length };
  }
  function stagePlan(o) {
    const s = o.stage;
    if (!s.ok) return { ok: false, label: s.why === "built" ? "Wonder finished" : "Can't afford", sub: s.stage ? `Stage ${ROMAN[s.n + 1]}: ${costWords(s.stage.cost)}` : "", why: whyWords(s.why) };
    const p = s.purchases[sel.stage % s.purchases.length];
    const side = sideCoins(state, 0, p);
    return { ok: true, move: moveFor("stage", sel.slot, p), label: `Wonder stage ${ROMAN[s.n + 1]}`, sub: payWords(side, names) || "Free", buy: p, side, ways: s.purchases.length };
  }
  function act(kind) {
    if (!choosing() || !sel) return;
    const o = optionsFor(sel.slot);
    if (kind === "sell") return send({ discard: sel.slot });
    const plan = kind === "build" ? buildPlan(o) : stagePlan(o);
    if (!plan.ok) {
      sound("nope");
      return table.shake(buttons);
    }
    send(plan.move);
  }

  // B, W and S build, raise a stage or sell; Esc lets go of the card.
  addEventListener("keydown", (e) => {
    if (!node.isConnected || e.target.closest?.("input, textarea, dialog") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === "Escape" && sel) {
      const slot = sel.slot;
      sel = null;
      draw();
      handButtons.get(slot)?.focus({ preventScroll: true });
      return;
    }
    const kind = { b: "build", w: "stage", s: "sell" }[e.key.toLowerCase()];
    if (kind && sel && choosing()) {
      e.preventDefault();
      act(kind);
    }
  });
  // Arrows, Home and End move along the hand; Enter and Space pick a card.
  hand.addEventListener("keydown", (e) => {
    const btn = e.target.closest(".sc-hcard");
    if (!btn) return;
    const list = [...hand.querySelectorAll(".sc-hcard")];
    const i = list.indexOf(btn);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -i, End: list.length - 1 - i }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const target = list[Math.max(0, Math.min(list.length - 1, i + step))];
    focusSlot = Number(target.dataset.slot);
    for (const b of list) b.tabIndex = b === target ? 0 : -1;
    target.focus();
  });
  hand.addEventListener("click", (e) => {
    const btn = e.target.closest(".sc-hcard");
    if (!btn) return;
    focusSlot = Number(btn.dataset.slot);
    select(focusSlot);
  });

  // ---------- drawing ----------
  function drawTop() {
    const age = view.age;
    ageBadge.textContent = ROMAN[age];
    ageLine.textContent = `Age ${ROMAN[age]}`;
    turnLine.textContent = `Turn ${Math.min(view.round, ROUNDS)} of ${ROUNDS}`;
    ageBox.setAttribute("aria-label", turnWords(age, view.round));
    node.dataset.age = String(age);
    const dir = passDir(age);
    passLine.replaceChildren(el("span", { class: `sc-pass-arrow ${dir > 0 ? "left" : "right"}`, "aria-hidden": "true" }), el("span", {}, el("span", { class: "sc-pass-word" }, "pass "), dir > 0 ? "left" : "right"));
    passLine.setAttribute("aria-label", `Hands pass ${dir > 0 ? "left" : "right"}, to ${nameIn(dir > 0 ? art.around.left : art.around.right)}`);
    art.drawPile(view);
  }

  function drawHand() {
    const slots = view.hands[0];
    const can = choosing();
    if (sel && !slots.includes(sel.slot)) sel = null;
    for (const [slot, b] of handButtons) {
      if (slots.includes(slot)) continue;
      b.remove();
      handButtons.delete(slot);
    }
    slots.forEach((slot, i) => {
      const id = idOf(slot);
      let b = handButtons.get(slot);
      if (!b) {
        b = el("button", { class: "sc-hcard", type: "button", dataset: { slot } }, turnCardEl(id, view.age, { down: false }));
        handButtons.set(slot, b);
      }
      const o = can ? optionsFor(slot) : null;
      const isSel = sel?.slot === slot;
      b.classList.toggle("sel", isSel);
      b.classList.toggle("can", !!o && o.build.ok);
      b.classList.toggle("chain", !!o?.build.chain);
      b.style.opacity = leaving.has(slot) || arriving.has(slot) ? "0" : "";
      b.setAttribute("aria-pressed", String(isSel));
      const now = !o ? "" : o.build.chain ? "free through a chain" : o.build.ok ? "you can build it" : WHY[o.build.why]?.toLowerCase() ?? "";
      b.setAttribute("aria-label", `${cardWords(id)}${now ? ` Now: ${now}.` : ""}`);
      b.style.setProperty("--i", String(i));
      if (hand.children[i] !== b) hand.insertBefore(b, hand.children[i] ?? null);
    });
    if (focusSlot === null || !handButtons.has(focusSlot)) focusSlot = slots[0] ?? null;
    for (const [slot, b] of handButtons) b.tabIndex = slot === focusSlot ? 0 : -1;
    hand.dataset.n = String(slots.length);
    hand.classList.toggle("choosing", can);
    hand.setAttribute("aria-label", `Your hand: ${plural(slots.length, "card")}`);
    handHead.textContent = state.winner !== -1 ? "Your hand" : view.round === ROUNDS && slots.length === 2 && can ? "Your hand · last turn of the age" : can ? "Your hand · pick one" : "Your hand";
    const to = passDir(view.age) > 0 ? art.around.left : art.around.right;
    handNext.textContent = slots.length > 1 && view.round < ROUNDS ? `then passes to ${nameIn(to)} ${passDir(view.age) > 0 ? "◂" : "▸"}` : "";
  }

  function drawSide() {
    const can = choosing();
    buttons.hidden = !can;
    if (!can) {
      detail.replaceChildren();
      detail.hidden = true;
    } else if (!sel) {
      buildBtn.set("Build", null, { disabled: true });
      stageBtn.set("Wonder stage", null, { disabled: true });
      sellBtn.set("Sell for 3", null, { disabled: true });
      detail.replaceChildren(el("p", { class: "sc-hint" }, "Tap a card to see what you can do with it."));
      detail.hidden = false;
    } else {
      const o = optionsFor(sel.slot);
      const b = buildPlan(o);
      const s = stagePlan(o);
      buildBtn.set(b.label, b.sub, { disabled: !b.ok, extra: o.build.chain ? "chain" : "", aria: b.ok ? `${b.label} ${o.card.name}: ${b.sub} (B)` : `Can't build ${o.card.name}: ${b.why}` });
      stageBtn.set(s.label, s.sub, { disabled: !s.ok, aria: s.ok ? `${s.label}, tucking ${o.card.name} face down: ${s.sub} (W)` : `Wonder stage: ${s.why}` });
      sellBtn.set("Sell for 3", null, { aria: `Sell ${o.card.name} face down for 3 coins (S)` });
      detail.replaceChildren(...detailNodes(o, b, s));
      detail.hidden = false;
    }
    // Teal and Violet have picked already: they wait for you.
    picks.hidden = !can;
    picks.replaceChildren(...(can ? SEATS.map((p) => el("li", { class: `p-${p} ${p ? "done" : ""}` }, seatMark(p), el("span", { class: "nm" }, nameOf(p)), el("span", { class: "sc-pick-state" }, p ? "✓ picked" : "choosing"))) : []));
  }

  // The card you tapped: what it does, what it costs and how you'd pay, or why you can't.
  function detailNodes(o, b, s) {
    const c = o.card;
    const from = chainsFrom(c);
    const free = costWords(c.cost) === "free";
    const lines = [
      el("div", { class: `sc-detail-head c-${c.color}` }, el("strong", { class: "sc-detail-name" }, c.name), effectEl(c), o.build.chain ? el("span", { class: "sc-badge chain" }, "chain") : null),
      el("p", { class: "sc-detail-fx" }, effectWords(c)),
      el("p", { class: "sc-detail-cost" }, ...(free ? [el("span", { class: "k" }, "Free to build")] : [el("span", { class: "k" }, "Costs"), costEl(c.cost), el("span", {}, costWords(c.cost))]), from.length ? el("small", { class: "sc-chain-from" }, ` · free with ${listOf(from)}`) : null),
      chainsTo(c).length ? el("p", { class: "sc-chain-to" }, `Makes ${listOf(chainsTo(c))} free later.`) : null,
    ];
    if (o.build.chain) lines.push(el("p", { class: "sc-detail-pay ok" }, `Free: you have ${listOf(from)}.`));
    else if (b.ok) {
      const buy = b.buy && buyWords(b.buy, names);
      lines.push(el("p", { class: "sc-detail-pay ok" }, buy ? `${buy} for ${plural(b.side.left + b.side.right, "coin")}.` : c.cost.coins ? `Pay ${plural(c.cost.coins, "coin")} to the bank.` : "You make everything it needs."));
      if (b.ways > 1) lines.push(el("button", { class: "btn sc-act small link", type: "button", id: "sc-other", onclick: () => ((sel.build += 1), draw()) }, el("span", { class: "sc-act-words" }, el("span", { class: "lbl" }, "Other way to pay"))));
    } else lines.push(el("p", { class: "sc-detail-pay no" }, `${whyWords(o.build.why, c)}.`));
    const stage = o.stage.stage;
    if (stage) {
      const words = s.ok && s.buy && buyWords(s.buy, names);
      lines.push(el("p", { class: "sc-detail-stage" }, el("span", { class: "k" }, `Stage ${ROMAN[o.stage.n + 1]}`), costEl(stage.cost), el("span", { class: "sc-arrow" }, "→"), effectEl(stage), el("small", {}, ` ${effectWords(stage)}.${s.ok ? (words ? ` ${words} for ${plural(s.side.left + s.side.right, "coin")}.` : "") : ` ${whyWords(o.stage.why)}.`}`)));
    }
    return lines.filter(Boolean);
  }

  function draw() {
    drawTop();
    for (const [p, panel] of art.panels) panel.draw(view, { picked: (choosing() || revealing) && p !== 0 });
    art.drawMine(view);
    drawHand();
    drawSide();
    if (dialog.open) drawDialog();
  }

  // ---------- a seat's whole city ----------
  let dialogSeat = -1;
  function openSeat(p) {
    if (!view) return;
    dialogSeat = p;
    drawDialog();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector(".sc-dialog-close")?.focus();
  }
  function drawDialog() {
    const p = dialogSeat;
    const w = view.wonders[p];
    const W = WONDERS[w.w];
    const ids = view.city[p].map((x) => x.id);
    const boardBox = el("div", { class: "sc-dialog-board", role: "img", "aria-label": `${W.name}, side ${w.side}: ${view.stages[p].length} of ${stagesOf(view, p).length} stages built. ${stagesOf(view, p).map((x, n) => stageWords(x, n)).join(" ")}` });
    boardBox.innerHTML = boardSvg(w.w, w.side, view.stages[p].length);
    dialog.replaceChildren(
      el("div", { class: `sc-dialog-head p-${p}` }, seatMark(p), el("h2", { id: "sc-dialog-title" }, `${nameOf(p)}'s city`), el("small", {}, p === art.around.left ? "your left neighbour" : "your right neighbour"), el("button", { class: "btn small sc-dialog-close", type: "button", onclick: () => dialog.close() }, "Close")),
      el("p", { class: "sc-dialog-facts" }, seatWords(view, p)),
      boardBox,
      ids.length ? cityEl(ids, { cls: "big" }) : el("p", { class: "sc-hint" }, "Nothing built yet."),
      el("ul", { class: "sr-only" }, ids.map((id) => el("li", {}, cardWords(id)))),
    );
  }
  dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());

  // ---------- motion: main.js's, for the events a lesson has ----------
  const rectOf = (p, part, arg) => art.rectsOf(p)?.[part]?.(arg) ?? null;
  const handRect = (slot) => (handButtons.get(slot) ? table.rectIn(handButtons.get(slot)) : rectOf(0, "pick"));

  // A turn's picks come as one batch, then the sevenths, the pass, the war, a new age or the end.
  function batches(events) {
    const out = [];
    let batch = null;
    for (const ev of events) {
      const isPick = ev.type === "build" || ev.type === "stage" || (ev.type === "discard" && !ev.seventh);
      if (isPick || (ev.type === "gain" && batch)) {
        if (!batch) out.push((batch = { type: "picks", picks: [], gains: [] }));
        (isPick ? batch.picks : batch.gains).push(ev);
        continue;
      }
      batch = null;
      if (ev.type === "discard") {
        if (out.at(-1)?.type === "sevenths") out.at(-1).list.push(ev);
        else out.push({ type: "sevenths", list: [ev] });
        continue;
      }
      out.push(ev);
    }
    return out;
  }

  async function animate(ev, g) {
    if (ev.type === "picks") await revealPicks(ev, g);
    else if (ev.type === "pass") await passHands(ev, g);
    else if (ev.type === "sevenths") await sevenths(ev, g);
    else if (ev.type === "war") await war(ev, g);
    else if (ev.type === "age") await dealAge(ev, g);
    else if (ev.type === "over") await over(ev, g);
    await wait(PACE.between, g);
  }

  // Everyone's picks turn over together, then each card flies to its place
  // with the coins it cost, and the coins earned come in after.
  async function revealPicks(ev, g) {
    const list = ev.picks;
    revealing = true;
    draw();
    const from = new Map(list.map((x) => [x.p, x.p === 0 ? handRect(x.slot) : rectOf(x.p, "pick")]));
    sound("reveal");
    revealing = false;
    draw();
    await art.flipAll(list.filter((x) => x.p !== 0 && x.type === "build").map((x) => ({ id: x.id, age: view.age, rect: from.get(x.p) })), { g, ms: PACE.flip });
    if (!live(g)) return;
    const flights = [];
    for (const x of list) {
      const p = x.p;
      const start = from.get(p);
      if (p === 0) leaving.add(x.slot);
      const bought = x.bought ?? { left: 0, right: 0 };
      view.coins[p] -= (x.coins ?? 0) + bought.left + bought.right;
      if (x.coins) flights.push(art.flyCoins(x.coins, rectOf(p, "coins"), art.bankRect(), { g }));
      if (bought.left) flights.push(art.flyCoins(bought.left, rectOf(p, "coins"), rectOf(leftOf(view, p), "coins"), { g }));
      if (bought.right) flights.push(art.flyCoins(bought.right, rectOf(p, "coins"), rectOf(rightOf(view, p), "coins"), { g }));
      if (bought.left || bought.right) sound("trade", { n: bought.left + bought.right });
      if (x.type === "build") {
        const color = CARDS[x.id].color;
        sound("build", { color, how: x.how });
        flights.push(
          art.flyCard(x.id, view.age, start, rectOf(p, "city", color), { g, width: p === 0 ? null : 40 }).then(() => {
            view.city[p].push({ slot: x.slot, id: x.id });
            draw();
          }),
        );
      } else if (x.type === "stage") {
        sound("stage", { n: x.n });
        const id = p === 0 ? idOf(x.slot) : -1;
        flights.push(
          art.flyCard(id, view.age, start, rectOf(p, "wonder"), { g, ms: PACE.stage, turn: p === 0 ? "down" : null, width: p === 0 ? null : 36 }).then(() => {
            view.stages[p].push(x.slot);
            draw();
            art.bump(p === 0 ? art.boardBox : art.panels.get(p)?.node.querySelector(".sc-stage-dots"), p === 0 ? 1.04 : 1.25);
          }),
        );
      } else {
        sound("sell");
        const id = p === 0 ? idOf(x.slot) : -1;
        flights.push(
          art.flyCard(id, view.age, start, art.pileRect(), { g, turn: p === 0 ? "down" : null, width: 34 }).then(() => {
            view.discard.push(x.slot);
            draw();
          }),
        );
      }
      if (p === 0) view.hands[0] = view.hands[0].filter((s) => s !== x.slot);
    }
    draw();
    await Promise.all(flights);
    if (!live(g)) return;
    leaving = new Set();
    await Promise.all(
      ev.gains.map((x) => {
        sound("coins", { n: x.coins });
        return art.flyCoins(x.coins, x.why === "trade" ? rectOf(x.from, "coins") : art.bankRect(), rectOf(x.p, "coins"), { g }).then(() => {
          view.coins[x.p] += x.coins;
          draw();
        });
      }),
    );
  }

  // Hands slide round: yours to one neighbour, the other's to you.
  async function passHands(ev, g) {
    const to = ev.dir > 0 ? art.around.left : art.around.right;
    const from = ev.dir > 0 ? art.around.right : art.around.left;
    sound("pass", { dir: ev.dir });
    const flights = [];
    if (!fast()) {
      view.hands[0].forEach((slot, i) => {
        flights.push(art.flyCard(idOf(slot), view.age, handRect(slot), rectOf(to, "seat"), { g, ms: PACE.pass, delay: i * 40, width: 44, fade: true }));
        leaving.add(slot);
      });
      flights.push(art.flyCard(null, view.age, rectOf(from, "seat"), rectOf(to, "seat"), { g, ms: PACE.pass, width: 30, fade: true }));
    }
    draw();
    await Promise.all(flights);
    if (!live(g)) return;
    view.hands = SEATS.map((p) => view.hands[(p - ev.dir + PLAYERS) % PLAYERS]);
    view.round++;
    leaving = new Set();
    view.hands[0].forEach((s) => arriving.add(s));
    draw();
    if (!fast()) {
      await Promise.all(
        view.hands[0].map((slot, i) =>
          art.flyCard(null, view.age, rectOf(from, "seat"), handRect(slot), { g, ms: PACE.pass, delay: i * 40, width: 44 }).then(() => {
            arriving.delete(slot);
            draw();
          }),
        ),
      );
    }
    arriving = new Set();
    draw();
  }

  // The last card of each hand goes to the discard pile, face down.
  async function sevenths(ev, g) {
    sound("sell");
    const flights = ev.list.map((x) => {
      const mine = x.p === 0;
      if (mine) leaving.add(x.slot);
      return art.flyCard(mine ? idOf(x.slot) : -1, view.age, mine ? handRect(x.slot) : rectOf(x.p, "seat"), art.pileRect(), { g, turn: mine ? "down" : null, width: 34 });
    });
    draw();
    await Promise.all(flights);
    for (const x of ev.list) {
      view.hands[x.p] = view.hands[x.p].filter((s) => s !== x.slot);
      view.discard.push(x.slot);
    }
    leaving = new Set();
    draw();
  }

  async function war(ev, g) {
    await art.war({
      age: ev.age,
      pairs: warPairs(ev.results),
      strength: SEATS.map((p) => shields(view, p)),
      g,
      sound,
      onToken: (p, v) => {
        view.tokens[p].push(v);
        draw();
      },
    });
    warLine.textContent = warWords(ev.results, 0, ev.age, nameIn);
  }

  // A new age: its cards are dealt round the table.
  async function dealAge(ev, g) {
    view.age = ev.age;
    view.round = 1;
    view.hands = state.hands.map((h) => h.slice());
    view.hands[0].forEach((s) => arriving.add(s));
    sound("deal", { age: ev.age });
    draw();
    if (!fast()) {
      const r = table.rectIn(hand);
      const centre = { x: r.x + r.w / 2 - 20, y: r.y - 10, w: 40, h: 56 };
      const jobs = [];
      let i = 0;
      for (let k = 0; k < HAND; k++) {
        for (const p of SEATS) {
          const slot = view.hands[p][k];
          jobs.push(
            wait(i++ * PACE.dealGap, g).then(async () => {
              await art.flyCard(null, ev.age, centre, p === 0 ? handRect(slot) : rectOf(p, "seat"), { g, ms: PACE.deal, width: p === 0 ? null : 30, fade: p !== 0 });
              if (p === 0) arriving.delete(slot);
              draw();
            }),
          );
        }
      }
      await Promise.all(jobs);
    }
    arriving = new Set();
    draw();
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
    if (fast()) sheet.node.querySelectorAll("tr").forEach((tr) => tr.classList.add("on"));
    else {
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
      if (c.startsWith("card-")) return handButtons.get(n) ?? hand;
      if (c.startsWith("chip-")) return art.cityBox.querySelector(`.sc-chip[data-id="${n}"]`) ?? art.cityBox;
      if (c.startsWith("seat-")) return art.panels.get(n).node;
      if (c.startsWith("sells-")) return art.panels.get(n).node.querySelector(".sc-seat-sells");
      if (c === "total") return sheet?.node.querySelector(`tfoot td:nth-child(${sheetColumn() + 2})`) ?? art.boardBox;
      return { build: buildBtn.b, stage: stageBtn.b, sell: sellBtn.b, detail, board: art.boardBox, city: art.cityBox, coins: art.mine.querySelector(".sc-me-stats .coins"), shields: art.mine.querySelector(".sc-me-stats .shields"), tokens: art.mine.querySelector(".sc-me-stats .sc-tokens"), age: ageBox, pass: passLine, pile: art.pile, picks }[c];
    },
    onMove: (fn) => (moveFn = fn),
    async render(st, played) {
      if (st !== state) sel = null;
      if (!played) {
        table.reset();
        finalBox?.remove();
        sheet = finalBox = null;
        state = st;
        moving = false;
        revealing = false;
        leaving = new Set();
        arriving = new Set();
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
      table.shake(move.build !== undefined ? buildBtn.b : move.stage !== undefined ? stageBtn.b : move.discard !== undefined ? sellBtn.b : buttons);
    },
  };

  // Your column in the score sheet, which orders seats by total.
  function sheetColumn() {
    return [...sheet.node.querySelectorAll("thead th")].slice(1).findIndex((th) => th.classList.contains("mine"));
  }
}
