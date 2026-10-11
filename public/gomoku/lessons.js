// Gomoku's tutorial lessons (see engine/tutorial.js). A position is
// { x, o }: the points of the solid stones (the learner's, who moves next)
// and of the ringed ones. Moves are the game's own { cell }; at() turns
// point names such as "H8" (columns A to P without I, rows 1 to 15 from the
// bottom) into cells.
import { SIZE } from "./rules.js";
import { COLUMNS } from "./art.js";

const at = (names) => names.split(" ").map((n) => (SIZE - Number(n.slice(1))) * SIZE + COLUMNS.indexOf(n[0]));
const cell = (name) => ({ cell: at(name)[0] });

export const lessons = [
  {
    title: "Placing a stone",
    steps: [
      {
        text: "You play the solid stones, which go first. Stones go on the crossings, and any free one will do. Place yours on the centre point.",
        position: {},
        highlight: at("H8"),
        expect: cell("H8"),
        reply: cell("J9"),
      },
      {
        text: "Stones never move once they're placed. Place your next stone right next to your first one.",
        highlight: at("H8"),
        expect: "G7 H7 J7 G8 J8 G9 H9".split(" ").map(cell),
      },
    ],
  },
  {
    title: "Five in a row",
    steps: [
      {
        text: "Line up five of your stones to win. Make the row five long, at either end.",
        position: { x: at("F8 G8 H8 J8"), o: at("G9 J9 H7 K7") },
        highlight: at("F8 G8 H8 J8"),
        arrows: [at("F8 K8")],
        expect: [cell("K8"), cell("E8")],
      },
      {
        text: "Straight down counts too. Make this column five long.",
        position: { x: at("H6 H7 H8 H9"), o: at("G7 J8 G9 J6") },
        highlight: at("H6 H7 H8 H9"),
        arrows: [at("H9 H5")],
        expect: [cell("H5"), cell("H10")],
      },
      {
        text: "And so does a diagonal. Finish this one.",
        position: { x: at("F6 G7 H8 J9"), o: at("G8 H6 J7 F9") },
        highlight: at("F6 G7 H8 J9"),
        arrows: [at("F6 K10")],
        expect: [cell("K10"), cell("E5")],
      },
    ],
  },
  {
    title: "Blocking",
    steps: [
      {
        text: "The ringed stones have four in a row. Block the open end, or they win on their next turn.",
        position: { x: at("E8 G7 H9 J7"), o: at("F8 G8 H8 J8") },
        highlight: at("F8 G8 H8 J8"),
        expect: cell("K8"),
      },
      {
        text: "Here they have three with both ends free. A four with both ends free can't be stopped, so block one end now.",
        position: { x: at("G7 H9 K10"), o: at("G8 H8 J8") },
        highlight: at("G8 H8 J8"),
        expect: [cell("F8"), cell("K8")],
      },
    ],
  },
  {
    title: "Making an open four",
    steps: [
      {
        text: "Your three has free points at both ends, but a ringed stone waits two along on the right. Add a fourth on the left, so both ends of your four are free.",
        position: { x: at("G8 H8 J8"), o: at("L8 G9 J7") },
        highlight: at("G8 H8 J8"),
        expect: cell("F8"),
        reply: cell("K8"),
      },
      {
        text: "They blocked one end, but an open four has two. Win at the other.",
        highlight: at("F8 G8 H8 J8"),
        expect: cell("E8"),
      },
    ],
  },
];
