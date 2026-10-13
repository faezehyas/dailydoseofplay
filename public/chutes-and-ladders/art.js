// Board art: an SVG helper, the board with its ladders, chutes and pawns,
// and the spinner (shared by the game and its tutorial), and the little
// pictures on the squares where a ladder or chute starts and ends. As on the
// classic board, a good deed sits at the foot of each ladder and its reward
// at the top; a bit of mischief sits at the top of each chute and what comes
// of it at the bottom.
import { cellOf, LADDERS, CHUTES, LAST, SIZE, SPINNER } from "./rules.js";

const NS = "http://www.w3.org/2000/svg";

export function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

// Outlined shape, and a plain stroke (stems, strings, seams).
const o = (tag, attrs) => s(tag, { ...attrs, class: "o" });
const line = (d, color, width = 3) => s("path", { d, fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "round" });

const INK = "#2b2b36";
const GREEN = "#5fb84a";
const STEM = "#3f9a4a";
const WOOD = "#8a5a2b";
const GOLD = "#ffc23a";
const RED = "#ff5f5f";
const BLUE = "#4ea8ff";
const PINK = "#ff8fbf";
const PURPLE = "#a980ff";
const STAR = "M0 -16 l4.7 9.8 10.8 1.5 -7.8 7.6 1.9 10.7 -9.6 -5.1 -9.6 5.1 1.9 -10.7 -7.8 -7.6 10.8 -1.5Z";

const ICONS = {
  // ---- good deeds ----
  seedling: () => [
    line("M0 1 V-9", STEM),
    o("path", { d: "M0 -7 C-4 -15 -13 -15 -14 -10 C-10 -5 -4 -5 0 -7Z", fill: GREEN }),
    o("path", { d: "M0 -9 C4 -17 13 -17 14 -12 C10 -7 4 -7 0 -9Z", fill: GREEN }),
    o("path", { d: "M-10 5 H10 L7 17 H-7Z", fill: "#c96f3b" }),
    o("rect", { x: -12, y: 0, width: 24, height: 6, rx: 2, fill: "#e8935a" }),
  ],
  broom: () => [
    line("M12 -17 L-1 4", WOOD, 4),
    o("path", { d: "M-5 0 L5 7 L-3 19 L-17 10Z", fill: "#ffd25e" }),
    line("M-5 1 L5 8", RED, 3),
    line("M-9 9 L-6 15 M-4 11 L-2 16", "#d9a520", 1.6),
  ],
  book: () => [
    o("path", { d: "M-19 -7 V14 C-12 10 -6 11 0 15 C6 11 12 10 19 14 V-7 C12 -10 6 -9 0 -6 C-6 -9 -12 -10 -19 -7Z", fill: BLUE }),
    o("path", { d: "M0 -8 C-6 -12 -12 -12 -16 -10 V10 C-11 8 -5 9 0 12Z", fill: "#fff" }),
    o("path", { d: "M0 -8 C6 -12 12 -12 16 -10 V10 C11 8 5 9 0 12Z", fill: "#fff" }),
    line("M-12 -4 H-4 M-12 1 H-4 M-12 6 H-6 M4 -4 H12 M4 1 H12 M4 6 H10", "#9aa3b5", 1.6),
  ],
  wateringCan: () => [
    line("M-13 -1 C-21 -1 -21 11 -13 11", "#2c74c7", 3),
    line("M5 5 L16 -7", BLUE, 5),
    o("rect", { x: -14, y: -6, width: 20, height: 20, rx: 4, fill: BLUE }),
    o("circle", { cx: 17, cy: -8, r: 3.5, fill: BLUE }),
    s("circle", { cx: 19, cy: -1, r: 2, fill: "#8fcaff" }),
    s("circle", { cx: 22, cy: 4, r: 2, fill: "#8fcaff" }),
    line("M-9 -2 H1", "#a9d6ff", 2),
  ],
  gift: () => [
    o("rect", { x: -14, y: -3, width: 28, height: 19, rx: 2, fill: RED }),
    o("rect", { x: -16, y: -9, width: 32, height: 7, rx: 2, fill: "#ff8a8a" }),
    s("rect", { x: -3, y: -9, width: 6, height: 25, fill: GOLD }),
    o("path", { d: "M0 -9 C-8 -19 -15 -11 0 -9 C15 -11 8 -19 0 -9Z", fill: GOLD }),
  ],
  heart: () => [o("path", { d: "M0 15 C-18 3 -16 -12 -7 -12 C-3 -12 -1 -9 0 -7 C1 -9 3 -12 7 -12 C16 -12 18 3 0 15Z", fill: PINK }), s("ellipse", { cx: -7, cy: -5, rx: 3, ry: 4, fill: "#fff", opacity: 0.6 })],
  paintbrush: () => [
    line("M13 -17 L0 0", "#c27f3e", 5),
    line("M0 0 L-4 4", "#b8bfcc", 6),
    o("path", { d: "M-4 4 C-9 8 -13 13 -16 18 C-10 17 -6 13 -1 8Z", fill: BLUE }),
    s("circle", { cx: -8, cy: 19, r: 2.4, fill: BLUE }),
  ],
  bowl: () => [
    o("path", { d: "M-12 0 C-9 -8 9 -8 12 0Z", fill: "#c27f3e" }),
    s("circle", { cx: -4, cy: -4, r: 1.6, fill: "#7a4a20" }),
    s("circle", { cx: 4, cy: -3, r: 1.6, fill: "#7a4a20" }),
    o("path", { d: "M-16 0 H16 C15 10 8 15 0 15 C-8 15 -15 10 -16 0Z", fill: PURPLE }),
    line("M-8 -15 C-6 -12 -10 -11 -8 -8 M0 -17 C2 -14 -2 -13 0 -10", "#9aa3b5", 1.6),
  ],
  // ---- rewards ----
  flower: () => [
    line("M0 4 V18", STEM),
    o("path", { d: "M0 13 C5 7 11 8 13 11 C8 14 4 15 0 13Z", fill: GREEN }),
    [0, 72, 144, 216, 288].map((deg) => o("ellipse", { cx: 0, cy: -13, rx: 5.5, ry: 7, fill: PINK, transform: `rotate(${deg} 0 -6)` })),
    o("circle", { cx: 0, cy: -6, r: 5, fill: GOLD }),
  ],
  star: () => [o("path", { d: STAR, fill: GOLD }), line("M-17 -14 L-13 -10 M17 -14 L13 -10 M0 18 V14", GOLD, 2.4)],
  medal: () => [
    o("path", { d: "M-11 -18 L-1 1 L5 -3 L-3 -18Z", fill: BLUE }),
    o("path", { d: "M11 -18 L1 1 L-5 -3 L3 -18Z", fill: RED }),
    o("circle", { cx: 0, cy: 7, r: 10, fill: GOLD }),
    s("path", { d: "M0 1 l1.9 3.9 4.3 .6 -3.1 3 .7 4.3 -3.8 -2 -3.8 2 .7 -4.3 -3.1 -3 4.3 -.6Z", fill: "#fff3c4" }),
  ],
  apple: () => [
    line("M0 -6 C0 -12 2 -15 4 -17", WOOD, 3),
    o("path", { d: "M0 -6 C-10 -14 -18 -4 -15 6 C-12 16 -4 17 0 14 C4 17 12 16 15 6 C18 -4 10 -14 0 -6Z", fill: RED }),
    o("path", { d: "M2 -12 C7 -18 13 -16 14 -13 C9 -10 5 -10 2 -12Z", fill: GREEN }),
    s("ellipse", { cx: -7, cy: -1, rx: 2.6, ry: 4.5, fill: "#fff", opacity: 0.55 }),
  ],
  balloon: () => [
    line("M0 9 C-4 13 4 16 0 21", INK, 1.5),
    o("ellipse", { cx: 0, cy: -5, rx: 11, ry: 13.5, fill: PURPLE }),
    o("path", { d: "M-2.5 9 L2.5 9 L0 6Z", fill: PURPLE }),
    s("ellipse", { cx: -4, cy: -10, rx: 2.6, ry: 4.5, fill: "#fff", opacity: 0.6 }),
  ],
  icecream: () => [
    o("path", { d: "M-8 0 L0 19 L8 0Z", fill: "#e8b26a" }),
    line("M-5 4 L3 13 M2 1 L-3 9", "#b9802f", 1.4),
    o("circle", { cx: 0, cy: -5, r: 9.5, fill: "#ffb3d1" }),
    o("circle", { cx: 1, cy: -15, r: 3.4, fill: "#ff4d4d" }),
  ],
  rainbow: () => [
    line("M-17 9 A17 17 0 0 1 17 9", RED, 5),
    line("M-12 9 A12 12 0 0 1 12 9", GOLD, 5),
    line("M-7 9 A7 7 0 0 1 7 9", BLUE, 5),
    o("ellipse", { cx: -16, cy: 11, rx: 7, ry: 5, fill: "#fff" }),
    o("ellipse", { cx: 16, cy: 11, rx: 7, ry: 5, fill: "#fff" }),
  ],
  // ---- mischief ----
  candy: () => [
    o("path", { d: "M-7 0 L-18 -8 L-15 0 L-18 8Z", fill: PINK }),
    o("path", { d: "M7 0 L18 -8 L15 0 L18 8Z", fill: PINK }),
    o("circle", { cx: 0, cy: 0, r: 9, fill: RED }),
    line("M-5 -6 C-1 -2 1 2 5 6", "#fff", 2.2),
  ],
  ball: () => [o("circle", { cx: 0, cy: 0, r: 13, fill: "#fff" }), line("M-8 -10 C-3 -4 -3 4 -8 10 M8 -10 C3 -4 3 4 8 10", "#ff4d4d", 1.8), line("M17 -12 L21 -15 M18 -6 L23 -6", "#9aa3b5", 2)],
  mud: () => [
    o("ellipse", { cx: 0, cy: 9, rx: 18, ry: 7.5, fill: "#9a6633" }),
    s("ellipse", { cx: -5, cy: 7, rx: 6, ry: 2, fill: "#b98450" }),
    o("circle", { cx: -11, cy: -5, r: 3.4, fill: "#9a6633" }),
    o("circle", { cx: 2, cy: -11, r: 2.8, fill: "#9a6633" }),
    o("circle", { cx: 12, cy: -3, r: 3.4, fill: "#9a6633" }),
  ],
  banana: () => [o("path", { d: "M-15 -7 C-12 10 8 14 17 1 C10 6 -6 5 -10 -9Z", fill: "#ffd54a" }), line("M-15 -7 L-13 -11", WOOD, 3), line("M-8 1 C-3 5 4 6 9 4", "#e0a800", 1.4)],
  cookie: () => [
    o("path", { d: "M12 -7 A13 13 0 1 0 12 7 C8 6 7 2 9 -1 C6 -3 8 -7 12 -7Z", fill: "#d9a066" }),
    [[-5, -5], [3, -7], [-7, 4], [1, 6], [-1, -1]].map(([cx, cy]) => s("circle", { cx, cy, r: 1.9, fill: "#6b3e1e" })),
  ],
  // ---- consequences ----
  sad: () => [
    o("circle", { cx: 0, cy: 0, r: 13, fill: "#c8eda0" }),
    s("circle", { cx: -4.5, cy: -3, r: 1.8, fill: INK }),
    s("circle", { cx: 4.5, cy: -3, r: 1.8, fill: INK }),
    line("M-5 7 C-2 4 2 4 5 7", INK, 1.8),
    o("path", { d: "M14 -12 C12 -8 12 -6 14 -5 C16 -6 16 -8 14 -12Z", fill: "#8fcaff" }),
  ],
  crack: () => [
    o("rect", { x: -14, y: -14, width: 28, height: 28, rx: 2, fill: "#bfe3ff" }),
    line("M0 -14 V14 M-14 0 H14", WOOD, 3),
    line("M-11 -11 L-5 -5 L-8 -2 M-5 -5 L-2 -8", INK, 1.5),
    line("M5 4 L10 9 L7 11 M10 9 L12 6", INK, 1.5),
  ],
  bath: () => [
    o("circle", { cx: -8, cy: -6, r: 5, fill: "#e3f2ff" }),
    o("circle", { cx: 3, cy: -10, r: 6, fill: "#e3f2ff" }),
    o("circle", { cx: 11, cy: -3, r: 4, fill: "#e3f2ff" }),
    o("path", { d: "M-17 0 H17 C16 10 9 14 0 14 C-9 14 -16 10 -17 0Z", fill: "#fff" }),
    line("M-11 13 L-13 17 M11 13 L13 17", INK, 2),
  ],
  bandage: () => [
    o("rect", { x: -18, y: -6, width: 36, height: 12, rx: 6, fill: "#ffd9b0", transform: "rotate(-35)" }),
    o("rect", { x: -6, y: -5, width: 12, height: 10, rx: 1.5, fill: "#f2b98a", transform: "rotate(-35)" }),
    s("g", { transform: "rotate(-35)" }, [[-13, 0], [13, 0]].map(([cx, cy]) => s("circle", { cx, cy, r: 1.2, fill: "#c98a5a" }))),
  ],
};

// [picture at the start, picture at the end] for each ladder and chute.
export const VIGNETTES = {
  ladders: {
    1: ["seedling", "flower"],
    4: ["broom", "star"],
    9: ["book", "medal"],
    21: ["wateringCan", "apple"],
    28: ["gift", "balloon"],
    36: ["heart", "icecream"],
    51: ["paintbrush", "rainbow"],
    71: ["bowl", "star"],
    80: ["heart", null], // 100 has the trophy
  },
  chutes: {
    16: ["candy", "sad"],
    47: ["ball", "crack"],
    49: ["mud", "bath"],
    56: ["banana", "bandage"],
    62: ["cookie", "sad"],
    64: ["ball", "bandage"],
    87: ["cookie", "sad"],
    93: ["mud", "bath"],
    95: ["banana", "bandage"],
    98: ["ball", "crack"],
  },
};

export function icon(name, x, y, scale = 1) {
  return s("g", { class: `ico ${name}`, transform: `translate(${x} ${y}) scale(${scale})` }, s("circle", { class: "ico-badge", r: 21 }), ICONS[name]());
}

// ---------- the board ----------
export const U = 100; // one square, in board units
const BOARD = SIZE * U;
const GROUND = 96; // the start lawn under the board
export const FOOT = 26; // a pawn stands this far below its square's centre
const SHARE = 22; // two pawns on one square stand apart by twice this
const CROWD = 72; // three or four pawns on one square spread across this
export const PAWN_SCALE = 1.15;
const START_SPOTS = [150, 225, 300, 375].map((x) => ({ x, y: BOARD + 66 }));

export function center(n) {
  const { row, col } = cellOf(n);
  return { x: col * U + U / 2, y: (SIZE - 1 - row) * U + U / 2 };
}

// Where `player`'s pawn stands on square n, given the seats of every pawn
// there (`crowd`, in seat order). Three or four stand staggered.
export function spot(n, player, crowd = [player]) {
  if (n === 0) return { ...START_SPOTS[player] };
  const c = center(n);
  const k = crowd.length;
  if (k < 2) return { x: c.x, y: c.y + FOOT };
  const i = crowd.indexOf(player);
  const step = k === 2 ? 2 * SHARE : CROWD / (k - 1);
  return { x: c.x + (i - (k - 1) / 2) * step, y: c.y + FOOT + (k > 2 ? (i % 2 ? -8 : 4) : 0) };
}

// Each chute bends one way or the other so neighbours don't overlap.
const BEND = { 16: 0.5, 47: -0.9, 49: 0.7, 56: 1.0, 62: -0.6, 64: 0.8, 87: 0.55, 93: -0.9, 95: 0.85, 98: -0.75 };
const CHUTE_COLORS = { 16: 0, 47: 1, 49: 2, 56: 3, 62: 4, 64: 5, 87: 1, 93: 2, 95: 0, 98: 4 };

export function chuteCurve(from, to) {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const px = -dy / len;
  const py = dx / len;
  const w = Math.min(130, Math.max(40, len * 0.24)) * BEND[from];
  const p1 = { x: a.x + dx * 0.28 + px * w, y: a.y + dy * 0.28 + py * w };
  const p2 = { x: a.x + dx * 0.72 - px * w, y: a.y + dy * 0.72 - py * w };
  return { a, b, p1, p2, d: `M${a.x} ${a.y} C${p1.x} ${p1.y} ${p2.x} ${p2.y} ${b.x} ${b.y}` };
}

// A point on a cubic Bézier, and its direction.
export function bezier({ a, p1, p2, b }, t) {
  const u = 1 - t;
  const x = u * u * u * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.x;
  const y = u * u * u * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.y;
  const tx = 3 * u * u * (p1.x - a.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (b.x - p2.x);
  const ty = 3 * u * u * (p1.y - a.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (b.y - p2.y);
  return { x, y, angle: Math.atan2(ty, tx) };
}

// ---------- board art ----------
export const r1 = (v) => Math.round(v * 10) / 10;

function ladderArt(from, to) {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy * 15;
  const py = ux * 15;
  const ext = 16;
  const A = { x: a.x - ux * ext, y: a.y - uy * ext };
  // The ladder to 100 stops short, under the trophy.
  const top = to === LAST ? -28 : ext;
  const B = { x: b.x + ux * top, y: b.y + uy * top };
  const rail = (sgn) => `M${r1(A.x + px * sgn)} ${r1(A.y + py * sgn)} L${r1(B.x + px * sgn)} ${r1(B.y + py * sgn)}`;
  const count = Math.max(2, Math.round(len / 36));
  const rungs = [];
  const reach = to === LAST ? (len - 34) / len : 1;
  for (let i = 0; i <= count; i++) {
    const t = (i / count) * reach;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    rungs.push(`M${r1(x - px)} ${r1(y - py)} L${r1(x + px)} ${r1(y + py)}`);
  }
  const rungPath = rungs.join("");
  const rails = rail(-1) + rail(1);
  return s(
    "g",
    { class: "ladder", "data-from": from },
    s("path", { class: "ladder-shadow", d: rails + rungPath, transform: "translate(5 7)" }),
    s("path", { class: "ladder-rung", d: rungPath }),
    s("path", { class: "ladder-rail", d: rails }),
    s("path", { class: "ladder-rail-hi", d: rails }),
  );
}

function chuteArt(from, to) {
  const curve = chuteCurve(from, to);
  const { a, b, d } = curve;
  const c = CHUTE_COLORS[from];
  const deg = (t) => (bezier(curve, t).angle * 180) / Math.PI;
  return s(
    "g",
    { class: `chute c${c}`, "data-from": from },
    s("path", { class: "chute-shadow", d, transform: "translate(5 8)" }),
    s("path", { class: "chute-rim", d }),
    s("path", { class: "chute-wall", d }),
    s("path", { class: "chute-bed", d }),
    s("path", { class: "chute-shine", d }),
    // The run-out at the bottom, flared along the slide.
    s(
      "g",
      { transform: `translate(${r1(b.x)} ${r1(b.y)}) rotate(${r1(deg(1))})` },
      s("ellipse", { class: "chute-lip", cx: 2, cy: 0, rx: 16, ry: 25 }),
      s("ellipse", { class: "chute-lip-in", cx: 2, cy: 0, rx: 10, ry: 17 }),
    ),
    // The deck at the top, with a handrail on each side.
    s(
      "g",
      { transform: `translate(${r1(a.x)} ${r1(a.y)}) rotate(${r1(deg(0))})` },
      s("rect", { class: "chute-deck", x: -20, y: -26, width: 18, height: 52, rx: 6 }),
      s("path", { class: "chute-rail", d: "M-14 -27 C-2 -36 14 -30 22 -22 M-14 27 C-2 36 14 30 22 22" }),
    ),
  );
}

// A little kid on a stand, like the board game's cardboard pawns.
function pawnArt(whose) {
  const fig = s(
    "g",
    { class: "pawn-fig" },
    s("ellipse", { class: "pawn-base", cx: 0, cy: -3, rx: 17, ry: 6.5 }),
    s("path", { class: "pawn-body", d: "M-13.5 -6 C-15 -22 -10 -32 0 -32 C10 -32 15 -22 13.5 -6 Z" }),
    s("path", { class: "pawn-arm", d: "M-12 -24 L-18 -14 M12 -24 L18 -14" }),
    s("circle", { class: "pawn-head", cx: 0, cy: -42, r: 11.5 }),
    s("path", { class: "pawn-hair", d: "M-11.6 -42.5 A11.6 11.6 0 0 1 11.6 -42.5 C7 -46.5 -2 -48 -11.6 -42.5 Z" }),
    s("circle", { class: "pawn-eye", cx: -4, cy: -41, r: 1.7 }),
    s("circle", { class: "pawn-eye", cx: 4, cy: -41, r: 1.7 }),
    s("path", { class: "pawn-smile", d: "M-4 -36.6 Q0 -33.4 4 -36.6" }),
  );
  const g = s("g", { class: `pawn ${whose}` }, s("ellipse", { class: "pawn-shadow", cx: 0, cy: 0, rx: 18, ry: 6 }), s("g", { class: "pawn-bob" }, fig));
  return { g, fig };
}

function trophyArt() {
  return s(
    "g",
    { class: "trophy", transform: `translate(${center(LAST).x + 4} ${center(LAST).y - 6}) scale(0.9)` },
    s("path", { class: "trophy-cup", d: "M-20 -30 H20 C20 -8 12 2 0 4 C-12 2 -20 -8 -20 -30 Z" }),
    s("path", { class: "trophy-handles", d: "M-20 -24 C-34 -24 -32 -6 -14 -6 M20 -24 C34 -24 32 -6 14 -6" }),
    s("path", { class: "trophy-cup", d: "M-4 3 H4 V13 H12 V20 H-12 V13 H-4 Z" }),
    s("path", { class: "trophy-star", d: "M0 -25 l3.5 7.2 7.9 1.1 -5.7 5.6 1.3 7.9 -7 -3.7 -7 3.7 1.3 -7.9 -5.7 -5.6 7.9 -1.1 Z" }),
  );
}

function lawnArt() {
  const y = BOARD;
  const blades = [];
  for (let x = 8; x < BOARD; x += 17) blades.push(`M${x} ${y + 14} q3 -9 1 -14 M${x + 6} ${y + 14} q-2 -7 2 -11`);
  const flowers = [[330, 40, 0], [470, 64, 1], [610, 34, 2], [760, 60, 0], [905, 38, 1]].map(([x, dy, c]) =>
    s(
      "g",
      { class: `flower f${c}`, transform: `translate(${x} ${y + dy})` },
      s("path", { class: "flower-stem", d: "M0 4 V22" }),
      [0, 72, 144, 216, 288].map((deg) => s("ellipse", { class: "flower-petal", cx: 0, cy: -7, rx: 5, ry: 7.5, transform: `rotate(${deg})` })),
      s("circle", { class: "flower-heart", r: 4.5 }),
    ),
  );
  return s(
    "g",
    { class: "lawn" },
    s("rect", { class: "lawn-ground", x: 0, y, width: BOARD, height: GROUND }),
    s("path", { class: "lawn-blades", d: blades.join("") }),
    flowers,
    s(
      "g",
      { class: "start-sign", transform: `translate(52 ${y + 12})` },
      s("path", { class: "sign-post", d: "M0 18 V78" }),
      s("rect", { class: "sign-board", x: -40, y: 0, width: 80, height: 34, rx: 8 }),
      s("text", { class: "sign-text", x: 0, y: 24 }, "START"),
    ),
  );
}

// The pictures at both ends of every ladder and chute, each in the corner of
// its square that points away from where the ladder or chute leaves it.
const CORNERS = [{ x: 26, y: -20 }, { x: 26, y: 24 }, { x: -26, y: 24 }];
function vignettes() {
  const out = [];
  const place = (n, name, dir) => {
    if (!name) return;
    const c = center(n);
    const best = CORNERS.reduce((a, b) => (a.x * dir.x + a.y * dir.y <= b.x * dir.x + b.y * dir.y ? a : b));
    out.push(icon(name, c.x + best.x, c.y + best.y, 1.05));
  };
  const unit = (dx, dy) => ({ x: dx / Math.hypot(dx, dy), y: dy / Math.hypot(dx, dy) });
  for (const [from, [start, end]] of Object.entries(VIGNETTES.ladders)) {
    const a = center(Number(from));
    const b = center(LADDERS[from]);
    place(Number(from), start, unit(b.x - a.x, b.y - a.y));
    place(LADDERS[from], end, unit(a.x - b.x, a.y - b.y));
  }
  for (const [from, [start, end]] of Object.entries(VIGNETTES.chutes)) {
    const curve = chuteCurve(Number(from), CHUTES[from]);
    const t0 = bezier(curve, 0).angle;
    const t1 = bezier(curve, 1).angle;
    place(Number(from), start, { x: Math.cos(t0), y: Math.sin(t0) });
    place(CHUTES[from], end, { x: -Math.cos(t1), y: -Math.sin(t1) });
  }
  return s("g", { class: "vignettes" }, out);
}

export function buildBoard(players) {
  const squares = [];
  const numbers = [];
  for (let n = 1; n <= LAST; n++) {
    const { row, col } = cellOf(n);
    const x = col * U;
    const y = (SIZE - 1 - row) * U;
    const tone = (row * 3 + col * 2 + (row % 2)) % 5;
    const kind = LADDERS[n] ? "up" : CHUTES[n] ? "down" : n === LAST ? "goal" : "";
    squares.push(s("rect", { class: `sq t${tone} ${kind}`, x, y, width: U, height: U, "data-n": n }));
    numbers.push(s("text", { class: `num ${kind}`, x: x + 9, y: y + 25 }, String(n)));
  }
  const ladders = Object.entries(LADDERS).map(([a, b]) => ladderArt(Number(a), b));
  const chutes = Object.entries(CHUTES).map(([a, b]) => chuteArt(Number(a), b));
  const marks = s("g", { class: "marks" });
  const pawns = Array.from({ length: players }, (_, k) => pawnArt(`p${k}`));
  const fx = s("g", { class: "fx" });
  const svgEl = s(
    "svg",
    { class: "cl-board", id: "cl-board", viewBox: `-6 -6 ${BOARD + 12} ${BOARD + GROUND + 12}`, role: "img" },
    s("rect", { class: "frame", x: -6, y: -6, width: BOARD + 12, height: BOARD + GROUND + 12, rx: 22 }),
    s("g", { class: "squares" }, squares),
    s("g", { class: "grid-lines" }, s("path", { d: Array.from({ length: SIZE - 1 }, (_, i) => `M${(i + 1) * U} 0V${BOARD}M0 ${(i + 1) * U}H${BOARD}`).join("") })),
    marks,
    vignettes(),
    trophyArt(),
    lawnArt(),
    s("g", { class: "chutes" }, chutes),
    s("g", { class: "ladders" }, ladders),
    s("g", { class: "numbers" }, numbers),
    s("g", { class: "pawns" }, pawns.map((p) => p.g).reverse()),
    fx,
  );
  return { svg: svgEl, pawns, marks, fx, layer: svgEl.querySelector(".pawns") };
}

// ---------- spinner ----------
export const WEDGE = 360 / SPINNER;
export function spinnerArt() {
  const wedges = [];
  for (let v = 1; v <= SPINNER; v++) {
    const a0 = ((v - 1) * WEDGE - WEDGE / 2 - 90) * (Math.PI / 180);
    const a1 = a0 + WEDGE * (Math.PI / 180);
    const R = 92;
    const d = `M0 0 L${r1(R * Math.cos(a0))} ${r1(R * Math.sin(a0))} A${R} ${R} 0 0 1 ${r1(R * Math.cos(a1))} ${r1(R * Math.sin(a1))} Z`;
    const mid = (a0 + a1) / 2;
    wedges.push(
      s("path", { class: `wedge w${v}`, d }),
      s("text", { class: "wedge-num", x: r1(64 * Math.cos(mid)), y: r1(64 * Math.sin(mid) + 9) }, String(v)),
    );
  }
  const pegs = [];
  for (let v = 0; v < SPINNER; v++) {
    const a = (v * WEDGE + WEDGE / 2 - 90) * (Math.PI / 180);
    pegs.push(s("circle", { class: "peg", cx: r1(92 * Math.cos(a)), cy: r1(92 * Math.sin(a)), r: 3.5 }));
  }
  const arrow = s(
    "g",
    { class: "arrow" },
    s("path", { class: "arrow-shadow", d: "M0 -76 L11 -8 L5 26 H-5 L-11 -8 Z", transform: "translate(3 4)" }),
    s("path", { class: "arrow-body", d: "M0 -76 L11 -8 L5 26 H-5 L-11 -8 Z" }),
    s("path", { class: "arrow-shine", d: "M0 -66 L5 -10 L0 -10 Z" }),
  );
  const svgEl = s(
    "svg",
    { class: "cl-spinner", viewBox: "-104 -104 208 208", "aria-hidden": "true" },
    s("circle", { class: "dial-rim", r: 101 }),
    wedges,
    s("circle", { class: "dial-ring", r: 92 }),
    pegs,
    arrow,
    s("circle", { class: "hub", r: 15 }),
    s("circle", { class: "hub-dot", r: 5 }),
  );
  return { svg: svgEl, arrow };
}
