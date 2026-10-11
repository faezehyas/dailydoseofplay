// Chess piece art, shared by the game (main.js) and its tutorial
// (tutorial.js), and the promotion picker's options.
import { el } from "../engine/shell.js";
import { colorOf, typeOf, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from "./rules.js";

export const COLOR_NAMES = ["White", "Black"];
export const PIECE_NAMES = ["", "pawn", "knight", "bishop", "rook", "queen", "king"];
const PROMOS = [["q", QUEEN], ["r", ROOK], ["b", BISHOP], ["n", KNIGHT]];

// Original piece art on a 100×100 grid; class "d" is a detail line, "e" an eye.
const BASE = '<path d="M24 78h52a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4v-2a4 4 0 0 1 4-4z"/>';
const SHAPES = {
  [PAWN]: '<path d="M41 46h18l9 32H32z"/><ellipse cx="50" cy="46" rx="13" ry="4.5"/><circle cx="50" cy="30" r="12"/>',
  [KNIGHT]:
    '<path d="M30 78c0-12 5-20 14-26-5 2-10 5-14 8l-8-8c3-12 10-21 20-26l4-10 6 8c14 3 22 17 20 54z"/><path class="d" d="M55 31c6 7 9 15 10 26"/><circle class="e" cx="38" cy="38" r="2.6"/>',
  [BISHOP]:
    '<path d="M40 64h20l8 14H32z"/><path d="M37 57h26l-2 7H39z"/><path d="M50 17c11 9 17 19 17 28 0 7-7 12-17 12s-17-5-17-12c0-9 6-19 17-28z"/><circle cx="50" cy="13" r="5"/><path class="d" d="M56 29 47 41"/>',
  [ROOK]: '<path d="M33 42h34l-3 36H36z"/><path d="M28 20h10v8h6v-8h12v8h6v-8h10v22H28z"/>',
  [QUEEN]:
    '<path d="M30 70h40l6 8H24z"/><path d="M28 63h44l-2 7H30z"/><path d="M28 63 21 32l12 15 4-21 10 19 3-22 3 22 10-19 4 21 12-15-7 31z"/><circle cx="21" cy="32" r="4"/><circle cx="37" cy="26" r="4"/><circle cx="50" cy="22" r="4"/><circle cx="63" cy="26" r="4"/><circle cx="79" cy="32" r="4"/>',
  [KING]:
    '<path d="M30 70h40l6 8H24z"/><path d="M28 62h44l-2 8H30z"/><path d="M28 62c-6-12-2-26 11-27 5 0 8 3 11 7 3-4 6-7 11-7 13 1 17 15 11 27z"/><path d="M47 9h6v7h7v6h-7v12h-6V22h-7v-6h7z"/>',
};
export const pieceSvg = (piece) => `<svg viewBox="6 3 88 88" class="pc ${colorOf(piece) ? "b" : "w"}" aria-hidden="true">${SHAPES[typeOf(piece)]}${BASE}</svg>`;
export const pieceName = (piece) => `${COLOR_NAMES[colorOf(piece)].toLowerCase()} ${PIECE_NAMES[typeOf(piece)]}`;

// The four pieces a pawn of `color` can become; pick(letter) gets the choice.
export function promoOptions(color, pick) {
  return el(
    "div",
    { class: "promo-options" },
    PROMOS.map(([letter, type]) => {
      const btn = el("button", { type: "button", class: "promo-opt", dataset: { promo: letter }, "aria-label": PIECE_NAMES[type], onclick: () => pick(letter) });
      btn.innerHTML = `${pieceSvg((color << 3) | type)}<span>${PIECE_NAMES[type]}</span>`;
      return btn;
    }),
  );
}
