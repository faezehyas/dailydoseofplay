// Headless-browser test for clocks against the robot: in every game with
// clocks, a fresh robot game shows none, and one picked in the lobby's
// settings is there. While the robot game is on, the settings panel shows its
// clocks. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, waitForState } from "../helpers.js";

const skip = skipWithoutPlaywright();

// slug, settings prefix, a clock group and an option in it.
const GAMES = [
  ["sea-battle", "sb", "shotSeconds", 10],
  ["tic-tac-toe", "ttt", "moveSeconds", 10],
  ["connect-4", "c4", "moveSeconds", 10],
  ["gomoku", "gmk", "moveSeconds", 10],
  ["chess", "chess", "moveSeconds", 30],
  ["checkers", "ck", "moveSeconds", 30],
  ["backgammon", "bg", "moveSeconds", 30],
  ["dots-and-boxes", "db", "moveSeconds", 10],
  ["ludo", "ld", "moveSeconds", 10],
  ["crazy-eights", "ce", "moveSeconds", 15],
  ["go-fish", "gf", "moveSeconds", 15],
  ["gin-rummy", "gr", "moveSeconds", 15],
  ["hearts", "hr", "moveSeconds", 15],
];

async function setup(t) {
  const { srv, open: openPage, assertNoErrors } = await openBrowser(t);
  // stored: [key, value], settings saved on an earlier visit.
  async function open(slug, stored) {
    const page = await openPage(slug, { nickname: "Ada", viewport: { width: 360, height: 740 }, reducedMotion: "reduce" });
    if (stored) await page.addInitScript((stored) => localStorage.setItem(...stored), stored);
    await page.goto(`${srv.base}/${slug}/`);
    return page;
  }
  return { open, assertNoErrors };
}

// Starts a robot game and waits for the player's own turn (Sea Battle's fleet
// placed first), when a clock would be running.
async function playRobot(page) {
  await page.evaluate(() => {
    window.__last = window.ddp.match;
    clearInterval(window.__ready);
  });
  await page.click("#play-robot");
  await waitForState(page, (ddp) => ddp.match && ddp.match !== window.__last);
  await page.evaluate(() => {
    window.__ready = setInterval(() => {
      const match = window.ddp.match;
      if (match.phase === "placing" && !match.locked) document.querySelector("#ready")?.click();
    }, 50);
  });
  await waitForState(page, (ddp) => ddp.match.canMove?.() || ddp.match.canFire?.());
}

// A clock shows within a moment of the player's turn (with reduced motion, so cards deal at once), or not at all.
const timers = (page) => page.locator("#game [role=timer]:visible");
const noClock = async (page) => (await page.waitForTimeout(1000), timers(page).count());
const clockShown = (page) => timers(page).first().waitFor({ timeout: 1000 }).then(() => true, () => false);

test("a robot game has no clocks unless the player picks one", { skip, timeout: 300_000 }, async (t) => {
  const { open, assertNoErrors } = await setup(t);
  for (const [slug, prefix, name, value] of GAMES) {
    const fresh = await open(slug);
    await playRobot(fresh);
    assert.equal(await noClock(fresh), 0, `${slug}: no clock in a fresh robot game`);
    await fresh.context().close();

    const picked = await open(slug);
    await picked.click(`#${prefix}-settings > summary`);
    await picked.click(`#${prefix}-settings label:has(input[name="${prefix}-${name}"][value="${value}"])`);
    await playRobot(picked);
    assert.ok(await clockShown(picked), `${slug}: the picked clock runs`);
    await picked.context().close();
  }
  assertNoErrors();
});

test("picking the clock already shown counts, and the panel shows the robot game's clocks", { skip, timeout: 60_000 }, async (t) => {
  const { open, assertNoErrors } = await setup(t);
  const checked = (page, name) => page.locator(`#settings input[name="panel-${name}"]:checked`).getAttribute("value");
  const page = await open("tic-tac-toe");
  await playRobot(page);
  await page.click("#settings-open");
  await page.click("#settings-tab-game");
  assert.equal(await checked(page, "moveSeconds"), "0", "no move limit against the robot");
  assert.equal(await checked(page, "gameSeconds"), "0", "no game clock against the robot");
  await page.click("#settings-close");
  await page.click("#leave");
  await waitForState(page, (ddp) => !ddp.session);
  assert.equal(await page.locator('input[name="ttt-moveSeconds"]:checked').getAttribute("value"), "30", "the lobby still shows the friend default");

  await page.click("#ttt-settings > summary");
  await page.click('#ttt-settings label:has(input[name="ttt-moveSeconds"][value="30"])');
  await playRobot(page);
  assert.ok(await clockShown(page), "the default 30 s, picked, runs");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("ddp-ttt-settings")).picked), ["moveSeconds"]);
  assertNoErrors();
});

test("a clock picked before picks were remembered still runs against the robot", { skip, timeout: 60_000 }, async (t) => {
  const { open, assertNoErrors } = await setup(t);
  const page = await open("tic-tac-toe", ["ddp-ttt-settings", JSON.stringify({ size: 3, moveSeconds: 10, gameSeconds: 120, first: "random" })]);
  await playRobot(page);
  assert.ok(await clockShown(page), "10 s a move, not the default, so picked");
  assert.equal(await page.evaluate(() => window.ddp.match.state.clocks), null, "2 min each is the default: not picked");
  assertNoErrors();
});
