// Chutes and Ladders' tutorial lessons (see engine/tutorial.js). A position
// is the square your pawn, coral, stands on (0 is the start, beside square
// 1); you play alone, so every spin is yours. spin is the step's fixed
// number, where the spinner stops. Moves are the game's own { type: "spin" }.
// "spin" names the Spin button, the rest are squares.
const SPIN = { type: "spin" };

export const lessons = [
  {
    title: "Spinning and moving",
    steps: [
      {
        text: "You play coral. Spin, and your pawn hops that many squares, starting from square 1 at the bottom left.",
        position: 0,
        spin: 6,
        highlight: ["spin"],
        expect: SPIN,
      },
      {
        text: "The squares snake: at the end of a row, the next row runs back the other way. Spin again.",
        spin: 5,
        highlight: [10, 11],
        arrows: [[10, 11]],
        expect: SPIN,
      },
    ],
  },
  {
    title: "Climbing a ladder",
    steps: [
      {
        text: "Land on the foot of a ladder and you climb to its top. There's one 3 squares ahead, on 9. Spin.",
        position: 6,
        spin: 3,
        highlight: [9, 31],
        arrows: [[9, 31]],
        expect: SPIN,
      },
    ],
  },
  {
    title: "Sliding down a chute",
    steps: [
      {
        text: "Land on the top of a chute and you slide down to its bottom. Watch out for the one on 47. Spin.",
        position: 44,
        spin: 3,
        highlight: [47, 26],
        arrows: [[47, 26]],
        expect: SPIN,
      },
    ],
  },
  {
    title: "The exact spin to finish",
    steps: [
      {
        text: "The first pawn on 100 wins, and it takes the exact number: from 96, a 4. Spin more and you stay put. Spin.",
        position: 96,
        spin: 6,
        highlight: [100],
        expect: SPIN,
      },
      {
        text: "A 6 was too many, so you stayed on 96. Spin again.",
        spin: 4,
        highlight: [100],
        expect: SPIN,
      },
    ],
  },
];
