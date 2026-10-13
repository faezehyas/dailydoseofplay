// Sea Battle's tutorial: its lessons (lessons.js) on the game's own boards
// and ships (art.js, style.css), every move checked by rules.js. It runs in
// the page with both fleets in view of the code (match.js and its
// commitments aren't used), and shows only what a player would see. The
// adapter engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { RuleError } from "../engine/turn-match.js";
import * as R from "./rules.js";
import { createBoard, shipEl, shipFromCells, paintCells } from "./art.js";

export { lessons } from "./lessons.js";
export const flavour = "water";

// Fires a shot for whoever's turn it is, answered from the other fleet.
function fire(state, target) {
  const { match, fleets } = state;
  const shooter = match.turn;
  const defender = R.other(shooter);
  const cells = R.checkFire(match, shooter, "shot", target);
  const { hits, sunk } = R.answerShots(fleets[defender], match.boards[defender], cells);
  R.applyFire(match, shooter, "shot", cells, hits, sunk, { target });
}

function place(state, { ship: k, r, c, vertical }) {
  const fleet = state.fleets[0];
  if (state.match) throw new R.RuleError("the battle has begun");
  if (!fleet[k]) throw new R.RuleError("unknown ship");
  const ship = { r, c, len: fleet[k].len, vertical: !!vertical };
  if (!R.shipInBounds(ship)) throw new R.RuleError("that ship doesn't fit on the board there");
  if (!R.canPlace(fleet.filter((_, j) => j !== k), ship)) throw new R.RuleError("ships can't overlap or touch side by side");
  fleet[k] = ship;
}

// A position is { fleet, enemy, shots } (see lessons.js). The learner is
// player 0; the earlier shots are all theirs.
export function load({ fleet, enemy, shots = [] }) {
  const state = { fleets: [fleet.map((ship) => ({ ...ship })), enemy ?? null], match: enemy ? R.newMatchState(0) : null };
  for (const target of shots) {
    state.match.turn = 0;
    fire(state, target);
  }
  if (state.match) state.match.turn = 0;
  return state;
}
// The rules speak in lower case; the tutorial shows them as sentences.
export function play(state, move) {
  try {
    if (move?.type === "place") return place(state, move);
    if (move?.type !== "fire") throw new R.RuleError("unknown move");
    if (!state.match) throw new R.RuleError("place your fleet first");
    fire(state, move.target);
  } catch (err) {
    if (!(err instanceof R.RuleError)) throw err;
    throw new RuleError(err.message[0].toUpperCase() + err.message.slice(1));
  }
}
export const cells = (move) => (move.type === "place" ? [`m${R.idx(move.r, move.c)}`] : move.target === undefined ? [] : [move.target]);

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Placing: tap a ship to pick it, then a square for its bow (top or left
// end); tap the picked ship again to turn it. Firing: tap a square of
// teal's waters. Every square is a button, for Tab and Enter.
export function board() {
  let state = null;
  let selected = -1;
  let moveFn = () => {};
  const own = createBoard("Your fleet", true);
  const enemy = createBoard("Teal's waters", true);
  own.wrap.classList.add("own");
  enemy.wrap.classList.add("enemy");
  const node = el("div", { class: "sea-battle", dataset: { you: "a" } }, el("div", { class: "sb-boards" }, enemy.wrap, own.wrap));
  const shipAt = (i) => state.fleets[0].findIndex((ship) => R.shipCells(ship).includes(i));

  own.cellsLayer.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell || state.match) return;
    const i = Number(cell.dataset.i);
    const k = shipAt(i);
    const ship = state.fleets[0][k];
    if (k >= 0 && k === selected) return moveFn({ type: "place", ship: k, r: ship.r, c: ship.c, vertical: !ship.vertical });
    if (k >= 0 || selected < 0) {
      selected = k;
      return draw();
    }
    moveFn({ type: "place", ship: selected, r: R.rowOf(i), c: R.colOf(i), vertical: state.fleets[0][selected].vertical });
  });
  enemy.cellsLayer.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (cell && state.match) moveFn({ type: "fire", target: Number(cell.dataset.i) });
  });

  function draw() {
    const { fleets, match } = state;
    node.dataset.phase = match ? "playing" : "placing";
    enemy.wrap.hidden = !match;
    own.shipsLayer.replaceChildren(...fleets[0].map((ship, k) => shipEl(ship, k === selected ? "selected" : "")));
    paintCells(own, match?.boards[0]);
    paintCells(enemy, match?.boards[1]);
    enemy.shipsLayer.replaceChildren(...(match?.boards[1].sunk ?? []).map((s) => shipEl(shipFromCells(s.cells), "sunk")));
    enemy.wrap.classList.toggle("armed", !!match && match.winner === -1 && match.turn === 0);
    // Your own squares are only buttons while you place your ships.
    own.cells.forEach((cell, i) => {
      const k = shipAt(i);
      cell.tabIndex = match ? -1 : 0;
      cell.setAttribute("aria-label", `${R.cellName(i)}${k >= 0 ? `, your ${R.SHIP_NAMES[fleets[0][k].len]}${k === selected ? ", picked" : ""}` : ""}`);
    });
  }

  return {
    node,
    cell: (c) => (typeof c === "number" ? enemy.cells[c] : own.cells[Number(c.slice(1))]),
    onMove: (fn) => (moveFn = fn),
    render(st) {
      state = st;
      if (st.match) selected = -1;
      draw();
    },
    // A ship that won't go there gives a little shake.
    reject(move) {
      const ship = move.type === "place" && own.shipsLayer.children[move.ship];
      if (!ship || reducedMotion()) return;
      ship.animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "none" }], { duration: 260, easing: "ease-out" });
    },
  };
}
