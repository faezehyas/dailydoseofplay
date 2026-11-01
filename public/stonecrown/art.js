// What the Stonecrown view (main.js) shares with its tutorial: the pace of
// its motion, the words a screen reader hears for cards, costs, purchases,
// wars and scores, the choices a card in your hand offers, and the table:
// the neighbours' panels, your wonder and city, your hand, and how they
// move: picks flip together, built cards fly into cities, stages tuck under
// a wonder, coins fly, hands slide round, the war and the score sheet. The
// art itself comes from card-art.js and pieces.js.
import { el } from "../engine/shell.js";
import { easing } from "../engine/cards/table.js";
import { CARDS, WONDERS, COLORS, RESOURCE_NAMES, SYMBOLS, RAW, GOODS, DISCARD_COINS, VICTORY } from "./cards.js";
import { stagesOf, canBuild, canStage, unitPrice, production, shields, ROUNDS } from "./rules.js";
import { cardSvg, cardBack, resourceIcon, scienceIcon, coinIcon, shieldIcon, pointsIcon } from "./card-art.js";
import { wonderSvg, wonderMini, coinSvg, tokenSvg, tableSvg } from "./pieces.js";

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

// "Timber Mill, brown: makes 2 wood. Costs 1 coin." and its chains.
export function cardWords(id) {
  const c = CARDS[id];
  if (!c) return "a card";
  const from = chainsFrom(c);
  const to = chainsTo(c);
  return [`${c.name}, ${c.color}: ${effectWords(c)}`, costWords(c.cost) === "free" ? "Free to build" : `Costs ${costWords(c.cost)}`, from.length ? `Free with ${orWords(from)}` : "", to.length ? `Builds ${listOf(to)} free` : ""].filter(Boolean).join(". ") + ".";
}

export function stageWords(stage, n) {
  return `Stage ${ROMAN[n + 1]}: ${effectWords(stage)}. Costs ${costWords(stage.cost)}.`;
}

// What a purchase pays each neighbour: { left, right }.
export function sideCoins(state, p, buy) {
  const at = (side) => sum(buy[side].map((n, r) => n * unitPrice(state, p, r, side)));
  return { left: at("left"), right: at("right") };
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
  const parts = [(me + 1) % n, (me + n - 1) % n].map((q, i) => {
    const r = results[me][i];
    return r > 0 ? `beat ${nameOf(q)} (${signed(won)})` : r < 0 ? `lost to ${nameOf(q)} (−1)` : `drew with ${nameOf(q)}`;
  });
  return `War: you ${listOf(parts)}`;
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
const art = (cls, markup) => {
  const node = el("span", { class: cls, "aria-hidden": "true" });
  node.innerHTML = svgOf(markup);
  return node;
};
export const resEl = (r) => art(`sc-ic r-${r}`, resourceIcon(r));
export const sciEl = (s) => art(`sc-ic sci-${s}`, scienceIcon(s));
export const shieldEl = () => art("sc-ic shield", shieldIcon());
export const pointsEl = (n) => art("sc-ic points", pointsIcon(n));
export const coinEl = (n = null) => {
  const node = art("sc-ic coin", coinIcon());
  if (n !== null) node.append(el("b", { class: "sc-coin-n" }, String(n)));
  return node;
};
export const tokenEl = (v) => art(`sc-tok ${v < 0 ? "defeat" : "victory"}`, tokenSvg(v));
export const coinPieceEl = (v) => art("sc-coin-piece", coinSvg(v));

// A seat's mark beside its colour, so no two seats differ by hue alone: none, dots, a stripe, a chevron.
export function seatMark(p) {
  const marks = ["", '<circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>', '<path d="M3 10h18v4H3z"/>', '<path d="M6 9l6 6 6-6" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'];
  const node = el("span", { class: `sc-mark p-${p}`, "aria-hidden": "true" });
  node.innerHTML = `<svg viewBox="0 0 24 24" focusable="false"><circle class="disc" cx="12" cy="12" r="11"/><g class="sign">${marks[p] ?? ""}</g></svg>`;
  return node;
}

const SEP = () => el("span", { class: "sc-or", "aria-hidden": "true" }, "/");
const colorSquare = (c) => el("span", { class: `sc-swatch c-${c}`, "aria-hidden": "true" });
const sideArrow = (side) => el("span", { class: `sc-side ${side}`, "aria-hidden": "true" }, side === "left" ? "◂" : side === "right" ? "▸" : "•");
// A card's or stage's effect as icons, for chips and the detail strip.
export function effectEl(x) {
  const row = el("span", { class: "sc-fx", "aria-hidden": "true" });
  if (x.produce) x.produce.forEach((u, i) => {
    if (i && u.length > 1) row.append(el("span", { class: "sc-gap" }));
    u.forEach((r, j) => row.append(...(j ? [SEP()] : []), resEl(r)));
  });
  if (x.points) row.append(pointsEl(x.points));
  for (let i = 0; i < (x.shields ?? 0); i++) row.append(shieldEl());
  if (x.science === "any") [0, 1, 2].forEach((s, j) => row.append(...(j ? [SEP()] : []), sciEl(s)));
  else if (x.science !== undefined) row.append(sciEl(x.science));
  if (x.gold) row.append(coinEl(x.gold));
  if (x.trade) row.append(...x.trade.sides.filter((s) => s === "left").map(sideArrow), resEl(x.trade.kinds[0]), el("span", { class: "sc-dots" }, "…"), coinEl(1), ...x.trade.sides.filter((s) => s === "right").map(sideArrow));
  for (const [k, each] of [["income", "coins"], ["score", "points"]]) {
    const e = x[k];
    if (!e || (k === "score" && x.income)) continue;
    const per = e.per === "stage" ? el("span", { class: "sc-stage-ic" }, "▲") : e.per === "defeat" ? tokenEl(-1) : el("span", { class: "sc-swatches" }, ...[].concat(e.per).map(colorSquare));
    row.append(...e.from.filter((s) => s === "left").map(sideArrow), per, ...e.from.filter((s) => s === "right").map(sideArrow), el("span", { class: "sc-eq" }, "="), each === "coins" ? coinEl(e.coins) : pointsEl(e.points));
    if (k === "income" && x.score) row.append(pointsEl(x.score.points));
  }
  if (x.dig) row.append(el("span", { class: "sc-word" }, "dig"));
  if (x.free) row.append(el("span", { class: "sc-word" }, "free"));
  if (x.copyGuild) row.append(el("span", { class: "sc-word" }, "copy guild"));
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

// Wonder boards are big markup: each one drawn once per stage count.
const boards = new Map();
export function boardSvg(w, side, built, { mini = false } = {}) {
  const key = `${w}:${side}:${built}:${mini}`;
  if (!boards.has(key)) boards.set(key, mini ? wonderMini(w, side, built) : wonderSvg(w, side, { built, tucked: built }));
  return boards.get(key);
}
// The table behind everything: paper hills by day, an indigo sky by night.
export function tableEl() {
  const node = el("div", { class: "sc-table-bg", "aria-hidden": "true" });
  node.innerHTML = tableSvg();
  return node;
}

const cardArt = new Map();
// A card as a span holding its art: a design id, or a back of an age (id -1 or null).
export function cardEl(id, { age = 1, size = "full", cls = "" } = {}) {
  const back = id === null || id === undefined || id < 0;
  const key = back ? `b${age}:${size}` : `${id}:${size}`;
  if (!cardArt.has(key)) cardArt.set(key, svgOf(back ? cardBack(age, { size }) : cardSvg(id, { size })));
  const node = el("span", { class: `sc-cardbox ${back ? "back" : `c-${CARDS[id].color}`} ${cls}`, "aria-hidden": "true" });
  node.innerHTML = cardArt.get(key);
  return node;
}
// A card that turns over: a front and a back (CSS turns .sc-turn.down).
export function turnCardEl(id, age, { size = "full", down = true } = {}) {
  return el("span", { class: `sc-turn ${down ? "down" : ""}`, "aria-hidden": "true" }, el("span", { class: "in" }, el("span", { class: "side front" }, id >= 0 ? cardEl(id, { size }) : cardEl(null, { age, size })), el("span", { class: "side back" }, cardEl(null, { age, size }))));
}

// A built card in a city: its colour, its effect as icons, and its name where there's room.
export function chipEl(id) {
  const c = CARDS[id];
  return el("span", { class: `sc-chip c-${c.color}`, title: c.name, dataset: { id } }, effectEl(c), el("span", { class: "sc-chip-name" }, c.name));
}

// A city in columns by colour; empty colours keep a dashed place.
export function cityEl(ids, { cls = "" } = {}) {
  return el(
    "div",
    { class: `sc-city ${cls}` },
    cityColumns(ids).map((col, i) => el("div", { class: `sc-col c-${COLORS[i]} ${col.length ? "" : "empty"}` }, col.length ? col.map(chipEl) : el("span", { class: `sc-chip ghost c-${COLORS[i]}`, "aria-hidden": "true" }))),
  );
}

// ---------- the table ----------
// table: engine/cards/table.js (the queue, the fly layer, bubbles).
// me, players; nameOf(p); onSeat(p) opens a seat's city.
export function scTable(table, { me, players, nameOf, onSeat = () => {} }) {
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
    const city = el("div", { class: "sc-seat-city" });
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
      el("div", { class: "sc-seat-city-box" }, el("span", { class: "sc-label" }, `${nameOf(p)}'s city`), city),
      pick,
    );
    let key = "";
    function draw(view, { picked = false } = {}) {
      const w = view.wonders[p];
      const W = WONDERS[w.w];
      const ids = view.city[p].map((x) => x.id);
      const k = JSON.stringify([w, ids, view.coins[p], view.tokens[p], view.stages[p].length]);
      pick.hidden = !picked;
      if (k === key) return;
      key = k;
      wonderName.textContent = `${W.city} ${w.side}`;
      coins.replaceChildren(coinEl(view.coins[p]));
      const sh = shields(view, p);
      shieldsEl.replaceChildren(shieldEl(), el("b", {}, String(sh)));
      tokens.replaceChildren(...view.tokens[p].map(tokenEl));
      const total = stagesOf(view, p).length;
      dots.replaceChildren(...Array.from({ length: total }, (_, i) => el("i", { class: i < view.stages[p].length ? "on" : "" })));
      sellRow.replaceChildren(...sells(view, p).map(({ unit, n }) => el("span", { class: "sc-sell" }, ...unit.flatMap((r, j) => (j ? [SEP(), resEl(r)] : [resEl(r)])), n > 1 ? el("small", {}, `×${n}`) : "")));
      const cols = cityColumns(ids);
      [...counts.children].forEach((c, i) => {
        c.textContent = cols[i].length ? String(cols[i].length) : "";
        c.classList.toggle("none", !cols[i].length);
      });
      wonder.innerHTML = boardSvg(w.w, w.side, view.stages[p].length, { mini: true });
      city.replaceChildren(cityEl(ids));
      open.setAttribute("aria-label", `${nameOf(p)}, your ${side} neighbour${side === "across" ? "" : ""}, ${W.name} side ${w.side}: ${seatWords(view, p)}. Show their city`);
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
  const myCity = el("div", { class: "sc-my-city" });
  const cityBox = el("section", { class: "sc-city-box", "aria-label": "Your city" }, el("h2", { class: "sc-title" }, "Your city"), myCity);
  const mine = el("section", { class: "sc-mine", "aria-label": "Your wonder and city" }, meStats, boardBox, cityBox);
  const myPick = el("span", { class: "sc-pickmark mine", "aria-hidden": "true", hidden: true }, cardEl(null));
  boardBox.append(myPick);
  let myKey = "";
  let myBuilt = -1;
  function drawMine(view) {
    const w = view.wonders[me];
    const W = WONDERS[w.w];
    const ids = view.city[me].map((x) => x.id);
    const built = view.stages[me].length;
    const k = JSON.stringify([w, ids, view.coins[me], view.tokens[me], built]);
    if (k === myKey) return;
    myKey = k;
    meWonderName.textContent = `${W.name} · ${w.side}`;
    meCoins.replaceChildren(coinEl(view.coins[me]));
    meCoins.setAttribute("aria-label", plural(view.coins[me], "coin"));
    meShields.replaceChildren(shieldEl(), el("b", {}, String(shields(view, me))));
    meShields.setAttribute("aria-label", plural(shields(view, me), "shield"));
    meTokens.replaceChildren(...view.tokens[me].map(tokenEl));
    meTokens.setAttribute("aria-label", view.tokens[me].length ? `War tokens ${view.tokens[me].map(signed).join(" ")}` : "No war tokens");
    meStats.setAttribute("aria-label", `You: ${W.name}, side ${w.side}, ${plural(view.coins[me], "coin")}, ${plural(shields(view, me), "shield")}`);
    const art = el("span", { class: "sc-board-art" });
    art.innerHTML = boardSvg(w.w, w.side, built);
    // The stage just built pops in (pieces.css).
    if (myBuilt >= 0 && built > myBuilt) art.querySelector(`.sc-stage[data-stage="${built - 1}"]`)?.classList.add("sc-new");
    myBuilt = built;
    boardBox.replaceChildren(art, myPick);
    const stages = stagesOf(view, me);
    boardBox.setAttribute("aria-label", `Your wonder, ${W.name}, side ${w.side}: makes ${RES_NAMES[W.produce]}. ${built} of ${stages.length} stages built. ${stages.map((s, n) => `${n < built ? "Built" : "To build"}: ${stageWords(s, n)}`).join(" ")}`);
    myCity.replaceChildren(cityEl(ids, { cls: "mine" }));
    myCity.setAttribute("aria-label", ids.length ? `Your city: ${cityColumns(ids).flatMap((col, i) => (col.length ? [`${COLOR_NAMES[COLORS[i]]}: ${listOf(col.map((id) => CARDS[id].name))}`] : [])).join("; ")}` : "Your city is empty");
    myCity.setAttribute("role", "img");
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
    const o = flyLayer.getBoundingClientRect();
    const y = Math.max(120, Math.min(o.height - 120, innerHeight / 2 - o.top));
    node.style.top = `${y.toFixed(0)}px`;
    flyLayer.append(node);
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
    const node = turnCardEl(id, age, { down: turn === "up" || id === null || id < 0 });
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
      { duration: ms, easing: easing("out"), fill: "forwards" },
    );
    if (turn) {
      const inner = node.querySelector(".in");
      const [a, b] = turn === "up" ? ["rotateY(180deg)", "rotateY(0deg)"] : ["rotateY(0deg)", "rotateY(180deg)"];
      inner.animate([{ transform: a }, { transform: b }], { duration: ms * 0.5, delay: ms * 0.15, easing: easing("out"), fill: "forwards" });
    }
    await motion.finished.catch(() => {});
    node.remove();
  }

  // Cards turn over where they lie, together: [{ id, age, rect }].
  async function flipAll(cards, { g, ms = PACE.flip }) {
    if (fast() || !live(g) || !cards.length) return;
    const nodes = cards.map(({ id, age, rect }) => {
      const w = Math.max(52, Math.min(84, rect.w));
      const node = turnCardEl(id, age, { down: true });
      node.classList.add("sc-fly-card");
      node.style.width = `${w}px`;
      node.style.transform = `translate(${(rect.x + rect.w / 2 - w / 2).toFixed(1)}px, ${(rect.y + rect.h / 2 - w * 0.7).toFixed(1)}px)`;
      flyLayer.append(node);
      return { node, up: id >= 0 };
    });
    await Promise.all(
      nodes.map(({ node, up }) => {
        const inner = node.querySelector(".in");
        const lift = node.animate([{ translate: "0 0" }, { translate: "0 -10px", offset: 0.5 }, { translate: "0 0" }], { duration: ms * 1.3, easing: easing("out"), composite: "add" });
        const turn = up ? inner.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], { duration: ms, delay: ms * 0.15, easing: easing("out"), fill: "forwards" }) : null;
        return Promise.all([lift.finished.catch(() => {}), turn?.finished.catch(() => {})]);
      }),
    );
    await wait(ms * 0.6, g);
    nodes.forEach(({ node }) => node.remove());
  }

  // Coins fly one after another: n of them, from one rect to another.
  async function flyCoins(n, from, to, { g, ms = PACE.coin }) {
    if (fast() || !live(g) || !from || !to || n <= 0) return;
    const pieces = n >= 3 ? [...Array(Math.floor(n / 3)).fill(3), ...Array(n % 3).fill(1)] : Array(n).fill(1);
    await Promise.all(
      pieces.slice(0, 6).map(async (v, i) => {
        await wait(i * 70, g);
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
            { duration: ms, easing: easing("out"), fill: "forwards" },
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
      return;
    }
    centre(box);
    box.animate([{ opacity: 0, transform: "translate(-50%, -46%) scale(.94)" }, { opacity: 1, transform: "translate(-50%, -50%) scale(1)" }], { duration: 260, easing: easing("out"), fill: "both" });
    sound("war");
    await wait(320 * k, g);
    for (const [i, [p, q, r]] of pairs.entries()) {
      if (!live(g)) break;
      const row = rows[i];
      row.classList.add("clash");
      row.animate([{ transform: "scale(1)" }, { transform: "scale(1.06)", offset: 0.35 }, { transform: "scale(1)" }], { duration: PACE.war * k, easing: easing("out") });
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
    await node.animate([{ transform: `translate(${x0}px, ${y0}px) scale(1.4)` }, { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 40}px) scale(1.2)`, offset: 0.5 }, { transform: `translate(${x1}px, ${y1}px) scale(.9)` }], { duration: PACE.fly, easing: easing("out"), fill: "forwards" }).finished.catch(() => {});
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
    flipAll,
    flyCoins,
    bump,
    war,
  };
}

// The score sheet: a row at a time, counted up. scores by seat; order: the
// seats as columns; returns { node, play({ g, k, wait, sound }) }.
export function scoreSheet(scores, order, { me, nameOf, winners = [] }) {
  const head = el("tr", {}, el("th", { scope: "col" }, el("span", { class: "sr-only" }, "Row")), ...order.map((p) => el("th", { scope: "col", class: `p-${p} ${p === me ? "mine" : ""}` }, el("span", { class: "who" }, seatMark(p), el("span", { class: "nm" }, p === me ? "You" : nameOf(p))))));
  const cells = [];
  const rows = SCORE_ROWS.map(([key, label, note], i) => {
    const tds = order.map((p) => el("td", { class: `mono ${key === "total" && winners.includes(p) ? "best" : ""}` }, String(scores[p][key])));
    cells.push(tds);
    return el("tr", { class: `r-${key}` }, el("th", { scope: "row" }, el("span", { class: "lbl" }, label), note ? el("small", {}, note) : null), ...tds);
  });
  const node = el("table", { class: "sc-sheet", id: "sc-sheet" }, el("caption", { class: "sr-only" }, "Final scores"), el("thead", {}, head), el("tbody", {}, rows.slice(0, -1)), el("tfoot", {}, rows.at(-1)));
  async function play({ g, k = 1, wait, live, fast, sound }) {
    if (fast()) return;
    for (const tds of cells) tds.forEach((td) => (td.textContent = ""));
    for (const [i, [key]] of SCORE_ROWS.entries()) {
      if (!live(g)) break;
      rows[i].classList.add("on");
      sound("score", { row: i });
      const target = order.map((p) => scores[p][key]);
      const steps = 6;
      for (let s = 1; s <= steps; s++) {
        cells[i].forEach((td, j) => (td.textContent = String(Math.round((target[j] * s) / steps))));
        await wait((PACE.row / steps) * k, g);
      }
    }
    cells.forEach((tds, i) => tds.forEach((td, j) => (td.textContent = String(scores[order[j]][SCORE_ROWS[i][0]]))));
  }
  return { node, play };
}
