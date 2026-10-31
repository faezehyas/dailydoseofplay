import test from "node:test";
import assert from "node:assert/strict";
import { HEXES, CORNERS, EDGES, COAST, HARBOUR_EDGES, TERRAINS, NUMBERS, HARBOURS, DESERT, layoutBoard, pips } from "./board.js";
import { rngFromSeed } from "../engine/rng.js";

test("19 hexes in rows of 3, 4, 5, 4 and 3, with 54 corners, 72 edges and a coast of 30", () => {
  assert.equal(HEXES.length, 19);
  assert.deepEqual([-2, -1, 0, 1, 2].map((r) => HEXES.filter((h) => h.r === r).length), [3, 4, 5, 4, 3]);
  assert.equal(CORNERS.length, 54);
  assert.equal(EDGES.length, 72);
  assert.equal(COAST.length, 30);
  assert.equal(new Set(HARBOUR_EDGES).size, 9);
  for (const e of HARBOUR_EDGES) assert.ok(COAST.includes(e));
});

test("ids are in reading order and every link goes both ways", () => {
  for (const list of [HEXES, CORNERS, EDGES]) {
    list.forEach((x, id) => assert.equal(x.id, id));
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].y < list[i].y - 1e-6 || (Math.abs(list[i - 1].y - list[i].y) < 1e-6 && list[i - 1].x < list[i].x));
  }
  for (const h of HEXES) {
    assert.equal(new Set(h.corners).size, 6);
    assert.equal(new Set(h.edges).size, 6);
    h.edges.forEach((e, i) => assert.deepEqual([EDGES[e].a, EDGES[e].b].sort((a, b) => a - b), [h.corners[i], h.corners[(i + 1) % 6]].sort((a, b) => a - b)));
    for (const o of h.neighbors) assert.ok(HEXES[o].neighbors.includes(h.id));
  }
  for (const c of CORNERS) {
    assert.ok(c.hexes.length >= 1 && c.hexes.length <= 3);
    assert.equal(c.corners.length, c.edges.length);
    assert.ok(c.edges.length === 2 || c.edges.length === 3);
    for (const o of c.corners) assert.ok(CORNERS[o].corners.includes(c.id));
  }
  for (const e of EDGES) assert.ok(CORNERS[e.a].edges.includes(e.id) && CORNERS[e.b].edges.includes(e.id));
  assert.deepEqual(HEXES[9].neighbors.length, 6, "the middle hex has six neighbours");
});

test("a layout uses every terrain, token and harbour once, keeps 6s and 8s apart, and is the same for the same draws", () => {
  for (let seed = 0; seed < 200; seed++) {
    const b = layoutBoard(rngFromSeed(seed));
    assert.deepEqual(b.terrain.slice().sort(), TERRAINS.slice().sort());
    assert.deepEqual(b.numbers.filter(Boolean).sort((x, y) => x - y), NUMBERS);
    assert.equal(b.numbers[b.desert], 0);
    assert.equal(b.terrain[b.desert], DESERT);
    assert.deepEqual(b.harbours.map((h) => h.kind).sort(), HARBOURS.slice().sort());
    for (const h of HEXES) if ([6, 8].includes(b.numbers[h.id])) for (const o of h.neighbors) assert.ok(![6, 8].includes(b.numbers[o]), `seed ${seed}`);
  }
  assert.deepEqual(layoutBoard(rngFromSeed("x")), layoutBoard(rngFromSeed("x")));
  assert.notDeepEqual(layoutBoard(rngFromSeed("x")), layoutBoard(rngFromSeed("y")));
});

test("pips count the ways to roll a number", () => {
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(pips), [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]);
});
