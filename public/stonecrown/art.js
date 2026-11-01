// What the Stonecrown view (main.js) shares with its tutorial: the pace of
// its motion, the words a screen reader hears for cards, costs, purchases,
// wars and scores, the choices a card in your hand offers, and the table:
// the neighbours' panels, your wonder and city, your hand, and how they
// move: picks flip together, built cards fly into cities, stages tuck under
// a wonder, coins fly, hands slide round, the war and the score sheet. The
// art itself comes from card-art.js and pieces.js.
import { el } from "../engine/shell.js";
import { thinkingDots } from "../engine/players.js";
import { easing } from "../engine/cards/table.js";
import { CARDS, WONDERS, COLORS, RESOURCE_NAMES, SYMBOLS, RAW, GOODS, DISCARD_COINS, VICTORY, HAND } from "./cards.js";
import { stagesOf, canBuild, canStage, production, shields, sideCoins, leftOf, rightOf, ROUNDS } from "./rules.js";
import { cardSvg, cardBack, cardText, effectIcon, resourceIcon, scienceIcon, coinIcon, shieldIcon, pointsIcon, neighbourIcon, colourIcon } from "./card-art.js";
import { wonderSvg, wonderMini, coinSvg, tokenSvg, tableSvg } from "./pieces.js";

// The motion curve, read from the theme once rather than for every flight.
let curve = null;
const easeOut = () => (curve ??= easing("out"));

export const PACE = { fly: 620, flip: 420, flyGap: 70, coin: 520, pass: 520, deal: 300, dealGap: 45, stage: 520, war: 520, warGap: 360, row: 380, between: 140, bubble: 900 };
export const ROMAN = ["", "I", "II", "III", "IV"];
export const RES_NAMES = RESOURCE_NAMES;
export const SCI_NAMES = SYMBOLS;
// A colour's group in a city, as the score sheet and the panels name it.
export const COLOR_NAMES = { brown: "raw materials", grey: "goods", blue: "civic", yellow: "commerce", red: "military", green: "science", purple: "guilds" };
export const SCORE_ROWS = [
  ["military", "Military", "tokens"],
  ["coins", "Coins", "1 per 3"],
  ["wonder", "Wonder", "stages"],
  ["civic", "Civic", "blue cards"],
  ["commerce", "Commerce", "yellow cards"],
  ["guilds", "Guilds", "purple cards"],
  ["science", "Science", "sets and symbols"],
  ["total", "Total", ""],
];

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const listOf = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const signed = (n) => (n < 0 ? `−${-n}` : `+${n}`);

// ---------- words ----------
// "2 wood and 1 stone" from 7 counts.
export const resourceWords = (counts) => listOf(counts.flatMap((n, r) => (n ? [`${n} ${RES_NAMES[r]}`] : []))) || "nothing";
// "2 wood, 1 stone and 1 coin", or "free".
export function costWords(cost) {
  const parts = cost.res.flatMap((n, r) => (n ? [`${n} ${RES_NAMES[r]}`] : []));
  if (cost.coins) parts.push(plural(cost.coins, "coin"));
  return parts.length ? listOf(parts) : "free";
}
const orWords = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`);
const kindWords = (kinds) => (kinds.length === RAW.length && RAW.every((r) => kinds.includes(r)) ? "raw materials" : kinds.length === GOODS.length && GOODS.every((r) => kinds.includes(r)) ? "goods" : listOf(kinds.map((r) => RES_NAMES[r])));
const sidesWords = (sides) => (sides.length === 2 ? "either neighbour" : `your ${sides[0]} neighbour`);
function fromWords(from) {
  const self = from.includes("self");
  const both = from.includes("left") && from.includes("right");
  const one = from.find((s) => s !== "self");
  if (self && both) return "in your city and your neighbours'";
  if (self && !one) return "in your city";
  if (both) return "in your neighbours' cities";
  return self ? `in your city and your ${one} neighbour's` : `in your ${one} neighbour's city`;
}
function perWords(per, from) {
  if (per === "stage") return from.length === 1 && from[0] === "self" ? "stage of your wonder" : "wonder stage built";
  if (per === "defeat") return "defeat token";
  return `${Array.isArray(per) ? listOf(per) : per} card`;
}
// "makes wood or clay", "2 points", "a star"…: one card's or wonder stage's effect.
export function effectWords(x) {
  const parts = [];
  if (x.produce) {
    const units = x.produce;
    const single = units.every((u) => u.length === 1);
    if (single) parts.push(`makes ${resourceWords(RES_NAMES.map((_, r) => units.filter((u) => u[0] === r).length))}`);
    else parts.push(`makes ${listOf(units.map((u) => orWords(u.map((r) => RES_NAMES[r]))))}${x.color ? "" : " (not for sale)"}`);
    if (!single && x.color) parts[parts.length - 1] += ", one a turn";
  }
  if (x.points) parts.push(plural(x.points, "point"));
  if (x.shields) parts.push(plural(x.shields, "shield"));
  if (x.science !== undefined) parts.push(x.science === "any" ? "any science symbol, whichever scores best" : `a ${SCI_NAMES[x.science]}`);
  if (x.gold) parts.push(`${plural(x.gold, "coin")} at once`);
  if (x.trade) parts.push(`buy ${kindWords(x.trade.kinds)} from ${sidesWords(x.trade.sides)} for 1 coin a unit`);
  if (x.income && x.score && x.income.per === x.score.per && x.income.from.join() === x.score.from.join()) {
    parts.push(`${plural(x.income.coins, "coin")} now and ${plural(x.score.points, "point")} at the end for each ${perWords(x.income.per, x.income.from)}${x.income.per === "stage" && x.income.from.join() === "self" ? "" : ` ${fromWords(x.income.from)}`}`);
  } else {
    if (x.income) parts.push(`${plural(x.income.coins, "coin")} now for each ${perWords(x.income.per, x.income.from)} ${fromWords(x.income.from)}`);
    if (x.score) parts.push(`${plural(x.score.points, "point")} at the end for each ${perWords(x.score.per, x.score.from)} ${fromWords(x.score.from)}`);
  }
  if (x.dig) parts.push("build one card from the discards free");
  if (x.free) parts.push("build one card free each age");
  if (x.copyGuild) parts.push("copy a neighbour's guild at the end");
  if (x.playLast) parts.push("play the seventh card of each age");
  return listOf(parts) || "nothing";
}

// The cards an earlier card builds free (by key), and the ones that build it.
export const chainsTo = (card) => [...new Set(CARDS.filter((c) => c.from.includes(card.key)).map((c) => c.name))];
export const chainsFrom = (card) => [...new Set(card.from.map((k) => CARDS.find((c) => c.key === k)?.name).filter(Boolean))];

// A card in words (card-art.js): its name, age, colour, cost, effect and chains.
export const cardWords = (id) => (CARDS[id] ? cardText(id) : "a card");

export function stageWords(stage, n) {
  return `Stage ${ROMAN[n + 1]}: ${effectWords(stage)}. Costs ${costWords(stage.cost)}.`;
}

// "Pay 2 to Ana, 1 to Ben" for coins to the bank and to each neighbour; "" for nothing.
export function payWords({ bank = 0, left = 0, right = 0 }, names) {
  const parts = [];
  if (bank) parts.push(`${bank} to the bank`);
  if (left) parts.push(`${left} to ${names.left}`);
  if (right) parts.push(`${right} to ${names.right}`);
  return parts.length ? `Pay ${parts.join(", ")}` : "";
}

// "Buy 2 stone from Juno", or "" when nothing is bought.
export function buyWords(buy, names) {
  const parts = ["left", "right"].filter((s) => sum(buy[s])).map((s) => `${resourceWords(buy[s])} from ${names[s]}`);
  return parts.length ? `Buy ${listOf(parts)}` : "";
}

// A move as the rules take it: the purchase only when something is bought.
export function moveFor(kind, slot, buy = null, free = false) {
  const m = { [kind]: slot };
  if (free) m.free = true;
  else if (buy && sum(buy.left) + sum(buy.right) > 0) m.buy = { left: buy.left.slice(), right: buy.right.slice() };
  return m;
}

// What a card in your hand offers: building it (paid, by a chain or with the
// free stage), the next wonder stage, or selling it. why: "duplicate",
// "coins" or "resources"; for a stage, also "built".
export function pickOptions(state, p, id) {
  const card = CARDS[id];
  const b = id >= 0 ? canBuild(state, p, id) : { ok: false, why: "unknown", chain: false, free: false, purchases: [] };
  const s = canStage(state, p);
  const stage = stagesOf(state, p)[s.n] ?? null;
  return {
    build: { ...b, coins: card?.cost.coins ?? 0 },
    // Building free with the stage when the card would cost something.
    free: b.free && !b.chain && b.why !== "duplicate",
    stage: { ...s, stage },
    sell: DISCARD_COINS,
  };
}

// The words on a refused option.
export const WHY = { duplicate: "Already built", coins: "Can't afford", resources: "Can't afford", built: "Wonder finished", unknown: "Not yet seen" };
export function whyWords(why, card = null) {
  if (why === "duplicate") return `You already have ${card?.name ?? "it"}`;
  if (why === "coins") return "Not enough coins";
  if (why === "resources") return "You and your neighbours can't make what it needs";
  if (why === "built") return "Your wonder is finished";
  return "";
}

// War, from your view: "War: you beat Ana (+3) and lost to Ben (−1)".
export function warWords(results, me, age, nameOf) {
  const won = VICTORY[age - 1];
  const n = results.length;
  const [l, r] = [(me + 1) % n, (me + n - 1) % n];
  const [a, b] = results[me];
  const both = `${nameOf(l)} and ${nameOf(r)}`;
  if (a === b) return `War: you ${a > 0 ? `beat ${both} (${signed(won)} each)` : a < 0 ? `lost to ${both} (−1 each)` : `drew with ${both}`}`;
  const one = (q, x) => (x > 0 ? `beat ${nameOf(q)} (${signed(won)})` : x < 0 ? `lost to ${nameOf(q)} (−1)` : `drew with ${nameOf(q)}`);
  return `War: you ${one(l, a)} and ${one(r, b)}`;
}
// Each neighbouring pair once: [p, its left neighbour, the result for p].
export const warPairs = (results) => results.map((r, p) => [p, (p + 1) % results.length, r[0]]);
export function pairWords([p, q, r], age, name) {
  const won = signed(VICTORY[age - 1]);
  if (!r) return `${name(p)} and ${name(q)} draw`;
  const [a, b] = r > 0 ? [p, q] : [q, p];
  return `${name(a)} ${name(a) === "You" ? "beat" : "beats"} ${name(b) === "You" ? "you" : name(b)} (${won})`;
}

// The headline once the game is scored: "You win!", "Ana wins on coins", "Shared win: Ana and Ben".
export function resultWords(scores, winners, me, nameOf) {
  const best = Math.max(...scores.map((s) => s.total));
  const tied = scores.filter((s) => s.total === best).length > 1;
  if (winners.length > 1) return `Shared win: ${listOf(winners.map((p) => (p === me ? "you" : nameOf(p))))}`;
  const w = winners[0];
  return `${w === me ? "You win" : `${nameOf(w)} wins`}${tied ? " on coins" : ""}${w === me ? "!" : ""}`;
}

// ---------- the table as the screen draws it ----------
// The state as it stood before the events still playing out; rules helpers
// that read cities, stages and coins read it too.
export const viewOf = (st) => ({
  players: st.players,
  age: st.age,
  round: st.round,
  phase: st.phase,
  wonders: st.wonders.map((w) => ({ ...w })),
  hands: st.hands.map((h) => h.slice()),
  city: st.city.map((c) => c.map((x) => ({ ...x }))),
  stages: st.stages.map((s) => s.slice()),
  coins: st.coins.slice(),
  tokens: st.tokens.map((t) => t.slice()),
  discard: st.discard.slice(),
  freeAge: st.freeAge.slice(),
  digger: st.digger,
  lastSeat: st.lastSeat,
});

// The seats round you: left (p + 1), right (p − 1) and, with four, across.
export const seatsAround = (players, me) => ({ left: (me + 1) % players, right: (me + players - 1) % players, across: players === 4 ? (me + 2) % 4 : -1 });

// A city's cards by colour, in the order of COLORS: [[ids], …].
export const cityColumns = (ids) => COLORS.map((c) => ids.filter((id) => CARDS[id].color === c));

// What a seat sells its neighbours: each unit a list of resources, alike ones counted: [{ unit, n }].
export function sells(view, p) {
  const out = [];
  for (const unit of production(view, p).sale) {
    const key = unit.join("/");
    const found = out.find((x) => x.key === key);
    if (found) found.n++;
    else out.push({ key, unit, n: 1 });
  }
  return out;
}

// A seat's public facts for its label: "4 coins, 2 shields, tokens +1 −1, wonder 1 of 3 stages, 6 cards".
export function seatWords(view, p) {
  const t = view.tokens[p];
  const total = stagesOf(view, p).length;
  return [plural(view.coins[p], "coin"), plural(shields(view, p), "shield"), t.length ? `war tokens ${t.map(signed).join(" ")}` : "no war tokens", `wonder ${view.stages[p].length} of ${total} stages`, plural(view.city[p].length, "card") + " built"].join(", ");
}

// The turn line: "Age II · Turn 3 of 6".
export const turnWords = (age, round) => (age ? `Age ${ROMAN[age]} · Turn ${Math.min(round, ROUNDS)} of ${ROUNDS}` : "");

// ---------- small pieces of art as elements ----------
// card-art.js and pieces.js return markup: a whole <svg>, or shapes for a 24-unit box.
export const svgOf = (markup) => (/^\s*<svg/.test(markup) ? markup : `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${markup}</svg>`);
// Markup is parsed once, then cloned: parsing the same art again each turn
// is most of what a busy age III costs a slow phone.
const parsed = new Map();
function svgNode(key, markup) {
  let t = parsed.get(key);
  if (!t) {
    t = document.createElement("template");
    t.innerHTML = svgOf(markup());
    parsed.set(key, t);
  }
  return t.content.cloneNode(true);
}
const art = (cls, markup) => {
  const node = el("span", { class: cls, "aria-hidden": "true" });
  node.append(svgNode(markup, () => markup));
  return node;
};
export const resEl = (r) => art(`sc-ic r-${r}`, resourceIcon(r));
export const sciEl = (s) => art(`sc-ic sci-${s}`, scienceIcon(s));
export const shieldEl = () => art("sc-ic shield", shieldIcon());
export const pointsEl = (n) => art("sc-ic points", pointsIcon(n));
export const coinEl = (n = null) => art("sc-ic coin", n === null ? coinIcon() : coinIcon(n));
export const tokenEl = (v) => art(`sc-tok ${v < 0 ? "defeat" : "victory"}`, tokenSvg(v));
export const coinPieceEl = (v) => art("sc-coin-piece", coinSvg(v));

// A seat's mark beside its colour, so no two seats differ by hue alone: none, dots, a stripe, a chevron.
export function seatMark(p) {
  const marks = ["", '<circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>', '<path d="M3 10h18v4H3z"/>', '<path d="M6 9l6 6 6-6" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'];
  const node = el("span", { class: `sc-mark p-${p}`, "aria-hidden": "true" });
  node.append(svgNode(`mark ${p}`, () => `<svg viewBox="0 0 24 24" focusable="false"><circle class="disc" cx="12" cy="12" r="11"/><g class="sign">${marks[p] ?? ""}</g></svg>`));
  return node;
}

const SEP = () => el("span", { class: "sc-or", "aria-hidden": "true" }, "/");
const sideEl = (side) => art(`sc-ic side ${side}`, neighbourIcon(side));
// A wonder stage's effect as icons, for the detail strip (a card's comes from effectIcon()).
export function effectEl(x) {
  if (x.id !== undefined && CARDS[x.id] === x) {
    const node = art("sc-fx sc-fx-card", effectIcon(x.id));
    // Its width follows its viewBox: an effect is one icon or a row of them.
    const [, , w, h] = (node.firstChild.getAttribute("viewBox") ?? "0 0 24 24").split(/\s+/).map(Number);
    node.style.setProperty("--w", String(w / h));
    return node;
  }
  const row = el("span", { class: "sc-fx", "aria-hidden": "true" });
  if (x.produce) x.produce.forEach((u, i) => {
    if (i && u.length > 1) row.append(el("span", { class: "sc-gap" }));
    u.forEach((r, j) => row.append(...(j ? [SEP()] : []), resEl(r)));
  });
  if (x.points) row.append(pointsEl(x.points));
  for (let i = 0; i < (x.shields ?? 0); i++) row.append(shieldEl());
  if (x.science === "any") row.append(sciEl("any"));
  else if (x.science !== undefined) row.append(sciEl(x.science));
  if (x.gold) row.append(coinEl(x.gold));
  if (x.trade) row.append(...x.trade.sides.filter((s) => s === "left").map(sideEl), resEl(x.trade.kinds[0]), el("span", { class: "sc-dots" }, "…"), coinEl(1), ...x.trade.sides.filter((s) => s === "right").map(sideEl));
  if (x.dig) row.append(el("span", { class: "sc-word" }, "dig"));
  if (x.free) row.append(el("span", { class: "sc-word" }, "free build"));
  if (x.copyGuild) row.append(art("sc-ic", colourIcon("purple")), el("span", { class: "sc-word" }, "copy"));
  if (x.playLast) row.append(el("span", { class: "sc-word" }, "7th card"));
  return row;
}

// A cost as icons: coins, then resources; "free" when nothing.
export function costEl(cost, { have = null } = {}) {
  const row = el("span", { class: "sc-cost", "aria-hidden": "true" });
  if (cost.coins) row.append(coinEl(cost.coins));
  cost.res.forEach((n, r) => {
    for (let i = 0; i < n; i++) {
      const icon = resEl(r);
      if (have && i >= have[r]) icon.classList.add("buy");
      row.append(icon);
    }
  });
  if (!row.childNodes.length) row.append(el("span", { class: "sc-free" }, "free"));
  return row;
}

// Wonder boards are big markup: each one drawn once per stage count and the
// ages of the cards tucked under them (their backs show the age).
const boards = new Map();
export function boardSvg(w, side, built, { mini = false, tucked = [] } = {}) {
  const key = mini ? `${w}:${side}:${built}:mini` : `${w}:${side}:${built}:${tucked.join("")}`;
  if (!boards.has(key)) boards.set(key, mini ? wonderMini(w, side, built) : wonderSvg(w, side, { built, tucked: tucked.length === built ? tucked : built }));
  return boards.get(key);
}
// The same board as nodes, to append.
export function boardEl(w, side, built, opts) {
  const markup = boardSvg(w, side, built, opts);
  return svgNode(markup, () => markup);
}
// The table behind everything: paper hills by day, an indigo sky by night.
export function tableEl() {
  const node = el("div", { class: "sc-table-bg", "aria-hidden": "true" });
  node.innerHTML = tableSvg();
  return node;
}

// A card as a span holding its art: a design id, or a back of an age (id -1 or null).
export function cardEl(id, { age = 1, size = "full", cls = "" } = {}) {
  const back = id === null || id === undefined || id < 0;
  const key = back ? `card b${age}:${size}` : `card ${id}:${size}`;
  const node = el("span", { class: `sc-cardbox ${back ? "back" : `c-${CARDS[id].color}`} ${cls}`, "aria-hidden": "true" });
  node.append(svgNode(key, () => (back ? cardBack(age, { size }) : cardSvg(id, { size }))));
  return node;
}
// A card that turns over: a front and a back (CSS turns .sc-turn.down).
export function turnCardEl(id, age, { size = "full", down = true } = {}) {
  return el("span", { class: `sc-turn ${down ? "down" : ""}`, "aria-hidden": "true" }, el("span", { class: "in" }, el("span", { class: "side front" }, id >= 0 ? cardEl(id, { size }) : cardEl(null, { age, size })), el("span", { class: "side back" }, cardEl(null, { age, size }))));
}

// A built card in a city: its colour, its effect as icons, and its name where there's room.
export function chipEl(id) {
  const c = CARDS[id];
  return el("span", { class: `sc-chip c-${c.color}`, title: c.name, dataset: { id } }, el("span", { class: "sc-chip-art", "aria-hidden": "true" }, svgNode(`card ${id}:mini`, () => cardSvg(id, { size: "mini" }))), el("span", { class: "sc-chip-name" }, c.name));
}

// A city in columns by colour; empty colours keep a dashed place. A city
// only grows, so set(ids) appends the cards built since; anything else (a
// rematch) draws it again.
export function cityView({ cls = "" } = {}) {
  const ghost = (c) => el("span", { class: `sc-chip ghost c-${c}`, "aria-hidden": "true" });
  const cols = COLORS.map((c) => el("div", { class: `sc-col c-${c} empty` }, ghost(c)));
  const node = el("div", { class: `sc-city ${cls}` }, cols);
  let shown = [];
  function set(ids) {
    if (ids.length === shown.length && ids.every((id, i) => id === shown[i])) return false;
    if (ids.length < shown.length || shown.some((id, i) => id !== ids[i])) {
      cols.forEach((col, i) => (col.replaceChildren(ghost(COLORS[i])), col.classList.add("empty")));
      shown = [];
    }
    for (const id of ids.slice(shown.length)) {
      const col = cols[COLORS.indexOf(CARDS[id].color)];
      if (col.classList.contains("empty")) col.replaceChildren();
      col.classList.remove("empty");
      col.append(chipEl(id));
    }
    shown = ids.slice();
    return true;
  }
  return { node, set };
}
export function cityEl(ids, opts) {
  const city = cityView(opts);
  city.set(ids);
  return city.node;
}

// A seat's whole city in a dialog: its public facts, its wonder and every
// card built. whereOf(p): "your left neighbour"… Parts are redrawn only
// when they change, so keyboard focus stays on Close while the table moves.
export function cityDialog({ nameOf, whereOf, ageOf = () => 1 }) {
  let mark = el("span");
  const title = el("h2", { id: "sc-dialog-title" });
  const where = el("small");
  const close = el("button", { class: "btn small sc-dialog-close", type: "button", onclick: () => node.close() }, "Close");
  const head = el("div", { class: "sc-dialog-head" }, mark, title, where, close);
  const facts = el("p", { class: "sc-dialog-facts" });
  const board = el("div", { class: "sc-dialog-board", role: "img" });
  const empty = el("p", { class: "sc-hint" }, "Nothing built yet.");
  const list = el("ul", { class: "sr-only" });
  let city = cityView({ cls: "big" });
  const node = el("dialog", { class: "card sc-dialog", id: "sc-dialog", "aria-labelledby": "sc-dialog-title" }, head, facts, board, empty, city.node, list);
  let seat = -1;
  let shown = {};
  const changed = (part, value) => shown[part] !== value && ((shown[part] = value), true);
  node.addEventListener("click", (e) => e.target === node && node.close());
  node.addEventListener("close", () => (seat = -1));

  function draw(view) {
    if (seat < 0 || !view) return;
    const p = seat;
    const w = view.wonders[p];
    const W = WONDERS[w.w];
    const built = view.stages[p].length;
    const ids = view.city[p].map((x) => x.id);
    const words = seatWords(view, p);
    if (changed("facts", words)) facts.textContent = words;
    const tucked = view.stages[p].map(ageOf);
    if (changed("board", `${w.w}:${w.side}:${built}:${tucked.join("")}`)) {
      board.replaceChildren(boardEl(w.w, w.side, built, { tucked }));
      board.setAttribute("aria-label", `${W.name}, side ${w.side}: ${built} of ${stagesOf(view, p).length} stages built. ${stagesOf(view, p).map((x, n) => stageWords(x, n)).join(" ")}`);
    }
    if (city.set(ids)) {
      empty.hidden = ids.length > 0;
      list.replaceChildren(...ids.map((id) => el("li", {}, cardWords(id))));
    }
  }
  // Shows seat p's city, or brings it up to date.
  function open(p, view) {
    if (!view) return;
    if (seat !== p) {
      seat = p;
      shown = {};
      const fresh = cityView({ cls: "big" });
      city.node.replaceWith(fresh.node);
      city = fresh;
      empty.hidden = false;
      list.replaceChildren();
      head.className = `sc-dialog-head p-${p}`;
      const m = seatMark(p);
      mark.replaceWith(m);
      mark = m;
      title.textContent = `${nameOf(p)}'s city`;
      where.textContent = whereOf(p);
    }
    draw(view);
    if (!node.open) node.showModal();
    close.focus();
  }
  return { node, open, draw, close: () => node.open && node.close() };
}

// ---------- the table ----------
// table: engine/cards/table.js (the queue, the fly layer, bubbles).
// me, players; nameOf(p); onSeat(p) opens a seat's city; ageOf(slot): the
// age of a card tucked under a wonder, which its back shows.
export function scTable(table, { me, players, nameOf, onSeat = () => {}, ageOf = () => 1 }) {
  const { live, fast, wait, flyLayer, rectIn } = table;
  const around = seatsAround(players, me);
  const order = [around.left, around.right, around.across].filter((p) => p >= 0 && p !== me);

  // ---------- the neighbours' panels ----------
  function seatPanel(p, side) {
    const head = el("span", { class: "sc-seat-name" }, seatMark(p), el("b", {}, nameOf(p)));
    const wonderName = el("span", { class: "sc-seat-wonder" });
    const arrow = el("span", { class: `sc-seat-arrow ${side}`, "aria-hidden": "true" });
    const coins = el("span", { class: "sc-stat coins" });
    const shieldsEl = el("span", { class: "sc-stat shields" });
    const tokens = el("span", { class: "sc-tokens" });
    const dots = el("span", { class: "sc-stage-dots", "aria-hidden": "true" });
    const sellRow = el("span", { class: "sc-sells" });
    const counts = el("span", { class: "sc-counts", "aria-hidden": "true" }, COLORS.map((c) => el("span", { class: `sc-count c-${c}` }, "0")));
    const wonder = el("div", { class: "sc-seat-board", "aria-hidden": "true" });
    const cityBox = el("div", { class: "sc-seat-city" });
    const pick = el("span", { class: "sc-pickmark", "aria-hidden": "true", hidden: true }, cardEl(null));
    const open = el("button", { class: "sc-seat-open", type: "button", onclick: () => onSeat(p) }, arrow, head, wonderName);
    const node = el(
      "section",
      { class: `sc-seat p-${p} ${side}`, dataset: { seat: p } },
      el("header", { class: "sc-seat-head" }, open),
      el("div", { class: "sc-seat-stats" }, coins, shieldsEl, tokens, dots),
      el("div", { class: "sc-seat-sells" }, el("span", { class: "sc-label" }, "sells"), sellRow),
      counts,
      wonder,
      el("div", { class: "sc-seat-city-box" }, el("span", { class: "sc-label" }, `${nameOf(p)}'s city`), cityBox),
      pick,
    );
    // The whole panel opens the city; its name is the button keyboards and screen readers use.
    node.addEventListener("click", (e) => !e.target.closest(".sc-seat-open") && onSeat(p));
    // Each part is redrawn only when what it shows changes: boards and city chips are big markup.
    const shown = {};
    const changed = (part, value) => shown[part] !== value && ((shown[part] = value), true);
    const city = cityView();
    cityBox.append(city.node);
    function draw(view, { picked = false } = {}) {
      pick.hidden = !picked;
      const w = view.wonders[p];
      const W = WONDERS[w.w];
      const built = view.stages[p].length;
      const ids = view.city[p].map((x) => x.id);
      const sh = shields(view, p);
      if (changed("coins", view.coins[p])) coins.replaceChildren(coinEl(view.coins[p]));
      if (changed("shields", sh)) shieldsEl.replaceChildren(shieldEl(), el("b", {}, String(sh)));
      if (changed("tokens", view.tokens[p].join())) tokens.replaceChildren(...view.tokens[p].map(tokenEl));
      const board = `${w.w}:${w.side}:${built}`;
      if (changed("board", board)) {
        wonderName.textContent = `${W.city} ${w.side}`;
        const total = stagesOf(view, p).length;
        dots.replaceChildren(...Array.from({ length: total }, (_, i) => el("i", { class: i < built ? "on" : "" })));
        wonder.replaceChildren(boardEl(w.w, w.side, built, { mini: true }));
      }
      if (city.set(ids) || changed("sells", board)) {
        sellRow.replaceChildren(...sells(view, p).map(({ unit, n }) => el("span", { class: "sc-sell" }, ...unit.flatMap((r, j) => (j ? [SEP(), resEl(r)] : [resEl(r)])), n > 1 ? el("small", {}, `×${n}`) : "")));
        const cols = cityColumns(ids);
        [...counts.children].forEach((c, i) => {
          c.textContent = cols[i].length ? String(cols[i].length) : "";
          c.classList.toggle("none", !cols[i].length);
        });
      }
      const where = side === "across" ? "across the table (not a neighbour)" : `your ${side} neighbour`;
      const label = `${nameOf(p)}, ${where}, ${W.name} side ${w.side}: ${seatWords(view, p)}. Show their city`;
      if (changed("label", label)) open.setAttribute("aria-label", label);
    }
    const rects = {
      pick: () => rectIn(pick.hidden ? node : pick),
      coins: () => rectIn(coins),
      city: (color) => rectIn((color && counts.children[COLORS.indexOf(color)]) || counts),
      wonder: () => rectIn(dots),
      tokens: () => rectIn(tokens.lastChild ?? shieldsEl),
      seat: () => rectIn(node),
    };
    return { p, node, draw, rects, pick };
  }

  const panels = new Map();
  if (around.left !== me) panels.set(around.left, seatPanel(around.left, "left"));
  if (around.right !== me && around.right !== around.left) panels.set(around.right, seatPanel(around.right, "right"));
  if (around.across >= 0) panels.set(around.across, seatPanel(around.across, "across"));

  // ---------- your wonder and city ----------
  const meCoins = el("span", { class: "sc-stat coins" });
  const meShields = el("span", { class: "sc-stat shields" });
  const meTokens = el("span", { class: "sc-tokens" });
  const meWonderName = el("span", { class: "sc-me-wonder" });
  const meStats = el("div", { class: "sc-me-stats", role: "group" }, seatMark(me), el("b", { class: "sc-me-name" }, "You"), meWonderName, el("span", { class: "sc-grow" }), meCoins, meShields, meTokens);
  const boardBox = el("div", { class: "sc-board", id: "sc-board", role: "img" });
  const myCity = el("div", { class: "sc-my-city", role: "img" });
  const cityBox = el("section", { class: "sc-city-box", "aria-label": "Your city" }, el("h2", { class: "sc-title" }, "Your city"), myCity);
  const mine = el("section", { class: "sc-mine", "aria-label": "Your wonder and city" }, meStats, boardBox, cityBox);
  const myPick = el("span", { class: "sc-pickmark mine", "aria-hidden": "true", hidden: true }, cardEl(null));
  boardBox.append(myPick);
  const mineShown = {};
  const mineChanged = (part, value) => mineShown[part] !== value && ((mineShown[part] = value), true);
  const myCityView = cityView({ cls: "mine" });
  myCity.append(myCityView.node);
  let myBuilt = -1;
  function drawMine(view) {
    const w = view.wonders[me];
    const W = WONDERS[w.w];
    const ids = view.city[me].map((x) => x.id);
    const built = view.stages[me].length;
    const sh = shields(view, me);
    if (mineChanged("coins", view.coins[me])) {
      meCoins.replaceChildren(coinEl(view.coins[me]));
      meCoins.setAttribute("aria-label", plural(view.coins[me], "coin"));
    }
    if (mineChanged("shields", sh)) {
      meShields.replaceChildren(shieldEl(), el("b", {}, String(sh)));
      meShields.setAttribute("aria-label", plural(sh, "shield"));
    }
    if (mineChanged("tokens", view.tokens[me].join())) {
      meTokens.replaceChildren(...view.tokens[me].map(tokenEl));
      meTokens.setAttribute("aria-label", view.tokens[me].length ? `War tokens ${view.tokens[me].map(signed).join(" ")}` : "No war tokens");
    }
    const facts = `You: ${W.name}, side ${w.side}, ${plural(view.coins[me], "coin")}, ${plural(sh, "shield")}`;
    if (mineChanged("facts", facts)) meStats.setAttribute("aria-label", facts);
    const tucked = view.stages[me].map(ageOf);
    if (mineChanged("board", `${w.w}:${w.side}:${built}:${tucked.join("")}`)) {
      meWonderName.textContent = `${W.name} · ${w.side}`;
      const art = el("span", { class: "sc-board-art" });
      art.append(boardEl(w.w, w.side, built, { tucked }));
      // The stage just built pops in (pieces.css).
      if (myBuilt >= 0 && built > myBuilt) art.querySelector(`.sc-stage[data-stage="${built - 1}"]`)?.classList.add("sc-new");
      myBuilt = built;
      boardBox.replaceChildren(art, myPick);
      const stages = stagesOf(view, me);
      boardBox.setAttribute("aria-label", `Your wonder, ${W.name}, side ${w.side}: makes ${RES_NAMES[W.produce]}. ${built} of ${stages.length} stages built. ${stages.map((s, n) => `${n < built ? "Built" : "To build"}: ${stageWords(s, n)}`).join(" ")}`);
    }
    if (myCityView.set(ids) || !myCity.hasAttribute("aria-label")) {
      myCity.setAttribute("aria-label", ids.length ? `Your city: ${cityColumns(ids).flatMap((col, i) => (col.length ? [`${COLOR_NAMES[COLORS[i]]}: ${listOf(col.map((id) => CARDS[id].name))}`] : [])).join("; ")}` : "Your city is empty");
    }
  }
  const mineRects = {
    pick: () => rectIn(myPick.hidden ? boardBox : myPick),
    coins: () => rectIn(meCoins),
    city: (color) => rectIn(myCity.querySelector(`.sc-col.c-${color} .sc-chip:last-child`) ?? myCity),
    wonder: () => rectIn(boardBox),
    tokens: () => rectIn(meTokens.lastChild ?? meShields),
    seat: () => rectIn(mine),
  };

  // ---------- where things are ----------
  const bankBox = el("span", { class: "sc-bank", "aria-hidden": "true" }, coinPieceEl(3), coinPieceEl(1));
  const pile = el("span", { class: "sc-pile", role: "img" }, cardEl(null, { age: 1, size: "mini" }), el("b", { class: "mono" }, "0"));
  function drawPile(view) {
    const n = view.discard.length;
    pile.lastChild.textContent = String(n);
    pile.classList.toggle("empty", !n);
    const age = Math.max(1, view.age);
    if (pile.dataset.age !== String(age)) {
      pile.dataset.age = String(age);
      pile.firstChild.replaceWith(cardEl(null, { age, size: "mini" }));
    }
    pile.setAttribute("aria-label", `Discard pile: ${plural(n, "card")}, face down`);
  }
  const rectsOf = (p) => (p === me ? mineRects : panels.get(p)?.rects);
  // An overlay in the middle of the screen, wherever the table is scrolled.
  function centre(node) {
    flyLayer.append(node);
    // Wholly inside the table (its layer clips), as near the screen's middle as that allows.
    const o = flyLayer.getBoundingClientRect();
    const half = node.offsetHeight / 2 + 8;
    const y = Math.max(half, Math.min(o.height - half, innerHeight / 2 - o.top));
    node.style.top = `${y.toFixed(0)}px`;
  }

  // ---------- motion ----------
  // A card flies along a low arc, turning over on the way if asked
  // (turn: "up" shows id on landing; "down" hides it).
  async function flyCard(id, age, from, to, { ms = PACE.fly, g, delay = 0, turn = null, width = null, fade = false } = {}) {
    if (fast() || !live(g) || !from || !to) return;
    if (delay) await wait(delay, g);
    if (!live(g)) return;
    const w = width ?? Math.max(30, Math.min(84, Math.max(from.w, to.w)));
    const h = w * 1.4;
    const back = id === null || id < 0;
    // A back that never turns is drawn alone.
    const node = back && !turn ? el("span", { class: "sc-turn", "aria-hidden": "true" }, el("span", { class: "in" }, el("span", { class: "side" }, cardEl(null, { age })))) : turnCardEl(id, age, { down: turn === "up" || back });
    node.classList.add("sc-fly-card");
    node.style.width = `${w}px`;
    flyLayer.append(node);
    const c = (r) => [r.x + r.w / 2 - w / 2, r.y + r.h / 2 - h / 2];
    const [x0, y0] = c(from);
    const [x1, y1] = c(to);
    const s1 = Math.max(0.35, Math.min(1.1, to.w / w));
    const s0 = Math.max(0.35, Math.min(1.1, from.w / w));
    const lift = Math.min(70, Math.hypot(x1 - x0, y1 - y0) * 0.18 + 14);
    const at = (x, y, s, r) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(1)}deg) scale(${s.toFixed(3)})`;
    const spin = ((Math.round(x0 + y1) % 9) - 4) * 0.8;
    const motion = node.animate(
      [
        { transform: at(x0, y0, s0, 0), opacity: 1 },
        { transform: at((x0 + x1) / 2, Math.min(y0, y1) - lift, (s0 + s1) / 2 * 1.08, spin), opacity: 1, offset: 0.5 },
        { transform: at(x1, y1, s1, 0), opacity: fade ? 0 : 1 },
      ],
      { duration: ms, easing: easeOut(), fill: "forwards" },
    );
    if (turn) {
      const inner = node.querySelector(".in");
      const [a, b] = turn === "up" ? ["rotateY(180deg)", "rotateY(0deg)"] : ["rotateY(0deg)", "rotateY(180deg)"];
      inner.animate([{ transform: a }, { transform: b }], { duration: ms * 0.5, delay: ms * 0.15, easing: easeOut(), fill: "forwards" });
    }
    await motion.finished.catch(() => {});
    node.remove();
  }

  // Cards turn over where they lie, together: [{ id, age, rect }].
  // Where a seat's pick turns over: a card big enough to read, centred on its
  // pick mark, kept inside the table's edges (the fly layer clips).
  function flipRect(rect) {
    const w = Math.max(52, Math.min(84, rect.w));
    const h = w * 1.4;
    return { x: Math.max(4, Math.min(flyLayer.clientWidth - w - 4, rect.x + rect.w / 2 - w / 2)), y: rect.y + rect.h / 2 - h / 2, w, h };
  }
  async function flipAll(cards, { g, ms = PACE.flip }) {
    if (fast() || !live(g) || !cards.length) return;
    const nodes = cards.map(({ id, age, rect }) => {
      const r = flipRect(rect);
      const node = turnCardEl(id, age, { down: true });
      node.classList.add("sc-fly-card");
      node.style.width = `${r.w}px`;
      node.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`;
      flyLayer.append(node);
      return { node, up: id >= 0 };
    });
    await Promise.all(
      nodes.map(({ node, up }) => {
        const inner = node.querySelector(".in");
        const lift = node.animate([{ translate: "0 0" }, { translate: "0 -10px", offset: 0.5 }, { translate: "0 0" }], { duration: ms * 1.3, easing: easeOut(), composite: "add" });
        const turn = up ? inner.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], { duration: ms, delay: ms * 0.15, easing: easeOut(), fill: "forwards" }) : null;
        return Promise.all([lift.finished.catch(() => {}), turn?.finished.catch(() => {})]);
      }),
    );
    await wait(ms * 0.6, g);
    nodes.forEach(({ node }) => node.remove());
  }

  // Coins fly one after another: n of them, from one rect to another.
  async function flyCoins(n, from, to, { g, ms = PACE.coin, delay = 0 }) {
    if (fast() || !live(g) || !from || !to || n <= 0) return;
    const pieces = n >= 3 ? [...Array(Math.floor(n / 3)).fill(3), ...Array(n % 3).fill(1)] : Array(n).fill(1);
    await Promise.all(
      pieces.slice(0, 6).map(async (v, i) => {
        await wait(delay + i * 70, g);
        if (!live(g)) return;
        const node = coinPieceEl(v);
        node.classList.add("sc-fly-coin");
        flyLayer.append(node);
        const s = 22;
        const x0 = from.x + from.w / 2 - s / 2;
        const y0 = from.y + from.h / 2 - s / 2;
        const x1 = to.x + to.w / 2 - s / 2;
        const y1 = to.y + to.h / 2 - s / 2;
        const lift = Math.min(60, Math.hypot(x1 - x0, y1 - y0) * 0.22 + 12);
        await node
          .animate(
            [
              { transform: `translate(${x0}px, ${y0}px) scale(.7)`, opacity: 0 },
              { transform: `translate(${x0 + (x1 - x0) * 0.15}px, ${y0 - lift * 0.4}px) scale(1)`, opacity: 1, offset: 0.15 },
              { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - lift}px) scale(1.1)`, offset: 0.5 },
              { transform: `translate(${x1}px, ${y1}px) scale(.85)`, opacity: 0.9 },
            ],
            { duration: ms, easing: easeOut(), fill: "forwards" },
          )
          .finished.catch(() => {});
        node.remove();
      }),
    );
  }

  // Something lands: it swells and settles.
  function bump(node, scale = 1.12) {
    if (!node || fast()) return;
    node.animate([{ transform: "scale(1)" }, { transform: `scale(${scale})`, offset: 0.4 }, { transform: "scale(1)" }], { duration: 480, easing: "cubic-bezier(.34,1.56,.64,1)" });
  }

  // The war at the end of an age: each neighbouring pair's shields clash,
  // one pair after another, and the tokens fly to their seats. pairs: [[p, q,
  // result]]; strength: shields by seat; onToken(p, value) as each lands.
  async function war({ age, pairs, strength, g, k = 1, sound, onToken }) {
    const won = VICTORY[age - 1];
    const box = el("div", { class: "sc-war", role: "presentation" }, el("p", { class: "sc-war-title" }, `War · Age ${ROMAN[age]}`));
    const rows = pairs.map(([p, q, r]) => {
      const side = (s, res) => el("span", { class: `sc-war-side p-${s} ${res > 0 ? "win" : res < 0 ? "lose" : "tie"}` }, seatMark(s), el("span", { class: "nm" }, s === me ? "You" : nameOf(s)), shieldEl(), el("b", {}, String(strength[s])));
      const row = el("div", { class: "sc-war-row" }, side(p, r), el("span", { class: "sc-war-x", "aria-hidden": "true" }, "⚔"), side(q, -r));
      box.append(row);
      return row;
    });
    if (fast() || !live(g)) {
      pairs.forEach(([p, q, r]) => r && (onToken(r > 0 ? p : q, won), onToken(r > 0 ? q : p, -1)));
      // Without the motion the war is still heard: the clash, then how it went for you.
      if (!live(g)) return;
      sound("war");
      const mine = pairs.flatMap(([p, q, r]) => (p === me ? [r] : q === me ? [-r] : []));
      if (mine.some((r) => r > 0)) sound("victory", { value: won }, 0.4);
      else if (mine.some((r) => r < 0)) sound("defeat", {}, 0.4);
      return;
    }
    centre(box);
    box.animate([{ opacity: 0, transform: "translate(-50%, -46%) scale(.94)" }, { opacity: 1, transform: "translate(-50%, -50%) scale(1)" }], { duration: 260, easing: easeOut(), fill: "both" });
    sound("war");
    await wait(320 * k, g);
    for (const [i, [p, q, r]] of pairs.entries()) {
      if (!live(g)) break;
      const row = rows[i];
      row.classList.add("clash");
      row.animate([{ transform: "scale(1)" }, { transform: "scale(1.06)", offset: 0.35 }, { transform: "scale(1)" }], { duration: PACE.war * k, easing: easeOut() });
      await wait(PACE.war * 0.55 * k, g);
      if (r) {
        const [a, b] = r > 0 ? [p, q] : [q, p];
        const from = rectIn(row);
        const to = (s) => rectsOf(s)?.tokens() ?? rectsOf(s)?.seat();
        const fly = (s, v) => flyToken(v, from, to(s), g).then(() => onToken(s, v));
        if (a === me) sound("victory", { value: won });
        else if (b === me) sound("defeat");
        fly(a, won);
        fly(b, -1);
      }
      await wait(PACE.warGap * k, g);
    }
    await wait(500 * k, g);
    await box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" }).finished.catch(() => {});
    box.remove();
  }
  async function flyToken(v, from, to, g) {
    if (fast() || !live(g) || !to) return;
    const node = tokenEl(v);
    node.classList.add("sc-fly-token");
    flyLayer.append(node);
    const s = 26;
    const x0 = from.x + from.w / 2 - s / 2;
    const y0 = from.y + from.h / 2 - s / 2;
    const x1 = to.x + to.w / 2 - s / 2;
    const y1 = to.y + to.h / 2 - s / 2;
    await node.animate([{ transform: `translate(${x0}px, ${y0}px) scale(1.4)` }, { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 40}px) scale(1.2)`, offset: 0.5 }, { transform: `translate(${x1}px, ${y1}px) scale(.9)` }], { duration: PACE.fly, easing: easeOut(), fill: "forwards" }).finished.catch(() => {});
    node.remove();
  }

  return {
    around,
    order,
    panels,
    mine,
    myPick,
    boardBox,
    cityBox,
    bankBox,
    pile,
    drawMine,
    drawPile,
    rectsOf,
    bankRect: () => rectIn(bankBox),
    pileRect: () => rectIn(pile),
    centre,
    flyCard,
    flipRect,
    flipAll,
    flyCoins,
    bump,
    war,
  };
}

// The score sheet: a row at a time, each counted up while the total row
// adds it in, then the winner's total lights up. scores by seat; order: the
// seats as columns; returns { node, play({ g, k, wait, live, fast, sound }) }.
const ROW_ICON = {
  military: () => shieldEl(),
  coins: () => coinEl(),
  wonder: () => el("span", { class: "sc-ic sc-wonder-pip", "aria-hidden": "true" }),
  civic: () => art("sc-ic", colourIcon("blue")),
  commerce: () => art("sc-ic", colourIcon("yellow")),
  guilds: () => art("sc-ic", colourIcon("purple")),
  science: () => art("sc-ic", colourIcon("green")),
};
export function scoreSheet(scores, order, { me, nameOf, winners = [] }) {
  const won = (p) => winners.includes(p);
  const head = el("tr", {}, el("th", { scope: "col" }, el("span", { class: "sr-only" }, "Row")), ...order.map((p) => el("th", { scope: "col", class: `p-${p} ${p === me ? "mine" : ""} ${won(p) ? "best" : ""}` }, el("span", { class: "who" }, seatMark(p), el("span", { class: "nm" }, p === me ? "You" : nameOf(p))))));
  const cells = [];
  const rows = SCORE_ROWS.map(([key, label, note]) => {
    const tds = order.map((p) => el("td", { class: `${p === me ? "mine" : ""} ${key === "total" && won(p) ? "best" : ""} ${scores[p][key] ? "" : "zero"}` }, String(scores[p][key])));
    cells.push(tds);
    return el("tr", { class: `r-${key}` }, el("th", { scope: "row" }, el("span", { class: "lbl" }, ROW_ICON[key]?.(), label), note ? el("small", {}, note) : null), ...tds);
  });
  const node = el("table", { class: "sc-sheet done", id: "sc-sheet" }, el("caption", { class: "sr-only" }, "Final scores"), el("thead", {}, head), el("tbody", {}, rows.slice(0, -1)), el("tfoot", {}, rows.at(-1)));
  async function play({ g, k = 1, wait, live, fast, sound }) {
    if (fast()) return void sound("score", { row: SCORE_ROWS.length - 1 });
    node.classList.remove("done");
    const totals = cells.at(-1);
    const sum = order.map(() => 0);
    cells.slice(0, -1).forEach((tds) => tds.forEach((td) => (td.textContent = "")));
    totals.forEach((td) => (td.textContent = "0"));
    rows.at(-1).classList.add("on");
    for (const [i, [key]] of SCORE_ROWS.slice(0, -1).entries()) {
      if (!live(g)) break;
      rows[i].classList.add("on");
      sound("score", { row: i });
      const target = order.map((p) => scores[p][key]);
      const steps = 6;
      for (let s = 1; s <= steps; s++) {
        cells[i].forEach((td, j) => {
          const now = Math.round((target[j] * s) / steps);
          td.textContent = String(now);
          totals[j].textContent = String(sum[j] + now);
        });
        await wait((PACE.row / steps) * k, g);
      }
      target.forEach((t, j) => (sum[j] += t));
    }
    cells.forEach((tds, i) => tds.forEach((td, j) => (td.textContent = String(scores[order[j]][SCORE_ROWS[i][0]]))));
    if (!live(g)) return;
    sound("score", { row: SCORE_ROWS.length - 1 });
    node.classList.add("done");
  }
  return { node, play };
}

// ---------- your move ----------
// What the build and stage buttons would send, and their words. o: a card's
// pickOptions() with its id and card; i: which of the cheapest ways to pay;
// names: { left, right }.
export function buildPlan(state, me, o, slot, i, names) {
  const b = o.build;
  if (b.chain) return { ok: true, move: moveFor("build", slot), label: "Build free", sub: `Chain from ${listOf(chainsFrom(o.card))}` };
  // A card nobody can pay for that the wonder's free build can build: the free button does it.
  if (o.free && !b.purchases.length) return { ok: false, label: "Build", sub: costWords(o.card.cost), why: "only free, with your wonder" };
  if (!b.ok || !b.purchases.length) return { ok: false, label: WHY[b.why] ?? "Can't build", sub: b.why === "duplicate" ? "" : costWords(o.card.cost), why: whyWords(b.why, o.card) };
  const p = b.purchases[i % b.purchases.length];
  const side = sideCoins(state, me, p);
  return { ok: true, move: moveFor("build", slot, p), label: "Build", sub: payWords({ bank: b.coins, ...side }, names) || "Pay nothing", buy: p, side, ways: b.purchases.length };
}
export function stagePlan(state, me, o, slot, i, names) {
  const s = o.stage;
  if (!s.ok) return { ok: false, label: s.why === "built" ? "Wonder finished" : "Can't afford", sub: s.stage ? `Stage ${ROMAN[s.n + 1]}: ${costWords(s.stage.cost)}` : "", why: whyWords(s.why) };
  const p = s.purchases[i % s.purchases.length];
  const side = sideCoins(state, me, p);
  return { ok: true, move: moveFor("stage", slot, p), label: `Wonder stage ${ROMAN[s.n + 1]}`, sub: payWords(side, names) || "Pay nothing", buy: p, side, ways: s.purchases.length };
}

// What a screen reader hears a card in your hand can do now.
export function handState(o, { dig = false, can = false } = {}) {
  if (dig) return can ? "you can build it free" : "you already have it";
  if (!o) return "";
  if (o.build.chain) return "free through a chain";
  if (o.build.ok && o.build.purchases.length) return "you can build it";
  if (o.free) return "you can build it free with your wonder";
  return WHY[o.build.why]?.toLowerCase() ?? "";
}

// The card picked: what it does, what it costs and how you'd pay, or why
// you can't. b, s: its plans (null to show the card alone); onOther(kind)
// steps to the next way to pay for a build or a stage.
export function detailNodes(o, b, s, names, { onOther = () => {} } = {}) {
  if (!o) return [];
  const c = o.card;
  const from = chainsFrom(c);
  const other = (id, kind, ways, what) => el("button", { class: "btn sc-act small link", type: "button", id, "aria-label": `Other way to pay for ${what} (${ways} ways)`, onclick: () => onOther(kind) }, el("span", { class: "sc-act-words" }, el("span", { class: "lbl" }, "Other way to pay")));
  const lines = [
    el("div", { class: `sc-detail-head c-${c.color}` }, el("strong", { class: "sc-detail-name" }, c.name), effectEl(c), o.build.chain ? el("span", { class: "sc-badge chain" }, "chain") : null, o.free && !o.build.chain ? el("span", { class: "sc-badge free" }, "free build") : null),
    el("p", { class: "sc-detail-fx" }, effectWords(c)),
    el("p", { class: "sc-detail-cost" }, ...(costWords(c.cost) === "free" ? [el("span", { class: "k" }, "Free to build")] : [el("span", { class: "k" }, "Costs"), costEl(c.cost), el("span", {}, costWords(c.cost))]), from.length ? el("small", { class: "sc-chain-from" }, ` · free with ${listOf(from)}`) : null),
    chainsTo(c).length ? el("p", { class: "sc-chain-to" }, `Makes ${listOf(chainsTo(c))} free later.`) : null,
  ];
  if (b) {
    if (o.build.chain) lines.push(el("p", { class: "sc-detail-pay ok" }, `Free: you have ${listOf(from)}.`));
    else if (b.ok) {
      const buy = b.buy && buyWords(b.buy, names);
      lines.push(el("p", { class: "sc-detail-pay ok" }, buy ? `${buy} for ${plural(b.side.left + b.side.right, "coin")}.` : c.cost.coins ? `Pay ${plural(c.cost.coins, "coin")} to the bank.` : "You make everything it needs."));
      if (b.ways > 1) lines.push(other("sc-other", "build", b.ways, c.name));
    } else if (o.free) lines.push(el("p", { class: "sc-detail-pay ok" }, "You can't pay for it, but your wonder's free build can build it."));
    else lines.push(el("p", { class: "sc-detail-pay no" }, `${whyWords(o.build.why, c)}.`));
  }
  const stage = s && o.stage.stage;
  if (stage) {
    const words = s.ok && s.buy && buyWords(s.buy, names);
    lines.push(el("p", { class: "sc-detail-stage" }, el("span", { class: "k" }, `Stage ${ROMAN[o.stage.n + 1]}`), costEl(stage.cost), el("span", { class: "sc-arrow" }, "→"), effectEl(stage), el("small", {}, ` ${effectWords(stage)}.${s.ok ? (words ? ` ${words} for ${plural(s.side.left + s.side.right, "coin")}.` : "") : ` ${whyWords(o.stage.why)}.`}`)));
    if (s.ok && s.ways > 1) lines.push(other("sc-other-stage", "stage", s.ways, "the wonder stage"));
  }
  return lines.filter(Boolean);
}

// Your hand: a row of cards that turn over as their faces arrive. Arrows,
// Home and End move along it; a click, Enter or Space picks a card
// (onSelect(slot)).
export function handView({ onSelect = () => {} } = {}) {
  const title = el("span", { class: "sc-hand-title" });
  const next = el("span", { class: "sc-hand-next" });
  const node = el("div", { class: "sc-hand", id: "sc-hand", role: "group", "aria-label": "Your hand" });
  const cards = new Map();
  let focusSlot = null;
  node.addEventListener("keydown", (e) => {
    const btn = e.target.closest(".sc-hcard");
    if (!btn) return;
    const list = [...node.querySelectorAll(".sc-hcard")];
    const i = list.indexOf(btn);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -i, End: list.length - 1 - i }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const target = list[Math.max(0, Math.min(list.length - 1, i + step))];
    focusSlot = Number(target.dataset.slot);
    for (const b of list) b.tabIndex = b === target ? 0 : -1;
    target.focus();
  });
  node.addEventListener("click", (e) => {
    const btn = e.target.closest(".sc-hcard");
    if (!btn) return;
    focusSlot = Number(btn.dataset.slot);
    onSelect(focusSlot);
  });

  // slots: the cards to show; idOf(slot): a face, or −1 while it is on its way;
  // options(slot): its pickOptions() or null; choosing: you pick now; dig: the
  // discards to dig through, legal the ones you may build; sel, picked: the
  // card selected and the one you picked this turn; hidden(slot): in the air.
  function draw({ slots, age, idOf, options = () => null, choosing = false, dig = false, legal = null, sel = null, picked = null, hidden = () => false, fast = true, title: words = "Your hand", next: nextWords = "", label }) {
    const hadFocus = node.contains(document.activeElement) ? Number(document.activeElement.dataset.slot) : null;
    for (const [slot, b] of cards) {
      if (slots.includes(slot) && b.dataset.dig === String(dig)) continue;
      b.remove();
      cards.delete(slot);
    }
    slots.forEach((slot, i) => {
      const id = idOf(slot);
      let b = cards.get(slot);
      if (!b) {
        b = el("button", { class: "sc-hcard", type: "button", dataset: { slot, dig: String(dig) } }, turnCardEl(id, age, { down: id < 0 }));
        b.firstChild.dataset.id = String(id);
        cards.set(slot, b);
      }
      const turn = b.firstChild;
      if (turn.dataset.id !== String(id)) {
        turn.dataset.id = String(id);
        turn.querySelector(".front").replaceChildren(cardEl(id >= 0 ? id : null, { age }));
        turn.querySelector(".back").replaceChildren(cardEl(null, { age }));
        // A face that has just arrived turns over in place.
        if (id >= 0 && !fast) {
          turn.classList.add("down");
          void turn.offsetWidth;
        }
      }
      turn.classList.toggle("down", id < 0);
      const o = !dig && id >= 0 ? options(slot) : null;
      const can = dig ? !!legal?.has(slot) : !!o && (o.build.ok || o.free);
      const isSel = sel === slot;
      const isPicked = picked === slot;
      b.classList.toggle("sel", isSel);
      b.classList.toggle("picked", isPicked);
      b.classList.toggle("dim", slots.includes(picked) && !isPicked);
      b.classList.toggle("can", can && choosing);
      b.classList.toggle("chain", !!o?.build.chain);
      b.style.opacity = hidden(slot) ? "0" : "";
      b.setAttribute("aria-pressed", String(isSel));
      const now = handState(o, { dig, can });
      b.setAttribute("aria-label", id < 0 ? "A card, arriving" : `${cardWords(id)}${now ? ` Now: ${now}.` : ""}${isPicked ? " Picked." : ""}`);
      b.style.setProperty("--i", String(i));
      if (node.children[i] !== b) node.insertBefore(b, node.children[i] ?? null);
    });
    if (focusSlot === null || !cards.has(focusSlot)) focusSlot = slots[0] ?? null;
    for (const [slot, b] of cards) b.tabIndex = slot === focusSlot ? 0 : -1;
    if (hadFocus !== null && !cards.has(hadFocus) && focusSlot !== null) cards.get(focusSlot)?.focus({ preventScroll: true });
    node.dataset.n = String(slots.length);
    node.classList.toggle("choosing", choosing);
    node.classList.toggle("digging", dig);
    node.setAttribute("aria-label", label ?? (dig ? "The discards you can dig through" : `Your hand: ${plural(slots.length, "card")}`));
    title.textContent = words;
    next.textContent = nextWords;
  }
  function clear() {
    cards.forEach((b) => b.remove());
    cards.clear();
  }
  return { node, title, next, draw, clear, card: (slot) => cards.get(slot) ?? null };
}

// The buttons for the card you pick, made once so a lit (or focused) button
// stays put: Build, Build free (the wonder's free build), Wonder stage, Sell
// for 3, and while you dig, Build free and Build nothing. onAct(kind).
export function actButtons({ onAct = () => {} } = {}) {
  function make(kind, cls, icon = null) {
    const lbl = el("span", { class: "lbl" });
    const sub = el("small");
    const b = el("button", { class: `btn sc-act ${cls}`, type: "button", id: `sc-${kind}`, hidden: true, onclick: () => !b.disabled && onAct(kind) }, icon, el("span", { class: "sc-act-words" }, lbl, sub));
    const set = (label, small = null, { disabled = false, aria = null, extra = "" } = {}) => {
      lbl.textContent = label;
      sub.textContent = small ?? "";
      sub.hidden = !small;
      b.disabled = disabled;
      b.className = `btn sc-act ${cls} ${extra}`.trim();
      if (aria) b.setAttribute("aria-label", aria);
      else b.removeAttribute("aria-label");
    };
    return { b, set };
  }
  const all = { build: make("build", "primary"), free: make("free", "primary free"), stage: make("stage", ""), sell: make("sell", "", coinEl(3)), dig: make("dig", "primary"), nothing: make("nothing", "") };
  const node = el("div", { class: "sc-buttons", id: "sc-buttons", role: "group", "aria-label": "What to do with the card", hidden: true }, Object.values(all).map((x) => x.b));
  function show(kinds) {
    for (const [kind, x] of Object.entries(all)) x.b.hidden = !kinds.includes(kind);
    node.dataset.n = String(kinds.length);
    node.hidden = !kinds.length;
    // Focus on a button that has just gone goes to the first one left.
    const f = document.activeElement;
    if (node.contains(f) && (f.hidden || f.disabled)) (node.querySelector("button:not([hidden]):not([disabled])") ?? node.closest(".stonecrown")?.querySelector("[role=status]"))?.focus({ preventScroll: true });
  }
  return {
    node,
    ...Object.fromEntries(Object.entries(all).map(([k, x]) => [k, x.b])),
    // Nothing chosen yet: the buttons, waiting.
    idle() {
      all.build.set("Build", null, { disabled: true });
      all.stage.set("Wonder stage", null, { disabled: true });
      all.sell.set("Sell for 3", null, { disabled: true });
      show(["build", "stage", "sell"]);
    },
    // A card chosen: build it (paid, by a chain, or with the wonder's free build), raise a stage with it, or sell it.
    pick(o, b, s) {
      const name = o.card.name;
      all.build.set(b.label, b.sub, { disabled: !b.ok, extra: o.build.chain ? "chain" : "", aria: b.ok ? `${b.label} ${name}: ${b.sub} (B)` : `Can't build ${name}: ${b.why}` });
      const free = o.free && !o.build.chain;
      all.free.set("Build free", "Your wonder's free build this age", { aria: `Build ${name} free with your wonder's free build` });
      all.stage.set(s.label, s.sub, { disabled: !s.ok, aria: s.ok ? `${s.label}, tucking ${name} face down: ${s.sub} (W)` : `Wonder stage: ${s.why}` });
      all.sell.set("Sell for 3", null, { aria: `Sell ${name} face down for 3 coins (S)` });
      show(free ? ["build", "free", "stage", "sell"] : ["build", "stage", "sell"]);
    },
    // Digging the discards: a card chosen (its name, and whether you may build it) or not yet.
    dig(name, legal) {
      all.dig.set("Build free", name ?? "Pick a card", { disabled: !legal, aria: name ? `Build ${name} free from the discards` : "Build free: pick a card first" });
      all.nothing.set("Build nothing");
      show(["dig", "nothing"]);
    },
    none: () => show([]),
  };
}

// Who has chosen this turn: everyone's mark, ticked once they've picked (a
// commitment, public). rows: [{ p, name, done, me }], or null to hide it.
export function picksList() {
  const node = el("ul", { class: "sc-picks", id: "sc-picks", "aria-label": "Who has picked", hidden: true });
  function draw(rows) {
    node.hidden = !rows;
    node.replaceChildren(...(rows ?? []).map(({ p, name, done, me }) => el("li", { class: `p-${p} ${done ? "done" : ""}` }, seatMark(p), el("span", { class: "nm" }, name), el("span", { class: "sc-pick-state" }, done ? "✓ picked" : me ? "your pick" : "picking"), !done && !me ? thinkingDots() : null)));
  }
  return { node, draw };
}

// ---------- a turn's events, played out ----------
// A turn's events as the screen plays them: each step's picks as one batch
// (with the coins they earn), the seventh cards together, the rest as they are.
export function batches(events) {
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
    if (ev.type === "discard" && out.at(-1)?.type === "sevenths") out.at(-1).list.push(ev);
    else out.push(ev.type === "discard" ? { type: "sevenths", list: [ev] } : ev);
  }
  return out;
}

// The motion of the events both the game and the tutorial have: everyone's
// picks, the hands passing, the seventh cards, the war and a new age. ctx:
// me, seats; view(): the table as drawn, which this brings up to date as
// things land; idOf(slot); handRect(slot) and handBox(), where your hand is;
// leaving, arriving: your hand's slots in the air, revealing: seats whose
// pick marks stay up, all Sets this fills and empties; draw(); sound(name,
// opts, at); onTuck(slot, age) as a stage is built; said(kind, data) for a
// log. k slows or speeds each step (1 is the normal pace).
export function scMotion(table, art, ctx) {
  const { live, fast } = table;
  const { me, seats, view, idOf, handRect, leaving, arriving, revealing, draw, sound, onTuck = () => {}, said = () => {} } = ctx;
  const n = seats.length;
  const rectOf = (p, part, arg) => art.rectsOf(p)?.[part]?.(arg) ?? null;
  const at = (ms) => (fast() ? 0 : ms / 1000);

  // The builds turn face up together, then each card flies to its place (a
  // city, under a wonder, the discard pile) a moment after the one before,
  // with the coins it cost; the coins earned come in after.
  async function picks(ev, g, k = 1) {
    const v = view();
    const list = ev.picks;
    for (const x of list) if (x.p !== me) revealing.add(x.p);
    draw();
    const from = new Map(list.map((x) => [x.p, x.how === "dig" ? art.pileRect() : x.p === me ? handRect(x.slot) : rectOf(x.p, "pick")]));
    sound("reveal");
    revealing.clear();
    draw();
    const flips = list.filter((x) => x.p !== me && x.type === "build" && from.get(x.p));
    await art.flipAll(flips.map((x) => ({ id: x.id, age: v.age, rect: from.get(x.p) })), { g, ms: PACE.flip * k });
    if (!live(g)) return;
    // Those cards fly on from where they turned over.
    for (const x of flips) from.set(x.p, art.flipRect(from.get(x.p)));
    // Every place measured before anything moves: a flight added to the page would make each measure lay it out again.
    const plan = list.map((x) => {
      const bought = x.bought ?? { left: 0, right: 0 };
      const to = x.type === "build" ? rectOf(x.p, "city", CARDS[x.id].color) : x.type === "stage" ? rectOf(x.p, "wonder") : art.pileRect();
      return { x, bought, to, coins: rectOf(x.p, "coins"), bank: art.bankRect(), left: bought.left ? rectOf(leftOf(v, x.p), "coins") : null, right: bought.right ? rectOf(rightOf(v, x.p), "coins") : null };
    });
    const flights = [];
    plan.forEach(({ x, bought, to, coins, bank, left, right }, i) => {
      const p = x.p;
      const delay = i * PACE.flyGap * k;
      const opts = { g, delay };
      if (p === me && x.how !== "dig") leaving.add(x.slot);
      v.coins[p] -= (x.coins ?? 0) + bought.left + bought.right;
      if (x.coins) flights.push(art.flyCoins(x.coins, coins, bank, { ...opts, ms: PACE.coin * k }));
      if (bought.left) flights.push(art.flyCoins(bought.left, coins, left, { ...opts, ms: PACE.coin * k }));
      if (bought.right) flights.push(art.flyCoins(bought.right, coins, right, { ...opts, ms: PACE.coin * k }));
      if (bought.left || bought.right) sound("trade", { n: bought.left + bought.right }, at(delay));
      const start = from.get(p);
      const mine = p === me ? idOf(x.slot) : -1;
      if (x.type === "build") {
        sound("build", { color: CARDS[x.id].color, how: x.how }, at(delay));
        flights.push(art.flyCard(x.id, v.age, start, to, { ...opts, ms: PACE.fly * k, width: p === me ? null : (start?.w ?? 40) }).then(() => {
          v.city[p].push({ slot: x.slot, id: x.id });
          if (x.how === "dig") v.discard = v.discard.filter((s) => s !== x.slot);
          draw();
        }));
      } else if (x.type === "stage") {
        sound("stage", { n: x.n }, at(delay));
        onTuck(x.slot, v.age);
        flights.push(art.flyCard(mine, v.age, start, to, { ...opts, ms: PACE.stage * k, turn: mine >= 0 ? "down" : null, width: p === me ? null : 36 }).then(() => {
          v.stages[p].push(x.slot);
          draw();
          art.bump(p === me ? art.boardBox : art.panels.get(p)?.node.querySelector(".sc-stage-dots"), p === me ? 1.04 : 1.25);
        }));
      } else {
        sound("sell", {}, at(delay));
        flights.push(art.flyCard(mine, v.age, start, to, { ...opts, ms: PACE.fly * k, turn: mine >= 0 ? "down" : null, width: 34 }).then(() => {
          v.discard.push(x.slot);
          draw();
        }));
      }
      said("pick", x);
      if (p === me) v.hands[me] = v.hands[me].filter((s) => s !== x.slot);
    });
    draw();
    await Promise.all(flights);
    if (!live(g)) return;
    leaving.clear();
    await gains(ev.gains, g, k);
  }

  // Coins coming in, together: sales and cards from the bank, purchases from the buyer.
  async function gains(list, g, k) {
    if (!list.length) return;
    const v = view();
    const plan = list.map((x) => ({ x, from: x.why === "trade" ? rectOf(x.from, "coins") : art.bankRect(), to: rectOf(x.p, "coins") }));
    sound("coins", { n: list.reduce((a, x) => a + x.coins, 0) });
    said("gains", list);
    await Promise.all(plan.map(({ x, from, to }) => art.flyCoins(x.coins, from, to, { g, ms: PACE.coin * k }).then(() => {
      v.coins[x.p] += x.coins;
      draw();
    })));
  }

  // Hands slide round: yours to one neighbour, the other's to you.
  async function pass(ev, g, k = 1) {
    const v = view();
    const dir = ev.dir;
    const to = dir > 0 ? art.around.left : art.around.right;
    const from = dir > 0 ? art.around.right : art.around.left;
    sound("pass", { dir });
    if (!fast()) {
      const toRect = rectOf(to, "seat");
      const mine = v.hands[me].map((slot) => [slot, handRect(slot)]);
      const others = seats.filter((q) => q !== me && q !== from && (q + dir + n) % n !== me).map((q) => [rectOf(q, "seat"), rectOf((q + dir + n) % n, "seat")]);
      const flights = mine.map(([slot, r], i) => (leaving.add(slot), art.flyCard(idOf(slot), v.age, r, toRect, { g, ms: PACE.pass * k, delay: i * 40 * k, width: 44, fade: true })));
      for (const [a, b] of others) flights.push(art.flyCard(null, v.age, a, b, { g, ms: PACE.pass * k, width: 30, fade: true }));
      draw();
      await Promise.all(flights);
      if (!live(g)) return;
    }
    v.hands = seats.map((p) => v.hands[(p - dir + n) % n]);
    v.round++;
    leaving.clear();
    v.hands[me].forEach((s) => arriving.add(s));
    draw();
    if (!fast()) {
      const fromRect = rectOf(from, "seat");
      const landing = v.hands[me].map((slot) => [slot, handRect(slot)]);
      await Promise.all(landing.map(([slot, r], i) => art.flyCard(null, v.age, fromRect, r, { g, ms: PACE.pass * k, delay: i * 40 * k, width: 44 }).then(() => {
        arriving.delete(slot);
        draw();
      })));
    }
    arriving.clear();
    draw();
    said("pass", { dir, from });
  }

  // The last card of each hand goes to the discard pile, face down.
  async function sevenths(ev, g, k = 1) {
    const v = view();
    sound("sell");
    const pile = art.pileRect();
    const starts = ev.list.map((x) => (x.p === me ? handRect(x.slot) : rectOf(x.p, "seat")));
    const flights = ev.list.map((x, i) => {
      const id = x.p === me ? idOf(x.slot) : -1;
      if (x.p === me) leaving.add(x.slot);
      return art.flyCard(id, v.age, starts[i], pile, { g, ms: PACE.fly * k, turn: id >= 0 ? "down" : null, width: 34 });
    });
    draw();
    await Promise.all(flights);
    for (const x of ev.list) {
      v.hands[x.p] = v.hands[x.p].filter((s) => s !== x.slot);
      v.discard.push(x.slot);
    }
    leaving.clear();
    draw();
    said("sevenths", ev);
  }

  async function war(ev, g, k = 1) {
    const v = view();
    said("war", ev);
    await art.war({
      age: ev.age,
      pairs: warPairs(ev.results),
      strength: seats.map((p) => shields(v, p)),
      g,
      k,
      sound,
      onToken: (p, value) => {
        v.tokens[p].push(value);
        draw();
      },
    });
  }

  // A new age: its cards are dealt round the table from above your hand. hands: the new hands by seat.
  async function deal(ev, hands, g, k = 1) {
    const v = view();
    v.age = ev.age;
    v.round = 1;
    v.phase = "pick";
    if (hands) v.hands = hands.map((h) => h.slice());
    v.hands[me].forEach((s) => arriving.add(s));
    sound("deal", { age: ev.age });
    said("age", ev);
    draw();
    if (!fast()) {
      const box = table.rectIn(ctx.handBox());
      const centre = { x: box.x + box.w / 2 - 20, y: box.y - 10, w: 40, h: 56 };
      const seatRects = new Map(seats.filter((p) => p !== me).map((p) => [p, rectOf(p, "seat")]));
      const cards = [];
      for (let r = 0; r < HAND; r++) for (const p of seats) if (v.hands[p][r] !== undefined) cards.push({ p, slot: v.hands[p][r], to: p === me ? handRect(v.hands[p][r]) : seatRects.get(p) });
      await Promise.all(cards.map(({ p, slot, to }, i) => art.flyCard(null, ev.age, centre, to, { g, ms: PACE.deal * k, delay: i * PACE.dealGap * k, width: p === me ? null : 30, fade: p !== me }).then(() => {
        if (p !== me) return;
        arriving.delete(slot);
        draw();
      })));
    }
    arriving.clear();
    draw();
  }

  return { picks, pass, sevenths, war, deal };
}
