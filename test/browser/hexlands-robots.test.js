// Headless-browser test for Hexlands: a game against two robots on a 360 px
// phone, from the lobby's settings to the "Fair play verified" result: the
// first settlement and road placed by touch, a hand that shows only your
// cards, the sounds and the mute button, the move timer, a 7 with a discard
// chosen on the steppers, reduced motion, a rematch and dark mode. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, waitForPhase, noHorizontalScroll, pick } from "../helpers.js";
import { state, resultInView, autoplay, stopAutoplay, played, leaks, watchLeaks, leaked, handShown, handHeld, seatCards } from "./hexlands.shared.js";

const skip = skipWithoutPlaywright();

const myTurn = (page) => waitForState(page, () => !!document.querySelector(".hexlands.my-turn") || window.ddp.match.phase !== "playing", undefined, { timeout: 120_000, why: "my turn" });

test("Hexlands against two robots on a 360 px phone: placing by touch, a hidden hand, sounds, mute, timer, a discard and a verified game", { skip, timeout: 600_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("player", { phone: true, colorScheme: "light", clock: true, seed: "hexlands-robots", init: () => (window.ddpSounds = []) });
  const heard = () => page.evaluate(() => window.ddpSounds.slice());

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="hexlands"] h2 a, .game-card[data-slug="hexlands"]');
  await page.locator("#play-robot").waitFor();
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "level", "hard");
  await pick(page, "moveSeconds", 30);
  await page.click('label:has(input[name="hx-players"][value="3"])');
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/hx-1-settings-mobile.png`, fullPage: true });
  assert.equal(await page.locator("#play-robot").innerText(), "Play vs 2 robots");
  await page.tap("#play-robot");
  await waitForState(page, (ddp) => ddp.match?.phase === "playing", undefined, { timeout: 60_000 });
  await watchLeaks(page);
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot 1[\s\S]*Robot 2/);
  assert.equal(await page.locator("#hx-config").innerText(), "Game to 10 · 30 s a move · Hard robots");
  assert.ok(await noHorizontalScroll(page), "the island, the bank and three seats fit a 360 px phone");

  // The first settlement and its road, by touch on the island's glowing spots.
  await myTurn(page);
  assert.equal((await state(page)).phase, "setup");
  assert.match(await page.locator("#hx-panel").innerText(), /Place your first settlement/);
  const corners = await page.locator(".hx-spot-corner").evaluateAll((els) => els.map((e) => Number(e.dataset.spot)));
  assert.ok(corners.length > 20, "most corners are open at the start");
  await page.screenshot({ path: `${ARTIFACTS}/hx-2-setup-mobile.png` });
  await page.locator(`.hx-spot-corner[data-spot="${corners[0]}"]`).tap();
  await waitForState(page, (ddp, c) => ddp.match.state.buildings[c]?.p === ddp.match.me, corners[0]);
  await myTurn(page);
  assert.match(await page.locator("#hx-panel").innerText(), /Place a road/);
  const edge = await page.locator(".hx-spot-edge").first().getAttribute("data-spot");
  await page.locator(`.hx-spot-edge[data-spot="${edge}"]`).tap();
  await waitForState(page, (ddp, e) => ddp.match.state.roads[e] === ddp.match.me, Number(edge));
  const sounds = await heard();
  for (const name of ["turn", "build-settlement", "build-road"]) assert.ok(sounds.includes(name), `played ${name}: ${sounds.join(" ")}`);

  // The second settlement collects a card from each land it touches: your hand shows them, the others' pills only a count.
  await autoplay(page, { level: "hard" });
  await waitForState(page, (ddp) => ddp.match.state.phase !== "setup", undefined, { timeout: 60_000 });
  await stopAutoplay(page);
  await myTurn(page);
  assert.deepEqual(await handShown(page), await handHeld(page), "your hand shows your own cards");
  const cards = await seatCards(page);
  assert.deepEqual(cards.shown, cards.held, "each pill counts that seat's cards");
  assert.ok((await heard()).includes("gain"), "the second settlement's cards chimed in");

  // Muted: nothing more plays.
  await page.click("#sound-toggle");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  const quiet = (await heard()).length;
  const moves = (await state(page)).moves;
  await autoplay(page, { level: "hard" });
  await waitForState(page, (ddp, n) => ddp.match.state.moves > n + 15 || ddp.match.phase !== "playing", moves, { timeout: 120_000 });
  await stopAutoplay(page);
  assert.equal((await heard()).length, quiet, "no sound while muted");
  await page.click("#sound-toggle");

  // The move timer: leave a choice alone and the clock makes a move for you.
  await waitForState(page, () => !!document.querySelector(".hexlands.my-turn #hx-timer.p-0:not([hidden])"), undefined, { timeout: 120_000, why: "my clock runs" });
  const from = (await state(page)).moves;
  await page.screenshot({ path: `${ARTIFACTS}/hx-3-timer-mobile.png` });
  await page.clock.fastForward("00:31");
  await waitForState(page, (ddp, n) => ddp.match.state.moves > n, from, { timeout: 15_000 });
  await page.locator("#toast", { hasText: "Time's up" }).waitFor({ state: "attached" });

  // With reduced motion, hold on to every card until a 7 makes you discard half, chosen on the steppers.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await autoplay(page, { level: "hard", hoard: true, hold: ["discard"] });
  await waitForState(page, (ddp) => !!document.querySelector(".hexlands.my-turn #hx-discard") || ddp.match.phase !== "playing", undefined, { timeout: 240_000, why: "a 7 with more than 7 cards" });
  await stopAutoplay(page);
  const before = await handHeld(page);
  const owe = Math.floor(before.piles.reduce((a, b) => a + b, 0) / 2);
  assert.match(await page.locator("#hx-panel").innerText(), new RegExp(`Discard ${owe} cards`));
  assert.equal(await page.locator("#hx-discard").innerText(), `0 of ${owe} chosen`);
  assert.ok(await page.locator("#hx-discard").isDisabled(), "nothing to discard yet");
  const give = [0, 0, 0, 0, 0];
  for (let n = 0; n < owe; n++) {
    const r = before.piles.map((c, i) => c - give[i]).reduce((best, c, i, all) => (c > all[best] ? i : best), 0);
    give[r]++;
    await page.locator(`#hx-discard-more-${r}`).tap();
  }
  await page.screenshot({ path: `${ARTIFACTS}/hx-4-discard-mobile.png` });
  assert.equal(await page.locator("#hx-discard").innerText(), `Discard ${owe}`);
  await page.locator("#hx-discard").tap();
  await waitForState(page, (ddp) => ddp.match.state.discards[ddp.match.me] === 0);
  assert.deepEqual((await handHeld(page)).piles, before.piles.map((c, r) => c - give[r]), "the cards picked went back to the bank");
  await page.locator("#hx-log li", { hasText: /^You discard / }).first().waitFor({ state: "attached" });

  // The rest at speed.
  await autoplay(page, { level: "hard" });
  await waitForState(page, (ddp) => ddp.match.phase === "over", undefined, { timeout: 300_000 });
  await stopAutoplay(page);
  // The last move reaches each robot's table after mine: wait for theirs to end too.
  await waitForPhase(page);
  const st = await state(page);
  for (let k = 0; k < 2; k++) assert.deepEqual(await page.evaluate((i) => window.ddp.robots[i].match.state, k), st, `robot ${k + 1} agrees`);
  assert.deepEqual(await leaked(page), [], "no match on the page ever knew a hidden card that wasn't its own");
  assert.deepEqual(await leaks(page), []);
  assert.deepEqual(await handShown(page), await handHeld(page));
  const { played: kinds, direct } = await played(page);
  t.diagnostic(`${st.moves} moves, won by ${st.winner}; played ${JSON.stringify(kinds)}`);
  assert.deepEqual(direct, [], "every move through the page's own controls");
  await page.locator("#result").waitFor();
  assert.match(await page.locator("#result").innerText(), /^(You won|Robot \d won)$/);
  await page.locator("#hx-verdict.ok").waitFor({ timeout: 60_000 });
  assert.match(await page.locator("#hx-verdict").innerText(), /Fair play verified/);
  assert.equal(await page.locator("#hx-sheet thead th[scope=col]").count(), 4, "a column a player on the points sheet");
  assert.ok(Number(await page.locator("#hx-sheet td.best").innerText()) >= 10, "the winner reached 10");
  const all = await heard();
  for (const name of ["roll", "gain", "discard"]) assert.ok(all.includes(name), `played ${name}`);
  assert.ok(all.some((s) => /^(win|over)-wood$/.test(s)), "the result chime, in its wood timbre");
  assert.ok(await resultInView(page), "the result and its points sheet fit the phone without scrolling");
  assert.ok(await noHorizontalScroll(page));
  await page.screenshot({ path: `${ARTIFACTS}/hx-5-robot-over-mobile.png` });

  // The robots accept a rematch; dark mode still fits the phone.
  const m = await page.evaluate(() => window.ddp.match.m);
  await page.click("#rematch");
  await waitForState(page, (ddp, n) => ddp.match.m === n + 1 && ddp.match.phase === "playing", m, { timeout: 60_000 });
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.screenshot({ path: `${ARTIFACTS}/hx-6-robot-dark-mobile.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assertNoErrors();
});
