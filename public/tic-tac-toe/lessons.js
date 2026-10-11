// Tic Tac Toe's tutorial lessons (see engine/tutorial.js). A position is the
// 3 × 3 board's rows of X, O and "." (empty); the learner is X, who moves
// next. Moves are the game's own { cell }, numbered 0 to 8 row by row.
export const lessons = [
  {
    title: "Placing a mark",
    steps: [
      {
        text: "You play X, and X always goes first. Tap the centre square to place your mark.",
        position: "... ... ...",
        highlight: [4],
        expect: { cell: 4 },
        reply: { cell: 0 },
      },
      {
        text: "O took a corner. A square that's taken stays taken. Place your X on any empty square.",
        expect: [1, 2, 3, 5, 6, 7, 8].map((cell) => ({ cell })),
      },
    ],
  },
  {
    title: "Three in a row",
    steps: [
      {
        text: "Line up three of your marks to win. Finish the top row.",
        position: "XX. OO. ...",
        highlight: [0, 1],
        arrows: [[0, 2]],
        expect: { cell: 2 },
      },
      {
        text: "A line can run corner to corner too. Finish the diagonal.",
        position: "X.. OX. O..",
        highlight: [0, 4],
        arrows: [[0, 8]],
        expect: { cell: 8 },
      },
      {
        text: "And straight down. Finish the left column.",
        position: "XO. XO. ...",
        highlight: [0, 3],
        arrows: [[0, 6]],
        expect: { cell: 6 },
      },
    ],
  },
  {
    title: "Blocking",
    steps: [
      {
        text: "O has two in a row. Block the gap, or O wins on its next turn.",
        position: "OO. ..X X..",
        highlight: [0, 1],
        expect: { cell: 2 },
        reply: { cell: 4 },
      },
      {
        text: "O blocked your diagonal and now threatens two lines at once. You can't block both, but you can win first: finish your right column.",
        highlight: [2, 5],
        arrows: [[2, 8]],
        expect: { cell: 8 },
      },
    ],
  },
];
