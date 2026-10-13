// Ludo's tutorial: its lessons (lessons.js) on the game's own board, tokens,
// die, motion and sounds (art.js, board-view.js, sounds.js, style.css), every
// move checked by rules.js. The adapter engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { newState, applyMove, legalMoves, colorsFor, COLORS, YARD, HOME, LAST_LOOP, TOKENS } from "./rules.js";
import { s, r1, U, SIZE, rotator, spotOf, pawnArt, pawnDefs, boardArt, dieFace } from "./art.js";
import { boardMotion, rollingDie, drawChoices, tokenTarget, wireTargets, moveLabel } from "./board-view.js";
import { play as sound } from "./sounds.js";

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

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const colors = colorsFor(2);
const colorOf = (p) => colors[p];
const rot = rotator(3); // red's yard bottom left, as in the game

// Played as in the game: Roll (the button, the die or R) lands on the step's
// roll, then tap a token or where it lands, press its number, or Tab or the
// arrow keys to it and press Enter or Space. Any token of yours can be tried,
// and the rules say why one can't move. A single legal move isn't played for
// you: the step asks for it.
export function board() {
  let state = null;
  let drawn = null; // the state of the step's static draw
  let shown = [[], []]; // tokens as drawn
  let rolled = false; // the step's die has landed
  let rolling = false;
  let refocus = false; // the last move came from the board: the die takes focus next
  let focusToken = null;
  let restoring = false;
  let gen = 0;
  let moveFn = () => {};
  const svg = s("svg", { class: "ld-board", viewBox: `-10 -10 ${SIZE + 20} ${SIZE + 20}`, role: "group", "aria-label": "Ludo board" });
  svg.append(pawnDefs(), boardArt(["You", null, "Yellow", null], 3));
  const marks = s("g", { class: "marks" });
  const pawnLayer = s("g", { class: "pawns" });
  const fx = s("g", { class: "fx", "aria-hidden": "true" });
  const rings = s("g", { class: "rings", "aria-hidden": "true" });
  const hits = s("g", { class: "hits" });
  svg.append(marks, pawnLayer, fx, rings, hits);
  const pawns = [0, 1].map((p) => Array.from({ length: TOKENS }, (_, t) => pawnArt(colors[p], `${p}-${t}`)));
  const face = el("span", { class: "face" });
  const die = el("button", { class: "ld-die", type: "button", "aria-label": "Roll the die", dataset: { color: COLORS[colors[0]] }, onclick: () => roll() }, face);
  const rollBtn = el("button", { class: "btn primary big ld-roll", type: "button", onclick: () => roll() }, "Roll");
  const hint = el("p", { class: "ld-hint" });
  const node = el(
    "div",
    { class: "ludo" },
    el("div", { class: "ld-main" }, el("div", { class: "ld-board-wrap" }, svg), el("div", { class: "ld-side" }, el("div", { class: "ld-die-panel" }, die, el("div", { class: "ld-die-actions" }, rollBtn, hint)))),
  );

  const live = (g) => g === gen && node.isConnected;
  const fast = () => still() || document.hidden;
  const motion = boardMotion({ pawns, pawnLayer, fx, rot, colorOf, tokens: () => shown, live, fast });
  const dice = rollingDie({ die, face, colorOf, live, fast });
  const canRoll = () => !!state && state.turn === 0 && state.rolled && !rolled && !rolling;
  const choices = () => (rolled ? legalMoves(state, 0) : []);

  // A ring round each lit token or square, kept where it stands now.
  const ringOf = new Map();
  function cell(c) {
    let at;
    if (typeof c === "number") at = { ...rot(spotOf(colors[0], c, 0)), scale: 1 };
    else {
      at = motion.spot(c[0] === "t" ? 0 : 1, Number(c[1]), state.tokens);
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

  // The game's marks for a choice: landing discs, the focused token's path,
  // and every token of yours not yet home as a tap target.
  function renderChoices() {
    const had = hits.contains(document.activeElement) ? document.activeElement.dataset.token : null;
    marks.replaceChildren();
    hits.replaceChildren();
    for (const side of pawns) for (const pw of side) pw.g.classList.remove("movable", "focus");
    if (!rolled) return;
    const list = choices();
    if (focusToken !== null && !list.some((mv) => mv.token === focusToken)) focusToken = null;
    const focus = focusToken === null ? null : list.find((mv) => mv.token === focusToken);
    drawChoices({ marks, hits, mine: pawns[0], color: colors[0], rot, list, focus });
    shown[0].forEach((r, t) => {
      if (r === HOME) return;
      const mv = list.find((m) => m.token === t);
      const where = r === YARD ? "in the yard" : r > LAST_LOOP ? "in the home column" : `${r} squares from your start`;
      hits.append(tokenTarget(pawns[0][t], t, mv ? moveLabel(mv, state.die, "Yellow") : `Token ${t + 1}, ${where}`));
    });
    const back = had !== null && hits.querySelector(`.hit-token[data-token="${had}"]`);
    if (back) {
      restoring = true;
      back.focus({ preventScroll: true });
      restoring = false;
    }
  }

  function update() {
    const can = canRoll();
    rollBtn.disabled = die.disabled = !can;
    rollBtn.classList.toggle("attention", can);
    die.classList.toggle("armed", can);
    rollBtn.textContent = rolling ? "Rolling…" : "Roll";
    renderChoices();
    hint.textContent = rolled ? "Tap a glowing token, or where it lands." : "";
  }

  async function roll() {
    if (!canRoll()) return;
    const g = gen;
    const keys = document.activeElement === die || document.activeElement === rollBtn;
    rolling = true;
    update();
    await dice.land(state.die, 0, g, 1);
    if (!live(g)) return;
    rolling = false;
    rolled = true;
    update();
    if (keys) hits.querySelector(`.hit-token[data-token="${choices()[0]?.token}"]`)?.focus({ preventScroll: true });
  }

  const pick = (t) => rolled && moveFn({ type: "move", token: t });
  wireTargets(hits, {
    pick,
    show: (t) => {
      if (restoring || t === focusToken) return;
      focusToken = t;
      renderChoices();
    },
  });
  // Keys 1–4 pick your tokens; R rolls.
  addEventListener("keydown", (e) => {
    if (!node.isConnected || e.target.closest?.("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-4]$/.test(e.key)) pick(Number(e.key) - 1);
    else if (e.key === "r" || e.key === "R") roll();
  });

  // The learner's move hops along as in the game, with its sounds.
  async function playOut(played, g) {
    for (const ev of played) {
      if (!(await motion.move(ev, g, 1, 0))) return;
      if (ev.again) sound("again");
      await motion.settle(g);
    }
  }

  return {
    node,
    cell,
    onMove: (fn) => (moveFn = fn),
    render(st, played) {
      const g = ++gen;
      state = st;
      if (played) {
        rolled = false;
        refocus = hits.contains(document.activeElement);
        update();
        return playOut(played, g);
      }
      // A new step: the die waits to be rolled.
      if (st !== drawn) {
        drawn = st;
        rolled = rolling = false;
        focusToken = null;
        dice.stopTumble();
        dieFace(face, 0);
        die.classList.remove("landed", "six");
      }
      shown = st.tokens.map((side) => side.slice());
      motion.placePawns();
      update();
      if (refocus && document.activeElement === document.body) die.focus({ preventScroll: true });
      refocus = false;
    },
    // A wrong token gives a little shake.
    reject({ token }) {
      if (still()) return;
      pawns[0][token]?.lift.animate([{ transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "none" }], { duration: 260, easing: "ease-out" });
    },
  };
}
