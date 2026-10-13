// Sea Battle's tutorial lessons (see engine/tutorial.js). The tutorial runs
// in the page: both fleets are fixed here and teal's is known to it, so the
// fair-play commitments don't come into it. A position is your fleet, teal's
// fleet (enemy) and the squares you have already fired at (shots); without
// an enemy you are still placing ships. Ships are rules.js's { r, c, len,
// vertical }. Moves are { type: "place", ship, r, c, vertical } (ship is its
// index in your fleet) and { type: "fire", target }. Cells are squares of
// teal's waters, and "m" + square on your own board.
import { idx, shipCells } from "./rules.js";

const ship = (r, c, len, vertical = false) => ({ r, c, len, vertical });
// Carrier A1–E1, Battleship H3–H6, Cruisers A5–A7 and C9–E9, Destroyer E6–F6.
const FLEET = [ship(0, 0, 5), ship(2, 7, 4, true), ship(4, 0, 3, true), ship(8, 2, 3), ship(5, 4, 2)];
// Carrier B2–F2, Battleship I4–I7, Cruisers C6–E6 and F9–H9, Destroyer G6–G7.
const ENEMY = [ship(1, 1, 5), ship(3, 8, 4, true), ship(5, 2, 3), ship(8, 5, 3), ship(5, 6, 2, true)];
const at = (r, c) => idx(r, c);
const mine = (r, c) => `m${idx(r, c)}`;
const fire = (target) => ({ type: "fire", target });
const sunk = (...ships) => ships.flatMap((k) => shipCells(ENEMY[k]));

export const lessons = [
  {
    title: "Placing your fleet",
    steps: [
      {
        text: "Before the battle you place your five ships on your own board, where only you can see them. Ships can't touch side by side. Drag the Destroyer along the arrow onto the lit squares.",
        position: { fleet: FLEET },
        highlight: [mine(5, 4), mine(5, 5), mine(2, 3), mine(2, 4)],
        arrows: [[mine(5, 4), mine(2, 3)]],
        expect: { type: "place", ship: 4, r: 2, c: 3, vertical: false },
      },
      {
        text: "The ship you moved stays picked: tap it to turn it. Turn the Destroyer upright.",
        highlight: [mine(2, 3), mine(3, 3)],
        expect: { type: "place", ship: 4, r: 2, c: 3, vertical: true },
      },
    ],
  },
  {
    title: "Firing",
    steps: [
      {
        text: "Now you take turns firing at each other's fleets, hidden in each player's waters. Tap the lit square in teal's waters to fire.",
        position: { fleet: FLEET, enemy: ENEMY, shots: [] },
        highlight: [at(4, 4)],
        expect: fire(at(4, 4)),
        reply: fire(at(7, 7)),
      },
      {
        text: "A splash is a miss, and the turn passes: teal fired back and missed you too. Your turn: fire at any square you like.",
        expect: { type: "fire" },
      },
    ],
  },
  {
    title: "Hits and misses",
    steps: [
      {
        text: "A hit shows a flame, and you fire again. Fire at the lit square.",
        position: { fleet: FLEET, enemy: ENEMY, shots: [] },
        highlight: [at(4, 8)],
        expect: fire(at(4, 8)),
      },
      {
        text: "Ships lie in a straight line, across or down. Try the square to the left of your hit.",
        highlight: [at(4, 7)],
        expect: fire(at(4, 7)),
        reply: fire(at(9, 9)),
      },
      {
        text: "A miss, so teal fired, and missed. Nothing to the left: try below your hit.",
        highlight: [at(5, 8)],
        expect: fire(at(5, 8)),
      },
    ],
  },
  {
    title: "Sinking a ship",
    steps: [
      {
        text: "Hit every square of a ship to sink it. You've hit teal's Destroyer once: finish it below.",
        position: { fleet: FLEET, enemy: ENEMY, shots: [at(5, 6)] },
        highlight: [at(5, 6), at(6, 6)],
        expect: fire(at(6, 6)),
      },
      {
        text: "A sunk ship shows, and the water round it is marked clear, since ships never touch side by side. Sinking ends your turn. Sink teal's last ship to win.",
        position: { fleet: FLEET, enemy: ENEMY, shots: [...sunk(0, 1, 2, 4), at(8, 5), at(8, 6)] },
        highlight: [at(8, 5), at(8, 6), at(8, 7)],
        expect: fire(at(8, 7)),
      },
    ],
  },
];
