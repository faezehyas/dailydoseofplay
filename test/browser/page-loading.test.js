// Headless-browser test: a game page shows its lobby at once while its
// modules load, with a piece of the game where the buttons go, and fetches
// the engine modules in parallel instead of one import level at a time.
// Nothing moves when the real lobby replaces it, and the piece shows only
// after 400 ms. Without JavaScript it says the games need it. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer } from "../helpers.js";
import { pw } from "./ludo.shared.js";

const GAMES = JSON.parse(readFileSync(new URL("../../public/games.json", import.meta.url), "utf8")).games.filter((g) => g.status === "ready");

async function setup(t) {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  async function open(options = {}) {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, ...options });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    return { page, errors };
  }
  return { srv, open };
}

// Holds back /engine/lobby.js until release() is called.
async function holdLobby(page) {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/engine/lobby.js", async (route) => (await held, route.continue()));
  return release;
}

const box = async (locator) => {
  const { x, y, width, height } = await locator.boundingBox();
  return { x, y, width, height };
};

test("every game shows its icon, title and piece while it loads, and nothing moves when the lobby arrives", { skip: !pw && "Playwright not installed", timeout: 180_000 }, async (t) => {
  const { srv, open } = await setup(t);
  for (const game of GAMES) {
    const { page, errors } = await open();
    const release = await holdLobby(page);
    // Only lobby.js imports room.js, so it's fetched before lobby.js arrives only when preloaded.
    const preloaded = page.waitForRequest("**/engine/room.js");
    // Not until "load": that waits for the modules.
    await page.goto(`${srv.base}/${game.slug}/`, { waitUntil: "commit" });

    const card = page.locator("#lobby .lobby-card");
    assert.equal(await card.locator("h1").textContent(), game.name);
    assert.equal(await card.locator(".tagline").textContent(), game.description, game.name);
    const icon = card.locator(".lobby-icon img");
    await page.waitForFunction(() => document.querySelector(".lobby-icon img")?.complete && document.fonts.status === "loaded");
    assert.ok(await icon.evaluate((img) => img.naturalWidth > 0), `${game.name}: the icon shows`);
    // The piece fades in after 400 ms; the buttons under it are hidden, not disabled and tappable.
    const piece = card.locator(".lobby-actions .loading-piece");
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".loading-piece")).opacity === "1");
    assert.ok(await piece.isVisible(), `${game.name}: the piece shows`);
    const { width, height } = await piece.boundingBox();
    assert.deepEqual([width, height], [160, 96], `${game.name}: the piece is 160 x 96`);
    assert.equal(await card.locator(".lobby-actions button:visible").count(), 0, `${game.name}: no buttons until they work`);
    assert.equal(await card.getByRole("status").textContent().then((s) => s.trim()), "Loading…");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${game.name}: no sideways scroll at 360 px`);
    await preloaded;
    const before = { title: await box(card.locator("h1")), icon: await box(icon), row: await box(card.locator(".lobby-actions")) };

    release();
    await page.locator("#play-friend").waitFor();
    assert.equal(await page.locator("#lobby h1").count(), 1, `${game.name}: the lobby replaced the placeholder`);
    assert.equal(await page.locator("#lobby .loading-piece").count(), 0);
    const after = { title: await box(page.locator("#lobby h1")), icon: await box(page.locator(".lobby-icon img")), row: await box(page.locator(".lobby-actions")) };
    assert.deepEqual(after, before, `${game.name}: the title, icon and button row don't move when the lobby arrives`);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
});

test("nothing shows moving in the first 400 ms, and nothing animates under reduced motion", { skip: !pw && "Playwright not installed", timeout: 90_000 }, async (t) => {
  const { srv, open } = await setup(t);
  for (const game of GAMES) {
    const { page } = await open();
    await holdLobby(page);
    await page.goto(`${srv.base}/${game.slug}/`, { waitUntil: "commit" });
    await page.locator("#lobby .loading-piece").waitFor({ state: "attached" });
    // The piece's own moves may start at once, but it shows only when its fade-in, 400 ms on, ends; nothing else moves before then.
    const early = await page.evaluate(() =>
      document.getAnimations().filter((a) => !a.effect.target.closest(".loading-piece") || a.effect.target.matches(".loading-piece")).map((a) => a.effect.getTiming().delay),
    );
    assert.ok(early.length === 1 && early[0] >= 400, `${game.name}: animation delays outside the piece: ${early}`);
    await page.context().close();

    const calm = await open({ reducedMotion: "reduce" });
    await holdLobby(calm.page);
    await calm.page.goto(`${srv.base}/${game.slug}/`, { waitUntil: "commit" });
    const piece = calm.page.locator("#lobby .loading-piece");
    await piece.waitFor();
    assert.equal(await piece.evaluate((e) => getComputedStyle(e).opacity), "1", `${game.name}: the piece shows at once, still`);
    await calm.page.waitForTimeout(100);
    assert.equal(await calm.page.evaluate(() => document.getAnimations().length), 0, `${game.name}: no animation under reduced motion`);
    await calm.page.context().close();
  }
});

test("the home tile's icon and the lobby's share a view-transition name", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const { srv, open } = await setup(t);
  const { page, errors } = await open();
  await page.goto(`${srv.base}/`);
  const name = (sel) => page.locator(sel).evaluate((e) => getComputedStyle(e).viewTransitionName);
  assert.equal(await name('.game-card[data-slug="tic-tac-toe"] .game-icon'), "icon-tic-tac-toe");
  await page.goto(`${srv.base}/tic-tac-toe/`);
  await page.locator("#play-friend").waitFor();
  assert.equal(await name(".lobby-icon"), "icon-tic-tac-toe");
  assert.deepEqual(errors, []);
});

test("without JavaScript a game page says the games need it", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const { srv, open } = await setup(t);
  const { page } = await open({ javaScriptEnabled: false });
  await page.goto(`${srv.base}/tic-tac-toe/`);
  assert.equal(await page.locator("#lobby h1").textContent(), "Tic Tac Toe");
  const notice = page.locator("#lobby .notice");
  assert.match(await notice.textContent(), /^The games need JavaScript\./);
  assert.ok(await notice.isVisible());
  assert.equal(await page.locator("#lobby .loading-piece").isVisible(), false, "no piece: nothing is loading");
});
