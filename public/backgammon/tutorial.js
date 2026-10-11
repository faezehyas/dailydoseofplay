// Backgammon's tutorial: its lessons (lessons.js) on the game's own board,
// checkers and dice (art.js, style.css), every move checked by rules.js. The
// adapter engine/tutorial.js asks for.
import { el } from "../engine/shell.js";
import { newState, applyMove, applyStep, legalSteps, clonePos, BAR, OFF } from "./rules.js";
import { STACK, dieFace, checkerStack, trayStack, boardCells, arrowTarget } from "./art.js";

export { lessons } from "./lessons.js";
export const flavour = "wood";

// A position is { mine, theirs, roll } (see lessons.js). The learner is
// player 0, and rules.js rolls the step's dice for them.
export function load({ mine, theirs, roll }) {
  const state = newState(0);
  state.pos = [Array(26).fill(0), Array(26).fill(0)];
  for (const [n, k] of Object.entries(mine)) state.pos[0][n] = k;
  for (const [n, k] of Object.entries(theirs)) state.pos[1][25 - n] = k;
  const dice = [...roll];
  applyMove(state, 0, { type: "roll" }, () => (dice.shift() - 0.5) / 6);
  return state;
}
export const play = (state, move) => applyMove(state, state.turn, move);
export const cells = (move) => move.steps.flatMap(([from, die]) => [from, Math.max(from - die, OFF)]);

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Tap a checker, then the point it goes to (the tray to bear off); the
// moved checker stays picked while it can go on. Once every die is played,
// the play goes to the tutorial, its steps from the farthest point in. A
// landing the rules refuse goes at once, so they can say why.
export function board() {
  let state = null;
  let stage = null; // the play so far: { pos, dice, steps }
  let selected = null;
  let moveFn = () => {};
  const grid = el("div", { class: "bg-board", role: "group", "aria-label": "Board" });
  const cells = boardCells(grid);
  const dice = el("div", { class: "bg-dice", "aria-label": "Dice" });
  const node = el("div", { class: "backgammon", dataset: { you: "a" } }, el("div", { class: "bg-board-wrap" }, grid), el("div", { class: "bg-turn" }, dice));

  const legal = () => (stage ? legalSteps(stage.pos, 0, stage.dice) : []);
  const own = (n) => n !== OFF && stage.pos[0][n] > 0;

  function pick(n) {
    if (!stage) return;
    if (selected === null || n === selected) {
      selected = selected === null && own(n) ? n : null;
      return draw();
    }
    const there = legal()
      .filter((s) => s.from === selected && s.to === n)
      .sort((a, b) => a.die - b.die);
    if (there.length) return stepTo(there[0]);
    if (own(n)) {
      selected = n;
      return draw();
    }
    moveFn({ type: "play", steps: [...stage.steps, [selected, n === OFF ? selected : selected - n]] });
  }

  function stepTo(step) {
    applyStep(stage.pos, 0, step.from, step.die);
    stage.steps.push([step.from, step.die]);
    stage.dice.splice(stage.dice.indexOf(step.die), 1);
    const next = legal();
    selected = next.some((s) => s.from === step.to) ? step.to : null;
    if (next.length) return draw();
    moveFn({ type: "play", steps: [...stage.steps].sort((a, b) => b[0] - a[0] || b[1] - a[1]) });
  }

  grid.addEventListener("click", (e) => {
    const cell = e.target.closest("button[data-n]");
    if (cell) pick(Number(cell.dataset.n));
  });
  // Arrow keys move around the board; Enter or Space picks (native button); Escape lets go.
  grid.addEventListener("keydown", (e) => {
    const cell = e.target.closest("button[data-n]");
    if (!cell) return;
    if (e.key === "Escape") {
      selected = null;
      return draw();
    }
    const next = arrowTarget(cells, cell, e.key);
    if (next === undefined) return;
    e.preventDefault();
    next?.focus();
  });

  function draw() {
    const pos = stage?.pos ?? state.pos;
    const steps = legal();
    const sources = new Set(steps.map((s) => s.from));
    const dests = new Set(steps.filter((s) => s.from === selected).map((s) => s.to));
    for (const [key, cell] of cells) {
      let label;
      if (key === "bar-top" || key === "off-top") {
        const n = pos[1][key === "bar-top" ? BAR : OFF];
        cell.replaceChildren(...(key === "bar-top" ? checkerStack(n, "theirs") : trayStack(n, "theirs")));
      } else if (key === BAR) {
        const n = pos[0][BAR];
        cell.replaceChildren(...checkerStack(n, "mine"));
        label = n ? `Your bar: ${n} checker${n > 1 ? "s" : ""}` : "Your bar: empty";
      } else if (key === OFF) {
        cell.replaceChildren(...trayStack(pos[0][OFF], "mine"));
        label = `Borne off: ${pos[0][OFF]} of yours`;
      } else {
        const mine = pos[0][key];
        const theirs = pos[1][25 - key];
        cell.replaceChildren(...(mine ? checkerStack(mine, "mine") : checkerStack(theirs, "theirs")));
        label = `Point ${key}: ${mine ? `${mine} of yours` : theirs ? `${theirs} of teal's` : "empty"}`;
      }
      const items = cell.querySelectorAll(".checker, .slab");
      const top = items[items.length - 1];
      top?.classList.add("top");
      // Where a picked checker would land: the next free spot, or around a
      // full stack's top checker, or around the blot it would hit.
      if (dests.has(key) && cell.classList.contains("point")) {
        if (top?.classList.contains("theirs") || items.length >= STACK) top.classList.add("target");
        else cell.append(el("span", { class: "slot", "aria-hidden": "true" }));
      }
      cell.classList.toggle("src", sources.has(key));
      cell.classList.toggle("selected", selected === key);
      cell.classList.toggle("dest", dests.has(key));
      if (cell.tagName === "BUTTON") {
        if (dests.has(key)) label += key === OFF ? ", bear off here" : ", move here";
        else if (selected === key) label += ", picked";
        cell.setAttribute("aria-label", label);
      }
    }
    grid.classList.toggle("armed", sources.size > 0);
    // The dice already played this turn are greyed out.
    const roll = state.rolled ? state.roll : (state.last?.roll ?? []);
    const left = stage ? stage.dice.slice() : [];
    const faces = roll[0] === roll[1] ? roll.concat(roll) : roll;
    dice.replaceChildren(
      ...faces.map((v) => {
        const i = left.indexOf(v);
        if (i >= 0) left.splice(i, 1);
        return dieFace(v, `mine ${i < 0 ? "used" : ""} ${faces.length > 2 ? "small" : ""}`);
      }),
    );
    dice.setAttribute("aria-label", `Your roll: ${roll.join(" and ")}`);
  }

  return {
    node,
    cell: (c) => cells.get(c),
    onMove: (fn) => (moveFn = fn),
    render(st) {
      state = st;
      stage = st.turn === 0 && st.rolled ? { pos: clonePos(st.pos), dice: st.dice.slice(), steps: [] } : null;
      selected = null;
      draw();
    },
    // The first checker flies to where the play ended and springs back home.
    reject({ steps }) {
      const [from, die] = steps.at(-1);
      const start = cells.get(steps[0][0]);
      const end = cells.get(Math.max(from - die, OFF));
      const checker = [...start.querySelectorAll(".checker")].at(-1);
      if (reducedMotion() || !checker || !end) return;
      const a = end.getBoundingClientRect();
      const b = checker.getBoundingClientRect();
      checker.animate([{ transform: `translate(${a.left + a.width / 2 - b.left - b.width / 2}px, ${a.top + a.height / 2 - b.top - b.height / 2}px)` }, { transform: "none" }], {
        duration: 320,
        easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      });
    },
  };
}
