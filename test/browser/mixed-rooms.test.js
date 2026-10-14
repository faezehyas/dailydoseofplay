// Headless-browser test for friend rooms that mix people and robots: the
// host adds and removes robots, a friend takes a robot's seat, and two friends
// and two robots finish a Hearts game, the robots on the host each seeing only
// their own seat; robots alone start a robot game; and a guest who leaves
// Ludo mid-game is replaced by a robot while the others play on. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, joinByInvite, noHorizontalScroll, pick } from "../helpers.js";
import { state, autoplay, stopAutoplay, leaks, domLeaks } from "./hearts.shared.js";
import { autoplay as ludoAutoplay, stopAutoplay as ludoStop } from "./ludo.shared.js";

const skip = skipWithoutPlaywright();

async function setup(t) {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  return { srv, assertNoErrors, open: (nickname, opts = {}) => open(nickname, { nickname, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", ...opts }) };
}

// The host's robots: what each one's own match knows that it shouldn't.
const robotLeaks = (page) =>
  page.evaluate(() =>
    window.ddp.robots.map(({ match: m }) => {
      const passed = new Set(m.sealed.filter((p) => p.from === m.me).map((p) => p.slot));
      return m.slots.flatMap((s, id) => (s.face !== null && !s.gone && !s.open && s.owner !== m.me && !passed.has(id) ? [id] : []));
    }),
  );

test("two friends and two robots play a whole game of Hearts; each robot sees only its own seat", { skip, timeout: 420_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada", { colorScheme: "dark" });
  await host.goto(`${srv.base}/hearts/`);
  await pick(host, "target", 0);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  assert.equal(await host.locator("#roster li.empty").count(), 3, "three empty seats");
  assert.doesNotMatch(await host.locator("#room-settings").innerText(), /robot/i, "no robots, no robot level");
  await host.click("#add-robot");
  await host.locator("#roster li.robot", { hasText: "Robot 1" }).waitFor();
  assert.match(await host.locator("#start-game").innerText(), /needs 3 players/);
  assert.match(await host.locator("#room-settings").innerText(), /(Easy|Medium|Hard) robot\b/, "the robots' level shows once one sits");
  await host.click("#add-robot");
  await host.locator("#roster li.robot", { hasText: "Robot 2" }).waitFor();
  assert.match(await host.locator("#room-settings").innerText(), /(Easy|Medium|Hard) robots/);
  // No friend yet: robots alone make a robot game.
  assert.equal(await host.locator("#start-game").innerText(), "Play with robots only");
  assert.ok(await host.locator("#start-game").isEnabled());
  // Remove is for its own row: Robot 2 keeps its name. Focus stays on the seats.
  await host.getByRole("button", { name: "Remove Robot 1" }).focus();
  await host.keyboard.press("Enter");
  await host.locator("#roster li.robot", { hasText: "Robot 1" }).waitFor({ state: "detached" });
  assert.deepEqual(await host.locator("#roster li.robot > span").allInnerTexts(), ["Robot 2"]);
  assert.equal(await host.evaluate(() => document.activeElement.id), "add-robot");
  await host.keyboard.press("Enter");
  await host.click("#add-robot");
  assert.deepEqual(await host.locator("#roster li.robot > span").allInnerTexts(), ["Robot 1", "Robot 2", "Robot 3"]);
  await host.locator("#lobby-status", { hasText: "one who joins takes a robot's seat" }).waitFor();

  // A friend joins the full room and takes the last robot's seat.
  const bo = await open("Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "light" });
  await joinByInvite(host, bo, srv);
  await host.locator("#toast", { hasText: "Bo takes Robot 3's seat." }).waitFor({ state: "attached" });
  await host.locator("#roster li.ready:not(.robot)", { hasText: "Bo" }).waitFor();
  await bo.locator("#lobby-status", { hasText: "2 players and 2 robots in" }).waitFor();
  assert.deepEqual(await host.locator("#roster li.robot > span").allInnerTexts(), ["Robot 1", "Robot 2"]);
  assert.equal(await host.locator("#start-game").innerText(), "Start game (4 players)");
  assert.equal(await host.locator("#lobby-status").innerText(), "Every seat is taken. Start when you're ready.");
  assert.equal(await host.locator("#roster li.empty").count(), 0);
  await host.screenshot({ path: `${ARTIFACTS}/mr-1-waiting-dark.png` });
  await host.emulateMedia({ colorScheme: "light" });
  for (const width of [534, 360]) {
    await host.setViewportSize({ width, height: 740 });
    assert.ok(await noHorizontalScroll(host), `the waiting screen with robots fits ${width} px`);
    assert.ok(await host.evaluate(() => [...document.querySelectorAll(".site-footer p")].every((p) => p.getBoundingClientRect().right <= innerWidth)), `the footer wraps at ${width} px`);
  }
  await host.screenshot({ path: `${ARTIFACTS}/mr-2-waiting-mobile-light.png`, fullPage: true });
  await host.emulateMedia({ colorScheme: "dark" });
  await host.setViewportSize({ width: 1280, height: 900 });

  await host.click("#start-game");
  const pages = [host, bo];
  for (const p of pages) await waitForState(p, (ddp) => ddp.match?.phase === "playing", undefined, { timeout: 60_000 });
  for (const p of pages) {
    assert.match(await p.locator(".pb-players").innerText(), /Robot 1[\s\S]*Robot 2/);
    assert.deepEqual(await p.evaluate(() => window.ddp.session.players.map((x) => x.robot)), [false, false, true, true]);
    assert.equal(await p.evaluate(() => window.ddp.session.mode), "friend");
    assert.match(await p.locator("#hr-config").innerText(), /(Easy|Medium|Hard) robots/, "everyone sees the robots' level");
  }
  // Each robot is a seat of its own on the host, with its own match and keys.
  assert.deepEqual(await host.evaluate(() => window.ddp.robots.map((r) => [r.match.me, r.match !== window.ddp.match, r.match.key !== window.ddp.match.key])), [[2, true, true], [3, true, true]]);
  assert.equal(await bo.evaluate(() => window.ddp.robots.length), 0, "robots run only on the host");

  await Promise.all(pages.map(autoplay));
  await waitForState(host, (ddp) => ddp.match.state.tricks >= 3 || ddp.match.phase !== "playing", undefined, { timeout: 120_000 });
  assert.deepEqual(await robotLeaks(host), [[], []], "mid-hand, each robot knows only its own cards and the open ones");
  assert.deepEqual(await leaks(host), [], "and the host doesn't know theirs");
  await host.screenshot({ path: `${ARTIFACTS}/mr-3-hearts-dark.png` });
  assert.ok(await noHorizontalScroll(bo));
  await bo.screenshot({ path: `${ARTIFACTS}/mr-4-hearts-mobile-light.png`, fullPage: true });
  for (const p of pages) await waitForState(p, (ddp) => ddp.match.phase === "over", undefined, { timeout: 240_000 });
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
    await waitForState(p, (ddp) => ddp.match.verdict, undefined, { timeout: 60_000 });
    assert.deepEqual(await p.evaluate(() => window.ddp.match.verdict), { ok: true });
  }
  // A mixed room is a friend game: it never counts toward the record against the robots.
  assert.equal(await host.evaluate(() => localStorage.getItem("ddp-robot-record")), null);
  assertNoErrors();
});

test("with robots and no friend in yet, Start plays them as a robot game", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada");
  await host.goto(`${srv.base}/ludo/`);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  assert.equal(await host.locator("#start-game").innerText(), "Start game (needs 2 players)");
  await host.click("#add-robot");
  await host.click("#start-game");
  await waitForState(host, (ddp) => ddp.match?.phase === "playing");
  assert.equal(await host.evaluate(() => window.ddp.session.mode), "robot");
  assert.equal(await host.evaluate(() => window.ddp.session.players.length), 2);
  assertNoErrors();
});

test("a guest who leaves Ludo mid-game is replaced by a robot, and the others finish the game", { skip, timeout: 360_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada");
  await host.goto(`${srv.base}/ludo/`);
  const friends = [];
  for (const name of ["Bo", "Cy"]) {
    const page = await open(name);
    await joinByInvite(host, page, srv);
    await host.locator("#roster li.ready", { hasText: name }).waitFor();
    friends.push(page);
  }
  await host.click("#start-game");
  const pages = [host, ...friends];
  for (const p of pages) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
  await Promise.all(pages.map(ludoAutoplay));
  await waitForState(host, (ddp) => ddp.match.state.ply >= 30, undefined, { timeout: 60_000 });
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
  for (const p of [host, friends[0]]) await waitForState(p, (ddp) => ddp.match.phase === "over", undefined, { timeout: 240_000 });
  await Promise.all([host, friends[0]].map(ludoStop));
  const states = await Promise.all([host, friends[0]].map((p) => p.evaluate(() => window.ddp.match.state)));
  assert.deepEqual(states[1], states[0]);
  assert.deepEqual(await host.evaluate(() => window.ddp.robots[0].match.state), states[0], "the robot finished the same game");
  assert.ok(states[0].ply > 30);
  for (const p of [host, friends[0]]) assert.equal(await p.locator("#ended").count(), 0, "the game went on");
  assertNoErrors();
});
