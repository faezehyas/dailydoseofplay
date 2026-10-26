// Headless-browser test for the lobby's loaders (engine/dots.js): creating
// and joining a room over slow signaling show the four dots and reach "Room
// ready" and "Connected"; a lobby that never answers shows the help line and
// Try again works; and the waiting room's dots and seats follow a friend
// joining and a robot being added and removed in Ludo. No lobby screen has a
// spinner. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, waitForState, joinByInvite } from "../helpers.js";

const skip = skipWithoutPlaywright();

async function setup(t) {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  return { srv, assertNoErrors, open: (nickname, opts = {}) => open(nickname, { nickname, ...opts }) };
}

// Every frame from the lobby server reaches the page `ms` later; while
// `hold()` is true it never does.
const slowLobby = (page, ms, hold = () => false) =>
  page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => !hold() && setTimeout(() => ws.send(m), ms));
  });

// Which dots are home, whether they make the logo, and how many spinners the lobby has.
const dots = (page) =>
  page.evaluate(() => ({
    lit: [...document.querySelectorAll("#lobby .dots i")].flatMap((d, i) => (d.classList.contains("on") ? [i] : [])),
    done: !!document.querySelector("#lobby .dots-wait[data-done]"),
    spinners: document.querySelectorAll("#lobby .spinner").length,
  }));

// The waiting room's seats, as "classes: name".
const seats = (page) =>
  page.locator("#roster li.seat").evaluateAll((li) => li.map((s) => `${s.className.replace(/seat | pop/g, "")}: ${s.querySelector("span").textContent}`));

const playing = (page) => waitForState(page, (ddp) => ddp.match?.phase === "playing", undefined, { timeout: 30_000 });

// The words of #lobby-status each time they change, with the dots home
// then ("Room ready: 0123"), in window.statusSeen: some steps pass in a blink.
const watchStatus = (page) =>
  page.evaluate(() => {
    window.statusSeen = [];
    new MutationObserver(() => {
      const text = document.querySelector("#lobby-status")?.textContent;
      const lit = [...document.querySelectorAll("#lobby .dots i")].flatMap((d, i) => (d.classList.contains("on") ? [i] : [])).join("");
      if (text && !window.statusSeen.at(-1)?.startsWith(`${text}:`)) window.statusSeen.push(`${text}: ${lit}`);
    }).observe(document.querySelector("#lobby"), { subtree: true, childList: true, characterData: true });
  });

test("creating a room over a slow lobby shows the dots, the words, then Room ready", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada");
  await slowLobby(host, 4_000);
  await host.goto(`${srv.base}/connect-4/`);
  await host.locator("#play-friend").waitFor();
  await watchStatus(host);
  await host.click("#play-friend");
  const cue = host.locator(".dots-cue");
  assert.equal(await cue.evaluate((c) => getComputedStyle(c).opacity), "0", "nothing shows at first");
  assert.equal(await host.locator("#lobby-status").isVisible(), false, "no words yet");
  await host.locator("#lobby-status", { hasText: "Creating your room" }).waitFor({ timeout: 5_000 });
  assert.deepEqual((await dots(host)).lit, [0], "the lobby connection lit one dot");
  assert.equal(await host.locator("#wait-retry").isVisible(), false, "no help line before 10 s");
  await host.locator(".dots-wait[data-done] #lobby-status", { hasText: "Room ready" }).waitFor({ timeout: 10_000 });
  assert.deepEqual(await dots(host), { lit: [0, 1, 2, 3], done: true, spinners: 0 });
  await host.locator("#room-code").waitFor({ timeout: 5_000 });
  const seen = await host.evaluate(() => window.statusSeen);
  assert.deepEqual(seen.slice(0, 3), ["Reaching the server: ", "Creating your room: 0", "Room ready: 0123"]);
  assertNoErrors();
});

test("joining by code over a slow lobby lights a dot per step and reaches Connected", { skip, timeout: 90_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada");
  await host.goto(`${srv.base}/connect-4/`);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  assert.deepEqual(await seats(host), ["ready: You", "empty: Open seat"]);
  assert.deepEqual((await dots(host)).lit, [0, 2], "your seat brings two dots home");
  const code = (await host.locator("#room-code").innerText()).trim();

  const bo = await open("Bo");
  await slowLobby(bo, 1_000);
  await bo.goto(`${srv.base}/connect-4/`);
  await bo.locator("#join-code").waitFor();
  await watchStatus(bo);
  await bo.locator("#join-code").fill(code);
  await bo.locator("#lobby-status", { hasText: `Looking for room ${code}` }).waitFor({ state: "attached" });
  await bo.locator("#lobby-status", { hasText: "Waiting for the host to let you in" }).waitFor({ timeout: 10_000 });
  assert.deepEqual(await dots(bo), { lit: [0], done: false, spinners: 0 }, "the room was found");
  await host.locator("#roster li.knock").getByRole("button", { name: "Accept" }).click();
  // The host's full table holds its logo for a second, so "Connected" stays that long.
  await bo.locator(".dots-wait[data-done] #lobby-status", { hasText: "Connected" }).waitFor({ timeout: 30_000 });
  assert.deepEqual(await dots(bo), { lit: [0, 1, 2, 3], done: true, spinners: 0 });
  for (const page of [host, bo]) await playing(page);
  assert.deepEqual(await bo.evaluate(() => window.statusSeen), [`Looking for room ${code}: `, "Waiting for the host to let you in: 0", "Connecting to Ada: 012", "Connected: 0123"]);
  assertNoErrors();
});

test("a lobby that doesn't answer shows the help line at 10 s, and Try again makes the room", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada");
  let down = true;
  await slowLobby(host, 0, () => down);
  await host.goto(`${srv.base}/connect-4/`);
  await host.click("#play-friend");
  await host.locator("#lobby-status", { hasText: "Reaching the server" }).waitFor({ timeout: 5_000 });
  const started = Date.now();
  const help = host.locator(".dots-help", { hasText: "Taking a while? Check your connection or try again." });
  await help.waitFor({ timeout: 15_000 });
  assert.ok(Date.now() - started > 6_000, "the help line waits for about 10 s");
  assert.equal(await host.locator("#lobby-progress").textContent(), "Taking a while? Check your connection or try again.", "and is read out");
  assert.equal((await dots(host)).spinners, 0);
  down = false;
  await host.click("#wait-retry");
  await host.locator("#room-code").waitFor({ timeout: 10_000 });
  assertNoErrors();
});

test("Ludo's waiting room: the dots and seats follow a friend joining and a robot added and removed", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada", { reducedMotion: "reduce" });
  await host.goto(`${srv.base}/ludo/`);
  assert.equal((await dots(host)).spinners, 0, "the home screen");
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  assert.deepEqual(await seats(host), ["ready: You", "empty: Open seat", "empty: Open seat", "empty: Open seat"]);
  assert.deepEqual(await dots(host), { lit: [0], done: false, spinners: 0 });
  assert.equal(await host.locator("#lobby-status").innerText(), "Waiting for friends to join…");

  const bo = await open("Bo");
  await joinByInvite(host, bo, srv);
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  assert.deepEqual(await seats(host), ["ready: You", "ready: Bo", "empty: Open seat", "empty: Open seat"]);
  assert.deepEqual((await dots(host)).lit, [0, 1]);
  assert.equal(await host.locator("#roster li.pop").innerText().then((s) => s.split("\n")[1]), "Bo", "the seat that filled pops");

  await host.click("#add-robot");
  await host.click("#add-robot");
  await host.locator(".dots-wait[data-done]").waitFor();
  assert.deepEqual(await seats(host), ["ready: You", "ready: Bo", "ready robot: Robot 1", "ready robot: Robot 2"]);
  assert.deepEqual(await dots(host), { lit: [0, 1, 2, 3], done: true, spinners: 0 }, "a full table makes the logo");
  assert.equal(await host.evaluate(() => document.querySelector("#lobby .dots-wait").getAnimations({ subtree: true }).length), 0, "nothing moves with reduced motion");

  await host.getByRole("button", { name: "Remove Robot 1" }).click();
  await host.locator(".dots-wait:not([data-done])").waitFor();
  assert.deepEqual(await seats(host), ["ready: You", "ready: Bo", "ready robot: Robot 2", "empty: Open seat"]);
  assert.deepEqual((await dots(host)).lit, [0, 1, 2]);
  await host.click("#add-robot");
  await host.click("#start-game");
  await playing(host);
  assertNoErrors();
});
