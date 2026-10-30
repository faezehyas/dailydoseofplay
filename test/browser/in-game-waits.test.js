// Headless-browser test for the waits inside a game: three dots in a robot's
// pill once its move takes over 300 ms (and none for a quick one), "<robot>'s
// turn" rather than "is thinking" in every game that said so, and in Crazy
// Eights with a friend one steady status line while the deck is shuffled,
// with a tick in each player's pill once their shuffle is checked.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, joinByInvite, noHorizontalScroll, pick } from "../helpers.js";

const skip = skipWithoutPlaywright();
const GAMES = JSON.parse(readFileSync(new URL("../../public/games.json", import.meta.url), "utf8")).games.filter((g) => g.status === "ready");
const PHONE = { phone: true, colorScheme: "light" };
const DESKTOP = { viewport: { width: 1280, height: 900 }, colorScheme: "dark" };
const ROBOT_DELAY = 600; // Connect 4's robot pause at a player's pace
const robotDots = ".pb-who.theirs.thinking .think";

// Logs, with the time, every move and every time the robot's dots show or hide.
const recordDots = (page) =>
  page.evaluate(() => {
    window.dotsLog = [];
    const pill = document.querySelector(".pb-who.theirs");
    const log = (what) => window.dotsLog.push({ what, at: performance.now(), status: document.querySelector("#c4-status").textContent });
    let on = false;
    new MutationObserver(() => on !== pill.classList.contains("thinking") && log((on = !on) ? "show" : "hide")).observe(pill, { attributes: true, attributeFilter: ["class"] });
    window.ddp.match.on("events", ({ player }) => log(`move ${player}`));
  });

test("a robot's move over 300 ms shows three dots in its pill, and a quick one none", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  for (const [options, name] of [
    [PHONE, "360-light"],
    [DESKTOP, "1280-dark"],
  ]) {
    const page = await open(name, options);
    await page.goto(`${srv.base}/connect-4/`);
    await pick(page, "first", "host");
    await page.click("#play-robot");
    await waitForState(page, (ddp) => ddp.match?.phase === "playing" && ddp.match.canMove());
    await page.locator("#toast.show").waitFor({ state: "detached" }); // it covers the pills
    await recordDots(page);

    // The robot takes 1 s: its dots show from 300 ms after your move until its own.
    await page.evaluate((pace) => (globalThis.ddpRobotPace = pace), 1000 / ROBOT_DELAY);
    await page.click('.c4-col[data-col="3"]');
    await page.locator(robotDots).waitFor();
    await page.screenshot({ path: `${ARTIFACTS}/waits-robot-c4-${name}.png` });
    assert.equal(await page.locator(".pb-who.theirs .think i").count(), 3);
    assert.equal(await page.locator(".pb-who.theirs").innerText(), "Robot", "no words in the pill");
    assert.ok(await noHorizontalScroll(page));
    await waitForState(page, (ddp) => ddp.match.state.moves.length === 2 && ddp.match.canMove());
    let log = await page.evaluate(() => window.dotsLog.splice(0));
    assert.deepEqual(log.map((e) => e.what), ["move 0", "show", "move 1", "hide"]);
    assert.ok(log[1].at - log[0].at >= 295, `the dots wait 300 ms (${Math.round(log[1].at - log[0].at)} ms)`);
    assert.equal(log[1].status, "Robot's turn");

    // A quick move (0.06 s) shows none.
    await page.evaluate(() => (globalThis.ddpRobotPace = 0.1));
    await page.click('.c4-col[data-col="3"]');
    await waitForState(page, (ddp) => ddp.match.state.moves.length === 4 && ddp.match.canMove());
    log = await page.evaluate(() => window.dotsLog.splice(0));
    assert.deepEqual(log.map((e) => e.what), ["move 0", "move 1"]);
    assert.equal(await page.locator(".pb-who.thinking").count(), 0);
    await page.close();
  }
  assertNoErrors();
});

test("no game says a robot is thinking: its turn, and the dots in its pill", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  for (const [slug, status] of [
    ["tic-tac-toe", "#ttt-status"],
    ["connect-4", "#c4-status"],
    ["gomoku", "#gmk-status"],
    ["chess", "#chess-status"],
    ["checkers", "#ck-status"],
  ]) {
    // The robot moves first and takes its time.
    const page = await open(slug, { ...DESKTOP, robotPace: 3 });
    await page.goto(`${srv.base}/${slug}/`);
    await pick(page, "first", "guest");
    await page.click("#play-robot");
    await waitForState(page, (ddp) => ddp.match?.phase === "playing");
    await page.locator(robotDots).waitFor();
    assert.equal(await page.locator(status).innerText(), "Robot's turn", slug);
    await page.close();
  }
  assertNoErrors();
});

test("no game page has a spinner, in its lobby or its game", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("page", PHONE);
  for (const { slug } of GAMES) {
    await page.goto(`${srv.base}/${slug}/`);
    await page.locator("#play-robot").waitFor();
    assert.equal(await page.locator(".spinner").count(), 0, slug);
  }
  assertNoErrors();
});

test("Ludo's robots show the dots in their own pill, in their colour", { skip, timeout: 120_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  for (const [options, name] of [
    [PHONE, "360-light"],
    [DESKTOP, "1280-dark"],
  ]) {
    const page = await open(name, { ...options, robotPace: 2 });
    await page.goto(`${srv.base}/ludo/`);
    await pick(page, "first", "guest");
    await page.click("#play-robot");
    await waitForState(page, (ddp) => ddp.match?.phase === "playing");
    await page.locator("#toast.show").waitFor({ state: "detached" });
    const pill = page.locator(".pb-who.thinking");
    await pill.waitFor();
    assert.match(await pill.innerText(), /^Robot \d/, "a robot's pill");
    assert.match(await pill.getAttribute("class"), /\bactive\b/, "the one whose turn it is");
    const [dot, seat] = await pill.evaluate((p) => [getComputedStyle(p.querySelector(".think i")).backgroundColor, getComputedStyle(p).getPropertyValue("--seat")]);
    assert.equal(dot, await page.evaluate((c) => {
      const probe = document.body.appendChild(Object.assign(document.createElement("i"), { style: `color: ${c}` }));
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    }, seat.trim()), "the dots take the seat's colour");
    assert.doesNotMatch(await page.locator("#ld-status").innerText(), /thinking/);
    assert.ok(await noHorizontalScroll(page));
    await page.screenshot({ path: `${ARTIFACTS}/waits-robot-ludo-${name}.png` });
    await page.close();
  }
  assertNoErrors();
});

// Logs every change to the status line, the ticks and the riffle, with the match's phase.
const recordShuffle = (page) =>
  page.evaluate(() => {
    window.shuffleLog = [];
    const read = () => {
      const status = document.querySelector("#ce-status");
      if (!status) return;
      const row = {
        status: status.textContent,
        phase: window.ddp.match?.phase,
        ticks: document.querySelectorAll(".pb-tick:not([hidden])").length,
        riffle: !!document.querySelector(".ce-riffle:not([hidden])"),
        spinners: document.querySelectorAll(".spinner").length,
      };
      const last = window.shuffleLog.at(-1);
      if (!last || Object.keys(row).some((k) => row[k] !== last[k])) window.shuffleLog.push(row);
    };
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });

test("Crazy Eights with a friend: one steady line while the deck is shuffled, and a tick per player before the deal", { skip, timeout: 180_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const host = await open("host", { nickname: "Ada", ...DESKTOP });
  await host.goto(`${srv.base}/crazy-eights/`);
  await pick(host, "first", "host");
  await joinByInvite(host, [], srv);
  const guest = await open("guest", { nickname: "Bo", ...PHONE });
  await joinByInvite(host, guest, srv);
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  for (const p of [host, guest]) await recordShuffle(p);
  await host.click("#start-game");

  const lines = new Map([
    [host, "Shuffling: you, then Bo. Each browser checks the other's."],
    [guest, "Shuffling: Ada, then you. Each browser checks the other's."],
  ]);
  const showing = (p) => waitForState(p, (_, line) => document.querySelector("#ce-status")?.textContent === line, lines.get(p), { timeout: 60_000, why: "the shuffle line shows" });
  await Promise.all([host, guest].map(showing));
  await host.screenshot({ path: `${ARTIFACTS}/waits-shuffle-ce-1280-dark.png` });
  await guest.screenshot({ path: `${ARTIFACTS}/waits-shuffle-ce-360-light.png` });
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match?.phase === "playing" && ddp.match.state.hands[1].length === 7, undefined, { timeout: 60_000 });
  for (const p of [host, guest]) await waitForState(p, () => !document.querySelector("#ce-status").textContent.startsWith("Shuffling"));
  assert.equal(await host.locator(".pb-tick:not([hidden])").count(), 2, "both pills keep their tick after the deal");
  await host.screenshot({ path: `${ARTIFACTS}/waits-shuffle-dealt-ce-1280-dark.png` });
  await guest.screenshot({ path: `${ARTIFACTS}/waits-shuffle-dealt-ce-360-light.png` });

  for (const p of [host, guest]) {
    const log = await p.evaluate(() => window.shuffleLog);
    const from = log.findIndex((r) => r.status === lines.get(p));
    const dealt = log.findIndex((r) => r.phase === "playing");
    const next = log.findIndex((r, i) => i > from && r.status !== lines.get(p));
    assert.ok(from !== -1 && from < dealt, "the shuffle line shows before the deal");
    assert.ok(next >= dealt, "the status line stays the same from the riffle to the deal");
    assert.ok(log[from].riffle, "the deck riffles while the line shows");
    assert.equal(log[dealt - 1].ticks, 2, "both pills have a tick before the deal");
    assert.ok(log.slice(0, dealt).some((r) => r.ticks === 1), "the ticks come one by one");
    assert.match(log[next].status, /^Shuffle checked\. /, "the line after the deal starts with the shuffle checked");
    assert.equal(Math.max(...log.map((r) => r.spinners)), 0, "no spinner anywhere on the page");
    assert.equal(await p.locator(".ce-busy:not([hidden])").count(), 0);
  }
  // The first move ends the shuffle's words (a card, naming a suit for an 8, or a draw when nothing plays).
  await waitForState(host, (ddp) => ddp.match.log.length > 0 || document.querySelector(".ce-hcard.playable"));
  await host.evaluate(() => {
    document.querySelector(".ce-hcard.playable")?.click();
    document.querySelector("#ce-picker:not([hidden]) .ce-picker-suits button")?.click();
  });
  await waitForState(host, (ddp) => ddp.match.log.length > 0 && !document.querySelector("#ce-status").textContent.startsWith("Shuffle checked."));
  assertNoErrors();
});
