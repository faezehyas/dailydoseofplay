// Headless-browser test for the record against the robot: two finished robot
// games of Tic Tac Toe show up under the Play buttons, a stopped one and a
// friend game don't, and Reset asks first. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "../helpers.js";

const ARTIFACTS = path.resolve("test-artifacts");

async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright"];
  try {
    candidates.push(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"));
  } catch {}
  for (const c of candidates.filter(Boolean)) {
    try {
      return require(c);
    } catch {}
  }
  return null;
}

const pw = await loadPlaywright();
const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20_000 });
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("ddp-robot-record")));
const OUTCOME = { "You won": "win", Draw: "draw", "You lost": "loss" };
const text = ({ win, draw, loss }) => `You vs robot: ${win} ${win === 1 ? "win" : "wins"} · ${draw} ${draw === 1 ? "draw" : "draws"} · ${loss} ${loss === 1 ? "loss" : "losses"}`;

async function pick(page, name, value) {
  if (!(await page.locator("#ttt-settings[open]").count())) await page.click("#ttt-settings > summary");
  await page.click(`#ttt-settings label:has(input[name="ttt-${name}"][value="${value}"])`);
}

// Take a winning square if there is one, else the first free one, until the game ends.
async function playOut(page) {
  for (;;) {
    await wait(page, () => window.ddp.match.canMove() || window.ddp.match.phase !== "playing");
    const cell = await page.evaluate(() => {
      const { board } = window.ddp.match.state;
      const me = window.ddp.match.me;
      const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
      const free = board.flatMap((v, i) => (v === -1 ? [i] : []));
      if (window.ddp.match.phase !== "playing") return -1;
      return free.find((i) => lines.some((l) => l.includes(i) && l.every((j) => j === i || board[j] === me))) ?? free[0];
    });
    if (cell < 0) break;
    const n = await page.evaluate(() => window.ddp.match.state.moves.length);
    await page.tap(`.ttt-cell[data-i="${cell}"]`);
    await wait(page, (k) => window.ddp.match.state.moves.length > k || window.ddp.match.phase !== "playing", n);
  }
  await page.locator("#result-panel:not([hidden])").waitFor();
  return OUTCOME[await page.locator("#result").innerText()];
}

test("robot games of Tic Tac Toe add to the record under the Play buttons; a stopped or friend game doesn't, and Reset asks first", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, nickname, opts) {
    const ctx = await browser.newContext(opts);
    await ctx.addInitScript((n) => {
      localStorage.setItem("ddp-name", n);
      globalThis.ddpRobotPace = 0.1;
    }, nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }

  const page = await open("phone", "Ada", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "light" });
  await page.goto(`${srv.base}/tic-tac-toe/`);
  assert.equal(await page.locator("#robot-record").count(), 0, "no record before the first robot game");
  await pick(page, "size", 3);
  await pick(page, "gameSeconds", 0);
  await pick(page, "first", "host");

  // Two finished robot games: one, then a rematch.
  const record = { win: 0, draw: 0, loss: 0 };
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  record[await playOut(page)]++;
  assert.deepEqual(await stored(page), { "tic-tac-toe": { 2: record } }, "recorded when the result shows");
  await page.click("#rematch");
  await wait(page, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  record[await playOut(page)]++;
  assert.deepEqual(await stored(page), { "tic-tac-toe": { 2: record } }, "the rematch is recorded once too");
  await page.click("#leave");
  await page.locator("#robot-record").waitFor();
  assert.equal(await page.locator("#robot-record > span").innerText(), text(record));
  assert.ok(await noHorizontalScroll(page), "no horizontal scroll at 360 px");

  // A robot game left before it ends isn't recorded.
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  await page.click("#leave");
  await page.locator("#robot-record").waitFor();
  assert.deepEqual(await stored(page), { "tic-tac-toe": { 2: record } }, "a stopped game isn't recorded");

  // A friend game on the same device doesn't change it, and the friend gets no record.
  await page.click("#play-friend");
  const invite = await page.locator("#invite-link").inputValue();
  const friend = await open("friend", "Bo", { viewport: { width: 1200, height: 900 } });
  await friend.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await friend.click("#join-room");
  await wait(page, () => window.ddp.match?.phase === "playing");
  await wait(friend, () => window.ddp.match?.phase === "playing");
  for (const [who, cell] of [[page, 0], [friend, 3], [page, 1], [friend, 4], [page, 2]]) {
    await wait(who, () => window.ddp.match.canMove());
    await who.click(`.ttt-cell[data-i="${cell}"]`);
  }
  await page.locator("#result").filter({ hasText: "You won" }).waitFor();
  await friend.locator("#result").filter({ hasText: "You lost" }).waitFor();
  assert.deepEqual(await stored(page), { "tic-tac-toe": { 2: record } }, "a friend game isn't recorded");
  assert.equal(await stored(friend), null);
  await friend.close();
  await page.locator("#ended").waitFor();
  await page.goto(`${srv.base}/tic-tac-toe/`);
  assert.equal(await page.locator("#robot-record > span").innerText(), text(record));
  await page.screenshot({ path: `${ARTIFACTS}/robot-record-1-lobby-phone-light.png`, fullPage: true });

  // Reset asks in the page first; Keep keeps it, Reset clears it.
  await page.click("#robot-record-reset");
  await page.locator("#confirm[open]").waitFor();
  assert.equal(await page.locator("#confirm-title").innerText(), "Reset your record?");
  await page.screenshot({ path: `${ARTIFACTS}/robot-record-2-reset-phone-light.png` });
  await page.click("#confirm-no");
  assert.equal(await page.locator("#robot-record").count(), 1, "Keep keeps the record");
  await page.click("#robot-record-reset");
  await page.click("#confirm-yes");
  await page.locator("#robot-record").waitFor({ state: "detached" });
  assert.equal(await stored(page), null);
  assert.equal(await page.evaluate(() => document.activeElement.id), "play-robot", "focus moves to Play vs robot");

  // The record on a wide screen in dark.
  const wide = await open("wide", "Cy", { viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  await wide.addInitScript(() => localStorage.setItem("ddp-robot-record", JSON.stringify({ "tic-tac-toe": { 2: { win: 3, draw: 1, loss: 2 } } })));
  await wide.goto(`${srv.base}/tic-tac-toe/`);
  assert.equal(await wide.locator("#robot-record > span").innerText(), "You vs robot: 3 wins · 1 draw · 2 losses");
  await wide.screenshot({ path: `${ARTIFACTS}/robot-record-3-lobby-wide-dark.png`, fullPage: true });
  assert.deepEqual(errors, []);
});
