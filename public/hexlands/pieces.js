// Hexlands' pieces, painted like little wooden toys: number tokens, roads,
// settlements, cities, the robber, the dice and the spots a player can tap.
// Each returns SVG markup in board units (a hex radius is 100), placed by
// board.js; pieces.css paints them, a seat's colour coming from its p-<seat>
// class. Every seat also carries a mark (none, dots, a stripe, chevrons) so
// no two seats differ by hue alone. Pure: no DOM.
import { HEXES, CORNERS, EDGES, pips } from "./board.js";

const U = 100;
const n = (v) => String(Math.round(v * 100) / 100);
const pt = (x, y) => `${n(x)} ${n(y)}`;
const polyD = (pts) => "M" + pts.map(([x, y]) => pt(x, y)).join("L") + "Z";
const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

// The oblique depth of every building: its side and roof recede up and right.
const DEPTH = 0.64;

// One building block: a gabled front, a side and a roof plane, standing on y = base.
function block(x0, w, h, gable, dz, base) {
  const x1 = x0 + w, xm = x0 + w / 2, top = base - h, k = dz * DEPTH;
  const ridge = [xm, top - gable], back = [xm + dz, top - gable - k], eave = [x1, top];
  return {
    front: polyD([[x0, base], [x1, base], eave, ridge, [x0, top]]),
    side: polyD([[x1, base], [x1 + dz, base - k], [x1 + dz, top - k], eave]),
    roof: polyD([ridge, back, [x1 + dz, top - k], eave]),
    outline: polyD([[x0, base], [x1, base], [x1 + dz, base - k], [x1 + dz, top - k], back, ridge, [x0, top]]),
    glow: polyD([[x0, base], [x0 + w * 0.32, base], [x0 + w * 0.32, top - gable * 0.64], [x0, top]]),
    shine: `M${pt(x0 + 1.6, top - 0.6)}L${pt(...lerp(ridge, [x0, top], 0.14))}M${pt(...lerp(ridge, back, 0.12))}L${pt(...lerp(ridge, back, 0.85))}`,
    plane: { ridge, back, eave },
  };
}

// A point on a roof plane: u runs along the ridge, v down to the eave.
const onRoof = ({ ridge, back, eave }, u, v) => [ridge[0] + (back[0] - ridge[0]) * u + (eave[0] - ridge[0]) * v, ridge[1] + (back[1] - ridge[1]) * u + (eave[1] - ridge[1]) * v];

function roofMark(seat, plane) {
  const at = (u, v) => pt(...onRoof(plane, u, v));
  if (seat === 1) {
    const [x, y] = onRoof(plane, 0.5, 0.48);
    return `<circle class="hx-mark" cx="${n(x)}" cy="${n(y)}" r="3.4"/>`;
  }
  if (seat === 2) return `<path class="hx-mark" d="M${at(0, 0.36)}L${at(1, 0.36)}L${at(1, 0.64)}L${at(0, 0.64)}Z"/>`;
  if (seat === 3) return `<path class="hx-mark-line" d="M${at(0.12, 0.2)}L${at(0.5, 0.8)}L${at(0.88, 0.2)}"/>`;
  return "";
}

const seatOf = (seat) => Math.max(0, Math.min(3, seat | 0));

function building(kind, attrs, x, y, seat, body) {
  return `<g class="hx-piece hx-${kind} p-${seat}" ${attrs} transform="translate(${pt(x, y)})"><g class="hx-art">${body}</g></g>`;
}

function blocksArt(blocks, shadow) {
  const halo = blocks.map((b) => `<path class="hx-halo" d="${b.outline}"/>`).join("");
  return (
    halo +
    `<ellipse class="hx-shadow" cx="${n(shadow[0])}" cy="${n(shadow[1])}" rx="${n(shadow[2])}" ry="${n(shadow[2] * 0.28)}"/>` +
    blocks.map((b) => `<path class="hx-side" d="${b.side}"/><path class="hx-roof" d="${b.roof}"/><path class="hx-front" d="${b.front}"/><path class="hx-glow" d="${b.glow}"/><path class="hx-shine" d="${b.shine}"/>${b.extra || ""}`).join("")
  );
}

// A small house, centred on its corner.
export function settlementSvg(corner, seat) {
  const c = CORNERS[corner];
  seat = seatOf(seat);
  const b = block(-15.5, 24, 14.5, 13, 8.5, 14.5);
  b.extra = `<path class="hx-door" d="M-6.7 14.5V10.6Q-6.7 7.4 -3.5 7.4Q-0.3 7.4 -0.3 10.6V14.5Z"/>` + roofMark(seat, b.plane);
  return building("settlement", `data-corner="${corner}"`, c.x * U, c.y * U, seat, blocksArt([b], [1.5, 15.2, 21]));
}

// A tall keep with a pennant beside a long hall: bigger than a house and a different shape.
export function citySvg(corner, seat) {
  const c = CORNERS[corner];
  seat = seatOf(seat);
  const tower = block(-25, 17, 36, 17, 8.5, 17);
  const hall = block(-8, 26, 18, 11, 9.5, 17);
  tower.extra =
    `<path class="hx-window" d="M-19.9 -1V-6Q-19.9 -9.6 -16.5 -9.6Q-13.1 -9.6 -13.1 -6V-1Z"/>` +
    `<path class="hx-pole" d="M-16.5 -36V-51"/><path class="hx-flag" d="M-15.8 -51L-4 -47.2L-15.8 -43.4Z"/>`;
  hall.extra = `<path class="hx-door" d="M1.6 17V12.4Q1.6 9 5 9Q8.4 9 8.4 12.4V17Z"/>` + roofMark(seat, hall.plane);
  return building("city", `data-corner="${corner}"`, c.x * U, c.y * U, seat, blocksArt([tower, hall], [1.5, 17.6, 30]));
}

const ROAD = { len: 66, h: 12.5, lift: 3.8 };

function roadMark(seat) {
  if (seat === 1) return [-18, 0, 18].map((x) => `<circle class="hx-mark" cx="${x}" cy="0.6" r="2"/>`).join("");
  if (seat === 2) return `<path class="hx-mark-line" d="M-23 0.8H23"/>`;
  if (seat === 3) return `<path class="hx-mark-line" d="M-14 -2.6L-9 0.8L-14 4.2M5 -2.6L10 0.8L5 4.2"/>`;
  return "";
}

// A wooden bar lying along its edge, from one corner towards the other.
export function roadSvg(edge, seat) {
  const e = EDGES[edge];
  const a = CORNERS[e.a], b = CORNERS[e.b];
  seat = seatOf(seat);
  const th = Math.atan2(b.y - a.y, b.x - a.x);
  // The side shows below the top in screen space, whatever the road's angle.
  const down = (d) => `translate(${pt(d * Math.sin(th), d * Math.cos(th))})`;
  const { len, h, lift } = ROAD;
  const bar = (cls, extra = "") => `<rect class="${cls}" x="${-len / 2}" y="${-h / 2}" width="${len}" height="${h}" rx="${h / 2}" ${extra}/>`;
  const body =
    bar("hx-halo") +
    bar("hx-shadow", `transform="${down(lift + 3)}"`) +
    bar("hx-side", `transform="${down(lift)}"`) +
    bar("hx-front") +
    `<path class="hx-shine" d="M${-len / 2 + 6} -2.3H${len / 2 - 6}"/>` +
    roadMark(seat);
  return `<g class="hx-piece hx-road p-${seat}" data-edge="${edge}" transform="translate(${pt(e.x * U, e.y * U)}) rotate(${n((th * 180) / Math.PI)})"><g class="hx-art">${body}</g></g>`;
}

// A number token: a cream disc, the number in the display font, its pips; 6 and 8 in red.
export function tokenSvg(number, hex) {
  const h = HEXES[hex];
  const red = number === 6 || number === 8;
  const k = pips(number);
  let dots = "";
  for (let i = 0; i < k; i++) dots += `<circle cx="${n((i - (k - 1) / 2) * 6.4)}" cy="18.5" r="2.5"/>`;
  return (
    `<g class="hx-token${red ? " hx-hot" : ""}" data-hex="${hex}" data-number="${number}" transform="translate(${pt(h.x * U, h.y * U)})"><g class="hx-art">` +
    `<ellipse class="hx-shadow" cx="2" cy="6" rx="34" ry="31"/>` +
    `<circle class="hx-token-face" r="33"/>` +
    `<path class="hx-token-shine" d="M-24.5 -10A26.5 26.5 0 0 1 -6 -26"/>` +
    `<circle class="hx-token-ring" r="28.4"/>` +
    `<text class="hx-num" y="${red ? 9 : 8}" font-size="${red ? 33 : 30}" font-weight="${red ? 700 : 600}" text-anchor="middle">${number}</text>` +
    `<g class="hx-pips">${dots}</g></g></g>`
  );
}

// The robber: a hooded bandit with a sack, standing beside the hex's token.
export function robberSvg(hex, from = null) {
  const h = HEXES[hex];
  const x = h.x * U + 50, y = h.y * U + 6;
  const hop = from === null ? "" : ` style="--hx-dx: ${n((HEXES[from].x - h.x) * U)}px; --hx-dy: ${n((HEXES[from].y - h.y) * U)}px"`;
  return (
    `<g class="hx-robber${from === null ? "" : " hx-hop"}" data-hex="${hex}" transform="translate(${pt(x, y)})"${hop}>` +
    `<radialGradient id="hx-robber-cloak" cx=".34" cy=".26" r=".85"><stop class="hx-rb-hi" offset="0"/><stop class="hx-rb-mid" offset=".55"/><stop class="hx-rb-lo" offset="1"/></radialGradient>` +
    `<ellipse class="hx-shadow hx-rb-shadow" cx="3" cy="25" rx="21" ry="6"/>` +
    `<g class="hx-rb-fig">` +
    `<path class="hx-halo" d="M-16 23C-17 6 -16 -2 -15 -6C-16 -24 -7 -38 3 -40C2 -36 5 -33 9 -31C14 -27 15 -18 15.5 -6C15.5 -5 15.6 -4 16 -3C22 -7 28 -1 26 7C25 12 20 15 16 14L16 23Q0 29 -16 23Z"/>` +
    `<path class="hx-rb-sack" d="M13 -1C20 -6 28 -1 26 8C25 15 15 16 12 10C10 6 11 1 13 -1Z"/>` +
    `<path class="hx-rb-cloak" d="M-16 23C-17 6 -13 -8 0 -9C13 -8 17 6 16 23Q0 29 -16 23Z"/>` +
    `<path class="hx-rb-fold" d="M-9 20C-10 10 -8 2 -5 -2M8 21C9 14 9 8 7 4"/>` +
    `<path class="hx-rb-strap" d="M-6 -2Q4 5 14 0"/>` +
    `<path class="hx-rb-cloak" d="M-15 -6C-16 -24 -7 -38 3 -40C2 -36 5 -33 9 -31C14 -27 15 -18 15.5 -6Q8 -1 0 -4Q-8 -1 -15 -6Z"/>` +
    `<ellipse class="hx-rb-face" cx="0" cy="-20" rx="8.6" ry="7"/>` +
    `<path class="hx-rb-mask" d="M-8.2 -22.8Q0 -25.4 8.2 -22.8L7.8 -18.4Q0 -20.6 -7.8 -18.4Z"/>` +
    `<circle class="hx-rb-eye" cx="-3.4" cy="-20.7" r="1.7"/><circle class="hx-rb-eye" cx="3.4" cy="-20.7" r="1.7"/>` +
    `<path class="hx-rb-brow" d="M-6 -25.2L-1.4 -23.6M6 -25.2L1.4 -23.6"/>` +
    `<path class="hx-rb-gleam" d="M-9 -24Q-8 -33 0 -36.5"/>` +
    `</g></g>`
  );
}

const SPOT_HIT = { corner: 60, hex: 96 };

// A place the player can tap: a legal corner, edge or hex. The hit shape is
// invisible and finger-sized; an edge's is the diamond between its corners
// and the hexes either side, so neighbouring edges never overlap.
export function spotSvg(kind, id, label = "") {
  const aria = `role="button" tabindex="0"${label ? ` aria-label="${label.replace(/[&"<>]/g, (ch) => `&#${ch.charCodeAt(0)};`)}"` : ""}`;
  if (kind === "corner") {
    const c = CORNERS[id];
    return (
      `<g class="hx-spot hx-spot-corner" data-corner="${id}" ${aria} transform="translate(${pt(c.x * U, c.y * U)})">` +
      `<circle class="hx-hit" r="${SPOT_HIT.corner}"/><circle class="hx-spot-pulse" r="20"/><circle class="hx-spot-mark" r="11"/></g>`
    );
  }
  if (kind === "edge") {
    const e = EDGES[id];
    const a = CORNERS[e.a], b = CORNERS[e.b];
    const th = Math.atan2(b.y - a.y, b.x - a.x);
    const half = Math.hypot(b.x - a.x, b.y - a.y) * U * 0.46;
    const wide = (Math.sqrt(3) / 2) * U * 0.9;
    return (
      `<g class="hx-spot hx-spot-edge" data-edge="${id}" ${aria} transform="translate(${pt(e.x * U, e.y * U)}) rotate(${n((th * 180) / Math.PI)})">` +
      `<path class="hx-hit" d="${polyD([[-half, 0], [0, -wide], [half, 0], [0, wide]])}"/>` +
      `<rect class="hx-spot-pulse" x="-33" y="-11" width="66" height="22" rx="11"/><rect class="hx-spot-bar" x="-30" y="-8" width="60" height="16" rx="8"/><circle class="hx-spot-mark" r="7.5"/></g>`
    );
  }
  const h = HEXES[id];
  const ring = (r) => polyD(Array.from({ length: 6 }, (_, i) => [r * Math.cos((Math.PI / 3) * i - Math.PI / 2), r * Math.sin((Math.PI / 3) * i - Math.PI / 2)]));
  return (
    `<g class="hx-spot hx-spot-hex" data-hex="${id}" ${aria} transform="translate(${pt(h.x * U, h.y * U)})">` +
    `<path class="hx-hit" d="${ring(SPOT_HIT.hex)}"/><path class="hx-spot-pulse" d="${ring(84)}"/><path class="hx-spot-rim" d="${ring(84)}"/><circle class="hx-spot-mark" r="43"/></g>`
  );
}

const DIE_PIPS = [[], [[0, 0]], [[-1, -1], [1, 1]], [[-1, -1], [0, 0], [1, 1]], [[-1, -1], [1, -1], [-1, 1], [1, 1]], [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]];
const DIE = 52;

function pipsOf(face, cls, hidden) {
  const s = DIE * 0.26;
  return `<g class="${cls}${face === 1 ? " hx-one" : ""}"${hidden ? ' opacity="0"' : ""}>` + DIE_PIPS[face].map(([a, b]) => `<circle cx="${n(a * s)}" cy="${n(b * s)}" r="${face === 1 ? 6.4 : 4.6}"/>`).join("") + `</g>`;
}

// Two dice in their own <svg>, sized by CSS. While .hx-rolling, other faces
// flicker past and the rolled ones land last.
export function diceSvg([a, b]) {
  const die = (face, x, tilt) => {
    const h = DIE / 2;
    const flicker = [2, 4, 5].map((d) => ((face + d - 1) % 6) + 1);
    return (
      `<g class="hx-die" data-face="${face}" transform="translate(${x} 34) rotate(${tilt})"><g class="hx-die-body">` +
      `<rect class="hx-shadow" x="${-h + 3}" y="${-h + 7}" width="${DIE}" height="${DIE}" rx="12"/>` +
      `<rect class="hx-die-side" x="${-h}" y="${-h + 4}" width="${DIE}" height="${DIE}" rx="12"/>` +
      `<rect class="hx-die-face" x="${-h}" y="${-h}" width="${DIE}" height="${DIE}" rx="12"/>` +
      `<path class="hx-die-shine" d="M${-h + 9} ${-h + 4}H${h - 10}"/>` +
      pipsOf(face, "hx-die-pips", false) +
      flicker.map((d) => pipsOf(d, "hx-die-pips-alt", true)).join("") +
      `</g></g>`
    );
  };
  return `<svg class="hx-dice" viewBox="0 0 136 72" role="img" aria-label="Dice: ${a} and ${b}">${die(a, 34, -7)}${die(b, 100, 6)}</svg>`;
}
