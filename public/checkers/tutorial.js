// Checkers' tutorial: its lessons (lessons.js) on the game's own squares and
// pieces (art.js, style.css), picked and sounding as in the game (pick.js,
// sounds.js), every move checked by rules.js. The adapter engine/tutorial.js
// asks for.
import { el } from "../engine/shell.js";
import { newState, applyMove, legalMoves, capturedBy, owner, isKing, isDark, EMPTY } from "./rules.js";
import { CROWN_SVG } from "./art.js";
import { startsWith, jumpEnds } from "./pick.js";
import { playMove } from "./sounds.js";

export { lessons } from "./lessons.js";
export const flavour = "wood";

// A position is the board's 8 rows, top to bottom, of "x" (the learner's
// men, coral, moving up), "o" (the other side's), the same in capitals for
// kings, and "." for an empty square; the learner moves next.
export function load(position) {
  const state = newState(0, { moveSeconds: 0, gameSeconds: 0 });
  [...position.replace(/\s/g, "")].forEach((mark, sq) => {
    state.board[sq] = { x: 0, o: 1, X: 2, O: 3 }[mark] ?? EMPTY;
  });
  return state;
}
export const play = (state, move) => applyMove(state, state.turn, move);
export const cells = (move) => move.path;
// A capture lights the squares jumped and where it ended, as at the game's win.
export function result(state, played = []) {
  const moved = played.find((e) => e.type === "moved" && e.player === 0 && e.captured.length);
  return moved ? [...moved.captured, moved.path.at(-1)] : [];
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const squareName = (sq) => `Row ${(sq >> 3) + 1}, column ${(sq & 7) + 1}`;

// The learner's men at the bottom. Tap or press Enter on a piece, then on
// each square it lands on; a jump that can go on waits for the next landing,
// and a tap where only one multi-jump ends plays it all. The board takes
// moves only while a step waits for one.
export function board() {
  let state = null;
  let live = false;
  let learner = 0;
  let picked = null; // the squares chosen so far: [from, landing, ...]
  let focusSq = -1;
  let moveFn = () => {};
  const squares = new Map(); // dark squares only
  const grid = el("div", { class: "ck-board", role: "group", "aria-label": "Board" });
  for (let sq = 0; sq < 64; sq++) {
    if (!isDark(sq)) {
      grid.append(el("div", { class: "ck-sq light", "aria-hidden": "true" }));
      continue;
    }
    const btn = el("button", { type: "button", class: "ck-sq dark", tabindex: "-1", dataset: { sq, v: "" } });
    squares.set(sq, btn);
    grid.append(btn);
  }

  function onSquare(sq) {
    if (!live) return;
    const piece = state.board[sq];
    if (piece !== EMPTY && owner(piece) === state.turn) {
      picked = picked?.length === 1 && picked[0] === sq ? null : [sq];
      return draw();
    }
    if (!picked) return;
    const legal = legalMoves(state.board, state.turn);
    const end = jumpEnds(legal, picked).get(sq);
    if (end) {
      picked = null;
      draw();
      return moveFn({ path: end });
    }
    const path = [...picked, sq];
    if (legal.some((m) => m.length > path.length && startsWith(m, path))) {
      picked = path;
      return draw();
    }
    picked = null;
    draw();
    moveFn({ path });
  }

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".ck-sq.dark");
    if (!btn) return;
    focusSq = Number(btn.dataset.sq);
    onSquare(focusSq);
  });
  // Arrow keys move between dark squares; Enter or Space picks (native button); Escape lets go.
  grid.addEventListener("keydown", (e) => {
    if (!e.target.closest(".ck-sq.dark")) return;
    if (e.key === "Escape") {
      picked = null;
      return draw();
    }
    let r = focusSq >> 3;
    let c = focusSq & 7;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") c = (c + (e.key === "ArrowLeft" ? 6 : 2)) % 8;
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      r = (r + (e.key === "ArrowUp" ? 7 : 1)) % 8;
      c ^= 1;
    } else return;
    e.preventDefault();
    focusSq = r * 8 + c;
    draw();
    squares.get(focusSq).focus();
  });

  function draw() {
    const legal = state.winner === -1 ? legalMoves(state.board, state.turn) : [];
    const movable = new Set(legal.map((m) => m[0]));
    const targets = new Set(picked ? legal.filter((m) => m.length > picked.length && startsWith(m, picked)).map((m) => m[picked.length]) : []);
    const ends = picked ? jumpEnds(legal, picked) : new Map();
    const taking = new Set(picked ? capturedBy(picked) : []);
    const last = state.moves.at(-1);
    const lastCaptured = new Set(last ? capturedBy(last) : []);
    if (!squares.has(focusSq)) focusSq = [...movable][0] ?? squares.keys().next().value;
    grid.classList.toggle("armed", live);
    for (const [sq, btn] of squares) {
      // While a jump is being picked, its piece is drawn where it has got to.
      let piece = state.board[sq];
      if (picked?.length > 1) {
        if (sq === picked[0]) piece = EMPTY;
        if (sq === picked.at(-1)) piece = state.board[picked[0]];
      }
      const ghost = piece === EMPTY && lastCaptured.has(sq);
      const fresh = last && sq === last.at(-1);
      const key = `${piece}|${ghost}|${fresh ? state.moves.length : ""}`;
      if (btn.dataset.v !== key) {
        btn.dataset.v = key;
        btn.replaceChildren();
        if (piece !== EMPTY) {
          const disc = el("span", { class: `piece ${owner(piece) ? "b" : "a"} ${isKing(piece) ? "king" : ""} ${fresh ? "landed" : ""}` });
          if (isKing(piece)) disc.innerHTML = CROWN_SVG;
          btn.append(disc);
        } else if (ghost) btn.append(el("span", { class: `piece ghost ${owner(state.board[last.at(-1)]) ? "a" : "b"}` }));
      }
      const isPicked = picked?.at(-1) === sq;
      btn.classList.toggle("can", !picked && movable.has(sq));
      btn.classList.toggle("picked", isPicked);
      btn.classList.toggle("target", targets.has(sq));
      btn.classList.toggle("end", ends.has(sq));
      btn.classList.toggle("taking", taking.has(sq));
      btn.classList.toggle("trail", !!picked && picked.includes(sq) && !isPicked);
      btn.classList.toggle("last", !picked && !!last?.includes(sq));
      btn.tabIndex = sq === focusSq ? 0 : -1;
      let label = `${squareName(sq)}, ${piece === EMPTY ? "empty" : `${owner(piece) ? "teal" : "your"} ${isKing(piece) ? "king" : "man"}`}`;
      if (isPicked) label += ", picked";
      else if (targets.has(sq)) label += ", move here";
      else if (ends.has(sq)) label += ", jump all the way here";
      if (taking.has(sq)) label += ", being captured";
      btn.setAttribute("aria-label", label);
    }
  }

  return {
    node: el("div", { class: "ck-board-wrap" }, grid),
    cell: (sq) => squares.get(sq),
    onMove: (fn) => (moveFn = fn),
    // A move just played sounds as in the game: the learner's, or the other side's.
    render(st, played) {
      state = st;
      live = !played;
      if (live) learner = st.turn;
      picked = null;
      draw();
      const moved = played?.find((e) => e.type === "moved");
      if (moved) playMove(moved, moved.player === learner);
    },
    // The piece flies to where it was put and springs back home.
    reject({ path }) {
      const from = squares.get(path[0]);
      const to = squares.get(path.at(-1));
      const disc = from?.querySelector(".piece");
      if (reducedMotion() || !disc || !to) return;
      const a = to.getBoundingClientRect();
      const b = from.getBoundingClientRect();
      disc.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
    },
  };
}
