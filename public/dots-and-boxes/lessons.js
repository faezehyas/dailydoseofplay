// Dots and Boxes' tutorial lessons (see engine/tutorial.js). A position is
// the 3 × 3 board drawn in 7 rows: dots ".", drawn lines "-" and "|", and in
// each box "Y" (yours), "T" (teal's) or " ". The learner, coral, draws next.
// Moves are the game's own { line }; at(row, column) is the line at that
// place in the drawing.
const N = 3;
const at = (r, c) => (r % 2 ? N * (N + 1) + ((r - 1) / 2) * (N + 1) + c / 2 : (r / 2) * N + (c - 1) / 2);
const line = (r, c) => ({ line: at(r, c) });

export const lessons = [
  {
    title: "Drawing a line",
    steps: [
      {
        text: "You play coral. Take turns drawing a line between two dots side by side, across or down. Draw the lit line at the top left.",
        position: [". . . .", "       ", ". . . .", "       ", ". . . .", "       ", ". . . ."],
        highlight: [at(0, 1)],
        expect: line(0, 1),
        reply: line(6, 5),
      },
      {
        text: "Teal drew one at the bottom right. Now draw any free line you like.",
        expect: Array.from({ length: 2 * N * (N + 1) }, (_, l) => ({ line: l })).filter(({ line: l }) => l !== at(0, 1) && l !== at(6, 5)),
      },
    ],
  },
  {
    title: "Closing a box",
    steps: [
      {
        text: "This box has three sides. Draw its fourth to close it, and the box is yours.",
        position: [".-. . .", "|      ", ".-. .-.", "|      ", ". . .-.", "      |", ". . .-."],
        highlight: [at(0, 1), at(1, 0), at(2, 1)],
        expect: line(1, 2),
      },
      {
        text: "Closing a box gives you another turn. Another box has three sides: close it too.",
        highlight: [at(4, 5), at(5, 6), at(6, 5)],
        expect: line(5, 4),
      },
      {
        text: "After your last box you must still draw a line. Pick one that gives no box its third side, or teal closes it.",
        expect: [line(0, 3), line(0, 5), line(1, 4), line(1, 6), line(2, 3), line(4, 3), line(5, 0), line(5, 2), line(6, 1), line(6, 3)],
      },
    ],
  },
  {
    title: "Long chains",
    steps: [
      {
        text: "Every line left gives boxes away: three in the long chain along the bottom, or one in the corner. Give away the corner box: draw one of its sides.",
        position: [". .-.-.", "  |T|Y|", ".-.-.-.", "|T|Y|T|", ".-.-.-.", "       ", ".-.-.-."],
        highlight: [at(0, 1), at(1, 0)],
        expect: [line(0, 1), line(1, 0)],
      },
      {
        text: "Teal took the corner, then had to draw again, and every line left opened the chain. Take it all: close the first box.",
        position: [".-.-.-.", "|T|T|Y|", ".-.-.-.", "|T|Y|T|", ".-.-.-.", "|      ", ".-.-.-."],
        highlight: [at(5, 2)],
        expect: line(5, 2),
      },
      {
        text: "Each box you close gives you another turn. Take the next one.",
        expect: line(5, 4),
      },
      {
        text: "And the last: three boxes for one, and the game is yours.",
        expect: line(5, 6),
      },
    ],
  },
];
