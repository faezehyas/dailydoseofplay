// Headless-browser test for the tutorials (engine/tutorial.js): the first
// Chess lesson played by keyboard on a 360 px phone, with a wrong move that
// springs back, a second one that brings the hint, and a tick saved for the
// finished lesson; the Learn button and Back; Tic Tac Toe's last lesson,
// whose end screen starts a robot game; and the first lesson of Connect 4
// (by keyboard), Gomoku, Checkers and Dots and Boxes. Skips if Playwright is
// missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";
import { noHorizontalScroll, pw } from "./ludo.shared.js";

const sq = (name) => (Number(name[1]) - 1) * 8 + "abcdefgh".indexOf(name[0]);
const square = (page, name) => page.locator(`.tut-stage .sq[data-sq="${sq(name)}"]`);
const ROOK = "4"; // a white rook in rules.js

// Moves focus over the board with the arrow keys, then presses Enter there.
async function press(page, name) {
  const at = await page.evaluate(() => Number(document.activeElement.dataset.sq));
  const target = sq(name);
  const files = (target & 7) - (at & 7);
  const ranks = (target >> 3) - (at >> 3);
  for (let i = 0; i < Math.abs(files); i++) await page.keyboard.press(files > 0 ? "ArrowRight" : "ArrowLeft");
  for (let i = 0; i < Math.abs(ranks); i++) await page.keyboard.press(ranks > 0 ? "ArrowUp" : "ArrowDown");
  assert.equal(await page.evaluate(() => Number(document.activeElement.dataset.sq)), target, `focus on ${name}`);
  await page.keyboard.press("Enter");
}
const move = async (page, from, to) => (await press(page, from), await press(page, to));
const feedback = (page) => page.locator("#tut-feedback").textContent();
const step = (page, text) => page.waitForSelector(`.tut-step:text-is("${text}")`, { timeout: 5000 });

test("the first Chess lesson by keyboard: a wrong move springs back, the second brings the hint, and the tick is saved", { skip: !pw && "Playwright not installed", timeout: 90_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  // Counts the pieces that spring back.
  await page.addInitScript(() => {
    window.springs = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.classList.contains("art")) window.springs++;
      return animate.apply(this, args);
    };
  });

  // The lobby's Learn button opens the lesson list on a page of its own; Back returns.
  await page.goto(`${srv.base}/chess/`);
  await page.click("#learn");
  await page.waitForSelector("#tut-lessons-list");
  assert.match(page.url(), /\/chess\/\?learn$/);
  assert.equal(await page.locator(".tut-lesson").count(), 6);
  await page.goBack();
  await page.waitForSelector("#play-robot");
  assert.equal(await page.locator("#tut-lessons-list").count(), 0, "Back leaves the tutorial");

  // A shared link opens it directly. Enter on the first lesson starts it.
  await page.goto(`${srv.base}/chess/?learn`);
  await page.locator(".tut-lesson").first().focus();
  await page.keyboard.press("Enter");
  await step(page, "Step 1 of 3");
  assert.equal(await page.evaluate(() => document.activeElement.tagName), "H1", "focus moves to the lesson's title");
  assert.equal(await page.locator("#tut-text").getAttribute("role"), "status", "the step is read out");
  assert.match(await page.locator("#tut-text").textContent(), /rook slides/);
  assert.equal(await page.locator(".tut-lit").count(), 2, "the rook and its square are lit");
  assert.equal(await page.locator(".tut-arrows .tut-arrow").count(), 1, "an arrow shows the way");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.matches(".tut-stage .sq")), true, "Tab reaches the board");

  // A legal move that isn't the lesson's springs back; no hint yet.
  await move(page, "d4", "d5");
  assert.match(await feedback(page), /isn't the one this step asks for\. Try again\./);
  assert.equal(await square(page, "d4").getAttribute("data-p"), ROOK, "the rook is back on d4");
  assert.equal(await square(page, "d5").getAttribute("data-p"), "0");
  assert.equal(await page.evaluate(() => window.springs), 1, "it sprang back");
  assert.equal(await page.locator(".tut-hint").count(), 0);

  // A second wrong try, against the rules this time: the rules say why, and the hint lights the move.
  await move(page, "d4", "e5");
  assert.match(await feedback(page), /That piece can't move there\. Hint:/);
  assert.equal(await page.evaluate(() => window.springs), 2);
  assert.deepEqual(
    await page.locator(".tut-hint").evaluateAll((nodes) => nodes.map((n) => Number(n.dataset.sq)).sort((a, b) => a - b)),
    [sq("a4"), sq("d4")],
  );
  assert.ok(await noHorizontalScroll(page), "no sideways scroll at 360 px");

  // The right moves: a check mark, then the next step.
  await move(page, "d4", "a4");
  assert.equal(await feedback(page), "Right!");
  assert.equal(await page.locator(".tut-check:not([hidden])").count(), 1, "a check mark");
  assert.equal(await square(page, "a4").getAttribute("data-p"), ROOK);
  await step(page, "Step 2 of 3");
  await move(page, "c1", "h6");
  await step(page, "Step 3 of 3");
  await move(page, "d1", "a4");
  await page.waitForSelector("#tut-next");
  assert.equal(await page.evaluate(() => document.activeElement.id), "tut-next", "Next lesson takes focus");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("ddp-lessons"))), { chess: [0] });

  // The tick shows in the list, and is still there after a reload.
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    else await page.click("#tut-lessons");
    await page.waitForSelector("#tut-lessons-list");
    const done = await page.locator(".tut-lesson").evaluateAll((nodes) => nodes.map((n) => n.dataset.done));
    assert.deepEqual(done, ["true", "false", "false", "false", "false", "false"]);
    assert.match(await page.locator(".tut-lesson").first().textContent(), /, done$/);
    assert.equal(await page.locator("#tut-summary").textContent(), "1 of 6 done");
  }
  assert.deepEqual(errors, []);
});

test("Tic Tac Toe's last lesson ends with Play the robot now, which starts a robot game", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => (globalThis.ddpRobotPace = 0.1));
  await page.goto(`${srv.base}/tic-tac-toe/`);
  // The link at the top of How to play opens the tutorial too.
  await page.click("details.rules > summary");
  await page.click("#learn-link");
  await page.waitForSelector("#tut-lessons-list");
  await page.locator(".tut-lesson").last().click();
  await step(page, "Step 1 of 2");
  await page.click('.tut-stage .ttt-cell[data-i="2"]');
  await step(page, "Step 2 of 2");
  assert.equal(await page.locator('.tut-stage .ttt-cell[data-i="4"]').getAttribute("data-v"), "O", "the teacher played back");
  await page.click('.tut-stage .ttt-cell[data-i="8"]');
  await page.waitForSelector("#tut-end");
  assert.equal(await page.locator("#tut-end").textContent(), "That was the last lesson!", "two lessons were skipped");
  await page.click("#tut-play-robot");
  await page.waitForFunction(() => window.ddp.match?.phase === "playing");
  assert.equal(new URL(page.url()).search, "", "?learn is dropped");
  assert.deepEqual(errors, []);
});

// Opens a game's first lesson on a 360 px phone, plays it with `moves`, and
// checks the lesson is saved as done with no errors and no sideways scroll.
async function firstLesson(t, slug, moves) {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${srv.base}/${slug}/`);
  await page.click("#learn");
  await page.locator(".tut-lesson").first().click();
  await step(page, `Step 1 of ${moves.length}`);
  assert.ok(await noHorizontalScroll(page), "no sideways scroll at 360 px");
  for (const [k, move] of moves.entries()) {
    if (k) await step(page, `Step ${k + 1} of ${moves.length}`);
    await move(page);
  }
  await page.waitForSelector("#tut-next");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("ddp-lessons"))), { [slug]: [0] });
  assert.deepEqual(errors, []);
}

const skip = !pw && "Playwright not installed";

test("Connect 4's first lesson by keyboard: the disc drops, teal stacks on it", { skip, timeout: 60_000 }, (t) =>
  firstLesson(t, "connect-4", [
    async (page) => {
      await page.locator('.tut-stage .c4-col[data-col="0"]').focus();
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await page.waitForSelector('.tut-stage .c4-cell[data-i="31"][data-v="teal"]');
      assert.equal(await page.locator('.tut-stage .c4-cell[data-i="38"]').getAttribute("data-v"), "coral", "the disc fell to the bottom");
    },
    (page) => page.keyboard.press("Enter"),
  ]));

test("Gomoku's first lesson: a stone on the centre point, then one beside it", { skip, timeout: 60_000 }, (t) =>
  firstLesson(t, "gomoku", [
    (page) => page.click('.tut-stage .gmk-cell[data-i="112"]'),
    async (page) => {
      assert.equal(await page.locator('.tut-stage .gmk-cell[data-i="98"]').getAttribute("data-v"), "second", "the teacher played back");
      await page.click('.tut-stage .gmk-cell[data-i="111"]');
    },
  ]));

test("Checkers' first lesson: a man steps forward twice", { skip, timeout: 60_000 }, (t) =>
  firstLesson(t, "checkers", [
    async (page) => {
      await page.click('.tut-stage .ck-sq[data-sq="42"]');
      await page.click('.tut-stage .ck-sq[data-sq="35"]');
    },
    async (page) => {
      assert.equal(await page.locator('.tut-stage .ck-sq[data-sq="14"] .piece.b').count(), 1, "the teacher played back");
      await page.click('.tut-stage .ck-sq[data-sq="35"]');
      await page.click('.tut-stage .ck-sq[data-sq="28"]');
    },
  ]));

test("Dots and Boxes' first lesson: the lit line, then any free one", { skip, timeout: 60_000 }, (t) =>
  firstLesson(t, "dots-and-boxes", [
    (page) => page.click('.tut-stage .hit[data-line="0"]'),
    async (page) => {
      assert.equal(await page.locator('.tut-stage .line.p1[data-l="11"]').count(), 1, "the teacher played back");
      await page.click('.tut-stage .hit[data-line="1"]');
    },
  ]));
