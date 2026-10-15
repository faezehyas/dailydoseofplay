// Integration: two real clients (the same RoomClient the browser uses) create
// and join a room through the running signaling server, relay signals, and
// see each other leave. Node 22+ provides the global WebSocket.
import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startServer } from "./helpers.js";
import { RoomClient } from "../public/engine/signaling.js";
import { cleanName } from "../public/engine/names.js";

const once = (emitter, type) => new Promise((resolve) => emitter.on(type, resolve));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Polls until fn() is true: for state the server reaches without a reply.
async function until(fn) {
  for (let i = 0; i < 500 && !fn(); i++) await sleep(10);
  assert.ok(fn(), "timed out waiting");
}

async function clients(t, srv, game, n) {
  const list = Array.from({ length: n }, () => new RoomClient({ game, url: srv.wsUrl }));
  t.after(() => list.forEach((c) => c.close()));
  await Promise.all(list.map((c) => c.connect()));
  return list;
}

// A raw socket (the ws package can set headers) that collects every reply.
async function rawSocket(t, srv, headers = {}) {
  const ws = new WebSocket(srv.wsUrl, { headers });
  const replies = [];
  ws.on("message", (data) => replies.push(JSON.parse(data)));
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => (ws.once("open", resolve), ws.once("error", reject)));
  // The first message is hello (or the error that refuses the connection), not an answer.
  for (let i = 0; i < 100 && replies.length === 0; i++) await sleep(10);
  const ask = async (msg) => {
    const before = replies.length;
    ws.send(JSON.stringify(msg));
    for (let i = 0; i < 100 && replies.length === before; i++) await sleep(10);
    return replies[before];
  };
  const closed = new Promise((resolve) => ws.once("close", (code, reason) => resolve({ code, reason: String(reason) })));
  return { ws, replies, ask, closed };
}

const guess = (sock, room) => sock.ask({ t: "join", game: "sea-battle", room, name: "X" });

test("host creates a room, friend joins with the code, signals relay both ways", async (t) => {
  const srv = await startServer();
  const host = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  const friend = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  t.after(async () => {
    host.close();
    friend.close();
    await srv.close();
  });
  await Promise.all([host.connect(), friend.connect()]);

  const created = await host.create("Ada");
  assert.match(created.room, /^[A-Z2-9]{4}$/);
  assert.match(created.key, /^[A-Za-z0-9_-]{22}$/, "128-bit base64url invite key");
  assert.equal(created.game, "sea-battle");

  const peerJoined = once(host, "peer");
  const joined = await friend.join(created.room.toLowerCase(), "Bo", created.key);
  assert.equal(joined.room, created.room);
  assert.equal(joined.host, host.id);
  assert.deepEqual(joined.peers.map((p) => p.name).sort(), ["Ada", "Bo"]);
  assert.deepEqual(await peerJoined, { id: friend.id, name: "Bo" });

  const health = await (await fetch(`${srv.base}/healthz`)).json();
  assert.equal(health.rooms, 1);
  assert.equal(health.players, 2);
  assert.deepEqual(health.games, { "sea-battle": 1 });

  // SDP/ICE relay is opaque: whatever goes in comes out, tagged with the sender.
  const atFriend = once(friend, "signal");
  host.signal(friend.id, { sdp: { type: "offer", sdp: "v=0 fake" } });
  assert.deepEqual(await atFriend, { from: host.id, data: { sdp: { type: "offer", sdp: "v=0 fake" } } });
  const atHost = once(host, "signal");
  friend.signal(host.id, { candidate: { candidate: "fake", sdpMid: "0" } });
  assert.deepEqual(await atHost, { from: friend.id, data: { candidate: { candidate: "fake", sdpMid: "0" } } });

  // A third player is turned away: two-player game.
  const third = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  await third.connect();
  await assert.rejects(third.join(created.room, "Cy"), (err) => err.code === "room_full");
  third.close();

  // Friend leaves; host is told. Host leaves; room closes.
  const left = once(host, "leave");
  friend.close();
  assert.deepEqual(await left, { id: friend.id });
  host.leave();
  await until(() => srv.signaling.stats().rooms === 0);
  assert.equal((await (await fetch(`${srv.base}/healthz`)).json()).rooms, 0);
});

test("the server shows other players the same names the lobby would: blocked ones become Player", { timeout: 10_000 }, async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host] = await clients(t, srv, "sea-battle", 1);
  const { room, key } = await host.create("f.u.c.k");
  const names = ["Ada", "  Bo  ", "Ольга", "فائزه", "a".repeat(30), "sh1t", "$hit", "BigAss", "evil.com", "@bo", "Bo!", "<b>", "", "\u0000"];
  for (const name of names) {
    const [guest] = await clients(t, srv, "sea-battle", 1);
    const seen = once(host, "peer");
    const joined = await guest.join(room, name, key);
    const expected = cleanName(name, "Player");
    assert.deepEqual(joined.peers.map((p) => p.name), ["Player", expected], JSON.stringify(name));
    assert.equal((await seen).name, expected, JSON.stringify(name));
    const gone = once(host, "leave");
    guest.close();
    await gone;
  }
  // Knocks show the host the cleaned name too.
  const [knocker] = await clients(t, srv, "sea-battle", 1);
  const knock = once(host, "knock");
  knocker.join(room, "n1gger").catch(() => {});
  assert.equal((await knock).name, "Player");
});

test("rooms are scoped by game slug and unknown games are refused", async (t) => {
  const srv = await startServer();
  const a = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  const b = new RoomClient({ game: "tic-tac-toe", url: srv.wsUrl });
  const c = new RoomClient({ game: "not-a-game", url: srv.wsUrl });
  t.after(async () => {
    a.close();
    b.close();
    c.close();
    await srv.close();
  });
  await Promise.all([a.connect(), b.connect(), c.connect()]);
  const { room } = await a.create("A");
  await assert.rejects(b.join(room, "B"), (err) => err.code === "no_such_room");
  await assert.rejects(c.create("C"), (err) => err.code === "bad_game");
  await assert.rejects(c.join(room, "C"), (err) => err.code === "bad_game");
});

test("host leaving closes the room for the guest", async (t) => {
  const srv = await startServer();
  const host = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  const guest = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  t.after(async () => {
    guest.close();
    await srv.close();
  });
  await Promise.all([host.connect(), guest.connect()]);
  const { room, key } = await host.create("H");
  await guest.join(room, "G", key);
  const gone = once(guest, "host-left");
  host.close();
  await gone;
  const late = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  await late.connect();
  await assert.rejects(late.join(room, "L"), (err) => err.code === "no_such_room");
  late.close();
});

test("malformed traffic gets error replies, not crashes", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const ws = new WebSocket(srv.wsUrl);
  const replies = [];
  ws.onmessage = (e) => replies.push(JSON.parse(e.data));
  await new Promise((r) => (ws.onopen = r));
  ws.send("not json");
  ws.send(JSON.stringify({ t: "signal", to: "999", data: {} }));
  ws.send(JSON.stringify({ t: "nope" }));
  ws.send(JSON.stringify({ t: "ping" }));
  for (const json of ["null", "5", '"create"', "true", "[]"]) ws.send(json);
  await until(() => replies.length === 10);
  assert.deepEqual(
    replies.map((m) => m.code || m.t),
    ["hello", "bad_json", "not_in_room", "unknown_type", "pong", "bad_json", "bad_json", "bad_json", "bad_json", "unknown_type"],
  );
  ws.close();
  assert.equal((await fetch(`${srv.base}/healthz`)).status, 200);
});

test("the 6th wrong code within a minute is refused and closes the connection; the budget is shared per IP", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host] = await clients(t, srv, "sea-battle", 1);
  const { room, key } = await host.create("H");
  const wrong = room === "ZZZZ" ? "YYYY" : "ZZZZ";

  const a = await rawSocket(t, srv);
  for (let i = 0; i < 5; i++) assert.equal((await guess(a, wrong)).code, "no_such_room", `guess ${i + 1}`);
  // The 6th try is refused even for a real code, so it can't tell rooms apart.
  assert.equal((await guess(a, room)).code, "rate_limited");
  await a.closed;

  // A new connection from the same address has no budget left either.
  const b = await rawSocket(t, srv);
  assert.equal((await guess(b, wrong)).code, "rate_limited");
  await b.closed;

  // The right key is never a guess, so it still gets in.
  const c = await rawSocket(t, srv);
  assert.equal((await c.ask({ t: "join", game: "sea-battle", room, key, name: "Bo" })).t, "joined");
});

test("rate limits: the client-IP header picks the bucket, CLIENT_IP_HEADER overrides it, and the window slides", async (t) => {
  const clock = { now: Date.now() };
  const srv = await startServer({ now: () => clock.now });
  t.after(() => srv.close());
  const spend = async (headers) => {
    const sock = await rawSocket(t, srv, headers);
    for (let i = 0; i < 5; i++) await guess(sock, "ZZZZ");
    return sock;
  };
  await spend({ "X-Forwarded-For": "203.0.113.7, 10.0.0.1" });
  const same = await rawSocket(t, srv, { "X-Forwarded-For": "203.0.113.7" });
  assert.equal((await guess(same, "ZZZZ")).code, "rate_limited");
  const other = await rawSocket(t, srv, { "X-Forwarded-For": "198.51.100.2" });
  assert.equal((await guess(other, "ZZZZ")).code, "no_such_room");
  clock.now += 60_000;
  const later = await rawSocket(t, srv, { "X-Forwarded-For": "203.0.113.7" });
  assert.equal((await guess(later, "ZZZZ")).code, "no_such_room", "budget back after the window");

  const custom = await startServer({ clientIpHeader: "Fly-Client-IP" });
  t.after(() => custom.close());
  const first = await rawSocket(t, custom, { "Fly-Client-IP": "192.0.2.1", "X-Forwarded-For": "198.51.100.9" });
  for (let i = 0; i < 5; i++) await guess(first, "ZZZZ");
  const sameIp = await rawSocket(t, custom, { "Fly-Client-IP": "192.0.2.1", "X-Forwarded-For": "198.51.100.10" });
  assert.equal((await guess(sameIp, "ZZZZ")).code, "rate_limited");
  const newIp = await rawSocket(t, custom, { "Fly-Client-IP": "192.0.2.2", "X-Forwarded-For": "198.51.100.9" });
  assert.equal((await guess(newIp, "ZZZZ")).code, "no_such_room");
});

test("a wrong invite key counts as a guess", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host] = await clients(t, srv, "sea-battle", 1);
  const { room, key } = await host.create("H");
  let knocked = false;
  host.on("knock", () => (knocked = true));
  const sock = await rawSocket(t, srv);
  const bad = key.replace(/^./, (c) => (c === "A" ? "B" : "A"));
  for (let i = 0; i < 5; i++) {
    assert.equal((await sock.ask({ t: "join", game: "sea-battle", room, key: bad, name: "X" })).code, "no_such_room");
  }
  assert.equal((await sock.ask({ t: "join", game: "sea-battle", room, key: bad, name: "X" })).code, "rate_limited");
  await sock.closed;
  assert.equal(knocked, false, "the host is never bothered by wrong keys");
});

test("a code-only join waits for the host: Accept seats it, Decline closes it", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host, bo, cy] = await clients(t, srv, "ludo", 3);
  const { room } = await host.create("Ada");
  const peers = [];
  host.on("peer", (p) => peers.push(p));

  const knock = once(host, "knock");
  const knocking = once(bo, "knocking");
  const boJoined = bo.join(room, "Bo");
  await knocking;
  assert.deepEqual(await knock, { id: bo.id, name: "Bo" });
  // Waiting at the door: no peer for the host, no relay to anyone.
  const door = await rawSocket(t, srv);
  const doorKnock = once(host, "knock");
  assert.deepEqual(await door.ask({ t: "join", game: "ludo", room, name: "Dee" }), { t: "knocking", game: "ludo", room });
  const { id: deeId } = await doorKnock;
  assert.equal((await door.ask({ t: "signal", to: host.id, data: { sdp: "nope" } })).code, "not_in_room");
  assert.deepEqual(peers, []);
  assert.equal((await (await fetch(`${srv.base}/healthz`)).json()).players, 1);
  host.decline(deeId);
  await door.closed;
  assert.deepEqual(door.replies.at(-1), { t: "error", code: "declined" });

  const boSeen = once(host, "peer");
  host.admit(bo.id);
  const joined = await boJoined;
  assert.equal(joined.host, host.id);
  await boSeen;
  assert.deepEqual(peers, [{ id: bo.id, name: "Bo" }]);

  const cyKnock = once(host, "knock");
  const cyJoined = cy.join(room, "Cy");
  await cyKnock;
  const cyClosed = once(cy, "close");
  host.decline(cy.id);
  await assert.rejects(cyJoined, (err) => err.code === "declined");
  await cyClosed;
  assert.equal(peers.length, 1);
});

test("an unanswered knock times out, a withdrawn one disappears, and only the host may answer", async (t) => {
  const srv = await startServer({ limits: { approvalMs: 150 } });
  t.after(() => srv.close());
  const [host, guest, knocker, quitter] = await clients(t, srv, "ludo", 4);
  const { room, key } = await host.create("Ada");
  await guest.join(room, "Bo", key);

  const knock = once(host, "knock");
  const pending = knocker.join(room, "Cy");
  const { id } = await knock;
  const notHost = once(guest, "error");
  guest.admit(id);
  assert.equal((await notHost).code, "not_host");
  const gone = once(host, "knock-gone");
  await assert.rejects(pending, (err) => err.code === "no_answer");
  assert.deepEqual(await gone, { id });

  const quitKnock = once(host, "knock");
  quitter.join(room, "Dee").catch(() => {});
  await quitKnock;
  const quitGone = once(host, "knock-gone");
  quitter.close();
  assert.deepEqual(await quitGone, { id: quitter.id });
});

test("the host closing the room tells anyone still knocking", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host, knocker] = await clients(t, srv, "sea-battle", 2);
  const { room } = await host.create("Ada");
  const knock = once(host, "knock");
  const pending = knocker.join(room, "Bo");
  await knock;
  host.close();
  await assert.rejects(pending, (err) => err.code === "host_left");
});

test("a 4-seat room admits keyed guests in join order until it is full", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host, ...guests] = await clients(t, srv, "ludo", 5);
  const { room, key } = await host.create("Ada");
  const names = ["Bo", "Cy", "Dee"];
  for (const [i, name] of names.entries()) {
    const joined = await guests[i].join(room, name, key);
    assert.deepEqual(joined.peers.map((p) => p.name), ["Ada", ...names.slice(0, i + 1)]);
  }
  await assert.rejects(guests[3].join(room, "Eve", key), (err) => err.code === "room_full");
  await assert.rejects(guests[3].join(room, "Eve"), (err) => err.code === "room_full", "no knocking on a full room");
  const health = await (await fetch(`${srv.base}/healthz`)).json();
  assert.equal(health.players, 4);
});

const ip = (addr) => ({ "X-Forwarded-For": addr });
const healthz = async (srv) => (await fetch(`${srv.base}/healthz`)).json();

test("one address may hold 20 connections; the 21st is refused and a closed one frees its slot", { timeout: 10_000 }, async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const socks = [];
  for (let i = 0; i < 20; i++) socks.push(await rawSocket(t, srv, ip("203.0.113.5")));
  assert.ok(socks.every((s) => s.replies[0].t === "hello"));

  const extra = await rawSocket(t, srv, ip("203.0.113.5"));
  assert.deepEqual(extra.replies, [{ t: "error", code: "too_many_connections" }]);
  assert.deepEqual(await extra.closed, { code: 1008, reason: "too_many_connections" });
  assert.equal((await rawSocket(t, srv, ip("198.51.100.5"))).replies[0].t, "hello", "other addresses are not affected");

  socks[0].ws.close();
  await socks[0].closed;
  const { id } = socks[0].replies[0];
  await until(() => ![...srv.wss.clients].some((ws) => ws.meta.id === id));
  assert.equal((await rawSocket(t, srv, ip("203.0.113.5"))).replies[0].t, "hello");

  // The browser client reports the code instead of a generic connection failure.
  for (let i = 0; i < 20; i++) await rawSocket(t, srv);
  const page = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  await assert.rejects(page.connect(), (err) => err.code === "too_many_connections");
});

test("one address may have 5 rooms waiting; the 6th is refused until one closes", { timeout: 10_000 }, async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const create = (sock) => sock.ask({ t: "create", game: "sea-battle", name: "H" });
  const hosts = [];
  for (let i = 0; i < 5; i++) {
    const sock = await rawSocket(t, srv, ip("203.0.113.6"));
    assert.equal((await create(sock)).t, "created");
    hosts.push(sock);
  }
  const sixth = await rawSocket(t, srv, ip("203.0.113.6"));
  assert.deepEqual(await create(sixth), { t: "error", code: "too_many_rooms" });
  assert.equal((await create(await rawSocket(t, srv, ip("198.51.100.6")))).t, "created", "other addresses are not affected");
  assert.equal((await healthz(srv)).rooms, 6);

  assert.equal((await hosts[0].ask({ t: "leave" })).t, "left");
  assert.equal((await create(sixth)).t, "created");
  hosts[1].ws.close();
  await hosts[1].closed;
  await until(() => srv.signaling.stats().rooms === 5);
  assert.equal((await create(await rawSocket(t, srv, ip("203.0.113.6")))).t, "created");
});

test("a family on one address plays a 4-player game: 4 connections, 1 room, signals relay", { timeout: 10_000 }, async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host, ...guests] = await clients(t, srv, "ludo", 4);
  const { room, key } = await host.create("Ada");
  for (const [i, g] of guests.entries()) await g.join(room, `Kid${i}`, key);
  for (const g of guests) {
    const got = once(g, "signal");
    host.signal(g.id, { sdp: { type: "offer", sdp: "v=0" } });
    assert.deepEqual(await got, { from: host.id, data: { sdp: { type: "offer", sdp: "v=0" } } });
  }
  const health = await healthz(srv);
  assert.equal(health.rooms, 1);
  assert.equal(health.players, 4);
});

test("a connection may send a burst of 60 messages and 20 a second; more gets too_fast and closes", { timeout: 10_000 }, async (t) => {
  const clock = { now: Date.now() };
  const srv = await startServer({ now: () => clock.now });
  t.after(() => srv.close());

  const steady = await rawSocket(t, srv);
  for (let i = 0; i < 200; i++) {
    clock.now += 50;
    assert.equal((await steady.ask({ t: "ping" })).t, "pong", `ping ${i + 1}`);
  }

  const flood = await rawSocket(t, srv);
  for (let i = 0; i < 70; i++) flood.ws.send(JSON.stringify({ t: "ping" }));
  assert.deepEqual(await flood.closed, { code: 1008, reason: "too_fast" });
  const answers = flood.replies.slice(1);
  assert.equal(answers.filter((m) => m.t === "pong").length, 60);
  assert.deepEqual(answers.at(-1), { t: "error", code: "too_fast" });
});

test("signal data up to 16 KB is relayed; bigger gets too_big and goes nowhere", { timeout: 10_000 }, async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host, guest] = await clients(t, srv, "sea-battle", 2);
  const { room, key } = await host.create("Ada");
  await guest.join(room, "Bo", key);
  const relayed = [];
  guest.on("signal", ({ data }) => relayed.push(data.length));

  const fits = "x".repeat(16 * 1024 - 2); // 16 KB once JSON adds the quotes
  const got = once(guest, "signal");
  host.signal(guest.id, fits);
  await got;
  const refused = once(host, "error");
  host.signal(guest.id, fits + "x");
  assert.equal((await refused).code, "too_big");
  // Relays keep their order, so once the next one arrives the big one never will.
  const next = once(guest, "signal");
  host.signal(guest.id, "y");
  await next;
  assert.deepEqual(relayed, [fits.length, 1]);
});

test("a room that doesn't start within 30 minutes closes for everyone and frees its slot", { timeout: 10_000 }, async (t) => {
  const clock = { now: Date.now() };
  const srv = await startServer({ now: () => clock.now });
  t.after(() => srv.close());
  const host = await rawSocket(t, srv, ip("203.0.113.8"));
  const { room, key } = await host.ask({ t: "create", game: "ludo", name: "Ada" });
  const guest = await rawSocket(t, srv);
  assert.equal((await guest.ask({ t: "join", game: "ludo", room, key, name: "Bo" })).t, "joined");
  const knocker = await rawSocket(t, srv);
  assert.equal((await knocker.ask({ t: "join", game: "ludo", room, name: "Cy" })).t, "knocking");
  const everyone = [host, guest, knocker];
  // Advance the clock; players keep pinging, so only the room's age matters.
  const after = async (ms) => {
    clock.now += ms;
    for (const s of everyone) if (s.ws.readyState === 1) await s.ask({ t: "ping" });
    srv.signaling.sweep(srv.wss.clients);
  };
  await after(30 * 60_000 - 1);
  assert.equal((await healthz(srv)).rooms, 1, "still open just before 30 minutes");

  await after(1);
  for (const s of everyone) {
    assert.deepEqual(await s.closed, { code: 1000, reason: "room_expired" });
    assert.deepEqual(s.replies.at(-1), { t: "error", code: "room_expired" });
  }
  assert.equal((await healthz(srv)).rooms, 0);
  const late = await rawSocket(t, srv);
  assert.equal((await late.ask({ t: "join", game: "ludo", room, key, name: "Dee" })).code, "no_such_room");

  // The expired room no longer counts against its host's address.
  for (let i = 0; i < 5; i++) {
    const again = await rawSocket(t, srv, ip("203.0.113.8"));
    assert.equal((await again.ask({ t: "create", game: "ludo", name: "Ada" })).t, "created");
  }
});

test("a message up to 64 KB is read; a bigger one closes the socket with 1009", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const sock = await rawSocket(t, srv);
  const pad = (bytes) => "x".repeat(bytes - JSON.stringify({ t: "ping", pad: "" }).length);
  assert.equal((await sock.ask({ t: "ping", pad: pad(64 * 1024) })).t, "pong");
  sock.ws.send(JSON.stringify({ t: "ping", pad: pad(64 * 1024 + 1) }));
  assert.equal((await sock.closed).code, 1009);
  assert.deepEqual(sock.replies.map((m) => m.t), ["hello", "pong"]);
});

// A socket that never touches the network, for tests that need thousands.
function fakeSocket() {
  const handlers = {};
  return { readyState: 1, handlers, send() {}, close() {}, terminate() {}, on: (type, fn) => (handlers[type] = fn) };
}

test("the server holds 10,000 rooms; the next create gets server_full until one closes", { timeout: 30_000 }, async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  // Filled in-process, with no client address, so the per-address limits don't apply.
  const hosts = Array.from({ length: 10_000 }, () => {
    const ws = fakeSocket();
    srv.signaling.handleConnection(ws, {});
    ws.handlers.message(JSON.stringify({ t: "create", game: "sea-battle", name: "H" }));
    return ws;
  });
  assert.equal(srv.signaling.stats().rooms, 10_000);
  const late = await rawSocket(t, srv);
  const create = () => late.ask({ t: "create", game: "ludo", name: "Ada" });
  assert.deepEqual(await create(), { t: "error", code: "server_full" });
  hosts[0].handlers.close();
  assert.equal((await create()).t, "created", "the socket stays open");
});

test("at most 4 knocks wait at a door; the 5th gets room_busy until one is answered", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host] = await clients(t, srv, "ludo", 1);
  const { room } = await host.create("Ada");
  const knock = (sock) => sock.ask({ t: "join", game: "ludo", room, name: "K" });
  const knockers = [];
  for (let i = 0; i < 4; i++) {
    const sock = await rawSocket(t, srv);
    assert.equal((await knock(sock)).t, "knocking", `knock ${i + 1}`);
    knockers.push(sock);
  }
  const fifth = await rawSocket(t, srv);
  assert.deepEqual(await knock(fifth), { t: "error", code: "room_busy" });
  host.decline(knockers[0].replies[0].id);
  await knockers[0].closed;
  assert.equal((await knock(fifth)).t, "knocking", "the socket stays open");
});

test("joining a room you are already in, seated or knocking, gets already_in_room", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const join = (sock, key) => sock.ask({ t: "join", game: "ludo", room, key, name: "X" });
  const host = await rawSocket(t, srv);
  const { room, key } = await host.ask({ t: "create", game: "ludo", name: "Ada" });
  assert.deepEqual(await join(host, key), { t: "error", code: "already_in_room" });
  assert.deepEqual(await join(host), { t: "error", code: "already_in_room" });
  const guest = await rawSocket(t, srv);
  assert.equal((await join(guest, key)).t, "joined");
  assert.deepEqual(await join(guest, key), { t: "error", code: "already_in_room" });
  const knocker = await rawSocket(t, srv);
  assert.equal((await join(knocker)).t, "knocking");
  assert.deepEqual(await join(knocker), { t: "error", code: "already_in_room" });
  assert.deepEqual(srv.signaling.stats(), { rooms: 1, players: 2, games: { ludo: 1 } });
});

test("admitting a knock into a room that filled meanwhile closes it with room_full", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host, guest] = await clients(t, srv, "sea-battle", 2);
  const { room, key } = await host.create("Ada");
  const knock = once(host, "knock");
  const knocker = await rawSocket(t, srv);
  assert.equal((await knocker.ask({ t: "join", game: "sea-battle", room, name: "Cy" })).t, "knocking");
  const { id } = await knock;
  await guest.join(room, "Bo", key);
  host.admit(id);
  assert.deepEqual(await knocker.closed, { code: 1000, reason: "room_full" });
  assert.deepEqual(knocker.replies.at(-1), { t: "error", code: "room_full" });
  assert.equal(srv.signaling.stats().players, 2);
});

test("a declined knock counts as a failed join for its connection and address", async (t) => {
  const srv = await startServer({ limits: { failedJoins: 1 } });
  t.after(() => srv.close());
  const [host] = await clients(t, srv, "ludo", 1);
  const { room, key } = await host.create("Ada");
  const join = (sock, key) => sock.ask({ t: "join", game: "ludo", room, key, name: "Bo" });
  const knock = once(host, "knock");
  const knocker = await rawSocket(t, srv, ip("203.0.113.9"));
  assert.equal((await join(knocker)).t, "knocking");
  host.decline((await knock).id);
  assert.deepEqual(await knocker.closed, { code: 1000, reason: "declined" });
  const again = await rawSocket(t, srv, ip("203.0.113.9"));
  assert.equal((await join(again)).code, "rate_limited");
  const keyed = await rawSocket(t, srv, ip("203.0.113.9"));
  assert.equal((await join(keyed, key)).t, "joined", "the right key still gets in");
});

test("admit or decline of an unknown knock, and a signal to yourself or anyone not seated, get no_such_peer", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host, guest, knocker] = await clients(t, srv, "ludo", 3);
  const { room, key } = await host.create("Ada");
  await guest.join(room, "Bo", key);
  const knock = once(host, "knock");
  const pending = knocker.join(room, "Cy");
  await knock;
  const error = async (send) => {
    const got = once(host, "error");
    send();
    return (await got).code;
  };
  assert.equal(await error(() => host.admit("999")), "no_such_peer");
  assert.equal(await error(() => host.decline("999")), "no_such_peer");
  assert.equal(await error(() => host.admit(guest.id)), "no_such_peer", "a seated guest is not a knock");
  assert.equal(await error(() => host.signal(host.id, {})), "no_such_peer");
  assert.equal(await error(() => host.signal("999", {})), "no_such_peer");
  assert.equal(await error(() => host.signal(knocker.id, {})), "no_such_peer", "a knocker can't be reached");
  host.admit(knocker.id);
  assert.equal((await pending).host, host.id, "the knock still waits");
});

test("create while in a room leaves it first: a host's room closes, a guest's seat frees", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host, guest, other] = await clients(t, srv, "ludo", 3);
  const first = await host.create("Ada");
  await guest.join(first.room, "Bo", first.key);
  const hostLeft = once(guest, "host-left");
  const second = await host.create("Ada");
  await hostLeft;
  assert.deepEqual(srv.signaling.stats(), { rooms: 1, players: 1, games: { ludo: 1 } });

  await other.join(second.room, "Cy", second.key);
  const left = once(host, "leave");
  await other.create("Cy");
  assert.deepEqual(await left, { id: other.id });
  assert.deepEqual(srv.signaling.stats(), { rooms: 2, players: 2, games: { ludo: 2 } });
});

test("the sweep drops a socket silent for more than 75 s", async (t) => {
  const clock = { now: Date.now() };
  const srv = await startServer({ now: () => clock.now });
  t.after(() => srv.close());
  const quiet = await rawSocket(t, srv);
  const chatty = await rawSocket(t, srv);
  clock.now += 75_000;
  srv.signaling.sweep(srv.wss.clients);
  assert.ok([...srv.wss.clients].every((ws) => ws.readyState === WebSocket.OPEN), "75 s is still in time");
  clock.now += 1;
  assert.equal((await chatty.ask({ t: "ping" })).t, "pong");
  srv.signaling.sweep(srv.wss.clients);
  assert.equal((await quiet.closed).code, 1006, "dropped without a close frame");
  assert.equal((await chatty.ask({ t: "ping" })).t, "pong", "a socket that pinged stays");
});

test("the sweep forgets an address's failed joins only once they leave the window", async (t) => {
  const clock = { now: Date.now() };
  const srv = await startServer({ now: () => clock.now, limits: { failedJoins: 1 } });
  t.after(() => srv.close());
  const fail = async (addr) => (await guess(await rawSocket(t, srv, ip(addr)), "ZZZZ")).code;
  assert.equal(await fail("203.0.113.10"), "no_such_room");
  clock.now += 30_000;
  assert.equal(await fail("203.0.113.11"), "no_such_room");
  clock.now += 30_000; // the first failure is a minute old, the second half a minute
  srv.signaling.sweep(srv.wss.clients);
  assert.equal(await fail("203.0.113.10"), "no_such_room", "budget back");
  assert.equal(await fail("203.0.113.11"), "rate_limited", "a failure still in the window is kept");
});
