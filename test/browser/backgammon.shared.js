// Shared by the Backgammon browser tests: the page helpers.
import assert from "node:assert/strict";
import { waitForState } from "../helpers.js";

export const START = [0, 0, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0];

export const ply = (page) => page.evaluate(() => window.ddp.match.state.ply);
export const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

// Waits for this page's dice to roll themselves, then plays the whole turn by
// tapping (or clicking) checkers and points, and confirms.
export async function playTurnByHand(page, { tap = false } = {}) {
  await waitForState(page, (ddp) => ddp.match.canMove() && ddp.match.state.rolled);
  const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
  const start = await ply(page);
  for (let k = 0; k < 4 && (await page.locator(".bg-cell.src").count()); k++) {
    if (!(await page.locator(".bg-cell.selected").count())) await press(".bg-cell.src >> nth=0");
    await page.locator(".bg-cell.dest").first().waitFor();
    await press(".bg-cell.dest >> nth=0");
  }
  // A turn with no choice in it ends by itself; otherwise you confirm it.
  if (await page.locator("#bg-undo").isEnabled()) {
    assert.ok(await page.locator("#bg-confirm").isEnabled(), "the whole roll is played");
    await press("#bg-confirm");
  }
  await waitForState(page, (ddp, n) => ddp.match.state.ply > n, start);
}

// Robot games only: match m starts from the same position on both sides, to
// reach a race or a forced turn quickly. Call it before the match starts:
// each side's match takes the position as it starts, so the first roll can't
// come before it. Points use each side's own numbering; "bar" is the bar,
// and missing checkers are borne off.
export function setPosition(page, m, mine, theirs) {
  return page.evaluate(async ([m, mine, theirs]) => {
    const side = (spec) => {
      const s = Array(26).fill(0);
      for (const [k, v] of Object.entries(spec)) s[k === "bar" ? 25 : Number(k)] = v;
      s[0] = 15 - s.reduce((a, b) => a + b, 0);
      return s;
    };
    const pos = [side(mine), side(theirs)];
    const { TurnMatch } = await import("/engine/turn-match.js");
    const emit = TurnMatch.prototype.emit;
    TurnMatch.prototype.emit = function (type, ...args) {
      if (type === "start" && this.m === m) this.state.pos = structuredClone(pos);
      return emit.call(this, type, ...args);
    };
  }, [m, mine, theirs]);
}

// Plays this page's side by the robot's choices, at once, until the game ends.
export async function autoplay(page, ms = 20) {
  await page.evaluate(async (ms) => {
    const { chooseMove } = await import("/backgammon/robot.js");
    clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => {
      const match = window.ddp.match;
      if (match.phase !== "playing") return clearInterval(window.__autoplay);
      if (match.canMove()) match.play({ ...chooseMove(match.state, match.me, Math.random, { level: "medium" }), ms });
    }, 10);
  }, ms);
}
