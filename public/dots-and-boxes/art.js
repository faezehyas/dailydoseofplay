// The paper, the pencil lines, the boxes and the keyboard's line grid,
// shared by the game (main.js) and its tutorial (tutorial.js).
import { geometry, lineEnds } from "./rules.js";

export const U = 100; // one box, in board units
const PAD = 46; // paper around the dots, so the outer lines are easy to hit too
const NS = "http://www.w3.org/2000/svg";

export function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

export const r1 = (v) => Math.round(v * 10) / 10;

// A steady "random" number in [-1, 1] for line or box `i`, so the hand-drawn
// wobble is the same on both screens and on every redraw.
export function wobble(i, k) {
  let h = Math.imul(i + 1, 0x27d4eb2d) ^ Math.imul(k + 7, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

// ---------- board art ----------
// Where line l runs, with a little hand wobble: a quadratic curve from one
// dot to the other, sometimes drawn backwards, as a pencil would.
export function stroke(n, l) {
  const e = lineEnds(n, l);
  let a = { x: e.c1 * U, y: e.r1 * U };
  let b = { x: e.c2 * U, y: e.r2 * U };
  if (wobble(l, 5) > 0) [a, b] = [b, a];
  const dx = (b.x - a.x) / U;
  const dy = (b.y - a.y) / U;
  const px = -dy;
  const py = dx;
  const j = (k, amount) => wobble(l, k) * amount;
  a = { x: a.x + dx * 3 + px * j(1, 1.6), y: a.y + dy * 3 + py * j(1, 1.6) };
  b = { x: b.x - dx * 3 + px * j(2, 1.6), y: b.y - dy * 3 + py * j(2, 1.6) };
  const c = { x: (a.x + b.x) / 2 + px * j(3, 4.2) + dx * j(4, 6), y: (a.y + b.y) / 2 + py * j(3, 4.2) + dy * j(4, 6) };
  const at = (t) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
  return { d: `M${r1(a.x)} ${r1(a.y)} Q${r1(c.x)} ${r1(c.y)} ${r1(b.x)} ${r1(b.y)}`, at, horizontal: e.horizontal };
}

// The tap target for a line: the diamond between its two dots and the two
// box centres beside it. The diamonds tile the board, so a tap anywhere
// lands on the nearest line.
function hitArea(n, l) {
  const e = lineEnds(n, l);
  const x = e.c1 * U;
  const y = e.r1 * U;
  const h = U / 2;
  const pts = e.horizontal ? [[x, y], [x + h, y - h], [x + U, y], [x + h, y + h]] : [[x, y], [x + h, y + h], [x, y + U], [x - h, y + h]];
  return pts.map((p) => p.join(",")).join(" ");
}

// A pencil hatch over a claimed box: short diagonal strokes, each a little
// off true, like shading done in a hurry.
function hatch(b) {
  const half = 30;
  const step = 12;
  const parts = [];
  for (let c = -2 * half + 9, i = 0; c <= 2 * half - 9; c += step, i++) {
    const p = c <= 0 ? [-half, c + half] : [c - half, half];
    const q = c <= 0 ? [c + half, -half] : [half, c - half];
    const j = (k) => wobble(b * 31 + i, k) * 2.6;
    // Every other stroke goes back the other way, as a hand would.
    const [u, w] = i % 2 ? [q, p] : [p, q];
    parts.push(`M${r1(u[0] + j(1))} ${r1(u[1] + j(2))}L${r1(w[0] + j(3))} ${r1(w[1] + j(4))}`);
  }
  return parts.join("");
}

export function buildBoard(n) {
  const W = n * U;
  const geo = geometry(n);
  const pattern = s(
    "pattern",
    { id: "db-grid", width: U / 4, height: U / 4, patternUnits: "userSpaceOnUse", x: 0, y: 0 },
    s("path", { class: "grid-line", d: `M${U / 4} 0 H0 V${U / 4}` }),
  );
  const dots = [];
  for (let r = 0; r <= n; r++) {
    for (let c = 0; c <= n; c++) dots.push(s("circle", { class: "dot", cx: c * U, cy: r * U, r: 7.5, "data-dot": r * (n + 1) + c }));
  }
  const hits = [];
  for (let l = 0; l < geo.lines; l++) hits.push(s("polygon", { class: "hit", points: hitArea(n, l), "data-line": l }));
  const layer = (cls) => s("g", { class: cls });
  const parts = {
    boxes: layer("boxes"),
    lines: layer("lines"),
    preview: s("path", { class: "preview", pathLength: 1, visibility: "hidden" }),
    dots: s("g", { class: "dots" }, dots),
    focus: s("rect", { class: "focus-ring", rx: 18, visibility: "hidden" }),
    fx: layer("fx"),
    hits: s("g", { class: "hits" }, hits),
  };
  const svg = s(
    "svg",
    { class: "db-board", id: "db-board", viewBox: `${-PAD} ${-PAD} ${W + 2 * PAD} ${W + 2 * PAD}`, tabindex: 0, role: "application", "aria-roledescription": "board" },
    s("defs", {}, pattern),
    s("rect", { class: "paper", x: -PAD, y: -PAD, width: W + 2 * PAD, height: W + 2 * PAD, rx: 22 }),
    s("rect", { class: "grid", x: -PAD + 4, y: -PAD + 4, width: W + 2 * PAD - 8, height: W + 2 * PAD - 8, rx: 18, fill: "url(#db-grid)" }),
    parts.boxes,
    parts.lines,
    parts.preview,
    parts.dots,
    parts.focus,
    parts.fx,
    parts.hits,
  );
  return { svg, ...parts };
}

// ---------- keyboard ----------
// Lines on a half-step grid: horizontal ones at (even row, odd column),
// vertical ones at (odd row, even column).
export function halfGrid(n, l) {
  const e = lineEnds(n, l);
  return e.horizontal ? [2 * e.r1, 2 * e.c1 + 1] : [2 * e.r1 + 1, 2 * e.c1];
}

// The nearest line in the arrow's direction. A step usually goes half a box,
// to a line across the other way, zigzagging along a row or down a column.
export function stepCursor(n, l, dr, dc) {
  const [R, C] = halfGrid(n, l);
  const horizontal = R % 2 === 0;
  let best = null;
  for (let k = 0; k < geometry(n).lines; k++) {
    const [r, c] = halfGrid(n, k);
    const along = (r - R) * dr + (c - C) * dc;
    const side = dr ? c - C : r - R;
    if (along <= 0 || Math.abs(side) > along) continue;
    const lean = horizontal ? side < 0 : side > 0;
    const score = along * 100 + Math.abs(side) * 10 + (lean ? 1 : 0);
    if (!best || score < best.score) best = { k, score };
  }
  return best ? best.k : l;
}

// "B3" style names for dots: columns A, B, C… and rows 1, 2, 3… from the top left.
export function lineName(n, l) {
  const e = lineEnds(n, l);
  const dot = (r, c) => `${String.fromCharCode(65 + c)}${r + 1}`;
  return `${e.horizontal ? "Across" : "Down"} from ${dot(e.r1, e.c1)} to ${dot(e.r2, e.c2)}`;
}

// A drawn line: the pencil stroke in the player's colour and its sheen.
export function lineArt(n, l, cls) {
  const { d } = stroke(n, l);
  return s(
    "g",
    { class: `line ${cls}`, "data-l": l },
    s("path", { class: "ink", d, pathLength: 1 }),
    s("path", { class: "sheen", d, pathLength: 1, transform: "translate(1.2 -1.4)" }),
  );
}

// A claimed box: a tint, a pencil hatch and the owner's initial, centred on (cx, cy).
export function boxArt(n, b, cls, initial) {
  const cx = (b % n) * U + U / 2;
  const cy = Math.floor(b / n) * U + U / 2;
  const tilt = r1(wobble(b, 9) * 2.5);
  const inner = s(
    "g",
    { class: "box-in" },
    s("rect", { class: "tint", x: -38, y: -38, width: 76, height: 76, rx: 12, transform: `rotate(${tilt})` }),
    s("path", { class: "hatch", d: hatch(b), pathLength: 1 }),
    s("text", { class: "initial", x: 0, y: 2, transform: `rotate(${r1(wobble(b, 11) * 6)})` }, initial),
  );
  const node = s("g", { class: `box ${cls}`, transform: `translate(${cx} ${cy})`, "data-box": b }, inner);
  return { node, inner, cx, cy };
}
