// Headless-browser test: game layouts hold still on a 360 px phone. Ludo's
// player pills keep their name and note inside them late in a game, and Tic
// Tac Toe's board stays put when a game ends in a draw. Skips if Playwright
// is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, waitForState, joinByInvite } from "../helpers.js";

const skip = skipWithoutPlaywright();

test("Ludo's player pills keep a long note inside them on a 360 px phone", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("player", {
    nickname: "Tester",
    viewport: { width: 360, height: 780 },
    reducedMotion: "reduce",
    init: () => localStorage.setItem("ddp-ludo-settings", JSON.stringify({ robots: 1 })),
  });
  await page.goto(`${srv.base}/ludo/`);
  await page.click("#play-robot");
  await page.locator(".pb-who .where").first().waitFor();
  // The longest notes a two-player game shows, once both players have tokens home and out.
  await page.evaluate(() => document.querySelectorAll(".pb-who .where").forEach((w, i) => (w.textContent = `${3 - i}/4 home · ${i + 1} out`)));

  const boxes = await page.evaluate(() => {
    const box = (n) => n.getBoundingClientRect();
    return {
      vs: box(document.querySelector(".pb-vs")),
      pills: [...document.querySelectorAll(".pb-who")].map((p) => ({
        pill: box(p),
        parts: [".pb-name", ".pb-note"].map((s) => {
          const n = p.querySelector(s);
          return { s, box: box(n), cut: n.scrollWidth > n.clientWidth, ellipsis: getComputedStyle(n).textOverflow === "ellipsis" };
        }),
      })),
    };
  });
  for (const [k, { pill, parts }] of boxes.pills.entries()) {
    assert.ok(k === 0 ? pill.right <= boxes.vs.left : pill.left >= boxes.vs.right, `pill ${k} stays clear of "vs"`);
    for (const { s, box, cut, ellipsis } of parts) {
      assert.ok(box.left >= pill.left && box.right <= pill.right, `pill ${k}: ${s} spans ${Math.round(box.left)}..${Math.round(box.right)}, inside ${Math.round(pill.left)}..${Math.round(pill.right)}`);
      assert.ok(!cut || ellipsis, `pill ${k}: ${s} ends in an ellipsis when cut short`);
    }
  }
  assertNoErrors();
});

test("Tic Tac Toe's board stays put on a 360 px phone when a game ends in a draw", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const viewport = { width: 360, height: 740 };
  const host = await open("host", {
    nickname: "Ada",
    viewport,
    init: () => localStorage.setItem("ddp-ttt-settings", JSON.stringify({ size: 3, moveSeconds: 0, gameSeconds: 0, first: "host" })),
  });
  await host.goto(`${srv.base}/tic-tac-toe/`);
  const guest = await open("guest", { nickname: "Bo", viewport });
  await joinByInvite(host, guest, srv);
  const pages = [host, guest];
  for (const p of pages) await waitForState(p, (ddp) => ddp.match?.phase === "playing");

  const boardTop = (page) => page.locator("#ttt-board").evaluate((n) => n.getBoundingClientRect().top);
  const before = await Promise.all(pages.map(boardTop));
  // A full board without a line: Ada (X) plays 0, 8, 7, 2, 3; Bo (O) plays 4, 1, 6, 5.
  for (const cell of [0, 4, 8, 1, 7, 6, 2, 5, 3]) {
    const n = await host.evaluate(() => window.ddp.match.state.moves.length);
    const mover = (await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.match.canMove())))).indexOf(true);
    await pages[mover].evaluate((cell) => window.ddp.match.play({ cell, ms: 0 }), cell);
    for (const p of pages) await waitForState(p, (ddp, n) => ddp.match.state.moves.length > n, n);
  }
  for (const [k, p] of pages.entries()) {
    await waitForState(p, (ddp) => ddp.match.phase === "over");
    assert.match(await p.locator("#ttt-status").innerText(), /draw/);
    assert.equal(await boardTop(p), before[k], `${k ? "guest" : "host"}: the board doesn't move`);
  }
  assertNoErrors();
});
