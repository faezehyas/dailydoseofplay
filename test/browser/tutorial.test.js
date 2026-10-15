// Headless-browser test for the tutorials (engine/tutorial.js): the first
// Chess lesson played by keyboard on a 360 px phone, with a wrong move that
// springs back, a second one that brings the hint, and a tick saved for the
// finished lesson; the Learn button and Back; Tic Tac Toe's last lesson,
// whose end screen starts a robot game; how a highlight looks, in light and
// dark, with and without motion; and the first lesson of Connect 4
// (by keyboard), Gomoku, Checkers, Dots and Boxes, Backgammon, Sea Battle,
// Chutes and Ladders, Ludo, Crazy Eights, Go Fish, Gin Rummy and Hearts.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser, waitForState, noHorizontalScroll } from "../helpers.js";

const skip = skipWithoutPlaywright();

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
// A step waits for the last move to play out, as long as a ladder or a spin of 6 takes in the game.
const step = (page, text) => page.waitForSelector(`.tut-step:text-is("${text}")`, { timeout: 15_000 });

test("the first Chess lesson by keyboard: a wrong move springs back, the second brings the hint, and the tick is saved", { skip, timeout: 90_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  // Counts the pieces that spring back.
  const countSprings = () => {
    window.springs = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.classList.contains("art")) window.springs++;
      return animate.apply(this, args);
    };
  };
  const page = await open("player", { viewport: { width: 360, height: 740 }, init: countSprings });

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
  await page.waitForSelector(".tut-check:not([hidden])", { timeout: 2000 }); // a check mark once the rook lands
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
  assertNoErrors();
});

test("Tic Tac Toe's last lesson ends with Play the robot now, which starts a robot game", { skip, timeout: 60_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("player", { viewport: { width: 360, height: 740 } });
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
  await waitForState(page, (ddp) => ddp.match?.phase === "playing");
  assert.equal(new URL(page.url()).search, "", "?learn is dropped");
  assertNoErrors();
});

// How each lit cell looks, beside the primary buttons' coral.
const looks = (page, selector) =>
  page.locator(selector).evaluateAll((nodes) => {
    const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: "background: var(--accent)" }));
    const primary = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return nodes.map((node) => {
      const s = getComputedStyle(node);
      return { filled: s.backgroundColor === primary, outline: s.outlineStyle, outlineWidth: parseFloat(s.outlineWidth), outlineColor: s.outlineColor, animation: s.animationName, lit: node.classList.contains("celebrate-lit") };
    });
  });

test("Tutorial highlights ring a square, never fill it: the hint is dashed, a finished line lights up as at the win", { skip, timeout: 90_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  for (const [colorScheme, width, reducedMotion] of [["light", 360, "no-preference"], ["dark", 1280, "reduce"]]) {
    const page = await open(colorScheme, { viewport: { width, height: 800 }, colorScheme, reducedMotion });
    await page.goto(`${srv.base}/tic-tac-toe/?learn`);
    await page.locator(".tut-lesson").nth(1).click();
    await step(page, "Step 1 of 3");
    const lit = await looks(page, ".tut-lit");
    assert.equal(lit.length, 2, "the two Xs are lit");
    for (const cell of lit) assert.deepEqual([cell.filled, cell.outline], [false, "solid"], `${colorScheme}: a lit cell is ringed`);

    // Two wrong tries bring the hint on the square to play.
    for (let i = 0; i < 2; i++) {
      await page.click('.tut-stage .ttt-cell[data-i="8"]');
      await page.waitForFunction((n) => document.querySelector("#tut-feedback").textContent && document.querySelectorAll(".tut-hint").length === n, i);
    }
    const [hint] = await looks(page, ".tut-hint");
    assert.equal(hint.filled, false, `${colorScheme}: the hint doesn't fill its square with the primary colour`);
    assert.equal(hint.outline, "dashed", `${colorScheme}: the hint has a dashed ring`);
    assert.ok(hint.outlineWidth >= 2);
    assert.equal(hint.animation === "none", reducedMotion === "reduce", `${colorScheme}: the hint pulses only with motion`);
    await page.locator(".tut-stage").screenshot({ path: `${ARTIFACTS}/tutorial-hint-${colorScheme}.png` });

    // The finished row lights up as the game's win does, with an outline of its own.
    await page.click('.tut-stage .ttt-cell[data-i="2"]');
    await page.waitForFunction(() => document.querySelectorAll(".tut-result").length === 3);
    const result = await looks(page, ".tut-result");
    for (const cell of result) {
      assert.equal(cell.filled, false, `${colorScheme}: a finished line doesn't fill its squares with the primary colour`);
      assert.equal(cell.lit, true, "lit as celebrate() lights a win");
      assert.equal(cell.outline, "solid", `${colorScheme}: the result has a solid outline`);
      assert.ok(cell.outlineWidth >= 2);
      assert.notEqual(cell.outlineColor, hint.outlineColor, "the result and the hint differ in colour too");
      assert.equal(cell.animation === "none", reducedMotion === "reduce", `${colorScheme}: it lights up without motion when motion is reduced`);
    }
    await page.locator(".tut-stage").screenshot({ path: `${ARTIFACTS}/tutorial-result-${colorScheme}.png` });
  }
  assertNoErrors();
});

// Opens a game's first lesson on a 360 px phone, plays it with `moves`, and
// checks the lesson is saved as done with no errors and no sideways scroll.
async function firstLesson(t, slug, moves) {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const page = await open("player", { viewport: { width: 360, height: 740 } });
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
  assertNoErrors();
}

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

test("Backgammon's first lesson: a 3 and a 1 make a point, then one checker takes 6 and 5", { skip, timeout: 60_000 }, (t) => {
  const tap = (page, n) => page.click(`.tut-stage .bg-cell[data-n="${n}"]`);
  return firstLesson(t, "backgammon", [
    async (page) => {
      for (const n of [8, 5, 6]) await tap(page, n);
      assert.equal(await page.locator(".tut-stage .die.used").count(), 1, "the 3 is played");
      await tap(page, 5);
      await page.click(".tut-stage button:text-is('Confirm')");
    },
    async (page) => {
      assert.equal(await page.locator(".tut-stage .die:not(.used)").count(), 2, "a fresh roll");
      for (const n of [24, 18, 13]) await tap(page, n);
      await page.click(".tut-stage button:text-is('Confirm')");
    },
  ]);
});

test("Sea Battle's first lesson: the Destroyer is dragged to the lit squares, then turns upright", { skip, timeout: 60_000 }, (t) => {
  const centre = async (page, i) => {
    const b = await page.locator(`.tut-stage .own .cell[data-i="${i}"]`).boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  return firstLesson(t, "sea-battle", [
    async (page) => {
      const [x0, y0] = await centre(page, 54);
      const [x1, y1] = await centre(page, 23);
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 8 });
      await page.mouse.up();
    },
    async (page) => {
      assert.equal(await page.locator(".tut-stage .ship.selected").count(), 1, "the moved Destroyer stays picked");
      await page.locator('.tut-stage .own .ship[data-k="4"]').click();
    },
  ]);
});

test("Chutes and Ladders' first lesson: two spins with the fixed numbers", { skip, timeout: 60_000 }, (t) =>
  firstLesson(t, "chutes-and-ladders", [
    (page) => page.click(".tut-stage .cl-spin-btn"),
    async (page) => {
      assert.equal(await page.locator(".tut-stage .cl-spin-value").textContent(), "6", "the spinner stopped on the lesson's 6");
      await page.click(".tut-stage .cl-spin-btn");
    },
  ]));

test("Ludo's first lesson: roll a 6 to bring a token out, then roll a 4 to move it on", { skip, timeout: 60_000 }, (t) => {
  const tap = (page, token) => page.click(`.tut-stage .hit-token[data-token="${token}"]`);
  return firstLesson(t, "ludo", [
    async (page) => {
      await page.click(".tut-stage .ld-roll");
      await tap(page, 0);
    },
    async (page) => {
      await page.click(".tut-stage .ld-roll");
      await page.waitForSelector(".tut-stage .hit-token");
      assert.equal(await page.locator(".tut-stage .ld-die .face").getAttribute("data-value"), "4", "the lesson's 4");
      await tap(page, 0);
    },
  ]);
});

// A card in the tutorial's hand: a slot is its face in the lesson deck ("10H" -> the ten of hearts).
const hcard = (page, name) => {
  const face = "SHDC".indexOf(name.at(-1)) * 13 + ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(name.slice(0, -1));
  return page.locator(`.tut-stage .pc-hcard[data-slot="${face}"]`);
};

test("Crazy Eights' first lesson: a heart on the 9♥, then a king on teal's king", { skip, timeout: 60_000 }, (t) =>
  firstLesson(t, "crazy-eights", [
    (page) => hcard(page, "4H").click(),
    async (page) => {
      assert.match(await page.locator(".tut-stage #ce-pile").getAttribute("aria-label"), /K♥ on top/, "teal played back");
      await hcard(page, "KS").click();
    },
  ]));

test("Go Fish's first lesson: ask for 7s, teal hands one over, then ask for Kings", { skip, timeout: 60_000 }, (t) => {
  const ask = async (page, name) => {
    await hcard(page, name).click();
    await page.click(".tut-stage #gf-ask");
  };
  return firstLesson(t, "go-fish", [
    (page) => ask(page, "7S"),
    async (page) => {
      assert.equal(await hcard(page, "7D").count(), 1, "teal handed over the 7♦");
      await ask(page, "KC");
    },
  ]);
});

test("Gin Rummy's first lesson: the 7♦ from the pile makes a set, then two taps throw the K♦", { skip, timeout: 60_000 }, (t) => {
  // Cards in the hand overlap: tap each on its uncovered left edge.
  const tap = (page, name) => hcard(page, name).click({ position: { x: 7, y: 24 } });
  return firstLesson(t, "gin-rummy", [
    (page) => page.click(".tut-stage #gr-pile"),
    async (page) => {
      assert.equal(await page.locator(".tut-stage .gr-hcard.taken.inmeld").count(), 1, "the 7♦ joined a meld, marked as just taken");
      await tap(page, "KD");
      await page.waitForSelector('.tut-stage #gr-discard:text-is("Discard the K♦")');
      await tap(page, "KD");
    },
  ]);
});

test("Hearts' first lesson: the A♦ takes violet's diamond trick, then you lead a club", { skip, timeout: 60_000 }, (t) =>
  firstLesson(t, "hearts", [
    (page) => hcard(page, "AD").click(),
    async (page) => {
      assert.equal(await page.locator(".tut-stage .hr-me-row .pc-won .n").textContent(), "3", "you took the trick");
      await hcard(page, "9C").click();
    },
  ]));
