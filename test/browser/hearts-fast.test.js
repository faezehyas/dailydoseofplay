// Headless-browser test for Hearts at full speed: with reduced motion and the
// robots' pace near 0, a whole game against three robots runs with no
// animation and no artificial wait, so only the deck's cryptography takes
// time (a shuffle by every browser before each hand, and the sealed pass).
// Also a three-player game: two robots, 17 cards each. Skips if Playwright is
// missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, waitForState } from "../helpers.js";
import { state, autoplay, stopAutoplay, leaks } from "./hearts.shared.js";

const skip = skipWithoutPlaywright();

async function fastGame({ srv, open, assertNoErrors }, name, settings) {
  const page = await open(name, { viewport: { width: 1366, height: 900 }, reducedMotion: "reduce", robotPace: 0.001 });
  await page.addInitScript((s) => {
    localStorage.setItem("ddp-hearts-settings", JSON.stringify(s));
    // Count every scripted animation.
    window.animations = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      window.animations++;
      return animate.apply(this, args);
    };
  }, settings);
  await page.goto(`${srv.base}/hearts/?robot=1`);
  await waitForState(page, (ddp) => ddp.match?.phase === "playing", undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    window.flown = 0;
    new MutationObserver((list) => list.forEach((r) => (window.flown += r.addedNodes.length))).observe(document.querySelector(".hr-fly"), { childList: true });
  });
  const t0 = Date.now();
  await autoplay(page);
  await waitForState(page, (ddp) => ddp.match.phase === "over", undefined, { timeout: 400_000 });
  await stopAutoplay(page);
  const played = Date.now() - t0;
  await waitForState(page, (ddp) => ddp.match.verdict, undefined, { timeout: 60_000 });
  assert.deepEqual(await page.evaluate(() => window.ddp.match.verdict), { ok: true });
  assert.deepEqual(await leaks(page), []);
  const st = await state(page);
  const { animations, flown } = await page.evaluate(() => ({ animations: window.animations, flown: window.flown }));
  assert.equal(animations, 0, "nothing animated");
  assert.equal(flown, 0, "no card flew");
  assertNoErrors();
  await page.context().close();
  return { st, played };
}

test("Hearts with animations off and the robots at full speed: a whole game is only the deck's own work", { skip, timeout: 600_000 }, async (t) => {
  const run = await openBrowser(t);
  const four = await fastGame(run, "four", { level: "hard", target: 50 });
  t.diagnostic(`four players: ${four.st.history.length} hands, ${four.st.moves} moves in ${four.played} ms`);
  assert.ok(Math.max(...four.st.scores) >= 50);
  const three = await fastGame(run, "three", { level: "medium", robots: 2, target: 0 });
  t.diagnostic(`three players: ${three.st.moves} moves in ${three.played} ms`);
  assert.equal(three.st.players, 3);
  assert.equal(three.st.history[0].raw.reduce((a, b) => a + b, 0), 26);
});
