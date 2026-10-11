import test from "node:test";
import assert from "node:assert/strict";
import { Emitter } from "./channel.js";
import { localRoom } from "./room.js";
import { reactionLink, robotBanter, setGameLines, REACTIONS, GAP_MS } from "./reactions.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

function pair(now) {
  const [a, b] = localRoom({ game: "test", names: ["Ada", "Bo"] });
  const got = [];
  reactionLink(a, now).onReaction((seat, text) => got.push([seat, text]));
  return { a, b, got };
}

test("a reaction reaches the others as its fixed text", async () => {
  const { b, got } = pair();
  assert.equal(reactionLink(b).send(REACTIONS.indexOf("Nice move!")), true);
  await tick();
  assert.deepEqual(got, [[1, "Nice move!"]]);
});

test("unknown indexes are dropped, on sending and on receiving", async () => {
  const { b, got } = pair();
  for (const i of [-1, 1.5, "3", null, REACTIONS.length, 1e9]) {
    assert.equal(reactionLink(b).send(i), false);
    b.send({ t: "$react", i });
  }
  await tick();
  assert.deepEqual(got, []);
});

test("a game's own lines count only once it has set them", async () => {
  const { b, got } = pair();
  b.send({ t: "$react", i: REACTIONS.length });
  await tick();
  setGameLines({ lead: ["Splash!"] });
  b.send({ t: "$react", i: REACTIONS.length });
  await tick();
  setGameLines();
  assert.deepEqual(got, [[1, "Splash!"]]);
});

test("one reaction per player every 2 s, on sending and on receiving", async () => {
  let t = 1000;
  const now = () => t;
  const { b, got } = pair(now);
  const link = reactionLink(b, now);
  assert.equal(link.send(0), true);
  assert.equal(link.send(1), false, "the sender holds back a second one");
  b.send({ t: "$react", i: 2 }); // a modified page sends it anyway
  await tick();
  t += GAP_MS - 1;
  b.send({ t: "$react", i: 3 });
  await tick();
  t += 1;
  b.send({ t: "$react", i: 4 });
  await tick();
  assert.deepEqual(got, [
    [1, REACTIONS[0]],
    [1, REACTIONS[4]],
  ]);
});

test("the robot says a line at the end, and after a strong move of the player's", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const [player, bot] = localRoom({ game: "test", names: ["Ada", "Robot"] });
  const got = [];
  reactionLink(player).onReaction((seat, text) => got.push(text));
  const match = new Emitter();
  const robot = { match };
  robotBanter(bot, robot, { score: (st, p) => st.points[p], strong: 2 }, () => 0);
  // Turns alternate; the player's last move scores 3, a strong one.
  const turns = [[0, [0, 0]], [1, [1, 0]], [0, [1, 1]], [1, [2, 1]], [0, [2, 2]], [1, [5, 2]]];
  for (const [turn, points] of turns) {
    match.state = { turn, winner: -1, points };
    match.emit("update");
  }
  await Promise.resolve();
  assert.deepEqual(got, ["😮"]);

  match.state = { turn: 1, winner: 0, points: [6, 2] };
  match.emit("update");
  match.emit("over", { winner: 0 });
  t.mock.timers.tick(GAP_MS);
  await Promise.resolve();
  assert.deepEqual(got, ["😮", "Good game!"]);
});
