// Dots and Boxes' tutorial: its lessons (lessons.js) on the game's own paper
// and pencil lines (art.js, style.css), every move checked by rules.js. The
// adapter engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { newState, applyMove, geometry, lineEnds } from "./rules.js";
import { U, s, buildBoard, halfGrid, stepCursor, stroke, lineName, lineArt, boxArt } from "./art.js";

export { lessons } from "./lessons.js";
export const flavour = "paper";

const N = 3;
const INITIAL = ["Y", "T"]; // you, teal

// A position is the 3 × 3 board drawn in 7 rows: dots ".", drawn lines "-"
// and "|", and in each box "Y" (yours), "T" (teal's) or " ". The learner,
// coral, draws next. Lines drawn before take turns between the colours.
export function load(rows) {
  const state = newState(0, { size: N, moveSeconds: 0, gameSeconds: 0 });
  let k = 0;
  state.lines.forEach((_, l) => {
    const [r, c] = halfGrid(N, l);
    if (rows[r][c] !== " ") state.lines[l] = k++ % 2;
  });
  state.drawn = k;
  state.boxes.forEach((_, b) => {
    const owner = INITIAL.indexOf(rows[2 * Math.floor(b / N) + 1][2 * (b % N) + 1]);
    state.boxes[b] = owner;
    if (owner !== -1) state.score[owner] += 1;
  });
  return state;
}
export const play = (state, move) => applyMove(state, state.turn, move);
export const cells = (move) => [move.line];

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const cls = (player) => `p${player}`; // yours --mine (coral here), teal's --theirs

// The band around line l, for the focus ring and the lit lines.
function around(l) {
  const e = lineEnds(N, l);
  const [x, y] = [e.c1 * U, e.r1 * U];
  return e.horizontal ? { x: x - 4, y: y - 17, width: U + 8, height: 34 } : { x: x - 17, y: y - 4, width: 34, height: U + 8 };
}

// Tap a line, or move along the lines with the arrow keys and press Enter.
export function board() {
  let state = null;
  let moveFn = () => {};
  let hover = null;
  let cursor = 0;
  let keyboard = false;
  const art = buildBoard(N);
  const { svg } = art;
  svg.classList.add("armed");
  svg.setAttribute("aria-label", "Dots and Boxes board, 3 by 3 boxes. Arrow keys pick a line, Enter draws it.");
  // A band under each line, lit up by the lessons.
  const bands = Array.from({ length: geometry(N).lines }, (_, l) => s("rect", { class: "band", rx: 17, ...around(l) }));
  art.lines.before(s("g", { class: "bands" }, bands));
  const cursorText = el("p", { class: "db-sr", "aria-live": "polite" });
  const node = el("div", { class: "dots-boxes", dataset: { you: "a" } }, el("div", { class: "db-board-wrap" }, svg), cursorText);
  node.style.setProperty("--db-n", N);

  const lineAt = (target) => {
    const hit = target?.closest?.("[data-line]");
    return hit ? Number(hit.dataset.line) : null;
  };
  // The free line under the pointer (or the keyboard cursor), sketched in faintly.
  function preview() {
    const focused = keyboard && document.activeElement === svg;
    const l = focused ? cursor : hover;
    const show = l != null && state?.lines[l] === -1;
    art.preview.setAttribute("visibility", show ? "visible" : "hidden");
    if (show) {
      art.preview.setAttribute("d", stroke(N, l).d);
      art.preview.setAttribute("class", "preview p0");
    }
    art.focus.setAttribute("visibility", focused ? "visible" : "hidden");
    if (focused) for (const [k, v] of Object.entries(around(cursor))) art.focus.setAttribute(k, v);
  }
  const announce = () => (cursorText.textContent = `${lineName(N, cursor)}: ${state.lines[cursor] === -1 ? "free" : "drawn"}`);

  svg.addEventListener("pointermove", (e) => ((hover = lineAt(e.target)), preview()));
  svg.addEventListener("pointerdown", () => (keyboard = false));
  svg.addEventListener("pointerleave", () => ((hover = null), preview()));
  svg.addEventListener("click", (e) => {
    const l = lineAt(e.target);
    if (l === null) return;
    cursor = l;
    moveFn({ line: l });
  });
  svg.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!step && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    keyboard = true;
    if (step) {
      cursor = stepCursor(N, cursor, ...step);
      announce();
    } else moveFn({ line: cursor });
    preview();
  });
  svg.addEventListener("keyup", (e) => e.key === "Tab" && ((keyboard = true), announce(), preview()));
  svg.addEventListener("blur", preview);

  return {
    node,
    cell: (l) => bands[l],
    onMove: (fn) => (moveFn = fn),
    render(st) {
      state = st;
      art.lines.replaceChildren(
        ...st.lines.flatMap((p, l) => {
          if (p === -1) return [];
          const line = lineArt(N, l, cls(p));
          // Teal's latest line is marked until you draw.
          if (st.last?.line === l && p === 1) line.classList.add("fresh");
          return [line];
        }),
      );
      art.boxes.replaceChildren(...st.boxes.flatMap((p, b) => (p === -1 ? [] : [boxArt(N, b, cls(p), INITIAL[p]).node])));
      preview();
    },
    // The line is pencilled in faintly, then fades away.
    reject({ line }) {
      if (reducedMotion() || state.lines[line] !== -1) return;
      const ghost = lineArt(N, line, cls(0));
      art.lines.append(ghost);
      ghost
        .animate([{ opacity: 0.8 }, { opacity: 0.8, offset: 0.4 }, { opacity: 0 }], { duration: 600, easing: "ease-in" })
        .finished.catch(() => {})
        .finally(() => ghost.remove());
    },
  };
}
