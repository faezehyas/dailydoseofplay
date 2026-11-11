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
import { CARDS, WONDERS, COLORS, RESOURCE_NAMES, SYMBOLS, RAW, GOODS, DISCARD_COINS, VICTORY, DEFEAT, HAND } from "./cards.js";
import { stagesOf, canBuild, canStage, production, shields, sideCoins, leftOf, rightOf, passDir, score, scienceSymbols, sciencePoints, ROUNDS } from "./rules.js";
import { cardSvg, cardBack, cardText, effectIcon, resourceIcon, scienceIcon, coinIcon, shieldIcon, pointsIcon, neighbourIcon, colourIcon } from "./card-art.js";
import { wonderSvg, wonderMini, coinSvg, tokenSvg, tableSvg } from "./pieces.js";
import { shelfOf, saleOf, shelfView, matchCost, highlightOf, costMatchEl, badgeOf, badgeEl } from "./store.js";
import { borderView, borderFacts, borderSvg } from "./border.js";
import { warScene, warFacts } from "./war.js";
import { seatRing, stackEl, setStack, slide } from "./ring.js";
import { tipLayer, tipWords, argsOf, hints } from "./tips.js";

// The motion curve, read from the theme once rather than for every flight.
let curve = null;
const easeOut = () => (curve ??= easing("out"));

export const PACE = { fly: 620, flip: 420, flyGap: 70, coin: 520, pass: 520, gather: 360, slide: 760, recap: 1300, deal: 300, dealGap: 45, stage: 520, row: 380, between: 140, bubble: 900 };
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

// A seat's mark beside its colour, so no two seats differ by hue alone: none,
// dots, a stripe, a chevron, and for a bigger table a triangle, a ring and a cross.
const MARKS = [
  "",
  '<circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>',
  '<path d="M3 10h18v4H3z"/>',
  '<path d="M6 9l6 6 6-6" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M12 6.5l5.5 9.5h-11z"/>',
  '<circle cx="12" cy="12" r="4.4" fill="none" stroke-width="2.4"/>',
  '<path d="M10.5 6h3v4.5H18v3h-4.5V18h-3v-4.5H6v-3h4.5z"/>',
];
export function seatMark(p) {
  const node = el("span", { class: `sc-mark p-${p}`, "aria-hidden": "true" });
  node.append(svgNode(`mark ${p}`, () => `<svg viewBox="0 0 24 24" focusable="false"><circle class="disc" cx="12" cy="12" r="11"/><g class="sign">${MARKS[p] ?? ""}</g></svg>`));
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

// A built card in a city: its colour, its effect as icons, and its whole name
// on up to two lines where there's room. Its tip shows it large, in words.
export function chipEl(id, seat = null) {
  const c = CARDS[id];
  return el("span", { class: `sc-chip c-${c.color}`, dataset: { id, tip: "card", tipId: id, ...(seat === null ? {} : { tipSeat: seat }) } }, el("span", { class: "sc-chip-art", "aria-hidden": "true" }, svgNode(`card ${id}:mini`, () => cardSvg(id, { size: "mini" }))), el("span", { class: "sc-chip-name" }, c.name));
}

// The game's icon makers, for the view modules (store, border, war, ring, tips).
export const kit = { resEl, sciEl, coinEl, shieldEl, pointsEl, tokenEl, seatMark, cardEl, chipEl, boardEl };

// The colours a city shows as chips: brown and grey cards stand on the storehouse shelf instead.
export const CITY_COLORS = COLORS.filter((c) => c !== "brown" && c !== "grey");

// A city in columns by colour; empty colours keep a dashed place. A city
// only grows, so set(ids) appends the cards built since; anything else (a
// rematch) draws it again. colors: the columns; seat: whose city, for tips.
export function cityView({ cls = "", colors = CITY_COLORS, seat = null } = {}) {
  const ghost = (c) => el("span", { class: `sc-chip ghost c-${c}`, "aria-hidden": "true" });
  const cols = colors.map((c) => el("div", { class: `sc-col c-${c} empty` }, ghost(c)));
  const node = el("div", { class: `sc-city ${cls}`, dataset: { cols: colors.length } }, cols);
  let shown = [];
  function set(all) {
    const ids = all.filter((id) => colors.includes(CARDS[id].color));
    if (ids.length === shown.length && ids.every((id, i) => id === shown[i])) return false;
    if (ids.length < shown.length || shown.some((id, i) => id !== ids[i])) {
      cols.forEach((col, i) => (col.replaceChildren(ghost(colors[i])), col.classList.add("empty")));
      shown = [];
    }
    for (const id of ids.slice(shown.length)) {
      const col = cols[colors.indexOf(CARDS[id].color)];
      if (col.classList.contains("empty")) col.replaceChildren();
      col.classList.remove("empty");
      col.append(chipEl(id, seat));
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

// Coins, shields and war tokens as tagged stats (their tips explain them).
function statsOf(p) {
  const coins = el("span", { class: "sc-stat coins", dataset: { tip: "coins", tipSeat: p } });
  const sh = el("span", { class: "sc-stat shields", dataset: { tip: "shields", tipSeat: p } });
  const tokens = el("span", { class: "sc-tokens", dataset: { tip: "tokens", tipSeat: p } });
  const shown = {};
  function draw(view) {
    const n = shields(view, p);
    if (shown.coins !== view.coins[p]) coins.replaceChildren(coinEl(view.coins[p]));
    if (shown.shields !== n) sh.replaceChildren(shieldEl(), el("b", {}, String(n)));
    const t = view.tokens[p].join();
    if (shown.tokens !== t) tokens.replaceChildren(...view.tokens[p].map(tokenEl));
    Object.assign(shown, { coins: view.coins[p], shields: n, tokens: t });
  }
  return { coins, shields: sh, tokens, draw };
}

// A seat's whole city in a dialog: its public facts, its wonder, what it
// makes and sells (its brown and grey cards, sources named) and every other
// card built. whereOf(p): "your left neighbour"… Parts are redrawn only when
// they change, so keyboard focus stays on Close while the table moves.
export function cityDialog({ nameOf, whereOf, ageOf = () => 1, me = 0 }) {
  let mark = el("span");
  const title = el("h2", { id: "sc-dialog-title" });
  const where = el("small");
  const close = el("button", { class: "btn small sc-dialog-close", type: "button", onclick: () => node.close() }, "Close");
  const head = el("div", { class: "sc-dialog-head" }, mark, title, where, close);
  const facts = el("p", { class: "sc-dialog-facts" });
  const board = el("div", { class: "sc-dialog-board", role: "img" });
  const shelf = shelfView({ kit, compact: true });
  const shelfWords = el("small", { class: "sc-dialog-makes" });
  const makes = el("div", { class: "sc-dialog-shelf" }, el("span", { class: "sc-label" }, "Makes and sells"), shelf.node, shelfWords);
  const empty = el("p", { class: "sc-hint" }, "No other cards built yet.");
  const list = el("ul", { class: "sr-only" });
  let city = cityView({ cls: "big" });
  const node = el("dialog", { class: "card sc-dialog", id: "sc-dialog", "aria-labelledby": "sc-dialog-title" }, head, facts, board, makes, empty, city.node, list);
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
    const sale = saleOf(view, p, me);
    shelf.update(sale);
    const said = storeWords(sale);
    if (changed("makes", said)) shelfWords.textContent = said;
    if (city.set(ids)) {
      empty.hidden = ids.some((id) => CITY_COLORS.includes(CARDS[id].color));
      list.replaceChildren(...ids.map((id) => el("li", {}, cardWords(id))));
    }
  }
  // Shows seat p's city, or brings it up to date.
  function open(p, view) {
    if (!view) return;
    if (seat !== p) {
      seat = p;
      shown = {};
      const fresh = cityView({ cls: "big", seat: p });
      city.node.replaceWith(fresh.node);
      city = fresh;
      empty.hidden = false;
      list.replaceChildren();
      head.className = `sc-dialog-head p-${p}`;
      const m = seatMark(p);
      mark.replaceWith(m);
      mark = m;
      title.textContent = p === me ? "Your city" : `${nameOf(p)}'s city`;
      where.textContent = whereOf(p);
    }
    draw(view);
    if (!node.open) node.showModal();
    close.focus();
  }
  return { node, open, draw, close: () => node.open && node.close() };
}

// The score so far, as the final sheet would add it up now (tapping your name).
export function scoreDialog({ me, nameOf }) {
  const close = el("button", { class: "btn small sc-dialog-close", type: "button", onclick: () => node.close() }, "Close");
  const box = el("div", { class: "sc-sheet-box" });
  const node = el("dialog", { class: "card sc-dialog sc-score-now", id: "sc-score-now", "aria-labelledby": "sc-score-title" }, el("div", { class: "sc-dialog-head" }, el("h2", { id: "sc-score-title" }, "The score so far"), close), el("p", { class: "sc-dialog-facts" }, "If the game ended now. Coins count 1 point for every 3, and science and guilds count what is built."), box);
  node.addEventListener("click", (e) => e.target === node && node.close());
  let key = "";
  function draw(view) {
    if (!node.open || !view?.age) return;
    const seats = [...Array(view.players).keys()];
    const scores = seats.map((p) => score(view, p));
    const now = JSON.stringify(scores);
    if (now === key) return;
    key = now;
    const order = seats.slice().sort((a, b) => (a === me ? -1 : b === me ? 1 : scores[b].total - scores[a].total || a - b));
    const sheet = scoreSheet(scores, order, { me, nameOf, caption: "The score so far" });
    sheet.node.removeAttribute("id");
    box.replaceChildren(sheet.node);
  }
  function open(view) {
    key = "";
    if (!node.open) node.showModal();
    draw(view);
    close.focus();
  }
  return { node, open, draw, close: () => node.open && node.close() };
}

// "1 wood (Woodcutter's Camp) and stone or clay (Dig Site)": a sale shelf with its sources.
const storeWords = (shelf) => {
  const parts = [];
  shelf.fixed.forEach((n, r) => n && parts.push(`${n} ${RES_NAMES[r]} (${listOf(shelf.sources[r])})`));
  for (const e of shelf.either) parts.push(`${e.options.map((r) => RES_NAMES[r]).join(" or ")} (${e.source})`);
  return parts.length ? `${listOf(parts)}.` : "Nothing yet.";
};

// The science tracker: a pile for each symbol and what the next one adds.
export function scienceWords(view, p) {
  const { counts, wilds } = scienceSymbols(view, p);
  const now = sciencePoints(counts, wilds);
  const gains = counts.map((k, i) => sciencePoints(counts.with(i, k + 1), wilds) - now);
  const best = Math.max(...gains);
  const which = SCI_NAMES.filter((_, i) => gains[i] === best);
  return { counts, wilds, now, best, which, line: `${plural(now, "point")} now, the next ${which.length === 3 ? "symbol" : listOf(which).replace(/ and /, " or ")} adds ${best}` };
}

// What a neighbour's pick means for you, in a line under it as it turns over:
// "+1 shield on your left border", "now sells ore", "pays you 2 coins".
export function recapWords(view, me, x) {
  const side = x.p === leftOf(view, me) ? "left" : x.p === rightOf(view, me) ? "right" : null;
  const card = CARDS[x.id];
  if (!side || !card || x.type !== "build") return "";
  const parts = [];
  const units = (us) => listOf(us.map((u) => u.map((r) => RES_NAMES[r]).join(" or ")));
  if (card.shields) parts.push(`+${plural(card.shields, "shield")} on your ${side} border`);
  else if (card.produce) parts.push(card.color === "brown" || card.color === "grey" ? `now sells ${units(card.produce)}` : `makes ${units(card.produce)} for itself`);
  else if (card.trade) {
    const facing = leftOf(view, x.p) === me ? "left" : "right";
    const kinds = card.trade.kinds.length === RAW.length ? "raw materials" : "goods";
    parts.push(card.trade.sides.includes(facing) ? `buys your ${kinds} for 1 coin now` : `buys ${kinds} cheaper on its other side`);
  } else if (card.science !== undefined) parts.push(card.science === "any" ? "any science symbol, at the end" : `a ${SCI_NAMES[card.science]} for their science`);
  else if (card.points) parts.push(`${plural(card.points, "point")} for them at the end`);
  else if (card.gold) parts.push(`${plural(card.gold, "coin")} for them from the bank`);
  else if (card.income) parts.push(`coins for each ${card.income.per === "stage" ? "wonder stage" : `${card.income.per} card`}`);
  else parts.push(effectWords(card));
  const paid = (leftOf(view, x.p) === me ? x.bought?.left : 0) || (rightOf(view, x.p) === me ? x.bought?.right : 0) || 0;
  if (paid) parts.push(`pays you ${plural(paid, "coin")}`);
  return parts.join(" · ");
}

// ---------- tips ----------
// The legend's border pieces, cut from the real border art.
const CROPS = { ferry: "86 28 68 34", bridge: "86 28 68 34", stall: "44 30 56 28", walls: "28 12 76 38" };
function borderCrop(name) {
  if (name === "flags") return el("span", { class: "sc-border-flags sc-legend-flags", "aria-hidden": "true" }, el("i", { class: "won" }), el("i", { class: "lost" }), el("i", { class: "draw" }), el("i", { class: "open" }));
  if (!CROPS[name]) return null;
  const markup = borderSvg({ side: "left", raw: name === "bridge" ? 1 : 2, goods: name === "stall" ? 1 : 2, walls: name === "walls" ? [6, 0] : [0, 0], seats: [1, 0] })
    .replace(/<rect[^>]*sc-b-hot[^>]*\/>/g, "")
    .replace(/viewBox="[^"]*"/, `viewBox="${CROPS[name]}"`)
    .replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true"');
  const node = el("span", { class: `sc-legend-art g-${name}`, "aria-hidden": "true" });
  node.innerHTML = markup;
  return node;
}
const BADGE_LABELS = { make: "You make it", free: "Free", chain: "Chain · free", wonder: "Wonder · free", pay: "3 coins", no: "Can't build" };
// A badge as in your hand, but one the legend shows rather than explains.
function legendBadge(kind) {
  const node = badgeEl({ kind, coins: 3, label: BADGE_LABELS[kind] ?? "" }, kit);
  for (const k of Object.keys(node.dataset)) delete node.dataset[k];
  return node;
}

// One tip layer over a table: every data-tip under root explains itself from
// the table as drawn (view()); bar: where Explain mode's bar sits; memory:
// the first-time hints' store (tips.js hints()), or one that has seen them all.
export function explainer(root, { view, me, nameOf, bar = true, memory = hints(), onExplain = () => {}, focusBack = null }) {
  return tipLayer(root, {
    focusBack,
    words: (kind, t) => (view() ? tipWords(kind, argsOf(t), { state: view(), me, nameOf }) : null),
    kit,
    bar,
    hints: memory,
    onExplain,
    legendIcons: { badge: legendBadge, art: borderCrop },
  });
}
export const seenAll = { seen: () => true, mark() {} };

// ---------- the table ----------
// table: engine/cards/table.js (the queue, the fly layer, bubbles).
// me, players; nameOf(p); onSeat(p) opens a seat's city; onScore() the
// score so far; ageOf(slot): the age of a card tucked under a wonder, which
// its back shows; sound(name, opts, at); wars(): each war's results by age
// as the screen has shown them, for the borders' flags.
export function scTable(table, { me, players, nameOf, onSeat = () => {}, onScore = () => {}, ageOf = () => 1, sound = () => {}, wars = () => [] }) {
  const { live, fast, wait, flyLayer, rectIn } = table;
  const around = seatsAround(players, me);
  const order = [around.left, around.right, around.across].filter((p) => p >= 0 && p !== me);
  const shows = (node) => !!node && node.getClientRects().length > 0;
  const rectOn = (...nodes) => rectIn(nodes.find(shows) ?? nodes.at(-1));

  // A border's sounds: a cart rolls over the bridge, or the ferry carries it.
  const borderSound = (side) => (name, opts) => (name === "cart" ? sound("cart", { way: borders.get(side)?.raw === 1 ? "bridge" : "ferry" }) : sound(name, opts));
  const borders = new Map();

  // ---------- the neighbours' panels ----------
  // Their stats, colour counts and wonder, their hand as a stack in its slot
  // (their pick dropped on it), their city, and at the foot the border
  // between you: the river, its crossing and price, what they sell on their
  // bank, both banks' walls and the war flags.
  function seatPanel(p, side) {
    const at = (kind, more = {}) => ({ tip: kind, tipSeat: p, ...more });
    const head = el("span", { class: "sc-seat-name" }, seatMark(p), el("b", {}, nameOf(p)));
    const wonderName = el("span", { class: "sc-seat-wonder" });
    const arrow = el("span", { class: `sc-seat-arrow ${side}`, "aria-hidden": "true" });
    const stats = statsOf(p);
    const dots = el("span", { class: "sc-stage-dots", "aria-hidden": "true", dataset: at("stages") });
    const counts = el("span", { class: "sc-counts", "aria-hidden": "true", dataset: at("counts") }, COLORS.map((c) => el("span", { class: `sc-count c-${c}` }, "0")));
    const wonder = el("div", { class: "sc-seat-board", "aria-hidden": "true", dataset: at("stages") });
    const stack = stackEl(1, 0);
    const slot = el("span", { class: "sc-stack-slot md", dataset: at("back", { tipWhere: "stack" }) }, stack);
    const pick = el("span", { class: "sc-pickmark", "aria-hidden": "true", hidden: true, dataset: at("back", { tipWhere: "pick" }) }, cardEl(null));
    const hand = el("span", { class: "sc-seat-hand" }, slot, pick);
    const cityBox = el("div", { class: "sc-seat-city" });
    const open = el("button", { class: "sc-seat-open", type: "button", onclick: () => onSeat(p) }, arrow, head, wonderName);
    const border = borderView({ side, kit, sound: borderSound(side) });
    border.raw = 2;
    borders.set(side, border);
    const node = el(
      "section",
      { class: `sc-seat p-${p} ${side}`, dataset: { seat: p } },
      el("header", { class: "sc-seat-head" }, open),
      el("div", { class: "sc-seat-stats" }, el("span", { class: "sc-seat-nums" }, stats.coins, stats.shields, stats.tokens, dots), hand),
      border.node,
      counts,
      wonder,
      el("div", { class: "sc-seat-city-box" }, el("span", { class: "sc-label" }, `${nameOf(p)}'s city`), cityBox),
    );
    // The whole panel opens the city (but its border); its name is the button keyboards and screen readers use.
    node.addEventListener("click", (e) => !e.target.closest(".sc-seat-open, .sc-border") && onSeat(p));
    // Each part is redrawn only when what it shows changes: boards and city chips are big markup.
    const shown = {};
    const changed = (part, value) => shown[part] !== value && ((shown[part] = value), true);
    const city = cityView({ seat: p });
    cityBox.append(city.node);
    function draw(view, { picked = false, coming = false } = {}) {
      pick.hidden = !picked;
      slot.classList.toggle("coming", coming);
      const w = view.wonders[p];
      const W = WONDERS[w.w];
      const built = view.stages[p].length;
      const ids = view.city[p].map((x) => x.id);
      stats.draw(view);
      const n = view.hands[p].length;
      if (changed("stack", `${view.age}:${n}`)) {
        setStack(stack, view.age, n);
        slot.dataset.tipCount = String(n);
      }
      const board = `${w.w}:${w.side}:${built}`;
      if (changed("board", board)) {
        wonderName.textContent = `${W.city} ${w.side}`;
        const total = stagesOf(view, p).length;
        dots.replaceChildren(...Array.from({ length: total }, (_, i) => el("i", { class: i < built ? "on" : "" })));
        wonder.replaceChildren(boardEl(w.w, w.side, built, { mini: true }));
      }
      if (city.set(ids) || changed("cols", ids.length)) {
        const cols = cityColumns(ids);
        [...counts.children].forEach((c, i) => {
          c.textContent = cols[i].length ? String(cols[i].length) : "";
          c.classList.toggle("none", !cols[i].length);
        });
      }
      const facts = borderFacts(view, me, side, { wars: wars() });
      border.raw = facts.raw;
      if (changed("border", JSON.stringify(facts))) border.update({ ...facts, name: nameOf(p) });
      const label = `${nameOf(p)}, your ${side} neighbour, ${W.name} side ${w.side}, ${seatWords(view, p)}, ${plural(n, "card")} in hand. Show their city`;
      if (changed("label", label)) open.setAttribute("aria-label", label);
    }
    const rects = {
      pick: () => rectIn(pick.hidden ? slot : pick),
      coins: () => rectIn(stats.coins),
      // Brown and grey cards go to the shelf on their bank; the rest to their city, or its count on a phone.
      city: (color) => (color === "brown" || color === "grey" ? rectOn(border.sells, border.node) : rectOn(cityBox.querySelector(`.sc-col.c-${color} .sc-chip:last-child`), counts.children[COLORS.indexOf(color)] ?? counts)),
      wonder: () => rectOn(wonder, dots, node),
      tokens: () => rectIn(stats.tokens.lastChild ?? stats.shields),
      seat: () => rectIn(node),
      slot: () => rectIn(slot),
      // Where their pick stays a beat as it turns over: under the border
      // (which shows what it changes), or the top of a short panel.
      recap: () => {
        const r = rectIn(node);
        const b = rectIn(border.node);
        const under = b.y + b.h + 4;
        return { x: r.x, y: r.y + r.h - under >= 160 ? under : r.y + 52, w: r.w, h: 150 };
      },
    };
    return { p, node, draw, rects, pick, slot, stack, border, city: cityBox };
  }

  // Everyone else: a pill with their mark, name, coins and shields, and their hand as a small stack.
  function seatPill(p) {
    const stats = statsOf(p);
    const stack = stackEl(1, 0);
    const slot = el("span", { class: "sc-stack-slot sm", dataset: { tip: "back", tipWhere: "stack", tipSeat: p } }, stack);
    const pick = el("span", { class: "sc-pickmark pill", "aria-hidden": "true", hidden: true }, cardEl(null));
    const where = p === around.across ? "across" : "not a neighbour";
    const node = el(
      "button",
      { class: `sc-across-pill p-${p}`, type: "button", id: p === around.across ? "sc-across" : null, dataset: { seat: p, tip: "seat", tipSeat: p }, onclick: () => onSeat(p) },
      seatMark(p),
      el("span", { class: "sc-across-words" }, el("b", {}, nameOf(p)), el("small", {}, where)),
      el("span", { class: "sc-across-stats", "aria-hidden": "true" }, stats.coins, stats.shields),
      el("span", { class: "sc-seat-hand" }, slot, pick),
    );
    let shownN = "";
    function draw(view, { picked = false } = {}) {
      pick.hidden = !picked;
      stats.draw(view);
      const n = view.hands[p].length;
      if (shownN !== `${view.age}:${n}`) {
        shownN = `${view.age}:${n}`;
        setStack(stack, view.age, n);
        slot.dataset.tipCount = String(n);
      }
      node.setAttribute("aria-label", `${nameOf(p)}, ${p === around.across ? "across the table" : "further round the table"} (not a neighbour), ${seatWords(view, p)}, ${plural(n, "card")} in hand. Show their city`);
    }
    const r = () => rectIn(node);
    const rects = { pick: () => rectIn(slot), coins: () => rectIn(stats.coins), city: r, wonder: r, tokens: r, seat: r, slot: () => rectIn(slot) };
    return { p, node, draw, rects, pick, slot, stack, pill: true };
  }

  const panels = new Map();
  if (around.left !== me) panels.set(around.left, seatPanel(around.left, "left"));
  if (around.right !== me && around.right !== around.left) panels.set(around.right, seatPanel(around.right, "right"));
  const others = [...Array(players).keys()].filter((p) => !panels.has(p) && p !== me);
  for (const p of others) panels.set(p, seatPill(p));
  const pillBox = el("div", { class: "sc-pills" }, others.map((p) => panels.get(p).node));

  // ---------- your wonder, the seat ring, your science and your city ----------
  const meStats = statsOf(me);
  const myScore = el("small", { class: "sc-me-score" });
  const nameBtn = el("button", { class: "sc-me-name", type: "button", id: "sc-me-name", dataset: { tip: "score", tipSeat: me }, onclick: () => onScore() }, seatMark(me), el("b", {}, "You"), myScore);
  const meWonderName = el("span", { class: "sc-me-wonder" });
  const meStatsRow = el("div", { class: "sc-me-stats", role: "group" }, nameBtn, meWonderName, el("span", { class: "sc-grow" }), meStats.coins, meStats.shields, meStats.tokens);
  const boardBox = el("div", { class: "sc-board", id: "sc-board", role: "img" });
  const ring = seatRing({ kit, nameOf });
  const sciPiles = el("span", { class: "sc-sci-piles", "aria-hidden": "true" });
  const sciLine = el("span", { class: "sc-sci-line" });
  const sci = el("div", { class: "sc-sci", id: "sc-sci", hidden: true, dataset: { tip: "science", tipSeat: me } }, el("span", { class: "sc-label" }, "Science"), sciPiles, sciLine);
  const myCity = el("div", { class: "sc-my-city", role: "img" });
  const cityBox = el("section", { class: "sc-city-box", "aria-label": "Your city" }, el("div", { class: "sc-city-head" }, el("h2", { class: "sc-title" }, "Your city"), sci), myCity);
  // The ring sits in the top bar (main.js puts ringBox there).
  const ringBox = el("div", { class: "sc-me-ring" }, ring.node);
  const mine = el("section", { class: "sc-mine", "aria-label": "Your wonder and city" }, meStatsRow, boardBox, cityBox);
  const myPick = el("span", { class: "sc-pickmark mine", "aria-hidden": "true", hidden: true }, cardEl(null));
  boardBox.append(myPick);
  const mineShown = {};
  const mineChanged = (part, value) => mineShown[part] !== value && ((mineShown[part] = value), true);
  const myCityView = cityView({ cls: "mine", seat: me });
  myCity.append(myCityView.node);
  const shelf = shelfView({ kit });
  shelf.node.id = "sc-shelf";
  let myBuilt = -1;
  function drawMine(view) {
    const w = view.wonders[me];
    const W = WONDERS[w.w];
    const ids = view.city[me].map((x) => x.id);
    const built = view.stages[me].length;
    const sh = shields(view, me);
    meStats.draw(view);
    const facts = `You: ${W.name}, side ${w.side}, ${plural(view.coins[me], "coin")}, ${plural(sh, "shield")}, ${view.tokens[me].length ? `war tokens ${view.tokens[me].map(signed).join(" ")}` : "no war tokens"}`;
    if (mineChanged("facts", facts)) meStatsRow.setAttribute("aria-label", facts);
    const total = view.age ? score(view, me).total : 0;
    if (mineChanged("score", total)) {
      myScore.textContent = view.age ? plural(total, "point") : "";
      nameBtn.setAttribute("aria-label", view.age ? `You, ${plural(total, "point")} so far. Show the score so far` : "You");
    }
    const tucked = view.stages[me].map(ageOf);
    if (mineChanged("board", `${w.w}:${w.side}:${built}:${tucked.join("")}`)) {
      meWonderName.textContent = `${W.name} · ${w.side}`;
      const art = el("span", { class: "sc-board-art" });
      art.append(boardEl(w.w, w.side, built, { tucked }));
      // Each stage explains itself.
      art.querySelectorAll(".sc-stage[data-stage]").forEach((g) => Object.assign(g.dataset, { tip: "slot", tipStage: g.dataset.stage, tipSeat: me }));
      // The stage just built pops in (pieces.css).
      if (myBuilt >= 0 && built > myBuilt) art.querySelector(`.sc-stage[data-stage="${built - 1}"]`)?.classList.add("sc-new");
      myBuilt = built;
      boardBox.replaceChildren(art, myPick);
      const stages = stagesOf(view, me);
      boardBox.setAttribute("aria-label", `Your wonder, ${W.name}, side ${w.side}: makes ${RES_NAMES[W.produce]}. ${built} of ${stages.length} stages built. ${stages.map((s, n) => `${n < built ? "Built" : "To build"}: ${stageWords(s, n)}`).join(" ")}`);
    }
    if (myCityView.set(ids) || !myCity.hasAttribute("aria-label")) {
      const scoring = cityColumns(ids).flatMap((col, i) => (col.length && CITY_COLORS.includes(COLORS[i]) ? [`${COLOR_NAMES[COLORS[i]]}: ${listOf(col.map((id) => CARDS[id].name))}`] : []));
      myCity.setAttribute("aria-label", scoring.length ? `Your city: ${scoring.join("; ")}` : "Your city has no cards yet but what is on your shelf");
    }
    const s = scienceWords(view, me);
    const sciKey = `${s.counts.join()}:${s.wilds}`;
    if (mineChanged("sci", sciKey)) {
      sci.hidden = !(s.wilds || s.counts.some(Boolean));
      sciPiles.replaceChildren(...s.counts.map((k, i) => el("span", { class: `sc-sci-pile${k ? "" : " none"}` }, sciEl(i), el("b", {}, String(k)))), ...(s.wilds ? [el("span", { class: "sc-sci-pile" }, sciEl("any"), el("b", {}, String(s.wilds)))] : []));
      sciLine.textContent = s.line;
      sci.setAttribute("aria-label", `Science: ${listOf(s.counts.map((k, i) => plural(k, SCI_NAMES[i])))}${s.wilds ? ` and ${plural(s.wilds, "any symbol")}` : ""}. ${s.line}.`);
    }
  }
  // Your shelf: what you make each turn, lit by the cost of the card you look at.
  const drawShelf = (view, light = {}) => shelf.update(shelfOf(view, me), light);
  // The ring: every seat, its stack, this age's way and its turns.
  function drawRing(view) {
    const count = view.hands.map((h) => h.length);
    const key = `${view.age}:${view.round}:${count.join(",")}`;
    if (mineChanged("ring", key)) ring.update({ players, me, age: view.age, round: Math.min(view.round, ROUNDS), count });
  }
  const mineRects = {
    pick: () => rectIn(myPick.hidden ? boardBox : myPick),
    coins: () => rectIn(meStats.coins),
    city: (color) => (color === "brown" || color === "grey" ? rectOn(shelf.node.querySelector(".sc-slot.use") ?? shelf.node, shelf.node, myCity) : rectIn(myCity.querySelector(`.sc-col.c-${color} .sc-chip:last-child`) ?? myCity)),
    wonder: () => rectIn(boardBox),
    tokens: () => rectIn(meStats.tokens.lastChild ?? meStats.shields),
    seat: () => rectIn(mine),
  };

  // ---------- where things are ----------
  const bankBox = el("span", { class: "sc-bank", "aria-hidden": "true", dataset: { tip: "bank" } }, coinPieceEl(3), coinPieceEl(1));
  const pile = el("span", { class: "sc-pile", role: "img", dataset: { tip: "discard" } }, cardEl(null, { age: 1, size: "mini" }), el("b", { class: "mono" }, "0"));
  function drawPile(view) {
    const n = view.discard.length;
    if (pile.lastChild.textContent !== String(n)) pile.lastChild.textContent = String(n);
    pile.classList.toggle("empty", !n);
    const age = Math.max(1, view.age);
    if (pile.dataset.age !== String(age)) {
      pile.dataset.age = String(age);
      pile.firstChild.replaceWith(cardEl(null, { age, size: "mini" }));
    }
    pile.setAttribute("aria-label", `Discard pile: ${plural(n, "card")}, face down`);
  }
  // Every seat's panel or pill, with what it shows: picked, and the stack coming to you marked.
  function drawSeats(view, { picked = () => false, coming = null } = {}) {
    for (const [p, panel] of panels) panel.draw(view, { picked: picked(p), coming: p === coming });
    ring.mark(coming);
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

  // Where seat q's cards that an income card counts are on screen: chips in
  // a city, the shelf for brown and grey cards, a wonder's built stages.
  function countedNodes(view, q, per) {
    const panel = q === me ? null : panels.get(q);
    if (q !== me && (!panel || panel.pill)) return [];
    if (per === "stage") return q === me ? [...boardBox.querySelectorAll(".sc-stage")].slice(0, view.stages[q].length) : [...panel.node.querySelectorAll(".sc-stage-dots i.on")].filter(shows).concat(shows(panel.node.querySelector(".sc-seat-board")) ? Array(view.stages[q].length).fill(panel.node.querySelector(".sc-seat-board")) : []);
    const colours = [per].flat();
    const out = [];
    for (const c of colours) {
      if (c === "brown" || c === "grey") {
        const box = q === me ? shelf.node : panel.border.sells;
        for (const card of view.city[q].map((x) => CARDS[x.id]).filter((x) => x.color === c)) {
          const u = card.produce?.[0] ?? [];
          const node = q !== me ? (u.length === 1 ? box.querySelector(`.sc-border-unit:not(.either):not([hidden]) .r-${u[0]}`)?.parentNode : null) : u.length > 1 ? [...box.querySelectorAll(".sc-slot.either")].find((s) => s.dataset.tipRes === u.join(",")) : box.querySelector(`.sc-slot.r-${u[0]}`);
          out.push(node ?? box);
        }
      } else {
        const box = q === me ? myCity : panel.city;
        const chips = [...box.querySelectorAll(`.sc-chip.c-${c}:not(.ghost)`)].filter(shows);
        out.push(...(chips.length ? chips : Array(view.city[q].filter((x) => CARDS[x.id].color === c).length).fill(panel?.node.querySelector(`.sc-count.c-${c}`) ?? box)));
      }
    }
    // Only what is on screen (your shelf hides while your hand is folded).
    return out.filter(shows);
  }
  // A card of yours that a lesson points at: its chip, or its shelf slot.
  function chipFor(id) {
    const chip = myCity.querySelector(`.sc-chip[data-id="${id}"]`);
    if (chip) return chip;
    const u = CARDS[id]?.produce?.[0];
    if (!u) return cityBox;
    return (u.length > 1 ? [...shelf.node.querySelectorAll(".sc-slot.either")].find((s) => s.dataset.tipRes === u.join(",")) : shelf.node.querySelector(`.sc-slot.r-${u[0]}`)) ?? shelf.node;
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
    const s0 = Math.max(0.35, Math.min(1.25, from.w / w));
    const lift = Math.min(70, Math.hypot(x1 - x0, y1 - y0) * 0.18 + 14);
    const at = (x, y, s, r) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(1)}deg) scale(${s.toFixed(3)})`;
    const spin = ((Math.round(x0 + y1) % 9) - 4) * 0.8;
    const motion = node.animate(
      [
        { transform: at(x0, y0, s0, 0), opacity: 1 },
        { transform: at((x0 + x1) / 2, Math.min(y0, y1) - lift, ((s0 + s1) / 2) * 1.08, spin), opacity: 1, offset: 0.5 },
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

  // Where a seat's pick turns over: a card big enough to read (bigger for a
  // neighbour's, which stays a beat), centred on its pick mark, kept inside
  // the table's edges (the fly layer clips).
  function flipRect(rect, big = false) {
    const w = big ? Math.max(72, Math.min(104, rect.w * 3)) : Math.max(52, Math.min(84, rect.w));
    const h = w * 1.4;
    return { x: Math.max(4, Math.min(flyLayer.clientWidth - w - 4, rect.x + rect.w / 2 - w / 2)), y: Math.max(4, rect.y + rect.h / 2 - h / 2), w, h };
  }
  // Cards turn over where they lie, together: [{ id, age, rect, caption }].
  // A card with a caption stays up for `hold` ms with its line under it.
  async function flipAll(cards, { g, ms = PACE.flip, hold = 0 }) {
    if (fast() || !live(g) || !cards.length) return;
    const nodes = cards.map(({ id, age, rect, caption }) => {
      const r = flipRect(rect, !!caption);
      const node = turnCardEl(id, age, { down: true });
      node.classList.add("sc-fly-card");
      node.style.width = `${r.w}px`;
      node.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`;
      flyLayer.append(node);
      let note = null;
      if (caption) {
        note = el("span", { class: "sc-recap" }, caption);
        flyLayer.append(note);
        // As wide as its panel allows, so two neighbours' lines never overlap.
        const nw = Math.min(190, Math.max(r.w + 16, rect.w - 8), flyLayer.clientWidth - 8);
        note.style.width = `${nw}px`;
        note.style.transform = `translate(${Math.max(4, Math.min(flyLayer.clientWidth - nw - 4, r.x + r.w / 2 - nw / 2)).toFixed(1)}px, ${(r.y + r.h + 6).toFixed(1)}px)`;
        note.animate([{ opacity: 0, translate: "0 -6px" }, { opacity: 1, translate: "0 0" }], { duration: 260, delay: ms * 0.8, easing: easeOut(), fill: "backwards" });
      }
      return { node, note, up: id >= 0 };
    });
    await Promise.all(
      nodes.map(({ node, up }) => {
        const inner = node.querySelector(".in");
        const lift = node.animate([{ translate: "0 0" }, { translate: "0 -10px", offset: 0.5 }, { translate: "0 0" }], { duration: ms * 1.3, easing: easeOut(), composite: "add" });
        const turn = up ? inner.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], { duration: ms, delay: ms * 0.15, easing: easeOut(), fill: "forwards" }) : null;
        return Promise.all([lift.finished.catch(() => {}), turn?.finished.catch(() => {})]);
      }),
    );
    await wait(Math.max(ms * 0.6, nodes.some((x) => x.note) ? hold : 0), g);
    nodes.forEach(({ node, note }) => (node.remove(), note?.remove()));
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
  // A counted card lights up.
  function flash(node, delay = 0) {
    if (!node || fast()) return;
    node.animate([{ filter: "none", transform: "scale(1)" }, { filter: "brightness(1.25) drop-shadow(0 0 6px var(--sc-lamp))", transform: "scale(1.12)", offset: 0.35 }, { filter: "none", transform: "scale(1)" }], { duration: 700, delay, easing: easeOut() });
  }

  const warView = warScene({ kit, nameOf, sound });

  return {
    around,
    order,
    panels,
    pillBox,
    borders,
    mine,
    myPick,
    boardBox,
    cityBox,
    myCity,
    shelf: shelf.node,
    ring,
    ringBox,
    war: warView,
    nameBtn,
    bankBox,
    pile,
    drawMine,
    drawShelf,
    drawRing,
    drawSeats,
    drawPile,
    rectsOf,
    countedNodes,
    chipFor,
    bankRect: () => rectIn(bankBox),
    pileRect: () => rectIn(pile),
    slotRect: (p) => panels.get(p)?.rects.slot() ?? null,
    stackOf: (p) => panels.get(p)?.stack ?? null,
    centre,
    flyCard,
    flipRect,
    flipAll,
    flyCoins,
    bump,
    flash,
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
export function scoreSheet(scores, order, { me, nameOf, winners = [], caption = "Final scores" }) {
  const won = (p) => winners.includes(p);
  const head = el("tr", {}, el("th", { scope: "col" }, el("span", { class: "sr-only" }, "Row")), ...order.map((p) => el("th", { scope: "col", class: `p-${p} ${p === me ? "mine" : ""} ${won(p) ? "best" : ""}`, dataset: { tip: "score", tipSeat: p } }, el("span", { class: "who" }, seatMark(p), el("span", { class: "nm" }, p === me ? "You" : nameOf(p))))));
  const cells = [];
  const rows = SCORE_ROWS.map(([key, label, note]) => {
    const tds = order.map((p) => el("td", { class: `${p === me ? "mine" : ""} ${key === "total" && won(p) ? "best" : ""} ${scores[p][key] ? "" : "zero"}` }, String(scores[p][key])));
    cells.push(tds);
    return el("tr", { class: `r-${key}` }, el("th", { scope: "row" }, el("span", { class: "lbl" }, ROW_ICON[key]?.(), label), note ? el("small", {}, note) : null), ...tds);
  });
  const node = el("table", { class: "sc-sheet done", id: "sc-sheet" }, el("caption", { class: "sr-only" }, caption), el("thead", {}, head), el("tbody", {}, rows.slice(0, -1)), el("tfoot", {}, rows.at(-1)));
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
const bought = (buy) => !!buy && sum(buy.left) + sum(buy.right) > 0;

// A selected card's cost against your shelf: the units ({ units, light }) of
// the build, or of the stage when the build costs no resources; null when
// there is nothing to match.
export function costMatch(state, me, o, b, s) {
  if (!o || !state) return null;
  const c = o.card;
  if (!o.build.chain && o.build.why !== "duplicate" && sum(c.cost.res)) {
    const units = matchCost(state, me, c.cost, b?.ok ? b.buy : null);
    return { units, light: highlightOf(units), kind: "build", buys: bought(b?.ok && b.buy) };
  }
  // A card that costs nothing lights nothing; one you can't build (you have it) lights the stage it could raise.
  const stage = o.stage?.stage;
  if (stage && o.build.why === "duplicate" && sum(stage.cost.res) && o.stage.why !== "built") {
    const units = matchCost(state, me, stage.cost, s?.ok ? s.buy : null);
    return { units, light: highlightOf(units), kind: "stage", buys: bought(s?.ok && s.buy) };
  }
  return null;
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

// The card picked: what it does, its cost matched unit by unit against your
// shelf and your neighbours' (or why you can't build it), and the next
// wonder stage. b, s: its plans (null to show the card alone); onOther(kind)
// steps to the next way to pay for a build or a stage; state, me: for the match.
export function detailNodes(o, b, s, names, { onOther = () => {}, state = null, me = 0 } = {}) {
  if (!o) return [];
  const c = o.card;
  const from = chainsFrom(c);
  const other = (id, kind, ways, what) => el("button", { class: "btn sc-act small link", type: "button", id, "aria-label": `Other way to pay for ${what} (${ways} ways)`, onclick: () => onOther(kind) }, el("span", { class: "sc-act-words" }, el("span", { class: "lbl" }, "Other way to pay")));
  const badge = state && o.build ? badgeEl(badgeOf(o), kit) : null;
  const lines = [
    el("div", { class: `sc-detail-head c-${c.color}` }, el("strong", { class: "sc-detail-name" }, c.name), effectEl(c), badge),
    el("p", { class: "sc-detail-fx" }, effectWords(c), from.length && !o.build.chain ? el("small", { class: "sc-chain-from" }, ` Free with ${listOf(from)}.`) : null),
  ];
  const match = state && !o.build.chain && o.build.why !== "duplicate" && !(o.free && !o.build.purchases?.length) && (sum(c.cost.res) || c.cost.coins);
  if (match) {
    const units = sum(c.cost.res) ? matchCost(state, me, c.cost, b?.ok ? b.buy : null) : [];
    lines.push(costMatchEl(units, names, kit, { bank: c.cost.coins }));
  } else if (!state || !b) lines.push(el("p", { class: "sc-detail-cost" }, ...(costWords(c.cost) === "free" ? [el("span", { class: "k" }, "Free to build")] : [el("span", { class: "k" }, "Costs"), costEl(c.cost), el("span", {}, costWords(c.cost))])));
  if (b) {
    if (o.build.chain) lines.push(el("p", { class: "sc-detail-pay ok" }, `Free: you have ${listOf(from)}.`));
    else if (b.ok) {
      if (!match) lines.push(el("p", { class: "sc-detail-pay ok" }, c.cost.coins ? `Pay ${plural(c.cost.coins, "coin")} to the bank.` : sum(c.cost.res) ? "You make everything it needs." : "It costs nothing."));
      if (b.ways > 1) lines.push(other("sc-other", "build", b.ways, c.name));
    } else if (o.free) lines.push(el("p", { class: "sc-detail-pay ok" }, "You can't pay for it, but your wonder's free build can build it."));
    else if (o.build.why !== "resources" || !match) lines.push(el("p", { class: "sc-detail-pay no" }, `${whyWords(o.build.why, c)}.`));
  }
  if (chainsTo(c).length) lines.push(el("p", { class: "sc-chain-to" }, `Makes ${listOf(chainsTo(c))} free later.`));
  const stage = s && o.stage.stage;
  if (stage) {
    const words = s.ok && s.buy && buyWords(s.buy, names);
    lines.push(el("p", { class: "sc-detail-stage" }, el("span", { class: "k" }, `Stage ${ROMAN[o.stage.n + 1]}`), costEl(stage.cost), el("span", { class: "sc-arrow" }, "→"), effectEl(stage), el("small", {}, ` ${effectWords(stage)}.${s.ok ? (words ? ` ${words} for ${plural(s.side.left + s.side.right, "coin")}.` : "") : ` ${whyWords(o.stage.why)}.`}`)));
    if (s.ok && s.ways > 1) lines.push(other("sc-other-stage", "stage", s.ways, "the wonder stage"));
  }
  return lines.filter(Boolean);
}

// Your hand: a row of cards that turn over as their faces arrive, each with
// its badge (what building it would take). Arrows, Home and End move along
// it; a click, Enter or Space picks a card (onSelect(slot)).
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
    const hadFocus = node.contains(document.activeElement) ? Number(document.activeElement.closest(".sc-hcard")?.dataset.slot) : null;
    for (const [slot, b] of cards) {
      if (slots.includes(slot) && b.dataset.dig === String(dig)) continue;
      b.remove();
      cards.delete(slot);
    }
    slots.forEach((slot, i) => {
      const id = idOf(slot);
      let b = cards.get(slot);
      if (!b) {
        b = el("button", { class: "sc-hcard", type: "button", "aria-keyshortcuts": "i", dataset: { slot, dig: String(dig), tip: "card", tipWhere: dig ? "dig" : "hand", tipOn: "hold" } }, turnCardEl(id, age, { down: id < 0 }));
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
      if (id >= 0) b.dataset.tipId = String(id);
      else delete b.dataset.tipId;
      const o = !dig && id >= 0 ? options(slot) : null;
      const can = dig ? !!legal?.has(slot) : !!o && (o.build.ok || o.free);
      // Its badge: kept while the table moves (no options then), gone with its face.
      const badge = id < 0 ? null : dig ? (legal ? (can ? { id, kind: "free", coins: 0, label: "Free", where: "dig" } : { id, kind: "no", coins: 0, label: "Already built", where: "dig" }) : undefined) : o ? badgeOf({ ...o, id }) : undefined;
      const bkey = badge ? `${badge.kind}:${badge.coins}:${badge.label}` : badge === null ? "" : b.dataset.badge ?? "";
      if (b.dataset.badge !== bkey) {
        b.dataset.badge = bkey;
        b.querySelector(".sc-tag")?.remove();
        // The card's label says what its badge does.
        if (badge) b.append(Object.assign(badgeEl(badge, kit), { ariaHidden: "true" }));
      }
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
      const tag = badge ? ` ${badge.label}.` : "";
      b.setAttribute("aria-label", id < 0 ? "A card, arriving" : `${cardWords(id)}${now ? ` ${now[0].toUpperCase()}${now.slice(1)}.` : tag}${isPicked ? " Picked." : ""}`);
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
    if (title.textContent !== words) title.textContent = words;
    if (next.textContent !== nextWords) next.textContent = nextWords;
  }
  function clear() {
    cards.forEach((b) => b.remove());
    cards.clear();
  }
  return { node, title, next, draw, clear, card: (slot) => cards.get(slot) ?? null };
}

// Whose cards your hand holds, and where they go next: "the 5 cards Robot 3
// did not pick · then to Robot 1 ◂". view: the table as drawn; nameIn(p) a
// name within a sentence ("you" for you).
export function handCaption(view, me, nameIn) {
  if (!view?.age) return "";
  const n = view.players;
  const dir = passDir(view.age);
  const count = view.hands[me].length;
  if (!count) return "";
  const to = (me + dir + n) % n;
  const from = (me - dir + n) % n;
  const arrow = dir > 0 ? "◂" : "▸";
  const whose = view.round <= 1 ? `the ${plural(count, "card")} dealt to you` : `the ${plural(count, "card")} ${nameIn(from)} did not pick`;
  const playsLast = stagesOf(view, me).slice(0, view.stages[me].length).some((x) => x.playLast);
  const then = count > 1 && view.round < ROUNDS ? ` · then to ${nameIn(to)} ${arrow}` : count > 1 ? (playsLast ? " · your wonder plays the last" : " · the last is discarded") : "";
  return `${whose}${then}`;
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
    // A hidden button keeps no words: they could name a card since passed on.
    for (const [kind, x] of Object.entries(all)) if ((x.b.hidden = !kinds.includes(kind))) x.set(x.b.querySelector(".lbl").textContent);
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
  let key = "";
  function draw(rows) {
    const now = JSON.stringify(rows);
    if (now === key) return;
    key = now;
    node.hidden = !rows;
    node.replaceChildren(...(rows ?? []).map(({ p, name, done, me }) => el("li", { class: `p-${p} ${done ? "done" : ""}`, dataset: { tip: "seat", tipSeat: p } }, seatMark(p), el("span", { class: "nm" }, name), el("span", { class: "sc-pick-state" }, done ? "✓ picked" : me ? "your pick" : "picking"), !done && !me ? thinkingDots() : null)));
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

// The war tokens after a war event: each seat's left result, then its right one, draws giving none.
export function tokensAfter(tokens, results, age) {
  const out = tokens.map((t) => t.slice());
  results.forEach((rs, p) => rs.forEach((r) => r && out[p].push(r > 0 ? VICTORY[age - 1] : DEFEAT)));
  return out;
}
const unitsOf = (counts) => (counts ?? []).flatMap((n, r) => Array(n).fill(r));

// The motion of the events both the game and the tutorial have: everyone's
// picks, the hands passing, the seventh cards, the war and a new age. ctx:
// me, seats; view(): the table as drawn, which this brings up to date as
// things land; idOf(slot); handRect(slot) and handBox(), where your hand is;
// leaving, arriving: your hand's slots in the air, revealing: seats whose
// pick marks stay up, all Sets this fills and empties; draw(); sound(name,
// opts, at); onTuck(slot, age) as a stage is built; said(kind, data) for a
// log; buyOf(): what your own pick buys ({ left, right } counts) or null;
// warWait(): how long the war scene waits on its own (0: for Continue);
// onWar(ev, facts, done) around the war scene; onPass(ev) as hands pass.
// k slows or speeds each step (1 is the normal pace).
export function scMotion(table, art, ctx) {
  const { live, fast, rectIn, flyLayer } = table;
  const { me, seats, view, idOf, handRect, leaving, arriving, revealing, draw, sound, onTuck = () => {}, said = () => {}, buyOf = () => null, warWait = () => 0, onWar = () => {}, onPass = () => {} } = ctx;
  const n = seats.length;
  const rectOf = (p, part, arg) => art.rectsOf(p)?.[part]?.(arg) ?? null;
  const at = (ms) => (fast() ? 0 : ms / 1000);
  const sideOf = (p) => (p === art.around.left ? "left" : p === art.around.right ? "right" : null);
  // Borders move only where someone can see them.
  const border = (side) => (document.hidden ? null : art.borders.get(side));
  const layKind = (trade) => (trade.kinds.includes(RAW[0]) ? "bridge" : "stall");

  // The builds turn face up together, a neighbour's staying a beat with what
  // it means for you; then each card flies to its place (a city, the shelf,
  // under a wonder, the discard pile) a moment after the one before. What
  // you buy crosses your border in a cart while your coins go the other way;
  // a road or a market laid by your card is built on its border; the coins
  // earned come in after, an income card's from each card it counts.
  async function picks(ev, g, k = 1) {
    const v = view();
    const list = ev.picks;
    for (const x of list) if (x.p !== me) revealing.add(x.p);
    draw();
    const from = new Map(list.map((x) => [x.p, x.how === "dig" ? art.pileRect() : x.p === me ? handRect(x.slot) : rectOf(x.p, "pick")]));
    sound("reveal");
    revealing.clear();
    draw();
    const recap = new Map(list.filter((x) => x.p !== me && sideOf(x.p)).map((x) => [x.p, recapWords(v, me, x)]));
    const flips = list.filter((x) => x.p !== me && x.type === "build" && from.get(x.p));
    for (const x of flips) if (recap.get(x.p)) from.set(x.p, rectOf(x.p, "recap") ?? from.get(x.p));
    await art.flipAll(flips.map((x) => ({ id: x.id, age: v.age, rect: from.get(x.p), caption: recap.get(x.p) })), { g, ms: PACE.flip * k, hold: PACE.recap * k });
    if (!live(g)) return;
    // Those cards fly on from where they turned over.
    for (const x of flips) from.set(x.p, art.flipRect(from.get(x.p), !!recap.get(x.p)));
    // Every place measured before anything moves: a flight added to the page would make each measure lay it out again.
    const plan = list.map((x) => {
      const bought = x.bought ?? { left: 0, right: 0 };
      const to = x.type === "build" ? rectOf(x.p, "city", CARDS[x.id].color) : x.type === "stage" ? rectOf(x.p, "wonder") : art.pileRect();
      return { x, bought, to, coins: rectOf(x.p, "coins"), bank: art.bankRect(), left: bought.left ? rectOf(leftOf(v, x.p), "coins") : null, right: bought.right ? rectOf(rightOf(v, x.p), "coins") : null };
    });
    const flights = [];
    const laid = [];
    plan.forEach(({ x, bought, to, coins, bank, left, right }, i) => {
      const p = x.p;
      const delay = i * PACE.flyGap * k;
      const opts = { g, delay };
      if (p === me && x.how !== "dig") leaving.add(x.slot);
      v.coins[p] -= (x.coins ?? 0) + bought.left + bought.right;
      if (x.coins) flights.push(art.flyCoins(x.coins, coins, bank, { ...opts, ms: PACE.coin * k }));
      for (const [s, rect] of [["left", left], ["right", right]]) {
        if (!bought[s]) continue;
        const q = s === "left" ? leftOf(v, p) : rightOf(v, p);
        // Between you and a neighbour, a cart crosses your border; elsewhere the coins fly.
        if (p === me && border(s)) border(s).cart({ resources: unitsOf(buyOf()?.[s]), coins: bought[s] });
        else if (q === me && sideOf(p) && border(sideOf(p))) border(sideOf(p)).cart({ coins: bought[s], out: true });
        else flights.push(art.flyCoins(bought[s], coins, rect, { ...opts, ms: PACE.coin * k }));
      }
      if (bought.left || bought.right) sound("trade", { n: bought.left + bought.right }, at(delay));
      const start = from.get(p);
      const mine = p === me ? idOf(x.slot) : -1;
      if (x.type === "build") {
        const card = CARDS[x.id];
        sound("build", { color: card.color, how: x.how }, at(delay));
        if (p === me && card.trade) laid.push(card.trade);
        if (p === me && card.trade) for (const s of card.trade.sides) border(s)?.expect(layKind(card.trade));
        flights.push(art.flyCard(x.id, v.age, start, to, { ...opts, ms: PACE.fly * k, width: p === me ? null : (start?.w ?? 40) }).then(() => {
          v.city[p].push({ slot: x.slot, id: x.id });
          if (x.how === "dig") v.discard = v.discard.filter((s) => s !== x.slot);
          draw();
        }));
      } else if (x.type === "stage") {
        sound("stage", { n: x.n }, at(delay));
        onTuck(x.slot, v.age);
        const stage = stagesOf(v, p)[x.n];
        if (p === me && stage?.trade) laid.push(stage.trade);
        if (p === me && stage?.trade) for (const s of stage.trade.sides) border(s)?.expect(layKind(stage.trade));
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
      said("pick", x, recap.get(p) ?? "");
      if (x.how !== "dig") v.hands[p] = v.hands[p].filter((s) => s !== x.slot);
    });
    draw();
    await Promise.all(flights);
    if (!live(g)) return;
    leaving.clear();
    // A road lays a bridge on its side; a market puts up a stall.
    for (const trade of laid) for (const s of trade.sides) border(s)?.lay(layKind(trade));
    await gains(ev.gains, list, g, k);
  }

  // Coins coming in, together: sales and cards from the bank, purchases from
  // the buyer (a border's cart has brought those between you and a
  // neighbour), an income card's from each card it counts, which lights up.
  async function gains(list, picked, g, k) {
    if (!list.length) return;
    const v = view();
    const income = new Map(picked.filter((x) => x.type === "build" && CARDS[x.id].income).map((x) => [x.p, CARDS[x.id].income]));
    sound("coins", { n: list.reduce((a, x) => a + x.coins, 0) });
    said("gains", list);
    const land = (x) => () => {
      v.coins[x.p] += x.coins;
      draw();
    };
    await Promise.all(
      list.map((x) => {
        const to = rectOf(x.p, "coins");
        const spec = x.why === "card" ? income.get(x.p) : null;
        if (spec && !fast()) {
          const counted = spec.from.flatMap((s) => art.countedNodes(v, s === "self" ? x.p : s === "left" ? leftOf(v, x.p) : rightOf(v, x.p), spec.per)).slice(0, 14);
          if (counted.length)
            return Promise.all(
              counted.map((node, i) => {
                art.flash(node, i * 90 * k);
                return art.flyCoins(spec.coins, rectIn(node), to, { g, ms: PACE.coin * k, delay: i * 90 * k });
              }),
            ).then(land(x));
        }
        const near = x.why === "trade" && !document.hidden && ((x.p === me && sideOf(x.from)) || (x.from === me && sideOf(x.p)));
        if (near) return table.wait(PACE.coin * k, g).then(land(x));
        const from = x.why === "trade" ? rectOf(x.from, "coins") : art.bankRect();
        return art.flyCoins(x.coins, from, to, { g, ms: PACE.coin * k }).then(land(x));
      }),
    );
  }

  // Hands pass as stacks: your leftover cards gather into a stack that
  // slides to one neighbour's slot while the other neighbour's stack slides
  // to your hand and fans out; the stack your neighbour passes on leaves for
  // the seat after them, and the ring turns with them.
  async function pass(ev, g, k = 1) {
    const v = view();
    const dir = ev.dir;
    const to = (me + dir + n) % n;
    const from = (me - dir + n) % n;
    const count = v.hands[me].length;
    sound("pass", { dir });
    onPass(ev);
    const ms = PACE.slide * k;
    let ring = null;
    if (!fast()) {
      const box = rectIn(ctx.handBox());
      const sw = Math.min(72, Math.max(52, box.w * 0.12));
      const centre = { x: box.x + box.w / 2 - sw / 2, y: box.y + Math.min(box.h, 150) / 2 - sw / 2, w: sw, h: sw };
      const cards = v.hands[me].map((slot) => [slot, handRect(slot)]);
      cards.forEach(([slot]) => leaving.add(slot));
      draw();
      await Promise.all(cards.map(([slot, r], i) => art.flyCard(idOf(slot), v.age, r, centre, { g, ms: PACE.gather * k, delay: i * 30 * k, turn: idOf(slot) >= 0 ? "down" : null, width: 40, fade: true })));
      if (!live(g)) return;
      const moving = [to, from, (to + dir + n) % n, (from - dir + n) % n].map(art.stackOf).filter(Boolean);
      moving.forEach((s) => (s.style.visibility = "hidden"));
      ring = art.ring.pass(dir, { ms });
      // Every rect is read before the first slide adds to the page.
      const next = (to + dir + n) % n;
      const giver = (from - dir + n) % n;
      const legs = [[centre, art.slotRect(to)], [art.slotRect(from), centre]];
      if (next !== me) legs.push([art.slotRect(to), art.slotRect(next)]);
      if (giver !== to && giver !== me) legs.push([art.slotRect(giver), art.slotRect(from)]);
      const slides = legs.filter(([a, b]) => a && b).map(([a, b]) => slide(stackEl(v.age, count), a, b, { ms, layer: flyLayer }).then((node) => node.remove()));
      await Promise.all(slides);
      moving.forEach((s) => (s.style.visibility = ""));
      if (!live(g)) return;
      v.hands = seats.map((p) => v.hands[(p - dir + n) % n]);
      v.round++;
      leaving.clear();
      v.hands[me].forEach((s) => arriving.add(s));
      draw();
      const landing = v.hands[me].map((slot) => [slot, handRect(slot)]);
      await Promise.all(landing.map(([slot, r], i) => art.flyCard(null, v.age, centre, r, { g, ms: PACE.pass * k, delay: i * 45 * k, width: 40 }).then(() => {
        arriving.delete(slot);
        draw();
      })));
    } else {
      ring = art.ring.pass(dir, { ms: 0 });
      v.hands = seats.map((p) => v.hands[(p - dir + n) % n]);
      v.round++;
    }
    await ring;
    leaving.clear();
    arriving.clear();
    draw();
    said("pass", { dir, from });
  }

  // The last card of each hand goes to the discard pile, face down.
  async function sevenths(ev, g, k = 1) {
    const v = view();
    sound("sell");
    const pile = art.pileRect();
    const starts = ev.list.map((x) => (x.p === me ? handRect(x.slot) : rectOf(x.p, "slot") ?? rectOf(x.p, "seat")));
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

  // The war: the scene at your two borders, which waits for Continue (or
  // warWait() ms), then the tokens and the age's flags on the borders.
  async function war(ev, g, k = 1) {
    const v = view();
    said("war", ev);
    const tokens = tokensAfter(v.tokens, ev.results, ev.age);
    // The scene's tips (and your score) read the view: it holds this war's tokens from the start.
    v.tokens = tokens;
    const facts = warFacts(v, ev.results, me, ev.age);
    onWar(ev, facts, false);
    if (live(g)) await art.war.play(facts, { wait: warWait(), k });
    onWar(ev, facts, true);
    draw();
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
      const box = rectIn(ctx.handBox());
      const centre = { x: box.x + box.w / 2 - 20, y: box.y - 10, w: 40, h: 56 };
      const seatRects = new Map(seats.filter((p) => p !== me).map((p) => [p, rectOf(p, "slot") ?? rectOf(p, "seat")]));
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
