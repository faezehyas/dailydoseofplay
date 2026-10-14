// Headless-browser test: how many play a robot game. A game for more than two
// offers a "Players" choice just above "Play vs robot", from the counts it
// seats; the button names the robots, the choice is remembered, the settings
// panel has it too and it sets the robot seats. Two-player games show none.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, noHorizontalScroll } from "../helpers.js";

const skip = skipWithoutPlaywright();
const PHONE = { phone: true, colorScheme: "light" };
const DESKTOP = { viewport: { width: 1280, height: 900 }, colorScheme: "dark" };

async function setup(t) {
  const { srv, open: openPage, assertNoErrors } = await openBrowser(t);
  async function open(options, saved = {}) {
    const page = await openPage("player", { ...options, reducedMotion: "reduce" });
    await page.addInitScript((saved) => {
      for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, JSON.stringify(value));
    }, saved);
    return page;
  }
  return { srv, open, assertNoErrors };
}

const counts = (page) => page.locator(".players-choice input").evaluateAll((inputs) => inputs.map((i) => (i.checked ? `[${i.value}]` : i.value)).join(" "));

test("Ludo offers 2, 3 or 4 players by touch and keyboard, and seats that many", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  for (const [options, name] of [
    [PHONE, "360-light"],
    [DESKTOP, "1280-dark"],
  ]) {
    const page = await open(options);
    await page.goto(`${srv.base}/ludo/`);
    const choice = page.locator(".robot-play fieldset.players-choice");
    assert.equal(await choice.locator("legend").innerText(), "Players (you + robots)", "a radio group with a visible label");
    assert.equal(await counts(page), "2 3 [4]", "a full table at first");
    assert.equal(await page.locator("#play-robot").innerText(), "Play vs 3 robots");
    assert.deepEqual(await page.locator("#ld-settings .settings-line .chip.robot").allInnerTexts(), ["Easy robots"]);
    assert.ok(await noHorizontalScroll(page));
    await page.screenshot({ path: `${ARTIFACTS}/players-ludo-lobby-${name}.png`, fullPage: true });

    // The arrow keys move the choice, as in any radio group.
    await choice.locator("input:checked").focus();
    await page.keyboard.press("ArrowLeft");
    assert.equal(await counts(page), "2 [3] 4");
    assert.equal(await page.locator("#play-robot").innerText(), "Play vs 2 robots", "the button follows");
    await page.locator('.players-choice label:has(input[value="2"])').click();
    assert.equal(await page.locator("#play-robot").innerText(), "Play vs robot");
    assert.deepEqual(await page.locator("#ld-settings .settings-line .chip.robot").allInnerTexts(), ["Easy robot"], "and the robot level");
    await page.locator('.players-choice label:has(input[value="3"])').click();
    await page.click("#play-robot");
    await waitForState(page, (ddp) => ddp.match?.phase === "playing");
    assert.equal(await page.evaluate(() => window.ddp.session.players.length), 3);
    assert.equal(await page.evaluate(() => window.ddp.robots.length), 2);
    // The settings panel has the count too, locked during the game.
    await page.click("#settings-open");
    await page.click("#settings-tab-game");
    assert.equal(await page.locator('input[name="panel-players"]:checked').getAttribute("value"), "3");
    assert.ok(await page.locator('input[name="panel-players"][value="4"]').isDisabled(), "locked during a game");
    await page.screenshot({ path: `${ARTIFACTS}/players-ludo-panel-${name}.png` });
    await page.keyboard.press("Escape");
    await page.click("#leave");
    await page.locator("#play-robot").waitFor();
    assert.equal(await counts(page), "2 [3] 4", "remembered back in the lobby");

    // By touch (a click on the desktop): four players, then a reload still has it.
    await page.locator('.players-choice label:has(input[value="4"])').click();
    await page.reload();
    assert.equal(await counts(page), "2 3 [4]", "remembered on this device");
    await page.click("#play-robot");
    await waitForState(page, (ddp) => ddp.match?.phase === "playing");
    assert.equal(await page.locator(".pb-who").count(), 4);
    assert.ok(await noHorizontalScroll(page));
    await page.screenshot({ path: `${ARTIFACTS}/players-ludo-four-${name}.png` });
    await page.context().close();
  }
  assertNoErrors();
});

test("Hearts offers only 3 and 4 and keeps an old robot count, Chutes and Ladders starts at 2, Chess offers none", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  for (const [options, name] of [
    [PHONE, "360-light"],
    [DESKTOP, "1280-dark"],
  ]) {
    // Two robots picked before the choice moved to the lobby: three players.
    const page = await open(options, { "ddp-hearts-settings": { robots: 2, level: "hard" } });
    await page.goto(`${srv.base}/hearts/`);
    assert.equal(await counts(page), "[3] 4");
    assert.equal(await page.locator("#hr-players-note").innerText(), "17 cards each", "the game's note for the count picked");
    assert.equal(await page.locator("#play-robot").innerText(), "Play vs 2 robots");
    await page.locator('.players-choice label:has(input[value="4"])').click();
    assert.ok(await page.locator("#hr-players-note").isHidden(), "no note for four");
    await page.locator('.players-choice label:has(input[value="3"])').click();
    assert.ok(await noHorizontalScroll(page));
    await page.screenshot({ path: `${ARTIFACTS}/players-hearts-lobby-${name}.png`, fullPage: true });
    await page.click("#play-robot");
    await waitForState(page, (ddp) => ddp.match?.phase === "playing");
    assert.equal(await page.evaluate(() => window.ddp.session.players.length), 3);

    await page.goto(`${srv.base}/chutes-and-ladders/`);
    assert.equal(await counts(page), "[2] 3 4", "Chutes and Ladders starts with one robot");

    await page.goto(`${srv.base}/chess/`);
    await page.locator("#play-robot").waitFor();
    assert.equal(await page.locator(".players-choice").count(), 0, "two-player games show nothing new");
    assert.ok(await noHorizontalScroll(page));
    await page.screenshot({ path: `${ARTIFACTS}/players-chess-lobby-${name}.png`, fullPage: true });
    await page.context().close();
  }
  assertNoErrors();
});
