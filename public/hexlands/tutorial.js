// Hexlands' tutorial: its lessons (lessons.js) on the game's own island,
// bank, dice and hand (art.js and the art it draws from), moving and
// sounding as in the game (sounds.js), every move checked by rules.js. Every
// card is known and the dice are the lesson's, so no shuffle or roll is
// random. The adapter engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { RuleError } from "../engine/turn-match.js";
import { cardTable } from "../engine/cards/table.js";
import { HEXES, CORNERS, EDGES, RESOURCES, DESERT } from "./board.js";
import { roadSvg, settlementSvg, citySvg, robberSvg } from "./pieces.js";
import { makeRules, COSTS, PIECES, DECK_SIZE, FIRST_DEV, resourceOf, devKind, counts, payment, legalCorners, legalEdges, legalCities, robberHexes, victims, tradeRate, roadLength, playable, movers } from "./rules.js";
import { PACE, RES_NAMES, DEV_NAMES, plural, listOf, countWords, hexWords, cornerWords, edgeWords, glyphEl, cardsRow, production, hexTable } from "./art.js";
import { play as sound } from "./sounds.js";
import { BOARD, cards } from "./lessons.js";

export { lessons } from "./lessons.js";
export const flavour = "wood";

const NAMES = ["You", "Teal", "Violet"];
const SEATS = [0, 1, 2];
const rules = makeRules({ target: 10 }, NAMES.length);
const face = (slot) => slot;
const zero = () => [0, 0, 0, 0, 0];
const BUILD_NAMES = { road: "road", settlement: "settlement", city: "city", dev: "development card" };
const PAID = { road: "road", settle: "settlement", city: "city", buy: "dev" }; // the moves that pay, and what they buy

// The deck API with every face known: deals change nothing anyone sees, and
// a steal takes the first card of the victim's hand as it stands.
const deck = { face, deal() {}, open() {}, shuffle: (slots) => slots.slice() };

// A position (see lessons.js): you are seat 0, and it's your move.
export function load(pos) {
  const used = new Set();
  const take = (names) =>
    cards(names).map((f) => {
      if (used.has(f)) throw new Error(`card ${f} dealt twice`);
      used.add(f);
      return f;
    });
  const hands = SEATS.map((p) => take(pos.hands?.[p]));
  const devs = SEATS.map((p) => take(pos.devs?.[p]));
  const devPile = take(pos.devPile);
  for (let f = FIRST_DEV; f < DECK_SIZE; f++) if (!used.has(f)) devPile.push(f);
  const bank = RESOURCES.map(() => []);
  for (let f = 0; f < FIRST_DEV; f++) if (!used.has(f)) bank[resourceOf(f)].push(f);
  const buildings = Array(CORNERS.length).fill(null);
  const roads = Array(EDGES.length).fill(-1);
  const pieces = SEATS.map((p) => {
    const towns = pos.settlements?.[p] ?? [];
    const cities = pos.cities?.[p] ?? [];
    const paths = pos.roads?.[p] ?? [];
    for (const c of towns) buildings[c] = { p, city: false };
    for (const c of cities) buildings[c] = { p, city: true };
    for (const e of paths) roads[e] = p;
    return { roads: PIECES.roads - paths.length, settlements: PIECES.settlements - towns.length, cities: PIECES.cities - cities.length };
  });
  const setup = pos.setup ? { order: pos.setup.order, i: pos.setup.i, corner: -1 } : null;
  const state = {
    players: NAMES.length,
    first: setup ? setup.order[0] : 0,
    turn: setup ? setup.order[setup.i] : 0,
    winner: -1,
    moves: 0,
    target: 10,
    board: BOARD,
    robber: pos.robber ?? BOARD.desert,
    phase: setup ? "setup" : pos.phase,
    setup: setup ?? { order: [], i: 0, corner: -1 },
    buildings,
    roads,
    pieces,
    hands,
    devs,
    bought: [],
    offers: 0,
    devPlayed: false,
    rolled: pos.phase === "main",
    knights: SEATS.map((p) => pos.knights?.[p] ?? 0),
    shown: SEATS.map(() => []),
    bank,
    devPile,
    dice: pos.dice ?? null,
    discards: SEATS.map(() => 0),
    trade: null,
    monopoly: null,
    freeRoads: 0,
    longest: { p: -1, size: 0 },
    army: { p: -1, size: 0 },
  };
  if (pos.longest !== undefined) state.longest = { p: pos.longest, size: roadLength(state, pos.longest) };
  if (pos.army !== undefined) state.army = { p: pos.army, size: state.knights[pos.army] };
  return state;
}

// Rolls the dice given, one die per draw.
function dice([a, b]) {
  const draws = [a, b];
  return () => (draws.shift() - 0.5) / 6;
}

// A move for whoever is to move, with the rules' events. A build the step
// names without paying is paid from your hand, as the board pays; a reply
// is a list of moves. A refusal reads as a sentence.
export function play(state, move, step = {}) {
  if (Array.isArray(move)) return move.flatMap((m) => play(state, m, step));
  const p = movers(state)[0] ?? state.turn;
  const kind = Object.keys(PAID).find((k) => move[k] !== undefined);
  if (state.phase === "main" && kind && move.pay === undefined && !(kind === "road" && state.freeRoads)) {
    const pay = payment(state.hands[p], face, COSTS[PAID[kind]]);
    if (!pay) throw new RuleError(`A ${BUILD_NAMES[PAID[kind]]} costs ${countWords(COSTS[PAID[kind]])}`);
    move = { ...move, pay };
  }
  const rolled = move.dice ?? step.dice;
  try {
    return rules.applyMove(state, p, move, deck, rolled ? dice(rolled) : undefined);
  } catch (err) {
    if (err instanceof RuleError) throw new RuleError(err.message[0].toUpperCase() + err.message.slice(1));
    throw err;
  }
}

export function cells(move) {
  if (move.settle !== undefined) return ["settlement", `c${move.settle}`];
  if (move.road !== undefined) return ["road", `e${move.road}`];
  if (move.city !== undefined) return ["city", `c${move.city}`];
  if (move.roll) return ["roll"];
  if (move.end) return ["end"];
  if (move.buy) return ["dev"];
  if (move.play !== undefined) return [devKind(move.play)];
  if (move.robber !== undefined) return [`h${move.robber}`];
  if (move.bank) return ["trade", `give-${resourceOf(move.bank[0])}`, `take-${move.take}`, "swap"];
  return [];
}

// What a move achieved for you: the hexes that paid you, the card you
// stole or traded for, the development card you drew, and your buildings
// when you win.
export function result(state, played = []) {
  const out = [];
  for (const ev of played) {
    if (ev.type === "over" && ev.winner === 0) return state.buildings.flatMap((b, c) => (b?.p === 0 ? [`c${c}`] : []));
    if (ev.type === "produce" && ev.gains[0].length) out.push(...HEXES.filter((h) => state.board.numbers[h.id] === ev.roll && h.id !== state.robber && h.corners.some((c) => state.buildings[c]?.p === 0)).map((h) => `h${h.id}`));
    if (ev.type === "gain" && ev.p === 0) out.push(...new Set(ev.slots.map((s) => `pile-${resourceOf(s)}`)));
    if (ev.type === "steal" && ev.thief === 0) out.push(`pile-${resourceOf(ev.slot)}`);
    if (ev.type === "bank" && ev.p === 0) out.push(`pile-${resourceOf(ev.got)}`);
    if (ev.type === "buy" && ev.p === 0) out.push(devKind(ev.slot));
  }
  return out;
}

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// The game's table, as in main.js: the players along the top, the island,
// the bank, the controls for your move and your hand. Tap a glowing spot (or
// Tab to it, the arrow keys between spots, Enter or Space), the buttons, or
// R to roll, E to end your turn and Esc to step back. Everything moves and
// sounds as it does in the game.
export function board() {
  const table = cardTable({ prefix: "hx", play: sound, animate: () => {}, done: () => {} });
  const { live, wait } = table;
  let state = null;
  let view = null; // the table as drawn
  let moving = false;
  let current = null; // the event being played out
  let mode = null; // in your main phase: null, "road", "settlement", "city" or "trade"
  let robberPick = null;
  let give = -1;
  let get = -1;
  let fresh = zero();
  let lastSettlement = SEATS.map(() => -1);
  let moveFn = () => {};

  const art = hexTable(table, { onSpot: (kind, id) => chooseSpot(kind, id), onSpotFocus: () => {} });
  art.setBoard(BOARD);

  // A ring round each lit corner, path or hex, under the spots so they stay tappable.
  const NS = "http://www.w3.org/2000/svg";
  const ringLayer = document.createElementNS(NS, "g");
  ringLayer.setAttribute("class", "hx-layer-tut");
  ringLayer.setAttribute("aria-hidden", "true");
  ringLayer.setAttribute("pointer-events", "none");
  art.svg.querySelector(".hx-layer-spots").before(ringLayer);
  const rings = new Map();
  function ring(c) {
    if (rings.has(c)) return rings.get(c);
    const id = Number(c.slice(1));
    const node = document.createElementNS(NS, c[0] === "h" ? "path" : c[0] === "e" ? "rect" : "circle");
    node.setAttribute("class", "tut-ring");
    if (c[0] === "c") {
      node.setAttribute("cx", (CORNERS[id].x * 100).toFixed(1));
      node.setAttribute("cy", (CORNERS[id].y * 100).toFixed(1));
      node.setAttribute("r", "36");
    } else if (c[0] === "e") {
      const e = EDGES[id];
      const a = CORNERS[e.a];
      const b = CORNERS[e.b];
      Object.entries({ x: -44, y: -17, width: 88, height: 34, rx: 17 }).forEach(([k, v]) => node.setAttribute(k, v));
      node.setAttribute("transform", `translate(${(e.x * 100).toFixed(1)} ${(e.y * 100).toFixed(1)}) rotate(${((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toFixed(1)})`);
    } else {
      const h = HEXES[id];
      node.setAttribute("d", `M${Array.from({ length: 6 }, (_, i) => {
        const t = (Math.PI / 3) * i - Math.PI / 2;
        return `${((h.x + Math.cos(t) * 0.8) * 100).toFixed(1)} ${((h.y + Math.sin(t) * 0.8) * 100).toFixed(1)}`;
      }).join("L")}Z`);
    }
    ringLayer.append(node);
    rings.set(c, node);
    return node;
  }

  // ---------- the players ----------
  const notes = SEATS.map(() => el("span", { class: "hx-note" }));
  const pills = SEATS.map((p) =>
    el(
      "span",
      { class: `pb-who ${p ? "theirs" : "mine"} p-${p}` },
      el("span", { class: "pb-badge" }, el("span", { class: "dot", "aria-hidden": "true" })),
      el("span", { class: "pb-label" }, el("span", { class: "pb-name" }, NAMES[p]), el("small", { class: "pb-note" }, notes[p])),
    ),
  );
  const scores = SEATS.map(() => el("dd"));
  const bar = el(
    "div",
    { class: "player-bar many" },
    el("div", { class: "pb-top" }, el("div", { class: "pb-players" }, pills)),
    el("dl", { class: "pb-score", "aria-label": "Points" }, SEATS.map((p) => el("div", { class: `${p ? "theirs" : "mine"} p-${p}` }, el("dt", {}, NAMES[p]), scores[p]))),
  );

  // ---------- the controls, made once so a lit one stays lit ----------
  const btn = (id, label, onclick, cls = "") => el("button", { class: `btn ${cls}`, type: "button", id, onclick: () => !moving && onclick() }, label);
  const titleText = el("strong");
  const titleSmall = el("small");
  const title = el("div", { class: "hx-panel-title" }, titleText, titleSmall);
  const rollBtn = btn("hx-roll", "Roll the dice", () => roll(), "primary big");
  rollBtn.setAttribute("aria-label", "Roll the dice (R)");
  const knightBtn = btn("hx-knight-first", "Play a knight first", () => playDev(knightSlot()));
  const rollRow = el("div", { class: "hx-row" }, rollBtn, knightBtn);
  const builds = Object.fromEntries(["road", "settlement", "city", "dev"].map((kind) => [kind, btn(`hx-build-${kind}`, "", () => (kind === "dev" ? buy() : setMode(kind)), "hx-build")]));
  const buildGrid = el("div", { class: "hx-builds", role: "group", "aria-label": "Build" }, Object.values(builds));
  const tradeBtn = btn("hx-trade", "Trade…", () => setMode("trade"));
  tradeBtn.setAttribute("aria-label", "Trade with the bank");
  const endBtn = btn("hx-end", "End turn", () => endTurn(), "primary");
  endBtn.setAttribute("aria-label", "End turn (E)");
  const mainRow = el("div", { class: "hx-row" }, tradeBtn, endBtn);
  const costRow = el("div", { class: "hx-row" });
  const cancelBtn = btn("hx-cancel", "Cancel", () => setMode(null), "small");
  cancelBtn.setAttribute("aria-label", "Cancel (Esc)");
  const resButton = (name, r, onPick) => {
    const note = el("small", { class: "mono" });
    const b = btn(`hx-bank-${name}-${r}`, "", () => onPick(r), `hx-res-btn r-${r}`);
    b.append(glyphEl(r), el("span", { class: "hx-res-name" }, RES_NAMES[r]), note);
    return { b, note };
  };
  const gives = RESOURCES.map((r) => resButton("give", r, (x) => ((give = x), get === x && (get = -1), draw())));
  const gets = RESOURCES.map((r) => resButton("take", r, (x) => ((get = x), draw())));
  const swapBtn = btn("hx-bank-trade", "", () => bankTrade(), "primary");
  const backBtn = btn("hx-back", "Back", () => setMode(null));
  const tradeParts = [
    el("div", { class: "hx-res-buttons", role: "group", "aria-label": "Give" }, gives.map((x) => x.b)),
    el("p", { class: "hx-arrow", "aria-hidden": "true" }, "for"),
    el("div", { class: "hx-res-buttons", role: "group", "aria-label": "Get" }, gets.map((x) => x.b)),
    el("div", { class: "hx-row" }, swapBtn, backBtn),
    el("p", { class: "hx-panel-hint" }, "Four of a kind for one, or better at your harbours."),
  ];
  const victimsRow = el("div", { class: "hx-row hx-victims" });
  const hint = el("p", { class: "hx-panel-hint" });
  const panel = el("div", { class: "hx-panel", id: "hx-panel" }, title, rollRow, buildGrid, costRow, mainRow, ...tradeParts, victimsRow, hint);
  const actions = el("section", { class: "hx-actions", id: "hx-actions", "aria-label": "Your move" }, panel);

  const node = el(
    "div",
    { class: "hexlands pc-game", dataset: { you: "a", seat: 0 } },
    bar,
    el("div", { class: "hx-main" }, el("div", { class: "hx-board-col" }, art.boardWrap), art.bankBox, actions, el("section", { class: "hx-hand-box", "aria-label": "Your cards" }, art.handBox)),
    table.flyLayer,
  );
  new ResizeObserver(() => art.svg.classList.toggle("hx-narrow", art.svg.getBoundingClientRect().width < 420)).observe(art.boardWrap);

  // ---------- the table as drawn ----------
  const viewOf = (st) => ({
    turn: st.turn,
    buildings: st.buildings.map((b) => b && { ...b }),
    roads: st.roads.slice(),
    robber: st.robber,
    hands: st.hands.map((h) => h.slice()),
    devs: st.devs.map((d) => d.slice()),
    knights: st.knights.slice(),
    shown: st.shown.map((s) => s.slice()),
    longest: { ...st.longest },
    army: { ...st.army },
    bank: st.bank.map((b) => b.length),
    devPile: st.devPile.length,
    dice: st.dice ? st.dice.slice() : null,
  });
  function shownPoints(p) {
    let n = 0;
    for (const b of view.buildings) if (b?.p === p) n += b.city ? 2 : 1;
    if (view.longest.p === p) n += 2;
    if (view.army.p === p) n += 2;
    return n + view.shown[p].filter((f) => devKind(f) === "vp").length;
  }

  // Your decision now (the phase), or null.
  function choice() {
    if (moving || !state || state.winner !== -1) return null;
    const step = movers(state);
    return (step.length ? step.includes(0) : state.turn === 0) ? state.phase : null;
  }
  const have = () => counts(state.hands[0], face);
  const knightSlot = () => playable(state, 0, face).find((s) => devKind(s) === "knight");

  // ---------- your moves ----------
  const send = (move) => moveFn(move);
  function chooseSpot(kind, id) {
    const c = choice();
    if (!c) return;
    if (c === "setup") return send(kind === "corner" ? { settle: id } : { road: id });
    if (c === "robber") {
      const vs = victims(state, id, 0);
      if (vs.length > 1) {
        robberPick = id;
        draw();
        return victimsRow.querySelector("button")?.focus();
      }
      return send({ robber: id, steal: vs[0] ?? -1 });
    }
    if (c !== "main") return;
    if (state.freeRoads) return send({ road: id });
    const pay = payment(state.hands[0], face, COSTS[mode]) ?? undefined;
    if (mode === "road") send({ road: id, pay });
    else if (mode === "settlement") send({ settle: id, pay });
    else if (mode === "city") send({ city: id, pay });
  }
  function setMode(next) {
    mode = mode === next ? null : next;
    robberPick = null;
    give = get = -1;
    draw();
    if (mode === "road" || mode === "settlement" || mode === "city") art.focusSpots();
    else if (mode === "trade") gives.find((x) => !x.b.disabled)?.b.focus();
  }
  const roll = () => choice() === "roll" && send({ roll: true });
  const endTurn = () => choice() === "main" && !state.freeRoads && send({ end: true });
  const buy = () => choice() === "main" && send({ buy: true, pay: payment(state.hands[0], face, COSTS.dev) ?? undefined });
  function playDev(slot) {
    const c = choice();
    if (slot === undefined || (c !== "main" && c !== "roll")) return;
    send({ play: slot });
  }
  function bankTrade() {
    if (choice() !== "main" || give < 0 || get < 0) return;
    send({ bank: state.hands[0].filter((s) => resourceOf(s) === give).slice(0, tradeRate(state, 0, give)), take: get });
  }
  // R rolls, E ends your turn, Esc steps back.
  addEventListener("keydown", (e) => {
    if (!node.isConnected || e.target.closest?.("input, textarea") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const key = e.key.toLowerCase();
    if (e.key === "Escape" && (mode || robberPick !== null)) {
      mode = null;
      robberPick = null;
      draw();
    } else if (key === "r" && !e.target.closest?.("button")) roll();
    else if (key === "e" && !e.target.closest?.("button")) endTurn();
  });

  // ---------- drawing ----------
  function drawBar() {
    SEATS.forEach((p) => {
      pills[p].classList.toggle("active", (current?.p ?? view.turn) === p);
      scores[p].textContent = String(shownPoints(p));
      const n = view.hands[p].length;
      const d = view.devs[p].length;
      const parts = [["cards", n, plural(n, "card")], ["devs", d, plural(d, "development card")]];
      if (view.knights[p]) parts.push(["knights", view.knights[p], plural(view.knights[p], "knight")]);
      const label = [...parts.map((x) => x[2]), view.longest.p === p ? "longest road" : "", view.army.p === p ? "largest army" : ""].filter(Boolean).join(", ");
      if (notes[p].dataset.key === label) return;
      notes[p].dataset.key = label;
      notes[p].setAttribute("aria-label", label);
      notes[p].replaceChildren(
        ...parts.map(([kind, v]) => el("span", { class: `hx-n ${kind}`, "aria-hidden": "true" }, el("i", {}), String(v))),
        view.longest.p === p ? el("span", { class: "hx-award road", title: `Longest road (${view.longest.size})`, "aria-hidden": "true" }) : "",
        view.army.p === p ? el("span", { class: "hx-award army", title: `Largest army (${view.army.size})`, "aria-hidden": "true" }) : "",
      );
    });
  }

  function drawSpots() {
    const c = choice();
    const words = { corner: (id) => cornerWords(BOARD, id), edge: (id) => edgeWords(BOARD, id) };
    const edges = (label) => ({ kind: "edge", ids: legalEdges(state, 0), ghost: (e) => roadSvg(e, 0), words: words.edge, label });
    const corners = { kind: "corner", ids: legalCorners(state, 0), ghost: (id) => settlementSvg(id, 0), words: words.corner, label: "Corners for a settlement" };
    let spec = null;
    if (c === "setup") spec = state.setup.corner === -1 ? corners : edges("Paths for a road");
    else if (c === "robber") spec = { kind: "hex", ids: robberPick === null ? robberHexes(state) : [robberPick], chosen: robberPick, ghost: robberPick === null ? robberSvg : null, words: hexSpotWords, label: "Hexes for the robber" };
    else if (c === "main" && (state.freeRoads || mode === "road")) spec = edges("Paths for a road");
    else if (c === "main" && mode === "settlement") spec = corners;
    else if (c === "main" && mode === "city") spec = { kind: "corner", ids: legalCities(state, 0), ghost: (id) => citySvg(id, 0), words: (id) => `your settlement, ${cornerWords(BOARD, id)}`, label: "Settlements to make a city" };
    art.drawSpots(spec?.kind ?? null, spec?.ids ?? [], spec ?? {});
  }
  function hexSpotWords(hex) {
    const who = [...new Set(HEXES[hex].corners.map((c) => state.buildings[c]?.p).filter((p) => p !== undefined))];
    return `${hexWords(BOARD, hex)}${who.length ? `, with ${listOf(who.map((p) => (p ? NAMES[p] : "you")))}` : ""}`;
  }

  function drawHand() {
    const devs = view.devs[0].map((slot) => ({ slot, kind: devKind(slot), isNew: state.bought.includes(slot), playable: !moving && !mode && playable(state, 0, face).includes(slot) }));
    const c = counts(view.hands[0], face);
    art.drawHand({ counts: c, fresh: fresh.map((n, r) => Math.min(n, c[r])), devs, onDev: (slot) => !moving && playDev(slot) });
  }

  // Shows the controls for the decision at hand, hiding the rest.
  function show(...parts) {
    for (const part of [rollRow, buildGrid, costRow, mainRow, ...tradeParts, victimsRow, hint]) part.hidden = !parts.includes(part);
  }
  function setTitle(text, small = "") {
    titleText.textContent = text;
    titleSmall.textContent = small;
    titleSmall.hidden = !small;
  }
  function describe(ev) {
    const who = (p) => NAMES[p];
    if (!ev) return null;
    if (ev.type === "roll") return `${who(ev.p)} ${ev.p ? "rolls" : "roll"}…`;
    if (ev.type === "produce") return `${ev.roll}! The bank pays out.`;
    if (ev.type === "robber") return `${who(ev.p)} ${ev.p ? "moves" : "move"} the robber.`;
    if (ev.type === "steal") return `You steal from ${who(ev.victim)}.`;
    if (ev.type === "play") return `You play ${ev.kind === "knight" ? "a knight" : DEV_NAMES[ev.kind].toLowerCase()}!`;
    if (ev.type === "over") return "Ten points: you win!";
    return null;
  }

  function drawPanel() {
    const c = choice();
    actions.hidden = false;
    node.classList.toggle("my-turn", !!c);
    if (!c) {
      const turn = current?.p ?? view.turn;
      setTitle(describe(current) ?? (state.winner === 0 ? "Ten points: you win!" : turn ? `${NAMES[turn]}'s turn` : "Your turn"));
      return show();
    }
    if (c === "setup") {
      const first = state.setup.i < state.players;
      if (state.setup.corner === -1) setTitle(first ? "Place your first settlement" : "Place your second settlement", first ? "Then a road next to it." : "It collects a card from each land it touches.");
      else setTitle("Place a road", "Next to the settlement you just placed.");
      hint.textContent = state.setup.corner === -1 ? "Tap a glowing corner. More dots under a number means it's rolled more often." : "Tap a glowing path.";
      return show(hint);
    }
    if (c === "roll") {
      setTitle("Your turn");
      knightBtn.hidden = knightSlot() === undefined;
      return show(rollRow);
    }
    if (c === "robber") {
      if (robberPick === null) {
        setTitle("Move the robber", "Tap a hex: it stops paying until the robber moves on, and you steal a card from someone there.");
        return show();
      }
      setTitle("Steal from…", hexWords(BOARD, robberPick));
      victimsRow.replaceChildren(
        ...victims(state, robberPick, 0).map((p) => btn(`hx-victim-${p}`, "", () => send({ robber: robberPick, steal: p }), `hx-victim p-${p}`)),
      );
      for (const b of victimsRow.children) {
        const p = Number(b.id.split("-").pop());
        b.append(el("span", { class: "dot", "aria-hidden": "true" }), el("span", {}, NAMES[p]), el("small", { class: "mono" }, plural(view.hands[p].length, "card")));
      }
      return show(victimsRow);
    }
    // Your main phase: build, trade or end your turn.
    const own = have();
    if (mode === "road" || mode === "settlement" || mode === "city") {
      setTitle(`Build a ${BUILD_NAMES[mode]}`, mode === "city" ? "Tap one of your settlements to make it a city." : `Tap a glowing ${mode === "road" ? "path" : "corner"}.`);
      costRow.replaceChildren(cardsRow(COSTS[mode], { have: own }), cancelBtn);
      return show(costRow);
    }
    if (mode === "trade") {
      const rate = (r) => tradeRate(state, 0, r);
      setTitle("Trade with the bank");
      gives.forEach(({ b, note }, r) => {
        b.disabled = own[r] < rate(r);
        b.classList.toggle("on", give === r);
        note.textContent = `${rate(r)}:1`;
        b.setAttribute("aria-label", `Give ${RES_NAMES[r]}, ${rate(r)}:1${give === r ? ", chosen" : ""}`);
      });
      gets.forEach(({ b, note }, r) => {
        b.disabled = r === give || !state.bank[r].length;
        b.classList.toggle("on", get === r);
        note.textContent = state.bank[r].length ? "" : "none";
        b.setAttribute("aria-label", `Get ${RES_NAMES[r]}${get === r ? ", chosen" : ""}`);
      });
      const ready = give >= 0 && get >= 0;
      swapBtn.disabled = !ready;
      swapBtn.textContent = ready ? `Trade ${rate(give)} ${RES_NAMES[give]} for 1 ${RES_NAMES[get]}` : "Pick what to give and get";
      return show(...tradeParts);
    }
    setTitle("Your turn", "Build, trade, play a development card, or end your turn.");
    const left = { road: state.pieces[0].roads, settlement: state.pieces[0].settlements, city: state.pieces[0].cities, dev: state.devPile.length };
    const spots = { road: () => legalEdges(state, 0).length, settlement: () => legalCorners(state, 0).length, city: () => legalCities(state, 0).length, dev: () => 1 };
    for (const [kind, b] of Object.entries(builds)) {
      const afford = !!payment(state.hands[0], face, COSTS[kind]);
      const why = !left[kind] ? "none left" : !afford ? "not enough cards" : !spots[kind]() ? "nowhere to build" : "";
      const name = { road: "Road", settlement: "Settlement", city: "City", dev: "Development card" }[kind];
      const label = `${kind === "dev" ? "Buy a development card" : `Build a ${kind}`}: costs ${countWords(COSTS[kind])}${why ? `, ${why}` : ""}`;
      b.disabled = !!why;
      b.classList.toggle("can", !why);
      b.setAttribute("aria-label", label);
      b.title = label;
      b.replaceChildren(el("span", { class: "hx-build-name" }, name), cardsRow(COSTS[kind], { have: own }), el("small", { class: "hx-left mono" }, kind === "dev" ? `${left.dev} in the pile` : `${left[kind]} left`));
    }
    show(buildGrid, mainRow);
  }

  function draw() {
    art.drawPieces(view);
    art.drawDice(view.dice, { dim: !!state && state.phase !== "roll" && state.phase !== "main" && current?.type !== "roll" });
    art.drawBank(view.bank, view.devPile);
    drawBar();
    drawHand();
    drawSpots();
    drawPanel();
  }

  // ---------- motion: main.js's, for the events a lesson has ----------
  const rectOf = (n) => (n ? table.rectIn(n) : null);
  const seatRect = (p) => (p === 0 ? rectOf(art.handBox) : rectOf(pills[p]));
  const resRect = (p, r) => (p === 0 && r >= 0 ? art.pileRect(r) : seatRect(p));
  const devRect = (p) => (p === 0 ? rectOf(art.handBox.querySelector(".hx-dev-row:not([hidden])") ?? art.handBox) : seatRect(p));
  const gainFresh = (p, slots) => p === 0 && slots.forEach((s) => fresh[resourceOf(s)]++);

  async function spend(p, slots, g) {
    if (!slots?.length) return;
    const keys = slots.map(resourceOf);
    view.hands[p] = view.hands[p].filter((s) => !slots.includes(s));
    draw();
    await art.flyMany(keys, (i) => resRect(p, keys[i]), (i) => art.bankChipRect(keys[i]), { g, ms: PACE.fly * 0.8, gap: 50 });
    keys.forEach((r) => view.bank[r]++);
  }
  async function collect(p, slots, from, g) {
    const keys = slots.map(resourceOf);
    await art.flyMany(keys, from ?? ((i) => art.bankChipRect(keys[i])), (i) => resRect(p, keys[i]), { g });
    if (!live(g)) return;
    keys.forEach((r) => (view.bank[r] = Math.max(0, view.bank[r] - 1)));
    view.hands[p].push(...slots);
    gainFresh(p, slots);
    draw();
  }
  function joinedEnd(edge, p) {
    const e = EDGES[edge];
    const own = (c) => view.buildings[c]?.p === p || CORNERS[c].edges.some((o) => o !== edge && view.roads[o] === p);
    return own(e.a) ? e.a : e.b;
  }

  async function animate(ev, g) {
    current = ev;
    if (ev.type === "build") {
      const from = ev.kind === "road" ? joinedEnd(ev.at, ev.p) : -1;
      if (!ev.free) await spend(ev.p, ev.pay, g);
      if (!live(g)) return;
      if (ev.kind === "road") view.roads[ev.at] = ev.p;
      else view.buildings[ev.at] = { p: ev.p, city: ev.kind === "city" };
      if (ev.kind === "settlement") lastSettlement[ev.p] = ev.at;
      draw();
      sound(`build-${ev.kind}`);
      if (ev.kind === "road") art.growRoad(ev.at, from, { g });
      else art.popBuilding(ev.at, { g });
      await wait(ev.kind === "road" ? PACE.road : PACE.build, g);
    } else if (ev.type === "gain") {
      const corner = lastSettlement[ev.p];
      const from = (i) => {
        const hex = CORNERS[corner]?.hexes.find((h) => BOARD.terrain[h] === resourceOf(ev.slots[i]) && BOARD.terrain[h] !== DESERT);
        return hex === undefined ? art.centreRect() : art.hexRect(hex);
      };
      ev.slots.forEach((s) => sound("gain", { r: resourceOf(s) }));
      await collect(ev.p, ev.slots, from, g);
    } else if (ev.type === "roll") {
      fresh = zero();
      sound("roll");
      draw();
      await art.rollDice(ev.dice, { g });
      if (!live(g)) return;
      view.dice = ev.dice.slice();
      if (ev.dice[0] + ev.dice[1] === 7) art.say(art.boardWrap, ev.p, "Seven!", g);
    } else if (ev.type === "produce") {
      const hexes = HEXES.filter((h) => BOARD.numbers[h.id] === ev.roll).map((h) => h.id);
      art.glowHexes(hexes.filter((h) => h !== view.robber), { g });
      art.glowHexes(hexes.filter((h) => h === view.robber), { g, cls: "blocked" });
      await wait(PACE.glow * 0.45, g);
      let i = 0;
      const jobs = production(BOARD, view.robber, view.buildings, ev.roll, ev.short).flatMap((f) =>
        Array.from({ length: f.n }, () => wait(i++ * PACE.flyGap, g).then(() => (sound("gain", { r: f.r }), art.flyCard(f.r, art.hexRect(f.hex), resRect(f.p, f.r), { g })))),
      );
      await Promise.all(jobs);
      if (!live(g)) return;
      ev.gains.forEach((slots, p) => {
        slots.forEach((s) => (view.bank[resourceOf(s)] = Math.max(0, view.bank[resourceOf(s)] - 1)));
        view.hands[p].push(...slots);
        gainFresh(p, slots);
      });
      draw();
    } else if (ev.type === "robber") {
      const from = view.robber;
      view.robber = ev.hex;
      draw();
      sound("robber");
      await art.hopRobber(from, ev.hex, { g });
    } else if (ev.type === "steal") {
      view.hands[ev.victim] = view.hands[ev.victim].filter((s) => s !== ev.slot);
      draw();
      sound("steal");
      const r = resourceOf(ev.slot);
      const victimAt = HEXES[view.robber].corners.find((c) => view.buildings[c]?.p === ev.victim);
      await art.flyCard(ev.thief === 0 ? r : "back", victimAt === undefined ? seatRect(ev.victim) : art.cornerRect(victimAt), resRect(ev.thief, r), { g, ms: PACE.steal, fade: ev.thief !== 0 });
      if (!live(g)) return;
      view.hands[ev.thief].push(ev.slot);
      gainFresh(ev.thief, [ev.slot]);
      draw();
    } else if (ev.type === "buy") {
      await spend(ev.p, ev.pay, g);
      if (!live(g)) return;
      sound("buy");
      view.devPile = Math.max(0, view.devPile - 1);
      await art.flyCard(ev.p === 0 ? devKind(ev.slot) : "back", art.bankChipRect("dev"), devRect(ev.p), { g, fade: ev.p !== 0 });
      if (!live(g)) return;
      view.devs[ev.p].push(ev.slot);
      draw();
    } else if (ev.type === "play") {
      view.devs[ev.p] = view.devs[ev.p].filter((s) => s !== ev.slot);
      view.shown[ev.p].push(ev.slot);
      if (ev.kind === "knight") view.knights[ev.p]++;
      draw();
      sound(ev.kind === "knight" ? "knight" : "progress");
      await art.moment({ text: DEV_NAMES[ev.kind], p: ev.p, card: ev.kind, from: devRect(ev.p), g });
    } else if (ev.type === "bank") {
      sound("trade");
      await spend(ev.p, ev.gave, g);
      if (!live(g)) return;
      await collect(ev.p, [ev.got], null, g);
    } else if (ev.type === "longest" || ev.type === "army") {
      const longest = ev.type === "longest";
      view[longest ? "longest" : "army"] = { p: ev.p, size: ev.size };
      if (ev.p >= 0) {
        sound(longest ? "longest" : "army");
        await art.moment({ text: longest ? `Longest road (${ev.size})` : `Largest army (${ev.size})`, p: ev.p, g });
      }
    } else if (ev.type === "turn") {
      view.turn = ev.p;
      fresh = zero();
    } else if (ev.type === "over") {
      await art.moment({ text: "Ten points!", p: ev.winner, g });
    }
    current = null;
    await wait(PACE.between, g);
  }

  return {
    node,
    cell(c) {
      if (/^[ceh]\d+$/.test(c)) return ring(c);
      if (builds[c]) return builds[c];
      if (c === "roll") return rollBtn;
      if (c === "end") return endBtn;
      if (c === "trade") return mode === "trade" ? panel : tradeBtn;
      if (c === "swap") return swapBtn;
      if (c.startsWith("give-")) return gives[Number(c.slice(5))].b;
      if (c.startsWith("take-")) return gets[Number(c.slice(5))].b;
      if (c.startsWith("pile-")) return art.handBox.querySelector(`.hx-pile.r-${c.slice(5)}`);
      return art.handBox.querySelector(`.hx-dev[data-kind="${c}"]`) ?? art.handBox;
    },
    onMove: (fn) => (moveFn = fn),
    async render(st, played) {
      if (st !== state) {
        mode = null;
        robberPick = null;
        give = get = -1;
      }
      if (!played) {
        if (st !== state) fresh = zero();
        table.stop();
        state = st;
        moving = false;
        current = null;
        view = viewOf(st);
        return draw();
      }
      state = st;
      const g = table.gen;
      moving = true;
      draw();
      for (const ev of played) {
        await animate(ev, g);
        if (!live(g)) return;
      }
      moving = false;
      view = viewOf(st);
      draw();
      if (played.some((ev) => ev.type === "turn" && ev.p === 0)) sound("turn");
    },
    // As in the game: a refusal, and the control or spot shakes.
    reject(move) {
      sound("nope");
      if (still()) return;
      const spot = move.settle ?? move.city ?? move.road ?? move.robber;
      const kind = move.robber !== undefined ? "hex" : move.road !== undefined ? "edge" : "corner";
      const target = spot !== undefined ? art.svg.querySelector(`.hx-spot[data-${kind}="${spot}"] .hx-spot-mark`) : move.roll ? rollBtn : move.end ? endBtn : move.buy ? builds.dev : move.bank ? swapBtn : null;
      table.shake(target);
    },
  };
}
