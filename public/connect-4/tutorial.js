// Connect 4's tutorial: its lessons (lessons.js) on the game's own frame and
// discs (style.css), every move checked by rules.js. The adapter
// engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { newState, applyMove, colorOf, landing, EMPTY } from "./rules.js";

export { lessons } from "./lessons.js";
export const flavour = "plastic";

const COLS = 7;
const ROWS = 6;

// A position is the board's lowest rows, top to bottom, of X, O and "."
// ("..XO... ..XXO.."); the rows above are empty. X, the learner, moves first
// and next. Loaded discs aren't moves, so none is marked as the last one.
export function load(position) {
  const state = newState(0, { size: `${COLS}x${ROWS}`, moveSeconds: 0, gameSeconds: 0 });
  const rows = position.split(" ");
  rows.forEach((row, k) => {
    [...row].forEach((mark, col) => {
      if (mark === ".") return;
      state.board[(ROWS - rows.length + k) * COLS + col] = mark === "X" ? 0 : 1;
      state.heights[col] += 1;
    });
  });
  return state;
}
export const play = (state, move) => applyMove(state, state.turn, move);
// A column's squares from the bottom up: the hint lights the whole column.
export const cells = ({ col }) => Array.from({ length: ROWS }, (_, k) => (ROWS - 1 - k) * COLS + col);
// The line the learner finished lights up, as at the game's win.
export const result = (state) => (state.winner === 0 ? state.line : []);

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Each column is one button; its squares run top to bottom like the board.
export function board() {
  let state = null;
  let moveFn = () => {};
  const squares = [];
  const columns = Array.from({ length: COLS }, (_, col) => {
    const column = Array.from({ length: ROWS }, (_, row) => (squares[row * COLS + col] = el("span", { class: "c4-cell", dataset: { i: row * COLS + col, v: "" } })));
    return el("button", { type: "button", class: "c4-col", dataset: { col } }, column);
  });
  const grid = el("div", { class: "c4-board armed", role: "group", "aria-label": `Board, ${COLS} columns`, dataset: { me: "coral" } }, columns);
  grid.style.setProperty("--cols", COLS);
  grid.style.setProperty("--rows", ROWS);
  grid.addEventListener("click", (e) => {
    const column = e.target.closest(".c4-col");
    if (column) moveFn({ col: Number(column.dataset.col) });
  });
  // Arrow keys (and Home/End) move between columns; Enter or Space drops (native button).
  grid.addEventListener("keydown", (e) => {
    const column = e.target.closest(".c4-col");
    if (!column) return;
    const col = Number(column.dataset.col);
    const next = { ArrowLeft: col - 1, ArrowRight: col + 1, Home: 0, End: COLS - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    columns[(next + COLS) % COLS].focus();
  });

  return {
    node: el("div", { class: "c4-board-wrap" }, el("div", { class: "c4-frame" }, grid)),
    cell: (i) => squares[i],
    onMove: (fn) => (moveFn = fn),
    render(st) {
      state = st;
      const lastCol = st.moves.at(-1);
      const lastCell = lastCol === undefined ? -1 : (ROWS - st.heights[lastCol]) * COLS + lastCol;
      squares.forEach((cell, i) => {
        const owner = st.board[i];
        const color = owner === EMPTY ? "" : colorOf(st, owner);
        if (cell.dataset.v !== color) {
          cell.dataset.v = color;
          if (color) {
            // The disc falls from above the board to its square.
            const disc = el("span", { class: "c4-disc" });
            disc.style.setProperty("--fall", Math.floor(i / COLS) + 1);
            cell.replaceChildren(disc);
          } else cell.replaceChildren();
        }
        cell.classList.toggle("last", i === lastCell);
      });
      columns.forEach((column, col) => {
        const free = ROWS - st.heights[col];
        const next = landing(st, col);
        for (const cell of column.children) cell.classList.toggle("next", Number(cell.dataset.i) === next);
        const top = free < ROWS ? colorOf(st, st.board[free * COLS + col]) : "";
        column.setAttribute("aria-label", `Column ${col + 1}, ${free ? `${free} free` : "full"}${top ? `, top disc ${top}` : ""}`);
      });
    },
    // The disc drops to where it would land, then fades away.
    reject({ col }) {
      const i = landing(state, col);
      if (reducedMotion() || i < 0) return;
      const disc = el("span", { class: "c4-disc", dataset: { c: "coral" } });
      disc.style.setProperty("--fall", Math.floor(i / COLS) + 1);
      squares[i].append(disc);
      disc
        .animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 700, easing: "ease-in" })
        .finished.catch(() => {})
        .finally(() => disc.remove());
    },
  };
}
