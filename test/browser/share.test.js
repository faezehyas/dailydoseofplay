// Headless-browser test for the invite screen's Share button: when sharing
// fails it copies the invite link instead and says so; a cancelled share
// sheet shows nothing; inside the mobile app it goes to the app (native.js).
// navigator.share is stubbed, so it runs on every OS.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "../helpers.js";

async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright"];
  try {
    candidates.push(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"));
  } catch {}
  for (const c of candidates.filter(Boolean)) {
    try {
      return require(c);
    } catch {}
  }
  return null;
}

const pw = await loadPlaywright();

test("Share copies the invite link when sharing fails, and stays quiet when cancelled", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const ctx = await browser.newContext();
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: srv.base });
  // Each share rejects with the error name the test sets in window.shareError.
  await ctx.addInitScript(() => {
    navigator.share = async () => {
      throw new DOMException("share failed", window.shareError);
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

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

  assert.deepEqual(errors, []);
});

test("inside the app Share hands the invite link to the app's share sheet", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const ctx = await browser.newContext();
  // The app's JavaScript channel (native.js); this WebView has no navigator.share.
  await ctx.addInitScript(() => {
    window.sent = [];
    window.DDPApp = { postMessage: (text) => window.sent.push(JSON.parse(text)) };
    delete Navigator.prototype.share;
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${srv.base}/tic-tac-toe/`);
  await page.click("#play-friend");
  await page.locator("#room-code").waitFor({ timeout: 20_000 });
  const invite = await page.locator("#invite-link").inputValue();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.sent), [{ type: "share", text: "Play Tic Tac Toe with me!", url: invite }]);
  assert.deepEqual(errors, []);
});
