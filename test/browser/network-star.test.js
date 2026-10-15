// Headless-browser test for a four-player Ludo room whose guest's browser
// vanishes without leaving: once the host's grace period is over, a robot
// takes the seat and the others play on. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, waitForState, waitForSameState, joinByInvite, recordEvents } from "../helpers.js";
import { autoplay, stopAutoplay } from "./ludo.shared.js";

const skip = skipWithoutPlaywright();

test("a guest's browser vanishes from a four-player Ludo room: a robot takes the seat and the game goes on", { skip, timeout: 150_000 }, async (t) => {
  const { srv, open: openPage, assertNoErrors } = await openBrowser(t);
  const open = (nickname) => openPage(nickname, { nickname, seed: `network-star-${nickname}`, reducedMotion: "reduce" });
  const host = await open("Ada");
  await host.goto(`${srv.base}/ludo/`);
  const friends = [];
  for (const name of ["Bo", "Cy", "Di"]) {
    const page = await open(name);
    await joinByInvite(host, page, srv);
    friends.push(page);
  }
  // The fourth player fills the room, so the game starts by itself.
  const pages = [host, ...friends];
  for (const p of pages) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
  await Promise.all(pages.map(autoplay));
  await waitForState(host, (ddp) => ddp.match.state.ply >= 12, undefined, { timeout: 60_000 });

  // No pagehide, so no goodbye: the host's link only stops hearing from Cy.
  const [bo, cy, di] = friends;
  await cy.context().close({ runBeforeUnload: false });
  const left = [host, bo, di];
  for (const p of left) {
    await p.locator(".toast", { hasText: "The connection to Cy was lost. A robot plays their seat." }).waitFor({ state: "attached", timeout: 30_000 });
    await p.locator(".pb-name", { hasText: "Cy (robot)" }).waitFor();
  }
  assert.equal(await host.evaluate(() => window.ddp.robots.length), 1);
  for (const p of left) assert.equal(await p.locator("#ended").count(), 0, "the game goes on");

  // The robot plays Cy's seat (2), and everyone stays in step.
  await recordEvents(host);
  await waitForState(host, () => window.ddpEvents.some((e) => e.player === 2), undefined, { timeout: 60_000, why: "the robot moves for Cy" });
  await Promise.all(left.map(stopAutoplay));
  await waitForSameState(left);
  assertNoErrors();
});
