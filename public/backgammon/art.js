// Backgammon's drawing, shared by the game (main.js) and its tutorial
// (tutorial.js): the board's cells, the checker stacks and the dice.
import { el } from "../engine/shell.js";
import { BAR, OFF } from "./rules.js";

export const STACK = 5; // checkers drawn on a point; a taller stack shows its count
// The board from your side: your home board is bottom right, and you move
// from 24 at the top right, along the top, down and along the bottom to 1.
const TOP = [13, 14, 15, 16, 17, 18, "bar-top", 19, 20, 21, 22, 23, 24, "off-top"];
const BOTTOM = [12, 11, 10, 9, 8, 7, BAR, 6, 5, 4, 3, 2, 1, OFF];

// An opponent's point number as the cell key it is drawn in.
export const theirKey = (n) => (n === BAR ? "bar-top" : n === OFF ? "off-top" : 25 - n);

export const rollText = (roll) => (roll[0] === roll[1] ? `double ${roll[0]}s` : `${roll[0]} and ${roll[1]}`);

export function dieFace(value, cls) {
  const spots = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }[value];
  return el("span", { class: `die ${cls}`, role: "img", "aria-label": `${value}${cls.includes("used") ? ", played" : ""}` }, spots.map((s) => el("i", { style: `grid-area: s${s}` })));
}

// A roll's dice faces with their classes; a new roll tumbles in.
export function rollDice(faces, classes, tumble) {
  return faces.map((v, k) => {
    const die = dieFace(v, classes[k] + (tumble ? " tumble" : ""));
    if (tumble) die.style.setProperty("--spin", `${(Math.random() < 0.5 ? -1 : 1) * (200 + Math.random() * 160)}deg`);
    return die;
  });
}

export function checkerStack(count, whose, cls = "") {
  const out = [];
  for (let i = 0; i < Math.min(count, STACK); i++) out.push(el("span", { class: `checker ${whose} ${cls}` }));
  if (count > STACK) out[STACK - 1].append(el("b", {}, String(count)));
  return out;
}

export function trayStack(count, whose) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(el("span", { class: `slab ${whose}` }));
  if (count) out.push(el("b", { class: "tray-count" }, String(count)));
  return out;
}

// Every cell of the board, added to `board` and keyed by your point number
// (BAR, OFF) or "bar-top"/"off-top" for the opponent's.
export function boardCells(board) {
  const cells = new Map();
  for (const [row, keys] of [TOP, BOTTOM].entries()) {
    for (const [col, key] of keys.entries()) {
      const kind = key === BAR || key === "bar-top" ? "bar" : key === OFF || key === "off-top" ? "tray" : "point";
      const mine = typeof key === "number";
      const attrs = { class: `bg-cell ${kind} ${row ? "bottom" : "top"}`, style: `grid-area: ${row ? 3 : 1} / ${col + 1}` };
      if (kind === "point") attrs.class += ` ${key % 2 ? "odd" : "even"}`;
      const cell = mine ? el("button", { ...attrs, type: "button", dataset: { n: key, row, col } }) : el("div", { ...attrs, "aria-hidden": "true" });
      cells.set(key, cell);
      board.append(cell);
    }
  }
  return cells;
}

// Draws `pos` from player `me`'s side. hidden: cell key -> checkers still in
// the air; sources and dests: the cells a checker can move from and, for the
// picked one (`selected`, unless `held` in a drag), to; marks: the
// opponent's last play, { left, came } as cell key -> checkers.
export function drawBoard(board, cells, pos, me, { hidden, sources, dests, selected, held, marks, oppName }) {
  const opp = 1 - me;
  for (const [key, cell] of cells) {
    let label;
    if (!pos) {
      cell.replaceChildren();
      continue;
    }
    if (key === "bar-top" || key === "off-top") {
      const n = pos[opp][key === "bar-top" ? BAR : OFF];
      cell.replaceChildren(...(key === "bar-top" ? checkerStack(n, "theirs") : trayStack(n, "theirs")));
    } else if (key === BAR) {
      const n = pos[me][BAR];
      cell.replaceChildren(...checkerStack(n, "mine"));
      label = n ? `Your bar: ${n} checker${n > 1 ? "s" : ""}` : "Your bar: empty";
    } else if (key === OFF) {
      const n = pos[me][OFF];
      cell.replaceChildren(...trayStack(n, "mine"));
      label = `Borne off: ${n} of yours`;
    } else {
      const mine = pos[me][key];
      const theirs = pos[opp][25 - key];
      cell.replaceChildren(...(mine ? checkerStack(mine, "mine") : checkerStack(theirs, "theirs")));
      label = `Point ${key}: ${mine ? `${mine} of yours` : theirs ? `${theirs} of ${oppName}'s` : "empty"}`;
    }
    const items = cell.querySelectorAll(".checker, .slab");
    const pending = hidden.get(key) || 0;
    for (let i = Math.max(0, items.length - pending); i < items.length; i++) items[i].classList.add("pending");
    const shown = items.length - pending;
    const top = items[shown - 1];
    top?.classList.add("top");
    // Where a picked checker would land: the next free spot, or around a
    // full stack's top checker, or around the blot it would hit.
    if (dests.has(key) && cell.classList.contains("point")) {
      if (top?.classList.contains("theirs")) top.classList.add("target");
      else if (shown >= STACK) top.classList.add("target");
      else cell.append(el("span", { class: "slot", "aria-hidden": "true" }));
    }
    // The opponent's last play: an outline where each checker left, a ring on each that arrived.
    if (marks && cell.classList.contains("point")) {
      const came = Math.min(marks.came.get(key) || 0, shown);
      for (let i = shown - came; i < shown; i++) if (items[i].classList.contains("theirs")) items[i].classList.add("arrived");
      const gone = Math.min(marks.left.get(key) || 0, STACK - shown);
      for (let i = 0; i < gone; i++) cell.append(el("span", { class: "vacated", "aria-hidden": "true" }));
    }
    cell.classList.toggle("src", sources.has(key));
    cell.classList.toggle("selected", selected === key && held !== key);
    cell.classList.toggle("dest", dests.has(key));
    if (cell.tagName === "BUTTON") {
      if (dests.has(key)) label += key === OFF ? ", bear off here" : ", move here";
      else if (selected === key) label += ", picked";
      else if (sources.has(key)) label += ", can move";
      cell.setAttribute("aria-label", label);
      cell.setAttribute("aria-disabled", String(!sources.has(key) && !dests.has(key)));
    }
  }
  board.classList.toggle("armed", sources.size > 0);
}

// The cell an arrow key moves focus to from `cell`: null when there is none
// that way, undefined for any other key.
export function arrowTarget(cells, cell, key) {
  const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[key];
  if (!step) return undefined;
  let row = Number(cell.dataset.row);
  let col = Number(cell.dataset.col);
  for (let k = 0; k < 14; k++) {
    if (step[0]) row = 1 - row;
    else col = (col + step[1] + 14) % 14;
    const next = cells.get((row ? BOTTOM : TOP)[col]);
    if (next?.tagName === "BUTTON") return next;
    if (step[0]) return null;
  }
  return null;
}
