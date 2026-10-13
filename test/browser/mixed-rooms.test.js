// Headless-browser test for friend rooms that mix people and robots: two
// friends fill a Hearts table with two robots and finish a game, the robots
// on the host each seeing only their own seat; and a guest who leaves Ludo
// mid-game is replaced by a robot while the others play on. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, pick, state, autoplay, stopAutoplay, leaks, domLeaks } from "./hearts.shared.js";
import { autoplay as ludoAutoplay, stopAutoplay as ludoStop } from "./ludo.shared.js";

async function setup(t) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(nickname, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${nickname}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${nickname}: ${m.text()}`));
    return page;
  }
  return { srv, open, errors };
}

// The host's robots: what each one's own match knows that it shouldn't.
const robotLeaks = (page) =>
  page.evaluate(() =>
    window.ddp.robots.map(({ match: m }) => {
      const passed = new Set(m.sealed.filter((p) => p.from === m.me).map((p) => p.slot));
      return m.slots.flatMap((s, id) => (s.face !== null && !s.gone && !s.open && s.owner !== m.me && !passed.has(id) ? [id] : []));
    }),
  );

test("two friends and two robots play a whole game of Hearts; each robot sees only its own seat", { skip: !pw && "Playwright not installed", timeout: 420_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  const host = await open("Ada", { colorScheme: "dark" });
  await host.goto(`${srv.base}/hearts/`);
  await pick(host, "target", 0);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  assert.equal(await host.locator("#roster li.empty").count(), 3, "three empty seats");
  await host.click("#add-robot");
  await host.locator("#roster li.robot", { hasText: "Robot 1" }).waitFor();
  assert.match(await host.locator("#start-game").innerText(), /needs 3 players/);
  await host.click("#add-robot");
  await host.locator("#roster li.robot", { hasText: "Robot 2" }).waitFor();
  assert.equal(await host.locator("#start-game").innerText(), "Start game (needs a friend)");
  assert.ok(await host.locator("#start-game").isDisabled());
  // Remove and add again, by keyboard: focus stays on the seats.
  await host.locator("#roster li.robot button").last().focus();
  await host.keyboard.press("Enter");
  await host.locator("#roster li.robot").nth(1).waitFor({ state: "detached" });
  assert.equal(await host.evaluate(() => document.activeElement.id), "add-robot");
  await host.keyboard.press("Enter");
  await host.locator("#roster li.robot", { hasText: "Robot 2" }).waitFor();

  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  const bo = await open("Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "light" });
  await bo.goto(invite);
  await bo.click("#join-room");
  await host.locator("#roster li.ready:not(.robot)", { hasText: "Bo" }).waitFor();
  await bo.locator("#lobby-status", { hasText: "2 players and 2 robots in" }).waitFor();
  assert.equal(await host.locator("#start-game").innerText(), "Start game (4 players)");
  assert.equal(await host.locator("#roster li.empty").count(), 0);
  await host.screenshot({ path: `${ARTIFACTS}/mr-1-waiting-dark.png` });
  await host.emulateMedia({ colorScheme: "light" });
  await host.setViewportSize({ width: 360, height: 740 });
  assert.ok(await noHorizontalScroll(host), "the waiting screen with robots fits 360 px");
  await host.screenshot({ path: `${ARTIFACTS}/mr-2-waiting-mobile-light.png`, fullPage: true });
  await host.emulateMedia({ colorScheme: "dark" });
  await host.setViewportSize({ width: 1280, height: 900 });

  await host.click("#start-game");
  const pages = [host, bo];
  for (const p of pages) await wait(p, () => window.ddp.match?.phase === "playing", undefined, 60_000);
  for (const p of pages) {
    assert.match(await p.locator(".pb-players").innerText(), /Robot 1[\s\S]*Robot 2/);
    assert.deepEqual(await p.evaluate(() => window.ddp.session.players.map((x) => x.robot)), [false, false, true, true]);
    assert.equal(await p.evaluate(() => window.ddp.session.mode), "friend");
  }
  // Each robot is a seat of its own on the host, with its own match and keys.
  assert.deepEqual(await host.evaluate(() => window.ddp.robots.map((r) => [r.match.me, r.match !== window.ddp.match, r.match.key !== window.ddp.match.key])), [[2, true, true], [3, true, true]]);
  assert.equal(await bo.evaluate(() => window.ddp.robots.length), 0, "robots run only on the host");

  await Promise.all(pages.map(autoplay));
  await wait(host, () => window.ddp.match.state.tricks >= 3 || window.ddp.match.phase !== "playing", undefined, 120_000);
  assert.deepEqual(await robotLeaks(host), [[], []], "mid-hand, each robot knows only its own cards and the open ones");
  assert.deepEqual(await leaks(host), [], "and the host doesn't know theirs");
  await host.screenshot({ path: `${ARTIFACTS}/mr-3-hearts-dark.png` });
  assert.ok(await noHorizontalScroll(bo));
  await bo.screenshot({ path: `${ARTIFACTS}/mr-4-hearts-mobile-light.png`, fullPage: true });
  for (const p of pages) await wait(p, () => window.ddp.match.phase === "over", undefined, 240_000);
  await Promise.all(pages.map(stopAutoplay));
  for (const p of pages) {
    assert.deepEqual(await leaks(p), []);
    assert.deepEqual(await domLeaks(p), []);
  }
  assert.deepEqual(await robotLeaks(host), [[], []]);
  const states = await Promise.all(pages.map(state));
  assert.deepEqual(states[1], states[0]);
  assert.deepEqual(await host.evaluate(() => window.ddp.robots.map((r) => r.match.state)), [states[0], states[0]]);
  for (const p of pages) {
    await wait(p, () => window.ddp.match.verdict, undefined, 60_000);
    assert.deepEqual(await p.evaluate(() => window.ddp.match.verdict), { ok: true });
  }
  // A mixed room is a friend game: it never counts toward the record against the robots.
  assert.equal(await host.evaluate(() => localStorage.getItem("ddp-robot-record")), null);
  assert.deepEqual(errors, []);
});

test("a guest who leaves Ludo mid-game is replaced by a robot, and the others finish the game", { skip: !pw && "Playwright not installed", timeout: 360_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  const host = await open("Ada");
  await host.goto(`${srv.base}/ludo/`);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  const friends = [];
  for (const name of ["Bo", "Cy"]) {
    const page = await open(name);
    await page.goto(invite);
    await page.click("#join-room");
    await host.locator("#roster li.ready", { hasText: name }).waitFor();
    friends.push(page);
  }
  await host.click("#start-game");
  const pages = [host, ...friends];
  for (const p of pages) await wait(p, () => window.ddp.match?.phase === "playing");
  await Promise.all(pages.map(ludoAutoplay));
  await wait(host, () => window.ddp.match.state.ply >= 30, undefined, 60_000);
  const cy = friends[1];
  await ludoStop(cy);
  await cy.click("#leave");
  assert.equal(await cy.locator("dialog#confirm p").innerText(), "A robot takes your seat and the game goes on.");
  await cy.click("#confirm-yes");
  await cy.locator("#play-friend").waitFor();
  for (const p of [host, friends[0]]) {
    await p.locator(".toast", { hasText: "Cy left. A robot plays their seat." }).waitFor({ state: "attached", timeout: 20_000 });
    await p.locator(".pb-name", { hasText: "Cy (robot)" }).waitFor();
  }
  assert.equal(await host.evaluate(() => window.ddp.robots.length), 1);
  for (const p of [host, friends[0]]) await wait(p, () => window.ddp.match.phase === "over", undefined, 240_000);
  await Promise.all([host, friends[0]].map(ludoStop));
  const states = await Promise.all([host, friends[0]].map((p) => p.evaluate(() => window.ddp.match.state)));
  assert.deepEqual(states[1], states[0]);
  assert.deepEqual(await host.evaluate(() => window.ddp.robots[0].match.state), states[0], "the robot finished the same game");
  assert.ok(states[0].ply > 30);
  for (const p of [host, friends[0]]) assert.equal(await p.locator("#ended").count(), 0, "the game went on");
  assert.deepEqual(errors, []);
});
