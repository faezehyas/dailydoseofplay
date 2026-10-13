// Ludo's tutorial lessons (see engine/tutorial.js). A position is where
// your four tokens (mine, red, from the bottom left) and yellow's four stand,
// as each token's progress along its own path: Y in the yard, 0 its start
// square, 1–50 round the board, 51–55 up its home column, 56 home. die is
// the step's fixed roll, rolled for you. Moves are the game's own
// { type: "move", token }. Cells "t0"–"t3" are your tokens, "o0"–"o3"
// yellow's, and a number is a square of your path.
const Y = -1;
// Yellow starts half a lap after red: red's square r is yellow's r + 26.
const yellow = (r) => (r + 26) % 52;
const move = (token) => ({ type: "move", token });

export const lessons = [
  {
    title: "Leaving the yard",
    steps: [
      {
        text: "You play red, from the bottom left. A token leaves your yard only on a 6, onto your start square. You rolled a 6: bring a token out.",
        position: { mine: [Y, Y, Y, Y], theirs: [Y, Y, Y, Y], die: 6 },
        highlight: ["t0", "t1", "t2", "t3", 0],
        expect: [0, 1, 2, 3].map(move),
      },
      {
        text: "A 6 also rolls again, and this time it's a 4. Tokens in the yard can't move on a 4: move the one on your start square 4 squares along.",
        position: { mine: [0, Y, Y, Y], theirs: [Y, Y, Y, Y], die: 4 },
        highlight: ["t0", 4],
        arrows: [["t0", 4]],
        expect: move(0),
      },
    ],
  },
  {
    title: "Moving round the board",
    steps: [
      {
        text: "Tokens go clockwise round the board. Near the end of the lap a token turns off into your own red column, towards home in the centre. You rolled a 5: move the token that's almost round.",
        position: { mine: [10, 47, Y, Y], theirs: [Y, Y, Y, Y], die: 5 },
        highlight: ["t1", 52],
        arrows: [["t1", 52]],
        expect: move(1),
      },
    ],
  },
  {
    title: "Capturing",
    steps: [
      {
        text: "Land on another player's token to capture it: it goes back to its yard. You rolled a 3: capture the yellow token.",
        position: { mine: [12, 2, Y, Y], theirs: [yellow(15), Y, Y, Y], die: 3 },
        highlight: ["t0", "o0"],
        arrows: [["t0", "o0"]],
        expect: move(0),
      },
    ],
  },
  {
    title: "Safe squares",
    steps: [
      {
        text: "Stars and start squares are safe: no token is captured there, and tokens can share them. Move onto the star: the yellow token there stays, and the one behind you can't catch you.",
        position: { mine: [5, Y, Y, Y], theirs: [yellow(8), yellow(2), Y, Y], die: 3 },
        highlight: ["t0", 8],
        arrows: [["t0", 8]],
        expect: move(0),
      },
    ],
  },
  {
    title: "Reaching home",
    steps: [
      {
        text: "A token goes home to the centre only with the exact roll. You rolled a 3: move the token that's 3 squares from home. The other one would overshoot.",
        position: { mine: [53, 54, Y, Y], theirs: [Y, Y, Y, Y], die: 3 },
        highlight: ["t0", "t1"],
        arrows: [["t0", 56]],
        expect: move(0),
      },
    ],
  },
];
