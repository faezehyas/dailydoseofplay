// Checkers' tutorial lessons (see engine/tutorial.js). A position is the
// board's rows, top to bottom, of x and o (men), X and O (kings) and "."; the
// learner is x, coral, moving up the board, and moves next. Moves are the
// game's own { path }. at() names squares as on a chessboard: files a to h
// from the left, ranks 1 to 8 from the learner's side.
const at = (names) => names.split(" ").map((n) => (8 - Number(n[1])) * 8 + "abcdefgh".indexOf(n[0]));
const path = (names) => ({ path: at(names) });

export const lessons = [
  {
    title: "Moving",
    steps: [
      {
        text: "You play coral, from the bottom up. A man steps one square diagonally forward, onto an empty dark square. Move the lit man up to the right.",
        position: ".....o.. ........ ........ ........ ........ ..x..... ........ ........",
        highlight: at("c3 d4"),
        arrows: [at("c3 d4")],
        expect: path("c3 d4"),
        reply: path("f8 g7"),
      },
      {
        text: "A man never steps back. Move it forward again, either way.",
        highlight: at("d4"),
        expect: [path("d4 c5"), path("d4 e5")],
      },
    ],
  },
  {
    title: "Capturing",
    steps: [
      {
        text: "Capture by jumping diagonally over an enemy piece onto the empty square beyond. The piece you jump leaves the board. Take the teal man.",
        position: "...o.... ....o... ........ ....o... ...x...x ........ ........ ........",
        highlight: at("d4 e5"),
        arrows: [at("d4 f6")],
        expect: path("d4 f6"),
        reply: path("e7 g5"),
      },
      {
        text: "Teal jumped your man. Take it back.",
        highlight: at("h4 g5"),
        expect: path("h4 f6"),
      },
    ],
  },
  {
    title: "Forced captures and multi-jumps",
    steps: [
      {
        text: "When you can capture, you must: no other move is allowed. Find the capture.",
        position: "........ ........ ........ ......o. .....x.. ........ .x...... ........",
        expect: path("f4 h6"),
      },
      {
        text: "After a jump, if the same man can jump again, it must keep going. Take both teal men in one move: tap each square it lands on.",
        position: "........ ........ ...o.... ........ ...o.... ..x..... ........ ........",
        highlight: at("d4 d6"),
        arrows: [at("c3 e5"), at("e5 c7")],
        expect: path("c3 e5 c7"),
      },
    ],
  },
  {
    title: "Crowning a king",
    steps: [
      {
        text: "A man that reaches the far row is crowned a king. Move the lit man onto the top row.",
        position: "........ ..x..... ........ ........ .......o ........ ........ ........",
        highlight: at("c7 d8"),
        arrows: [at("c7 d8")],
        expect: path("c7 d8"),
        reply: path("h4 g3"),
      },
      {
        text: "A king moves diagonally backwards as well as forwards. Move your king one step back down the board.",
        highlight: at("d8"),
        expect: [path("d8 c7"), path("d8 e7")],
      },
    ],
  },
];
