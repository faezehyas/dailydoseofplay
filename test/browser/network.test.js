// Headless-browser test for a misbehaving network: a friend game starts over
// slow signaling; the lobby says so when /ws drops while the host waits, and
// Try again works; a game plays on to the end once /ws is gone; and the host
// is told when a friend's browser vanishes without leaving. The silent peer
// and the four-player room have files of their own (network-*.test.js).
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, waitForState, waitForSameState, joinByInvite } from "../helpers.js";

const skip = skipWithoutPlaywright();

async function setup(t) {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  return { srv, assertNoErrors, open: (nickname, opts = {}) => open(nickname, { nickname, seed: `network-${nickname}`, reducedMotion: "reduce", ...opts }) };
}

// Plays this page's Tic Tac Toe turns in the page itself: a random free square.
const autoplay = (page) =>
  page.evaluate(() => {
    window.__autoplay = setInterval(() => {
      const m = window.ddp.match;
      if (!m?.canMove()) return;
      const free = m.state.board.flatMap((v, i) => (v === -1 ? [i] : []));
      document.querySelector(`.ttt-cell[data-i="${free[Math.floor(Math.random() * free.length)]}"]`).click();
    }, 20);
  });

test("a friend game starts when every signaling frame takes 2 s", { skip, timeout: 90_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada");
  const guest = await open("Bo");
  let delayed = 0;
  const later = (send) => (m) => {
    delayed += 1;
    setTimeout(() => send(m), 2_000);
  };
  for (const page of [host, guest]) {
    await page.routeWebSocket(/\/ws$/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage(later((m) => server.send(m)));
      server.onMessage(later((m) => ws.send(m)));
    });
  }
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await joinByInvite(host, guest, srv);
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match?.phase === "playing", undefined, { timeout: 40_000 });
  assert.match(await host.locator(".pb-players").innerText(), /Bo/);
  assert.ok(delayed >= 10, `every frame went through the delay (${delayed})`);
  assertNoErrors();
});

test("/ws closing while the host waits: the lobby says so, and Try again makes a new room", { skip, timeout: 90_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada");
  let up = true;
  const sockets = [];
  await host.routeWebSocket(/\/ws$/, (ws) => {
    if (!up) return ws.close();
    ws.connectToServer();
    sockets.push(ws);
  });
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await host.click("#play-friend");
  const code = (await host.locator("#room-code").innerText()).trim();

  up = false;
  for (const ws of sockets) await ws.close();
  await host.locator("#connect-error", { hasText: "Lost connection to the lobby server." }).waitFor({ timeout: 10_000 });
  await host.getByRole("heading", { name: "Connection problem" }).waitFor();
  // Still down: Try again finds no lobby server.
  await host.click("#retry");
  await host.getByRole("heading", { name: "You're offline" }).waitFor({ timeout: 10_000 });

  up = true;
  await host.click("#retry");
  await host.locator("#room-code").waitFor({ timeout: 10_000 });
  assert.notEqual((await host.locator("#room-code").innerText()).trim(), code, "a new room");
  const guest = await open("Bo");
  await joinByInvite(host, guest, srv);
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
  assertNoErrors();
});

test("a friend game plays on to the end once /ws is gone", { skip, timeout: 90_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada");
  const guest = await open("Bo");
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await joinByInvite(host, guest, srv);
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
  // Offline cuts the pages off the server; WebRTC on loopback carries on.
  for (const p of [host, guest]) await p.context().setOffline(true);
  for (const ws of srv.wss.clients) ws.terminate();

  await Promise.all([host, guest].map(autoplay));
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match.phase === "over");
  const end = await waitForSameState([host, guest]);
  assert.ok(end.moves.length >= 5);
  for (const p of [host, guest]) assert.equal(await p.locator("#ended").count(), 0, "the game went on");
  assertNoErrors();
});

test("a friend whose browser vanishes without leaving: the host is told once the grace period is over", { skip, timeout: 90_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await setup(t);
  const host = await open("Ada");
  const guest = await open("Bo");
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await joinByInvite(host, guest, srv);
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match?.phase === "playing");

  // No pagehide, so no goodbye: the host's link only stops hearing from Bo.
  await guest.context().close({ runBeforeUnload: false });
  const gone = Date.now();
  await host.locator("#ended-why", { hasText: "The connection to Bo was lost." }).waitFor({ timeout: 30_000 });
  assert.ok(Date.now() - gone >= 10_000, "not before the 10 s grace");
  assertNoErrors();
});
