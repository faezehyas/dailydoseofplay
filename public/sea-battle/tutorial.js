// Sea Battle's tutorial: its lessons (lessons.js) on the game's own boards
// and ships (art.js, style.css), every move checked by rules.js. It runs in
// the page with both fleets in view of the code (match.js and its
// commitments aren't used), and shows only what a player would see. The
// adapter engine/tutorial.js asks for.
import { el, toast } from "../engine/shell.js";
import { RuleError } from "../engine/turn-match.js";
import * as R from "./rules.js";
import { play as sound } from "./sounds.js";
import { createBoard, shipEl, shipFromCells, paintCells, fleetLeft, ownShipEl, shipKey, turnings, dragShip, launch, land, follow } from "./art.js";

export { lessons } from "./lessons.js";
export const flavour = "water";

// Fires a shot for whoever's turn it is, answered from the other fleet.
function fire(state, target) {
  const { match, fleets } = state;
  const shooter = match.turn;
  const defender = R.other(shooter);
  const cells = R.checkFire(match, shooter, "shot", target);
  const { hits, sunk } = R.answerShots(fleets[defender], match.boards[defender], cells);
  return R.applyFire(match, shooter, "shot", cells, hits, sunk, { target });
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
    return fire(state, move.target);
  } catch (err) {
    if (!(err instanceof R.RuleError)) throw err;
    throw new RuleError(err.message[0].toUpperCase() + err.message.slice(1));
  }
}
export const cells = (move) => (move.type === "place" ? [`m${R.idx(move.r, move.c)}`] : move.target === undefined ? [] : [move.target]);

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const isShot = (e) => e.type === "hit" || e.type === "miss";
// Who fired a volley: a hit fires again, a win ends the game, else the turn passes.
function shooterOf(events) {
  const e = events.find((e) => e.type === "again" || e.type === "win" || e.type === "turn");
  return e.type === "turn" ? R.other(e.player) : (e.player ?? e.winner);
}

// Placing works as in the game: drag a ship (R turns it mid-drag), tap a
// ship to pick it and tap it again to turn it; on a focused ship R, Enter
// or Space turn it and the arrow keys move it a square at a time. A drop or
// a turn is the step's move; arrow moves wait until you leave the ship.
// Firing: tap a square of teal's waters; each shell flies and lands as in
// the game.
export function board() {
  let state = null;
  let draft = null; // your fleet as shown, with a ship the arrow keys are moving
  let selected = -1;
  let dragging = false;
  let redrawing = false;
  let flying = false;
  let lastTurn = -1;
  let lastShots = [new Set(), new Set()]; // board -> squares of the latest volley at it
  let moveFn = () => {};
  const own = createBoard("Your fleet", false);
  const enemy = createBoard("Teal's waters", true);
  own.wrap.classList.add("own");
  enemy.wrap.classList.add("enemy");
  const node = el("div", { class: "sea-battle", dataset: { you: "a" } }, el("div", { class: "sb-boards" }, enemy.wrap, own.wrap));
  const canFire = () => !!state?.match && state.match.turn === 0 && state.match.winner === -1 && !flying;

  // ---------- placing ----------
  const placeMove = (k, ship) => moveFn({ type: "place", ship: k, r: ship.r, c: ship.c, vertical: ship.vertical });
  function turn(k) {
    const others = draft.filter((_, j) => j !== k);
    const tries = turnings(draft[k]);
    placeMove(k, tries.find((t) => R.canPlace(others, t)) ?? tries[0]);
  }
  function startDrag(e, k) {
    if (state.match || e.button > 0) return;
    dragging = true;
    dragShip(e, own, draft, k, (candidate, moved) => {
      dragging = false;
      const picked = selected === k;
      const ship = draft[k];
      selected = k;
      if (moved && (candidate.r !== ship.r || candidate.c !== ship.c || candidate.vertical !== ship.vertical)) placeMove(k, candidate);
      else if (!moved && picked) turn(k);
      else draw();
    });
  }
  function keyMove(e, k) {
    if (state.match || dragging) return;
    const act = shipKey(e.key);
    if (!act) return;
    e.preventDefault();
    selected = k;
    if (act === "turn") return turn(k);
    const next = { ...draft[k], r: draft[k].r + act[0], c: draft[k].c + act[1] };
    if (R.canPlace(draft.filter((_, j) => j !== k), next)) draft = draft.map((s, j) => (j === k ? next : s));
    draw();
  }
  // Leaving a ship the arrow keys moved makes the move, once focus has
  // settled on whatever comes next.
  own.shipsLayer.addEventListener("focusout", (e) => {
    const k = Number(e.target.dataset.k);
    if (redrawing || state.match) return;
    setTimeout(() => {
      const was = state.fleets[0][k];
      const now = draft[k];
      if (!state.match && (now.r !== was.r || now.c !== was.c)) placeMove(k, now);
    });
  });

  // ---------- firing ----------
  function aim(cell) {
    for (const c of enemy.cells) c.classList.remove("aim");
    if (cell && canFire() && state.match.boards[1].cells[cell.dataset.i] === R.UNKNOWN) cell.classList.add("aim");
  }
  enemy.cellsLayer.addEventListener("pointerover", (e) => aim(e.target.closest(".cell")));
  enemy.cellsLayer.addEventListener("focusin", (e) => aim(e.target.closest(".cell")));
  enemy.cellsLayer.addEventListener("pointerleave", () => aim(null));
  enemy.cellsLayer.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell || !canFire()) return;
    const i = Number(cell.dataset.i);
    if (state.match.boards[1].cells[i] !== R.UNKNOWN) return toast("Already explored. Pick another square.");
    aim(null);
    moveFn({ type: "fire", target: i });
  });

  function draw() {
    const { match } = state;
    const placing = !match;
    node.dataset.phase = placing ? "placing" : match.winner === -1 ? "playing" : "over";
    enemy.wrap.hidden = placing;
    own.wrap.classList.toggle("placing", placing);
    const focused = own.shipsLayer.contains(document.activeElement) ? document.activeElement.dataset.k : undefined;
    redrawing = true;
    own.shipsLayer.replaceChildren(
      ...draft.map((ship, k) => {
        const n = ownShipEl(ship, k, { selected: placing && k === selected, draggable: placing, board: match?.boards[0] });
        if (placing) {
          n.setAttribute("aria-label", `${n.getAttribute("aria-label")} Tab away to place it.`);
          n.addEventListener("pointerdown", (e) => startDrag(e, k));
          n.addEventListener("keydown", (e) => keyMove(e, k));
        }
        return n;
      }),
    );
    if (focused !== undefined) own.shipsLayer.querySelector(`[data-k="${focused}"]`)?.focus();
    redrawing = false;
    paintCells(own, match?.boards[0], lastShots[0]);
    paintCells(enemy, match?.boards[1], lastShots[1], true);
    enemy.shipsLayer.replaceChildren(...(match?.boards[1].sunk ?? []).map((s) => shipEl(shipFromCells(s.cells), "sunk")));
    fleetLeft(own, match?.boards[0] ?? null);
    if (match) fleetLeft(enemy, match.boards[1]);
    enemy.wrap.classList.toggle("armed", canFire());
  }

  // As in the game, the turn chime and teal's waters in view when the turn
  // comes back to you.
  function cue() {
    const turn = state.match && state.match.winner === -1 ? state.match.turn : -1;
    if (turn === lastTurn) return;
    lastTurn = turn;
    if (turn !== 0) return;
    sound("turn");
    follow(enemy);
  }

  return {
    node,
    cell: (c) => (typeof c === "number" ? enemy.cells[c] : own.cells[Number(c.slice(1))]),
    onMove: (fn) => (moveFn = fn),
    // A volley flies and lands as in the game; the promise settles as it lands.
    render(st, played) {
      if (!played && st !== state) {
        // A new position is drawn as it stands, not as fresh shots.
        lastShots = [new Set(), new Set()];
        for (const c of [...own.cells, ...enemy.cells]) c.dataset.v = c.dataset.s = "";
        lastTurn = st.match?.turn ?? -1;
      }
      state = st;
      draft = st.fleets[0].map((ship) => ({ ...ship }));
      if (st.match) selected = -1;
      if (!played) {
        draw();
        return cue();
      }
      const shooter = shooterOf(played);
      const target = shooter === 0 ? enemy : own;
      if (shooter === 1) follow(own);
      const flight = launch(target, "shot", undefined, played.filter(isShot).map((e) => e.cell));
      lastShots[R.other(shooter)] = new Set(played.filter(isShot).map((e) => e.cell));
      flying = true;
      draw();
      cue();
      return new Promise((resolve) =>
        setTimeout(() => {
          flying = false;
          land(target, "shot", undefined, played, 0);
          enemy.wrap.classList.toggle("armed", canFire());
          resolve();
        }, flight * 1000),
      );
    },
    // A ship that won't go there gives a little shake.
    reject(move) {
      const ship = move.type === "place" && own.shipsLayer.children[move.ship];
      if (!ship || reducedMotion()) return;
      ship.animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "none" }], { duration: 260, easing: "ease-out" });
    },
  };
}
