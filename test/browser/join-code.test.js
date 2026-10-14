// Headless-browser test: joining with a typed room code. The field cleans what
// is typed and joins at four characters; a failed join shows its error under
// the field and keeps the code there. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, joinByInvite, noHorizontalScroll } from "../helpers.js";

const skip = skipWithoutPlaywright();

async function setup(t) {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  return { srv, assertNoErrors, open: (name) => open(name, { viewport: { width: 360, height: 740 } }) };
}

test("the code field cleans what you type, joins at four characters and keeps a bad code", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const page = await open("page");
  await page.goto(`${srv.base}/chess/`);
  const field = page.locator("#join-code");
  assert.equal(await field.getAttribute("enterkeyhint"), "go");
  assert.equal(await field.getAttribute("autocomplete"), "off");
  assert.equal(await field.getAttribute("aria-label"), "Room code");

  await field.pressSequentially("ab-c ");
  assert.equal(await field.inputValue(), "ABC", "uppercased, without the dash and space");
  assert.equal(await page.locator("#join-error").isHidden(), true);
  await field.pressSequentially("1");
  assert.equal(await field.inputValue(), "ABC", "1 is never in a code");
  assert.equal(await page.locator("#join-error").innerText(), "Codes use letters and the numbers 2–9");

  // No room has this code: the error sits under the field, which keeps the code.
  await field.pressSequentially("d");
  const error = page.locator("#join-error", { hasText: "doesn't exist any more" });
  await error.waitFor();
  assert.equal(await field.inputValue(), "ABCD");
  assert.match(await error.getAttribute("class"), /\berror\b/);
  assert.equal(await page.evaluate(() => document.activeElement.id), "join-code", "focus is back on the code");
  assert.equal(await field.getAttribute("aria-describedby"), "join-error");
  assert.equal(await page.locator("#lobby-progress").textContent(), await error.textContent(), "the error is read out");
  assert.equal(await noHorizontalScroll(page), true);

  // The Join button still works, and typing again clears the error.
  await page.locator(".join-row button").click();
  await page.locator("#join-error", { hasText: "doesn't exist any more" }).waitFor();
  await page.keyboard.press("Backspace");
  assert.equal(await page.locator("#join-error").isHidden(), true);
  assertNoErrors();
});

test("an invite link to a closed room shows the error with the code filled in", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("host");
  await host.goto(`${srv.base}/chess/`);
  const { invite } = await joinByInvite(host, [], srv);
  const code = new URL(invite).searchParams.get("room");
  await host.getByRole("button", { name: "Cancel" }).click();
  await host.locator("#play-friend").waitFor();

  const friend = await open("friend");
  await friend.goto(invite);
  await friend.click("#join-room");
  await friend.locator("#join-error", { hasText: "doesn't exist any more" }).waitFor();
  assert.equal(await friend.locator("#join-code").inputValue(), code);
  assert.equal(new URL(friend.url()).search, "", "the invite is gone from the address bar");
  assertNoErrors();
});
