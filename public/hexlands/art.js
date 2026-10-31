// What the Hexlands view (main.js) shares with its tutorial: the pace of its
// motion, the words a screen reader hears for the board's hexes, corners and
// paths, and the table: the island in one SVG (in the layers of tiles.js and
// pieces.js), its legal spots, the dice, the bank and your hand, and how they
// move: the dice tumble, producing hexes glow, cards fly between the board,
// the bank and the players, the robber hops, buildings pop in and roads draw
// in. The art itself comes from tiles.js, pieces.js and card-art.js.
import { el } from "../engine/shell.js";
import { tokenMs, easing } from "../engine/cards/table.js";
import { HEXES, CORNERS, EDGES, RESOURCE_NAMES, TERRAIN_NAMES, DESERT, ANY, pips } from "./board.js";
import { VIEWBOX, defsSvg, seaSvg, terrainSvg, harbourSvg } from "./tiles.js";
import { tokenSvg, roadSvg, settlementSvg, citySvg, robberSvg, spotSvg, diceSvg } from "./pieces.js";
import { resourceGlyph, resourceCard, devCard, cardBack } from "./card-art.js";
import { resourceOf } from "./rules.js";

export const PACE = { dice: 640, glow: 900, fly: 560, flyGap: 70, build: 420, road: 380, hop: 620, steal: 720, trade: 640, badge: 900, reveal: 1300, between: 160, bubble: 900, moment: 900, rise: 34 };
export const RES_NAMES = RESOURCE_NAMES;
export const DEV_NAMES = { knight: "Knight", vp: "Victory point", road: "Road building", plenty: "Year of plenty", monopoly: "Monopoly" };
export const DEV_WORDS = { knight: "move the robber and steal a card", vp: "1 point, kept hidden until it wins", road: "build two roads free", plenty: "take any two cards from the bank", monopoly: "every other player gives you all of one resource" };

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const listOf = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
// "2 wood, 1 ore" from 5 counts.
export const countWords = (c) => listOf(c.flatMap((n, r) => (n ? [`${n} ${RES_NAMES[r]}`] : []))) || "nothing";

const SVGNS = "http://www.w3.org/2000/svg";
const VB = VIEWBOX.split(/[\s,]+/).map(Number);
const U = 100; // board units for one hex radius
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const hexPath = (h, r = 0.94) =>
  "M" +
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${f1((h.x + Math.cos(a) * r) * U)} ${f1((h.y + Math.sin(a) * r) * U)}`;
  }).join("L") +
  "Z";

// ---------- words for a screen reader ----------
export function hexWords(board, hex) {
  const t = board.terrain[hex];
  return t === DESERT ? "desert" : `${TERRAIN_NAMES[t]} ${board.numbers[hex]}`;
}
const harbourAt = (board, corner) => board.harbours.find((h) => EDGES[h.edge].a === corner || EDGES[h.edge].b === corner);
const harbourWords = (h) => (h.kind === ANY ? "a 3:1 harbour" : `a 2:1 ${RES_NAMES[h.kind]} harbour`);
// "corner next to forest 8 and fields 5, 9 dots, by a 3:1 harbour"
export function cornerWords(board, corner) {
  const hexes = CORNERS[corner].hexes;
  const dots = hexes.reduce((n, h) => n + pips(board.numbers[h]), 0);
  const h = harbourAt(board, corner);
  return `corner next to ${listOf(hexes.map((x) => hexWords(board, x)))}${dots ? `, ${plural(dots, "dot")}` : ""}${h ? `, by ${harbourWords(h)}` : ""}${hexes.length < 3 ? ", on the coast" : ""}`;
}
export function edgeWords(board, edge) {
  const hexes = EDGES[edge].hexes;
  return hexes.length === 1 ? `coast path by ${hexWords(board, hexes[0])}` : `path between ${listOf(hexes.map((x) => hexWords(board, x)))}`;
}

// ---------- small pieces of art as elements ----------
export function glyphEl(r, cls = "") {
  const node = el("span", { class: `hx-glyph r-${r} ${cls}`, "aria-hidden": "true" });
  node.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${resourceGlyph(r)}</svg>`;
  return node;
}
// A resource as a small coloured tile with its glyph: a card too small for its picture.
export function chipEl(r) {
  return el("span", { class: `hx-chip r-${r}`, "aria-hidden": "true" }, glyphEl(r));
}
const cardCache = new Map();
// A card face (an <svg> from card-art.js) in a span, sized by CSS. key: a
// resource 0-4, a development kind, or "back"; face: "full" (its scene and
// words), "mini" (its colour and a big glyph, for cards too small for their
// scene) or "both", for a card that switches with its size (setMini).
export function cardEl(key, cls = "", { face = "both" } = {}) {
  const id = `${key}:${face}`;
  if (!cardCache.has(id)) cardCache.set(id, typeof key === "number" ? resourceCard(key, { face }) : key === "back" ? cardBack({ face }) : devCard(key, { face }));
  const node = el("span", { class: `hx-cardbox ${typeof key === "number" ? `r-${key}` : `d-${key}`} ${cls}`, "aria-hidden": "true" });
  node.innerHTML = cardCache.get(id);
  return node;
}
const setMini = (node, on) => node.querySelector("svg")?.classList.toggle("hx-mini", on);
// Glyphs in a row, one per card: "[wood][brick]" for a cost or an offer.
export function cardsRow(c, { have = null, cls = "" } = {}) {
  const row = el("span", { class: `hx-cost ${cls}` });
  c.forEach((n, r) => {
    for (let i = 0; i < n; i++) row.append(glyphEl(r, have && i >= have[r] ? "missing" : ""));
  });
  return row;
}

// A seat's points showing on the table, in its pill: a cream token ringed in
// its colour, like the island's numbers. set(n, bump) bumps it when it grows.
export function pointsToken() {
  const num = el("b", {}, "0");
  const words = el("span", { class: "sr-only" }, " points");
  const node = el("span", { class: "hx-vp", title: "0 points" }, num, words);
  function set(n, bump = false) {
    const was = Number(num.textContent);
    if (was === n) return;
    num.textContent = String(n);
    words.textContent = n === 1 ? " point" : " points";
    node.title = plural(n, "point");
    if (bump && n > was) node.animate([{ transform: "scale(1)" }, { transform: "scale(1.45)", offset: 0.4 }, { transform: "scale(1)" }], { duration: 520, easing: "cubic-bezier(.34,1.56,.64,1)" });
  }
  return { node, set };
}

// A discard of the 5 counts picked from hand: { slots, rest }. Cards everyone
// has seen go first, since a move shows at most `max` hidden ones (a steal
// hides the victim's hand); more hidden than that go in parts: the seen ones
// and `max` hidden now, and rest, the counts still to pay next. open(slot):
// whether everyone has seen it.
export function discardParts(hand, picked, face, open, max) {
  const sorted = hand.slice().sort((a, b) => open(b) - open(a));
  const slots = picked.flatMap((n, r) => sorted.filter((s) => resourceOf(face(s)) === r).slice(0, n));
  const hidden = slots.filter((s) => !open(s));
  if (hidden.length <= max) return { slots, rest: null };
  const part = slots.filter((s) => open(s) || hidden.indexOf(s) < max);
  const sent = [0, 1, 2, 3, 4].map((r) => part.filter((s) => resourceOf(face(s)) === r).length);
  return { slots: part, rest: picked.map((n, r) => n - sent[r]) };
}

// The table as the screen draws it: the state as it stood before the events
// still playing out. Its fields are the state's, so rules.points() reads it.
export const viewOf = (st) => ({
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

// A seat's note in its pill (node, a .hx-note): its cards, development cards,
// knights and awards, and the robber's mask when it was robbed this turn.
export function drawNote(node, view, p, { robbed = false } = {}) {
  const n = view.hands[p].length;
  const devs = view.devs[p].length;
  const parts = [
    ["cards", n, plural(n, "card")],
    ["devs", devs, plural(devs, "development card")],
  ];
  if (view.knights[p]) parts.push(["knights", view.knights[p], plural(view.knights[p], "knight")]);
  const label = [...parts.map((x) => x[2]), view.longest.p === p ? "longest road" : "", view.army.p === p ? "largest army" : "", robbed ? "robbed this turn" : ""].filter(Boolean).join(", ");
  if (node.dataset.key === label) return;
  node.dataset.key = label;
  node.setAttribute("aria-label", label);
  node.replaceChildren(
    ...parts.map(([kind, v]) => el("span", { class: `hx-n ${kind}`, "aria-hidden": "true" }, el("i", {}), String(v))),
    view.longest.p === p ? el("span", { class: "hx-award road", title: `Longest road (${view.longest.size})`, "aria-hidden": "true" }) : "",
    view.army.p === p ? el("span", { class: "hx-award army", title: `Largest army (${view.army.size})`, "aria-hidden": "true" }) : "",
    robbed ? el("span", { class: "hx-robbed", title: "Robbed this turn", "aria-hidden": "true" }) : "",
  );
}

// Which cards a roll pays and from where: [{ hex, p, r, n }] for every
// building on a producing hex. got: by seat, the 5 counts it was paid, which
// caps the flights when the bank ran short (nobody, or only the one taker, gets them).
export function production(board, robber, buildings, roll, got = null) {
  const left = got?.map((c) => c.slice());
  const out = [];
  for (const h of HEXES) {
    if (board.numbers[h.id] !== roll || h.id === robber) continue;
    const r = board.terrain[h.id];
    for (const c of h.corners) {
      const b = buildings[c];
      if (!b) continue;
      const n = Math.min(b.city ? 2 : 1, left ? left[b.p][r] : Infinity);
      if (left) left[b.p][r] -= n;
      if (n > 0) out.push({ hex: h.id, p: b.p, r, n });
    }
  }
  return out;
}

// How the view and the tutorial move cards and pieces as events play out.
// art: hexTable()'s; view(): the table as drawn; face(slot): its face, or null
// while hidden; me: your seat; seatRect(p): where a seat's cards go; draw():
// redraw; sound(name, options); gained(p, slots): cards a seat just got.
export function tableMotion(art, { live, wait }, { view, face, me, seatRect, draw, sound, gained }) {
  const lastSettlement = new Map(); // seat -> corner, for the second settlement's cards
  // Cards with faces fly face up; the rest as backs.
  const keysOf = (slots) => slots.map((s) => {
    const r = resourceOf(face(s));
    return r < 0 ? "back" : r;
  });
  const resRect = (p, r) => (p === me && r >= 0 ? art.pileRect(r) : seatRect(p));
  const bankRect = (key) => art.bankChipRect(key === "back" ? 0 : key);
  const bankBy = (slots, d) => slots.forEach((s) => {
    const r = resourceOf(face(s));
    if (r >= 0) view().bank[r] = Math.max(0, view().bank[r] + d);
  });
  const remove = (p, slots) => (view().hands[p] = view().hands[p].filter((s) => !slots.includes(s)));

  // Cards paid from p's hand: they leave it at once and fly to the bank.
  async function spend(p, slots, g, k = 1) {
    if (!slots?.length) return;
    const keys = keysOf(slots);
    remove(p, slots);
    draw();
    await art.flyMany(keys, (i) => resRect(p, keys[i]), (i) => bankRect(keys[i]), { g, k, ms: PACE.fly * 0.8, gap: 50 });
    bankBy(slots, 1);
  }
  // Cards from the bank (or from(i), a rect) to p: they join the hand as they land.
  async function collect(p, slots, from, g, k = 1) {
    const keys = keysOf(slots);
    await art.flyMany(keys, from ?? ((i) => bankRect(keys[i])), (i) => resRect(p, keys[i]), { g, k });
    if (!live(g)) return;
    bankBy(slots, -1);
    view().hands[p].push(...slots);
    gained(p, slots);
    draw();
  }
  // The second settlement's cards come from the lands it touches.
  function collectSecond(p, slots, board, g, k = 1) {
    const corner = lastSettlement.get(p);
    const from = (i) => {
      const r = resourceOf(face(slots[i]));
      const hex = CORNERS[corner]?.hexes.find((h) => board.terrain[h] === r);
      return hex === undefined ? art.centreRect() : art.hexRect(hex);
    };
    slots.forEach((s) => sound("gain", { r: resourceOf(face(s)) }));
    return collect(p, slots, from, g, k);
  }

  // Which end of a new road joins its owner's pieces: it draws in from there.
  function joinedEnd(edge, p) {
    const v = view();
    const e = EDGES[edge];
    const own = (c) => v.buildings[c]?.p === p || CORNERS[c].edges.some((o) => o !== edge && v.roads[o] === p);
    return own(e.a) ? e.a : e.b;
  }
  async function build(ev, g, k = 1) {
    const from = ev.kind === "road" ? joinedEnd(ev.at, ev.p) : -1;
    if (!ev.free) await spend(ev.p, ev.pay, g, k);
    if (!live(g)) return;
    if (ev.kind === "road") view().roads[ev.at] = ev.p;
    else view().buildings[ev.at] = { p: ev.p, city: ev.kind === "city" };
    if (ev.kind === "settlement") lastSettlement.set(ev.p, ev.at);
    draw();
    sound(`build-${ev.kind}`);
    if (ev.kind === "road") art.growRoad(ev.at, from, { g, k });
    else art.popBuilding(ev.at, { g, k });
    await wait((ev.kind === "road" ? PACE.road : PACE.build) * k, g);
  }

  // A roll pays out: the numbers' hexes light up (the robber's stays dark),
  // then each building's cards fly from its hex to its owner.
  async function produce(ev, board, g, k = 1) {
    const v = view();
    const hexes = HEXES.filter((h) => board.numbers[h.id] === ev.roll).map((h) => h.id);
    art.glowHexes(hexes.filter((h) => h !== v.robber), { g, k });
    art.glowHexes(hexes.filter((h) => h === v.robber), { g, k, cls: "blocked" });
    await wait(PACE.glow * 0.45 * k, g);
    let i = 0;
    const got = ev.gains.map((slots) => [0, 1, 2, 3, 4].map((r) => slots.filter((s) => resourceOf(face(s)) === r).length));
    const jobs = production(board, v.robber, v.buildings, ev.roll, got).flatMap((f) =>
      Array.from({ length: f.n }, () => wait(i++ * PACE.flyGap * k, g).then(() => (sound("gain", { r: f.r }), art.flyCard(f.r, art.hexRect(f.hex), resRect(f.p, f.r), { g, ms: PACE.fly * k })))),
    );
    await Promise.all(jobs);
    if (!live(g)) return;
    ev.gains.forEach((slots, p) => {
      bankBy(slots, -1);
      view().hands[p].push(...slots);
      gained(p, slots);
    });
    draw();
  }

  return { keysOf, resRect, remove, gained, spend, collect, collectSecond, build, produce, reset: () => lastSettlement.clear() };
}

// The order the island rises in: from the middle hex outwards, clockwise.
const RISE = HEXES.slice().sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x)).map((h) => h.id);

// ---------- the table ----------
// table: engine/cards/table.js (the queue, the fly layer, bubbles).
// onSpot(kind, id) picks a highlighted spot; onSpotFocus(kind, id) says which
// one is pointed at or focused (null when none).
export function hexTable(table, { onSpot = () => {}, onSpotFocus = () => {} }) {
  const { live, fast, wait, flyLayer, rectIn } = table;

  // The island: one SVG in layers.
  const boardWrap = el("div", { class: "hx-board-wrap", id: "hx-board-wrap" });
  const LAYERS = ["sea", "terrain", "glows", "harbours", "tokens", "roads", "buildings", "robber", "ghost", "spots"];
  boardWrap.innerHTML = `<svg class="hx-board" id="hx-board" viewBox="${VIEWBOX}" role="group" aria-label="The island" focusable="false">${defsSvg()}${LAYERS.map((l) => `<g class="hx-layer-${l}"${l === "ghost" ? ' aria-hidden="true"' : l === "spots" ? ' role="group"' : ""}></g>`).join("")}</svg>`;
  const svg = boardWrap.firstChild;
  const [seaL, terrainL, glowL, harbourL, tokenL, roadL, buildingL, robberL, ghostL, spotL] = LAYERS.map((l) => svg.querySelector(`.hx-layer-${l}`));

  // The dice sit in the sea at the bottom right; the deck, while it's shuffled, in the middle.
  const diceBox = el("div", { class: "hx-dice-box", id: "hx-dice", hidden: true, "aria-hidden": "true" });
  const diceArt = el("span", { class: "hx-dice-art" });
  const diceSum = el("span", { class: "hx-dice-sum mono" });
  diceBox.append(diceArt, diceSum);
  const deckStack = el("div", { class: "hx-deck-stack" }, [0, 1, 2, 3, 4].map(() => cardEl("back")));
  const deck = el("div", { class: "hx-deck", id: "hx-deck", hidden: true, "aria-hidden": "true" }, deckStack);
  boardWrap.append(diceBox, deck, table.busyChip);

  let board = null;
  // Markup from tiles.js or pieces.js as an element, for a layer.
  const parse = (markup) => {
    const g = document.createElementNS(SVGNS, "g");
    g.innerHTML = markup;
    return g.firstElementChild;
  };

  // ---------- drawing ----------
  // The parts that never change in a game: the sea, the land, the harbours, the numbers.
  function setBoard(b) {
    clearBoard();
    board = b;
    seaL.innerHTML = seaSvg(b);
    terrainL.innerHTML = HEXES.map((h) => `<g class="hx-hex" data-hex="${h.id}">${terrainSvg(b.terrain[h.id], h.id)}</g>`).join("");
    glowL.innerHTML = HEXES.map((h) => `<path class="hx-hexglow" data-hex="${h.id}" d="${hexPath(h)}"/>`).join("");
    harbourL.innerHTML = b.harbours.map((h) => harbourSvg(h)).join("");
    tokenL.innerHTML = HEXES.filter((h) => b.numbers[h.id]).map((h) => tokenSvg(b.numbers[h.id], h.id)).join("");
  }
  const hasBoard = () => board !== null;
  function clearBoard() {
    board = null;
    for (const l of [seaL, terrainL, glowL, harbourL, tokenL, roadL, buildingL, robberL, ghostL, spotL]) l.replaceChildren();
    roads.clear();
    buildings.clear();
    robberAt = -1;
    spotKey = "";
  }

  // The pieces as they stand: roads by edge (a seat or -1), buildings by corner, the robber's hex.
  const roads = new Map(); // edge -> { seat, node }
  const buildings = new Map(); // corner -> { seat, city, node }
  let robberAt = -1;
  function drawPieces({ roads: rs, buildings: bs, robber }) {
    for (const [e, r] of roads) {
      if (rs[e] !== r.seat) {
        r.node.remove();
        roads.delete(e);
      }
    }
    rs.forEach((seat, e) => {
      if (seat < 0 || roads.has(e)) return;
      const node = parse(roadSvg(e, seat));
      roadL.append(node);
      roads.set(e, { seat, node });
    });
    let moved = false;
    for (const [c, b] of buildings) {
      if (!bs[c] || bs[c].p !== b.seat || bs[c].city !== b.city) {
        b.node.remove();
        buildings.delete(c);
      }
    }
    bs.forEach((b, c) => {
      if (!b || buildings.has(c)) return;
      buildings.set(c, { seat: b.p, city: b.city, node: parse(b.city ? citySvg(c, b.p) : settlementSvg(c, b.p)) });
      moved = true;
    });
    // Drawn top to bottom, so nearer pieces overlap farther ones.
    if (moved) [...buildings.entries()].sort((a, b) => CORNERS[a[0]].y - CORNERS[b[0]].y || CORNERS[a[0]].x - CORNERS[b[0]].x).forEach(([, b]) => buildingL.append(b.node));
    if (robber !== robberAt) {
      robberAt = robber;
      robberL.innerHTML = robber >= 0 ? robberSvg(robber) : "";
      for (const t of tokenL.children) t.classList.toggle("hx-blocked", Number(t.dataset.hex) === robber);
    }
  }
  const pieceNode = (kind, at) => (kind === "road" ? roads.get(at)?.node : buildings.get(at)?.node);
  const buildingNodes = (p) => [...buildings.values()].filter((b) => b.seat === p).map((b) => b.node);
  // Restarts a piece's CSS animation (pieces.css) by putting it back with the class.
  function replay(node, cls) {
    if (!node?.parentNode) return;
    const parent = node.parentNode;
    const next = node.nextSibling;
    node.classList.remove(cls);
    node.remove();
    node.classList.add(cls);
    parent.insertBefore(node, next);
  }

  // ---------- spots: the legal places for the decision at hand ----------
  // kind: "corner", "edge" or "hex"; ids: the spots; words(id): its name;
  // ghost(id): a piece's markup to preview there; chosen: a spot already picked.
  let spotKey = "";
  let spots = { kind: null, ids: [], ghost: null };
  let focusId = null;
  function drawSpots(kind, ids = [], { words = () => "", ghost = null, chosen = null, label = "" } = {}) {
    const key = `${kind}:${ids.join(",")}:${chosen}`;
    spots = { kind, ids, ghost };
    spotL.setAttribute("aria-label", label || "Places you can choose");
    svg.classList.toggle("picking", !!kind && ids.length > 0);
    if (key === spotKey) return;
    const hadFocus = spotL.contains(document.activeElement);
    spotKey = key;
    showGhost(null);
    if (!kind || !ids.length) {
      spotL.replaceChildren();
      focusId = null;
      if (hadFocus) onSpotFocus(null);
      return;
    }
    if (!ids.includes(focusId)) focusId = ids[0];
    spotL.replaceChildren(
      ...ids.map((id) => {
        const node = parse(spotSvg(kind, id, words(id)));
        node.dataset.spot = id;
        node.setAttribute("tabindex", id === focusId ? "0" : "-1");
        node.classList.toggle("chosen", id === chosen);
        return node;
      }),
    );
    if (hadFocus) spotEl(focusId)?.focus({ preventScroll: true });
  }
  const spotEl = (id) => spotL.querySelector(`[data-spot="${id}"]`);
  function spotPoint(kind, id) {
    const o = kind === "corner" ? CORNERS[id] : kind === "edge" ? EDGES[id] : HEXES[id];
    return { x: o.x * U, y: o.y * U };
  }
  function showGhost(id) {
    ghostL.innerHTML = id !== null && spots.ghost ? spots.ghost(id) : "";
  }
  const spotOf = (e) => e.target.closest?.(".hx-spot");
  spotL.addEventListener("click", (e) => {
    const node = spotOf(e);
    if (node) onSpot(spots.kind, Number(node.dataset.spot));
  });
  spotL.addEventListener("pointerover", (e) => {
    const node = spotOf(e);
    if (!node || e.pointerType === "touch") return;
    showGhost(Number(node.dataset.spot));
    onSpotFocus(spots.kind, Number(node.dataset.spot));
  });
  spotL.addEventListener("pointerout", (e) => {
    if (spotOf(e) && !spotL.contains(e.relatedTarget)) {
      showGhost(spotL.contains(document.activeElement) ? focusId : null);
      onSpotFocus(spotL.contains(document.activeElement) ? spots.kind : null, focusId);
    }
  });
  spotL.addEventListener("focusin", (e) => {
    const node = spotOf(e);
    if (!node) return;
    focusId = Number(node.dataset.spot);
    for (const s of spotL.children) s.setAttribute("tabindex", s === node ? "0" : "-1");
    showGhost(focusId);
    onSpotFocus(spots.kind, focusId);
  });
  spotL.addEventListener("focusout", (e) => {
    if (spotL.contains(e.relatedTarget)) return;
    showGhost(null);
    onSpotFocus(null);
  });
  // Arrows move to the nearest spot that way; Home and End to the first and last; Enter or Space picks.
  const DIRS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
  spotL.addEventListener("keydown", (e) => {
    const node = spotOf(e);
    if (!node) return;
    const id = Number(node.dataset.spot);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      return onSpot(spots.kind, id);
    }
    let next = null;
    if (e.key === "Home") next = spots.ids[0];
    else if (e.key === "End") next = spots.ids.at(-1);
    else if (DIRS[e.key]) {
      const [dx, dy] = DIRS[e.key];
      const a = spotPoint(spots.kind, id);
      let best = Infinity;
      for (const o of spots.ids) {
        if (o === id) continue;
        const b = spotPoint(spots.kind, o);
        const along = (b.x - a.x) * dx + (b.y - a.y) * dy;
        if (along <= 1) continue;
        const across = Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx);
        const score = along + across * 2.2;
        if (score < best) {
          best = score;
          next = o;
        }
      }
    } else return;
    e.preventDefault();
    if (next !== null && next !== undefined) spotEl(next)?.focus();
  });
  const focusSpots = () => spotEl(focusId)?.focus();

  // ---------- the dice ----------
  let diceShown = null;
  function drawDice(dice, { dim = false } = {}) {
    diceBox.hidden = !dice;
    diceBox.classList.toggle("dim", dim);
    if (!dice) return;
    const key = dice.join();
    if (diceShown !== key) {
      diceShown = key;
      diceArt.innerHTML = diceSvg(dice);
      diceSum.textContent = String(dice[0] + dice[1]);
    }
  }

  // ---------- where things are, in the fly layer ----------
  // A board point (in board units) as a rect `size` units wide.
  function pointRect(x, y, size = 60) {
    const r = svg.getBoundingClientRect();
    const o = flyLayer.getBoundingClientRect();
    const s = Math.min(r.width / VB[2], r.height / VB[3]);
    const ox = r.left + (r.width - VB[2] * s) / 2 - o.left;
    const oy = r.top + (r.height - VB[3] * s) / 2 - o.top;
    const w = size * s;
    return { x: ox + (x - VB[0]) * s - w / 2, y: oy + (y - VB[1]) * s - w / 2, w, h: w };
  }
  const hexRect = (hex) => pointRect(HEXES[hex].x * U, HEXES[hex].y * U, 80);
  const cornerRect = (c) => pointRect(CORNERS[c].x * U, CORNERS[c].y * U, 50);
  const centreRect = () => pointRect(0, 0, 120);
  const cardWidth = () => Math.max(26, Math.min(46, svg.getBoundingClientRect().width * 0.06));

  // ---------- motion ----------
  // A card (cardEl key, or "back") flies from one rect to another along a low
  // arc, growing or shrinking to land; `fade` lets it melt into where it lands.
  async function flyCard(key, from, to, { ms = PACE.fly, g, delay = 0, width = cardWidth(), spin = 0, fade = true } = {}) {
    if (fast() || !live(g) || !from || !to) return;
    if (delay) await wait(delay, g);
    if (!live(g)) return;
    const node = cardEl(key, "hx-fly-card", { face: width < 40 ? "mini" : "full" });
    node.style.width = `${width}px`;
    flyLayer.append(node);
    const h = width * 1.4;
    const c = (r) => [r.x + r.w / 2 - width / 2, r.y + r.h / 2 - h / 2];
    const [x0, y0] = c(from);
    const [x1, y1] = c(to);
    const s1 = Math.max(0.5, Math.min(1.1, to.w / width));
    const lift = Math.min(70, Math.hypot(x1 - x0, y1 - y0) * 0.2 + 16);
    const at = (x, y, s, r) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(1)}deg) scale(${s.toFixed(3)})`;
    const motion = node.animate(
      [
        { transform: at(x0, y0, 0.6, -spin), opacity: 0 },
        { transform: at(x0 + (x1 - x0) * 0.1, y0 + (y1 - y0) * 0.1 - lift * 0.3, 0.95, -spin / 2), opacity: 1, offset: 0.12 },
        { transform: at((x0 + x1) / 2, Math.min(y0, y1) - lift, 1.08, 0), opacity: 1, offset: 0.5 },
        { transform: at(x1, y1, s1, spin), opacity: fade ? 0.2 : 1 },
      ],
      { duration: ms, easing: easing("out"), fill: "forwards" },
    );
    try {
      await motion.finished;
    } catch {}
    node.remove();
  }

  // Cards (keys) from one rect to another, a little apart.
  const flyMany = (keys, from, to, { g, ms = PACE.fly, gap = PACE.flyGap, k = 1 } = {}) => Promise.all(keys.map((key, i) => flyCard(key, typeof from === "function" ? from(i) : from, typeof to === "function" ? to(i) : to, { g, ms: ms * k, delay: i * gap * k, spin: ((i * 37) % 11) - 5 })));

  // The dice leap from the middle of the island into their corner, tumbling
  // (pieces.css flickers their faces), and land on `dice`.
  async function rollDice(dice, { g, k = 1 }) {
    if (fast() || !live(g)) return drawDice(dice);
    diceBox.hidden = false;
    diceBox.classList.remove("dim");
    diceShown = dice.join();
    diceArt.innerHTML = diceSvg(dice);
    diceArt.firstElementChild?.classList.add("hx-rolling");
    diceSum.textContent = "";
    const box = diceBox.getBoundingClientRect();
    const c = svg.getBoundingClientRect();
    const dx = c.left + c.width / 2 - (box.left + box.width / 2);
    const dy = c.top + c.height / 2 - (box.top + box.height / 2);
    const throwIt = diceBox.animate(
      [
        { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(1.7)`, opacity: 0 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 30}px) scale(1.5)`, opacity: 1, offset: 0.3 },
        { transform: "translate(0, 0) scale(1.08)", offset: 0.75 },
        { transform: "none" },
      ],
      { duration: Math.max(PACE.dice, 700) * k, easing: easing("out") },
    );
    await throwIt.finished.catch(() => {});
    if (!live(g)) return;
    diceArt.firstElementChild?.classList.remove("hx-rolling");
    diceSum.textContent = String(dice[0] + dice[1]);
    diceSum.animate([{ transform: "scale(.4)", opacity: 0 }, { transform: "scale(1.3)", opacity: 1, offset: 0.6 }, { transform: "none" }], { duration: tokenMs("slow") * 1.4, easing: easing("out") });
  }

  // The hexes that pay light up and their numbers bounce; a blocked one dims.
  function glowHexes(hexes, { g, k = 1, cls = "" }) {
    if (fast() || !live(g)) return;
    for (const hex of hexes) {
      const glow = glowL.querySelector(`[data-hex="${hex}"]`);
      glow?.setAttribute("class", `hx-hexglow ${cls}`);
      glow?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0.85, offset: 0.7 }, { opacity: 0 }], { duration: PACE.glow * 1.6 * k, easing: "ease-in-out" });
      if (!cls) replay(tokenL.querySelector(`[data-hex="${hex}"]`), "hx-rolled");
    }
  }

  // A building drops onto its corner (pieces.css) with a puff of dust.
  function popBuilding(corner, { g, k = 1 }) {
    const node = pieceNode("building", corner);
    if (fast() || !live(g) || !node) return;
    replay(node, "hx-pop");
    const { x, y } = spotPoint("corner", corner);
    puff(x, y + 14, g, k);
  }

  // A road draws itself in from the end that joins the player's own pieces.
  function growRoad(edge, from, { g }) {
    const node = pieceNode("road", edge);
    if (fast() || !live(g) || !node) return;
    // The road's art runs from corner a to corner b.
    const art = node.querySelector(".hx-art");
    if (art) art.style.transformOrigin = from === EDGES[edge].b ? "100% 50%" : "0% 50%";
    replay(node, "hx-draw");
  }

  function puff(x, y, g, k = 1) {
    if (fast() || !live(g)) return;
    const ring = parse(`<ellipse class="hx-puff" cx="${f1(x)}" cy="${f1(y)}" rx="34" ry="12"/>`);
    ghostL.after(ring);
    ring.style.transformOrigin = `${x}px ${y}px`;
    ring.animate([{ transform: "scale(.3)", opacity: 0.85 }, { transform: "scale(1.7)", opacity: 0 }], { duration: PACE.build * 1.5 * k, easing: easing("out") }).finished.then(
      () => ring.remove(),
      () => ring.remove(),
    );
  }

  // The robber hops from one hex to another (pieces.css) and lands with a puff.
  async function hopRobber(from, to, { g, k = 1 }) {
    if (fast() || !live(g) || from < 0 || from === to) return;
    robberAt = to;
    robberL.innerHTML = robberSvg(to, from);
    for (const t of tokenL.children) t.classList.toggle("hx-blocked", Number(t.dataset.hex) === to);
    await wait(PACE.hop * 0.85, g);
    const b = HEXES[to];
    if (live(g)) puff(b.x * U + 50, b.y * U + 30, g, k);
    await wait(PACE.hop * 0.25, g);
  }

  // The island rises out of the sea, a hex at a time, while the deck is opened.
  function riseIsland(g) {
    if (fast() || !live(g)) return;
    const ms = tokenMs("slow") * 1.8;
    RISE.forEach((hex, i) => {
      const h = HEXES[hex];
      const node = terrainL.querySelector(`[data-hex="${hex}"]`);
      // A token's own transform places it: its art inside scales instead.
      const tok = tokenL.querySelector(`[data-hex="${hex}"] > .hx-art`);
      for (const [n, extra] of [[node, 0], [tok, 260]]) {
        if (!n) continue;
        if (n === tok) {
          n.style.transformBox = "fill-box";
          n.style.transformOrigin = "center";
        } else n.style.transformOrigin = `${h.x * U}px ${h.y * U}px`;
        n.animate([{ transform: "scale(.4)", opacity: 0 }, { transform: "scale(1.06)", opacity: 1, offset: 0.7 }, { transform: "scale(1)", opacity: 1 }], { duration: ms, delay: i * PACE.rise + extra, easing: easing("out"), fill: "backwards" });
      }
    });
    harbourL.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, delay: RISE.length * PACE.rise, fill: "backwards" });
  }

  // The sea's small motions (tiles.css: waves, boats, the windmill, the
  // whale) play once when the island is drawn (style.css stops them looping);
  // this plays them once more, so the island stirs when something happens.
  function breathe(g) {
    if (fast() || !live(g)) return;
    svg.classList.add("hx-still");
    svg.getBoundingClientRect();
    svg.classList.remove("hx-still");
  }

  // The deck in the middle of the island while every browser shuffles it (on), or away.
  let deckOn = false;
  let deckAnims = [];
  function drawDeck(on) {
    if (on === deckOn) return;
    deckOn = on;
    deckAnims.forEach((a) => a.cancel());
    deckAnims = [];
    deck.hidden = !on;
    if (!on || fast()) return;
    // The deck riffles while it is worked on: a loading indicator, so it runs only then.
    const d = tokenMs("slow") * 3.4;
    deckAnims = [...deckStack.children].map((c, i) => {
      const side = i % 2 ? 1 : -1;
      const out = `translate(${side * 62}%, ${-6 - i * 2}px) rotate(${side * 12}deg)`;
      return c.animate([{ transform: `translate(0, ${-i * 2}px)` }, { transform: out, offset: 0.3 }, { transform: out, offset: 0.42 + i * 0.03 }, { transform: `translate(0, ${-i * 2}px)` }], { duration: d, iterations: Infinity, easing: easing("out") });
    });
  }

  // A word over a player's pill, or over the board.
  function say(host, p, text, g) {
    table.bubble(host, p, text, g, PACE.bubble);
  }

  // A moment over the board, in a player's colour: "Largest army!", a development card shown.
  async function moment({ text, p, card = null, g, k = 1, from = null }) {
    if (fast() || !live(g)) return;
    const node = el("div", { class: `hx-moment p-${p}` }, card !== null ? cardEl(card, "hx-moment-card", { face: "full" }) : null, el("span", { class: "words" }, text));
    flyLayer.append(node);
    const c = centreRect();
    node.style.left = `${c.x + c.w / 2}px`;
    node.style.top = `${c.y + c.h / 2}px`;
    const start = from ? `translate(${from.x + from.w / 2 - c.x - c.w / 2}px, ${from.y + from.h / 2 - c.y - c.h / 2}px) translate(-50%, -50%) scale(.3)` : "translate(-50%, -40%) scale(.5)";
    const a = node.animate(
      [
        { transform: start, opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1.06)", opacity: 1, offset: 0.22 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.32 },
        { transform: "translate(-50%, -52%) scale(1)", opacity: 1, offset: 0.82 },
        { transform: "translate(-50%, -60%) scale(.96)", opacity: 0 },
      ],
      { duration: PACE.reveal * 1.8 * k, easing: easing("out") },
    );
    await a.finished.catch(() => {});
    node.remove();
  }

  // ---------- your hand ----------
  const handBox = el("div", { class: "hx-hand", id: "hx-hand", role: "group", "aria-label": "Your hand" });
  const resRow = el("div", { class: "hx-res-row" });
  const devRow = el("div", { class: "hx-dev-row" });
  const piles = [0, 1, 2, 3, 4].map((r) => {
    const count = el("span", { class: "hx-count mono" }, "0");
    const plus = el("span", { class: "hx-plus mono", hidden: true });
    const name = el("span", { class: "hx-pile-name" }, RES_NAMES[r]);
    // An empty pile keeps its place: a dashed outline round the resource's glyph.
    const stack = el("span", { class: "hx-stack" }, el("span", { class: "hx-edge e2" }), el("span", { class: "hx-edge e1" }), cardEl(r), el("span", { class: "hx-slot" }, glyphEl(r)));
    const node = el("div", { class: `hx-pile r-${r}`, role: "img", dataset: { r } }, stack, count, plus, name);
    resRow.append(node);
    return { node, count, plus, stack };
  });
  const unknownPile = el("div", { class: "hx-pile hx-unknown", hidden: true, role: "img" }, el("span", { class: "hx-stack" }, cardEl("back")), el("span", { class: "hx-count mono" }, "0"));
  resRow.append(unknownPile);
  handBox.append(resRow, devRow);

  // counts: your 5 resource counts; unknown: cards whose faces haven't arrived;
  // fresh: 5 counts just gained (lit up); devs: [{ slot, kind, isNew, playable }];
  // onDev(slot) plays one; highlight: 5 counts picked (lifted) in a picker.
  function drawHand({ counts, unknown = 0, fresh = [0, 0, 0, 0, 0], devs = [], onDev = () => {}, lifted = null }) {
    piles.forEach((pile, r) => {
      const n = counts[r];
      pile.node.classList.toggle("empty", n === 0);
      pile.node.classList.toggle("fresh", fresh[r] > 0);
      pile.node.dataset.n = String(Math.min(n, 3));
      pile.count.textContent = String(n);
      pile.plus.hidden = !fresh[r];
      pile.plus.textContent = `+${fresh[r]}`;
      pile.node.classList.toggle("lifted", !!lifted?.[r]);
      pile.node.setAttribute("aria-label", `${RES_NAMES[r]}: ${n}${fresh[r] ? `, ${fresh[r]} just gained` : ""}`);
    });
    unknownPile.hidden = !unknown;
    unknownPile.lastChild.textContent = String(unknown);
    unknownPile.setAttribute("aria-label", `${plural(unknown, "card")} arriving`);
    // Development cards, alike ones together.
    const groups = [];
    for (const d of devs) {
      const key = `${d.kind}:${d.isNew}:${d.playable}`;
      const g = groups.find((x) => x.key === key);
      if (g) g.slots.push(d.slot);
      else groups.push({ key, kind: d.kind, isNew: d.isNew, playable: d.playable, slots: [d.slot] });
    }
    const key = groups.map((x) => `${x.key}x${x.slots.length}`).join("|");
    if (devRow.dataset.key !== key) {
      const had = devRow.contains(document.activeElement) ? document.activeElement.dataset.kind : null;
      devRow.dataset.key = key;
      devRow.replaceChildren(
        ...groups.map((x) => {
          const words = x.kind ? `${DEV_NAMES[x.kind]}${x.slots.length > 1 ? ` (${x.slots.length})` : ""}` : "A development card, arriving";
          const label = x.kind ? `${words}: ${DEV_WORDS[x.kind]}${x.isNew ? ". Bought this turn, so it can be played from your next turn" : ""}${x.playable ? ". Play it" : ""}` : words;
          const tag = x.playable ? "button" : "div";
          const node = el(tag, { class: `hx-dev ${x.playable ? "playable" : ""} ${x.isNew ? "new" : ""}`, type: x.playable ? "button" : null, role: x.playable ? null : "img", "aria-label": label, title: label, dataset: { kind: x.kind ?? "" }, onclick: x.playable ? () => onDev(x.slots[0]) : null }, cardEl(x.kind ?? "back", "", { face: "full" }), x.slots.length > 1 ? el("span", { class: "hx-count mono" }, `×${x.slots.length}`) : null, x.isNew ? el("span", { class: "hx-new" }, "New") : null);
          return node;
        }),
      );
      if (had) devRow.querySelector(`[data-kind="${had}"]`)?.focus({ preventScroll: true });
    }
    devRow.hidden = !groups.length;
    const total = counts.reduce((a, b) => a + b, 0) + unknown;
    handBox.setAttribute("aria-label", `Your hand: ${plural(total, "card")}${total ? `, ${countWords(counts)}` : ""}${devs.length ? `, and ${plural(devs.length, "development card")}` : ""}`);
  }
  const pileRect = (r) => rectIn(piles[r].stack);
  // Cards narrower than 46 px show their small face.
  new ResizeObserver(() => {
    const w = piles[0].stack.offsetWidth;
    const mini = w > 0 && w < 46;
    if (handBox.classList.contains("mini") === mini) return;
    handBox.classList.toggle("mini", mini);
    piles.forEach((pile) => setMini(pile.stack, mini));
  }).observe(handBox);

  // ---------- the bank ----------
  const bankChips = [0, 1, 2, 3, 4].map((r) => el("span", { class: `hx-bank-chip r-${r}`, dataset: { r } }, glyphEl(r), el("span", { class: "mono" }, "19")));
  const devChip = el("span", { class: "hx-bank-chip dev" }, cardEl("back"), el("span", { class: "mono" }, "25"));
  const bankBox = el("div", { class: "hx-bank", id: "hx-bank", role: "group", "aria-label": "The bank" }, el("span", { class: "hx-bank-title" }, "Bank"), ...bankChips, devChip);
  function drawBank(bank, devPile) {
    bank.forEach((n, r) => {
      bankChips[r].lastChild.textContent = String(n);
      bankChips[r].classList.toggle("low", n <= 3);
      bankChips[r].setAttribute("aria-label", `${n} ${RES_NAMES[r]}`);
    });
    devChip.lastChild.textContent = String(devPile);
    devChip.setAttribute("aria-label", `${plural(devPile, "development card")}`);
    bankBox.setAttribute("aria-label", `The bank: ${bank.map((n, r) => `${n} ${RES_NAMES[r]}`).join(", ")}, ${plural(devPile, "development card")}`);
  }
  const bankChipRect = (r) => rectIn(r === "dev" ? devChip : bankChips[r]);

  return {
    boardWrap,
    svg,
    handBox,
    bankBox,
    setBoard,
    hasBoard,
    clearBoard,
    drawPieces,
    drawSpots,
    focusSpots,
    drawDice,
    drawDeck,
    riseIsland,
    breathe,
    drawHand,
    drawBank,
    pieceNode,
    buildingNodes,
    hexRect,
    cornerRect,
    centreRect,
    pileRect,
    bankChipRect,
    pointRect,
    flyCard,
    flyMany,
    rollDice,
    glowHexes,
    popBuilding,
    growRoad,
    hopRobber,
    say,
    moment,
  };
}
