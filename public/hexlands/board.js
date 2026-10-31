// Hexlands' board: 19 pointy-top hexes in rows of 3, 4, 5, 4 and 3, their 54
// corners and 72 edges, the 9 harbours on the coast, and a random layout
// (terrain, number tokens, harbour kinds). Positions are in hex radii, centred
// on the middle hex; corners and edges are numbered in reading order (top to
// bottom, then left to right) of their position, hexes in reading order too.
// Pure: no DOM, timers or Math.random.
import { sample } from "../engine/rng.js";

export const WOOD = 0;
export const BRICK = 1;
export const WOOL = 2;
export const GRAIN = 3;
export const ORE = 4;
export const DESERT = 5;
export const RESOURCES = [WOOD, BRICK, WOOL, GRAIN, ORE];
export const RESOURCE_NAMES = ["wood", "brick", "wool", "grain", "ore"];
export const TERRAIN_NAMES = ["forest", "hills", "pasture", "fields", "mountains", "desert"];
export const TERRAINS = [...Array(4).fill(WOOD), ...Array(3).fill(BRICK), ...Array(4).fill(WOOL), ...Array(4).fill(GRAIN), ...Array(3).fill(ORE), DESERT];
export const NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
export const ANY = -1; // a 3:1 harbour; the others trade one resource 2:1
export const HARBOURS = [ANY, ANY, ANY, ANY, WOOD, BRICK, WOOL, GRAIN, ORE];

// The ways to roll each number with two dice, out of 36.
export const pips = (n) => (n >= 2 && n <= 12 ? 6 - Math.abs(7 - n) : 0);

const key = (v) => Math.round(v * 1000);
const byPlace = (a, b) => key(a.y) - key(b.y) || key(a.x) - key(b.x);

function build() {
  const hexes = [];
  for (let r = -2; r <= 2; r++) {
    for (let q = Math.max(-2, -r - 2); q <= Math.min(2, -r + 2); q++) hexes.push({ q, r, x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r });
  }
  hexes.forEach((h, id) => (h.id = id));

  const found = new Map();
  const cornersOf = hexes.map((h) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const x = h.x + Math.cos(a);
      const y = h.y + Math.sin(a);
      const k = `${key(x)},${key(y)}`;
      if (!found.has(k)) found.set(k, { x, y, hexes: [] });
      found.get(k).hexes.push(h.id);
      return found.get(k);
    }),
  );
  const corners = [...found.values()].sort(byPlace);
  corners.forEach((c, id) => Object.assign(c, { id, corners: [], edges: [] }));

  const pairs = new Map();
  hexes.forEach((h, hi) => {
    h.corners = cornersOf[hi].map((c) => c.id);
    h.corners.forEach((a, i) => {
      const b = h.corners[(i + 1) % 6];
      const k = `${Math.min(a, b)}-${Math.max(a, b)}`;
      if (!pairs.has(k)) pairs.set(k, { a: Math.min(a, b), b: Math.max(a, b), hexes: [] });
      pairs.get(k).hexes.push(h.id);
    });
  });
  const edges = [...pairs.values()].map((e) => ({ ...e, x: (corners[e.a].x + corners[e.b].x) / 2, y: (corners[e.a].y + corners[e.b].y) / 2 })).sort(byPlace);
  edges.forEach((e, id) => {
    e.id = id;
    corners[e.a].edges.push(id);
    corners[e.b].edges.push(id);
    corners[e.a].corners.push(e.b);
    corners[e.b].corners.push(e.a);
  });
  hexes.forEach((h) => {
    h.edges = h.corners.map((a, i) => edges.find((e) => (e.a === a && e.b === h.corners[(i + 1) % 6]) || (e.b === a && e.a === h.corners[(i + 1) % 6])).id);
    h.neighbors = hexes.filter((o) => o !== h && Math.hypot(o.x - h.x, o.y - h.y) < 1.8).map((o) => o.id);
  });

  // The coast clockwise from the top; a harbour every 3, 3 and 4 edges, as on the classic board.
  const angle = (e) => (Math.atan2(e.y, e.x) + (5 * Math.PI) / 2) % (2 * Math.PI);
  const coast = edges.filter((e) => e.hexes.length === 1).sort((a, b) => angle(a) - angle(b));
  const harbourEdges = [0, 3, 6, 10, 13, 16, 20, 23, 26].map((i) => coast[i].id);
  return { hexes, corners, edges, coast: coast.map((e) => e.id), harbourEdges };
}

// hexes: { id, q, r, x, y, corners[6], edges[6] (clockwise from the top), neighbors }
// corners: { id, x, y, hexes, corners (adjacent), edges }
// edges: { id, a, b (corners, a < b), x, y (midpoint), hexes }
export const { hexes: HEXES, corners: CORNERS, edges: EDGES, coast: COAST, harbourEdges: HARBOUR_EDGES } = build();

// A random board: terrain and harbour kinds shuffled, and number tokens with
// no 6 or 8 next to another 6 or 8. numbers[hex] is 0 on the desert.
export function layoutBoard(rng) {
  const terrain = sample(rng, TERRAINS, TERRAINS.length);
  const land = HEXES.filter((h) => terrain[h.id] !== DESERT).map((h) => h.id);
  const red = (n) => n === 6 || n === 8;
  let numbers;
  do {
    numbers = Array(HEXES.length).fill(0);
    sample(rng, NUMBERS, NUMBERS.length).forEach((n, i) => (numbers[land[i]] = n));
  } while (HEXES.some((h) => red(numbers[h.id]) && h.neighbors.some((o) => red(numbers[o]))));
  const kinds = sample(rng, HARBOURS, HARBOURS.length);
  return { terrain, numbers, harbours: HARBOUR_EDGES.map((edge, i) => ({ edge, kind: kinds[i] })), desert: terrain.indexOf(DESERT) };
}
