// What the view shares with the tutorial, without a DOM: a discard paid in
// parts when it would show too many hidden cards, and the cards a roll flies
// out when the bank runs short.
import test from "node:test";
import assert from "node:assert/strict";
import { discardParts, production } from "./art.js";
import { HEXES } from "./board.js";
import { MAX_SHOWN, PER_RESOURCE } from "./rules.js";

// A hand of slots whose faces are the slot ids: `n` cards of resource r from `from` on.
const cards = (r, n, from = 0) => Array.from({ length: n }, (_, i) => r * PER_RESOURCE + from + i);
const face = (s) => s;

test("a discard that shows at most MAX_SHOWN hidden cards is one move", () => {
  const hand = [...cards(0, 10), ...cards(1, 10)];
  const { slots, rest } = discardParts(hand, [6, 4, 0, 0, 0], face, () => false, MAX_SHOWN);
  assert.equal(rest, null);
  assert.deepEqual(slots, [...cards(0, 6), ...cards(1, 4)]);
});

test("cards everyone has seen are discarded before hidden ones, so fewer parts are needed", () => {
  const hand = [...cards(0, 12), ...cards(0, 6, 12)];
  const open = (s) => s >= 12; // the last 6 wood were collected after a steal hid the rest
  const { slots, rest } = discardParts(hand, [18, 0, 0, 0, 0], face, open, MAX_SHOWN);
  assert.equal(rest, null, "6 seen and 12 hidden: no part is needed");
  assert.equal(slots.length, 18);
});

test("more hidden cards than MAX_SHOWN go in parts: the seen ones and MAX_SHOWN hidden now, the rest next", () => {
  // 40 cards after a steal, all hidden but the 2 ore collected since: 20 to discard.
  const hand = [...cards(0, 12), ...cards(1, 10), ...cards(3, 10), ...cards(4, 6), ...cards(4, 2, 6)];
  const open = (s) => s >= 4 * PER_RESOURCE + 6;
  const picked = [8, 6, 0, 4, 2];
  const { slots, rest } = discardParts(hand, picked, face, open, MAX_SHOWN);
  const hidden = slots.filter((s) => !open(s));
  assert.equal(hidden.length, MAX_SHOWN, "as many hidden cards as a move can show");
  assert.ok(slots.length >= MAX_SHOWN && slots.length < 20, "a part of at least MAX_SHOWN, short of the whole discard");
  assert.ok(slots.filter(open).length === 2, "both seen ore go now");
  assert.equal(slots.length + rest.reduce((a, b) => a + b, 0), 20, "the part and the rest make the discard");
  assert.deepEqual(rest, [0, 0, 0, 2, 0], "the last picked hidden cards wait for the next part");
});

test("a roll's flights stop at what each seat was paid when the bank runs short", () => {
  const hex = HEXES[0];
  const board = { numbers: HEXES.map((h) => (h.id === hex.id ? 8 : 0)), terrain: HEXES.map(() => 2) };
  const buildings = Array(60).fill(null);
  buildings[hex.corners[0]] = { p: 0, city: true };
  buildings[hex.corners[2]] = { p: 1, city: false };
  const all = production(board, -1, buildings, 8);
  assert.deepEqual(all.map((f) => [f.p, f.n]), [[0, 2], [1, 1]]);
  // Only seat 0 wanted wool and the bank had 1 left (partial); nobody gets ore (short).
  const got = [[0, 0, 1, 0, 0], [0, 0, 0, 0, 0]];
  assert.deepEqual(production(board, -1, buildings, 8, got).map((f) => [f.p, f.n]), [[0, 1]]);
  assert.deepEqual(production(board, hex.id, buildings, 8), [], "the robber's hex pays nothing");
});
