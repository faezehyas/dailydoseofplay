// Tic Tac Toe's tutorial: its lessons (lessons.js) on the game's own board
// and marks (art.js, style.css), every move checked by rules.js. The adapter
// engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { newState, applyMove, markOf, EMPTY } from "./rules.js";
import { MARK_SVG } from "./art.js";

export { lessons } from "./lessons.js";
export const flavour = "paper";

// A position is three rows of X, O and "." ("X.. .O. ..."); X, the learner, moves next.
export function load(position) {
  const state = newState(0, { size: 3, moveSeconds: 0, gameSeconds: 0 });
  [...position.replace(/\s/g, "")].forEach((mark, i) => {
    if (mark === ".") return;
    state.board[i] = mark === "X" ? 0 : 1;
    state.moves.push(i);
  });
  return state;
}
export const play = (state, move) => applyMove(state, state.turn, move);
export const cells = (move) => [move.cell];

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const cellName = (i) => `Row ${Math.floor(i / 3) + 1}, column ${(i % 3) + 1}`;

export function board() {
  let moveFn = () => {};
  const cellEls = Array.from({ length: 9 }, (_, i) => el("button", { type: "button", class: "ttt-cell", dataset: { i, v: "" } }));
  const grid = el("div", { class: "ttt-board armed", role: "group", "aria-label": "Board" }, cellEls);
  grid.addEventListener("click", (e) => {
    const cell = e.target.closest(".ttt-cell");
    if (cell) moveFn({ cell: Number(cell.dataset.i) });
  });
  // Arrow keys move between squares; Enter or Space plays (native button).
  grid.addEventListener("keydown", (e) => {
    const cell = e.target.closest(".ttt-cell");
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!cell || !step) return;
    e.preventDefault();
    const i = Number(cell.dataset.i);
    cellEls[((Math.floor(i / 3) + step[0] + 3) % 3) * 3 + ((i % 3) + step[1] + 3) % 3].focus();
  });

  return {
    node: el("div", { class: "ttt-board-wrap" }, grid),
    cell: (i) => cellEls[i],
    onMove: (fn) => (moveFn = fn),
    render(state) {
      const line = new Set(state.line || []);
      cellEls.forEach((cell, i) => {
        const owner = state.board[i];
        const mark = owner === EMPTY ? "" : markOf(state, owner);
        if (cell.dataset.v !== mark) {
          cell.dataset.v = mark;
          cell.innerHTML = mark ? MARK_SVG[mark] : "";
        }
        cell.classList.toggle("win", line.has(i));
        cell.classList.toggle("last", state.moves.at(-1) === i);
        cell.setAttribute("aria-label", `${cellName(i)}, ${mark || "empty"}${line.has(i) ? ", winning line" : ""}`);
      });
    },
    // The X is drawn where it was tried, then shrinks away.
    reject({ cell }) {
      const target = cellEls[cell];
      if (reducedMotion() || target.dataset.v) return;
      target.innerHTML = MARK_SVG.X;
      target.firstChild
        .animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, transform: "scale(0.6)" }], { duration: 600, easing: "ease-in" })
        .finished.catch(() => {})
        .finally(() => target.dataset.v === "" && (target.innerHTML = ""));
    },
  };
}
