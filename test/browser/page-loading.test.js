// Headless-browser test: a game page shows its title at once, while its
// modules load, and fetches the engine modules in parallel instead of one
// import level at a time. Without JavaScript it says the games need it.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser } from "../helpers.js";

const skip = skipWithoutPlaywright();
const viewport = { width: 360, height: 740 };

test("a game page shows its title while the lobby loads", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("player", { viewport });
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/engine/lobby.js", async (route) => (await held, route.continue()));
  // Only lobby.js imports room.js, so it's fetched before lobby.js arrives only when preloaded.
  const preloaded = page.waitForRequest("**/engine/room.js");
  // Not until "load": that waits for the modules.
  await page.goto(`${srv.base}/tic-tac-toe/`, { waitUntil: "commit" });

  const title = page.locator("#lobby h1");
  assert.equal(await title.textContent(), "Tic Tac Toe");
  await page.locator("#lobby .spinner").waitFor(); // a spinner shows while it loads
  await preloaded;
  const before = await title.boundingBox();

  release();
  await page.locator("#play-friend").waitFor();
  assert.equal(await page.locator("#lobby h1").count(), 1, "the lobby replaced the placeholder");
  assert.equal(await page.locator("#lobby .spinner").count(), 0);
  assert.equal((await title.boundingBox()).y, before.y, "the title doesn't move when the header arrives");
  assertNoErrors();
});

test("without JavaScript a game page says the games need it", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open } = await openBrowser(t);
  const page = await open("player", { viewport, javaScriptEnabled: false });
  await page.goto(`${srv.base}/tic-tac-toe/`);
  assert.equal(await page.locator("#lobby h1").textContent(), "Tic Tac Toe");
  const notice = page.locator("#lobby .notice");
  assert.match(await notice.textContent(), /^The games need JavaScript\./);
  assert.ok(await notice.isVisible());
  assert.equal(await page.locator("#lobby .spinner").isVisible(), false, "no spinner: nothing is loading");
});
