// Headless-browser test for the invite screen's Share button: when sharing
// fails it copies the invite link instead and says so; a cancelled share
// sheet shows nothing; inside the mobile app it goes to the app (native.js).
// navigator.share is stubbed, so it runs on every OS.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser } from "../helpers.js";

const skip = skipWithoutPlaywright();

test("Share copies the invite link when sharing fails, and stays quiet when cancelled", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  // Each share rejects with the error name the test sets in window.shareError.
  const failingShare = () => {
    navigator.share = async () => {
      throw new DOMException("share failed", window.shareError);
    };
  };
  const page = await open("player", { init: failingShare });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: srv.base });

  await page.goto(`${srv.base}/ludo/`);
  await page.click("#play-friend");
  await page.locator("#room-code").waitFor({ timeout: 20_000 });
  const invite = await page.locator("#invite-link").inputValue();
  const share = page.getByRole("button", { name: "Share", exact: true });

  await page.evaluate(() => (window.shareError = "AbortError"));
  await share.click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#toast.show").count(), 0, "a cancelled share shows no toast");

  await page.evaluate(() => (window.shareError = "NotAllowedError"));
  await share.click();
  await page.locator("#toast.show", { hasText: "Sharing didn't work, so the invite link was copied" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), invite);

  assertNoErrors();
});

test("inside the app Share hands the invite link to the app's share sheet", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  // The app's JavaScript channel (native.js); this WebView has no navigator.share.
  const inApp = () => {
    window.sent = [];
    window.DDPApp = { postMessage: (text) => window.sent.push(JSON.parse(text)) };
    delete Navigator.prototype.share;
  };
  const page = await open("player", { init: inApp });

  await page.goto(`${srv.base}/tic-tac-toe/`);
  await page.click("#play-friend");
  await page.locator("#room-code").waitFor({ timeout: 20_000 });
  const invite = await page.locator("#invite-link").inputValue();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.sent), [{ type: "share", text: "Play Tic Tac Toe with me!", url: invite }]);
  assertNoErrors();
});
