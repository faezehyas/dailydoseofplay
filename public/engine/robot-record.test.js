import test from "node:test";
import assert from "node:assert/strict";
import { recordRobotResult, robotRecord, resetRobotRecord } from "./robot-record.js";

const KEY = "ddp-robot-record";

// localStorage's interface over a Map, put where the shell's helpers look.
function useStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  return map;
}

const EMPTY = { win: 0, draw: 0, loss: 0, games: 0, byPlayers: {} };

test("a new player has no record", () => {
  useStorage();
  assert.deepEqual(robotRecord("tic-tac-toe"), EMPTY);
});

test("results add up per game, with the number of players kept", () => {
  const map = useStorage();
  recordRobotResult("tic-tac-toe", "win");
  recordRobotResult("tic-tac-toe", "win", 2);
  recordRobotResult("tic-tac-toe", "draw");
  recordRobotResult("tic-tac-toe", "loss");
  recordRobotResult("ludo", "win", 4);
  recordRobotResult("ludo", "loss", 3);
  recordRobotResult("ludo", "loss", 4);
  assert.deepEqual(robotRecord("tic-tac-toe"), { win: 2, draw: 1, loss: 1, games: 4, byPlayers: { 2: { win: 2, draw: 1, loss: 1, games: 4 } } });
  assert.deepEqual(robotRecord("ludo"), {
    win: 1,
    draw: 0,
    loss: 2,
    games: 3,
    byPlayers: { 3: { win: 0, draw: 0, loss: 1, games: 1 }, 4: { win: 1, draw: 0, loss: 1, games: 2 } },
  });
  assert.deepEqual(JSON.parse(map.get(KEY)), {
    "tic-tac-toe": { 2: { win: 2, draw: 1, loss: 1 } },
    ludo: { 3: { win: 0, draw: 0, loss: 1 }, 4: { win: 1, draw: 0, loss: 1 } },
  });
});

test("an unknown outcome or table size is not recorded", () => {
  const map = useStorage();
  for (const [outcome, players] of [["over", 2], ["won", 2], [undefined, 2], ["win", 1], ["win", "4"], ["win", 2.5]]) recordRobotResult("chess", outcome, players);
  assert.equal(map.has(KEY), false);
  assert.deepEqual(robotRecord("chess"), EMPTY);
});

test("Reset clears one game and keeps the others", () => {
  const map = useStorage();
  recordRobotResult("chess", "win");
  recordRobotResult("hearts", "loss", 4);
  resetRobotRecord("chess");
  assert.deepEqual(robotRecord("chess"), EMPTY);
  assert.equal(robotRecord("hearts").games, 1);
  resetRobotRecord("hearts");
  assert.equal(map.has(KEY), false);
});

test("a damaged record reads as empty and is repaired by the next result", () => {
  for (const raw of ["not json", "[]", "42", "null", '{"chess":[1]}', '{"chess":{"2":{"win":-3,"draw":"2","loss":1.5}}}']) {
    const map = useStorage({ [KEY]: raw });
    assert.deepEqual(robotRecord("chess"), EMPTY, raw);
    recordRobotResult("chess", "draw");
    assert.deepEqual(robotRecord("chess"), { win: 0, draw: 1, loss: 0, games: 1, byPlayers: { 2: { win: 0, draw: 1, loss: 0, games: 1 } } }, raw);
    assert.deepEqual(JSON.parse(map.get(KEY)), { chess: { 2: { win: 0, draw: 1, loss: 0 } } }, raw);
  }
});

test("a storage that throws loses the result without breaking the game", () => {
  const fail = () => {
    throw new Error("blocked");
  };
  Object.defineProperty(globalThis, "localStorage", { value: { getItem: fail, setItem: fail, removeItem: fail }, configurable: true });
  assert.doesNotThrow(() => recordRobotResult("chess", "win"));
  assert.deepEqual(robotRecord("chess"), EMPTY);
  assert.doesNotThrow(() => resetRobotRecord("chess"));
});
