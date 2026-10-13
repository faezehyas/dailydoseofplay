// Headless-browser test: game layouts hold still on a 360 px phone. Ludo's
// player pills keep their name and note inside them late in a game, and Tic
// Tac Toe's board stays put when a game ends in a draw. Skips if Playwright
// is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "../helpers.js";

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

test("Ludo's player pills keep a long note inside them on a 360 px phone", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, reducedMotion: "reduce" });
  await ctx.addInitScript(() => localStorage.setItem("ddp-name", "Tester"));
  await ctx.addInitScript(() => localStorage.setItem("ddp-ludo-settings", JSON.stringify({ robots: 1 })));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
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
  assert.deepEqual(errors, []);
});

test("Tic Tac Toe's board stays put on a 360 px phone when a game ends in a draw", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, nickname) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }
  const host = await open("host", "Ada");
  await host.addInitScript(() => localStorage.setItem("ddp-ttt-settings", JSON.stringify({ size: 3, moveSeconds: 0, gameSeconds: 0, first: "host" })));
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await host.click("#play-friend");
  const invite = await host.locator("#invite-link").inputValue();
  const guest = await open("guest", "Bo");
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await guest.click("#join-room");
  const pages = [host, guest];
  for (const p of pages) await wait(p, () => window.ddp.match?.phase === "playing");

  const boardTop = (page) => page.locator("#ttt-board").evaluate((n) => n.getBoundingClientRect().top);
  const before = await Promise.all(pages.map(boardTop));
  // A full board without a line: Ada (X) plays 0, 8, 7, 2, 3; Bo (O) plays 4, 1, 6, 5.
  for (const cell of [0, 4, 8, 1, 7, 6, 2, 5, 3]) {
    const n = await host.evaluate(() => window.ddp.match.state.moves.length);
    const mover = (await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.match.canMove())))).indexOf(true);
    await pages[mover].evaluate((cell) => window.ddp.match.play({ cell, ms: 0 }), cell);
    for (const p of pages) await wait(p, (n) => window.ddp.match.state.moves.length > n, n);
  }
  for (const [k, p] of pages.entries()) {
    await wait(p, () => window.ddp.match.phase === "over");
    assert.match(await p.locator("#ttt-status").innerText(), /draw/);
    assert.equal(await boardTop(p), before[k], `${k ? "guest" : "host"}: the board doesn't move`);
  }
  assert.deepEqual(errors, []);
});
