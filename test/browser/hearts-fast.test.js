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
import { startServer } from "../helpers.js";
import { pw, wait, state, autoplay, stopAutoplay, leaks } from "./hearts.shared.js";

async function fastGame(browser, srv, settings) {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript((s) => {
    globalThis.ddpRobotPace = 0.001;
    localStorage.setItem("ddp-hearts-settings", JSON.stringify(s));
    // Count every scripted animation.
    window.animations = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      window.animations++;
      return animate.apply(this, args);
    };
  }, settings);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${srv.base}/hearts/?robot=1`);
  await wait(page, () => window.ddp.match?.phase === "playing", undefined, 60_000);
  await page.evaluate(() => {
    window.flown = 0;
    new MutationObserver((list) => list.forEach((r) => (window.flown += r.addedNodes.length))).observe(document.querySelector(".hr-fly"), { childList: true });
  });
  const t0 = Date.now();
  await autoplay(page);
  await wait(page, () => window.ddp.match.phase === "over", undefined, 400_000);
  await stopAutoplay(page);
  const played = Date.now() - t0;
  await wait(page, () => window.ddp.match.verdict, undefined, 60_000);
  assert.deepEqual(await page.evaluate(() => window.ddp.match.verdict), { ok: true });
  assert.deepEqual(await leaks(page), []);
  const st = await state(page);
  const { animations, flown } = await page.evaluate(() => ({ animations: window.animations, flown: window.flown }));
  assert.equal(animations, 0, "nothing animated");
  assert.equal(flown, 0, "no card flew");
  assert.deepEqual(errors, []);
  await ctx.close();
  return { st, played };
}

test("Hearts with animations off and the robots at full speed: a whole game is only the deck's own work", { skip: !pw && "Playwright not installed", timeout: 600_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const four = await fastGame(browser, srv, { level: "hard", target: 50 });
  t.diagnostic(`four players: ${four.st.history.length} hands, ${four.st.moves} moves in ${four.played} ms`);
  assert.ok(Math.max(...four.st.scores) >= 50);
  const three = await fastGame(browser, srv, { level: "medium", robots: 2, target: 0 });
  t.diagnostic(`three players: ${three.st.moves} moves in ${three.played} ms`);
  assert.equal(three.st.players, 3);
  assert.equal(three.st.history[0].raw.reduce((a, b) => a + b, 0), 26);
});
