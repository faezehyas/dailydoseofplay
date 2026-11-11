// The seat ring's geometry and words, without a DOM.
import test from "node:test";
import assert from "node:assert/strict";
import { RING, seatAngles, passTarget, pointAt, ringWords, stackBox, seatSpots, tiePath, TIE } from "./ring.js";
import { leftOf, rightOf, passDir } from "./rules.js";

const COUNTS = [3, 4, 5, 6, 7];
const name = (p) => (p === 0 ? "you" : `Robot ${p}`);
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const box = ([x, y], [w, h]) => ({ x: x - w / 2, y: y - h / 2, w, h });
// A plate's or dot's size in viewBox units: a 360 px phone (minimum fonts, so
// big against the ring) and a 520 px desktop ring.
const sizesFor = (players, me, width) => {
  const k = RING.W / width;
  return Array.from({ length: players }, (_, p) => {
    const near = p === me || p === leftOf({ players }, me) || p === rightOf({ players }, me);
    return near ? [(p === me ? 64 : 84) * k, 24 * k] : [26 * k, 26 * k];
  });
};

test("you sit at the bottom and your left neighbour on the left half", () => {
  for (const n of COUNTS) {
    for (let me = 0; me < n; me++) {
      const a = seatAngles(n, me);
      assert.equal(a[me], 90);
      const [lx] = pointAt(a[leftOf({ players: n }, me)], RING.lane);
      const [rx] = pointAt(a[rightOf({ players: n }, me)], RING.lane);
      assert.ok(lx < RING.cx, `${n} players, seat ${me}: left neighbour on the left`);
      assert.ok(rx > RING.cx, `${n} players, seat ${me}: right neighbour on the right`);
    }
  }
});

test("seats run clockwise one step apart", () => {
  for (const n of COUNTS) {
    const a = seatAngles(n, 2 % n);
    for (let p = 0; p < n; p++) {
      const next = a[(p + 1) % n];
      const gap = (((next - a[p]) % 360) + 360) % 360;
      assert.ok(Math.abs(gap - 360 / n) < 1e-9, `${n} players: seat ${p} to ${(p + 1) % n}`);
    }
  }
});

test("no two stacks overlap and none covers the middle", () => {
  for (const n of COUNTS) {
    const boxes = seatAngles(n, 0).map((deg) => stackBox(deg, n));
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) assert.ok(!overlap(boxes[p], boxes[q]), `${n} players: stacks ${p} and ${q}`);
    // The age medal over the pips and the direction, centred a little above the table's centre.
    const top = RING.cy - 5 - 62;
    const mid = [{ x: RING.cx - 45, y: top, w: 90, h: 90 }, { x: RING.cx - 95, y: top + 90, w: 190, h: 34 }];
    for (const [p, b] of boxes.entries()) for (const m of mid) assert.ok(!overlap(b, m), `${n} players: stack ${p} clear of the middle`);
  }
});

test("plates and dots keep inside the ring and off every stack and each other", () => {
  for (const width of [360, 520]) {
    for (const n of COUNTS) {
      for (const me of [0, n - 1]) {
        const sizes = sizesFor(n, me, width);
        const spots = seatSpots(n, me, sizes);
        const boxes = spots.map((s, p) => box(s, sizes[p]));
        const stacks = seatAngles(n, me).map((deg) => stackBox(deg, n));
        for (const [p, b] of boxes.entries()) {
          const where = `${width} px, ${n} players, me ${me}, seat ${p}`;
          assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= RING.W && b.y + b.h <= RING.H, `${where} inside`);
          for (const [q, s] of stacks.entries()) assert.ok(!overlap(b, s), `${where} off stack ${q}`);
          for (let q = p + 1; q < n; q++) assert.ok(!overlap(b, boxes[q]), `${where} off seat ${q}`);
        }
      }
    }
  }
});

test("hands pass to the next seat, left in ages I and III and right in age II", () => {
  for (const n of COUNTS) {
    for (let p = 0; p < n; p++) {
      assert.equal(passTarget(n, p, 1), leftOf({ players: n }, p));
      assert.equal(passTarget(n, p, -1), rightOf({ players: n }, p));
      assert.equal(passTarget(n, passTarget(n, p, 1), -1), p);
    }
  }
  assert.equal(passTarget(4, 3, passDir(1)), 0);
  assert.equal(passTarget(4, 0, passDir(2)), 3);
  assert.equal(passTarget(7, 6, passDir(3)), 0);
});

test("a left pass moves every stack clockwise on screen", () => {
  for (const n of COUNTS) {
    const a = seatAngles(n, 1 % n);
    for (let p = 0; p < n; p++) {
      const gap = (((a[passTarget(n, p, 1)] - a[p]) % 360) + 360) % 360;
      assert.ok(Math.abs(gap - 360 / n) < 1e-9);
    }
  }
});

test("the ring's words say the age, the turn and where hands go", () => {
  assert.equal(ringWords({ players: 4, me: 0, age: 2, round: 3 }, name), "Age II, turn 3 of 6. Hands go right: yours to Robot 3, and you get Robot 1's.");
  assert.equal(ringWords({ players: 3, me: 1, age: 1, round: 1 }, (p) => ["Ada", "you", "Bo"][p]), "Age I, turn 1 of 6. Hands go left: yours to Bo, and you get Ada's.");
  assert.equal(ringWords({ players: 7, me: 0, age: 3, round: 6 }, name), "Age III, turn 6 of 6. Hands go left: yours to Robot 1, and you get Robot 6's.");
  // Babylon's seventh card is still the sixth turn.
  assert.match(ringWords({ players: 4, me: 0, age: 1, round: 7 }, name), /turn 6 of 6/);
  assert.equal(ringWords({ players: 4, me: 0, age: 0, round: 0 }, name), "Waiting for the first deal.");
});

test("ties run outside the table, from you round to each neighbour", () => {
  const nums = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);
  for (const n of COUNTS) {
    const spots = seatSpots(n, 0, sizesFor(n, 0, 520));
    for (const q of [leftOf({ players: n }, 0), rightOf({ players: n }, 0)]) {
      const d = tiePath(spots[0], spots[q]);
      assert.match(d, /^M[^A]+L[^A]+A[^A]+L[^A]+$/);
      const [, , x0, y0, rx, ry, , large, sweep, x1, y1] = nums(d);
      assert.deepEqual([rx, ry], TIE);
      assert.equal(large, 0);
      assert.equal(sweep, spots[q][0] < spots[0][0] ? 1 : 0, `${n} players: the tie to ${q} bends the right way`);
      for (const [x, y] of [[x0, y0], [x1, y1]]) assert.ok(Math.abs(((x - RING.cx) / TIE[0]) ** 2 + ((y - RING.cy) / TIE[1]) ** 2 - 1) < 0.01);
    }
  }
});
