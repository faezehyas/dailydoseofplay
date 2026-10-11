// Chess's tutorial lessons (see engine/tutorial.js). A position is a FEN and
// the side to move is the learner; moves are the game's own { from, to, promo }.
import { parseSquare } from "./rules.js";

const mv = (from, to, promo) => ({ from: parseSquare(from), to: parseSquare(to), ...(promo && { promo }) });
const at = (names) => names.split(" ").map(parseSquare);

export const lessons = [
  {
    title: "Rook, bishop and queen",
    steps: [
      {
        text: "The rook slides any distance along its row or column. Slide it from d4 across to a4.",
        position: "7k/8/8/8/3R4/8/8/4K3 w - - 0 1",
        highlight: at("d4 a4"),
        arrows: [at("d4 a4")],
        expect: mv("d4", "a4"),
      },
      {
        text: "The bishop slides diagonally. Move it from c1 all the way to h6.",
        position: "7k/8/8/8/8/8/8/2B1K3 w - - 0 1",
        highlight: at("c1 h6"),
        arrows: [at("c1 h6")],
        expect: mv("c1", "h6"),
      },
      {
        text: "The queen moves like a rook and a bishop together. Take her diagonally from d1 to a4.",
        position: "7k/8/8/8/8/8/8/3QK3 w - - 0 1",
        highlight: at("d1 a4"),
        arrows: [at("d1 a4")],
        expect: mv("d1", "a4"),
      },
    ],
  },
  {
    title: "Knight, king and pawn",
    steps: [
      {
        text: "The knight jumps in an L: two squares one way, then one to the side. It hops over pieces. Jump from b1 to c3.",
        position: "7k/8/8/8/8/8/PPP5/1N2K3 w - - 0 1",
        highlight: at("b1 c3"),
        arrows: [at("b1 c3")],
        expect: mv("b1", "c3"),
      },
      {
        text: "The king steps one square in any direction. Move your king one step.",
        position: "7k/8/8/8/8/8/8/4K3 w - - 0 1",
        highlight: at("e1"),
        expect: [mv("e1", "d1"), mv("e1", "d2"), mv("e1", "e2"), mv("e1", "f2"), mv("e1", "f1")],
      },
      {
        text: "A pawn walks straight forward. From its starting row it may step two squares: push it from e2 to e4.",
        position: "7k/8/8/8/8/8/4P3/4K3 w - - 0 1",
        highlight: at("e2 e4"),
        arrows: [at("e2 e4")],
        expect: mv("e2", "e4"),
        reply: mv("h8", "g8"),
      },
      {
        text: "After that it steps one square at a time. Push it on to e5.",
        highlight: at("e4 e5"),
        expect: mv("e4", "e5"),
      },
    ],
  },
  {
    title: "Capture",
    steps: [
      {
        text: "A piece captures by moving onto an enemy piece's square, which takes it off the board. Take the black knight with your rook.",
        position: "7k/8/8/8/n7/8/8/R3K3 w - - 0 1",
        highlight: at("a1 a4"),
        expect: mv("a1", "a4"),
      },
      {
        text: "Pawns are different: they capture one square diagonally forward, never straight ahead. Take the bishop with your pawn.",
        position: "7k/8/8/3bp3/4P3/8/8/4K3 w - - 0 1",
        highlight: at("e4 d5"),
        arrows: [at("e4 d5")],
        expect: mv("e4", "d5"),
      },
    ],
  },
  {
    title: "Check and checkmate",
    steps: [
      {
        text: "Attacking the king is called check. Give check: move your rook to a8, in line with the black king.",
        position: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
        highlight: at("a1 a8"),
        arrows: [at("a1 a8")],
        expect: mv("a1", "a8"),
        reply: mv("e8", "e7"),
      },
      {
        text: "Now the black rook checks your king. A move that leaves your king in check isn't allowed. Block the check: put your rook on e2.",
        position: "4r2k/8/8/8/8/8/R7/4K3 w - - 0 1",
        highlight: at("e8 a2 e2"),
        arrows: [at("a2 e2")],
        expect: mv("a2", "e2"),
      },
      {
        text: "Checkmate is a check with no way out, and it wins the game. The black king is boxed in by its own pawns: checkmate it with your queen.",
        position: "6k1/5ppp/8/8/8/8/8/3QK3 w - - 0 1",
        highlight: at("d1 g8"),
        expect: mv("d1", "d8"),
      },
    ],
  },
  {
    title: "Castling",
    steps: [
      {
        text: "Castling tucks your king away: it moves two squares toward a rook, and the rook jumps to its other side. Neither may have moved yet. Castle: move the king from e1 to g1.",
        position: "4k3/8/8/8/8/8/5PPP/4K2R w K - 0 1",
        highlight: at("e1 g1 h1"),
        arrows: [at("e1 g1")],
        expect: mv("e1", "g1"),
      },
      {
        text: "You can't castle out of, through or into check. The black bishop guards f1, so castle the other way: move the king from e1 to c1.",
        position: "4k3/8/8/8/2b5/8/8/R3K2R w KQ - 0 1",
        highlight: at("c4 f1 e1 c1"),
        arrows: [at("e1 c1")],
        expect: mv("e1", "c1"),
      },
    ],
  },
  {
    title: "En passant and promotion",
    steps: [
      {
        text: "Black's pawn just jumped two squares and landed beside yours. On this move only, you may take it en passant: move diagonally to d6, as if it had stepped just one.",
        position: "7k/8/8/3pP3/8/8/8/4K3 w - d6 0 1",
        highlight: at("e5 d5 d6"),
        arrows: [at("e5 d6")],
        expect: mv("e5", "d6"),
      },
      {
        text: "A pawn that reaches the far row becomes a queen, rook, bishop or knight. Push your pawn to a8 and choose a queen.",
        position: "7k/P7/8/8/8/8/8/4K3 w - - 0 1",
        highlight: at("a7 a8"),
        arrows: [at("a7 a8")],
        expect: mv("a7", "a8", "q"),
      },
    ],
  },
];
