// Connect 4's tutorial lessons (see engine/tutorial.js). A position is the
// 7 × 6 board's lowest rows, top to bottom, of X, O and "." (empty); the
// learner is X, coral, who moves next. Moves are the game's own { col }.
// Squares are numbered row by row from the top: at(col, height) is the
// square `height` holes up from the bottom of a column.
const at = (col, height) => (6 - height) * 7 + col;

export const lessons = [
  {
    title: "Dropping a disc",
    steps: [
      {
        text: "You play coral, and coral goes first. Tap a column to drop a disc: it falls to the lowest free hole. Drop one in the middle column.",
        position: ".......",
        arrows: [[at(3, 6), at(3, 1)]],
        expect: { col: 3 },
        reply: { col: 3 },
      },
      {
        text: "Teal's disc landed on yours: discs stack up from the bottom. Drop your next disc in any column.",
        expect: [0, 1, 2, 3, 4, 5, 6].map((col) => ({ col })),
      },
    ],
  },
  {
    title: "Four in a row",
    steps: [
      {
        text: "Line up four of your discs to win. Finish the bottom row.",
        position: "....O.. XXX.OO.",
        highlight: [at(0, 1), at(1, 1), at(2, 1)],
        arrows: [[at(0, 1), at(3, 1)]],
        expect: { col: 3 },
      },
      {
        text: "Straight up counts too. Finish the column.",
        position: "..X.... ..XO... ..XOO..",
        highlight: [at(2, 1), at(2, 2), at(2, 3)],
        arrows: [[at(2, 1), at(2, 4)]],
        expect: { col: 2 },
      },
      {
        text: "So does a diagonal. Finish this one, climbing to the right.",
        position: "..XX... .XOO... XOOX.O.",
        highlight: [at(0, 1), at(1, 2), at(2, 3)],
        arrows: [[at(0, 1), at(3, 4)]],
        expect: { col: 3 },
      },
      {
        text: "And the other way, climbing to the left.",
        position: "...XX.. ...OOX. .O.XOOX",
        highlight: [at(6, 1), at(5, 2), at(4, 3)],
        arrows: [[at(6, 1), at(3, 4)]],
        expect: { col: 3 },
      },
    ],
  },
  {
    title: "Blocking",
    steps: [
      {
        text: "Teal has three in a row. Block the gap, or teal wins on its next turn.",
        position: "X.XX..O XOOO.XO",
        highlight: [at(1, 1), at(2, 1), at(3, 1)],
        expect: { col: 4 },
        reply: { col: 6 },
      },
      {
        text: "Now teal has three stacked up. Block the top of the column.",
        highlight: [at(6, 1), at(6, 2), at(6, 3)],
        expect: { col: 6 },
      },
    ],
  },
  {
    title: "Two threats",
    steps: [
      {
        text: "Teal can block one hole, but not two. Drop a disc beside your pair, so your three in a row has a free hole at each end.",
        position: "..O.... ..XX.O.",
        highlight: [at(2, 1), at(3, 1)],
        expect: { col: 1 },
        reply: { col: 0 },
      },
      {
        text: "Teal blocked one end. Win at the other.",
        highlight: [at(1, 1), at(2, 1), at(3, 1)],
        expect: { col: 4 },
      },
    ],
  },
];
