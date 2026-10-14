// Headless-browser test for Tic Tac Toe: two browser contexts play a friend
// match on the host's settings (5×5, clocks) through the invite link over a
// real WebRTC DataChannel, then a rematch; and robot games on a phone,
// including a loss on the move clock. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, joinByInvite, noHorizontalScroll, pick } from "../helpers.js";

const skip = skipWithoutPlaywright();
const moveCount = (page) => page.evaluate(() => window.ddp.match.state.moves.length);
// Every mark on the board has finished drawing in.
const marksDrawn = (page) => waitForState(page, () => document.querySelector("#ttt-board").getAnimations({ subtree: true }).every((a) => a.playState === "finished"));

test("two friends play Tic Tac Toe on the host's settings through the invite link, then a rematch", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);

  // Host (desktop, light) picks 5×5 and to start, keeps the default clocks
  // (30 s a move, 2 min each), and creates a room; the friend (360 px phone,
  // dark) opens the link.
  const host = await open("host", { nickname: "Ada", viewport: { width: 1200, height: 900 }, colorScheme: "light" });
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await pick(host, "size", 5);
  await pick(host, "first", "host");
  const chosen = ["5 × 5", "30 s a move", "2 min each", "You go first"];
  assert.deepEqual(await host.locator("#ttt-settings .settings-line .chip").allInnerTexts(), chosen, "the summary follows the choice");
  await host.click("#play-friend");
  assert.ok(await host.locator("#ttt-settings").isHidden(), "settings are only on the home screen");
  await host.locator("#room-code").waitFor();
  assert.deepEqual(await host.locator("#room-settings .chip").allInnerTexts(), chosen, "the waiting screen shows the room's settings");
  const invite = await host.locator("#invite-link").inputValue();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(invite, new RegExp(`/tic-tac-toe/\\?room=${code}&key=[\\w-]{22}$`));

  const guest = await open("guest", { nickname: "Bo", phone: true, colorScheme: "dark" });
  await joinByInvite(host, guest, srv);
  await host.locator("#ttt-board .ttt-cell").first().waitFor();
  await guest.locator("#ttt-board .ttt-cell").first().waitFor();
  assert.equal(await guest.locator(".ttt-cell").count(), 25, "the host's board size reaches the friend");
  assert.equal(await guest.locator("#ttt-config").innerText(), "5 × 5, four in a row · 30 s a move · 2 min each");
  assert.equal(await host.locator("#ttt-config").innerText(), await guest.locator("#ttt-config").innerText());
  assert.match(await host.locator(".pb-players").innerText(), /Ada[\s\S]*Bo/);
  // "Ada vs Bo" stays together, centred over the scoreboard.
  const centre = (page, sel) => page.locator(sel).evaluate((n) => { const r = n.getBoundingClientRect(); return r.left + r.width / 2; });
  assert.ok(Math.abs((await centre(host, ".pb-players")) - (await centre(host, "#score"))) < 2, "the players are centred");
  assert.match(await guest.locator(".pb-players").innerText(), /Bo[\s\S]*Ada/);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));

  // Both browsers agree who starts (the host, by the room's setting) and it plays X.
  async function startedGame(m) {
    await waitForState(host, (ddp, n) => ddp.match.m === n && ddp.match.phase === "playing", m);
    await waitForState(guest, (ddp, n) => ddp.match.m === n && ddp.match.phase === "playing", m);
    const first = await host.evaluate(() => window.ddp.match.state.first);
    assert.equal(await guest.evaluate(() => window.ddp.match.state.first), first, "both browsers agree who starts");
    assert.equal(first, 0);
    const x = host;
    const o = guest;
    assert.match(await x.locator("#ttt-status").innerText(), /Your turn\. Place your X/);
    assert.match(await o.locator("#ttt-status").innerText(), /is thinking/);
    return [x, o];
  }

  // Play cells in order, X first, by tapping squares (or by keyboard when asked).
  async function playOut(players, cells, { keyboardAt = -1 } = {}) {
    const base = await moveCount(host);
    for (let k = 0; k < cells.length; k++) {
      const page = players[k % 2];
      await waitForState(page, (ddp) => ddp.match.canMove());
      if (k === keyboardAt) {
        // Arrow from the square to the left (wrapping), then Enter.
        const from = cells[k] % 5 === 0 ? cells[k] + 4 : cells[k] - 1;
        await page.locator(`.ttt-cell[data-i="${from}"]`).focus();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Enter");
      } else {
        await page.click(`.ttt-cell[data-i="${cells[k]}"]`);
      }
      await waitForState(host, (ddp, n) => ddp.match.state.moves.length === n, base + k + 1);
      await waitForState(guest, (ddp, n) => ddp.match.state.moves.length === n, base + k + 1);
    }
    await waitForState(host, (ddp) => ddp.match.phase === "over");
    await waitForState(guest, (ddp) => ddp.match.phase === "over");
    assert.deepEqual(await host.evaluate(() => window.ddp.match.state), await guest.evaluate(() => window.ddp.match.state));
  }

  // Game 1: X takes four along the top row; O plays 5, 6 and 7. O also tries a taken square.
  let [x, o] = await startedGame(1);
  assert.ok(await host.locator("#ttt-clocks").isVisible());
  assert.match(await host.locator("#ttt-clocks").innerText(), /\d:\d\d[\s\S]*\d+ s[\s\S]*\d:\d\d/);
  await waitForState(x, (ddp) => ddp.match.canMove());
  await x.click('.ttt-cell[data-i="0"]');
  await waitForState(o, (ddp) => ddp.match.canMove());
  await o.click('.ttt-cell[data-i="0"]', { force: true }); // aria-disabled, but a tap still lands
  await o.locator("#toast.show").filter({ hasText: "taken" }).waitFor();
  assert.equal(await moveCount(o), 1, "a taken square is refused locally");
  await playOut([o, x], [5, 1, 6, 2, 7, 3], { keyboardAt: 1 });
  assert.deepEqual(await host.evaluate(() => window.ddp.match.state.line), [0, 1, 2, 3]);
  assert.equal(await x.locator(".ttt-cell.win").count(), 4);
  assert.equal(await x.locator("#result").innerText(), "You won");
  assert.equal(await o.locator("#result").innerText(), "You lost");
  assert.match(await o.locator("#result-reason").innerText(), /Ada lined up four Xs/);
  assert.match(await x.locator("#score").innerText(), /You\s+1\s+Draws\s+0\s+\S+\s+0/);
  assert.match(await o.locator("#score").innerText(), /You\s+0\s+Draws\s+0\s+\S+\s+1/);
  const clocks = await host.evaluate(() => window.ddp.match.state.clocks);
  assert.ok(clocks.every((ms) => ms < 120_000 && ms > 60_000), `both clocks were spent: ${clocks}`);
  await marksDrawn(host); // let the last mark finish drawing
  await host.screenshot({ path: `${ARTIFACTS}/ttt-1-win.png`, fullPage: true });
  await guest.screenshot({ path: `${ARTIFACTS}/ttt-2-over-mobile-dark.png`, fullPage: true });

  // Rematch: host asks, the friend accepts; same settings, fresh board and clocks.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await guest.click("#rematch");
  [x, o] = await startedGame(2);
  assert.equal(await host.locator(".ttt-cell .mark").count(), 0, "a fresh board");
  assert.deepEqual(await guest.evaluate(() => window.ddp.match.state.clocks), [120_000, 120_000]);

  // Game 2: the friend lines up four along the bottom row.
  await playOut([x, o], [0, 20, 6, 21, 12, 22, 4, 23]);
  assert.deepEqual(await host.evaluate(() => window.ddp.match.state.line), [20, 21, 22, 23]);
  assert.equal(await guest.locator("#result").innerText(), "You won");
  assert.equal(await host.locator("#result").innerText(), "You lost");
  assert.match(await host.locator("#score").innerText(), /You\s+1\s+Draws\s+0\s+Bo\s+1/);
  assert.ok(await noHorizontalScroll(guest));
  await marksDrawn(guest);
  await guest.screenshot({ path: `${ARTIFACTS}/ttt-3-rematch-mobile-dark.png`, fullPage: true });

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assertNoErrors();
});

test("Tic Tac Toe vs the robot on a 360 px phone: a full game, then a loss on the move clock", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("player", { phone: true, colorScheme: "light", clock: true });

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="tic-tac-toe"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "size", 3);
  await pick(page, "moveSeconds", 5);
  await pick(page, "gameSeconds", 0);
  await pick(page, "first", "host");
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.click("#play-robot");
  await waitForState(page, (ddp) => ddp.match?.phase === "playing");
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot/);
  // On a phone the names use the full width, from the scoreboard's left edge.
  const left = (sel) => page.locator(sel).evaluate((n) => n.getBoundingClientRect().left);
  assert.ok(Math.abs((await left(".pb-players")) - (await left("#score"))) < 1, "the names start at the scoreboard's edge");
  assert.match(await page.locator("#ttt-config").innerText(), /3 × 3, three in a row · 5 s a move · no game clock/);
  assert.equal(await page.evaluate(() => window.ddp.match.state.turn), 0, "the room setting says I start");
  assert.ok(await page.locator("#ttt-move-left").isVisible());
  assert.ok(await noHorizontalScroll(page));

  // Take a winning square if there is one, else the first free one.
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    await waitForState(page, (ddp) => ddp.match.canMove() || ddp.match.phase !== "playing");
    const cell = await page.evaluate(() => {
      const { board } = window.ddp.match.state;
      const me = window.ddp.match.me;
      const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
      const free = board.flatMap((v, i) => (v === -1 ? [i] : []));
      if (window.ddp.match.phase !== "playing") return -1;
      return free.find((i) => lines.some((l) => l.includes(i) && l.every((j) => j === i || board[j] === me))) ?? free[0];
    });
    if (cell < 0) break;
    const n = await moveCount(page);
    await page.tap(`.ttt-cell[data-i="${cell}"]`);
    await waitForState(page, (ddp, k) => ddp.match.state.moves.length > k, n);
  }
  await waitForState(page, (ddp) => ddp.match.phase === "over");
  const st = await page.evaluate(() => window.ddp.match.state);
  const counts = [0, 1].map((p) => st.board.filter((v) => v === p).length);
  assert.ok(Math.abs(counts[0] - counts[1]) <= 1, "the robot made one legal move per turn");
  assert.equal(new Set(st.moves).size, st.moves.length);
  assert.match(await page.locator("#result").innerText(), /^(You won|You lost|Draw)$/);
  await marksDrawn(page);
  await page.screenshot({ path: `${ARTIFACTS}/ttt-4-robot-light.png`, fullPage: true });

  // The robot accepts a rematch. This time let the 5 s move clock run out.
  await page.click("#rematch");
  await waitForState(page, (ddp) => ddp.match.m === 2 && ddp.match.phase === "playing");
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.clock.fastForward(2500);
  await page.screenshot({ path: `${ARTIFACTS}/ttt-5-robot-dark-clock.png`, fullPage: true });
  await page.clock.fastForward(3000);
  await waitForState(page, (ddp) => ddp.match.phase === "over");
  assert.equal(await page.evaluate(() => window.ddp.match.state.reason), "timeout");
  assert.equal(await page.locator("#result").innerText(), "You lost");
  assert.equal(await page.locator("#result-reason").innerText(), "Your clock ran out.");
  assert.match(await page.locator("#score").innerText(), /Robot\s+[1-2]/);
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assertNoErrors();
});
