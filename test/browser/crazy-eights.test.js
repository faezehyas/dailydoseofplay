// Headless-browser test for Crazy Eights: two friends play on the host's room
// settings through the invite link and the Start button, over a real WebRTC
// DataChannel, with every shuffle proved and the game audited; then a
// rematch. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, joinByInvite, noHorizontalScroll, pick } from "../helpers.js";
import { bg, state, resultInView, autoplay, stopAutoplay, leaks, domLeaks } from "./crazy-eights.shared.js";

const skip = skipWithoutPlaywright();

test("two friends play Crazy Eights on the host's settings through the invite link, then a rematch", { skip, timeout: 300_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  // Reduced motion plays every card at once, so whole games fit the test.
  const laptop = { viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" };

  // Host (laptop, light): classic defaults, then action cards on and the host first.
  const host = await open("host", { nickname: "Ada", ...laptop, colorScheme: "light" });
  await host.goto(`${srv.base}/crazy-eights/`);
  for (const [name, value] of [["draw", "until"], ["strict", "true"], ["actions", "false"], ["first", "random"], ["moveSeconds", "0"], ["level", "easy"], ["fourColor", "false"]]) {
    assert.equal(await host.locator(`#ce-settings input[name="ce-${name}"]:checked`).getAttribute("value"), value, `classic default for ${name}`);
  }
  await pick(host, "actions", true);
  await pick(host, "first", "host");
  const { invite } = await joinByInvite(host, [], srv);
  assert.match(invite, /\/crazy-eights\/\?room=[A-Z0-9]{4}&key=[\w-]{22}$/);

  // The friend (360 px phone, dark, four-colour deck) opens the link; the host presses Start with two in.
  const guest = await open("guest", {
    nickname: "Bo",
    phone: true,
    reducedMotion: "reduce",
    colorScheme: "dark",
    init: () => localStorage.setItem("ddp-crazy-eights-settings", JSON.stringify({ fourColor: true, draw: "one" })),
  });
  await joinByInvite(host, guest, srv);
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  assert.match(await host.locator("#start-game").innerText(), /2 players/);
  await host.click("#start-game");
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match?.phase === "playing", undefined, { timeout: 60_000 });
  await guest.locator("#ce-config").filter({ hasText: "action cards on" }).waitFor();
  assert.equal(await guest.locator("#ce-config").innerText(), "draw until you can play · draw only when nothing plays · action cards on");
  assert.equal(await host.locator("#ce-config").innerText(), await guest.locator("#ce-config").innerText(), "the host's settings reach the friend, not the friend's own");
  assert.match(await host.locator(".pb-players").innerText(), /Ada \(you\)[\s\S]*Bo/);
  assert.match(await guest.locator(".pb-players").innerText(), /Bo \(you\)[\s\S]*Ada/);
  // Seat colours are the same on both screens: Ada coral (seat 0), Bo teal (seat 1).
  for (const p of [host, guest]) {
    assert.equal(await p.locator(".pb-who.p-0").innerText().then((s) => s.split("\n")[0]), p === host ? "Ada (you)" : "Ada");
    assert.equal(await p.locator(".ce-seat.p-1, .ce-me.p-1").count(), 1);
  }
  assert.equal((await state(host)).first, 0, "the room says the host goes first");
  // Two players get 7 cards (the host, first, may already have drawn).
  const dealt = (st, p) => st.hands[p].length - st.draws[p] + st.plays[p];
  assert.equal(dealt(await state(host), 0), 7, "two players get 7 cards");
  // The friend's screen shows the host's hand as it is now, which adds up to the same 7.
  await waitForState(guest, (ddp) => document.querySelector(".ce-seat .count").textContent === String(ddp.match.state.hands[0].length));
  assert.equal(dealt(await state(guest), 0), 7, "the friend sees the host's 7 cards");
  // The friend's four-colour deck is theirs alone.
  assert.equal(await guest.locator(".crazy-eights.four-colour").count(), 1);
  assert.equal(await host.locator(".crazy-eights.four-colour").count(), 0);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  await guest.screenshot({ path: `${ARTIFACTS}/ce-1-friend-mobile-dark.png`, fullPage: true });

  async function finish() {
    await Promise.all([autoplay(host), autoplay(guest)]);
    for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match.phase === "over", undefined, { timeout: 120_000 });
    await Promise.all([stopAutoplay(host), stopAutoplay(guest)]);
    for (const p of [host, guest]) {
      assert.deepEqual(await leaks(p), [], "no hidden face was known during play");
      assert.deepEqual(await domLeaks(p), [], "no hidden face was drawn");
      await waitForState(p, (ddp) => ddp.match.verdict, undefined, { timeout: 60_000 });
      assert.deepEqual(await p.evaluate(() => window.ddp.match.verdict), { ok: true });
      await p.locator("#ce-verdict.ok").waitFor();
      assert.match(await p.locator("#ce-verdict").innerText(), /Fair play verified/);
    }
    const [a, b] = [await state(host), await state(guest)];
    assert.deepEqual(a, b, "both browsers end on the same state");
    if (a.ended === "out") assert.equal(a.hands[a.winner].length, 0, "the winner went out");
    const won = a.winner === 0 ? host : guest;
    assert.equal(await won.locator("#result").innerText(), "You won");
    assert.equal(await (won === host ? guest : host).locator("#result").innerText(), "You lost");
    // After the audit the loser's leftover hand is shown face up, with its points.
    const loser = 1 - a.winner;
    if (a.hands[loser].length) assert.match(await host.locator("#ce-standings").innerText(), /\d+ pts/);
    for (const p of [host, guest]) assert.ok(await resultInView(p), "the result fits without scrolling");
    return a;
  }

  const first = await finish();
  await host.screenshot({ path: `${ARTIFACTS}/ce-2-friend-over.png` });
  await guest.screenshot({ path: `${ARTIFACTS}/ce-3-friend-over-mobile.png` });

  // Rematch: the friend asks, the host sees it and accepts.
  await guest.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Bo wants a rematch!" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "Waiting for Ada" }).waitFor();
  await host.click("#rematch");
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match.m === 2 && ddp.match.phase === "playing", undefined, { timeout: 60_000 });
  assert.equal(dealt(await state(host), 0), 7);
  const second = await finish();
  const wins = [0, 1].map((p) => [first, second].filter((st) => st.winner === p).length);
  for (const p of [host, guest]) {
    assert.equal(await p.locator("#score .p-0 dd").innerText(), String(wins[0]), "the score carries across the rematch");
    assert.equal(await p.locator("#score .p-1 dd").innerText(), String(wins[1]));
  }

  // A third game, where Bo's browser never sends its key and Bo leaves during the audit.
  await guest.click("#rematch");
  await host.click("#rematch");
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match.m === 3 && ddp.match.phase === "playing", undefined, { timeout: 60_000 });
  await guest.evaluate(() => {
    const send = window.ddp.session.send.bind(window.ddp.session);
    window.ddp.session.send = (msg) => (msg.t === "audit" ? true : send(msg));
  });
  await Promise.all([autoplay(host), autoplay(guest)]);
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match.phase === "over", undefined, { timeout: 120_000 });
  await Promise.all([stopAutoplay(host), stopAutoplay(guest)]);
  await host.locator("#ce-verdict:not(.ok)").waitFor();
  assert.equal(await host.evaluate(() => window.ddp.match.busy), "auditing", "still waiting for Bo's key");
  // A robot takes Bo's seat, but the game can't be verified without Bo's key.
  await guest.close();
  await host.locator("#ce-verdict", { hasText: "Bo left before the audit finished, so this game couldn't be verified." }).waitFor({ timeout: 20_000 });
  await host.locator(".pb-name", { hasText: "Bo (robot)" }).waitFor();
  assertNoErrors();
});
