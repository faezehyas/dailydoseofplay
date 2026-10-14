// Headless-browser test for Hearts: a game against three robots on a 360 px
// phone, with the deal, the pass and its sounds, the mute button, the move
// timer and the "Fair play verified" result. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, pick, state, resultInView, autoplay, stopAutoplay, leaks, domLeaks } from "./hearts.shared.js";

// A card in a fanned hand shows only its left edge: tap there.
const EDGE = { x: 6, y: 40 };

test("Hearts against three robots on a 360 px phone: deal, pass, sounds, mute, timer and a verified game", { skip: !pw && "Playwright not installed", timeout: 600_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling", "--autoplay-policy=no-user-gesture-required"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "light" });
  await ctx.addInitScript(() => (window.ddpSounds = []));
  await ctx.addInitScript(() => (globalThis.ddpRobotPace = 0.1));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const heard = () => page.evaluate(() => window.ddpSounds.slice());
  await page.clock.install();

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="hearts"] h2 a, .game-card[data-slug="hearts"]');
  await page.locator("#play-robot").waitFor();
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "target", 50);
  await pick(page, "level", "hard");
  await pick(page, "moveSeconds", 15);
  await pick(page, "jack", true);
  await pick(page, "fourColor", true);
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/hr-5-settings-mobile.png`, fullPage: true });
  await page.tap("#play-robot");
  await page.locator("#hr-busy:not([hidden])").waitFor();
  await wait(page, () => window.ddp.match?.phase === "playing", undefined, 60_000);
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot 1[\s\S]*Robot 2[\s\S]*Robot 3/);
  assert.equal(await page.locator("#hr-config").innerText(), "Game to 50 · pass three · the moon: everyone else +26 · jack of diamonds −10 · 15 s a move · Hard robots");
  assert.equal(await page.locator(".hearts.four-colour").count(), 1, "the four-colour deck is on");
  await wait(page, () => document.querySelectorAll(".hr-hcard.pickable").length === 13, undefined, 30_000);
  assert.ok(await noHorizontalScroll(page), "four seats and thirteen cards fit a 360 px phone");
  const sounds = await heard();
  for (const name of ["shuffle", "deal"]) assert.ok(sounds.includes(name), `played ${name}: ${sounds.join(" ")}`);
  assert.ok(sounds.filter((s) => s === "deal").length >= 20, "a flick per card dealt");

  // The pass, by touch: three cards, then Pass left.
  const slots = (await page.locator(".hr-hcard").evaluateAll((els) => els.map((e) => Number(e.dataset.slot)))).slice(-3);
  for (const s of slots) await page.locator(`.hr-hcard[data-slot="${s}"]`).tap({ position: EDGE });
  assert.equal(await page.locator(".hr-hcard.picked").count(), 3);
  await page.screenshot({ path: `${ARTIFACTS}/hr-6-robot-pass-mobile.png` });
  await page.tap("#hr-pass");
  await wait(page, () => window.ddp.match.state.phase !== "pass", undefined, 30_000);
  await wait(page, () => window.ddpSounds.includes("pass") && document.querySelectorAll(".hr-hcard.received").length === 3, undefined, 20_000);
  const st1 = await state(page);
  assert.deepEqual(st1.picks[0], slots);
  for (const s of slots) assert.ok(st1.hands[1].includes(s), "they went to Robot 1, on the left");

  // Muted: nothing more plays.
  await page.click("#sound-toggle");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  const quiet = (await heard()).length;
  const moves = st1.moves;
  await autoplay(page);
  await wait(page, (n) => window.ddp.match.state.moves > n + 12 || window.ddp.match.phase !== "playing", moves, 90_000);
  await stopAutoplay(page);
  assert.equal((await heard()).length, quiet, "no sound while muted");
  await page.click("#sound-toggle");

  // The move timer: leave a choice alone and a card (or a pass) is played for you.
  await wait(page, () => !!document.querySelector("#hr-timer.p-0:not([hidden])") || window.ddp.match.phase !== "playing", undefined, 120_000);
  if ((await state(page)).winner === -1) {
    const from = (await state(page)).moves;
    await page.clock.fastForward("00:16");
    await wait(page, (n) => window.ddp.match.state.moves > n, from, 15_000);
    await page.locator("#toast", { hasText: "Time's up" }).waitFor({ state: "attached" });
  }

  // The rest at speed, with reduced motion.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await autoplay(page);
  await wait(page, () => window.ddp.match.phase === "over", undefined, 480_000);
  await stopAutoplay(page);
  // The last move reaches each robot's table after mine: wait for theirs to end too.
  await wait(page, () => window.ddp.robots.every((r) => r.match.phase === "over"));
  const st = await state(page);
  for (let k = 0; k < 3; k++) assert.deepEqual(await page.evaluate((i) => window.ddp.robots[i].match.state, k), st, `robot ${k + 1} agrees`);
  assert.deepEqual(await leaks(page), []);
  assert.deepEqual(await domLeaks(page), []);
  await page.locator("#result").waitFor();
  assert.match(await page.locator("#result").innerText(), /^(You won|Draw|Robot \d won)$/);
  await page.locator("#hr-verdict.ok").waitFor({ timeout: 60_000 });
  assert.match(await page.locator("#hr-verdict").innerText(), /Fair play verified/);
  assert.equal(await page.locator("#hr-sheet tbody tr").count(), st.history.length, "a row a hand on the score sheet");
  const all = await heard();
  for (const name of ["play", "sweep", "tally", "turn"]) assert.ok(all.includes(name), `played ${name}`);
  assert.ok(all.some((s) => /^(win|loss|over|draw)-bell$/.test(s)), "the result chime, in its bell timbre");
  assert.ok(await resultInView(page), "the result and its score sheet fit the phone without scrolling");
  await page.screenshot({ path: `${ARTIFACTS}/hr-7-robot-over-mobile.png` });

  // The robots accept a rematch; dark mode still fits the phone.
  const m = await page.evaluate(() => window.ddp.match.m);
  await page.click("#rematch");
  await wait(page, (n) => window.ddp.match.m === n + 1 && window.ddp.match.phase === "playing", m, 60_000);
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.screenshot({ path: `${ARTIFACTS}/hr-8-robot-dark-mobile.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
