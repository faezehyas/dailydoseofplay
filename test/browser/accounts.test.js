// Headless-browser test for accounts against a local fake Google
// (test/fake-google.js): sign in from a game's header, pick a public name,
// play a friend game under it, sign out, sign in again and delete the
// account. Screenshots of the sign-in, account and lobby screens at 360 px
// light and 1280 px dark go to test-artifacts/. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, waitForPhase, joinByInvite, noHorizontalScroll, pick } from "../helpers.js";
import { startFakeGoogle } from "../fake-google.js";

const skip = skipWithoutPlaywright();

// Once a page's view transition and other finite animations have ended, for a screenshot.
const settled = (page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));

async function withGoogle(t) {
  const google = await startFakeGoogle();
  t.after(() => google.close());
  return openBrowser(t, { server: { accounts: google.settings, google: google.urls } });
}

test("sign in, pick a name, play a friend game signed in, sign out, sign in again, delete the account", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await withGoogle(t);
  const page = await open("player", { nickname: "Al", phone: true, colorScheme: "light" });
  const shot = async (name) => (await settled(page), page.screenshot({ path: `${ARTIFACTS}/accounts-${name}-360-light.png`, fullPage: true }));

  // Signed out, the lobby has its nickname field. A phone's header has no
  // room for "Sign in", so the settings panel has it.
  await page.goto(`${srv.base}/tic-tac-toe/`);
  await page.locator("#nickname").waitFor();
  await page.click("#settings-open");
  const signIn = page.locator("#settings-sign-in");
  await signIn.waitFor();
  assert.ok(await page.locator("#account-link").isHidden(), "no header link at 360 px");
  assert.ok(await noHorizontalScroll(page));
  await signIn.click();
  await page.waitForURL("**/account/?return=%2Ftic-tac-toe%2F");
  await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
  assert.ok(await noHorizontalScroll(page));
  await shot("sign-in");

  // Google answers at once (the fake), and a new account picks its public name, pre-filled from the nickname.
  await page.click("#sign-in-google");
  await page.getByRole("heading", { name: "Choose your public name" }).waitFor();
  assert.match(await page.locator("#account").innerText(), /player@example\.com/);
  assert.equal(await page.locator("#public-name").inputValue(), "Al");
  await page.click("text=Create account");
  assert.equal(await page.locator("#public-name-problem").innerText(), "At least 3 characters, please.");
  await page.fill("#public-name", "Countess Ada");
  assert.ok(await noHorizontalScroll(page));
  await shot("choose-name");
  await page.click("text=Create account");

  // Back in the game: the lobby plays under the public name; the nickname stays for signed-out play.
  await page.waitForURL("**/tic-tac-toe/");
  await page.locator("#nickname-account").waitFor();
  assert.match(await page.locator("#nickname-account").innerText(), /Playing as\s+Countess Ada/);
  assert.equal(await page.locator("#nickname").count(), 0);
  await page.click("#settings-open");
  assert.match(await page.locator("#settings-nickname-account").innerText(), /Countess Ada/);
  assert.ok(await page.locator("#settings-sign-in").isHidden());
  await page.click("#settings-close");
  assert.equal(await page.evaluate(() => localStorage.getItem("ddp-name")), "Al");
  assert.ok(await noHorizontalScroll(page));
  await shot("lobby");

  // A friend game, signed in: the friend sees the public name.
  await pick(page, "first", "host");
  const guest = await open("guest", { nickname: "Bo" });
  await joinByInvite(page, guest, srv);
  await waitForState(guest, (ddp) => ddp.match?.phase === "playing");
  await waitForState(page, (ddp) => ddp.match?.phase === "playing");
  assert.match(await guest.locator(".pb-players").innerText(), /Bo[\s\S]*Countess Ada/);
  for (const [k, [who, cell]] of [[page, 0], [guest, 3], [page, 1], [guest, 4], [page, 2]].entries()) {
    await waitForState(who, (ddp) => ddp.match.canMove());
    await who.click(`.ttt-cell[data-i="${cell}"]`);
    await waitForState(guest, (ddp, n) => ddp.match.state.moves.length === n, k + 1);
  }
  await waitForPhase([page, guest]);
  assert.match(await page.locator("#ttt-status").innerText(), /win/i);
  await guest.close();

  // The account page, from the lobby: sign out.
  await page.goto(`${srv.base}/tic-tac-toe/`);
  await page.click("#nickname-account a");
  await page.getByRole("heading", { name: "Your account", exact: true }).waitFor();
  assert.equal(await page.locator("#public-name").inputValue(), "Countess Ada");
  assert.ok(await noHorizontalScroll(page));
  await shot("account");
  await page.click("#sign-out");
  await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
  assert.equal((await page.evaluate(() => fetch("/api/me").then((r) => r.json()))).user, null);

  // Signing in again goes straight back to the account.
  await page.click("#sign-in-google");
  await page.getByRole("heading", { name: "Your account", exact: true }).waitFor();

  // Delete: the button waits for the name, typed in any case.
  const del = page.locator("#delete-account");
  assert.ok(await del.isDisabled());
  await page.fill("#delete-confirm", "countess ada");
  await del.click();
  await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
  const me = await page.evaluate(() => fetch("/api/me").then((r) => r.json()));
  assert.deepEqual(me, { accounts: true, user: null, signup: null });
  await page.click("#sign-in-google");
  await page.getByRole("heading", { name: "Choose your public name" }).waitFor();
  assertNoErrors();
});

test("dark, wide: the sign-in, account and lobby screens", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await withGoogle(t);
  const page = await open("wide", { nickname: "Brave Otter", viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
  const shot = async (name) => (await settled(page), page.screenshot({ path: `${ARTIFACTS}/accounts-${name}-1280-dark.png`, fullPage: true }));
  await page.goto(`${srv.base}/ludo/`);
  const link = page.locator("#account-link");
  await link.waitFor();
  assert.equal(await link.innerText(), "Sign in");
  await link.click();
  await page.waitForURL("**/account/?return=%2Fludo%2F");
  await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
  assert.equal(await page.locator("#account-link").isHidden(), true, "no header link on the account page itself");
  await shot("sign-in");
  await page.click("#sign-in-google");
  await page.getByRole("heading", { name: "Choose your public name" }).waitFor();
  await shot("choose-name");
  await page.click("text=Create account");
  await page.waitForURL("**/ludo/");
  await page.locator("#nickname-account").waitFor();
  assert.equal(await link.innerText(), "Brave Otter");
  await shot("lobby");
  await link.click();
  await page.getByRole("heading", { name: "Your account", exact: true }).waitFor();
  await shot("account");
  assertNoErrors();
});

test("accounts off: no Sign in link, the nickname field as before, and the account page says so", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("off", { phone: true });
  await page.goto(`${srv.base}/ludo/`);
  await page.locator("#nickname").waitFor();
  await page.evaluate(() => fetch("/api/me"));
  assert.equal(await page.locator("#account-link").isHidden(), true);
  await page.goto(`${srv.base}/account/`);
  await page.getByText("Accounts aren't available right now").waitFor();
  assertNoErrors();
});
