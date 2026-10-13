// Backgammon's tutorial: its lessons (lessons.js) on the game's own board,
// checkers and dice (art.js, style.css), with its motion and sounds
// (motion.js, sounds.js), every move checked by rules.js. The adapter
// engine/tutorial.js asks for.
import { el, toast } from "../engine/shell.js";
import { newState, applyMove, applyStep, legalSteps, clonePos, BAR, OFF } from "./rules.js";
import { boardCells, arrowTarget, drawBoard, rollDice, rollText } from "./art.js";
import { motion, MY_PACE, DROP_PACE } from "./motion.js";
import { play as sound } from "./sounds.js";

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

// As in the game: tap a checker, then where it goes (the tray to bear off),
// or drag it there. Each step flies and sounds as in the game; Undo takes
// one back and Confirm sends the play, its steps from the farthest point in.
// Only a checker that can move can be picked, with the game's notices; a
// landing the rules refuse goes to the tutorial at once, so it can say why.
export function board() {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let state = null;
  let stage = null; // the play so far: { pos, dice, steps }
  let selected = null;
  let moveFn = () => {};
  let rollId = 0; // bumps on every new roll, so its dice tumble once
  let diceSig = "";
  const landing = new Set(); // steps still in the air
  const grid = el("div", { class: "bg-board", role: "group", "aria-label": "Board" });
  const cells = boardCells(grid);
  const dice = el("div", { class: "bg-dice", "aria-label": "Dice" });
  const undoBtn = el("button", { class: "btn small", type: "button", onclick: () => undo() }, "Undo");
  const confirmBtn = el("button", { class: "btn primary small", type: "button", onclick: () => confirm() }, "Confirm");
  const node = el(
    "div",
    { class: "backgammon", dataset: { you: "a" } },
    el("div", { class: "bg-board-wrap" }, grid),
    el("div", { class: "bg-turn" }, dice, el("div", { class: "bg-turn-actions" }, undoBtn, confirmBtn)),
  );

  const legal = () => (stage ? legalSteps(stage.pos, 0, stage.dice) : []);
  const motions = motion(grid, cells, { still, render: draw });
  const drag = motions.drags({
    steps: legal,
    tap: pick,
    lift: (from) => {
      selected = from;
      draw();
    },
    drop: stepTo,
    miss: land,
  });

  function pick(n) {
    if (!stage) return;
    const steps = legal();
    if (!steps.length) return toast("Press Confirm to end your turn, or Undo");
    if (selected !== null) {
      const there = steps.filter((s) => s.from === selected && s.to === n).sort((a, b) => a.die - b.die);
      if (there.length) return stepTo(there[0]);
      if (n === selected) {
        selected = null;
        return draw();
      }
    }
    if (steps.some((s) => s.from === n)) {
      selected = n;
      return draw();
    }
    if (selected !== null) return land(selected, n);
    toast(stage.pos[0][BAR] && n !== BAR ? "Bring your checker on the bar back in first" : "No checker of yours can move from there");
  }

  // A landing the rules refuse: the play so far and that step.
  function land(from, n) {
    moveFn({ type: "play", steps: [...stage.steps.map((s) => [s.from, s.die]), [from, n === OFF ? from : from - n]] });
  }

  function applyStaged(step) {
    const done = applyStep(stage.pos, 0, step.from, step.die);
    stage.steps.push(done);
    stage.dice.splice(stage.dice.indexOf(step.die), 1);
    return done;
  }

  function restage() {
    stage = { pos: clonePos(state.pos), dice: state.dice.slice(), steps: [] };
    selected = null;
  }

  function stepTo(step, drop) {
    const flight = motions.moveOnScreen("mine", step.from, step.to, () => {
      const done = applyStaged(step);
      // Keep the moved checker picked when it can go on.
      const next = legal();
      selected = done.to !== OFF && next.some((s) => s.from === done.to) ? done.to : null;
      if (next.length && next.every((s) => s.from === next[0].from)) selected = next[0].from;
      return done;
    }, drop ? DROP_PACE : MY_PACE, drop);
    landing.add(flight);
    flight.finally(() => landing.delete(flight));
  }

  function undo() {
    const last = stage?.steps.at(-1);
    if (!last) return;
    const keep = stage.steps.slice(0, -1);
    motions.takeBack(last, () => {
      restage();
      for (const s of keep) applyStaged(s);
    });
  }

  function confirm() {
    if (!stage?.steps.length || legal().length) return;
    selected = null;
    moveFn({ type: "play", steps: stage.steps.map((s) => [s.from, s.die]).sort((a, b) => b[0] - a[0] || b[1] - a[1]) });
  }

  // Arrow keys move around the board; Enter or Space picks (native button); Escape lets go.
  grid.addEventListener("keydown", (e) => {
    const cell = e.target.closest("button[data-n]");
    if (!cell) return;
    if (e.key === "Escape" && selected !== null) {
      selected = null;
      return draw();
    }
    const next = arrowTarget(cells, cell, e.key);
    if (next === undefined) return;
    e.preventDefault();
    next?.focus();
  });

  function draw() {
    const steps = legal();
    const sources = new Set(steps.map((s) => s.from));
    const dests = new Set(steps.filter((s) => s.from === selected).map((s) => s.to));
    drawBoard(grid, cells, stage?.pos ?? state.pos, 0, { hidden: motions.hidden, sources, dests, selected, held: drag.held(), marks: null, oppName: "teal" });
    undoBtn.hidden = confirmBtn.hidden = !stage;
    undoBtn.disabled = !stage?.steps.length;
    confirmBtn.disabled = !stage?.steps.length || steps.length > 0;
    drawDice();
  }

  // The dice already played this turn are greyed out; a new roll tumbles in.
  function drawDice() {
    const current = state.rolled;
    const roll = current ? state.roll : (state.last?.roll ?? []);
    const faces = roll[0] === roll[1] ? roll.concat(roll) : roll;
    const left = stage ? stage.dice.slice() : [];
    const classes = faces.map((v) => {
      const i = left.indexOf(v);
      if (i >= 0) left.splice(i, 1);
      return `mine ${i < 0 ? "used" : ""} ${current ? "" : "old"} ${faces.length > 2 ? "small" : ""}`;
    });
    const sig = `${rollId}|${faces}|${classes}`;
    if (sig === diceSig) return;
    const tumble = current && !still && !diceSig.startsWith(`${rollId}|`);
    diceSig = sig;
    dice.replaceChildren(...rollDice(faces, classes, tumble));
    dice.setAttribute("aria-label", `Your ${current ? "" : "last "}roll: ${rollText(roll)}`);
  }

  return {
    node,
    cell: (c) => cells.get(c),
    onMove: (fn) => (moveFn = fn),
    // A step's new roll lands with the game's dice sound; the play itself
    // has already flown, so a played move only waits for its last landing.
    render(st, played) {
      if (st !== state && st.rolled) {
        rollId++;
        sound("dice");
      }
      state = st;
      if (st.turn === 0 && st.rolled) restage();
      else stage = selected = null;
      if (!played) motions.hidden.clear();
      draw();
      return played && Promise.all(landing);
    },
    // The first checker flies to where the play ended and springs back home.
    reject({ steps }) {
      const [from, die] = steps.at(-1);
      const start = cells.get(steps[0][0]);
      const end = cells.get(Math.max(from - die, OFF));
      const checker = [...start.querySelectorAll(".checker")].at(-1);
      if (still || !checker || !end) return;
      const a = end.getBoundingClientRect();
      const b = checker.getBoundingClientRect();
      checker.animate([{ transform: `translate(${a.left + a.width / 2 - b.left - b.width / 2}px, ${a.top + a.height / 2 - b.top - b.height / 2}px)` }, { transform: "none" }], {
        duration: 320,
        easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      });
    },
  };
}
