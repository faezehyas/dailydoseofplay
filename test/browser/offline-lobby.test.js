// Headless-browser test: when the lobby server can't be reached (no
// connection, or the mobile app's offline copy), Play with friends and an
// invite link both show "You're offline" with the robot and the tutorial
// instead of an error. /ws is blocked by closing every socket the page opens.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, noHorizontalScroll } from "../helpers.js";

const skip = skipWithoutPlaywright();

test("the lobby shows the offline state when /ws is blocked", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("player", { viewport: { width: 360, height: 740 } });
  await page.routeWebSocket(/\/ws$/, (ws) => ws.close());

  await page.goto(`${srv.base}/ludo/`);
  await page.click("#play-friend");
  await page.getByRole("heading", { name: "You're offline" }).waitFor({ timeout: 10_000 });
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "You're offline", "focus moves to the heading");
  assert.match(await page.locator("#offline-note").innerText(), /Play the robot or learn a game/);
  assert.equal(await page.locator("#connect-error").count(), 0, "no error");
  assert.ok(await page.locator("#learn").isVisible(), "the tutorial is offered");
  assert.ok(await noHorizontalScroll(page), "no sideways scroll at 360 px");

  await page.click("#retry");
  await page.getByRole("heading", { name: "You're offline" }).waitFor({ timeout: 10_000 });
  await page.click("#play-robot");
  await page.locator("#game").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => window.ddp.session.mode), "robot");

  // An invite link opened without the lobby server.
  await page.goto(`${srv.base}/ludo/?room=ABCD&key=x`);
  await page.click("#join-room");
  await page.getByRole("heading", { name: "You're offline" }).waitFor({ timeout: 10_000 });
  assertNoErrors();
});
