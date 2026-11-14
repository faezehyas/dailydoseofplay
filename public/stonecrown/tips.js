// Stonecrown explains itself: a tooltip for anything on the table marked
// data-tip="<kind>" (its arguments in data-tip-*), opened by hover, keyboard
// focus, press-and-hold or, in Explain mode, a tap that explains instead of
// acting; a card's tip shows the card large with its words. Also the legend
// of every icon, and first-time hints shown once ever. tipWords() writes the
// words from the public state and your own cards only.
import { el } from "../engine/shell.js";
import { CARDS, COLORS, RESOURCE_NAMES, SYMBOLS, RAW, GOODS, VICTORY, DEFEAT, DISCARD_COINS, TRADE_COST } from "./cards.js";
import { leftOf, rightOf, passDir, stagesOf, wonderOf, cardsOf, builtStages, chained, production, unitPrice, sideCoins, purchases, canBuild, canStage, countPer, sciencePoints, scienceSymbols, score, shields, ROUNDS } from "./rules.js";
import { cardText, colourIcon } from "./card-art.js";

export const HINTS_KEY = "ddp-stonecrown-hints";
// One sentence for each first time, pointing at the thing it names.
export const HINT_WORDS = {
  buy: "You're buying from a neighbour: your coins cross the river to them when the turn ends.",
  chain: "This one is free: you already built the card it chains from.",
  war: "The age is over, so each border goes to whoever has more shields.",
  pass: "Your leftover cards slide to your neighbour, and theirs come to you.",
};

const ROMAN = ["", "I", "II", "III"];
const FLAG_KEY = "A raised gold flag is a win, a torn red one at half-mast a loss, a striped one a draw, and a faint one on a dotted pole still to come.";
const RES = RESOURCE_NAMES;
const SCI = SYMBOLS;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const listOf = (xs, last = "and") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${last} ${xs.at(-1)}`);
const signed = (n) => (n < 0 ? `−${-n}` : `+${n}`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const coins = (n) => plural(n, "coin");
const NAMES = Object.fromEntries(CARDS.map((c) => [c.key, c.name]));
const matches = (card, per) => (Array.isArray(per) ? per.includes(card.color) : card.color === per);

// "2 wood and 1 stone", or "free": a cost as art.js says it.
export function costWords(cost) {
  const parts = cost.res.flatMap((n, r) => (n ? [`${n} ${RES[r]}`] : []));
  if (cost.coins) parts.push(coins(cost.coins));
  return parts.length ? listOf(parts) : "free";
}
const countWords = (counts) => listOf(counts.flatMap((n, r) => (n ? [`${n} ${RES[r]}`] : []))) || "nothing";
const kindWords = (kinds) => listOf(kinds.map((r) => RES[r]));
// What units make: "2 wood", "wood or clay", "wood and stone or clay".
function unitWords(units) {
  if (units.every((u) => u.length === 1)) return countWords(RES.map((_, r) => units.filter((u) => u[0] === r).length));
  return listOf(units.map((u) => listOf(u.map((r) => RES[r]), "or")));
}

// What a wonder stage gives, after "it": "is worth 7 points", "pays 9 coins at once".
function givesWords(x, them = "you") {
  const parts = [];
  if (x.points) parts.push(`is worth ${plural(x.points, "point")}`);
  if (x.shields) parts.push(`adds ${plural(x.shields, "shield")}`);
  if (x.gold) parts.push(`pays ${coins(x.gold)} at once`);
  if (x.produce) parts.push(`makes one of ${x.produce.map((u) => (u.length === RAW.length ? "the raw materials" : u.length === GOODS.length ? "the goods" : kindWords(u))).join(" and ")} a turn for ${them} alone`);
  if (x.science === "any") parts.push("counts as whichever science symbol scores best");
  if (x.trade) parts.push(`makes ${x.trade.kinds.length === RAW.length ? "raw materials" : kindWords(x.trade.kinds)} from ${x.trade.sides.length === 2 ? "both neighbours" : `the ${x.trade.sides[0]} neighbour`} cost 1 coin`);
  if (x.dig) parts.push("builds one card from the discard pile free");
  if (x.free) parts.push("builds one card free each age");
  if (x.copyGuild) parts.push("copies a neighbour's guild at the end");
  if (x.playLast) parts.push("plays the seventh card of each age instead of discarding it");
  return listOf(parts) || "does nothing";
}

// The reader's view of the table: names, sides and the age.
function contextOf({ state, me, nameOf = (p) => `Seat ${p + 1}` }) {
  const L = leftOf(state, me);
  const R = rightOf(state, me);
  const name = (p) => (p === me ? "you" : nameOf(p));
  return {
    state,
    me,
    n: state.players,
    L,
    R,
    nameOf,
    name,
    Name: (p) => cap(name(p)),
    whose: (p) => (p === me ? "your" : `${nameOf(p)}'s`),
    Whose: (p) => (p === me ? "Your" : `${nameOf(p)}'s`),
    side: (p) => (p === L ? "left" : p === R ? "right" : null),
    age: Math.min(3, Math.max(1, state.age || 1)),
    over: state.phase === "over",
  };
}
const seatOf = (a, c) => {
  const p = Number(a.seat);
  return a.seat !== undefined && a.seat !== "" && Number.isInteger(p) && p >= 0 && p < c.n ? p : c.me;
};
// A border's side names the neighbour on it.
const sideSeat = (a, c) => (a.seat !== undefined && a.seat !== "" ? seatOf(a, c) : a.side === "right" ? c.R : a.side === "left" ? c.L : c.me);
const intOf = (v, fallback = null) => {
  const x = Number(v);
  return v !== undefined && v !== null && v !== "" && Number.isInteger(x) ? x : fallback;
};
const fight = (c, q) => {
  const m = shields(c.state, c.me);
  const t = shields(c.state, q);
  return { m, t, r: Math.sign(m - t) };
};
const stakeWords = (r, age) => (r > 0 ? `win this border and take a +${VICTORY[age - 1]} token` : r < 0 ? "lose this border and take a −1 token" : "draw this border and take no token");
const beatWords = (r, who, age) => (r > 0 ? `beat ${who} (+${VICTORY[age - 1]})` : r < 0 ? `lose to ${who} (−1)` : `draw with ${who}`);

// Who sells you what, and the card or stage of yours that makes it cheaper.
const discountOf = (c, r, side) => [...cardsOf(c.state, c.me), ...builtStages(c.state, c.me)].find((x) => x.trade && x.trade.kinds.includes(r) && x.trade.sides.includes(side));
const sourceName = (x) => (x?.name ? `your ${x.name}` : "your wonder");
// Each discount is credited to the card or stage that gives it.
function priceWords(c, rs, side) {
  const dear = [];
  const cheap = new Map();
  for (const r of rs) {
    if (unitPrice(c.state, c.me, r, side) >= TRADE_COST) {
      dear.push(r);
      continue;
    }
    const src = sourceName(discountOf(c, r, side));
    cheap.set(src, [...(cheap.get(src) ?? []), r]);
  }
  if (!cheap.size) return `${coins(TRADE_COST)} a unit`;
  if (!dear.length) return `${coins(1)} a unit, thanks to ${listOf([...cheap.keys()])}`;
  return `${coins(1)} for ${listOf([...cheap].map(([src, list]) => `${kindWords(list)} (${src})`))} and ${TRADE_COST} for ${kindWords(dear)}`;
}
// What a seat sells, alike units counted, in the order they come: "2 papyrus, wood or clay and ore".
function saleWords(units) {
  const seen = new Map();
  for (const u of units) {
    const k = u.join("/");
    seen.set(k, { u, n: (seen.get(k)?.n ?? 0) + 1 });
  }
  const all = [...seen.values()];
  const singles = all.filter(({ u }) => u.length === 1).map(({ u, n }) => `${n > 1 ? `${n} ` : ""}${RES[u[0]]}`);
  const choices = all.filter(({ u }) => u.length > 1).flatMap(({ u, n }) => Array(n).fill(`one of ${listOf(u.map((r) => RES[r]), "or")}`));
  if (!singles.length) return listOf(choices);
  return `${listOf(singles)}${choices.length ? `, plus ${listOf(choices)}` : ""}`;
}
// The resources in units, each once, in the order they come.
const resOf = (units) => [...new Set(units.flat())];
// A seat whose wonder plays the seventh card of each age instead of discarding it.
const playsLast = (c, p) => builtStages(c.state, p).some((x) => x.playLast);

// ---------- a card, for whoever holds it ----------
const thingWords = (per, n) => (per === "stage" ? plural(n, "wonder stage") : per === "defeat" ? plural(n, "defeat token") : `${n} ${listOf([per].flat(), "or")} card${n === 1 ? "" : "s"}`);
function whereWords(spec, q, c) {
  const own = q === c.me ? "your" : "their";
  const self = spec.from.includes("self");
  const sides = spec.from.filter((s) => s !== "self");
  const by = q === c.me ? "you" : "them";
  if (spec.per === "stage") return self && sides.length ? `built by ${by} and ${own} neighbours` : self ? `of ${own} wonder` : `built by ${own} neighbours`;
  if (self && sides.length === 2) return `in ${own} city and ${own} neighbours'`;
  if (self) return `in ${own} city`;
  if (sides.length === 2) return `in ${own} neighbours' cities`;
  return `in ${own} ${sides[0]} neighbour's city`;
}
// The seats a spec counts, from q's seat.
const looked = (c, spec, q) => spec.from.map((s) => (s === "self" ? q : s === "left" ? leftOf(c.state, q) : rightOf(c.state, q)));

function meaning(card, q, hypo, c) {
  const st = c.state;
  const me = c.me;
  const mine = q === me;
  const N = c.Name(q);
  if (card.produce) {
    const what = unitWords(card.produce);
    const sale = card.color === "brown" || card.color === "grey";
    if (hypo) {
      const rs = resOf(card.produce);
      const plain = rs.length === 1 && card.produce.every((u) => u.length === 1);
      const now = plain ? production(st, me).own.filter((u) => u.length === 1 && u[0] === rs[0]).length : 0;
      const head = !plain ? `You'd get ${what} every turn.` : now ? `You'd make ${card.produce.length} more ${RES[rs[0]]} every turn, ${now + card.produce.length} in all.` : `You'd make ${what} every turn; you make none now.`;
      return `${head}${sale ? "" : " It's for you alone: neighbours can't buy it."}`;
    }
    if (mine) return `You make ${what} with it every turn${sale ? ", and your neighbours can buy it from you" : "; neighbours can't buy it"}.`;
    if (!sale) return `${N} makes ${what} with it every turn, for themselves alone.`;
    const s = c.side(q);
    if (!s) return `${N} makes ${what} with it every turn. They aren't your neighbour, so you can't buy it.`;
    return `${N} makes ${what} with it every turn, and you can buy it for ${priceWords(c, resOf(card.produce), s)}.`;
  }
  if (card.points) return hypo ? `Worth ${plural(card.points, "point")} to you at the end.` : `${mine ? "You score" : `${N} scores`} ${plural(card.points, "point")} for it at the end.`;
  if (card.shields) {
    const k = card.shields;
    const m = shields(st, me);
    if (hypo) return `+${k}: you'd have ${plural(m + k, "shield")} to ${c.nameOf(c.L)}'s ${shields(st, c.L)} and ${c.nameOf(c.R)}'s ${shields(st, c.R)}.`;
    if (mine) return `Gives you ${plural(k, "shield")}; you have ${m} in all.`;
    const t = shields(st, q);
    if (c.side(q)) return `${cap(plural(k, "shield"))} for ${N}: they have ${t} to your ${m}.`;
    return `${cap(plural(k, "shield"))} for ${N}, who isn't your neighbour, so it doesn't change your wars.`;
  }
  if (card.science !== undefined) {
    const sym = card.science === "any" ? "Any science symbol" : `A ${SCI[card.science]}`;
    const { counts, wilds } = scienceSymbols(st, q);
    const now = sciencePoints(counts, wilds);
    if (hypo) {
      const after = card.science === "any" ? sciencePoints(counts, wilds + 1) : sciencePoints(counts.with(card.science, counts[card.science] + 1), wilds);
      return `${sym} for your science: it would go from ${now} to ${plural(after, "point")}.`;
    }
    return `${sym} for ${c.whose(q)} science, now worth ${plural(now, "point")}.`;
  }
  if (card.gold) return hypo ? `Pays you ${coins(card.gold)} when you build it.` : `It paid ${c.name(q)} ${coins(card.gold)} when built.`;
  if (card.trade) {
    const kinds = kindWords(card.trade.kinds);
    const sides = card.trade.sides;
    if (hypo || mine) return `${hypo ? "You'd buy" : "You buy"} ${kinds} from ${sides.length === 2 ? "either neighbour" : c.nameOf(sides[0] === "left" ? c.L : c.R)} for 1 coin instead of ${TRADE_COST}.`;
    const theirs = sides.map((s) => (s === "left" ? leftOf(st, q) : rightOf(st, q)));
    const from = sides.length === 2 ? "both their neighbours" : `their ${sides[0]} neighbour`;
    return `${N} buys ${kinds} from ${from} for 1 coin. ${theirs.includes(me) ? `That's you: they pay you 1 coin a unit instead of ${TRADE_COST}.` : "It does nothing for you."}`;
  }
  const spec = card.income ?? card.score;
  if (spec) {
    const count = (sp) => sum(looked(c, sp, q).map((p) => countPer(st, p, sp.per))) + (hypo && sp.from.includes("self") && matches(card, sp.per) ? 1 : 0);
    const n = count(spec);
    const thing = `${thingWords(spec.per, n)} ${whereWords(spec, q, c)}`;
    const pts = card.score ? count(card.score) * card.score.points : 0;
    const yours = !mine && looked(c, spec, q).includes(me) ? countPer(st, me, spec.per) : 0;
    if (hypo) {
      const pay = card.income ? `Pays you ${coins(n * card.income.coins)} now` : "";
      const end = card.score ? `${pay ? " and scores" : "Scores"} ${plural(pts, "point")} at the end as things stand` : "";
      return `${pay}${end}: ${thing}.`;
    }
    if (card.score) return `${mine ? "It scores you" : `It scores ${N}`} ${plural(pts, "point")} as things stand: ${thing}${yours ? `, ${yours} of them yours` : ""}.`;
    const each = `${coins(card.income.coins)} for each ${thingWords(spec.per, 1).replace(/^1 /, "")} ${whereWords(spec, q, c)}`;
    return `It paid ${c.name(q)} ${each} when built.${yours ? " Your cards counted, but only they were paid." : ""}`;
  }
  return "";
}

// Whether a card in your hand chains from what you built (what it builds free later is in cardText).
function chainWords(card, c) {
  if (!card.from.length) return "";
  const have = card.from.filter((k) => c.state.city[c.me].some((x) => CARDS[x.id].key === k)).map((k) => NAMES[k]);
  return chained(c.state, c.me, card) ? `You have ${listOf(have)}, so you build it free.` : `It would be free with ${listOf(card.from.map((k) => NAMES[k]), "or")}, which you don't have.`;
}

// ---------- the words for every kind ----------
const WORDS = {
  coins(a, c) {
    const q = seatOf(a, c);
    const n = c.state.coins[q];
    if (q === c.me) {
      const pts = Math.floor(n / 3);
      const need = 3 - (n % 3);
      const next = n % 3 ? `; ${need} more ${need === 1 ? "makes" : "make"} ${pts ? "another" : "your first"}` : "";
      return { title: "Your coins", body: `You have ${n}, worth ${plural(pts, "point")} at the end (1 for every 3)${next}. Card prices go to the bank and purchases to your neighbours.` };
    }
    const tail = c.side(q) ? "Coins you pay them arrive when the turn ends." : "They aren't your neighbour, so no coins pass between you.";
    return { title: "Coins", body: `${c.Name(q)} has ${n}. Every 3 coins are worth 1 point at the end. ${tail}` };
  },

  shields(a, c) {
    const q = seatOf(a, c);
    if (q === c.me) {
      const l = fight(c, c.L);
      const r = fight(c, c.R);
      const head = `You have ${l.m}: ${c.nameOf(c.L)} has ${l.t} and ${c.nameOf(c.R)} has ${r.t}.`;
      if (c.over) return { title: "Your shields", body: `${head} The wars are over.` };
      return { title: "Your shields", body: `${head} If the age ended now you would ${beatWords(l.r, c.nameOf(c.L), c.age)} and ${beatWords(r.r, c.nameOf(c.R), c.age)}.` };
    }
    const { m, t, r } = fight(c, q);
    if (!c.side(q)) return { title: "Shields", body: `${c.Name(q)} has ${t}. They aren't your neighbour, so they fight ${c.name(leftOf(c.state, q))} and ${c.name(rightOf(c.state, q))}, never you.` };
    if (c.over) return { title: "Shields", body: `${c.Name(q)} ended with ${t} and you with ${m}. The wars are over.` };
    return { title: "Shields", body: `${c.Name(q)} has ${t} and you have ${m}. If the age ended now you would ${stakeWords(r, c.age)}.` };
  },

  tokens(a, c) {
    const q = seatOf(a, c);
    const t = c.state.tokens[q];
    const who = c.Name(q);
    if (!t.length) return { title: "War tokens", body: `${q === c.me ? "You have" : `${who} has`} no war tokens yet. At the end of each age, more shields than a neighbour wins ${plural(VICTORY[c.age - 1], "point")} and fewer loses 1.` };
    const won = VICTORY.flatMap((v, i) => {
      const k = t.filter((x) => x === v).length;
      return k ? [`${plural(v, "point")} ${k > 1 ? "from each border " : ""}in age ${ROMAN[i + 1]}`] : [];
    });
    const lost = t.filter((x) => x === DEFEAT).length;
    const parts = [...(won.length ? [`won ${listOf(won)}`] : []), ...(lost ? [`lost ${lost > 1 ? `${lost === 2 ? "twice" : `${lost} times`} (−1 each)` : "once (−1)"}`] : [])];
    const total = sum(t);
    return { title: "War tokens", body: `${who} ${parts.join(", and ")}. Tokens add up to ${total ? signed(total) : "0"} on the score sheet.` };
  },

  stages(a, c) {
    const q = seatOf(a, c);
    const all = stagesOf(c.state, q);
    const built = c.state.stages[q].length;
    const next = all[built];
    const has = q === c.me ? "You have" : `${c.Name(q)} has`;
    if (!next) return { title: "Wonder stages", body: `${has} built all ${all.length} stages of ${wonderOf(c.state, q).name}.` };
    const head = `${has} built ${built} of ${all.length}. The next one costs ${costWords(next.cost)} and ${givesWords(next, q === c.me ? "you" : "them")}.`;
    if (q !== c.me) return { title: "Wonder stages", body: head };
    const can = canStage(c.state, c.me);
    return { title: "Your wonder", body: `${head} ${can.ok ? "Tuck any card from your hand under your wonder to build it." : "You can't pay for it yet, even buying from your neighbours."}` };
  },

  sells(a, c) {
    const q = sideSeat(a, c);
    const s = c.side(q);
    const units = production(c.state, q).sale;
    const what = cap(saleWords(units));
    if (q === c.me) return { title: "What you sell", body: `${what}: what your brown and grey cards and wonder make. Your neighbours may buy each unit once a turn, and the coins come to you.` };
    if (!s) return { title: "What they make", body: `${what}. ${c.Name(q)} isn't your neighbour, so you can't buy from them.` };
    return { title: "For sale to you", body: `${what}: what ${c.nameOf(q)}'s brown and grey cards and wonder make. ${cap(priceWords(c, resOf(units), s))}. Buying doesn't use them up.` };
  },

  counts(a, c) {
    const q = seatOf(a, c);
    const ids = c.state.city[q].map((x) => x.id);
    const parts = COLORS.flatMap((col) => {
      const k = ids.filter((id) => CARDS[id].color === col).length;
      return k ? [`${k} ${col}`] : [];
    });
    const open = q === c.me ? "" : ` Tap to open ${c.nameOf(q)}'s whole city.`;
    return { title: "Cards by colour", body: parts.length ? `${cap(listOf(parts))}.${open}` : `${q === c.me ? "You haven't" : `${c.Name(q)} hasn't`} built anything yet.` };
  },

  card(a, c) {
    const card = CARDS[intOf(a.id, -1)];
    if (!card) return { title: "A card", body: "A card you haven't seen." };
    const hypo = a.where === "hand" || a.where === "dig" || a.seat === undefined || a.seat === "";
    const q = hypo ? c.me : seatOf(a, c);
    // While digging the card is free anyway, chain or not.
    const more = [cardText(card.id), hypo && a.where !== "dig" ? chainWords(card, c) : ""].filter(Boolean);
    return { title: card.name, body: meaning(card, q, hypo, c), card: card.id, more };
  },

  back(a, c) {
    const age = Math.min(3, Math.max(1, intOf(a.age, c.age)));
    const q = seatOf(a, c);
    if (a.where === "pick") return { title: q === c.me ? "Your pick" : "Picked", body: `${q === c.me ? "You have" : `${c.Name(q)} has`} picked a card. Picks turn over together once everyone has chosen.` };
    if (a.where === "tucked") return { title: "A tucked card", body: `A card tucked face down under a wonder stage. Nobody but ${c.name(q)} knows what it was.` };
    if (a.where === "stack") {
      const n = intOf(a.count, c.state.hands[q]?.length ?? 0);
      const to = (q + passDir(c.age) + c.n) % c.n;
      const then = c.state.round < ROUNDS ? `After this turn ${q === c.me ? "it goes" : "they go"} to ${c.name(to)}.` : playsLast(c, q) ? `${q === c.me ? "Your" : "Their"} wonder plays the last card instead of discarding it.` : "After this turn the last card is discarded.";
      return { title: `${c.Whose(q)} hand`, body: `${plural(n, "card")}, face down. ${then}` };
    }
    return { title: `An age ${ROMAN[age]} card`, body: "Face down. You see a card's face only when it's in your hand or built." };
  },

  slot(a, c) {
    const q = seatOf(a, c);
    const all = stagesOf(c.state, q);
    const n = Math.min(all.length - 1, Math.max(0, intOf(a.stage, 0)));
    const x = all[n];
    const built = c.state.stages[q].length;
    const title = `Stage ${ROMAN[n + 1] ?? n + 1} of ${wonderOf(c.state, q).city}`;
    const them = q === c.me ? "you" : "them";
    if (n < built) return { title, body: `Built: it ${givesWords(x, them)}. A card is tucked face down under it.` };
    const head = `It costs ${costWords(x.cost)} and ${givesWords(x, them)}.`;
    if (q !== c.me) return { title, body: head };
    if (n > built) return { title, body: `${head} Build stage ${ROMAN[built + 1]} first.` };
    const can = canStage(c.state, c.me);
    return { title, body: `${head} ${can.ok ? "You can build it now by tucking a card from your hand." : "You can't pay for it yet."}` };
  },

  either(a, c) {
    const q = seatOf(a, c);
    const opts = String(a.res ?? "").split(/[,/ ]+/).map(Number).filter((r) => RES[r] !== undefined);
    const words = listOf(opts.map((r) => RES[r]), "or") || "one of several resources";
    const key = opts.slice().sort().join();
    const card = cardsOf(c.state, q).find((x) => x.produce?.some((u) => u.length > 1 && u.slice().sort().join() === key));
    const source = a.source || card?.name || "a wonder stage";
    const sale = card && (card.color === "brown" || card.color === "grey");
    if (q === c.me) return { title: "Either", body: `Makes ${words}, one a turn, from your ${source}. You choose which each time you pay.` };
    const tail = !sale ? "It's for them alone." : c.side(q) ? "You may buy one of them a turn." : "They aren't your neighbour, so you can't buy it.";
    return { title: "Either", body: `${c.Name(q)} makes ${words}, one a turn, from ${source}. ${tail}` };
  },

  price(a, c) {
    const q = a.seat !== undefined ? seatOf(a, c) : a.side === "right" ? c.R : c.L;
    const s = c.side(q);
    if (!s) return { title: "Price", body: `${c.Name(q)} isn't your neighbour, so you can't buy from them.` };
    const r = intOf(a.res);
    if (r !== null && RES[r]) {
      const p = unitPrice(c.state, c.me, r, s);
      const why = p < TRADE_COST ? ` thanks to ${sourceName(discountOf(c, r, s))}` : "";
      return { title: `${coins(p)} each`, body: `${cap(RES[r])} from ${c.nameOf(q)} costs you ${coins(p)} a unit${why}. The coins reach them when the turn ends.` };
    }
    return { title: "Prices", body: `From ${c.nameOf(q)}: ${priceWords(c, [...RAW, ...GOODS], s)}. The coins reach them when the turn ends.` };
  },

  crossing(a, c) {
    const q = a.seat !== undefined ? seatOf(a, c) : a.side === "right" ? c.R : c.L;
    const s = c.side(q);
    if (!s) return { title: "No border", body: `${c.Name(q)} isn't your neighbour, so no river runs between you.` };
    const raw = discountOf(c, RAW[0], s);
    const goods = discountOf(c, GOODS[0], s);
    const road = s === "left" ? "West Road" : "East Road";
    const parts = [];
    if (raw) parts.push(`${sourceName(raw).replace(/^your/, "Your")} built the bridge: raw materials from ${c.nameOf(q)} cost 1 coin.`);
    if (goods) parts.push(`${sourceName(goods).replace(/^your/, "Your")} set up the market stall: glass, cloth and papyrus cost 1 coin.`);
    if (!parts.length) return { title: "The river", body: `Between you and ${c.nameOf(q)}. With no trade card a ferry carries what you buy, at ${TRADE_COST} coins a unit; ${road} would build a bridge.` };
    return { title: raw ? "The bridge" : "The market stall", body: `${parts.join(" ")}${raw && goods ? "" : ` Everything else is ${TRADE_COST} coins.`}` };
  },

  flags(a, c) {
    const q = a.seat !== undefined ? seatOf(a, c) : a.side === "right" ? c.R : c.L;
    const rs = String(a.results ?? a.flags ?? "").split(",").map((x) => (x.trim() === "" || x.trim() === "null" ? null : Math.sign(Number(x))));
    const known = (r) => r === 1 || r === 0 || r === -1;
    const words = [1, 2, 3].flatMap((age, i) => {
      const r = rs[i];
      if (!known(r)) return [];
      return [r > 0 ? `won age ${ROMAN[age]} (+${VICTORY[i]})` : r < 0 ? `lost age ${ROMAN[age]} (−1)` : `drew age ${ROMAN[age]}`];
    });
    const open = [1, 2, 3].filter((age, i) => !known(rs[i])).map((age) => ROMAN[age]);
    if (open.length) words.push(`${open.length > 1 ? "ages" : "age"} ${listOf(open)} still to come`);
    return { title: "Flags", body: `Your wars with ${c.nameOf(q)}: ${listOf(words)}. ${FLAG_KEY}` };
  },

  warn(a, c) {
    const q = a.seat !== undefined ? seatOf(a, c) : a.side === "right" ? c.R : c.L;
    const { m, t } = fight(c, q);
    const win = VICTORY[c.age - 1];
    const head = `${c.Name(q)} has ${plural(t, "shield")} and you have ${m}.`;
    if (m > t) return { title: `You lead by ${m - t}`, body: `${head} If the age ended now you'd win +${win} at this border.` };
    if (m === t) return { title: "Level", body: `${head} One more shield would win you +${win} at this border; as it is, nobody takes a token.` };
    const need = t - m + 1;
    return { title: `You trail by ${t - m}`, body: `${head} You need ${plural(need, "more shield")} before the age ends to win +${win}${need > 1 ? `, or ${t - m} to draw` : ""}; otherwise you take −1.` };
  },

  seat(a, c) {
    const q = seatOf(a, c);
    if (q === c.me) return { title: "You", body: `Your left neighbour is ${c.nameOf(c.L)} and your right is ${c.nameOf(c.R)}. You trade with them and fight them, nobody else.` };
    const s = c.side(q);
    if (s === "left") return { title: "Your left neighbour", body: `You trade with ${c.nameOf(q)} and fight them at the end of each age. In ages I and III your hand goes to them; in age II theirs comes to you.` };
    if (s === "right") return { title: "Your right neighbour", body: `You trade with ${c.nameOf(q)} and fight them at the end of each age. In age II your hand goes to them; in ages I and III theirs comes to you.` };
    const d = (q - c.me + c.n) % c.n;
    const away = 2 * d === c.n ? "Across the table" : d < c.n - d ? `${cap(plural(d, "seat"))} to your left` : `${cap(plural(c.n - d, "seat"))} to your right`;
    return { title: c.nameOf(q), body: `${away}: not your neighbour, so you never trade or fight. ${c.nameOf(q)} has ${coins(c.state.coins[q])}, ${plural(shields(c.state, q), "shield")} and ${plural(c.state.city[q].length, "card")} built.` };
  },

  direction(a, c) {
    const age = Math.min(3, Math.max(1, intOf(a.age, c.age)));
    const dir = passDir(age);
    const to = dir > 0 ? c.L : c.R;
    const from = dir > 0 ? c.R : c.L;
    return { title: `Age ${ROMAN[age]}: hands go ${dir > 0 ? "left" : "right"}`, body: `After each turn your leftover cards go to ${c.nameOf(to)} and ${c.nameOf(from)}'s come to you. Ages I and III go left, age II right.` };
  },

  turn(a, c) {
    const st = c.state;
    if (c.over) return { title: "The end", body: "The game is over: every card is played and the score sheet is in." };
    if (!st.age) return { title: "Dealing", body: "Each age deals seven cards to every seat." };
    const r = Math.min(st.round, ROUNDS);
    const seventh = playsLast(c, c.me) ? "your wonder lets you play your seventh card too" : "your seventh card is discarded";
    const body = r < ROUNDS ? `${plural(ROUNDS - r, "more turn")} after this one, then war with your neighbours and ${st.age < 3 ? `age ${ROMAN[st.age + 1]}` : "the final count"}.` : `The last turn of the age: ${seventh}, then war with your neighbours.`;
    return { title: `Age ${ROMAN[st.age]} · turn ${r} of ${ROUNDS}`, body };
  },

  bank(a, c) {
    return { title: "The bank", body: `Coins printed on a card go here when you build it, and selling a card brings you ${DISCARD_COINS} from it. It never runs out.` };
  },

  discard(a, c) {
    const n = c.state.discard.length;
    const diggers = [...Array(c.n).keys()].filter((p) => stagesOf(c.state, p).some((x) => x.dig));
    const dig = diggers.length ? ` Only ${listOf(diggers.map((p) => (p === c.me ? "you" : c.nameOf(p))))} can dig in it, with ${diggers.length > 1 ? "their wonders" : diggers[0] === c.me ? "your wonder" : "their wonder"}.` : " Nobody can take them back.";
    return { title: "Discard pile", body: `${cap(plural(n, "card"))} face down: sold cards and the last card of each hand.${dig}` };
  },

  badge(a, c) {
    const st = c.state;
    const card = CARDS[intOf(a.id, -1)];
    if (!card) return { title: "Badge", body: "What building a card would take: Free, a chain, a price in coins, or Can't build." };
    const b = canBuild(st, c.me, card.id);
    const cost = card.cost;
    if (b.why === "duplicate") return { title: "Can't build", body: `You already built ${card.name}, and a city holds only one of each.` };
    if (a.where === "dig") return { title: "Free from the discards", body: `Your wonder lets you build one card from the discard pile without paying anything, ${card.name} included.` };
    if (b.chain) {
      const src = card.from.filter((k) => st.city[c.me].some((x) => CARDS[x.id].key === k)).map((k) => NAMES[k]);
      return { title: "Chain · free", body: `Your ${listOf(src)} chains to it, so you build it without paying anything.` };
    }
    if (b.free && (a.kind === "wonder" || !b.purchases.length)) return { title: "Free with your wonder", body: `${wonderOf(st, c.me).name} builds one card free each age, and you haven't used it this age.` };
    if (b.ok && b.purchases.length) {
      const buy = b.purchases[0];
      const paid = sideCoins(st, c.me, buy);
      const total = cost.coins + paid.left + paid.right;
      if (!total) return sum(cost.res) ? { title: "You make it", body: `You make all it needs (${costWords(cost)}), so it costs you nothing.` } : { title: "Free", body: "It costs nothing to build." };
      const parts = [];
      if (paid.left) parts.push(`${paid.left} to ${c.nameOf(c.L)} for ${countWords(buy.left)}`);
      if (paid.right) parts.push(`${paid.right} to ${c.nameOf(c.R)} for ${countWords(buy.right)}`);
      if (cost.coins) parts.push(`${cost.coins} to the bank`);
      const others = b.purchases.length > 1 ? " That's the cheapest way; you can choose another when you build." : "";
      return { title: coins(total), body: `Building it costs you ${coins(total)}: ${listOf(parts)}.${others}` };
    }
    if (b.why === "coins") {
      const need = cost.coins + (purchases(st, c.me, cost)[0]?.coins ?? 0);
      return { title: "Can't build", body: `It needs ${coins(need)} and you have ${c.state.coins[c.me]}. You could still sell it or tuck it under your wonder.` };
    }
    const own = production(st, c.me).own;
    const avail = (r) => [own, production(st, c.L).sale, production(st, c.R).sale].flat().filter((u) => u.includes(r)).length;
    const short = RES.flatMap((name, r) => (cost.res[r] > avail(r) ? [name] : []));
    return { title: "Can't build", body: `${short.length ? `Nobody next to you makes enough ${listOf(short)}` : "You and your neighbours can't make what it needs together"}. You could still sell it or tuck it under your wonder.` };
  },

  science(a, c) {
    const q = seatOf(a, c);
    const { counts, wilds } = scienceSymbols(c.state, q);
    const now = sciencePoints(counts, wilds);
    const have = `${listOf(counts.map((k, i) => plural(k, SCI[i])))}${wilds ? ` and ${plural(wilds, "wild symbol")}` : ""}`;
    const head = `${q === c.me ? "You have" : `${c.Name(q)} has`} ${have}: ${plural(now, "point")} now.`;
    const gains = counts.map((k, i) => sciencePoints(counts.with(i, k + 1), wilds) - now);
    const best = Math.max(...gains);
    const which = SCI.filter((_, i) => gains[i] === best);
    const set = which.length === 1 && Math.min(...counts.with(SCI.indexOf(which[0]), counts[SCI.indexOf(which[0])] + 1)) > Math.min(...counts);
    return { title: "Science", body: `${head} The next ${listOf(which, "or")} adds ${best}${set ? ", completing another set of three" : ""}. Each symbol scores its count squared, and each set of all three 7 more.` };
  },

  score(a, c) {
    const q = seatOf(a, c);
    const s = score(c.state, q);
    const rows = [["military", "from war"], ["coins", "from coins"], ["wonder", "from the wonder"], ["civic", "civic"], ["commerce", "commerce"], ["guilds", "from guilds"], ["science", "science"]];
    const parts = rows.flatMap(([k, w]) => (s[k] ? [`${s[k] < 0 ? `−${-s[k]}` : s[k]} ${w}`] : []));
    const who = q === c.me ? "you would have" : `${c.nameOf(q)} would have`;
    return { title: `${c.Whose(q)} score so far`, body: `If the game ended now ${who} ${plural(s.total, "point")}${parts.length ? `: ${listOf(parts)}` : ""}.` };
  },

  wall(a, c) {
    const q = a.bank === "mine" ? c.me : sideSeat(a, c);
    const sh = shields(c.state, q);
    const from = [...cardsOf(c.state, q).filter((x) => x.shields).map((x) => x.name), ...(builtStages(c.state, q).some((x) => x.shields) ? [`${q === c.me ? "your" : "their"} wonder`] : [])];
    if (!sh) return { title: "Walls", body: `${q === c.me ? "You have" : `${c.Name(q)} has`} no shields yet, so no walls stand on ${q === c.me ? "your" : "their"} bank.` };
    const cmp = q !== c.me && c.side(q) ? ` You have ${shields(c.state, c.me)}.` : "";
    return { title: `${c.Whose(q)} walls`, body: `${cap(plural(sh, "shield"))}, from ${listOf(from)}.${cmp}` };
  },

  make(a, c) {
    const q = seatOf(a, c);
    const r = intOf(a.res);
    if (r === null || !RES[r]) return null;
    const own = production(c.state, q).own;
    const single = own.filter((u) => u.length === 1 && u[0] === r).length;
    const either = own.filter((u) => u.length > 1 && u.includes(r)).length;
    const sources = [];
    if (wonderOf(c.state, q).produce === r) sources.push(q === c.me ? "your wonder" : "their wonder");
    for (const x of cardsOf(c.state, q)) {
      const k = x.produce?.filter((u) => u.length === 1 && u[0] === r).length ?? 0;
      if (k) sources.push(k > 1 ? `${x.name} (${k})` : x.name);
    }
    const name = cap(RES[r]);
    const orToo = either ? ` ${cap(plural(either, "either token"))} can make one more.` : "";
    if (q === c.me) {
      if (single) return { title: name, body: `You make ${single} a turn: ${listOf(sources)}.${orToo}` };
      const sellers = [c.L, c.R].filter((p) => production(c.state, p).sale.some((u) => u.includes(r)));
      const buy = sellers.length ? `${listOf(sellers.map((p) => `${c.nameOf(p)} sells it for ${coins(unitPrice(c.state, c.me, r, c.side(p)))}`))}.` : "Neither neighbour sells it.";
      const head = either ? `None for sure, but ${plural(either, "either token")} can make it.` : `You don't make ${RES[r]}.`;
      return { title: name, body: `${head} ${buy}` };
    }
    const s = c.side(q);
    const forSale = s ? production(c.state, q).sale.filter((u) => u.includes(r)).length : 0;
    const each = forSale ? coins(unitPrice(c.state, c.me, r, s)) : "";
    const tail = forSale > 1 ? ` You can buy up to ${forSale} a turn for ${each} each.` : forSale ? ` You can buy one a turn for ${each}.` : "";
    return { title: name, body: single ? `${c.Name(q)} makes ${single} a turn: ${listOf(sources)}.${orToo}${tail}` : `${c.Name(q)} doesn't make ${RES[r]}.${orToo}${tail}` };
  },

  hand(a, c) {
    const n = intOf(a.count, c.state.hands[c.me]?.length ?? 0);
    const dir = passDir(c.age);
    const from = (c.me - dir + c.n) % c.n;
    const to = (c.me + dir + c.n) % c.n;
    if (!c.state.age || c.state.round <= 1) return { title: "Your hand", body: `${cap(plural(n, "card"))}, dealt to you for age ${ROMAN[c.age]}. Pick one; the rest go to ${c.nameOf(to)} after this turn.` };
    if (c.state.phase === "last" && c.state.lastSeat === c.me) return { title: "Your seventh card", body: "Your wonder lets you play it instead of discarding it: build it, raise a stage with it or sell it." };
    const then = c.state.round < ROUNDS ? `the rest go to ${c.nameOf(to)}` : playsLast(c, c.me) ? "your wonder lets you play the other one too" : "the other is discarded";
    return { title: "Your hand", body: `${cap(plural(n, "card"))}: ${c.nameOf(from)}'s leftovers. Pick one; ${then}.` };
  },
};

export const TIP_KINDS = Object.freeze(Object.keys(WORDS));

// { title, body, card?, more? } for a kind, or null. args: the data-tip-* values;
// state: the public state (art.js viewOf); me: your seat; nameOf(p): a seat's name.
export function tipWords(kind, args = {}, ctx) {
  const f = Object.hasOwn(WORDS, kind) ? WORDS[kind] : null;
  if (!f || !ctx?.state) return null;
  return f(args ?? {}, contextOf(ctx));
}

// A target's data-tip-* values: data-tip-seat="2" → { seat: "2" }.
export function argsOf(target) {
  const out = {};
  for (const [k, v] of Object.entries(target?.dataset ?? {})) if (k.length > 3 && k.startsWith("tip")) out[k[3].toLowerCase() + k.slice(4)] = v;
  return out;
}

// ---------- the legend ----------
// Every icon on the table, with the same words as its tips. icon: [kind, value].
export const LEGEND = [
  {
    title: "Resources",
    items: [
      ...RAW.map((r) => ({ icon: ["res", r], name: cap(RES[r]), text: "A raw material. Brown cards and some wonders make it." })),
      ...GOODS.map((r) => ({ icon: ["res", r], name: cap(RES[r]), text: "A good. Grey cards and some wonders make it." })),
      { icon: ["either", [0, 2]], name: "Either", text: "Makes one of the resources shown, once a turn; you choose which each time you pay." },
    ],
  },
  {
    title: "Coins, points and war",
    items: [
      { icon: ["coin"], name: "Coins", text: "Pay for cards and for what you buy from neighbours. Every 3 are worth 1 point at the end." },
      { icon: ["points", 3], name: "Points", text: "What wins the game, counted at the end." },
      { icon: ["shield"], name: "Shields", text: "At the end of each age, compared with each neighbour's: more wins a token, fewer loses one." },
      { icon: ["token", 3], name: "Victory token", text: `A border won: ${listOf(VICTORY.map(String))} points in ages I, II and III.` },
      { icon: ["token", -1], name: "Defeat token", text: "A border lost: −1 point." },
    ],
  },
  {
    title: "Science",
    items: [
      ...SCI.map((s, i) => ({ icon: ["sci", i], name: cap(s), text: "A science symbol. Each kind scores its count squared." })),
      { icon: ["sci", "any"], name: "Any symbol", text: "Counts as whichever symbol scores best. A set of all three scores 7 more." },
    ],
  },
  {
    title: "Card colours",
    items: [
      { icon: ["colour", "brown"], name: "Brown", text: "Raw materials: wood, stone, clay or ore every turn." },
      { icon: ["colour", "grey"], name: "Grey", text: "Goods: glass, cloth or papyrus every turn." },
      { icon: ["colour", "blue"], name: "Blue", text: "Civic: points at the end." },
      { icon: ["colour", "yellow"], name: "Yellow", text: "Commerce: coins, cheaper trade or a choice of resources." },
      { icon: ["colour", "red"], name: "Red", text: "Military: shields for the wars." },
      { icon: ["colour", "green"], name: "Green", text: "Science: a symbol." },
      { icon: ["colour", "purple"], name: "Purple", text: "Guilds, in age III: points for what you and your neighbours built." },
    ],
  },
  {
    title: "Badges on your cards",
    items: [
      { icon: ["badge", "make"], name: "You make it", text: "You make everything it needs, so it costs nothing." },
      { icon: ["badge", "chain"], name: "Chain · free", text: "You built the card it chains from, so it's free." },
      { icon: ["badge", "pay"], name: "A price", text: "What building it costs you in coins, purchases from neighbours included." },
      { icon: ["badge", "no"], name: "Can't build", text: "Nobody sells what it needs, you lack the coins, or you built it already." },
    ],
  },
  {
    title: "Borders",
    items: [
      { icon: ["art", "ferry"], name: "Ferry", text: `No trade card yet: each unit you buy across this river costs ${TRADE_COST} coins.` },
      { icon: ["art", "bridge"], name: "Bridge", text: "A road card: raw materials from this neighbour cost 1 coin." },
      { icon: ["art", "stall"], name: "Market stall", text: "Artisans' Row: glass, cloth and papyrus from both neighbours cost 1 coin." },
      { icon: ["art", "walls"], name: "Walls", text: "Rise on each bank as its shields grow." },
      { icon: ["art", "flags"], name: "Flags", text: `One for each age on each border. ${FLAG_KEY}` },
    ],
  },
  {
    title: "The table",
    items: [
      { icon: ["seat", 1], name: "Seat marks", text: "Each seat has its own colour and mark." },
      { icon: ["art", "arrows"], name: "Direction", text: "Where hands go this age: left in ages I and III, right in age II." },
      { icon: ["art", "pips"], name: "Turns", text: `${ROUNDS} turns in each age; after the last, war.` },
      { icon: ["back"], name: "Face down", text: "A hand, a pick not yet shown, a tucked card or the discard pile: nobody else sees these." },
    ],
  },
];

// ---------- first-time hints ----------
// { seen(id), mark(id) }, each hint once ever on this device; storage that throws
// or is missing is ignored, and a hint still shows only once a visit.
export function hints(key = HINTS_KEY, storage = null) {
  const shown = new Set();
  const from = () => storage ?? globalThis.localStorage;
  const read = () => {
    try {
      const v = JSON.parse(from().getItem(key) ?? "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    seen: (id) => shown.has(id) || read().includes(id),
    mark(id) {
      shown.add(id);
      try {
        from().setItem(key, JSON.stringify([...new Set([...read(), id])]));
      } catch {}
    },
  };
}

// ---------- the layer ----------
const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]";
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const SVG = (inner) => `<svg viewBox="0 0 40 32" focusable="false" aria-hidden="true">${inner}</svg>`;
// Small border pieces for the legend; border.js draws the real ones.
const GLYPHS = {
  ferry: SVG('<path class="w2" d="M0 22q5-3 10 0t10 0 10 0 10 0V32H0z"/><path class="w" d="M0 24q5-3 10 0t10 0 10 0 10 0"/><path class="wd2" d="M8 17h24l-3 5H11z"/><path class="wd" d="M8 17h24v2H8z"/><path class="ln" d="M20 17V5"/><path class="sail" d="M21 6l8 9h-8z"/>'),
  bridge: SVG('<path class="w2" d="M0 24q5-2 10 0t10 0 10 0 10 0V32H0z"/><path class="st2" d="M0 14h40v6h-4a10 8 0 0 0-32 0H0z"/><path class="st" d="M0 12h40v3H0z"/><path class="ln2" d="M10 15v4M20 15v3M30 15v4"/>'),
  stall: SVG('<path class="wd2" d="M6 16h28v12H6z"/><path class="wd" d="M4 15h32v3H4z"/><path class="aw" d="M4 6h32l-2 7H6z"/><path class="aw2" d="M10 6l-1 7h5l1-7zM20 6v7h5l-1-7zM30 6l1 7h3l-2-7z"/><circle class="g" cx="13" cy="22" r="3"/><circle class="c" cx="20" cy="22" r="3"/><circle class="p" cx="27" cy="22" r="3"/>'),
  walls: SVG('<path class="st2" d="M2 14h4v-3h4v3h4v-3h4v3h4v-3h4v3h4v-3h4v3h2v16H2z"/><path class="st" d="M26 30V9h3V6h3v3h2V6h3v3h1v21z"/><path class="ln2" d="M2 20h24M2 25h24M14 14v6M8 20v5M20 20v5"/><path class="ink" d="M30 16h4v6h-4z"/>'),
  flags: SVG('<path class="ln" d="M6 30V4M20 30V4M34 30V4"/><path class="won" d="M6 5h11l-3 4 3 4H6z"/><path class="lost" d="M20 13h10l-2.5 2.2 2 2-2.8 2 1.8 1.8H20z"/><path class="draw" d="M34 5h5.5v3H34zM34 10h5.5v3H34z"/>'),
  arrows: SVG('<path class="arr" d="M30 9a12 10 0 1 0 3 12"/><path class="arrh" d="M28 3l6 6-8 2z"/>'),
  pips: SVG('<circle class="pip on" cx="5" cy="16" r="3.2"/><circle class="pip on" cx="11" cy="16" r="3.2"/><circle class="pip on" cx="17" cy="16" r="3.2"/><circle class="pip" cx="23" cy="16" r="3.2"/><circle class="pip" cx="29" cy="16" r="3.2"/><circle class="pip" cx="35" cy="16" r="3.2"/>'),
};
const BADGES = { make: ["ok", "Free"], free: ["ok", "Free"], chain: ["gold", "Chain · free"], wonder: ["gold", "Wonder · free"], pay: ["gold", "3"], no: ["bad", "Can't"] };

function legendIcon([kind, v], kit, extra) {
  const own = extra[kind]?.(v);
  if (own) return own;
  const art = (markup, cls = "") => {
    const node = el("span", { class: `sc-glyph ${cls}`, "aria-hidden": "true" });
    node.innerHTML = markup;
    return node;
  };
  if (kind === "art") return art(GLYPHS[v] ?? "", `g-${v}`);
  if (kind === "colour") return art(colourIcon(v), `c-${v}`);
  if (kind === "badge") {
    const [tone, text] = BADGES[v] ?? BADGES.pay;
    return el("span", { class: `sc-tip-badge ${tone}`, "aria-hidden": "true" }, v === "pay" && kit?.coinEl ? kit.coinEl() : "", text);
  }
  if (!kit) return el("span");
  if (kind === "res") return kit.resEl(v);
  if (kind === "sci") return kit.sciEl(v);
  if (kind === "coin") return kit.coinEl();
  if (kind === "points") return kit.pointsEl(v);
  if (kind === "shield") return kit.shieldEl();
  if (kind === "token") return kit.tokenEl(v);
  if (kind === "seat") return kit.seatMark(v);
  if (kind === "back") return kit.cardEl(null, { age: 1, size: "mini" });
  if (kind === "either") return el("span", { class: "sc-tip-either", "aria-hidden": "true" }, kit.resEl(v[0]), el("i", {}, "/"), kit.resEl(v[1]));
  return el("span");
}

let made = 0;
// root: where data-tip targets live. words(kind, target) → { title, body, card?, more? } or null.
// kit: art.js's icon makers (cardEl for card zoom, the rest for the legend).
// onExplain(on): Explain mode changed from inside (Esc or the bar's Done).
// legendIcons: { kind: (value) → Node } to draw a legend icon your own way.
// bar: Explain mode's bar (Tap to explain · All icons · Done): true floats it at
// the top of the screen, an element holds it in place there, false leaves it out.
// focusBack: where focus goes (an element, or a function giving one) when
// Explain mode ends while focus is in its bar or on a target it made focusable.
export function tipLayer(root, { words, kit = null, hints: memory = hints(), onExplain = () => {}, legendIcons = {}, holdMs = 450, bar = true, focusBack = null } = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const id = `sc-tip-${++made}`;
  const bubble = el("div", { class: "sc-tip", id, role: "tooltip", hidden: true });
  const live = el("div", { class: "sr-only", "aria-live": "polite" });
  root.append(live);
  root.classList.add("sc-tips");
  let target = null;
  let how = null;
  let explaining = false;
  let hover = 0;
  let hold = 0;
  let held = null;
  let holding = null;
  let filled = "";
  let swallow = false;
  let swallowTimer = 0;
  let legendDialog = null;
  let barNode = null;
  let frame = 0;
  const coachQueue = [];
  let coaching = null;

  const tipOf = (node) => {
    const t = node?.closest?.("[data-tip]");
    return t && root.contains(t) ? t : null;
  };
  const focusVisible = (node) => {
    try {
      return node.matches(":focus-visible");
    } catch {
      return true;
    }
  };
  const wordsFor = (t) => {
    try {
      return words(t.dataset.tip, t) ?? null;
    } catch {
      return null;
    }
  };
  // Where a floating piece lives: inside an open modal dialog (the top layer) when the target is.
  const hostOf = (t) => t.closest("dialog[open]") ?? doc.body;

  function place(node, t, gap = 10) {
    const r = t.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth || win.innerWidth;
    const vh = win.innerHeight;
    const m = 8;
    node.style.left = "0px";
    node.style.top = "0px";
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    // Inside a zone (data-tip-zone: your hand and what explains it), the
    // bubble keeps out of the whole zone when the screen has room.
    const z = t.closest("[data-tip-zone]")?.getBoundingClientRect();
    // A hint inside something marked data-coach-above (the war scene) waits above it, covering none of it.
    const over = node !== bubble ? t.closest("[data-coach-above]")?.getBoundingClientRect() : null;
    let down;
    let top;
    if (over && over.top - gap - h >= m) [down, top] = [false, over.top - gap - h];
    else if (z && z.top - gap - h >= m) [down, top] = [false, z.top - gap - h];
    else if (z && vh - z.bottom >= h + gap + m) [down, top] = [true, z.bottom + gap];
    else {
      const below = vh - r.bottom;
      down = below >= h + gap + m || below >= r.top;
      top = clamp(down ? r.bottom + gap : r.top - gap - h, m, Math.max(m, vh - h - m));
    }
    const left = clamp(r.left + r.width / 2 - w / 2, m, Math.max(m, vw - w - m));
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
    node.dataset.side = down ? "below" : "above";
    node.style.setProperty("--ax", `${Math.round(clamp(r.left + r.width / 2 - left, 16, w - 16))}px`);
  }
  const offscreen = (t) => {
    const r = t.getBoundingClientRect();
    return r.bottom < 0 || r.top > win.innerHeight || r.right < 0 || r.left > (doc.documentElement.clientWidth || win.innerWidth) || (!r.width && !r.height);
  };

  function fill(w) {
    const text = [el("b", { class: "sc-tip-title" }, w.title), el("span", { class: "sc-tip-body" }, w.body)];
    for (const line of w.more ?? []) text.push(el("span", { class: "sc-tip-more" }, line));
    const zoom = w.card != null && typeof kit?.cardEl === "function";
    bubble.classList.toggle("zoom", zoom);
    if (!zoom) return bubble.replaceChildren(...text);
    bubble.replaceChildren(el("span", { class: "sc-tip-card" }, kit.cardEl(w.card, { size: "full" })), el("span", { class: "sc-tip-words" }, ...text));
  }
  // The describing ids on the focusable part of a target.
  function describe(t, on) {
    for (const node of new Set([t, doc.activeElement && t.contains(doc.activeElement) ? doc.activeElement : null])) {
      if (!node) continue;
      const ids = (node.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((x) => x && x !== id);
      if (on) ids.push(id);
      if (ids.length) node.setAttribute("aria-describedby", ids.join(" "));
      else node.removeAttribute("aria-describedby");
    }
  }

  // A target gone from the page (a hand passed on while a timer ran) opens nothing.
  function show(t, via, quiet = false) {
    clearTimeout(hover);
    if (!t.isConnected) return hide();
    const w = wordsFor(t);
    if (!w) return hide();
    if (target && target !== t) unmark(target);
    target = t;
    how = via;
    // The same words stay as they are: a card's zoom doesn't start again.
    const key = JSON.stringify([w.title, w.body, w.more ?? [], w.card ?? null]);
    if (key !== filled || bubble.hidden) fill(w);
    filled = key;
    const host = hostOf(t);
    if (bubble.parentNode !== host) host.append(bubble);
    bubble.hidden = false;
    t.classList.add("sc-tip-on");
    describe(t, true);
    place(bubble, t);
    if (!quiet && (via === "tap" || via === "hold" || via === "key")) live.textContent = [w.title, w.body, ...(w.more ?? [])].join(". ").replace(/\.\./g, ".");
  }
  function unmark(t) {
    t.classList.remove("sc-tip-on");
    describe(t, false);
  }
  function hide() {
    clearTimeout(hover);
    if (!target) return;
    unmark(target);
    target = null;
    how = null;
    bubble.hidden = true;
    // Words about a card in a hand passed on must not stay in the page.
    bubble.replaceChildren();
    filled = "";
    live.textContent = "";
  }
  // The same thing redrawn (a new turn): follow it, and refresh its words.
  const signature = (t) => Object.entries(t.dataset).filter(([k]) => k.startsWith("tip")).map(([k, v]) => `${k}=${v}`).sort().join("&");
  function refresh() {
    frame = 0;
    if (coaching && !coaching.t.isConnected) coaching.close();
    if (!target) return;
    if (!target.isConnected) {
      const sig = signature(target);
      const twin = [...root.querySelectorAll(`[data-tip="${CSS.escape(target.dataset.tip)}"]`)].find((x) => signature(x) === sig);
      if (!twin) return hide();
      target = twin;
    }
    show(target, how, true);
  }
  // A stop only where a screen reader can name it: not inside something
  // hidden from it, a picture or another control.
  const silent = (t) => t.getAttribute("aria-hidden") === "true" || !!t.parentElement?.closest('[aria-hidden="true"], [role="img"], button, a[href]');
  function tag(on) {
    for (const t of root.querySelectorAll("[data-tip]")) {
      if (on && !t.matches(FOCUSABLE) && !silent(t)) {
        t.setAttribute("tabindex", "0");
        t.setAttribute("data-tip-tab", "");
      } else if (!on && t.hasAttribute("data-tip-tab")) {
        t.removeAttribute("tabindex");
        t.removeAttribute("data-tip-tab");
      }
    }
  }
  // Our own pieces changing is no reason to look again.
  const ours = (n) => !!n && (bubble.contains(n) || live.contains(n) || !!(n.nodeType === 1 ? n : n.parentElement)?.closest?.(".sc-coach"));
  const relevant = (r) => !ours(r.target) && !(r.type === "childList" && [...r.addedNodes, ...r.removedNodes].every(ours));
  const watch = new MutationObserver((records) => {
    if (!records.some(relevant)) return;
    if (explaining) tag(true);
    // A hover or a hold waiting on a target that has left opens nothing.
    if (pending && !pending.isConnected) {
      clearTimeout(hover);
      pending = null;
    }
    if (holding && !holding.isConnected) {
      clearTimeout(hold);
      held = holding = null;
    }
    // A target gone from the page (a hand passed on) takes its words with it at once.
    if (target && !target.isConnected) {
      if (frame) win.cancelAnimationFrame(frame);
      refresh();
    } else if ((target || coaching) && !frame) frame = win.requestAnimationFrame(refresh);
  });
  watch.observe(root, { childList: true, subtree: true, characterData: true });

  // ---------- events ----------
  const on = (node, type, f, opts) => (node.addEventListener(type, f, opts), () => node.removeEventListener(type, f, opts));
  // A target marked data-tip-on="hold" (a card in your hand, whose shelf
  // and detail strip already explain it) opens only on press and hold (a
  // mouse too), a tap in Explain mode or "i" while it has focus.
  const holdOnly = (t) => t?.dataset.tipOn === "hold";
  // Hover follows the mouse moving: the table moving under a still pointer opens nothing.
  let pointer = "";
  let pending = null;
  const moved = (e) => {
    const xy = `${Math.round(e.clientX)},${Math.round(e.clientY)}`;
    const was = pointer;
    pointer = xy;
    return xy !== was;
  };
  const off = [
    on(doc, "pointerdown", (e) => void moved(e), true),
    on(root, "pointermove", (e) => {
      if (e.pointerType !== "mouse" || !moved(e)) return;
      const t = tipOf(e.target);
      if (t === target || (t && t === pending)) return;
      clearTimeout(hover);
      pending = null;
      if (!t || holdOnly(t)) return void (how === "hover" && hide());
      pending = t;
      hover = setTimeout(() => {
        pending = null;
        if (t.isConnected) show(t, "hover");
      }, target ? 60 : 220);
    }),
    on(root, "pointerout", (e) => {
      if (e.pointerType !== "mouse") return;
      const t = tipOf(e.target);
      if (!t || (e.relatedTarget && t.contains(e.relatedTarget))) return;
      clearTimeout(hover);
      pending = null;
      if (how === "hover" && target === t) hide();
    }),
    on(root, "focusin", (e) => {
      const t = tipOf(e.target);
      if (t && !holdOnly(t) && focusVisible(e.target)) show(t, "focus");
      else if (target && (how === "focus" || how === "key") && t !== target) hide();
    }),
    on(root, "focusout", (e) => {
      if ((how === "focus" || how === "key") && target && !target.contains(e.relatedTarget)) hide();
    }),
    on(root, "keydown", (e) => {
      if ((e.key !== "i" && e.key !== "I") || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea")) return;
      const t = tipOf(e.target);
      if (!t) return;
      e.preventDefault();
      if (target === t && how === "key") hide();
      else show(t, "key");
    }),
    on(root, "pointerdown", (e) => {
      const t = tipOf(e.target);
      if (!t || (e.pointerType === "mouse" && (!holdOnly(t) || e.button !== 0))) return;
      clearTimeout(hold);
      held = { x: e.clientX, y: e.clientY };
      holding = t;
      hold = setTimeout(() => {
        held = holding = null;
        if (!t.isConnected) return;
        swallow = true;
        clearTimeout(swallowTimer);
        swallowTimer = setTimeout(() => (swallow = false), 900);
        show(t, "hold");
      }, holdMs);
    }),
    on(root, "pointermove", (e) => {
      if (held && Math.hypot(e.clientX - held.x, e.clientY - held.y) > 10) {
        clearTimeout(hold);
        held = holding = null;
      }
    }),
    on(root, "pointerup", () => (clearTimeout(hold), (held = holding = null))),
    on(root, "pointercancel", () => (clearTimeout(hold), (held = holding = null))),
    on(root, "contextmenu", (e) => {
      if (tipOf(e.target) && (held || swallow || explaining)) e.preventDefault();
    }),
    on(
      root,
      "click",
      (e) => {
        const t = tipOf(e.target);
        if (swallow) {
          swallow = false;
          if (t) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
          return;
        }
        if (!explaining || !t || t.hasAttribute("data-tip-keep")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (target === t && how === "tap") hide();
        else show(t, "tap");
      },
      true,
    ),
    // Enter or Space on a target that isn't a control explains it (a control's click is caught above).
    on(root, "keydown", (e) => {
      if (!explaining || (e.key !== "Enter" && e.key !== " ")) return;
      const t = tipOf(e.target);
      if (!t || e.target !== t || t.matches("button, a[href], input, select, textarea, summary")) return;
      e.preventDefault();
      if (target === t && how === "tap") hide();
      else show(t, "tap");
    }),
    on(
      doc,
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;
        if (coaching) {
          coaching.close();
          return;
        }
        if (target) {
          hide();
          e.preventDefault();
          e.stopPropagation();
        } else if (explaining && !doc.querySelector("dialog[open]")) {
          setExplain(false, true);
          e.preventDefault();
        }
      },
      true,
    ),
    on(
      doc,
      "pointerdown",
      (e) => {
        if (coaching && !coaching.node.contains(e.target)) coaching.close();
        if (target && !target.contains(e.target)) hide();
      },
      true,
    ),
    on(
      doc,
      "scroll",
      () => {
        if (target) (!target.isConnected || offscreen(target) ? hide() : place(bubble, target));
        if (coaching) place(coaching.node, coaching.t);
      },
      { capture: true, passive: true },
    ),
    on(win, "resize", () => {
      if (target) place(bubble, target);
      if (coaching) place(coaching.node, coaching.t);
    }),
  ];

  // ---------- Explain mode ----------
  function explainBar() {
    const done = el("button", { class: "btn small", type: "button", onclick: () => setExplain(false, true) }, "Done");
    const all = el("button", { class: "btn small ghost", type: "button", onclick: () => legend() }, "All icons");
    return el("div", { class: "sc-explain-bar", role: "region", "aria-label": "Explain mode" }, el("span", { class: "sc-explain-q", "aria-hidden": "true" }, "?"), el("span", { class: "sc-explain-text" }, el("span", { class: "long" }, "Tap anything to see what it means"), el("span", { class: "short" }, "Tap to explain")), all, done);
  }
  function setExplain(value, inside = false) {
    const next = !!value;
    if (next === explaining) return explaining;
    explaining = next;
    root.classList.toggle("sc-explaining", explaining);
    // Focus in the bar, or on a stop that is about to stop being one, goes back to the toggle.
    const f = doc.activeElement;
    if (!explaining && f && (barNode?.contains(f) || f.hasAttribute?.("data-tip-tab"))) (typeof focusBack === "function" ? focusBack() : focusBack)?.focus({ preventScroll: true });
    tag(explaining);
    if (!explaining && how === "tap") hide();
    if (bar) {
      barNode ??= explainBar();
      barNode.classList.toggle("inline", bar !== true);
      if (explaining) (bar === true ? doc.body : bar).append(barNode);
      else barNode.remove();
    }
    live.textContent = explaining ? "Explain mode on: tap or press Enter on anything to hear what it means. Escape to stop." : "Explain mode off.";
    if (inside) onExplain(explaining);
    return explaining;
  }

  // ---------- the legend ----------
  function buildLegend() {
    const close = el("button", { class: "btn small", type: "button", onclick: () => dialog.close() }, "Close");
    const sections = LEGEND.map((g, i) =>
      el(
        "section",
        { class: "sc-legend-group", "aria-labelledby": `${id}-g${i}` },
        el("h3", { id: `${id}-g${i}` }, g.title),
        el(
          "ul",
          {},
          g.items.map((it) => el("li", {}, el("span", { class: "sc-legend-ic" }, legendIcon(it.icon, kit, legendIcons)), el("span", { class: "sc-legend-words" }, el("b", {}, it.name), el("span", {}, it.text)))),
        ),
      ),
    );
    const dialog = el(
      "dialog",
      { class: "sc-legend", "aria-labelledby": `${id}-legend` },
      el("header", { class: "sc-legend-head" }, el("h2", { id: `${id}-legend` }, "What everything means"), close),
      el("p", { class: "sc-legend-lede" }, "Hover, focus or press and hold anything on the table for its own explanation with your game's numbers, or turn on Explain mode and tap."),
      el("div", { class: "sc-legend-body" }, sections),
    );
    let back = null;
    dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());
    dialog.addEventListener("close", () => {
      back?.focus?.();
      back = null;
    });
    dialog.opened = (from) => {
      back = from;
      close.focus();
    };
    return dialog;
  }
  function legend() {
    hide();
    legendDialog ??= buildLegend();
    if (!legendDialog.isConnected) root.append(legendDialog);
    const from = doc.activeElement;
    if (!legendDialog.open) legendDialog.showModal();
    legendDialog.opened(from);
    return legendDialog;
  }

  // ---------- first-time hints ----------
  function nextCoach() {
    const job = coachQueue.shift();
    if (!job) return;
    if (!job.t.isConnected) {
      job.resolve(false);
      return nextCoach();
    }
    const node = el("div", { class: "sc-coach", role: "status" }, el("span", { class: "sc-coach-dot", "aria-hidden": "true" }), el("span", {}, job.text));
    hostOf(job.t).append(node);
    job.t.classList.add("sc-coached");
    place(node, job.t, 12);
    const timer = setTimeout(() => close(), clamp(2600 + job.text.length * 55, 4500, 9000));
    function close() {
      if (coaching?.node !== node) return;
      clearTimeout(timer);
      job.t.classList.remove("sc-coached");
      node.remove();
      coaching = null;
      job.resolve(true);
      nextCoach();
    }
    coaching = { node, t: job.t, close };
  }
  // Shows text pointing at target the first time id comes up, ever; resolves
  // true when it closes (a tap, Esc or a few seconds), false when it was seen before.
  function coach(hint, t, text = HINT_WORDS[hint]) {
    if (!t || !text || memory.seen(hint)) return Promise.resolve(false);
    memory.mark(hint);
    return new Promise((resolve) => {
      coachQueue.push({ t, text, resolve });
      if (!coaching) nextCoach();
    });
  }

  function destroy() {
    hide();
    setExplain(false);
    clearTimeout(hold);
    clearTimeout(swallowTimer);
    if (frame) win.cancelAnimationFrame(frame);
    watch.disconnect();
    for (const f of off) f();
    // The queue empties first, so closing the open hint shows no next one.
    for (const job of coachQueue.splice(0)) job.resolve(false);
    coaching?.close();
    bubble.remove();
    live.remove();
    barNode?.remove();
    if (legendDialog?.open) legendDialog.close();
    legendDialog?.remove();
    root.classList.remove("sc-tips", "sc-explaining");
  }

  return { destroy, explain: (v = !explaining) => setExplain(v), explaining: () => explaining, legend, coach, seen: (hint) => memory.seen(hint), hide, refresh: () => target && show(target, how, true) };
}
