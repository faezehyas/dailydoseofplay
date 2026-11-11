// The border between you and a neighbour, drawn as a strip at the foot of
// their panel: a river with their bank on the outer side and yours toward
// the centre. Cards change it: with no trade card a rope ferry crosses at 2
// coins a resource; a raw-material discount on that side lays a stone bridge
// with two lanterns; a goods discount puts up a striped market stall on their
// landing. Each bank grows a palisade, then a stone wall, then towers as its
// shields grow (0, 1–2, 3–5, 6+). The art is a markup string in the Paper
// Lantern style of pieces.js (cut paper, soft offset shadows, no outlines,
// sc-bf-* fills and sc-bs-* strokes that border.css maps to --sc-b-* tokens,
// .sc-b-night parts that show only by night, no ids). borderView lays the
// price sign, the neighbour's sale shelf, the war flags, the shields tally and
// the warning over it, and moves a cart across while coins fly back.
import { el } from "../engine/shell.js";
import { VICTORY, DEFEAT, RESOURCE_NAMES } from "./cards.js";
import { resourceIcon } from "./card-art.js";
import { coinSvg } from "./pieces.js";
import { unitPrice, shields, production, leftOf, rightOf, ROUNDS } from "./rules.js";

// ---------- geometry ----------
const n = (v) => String(Math.round(v * 100) / 100);
const pt = (x, y) => `${n(x)} ${n(y)}`;
const R0 = (x, y, w, h) => `M${pt(x, y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
const rr = (x, y, w, h, r) =>
  `M${pt(x + r, y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${pt(x + w, y + r)}V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${pt(x + w - r, y + h)}H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${pt(x, y + h - r)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${pt(x + r, y)}Z`;
const dot = (x, y, r) => `M${pt(x - r, y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
const poly = (pts) => "M" + pts.map(([x, y]) => pt(x, y)).join("L") + "Z";
const star = (cx, cy, ro, ri, k) =>
  poly(Array.from({ length: 2 * k }, (_, i) => { const r = i % 2 ? ri : ro, a = -Math.PI / 2 + (Math.PI * i) / k; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }));
const hill = (x0, x1, y, bumps, yb) => {
  const step = (x1 - x0) / bumps.length;
  return `M${pt(x0, y)}` + bumps.map((b, i) => `Q${pt(x0 + step * (i + 0.5), y - b)} ${pt(x0 + step * (i + 1), y)}`).join("") + `L${pt(x1, yb)}L${pt(x0, yb)}Z`;
};
// An arch opening wound the other way, so it cuts the shape it is merged into.
const archHole = (x, y, w, h) => `M${pt(x, y + h)}H${n(x + w)}V${n(y + w / 2)}A${n(w / 2)} ${n(w / 2)} 0 0 0 ${pt(x, y + w / 2)}Z`;
const arch = (x, y, w, h) => `M${pt(x, y + h)}V${n(y + w / 2)}A${n(w / 2)} ${n(w / 2)} 0 0 1 ${pt(x + w, y + w / 2)}V${n(y + h)}Z`;
// A ring sector: a stone of an arch, angles in degrees (180 the left spring, 270 the crown).
function voussoir(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(r0, a0), [x1, y1] = p(r1, a0), [x2, y2] = p(r1, a1), [x3, y3] = p(r0, a1);
  return `M${pt(x0, y0)}L${pt(x1, y1)}A${n(r1)} ${n(r1)} 0 0 1 ${pt(x2, y2)}L${pt(x3, y3)}A${n(r0)} ${n(r0)} 0 0 0 ${pt(x0, y0)}Z`;
}

// ---------- paint ----------
const fill = (d, f, extra = "") => (d ? `<path d="${d}" class="sc-bf-${f}"${extra}/>` : "");
const line = (d, s, w, extra = "") => (d ? `<path d="${d}" class="sc-bs-${s}" fill="none" stroke-width="${n(w)}"${extra}/>` : "");
const night = (inner) => (inner ? `<g class="sc-b-night">${inner}</g>` : "");
const SHADOW = [[0.4, 1.9, 0.08], [0.25, 1.1, 0.12], [0, 0.5, 0.18]];
const shadowOf = (d, k = 1) => (d ? `<g class="sc-bf-shadow">` + SHADOW.map(([x, y, a]) => `<path d="${d}" transform="translate(${n(x * k)} ${n(y * k)})" opacity="${a}"/>`).join("") + "</g>" : "");
// A piece that lay() builds in, one part at a time.
const piece = (inner, i, extra = "") => `<g class="sc-b-pc" style="--i:${i}"${extra}>${inner}</g>`;
// Markup that is a whole <svg> (card-art icons, pieces coins) placed centred at x, y.
function place(markup, x, y, size) {
  return markup.replace(/^\s*<svg\b([^>]*)>/, (_, a) => `<svg${a.replace(/\s(?:x|y|width|height|xmlns)="[^"]*"/g, "")} x="${n(x - size / 2)}" y="${n(y - size / 2)}" width="${n(size)}" height="${n(size)}">`);
}

// ---------- the scene ----------
// 240 x 80 units, their bank on the left (mirrored for a right neighbour).
// The river comes from between the far hills and widens toward you; the
// crossing sits at mid depth, about y 40 to 56.
export const BW = 240, BH = 80;
const MID = BW / 2;
const mirror = (x) => BW - x;
// The river's edge on their side, top to bottom.
const EDGE = "M113 33C109 42 101 48 99 56C97 64 91 72 88 82";
const BANK = "M-2 34Q30 31 60 33.5Q86 36 113 33C109 42 101 48 99 56C97 64 91 72 88 82L-2 82Z";
const MEADOW = "M-2 70Q20 64 48 68Q72 71 93.6 68.6C92 74 90 78 88.6 82L-2 82Z";
const LIP = EDGE + "L91.6 82C94.4 72 100.4 64 102.4 56C104.4 48 112 42 115 33Z";
const WATER = "M110 32Q120 30 130 32C131 42 139 48 141 56C143 64 149 72 152 82L88 82C91 72 97 64 99 56C101 48 109 42 110 32Z";
const SHINE = "M117 33Q120 32.4 123 33C125 44 131 52 132 62C133 70 136 76 138 82L110 82C111 76 107 70 108 62C109 52 115 44 117 33Z";
const ripple = (x, y, w) => `M${pt(x, y)}q${n(w / 4)} ${n(-w / 6)} ${n(w / 2)} 0t${n(w / 2)} 0`;
const WAVES = [[114, 37, 4], [123, 43, 5], [104, 63, 6], [126, 60, 7], [97, 75, 7], [132, 74, 8], [114, 70, 6], [111, 50, 5]].map((w) => ripple(...w)).join("");
const puff = (x, y, k) => dot(x, y, 3.4 * k) + dot(x + 6 * k, y - 2.6 * k, 4.6 * k) + dot(x + 12 * k, y, 3.4 * k) + R0(x, y, 12 * k, 3.4 * k);

function sky(seed = 7) {
  let s = seed, stars = "";
  const g = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 22; i++) {
    const x = 4 + g() * 232, y = 3 + g() * 24, r = 0.8 + g() * 0.9;
    if (Math.hypot(x - 26, y - 12) > 11) stars += star(x, y, r, r * 0.38, 4);
  }
  return fill(R0(-2, -2, BW + 4, BH + 4), "sky") +
    night(line(dot(26, 12, 9), "lamp", 4, ' opacity=".14"')) + fill(dot(26, 12, 5.6), "sun") + night(fill(dot(28.4, 10.4, 4.7), "sky")) +
    `<path d="${puff(58, 18, 0.8) + puff(188, 12, 0.7) + puff(150, 22, 0.5)}" class="sc-bf-cloud sc-b-cloud"/>` + night(fill(stars, "lamp", ' opacity=".8"'));
}

// Little houses: [x, base, w, h]; roof in the seat's colour, windows that glow at night.
function houses(list, who) {
  let body = "", shade = "", roof = "", win = "";
  for (const [x, yb, w, h] of list) {
    const yt = yb - h;
    body += R0(x, yt, w, h);
    shade += R0(x + w * 0.66, yt, w * 0.34, h);
    roof += poly([[x - 1.3, yt + 0.4], [x + w / 2, yt - w * 0.5], [x + w + 1.3, yt + 0.4]]);
    win += rr(x + w * 0.22, yt + h * 0.3, 2, 2.4, 0.5);
    if (w >= 9) win += rr(x + w * 0.6, yt + h * 0.3, 2, 2.4, 0.5);
  }
  return shadowOf(body + roof) + fill(body, "cream") + fill(shade, "house-shade") + fill(roof, `roof-${who}`) + fill(win, "win") + night(line(win, "lamp", 1.6, ' stroke-linejoin="round" opacity=".5"'));
}
const cypress = (x, y, s) => `M${pt(x, y - 15 * s)}C${pt(x + 3.6 * s, y - 9.6 * s)} ${pt(x + 3.6 * s, y - 2 * s)} ${pt(x, y)}C${pt(x - 3.6 * s, y - 2 * s)} ${pt(x - 3.6 * s, y - 9.6 * s)} ${pt(x, y - 15 * s)}Z`;
const tree = (x, y, s) => R0(x - 0.7 * s, y - 5 * s, 1.4 * s, 5 * s) + dot(x - 2.8 * s, y - 6.4 * s, 3 * s) + dot(x + 2.8 * s, y - 6.8 * s, 3.2 * s) + dot(x, y - 9.4 * s, 3.6 * s);
const bush = (x, y, s) => dot(x - 2.2 * s, y - 1.6 * s, 2 * s) + dot(x + 2.2 * s, y - 1.6 * s, 2 * s) + dot(x, y - 2.6 * s, 2.5 * s) + R0(x - 4.2 * s, y - 1.6 * s, 8.4 * s, 1.6 * s);
const tufts = (list) => list.map(([x, y]) => `M${pt(x - 1.6, y)}Q${pt(x - 1.2, y - 2.2)} ${pt(x - 2, y - 3.4)}Q${pt(x, y - 2)} ${pt(x, y - 4)}Q${pt(x + 0.6, y - 2)} ${pt(x + 2, y - 3.2)}Q${pt(x + 1.2, y - 2)} ${pt(x + 1.6, y)}Z`).join("");
const reeds = (x, y) => line([-1.6, -0.5, 0.6, 1.7].map((dx, i) => `M${pt(x + dx, y)}Q${pt(x + dx * 1.3, y - 3)} ${pt(x + dx * 1.8, y - 5.4 - (i % 2) * 1.2)}`).join(""), "reed", 0.6, ' stroke-linecap="round"') + fill(dot(x - 2.8, y - 5.6, 0.7) + dot(x + 2.9, y - 6.4, 0.7), "wood-dk");

// One bank: ground, meadow, houses, trees and its defences, on the left half.
// walls: 0 open ground, 1 a palisade, 2 a stone wall, 3 a wall with towers.
function bank(who, level) {
  const lv = who === "them" ? "them" : "me";
  let o = shadowOf(BANK, 1.2) + fill(BANK, `bank-${lv}`) + fill(MEADOW, `meadow-${lv}`) + fill(LIP, `lip-${lv}`);
  o += fill(`M76 52Q82 47 88 46.5Q94 46 99 45.6L100 47.6Q94 48 89 48.6Q83 49.4 78.6 53Z`, "road");
  o += shadowOf(cypress(9, 37, 0.8) + tree(47, 38.6, 0.8)) + fill(cypress(9, 37, 0.8), "leaf-dk") + fill(tree(47, 38.6, 0.8), "leaf");
  o += houses([[13, 37.6, 9, 8], [25, 39, 11, 9.5], [38, 38.4, 8, 7.4]], lv);
  o += houses([[3, 45, 10, 8.6], [16, 46.4, 12, 9.4]], lv);
  o += defences(level, lv);
  o += shadowOf(bush(68, 62, 0.9) + bush(30, 58, 0.8)) + fill(bush(68, 62, 0.9) + bush(30, 58, 0.8), "leaf");
  o += fill(tufts([[12, 66], [44, 72], [62, 76], [80, 71], [24, 78]]), `tuft-${lv}`);
  return o + reeds(93.4, 70) + reeds(98.2, 61);
}

// The defences stand across the bank, the road passing through their gate.
const DX0 = 50, DX1 = 90, DY = 47, GATE = [71, 77];
function defences(level, lv) {
  let o = "";
  if (level <= 0) return shadowOf(bush(60, DY, 0.75)) + fill(bush(60, DY, 0.75), "leaf-dk");
  if (level === 1) {
    let stakes = "", rails = "";
    for (let x = DX0; x < DX1 - 1; x += 2.6) {
      if (x + 2.2 > GATE[0] && x < GATE[1]) continue;
      const h = 6.6 + ((x * 7) % 3) * 0.5;
      stakes += poly([[x, DY], [x, DY - h], [x + 1.1, DY - h - 1.6], [x + 2.2, DY - h], [x + 2.2, DY]]);
    }
    rails += R0(DX0 - 0.4, DY - 5.4, GATE[0] - DX0 + 0.4, 1) + R0(GATE[1], DY - 5.4, DX1 - GATE[1], 1) + R0(DX0 - 0.4, DY - 2.4, GATE[0] - DX0 + 0.4, 1) + R0(GATE[1], DY - 2.4, DX1 - GATE[1], 1);
    const posts = R0(GATE[0] - 1.6, DY - 9.4, 1.8, 9.4) + R0(GATE[1] - 0.2, DY - 9.4, 1.8, 9.4);
    return o + shadowOf(stakes + posts) + fill(stakes, "wood") + fill(rails, "wood-dk") + fill(posts, "wood-dk");
  }
  // A stone wall with merlons and a gate, the right end in shade.
  const h = 7.4, top = DY - h;
  let wall = R0(DX0, top, DX1 - DX0, h);
  for (let x = DX0; x <= DX1 - 2.2; x += 4.2) wall += R0(x, top - 2.2, 2.4, 2.4);
  let courses = "";
  for (let y = top + 2.4; y < DY - 0.5; y += 2.4) courses += R0(DX0 + 0.6, y, DX1 - DX0 - 1.2, 0.45);
  const gate = arch(GATE[0], DY - 6, GATE[1] - GATE[0], 6);
  o += shadowOf(wall) + fill(wall, "stone") + fill(R0(DX1 - 7, top, 7, h), "stone-dk") + fill(courses, "stone-line") + fill(gate, "gate");
  if (level >= 3) {
    // Two towers: one at the outer end, one by the gate, with the seat's banner.
    const tower = (cx, w, th) => {
      const x = cx - w / 2, ty = DY - th;
      let d = R0(x, ty, w, th);
      for (let i = 0; i < 3; i++) d += R0(x - 0.6 + i * ((w + 1.2 - 2.2) / 2), ty - 2.4, 2.2, 2.6);
      return d;
    };
    const towers = tower(DX0 + 3, 7.4, 15) + tower(GATE[1] + 7, 8, 17);
    const tw = rr(DX0 + 2.1, DY - 11.8, 1.8, 2.6, 0.6) + rr(GATE[1] + 6.1, DY - 13.2, 1.8, 2.6, 0.6) + rr(GATE[1] + 6.1, DY - 8, 1.8, 2.6, 0.6);
    const pole = R0(GATE[1] + 6.7, DY - 25, 0.7, 8.6);
    const flag = `M${pt(GATE[1] + 7.4, DY - 25)}L${pt(GATE[1] + 13.4, DY - 23.6)}L${pt(GATE[1] + 7.4, DY - 21.6)}Z`;
    o += shadowOf(towers + flag) + fill(towers, "stone") + fill(R0(GATE[1] + 8.4, DY - 17, 2.6, 17) + R0(DX0 + 4.6, DY - 15, 2.2, 15), "stone-dk");
    o += fill(pole, "wood-dk") + fill(flag, `roof-${lv}`) + fill(tw, "win") + night(line(tw, "lamp", 1.4, ' opacity=".5"'));
  }
  return o;
}

// A rope ferry: a post on each bank, the rope sagging between, and a raft hung from it.
function ferry() {
  const posts = R0(96.4, 38.6, 1.8, 10.4) + R0(141.8, 38.6, 1.8, 10.4);
  const rope = "M97.3 40Q120 47 142.7 40";
  let o = shadowOf(posts) + fill(posts, "wood-dk") + fill(dot(97.3, 38.6, 1.3) + dot(142.7, 38.6, 1.3), "wood");
  o += line(rope, "rope", 0.9, ' stroke-dasharray="1.4 0.7"');
  const raft = rr(108, 52.4, 24, 3, 1.2), side = rr(108.6, 54.6, 22.8, 1.8, 0.9);
  const planks = R0(113.6, 52.6, 0.4, 2.6) + R0(119.6, 52.6, 0.4, 2.6) + R0(125.6, 52.6, 0.4, 2.6);
  const lamp = rr(127.6, 47, 2.6, 3.2, 1);
  const raftG = line("M120 52.6V43.4", "rope", 0.6) + shadowOf(raft) + fill(side, "wood-dk") + fill(raft, "wood") + fill(planks, "wood-dk") +
    fill(R0(128.5, 49.6, 0.7, 3.2), "wood-dk") + night(fill(dot(128.9, 48.6, 4.6), "lamp", ' opacity=".22"')) + fill(lamp, "lantern") +
    line(ripple(104, 57.2, 6) + ripple(130, 57.6, 7), "wave", 0.7, ' stroke-linecap="round"');
  return `<g class="sc-b-ferry">${o}<g class="sc-b-raft">${raftG}</g></g>`;
}

// The stone bridge: abutments on both banks, two arches, a deck and parapet, two lanterns.
function bridge() {
  const face = R0(93, 44.6, 54, 10.4) + archHole(101.4, 46.6, 17.6, 9.4) + archHole(121, 46.6, 17.6, 9.4);
  const ends = poly([[86, 49], [93, 44.6], [93, 55], [88, 54]]) + poly([[154, 49], [147, 44.6], [147, 55], [152, 54]]);
  const deck = R0(88, 41.6, 64, 3.2);
  let parapet = "";
  for (let x = 90; x <= 148; x += 4.4) parapet += R0(x, 39.4, 2.6, 2.4);
  parapet += R0(89, 41, 62, 1);
  let stones = "";
  const ring = (cx) => {
    const k = 7;
    for (let i = 0; i < k; i++) stones += piece(fill(voussoir(cx, 55.4, 9.2, 11.6, 180 + (180 * i) / k + 1.4, 180 + (180 * (i + 1)) / k - 1.4), "stone-dk"), 2 + i);
  };
  ring(110.2);
  ring(129.8);
  const courses = R0(93.6, 47.4, 7.2, 0.45) + R0(139.2, 47.4, 7.2, 0.45) + R0(93.6, 50.6, 7, 0.45) + R0(139.4, 50.6, 7, 0.45) + R0(118.6, 50, 2.8, 0.45);
  const lamp = (x) => {
    const post = R0(x - 0.7, 31.4, 1.4, 8.4), body = rr(x - 2, 26.6, 4, 5, 1.6), cap = rr(x - 2.4, 25.8, 4.8, 1.2, 0.5);
    return `<g class="sc-b-lamp">` + night(fill(dot(x, 29, 9), "lamp", ' opacity=".12"') + fill(dot(x, 29, 5.4), "lamp", ' opacity=".22"')) +
      shadowOf(post + body) + fill(post, "wood-dk") + fill(body, "lantern") + fill(cap, "wood-dk") + night(line(body, "lamp", 1.4, ' opacity=".55"')) + "</g>";
  };
  return `<g class="sc-b-bridge">` +
    piece(shadowOf(face + ends, 1.3) + fill(ends, "stone-dk") + fill(face, "stone") + fill(courses, "stone-line"), 0) +
    stones +
    piece(shadowOf(deck) + fill(deck, "stone") + fill(R0(88, 43.6, 64, 1.2), "stone-dk"), 10) +
    piece(fill(parapet, "stone"), 11) +
    lamp(91.4) + lamp(148.6) + "</g>";
}

// A market stall on their landing: posts, a counter of glass, cloth and papyrus, a striped awning.
function stall() {
  const x = 62, w = 19, yb = 58, top = yb - 12.6;
  const posts = R0(x + 0.6, top + 2, 1.4, 11) + R0(x + w - 2, top + 2, 1.4, 11);
  const counter = R0(x - 0.4, yb - 5, w + 0.8, 5);
  const wares = rr(x + 2.6, yb - 8.6, 2.4, 3.8, 1) + dot(x + 3.8, yb - 9.2, 0.7);
  const cloth = poly([[x + 7, yb - 5], [x + 7.6, yb - 8.4], [x + 12, yb - 8.4], [x + 11.4, yb - 5]]);
  const scroll = rr(x + 13.4, yb - 7.8, 4.6, 2.8, 1.4);
  let awning = `M${pt(x - 1.6, top + 3)}L${pt(x + 1, top - 1.4)}H${n(x + w - 1)}L${pt(x + w + 1.6, top + 3)}`, stripes = "";
  const k = 5, sw = (w + 3.2) / k;
  for (let i = 0; i < k; i++) awning += `A${n(sw / 2)} ${n(sw / 2)} 0 0 1 ${pt(x + w + 1.6 - sw * (i + 1), top + 3)}`;
  awning += "Z";
  for (let i = 0; i < k; i += 2) stripes += poly([[x - 1.6 + sw * i, top + 3], [x + 1 + ((w - 2) / k) * i, top - 1.4], [x + 1 + ((w - 2) / k) * (i + 1), top - 1.4], [x - 1.6 + sw * (i + 1), top + 3]]) + `M${pt(x - 1.6 + sw * i, top + 3)}A${n(sw / 2)} ${n(sw / 2)} 0 0 0 ${pt(x - 1.6 + sw * (i + 1), top + 3)}Z`;
  return `<g class="sc-b-stall">` +
    piece(shadowOf(posts) + fill(posts, "wood-dk"), 0) +
    piece(shadowOf(counter) + fill(counter, "wood") + fill(R0(x - 0.4, yb - 5, w + 0.8, 1.1), "wood-dk"), 1) +
    piece(shadowOf(awning, 0.8) + fill(awning, "cream") + fill(stripes, "awning"), 2, ' data-unroll=""') +
    piece(fill(wares, "glass") + fill(cloth, "cloth") + fill(scroll, "papyrus") + fill(R0(x + 15.4, yb - 7.8, 0.6, 2.8), "papyrus-dk"), 3) +
    "</g>";
}

// Places that explain themselves (the view's tips): the crossing and each bank's defences.
const hot = (x, y, w, h, tip, extra = "") => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" class="sc-b-hot" data-tip="${tip}"${extra}/>`;

export const wallLevel = (s) => (s <= 0 ? 0 : s <= 2 ? 1 : s <= 5 ? 2 : 3);
const WALL_WORDS = ["open ground", "a palisade", "a stone wall", "a wall with towers"];

// The border as markup: side "left" puts their bank on the left; raw and
// goods are the prices you pay them a unit (1 lays the bridge or the stall);
// walls are the shields on [their, your] bank; seats colour each bank's roofs.
export function borderSvg({ side = "left", raw = 2, goods = 2, walls = [0, 0], seats = [1, 0] } = {}) {
  const right = side === "right";
  const [lt, lm] = walls.map((s) => wallLevel(Number(s) || 0));
  const seat = (p) => (Number.isInteger(p) && p >= 0 && p < 7 ? p : 0);
  const label = `${raw === 1 ? "A stone bridge" : "A rope ferry"}${goods === 1 ? " and a market stall" : ""} across the river; ${WALL_WORDS[lt]} on their bank, ${WALL_WORDS[lm]} on yours`;
  const art =
    sky() +
    shadowOf(hill(-2, BW + 2, 31, [6, 11, 5, 9, 7, 10], BH + 2)) + fill(hill(-2, BW + 2, 31, [6, 11, 5, 9, 7, 10], BH + 2), "far2") +
    fill(hill(-2, BW + 2, 34, [4, 6, 3, 7, 4, 5, 3], BH + 2), "far") +
    fill(WATER, "water") + fill(SHINE, "water-lt") + line(WAVES, "wave", 0.8, ' stroke-linecap="round"') +
    bank("them", lt) +
    `<g transform="matrix(-1 0 0 1 ${BW} 0)">${bank("me", lm)}</g>` +
    (raw === 1 ? bridge() : ferry()) +
    (goods === 1 ? stall() : "") +
    hot(DX0 - 4, 22, DX1 - DX0 + 8, 30, "wall", ` data-tip-side="${side}" data-tip-bank="theirs"`) +
    hot(mirror(DX1) - 4, 22, DX1 - DX0 + 8, 30, "wall", ` data-tip-side="${side}" data-tip-bank="mine"`) +
    hot(92, 34, 56, 26, "crossing", ` data-tip-side="${side}"`);
  return `<svg class="sc-border-svg sc-b-${right ? "right" : "left"} sc-b-them-${seat(seats[0])} sc-b-me-${seat(seats[1])}" viewBox="0 0 ${BW} ${BH}" preserveAspectRatio="xMidYMax meet" role="img" aria-label="${label}">` +
    (right ? `<g transform="matrix(-1 0 0 1 ${BW} 0)">${art}</g>` : art) + "</svg>";
}

// ---------- facts ----------
const finishedAges = (state) => (state.phase === "over" ? 3 : Math.max(0, (state.age | 0) - 1));
const candidates = new Map();
// Every result of one war round a ring of n seats: e[p] compares p with p + 1.
// Shields are one number a seat, so going round the ring the comparisons
// either all tie or rise somewhere and fall somewhere.
function edgeResults(np) {
  if (candidates.has(np)) return candidates.get(np);
  const out = [];
  for (let k = 0; k < 3 ** np; k++) {
    const e = Array.from({ length: np }, (_, i) => (Math.floor(k / 3 ** i) % 3) - 1);
    const up = e.includes(1), down = e.includes(-1);
    if (up === down) out.push(e);
  }
  candidates.set(np, out);
  return out;
}

// Each finished war, read back from the tokens alone (the rules push a
// seat's left result, then its right one, skipping draws; a win is worth
// 1, 3 or 5 by age, a loss −1): [age][seat] = [left, right], each 1, 0 or −1,
// or null where the tokens could have come from more than one war. That
// happens, rarely, with four or more seats (two seats losing everything in
// two ages, say), so a caller that saw the rules' war events passes them.
export function warResults(state) {
  const np = state.players, ages = finishedAges(state), tokens = state.tokens;
  const sols = [];
  const cands = edgeResults(np);
  const walk = (a, pos, acc) => {
    if (sols.length > 64) return;
    if (a === ages) {
      if (pos.every((i, p) => i === tokens[p].length)) sols.push(acc);
      return;
    }
    for (const e of cands) {
      const next = pos.slice();
      let ok = true;
      for (let p = 0; p < np && ok; p++) {
        for (const r of [e[p], -e[(p + np - 1) % np]]) {
          if (!r) continue;
          if (tokens[p][next[p]] !== (r > 0 ? VICTORY[a] : DEFEAT)) { ok = false; break; }
          next[p]++;
        }
      }
      if (ok) walk(a + 1, next, [...acc, e]);
    }
  };
  walk(0, Array(np).fill(0), []);
  const sides = (e, p) => [e[p], -e[(p + np - 1) % np] || 0];
  return Array.from({ length: ages }, (_, a) =>
    Array.from({ length: np }, (_, p) =>
      [0, 1].map((k) => {
        const seen = new Set(sols.map((s) => sides(s[a], p)[k]));
        return seen.size === 1 ? [...seen][0] : null;
      }),
    ),
  );
}

// The three age flags of p's border on `side`: 1 won, 0 a draw, −1 lost,
// null to come (or unreadable). wars: the results of the rules' war events
// by age, where known; they win over the tokens.
export function borderFlags(state, p, side, wars = []) {
  const k = side === "right" ? 1 : 0, done = finishedAges(state);
  const read = wars.length >= done ? [] : warResults(state);
  return [0, 1, 2].map((a) => (a < done ? (wars[a]?.[p]?.[k] ?? read[a]?.[p]?.[k] ?? null) : null));
}

// From turn 5 of an age: how p stands against that neighbour's shields.
export function warnWords(state, me, side) {
  if (!state.age || state.phase === "over" || state.round < Math.min(5, ROUNDS)) return null;
  const q = side === "left" ? leftOf(state, me) : rightOf(state, me);
  const d = shields(state, me) - shields(state, q);
  return d < 0 ? `you trail by ${-d}` : d > 0 ? `you lead by ${d}` : "level";
}

// Everything the strip shows for p's border on `side`, from the public state.
// sale: what that neighbour sells, each unit a list of resources. wars: as
// for borderFlags.
export function borderFacts(state, me, side, { wars = [] } = {}) {
  const q = side === "left" ? leftOf(state, me) : rightOf(state, me);
  return {
    side,
    seat: q,
    me,
    raw: unitPrice(state, me, 0, side),
    goods: unitPrice(state, me, 4, side),
    sale: production(state, q).sale,
    shields: { mine: shields(state, me), theirs: shields(state, q) },
    flags: borderFlags(state, me, side, wars),
    warn: warnWords(state, me, side),
  };
}

// A sale's units grouped: [{ u: [r…], n }], alike units (the same resource,
// or the same choice) counted together.
export function saleGroups(units = []) {
  const groups = [];
  for (const u of units) {
    const key = u.join("/");
    const g = groups.find((x) => x.key === key);
    if (g) g.n++;
    else groups.push({ key, u, n: 1 });
  }
  return groups;
}
const saleWords = (groups) => (groups.length ? groups.map((g) => `${g.n > 1 ? `${g.n} × ` : ""}${g.u.map((r) => RESOURCE_NAMES[r]).join(" or ")}`).join(", ") : "nothing");

// ---------- the component ----------
const FLAG_WORDS = { 1: "you won", 0: "a draw", "-1": "you lost", null: "to come" };
const ROMAN = ["I", "II", "III"];
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const finished = (anims) => Promise.all(anims.map((a) => a.finished.catch(() => {})));

// borderView({ side, kit, sound }) → { node, sells, update(facts), cart({ resources, coins }), lay(kind), expect(kind) }.
// update takes borderFacts' fields plus name (the neighbour's) and sells: a
// node (the compact sale shelf) or, failing that, the sale units.
export function borderView({ side = "left", kit = {}, sound = () => {} } = {}) {
  const right = side === "right";
  const art = el("div", { class: "sc-border-art", "aria-hidden": "true" });
  const fx = el("div", { class: "sc-border-fx", "aria-hidden": "true" });
  const sign = el("div", { class: "sc-border-sign", "data-tip": "price", "data-tip-side": side, tabindex: "0" });
  const flags = el("div", { class: "sc-border-flags", "data-tip": "flags", "data-tip-side": side, tabindex: "0", role: "img" });
  const badge = (bank) => el("span", { class: `sc-border-shield ${bank}`, "data-tip": "wall", "data-tip-side": side, "data-tip-bank": bank, tabindex: "0", role: "img" });
  const theirsB = badge("theirs"), mineB = badge("mine");
  const tally = el("div", { class: "sc-border-tally" }, theirsB, mineB);
  const warn = el("div", { class: "sc-border-warn", "data-tip": "warn", "data-tip-side": side, tabindex: "0", hidden: true });
  const sells = el("div", { class: "sc-border-sells", "data-tip": "sells", "data-tip-side": side, tabindex: "0" });
  const ui = el("div", { class: "sc-border-ui" }, sign, flags, tally, el("div", { class: "sc-border-foot" }, sells, warn));
  const node = el("div", { class: `sc-border sc-border-${right ? "right" : "left"}`, "data-side": side, role: "group" }, art, ui, fx);
  let facts = { name: "", raw: 2, goods: 2, shields: { mine: 0, theirs: 0 }, flags: [null, null, null], warn: null, seat: right ? 2 : 1, me: 0 };
  let drawn = "";
  let queue = Promise.resolve();
  let pending = null;
  // A bridge or stall about to be laid (expect()): the strip shows the old
  // crossing and prices until lay() builds it.
  const expecting = new Set();
  const rawOf = () => (expecting.has("bridge") ? Math.max(2, facts.raw) : facts.raw);
  const goodsOf = () => (expecting.has("stall") ? Math.max(2, facts.goods) : facts.goods);

  const draw = () => {
    const key = [rawOf(), goodsOf(), wallLevel(facts.shields.theirs), wallLevel(facts.shields.mine), facts.seat, facts.me].join();
    if (key === drawn) return;
    drawn = key;
    art.innerHTML = borderSvg({ side, raw: rawOf(), goods: goodsOf(), walls: [facts.shields.theirs, facts.shields.mine], seats: [facts.seat, facts.me] });
  };
  const coinOf = () => (kit.coinEl ? kit.coinEl() : el("span", { class: "sc-border-coin" }));
  const priceRow = (label, v) => el("span", { class: "sc-border-price" }, label ? el("small", {}, label) : null, el("b", {}, String(v)), coinOf());

  function update(data = {}) {
    facts = { ...facts, ...data, shields: { ...facts.shields, ...(data.shields || {}) } };
    const who = facts.name || "your neighbour";
    node.setAttribute("aria-label", `Your ${side} border, with ${who}`);
    draw();
    const raw = rawOf();
    const goods = goodsOf();
    sign.classList.toggle("split", raw !== goods);
    sign.replaceChildren(...(raw === goods ? [priceRow("", raw), el("span", { class: "sc-border-each" }, "each")] : [priceRow("raw", raw), priceRow("goods", goods)]));
    sign.setAttribute("aria-label", raw === goods ? `${raw} coin${raw === 1 ? "" : "s"} a resource from ${who}` : `From ${who}: raw materials ${raw} coin${raw === 1 ? "" : "s"} each, goods ${goods} coin${goods === 1 ? "" : "s"} each`);
    const fl = (facts.flags || []).slice(0, 3);
    while (fl.length < 3) fl.push(null);
    flags.replaceChildren(...fl.map((f) => el("i", { class: f === 1 ? "won" : f === -1 ? "lost" : f === 0 ? "draw" : "open" })));
    flags.dataset.tipResults = fl.map((f) => (f === null || f === undefined ? "" : String(f))).join(",");
    flags.setAttribute("aria-label", "War on this border: " + fl.map((f, a) => `age ${ROMAN[a]} ${FLAG_WORDS[f ?? null]}`).join(", "));
    const { mine, theirs } = facts.shields;
    const fillBadge = (b, v, whose) => {
      b.replaceChildren(kit.shieldEl ? kit.shieldEl() : el("span"), el("b", {}, String(v)));
      b.setAttribute("aria-label", `${whose} ${v} shield${v === 1 ? "" : "s"}`);
    };
    fillBadge(theirsB, theirs, `${who}:`);
    fillBadge(mineB, mine, "You:");
    tally.classList.toggle("ahead", theirs > mine);
    tally.classList.toggle("behind", theirs < mine);
    warn.hidden = !facts.warn;
    warn.textContent = facts.warn || "";
    warn.className = "sc-border-warn " + (/trail/.test(facts.warn) ? "trail" : /lead/.test(facts.warn) ? "lead" : "level");
    const s = data.sells;
    if (s instanceof Node) { if (sells.firstChild !== s || sells.childNodes.length !== 1) sells.replaceChildren(s); }
    else if (Array.isArray(s) || (s === undefined && Array.isArray(data.sale))) drawSale(s ?? data.sale);
    sells.setAttribute("aria-label", `What ${who} sells you: ${saleWords(saleGroups(saleShown))}`);
  }

  // What they sell, one slim line on their bank: alike units counted (×n),
  // a choice as "a / b"; what doesn't fit becomes "+n" (the tip lists it all).
  let saleShown = [];
  let saleKey = "";
  const more = el("span", { class: "sc-border-more", "aria-hidden": "true" });
  const icon = (r) => (kit.resEl ? kit.resEl(r) : el("span", {}, RESOURCE_NAMES[r]));
  function drawSale(units) {
    const key = JSON.stringify(units);
    if (key === saleKey) return;
    saleKey = key;
    saleShown = units;
    const groups = saleGroups(units);
    sells.replaceChildren(
      ...(groups.length
        ? groups.map((g) =>
            el(
              "span",
              { class: "sc-border-unit" + (g.u.length > 1 ? " either" : ""), dataset: { n: String(g.n) } },
              ...g.u.flatMap((r, j) => (j ? [el("i", { class: "sc-border-or" }, "/"), icon(r)] : [icon(r)])),
              g.n > 1 ? el("small", {}, `×${g.n}`) : null,
            ),
          )
        : [el("span", { class: "sc-border-none" }, "sells nothing")]),
      more,
    );
    fit();
  }
  // Hides the units past the line's end, from the last, and counts them on "+n".
  function fit() {
    const items = [...sells.querySelectorAll(".sc-border-unit")];
    items.forEach((x) => (x.hidden = false));
    more.hidden = true;
    if (!sells.clientWidth) return;
    let gone = 0;
    for (let i = items.length - 1; i > 0 && sells.scrollWidth > sells.clientWidth + 1; i--) {
      items[i].hidden = true;
      gone += Number(items[i].dataset.n);
      more.textContent = `+${gone}`;
      more.hidden = false;
    }
  }
  if (typeof ResizeObserver === "function") {
    let w = 0;
    new ResizeObserver(() => {
      if (sells.clientWidth !== w) (w = sells.clientWidth), fit();
    }).observe(sells);
  }

  // The fx layer: an empty scene of the same viewBox over the art, never mirrored (X() mirrors positions instead).
  const svgOf = () => fx.querySelector("svg");
  const ensureFx = () => {
    if (!svgOf()) fx.innerHTML = `<svg viewBox="0 0 ${BW} ${BH}" preserveAspectRatio="xMidYMax meet"></svg>`;
    return svgOf();
  };
  const X = (x) => (right ? mirror(x) : x);
  const NS = "http://www.w3.org/2000/svg";
  const g = (markup, cls) => {
    const node = document.createElementNS(NS, "g");
    node.setAttribute("class", cls);
    node.innerHTML = markup;
    return node;
  };
  // The cart, drawn heading +x, wheels at 0: a box on two wheels with its load piled on top.
  function cartMarkup(resources, out = false) {
    const body = rr(-8, -8.4, 16, 5.4, 1.3), side2 = rr(-7.4, -4.6, 14.8, 1.5, 0.7), shaft = `M8 -5L13 -3.6L12.8 -2.8L7.8 -3.9Z`;
    const wheels = dot(-4.6, -2.1, 2.1) + dot(4.6, -2.1, 2.1);
    const flip = right !== out ? ' transform="scale(-1 1)"' : "";
    let o = `<g${flip}>` + shadowOf(body + wheels) + fill(shaft, "wood-dk") + fill(body, "wood") + fill(side2, "wood-dk") + fill(wheels, "wood-dk") + fill(dot(-4.6, -2.1, 0.7) + dot(4.6, -2.1, 0.7), "wood") + "</g>";
    const load = resources.slice(0, resources.length > 4 ? 3 : 4);
    const sz = 9;
    load.forEach((r, i) => {
      const row = i < 2 ? 0 : 1, inRow = row ? load.length - 2 : Math.min(2, load.length), j = row ? i - 2 : i;
      o += place(resourceIcon(r), (j - (inRow - 1) / 2) * (sz - 0.8), -12.4 - row * (sz - 2), sz);
    });
    if (resources.length > 4) o += `<g><path d="${rr(5, -24, 10, 6.6, 3.3)}" class="sc-bf-cream"/><text x="10" y="-19" font-size="5" text-anchor="middle" class="sc-b-text">+${resources.length - 3}</text></g>`;
    return o;
  }

  // out: a purchase the neighbour made from you, the cart going to them and their coins coming to you.
  async function run({ resources = [], coins: paid = 0, out = false }) {
    if (!resources.length && !paid) return;
    sound("cart", { n: resources.length, coins: paid });
    if (reducedMotion()) return;
    const svg = ensureFx();
    const bridgeUp = rawOf() === 1;
    const dur = bridgeUp ? 1700 : 2500;
    const cart = g(`<g transform="scale(1.3)">${cartMarkup(resources, out)}</g>`, "sc-b-cart");
    svg.append(cart);
    const path = bridgeUp
      ? [[80, 47, 0], [93, 41.6, 0.16], [147, 41.6, 0.82], [160, 47, 1]]
      : [[84, 51, 0], [97, 51, 0.12], [112, 53.4, 0.24], [128, 53.4, 0.72], [143, 51, 0.86], [156, 51, 1]];
    if (out) path.reverse().forEach((pt) => (pt[2] = 1 - pt[2]));
    const frames = path.map(([x, y, o], i) => ({ transform: `translate(${n(X(x))}px, ${n(y)}px)`, opacity: i === 0 || i === path.length - 1 ? 0 : 1, offset: o }));
    frames[1].opacity = 1;
    const anims = [cart.animate(frames, { duration: dur, easing: "ease-in-out", fill: "both" })];
    const raft = art.querySelector(".sc-b-raft");
    if (!bridgeUp && raft)
      anims.push(raft.animate([{ transform: "translateX(0)" }, { transform: `translateX(${out ? 8 : -8}px)`, offset: 0.14 }, { transform: `translateX(${out ? 8 : -8}px)`, offset: 0.24 }, { transform: `translateX(${out ? -8 : 8}px)`, offset: 0.72 }, { transform: `translateX(${out ? -8 : 8}px)`, offset: 0.84 }, { transform: "translateX(0)" }], { duration: dur, easing: "ease-in-out" }));
    // The coins arc the other way, from your bank to theirs.
    const k = Math.min(6, Math.max(paid ? 1 : 0, paid));
    for (let i = 0; i < k; i++) {
      const c = g(place(coinSvg(1), 0, 0, 7.4), "sc-b-coin");
      svg.append(c);
      const pts = Array.from({ length: 9 }, (_, j) => {
        const t = j / 8, x = out ? 68 + (172 - 68) * t : 172 + (68 - 172) * t, y = 38 - 16 * 4 * t * (1 - t) + (i % 2) * 1.5;
        return { transform: `translate(${n(X(x))}px, ${n(y)}px)`, opacity: j === 0 ? 0 : j === 8 ? 0 : 1, offset: t };
      });
      anims.push(c.animate(pts, { duration: dur * 0.62, delay: dur * 0.2 + i * 110, easing: "ease-in-out", fill: "both" }));
    }
    await finished(anims);
    for (const a of anims) a.cancel();
    svg.replaceChildren();
  }

  // Several purchases asked for in one turn travel as one cart.
  function cart(load = {}) {
    if (load.out) return (queue = queue.then(() => run({ ...load, out: true })));
    if (pending) {
      pending.resources.push(...(load.resources || []));
      pending.coins += load.coins || 0;
      return pending.done;
    }
    const p = { resources: [...(load.resources || [])], coins: load.coins || 0 };
    pending = p;
    p.done = queue = queue.then(() => wait(0)).then(() => {
      pending = null;
      return run(p);
    });
    return p.done;
  }

  // Builds the bridge or the stall in: stones drop into the arches and the lanterns light, or the stall goes up and its awning unrolls.
  function lay(kind) {
    return (queue = queue.then(async () => {
      expecting.delete(kind);
      if (kind === "bridge" && facts.raw !== 1) update({ raw: 1 });
      else if (kind === "stall" && facts.goods !== 1) update({ goods: 1 });
      else update({});
      const root = art.querySelector(kind === "bridge" ? ".sc-b-bridge" : ".sc-b-stall");
      if (!root) return;
      sound("lay", { kind });
      if (reducedMotion()) return;
      const anims = [];
      if (kind === "bridge") {
        const ferryG = art.querySelector(".sc-b-ferry");
        if (ferryG) ferryG.remove();
        root.querySelectorAll(".sc-b-pc").forEach((p) => {
          const i = Number(p.style.getPropertyValue("--i")) || 0;
          anims.push(p.animate([{ transform: "translateY(-14px)", opacity: 0 }, { transform: "translateY(1px)", opacity: 1, offset: 0.8 }, { transform: "none", opacity: 1 }], { duration: 380, delay: i * 85, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "backwards" }));
        });
        root.querySelectorAll(".sc-b-lamp").forEach((l, i) => anims.push(l.animate([{ opacity: 0, transform: "scale(0.4)" }, { opacity: 1, transform: "scale(1.15)", offset: 0.6 }, { opacity: 1, transform: "none" }], { duration: 420, delay: 1100 + i * 160, easing: "ease-out", fill: "backwards" })));
      } else {
        root.querySelectorAll(".sc-b-pc").forEach((p) => {
          const i = Number(p.style.getPropertyValue("--i")) || 0;
          const unroll = p.hasAttribute("data-unroll");
          anims.push(p.animate(unroll ? [{ transform: "scaleY(0)" }, { transform: "scaleY(1.08)", offset: 0.75 }, { transform: "none" }] : [{ transform: "scaleY(0)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: unroll ? 460 : 300, delay: i * 180, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "backwards" }));
        });
      }
      await finished(anims);
    }));
  }

  update({});
  // A lay that never comes (the table moved on) lets the strip catch up anyway.
  function expect(kind) {
    expecting.add(kind);
    setTimeout(() => expecting.delete(kind) && update({}), 8000);
  }
  return { node, sells, update, cart, lay, expect };
}
