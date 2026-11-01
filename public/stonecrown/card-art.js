// Stonecrown's cards as SVG markup strings (no DOM): every design in CARDS as a
// little cut-paper diorama of its own building in shades of its colour, the
// backs of the three ages, and the icons the cards and the screen share.
// Colours are classes (sc-f-* fills, sc-s-* strokes) that card-art.css maps to
// --sc-* tokens for light and dark; a card's class sc-c-<colour> sets its five
// tones t0 (sky) to t4 (deepest). There are no ids or url() references, so a
// card can show any number of times on a page: a nested <svg> clips the scene
// and CSS rounds the corners. Depth comes from paper shadows, offset copies of
// each layer's shapes. A card is 100 x 140 units. The "mini" size (cities and
// neighbours, about 44 px wide) keeps its colour and a big effect in its top
// 84 units and slices from the top, so a box shorter than 100:140 shows just
// that band as a chip.

import { CARDS, RESOURCE_NAMES, SYMBOLS } from "./cards.js";

// ---------- drawing helpers ----------
const n = (v) => Math.round(v * 100) / 100;
const pt = (x, y) => `${n(x)} ${n(y)}`;
const pairs = (xy) => xy.reduce((a, v, i) => a + (i % 2 ? ` ${n(v)}` : `${i ? "L" : ""}${n(v)}`), "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// A role is a fill token, or "token:width" for a stroke.
function paint(role) {
  const i = role.indexOf(":");
  return i < 0 ? `class="sc-f-${role}"` : `class="sc-s-${role.slice(0, i)}" fill="none" stroke-width="${role.slice(i + 1)}"`;
}
const P = (d, role, extra = "") => `<path d="${d}" ${paint(role)}${extra}/>`;
const G = (t, inner) => `<g transform="${t}">${inner}</g>`;
const T = (x, y, size, role, s, extra = "") => `<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}" text-anchor="middle" class="sc-f-${role}"${extra}>${esc(s)}</text>`;

// Every shape winds clockwise, so shapes merged into one path add up; hole()
// and archHole() wind the other way and cut.
const R0 = (x, y, w, h) => `M${pt(x, y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
const dot = (x, y, r) => `M${pt(x - r, y)}a${n(r)} ${n(r)} 0 1 1 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 1 ${n(-2 * r)} 0Z`;
const hole = (x, y, r) => `M${pt(x - r, y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
const oval = (x, y, rx, ry) => `M${pt(x - rx, y)}a${n(rx)} ${n(ry)} 0 1 1 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 1 ${n(-2 * rx)} 0Z`;
const poly = (...xy) => `M${pairs(xy)}Z`;
const rr = (x, y, w, h, r) =>
  `M${pt(x + r, y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${pt(x + w, y + r)}V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${pt(x + w - r, y + h)}H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${pt(x, y + h - r)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${pt(x + r, y)}Z`;
const arch = (x, y, w, h) => `M${pt(x, y + h)}V${n(y + w / 2)}a${n(w / 2)} ${n(w / 2)} 0 0 1 ${n(w)} 0V${n(y + h)}Z`;
const archHole = (x, y, w, h) => `M${pt(x, y + h)}H${n(x + w)}V${n(y + w / 2)}a${n(w / 2)} ${n(w / 2)} 0 0 0 ${n(-w)} 0Z`;
const dome = (cx, y, rx, ry = rx) => `M${pt(cx - rx, y)}a${n(rx)} ${n(ry)} 0 0 1 ${n(2 * rx)} 0Z`;
const star = (cx, cy, ro, ri, k) => poly(...Array.from({ length: 4 * k }, (_, i) => { const j = i >> 1, r = j % 2 ? ri : ro, a = -Math.PI / 2 + (Math.PI * j) / k; return i % 2 ? cy + r * Math.sin(a) : cx + r * Math.cos(a); }));
const hillD = (y, b, yb = 96) => {
  const step = 104 / b.length;
  return `M-2 ${n(y)}` + b.map((h, i) => `Q${pt(-2 + step * (i + 0.5), y - h)} ${pt(-2 + step * (i + 1), y)}`).join("") + `V${yb}H-2Z`;
};
// A template of absolute "x y" pairs, moved to (x, y), scaled by k and mirrored by f = -1.
const tp = (tpl, x, y, k = 1, f = 1) => tpl.replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_, a, b) => pt(x + a * k * f, y + b * k));
const gearD = (cx, cy, ro, ri, teeth, hr = 0) => {
  const xy = [];
  for (let i = 0; i < teeth * 2; i++) {
    const a = (Math.PI * i) / teeth - Math.PI / 2, r = i % 2 ? ri : ro, da = (Math.PI / teeth) * 0.36;
    xy.push(cx + r * Math.cos(a - da), cy + r * Math.sin(a - da), cx + r * Math.cos(a + da), cy + r * Math.sin(a + da));
  }
  return poly(...xy) + (hr ? hole(cx, cy, hr) : "");
};

// Paper shadow: offset copies of the shapes, darker close in.
const SHADE = [[0.5, 2.4, 0.08], [0.3, 1.4, 0.12], [0, 0.7, 0.17]];
const shade = (d, k = 1) => SHADE.map(([x, y, o]) => `<path d="${d}" class="sc-f-shadow" transform="translate(${n(x * k)} ${n(y * k)})" opacity="${o}"/>`).join("");

// ---------- silhouettes ----------
const BODY = "M-2.4 0L-1.8 -6.4Q0 -7.6 1.8 -6.4L2.4 0Z";
const HORSE = "M-7 0L-6.6 -5.4Q-8.6 -6.2 -9.6 -10Q-8 -8.4 -7 -9Q-6 -10.8 -3 -10.8L3.4 -10.8Q5 -13 6.4 -14.6L7.2 -16.4L8 -14.8Q9.8 -13.6 10.2 -11.6L9.2 -10.8L7 -11.6Q6.4 -9.6 6 -7.6L5.6 -5.2L6.2 0L4.8 0L4.2 -4.8L-4 -5L-5.4 0Z";
const CAMEL = "M-8 0L-7.4 -7Q-9 -8 -9.6 -11Q-8 -9.6 -7 -10Q-5 -15 -2 -12Q0 -16 3 -11.6Q5 -11 6 -13L7 -17Q9 -18.6 10.6 -17L10.6 -15.8L8.6 -15.6L7.6 -10Q7 -8 5.6 -7L6 0L4.8 0L4.2 -6.6L-5 -6.8L-6.4 0Z";
const ANVIL = "M-6.5 -3L5.5 -3L5.5 -1.6Q3 -1.2 2 0.4L2 2L4 3.4L-4 3.4L-2 2L-2 0.4Q-4 -0.6 -7 -2.4Z";
const AMPHORA = "M-1.4 -12L1.4 -12Q1.4 -10 4 -8Q5.6 -5 3.6 -2Q2 0 1.4 0L-1.4 0Q-2 0 -3.6 -2Q-5.6 -5 -4 -8Q-1.4 -10 -1.4 -12Z";
// Guild emblems in a 14 x 14 box, gold on their banner.
const EMBLEMS = {
  pick: "M-6 -3Q0 -8 6 -3Q0 -5.4 -6 -3ZM-0.9 -5L0.9 -5L0.9 6.5L-0.9 6.5Z",
  anvil: ANVIL + "M-1 -7L4 -7L4 -4.8L-1 -4.8ZM-4.4 -6.4L-1 -6.4L-1 -5.4L-4.4 -5.4Z",
  purse: "M-2 -5L2 -5L1 -3.4Q6 -1 5 3.4Q4 6 0 6Q-4 6 -5 3.4Q-6 -1 -1 -3.4Z",
  owl: "M-4.5 6Q-6 0 -4.5 -4L-5 -7L-2 -5Q0 -5.8 2 -5L5 -7L4.5 -4Q6 0 4.5 6ZM-2 -2.8L-3.4 -1.2L-2 0.4L-0.6 -1.2ZM2 -2.8L0.6 -1.2L2 0.4L3.4 -1.2Z",
  eye: "M-7 0Q0 -7 7 0Q0 7 -7 0ZM0 -3L-3 0L0 3L3 0ZM0 -1.4L1.4 0L0 1.4L-1.4 0Z",
  swords: "M-6 -6L-4.6 -6.4L4.4 2.6L2.6 4.4L-6.4 -4.6ZM1.4 5.6L5.6 1.4L6.4 2.2L2.2 6.4ZM6.4 -4.6L-2.6 4.4L-4.4 2.6L4.6 -6.4L6 -6ZM-2.2 6.4L-6.4 2.2L-5.6 1.4L-1.4 5.6Z",
  anchor: "M-0.9 -4L0.9 -4L0.9 5.4L-0.9 5.4ZM-3.6 -3.6L3.6 -3.6L3.6 -2.2L-3.6 -2.2ZM6 1Q5 6 0 6.6Q-5 6 -6 1L-4.6 1.6Q-4 4.6 0 5Q4 4.6 4.6 1.6ZM0 -7.8L1.8 -6L0 -4.2L-1.8 -6ZM0 -6.8L-0.8 -6L0 -5.2L0.8 -6Z",
  book: "M-0.4 -3L-0.4 5Q-3 3.2 -7 4L-7 -4Q-3 -5 -0.4 -3ZM0.4 -3Q3 -5 7 -4L7 4Q3 3.2 0.4 5Z",
  scales: "M-0.7 -6L0.7 -6L0.7 5L-0.7 5ZM-3.5 5L3.5 5L3.5 6.6L-3.5 6.6ZM-6.5 -5L6.5 -5L6.5 -3.8L-6.5 -3.8ZM-7.6 0L-3.4 0Q-3.6 2.6 -5.5 2.6Q-7.4 2.6 -7.6 0ZM3.4 0L7.6 0Q7.4 2.6 5.5 2.6Q3.6 2.6 3.4 0ZM-5.9 -3.8L-5.1 -3.8L-4.6 0L-6.4 0ZM5.1 -3.8L5.9 -3.8L6.4 0L4.6 0Z",
  square: "M-6 -6L-3.6 -6L-3.6 3.6L6 3.6L6 6L-6 6ZM-1 -4.6L5 -6.4L3 -0.6Z",
};

// ---------- the scene kit ----------
// A scene is five layers of paper, back (0, the sky) to front (4). Each kit
// part adds shapes to a layer by role; a layer's shapes cast one paper shadow
// on the layers behind it. The window is 100 x 92: the cost sits top left, the
// age top right, and the effect plate covers the bottom middle (y 63 to 90).
const FLAT = new Set(["t0", "sun", "cloud", "night", "trim", "win", "lamp"]);
const STARS = [[24, 7], [40, 14], [56, 5], [70, 30], [94, 22], [30, 30], [62, 18]].map(([x, y], i) => star(x, y, 1.1 + (i % 3) * 0.4, 0.45, 4)).join("");
const KIT = {
  sky: (s) => s.add(0, "t0", R0(-2, -10, 104, 108)).add(0, "night", STARS),
  sun: (s, x = 78, y = 20, r = 7) => s.add(0, "sun", dot(x, y, r)),
  cloud: (s, x, y, k = 1) => s.add(0, "cloud", dot(x - 6 * k, y, 4 * k) + dot(x, y - 2.5 * k, 5.5 * k) + dot(x + 6 * k, y, 4 * k) + rr(x - 10 * k, y - 1 * k, 20 * k, 5 * k, 2.5 * k)),
  hills: (s, y, b, z = 1, t = "t1") => s.add(z, t, hillD(y, b)),
  ground: (s, y, b = [3, 2, 4], z = 4, t = "t3") => s.add(z, t, hillD(y, b)),
  ridge: (s, xy, z = 1, t = "t1") => s.add(z, t, `M-2 96L${pairs(xy)}L102 96Z`),
  snow: (s, caps, z = 1) => s.add(z, "trim", caps.map(([x, y, w]) => poly(x, y, x + w, y + w, x + w * 0.4, y + w * 0.75, x, y + w, x - w * 0.4, y + w * 0.75, x - w, y + w)).join("")),
  water: (s, y, z = 1, t = "t1") => s.add(z, t, R0(-2, y, 104, 98 - y)).add(z, "cream:0.7", [8, 30, 56, 80].map((x, i) => `M${pt(x, y + 3 + (i % 2) * 3)}q2 -1.4 4 0t4 0`).join("")),
  road: (s, d, z = 2, t = "trim") => s.add(z, t, d),
  rock: (s, x, y, w, z = 4, t = "t2") => s.add(z, t, `M${pt(x - w, y)}Q${pt(x - w, y - w * 0.8)} ${pt(x - w * 0.2, y - w * 0.9)}Q${pt(x + w * 0.8, y - w)} ${pt(x + w, y)}Z`),
  mound: (s, x, y, w, h, z = 3, t = "t2") => s.add(z, t, `M${pt(x - w / 2, y)}C${pt(x - w / 2.6, y - h * 1.3)} ${pt(x + w / 2.6, y - h * 1.3)} ${pt(x + w / 2, y)}Z`),
  quarry: (s, x, y, w, h, steps = 4, z = 2, t = "t2") => {
    const sw = w / steps, sh = (h * 0.7) / steps;
    let d = `M${pt(x, y)}V${n(y - h)}`, ln = "";
    for (let i = 0; i < steps; i++) {
      d += `h${n(sw)}v${n(sh)}`;
      ln += `M${pt(x + sw * i + 2, y - h + sh * i + 2)}v${n(sh - 3)}M${pt(x + sw * i + sw * 0.55, y - h + sh * i + 3)}v${n(sh - 4)}`;
    }
    s.add(z, t, d + `V${n(y)}Z`).add(z, "trim:0.7", ln);
  },
  // trees
  pine: (s, x, y, k = 1, z = 4, t = "t4") => {
    let d = R0(x - 0.8 * k, y - 3 * k, 1.6 * k, 3 * k);
    for (let i = 0; i < 3; i++) {
      const w = (12 - i * 3) * k, yb = y - 2 * k - i * 5 * k;
      d += `M${pt(x - w / 2, yb)}L${pt(x, yb - 9 * k)}L${pt(x + w / 2, yb)}Q${pt(x, yb + 2 * k)} ${pt(x - w / 2, yb)}Z`;
    }
    s.add(z, t, d);
  },
  cypress: (s, x, y, k = 1, z = 4, t = "t4") => s.add(z, t, `M${pt(x, y - 22 * k)}C${pt(x + 5 * k, y - 14 * k)} ${pt(x + 5 * k, y - 3 * k)} ${pt(x, y)}C${pt(x - 5 * k, y - 3 * k)} ${pt(x - 5 * k, y - 14 * k)} ${pt(x, y - 22 * k)}Z`),
  tree: (s, x, y, k = 1, z = 4, t = "t4") => s.add(z, t, R0(x - 1 * k, y - 7 * k, 2 * k, 7 * k) + dot(x - 4 * k, y - 9 * k, 4.4 * k) + dot(x + 4 * k, y - 9.5 * k, 4.6 * k) + dot(x, y - 13.5 * k, 5.4 * k) + dot(x, y - 8.5 * k, 4 * k)),
  bush: (s, x, y, k = 1, z = 4, t = "t4") => s.add(z, t, dot(x - 3 * k, y - 2 * k, 2.6 * k) + dot(x + 3 * k, y - 2 * k, 2.6 * k) + dot(x, y - 3.4 * k, 3.2 * k) + R0(x - 5.6 * k, y - 2 * k, 11.2 * k, 2 * k)),
  olive: (s, x, y, k = 1, z = 4, t = "t4") =>
    s.add(z, t, `M${pt(x - 1.6 * k, y)}Q${pt(x - 0.4 * k, y - 4 * k)} ${pt(x - 1.4 * k, y - 8 * k)}L${pt(x + 1 * k, y - 8 * k)}Q${pt(x + 0.4 * k, y - 4 * k)} ${pt(x + 1.8 * k, y)}Z` + oval(x, y - 10.5 * k, 9 * k, 3.6 * k) + dot(x - 5 * k, y - 12 * k, 3.4 * k) + dot(x + 4 * k, y - 12.6 * k, 3.8 * k) + dot(x, y - 13.8 * k, 3.6 * k)),
  palm: (s, x, y, k = 1, z = 4, t = "t4") => {
    let d = `M${pt(x - 0.8 * k, y)}Q${pt(x - 2 * k, y - 8 * k)} ${pt(x + 1 * k, y - 16 * k)}L${pt(x + 2.4 * k, y - 15.6 * k)}Q${pt(x, y - 8 * k)} ${pt(x + 0.8 * k, y)}Z`;
    const tx = x + 1.6 * k, ty = y - 16 * k;
    for (const [dx, dy] of [[-8, 2], [-6, -3], [0, -6], [6, -3], [8, 2]]) d += `M${pt(tx, ty)}Q${pt(tx + dx * k * 0.5, ty + (dy - 3.4) * k)} ${pt(tx + dx * k, ty + dy * k)}Q${pt(tx + dx * k * 0.5, ty + (dy - 1) * k)} ${pt(tx, ty)}Z`;
    s.add(z, t, d);
  },
  reeds: (s, x, y, k = 1, z = 4) =>
    s.add(z, "t4:0.7", [-2.4, -0.8, 0.8, 2.4].map((dx, i) => `M${pt(x + dx * k, y)}q${n(dx * 0.3 * k)} ${n(-5 * k)} ${n(dx * 0.8 * k)} ${n(-(7 + (i % 2) * 2) * k)}`).join("")).add(z, "t4", oval(x - 2.2 * k, y - 8 * k, 0.9 * k, 2 * k) + oval(x + 2.6 * k, y - 9.6 * k, 0.9 * k, 2 * k)),
  flowers: (s, xy, z = 4, t = "gold", r = 0.9) => s.add(z, t, xy.map(([x, y]) => dot(x, y, r)).join("")),
  // buildings: x is the left wall, y the ground
  house: (s, x, y, w, h, o = {}) => {
    const { z = 3, roof = "gable", t = "t3", door = true, win = 0, rh = w * 0.36, c = "cream" } = o, top = y - h, cx = x + w / 2;
    s.add(z, c, R0(x, top, w, h));
    if (roof === "gable") s.add(z, t, poly(x - 1.6, top + 0.8, cx, top - rh, x + w + 1.6, top + 0.8));
    if (roof === "flat") s.add(z, t, R0(x - 1.2, top - 2.4, w + 2.4, 3));
    if (roof === "dome") s.add(z, t, dome(cx, top + 0.4, w / 2 - 0.4, w / 2 - 1.4));
    if (roof === "shed") s.add(z, t, poly(x - 1.4, top + 0.8, x - 1.4, top - rh * 0.7, x + w + 1.4, top - 0.4, x + w + 1.4, top + 0.8));
    const wd = [];
    if (door) wd.push(arch(cx - 2.2, y - 7, 4.4, 7));
    for (let i = 0, high = h >= 14; i < win; i++) {
      const wx = x + (w * (i + 0.5)) / win;
      if (!high && door && Math.abs(wx - cx) < 4.6) continue;
      wd.push(arch(wx - 1.3, high ? top + h * 0.2 : y - 8.6, 2.6, 4));
    }
    if (wd.length) s.add(z, "win", wd.join(""));
  },
  tower: (s, cx, y, w, h, o = {}) => {
    const { z = 3, top = "cren", t = "t3", win = 2, c = "cream" } = o, x = cx - w / 2, ty = y - h;
    let d = R0(x, ty, w, h);
    if (top === "cren") {
      const m = Math.max(2, Math.round(w / 3.4));
      d += R0(x - 1, ty - 1.6, w + 2, 2.4);
      for (let i = 0; i < m; i++) d += R0(x - 1 + (i * (w - 0.2)) / (m - 1), ty - 4.4, 2.2, 3);
    }
    s.add(z, c, d);
    if (top === "cone") s.add(z, t, poly(x - 1.6, ty + 0.6, cx, ty - w * 1.1, x + w + 1.6, ty + 0.6));
    if (top === "dome") s.add(z, t, dome(cx, ty + 0.4, w / 2 + 0.8));
    if (top === "flat") s.add(z, t, R0(x - 1.2, ty - 2.4, w + 2.4, 3));
    if (win) s.add(z, "win", Array.from({ length: win }, (_, i) => arch(cx - 1.1, ty + 4 + i * 8, 2.2, 4.6)).join(""));
  },
  wall: (s, x, y, w, h, o = {}) => {
    const { z = 3, c = "cream", gate = 0 } = o, m = Math.round(w / 4.4);
    let d = R0(x, y - h, w, h);
    for (let i = 0; i < m; i++) d += R0(x + i * (w / m) + (w / m - 2.4) / 2, y - h - 2.6, 2.4, 2.8);
    s.add(z, c, d);
    if (gate) s.add(z, "win", arch(x + w / 2 - gate / 2, y - gate * 1.4, gate, gate * 1.4));
  },
  temple: (s, cx, y, w, h, o = {}) => {
    const { z = 3, cols = 5, t = "t3", c = "cream", ped = true } = o, x = cx - w / 2, top = y - 4 - h, cw = Math.min(3, (w / cols) * 0.5);
    s.add(z, "win", R0(x + 1, top, w - 2, h));
    let d = R0(x - 3, y - 2, w + 6, 2) + R0(x - 1.5, y - 4.2, w + 3, 2.4) + R0(x - 1, top - 3, w + 2, 3.2);
    for (let i = 0; i < cols; i++) d += R0(x + (i * (w - cw)) / (cols - 1), top, cw, h);
    s.add(z, c, d).add(z, "trim", R0(x - 1, top - 1.4, w + 2, 0.8));
    if (ped) s.add(z, t, poly(x - 2.4, top - 2.8, cx, top - 2.8 - w * 0.22, x + w + 2.4, top - 2.8));
  },
  domed: (s, cx, y, r, o = {}) => {
    const { z = 3, t = "t3", c = "cream", drum = r * 0.5 } = o, top = y - drum - r * 0.86;
    s.add(z, c, R0(cx - r, y - drum, 2 * r, drum)).add(z, t, dome(cx, y - drum + 0.3, r + 0.4, r * 0.86)).add(z, "gold", R0(cx - 0.6, top - 3, 1.2, 3.2) + dot(cx, top - 3.6, 1.3));
  },
  stoa: (s, x, y, w, h, o = {}) => {
    const { z = 3, cols = 6, t = "t3", c = "cream", roof = true } = o, cw = 2.2;
    s.add(z, "win", R0(x + 1, y - h, w - 2, h));
    let d = R0(x - 1.5, y - 1.6, w + 3, 1.6) + R0(x - 1, y - h - 2.6, w + 2, 2.8);
    for (let i = 0; i < cols; i++) d += R0(x + (i * (w - cw)) / (cols - 1), y - h, cw, h - 1.6);
    s.add(z, c, d);
    if (roof) s.add(z, t, poly(x - 2, y - h - 2.4, x + 2, y - h - 6.4, x + w - 2, y - h - 6.4, x + w + 2, y - h - 2.4));
  },
  arcade: (s, x, y, w, h, k, o = {}) => {
    const { z = 3, c = "cream" } = o, aw = (w / k) * 0.6;
    s.add(z, c, R0(x, y - h, w, h)).add(z, "win", Array.from({ length: k }, (_, i) => arch(x + (w / k) * (i + 0.5) - aw / 2, y - h * 0.72, aw, h * 0.72)).join(""));
  },
  aqueduct: (s, x, y, w, h, k, o = {}) => {
    const { z = 3, c = "cream" } = o, sp = w / k, aw = sp * 0.68;
    s.add(z, c, R0(x, y - h, w, h) + Array.from({ length: k }, (_, i) => archHole(x + sp * (i + 0.5) - aw / 2, y - h + 5, aw, h - 5)).join("")).add(z, "trim", R0(x - 1, y - h - 1.6, w + 2, 1.8));
  },
  stall: (s, x, y, w, o = {}) => {
    const { z = 3, t = "t3", h = 13, wares = "gold" } = o, st = Math.max(3, Math.round(w / 4)), sw = (w + 2) / st;
    let a = "", b = "";
    for (let i = 0; i < st; i++) {
      const d = `M${pt(x - 1 + i * sw, y - h - 4)}h${n(sw)}v4.4q${n(-sw / 2)} 2.6 ${n(-sw)} 0Z`;
      if (i % 2) b += d;
      else a += d;
    }
    s.add(z, "t4", R0(x, y - h, 1.2, h) + R0(x + w - 1.2, y - h, 1.2, h)).add(z, "cream", R0(x - 0.5, y - 5.4, w + 1, 5.4) + a).add(z, t, b);
    s.add(z, wares, dot(x + w * 0.3, y - 6.8, 1.4) + dot(x + w * 0.5, y - 7.2, 1.7) + dot(x + w * 0.7, y - 6.8, 1.4));
  },
  tent: (s, cx, y, w, h, o = {}) => {
    const { z = 3, t = "t3", flag = true, c } = o;
    s.add(z, t, poly(cx - w / 2, y, cx, y - h, cx + w / 2, y));
    if (c) s.add(z, c, poly(cx - w / 2, y, cx, y - h, cx - w * 0.18, y));
    s.add(z, "win", poly(cx - w * 0.14, y, cx, y - h * 0.5, cx + w * 0.14, y));
    if (flag) s.add(z, "t4:0.6", `M${pt(cx, y - h)}v-5`).add(z, "gold", poly(cx, y - h - 5, cx + 4, y - h - 3.8, cx, y - h - 2.6));
  },
  flag: (s, x, y, h = 10, o = {}) => {
    const { z = 3, t = "gold", f = 1 } = o;
    s.add(z, "t4:0.7", `M${pt(x, y)}V${n(y - h)}`).add(z, t, f > 0 ? poly(x, y - h, x + 6, y - h + 1.7, x, y - h + 3.4) : poly(x, y - h, x, y - h + 3.4, x - 6, y - h + 1.7));
  },
  banner: (s, cx, y, w, h, o = {}) => {
    const { z = 3, t = "t4", e } = o;
    s.add(z, "t4:0.8", `M${pt(cx - w / 2 - 1.5, y)}H${n(cx + w / 2 + 1.5)}`).add(z, t, poly(cx - w / 2, y, cx + w / 2, y, cx + w / 2, y + h, cx, y + h - w * 0.28, cx - w / 2, y + h));
    if (e) s.add(z, "gold", tp(EMBLEMS[e], cx, y + h * 0.42, w / 15));
  },
  bunting: (s, x0, x1, y, z = 3) => {
    const k = Math.round((x1 - x0) / 5);
    let a = "", b = "";
    for (let i = 0; i < k; i++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / k, yy = y + 3 * Math.sin((Math.PI * (i + 0.5)) / k), d = poly(x - 1.8, yy, x + 1.8, yy, x, yy + 3.4);
      if (i % 2) b += d;
      else a += d;
    }
    s.add(z, "t4:0.5", `M${pt(x0, y)}Q${pt((x0 + x1) / 2, y + 6)} ${pt(x1, y)}`).add(z, "gold", a).add(z, "cream", b);
  },
  smoke: (s, x, y, k = 1, z = 2) => s.add(z, "cloud", dot(x, y, 2 * k) + dot(x + 2 * k, y - 4 * k, 2.8 * k) + dot(x + 5 * k, y - 9 * k, 3.6 * k) + dot(x + 9.4 * k, y - 14.4 * k, 4.2 * k)),
  fire: (s, x, y, k = 1, z = 3) => s.add(z, "lamp", `M${pt(x, y)}Q${pt(x - 3.6 * k, y - 2.6 * k)} ${pt(x, y - 8 * k)}Q${pt(x + 3.6 * k, y - 2.6 * k)} ${pt(x, y)}Z`),
  lantern: (s, x, y, k = 1, z = 3) => s.add(z, "t4:0.5", `M${pt(x, y - 4 * k)}V${n(y - 2 * k)}`).add(z, "lamp", rr(x - 1.4 * k, y - 2 * k, 2.8 * k, 3.6 * k, 1.2 * k)),
  chimney: (s, x, y, w, h, z = 3) => s.add(z, "cream", R0(x, y - h, w, h) + R0(x - 0.8, y - h - 1.6, w + 1.6, 2)).smoke(x + w / 2, y - h - 3.4, 0.9, z),
  steps: (s, cx, y, w, k = 3, z = 3, c = "cream") => s.add(z, c, Array.from({ length: k }, (_, i) => R0(cx - w / 2 + i * 2, y - (i + 1) * 1.6, w - i * 4, 1.7)).join("")),
  // people, animals and things
  figure: (s, x, y, k = 1, z = 4, t = "t4") => s.add(z, t, tp(BODY, x, y, k) + dot(x, y - 9.2 * k, 1.7 * k)),
  horse: (s, x, y, k = 1, f = 1, z = 4, t = "t4") => s.add(z, t, tp(HORSE, x, y, k, f)),
  camel: (s, x, y, k = 1, f = 1, z = 4, t = "t4") => s.add(z, t, tp(CAMEL, x, y, k, f)),
  statue: (s, cx, y, k = 1, o = {}) => {
    const { z = 3, t = "gold", p = "t3" } = o;
    s.add(z, p, R0(cx - 4 * k, y - 7 * k, 8 * k, 7 * k) + R0(cx - 5 * k, y - 8.4 * k, 10 * k, 1.6 * k)).add(z, t, tp(BODY, cx, y - 8.4 * k, 1.4 * k) + dot(cx, y - 21.6 * k, 2.3 * k) + poly(cx + 1.6 * k, y - 16.6 * k, cx + 5.4 * k, y - 25 * k, cx + 6.6 * k, y - 24.4 * k, cx + 2.8 * k, y - 15.6 * k) + dot(cx + 6 * k, y - 26 * k, 1.6 * k));
  },
  well: (s, cx, y, k = 1, z = 3) =>
    s.add(z, "t4", R0(cx - 6.4 * k, y - 15 * k, 1.4 * k, 11 * k) + R0(cx + 5 * k, y - 15 * k, 1.4 * k, 11 * k)).add(z, "t3", poly(cx - 9 * k, y - 14 * k, cx, y - 20 * k, cx + 9 * k, y - 14 * k)).add(z, "t4:0.5", `M${pt(cx, y - 14 * k)}V${n(y - 8.6 * k)}M${pt(cx - 5 * k, y - 12 * k)}H${n(cx + 5 * k)}`).add(z, "t4", R0(cx - 1.3 * k, y - 9 * k, 2.6 * k, 2.4 * k)).add(z, "cream", rr(cx - 7 * k, y - 6 * k, 14 * k, 6 * k, 1.5 * k)).add(z, "trim", R0(cx - 7 * k, y - 4.2 * k, 14 * k, 0.9 * k)),
  fountain: (s, cx, y, k = 1, z = 3) =>
    s.add(z, "cream:0.8", `M${pt(cx, y - 13 * k)}q${n(-4 * k)} ${n(-4 * k)} ${n(-7 * k)} ${n(8 * k)}M${pt(cx, y - 13 * k)}q${n(4 * k)} ${n(-4 * k)} ${n(7 * k)} ${n(8 * k)}M${pt(cx, y - 11 * k)}v${n(-5 * k)}`).add(z, "cream", R0(cx - 10 * k, y - 4.4 * k, 20 * k, 4.4 * k) + R0(cx - 1.4 * k, y - 11 * k, 2.8 * k, 7 * k) + oval(cx, y - 11 * k, 4 * k, 1.2 * k)).add(z, "t1", oval(cx, y - 4.4 * k, 9 * k, 1.4 * k)),
  pool: (s, cx, y, rx, ry, z = 3) => s.add(z, "cream", oval(cx, y, rx + 1.6, ry + 1.2)).add(z, "t1", oval(cx, y + 0.2, rx, ry)),
  steam: (s, x, y, k = 1, z = 3) => s.add(z, "cream:0.8", [-3, 0, 3].map((dx) => `M${pt(x + dx * k, y)}q${n(-2 * k)} ${n(-3 * k)} 0 ${n(-6 * k)}t0 ${n(-6 * k)}`).join("")),
  logs: (s, x, y, k = 1, z = 4) => {
    const c = [[-4, -2], [0, -2], [4, -2], [-2, -5.6], [2, -5.6], [0, -9.2]];
    s.add(z, "t4", c.map(([a, b]) => dot(x + a * k, y + b * k, 2 * k)).join("")).add(z, "trim", c.map(([a, b]) => dot(x + a * k, y + b * k, 1.2 * k)).join(""));
  },
  stump: (s, x, y, k = 1, z = 4) =>
    s.add(z, "t4", `M${pt(x - 4.4 * k, y)}L${pt(x - 3.4 * k, y - 4.4 * k)}L${pt(x + 3.4 * k, y - 4.4 * k)}L${pt(x + 4.4 * k, y)}Z`).add(z, "trim", oval(x, y - 4.4 * k, 3.4 * k, 1.1 * k)).add(z, "t4:1", `M${pt(x + 0.6 * k, y - 4.8 * k)}L${pt(x + 5 * k, y - 11 * k)}`).add(z, "cream", poly(x + 3.2 * k, y - 11.4 * k, x + 6.6 * k, y - 13.4 * k, x + 7.6 * k, y - 9.4 * k)),
  blocks: (s, x, y, k = 1, rows = [[0, 1, 2], [0.5, 1.5]], z = 4) => {
    const bw = 5.6 * k, bh = 3.6 * k;
    let a = "", b = "";
    rows.forEach((r, ri) => r.forEach((c) => {
      const bx = x + c * bw, by = y - (ri + 1) * bh;
      a += R0(bx, by, bw - 0.5, bh - 0.4);
      b += R0(bx + bw - 1.9 * k, by, 1.4 * k, bh - 0.4);
    }));
    s.add(z, "cream", a).add(z, "trim", b);
  },
  bricks: (s, x, y, k = 1, z = 4, t = "t3") => {
    let d = "";
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) d += R0(x + (c + r * 0.5) * 4.4 * k, y - (r + 1) * 2.4 * k, 4 * k, 2 * k);
    s.add(z, t, d);
  },
  mine: (s, cx, y, k = 1, z = 3) => s.add(z, "win", arch(cx - 5 * k, y - 11 * k, 10 * k, 11 * k)).add(z, "t4", R0(cx - 6.6 * k, y - 11 * k, 1.8 * k, 11 * k) + R0(cx + 4.8 * k, y - 11 * k, 1.8 * k, 11 * k) + R0(cx - 8 * k, y - 13 * k, 16 * k, 2.2 * k)),
  cart: (s, x, y, k = 1, z = 4, load = "t2") =>
    s.add(z, load, dot(x - 2.6 * k, y - 7.6 * k, 2.2 * k) + dot(x + 1.4 * k, y - 8 * k, 2.6 * k) + dot(x + 4.4 * k, y - 7.2 * k, 1.8 * k)).add(z, "t4", poly(x - 6 * k, y - 7 * k, x + 7 * k, y - 7 * k, x + 5.6 * k, y - 2.6 * k, x - 4.6 * k, y - 2.6 * k) + dot(x - 2.6 * k, y - 1.8 * k, 1.8 * k) + dot(x + 3.6 * k, y - 1.8 * k, 1.8 * k)),
  rails: (s, x0, x1, y, z = 4) => s.add(z, "t4:0.6", `M${pt(x0, y)}H${n(x1)}` + Array.from({ length: Math.round((x1 - x0) / 3) }, (_, i) => `M${pt(x0 + 1 + i * 3, y - 1)}v2`).join("")),
  crystals: (s, x, y, k = 1, z = 4) =>
    s.add(z, "gold", poly(x - 3.2 * k, y, x - 4 * k, y - 5 * k, x - 2.4 * k, y - 7 * k, x - 1.4 * k, y) + poly(x - 1.4 * k, y, x - 1 * k, y - 9 * k, x + 0.6 * k, y - 11 * k, x + 2 * k, y - 8 * k, x + 1.8 * k, y) + poly(x + 1.8 * k, y, x + 3 * k, y - 6 * k, x + 4.6 * k, y - 4.6 * k, x + 4 * k, y)),
  crane: (s, x, y, h = 30, f = 1, z = 3) => {
    const top = y - h, bx = x + 18 * f;
    s.add(z, "t4:1.3", `M${pt(x, y)}V${n(top)}L${pt(bx, top + 3)}M${pt(x, top + 9)}L${pt(x + 7 * f, top + 1.6)}`).add(z, "t4:0.5", `M${pt(bx - f, top + 3)}V${n(top + h * 0.55)}`).add(z, "cream", R0(bx - f - 2.6, top + h * 0.55, 5.2, 3.8));
  },
  derrick: (s, cx, y, h = 30, z = 3) =>
    s.add(z, "t4:1.2", `M${pt(cx - 8, y)}L${pt(cx - 1.5, y - h)}M${pt(cx + 8, y)}L${pt(cx + 1.5, y - h)}M${pt(cx - 5.7, y - h * 0.35)}H${n(cx + 5.7)}M${pt(cx - 3.6, y - h * 0.68)}H${n(cx + 3.6)}M${pt(cx - 5.7, y - h * 0.35)}L${pt(cx + 3.6, y - h * 0.68)}`).add(z, "t4", dot(cx, y - h, 3.6) + hole(cx, y - h, 2)).add(z, "t4:0.5", `M${pt(cx + 3.4, y - h)}V${n(y - 5)}`),
  kiln: (s, cx, y, r, o = {}) => {
    const { z = 3, c = "cream" } = o;
    s.add(z, c, `M${pt(cx - r, y)}C${pt(cx - r, y - r * 1.5)} ${pt(cx + r, y - r * 1.5)} ${pt(cx + r, y)}Z`).add(z, "trim:0.8", `M${pt(cx - r * 0.9, y - r * 0.5)}Q${pt(cx, y - r * 0.8)} ${pt(cx + r * 0.9, y - r * 0.5)}M${pt(cx - r * 0.6, y - r * 0.9)}Q${pt(cx, y - r * 1.15)} ${pt(cx + r * 0.6, y - r * 0.9)}`).add(z, "win", arch(cx - r * 0.38, y - r * 0.62, r * 0.76, r * 0.62)).add(z, "lamp", oval(cx, y - 1.4, r * 0.24, r * 0.16));
  },
  gear: (s, cx, cy, r, z = 3, t = "t4", teeth = 8) => s.add(z, t, gearD(cx, cy, r, r * 0.76, teeth, r * 0.32)),
  wheel: (s, cx, cy, r, z = 3) => s.add(z, "t4:1.2", dot(cx, cy, r) + Array.from({ length: 4 }, (_, i) => { const a = (Math.PI * i) / 4; return `M${pt(cx - r * Math.cos(a), cy - r * Math.sin(a))}L${pt(cx + r * Math.cos(a), cy + r * Math.sin(a))}`; }).join("")).add(z, "t4", Array.from({ length: 8 }, (_, i) => { const a = (Math.PI * i) / 4; return dot(cx + r * Math.cos(a), cy + r * Math.sin(a), 1.3); }).join("")),
  scrolls: (s, x, y, w, h, z = 3) => {
    let d = "";
    for (let r = 0; r < Math.floor(h / 3.4); r++) for (let c = 0; c < Math.floor(w / 3.4); c++) d += dot(x + 1.7 + c * 3.4, y + 1.7 + r * 3.4, 1.2);
    s.add(z, "win", R0(x, y, w, h)).add(z, "trim", d);
  },
  telescope: (s, x, y, k = 1, z = 4) => s.add(z, "t4:0.9", `M${pt(x, y - 8 * k)}L${pt(x - 4 * k, y)}M${pt(x, y - 8 * k)}L${pt(x + 4 * k, y)}M${pt(x, y - 8 * k)}V${n(y)}`).add(z, "cream", poly(x - 7 * k, y - 6 * k, x + 8 * k, y - 15 * k, x + 9.4 * k, y - 12.6 * k, x - 6 * k, y - 4 * k)),
  target: (s, cx, cy, r, z = 3) => s.add(z, "t4:1", `M${pt(cx - r * 0.6, cy + r * 1.7)}L${pt(cx, cy)}L${pt(cx + r * 0.6, cy + r * 1.7)}`).add(z, "cream", dot(cx, cy, r)).add(z, "t3", dot(cx, cy, r * 0.7)).add(z, "cream", dot(cx, cy, r * 0.44)).add(z, "gold", dot(cx, cy, r * 0.2)),
  ship: (s, x, y, k = 1, f = 1, z = 3) => s.add(z, "t4", tp("M-11 -4L11 -4Q9 0 6 1L-7 1Q-10 0 -11 -4Z", x, y, k, f)).add(z, "t4:0.8", `M${pt(x - f * k, y - 4 * k)}V${n(y - 20 * k)}`).add(z, "cream", f > 0 ? tp("M0 -5L0 -19Q7 -13 8 -6Z", x, y, k) : tp("M0 -5L-8 -6Q-7 -13 0 -19Z", x, y, k)),
  crates: (s, x, y, k = 1, z = 4) => s.add(z, "t3", R0(x, y - 5 * k, 5 * k, 5 * k) + R0(x + 5.6 * k, y - 5 * k, 5 * k, 5 * k) + R0(x + 2.8 * k, y - 10.4 * k, 5 * k, 5 * k)).add(z, "t4:0.5", [[0, -5], [5.6, -5], [2.8, -10.4]].map(([a, b]) => `M${pt(x + a * k, y + b * k)}l${n(5 * k)} ${n(5 * k)}m0 ${n(-5 * k)}l${n(-5 * k)} ${n(5 * k)}`).join("")),
  amphorae: (s, xy, k = 1, z = 4, t = "t3") => s.add(z, t, xy.map(([x, y]) => tp(AMPHORA, x, y, k)).join("")),
  coins: (s, x, y, k = 1, z = 4) => s.add(z, "gold", [0, 1, 2, 3].map((i) => rr(x - 3 * k, y - (i + 1) * 1.7 * k, 6 * k, 1.5 * k, 0.7 * k)).join("") + [0, 1].map((i) => rr(x + 3.6 * k, y - (i + 1) * 1.7 * k, 6 * k, 1.5 * k, 0.7 * k)).join("")),
  scales: (s, cx, y, k = 1, z = 4) =>
    s.add(z, "t4:0.8", `M${pt(cx, y)}V${n(y - 12 * k)}M${pt(cx - 7 * k, y - 11 * k)}H${n(cx + 7 * k)}M${pt(cx - 7 * k, y - 11 * k)}l${n(-2.6 * k)} ${n(5 * k)}m${n(2.6 * k)} ${n(-5 * k)}l${n(2.6 * k)} ${n(5 * k)}M${pt(cx + 7 * k, y - 11 * k)}l${n(-2.6 * k)} ${n(5 * k)}m${n(2.6 * k)} ${n(-5 * k)}l${n(2.6 * k)} ${n(5 * k)}M${pt(cx - 3 * k, y)}H${n(cx + 3 * k)}`).add(z, "gold", [-7, 7].map((dx) => `M${pt(cx + (dx - 3.4) * k, y - 6 * k)}H${n(cx + (dx + 3.4) * k)}a${n(3.4 * k)} ${n(2 * k)} 0 0 1 ${n(-6.8 * k)} 0Z`).join("")),
  chest: (s, x, y, k = 1, z = 4) => s.add(z, "t3", R0(x, y - 6 * k, 10 * k, 6 * k) + dome(x + 5 * k, y - 6 * k, 5 * k, 2.6 * k)).add(z, "gold", R0(x + 4 * k, y - 8.6 * k, 2 * k, 8.6 * k) + R0(x, y - 4 * k, 10 * k, 1.1 * k)),
  clock: (s, cx, cy, r, z = 3) => s.add(z, "t3", dot(cx, cy, r + 1.4)).add(z, "cream", dot(cx, cy, r)).add(z, "t4:0.9", `M${pt(cx, cy)}V${n(cy - r * 0.7)}M${pt(cx, cy)}L${pt(cx + r * 0.5, cy + r * 0.2)}` + [0, 1, 2, 3].map((i) => { const a = (Math.PI * i) / 2; return `M${pt(cx + r * 0.8 * Math.cos(a), cy + r * 0.8 * Math.sin(a))}L${pt(cx + r * 0.95 * Math.cos(a), cy + r * 0.95 * Math.sin(a))}`; }).join("")),
  catapult: (s, x, y, k = 1, z = 4) =>
    s.add(z, "t4:1.2", `M${pt(x - 3 * k, y - 4 * k)}L${pt(x + 1 * k, y - 12 * k)}L${pt(x + 4 * k, y - 4 * k)}M${pt(x + 6 * k, y - 6 * k)}L${pt(x - 8 * k, y - 16 * k)}`).add(z, "t4", R0(x - 8 * k, y - 4.6 * k, 16 * k, 2.2 * k) + dot(x - 5 * k, y - 1.8 * k, 1.9 * k) + dot(x + 5 * k, y - 1.8 * k, 1.9 * k) + dot(x - 8.6 * k, y - 16.8 * k, 2 * k)).add(z, "cream", dot(x - 8.6 * k, y - 18.4 * k, 1.5 * k)),
  ram: (s, x, y, k = 1, z = 4) => s.add(z, "t3", poly(x - 9 * k, y - 4 * k, x - 6 * k, y - 12 * k, x + 6 * k, y - 12 * k, x + 9 * k, y - 4 * k)).add(z, "t4", R0(x - 11 * k, y - 6.4 * k, 22 * k, 2.4 * k) + dot(x - 6 * k, y - 1.8 * k, 1.9 * k) + dot(x + 6 * k, y - 1.8 * k, 1.9 * k)),
  stakes: (s, x0, x1, y, h, z = 3, t = "t4") => {
    let d = "";
    for (let x = x0; x < x1; x += 3.4) d += `M${pt(x, y)}V${n(y - h + 2)}L${pt(x + 1.5, y - h)}L${pt(x + 3, y - h + 2)}V${n(y)}Z`;
    s.add(z, t, d);
  },
  fence: (s, x0, x1, y, z = 4, t = "t4") => s.add(z, `${t}:0.8`, `M${pt(x0, y - 3)}H${n(x1)}M${pt(x0, y - 6)}H${n(x1)}` + Array.from({ length: Math.round((x1 - x0) / 5) + 1 }, (_, i) => `M${pt(x0 + i * 5, y)}V${n(y - 7.4)}`).join("")),
  shields: (s, xy, k = 1, z = 3, t = "gold") => s.add(z, t, xy.map(([x, y]) => `M${pt(x - 2.6 * k, y - 3 * k)}H${n(x + 2.6 * k)}V${n(y)}Q${pt(x + 2.6 * k, y + 2.6 * k)} ${pt(x, y + 4 * k)}Q${pt(x - 2.6 * k, y + 2.6 * k)} ${pt(x - 2.6 * k, y)}Z`).join("")),
  spears: (s, x, y, k = 1, count = 3, z = 4) => s.add(z, "t4:0.8", Array.from({ length: count }, (_, i) => `M${pt(x + i * 3 * k, y)}V${n(y - 16 * k)}`).join("")).add(z, "cream", Array.from({ length: count }, (_, i) => poly(x + i * 3 * k, y - 20 * k, x + (i * 3 + 1.1) * k, y - 16 * k, x + (i * 3 - 1.1) * k, y - 16 * k)).join("")),
  track: (s, cx, cy, rx, ry, z = 2) => s.add(z, "t2", oval(cx, cy, rx, ry)).add(z, "t3", oval(cx, cy, rx * 0.68, ry * 0.46)).add(z, "cream", rr(cx - rx * 0.46, cy - 1, rx * 0.92, 2, 1)),
  pergola: (s, x, y, w, h, z = 3) => s.add(z, "t4", R0(x, y - h, 1.4, h) + R0(x + w - 1.4, y - h, 1.4, h) + R0(x - 2, y - h - 1.6, w + 4, 1.8)).add(z, "t3", Array.from({ length: Math.round(w / 4) + 1 }, (_, i) => dot(x - 1 + i * 4, y - h - 1.4 - (i % 2), 2.2)).join("") + dot(x + 0.7, y - h * 0.6, 1.8) + dot(x + w - 0.7, y - h * 0.4, 1.8)),
  roses: (s, x, y, k = 1, z = 4) => s.add(z, "t4", dot(x - 3 * k, y - 3 * k, 3 * k) + dot(x + 3 * k, y - 3 * k, 3 * k) + dot(x, y - 5 * k, 3.4 * k) + R0(x - 6 * k, y - 3 * k, 12 * k, 3 * k)).add(z, "cream", dot(x - 3 * k, y - 4.4 * k, 1 * k) + dot(x + 1 * k, y - 7 * k, 1 * k) + dot(x + 3.6 * k, y - 3.4 * k, 1 * k)),
  clothes: (s, x0, x1, y, z = 3) => {
    const k = Math.round((x1 - x0) / 6), roles = ["cream", "t2", "gold", "t1"];
    s.add(z, "t4:0.5", `M${pt(x0, y)}Q${pt((x0 + x1) / 2, y + 3)} ${pt(x1, y)}`);
    for (let i = 0; i < k; i++) {
      const x = x0 + 1 + ((x1 - x0 - 2) * i) / k, yy = y + 3 * Math.sin((Math.PI * (i + 0.5)) / k) * 0.9;
      s.add(z, roles[i % 4], R0(x + 0.6, yy, (x1 - x0) / k - 1.6, 7 + (i % 2) * 2));
    }
  },
  racks: (s, x, y, w, z = 3) => {
    const k = Math.round(w / 6);
    s.add(z, "t4:0.8", `M${pt(x, y)}V${n(y - 13)}M${pt(x + w, y)}V${n(y - 13)}M${pt(x - 1, y - 12)}H${n(x + w + 1)}`).add(z, "cream", Array.from({ length: k }, (_, i) => R0(x + 1 + i * (w / k), y - 12, w / k - 1.6, 8)).join(""));
  },
  millstone: (s, cx, y, r, z = 3) => s.add(z, "t3", rr(cx - r * 1.5, y - 3, r * 3, 3, 1)).add(z, "cream", dot(cx, y - 3 - r, r) + hole(cx, y - 3 - r, r * 0.3)).add(z, "t4:1", `M${pt(cx, y - 3 - r)}L${pt(cx + r * 1.7, y - 3 - r * 1.8)}`),
  sign: (s, x, y, k = 1, f = 1, z = 4) => s.add(z, "t4", R0(x - 0.7 * k, y - 12 * k, 1.4 * k, 12 * k)).add(z, "cream", f > 0 ? poly(x - 4 * k, y - 12 * k, x + 4 * k, y - 12 * k, x + 6.4 * k, y - 9.6 * k, x + 4 * k, y - 7.2 * k, x - 4 * k, y - 7.2 * k) : poly(x - 4 * k, y - 12 * k, x + 4 * k, y - 12 * k, x + 4 * k, y - 7.2 * k, x - 4 * k, y - 7.2 * k, x - 6.4 * k, y - 9.6 * k)),
  hanging: (s, x, y, k = 1, z = 3) => s.add(z, "t4:0.7", `M${pt(x, y)}h${n(7 * k)}M${pt(x + 2 * k, y)}v${n(1.6 * k)}M${pt(x + 6 * k, y)}v${n(1.6 * k)}`).add(z, "gold", rr(x + 1 * k, y + 1.6 * k, 6 * k, 4.4 * k, 1 * k)),
  shovel: (s, x, y, k = 1, z = 3) => s.add(z, "t4:0.9", `M${pt(x, y)}L${pt(x + 3 * k, y - 10 * k)}`).add(z, "cream", poly(x - 1.6 * k, y + 0.4 * k, x + 1.4 * k, y + 1.2 * k, x + 0.4 * k, y + 5 * k, x - 2.2 * k, y + 3.4 * k)),
};

function scene(key) {
  const layers = [[], [], [], [], []];
  const s = {
    add(z, role, d) {
      const l = layers[z], last = l[l.length - 1];
      if (last && last[0] === role) last[1] += d;
      else l.push([role, d]);
      return s;
    },
  };
  for (const [name, f] of Object.entries(KIT)) s[name] = (...a) => (f(s, ...a), s);
  SCENES[key](s.sky());
  return layers
    .map((l, z) => {
      const sil = z ? l.filter(([r]) => !r.includes(":") && !FLAT.has(r)).map((e) => e[1]).join("") : "";
      return (sil ? shade(sil) : "") + l.map(([r, d]) => P(d, r)).join("");
    })
    .join("");
}

// ---------- the scenes, one a building (the grey cards share theirs across ages) ----------
const backdrop = (s, y = 46, b = [6, 10, 5]) => s.hills(y, b);
const guildHall = (s, e, x = 34, w = 34, h = 22) => s.house(x, 60, w, h, { roof: "gable", win: 3, rh: 10 }).banner(x + w / 2, 60 - h + 3, 9, 12, { e });
const SCENES = {
  // brown
  "woodcutters-camp": (s) => backdrop(s.sun(80, 18).cloud(36, 14, 0.8), 46, [8, 4, 10, 6]).pine(28, 48, 0.9, 1, "t2").pine(74, 47, 0.9, 1, "t2").pine(84, 50, 1.1, 1, "t2").hills(58, [4, 6, 3], 2, "t2").house(36, 61, 22, 11, { win: 2 }).logs(70, 61, 1.1, 3).stump(27, 62, 1.1, 3).ground(66).pine(8, 78, 1.6).pine(93, 80, 1.7).tree(84, 70, 0.8),
  "stone-cut": (s) => backdrop(s.sun().cloud(44, 12, 0.7), 48).quarry(20, 62, 46, 34, 4).blocks(56, 62, 1, [[0, 1, 2], [0.5, 1.5], [1]], 3).crane(88, 62, 36, -1).ground(66, [2, 3, 2]).figure(84, 72, 1.1).rock(12, 72, 4),
  "clay-bank": (s) => backdrop(s.sun().cloud(42, 10, 0.8), 38, [5, 9, 4]).water(46, 1).hills(54, [2, 4, 2], 2, "t2").mound(24, 60, 32, 15, 3, "t3").shovel(30, 47, 1.2, 3).figure(46, 62, 1.3, 3).add(3, "t3", [0, 1, 2].map((r) => [0, 1, 2, 3, 4, 5].map((c) => R0(56 + c * 6.4 - r * 1.2, 56 + r * 4.4, 4.6 + r * 0.4, 2.4 + r * 0.3)).join("")).join("")).ground(72, [1, 2, 1]).reeds(6, 78, 1.5).reeds(94, 78, 1.3),
  "ore-seam": (s) => s.cloud(30, 16, 0.7).ridge([-2, 52, 16, 34, 30, 42, 50, 14, 68, 36, 82, 24, 102, 44]).snow([[50, 14, 6], [82, 24, 4]]).hills(56, [3, 5, 2], 2, "t2").mine(52, 58, 1.3).rails(64, 102, 66).cart(78, 66, 1.1).ground(66, [2, 3, 2]).crystals(16, 72, 1.3),
  "riverside-grove": (s) => backdrop(s.sun(80, 16).cloud(36, 12, 0.7), 44).hills(52, [2, 4, 2], 1, "t2").tree(20, 53, 1, 2, "t3").tree(36, 52, 1.2, 2, "t3").tree(62, 53, 0.9, 2, "t3").mound(80, 54, 22, 9, 2, "t3").water(56, 3).ground(70, [3, 1, 3]).reeds(8, 72, 1.2).tree(92, 76, 1.2),
  "dig-site": (s) => backdrop(s.sun(82, 18).cloud(40, 12, 0.7), 46).ground(56, [2, 3, 2], 2, "t2").add(2, "t4", poly(34, 58, 66, 58, 62, 66, 38, 66)).add(2, "t4:0.8", "M44 57L48 68M48 57L52 68M45 60H49M46 63H50").add(3, "cream", R0(12, 46, 4.4, 16) + R0(20, 52, 4.4, 10) + R0(10, 44, 8.4, 2.4) + R0(80, 58, 14, 3)).add(3, "trim", R0(14.6, 46, 1, 16) + R0(22.6, 52, 1, 10)).tent(80, 58, 18, 15).mound(68, 60, 14, 6, 3, "t3").ground(70).shovel(72, 56, 1.1, 3).blocks(4, 80, 0.9, [[0, 1], [0.5]]),
  "red-hollow": (s) => s.sun(54, 20, 6).ridge([-2, 30, 14, 26, 28, 44, 36, 60, 64, 60, 72, 40, 86, 22, 102, 28], 1, "t3").ridge([-2, 50, 22, 50, 34, 62, 66, 62, 78, 48, 102, 52], 2, "t2").mine(50, 62, 1.1, 2).mound(26, 66, 20, 8, 3, "t3").ground(68, [2, 2, 3]).cart(78, 72, 1, 4, "t1"),
  "hillside-clearing": (s) => s.sun(82, 16).cloud(34, 18, 0.8).hills(30, [10, 22, 12], 1, "t1").pine(40, 22, 0.8, 1, "t2").pine(52, 18, 0.9, 1, "t2").pine(64, 22, 0.8, 1, "t2").hills(54, [8, 14, 6], 2, "t2").stump(30, 50, 0.9, 2).stump(70, 50, 0.9, 2).blocks(44, 56, 0.9, [[0, 1, 2], [0.5, 1.5]], 3).logs(80, 62, 1, 3).ground(66).rock(14, 70, 5),
  "forest-mine": (s) => s.cloud(66, 14, 0.8).hills(40, [8, 14, 8], 1, "t1").pine(14, 52, 1.3, 2, "t2").pine(28, 50, 1.1, 2, "t2").pine(76, 50, 1.2, 2, "t2").pine(90, 52, 1.3, 2, "t2").hills(56, [4, 10, 3], 2, "t2").mine(52, 58, 1.2, 3).rails(60, 102, 65).cart(84, 65, 1).ground(66).pine(6, 80, 1.7).pine(18, 78, 1.3),
  "rock-shaft": (s) => backdrop(s.sun(24, 18, 6).cloud(70, 12, 0.7), 48, [8, 4, 10]).ground(58, [2, 4, 2], 2, "t2").derrick(50, 60, 34).house(68, 60, 16, 9, { roof: "shed", win: 0 }).rock(32, 60, 6, 3, "t3").rock(24, 61, 4, 3, "t3").ground(68).crystals(86, 72, 1.1),
  "timber-mill": (s) => backdrop(s.sun(84, 16).cloud(30, 14, 0.7), 44).pine(14, 48, 1.1, 1, "t2").pine(86, 48, 1, 1, "t2").house(34, 58, 30, 16, { win: 2, rh: 11 }).wheel(68, 54, 8).water(60, 3).logs(16, 66, 1, 4).ground(70, [2, 1, 3]).logs(86, 72, 1.1),
  "great-quarry": (s) => backdrop(s.sun().cloud(46, 12, 0.6), 40, [5, 9, 4]).quarry(6, 62, 70, 40, 6).blocks(58, 62, 1, [[0, 1, 2], [0.5, 1.5]], 3).crane(36, 62, 38, 1).crane(90, 62, 34, -1).ground(66, [2, 3, 2]).figure(14, 72, 1).figure(88, 72, 1).blocks(6, 80, 0.9, [[0, 1]]),
  brickworks: (s) => backdrop(s.cloud(34, 12, 0.8), 46).chimney(66, 58, 5, 32).kiln(34, 60, 12).kiln(56, 60, 9).bricks(76, 60, 1.2, 3).ground(66).bricks(6, 72, 1.2).bricks(84, 74, 1.1),
  smeltery: (s) => s.cloud(28, 14, 0.7).hills(48, [6, 12, 4]).chimney(70, 58, 5, 34).add(3, "cream", poly(32, 60, 36, 30, 52, 30, 56, 60)).add(3, "t3", R0(34, 28, 20, 4)).add(3, "win", arch(39, 46, 10, 14)).fire(44, 59, 1.4).add(3, "t4", tp(ANVIL, 64, 58, 0.9)).ground(66).add(4, "gold", R0(8, 66, 6, 2.4) + R0(10, 63.6, 6, 2.4) + R0(86, 70, 6, 2.4)),
  // grey
  "weavers-hall": (s) => backdrop(s.sun(84, 16).cloud(44, 14, 0.7)).house(42, 60, 34, 18, { win: 3, rh: 12 }).clothes(4, 38, 40).add(3, "t4:0.8", "M4 60V38M38 60V38").ground(66).bush(88, 70, 1.1),
  "glass-kiln": (s) => backdrop(s.cloud(28, 12, 0.7), 44, [6, 10, 4]).chimney(51, 44, 7, 24).kiln(48, 64, 16).add(3, "t4", R0(70, 54, 24, 2) + R0(71, 56, 1.4, 8) + R0(91.6, 56, 1.4, 8) + R0(6, 54, 18, 2) + R0(7, 56, 1.4, 8) + R0(21.6, 56, 1.4, 8)).add(3, "cream", tp(AMPHORA, 75, 54, 0.6) + tp(AMPHORA, 82, 54, 0.8) + tp(AMPHORA, 89, 54, 0.5) + tp(AMPHORA, 11, 54, 0.7) + tp(AMPHORA, 18, 54, 0.55)).ground(66),
  "reed-press": (s) => backdrop(s.sun().cloud(36, 12, 0.7), 46).house(54, 58, 30, 16, { roof: "shed", win: 2 }).add(3, "t4", R0(53, 58, 32, 2)).racks(12, 58, 34).water(62, 3).reeds(5, 70, 1.6).reeds(16, 68, 1.2).reeds(84, 70, 1.5).reeds(95, 68, 1.2),
  // blue
  "town-well": (s) => backdrop(s.sun().cloud(34, 12, 0.7), 44).house(12, 56, 18, 14, { win: 1 }).house(70, 56, 20, 16, { win: 2 }).ground(58, [1, 2, 1], 2, "t2").well(50, 62, 1.6).ground(68).tree(10, 74, 1).cypress(92, 74, 1),
  "hot-springs": (s) => s.cloud(70, 14, 0.7).ridge([-2, 40, 20, 26, 40, 34, 62, 18, 84, 32, 102, 26]).snow([[62, 18, 5]]).domed(76, 50, 10, { z: 2 }).ground(50, [2, 3, 2], 2, "t2").pool(30, 52, 14, 3.4).steam(30, 48).rock(48, 56, 4, 3, "t3").pool(56, 60, 16, 3.6).steam(58, 56).ground(66).rock(88, 70, 5).rock(12, 70, 4),
  shrine: (s) => backdrop(s.sun(76, 20, 8), 40, [6, 12, 4]).hills(54, [6, 12, 4], 2, "t2").steps(50, 49, 26, 3, 3).temple(50, 45, 18, 12, { cols: 4 }).fire(50, 44, 0.8, 3).cypress(24, 52, 1.1, 3).cypress(76, 52, 1.1, 3).ground(66).cypress(8, 76, 1.2).cypress(94, 78, 1.3),
  amphitheatre: (s) => backdrop(s.sun().cloud(30, 10, 0.7), 40).add(2, "cream", "M8 64Q8 30 50 27Q92 30 92 64Z").add(2, "trim:0.9", "M13 60Q14 35 50 32Q86 35 87 60M18 60Q19 40 50 37Q81 40 82 60M23 60Q25 45 50 42.4Q75 45 77 60M28 60Q30 50 50 48Q70 50 72 60").add(2, "t3:0.7", "M50 27V48M28 32L36 49M72 32L64 49").add(3, "t2", oval(50, 64, 22, 5)).stoa(26, 74, 48, 9, { cols: 7, roof: false }).ground(74).cypress(6, 80, 1.2).cypress(94, 80, 1.2),
  "water-channel": (s) => backdrop(s.sun(80, 18).cloud(36, 12, 0.7), 40, [8, 12, 6]).hills(56, [10, 4, 10], 2, "t2").aqueduct(-2, 58, 104, 26, 5).add(3, "t1", R0(-2, 30.6, 104, 1.4)).water(64, 4).tree(10, 76, 1).tree(92, 76, 1.1),
  sanctuary: (s) => backdrop(s.sun(82, 16).cloud(34, 12, 0.6), 44).tree(18, 50, 1.3, 2, "t2").tree(84, 50, 1.3, 2, "t2").ground(56, [2, 3, 2], 2, "t2").temple(50, 60, 38, 20, { cols: 6 }).ground(66).cypress(10, 76, 1.2).cypress(20, 74, 0.9).cypress(90, 76, 1.2),
  "bronze-figure": (s) => backdrop(s.cloud(30, 14, 0.7).sun(84, 14, 6)).stoa(6, 56, 26, 14, { cols: 4 }).stoa(70, 56, 26, 14, { cols: 4 }).ground(57, [1, 1], 2, "t2").steps(50, 60, 22, 2).statue(50, 57, 1.25).ground(66).cypress(4, 76, 1),
  "hall-of-laws": (s) => backdrop(s.sun(84, 14, 6).cloud(30, 12, 0.6), 46).temple(50, 60, 46, 18, { cols: 6 }).add(3, "cream", arch(42, 22, 7, 9) + arch(51, 22, 7, 9)).add(3, "t4:0.5", "M43.4 27H47.6M43.4 29H47.6M52.4 27H56.6M52.4 29H56.6").ground(66).cypress(8, 76, 1.2).cypress(94, 76, 1.2),
  "temple-of-all": (s) => backdrop(s.sun(84, 14, 6), 46).domed(54, 46, 18, { drum: 6 }).temple(42, 60, 30, 16, { cols: 6 }).ground(66).cypress(8, 76, 1.2).cypress(18, 74, 0.9).cypress(92, 76, 1.2),
  "rose-gardens": (s) => backdrop(s.sun().cloud(30, 12, 0.7), 44).pergola(24, 58, 52, 22).fountain(50, 60, 1.1).roses(16, 64, 1.1, 3).roses(84, 64, 1.1, 3).ground(66).roses(8, 76, 1.3).roses(92, 78, 1.3),
  "council-house": (s) => backdrop(s.sun(84, 16, 6).cloud(30, 12, 0.6), 46).add(3, "win", R0(30, 36, 40, 20)).add(3, "cream", [30, 37, 45, 53, 61, 67].map((x, i) => R0(x, 36, 2.6 + (i % 5 ? 0.4 : 0), 20)).join("") + R0(26, 56, 48, 2.4) + R0(24, 58, 52, 2.4) + R0(28, 33, 44, 3.4)).add(3, "t3", `M26 33.4A24 12 0 0 1 74 33.4Z`).add(3, "gold", dot(50, 21, 1.8)).ground(66).cypress(10, 76, 1.2).cypress(90, 76, 1.2),
  "crown-hall": (s) => backdrop(s.cloud(30, 12, 0.6), 50).tower(26, 60, 12, 36, { top: "cone" }).tower(74, 60, 12, 36, { top: "cone" }).house(34, 60, 32, 24, { roof: "flat", win: 3 }).add(3, "gold", "M38 34L37 24L43.5 29L50 21L56.5 29L63 24L62 34Z").flag(26, 20, 8).flag(74, 20, 8, { f: -1 }).ground(66),
  "elders-chamber": (s) => backdrop(s.sun(84, 16, 6), 46).stoa(16, 58, 68, 18, { cols: 8 }).olive(10, 66, 1.2, 4).figure(36, 58, 0.9, 3, "trim").figure(64, 58, 0.9, 3, "trim").ground(66).olive(92, 76, 1.1),
  // yellow
  "wayside-inn": (s) => backdrop(s.sun(82, 16).cloud(30, 12, 0.6), 46).road("M30 96Q36 70 56 62Q74 56 104 56V60Q76 60 62 66Q46 74 48 96Z").house(18, 58, 30, 18, { win: 2, rh: 11 }).chimney(40, 34, 4, 6).hanging(48, 46, 1).lantern(19, 50, 1).cart(70, 60, 1.1, 3, "t3").ground(66, [2, 2, 3]).tree(90, 76, 1.2),
  "east-road": (s) => s.add(0, "sun", dome(96, 52, 14)).hills(52, [4, 2, 6]).road("M8 96Q20 72 58 60Q80 54 104 52V54Q84 58 66 64Q40 74 34 96Z").sign(30, 62, 1.4, 1, 3).rock(60, 59, 3, 3, "t3").ground(66, [3, 1, 2]).tree(10, 74, 1.1).cypress(88, 74, 1),
  "west-road": (s) => s.add(0, "sun", dome(4, 52, 14)).hills(52, [6, 2, 4]).road("M92 96Q80 72 42 60Q20 54 -4 52V54Q16 58 34 64Q60 74 66 96Z").sign(70, 62, 1.4, -1, 3).rock(40, 59, 3, 3, "t3").ground(66, [2, 1, 3]).tree(90, 74, 1.1).cypress(12, 74, 1),
  "artisans-row": (s) => backdrop(s.sun().cloud(30, 12, 0.6), 44).house(4, 48, 26, 14, { roof: "flat", door: false, win: 2, z: 2 }).house(68, 48, 28, 16, { roof: "flat", door: false, win: 2, z: 2 }).stall(8, 62, 24).stall(38, 62, 24, { wares: "t1" }).stall(68, 62, 24).ground(66),
  agora: (s) => backdrop(s.sun(84, 14, 6), 44).stoa(4, 52, 92, 16, { cols: 10 }).stall(14, 62, 20, { h: 11 }).stall(66, 62, 20, { h: 11, wares: "t1" }).figure(44, 62, 1, 3).figure(52, 61, 1.1, 3).ground(66),
  "caravan-yard": (s) => backdrop(s.sun(80, 18), 46, [4, 8, 4]).palm(84, 54, 1, 2, "t2").palm(12, 52, 0.9, 2, "t2").arcade(28, 58, 44, 20, 3).camel(56, 64, 1.4, -1, 3).camel(24, 66, 1.2, 1, 3).crates(70, 64, 1.1, 3).ground(66),
  "olive-press": (s) => backdrop(s.sun(82, 18).cloud(32, 12, 0.6), 44).olive(16, 54, 1.3, 2, "t2").olive(84, 54, 1.2, 2, "t2").ground(56, [2, 2, 2], 2, "t2").millstone(46, 62, 9).amphorae([[66, 62], [74, 62], [70, 52]], 0.8, 3).ground(66).olive(8, 78, 1.1),
  "craft-fair": (s) => backdrop(s.cloud(30, 12, 0.6).sun(84, 16, 6), 46).bunting(-2, 102, 24).tent(22, 60, 24, 20, { c: "cream" }).tent(56, 60, 28, 24).tent(86, 60, 20, 16, { c: "cream" }).ground(66).figure(38, 72, 1),
  harbour: (s) => s.sun(26, 20, 6).cloud(66, 12, 0.7).water(46, 1).ship(76, 52, 1.2, -1, 2).ship(24, 54, 0.9, 1, 2).add(3, "cream", R0(-2, 58, 60, 4)).add(3, "t4", R0(6, 62, 2, 6) + R0(26, 62, 2, 6) + R0(46, 62, 2, 6)).house(6, 58, 20, 14, { roof: "gable", win: 1 }).crane(50, 58, 26, 1).crates(30, 58, 0.9, 3).ground(74, [1, 2, 1]),
  "counting-house": (s) => backdrop(s.sun(84, 14, 6).cloud(30, 12, 0.6), 46).house(26, 58, 48, 22, { roof: "gable", win: 4, rh: 10 }).add(3, "gold", dot(50, 31, 3)).ground(60, [1, 1], 3, "t2").chest(10, 66, 1.3).coins(84, 66, 1.2).scales(86, 52, 1, 4).ground(68),
  exchange: (s) => backdrop(s.sun(84, 14, 6), 46).arcade(14, 58, 72, 24, 5).add(3, "cream", R0(12, 32, 76, 3)).add(3, "t3", poly(12, 32, 50, 22, 88, 32)).banner(30, 36, 6, 9).banner(70, 36, 6, 9).ground(66).coins(12, 72, 1.1),
  hippodrome: (s) => backdrop(s.cloud(30, 10, 0.6).sun(84, 14, 6), 34, [4, 8, 4]).add(2, "cream", R0(-2, 36, 104, 8)).add(2, "trim", [4, 16, 28, 40, 52, 64, 76, 88].map((x) => R0(x, 38, 8, 2)).join("")).track(50, 54, 56, 10).horse(40, 56, 1.1, 1, 3).horse(52, 55, 1.1, 1, 3).add(3, "t4", R0(28, 50, 8, 4) + dot(30, 55, 2)).ground(68),
  // red
  palisade: (s) => backdrop(s.sun().cloud(30, 12, 0.6), 44).stakes(-2, 102, 58, 22, 3, "t3").add(3, "win", R0(44, 40, 12, 18)).add(3, "t4", R0(42, 36, 16, 3) + R0(42, 30, 2, 6) + R0(56, 30, 2, 6)).flag(50, 30, 10).ground(66),
  "guard-post": (s) => backdrop(s.sun(84, 16).cloud(30, 12, 0.6), 48).tower(46, 60, 16, 32, { top: "cone" }).flag(46, 18, 9).figure(66, 60, 1.3, 3).spears(70, 60, 1, 1, 3).ground(66).cypress(90, 76, 1.1).bush(10, 72, 1.2),
  watchtower: (s) => s.cloud(26, 14, 0.7).hills(50, [12, 24, 10]).tower(52, 50, 12, 34, { top: "flat", win: 3 }).fire(52, 13, 1.3).ground(56, [2, 4, 2], 2, "t2").tree(20, 62, 1.1, 3, "t3").tree(84, 62, 1.1, 3, "t3").ground(66),
  ramparts: (s) => backdrop(s.sun(80, 16).cloud(34, 12, 0.6), 40).wall(-2, 58, 104, 18, { gate: 9 }).tower(18, 58, 14, 30).tower(82, 58, 14, 30).flag(18, 24, 9).flag(82, 24, 9, { f: -1 }).ground(66),
  "drill-field": (s) => backdrop(s.sun(82, 18).cloud(36, 12, 0.6), 46).ground(56, [1, 2, 1], 2, "t2").fence(-2, 102, 56, 2).target(24, 44, 6).target(76, 44, 6).figure(42, 62, 1.3, 3).figure(58, 62, 1.3, 3).spears(44, 62, 1.1, 1, 3).spears(60, 62, 1.1, 1, 3).ground(66),
  "horse-paddock": (s) => backdrop(s.sun().cloud(30, 12, 0.6), 44).house(6, 54, 32, 14, { win: 2, rh: 9 }).ground(56, [1, 2, 1], 2, "t2").horse(58, 62, 1.6, 1, 3).horse(84, 60, 1.2, -1, 3).fence(-2, 102, 66, 4).ground(68),
  "bow-yard": (s) => backdrop(s.sun(82, 16).cloud(34, 12, 0.6), 46).house(4, 56, 22, 12, { roof: "shed", win: 1 }).target(56, 42, 9).target(84, 46, 6).add(3, "t4:0.7", "M50 40L44 38M57 46L51 46M60 39L54 35").add(3, "t4:1.1", "M30 40Q38 50 30 60").add(3, "t4:0.4", "M30 40V60").ground(66),
  bastions: (s) => s.cloud(30, 10, 0.6).cloud(70, 16, 0.5).hills(46, [6, 10, 5]).wall(-2, 54, 104, 12, { z: 2 }).tower(24, 54, 12, 28, { z: 2, top: "cone" }).tower(76, 54, 12, 28, { z: 2, top: "cone" }).flag(24, 14, 8, { z: 2 }).flag(76, 14, 8, { z: 2, f: -1 }).add(3, "cream", poly(10, 74, 10, 54, 50, 44, 90, 54, 90, 74) + [12, 20, 28, 36, 44].map((x) => R0(x, 50.6 - (x - 12) * 0.25 - 2.6, 2.6, 3)).join("") + [54, 62, 70, 78, 86].map((x) => R0(x - 2.6, 44.4 + (x - 50) * 0.25 - 2.6, 2.6, 3)).join("")).add(3, "trim", poly(50, 44, 90, 54, 90, 74, 50, 74)).add(3, "t3:0.6", "M10 60L50 50L90 60M10 66L50 56L90 66").add(3, "win", arch(45, 60, 10, 14) + R0(24, 56, 2, 4) + R0(74, 56, 2, 4)).ground(74),
  "legion-camp": (s) => backdrop(s.sun(84, 16, 6).cloud(30, 12, 0.6), 46).tent(20, 54, 18, 13, { z: 2, flag: false, c: "cream" }).tent(50, 54, 18, 13, { z: 2, flag: false }).tent(80, 54, 18, 13, { z: 2, flag: false, c: "cream" }).tent(34, 62, 20, 15, { flag: false }).tent(66, 62, 20, 15, { flag: false, c: "cream" }).flag(50, 62, 22).add(3, "gold", dot(50, 38, 2)).stakes(-2, 102, 72, 7, 4, "t4"),
  armoury: (s) => backdrop(s.sun(84, 14, 6).cloud(30, 12, 0.6), 46).house(24, 60, 52, 24, { win: 0, rh: 12 }).shields([[33, 42], [41, 42], [59, 42], [67, 42]], 1.2).add(3, "t4:1.2", "M44 30L56 42M56 30L44 42").ground(66).spears(8, 74, 1, 3).spears(86, 74, 1, 3),
  "siege-yard": (s) => backdrop(s.sun(82, 18).cloud(30, 12, 0.6), 48).catapult(36, 60, 1.6, 3).ram(74, 60, 1.2, 3).crates(6, 70, 1, 4).ground(66).rock(92, 72, 4),
  // green
  herbalist: (s) => backdrop(s.sun().cloud(30, 12, 0.6), 46).house(46, 58, 30, 15, { win: 2, rh: 10 }).add(3, "t4:0.6", "M44 44H80").add(3, "t3", [48, 54, 60, 66, 72, 78].map((x) => poly(x - 1.4, 44, x + 1.4, 44, x, 49)).join("")).ground(60, [1, 1], 3, "t2").bush(14, 62, 0.9, 3, "t3").bush(28, 62, 0.9, 3, "t3").amphorae([[86, 62]], 0.7, 3).ground(68).bush(10, 76, 1.1).flowers([[14, 72], [20, 74], [88, 76]], 4, "cream", 1),
  "tinkers-shed": (s) => backdrop(s.cloud(30, 12, 0.6).sun(84, 14, 6), 48).house(30, 60, 36, 18, { roof: "shed", win: 2, rh: 12 }).gear(76, 50, 8, 3).gear(86, 58, 5, 3, "t3", 7).wheel(18, 52, 7).ground(66),
  "copy-house": (s) => backdrop(s.sun(84, 16, 6).cloud(30, 12, 0.6), 46).house(22, 60, 56, 26, { win: 0, rh: 11 }).scrolls(28, 40, 20, 12).scrolls(52, 40, 20, 12).ground(66).cypress(8, 76, 1.1).cypress(94, 76, 1.1),
  infirmary: (s) => backdrop(s.sun(84, 16, 6).cloud(28, 12, 0.6), 46).house(18, 60, 52, 20, { win: 4, rh: 10 }).add(3, "t4:1.1", "M82 36V60").add(3, "t3", "M79 40Q85 41 82 44Q78 46 83 48Q86 50 81 52").bush(84, 62, 0.8, 3, "t3").amphorae([[10, 62]], 0.7, 3).ground(66).tree(92, 78, 1),
  "inventors-hall": (s) => backdrop(s.sun(84, 14, 6), 46).house(20, 60, 50, 24, { win: 0, rh: 10 }).gear(45, 44, 9, 3, "trim", 10).crane(86, 60, 34, -1).gear(84, 66, 5, 4, "t4").ground(66),
  "scroll-hall": (s) => backdrop(s.sun(84, 16, 6).cloud(28, 12, 0.6), 46).temple(50, 60, 50, 20, { cols: 4 }).scrolls(30, 36, 12, 18).scrolls(58, 36, 12, 18).ground(66),
  "tutors-court": (s) => backdrop(s.sun(82, 18).cloud(30, 12, 0.6), 46).stoa(4, 52, 92, 12, { cols: 9, z: 2 }).tree(50, 60, 1.6, 3, "t3").figure(30, 62, 1.5, 3).figure(66, 62, 1, 3).figure(74, 62, 1, 3).add(3, "t4", R0(62, 56, 16, 2)).ground(66),
  "healers-retreat": (s) => s.cloud(30, 14, 0.7).ridge([-2, 44, 24, 18, 44, 32, 62, 14, 86, 30, 102, 22]).snow([[24, 18, 5], [62, 14, 5]]).hills(54, [6, 4, 8], 2, "t2").house(54, 52, 30, 14, { roof: "dome", win: 2 }).pool(30, 58, 14, 3).steam(30, 54).cypress(14, 60, 1.1, 3).cypress(92, 60, 1, 3).ground(66),
  clockworks: (s) => backdrop(s.cloud(26, 14, 0.7), 46).tower(50, 60, 20, 44, { top: "cone", win: 0 }).clock(50, 28, 7).add(3, "win", arch(46.5, 42, 7, 10)).gear(24, 54, 7, 3).gear(78, 54, 6, 3, "t4", 7).ground(66),
  lyceum: (s) => backdrop(s.sun(82, 16).cloud(30, 12, 0.6), 46).stoa(20, 56, 60, 18, { cols: 7 }).olive(12, 62, 1.3, 3, "t3").olive(90, 62, 1.2, 3, "t3").figure(44, 66, 1.2).figure(54, 66, 1.2).ground(66),
  "stargazers-school": (s) => s.add(0, "sun", dot(22, 18, 5) + hole(24.6, 16.4, 4.4)).add(0, "trim", star(40, 10, 2.4, 0.8, 4) + star(62, 20, 1.8, 0.6, 4) + star(86, 30, 2, 0.6, 4)).hills(48, [6, 12, 4]).house(36, 60, 30, 18, { roof: "dome", win: 2 }).add(3, "win", R0(49, 26, 4, 14)).telescope(76, 60, 1.4, 3).ground(66),
  "thinkers-nook": (s) => backdrop(s.sun(84, 14, 6), 48).tree(40, 60, 2.4, 3, "t3").house(58, 60, 20, 12, { win: 1, rh: 8 }).add(3, "t4", R0(30, 56, 14, 2) + R0(31, 58, 1.4, 2) + R0(41.6, 58, 1.4, 2)).figure(36, 56, 1, 3, "cream").lantern(56, 40, 1.1).ground(66).bush(90, 72, 1),
  // purple
  "delvers-guild": (s) => s.cloud(24, 10, 0.6).ridge([-2, 40, 22, 20, 46, 30, 70, 14, 102, 34]).add(2, "t2", "M8 66L12 30L26 18L46 14L72 12L88 22L94 66Z").temple(50, 62, 34, 18, { cols: 4 }).banner(20, 34, 8, 13, { e: "pick" }).banner(80, 34, 8, 13, { e: "pick" }).ground(66).cart(84, 74, 0.9),
  "makers-guild": (s) => backdrop(s.cloud(28, 10, 0.6), 48).chimney(80, 40, 5, 16).house(18, 62, 58, 20, { roof: "none", win: 4 }).add(3, "t3", poly(16, 42.6, 16, 31, 30, 42.6, 30, 31, 44, 42.6, 44, 31, 58, 42.6, 58, 31, 78, 42.6)).banner(47, 44, 9, 11, { e: "anvil" }).add(4, "t4", tp(ANVIL, 88, 70, 1.1)).ground(66),
  "hawkers-guild": (s) => backdrop(s.sun(84, 12, 6), 46).bunting(-2, 102, 22).house(30, 62, 40, 18, { roof: "dome", win: 2 }).banner(50, 45, 9, 11, { e: "purse" }).stall(2, 64, 22, { h: 11 }).stall(76, 64, 22, { h: 11, wares: "t1" }).ground(68),
  "sages-guild": (s) => s.add(0, "sun", dot(80, 16, 6) + hole(82.4, 14.4, 5)).hills(48, [6, 12, 4]).tower(36, 60, 16, 44, { top: "cone", win: 3 }).house(46, 60, 32, 18, { win: 2, rh: 9 }).banner(62, 45, 9, 11, { e: "owl" }).ground(66),
  "whisperers-guild": (s) => backdrop(s.add(0, "sun", dot(22, 14, 5) + hole(24.4, 12.4, 4.2)), 44).house(2, 62, 24, 30, { roof: "gable", win: 2, door: false, z: 2 }).house(74, 62, 26, 34, { roof: "gable", win: 2, door: false, z: 2 }).house(36, 62, 28, 36, { win: 0, rh: 12 }).add(3, "win", arch(46.6, 32, 6.8, 9)).banner(50, 44, 9, 12, { e: "eye" }).lantern(31, 42, 1.2).lantern(69, 42, 1.2).figure(26, 72, 1.4, 4).ground(68),
  "tacticians-guild": (s) => backdrop(s.sun(82, 18), 46).tent(50, 60, 46, 30, { c: "cream" }).banner(50, 36, 9, 11, { e: "swords" }).flag(16, 60, 22).flag(84, 60, 22, { f: -1 }).ground(66),
  "sailors-guild": (s) => s.cloud(30, 12, 0.6).sun(86, 16, 5).water(44).ship(80, 50, 1.1, -1, 1).guildHall("anchor", 14, 40).add(3, "cream", R0(-2, 60, 104, 4)).ground(74, [1, 2, 1]),
  "scholars-guild": (s) => backdrop(s.sun(84, 14, 6), 46).domed(50, 40, 12, { drum: 4 }).temple(50, 60, 40, 16, { cols: 6, ped: false }).banner(50, 44, 9, 12, { e: "book" }).ground(66),
  "judges-guild": (s) => backdrop(s.sun(84, 14, 6), 46).steps(50, 60, 54, 3).temple(50, 55, 42, 16, { cols: 6 }).banner(50, 36, 9, 12, { e: "scales" }).ground(66),
  "masons-guild": (s) => backdrop(s.cloud(30, 12, 0.6), 46).guildHall("square", 22, 40).add(3, "t4:0.8", "M18 60V30M24 60V30M18 44H26M18 36H26M18 52H26").crane(86, 60, 36, -1).blocks(70, 66, 0.9, [[0, 1, 2], [0.5, 1.5]], 4).ground(66),
};
// Kit parts that take the scene builder, for compositions shared by several scenes.
KIT.guildHall = (s, e, x, w, h) => guildHall(s, e, x, w, h);

// ---------- icons (a 20 x 20 box centred on the origin) ----------
const RES = RESOURCE_NAMES;
const SCI = SYMBOLS;
const COLOURS = ["brown", "grey", "blue", "yellow", "red", "green", "purple"];
const crownD = "M-9.5 -1.5L-10 -9.5L-5 -4.5L0 -10.5L5 -4.5L10 -9.5L9.5 -1.5V8.5Q9.5 10 8 10H-8Q-9.5 10 -9.5 8.5Z";
const shieldD = "M0 -10L8.5 -7V0C8.5 5 4.5 8.5 0 10C-4.5 8.5 -8.5 5 -8.5 0V-7Z";
const quill = [
  ["sci", "M8 -10C2 -9 -4 -3 -6 6L-3.8 6.6C-1 -1 3 -6 8 -10Z"],
  ["sci-lt", "M8 -10C5 -5 1 0 -3.8 6.6L-2 6C2 1 6 -4 8 -10Z"],
  ["sci-dk", "M-6 6L-7.5 10L-3.8 6.6Z"],
  ["sci-dk:1.3", "M-1 9.6H8"],
];
// A card of a colour, in its daylight tones in both themes so the colours stay apart on cream.
const cardGlyph = (c) => [[`card-${c}`, rr(-6.4, -9, 12.8, 18, 2.2)], [`card-${c}-lt`, rr(-4.4, -7, 8.8, 7, 1.4)]];
const ICONS = {
  wood: [["wood", "M-9 -1.5C-9 -5.5 -7 -6 -5 -6H5V5H-5C-7 5 -9 4.5 -9 -1.5Z"], ["wood-end", oval(5, -0.5, 3.4, 5.5)], ["wood-ring:1.3", oval(5, -0.5, 1.6, 2.8)], ["wood-dk:1.3", "M-6 -3.5H1M-7 1.5H-1"], ["leaf", "M-4 -6C-5 -8.5 -2.5 -10 -0.5 -9.5C-1 -8 -2.2 -6.8 -4 -6Z"]],
  stone: [["stone", "M-8 -3L-2 -8L9 -6L8 4L1 8L-9 5Z"], ["stone-lt", "M-8 -3L-2 -8L9 -6L2 -2Z"], ["stone-dk", "M2 -2L9 -6L8 4L1 8Z"], ["stone-line:1.3", "M-5 1L-2 3M-4 5L0 4"]],
  clay: [["clay", R0(-9, 2, 8, 5) + R0(1, 2, 8, 5) + R0(-4.5, -4, 8, 5.5)], ["clay-lt", "M-9 2l1.5 -1.5H-1L-1 2ZM1 2l1.5 -1.5H9L9 2ZM-4.5 -4l1.5 -1.5H5L3.5 -4Z"], ["clay-dk", "M3.5 -4L5 -5.5V0L3.5 1.5ZM-1 2L0.5 0.5V5.5L-1 7ZM9 2L10.5 0.5V5.5L9 7Z"]],
  ore: [["ore", "M-9 6L-7 -1L-2 -3L1 2L-1 7ZM-1 7L1 2L3 -6L8 -4L9 5Z"], ["ore-lt", "M-7 -1L-2 -3L-3 1ZM3 -6L8 -4L5 -1Z"], ["ore-dk", "M-1 7L1 2L4 4Z"], ["glint", star(5.5, -7.5, 2.4, 0.7, 4)]],
  glass: [["glass", "M-2.5 -9H2.5V-6.5C2.5 -5 6 -3 6 2C6 7 3 9 0 9C-3 9 -6 7 -6 2C-6 -3 -2.5 -5 -2.5 -6.5Z"], ["glass-dk", "M-6 2C-6 7 -3 9 0 9C3 9 6 7 6 2Q0 4 -6 2Z"], ["glint:1.3", "M-3.5 -1C-4.5 1 -4.5 4 -3 6"], ["cork", R0(-3, -10, 6, 1.6)]],
  cloth: [["cloth", "M-9.5 3.5H6.5Q10 3.5 10 6Q10 8.5 6.5 8.5H-9.5ZM-9.5 -6.5H6.5Q10 -6.5 10 -4Q10 -1.5 6.5 -1.5H-9.5Z"], ["cloth-lt", "M-8.5 -1.5H7.5Q10.5 -1.5 10.5 1Q10.5 3.5 7.5 3.5H-8.5Z"], ["cloth-dk", "M-3.5 -7H-0.5V9H-3.5ZM-2 -7Q-6 -11 -7 -8Q-6 -6.5 -2 -7Q2 -11 3 -8Q2 -6.5 -2 -7Z"]],
  papyrus: [["papyrus", "M-7 -8H6V6C6 8 7 9 8 9H-5C-6 9 -7 8 -7 6Z"], ["papyrus-dk", "M-9 -8C-9 -10 -7 -10 -5 -10H6C4 -10 4 -6 6 -6H-5C-7 -6 -9 -6 -9 -8Z"], ["papyrus-line:1.3", "M-4 -3H3M-4 0H3M-4 3H1"]],
  star: [["gold", dot(0, 0, 10) + hole(0, 0, 7.6)], ["sci", star(0, 0, 7.2, 2.6, 8)], ["sci-lt", dot(0, 0, 1.6)]],
  cog: [["sci", gearD(0, 0, 10, 7.6, 8, 3.2)], ["sci-dk", dot(0, 0, 5.2) + hole(0, 0, 3.2)], ["sci-lt", "M-2 -8.6Q-6.2 -7.4 -7.8 -3.4L-6.4 -2.8Q-5 -6 -1.6 -7.1Z"]],
  quill,
  crown: [["crown", crownD], ["crown-dk", R0(-9.5, -1.5, 19, 2.5)], ["crown-lt", dot(0, -10.5, 1.5) + dot(-10, -9.5, 1.3) + dot(10, -9.5, 1.3)]],
  shield: [["shield", shieldD], ["shield-dk", "M0 -10L8.5 -7V0C8.5 5 4.5 8.5 0 10Z"], ["shield-line:1.3", "M0 -5V5M-4.5 -1H4.5"]],
  coin: [["coin-dk", dot(0, 0, 9.6)], ["coin", dot(-0.4, -0.6, 8.6)], ["glint:1", "M-5.4 -3.4A6 6 0 0 1 -1.8 -6.6"]],
  west: [["arrow", "M8 -5V5H-1V9L-10 0L-1 -9V-5Z"]],
  east: [["arrow", "M-8 -5V5H1V9L10 0L1 -9V-5Z"]],
  stage: [["stage-dk", R0(-9.5, 4, 19, 5.5)], ["stage", R0(-7, -1.4, 14, 5.6)], ["stage-lt", R0(-4.4, -6.8, 8.8, 5.6)], ["gold", poly(-1, -6.8, -1, -11, 3.6, -9.6, 0, -8.6, 0, -6.8)]],
  defeat: [["defeat", "M-8 -9H8L6 -2L8.5 3L5 9.5L1 6L-3 9.5L-8 7Z"]],
  empty: [["muted:1.1", rr(-5.6, -8.2, 11.2, 16.4, 2)]],
  link: [["ink:1.8", rr(-8.6, -3.2, 9.6, 6.4, 3.2) + rr(-1, -3.2, 9.6, 6.4, 3.2)]],
  ...Object.fromEntries(COLOURS.map((c) => [`card-${c}`, cardGlyph(c)])),
};
ICONS.empty.flat = true;
ICONS.link.flat = true;

// One icon at (x, y), size units across, with its paper shadow.
function glyph(name, x, y, size) {
  if (name === "wild") return wild(x, y, size);
  const parts = ICONS[name];
  const sil = parts.flat ? "" : parts.filter(([r]) => !r.includes(":") && !/-(lt|line)$|glint/.test(r)).map((p) => p[1]).join("");
  return G(`translate(${pt(x, y)}) scale(${n(size / 20)})`, (sil ? shade(sil, 0.8) : "") + parts.map(([r, d]) => P(d, r)).join(""));
}
// Any of the three symbols: they sit in a gold ring.
function wild(x, y, size) {
  const k = size / 20;
  return G(`translate(${pt(x, y)}) scale(${n(k)})`, shade(dot(0, 0, 10), 0.8) + P(dot(0, 0, 10), "gold") + P(dot(0, 0, 8.4), "cream") + glyph("star", 0, -4.2, 7.2) + glyph("cog", -3.8, 2.6, 7.2) + glyph("quill", 4, 2.6, 7.6));
}
// A coin or a crown with its number.
const coinAt = (v, x, y, size) => glyph("coin", x, y, size) + T(x - size * 0.02, y + size * 0.19, size * 0.52, "coin-ink sc-bold", v);
const pointsAt = (v, x, y, size) => glyph("crown", x, y, size) + T(x, y + size * 0.42, size * 0.46, "crown-ink sc-bold", v);
const defeatAt = (x, y, size) => glyph("defeat", x, y, size) + T(x, y + size * 0.19, size * 0.5, "defeat-lt sc-bold", "−1");

// ---------- effects ----------
const slash = (x, y, s) => P(`M${pt(x + 0.12 * s, y - 0.3 * s)}L${pt(x - 0.12 * s, y + 0.3 * s)}`, `muted:${n(s * 0.09)}`);
const times = (x, y, s) => P(`M${pt(x - 0.12 * s, y - 0.12 * s)}l${n(0.24 * s)} ${n(0.24 * s)}m0 ${n(-0.24 * s)}l${n(-0.24 * s)} ${n(0.24 * s)}`, `muted:${n(s * 0.08)}`);
const one = (p) => (p === "stage" ? ["stage", 0.82] : p === "defeat" ? ["defeat", 0.8] : [`card-${p}`, 0.7]);
const drawOne = (nm, x, y, size) => (nm === "defeat" ? defeatAt(x, y, size) : glyph(nm, x, y, size));
// What a yellow or purple card counts and where: arrows for the neighbours,
// a dashed slot for your own city when it doesn't count.
function whereParts({ per, from }, add, mini = false) {
  const list = Array.isArray(per) ? per : null, left = from.includes("left"), right = from.includes("right"), self = from.includes("self");
  if (left) add(0.5, (x, y, s) => glyph("west", x, y, s * 0.5));
  const slots = list ? list : [left && per, self ? per : left && right && !mini ? "empty" : null, right && per].filter(Boolean);
  for (const p of slots) {
    const [nm, k] = p === "empty" ? ["empty", 0.7] : one(p);
    add(k, (x, y, s) => drawOne(nm, x, y, s * k));
  }
  if (right) add(0.5, (x, y, s) => glyph("east", x, y, s * 0.5));
}
function resGrid(kinds, x, y, s) {
  if (kinds.length === 4) return kinds.map((r, i) => glyph(RES[r], x + (i % 2 ? 0.27 : -0.27) * s, y + (i < 2 ? -0.27 : 0.27) * s, s * 0.52)).join("");
  return kinds.map((r, i) => glyph(RES[r], x + (i - (kinds.length - 1) / 2) * 0.52 * s, y, s * 0.54)).join("");
}
// The effect as parts of a row: { w (in icon sizes), draw(x, y, s) }.
function fxParts(c) {
  const out = [];
  const add = (w, draw) => out.push({ w, draw });
  const ic = (name, k = 1) => add(k, (x, y, s) => glyph(name, x, y, s * k));
  if (c.produce) {
    if (c.produce.length > 1) for (const [r] of c.produce) ic(RES[r]);
    else c.produce[0].forEach((r, i) => (i && add(0.42, slash), ic(RES[r])));
  } else if (c.points) add(1.15, (x, y, s) => pointsAt(c.points, x, y, s * 1.15));
  else if (c.shields) for (let i = 0; i < c.shields; i++) ic("shield", 0.95);
  else if (c.science !== undefined) ic(c.science === "any" ? "wild" : SCI[c.science], 1.1);
  else if (c.gold) add(1, (x, y, s) => coinAt(c.gold, x, y, s));
  else if (c.trade) {
    const { kinds, sides } = c.trade;
    if (sides.includes("left")) ic("west", 0.62);
    add(kinds.length === 4 ? 1.08 : 1.56, (x, y, s) => resGrid(kinds, x, y, s));
    add(0.86, (x, y, s) => coinAt(1, x, y, s * 0.86));
    if (sides.includes("right")) ic("east", 0.62);
  } else {
    if (c.income) add(1, (x, y, s) => coinAt(c.income.coins, x, y, s));
    if (c.score) add(1.1, (x, y, s) => pointsAt(c.score.points, x, y, s * 1.1));
    add(0.4, times);
    whereParts(c.score || c.income, add);
  }
  return out;
}
const GAP = 0.12;
const rowWidth = (parts) => parts.reduce((a, p) => a + p.w, 0) + GAP * (parts.length - 1);
function drawRow(parts, cx, y, s) {
  let x = cx - (rowWidth(parts) * s) / 2, o = "";
  for (const p of parts) {
    o += p.draw(x + (p.w * s) / 2, y, s);
    x += (p.w + GAP) * s;
  }
  return o;
}

// The mini face's effect, as big as the plate (x 6 to 94, y 6 to 78) allows.
function miniEffect(c) {
  const cx = 50, cy = 42;
  const big = (name, size = 54) => glyph(name, cx, cy, size);
  if (c.produce) {
    if (c.produce.length > 1) return c.produce.map(([r], i) => glyph(RES[r], i ? 71 : 29, cy, 40)).join("");
    const opts = c.produce[0];
    if (opts.length === 1) return big(RES[opts[0]], 56);
    const lines = { 2: "M80 10L20 74", 3: "M50 42V78M50 42L8 16M50 42L92 16", 4: "M10 8L90 76M90 8L10 76" }[opts.length];
    const at = { 2: [[32, 28, 36], [68, 56, 36]], 3: [[50, 20, 28], [24, 58, 28], [76, 58, 28]], 4: [[50, 19, 26], [21, 42, 26], [79, 42, 26], [50, 65, 26]] }[opts.length];
    return P(lines, "muted:2") + opts.map((r, i) => glyph(RES[r], ...at[i])).join("");
  }
  if (c.points) return pointsAt(c.points, cx, cy, 60);
  if (c.shields) return Array.from({ length: c.shields }, (_, i) => glyph("shield", [[50], [30, 70], [22, 50, 78]][c.shields - 1][i], cy, [54, 40, 32][c.shields - 1])).join("");
  if (c.science !== undefined) return c.science === "any" ? wild(cx, cy, 60) : big(SCI[c.science], 58);
  if (c.gold) return coinAt(c.gold, cx, cy, 56);
  if (c.trade) {
    const { kinds, sides } = c.trade, l = sides.includes("left"), r = sides.includes("right");
    const top = l && r ? glyph("west", 18, 24, 22) + coinAt(1, 50, 24, 30) + glyph("east", 82, 24, 22) : l ? glyph("west", 30, 24, 26) + coinAt(1, 64, 24, 30) : coinAt(1, 36, 24, 30) + glyph("east", 70, 24, 26);
    return top + kinds.map((k, i) => glyph(RES[k], 50 + (i - (kinds.length - 1) / 2) * (kinds.length === 4 ? 20 : 24), 60, kinds.length === 4 ? 19 : 22)).join("");
  }
  const spec = c.score || c.income, pays = [];
  if (c.income) pays.push((x) => coinAt(c.income.coins, x, 23, 30));
  if (c.score) pays.push((x) => pointsAt(c.score.points, x, 23, 32));
  const top = pays.length === 2 ? pays[0](33) + pays[1](67) : pays[0](50);
  const parts = [];
  whereParts(spec, (w, draw) => parts.push({ w, draw }), true);
  const s = Math.min(40, 86 / rowWidth(parts));
  return top + drawRow(parts, cx, 58, s);
}

// ---------- text ----------
// Fredoka's advance widths (em) for fitting names: a-z, then A-Z.
const ADV = "6063526360396365303062309865636363455043655786575749696762735655727739336656948179627966556076659767635826275728";
const advance = (ch) => {
  const i = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ '·".indexOf(ch);
  return i < 0 ? 0.6 : Number(ADV.slice(i * 2, i * 2 + 2)) / 100;
};
const textWidth = (s, size) => [...s].reduce((a, ch) => a + advance(ch), 0) * size;
// A name on one line, squeezed a little if need be, or on two.
function fitName(name, room = 90) {
  const w = textWidth(name, 1);
  if (w * 12 <= room) return { size: 12, lines: [name] };
  if (w * 10.6 * 0.9 <= room) {
    const size = Math.max(10.6, room / w);
    return { size, lines: [name], squeeze: w * size > room };
  }
  const words = name.split(" ");
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" "), m = Math.max(textWidth(a, 1), textWidth(b, 1));
    if (!best || m < best.m) best = { m, lines: [a, b] };
  }
  return { size: Math.min(11, room / best.m), lines: best.lines };
}

const NAMES = Object.fromEntries(CARDS.map((c) => [c.key, c.name]));
const LEADS = {};
for (const c of CARDS) for (const k of c.from) if (!(LEADS[k] ||= []).includes(c.name)) LEADS[k].push(c.name);

// ---------- words for screen readers and tips ----------
const ROMAN = ["", "I", "II", "III"];
const list = (xs, last = "and") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${last} ${xs[xs.length - 1]}`);
function effectWords(c) {
  if (c.produce) return c.produce.length > 1 ? `Makes ${c.produce.length} ${RES[c.produce[0][0]]}` : `Makes 1 ${list(c.produce[0].map((r) => RES[r]), "or")}`;
  if (c.points) return `Worth ${c.points} points`;
  if (c.shields) return `${c.shields} shield${c.shields > 1 ? "s" : ""}`;
  if (c.science !== undefined) return c.science === "any" ? "Science: any one symbol" : `Science: ${SCI[c.science]}`;
  if (c.gold) return `${c.gold} coins when built`;
  if (c.trade) {
    const who = c.trade.sides.length > 1 ? "either neighbour" : c.trade.sides[0] === "right" ? "your right neighbour (east)" : "your left neighbour (west)";
    return `Buy ${list(c.trade.kinds.map((r) => RES[r]), "or")} from ${who} for 1 coin`;
  }
  const spec = c.score || c.income, per = Array.isArray(spec.per) ? spec.per : [spec.per];
  const whose = { self: "your city", "left,right": "your neighbours' cities", "left,self,right": "your and your neighbours' cities" }[spec.from.join(",")];
  const thing = per[0] === "stage" ? "wonder stage built" : per[0] === "defeat" ? "defeat token" : `${list(per, "or")} card`;
  const pay = [c.income && `${c.income.coins} coin${c.income.coins > 1 ? "s" : ""} now`, c.score && `${c.score.points} point${c.score.points > 1 ? "s" : ""} at the end`].filter(Boolean).join(" and ");
  return `${pay[0].toUpperCase()}${pay.slice(1)} for each ${thing} in ${whose}`;
}
function costWords(cost) {
  const parts = [];
  if (cost.coins) parts.push(`${cost.coins} coin${cost.coins > 1 ? "s" : ""}`);
  cost.res.forEach((k, r) => k && parts.push(`${k} ${RES[r]}`));
  return parts.length ? `Costs ${list(parts)}` : "Free to build";
}
// A card in words: its name, age, colour, cost, effect and chains.
export function cardText(id) {
  const c = CARDS[id];
  const chains = [c.from.length && `Free if you have ${list(c.from.map((k) => NAMES[k]), "or")}.`, LEADS[c.key] && `Makes ${list(LEADS[c.key], "and")} free.`].filter(Boolean);
  return [`${c.name}, age ${ROMAN[c.age]} ${c.color} card.`, `${costWords(c.cost)}.`, `${effectWords(c)}.`, ...chains].join(" ");
}

// ---------- the card ----------
const lipD = (y) => `M-2 ${y}` + Array.from({ length: 8 }, (_, i) => `Q${pt(i * 13 + 6.5, y + (i % 2 ? 2.6 : -2.6))} ${pt((i + 1) * 13, y)}`).join("") + "V142H-2Z";
const PUNCH = (() => {
  let d = "";
  for (let x = 9; x <= 91; x += 5.5) d += dot(x, 4.4, 0.8) + dot(x, 135.6, 0.8);
  for (let y = 10; y <= 130; y += 5.5) d += dot(4.4, y, 0.8) + dot(95.6, y, 0.8);
  return d;
})();
const plate = (x, y, w, h, r = Math.min(w / 2, h / 2, 13)) => shade(rr(x, y, w, h, r), 1.2) + P(rr(x, y, w, h, r), "cream");
const root = (cls, label, inner, mini) =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="0 0 100 140"${mini ? ' preserveAspectRatio="xMidYMin slice"' : ""} role="img" aria-label="${esc(label)}">${inner}</svg>`;

function costColumn(cost) {
  const items = [];
  if (cost.coins) items.push((x, y, s) => coinAt(cost.coins, x, y, s));
  cost.res.forEach((k, r) => {
    for (let i = 0; i < k; i++) items.push((x, y, s) => glyph(RES[r], x, y, s));
  });
  if (!items.length) return "";
  const step = items.length > 5 ? 9.6 : 12, size = step - 1;
  return plate(3.4, 3.4, 13.4, items.length * step + 3.4) + items.map((f, i) => f(10.1, 5.1 + step * (i + 0.5), size)).join("");
}
// Chain tags, flowed into rows: gold for the cards that build this one free,
// outlined for those it builds free.
const tagWidth = (t, size) => textWidth(t.text, size) + size * 1.7 + 3.4;
// At most two rows, as large as fits: the cards that build this one free on
// their own row when they can, then in order, then packed.
function tagRows(c) {
  const tags = [...c.from.map((k) => ({ from: true, text: NAMES[k] })), ...(LEADS[c.key] || []).map((text) => ({ from: false, text }))];
  const flow = (size, pack) => {
    const rows = [];
    for (const t of tags) {
      const fits = (r) => r.reduce((a, u) => a + tagWidth(u, size) + 2.2, 0) + tagWidth(t, size) <= 91;
      const last = rows[rows.length - 1];
      const row = pack === "pack" ? rows.find(fits) : last && fits(last) && (pack !== "kind" || last[0].from === t.from) && last;
      if (row) row.push(t);
      else rows.push([t]);
    }
    return rows;
  };
  let rows = [], size = 6.6;
  for (const mode of ["kind", "flow"]) for (size = 6.6; size > 5.3; size -= 0.4) if ((rows = flow(size, mode)).length <= 2) return { rows, size };
  for (size = 6.6; size > 5.3; size -= 0.4) if ((rows = flow(size, "pack")).length <= 2) break;
  return { rows, size };
}
function drawTags({ rows, size }, y) {
  let o = "";
  for (const row of rows) {
    const h = size + 3.4, total = row.reduce((a, t) => a + tagWidth(t, size), 0) + 2.2 * (row.length - 1);
    let x = 50 - total / 2;
    for (const t of row) {
      const tw = textWidth(t.text, size), w = tagWidth(t, size);
      if (t.from) o += P(rr(x, y, w, h, h / 2), "gold") + glyph("link", x + 1.8 + size * 0.7, y + h / 2, size * 1.25) + T(x + size * 1.45 + 1.8 + tw / 2, y + h * 0.73, size, "ink", t.text);
      else o += P(rr(x + 0.35, y + 0.35, w - 0.7, h - 0.7, h / 2 - 0.35), "cream:0.7") + T(x + 2 + tw / 2, y + h * 0.73, size, "cream", t.text) + P(`M${pt(x + w - 2 - size * 0.62, y + h / 2 - size * 0.3)}l${n(size * 0.46)} ${n(size * 0.3)}l${n(-size * 0.46)} ${n(size * 0.3)}Z`, "cream");
      x += w + 2.2;
    }
    y += h + 1.8;
  }
  return o;
}

// The diorama runs down to the paper lip at y 100; the plate sits on the lip.
const LIP = 100;
function fullFace(c) {
  let o = P(R0(0, 0, 100, 140), "t4");
  o += `<svg x="0" y="0" width="100" height="${LIP}" viewBox="0 -8 100 ${LIP}">${scene(c.key)}</svg>`;
  o += shade(lipD(LIP), 1.2) + P(lipD(LIP), "t4") + P(PUNCH, "t0", ' opacity="0.5"');
  o += shade(rr(82, 3.4, 14.6, 10, 5)) + P(rr(82, 3.4, 14.6, 10, 5), "t4") + T(89.3, 10.9, 7.2, "cream sc-bold", ROMAN[c.age]);
  o += costColumn(c.cost);
  const parts = fxParts(c), s = Math.min(20, 84 / rowWidth(parts)), pw = Math.max(38, rowWidth(parts) * s + 12), cy = LIP - 13;
  o += plate(50 - pw / 2, cy - (s + 9) / 2, pw, s + 9) + drawRow(parts, 50, cy, s);
  // the name, then the chain tags, centred under the lip
  const tags = tagRows(c), rows = tags.rows, name = fitName(c.name), size = rows.length > 1 ? Math.min(name.size, 10.4) : name.size;
  const lh = size * 1.06, total = name.lines.length * lh + rows.length * (tags.size + 5.2) + (rows.length ? 1.4 : 0);
  let y = LIP + 2 + Math.max(0, (35 - total) / 2);
  for (const line of name.lines) {
    o += T(50, y + size * 0.8, size, "cream", line, textWidth(line, size) > 90 ? ' textLength="90" lengthAdjust="spacingAndGlyphs"' : "");
    y += lh;
  }
  return o + drawTags(tags, y + 1.4);
}
function miniFace(c) {
  return P(R0(0, 0, 100, 140), "t3") + P(hillD(104, [6, 10, 4], 142), "t2") + shade(lipD(118)) + P(lipD(118), "t4") + P(PUNCH, "t0", ' opacity="0.5"') + plate(6, 6, 88, 72) + miniEffect(c);
}

export function cardSvg(id, { size = "full" } = {}) {
  const c = CARDS[id];
  if (!c) throw new RangeError(`No card design ${id}`);
  const mini = size === "mini";
  return root(`sc-card sc-c-${c.color}${mini ? " sc-mini" : ""}`, cardText(id), mini ? miniFace(c) : fullFace(c), mini);
}

// ---------- the backs: one, two or three lanterns by age ----------
function lanternAt(x, y, k) {
  return P(`M${pt(x, y - 9 * k)}V${n(y - 5 * k)}`, `cream:${n(0.8 * k)}`) + P(dot(x, y + 2 * k, 12 * k), "lamp", ' opacity="0.14"') + P(dot(x, y + 2 * k, 8 * k), "lamp", ' opacity="0.2"') + P(rr(x - 3 * k, y - 5.5 * k, 6 * k, 2 * k, 0.8 * k) + rr(x - 3 * k, y + 7.5 * k, 6 * k, 2 * k, 0.8 * k), "t4") + P(`M${pt(x - 4.5 * k, y - 3.5 * k)}Q${pt(x - 6.5 * k, y + 2 * k)} ${pt(x - 4.5 * k, y + 7.5 * k)}H${n(x + 4.5 * k)}Q${pt(x + 6.5 * k, y + 2 * k)} ${pt(x + 4.5 * k, y - 3.5 * k)}Z`, "lamp") + P(`M${pt(x, y - 3.5 * k)}V${n(y + 7.5 * k)}`, `gold-dk:${n(0.8 * k)}`);
}
const BACK_STARS = [[14, 14], [30, 9], [72, 10], [88, 16], [20, 44], [82, 46], [12, 62], [90, 66], [46, 8], [62, 52], [38, 54], [26, 30], [76, 32]];
export function cardBack(age, { size = "full" } = {}) {
  const a = Math.min(3, Math.max(1, Math.round(age) || 1)), mini = size === "mini", label = `A face-down age ${ROMAN[a]} card`;
  let o = P(R0(0, 0, 100, 140), "t3");
  if (mini) return root(`sc-card sc-back sc-c-back${a} sc-mini`, label, o + P(PUNCH, "t0", ' opacity="0.5"') + T(50, 92, a === 3 ? 46 : 58, "cream sc-bold", ROMAN[a]), true);
  o += P(BACK_STARS.map(([x, y], i) => star(x, y, 1.2 + (i % 3) * 0.5, 0.45, 4)).join(""), "cream", ' opacity="0.75"');
  o += P("M6 16Q50 36 94 16", "cream:0.8", ' opacity="0.8"');
  const pos = [[50], [32, 68], [22, 50, 78]][a - 1];
  for (const x of pos) o += lanternAt(x, 16 + 20 * (1 - ((x - 50) / 44) ** 2) * 0.5 + 12, 1.7);
  o += G("translate(50 76) scale(1.15)", shade(crownD, 0.8) + P(crownD, "cream") + P(dot(0, -10.5, 1.5) + dot(-10, -9.5, 1.3) + dot(10, -9.5, 1.3), "gold"));
  for (const [y, b, op] of [[98, [10, 6, 12, 8], 0.64], [110, [8, 12, 6], 0.82], [122, [6, 9, 7, 10], 1]]) o += shade(hillD(y, b, 142), 1.2) + P(hillD(y, b, 142), "t4", ` opacity="${op}"`);
  o += T(50, 133, 15, "cream sc-bold", ROMAN[a]) + P(rr(5, 5, 90, 130, 6), "cream:0.8", ' stroke-dasharray="1.2 2.6" opacity="0.8"');
  return root(`sc-card sc-back sc-c-back${a}`, label, o, false);
}

// ---------- icons for the screen ----------
const iconSvg = (name, label, inner) => `<svg xmlns="http://www.w3.org/2000/svg" class="sc-icon sc-icon-${name}" viewBox="-12 -12 24 24" role="img" aria-label="${esc(label)}">${inner}</svg>`;
export const resourceIcon = (r) => iconSvg(RES[r], RES[r], glyph(RES[r], 0, 0, 20));
export const scienceIcon = (s) => (s === "any" ? iconSvg("wild", "any science symbol", wild(0, 0, 20)) : iconSvg(SCI[s], SCI[s], glyph(SCI[s], 0, 0, 20)));
export const coinIcon = (v) => iconSvg("coin", v === undefined ? "coin" : `${v} coin${v === 1 ? "" : "s"}`, v === undefined ? glyph("coin", 0, 0, 20) : coinAt(v, 0, 0, 20));
export const shieldIcon = () => iconSvg("shield", "shield", glyph("shield", 0, 0, 20));
export const pointsIcon = (v) => iconSvg("points", `${v} point${v === 1 ? "" : "s"}`, pointsAt(v, 0, 0, 20));
// side "left" (west) or "right" (east): the arrow points at that neighbour.
export const neighbourIcon = (side) => iconSvg(side, `${side} neighbour`, glyph(side === "left" ? "west" : "east", 0, 0, 20));
export const colourIcon = (colour) => iconSvg(`card-${colour}`, `${colour} card`, glyph(`card-${colour}`, 0, 0, 20));
// A card's effect drawn alone, as on its plate: for tips and score sheets.
export function effectIcon(id) {
  const parts = fxParts(CARDS[id]), w = rowWidth(parts) * 20 + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="sc-icon sc-effect" viewBox="${n(-w / 2)} -12 ${n(w)} 24" role="img" aria-label="${esc(effectWords(CARDS[id]))}">${drawRow(parts, 0, 0, 20)}</svg>`;
}
