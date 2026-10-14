// Headless-browser tests: while a ready game's home tile is hovered or has
// keyboard focus, it loops a short preview of the game in place of its icon,
// without changing size, and shows the icon again after (also when a click
// left focus in the tile); on a touch screen only the tile crossing a line
// across the screen loops; with reduced motion, or without a preview, the
// icon stays. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState } from "../helpers.js";

const { games } = JSON.parse(readFileSync("public/games.json", "utf8"));
const ready = games.filter((g) => g.status === "ready");

const skip = skipWithoutPlaywright();

// The tile's preview, if it has been swapped in: its animations' play states
// and when the last one ends.
function preview(page, slug) {
  return page.evaluate((slug) => {
    const svg = document.querySelector(`.game-card[data-slug="${slug}"] .game-icon svg.tile-preview`);
    if (!svg) return null;
    const animations = svg.getAnimations({ subtree: true });
    return {
      states: [...new Set(animations.map((a) => a.playState))],
      end: Math.max(...animations.map((a) => a.effect.getComputedTiming().endTime)),
      hidden: svg.getAttribute("aria-hidden"),
    };
  }, slug);
}

// Started: some animations still running and none waiting to start. A short
// one may already be over when a busy machine gets round to looking.
const started = (shown) => shown.states.includes("running") && !shown.states.includes("paused");

const tileSize = (page, slug) => page.locator(`.game-card[data-slug="${slug}"]`).evaluate((e) => [e.offsetWidth, e.offsetHeight]);

async function openHome(open, srv, name, options = {}) {
  const page = await open(name, { viewport: { width: 1280, height: 900 }, ...options });
  await page.goto(`${srv.base}/`);
  await page.locator(".game-card[data-slug]").nth(games.length - 1).waitFor();
  return page;
}

test("a tile loops its game's preview while hovered or focused, then shows its icon again", { skip, timeout: 90_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);

  for (const colorScheme of ["light", "dark"]) {
    for (const width of [1280, 360]) {
      const page = await openHome(open, srv, `home-${width}-${colorScheme}`, { viewport: { width, height: 900 }, colorScheme });
      const fetched = [];
      page.on("request", (r) => r.url().endsWith("/preview.svg") && fetched.push(r.url()));
      assert.equal(await page.locator("svg.tile-preview").count(), 0, "no preview before a hover");

      for (const { slug } of ready) {
        const tile = page.locator(`.game-card[data-slug="${slug}"]`);
        // The mouse waits in the gutter, so scrolling doesn't slide a tile under it.
        await page.mouse.move(0, 0);
        await tile.scrollIntoViewIfNeeded();
        assert.equal(await preview(page, slug), null, `${slug}: no preview before its hover`);
        const before = await tileSize(page, slug);
        await tile.hover();
        await tile.locator("svg.tile-preview").waitFor();
        const shown = await preview(page, slug);
        assert.ok(started(shown), `${slug} at ${width} px ${colorScheme}: the preview plays (${shown.states})`);
        assert.ok(shown.end >= 3000 && shown.end <= 5000, `${slug}: the preview lasts ${shown.end} ms`);
        assert.equal(shown.hidden, "true", `${slug}: the preview is decorative`);
        assert.equal(await tile.locator(".game-icon img").count(), 0, `${slug}: the preview replaced the icon`);
        assert.deepEqual(await tileSize(page, slug), before, `${slug} at ${width} px: the tile keeps its size`);
        await page.mouse.move(0, 0);
        await tile.locator(".game-icon img").waitFor();
        assert.equal(await preview(page, slug), null, `${slug}: the icon is back once the mouse leaves`);
      }
      assert.equal(fetched.length, ready.length, "each preview is fetched once");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} px: no horizontal scroll`);

      // A hovered preview loops; hovering the next tile puts its icon back.
      const [one, two] = ready.map((g) => g.slug);
      await page.locator(`.game-card[data-slug="${one}"]`).scrollIntoViewIfNeeded();
      await page.locator(`.game-card[data-slug="${one}"]`).hover();
      await page.locator(`.game-card[data-slug="${one}"] svg.tile-preview`).waitFor();
      await page.evaluate((slug) => {
        for (const a of document.querySelector(`.game-card[data-slug="${slug}"] svg.tile-preview`).getAnimations({ subtree: true })) a.finish();
      }, one);
      await waitForState(page, (_, slug) => document.querySelector(`.game-card[data-slug="${slug}"] svg.tile-preview`).getAnimations({ subtree: true }).some((a) => a.playState === "running"), one, { timeout: 5000 });
      await page.screenshot({ path: `${ARTIFACTS}/home-previews-${width}-${colorScheme}.png` });
      await page.locator(`.game-card[data-slug="${two}"]`).hover();
      await page.locator(`.game-card[data-slug="${one}"] .game-icon img`).waitFor();
      await page.locator(`.game-card[data-slug="${two}"] svg.tile-preview`).waitFor();
      assert.ok(started(await preview(page, two)), "the next tile plays");
      await page.close();
    }
  }

  // Keyboard: tabbing into a tile plays its preview; tabbing on to the next
  // tile puts the first one's icon back.
  const page = await openHome(open, srv, "keyboard");
  const [first, second] = await page.locator(".game-card[data-slug]").evaluateAll((els) => els.slice(0, 2).map((e) => e.dataset.slug));
  const focusedTile = () => page.evaluate(() => document.activeElement.closest(".game-card")?.dataset.slug);
  for (let i = 0; i < 20 && (await focusedTile()) !== first; i++) await page.keyboard.press("Tab");
  await page.locator(`.game-card[data-slug="${first}"] svg.tile-preview`).waitFor();
  assert.ok(started(await preview(page, first)), "focusing a tile with Tab plays its preview");
  for (let i = 0; i < 10 && (await focusedTile()) !== second; i++) await page.keyboard.press("Tab");
  await page.locator(`.game-card[data-slug="${second}"] svg.tile-preview`).waitFor();
  await page.locator(`.game-card[data-slug="${first}"] .game-icon img`).waitFor();
  assert.equal(await preview(page, first), null, "the first tile shows its icon again");

  // Mouse: pressing a tile's link focuses it, but the preview still stops once the pointer leaves.
  await page.locator(`.game-card[data-slug="${first}"] h2 a`).hover();
  await page.mouse.down();
  await page.locator(`.game-card[data-slug="${first}"] svg.tile-preview`).waitFor();
  await page.mouse.move(0, 0);
  await page.mouse.up();
  assert.equal(await focusedTile(), first, "the pressed link keeps focus");
  await page.locator(`.game-card[data-slug="${first}"] .game-icon img`).waitFor();
  assert.equal(await preview(page, first), null, "the icon is back once the pointer leaves");
  await page.close();
  assertNoErrors();
});

test("previews loop in view on a touch screen and never play with reduced motion", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, errors } = await openBrowser(t);

  // Touch: one tile plays at a time, and scrolling down the page gives each one its turn.
  const phone = await openHome(open, srv, "phone", { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
  const last = ready.at(-1).slug;
  assert.equal(await preview(phone, last), null, "a tile below the screen waits");
  const played = new Set();
  const end = await phone.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= end; y += 40) {
    await phone.evaluate((y) => scrollTo(0, y), y);
    await phone.waitForTimeout(150);
    const playing = await phone.locator(".game-card:has(svg.tile-preview)").evaluateAll((els) => els.map((e) => e.dataset.slug));
    assert.ok(playing.length <= 1, `${playing.join(" and ")} play at once`);
    for (const slug of playing) played.add(slug);
    if (playing[0] === last) assert.ok(started(await preview(phone, last)), "the last tile plays");
  }
  assert.deepEqual([...played].sort(), ready.map((g) => g.slug).sort(), "every tile gets its turn");
  await phone.evaluate(() => scrollTo(0, 0));
  await phone.locator(`.game-card[data-slug="${last}"] .game-icon img`).waitFor();
  assert.equal(await preview(phone, last), null, "out of view, it shows its icon again");
  await phone.close();

  // Reduced motion: hovering and focusing leave the icons alone.
  const still = await openHome(open, srv, "still", { reducedMotion: "reduce" });
  for (const { slug } of ready.slice(0, 3)) await still.locator(`.game-card[data-slug="${slug}"]`).hover();
  await still.locator(".game-card[data-slug] h2 a").first().focus();
  await still.waitForTimeout(300);
  assert.equal(await still.locator("svg.tile-preview").count(), 0, "no preview with reduced motion");
  assert.equal(await still.locator("#games").evaluate((e) => e.getAnimations({ subtree: true }).length), 0, "nothing animates");
  await still.close();

  // A missing preview: the icon stays.
  const missing = await openHome(open, srv, "missing");
  await missing.route("**/preview.svg", (route) => route.fulfill({ status: 404, body: "" }));
  const tile = missing.locator(`.game-card[data-slug="${ready[0].slug}"]`);
  await tile.hover();
  await missing.waitForTimeout(300);
  assert.equal(await tile.locator(".game-icon img").count(), 1, "the icon stays without a preview");
  assert.equal(await missing.locator("svg.tile-preview").count(), 0);
  await missing.close();
  assert.deepEqual(errors.filter((e) => !/404/.test(e)), []);
});
