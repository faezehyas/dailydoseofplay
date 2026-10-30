// Headless-browser test for Ludo: two friends play on the host's house rules
// through the invite link and the waiting room's Start button, over a real
// WebRTC DataChannel, then a rematch; and a room where two friends use the
// invite key and a third is let in by the host. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, joinByInvite, noHorizontalScroll, pick } from "../helpers.js";
import { bg, state, yardCorner, resultInView, autoplay, stopAutoplay } from "./ludo.shared.js";

const skip = skipWithoutPlaywright();
const laptop = { width: 1366, height: 900 };

test("two friends play Ludo on the host's house rules through the invite link, then a rematch", { skip, timeout: 300_000 }, async (t) => {
  const { srv, open: openPage, assertNoErrors } = await openBrowser(t);
  // Reduced motion applies every move at once, so whole games fit the test.
  const open = (name, nickname, opts = {}) => openPage(name, { nickname, viewport: laptop, reducedMotion: "reduce", ...opts });

  // Host (laptop, light) turns on blocks and the capture bonus, and starts.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/ludo/`);
  for (const [name, value] of [["threeSixes", "true"], ["blocks", "false"], ["captureBonus", "false"], ["places", "true"], ["moveSeconds", "0"], ["level", "easy"]]) {
    assert.equal(await host.locator(`#ld-settings input[name="ld-${name}"]:checked`).getAttribute("value"), value, `classic default for ${name}`);
  }
  await pick(host, "blocks", true);
  await pick(host, "captureBonus", true);
  await pick(host, "first", "host");
  assert.equal(await host.locator("#ld-settings legend .robot-only").count(), 1, "the robot level is marked as robot-only");
  assert.deepEqual(await host.locator("#ld-settings .settings-line .chip.robot").allInnerTexts(), ["Easy robots"], "robot-only choices are marked in the summary");
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  assert.deepEqual(
    await host.locator("#room-settings .chip").allInnerTexts(),
    ["Blocks", "A capture rolls again", "Play for places", "You go first", "No move limit"],
    "the waiting screen leaves out what only applies to robots",
  );
  const { invite } = await joinByInvite(host, [], srv);
  assert.match(invite, /\/ludo\/\?room=[A-Z0-9]{4}&key=[\w-]{22}$/);

  // The friend (360 px phone, dark) opens the link; the host presses Start with two in.
  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await joinByInvite(host, guest, srv);
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  assert.match(await host.locator("#start-game").innerText(), /2 players/);
  await host.click("#start-game");
  await host.locator("#ld-board").waitFor();
  await guest.locator("#ld-config").filter({ hasText: "blocks on" }).waitFor();
  assert.equal(await guest.locator("#ld-config").innerText(), "three 6s lose the turn · blocks on · a capture rolls again");
  assert.equal(await host.locator("#ld-config").innerText(), await guest.locator("#ld-config").innerText(), "the host's settings reach the friend");
  assert.match(await host.locator(".pb-players").innerText(), /Ada \(you\)[\s\S]*Bo/);
  assert.match(await guest.locator(".pb-players").innerText(), /Bo \(you\)[\s\S]*Ada/);
  // Two players sit opposite: red and yellow, and each sees their own yard bottom left.
  assert.equal(await yardCorner(host, "red"), "bottom left");
  assert.equal(await yardCorner(guest, "yellow"), "bottom left");
  assert.equal(await yardCorner(guest, "red"), "top right");
  assert.equal(await host.locator(".pb-who.c-red").count(), 1);
  assert.equal(await guest.locator(".pb-who.c-yellow", { hasText: "Bo" }).count(), 1, "Bo is yellow on both screens");
  assert.equal(await host.locator(".pb-who.c-yellow", { hasText: "Bo" }).count(), 1);
  assert.equal(await host.locator(".ld-board .pawn").count(), 8);
  assert.equal(await host.locator(".yard.empty").count(), 2, "green and blue sit out");
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));

  async function startedGame(m) {
    for (const p of [host, guest]) await waitForState(p, (ddp, n) => ddp.match.m === n && ddp.match.phase === "playing", m);
    assert.equal((await state(host)).first, 0, "the room says the host rolls first");
    assert.equal((await state(guest)).first, 0);
  }
  async function finish() {
    await Promise.all([autoplay(host), autoplay(guest)]);
    for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match.phase === "over", undefined, { timeout: 120_000 });
    await Promise.all([stopAutoplay(host), stopAutoplay(guest)]);
    const [a, b] = [await state(host), await state(guest)];
    assert.deepEqual(a, b, "both browsers end on the same state");
    assert.ok(a.tokens[a.winner].every((r) => r === 56));
    assert.deepEqual(a.order.length, 2);
    return a;
  }

  // Game 1. The host must roll; the friend waits.
  await startedGame(1);
  await host.locator("#ld-status").filter({ hasText: "Your turn. Roll the die!" }).waitFor();
  assert.ok(await host.locator("#ld-roll").isEnabled());
  assert.ok(await guest.locator("#ld-roll").isDisabled());
  assert.match(await guest.locator("#ld-status").innerText(), /Ada's turn/);
  await guest.screenshot({ path: `${ARTIFACTS}/ld-1-friend-mobile-dark.png`, fullPage: true });
  const won = await finish();
  const [winner, loser] = won.winner === 0 ? [host, guest] : [guest, host];
  await winner.locator("#result").filter({ hasText: "You won" }).waitFor();
  await loser.locator("#result").waitFor();
  assert.equal(await loser.locator("#result").innerText(), "You lost");
  assert.match(await loser.locator("#result-reason").innerText(), /brought all four home in \d+ rolls/);
  assert.equal(await host.locator("#result-places li").count(), 2);
  assert.match(await winner.locator("#score").innerText(), /You\s+1\s+\S+\s+0/);
  assert.match(await loser.locator("#score").innerText(), /You\s+0\s+\S+\s+1/);
  assert.ok(await resultInView(host), "the result shows on a laptop without scrolling");
  assert.ok(await resultInView(guest), "and on a phone");
  await host.screenshot({ path: `${ARTIFACTS}/ld-2-friend-over-light.png` });
  await guest.screenshot({ path: `${ARTIFACTS}/ld-3-friend-over-mobile-dark.png` });

  // Rematch: the host asks, the friend accepts; same settings, everyone back in the yard.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "Ada wants a rematch!" }).waitFor();
  await guest.click("#rematch");
  await startedGame(2);
  assert.deepEqual((await state(host)).tokens, [[-1, -1, -1, -1], [-1, -1, -1, -1]]);
  assert.match(await host.locator("#ld-note").innerText(), /Rematch #1/);
  const again = await finish();
  const wins = (seat) => (won.winner === seat) + (again.winner === seat);
  assert.match(await host.locator("#score").innerText(), new RegExp(`You\\s+${wins(0)}\\s+Bo\\s+${wins(1)}`));

  // The friend closes the tab: a robot plays on for them.
  await guest.close();
  await host.locator("#toast", { hasText: /Bo left|connection to Bo was lost/ }).waitFor({ state: "attached", timeout: 20_000 });
  await host.locator(".pb-name", { hasText: "Bo (robot)" }).waitFor();
  assert.equal(await host.locator("#ended").count(), 0);
  assertNoErrors();
});

test("a four-seat Ludo room: two friends join by the invite key, a third types the code and is let in from the player list", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open: openPage, assertNoErrors } = await openBrowser(t);
  const open = (nickname) => openPage(nickname, { nickname, viewport: laptop, reducedMotion: "reduce" });
  const host = await open("Ada");
  await host.goto(`${srv.base}/ludo/`);
  const { code } = await joinByInvite(host, [], srv);
  const friends = [];
  for (const name of ["Bo", "Cy"]) {
    const page = await open(name);
    await joinByInvite(host, page, srv);
    await host.locator("#roster li.ready", { hasText: name }).waitFor();
    friends.push(page);
  }
  assert.equal(await host.locator("#roster li.knock").count(), 0, "keyed guests are never asked about");
  assert.match(await host.locator("#start-game").innerText(), /3 players/);

  const di = await open("Di");
  await di.goto(`${srv.base}/ludo/`);
  await di.fill("#join-code", code);
  const knock = host.locator("#roster li.knock", { hasText: "Di wants to join" });
  await knock.waitFor();
  assert.match(await host.locator("#roster").innerText(), /You\s+host[\s\S]*Bo\s+in[\s\S]*Cy\s+in[\s\S]*Di wants to join/, "the knock sits in the player list");
  assert.match(await host.locator("#start-game").innerText(), /3 players/, "a knock is not a player");
  await knock.getByRole("button", { name: "Accept" }).click();

  // Di fills the room, so the game starts by itself.
  const pages = [host, ...friends, di];
  for (const p of pages) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
  assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.session.index))), [0, 1, 2, 3]);
  assertNoErrors();
});
