// Headless-browser test for "Learn while you wait" (engine/lobby.js): the
// host opens Ludo's tutorial in the waiting room, a friend joining closes it
// with a note and the host can start, closing the friend's tutorial too; and
// leaving the tutorial, by its button or Back, keeps the room as it was.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";
import { pw, wait, noHorizontalScroll } from "./ludo.shared.js";

async function setup(t) {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(nickname, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, reducedMotion: "reduce", ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${nickname}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${nickname}: ${m.text()}`));
    return page;
  }
  return { srv, open, errors };
}

const focused = (page) => page.evaluate(() => document.activeElement.id || document.activeElement.textContent);

test("a friend joining closes the host's tutorial with a note; starting the game closes the friend's", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  const host = await open("Ada");
  await host.goto(`${srv.base}/ludo/`);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  await host.locator("#learn-wait").tap();
  await host.locator("#tut-lessons-list").waitFor();
  assert.equal(await focused(host), "Learn Ludo", "focus moves to the tutorial");
  assert.ok(await host.locator("#lobby").isHidden());
  assert.ok(await host.getByRole("button", { name: "Back to the room" }).isVisible());
  // A lesson left half-way isn't marked finished.
  await host.locator(".tut-lesson").first().tap();
  await host.locator(".tut-step").waitFor();
  assert.ok(await noHorizontalScroll(host));

  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  const bo = await open("Bo", { viewport: { width: 1280, height: 900 }, hasTouch: false, colorScheme: "dark" });
  await bo.goto(invite);
  await bo.click("#join-room");
  await host.locator("#toast", { hasText: "Bo joined" }).waitFor({ state: "attached" });
  await host.locator("#lobby").waitFor();
  assert.equal(await host.locator(".tut-stage").count(), 0, "the tutorial closed");
  assert.equal(await focused(host), "learn-wait", "focus back on the button");
  assert.equal(await host.evaluate(() => localStorage.getItem("ddp-lessons")), null, "no lesson marked finished");
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  assert.match(await host.locator("#start-game").innerText(), /2 players/);

  // The friend learns while the host gets ready; Start closes it for them too.
  await bo.locator("#learn-wait").focus();
  await bo.keyboard.press("Enter");
  await bo.locator("#tut-lessons-list").waitFor();
  await host.click("#start-game");
  for (const p of [host, bo]) await wait(p, () => window.ddp.match?.phase === "playing");
  assert.equal(await bo.locator("#tut-lessons-list").count(), 0, "the friend's tutorial closed");
  assert.equal(await bo.evaluate(() => window.ddp.tutorial), null);
  assert.deepEqual(await bo.evaluate(() => history.state), { game: "ludo" }, "the game took the tutorial's history entry");
  assert.deepEqual(errors, []);
});

test("leaving the tutorial, by its button or Back, keeps the room code and seats", { skip: !pw && "Playwright not installed", timeout: 90_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  const host = await open("Ada", { viewport: { width: 1280, height: 900 }, hasTouch: false, colorScheme: "dark" });
  await host.goto(`${srv.base}/ludo/`);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  await host.click("#add-robot");
  await host.locator("#roster li.robot").waitFor();
  const room = () => host.evaluate(() => ({ code: window.ddp.room.code, seats: document.querySelector("#roster").innerText, url: location.href }));
  const before = await room();

  await host.click("#learn-wait");
  await host.locator("#tut-lessons-list").waitFor();
  await host.getByRole("button", { name: "Back to the room" }).click();
  await host.locator("#room-code").waitFor();
  assert.deepEqual(await room(), before);
  assert.equal(await focused(host), "learn-wait");

  await host.click("#learn-wait");
  await host.locator("#tut-lessons-list").waitFor();
  await host.goBack();
  await host.locator("#room-code").waitFor();
  assert.equal(await host.locator("#tut-lessons-list").count(), 0, "Back closes the tutorial");
  assert.deepEqual(await room(), before);
  assert.equal(await focused(host), "learn-wait");
  assert.equal(await host.evaluate(() => window.ddp.room?.code), before.code, "the room stays open");
  assert.deepEqual(errors, []);
});
