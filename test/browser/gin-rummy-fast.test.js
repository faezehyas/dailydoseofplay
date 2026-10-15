// Headless-browser test for Gin Rummy at full speed: with reduced motion
// and the robot's pace near 0, a whole game to 100 against the robot runs with
// no animation and no artificial wait, so only the deck's cryptography takes
// time. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, waitForState } from "../helpers.js";
import { state, autoplay, stopAutoplay } from "./gin-rummy.shared.js";

const skip = skipWithoutPlaywright();

test("Gin Rummy with animations off and the robot at full speed: a whole game is only the deck's own work", { skip, timeout: 180_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const init = () => {
    localStorage.setItem("ddp-gin-rummy-settings", JSON.stringify({ level: "hard" }));
    // Count every scripted animation and every card that would fly.
    window.animations = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      window.animations++;
      return animate.apply(this, args);
    };
  };
  const page = await open("player", { viewport: { width: 1366, height: 900 }, reducedMotion: "reduce", robotPace: 0.001, init });
  await page.goto(`${srv.base}/gin-rummy/?robot=1`);
  await waitForState(page, (ddp) => ddp.match?.phase === "playing", undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    window.flown = 0;
    new MutationObserver((list) => list.forEach((r) => (window.flown += r.addedNodes.length))).observe(document.querySelector(".gr-fly"), { childList: true });
    // How long each turn took, from one move to the next, and how much of it was the deck's work:
    // its busy rounds, and every deck job (a knock or a defence opens ten or eleven cards in one move).
    const m = window.ddp.match;
    window.turns = [];
    let last = performance.now();
    let deck = 0;
    let active = 0;
    let since = 0;
    const step = (d) => {
      if (!active && d > 0) since = performance.now();
      active += d;
      if (!active) deck += performance.now() - since;
    };
    let busy = false;
    m.on("update", () => {
      if (!!m.busy !== busy) step((busy = !!m.busy) ? 1 : -1);
    });
    for (const [op, fn] of Object.entries(m.deck)) {
      m.deck[op] = (...args) => {
        step(1);
        return fn(...args).finally(() => step(-1));
      };
    }
    m.on("events", ({ player }) => {
      if (player < 0) return;
      const now = performance.now();
      window.turns.push({ ms: now - last, deck: deck + (active ? now - since : 0) });
      if (active) since = now;
      last = now;
      deck = 0;
    });
  });
  const t0 = Date.now();
  await autoplay(page);
  await waitForState(page, (ddp) => ddp.match.phase === "over", undefined, { timeout: 150_000 });
  await stopAutoplay(page);
  const played = Date.now() - t0;
  await waitForState(page, (ddp) => ddp.match.verdict, undefined, { timeout: 60_000 });
  assert.deepEqual(await page.evaluate(() => window.ddp.match.verdict), { ok: true });
  const st = await state(page);
  const { animations, flown, turns } = await page.evaluate(() => ({ animations: window.animations, flown: window.flown, turns: window.turns }));
  assert.equal(animations, 0, "nothing animated");
  assert.equal(flown, 0, "no card flew");
  // Without the deck's own rounds (a deal, a reshuffle), a turn is a few milliseconds.
  const idle = turns.map((x) => Math.max(0, x.ms - x.deck));
  const slowest = Math.max(...idle);
  t.diagnostic(`${st.moves} moves in ${played} ms (${Math.round(played / st.moves)} ms a move); slowest turn outside the deck's work ${Math.round(slowest)} ms`);
  assert.ok(slowest < 400, `a turn waited ${Math.round(slowest)} ms for something other than the deck`);
  assertNoErrors();
});
