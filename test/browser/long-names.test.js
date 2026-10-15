// Headless-browser test: the longest one-word nicknames stay on a phone
// screen in a friend game of tic-tac-toe. body has overflow-x: hidden, so a
// line that runs off the edge is clipped, not scrollable: scrollWidth can't
// see it, and an element's box can stay inside while its text spills out.
// So the checks measure the text itself, with a Range. Skips if Playwright
// is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutPlaywright, openBrowser, waitForState, joinByInvite } from "../helpers.js";
import { NAME_MAX } from "../../public/engine/names.js";

const skip = skipWithoutPlaywright();
const LONG = "W".repeat(NAME_MAX);

// Where the text of `selector` lies on screen, and whether it is cut short with an ellipsis.
const textSpan = (page, selector) =>
  page.locator(selector).evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const { left, right } = range.getBoundingClientRect();
    return { text: node.textContent, left, right, width: innerWidth, ellipsis: getComputedStyle(node).textOverflow === "ellipsis" };
  });

async function assertOnScreen(page, selector) {
  const t = await textSpan(page, selector);
  assert.ok(t.left >= 0 && t.right <= t.width, `${selector} "${t.text}" spans ${Math.round(t.left)}..${Math.round(t.right)} on a ${t.width} px screen`);
}

test("a 20-letter nickname stays on a 360 px screen in the status, note and rematch lines", { skip, timeout: 90_000 }, async (t) => {
  const { srv, open: openPage, assertNoErrors } = await openBrowser(t);
  const open = (name) => openPage(name, { nickname: LONG, viewport: { width: 360, height: 780 }, hasTouch: true });

  const host = await open("host");
  await host.goto(`${srv.base}/tic-tac-toe/`);
  const guest = await open("guest");
  await joinByInvite(host, guest, srv);
  const pages = [host, guest];
  for (const page of pages) await waitForState(page, (ddp) => ddp.match?.phase === "playing");

  // The player waiting sees "<name> is thinking…", and the coin toss names whoever starts.
  const first = await host.evaluate(() => window.ddp.match.state.turn);
  const [mover, waiter] = first === 0 ? [host, guest] : [guest, host];
  assert.match(await waiter.locator("#ttt-status").innerText(), new RegExp(`^${LONG} is thinking`));
  assert.match(await waiter.locator("#ttt-note").innerText(), new RegExp(`${LONG} starts`));
  for (const page of pages) {
    await assertOnScreen(page, "#ttt-status");
    await assertOnScreen(page, "#ttt-note");
  }

  // The scoreboard label for the opponent is cut short instead.
  const label = await textSpan(waiter, "#score .theirs dt");
  assert.ok(label.ellipsis, "the opponent's score label ends in an ellipsis");
  const box = await waiter.locator("#score .theirs dt").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 360, "the score label's box is on screen");

  // The first player lines up the top row: "<name> wins this round."
  const cells = [0, 3, 1, 4, 2];
  for (let k = 0; k < cells.length; k++) {
    const page = k % 2 === 0 ? mover : waiter;
    await waitForState(page, (ddp) => ddp.match.canMove());
    await page.tap(`.ttt-cell[data-i="${cells[k]}"]`);
    await waitForState(page, (ddp, n) => ddp.match.state.moves.length === n, k + 1);
  }
  for (const page of pages) await waitForState(page, (ddp) => ddp.match.phase === "over");
  assert.match(await waiter.locator("#ttt-status").innerText(), new RegExp(`^${LONG} wins`));
  await assertOnScreen(waiter, "#ttt-status");

  // A rematch request: "<name> wants a rematch!"
  await mover.click("#rematch");
  await waiter.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await assertOnScreen(waiter, "#rematch-status");
  await assertOnScreen(mover, "#rematch-status");
  assertNoErrors();
});
