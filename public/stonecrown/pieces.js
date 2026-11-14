// Stonecrown's table pieces as SVG markup strings (no DOM), in the Paper
// Lantern style: layered cut paper with soft offset shadows and no outlines.
// A wonder board is a landscape of the wonder and its city that grows a stage
// at a time (scaffolding on the next stage, a dashed ghost of the rest), with
// the stages row below: each stage's cost and effect, built stages in gold
// and the cards tucked under them peeking out. wonderMini is the same scene
// for a neighbour's panel, with a lantern a stage. Then coins, military
// tokens and the table. Colours are classes (sc-pf-* fills, sc-ps-* strokes)
// that pieces.css maps to --sc-p-* tokens for light and dark; parts that only
// show at night (stars, glows, the moon's shadow) sit in .sc-night. There are
// no ids or url() references, so a piece can show any number of times on a
// page; a scene is clipped by a nested <svg>.
import { WONDERS, RESOURCES } from "./cards.js";
import { resourceIcon, scienceIcon, shieldIcon, pointsIcon } from "./card-art.js";

// ---------- geometry ----------
const n = (v) => String(Math.round(v * 100) / 100);
const pt = (x, y) => `${n(x)} ${n(y)}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
const R0 = (x, y, w, h) => `M${pt(x, y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
const rr = (x, y, w, h, r) =>
  `M${pt(x + r, y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${pt(x + w, y + r)}V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${pt(x + w - r, y + h)}H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${pt(x, y + h - r)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${pt(x + r, y)}Z`;
const dot = (x, y, r) => `M${pt(x - r, y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
const poly = (pts) => "M" + pts.map(([x, y]) => pt(x, y)).join("L") + "Z";
const star = (cx, cy, ro, ri, k, rot = -Math.PI / 2) =>
  poly(Array.from({ length: 2 * k }, (_, i) => { const r = i % 2 ? ri : ro, a = rot + (Math.PI * i) / k; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }));
const hill = (x0, x1, y, bumps, yb) => {
  const step = (x1 - x0) / bumps.length;
  return `M${pt(x0, y)}` + bumps.map((b, i) => `Q${pt(x0 + step * (i + 0.5), y - b)} ${pt(x0 + step * (i + 1), y)}`).join("") + `V${n(yb)}H${n(x0)}Z`;
};
// A path written with absolute M, L, Q, C and Z only, every point moved by f.
const mapD = (d, f) =>
  d.replace(/([MLQCZ])([^MLQCZ]*)/g, (_, c, a) => {
    const v = (a.match(/-?\d*\.?\d+/g) || []).map(Number);
    const out = [];
    for (let i = 0; i + 1 < v.length; i += 2) out.push(pt(...f(v[i], v[i + 1])));
    return c + out.join(" ");
  });
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ROMAN = ["I", "II", "III", "IV"];

// ---------- paint ----------
const fillEl = (d, f, extra = "") => (d ? `<path d="${d}" class="sc-pf-${f}"${extra}/>` : "");
const strokeEl = (d, s, w, extra = "") => (d ? `<path d="${d}" class="sc-ps-${s}" stroke-width="${n(w)}"${extra}/>` : "");
const circleEl = (x, y, r, f, extra = "") => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" class="sc-pf-${f}"${extra}/>`;
const textEl = (x, y, size, f, s, extra = "") =>
  `<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}" text-anchor="middle" class="sc-p-text sc-pf-${f}"${extra}>${esc(s)}</text>`;
const night = (inner) => (inner ? `<g class="sc-night">${inner}</g>` : "");
// Paper shadow: offset copies of the silhouette, darker close in.
const SHADOW = [[0.5, 2.6, 0.08], [0.3, 1.5, 0.12], [0, 0.7, 0.18]];
const shadowOf = (d, k = 1, o = 1) =>
  d ? `<g class="sc-pf-shadow">` + SHADOW.map(([x, y, a]) => `<path d="${d}" transform="translate(${n(x * k)} ${n(y * k)})" opacity="${n(a * o)}"/>`).join("") + "</g>" : "";

// An icon from card-art.js (markup in a 20-unit box centred on 0,0, or a whole <svg>) centred at x, y.
function place(markup, x, y, size) {
  if (/^\s*<svg/.test(markup))
    return `<g class="sc-p-icon">` + markup.replace(/^\s*<svg\b([^>]*)>/, (_, a) => `<svg${a.replace(/\s(?:x|y|width|height)="[^"]*"/g, "")} x="${n(x - size / 2)}" y="${n(y - size / 2)}" width="${n(size)}" height="${n(size)}">`) + "</g>";
  return `<g class="sc-p-icon" transform="translate(${pt(x, y)}) scale(${n(size / 20)})">${markup}</g>`;
}

// ---------- scenes ----------
// A scene is 400 x 150 units: layers drawn back to front, each a list of
// [role, d]. Roles name a paint; the palette roles take a tone of the
// wonder's own ramp (0 the sky, 4 the deepest). A layer above the sky casts a
// paper shadow from its silhouettes; flat details (shades, trims, windows)
// don't. Neighbouring parts of one role are drawn as one path.
const SW = 400, SH = 150;
const RAMP = { sky: 0, far: 1, water: 2, mid: 2, near: 3, tree: 3, deep: 4 };
const FLAT = new Set(["cella", "stone-dk", "stone-line", "shade", "trim", "win", "inner", "bronze-lt", "bronze-dk", "gold-dk", "leaf-dk", "fire", "lantern", "sun"]);

function paintLayers(layers, key) {
  let out = "";
  for (const L of layers) {
    const parts = [];
    for (const [r, d] of L.items) {
      if (!d) continue;
      const last = parts[parts.length - 1];
      if (last && last[0] === r && r !== "raw") last[1] += d;
      else parts.push([r, d]);
    }
    let sil = "", body = "", glow = "";
    for (const [r, d] of parts) {
      if (r in RAMP) { body += fillEl(d, `${key}-${RAMP[r]}`); if (r !== "sky") sil += d; }
      else if (r === "raw") body += d;
      else if (r === "cloud") body += `<path d="${d}" class="sc-pf-cloud sc-cloud"/>`;
      else if (r === "stars") glow += fillEl(d, "lamp", ' opacity=".75"');
      else if (r === "ghost") body += strokeEl(d, "ghost", 1.1, ' fill="none" stroke-dasharray="3 2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".55"');
      else if (r === "scaffold") body += strokeEl(d, "scaffold", 1.1, ' fill="none" stroke-linecap="round"');
      else if (r === "rope") body += strokeEl(d, "scaffold", 0.7, ' fill="none"');
      else if (r === "string") body += strokeEl(d, "string", 0.6, ' fill="none"');
      else if (r === "wave") body += strokeEl(d, "wave", 1.2, ' fill="none" stroke-linecap="round"');
      else if (r === "win" || r === "lantern") { body += fillEl(d, r); glow += strokeEl(d, "lamp", r === "win" ? 2.2 : 3.6, ' fill="none" stroke-linejoin="round" opacity=".45"'); }
      else if (r === "inner") { body += fillEl(d, "inner"); glow += strokeEl(d, "lamp", 5, ' fill="none" stroke-linejoin="round" opacity=".25"'); }
      else if (r === "statue") { body += fillEl(d, "gold"); glow += strokeEl(d, "lamp", 4, ' fill="none" stroke-linejoin="round" opacity=".5"'); }
      else if (r === "fire") body += strokeEl(d, "lamp", 5, ' fill="none" stroke-linejoin="round" opacity=".4"') + fillEl(d, "fire");
      else { body += fillEl(d, r); if (!FLAT.has(r)) sil += d; }
    }
    out += (L.z > 0 ? shadowOf(sil, L.k ?? 1) : "") + body + night(glow);
  }
  return out;
}

const SKY = `M0 ${SH + 2}V16A16 16 0 0 1 16 0H384A16 16 0 0 1 400 16V${SH + 2}Z`;
const puff = (x, y, k) => dot(x, y, 4 * k) + dot(x + 7 * k, y - 3 * k, 5.5 * k) + dot(x + 14 * k, y, 4 * k) + R0(x, y, 14 * k, 4 * k);

// The sky: sun by day and a crescent moon with stars by night, and clouds.
function skyLayer(key, { sun: [sx, sy, sr], clouds = [], seed = 1 }) {
  const g = rng(seed);
  let stars = "";
  for (let i = 0; i < 26; i++) {
    const x = 8 + g() * 384, y = 6 + g() * 84, r = 1 + g() * 1.3;
    if (Math.hypot(x - sx, y - sy) > sr + 8) stars += star(x, y, r, r * 0.38, 4);
  }
  const moon = strokeEl(dot(sx, sy, sr + 4), "lamp", 6, ' fill="none" opacity=".12"') + circleEl(sx + sr * 0.42, sy - sr * 0.3, sr * 0.82, `${key}-0`);
  return {
    z: 0,
    items: [["sky", SKY], ["sun", dot(sx, sy, sr)], ["raw", night(moon)], ["cloud", clouds.map(([x, y, k]) => puff(x, y, k)).join("")], ["stars", stars]],
  };
}

// Little flat-roofed houses: [x, base, w, h, roof] (0 flat, 1 dome, 2 gable).
function town(list) {
  let body = "", shade = "", trim = "", roof = "", win = "";
  for (const [x, yb, w, h, kind] of list) {
    const yt = yb - h;
    body += R0(x, yt, w, h);
    shade += R0(x + w * 0.68, yt, w * 0.32, h);
    if (kind === 0) trim += R0(x - 0.8, yt - 1.6, w + 1.6, 1.8);
    else if (kind === 1) roof += `M${pt(x + w * 0.14, yt)}A${n(w * 0.36)} ${n(w * 0.36)} 0 0 1 ${pt(x + w * 0.86, yt)}Z`;
    else roof += poly([[x - 1.5, yt], [x + w / 2, yt - w * 0.42], [x + w + 1.5, yt]]);
    const cols = Math.max(1, Math.floor(w / 7));
    for (let i = 0; i < cols; i++) win += R0(x + (w / cols) * (i + 0.5) - 1.3, yt + h * 0.22, 2.6, 3.2);
    if (h >= 13) win += `M${pt(x + w * 0.2, yb)}v-4.4a1.7 1.7 0 0 1 3.4 0v4.4Z`;
  }
  return [["cream", body], ["shade", shade], ["trim", trim], ["near", roof], ["win", win]];
}
const cypress = (x, y, s) => `M${pt(x, y - 22 * s)}C${pt(x + 5 * s, y - 14 * s)} ${pt(x + 5 * s, y - 3 * s)} ${pt(x, y)}C${pt(x - 5 * s, y - 3 * s)} ${pt(x - 5 * s, y - 14 * s)} ${pt(x, y - 22 * s)}Z`;
const olive = (x, y, s) => R0(x - 0.9 * s, y - 7 * s, 1.8 * s, 7 * s) + dot(x - 4 * s, y - 9 * s, 4 * s) + dot(x + 3.5 * s, y - 10 * s, 4.4 * s) + dot(x, y - 13 * s, 4.6 * s);
function palm(x, y, u) {
  let d = `M${pt(x - 0.9 * u, y)}Q${pt(x - 2 * u, y - 8 * u)} ${pt(x + 1 * u, y - 16 * u)}L${pt(x + 2.4 * u, y - 15.6 * u)}Q${pt(x, y - 8 * u)} ${pt(x + 0.9 * u, y)}Z`;
  const tx = x + 1.6 * u, ty = y - 16 * u;
  for (const [dx, dy] of [[-8, 2], [-6, -3], [0, -6], [6, -3], [8, 2]])
    d += `M${pt(tx, ty)}Q${pt(tx + dx * u * 0.6, ty + (dy - 3) * u)} ${pt(tx + dx * u, ty + dy * u)}Q${pt(tx + dx * u * 0.5, ty + (dy - 1) * u)} ${pt(tx, ty)}Z`;
  return d;
}
const boat = (x, y, s) => [
  ["deep", `M${pt(x - 10 * s, y)}L${pt(x + 10 * s, y)}L${pt(x + 7 * s, y + 4 * s)}L${pt(x - 7 * s, y + 4 * s)}Z` + R0(x - 0.5 * s, y - 15 * s, 1 * s, 15 * s)],
  ["cream", `M${pt(x + 1 * s, y - 14 * s)}Q${pt(x + 9 * s, y - 8 * s)} ${pt(x + 8 * s, y - 2 * s)}L${pt(x + 1 * s, y - 2 * s)}Z`],
];
const waves = (list) => list.map(([x, y, w]) => `M${pt(x, y)}q${n(w / 4)} ${n(-w / 6)} ${n(w / 2)} 0t${n(w / 2)} 0`).join("");

// Scaffolding round a stage's box with a crane beside it.
function scaffold([x0, y0, x1, y1], ground, side) {
  const xs = [x0 - 3, x1 + 3];
  if (x1 - x0 > 60) xs.splice(1, 0, (x0 + x1) / 2);
  const top = y0 - 2, rows = Math.max(2, Math.round((y1 - top) / 11)), yAt = (i) => y1 - ((y1 - top) * i) / rows;
  let d = xs.map((x) => `M${pt(x, y1)}V${n(top - 3)}`).join("");
  for (let i = 1; i <= rows; i++) d += `M${pt(xs[0] - 2, yAt(i))}H${n(xs[xs.length - 1] + 2)}`;
  for (let j = 0; j < xs.length - 1; j++)
    for (let i = 0; i < rows; i++) d += (i + j) % 2 ? `M${pt(xs[j], yAt(i))}L${pt(xs[j + 1], yAt(i + 1))}` : `M${pt(xs[j + 1], yAt(i))}L${pt(xs[j], yAt(i + 1))}`;
  if (!side) return [["scaffold", d]];
  const dir = side === "left" ? 1 : -1, mx = side === "left" ? x0 - 15 : x1 + 15, jy = Math.max(8, top - 13);
  const tip = mx + dir * Math.min(40, (x1 - x0) * 0.75 + 15), back = mx - dir * 9, hook = tip - dir * 5;
  d += `M${pt(mx, ground)}V${n(jy - 5)}M${pt(back, jy)}H${n(tip)}M${pt(mx, jy - 5)}L${pt(tip, jy)}M${pt(mx, jy - 5)}L${pt(back, jy)}`;
  for (let y = ground - 8; y > jy + 2; y -= 8) d += `M${pt(mx - 2, y)}L${pt(mx + 2, y - 4)}`;
  return [["scaffold", d], ["rope", `M${pt(hook, jy)}V${n(jy + 12)}`], ["deep", R0(hook - 2.5, jy + 12, 5, 3.6) + R0(back - 2, jy, 4, 4.5)]];
}

// Paper lanterns strung along the top of a finished stage: the string's ends and the lanterns between.
function lanterns(pts) {
  if (pts.length < 2) return [];
  let str = `M${pt(...pts[0])}`, lamps = "";
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], sag = Math.min(7, Math.abs(x1 - x0) * 0.18 + 1.5);
    const cx = (x0 + x1) / 2, cy = Math.max(y0, y1) + sag;
    str += `Q${pt(cx, cy)} ${pt(x1, y1)}`;
    const mx = (x0 + 2 * cx + x1) / 4, my = (y0 + 2 * cy + y1) / 4;
    lamps += rr(mx - 1.7, my, 3.4, 4.2, 1.5);
  }
  return [["string", str], ["lantern", lamps]];
}

// A wonder's pieces grouped into its k stages. piece: { parts, ghost, box, lamps }.
function stagesOf(pieces, k) {
  const groups = Array.from({ length: k }, () => ({ parts: [], ghost: "", box: null, lamps: [] }));
  pieces.forEach((p, j) => {
    const g = groups[Math.min(k - 1, Math.floor((j * k) / pieces.length))];
    g.parts.push(...p.parts);
    g.ghost += p.ghost;
    g.box = g.box ? [Math.min(g.box[0], p.box[0]), Math.min(g.box[1], p.box[1]), Math.max(g.box[2], p.box[2]), Math.max(g.box[3], p.box[3])] : p.box;
    g.lamps = p.lamps || g.lamps;
  });
  return groups;
}

// The wonder layer as built: finished stages solid with their lanterns, the
// rest a dashed ghost, scaffolding on the next.
// The crane stands left of the next stage, or right when it would reach
// into the name label (which ends at x = clear), or stays away when the side
// and resource badges are in the way too.
function growth(stages, built, { ground = 124, clear = 0, halo }) {
  const solid = [], over = [];
  stages.forEach((s, i) => {
    if (i < built) { solid.push({ z: 3, items: s.parts }); over.push(...lanterns(s.lamps)); }
    else over.push(["ghost", s.ghost]);
  });
  const next = stages[built];
  if (next && next.box) {
    const [x0, y0, x1] = next.box, high = y0 < 54;
    over.push(...scaffold(next.box, ground, !high || x0 - 20 >= clear ? "left" : x1 < 292 ? "right" : ""));
  }
  const layers = [];
  if (halo && built) {
    const [hx, hy, hr] = halo, r = hr * (0.55 + (0.45 * built) / stages.length);
    layers.push({ z: 0, items: [["raw", night([1, 0.72, 0.48, 0.28].map((f) => circleEl(hx, hy, r * f, "lamp", ' opacity=".1"')).join(""))]] });
  }
  layers.push(...solid, { z: 3, items: over, k: 0.6 });
  return layers;
}

// ---------- the seven wonders ----------
function rhodes(k, built, clear) {
  const key = "rhodes", s = 0.95, f = (x, y) => [263 + (x - 263) * s, 110 + (y - 104) * s], m = (d) => mapD(d, f);
  const ped = "M211 104 L241 104 L241 116 L211 116 Z M285 104 L315 104 L315 116 L285 116 Z";
  const pedShade = "M232 104 L241 104 L241 116 L232 116 Z M306 104 L315 104 L315 116 L306 116 Z";
  const legs = "M219 104 L232 104 L263 82 L294 104 L307 104 L276 64 L250 64 Z";
  const torso = "M250 66 L276 66 L281 44 Q281 39 276 39 L250 39 Q245 39 245 44 Z M246 41 L239 44 L233 68 L239 70 L247 52 Z";
  const drape = "M246 42 L254 41 L276 64 L270 67 Z M232 66 L241 68 L244 89 L234 91 Z";
  const arm = "M275 41 L282 39 L295 13 L288 11 Z M259 42 L267 42 L267 32 L259 32 Z";
  let rays = "";
  for (let i = 0; i < 7; i++) {
    const a = ((-165 + i * 25) * Math.PI) / 180, w = 0.16;
    rays += "M" + [[6.2, a - w], [13.5, a], [6.2, a + w]].map(([r, b]) => `${n(263 + r * Math.cos(b))} ${n(27.5 + r * Math.sin(b))}`).join(" L") + " Z";
  }
  const [hx, hy] = f(263, 27.5), [qx, qy] = f(291.5, 12);
  const pieces = [
    { parts: [["cream", m(ped)], ["shade", m(pedShade)], ["bronze", m(legs)], ["bronze-lt", m("M219 104 L225 104 L253 67 L250 64 Z")], ["bronze-dk", m("M294 104 L307 104 L276 64 L271 70 Z")]],
      ghost: m(ped) + m(legs), box: [...f(211, 64), ...f(315, 116)], lamps: [f(207, 103), f(245, 103), f(281, 103), f(319, 103)] },
    { parts: [["bronze", m(torso)], ["bronze-lt", m("M250 44 L257 44 L255 63 L251 63 Z")], ["bronze-dk", m("M270 66 L276 66 L281 44 Q281 40 278 39.5 Z")], ["bronze-lt", m(drape)]],
      ghost: m(torso), box: [...f(232, 39), ...f(283, 91)], lamps: [] },
    { parts: [["bronze", m(arm) + dot(hx, hy, 7.5 * s) + dot(qx, qy, 3 * s) + m(rays)], ["bronze-lt", m("M276 40 L279 39.5 L291 15 L289 14 Z")], ["bronze-dk", m("M289 12 L294 12 L295.5 2 L290.5 2 Z")], ["fire", m("M293 -6 Q299 0 296 3.5 Q293 6 290 3.5 Q287 0 293 -6 Z")]],
      ghost: m(arm) + dot(hx, hy, 7.5 * s), box: [...f(253, -6), ...f(300, 41)], lamps: [] },
  ];
  return [
    skyLayer(key, { sun: [62, 62, 12], clouds: [[150, 60, 1], [352, 72, 0.8]], seed: 11 }),
    { z: 1, items: [["far", hill(-2, 170, 99, [8, 15, 6], SH + 2) + hill(300, 402, 100, [11, 6], SH + 2)]] },
    { z: 1, items: [["water", R0(-2, 98, 404, 60)], ["wave", waves([[20, 104, 10], [150, 102, 12], [330, 104, 10], [372, 101, 8]])]] },
    { z: 2, items: [["near", `M-2 110Q50 101 128 107L128 ${SH + 2}H-2Z` + `M338 ${SH + 2}V108Q372 101 402 105V${SH + 2}Z`], ["mid", R0(120, 117, 104, 7) + R0(300, 117, 42, 7)], ["trim", R0(120, 116, 104, 1.6) + R0(300, 116, 42, 1.6)]] },
    { z: 2, items: town([[8, 107, 14, 15, 1], [24, 106, 11, 11, 0], [38, 106, 16, 19, 0], [57, 105, 12, 13, 2], [72, 106, 15, 16, 0], [90, 107, 11, 10, 0], [346, 106, 14, 17, 0], [363, 104, 13, 12, 1], [379, 105, 16, 15, 0]]) },
    ...growth(stagesOf(pieces, k), built, { ground: 122, clear, halo: [263, 62, 74] }),
    { z: 4, items: [...boat(263, 131, 0.9), ...boat(170, 131, 0.7)] },
    { z: 4, items: [["water", R0(-2, 134, 404, 22)], ["wave", waves([[40, 138, 12], [210, 139, 10], [300, 137, 12]])]] },
  ];
}

function alexandria(k, built, clear) {
  const key = "alexandria", cx = 272;
  const tiers = [[26, 22, 44], [15.5, 13.8, 28], [10, 9, 16]];
  const pieces = [];
  let y = 122;
  tiers.forEach(([hb, ht, th], i) => {
    const yt = y - th;
    const body = poly([[cx - hb, y], [cx - ht, yt], [cx + ht, yt], [cx + hb, y]]);
    const shade = poly([[cx + hb * 0.32, y], [cx + ht * 0.32, yt], [cx + ht, yt], [cx + hb, y]]);
    const cornice = R0(cx - ht - 2.4, yt - 3, 2 * ht + 4.8, 3);
    let win = "", trim = cornice, gold = "";
    if (i === 0) {
      for (const wy of [yt + 8, yt + 20]) win += R0(cx - 13, wy, 3.6, 5.8) + R0(cx - 5.4, wy, 3.6, 5.8) + R0(cx + 2.2, wy, 3.6, 5.8) + R0(cx + 9.8, wy, 3.6, 5.8);
      win += `M${pt(cx - 3.6, y)}V${n(y - 7)}a3.6 3.6 0 0 1 7.2 0V${n(y)}Z`;
      trim += R0(cx - hb * 0.96, yt + th * 0.62, hb * 1.92 - 0.8, 1.6);
    } else if (i === 1) {
      win += R0(cx - 1.6, yt + 5, 3.2, 7) + R0(cx - 1.6, yt + 16, 3.2, 7);
      trim += poly([[cx - hb * 0.34, y], [cx - ht * 0.34, yt], [cx - ht * 0.34 + 0.9, yt], [cx - hb * 0.34 + 0.9, y]]);
    } else {
      win += R0(cx - 6.6, yt + 3, 3, 9) + R0(cx - 1.5, yt + 3, 3, 9) + R0(cx + 3.6, yt + 3, 3, 9);
      gold += `M${pt(cx - 7.5, yt - 3)}Q${pt(cx, yt - 12)} ${pt(cx + 7.5, yt - 3)}Z`;
    }
    const parts = [["cream", body], ["shade", shade], ["trim", trim], ["win", win]];
    if (gold) parts.push(["gold-dk", gold], ["fire", `M${pt(cx, yt - 21)}Q${pt(cx + 5, yt - 14)} ${pt(cx + 3, yt - 10)}Q${pt(cx, yt - 8)} ${pt(cx - 3, yt - 10)}Q${pt(cx - 5, yt - 14)} ${pt(cx, yt - 21)}Z`]);
    pieces.push({ parts, ghost: body + cornice, box: [cx - hb, yt - 3, cx + hb, y], lamps: [[cx - ht - 3, yt - 1.5], [cx, yt - 0.5], [cx + ht + 3, yt - 1.5]] });
    y = yt - 3;
  });
  // The light, by night: two soft beams from the fire.
  pieces[2].parts.push(["raw", night(fillEl(`M${pt(cx, y - 15)}L${pt(cx - 120, y - 40)}L${pt(cx - 120, y + 8)}Z M${pt(cx, y - 15)}L${pt(cx + 140, y - 44)}L${pt(cx + 140, y + 4)}Z`, "lamp", ' opacity=".14"'))]);
  return [
    skyLayer(key, { sun: [56, 60, 12], clouds: [[150, 54, 1], [356, 76, 0.8]], seed: 23 }),
    { z: 1, items: [["far", hill(-2, 140, 104, [6, 10, 4], SH + 2)]] },
    { z: 1, items: [["water", R0(-2, 104, 404, 60)], ["wave", waves([[24, 112, 10], [140, 118, 12], [350, 112, 10], [380, 122, 8]])]] },
    { z: 2, items: [["near", `M-2 120Q40 111 118 119V${SH + 2}H-2Z`], ...boat(150, 125, 1)] },
    { z: 2, items: town([[6, 118, 14, 16, 0], [22, 117, 12, 12, 1], [36, 116, 15, 18, 0], [54, 116, 11, 11, 2], [68, 117, 16, 14, 0], [87, 118, 12, 10, 0]]) },
    { z: 2, items: [["mid", `M${pt(cx - 46, SH + 2)}C${pt(cx - 40, 132)} ${pt(cx - 28, 121)} ${pt(cx - 14, 121)}H${n(cx + 18)}C${pt(cx + 34, 121)} ${pt(cx + 46, 130)} ${pt(cx + 54, SH + 2)}Z`], ["tree", palm(cx - 33, 128, 1.15) + palm(cx + 36, 129, 0.95)]] },
    ...growth(stagesOf(pieces, k), built, { ground: 122, clear, halo: [cx, 70, 70] }),
    { z: 4, items: [["water", R0(-2, 134, 404, 20)], ["wave", waves([[60, 139, 12], [330, 138, 12]])]] },
  ];
}

function ephesus(k, built, clear) {
  const key = "ephesus", cx = 262;
  const steps = R0(176, 118, 172, 8) + R0(182, 111, 160, 7) + R0(188, 105, 148, 6);
  const stepTop = R0(176, 118, 172, 1.4) + R0(182, 111, 160, 1.4) + R0(188, 105, 148, 1.4);
  let cols = "", colShade = "", caps = "";
  for (let i = 0; i < 8; i++) {
    const x = 195 + i * 18.6;
    cols += R0(x, 70, 7.4, 35);
    colShade += R0(x + 4.6, 70, 2.8, 35);
    caps += R0(x - 1.6, 67, 10.6, 3.2) + R0(x - 1, 102.6, 9.4, 2.4);
  }
  const roof = R0(185, 58, 154, 9) + poly([[182, 58.5], [cx, 38], [342, 58.5]]);
  const pieces = [
    { parts: [["cream", steps], ["trim", stepTop], ["shade", R0(330, 118, 18, 8) + R0(326, 111, 16, 7) + R0(322, 105, 14, 6)]], ghost: steps, box: [176, 105, 348, 126], lamps: [[184, 104], [230, 104.5], [294, 104.5], [340, 104]] },
    { parts: [["inner", R0(198, 72, 128, 33)], ["cream", cols], ["shade", colShade], ["trim", caps]], ghost: R0(193, 67, 138, 38), box: [193, 67, 331, 105], lamps: [] },
    { parts: [["cream", roof], ["shade", poly([[191, 56.5], [cx, 42.5], [333, 56.5]])], ["trim", R0(185, 61, 154, 1.6)], ["win", dot(cx, 51, 3)], ["gold", dot(cx, 36.5, 2.6) + dot(183, 57, 2.2) + dot(341, 57, 2.2)]],
      ghost: roof, box: [182, 38, 342, 67], lamps: [[180, 59], [221, 49], [cx, 38], [303, 49], [344, 59]] },
  ];
  return [
    skyLayer(key, { sun: [118, 64, 12], clouds: [[36, 60, 0.9], [356, 74, 0.9]], seed: 37 }),
    { z: 1, items: [["far", hill(-2, 402, 94, [10, 22, 8, 18, 12], SH + 2)]] },
    { z: 2, items: [["mid", hill(-2, 402, 114, [6, 4, 8, 5], SH + 2)], ["tree", olive(20, 112, 1) + olive(150, 112, 0.9) + olive(370, 112, 1.05) + cypress(166, 114, 0.9) + cypress(358, 114, 0.8)]] },
    { z: 2, items: town([[34, 116, 13, 14, 0], [49, 115, 12, 11, 2], [64, 116, 15, 18, 0], [82, 116, 12, 12, 1], [97, 117, 14, 14, 0], [116, 117, 11, 10, 0]]) },
    ...growth(stagesOf(pieces, k), built, { ground: 126, clear, halo: [cx, 80, 80] }),
    { z: 4, items: [["near", hill(-2, 402, 128, [3, 2, 4, 2], SH + 2)], ["deep", cypress(12, 132, 1.1) + cypress(386, 132, 1.15) + cypress(374, 132, 0.8)]] },
  ];
}

function babylon(k, built, clear) {
  const key = "babylon", cx = 262;
  const terraces = [[148, 26, 124, 7], [116, 24, 98, 5], [84, 22, 74, 3]];
  const pieces = terraces.map(([w, h, yb, arches], i) => {
    const x = cx - w / 2, yt = yb - h;
    const body = R0(x, yt, w, h);
    let win = "", vines = "", bush = "";
    const aw = 6.4, gap = (w - arches * aw) / (arches + 1);
    for (let a = 0; a < arches; a++) { const ax = x + gap + a * (aw + gap); win += `M${pt(ax, yb)}V${n(yb - h * 0.5)}a${n(aw / 2)} ${n(aw / 2)} 0 0 1 ${n(aw)} 0V${n(yb)}Z`; }
    for (let b = 0; b <= 12; b++) bush += dot(x + 2 + (b * (w - 4)) / 12, yt - 1 + (b % 2) * 1.2, 3.4 + (b % 3) * 0.6);
    for (let v = 0; v < Math.round(w / 14); v++) { const vx = x + 5 + v * 14 + (v % 2) * 3; vines += rr(vx, yt, 2.6, 6 + ((v * 5) % 7), 1.3); }
    const parts = [["cream", body], ["shade", R0(x + w * 0.74, yt, w * 0.26, h)], ["trim", R0(x - 1.5, yt, w + 3, 2.4)], ["win", win], ["leaf", bush], ["leaf-dk", vines]];
    if (i === 2) parts.push(["leaf", palm(cx - 20, yt - 1, 1.1) + palm(cx + 22, yt - 1, 0.9) + palm(cx + 2, yt - 2, 1.3)]);
    return { parts, ghost: body, box: [x, i === 2 ? yt - 22 : yt - 4, x + w, yb], lamps: [[x - 1, yt + 2], [cx, yt + 3], [x + w + 1, yt + 2]] };
  });
  return [
    skyLayer(key, { sun: [104, 60, 13], clouds: [[24, 64, 0.8], [350, 70, 1]], seed: 41 }),
    { z: 1, items: [["far", hill(-2, 402, 106, [4, 8, 3, 6, 4], SH + 2) + poly([[66, 107], [66, 96], [72, 96], [72, 88], [80, 88], [80, 80], [88, 80], [88, 88], [96, 88], [96, 96], [102, 96], [102, 107]])]] },
    { z: 2, items: [["mid", `M-2 116H170V${SH + 2}H-2Z` + `M340 ${SH + 2}V114H402V${SH + 2}Z`], ["tree", palm(150, 118, 1.1) + palm(352, 116, 1) + palm(390, 117, 1.2)]] },
    { z: 2, items: town([[6, 117, 15, 16, 0], [24, 116, 12, 12, 0], [39, 117, 16, 20, 1], [58, 116, 13, 13, 0], [74, 117, 15, 17, 0], [92, 116, 12, 11, 0], [108, 117, 14, 15, 1], [364, 115, 14, 14, 0]]) },
    ...growth(stagesOf(pieces, k), built, { ground: 124, clear, halo: [cx, 84, 80] }),
    { z: 4, items: [["water", R0(-2, 128, 404, 26)], ["wave", waves([[30, 134, 12], [120, 138, 10], [250, 135, 14], [360, 137, 12]])], ["deep", R0(8, 122, 1.2, 10) + R0(12, 124, 1.2, 8) + R0(384, 121, 1.2, 11) + R0(389, 124, 1.2, 8)]] },
  ];
}

function olympia(k, built, clear) {
  const key = "olympia", cx = 263;
  const steps = R0(190, 116, 146, 8) + R0(196, 110, 134, 6);
  const colX = [204, 226, 291, 313];
  let cols = "", colShade = "", caps = "";
  for (const x of colX) { cols += R0(x, 74, 9, 36); colShade += R0(x + 5.6, 74, 3.4, 36); caps += R0(x - 2, 70.5, 13, 3.5); }
  const roof = R0(196, 61, 134, 9.5) + poly([[192, 61.5], [cx, 42], [334, 61.5]]);
  // Zeus on his throne, sceptre in one hand and a little Victory in the other.
  const throne = R0(246, 76, 34, 34) + R0(243, 73, 4.5, 37) + R0(279.5, 73, 4.5, 37) + dot(245.2, 72, 2.6) + dot(281.8, 72, 2.6);
  const zeus = dot(cx, 81, 5.2) + `M${pt(cx - 4, 85)}Q${pt(cx, 92)} ${pt(cx + 4, 85)}Z` +
    `M${pt(251, 110)}L${pt(253, 96)}L${pt(252, 90)}Q${pt(253, 87)} ${pt(cx, 87)}Q${pt(273, 87)} ${pt(274, 90)}L${pt(273, 96)}L${pt(275, 110)}Z` +
    `M${pt(252, 90)}L${pt(246.5, 95)}L${pt(247.5, 97.5)}L${pt(254, 94)}Z M${pt(274, 90)}L${pt(279, 93)}L${pt(278, 95.5)}L${pt(272, 94)}Z` + R0(249, 109, 28, 2.5);
  const pieces = [
    { parts: [["cream", steps], ["trim", R0(190, 116, 146, 1.4) + R0(196, 110, 134, 1.4)], ["cella", R0(206, 76, 116, 34)], ["cream", cols], ["shade", colShade + R0(322, 116, 14, 8) + R0(318, 110, 12, 6)], ["trim", caps]],
      ghost: steps + R0(202, 70, 122, 40), box: [190, 70, 336, 124], lamps: [[188, 116], [232, 110], [294, 110], [338, 116]] },
    { parts: [["cream", roof], ["shade", poly([[201, 59.5], [cx, 46.5], [325, 59.5]])], ["trim", R0(196, 64, 134, 1.6)], ["gold", star(cx, 39, 4.5, 1.8, 4) + dot(194, 60, 2.2) + dot(332, 60, 2.2)]],
      ghost: roof, box: [192, 42, 334, 71], lamps: [[190, 62], [228, 52], [cx, 42], [298, 52], [336, 62]] },
    { parts: [["bronze-dk", throne], ["gold-dk", R0(246.2, 74, 1.6, 36)], ["statue", zeus + dot(279.5, 91.5, 2.6) + star(247, 73, 3, 1.2, 4)], ["gold-dk", `M${pt(cx, 96)}L${pt(274.6, 110)}L${pt(268, 110)}Z` + R0(cx - 6, 95, 12, 1.4)]],
      ghost: throne, box: [240, 70, 286, 110], lamps: [] },
  ];
  return [
    skyLayer(key, { sun: [80, 60, 12], clouds: [[140, 66, 0.9], [356, 72, 0.8]], seed: 53 }),
    { z: 1, items: [["far", hill(-2, 402, 98, [16, 26, 10, 18, 8], SH + 2)]] },
    { z: 2, items: [["mid", hill(-2, 402, 117, [5, 3, 6, 4], SH + 2)], ["tree", olive(18, 116, 1.05) + olive(42, 117, 0.85) + olive(150, 116, 1) + olive(372, 116, 1.1) + cypress(170, 118, 0.9) + cypress(352, 118, 0.85)]] },
    { z: 2, items: town([[62, 117, 14, 13, 2], [80, 117, 16, 16, 0], [100, 117, 12, 11, 0], [114, 118, 14, 14, 2]]) },
    ...growth(stagesOf(pieces, k), built, { ground: 124, clear, halo: [cx, 84, 76] }),
    { z: 4, items: [["near", hill(-2, 402, 128, [2, 4, 2, 3], SH + 2)], ["deep", cypress(14, 133, 1.1) + cypress(26, 133, 0.75) + cypress(388, 133, 1.15)]] },
  ];
}

function halicarnassus(k, built, clear) {
  const key = "halicarnassus", cx = 263;
  const podium = R0(224, 86, 78, 34) + R0(218, 118, 90, 6);
  let cols = "", colShade = "";
  for (let i = 0; i < 6; i++) { const x = 229 + i * 12.6; cols += R0(x, 62, 5, 24); colShade += R0(x + 3.2, 62, 1.8, 24); }
  let roof = "";
  for (let i = 0; i < 6; i++) roof += R0(cx - 37 + i * 3.6, 54 - i * 3.6, 74 - i * 7.2, 3.8);
  // The chariot on the roof: two horses rearing ahead of the car and its driver.
  const horse = (x) => `M${pt(x, 33)}L${pt(x + 1, 27)}L${pt(x + 7, 26.5)}L${pt(x + 9, 21)}L${pt(x + 12.5, 19.5)}L${pt(x + 13, 22)}L${pt(x + 10.5, 23)}L${pt(x + 10, 28)}L${pt(x + 9, 33)}L${pt(x + 7.6, 33)}L${pt(x + 7.4, 29.5)}L${pt(x + 2.6, 29.5)}L${pt(x + 2, 33)}Z`;
  const quadriga = horse(258) + horse(264) + `M${pt(248, 31)}L${pt(249, 25)}L${pt(257, 25)}L${pt(258, 31)}Z` + dot(252, 21.5, 2) + R0(250.5, 23, 3, 3) + R0(246, 33, 34, 2);
  const pieces = [
    { parts: [["cream", podium], ["shade", R0(286, 86, 16, 34) + R0(296, 118, 12, 6)], ["trim", R0(222, 86, 82, 3) + R0(224, 94, 78, 1.6)], ["win", R0(258, 104, 10, 14)]],
      ghost: podium, box: [218, 86, 308, 124], lamps: [[220, 86], [263, 87], [306, 86]] },
    { parts: [["inner", R0(231, 64, 64, 22)], ["cream", cols + R0(226, 57.5, 74, 4.5)], ["shade", colShade], ["trim", R0(226, 61, 74, 1.4)]],
      ghost: R0(226, 57.5, 74, 28.5), box: [226, 57, 300, 86], lamps: [[224, 58], [263, 58.5], [302, 58]] },
    { parts: [["cream", roof], ["shade", (() => { let d = ""; for (let i = 0; i < 6; i++) d += R0(cx + 37 - i * 3.6 - 9, 54 - i * 3.6, 9, 3.8); return d; })()], ["trim", (() => { let d = ""; for (let i = 0; i < 6; i++) d += R0(cx - 37 + i * 3.6, 57.2 - i * 3.6, 74 - i * 7.2, 0.6); return d; })()], ["bronze", quadriga], ["bronze-dk", dot(252.5, 31.5, 2.6)], ["bronze-lt", R0(249.5, 26.5, 7, 1.4)]],
      ghost: roof, box: [cx - 37, 19, cx + 37, 58], lamps: [] },
  ];
  return [
    skyLayer(key, { sun: [92, 62, 12], clouds: [[18, 66, 0.8], [348, 74, 0.9]], seed: 67 }),
    { z: 1, items: [["far", hill(150, 402, 100, [10, 16, 8, 12], SH + 2)]] },
    { z: 1, items: [["water", `M-2 106H190V${SH + 2}H-2Z`], ["wave", waves([[16, 114, 10], [100, 110, 12], [150, 120, 10]])], ...boat(120, 118, 0.8)] },
    { z: 2, items: [["mid", `M-2 122Q60 113 150 116Q190 118 212 124V${SH + 2}H-2Z` + `M318 ${SH + 2}V118Q360 110 402 114V${SH + 2}Z`], ["tree", cypress(206, 122, 1) + cypress(320, 120, 1.1) + cypress(332, 120, 0.8)]] },
    { z: 2, items: town([[14, 120, 14, 14, 0], [30, 119, 12, 11, 2], [45, 119, 15, 17, 0], [64, 118, 12, 12, 0], [80, 118, 14, 15, 1], [342, 117, 15, 16, 0], [360, 116, 12, 12, 0], [375, 116, 16, 18, 0]]) },
    ...growth(stagesOf(pieces, k), built, { ground: 124, clear, halo: [cx, 76, 74] }),
    { z: 4, items: [["near", hill(-2, 402, 129, [2, 3, 2, 4], SH + 2)], ["deep", cypress(388, 134, 1.1) + cypress(12, 134, 0.9)]] },
  ];
}

function giza(k, built, clear) {
  const key = "giza", cx = 264, base = 124, apex = 30, half = 82, ridge = 292;
  const xl = (y) => cx - (half * (y - apex)) / (base - apex), xr = (y) => cx + (half * (y - apex)) / (base - apex), xm = (y) => cx + ((ridge - cx) * (y - apex)) / (base - apex);
  const pieces = [];
  for (let i = 0; i < k; i++) {
    const yb = base - ((base - apex) * i) / k, yt = base - ((base - apex) * (i + 1)) / k;
    const band = poly([[xl(yb), yb], [xl(yt), yt], [xr(yt), yt], [xr(yb), yb]]);
    const lit = poly([[xl(yb), yb], [xl(yt), yt], [xm(yt), yt], [xm(yb), yb]]);
    const dark = poly([[xm(yb), yb], [xm(yt), yt], [xr(yt), yt], [xr(yb), yb]]);
    let course = "";
    for (let y = yb - 6; y > yt + 2; y -= 6) course += R0(xl(y) + 1.5, y, xm(y) - xl(y) - 1.5, 0.8);
    const parts = [["stone", lit], ["stone-dk", dark], ["stone-line", course]];
    if (i === k - 1) parts.push(["gold", poly([[xl(apex + 12), apex + 12], [cx, apex], [xm(apex + 12), apex + 12]])], ["gold-dk", poly([[xm(apex + 12), apex + 12], [cx, apex], [xr(apex + 12), apex + 12]])]);
    if (i === 0) parts.push(["win", `M${pt(cx - 6, yt + 9)}h5v-6.4l-2.5 -2.6l-2.5 2.6Z`]);
    pieces.push({ parts, ghost: band, box: [xl(yb), yt, xr(yb), yb], lamps: i === k - 1 ? [] : [[xl(yt) - 2, yt], [cx, yt + 1.5], [xr(yt) + 2, yt]] });
  }
  const sphinx = `M${pt(84, 124)}L${pt(84, 117)}Q${pt(86, 112)} ${pt(92, 112)}L${pt(112, 112)}L${pt(114, 106)}Q${pt(115, 99)} ${pt(120, 99)}Q${pt(125, 99)} ${pt(126, 106)}L${pt(127, 113)}L${pt(132, 118)}L${pt(132, 124)}Z`;
  return [
    skyLayer(key, { sun: [66, 62, 13], clouds: [[150, 58, 0.9], [354, 72, 0.8]], seed: 79 }),
    { z: 1, items: [["far", hill(-2, 402, 110, [6, 10, 4, 8, 5], SH + 2)]] },
    { z: 1, items: [["far", poly([[86, 112], [124, 76], [162, 112]]) + poly([[142, 113], [168, 88], [194, 113]])], ["mid", poly([[124, 76], [136, 112], [162, 112]]) + poly([[168, 88], [177, 113], [194, 113]])]] },
    { z: 2, items: [["mid", `M-2 118Q80 112 180 120V${SH + 2}H-2Z`], ["near", sphinx], ["deep", R0(119, 101, 6, 3)], ["tree", palm(30, 120, 1.15) + palm(46, 121, 0.9) + palm(370, 122, 1.1) + palm(388, 122, 0.85)]] },
    ...growth(stagesOf(pieces, k), built, { ground: 124, clear, halo: [cx, 84, 80] }),
    { z: 4, items: [["water", R0(-2, 130, 404, 24)], ["wave", waves([[24, 136, 12], [150, 139, 10], [290, 136, 12], [360, 139, 10]])], ["deep", R0(196, 125, 1.2, 9) + R0(200, 127, 1.2, 7) + R0(330, 125, 1.2, 9)]] },
  ];
}

const SCENES = { rhodes, alexandria, ephesus, babylon, olympia, halicarnassus, giza };

// ---------- effect and cost icons ----------
const ICON = 20;
const part = (w, draw) => ({ w, draw });
function coinArt(v, x, y, r, shadow = true) {
  const f = v >= 3 ? "coin3" : "coin1";
  let o = (shadow ? shadowOf(dot(x, y, r), r / 9) : "") + circleEl(x, y, r, `${f}-dk`) + circleEl(x - r * 0.05, y - r * 0.08, r * 0.86, f);
  if (r >= 6) o += strokeEl(`M${pt(x - r * 0.56, y - r * 0.28)}A${n(r * 0.6)} ${n(r * 0.6)} 0 0 1 ${pt(x - r * 0.14, y - r * 0.62)}`, "glint", r * 0.11, ' fill="none" stroke-linecap="round" opacity=".7"');
  return o + textEl(x - r * 0.04, y + r * 0.37, r * 1.06, `${f}-ink`, String(v), ' font-weight="700"');
}
function smallCard(x, y, w, f, rot = 0, extra = "") {
  const h = w * 1.38;
  return `<g transform="translate(${pt(x, y)}) rotate(${n(rot)})">${fillEl(rr(-w / 2, -h / 2, w, h, w * 0.16), f)}${extra}</g>`;
}
const arrow = (x, y, s, dir) => fillEl(`M${pt(x - dir * s * 0.45, y - s * 0.22)}V${n(y + s * 0.22)}H${n(x + dir * s * 0.05)}V${n(y + s * 0.42)}L${pt(x + dir * s * 0.5, y)}L${pt(x + dir * s * 0.05, y - s * 0.42)}V${n(y - s * 0.22)}Z`, "arrow");
const slash = (x, y, s) => strokeEl(`M${pt(x + s * 0.12, y - s * 0.3)}L${pt(x - s * 0.12, y + s * 0.3)}`, "ink", s * 0.09, ' stroke-linecap="round" opacity=".7"');

function choiceIcon(unit, s) {
  const m = s * 0.66, g = m * 0.32, w = unit.length * m + (unit.length - 1) * g;
  return part(w, (x, y) => unit.map((r, i) => { const ix = x - w / 2 + m / 2 + i * (m + g); return (i ? slash(ix - (m + g) / 2, y, m) : "") + place(resourceIcon(r), ix, y, m); }).join(""));
}
const wildScience = (s) => part(s * 1.2, (x, y) => {
  const r = s * 0.6;
  return shadowOf(dot(x, y, r), s / 22) + circleEl(x, y, r, "sci-ring") + circleEl(x, y, r * 0.84, "sci-disc") +
    place(scienceIcon(0), x, y - r * 0.4, s * 0.46) + place(scienceIcon(1), x - r * 0.38, y + r * 0.3, s * 0.46) + place(scienceIcon(2), x + r * 0.38, y + r * 0.3, s * 0.46);
});
// Build one card from the discards: a pile, the chosen card lifting out of it.
const digIcon = (s) => part(s * 1.15, (x, y) => {
  const c = s * 0.46;
  return smallCard(x - s * 0.16, y + s * 0.18, c, "pile-dk", -16) + smallCard(x + s * 0.1, y + s * 0.2, c, "pile", 10) +
    smallCard(x + s * 0.02, y - s * 0.1, c, "card", 4, fillEl(star(0, 0, c * 0.32, c * 0.13, 4), "gold-dk")) +
    fillEl(`M${pt(x + s * 0.44, y + s * 0.34)}V${n(y - s * 0.2)}H${n(x + s * 0.3)}L${pt(x + s * 0.52, y - s * 0.48)}L${pt(x + s * 0.74, y - s * 0.2)}H${n(x + s * 0.6)}V${n(y + s * 0.34)}Z`, "coral");
});
// Once an age, a card for nothing: a card tied up like a present.
const freeIcon = (s) => part(s * 0.9, (x, y) => {
  const c = s * 0.62, h = c * 1.38;
  const ribbon = fillEl(R0(-c * 0.09, -h / 2, c * 0.18, h) + R0(-c / 2, -h * 0.06, c, h * 0.12), "gold") +
    fillEl(`M0 ${n(-h / 2)}Q${pt(-c * 0.5, -h * 0.8)} ${pt(-c * 0.36, -h * 0.46)}ZM0 ${n(-h / 2)}Q${pt(c * 0.5, -h * 0.8)} ${pt(c * 0.36, -h * 0.46)}Z`, "gold-dk");
  return shadowOf(rr(x - c / 2, y - h / 2 + s * 0.06, c, h, c * 0.16), s / 24) + smallCard(x, y + s * 0.06, c, "gift", 0, ribbon);
});
// Play the seventh card of an age instead of discarding it.
const seventhIcon = (s) => part(s * 0.85, (x, y) => {
  const c = s * 0.66;
  return shadowOf(rr(x - c / 2, y - c * 0.69, c, c * 1.38, c * 0.16), s / 24) + smallCard(x, y, c, "seventh", 0, textEl(0, c * 0.38, c * 1.02, "card", "7", ' font-weight="700"'));
});
// Score a neighbour's guild as your own: two guild cards, one copied, between the arrows.
const copyIcon = (s) => part(s * 1.55, (x, y) => {
  const c = s * 0.46;
  return arrow(x - s * 0.6, y, s * 0.38, -1) + smallCard(x - s * 0.1, y - s * 0.06, c, "guild-dk", -8) + smallCard(x + s * 0.1, y + s * 0.06, c, "guild", 8, fillEl(star(0, 0, c * 0.3, c * 0.12, 5), "card")) + arrow(x + s * 0.6, y, s * 0.38, 1);
});
// Raw materials from both neighbours at 1 coin.
const tradeIcon = (s) => part(s * 2.3, (x, y) => {
  const m = s * 0.4;
  let o = arrow(x - s * 0.95, y, s * 0.42, -1) + arrow(x + s * 0.95, y, s * 0.42, 1);
  [0, 1, 2, 3].forEach((r, i) => (o += place(resourceIcon(r), x - s * 0.47 + (i % 2) * m * 1.05, y - m * 0.53 + Math.floor(i / 2) * m * 1.05, m)));
  return o + coinArt(1, x + s * 0.4, y, s * 0.3, false);
});

function effectParts(st, s) {
  const parts = [];
  for (let i = 0; i < (st.shields || 0); i++) parts.push(part(s * 0.92, (x, y) => place(shieldIcon(), x, y, s * 0.96)));
  if (st.points) parts.push(part(s * 1.06, (x, y) => place(pointsIcon(st.points), x, y, s * 1.1)));
  if (st.gold) parts.push(part(s * 0.96, (x, y) => coinArt(st.gold, x, y, s * 0.46)));
  for (const unit of st.produce || []) parts.push(choiceIcon(unit, s));
  if (st.science) parts.push(wildScience(s));
  if (st.trade) parts.push(tradeIcon(s));
  if (st.free) parts.push(freeIcon(s));
  if (st.playLast) parts.push(seventhIcon(s));
  if (st.copyGuild) parts.push(copyIcon(s));
  if (st.dig) parts.push(digIcon(s));
  return parts;
}
function row(parts, x, y, gap) {
  const total = parts.reduce((a, p) => a + p.w, 0) + gap * (parts.length - 1);
  let at = x - total / 2, o = "";
  for (const p of parts) { o += p.draw(at + p.w / 2, y); at += p.w + gap; }
  return o;
}
const rowWidth = (parts, gap) => parts.reduce((a, p) => a + p.w, 0) + gap * (parts.length - 1);
// Fits a row of icons into maxW, shrinking the icons rather than overflowing: { svg, w }.
function fitRow(make, size, maxW, x, y) {
  let parts = make(size), w = rowWidth(parts, size * 0.14);
  if (w > maxW) { size *= maxW / w; parts = make(size); w = maxW; }
  return { svg: row(parts, x, y, size * 0.14), w };
}
function costParts(cost, s) {
  const parts = [];
  for (const r of RESOURCES) for (let i = 0; i < cost.res[r]; i++) parts.push(part(s, (x, y) => place(resourceIcon(r), x, y, s)));
  if (cost.coins) parts.push(part(s, (x, y) => coinArt(cost.coins, x, y, s * 0.48, false)));
  return parts;
}

// ---------- the board ----------
const BW = 400, BH = 244, BODY_H = 216, STRIP = 140, TILE_Y = 149, TILE_H = 59;
const wave = (x0, x1, y, k, a) => `M${pt(x0, y)}` + Array.from({ length: k }, (_, i) => `Q${pt(x0 + ((i + 0.5) * (x1 - x0)) / k, y + (i % 2 ? a : -a))} ${pt(x0 + ((i + 1) * (x1 - x0)) / k, y)}`).join("");

// The bottom of a face-down card peeking out under a stage.
function tuckedCard(x, age, rot) {
  const w = 36, h = 50, y = BODY_H + 22 - h, b = `back${age}`;
  let o = shadowOf(rr(-w / 2, 0, w, h, 5), 1.2) + fillEl(rr(-w / 2, 0, w, h, 5), b);
  o += fillEl(hill(-w / 2, w / 2, h - 13, [3, 5, 2], h - 0.5) , `${b}-dk`);
  let dots = "";
  for (let dx = -w / 2 + 4; dx <= w / 2 - 3; dx += 4) dots += dot(dx, h - 2.6, 0.55);
  o += fillEl(dots, "card", ' opacity=".7"') + textEl(0, h - 5, 8, "card", ROMAN[age - 1], ' font-weight="700"');
  return `<g transform="translate(${pt(x, y)}) rotate(${n(rot)} 0 ${n(h)})">${o}</g>`;
}

function stageTile(st, i, x, w, state, k) {
  const y = TILE_Y, h = TILE_H, d = rr(x, y, w, h, 12);
  const built = state === "built";
  let o = `<g class="sc-stage sc-stage-${state}" data-stage="${i}">`;
  if (built) o += night(fillEl(rr(x - 3, y - 3, w + 6, h + 6, 15), "lamp", ' opacity=".35"')) + shadowOf(d, 1.2, 1.3) + fillEl(d, "gold");
  else o += fillEl(d, "tile");
  if (state === "pending") o += strokeEl(rr(x + 2.5, y + 2.5, w - 5, h - 5, 9.5), "coral", 1.6, ' fill="none" stroke-dasharray="4 3" stroke-linecap="round"');
  if (built) o += fillEl(star(x + w - 10, y + 10, 4.6, 1.8, 4) + star(x + w - 19, y + 7, 2.8, 1.1, 4), "card");
  o += `<text x="${n(x + 8)}" y="${n(y + 13)}" font-size="10.5" class="sc-p-text sc-pf-${built ? "built-ink" : "tile-ink"}" font-weight="700">${ROMAN[i]}</text>`;
  // The effect sits on a cream label, as on the cards, so it reads on gold and on night paper alike.
  const fx = fitRow((size) => effectParts(st, size), k >= 4 ? 21 : 24, w - 34, x + w / 2, y + 20.5);
  const lw = Math.min(w - 26, fx.w + 14);
  o += shadowOf(rr(x + w / 2 - lw / 2, y + 6, lw, 29, 14.5), 0.8) + fillEl(rr(x + w / 2 - lw / 2, y + 6, lw, 29, 14.5), "card") + fx.svg;
  o += fillEl(rr(x + 5, y + 39, w - 10, 16, 8), built ? "built-band" : "tile-band");
  o += fitRow((size) => costParts(st.cost, size), 13.5, w - 16, x + w / 2, y + 47).svg;
  return o + "</g>";
}

const sideOf = (W, side) => (W.sides[side] ? side : "A");
const nameWidth = (W) => W.name.length * 14.5 * 0.53 + 22;
function sceneSvg(W, k, built, x, y, w, h, vb) {
  return `<svg x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" viewBox="${vb}" preserveAspectRatio="xMidYMid slice">${paintLayers(SCENES[W.key](k, built, 9 + nameWidth(W)), W.key)}</svg>`;
}
const label = (W, side, built, k) => esc(`${W.name}, side ${side}: ${built} of ${k} stages built`);

// A wonder board, 400 x 244 units, sized by CSS. built: stages built;
// tucked: the face-down cards under them, a count (each taken as the age of
// its stage number, up to III) or the age of each card; a card beyond the
// built stages marks that stage as being built this turn.
export function wonderSvg(w, side, { built = 0, tucked = built } = {}) {
  const W = WONDERS[w];
  side = sideOf(W, side);
  const stages = W.sides[side], k = stages.length, key = W.key;
  built = clamp(built | 0, 0, k);
  const ages = (Array.isArray(tucked) ? tucked : Array.from({ length: clamp(tucked | 0, 0, k) }, (_, i) => Math.min(3, i + 1))).slice(0, k).map((a) => clamp(a | 0, 1, 3));
  const pad = 8, tw = (BW - pad * (k + 1)) / k, tx = (i) => pad + i * (tw + pad);
  let o = `<svg class="sc-wonder sc-w-${key}" viewBox="0 0 ${BW} ${BH}" role="img" aria-label="${label(W, side, built, k)}">`;
  ages.forEach((a, i) => (o += tuckedCard(tx(i) + tw / 2 + (i % 2 ? 6 : -6), a, i % 2 ? 4 : -3)));
  const body = rr(0, 0, BW, BODY_H, 16);
  o += shadowOf(body, 2, 1.2) + fillEl(body, `${key}-4`);
  o += sceneSvg(W, k, built, 0, 0, SW, SH, `0 0 ${SW} ${SH}`);
  const lip = wave(0, BW, STRIP, 14, 3.4) + `V${STRIP + 14}H0Z`;
  o += `<g class="sc-pf-shadow">${[[-1.4, 0.16], [-2.8, 0.08]].map(([dy, a]) => `<path d="${lip}" transform="translate(0 ${dy})" opacity="${a}"/>`).join("")}</g>` + fillEl(lip, `${key}-4`);
  let dots = "";
  for (let x = 14; x <= BW - 14; x += 7) dots += dot(x, BODY_H - 4.5, 0.8);
  o += fillEl(dots, `${key}-2`, ' opacity=".6"');
  const fs = 14.5, nw = nameWidth(W);
  o += shadowOf(rr(9, 9, nw, 25, 12.5), 1.2) + fillEl(rr(9, 9, nw, 25, 12.5), "card") + textEl(9 + nw / 2, 26.5, fs, "ink", W.name);
  o += shadowOf(dot(377, 22, 15), 1.3) + circleEl(377, 22, 15, "card") + place(resourceIcon(W.produce), 377, 22, 20);
  o += shadowOf(dot(347, 22, 11), 1.1) + circleEl(347, 22, 11, "gold") + textEl(347, 26.6, 13, "built-ink", side, ' font-weight="700"');
  stages.forEach((st, i) => (o += stageTile(st, i, tx(i), tw, i < built ? "built" : i < ages.length ? "pending" : "open", k)));
  return o + "</svg>";
}

// A neighbour's wonder, 200 x 92 units: its scene as built and a lantern a
// stage, lit when built, with the side and the wonder's own resource.
export function wonderMini(w, side, built = 0) {
  const W = WONDERS[w];
  side = sideOf(W, side);
  const k = W.sides[side].length, key = W.key;
  built = clamp(built | 0, 0, k);
  const body = rr(0, 0, 200, 90, 8);
  let o = `<svg class="sc-wonder-mini sc-w-${key}" viewBox="0 0 200 92" role="img" aria-label="${label(W, side, built, k)}">`;
  o += shadowOf(body, 1.2) + fillEl(body, `${key}-4`) + sceneSvg(W, k, built, 0, 0, 200, 66, "24 4 376 124");
  const lip = wave(0, 200, 64, 8, 2.2) + "V70H0Z";
  o += `<g class="sc-pf-shadow"><path d="${lip}" transform="translate(0 -1.2)" opacity=".16"/></g>` + fillEl(lip, `${key}-4`);
  for (let i = 0; i < k; i++) {
    const x = 14 + i * 21, y = 78, lit = i < built;
    o += strokeEl(`M${pt(x, y - 9)}V${n(y - 6)}`, lit ? "gold" : "tile", 1);
    if (lit) o += night(circleEl(x, y, 10, "lamp", ' opacity=".3"'));
    o += fillEl(rr(x - 3.4, y - 7, 6.8, 2, 0.8) + rr(x - 3.4, y + 5.2, 6.8, 2, 0.8), lit ? "gold-dk" : "tile-band");
    o += fillEl(`M${pt(x - 5, y - 5.2)}Q${pt(x - 7.4, y)} ${pt(x - 5, y + 5.2)}H${n(x + 5)}Q${pt(x + 7.4, y)} ${pt(x + 5, y - 5.2)}Z`, lit ? "gold" : "tile");
    o += textEl(x, y + 3, 6.5, lit ? "built-ink" : "tile-ink", ROMAN[i], ' font-weight="700"');
  }
  o += circleEl(160, 78, 8.5, "gold") + textEl(160, 81.6, 10, "built-ink", side, ' font-weight="700"');
  o += circleEl(182, 78, 10, "card") + place(resourceIcon(W.produce), 182, 78, 14);
  return o + "</svg>";
}

// ---------- coins, tokens and the table ----------
// A coin of 1 (copper) or 3 (gold, ringed with punched dots), 24 units across.
export function coinSvg(value) {
  const v = value >= 3 ? 3 : 1;
  let o = `<svg class="sc-coin sc-coin-${v}" viewBox="-12 -12 24 24" role="img" aria-label="${v === 1 ? "1 coin" : "3 coins"}">`;
  o += shadowOf(dot(0, 0, 10.6), 1.1) + circleEl(0, 0, 10.6, `coin${v}-dk`) + circleEl(-0.5, -0.8, 9.4, `coin${v}`);
  if (v === 3) { let d = ""; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; d += dot(-0.5 + 7.9 * Math.cos(a), -0.8 + 7.9 * Math.sin(a), 0.55); } o += fillEl(d, "coin3-dk", ' opacity=".55"'); }
  o += strokeEl("M-6.4 -3.6A6.8 6.8 0 0 1 -2.4 -7.4", "glint", 1.1, ' fill="none" stroke-linecap="round" opacity=".7"');
  return o + textEl(-0.5, 4.4, 12.5, `coin${v}-ink`, String(v), ' font-weight="700"') + "</svg>";
}

// A military token: a victory banner of 1, 3 or 5 (bronze, silver, gold) or a torn defeat token of −1.
export function tokenSvg(value) {
  if (value < 0) {
    const d = "M-9 -10H9L7 -2.5L10 2L6 10.5L1.5 7L-3 10.5L-9.5 8L-8 0Z";
    return `<svg class="sc-token sc-token-defeat" viewBox="-12 -12 24 24" role="img" aria-label="Defeat, minus 1 point">` +
      shadowOf(d, 1.1) + fillEl(d, "defeat") + fillEl("M-9 -10H9L8.2 -6.8H-8.6Z", "defeat-dk") + textEl(0, 4.6, 11.5, "defeat-ink", "−1", ' font-weight="700"') + "</svg>";
  }
  const v = value >= 5 ? 5 : value >= 3 ? 3 : 1, f = `victory${v}`;
  const d = "M-9 -10.5H9V5L0 11L-9 5Z";
  let o = `<svg class="sc-token sc-token-${v}" viewBox="-12 -12 24 24" role="img" aria-label="Victory, ${v} point${v > 1 ? "s" : ""}">`;
  o += shadowOf(d, 1.1) + fillEl(d, f) + fillEl("M-9 -10.5H9V-6.6H-9Z", `${f}-dk`);
  o += fillEl(star(0, -8.5, 1.6, 0.6, 4) + (v > 1 ? star(-4, -8.5, 1.2, 0.5, 4) + star(4, -8.5, 1.2, 0.5, 4) : ""), "glint", ' opacity=".9"');
  return o + textEl(0, 5.2, 12.5, "flag-ink", String(v), ' font-weight="700"') + "</svg>";
}

// The table: paper hills at the foot of a warm sky by day, an indigo sky with stars by night. Sized to cover by CSS.
export function tableSvg() {
  const W = 1200, H = 800, g = rng(97);
  let stars = "", clouds = "";
  for (let i = 0; i < 70; i++) stars += star(g() * W, g() * H * 0.75, 1.4 + g() * 1.8, 0.55, 4);
  for (const [x, y, k] of [[140, 120, 2.6], [760, 80, 2], [1010, 210, 2.8], [420, 260, 1.8]]) clouds += puff(x, y, k);
  let o = `<svg class="sc-table" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">` + `<rect width="${W}" height="${H}" class="sc-pf-table"/>`;
  o += night(fillEl(stars, "lamp", ' opacity=".5"')) + `<path d="${clouds}" class="sc-pf-table-cloud sc-cloud"/>`;
  for (const [y, c, b] of [[H - 170, "hill1", [40, 70, 30, 60, 50]], [H - 110, "hill2", [30, 55, 45, 25, 60, 35]], [H - 52, "hill3", [25, 40, 30, 45, 20, 35, 30]]]) {
    const d = hill(-10, W + 10, y, b, H + 10);
    o += shadowOf(d, 2.5) + fillEl(d, c);
  }
  return o + "</svg>";
}
