// Chutes and Ladders' tutorial: its lessons (lessons.js) on the game's own
// board and spinner (art.js, style.css), every spin played by rules.js with
// the step's fixed number. The adapter engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { newState, applyMove } from "./rules.js";
import { s, r1, U, PAWN_SCALE, WEDGE, center, spot, buildBoard, spinnerArt } from "./art.js";

export { lessons } from "./lessons.js";
export const flavour = "bell";

// A position is your pawn's square. You play alone, with the room's default rules.
export function load(square) {
  const state = newState(0, {}, 1);
  state.pos[0] = square;
  return state;
}
// The spinner stops on the step's number.
export const play = (state, move, step) => applyMove(state, state.turn, move, () => (step.spin - 0.5) / 6);
export const cells = () => ["spin"];

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const GLIDE_MS = 420; // each leg of a move: the hops, then the ladder or chute

// Tap Spin, or the spinner; the pawn glides to where the spin takes it.
export function board() {
  let moveFn = () => {};
  let shown = null; // the square the pawn is drawn on
  let frame = 0;
  const art = buildBoard(1);
  const [pawn] = art.pawns;
  const { svg: dialArt, arrow } = spinnerArt();
  const value = el("div", { class: "cl-spin-value", dataset: { who: "p0" } });
  const spin = () => moveFn({ type: "spin" });
  const dial = el("div", { class: "cl-dial armed", dataset: { who: "p0" }, onclick: spin }, dialArt, value);
  const spinBtn = el("button", { class: "btn primary big cl-spin-btn", type: "button", onclick: spin }, "Spin");
  const node = el(
    "div",
    { class: "chutes-ladders" },
    el("div", { class: "cl-main" }, el("div", { class: "cl-board-wrap" }, art.svg), el("div", { class: "cl-side" }, el("div", { class: "cl-spin-panel" }, dial, spinBtn))),
  );
  // A ring inside each lit square, made when a lesson first lights it.
  const rings = new Map();
  function cell(c) {
    if (c === "spin") return spinBtn;
    if (!rings.has(c)) {
      const { x, y } = center(c);
      rings.set(c, s("rect", { class: "tut-ring", x: x - U / 2 + 4, y: y - U / 2 + 4, width: U - 8, height: U - 8, rx: 12 }));
      art.marks.append(rings.get(c));
    }
    return rings.get(c);
  }

  const put = ({ x, y }) => {
    pawn.g.setAttribute("transform", `translate(${r1(x)} ${r1(y)})`);
    pawn.fig.setAttribute("transform", `scale(${PAWN_SCALE})`);
  };
  // Glides through each square in turn, a leg at a time.
  function glide(squares) {
    const legs = squares.map((n) => spot(n, 0));
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(legs.length - 1, Math.max(0, (now - t0) / GLIDE_MS));
      const k = Math.min(Math.floor(t), legs.length - 2);
      const [a, b] = [legs[k], legs[k + 1]];
      const e = (t - k) * (2 - (t - k));
      put({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e });
      if (t < legs.length - 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  return {
    node,
    cell,
    onMove: (fn) => (moveFn = fn),
    render(st) {
      cancelAnimationFrame(frame);
      const last = st.last;
      const to = st.pos[0];
      if (last && last.from === shown && to !== shown && !reducedMotion()) glide([shown, last.landed, to].filter((n, k, all) => k === 0 || n !== all[k - 1]));
      else put(spot(to, 0));
      shown = to;
      value.textContent = last ? String(last.spin) : "";
      arrow.setAttribute("transform", `rotate(${last ? (last.spin - 1) * WEDGE : 0})`);
      pawn.g.classList.toggle("waiting", st.winner === -1);
      art.svg.setAttribute("aria-label", `Chutes and Ladders board. You are ${to ? `on square ${to}` : "at the start"}.`);
    },
    // A spin is never wrong: nothing springs back.
    reject() {},
  };
}
