// Headless-browser test: a game page shows its title and a piece of its game
// at once, while its modules load, and fetches the engine modules in parallel
// instead of one import level at a time. Without JavaScript it says the games
// need it.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer } from "../helpers.js";
import { pw, noHorizontalScroll } from "./ludo.shared.js";

const { games } = JSON.parse(readFileSync(new URL("../../public/games.json", import.meta.url), "utf8"));

async function setup(t, options = {}) {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const page = await browser.newPage({ viewport: { width: 360, height: 740 }, ...options });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { srv, page, errors };
}

test("a game page shows its title while the lobby loads", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const { srv, page, errors } = await setup(t);
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/engine/lobby.js", async (route) => (await held, route.continue()));
  // Only lobby.js imports room.js, so it's fetched before lobby.js arrives only when preloaded.
  const preloaded = page.waitForRequest("**/engine/room.js");
  // Not until "load": that waits for the modules.
  await page.goto(`${srv.base}/tic-tac-toe/`, { waitUntil: "commit" });

  const title = page.locator("#lobby h1");
  assert.equal(await title.textContent(), "Tic Tac Toe");
  await page.locator("#lobby .loading-piece").waitFor(); // a piece moves while it loads
  await preloaded;
  const before = await title.boundingBox();

  release();
  await page.locator("#play-friend").waitFor();
  assert.equal(await page.locator("#lobby h1").count(), 1, "the lobby replaced the placeholder");
  assert.equal(await page.locator("#lobby .loading-piece").count(), 0);
  assert.equal((await title.boundingBox()).y, before.y, "the title doesn't move when the header arrives");
  assert.deepEqual(errors, []);
});

test("without JavaScript a game page says the games need it", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const { srv, page } = await setup(t, { javaScriptEnabled: false });
  await page.goto(`${srv.base}/tic-tac-toe/`);
  assert.equal(await page.locator("#lobby h1").textContent(), "Tic Tac Toe");
  const notice = page.locator("#lobby .notice");
  assert.match(await notice.textContent(), /^The games need JavaScript\./);
  assert.ok(await notice.isVisible());
  assert.equal(await page.locator("#lobby .loading-piece").isVisible(), false, "no piece: nothing is loading");
});

for (const reducedMotion of ["no-preference", "reduce"]) {
  test(`every game's placeholder shows its piece and title (motion: ${reducedMotion})`, { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
    const { srv, page, errors } = await setup(t, { reducedMotion });
    await page.route("**/engine/lobby.js", () => {}); // never arrives
    for (const { slug, name } of games) {
      await page.goto(`${srv.base}/${slug}/`, { waitUntil: "commit" });
      const piece = page.locator("#lobby .lobby-card .loading-piece");
      await piece.waitFor();
      assert.equal(await page.locator("#lobby h1").textContent(), name, slug);
      assert.ok((await piece.boundingBox()).y > (await page.locator("#lobby h1").boundingBox()).y, `${slug}: the title stays on top`);
      assert.equal(await page.locator('#lobby [role="status"]').textContent().then((s) => s.trim()), "Loading…", slug);
      assert.ok(await noHorizontalScroll(page), `${slug}: no sideways scroll`);
      const running = await page.evaluate(() => document.querySelector(".loading-piece").getAnimations({ subtree: true }).length);
      if (reducedMotion === "reduce") assert.equal(running, 0, `${slug}: the piece stands still`);
      else assert.ok(running > 0, `${slug}: the piece moves`);
    }
    assert.deepEqual(errors, []);
  });
}
