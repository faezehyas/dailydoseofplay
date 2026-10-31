// Hexlands' cards as SVG markup strings (no DOM): the five resource cards with
// a little scene each, the five development cards, the card back, and the
// resource glyphs that cards, harbours and the hand share. Colours are classes
// (hx-cf-* fills, hx-cs-* strokes) that card-art.css maps to --hx-card-*
// tokens for light and dark. There are no ids or url() references, so a card
// can show any number of times on a page; the scene is clipped by a nested
// <svg>. A card is 100 x 140 units, sized by CSS; with the class hx-mini (a
// phone hand, about 44 px wide) it shows only its colour and a big glyph.

export const RESOURCE_TITLES = ["Wood", "Brick", "Wool", "Grain", "Ore"];
const RES_KEYS = ["wood", "brick", "wool", "grain", "ore"];
const FIELDS = ["forest", "hills", "pasture", "fields", "mountains"];

export const DEV_KINDS = ["knight", "vp", "road", "plenty", "monopoly"];
export const DEV_TEXT = {
  knight: { title: "Knight", effect: ["Move the robber", "and steal a card."] },
  vp: { title: "Victory Point", effect: ["Worth 1 point.", "Show it to win."] },
  road: { title: "Road Building", effect: ["Build 2 roads", "for free."] },
  plenty: { title: "Year of Plenty", effect: ["Take any 2 resources", "from the bank."] },
  monopoly: { title: "Monopoly", effect: ["Everyone gives you", "all of one resource."] },
};
const DEV_FIELD = { knight: "knight", vp: "vp", road: "prog", plenty: "prog", monopoly: "prog" };

// ---------- drawing helpers ----------
const n = (v) => Math.round(v * 100) / 100;
const pt = (x, y) => `${n(x)} ${n(y)}`;
const ink = (w) => ["ink", w];
const line = (c, w) => [c, w];
const op = (o) => ` opacity="${o}"`;

// fill: a token name, or "" for none; stroke: [token, width] or "".
function paint(fill, stroke) {
  const cls = [];
  let at = "";
  if (fill) cls.push(`hx-cf-${fill}`);
  else at += ' fill="none"';
  if (stroke) {
    cls.push(`hx-cs-${stroke[0]}`);
    at += ` stroke-width="${n(stroke[1])}"`;
  }
  return (cls.length ? ` class="${cls.join(" ")}"` : "") + at;
}
const circle = (x, y, r, fill, stroke = "", extra = "") => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}"${paint(fill, stroke)}${extra}/>`;
const ellipse = (x, y, rx, ry, fill, stroke = "", extra = "") =>
  `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}"${paint(fill, stroke)}${extra}/>`;
const rect = (x, y, w, h, r, fill, stroke = "", extra = "") =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${r ? ` rx="${n(r)}"` : ""}${paint(fill, stroke)}${extra}/>`;
const path = (d, fill, stroke = "", extra = "") => `<path d="${d}"${paint(fill, stroke)}${extra}/>`;
const group = (transform, inner, extra = "") => `<g transform="${transform}"${extra}>${inner}</g>`;
const text = (x, y, size, cls, s, extra = "") => `<text x="${n(x)}" y="${n(y)}" font-size="${size}" text-anchor="middle" class="${cls}"${extra}>${s}</text>`;

// Circles merged under one outline: the outline is drawn underneath.
const blob = (circles, fill, w = 2.4) =>
  circles.map(([x, y, r]) => circle(x, y, r + w / 2, "ink")).join("") + circles.map(([x, y, r]) => circle(x, y, r, fill)).join("");
const shadow = (x, y, rx, o = 0.2) => ellipse(x, y, rx, rx * 0.3, "shadow", "", op(o));
const sparkle = (x, y, r, fill = "glint") =>
  path(`M${pt(x, y - r)}Q${pt(x, y)} ${pt(x + r, y)}Q${pt(x, y)} ${pt(x, y + r)}Q${pt(x, y)} ${pt(x - r, y)}Q${pt(x, y)} ${pt(x, y - r)}Z`, fill);
const tuft = (x, y, s, c = "grass") =>
  path(`M${pt(x - 2.4 * s, y)}q${n(0.8 * s)} ${n(-2.4 * s)} ${n(0.4 * s)} ${n(-4 * s)}M${pt(x, y)}q0 ${n(-3.2 * s)} ${n(0.4 * s)} ${n(-4.8 * s)}M${pt(x + 2.4 * s, y)}q${n(-0.8 * s)} ${n(-2.4 * s)} ${n(-0.2 * s)} ${n(-3.7 * s)}`, "", line(c, 1.1));
const flower = (x, y, c) => circle(x, y, 1.5, c) + circle(x, y, 0.6, "wheat");
const roundedRect = (x, y, w, h, r) =>
  `M${pt(x + r, y)}H${n(x + w - r)}A${r} ${r} 0 0 1 ${pt(x + w, y + r)}V${n(y + h - r)}A${r} ${r} 0 0 1 ${pt(x + w - r, y + h)}H${n(x + r)}A${r} ${r} 0 0 1 ${pt(x, y + h - r)}V${n(y + r)}A${r} ${r} 0 0 1 ${pt(x + r, y)}Z`;
const hexPath = (cx, cy, r) =>
  "M" + Array.from({ length: 6 }, (_, i) => pt(cx + r * Math.cos((Math.PI / 3) * i - Math.PI / 2), cy + r * Math.sin((Math.PI / 3) * i - Math.PI / 2))).join("L") + "Z";

// ---------- landscape pieces ----------
// A sky that pales towards the horizon: thin veils of haze over a base colour.
const haze = (w, h, base, veil, o) => rect(-1, -1, w + 2, h + 2, 0, base) + Array.from({ length: 7 }, (_, i) => rect(-1, (h * (i + 1)) / 8, w + 2, h, 0, veil, "", op(o))).join("");
const sky = (w, h) => haze(w, h, "sky", "sky-haze", 0.16);
const sun = (x, y, r) => circle(x, y, r * 2.1, "sun", "", op(0.14)) + circle(x, y, r * 1.5, "sun", "", op(0.28)) + circle(x, y, r, "sun");
function cloud(x, y, s) {
  return (
    `<g${op(0.92)}>` +
    circle(x - 6 * s, y, 4 * s, "cloud") +
    circle(x, y - 2.6 * s, 5.4 * s, "cloud") +
    circle(x + 6 * s, y - 0.4 * s, 4.2 * s, "cloud") +
    rect(x - 10 * s, y - 1 * s, 20.4 * s, 5 * s, 2.5 * s, "cloud") +
    `</g>`
  );
}
const birds = (x, y) => path(`M${pt(x, y)}q1.6 -1.8 3.2 0q1.6 -1.8 3.2 0M${pt(x + 7, y - 4)}q1.3 -1.5 2.6 0q1.3 -1.5 2.6 0`, "", ink(0.9));
// A rolling hill line across the window, filled down to the bottom.
const hill = (w, y, bumps, fill, extra = "") => {
  let d = `M-2 ${n(y)}`;
  const step = (w + 4) / bumps.length;
  bumps.forEach((b, i) => (d += `Q${pt(-2 + step * (i + 0.5), y - b)} ${pt(-2 + step * (i + 1), y)}`));
  return path(d + `V200H-2Z`, fill, "", extra);
};

function pine(x, y, s, tone = "pine") {
  let o = shadow(x + 1.5 * s, y + 0.4, 9 * s);
  o += rect(x - 1.8 * s, y - 6 * s, 3.6 * s, 6.6 * s, 1 * s, "trunk", ink(1.2));
  for (let i = 0; i < 3; i++) {
    const w = (19 - i * 4.4) * s;
    const yb = y - 4.6 * s - i * 7.2 * s;
    const yt = yb - 12.6 * s;
    o += path(`M${pt(x - w / 2, yb)}Q${pt(x, yb + 3 * s)} ${pt(x + w / 2, yb)}L${pt(x + 1.3 * s, yt + 1.2 * s)}Q${pt(x, yt - 0.7 * s)} ${pt(x - 1.3 * s, yt + 1.2 * s)}Z`, tone, ink(1.4));
    o += path(`M${pt(x + 0.3 * s, yt + 1.4 * s)}L${pt(x + w / 2 - 0.6 * s, yb - 0.3 * s)}Q${pt(x + w / 4, yb + 2 * s)} ${pt(x + 0.3 * s, yb + 2.4 * s)}Z`, "pine-dk", "", op(0.5));
    o += path(`M${pt(x - 1 * s, yt + 2.6 * s)}L${pt(x - w / 2 + 2.6 * s, yb - 0.8 * s)}`, "", line("pine-lt", 1.1 * s), op(0.85));
  }
  return o;
}
function leafy(x, y, s) {
  let o = shadow(x + 1.5 * s, y + 0.4, 10 * s);
  o += path(`M${pt(x - 1.7 * s, y + 0.4)}L${pt(x - 1.3 * s, y - 11 * s)}L${pt(x + 1.3 * s, y - 11 * s)}L${pt(x + 1.7 * s, y + 0.4)}Z`, "trunk", ink(1.2));
  o += blob([[x - 5.5 * s, y - 13.5 * s, 6.3 * s], [x + 5.5 * s, y - 14.3 * s, 6.3 * s], [x, y - 20.2 * s, 7.6 * s], [x, y - 12.6 * s, 5.9 * s]], "tree", 2.6);
  o += circle(x + 3.4 * s, y - 11.8 * s, 5 * s, "tree-dk", "", op(0.45));
  o += circle(x - 2.5 * s, y - 22 * s, 3 * s, "tree-lt", "", op(0.85));
  o += circle(x - 6.8 * s, y - 15.2 * s, 2 * s, "tree-lt", "", op(0.7));
  return o;
}
function sheep(x, y, s, dir = 1) {
  let o = shadow(x, y + 0.6, 9.5 * s, 0.22);
  for (const lx of [-4.4, -1.4, 2.6, 5.2]) o += rect(x + dir * lx * s - 1 * s, y - 5 * s, 2 * s, 5.6 * s, 1 * s, "face");
  o += blob([[x - 4.6 * s, y - 7.6 * s, 4.4 * s], [x, y - 9.7 * s, 4.9 * s], [x + 4.6 * s, y - 7.6 * s, 4.4 * s], [x - 2.1 * s, y - 5.9 * s, 4.2 * s], [x + 2.5 * s, y - 5.9 * s, 4.2 * s]], "wool", 2.2);
  o += circle(x + 2.1 * s, y - 5.5 * s, 3 * s, "wool-sh", "", op(0.8));
  o += circle(x - 1.7 * s, y - 11 * s, 1.9 * s, "glint");
  const hx = x + dir * 8 * s;
  const hy = y - 8.9 * s;
  o += ellipse(hx, hy, 3.2 * s, 3.9 * s, "face", ink(1), ` transform="rotate(${dir * 18} ${n(hx)} ${n(hy)})"`);
  o += ellipse(hx - dir * 2.8 * s, hy - 2.1 * s, 1.9 * s, 0.95 * s, "face", "", ` transform="rotate(${dir * -25} ${n(hx - dir * 2.8 * s)} ${n(hy - 2.1 * s)})"`);
  o += circle(hx + dir * 1 * s, hy - 1 * s, 0.75 * s, "glint");
  return o;
}
function mound(x, y, w, h) {
  let o = shadow(x + 2, y + 0.6, w * 0.55, 0.18);
  o += path(`M${pt(x - w / 2, y)}C${pt(x - w / 2.4, y - h * 1.32)} ${pt(x + w / 2.4, y - h * 1.32)} ${pt(x + w / 2, y)}Q${pt(x, y + 2.4)} ${pt(x - w / 2, y)}Z`, "clay", ink(1.4));
  o += path(`M${pt(x - w * 0.36, y - h * 0.3)}Q${pt(x - w * 0.25, y - h * 0.86)} ${pt(x - w * 0.02, y - h * 0.94)}`, "", line("clay-lt", 2.4), op(0.9));
  o += path(`M${pt(x - w * 0.42, y - h * 0.2)}Q${pt(x, y - h * 0.42)} ${pt(x + w * 0.44, y - h * 0.24)}M${pt(x - w * 0.3, y - h * 0.58)}Q${pt(x + w * 0.05, y - h * 0.74)} ${pt(x + w * 0.34, y - h * 0.6)}`, "", line("clay-dk", 1.1), op(0.8));
  return o;
}
function kiln(x, y, s) {
  let o = shadow(x + 2, y + 0.6, 13 * s, 0.2);
  o += circle(x + 5.6 * s, y - 27 * s, 2.8 * s, "smoke", "", op(0.85)) + circle(x + 8.6 * s, y - 31.5 * s, 3.5 * s, "smoke", "", op(0.68)) + circle(x + 12.5 * s, y - 36 * s, 4.3 * s, "smoke", "", op(0.5)) + circle(x + 17.5 * s, y - 41 * s, 5 * s, "smoke", "", op(0.34));
  o += rect(x + 2.6 * s, y - 24 * s, 4.8 * s, 12 * s, 0.8, "kiln-dk", ink(1.3));
  o += path(`M${pt(x - 11 * s, y)}C${pt(x - 11 * s, y - 20.5 * s)} ${pt(x + 11 * s, y - 20.5 * s)} ${pt(x + 11 * s, y)}Z`, "kiln", ink(1.4));
  o += path(`M${pt(x - 7.6 * s, y - 5 * s)}C${pt(x - 6.8 * s, y - 12.8 * s)} ${pt(x - 1.7 * s, y - 15.3 * s)} ${pt(x + 0.8 * s, y - 15 * s)}`, "", line("kiln-lt", 2 * s));
  for (const [a, b] of [[-9.4, -4.2], [-6, -10.2], [4.2, -10.2], [7.6, -4.2]]) o += path(`M${pt(x + a * s, y + b * s)}l${n(2.6 * s)} ${n(-0.8 * s)}`, "", line("kiln-dk", 0.9));
  o += path(`M${pt(x - 4.7 * s, y)}V${n(y - 4.3 * s)}A${n(4.7 * s)} ${n(4.7 * s)} 0 0 1 ${pt(x + 4.7 * s, y - 4.3 * s)}V${n(y)}Z`, "hole", ink(1.1));
  o += ellipse(x, y - 1.4 * s, 3.1 * s, 2.2 * s, "fire") + ellipse(x, y - 1 * s, 1.7 * s, 1.2 * s, "fire-lt");
  return o;
}
function brickStack(x, y, s, rows = [[-1.5, -0.5, 0.5], [-1, 0], [-0.5]]) {
  const bw = 7.6 * s;
  const bh = 3.9 * s;
  const dz = 2.2 * s;
  let o = shadow(x + 1.5, y + 0.6, 13 * s, 0.2);
  rows.forEach((row, ri) =>
    row.forEach((c) => {
      const bx = x + c * bw * 1.04;
      const by = y - (ri + 1) * bh;
      o += path(`M${pt(bx, by)}l${n(dz)} ${n(-dz)}h${n(bw)}l${n(-dz)} ${n(dz)}Z`, "brick-lt", ink(0.95));
      o += path(`M${pt(bx + bw, by)}l${n(dz)} ${n(-dz)}v${n(bh)}l${n(-dz)} ${n(dz)}Z`, "brick-dk", ink(0.95));
      o += rect(bx, by, bw, bh, 0, "brick", ink(0.95));
    }),
  );
  return o;
}
function sheaf(x, y, s) {
  let o = shadow(x + 1.5, y + 0.6, 8.5 * s, 0.22);
  let stalks = "";
  for (let i = -3; i <= 3; i++) stalks += `M${pt(x + i * 1.6 * s, y)}L${pt(x + i * 0.42 * s, y - 8.5 * s)}L${pt(x + i * 1.35 * s, y - 16 * s)}`;
  o += path(stalks, "", ink(3.5 * s)) + path(stalks, "", line("wheat", 1.8 * s));
  for (let i = -3; i <= 3; i++) {
    const ex = x + i * 1.5 * s;
    const ey = y - 17.8 * s - (3 - Math.abs(i)) * 0.75 * s;
    o += ellipse(ex, ey, 1.95 * s, 4 * s, "wheat-lt", ink(1.1), ` transform="rotate(${i * 10} ${n(ex)} ${n(ey)})"`);
  }
  o += rect(x - 3.8 * s, y - 10 * s, 7.6 * s, 2.7 * s, 1, "band", ink(0.95));
  return o;
}
function windmill(x, y, s) {
  let o = shadow(x + 2.5, y + 0.6, 9.5 * s, 0.22);
  o += path(`M${pt(x - 6 * s, y)}L${pt(x - 3.8 * s, y - 18.7 * s)}L${pt(x + 3.8 * s, y - 18.7 * s)}L${pt(x + 6 * s, y)}Z`, "mill", ink(1.35));
  o += path(`M${pt(x + 0.9 * s, y)}L${pt(x + 1.7 * s, y - 18.7 * s)}L${pt(x + 3.8 * s, y - 18.7 * s)}L${pt(x + 6 * s, y)}Z`, "mill-sh");
  o += rect(x - 1.7 * s, y - 5.1 * s, 3.4 * s, 5.1 * s, 1.7 * s, "trunk", ink(0.95));
  o += path(`M${pt(x - 5.5 * s, y - 17.8 * s)}Q${pt(x, y - 26.4 * s)} ${pt(x + 5.5 * s, y - 17.8 * s)}Z`, "roof", ink(1.35));
  const hy = y - 20.4 * s;
  for (let k = 0; k < 4; k++) {
    o += group(
      `rotate(${k * 90 + 22} ${n(x)} ${n(hy)})`,
      rect(x - 2.2 * s, hy - 16 * s, 4.4 * s, 12.7 * s, 0, "sail", ink(1)) + path(`M${pt(x, hy - 16 * s)}V${n(hy)}M${pt(x - 2.2 * s, hy - 11.9 * s)}h${n(4.4 * s)}M${pt(x - 2.2 * s, hy - 7.6 * s)}h${n(4.4 * s)}`, "", line("sail-ln", 0.8)),
    );
  }
  return o + circle(x, hy, 1.9 * s, "trunk", ink(0.95));
}
function peak(x, y, w, h, snow = true) {
  const ax = x - w * 0.04;
  const ay = y - h;
  let o = shadow(x + 3, y + 0.6, w * 0.5, 0.2);
  o += path(`M${pt(x - w / 2, y)}L${pt(ax, ay)}L${pt(x + w / 2, y)}Q${pt(x, y + 2.4)} ${pt(x - w / 2, y)}Z`, "rock-lt", ink(1.5));
  o += path(`M${pt(ax, ay)}L${pt(x + w / 2, y)}Q${pt(x + w * 0.3, y + 1.6)} ${pt(x + w * 0.1, y + 1.2)}L${pt(x + w * 0.02, y - h * 0.45)}Z`, "rock-dk");
  o += path(`M${pt(x - w * 0.28, y - h * 0.18)}L${pt(x - w * 0.16, y - h * 0.42)}M${pt(x - w * 0.1, y - h * 0.1)}L${pt(x - w * 0.02, y - h * 0.3)}`, "", line("rock", 1.1));
  if (snow) {
    const sx = (t) => ax + (x - w / 2 - ax) * t;
    const sxr = (t) => ax + (x + w / 2 - ax) * t;
    o += path(`M${pt(sx(0.34), ay + h * 0.34)}L${pt(ax, ay)}L${pt(sxr(0.34), ay + h * 0.34)}L${pt(sxr(0.18), ay + h * 0.27)}L${pt(ax + w * 0.04, ay + h * 0.38)}L${pt(ax - w * 0.06, ay + h * 0.26)}Z`, "snow", ink(1.2));
    o += path(`M${pt(ax, ay + 0.8)}L${pt(sxr(0.33), ay + h * 0.335)}L${pt(sxr(0.18), ay + h * 0.27)}L${pt(ax + w * 0.04, ay + h * 0.38)}Z`, "snow-sh");
    o += path(`M${pt(sx(0.34), ay + h * 0.34)}L${pt(ax, ay)}L${pt(sxr(0.34), ay + h * 0.34)}`, "", ink(1.2));
  }
  return o;
}
function crystals(x, y, s) {
  let o = shadow(x, y + 0.6, 7 * s, 0.24);
  const one = (cx, h, w, r) =>
    group(
      `rotate(${r} ${n(cx)} ${n(y)})`,
      path(`M${pt(cx - w, y)}L${pt(cx - w, y - h * 0.7)}L${pt(cx, y - h)}L${pt(cx + w, y - h * 0.7)}L${pt(cx + w, y)}Z`, "gem", ink(1.1)) +
        path(`M${pt(cx - w, y - h * 0.7)}L${pt(cx, y - h)}L${pt(cx, y)}L${pt(cx - w, y)}Z`, "gem-lt", "", op(0.85)),
    );
  o += one(x - 3.4 * s, 7.6 * s, 2 * s, -18) + one(x + 3.4 * s, 8.5 * s, 2.2 * s, 16) + one(x, 11.9 * s, 2.6 * s, 0);
  return o + sparkle(x + 6 * s, y - 12.7 * s, 2.9 * s);
}
const rock = (x, y, s, fill = "rock-lt") =>
  shadow(x + 1, y + 0.5, 4.5 * s, 0.18) + path(`M${pt(x - 4.4 * s, y)}Q${pt(x - 4.4 * s, y - 4.4 * s)} ${pt(x - 0.9 * s, y - 4.8 * s)}Q${pt(x + 3.5 * s, y - 5.3 * s)} ${pt(x + 4.4 * s, y)}Z`, fill, ink(1.1));
function fence(x, y, s, len = 4) {
  const gap = 6.2 * s;
  const span = gap * (len - 1);
  const rails = `M${pt(x - 1.5 * s, y - 4.4 * s)}l${n(span + 3 * s)} ${n(-1.6 * s)}M${pt(x - 1.5 * s, y - 8.4 * s)}l${n(span + 3 * s)} ${n(-1.6 * s)}`;
  let o = path(rails, "", ink(3 * s)) + path(rails, "", line("fence", 1.6 * s));
  for (let i = 0; i < len; i++) o += rect(x + i * gap - 1.2 * s, y - 12.3 * s - (i * 1.6 * s) / (len - 1), 2.4 * s, 12.3 * s, 0.8, "post", ink(0.95));
  return o;
}
function stump(x, y, s) {
  let o = shadow(x + 1, y + 0.6, 10 * s, 0.22);
  o += path(`M${pt(x - 7 * s, y)}Q${pt(x - 5.6 * s, y - 2 * s)} ${pt(x - 5.6 * s, y - 8 * s)}H${n(x + 5.6 * s)}Q${pt(x + 5.6 * s, y - 2 * s)} ${pt(x + 7 * s, y)}Q${pt(x, y + 1.6 * s)} ${pt(x - 7 * s, y)}Z`, "trunk", ink(1.3));
  o += path(`M${pt(x - 2.4 * s, y - 7 * s)}V${n(y - 1)}M${pt(x + 2 * s, y - 6.4 * s)}V${n(y - 2)}`, "", line("trunk-dk", 1));
  o += ellipse(x, y - 8 * s, 5.6 * s, 2.3 * s, "log", ink(1.3));
  o += ellipse(x, y - 8 * s, 3.2 * s, 1.2 * s, "", line("trunk-lt", 0.8));
  // the axe, stuck in the top
  o += path(`M${pt(x + 1 * s, y - 9 * s)}L${pt(x + 9 * s, y - 21 * s)}`, "", ink(3.2 * s)) + path(`M${pt(x + 1 * s, y - 9 * s)}L${pt(x + 9 * s, y - 21 * s)}`, "", line("handle", 1.6 * s));
  o += path(`M${pt(x - 3.4 * s, y - 11.6 * s)}Q${pt(x - 1 * s, y - 14.6 * s)} ${pt(x + 2.6 * s, y - 13.4 * s)}L${pt(x + 4.4 * s, y - 10.2 * s)}Q${pt(x + 0.2 * s, y - 8 * s)} ${pt(x - 3.4 * s, y - 11.6 * s)}Z`, "steel", ink(1.1));
  o += path(`M${pt(x - 2.4 * s, y - 11.8 * s)}Q${pt(x - 0.6 * s, y - 13.6 * s)} ${pt(x + 1.6 * s, y - 13)}`, "", line("glint", 0.9), op(0.9));
  return o;
}
function logs(x, y, s) {
  let o = shadow(x, y + 0.6, 10 * s, 0.2);
  for (const [dx, dy] of [[-4.4, -3.6], [4.4, -3.6], [0, -10.6]]) {
    const cx = x + dx * s;
    const cy = y + dy * s;
    o += path(`M${pt(cx, cy - 3.6 * s)}h${n(-6 * s)}a${n(1.8 * s)} ${n(3.6 * s)} 0 0 0 0 ${n(7.2 * s)}h${n(6 * s)}`, "trunk", ink(1.1));
    o += circle(cx, cy, 3.6 * s, "log", ink(1.1)) + circle(cx, cy, 1.8 * s, "", line("trunk-lt", 0.8));
  }
  return o;
}
function mine(x, y, s) {
  let o = path(`M${pt(x - 6 * s, y)}V${n(y - 7 * s)}Q${pt(x, y - 12 * s)} ${pt(x + 6 * s, y - 7 * s)}V${n(y)}Z`, "hole", ink(1.1));
  o += rect(x - 7.4 * s, y - 9 * s, 2.4 * s, 9 * s, 0.5, "handle", ink(1)) + rect(x + 5 * s, y - 9 * s, 2.4 * s, 9 * s, 0.5, "handle", ink(1));
  o += rect(x - 8.6 * s, y - 11 * s, 17.2 * s, 2.6 * s, 0.6, "handle", ink(1));
  return o + path(`M${pt(x - 9 * s, y + 0.6)}H${n(x + 9 * s)}`, "", line("trunk-dk", 1));
}
function cart(x, y, s) {
  let o = shadow(x, y + 0.6, 11 * s, 0.22);
  o += path(`M${pt(x - 9 * s, y - 13 * s)}L${pt(x + 9 * s, y - 13 * s)}L${pt(x + 7 * s, y - 4 * s)}L${pt(x - 7 * s, y - 4 * s)}Z`, "handle", ink(1.3));
  o += path(`M${pt(x - 8.2 * s, y - 9.6 * s)}H${n(x + 8.2 * s)}`, "", line("trunk-dk", 1));
  o += path(`M${pt(x - 7 * s, y - 13 * s)}Q${pt(x - 5 * s, y - 18 * s)} ${pt(x - 1 * s, y - 17 * s)}Q${pt(x + 3 * s, y - 20 * s)} ${pt(x + 7.4 * s, y - 13 * s)}Z`, "rock-dk", ink(1.1));
  o += circle(x - 3.6 * s, y - 15.2 * s, 2.4 * s, "rock", ink(0.9)) + circle(x + 3.2 * s, y - 15.8 * s, 2.6 * s, "rock-lt", ink(0.9));
  o += path(`M${pt(x - 0.4 * s, y - 14 * s)}l${n(1.5 * s)} ${n(-4.4 * s)}l${n(1.5 * s)} ${n(4.4 * s)}Z`, "gem", ink(0.8));
  o += circle(x - 4.6 * s, y - 3 * s, 2.6 * s, "steel", ink(1.1)) + circle(x + 4.6 * s, y - 3 * s, 2.6 * s, "steel", ink(1.1));
  o += circle(x - 4.6 * s, y - 3 * s, 0.8 * s, "ink") + circle(x + 4.6 * s, y - 3 * s, 0.8 * s, "ink");
  return o;
}

// ---------- resource scenes (88 x 90, horizon near y 52) ----------
const W = 88;
const SCENES = [
  // Wood: a pine wood, a stump with its axe and a log pile.
  () =>
    sky(W, 64) +
    sun(70, 14, 5.4) +
    cloud(24, 15, 0.8) +
    hill(W, 50, [7, 4, 9, 3], "far") +
    hill(W, 58, [5, 8, 4], "forest-lt") +
    pine(30, 55, 0.5, "pine-2") +
    pine(58, 56, 0.55) +
    leafy(68, 57, 0.46) +
    pine(81, 58, 0.62, "pine-2") +
    hill(W, 68, [4, 2, 5], "forest") +
    tuft(30, 80, 1) +
    tuft(64, 74, 1) +
    tuft(80, 86, 1) +
    stump(44, 70, 1.05) +
    logs(64, 84, 0.85) +
    leafy(76, 80, 1.05) +
    pine(14, 84, 1.12),
  // Brick: clay mounds, a kiln with its smoke and a brick stack.
  () =>
    sky(W, 64) +
    cloud(64, 12, 0.7) +
    hill(W, 50, [5, 9, 4], "far-clay") +
    mound(18, 57, 30, 15) +
    mound(70, 55, 28, 13) +
    hill(W, 62, [3, 5, 2], "hills-lt") +
    hill(W, 70, [3, 2, 4], "hills") +
    tuft(18, 74, 1, "grass-dk") +
    tuft(80, 72, 1, "grass-dk") +
    tuft(30, 88, 1, "grass-dk") +
    kiln(42, 72, 1.25) +
    brickStack(15, 86, 1) +
    brickStack(72, 87, 1.15),
  // Wool: a meadow with a fence, a tree and two sheep.
  () =>
    sky(W, 64) +
    sun(18, 14, 5) +
    cloud(62, 14, 0.9) +
    hill(W, 50, [6, 9, 5], "far") +
    leafy(14, 52, 0.42) +
    hill(W, 58, [7, 3, 6], "pasture-lt") +
    fence(48, 64, 0.8, 6) +
    hill(W, 68, [3, 5, 2], "pasture") +
    flower(12, 76, "petal") +
    flower(20, 84, "glint") +
    flower(70, 80, "petal") +
    flower(80, 88, "glint") +
    flower(62, 70, "glint") +
    tuft(8, 86, 1, "grass-dk") +
    sheep(72, 62, 0.85, -1) +
    sheep(30, 77, 1.4, 1),
  // Grain: golden rows, a windmill on the hill and sheaves.
  () =>
    sky(W, 64) +
    sun(18, 16, 5.6) +
    cloud(46, 12, 0.6) +
    birds(30, 30) +
    hill(W, 50, [5, 8, 4], "far") +
    hill(W, 56, [4, 7, 3], "fields-lt") +
    windmill(64, 56, 1.15) +
    hill(W, 64, [3, 4, 2], "fields") +
    path("M-2 72Q30 64 90 70M-2 80Q40 72 90 78M-2 89Q44 80 90 87", "", line("fields-dk", 1.1), op(0.7)) +
    path("M-2 68Q30 61 90 66M-2 76Q40 68 90 74M-2 84Q44 76 90 82", "", line("fields-lt", 1.6), op(0.8)) +
    sheaf(30, 68, 0.75) +
    sheaf(14, 86, 1.1) +
    sheaf(75, 86, 1.05),
  // Ore: snowy peaks, crystals and a mine cart.
  () =>
    sky(W, 64) +
    cloud(16, 14, 0.7) +
    peak(64, 58, 50, 42) +
    peak(28, 62, 56, 50) +
    birds(70, 16) +
    hill(W, 62, [3, 4, 2], "mountains-lt") +
    mine(52, 66, 0.95) +
    hill(W, 70, [2, 4, 3], "alpine") +
    rock(82, 76, 0.8, "rock") +
    tuft(30, 74, 1, "grass-dk") +
    tuft(54, 86, 1, "grass-dk") +
    cart(18, 87, 1.05) +
    crystals(72, 87, 1.35),
];

// ---------- resource glyphs (24 x 24 box, top left at the origin) ----------
const GLYPHS = [
  () =>
    rect(10.3, 16.8, 3.4, 5.4, 0.8, "trunk", ink(1.2)) +
    path("M12 1.6L17.4 8.4H14.8L19.6 14.4H16.8L20.8 18.6H3.2L7.2 14.4H4.4L9.2 8.4H6.6Z", "pine", ink(1.3)) +
    path("M12 2.8L16.3 8.4H14L18.5 14.4H15.9L19.6 18.1H12Z", "pine-dk", "", op(0.45)) +
    path("M10.6 5L8.4 7.8M9.8 10.4L6.8 13.8M8.6 15.6L5.8 17.6", "", line("pine-lt", 1.2)),
  () =>
    [[2.4, 14.6], [12.4, 14.6], [7.4, 8.4]]
      .map(
        ([x, y]) =>
          path(`M${x} ${y}l2 -2h8.4l-2 2Z`, "brick-lt", ink(1.05)) +
          path(`M${x + 8.4} ${y}l2 -2v5.4l-2 2Z`, "brick-dk", ink(1.05)) +
          rect(x, y, 8.4, 5.4, 0, "brick", ink(1.05)) +
          path(`M${x + 1.4} ${y + 1.6}h4`, "", line("brick-lt", 0.9)),
      )
      .join(""),
  () =>
    path("M9.4 17.4v3.8M15 17.4v3.8", "", line("face", 1.9)) +
    blob([[9, 12.6, 4.4], [13.4, 10.2, 4.7], [17.2, 12.8, 4], [12.6, 15, 4]], "wool", 2.2) +
    circle(15.2, 14.6, 2.6, "wool-sh", "", op(0.8)) +
    circle(12, 8.8, 1.6, "glint") +
    ellipse(5.2, 11.2, 2.8, 3.4, "face", ink(1), ' transform="rotate(-16 5.2 11.2)"') +
    ellipse(7.4, 8.4, 1.6, 0.8, "face", "", ' transform="rotate(30 7.4 8.4)"') +
    circle(4.4, 10.4, 0.6, "glint"),
  () => {
    let s = path("M12 22.4V5.6", "", ink(2.6)) + path("M12 22.4V5.6", "", line("wheat-dk", 1.2));
    s += path("M12 20Q16.6 17.6 18.4 13.4Q14 15.4 12 18.6Z", "wheat-dk", ink(0.9));
    s += ellipse(12, 4.4, 2.1, 3.3, "wheat", ink(1.05));
    for (const y of [8.4, 11.8, 15.2]) {
      s += ellipse(9.5, y, 2, 3.2, "wheat", ink(1.05), ` transform="rotate(-34 9.5 ${y})"`);
      s += ellipse(14.5, y, 2, 3.2, "wheat", ink(1.05), ` transform="rotate(34 14.5 ${y})"`);
    }
    return s + path("M11.2 3.2Q11.4 2.4 12 2.2M8.8 7.4Q9 6.6 9.6 6.4M8.8 10.8Q9 10 9.6 9.8", "", line("wheat-lt", 0.9));
  },
  () =>
    path("M8.4 3.6H15.6L21 9.4L12 21.2L3 9.4Z", "rock", ink(1.3)) +
    path("M3 9.4L8.4 3.6L9.4 9.4L12 21.2Z", "rock-lt") +
    path("M15.6 3.6L21 9.4H14.6Z", "rock-lt", "", op(0.6)) +
    path("M14.6 9.4L21 9.4L12 21.2Z", "rock-dk") +
    path("M3 9.4H21M9.4 9.4L8.4 3.6M14.6 9.4L15.6 3.6M9.4 9.4L12 21.2L14.6 9.4", "", ink(0.9)) +
    path("M8.4 3.6H15.6L21 9.4L12 21.2L3 9.4Z", "", ink(1.3)) +
    path("M10.6 5.6l1.4 1.8l1.4-1.8Z", "gem-lt") +
    sparkle(19, 3.4, 2.4),
];

export function resourceGlyph(r) {
  return `<g class="hx-glyph hx-glyph-${RES_KEYS[r]}">${GLYPHS[r]()}</g>`;
}

// ---------- development card art (88 x 76) ----------
function shieldAndSword(s = 1) {
  const blade = `M${pt(13 * s, -24 * s)}L${pt(-11 * s, 19 * s)}`;
  const guard = `M${pt(-15 * s, 11 * s)}L${pt(-4 * s, 17.4 * s)}`;
  let o = path(blade, "", ink(5 * s)) + path(blade, "", line("steel", 2.8 * s)) + path(`M${pt(12.6 * s, -22.6 * s)}L${pt(2 * s, -3.6 * s)}`, "", line("glint", 0.8 * s), op(0.8));
  o += path(`M${pt(-11 * s, 19 * s)}L${pt(-14 * s, 24.6 * s)}`, "", ink(4 * s)) + path(`M${pt(-11 * s, 19 * s)}L${pt(-14 * s, 24.6 * s)}`, "", line("handle", 2.2 * s));
  o += path(guard, "", ink(4.4 * s)) + path(guard, "", line("gold", 2.4 * s));
  o += circle(-14.6 * s, 25.6 * s, 2.2 * s, "gold", ink(1.1));
  const outline = `M${pt(-15 * s, -16 * s)}H${n(15 * s)}V${n(-2 * s)}C${pt(15 * s, 11 * s)} ${pt(0, 19 * s)} ${pt(0, 19 * s)}C${pt(0, 19 * s)} ${pt(-15 * s, 11 * s)} ${pt(-15 * s, -2 * s)}Z`;
  o += path(outline, "paper", ink(1.8));
  o += path(`M0 ${n(-16 * s)}V${n(19 * s)}C${pt(0, 19 * s)} ${pt(15 * s, 11 * s)} ${pt(15 * s, -2 * s)}V${n(-16 * s)}Z`, "coral");
  o += path(outline, "", ink(1.8));
  o += path(`M${pt(-11.6 * s, -12.4 * s)}V${n(-2 * s)}Q${pt(-11.4 * s, 6 * s)} ${pt(-5 * s, 11.6 * s)}`, "", line("glint", 1.3 * s), op(0.7));
  o += path(hexPath(0, 0, 6.6 * s), "gold", ink(1.2));
  o += path(hexPath(0, 0, 3.2 * s), "gold-lt");
  return o;
}
function crown(s = 1) {
  let o = path(`M${pt(-16 * s, 5 * s)}L${pt(-18.5 * s, -11 * s)}L${pt(-8.4 * s, -2.6 * s)}L${pt(0, -16 * s)}L${pt(8.4 * s, -2.6 * s)}L${pt(18.5 * s, -11 * s)}L${pt(16 * s, 5 * s)}Z`, "gold", ink(1.6));
  o += path(`M${pt(0, -11.6 * s)}L${pt(5.6 * s, -1.6 * s)}L${pt(14.6 * s, -7.2 * s)}L${pt(13 * s, 5 * s)}H0Z`, "gold-dk", "", op(0.35));
  o += path(`M${pt(-14.6 * s, -5.6 * s)}L${pt(-13.4 * s, 2 * s)}M${pt(-3 * s, -9 * s)}L${pt(-6.2 * s, -3.2 * s)}`, "", line("gold-lt", 1.4 * s));
  o += rect(-17 * s, 3 * s, 34 * s, 7.6 * s, 2 * s, "gold", ink(1.6));
  o += path(`M${pt(-15 * s, 5.2 * s)}H${n(10 * s)}`, "", line("gold-lt", 1.3 * s));
  o += circle(-18.5 * s, -11 * s, 2.5 * s, "gold-lt", ink(1.2)) + circle(18.5 * s, -11 * s, 2.5 * s, "gold-lt", ink(1.2)) + circle(0, -16.6 * s, 2.7 * s, "gold-lt", ink(1.2));
  o += path(hexPath(0, 6.8 * s, 2.8 * s), "gem", ink(1)) + circle(-9.6 * s, 6.8 * s, 2 * s, "coral", ink(1)) + circle(9.6 * s, 6.8 * s, 2 * s, "coral", ink(1));
  return o;
}
function cushion(s = 1) {
  const d = `M${pt(-24 * s, 0)}Q${pt(-24 * s, -6 * s)} ${pt(-16 * s, -6 * s)}H${n(16 * s)}Q${pt(24 * s, -6 * s)} ${pt(24 * s, 0)}Q${pt(24 * s, 7 * s)} ${pt(16 * s, 7 * s)}H${n(-16 * s)}Q${pt(-24 * s, 7 * s)} ${pt(-24 * s, 0)}Z`;
  let o = shadow(0, 8 * s, 24 * s, 0.25) + path(d, "coral", ink(1.5));
  o += path(`M${pt(-18 * s, -3 * s)}H${n(14 * s)}`, "", line("coral-lt", 1.6 * s), op(0.8));
  for (const side of [-1, 1]) {
    const x = side * 24 * s;
    o += path(`M${pt(x, 1 * s)}l${n(side * 2 * s)} ${n(5 * s)}l${n(-side * 3 * s)} 0Z`, "gold", ink(1));
  }
  return o;
}
function signpost(s = 1) {
  let o = shadow(0.5 * s, 22 * s, 9 * s, 0.25);
  o += rect(-2 * s, -20 * s, 4 * s, 42 * s, 1 * s, "trunk", ink(1.4));
  o += path(`M${pt(-13 * s, -18 * s)}H${n(10 * s)}L${pt(15.6 * s, -12.6 * s)}L${pt(10 * s, -7.2 * s)}H${n(-13 * s)}Z`, "sign", ink(1.4));
  o += path(`M${pt(13 * s, -4 * s)}H${n(-10 * s)}L${pt(-15.6 * s, 1.4 * s)}L${pt(-10 * s, 6.8 * s)}H${n(13 * s)}Z`, "sign", ink(1.4));
  o += path(`M${pt(-10 * s, -15.6 * s)}H${n(8 * s)}M${pt(-8 * s, -1.6 * s)}H${n(10 * s)}`, "", line("sign-lt", 1.3 * s), op(0.9));
  o += circle(0, -12.6 * s, 0.9 * s, "ink") + circle(0, 1.4 * s, 0.9 * s, "ink");
  return o;
}
// A settlement in the first seat's colour, as on the board.
function house() {
  return (
    shadow(3, 8, 14, 0.25) +
    path("M9 8L15 4L15 -8L9 -4Z", "coral-dk", ink(1.6)) +
    path("M0 -14L6 -18L15 -8L9 -4Z", "coral-lt", ink(1.6)) +
    path("M-9 8L9 8L9 -4L0 -14L-9 -4Z", "coral", ink(1.6)) +
    path("M-2.6 8V2.5a2.6 2.6 0 0 1 5.2 0V8Z", "coral-dk")
  );
}
function horn(s = 1) {
  let o = "";
  const body = `M${pt(10 * s, -12 * s)}C${pt(-2 * s, -12 * s)} ${pt(-11 * s, -6 * s)} ${pt(-17 * s, -15 * s)}C${pt(-21 * s, -7 * s)} ${pt(-15 * s, 4 * s)} ${pt(-4 * s, 8.6 * s)}C${pt(1 * s, 10.4 * s)} ${pt(6 * s, 10.6 * s)} ${pt(10 * s, 10 * s)}Z`;
  o += path(body, "wicker", ink(1.5));
  o += path(`M${pt(-1 * s, -11 * s)}Q${pt(-5 * s, -1 * s)} ${pt(-2 * s, 9.6 * s)}M${pt(-8.4 * s, -10 * s)}Q${pt(-12 * s, -2 * s)} ${pt(-9 * s, 6 * s)}M${pt(-14 * s, -12 * s)}Q${pt(-16.4 * s, -6 * s)} ${pt(-14 * s, 1 * s)}`, "", line("wicker-dk", 1.4 * s));
  o += path(`M${pt(-17 * s, -15 * s)}q${n(-2 * s)} ${n(-4.4 * s)} ${n(2 * s)} ${n(-4.4 * s)}`, "", ink(2.6 * s)) + path(`M${pt(-17 * s, -15 * s)}q${n(-2 * s)} ${n(-4.4 * s)} ${n(2 * s)} ${n(-4.4 * s)}`, "", line("wicker", 1.2 * s));
  o += path(`M${pt(-15 * s, -10 * s)}Q${pt(-10 * s, -5 * s)} ${pt(2 * s, -9 * s)}`, "", line("wicker-lt", 1.3 * s), op(0.8));
  // its mouth, and what spills out: grain, wool, a brick and ore
  o += ellipse(10 * s, -1 * s, 5.4 * s, 11 * s, "wicker-dk", ink(1.5));
  o += ellipse(11 * s, -1 * s, 3 * s, 8 * s, "hole", "", op(0.5));
  o += group(`translate(${pt(15 * s, -12 * s)}) rotate(32) scale(${n(0.75 * s)}) translate(-12 -12)`, GLYPHS[3]());
  o += blob([[15 * s, -2 * s, 4 * s], [19 * s, -4 * s, 3.4 * s], [19.6 * s, 0.4 * s, 3.2 * s]], "wool", 2);
  o += circle(16 * s, -4 * s, 1.4 * s, "glint");
  o += group(`translate(${pt(19 * s, 8 * s)}) rotate(-8) scale(${n(0.62 * s)}) translate(-12 -12)`, GLYPHS[1]());
  o += group(`translate(${pt(29 * s, 12 * s)}) rotate(14) scale(${n(0.56 * s)}) translate(-12 -12)`, GLYPHS[4]());
  return o;
}
function magnet(s = 1) {
  const u = `M${pt(-10 * s, 10 * s)}V${n(-4 * s)}A${n(10 * s)} ${n(10 * s)} 0 0 1 ${pt(10 * s, -4 * s)}V${n(10 * s)}`;
  let o = path(u, "", ink(11.6 * s)) + path(u, "", line("coral", 8.4 * s));
  o += path(`M${pt(-12.4 * s, -4 * s)}A${n(12.4 * s)} ${n(12.4 * s)} 0 0 1 ${pt(-2 * s, -16.2 * s)}`, "", line("coral-lt", 1.6 * s), op(0.85));
  for (const x of [-10, 10]) o += rect((x - 5.6) * s, 6 * s, 11.2 * s, 7.6 * s, 0.6 * s, "steel", ink(1.5));
  o += path(`M${pt(-14 * s, 8.2 * s)}h${n(6 * s)}M${pt(6 * s, 8.2 * s)}h${n(6 * s)}`, "", line("glint", 1.1 * s), op(0.9));
  return o;
}
// A tiny resource card flying in to the magnet.
const miniCard = (x, y, r, rot, s = 1) =>
  group(
    `translate(${pt(x, y)}) rotate(${rot}) scale(${n(s)})`,
    rect(-6, -8.4, 12, 16.8, 2, "paper", ink(1.2)) + rect(-4.2, -6.6, 8.4, 9, 1.2, FIELDS[r]) + group("translate(-4.2 -6.4) scale(.35)", GLYPHS[r]()),
  );
const swoosh = (d) => path(d, "", line("paper", 1.4), op(0.75));

const devBackdrop = (kind) => haze(W, 76, `${DEV_FIELD[kind]}-sky`, "glint", 0.07);
const rays = (cx, cy) => {
  let d = "";
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const b = a + Math.PI / 24;
    d += `M${pt(cx, cy)}L${pt(cx + 80 * Math.cos(a), cy + 80 * Math.sin(a))}L${pt(cx + 80 * Math.cos(b), cy + 80 * Math.sin(b))}Z`;
  }
  return path(d, "glint", "", op(0.16));
};
const DEV_SCENES = {
  knight: () =>
    devBackdrop("knight") +
    rays(44, 36) +
    path("M-2 60H8V52H12V56H16V52H20V60H30V46H34V50H38V46H42V50H46V46H50V60H60V52H64V56H68V52H72V60H90V80H-2Z", "knight-wall") +
    sparkle(14, 16, 3) +
    sparkle(74, 22, 2.4) +
    group("translate(44 36) scale(1.05)", shieldAndSword()),
  vp: () =>
    devBackdrop("vp") +
    rays(44, 34) +
    sparkle(14, 18, 3) +
    sparkle(76, 14, 2.6) +
    sparkle(72, 50, 2) +
    group("translate(44 54)", cushion(1.05)) +
    group("translate(44 33) scale(1.05)", crown()),
  road: () =>
    sky(W, 52) +
    cloud(66, 14, 0.7) +
    hill(W, 44, [5, 8, 4], "far") +
    hill(W, 52, [4, 3, 6], "pasture-lt") +
    path("M60 48Q50 52 56 56Q70 62 50 68Q30 74 36 80H58Q50 74 64 70Q84 62 66 56Q60 52 64 48Z", "path", ink(1.2)) +
    path("M59 52Q56 55 62 58M58 64Q52 67 48 70M49 76Q46 78 47 80", "", line("path-dk", 1.2), op(0.8)) +
    tuft(80, 64, 1, "grass-dk") +
    tuft(8, 70, 1, "grass-dk") +
    flower(14, 62, "petal") +
    flower(78, 74, "glint") +
    group("translate(64 47) scale(.42)", house()) +
    group("translate(26 44) scale(.95)", signpost()),
  plenty: () =>
    devBackdrop("plenty") +
    rays(44, 38) +
    sparkle(16, 16, 3) +
    sparkle(72, 14, 2.4) +
    sparkle(76, 58, 2) +
    shadow(44, 60, 24, 0.25) +
    group("translate(40 40) scale(1.25)", horn()),
  monopoly: () =>
    devBackdrop("monopoly") +
    rays(44, 18) +
    group("translate(44 24) scale(1.1)", magnet()) +
    swoosh("M22 44q4 -6 10 -8M66 44q-4 -6 -10 -8M44 58v-10") +
    miniCard(20, 54, 0, -18, 1.05) +
    miniCard(44, 64, 3, 4, 1.05) +
    miniCard(68, 54, 2, 16, 1.05) +
    sparkle(10, 16, 2.4) +
    sparkle(78, 30, 2.2),
};
const DEV_ICONS = {
  knight: () => shieldAndSword(0.98),
  vp: () => crown(1.05),
  road: () => signpost(0.9),
  plenty: () => group("translate(-4 2) scale(.76)", horn()),
  monopoly: () => group("translate(0 -4)", magnet(1.05)),
};

// ---------- the card ----------
const FRAME = roundedRect(0.75, 0.75, 98.5, 138.5, 8);
const frame = (fill = "paper") => path(FRAME, fill, line("edge", 1.5));
// A rounded window onto a scene drawn in its own w x h space.
function framed(x, y, w, h, scene, rim) {
  const mat = `M${x - 1} ${y - 1}h${w + 2}v${h + 2}h${-w - 2}Z` + roundedRect(x, y, w, h, 6);
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${scene}</svg>` + path(mat, "paper", "", ' fill-rule="evenodd"') + path(roundedRect(x, y, w, h, 6), "", line(rim, 1.4));
}
// The small layout: the card's colour and a big emblem on a disc.
function miniFace(field, emblem) {
  return (
    `<g class="hx-mini-face">` +
    path(roundedRect(5, 5, 90, 130, 6), field) +
    path(hexPath(50, 70, 56), `${field}-lt`, "", op(0.45)) +
    circle(50, 70, 41, "paper", ink(2)) +
    circle(50, 70, 36, "", line(`${field}-dk`, 2.6)) +
    emblem +
    `</g>`
  );
}
const card = (cls, label, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="hx-card ${cls}" viewBox="0 0 100 140" role="img" aria-label="${label}">${inner}</svg>`;

export function resourceCard(r) {
  const field = FIELDS[r];
  const full =
    `<g class="hx-full-face">` +
    framed(6, 6, 88, 90, SCENES[r](), `${field}-dk`) +
    circle(50, 96, 14.5, "paper", ink(1.5)) +
    circle(50, 96, 12, "", line(`${field}-dk`, 1.8)) +
    group("translate(38 84)", resourceGlyph(r)) +
    text(50, 127, 15, "hx-card-name", RESOURCE_TITLES[r]) +
    `</g>`;
  return card(`hx-card-res hx-res-${RES_KEYS[r]}`, RESOURCE_TITLES[r], frame() + full + miniFace(field, group("translate(17 37) scale(2.75)", resourceGlyph(r))));
}

export function devCard(kind) {
  const { title, effect } = DEV_TEXT[kind];
  const field = DEV_FIELD[kind] === "prog" ? "prog" : kind;
  const fit = title.length > 11 ? ' textLength="84" lengthAdjust="spacingAndGlyphs"' : "";
  const full =
    `<g class="hx-full-face">` +
    framed(6, 6, 88, 76, DEV_SCENES[kind](), `${field}-dk`) +
    text(50, 99, 13, "hx-card-name", title, fit) +
    effect.map((s, i) => text(50, 113 + i * 10.5, 8.4, "hx-card-effect", s)).join("") +
    `</g>`;
  return card(`hx-card-dev hx-dev-${kind}`, `${title}: ${effect.join(" ")}`, frame() + full + miniFace(field, group("translate(50 70) scale(1.25)", DEV_ICONS[kind]())));
}

export function cardBack() {
  let lattice = "";
  for (let row = -1; row < 10; row++) for (let col = -1; col < 6; col++) lattice += hexPath(col * 19 + (row % 2 ? 9.5 : 0), row * 16.5, 10.4);
  const emblem =
    path(hexPath(50, 70, 27), "back-dk", "", op(0.5)) +
    path(hexPath(50, 70, 24), "paper", ink(1.6)) +
    path(hexPath(50, 61.2, 9.2), "forest", ink(1.2)) +
    path(hexPath(42.4, 74.4, 9.2), "fields", ink(1.2)) +
    path(hexPath(57.6, 74.4, 9.2), "hills", ink(1.2)) +
    group("translate(50 64.4) scale(.42) translate(-12 -12)", GLYPHS[0]()) +
    group("translate(42.4 77.6) scale(.42) translate(-12 -12)", GLYPHS[3]()) +
    group("translate(57.6 77.6) scale(.42) translate(-12 -12)", GLYPHS[1]());
  const inner =
    path(FRAME, "back", line("edge", 1.5)) +
    `<svg x="7" y="7" width="86" height="126" viewBox="7 7 86 126">${path(lattice, "", line("back-ln", 1.3), op(0.3))}</svg>` +
    path(roundedRect(6, 6, 88, 128, 6), "", line("back-ln", 1.5)) +
    path(roundedRect(9.5, 9.5, 81, 121, 4), "", line("back-ln", 0.8), op(0.6)) +
    emblem;
  return card("hx-card-back", "A face-down card", inner);
}
