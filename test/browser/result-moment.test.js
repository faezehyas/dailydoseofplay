// Headless-browser test for the result moment (engine/celebrate.js): every
// game, played to the end against the robot, celebrates as its result panel
// opens, with its own chime, and nothing moves with reduced motion; in a
// friend game of Tic Tac Toe each browser plays its own player's moment, and
// nothing plays when muted. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, waitForState, joinByInvite } from "../helpers.js";

const skip = skipWithoutPlaywright();

const GAMES = [
  ["tic-tac-toe", "paper"],
  ["connect-4", "plastic"],
  ["gomoku", "paper"],
  ["chess", "wood"],
  ["checkers", "wood"],
  ["backgammon", "wood"],
  ["sea-battle", "water"],
  ["chutes-and-ladders", "bell"],
  ["dots-and-boxes", "paper"],
  ["ludo", "wood"],
];
// The outcome each title stands for: someone else's win is "over" with more than two players.
const OUTCOME = { "You won": "win", "You lost": "loss", Draw: "draw" };

// Plays this page's side with the game's own robot, at once, until the match ends.
function autoplay(page, slug) {
  return page.evaluate(async (slug) => {
    const { chooseMove } = await import(`/${slug}/robot.js`);
    window.__autoplay = setInterval(() => {
      const match = window.ddp.match;
      if (match.phase === "placing" && !match.locked) document.querySelector("#ready")?.click();
      if (match.canFire?.()) {
        const { weapon, target, dir } = chooseMove(match.state, match.me);
        match.fire(weapon, target, 1, dir);
      } else if (match.canMove?.()) match.play({ ...chooseMove(match.state, match.me), ms: 1 });
    }, 10);
  }, slug);
}

async function playToTheEnd(open, base, slug) {
  const page = await open(slug, {
    viewport: { width: 1200, height: 900 },
    reducedMotion: "reduce",
    init: [
      () => (window.ddpSounds = []),
      // Two robots in the games for up to four, so a robot's win is "over" for you.
      () => localStorage.setItem("ddp-ludo-settings", JSON.stringify({ robots: 2 })),
      () => localStorage.setItem("ddp-cl-settings", JSON.stringify({ robots: 2 })),
    ],
  });
  await page.goto(`${base}/${slug}/?robot=1`);
  await waitForState(page, (ddp) => !!ddp.match);
  await autoplay(page, slug);
  await page.locator("#result-panel.celebrate").waitFor({ timeout: 180_000 });
  await page.evaluate(() => clearInterval(window.__autoplay));
  return page;
}

test("every game celebrates the end of a robot game with its own chime, and nothing moves with reduced motion", { skip, timeout: 900_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  for (const [slug, flavour] of GAMES) {
    const page = await playToTheEnd(open, srv.base, slug);
    const title = await page.locator("#result").innerText();
    const outcome = OUTCOME[title] ?? "over";
    assert.ok(await page.locator(`#result-panel.celebrate-${outcome}`).count(), `${slug}: "${title}" celebrates as ${outcome}`);
    const sounds = await page.evaluate(() => window.ddpSounds);
    assert.deepEqual(sounds.filter((n) => /^(win|loss|draw|over)-/.test(n)), [`${outcome}-${flavour}`], `${slug}: one chime, in its flavour`);
    assert.ok(!sounds.some((n) => /^(win|lose|draw)$/.test(n)), `${slug}: no end tune of its own`);
    const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.animationName?.startsWith("celebrate")).length + document.querySelectorAll(".celebrate-dot").length);
    assert.equal(moving, 0, `${slug}: nothing moves with reduced motion`);
    assertNoErrors();
    await page.context().close();
  }
});

// Plays these cells in turn, each by whichever friend is on move.
async function playCells(pages, cells) {
  for (const cell of cells) {
    const n = await pages[0].evaluate(() => window.ddp.match.state.moves.length);
    const mover = (await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.match.canMove())))).indexOf(true);
    await pages[mover].evaluate((cell) => window.ddp.match.play({ cell, ms: 0 }), cell);
    for (const p of pages) await waitForState(p, (ddp, n) => ddp.match.state.moves.length > n, n);
  }
}

test("in a friend game each browser plays its own moment: the winner's line lights up and dots rise, the loser's board dims, a draw pulses the pills", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const narrow = { viewport: { width: 360, height: 740 }, reducedMotion: "no-preference" };
  const sounds = () => (window.ddpSounds = []);
  const host = await open("host", {
    ...narrow,
    nickname: "Ada",
    init: [sounds, () => localStorage.setItem("ddp-ttt-settings", JSON.stringify({ size: 3, moveSeconds: 0, gameSeconds: 0, first: "host" }))],
  });
  await host.goto(`${srv.base}/tic-tac-toe/`);
  const guest = await open("guest", { ...narrow, nickname: "Bo", colorScheme: "dark", init: sounds });
  await joinByInvite(host, guest, srv);
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match?.phase === "playing");
  // The friend mutes: the moment still shows, without its chime.
  await guest.click("#sound-toggle");
  const chimes = (page) => page.evaluate(() => window.ddpSounds.filter((n) => /^(win|loss|draw|over)-/.test(n)));
  const celebrating = (page) => page.evaluate(() => [...document.querySelectorAll("[class*=celebrate]")].map((n) => n.getAttribute("class").match(/celebrate[-\w]*/g).join(" ")));

  // Ada lines up the top row.
  await playCells([host, guest], [0, 3, 1, 4, 2]);
  await host.locator("#result-panel.celebrate-win").waitFor();
  await guest.locator("#result-panel.celebrate-loss").waitFor();
  assert.deepEqual(
    await host.evaluate(() => [...document.querySelectorAll(".celebrate-lit")].map((n) => [n.dataset.i, n.style.getPropertyValue("--i")])),
    [["0", "0"], ["1", "1"], ["2", "2"]],
    "the winning line lights up cell by cell",
  );
  assert.equal(await host.locator(".celebrate-burst .celebrate-dot").count(), 12, "three sets of the logo's four dots");
  const running = (page) => page.evaluate(() => [...new Set(document.getAnimations().map((a) => a.animationName).filter((n) => n?.startsWith("celebrate")))].sort());
  assert.deepEqual(await running(host), ["celebrate-light", "celebrate-rise"]);
  assert.deepEqual(await chimes(host), ["win-paper"]);
  assert.ok(await guest.locator("#ttt-board.celebrate-dim").count(), "the loser's board dims");
  assert.deepEqual(await running(guest), ["celebrate-dim", "celebrate-fade"]);
  assert.equal(await guest.locator(".celebrate-lit, .celebrate-dot").count(), 0, "no lights or dots for a loss");
  assert.deepEqual(await chimes(guest), [], "nothing plays when muted");
  await host.locator(".celebrate-burst").waitFor({ state: "detached" });

  // A rematch clears the moment; a full board without a line is a draw.
  await host.click("#rematch");
  await guest.click("#rematch");
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match.m === 2 && ddp.match.phase === "playing");
  assert.deepEqual(await celebrating(host), []);
  assert.deepEqual(await celebrating(guest), []);
  await playCells([host, guest], [0, 4, 8, 1, 7, 6, 2, 5, 3]);
  for (const p of [host, guest]) {
    await p.locator("#result-panel.celebrate-draw").waitFor();
    assert.equal(await p.locator(".pb-who.celebrate-pulse").count(), 2, "both pills pulse");
    assert.deepEqual(await running(p), ["celebrate-pulse"]);
  }
  assert.deepEqual(await chimes(host), ["win-paper", "draw-paper"]);
  assert.deepEqual(await chimes(guest), []);
  assertNoErrors();
});
