// Headless-browser test: a home page tile's "Play the robot" link starts a
// robot game, its "Play friends" link opens a room at once (the waiting room
// for a four-seat game), and a reload doesn't open a second room. Everything
// works with Tab and Enter, at 360 and 1280 px, light and dark. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, noHorizontalScroll } from "../helpers.js";

const skip = skipWithoutPlaywright();

async function home(page, base) {
  await page.goto(`${base}/`);
  await page.locator(".game-card[data-slug] .quick-play").last().waitFor();
}

test("quick play links on the home page start a game straight away", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);

  for (const [width, colorScheme] of [[1280, "light"], [1280, "dark"], [360, "light"], [360, "dark"]]) {
    const name = `${width} px ${colorScheme}`;
    const page = await open(name, { viewport: { width, height: 900 }, colorScheme, hasTouch: width === 360 });
    await home(page, srv.base);
    assert.ok(await noHorizontalScroll(page), `${name}: home page has no horizontal scroll`);
    await page.screenshot({ path: `${ARTIFACTS}/quick-play-home-${width}-${colorScheme}.png`, fullPage: true });

    // Play the robot: a robot game, no lobby.
    await page.getByRole("link", { name: "Play the robot at Tic Tac Toe" }).click();
    await waitForState(page, (ddp) => ddp?.robots.length === 1 && ddp.match?.phase === "playing");
    assert.ok(await page.locator("#game").isVisible(), `${name}: the game is on show`);
    assert.ok(await page.locator("#lobby").isHidden(), `${name}: the lobby is skipped`);

    // Play friends, two seats: the invite screen with a room code.
    await home(page, srv.base);
    await page.getByRole("link", { name: "Play friends at Tic Tac Toe" }).click();
    await page.locator("#room-code").waitFor();
    assert.match(await page.locator("#room-code").innerText(), /^[A-Z2-9]{4}$/);
    assert.match(await page.locator("#invite-link").inputValue(), /\/tic-tac-toe\/\?room=[A-Z2-9]{4}&key=/);
    assert.equal(new URL(page.url()).search, "", `${name}: ?friend=1 leaves the address bar`);
    assert.ok(await noHorizontalScroll(page), `${name}: invite screen has no horizontal scroll`);
    await page.screenshot({ path: `${ARTIFACTS}/quick-play-invite-${width}-${colorScheme}.png`, fullPage: true });
    await page.reload();
    await page.locator("#play-friend").waitFor();
    assert.equal(await page.locator("#room-code").count(), 0, `${name}: a reload doesn't create a second room`);

    // Play friends, four seats: the waiting room with its Start button.
    await home(page, srv.base);
    await page.getByRole("link", { name: "Play friends at Ludo" }).click();
    await page.locator("#room-code").waitFor();
    assert.ok(await page.locator("#roster").isVisible(), `${name}: Ludo shows the player list`);
    assert.ok(await page.locator("#start-game").isDisabled(), `${name}: Start waits for a friend`);
    await page.screenshot({ path: `${ARTIFACTS}/quick-play-waiting-${width}-${colorScheme}.png`, fullPage: true });

    // The rest of the tile still opens the lobby.
    await home(page, srv.base);
    // force: the name's stretched link covers the description, as intended.
    await page.locator('.game-card[data-slug="ludo"] p').click({ force: true });
    await page.locator("#play-friend").waitFor();
    assert.equal(new URL(page.url()).pathname, "/ludo/");
    await page.context().close();
  }

  // Keyboard: the name, then Play friends, then Play the robot; Enter follows each.
  const page = await open("keyboard");
  await home(page, srv.base);
  await page.locator('.game-card[data-slug="chess"] h2 a').focus();
  const focused = () => page.evaluate(() => document.activeElement.getAttribute("aria-label") ?? document.activeElement.textContent);
  assert.ok(
    await page.locator('.game-card[data-slug="chess"] h2 a').evaluate((a) => getComputedStyle(a, "::after").outlineStyle === "solid"),
    "the focused tile shows a focus ring",
  );
  await page.keyboard.press("Tab");
  assert.equal(await focused(), "Play friends at Chess");
  await page.keyboard.press("Tab");
  assert.equal(await focused(), "Play the robot at Chess");
  await page.keyboard.press("Enter");
  await waitForState(page, (ddp) => ddp?.robots.length === 1 && ddp.match?.phase === "playing");
  assert.equal(new URL(page.url()).pathname, "/chess/");

  await home(page, srv.base);
  await page.locator('.game-card[data-slug="chess"] h2 a').focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.locator("#room-code").waitFor();
  assert.equal(new URL(page.url()).pathname, "/chess/");

  await home(page, srv.base);
  await page.locator('.game-card[data-slug="chess"] h2 a').focus();
  await page.keyboard.press("Enter");
  await page.locator("#play-friend").waitFor();
  assert.equal(await page.locator("#room-code").count(), 0, "the name opens the lobby, not a room");
  await page.close();
  assertNoErrors();
});
