// Headless-browser test for what a screen reader gets in every game, read
// from Playwright's aria snapshot (page.ariaSnapshot()) at 360 px in light
// and 1280 px in dark: in the lobby and in a robot game, every button, link,
// checkbox, radio, switch and slider has a name, and there is one main and
// one h1; a robot game has a status or log region; the settings panel is a
// named dialog, and so is the leave dialog of a friend game (the same dialog
// in every game, checked in Tic Tac Toe's). Rules on the snapshot, not stored
// snapshots. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { skipWithoutPlaywright, openBrowser, waitForState, joinByInvite } from "../helpers.js";

const skip = skipWithoutPlaywright();
const { games } = JSON.parse(readFileSync("public/games.json", "utf8"));

const SCREENS = [
  { width: 360, height: 740, colorScheme: "light" },
  { width: 1280, height: 800, colorScheme: "dark" },
];

// A snapshot line's role and name: `- button "Leave"`, or quoted whole, `- 'group "A ""b""": …'`.
const nodes = (tree) =>
  tree.split("\n").flatMap((line) => {
    const m = line.match(/^\s*- (['"]?)([a-z]+)(?: "(.*?)"(?= \[|:|\1$|$))?/);
    return m ? [{ role: m[2], name: m[3] ?? "", line: line.trim() }] : [];
  });
const CONTROLS = new Set(["button", "link", "checkbox", "radio", "switch", "slider"]);
const unnamed = (tree) => nodes(tree).filter((n) => CONTROLS.has(n.role) && !n.name.trim()).map((n) => n.line);
const count = (tree, test) => nodes(tree).filter(test).length;
const h1s = (tree) => count(tree, (n) => n.role === "heading" && / \[level=1\]/.test(n.line));

// The rules every screen keeps; where names the game and the screen in each failure.
function checkScreen(tree, where) {
  assert.deepEqual(unnamed(tree), [], `${where}: controls without a name`);
  assert.equal(count(tree, (n) => n.role === "main"), 1, `${where}: one main`);
}

// The settings panel, opened from the gear: a named dialog whose controls all have names, on both tabs.
async function checkSettings(page, where) {
  await page.click("#settings-open");
  await page.locator("#settings").waitFor();
  const tabs = await page.locator("#settings [role=tab]").count();
  for (let i = 0; i < Math.max(tabs, 1); i++) {
    if (tabs) await page.locator("#settings [role=tab]").nth(i).click();
    const tree = await page.locator("#settings").ariaSnapshot();
    assert.match(tree, /^- dialog "Settings"/, `${where}: the settings panel is a dialog named "Settings"`);
    assert.deepEqual(unnamed(tree), [], `${where}: settings tab ${i + 1} has controls without a name`);
  }
  await page.keyboard.press("Escape");
  await page.locator("#settings").waitFor({ state: "detached" });
}

for (const { width, height, colorScheme } of SCREENS) {
  test(`at ${width} px ${colorScheme}, every game's lobby and robot game read right`, { skip, timeout: 240_000 }, async (t) => {
    const { srv, open, assertNoErrors } = await openBrowser(t);
    for (const { slug } of games) {
      await t.test(slug, async (t) => {
        const page = await open(slug, { viewport: { width, height }, colorScheme, reducedMotion: "reduce", seed: slug });
        await page.goto(`${srv.base}/${slug}/`);
        await page.locator("#play-robot").waitFor();
        const lobby = await page.ariaSnapshot();
        checkScreen(lobby, `${slug} lobby at ${width} px`);
        assert.equal(h1s(lobby), 1, `${slug} lobby at ${width} px: one h1`);
        await checkSettings(page, `${slug} lobby at ${width} px`);

        await page.click("#play-robot");
        await waitForState(page, (ddp) => ["playing", "placing"].includes(ddp.match?.phase), undefined, { why: `${slug}: the robot game starts` });
        const play = await page.ariaSnapshot();
        const where = `${slug} robot game at ${width} px`;
        checkScreen(play, where);
        assert.ok(count(play, (n) => n.role === "status" || n.role === "log"), `${where}: a status or log region`);
        assert.equal(h1s(play), 1, `${where}: one h1`);
        await checkSettings(page, where);
        assertNoErrors();
        await page.context().close();
      });
    }
  });

  test(`at ${width} px ${colorScheme}, leaving a friend game asks in a named dialog`, { skip, timeout: 60_000 }, async (t) => {
    const { srv, open, assertNoErrors } = await openBrowser(t);
    const host = await open("host", { nickname: "Ada", viewport: { width, height }, colorScheme });
    await host.goto(`${srv.base}/tic-tac-toe/`);
    const guest = await open("guest", { nickname: "Bo", viewport: { width, height }, colorScheme });
    await joinByInvite(host, guest, srv);
    for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
    await host.click("#leave");
    await host.locator("dialog#confirm").waitFor();
    const tree = await host.locator("dialog#confirm").ariaSnapshot();
    assert.match(tree, /^- dialog "Leave the game\?"/, `the leave dialog is named:\n${tree}`);
    assert.deepEqual(unnamed(tree), [], "the leave dialog's controls have names");
    await host.click("#confirm-no");
    assert.equal(await host.evaluate(() => window.ddp.match.phase), "playing");
    assertNoErrors();
  });
}
