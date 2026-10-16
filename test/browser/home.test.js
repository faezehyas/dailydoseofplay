// Headless-browser tests: every game tile on the home page is the same size,
// whatever its description's length, and shows no "Made by" line; a phone
// screen doesn't scroll sideways or hide the first tile below the hero and
// shows compact tiles; placeholders hold the tiles' places while the list
// loads, and a failed load offers Retry; the hero's scene loops, pauses off
// screen and in a hidden tab, and holds still with reduced motion. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState } from "../helpers.js";

const { games } = JSON.parse(readFileSync("public/games.json", "utf8"));

const skip = skipWithoutPlaywright();

test("home page tiles are all the same size", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);

  for (const width of [1280, 768, 560, 360]) {
    const page = await open(`${width}`, { viewport: { width, height: 900 } });
    const pending = new Map();
    const t0 = Date.now();
    page.on("request", (r) => pending.set(r, Date.now() - t0));
    page.on("requestfinished", (r) => pending.delete(r));
    page.on("requestfailed", (r) => { console.log("DIAG failed", r.url(), r.failure()?.errorText); pending.delete(r); });
    page.on("console", (m) => console.log("DIAG console", m.type(), m.text()));
    page.on("domcontentloaded", () => console.log("DIAG dcl", width, Date.now() - t0));
    page.on("load", () => console.log("DIAG load", width, Date.now() - t0));
    const diag = setTimeout(async () => {
      console.log("DIAG stuck", width, [...pending].map(([r, at]) => `${r.method()} ${r.url()} @${at}`));
      console.log("DIAG state", await page.evaluate(() => ({ rs: document.readyState, fonts: document.fonts.status, imgs: [...document.images].map((i) => `${i.src} ${i.complete} ${i.loading}`) })).catch((e) => e.message));
    }, 15_000);
    await page.goto(`${srv.base}/`);
    clearTimeout(diag);
    await page.locator(".game-card[data-slug]").nth(games.length - 1).waitFor();
    const cards = await page.locator(".game-card[data-slug]").evaluateAll((els) =>
      els.map((card) => {
        const box = card.getBoundingClientRect();
        const p = card.querySelector("p");
        return {
          madeBy: card.textContent.includes("Made by"),
          height: box.height,
          right: box.right,
          metaGap: box.bottom - card.querySelector(".game-meta").getBoundingClientRect().bottom,
          lines: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)),
          text: p.textContent,
        };
      }),
    );
    assert.equal(cards.length, games.length);
    for (const [i, card] of cards.entries()) {
      const name = `${games[i].slug} at ${width} px`;
      assert.ok(Math.abs(card.height - cards[0].height) < 1, `${name}: height ${card.height}, first card ${cards[0].height}`);
      assert.ok(Math.abs(card.metaGap - cards[0].metaGap) < 1, `${name}: players line and badge sit at the bottom`);
      assert.ok(card.lines <= 2, `${name}: description shows ${card.lines} lines`);
      assert.equal(card.text, games[i].description, `${name}: the full description stays in the DOM`);
      assert.ok(card.right <= width, `${name}: card ends inside the screen`);
      assert.equal(card.madeBy, false, `${name}: no "Made by" line`);
    }
    if (width === 360) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no horizontal scroll at 360 px");
      const iconBottom = await page.locator(".game-card[data-slug] .game-icon").first().evaluate((e) => e.getBoundingClientRect().bottom);
      assert.ok(iconBottom <= 640, `first tile's picture ends at ${iconBottom} px, below a 640 px phone screen`);
    }
    if (width < 600) {
      assert.ok(cards[0].height <= 150, `${width} px: tiles are ${cards[0].height} px tall, not compact`);
      // A tap anywhere in a 44 px tall band lands on the quick play link.
      const reach = await page.locator(".game-card[data-slug]").first().locator(".quick-play a").evaluateAll((links) =>
        links.map((a) => {
          const box = a.getBoundingClientRect();
          const mid = box.top + box.height / 2;
          return [mid - 21.5, mid + 21.5].every((y) => document.elementFromPoint(box.left + box.width / 2, y)?.closest("a") === a);
        }),
      );
      assert.deepEqual(reach, [true, true], `${width} px: quick play links take taps 44 px tall`);
    }
    await page.screenshot({ path: `${ARTIFACTS}/home-${width}.png`, fullPage: true });
    await page.close();
  }
  assertNoErrors();
});

// Holds every games.json request until release() is called (or fails it),
// so the test can look at the page while the list is still loading.
async function holdGames(page, { fail = false } = {}) {
  let release;
  const released = new Promise((r) => (release = r));
  await page.unrouteAll();
  await page.route("**/games.json", async (route) => {
    await released;
    if (fail) await route.fulfill({ status: 500, body: "" });
    else await route.continue();
  });
  return release;
}

function footerTop(page) {
  return page.evaluate(() => document.querySelector(".site-footer").getBoundingClientRect().top + scrollY);
}

function tileHeights(page, selector) {
  return page.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
}

test("home page shows placeholders while loading and a Retry button on failure", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, errors } = await openBrowser(t);

  // A wide font stands in for the fallback fonts on Linux and Windows, where a
  // long game name could otherwise wrap and make its tile taller.
  for (const [width, font] of [[1280], [360], [768, "monospace"]]) {
    const page = await open(`${width}`, { viewport: { width, height: 900 } });

    // Slow list: placeholders first, then real tiles in the same places.
    let release = await holdGames(page);
    await page.goto(`${srv.base}/`);
    if (font) await page.addStyleTag({ content: `body { font-family: ${font}; }` });
    const placeholders = page.locator(".game-card.placeholder");
    assert.equal(await placeholders.count(), games.length, `${width} px: one placeholder per game`);
    assert.equal(await page.locator("#games > li[aria-hidden='true']").count(), games.length, `${width} px: placeholders are hidden from screen readers`);
    assert.equal(await placeholders.first().locator(".game-icon").evaluate((e) => getComputedStyle(e).animationName), "shimmer");
    const before = { footer: await footerTop(page), tiles: await tileHeights(page, ".game-card.placeholder") };
    await page.screenshot({ path: `${ARTIFACTS}/home-loading-${width}.png`, fullPage: true });
    release();
    await page.locator(".game-card[data-slug]").nth(games.length - 1).waitFor();
    assert.equal(await placeholders.count(), 0, `${width} px: placeholders are gone`);
    const after = { footer: await footerTop(page), tiles: await tileHeights(page, ".game-card[data-slug]") };
    assert.ok(Math.abs(after.footer - before.footer) <= 2, `${width} px: footer moved from ${before.footer} to ${after.footer}`);
    for (const [i, h] of after.tiles.entries()) {
      assert.ok(Math.abs(h - before.tiles[i]) <= 2, `${width} px: tile ${i} is ${h} px, its placeholder ${before.tiles[i]} px`);
    }

    // Failed list: an error notice with Retry; a retry that works shows the tiles.
    release = await holdGames(page, { fail: true });
    await page.reload();
    release();
    const retry = page.getByRole("button", { name: "Retry" });
    await retry.waitFor();
    assert.match(await page.locator("#games [role='alert']").innerText(), /Couldn't load the game list/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} px: no horizontal scroll`);
    await page.screenshot({ path: `${ARTIFACTS}/home-error-${width}.png`, fullPage: true });
    release = await holdGames(page);
    await retry.click();
    assert.equal(await placeholders.count(), games.length, `${width} px: placeholders return while retrying`);
    release();
    await page.locator(".game-card[data-slug]").nth(games.length - 1).waitFor();
    assert.equal(await retry.count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.matches(".game-card h2 a")), true, `${width} px: focus moves to the first tile`);
    await page.close();
  }

  // Reduced motion: the placeholders hold still.
  const page = await open("reduced motion", { reducedMotion: "reduce" });
  const release = await holdGames(page);
  await page.goto(`${srv.base}/`);
  assert.equal(await page.locator(".game-card.placeholder .game-icon").first().evaluate((e) => getComputedStyle(e).animationName), "none");
  release();
  await page.close();
  // The failed games.json the test serves on purpose is logged as a console error.
  assert.deepEqual(errors.filter((e) => !e.endsWith("status of 500 (Internal Server Error)")), []);
});

test("the hero scene loops, plays a move on hover and pauses when unseen", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const states = (page) => page.evaluate(() => [...new Set(document.querySelector(".hero-scene").getAnimations({ subtree: true }).map((a) => a.playState))]);
  const setHidden = (page, hidden) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);

  const page = await open("page", { viewport: { width: 1280, height: 800 } });
  await page.goto(`${srv.base}/`);
  const scene = page.locator(".hero-scene");
  assert.equal(await scene.getAttribute("aria-hidden"), "true");
  assert.ok((await scene.evaluate((e) => e.outerHTML.length)) < 25_000, "the scene's SVG is under 25 KB");
  assert.deepEqual(await states(page), ["running"]);

  await page.locator(".hero-scene .piece").nth(2).hover();
  assert.equal(await page.locator(".hero-scene .die").evaluate((e) => getComputedStyle(e).animationName), "scene-die", "hovering the die rolls it once");
  await page.mouse.move(0, 0);

  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await waitForState(page, () => document.querySelector(".hero-scene").classList.contains("paused"));
  assert.deepEqual(await states(page), ["paused"], "off screen");
  await page.evaluate(() => scrollTo(0, 0));
  await waitForState(page, () => !document.querySelector(".hero-scene").classList.contains("paused"));
  await setHidden(page, true);
  assert.deepEqual(await states(page), ["paused"], "hidden tab");
  await setHidden(page, false);
  assert.deepEqual(await states(page), ["running"]);
  await page.close();

  // Reduced motion: a still scene, at each size and theme.
  for (const colorScheme of ["light", "dark"]) {
    for (const width of [360, 1280]) {
      const still = await open(`still ${width} ${colorScheme}`, { viewport: { width, height: 800 }, colorScheme, reducedMotion: "reduce" });
      await still.goto(`${srv.base}/`);
      await still.locator(".hero-scene .piece").nth(2).hover();
      assert.equal(await still.locator(".hero-scene").evaluate((e) => e.getAnimations({ subtree: true }).length), 0, `${width} px ${colorScheme}: no animations`);
      await still.screenshot({ path: `${ARTIFACTS}/home-scene-still-${width}-${colorScheme}.png` });
      await still.close();
    }
  }
  assertNoErrors();
});
