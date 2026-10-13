// Headless-browser test for quick reactions (engine/reactions.js): in a
// friend game of Tic Tac Toe, a reaction picked by keyboard in one browser
// shows as a bubble by its sender's name in the other, then goes away, and
// "Mute reactions" in the settings panel hides the next one; a robot says "Good game!" at the end;
// and Ludo's four players keep the tray and bubbles on screen at 360 px.
// Screenshots go to test-artifacts/. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll } from "./ludo.shared.js";

const PHONE = { viewport: { width: 360, height: 760 }, hasTouch: true, colorScheme: "light" };
const DESKTOP = { viewport: { width: 1280, height: 900 }, colorScheme: "dark" };
// The bubble by the nth pill (0 is you), or "" when there is none.
const bubble = (page, n) => page.locator(".pb-who").nth(n).evaluate((p) => p.querySelector(".rx-bubble")?.textContent ?? "");

async function setup(t) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  const errors = [];
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  async function open(who, opts, nickname) {
    const ctx = await browser.newContext(opts);
    await ctx.addInitScript((n) => {
      localStorage.setItem("ddp-name", n);
      globalThis.ddpRobotPace = 0.1;
    }, nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
    return page;
  }
  return { srv, open, errors };
}

test("a reaction shows in the other browser, goes away, and mute hides it", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  const host = await open("host", DESKTOP, "Ada");
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await host.click("#play-friend");
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  const guest = await open("guest", PHONE, "Bo");
  await guest.goto(invite);
  await guest.click("#join-room");
  for (const page of [host, guest]) await wait(page, () => window.ddp.match?.phase === "playing");

  // When a bubble comes and goes in Bo's browser.
  await guest.evaluate(() => {
    window.bubbleTimes = [];
    new MutationObserver((records) => {
      for (const r of records) for (const n of [...r.addedNodes, ...r.removedNodes]) if (n.classList?.contains("rx-bubble")) window.bubbleTimes.push(performance.now());
    }).observe(document.body, { subtree: true, childList: true });
  });

  // Ada opens the tray by keyboard, moves to "Nice move!" with the arrows and picks it.
  await host.focus("#react");
  await host.keyboard.press("Enter");
  assert.equal(await host.locator("#react").getAttribute("aria-expanded"), "true");
  assert.equal(await host.evaluate(() => document.activeElement.textContent), "👋");
  await host.keyboard.press("ArrowLeft");
  assert.equal(await host.evaluate(() => document.activeElement.textContent), "Rematch?", "the arrows wrap around");
  for (let k = 0; k < 10; k++) await host.keyboard.press("ArrowRight");
  assert.equal(await host.evaluate(() => document.activeElement.textContent), "Nice move!");
  await host.keyboard.press("Enter");
  assert.ok(await host.locator("#reactions").isHidden(), "picking closes the tray");
  assert.equal(await host.evaluate(() => document.activeElement.id), "react", "focus returns to React");
  assert.equal(await bubble(host, 0), "Nice move!", "the sender sees their own bubble");

  // Bo sees it by Ada's name, hears of it politely, and it goes away after about 3 s.
  await wait(guest, () => document.querySelectorAll(".pb-who")[1].querySelector(".rx-bubble"));
  assert.equal(await bubble(guest, 1), "Nice move!");
  assert.equal(await guest.locator(".player-bar [aria-live=polite]").innerText(), "Ada: Nice move!");

  // Screenshots with a bubble showing and the tray open.
  await guest.tap("#react");
  assert.ok(await noHorizontalScroll(guest), "no sideways scroll with the tray open at 360 px");
  const tray = await guest.locator("#reactions").boundingBox();
  assert.ok(tray.x >= 0 && tray.x + tray.width <= 360, "the tray fits the phone");
  await guest.screenshot({ path: `${ARTIFACTS}/reactions-2p-360-light.png`, animations: "disabled" });
  await host.click("#react");
  await host.screenshot({ path: `${ARTIFACTS}/reactions-2p-1280-dark.png`, animations: "disabled" });
  await host.keyboard.press("Escape");
  assert.ok(await host.locator("#reactions").isHidden(), "Esc closes the tray");

  await wait(guest, () => !document.querySelector(".rx-bubble"), undefined, 10_000);
  const [added, removed] = await guest.evaluate(() => window.bubbleTimes);
  assert.ok(Math.abs(removed - added - 3000) < 300, `the bubble showed for about 3 s (${Math.round(removed - added)} ms)`);

  await guest.tap("main", { position: { x: 10, y: 600 } });
  assert.ok(await guest.locator("#reactions").isHidden(), "a tap outside closes the tray");

  // Bo mutes reactions in the settings panel; it is saved on the device. Ada's next one shows only for her.
  await guest.tap("#settings-open");
  await guest.locator("#settings-reactions").check();
  assert.equal(await guest.evaluate(() => JSON.parse(localStorage.getItem("ddp-settings")).muteReactions), true);
  await guest.keyboard.press("Escape");
  await guest.locator("#settings").waitFor({ state: "detached" });
  await host.click("#react");
  await host.click("#reactions .rx-emoji >> nth=0");
  assert.equal(await bubble(host, 0), "👋");
  await guest.waitForTimeout(500);
  assert.equal(await bubble(guest, 1), "", "muted: no bubble");
  assert.equal(await guest.locator(".player-bar [aria-live=polite]").innerText(), "Ada: Nice move!", "muted: nothing read out");
  assert.deepEqual(errors, []);
});

test("the robot says a line at the end of a game", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  const page = await open("player", PHONE, "Ada");
  await page.goto(`${srv.base}/tic-tac-toe/?robot=1`);
  await wait(page, () => window.ddp.match?.phase === "playing");
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    await wait(page, () => window.ddp.match.canMove() || window.ddp.match.phase !== "playing");
    const cell = await page.evaluate(() => (window.ddp.match.phase === "playing" ? window.ddp.match.state.board.indexOf(-1) : -1));
    if (cell < 0) break;
    await page.tap(`.ttt-cell[data-i="${cell}"]`);
    await wait(page, (i) => window.ddp.match.state.board[i] !== -1 || window.ddp.match.phase !== "playing", cell);
  }
  await wait(page, () => document.querySelectorAll(".pb-who")[1].querySelector(".rx-bubble")?.textContent === "Good game!", undefined, 8_000);
  assert.equal(await page.locator(".player-bar [aria-live=polite]").innerText(), "Robot: Good game!");
  assert.deepEqual(errors, []);
});

test("four players: the tray and bubbles fit, at 360 px and 1280 px", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  for (const [opts, name] of [
    [PHONE, "reactions-4p-360-light"],
    [DESKTOP, "reactions-4p-1280-dark"],
  ]) {
    const page = await open(name, opts, "Ada");
    await page.goto(`${srv.base}/ludo/`);
    await page.click("#play-robot");
    await wait(page, () => window.ddp.match?.phase === "playing");
    assert.equal(await page.locator(".pb-who").count(), 4);
    await page.click("#react");
    await page.click("#reactions .rx-emoji >> nth=1");
    assert.equal(await bubble(page, 0), "😄");
    await page.click("#react");
    assert.ok(await noHorizontalScroll(page), `${name}: no sideways scroll`);
    const board = await page.locator("#ld-board").boundingBox();
    const pill = await page.locator(".pb-who .rx-bubble").first().boundingBox();
    assert.ok(pill.y + pill.height <= board.y, `${name}: the bubble stays above the board`);
    await page.screenshot({ path: `${ARTIFACTS}/${name}.png`, animations: "disabled" });
  }
  assert.deepEqual(errors, []);
});
