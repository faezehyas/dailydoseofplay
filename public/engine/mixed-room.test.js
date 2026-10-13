import test from "node:test";
import assert from "node:assert/strict";
import { localPair } from "./channel.js";
import { admitGuest, greetHost, startHub, matchRouter } from "./session.js";
import { HostRoom } from "./room.js";
import { SharedRandom } from "./fair.js";
import { TurnMatch } from "./turn-match.js";
import { startCardRobot } from "./card-match.js";
import { rngFromSeed } from "./rng.js";
import { makeRules as ludoRules } from "../ludo/rules.js";
import { chooseMove, startRobot } from "../ludo/robot.js";
import { makeRules as toyRules, chooseMove as toyMove } from "../../test/fixtures/toy-cards.js";

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 60_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}

// A friend room over in-memory links, through the real handshake: the host,
// a guest per name, then `robots` robot seats. Returns every seat's Session.
async function friendRoom(game, names, robots) {
  const guests = names.slice(1).map((name) => {
    const [link, guestEnd] = localPair();
    return { link, name, joined: greetHost(guestEnd, { name, game }) };
  });
  await Promise.all(guests.map((g) => admitGuest(g.link, { game })));
  const host = startHub({ name: names[0], guests, game, robots });
  const seated = await Promise.all(guests.map((g) => g.joined));
  return [host, ...seated, ...host.players.filter((p) => p.robot).map((p) => host.seatRobot(p.seat))];
}

test("robots sit after the people, every seat knows which are robots, and a robot hears everyone", async () => {
  const sessions = await friendRoom("hearts", ["Ada", "Bo"], ["Robot 1", "Robot 2"]);
  assert.deepEqual(sessions.map((s) => s.index), [0, 1, 2, 3]);
  for (const s of sessions) {
    assert.deepEqual(s.players.map((p) => p.name), ["Ada", "Bo", "Robot 1", "Robot 2"]);
    assert.deepEqual(s.players.map((p) => p.robot), [false, false, true, true]);
    assert.equal(s.takeover, true);
  }
  const got = sessions.map((s) => {
    const seen = [];
    s.onMessage((msg, from) => seen.push([from, msg.t]));
    return seen;
  });
  sessions[1].send({ t: "hi" });
  sessions[3].send({ t: "yo" });
  await tick();
  assert.deepEqual(got, [[[1, "hi"], [3, "yo"]], [[3, "yo"]], [[1, "hi"], [3, "yo"]], [[1, "hi"]]]);

  // A two-player game: no robots, and nobody takes a seat over.
  const duel = await friendRoom("chess", ["Ada", "Bo"]);
  assert.ok(duel.every((s) => !s.takeover && s.players.every((p) => !p.robot)));
});

test("the host fills only empty seats with robots, named by the lowest number free, and two-player rooms take none", () => {
  const room = new HostRoom({ game: "hearts", name: "Ada", maxPlayers: 4 });
  room.guests.set("bo", { name: "Bo", ready: true, link: { send() {} } });
  for (let i = 0; i < 3; i++) room.addRobot();
  assert.deepEqual(room.robots, ["Robot 1", "Robot 2"], "only the empty seats");
  room.removeRobot("Robot 1");
  assert.deepEqual(room.players.map((p) => [p.name, !!p.robot]), [["Ada", false], ["Bo", false], ["Robot 2", true]]);
  room.addRobot();
  assert.deepEqual(room.robots, ["Robot 1", "Robot 2"]);
  const duel = new HostRoom({ game: "chess", name: "Ada" });
  duel.addRobot();
  assert.deepEqual(duel.robots, []);
});

test("draws go on without a seat whose player left: everyone agrees, and so does the robot's copy", async () => {
  const srs = await Promise.all([0, 1, 2].map(() => SharedRandom.create(8)));
  const tips = srs.map((sr) => sr.tip);
  srs.forEach((sr, i) => sr.setPeers(tips, i));
  const peers = srs.slice(); // who hears each reveal, by seat
  const send = (from) => (k, v) => peers.forEach((sr, i) => i !== from && sr.receive(k, v, from));
  const first = await Promise.all(srs.map((sr, i) => sr.draw(send(i))));
  assert.equal(new Set(first.map((rng) => rng())).size, 1);
  // Seat 2 is gone before revealing draw 2, which seats 0 and 1 are waiting on.
  const second = [0, 1].map((i) => srs[i].draw(send(i)));
  await tick();
  srs[0].drop(2);
  srs[1].drop(2);
  const values = (await Promise.all(second)).map((rng) => rng());
  assert.equal(values[0], values[1]);
  // The robot for seat 2 starts from seat 0's copy and reveals nothing.
  const robot = srs[0].forSeat(2);
  peers[2] = robot;
  const third = await Promise.all([srs[0].draw(send(0)), srs[1].draw(send(1)), robot.draw(() => assert.fail("a robot taking over reveals nothing"))]);
  assert.equal(new Set(third.map((rng) => rng())).size, 1);
});

test("Ludo: a guest who leaves mid-game is replaced by a robot, and the game finishes the same everywhere", async () => {
  const rules = ludoRules({});
  const sessions = await friendRoom("ludo", ["Ada", "Bo", "Cy"], []);
  const [host, bo, cy] = sessions;
  let robot = null;
  const events = [];
  host.on("takeover", (seat, why, robotSession) => {
    events.push(["host", seat, why]);
    robot = startRobot(robotSession, { rules, choose: (st, me, rng) => chooseMove(st, me, rng), delay: () => 0, rng: rngFromSeed("robot") });
  });
  bo.on("takeover", (seat, why) => events.push(["bo", seat, why]));
  const matches = sessions.map((s) => {
    const match = new TurnMatch({ send: (msg) => s.send(msg), me: s.index, players: 3, rules });
    matchRouter(s).start(match);
    return match;
  });
  const rng = rngFromSeed("people");
  let people = matches;
  const plays = async (stopAt) => {
    while (people[0].phase === "playing" && people[0].state.ply < stopAt) {
      const mover = people.find((m) => m.canMove());
      if (mover) await mover.play(chooseMove(mover.state, mover.me, rng));
      await tick();
    }
  };
  await until(() => matches.every((m) => m.phase === "playing"));
  await plays(30);
  cy.leave();
  people = matches.slice(0, 2);
  await until(() => robot);
  assert.equal(robot.match.m, 1, "the robot joins the match on");
  await plays(Infinity);
  await until(() => [...people, robot.match].every((m) => m.phase === "over" && !m.working));
  assert.deepEqual(robot.match.state, people[0].state);
  assert.deepEqual(people[1].state, people[0].state);
  assert.ok(people[0].state.ply > 30);
  assert.deepEqual(events, [["host", 2, "left"], ["bo", 2, "left"]]);
  assert.ok(!host.ended && !bo.ended, "the game went on");
  assert.ok(host.players[2].robot && bo.players[2].robot);
});

test("cards: a guest leaving stops the hand, and the robot plays from the rematch without seeing anyone's cards", async () => {
  const rules = toyRules({ deckSize: 12, maxTurns: 40 });
  const sessions = await friendRoom("toy", ["Ada", "Bo", "Cy"], []);
  const drive = (s, i) => startCardRobot(s, { rules, choose: toyMove, delay: 0, rng: rngFromSeed(`seat${i}`) });
  const robots = sessions.map(drive);
  let robot = null;
  sessions[0].on("takeover", (seat, why, robotSession) => {
    robotSession.on("rematch", (votes) => votes.them && !votes.me && robotSession.requestRematch());
    robot = drive(robotSession, 3);
  });
  await until(() => robots.every((r) => r.match.phase === "playing"));
  sessions[2].leave();
  await until(() => robot && robots.slice(0, 2).every((r) => r.match.phase === "aborted"));
  for (const r of robots.slice(0, 2)) {
    assert.equal(r.match.abortSeat, 2);
    assert.match(r.match.abortReason, /^left\. Every card needs every player's key/);
  }
  assert.equal(robot.match.phase, "aborted", "the robot sits the stopped hand out");
  sessions[0].requestRematch();
  sessions[1].requestRematch();
  const next = [robots[0], robots[1], robot];
  // Mid-hand, the robot knows only the open cards and its own, like any seat.
  await until(() => next.every((r) => r.match.m === 2 && r.match.phase !== "starting"));
  for (const r of next) {
    for (const [id, slot] of r.match.slots.entries()) {
      if (slot.face !== null && !slot.gone) assert.ok(slot.open || slot.owner === r.match.me, `seat ${r.match.me} knows hidden slot ${id}`);
    }
  }
  await until(() => next.every((r) => r.match.verdict));
  assert.ok(next.every((r) => r.match.verdict.ok));
  assert.deepEqual(robot.match.state, robots[0].match.state);
});
