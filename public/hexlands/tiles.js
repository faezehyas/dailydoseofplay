// Hexlands' island in the Storybook style, as SVG markup in board units (a
// hex's radius is 100, the middle hex at 0 0): the sea round the island, each
// terrain hex, and the harbours. Colours are classes styled by tiles.css, so
// light and dark come from its tokens; shared gradients, patterns and the
// little objects (trees, sheep, windmills…) live in defsSvg(), drawn once and
// placed with <use>. Detail on a hex varies by the hex's id and keeps clear of
// the number token in its middle. Pure: no DOM, timers or Math.random.
import { HEXES, CORNERS, EDGES, COAST, HARBOUR_EDGES, TERRAIN_NAMES, ANY } from "./board.js";
import { resourceGlyph, hexCorners } from "./card-art.js";
import { rngFromSeed } from "../engine/rng.js";

const R = 100;
const HALF = 500;
export const VIEWBOX = `${-HALF} ${-HALF} ${2 * HALF} ${2 * HALF}`;
const CLEAR = 36; // the number token's disc, kept free of detail

// ---------- markup helpers ----------
const n = (v) => Math.round(v * 10) / 10;
const p = (x, y) => `${n(x)} ${n(y)}`;
const attrs = (a) => Object.entries(a).map(([k, v]) => ` ${k}="${typeof v === "number" ? n(v) : v}"`).join("");
const tag = (name, cls, a) => `<${name}${cls ? ` class="${cls}"` : ""}${attrs(a)}/>`;
const P = (cls, d, a = {}) => tag("path", cls, { d, ...a });
const C = (cls, cx, cy, r, a = {}) => tag("circle", cls, { cx, cy, r, ...a });
const E = (cls, cx, cy, rx, ry, a = {}) => tag("ellipse", cls, { cx, cy, rx, ry, ...a });
const Rect = (cls, x, y, width, height, rx, a = {}) => tag("rect", cls, { x, y, width, height, ...(rx ? { rx } : {}), ...a });
const FLAT = { stroke: "none" };
const flat = (a) => ({ ...FLAT, ...a });
const g = (inner, a = {}, cls = "") => `<g${cls ? ` class="${cls}"` : ""}${attrs(a)}>${inner}</g>`;
// A circle as a subpath, so many dots make one path.
const dot = (x, y, r) => `M${p(x - r, y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0`;
const shadow = (x, y, rx, o = 0.22) => E("hx-sh", x, y, rx, rx * 0.34, flat({ opacity: o }));
const use = (id, x, y, s = 1, flip = false) =>
  `<use href="#hx-${id}" transform="translate(${p(x, y)})${s !== 1 || flip ? ` scale(${n(flip ? -s : s)} ${n(s)})` : ""}"/>`;

const between = (rng, a, b) => a + (b - a) * rng();

function roundedPoly(pts, r) {
  return (
    pts
      .map((p1, i) => {
        const p0 = pts[(i + pts.length - 1) % pts.length];
        const p2 = pts[(i + 1) % pts.length];
        const towards = (q) => {
          const l = Math.hypot(q[0] - p1[0], q[1] - p1[1]);
          const k = Math.min(r, l / 2) / l;
          return [p1[0] + (q[0] - p1[0]) * k, p1[1] + (q[1] - p1[1]) * k];
        };
        return `${i ? "L" : "M"}${p(...towards(p0))}Q${p(...p1)} ${p(...towards(p2))}`;
      })
      .join("") + "Z"
  );
}
const TILE_R = 95.5;
const HEX_D = roundedPoly(hexCorners(TILE_R), 9);
const HEX_IN = roundedPoly(hexCorners(89), 7);

// ---------- placing things on a hex ----------
// Inside the tile, `m` units in from its edge.
const inHex = (x, y, m) => {
  const ap = (TILE_R * Math.sqrt(3)) / 2 - m;
  return Math.abs(x) <= ap && Math.abs(x) / 2 + (Math.abs(y) * Math.sqrt(3)) / 2 <= ap;
};
// An object standing at x y, w wide and h tall: inside the tile and off the token.
function fits(x, y, w, h, m = 6) {
  const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h, y1 = y + 2;
  if (Math.hypot(Math.max(x0, Math.min(0, x1)), Math.max(y0, Math.min(0, y1))) < CLEAR) return false;
  return [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].every(([a, b]) => inHex(a, b, m));
}
// A free spot for a w by h object in an area {x: [lo, hi], y: [lo, hi]}, or null.
function spot(rng, taken, area, w, h, { pad = 2, tries = 40, m = 6 } = {}) {
  for (let t = 0; t < tries; t++) {
    const x = between(rng, ...area.x), y = between(rng, ...area.y);
    if (!fits(x, y, w, h, m)) continue;
    const box = { x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y + 2 };
    if (taken.some((b) => Math.min(b.x1, box.x1) - Math.max(b.x0, box.x0) > pad && Math.min(b.y1, box.y1) - Math.max(b.y0, box.y0) > pad)) continue;
    taken.push(box);
    return { x, y };
  }
  return null;
}
const AREAS = {
  top: { x: [-38, 38], y: [-52, -38] },
  left: { x: [-68, -50], y: [-16, 40] },
  right: { x: [50, 68], y: [-16, 40] },
  bl: { x: [-62, -26], y: [48, 78] },
  br: { x: [26, 62], y: [48, 78] },
  any: { x: [-80, 80], y: [-80, 90] },
};
const side = (rng) => (rng() < 0.5 ? -1 : 1);
const mirror = (a, m) => (m > 0 ? a : { x: [-a.x[1], -a.x[0]], y: a.y });
const scatterPts = (rng, k, spread, x0 = 0, y0 = 0) => Array.from({ length: k }, () => [x0 + between(rng, -spread, spread), y0 + between(rng, -spread, spread)]);
const tufts = (pts, s = 1) =>
  pts.map(([x, y]) => `M${p(x - 3 * s, y)}q${n(s)} ${n(-3 * s)} ${n(0.5 * s)} ${n(-5 * s)}M${p(x, y)}q0 ${n(-4 * s)} ${n(0.5 * s)} ${n(-6 * s)}M${p(x + 3 * s, y)}q${n(-s)} ${n(-3 * s)} ${n(-0.2 * s)} ${n(-4.6 * s)}`).join("");
const inTile = (pts, m = 8) => pts.filter(([x, y]) => inHex(x, y, m) && Math.hypot(x, y) > CLEAR);

// ---------- the object library (each at its own base, drawn once in defs) ----------
function pine(id, c, tiers, w0, dw, rise, tall) {
  let o = shadow(2, 1, w0 / 2) + Rect("hx-trunk", -2.2, -7, 4.4, 8, 1.2, { "stroke-width": 1.4 });
  for (let i = 0; i < tiers; i++) {
    const w = w0 - i * dw, yb = -5.5 - i * rise, yt = yb - tall;
    o += P(c, `M${p(-w / 2, yb)}Q${p(0, yb + 3.5)} ${p(w / 2, yb)}L${p(1.6, yt + 1.4)}Q${p(0, yt - 0.8)} ${p(-1.6, yt + 1.4)}Z`, { "stroke-width": 1.7 });
    o += P(`${c}-dk`, `M${p(0.4, yt + 1.5)}L${p(w / 2 - 0.6, yb - 0.3)}Q${p(w / 4, yb + 2.4)} ${p(0.4, yb + 2.9)}Z`, flat({ opacity: 0.55 }));
    o += P(`${c}-lt`, `M${p(-1.2, yt + 3)}L${p(-w / 2 + 3, yb - 1)}`, { "stroke-width": 1.3, opacity: 0.8 });
  }
  return g(o, { id: `hx-${id}` }, "hx-o");
}
function blob(cls, circles, w) {
  return P("hx-ink", circles.map(([x, y, r]) => dot(x, y, r + w / 2)).join(""), FLAT) + P(cls, circles.map(([x, y, r]) => dot(x, y, r)).join(""), FLAT);
}
function oak(id, c, fruit) {
  let o = shadow(2, 1, 12) + P("hx-trunk", "M-2 .5L-1.6 -13L1.6 -13L2 .5Z", { "stroke-width": 1.4 });
  o += blob(c, [[-6.5, -16, 7.5], [6.5, -17, 7.5], [0, -24, 9], [0, -15, 7]], 3.2);
  o += C(`${c}-dk`, 4, -14, 6, flat({ opacity: 0.45 })) + C(`${c}-lt`, -3, -26, 3.6, flat({ opacity: 0.85 })) + C(`${c}-lt`, -8, -18, 2.4, flat({ opacity: 0.7 }));
  if (fruit) o += P("hx-apple", dot(-5, -19, 1.7) + dot(4, -24, 1.7) + dot(6.5, -15, 1.7) + dot(-1, -12.5, 1.6), { "stroke-width": 0.8 });
  return g(o, { id: `hx-${id}` }, "hx-o");
}
function bush() {
  return g(shadow(1, 1, 9, 0.2) + blob("hx-leaf", [[-5, -5, 5], [4, -5.5, 5.5], [0, -9, 5.5]], 3) + C("hx-leaf-lt", -2, -11, 2.2, flat({ opacity: 0.8 })) + P("hx-flower", dot(-5, -6, 1.2) + dot(3, -9, 1.2) + dot(5, -4, 1.2), FLAT), { id: "hx-bush" }, "hx-o");
}
function logs() {
  let o = shadow(1, 1, 14, 0.25);
  for (const [x, y] of [[-6, -4], [6, -4], [0, -12]]) o += C("hx-log", x, y, 5.6) + C("hx-log-end", x, y, 3.6, flat()) + P("hx-l-log", `M${p(x - 1.6, y)}a1.6 1.6 0 1 1 3.2 0`, { "stroke-width": 0.9 });
  return g(o + P("hx-axe", "M10 -1L18 -14", { "stroke-width": 1.4 }) + P("hx-blade", "M15.5 -16L20.5 -13L19 -10L14.6 -12.6Z", { "stroke-width": 1.1 }), { id: "hx-logs" }, "hx-o");
}
function mushrooms() {
  const one = (x, s) => Rect("hx-stem", x - 1.5 * s, -5 * s, 3 * s, 5 * s, 1, { "stroke-width": 1 }) + P("hx-cap", `M${p(x - 5 * s, -4.5 * s)}Q${p(x, -12 * s)} ${p(x + 5 * s, -4.5 * s)}Z`, { "stroke-width": 1.2 }) + P("hx-white", dot(x - 1.8 * s, -7 * s, 0.9 * s) + dot(x + 1.8 * s, -6.2 * s, 0.7 * s), FLAT);
  return g(shadow(0, 1, 8, 0.2) + one(-3, 1) + one(4, 0.75), { id: "hx-shrooms" }, "hx-o");
}
function sheep() {
  let o = shadow(0, 1, 11, 0.25);
  for (const lx of [-5, -1.5, 3, 6]) o += Rect("hx-face", lx - 1.2, -6, 2.4, 6.5, 1.2, FLAT);
  o += blob("hx-wool", [[-5.5, -9, 5.2], [0, -11.5, 5.8], [5.5, -9, 5.2], [-2.5, -7, 5], [3, -7, 5]], 2.6);
  o += C("hx-wool-dk", 2.5, -6.5, 3.5, flat({ opacity: 0.8 })) + C("hx-white", -2, -13, 2.2, FLAT);
  o += E("hx-face", 9.5, -10.5, 3.8, 4.6, { transform: "rotate(18 9.5 -10.5)", "stroke-width": 1.2 });
  o += E("hx-face", 6.2, -13, 2.2, 1.1, flat({ transform: "rotate(-25 6.2 -13)" })) + C("hx-white", 10.7, -11.7, 0.9, FLAT);
  return g(o, { id: "hx-sheep" }, "hx-o");
}
function fence() {
  const rails = "M-12 -5L13 -7M-12 -9.5L13 -11.5";
  let o = P("hx-l-ink", rails, { "stroke-width": 3.4 }) + P("hx-l-fence", rails, { "stroke-width": 1.8 });
  [-10, -3, 4, 11].forEach((x, i) => (o += Rect("hx-post", x - 1.4, -14 - i * 0.55, 2.8, 14, 1, { "stroke-width": 1.1 })));
  return g(o, { id: "hx-fence" }, "hx-o");
}
function kiln() {
  let o = shadow(3, 1, 15);
  o += Rect("hx-chimney", 3, -27, 5.5, 14, 1, { "stroke-width": 1.5 });
  o += C("hx-smoke", 6, -31, 3.2, flat({ opacity: 0.75 })) + C("hx-smoke", 9.5, -35.5, 4, flat({ opacity: 0.6 })) + C("hx-smoke", 14, -40, 4.8, flat({ opacity: 0.42 }));
  o += P("hx-kiln", "M-13 0C-13 -24 13 -24 13 0Z", { "stroke-width": 1.7 });
  o += P("hx-l-kiln-lt", "M-9 -6C-8 -15 -2 -18 1 -17.6", { "stroke-width": 2.4 });
  o += P("hx-l-chimney", "M-11 -5l3 -1M-7 -12l3 -1M5 -12l3 -1M9 -5l3 -1", { "stroke-width": 1 });
  o += P("hx-mouth", "M-5.5 0L-5.5 -5A5.5 5.5 0 0 1 5.5 -5L5.5 0Z", { "stroke-width": 1.3 });
  o += E("hx-glow", 0, -1.6, 3.6, 2.6, FLAT) + E("hx-glow-core", 0, -1.2, 2, 1.4, FLAT);
  o += E("hx-halo", 0, -3, 24, 14, FLAT);
  return g(o, { id: "hx-kiln" }, "hx-o");
}
function bricks() {
  const bw = 9, bh = 4.6, dz = 2.6;
  let o = shadow(2, 1, 15);
  [[-1.5, -0.5, 0.5], [-1, 0], [-0.5]].forEach((row, ri) =>
    row.forEach((c) => {
      const bx = c * bw * 1.04, by = -(ri + 1) * bh;
      o += P("hx-brick-top", `M${p(bx, by)}l${dz} ${-dz}h${bw}l${-dz} ${dz}Z`, { "stroke-width": 1.1 });
      o += P("hx-brick-side", `M${p(bx + bw, by)}l${dz} ${-dz}v${bh}l${-dz} ${dz}Z`, { "stroke-width": 1.1 });
      o += Rect("hx-brick", bx, by, bw, bh, 0, { "stroke-width": 1.1 });
    }),
  );
  return g(o, { id: "hx-bricks" }, "hx-o");
}
function barrow() {
  let o = shadow(0, 1, 13, 0.22);
  o += P("hx-l-ink", "M-4 -4L-16 -10M-4 -4L-15 -6", { "stroke-width": 1.4 });
  o += C("hx-wheel", 7, -3.5, 3.5, { "stroke-width": 1.3 });
  o += P("hx-barrow", "M-8 -11H12L9 -4H-5Z", { "stroke-width": 1.4 });
  o += Rect("hx-brick", -5, -15, 7, 4, 0, { "stroke-width": 1 }) + Rect("hx-brick", 2.5, -15, 7, 4, 0, { "stroke-width": 1 }) + Rect("hx-brick-top", -1.5, -19, 7, 4, 0, { "stroke-width": 1 });
  return g(o, { id: "hx-barrow" }, "hx-o");
}
function sheaf() {
  let stalks = "";
  for (let i = -3; i <= 3; i++) stalks += `M${p(i * 1.9, 0)}L${p(i * 0.5, -10)}L${p(i * 1.6, -19)}`;
  let o = shadow(2, 1, 10, 0.25) + P("hx-l-ink", stalks, { "stroke-width": 4.2 }) + P("hx-l-wheat", stalks, { "stroke-width": 2.2 });
  for (let i = -3; i <= 3; i++) {
    const x = i * 1.75, y = -21 - (3 - Math.abs(i)) * 0.9;
    o += E("hx-wheat-lt", x, y, 2.3, 4.8, { transform: `rotate(${i * 10} ${n(x)} ${n(y)})`, "stroke-width": 1.3 });
  }
  return g(o + Rect("hx-tie", -4.5, -11.8, 9, 3.2, 1.2, { "stroke-width": 1.1 }), { id: "hx-sheaf" }, "hx-o");
}
function hay() {
  let o = shadow(2, 1, 14, 0.25) + P("hx-wheat", "M-13 0C-14 -20 14 -20 13 0Q0 3 -13 0Z", { "stroke-width": 1.6 });
  o += P("hx-wheat-dk", "M2 -14C9 -12 12 -6 13 0Q7 2 1 1.6C5 -4 5 -9 2 -14Z", flat({ opacity: 0.6 }));
  o += P("hx-l-wheat-dk", "M-8 -2C-8 -9 -5 -12 -2 -13M-1 -1C-2 -7 0 -11 3 -12.5M6 -1C6 -5 7 -8 9 -9", { "stroke-width": 1.1 });
  o += P("hx-l-wheat-lt", "M-9 -6C-8 -11 -4 -14 0 -14.6", { "stroke-width": 1.8 });
  return g(o, { id: "hx-hay" }, "hx-o");
}
function mill() {
  let o = shadow(3, 1, 11, 0.25);
  o += P("hx-mill", "M-7 0L-4.5 -22L4.5 -22L7 0Z", { "stroke-width": 1.6 });
  o += P("hx-mill-dk", "M1 0L2 -22L4.5 -22L7 0Z", FLAT);
  o += Rect("hx-door", -2, -6, 4, 6, 2, { "stroke-width": 1.1 });
  o += E("hx-halo", 0, -14, 12, 11, FLAT) + Rect("hx-window", -1.6, -16, 3.2, 3.6, 1, { "stroke-width": 0.9 });
  o += P("hx-mill-roof", "M-6.5 -21Q0 -31 6.5 -21Z", { "stroke-width": 1.6 });
  return g(o, { id: "hx-mill" }, "hx-o");
}
function sails() {
  let o = "";
  for (let k = 0; k < 4; k++)
    o += g(Rect("hx-sail", -2.6, -19, 5.2, 15, 0, { "stroke-width": 1.2 }) + P("hx-l-sail", "M0 -19V0M-2.6 -14h5.2M-2.6 -9h5.2", { "stroke-width": 0.9 }), { transform: `rotate(${k * 90 + 22})` });
  return g(o + C("hx-trunk", 0, 0, 2.2, { "stroke-width": 1.1 }), { id: "hx-sails" }, "hx-o");
}
function gems() {
  const one = (cx, h, w, r) =>
    g(P("hx-gem", `M${p(cx - w, 0)}L${p(cx - w, -h * 0.7)}L${p(cx, -h)}L${p(cx + w, -h * 0.7)}L${p(cx + w, 0)}Z`, { "stroke-width": 1.3 }) + P("hx-gem-lt", `M${p(cx - w, -h * 0.7)}L${p(cx, -h)}L${p(cx, 0)}L${p(cx - w, 0)}Z`, flat({ opacity: 0.85 })), { transform: `rotate(${r} ${n(cx)} 0)` });
  return g(shadow(0, 1, 8, 0.25) + one(-4, 9, 2.4, -18) + one(4, 10, 2.6, 16) + one(0, 14, 3, 0) + sparkle(7, -15, 3.4), { id: "hx-gems" }, "hx-o");
}
const sparkle = (x, y, r) => P("hx-white", `M${p(x, y - r)}Q${p(x, y)} ${p(x + r, y)}Q${p(x, y)} ${p(x, y + r)}Q${p(x, y)} ${p(x - r, y)}Q${p(x, y)} ${p(x, y - r)}Z`, FLAT);
function mine() {
  let o = shadow(2, 1, 22, 0.24);
  o += P("hx-rock-lt", "M-22 0C-21 -14 -10 -24 2 -23C13 -22 21 -12 22 0Q0 3 -22 0Z", { "stroke-width": 1.7 });
  o += P("hx-rock-dk", "M5 -22.6C14 -21 21 -12 22 0Q12 1.6 4 1.5C10 -6 10 -15 5 -22.6Z", flat({ opacity: 0.8 }));
  o += P("hx-mouth", "M-7 0V-9A7 7 0 0 1 7 -9V0Z", { "stroke-width": 1.3 });
  o += Rect("hx-timber", -9.5, -13, 3, 13, 0.6, { "stroke-width": 1.2 }) + Rect("hx-timber", 6.5, -13, 3, 13, 0.6, { "stroke-width": 1.2 }) + Rect("hx-timber", -11, -16, 22, 3.6, 1, { "stroke-width": 1.2 });
  o += E("hx-halo", 13, -9, 7, 7, FLAT) + C("hx-window", 13, -9, 1.9, { "stroke-width": 0.9 }) + P("hx-l-ink", "M13 -11v-3h-3", { "stroke-width": 0.9 });
  o += P("hx-l-rail", "M-3.5 0L-6 12M3.5 0L6 12", { "stroke-width": 1.3 }) + P("hx-l-timber", "M-5 3.5h10M-5.6 7.5h11.2M-6.2 11.5h12.4", { "stroke-width": 1.4 });
  o += P("hx-rock-dk", dot(-3, -6.5, 2.4) + dot(1.5, -7.6, 2.6) + dot(4.5, -6, 2), { "stroke-width": 1.1 });
  o += P("hx-cart", "M-7 -6H7L5 1H-5Z", { "stroke-width": 1.3 }) + C("hx-wheel", -3.5, 2, 1.8, { "stroke-width": 1 }) + C("hx-wheel", 3.5, 2, 1.8, { "stroke-width": 1 });
  o += P("hx-gem", "M-1 -6L1 -10.5L3 -6Z", { "stroke-width": 1 });
  return g(o, { id: "hx-mine" }, "hx-o");
}
function rock() {
  return g(shadow(1, 1, 5, 0.2) + P("hx-rock-lt", "M-5 0Q-5 -5 -1 -5.5Q4 -6 5 0Z", { "stroke-width": 1.3 }) + P("hx-rock-dk", "M1 -5.6Q4 -5.4 5 0H1.5Q2.6 -3 1 -5.6Z", flat({ opacity: 0.6 })), { id: "hx-rock" }, "hx-o");
}
function cactus() {
  const arms = "M2.5 -11h4.5a2.8 2.8 0 0 0 2.8 -2.8v-6M-2.5 -11h-4.5a2.8 2.8 0 0 1 -2.8 -2.8v-3";
  let o = shadow(3, 1, 9, 0.25) + P("hx-l-ink", arms, { "stroke-width": 7.4 }) + P("hx-l-cactus", arms, { "stroke-width": 4.4 });
  o += Rect("hx-cactus", -3.6, -25, 7.2, 25.5, 3.6, { "stroke-width": 1.6 });
  o += P("hx-l-cactus-dk", "M1.3 -22V-1", { "stroke-width": 1.4 }) + P("hx-l-cactus-lt", "M-1.4 -22V-2", { "stroke-width": 1.1 });
  return g(o + C("hx-blossom", 0, -25.5, 1.8, { "stroke-width": 0.8 }), { id: "hx-cactus" }, "hx-o");
}
function palm() {
  const top = [7, -30];
  const trunk = `M0 0Q-2 -16 ${p(...top)}`;
  let o = shadow(8, 1, 12, 0.22) + P("hx-l-ink", trunk, { "stroke-width": 6.4 }) + P("hx-l-palm-trunk", trunk, { "stroke-width": 4 });
  let rings = "";
  for (let k = 1; k < 5; k++) {
    const t = k / 5, bx = 2 * (1 - t) * t * -2 + t * t * top[0], by = 2 * (1 - t) * t * -16 + t * t * top[1];
    rings += `M${p(bx - 2, by)}l4 -1`;
  }
  o += P("hx-l-palm-ring", rings, { "stroke-width": 1 });
  for (const [dx, dy, mx, my] of [[-20, 4, -11, -9], [20, 6, 11, -8], [-14, 12, -10, 0], [15, 13, 10, 1], [0, -16, -6, -12]])
    o += P("hx-palm", `M${p(...top)}Q${p(top[0] + mx, top[1] + my)} ${p(top[0] + dx, top[1] + dy)}Q${p(top[0] + mx * 0.55 + dy * 0.12, top[1] + my * 0.2 + 3)} ${p(...top)}Z`, { "stroke-width": 1.4 });
  o += C("hx-trunk", top[0] - 1.5, top[1] + 2, 2, { "stroke-width": 0.9 }) + C("hx-trunk", top[0] + 2, top[1] + 2.5, 2, { "stroke-width": 0.9 });
  return g(o, { id: "hx-palm" }, "hx-o");
}
function bones() {
  const bone = (x1, y1, x2, y2, cls, w, r) => P(cls, `M${p(x1, y1)}L${p(x2, y2)}`, { "stroke-width": w }) + P(cls.replace("hx-l-", "hx-"), [[x1, y1], [x2, y2]].map(([a, c]) => dot(a - 1, c, r) + dot(a + 1, c + 0.6, r)).join(""), FLAT);
  const pair = (cls, w, r) => bone(-7, 1, 6, -2, cls, w, r) + bone(-4, -4, 5, 3, cls, w, r);
  return g(shadow(0, 2, 9, 0.18) + pair("hx-l-ink", 4.4, 1.9) + pair("hx-l-bone", 2.2, 1.2), { id: "hx-bones" }, "hx-o");
}
function camel() {
  const legs = "M-7 -9V0M-3.5 -9V0M5 -9V0M8.5 -9V0";
  let o = shadow(1, 1, 14, 0.22) + P("hx-l-ink", legs, { "stroke-width": 3.4 }) + P("hx-l-camel", legs, { "stroke-width": 1.6 });
  o += P("hx-camel", "M-11 -8C-12.5 -15 -7 -18 -3.5 -14.5C-1.5 -21 5 -21 7 -14.5C9.5 -14.5 11.5 -12 11 -8Q0 -6 -11 -8Z", { "stroke-width": 1.5 });
  o += P("hx-camel", "M9.5 -11C12.5 -13 12.5 -19.5 15 -21.5L19.5 -21.5C21 -20.5 21 -18.6 18.6 -18.2L16.8 -17.8C16 -14.5 14 -11 11 -8.5Z", { "stroke-width": 1.5 });
  o += P("hx-l-camel-lt", "M-8.5 -12C-7 -15 -5 -15.5 -3.6 -14", { "stroke-width": 1.4 }) + C("hx-face", 17.6, -20.2, 0.8, FLAT) + P("hx-l-ink", "M-11.2 -10.5Q-13.5 -9 -13 -6", { "stroke-width": 1.1 });
  return g(o, { id: "hx-camel" }, "hx-o");
}
function boat() {
  let o = P("hx-l-wave", "M-16 6q16 4 32 0", { "stroke-width": 2, opacity: 0.9 });
  o += P("hx-hull", "M-13 -1H13L9 6H-9Z", { "stroke-width": 1.6 }) + P("hx-l-hull-lt", "M-11 1.5H11", { "stroke-width": 1.3 });
  o += P("hx-l-ink", "M0 -1V-24", { "stroke-width": 1.8 });
  o += P("hx-sail", "M1.5 -23Q12 -12 10 -4H1.5Z", { "stroke-width": 1.5 }) + P("hx-sail-2", "M-1.5 -18Q-8 -10 -8 -4H-1.5Z", { "stroke-width": 1.5 });
  o += P("hx-flag", "M0 -24L6 -26.5L0 -28Z", { "stroke-width": 1 });
  o += E("hx-halo", -10, -4, 6, 6, FLAT) + C("hx-window", -10, -3.5, 1.5, { "stroke-width": 0.8 });
  return g(o, { id: "hx-boat" }, "hx-o");
}

// ---------- shared defs ----------
const TERRAIN_GRADIENTS = TERRAIN_NAMES.map(
  (t) => `<radialGradient id="hx-g-${t}" cx=".42" cy=".36" r=".72"><stop offset="0" class="hx-${t}-hi"/><stop offset=".7" class="hx-${t}-mid"/><stop offset="1" class="hx-${t}-lo"/></radialGradient>`,
).join("");
const wheatPattern = (id, angle, h) =>
  `<pattern id="hx-${id}" width="14" height="${h}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})"><rect class="hx-${id}-bg" width="14" height="${h}"/><rect class="hx-${id}-row" y="${h - 4}" width="14" height="4"/><path class="hx-${id}-stalk" d="M3 ${h - 4}q0-4 1.5-6M7 ${h - 4}q0-4.5 0-7M11 ${h - 4}q0-4-1.5-6" stroke-width="1"/><ellipse class="hx-${id}-ear" cx="7" cy="2.6" rx="1.4" ry="2.4"/></pattern>`;

let defsCache = "";
export function defsSvg() {
  defsCache ||=
    "<defs>" +
    TERRAIN_GRADIENTS +
    `<radialGradient id="hx-sea" cx=".5" cy=".5" r=".72"><stop offset=".35" class="hx-sea-mid"/><stop offset="1" class="hx-sea-deep"/></radialGradient>` +
    `<radialGradient id="hx-halo"><stop offset="0" class="hx-halo-in"/><stop offset="1" class="hx-halo-out"/></radialGradient>` +
    `<linearGradient id="hx-beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" class="hx-halo-in"/><stop offset="1" class="hx-halo-out"/></linearGradient>` +
    wheatPattern("wheat-a", -16, 13) +
    wheatPattern("wheat-b", 28, 12) +
    wheatPattern("wheat-c", -6, 11) +
    `<clipPath id="hx-clip"><path d="${HEX_D}"/></clipPath>` +
    pine("pine", "hx-pine", 3, 22, 5, 8.5, 15) +
    pine("fir", "hx-fir", 4, 19, 3.6, 7.6, 13) +
    oak("oak", "hx-leaf", false) +
    oak("apple", "hx-leaf2", true) +
    bush() + logs() + mushrooms() + sheep() + fence() + kiln() + bricks() + barrow() + sheaf() + hay() + mill() + sails() + gems() + mine() + rock() + cactus() + palm() + bones() + camel() + boat() +
    "</defs>";
  return defsCache;
}

// ---------- terrain ----------
// Each draws into { ground, items: [[baseY, markup]] } for one hex.
function forest(rng) {
  const items = [], taken = [];
  let ground = E("hx-forest-clear", 0, 4, 46, 42, flat({ opacity: 0.55 }));
  ground += P("hx-forest-dk", scatterPts(rng, 6, 70).map(([x, y]) => `M${p(x - 16, y)}a16 9 0 1 0 32 0a16 9 0 1 0 -32 0`).join(""), flat({ opacity: 0.3 }));
  ground += P("hx-l-forest-tuft", tufts(inTile(scatterPts(rng, 16, 85)), 1.2), { "stroke-width": 1.3 });
  const pines = between(rng, 0.35, 0.85);
  const extra = rng();
  if (extra < 0.45) {
    const s = spot(rng, taken, AREAS.any, 34, 20, { tries: 80 });
    if (s) items.push([s.y, use("logs", s.x, s.y)]);
  } else if (extra < 0.8) {
    const s = spot(rng, taken, AREAS.any, 16, 12, { tries: 80 });
    if (s) items.push([s.y, use("shrooms", s.x, s.y)]);
  }
  for (let i = 0; i < 160 && items.length < 17; i++) {
    const k = between(rng, 1, 1.22);
    const conifer = rng() < pines;
    const s = spot(rng, taken, AREAS.any, (conifer ? 15 : 21) * k, (conifer ? 40 : 33) * k, { pad: 8, tries: 4, m: 0 });
    if (!s) continue;
    const kind = conifer ? (rng() < 0.4 ? "fir" : "pine") : rng() < 0.18 ? "apple" : "oak";
    items.push([s.y, use(kind, s.x, s.y, k)]);
  }
  return { ground, items };
}

function hills(rng, id) {
  const items = [], taken = [];
  const m = side(rng);
  const top = between(rng, -34, -18), low = between(rng, 30, 50);
  let ground = P("hx-hills-lt", `M-110 ${n(top)}Q-40 ${n(top - 20)} 10 ${n(top - 2)}T110 ${n(top - 10)}V-110H-110Z`, flat({ opacity: 0.7 }));
  ground += P("hx-hills-dk", `M-110 ${n(low)}Q-30 ${n(low - 18)} 30 ${n(low + 4)}T110 ${n(low - 4)}V110H-110Z`, flat({ opacity: 0.7 }));
  ground += P("hx-l-hills-tuft", tufts(inTile(scatterPts(rng, 9, 75)), 1.1), { "stroke-width": 1.3 });
  ground += P("hx-hills-dk", inTile(scatterPts(rng, 10, 80)).map(([x, y]) => dot(x, y, between(rng, 1, 2.2))).join(""), flat({ opacity: 0.7 }));
  const mound = (x, y, w, h) => {
    taken.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y + 2 });
    items.push([
      y,
      shadow(x + 3, y + 1, w * 0.55) +
        P("hx-clay", `M${p(x - w / 2, y)}C${p(x - w / 2.4, y - h * 1.32)} ${p(x + w / 2.4, y - h * 1.32)} ${p(x + w / 2, y)}Q${p(x, y + 3)} ${p(x - w / 2, y)}Z`, { "stroke-width": 1.7 }) +
        P("hx-l-clay-lt", `M${p(x - w * 0.36, y - h * 0.3)}Q${p(x - w * 0.25, y - h * 0.86)} ${p(x - w * 0.02, y - h * 0.94)}`, { "stroke-width": 3, opacity: 0.9 }) +
        P("hx-l-clay-dk", `M${p(x - w * 0.42, y - h * 0.2)}Q${p(x, y - h * 0.42)} ${p(x + w * 0.44, y - h * 0.24)}M${p(x - w * 0.3, y - h * 0.58)}Q${p(x + w * 0.05, y - h * 0.74)} ${p(x + w * 0.34, y - h * 0.6)}`, { "stroke-width": 1.4, opacity: 0.8 }),
    ]);
  };
  // Two mounds over the token, one more on a side.
  const w1 = between(rng, 40, 48), w2 = between(rng, 34, 42);
  mound(m * between(rng, -34, -26), between(rng, -40, -36), w1, w1 * 0.56);
  mound(m * between(rng, 24, 32), between(rng, -50, -44), w2, w2 * 0.55);
  if (id % 3 !== 1) {
    // a kiln on one side, bricks below the other
    const k = spot(rng, taken, mirror(AREAS.left, -m), 30, 44, { tries: 60 });
    if (k) items.push([k.y, use("kiln", k.x, k.y)]);
    const b = spot(rng, taken, mirror(AREAS.br, -m), 32, 16, { tries: 60 });
    if (b) items.push([b.y, use("bricks", b.x, b.y, 1.1)]);
    const w3 = between(rng, 24, 30);
    const s = spot(rng, taken, mirror(AREAS.left, m), w3, w3 * 0.55, { tries: 60 });
    if (s) {
      taken.pop();
      mound(s.x, s.y, w3, w3 * 0.55);
    }
  } else {
    // a clay pit, a barrow and a stack
    const px = m * between(rng, -10, 10), py = between(rng, 66, 72);
    ground += E("hx-clay-dk hx-o", px, py, 24, 10, { "stroke-width": 1.5 }) + E("hx-pit-water", px - 3, py + 1.5, 13, 4.5, FLAT) + E("hx-white", px - 7, py + 0.5, 5, 1.2, flat({ opacity: 0.6 }));
    taken.push({ x0: px - 26, x1: px + 26, y0: py - 10, y1: py + 12 });
    const b = spot(rng, taken, mirror(AREAS.left, -m), 32, 20, { tries: 60 });
    if (b) items.push([b.y, use("barrow", b.x, b.y, 1.1, m > 0)]);
    const s = spot(rng, taken, mirror(AREAS.left, m), 32, 16, { tries: 60 });
    if (s) items.push([s.y, use("bricks", s.x, s.y, 1.1)]);
  }
  return { ground, items };
}

function pasture(rng) {
  const items = [], taken = [];
  const top = between(rng, -38, -22), low = between(rng, 40, 56);
  let ground = P("hx-pasture-lt", `M-110 ${n(top)}Q-50 ${n(top - 34)} 0 ${n(top - 10)}T110 ${n(top - 18)}V-110H-110Z`, FLAT);
  ground += P("hx-pasture-dk", `M-110 ${n(low)}Q-40 ${n(low - 24)} 20 ${n(low - 2)}T110 ${n(low - 10)}V110H-110Z`, FLAT);
  ground += P("hx-l-pasture-line", `M-110 ${n(top)}Q-50 ${n(top - 34)} 0 ${n(top - 10)}T110 ${n(top - 18)}`, { "stroke-width": 1.6, opacity: 0.6 });
  const fl = inTile(scatterPts(rng, 18, 85));
  ground += P("hx-flower", fl.filter((_, i) => i % 2).map(([x, y]) => dot(x, y, 1.9)).join(""), FLAT);
  ground += P("hx-flower-2", fl.filter((_, i) => !(i % 2)).map(([x, y]) => dot(x, y, 1.9)).join(""), FLAT);
  ground += P("hx-flower-mid", fl.map(([x, y]) => dot(x, y, 0.8)).join(""), FLAT);
  ground += P("hx-l-pasture-tuft", tufts(inTile(scatterPts(rng, 8, 80)), 1.1), { "stroke-width": 1.3 });
  if (rng() < 0.8) {
    const f = spot(rng, taken, rng() < 0.5 ? AREAS.bl : AREAS.br, 28, 16, { tries: 60 });
    if (f) items.push([f.y, use("fence", f.x, f.y, 1.1)]);
  }
  const extra = rng();
  if (extra < 0.3) {
    const t = spot(rng, taken, AREAS.any, 24, 36, { tries: 60 });
    if (t) items.push([t.y, use(rng() < 0.5 ? "oak" : "apple", t.x, t.y, 1.05)]);
  } else if (extra < 0.55) {
    const w = spot(rng, taken, AREAS.any, 40, 10, { tries: 60 });
    if (w) ground += E("hx-water hx-o", w.x, w.y - 4, 18, 7, { "stroke-width": 1.5 }) + E("hx-water-lt", w.x - 4, w.y - 5.5, 7, 2, FLAT) + P("hx-l-reed", `M${p(w.x + 14, w.y - 2)}q1 -6 3 -8M${p(w.x + 17, w.y - 3)}q0 -5 -1 -9`, { "stroke-width": 1.4 });
  }
  if (rng() < 0.6) {
    const b = spot(rng, taken, AREAS.any, 20, 16, { tries: 60 });
    if (b) items.push([b.y, use("bush", b.x, b.y, 1.1)]);
  }
  const flock = 3 + (rng() < 0.4 ? 1 : 0);
  for (let i = 0, placed = 0; i < 12 && placed < flock; i++) {
    const lamb = placed === 3;
    const k = lamb ? 0.75 : between(rng, 1.05, 1.2);
    const s = spot(rng, taken, AREAS.any, 30 * k, 18 * k, { pad: 0, tries: 30, m: 8 });
    if (!s) continue;
    items.push([s.y, use("sheep", s.x, s.y, k, rng() < 0.5)]);
    placed++;
  }
  return { ground, items };
}

// The part of a 240-unit square on the far side of a line through x y at angle a.
function halfPlane(x, y, a) {
  const dx = Math.cos(a), dy = Math.sin(a);
  const sideOf = ([u, v]) => (u - x) * dy - (v - y) * dx;
  const sq = [[-120, -120], [120, -120], [120, 120], [-120, 120]];
  const out = [];
  sq.forEach((q, i) => {
    const r = sq[(i + 1) % 4], sq0 = sideOf(q), sr = sideOf(r);
    if (sq0 >= 0) out.push(q);
    if (sq0 >= 0 !== sr >= 0) {
      const t = sq0 / (sq0 - sr);
      out.push([q[0] + (r[0] - q[0]) * t, q[1] + (r[1] - q[1]) * t]);
    }
  });
  return "M" + out.map((q) => p(...q)).join("L") + "Z";
}

function fields(rng, id) {
  const items = [], taken = [];
  const patterns = ["wheat-a", "wheat-b", "wheat-c"];
  const first = Math.floor(rng() * 3);
  const a = between(rng, -0.5, 0.5) + (rng() < 0.5 ? 0 : Math.PI / 2);
  const ox = between(rng, -30, 30), oy = between(rng, -20, 20);
  const track = (x, y, ang) => `M${p(x - Math.cos(ang) * 140, y - Math.sin(ang) * 140)}L${p(x + Math.cos(ang) * 140, y + Math.sin(ang) * 140)}`;
  let ground = Rect("", -110, -110, 220, 220, 0, { fill: `url(#hx-${patterns[first]})` });
  ground += P("", halfPlane(ox, oy, a), { fill: `url(#hx-${patterns[(first + 1) % 3]})` });
  let lines = track(ox, oy, a);
  if (rng() < 0.5) {
    const b = a + Math.PI / 2 + between(rng, -0.3, 0.3), bx = ox + between(rng, -40, 40), by = oy + between(rng, -40, 40);
    ground += P("", halfPlane(bx, by, b), { fill: `url(#hx-${patterns[(first + 2) % 3]})` });
    lines += track(bx, by, b);
  }
  ground += P("hx-l-track", lines, { "stroke-width": 6 }) + P("hx-l-track-lt", lines, { "stroke-width": 1.6, "stroke-dasharray": "3 6" });
  if (id % 2 === 0) {
    const where = rng() < 0.5 ? AREAS.left : AREAS.right;
    const s = spot(rng, taken, where, 34, 44, { tries: 80, m: 2 }) || spot(rng, taken, AREAS.top, 34, 44, { tries: 80, m: 2 });
    if (s) items.push([s.y, use("mill", s.x, s.y) + g(g(`<use href="#hx-sails"/>`, {}, "hx-spin"), { transform: `translate(${p(s.x, s.y - 24)})` })]);
  } else if (rng() < 0.7) {
    const s = spot(rng, taken, AREAS.any, 30, 18, { tries: 80 });
    if (s) items.push([s.y, use("hay", s.x, s.y, 1.1)]);
  }
  for (let i = 0, placed = 0, want = 2 + (rng() < 0.5 ? 1 : 0); i < 10 && placed < want; i++) {
    const k = between(rng, 0.9, 1.08);
    const s = spot(rng, taken, AREAS.any, 14 * k, 28 * k, { tries: 30, pad: 4 });
    if (!s) continue;
    items.push([s.y, use("sheaf", s.x, s.y, k)]);
    placed++;
  }
  return { ground, items };
}

function peak(x, y, w, h, snow = true) {
  const ax = x - w * 0.04, ay = y - h, rx = x + w * 0.1;
  let o = shadow(x + 4, y + 1, w * 0.55);
  o += P("hx-rock-lt", `M${p(x - w / 2, y)}L${p(ax, ay)}L${p(x + w / 2, y)}Q${p(x, y + 3)} ${p(x - w / 2, y)}Z`, { "stroke-width": 1.9 });
  o += P("hx-rock-dk", `M${p(ax, ay)}L${p(x + w / 2, y)}Q${p(x + w * 0.3, y + 2)} ${p(rx, y + 1.5)}L${p(x + w * 0.02, y - h * 0.45)}Z`, FLAT);
  o += P("hx-l-rock", `M${p(x - w * 0.28, y - h * 0.18)}L${p(x - w * 0.16, y - h * 0.42)}M${p(x - w * 0.1, y - h * 0.1)}L${p(x - w * 0.02, y - h * 0.3)}`, { "stroke-width": 1.3 });
  if (snow) {
    const sl = (t) => ax + (x - w / 2 - ax) * t, sr = (t) => ax + (x + w / 2 - ax) * t;
    o += P("hx-snow", `M${p(sl(0.34), ay + h * 0.34)}L${p(ax, ay)}L${p(sr(0.34), ay + h * 0.34)}L${p(sr(0.18), ay + h * 0.27)}L${p(ax + w * 0.04, ay + h * 0.38)}L${p(ax - w * 0.06, ay + h * 0.26)}Z`, { "stroke-width": 1.5 });
    o += P("hx-snow-dk", `M${p(ax, ay + 1)}L${p(sr(0.33), ay + h * 0.335)}L${p(sr(0.18), ay + h * 0.27)}L${p(ax + w * 0.04, ay + h * 0.38)}Z`, FLAT);
  }
  return o;
}

function mountains(rng, id) {
  const items = [];
  const m = side(rng);
  let ground = P("hx-mountains-dk", inTile(scatterPts(rng, 16, 85)).map(([x, y]) => dot(x, y, between(rng, 1, 2.6))).join(""), flat({ opacity: 0.7 }));
  const low = between(rng, 40, 48);
  ground += P("hx-meadow", `M-110 ${n(low)}Q-30 ${n(low - 20)} 20 ${n(low + 6)}T110 ${n(low - 10)}V110H-110Z`, flat({ opacity: 0.9 }));
  ground += P("hx-meadow-dk", `M-110 ${n(low + 24)}Q-40 ${n(low + 10)} 10 ${n(low + 28)}T110 ${n(low + 18)}V110H-110Z`, flat({ opacity: 0.9 }));
  ground += P("hx-l-mountains-tuft", tufts(inTile([-56, -28, 0, 28, 56].map((x, i) => [x + between(rng, -6, 6), low + 30 + (i % 2) * 8])), 1.1), { "stroke-width": 1.3 });
  // A range over the token, a big peak running off one side, a lesser one on the other.
  items.push([-40, peak(m * between(rng, -34, -28), -40, between(rng, 50, 56), between(rng, 34, 38))]);
  items.push([-36, peak(m * between(rng, 10, 16), -36, between(rng, 62, 68), between(rng, 46, 50))]);
  items.push([14, peak(m * -66, 14, 62, between(rng, 56, 62))]);
  items.push([18, peak(m * between(rng, 64, 68), between(rng, 16, 22), between(rng, 46, 52), between(rng, 40, 46), rng() < 0.6)]);
  if (id % 2 === 1) {
    items.push([78, use("mine", m * between(rng, -4, 8), between(rng, 74, 78))]);
    items.push([64, use("gems", -m * between(rng, 36, 44), between(rng, 62, 68), 1.2)]);
  } else {
    items.push([76, use("gems", m * between(rng, -30, 30), between(rng, 74, 80), 1.3)]);
    items.push([60, use("rock", -m * between(rng, 36, 46), between(rng, 56, 62), 1.3)]);
    if (rng() < 0.5) {
      const lx = -m * between(rng, 6, 14), ly = between(rng, 84, 88);
      ground += E("hx-water hx-o", lx, ly - 4, 17, 6, { "stroke-width": 1.5 }) + E("hx-water-lt", lx - 4, ly - 5.5, 6, 1.6, FLAT);
    }
  }
  items.push([50, use("rock", m * between(rng, 34, 44), between(rng, 46, 52), 1.1)]);
  return { ground, items };
}

function desert(rng) {
  const items = [], taken = [];
  const m = side(rng);
  const dune = (x, y, w, h) =>
    P("hx-dune-lt", `M${p(x - w, y)}Q${p(x - w * 0.2, y - h)} ${p(x + w, y)}Q${p(x + w * 0.1, y + h * 0.5)} ${p(x - w, y)}Z`, FLAT) +
    P("hx-dune-dk", `M${p(x - w * 0.2, y - h * 0.5)}Q${p(x + w * 0.4, y - h * 0.3)} ${p(x + w, y)}Q${p(x + w * 0.3, y + h * 0.2)} ${p(x - w * 0.2, y - h * 0.5)}Z`, flat({ opacity: 0.8 })) +
    P("hx-l-dune", `M${p(x - w, y)}Q${p(x - w * 0.2, y - h)} ${p(x + w, y)}`, { "stroke-width": 1.4, opacity: 0.6 });
  const j = () => between(rng, -8, 8);
  let ground = dune(m * -30 + j(), -46 + j(), 58, 26) + dune(m * 48 + j(), -4 + j(), 56, 24) + dune(m * -48 + j(), 30 + j(), 50, 22) + dune(m * 20 + j(), 74 + j(), 60, 20);
  ground += P("hx-dune-dk", inTile(scatterPts(rng, 14, 85)).map(([x, y]) => dot(x, y, between(rng, 0.8, 1.8))).join(""), flat({ opacity: 0.6 }));
  // The oasis below the token, its palm leaning out.
  const ox = m * between(rng, 0, 10), oy = between(rng, 74, 78);
  ground += E("hx-oasis-sand", ox, oy, 30, 12, FLAT) + E("hx-water hx-o", ox, oy, 25, 9, { "stroke-width": 1.6 }) + E("hx-water-lt", ox - 5, oy - 2, 10, 2.6, flat({ opacity: 0.9 }));
  ground += P("hx-l-reed", `M${p(ox - 23, oy + 2)}q-1 -8 -3 -11M${p(ox - 19, oy + 3)}q0 -9 1 -13M${p(ox + 22, oy + 3)}q1 -7 3 -9`, { "stroke-width": 1.6 });
  taken.push({ x0: ox - 30, x1: ox + 30, y0: oy - 12, y1: oy + 12 });
  items.push([oy - 2, use("palm", ox + m * 20, oy - 1, 0.95, m < 0)]);
  taken.push({ x0: ox + m * 20 - 22, x1: ox + m * 20 + 22, y0: oy - 48, y1: oy });
  const finds = [["cactus", 18, 27, 1], ["cactus", 18, 27, 0.8], [rng() < 0.6 ? "camel" : "cactus", 34, 24, 1.05], ["bones", 20, 10, 1.05], ["rock", 12, 8, 1.2], ["rock", 12, 8, 0.8]];
  for (const [what, w, h, k] of finds) {
    const s = spot(rng, taken, AREAS.any, w * k, h * k, { tries: 60, pad: 2 });
    if (s) items.push([s.y, use(what, s.x, s.y, k, what !== "bones" && rng() < 0.5)]);
  }
  return { ground, items };
}

const ART = [forest, hills, pasture, fields, mountains, desert];

// One hex at its board position. hex: a HEXES entry or its id.
export function terrainSvg(terrain, hex) {
  const h = typeof hex === "number" ? HEXES[hex] : hex;
  const name = TERRAIN_NAMES[terrain];
  const { ground, items } = ART[terrain](rngFromSeed(`${name} ${h.id}`), h.id);
  const objects = items.sort((a, b) => a[0] - b[0]).map((i) => i[1]).join("");
  return (
    `<g class="hx-tile hx-${name}" transform="translate(${p(h.x * R, h.y * R)})">` +
    P("", HEX_D, { fill: `url(#hx-g-${name})` }) +
    `<g clip-path="url(#hx-clip)">${ground}<g class="hx-o">${objects}</g></g>` +
    P("hx-tile-hi", HEX_IN) +
    P(`hx-rim hx-${name}-rim`, HEX_D) +
    "</g>"
  );
}

// ---------- sea ----------
const COAST_PTS = (() => {
  const ids = new Set(COAST.flatMap((e) => [EDGES[e].a, EDGES[e].b]));
  return [...ids].map((i) => [CORNERS[i].x * R, CORNERS[i].y * R]).sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
})();
const COAST_D = "M" + COAST_PTS.map((q) => p(...q)).join("L") + "Z";

function coastDistance(x, y) {
  let best = Infinity, inside = false;
  COAST_PTS.forEach(([ax, ay], i) => {
    const [bx, by] = COAST_PTS[(i + 1) % COAST_PTS.length];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)));
    if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) inside = !inside;
  });
  return inside ? -best : best;
}

// Where the sea's decorations sit, clear of the harbours.
const DECOR = {
  compass: [-404, 392],
  whale: [392, -432],
  lighthouse: [-420, -420],
  glints: [372, 400],
  boats: [[452, 86], [-214, 462], [-196, -446]],
  fish: [[-470, 118, 1], [258, 462, -1], [470, -150, -1]],
  gulls: [[-312, -462, 1], [-284, -450, 0.75], [300, -462, 0.85], [-470, 300, 0.8]],
};
const BADGE_SPOTS = HARBOUR_EDGES.map((e) => harbourGeometry(e).badge);

function wave(x, y, s) {
  return `M${p(x - 14 * s, y)}q${n(3.5 * s)} ${n(-5 * s)} ${n(7 * s)} 0t${n(7 * s)} 0t${n(7 * s)} 0`;
}
function compass([x, y]) {
  let o = C("hx-l-compass", x, y, 34, { "stroke-width": 1.6 }) + C("hx-l-compass", x, y, 27, { "stroke-width": 1, "stroke-dasharray": "2 4" });
  for (let k = 0; k < 4; k++) {
    const r = `rotate(${k * 90} ${x} ${y})`;
    o += g(P(k ? "hx-compass-a" : "hx-compass-n", `M${x} ${y - 40}L${x + 7} ${y - 7}L${x} ${y}Z`) + P(k ? "hx-compass-b" : "hx-compass-n2", `M${x} ${y - 40}L${x - 7} ${y - 7}L${x} ${y}Z`), { transform: r });
    o += P("hx-compass-b", `M${x} ${y - 24}L${x + 4} ${y - 4}L${x - 4} ${y - 4}Z`, { transform: `rotate(${k * 90 + 45} ${x} ${y})`, "stroke-width": 1 });
  }
  return g(o + C("hx-compass-a", x, y, 3.5) + `<text class="hx-compass-text" x="${x}" y="${y - 46}" text-anchor="middle">N</text>`, { "stroke-width": 1.2 }, "hx-compass");
}
function whale([x, y]) {
  return g(
    P("hx-l-wave", `M${x - 30} ${y + 6}q14 -3 30 0t30 0`, { "stroke-width": 2 }) +
      P("hx-whale", `M${x - 22} ${y + 4}C${x - 22} ${y - 14} ${x + 8} ${y - 18} ${x + 18} ${y - 4}L${x + 26} ${y - 14}L${x + 30} ${y - 11}L${x + 24} ${y + 4}Z`, { "stroke-width": 1.6 }) +
      P("hx-l-whale-lt", `M${x - 18} ${y + 1}C${x - 12} ${y - 4} ${x + 4} ${y - 4} ${x + 12} ${y}`, { "stroke-width": 1.4 }) +
      C("hx-whale-eye", x - 12, y - 5, 1.6, FLAT) +
      g(P("hx-l-spout", `M${x - 14} ${y - 15}q-3 -7 -8 -9M${x - 14} ${y - 15}q1 -8 5 -11M${x - 14} ${y - 15}q-1 -9 -1.5 -12`, { "stroke-width": 1.8 }), {}, "hx-spout"),
    {},
    "hx-whale-ink",
  );
}
function fish([x, y, dir]) {
  return g(P("hx-fish", "M-10 0Q-2 -7 7 0Q-2 7 -10 0ZM6 0L12 -5L12 5Z", FLAT) + P("hx-l-wave", "M-24 3q4 -3 8 0", { "stroke-width": 1.6 }), { transform: `translate(${x} ${y}) scale(${dir} 1)` });
}
function lighthouse([x, y]) {
  let o = P("hx-band-2", `M${x - 46} ${y + 18}C${x - 50} ${y - 4} ${x - 20} ${y - 20} ${x + 8} ${y - 14}C${x + 40} ${y - 10} ${x + 52} ${y + 10} ${x + 36} ${y + 24}C${x + 14} ${y + 36} ${x - 36} ${y + 34} ${x - 46} ${y + 18}Z`, FLAT);
  o += P("hx-sand", `M${x - 34} ${y + 14}C${x - 36} ${y} ${x - 14} ${y - 10} ${x + 6} ${y - 6}C${x + 28} ${y - 3} ${x + 38} ${y + 10} ${x + 26} ${y + 18}C${x + 10} ${y + 26} ${x - 26} ${y + 25} ${x - 34} ${y + 14}Z`, { "stroke-width": 1.6 });
  o += P("hx-rock-lt", `M${x + 8} ${y + 14}Q${x + 10} ${y + 2} ${x + 18} ${y + 3}Q${x + 27} ${y + 4} ${x + 26} ${y + 14}Z`, { "stroke-width": 1.4 });
  o += P("hx-rock-lt", `M${x - 30} ${y + 14}Q${x - 28} ${y + 6} ${x - 22} ${y + 7}Q${x - 16} ${y + 8} ${x - 17} ${y + 15}Z`, { "stroke-width": 1.4 });
  o += P("hx-beam", `M${x - 3} ${y - 45}L${x + 96} ${y - 74}L${x + 104} ${y - 30}Z`, FLAT);
  o += E("hx-halo", x - 3, y - 45, 22, 22, FLAT);
  o += P("hx-tower", `M${x - 11} ${y + 8}L${x - 7} ${y - 38}H${x + 1}L${x + 5} ${y + 8}Z`, { "stroke-width": 1.6 });
  o += P("hx-tower-band", `M${x - 9.4} ${y - 10}L${x - 8.7} ${y - 18}H${x + 2.7}L${x + 3.4} ${y - 10}ZM${x - 10.6} ${y + 4}L${x - 10} ${y - 3}H${x + 4}L${x + 4.6} ${y + 4}Z`, { "stroke-width": 1.2 });
  o += Rect("hx-window", x - 7, y - 50, 8, 10, 1.5, { "stroke-width": 1.3 }) + P("hx-tower-roof", `M${x - 9} ${y - 50}L${x - 3} ${y - 58}L${x + 3} ${y - 50}Z`, { "stroke-width": 1.4 });
  o += Rect("hx-tower", x - 10, y - 41, 14, 3, 1, { "stroke-width": 1.2 });
  return g(o, {}, "hx-o");
}

export function seaSvg(board) {
  const rng = rngFromSeed(`sea ${board?.terrain ?? ""}`);
  const S = 2 * HALF;
  const busy = [
    [...DECOR.compass, 70], [...DECOR.whale, 50], [...DECOR.lighthouse, 70], [...DECOR.glints, 50],
    ...DECOR.boats.map(([x, y]) => [x, y, 40]), ...DECOR.fish.map(([x, y]) => [x, y, 32]), ...BADGE_SPOTS.map(([x, y]) => [x, y, 46]),
  ];
  const waves = ["", ""];
  for (let i = 0, k = 0; i < 400 && k < 52; i++) {
    const x = between(rng, -HALF + 24, HALF - 30), y = between(rng, -HALF + 20, HALF - 16);
    const s = between(rng, 0.65, 1.1);
    if (coastDistance(x, y) < 126 || busy.some(([bx, by, r]) => Math.hypot(x - bx, y - by) < r)) continue;
    busy.push([x, y, 34]);
    waves[k++ % 2] += wave(x, y, s);
  }
  // waves inside the shallow water, lighter
  const ripples = [];
  for (let i = 0; i < 400 && ripples.length < 18; i++) {
    const x = between(rng, -HALF + 20, HALF - 20), y = between(rng, -HALF + 20, HALF - 20);
    const d = coastDistance(x, y);
    if (d < 50 || d > 100 || busy.some(([bx, by, r]) => Math.hypot(x - bx, y - by) < r)) continue;
    busy.push([x, y, 40]);
    ripples.push(wave(x, y, 0.55));
  }
  const [gx, gy] = DECOR.glints;
  const glints = [[-20, -18, 16], [6, -12, 10], [-30, -4, 9], [-4, 2, 22], [20, 10, 8], [-16, 16, 14], [10, 24, 9]].map(([dx, dy, w]) => `M${p(gx + dx - w / 2, gy + dy)}h${w}`).join("");
  const band = (cls, d, w) => P(cls, COAST_D, { "stroke-width": 2 * d + w });
  const pebbles = COAST_PTS.filter((_, i) => i % 2 === 0).map(([x, y]) => {
    const l = Math.hypot(x, y);
    return dot(x + (x / l) * 14 + between(rng, -9, 9), y + (y / l) * 14 + between(rng, -4, 4), 2.2);
  });
  return (
    `<g class="hx-sea">` +
    Rect("", -HALF, -HALF, S, S, 44, { fill: "url(#hx-sea)" }) +
    P("hx-l-wave hx-w1", waves[0], { "stroke-width": 2.2 }) +
    P("hx-l-wave hx-w2", waves[1], { "stroke-width": 2.2 }) +
    P("hx-l-glint", glints, { "stroke-width": 2.4 }) +
    P("hx-l-gull", DECOR.gulls.map(([x, y, k]) => `M${p(x - 7 * k, y)}q${n(3.5 * k)} ${n(-4.5 * k)} ${n(7 * k)} 0q${n(3.5 * k)} ${n(-4.5 * k)} ${n(7 * k)} 0`).join(""), { "stroke-width": 1.8 }) +
    compass(DECOR.compass) + whale(DECOR.whale) + DECOR.fish.map(fish).join("") +
    band("hx-l-band-line", 112, 3) + band("hx-l-band-1", 112, 0) +
    band("hx-l-band-faint", 90, 1.5) + band("hx-l-band-1", 90, 0) +
    band("hx-l-band-line", 68, 3) + band("hx-l-band-2", 68, 0) +
    P("hx-l-wave hx-w2 hx-ripple", ripples.join(""), { "stroke-width": 1.8 }) +
    band("hx-l-foam", 36, 0) + band("hx-l-sand-dk", 27, 0) + band("hx-l-sand", 24, 0) +
    P("hx-path", COAST_D) +
    P("hx-sand-dk", pebbles.join(""), FLAT) +
    lighthouse(DECOR.lighthouse) +
    DECOR.boats.map(([x, y], i) => g(g(use("boat", 0, 0), {}, i ? `hx-bob hx-bob-${i}` : "hx-bob"), { transform: `translate(${x} ${y}) scale(1.15)` })).join("") +
    Rect("hx-frame", -HALF + 3, -HALF + 3, S - 6, S - 6, 42) +
    "</g>"
  );
}

// ---------- harbours ----------
function harbourGeometry(edge) {
  const e = EDGES[edge], h = HEXES[e.hexes[0]];
  const l = Math.hypot(e.x - h.x, e.y - h.y);
  const nx = (e.x - h.x) / l, ny = (e.y - h.y) / l;
  const m = [e.x * R, e.y * R];
  const dock = [m[0] + nx * 52, m[1] + ny * 52];
  const ends = [CORNERS[e.a], CORNERS[e.b]].map((c) => {
    const a = [c.x * R * 0.9 + m[0] * 0.1, c.y * R * 0.9 + m[1] * 0.1];
    return [a, [a[0] + (dock[0] - a[0]) * 0.86, a[1] + (dock[1] - a[1]) * 0.86]];
  });
  return { ends, badge: [m[0] + nx * 86, m[1] + ny * 86] };
}

// A harbour on a coast edge: two jetties from its corners and a badge on the water.
export function harbourSvg({ edge, kind }) {
  const { ends, badge } = harbourGeometry(edge);
  const d = ends.map(([a, b]) => `M${p(...a)}L${p(...b)}`).join("");
  const art =
    E("hx-sh", 1.5, 4, 28, 26, flat({ opacity: 0.25 })) +
    C("hx-badge", 0, 0, 27, { "stroke-width": 1.8 }) +
    C(`hx-ring hx-ring-${kind === ANY ? "any" : kind}`, 0, 0, 22.8, { "stroke-width": 3 }) +
    (kind === ANY
      ? `<text class="hx-badge-text" x="0" y="6.5" text-anchor="middle">3:1</text>`
      : g(resourceGlyph(kind), { transform: "translate(-13 -19.5) scale(1.08)" }) + `<text class="hx-badge-text hx-badge-small" x="0" y="19" text-anchor="middle">2:1</text>`);
  return (
    `<g class="hx-harbour" data-edge="${edge}">` +
    P("hx-l-ink", d, { "stroke-width": 11 }) +
    P("hx-l-wood-lt", d, { "stroke-width": 7.6 }) +
    P("hx-l-wood", d, { "stroke-width": 7.6, "stroke-dasharray": "1.5 4.5" }) +
    P("hx-wood hx-o", ends.map(([, b]) => dot(...b, 4.5)).join(""), { "stroke-width": 1.4 }) +
    g(g(art, {}, "hx-badge-art"), { transform: `translate(${p(...badge)})` }, "hx-badge-at") +
    "</g>"
  );
}
