// Headless-browser test for Stonecrown at full speed: with reduced motion and
// the robots' pace near 0, whole games against robots run with no animation
// and no artificial wait, so only the deck's cryptography takes time (each
// age's shuffle, every pass and the audit). Three players and four players on
// A sides, then four on B sides, each played to the end through the page's
// own buttons, audited, and watched for any card a match or the page itself
// shouldn't know. Then Halicarnassus digs through the discards by tapping.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, waitForState, waitForPhase } from "../helpers.js";
import { WONDERS } from "../../public/stonecrown/cards.js";
import { state, autoplay, stopAutoplay, played, leaks, watchLeaks, leaked, scanned, handShown, handHeld, coinsShown } from "./stonecrown.shared.js";

const skip = skipWithoutPlaywright();
const HALICARNASSUS = WONDERS.findIndex((w) => w.city === "Halicarnassus");

async function fastGame({ srv, open, assertNoErrors }, name, settings) {
  const page = await open(name, { viewport: { width: 1366, height: 900 }, reducedMotion: "reduce", robotPace: 0.001, seed: name });
  await page.addInitScript((s) => {
    localStorage.setItem("ddp-stonecrown-settings", JSON.stringify(s));
    // Count every scripted animation.
    window.animations = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      window.animations++;
      return animate.apply(this, args);
    };
  }, settings);
  await page.goto(`${srv.base}/stonecrown/?robot=1`);
  await waitForState(page, (ddp) => ddp.match?.phase === "playing", undefined, { timeout: 60_000 });
  await watchLeaks(page, { dom: true });
  await page.evaluate(() => {
    window.flown = 0;
    new MutationObserver((list) => list.forEach((r) => (window.flown += r.addedNodes.length))).observe(document.querySelector(".sc-fly"), { childList: true });
  });
  const t0 = Date.now();
  await autoplay(page, { level: settings.level });
  await waitForState(page, (ddp) => ddp.match.phase === "over", undefined, { timeout: 400_000, why: `${name} ends` });
  await stopAutoplay(page);
  const time = Date.now() - t0;
  await waitForPhase(page);
  const st = await state(page);
  for (let k = 0; k < st.players - 1; k++) assert.deepEqual(await page.evaluate((i) => window.ddp.robots[i].match.state, k), st, `robot ${k + 1} agrees`);
  assert.deepEqual(await leaked(page), [], "no match on the page, nor the page itself, ever knew or named a card it shouldn't");
  assert.deepEqual(await leaks(page), []);
  assert.ok((await scanned(page)).scans > 20, "the page was scanned while it knew cards it mustn't show");
  assert.deepEqual(await handShown(page), await handHeld(page), "the hand drawn is the hand held (empty at the end)");
  await coinsShown(page);
  await waitForState(page, (ddp) => ddp.match.verdict, undefined, { timeout: 60_000 });
  assert.deepEqual(await page.evaluate(() => window.ddp.match.verdict), { ok: true });
  await page.locator("#sc-verdict.ok").waitFor();
  assert.match(await page.locator("#sc-verdict").innerText(), /Fair play verified/);
  assert.equal(await page.locator("#sc-sheet thead th[scope=col]").count(), st.players + 1, "a column a player on the score sheet");
  const { animations, flown } = await page.evaluate(() => ({ animations: window.animations, flown: window.flown }));
  const autoplayed = await played(page);
  assert.deepEqual(autoplayed.direct, [], "every move through the page's own controls");
  assert.equal(animations, 0, "nothing animated");
  assert.equal(flown, 0, "no card flew");
  assertNoErrors();
  await page.context().close();
  return { st, time, autoplayed };
}

const summary = ({ st, time, autoplayed }) => `${st.moves} moves in ${time} ms, won by ${st.winners.join(" and ")}; wonders ${st.wonders.map((w) => `${w.w}${w.side}`).join(" ")}; ${JSON.stringify(autoplayed.played)}`;

test("Stonecrown with animations off and the robots at full speed: whole games are only the deck's own work", { skip, timeout: 600_000 }, async (t) => {
  const run = await openBrowser(t);
  const three = await fastGame(run, "three", { level: "hard", players: 3, side: "A" });
  t.diagnostic(`three players: ${summary(three)}`);
  assert.equal(three.st.players, 3);
  assert.ok(three.st.wonders.every((w) => w.side === "A"));
  const four = await fastGame(run, "four", { level: "medium", players: 4, side: "A" });
  t.diagnostic(`four players: ${summary(four)}`);
  assert.equal(four.st.players, 4);
  const sideB = await fastGame(run, "side-b", { level: "hard", players: 4, side: "B" });
  t.diagnostic(`four players, B sides: ${summary(sideB)}`);
  assert.ok(sideB.st.wonders.every((w) => w.side === "B"));
  const kinds = [three, four, sideB].flatMap((g) => Object.keys(g.autoplayed.played));
  for (const kind of ["pick:build", "pick:stage", "pick:sell"]) assert.ok(kinds.some((k) => k.startsWith(kind)), `${kind} played through the page's buttons`);
});


// Deals robot games until seat 0 has Halicarnassus.
async function dealHalicarnassus(page, base) {
  for (let deal = 0; deal < 80; deal++) {
    await page.goto(`${base}/stonecrown/?robot=1`);
    await waitForState(page, (ddp) => ddp.match?.phase === "playing" && !!ddp.match.state?.wonders, undefined, { timeout: 60_000 });
    if ((await page.evaluate(() => window.ddp.match.state.wonders[0].w)) === HALICARNASSUS) return;
  }
  assert.fail("seat 0 was never dealt Halicarnassus");
}
// Plays seat 0's picks until it digs through the discards (true) or the game ends.
async function nextDig(page) {
  await autoplay(page, { level: "hard", hold: ["dig"] });
  await waitForState(page, () => (window.ddp.match.state.phase === "dig" && !!document.querySelector(".stonecrown.my-turn")) || window.ddp.match.phase !== "playing", undefined, { timeout: 120_000, why: "a dig, or the end" });
  await stopAutoplay(page);
  return (await state(page)).phase === "dig";
}

test("Stonecrown's Halicarnassus digs through the discards by tapping: a card built free, and nothing", { skip, timeout: 400_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("digger", { viewport: { width: 1366, height: 900 }, reducedMotion: "reduce", robotPace: 0.001, init: () => (window.ddpSounds = []) });
  await page.addInitScript(() => localStorage.setItem("ddp-stonecrown-settings", JSON.stringify({ players: 3, side: "B", level: "hard" })));
  const digs = [];
  const done = () => digs.some((d) => d.startsWith("built")) && digs.some((d) => d.startsWith("nothing") || d.startsWith("Build nothing"));
  for (let game = 0; game < 4 && !done(); game++) {
    await dealHalicarnassus(page, srv.base);
    await watchLeaks(page, { dom: true });
    while (await nextDig(page)) {
      const st = await state(page);
      assert.equal(st.digger, 0);
      assert.equal(await page.locator(".sc-hand-title").innerText(), "The discards · build one free");
      assert.equal(await page.locator("#sc-hand .sc-hcard").count(), st.discard.length, "the hand shows every discard");
      assert.match(await page.locator("#sc-status").innerText(), /Dig through the discards/);
      assert.ok(await page.locator("#sc-dig").isDisabled(), "nothing to build before a card is picked");
      assert.ok(await page.locator("#sc-nothing").isVisible(), "Build nothing is offered");
      const legal = await page.locator("#sc-hand .sc-hcard.can").evaluateAll((els) => els.map((e) => Number(e.dataset.slot)));
      const turn = `${st.age}:${st.round}:${st.phase}`;
      const resolved = () => waitForState(page, (ddp, t) => `${ddp.match.state.age}:${ddp.match.state.round}:${ddp.match.state.phase}` !== t || ddp.match.phase !== "playing", turn, { timeout: 30_000, why: "the dig resolves" });
      if (!digs.some((d) => d.startsWith("built")) && legal.length) {
        const slot = legal[0];
        await page.click(`#sc-hand .sc-hcard[data-slot="${slot}"]`);
        assert.ok(!(await page.locator("#sc-dig").isDisabled()), "a card picked can be built");
        await page.click("#sc-dig");
        await resolved();
        const built = (await state(page)).city[0].find((c) => c.slot === slot);
        assert.ok(built, "the card dug is in your city");
        await page.locator("#sc-log li", { hasText: /^You build .* free from the discards$/ }).first().waitFor({ state: "attached" });
        digs.push(`built ${built.id}`);
        assert.ok((await page.evaluate(() => window.ddpSounds)).includes("dig"), "the dig sounds");
      } else {
        // Nothing, straight away, without looking at a card.
        await page.click("#sc-nothing");
        const nothing = await waitForState(page, (ddp) => !!ddp.match.step?.commits[0] || !document.querySelector(".stonecrown.my-turn"), undefined, { timeout: 3000 }).then(
          () => true,
          () => false,
        );
        digs.push(nothing ? "nothing" : "Build nothing did nothing");
        if (!nothing) {
          await page.locator("#sc-hand .sc-hcard").first().click();
          await page.click("#sc-nothing");
        }
        await resolved();
      }
    }
    await waitForState(page, (ddp) => ddp.match.phase === "over", undefined, { timeout: 60_000 });
    assert.deepEqual(await leaked(page), [], "the discards were named only while digging, and no match knew a card it shouldn't");
    await waitForState(page, (ddp) => ddp.match.verdict, undefined, { timeout: 60_000 });
    assert.deepEqual(await page.evaluate(() => window.ddp.match.verdict), { ok: true });
  }
  t.diagnostic(`digs: ${digs.join(", ")}`);
  assert.ok(done(), `a card built from the discards, and a dig for nothing: ${digs.join(", ")}`);
  assert.ok(!digs.includes("Build nothing did nothing"), "Build nothing works before a card is tapped");
  assertNoErrors();
});
