// Headless-browser test for Chutes and Ladders: four friends in four browsers
// through the hub play a full game, then a rematch, then one leaves. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, joinByInvite, noHorizontalScroll } from "../helpers.js";
import { state, colours, spinUntilOver } from "./chutes-and-ladders.shared.js";

const skip = skipWithoutPlaywright();

test("four friends fill a Chutes and Ladders room and play a full game, then a rematch", { skip, timeout: 240_000 }, async (t) => {
  const { srv, open: openPage, assertNoErrors } = await openBrowser(t);
  const open = (nickname, opts = {}) => openPage(nickname, { nickname, viewport: { width: 1200, height: 900 }, reducedMotion: "reduce", ...opts });
  const host = await open("Ada");
  await host.goto(`${srv.base}/chutes-and-ladders/`);
  assert.equal(await host.locator("#play-friend").innerText(), "Play with friends");
  const friends = [];
  for (const [name, opts] of [["Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" }], ["Cy", {}], ["Di", {}]]) {
    const page = await open(name, opts);
    await joinByInvite(host, page, srv);
    friends.push(page);
  }
  // The fourth player fills the room, so the game starts by itself.
  const pages = [host, ...friends];
  for (const p of pages) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
  assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.session.index))), [0, 1, 2, 3]);
  for (const p of pages) {
    assert.equal(await p.locator(".cl-board .pawn").count(), 4, "four pawns on the board");
    assert.equal(await p.locator(".pb-who").count(), 4);
    assert.equal(await p.locator("#score > div").count(), 4);
  }
  assert.match(await friends[1].locator(".pb-players").innerText(), /Cy \(you\)[\s\S]*Ada[\s\S]*Bo[\s\S]*Di/, "you first, then the others in seat order");
  const seen = await Promise.all(pages.map(colours));
  assert.deepEqual(seen[0], { Ada: "--accent --accent", Bo: "--accent-2 --accent-2", Cy: "--cl-p2 --cl-p2", Di: "--cl-p3 --cl-p3" }, "colours go by seat");
  for (const c of seen.slice(1)) assert.deepEqual(c, seen[0], "every screen shows each player in the same colour");
  assert.ok(await noHorizontalScroll(friends[0]), "four players fit a 360 px phone");
  await friends[0].screenshot({ path: `${ARTIFACTS}/cl-7-four-mobile-dark.png`, fullPage: true });

  async function playOut() {
    await Promise.all(pages.map((p) => spinUntilOver(p)));
    for (const p of pages) await waitForState(p, (ddp) => ddp.match.phase === "over", undefined, { timeout: 60_000 });
    const states = await Promise.all(pages.map(state));
    for (const st of states.slice(1)) assert.deepEqual(st, states[0], "all four browsers end on the same state");
    assert.equal(states[0].pos[states[0].winner], 100);
    assert.ok(states[0].spins.every((n) => n > 0), "everyone spun");
    return states[0];
  }
  const won = await playOut();
  const winnerPage = pages[won.winner];
  await winnerPage.locator("#result").filter({ hasText: "You won" }).waitFor();
  for (const p of pages.filter((p) => p !== winnerPage)) {
    await p.locator("#result-reason").waitFor();
    assert.match(await p.locator("#result-reason").innerText(), /reached 100 in \d+ spins?[\s\S]*Behind: .* and .*/);
  }
  await host.screenshot({ path: `${ARTIFACTS}/cl-8-four-over.png`, fullPage: true });

  // A rematch needs all four.
  for (const p of pages.slice(0, 3)) await p.click("#rematch");
  await friends[2].locator("#rematch-status").filter({ hasText: "Ada, Bo and Cy want a rematch!" }).waitFor();
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Di" }).waitFor();
  await friends[2].click("#rematch");
  for (const p of pages) await waitForState(p, (ddp) => ddp.match.m === 2 && ddp.match.phase === "playing");
  await playOut();

  // One player leaves: a robot plays on for them. The host leaves: the game ends for the others.
  await friends[1].close();
  for (const p of [host, friends[0], friends[2]]) await p.locator(".pb-name", { hasText: "Cy (robot)" }).waitFor({ timeout: 20_000 });
  await host.close();
  for (const p of [friends[0], friends[2]]) {
    await p.locator("#ended").waitFor({ timeout: 20_000 });
    assert.match(await p.locator("#ended").innerText(), /Ada (left the game|.*lost)/);
  }
  assertNoErrors();
});
