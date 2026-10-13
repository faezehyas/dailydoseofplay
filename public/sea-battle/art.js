// Sea Battle's drawing, shared by the game (main.js) and its tutorial
// (tutorial.js): the marks on the squares, the warships, a board with its
// ships and squares, dragging a ship, and a shell's flight and landing.
import { el } from "../engine/shell.js";
import * as R from "./rules.js";
import { play } from "./sounds.js";

const ICON = {
  fire:
    '<svg viewBox="0 0 24 24" class="mk-fire" aria-hidden="true"><path class="fl1" d="M12 1.5c.8 3.2 4.8 5.6 4.8 10.6a4.8 4.8 0 0 1-9.6 0c0-2.4 1.1-4 2.2-5.2.2 1.7.9 2.8 2 3.2-.6-2.8-.2-5.6.6-8.6z"/><path class="fl2" d="M12 10.5c.5 1.6 2.4 2.6 2.4 4.6a2.4 2.4 0 0 1-4.8 0c0-1.4.8-2.3 1.5-3 .1.8.4 1.2.9 1.4 0-1.2-.2-2.1 0-3z"/></svg>',
  splash:
    '<svg viewBox="0 0 24 24" class="mk-splash" aria-hidden="true"><circle cx="12" cy="12" r="2.4"/><circle class="ring" cx="12" cy="12" r="5.5"/><circle class="ring2" cx="12" cy="12" r="9"/></svg>',
  gift:
    '<svg viewBox="0 0 24 24" class="mk-gift" aria-hidden="true"><rect class="g1" x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path class="g2" d="M9.2 9.6a2.9 2.9 0 1 1 4.3 2.5c-.9.5-1.5 1-1.5 2v.6"/><circle class="g3" cx="12" cy="17.4" r="1.2"/></svg>',
  wreck:
    '<svg viewBox="0 0 24 24" class="mk-wreck" aria-hidden="true"><circle class="w1" cx="12" cy="12" r="7.5"/><path class="w2" d="M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4"/></svg>',
  clear: '<svg viewBox="0 0 24 24" class="mk-clear" aria-hidden="true"><circle cx="12" cy="12" r="2"/></svg>',
};

// Top-down warship art, drawn bow-right in a len x 1 box (100 units per
// square); vertical ships are the same drawing turned 90 degrees.
function turret(x, dir = 1) {
  const b = dir > 0 ? x + 8 : x - 38;
  return `<rect class="barrel" x="${b}" y="41.5" width="30" height="5" rx="2.5"/><rect class="barrel" x="${b}" y="53.5" width="30" height="5" rx="2.5"/><circle class="turret" cx="${x}" cy="50" r="15"/><circle class="hatch" cx="${x}" cy="50" r="5"/>`;
}
function bridge(x, w = 50) {
  return `<rect class="bridge" x="${x - w / 2}" y="31" width="${w}" height="38" rx="8"/><rect class="windows" x="${x + w / 2 - 11}" y="36" width="5" height="28" rx="2.5"/><circle class="mast" cx="${x - 5}" cy="50" r="6"/>`;
}
const funnel = (x) => `<ellipse class="funnel" cx="${x}" cy="50" rx="13" ry="11"/><ellipse class="funnel-top" cx="${x}" cy="50" rx="8" ry="6"/>`;

export function shipSvg(len, vertical) {
  const W = len * 100;
  const hull = `M8 26 Q8 13 21 13 H${W - 52} C${W - 22} 13 ${W - 6} 33 ${W - 2} 50 C${W - 6} 67 ${W - 22} 87 ${W - 52} 87 H21 Q8 87 8 74 Z`;
  const deck = `M20 24 H${W - 56} C${W - 34} 24 ${W - 20} 37 ${W - 14} 50 C${W - 20} 63 ${W - 34} 76 ${W - 56} 76 H20 Z`;
  let parts;
  if (len >= 5) {
    // Carrier: flat flight deck, runway markings and an island on the side.
    parts = `<path class="flightdeck" d="M15 19 H${W - 80} L${W - 26} 50 L${W - 80} 81 H15 Z"/>
      <path class="runway" d="M32 50 H${W - 64}"/>
      <path class="runway-edge" d="M32 31 H${W - 130} M32 69 H${W - 130}"/>
      <rect class="bridge" x="${W * 0.55}" y="9" width="66" height="22" rx="5"/><circle class="mast" cx="${W * 0.55 + 16}" cy="20" r="5"/>
      <path class="plane" d="M${W * 0.28} 41 l20 9 -20 9 6 -9z M${W * 0.28 + 44} 41 l20 9 -20 9 6 -9z"/>`;
  } else if (len === 4) {
    parts = turret(W - 98) + turret(W - 150) + bridge(W - 215) + funnel(W - 268) + turret(66, -1);
  } else if (len === 3) {
    parts = turret(W - 92) + bridge(W - 158, 46) + funnel(W - 208) + turret(58, -1);
  } else {
    parts = turret(W - 76) + bridge(76, 44);
  }
  const art = `<path class="hull" d="${hull}"/><path class="deck" d="${deck}"/><path class="keel" d="M24 50 H${W - 40}"/>${parts}`;
  return vertical
    ? `<svg viewBox="0 0 100 ${W}" aria-hidden="true"><g transform="translate(100 0) rotate(90)">${art}</g></svg>`
    : `<svg viewBox="0 0 ${W} 100" aria-hidden="true">${art}</svg>`;
}

export function createBoard(label, interactive) {
  const title = el("h2", { class: "board-title" }, label);
  const fleetInfo = el("div", { class: "fleet-left" });
  const cols = el("div", { class: "labels cols", "aria-hidden": "true" }, ..."ABCDEFGHIJ".split("").map((ch) => el("span", {}, ch)));
  const rows = el("div", { class: "labels rows", "aria-hidden": "true" }, ...Array.from({ length: 10 }, (_, i) => el("span", {}, String(i + 1))));
  const shipsLayer = el("div", { class: "layer ships" });
  const cellsLayer = el("div", { class: "layer cells", role: interactive ? "grid" : "img", "aria-label": label });
  const cells = [];
  for (let i = 0; i < R.CELLS; i++) {
    const cell = interactive
      ? el("button", { type: "button", class: "cell", dataset: { i }, "aria-label": R.cellName(i) })
      : el("div", { class: "cell", dataset: { i } });
    cell.style.gridArea = `${R.rowOf(i) + 1} / ${R.colOf(i) + 1}`;
    cell.dataset.v = "";
    cell.dataset.s = "";
    cells.push(cell);
    cellsLayer.append(cell);
  }
  const board = el("div", { class: "board" }, shipsLayer, cellsLayer);
  const frame = el("div", { class: "board-frame" }, el("span"), cols, rows, board);
  const wrap = el("section", { class: "board-wrap" }, el("div", { class: "board-head" }, title, fleetInfo), frame);
  return { wrap, board, cells, shipsLayer, cellsLayer, fleetInfo, title, interactive };
}

export function shipEl(ship, cls) {
  const node = el("div", { class: `ship len${ship.len} ${ship.vertical ? "v" : "h"} ${cls || ""}` });
  node.innerHTML = shipSvg(ship.len, ship.vertical);
  placeShipEl(node, ship);
  return node;
}
export function placeShipEl(node, ship) {
  node.style.gridRow = `${ship.r + 1} / span ${ship.vertical ? ship.len : 1}`;
  node.style.gridColumn = `${ship.c + 1} / span ${ship.vertical ? 1 : ship.len}`;
  node.classList.toggle("v", ship.vertical);
  node.classList.toggle("h", !ship.vertical);
}
export const shipFromCells = (cells) => {
  const s = [...cells].sort((a, b) => a - b);
  return { r: R.rowOf(s[0]), c: R.colOf(s[0]), len: s.length, vertical: s.length > 1 && s[1] - s[0] === R.SIZE };
};

// showGifts: only the board you fire at shows gifts (yours to collect).
// An interactive board (the one you fire at) says what each square is.
export function paintCells(view, board, last = new Set(), showGifts = false) {
  const giftAt = new Map(board && showGifts ? board.gifts.map((g) => [g.cell, g.type]) : []);
  const sunkAt = new Set(board ? board.sunk.flatMap((x) => x.cells) : []);
  for (let i = 0; i < R.CELLS; i++) {
    const v = board ? board.cells[i] : R.UNKNOWN;
    const gift = giftAt.has(i);
    const sunk = sunkAt.has(i);
    const key = `${v}${gift ? "g" : ""}${sunk ? "s" : ""}${last.has(i) ? "l" : ""}`;
    const cell = view.cells[i];
    if (cell.dataset.v === key) continue;
    const fresh = cell.dataset.s !== "" && cell.dataset.s !== String(v) && (v === R.HIT || v === R.MISS);
    cell.dataset.v = key;
    cell.dataset.s = String(v);
    cell.className = "cell";
    if (v === R.HIT) cell.classList.add(sunk ? "sunk" : "hit");
    else if (v === R.MISS) cell.classList.add("miss");
    else if (v === R.CLEAR) cell.classList.add("clear");
    if (gift) cell.classList.add("gift");
    if (last.has(i)) cell.classList.add("last");
    if (fresh) cell.classList.add("fresh");
    cell.innerHTML =
      v === R.HIT ? (sunk ? ICON.wreck : ICON.fire) : v === R.MISS ? ICON.splash : v === R.CLEAR ? ICON.clear : gift ? ICON.gift : "";
    if (view.interactive) {
      const what = v === R.HIT ? (sunk ? "sunk" : "hit") : v === R.MISS ? "miss" : v === R.CLEAR ? "clear water" : gift ? "mystery gift" : "unexplored";
      cell.setAttribute("aria-label", `${R.cellName(i)}, ${what}`);
    }
  }
}

// A pip per ship of the fleet, dimmed once it is sunk on that board.
export function fleetLeft(view, board) {
  const left = board ? R.remainingShips(board) : [...R.FLEET];
  view.fleetInfo.replaceChildren(
    ...R.FLEET.map((len) => {
      const k = left.indexOf(len);
      if (k >= 0) left.splice(k, 1);
      return el("span", { class: `pip len${len} ${k >= 0 ? "" : "gone"}`, title: `${R.SHIP_NAMES[len]} (${len})${k >= 0 ? "" : ", sunk"}` });
    }),
  );
}

// Your ship k: draggable while you place your fleet, burnt out once sunk on
// your board.
export function ownShipEl(ship, k, { selected, draggable, board }) {
  const node = shipEl(ship, selected ? "selected" : "");
  node.dataset.k = k;
  if (draggable) {
    node.classList.add("draggable");
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `${R.SHIP_NAMES[ship.len]}, ${ship.len} squares at ${R.cellName(R.idx(ship.r, ship.c))}, ${ship.vertical ? "vertical" : "horizontal"}. Arrow keys move, R rotates.`);
  }
  if (board && board.sunk.some((s) => s.cells.join() === R.shipCells(ship).sort((a, b) => a - b).join())) node.classList.add("sunk");
  return node;
}

// ---------- placing ----------
// What a key does to a focused ship: a step [dr, dc] or "turn".
export function shipKey(key) {
  const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (moves[key]) return moves[key];
  return key === "r" || key === "R" || key === "Enter" || key === " " ? "turn" : null;
}

// A ship turned: tried in place, then nudged back inside the board.
export function turnings(ship) {
  const turned = { ...ship, vertical: !ship.vertical };
  const tries = [turned];
  for (let d = 1; d < ship.len; d++) tries.push(turned.vertical ? { ...turned, r: turned.r - d } : { ...turned, c: turned.c - d });
  return tries;
}

function cellAt(view, x, y) {
  const rect = view.board.getBoundingClientRect();
  return {
    r: Math.floor(((y - rect.top) / rect.height) * R.SIZE),
    c: Math.floor(((x - rect.left) / rect.width) * R.SIZE),
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Drags ship k of fleet from its pointerdown e, square by square; done(candidate,
// moved) gets where it was let go.
export function dragShip(e, view, fleet, k, done) {
  e.preventDefault();
  const node = e.currentTarget;
  node.setPointerCapture?.(e.pointerId);
  const origin = fleet[k];
  const others = fleet.filter((_, j) => j !== k);
  const grab = cellAt(view, e.clientX, e.clientY);
  let vertical = origin.vertical;
  // Which square of the ship is under the pointer.
  let off = {
    r: clamp(grab.r - origin.r, 0, vertical ? origin.len - 1 : 0),
    c: clamp(grab.c - origin.c, 0, vertical ? 0 : origin.len - 1),
  };
  let pointer = { x: e.clientX, y: e.clientY };
  let moved = false;
  let candidate = origin;
  node.classList.add("dragging");
  const update = () => {
    const at = cellAt(view, pointer.x, pointer.y);
    const next = {
      ...origin,
      vertical,
      r: clamp(at.r - off.r, 0, R.SIZE - (vertical ? origin.len : 1)),
      c: clamp(at.c - off.c, 0, R.SIZE - (vertical ? 1 : origin.len)),
    };
    if (next.r === candidate.r && next.c === candidate.c && next.vertical === candidate.vertical) return;
    moved = moved || next.r !== origin.r || next.c !== origin.c || next.vertical !== origin.vertical;
    candidate = next;
    placeShipEl(node, candidate);
    node.classList.toggle("bad", !R.canPlace(others, candidate));
  };
  const onMove = (ev) => {
    pointer = { x: ev.clientX, y: ev.clientY };
    update();
  };
  // R while dragging rotates the ship around the square you're holding.
  const onKey = (ev) => {
    if (ev.key !== "r" && ev.key !== "R") return;
    ev.preventDefault();
    ev.stopPropagation();
    vertical = !vertical;
    off = { r: off.c, c: off.r };
    node.innerHTML = shipSvg(origin.len, vertical);
    update();
  };
  const onUp = () => {
    node.removeEventListener("pointermove", onMove);
    node.removeEventListener("pointerup", onUp);
    node.removeEventListener("pointercancel", onUp);
    removeEventListener("keydown", onKey, true);
    done(candidate, moved);
  };
  node.addEventListener("pointermove", onMove);
  node.addEventListener("pointerup", onUp);
  node.addEventListener("pointercancel", onUp);
  addEventListener("keydown", onKey, true);
}

// ---------- shells ----------
// Seconds a shell is in the air before it lands (sound and visuals wait for it).
export const FLIGHT = { shot: 0.45, big: 0.55, rain: 0.6, nuke: 1.0, carpet: 0.6 };
// Rolling booms, one every BOOM_STEP seconds: 7 for missile rain (one per
// square) and 10 for the carpet bomb (one per square along its line). Each
// square lands on its boom.
const BOOM_STEP = 0.17;
const LAUNCH_SOUND = { shot: "launch", big: "launch-big", rain: "launch-rain", nuke: "launch-nuke", carpet: "launch-rain" };

// Which boom of a rolling volley a square lands on: rain squares in order,
// carpet squares by their place along the line.
function boomOf(w, dir, cell, k) {
  if (w !== "carpet") return k;
  return dir === "col" ? R.rowOf(cell) : R.colOf(cell);
}

// A volley is fired at view's board: its squares flash and wait for the
// shell (paintCells' fresh marks pop on --impact-delay). Returns its flight.
export function launch(view, w, dir, cells) {
  const flight = FLIGHT[w] ?? FLIGHT.shot;
  view.board.style.setProperty("--impact-delay", `${flight}s`);
  for (const c of view.cells) c.style.removeProperty("--impact-delay");
  cells.forEach((c, k) => {
    // Rain and carpet bombs land square by square, in step with their booms.
    if (w === "rain" || w === "carpet") view.cells[c].style.setProperty("--impact-delay", `${flight + boomOf(w, dir, c, k) * BOOM_STEP}s`);
    view.cells[c].classList.add("incoming");
  });
  play(LAUNCH_SOUND[w] ?? "launch");
  return flight;
}

// The shell lands on view's board: impact sounds and, for heavy weapons, a
// blast on the board. me is the player whose gifts chime.
export function land(view, w, dir, events, me) {
  const sunk = events.some((e) => e.type === "sunk");
  const hits = events.filter((e) => e.type === "hit");
  if (w === "nuke") {
    play("nuke");
    play("roar");
  } else if (w === "rain" || w === "carpet") {
    const rolled = play(w);
    events
      .filter((e) => e.type === "hit" || e.type === "miss")
      .forEach((e, k) =>
        setTimeout(() => {
          if (e.type === "hit") play("rain-hit");
          else if (!rolled) play("rain-miss");
        }, boomOf(w, dir, e.cell, k) * BOOM_STEP * 1000),
      );
  } else if (w === "big") {
    if (hits.length && play("blast")) play("hit", { offset: -4 });
    else if (!hits.length) play("miss", { offset: 2 });
  } else play(hits.length ? "hit" : "miss");
  if (sunk) {
    // A second, deeper blast as the ship blows apart; it groans and goes under.
    const at = w === "nuke" ? 900 : 250;
    setTimeout(() => play("sink") && play("groan"), at);
    setTimeout(() => play("miss", { offset: -4 }), at + 500);
  }
  if (events.some((e) => e.type === "gift" && e.by === me)) setTimeout(() => play("gift"), 300);
  if (w === "nuke" || w === "big" || w === "carpet") {
    const shots = events.filter((e) => e.type === "hit" || e.type === "miss").map((e) => e.cell);
    const r = shots.reduce((s, i) => s + R.rowOf(i), 0) / Math.max(1, shots.length);
    const c = shots.reduce((s, i) => s + R.colOf(i), 0) / Math.max(1, shots.length);
    view.board.style.setProperty("--bx", `${(c + 0.5) * 10}%`);
    view.board.style.setProperty("--by", `${(r + 0.5) * 10}%`);
    const cls = w === "nuke" ? "nuked" : "blasted";
    view.board.classList.remove(cls);
    void view.board.offsetWidth; // restart the animation
    view.board.classList.add(cls);
    setTimeout(() => view.board.classList.remove(cls), w === "nuke" ? 1800 : 700);
  }
}

// On phones the two boards don't fit on one screen: keep the action in view.
export function follow(view) {
  if (innerWidth >= 760) return;
  const r = view.board.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= innerHeight) return;
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  view.wrap.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "nearest" });
}
