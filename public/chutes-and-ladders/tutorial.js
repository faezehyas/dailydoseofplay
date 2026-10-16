// Chutes and Ladders' tutorial: its lessons (lessons.js) on the game's own
// board, spinner, motion and sounds (art.js, sounds.js, style.css), every
// spin played by rules.js with the step's fixed number. The adapter
// engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { newState, applyMove, LAST } from "./rules.js";
import { play as sound } from "./sounds.js";
import { s, U, center, buildBoard, spinnerArt, makeSpinner, pawnMotion } from "./art.js";

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
// Reaching the last square lights it up, as at the game's win.
export const result = (state) => (state.winner === 0 ? [LAST] : []);

// Tap Spin, or the spinner; the spin plays out as in the game.
export function board() {
  let moveFn = () => {};
  let gen = 0; // bumps on every render, so an old spin stops
  const shown = [0]; // the square the pawn is drawn on
  const art = buildBoard(1);
  const [pawn] = art.pawns;
  const { svg: dialArt, arrow } = spinnerArt();
  const value = el("div", { class: "cl-spin-value", dataset: { who: "p0" } });
  const spin = () => !spinBtn.disabled && moveFn({ type: "spin" });
  const dial = el("div", { class: "cl-dial", dataset: { who: "p0" }, onclick: spin }, dialArt, value);
  const spinBtn = el("button", { class: "btn primary big cl-spin-btn", type: "button", onclick: spin }, "Spin");
  const node = el(
    "div",
    { class: "chutes-ladders" },
    el("div", { class: "cl-main" }, el("div", { class: "cl-board-wrap" }, art.svg), el("div", { class: "cl-side" }, el("div", { class: "cl-spin-panel" }, dial, spinBtn))),
  );
  const spinner = makeSpinner(arrow, () => node.isConnected, sound);
  const live = (g) => g === gen && node.isConnected;
  const motion = pawnMotion(art, { seats: [0], shown: () => shown, me: 0, live, play: sound, spinner, value });
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

  // Your turn: Spin and the dial are armed and your pawn bobs.
  function ready(on) {
    spinBtn.disabled = !on;
    spinBtn.classList.toggle("attention", on);
    dial.classList.toggle("armed", on);
    pawn.g.classList.toggle("waiting", on);
  }

  return {
    node,
    cell,
    onMove: (fn) => (moveFn = fn),
    render(st, played) {
      gen += 1;
      spinner.stop();
      art.svg.setAttribute("aria-label", `Chutes and Ladders board. You are ${st.pos[0] ? `on square ${st.pos[0]}` : "at the start"}.`);
      const ev = played?.find((e) => e.type === "spin");
      if (!ev) {
        shown[0] = st.pos[0];
        motion.place();
        motion.mark(st.last?.to, "last-p0");
        value.textContent = st.last ? String(st.last.spin) : "";
        return ready(st.winner === -1);
      }
      ready(false);
      return motion.spin(ev, gen, 1, () => {});
    },
    // A spin is never wrong: nothing springs back.
    reject() {},
  };
}
