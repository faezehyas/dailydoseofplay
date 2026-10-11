// The board's grid and point names, shared by the game (main.js), its
// tutorial (tutorial.js) and the tutorial's lessons (lessons.js).
import { SIZE } from "./rules.js";

export const COLUMNS = "ABCDEFGHJKLMNOP"; // board coordinates skip I, as on Go boards
const STARS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];

export const pointName = (i) => `${COLUMNS[i % SIZE]}${SIZE - Math.floor(i / SIZE)}`;

export function gridSvg() {
  const lines = [];
  for (let k = 0; k < SIZE; k++) {
    lines.push(`<line x1="0.5" y1="${k + 0.5}" x2="${SIZE - 0.5}" y2="${k + 0.5}"/>`, `<line x1="${k + 0.5}" y1="0.5" x2="${k + 0.5}" y2="${SIZE - 0.5}"/>`);
  }
  const stars = STARS.map(([r, c]) => `<circle cx="${c + 0.5}" cy="${r + 0.5}" r="0.12"/>`).join("");
  return `<svg class="gmk-grid" viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true">${lines.join("")}${stars}</svg>`;
}
