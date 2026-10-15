// Shared by the Ludo browser tests: the page helpers.
export const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
export const state = (page) => page.evaluate(() => window.ddp.match.state);
// Where this screen draws the yard of a colour: its label's place on the board.
export const yardCorner = (page, color) =>
  page.evaluate((c) => {
    const t = document.querySelector(`.yard-label.c-${c} .yard-mark`).transform.baseVal[0].matrix;
    return `${t.f > 300 ? "bottom" : "top"} ${t.e > 300 ? "right" : "left"}`;
  }, color);
// The result box is in view without scrolling.
export const resultInView = (page) =>
  page.evaluate(() => {
    const r = document.querySelector("#result-panel").getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  });

// Plays this page's turns in the page itself: rolls, and picks a random movable token.
export function autoplay(page) {
  return page.evaluate(() => {
    clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => {
      const roll = document.querySelector("#ld-roll");
      if (roll && !roll.disabled) roll.click();
      const tokens = document.querySelectorAll(".hit-token");
      if (tokens.length) tokens[Math.floor(Math.random() * tokens.length)].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, 10);
  });
}
export const stopAutoplay = (page) => page.evaluate(() => clearInterval(window.__autoplay));
