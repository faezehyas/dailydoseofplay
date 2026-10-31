// Headless-browser test for Hexlands at full speed: with reduced motion and
// the robots' pace near 0, whole games against robots run with no animation
// and no artificial wait, so only the deck's cryptography takes time (the
// development pile's shuffle, every steal and the audit). Three players to
// 10 and four players to 8, each played to the end and audited; then a game
// where you buy every development card and play one before each roll you
// can, through the roll's own buttons, pickers and free roads. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, waitForState, waitForPhase } from "../helpers.js";
import { state, autoplay, stopAutoplay, played, leaks, handShown, handHeld } from "./hexlands.shared.js";

const skip = skipWithoutPlaywright();

async function fastGame({ srv, open, assertNoErrors }, name, settings, { devFirst = false } = {}) {
  const page = await open(name, { viewport: { width: 1366, height: 900 }, reducedMotion: "reduce", robotPace: 0.001, seed: name });
  await page.addInitScript((s) => {
    localStorage.setItem("ddp-hexlands-settings", JSON.stringify(s));
    // Count every scripted animation.
    window.animations = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      window.animations++;
      return animate.apply(this, args);
    };
  }, settings);
  await page.goto(`${srv.base}/hexlands/?robot=1`);
  await waitForState(page, (ddp) => ddp.match?.phase === "playing", undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    window.flown = 0;
    new MutationObserver((list) => list.forEach((r) => (window.flown += r.addedNodes.length))).observe(document.querySelector(".hx-fly"), { childList: true });
  });
  const t0 = Date.now();
  await autoplay(page, { level: settings.level, devFirst });
  await waitForState(page, (ddp) => ddp.match.phase === "over", undefined, { timeout: 400_000 });
  await stopAutoplay(page);
  const time = Date.now() - t0;
  await waitForPhase(page);
  const st = await state(page);
  for (let k = 0; k < st.players - 1; k++) assert.deepEqual(await page.evaluate((i) => window.ddp.robots[i].match.state, k), st, `robot ${k + 1} agrees`);
  assert.deepEqual(await leaks(page), []);
  assert.deepEqual(await handShown(page), await handHeld(page), "the hand drawn is the hand held");
  await waitForState(page, (ddp) => ddp.match.verdict, undefined, { timeout: 60_000 });
  assert.deepEqual(await page.evaluate(() => window.ddp.match.verdict), { ok: true });
  const { animations, flown } = await page.evaluate(() => ({ animations: window.animations, flown: window.flown }));
  const autoplayed = await played(page);
  assert.deepEqual(autoplayed.direct, [], "every move through the page's own controls");
  assert.equal(animations, 0, "nothing animated");
  assert.equal(flown, 0, "no card flew");
  assertNoErrors();
  await page.context().close();
  return { st, time, autoplayed };
}

test("Hexlands with animations off and the robots at full speed: whole games are only the deck's own work", { skip, timeout: 300_000 }, async (t) => {
  const run = await openBrowser(t);
  const three = await fastGame(run, "three", { level: "hard", players: 3, target: 10 });
  t.diagnostic(`three players: ${three.st.moves} moves in ${three.time} ms, won by ${three.st.winner}; ${JSON.stringify(three.autoplayed)}`);
  assert.equal(three.st.players, 3);
  const four = await fastGame(run, "four", { level: "medium", players: 4, target: 8 });
  t.diagnostic(`four players: ${four.st.moves} moves in ${four.time} ms, won by ${four.st.winner}; ${JSON.stringify(four.autoplayed)}`);
  assert.equal(four.st.players, 4);
  const devs = await fastGame(run, "devs-first", { level: "easy", players: 3, target: 10 }, { devFirst: true });
  t.diagnostic(`development cards first: ${devs.st.moves} moves in ${devs.time} ms; ${JSON.stringify(devs.autoplayed)}`);
  const before = Object.entries(devs.autoplayed.played).filter(([k]) => k.startsWith("roll:play:"));
  assert.ok(before.length, "development cards played before the roll, through the page's controls");
});
