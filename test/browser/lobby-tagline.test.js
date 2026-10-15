// Headless-browser test: each game's lobby shows its description from
// games.json under the title, and the lobby doesn't wait for the file.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { skipWithoutPlaywright, openBrowser } from "../helpers.js";

const GAMES = JSON.parse(readFileSync(new URL("../../public/games.json", import.meta.url), "utf8")).games.filter((g) => g.status === "ready");

const skip = skipWithoutPlaywright();

async function setup(t) {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("page", { viewport: { width: 360, height: 740 } });
  return { srv, page, assertNoErrors };
}

test("the lobby tagline is the game's description in games.json", { skip, timeout: 90_000 }, async (t) => {
  const { srv, page, assertNoErrors } = await setup(t);
  for (const game of GAMES) {
    await page.goto(`${srv.base}/${game.slug}/`);
    const tagline = page.locator(".lobby-card .tagline");
    await tagline.waitFor();
    assert.equal(await tagline.textContent(), game.description, game.name);
  }
  assertNoErrors();
});

test("the lobby doesn't wait for games.json", { skip, timeout: 60_000 }, async (t) => {
  const { srv, page, assertNoErrors } = await setup(t);
  // The page carries the tagline, so a games.json that never arrives changes nothing.
  await page.route("**/games.json", () => {});
  await page.goto(`${srv.base}/tic-tac-toe/`);
  await page.locator("#play-friend").waitFor();
  assert.equal(await page.locator(".lobby-card .tagline").textContent(), GAMES.find((g) => g.slug === "tic-tac-toe").description);
  assertNoErrors();
});
