// Headless-browser test for Checkers: two browser contexts play a friend
// match on the host's settings (clocks, host starts) through the invite link
// over a real WebRTC DataChannel, then a rematch the friend loses on the move
// clock; a full robot game on a phone; a robot that moves first on a
// plain-http page without WebCrypto; move sounds with the mute button; and a
// move dot centred where a piece was just captured. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, joinByInvite, noHorizontalScroll, pick } from "../helpers.js";

const skip = skipWithoutPlaywright();
const moveCount = (page) => page.evaluate(() => window.ddp.match.state.moves.length);
const square = (sq) => `.ck-sq[data-sq="${sq}"]`;

// The path the page's player should play now: the robot's best move at
// `level`, or the first legal move ("first"). Loaded from the page's own modules.
// Ties between equal moves break the same way every run.
function nextPath(page, level) {
  return page.evaluate(async (level) => {
    const match = window.ddp.match;
    if (level === "first") {
      const { legalMoves } = await import("/checkers/rules.js");
      return legalMoves(match.state.board, match.me)[0];
    }
    const { chooseMove } = await import("/checkers/robot.js");
    return chooseMove(match.state, match.me, () => 0, { level, randomChance: 0 }).path;
  }, level);
}

// Play a path on the board: tap or click each square, or use the keyboard.
async function playPath(page, path, how) {
  for (const sq of path) {
    if (how === "tap") await page.tap(square(sq));
    else if (how === "click") await page.click(square(sq));
    else {
      // Keyboard (host, so the board is not turned): from the dark square two
      // columns over in the same row, arrow across, then Enter.
      const fromLeft = (sq & 7) >= 2;
      await page.locator(square(fromLeft ? sq - 2 : sq + 2)).focus();
      await page.keyboard.press(fromLeft ? "ArrowRight" : "ArrowLeft");
      assert.equal(await page.evaluate(() => Number(document.activeElement.dataset.sq)), sq);
      await page.keyboard.press("Enter");
    }
  }
}

test("two friends play Checkers on the host's settings through the invite link, then a rematch lost on the clock", { skip, timeout: 180_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);

  // Host (desktop, light) picks 1 min a move, 5 min each and to start, then
  // creates a room. The friend (360 px phone, dark) has other settings saved,
  // and a clock we can move forward later.
  const host = await open("host", { nickname: "Ada", viewport: { width: 1200, height: 900 }, colorScheme: "light" });
  await host.goto(`${srv.base}/checkers/`);
  await pick(host, "moveSeconds", 60);
  await pick(host, "gameSeconds", 300);
  await pick(host, "first", "host");
  await host.click("#play-friend");
  assert.ok(await host.locator("#ck-settings").isHidden(), "settings are only on the home screen");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(invite, new RegExp(`/checkers/\\?room=${code}&key=[\\w-]{22}$`));

  const guest = await open("guest", {
    nickname: "Bo",
    phone: true,
    colorScheme: "dark",
    clock: true,
    init: () => localStorage.setItem("ddp-checkers-settings", JSON.stringify({ moveSeconds: 30, gameSeconds: 0, first: "guest", level: "hard" })),
  });
  await joinByInvite(host, guest, srv);
  await waitForState(host, (ddp) => ddp.match?.phase === "playing");
  await waitForState(guest, (ddp) => ddp.match?.phase === "playing");
  assert.equal(await guest.locator("#ck-config").innerText(), "8 × 8 checkers · 1 min a move · 5 min each", "the host's settings reach the friend");
  assert.equal(await host.locator("#ck-config").innerText(), await guest.locator("#ck-config").innerText());
  const guestState = await guest.evaluate(() => window.ddp.match.state);
  assert.equal(guestState.moveMs, 60_000);
  assert.deepEqual(guestState.clocks, [300_000, 300_000]);
  assert.equal(guestState.first, 0, "the host starts, as the host's settings say");
  assert.match(await host.locator(".pb-players").innerText(), /Ada[\s\S]*Bo/);
  assert.match(await guest.locator(".pb-players").innerText(), /Bo[\s\S]*Ada/);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));
  // Each player sees their own men at the bottom.
  const bottomLeft = (page) => page.evaluate(() => Number(document.querySelectorAll("#ck-board .ck-sq")[56].dataset.sq));
  assert.equal(await bottomLeft(host), 56);
  assert.equal(await bottomLeft(guest), 7);
  assert.equal(await host.locator(".ck-sq .piece.a").count(), 12, "the starter's pieces");
  assert.match(await host.locator("#ck-status").innerText(), /^Your turn\.$/);
  assert.match(await guest.locator("#ck-status").innerText(), /Ada is thinking/);
  assert.ok(await host.locator("#ck-clocks").isVisible());
  // Ada's clock has run since the game began, as long as the move clock has; Bo's waits at 5:00.
  const [ada, move, bo] = (await host.locator("#ck-clocks").innerText()).split("\n");
  assert.match(`${ada} ${move} ${bo}`, /^[45]:\d\d \d+ s 5:00$/);
  assert.equal(Number(ada[0]) * 60 + Number(ada.slice(2)) - parseInt(move), 240, "Ada's two clocks count the same time");

  // Game 1: the host plays strong moves (the first by keyboard), the friend the
  // first legal move each time, by touch. Once, the friend tries a piece that
  // can't capture while a capture is due.
  let triedWrongPiece = false;
  for (let k = 0; ; k++) {
    if ((await host.evaluate(() => window.ddp.match.phase)) !== "playing") break;
    const hostTurn = (await host.evaluate(() => window.ddp.match.state.turn)) === 0;
    const page = hostTurn ? host : guest;
    await waitForState(page, (ddp) => ddp.match.canMove());
    const n = await moveCount(page);
    if (!hostTurn && !triedWrongPiece) {
      const wrong = await guest.evaluate(async () => {
        const { legalMoves, isJump, owner, EMPTY } = await import("/checkers/rules.js");
        const { board } = window.ddp.match.state;
        const legal = legalMoves(board, 1);
        if (!isJump(legal[0])) return -1;
        return board.findIndex((v, sq) => v !== EMPTY && owner(v) === 1 && !legal.some((m) => m[0] === sq));
      });
      if (wrong >= 0) {
        triedWrongPiece = true;
        await guest.tap(square(wrong), { force: true }); // aria-disabled, but a tap still lands
        await guest.locator("#toast.show").filter({ hasText: "You must capture" }).waitFor();
        assert.equal(await moveCount(guest), n, "nothing was played");
      }
    }
    const pathNow = await nextPath(page, hostTurn ? "hard" : "first");
    if (k === 0) {
      // Pick, put back with Escape, then play by keyboard.
      await playPath(host, pathNow.slice(0, 1), "keyboard");
      assert.equal(await host.locator(".ck-sq.picked").count(), 1);
      await host.keyboard.press("Escape");
      assert.equal(await host.locator(".ck-sq.picked").count(), 0);
      await playPath(host, pathNow, "keyboard");
    } else await playPath(page, pathNow, hostTurn ? "click" : "tap");
    await waitForState(host, (ddp, m) => ddp.match.state.moves.length === m, n + 1);
    await waitForState(guest, (ddp, m) => ddp.match.state.moves.length === m, n + 1);
    assert.ok(k < 200, "the game ends");
  }
  await waitForState(host, (ddp) => ddp.match.phase === "over");
  await waitForState(guest, (ddp) => ddp.match.phase === "over");
  assert.ok(triedWrongPiece, "a forced capture came up");
  const final = await host.evaluate(() => window.ddp.match.state);
  assert.deepEqual(await guest.evaluate(() => window.ddp.match.state), final, "both browsers agree on every move");
  assert.equal(final.winner, 0, `the strong side wins (${final.reason})`);
  assert.ok(final.clocks.every((ms) => ms < 300_000 && ms > 0), `both clocks were spent: ${final.clocks}`);
  assert.equal(await host.locator("#result").innerText(), "You won");
  assert.equal(await guest.locator("#result").innerText(), "You lost");
  assert.match(await guest.locator("#result-reason").innerText(), /Ada captured all your pieces|You have no legal move left/);
  assert.match(await host.locator("#score").innerText(), /You\s+1\s+Draws\s+0\s+Bo\s+0/);
  assert.match(await guest.locator("#score").innerText(), /You\s+0\s+Draws\s+0\s+Ada\s+1/);
  await host.waitForTimeout(700); // let the last capture fade
  await host.screenshot({ path: `${ARTIFACTS}/checkers-1-win.png`, fullPage: true });
  await guest.screenshot({ path: `${ARTIFACTS}/checkers-2-over-mobile-dark.png`, fullPage: true });

  // Rematch: host asks, the friend accepts; same settings, fresh board and clocks.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await guest.tap("#rematch");
  await waitForState(host, (ddp) => ddp.match.m === 2 && ddp.match.phase === "playing");
  await waitForState(guest, (ddp) => ddp.match.m === 2 && ddp.match.phase === "playing");
  assert.equal(await guest.locator(".ck-sq .piece:not(.ghost)").count(), 24, "a fresh board");
  assert.deepEqual(await guest.evaluate(() => window.ddp.match.state.clocks), [300_000, 300_000]);

  // Game 2: the host moves, then the friend's 1-minute move clock runs out.
  await waitForState(host, (ddp) => ddp.match.canMove());
  await playPath(host, await nextPath(host, "hard"), "click");
  await waitForState(guest, (ddp) => ddp.match.canMove());
  await guest.tap(square((await nextPath(guest, "first"))[0]));
  assert.equal(await guest.locator(".ck-sq.picked").count(), 1);
  assert.ok(await noHorizontalScroll(guest));
  await guest.screenshot({ path: `${ARTIFACTS}/checkers-3-rematch-picked-mobile-dark.png`, fullPage: true });
  await guest.clock.fastForward("01:01");
  await waitForState(host, (ddp) => ddp.match.phase === "over");
  await waitForState(guest, (ddp) => ddp.match.phase === "over");
  const timedOut = await host.evaluate(() => window.ddp.match.state);
  assert.deepEqual(await guest.evaluate(() => window.ddp.match.state), timedOut);
  assert.equal(timedOut.reason, "timeout");
  assert.equal(timedOut.winner, 0);
  assert.equal(await guest.locator("#result").innerText(), "You lost");
  assert.equal(await guest.locator("#result-reason").innerText(), "Your clock ran out.");
  assert.equal(await host.locator("#result-reason").innerText(), "Bo's clock ran out.");
  assert.match(await host.locator("#score").innerText(), /You\s+2\s+Draws\s+0\s+Bo\s+0/);
  await guest.screenshot({ path: `${ARTIFACTS}/checkers-4-clock-loss-mobile-dark.png`, fullPage: true });

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assertNoErrors();
});

test("Checkers vs the robot on a 360 px phone: a full game by touch, then a rematch in dark mode", { skip, timeout: 180_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("player", { phone: true, colorScheme: "light", seed: "checkers" });

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="checkers"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  assert.equal(await page.locator('#ck-settings input[name="ck-level"]:checked').getAttribute("value"), "easy", "Easy is the default level");
  await pick(page, "first", "host");
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/checkers-5-lobby-mobile-light.png`, fullPage: true });
  // The seeded robot (seed "checkers") makes its random moves, and so this
  // game, the same every run. Unseeded, about one game in 100 ends in a draw
  // on the 40-turn rule.
  await page.click("#play-robot");
  await waitForState(page, (ddp) => ddp.match?.phase === "playing");
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot/);
  assert.equal(await page.locator("#ck-config").innerText(), "8 × 8 checkers · no move limit · no game clock · Easy robot");
  assert.ok(await page.locator("#ck-clocks").isHidden(), "no clocks by default");
  assert.equal(await page.evaluate(() => window.ddp.match.state.turn), 0, "the room setting says I start");
  assert.ok(await noHorizontalScroll(page));

  // Tap out strong moves until the game ends; the robot answers each one.
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    await waitForState(page, (ddp) => ddp.match.canMove() || ddp.match.phase !== "playing");
    if ((await page.evaluate(() => window.ddp.match.phase)) !== "playing") break;
    const n = await moveCount(page);
    await playPath(page, await nextPath(page, "hard"), "tap");
    await waitForState(page, (ddp, k) => ddp.match.state.moves.length > k, n);
    if (n === 20) await page.screenshot({ path: `${ARTIFACTS}/checkers-6-robot-midgame-light.png`, fullPage: true });
  }
  await waitForState(page, (ddp) => ddp.match.phase === "over");
  const st = await page.evaluate(() => window.ddp.match.state);
  assert.equal(st.winner, 0, `beating the Easy robot (${st.reason})`);
  assert.equal(await page.locator("#result").innerText(), "You won");
  assert.match(await page.locator("#score").innerText(), /You\s+1\s+Draws\s+0\s+Robot\s+0/);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${ARTIFACTS}/checkers-7-robot-win-light.png`, fullPage: true });

  // The robot accepts a rematch; switch to dark mode and play a couple of moves.
  await page.tap("#rematch");
  await waitForState(page, (ddp) => ddp.match.m === 2 && ddp.match.phase === "playing");
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  for (let k = 0; k < 2; k++) {
    await waitForState(page, (ddp) => ddp.match.canMove());
    const n = await moveCount(page);
    await playPath(page, await nextPath(page, "hard"), "tap");
    await waitForState(page, (ddp, m) => ddp.match.state.moves.length >= m + 2, n);
  }
  assert.ok(await noHorizontalScroll(page));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${ARTIFACTS}/checkers-8-robot-dark.png`, fullPage: true });

  // A double jump, set up on both sides' boards: 56 over 49 to 42, over 35 to 28.
  await waitForState(page, (ddp) => ddp.match.canMove());
  await page.evaluate(() => {
    const board = Array(64).fill(-1);
    Object.assign(board, { 56: 0, 62: 0, 49: 1, 35: 1, 8: 1 });
    for (const match of [window.ddp.match, window.ddp.robot.match]) match.state.board = board.slice();
    window.ddp.match.emit("update");
  });
  assert.match(await page.locator("#ck-status").innerText(), /You must capture/);
  assert.deepEqual(await page.locator(".ck-sq.can").evaluateAll((els) => els.map((e) => Number(e.dataset.sq))), [56], "only the piece that can jump");
  await page.tap(square(56));
  await page.tap(square(42));
  assert.equal(await page.locator("#ck-status").innerText(), "Keep jumping!");
  assert.equal(await page.locator(`${square(56)} .piece`).count(), 0, "the piece is drawn where it has got to");
  assert.equal(await page.locator(`${square(42)} .piece`).count(), 1);
  assert.equal(await page.locator(".ck-sq.taking").count(), 1);
  assert.equal(await page.locator(".ck-sq.target").count(), 1);
  await page.screenshot({ path: `${ARTIFACTS}/checkers-9-keep-jumping-dark.png`, fullPage: true });
  await page.tap(square(56)); // back to the start square: start over
  assert.equal(await page.locator(".ck-sq.picked").count(), 0);
  await page.tap(square(56));
  assert.deepEqual(await page.locator(".ck-sq.end").evaluateAll((els) => els.map((e) => Number(e.dataset.sq))), [28], "where the jump ends is marked");
  await page.screenshot({ path: `${ARTIFACTS}/checkers-10-jump-end-marked-dark.png`, fullPage: true });
  const n = await moveCount(page);
  await page.tap(square(28)); // the last landing square plays the whole jump
  await waitForState(page, (ddp, k) => ddp.match.state.moves.length > k, n);
  // The quick robot may have answered already: read the jump by its place.
  assert.deepEqual(await page.evaluate((k) => window.ddp.match.state.moves[k], n), [56, 42, 28]);
  // Its answer reaches both boards before they're compared.
  await waitForState(page, (ddp, k) => [ddp.match, ddp.robot.match].every((m) => m.state.moves.length === k + 2), n);
  assert.deepEqual(await page.evaluate(() => window.ddp.match.state.board), await page.evaluate(() => window.ddp.robot.match.state.board));
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assertNoErrors();
});

test("the robot moves first on a plain-http page without WebCrypto (http://0.0.0.0, a LAN IP)", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  // Browsers only give secure origins (https, localhost) crypto.subtle.
  const page = await open("player", {
    init: () => {
      Object.defineProperty(Crypto.prototype, "subtle", { get: () => undefined });
      localStorage.setItem("ddp-checkers-settings", JSON.stringify({ moveSeconds: 0, gameSeconds: 0, first: "guest", level: "hard" }));
    },
  });
  await page.goto(`${srv.base}/checkers/`);
  assert.equal(await page.evaluate(() => crypto.subtle), undefined);
  await page.click("#play-robot");
  await waitForState(page, (ddp) => ddp.match?.state?.moves.length === 1);
  assert.equal(await page.evaluate(() => window.ddp.match.state.first), 1, "the robot started");
  assert.equal(await page.locator("#ck-status").innerText(), "Your turn.");
  await playPath(page, await nextPath(page, "first"), "click");
  await waitForState(page, (ddp) => ddp.match.state.moves.length === 3);
  assertNoErrors();
});

test("moves play a wooden clack, and the mute button silences them", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  // Count the oscillators started (one per clack) and remember the context
  // state. At a player's pace, so my clacks are counted before the robot answers.
  const page = await open("player", {
    robotPace: 1,
    init: () => {
      window.soundLog = { clacks: 0, state: null };
      const proto = BaseAudioContext.prototype;
      const create = proto.createOscillator;
      proto.createOscillator = function (...args) {
        window.soundLog.clacks++;
        window.soundLog.state = this.state;
        return create.apply(this, args);
      };
      localStorage.setItem("ddp-checkers-settings", JSON.stringify({ moveSeconds: 0, gameSeconds: 0, first: "host", level: "easy" }));
    },
  });
  await page.goto(`${srv.base}/checkers/`);
  await page.click("#play-robot");
  await waitForState(page, (ddp) => ddp.match?.canMove());
  const clacks = () => page.evaluate(() => window.soundLog.clacks);
  assert.equal(await clacks(), 0, "nothing plays before a move");

  // My move, then the robot's: each lands with a clack.
  await playPath(page, await nextPath(page, "first"), "click");
  await waitForState(page, () => window.soundLog.clacks >= 1);
  assert.equal(await page.evaluate(() => window.soundLog.state), "running");
  const afterMine = await clacks();
  await waitForState(page, (ddp) => ddp.match.canMove());
  assert.ok((await clacks()) > afterMine, "the robot's move sounds too");

  // Muted from the header: moves are silent.
  await page.click("#sound-toggle");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  const muted = await clacks();
  const n = await moveCount(page);
  await playPath(page, await nextPath(page, "first"), "click");
  await waitForState(page, (ddp, k) => ddp.match.state.moves.length >= k + 2 && ddp.match.canMove(), n);
  assert.equal(await clacks(), muted, "no sound while muted");
  assertNoErrors();
});

test("a move dot stays centred on a square where a piece was just captured", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("player", { init: () => localStorage.setItem("ddp-checkers-settings", JSON.stringify({ moveSeconds: 0, gameSeconds: 0, first: "host", level: "easy" })) });
  await page.goto(`${srv.base}/checkers/`);
  await page.click("#play-robot");
  await waitForState(page, (ddp) => ddp.match?.canMove());
  // The robot just jumped 19 -> 33 over my man on 26; my man on 40 can now jump to 26.
  await page.evaluate(() => {
    const board = Array(64).fill(-1);
    Object.assign(board, { 33: 1, 40: 0, 42: 0, 10: 1, 62: 0 });
    for (const match of [window.ddp.match, window.ddp.robot.match]) {
      match.state.board = board.slice();
      match.state.moves = [[19, 33]];
    }
    window.ddp.match.emit("update");
  });
  assert.equal(await page.locator(`${square(26)} .piece.ghost`).count(), 1, "the captured man fades out");
  await page.click(square(40));
  const layout = await page.evaluate(() => {
    const cell = document.querySelector('.ck-sq[data-sq="26"]');
    const box = (r) => [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
    return {
      target: cell.classList.contains("target"),
      rows: getComputedStyle(cell).gridTemplateRows.split(" ").length,
      dotArea: getComputedStyle(cell, "::after").gridArea,
      cell: box(cell.getBoundingClientRect()),
      ghost: box(cell.querySelector(".piece.ghost").getBoundingClientRect()),
    };
  });
  assert.ok(layout.target);
  assert.equal(layout.rows, 1, "the ghost and the dot share one grid cell");
  assert.match(layout.dotArea, /^1 \/ 1/);
  assert.deepEqual(layout.ghost, layout.cell, "and both sit in the middle of the square");
  assertNoErrors();
});
