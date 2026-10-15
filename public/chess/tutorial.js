// Chess's tutorial: its lessons (lessons.js) on the game's own squares and
// pieces (art.js, style.css), moving and sounding as in the game (motion.js,
// sounds.js), every move checked by rules.js. The adapter engine/tutorial.js
// asks for.
import { el } from "../engine/shell.js";
import { stateFromFen, applyMove, listMoves, inCheck, squareName, colorOf, typeOf, PAWN } from "./rules.js";
import { pieceSvg, pieceName, promoOptions } from "./art.js";
import { landMove, dragPieces, reducedMotion } from "./motion.js";
import { playMove } from "./sounds.js";

export { lessons } from "./lessons.js";
export const flavour = "wood";

// A position is a FEN; the side to move is the learner.
export const load = (fen) => stateFromFen(fen);
export const play = (state, move) => applyMove(state, state.turn, move);
export const cells = (move) => [move.from, move.to];
// A capture lights where it was made (and the pawn taken en passant), and
// checkmate the king, as at the game's win.
export function result(state, played = []) {
  if (state.reason === "checkmate" && state.winner === 0) return [state.kings[state.side]];
  const moved = played.find((e) => e.type === "moved" && e.player === 0 && e.captured);
  return moved ? [...new Set([moved.capturedAt, moved.to])] : [];
}

// White at the bottom. Tap or press Enter on a piece, then on its square,
// or drag it there. The board takes moves only while a step waits for one.
export function board() {
  let state = null;
  let live = false;
  let selected = -1;
  let focusSq = -1;
  let moveFn = () => {};
  let dropping = false; // true while a drag-and-drop plays its move
  let dropped = null; // a move dropped in place: no slide needed
  const squares = [];
  const grid = el("div", { class: "chess-board", role: "group", "aria-label": "Chessboard" });
  for (let r = 7; r >= 0; r--) {
    const row = el("div", { class: "chess-row" });
    for (let f = 0; f < 8; f++) {
      const sq = r * 8 + f;
      const btn = el("button", { type: "button", class: `sq ${(r + f) % 2 ? "light" : "dark"}`, tabindex: "-1", dataset: { sq } }, el("span", { class: "art" }));
      if (f === 0) btn.append(el("span", { class: "coord rank", "aria-hidden": "true" }, String(r + 1)));
      if (r === 0) btn.append(el("span", { class: "coord file", "aria-hidden": "true" }, "abcdefgh"[f]));
      squares[sq] = btn;
      row.append(btn);
    }
    grid.append(row);
  }
  const promoBox = el("div", { class: "chess-promo", role: "dialog", "aria-label": "Promote your pawn", hidden: true });
  const node = el("div", { class: "chess" }, el("div", { class: "chess-board-wrap" }, grid, promoBox));

  const movesFrom = (from) => listMoves(state).filter((mv) => mv.from === from);
  const own = (sq) => state.board[sq] && colorOf(state.board[sq]) === state.side;

  function onSquare(sq) {
    if (!live || !promoBox.hidden) return;
    if (selected >= 0 && selected !== sq && !own(sq)) {
      const from = selected;
      if (movesFrom(from).filter((mv) => mv.to === sq).length > 1) return openPromo(from, sq);
      select(-1);
      return send({ from, to: sq });
    }
    select(own(sq) && selected !== sq ? sq : -1);
  }

  function send(move) {
    dropped = dropping ? move : null;
    moveFn(move);
  }

  function select(sq) {
    selected = sq;
    draw();
  }

  function openPromo(from, to) {
    const close = () => {
      promoBox.hidden = true;
      select(-1);
    };
    promoBox.replaceChildren(
      el("p", {}, "Promote to"),
      promoOptions(state.side, (promo) => (close(), send({ from, to, promo }))),
      el("button", { type: "button", class: "btn ghost small", onclick: () => (close(), squares[focusSq].focus()) }, "Cancel"),
    );
    promoBox.hidden = false;
    promoBox.querySelector(".promo-opt").focus();
  }

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".sq");
    if (btn) onSquare(Number(btn.dataset.sq));
  });
  dragPieces(grid, {
    pieceAt: (sq) => (live && promoBox.hidden && own(sq) ? state.board[sq] : 0),
    lift: select,
    drop: (sq) => {
      dropping = true;
      onSquare(sq);
      dropping = false;
    },
  });
  grid.addEventListener("focusin", (e) => {
    const btn = e.target.closest(".sq");
    if (btn) focusSq = Number(btn.dataset.sq);
  });
  // Arrow keys move between squares; Enter or Space picks up and puts down.
  grid.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selected >= 0) return select(-1);
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, 0], ArrowDown: [-1, 0] }[e.key];
    if (!step) return;
    e.preventDefault();
    const r = Math.min(7, Math.max(0, (focusSq >> 3) + step[0]));
    const f = Math.min(7, Math.max(0, (focusSq & 7) + step[1]));
    focusSq = r * 8 + f;
    draw();
    squares[focusSq].focus();
  });
  promoBox.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      promoBox.hidden = true;
      select(-1);
      squares[focusSq].focus();
    }
  });

  function draw() {
    const targets = new Map(selected >= 0 ? movesFrom(selected).map((mv) => [mv.to, mv]) : []);
    const last = state.moves.at(-1);
    const checkSq = inCheck(state) ? state.kings[state.side] : -1;
    if (focusSq < 0) focusSq = state.kings[state.side];
    grid.classList.toggle("armed", live);
    for (let sq = 0; sq < 64; sq++) {
      const btn = squares[sq];
      const piece = state.board[sq];
      if (btn.dataset.p !== String(piece)) {
        btn.dataset.p = String(piece);
        btn.firstChild.innerHTML = piece ? pieceSvg(piece) : "";
      }
      const passant = targets.get(sq)?.to === state.ep && typeOf(state.board[selected]) === PAWN;
      btn.classList.toggle("sel", sq === selected);
      btn.classList.toggle("target", targets.has(sq) && !piece && !passant);
      btn.classList.toggle("capture", targets.has(sq) && (!!piece || passant));
      btn.classList.toggle("last", !!last && (sq === last.from || sq === last.to));
      btn.classList.toggle("check", sq === checkSq);
      btn.classList.toggle("mine", own(sq));
      btn.tabIndex = sq === focusSq ? 0 : -1;
      let label = `${squareName(sq)}, ${piece ? pieceName(piece) : "empty"}`;
      if (sq === selected) label += ", selected";
      else if (targets.has(sq)) label += piece ? ", capture" : ", move here";
      if (sq === checkSq) label += ", in check";
      btn.setAttribute("aria-label", label);
    }
  }

  return {
    node,
    cell: (sq) => squares[sq],
    onMove: (fn) => (moveFn = fn),
    // A move just played lands as in the game, with its sound.
    render(st, played) {
      state = st;
      live = !played;
      selected = -1;
      promoBox.hidden = true;
      draw();
      const drop = dropped;
      dropped = null;
      const moved = played?.find((e) => e.type === "moved");
      if (!moved) return;
      const still = reducedMotion() || (drop && drop.from === moved.from && drop.to === moved.to);
      return landMove(squares, moved, (st.side << 3) | moved.captured, still).then(() => playMove(moved));
    },
    // The piece flies to where it was dropped and springs back home.
    reject({ from, to }) {
      if (reducedMotion()) return;
      const a = squares[to].getBoundingClientRect();
      const b = squares[from].getBoundingClientRect();
      squares[from].classList.add("moving");
      squares[from].firstChild
        .animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" })
        .finished.catch(() => {})
        .finally(() => squares[from].classList.remove("moving"));
    },
  };
}
