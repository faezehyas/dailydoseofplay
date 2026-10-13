// Backgammon's drawing, shared by the game (main.js) and its tutorial
// (tutorial.js): the board's cells, the checker stacks and the dice.
import { el } from "../engine/shell.js";
import { BAR, OFF } from "./rules.js";

export const STACK = 5; // checkers drawn on a point; a taller stack shows its count
// The board from your side: your home board is bottom right, and you move
// from 24 at the top right, along the top, down and along the bottom to 1.
const TOP = [13, 14, 15, 16, 17, 18, "bar-top", 19, 20, 21, 22, 23, 24, "off-top"];
const BOTTOM = [12, 11, 10, 9, 8, 7, BAR, 6, 5, 4, 3, 2, 1, OFF];

export function dieFace(value, cls) {
  const spots = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }[value];
  return el("span", { class: `die ${cls}`, role: "img", "aria-label": `${value}${cls.includes("used") ? ", played" : ""}` }, spots.map((s) => el("i", { style: `grid-area: s${s}` })));
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
