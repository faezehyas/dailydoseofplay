// Headless-browser test for leaving a game: in a live friend match Leave, or
// the browser's Back, asks first in the site's dialog (Cancel, Esc or Back
// keeps playing, Leave ends it for the others), and closing the tab gets the
// browser's prompt; robot games and finished matches leave at once. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, joinByInvite, noHorizontalScroll } from "../helpers.js";

const skip = skipWithoutPlaywright();

async function setup(t) {
  const { srv, open: openPage, assertNoErrors } = await openBrowser(t);
  const prompts = []; // the browser's own dialogs, each dismissed
  async function open(nickname, opts = {}) {
    const page = await openPage(nickname, { nickname, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", ...opts });
    page.on("dialog", (d) => {
      prompts.push(`${nickname}: ${d.type()}`);
      d.dismiss();
    });
    return page;
  }
  // The host makes a room for the game; each friend opens the invite link.
  async function room(slug, host, friends) {
    await host.goto(`${srv.base}/${slug}/`);
    await joinByInvite(host, friends, srv);
  }
  return { srv, open, room, assertNoErrors, prompts };
}

const focused = (page) => page.evaluate(() => document.activeElement?.id);
const phase = (page) => page.evaluate(() => window.ddp.match.phase);
const back = (page) => page.goBack({ waitUntil: "commit" });

test("in a live friend game, Leave or Back asks first: Cancel, Esc or Back keeps playing, Leave ends it for the friend", { skip, timeout: 120_000 }, async (t) => {
  const { open, room, assertNoErrors, prompts } = await setup(t);
  const host = await open("Ada", { colorScheme: "dark" });
  const guest = await open("Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "light" });
  await room("tic-tac-toe", host, [guest]);
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match?.phase === "playing");

  // The friend on a phone taps Leave, then Cancel.
  await guest.tap("#leave");
  const dialog = guest.locator("dialog#confirm");
  await dialog.waitFor();
  assert.equal(await dialog.locator("h2").innerText(), "Leave the game?");
  assert.equal(await dialog.locator("p").innerText(), "Ada will be told you left.");
  assert.equal(await focused(guest), "confirm-no", "focus moves to Cancel");
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  await guest.screenshot({ path: `${ARTIFACTS}/leave-confirm-mobile-light.png` });
  await guest.tap("#confirm-no");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await focused(guest), "leave", "focus returns to Leave");
  assert.equal(await phase(guest), "playing");

  // The host, by keyboard: Esc closes the question too.
  await host.locator("#leave").focus();
  await host.keyboard.press("Enter");
  await host.locator("dialog#confirm").waitFor();
  await host.screenshot({ path: `${ARTIFACTS}/leave-confirm-desktop-dark.png` });
  await host.keyboard.press("Escape");
  await host.locator("dialog#confirm").waitFor({ state: "detached" });
  assert.equal(await focused(host), "leave");
  assert.equal(await phase(host), "playing");

  // Back asks the same question; Back again closes it and the game goes on.
  await back(host);
  await host.locator("dialog#confirm").waitFor();
  await back(host);
  await host.locator("dialog#confirm").waitFor({ state: "detached" });
  assert.equal(await phase(host), "playing");

  // Closing the tab gets the browser's own prompt; staying keeps the game.
  const prompted = guest.waitForEvent("dialog");
  await guest.close({ runBeforeUnload: true });
  await prompted;
  assert.deepEqual(prompts, ["Bo: beforeunload"]);
  assert.equal(await phase(guest), "playing");

  // Leave → Leave: the host is back in the lobby and the friend is told.
  await host.click("#leave");
  await host.click("#confirm-yes");
  await host.locator("#play-friend").waitFor();
  await waitForState(host, () => history.state === null, undefined, { timeout: 5_000 });
  await guest.locator("#ended", { hasText: "Ada left the game." }).waitFor({ timeout: 20_000 });
  assertNoErrors();
});

test("a finished friend match and a robot game leave at once, by Leave or Back", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, room, assertNoErrors, prompts } = await setup(t);
  const host = await open("Ada");
  const guest = await open("Bo");
  await room("tic-tac-toe", host, [guest]);
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
  // Whoever is on turn takes the first free square until the match is over.
  while ((await phase(host)) !== "over") {
    for (const p of [host, guest]) await p.evaluate(() => window.ddp.match.canMove() && document.querySelector(".ttt-cell:not([aria-disabled=true])")?.click());
    await host.waitForTimeout(50);
  }
  await guest.click("#leave");
  await guest.locator("#play-friend").waitFor();
  await host.locator("#ended", { hasText: "Bo left the game." }).waitFor({ timeout: 20_000 });

  const solo = await open("Cy");
  await solo.goto(`${srv.base}/tic-tac-toe/?robot=1`);
  await waitForState(solo, (ddp) => ddp.match?.phase === "playing");
  await solo.click("#leave");
  await solo.locator("#play-friend").waitFor();
  assert.equal(await solo.locator("dialog").count(), 0);
  // Back from a robot game returns to the lobby at once too.
  await solo.click("#play-robot");
  await waitForState(solo, (ddp) => ddp.match?.phase === "playing");
  await back(solo);
  await solo.locator("#play-friend").waitFor();
  assert.equal(await solo.locator("dialog").count(), 0);
  // Closing the tab mid robot game doesn't ask.
  await solo.click("#play-robot");
  await waitForState(solo, (ddp) => ddp.match?.phase === "playing");
  await solo.close({ runBeforeUnload: true });
  await solo.waitForEvent("close");
  assert.deepEqual(prompts, []);
  assertNoErrors();
});

test("with three players, a guest hears a robot takes their seat; the host is asked about the people left, and not once only robots remain", { skip, timeout: 120_000 }, async (t) => {
  const { open, room, assertNoErrors } = await setup(t);
  const host = await open("Ada");
  const friends = [await open("Bo"), await open("Cy")];
  await room("ludo", host, friends);
  await host.locator("#roster li.ready", { hasText: "Cy" }).waitFor();
  await host.click("#start-game");
  for (const p of [host, ...friends]) await waitForState(p, (ddp) => ddp.match?.phase === "playing");

  await host.click("#leave");
  assert.equal(await host.locator("dialog#confirm p").innerText(), "It ends for everyone.");
  await host.click("#confirm-no");
  await friends[0].click("#leave");
  assert.equal(await friends[0].locator("dialog#confirm p").innerText(), "A robot takes your seat and the game goes on.");
  await friends[0].click("#confirm-yes");
  for (const p of [host, friends[1]]) await p.locator(".pb-name", { hasText: "Bo (robot)" }).waitFor({ timeout: 20_000 });
  // Only Cy is left to tell.
  await host.click("#leave");
  assert.equal(await host.locator("dialog#confirm p").innerText(), "Cy will be told you left.");
  await host.click("#confirm-no");
  await friends[1].click("#leave");
  await friends[1].click("#confirm-yes");
  await host.locator(".pb-name", { hasText: "Cy (robot)" }).waitFor({ timeout: 20_000 });
  // Robots in every other seat: Leave goes at once, as in a robot game.
  await host.click("#leave");
  await host.locator("#play-friend").waitFor();
  assert.equal(await host.locator("dialog[open]").count(), 0);
  assertNoErrors();
});
