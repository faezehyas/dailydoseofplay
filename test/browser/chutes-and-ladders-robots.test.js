// Headless-browser test for Chutes and Ladders: a robot game on a phone with
// the spinner, hops, sounds, the mute button and the keyboard; and a game
// against three robots. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, waitForPhase, waitForSameState, noHorizontalScroll, pick } from "../helpers.js";
import { state, settled, spinUntilOver } from "./chutes-and-ladders.shared.js";

const skip = skipWithoutPlaywright();

test("Chutes and Ladders vs the robot on a 360 px phone: spinner, hops, sounds, mute and keyboard", { skip, timeout: 240_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("player", { phone: true, colorScheme: "light", init: () => (window.ddpSounds = []) });
  const heard = () => page.evaluate(() => window.ddpSounds.slice());

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="chutes-and-ladders"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "first", "host");
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/cl-3-settings-mobile-light.png`, fullPage: true });
  await page.click("#play-robot");
  await waitForState(page, (ddp) => ddp.match?.phase === "playing");
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot/);
  assert.equal(await page.locator("#cl-config").innerText(), "exact spin to finish · one spin a turn");
  assert.ok(await noHorizontalScroll(page));
  assert.match(await page.locator(".pb-who.p0").innerText(), /start/);

  // Spin by touch: the pointer spins and clicks, then the pawn hops square by square.
  await page.tap("#cl-spin");
  await page.locator("#cl-status").filter({ hasText: "Spinning" }).waitFor();
  assert.ok(await page.locator("#cl-spin").isDisabled(), "one spin at a time");
  await waitForState(page, (ddp) => ddp.match.state.ply >= 1);
  const first = (await state(page)).last;
  await waitForState(page, (_, n) => document.querySelector("#cl-spin-value").textContent === String(n), first.spin);
  await waitForState(page, (ddp) => ddp.match.state.turn === 0 && ddp.match.state.ply >= 2, undefined, { timeout: 30_000 });
  await settled(page);
  await page.screenshot({ path: `${ARTIFACTS}/cl-4-robot-mobile-light.png`, fullPage: true });
  const sounds = await heard();
  for (const name of ["flick", "tick", "settle", "hop"]) assert.ok(sounds.includes(name), `played ${name}: ${sounds.join(" ")}`);
  assert.ok(sounds.filter((n) => n === "hop").length >= first.path.length, "a hop sound per square");
  assert.equal(await page.locator("#cl-log li").count(), 2, "both spins are in the log");
  const shownMine = await page.evaluate(() => document.querySelector(".pb-who.p0 .pb-note").textContent);
  assert.equal(shownMine, (await state(page)).pos[0] === 0 ? "start" : `square ${(await state(page)).pos[0]}`, "the pawn shows where the rules put it");

  // Spin by keyboard; with the sound muted nothing more plays.
  await page.click("#sound-toggle");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  const before = (await heard()).length;
  await page.locator("#cl-spin").focus();
  await page.keyboard.press("Enter");
  await waitForState(page, (ddp) => ddp.match.state.ply >= 3);
  await waitForState(page, (ddp) => ddp.match.state.turn === 0 || ddp.match.phase !== "playing", undefined, { timeout: 30_000 });
  await settled(page);
  assert.equal((await heard()).length, before, "no sound while muted");
  await page.click("#sound-toggle");

  // The rest of the game at speed: reduced motion plays each spin out at once.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await spinUntilOver(page, { tap: true });
  // The last spin reaches the robot's table after mine: wait for its match to end too.
  await waitForPhase(page);
  const st = await state(page);
  assert.equal(st.pos[st.winner], 100);
  assert.equal(await page.evaluate(() => window.ddp.robot.match.state.ply), st.ply, "the robot saw every spin");
  await page.locator("#result").waitFor();
  assert.match(await page.locator("#result").innerText(), /^(You won|You lost)$/);
  assert.ok((await heard()).includes(st.winner === 0 ? "win-bell" : "loss-bell"));
  assert.ok(await page.locator("#result-panel").isVisible());
  await page.screenshot({ path: `${ARTIFACTS}/cl-5-robot-over-light.png`, fullPage: true });

  // The robot accepts a rematch; dark mode still fits the phone.
  await page.click("#rematch");
  await waitForState(page, (ddp) => ddp.match.m === 2 && ddp.match.phase === "playing");
  assert.deepEqual((await state(page)).pos, [0, 0]);
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.screenshot({ path: `${ARTIFACTS}/cl-6-robot-dark.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assertNoErrors();
});

test("Chutes and Ladders against three robots", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("player", { viewport: { width: 360, height: 740 }, reducedMotion: "reduce" });
  await page.goto(`${srv.base}/chutes-and-ladders/`);
  await page.click('label:has(input[name="cl-players"][value="4"])');
  await page.click("#play-robot");
  await waitForState(page, (ddp) => ddp.match?.phase === "playing");
  assert.match(await page.locator(".pb-players").innerText(), /Robot 1[\s\S]*Robot 2[\s\S]*Robot 3/);
  assert.ok(await noHorizontalScroll(page));
  await spinUntilOver(page);
  // The last spin reaches the robots' tables after mine: wait until they agree.
  const st = await waitForSameState(page);
  assert.equal(st.players, 4);
  assert.equal(st.pos[st.winner], 100);
  for (let k = 0; k < 3; k++) assert.deepEqual(await page.evaluate((k) => window.ddp.robots[k].match.state, k), st, `robot ${k + 1} agrees`);
  await page.locator("#result").waitFor();
  await page.screenshot({ path: `${ARTIFACTS}/cl-9-three-robots.png`, fullPage: true });
  assertNoErrors();
});
