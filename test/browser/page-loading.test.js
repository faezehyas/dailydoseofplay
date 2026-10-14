// Headless-browser test: a game page shows its lobby at once, with the
// buttons disabled, while its modules load, and fetches the engine modules in
// parallel instead of one import level at a time. Nothing moves when the real
// lobby replaces it, and a spinner shows only after 400 ms. Without
// JavaScript it says the games need it. Skips if Playwright is missing.
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

test("every game shows its lobby, disabled, while it loads, and nothing moves when it arrives", { skip: !pw && "Playwright not installed", timeout: 180_000 }, async (t) => {
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
    const buttons = card.locator(".lobby-actions button");
    assert.ok((await buttons.count()) >= 2, game.name);
    for (const button of await buttons.all()) assert.ok(await button.isDisabled(), `${game.name}: ${await button.textContent()} is disabled`);
    assert.equal(await card.getByRole("status").textContent(), "Loading…");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${game.name}: no sideways scroll at 360 px`);
    await preloaded;
    const before = { title: await box(card.locator("h1")), icon: await box(icon), friend: await box(buttons.nth(0)), robot: await box(card.locator(".lobby-actions .btn.big").nth(1)) };

    release();
    await page.locator("#play-friend:not([disabled])").waitFor();
    assert.equal(await page.locator("#lobby h1").count(), 1, `${game.name}: the lobby replaced the placeholder`);
    assert.equal(await page.locator("#lobby .spinner").count(), 0);
    const after = { title: await box(page.locator("#lobby h1")), icon: await box(page.locator(".lobby-icon img")), friend: await box(page.locator("#play-friend")), robot: await box(page.locator("#play-robot")) };
    assert.deepEqual(after, before, `${game.name}: the title, icon and buttons don't move when the lobby arrives`);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
});

test("the spinner waits 400 ms, and doesn't show under reduced motion", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const { srv, open } = await setup(t);
  const { page } = await open();
  await holdLobby(page);
  await page.goto(`${srv.base}/tic-tac-toe/`, { waitUntil: "commit" });
  const spinner = page.locator("#lobby .spinner");
  await spinner.waitFor({ state: "attached" });
  // Nothing animates in the first 400 ms: every animation on the page waits that long, the spinner's too.
  const delays = await page.evaluate(() => document.getAnimations().map((a) => a.effect.getTiming().delay));
  assert.ok(delays.length > 0 && delays.every((d) => d >= 400), `animation delays: ${delays}`);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#lobby .spinner")).opacity === "1");

  const calm = await open({ reducedMotion: "reduce" });
  await holdLobby(calm.page);
  await calm.page.goto(`${srv.base}/tic-tac-toe/`, { waitUntil: "commit" });
  await calm.page.locator("#lobby h1").waitFor();
  await calm.page.waitForTimeout(600);
  assert.equal(await calm.page.locator("#lobby .spinner").isVisible(), false);
  assert.equal(await calm.page.evaluate(() => document.getAnimations().length), 0, "no animation under reduced motion");
});

test("the home tile's icon and the lobby's share a view-transition name", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const { srv, open } = await setup(t);
  const { page, errors } = await open();
  await page.goto(`${srv.base}/`);
  const name = (sel) => page.locator(sel).evaluate((e) => getComputedStyle(e).viewTransitionName);
  assert.equal(await name('.game-card[data-slug="tic-tac-toe"] .game-icon'), "icon-tic-tac-toe");
  await page.goto(`${srv.base}/tic-tac-toe/`);
  await page.locator("#play-friend:not([disabled])").waitFor();
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
  assert.equal(await page.locator("#lobby .spinner").isVisible(), false, "no spinner: nothing is loading");
});
