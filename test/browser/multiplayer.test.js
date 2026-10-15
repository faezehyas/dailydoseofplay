// Headless-browser test for rooms of more than two players. No real game
// allows that yet, so this serves a copy of public/ that adds the test-only
// "party" game (test/fixtures/party, up to three players). Three browser
// contexts meet through the invite link, connect over real WebRTC through the
// host, play matches on shared dice, and see a player leave. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { skipWithoutPlaywright, openBrowser, waitForState, joinByInvite } from "../helpers.js";
import { PUBLIC_DIR } from "../../server/app.js";

const skip = skipWithoutPlaywright();

function partySite() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ddp-party-"));
  for (const entry of readdirSync(PUBLIC_DIR)) {
    if (entry !== "games.json") symlinkSync(path.join(PUBLIC_DIR, entry), path.join(dir, entry));
  }
  symlinkSync(path.resolve("test/fixtures/party"), path.join(dir, "party"));
  const registry = JSON.parse(readFileSync(path.join(PUBLIC_DIR, "games.json"), "utf8"));
  registry.games.push({ slug: "party", name: "Party", status: "ready", players: "2-3 players", maxPlayers: 3, description: "Test game." });
  writeFileSync(path.join(dir, "games.json"), JSON.stringify(registry));
  return dir;
}

async function setup(t) {
  const dir = partySite();
  const { srv, open, assertNoErrors } = await openBrowser(t, { server: { publicDir: dir } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { srv, assertNoErrors, open: (nickname, opts = {}) => open(nickname, { nickname, viewport: { width: 390, height: 844 }, ...opts }) };
}

// Everyone rolls in turn until the match is over; returns the final states.
async function playOut(pages) {
  for (let guard = 0; guard < 100; guard++) {
    const phases = await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.match.phase)));
    assert.ok(!phases.includes("aborted"), "match aborted");
    if (phases.every((ph) => ph === "over")) break;
    const can = await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.match.canMove())));
    const k = can.indexOf(true);
    if (k < 0) {
      await pages[0].waitForTimeout(20);
      continue;
    }
    const before = await pages[k].evaluate(() => window.ddp.match.state.log.length);
    await pages[k].click("#move");
    for (const p of pages) await waitForState(p, (ddp, n) => ddp.match.state.log.length > n, before);
  }
  return Promise.all(pages.map((p) => p.evaluate(() => window.ddp.match.state)));
}

test("three friends fill a room through the invite link, play on shared dice, rematch, and see a player leave", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada");
  await host.goto(`${srv.base}/party/`);
  assert.equal(await host.locator("#play-friend").innerText(), "Play with friends");
  const { invite } = await joinByInvite(host, [], srv);
  assert.match(await host.locator("#roster").innerText(), /Ada\s+host/);
  assert.equal(await host.locator("#start-game").isDisabled(), true, "can't start alone");

  const bo = await open("Bo");
  await joinByInvite(host, bo, srv);
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  assert.equal(await host.locator("#start-game").innerText(), "Start game (2 players)");
  await bo.locator("#lobby-status", { hasText: "Waiting for Ada to start (2 players in)" }).waitFor();

  // The third player fills the room, so the game starts by itself.
  const cy = await open("Cy");
  await joinByInvite(host, cy, srv);
  const pages = [host, bo, cy];
  for (const p of pages) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
  assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.session.index))), [0, 1, 2]);
  assert.equal(await cy.locator("#party-players").innerText(), "Ada, Bo, Cy (you)");
  assert.equal(await host.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no horizontal scroll");

  const [a, b, c] = await playOut(pages);
  assert.deepEqual(b, a, "Bo agrees with Ada");
  assert.deepEqual(c, a, "Cy agrees with Ada");
  assert.deepEqual(new Set(a.log.map(([seat]) => seat)), new Set([0, 1, 2]), "everyone rolled");

  // The room was freed when the game started.
  const late = await open("Dee");
  await late.goto(invite);
  await late.click("#join-room");
  await late.locator("#join-error", { hasText: "doesn't exist any more" }).waitFor();

  // A rematch needs all three votes.
  await host.click("#rematch");
  await bo.click("#rematch");
  await cy.locator("#party-status", { hasText: "Rematch votes: 2" }).waitFor();
  assert.equal(await host.evaluate(() => window.ddp.match.m), 1);
  await cy.click("#rematch");
  for (const p of pages) await waitForState(p, (ddp) => ddp.match.m === 2 && ddp.match.phase === "playing");
  const [a2, b2, c2] = await playOut(pages);
  assert.deepEqual([b2, c2], [a2, a2]);

  // A guest leaving: a robot plays on for them, and the others are told.
  await cy.close();
  for (const p of [host, bo]) await p.locator("#toast", { hasText: /Cy left|connection to Cy was lost/ }).waitFor({ state: "attached", timeout: 20_000 });
  await waitForState(host, (ddp) => ddp.session.players[2].robot && ddp.robots.length === 1);
  // The host leaving ends the game for the others, who are told who left.
  await host.close();
  await bo.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await bo.locator("#ended").innerText(), /Ada (left the game|.*lost)/);
  assertNoErrors();
});

test("the host can start before the room is full; a guest who leaves the waiting room drops off the list", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada");
  await host.goto(`${srv.base}/party/`);

  const quitter = await open("Quinn");
  await joinByInvite(host, quitter, srv);
  await host.locator("#roster li.ready", { hasText: "Quinn" }).waitFor();
  await quitter.close();
  await host.locator("#toast", { hasText: "Quinn left. The invite link still works." }).waitFor();
  assert.doesNotMatch(await host.locator("#roster").innerText(), /Quinn/);
  assert.equal(await host.locator("#start-game").isDisabled(), true);

  const bo = await open("Bo");
  await joinByInvite(host, bo, srv);
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  await host.click("#start-game");
  for (const p of [host, bo]) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
  assert.equal(await bo.evaluate(() => window.ddp.session.players.length), 2);
  const [a, b] = await playOut([host, bo]);
  assert.deepEqual(b, a);

  // The host leaving ends it for the guest.
  await host.click("#leave");
  await bo.locator("#ended", { hasText: "Ada left the game." }).waitFor({ timeout: 20_000 });
  assertNoErrors();
});

test("against robots (straight from a ?robot link), every robot seat plays", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const page = await open("Ada");
  await page.goto(`${srv.base}/party/?robot`);
  await waitForState(page, (ddp) => ddp.match?.phase === "playing");
  assert.equal(await page.locator("#party-players").innerText(), "Ada (you), Robot 1, Robot 2");
  const [state] = await playOut([page]);
  assert.equal(state.players, 3);
  assert.equal(await page.evaluate(() => window.ddp.robots.length), 2);
  for (const k of [0, 1]) assert.deepEqual(await page.evaluate((k) => window.ddp.robots[k].match.state, k), state, `robot ${k + 1} agrees`);
  assertNoErrors();
});

test("a browser that sends an oversized message is cut off, and the others are told why", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const UNEXPECTED = "A player's browser sent something unexpected.";
  const huge = () => window.ddp.session.send({ t: "spam", pad: "x".repeat(70_000) });
  async function room(host) {
    await host.goto(`${srv.base}/party/`);
    await joinByInvite(host, [], srv);
  }

  // A guest sends it during the game: the host refuses it unread, cuts them off and a robot takes their seat.
  const ada = await open("Ada");
  await room(ada);
  const bo = await open("Bo");
  await joinByInvite(ada, bo, srv);
  await ada.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  const cy = await open("Cy");
  await joinByInvite(ada, cy, srv);
  for (const p of [ada, bo, cy]) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
  await cy.evaluate(huge);
  for (const p of [ada, bo]) await p.locator("#toast", { hasText: `${UNEXPECTED} A robot plays their seat.` }).waitFor({ state: "attached", timeout: 20_000 });
  await cy.locator("#ended", { hasText: "The connection to Ada was lost." }).waitFor({ timeout: 20_000 });

  // A guest sends it in the waiting room (its first message, padded with spaces, is still valid JSON).
  const host = await open("Dee");
  await room(host);
  const padded = () => {
    const send = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (data) {
      return send.call(this, " ".repeat(70_000) + data);
    };
  };
  const odd = await open("Mo", { init: padded });
  await joinByInvite(host, odd, srv);
  await host.locator("#toast", { hasText: `${UNEXPECTED} The invite link still works.` }).waitFor({ timeout: 20_000 });
  assert.doesNotMatch(await host.locator("#roster").innerText(), /Mo/);

  // The host sends it: the guest refuses it.
  const eve = await open("Eve");
  await joinByInvite(host, eve, srv);
  await host.locator("#roster li.ready", { hasText: "Eve" }).waitFor();
  await host.click("#start-game");
  for (const p of [host, eve]) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
  await host.evaluate(huge);
  await eve.locator("#ended", { hasText: UNEXPECTED }).waitFor({ timeout: 20_000 });
  assertNoErrors();
});
