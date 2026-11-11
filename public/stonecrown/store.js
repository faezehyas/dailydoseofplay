// Stonecrown's storehouse: one shelf with the seven resources a city makes
// each turn and where each comes from, "either" tokens for the cards and
// stages that make one of several, a hand card's cost matched unit by unit
// against the shelf and the neighbours' banks, and the badge every hand card
// wears. The facts are pure and read the rules' own production and
// purchases, so the shelf never disagrees with what the Build button does.
// The view takes the game's icon makers as a kit (see the spec in art.js).
import { el } from "../engine/shell.js";
import { CARDS, WONDERS, RESOURCE_NAMES, RAW, GOODS } from "./cards.js";
import { production, purchases, covers, unitPrice, builtStages, cardsOf, leftOf, rightOf } from "./rules.js";

const ROMAN = ["", "I", "II", "III", "IV"];
const SIDES = ["left", "right"];
const zero = () => [0, 0, 0, 0, 0, 0, 0];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const listOf = (xs, and = "and") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs.at(-1)}`);
const ORDINAL = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

// Every unit p makes, in the order rules.production() lists them, each with
// where it comes from and whether neighbours may buy it. viewer names p's
// wonder: "your wonder" for p itself.
function stock(state, p, viewer = p) {
  const wonder = WONDERS[state.wonders[p].w];
  const mine = viewer === p;
  const out = [{ options: [wonder.produce], source: mine ? "your wonder" : wonder.name, from: "wonder", sale: true }];
  for (const c of cardsOf(state, p)) {
    if (!c.produce) continue;
    const sale = c.color === "brown" || c.color === "grey";
    for (const u of c.produce) out.push({ options: u.slice(), source: c.name, from: "card", id: c.id, sale });
  }
  builtStages(state, p).forEach((s, n) => {
    if (!s.produce) return;
    const source = mine ? `wonder stage ${ROMAN[n + 1]}` : `${wonder.name} stage ${ROMAN[n + 1]}`;
    for (const u of s.produce) out.push({ options: u.slice(), source, from: "stage", n, sale: false });
  });
  let e = 0;
  for (const u of out) if (u.options.length > 1) u.either = e++;
  return out;
}

function shelfFrom(state, p, list) {
  const fixed = zero();
  const sale = zero();
  const sources = RESOURCE_NAMES.map(() => []);
  const either = [];
  for (const u of list) {
    if (u.options.length > 1) {
      either.push({ options: u.options.slice(), source: u.source, sale: u.sale });
      continue;
    }
    const r = u.options[0];
    fixed[r]++;
    if (u.sale) sale[r]++;
    if (!sources[r].includes(u.source)) sources[r].push(u.source);
  }
  return { p, fixed, either, sources, sale, wonder: WONDERS[state.wonders[p].w].produce };
}

// What p makes for itself each turn: { p, fixed: [7 counts], either:
// [{ options, source, sale }], sources: [7 × [names]], sale: [7 counts of
// fixed units neighbours may buy], wonder: the wonder's own resource }.
// Yellow cards and wonder stages make only for p (sale: false).
export const shelfOf = (state, p, viewer = p) => shelfFrom(state, p, stock(state, p, viewer));

// What p's neighbours may buy from p, the same shape: brown and grey cards and the wonder's own resource.
export const saleOf = (state, p, viewer = -1) => shelfFrom(state, p, stock(state, p, viewer).filter((u) => u.sale));

// "1 wood (Woodcutter's Camp), 1 stone (your wonder) and stone or clay (Dig Site)".
export function shelfWords(shelf, { sources = true } = {}) {
  const parts = [];
  shelf.fixed.forEach((n, r) => n && parts.push(`${n} ${RESOURCE_NAMES[r]}${sources && shelf.sources[r].length ? ` (${listOf(shelf.sources[r])})` : ""}`));
  for (const e of shelf.either) parts.push(`${listOf(e.options.map((r) => RESOURCE_NAMES[r]), "or")}${sources ? ` (${e.source})` : ""}`);
  return listOf(parts) || "nothing";
}

// One entry per unit of a cost, in resource order: { r, how, source?,
// either?, side?, coins? }. how: "own" (a unit only of r; source names it),
// "either" (a choice unit locked to r this turn; either is its index in
// shelfOf().either), "buy" (from buy: side and coins via unitPrice) or
// "missing". With buy null nothing is bought and every unit not made is
// missing: when some purchase would cover the cost, the cheapest one's units,
// each naming its seller (side, coins); otherwise the shelf covers the most
// it can and each missing unit names a neighbour with a unit left to sell, if any.
export function matchCost(state, p, cost, buy = null) {
  const res = Array.isArray(cost) ? cost : cost.res;
  if (!buy) {
    const cheapest = purchases(state, p, res)[0];
    if (cheapest) return matchCost(state, p, res, cheapest).map((u) => (u.how === "buy" ? { ...u, how: "missing" } : u));
  }
  const list = stock(state, p);
  const bought = { left: zero(), right: zero() };
  if (buy) for (const s of SIDES) res.forEach((n, r) => (bought[s][r] = Math.min(n, buy[s]?.[r] ?? 0)));
  for (let r = 0; r < res.length; r++) bought.right[r] = Math.min(bought.right[r], res[r] - bought.left[r]);
  const need = res.map((n, r) => n - bought.left[r] - bought.right[r]);
  const sellable = (r) => SIDES.some((s) => production(state, s === "left" ? leftOf(state, p) : rightOf(state, p)).sale.some((u) => u.includes(r)));

  // A single-resource unit is best spent on its own resource; then wanted
  // units are matched to choice units (augmenting paths), the ones nobody
  // sells first so that what stays missing can be bought where possible.
  const own = RESOURCE_NAMES.map(() => []);
  const left = need.slice();
  const choice = [];
  for (const u of list) {
    if (u.options.length > 1) choice.push(u);
    else if (left[u.options[0]] > 0) {
      left[u.options[0]]--;
      own[u.options[0]].push(u);
    }
  }
  let want = left.flatMap((n, r) => Array(n).fill(r));
  if (!buy) want = want.map((r, i) => [r, i]).sort((a, b) => sellable(a[0]) - sellable(b[0]) || a[1] - b[1]).map(([r]) => r);
  const owner = Array(choice.length).fill(-1);
  const assign = (t, seen) => {
    for (let u = 0; u < choice.length; u++) {
      if (seen[u] || !choice[u].options.includes(want[t])) continue;
      seen[u] = true;
      if (owner[u] === -1 || assign(owner[u], seen)) {
        owner[u] = t;
        return true;
      }
    }
    return false;
  };
  want.forEach((_, t) => assign(t, Array(choice.length).fill(false)));
  const locked = RESOURCE_NAMES.map(() => []);
  owner.forEach((t, u) => t !== -1 && locked[want[t]].push(choice[u]));
  locked.forEach((us) => us.sort((a, b) => a.either - b.either));

  // Who sells each missing unit when no purchase covers the cost: the cheaper side with a unit left.
  const taken = { left: zero(), right: zero() };
  const saleUnits = { left: production(state, leftOf(state, p)).sale, right: production(state, rightOf(state, p)).sale };
  const seller = (r) => {
    const sides = SIDES.slice().sort((a, b) => unitPrice(state, p, r, a) - unitPrice(state, p, r, b));
    for (const s of sides) {
      const t = taken[s].slice();
      t[r]++;
      if (covers(saleUnits[s], t)) return s;
    }
    return null;
  };

  const out = [];
  res.forEach((n, r) => {
    for (const u of own[r]) out.push({ r, how: "own", source: u.source });
    for (const u of locked[r]) out.push({ r, how: "either", source: u.source, either: u.either, options: u.options.slice() });
    for (const s of SIDES) for (let k = 0; k < bought[s][r]; k++) out.push({ r, how: "buy", side: s, coins: unitPrice(state, p, r, s) });
    const missing = n - own[r].length - locked[r].length - bought.left[r] - bought.right[r];
    for (let k = 0; k < missing; k++) {
      const s = buy ? null : seller(r);
      if (s) taken[s][r]++;
      out.push(s ? { r, how: "missing", side: s, coins: unitPrice(state, p, r, s) } : { r, how: "missing" });
    }
  });
  return out;
}

// Which shelf slots a match lights: use (green: fixed resources, and "e<i>"
// for either tokens), buy (gold: bought or for sale) and need (red: nobody sells it).
export function highlightOf(units) {
  const use = new Set();
  const buy = new Set();
  const need = new Set();
  for (const u of units) {
    if (u.how === "own") use.add(u.r);
    else if (u.how === "either") use.add(`e${u.either}`);
    else if (u.how === "buy" || u.side) buy.add(u.r);
    else need.add(u.r);
  }
  for (const r of need) buy.delete(r);
  return { use: [...use], buy: [...buy], need: [...need] };
}

// The words under a match: "You make 2 of the 3 stone. Robot 3 sells the
// third for 2 coins." names: { left, right }. bank: coins the card costs.
export function matchWords(units, names, { bank = 0 } = {}) {
  const words = [];
  const rs = [...new Set(units.map((u) => u.r))];
  const mine = (u) => u.how === "own" || u.how === "either";
  const of = (r) => units.filter((u) => u.r === r);
  const name = (r) => RESOURCE_NAMES[r];
  const full = rs.filter((r) => of(r).every(mine));
  if (units.length && full.length === rs.length) words.push("You make everything it needs.");
  else if (units.length) {
    if (full.length) words.push(`You make the ${listOf(full.map(name))}.`);
    for (const r of rs) {
      const k = of(r).filter(mine).length;
      if (k && k < of(r).length) words.push(`You make ${k} of the ${of(r).length} ${name(r)}.`);
    }
    const none = rs.filter((r) => !of(r).some(mine));
    if (none.length) words.push(`You make no ${listOf(none.map(name), "or")}.`);
    // A side's share of one resource: "ore", "the third", "2 more", "the other 2".
    const share = (r, picked) => {
      const all = of(r);
      const at = all.indexOf(picked[0]);
      const m = picked.length;
      if (m === all.length) return m === 1 ? name(r) : `${m} ${name(r)}`;
      if (m === 1) return at === 0 ? `one ${name(r)}` : `the ${ORDINAL[at + 1]}`;
      if (at === 0) return `${m} ${name(r)}`;
      return at + m === all.length && all.slice(at).every((u) => picked.includes(u)) ? `the other ${m}` : `${m} more`;
    };
    for (const s of SIDES) {
      const got = units.filter((u) => u.side === s);
      if (!got.length) continue;
      const kinds = [...new Set(got.map((u) => u.r))];
      const what = kinds.length === 1 ? share(kinds[0], got) : listOf(kinds.map((r) => `${got.filter((u) => u.r === r).length} ${name(r)}`));
      words.push(`${names[s]} sells ${what} for ${plural(sum(got.map((u) => u.coins)), "coin")}.`);
    }
    const lost = rs.filter((r) => of(r).some((u) => u.how === "missing" && !u.side));
    if (lost.length) {
      const what = lost.map((r) => {
        const all = of(r);
        const miss = all.filter((u) => u.how === "missing" && !u.side);
        if (miss.length === all.length) return name(r);
        return miss.length === 1 ? `a ${ORDINAL[all.indexOf(miss[0]) + 1]} ${name(r)}` : `${miss.length} more ${name(r)}`;
      });
      words.push(`Nobody near you sells ${listOf(what, "or")}.`);
    }
  }
  if (bank) words.push(units.length ? `It also costs ${plural(bank, "coin")}, paid to the bank.` : `It costs ${plural(bank, "coin")}, paid to the bank.`);
  return words.join(" ");
}

// The badge a hand card wears, from its pickOptions() (art.js) with its card
// or id: { id, kind, coins, label, why?, reason? }. kind: "make" (you make all it
// needs and it costs no coins), "free" (it costs nothing at all), "chain",
// "wonder" (only the wonder's free build can build it), "pay" (coins: the
// cheapest way, bank and neighbours together) or "no" (why: "duplicate",
// "coins", "resources" or "unknown").
export function badgeOf(o) {
  const b = o.build;
  const card = o.card ?? CARDS[o.id];
  const id = o.id ?? card?.id ?? -1;
  if (b.why === "duplicate") return { id, kind: "no", coins: 0, label: "Already built", why: "duplicate", reason: `You already have ${card?.name ?? "it"}.` };
  if (b.chain) return { id, kind: "chain", coins: 0, label: "Chain · free" };
  if (b.purchases?.length) {
    const coins = b.purchases[0].coins + (b.coins ?? card?.cost.coins ?? 0);
    if (coins) return { id, kind: "pay", coins, label: plural(coins, "coin") };
    if (card && sum(card.cost.res)) return { id, kind: "make", coins: 0, label: "You make it" };
    return { id, kind: "free", coins: 0, label: "Free" };
  }
  if (o.free) return { id, kind: "wonder", coins: 0, label: "Wonder · free" };
  const why = b.why ?? "resources";
  const reason = why === "coins" ? "You haven't the coins to buy what it needs." : why === "unknown" ? "" : "You and your neighbours can't make what it needs.";
  return { id, kind: "no", coins: 0, label: "Can't build", why, reason };
}

// ---------- the view ----------

const TEMPLE = '<svg viewBox="0 0 16 16" focusable="false" aria-hidden="true"><path class="roof" d="M1.5 6.2 8 2l6.5 4.2z"/><path class="cols" d="M3.2 7.2h1.7v5H3.2zM7.15 7.2h1.7v5h-1.7zM11.1 7.2h1.7v5h-1.7z"/><path class="base" d="M2 12.6h12v1.8H2z"/></svg>';
const tip = (kind, args) => Object.fromEntries([["tip", kind], ...Object.entries(args).map(([k, v]) => [`tip${k[0].toUpperCase()}${k.slice(1)}`, String(v)])]);
const orIcons = (kit, options) => options.flatMap((r, j) => (j ? [el("span", { class: "sc-or", "aria-hidden": "true" }, "/"), kit.resEl(r)] : [kit.resEl(r)]));

// The shelf: compact (a neighbour's panel: icons ×n and "a / b" tokens) or
// full (yours: the seven slots always, empty ones dimmed, then the either
// tokens). update(shelf, { use, buy, need }) lights slots as highlightOf()
// gives them. Arrow keys move along the slots (one tab stop).
export function shelfView({ kit, compact = false } = {}) {
  const node = el(compact ? "span" : "div", { class: `sc-shelf ${compact ? "compact" : "full"}`, role: "group" });
  const fixed = el("div", { class: "sc-shelf-fixed" });
  const either = el(compact ? "span" : "div", { class: "sc-shelf-either" });
  const slots = [];
  if (!compact) {
    node.append(el("div", { class: "sc-shelf-head" }, el("span", { class: "sc-shelf-lab" }, "You make each turn"), el("span", { class: "sc-shelf-key", "aria-hidden": "true" }, el("i", { class: "use" }), "have", el("i", { class: "buy" }), "buy", el("i", { class: "need" }), "nobody sells")), fixed, either);
    for (const group of [RAW, GOODS]) {
      const g = el("div", { class: `sc-shelf-group ${group === RAW ? "raw" : "goods"}` });
      for (const r of group) {
        const count = el("b", { class: "sc-slot-n" });
        const src = el("small", { class: "sc-slot-src" });
        const mark = el("span", { class: "sc-slot-mark", "aria-hidden": "true", hidden: true });
        mark.innerHTML = TEMPLE;
        const s = el("span", { class: `sc-slot r-${r}`, tabindex: "-1", dataset: { ...tip("make", { res: r }), r } }, el("span", { class: "sc-slot-ic" }, kit.resEl(r), mark), el("span", { class: "sc-slot-words" }, count, src));
        slots[r] = { s, count, src, mark };
        g.append(s);
      }
      fixed.append(g);
    }
  } else node.append(fixed, either);

  let last = null;
  node.addEventListener("keydown", (e) => {
    const all = [...node.querySelectorAll(".sc-slot")];
    const i = all.indexOf(e.target);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -i, End: all.length - 1 - i }[e.key];
    if (i < 0 || step === undefined) return;
    e.preventDefault();
    const to = all[Math.max(0, Math.min(all.length - 1, i + step))];
    all.forEach((x) => (x.tabIndex = x === to ? 0 : -1));
    to.focus();
  });
  const roving = () => {
    const all = [...node.querySelectorAll(".sc-slot")];
    if (!all.some((x) => x.tabIndex === 0) && all[0]) all[0].tabIndex = 0;
  };

  function draw(shelf) {
    const own = !compact;
    if (own) {
      shelf.fixed.forEach((n, r) => {
        const { s, count, src, mark } = slots[r];
        count.textContent = n ? String(n) : "–";
        src.textContent = shelf.sources[r].join(", ");
        s.classList.toggle("none", !n);
        s.classList.toggle("wonder", shelf.wonder === r);
        mark.hidden = shelf.wonder !== r;
        s.dataset.tipSeat = String(shelf.p);
        s.setAttribute("aria-label", n ? `${n} ${RESOURCE_NAMES[r]}: ${listOf(shelf.sources[r])}` : `No ${RESOURCE_NAMES[r]}`);
      });
    } else {
      fixed.replaceChildren(
        ...shelf.fixed.flatMap((n, r) =>
          n ? [el("span", { class: `sc-slot r-${r}`, tabindex: "-1", dataset: { ...tip("make", { res: r, seat: shelf.p }), r }, "aria-label": `${n} ${RESOURCE_NAMES[r]}` }, kit.resEl(r), n > 1 ? el("small", { "aria-hidden": "true" }, `×${n}`) : null)] : [],
        ),
      );
    }
    // Alike tokens (two cards making the same choice) share one, counted.
    const groups = [];
    shelf.either.forEach((e, i) => {
      const key = e.options.join("/");
      const g = groups.find((x) => x.key === key && compact);
      if (g) g.at.push(i);
      else groups.push({ key, e, at: [i] });
    });
    either.replaceChildren(
      ...groups.map(({ e, at }) => {
        const words = listOf(e.options.map((r) => RESOURCE_NAMES[r]), "or");
        const body = own
          ? [el("span", { class: "sc-either-ics" }, orIcons(kit, e.options)), el("span", { class: "sc-slot-words" }, el("b", { class: "sc-slot-n" }, "1"), el("small", { class: "sc-slot-src" }, e.source))]
          : [...orIcons(kit, e.options), at.length > 1 ? el("small", { "aria-hidden": "true" }, `×${at.length}`) : null];
        const label = own ? `Either ${words}, one a turn: ${e.source}${e.sale ? "" : ", not for sale to your neighbours"}` : `${at.length > 1 ? `${at.length} × ` : ""}${words}`;
        return el("span", { class: `sc-slot either n${e.options.length}${e.sale ? "" : " kept"}`, tabindex: "-1", dataset: { ...tip("either", { seat: shelf.p, res: e.options.join(","), source: e.source }), e: at.join(" ") }, "aria-label": label }, body);
      }),
    );
    node.classList.toggle("has-either", shelf.either.length > 0);
    node.setAttribute("aria-label", own ? `You make each turn: ${shelfWords(shelf)}` : `Sells ${shelfWords(shelf, { sources: false })}`);
    roving();
  }

  function update(shelf, { use = [], buy = [], need = [] } = {}) {
    const key = JSON.stringify(shelf);
    if (key !== last) draw(shelf);
    last = key;
    const lit = (list, r) => list.some((x) => String(x) === String(r));
    for (const s of node.querySelectorAll(".sc-slot")) {
      const keys = s.classList.contains("either") ? s.dataset.e.split(" ").map((i) => `e${i}`) : [s.dataset.r];
      const on = (list) => keys.some((k) => lit(list, k));
      s.classList.toggle("use", on(use));
      s.classList.toggle("need", !on(use) && on(need));
      s.classList.toggle("buy", !on(use) && !on(need) && on(buy));
    }
  }
  return { node, update };
}

// The cost of a hand card against the shelf: one chip per unit (green: you
// make it, gold: bought or for sale, with the seller and price, red: nobody
// sells it) and the sentence under them. names: { left, right }.
export function costMatchEl(units, names, kit, { bank = 0 } = {}) {
  const chip = (u) => {
    const r = RESOURCE_NAMES[u.r];
    let text;
    let cls = "own";
    let data = tip("make", { res: u.r });
    if (u.how === "own") text = `from ${u.source}`;
    else if (u.how === "either") {
      text = `${u.source} makes ${r} this turn`;
      data = tip("either", { res: (u.options ?? [u.r]).join(","), source: u.source });
    } else if (u.side) {
      cls = u.how === "buy" ? "buy" : "sale";
      text = u.how === "buy" ? `buy from ${names[u.side]} on your ${u.side} · ${plural(u.coins, "coin")}` : `${names[u.side]} on your ${u.side} sells it · ${plural(u.coins, "coin")}`;
      data = tip("price", { res: u.r, side: u.side });
    } else {
      cls = "miss";
      text = "nobody near you sells it";
      data = tip("make", { res: u.r });
    }
    return el("span", { class: `sc-unit ${cls}`, role: "listitem", dataset: data }, kit.resEl(u.r), el("span", {}, el("b", {}, r), ` · ${text}`));
  };
  const row = el("div", { class: "sc-unit-row", role: "list", "aria-label": "What it needs" }, ...units.map(chip));
  if (bank) row.append(el("span", { class: "sc-unit bank", role: "listitem", dataset: tip("bank", {}) }, kit.coinEl(), el("span", {}, el("b", {}, plural(bank, "coin")), " · to the bank")));
  return el("div", { class: "sc-match" }, units.length || bank ? row : null, el("p", { class: "sc-match-words" }, matchWords(units, names, { bank })));
}

// A hand card's badge: "You make it", "Free", "Chain · free", a coin price, "Wonder · free" or "Can't build".
export function badgeEl(badge, kit) {
  const body = badge.kind === "pay" ? [kit.coinEl(), el("span", { "aria-hidden": "true" }, String(badge.coins)), el("span", { class: "sr-only" }, badge.label)] : [badge.label];
  return el("span", { class: `sc-tag ${badge.kind}`, dataset: tip("badge", { kind: badge.kind, ...(badge.id >= 0 ? { id: badge.id } : {}) }) }, ...body);
}
