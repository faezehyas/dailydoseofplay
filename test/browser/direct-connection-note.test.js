// Headless-browser test: each game's lobby says, under "Play with a friend",
// that games connect browsers directly. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { skipWithoutPlaywright, openBrowser, noHorizontalScroll } from "../helpers.js";

const GAMES = JSON.parse(readFileSync(new URL("../../public/games.json", import.meta.url), "utf8")).games.filter((g) => g.status === "ready");
const NOTE = "Games connect your browser directly to your friends'. Play with people you know.";
const skip = skipWithoutPlaywright();

test("every lobby says games connect directly", { skip, timeout: 90_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("page", { viewport: { width: 360, height: 740 } });
  for (const game of GAMES) {
    await page.goto(`${srv.base}/${game.slug}/`);
    const note = page.locator(".lobby-card #direct-note");
    await note.waitFor();
    assert.equal(await note.textContent(), NOTE, game.name);
    const friend = await page.locator("#play-friend").boundingBox();
    const box = await note.boundingBox();
    assert.ok(box.y >= friend.y + friend.height, `${game.name}: the note is under Play with a friend`);
    assert.ok(await noHorizontalScroll(page), `${game.name}: no sideways scroll`);
  }
  assertNoErrors();
});
