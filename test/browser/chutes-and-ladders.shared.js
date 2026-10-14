// Shared by the Chutes and Ladders browser tests: the page helpers.
import { waitForState } from "../helpers.js";

export const AUTO_SPIN_DELAY = 700; // as in main.js
export const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
export const state = (page) => page.evaluate(() => window.ddp.match.state);
// Each player's colour on this screen, by name, as the theme token their pill
// swatch and pawn resolve to, so screens in different themes compare.
export const colours = (page) =>
  page.evaluate(() => {
    const root = document.querySelector(".chutes-ladders");
    const resolve = (value) => {
      const i = document.createElement("i");
      i.style.color = value;
      root.append(i);
      const c = getComputedStyle(i).color;
      i.remove();
      return c;
    };
    const token = Object.fromEntries(["--accent", "--accent-2", "--cl-p2", "--cl-p3"].map((v) => [resolve(`var(${v})`), v]));
    return Object.fromEntries(
      [...document.querySelectorAll(".pb-who")].map((n) => {
        const seat = [...n.classList].find((c) => /^p\d$/.test(c));
        const swatch = getComputedStyle(n.querySelector(".swatch")).backgroundColor;
        const pawn = resolve(getComputedStyle(document.querySelector(`.cl-board .pawn.${seat}`)).getPropertyValue("--pawn"));
        return [n.querySelector(".pb-name").textContent.replace(" (you)", ""), `${token[swatch]} ${token[pawn]}`];
      }),
    );
  });

// The board has settled: no spin is being played out on screen.
export const settled = (page) => waitForState(page, () => !document.querySelector("#cl-status")?.textContent.match(/Spinning|spinning|moving|Hop|ladder|chute/i));

// Presses Spin whenever this page may, until the game ends.
export async function spinUntilOver(page, { tap = false, timeout = 120_000 } = {}) {
  const t0 = Date.now();
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    if (Date.now() - t0 > timeout) throw new Error("game did not finish");
    if (await page.locator("#cl-spin").isEnabled()) await (tap ? page.tap("#cl-spin") : page.click("#cl-spin"));
    await page.waitForTimeout(40);
  }
}

// A page set to spin by itself does so a beat after the board settles: jump
// its clock past each beat instead of waiting it out. Needs page.clock.install().
export async function skipAutoSpinBeats(page) {
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    if (await page.locator("#cl-spin").isEnabled()) await page.clock.fastForward(AUTO_SPIN_DELAY);
    else await page.waitForTimeout(40);
  }
}
