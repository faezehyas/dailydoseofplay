// Ludo's tutorial: its lessons (lessons.js) on the game's own board, tokens
// and die (art.js, style.css), every move checked by rules.js. The adapter
// engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { newState, applyMove, legalMoves, colorsFor, square, COLORS, YARD, HOME, LAST_LOOP, TOKENS } from "./rules.js";
import { s, r1, U, SIZE, rotator, spotOf, pawnArt, pawnDefs, boardArt, dieFace } from "./art.js";

export { lessons } from "./lessons.js";
export const flavour = "wood";

// A position is { mine, theirs, die } (see lessons.js): a two-player game,
// red against yellow, with the room's default rules. The learner is player
// 0, and rules.js rolls the step's die for them.
export function load({ mine, theirs, die }) {
  const state = newState(0, undefined, 2);
  state.tokens = [[...mine], [...theirs]];
  applyMove(state, 0, { type: "roll" }, () => (die - 0.5) / 6);
  return state;
}
export const play = (state, move) => applyMove(state, state.turn, move);
export const cells = (move) => [`t${move.token}`];

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const FOOT = 0.3 * U; // a token stands this far below its square's centre
const colors = colorsFor(2);
const rot = rotator(3); // red's yard bottom left, as in the game

// Where token t of player p stands, drawn as in the game; two tokens on one square stand side by side.
function spot(tokens, p, t) {
  const r = tokens[p][t];
  const base = rot(spotOf(colors[p], r, t));
  if (r === HOME) return { x: base.x, y: base.y + FOOT * 0.45, scale: 0.5 };
  if (r === YARD) return { x: base.x, y: base.y + FOOT * 0.8, scale: 1.08 };
  const key = (q, r2) => (r2 === YARD || r2 === HOME ? null : r2 > LAST_LOOP ? `h${q}-${r2}` : `l${square(colors[q], r2)}`);
  const crowd = [];
  tokens.forEach((list, q) => list.forEach((r2, t2) => key(q, r2) === key(p, r) && crowd.push(`${q}-${t2}`)));
  if (crowd.length < 2) return { x: base.x, y: base.y + FOOT, scale: 1 };
  const k = crowd.indexOf(`${p}-${t}`) / (crowd.length - 1);
  return { x: base.x + (k - 0.5) * 0.44 * U, y: base.y + FOOT, scale: 0.8 };
}

// Tap a token, or Tab to one and press Enter or Space; any of yours can be
// tried, and the rules say why one can't move.
export function board() {
  let state = null;
  let moveFn = () => {};
  const svg = s("svg", { class: "ld-board", viewBox: `-10 -10 ${SIZE + 20} ${SIZE + 20}`, role: "group", "aria-label": "Ludo board" });
  svg.append(pawnDefs(), boardArt(["You", null, "Yellow", null], 3));
  const pawnLayer = s("g", { class: "pawns" });
  const rings = s("g", { class: "rings", "aria-hidden": "true" });
  const hits = s("g", { class: "hits" });
  svg.append(pawnLayer, rings, hits);
  const pawns = [0, 1].map((p) => Array.from({ length: TOKENS }, (_, t) => pawnArt(colors[p], `${p}-${t}`)));
  const face = el("span", { class: "face" });
  const die = el("div", { class: "ld-die", role: "img", dataset: { color: COLORS[colors[0]] } }, face);
  const node = el(
    "div",
    { class: "ludo" },
    el("div", { class: "ld-main" }, el("div", { class: "ld-board-wrap" }, svg), el("div", { class: "ld-side" }, el("div", { class: "ld-die-panel" }, die))),
  );

  // A ring round each lit token or square, kept where it stands now.
  const ringOf = new Map();
  function cell(c) {
    let at;
    if (typeof c === "number") at = { ...rot(spotOf(colors[0], c, 0)), scale: 1 };
    else {
      at = spot(state.tokens, c[0] === "t" ? 0 : 1, Number(c[1]));
      at = { ...at, y: at.y - 14 * at.scale };
    }
    if (!ringOf.has(c)) {
      ringOf.set(c, s("circle", { class: "tut-ring" }));
      rings.append(ringOf.get(c));
    }
    const ring = ringOf.get(c);
    ring.setAttribute("cx", r1(at.x));
    ring.setAttribute("cy", r1(at.y));
    ring.setAttribute("r", r1(U * 0.55 * at.scale));
    return ring;
  }

  hits.addEventListener("click", (e) => {
    const target = e.target.closest("[data-token]");
    if (target) moveFn({ type: "move", token: Number(target.dataset.token) });
  });
  hits.addEventListener("keydown", (e) => {
    const target = e.target.closest("[data-token]");
    if (!target || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    moveFn({ type: "move", token: Number(target.dataset.token) });
  });

  return {
    node,
    cell,
    onMove: (fn) => (moveFn = fn),
    render(st) {
      state = st;
      const movable = new Set(st.rolled && st.turn === 0 ? legalMoves(st, 0).map((mv) => mv.token) : []);
      const all = [];
      for (const p of [0, 1]) for (let t = 0; t < TOKENS; t++) all.push({ p, t, at: spot(st.tokens, p, t) });
      all.sort((a, b) => a.at.y - b.at.y);
      for (const { p, t, at } of all) {
        const { g } = pawns[p][t];
        g.setAttribute("transform", `translate(${r1(at.x)} ${r1(at.y)}) scale(${at.scale.toFixed(3)})`);
        g.classList.toggle("movable", p === 0 && movable.has(t));
        pawnLayer.append(g);
      }
      // Every token of yours not yet home is a tap target.
      hits.replaceChildren(
        ...st.tokens[0].flatMap((r, t) => {
          if (r === HOME) return [];
          const at = spot(st.tokens, 0, t);
          const where = r === YARD ? "in the yard" : r > LAST_LOOP ? "in the home column" : `${r} squares from your start`;
          return [s("circle", { class: "hit-token", "data-token": t, cx: r1(at.x), cy: r1(at.y - 14 * at.scale), r: U * 0.62, tabindex: 0, role: "button", "aria-label": `Token ${t + 1}, ${where}` })];
        }),
      );
      const value = st.rolled ? st.die : (st.last?.die ?? 0);
      dieFace(face, value);
      die.classList.toggle("six", value === 6);
      die.setAttribute("aria-label", `Die: ${value}`);
    },
    // A wrong token gives a little shake.
    reject({ token }) {
      if (reducedMotion()) return;
      pawns[0][token]?.lift.animate([{ transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "none" }], { duration: 260, easing: "ease-out" });
    },
  };
}
