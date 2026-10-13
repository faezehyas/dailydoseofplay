// Chess pieces in motion, shared by the game (main.js) and its tutorial
// (tutorial.js): a move landing on the board, and a piece dragged by mouse
// or finger. `squares` is the board's square buttons by square index.
import { el } from "../engine/shell.js";
import { ROOK_HOP } from "./rules.js";
import { pieceSvg } from "./art.js";

export const SLIDE_MS = 190;
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// The piece glides from its old square (the rook too, when castling) unless
// `still`, and the taken piece `loser` is knocked off. Settles as it lands.
export function landMove(squares, moved, loser, still) {
  if (!still) {
    slide(squares, moved.from, moved.to);
    if (moved.san.startsWith("O-O")) slide(squares, ...ROOK_HOP[moved.to], 120);
  }
  if (moved.captured && !reducedMotion()) takeAway(squares[moved.capturedAt], loser, still ? 0 : SLIDE_MS * 0.6);
  return new Promise((resolve) => setTimeout(resolve, still ? 0 : SLIDE_MS));
}

function slide(squares, from, to, delay = 0) {
  const target = squares[to];
  const a = squares[from].getBoundingClientRect();
  const b = target.getBoundingClientRect();
  target.classList.add("moving");
  target.firstChild
    .animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: "none" }], {
      duration: SLIDE_MS,
      delay,
      easing: "cubic-bezier(0.25, 0.8, 0.35, 1)",
      fill: "backwards",
    })
    .finished.catch(() => {})
    .finally(() => target.classList.remove("moving"));
}

// The taken piece is knocked off its square with a small burst.
function takeAway(square, loser, delay) {
  const wrap = square.closest(".chess-board-wrap");
  const r = square.getBoundingClientRect();
  const w = wrap.getBoundingClientRect();
  const fx = el("div", { class: "chess-fx", "aria-hidden": "true" });
  fx.innerHTML = `${pieceSvg(loser)}<span class="burst"></span>`;
  Object.assign(fx.style, { left: `${r.left - w.left}px`, top: `${r.top - w.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  wrap.append(fx);
  fx.firstChild.animate(
    [
      { transform: "none", opacity: 1 },
      { transform: "scale(1.2) rotate(-10deg)", opacity: 0.9, offset: 0.3 },
      { transform: "translateY(25%) scale(0.35) rotate(20deg)", opacity: 0 },
    ],
    { duration: 360, delay, easing: "ease-in", fill: "both" },
  );
  fx.lastChild
    .animate([{ transform: "scale(0.3)", opacity: 0.9 }, { transform: "scale(1.25)", opacity: 0 }], { duration: 420, delay: delay + 30, easing: "ease-out", fill: "both" })
    .finished.catch(() => {})
    .finally(() => fx.remove());
}

// Drag a piece with a mouse or finger; a press that doesn't move is a tap,
// and the click that ends a drag is no tap. pieceAt(sq) is the piece that
// may be picked up there now (0 for none), lift(sq) selects it and
// drop(sq) puts it down there. Returns a function that stops a drag.
export function dragPieces(board, { pieceAt, lift, drop }) {
  let drag = null;
  let dragged = false;
  board.addEventListener("pointerdown", (e) => {
    dragged = false;
    // A drag released outside the window never got its pointerup.
    if (drag?.ghost) {
      drag.ghost.remove();
      drag.btn.classList.remove("lifted");
    }
    drag = null;
    const btn = e.target.closest(".sq");
    if (!btn || e.button !== 0 || !pieceAt(Number(btn.dataset.sq))) return;
    drag = { btn, from: Number(btn.dataset.sq), id: e.pointerId, x: e.clientX, y: e.clientY, ghost: null };
    addEventListener("pointermove", onPointerMove);
    addEventListener("pointerup", endDrag);
    addEventListener("pointercancel", endDrag);
  });
  board.addEventListener("click", (e) => dragged && e.stopImmediatePropagation(), true);
  board.addEventListener("keydown", () => (dragged = false));

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.ghost) {
      const piece = pieceAt(drag.from);
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6 || !piece) return;
      const size = drag.btn.getBoundingClientRect().width;
      drag.ghost = el("div", { class: "chess-ghost", "aria-hidden": "true" });
      drag.ghost.innerHTML = pieceSvg(piece);
      drag.ghost.style.width = drag.ghost.style.height = `${size * 1.15}px`;
      board.closest(".chess").append(drag.ghost);
      drag.btn.classList.add("lifted");
      lift(drag.from);
    }
    drag.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
  }
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { from, btn, ghost } = drag;
    stop();
    if (!ghost) return;
    dragged = true;
    ghost.remove();
    btn.classList.remove("lifted");
    const target = e.type === "pointerup" && document.elementFromPoint(e.clientX, e.clientY)?.closest(".sq");
    if (target && board.contains(target) && Number(target.dataset.sq) !== from) drop(Number(target.dataset.sq));
  }
  function stop() {
    drag = null;
    removeEventListener("pointermove", onPointerMove);
    removeEventListener("pointerup", endDrag);
    removeEventListener("pointercancel", endDrag);
  }
  return stop;
}
