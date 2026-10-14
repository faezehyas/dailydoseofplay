// Headless-browser test for the settings panel behind the header's gear: the
// theme and volume chosen on the home page apply in a game; a
// room setting is locked during a game until the next one, while a view
// setting stays open; and the panel works with the keyboard alone. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, noHorizontalScroll } from "../helpers.js";

const skip = skipWithoutPlaywright();

// The gain that feeds the speakers: the master volume.
function findMaster() {
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode) window.ddpMaster = this;
    return connect.call(this, dest, ...rest);
  };
}

async function setup(t) {
  const { srv, open: openPage, assertNoErrors } = await openBrowser(t);
  const open = (opts = {}) => openPage("player", { nickname: "Ada", viewport: { width: 360, height: 740 }, hasTouch: true, init: findMaster, ...opts });
  return { srv, open, assertNoErrors };
}

const html = (page) => page.evaluate(() => ({ ...document.documentElement.dataset }));
const prefs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("ddp-settings")));
const focused = (page) => page.evaluate(() => document.activeElement?.id);
const option = (name, value) => `#settings label:has(input[name="${name}"][value="${value}"])`;

test("theme and volume set on the home page apply in a game", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const page = await open({ colorScheme: "light" });
  await page.goto(`${srv.base}/`);
  assert.deepEqual(await html(page), {}, "follows the device: light");
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.tap("#settings-open");
  await page.locator("#settings").waitFor();
  assert.equal(await focused(page), "settings-close", "focus moves into the panel");
  assert.equal(await page.locator("#settings [role=tab]").count(), 0, "no game tab on the home page");
  assert.equal(await page.locator("#settings-nickname").inputValue(), "Ada");
  await page.tap(option("settings-theme", "dark"));
  await page.locator("#settings-volume").fill("40");
  assert.ok(await noHorizontalScroll(page), "no sideways scroll at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/settings-1-home-mobile-light.png` });
  assert.deepEqual(await html(page), { theme: "dark" }, "applied at once");
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), lightBg);
  assert.equal(await page.locator("#theme-toggle").getAttribute("aria-pressed"), "true", "the header's toggle follows");
  assert.deepEqual(await prefs(page), { theme: "dark", sound: true, volume: 40, askBeforeLeaving: true, muteReactions: false });
  await page.tap("#settings-close");
  await page.locator("#settings").waitFor({ state: "detached" });
  assert.equal(await focused(page), "settings-open", "focus goes back to the gear");
  // A tap inside the sheet keeps it open; a tap above it closes it.
  await page.tap("#settings-open");
  await page.tap("#settings-title");
  assert.ok(await page.locator("#settings[open]").isVisible());
  await page.touchscreen.tap(180, 20);
  await page.locator("#settings").waitFor({ state: "detached" });

  // In a robot game: dark, and sounds through a master gain of 0.4² = 0.16.
  await page.goto(`${srv.base}/tic-tac-toe/?robot=1`);
  await page.locator(".ttt-cell").first().waitFor();
  assert.deepEqual(await html(page), { theme: "dark" });
  // The robot may move first, and may take any cell: tap a free one on my turn.
  await page.locator('.ttt-cell[aria-disabled="false"]').first().tap();
  await waitForState(page, () => window.ddpMaster);
  assert.ok(Math.abs((await page.evaluate(() => window.ddpMaster.gain.value)) - 0.16) < 1e-6, "the volume reaches the game's sound");

  // Changed mid-game, it applies at once there too.
  await page.tap("#settings-open");
  await page.tap(option("settings-theme", "system"));
  await page.locator("#settings-volume").fill("100");
  assert.deepEqual(await html(page), {}, "back to the device's theme");
  await waitForState(page, () => window.ddpMaster.gain.value > 0.99);
  await page.keyboard.press("Escape");
  await page.locator("#settings").waitFor({ state: "detached" });
  assertNoErrors();
});

test("a room setting is locked during a game until the next one; a view setting stays open", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const page = await open({ viewport: { width: 1280, height: 900 }, hasTouch: false, colorScheme: "dark" });
  await page.goto(`${srv.base}/tic-tac-toe/`);
  // In the lobby the game's tab is open, and a change shows in the lobby card too.
  await page.click("#settings-open");
  await page.click("#settings-tab-game");
  assert.ok(await page.locator("#panel-locked").isHidden(), "not locked in the lobby");
  await page.click(option("panel-size", 5));
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('#ttt-settings input[name="ttt-size"]:checked').getAttribute("value"), "5", "the lobby card follows");
  assert.match(await page.locator("#ttt-settings .settings-line").innerText(), /5 × 5/);

  await page.click("#play-robot");
  await page.locator(".ttt-cell").first().waitFor();
  assert.equal(await page.locator(".ttt-cell").count(), 25);
  await page.click("#settings-open");
  assert.equal(await page.locator("#settings-tab-general").getAttribute("aria-selected"), "true", "General first");
  await page.click("#settings-tab-game");
  await page.locator("#panel-locked").waitFor();
  assert.match(await page.locator("#panel-locked").innerText(), /Locked during a game/);
  assert.ok(await page.locator('input[name="panel-size"][value="3"]').isDisabled(), "the board size is locked");
  await page.click(option("panel-size", 3), { force: true });
  assert.equal(await page.locator('input[name="panel-size"]:checked').getAttribute("value"), "5", "a tap changes nothing");
  await page.screenshot({ path: `${ARTIFACTS}/settings-2-locked-desktop-dark.png` });
  await page.keyboard.press("Escape");

  // The next game: back in the lobby the option is open again, and the change applies.
  await page.click("#leave");
  await page.locator("#play-robot").waitFor();
  await page.click("#settings-open");
  await page.click("#settings-tab-game");
  assert.ok(await page.locator("#panel-locked").isHidden());
  await page.click(option("panel-size", 3));
  await page.keyboard.press("Escape");
  await page.click("#play-robot");
  await page.locator(".ttt-cell").first().waitFor();
  assert.equal(await page.locator(".ttt-cell").count(), 9, "the next game uses the new size");

  // Chutes and Ladders' spinner is a view setting: open during a game.
  await page.goto(`${srv.base}/chutes-and-ladders/?robot=1`);
  await page.locator("#cl-spin").waitFor();
  await page.click("#settings-open");
  await page.click("#settings-tab-game");
  assert.ok(await page.locator('input[name="panel-finish"][value="bounce"]').isDisabled(), "the rules are locked");
  assert.ok(await page.locator('input[name="panel-spin"][value="auto"]').isEnabled(), "the spinner is not");
  await page.click(option("panel-spin", "auto"));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("ddp-cl-settings")).spin), "auto");
  await page.screenshot({ path: `${ARTIFACTS}/settings-3-view-desktop-dark.png` });
  await page.keyboard.press("Escape");
  assertNoErrors();
});

test("the panel works with the keyboard alone", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const page = await open({ colorScheme: "light", hasTouch: false });
  await page.goto(`${srv.base}/ludo/`);
  for (let i = 0; i < 10 && (await focused(page)) !== "settings-open"; i++) await page.keyboard.press("Tab");
  assert.equal(await focused(page), "settings-open", "the gear is reachable with Tab");
  await page.keyboard.press("Enter");
  await page.locator("#settings").waitFor();
  assert.equal(await focused(page), "settings-close");

  // Tabs: arrow keys move between them and show their page.
  await page.keyboard.press("Tab");
  assert.equal(await focused(page), "settings-tab-general");
  await page.keyboard.press("ArrowRight");
  assert.equal(await focused(page), "settings-tab-game");
  assert.ok(await page.locator("#settings-game").isVisible());
  assert.ok(await page.locator("#settings-general").isHidden());
  await page.keyboard.press("Home");
  assert.equal(await focused(page), "settings-tab-general");
  assert.ok(await page.locator("#settings-general").isVisible());

  // Nickname, then theme and volume.
  await page.keyboard.press("Tab");
  assert.equal(await focused(page), "settings-nickname");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Bo");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => localStorage.getItem("ddp-name")), "Bo");
  assert.equal(await page.locator("#nickname").inputValue(), "Bo", "the lobby's field follows");
  await page.keyboard.press("ArrowRight"); // System → Light
  assert.equal((await html(page)).theme, "light");
  await page.keyboard.press("Tab"); // the sound switch
  assert.equal(await focused(page), "settings-sound");
  await page.keyboard.press("Tab"); // volume
  assert.equal(await focused(page), "settings-volume");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  assert.equal((await prefs(page)).volume, 90);
  await page.keyboard.press("Tab"); // ask before leaving
  assert.equal(await focused(page), "settings-ask");
  await page.keyboard.press("Space");
  assert.equal((await prefs(page)).askBeforeLeaving, false);
  assert.equal(await page.locator("#settings-ask").getAttribute("role"), "switch");
  await page.screenshot({ path: `${ARTIFACTS}/settings-4-keyboard-mobile-light.png` });

  await page.keyboard.press("Escape");
  await page.locator("#settings").waitFor({ state: "detached" });
  assert.equal(await focused(page), "settings-open", "Esc closes it and focus goes back to the gear");
  assertNoErrors();
});
