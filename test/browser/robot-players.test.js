// Headless-browser test: how many play a robot game. A game for more than two
// offers a "Players" choice by "Play vs robot", from the counts it seats; the
// choice is remembered, shows in the settings summary and sets the robot
// seats. Two-player games show none. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll } from "./ludo.shared.js";

const PHONE = { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "light" };
const DESKTOP = { viewport: { width: 1280, height: 900 }, colorScheme: "dark" };

async function setup(t) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(options, saved = {}) {
    const ctx = await browser.newContext({ ...options, reducedMotion: "reduce" });
    await ctx.addInitScript((saved) => {
      globalThis.ddpRobotPace = 0.1;
      for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, JSON.stringify(value));
    }, saved);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    return page;
  }
  return { srv, open, errors };
}

const counts = (page) => page.locator(".players-choice input").evaluateAll((inputs) => inputs.map((i) => (i.checked ? `[${i.value}]` : i.value)).join(" "));

test("Ludo offers 2, 3 or 4 players by touch and keyboard, and seats that many", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  for (const [options, name] of [
    [PHONE, "360-light"],
    [DESKTOP, "1280-dark"],
  ]) {
    const page = await open(options);
    await page.goto(`${srv.base}/ludo/`);
    const choice = page.locator(".lobby-actions fieldset.players-choice");
    assert.equal(await choice.locator("legend").innerText(), "Players", "a radio group with a visible label");
    assert.equal(await counts(page), "2 3 [4]", "a full table at first");
    assert.deepEqual(await page.locator("#ld-settings .settings-line .chip.robot").allInnerTexts(), ["Easy robot", "4 players"]);
    assert.ok(await noHorizontalScroll(page));
    await page.screenshot({ path: `${ARTIFACTS}/players-ludo-lobby-${name}.png`, fullPage: true });

    // The arrow keys move the choice, as in any radio group.
    await choice.locator("input:checked").focus();
    await page.keyboard.press("ArrowLeft");
    assert.equal(await counts(page), "2 [3] 4");
    assert.deepEqual(await page.locator("#ld-settings .settings-line .chip.robot").allInnerTexts(), ["Easy robot", "3 players"], "the summary follows");
    await page.click("#play-robot");
    await wait(page, () => window.ddp.match?.phase === "playing");
    assert.equal(await page.evaluate(() => window.ddp.session.players.length), 3);
    assert.equal(await page.evaluate(() => window.ddp.robots.length), 2);
    await page.click("#leave");
    await page.locator("#play-robot").waitFor();
    assert.equal(await counts(page), "2 [3] 4", "remembered back in the lobby");

    // By touch (a click on the desktop): four players, then a reload still has it.
    await page.locator('.players-choice label:has(input[value="4"])').click();
    await page.reload();
    assert.equal(await counts(page), "2 3 [4]", "remembered on this device");
    await page.click("#play-robot");
    await wait(page, () => window.ddp.match?.phase === "playing");
    assert.equal(await page.locator(".pb-who").count(), 4);
    assert.ok(await noHorizontalScroll(page));
    await page.screenshot({ path: `${ARTIFACTS}/players-ludo-four-${name}.png` });
    await page.context().close();
  }
  assert.deepEqual(errors, []);
});

test("Hearts offers only 3 and 4, keeps an old robot count, and Chess offers none", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  for (const [options, name] of [
    [PHONE, "360-light"],
    [DESKTOP, "1280-dark"],
  ]) {
    // Two robots picked before the choice moved to the lobby: three players.
    const page = await open(options, { "ddp-hearts-settings": { robots: 2, level: "hard" } });
    await page.goto(`${srv.base}/hearts/`);
    assert.equal(await counts(page), "[3] 4");
    assert.equal(await page.locator('.players-choice label:has(input[value="3"]) small').innerText(), "17 cards each", "the game's note for a count");
    assert.ok(await noHorizontalScroll(page));
    await page.screenshot({ path: `${ARTIFACTS}/players-hearts-lobby-${name}.png`, fullPage: true });
    await page.click("#play-robot");
    await wait(page, () => window.ddp.match?.phase === "playing");
    assert.equal(await page.evaluate(() => window.ddp.session.players.length), 3);

    await page.goto(`${srv.base}/chess/`);
    await page.locator("#play-robot").waitFor();
    assert.equal(await page.locator(".players-choice").count(), 0, "two-player games show nothing new");
    assert.ok(await noHorizontalScroll(page));
    await page.screenshot({ path: `${ARTIFACTS}/players-chess-lobby-${name}.png`, fullPage: true });
    await page.context().close();
  }
  assert.deepEqual(errors, []);
});
