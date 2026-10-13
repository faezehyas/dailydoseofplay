import test from "node:test";
import assert from "node:assert/strict";
import { gameSettings, savedPlayers } from "./settings.js";

// A game's settings saved as `saved`, with the lobby offering `counts`.
function offered(saved, counts, defaultPlayers) {
  const map = new Map([["ddp-test-settings", JSON.stringify(saved)]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) } });
  const settings = gameSettings({ key: "ddp-test-settings", prefix: "ts", groups: [], normalize: () => ({}), defaultPlayers });
  settings.offerPlayers(counts);
  return settings.players();
}

test("the old number of robots becomes the player count, one more", () => {
  assert.equal(savedPlayers({ robots: 3, level: "hard" }), 4);
  assert.equal(savedPlayers({ robots: 1 }), 2);
  assert.equal(savedPlayers({ players: 3, robots: 1 }), 3, "a saved player count wins");
  for (const raw of [null, {}, { robots: "3" }, { players: 2.5 }]) assert.equal(savedPlayers(raw), undefined, JSON.stringify(raw));
});

test("the lobby starts a robot game with the saved count, or the game's default, or a full table", () => {
  assert.equal(offered({ robots: 3 }, [2, 3, 4]), 4);
  assert.equal(offered({ robots: 1 }, [2, 3, 4]), 2);
  assert.equal(offered({ robots: 2 }, [3, 4]), 3);
  assert.equal(offered({ robots: 1 }, [3, 4]), 4, "a count the game doesn't offer");
  assert.equal(offered(null, [2, 3, 4]), 4);
  assert.equal(offered(null, [2, 3, 4], 2), 2);
  assert.equal(offered({ robots: 3 }, [2, 3, 4], 2), 4, "the saved count wins");
});
