// Gomoku's tutorial: its lessons (lessons.js) on the game's own grid and
// stones (art.js, style.css), every move checked by rules.js. The adapter
// engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { newState, applyMove, stoneOf, EMPTY, SIZE } from "./rules.js";
import { pointName, gridSvg } from "./art.js";

export { lessons } from "./lessons.js";
export const flavour = "paper";

// A position is { x: [points], o: [points] }; x, the learner, has the solid
// stones and moves next. Loaded stones aren't moves, so none is marked as the
// last one.
export function load({ x = [], o = [] }) {
  const state = newState(0, { moveSeconds: 0, gameSeconds: 0 });
  for (const i of x) state.board[i] = 0;
  for (const i of o) state.board[i] = 1;
  return state;
}
export const play = (state, move) => applyMove(state, state.turn, move);
export const cells = (move) => [move.cell];

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function board() {
  let state = null;
  let moveFn = () => {};
  let focusCell = (SIZE * SIZE - 1) / 2;
  const points = Array.from({ length: SIZE * SIZE }, (_, i) => el("button", { type: "button", class: "gmk-cell", tabindex: i === focusCell ? "0" : "-1", dataset: { i, v: "" } }));
  const grid = el("div", { class: "gmk-board armed", role: "group", "aria-label": "Board, 15 by 15. Arrow keys move between points.", dataset: { me: "first" } }, ...points);
  grid.insertAdjacentHTML("afterbegin", gridSvg());
  function moveFocus(i, focus) {
    points[focusCell].tabIndex = -1;
    focusCell = i;
    points[i].tabIndex = 0;
    if (focus) points[i].focus();
  }
  grid.addEventListener("click", (e) => {
    const cell = e.target.closest(".gmk-cell");
    if (!cell) return;
    moveFocus(Number(cell.dataset.i), false);
    moveFn({ cell: Number(cell.dataset.i) });
  });
  // Arrow keys move between points (one tab stop for the whole board); Enter or Space plays.
  grid.addEventListener("keydown", (e) => {
    const cell = e.target.closest(".gmk-cell");
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!cell || !step) return;
    e.preventDefault();
    const i = Number(cell.dataset.i);
    moveFocus(((Math.floor(i / SIZE) + step[0] + SIZE) % SIZE) * SIZE + ((i % SIZE) + step[1] + SIZE) % SIZE, true);
  });

  return {
    node: el("div", { class: "gmk-board-wrap" }, grid),
    cell: (i) => points[i],
    onMove: (fn) => (moveFn = fn),
    render(st) {
      state = st;
      const line = new Set(st.line || []);
      const last = st.moves.at(-1);
      points.forEach((cell, i) => {
        const owner = st.board[i];
        cell.dataset.v = owner === EMPTY ? "" : stoneOf(st, owner);
        cell.classList.toggle("win", line.has(i));
        cell.classList.toggle("last", last === i);
        const who = owner === EMPTY ? "empty" : owner === 0 ? "your stone" : "ringed stone";
        cell.setAttribute("aria-label", `${pointName(i)}, ${who}${line.has(i) ? ", winning line" : last === i ? ", last move" : ""}`);
      });
    },
    // The stone is set down where it was tried, then shrinks away.
    reject({ cell }) {
      const target = points[cell];
      if (reducedMotion() || target.dataset.v) return;
      target.dataset.v = "first";
      target
        .animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, transform: "scale(0.6)" }], { duration: 600, easing: "ease-in", pseudoElement: "::after" })
        .finished.catch(() => {})
        .finally(() => state.board[cell] === EMPTY && (target.dataset.v = ""));
    },
  };
}
