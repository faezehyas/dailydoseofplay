// Headless-browser test for the security headers: under connect-src 'self'
// the lobby still reaches /ws, and the Permissions-Policy still lets the
// invite link be copied and shared. Runs Chromium's new headless mode, which
// has navigator.share on macOS and Windows. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, waitForState } from "../helpers.js";

const skip = skipWithoutPlaywright();

test("the lobby reaches /ws, and the invite link copies and shares, under the security headers", { skip, timeout: 60_000 }, async (t) => {
  const { srv, errors, open, assertNoErrors } = await openBrowser(t, { launch: { channel: "chromium" } });
  // Records how the page's own share call ends; a Permissions-Policy block rejects it with NotAllowedError
  // at once, so a call still open a task later waits on the share sheet: "pending".
  const recordShare = () => {
    const share = navigator.share?.bind(navigator);
    if (!share) return;
    navigator.share = (data) => {
      const done = share(data);
      done.then(() => (window.shareResult = "ok"), (e) => (window.shareResult = e.name));
      setTimeout(() => (window.shareResult ??= "pending"));
      return done;
    };
  };
  const page = await open("player", { init: recordShare });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: srv.base });
  // Console errors are collected already; a policy report can also come as a warning.
  page.on("console", (m) => m.type() !== "error" && /Content Security Policy|Permissions policy/i.test(m.text()) && errors.push(m.text()));

  await page.goto(`${srv.base}/tic-tac-toe/`);
  await page.click("#play-friend");
  await page.locator("#room-code").waitFor({ timeout: 20_000 });
  const invite = await page.locator("#invite-link").inputValue();

  await page.click("#copy-link");
  await page.locator("#toast.show", { hasText: "Invite link copied" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), invite);

  // Chromium on Linux has no navigator.share, so the lobby shows no Share button there.
  if (await page.evaluate(() => "share" in navigator)) {
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await waitForState(page, () => window.shareResult);
    assert.notEqual(await page.evaluate(() => window.shareResult), "NotAllowedError");
  } else t.diagnostic("no navigator.share in this browser: Share not checked");

  assertNoErrors();
});
